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
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/gob"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	lua "github.com/heroiclabs/nakama/v3/internal/gopher-lua"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type ctxLoggerFields struct{}

type RuntimeLuaNakamaModule struct {
	logger               *zap.Logger
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	rankCache            LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	matchRegistry        MatchRegistry
	tracker              Tracker
	streamManager        StreamManager
	router               MessageRouter
	once                 *sync.Once
	localCache           *RuntimeLuaLocalCache
	registerCallbackFn   func(RuntimeExecutionMode, string, *lua.LFunction)
	announceCallbackFn   func(RuntimeExecutionMode, string)
	client               *http.Client

	node          string
	matchCreateFn RuntimeMatchCreateFunction
	eventFn       RuntimeEventCustomFunction
}

func NewRuntimeLuaNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, streamManager StreamManager, router MessageRouter, once *sync.Once, localCache *RuntimeLuaLocalCache, matchCreateFn RuntimeMatchCreateFunction, eventFn RuntimeEventCustomFunction, registerCallbackFn func(RuntimeExecutionMode, string, *lua.LFunction), announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeLuaNakamaModule {
	return &RuntimeLuaNakamaModule{
		logger:               logger,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		config:               config,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		rankCache:            rankCache,
		leaderboardScheduler: leaderboardScheduler,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		matchRegistry:        matchRegistry,
		tracker:              tracker,
		streamManager:        streamManager,
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
		eventFn:       eventFn,
	}
}

