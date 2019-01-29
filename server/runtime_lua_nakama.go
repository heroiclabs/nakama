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
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang/protobuf/jsonpb"

	"github.com/gofrs/uuid"
	"github.com/golang/protobuf/ptypes/timestamp"
	"github.com/golang/protobuf/ptypes/wrappers"
	"github.com/gorhill/cronexpr"
	"github.com/heroiclabs/nakama/api"
	"github.com/heroiclabs/nakama/rtapi"
	"github.com/heroiclabs/nakama/social"
	"github.com/yuin/gopher-lua"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
)

type RuntimeLuaNakamaModule struct {
	logger               *zap.Logger
	db                   *sql.DB
	jsonpbUnmarshaler    *jsonpb.Unmarshaler
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	rankCache            LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	sessionRegistry      SessionRegistry
	matchRegistry        MatchRegistry
	tracker              Tracker
	router               MessageRouter
	once                 *sync.Once
	localCache           *RuntimeLuaLocalCache
	registerCallbackFn   func(RuntimeExecutionMode, string, *lua.LFunction)
	announceCallbackFn   func(RuntimeExecutionMode, string)
	client               *http.Client

	node          string
	matchCreateFn RuntimeMatchCreateFunction
}

func NewRuntimeLuaNakamaModule(logger *zap.Logger, db *sql.DB, jsonpbUnmarshaler *jsonpb.Unmarshaler, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, matchRegistry MatchRegistry, tracker Tracker, router MessageRouter, once *sync.Once, localCache *RuntimeLuaLocalCache, matchCreateFn RuntimeMatchCreateFunction, registerCallbackFn func(RuntimeExecutionMode, string, *lua.LFunction), announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeLuaNakamaModule {
	return &RuntimeLuaNakamaModule{
		logger:               logger,
		db:                   db,
		jsonpbUnmarshaler:    jsonpbUnmarshaler,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		rankCache:            rankCache,
		leaderboardScheduler: leaderboardScheduler,
		sessionRegistry:      sessionRegistry,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		router:               router,
		once:                 once,
		localCache:           localCache,
		registerCallbackFn:   registerCallbackFn,
		announceCallbackFn:   announceCallbackFn,
		client: &http.Client{
			Timeout: 5 * time.Second,
		},

		node:          config.GetName(),
		matchCreateFn: matchCreateFn,
	}
}

func (n *RuntimeLuaNakamaModule) Loader(l *lua.LState) int {
	functions := map[string]lua.LGFunction{
		"register_rpc":                n.registerRPC,
		"register_req_before":         n.registerReqBefore,
		"register_req_after":          n.registerReqAfter,
		"register_rt_before":          n.registerRTBefore,
		"register_rt_after":           n.registerRTAfter,
		"register_matchmaker_matched": n.registerMatchmakerMatched,
		"register_tournament_end":     n.registerTournamentEnd,
		"register_tournament_reset":   n.registerTournamentReset,
		"register_leaderboard_reset":  n.registerLeaderboardReset,
		"run_once":                    n.runOnce,
		"localcache_get":              n.localcacheGet,
		"localcache_put":              n.localcachePut,
		"localcache_delete":           n.localcacheDelete,
		"time":                        n.time,
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
		"aes256_encrypt":              n.aes256Encrypt,
		"aes256_decrypt":              n.aes256Decrypt,
		"md5_hash":                    n.md5Hash,
		"sha256_hash":                 n.sha256Hash,
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
		"account_get_id":              n.accountGetId,
		"accounts_get_id":             n.accountsGetId,
		"account_update_id":           n.accountUpdateId,
		"users_get_id":                n.usersGetId,
		"users_get_username":          n.usersGetUsername,
		"users_ban_id":                n.usersBanId,
		"users_unban_id":              n.usersUnbanId,
		"stream_user_list":            n.streamUserList,
		"stream_user_get":             n.streamUserGet,
		"stream_user_join":            n.streamUserJoin,
		"stream_user_update":          n.streamUserUpdate,
		"stream_user_leave":           n.streamUserLeave,
		"stream_count":                n.streamCount,
		"stream_close":                n.streamClose,
		"stream_send":                 n.streamSend,
		"stream_send_raw":             n.streamSendRaw,
		"session_disconnect":          n.sessionDisconnect,
		"match_create":                n.matchCreate,
		"match_list":                  n.matchList,
		"notification_send":           n.notificationSend,
		"notifications_send":          n.notificationsSend,
		"wallet_update":               n.walletUpdate,
		"wallets_update":              n.walletsUpdate,
		"wallet_ledger_update":        n.walletLedgerUpdate,
		"wallet_ledger_list":          n.walletLedgerList,
		"storage_list":                n.storageList,
		"storage_read":                n.storageRead,
		"storage_write":               n.storageWrite,
		"storage_delete":              n.storageDelete,
		"leaderboard_create":          n.leaderboardCreate,
		"leaderboard_delete":          n.leaderboardDelete,
		"leaderboard_records_list":    n.leaderboardRecordsList,
		"leaderboard_record_write":    n.leaderboardRecordWrite,
		"leaderboard_record_delete":   n.leaderboardRecordDelete,
		"tournament_create":           n.tournamentCreate,
		"tournament_delete":           n.tournamentDelete,
		"tournament_add_attempt":      n.tournamentAddAttempt,
		"tournament_join":             n.tournamentJoin,
		"tournament_list":             n.tournamentList,
		"tournament_record_write":     n.tournamentRecordWrite,
		"tournament_records_haystack": n.tournamentRecordsHaystack,
		"groups_get_id":               n.groupsGetId,
		"group_create":                n.groupCreate,
		"group_update":                n.groupUpdate,
		"group_delete":                n.groupDelete,
		"group_users_list":            n.groupUsersList,
		"user_groups_list":            n.userGroupsList,
	}
	mod := l.SetFuncs(l.CreateTable(0, len(functions)), functions)

	l.Push(mod)
	return 1
}

func (n *RuntimeLuaNakamaModule) registerRPC(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects rpc id")
		return 0
	}

	id = strings.ToLower(id)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeRPC, id, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeRPC, id)
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerReqBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects method name")
		return 0
	}

	id = strings.ToLower(API_PREFIX + id)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeBefore, id, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeBefore, id)
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerReqAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects method name")
		return 0
	}

	id = strings.ToLower(API_PREFIX + id)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeAfter, id, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeAfter, id)
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerRTBefore(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	id = strings.ToLower(RTAPI_PREFIX + id)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeBefore, id, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeBefore, id)
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerRTAfter(l *lua.LState) int {
	fn := l.CheckFunction(1)
	id := l.CheckString(2)

	if id == "" {
		l.ArgError(2, "expects message name")
		return 0
	}

	id = strings.ToLower(RTAPI_PREFIX + id)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeAfter, id, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeAfter, id)
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerMatchmakerMatched(l *lua.LState) int {
	fn := l.CheckFunction(1)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeMatchmaker, "", fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeMatchmaker, "")
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerTournamentEnd(l *lua.LState) int {
	fn := l.CheckFunction(1)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeTournamentEnd, "", fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeTournamentEnd, "")
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerTournamentReset(l *lua.LState) int {
	fn := l.CheckFunction(1)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeTournamentReset, "", fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeTournamentReset, "")
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) registerLeaderboardReset(l *lua.LState) int {
	fn := l.CheckFunction(1)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeLeaderboardReset, "", fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeLeaderboardReset, "")
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) runOnce(l *lua.LState) int {
	n.once.Do(func() {
		fn := l.CheckFunction(1)
		if fn == nil {
			l.ArgError(1, "expects a function")
			return
		}

		ctx := NewRuntimeLuaContext(l, RuntimeLuaConvertMapString(l, n.config.GetRuntime().Environment), RuntimeExecutionModeRunOnce, nil, 0, "", "", "", "", "")

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

func (n *RuntimeLuaNakamaModule) localcacheGet(l *lua.LState) int {
	key := l.CheckString(1)
	if key == "" {
		l.ArgError(1, "expects key string")
		return 0
	}

	defaultValue := l.Get(2)
	if t := defaultValue.Type(); t != lua.LTNil && t != lua.LTString {
		l.ArgError(2, "expects default value string or nil")
		return 0
	}

	value, found := n.localCache.Get(key)

	if found {
		l.Push(lua.LString(value))
	} else {
		l.Push(defaultValue)
	}
	return 1
}

func (n *RuntimeLuaNakamaModule) localcachePut(l *lua.LState) int {
	key := l.CheckString(1)
	if key == "" {
		l.ArgError(1, "expects key string")
		return 0
	}

	value := l.CheckString(2)
	if value == "" {
		l.ArgError(2, "expects value string")
		return 0
	}

	n.localCache.Put(key, value)

	return 0
}

func (n *RuntimeLuaNakamaModule) localcacheDelete(l *lua.LState) int {
	key := l.CheckString(1)
	if key == "" {
		l.ArgError(1, "expects key string")
		return 0
	}

	n.localCache.Delete(key)

	return 0
}

func (n *RuntimeLuaNakamaModule) time(l *lua.LState) int {
	if l.GetTop() == 0 {
		l.Push(lua.LNumber(time.Now().UTC().UnixNano() / int64(time.Millisecond)))
	} else {
		tbl := l.CheckTable(1)
		msec := getIntField(l, tbl, "msec", 0)
		sec := getIntField(l, tbl, "sec", 0)
		min := getIntField(l, tbl, "min", 0)
		hour := getIntField(l, tbl, "hour", 12)
		day := getIntField(l, tbl, "day", -1)
		month := getIntField(l, tbl, "month", -1)
		year := getIntField(l, tbl, "year", -1)
		isdst := getBoolField(l, tbl, "isdst", false)
		t := time.Date(year, time.Month(month), day, hour, min, sec, msec*int(time.Millisecond), time.UTC)
		// TODO dst
		if false {
			print(isdst)
		}
		l.Push(lua.LNumber(t.UTC().UnixNano() / int64(time.Millisecond)))
	}
	return 1
}

func (n *RuntimeLuaNakamaModule) cronNext(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) sqlExec(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, nil)
	var params []interface{}
	if paramsTable != nil && paramsTable.Len() != 0 {
		var ok bool
		params, ok = RuntimeLuaConvertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	var result sql.Result
	var err error
	err = ExecuteRetryable(func() error {
		result, err = n.db.ExecContext(l.Context(), query, params...)
		return err
	})
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

func (n *RuntimeLuaNakamaModule) sqlQuery(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	paramsTable := l.OptTable(2, nil)
	var params []interface{}
	if paramsTable != nil && paramsTable.Len() != 0 {
		var ok bool
		params, ok = RuntimeLuaConvertLuaValue(paramsTable).([]interface{})
		if !ok {
			l.ArgError(2, "expects a list of params as a table")
			return 0
		}
	}

	var rows *sql.Rows
	var err error
	err = ExecuteRetryable(func() error {
		rows, err = n.db.QueryContext(l.Context(), query, params...)
		return err
	})
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

	rt := l.CreateTable(len(resultRows), 0)
	for i, r := range resultRows {
		rowTable := l.CreateTable(0, resultColumnCount)
		for j, col := range resultColumns {
			rowTable.RawSetString(col, RuntimeLuaConvertValue(l, r[j]))
		}
		rt.RawSetInt(i+1, rowTable)
	}
	l.Push(rt)
	return 1
}

func (n *RuntimeLuaNakamaModule) uuidV4(l *lua.LState) int {
	l.Push(lua.LString(uuid.Must(uuid.NewV4()).String()))
	return 1
}

func (n *RuntimeLuaNakamaModule) uuidBytesToString(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) uuidStringToBytes(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) httpRequest(l *lua.LState) int {
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

	// Set a custom timeout if one is provided, or use the default.
	timeoutMs := l.OptInt64(5, 5000)
	n.client.Timeout = time.Duration(timeoutMs) * time.Millisecond

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
	httpHeaders := RuntimeLuaConvertLuaTable(headers)
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
	l.Push(RuntimeLuaConvertMap(l, responseHeaders))
	l.Push(lua.LString(string(responseBody)))
	return 3
}

func (n *RuntimeLuaNakamaModule) jsonEncode(l *lua.LState) int {
	value := l.Get(1)
	if value == nil {
		l.ArgError(1, "expects a non-nil value to encode")
		return 0
	}

	jsonData := RuntimeLuaConvertLuaValue(value)
	jsonBytes, err := json.Marshal(jsonData)
	if err != nil {
		l.RaiseError("error encoding to JSON: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(string(jsonBytes)))
	return 1
}

func (n *RuntimeLuaNakamaModule) jsonDecode(l *lua.LState) int {
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

	l.Push(RuntimeLuaConvertValue(l, jsonData))
	return 1
}

func (n *RuntimeLuaNakamaModule) base64Encode(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) base64Decode(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) base64URLEncode(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) base64URLDecode(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) base16Encode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	output := hex.EncodeToString([]byte(input))
	l.Push(lua.LString(output))
	return 1
}

func (n *RuntimeLuaNakamaModule) base16Decode(l *lua.LState) int {
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

func aesEncrypt(l *lua.LState, keySize int) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}
	key := l.CheckString(2)
	if len(key) != keySize {
		l.ArgError(2, fmt.Sprintf("expects key %v bytes long", keySize))
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

func aesDecrypt(l *lua.LState, keySize int) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}
	key := l.CheckString(2)
	if len(key) != keySize {
		l.ArgError(2, fmt.Sprintf("expects key %v bytes long", keySize))
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

func (n *RuntimeLuaNakamaModule) aes128Encrypt(l *lua.LState) int {
	return aesEncrypt(l, 16)
}

func (n *RuntimeLuaNakamaModule) aes128Decrypt(l *lua.LState) int {
	return aesDecrypt(l, 16)
}

func (n *RuntimeLuaNakamaModule) aes256Encrypt(l *lua.LState) int {
	return aesEncrypt(l, 32)
}

func (n *RuntimeLuaNakamaModule) aes256Decrypt(l *lua.LState) int {
	return aesDecrypt(l, 32)
}

func (n *RuntimeLuaNakamaModule) md5Hash(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects input string")
		return 0
	}

	hash := fmt.Sprintf("%x", md5.Sum([]byte(input)))

	l.Push(lua.LString(hash))
	return 1
}

func (n *RuntimeLuaNakamaModule) sha256Hash(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects input string")
		return 0
	}

	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(input)))

	l.Push(lua.LString(hash))
	return 1
}

func (n *RuntimeLuaNakamaModule) hmacSHA256Hash(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) bcryptHash(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) bcryptCompare(l *lua.LState) int {
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

func (n *RuntimeLuaNakamaModule) authenticateCustom(l *lua.LState) int {
	// Parse ID.
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects id string")
		return 0
	} else if invalidCharsRegex.MatchString(id) {
		l.ArgError(1, "expects id to be valid, no spaces or control characters allowed")
		return 0
	} else if len(id) < 6 || len(id) > 128 {
		l.ArgError(1, "expects id to be valid, must be 6-128 bytes")
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

	dbUserID, dbUsername, created, err := AuthenticateCustom(l.Context(), n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateDevice(l *lua.LState) int {
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

	dbUserID, dbUsername, created, err := AuthenticateDevice(l.Context(), n.logger, n.db, id, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateEmail(l *lua.LState) int {
	var attemptUsernameLogin bool
	// Parse email.
	email := l.OptString(1, "")
	if email == "" {
		attemptUsernameLogin = true
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
		if attemptUsernameLogin {
			l.ArgError(1, "expects username string when email is not supplied")
			return 0
		}

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

	var dbUserID string
	var created bool
	var err error

	if attemptUsernameLogin {
		dbUserID, err = AuthenticateUsername(l.Context(), n.logger, n.db, username, password)
	} else {
		cleanEmail := strings.ToLower(email)

		dbUserID, username, created, err = AuthenticateEmail(l.Context(), n.logger, n.db, cleanEmail, password, username, create)
	}
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(username))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateFacebook(l *lua.LState) int {
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

	dbUserID, dbUsername, created, err := AuthenticateFacebook(l.Context(), n.logger, n.db, n.socialClient, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	// Import friends if requested.
	if importFriends {
		importFacebookFriends(l.Context(), n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateGameCenter(l *lua.LState) int {
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

	dbUserID, dbUsername, created, err := AuthenticateGameCenter(l.Context(), n.logger, n.db, n.socialClient, playerID, bundleID, timestamp, salt, signature, publicKeyUrl, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateGoogle(l *lua.LState) int {
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

	dbUserID, dbUsername, created, err := AuthenticateGoogle(l.Context(), n.logger, n.db, n.socialClient, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateSteam(l *lua.LState) int {
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

	dbUserID, dbUsername, created, err := AuthenticateSteam(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateTokenGenerate(l *lua.LState) int {
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

	token, exp := generateTokenWithExpiry(n.config, userIDString, username, exp)

	l.Push(lua.LString(token))
	l.Push(lua.LNumber(exp))
	return 2
}

func (n *RuntimeLuaNakamaModule) loggerInfo(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Info(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) loggerWarn(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Warn(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) loggerError(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}
	n.logger.Error(message)
	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) accountGetId(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "invalid user id")
		return 0
	}
	userID, err := uuid.FromString(input)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	account, err := GetAccount(l.Context(), n.logger, n.db, n.tracker, userID)
	if err != nil {
		l.RaiseError("failed to get account: %s", err.Error())
		return 0
	}

	accountTable := l.CreateTable(0, 21)
	accountTable.RawSetString("user_id", lua.LString(account.User.Id))
	accountTable.RawSetString("username", lua.LString(account.User.Username))
	accountTable.RawSetString("display_name", lua.LString(account.User.DisplayName))
	accountTable.RawSetString("avatar_url", lua.LString(account.User.AvatarUrl))
	accountTable.RawSetString("lang_tag", lua.LString(account.User.LangTag))
	accountTable.RawSetString("location", lua.LString(account.User.Location))
	accountTable.RawSetString("timezone", lua.LString(account.User.Timezone))
	if account.User.FacebookId != "" {
		accountTable.RawSetString("facebook_id", lua.LString(account.User.FacebookId))
	}
	if account.User.GoogleId != "" {
		accountTable.RawSetString("google_id", lua.LString(account.User.GoogleId))
	}
	if account.User.GamecenterId != "" {
		accountTable.RawSetString("gamecenter_id", lua.LString(account.User.GamecenterId))
	}
	if account.User.SteamId != "" {
		accountTable.RawSetString("steam_id", lua.LString(account.User.SteamId))
	}
	accountTable.RawSetString("online", lua.LBool(account.User.Online))
	accountTable.RawSetString("edge_count", lua.LNumber(account.User.EdgeCount))
	accountTable.RawSetString("create_time", lua.LNumber(account.User.CreateTime.Seconds))
	accountTable.RawSetString("update_time", lua.LNumber(account.User.UpdateTime.Seconds))

	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(account.User.Metadata), &metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
		return 0
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	accountTable.RawSetString("metadata", metadataTable)

	walletMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(account.Wallet), &walletMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert wallet to json: %s", err.Error()))
		return 0
	}
	walletTable := RuntimeLuaConvertMap(l, walletMap)
	accountTable.RawSetString("wallet", walletTable)

	if account.Email != "" {
		accountTable.RawSetString("email", lua.LString(account.Email))
	}
	if len(account.Devices) != 0 {
		devicesTable := l.CreateTable(len(account.Devices), 0)
		for i, device := range account.Devices {
			deviceTable := l.CreateTable(0, 1)
			deviceTable.RawSetString("id", lua.LString(device.Id))
			devicesTable.RawSetInt(i+1, deviceTable)
		}
		accountTable.RawSetString("devices", devicesTable)
	}
	if account.CustomId != "" {
		accountTable.RawSetString("custom_id", lua.LString(account.CustomId))
	}
	if account.VerifyTime != nil {
		accountTable.RawSetString("verify_time", lua.LNumber(account.VerifyTime.Seconds))
	}

	l.Push(accountTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) accountsGetId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	userIDs := make([]string, 0, input.Len())
	var conversionError bool
	input.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}
		if v.Type() != lua.LTString {
			l.ArgError(1, "user id must be a string")
			conversionError = true
			return
		}
		vs := v.String()
		if _, err := uuid.FromString(vs); err != nil {
			l.ArgError(1, "user id must be a valid identifier string")
			conversionError = true
			return
		}
		userIDs = append(userIDs, vs)
	})
	if conversionError {
		return 0
	}

	accounts, err := GetAccounts(l.Context(), n.logger, n.db, n.tracker, userIDs)
	if err != nil {
		l.RaiseError("failed to get accounts: %s", err.Error())
		return 0
	}

	accountsTable := l.CreateTable(len(accounts), 0)
	for i, account := range accounts {
		accountTable := l.CreateTable(0, 21)
		accountTable.RawSetString("user_id", lua.LString(account.User.Id))
		accountTable.RawSetString("username", lua.LString(account.User.Username))
		accountTable.RawSetString("display_name", lua.LString(account.User.DisplayName))
		accountTable.RawSetString("avatar_url", lua.LString(account.User.AvatarUrl))
		accountTable.RawSetString("lang_tag", lua.LString(account.User.LangTag))
		accountTable.RawSetString("location", lua.LString(account.User.Location))
		accountTable.RawSetString("timezone", lua.LString(account.User.Timezone))
		if account.User.FacebookId != "" {
			accountTable.RawSetString("facebook_id", lua.LString(account.User.FacebookId))
		}
		if account.User.GoogleId != "" {
			accountTable.RawSetString("google_id", lua.LString(account.User.GoogleId))
		}
		if account.User.GamecenterId != "" {
			accountTable.RawSetString("gamecenter_id", lua.LString(account.User.GamecenterId))
		}
		if account.User.SteamId != "" {
			accountTable.RawSetString("steam_id", lua.LString(account.User.SteamId))
		}
		accountTable.RawSetString("online", lua.LBool(account.User.Online))
		accountTable.RawSetString("edge_count", lua.LNumber(account.User.EdgeCount))
		accountTable.RawSetString("create_time", lua.LNumber(account.User.CreateTime.Seconds))
		accountTable.RawSetString("update_time", lua.LNumber(account.User.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(account.User.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		accountTable.RawSetString("metadata", metadataTable)

		walletMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(account.Wallet), &walletMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert wallet to json: %s", err.Error()))
			return 0
		}
		walletTable := RuntimeLuaConvertMap(l, walletMap)
		accountTable.RawSetString("wallet", walletTable)

		if account.Email != "" {
			accountTable.RawSetString("email", lua.LString(account.Email))
		}
		if len(account.Devices) != 0 {
			devicesTable := l.CreateTable(len(account.Devices), 0)
			for i, device := range account.Devices {
				deviceTable := l.CreateTable(0, 1)
				deviceTable.RawSetString("id", lua.LString(device.Id))
				devicesTable.RawSetInt(i+1, deviceTable)
			}
			accountTable.RawSetString("devices", devicesTable)
		}
		if account.CustomId != "" {
			accountTable.RawSetString("custom_id", lua.LString(account.CustomId))
		}
		if account.VerifyTime != nil {
			accountTable.RawSetString("verify_time", lua.LNumber(account.VerifyTime.Seconds))
		}

		accountsTable.RawSetInt(i+1, accountTable)
	}

	l.Push(accountsTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) usersGetId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	userIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}
	if len(userIDs) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	userIDStrings := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each user id must be a valid id string")
			return 0
		} else {
			userIDStrings = append(userIDStrings, ids)
		}
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.tracker, userIDStrings, nil, nil)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, u := range users.Users {
		ut := l.CreateTable(0, 16)
		ut.RawSetString("user_id", lua.LString(u.Id))
		ut.RawSetString("username", lua.LString(u.Username))
		ut.RawSetString("display_name", lua.LString(u.DisplayName))
		ut.RawSetString("avatar_url", lua.LString(u.AvatarUrl))
		ut.RawSetString("lang_tag", lua.LString(u.LangTag))
		ut.RawSetString("location", lua.LString(u.Location))
		ut.RawSetString("timezone", lua.LString(u.Timezone))
		if u.FacebookId != "" {
			ut.RawSetString("facebook_id", lua.LString(u.FacebookId))
		}
		if u.GoogleId != "" {
			ut.RawSetString("google_id", lua.LString(u.GoogleId))
		}
		if u.GamecenterId != "" {
			ut.RawSetString("gamecenter_id", lua.LString(u.GamecenterId))
		}
		if u.SteamId != "" {
			ut.RawSetString("steam_id", lua.LString(u.SteamId))
		}
		ut.RawSetString("online", lua.LBool(u.Online))
		ut.RawSetString("edge_count", lua.LNumber(u.EdgeCount))
		ut.RawSetString("create_time", lua.LNumber(u.CreateTime.Seconds))
		ut.RawSetString("update_time", lua.LNumber(u.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		ut.RawSetString("metadata", metadataTable)

		usersTable.RawSetInt(i+1, ut)
	}

	l.Push(usersTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) usersGetUsername(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid username list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	usernames, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid username data")
		return 0
	}
	if len(usernames) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	usernameStrings := make([]string, 0, len(usernames))
	for _, u := range usernames {
		if us, ok := u.(string); !ok || us == "" {
			l.ArgError(1, "each username must be a string")
			return 0
		} else {
			usernameStrings = append(usernameStrings, us)
		}
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.tracker, nil, usernameStrings, nil)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, u := range users.Users {
		ut := l.CreateTable(0, 16)
		ut.RawSetString("user_id", lua.LString(u.Id))
		ut.RawSetString("username", lua.LString(u.Username))
		ut.RawSetString("display_name", lua.LString(u.DisplayName))
		ut.RawSetString("avatar_url", lua.LString(u.AvatarUrl))
		ut.RawSetString("lang_tag", lua.LString(u.LangTag))
		ut.RawSetString("location", lua.LString(u.Location))
		ut.RawSetString("timezone", lua.LString(u.Timezone))
		if u.FacebookId != "" {
			ut.RawSetString("facebook_id", lua.LString(u.FacebookId))
		}
		if u.GoogleId != "" {
			ut.RawSetString("google_id", lua.LString(u.GoogleId))
		}
		if u.GamecenterId != "" {
			ut.RawSetString("gamecenter_id", lua.LString(u.GamecenterId))
		}
		if u.SteamId != "" {
			ut.RawSetString("steam_id", lua.LString(u.SteamId))
		}
		ut.RawSetString("online", lua.LBool(u.Online))
		ut.RawSetString("edge_count", lua.LNumber(u.EdgeCount))
		ut.RawSetString("create_time", lua.LNumber(u.CreateTime.Seconds))
		ut.RawSetString("update_time", lua.LNumber(u.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		ut.RawSetString("metadata", metadataTable)

		usersTable.RawSetInt(i+1, ut)
	}

	l.Push(usersTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) usersBanId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if input.Len() == 0 {
		return 0
	}
	userIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}
	if len(userIDs) == 0 {
		return 0
	}

	// Input individual ID validation.
	userIDStrings := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each user id must be a valid id string")
			return 0
		} else {
			userIDStrings = append(userIDStrings, ids)
		}
	}

	// Ban the user accounts.
	err := BanUsers(l.Context(), n.logger, n.db, userIDStrings)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to ban users: %s", err.Error()))
		return 0
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) usersUnbanId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if input.Len() == 0 {
		return 0
	}
	userIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}
	if len(userIDs) == 0 {
		return 0
	}

	// Input individual ID validation.
	userIDStrings := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each user id must be a valid id string")
			return 0
		} else {
			userIDStrings = append(userIDStrings, ids)
		}
	}

	// Unban the user accounts.
	err := UnbanUsers(l.Context(), n.logger, n.db, userIDStrings)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to unban users: %s", err.Error()))
		return 0
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) streamUserList(l *lua.LState) int {
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
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = "stream subcontext must be a string"
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = "stream subcontext must be a valid identifier"
				return
			}
			stream.Subcontext = sid
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

	// Optional argument to include hidden presences in the list or not, default true.
	includeHidden := l.OptBool(2, true)
	// Optional argument to include not hidden presences in the list or not, default true.
	includeNotHidden := l.OptBool(3, true)

	presences := n.tracker.ListByStream(stream, includeHidden, includeNotHidden)

	presencesTable := l.CreateTable(len(presences), 0)
	for i, p := range presences {
		presenceTable := l.CreateTable(0, 7)
		presenceTable.RawSetString("user_id", lua.LString(p.UserID.String()))
		presenceTable.RawSetString("session_id", lua.LString(p.ID.SessionID.String()))
		presenceTable.RawSetString("node_id", lua.LString(p.ID.Node))
		presenceTable.RawSetString("hidden", lua.LBool(p.Meta.Hidden))
		presenceTable.RawSetString("persistence", lua.LBool(p.Meta.Persistence))
		presenceTable.RawSetString("username", lua.LString(p.Meta.Username))
		presenceTable.RawSetString("status", lua.LString(p.Meta.Status))

		presencesTable.RawSetInt(i+1, presenceTable)
	}

	l.Push(presencesTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) streamUserGet(l *lua.LState) int {
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
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(3, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	meta := n.tracker.GetLocalBySessionIDStreamUserID(sessionID, stream, userID)
	if meta == nil {
		l.Push(lua.LNil)
	} else {
		metaTable := l.CreateTable(0, 4)
		metaTable.RawSetString("hidden", lua.LBool(meta.Hidden))
		metaTable.RawSetString("persistence", lua.LBool(meta.Persistence))
		metaTable.RawSetString("username", lua.LString(meta.Username))
		metaTable.RawSetString("status", lua.LString(meta.Status))
		l.Push(metaTable)
	}
	return 1
}

func (n *RuntimeLuaNakamaModule) streamUserJoin(l *lua.LState) int {
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

	// Parse Node.
	node := l.OptString(3, n.node)

	// Parse input stream identifier.
	streamTable := l.CheckTable(4)
	if streamTable == nil {
		l.ArgError(4, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(4, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	// By default generate presence events.
	hidden := l.OptBool(5, false)
	// By default persistence is enabled, if the stream supports it.
	persistence := l.OptBool(6, true)
	// By default no status is set.
	status := l.OptString(7, "")

	// Look up the session.
	session := n.sessionRegistry.Get(sessionID)
	if session == nil {
		l.ArgError(2, "session id does not exist")
		return 0
	}

	success, newlyTracked := n.tracker.Track(sessionID, stream, userID, node, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	}, false)
	if !success {
		l.RaiseError("tracker rejected new presence, session is closing")
		return 0
	}

	l.Push(lua.LBool(newlyTracked))
	return 1
}

func (n *RuntimeLuaNakamaModule) streamUserUpdate(l *lua.LState) int {
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

	// Parse Node.
	node := l.OptString(3, n.node)

	// Parse input stream identifier.
	streamTable := l.CheckTable(4)
	if streamTable == nil {
		l.ArgError(4, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(4, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	// By default generate presence events.
	hidden := l.OptBool(5, false)
	// By default persistence is enabled, if the stream supports it.
	persistence := l.OptBool(6, true)
	// By default no status is set.
	status := l.OptString(7, "")

	// Look up the session.
	session := n.sessionRegistry.Get(sessionID)
	if session == nil {
		l.ArgError(2, "session id does not exist")
		return 0
	}

	if !n.tracker.Update(sessionID, stream, userID, node, PresenceMeta{
		Format:      session.Format(),
		Hidden:      hidden,
		Persistence: persistence,
		Username:    session.Username(),
		Status:      status,
	}, false) {
		l.RaiseError("tracker rejected updated presence, session is closing")
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) streamUserLeave(l *lua.LState) int {
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

	// Parse Node.
	node := l.OptString(3, n.node)

	// Parse input stream identifier.
	streamTable := l.CheckTable(4)
	if streamTable == nil {
		l.ArgError(4, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(4, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(4, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(4, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	n.tracker.Untrack(sessionID, stream, userID, node)

	return 0
}

func (n *RuntimeLuaNakamaModule) streamCount(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(3, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	count := n.tracker.CountByStream(stream)

	l.Push(lua.LNumber(count))
	return 1
}

func (n *RuntimeLuaNakamaModule) streamClose(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(3, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	n.tracker.UntrackByStream(stream)

	return 0
}

func (n *RuntimeLuaNakamaModule) streamSend(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(3, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	// Grab payload to send, allow empty data.
	data := l.CheckString(2)

	presencesTable := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if presencesTable != nil {
		if ln := presencesTable.Len(); ln != 0 {
			presenceIDs = make([]*PresenceID, 0, ln)
			presencesTable.ForEach(func(k lua.LValue, v lua.LValue) {
				if conversionError {
					return
				}

				presenceTable, ok := v.(*lua.LTable)
				if !ok {
					conversionError = true
					l.ArgError(3, "expects a valid set of presences")
					return
				}

				presenceID := &PresenceID{}
				presenceTable.ForEach(func(k lua.LValue, v lua.LValue) {
					if conversionError {
						return
					}

					switch k.String() {
					case "session_id":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence session id must be a string")
							return
						}
						var err error
						presenceID.SessionID, err = uuid.FromString(v.String())
						if err != nil {
							conversionError = true
							l.ArgError(3, "presence session id must be a valid identifier")
							return
						}
					case "node_id":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence node id must be a string")
							return
						}
						presenceID.Node = v.String()
					}
				})
				if conversionError {
					return
				}

				if presenceID.Node == "" {
					presenceID.Node = n.node
				}

				presenceIDs = append(presenceIDs, presenceID)
			})
		}
	}
	if conversionError {
		return 0
	}

	streamWire := &rtapi.Stream{
		Mode:  int32(stream.Mode),
		Label: stream.Label,
	}
	if stream.Subject != uuid.Nil {
		streamWire.Subject = stream.Subject.String()
	}
	if stream.Subcontext != uuid.Nil {
		streamWire.Subcontext = stream.Subcontext.String()
	}
	msg := &rtapi.Envelope{Message: &rtapi.Envelope_StreamData{StreamData: &rtapi.StreamData{
		Stream: streamWire,
		// No sender.
		Data: data,
	}}}

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, true, stream.Mode, msg)
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) streamSendRaw(l *lua.LState) int {
	// Parse input stream identifier.
	streamTable := l.CheckTable(1)
	if streamTable == nil {
		l.ArgError(1, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	conversionError := false
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(3, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(3, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(3, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	// Parse the envelope.
	envelopeMap := RuntimeLuaConvertLuaTable(l.CheckTable(2))
	envelopeBytes, err := json.Marshal(envelopeMap)
	if err != nil {
		l.ArgError(2, fmt.Sprintf("failed to convert envlope: %s", err.Error()))
		return 0
	}

	msg := &rtapi.Envelope{}
	if err = n.jsonpbUnmarshaler.Unmarshal(bytes.NewReader(envelopeBytes), msg); err != nil {
		l.ArgError(2, fmt.Sprintf("not a valid envlope: %s", err.Error()))
		return 0
	}

	// Validate subset of presences, if any.
	presencesTable := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if presencesTable != nil {
		if ln := presencesTable.Len(); ln != 0 {
			presenceIDs = make([]*PresenceID, 0, ln)
			presencesTable.ForEach(func(k lua.LValue, v lua.LValue) {
				if conversionError {
					return
				}

				presenceTable, ok := v.(*lua.LTable)
				if !ok {
					conversionError = true
					l.ArgError(3, "expects a valid set of presences")
					return
				}

				presenceID := &PresenceID{}
				presenceTable.ForEach(func(k lua.LValue, v lua.LValue) {
					if conversionError {
						return
					}

					switch k.String() {
					case "session_id":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence session id must be a string")
							return
						}
						presenceID.SessionID, err = uuid.FromString(v.String())
						if err != nil {
							conversionError = true
							l.ArgError(3, "presence session id must be a valid identifier")
							return
						}
					case "node_id":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence node id must be a string")
							return
						}
						presenceID.Node = v.String()
					}
				})
				if conversionError {
					return
				}

				if presenceID.Node == "" {
					presenceID.Node = n.node
				}

				presenceIDs = append(presenceIDs, presenceID)
			})
		}
	}
	if conversionError {
		return 0
	}

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, true, stream.Mode, msg)
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) sessionDisconnect(l *lua.LState) int {
	// Parse input Session ID.
	sessionIDString := l.CheckString(1)
	if sessionIDString == "" {
		l.ArgError(1, "expects session id")
		return 0
	}
	sessionID, err := uuid.FromString(sessionIDString)
	if err != nil {
		l.ArgError(1, "expects valid session id")
		return 0
	}

	node := l.OptString(2, n.node)

	if err := n.sessionRegistry.Disconnect(l.Context(), n.logger, sessionID, node); err != nil {
		l.RaiseError(fmt.Sprintf("failed to disconnect: %s", err.Error()))
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) matchCreate(l *lua.LState) int {
	// Parse the name of the Lua module that should handle the match.
	module := l.CheckString(1)
	if module == "" {
		l.ArgError(1, "expects module name")
		return 0
	}

	params := RuntimeLuaConvertLuaValue(l.Get(2))
	var paramsMap map[string]interface{}
	if params != nil {
		var ok bool
		paramsMap, ok = params.(map[string]interface{})
		if !ok {
			l.ArgError(2, "expects params to be nil or a table of key-value pairs")
			return 0
		}
	}

	id, err := n.matchRegistry.CreateMatch(l.Context(), n.logger, n.matchCreateFn, module, paramsMap)
	if err != nil {
		l.RaiseError(err.Error())
		return 0
	}

	l.Push(lua.LString(id))
	return 1
}

func (n *RuntimeLuaNakamaModule) matchList(l *lua.LState) int {
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

	var query *wrappers.StringValue
	if v := l.Get(6); v.Type() != lua.LTNil {
		if v.Type() != lua.LTString {
			l.ArgError(6, "expects query string or nil")
			return 0
		}
		query = &wrappers.StringValue{Value: lua.LVAsString(v)}
	}

	results, err := n.matchRegistry.ListMatches(l.Context(), limit, authoritative, label, minSize, maxSize, query)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list matches: %s", err.Error()))
		return 0
	}

	matches := l.CreateTable(len(results), 0)
	for i, result := range results {
		match := l.CreateTable(0, 4)
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

func (n *RuntimeLuaNakamaModule) notificationSend(l *lua.LState) int {
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

	contentMap := RuntimeLuaConvertLuaTable(l.CheckTable(3))
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
			l.ArgError(5, "expects sender_id to either be not set, empty string or a valid UUID")
			return 0
		}
		senderID = suid.String()
	}

	persistent := l.OptBool(6, false)

	nots := []*api.Notification{{
		Id:         uuid.Must(uuid.NewV4()).String(),
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

	if err := NotificationSend(l.Context(), n.logger, n.db, n.router, notifications); err != nil {
		l.RaiseError(fmt.Sprintf("failed to send notifications: %s", err.Error()))
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) notificationsSend(l *lua.LState) int {
	notificationsTable := l.CheckTable(1)
	if notificationsTable == nil {
		l.ArgError(1, "expects a valid set of notifications")
		return 0
	}

	conversionError := false
	notifications := make(map[uuid.UUID][]*api.Notification)
	notificationsTable.ForEach(func(i lua.LValue, g lua.LValue) {
		if conversionError {
			return
		}

		notificationTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of notifications")
			return
		}

		notification := &api.Notification{}
		userID := uuid.Nil
		senderID := uuid.Nil
		notificationTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

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

				contentMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
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
					l.ArgError(1, "expects sender_id to be a valid UUID")
					return
				}
				senderID = sid
			}
		})

		if conversionError {
			return
		}

		if notification.Subject == "" {
			l.ArgError(1, "expects subject to be provided and to be non-empty")
			return
		} else if len(notification.Content) == 0 {
			l.ArgError(1, "expects content to be provided and be valid JSON")
			return
		} else if userID == uuid.Nil {
			l.ArgError(1, "expects user_id to be provided and be a valid UUID")
			return
		} else if notification.Code == 0 {
			l.ArgError(1, "expects code to be provided and be a number above 0")
			return
		}

		notification.Id = uuid.Must(uuid.NewV4()).String()
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

	if err := NotificationSend(l.Context(), n.logger, n.db, n.router, notifications); err != nil {
		l.RaiseError(fmt.Sprintf("failed to send notifications: %s", err.Error()))
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) walletUpdate(l *lua.LState) int {
	// Parse user ID.
	uid := l.CheckString(1)
	if uid == "" {
		l.ArgError(1, "expects a valid user id")
		return 0
	}
	userID, err := uuid.FromString(uid)
	if err != nil {
		l.ArgError(1, "expects a valid user id")
		return 0
	}

	// Parse changeset.
	changesetTable := l.CheckTable(2)
	if changesetTable == nil {
		l.ArgError(2, "expects a table as changeset value")
		return 0
	}
	changesetMap := RuntimeLuaConvertLuaTable(changesetTable)

	// Parse metadata, optional.
	metadataBytes := []byte("{}")
	metadataTable := l.OptTable(3, nil)
	if metadataTable != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
		metadataBytes, err = json.Marshal(metadataMap)
		if err != nil {
			l.ArgError(3, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
			return 0
		}
	}

	updateLedger := l.OptBool(4, true)

	if err = UpdateWallets(l.Context(), n.logger, n.db, []*walletUpdate{&walletUpdate{
		UserID:    userID,
		Changeset: changesetMap,
		Metadata:  string(metadataBytes),
	}}, updateLedger); err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet: %s", err.Error()))
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) walletsUpdate(l *lua.LState) int {
	updatesTable := l.CheckTable(1)
	if updatesTable == nil {
		l.ArgError(1, "expects a valid set of updates")
		return 0
	}
	size := updatesTable.Len()
	if size == 0 {
		return 0
	}

	updates := make([]*walletUpdate, 0, size)
	conversionError := false
	updatesTable.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		updateTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of updates")
			return
		}

		update := &walletUpdate{}
		updateTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "user_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects user_id to be string")
					return
				}
				uid, err := uuid.FromString(v.String())
				if err != nil {
					conversionError = true
					l.ArgError(1, "expects user_id to be a valid ID")
					return
				}
				update.UserID = uid
			case "changeset":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects changeset to be table")
					return
				}
				update.Changeset = RuntimeLuaConvertLuaTable(v.(*lua.LTable))
			case "metadata":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects metadata to be table")
					return
				}
				metadataMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
				metadataBytes, err := json.Marshal(metadataMap)
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
					return
				}
				update.Metadata = string(metadataBytes)
			}
		})

		if conversionError {
			return
		}

		if update.Metadata == "" {
			// Default to empty metadata.
			update.Metadata = "{}"
		}

		if update.Changeset == nil {
			conversionError = true
			l.ArgError(1, "expects changeset to be supplied")
			return
		}

		updates = append(updates, update)
	})
	if conversionError {
		return 0
	}

	updateLedger := l.OptBool(2, false)

	if err := UpdateWallets(l.Context(), n.logger, n.db, updates, updateLedger); err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet: %s", err.Error()))
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) walletLedgerUpdate(l *lua.LState) int {
	// Parse ledger ID.
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a valid id")
		return 0
	}
	itemID, err := uuid.FromString(id)
	if err != nil {
		l.ArgError(1, "expects a valid id")
		return 0
	}

	// Parse metadata.
	metadataTable := l.CheckTable(2)
	if metadataTable == nil {
		l.ArgError(2, "expects a table as metadata value")
		return 0
	}
	metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
	metadataBytes, err := json.Marshal(metadataMap)
	if err != nil {
		l.ArgError(2, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
		return 0
	}

	item, err := UpdateWalletLedger(l.Context(), n.logger, n.db, itemID, string(metadataBytes))
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet ledger: %s", err.Error()))
		return 0
	}

	itemTable := l.CreateTable(0, 6)
	itemTable.RawSetString("id", lua.LString(id))
	itemTable.RawSetString("user_id", lua.LString(item.UserID))
	itemTable.RawSetString("create_time", lua.LNumber(item.CreateTime))
	itemTable.RawSetString("update_time", lua.LNumber(item.UpdateTime))

	changesetTable := RuntimeLuaConvertMap(l, item.Changeset)
	itemTable.RawSetString("changeset", changesetTable)

	itemTable.RawSetString("metadata", metadataTable)

	l.Push(itemTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) walletLedgerList(l *lua.LState) int {
	// Parse user ID.
	uid := l.CheckString(1)
	if uid == "" {
		l.ArgError(1, "expects a valid user id")
		return 0
	}
	userID, err := uuid.FromString(uid)
	if err != nil {
		l.ArgError(1, "expects a valid user id")
		return 0
	}

	items, err := ListWalletLedger(l.Context(), n.logger, n.db, userID)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to retrieve user wallet ledger: %s", err.Error()))
		return 0
	}

	itemsTable := l.CreateTable(len(items), 0)
	for i, item := range items {
		itemTable := l.CreateTable(0, 6)
		itemTable.RawSetString("id", lua.LString(item.ID))
		itemTable.RawSetString("user_id", lua.LString(uid))
		itemTable.RawSetString("create_time", lua.LNumber(item.CreateTime))
		itemTable.RawSetString("update_time", lua.LNumber(item.UpdateTime))

		changesetTable := RuntimeLuaConvertMap(l, item.Changeset)
		itemTable.RawSetString("changeset", changesetTable)

		metadataTable := RuntimeLuaConvertMap(l, item.Metadata)
		itemTable.RawSetString("metadata", metadataTable)

		itemsTable.RawSetInt(i+1, itemTable)
	}

	l.Push(itemsTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) storageList(l *lua.LState) int {
	userIDString := l.OptString(1, "")
	collection := l.OptString(2, "")
	limit := l.CheckInt(3)
	cursor := l.OptString(4, "")

	userID := uuid.Nil
	if userIDString != "" {
		uid, err := uuid.FromString(userIDString)
		if err != nil {
			l.ArgError(1, "expects empty or a valid user ID")
			return 0
		}
		userID = uid
	}

	objectList, _, err := StorageListObjects(l.Context(), n.logger, n.db, uuid.Nil, userID, collection, limit, cursor)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list storage objects: %s", err.Error()))
		return 0
	}

	lv := l.CreateTable(len(objectList.GetObjects()), 0)
	for i, v := range objectList.GetObjects() {
		vt := l.CreateTable(0, 9)
		vt.RawSetString("key", lua.LString(v.Key))
		vt.RawSetString("collection", lua.LString(v.Collection))
		if v.UserId != "" {
			vt.RawSetString("user_id", lua.LString(v.UserId))
		} else {
			vt.RawSetString("user_id", lua.LNil)
		}
		vt.RawSetString("version", lua.LString(v.Version))
		vt.RawSetString("permission_read", lua.LNumber(v.PermissionRead))
		vt.RawSetString("permission_write", lua.LNumber(v.PermissionWrite))
		vt.RawSetString("create_time", lua.LNumber(v.CreateTime.Seconds))
		vt.RawSetString("update_time", lua.LNumber(v.UpdateTime.Seconds))

		valueMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(v.Value), &valueMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert value to json: %s", err.Error()))
			return 0
		}
		valueTable := RuntimeLuaConvertMap(l, valueMap)
		vt.RawSetString("value", valueTable)

		lv.RawSetInt(i+1, vt)
	}
	l.Push(lv)

	if objectList.GetCursor() != "" {
		l.Push(lua.LString(objectList.GetCursor()))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *RuntimeLuaNakamaModule) storageRead(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil {
		l.ArgError(1, "expects a valid set of keys")
		return 0
	}

	size := keysTable.Len()
	if size == 0 {
		// Empty input, empty response.
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	objectIDs := make([]*api.ReadStorageObjectId, 0, size)
	conversionError := false
	keysTable.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		keyTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of keys")
			return
		}

		objectID := &api.ReadStorageObjectId{}
		keyTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "collection":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects collection to be string")
					return
				}
				objectID.Collection = v.String()
				if objectID.Collection == "" {
					conversionError = true
					l.ArgError(1, "expects collection to be a non-empty string")
					return
				}
			case "key":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects key to be string")
					return
				}
				objectID.Key = v.String()
				if objectID.Key == "" {
					conversionError = true
					l.ArgError(1, "expects key to be a non-empty string")
					return
				}
			case "user_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects user_id to be string")
					return
				}
				objectID.UserId = v.String()
				if _, err := uuid.FromString(objectID.UserId); err != nil {
					conversionError = true
					l.ArgError(1, "expects user_id to be a valid ID")
					return
				}
			}
		})

		if conversionError {
			return
		}

		if objectID.UserId == "" {
			// Default to server-owned data if no owner is supplied.
			objectID.UserId = uuid.Nil.String()
		}

		if objectID.Collection == "" {
			conversionError = true
			l.ArgError(1, "expects collection to be supplied")
			return
		} else if objectID.Key == "" {
			conversionError = true
			l.ArgError(1, "expects key to be supplied")
			return
		}

		objectIDs = append(objectIDs, objectID)
	})
	if conversionError {
		return 0
	}

	objects, err := StorageReadObjects(l.Context(), n.logger, n.db, uuid.Nil, objectIDs)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to read storage objects: %s", err.Error()))
		return 0
	}

	lv := l.CreateTable(len(objects.GetObjects()), 0)
	for i, v := range objects.GetObjects() {
		vt := l.CreateTable(0, 9)
		vt.RawSetString("key", lua.LString(v.Key))
		vt.RawSetString("collection", lua.LString(v.Collection))
		if v.UserId != "" {
			vt.RawSetString("user_id", lua.LString(v.UserId))
		} else {
			vt.RawSetString("user_id", lua.LNil)
		}
		vt.RawSetString("version", lua.LString(v.Version))
		vt.RawSetString("permission_read", lua.LNumber(v.PermissionRead))
		vt.RawSetString("permission_write", lua.LNumber(v.PermissionWrite))
		vt.RawSetString("create_time", lua.LNumber(v.CreateTime.Seconds))
		vt.RawSetString("update_time", lua.LNumber(v.UpdateTime.Seconds))

		valueMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(v.Value), &valueMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert value to json: %s", err.Error()))
			return 0
		}
		valueTable := RuntimeLuaConvertMap(l, valueMap)
		vt.RawSetString("value", valueTable)

		lv.RawSetInt(i+1, vt)
	}
	l.Push(lv)
	return 1
}

func (n *RuntimeLuaNakamaModule) storageWrite(l *lua.LState) int {
	dataTable := l.CheckTable(1)
	if dataTable == nil {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}

	size := dataTable.Len()
	if size == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	data := make(map[uuid.UUID][]*api.WriteStorageObject)
	conversionError := false
	dataTable.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		dataTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of data")
			return
		}

		var userID uuid.UUID
		d := &api.WriteStorageObject{}
		dataTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "collection":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects collection to be string")
					return
				}
				d.Collection = v.String()
				if d.Collection == "" {
					conversionError = true
					l.ArgError(1, "expects collection to be a non-empty string")
					return
				}
			case "key":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects key to be string")
					return
				}
				d.Key = v.String()
				if d.Key == "" {
					conversionError = true
					l.ArgError(1, "expects key to be a non-empty string")
					return
				}
			case "user_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects user_id to be string")
					return
				}
				var err error
				if userID, err = uuid.FromString(v.String()); err != nil {
					conversionError = true
					l.ArgError(1, "expects user_id to be a valid ID")
					return
				}
			case "value":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects value to be table")
					return
				}
				valueMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
				valueBytes, err := json.Marshal(valueMap)
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("failed to convert value: %s", err.Error()))
					return
				}
				d.Value = string(valueBytes)
			case "version":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects version to be string")
					return
				}
				d.Version = v.String()
				if d.Version == "" {
					conversionError = true
					l.ArgError(1, "expects version to be a non-empty string")
					return
				}
			case "permission_read":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects permission_read to be number")
					return
				}
				d.PermissionRead = &wrappers.Int32Value{Value: int32(v.(lua.LNumber))}
			case "permission_write":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects permission_write to be number")
					return
				}
				d.PermissionWrite = &wrappers.Int32Value{Value: int32(v.(lua.LNumber))}
			}
		})

		if conversionError {
			return
		}

		if d.Collection == "" {
			conversionError = true
			l.ArgError(1, "expects collection to be supplied")
			return
		} else if d.Key == "" {
			conversionError = true
			l.ArgError(1, "expects key to be supplied")
			return
		} else if d.Value == "" {
			conversionError = true
			l.ArgError(1, "expects value to be supplied")
			return
		}

		if d.PermissionRead == nil {
			// Default to owner read if no permission_read is supplied.
			d.PermissionRead = &wrappers.Int32Value{Value: 1}
		}
		if d.PermissionWrite == nil {
			// Default to owner write if no permission_write is supplied.
			d.PermissionWrite = &wrappers.Int32Value{Value: 1}
		}

		if objects, ok := data[userID]; !ok {
			data[userID] = []*api.WriteStorageObject{d}
		} else {
			data[userID] = append(objects, d)
		}
	})
	if conversionError {
		return 0
	}

	acks, _, err := StorageWriteObjects(l.Context(), n.logger, n.db, true, data)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to write storage objects: %s", err.Error()))
		return 0
	}

	lv := l.CreateTable(len(acks.Acks), 0)
	for i, k := range acks.Acks {
		kt := l.CreateTable(0, 4)
		kt.RawSetString("key", lua.LString(k.Key))
		kt.RawSetString("collection", lua.LString(k.Collection))
		if k.UserId != "" {
			kt.RawSetString("user_id", lua.LString(k.UserId))
		} else {
			kt.RawSetString("user_id", lua.LNil)
		}
		kt.RawSetString("version", lua.LString(k.Version))

		lv.RawSetInt(i+1, kt)
	}
	l.Push(lv)
	return 1
}

