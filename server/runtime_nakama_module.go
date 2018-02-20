// Copyright 2018 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"context"
	"io"
	"net/http"
	"time"

	"strings"

	"database/sql"

	"encoding/json"

	"encoding/base64"

	"encoding/hex"
	"io/ioutil"

	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"sync"

	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const CALLBACKS = "runtime_callbacks"

type Callbacks struct {
	RPC map[string]*lua.LFunction
}

type NakamaModule struct {
	logger      *zap.Logger
	db          *sql.DB
	config      Config
	registry    *SessionRegistry
	tracker     Tracker
	router      MessageRouter
	once        *sync.Once
	announceRPC func(string)
	client      *http.Client
}

func NewNakamaModule(logger *zap.Logger, db *sql.DB, config Config, l *lua.LState, registry *SessionRegistry, tracker Tracker, router MessageRouter, once *sync.Once, announceRPC func(string)) *NakamaModule {
	l.SetContext(context.WithValue(context.Background(), CALLBACKS, &Callbacks{
		RPC: make(map[string]*lua.LFunction),
	}))
	return &NakamaModule{
		logger:      logger,
		db:          db,
		config:      config,
		registry:    registry,
		tracker:     tracker,
		router:      router,
		once:        once,
		announceRPC: announceRPC,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (n *NakamaModule) Loader(l *lua.LState) int {
	mod := l.SetFuncs(l.NewTable(), map[string]lua.LGFunction{
		"sql_exec":                    n.sqlExec,
		"sql_query":                   n.sqlQuery,
		"uuid_v4":                     n.uuidV4,
		"uuid_bytes_to_string":        n.uuidBytesToString,
		"uuid_string_to_bytes":        n.uuidStringToBytes,
		"http_request":                n.httpRequest,
		"json_encode":                 n.jsonEncode,
		"json_decode":                 n.jsonDecode,
		"base64_encode":               n.base64Encode,
		"base64_decode":               n.base64Decode,
		"base16_encode":               n.base16Encode,
		"base16_decode":               n.base16decode,
		"aes128_encrypt":              n.aes128encrypt,
		"aes128_decrypt":              n.aes128decrypt,
		"bcrypt_hash":                 n.bcryptHash,
		"bcrypt_compare":              n.bcryptCompare,
		"authenticate_custom":         n.authenticateCustom,
		"authenticate_device":         n.authenticateDevice,
		"authenticate_email":          n.authenticateEmail,
		"authenticate_token_generate": n.authenticateTokenGenerate,
		"cron_next":                   n.cronNext,
		"logger_info":                 n.loggerInfo,
		"logger_warn":                 n.loggerWarn,
		"logger_error":                n.loggerError,
		"stream_user_get":             n.streamUserGet,
		"stream_user_join":            n.streamUserJoin,
		"stream_user_leave":           n.streamUserLeave,
		"stream_count":                n.streamCount,
		"stream_close":                n.streamClose,
		"stream_send":                 n.streamSend,
		"register_rpc":                n.registerRPC,
		// "run_once":             n.runOnce,
	})

	l.Push(mod)
	return 1
}

func (n *NakamaModule) sqlExec(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, l.NewTable())
	if paramsTable == nil {
		l.ArgError(2, "expects params table")
		return 0
	}
	var params []interface{}
	if paramsTable.Len() != 0 {
		var ok bool
		params, ok = convertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	result, err := n.db.Exec(query, params...)
	if err != nil {
		l.RaiseError("sql exec error: %v", err.Error())
		return 0
	}
	count, err := result.RowsAffected()
	if err != nil {
		l.RaiseError("sql exec rows affected error: %v", err.Error())
		return 0
	}

	l.Push(lua.LNumber(count))
	return 1
}

func (n *NakamaModule) sqlQuery(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, l.NewTable())
	if paramsTable == nil {
		l.ArgError(2, "expects params table")
		return 0
	}
	var params []interface{}
	if paramsTable.Len() != 0 {
		var ok bool
		params, ok = convertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	rows, err := n.db.Query(query, params...)
	if err != nil {
		l.RaiseError("sql query error: %v", err.Error())
		return 0
	}
	defer rows.Close()

	resultColumns, err := rows.Columns()
	if err != nil {
		l.RaiseError("sql query column lookup error: %v", err.Error())
		return 0
	}
	resultColumnCount := len(resultColumns)
	resultRows := make([][]interface{}, 0)
	for rows.Next() {
		resultRowValues := make([]interface{}, resultColumnCount)
		resultRowPointers := make([]interface{}, resultColumnCount)
		for i, _ := range resultRowValues {
			resultRowPointers[i] = &resultRowValues[i]
		}
		if err = rows.Scan(resultRowPointers...); err != nil {
			l.RaiseError("sql query scan error: %v", err.Error())
			return 0
		}
		resultRows = append(resultRows, resultRowValues)
	}
	if err = rows.Err(); err != nil {
		l.RaiseError("sql query row scan error: %v", err.Error())
		return 0
	}

	rt := l.NewTable()
	for i, r := range resultRows {
		rowTable := l.NewTable()
		for j, col := range resultColumns {
			rowTable.RawSetString(col, convertValue(l, r[j]))
		}
		rt.RawSetInt(i+1, rowTable)
	}
	l.Push(rt)
	return 1
}

func (n *NakamaModule) uuidV4(l *lua.LState) int {
	l.Push(lua.LString(uuid.NewV4().String()))
	return 1
}

func (n *NakamaModule) uuidBytesToString(l *lua.LState) int {
	uuidBytes := l.CheckString(1)
	if uuidBytes == "" {
		l.ArgError(1, "expects a UUID byte string")
		return 0
	}
	u, err := uuid.FromBytes([]byte(uuidBytes))
	if err != nil {
		l.ArgError(1, "not a valid UUID byte string")
		return 0
	}
	l.Push(lua.LString(u.String()))
	return 1
}

func (n *NakamaModule) uuidStringToBytes(l *lua.LState) int {
	uuidString := l.CheckString(1)
	if uuidString == "" {
		l.ArgError(1, "expects a UUID string")
		return 0
	}
	u, err := uuid.FromString(uuidString)
	if err != nil {
		l.ArgError(1, "not a valid UUID string")
		return 0
	}
	l.Push(lua.LString(u.Bytes()))
	return 1
}

func (n *NakamaModule) httpRequest(l *lua.LState) int {
	url := l.CheckString(1)
	method := l.CheckString(2)
	headers := l.CheckTable(3)
	body := l.OptString(4, "")
	if url == "" {
		l.ArgError(1, "expects URL string")
		return 0
	}
	if method == "" {
		l.ArgError(2, "expects method string")
		return 0
	}

	// Prepare request body, if any.
	var requestBody io.Reader
	if body != "" {
		requestBody = strings.NewReader(body)
	}
	// Prepare the request.
	req, err := http.NewRequest(method, url, requestBody)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Apply any request headers.
	httpHeaders := ConvertLuaTable(headers)
	for k, v := range httpHeaders {
		if vs, ok := v.(string); !ok {
			l.RaiseError("HTTP header values must be strings")
			return 0
		} else {
			req.Header.Add(k, vs)
		}
	}
	// Execute the request.
	resp, err := n.client.Do(req)
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Read the response body.
	responseBody, err := ioutil.ReadAll(resp.Body)
	resp.Body.Close()
	if err != nil {
		l.RaiseError("HTTP response body error: %v", err.Error())
		return 0
	}
	// Read the response headers.
	responseHeaders := make(map[string]interface{}, len(resp.Header))
	for k, vs := range resp.Header {
		// TODO accept multiple values per header
		for _, v := range vs {
			responseHeaders[k] = v
			break
		}
	}

	l.Push(lua.LNumber(resp.StatusCode))
	l.Push(ConvertMap(l, responseHeaders))
	l.Push(lua.LString(string(responseBody)))
	return 3
}

func (n *NakamaModule) jsonEncode(l *lua.LState) int {
	jsonTable := l.Get(1)
	if jsonTable == nil {
		l.ArgError(1, "expects a non-nil value to encode")
		return 0
	}

	jsonData := convertLuaValue(jsonTable)
	jsonBytes, err := json.Marshal(jsonData)
	if err != nil {
		l.RaiseError("error encoding to JSON: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(string(jsonBytes)))
	return 1
}

func (n *NakamaModule) jsonDecode(l *lua.LState) int {
	jsonString := l.CheckString(1)
	if jsonString == "" {
		l.ArgError(1, "expects JSON string")
		return 0
	}

	var jsonData interface{}
	if err := json.Unmarshal([]byte(jsonString), &jsonData); err != nil {
		l.RaiseError("not a valid JSON string: %v", err.Error())
		return 0
	}

	l.Push(convertValue(l, jsonData))
	return 1
}

func (n *NakamaModule) base64Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	output := base64.StdEncoding.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base64Decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	output, err := base64.RawStdEncoding.DecodeString(input)
	if err != nil {
		l.RaiseError("not a valid base64 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base16Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	output := hex.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base16decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	output, err := hex.DecodeString(input)
	if err != nil {
		l.RaiseError("not a valid base16 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) aes128encrypt(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}
	key := l.CheckString(2)
	if len(key) != 16 {
		l.ArgError(2, "expects key 16 bytes long")
		return 0
	}

	// Pad string up to length multiple of 4 if needed.
	if maybePad := len(input) % 4; maybePad != 0 {
		input += strings.Repeat(" ", 4-maybePad)
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		l.RaiseError("error creating cipher block: %v", err.Error())
		return 0
	}

	cipherText := make([]byte, aes.BlockSize+len(input))
	iv := cipherText[:aes.BlockSize]
	if _, err = io.ReadFull(rand.Reader, iv); err != nil {
		l.RaiseError("error getting iv: %v", err.Error())
		return 0
	}

	stream := cipher.NewCFBEncrypter(block, iv)
	stream.XORKeyStream(cipherText[aes.BlockSize:], []byte(input))

	l.Push(lua.LString(cipherText))
	return 1
}

func (n *NakamaModule) aes128decrypt(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}
	key := l.CheckString(2)
	if len(key) != 16 {
		l.ArgError(2, "expects key 16 bytes long")
		return 0
	}

	if len(input) < aes.BlockSize {
		l.RaiseError("input too short")
		return 0
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		l.RaiseError("error creating cipher block: %v", err.Error())
		return 0
	}

	cipherText := []byte(input)
	iv := cipherText[:aes.BlockSize]
	cipherText = cipherText[aes.BlockSize:]

	stream := cipher.NewCFBDecrypter(block, iv)
	stream.XORKeyStream(cipherText, cipherText)

	l.Push(lua.LString(cipherText))
	return 1
}

func (n *NakamaModule) bcryptHash(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input), bcrypt.DefaultCost)
	if err != nil {
		l.RaiseError("error hashing input: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(hash))
	return 1
}

func (n *NakamaModule) bcryptCompare(l *lua.LState) int {
	hash := l.CheckString(1)
	if hash == "" {
		l.ArgError(1, "expects string")
		return 0
	}
	plaintext := l.CheckString(2)
	if plaintext == "" {
		l.ArgError(2, "expects string")
		return 0
	}

	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext))
	if err == nil {
		l.Push(lua.LBool(true))
		return 1
	} else if err == bcrypt.ErrHashTooShort || err == bcrypt.ErrMismatchedHashAndPassword {
		l.Push(lua.LBool(false))
		return 1
	}

	l.RaiseError("error comparing hash and plaintext: %v", err.Error())
	return 0
}

func (n *NakamaModule) authenticateCustom(l *lua.LState) int {
	// Parse ID.
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects id string")
		return 0
	} else if invalidCharsRegex.MatchString(id) {
		l.ArgError(1, "expects id to be valid, no spaces or control characters allowed")
		return 0
	} else if len(id) < 10 || len(id) > 128 {
		l.ArgError(1, "expects id to be valid, must be 10-128 bytes")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(2, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(2, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(2, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(3, true)

	dbUserID, dbUsername, err := AuthenticateCustom(n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	return 2
}

func (n *NakamaModule) authenticateDevice(l *lua.LState) int {
	// Parse ID.
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects id string")
		return 0
	} else if invalidCharsRegex.MatchString(id) {
		l.ArgError(1, "expects id to be valid, no spaces or control characters allowed")
		return 0
	} else if len(id) < 10 || len(id) > 128 {
		l.ArgError(1, "expects id to be valid, must be 10-128 bytes")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(2, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(2, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(2, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(3, true)

	dbUserID, dbUsername, err := AuthenticateDevice(n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	return 2
}

func (n *NakamaModule) authenticateEmail(l *lua.LState) int {
	// Parse email.
	email := l.CheckString(1)
	if email == "" {
		l.ArgError(1, "expects email string")
		return 0
	} else if invalidCharsRegex.MatchString(email) {
		l.ArgError(1, "expects email to be valid, no spaces or control characters allowed")
		return 0
	} else if !emailRegex.MatchString(email) {
		l.ArgError(1, "expects email to be valid, invalid email address format")
		return 0
	} else if len(email) < 10 || len(email) > 255 {
		l.ArgError(1, "expects email to be valid, must be 10-255 bytes")
		return 0
	}

	// Parse password.
	password := l.CheckString(2)
	if password == "" {
		l.ArgError(2, "expects password string")
		return 0
	} else if len(password) < 8 {
		l.ArgError(1, "expects password to be valid, must be longer than 8 characters")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(2, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(2, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(2, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(3, true)

	cleanEmail := strings.ToLower(email)

	dbUserID, dbUsername, err := AuthenticateEmail(n.logger, n.db, cleanEmail, password, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	return 2
}

func (n *NakamaModule) authenticateTokenGenerate(l *lua.LState) int {
	// Parse input User ID.
	userIDString := l.CheckString(1)
	if userIDString == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	_, err := uuid.FromString(userIDString)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Input username.
	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username")
		return 0
	}

	exp := l.OptInt64(3, 0)
	if exp == 0 {
		// If expiry is 0 or not set, use standard configured expiry.
		exp = time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpiryMs) * time.Millisecond).Unix()
	}

	token := generateTokenWithExpiry(n.config, userIDString, username, exp)

	l.Push(lua.LString(token))
	return 1
}

func (n *NakamaModule) cronNext(l *lua.LState) int {
	cron := l.CheckString(1)
	if cron == "" {
		l.ArgError(1, "expects cron string")
		return 0
	}
	ts := l.CheckInt64(2)
	if ts == 0 {
		l.ArgError(1, "expects timestamp in seconds")
		return 0
	}

	expr, err := cronexpr.Parse(cron)
	if err != nil {
		l.ArgError(1, "expects a valid cron string")
		return 0
	}
	t := time.Unix(ts, 0).UTC()
	next := expr.Next(t)
	nextTs := next.UTC().Unix()
	l.Push(lua.LNumber(nextTs))
	return 1
}

func (n *NakamaModule) loggerInfo(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Info(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) loggerWarn(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Warn(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) loggerError(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Error(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *NakamaModule) streamUserGet(l *lua.LState) int {
	// Parse input User ID.
	userIDString := l.CheckString(1)
	if userIDString == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(userIDString)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionIDString := l.CheckString(2)
	if sessionIDString == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sessionID, err := uuid.FromString(sessionIDString)
	if err != nil {
		l.ArgError(2, "expects valid session id")
		return 0
	}

	// Parse input stream identifier.
	streamTable := l.CheckTable(3)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(3, conversionError)
		return 0
	}

	meta := n.tracker.GetLocalBySessionIDStreamUserID(sessionID, stream, userID)
	if meta == nil {
		l.Push(lua.LNil)
	} else {
		metaTable := l.NewTable()
		metaTable.RawSetString("Hidden", lua.LBool(meta.Hidden))
		metaTable.RawSetString("Persistence", lua.LBool(meta.Persistence))
		metaTable.RawSetString("Username", lua.LString(meta.Username))
		metaTable.RawSetString("Status", lua.LString(meta.Status))
		l.Push(metaTable)
	}
	return 1
}

func (n *NakamaModule) streamUserJoin(l *lua.LState) int {
	// Parse input User ID.
	userIDString := l.CheckString(1)
	if userIDString == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(userIDString)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionIDString := l.CheckString(2)
	if sessionIDString == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sessionID, err := uuid.FromString(sessionIDString)
	if err != nil {
		l.ArgError(2, "expects valid session id")
		return 0
	}

	// Parse input stream identifier.
	streamTable := l.CheckTable(3)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(3, conversionError)
		return 0
	}

	// By default generate presence events.
	hidden := l.OptBool(4, false)
	// By default persistence is enabled, if the stream supports it.
	persistence := l.OptBool(5, true)

	// Look up the session.
	session := n.registry.Get(sessionID)
	if session == nil {
		l.ArgError(2, "session id does not exist")
		return 0
	}

	alreadyTracked := n.tracker.Track(sessionID, stream, userID, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
	})

	l.Push(lua.LBool(alreadyTracked))
	return 1
}

func (n *NakamaModule) streamUserLeave(l *lua.LState) int {
	// Parse input User ID.
	userIDString := l.CheckString(1)
	if userIDString == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(userIDString)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionIDString := l.CheckString(2)
	if sessionIDString == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sessionID, err := uuid.FromString(sessionIDString)
	if err != nil {
		l.ArgError(2, "expects valid session id")
		return 0
	}

	// Parse input stream identifier.
	streamTable := l.CheckTable(3)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(3, conversionError)
		return 0
	}

	n.tracker.Untrack(sessionID, stream, userID)

	return 0
}

func (n *NakamaModule) streamCount(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	count := n.tracker.CountByStream(stream)

	l.Push(lua.LNumber(count))
	return 1
}

func (n *NakamaModule) streamClose(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	n.tracker.UntrackByStream(stream)

	return 0
}

func (n *NakamaModule) streamSend(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil || streamTable.Len() == 0 {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "Mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream Mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "Subject":
			if v.Type() != lua.LTString {
				conversionError = "stream Subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "Descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream Descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream Descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "Label":
			if v.Type() != lua.LTString {
				conversionError = "stream Label must be a string"
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError != "" {
		l.ArgError(1, conversionError)
		return 0
	}

	// Grab payload to send, allow empty data.
	data := l.CheckString(2)

	streamWire := &rtapi.Stream{
		Mode:  int32(stream.Mode),
		Label: stream.Label,
	}
	if stream.Subject != uuid.Nil {
		streamWire.Subject = stream.Subject.String()
	}
	if stream.Descriptor != uuid.Nil {
		streamWire.Descriptor_ = stream.Descriptor.String()
	}
	msg := &rtapi.Envelope{Message: &rtapi.Envelope_StreamData{StreamData: &rtapi.StreamData{
		Stream: streamWire,
		// No sender.
		Data: data,
	}}}
	n.router.SendToStream(n.logger, stream, msg)

	return 0
}

func (n *NakamaModule) registerRPC(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects rpc id")
		return 0
	}

	id = strings.ToLower(id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.RPC[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(id)
	}
	return 0
}

func (n *NakamaModule) runOnce(l *lua.LState) int {
	n.once.Do(func() {
		fn := l.CheckFunction(1)
		if fn == nil {
			l.ArgError(1, "expects a function")
			return
		}

		l.Push(fn)
		if err := l.PCall(0, lua.MultRet, nil); err != nil {
			l.RaiseError("error in run_once function: %v", err.Error())
		}
	})

	return 0
}
