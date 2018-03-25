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
	"fmt"
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

	"crypto/hmac"
	"crypto/sha256"

	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/social"
	"github.com/satori/go.uuid"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

const CALLBACKS = "runtime_callbacks"
const API_PREFIX = "/nakama.api.Nakama/"
const RTAPI_PREFIX = "*rtapi.Envelope_"

type Callbacks struct {
	RPC    map[string]*lua.LFunction
	Before map[string]*lua.LFunction
	After  map[string]*lua.LFunction
}

type NakamaModule struct {
	logger          *zap.Logger
	db              *sql.DB
	config          Config
	socialClient    *social.Client
	sessionRegistry *SessionRegistry
	matchRegistry   MatchRegistry
	tracker         Tracker
	router          MessageRouter
	once            *sync.Once
	announceRPC     func(ExecutionMode, string)
	client          *http.Client
}

func NewNakamaModule(logger *zap.Logger, db *sql.DB, config Config, socialClient *social.Client, l *lua.LState, sessionRegistry *SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, once *sync.Once, announceRPC func(ExecutionMode, string)) *NakamaModule {
	l.SetContext(context.WithValue(context.Background(), CALLBACKS, &Callbacks{
		RPC:    make(map[string]*lua.LFunction),
		Before: make(map[string]*lua.LFunction),
		After:  make(map[string]*lua.LFunction),
	}))
	return &NakamaModule{
		logger:          logger,
		db:              db,
		config:          config,
		socialClient:    socialClient,
		sessionRegistry: sessionRegistry,
		matchRegistry:   matchRegistry,
		tracker:         tracker,
		router:          router,
		once:            once,
		announceRPC:     announceRPC,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},
	}
}

func (n *NakamaModule) Loader(l *lua.LState) int {
	functions := map[string]lua.LGFunction{
		"register_rpc":                n.registerRPC,
		"register_req_before":         n.registerReqBefore,
		"register_req_after":          n.registerReqAfter,
		"register_rt_before":          n.registerRTBefore,
		"register_rt_after":           n.registerRTAfter,
		"run_once":                    n.runOnce,
		"cron_next":                   n.cronNext,
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
		"base64url_encode":            n.base64URLEncode,
		"base64url_decode":            n.base64URLDecode,
		"base16_encode":               n.base16Encode,
		"base16_decode":               n.base16Decode,
		"aes128_encrypt":              n.aes128Encrypt,
		"aes128_decrypt":              n.aes128Decrypt,
		"hmac_sha256_hash":            n.hmacSHA256Hash,
		"bcrypt_hash":                 n.bcryptHash,
		"bcrypt_compare":              n.bcryptCompare,
		"authenticate_custom":         n.authenticateCustom,
		"authenticate_device":         n.authenticateDevice,
		"authenticate_email":          n.authenticateEmail,
		"authenticate_facebook":       n.authenticateFacebook,
		"authenticate_gamecenter":     n.authenticateGameCenter,
		"authenticate_google":         n.authenticateGoogle,
		"authenticate_steam":          n.authenticateSteam,
		"authenticate_token_generate": n.authenticateTokenGenerate,
		"logger_info":                 n.loggerInfo,
		"logger_warn":                 n.loggerWarn,
		"logger_error":                n.loggerError,
		"stream_user_get":             n.streamUserGet,
		"stream_user_join":            n.streamUserJoin,
		"stream_user_leave":           n.streamUserLeave,
		"stream_count":                n.streamCount,
		"stream_close":                n.streamClose,
		"stream_send":                 n.streamSend,
		"match_create":                n.matchCreate,
		"match_list":                  n.matchList,
		"notification_send":           n.notificationSend,
		"notifications_send":          n.notificationsSend,
		"wallet_write":                n.walletWrite,
		"storage_list":                n.storageList,
		"storage_read":                n.storageRead,
		"storage_write":               n.storageWrite,
		"storage_delete":              n.storageDelete,
	}
	mod := l.SetFuncs(l.CreateTable(len(functions), len(functions)), functions)

	l.Push(mod)
	return 1
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
		n.announceRPC(RPC, id)
	}
	return 0
}

func (n *NakamaModule) registerReqBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects method name")
		return 0
	}

	id = strings.ToLower(API_PREFIX + id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.Before[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(BEFORE, id)
	}
	return 0
}