func (n *RuntimeLuaNakamaModule) Loader(l *lua.LState) int {
	functions := map[string]lua.LGFunction{
		"register_rpc":                       n.registerRPC,
		"register_req_before":                n.registerReqBefore,
		"register_req_after":                 n.registerReqAfter,
		"register_rt_before":                 n.registerRTBefore,
		"register_rt_after":                  n.registerRTAfter,
		"register_matchmaker_matched":        n.registerMatchmakerMatched,
		"register_tournament_end":            n.registerTournamentEnd,
		"register_tournament_reset":          n.registerTournamentReset,
		"register_leaderboard_reset":         n.registerLeaderboardReset,
		"run_once":                           n.runOnce,
		"get_context":                        n.getContext,
		"event":                              n.event,
		"localcache_get":                     n.localcacheGet,
		"localcache_put":                     n.localcachePut,
		"localcache_delete":                  n.localcacheDelete,
		"time":                               n.time,
		"cron_next":                          n.cronNext,
		"sql_exec":                           n.sqlExec,
		"sql_query":                          n.sqlQuery,
		"uuid_v4":                            n.uuidV4,
		"uuid_bytes_to_string":               n.uuidBytesToString,
		"uuid_string_to_bytes":               n.uuidStringToBytes,
		"http_request":                       n.httpRequest,
		"jwt_generate":                       n.jwtGenerate,
		"json_encode":                        n.jsonEncode,
		"json_decode":                        n.jsonDecode,
		"base64_encode":                      n.base64Encode,
		"base64_decode":                      n.base64Decode,
		"base64url_encode":                   n.base64URLEncode,
		"base64url_decode":                   n.base64URLDecode,
		"base16_encode":                      n.base16Encode,
		"base16_decode":                      n.base16Decode,
		"aes128_encrypt":                     n.aes128Encrypt,
		"aes128_decrypt":                     n.aes128Decrypt,
		"aes256_encrypt":                     n.aes256Encrypt,
		"aes256_decrypt":                     n.aes256Decrypt,
		"md5_hash":                           n.md5Hash,
		"sha256_hash":                        n.sha256Hash,
		"hmac_sha256_hash":                   n.hmacSHA256Hash,
		"rsa_sha256_hash":                    n.rsaSHA256Hash,
		"bcrypt_hash":                        n.bcryptHash,
		"bcrypt_compare":                     n.bcryptCompare,
		"authenticate_apple":                 n.authenticateApple,
		"authenticate_custom":                n.authenticateCustom,
		"authenticate_device":                n.authenticateDevice,
		"authenticate_email":                 n.authenticateEmail,
		"authenticate_facebook":              n.authenticateFacebook,
		"authenticate_facebook_instant_game": n.authenticateFacebookInstantGame,
		"authenticate_game_center":           n.authenticateGameCenter,
		"authenticate_google":                n.authenticateGoogle,
		"authenticate_steam":                 n.authenticateSteam,
		"authenticate_token_generate":        n.authenticateTokenGenerate,
		"logger_debug":                       n.loggerDebug,
		"logger_info":                        n.loggerInfo,
		"logger_warn":                        n.loggerWarn,
		"logger_error":                       n.loggerError,
		"account_get_id":                     n.accountGetId,
		"accounts_get_id":                    n.accountsGetId,
		"account_update_id":                  n.accountUpdateId,
		"account_delete_id":                  n.accountDeleteId,
		"account_export_id":                  n.accountExportId,
		"users_get_id":                       n.usersGetId,
		"users_get_username":                 n.usersGetUsername,
		"users_get_random":                   n.usersGetRandom,
		"users_ban_id":                       n.usersBanId,
		"users_unban_id":                     n.usersUnbanId,
		"link_apple":                         n.linkApple,
		"link_custom":                        n.linkCustom,
		"link_device":                        n.linkDevice,
		"link_email":                         n.linkEmail,
		"link_facebook":                      n.linkFacebook,
		"link_facebook_instant_game":         n.linkFacebookInstantGame,
		"link_gamecenter":                    n.linkGameCenter,
		"link_google":                        n.linkGoogle,
		"link_steam":                         n.linkSteam,
		"unlink_apple":                       n.unlinkApple,
		"unlink_custom":                      n.unlinkCustom,
		"unlink_device":                      n.unlinkDevice,
		"unlink_email":                       n.unlinkEmail,
		"unlink_facebook":                    n.unlinkFacebook,
		"unlink_facebook_instant_game":       n.unlinkFacebookInstantGame,
		"unlink_gamecenter":                  n.unlinkGameCenter,
		"unlink_google":                      n.unlinkGoogle,
		"unlink_steam":                       n.unlinkSteam,
		"stream_user_list":                   n.streamUserList,
		"stream_user_get":                    n.streamUserGet,
		"stream_user_join":                   n.streamUserJoin,
		"stream_user_update":                 n.streamUserUpdate,
		"stream_user_leave":                  n.streamUserLeave,
		"stream_user_kick":                   n.streamUserKick,
		"stream_count":                       n.streamCount,
		"stream_close":                       n.streamClose,
		"stream_send":                        n.streamSend,
		"stream_send_raw":                    n.streamSendRaw,
		"session_disconnect":                 n.sessionDisconnect,
		"session_logout":                     n.sessionLogout,
		"match_create":                       n.matchCreate,
		"match_get":                          n.matchGet,
		"match_list":                         n.matchList,
		"notification_send":                  n.notificationSend,
		"notifications_send":                 n.notificationsSend,
		"wallet_update":                      n.walletUpdate,
		"wallets_update":                     n.walletsUpdate,
		"wallet_ledger_update":               n.walletLedgerUpdate,
		"wallet_ledger_list":                 n.walletLedgerList,
		"storage_list":                       n.storageList,
		"storage_read":                       n.storageRead,
		"storage_write":                      n.storageWrite,
		"storage_delete":                     n.storageDelete,
		"multi_update":                       n.multiUpdate,
		"leaderboard_create":                 n.leaderboardCreate,
		"leaderboard_delete":                 n.leaderboardDelete,
		"leaderboard_list":                   n.leaderboardList,
		"leaderboard_records_list":           n.leaderboardRecordsList,
		"leaderboard_record_write":           n.leaderboardRecordWrite,
		"leaderboard_record_delete":          n.leaderboardRecordDelete,
		"leaderboards_get_id":                n.leaderboardsGetId,
		"purchase_validate_apple":            n.purchaseValidateApple,
		"purchase_validate_google":           n.purchaseValidateGoogle,
		"purchase_validate_huawei":           n.purchaseValidateHuawei,
		"purchase_get_by_transaction_id":     n.purchaseGetByTransactionId,
		"purchases_list":                     n.purchasesList,
		"tournament_create":                  n.tournamentCreate,
		"tournament_delete":                  n.tournamentDelete,
		"tournament_add_attempt":             n.tournamentAddAttempt,
		"tournament_join":                    n.tournamentJoin,
		"tournament_list":                    n.tournamentList,
		"tournaments_get_id":                 n.tournamentsGetId,
		"tournament_records_list":            n.tournamentRecordsList,
		"tournament_record_write":            n.tournamentRecordWrite,
		"tournament_records_haystack":        n.tournamentRecordsHaystack,
		"groups_get_id":                      n.groupsGetId,
		"group_create":                       n.groupCreate,
		"group_update":                       n.groupUpdate,
		"group_delete":                       n.groupDelete,
		"group_user_join":                    n.groupUserJoin,
		"group_user_leave":                   n.groupUserLeave,
		"group_users_add":                    n.groupUsersAdd,
		"group_users_promote":                n.groupUsersPromote,
		"group_users_demote":                 n.groupUsersDemote,
		"group_users_list":                   n.groupUsersList,
		"group_users_kick":                   n.groupUsersKick,
		"groups_list":                        n.groupsList,
		"user_groups_list":                   n.userGroupsList,
		"friends_list":                       n.friendsList,
		"file_read":                          n.fileRead,
		"channel_message_send":               n.channelMessageSend,
		"channel_id_build":                   n.channelIdBuild,
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

		ctx := NewRuntimeLuaContext(l, n.config.GetName(), RuntimeLuaConvertMapString(l, n.config.GetRuntime().Environment), RuntimeExecutionModeRunOnce, nil, 0, "", "", nil, "", "", "", "")

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

func (n *RuntimeLuaNakamaModule) getContext(l *lua.LState) int {
	ctx := NewRuntimeLuaContext(l, n.config.GetName(), RuntimeLuaConvertMapString(l, n.config.GetRuntime().Environment), RuntimeExecutionModeRunOnce, nil, 0, "", "", nil, "", "", "", "")
	l.Push(ctx)
	return 1
}

func (n *RuntimeLuaNakamaModule) event(l *lua.LState) int {
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects name string")
		return 0
	}

	propertiesTable := l.OptTable(2, nil)
	var properties map[string]string
	if propertiesTable != nil {
		var conversionError bool
		properties = make(map[string]string, propertiesTable.Len())
		propertiesTable.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError {
				return
			}

			if k.Type() != lua.LTString {
				l.ArgError(2, "properties keys must be strings")
				conversionError = true
				return
			}
			if v.Type() != lua.LTString {
				l.ArgError(2, "properties values must be strings")
				conversionError = true
				return
			}

			properties[k.String()] = v.String()
		})

		if conversionError {
			return 0
		}
	}

	var ts *timestamppb.Timestamp
	t := l.Get(3)
	if t != lua.LNil {
		if t.Type() != lua.LTNumber {
			l.ArgError(3, "timestamp must be numeric UTC seconds when provided")
			return 0
		}
		ts = &timestamppb.Timestamp{Seconds: int64(t.(lua.LNumber))}
	}

	external := l.OptBool(4, false)

	if n.eventFn != nil {
		n.eventFn(l.Context(), &api.Event{
			Name:       name,
			Properties: properties,
			Timestamp:  ts,
			External:   external,
		})
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) localcacheGet(l *lua.LState) int {
	key := l.CheckString(1)
	if key == "" {
		l.ArgError(1, "expects key string")
		return 0
	}

	defaultValue := l.Get(2)

	value, found := n.localCache.Get(key)

	if found {
		l.Push(value)
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

	value := l.Get(2)
	if valueTable, ok := value.(*lua.LTable); ok {
		valueTable.SetReadOnlyRecursive()
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
		for i := range resultRowValues {
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
		vs, ok := v.(string)
		if !ok {
			l.RaiseError("HTTP header values must be strings")
			return 0
		}
		req.Header.Add(k, vs)
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

func (n *RuntimeLuaNakamaModule) jwtGenerate(l *lua.LState) int {
	algoType := l.CheckString(1)
	if algoType == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	var signingMethod jwt.SigningMethod
	switch algoType {
	case "HS256":
		signingMethod = jwt.SigningMethodHS256
	case "RS256":
		signingMethod = jwt.SigningMethodRS256
	default:
		l.ArgError(1, "unsupported algo type - only allowed 'HS256', 'RS256'.")
		return 0
	}

	signingKey := l.CheckString(2)
	if signingKey == "" {
		l.ArgError(2, "expects string")
		return 0
	}

	claimsetTable := l.CheckTable(3)
	if claimsetTable == nil {
		l.ArgError(3, "expects nil")
		return 0
	}

	claimset := RuntimeLuaConvertLuaValue(claimsetTable).(map[string]interface{})
	jwtClaims := jwt.MapClaims{}
	for k, v := range claimset {
		jwtClaims[k] = v
	}

	var pk interface{}
	switch signingMethod {
	case jwt.SigningMethodRS256:
		block, _ := pem.Decode([]byte(signingKey))
		if block == nil {
			l.RaiseError("could not parse private key: no valid blocks found")
			return 0
		}

		var err error
		pk, err = x509.ParsePKCS8PrivateKey(block.Bytes)
		if err != nil {
			l.RaiseError("could not parse private key: %v", err.Error())
			return 0
		}
	case jwt.SigningMethodHS256:
		pk = []byte(signingKey)
	}

	token := jwt.NewWithClaims(signingMethod, jwtClaims)
	signedToken, err := token.SignedString(pk)
	if err != nil {
		l.RaiseError("failed to sign token: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(signedToken))
	return 1
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

func (n *RuntimeLuaNakamaModule) rsaSHA256Hash(l *lua.LState) int {
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

	block, _ := pem.Decode([]byte(key))
	if block == nil {
		l.RaiseError("could not parse private key: no valid blocks found")
		return 0
	}

	rsaPrivateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		l.RaiseError("error parsing key: %v", err.Error())
		return 0
	}

	hashed := sha256.Sum256([]byte(input))
	signature, err := rsa.SignPKCS1v15(rand.Reader, rsaPrivateKey, crypto.SHA256, hashed[:])
	if err != nil {
		l.RaiseError("error signing input: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(signature))
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

func (n *RuntimeLuaNakamaModule) authenticateApple(l *lua.LState) int {
	if n.config.GetSocial().Apple.BundleId == "" {
		l.RaiseError("Apple authentication is not configured")
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
	} else if invalidUsernameRegex.MatchString(username) {
		l.ArgError(2, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(2, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(3, true)

	dbUserID, dbUsername, created, err := AuthenticateApple(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().Apple.BundleId, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
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
	} else if invalidUsernameRegex.MatchString(username) {
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
	} else if invalidUsernameRegex.MatchString(username) {
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
	} else if invalidUsernameRegex.MatchString(username) {
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
	} else if invalidUsernameRegex.MatchString(username) {
		l.ArgError(3, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(3, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(4, true)

	dbUserID, dbUsername, created, importFriendsPossible, err := AuthenticateFacebook(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	// Import friends if requested.
	if importFriends && importFriendsPossible {
		// Errors are logged before this point and failure here does not invalidate the whole operation.
		_ = importFacebookFriends(l.Context(), n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

func (n *RuntimeLuaNakamaModule) authenticateFacebookInstantGame(l *lua.LState) int {
	// Parse access token.
	signedPlayerInfo := l.CheckString(1)
	if signedPlayerInfo == "" {
		l.ArgError(1, "expects signed player info")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(2, "")
	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		l.ArgError(2, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(2, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(3, true)

	dbUserID, dbUsername, created, err := AuthenticateFacebookInstantGame(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookInstantGame.AppSecret, signedPlayerInfo, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
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
	ts := l.CheckInt64(3)
	if ts == 0 {
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
	publicKeyURL := l.CheckString(6)
	if publicKeyURL == "" {
		l.ArgError(6, "expects public key URL string")
		return 0
	}

	// Parse username, if any.
	username := l.OptString(7, "")
	if username == "" {
		username = generateUsername()
	} else if invalidUsernameRegex.MatchString(username) {
		l.ArgError(7, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(7, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(8, true)

	dbUserID, dbUsername, created, err := AuthenticateGameCenter(l.Context(), n.logger, n.db, n.socialClient, playerID, bundleID, ts, salt, signature, publicKeyURL, username, create)
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
	} else if invalidUsernameRegex.MatchString(username) {
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
	} else if invalidUsernameRegex.MatchString(username) {
		l.ArgError(3, "expects username to be valid, no spaces or control characters allowed")
		return 0
	} else if len(username) > 128 {
		l.ArgError(3, "expects id to be valid, must be 1-128 bytes")
		return 0
	}

	// Parse create flag, if any.
	create := l.OptBool(4, true)

	dbUserID, dbUsername, steamID, created, err := AuthenticateSteam(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	// Import friends if requested.
	if importFriends {
		// Errors are logged before this point and failure here does not invalidate the whole operation.
		_ = importSteamFriends(l.Context(), n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, n.config.GetSocial().Steam.PublisherKey, steamID, false)
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
	uid, err := uuid.FromString(userIDString)
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

	vars := l.OptTable(4, nil)
	var varsMap map[string]string
	if vars != nil {
		var conversionError string
		varsMap = make(map[string]string, vars.Len())
		vars.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError != "" {
				return
			}

			if k.Type() != lua.LTString {
				conversionError = "vars keys must be strings"
				return
			}
			if v.Type() != lua.LTString {
				conversionError = "vars values must be strings"
				return
			}

			varsMap[k.String()] = v.String()
		})

		if conversionError != "" {
			l.ArgError(4, conversionError)
			return 0
		}
	}

	token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, userIDString, username, varsMap, exp)
	n.sessionCache.Add(uid, exp, token, 0, "")

	l.Push(lua.LString(token))
	l.Push(lua.LNumber(exp))
	return 2
}

func (n *RuntimeLuaNakamaModule) getLuaModule(l *lua.LState) string {
	// "path/to/module.lua:123:"
	src := l.Where(-1)
	// "path/to/module.lua:123"
	return strings.TrimPrefix(src[:len(src)-1], n.config.GetRuntime().Path)
}

func (n *RuntimeLuaNakamaModule) loggerDebug(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}

	ctxLogFields := l.Context().Value(ctxLoggerFields{})
	if ctxLogFields != nil {
		logFields, ok := ctxLogFields.(map[string]string)
		if ok {
			fields := make([]zap.Field, 0, len(logFields)+1)
			fields = append(fields, zap.String("runtime", "lua"))
			for key, val := range logFields {
				fields = append(fields, zap.String(key, val))
			}
			n.logger.Debug(message, fields...)
		}
	} else {
		n.logger.Debug(message, zap.String("runtime", "lua"))
	}

	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) loggerInfo(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}

	ctxLogFields := l.Context().Value(ctxLoggerFields{})
	if ctxLogFields != nil {
		logFields, ok := ctxLogFields.(map[string]string)
		if ok {
			fields := make([]zap.Field, 0, len(logFields)+1)
			fields = append(fields, zap.String("runtime", "lua"))
			for key, val := range logFields {
				fields = append(fields, zap.String(key, val))
			}
			n.logger.Info(message, fields...)
		}
	} else {
		n.logger.Info(message, zap.String("runtime", "lua"))
	}

	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) loggerWarn(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}

	ctxLogFields := l.Context().Value(ctxLoggerFields{})
	if ctxLogFields != nil {
		logFields, ok := ctxLogFields.(map[string]string)
		if ok {
			fields := make([]zap.Field, 0, len(logFields)+1)
			fields = append(fields, zap.String("runtime", "lua"))
			for key, val := range logFields {
				fields = append(fields, zap.String(key, val))
			}
			n.logger.Warn(message, fields...)
		}
	} else {
		n.logger.Warn(message, zap.String("runtime", "lua"))
	}

	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) loggerError(l *lua.LState) int {
	message := l.CheckString(1)
	if message == "" {
		l.ArgError(1, "expects message string")
		return 0
	}

	ctxLogFields := l.Context().Value(ctxLoggerFields{})
	if ctxLogFields != nil {
		logFields, ok := ctxLogFields.(map[string]string)
		if ok {
			fields := make([]zap.Field, 0, len(logFields)+1)
			fields = append(fields, zap.String("runtime", "lua"))
			for key, val := range logFields {
				fields = append(fields, zap.String(key, val))
			}
			n.logger.Error(message, fields...)
		}
	} else {
		n.logger.Error(message, zap.String("runtime", "lua"), zap.String("source", n.getLuaModule(l)))
	}

	l.Push(lua.LString(message))
	return 1
}

func (n *RuntimeLuaNakamaModule) accountGetId(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(input)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	account, err := GetAccount(l.Context(), n.logger, n.db, n.tracker, userID)
	if err != nil {
		l.RaiseError("failed to get account for user_id %s: %s", userID, err.Error())
		return 0
	}

	accountTable := l.CreateTable(0, 25)
	accountTable.RawSetString("user_id", lua.LString(account.User.Id))
	accountTable.RawSetString("username", lua.LString(account.User.Username))
	accountTable.RawSetString("display_name", lua.LString(account.User.DisplayName))
	accountTable.RawSetString("avatar_url", lua.LString(account.User.AvatarUrl))
	accountTable.RawSetString("lang_tag", lua.LString(account.User.LangTag))
	accountTable.RawSetString("location", lua.LString(account.User.Location))
	accountTable.RawSetString("timezone", lua.LString(account.User.Timezone))
	if account.User.AppleId != "" {
		accountTable.RawSetString("apple_id", lua.LString(account.User.AppleId))
	}
	if account.User.FacebookId != "" {
		accountTable.RawSetString("facebook_id", lua.LString(account.User.FacebookId))
	}
	if account.User.FacebookInstantGameId != "" {
		accountTable.RawSetString("facebook_instant_game_id", lua.LString(account.User.FacebookInstantGameId))
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

	userTable, err := userToLuaTable(l, account.User)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert user data to lua table: %s", err.Error()))
		return 0
	}
	accountTable.RawSetString("user", userTable)

	walletMap := make(map[string]int64)
	err = json.Unmarshal([]byte(account.Wallet), &walletMap)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to convert wallet to json: %s", err.Error()))
		return 0
	}
	walletTable := RuntimeLuaConvertMapInt64(l, walletMap)
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
	if account.DisableTime != nil {
		accountTable.RawSetString("disable_time", lua.LNumber(account.DisableTime.Seconds))
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
		accountTable := l.CreateTable(0, 25)
		accountTable.RawSetString("user_id", lua.LString(account.User.Id))
		accountTable.RawSetString("username", lua.LString(account.User.Username))
		accountTable.RawSetString("display_name", lua.LString(account.User.DisplayName))
		accountTable.RawSetString("avatar_url", lua.LString(account.User.AvatarUrl))
		accountTable.RawSetString("lang_tag", lua.LString(account.User.LangTag))
		accountTable.RawSetString("location", lua.LString(account.User.Location))
		accountTable.RawSetString("timezone", lua.LString(account.User.Timezone))
		if account.User.AppleId != "" {
			accountTable.RawSetString("apple_id", lua.LString(account.User.AppleId))
		}
		if account.User.FacebookId != "" {
			accountTable.RawSetString("facebook_id", lua.LString(account.User.FacebookId))
		}
		if account.User.FacebookInstantGameId != "" {
			accountTable.RawSetString("facebook_instant_game_id", lua.LString(account.User.FacebookInstantGameId))
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

		userTable, err := userToLuaTable(l, account.User)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert user data to lua table: %s", err.Error()))
			return 0
		}
		accountTable.RawSetString("user", userTable)

		walletMap := make(map[string]int64)
		err = json.Unmarshal([]byte(account.Wallet), &walletMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert wallet to json: %s", err.Error()))
			return 0
		}
		walletTable := RuntimeLuaConvertMapInt64(l, walletMap)
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
		if account.DisableTime != nil {
			accountTable.RawSetString("disable_time", lua.LNumber(account.DisableTime.Seconds))
		}

		accountsTable.RawSetInt(i+1, accountTable)
	}

	l.Push(accountsTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) usersGetId(l *lua.LState) int {
	// User IDs Input table validation.
	userIDsIn := l.OptTable(1, nil)
	var userIDs []string
	if userIDsIn != nil {
		userIDsTable, ok := RuntimeLuaConvertLuaValue(userIDsIn).([]interface{})
		if !ok {
			l.ArgError(1, "invalid user ids list")
			return 0
		}

		userIDStrings := make([]string, 0, len(userIDsTable))
		for _, id := range userIDsTable {
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
		userIDs = userIDStrings
	}

	// Facebook IDs Input table validation.
	facebookIDsIn := l.OptTable(2, nil)
	var facebookIDs []string
	if facebookIDsIn != nil {
		facebookIDsTable, ok := RuntimeLuaConvertLuaValue(facebookIDsIn).([]interface{})
		if !ok {
			l.ArgError(1, "invalid facebook ids list")
			return 0
		}

		facebookIDStrings := make([]string, 0, len(facebookIDsTable))
		for _, id := range facebookIDsTable {
			if ids, ok := id.(string); !ok || ids == "" {
				l.ArgError(1, "each facebook id must be a string")
				return 0
			} else {
				facebookIDStrings = append(facebookIDStrings, ids)
			}
		}
		facebookIDs = facebookIDStrings
	}

	if userIDs == nil && facebookIDs == nil {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.tracker, userIDs, nil, facebookIDs)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, user := range users.Users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}
		usersTable.RawSetInt(i+1, userTable)
	}

	l.Push(usersTable)
	return 1
}

func userToLuaTable(l *lua.LState, user *api.User) (*lua.LTable, error) {
	ut := l.CreateTable(0, 18)
	ut.RawSetString("user_id", lua.LString(user.Id))
	ut.RawSetString("username", lua.LString(user.Username))
	ut.RawSetString("display_name", lua.LString(user.DisplayName))
	ut.RawSetString("avatar_url", lua.LString(user.AvatarUrl))
	ut.RawSetString("lang_tag", lua.LString(user.LangTag))
	ut.RawSetString("location", lua.LString(user.Location))
	ut.RawSetString("timezone", lua.LString(user.Timezone))
	if user.AppleId != "" {
		ut.RawSetString("apple_id", lua.LString(user.AppleId))
	}
	if user.FacebookId != "" {
		ut.RawSetString("facebook_id", lua.LString(user.FacebookId))
	}
	if user.FacebookInstantGameId != "" {
		ut.RawSetString("facebook_instant_game_id", lua.LString(user.FacebookInstantGameId))
	}
	if user.GoogleId != "" {
		ut.RawSetString("google_id", lua.LString(user.GoogleId))
	}
	if user.GamecenterId != "" {
		ut.RawSetString("gamecenter_id", lua.LString(user.GamecenterId))
	}
	if user.SteamId != "" {
		ut.RawSetString("steam_id", lua.LString(user.SteamId))
	}
	ut.RawSetString("online", lua.LBool(user.Online))
	ut.RawSetString("edge_count", lua.LNumber(user.EdgeCount))
	ut.RawSetString("create_time", lua.LNumber(user.CreateTime.Seconds))
	ut.RawSetString("update_time", lua.LNumber(user.UpdateTime.Seconds))

	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(user.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	ut.RawSetString("metadata", metadataTable)

	return ut, nil
}

func validationToLuaTable(l *lua.LState, validation *api.ValidatePurchaseResponse) *lua.LTable {
	validatedPurchasesTable := l.CreateTable(len(validation.ValidatedPurchases), 0)
	for i, p := range validation.ValidatedPurchases {
		validatedPurchasesTable.RawSetInt(i+1, purchaseToLuaTable(l, p))
	}

	validationResponseTable := l.CreateTable(0, 1)
	validationResponseTable.RawSetString("validated_purchases", validatedPurchasesTable)

	return validationResponseTable
}

func purchaseToLuaTable(l *lua.LState, p *api.ValidatedPurchase) *lua.LTable {
	validatedPurchaseTable := l.CreateTable(0, 7)
	validatedPurchaseTable.RawSetString("product_id", lua.LString(p.ProductId))
	validatedPurchaseTable.RawSetString("transaction_id", lua.LString(p.TransactionId))
	validatedPurchaseTable.RawSetString("store", lua.LString(p.Store.String()))
	validatedPurchaseTable.RawSetString("provider_response", lua.LString(p.ProviderResponse))
	validatedPurchaseTable.RawSetString("purchase_time", lua.LNumber(p.PurchaseTime.Seconds))
	validatedPurchaseTable.RawSetString("create_time", lua.LNumber(p.CreateTime.Seconds))
	validatedPurchaseTable.RawSetString("update_time", lua.LNumber(p.UpdateTime.Seconds))

	return validatedPurchaseTable
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
		us, ok := u.(string)
		if !ok || us == "" {
			l.ArgError(1, "each username must be a string")
			return 0
		}
		usernameStrings = append(usernameStrings, us)
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.tracker, nil, usernameStrings, nil)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, user := range users.Users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}
		usersTable.RawSetInt(i+1, userTable)
	}

	l.Push(usersTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) usersGetRandom(l *lua.LState) int {
	count := l.OptInt(1, 0)

	if count < 0 || count > 1000 {
		l.ArgError(1, "count must be 0-1000")
		return 0
	}

	users, err := GetRandomUsers(l.Context(), n.logger, n.db, n.tracker, count)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get users: %s", err.Error()))
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users), 0)
	for i, user := range users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}
		usersTable.RawSetInt(i+1, userTable)
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
	uids := make([]uuid.UUID, 0, len(userIDs))
	for _, id := range userIDs {
		ids, ok := id.(string)
		if !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		}
		uid, err := uuid.FromString(ids)
		if err != nil {
			l.ArgError(1, "each user id must be a valid id string")
			return 0
		}
		uids = append(uids, uid)
	}

	// Ban the user accounts.
	err := BanUsers(l.Context(), n.logger, n.db, n.sessionCache, uids)
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
	uids := make([]uuid.UUID, 0, len(userIDs))
	for _, id := range userIDs {
		ids, ok := id.(string)
		if !ok || ids == "" {
			l.ArgError(1, "each user id must be a string")
			return 0
		}
		uid, err := uuid.FromString(ids)
		if err != nil {
			l.ArgError(1, "each user id must be a valid id string")
			return 0
		}
		uids = append(uids, uid)
	}

	// Unban the user accounts.
	err := UnbanUsers(l.Context(), n.logger, n.db, n.sessionCache, uids)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to unban users: %s", err.Error()))
		return 0
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) linkApple(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := LinkApple(l.Context(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkCustom(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	customID := l.CheckString(2)
	if customID == "" {
		l.ArgError(2, "expects custom ID string")
		return 0
	}

	if err := LinkCustom(l.Context(), n.logger, n.db, id, customID); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkDevice(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	deviceID := l.CheckString(2)
	if deviceID == "" {
		l.ArgError(2, "expects device ID string")
		return 0
	}

	if err := LinkDevice(l.Context(), n.logger, n.db, id, deviceID); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkEmail(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	email := l.CheckString(2)
	if email == "" {
		l.ArgError(2, "expects email string")
		return 0
	}
	password := l.CheckString(3)
	if password == "" {
		l.ArgError(3, "expects username string")
		return 0
	}

	if err := LinkEmail(l.Context(), n.logger, n.db, id, email, password); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkFacebook(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username string")
		return 0
	}
	token := l.CheckString(3)
	if token == "" {
		l.ArgError(3, "expects token string")
		return 0
	}
	importFriends := l.OptBool(4, true)

	if err := LinkFacebook(l.Context(), n.logger, n.db, n.socialClient, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkFacebookInstantGame(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	signedPlayerInfo := l.CheckString(2)
	if signedPlayerInfo == "" {
		l.ArgError(2, "expects signed player info string")
		return 0
	}

	if err := LinkFacebookInstantGame(l.Context(), n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkGameCenter(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	playerID := l.CheckString(2)
	if playerID == "" {
		l.ArgError(2, "expects player ID string")
		return 0
	}
	bundleID := l.CheckString(3)
	if bundleID == "" {
		l.ArgError(3, "expects bundle ID string")
		return 0
	}
	ts := l.CheckInt64(4)
	if ts == 0 {
		l.ArgError(4, "expects timestamp value")
		return 0
	}
	salt := l.CheckString(5)
	if salt == "" {
		l.ArgError(5, "expects salt string")
		return 0
	}
	signature := l.CheckString(6)
	if signature == "" {
		l.ArgError(6, "expects signature string")
		return 0
	}
	publicKeyURL := l.CheckString(7)
	if publicKeyURL == "" {
		l.ArgError(7, "expects public key URL string")
		return 0
	}

	if err := LinkGameCenter(l.Context(), n.logger, n.db, n.socialClient, id, playerID, bundleID, ts, salt, signature, publicKeyURL); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkGoogle(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := LinkGoogle(l.Context(), n.logger, n.db, n.socialClient, id, token); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) linkSteam(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username string")
		return 0
	}
	token := l.CheckString(3)
	if token == "" {
		l.ArgError(3, "expects token string")
		return 0
	}
	importFriends := l.OptBool(4, true)

	if err := LinkSteam(l.Context(), n.logger, n.db, n.config, n.socialClient, n.router, id, username, token, importFriends); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkApple(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := UnlinkApple(l.Context(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkCustom(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	customID := l.CheckString(2)
	if customID == "" {
		l.ArgError(2, "expects custom ID string")
		return 0
	}

	if err := UnlinkCustom(l.Context(), n.logger, n.db, id, customID); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkDevice(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	deviceID := l.CheckString(2)
	if deviceID == "" {
		l.ArgError(2, "expects device ID string")
		return 0
	}

	if err := UnlinkDevice(l.Context(), n.logger, n.db, id, deviceID); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkEmail(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	email := l.CheckString(2)
	if email == "" {
		l.ArgError(2, "expects email string")
		return 0
	}

	if err := UnlinkEmail(l.Context(), n.logger, n.db, id, email); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkFacebook(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := UnlinkFacebook(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkFacebookInstantGame(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	signedPlayerInfo := l.CheckString(2)
	if signedPlayerInfo == "" {
		l.ArgError(2, "expects signed player info string")
		return 0
	}

	if err := UnlinkFacebookInstantGame(l.Context(), n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkGameCenter(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	playerID := l.CheckString(2)
	if playerID == "" {
		l.ArgError(2, "expects player ID string")
		return 0
	}
	bundleID := l.CheckString(3)
	if bundleID == "" {
		l.ArgError(3, "expects bundle ID string")
		return 0
	}
	ts := l.CheckInt64(4)
	if ts == 0 {
		l.ArgError(4, "expects timestamp value")
		return 0
	}
	salt := l.CheckString(5)
	if salt == "" {
		l.ArgError(5, "expects salt string")
		return 0
	}
	signature := l.CheckString(6)
	if signature == "" {
		l.ArgError(6, "expects signature string")
		return 0
	}
	publicKeyURL := l.CheckString(7)
	if publicKeyURL == "" {
		l.ArgError(7, "expects public key URL string")
		return 0
	}

	if err := UnlinkGameCenter(l.Context(), n.logger, n.db, n.socialClient, id, playerID, bundleID, ts, salt, signature, publicKeyURL); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkGoogle(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := UnlinkGoogle(l.Context(), n.logger, n.db, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) unlinkSteam(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.CheckString(2)
	if token == "" {
		l.ArgError(2, "expects token string")
		return 0
	}

	if err := UnlinkSteam(l.Context(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
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
		presenceTable.RawSetString("node", lua.LString(p.ID.Node))
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

	// By default generate presence events.
	hidden := l.OptBool(4, false)
	// By default persistence is enabled, if the stream supports it.
	persistence := l.OptBool(5, true)
	// By default no status is set.
	status := l.OptString(6, "")

	success, newlyTracked, err := n.streamManager.UserJoin(stream, userID, sessionID, hidden, persistence, status)
	if err != nil {
		if err == ErrSessionNotFound {
			l.ArgError(2, "session id does not exist")
			return 0
		}
		l.RaiseError(fmt.Sprintf("stream user join failed: %v", err.Error()))
		return 0
	}
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

	// By default generate presence events.
	hidden := l.OptBool(4, false)
	// By default persistence is enabled, if the stream supports it.
	persistence := l.OptBool(5, true)
	// By default no status is set.
	status := l.OptString(6, "")

	success, err := n.streamManager.UserUpdate(stream, userID, sessionID, hidden, persistence, status)
	if err != nil {
		if err == ErrSessionNotFound {
			l.ArgError(2, "session id does not exist")
			return 0
		}
		l.RaiseError(fmt.Sprintf("stream user update failed: %v", err.Error()))
		return 0
	}
	if !success {
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

	if err := n.streamManager.UserLeave(stream, userID, sessionID); err != nil {
		l.RaiseError(fmt.Sprintf("stream user leave failed: %v", err.Error()))
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) streamUserKick(l *lua.LState) int {
	// Parse presence.
	presenceTable := l.OptTable(1, nil)
	if presenceTable == nil {
		l.ArgError(1, "expects a valid presence")
		return 0
	}
	userID := uuid.Nil
	sessionID := uuid.Nil
	node := n.node
	conversionError := false
	presenceTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "user_id":
			uid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(1, "expects each presence to have a valid user_id")
				return
			}
			userID = uid
		case "session_id":
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(1, "expects each presence to have a valid session_id")
				return
			}
			sessionID = sid
		case "node":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(1, "expects node to be string")
				return
			}
			node = v.String()
		}
	})
	if conversionError {
		return 0
	}
	if userID == uuid.Nil || sessionID == uuid.Nil || node == "" {
		l.ArgError(1, "expects each presence to have a valid user_id, session_id, and node")
		return 0
	}

	// Parse input stream identifier.
	streamTable := l.CheckTable(2)
	if streamTable == nil {
		l.ArgError(2, "expects a valid stream")
		return 0
	}
	stream := PresenceStream{}
	streamTable.ForEach(func(k lua.LValue, v lua.LValue) {
		if conversionError {
			return
		}

		switch k.String() {
		case "mode":
			if v.Type() != lua.LTNumber {
				conversionError = true
				l.ArgError(2, "stream mode must be a number")
				return
			}
			stream.Mode = uint8(lua.LVAsNumber(v))
		case "subject":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(2, "stream subject must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(2, "stream subject must be a valid identifier")
				return
			}
			stream.Subject = sid
		case "subcontext":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(2, "stream subcontext must be a string")
				return
			}
			sid, err := uuid.FromString(v.String())
			if err != nil {
				conversionError = true
				l.ArgError(2, "stream subcontext must be a valid identifier")
				return
			}
			stream.Subcontext = sid
		case "label":
			if v.Type() != lua.LTString {
				conversionError = true
				l.ArgError(2, "stream label must be a string")
				return
			}
			stream.Label = v.String()
		}
	})
	if conversionError {
		return 0
	}

	if err := n.streamManager.UserLeave(stream, userID, sessionID); err != nil {
		l.RaiseError(fmt.Sprintf("stream user kick failed: %v", err.Error()))
	}

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
					case "node":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence node must be a string")
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

	// Check if the message is intended to be sent reliably or not.
	reliable := l.OptBool(4, true)

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
		Data:     data,
		Reliable: reliable,
	}}}

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg, reliable)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
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
		l.ArgError(2, fmt.Sprintf("failed to convert envelope: %s", err.Error()))
		return 0
	}

	msg := &rtapi.Envelope{}
	if err = n.protojsonUnmarshaler.Unmarshal(envelopeBytes, msg); err != nil {
		l.ArgError(2, fmt.Sprintf("not a valid envelope: %s", err.Error()))
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
					case "node":
						if v.Type() != lua.LTString {
							conversionError = true
							l.ArgError(3, "presence node must be a string")
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

	// Check if the message is intended to be sent reliably or not.
	reliable := l.OptBool(4, true)

	if len(presenceIDs) == 0 {
		// Sending to whole stream.
		n.router.SendToStream(n.logger, stream, msg, reliable)
	} else {
		// Sending to a subset of stream users.
		n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
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

	reason := make([]runtime.PresenceReason, 0, 1)
	reasonInt := l.OptInt64(2, 0)
	if reasonInt != 0 {
		if reasonInt < 0 || reasonInt > 4 {
			l.ArgError(2, "invalid disconnect reason, must be a value 0-4")
			return 0
		}
		reason = append(reason, runtime.PresenceReason(reasonInt))
	}

	if err := n.sessionRegistry.Disconnect(l.Context(), sessionID, reason...); err != nil {
		l.RaiseError(fmt.Sprintf("failed to disconnect: %s", err.Error()))
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) sessionLogout(l *lua.LState) int {
	// Parse input.
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

	token := l.OptString(2, "")
	refreshToken := l.OptString(3, "")

	if err := SessionLogout(n.config, n.sessionCache, userID, token, refreshToken); err != nil {
		l.RaiseError(fmt.Sprintf("failed to logout: %s", err.Error()))
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

func (n *RuntimeLuaNakamaModule) matchGet(l *lua.LState) int {
	// Parse match ID.
	id := l.CheckString(1)

	result, err := n.matchRegistry.GetMatch(l.Context(), id)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get match: %s", err.Error()))
		return 0
	}

	if result == nil {
		l.Push(lua.LNil)
		return 1
	}

	match := l.CreateTable(0, 6)
	match.RawSetString("match_id", lua.LString(result.MatchId))
	match.RawSetString("authoritative", lua.LBool(result.Authoritative))
	if result.Label == nil {
		match.RawSetString("label", lua.LNil)
	} else {
		match.RawSetString("label", lua.LString(result.Label.Value))
	}
	match.RawSetString("size", lua.LNumber(result.Size))
	if result.TickRate != 0 {
		match.RawSetString("tick_rate", lua.LNumber(result.TickRate))
	} else {
		match.RawSetString("tick_rate", lua.LNil)
	}
	if result.HandlerName != "" {
		match.RawSetString("handler_name", lua.LString(result.HandlerName))
	} else {
		match.RawSetString("handler_name", lua.LNil)
	}

	l.Push(match)
	return 1
}

func (n *RuntimeLuaNakamaModule) matchList(l *lua.LState) int {
	// Parse limit.
	limit := l.OptInt(1, 1)

	// Parse authoritative flag.
	var authoritative *wrapperspb.BoolValue
	if v := l.Get(2); v.Type() != lua.LTNil {
		if v.Type() != lua.LTBool {
			l.ArgError(2, "expects authoritative true/false or nil")
			return 0
		}
		authoritative = &wrapperspb.BoolValue{Value: lua.LVAsBool(v)}
	}

	// Parse label filter.
	var label *wrapperspb.StringValue
	if v := l.Get(3); v.Type() != lua.LTNil {
		if v.Type() != lua.LTString {
			l.ArgError(3, "expects label string or nil")
			return 0
		}
		label = &wrapperspb.StringValue{Value: lua.LVAsString(v)}
	}

	// Parse minimum size filter.
	var minSize *wrapperspb.Int32Value
	if v := l.Get(4); v.Type() != lua.LTNil {
		if v.Type() != lua.LTNumber {
			l.ArgError(4, "expects minimum size number or nil")
			return 0
		}
		minSize = &wrapperspb.Int32Value{Value: int32(lua.LVAsNumber(v))}
	}

	// Parse maximum size filter.
	var maxSize *wrapperspb.Int32Value
	if v := l.Get(5); v.Type() != lua.LTNil {
		if v.Type() != lua.LTNumber {
			l.ArgError(5, "expects maximum size number or nil")
			return 0
		}
		maxSize = &wrapperspb.Int32Value{Value: int32(lua.LVAsNumber(v))}
	}

	var query *wrapperspb.StringValue
	if v := l.Get(6); v.Type() != lua.LTNil {
		if v.Type() != lua.LTString {
			l.ArgError(6, "expects query string or nil")
			return 0
		}
		query = &wrapperspb.StringValue{Value: lua.LVAsString(v)}
	}

	results, err := n.matchRegistry.ListMatches(l.Context(), limit, authoritative, label, minSize, maxSize, query)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to list matches: %s", err.Error()))
		return 0
	}

	matches := l.CreateTable(len(results), 0)
	for i, result := range results {
		match := l.CreateTable(0, 6)
		match.RawSetString("match_id", lua.LString(result.MatchId))
		match.RawSetString("authoritative", lua.LBool(result.Authoritative))
		if result.Label == nil {
			match.RawSetString("label", lua.LNil)
		} else {
			match.RawSetString("label", lua.LString(result.Label.Value))
		}
		match.RawSetString("size", lua.LNumber(result.Size))
		if result.TickRate != 0 {
			match.RawSetString("tick_rate", lua.LNumber(result.TickRate))
		} else {
			match.RawSetString("tick_rate", lua.LNil)
		}
		if result.HandlerName != "" {
			match.RawSetString("handler_name", lua.LString(result.HandlerName))
		} else {
			match.RawSetString("handler_name", lua.LNil)
		}
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
		l.ArgError(4, "expects code number to be a positive integer")
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
		CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
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
		notification.CreateTime = &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()}
		notification.SenderId = senderID.String()

		no := notifications[userID]
		if no == nil {
			no = make([]*api.Notification, 0, 1)
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
	changesetMapInt64 := make(map[string]int64, len(changesetMap))
	for k, v := range changesetMap {
		vi, ok := v.(int64)
		if !ok {
			l.ArgError(2, "expects changeset values to be whole numbers")
			return 0
		}
		changesetMapInt64[k] = vi
	}

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

	results, err := UpdateWallets(l.Context(), n.logger, n.db, []*walletUpdate{{
		UserID:    userID,
		Changeset: changesetMapInt64,
		Metadata:  string(metadataBytes),
	}}, updateLedger)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet: %s", err.Error()))
	}

	if len(results) == 0 {
		// May happen if user ID does not exist.
		l.RaiseError("user not found")
		return 0
	}

	l.Push(RuntimeLuaConvertMapInt64(l, results[0].Updated))
	l.Push(RuntimeLuaConvertMapInt64(l, results[0].Previous))
	return 2
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
				changeset := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
				update.Changeset = make(map[string]int64, len(changeset))
				for ck, cv := range changeset {
					cvi, ok := cv.(int64)
					if !ok {
						conversionError = true
						l.ArgError(1, "expects changeset values to be whole numbers")
						return
					}
					update.Changeset[ck] = cvi
				}
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

	results, err := UpdateWallets(l.Context(), n.logger, n.db, updates, updateLedger)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to update user wallet: %s", err.Error()))
	}

	resultsTable := l.CreateTable(len(results), 0)
	for i, result := range results {
		resultTable := l.CreateTable(0, 3)
		resultTable.RawSetString("user_id", lua.LString(result.UserID))
		if result.Previous == nil {
			resultTable.RawSetString("previous", lua.LNil)
		} else {
			resultTable.RawSetString("previous", RuntimeLuaConvertMapInt64(l, result.Previous))
		}
		if result.Updated == nil {
			resultTable.RawSetString("updated", lua.LNil)
		} else {
			resultTable.RawSetString("updated", RuntimeLuaConvertMapInt64(l, result.Updated))
		}
		resultsTable.RawSetInt(i+1, resultTable)
	}
	l.Push(resultsTable)
	return 1
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

	changesetTable := RuntimeLuaConvertMapInt64(l, item.Changeset)
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

	// Parse limit.
	limit := l.OptInt(2, 100)
	if limit < 0 || limit > 100 {
		l.ArgError(1, "expects limit to be 0-100")
		return 0
	}

	// Parse cursor.
	cursor := l.OptString(3, "")

	items, newCursor, err := ListWalletLedger(l.Context(), n.logger, n.db, userID, &limit, cursor)
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

		changesetTable := RuntimeLuaConvertMapInt64(l, item.Changeset)
		itemTable.RawSetString("changeset", changesetTable)

		metadataTable := RuntimeLuaConvertMap(l, item.Metadata)
		itemTable.RawSetString("metadata", metadataTable)

		itemsTable.RawSetInt(i+1, itemTable)
	}

	l.Push(itemsTable)
	l.Push(lua.LString(newCursor))

	return 2
}

func (n *RuntimeLuaNakamaModule) storageList(l *lua.LState) int {
	userIDString := l.OptString(1, "")
	collection := l.OptString(2, "")
	limit := l.CheckInt(3)
	cursor := l.OptString(4, "")

	var userID *uuid.UUID
	if userIDString != "" {
		uid, err := uuid.FromString(userIDString)
		if err != nil {
			l.ArgError(1, "expects empty or a valid user ID")
			return 0
		}
		userID = &uid
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

	ops := make(StorageOpWrites, 0, size)
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
				d.PermissionRead = &wrapperspb.Int32Value{Value: int32(v.(lua.LNumber))}
			case "permission_write":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects permission_write to be number")
					return
				}
				d.PermissionWrite = &wrapperspb.Int32Value{Value: int32(v.(lua.LNumber))}
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
			d.PermissionRead = &wrapperspb.Int32Value{Value: 1}
		}
		if d.PermissionWrite == nil {
			// Default to owner write if no permission_write is supplied.
			d.PermissionWrite = &wrapperspb.Int32Value{Value: 1}
		}

		ops = append(ops, &StorageOpWrite{
			OwnerID: userID.String(),
			Object:  d,
		})
	})
	if conversionError {
		return 0
	}

	acks, _, err := StorageWriteObjects(l.Context(), n.logger, n.db, true, ops)
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

	ops := make(StorageOpDeletes, 0, size)
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

		ops = append(ops, &StorageOpDelete{
			OwnerID:  userID.String(),
			ObjectID: objectID,
		})
	})
	if conversionError {
		return 0
	}

	if _, err := StorageDeleteObjects(l.Context(), n.logger, n.db, true, ops); err != nil {
		l.RaiseError(fmt.Sprintf("failed to remove storage: %s", err.Error()))
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) multiUpdate(l *lua.LState) int {
	// Process account update inputs.
	var accountUpdates []*accountUpdate
	accountTable := l.OptTable(1, nil)
	if accountTable != nil {
		size := accountTable.Len()
		accountUpdates = make([]*accountUpdate, 0, size)
		conversionError := false
		accountTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			dataTable, ok := v.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(1, "expects a valid set of account update data")
				return
			}

			update := &accountUpdate{}
			dataTable.ForEach(func(k, v lua.LValue) {
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
					if userID, err := uuid.FromString(v.String()); err != nil {
						conversionError = true
						l.ArgError(1, "expects user_id to be a valid ID")
						return
					} else {
						update.userID = userID
					}
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
						l.ArgError(1, fmt.Sprintf("error encoding metadata: %s", err.Error()))
						return
					}
					update.metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
				case "username":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects username to be string")
						return
					}
					update.username = v.String()
				case "display_name":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects display name to be string")
						return
					}
					update.displayName = &wrapperspb.StringValue{Value: v.String()}
				case "timezone":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects timezone to be string")
						return
					}
					update.timezone = &wrapperspb.StringValue{Value: v.String()}
				case "location":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects location to be string")
						return
					}
					update.location = &wrapperspb.StringValue{Value: v.String()}
				case "lang_tag":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects lang tag to be string")
						return
					}
					update.langTag = &wrapperspb.StringValue{Value: v.String()}
				case "avatar_url":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(1, "expects avatar url to be string")
						return
					}
					update.avatarURL = &wrapperspb.StringValue{Value: v.String()}
				}
			})
			if conversionError {
				return
			}

			if update.userID == uuid.Nil {
				conversionError = true
				l.ArgError(1, "expects a valid user ID")
				return
			}

			accountUpdates = append(accountUpdates, update)
		})
	}

	// Process storage update inputs.
	var storageWriteOps StorageOpWrites
	storageTable := l.OptTable(2, nil)
	if storageTable != nil {
		size := storageTable.Len()
		storageWriteOps = make(StorageOpWrites, 0, size)
		conversionError := false
		storageTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			dataTable, ok := v.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(2, "expects a valid set of storage data")
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
						l.ArgError(2, "expects collection to be string")
						return
					}
					d.Collection = v.String()
					if d.Collection == "" {
						conversionError = true
						l.ArgError(2, "expects collection to be a non-empty string")
						return
					}
				case "key":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(2, "expects key to be string")
						return
					}
					d.Key = v.String()
					if d.Key == "" {
						conversionError = true
						l.ArgError(2, "expects key to be a non-empty string")
						return
					}
				case "user_id":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(2, "expects user_id to be string")
						return
					}
					var err error
					if userID, err = uuid.FromString(v.String()); err != nil {
						conversionError = true
						l.ArgError(2, "expects user_id to be a valid ID")
						return
					}
				case "value":
					if v.Type() != lua.LTTable {
						conversionError = true
						l.ArgError(2, "expects value to be table")
						return
					}
					valueMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
					valueBytes, err := json.Marshal(valueMap)
					if err != nil {
						conversionError = true
						l.ArgError(2, fmt.Sprintf("failed to convert value: %s", err.Error()))
						return
					}
					d.Value = string(valueBytes)
				case "version":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(2, "expects version to be string")
						return
					}
					d.Version = v.String()
					if d.Version == "" {
						conversionError = true
						l.ArgError(2, "expects version to be a non-empty string")
						return
					}
				case "permission_read":
					if v.Type() != lua.LTNumber {
						conversionError = true
						l.ArgError(2, "expects permission_read to be number")
						return
					}
					d.PermissionRead = &wrapperspb.Int32Value{Value: int32(v.(lua.LNumber))}
				case "permission_write":
					if v.Type() != lua.LTNumber {
						conversionError = true
						l.ArgError(2, "expects permission_write to be number")
						return
					}
					d.PermissionWrite = &wrapperspb.Int32Value{Value: int32(v.(lua.LNumber))}
				}
			})

			if conversionError {
				return
			}

			if d.Collection == "" {
				conversionError = true
				l.ArgError(2, "expects collection to be supplied")
				return
			} else if d.Key == "" {
				conversionError = true
				l.ArgError(2, "expects key to be supplied")
				return
			} else if d.Value == "" {
				conversionError = true
				l.ArgError(2, "expects value to be supplied")
				return
			}

			if d.PermissionRead == nil {
				// Default to owner read if no permission_read is supplied.
				d.PermissionRead = &wrapperspb.Int32Value{Value: 1}
			}
			if d.PermissionWrite == nil {
				// Default to owner write if no permission_write is supplied.
				d.PermissionWrite = &wrapperspb.Int32Value{Value: 1}
			}

			storageWriteOps = append(storageWriteOps, &StorageOpWrite{
				OwnerID: userID.String(),
				Object:  d,
			})
		})
		if conversionError {
			return 0
		}
	}

	// Process wallet update inputs.
	var walletUpdates []*walletUpdate
	walletTable := l.OptTable(3, nil)
	if walletTable != nil {
		size := walletTable.Len()
		walletUpdates = make([]*walletUpdate, 0, size)
		conversionError := false
		walletTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			updateTable, ok := v.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(3, "expects a valid set of updates")
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
						l.ArgError(3, "expects user_id to be string")
						return
					}
					uid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(3, "expects user_id to be a valid ID")
						return
					}
					update.UserID = uid
				case "changeset":
					if v.Type() != lua.LTTable {
						conversionError = true
						l.ArgError(3, "expects changeset to be table")
						return
					}
					changeset := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
					update.Changeset = make(map[string]int64, len(changeset))
					for ck, cv := range changeset {
						cvi, ok := cv.(int64)
						if !ok {
							conversionError = true
							l.ArgError(3, "expects changeset values to be whole numbers")
							return
						}
						update.Changeset[ck] = cvi
					}
				case "metadata":
					if v.Type() != lua.LTTable {
						conversionError = true
						l.ArgError(3, "expects metadata to be table")
						return
					}
					metadataMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
					metadataBytes, err := json.Marshal(metadataMap)
					if err != nil {
						conversionError = true
						l.ArgError(3, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
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
				l.ArgError(3, "expects changeset to be supplied")
				return
			}

			walletUpdates = append(walletUpdates, update)
		})
		if conversionError {
			return 0
		}
	}

	updateLedger := l.OptBool(4, false)

	acks, results, err := MultiUpdate(l.Context(), n.logger, n.db, accountUpdates, storageWriteOps, walletUpdates, updateLedger)
	if err != nil {
		l.RaiseError("error running multi update: %v", err.Error())
		return 0
	}

	if len(acks) == 0 {
		l.Push(lua.LNil)
	} else {
		lv := l.CreateTable(len(acks), 0)
		for i, k := range acks {
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
	}

	if len(results) == 0 {
		l.Push(lua.LNil)
	} else {
		resultsTable := l.CreateTable(len(results), 0)
		for i, result := range results {
			resultTable := l.CreateTable(0, 3)
			resultTable.RawSetString("user_id", lua.LString(result.UserID))
			if result.Previous == nil {
				resultTable.RawSetString("previous", lua.LNil)
			} else {
				resultTable.RawSetString("previous", RuntimeLuaConvertMapInt64(l, result.Previous))
			}
			if result.Updated == nil {
				resultTable.RawSetString("updated", lua.LNil)
			} else {
				resultTable.RawSetString("updated", RuntimeLuaConvertMapInt64(l, result.Updated))
			}
			resultsTable.RawSetInt(i+1, resultTable)
		}
		l.Push(resultsTable)
	}

	return 2
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
	case "decr":
		operatorNumber = LeaderboardOperatorDecrement
	default:
		l.ArgError(4, "expects operator to be 'best', 'set', 'decr' or 'incr'")
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

	n.leaderboardScheduler.Update()
	return 0
}

func (n *RuntimeLuaNakamaModule) leaderboardList(l *lua.LState) int {
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

	limit := l.OptInt(3, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(3, "limit must be 1-100")
		return 0
	}

	var cursor *LeaderboardListCursor
	cursorStr := l.OptString(4, "")
	if cursorStr != "" {
		cb, err := base64.StdEncoding.DecodeString(cursorStr)
		if err != nil {
			l.ArgError(4, "expects cursor to be valid when provided")
			return 0
		}
		cursor = &LeaderboardListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
			l.ArgError(4, "expects cursor to be valid when provided")
			return 0
		}
	}

	list, err := LeaderboardList(n.logger, n.leaderboardCache, categoryStart, categoryEnd, limit, cursor)
	if err != nil {
		l.RaiseError("error listing leaderboards: %v", err.Error())
		return 0
	}

	leaderboards := l.CreateTable(len(list.Leaderboards), 0)
	for i, t := range list.Leaderboards {
		tt, err := leaderboardToLuaTable(l, t)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}
		leaderboards.RawSetInt(i+1, tt)
	}

	l.Push(leaderboards)
	if list.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(list.Cursor))
	}
	return 2
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
	var limit *wrapperspb.Int32Value
	if limitNumber != 0 {
		limit = &wrapperspb.Int32Value{Value: int32(limitNumber)}
	}

	cursor := l.OptString(4, "")
	overrideExpiry := l.OptInt64(5, 0)

	records, err := LeaderboardRecordsList(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, limit, cursor, ownerIds, overrideExpiry)
	if err != nil {
		l.RaiseError("error listing leaderboard records: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor)
}

func (n *RuntimeLuaNakamaModule) leaderboardRecordWrite(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	ownerID := l.CheckString(2)
	if _, err := uuid.FromString(ownerID); err != nil {
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

	overrideOperator := api.Operator_NO_OVERRIDE
	operatorString := l.OptString(7, "")
	if operatorString != "" {
		switch operatorString {
		case "best":
			overrideOperator = api.Operator_BEST
		case "set":
			overrideOperator = api.Operator_SET
		case "incr":
			overrideOperator = api.Operator_INCREMENT
		case "decr":
			overrideOperator = api.Operator_DECREMENT
		default:
			l.ArgError(7, ErrInvalidOperator.Error())
			return 0
		}
	}

	record, err := LeaderboardRecordWrite(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr, overrideOperator)
	if err != nil {
		l.RaiseError("error writing leaderboard record: %v", err.Error())
		return 0
	}

	recordTable, err := recordToLuaTable(l, record)
	if err != nil {
		l.RaiseError(err.Error())
		return 0
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

	ownerID := l.CheckString(2)
	if _, err := uuid.FromString(ownerID); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	if err := LeaderboardRecordDelete(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID); err != nil {
		l.RaiseError("error deleting leaderboard record: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) leaderboardsGetId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid tournament id list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	leaderboardIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid tournament id data")
		return 0
	}
	if len(leaderboardIDs) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	leaderboardIDStrings := make([]string, 0, len(leaderboardIDs))
	for _, id := range leaderboardIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each tournament id must be a string")
			return 0
		} else {
			leaderboardIDStrings = append(leaderboardIDStrings, ids)
		}
	}

	leaderboards := LeaderboardsGet(n.leaderboardCache, leaderboardIDStrings)

	leaderboardsTable := l.CreateTable(len(leaderboards), 0)
	for i, leaderboard := range leaderboards {
		lt, err := leaderboardToLuaTable(l, leaderboard)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}
		leaderboardsTable.RawSetInt(i+1, lt)
	}

	l.Push(leaderboardsTable)
	return 1
}

func leaderboardToLuaTable(l *lua.LState, leaderboard *api.Leaderboard) (*lua.LTable, error) {
	lt := l.CreateTable(0, 8)

	lt.RawSetString("id", lua.LString(leaderboard.Id))
	lt.RawSetString("authoritative", lua.LBool(leaderboard.Authoritative))
	lt.RawSetString("operator", lua.LString(strings.ToLower(leaderboard.Operator.String())))
	lt.RawSetString("sort_order", lua.LString(strconv.FormatUint(uint64(leaderboard.SortOrder), 10)))
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(leaderboard.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	lt.RawSetString("metadata", metadataTable)
	lt.RawSetString("create_time", lua.LNumber(leaderboard.CreateTime.Seconds))
	if leaderboard.NextReset != 0 {
		lt.RawSetString("next_reset", lua.LNumber(leaderboard.NextReset))
	}
	if leaderboard.PrevReset != 0 {
		lt.RawSetString("", lua.LNumber(leaderboard.PrevReset))
	}

	return lt, nil
}

func (n *RuntimeLuaNakamaModule) purchaseValidateApple(l *lua.LState) int {
	password := l.OptString(3, n.config.GetIAP().Apple.SharedPassword)
	if password == "" {
		l.RaiseError("Apple IAP is not configured.")
		return 0
	}

	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(input)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if input == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	validation, err := ValidatePurchasesApple(l.Context(), n.logger, n.db, userID, password, receipt)
	if err != nil {
		l.RaiseError("error validating Apple receipt: %v", err.Error())
		return 0
	}

	l.Push(validationToLuaTable(l, validation))
	return 1
}

func (n *RuntimeLuaNakamaModule) purchaseValidateGoogle(l *lua.LState) int {
	if n.config.GetIAP().Google.ClientEmail == "" || n.config.GetIAP().Google.PrivateKey == "" {
		l.RaiseError("Google IAP is not configured.")
		return 0
	}

	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(input)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if input == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	validation, err := ValidatePurchaseGoogle(l.Context(), n.logger, n.db, userID, n.config.GetIAP().Google, receipt)
	if err != nil {
		l.RaiseError("error validating Google receipt: %v", err.Error())
		return 0
	}

	l.Push(validationToLuaTable(l, validation))
	return 1
}

func (n *RuntimeLuaNakamaModule) purchaseValidateHuawei(l *lua.LState) int {
	if n.config.GetIAP().Huawei.ClientID == "" ||
		n.config.GetIAP().Huawei.ClientSecret == "" ||
		n.config.GetIAP().Huawei.PublicKey == "" {
		l.RaiseError("Huawei IAP is not configured.")
		return 0
	}

	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	userID, err := uuid.FromString(input)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	signature := l.CheckString(2)
	if input == "" {
		l.ArgError(2, "expects signature")
		return 0
	}

	receipt := l.CheckString(3)
	if input == "" {
		l.ArgError(3, "expects receipt")
		return 0
	}

	validation, err := ValidatePurchaseHuawei(l.Context(), n.logger, n.db, userID, n.config.GetIAP().Huawei, signature, receipt)
	if err != nil {
		l.RaiseError("error validating Huawei receipt: %v", err.Error())
		return 0
	}

	l.Push(validationToLuaTable(l, validation))
	return 1
}

func (n *RuntimeLuaNakamaModule) purchaseGetByTransactionId(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a transaction ID string")
		return 0
	}

	userID, purchase, err := GetPurchaseByTransactionID(l.Context(), n.logger, n.db, id)
	if err != nil {
		l.RaiseError("error retrieving purchase: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(userID))
	l.Push(purchaseToLuaTable(l, purchase))
	return 2
}

func (n *RuntimeLuaNakamaModule) purchasesList(l *lua.LState) int {
	userID := l.OptString(1, "")
	if userID != "" {
		if _, err := uuid.FromString(userID); err != nil {
			l.ArgError(1, "expects a valid user ID")
			return 0
		}
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 100 {
		l.ArgError(2, "expects a limit 1-100")
		return 0
	}

	cursor := l.OptString(3, "")

	purchases, err := ListPurchases(l.Context(), n.logger, n.db, userID, limit, cursor)
	if err != nil {
		l.RaiseError("error retrieving purchases: %v", err.Error())
		return 0
	}

	purchasesTable := l.CreateTable(len(purchases.ValidatedPurchases), 0)
	for i, p := range purchases.ValidatedPurchases {
		purchasesTable.RawSetInt(i+1, purchaseToLuaTable(l, p))
	}

	l.Push(purchasesTable)

	if purchases.Cursor != "" {
		l.Push(lua.LString(purchases.Cursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

func (n *RuntimeLuaNakamaModule) tournamentCreate(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
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
	case "decr":
		operatorNumber = LeaderboardOperatorDecrement
	default:
		l.ArgError(3, "expects sort order to be 'best', 'set', 'decr' or 'incr'")
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
	if startTime < 0 {
		l.ArgError(10, "startTime must be >= 0.")
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

	if err := TournamentDelete(l.Context(), n.leaderboardCache, n.rankCache, n.leaderboardScheduler, id); err != nil {
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

func (n *RuntimeLuaNakamaModule) tournamentsGetId(l *lua.LState) int {
	// Input table validation.
	input := l.OptTable(1, nil)
	if input == nil {
		l.ArgError(1, "invalid tournament id list")
		return 0
	}
	if input.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	tournamentIDs, ok := RuntimeLuaConvertLuaValue(input).([]interface{})
	if !ok {
		l.ArgError(1, "invalid tournament id data")
		return 0
	}
	if len(tournamentIDs) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	tournamentIDStrings := make([]string, 0, len(tournamentIDs))
	for _, id := range tournamentIDs {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each tournament id must be a string")
			return 0
		} else {
			tournamentIDStrings = append(tournamentIDStrings, ids)
		}
	}

	// Get the tournaments.
	list, err := TournamentsGet(l.Context(), n.logger, n.db, tournamentIDStrings)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to get tournaments: %s", err.Error()))
		return 0
	}

	tournaments := l.CreateTable(len(list), 0)
	for i, t := range list {
		tt, err := tournamentToLuaTable(l, t)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}

		tournaments.RawSetInt(i+1, tt)
	}
	l.Push(tournaments)

	return 1
}

func tournamentToLuaTable(l *lua.LState, tournament *api.Tournament) (*lua.LTable, error) {
	tt := l.CreateTable(0, 18)

	tt.RawSetString("id", lua.LString(tournament.Id))
	tt.RawSetString("title", lua.LString(tournament.Title))
	tt.RawSetString("description", lua.LString(tournament.Description))
	tt.RawSetString("category", lua.LNumber(tournament.Category))
	tt.RawSetString("sort_order", lua.LString(strconv.FormatUint(uint64(tournament.SortOrder), 10)))
	tt.RawSetString("size", lua.LNumber(tournament.Size))
	tt.RawSetString("max_size", lua.LNumber(tournament.MaxSize))
	tt.RawSetString("max_num_score", lua.LNumber(tournament.MaxNumScore))
	tt.RawSetString("duration", lua.LNumber(tournament.Duration))
	tt.RawSetString("start_active", lua.LNumber(tournament.StartActive))
	tt.RawSetString("end_active", lua.LNumber(tournament.EndActive))
	tt.RawSetString("can_enter", lua.LBool(tournament.CanEnter))
	if tournament.NextReset != 0 {
		tt.RawSetString("next_reset", lua.LNumber(tournament.NextReset))
	} else {
		tt.RawSetString("next_reset", lua.LNil)
	}
	if tournament.PrevReset != 0 {
		tt.RawSetString("prev_reset", lua.LNumber(tournament.PrevReset))
	} else {
		tt.RawSetString("prev_reset", lua.LNil)
	}
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	tt.RawSetString("metadata", metadataTable)
	tt.RawSetString("create_time", lua.LNumber(tournament.CreateTime.Seconds))
	tt.RawSetString("start_time", lua.LNumber(tournament.StartTime.Seconds))
	if tournament.EndTime == nil {
		tt.RawSetString("end_time", lua.LNil)
	} else {
		tt.RawSetString("end_time", lua.LNumber(tournament.EndTime.Seconds))
	}
	tt.RawSetString("operator", lua.LString(strings.ToLower(tournament.Operator.String())))

	return tt, err
}

func (n *RuntimeLuaNakamaModule) tournamentRecordsList(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
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
	var limit *wrapperspb.Int32Value
	if limitNumber != 0 {
		limit = &wrapperspb.Int32Value{Value: int32(limitNumber)}
	}

	cursor := l.OptString(4, "")
	overrideExpiry := l.OptInt64(5, 0)

	records, err := TournamentRecordsList(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, ownerIds, limit, cursor, overrideExpiry)
	if err != nil {
		l.RaiseError("error listing tournament records: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor)
}

func leaderboardRecordsToLua(l *lua.LState, records []*api.LeaderboardRecord, ownerRecords []*api.LeaderboardRecord, prevCursor, nextCursor string) int {
	recordsTable := l.CreateTable(len(records), 0)
	for i, record := range records {
		recordTable, err := recordToLuaTable(l, record)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}

		recordsTable.RawSetInt(i+1, recordTable)
	}

	ownerRecordsTable := l.CreateTable(len(ownerRecords), 0)
	for i, record := range ownerRecords {
		recordTable, err := recordToLuaTable(l, record)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
		}

		ownerRecordsTable.RawSetInt(i+1, recordTable)
	}

	l.Push(recordsTable)
	l.Push(ownerRecordsTable)
	if nextCursor != "" {
		l.Push(lua.LString(nextCursor))
	} else {
		l.Push(lua.LNil)
	}
	if prevCursor != "" {
		l.Push(lua.LString(prevCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 4
}

func recordToLuaTable(l *lua.LState, record *api.LeaderboardRecord) (*lua.LTable, error) {
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
	err := json.Unmarshal([]byte(record.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
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

	return recordTable, nil
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

	var cursor *TournamentListCursor
	cursorStr := l.OptString(6, "")
	if cursorStr != "" {
		cb, err := base64.StdEncoding.DecodeString(cursorStr)
		if err != nil {
			l.ArgError(6, "expects cursor to be valid when provided")
			return 0
		}
		cursor = &TournamentListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
			l.ArgError(6, "expects cursor to be valid when provided")
			return 0
		}
	}

	list, err := TournamentList(l.Context(), n.logger, n.db, n.leaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit, cursor)
	if err != nil {
		l.RaiseError("error listing tournaments: %v", err.Error())
		return 0
	}

	tournaments := l.CreateTable(len(list.Tournaments), 0)
	for i, t := range list.Tournaments {
		tt, err := tournamentToLuaTable(l, t)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
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

	overrideOperatorString := l.OptString(7, api.Operator_NO_OVERRIDE.String())
	overrideOperator := int32(api.Operator_NO_OVERRIDE)
	var ok bool
	if overrideOperator, ok = api.Operator_value[strings.ToUpper(overrideOperatorString)]; !ok {
		l.ArgError(7, ErrInvalidOperator.Error())
		return 0
	}

	record, err := TournamentRecordWrite(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, userID, username, score, subscore, metadataStr, api.Operator(overrideOperator))
	if err != nil {
		l.RaiseError("error writing tournament record: %v", err.Error())
		return 0
	}

	recordTable, err := recordToLuaTable(l, record)
	if err != nil {
		l.RaiseError(err.Error())
		return 0
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

	expiry := l.OptInt(4, 0)
	if expiry < 0 {
		l.ArgError(4, "expiry should be time since epoch in seconds and has to be a positive integer")
		return 0
	}

	records, err := TournamentRecordsHaystack(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, userID, limit, int64(expiry))
	if err != nil {
		l.RaiseError("error listing tournament records haystack: %v", err.Error())
		return 0
	}

	recordsTable := l.CreateTable(len(records), 0)
	for i, record := range records {
		recordTable, err := recordToLuaTable(l, record)
		if err != nil {
			l.RaiseError(err.Error())
			return 0
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
	if maxCount < 1 {
		l.ArgError(9, "expects max_count to be >= 1")
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

	userID, err := uuid.FromString(l.OptString(2, uuid.Nil.String()))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	nameStr := l.OptString(3, "")
	var name *wrapperspb.StringValue
	if nameStr != "" {
		name = &wrapperspb.StringValue{Value: nameStr}
	}

	creatorIDStr := l.OptString(4, "")
	creatorID := uuid.Nil
	if creatorIDStr != "" {
		var err error
		creatorID, err = uuid.FromString(creatorIDStr)
		if err != nil {
			l.ArgError(3, "expects creator ID to be a valid identifier")
			return 0
		}
	}

	langStr := l.OptString(5, "")
	var lang *wrapperspb.StringValue
	if langStr != "" {
		lang = &wrapperspb.StringValue{Value: langStr}
	}

	descStr := l.OptString(6, "")
	var desc *wrapperspb.StringValue
	if descStr != "" {
		desc = &wrapperspb.StringValue{Value: descStr}
	}

	avatarURLStr := l.OptString(7, "")
	var avatarURL *wrapperspb.StringValue
	if avatarURLStr != "" {
		avatarURL = &wrapperspb.StringValue{Value: avatarURLStr}
	}

	openV := l.Get(8)
	var open *wrapperspb.BoolValue
	if openV != lua.LNil {
		open = &wrapperspb.BoolValue{Value: l.OptBool(7, false)}
	}

	metadataTable := l.OptTable(9, nil)
	var metadata *wrapperspb.StringValue
	if metadataTable != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
	}

	maxCountInt := l.OptInt(10, 0)
	maxCount := 0
	if maxCountInt > 0 && maxCountInt <= 100 {
		maxCount = maxCountInt
	}

	if err = UpdateGroup(l.Context(), n.logger, n.db, groupID, userID, creatorID, name, lang, desc, avatarURL, metadata, open, maxCount); err != nil {
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

func (n *RuntimeLuaNakamaModule) groupUserJoin(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(3)
	if username == "" {
		l.ArgError(3, "expects username string")
		return 0
	}

	if err := JoinGroup(l.Context(), n.logger, n.db, n.router, groupID, userID, username); err != nil {
		l.RaiseError("error while trying to join a group: %v", err.Error())
		return 0
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupUserLeave(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(3)
	if username == "" {
		l.ArgError(3, "expects username string")
		return 0
	}

	if err := LeaveGroup(l.Context(), n.logger, n.db, n.router, groupID, userID, username); err != nil {
		l.RaiseError("error while trying to leave a group: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupUsersAdd(l *lua.LState) int {
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
			l.ArgError(2, "cannot add the root user")
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

	callerID := uuid.Nil
	callerIDStr := l.OptString(3, "")
	if callerIDStr != "" {
		callerID, err = uuid.FromString(callerIDStr)
		if err != nil {
			l.ArgError(1, "expects caller ID to be a valid identifier")
			return 0
		}
	}

	if err := AddGroupUsers(l.Context(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
		l.RaiseError("error while trying to add users into a group: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupUsersPromote(l *lua.LState) int {
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
			l.ArgError(2, "cannot promote the root user")
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

	callerID := uuid.Nil
	callerIDStr := l.OptString(3, "")
	if callerIDStr != "" {
		callerID, err = uuid.FromString(callerIDStr)
		if err != nil {
			l.ArgError(1, "expects caller ID to be a valid identifier")
			return 0
		}
	}

	if err := PromoteGroupUsers(l.Context(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
		l.RaiseError("error while trying to promote users in a group: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupUsersDemote(l *lua.LState) int {
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
			l.ArgError(2, "cannot demote the root user")
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

	callerID := uuid.Nil
	callerIDStr := l.OptString(3, "")
	if callerIDStr != "" {
		callerID, err = uuid.FromString(callerIDStr)
		if err != nil {
			l.ArgError(1, "expects caller ID to be a valid identifier")
			return 0
		}
	}

	if err := DemoteGroupUsers(l.Context(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
		l.RaiseError("error while trying to demote users in a group: %v", err.Error())
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

	callerID := uuid.Nil
	callerIDStr := l.OptString(3, "")
	if callerIDStr != "" {
		callerID, err = uuid.FromString(callerIDStr)
		if err != nil {
			l.ArgError(1, "expects caller ID to be a valid identifier")
			return 0
		}
	}

	if err := KickGroupUsers(l.Context(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
		l.RaiseError("error while trying to kick users from a group: %v", err.Error())
	}
	return 0
}

func (n *RuntimeLuaNakamaModule) groupsList(l *lua.LState) int {
	name := l.OptString(1, "")

	langTag := l.OptString(2, "")

	var open *bool
	if v := l.Get(3); v.Type() != lua.LTNil {
		if v.Type() != lua.LTBool {
			l.ArgError(2, "expects open true/false or nil")
			return 0
		}
		open = new(bool)
		*open = lua.LVAsBool(v)
	}

	edgeCount := l.OptInt(4, -1)

	limit := l.OptInt(5, 100)

	cursor := l.OptString(6, "")

	groups, err := ListGroups(l.Context(), n.logger, n.db, name, langTag, open, edgeCount, limit, cursor)
	if err != nil {
		l.RaiseError("error listing groups: %v", err.Error())
	}

	groupUsers := l.CreateTable(len(groups.Groups), 0)
	for i, group := range groups.Groups {
		gt := l.CreateTable(0, 12)
		gt.RawSetString("id", lua.LString(group.Id))
		gt.RawSetString("creator_id", lua.LString(group.CreatorId))
		gt.RawSetString("name", lua.LString(group.Name))
		gt.RawSetString("description", lua.LString(group.Description))
		gt.RawSetString("avatar_url", lua.LString(group.AvatarUrl))
		gt.RawSetString("lang_tag", lua.LString(group.LangTag))
		gt.RawSetString("open", lua.LBool(group.Open.Value))
		gt.RawSetString("edge_count", lua.LNumber(group.EdgeCount))
		gt.RawSetString("max_count", lua.LNumber(group.MaxCount))
		gt.RawSetString("create_time", lua.LNumber(group.CreateTime.Seconds))
		gt.RawSetString("update_time", lua.LNumber(group.UpdateTime.Seconds))

		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(group.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert metadata to json: %s", err.Error()))
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		gt.RawSetString("metadata", metadataTable)

		groupUsers.RawSetInt(i+1, gt)
	}

	l.Push(groupUsers)
	if groups.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(groups.Cursor))
	}
	return 2
}

func (n *RuntimeLuaNakamaModule) groupUsersList(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 100 {
		l.ArgError(2, "expects limit to be 1-100")
		return 0
	}

	state := l.OptInt(3, -1)
	var stateWrapper *wrapperspb.Int32Value
	if state != -1 {
		if state < 0 || state > 4 {
			l.ArgError(3, "expects state to be 0-4")
			return 0
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
	}

	cursor := l.OptString(4, "")

	res, err := ListGroupUsers(l.Context(), n.logger, n.db, n.tracker, groupID, limit, stateWrapper, cursor)
	if err != nil {
		l.RaiseError("error while trying to list users in a group: %v", err.Error())
		return 0
	}

	groupUsers := l.CreateTable(len(res.GroupUsers), 0)
	for i, ug := range res.GroupUsers {
		u := ug.User

		ut := l.CreateTable(0, 18)
		ut.RawSetString("user_id", lua.LString(u.Id))
		ut.RawSetString("username", lua.LString(u.Username))
		ut.RawSetString("display_name", lua.LString(u.DisplayName))
		ut.RawSetString("avatar_url", lua.LString(u.AvatarUrl))
		ut.RawSetString("lang_tag", lua.LString(u.LangTag))
		ut.RawSetString("location", lua.LString(u.Location))
		ut.RawSetString("timezone", lua.LString(u.Timezone))
		if u.AppleId != "" {
			ut.RawSetString("apple_id", lua.LString(u.AppleId))
		}
		if u.FacebookId != "" {
			ut.RawSetString("facebook_id", lua.LString(u.FacebookId))
		}
		if u.FacebookInstantGameId != "" {
			ut.RawSetString("facebook_instant_game_id", lua.LString(u.FacebookInstantGameId))
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
	if res.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(res.Cursor))
	}
	return 2
}

func (n *RuntimeLuaNakamaModule) userGroupsList(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 100 {
		l.ArgError(2, "expects limit to be 1-100")
		return 0
	}

	state := l.OptInt(3, -1)
	var stateWrapper *wrapperspb.Int32Value
	if state != -1 {
		if state < 0 || state > 4 {
			l.ArgError(3, "expects state to be 0-4")
			return 0
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
	}

	cursor := l.OptString(4, "")

	res, err := ListUserGroups(l.Context(), n.logger, n.db, userID, limit, stateWrapper, cursor)
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
	if res.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(res.Cursor))
	}
	return 2
}

func (n *RuntimeLuaNakamaModule) accountUpdateId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	metadataTable := l.OptTable(2, nil)
	var metadata *wrapperspb.StringValue
	if metadataTable != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadataTable)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
	}

	username := l.OptString(3, "")

	displayNameL := l.Get(4)
	var displayName *wrapperspb.StringValue
	if displayNameL != lua.LNil {
		displayName = &wrapperspb.StringValue{Value: l.OptString(4, "")}
	}

	timezoneL := l.Get(5)
	var timezone *wrapperspb.StringValue
	if timezoneL != lua.LNil {
		timezone = &wrapperspb.StringValue{Value: l.OptString(5, "")}
	}

	locationL := l.Get(6)
	var location *wrapperspb.StringValue
	if locationL != lua.LNil {
		location = &wrapperspb.StringValue{Value: l.OptString(6, "")}
	}

	langL := l.Get(7)
	var lang *wrapperspb.StringValue
	if langL != lua.LNil {
		lang = &wrapperspb.StringValue{Value: l.OptString(7, "")}
	}

	avatarL := l.Get(8)
	var avatar *wrapperspb.StringValue
	if avatarL != lua.LNil {
		avatar = &wrapperspb.StringValue{Value: l.OptString(8, "")}
	}

	if err = UpdateAccounts(l.Context(), n.logger, n.db, []*accountUpdate{{
		userID:      userID,
		username:    username,
		displayName: displayName,
		timezone:    timezone,
		location:    location,
		langTag:     lang,
		avatarURL:   avatar,
		metadata:    metadata,
	}}); err != nil {
		l.RaiseError("error while trying to update user: %v", err.Error())
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) accountDeleteId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	recorded := l.OptBool(2, false)

	if err := DeleteAccount(l.Context(), n.logger, n.db, userID, recorded); err != nil {
		l.RaiseError("error while trying to delete account: %v", err.Error())
	}

	return 0
}

func (n *RuntimeLuaNakamaModule) accountExportId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	export, err := ExportAccount(l.Context(), n.logger, n.db, userID)
	if err != nil {
		l.RaiseError("error exporting account: %v", err.Error())
		return 0
	}

	exportString, err := n.protojsonMarshaler.Marshal(export)
	if err != nil {
		l.RaiseError("error encoding account export: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(exportString))
	return 1
}

func (n *RuntimeLuaNakamaModule) friendsList(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 100 {
		l.ArgError(2, "expects limit to be 1-100")
		return 0
	}

	state := l.OptInt(3, -1)
	var stateWrapper *wrapperspb.Int32Value
	if state != -1 {
		if state < 0 || state > 3 {
			l.ArgError(3, "expects state to be 0-3")
			return 0
		}
		stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
	}

	cursor := l.OptString(4, "")

	friends, err := ListFriends(l.Context(), n.logger, n.db, n.tracker, userID, limit, stateWrapper, cursor)
	if err != nil {
		l.RaiseError("error while trying to list friends for a user: %v", err.Error())
		return 0
	}

	userFriends := l.CreateTable(len(friends.Friends), 0)
	for i, f := range friends.Friends {
		u := f.User

		fut, err := userToLuaTable(l, u)
		if err != nil {
			l.RaiseError(fmt.Sprintf("failed to convert user data to lua table: %s", err.Error()))
			return 0
		}

		ft := l.CreateTable(0, 3)
		ft.RawSetString("state", lua.LNumber(f.State.Value))
		ft.RawSetString("update_time", lua.LNumber(f.UpdateTime.Seconds))
		ft.RawSetString("user", fut)

		userFriends.RawSetInt(i+1, ft)
	}

	l.Push(userFriends)
	if friends.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(friends.Cursor))
	}
	return 2
}

func (n *RuntimeLuaNakamaModule) fileRead(l *lua.LState) int {
	relPath := l.CheckString(1)
	if relPath == "" {
		l.ArgError(1, "expects relative path string")
		return 0
	}

	rootPath := n.config.GetRuntime().Path

	f, err := FileRead(rootPath, relPath)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to open file: %s", err.Error()))
		return 0
	}
	defer f.Close()

	fileContent, err := ioutil.ReadAll(f)
	if err != nil {
		l.RaiseError(fmt.Sprintf("failed to read file: %s", err.Error()))
		return 0
	}

	l.Push(lua.LString(string(fileContent)))
	return 1
}

func (n *RuntimeLuaNakamaModule) channelMessageSend(l *lua.LState) int {
	channelId := l.CheckString(1)

	content := l.OptTable(2, nil)
	contentStr := "{}"
	if content != nil {
		contentMap := RuntimeLuaConvertLuaTable(content)
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		contentStr = string(contentBytes)
	}

	s := l.OptString(3, "")
	senderID := uuid.Nil.String()
	if s != "" {
		suid, err := uuid.FromString(s)
		if err != nil {
			l.ArgError(5, "expects sender id to either be not set, empty string or a valid UUID")
			return 0
		}
		senderID = suid.String()
	}

	senderUsername := l.OptString(4, "")

	persist := l.OptBool(5, false)

	channelIdToStreamResult, err := ChannelIdToStream(channelId)
	if err != nil {
		l.RaiseError(err.Error())
		return 0
	}

	ack, err := ChannelMessageSend(l.Context(), n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, contentStr, senderID, senderUsername, persist)
	if err != nil {
		l.RaiseError("failed to send channel message: %v", err.Error())
		return 0
	}

	ackTable := l.CreateTable(0, 7)
	ackTable.RawSetString("channelId", lua.LString(ack.ChannelId))
	ackTable.RawSetString("messageId", lua.LString(ack.MessageId))
	ackTable.RawSetString("code", lua.LNumber(ack.Code.Value))
	ackTable.RawSetString("username", lua.LString(ack.Username))
	ackTable.RawSetString("createTime", lua.LNumber(ack.CreateTime.Seconds))
	ackTable.RawSetString("updateTime", lua.LNumber(ack.UpdateTime.Seconds))
	ackTable.RawSetString("persistent", lua.LBool(ack.Persistent.Value))

	l.Push(ackTable)
	return 1
}

func (n *RuntimeLuaNakamaModule) channelIdBuild(l *lua.LState) int {
	target := l.CheckString(1)

	chanType := l.CheckInt(2)

	if chanType < 1 || chanType > 3 {
		l.RaiseError("invalid channel type: expects value 1-3")
		return 0
	}

	channelId, _, err := BuildChannelId(l.Context(), n.logger, n.db, uuid.Nil, target, rtapi.ChannelJoin_Type(chanType))
	if err != nil {
		if errors.Is(err, errInvalidChannelTarget) {
			l.ArgError(1, err.Error())
			return 0
		} else if errors.Is(err, errInvalidChannelType) {
			l.ArgError(2, err.Error())
			return 0
		}
		l.RaiseError(err.Error())
		return 0
	}

	l.Push(lua.LString(channelId))
	return 1
}