func (n *RuntimeLuaNakamaModule) storageDelete(l *lua.LState) int {
	keysTable := l.CheckTable(1)
	if keysTable == nil {
		l.ArgError(1, "expects a valid set of object IDs")
		return 0
	}

	size := keysTable.Len()
	if size == 0 {
		return 0
	}

	objectIDs := make(map[uuid.UUID][]*api.DeleteStorageObjectId)
	conversionError := false
	keysTable.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		keyTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of object IDs")
			return
		}

		var userID uuid.UUID
		objectID := &api.DeleteStorageObjectId{}
		keyTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "collection":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects collection to be string")
					return
				}
				objectID.Collection = v.String()
				if objectID.Collection == "" {
					conversionError = true
					l.ArgError(1, "expects collection to be a non-empty string")
					return
				}
			case "key":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects key to be string")
					return
				}
				objectID.Key = v.String()
				if objectID.Key == "" {
					conversionError = true
					l.ArgError(1, "expects key to be a non-empty string")
					return
				}
			case "user_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects user_id to be string")
					return
				}
				var err error
				if userID, err = uuid.FromString(v.String()); err != nil {
					conversionError = true
					l.ArgError(1, "expects user_id to be a valid ID")
					return
				}
			case "version":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects version to be string")
					return
				}
				objectID.Version = v.String()
				if objectID.Version == "" {
					conversionError = true
					l.ArgError(1, "expects version to be a non-empty string")
					return
				}
			}
		})

		if conversionError {
			return
		}

		if objectID.Collection == "" {
			conversionError = true
			l.ArgError(1, "expects collection to be supplied")
			return
		} else if objectID.Key == "" {
			conversionError = true
			l.ArgError(1, "expects key to be supplied")
			return
		}

		if objects, ok := objectIDs[userID]; !ok {
			objectIDs[userID] = []*api.DeleteStorageObjectId{objectID}
		} else {
			objectIDs[userID] = append(objects, objectID)
		}
	})
	if conversionError {
		return 0
	}

	if _, err := StorageDeleteObjects(l.Context(), n.logger, n.db, true, objectIDs); err != nil {
		l.RaiseError(fmt.Sprintf("failed to remove storage: %s", err.Error()))
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) leaderboardCreate(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	authoritative := l.OptBool(2, false)

	sortOrder := l.OptString(3, "desc")
	var sortOrderNumber int
	switch sortOrder {
	case "asc":
		sortOrderNumber = LeaderboardSortOrderAscending
	case "desc":
		sortOrderNumber = LeaderboardSortOrderDescending
	default:
		l.ArgError(3, "expects sort order to be 'asc' or 'desc'")
		return 0
	}

	operator := l.OptString(4, "best")
	var operatorNumber int
	switch operator {
	case "best":
		operatorNumber = LeaderboardOperatorBest
	case "set":
		operatorNumber = LeaderboardOperatorSet
	case "incr":
		operatorNumber = LeaderboardOperatorIncrement
	default:
		l.ArgError(4, "expects sort order to be 'best', 'set', or 'incr'")
		return 0
	}

	resetSchedule := l.OptString(5, "")
	if resetSchedule != "" {
		if _, err := cronexpr.Parse(resetSchedule); err != nil {
			l.ArgError(5, "expects reset schedule to be a valid CRON expression")
			return 0
		}
	}

	metadata := l.OptTable(6, nil)
	metadataStr := "{}"
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataStr = string(metadataBytes)
	}

	if _, err := n.leaderboardCache.Create(l.Context(), id, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadataStr); err != nil {
		l.RaiseError("error creating leaderboard: %v", err.Error())
	}

	n.leaderboardScheduler.Update()
	return 0
}