func (n *NakamaModule) registerReqAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects method name")
		return 0
	}

	id = strings.ToLower(API_PREFIX + id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.After[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(AFTER, id)
	}
	return 0
}

func (n *NakamaModule) registerRTBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	id = strings.ToLower(RTAPI_PREFIX + id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.Before[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(BEFORE, id)
	}
	return 0
}

func (n *NakamaModule) registerRTAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	id = strings.ToLower(RTAPI_PREFIX + id)

	rc := l.Context().Value(CALLBACKS).(*Callbacks)
	rc.After[id] = fn
	if n.announceRPC != nil {
		n.announceRPC(AFTER, id)
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

		ctx := NewLuaContext(l, ConvertMap(l, n.config.GetRuntime().Environment), RunOnce, "", "", 0, "")

		l.Push(LSentinel)
		l.Push(fn)
		l.Push(ctx)
		if err := l.PCall(1, lua.MultRet, nil); err != nil {
			l.RaiseError("error in run_once function: %v", err.Error())
			return
		}

		// Unwind the stack up to and including our sentinel value, effectively discarding any returned parameters.
		for {
			v := l.Get(-1)
			l.Pop(1)
			if v.Type() == LTSentinel {
				break
			}
		}
	})

	return 0
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

func (n *NakamaModule) sqlExec(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, nil)
	var params []interface{}
	if paramsTable != nil && paramsTable.Len() != 0 {
		var ok bool
		params, ok = ConvertLuaValue(paramsTable).([]interface{})
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
	paramsTable := l.OptTable(2, nil)
	var params []interface{}
	if paramsTable != nil && paramsTable.Len() != 0 {
		var ok bool
		params, ok = ConvertLuaValue(paramsTable).([]interface{})
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

	rt := l.CreateTable(len(resultRows), len(resultRows))
	for i, r := range resultRows {
		rowTable := l.CreateTable(resultColumnCount, resultColumnCount)
		for j, col := range resultColumns {
			rowTable.RawSetString(col, ConvertValue(l, r[j]))
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

	jsonData := ConvertLuaValue(jsonTable)
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

	l.Push(ConvertValue(l, jsonData))
	return 1
}

func (n *NakamaModule) base64Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	padding := l.OptBool(2, true)

	e := base64.StdEncoding
	if !padding {
		e = base64.RawStdEncoding
	}
	output := e.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base64Decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	padding := l.OptBool(2, false)

	if !padding {
		// Pad string up to length multiple of 4 if needed to effectively make padding optional.
		if maybePad := len(input) % 4; maybePad != 0 {
			input += strings.Repeat("=", 4-maybePad)
		}
	}

	output, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		l.RaiseError("not a valid base64 string: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base64URLEncode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	padding := l.OptBool(2, true)

	e := base64.URLEncoding
	if !padding {
		e = base64.RawURLEncoding
	}
	output := e.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}

func (n *NakamaModule) base64URLDecode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	padding := l.OptBool(2, false)

	if !padding {
		// Pad string up to length multiple of 4 if needed to effectively make padding optional.
		if maybePad := len(input) % 4; maybePad != 0 {
			input += strings.Repeat("=", 4-maybePad)
		}
	}

	output, err := base64.URLEncoding.DecodeString(input)
	if err != nil {
		l.RaiseError("not a valid base64 url string: %v", err.Error())
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

func (n *NakamaModule) base16Decode(l *lua.LState) int {
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

func (n *NakamaModule) aes128Encrypt(l *lua.LState) int {
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

func (n *NakamaModule) aes128Decrypt(l *lua.LState) int {
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

func (n *NakamaModule) hmacSHA256Hash(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects input string")
		return 0
	}
	key := l.CheckString(2)
	if key == "" {
		l.ArgError(2, "expects key string")
		return 0
	}

	mac := hmac.New(sha256.New, []byte(key))
	_, err := mac.Write([]byte(input))
	if err != nil {
		l.RaiseError("error creating hash: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(mac.Sum(nil)))
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

	dbUserID, dbUsername, created, err := AuthenticateCustom(n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
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

	dbUserID, dbUsername, created, err := AuthenticateDevice(n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
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
		l.ArgError(2, "expects password to be valid, must be longer than 8 characters")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(3, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(3, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(3, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(4, true)

	cleanEmail := strings.ToLower(email)

	dbUserID, dbUsername, created, err := AuthenticateEmail(n.logger, n.db, cleanEmail, password, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *NakamaModule) authenticateFacebook(l *lua.LState) int {
	// Parse access token.
	token := l.CheckString(1)
	if token == "" {
		l.ArgError(1, "expects access token string")
		return 0
	}

	// Parse import friends flag, if any.
	importFriends := l.OptBool(2, true)

	// Parse username, if any.
	username := l.OptString(3, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(3, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(3, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(4, true)

	dbUserID, dbUsername, created, err := AuthenticateFacebook(n.logger, n.db, n.socialClient, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	// Import friends if requested.
	if importFriends {
		importFacebookFriends(n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *NakamaModule) authenticateGameCenter(l *lua.LState) int {
	// Parse authentication credentials.
	playerID := l.CheckString(1)
	if playerID == "" {
		l.ArgError(1, "expects player ID string")
		return 0
	}
	bundleID := l.CheckString(2)
	if bundleID == "" {
		l.ArgError(2, "expects bundle ID string")
		return 0
	}
	timestamp := l.CheckInt64(3)
	if timestamp == 0 {
		l.ArgError(3, "expects timestamp value")
		return 0
	}
	salt := l.CheckString(4)
	if salt == "" {
		l.ArgError(4, "expects salt string")
		return 0
	}
	signature := l.CheckString(5)
	if signature == "" {
		l.ArgError(5, "expects signature string")
		return 0
	}
	publicKeyUrl := l.CheckString(6)
	if publicKeyUrl == "" {
		l.ArgError(6, "expects public key URL string")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(7, "")
	if username == "" {
		username = generateUsername()
	} else if invalidCharsRegex.MatchString(username) {
		l.ArgError(7, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(7, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(8, true)

	dbUserID, dbUsername, created, err := AuthenticateGameCenter(n.logger, n.db, n.socialClient, playerID, bundleID, timestamp, salt, signature, publicKeyUrl, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *NakamaModule) authenticateGoogle(l *lua.LState) int {
	// Parse ID token.
	token := l.CheckString(1)
	if token == "" {
		l.ArgError(1, "expects ID token string")
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

	dbUserID, dbUsername, created, err := AuthenticateGoogle(n.logger, n.db, n.socialClient, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *NakamaModule) authenticateSteam(l *lua.LState) int {
	if n.config.GetSocial().Steam.PublisherKey == "" || n.config.GetSocial().Steam.AppID == 0 {
		l.RaiseError("Steam authentication is not configured")
		return 0
	}

	// Parse token.
	token := l.CheckString(1)
	if token == "" {
		l.ArgError(1, "expects token string")
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

	dbUserID, dbUsername, created, err := AuthenticateSteam(n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
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
		exp = time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpirySec) * time.Second).Unix()
	}

	token := generateTokenWithExpiry(n.config, userIDString, username, exp)

	l.Push(lua.LString(token))
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
	if streamTable == nil {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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
		metaTable := l.CreateTable(4, 4)
		metaTable.RawSetString("hidden", lua.LBool(meta.Hidden))
		metaTable.RawSetString("persistence", lua.LBool(meta.Persistence))
		metaTable.RawSetString("username", lua.LString(meta.Username))
		metaTable.RawSetString("status", lua.LString(meta.Status))
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
	if streamTable == nil {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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
	session := n.sessionRegistry.Get(sessionID)
	if session == nil {
		l.ArgError(2, "session id does not exist")
		return 0
	}

	success, newlyTracked := n.tracker.Track(sessionID, stream, userID, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
	}, false)
	if !success {
		l.RaiseError("tracker rejected new presence, session is closing")
		return 0
	}

	l.Push(lua.LBool(newlyTracked))
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
	if streamTable == nil {
		l.ArgError(3, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := ""
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = "stream mode must be a number"
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = "stream subject must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subject must be a valid identifier"
				return
			}
			stream.Subject = sid
		case "descriptor":
			if v.Type() != lua.LTString {
				conversionError = "stream descriptor must be a string"
				return
			}
			did, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream descriptor must be a valid identifier"
				return
			}
			stream.Subject = did
		case "label":
			if v.Type() != lua.LTString {
				conversionError = "stream label must be a string"
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

func (n *NakamaModule) matchCreate(l *lua.LState) int {
	// Parse the name of the Lua module that should handle the match.
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects module name")
		return 0
	}

	params := ConvertLuaValue(l.Get(2))

	// Start the match.
	mh, err := n.matchRegistry.NewMatch(name, params)
	if err != nil {
		l.RaiseError("error creating match: %v", err.Error())
		return 0
	}

	// Return the match ID in a form that can be directly sent to clients.
	l.Push(lua.LString(mh.IDStr))
	return 1
}

func (n *NakamaModule) matchList(l *lua.LState) int {
	// Parse limit.
	limit := l.OptInt(1, 1)

	// Parse authoritative flag.
	var authoritative *wrappers.BoolValue
	if v := l.Get(2); v.Type() != lua.LTNil {
		if v.Type() != lua.LTBool {
			l.ArgError(2, "expects authoritative true/false or nil")
			return 0
		}
		authoritative = &wrappers.BoolValue{Value: lua.LVAsBool(v)}
	}

	// Parse label filter.
	var label *wrappers.StringValue
	if v := l.Get(3); v.Type() != lua.LTNil {
		if v.Type() != lua.LTString {
			l.ArgError(3, "expects label string or nil")
			return 0
		}
		label = &wrappers.StringValue{Value: lua.LVAsString(v)}
	}

	// Parse minimum size filter.
	var minSize *wrappers.Int32Value
	if v := l.Get(4); v.Type() != lua.LTNil {
		if v.Type() != lua.LTNumber {
			l.ArgError(4, "expects minimum size number or nil")
			return 0
		}
		minSize = &wrappers.Int32Value{Value: int32(lua.LVAsNumber(v))}
	}

	// Parse maximum size filter.
	var maxSize *wrappers.Int32Value
	if v := l.Get(5); v.Type() != lua.LTNil {
		if v.Type() != lua.LTNumber {
			l.ArgError(5, "expects maximum size number or nil")
			return 0
		}
		maxSize = &wrappers.Int32Value{Value: int32(lua.LVAsNumber(v))}
	}

	results := n.matchRegistry.ListMatches(limit, authoritative, label, minSize, maxSize)

	s := len(results)
	matches := l.CreateTable(s, s)
	for i, result := range results {
		match := l.CreateTable(4, 4)
		match.RawSetString("match_id", lua.LString(result.MatchId))
		match.RawSetString("authoritative", lua.LBool(result.Authoritative))
		if result.Label == nil {
			match.RawSetString("label", lua.LNil)
		} else {
			match.RawSetString("label", lua.LString(result.Label.Value))
		}
		match.RawSetString("size", lua.LNumber(result.Size))
		matches.RawSetInt(i+1, match)
	}
	l.Push(matches)
	return 1
}

func (n *NakamaModule) notificationSend(l *lua.LState) int {
	u := l.CheckString(1)
	userID, err := uuid.FromString(u)
	if err != nil {
		l.ArgError(1, "expects user_id to be a valid UUID")
		return 0
	}

	subject := l.CheckString(2)
	if subject == "" {
		l.ArgError(2, "expects subject to be a non-empty string")
		return 0
	}

	contentMap := ConvertLuaTable(l.CheckTable(3))
	contentBytes, err := json.Marshal(contentMap)
	if err != nil {
		l.ArgError(1, fmt.Sprintf("failed to convert content: %s", err.Error()))
		return 0
	}
	content := string(contentBytes)

	code := l.CheckInt(4)
	if code <= 0 {
		l.ArgError(4, "expects code to number above 0")
		return 0
	}

	s := l.OptString(5, "")
	senderID := uuid.Nil.String()
	if s != "" {
		suid, err := uuid.FromString(s)
		if err != nil {
			l.ArgError(5, "expects sender)id to either be not set, empty string or a valid UUID")
			return 0
		}
		senderID = suid.String()
	}

	persistent := l.OptBool(6, false)

	nots := []*api.Notification{{
		Id:         base64.RawURLEncoding.EncodeToString(uuid.NewV4().Bytes()),
		Subject:    subject,
		Content:    content,
		Code:       int32(code),
		SenderId:   senderID,
		Persistent: persistent,
		CreateTime: &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()},
	}}
	notifications := map[uuid.UUID][]*api.Notification{
		userID: nots,
	}

	if err := NotificationSend(n.logger, n.db, n.router, notifications); err != nil {
		l.RaiseError(fmt.Sprintf("failed to send notifications: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) notificationsSend(l *lua.LState) int {
	notificationsTable := l.CheckTable(1)
	if notificationsTable == nil {
		l.ArgError(1, "expects a valid set of notifications")
		return 0
	}

	conversionError := false
	notifications := make(map[uuid.UUID][]*api.Notification)
	notificationsTable.ForEach(func(i lua.LValue, g lua.LValue) {
		notificationTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of notifications")
			return
		}

		notification := &api.Notification{}
		userID := uuid.Nil
		senderID := uuid.Nil
		notificationTable.ForEach(func(k lua.LValue, v lua.LValue) {
			switch k.String() {
			case "persistent":
				if v.Type() != lua.LTBool {
					conversionError = true
					l.ArgError(1, "expects persistent to be boolean")
					return
				}
				notification.Persistent = lua.LVAsBool(v)
			case "subject":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects subject to be string")
					return
				}
				notification.Subject = v.String()
			case "content":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects content to be a table")
					return
				}

				contentMap := ConvertLuaTable(v.(*lua.LTable))
				contentBytes, err := json.Marshal(contentMap)
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("failed to convert content: %s", err.Error()))
					return
				}

				notification.Content = string(contentBytes)
			case "code":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects code to be number")
					return
				}
				number := int(lua.LVAsNumber(v))
				if number <= 0 {
					l.ArgError(1, "expects code to number above 0")
					return
				}
				notification.Code = int32(number)
			case "user_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects user_id to be string")
					return
				}
				u := v.String()
				if u == "" {
					l.ArgError(1, "expects user_id to be a valid UUID")
					return
				}
				uid, err := uuid.FromString(u)
				if err != nil {
					l.ArgError(1, "expects user_id to be a valid UUID")
					return
				}
				userID = uid
			case "sender_id":
				if v.Type() == lua.LTNil {
					return
				}
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects sender_id to be string")
					return
				}
				u := v.String()
				if u == "" {
					l.ArgError(1, "expects sender_id to be a valid UUID")
					return
				}
				sid, err := uuid.FromString(u)
				if err != nil {
					l.ArgError(1, "expects user_id to be a valid UUID")
					return
				}
				senderID = sid
			}
		})

		if notification.Subject == "" {
			l.ArgError(1, "expects subject to be non-empty")
			return
		} else if len(notification.Content) == 0 {
			l.ArgError(1, "expects content to be a valid JSON")
			return
		} else if uuid.Equal(uuid.Nil, userID) {
			l.ArgError(1, "expects user_id to be a valid UUID")
			return
		} else if notification.Code == 0 {
			l.ArgError(1, "expects code to number above 0")
			return
		}

		notification.Id = uuid.NewV4().String()
		notification.CreateTime = &timestamp.Timestamp{Seconds: time.Now().UTC().Unix()}
		notification.SenderId = senderID.String()

		no := notifications[userID]
		if no == nil {
			no = make([]*api.Notification, 0)
		}
		no = append(no, notification)
		notifications[userID] = no
	})

	if conversionError {
		return 0
	}

	if err := NotificationSend(n.logger, n.db, n.router, notifications); err != nil {
		l.RaiseError(fmt.Sprintf("failed to send notifications: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) walletWrite(l *lua.LState) int {
	uid := l.CheckString(1)
	if uid == "" {
		l.ArgError(1, "expects a valid user ID")
		return 0
	}

	userID, err := uuid.FromString(uid)
	if err != nil {
		l.ArgError(1, "expects a valid user ID")
		return 0
	}

	walletTable := l.CheckTable(2)
	if walletTable == nil {
		l.ArgError(2, "expects a table as wallet value")
		return 0
	}

	walletMap := ConvertLuaTable(walletTable)
	walletBytes, err := json.Marshal(walletMap)
	if err != nil {
		l.ArgError(1, fmt.Sprintf("failed to convert content: %s", err.Error()))
		return 0
	}
	wallet := string(walletBytes)

	if err = UpdateWallet(n.db, n.logger, userID, wallet); err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet: %s", err.Error()))
	}

	return 0
}

func (n *NakamaModule) storageList(l *lua.LState) int {
	userIDString := l.OptString(1, "")
	collection := l.OptString(2, "")
	limit := l.CheckInt(3)
	cursor := l.OptString(4, "")

	userID := uuid.Nil
	if userIDString != "" {
		uid, err := uuid.FromString(userIDString)
		if err != nil {
			l.ArgError(1, "expects empty or a valid user ID")
		}
		userID = uid
	}

	objectList, _, err := StorageListObjects(n.logger, n.db, uuid.Nil, userID, collection, limit, cursor)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list storage objects: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, v := range objectList.GetObjects() {
		valueMap := map[string]interface{}{
			"collection":       v.Collection,
			"key":              v.Key,
			"user_id":          v.UserId,
			"value":            v.Value,
			"version":          v.Version,
			"permission_read":  v.PermissionRead,
			"permission_write": v.PermissionWrite,
			"create_time":      v.CreateTime,
			"update_time":      v.UpdateTime,
		}

		lt := ConvertMap(l, valueMap)
		lt.RawSetString("value", ConvertMap(l, valueMap))
		lv.RawSetInt(i+1, lt)
	}
	l.Push(lv)

	if objectList.GetCursor() != "" {
		l.Push(lua.LString(objectList.GetCursor()))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *NakamaModule) storageRead(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil || keysTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of keys")
		return 0
	}
	keysRaw, ok := ConvertLuaValue(keysTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	keyMap := make([]map[string]interface{}, 0)
	for _, d := range keysRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of data")
			return 0
		} else {
			keyMap = append(keyMap, m)
		}
	}

	objectIDs := make([]*api.ReadStorageObjectId, len(keyMap))
	idx := 0
	for i, k := range keyMap {
		var collection string
		if c, ok := k["collection"]; !ok {
			l.ArgError(i, "expects a collection in each object ID")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(i, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var key string
		if r, ok := k["key"]; !ok {
			l.ArgError(i, "expects a key in each object ID")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(i, "key must be a string")
				return 0
			} else {
				key = rs
			}
		}
		var userID uuid.UUID
		if u, ok := k["user_id"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(i, "expects valid user IDs in each object ID, when provided")
				return 0
			} else {
				uid, err := uuid.FromString(us)
				if err != nil {
					l.ArgError(i, "expects valid user IDs in each object ID, when provided")
					return 0
				}
				userID = uid
			}
		}

		objectIDs[idx] = &api.ReadStorageObjectId{
			Collection: collection,
			Key:        key,
			UserId:     userID.String(),
		}
		idx++
	}

	objects, err := StorageReadObjects(n.logger, n.db, uuid.Nil, objectIDs)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to read storage objects: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, v := range objects.GetObjects() {
		valueMap := map[string]interface{}{
			"collection":       v.GetCollection(),
			"key":              v.GetKey(),
			"user_id":          v.GetUserId(),
			"value":            v.GetValue(),
			"version":          v.GetVersion(),
			"permission_read":  v.GetPermissionRead(),
			"permission_write": v.GetPermissionWrite(),
			"create_time":      v.GetCreateTime(),
			"update_time":      v.GetUpdateTime(),
		}

		lt := ConvertMap(l, valueMap)
		lt.RawSetString("value", ConvertMap(l, valueMap))
		lv.RawSetInt(i+1, lt)
	}
	l.Push(lv)
	return 1
}

func (n *NakamaModule) storageWrite(l *lua.LState) int {
	dataTable := l.CheckTable(1)
	if dataTable == nil || dataTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	dataRaw, ok := ConvertLuaValue(dataTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}
	dataMap := make([]map[string]interface{}, 0)
	for _, d := range dataRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of data")
			return 0
		} else {
			dataMap = append(dataMap, m)
		}
	}

	data := make(map[uuid.UUID][]*api.WriteStorageObject, len(dataMap))
	for i, k := range dataMap {
		var collection string
		if c, ok := k["collection"]; !ok {
			l.ArgError(i, "expects a collection in each object")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(i, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var key string
		if r, ok := k["key"]; !ok {
			l.ArgError(i, "expects a key in each object")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(i, "key must be a string")
				return 0
			} else {
				key = rs
			}
		}
		var value []byte
		if v, ok := k["value"]; !ok {
			l.ArgError(i, "expects a value in each key")
			return 0
		} else {
			if vs, ok := v.(map[string]interface{}); !ok {
				l.ArgError(i, "value must be a table")
				return 0
			} else {
				dataJson, err := json.Marshal(vs)
				if err != nil {
					l.RaiseError("could not convert value to JSON: %v", err.Error())
					return 0
				}
				value = dataJson
			}
		}
		var userID uuid.UUID
		if u, ok := k["user_id"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(i, "expects valid user IDs in each object, when provided")
				return 0
			} else {
				uid, err := uuid.FromString(us)
				if err != nil {
					l.ArgError(i, "expects valid user IDs in each object, when provided")
					return 0
				}
				userID = uid
			}
		}
		var version string
		if v, ok := k["version"]; ok {
			if vs, ok := v.(string); !ok {
				l.ArgError(1, "version must be a string")
				return 0
			} else {
				version = vs
			}
		}
		readPermission := int32(1)
		if r, ok := k["permission_read"]; ok {
			if rf, ok := r.(float64); !ok {
				l.ArgError(i, "permission read must be a number")
				return 0
			} else {
				readPermission = int32(rf)
			}
		}
		writePermission := int32(1)
		if w, ok := k["permission_write"]; ok {
			if wf, ok := w.(float64); !ok {
				l.ArgError(i, "permission write must be a number")
				return 0
			} else {
				writePermission = int32(wf)
			}
		}

		objects := data[userID]
		if objects == nil {
			objects = make([]*api.WriteStorageObject, 0)
		}

		data[userID] = append(objects, &api.WriteStorageObject{
			Collection:      collection,
			Key:             key,
			Value:           string(value),
			Version:         version,
			PermissionRead:  &wrappers.Int32Value{Value: readPermission},
			PermissionWrite: &wrappers.Int32Value{Value: writePermission},
		})
	}

	acks, _, err := StorageWriteObjects(n.logger, n.db, true, data)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to write storage objects: %s", err.Error()))
		return 0
	}

	lv := l.NewTable()
	for i, k := range acks.Acks {
		valueMap := map[string]interface{}{
			"collection": k.GetCollection(),
			"key":        k.GetKey(),
			"user_id":    k.GetUserId(),
			"version":    k.GetVersion(),
		}

		lt := ConvertMap(l, valueMap)
		lt.RawSetString("value", ConvertMap(l, valueMap))
		lv.RawSetInt(i+1, lt)
	}
	l.Push(lv)
	return 1
}

func (n *NakamaModule) storageDelete(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil || keysTable.Len() == 0 {
		l.ArgError(1, "expects a valid set of object IDs")
		return 0
	}
	keysRaw, ok := ConvertLuaValue(keysTable).([]interface{})
	if !ok {
		l.ArgError(1, "expects a valid set of object IDs")
		return 0
	}
	keyMap := make([]map[string]interface{}, 0)
	for _, d := range keysRaw {
		if m, ok := d.(map[string]interface{}); !ok {
			l.ArgError(1, "expects a valid set of object IDs")
			return 0
		} else {
			keyMap = append(keyMap, m)
		}
	}

	ids := make(map[uuid.UUID][]*api.DeleteStorageObjectId, len(keyMap))
	for i, k := range keyMap {
		var collection string
		if c, ok := k["collection"]; !ok {
			l.ArgError(i, "expects a collection in each object ID")
			return 0
		} else {
			if cs, ok := c.(string); !ok {
				l.ArgError(i, "collection must be a string")
				return 0
			} else {
				collection = cs
			}
		}
		var key string
		if r, ok := k["key"]; !ok {
			l.ArgError(i, "expects a record in each object ID")
			return 0
		} else {
			if rs, ok := r.(string); !ok {
				l.ArgError(i, "key must be a string")
				return 0
			} else {
				key = rs
			}
		}
		var userID uuid.UUID
		if u, ok := k["user_id"]; ok {
			if us, ok := u.(string); !ok {
				l.ArgError(i, "expects valid user IDs in each object iD, when provided")
				return 0
			} else {
				uid, err := uuid.FromString(us)
				if err != nil {
					l.ArgError(i, "expects valid user IDs in each object ID, when provided")
					return 0
				}
				userID = uid
			}
		}
		var version string
		if v, ok := k["version"]; ok {
			if vs, ok := v.(string); !ok {
				l.ArgError(i, "version must be a string")
				return 0
			} else {
				version = vs
			}
		}

		objectIDs := ids[userID]
		if objectIDs == nil {
			objectIDs = make([]*api.DeleteStorageObjectId, 0)
		}

		ids[userID] = append(objectIDs, &api.DeleteStorageObjectId{
			Collection: collection,
			Key:        key,
			Version:    version,
		})
	}

	if _, err := StorageDeleteObjects(n.logger, n.db, true, ids); err != nil {
		l.RaiseError(fmt.Sprintf("failed to remove storage: %s", err.Error()))
	}

	return 0
}