func (n *RuntimeLuaNakamaModule) leaderboardDelete(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	if err := n.leaderboardCache.Delete(l.Context(), id); err != nil {
		l.RaiseError("error deleting leaderboard: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) leaderboardRecordsList(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	var ownerIds []string
	owners := l.OptTable(2, nil)
	if owners != nil {
		size := owners.Len()
		if size == 0 {
			l.Push(l.CreateTable(0, 0))
			return 1
		}

		ownerIds = make([]string, 0, size)
		conversionError := false
		owners.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(2, "expects each owner ID to be string")
				return
			}
			s := v.String()
			if _, err := uuid.FromString(s); err != nil {
				conversionError = true
				l.ArgError(2, "expects each owner ID to be a valid identifier")
				return
			}
			ownerIds = append(ownerIds, s)
		})
		if conversionError {
			return 0
		}
	}

	limitNumber := l.OptInt(3, 0)
	if limitNumber < 0 || limitNumber > 10000 {
		l.ArgError(3, "expects limit to be 0-10000")
		return 0
	}
	var limit *wrappers.Int32Value
	if limitNumber != 0 {
		limit = &wrappers.Int32Value{Value: int32(limitNumber)}
	}

	cursor := l.OptString(4, "")
	overrideExpiry := l.OptInt64(5, 0)

	records, err := LeaderboardRecordsList(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, limit, cursor, ownerIds, overrideExpiry)
	if err != nil {
		l.RaiseError("error listing leaderboard records: %v", err.Error())
		return 0
	}

	recordsTable := l.CreateTable(len(records.Records), 0)
	for i, record := range records.Records {
		recordTable := l.CreateTable(0, 11)
		recordTable.RawSetString("leaderboard_id", lua.LString(record.LeaderboardId))
		recordTable.RawSetString("owner_id", lua.LString(record.OwnerId))
		if record.Username != nil {
			recordTable.RawSetString("username", lua.LString(record.Username.Value))
		} else {
			recordTable.RawSetString("username", lua.LNil)
		}
		recordTable.RawSetString("score", lua.LNumber(record.Score))
		recordTable.RawSetString("subscore", lua.LNumber(record.Subscore))
		recordTable.RawSetString("num_score", lua.LNumber(record.NumScore))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(record.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		recordTable.RawSetString("metadata", metadataTable)

		recordTable.RawSetString("create_time", lua.LNumber(record.CreateTime.Seconds))
		recordTable.RawSetString("update_time", lua.LNumber(record.UpdateTime.Seconds))
		if record.ExpiryTime != nil {
			recordTable.RawSetString("expiry_time", lua.LNumber(record.ExpiryTime.Seconds))
		} else {
			recordTable.RawSetString("expiry_time", lua.LNil)
		}

		recordTable.RawSetString("rank", lua.LNumber(record.Rank))

		recordsTable.RawSetInt(i+1, recordTable)
	}

	ownerRecordsTable := l.CreateTable(len(records.OwnerRecords), 0)
	for i, record := range records.OwnerRecords {
		recordTable := l.CreateTable(0, 11)
		recordTable.RawSetString("leaderboard_id", lua.LString(record.LeaderboardId))
		recordTable.RawSetString("owner_id", lua.LString(record.OwnerId))
		if record.Username != nil {
			recordTable.RawSetString("username", lua.LString(record.Username.Value))
		} else {
			recordTable.RawSetString("username", lua.LNil)
		}
		recordTable.RawSetString("score", lua.LNumber(record.Score))
		recordTable.RawSetString("subscore", lua.LNumber(record.Subscore))
		recordTable.RawSetString("num_score", lua.LNumber(record.NumScore))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(record.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		recordTable.RawSetString("metadata", metadataTable)

		recordTable.RawSetString("create_time", lua.LNumber(record.CreateTime.Seconds))
		recordTable.RawSetString("update_time", lua.LNumber(record.UpdateTime.Seconds))
		if record.ExpiryTime != nil {
			recordTable.RawSetString("expiry_time", lua.LNumber(record.ExpiryTime.Seconds))
		} else {
			recordTable.RawSetString("expiry_time", lua.LNil)
		}

		recordTable.RawSetString("rank", lua.LNumber(record.Rank))

		ownerRecordsTable.RawSetInt(i+1, recordTable)
	}

	l.Push(recordsTable)
	l.Push(ownerRecordsTable)
	if records.NextCursor != "" {
		l.Push(lua.LString(records.NextCursor))
	} else {
		l.Push(lua.LNil)
	}
	if records.PrevCursor != "" {
		l.Push(lua.LString(records.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}
	return 4
}

func (n *RuntimeLuaNakamaModule) leaderboardRecordWrite(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	ownerId := l.CheckString(2)
	if _, err := uuid.FromString(ownerId); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	username := l.OptString(3, "")

	score := l.OptInt64(4, 0)
	if score < 0 {
		l.ArgError(4, "expects score to be >= 0")
		return 0
	}

	subscore := l.OptInt64(5, 0)
	if subscore < 0 {
		l.ArgError(4, "expects subscore to be >= 0")
		return 0
	}

	metadata := l.OptTable(6, nil)
	metadataStr := ""
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataStr = string(metadataBytes)
	}

	record, err := LeaderboardRecordWrite(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerId, username, score, subscore, metadataStr)
	if err != nil {
		l.RaiseError("error writing leaderboard record: %v", err.Error())
		return 0
	}

	recordTable := l.CreateTable(0, 10)
	recordTable.RawSetString("leaderboard_id", lua.LString(record.LeaderboardId))
	recordTable.RawSetString("owner_id", lua.LString(record.OwnerId))
	if record.Username != nil {
		recordTable.RawSetString("username", lua.LString(record.Username.Value))
	} else {
		recordTable.RawSetString("username", lua.LNil)
	}
	recordTable.RawSetString("score", lua.LNumber(record.Score))
	recordTable.RawSetString("subscore", lua.LNumber(record.Subscore))
	recordTable.RawSetString("num_score", lua.LNumber(record.NumScore))

	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(record.Metadata), &metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
		return 0
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	recordTable.RawSetString("metadata", metadataTable)

	recordTable.RawSetString("create_time", lua.LNumber(record.CreateTime.Seconds))
	recordTable.RawSetString("update_time", lua.LNumber(record.UpdateTime.Seconds))
	if record.ExpiryTime != nil {
		recordTable.RawSetString("expiry_time", lua.LNumber(record.ExpiryTime.Seconds))
	} else {
		recordTable.RawSetString("expiry_time", lua.LNil)
	}

	l.Push(recordTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) leaderboardRecordDelete(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	ownerId := l.CheckString(2)
	if _, err := uuid.FromString(ownerId); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	if err := LeaderboardRecordDelete(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerId); err != nil {
		l.RaiseError("error deleting leaderboard record: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) tournamentCreate(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	sortOrder := l.OptString(2, "desc")
	var sortOrderNumber int
	switch sortOrder {
	case "asc":
		sortOrderNumber = LeaderboardSortOrderAscending
	case "desc":
		sortOrderNumber = LeaderboardSortOrderDescending
	default:
		l.ArgError(2, "expects sort order to be 'asc' or 'desc'")
		return 0
	}

	operator := l.OptString(3, "best")
	var operatorNumber int
	switch operator {
	case "best":
		operatorNumber = LeaderboardOperatorBest
	case "set":
		operatorNumber = LeaderboardOperatorSet
	case "incr":
		operatorNumber = LeaderboardOperatorIncrement
	default:
		l.ArgError(3, "expects sort order to be 'best', 'set', or 'incr'")
		return 0
	}

	duration := l.OptInt(4, 0)
	if duration <= 0 {
		l.ArgError(4, "duration must be > 0")
		return 0
	}

	resetSchedule := l.OptString(5, "")
	if resetSchedule != "" {
		if _, err := cronexpr.Parse(resetSchedule); err != nil {
			l.ArgError(5, "expects reset schedule to be a valid CRON expression")
			return 0
		}
	}

	metadata := l.OptTable(6, nil)
	metadataStr := "{}"
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataStr = string(metadataBytes)
	}

	title := l.OptString(7, "")
	description := l.OptString(8, "")
	category := l.OptInt(9, 0)
	if category < 0 || category >= 128 {
		l.ArgError(9, "category must be 0-127")
		return 0
	}
	startTime := l.OptInt(10, 0)
	if startTime != 0 && startTime < int(time.Now().UTC().Unix()) {
		l.ArgError(10, "startTime must be >= current time. Use 0 to indicate a tournament that starts immediately.")
		return 0
	}
	endTime := l.OptInt(11, 0)
	if endTime != 0 && endTime <= startTime {
		l.ArgError(11, "endTime must be > startTime. Use 0 to indicate a tournament that never ends.")
		return 0
	}
	maxSize := l.OptInt(12, 0)
	if maxSize < 0 {
		l.ArgError(12, "maxSize must be >= 0")
		return 0
	}
	maxNumScore := l.OptInt(13, 0)
	if maxNumScore < 0 {
		l.ArgError(13, "maxNumScore must be >= 0")
		return 0
	}
	joinRequired := l.OptBool(14, false)

	if err := TournamentCreate(l.Context(), n.logger, n.leaderboardCache, n.leaderboardScheduler, id, sortOrderNumber, operatorNumber, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired); err != nil {
		l.RaiseError("error creating tournament: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) tournamentDelete(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	if err := TournamentDelete(l.Context(), n.logger, n.leaderboardCache, n.rankCache, n.leaderboardScheduler, id); err != nil {
		l.RaiseError("error deleting tournament: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) tournamentAddAttempt(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	owner := l.CheckString(2)
	if owner == "" {
		l.ArgError(2, "expects an owner ID string")
		return 0
	} else if _, err := uuid.FromString(owner); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	count := l.CheckInt(3)
	if count == 0 {
		l.ArgError(3, "expects an attempt count number != 0")
		return 0
	}

	if err := TournamentAddAttempt(l.Context(), n.logger, n.db, n.leaderboardCache, id, owner, count); err != nil {
		l.RaiseError("error adding tournament attempts: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) tournamentJoin(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	userID := l.CheckString(2)
	if userID == "" {
		l.ArgError(2, "expects a user ID string")
		return 0
	} else if _, err := uuid.FromString(userID); err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(3)
	if username == "" {
		l.ArgError(3, "expects a username string")
		return 0
	}

	if err := TournamentJoin(l.Context(), n.logger, n.db, n.leaderboardCache, userID, username, id); err != nil {
		l.RaiseError("error joining tournament: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) tournamentList(l *lua.LState) int {
	categoryStart := l.OptInt(1, 0)
	if categoryStart < 0 || categoryStart >= 128 {
		l.ArgError(1, "categoryStart must be 0-127")
		return 0
	}
	categoryEnd := l.OptInt(2, 0)
	if categoryEnd < 0 || categoryEnd >= 128 {
		l.ArgError(2, "categoryEnd must be 0-127")
		return 0
	}
	if categoryStart > categoryEnd {
		l.ArgError(2, "categoryEnd must be >= categoryStart")
		return 0
	}
	startTime := l.OptInt(3, 0)
	if startTime < 0 {
		l.ArgError(3, "startTime must be >= 0")
		return 0
	}
	endTime := l.OptInt(4, 0)
	if endTime < 0 {
		l.ArgError(4, "endTime must be >= 0")
		return 0
	}
	if startTime > endTime {
		l.ArgError(4, "endTime must be >= startTime")
		return 0
	}

	limit := l.OptInt(5, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(5, "limit must be 1-100")
		return 0
	}

	var cursor *tournamentListCursor
	cursorStr := l.OptString(6, "")
	if cursorStr != "" {
		if cb, err := base64.StdEncoding.DecodeString(cursorStr); err != nil {
			l.ArgError(6, "expects cursor to be valid when provided")
			return 0
		} else {
			cursor = &tournamentListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
				l.ArgError(6, "expects cursor to be valid when provided")
				return 0
			}
		}
	}

	list, err := TournamentList(l.Context(), n.logger, n.db, categoryStart, categoryEnd, startTime, endTime, limit, cursor)
	if err != nil {
		l.RaiseError("error listing tournaments: %v", err.Error())
		return 0
	}

	tournaments := l.CreateTable(len(list.Tournaments), 0)
	for i, t := range list.Tournaments {
		tt := l.CreateTable(0, 16)

		tt.RawSetString("id", lua.LString(t.Id))
		tt.RawSetString("title", lua.LString(t.Title))
		tt.RawSetString("description", lua.LString(t.Description))
		tt.RawSetString("category", lua.LNumber(t.Category))
		if t.SortOrder == LeaderboardSortOrderAscending {
			tt.RawSetString("sort_order", lua.LString("asc"))
		} else {
			tt.RawSetString("sort_order", lua.LString("desc"))
		}
		tt.RawSetString("size", lua.LNumber(t.Size))
		tt.RawSetString("max_size", lua.LNumber(t.MaxSize))
		tt.RawSetString("max_num_score", lua.LNumber(t.MaxNumScore))
		tt.RawSetString("duration", lua.LNumber(t.Duration))
		tt.RawSetString("end_active", lua.LNumber(t.EndActive))
		tt.RawSetString("can_enter", lua.LBool(t.CanEnter))
		tt.RawSetString("next_reset", lua.LNumber(t.NextReset))
		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(t.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		tt.RawSetString("metadata", metadataTable)
		tt.RawSetString("create_time", lua.LNumber(t.CreateTime.Seconds))
		tt.RawSetString("start_time", lua.LNumber(t.StartTime.Seconds))
		if t.EndTime == nil {
			tt.RawSetString("end_time", lua.LNil)
		} else {
			tt.RawSetString("end_time", lua.LNumber(t.EndTime.Seconds))
		}

		tournaments.RawSetInt(i+1, tt)
	}
	l.Push(tournaments)

	if list.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(list.Cursor))
	}

	return 2
}

func (n *RuntimeLuaNakamaModule) tournamentRecordWrite(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	userID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.OptString(3, "")

	score := l.OptInt64(4, 0)
	subscore := l.OptInt64(5, 0)

	metadata := l.OptTable(6, nil)
	metadataStr := ""
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataStr = string(metadataBytes)
	}

	record, err := TournamentRecordWrite(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, userID, username, score, subscore, metadataStr)
	if err != nil {
		l.RaiseError("error writing tournament record: %v", err.Error())
	}

	recordTable := l.CreateTable(0, 10)
	recordTable.RawSetString("leaderboard_id", lua.LString(record.LeaderboardId))
	recordTable.RawSetString("owner_id", lua.LString(record.OwnerId))
	if record.Username != nil {
		recordTable.RawSetString("username", lua.LString(record.Username.Value))
	} else {
		recordTable.RawSetString("username", lua.LNil)
	}
	recordTable.RawSetString("score", lua.LNumber(record.Score))
	recordTable.RawSetString("subscore", lua.LNumber(record.Subscore))
	recordTable.RawSetString("num_score", lua.LNumber(record.NumScore))

	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(record.Metadata), &metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
		return 0
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	recordTable.RawSetString("metadata", metadataTable)

	recordTable.RawSetString("create_time", lua.LNumber(record.CreateTime.Seconds))
	recordTable.RawSetString("update_time", lua.LNumber(record.UpdateTime.Seconds))
	if record.ExpiryTime != nil {
		recordTable.RawSetString("expiry_time", lua.LNumber(record.ExpiryTime.Seconds))
	} else {
		recordTable.RawSetString("expiry_time", lua.LNil)
	}

	l.Push(recordTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) tournamentRecordsHaystack(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	userID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(3, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(3, "limit must be 1-100")
		return 0
	}

	records, err := TournamentRecordsHaystack(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, userID, limit)
	if err != nil {
		l.RaiseError("error listing tournament records haystack: %v", err.Error())
		return 0
	}

	recordsTable := l.CreateTable(len(records), 0)
	for i, record := range records {
		recordTable := l.CreateTable(0, 10)

		recordTable.RawSetString("leaderboard_id", lua.LString(record.LeaderboardId))
		recordTable.RawSetString("owner_id", lua.LString(record.OwnerId))
		if record.Username != nil {
			recordTable.RawSetString("username", lua.LString(record.Username.Value))
		} else {
			recordTable.RawSetString("username", lua.LNil)
		}
		recordTable.RawSetString("score", lua.LNumber(record.Score))
		recordTable.RawSetString("subscore", lua.LNumber(record.Subscore))
		recordTable.RawSetString("num_score", lua.LNumber(record.NumScore))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(record.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		recordTable.RawSetString("metadata", metadataTable)

		recordTable.RawSetString("create_time", lua.LNumber(record.CreateTime.Seconds))
		recordTable.RawSetString("update_time", lua.LNumber(record.UpdateTime.Seconds))
		if record.ExpiryTime != nil {
			recordTable.RawSetString("expiry_time", lua.LNumber(record.ExpiryTime.Seconds))
		} else {
			recordTable.RawSetString("expiry_time", lua.LNil)
		}

		recordsTable.RawSetInt(i+1, recordTable)
	}
	l.Push(recordsTable)

	return 1
}

func (n *RuntimeLuaNakamaModule) groupsGetId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid group id list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	groupIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid group id data")
		return 0
	}
	if len(groupIDs) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	groupIDStrings := make([]string, 0, len(groupIDs))
	for _, id := range groupIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each group id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each group id must be a valid id string")
			return 0
		} else {
			groupIDStrings = append(groupIDStrings, ids)
		}
	}

	// Get the groups.
	groups, err := GetGroups(l.Context(), n.logger, n.db, groupIDStrings)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get groups: %s", err.Error()))
		return 0
	}

	groupsTable := l.CreateTable(len(groups), 0)
	for i, g := range groups {
		gt := l.CreateTable(0, 12)
		gt.RawSetString("id", lua.LString(g.Id))
		gt.RawSetString("creator_id", lua.LString(g.CreatorId))
		gt.RawSetString("name", lua.LString(g.Name))
		gt.RawSetString("description", lua.LString(g.Description))
		gt.RawSetString("avatar_url", lua.LString(g.AvatarUrl))
		gt.RawSetString("lang_tag", lua.LString(g.LangTag))
		gt.RawSetString("open", lua.LBool(g.Open.Value))
		gt.RawSetString("edge_count", lua.LNumber(g.EdgeCount))
		gt.RawSetString("max_count", lua.LNumber(g.MaxCount))
		gt.RawSetString("create_time", lua.LNumber(g.CreateTime.Seconds))
		gt.RawSetString("update_time", lua.LNumber(g.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(g.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		gt.RawSetString("metadata", metadataTable)

		groupsTable.RawSetInt(i+1, gt)
	}

	l.Push(groupsTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) groupCreate(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	name := l.CheckString(2)
	if name == "" {
		l.ArgError(2, "expects group name not be empty")
		return 0
	}

	creatorID, err := uuid.FromString(l.OptString(3, uuid.Nil.String()))
	if err != nil {
		l.ArgError(3, "expects owner ID to be a valid identifier")
		return 0
	}

	lang := l.OptString(4, "")
	desc := l.OptString(5, "")
	avatarURL := l.OptString(6, "")
	open := l.OptBool(7, false)
	metadata := l.OptTable(8, nil)
	metadataStr := ""
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataStr = string(metadataBytes)
	}
	maxCount := l.OptInt(9, 100)
	if maxCount < 1 || maxCount > 100 {
		l.ArgError(9, "expects max_count to be >= 1 and <= 100")
		return 0
	}

	group, err := CreateGroup(l.Context(), n.logger, n.db, userID, creatorID, name, lang, desc, avatarURL, metadataStr, open, maxCount)
	if err != nil {
		l.RaiseError("error while trying to create group: %v", err.Error())
		return 0
	}

	if group == nil {
		l.RaiseError("did not create group as a group already exists with the same name")
		return 0
	}

	groupTable := l.CreateTable(0, 12)
	groupTable.RawSetString("id", lua.LString(group.Id))
	groupTable.RawSetString("creator_id", lua.LString(group.CreatorId))
	groupTable.RawSetString("name", lua.LString(group.Name))
	groupTable.RawSetString("description", lua.LString(group.Description))
	groupTable.RawSetString("avatar_url", lua.LString(group.AvatarUrl))
	groupTable.RawSetString("lang_tag", lua.LString(group.LangTag))

	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(group.Metadata), &metadataMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
		return 0
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	groupTable.RawSetString("metadata", metadataTable)
	groupTable.RawSetString("open", lua.LBool(group.Open.Value))
	groupTable.RawSetString("edge_count", lua.LNumber(group.EdgeCount))
	groupTable.RawSetString("max_count", lua.LNumber(group.MaxCount))
	groupTable.RawSetString("create_time", lua.LNumber(group.CreateTime.Seconds))
	groupTable.RawSetString("update_time", lua.LNumber(group.UpdateTime.Seconds))

	l.Push(groupTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) groupUpdate(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	nameStr := l.OptString(2, "")
	var name *wrappers.StringValue
	if nameStr != "" {
		name = &wrappers.StringValue{Value: nameStr}
	}

	creatorIDStr := l.OptString(3, "")
	creatorID := uuid.Nil
	if creatorIDStr != "" {
		var err error
		creatorID, err = uuid.FromString(creatorIDStr)
		if err != nil {
			l.ArgError(3, "expects creator ID to be a valid identifier")
			return 0
		}
	}

	langStr := l.OptString(4, "")
	var lang *wrappers.StringValue
	if langStr != "" {
		lang = &wrappers.StringValue{Value: langStr}
	}

	descStr := l.OptString(5, "")
	var desc *wrappers.StringValue
	if descStr != "" {
		desc = &wrappers.StringValue{Value: descStr}
	}

	avatarURLStr := l.OptString(6, "")
	var avatarURL *wrappers.StringValue
	if avatarURLStr != "" {
		avatarURL = &wrappers.StringValue{Value: avatarURLStr}
	}

	openV := l.Get(7)
	var open *wrappers.BoolValue
	if openV != lua.LNil {
		open = &wrappers.BoolValue{Value: l.OptBool(7, false)}
	}

	metadataTable := l.OptTable(8, nil)
	var metadata *wrappers.StringValue
	if metadataTable != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadata = &wrappers.StringValue{Value: string(metadataBytes)}
	}

	maxCountInt := l.OptInt(9, 0)
	maxCount := 0
	if maxCountInt > 0 && maxCountInt <= 100 {
		maxCount = maxCountInt
	}

	if err = UpdateGroup(l.Context(), n.logger, n.db, groupID, uuid.Nil, creatorID, name, lang, desc, avatarURL, metadata, open, maxCount); err != nil {
		l.RaiseError("error while trying to update group: %v", err.Error())
		return 0
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) groupDelete(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	if err = DeleteGroup(l.Context(), n.logger, n.db, groupID, uuid.Nil); err != nil {
		l.RaiseError("error while trying to delete group: %v", err.Error())
		return 0
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) groupUsersKick(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	users := l.CheckTable(2)
	if users == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	userIDs := make([]uuid.UUID, 0, users.Len())
	conversionError := false
	users.ForEach(func(k lua.LValue, v lua.LValue) {
		if v.Type() != lua.LTString {
			l.ArgError(2, "expects each user ID to be a string")
			conversionError = true
			return
		}
		userID, err := uuid.FromString(v.String())
		if err != nil {
			l.ArgError(2, "expects each user ID to be a valid identifier")
			conversionError = true
			return
		}
		if userID == uuid.Nil {
			l.ArgError(2, "cannot kick the root user")
			conversionError = true
			return
		}
		userIDs = append(userIDs, userID)
	})
	if conversionError {
		return 0
	}

	if len(userIDs) == 0 {
		return 0
	}

	if err := KickGroupUsers(l.Context(), n.logger, n.db, uuid.Nil, groupID, userIDs); err != nil {
		l.RaiseError("error while trying to kick users from a group: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupUsersList(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	res, err := ListGroupUsers(l.Context(), n.logger, n.db, n.tracker, groupID)
	if err != nil {
		l.RaiseError("error while trying to list users in a group: %v", err.Error())
		return 0
	}

	groupUsers := l.CreateTable(len(res.GroupUsers), 0)
	for i, ug := range res.GroupUsers {
		u := ug.User

		ut := l.CreateTable(0, 16)
		ut.RawSetString("user_id", lua.LString(u.Id))
		ut.RawSetString("username", lua.LString(u.Username))
		ut.RawSetString("display_name", lua.LString(u.DisplayName))
		ut.RawSetString("avatar_url", lua.LString(u.AvatarUrl))
		ut.RawSetString("lang_tag", lua.LString(u.LangTag))
		ut.RawSetString("location", lua.LString(u.Location))
		ut.RawSetString("timezone", lua.LString(u.Timezone))
		if u.FacebookId != "" {
			ut.RawSetString("facebook_id", lua.LString(u.FacebookId))
		}
		if u.GoogleId != "" {
			ut.RawSetString("google_id", lua.LString(u.GoogleId))
		}
		if u.GamecenterId != "" {
			ut.RawSetString("gamecenter_id", lua.LString(u.GamecenterId))
		}
		if u.SteamId != "" {
			ut.RawSetString("steam_id", lua.LString(u.SteamId))
		}
		ut.RawSetString("online", lua.LBool(u.Online))
		ut.RawSetString("edge_count", lua.LNumber(u.EdgeCount))
		ut.RawSetString("create_time", lua.LNumber(u.CreateTime.Seconds))
		ut.RawSetString("update_time", lua.LNumber(u.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		ut.RawSetString("metadata", metadataTable)

		gt := l.CreateTable(0, 2)
		gt.RawSetString("user", ut)
		gt.RawSetString("state", lua.LNumber(ug.State.Value))

		groupUsers.RawSetInt(i+1, gt)
	}

	l.Push(groupUsers)
	return 1
}

func (n *RuntimeLuaNakamaModule) userGroupsList(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	res, err := ListUserGroups(l.Context(), n.logger, n.db, userID)
	if err != nil {
		l.RaiseError("error while trying to list groups for a user: %v", err.Error())
		return 0
	}

	userGroups := l.CreateTable(len(res.UserGroups), 0)
	for i, ug := range res.UserGroups {
		g := ug.Group

		gt := l.CreateTable(0, 12)
		gt.RawSetString("id", lua.LString(g.Id))
		gt.RawSetString("creator_id", lua.LString(g.CreatorId))
		gt.RawSetString("name", lua.LString(g.Name))
		gt.RawSetString("description", lua.LString(g.Description))
		gt.RawSetString("avatar_url", lua.LString(g.AvatarUrl))
		gt.RawSetString("lang_tag", lua.LString(g.LangTag))
		gt.RawSetString("open", lua.LBool(g.Open.Value))
		gt.RawSetString("edge_count", lua.LNumber(g.EdgeCount))
		gt.RawSetString("max_count", lua.LNumber(g.MaxCount))
		gt.RawSetString("create_time", lua.LNumber(g.CreateTime.Seconds))
		gt.RawSetString("update_time", lua.LNumber(g.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(g.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		gt.RawSetString("metadata", metadataTable)

		ugt := l.CreateTable(0, 2)
		ugt.RawSetString("group", gt)
		ugt.RawSetString("state", lua.LNumber(ug.State.Value))

		userGroups.RawSetInt(i+1, ugt)
	}

	l.Push(userGroups)
	return 1
}

func (n *RuntimeLuaNakamaModule) accountUpdateId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	metadataTable := l.OptTable(2, nil)
	var metadata *wrappers.StringValue
	if metadataTable != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadata = &wrappers.StringValue{Value: string(metadataBytes)}
	}

	username := l.OptString(3, "")

	displayNameL := l.Get(4)
	var displayName *wrappers.StringValue
	if displayNameL != lua.LNil {
		displayName = &wrappers.StringValue{Value: l.OptString(4, "")}
	}

	timezoneL := l.Get(5)
	var timezone *wrappers.StringValue
	if timezoneL != lua.LNil {
		timezone = &wrappers.StringValue{Value: l.OptString(5, "")}
	}

	locationL := l.Get(6)
	var location *wrappers.StringValue
	if locationL != lua.LNil {
		location = &wrappers.StringValue{Value: l.OptString(6, "")}
	}

	langL := l.Get(7)
	var lang *wrappers.StringValue
	if langL != lua.LNil {
		lang = &wrappers.StringValue{Value: l.OptString(7, "")}
	}

	avatarL := l.Get(8)
	var avatar *wrappers.StringValue
	if avatarL != lua.LNil {
		avatar = &wrappers.StringValue{Value: l.OptString(8, "")}
	}

	if err = UpdateAccount(l.Context(), n.logger, n.db, userID, username, displayName, timezone, location, lang, avatar, metadata); err != nil {
		l.RaiseError("error while trying to update user: %v", err.Error())
		return 0
	}

	return 0
}
