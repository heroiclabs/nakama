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
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
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
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
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
	version              string
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	rankCache            LeaderboardRankCache
	leaderboardScheduler LeaderboardScheduler
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	statusRegistry       StatusRegistry
	matchRegistry        MatchRegistry
	partyRegistry        PartyRegistry
	tracker              Tracker
	metrics              Metrics
	storageIndex         StorageIndex
	streamManager        StreamManager
	router               MessageRouter
	once                 *sync.Once
	localCache           *RuntimeLuaLocalCache
	registerCallbackFn   func(RuntimeExecutionMode, string, *lua.LFunction)
	announceCallbackFn   func(RuntimeExecutionMode, string)
	httpClient           *http.Client
	httpClientInsecure   *http.Client

	node          string
	matchCreateFn RuntimeMatchCreateFunction
	eventFn       RuntimeEventCustomFunction

	satori runtime.Satori
}

func NewRuntimeLuaNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, partyRegistry PartyRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, once *sync.Once, localCache *RuntimeLuaLocalCache, storageIndex StorageIndex, satoriClient runtime.Satori, matchCreateFn RuntimeMatchCreateFunction, eventFn RuntimeEventCustomFunction, registerCallbackFn func(RuntimeExecutionMode, string, *lua.LFunction), announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeLuaNakamaModule {
	return &RuntimeLuaNakamaModule{
		logger:               logger,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		config:               config,
		version:              version,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		rankCache:            rankCache,
		leaderboardScheduler: leaderboardScheduler,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		statusRegistry:       statusRegistry,
		matchRegistry:        matchRegistry,
		partyRegistry:        partyRegistry,
		tracker:              tracker,
		metrics:              metrics,
		streamManager:        streamManager,
		router:               router,
		once:                 once,
		localCache:           localCache,
		storageIndex:         storageIndex,
		registerCallbackFn:   registerCallbackFn,
		announceCallbackFn:   announceCallbackFn,
		httpClient:           &http.Client{},
		httpClientInsecure:   &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}},

		node:          config.GetName(),
		matchCreateFn: matchCreateFn,
		eventFn:       eventFn,

		satori: satoriClient,
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
		"register_shutdown":                  n.registerShutdown,
		"register_storage_index":             n.registerStorageIndex,
		"register_storage_index_filter":      n.registerStorageIndexFilter,
		"run_once":                           n.runOnce,
		"get_context":                        n.getContext,
		"event":                              n.event,
		"metrics_counter_add":                n.metricsCounterAdd,
		"metrics_gauge_set":                  n.metricsGaugeSet,
		"metrics_timer_record":               n.metricsTimerRecord,
		"localcache_get":                     n.localcacheGet,
		"localcache_put":                     n.localcachePut,
		"localcache_delete":                  n.localcacheDelete,
		"localcache_clear":                   n.localcacheClear,
		"time":                               n.time,
		"cron_prev":                          n.cronPrev,
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
		"users_get_friend_status":            n.usersGetFriendStatus,
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
		"match_signal":                       n.matchSignal,
		"notification_send":                  n.notificationSend,
		"notifications_send":                 n.notificationsSend,
		"notification_send_all":              n.notificationSendAll,
		"notifications_list":                 n.notificationsList,
		"notifications_delete":               n.notificationsDelete,
		"notifications_get_id":               n.notificationsGetId,
		"notifications_delete_id":            n.notificationsDeleteId,
		"notifications_update":               n.notificationsUpdate,
		"wallet_update":                      n.walletUpdate,
		"wallets_update":                     n.walletsUpdate,
		"wallet_ledger_update":               n.walletLedgerUpdate,
		"wallet_ledger_list":                 n.walletLedgerList,
		"status_follow":                      n.statusFollow,
		"status_unfollow":                    n.statusUnfollow,
		"storage_list":                       n.storageList,
		"storage_read":                       n.storageRead,
		"storage_write":                      n.storageWrite,
		"storage_delete":                     n.storageDelete,
		"multi_update":                       n.multiUpdate,
		"leaderboard_create":                 n.leaderboardCreate,
		"leaderboard_delete":                 n.leaderboardDelete,
		"leaderboard_list":                   n.leaderboardList,
		"leaderboard_ranks_disable":          n.leaderboardRanksDisable,
		"leaderboard_records_list":           n.leaderboardRecordsList,
		"leaderboard_records_list_cursor_from_rank": n.leaderboardRecordsListCursorFromRank,
		"leaderboard_record_write":                  n.leaderboardRecordWrite,
		"leaderboard_records_haystack":              n.leaderboardRecordsHaystack,
		"leaderboard_record_delete":                 n.leaderboardRecordDelete,
		"leaderboards_get_id":                       n.leaderboardsGetId,
		"purchase_validate_apple":                   n.purchaseValidateApple,
		"purchase_validate_google":                  n.purchaseValidateGoogle,
		"purchase_validate_huawei":                  n.purchaseValidateHuawei,
		"purchase_validate_facebook_instant":        n.purchaseValidateFacebookInstant,
		"purchase_get_by_transaction_id":            n.purchaseGetByTransactionId,
		"purchases_list":                            n.purchasesList,
		"subscription_validate_apple":               n.subscriptionValidateApple,
		"subscription_validate_google":              n.subscriptionValidateGoogle,
		"subscription_get_by_product_id":            n.subscriptionGetByProductId,
		"subscriptions_list":                        n.subscriptionsList,
		"tournament_create":                         n.tournamentCreate,
		"tournament_delete":                         n.tournamentDelete,
		"tournament_add_attempt":                    n.tournamentAddAttempt,
		"tournament_join":                           n.tournamentJoin,
		"tournament_list":                           n.tournamentList,
		"tournament_ranks_disable":                  n.tournamentRanksDisable,
		"tournaments_get_id":                        n.tournamentsGetId,
		"tournament_records_list":                   n.tournamentRecordsList,
		"tournament_record_write":                   n.tournamentRecordWrite,
		"tournament_record_delete":                  n.tournamentRecordDelete,
		"tournament_records_haystack":               n.tournamentRecordsHaystack,
		"groups_get_id":                             n.groupsGetId,
		"group_create":                              n.groupCreate,
		"group_update":                              n.groupUpdate,
		"group_delete":                              n.groupDelete,
		"group_user_join":                           n.groupUserJoin,
		"group_user_leave":                          n.groupUserLeave,
		"group_users_add":                           n.groupUsersAdd,
		"group_users_ban":                           n.groupUsersBan,
		"group_users_promote":                       n.groupUsersPromote,
		"group_users_demote":                        n.groupUsersDemote,
		"group_users_list":                          n.groupUsersList,
		"group_users_kick":                          n.groupUsersKick,
		"groups_list":                               n.groupsList,
		"groups_get_random":                         n.groupsGetRandom,
		"user_groups_list":                          n.userGroupsList,
		"friend_metadata_update":                    n.friendMetadataUpdate,
		"friends_list":                              n.friendsList,
		"friends_of_friends_list":                   n.friendsOfFriendsList,
		"friends_add":                               n.friendsAdd,
		"friends_delete":                            n.friendsDelete,
		"friends_block":                             n.friendsBlock,
		"party_list":                                n.partyList,
		"file_read":                                 n.fileRead,
		"channel_message_send":                      n.channelMessageSend,
		"channel_message_update":                    n.channelMessageUpdate,
		"channel_message_remove":                    n.channelMessageRemove,
		"channel_messages_list":                     n.channelMessagesList,
		"channel_id_build":                          n.channelIdBuild,
		"storage_index_list":                        n.storageIndexList,
		"get_config":                                n.getConfig,
		"get_satori":                                n.getSatori,
	}

	mod := l.SetFuncs(l.CreateTable(0, len(functions)), functions)

	l.Push(mod)
	return 1
}

// @group hooks
// @summary Registers a function for use with client RPC to the server.
// @param fn(type=function) A function reference which will be executed on each RPC message.
// @param id(type=string) The unique identifier used to register the function for RPC.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Register a function with the server which will be executed before any non-realtime message with the specified message name.
// @param fn(type=function) A function reference which will be executed on each message.
// @param id(type=string) The specific message name to execute the function after.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Register a function with the server which will be executed after every non-realtime message as specified while registering the function.
// @param fn(type=function) A function reference which will be executed on each message.
// @param id(type=string) The specific message name to execute the function after.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Register a function with the server which will be executed before any realtime message with the specified message name.
// @param fn(type=function) A function reference which will be executed on each msgname message. The function should pass the payload input back as a return argument so the pipeline can continue to execute the standard logic.
// @param id(type=string) The specific message name to execute the function after.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Register a function with the server which will be executed after every realtime message with the specified message name.
// @param fn(type=function) A function reference which will be executed on each msgname message.
// @param id(type=string) The specific message name to execute the function after.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Registers a function that will be called when matchmaking finds opponents.
// @param fn(type=function) A function reference which will be executed on each matchmake completion.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Registers a function to be run when a tournament ends.
// @param fn(type=function) A function reference which will be executed on each tournament end.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Registers a function to be run when a tournament resets.
// @param fn(type=function) A function reference which will be executed on each tournament reset.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Registers a function to be run when a leaderboard resets.
// @param fn(type=function) A function reference which will be executed on each leaderboard reset.
// @return error(error) An optional error value if an error occurred.
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

// @group hooks
// @summary Registers a function to be run when the server received a shutdown signal. The function only fires if grace_period_sec > 0.
// @param fn(type=function) A function reference which will be executed on server shutdown.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) registerShutdown(l *lua.LState) int {
	fn := l.CheckFunction(1)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeShutdown, "", fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeShutdown, "")
	}
	return 0
}

// @group storage
// @summary Create a new storage index.
// @param indexName(type=string) Name of the index to list entries from.
// @param collection(type=string) Collection of storage engine to index objects from.
// @param key(type=string) Key of storage objects to index. Set to empty string to index all objects of collection.
// @param fields(type=table) A table of strings with the keys of the storage object whose values are to be indexed.
// @param sortableFields(type=table, optional=true) A table of strings with the keys of the storage object whose values are to be sortable. The keys must exist within the previously specified fields to be indexed.
// @param maxEntries(type=int) Maximum number of entries kept in the index.
// @param indexOnly(type=bool, optional=true) Only index the storage object with the given key.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) registerStorageIndex(l *lua.LState) int {
	indexName := l.CheckString(1)
	collection := l.CheckString(2)
	key := l.CheckString(3)
	fields := l.CheckTable(4)
	fieldsArray := make([]string, 0, fields.Len())
	fields.ForEach(func(k, v lua.LValue) {
		if v.Type() != lua.LTString {
			l.ArgError(4, "expects each field to be string")
			return
		}
		fieldsArray = append(fieldsArray, v.String())
	})
	sortableFields := l.CheckTable(5)
	sortableFieldsArray := make([]string, 0, sortableFields.Len())
	sortableFields.ForEach(func(k, v lua.LValue) {
		if v.Type() != lua.LTString {
			l.ArgError(5, "expects each field to be string")
			return
		}
		sortableFieldsArray = append(sortableFieldsArray, v.String())
	})
	maxEntries := l.CheckInt(6)
	indexOnly := l.OptBool(7, false)

	if err := n.storageIndex.CreateIndex(context.Background(), indexName, collection, key, fieldsArray, sortableFieldsArray, maxEntries, indexOnly); err != nil {
		l.RaiseError("failed to create storage index: %s", err.Error())
	}

	return 0
}

// @group storage
// @summary List storage index entries
// @param indexName(type=string) Name of the index to register filter function.
// @param fn(type=function) A function reference which will be executed on each storage object to be written that is a candidate for the index.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) registerStorageIndexFilter(l *lua.LState) int {
	indexName := l.CheckString(1)
	fn := l.CheckFunction(2)

	if n.registerCallbackFn != nil {
		n.registerCallbackFn(RuntimeExecutionModeStorageIndexFilter, indexName, fn)
	}
	if n.announceCallbackFn != nil {
		n.announceCallbackFn(RuntimeExecutionModeStorageIndexFilter, indexName)
	}
	return 0
}

// @group hooks
// @summary Registers a function to be run only once.
// @param fn(type=function) A function reference which will be executed only once.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) runOnce(l *lua.LState) int {
	n.once.Do(func() {
		fn := l.CheckFunction(1)
		if fn == nil {
			l.ArgError(1, "expects a function")
			return
		}

		ctx := NewRuntimeLuaContext(l, n.config.GetName(), n.version, RuntimeLuaConvertMapString(l, n.config.GetRuntime().Environment), RuntimeExecutionModeRunOnce, nil, nil, 0, "", "", nil, "", "", "", "")

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
	ctx := NewRuntimeLuaContext(l, n.config.GetName(), n.version, RuntimeLuaConvertMapString(l, n.config.GetRuntime().Environment), RuntimeExecutionModeRunOnce, nil, nil, 0, "", "", nil, "", "", "", "")
	l.Push(ctx)
	return 1
}

// @group events
// @summary Generate an event.
// @param name(type=string) The name of the event to be created.
// @param properties(type=table) A table of event properties.
// @param timestamp(type=int64) Numeric UTC value of when event is created.
// @param external(type=bool, optional=true, default=false) Whether the event is external.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) event(l *lua.LState) int {
	name := l.CheckString(1)
	if name == "" {
		l.ArgError(1, "expects name string")
		return 0
	}

	properties := l.OptTable(2, nil)
	var propertiesMap map[string]string
	if properties != nil {
		var conversionError bool
		propertiesMap = make(map[string]string, properties.Len())
		properties.ForEach(func(k lua.LValue, v lua.LValue) {
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

			propertiesMap[k.String()] = v.String()
		})

		if conversionError {
			return 0
		}
	}

	var ts *timestamppb.Timestamp
	timestamp := l.OptInt64(3, -1)
	if timestamp == 0 {
		l.ArgError(3, "timestamp must be numeric UTC seconds when provided")
		return 0
	} else if timestamp == -1 {
		ts = nil
	} else {
		ts = &timestamppb.Timestamp{Seconds: timestamp}
	}

	external := l.OptBool(4, false)

	if n.eventFn != nil {
		n.eventFn(l.Context(), &api.Event{
			Name:       name,
			Properties: propertiesMap,
			Timestamp:  ts,
			External:   external,
		})
	}
	return 0
}

// @group metrics
// @summary Add a custom metrics counter.
// @param name(type=string) The name of the custom metrics counter.
// @param tags(type=table) The metrics tags associated with this counter.
// @param delta(type=number) An integer value to update this metric with.
func (n *RuntimeLuaNakamaModule) metricsCounterAdd(l *lua.LState) int {
	name := l.CheckString(1)
	tags, err := RuntimeLuaConvertLuaTableString(l.OptTable(2, nil))
	if err != nil {
		l.ArgError(2, err.Error())
	}
	delta := l.CheckInt64(3)
	n.metrics.CustomCounter(name, tags, delta)

	return 0
}

// @group metrics
// @summary Add a custom metrics gauge.
// @param name(type=string) The name of the custom metrics gauge.
// @param tags(type=table) The metrics tags associated with this gauge.
// @param value(type=number) A value to update this metric with.
func (n *RuntimeLuaNakamaModule) metricsGaugeSet(l *lua.LState) int {
	name := l.CheckString(1)
	tags, err := RuntimeLuaConvertLuaTableString(l.OptTable(2, nil))
	if err != nil {
		l.ArgError(2, err.Error())
	}
	value := float64(l.CheckNumber(3))
	n.metrics.CustomGauge(name, tags, value)

	return 0
}

// @group metrics
// @summary Add a custom metrics timer.
// @param name(type=string) The name of the custom metrics timer.
// @param tags(type=table) The metrics tags associated with this timer.
// @param value(type=number) An integer value to update this metric with (in nanoseconds).
func (n *RuntimeLuaNakamaModule) metricsTimerRecord(l *lua.LState) int {
	name := l.CheckString(1)
	tags, err := RuntimeLuaConvertLuaTableString(l.OptTable(2, nil))
	if err != nil {
		l.ArgError(2, err.Error())
	}
	value := l.CheckInt64(3)
	n.metrics.CustomTimer(name, tags, time.Duration(value))

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

	ttl := l.OptInt64(3, 0)
	if ttl < 0 {
		l.ArgError(3, "ttl must be 0 or more")
		return 0
	}

	n.localCache.Put(key, value, ttl)

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

func (n *RuntimeLuaNakamaModule) localcacheClear(_ *lua.LState) int {
	n.localCache.Clear()

	return 0
}

// @group utils
// @summary Get the current UTC time in milliseconds using the system wall clock.
// @param tbl(type=table, optional=true) Unix epoch override.
// @return t(int) A number representing the current UTC time in milliseconds.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) time(l *lua.LState) int {
	if l.GetTop() == 0 {
		l.Push(lua.LNumber(time.Now().UTC().UnixNano() / int64(time.Millisecond)))
	} else {
		tbl := l.CheckTable(1)
		msec := getIntField(l, tbl, "msec", 0)
		sec := getIntField(l, tbl, "sec", 0)
		mins := getIntField(l, tbl, "min", 0)
		hour := getIntField(l, tbl, "hour", 12)
		day := getIntField(l, tbl, "day", -1)
		month := getIntField(l, tbl, "month", -1)
		year := getIntField(l, tbl, "year", -1)
		isdst := getBoolField(l, tbl, "isdst", false)
		t := time.Date(year, time.Month(month), day, hour, mins, sec, msec*int(time.Millisecond), time.UTC)
		// TODO dst
		if false {
			print(isdst)
		}
		l.Push(lua.LNumber(t.UTC().UnixNano() / int64(time.Millisecond)))
	}
	return 1
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the next matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=number) A time value expressed as UTC seconds.
// @return next_timestamp(number) The next UTC seconds timestamp (number) that matches the given CRON expression, and is immediately after the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) cronNext(l *lua.LState) int {
	expression := l.CheckString(1)
	if expression == "" {
		l.ArgError(1, "expects cron string")
		return 0
	}
	timestamp := l.CheckInt64(2)
	if timestamp == 0 {
		l.ArgError(1, "expects timestamp in seconds")
		return 0
	}

	expr, err := cronexpr.Parse(expression)
	if err != nil {
		l.ArgError(1, "expects a valid cron string")
		return 0
	}
	t := time.Unix(timestamp, 0).UTC()
	next := expr.Next(t)
	nextTs := next.UTC().Unix()
	l.Push(lua.LNumber(nextTs))
	return 1
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the previous matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=number) A time value expressed as UTC seconds.
// @return prev_timestamp(number) The previous UTC seconds timestamp (number) that matches the given CRON expression, and is immediately before the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) cronPrev(l *lua.LState) int {
	expression := l.CheckString(1)
	if expression == "" {
		l.ArgError(1, "expects cron string")
		return 0
	}
	timestamp := l.CheckInt64(2)
	if timestamp == 0 {
		l.ArgError(1, "expects timestamp in seconds")
		return 0
	}

	expr, err := cronexpr.Parse(expression)
	if err != nil {
		l.ArgError(1, "expects a valid cron string")
		return 0
	}
	t := time.Unix(timestamp, 0).UTC()
	next := expr.Last(t)
	nextTs := next.UTC().Unix()
	l.Push(lua.LNumber(nextTs))
	return 1
}

// @group utils
// @summary Execute an arbitrary SQL query and return the number of rows affected. Typically an "INSERT", "DELETE", or "UPDATE" statement with no return columns.
// @param query(type=string) A SQL query to execute.
// @param parameters(type=table) Arbitrary parameters to pass to placeholders in the query.
// @return count(number) A list of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) sqlExec(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	parameters := l.OptTable(2, nil)
	var params []interface{}
	if parameters != nil && parameters.Len() != 0 {
		var ok bool
		params, ok = RuntimeLuaConvertLuaValue(parameters).([]interface{})
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

// @group utils
// @summary Execute an arbitrary SQL query that is expected to return row data. Typically a "SELECT" statement.
// @param query(type=string) A SQL query to execute.
// @param parameters(type=table) Arbitrary parameters to pass to placeholders in the query.
// @return result(table) A table of rows and the respective columns and values.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) sqlQuery(l *lua.LState) int {
	query := l.CheckString(1)
	if query == "" {
		l.ArgError(1, "expects query string")
		return 0
	}
	parameters := l.OptTable(2, nil)
	var params []interface{}
	if parameters != nil && parameters.Len() != 0 {
		var ok bool
		params, ok = RuntimeLuaConvertLuaValue(parameters).([]interface{})
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

// @group utils
// @summary Generate a version 4 UUID in the standard 36-character string representation.
// @return u(string) The newly generated version 4 UUID identifier string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) uuidV4(l *lua.LState) int {
	l.Push(lua.LString(uuid.Must(uuid.NewV4()).String()))
	return 1
}

// @group utils
// @summary Convert the 16-byte raw representation of a UUID into the equivalent 36-character standard UUID string representation. Will raise an error if the input is not valid and cannot be converted.
// @param uuidBytes(type=string) The UUID bytes to convert.
// @return u(string) A string containing the equivalent 36-character standard representation of the UUID.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Convert the 36-character string representation of a UUID into the equivalent 16-byte raw UUID representation. Will raise an error if the input is not valid and cannot be converted.
// @param uuidString(type=string) The UUID string to convert.
// @return u(string) A string containing the equivalent 16-byte representation of the UUID.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Send a HTTP request that returns a data type containing the result of the HTTP response.
// @param url(type=string) The URL of the web resource to request.
// @param method(type=string) The HTTP method verb used with the request.
// @param headers(type=table, optional=true) A table of headers used with the request.
// @param body(type=string, optional=true) The bytes to send with the request.
// @param timeout(type=number, optional=true, default=5000) Timeout of the request in milliseconds.
// @param insecure(type=bool, optional=true, default=false) Set to true to skip request TLS validations.
// @return returnVal(table) Code, Headers, and Body response values for the HTTP response.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) httpRequest(l *lua.LState) int {
	url := l.CheckString(1)
	method := strings.ToUpper(l.CheckString(2))
	headers := l.CheckTable(3)
	body := l.OptString(4, "")

	if url == "" {
		l.ArgError(1, "expects URL string")
		return 0
	}

	switch method {
	case http.MethodGet:
	case http.MethodPost:
	case http.MethodPut:
	case http.MethodPatch:
	case http.MethodDelete:
	case http.MethodHead:
	default:
		l.ArgError(2, "expects method to be one of: 'get', 'post', 'put', 'patch', 'delete', 'head'")
		return 0
	}

	// Set a custom timeout if one is provided, or use the default.
	timeout := l.OptInt64(5, 5000)
	if timeout <= 0 {
		timeout = 5_000
	}

	insecure := l.OptBool(6, false)

	// Prepare request body, if any.
	var requestBody io.Reader
	if body != "" {
		requestBody = strings.NewReader(body)
	}

	ctx, ctxCancelFn := context.WithTimeout(l.Context(), time.Duration(timeout)*time.Millisecond)
	defer ctxCancelFn()

	// Prepare the request.
	req, err := http.NewRequestWithContext(ctx, method, url, requestBody)
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
	var resp *http.Response
	if insecure {
		resp, err = n.httpClientInsecure.Do(req)
	} else {
		resp, err = n.httpClient.Do(req)
	}
	if err != nil {
		l.RaiseError("HTTP request error: %v", err.Error())
		return 0
	}
	// Read the response body.
	responseBody, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
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
	l.Push(lua.LString(responseBody))
	return 3
}

// @group utils
// @summary Generate a JSON Web Token.
// @param signingMethod(type=string) The signing method to be used, either HS256 or RS256.
// @param signingKey(type=string) The signing key to be used.
// @param claims(type=table) The JWT payload.
// @return token(string) The newly generated JWT.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) jwtGenerate(l *lua.LState) int {
	signingMethod := l.CheckString(1)
	if signingMethod == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	var signingMethodInterface jwt.SigningMethod
	switch signingMethod {
	case "HS256":
		signingMethodInterface = jwt.SigningMethodHS256
	case "RS256":
		signingMethodInterface = jwt.SigningMethodRS256
	default:
		l.ArgError(1, "unsupported algo type - only allowed 'HS256', 'RS256'.")
		return 0
	}

	signingKey := l.CheckString(2)
	if signingKey == "" {
		l.ArgError(2, "expects string")
		return 0
	}

	claims := l.CheckTable(3)
	if claims == nil {
		l.ArgError(3, "expects nil")
		return 0
	}

	claimset := RuntimeLuaConvertLuaValue(claims).(map[string]interface{})
	jwtClaims := jwt.MapClaims{}
	for k, v := range claimset {
		jwtClaims[k] = v
	}

	var pk interface{}
	switch signingMethodInterface {
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

	token := jwt.NewWithClaims(signingMethodInterface, jwtClaims)
	signedToken, err := token.SignedString(pk)
	if err != nil {
		l.RaiseError("failed to sign token: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(signedToken))
	return 1
}

// @group utils
// @summary Encode the input as JSON.
// @param value(type=string) The input to encode as JSON.
// @return jsonBytes(string) The encoded JSON string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) jsonEncode(l *lua.LState) int {
	value := l.CheckAny(1)
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

	l.Push(lua.LString(jsonBytes))
	return 1
}

// @group utils
// @summary Decode the JSON input as a Lua table.
// @param jsonString(type=string) The JSON encoded input.
// @return jsonData(table) Decoded JSON input as a Lua table.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Base64 encode a string input.
// @param input(type=string) The string which will be base64 encoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return output(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Decode a base64 encoded string.
// @param input(type=string) The string which will be base64 decoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return output(string) Decoded string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) base64Decode(l *lua.LState) int {
	input := l.CheckString(1)
	if input == "" {
		l.ArgError(1, "expects string")
		return 0
	}

	padding := l.OptBool(2, true)

	if padding {
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

// @group utils
// @summary Base64 URL encode a string input.
// @param input(type=string) The string which will be base64 URL encoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return output(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Decode a base64 URL encoded string.
// @param input(type=string) The string to be decoded.
// @param padding(type=bool, optional=true, default=false) Pad the string if padding is missing.
// @return output(string) Decoded string.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary base16 encode a string input.
// @param input(type=string) The string to be encoded.
// @return output(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Decode a base16 encoded string.
// @param input(type=string) The string to be decoded.
// @return output(string) Decoded string.
// @return error(error) An optional error value if an error occurred.
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

// Not annotated as not exported and available in the Lua runtime
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

	stream := cipher.NewCFBEncrypter(block, iv) //nolint:staticcheck
	stream.XORKeyStream(cipherText[aes.BlockSize:], []byte(input))

	l.Push(lua.LString(cipherText))
	return 1
}

// Not annotated as not exported and available in the Lua runtime
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

	stream := cipher.NewCFBDecrypter(block, iv) //nolint:staticcheck
	stream.XORKeyStream(cipherText, cipherText)

	l.Push(lua.LString(cipherText))
	return 1
}

// @group utils
// @summary aes128 encrypt a string input.
// @param input(type=string) The string which will be aes128 encrypted.
// @param key(type=string) The 16 Byte encryption key.
// @return cipherText(string) The ciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) aes128Encrypt(l *lua.LState) int {
	return aesEncrypt(l, 16)
}

// @group utils
// @summary Decrypt an aes128 encrypted string.
// @param input(type=string) The string to be decrypted.
// @param key(type=string) The 16 Byte decryption key.
// @return clearText(string) The deciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) aes128Decrypt(l *lua.LState) int {
	return aesDecrypt(l, 16)
}

// @group utils
// @summary aes256 encrypt a string input.
// @param input(type=string) The string which will be aes256 encrypted.
// @param key(type=string) The 32 Byte encryption key.
// @return cipherText(string) The ciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) aes256Encrypt(l *lua.LState) int {
	return aesEncrypt(l, 32)
}

// @group utils
// @summary Decrypt an aes256 encrypted string.
// @param input(type=string) The string to be decrypted.
// @param key(type=string) The 32 Byte decryption key.
// @return clearText(string) The deciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) aes256Decrypt(l *lua.LState) int {
	return aesDecrypt(l, 32)
}

// @group utils
// @summary Create an md5 hash from the input.
// @param input(type=string) The input string to hash.
// @return hash(string) A string with the md5 hash of the input.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Create an SHA256 hash from the input.
// @param input(type=string) The input string to hash.
// @return hash(string) A string with the SHA256 hash of the input.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Create a RSA encrypted SHA256 hash from the input.
// @param input(type=string) The input string to hash.
// @param key(type=string) The RSA private key.
// @return signature(string) A string with the RSA encrypted SHA256 hash of the input.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Create a HMAC-SHA256 hash from input and key.
// @param input(type=string) The input string to hash.
// @param key(type=string) The hashing key.
// @return mac(string) Hashed input as a string using the key.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Generate one-way hashed string using bcrypt.
// @param input(type=string) The input string to bcrypt.
// @return hash(string) Hashed string.
// @return error(error) An optional error value if an error occurred.
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

// @group utils
// @summary Compare hashed input against a plaintext input.
// @param hash(type=string) The bcrypted input string.
// @param plaintext(type=string) Plaintext input to compare against.
// @return result(bool) True if they are the same, false otherwise.
// @return error(error) An optional error value if an error occurred.
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
	} else if errors.Is(err, bcrypt.ErrHashTooShort) || errors.Is(err, bcrypt.ErrMismatchedHashAndPassword) {
		l.Push(lua.LBool(false))
		return 1
	}

	l.RaiseError("error comparing hash and plaintext: %v", err.Error())
	return 0
}

// @group authenticate
// @summary Authenticate user and create a session token using an Apple sign in token.
// @param token(type=string) Apple sign in token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Authenticate user and create a session token using a custom authentication managed by an external service or source not already supported by Nakama.
// @param id(type=string) Custom ID to use to authenticate the user. Must be between 6-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Authenticate user and create a session token using a device identifier.
// @param id(type=string) Device ID to use to authenticate the user. Must be between 1-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Authenticate user and create a session token using an email address and password.
// @param email(type=string) Email address to use to authenticate the user. Must be between 10-255 characters.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook account token.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Facebook friends after authentication.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

	dbUserID, dbUsername, created, err := AuthenticateFacebook(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	// Import friends if requested.
	if importFriends {
		// Errors are logged before this point and failure here does not invalidate the whole operation.
		_ = importFacebookFriends(l.Context(), n.logger, n.db, n.tracker, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook Instant Game.
// @param playerInfo(type=string) Facebook Player info.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) authenticateFacebookInstantGame(l *lua.LState) int {
	// Parse access token.
	playerInfo := l.CheckString(1)
	if playerInfo == "" {
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

	dbUserID, dbUsername, created, err := AuthenticateFacebookInstantGame(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookInstantGame.AppSecret, playerInfo, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

// @group authenticate
// @summary Authenticate user and create a session token using Apple Game Center credentials.
// @param playerID(type=string) PlayerId provided by GameCenter.
// @param bundleID(type=string) BundleId of your app on iTunesConnect.
// @param timestamp(type=number) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyURL(type=string) A URL to the public key returned by Game Center authentication on client.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

	dbUserID, dbUsername, created, err := AuthenticateGameCenter(l.Context(), n.logger, n.db, n.socialClient, playerID, bundleID, timestamp, salt, signature, publicKeyURL, username, create)
	if err != nil {
		l.RaiseError("error authenticating: %v", err.Error())
		return 0
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

// @group authenticate
// @summary Authenticate user and create a session token using a Google ID token.
// @param token(type=string) Google OAuth access token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Authenticate user and create a session token using a Steam account token.
// @param token(type=string) Steam token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Steam friends after authentication.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return created(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
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
		_ = importSteamFriends(l.Context(), n.logger, n.db, n.tracker, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, n.config.GetSocial().Steam.PublisherKey, steamID, false)
	}

	l.Push(lua.LString(dbUserID))
	l.Push(lua.LString(dbUsername))
	l.Push(lua.LBool(created))
	return 3
}

// @group authenticate
// @summary Generate a Nakama session token from a user ID.
// @param userID(type=string) User ID to use to generate the token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param exp(type=number, optional=true) UTC time in seconds when the token must expire. Defaults to server configured expiry time.
// @param vars(type=table, optional=true) Extra information that will be bundled in the session token.
// @return token(string) The Nakama session token.
// @return validity(number) The period for which the token remains valid.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) authenticateTokenGenerate(l *lua.LState) int {
	// Parse input User ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Input username.
	username := l.CheckString(2)
	if username == "" {
		username = generateUsername()
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

	tokenId := uuid.Must(uuid.NewV4()).String()
	tokenIssuedAt := time.Now().Unix()
	token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, tokenId, tokenIssuedAt, userID, username, varsMap, exp)
	n.sessionCache.Add(uid, exp, tokenId, 0, "")

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

// @group logger
// @summary Write a DEBUG level message to the server logs.
// @param message(type=string) The message to write to server logs with DEBUG level severity.
// @return error(error) An optional error value if an error occurred.
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

// @group logger
// @summary Write an INFO level message to the server logs.
// @param message(type=string) The message to write to server logs with INFO level severity.
// @param vars(type=vars) Variables to replace placeholders in message.
// @return error(error) An optional error value if an error occurred.
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

// @group logger
// @summary Write a WARN level message to the server logs.
// @param message(type=string) The message to write to server logs with WARN level severity.
// @param vars(type=vars) Variables to replace placeholders in message.
// @return error(error) An optional error value if an error occurred.
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

// @group logger
// @summary Write an ERROR level message to the server logs.
// @param message(type=string) The message to write to server logs with ERROR level severity.
// @param vars(type=vars) Variables to replace placeholders in message.
// @return error(error) An optional error value if an error occurred.
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

// @group accounts
// @summary Fetch account information by user ID.
// @param userID(type=string) User ID to fetch information for. Must be valid UUID.
// @return account(table) All account information including wallet, device IDs and more.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) accountGetId(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	account, err := GetAccount(l.Context(), n.logger, n.db, n.statusRegistry, uid)
	if err != nil {
		l.RaiseError("failed to get account for user_id %s: %s", uid, err.Error())
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
		l.RaiseError("failed to convert metadata to json: %s", err.Error())
		return 0
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	accountTable.RawSetString("metadata", metadataTable)

	userTable, err := userToLuaTable(l, account.User)
	if err != nil {
		l.RaiseError("failed to convert user data to lua table: %s", err.Error())
		return 0
	}
	accountTable.RawSetString("user", userTable)

	walletMap := make(map[string]int64)
	err = json.Unmarshal([]byte(account.Wallet), &walletMap)
	if err != nil {
		l.RaiseError("failed to convert wallet to json: %s", err.Error())
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

// @group accounts
// @summary Fetch information for multiple accounts by user IDs.
// @param userIDs(type=table) Table of user IDs to fetch information for. Must be valid UUID.
// @return account(Table) Table of accounts.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) accountsGetId(l *lua.LState) int {
	// Input table validation.
	userIDs := l.OptTable(1, nil)
	if userIDs == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if userIDs.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	uids := make([]string, 0, userIDs.Len())
	var conversionError bool
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
		uids = append(uids, vs)
	})
	if conversionError {
		return 0
	}

	accounts, err := GetAccounts(l.Context(), n.logger, n.db, n.statusRegistry, uids)
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
			l.RaiseError("failed to convert metadata to json: %s", err.Error())
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		accountTable.RawSetString("metadata", metadataTable)

		userTable, err := userToLuaTable(l, account.User)
		if err != nil {
			l.RaiseError("failed to convert user data to lua table: %s", err.Error())
			return 0
		}
		accountTable.RawSetString("user", userTable)

		walletMap := make(map[string]int64)
		err = json.Unmarshal([]byte(account.Wallet), &walletMap)
		if err != nil {
			l.RaiseError("failed to convert wallet to json: %s", err.Error())
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

// @group users
// @summary Fetch one or more users by ID.
// @param userIDs(type=table) A Lua table of user IDs to fetch.
// @param facebookIDs(type=[]string) An array of Facebook IDs to fetch.
// @return users(table) A table of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersGetId(l *lua.LState) int {
	// User IDs Input table validation.
	userIDs := l.OptTable(1, nil)
	var uids []string
	if userIDs != nil {
		userIDsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
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
		uids = userIDStrings
	}

	// Facebook IDs Input table validation.
	facebookIDs := l.OptTable(2, nil)
	var fids []string
	if facebookIDs != nil {
		facebookIDsTable, ok := RuntimeLuaConvertLuaValue(facebookIDs).([]interface{})
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
		fids = facebookIDStrings
	}

	if uids == nil && fids == nil {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.statusRegistry, uids, nil, fids)
	if err != nil {
		l.RaiseError("failed to get users: %s", err.Error())
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, user := range users.Users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError("failed to encode users: %s", err.Error())
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
		return nil, fmt.Errorf("failed to convert user metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	ut.RawSetString("metadata", metadataTable)

	return ut, nil
}

func groupToLuaTable(l *lua.LState, group *api.Group) (*lua.LTable, error) {
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
	err := json.Unmarshal([]byte(group.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert group metadata to json: %s", err.Error())
	}
	metadataTable := RuntimeLuaConvertMap(l, metadataMap)
	gt.RawSetString("metadata", metadataTable)

	return gt, nil
}

func purchaseValidationToLuaTable(l *lua.LState, validation *api.ValidatePurchaseResponse) *lua.LTable {
	validatedPurchasesTable := l.CreateTable(len(validation.ValidatedPurchases), 0)
	for i, p := range validation.ValidatedPurchases {
		validatedPurchasesTable.RawSetInt(i+1, purchaseToLuaTable(l, p))
	}

	validationResponseTable := l.CreateTable(0, 1)
	validationResponseTable.RawSetString("validated_purchases", validatedPurchasesTable)

	return validationResponseTable
}

func purchaseToLuaTable(l *lua.LState, p *api.ValidatedPurchase) *lua.LTable {
	validatedPurchaseTable := l.CreateTable(0, 11)

	validatedPurchaseTable.RawSetString("user_id", lua.LString(p.UserId))
	validatedPurchaseTable.RawSetString("product_id", lua.LString(p.ProductId))
	validatedPurchaseTable.RawSetString("transaction_id", lua.LString(p.TransactionId))
	validatedPurchaseTable.RawSetString("store", lua.LString(p.Store.String()))
	validatedPurchaseTable.RawSetString("provider_response", lua.LString(p.ProviderResponse))
	validatedPurchaseTable.RawSetString("purchase_time", lua.LNumber(p.PurchaseTime.Seconds))
	if p.CreateTime != nil {
		// Create time is empty for non-persisted purchases.
		validatedPurchaseTable.RawSetString("create_time", lua.LNumber(p.CreateTime.Seconds))
	}
	if p.UpdateTime != nil {
		// Update time is empty for non-persisted purchases.
		validatedPurchaseTable.RawSetString("update_time", lua.LNumber(p.UpdateTime.Seconds))
	}
	if p.RefundTime != nil {
		validatedPurchaseTable.RawSetString("refund_time", lua.LNumber(p.RefundTime.Seconds))
	}
	validatedPurchaseTable.RawSetString("environment", lua.LString(p.Environment.String()))
	validatedPurchaseTable.RawSetString("seen_before", lua.LBool(p.SeenBefore))

	return validatedPurchaseTable
}

func subscriptionValidationToLuaTable(l *lua.LState, validation *api.ValidateSubscriptionResponse) *lua.LTable {
	validatedSubscriptionResTable := l.CreateTable(0, 1)
	validatedSubscriptionResTable.RawSetString("validated_subscription", subscriptionToLuaTable(l, validation.ValidatedSubscription))

	return validatedSubscriptionResTable
}

func subscriptionToLuaTable(l *lua.LState, p *api.ValidatedSubscription) *lua.LTable {
	validatedSubscriptionTable := l.CreateTable(0, 13)
	validatedSubscriptionTable.RawSetString("user_id", lua.LString(p.UserId))
	validatedSubscriptionTable.RawSetString("product_id", lua.LString(p.ProductId))
	validatedSubscriptionTable.RawSetString("original_transaction_id", lua.LString(p.OriginalTransactionId))
	validatedSubscriptionTable.RawSetString("store", lua.LString(p.Store.String()))
	validatedSubscriptionTable.RawSetString("purchase_time", lua.LNumber(p.PurchaseTime.Seconds))
	if p.CreateTime != nil {
		// Create time is empty for non-persisted subscriptions.
		validatedSubscriptionTable.RawSetString("create_time", lua.LNumber(p.CreateTime.Seconds))
	}
	if p.UpdateTime != nil {
		// Update time is empty for non-persisted subscriptions.
		validatedSubscriptionTable.RawSetString("update_time", lua.LNumber(p.UpdateTime.Seconds))
	}
	if p.RefundTime != nil {
		validatedSubscriptionTable.RawSetString("refund_time", lua.LNumber(p.RefundTime.Seconds))
	}
	validatedSubscriptionTable.RawSetString("environment", lua.LString(p.Environment.String()))
	validatedSubscriptionTable.RawSetString("expiry_time", lua.LNumber(p.ExpiryTime.Seconds))
	validatedSubscriptionTable.RawSetString("active", lua.LBool(p.Active))
	validatedSubscriptionTable.RawSetString("provider_response", lua.LString(p.ProviderResponse))
	validatedSubscriptionTable.RawSetString("provider_notification", lua.LString(p.ProviderNotification))

	return validatedSubscriptionTable
}

// @group users
// @summary Fetch one or more users by username.
// @param usernames(type=table) A table of usernames to fetch.
// @return users(table) A table of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersGetUsername(l *lua.LState) int {
	// Input table validation.
	usernames := l.OptTable(1, nil)
	if usernames == nil {
		l.ArgError(1, "invalid username list")
		return 0
	}
	if usernames.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	usernamesArray, ok := RuntimeLuaConvertLuaValue(usernames).([]interface{})
	if !ok {
		l.ArgError(1, "invalid username data")
		return 0
	}
	if len(usernamesArray) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	usernameStrings := make([]string, 0, len(usernamesArray))
	for _, u := range usernamesArray {
		us, ok := u.(string)
		if !ok || us == "" {
			l.ArgError(1, "each username must be a string")
			return 0
		}
		usernameStrings = append(usernameStrings, us)
	}

	// Get the user accounts.
	users, err := GetUsers(l.Context(), n.logger, n.db, n.statusRegistry, nil, usernameStrings, nil)
	if err != nil {
		l.RaiseError("failed to get users: %s", err.Error())
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users.Users), 0)
	for i, user := range users.Users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError("failed to encode users: %s", err.Error())
			return 0
		}
		usersTable.RawSetInt(i+1, userTable)
	}

	l.Push(usersTable)
	return 1
}

// @group users
// @summary Get user's friend status information for a list of target users.
// @param userID(type=string) The current user ID.
// @param userIDs(type=table) An array of target user IDs.
// @return friends(table) A list of user friends objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersGetFriendStatus(l *lua.LState) int {
	userID := l.CheckString(1)

	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
	}

	userIDs := l.CheckTable(2)

	uidsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
	if !ok {
		l.ArgError(2, "invalid user ids list")
		return 0
	}

	fids := make([]uuid.UUID, 0, len(uidsTable))
	for _, id := range uidsTable {
		ids, ok := id.(string)
		if !ok || ids == "" {
			l.ArgError(2, "each user id must be a string")
			return 0
		}
		fid, err := uuid.FromString(ids)
		if err != nil {
			l.ArgError(2, "invalid user id")
			return 0
		}
		fids = append(fids, fid)
	}

	friends, err := GetFriends(l.Context(), n.logger, n.db, n.statusRegistry, uid, fids)
	if err != nil {
		l.RaiseError("failed to get users friend status: %s", err.Error())
		return 0
	}

	userFriends := l.CreateTable(len(friends), 0)
	for i, f := range friends {
		u := f.User

		fut, err := userToLuaTable(l, u)
		if err != nil {
			l.RaiseError("failed to convert user data to lua table: %s", err.Error())
			return 0
		}

		ft := l.CreateTable(0, 4)
		ft.RawSetString("state", lua.LNumber(f.State.Value))
		ft.RawSetString("update_time", lua.LNumber(f.UpdateTime.Seconds))
		ft.RawSetString("user", fut)
		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(f.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError("failed to unmarshal friend metadata: %s", err.Error())
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		ft.RawSetString("metadata", metadataTable)

		userFriends.RawSetInt(i+1, ft)
	}

	l.Push(userFriends)
	return 1
}

// @group users
// @summary Fetch one or more users randomly.
// @param count(type=int) The number of users to fetch.
// @return users(table) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersGetRandom(l *lua.LState) int {
	count := l.OptInt(1, 0)

	if count < 0 || count > 1000 {
		l.ArgError(1, "count must be 0-1000")
		return 0
	}

	users, err := GetRandomUsers(l.Context(), n.logger, n.db, n.statusRegistry, count)
	if err != nil {
		l.RaiseError("failed to get users: %s", err.Error())
		return 0
	}

	// Convert and push the values.
	usersTable := l.CreateTable(len(users), 0)
	for i, user := range users {
		userTable, err := userToLuaTable(l, user)
		if err != nil {
			l.RaiseError("failed to encode users: %s", err.Error())
			return 0
		}
		usersTable.RawSetInt(i+1, userTable)
	}

	l.Push(usersTable)
	return 1
}

// @group users
// @summary Ban one or more users by ID.
// @param userIDs(type=table) A table of user IDs to ban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersBanId(l *lua.LState) int {
	// Input table validation.
	userIDs := l.OptTable(1, nil)
	if userIDs == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if userIDs.Len() == 0 {
		return 0
	}
	userIDsArray, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}
	if len(userIDsArray) == 0 {
		return 0
	}

	// Input individual ID validation.
	uids := make([]uuid.UUID, 0, len(userIDsArray))
	for _, id := range userIDsArray {
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
	err := BanUsers(l.Context(), n.logger, n.db, n.config, n.sessionCache, n.sessionRegistry, n.tracker, uids)
	if err != nil {
		l.RaiseError("failed to ban users: %s", err.Error())
		return 0
	}

	return 0
}

// @group users
// @summary Unban one or more users by ID.
// @param userIDs(type=table) A table of user IDs to unban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) usersUnbanId(l *lua.LState) int {
	// Input table validation.
	userIDs := l.OptTable(1, nil)
	if userIDs == nil {
		l.ArgError(1, "invalid user id list")
		return 0
	}
	if userIDs.Len() == 0 {
		return 0
	}
	userIDsArray, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user id data")
		return 0
	}
	if len(userIDsArray) == 0 {
		return 0
	}

	// Input individual ID validation.
	uids := make([]uuid.UUID, 0, len(userIDsArray))
	for _, id := range userIDsArray {
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
		l.RaiseError("failed to unban users: %s", err.Error())
		return 0
	}

	return 0
}

// @group authenticate
// @summary Link Apple authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param token(type=string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Link custom authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param customID(type=string) Custom ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Link device authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param deviceID(type=string) Device ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Link email authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param email(type=string) Authentication email to be linked to the user.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Link Facebook authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param username(type=string, optional=true) If left empty, one is generated.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Facebook friends after authentication.
// @return error(error) An optional error value if an error occurred.
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

	if err := LinkFacebook(l.Context(), n.logger, n.db, n.socialClient, n.tracker, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Link Facebook Instant Game authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param playerInfo(type=string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) linkFacebookInstantGame(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	playerInfo := l.CheckString(2)
	if playerInfo == "" {
		l.ArgError(2, "expects signed player info string")
		return 0
	}

	if err := LinkFacebookInstantGame(l.Context(), n.logger, n.db, n.config, n.socialClient, id, playerInfo); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Link Apple Game Center authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param playerID(type=string) Player ID provided by Game Center.
// @param bundleID(type=string) Bundle ID of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyURL(type=string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
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
	timestamp := l.CheckInt64(4)
	if timestamp == 0 {
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

	if err := LinkGameCenter(l.Context(), n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyURL); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Link Google authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param token(type=string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Link Steam authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param username(type=string) If left empty, one is generated.
// @param token(type=string) Steam access token.
// @param importFriends(type=bool, optiona=true, default=true) Whether to automatically import Steam friends after authentication.
// @return error(error) An optional error value if an error occurred.
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

	if err := LinkSteam(l.Context(), n.logger, n.db, n.config, n.socialClient, n.tracker, n.router, id, username, token, importFriends); err != nil {
		l.RaiseError("error linking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Apple authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkApple(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.OptString(2, "")

	if err := UnlinkApple(l.Context(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink custom authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param customID(type=string, optional=true) Custom ID to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkCustom(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	customID := l.OptString(2, "")

	if err := UnlinkCustom(l.Context(), n.logger, n.db, id, customID); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink device authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param deviceID(type=string) Device ID to be unlinked to the user.
// @return error(error) An optional error value if an error occurred.
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

// @group authenticate
// @summary Unlink email authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param email(type=string, optional=true) Email to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkEmail(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	email := l.OptString(2, "")

	if err := UnlinkEmail(l.Context(), n.logger, n.db, id, email); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Facebook authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Facebook OAuth or Limited Login (JWT) access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkFacebook(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.OptString(2, "")

	if err := UnlinkFacebook(l.Context(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Facebook Instant Game authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param playerInfo(type=string, optional=true) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkFacebookInstantGame(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	playerInfo := l.OptString(2, "")

	if err := UnlinkFacebookInstantGame(l.Context(), n.logger, n.db, n.config, n.socialClient, id, playerInfo); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Apple Game Center authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param playerID(type=string) Player ID provided by Game Center.
// @param bundleID(type=string) Bundle ID of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyURL(type=string) A URL to the public key returned by Game Center authentication on client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkGameCenter(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	setArgs := false
	playerID := l.OptString(2, "")
	if playerID != "" {
		setArgs = true
	}
	bundleID := l.OptString(3, "")
	if bundleID == "" && setArgs {
		l.ArgError(3, "expects bundle ID string")
		return 0
	}
	timestamp := l.OptInt64(4, 0)
	if timestamp == 0 && setArgs {
		l.ArgError(4, "expects timestamp value")
		return 0
	}
	salt := l.OptString(5, "")
	if salt == "" && setArgs {
		l.ArgError(5, "expects salt string")
		return 0
	}
	signature := l.OptString(6, "")
	if signature == "" && setArgs {
		l.ArgError(6, "expects signature string")
		return 0
	}
	publicKeyURL := l.OptString(7, "")
	if publicKeyURL == "" && setArgs {
		l.ArgError(7, "expects public key URL string")
		return 0
	}

	if err := UnlinkGameCenter(l.Context(), n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyURL); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Google authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkGoogle(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.OptString(2, "")

	if err := UnlinkGoogle(l.Context(), n.logger, n.db, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group authenticate
// @summary Unlink Steam authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Steam access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) unlinkSteam(l *lua.LState) int {
	userID := l.CheckString(1)
	id, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "user ID must be a valid identifier")
		return 0
	}

	token := l.OptString(2, "")

	if err := UnlinkSteam(l.Context(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
		l.RaiseError("error unlinking: %v", err.Error())
	}
	return 0
}

// @group streams
// @summary List all users currently online and connected to a stream.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @param includeHidden(type=bool, optional=true, default=true) Include stream presences marked as hidden in the results.
// @param includeNotHidden(type=bool, optional=true, default=true) Include stream presences not marked as hidden in the results.
// @return presences(table) Table of stream presences and their information.
// @return error(error) An optional error value if an error occurred.
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

// @group streams
// @summary Retrieve a stream presence and metadata by user ID.
// @param userID(type=string) The user ID to fetch information for.
// @param sessionID(type=string) The current session ID for the user.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @return meta(table) Presence and metadata for the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) streamUserGet(l *lua.LState) int {
	// Parse input User ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionID := l.CheckString(2)
	if sessionID == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sid, err := uuid.FromString(sessionID)
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

	meta := n.tracker.GetLocalBySessionIDStreamUserID(sid, stream, uid)
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

// @group streams
// @summary Add a user to a stream.
// @param userID(type=string) The user ID to be added.
// @param sessionID(type=string) The current session ID for the user.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @param hidden(type=bool, optional=true, default=false) Whether the user will be marked as hidden.
// @param persistence(type=bool, optional=true, default=true) Whether message data should be stored in the database.
// @param status(type=string, optional=true) User status message.
// @return success(bool) Whether the user was successfully added.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) streamUserJoin(l *lua.LState) int {
	// Parse input User ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionID := l.CheckString(2)
	if sessionID == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sid, err := uuid.FromString(sessionID)
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
	// By default, persistence is enabled, if the stream supports it.
	persistence := l.OptBool(5, true)
	// By default, no status is set.
	status := l.OptString(6, "")

	success, newlyTracked, err := n.streamManager.UserJoin(stream, uid, sid, hidden, persistence, status)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			l.ArgError(2, "session id does not exist")
			return 0
		}
		l.RaiseError("stream user join failed: %v", err.Error())
		return 0
	}
	if !success {
		l.RaiseError("tracker rejected new presence, session is closing")
		return 0
	}

	l.Push(lua.LBool(newlyTracked))
	return 1
}

// @group streams
// @summary Update a stream user by ID.
// @param userID(type=string) The user ID to be updated.
// @param sessionID(type=string) The current session ID for the user.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @param hidden(type=bool, optional=true, default=false) Whether the user will be marked as hidden.
// @param persistence(type=bool, optional=true, default=true) Whether message data should be stored in the database.
// @param status(type=string, optional=true) User status message.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) streamUserUpdate(l *lua.LState) int {
	// Parse input User ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionID := l.CheckString(2)
	if sessionID == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sid, err := uuid.FromString(sessionID)
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

	success, err := n.streamManager.UserUpdate(stream, uid, sid, hidden, persistence, status)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			l.ArgError(2, "session id does not exist")
			return 0
		}
		l.RaiseError("stream user update failed: %v", err.Error())
		return 0
	}
	if !success {
		l.RaiseError("tracker rejected updated presence, session is closing")
	}

	return 0
}

// @group streams
// @summary Remove a user from a stream.
// @param userID(type=string) The user ID to be removed.
// @param sessionID(type=string) The current session ID for the user.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) streamUserLeave(l *lua.LState) int {
	// Parse input User ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	// Parse input Session ID.
	sessionID := l.CheckString(2)
	if sessionID == "" {
		l.ArgError(2, "expects session id")
		return 0
	}
	sid, err := uuid.FromString(sessionID)
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

	if err := n.streamManager.UserLeave(stream, uid, sid); err != nil {
		l.RaiseError("stream user leave failed: %v", err.Error())
	}

	return 0
}

// @group streams
// @summary Kick user(s) from a stream.
// @param presences(type=table) The presence(s) to be kicked.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) streamUserKick(l *lua.LState) int {
	// Parse presence.
	presences := l.OptTable(1, nil)
	if presences == nil {
		l.ArgError(1, "expects a valid presence")
		return 0
	}
	userID := uuid.Nil
	sessionID := uuid.Nil
	node := n.node
	conversionError := false
	presences.ForEach(func(k lua.LValue, v lua.LValue) {
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
		l.RaiseError("stream user kick failed: %v", err.Error())
	}

	return 0
}

// @group streams
// @summary Get a count of stream presences.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @return countByStream(number) Number of current stream presences.
// @return error(error) An optional error value if an error occurred.
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

// @group streams
// @summary Close a stream and remove all presences on it.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @return error(error) An optional error value if an error occurred.
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

// @group streams
// @summary Send data to presences on a stream.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @param data(type=string) The data to send.
// @param presences(type=table) Table of presences to receive the sent data. If not set, will be sent to all presences.
// @param reliable(type=bool, optiona=true, default=true) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
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

	presences := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if presences != nil {
		if ln := presences.Len(); ln != 0 {
			presenceIDs = make([]*PresenceID, 0, ln)
			presences.ForEach(func(k lua.LValue, v lua.LValue) {
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

// @group streams
// @summary Send a message to presences on a stream.
// @param streamTable(type=table) A stream object consisting of a `mode` (int), `subject` (string), `descriptor` (string) and `label` (string).
// @param envelope(type=&rtapi.Envelope{}) The message to send.
// @param presences(type=table) Table of presences to receive the sent data. If not set, will be sent to all presences.
// @param reliable(type=bool, optional=true, default=true) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
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
	envelope := RuntimeLuaConvertLuaTable(l.CheckTable(2))
	envelopeBytes, err := json.Marshal(envelope)
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
	presences := l.OptTable(3, nil)
	var presenceIDs []*PresenceID
	if presences != nil {
		if ln := presences.Len(); ln != 0 {
			presenceIDs = make([]*PresenceID, 0, ln)
			presences.ForEach(func(k lua.LValue, v lua.LValue) {
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

// @group sessions
// @summary Disconnect a session.
// @param sessionID(type=string) The ID of the session to be disconnected.
// @param reason(type=[]runtime.PresenceReason) The reason for the session disconnect.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) sessionDisconnect(l *lua.LState) int {
	// Parse input Session ID.
	sessionID := l.CheckString(1)
	if sessionID == "" {
		l.ArgError(1, "expects session id")
		return 0
	}
	sid, err := uuid.FromString(sessionID)
	if err != nil {
		l.ArgError(1, "expects valid session id")
		return 0
	}

	reasonArray := make([]runtime.PresenceReason, 0, 1)
	reason := l.OptInt64(2, 0)
	if reason != 0 {
		if reason < 0 || reason > 4 {
			l.ArgError(2, "invalid disconnect reason, must be a value 0-4")
			return 0
		}
		reasonArray = append(reasonArray, runtime.PresenceReason(reason))
	}

	if err := n.sessionRegistry.Disconnect(l.Context(), sid, false, reasonArray...); err != nil {
		l.RaiseError("failed to disconnect: %s", err.Error())
	}
	return 0
}

// @group sessions
// @summary Log out a user from their current session.
// @param userID(type=string) The ID of the user to be logged out.
// @param token(type=string) The current session authentication token.
// @param refreshToken(type=string) The current session refresh token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) sessionLogout(l *lua.LState) int {
	// Parse input.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects valid user id")
		return 0
	}

	token := l.OptString(2, "")
	refreshToken := l.OptString(3, "")

	if err := SessionLogout(n.config, n.sessionCache, uid, token, refreshToken); err != nil {
		l.RaiseError("failed to logout: %s", err.Error())
	}
	return 0
}

// @group matches
// @summary Create a new authoritative realtime multiplayer match running on the given runtime module name. The given params are passed to the match's init hook.
// @param module(type=string) The name of an available runtime module that will be responsible for the match. This was registered in InitModule.
// @param params(type=any, optional=true) Any value to pass to the match init hook.
// @return matchId(string) The match ID of the newly created match. Clients can immediately use this ID to join the match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) matchCreate(l *lua.LState) int {
	// Parse the name of the Lua module that should handle the match.
	module := l.CheckString(1)
	if module == "" {
		l.ArgError(1, "expects module name")
		return 0
	}

	params := RuntimeLuaConvertLuaValue(l.CheckAny(2))
	var paramsMap map[string]interface{}
	if params != nil {
		var ok bool
		paramsMap, ok = params.(map[string]interface{})
		if !ok {
			l.ArgError(2, "expects params to be nil or a table of key-value pairs")
			return 0
		}
	}

	id, err := n.matchRegistry.CreateMatch(l.Context(), n.matchCreateFn, module, paramsMap)
	if err != nil {
		l.RaiseError("error creating match: %s", err.Error())
		return 0
	}

	l.Push(lua.LString(id))
	return 1
}

// @group matches
// @summary Get information on a running match.
// @param id(type=string) The ID of the match to fetch.
// @return match(table) Information for the running match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) matchGet(l *lua.LState) int {
	// Parse match ID.
	id := l.CheckString(1)

	result, _, err := n.matchRegistry.GetMatch(l.Context(), id)
	if err != nil {
		l.RaiseError("failed to get match: %s", err.Error())
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

// @group matches
// @summary Allow the match handler to be sent a reservation signal to mark a user ID or session ID into the match state ahead of their join attempt and eventual join flow. Called when the match handler receives a runtime signal.
// @param id(type=string) The user ID or session ID to send a reservation signal for.
// @param data(type=string) An arbitrary input supplied by the runtime caller of the signal.
// @return state(any) An (optionally) updated state. May be any non-nil value, or nil to end the match.
// @return data(string) Arbitrary data to return to the runtime caller of the signal. May be a string or nil.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) matchSignal(l *lua.LState) int {
	// Parse match ID.
	id := l.CheckString(1)
	// Parse signal data, if any.
	data := l.OptString(2, "")

	responseData, err := n.matchRegistry.Signal(l.Context(), id, data)
	if err != nil {
		l.RaiseError("failed to signal match: %s", err.Error())
		return 0
	}

	l.Push(lua.LString(responseData))
	return 1
}

// @group matches
// @summary List currently running realtime multiplayer matches and optionally filter them by authoritative mode, label, and current participant count.
// @param limit(type=number, optional=true, default=1) The maximum number of matches to list.
// @param authoritativeIn(type=bool, optional=true, default=nil) Set true to only return authoritative matches, false to only return relayed matches and nil to return both.
// @param labelIn(type=string, optional=true, default="") A label to filter authoritative matches by. Default "" means any label matches.
// @param minSize(type=number, optional=true) Inclusive lower limit of current match participants.
// @param maxSize(type=number, optional=true) Inclusive upper limit of current match participants.
// @param query(type=string, optional=true) Additional query parameters to shortlist matches.
// @return match(table) A table of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) matchList(l *lua.LState) int {
	// Parse limit.
	limit := l.OptInt(1, 1)

	// Parse authoritative flag.
	var authoritative *wrapperspb.BoolValue
	if authoritativeIn := l.CheckAny(2); authoritativeIn.Type() != lua.LTNil {
		if authoritativeIn.Type() != lua.LTBool {
			l.ArgError(2, "expects authoritative true/false or nil")
			return 0
		}
		authoritative = &wrapperspb.BoolValue{Value: lua.LVAsBool(authoritativeIn)}
	}

	// Parse label filter.
	var label *wrapperspb.StringValue
	if labelIn := l.CheckAny(3); labelIn.Type() != lua.LTNil {
		if labelIn.Type() != lua.LTString {
			l.ArgError(3, "expects label string or nil")
			return 0
		}
		label = &wrapperspb.StringValue{Value: lua.LVAsString(labelIn)}
	}

	// Parse minimum size filter.
	var minSizeInt *wrapperspb.Int32Value
	if minSize := l.CheckAny(4); minSize.Type() != lua.LTNil {
		if minSize.Type() != lua.LTNumber {
			l.ArgError(4, "expects minimum size number or nil")
			return 0
		}
		minSizeInt = &wrapperspb.Int32Value{Value: int32(lua.LVAsNumber(minSize))}
	}

	// Parse maximum size filter.
	var maxSizeInt *wrapperspb.Int32Value
	if maxSize := l.CheckAny(5); maxSize.Type() != lua.LTNil {
		if maxSize.Type() != lua.LTNumber {
			l.ArgError(5, "expects maximum size number or nil")
			return 0
		}
		maxSizeInt = &wrapperspb.Int32Value{Value: int32(lua.LVAsNumber(maxSize))}
	}

	var queryString *wrapperspb.StringValue
	if query := l.CheckAny(6); query.Type() != lua.LTNil {
		if query.Type() != lua.LTString {
			l.ArgError(6, "expects query string or nil")
			return 0
		}
		queryString = &wrapperspb.StringValue{Value: lua.LVAsString(query)}
	}

	results, _, err := n.matchRegistry.ListMatches(l.Context(), limit, authoritative, label, minSizeInt, maxSizeInt, queryString, nil)
	if err != nil {
		l.RaiseError("failed to list matches: %s", err.Error())
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

// @group notifications
// @summary Send one in-app notification to a user.
// @param userID(type=string) The user ID of the user to be sent the notification.
// @param subject(type=string) Notification subject.
// @param contentMap(type=table) Notification content. Must be set but can be an empty table.
// @param code(type=number) Notification code to use. Must be equal or greater than 0.
// @param sender(type=string, optional=true) The sender of this notification. If left empty, it will be assumed that it is a system notification.
// @param persistent(type=bool, optional=true, default=false) Whether to record this in the database for later listing.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationSend(l *lua.LState) int {
	userID := l.CheckString(1)
	uid, err := uuid.FromString(userID)
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
	if code <= 0 && !(-2000 <= code && code <= -1000) {
		l.ArgError(4, "expects code number to be a positive integer")
		return 0
	}

	sender := l.OptString(5, "")
	senderID := uuid.Nil.String()
	if sender != "" {
		suid, err := uuid.FromString(sender)
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
		uid: nots,
	}

	if err := NotificationSend(l.Context(), n.logger, n.db, n.tracker, n.router, notifications); err != nil {
		l.RaiseError("failed to send notifications: %s", err.Error())
	}

	return 0
}

// @group notifications
// @summary Send one or more in-app notifications to a user.
// @param notifications(type=table) A list of notifications to be sent together.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsSend(l *lua.LState) int {
	notifications := l.CheckTable(1)
	if notifications == nil {
		l.ArgError(1, "expects a valid set of notifications")
		return 0
	}

	conversionError := false
	notificationsMap := make(map[uuid.UUID][]*api.Notification)
	notifications.ForEach(func(i lua.LValue, g lua.LValue) {
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

		no := notificationsMap[userID]
		if no == nil {
			no = make([]*api.Notification, 0, 1)
		}
		no = append(no, notification)
		notificationsMap[userID] = no
	})

	if conversionError {
		return 0
	}

	if err := NotificationSend(l.Context(), n.logger, n.db, n.tracker, n.router, notificationsMap); err != nil {
		l.RaiseError("failed to send notifications: %s", err.Error())
	}

	return 0
}

// @group notifications
// @summary Send an in-app notification to all users.
// @param subject(type=string) Notification subject.
// @param content(type=table) Notification content. Must be set but can be an empty table.
// @param code(type=number) Notification code to use. Must be greater than or equal to 0.
// @param persistent(type=bool, optional=true, default=false) Whether to record this in the database for later listing.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationSendAll(l *lua.LState) int {
	subject := l.CheckString(1)
	if subject == "" {
		l.ArgError(1, "expects subject to be a non-empty string")
		return 0
	}

	content := RuntimeLuaConvertLuaTable(l.CheckTable(2))
	contentBytes, err := json.Marshal(content)
	if err != nil {
		l.ArgError(2, fmt.Sprintf("failed to convert content: %s", err.Error()))
		return 0
	}
	contentString := string(contentBytes)

	code := l.CheckInt(3)
	if code <= 0 {
		l.ArgError(3, "expects code number to be a positive integer")
		return 0
	}

	persistent := l.OptBool(4, false)

	senderID := uuid.Nil.String()
	createTime := &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()}

	notification := &api.Notification{
		Id:         uuid.Must(uuid.NewV4()).String(),
		Subject:    subject,
		Content:    contentString,
		Code:       int32(code),
		SenderId:   senderID,
		Persistent: persistent,
		CreateTime: createTime,
	}

	if err := NotificationSendAll(l.Context(), n.logger, n.db, n.tracker, n.router, notification); err != nil {
		l.RaiseError("failed to send notification: %s", err.Error())
	}

	return 0
}

// @group notifications
// @summary List notifications by user id.
// @param userID(type=string) Optional userID to scope results to that user only.
// @param limit(type=int, optional=true, default=100) Limit number of results. Must be a value between 1 and 1000.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return notifications(table) A list of notifications.
// @return cursor(string) A cursor to fetch the next page of results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsList(l *lua.LState) int {
	userID := l.CheckString(1)
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects user_id to be a valid uuid")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 1000 {
		l.ArgError(2, "expects limit to be value between 1 and 1000")
		return 0
	}

	cursor := l.OptString(3, "")

	list, err := NotificationList(l.Context(), n.logger, n.db, uid, limit, cursor, false)
	if err != nil {
		l.RaiseError("failed to list notifications: %s", err.Error())
		return 0
	}

	if len(list.Notifications) == 0 {
		list.CacheableCursor = ""
	}

	notifsTable := l.CreateTable(len(list.Notifications), 0)
	for i, no := range list.Notifications {
		noTable := l.CreateTable(0, len(list.Notifications))

		noTable.RawSetString("id", lua.LString(no.Id))
		noTable.RawSetString("subject", lua.LString(no.Subject))
		noTable.RawSetString("content", lua.LString(no.Content))
		noTable.RawSetString("code", lua.LNumber(no.Code))
		noTable.RawSetString("senderId", lua.LString(no.SenderId))
		noTable.RawSetString("persistent", lua.LBool(no.Persistent))
		noTable.RawSetString("createTime", lua.LNumber(no.CreateTime.Seconds))

		notifsTable.RawSetInt(i+1, noTable)
	}

	l.Push(notifsTable)

	if list.CacheableCursor != "" {
		l.Push(lua.LString(list.CacheableCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

// @group notifications
// @summary Delete one or more in-app notifications.
// @param notifications(type=table) A list of notifications to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsDelete(l *lua.LState) int {
	notifications := l.CheckTable(1)
	if notifications == nil {
		l.ArgError(1, "expects a valid set of notifications")
		return 0
	}

	conversionError := false
	notificationsMap := make(map[uuid.UUID][]string)
	notifications.ForEach(func(i lua.LValue, g lua.LValue) {
		if conversionError {
			return
		}

		notificationTable, ok := g.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of notifications")
			return
		}

		userID := uuid.Nil
		notificationIDStr := ""
		notificationTable.ForEach(func(k, v lua.LValue) {
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
			case "notification_id":
				if v.Type() == lua.LTNil {
					return
				}
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects notification_id to be string")
					return
				}
				u := v.String()
				if u == "" {
					l.ArgError(1, "expects notification_id to be a valid UUID")
					return
				}
				_, err := uuid.FromString(u)
				if err != nil {
					l.ArgError(1, "expects notification_id to be a valid UUID")
					return
				}
				notificationIDStr = u
			}
		})

		if conversionError {
			return
		}

		no := notificationsMap[userID]
		if no == nil {
			no = make([]string, 0, 1)
		}
		no = append(no, notificationIDStr)
		notificationsMap[userID] = no
	})

	if conversionError {
		return 0
	}

	for uid, notificationIDs := range notificationsMap {
		if err := NotificationDelete(l.Context(), n.logger, n.db, uid, notificationIDs); err != nil {
			l.RaiseError("failed to delete notifications: %s", err.Error())
		}
	}

	return 0
}

// @group notifications
// @summary Update notifications by their id.
// @param updates(type=table) A list of notifications to be updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsUpdate(l *lua.LState) int {
	updates := l.CheckTable(1)

	updatesArray, err := tableToNotificationUpdates(l, updates)
	if err != nil {
		return 0
	}

	if err := NotificationsUpdate(l.Context(), n.logger, n.db, updatesArray...); err != nil {
		l.RaiseError("failed to update notifications: %s", err.Error())
	}

	return 0
}

func tableToNotificationUpdates(l *lua.LState, dataTable *lua.LTable) ([]notificationUpdate, error) {
	size := dataTable.Len()
	updates := make([]notificationUpdate, 0, size)
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

		update := notificationUpdate{}
		dataTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects id to be string")
					return
				}
				var uid uuid.UUID
				var err error
				if uid, err = uuid.FromString(v.String()); err != nil {
					conversionError = true
					l.ArgError(1, "expects user_id to be a valid ID")
					return
				}
				update.Id = uid
			case "content":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects content to be table")
					return
				}
				valueMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
				update.Content = valueMap
			case "subject":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects subject to be string")
					return
				}
				if v.String() == "" {
					conversionError = true
					l.ArgError(1, "expects subject to be a non-empty string")
					return
				}
				s := v.String()
				update.Subject = &s
			case "sender":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects sender to be string")
					return
				}
				if v.String() == "" {
					conversionError = true
					l.ArgError(1, "expects sender to be a non-empty string")
					return
				}
				s := v.String()
				update.Sender = &s
			}
		})

		if conversionError {
			return
		}

		updates = append(updates, update)
	})

	return updates, nil
}

// @group notifications
// @summary Get notifications by their id.
// @param notificationIDs(type=table) A list of notification ids.
// @param userID(type=string) Optional userID to scope results to that user only.
// @return notifications(type=table) A list of notifications.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsGetId(l *lua.LState) int {
	notificationIDs := l.CheckTable(1)

	notifIdsTable, ok := RuntimeLuaConvertLuaValue(notificationIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user ids list")
		return 0
	}

	notifIds := make([]string, 0, len(notifIdsTable))
	for _, id := range notifIdsTable {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each notification id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each notification id must be a valid id")
			return 0
		} else {
			notifIds = append(notifIds, ids)
		}
	}

	userID := l.OptString(2, "")

	notifications, err := NotificationsGetId(l.Context(), n.logger, n.db, userID, notifIds...)
	if err != nil {
		l.RaiseError("failed to get notifications: %s", err.Error())
	}

	notificationsTable := l.CreateTable(len(notifications), 0)
	for i, notif := range notifications {
		notifTable := l.CreateTable(0, 7)
		notifTable.RawSetString("code", lua.LNumber(notif.Code))
		valueTable := RuntimeLuaConvertMap(l, notif.Content)
		notifTable.RawSetString("content", valueTable)
		if notif.Sender != "" {
			notifTable.RawSetString("sender_id", lua.LString(notif.Sender))
		}
		notifTable.RawSetString("subject", lua.LString(notif.Subject))
		notifTable.RawSetString("user_id", lua.LString(notif.UserID))
		notifTable.RawSetString("create_time", lua.LNumber(notif.CreateTime.Seconds))
		notifTable.RawSetString("persistent", lua.LBool(notif.Persistent))

		notificationsTable.RawSetInt(i+1, notifTable)
	}

	l.Push(notificationsTable)

	return 1
}

// @group notifications
// @summary Delete notifications by their id.
// @param notificationIDs(type=table) A list of notification ids.
// @param userID(type=string) Optional userID to scope deletions to that user only.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) notificationsDeleteId(l *lua.LState) int {
	notificationIDs := l.OptTable(1, nil)

	notifIdsTable, ok := RuntimeLuaConvertLuaValue(notificationIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid user ids list")
		return 0
	}

	notifIds := make([]string, 0, len(notifIdsTable))
	for _, id := range notifIdsTable {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each notification id must be a string")
			return 0
		} else if _, err := uuid.FromString(ids); err != nil {
			l.ArgError(1, "each notification id must be a valid id")
			return 0
		} else {
			notifIds = append(notifIds, ids)
		}
	}

	userID := l.OptString(2, "")

	if err := NotificationsDeleteId(l.Context(), n.logger, n.db, userID, notifIds...); err != nil {
		l.RaiseError("failed to delete notifications: %s", err.Error())
	}

	return 0
}

// @group wallets
// @summary Update a user's wallet with the given changeset.
// @param userID(type=string) The ID of the user whose wallet to update.
// @param changeset(type=table) The set of wallet operations to apply.
// @param metadata(type=table, optional=true) Additional metadata to tag the wallet update with.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this update in the ledger.
// @return result(table) The changeset after the update and before to the update, respectively.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) walletUpdate(l *lua.LState) int {
	// Parse user ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects a valid user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "expects a valid user id")
		return 0
	}

	// Parse changeset.
	changeset := l.CheckTable(2)
	if changeset == nil {
		l.ArgError(2, "expects a table as changeset value")
		return 0
	}
	changesetMap := RuntimeLuaConvertLuaTable(changeset)
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
	metadata := l.OptTable(3, nil)
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err = json.Marshal(metadataMap)
		if err != nil {
			l.ArgError(3, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
			return 0
		}
	}

	updateLedger := l.OptBool(4, false)

	results, err := UpdateWallets(l.Context(), n.logger, n.db, []*walletUpdate{{
		UserID:    uid,
		Changeset: changesetMapInt64,
		Metadata:  string(metadataBytes),
	}}, updateLedger)
	if err != nil {
		l.RaiseError("failed to update user wallet: %s", err.Error())
		return 0
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

// @group wallets
// @summary Update one or more user wallets with individual changesets. This function will also insert a new wallet ledger item into each user's wallet history that tracks their update.
// @param updates(type=table) The set of user wallet update operations to apply.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this update in the ledger.
// @return updateWallets(table) A list of wallet update results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) walletsUpdate(l *lua.LState) int {
	updates := l.CheckTable(1)
	if updates == nil {
		l.ArgError(1, "expects a valid set of updates")
		return 0
	}
	size := updates.Len()
	if size == 0 {
		return 0
	}

	updatesArray := make([]*walletUpdate, 0, size)
	conversionError := false
	updates.ForEach(func(k, v lua.LValue) {
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

		updatesArray = append(updatesArray, update)
	})
	if conversionError {
		return 0
	}

	updateLedger := l.OptBool(2, false)

	results, err := UpdateWallets(l.Context(), n.logger, n.db, updatesArray, updateLedger)
	if err != nil {
		l.RaiseError("failed to update user wallet: %s", err.Error())
		return 0
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

// @group wallets
// @summary Update the metadata for a particular wallet update in a user's wallet ledger history. Useful when adding a note to a transaction for example.
// @param itemID(type=string) The ID of the wallet ledger item to update.
// @param metadata(type=table) The new metadata to set on the wallet ledger item.
// @return itemTable(table) The updated wallet ledger item.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) walletLedgerUpdate(l *lua.LState) int {
	// Parse ledger ID.
	itemID := l.CheckString(1)
	if itemID == "" {
		l.ArgError(1, "expects a valid id")
		return 0
	}
	iid, err := uuid.FromString(itemID)
	if err != nil {
		l.ArgError(1, "expects a valid id")
		return 0
	}

	// Parse metadata.
	metadata := l.CheckTable(2)
	if metadata == nil {
		l.ArgError(2, "expects a table as metadata value")
		return 0
	}
	metadataMap := RuntimeLuaConvertLuaTable(metadata)
	metadataBytes, err := json.Marshal(metadataMap)
	if err != nil {
		l.ArgError(2, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
		return 0
	}

	item, err := UpdateWalletLedger(l.Context(), n.logger, n.db, iid, string(metadataBytes))
	if err != nil {
		l.RaiseError("failed to update user wallet ledger: %s", err.Error())
		return 0
	}

	itemTable := l.CreateTable(0, 6)
	itemTable.RawSetString("id", lua.LString(itemID))
	itemTable.RawSetString("user_id", lua.LString(item.UserID))
	itemTable.RawSetString("create_time", lua.LNumber(item.CreateTime))
	itemTable.RawSetString("update_time", lua.LNumber(item.UpdateTime))

	changesetTable := RuntimeLuaConvertMapInt64(l, item.Changeset)
	itemTable.RawSetString("changeset", changesetTable)

	itemTable.RawSetString("metadata", metadata)

	l.Push(itemTable)
	return 1
}

// @group wallets
// @summary List all wallet updates for a particular user from oldest to newest.
// @param userID(type=string) The ID of the user to list wallet updates for.
// @param limit(type=number, optional=true, default=100) Limit number of results.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return itemsTable(table) A table containing wallet entries with Id, UserId, CreateTime, UpdateTime, Changeset, Metadata parameters.
// @return newCursor(string) Pagination cursor. Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) walletLedgerList(l *lua.LState) int {
	// Parse user ID.
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects a valid user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
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

	items, newCursor, _, err := ListWalletLedger(l.Context(), n.logger, n.db, uid, &limit, cursor)
	if err != nil {
		l.RaiseError("failed to retrieve user wallet ledger: %s", err.Error())
		return 0
	}

	itemsTable := l.CreateTable(len(items), 0)
	for i, item := range items {
		itemTable := l.CreateTable(0, 6)
		itemTable.RawSetString("id", lua.LString(item.ID))
		itemTable.RawSetString("user_id", lua.LString(userID))
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

// @group status
// @summary Follow a player's status changes on a given session.
// @param sessionID(type=string) A valid session identifier.
// @param userIDs(type=table) A list of userIDs to follow.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) statusFollow(l *lua.LState) int {
	sessionID := l.CheckString(1)

	suid, err := uuid.FromString(sessionID)
	if err != nil {
		l.ArgError(1, "expects a valid session id")
		return 0
	}

	userIDs := l.CheckTable(2)

	uidsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
	if !ok {
		l.ArgError(2, "invalid user ids list")
		return 0
	}

	uids := make(map[uuid.UUID]struct{}, len(uidsTable))
	for _, id := range uidsTable {
		ids, ok := id.(string)
		if !ok || ids == "" {
			l.ArgError(2, "each user id must be a string")
			return 0
		}
		uid, err := uuid.FromString(ids)
		if err != nil {
			l.ArgError(2, "each user id must be a valid id")
			return 0
		}
		uids[uid] = struct{}{}
	}

	n.statusRegistry.Follow(suid, uids)

	return 0
}

// @group status
// @summary Unfollow a player's status changes on a given session.
// @param sessionID(type=string) A valid session identifier.
// @param userIDs(type=table) A list of userIDs to unfollow.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) statusUnfollow(l *lua.LState) int {
	sessionID := l.CheckString(1)

	suid, err := uuid.FromString(sessionID)
	if err != nil {
		l.ArgError(1, "expects a valid session id")
		return 0
	}

	userIDs := l.CheckTable(2)

	uidsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
	if !ok {
		l.ArgError(2, "invalid user ids list")
		return 0
	}

	uids := make([]uuid.UUID, 0, len(uidsTable))
	for _, id := range uidsTable {
		ids, ok := id.(string)
		if !ok || ids == "" {
			l.ArgError(2, "each user id must be a string")
			return 0
		}
		uid, err := uuid.FromString(ids)
		if err != nil {
			l.ArgError(2, "each user id must be a valid id")
			return 0
		}
		uids = append(uids, uid)
	}

	n.statusRegistry.Unfollow(suid, uids)

	return 0
}

// @group storage
// @summary List records in a collection and page through results. The records returned can be filtered to those owned by the user or "" for public records.
// @param userID(type=string) User ID to list records for or "" (empty string) | void for public records.
// @param collection(type=string) Collection to list data from.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return objects(table) A list of storage objects.
// @return cursor(string) Pagination cursor.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) storageList(l *lua.LState) int {
	userID := l.OptString(1, "")
	collection := l.OptString(2, "")

	limit := l.CheckInt(3)
	if limit < 0 {
		l.ArgError(3, "limit must not be negative")
		return 0
	}

	cursor := l.OptString(4, "")

	var uid *uuid.UUID
	if userID != "" {
		parsedUserID, err := uuid.FromString(userID)
		if err != nil {
			l.ArgError(1, "expects empty or a valid user ID")
			return 0
		}
		uid = &parsedUserID
	}

	cid := uuid.Nil
	callerID := l.OptString(5, "")
	if callerID != "" {
		parsedCallerID, err := uuid.FromString(callerID)
		if err != nil {
			l.ArgError(5, "expects caller ID to be empty or a valid identifier")
			return 0
		}
		cid = parsedCallerID
	}

	objectList, _, err := StorageListObjects(l.Context(), n.logger, n.db, cid, uid, collection, limit, cursor)
	if err != nil {
		l.RaiseError("failed to list storage objects: %s", err.Error())
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
			l.RaiseError("failed to convert value to json: %s", err.Error())
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

// @group storage
// @summary Fetch one or more records by their bucket/collection/keyname and optional user.
// @param keys(type=table) A table of object identifiers to be fetched.
// @return objects(table) A list of storage objects matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) storageRead(l *lua.LState) int {
	keys := l.CheckTable(1)
	if keys == nil {
		l.ArgError(1, "expects a valid set of keys")
		return 0
	}

	size := keys.Len()
	if size == 0 {
		// Empty input, empty response.
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	objectIDs := make([]*api.ReadStorageObjectId, 0, size)
	conversionError := false
	keys.ForEach(func(k, v lua.LValue) {
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
		l.RaiseError("failed to read storage objects: %s", err.Error())
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
			l.RaiseError("failed to convert value to json: %s", err.Error())
			return 0
		}
		valueTable := RuntimeLuaConvertMap(l, valueMap)
		vt.RawSetString("value", valueTable)

		lv.RawSetInt(i+1, vt)
	}
	l.Push(lv)
	return 1
}

// @group storage
// @summary Write one or more objects by their collection/keyname and optional user.
// @param keys(type=table) A table of object identifiers to be written.
// @return acks(table) A list of acks with the version of the written objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) storageWrite(l *lua.LState) int {
	keys := l.CheckTable(1)
	if keys == nil {
		l.ArgError(1, "expects a valid set of data")
		return 0
	}

	size := keys.Len()
	if size == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	ops, err := tableToStorageWrites(l, keys)
	if err != nil {
		return 0
	}

	acks, _, err := StorageWriteObjects(l.Context(), n.logger, n.db, n.metrics, n.storageIndex, true, ops)
	if err != nil {
		l.RaiseError("failed to write storage objects: %s", err.Error())
		return 0
	}

	lv := l.CreateTable(len(acks.Acks), 0)
	for i, k := range acks.Acks {
		kt := l.CreateTable(0, 4)
		kt.RawSetString("key", lua.LString(k.Key))
		kt.RawSetString("collection", lua.LString(k.Collection))
		kt.RawSetString("user_id", lua.LString(k.UserId))
		kt.RawSetString("version", lua.LString(k.Version))

		lv.RawSetInt(i+1, kt)
	}
	l.Push(lv)
	return 1
}

func tableToStorageWrites(l *lua.LState, dataTable *lua.LTable) (StorageOpWrites, error) {
	size := dataTable.Len()
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

	return ops, nil
}

//nolint:unused
func storageOpWritesToTable(l *lua.LState, ops StorageOpWrites) (*lua.LTable, error) {
	lv := l.CreateTable(len(ops), 0)
	for i, v := range ops {
		vt := l.CreateTable(0, 7)
		vt.RawSetString("key", lua.LString(v.Object.Key))
		vt.RawSetString("collection", lua.LString(v.Object.Collection))
		if v.OwnerID != "" {
			vt.RawSetString("user_id", lua.LString(v.OwnerID))
		} else {
			vt.RawSetString("user_id", lua.LNil)
		}
		vt.RawSetString("version", lua.LString(v.Object.Version))
		vt.RawSetString("permission_read", lua.LNumber(v.Object.PermissionRead.GetValue()))
		vt.RawSetString("permission_write", lua.LNumber(v.Object.PermissionWrite.GetValue()))

		valueMap := make(map[string]interface{})
		err := json.Unmarshal([]byte(v.Object.Value), &valueMap)
		if err != nil {
			l.RaiseError("failed to convert value to json: %s", err.Error())
			return nil, err
		}
		valueTable := RuntimeLuaConvertMap(l, valueMap)
		vt.RawSetString("value", valueTable)

		lv.RawSetInt(i+1, vt)
	}

	return lv, nil
}

// @group storage
// @summary Remove one or more objects by their collection/keyname and optional user.
// @param keys(type=table) A list of object identifiers to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) storageDelete(l *lua.LState) int {
	keys := l.CheckTable(1)
	if keys == nil {
		l.ArgError(1, "expects a valid set of object IDs")
		return 0
	}

	size := keys.Len()
	if size == 0 {
		return 0
	}

	ops := make(StorageOpDeletes, 0, size)
	conversionError := false
	keys.ForEach(func(k, v lua.LValue) {
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

	if _, err := StorageDeleteObjects(l.Context(), n.logger, n.db, n.storageIndex, true, ops); err != nil {
		l.RaiseError("failed to remove storage: %s", err.Error())
	}

	return 0
}

// @group users
// @summary Update account, storage, and wallet information simultaneously.
// @param accountUpdates(type=table) List of account information to be updated.
// @param storageWrites(type=table) List of storage objects to be updated.
// @param storageDeletes(type=table) A list of storage objects to be deleted.
// @param walletUpdates(type=table) List of wallet updates to be made.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this wallet update in the ledger.
// @return storageWriteAcks(table) A list of acks with the version of the written objects.
// @return walletUpdateAcks(table) A list of wallet updates results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) multiUpdate(l *lua.LState) int {
	// Process account update inputs.
	var accountUpdatesArray []*accountUpdate
	accountUpdates := l.OptTable(1, nil)
	if accountUpdates != nil {
		size := accountUpdates.Len()
		accountUpdatesArray = make([]*accountUpdate, 0, size)
		conversionError := false
		accountUpdates.ForEach(func(k, v lua.LValue) {
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

			accountUpdatesArray = append(accountUpdatesArray, update)
		})
	}

	// Process storage update inputs.
	var storageWriteOps StorageOpWrites
	storageWrites := l.OptTable(2, nil)
	if storageWrites != nil {
		size := storageWrites.Len()
		storageWriteOps = make(StorageOpWrites, 0, size)
		conversionError := false
		storageWrites.ForEach(func(k, v lua.LValue) {
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

	// Process storage delete inputs.
	var storageDeleteOps StorageOpDeletes
	storageDeletes := l.OptTable(3, nil)
	if storageDeletes != nil {
		size := storageDeletes.Len()
		storageDeleteOps = make(StorageOpDeletes, 0, size)
		conversionError := false
		storageDeletes.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			dataTable, ok := v.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(3, "expects a valid set of storage data")
				return
			}

			var userID uuid.UUID
			d := &api.DeleteStorageObjectId{}
			dataTable.ForEach(func(k, v lua.LValue) {
				if conversionError {
					return
				}

				switch k.String() {
				case "collection":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(3, "expects collection to be string")
						return
					}
					d.Collection = v.String()
					if d.Collection == "" {
						conversionError = true
						l.ArgError(3, "expects collection to be a non-empty string")
						return
					}
				case "key":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(3, "expects key to be string")
						return
					}
					d.Key = v.String()
					if d.Key == "" {
						conversionError = true
						l.ArgError(3, "expects key to be a non-empty string")
						return
					}
				case "user_id":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(3, "expects user_id to be string")
						return
					}
					var err error
					if userID, err = uuid.FromString(v.String()); err != nil {
						conversionError = true
						l.ArgError(3, "expects user_id to be a valid ID")
						return
					}
				case "version":
					if v.Type() != lua.LTString {
						conversionError = true
						l.ArgError(3, "expects version to be string")
						return
					}
					d.Version = v.String()
					if d.Version == "" {
						conversionError = true
						l.ArgError(3, "expects version to be a non-empty string")
						return
					}
				}
			})

			if conversionError {
				return
			}

			if d.Collection == "" {
				conversionError = true
				l.ArgError(3, "expects collection to be supplied")
				return
			} else if d.Key == "" {
				conversionError = true
				l.ArgError(3, "expects key to be supplied")
				return
			}

			storageDeleteOps = append(storageDeleteOps, &StorageOpDelete{
				OwnerID:  userID.String(),
				ObjectID: d,
			})
		})
		if conversionError {
			return 0
		}
	}

	// Process wallet update inputs.
	var walletUpdatesArray []*walletUpdate
	walletUpdates := l.OptTable(4, nil)
	if walletUpdates != nil {
		size := walletUpdates.Len()
		walletUpdatesArray = make([]*walletUpdate, 0, size)
		conversionError := false
		walletUpdates.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			updateTable, ok := v.(*lua.LTable)
			if !ok {
				conversionError = true
				l.ArgError(4, "expects a valid set of updates")
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
						l.ArgError(4, "expects user_id to be string")
						return
					}
					uid, err := uuid.FromString(v.String())
					if err != nil {
						conversionError = true
						l.ArgError(4, "expects user_id to be a valid ID")
						return
					}
					update.UserID = uid
				case "changeset":
					if v.Type() != lua.LTTable {
						conversionError = true
						l.ArgError(4, "expects changeset to be table")
						return
					}
					changeset := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
					update.Changeset = make(map[string]int64, len(changeset))
					for ck, cv := range changeset {
						cvi, ok := cv.(int64)
						if !ok {
							conversionError = true
							l.ArgError(4, "expects changeset values to be whole numbers")
							return
						}
						update.Changeset[ck] = cvi
					}
				case "metadata":
					if v.Type() != lua.LTTable {
						conversionError = true
						l.ArgError(4, "expects metadata to be table")
						return
					}
					metadataMap := RuntimeLuaConvertLuaTable(v.(*lua.LTable))
					metadataBytes, err := json.Marshal(metadataMap)
					if err != nil {
						conversionError = true
						l.ArgError(4, fmt.Sprintf("failed to convert metadata: %s", err.Error()))
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
				l.ArgError(4, "expects changeset to be supplied")
				return
			}

			walletUpdatesArray = append(walletUpdatesArray, update)
		})
		if conversionError {
			return 0
		}
	}

	updateLedger := l.OptBool(5, false)

	acks, results, err := MultiUpdate(l.Context(), n.logger, n.db, n.metrics, accountUpdatesArray, storageWriteOps, storageDeleteOps, n.storageIndex, walletUpdatesArray, updateLedger)
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

// @group leaderboards
// @summary Set up a new dynamic leaderboard with the specified ID and various configuration settings. The leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param leaderboardID(type=string) The unique identifier for the new leaderboard. This is used by clients to submit scores.
// @param authoritative(type=bool, default=false) Mark the leaderboard as authoritative which ensures updates can only be made via the Go runtime. No client can submit a score directly.
// @param sortOrder(type=string, optional=true, default="desc") The sort order for records in the leaderboard. Possible values are "asc" or "desc".
// @param operator(type=string, optional=true, default="best") The operator that determines how scores behave when submitted; possible values are "best", "set", or "incr".
// @param resetSchedule(type=string, optional=true) The cron format used to define the reset schedule for the leaderboard. This controls when a leaderboard is reset and can be used to power daily/weekly/monthly leaderboards.
// @param metadata(type=table, optional=true) The metadata you want associated to the leaderboard. Some good examples are weather conditions for a racing game.
// @param enableRanks(type=bool, optional=true, default=false) Whether to enable rank values for the leaderboard.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardCreate(l *lua.LState) int {
	leaderboardID := l.CheckString(1)
	if leaderboardID == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	authoritative := l.OptBool(2, false)

	sortOrder := l.OptString(3, "desc")
	var sortOrderNumber int
	switch sortOrder {
	case "asc", "ascending":
		sortOrderNumber = LeaderboardSortOrderAscending
	case "desc", "descending":
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
	case "incr", "increment":
		operatorNumber = LeaderboardOperatorIncrement
	case "decr", "decrement":
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

	enableRanks := l.OptBool(7, false)

	_, created, err := n.leaderboardCache.Create(l.Context(), leaderboardID, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadataStr, enableRanks)
	if err != nil {
		l.RaiseError("error creating leaderboard: %v", err.Error())
	}

	if created {
		// Only need to update the scheduler for newly created leaderboards.
		n.leaderboardScheduler.Update()
	}

	return 0
}

// @group leaderboards
// @summary Delete a leaderboard and all scores that belong to it.
// @param id(type=string) The unique identifier for the leaderboard to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardDelete(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	_, err := n.leaderboardCache.Delete(l.Context(), n.rankCache, n.leaderboardScheduler, id)
	if err != nil {
		l.RaiseError("error deleting leaderboard: %v", err.Error())
	}

	return 0
}

// @group leaderboards
// @summary Find leaderboards which have been created on the server. Leaderboards can be filtered with categories.
// @param limit(type=number, optional=true, default=10) Return only the required number of leaderboards denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return leaderboardList(table) A list of leaderboard results and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardList(l *lua.LState) int {
	limit := l.OptInt(1, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(1, "limit must be 1-100")
		return 0
	}

	var listCursor *LeaderboardListCursor
	cursor := l.OptString(2, "")
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			l.ArgError(2, "expects cursor to be valid when provided")
			return 0
		}
		listCursor = &LeaderboardListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(listCursor); err != nil {
			l.ArgError(2, "expects cursor to be valid when provided")
			return 0
		}
	}

	list, err := LeaderboardList(n.logger, n.leaderboardCache, limit, listCursor)
	if err != nil {
		l.RaiseError("error listing leaderboards: %v", err.Error())
		return 0
	}

	leaderboards := l.CreateTable(len(list.Leaderboards), 0)
	for i, t := range list.Leaderboards {
		tt, err := leaderboardToLuaTable(l, t)
		if err != nil {
			l.RaiseError("error converting leaderboards: %s", err.Error())
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

// @group leaderboards
// @summary Disable a leaderboard rank cache freeing its allocated resources. If already disabled is a NOOP.
// @param id(type=string) The leaderboard id.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardRanksDisable(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard id string")
		return 0
	}

	if err := disableLeaderboardRanks(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id); err != nil {
		l.RaiseError("error disabling leaderboard ranks: %s", err.Error())
	}

	return 0
}

// @group leaderboards
// @summary List records on the specified leaderboard, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured leaderboard sort order.
// @param id(type=string) The unique identifier for the leaderboard to list. Mandatory field.
// @param ownerIDs(type=table) List of owners to filter to.
// @param limit(type=number, optional=true) The maximum number of records to return (Max 10,000).
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiryOverride(type=number, optional=true, default=0) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0. If 0, currently active records will be returned.
// @return records(table) A page of leaderboard records.
// @return ownerRecords(table) A list of owner leaderboard records (empty if the owners input parameter is not set).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardRecordsList(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	var ownerIdsArray []string
	ownerIDs := l.OptTable(2, nil)
	if ownerIDs != nil {
		size := ownerIDs.Len()
		if size == 0 {
			l.Push(l.CreateTable(0, 0))
			return 1
		}

		ownerIdsArray = make([]string, 0, size)
		conversionError := false
		ownerIDs.ForEach(func(k, v lua.LValue) {
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
			ownerIdsArray = append(ownerIdsArray, s)
		})
		if conversionError {
			return 0
		}
	}

	limit := l.OptInt(3, 0)
	if limit < 0 || limit > 10000 {
		l.ArgError(3, "expects limit to be 0-10000")
		return 0
	}
	var limitValue *wrapperspb.Int32Value
	if limit != 0 {
		limitValue = &wrapperspb.Int32Value{Value: int32(limit)}
	}

	cursor := l.OptString(4, "")
	expiryOverride := l.OptInt64(5, 0)

	records, err := LeaderboardRecordsList(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, limitValue, cursor, ownerIdsArray, expiryOverride)
	if err != nil {
		l.RaiseError("error listing leaderboard records: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount, false)
}

// @group leaderboards
// @summary Build a cursor to be used with leaderboardRecordsList to fetch records starting at a given rank. Only available if rank cache is not disabled for the leaderboard.
// @param leaderboardID(type=string) The unique identifier of the leaderboard.
// @param rank(type=number) The rank to start listing leaderboard records from.
// @param expiryOverride(type=number, optional=true, default=0) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0. If 0, currently active records will be returned.
// @return leaderboardListCursor(string) A string cursor to be used with leaderboardRecordsList.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardRecordsListCursorFromRank(l *lua.LState) int {
	leaderboardID := l.CheckString(1)
	if leaderboardID == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	rank := l.CheckInt64(2)
	if rank < 1 {
		l.ArgError(2, "invalid rank - must be > 1")
		return 0
	}

	expiryOverride := l.OptInt64(3, 0)

	leaderboard := n.leaderboardCache.Get(leaderboardID)
	if leaderboard == nil {
		l.RaiseError("error listing leaderboard records: %s", ErrLeaderboardNotFound.Error())
		return 0
	}

	expiryTime, ok := calculateExpiryOverride(expiryOverride, leaderboard)
	if !ok {
		l.RaiseError("invalid expiry")
		return 0
	}

	rank--

	if rank == 0 {
		l.Push(lua.LString(""))
		return 1
	}

	ownerId, score, subscore, err := n.rankCache.GetDataByRank(leaderboardID, expiryTime, leaderboard.SortOrder, rank)
	if err != nil {
		l.RaiseError("failed to get cursor from rank: %s", err.Error())
		return 0
	}

	cursor := &leaderboardRecordListCursor{
		IsNext:        true,
		LeaderboardId: leaderboardID,
		ExpiryTime:    expiryTime,
		Score:         score,
		Subscore:      subscore,
		OwnerId:       ownerId.String(),
		Rank:          rank,
	}

	cursorStr, err := marshalLeaderboardRecordsListCursor(cursor)
	if err != nil {
		l.RaiseError("failed to marshal leaderboard cursor: %s", err.Error())
		return 0
	}

	l.Push(lua.LString(cursorStr))
	return 1
}

// @group leaderboards
// @summary Use the preconfigured operator for the given leaderboard to submit a score for a particular user.
// @param id(type=string) The unique identifier for the leaderboard to submit to.
// @param ownerID(type=string) The owner of this score submission.
// @param username(type=string, optional=true) The owner username of this score submission, if it's a user.
// @param score(type=number, optional=true, default=0) The score to submit.
// @param subscore(type=number, optional=true, default=0) A secondary subscore parameter for the submission.
// @param metadata(type=table, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param overrideOperatorString(type=number, optional=true) An override operator for the new record. The accepted values include: 0 (no override), 1 (best), 2 (set), 3 (incr), 4 (decr).
// @return record(table) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
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
	overrideOperatorString := l.OptString(7, "")
	if overrideOperatorString != "" {
		switch overrideOperatorString {
		case "best":
			overrideOperator = api.Operator_BEST
		case "set":
			overrideOperator = api.Operator_SET
		case "incr", "increment":
			overrideOperator = api.Operator_INCREMENT
		case "decr", "decrement":
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
		l.RaiseError("error converting leaderboard records: %s", err.Error())
		return 0
	}

	l.Push(recordTable)
	return 1
}

// @group leaderboards
// @summary Fetch the list of leaderboard records around the owner.
// @param id(type=string) The ID of the leaderboard to list records for.
// @param ownerID(type=string) The owner ID around which to show records.
// @param limit(type=number, optional=true, default=10) Return only the required number of leaderboard records denoted by this limit value. Between 1-100.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiry(type=number, optional=true, default=0) Time since epoch in seconds. Must be greater than 0.
// @return records(table) A list of leaderboard records.
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardRecordsHaystack(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a leaderboard ID string")
		return 0
	}

	ownerID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(3, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(3, "limit must be 1-100")
		return 0
	}

	cursor := l.OptString(4, "")

	expiry := l.OptInt(5, 0)
	if expiry < 0 {
		l.ArgError(5, "expiry should be time since epoch in seconds and has to be a positive integer")
		return 0
	}

	records, err := LeaderboardRecordsHaystack(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, cursor, ownerID, limit, int64(expiry))
	if err != nil {
		l.RaiseError("error listing leaderboard records haystack: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount, true)
}

// @group leaderboards
// @summary Remove an owner's record from a leaderboard, if one exists.
// @param id(type=string) The unique identifier for the leaderboard to delete from.
// @param ownerID(type=string) The owner of the score to delete.
// @return error(error) An optional error value if an error occurred.
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

// @group leaderboards
// @summary Fetch one or more leaderboards by ID.
// @param IDs(type=table) The table array of leaderboard ids.
// @return leaderboards(table) The leaderboard records according to ID.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) leaderboardsGetId(l *lua.LState) int {
	// Input table validation.
	IDs := l.OptTable(1, nil)
	if IDs == nil {
		l.ArgError(1, "invalid tournament id list")
		return 0
	}
	if IDs.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	leaderboardIDs, ok := RuntimeLuaConvertLuaValue(IDs).([]interface{})
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
			l.RaiseError("error converting leaderboards: %s", err.Error())
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

// @group purchases
// @summary Validates and stores the purchases present in an Apple App Store Receipt.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param passwordOverride(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(table) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) purchaseValidateApple(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if receipt == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	persist := l.OptBool(3, true)

	passwordOverride := l.OptString(4, n.config.GetIAP().Apple.SharedPassword)
	if passwordOverride == "" {
		l.RaiseError("Apple IAP is not configured.")
		return 0
	}

	validation, err := ValidatePurchasesApple(l.Context(), n.logger, n.db, uid, passwordOverride, receipt, persist)
	if err != nil {
		l.RaiseError("error validating Apple receipt: %v", err.Error())
		return 0
	}

	l.Push(purchaseValidationToLuaTable(l, validation))
	return 1
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Google Play Store.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param clientEmailOverride(type=string, optional=true) Override the iap.google.client_email provided in your configuration.
// @param privateKeyOverride(type=string, optional=true) Override the iap.google.private_key provided in your configuration.
// @return validation(table) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) purchaseValidateGoogle(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if receipt == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	persist := l.OptBool(3, true)

	clientEmailOverride := l.OptString(4, n.config.GetIAP().Google.ClientEmail)
	privateKeyOverride := l.OptString(5, n.config.GetIAP().Google.PrivateKey)

	if clientEmailOverride == "" || privateKeyOverride == "" {
		l.RaiseError("Google IAP is not configured.")
		return 0
	}

	configOverride := &IAPGoogleConfig{
		ClientEmail: clientEmailOverride,
		PrivateKey:  privateKeyOverride,
	}

	validation, err := ValidatePurchaseGoogle(l.Context(), n.logger, n.db, uid, configOverride, receipt, persist)

	if err != nil {
		l.RaiseError("error validating Google receipt: %v", err.Error())
		return 0
	}

	l.Push(purchaseValidationToLuaTable(l, validation))
	return 1
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Huawei App Gallery.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param signature(type=string) The receipt signature.
// @param receipt(type=string) The Huawei receipt data.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(table) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) purchaseValidateHuawei(l *lua.LState) int {
	if n.config.GetIAP().Huawei.ClientID == "" ||
		n.config.GetIAP().Huawei.ClientSecret == "" ||
		n.config.GetIAP().Huawei.PublicKey == "" {
		l.RaiseError("Huawei IAP is not configured.")
		return 0
	}

	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	signature := l.CheckString(2)
	if signature == "" {
		l.ArgError(2, "expects signature")
		return 0
	}

	receipt := l.CheckString(3)
	if receipt == "" {
		l.ArgError(3, "expects receipt")
		return 0
	}

	persist := l.OptBool(4, true)

	validation, err := ValidatePurchaseHuawei(l.Context(), n.logger, n.db, uid, n.config.GetIAP().Huawei, signature, receipt, persist)
	if err != nil {
		l.RaiseError("error validating Huawei receipt: %v", err.Error())
		return 0
	}

	l.Push(purchaseValidationToLuaTable(l, validation))
	return 1
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Facebook Instant Games.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param signedRequest(type=string) The Facebook Instant signedRequest receipt data.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(table) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) purchaseValidateFacebookInstant(l *lua.LState) int {
	if n.config.GetIAP().FacebookInstant.AppSecret == "" {
		l.RaiseError("Facebook Instant IAP is not configured.")
		return 0
	}

	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	signedRequest := l.CheckString(2)
	if signedRequest == "" {
		l.ArgError(2, "expects signedRequest")
		return 0
	}

	persist := l.OptBool(3, true)

	validation, err := ValidatePurchaseFacebookInstant(l.Context(), n.logger, n.db, uid, n.config.GetIAP().FacebookInstant, signedRequest, persist)
	if err != nil {
		l.RaiseError("error validating Facebook Instant receipt: %v", err.Error())
		return 0
	}

	l.Push(purchaseValidationToLuaTable(l, validation))
	return 1
}

// @group purchases
// @summary Look up a purchase receipt by transaction ID.
// @param transactionID(type=string) Transaction ID of the purchase to look up.
// @return purchase(table) A validated purchase and its owner.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) purchaseGetByTransactionId(l *lua.LState) int {
	transactionID := l.CheckString(1)
	if transactionID == "" {
		l.ArgError(1, "expects a transaction ID string")
		return 0
	}

	purchase, err := GetPurchaseByTransactionId(l.Context(), n.logger, n.db, transactionID)
	if err != nil {
		l.RaiseError("error retrieving purchase: %v", err.Error())
		return 0
	}

	l.Push(purchaseToLuaTable(l, purchase))
	return 1
}

// @group purchases
// @summary List stored validated purchase receipts.
// @param userID(type=string, optional=true) Filter by user ID. Can be an empty string to list purchases for all users.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listPurchases(table) A page of stored validated purchases and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
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

	if purchases.PrevCursor != "" {
		l.Push(lua.LString(purchases.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 3
}

// @group subscriptions
// @summary Validates and stores the subscription present in an Apple App Store Receipt.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the subscription operation itself.
// @param persist(type=bool, optional=true, default=true) Persist the subscription.
// @param passwordOverride(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(table) The resulting successfully validated subscriptions.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) subscriptionValidateApple(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if receipt == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	persist := l.OptBool(3, true)

	passwordOverride := l.OptString(4, n.config.GetIAP().Apple.SharedPassword)
	if passwordOverride == "" {
		l.RaiseError("Apple IAP is not configured.")
		return 0
	}

	validation, err := ValidateSubscriptionApple(l.Context(), n.logger, n.db, uid, passwordOverride, receipt, persist)
	if err != nil {
		l.RaiseError("error validating Apple receipt: %v", err.Error())
		return 0
	}

	l.Push(subscriptionValidationToLuaTable(l, validation))
	return 1
}

// @group subscriptions
// @summary Validates and stores a subscription receipt from the Google Play Store.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool, optional=true, default=true) Persist the subscription.
// @param clientEmailOverride(type=string, optional=true) Override the iap.google.client_email provided in your configuration.
// @param privateKeyOverride(type=string, optional=true) Override the iap.google.private_key provided in your configuration.
// @return validation(table) The resulting successfully validated subscriptions.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) subscriptionValidateGoogle(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	receipt := l.CheckString(2)
	if receipt == "" {
		l.ArgError(2, "expects receipt")
		return 0
	}

	persist := l.OptBool(3, true)

	clientEmailOverride := l.OptString(4, n.config.GetIAP().Google.ClientEmail)
	privateKeyOverride := l.OptString(5, n.config.GetIAP().Google.PrivateKey)

	if clientEmailOverride == "" || privateKeyOverride == "" {
		l.RaiseError("Google IAP is not configured.")
		return 0
	}

	configOverride := &IAPGoogleConfig{
		ClientEmail: clientEmailOverride,
		PrivateKey:  privateKeyOverride,
	}

	validation, err := ValidateSubscriptionGoogle(l.Context(), n.logger, n.db, uid, configOverride, receipt, persist)

	if err != nil {
		l.RaiseError("error validating Google receipt: %v", err.Error())
		return 0
	}

	l.Push(subscriptionValidationToLuaTable(l, validation))
	return 1
}

// @group subscriptions
// @summary Look up a subscription by product ID.
// @param userID(type=string) The user ID of the subscription owner.
// @param productID(type=string) Transaction ID of the purchase to look up.
// @return purchase(table) A validated purchase and its owner.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) subscriptionGetByProductId(l *lua.LState) int {
	userID := l.CheckString(1)
	if userID == "" {
		l.ArgError(1, "expects user id")
		return 0
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(1, "invalid user id")
		return 0
	}

	productID := l.CheckString(2)
	if productID == "" {
		l.ArgError(2, "expects a product ID string")
		return 0
	}

	subscription, err := GetSubscriptionByProductId(l.Context(), n.logger, n.db, uid.String(), productID)
	if err != nil {
		l.RaiseError("error retrieving subscription: %v", err.Error())
		return 0
	}

	l.Push(subscriptionToLuaTable(l, subscription))
	return 1
}

// @group subscriptions
// @summary List stored validated subscription receipts.
// @param userID(type=string, optional=true) Filter by user ID. Can be an empty string to list subscriptions for all users.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listPurchases(table) A page of stored validated subscriptions and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) subscriptionsList(l *lua.LState) int {
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

	subscriptions, err := ListSubscriptions(l.Context(), n.logger, n.db, userID, limit, cursor)
	if err != nil {
		l.RaiseError("error retrieving subscriptions: %v", err.Error())
		return 0
	}

	purchasesTable := l.CreateTable(len(subscriptions.ValidatedSubscriptions), 0)
	for i, s := range subscriptions.ValidatedSubscriptions {
		purchasesTable.RawSetInt(i+1, subscriptionToLuaTable(l, s))
	}

	l.Push(purchasesTable)

	if subscriptions.Cursor != "" {
		l.Push(lua.LString(subscriptions.Cursor))
	} else {
		l.Push(lua.LNil)
	}

	if subscriptions.PrevCursor != "" {
		l.Push(lua.LString(subscriptions.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 3
}

// @group tournaments
// @summary Set up a new dynamic tournament with the specified ID and various configuration settings. The underlying leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param id(type=string) The unique identifier for the new tournament. This is used by clients to submit scores.
// @param authoritative(type=bool, optional=true, default=true) Whether the tournament created is server authoritative.
// @param sortOrder(type=string, optional=true, default="desc") The sort order for records in the tournament. Possible values are "asc" or "desc".
// @param operator(type=string, optional=true, default="best") The operator that determines how scores behave when submitted. The possible values are "best", "set", or "incr".
// @param resetSchedule(type=string, optional=true) The cron format used to define the reset schedule for the tournament. This controls when the underlying leaderboard resets and the tournament is considered active again.
// @param metadata(type=table, optional=true) The metadata you want associated to the tournament. Some good examples are weather conditions for a racing game.
// @param title(type=string, optional=true) The title of the tournament.
// @param description(type=string, optional=true) The description of the tournament.
// @param category(type=number, optional=true) A category associated with the tournament. This can be used to filter different types of tournaments. Between 0 and 127.
// @param startTime(type=number, optional=true) The start time of the tournament. Leave empty for immediately or a future time.
// @param endTime(type=number, optional=true, default=never) The end time of the tournament. When the end time is elapsed, the tournament will not reset and will cease to exist. Must be greater than startTime if set.
// @param duration(type=number) The active duration for a tournament. This is the duration when clients are able to submit new records. The duration starts from either the reset period or tournament start time whichever is sooner. A game client can query the tournament for results between end of duration and next reset period.
// @param maxSize(type=number, optional=true) Maximum size of participants in a tournament.
// @param maxNumScore(type=number, optional=true, default=1000000) Maximum submission attempts for a tournament record.
// @param joinRequired(type=bool, optional=true, default=false) Whether the tournament needs to be joined before a record write is allowed.
// @param enableRanks(type=bool, optional=true, default=false) Whether to enable rank values for the tournament.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentCreate(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	authoritative := l.OptBool(2, true)

	sortOrder := l.OptString(3, "desc")
	var sortOrderNumber int
	switch sortOrder {
	case "asc", "ascending":
		sortOrderNumber = LeaderboardSortOrderAscending
	case "desc", "descending":
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
	case "incr", "increment":
		operatorNumber = LeaderboardOperatorIncrement
	case "decr", "decrement":
		operatorNumber = LeaderboardOperatorDecrement
	default:
		l.ArgError(4, "expects operator to be 'best', 'set', 'decr' or 'incr'")
		return 0
	}

	duration := l.OptInt(5, 0)
	if duration <= 0 {
		l.ArgError(5, "duration must be > 0")
		return 0
	}

	resetSchedule := l.OptString(6, "")
	if resetSchedule != "" {
		if _, err := cronexpr.Parse(resetSchedule); err != nil {
			l.ArgError(6, "expects reset schedule to be a valid CRON expression")
			return 0
		}
	}

	metadata := l.OptTable(7, nil)
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

	title := l.OptString(8, "")
	description := l.OptString(9, "")
	category := l.OptInt(10, 0)
	if category < 0 || category >= 128 {
		l.ArgError(10, "category must be 0-127")
		return 0
	}
	startTime := l.OptInt(11, 0)
	if startTime < 0 {
		l.ArgError(11, "startTime must be >= 0.")
		return 0
	}
	endTime := l.OptInt(12, 0)
	if endTime != 0 && endTime <= startTime {
		l.ArgError(12, "endTime must be > startTime. Use 0 to indicate a tournament that never ends.")
		return 0
	}
	maxSize := l.OptInt(13, 0)
	if maxSize < 0 {
		l.ArgError(13, "maxSize must be >= 0")
		return 0
	}
	maxNumScore := l.OptInt(14, 0)
	if maxNumScore < 0 {
		l.ArgError(14, "maxNumScore must be >= 0")
		return 0
	}
	joinRequired := l.OptBool(15, false)
	enableRanks := l.OptBool(16, false)

	if err := TournamentCreate(l.Context(), n.logger, n.leaderboardCache, n.leaderboardScheduler, id, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired, enableRanks); err != nil {
		l.RaiseError("error creating tournament: %v", err.Error())
	}
	return 0
}

// @group tournaments
// @summary Delete a tournament and all records that belong to it.
// @param id(type=string) The unique identifier for the tournament to delete.
// @return error(error) An optional error value if an error occurred.
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

// @group tournaments
// @summary Add additional score attempts to the owner's tournament record. This overrides the max number of score attempts allowed in the tournament for this specific owner.
// @param id(type=string) The unique identifier for the tournament to update.
// @param ownerID(type=string) The owner of the records to increment the count for.
// @param count(type=number) The number of attempt counts to increment. Can be negative to decrease count.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentAddAttempt(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	ownerID := l.CheckString(2)
	if ownerID == "" {
		l.ArgError(2, "expects an owner ID string")
		return 0
	} else if _, err := uuid.FromString(ownerID); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	count := l.CheckInt(3)
	if count == 0 {
		l.ArgError(3, "expects an attempt count number != 0")
		return 0
	}

	if err := TournamentAddAttempt(l.Context(), n.logger, n.db, n.leaderboardCache, id, ownerID, count); err != nil {
		l.RaiseError("error adding tournament attempts: %v", err.Error())
	}
	return 0
}

// @group tournaments
// @summary A tournament may need to be joined before the owner can submit scores. This operation is idempotent and will always succeed for the owner even if they have already joined the tournament.
// @param id(type=string) The unique identifier for the tournament to join.
// @param userID(type=string) The owner of the record.
// @param username(type=string) The username of the record owner.
// @return error(error) An optional error value if an error occurred.
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
	}
	uid, err := uuid.FromString(userID)
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(3)
	if username == "" {
		l.ArgError(3, "expects a username string")
		return 0
	}

	if err := TournamentJoin(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uid, username, id); err != nil {
		l.RaiseError("error joining tournament: %v", err.Error())
	}
	return 0
}

// @group tournaments
// @summary Fetch one or more tournaments by ID.
// @param tournamentIDs(type=table) The table of tournament ids.
// @return result(table) List of tournament records.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentsGetId(l *lua.LState) int {
	// Input table validation.
	tournamentIDs := l.OptTable(1, nil)
	if tournamentIDs == nil {
		l.ArgError(1, "invalid tournament id list")
		return 0
	}
	if tournamentIDs.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	tournamentIDsArray, ok := RuntimeLuaConvertLuaValue(tournamentIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid tournament id data")
		return 0
	}
	if len(tournamentIDsArray) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	tournamentIDStrings := make([]string, 0, len(tournamentIDsArray))
	for _, id := range tournamentIDsArray {
		if ids, ok := id.(string); !ok || ids == "" {
			l.ArgError(1, "each tournament id must be a string")
			return 0
		} else {
			tournamentIDStrings = append(tournamentIDStrings, ids)
		}
	}

	// Get the tournaments.
	list, err := TournamentsGet(l.Context(), n.logger, n.db, n.leaderboardCache, tournamentIDStrings)
	if err != nil {
		l.RaiseError("failed to get tournaments: %s", err.Error())
		return 0
	}

	tournaments := l.CreateTable(len(list), 0)
	for i, t := range list {
		tt, err := tournamentToLuaTable(l, t)
		if err != nil {
			l.RaiseError("error converting tournaments: %s", err.Error())
			return 0
		}

		tournaments.RawSetInt(i+1, tt)
	}
	l.Push(tournaments)

	return 1
}

func tournamentToLuaTable(l *lua.LState, tournament *api.Tournament) (*lua.LTable, error) {
	tt := l.CreateTable(0, 19)

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
	tt.RawSetString("join_required", lua.LBool(tournament.JoinRequired))

	return tt, err
}

// @group tournaments
// @summary List records on the specified tournament, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured tournament sort order.
// @param tournamentID(type=string) The ID of the tournament to list records for.
// @param ownerIDs(type=table, optional=true) List of owner IDs to filter results by.
// @param limitNumber(type=number) Return only the required number of tournament records denoted by this limit value. Max is 10000.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiryOverride(type=number, optional=true, default=0) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0. If 0, currently active records will be returned.
// @return records(table) A page of tournament records.
// @return ownerRecords(table) A list of owner tournament records (empty if the owners input parameter is not set).
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentRecordsList(l *lua.LState) int {
	tournamentID := l.CheckString(1)
	if tournamentID == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	var ownerIDsArray []string
	ownerIDs := l.OptTable(2, nil)
	if ownerIDs != nil {
		size := ownerIDs.Len()
		if size == 0 {
			l.Push(l.CreateTable(0, 0))
			return 1
		}

		ownerIDsArray = make([]string, 0, size)
		conversionError := false
		ownerIDs.ForEach(func(k, v lua.LValue) {
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
			ownerIDsArray = append(ownerIDsArray, s)
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
	expiryOverride := l.OptInt64(5, 0)

	records, err := TournamentRecordsList(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, tournamentID, ownerIDsArray, limit, cursor, expiryOverride)
	if err != nil {
		l.RaiseError("error listing tournament records: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount, false)
}

func leaderboardRecordsToLua(l *lua.LState, records, ownerRecords []*api.LeaderboardRecord, prevCursor, nextCursor string, rankCount int64, skipOwnerRecords bool) int {
	recordsTable := l.CreateTable(len(records), 0)
	for i, record := range records {
		recordTable, err := recordToLuaTable(l, record)
		if err != nil {
			l.RaiseError("error converting leaderboard records: %s", err.Error())
			return 0
		}

		recordsTable.RawSetInt(i+1, recordTable)
	}

	l.Push(recordsTable)

	if !skipOwnerRecords {
		ownerRecordsTable := l.CreateTable(len(ownerRecords), 0)
		for i, record := range ownerRecords {
			recordTable, err := recordToLuaTable(l, record)
			if err != nil {
				l.RaiseError("error converting leaderboard records: %s", err.Error())
				return 0
			}

			ownerRecordsTable.RawSetInt(i+1, recordTable)
		}

		l.Push(ownerRecordsTable)
	}

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

	l.Push(lua.LNumber(rankCount))

	if skipOwnerRecords {
		return 4
	}
	return 5
}

func recordToLuaTable(l *lua.LState, record *api.LeaderboardRecord) (*lua.LTable, error) {
	recordTable := l.CreateTable(0, 12)
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
	recordTable.RawSetString("max_num_score", lua.LNumber(record.MaxNumScore))

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

// @group tournaments
// @summary Find tournaments which have been created on the server. Tournaments can be filtered with categories and via start and end times.
// @param categoryStart(type=number) Filter tournament with categories greater or equal than this value.
// @param categoryEnd(type=number) Filter tournament with categories equal or less than this value.
// @param startTime(type=number, optional=true) Filter tournament with that start after this time.
// @param endTime(type=number, optional=true) Filter tournament with that end before this time.
// @param limit(type=number, optional=true, default=10) Return only the required number of tournament denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return tournamentList(table) A list of tournament results and possibly a cursor and possibly a cursor. If cursor is empty/nil there are no further results.
// @return error(error) An optional error value if an error occurred.
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

	startTime := l.OptNumber(3, -1)
	startTimeInt := int(lua.LVAsNumber(startTime))
	if startTimeInt < 0 {
		l.ArgError(3, "startTime must be >= -1")
		return 0
	}
	endTime := l.OptNumber(4, -1)
	endTimeInt := int(lua.LVAsNumber(endTime))
	if endTimeInt < 0 {
		l.ArgError(4, "endTime must be >= -1")
		return 0
	}
	if startTimeInt > endTimeInt {
		l.ArgError(4, "endTime must be >= startTime")
		return 0
	}

	limit := l.OptInt(5, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(5, "limit must be 1-100")
		return 0
	}

	var listCursor *TournamentListCursor
	cursor := l.OptString(6, "")
	if cursor != "" {
		cb, err := base64.URLEncoding.DecodeString(cursor)
		if err != nil {
			l.ArgError(6, "expects cursor to be valid when provided")
			return 0
		}
		listCursor = &TournamentListCursor{}
		if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(listCursor); err != nil {
			l.ArgError(6, "expects cursor to be valid when provided")
			return 0
		}
	}

	list, err := TournamentList(l.Context(), n.logger, n.db, n.leaderboardCache, categoryStart, categoryEnd, startTimeInt, endTimeInt, limit, listCursor)
	if err != nil {
		l.RaiseError("error listing tournaments: %v", err.Error())
		return 0
	}

	tournaments := l.CreateTable(len(list.Tournaments), 0)
	for i, t := range list.Tournaments {
		tt, err := tournamentToLuaTable(l, t)
		if err != nil {
			l.RaiseError("error converting tournaments: %s", err.Error())
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

// @group tournaments
// @summary Disable a tournament rank cache freeing its allocated resources. If already disabled is a NOOP.
// @param id(type=string) The tournament id.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentRanksDisable(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament id string")
		return 0
	}

	if err := disableLeaderboardRanks(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id); err != nil {
		l.RaiseError("error disabling tournament ranks: %s", err.Error())
	}

	return 0
}

// @group tournaments
// @summary Submit a score and optional subscore to a tournament leaderboard. If the tournament has been configured with join required this will fail unless the owner has already joined the tournament.
// @param id(type=string) The unique identifier for the tournament leaderboard to submit to.
// @param ownerID(type=string) The owner of this score submission.
// @param username(type=string, optional=true) The owner username of this score submission, if it's a user.
// @param score(type=number, optional=true, default=0) The score to submit.
// @param subscore(type=number, optional=true, default=0) A secondary subscore parameter for the submission.
// @param metadata(type=table, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param overrideOperatorString(type=number, optional=true) An override operator for the new record. The accepted values include: 0 (no override), 1 (best), 2 (set), 3 (incr), 4 (decr).
// @return result(table) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentRecordWrite(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	ownerID, err := uuid.FromString(l.CheckString(2))
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
	var overrideOperator int32
	var ok bool
	if overrideOperator, ok = api.Operator_value[strings.ToUpper(overrideOperatorString)]; !ok {
		l.ArgError(7, ErrInvalidOperator.Error())
		return 0
	}

	record, err := TournamentRecordWrite(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr, api.Operator(overrideOperator))
	if err != nil {
		l.RaiseError("error writing tournament record: %v", err.Error())
		return 0
	}

	recordTable, err := recordToLuaTable(l, record)
	if err != nil {
		l.RaiseError("error converting tournament records: %s", err.Error())
		return 0
	}

	l.Push(recordTable)
	return 1
}

// @group tournaments
// @summary Remove an owner's record from a tournament, if one exists.
// @param id(type=string) The unique identifier for the tournament to delete from.
// @param ownerID(type=string) The owner of the score to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentRecordDelete(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	ownerID := l.CheckString(2)
	if _, err := uuid.FromString(ownerID); err != nil {
		l.ArgError(2, "expects owner ID to be a valid identifier")
		return 0
	}

	if err := TournamentRecordDelete(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID); err != nil {
		l.RaiseError("error deleting tournament record: %v", err.Error())
	}
	return 0
}

// @group tournaments
// @summary Fetch the list of tournament records around the owner.
// @param id(type=string) The ID of the tournament to list records for.
// @param ownerID(type=string) The owner ID around which to show records.
// @param limit(type=number, optional=true, default=10) Return only the required number of tournament records denoted by this limit value. Between 1-100.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiry(type=number, optional=true, default=0) Time since epoch in seconds. Must be greater than 0.
// @return records(table) A page of tournament records.
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) tournamentRecordsHaystack(l *lua.LState) int {
	id := l.CheckString(1)
	if id == "" {
		l.ArgError(1, "expects a tournament ID string")
		return 0
	}

	ownerID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(3, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(3, "limit must be 1-100")
		return 0
	}

	cursor := l.OptString(4, "")

	expiry := l.OptInt(5, 0)
	if expiry < 0 {
		l.ArgError(5, "expiry should be time since epoch in seconds and has to be a positive integer")
		return 0
	}

	records, err := TournamentRecordsHaystack(l.Context(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, cursor, ownerID, limit, int64(expiry))
	if err != nil {
		l.RaiseError("error listing tournament records haystack: %v", err.Error())
		return 0
	}

	return leaderboardRecordsToLua(l, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount, true)
}

// @group groups
// @summary Fetch one or more groups by their ID.
// @param groupIDs(type=table) A list of strings of the IDs for the groups to get.
// @return getGroups(table) A table of groups with their fields.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupsGetId(l *lua.LState) int {
	// Input table validation.
	groupIDs := l.OptTable(1, nil)
	if groupIDs == nil {
		l.ArgError(1, "invalid group id list")
		return 0
	}
	if groupIDs.Len() == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}
	groupIDsArray, ok := RuntimeLuaConvertLuaValue(groupIDs).([]interface{})
	if !ok {
		l.ArgError(1, "invalid group id data")
		return 0
	}
	if len(groupIDsArray) == 0 {
		l.Push(l.CreateTable(0, 0))
		return 1
	}

	// Input individual ID validation.
	groupIDStrings := make([]string, 0, len(groupIDsArray))
	for _, id := range groupIDsArray {
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
		l.RaiseError("failed to get groups: %s", err.Error())
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
			l.RaiseError("failed to convert metadata to json: %s", err.Error())
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		gt.RawSetString("metadata", metadataTable)

		groupsTable.RawSetInt(i+1, gt)
	}

	l.Push(groupsTable)
	return 1
}

// @group groups
// @summary Set up a group with various configuration settings. The group will be created if they don't exist or fail if the group name is taken.
// @param userID(type=string) Mandatory. The user ID to be associated as the group superadmin.
// @param name(type=string) Mandatory. Group name, must be unique.
// @param creatorID(type=string, optional=true) The user ID to be associated as creator. If not set or nil/null, system user will be set.
// @param langTag(type=string, optional=true, default="en") Group language.
// @param description(type=string, optional=true) Group description, can be left empty as nil/null.
// @param avatarURL(type=string, optional=true) URL to the group avatar, can be left empty as nil/null.
// @param open(type=bool, optional=true, default=false) Whether the group is for anyone to join, or members will need to send invitations to join.
// @param metadata(type=table, optional=true) Custom information to store for this group. Can be left empty as nil/null.
// @param maxCount(type=number, optional=true, default=100) Maximum number of members to have in the group.
// @return createGroup(string) The ID of the newly created group.
// @return error(error) An optional error value if an error occurred.
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

	langTag := l.OptString(4, "")
	description := l.OptString(5, "")
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

	group, err := CreateGroup(l.Context(), n.logger, n.db, userID, creatorID, name, langTag, description, avatarURL, metadataStr, open, maxCount)
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
		l.RaiseError("failed to convert metadata to json: %s", err.Error())
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

// @group groups
// @summary Update a group with various configuration settings. The group which is updated can change some or all of its fields.
// @param groupID(type=string) The ID of the group to update.
// @param userID(type=string, optional=true) User ID calling the update operation for permission checking. Set as nil to enact the changes as the system user.
// @param name(type=string, optional=true) Group name, can be empty if not changed.
// @param creatorID(type=string, optional=true) The user ID to be associated as creator. Can be empty if not changed.
// @param langTag(type=string, optional=true) Group language. Empty if not updated.
// @param description(type=string, optional=true) Group description, can be left empty if not updated.
// @param avatarURL(type=string, optional=true) URL to the group avatar, can be left empty if not updated.
// @param open(type=bool, optional=true) Whether the group is for anyone to join or not.
// @param metadataTable(type=table, optional=true) Custom information to store for this group. Use nil if field is not being updated.
// @param maxCount(type=number, optional=true) Maximum number of members to have in the group. Use 0, nil/null if field is not being updated.
// @return error(error) An optional error value if an error occurred.
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

	name := l.OptString(3, "")
	var nameValue *wrapperspb.StringValue
	if name != "" {
		nameValue = &wrapperspb.StringValue{Value: name}
	}

	creatorID := l.OptString(4, "")
	cid := uuid.Nil
	if creatorID != "" {
		var err error
		cid, err = uuid.FromString(creatorID)
		if err != nil {
			l.ArgError(3, "expects creator ID to be a valid identifier")
			return 0
		}
	}

	langTag := l.OptString(5, "")
	var lang *wrapperspb.StringValue
	if langTag != "" {
		lang = &wrapperspb.StringValue{Value: langTag}
	}

	description := l.OptString(6, "")
	var desc *wrapperspb.StringValue
	if description != "" {
		desc = &wrapperspb.StringValue{Value: description}
	}

	avatarURL := l.OptString(7, "")
	var avatarURLValue *wrapperspb.StringValue
	if avatarURL != "" {
		avatarURLValue = &wrapperspb.StringValue{Value: avatarURL}
	}

	openV := l.Get(8)
	var open *wrapperspb.BoolValue
	if openV != lua.LNil {
		open = &wrapperspb.BoolValue{Value: l.OptBool(8, false)}
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

	maxCount := l.OptInt(10, 0)

	if err = UpdateGroup(l.Context(), n.logger, n.db, groupID, userID, cid, nameValue, lang, desc, avatarURLValue, metadata, open, maxCount); err != nil {
		l.RaiseError("error while trying to update group: %v", err.Error())
		return 0
	}

	return 0
}

// @group groups
// @summary Delete a group.
// @param groupID(type=string) The ID of the group to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupDelete(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	if err = DeleteGroup(l.Context(), n.logger, n.db, n.tracker, groupID, uuid.Nil); err != nil {
		l.RaiseError("error while trying to delete group: %v", err.Error())
		return 0
	}

	return 0
}

// @group groups
// @summary Join a group for a particular user.
// @param groupID(type=string) The ID of the group to join.
// @param userID(type=string) The user ID to add to this group.
// @param username(type=string) The username of the user to add to this group.
// @return error(error) An optional error value if an error occurred.
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

	if err := JoinGroup(l.Context(), n.logger, n.db, n.tracker, n.router, groupID, userID, username); err != nil {
		l.RaiseError("error while trying to join a group: %v", err.Error())
		return 0
	}
	return 0
}

// @group groups
// @summary Leave a group for a particular user.
// @param groupID(type=string) The ID of the group to leave.
// @param userID(type=string) The user ID to remove from this group.
// @param username(type=string) The username of the user to remove from this group.
// @return error(error) An optional error value if an error occurred.
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

	if err := LeaveGroup(l.Context(), n.logger, n.db, n.tracker, n.router, n.streamManager, groupID, userID, username); err != nil {
		l.RaiseError("error while trying to leave a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Add users to a group.
// @param groupID(type=string) The ID of the group to add users to.
// @param userIDs(type=table) Table of user IDs to add to this group.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permissions are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersAdd(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userIDs := l.CheckTable(2)
	if userIDs == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	uids := make([]uuid.UUID, 0, userIDs.Len())
	conversionError := false
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
		uids = append(uids, userID)
	})
	if conversionError {
		return 0
	}

	if len(uids) == 0 {
		return 0
	}

	cid := uuid.Nil
	callerID := l.OptString(3, "")
	if callerID != "" {
		cid, err = uuid.FromString(callerID)
		if err != nil {
			l.ArgError(3, "expects caller ID to be empty or a valid identifier")
			return 0
		}
	}

	if err := AddGroupUsers(l.Context(), n.logger, n.db, n.tracker, n.router, cid, groupID, uids); err != nil {
		l.RaiseError("error while trying to add users into a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Ban users from a group.
// @param groupID(type=string) The ID of the group to ban users from.
// @param userIDs(type=table) Table of user IDs to ban from this group.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersBan(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userIDs := l.CheckTable(2)
	if userIDs == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	uids := make([]uuid.UUID, 0, userIDs.Len())
	conversionError := false
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
			l.ArgError(2, "cannot ban the root user")
			conversionError = true
			return
		}
		uids = append(uids, userID)
	})
	if conversionError {
		return 0
	}

	if len(uids) == 0 {
		return 0
	}

	cid := uuid.Nil
	callerID := l.OptString(3, "")
	if callerID != "" {
		cid, err = uuid.FromString(callerID)
		if err != nil {
			l.ArgError(3, "expects caller ID to be empty or a valid identifier")
			return 0
		}
	}

	if err := BanGroupUsers(l.Context(), n.logger, n.db, n.tracker, n.router, n.streamManager, cid, groupID, uids); err != nil {
		l.RaiseError("error while trying to add users into a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Promote users in a group.
// @param groupID(type=string) The ID of the group whose members are being promoted.
// @param userIDs(type=table) Table of user IDs to promote.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersPromote(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userIDs := l.CheckTable(2)
	if userIDs == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	uids := make([]uuid.UUID, 0, userIDs.Len())
	conversionError := false
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
		uids = append(uids, userID)
	})
	if conversionError {
		return 0
	}

	if len(uids) == 0 {
		return 0
	}

	cid := uuid.Nil
	callerID := l.OptString(3, "")
	if callerID != "" {
		cid, err = uuid.FromString(callerID)
		if err != nil {
			l.ArgError(3, "expects caller ID to be empty or a valid identifier")
			return 0
		}
	}

	if err := PromoteGroupUsers(l.Context(), n.logger, n.db, n.router, cid, groupID, uids); err != nil {
		l.RaiseError("error while trying to promote users in a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Demote users in a group.
// @param groupID(type=string) The ID of the group whose members are being demoted.
// @param userIDs(type=table) Table of user IDs to demote.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersDemote(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userIDs := l.CheckTable(2)
	if userIDs == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	uids := make([]uuid.UUID, 0, userIDs.Len())
	conversionError := false
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
		uids = append(uids, userID)
	})
	if conversionError {
		return 0
	}

	if len(uids) == 0 {
		return 0
	}

	cid := uuid.Nil
	callerID := l.OptString(3, "")
	if callerID != "" {
		cid, err = uuid.FromString(callerID)
		if err != nil {
			l.ArgError(3, "expects caller ID to be empty or a valid identifier")
			return 0
		}
	}

	if err := DemoteGroupUsers(l.Context(), n.logger, n.db, n.router, cid, groupID, uids); err != nil {
		l.RaiseError("error while trying to demote users in a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Kick users from a group. This can also be used to remove pending requests for groups that require acceptance.
// @param groupID(type=string) The ID of the group to kick users from.
// @param userIDs(type=table) Table of user IDs to kick.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersKick(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	userIDs := l.CheckTable(2)
	if userIDs == nil {
		l.ArgError(2, "expects user IDs to be a table")
		return 0
	}

	uids := make([]uuid.UUID, 0, userIDs.Len())
	conversionError := false
	userIDs.ForEach(func(k lua.LValue, v lua.LValue) {
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
		uids = append(uids, userID)
	})
	if conversionError {
		return 0
	}

	if len(uids) == 0 {
		return 0
	}

	cid := uuid.Nil
	callerID := l.OptString(3, "")
	if callerID != "" {
		cid, err = uuid.FromString(callerID)
		if err != nil {
			l.ArgError(3, "expects caller ID to be empty or a valid identifier")
			return 0
		}
	}

	if err := KickGroupUsers(l.Context(), n.logger, n.db, n.tracker, n.router, n.streamManager, cid, groupID, uids, false); err != nil {
		l.RaiseError("error while trying to kick users from a group: %v", err.Error())
	}
	return 0
}

// @group groups
// @summary Find groups based on the entered criteria.
// @param name(type=string) Search for groups that contain this value in their name.
// @param langTag(type=string, optional=true) Filter based upon the entered language tag.
// @param open(type=bool) Filter based on whether groups are Open or Closed.
// @param edgeCount(type=number) Search groups with an equal or lower number of members in descending order.
// @param limit(type=number, optional=true, default=100) Return only the required number of groups denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupsList(l *lua.LState) int {
	name := l.OptString(1, "")

	langTag := l.OptString(2, "")

	var openValue *bool
	if open := l.CheckAny(3); open.Type() != lua.LTNil {
		if open.Type() != lua.LTBool {
			l.ArgError(2, "expects open true/false or nil")
			return 0
		}
		openValue = new(bool)
		*openValue = lua.LVAsBool(open)
	}

	edgeCount := l.OptInt(4, -1)

	limit := l.OptInt(5, 100)

	cursor := l.OptString(6, "")

	groups, err := ListGroups(l.Context(), n.logger, n.db, name, langTag, openValue, edgeCount, limit, cursor)
	if err != nil {
		l.RaiseError("error listing groups: %v", err.Error())
		return 0
	}

	groupUsers := l.CreateTable(len(groups.Groups), 0)
	for i, group := range groups.Groups {
		gt, err := groupToLuaTable(l, group)
		if err != nil {
			l.RaiseError("error converting groups: %s", err.Error())
			return 0
		}

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

// @group groups
// @summary Fetch one or more groups randomly.
// @param count(type=int) The number of groups to fetch.
// @return users(table) A list of group record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupsGetRandom(l *lua.LState) int {
	count := l.OptInt(1, 0)

	if count < 0 || count > 1000 {
		l.ArgError(1, "count must be 0-1000")
		return 0
	}

	groups, err := GetRandomGroups(l.Context(), n.logger, n.db, count)
	if err != nil {
		l.RaiseError("failed to get groups: %s", err.Error())
		return 0
	}

	// Convert and push the values.
	groupsTable := l.CreateTable(len(groups), 0)
	for i, group := range groups {
		userTable, err := groupToLuaTable(l, group)
		if err != nil {
			l.RaiseError("error converting groups: %s", err.Error())
			return 0
		}
		groupsTable.RawSetInt(i+1, userTable)
	}

	l.Push(groupsTable)
	return 1
}

// @group groups
// @summary List all members, admins and superadmins which belong to a group. This also list incoming join requests.
// @param groupID(type=string) The ID of the group to list members for.
// @param limit(type=int, optional=true, default=100) The maximum number of entries in the listing.
// @param state(type=int, optional=true, default=null) The state of the user within the group. If unspecified this returns users in all states.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return groupUsers(table) The user information for members, admins and superadmins for the group. Also users who sent a join request.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) groupUsersList(l *lua.LState) int {
	groupID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects group ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 10000 {
		l.ArgError(2, "expects limit to be 1-10000")
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

	res, err := ListGroupUsers(l.Context(), n.logger, n.db, n.statusRegistry, groupID, limit, stateWrapper, cursor)
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
			l.RaiseError("failed to convert metadata to json: %s", err.Error())
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

// @group groups
// @summary List all groups which a user belongs to and whether they've been accepted or if it's an invitation.
// @param userID(type=string) The ID of the user to list groups for.
// @param limit(type=int, optional=true, default=100) The maximum number of entries in the listing.
// @param state(type=int optional=true, default=-1) The state of the user within the group. If unspecified this returns users in all states.
// @param cursor(type=string, optional=true) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return userGroups(table) A table of groups with their fields.
// @return error(error) An optional error value if an error occurred.
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
			l.RaiseError("failed to convert metadata to json: %s", err.Error())
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

// @group accounts
// @summary Update an account by user ID.
// @param userID(type=string) User ID for which the information is to be updated. Must be valid UUID.
// @param metadata(type=table, optional=true) The metadata to update for this account.
// @param username(type=string, optional=true) Username to be set. Must be unique. Use null if it is not being updated.
// @param displayName(type=string, optional=true) Display name to be updated. Use null if it is not being updated.
// @param timezone(type=string, optional=true) Timezone to be updated. Use null if it is not being updated.
// @param location(type=string, optional=true) Location to be updated. Use null if it is not being updated.
// @param langTag(type=string, optional=true) Lang tag to be updated. Use null if it is not being updated.
// @param avatarURL(type=string, optional=true) User's avatar URL. Use null if it is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) accountUpdateId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	metadata := l.OptTable(2, nil)
	var metadataValue *wrapperspb.StringValue
	if metadata != nil {
		metadataMap := RuntimeLuaConvertLuaTable(metadata)
		metadataBytes, err := json.Marshal(metadataMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		metadataValue = &wrapperspb.StringValue{Value: string(metadataBytes)}
	}

	username := l.OptString(3, "")

	displayName := l.OptString(4, "")
	var displayNameValue *wrapperspb.StringValue
	if displayName != "" {
		displayNameValue = &wrapperspb.StringValue{Value: displayName}
	}

	timezone := l.OptString(5, "")
	var timezoneValue *wrapperspb.StringValue
	if timezone != "" {
		timezoneValue = &wrapperspb.StringValue{Value: timezone}
	}

	location := l.OptString(6, "")
	var locationValue *wrapperspb.StringValue
	if location != "" {
		locationValue = &wrapperspb.StringValue{Value: location}
	}

	langTag := l.OptString(7, "")
	var lang *wrapperspb.StringValue
	if langTag != "" {
		lang = &wrapperspb.StringValue{Value: langTag}
	}

	avatarURL := l.OptString(8, "")
	var avatar *wrapperspb.StringValue
	if avatarURL != "" {
		avatar = &wrapperspb.StringValue{Value: avatarURL}
	}

	if err = UpdateAccounts(l.Context(), n.logger, n.db, []*accountUpdate{{
		userID:      userID,
		username:    username,
		displayName: displayNameValue,
		timezone:    timezoneValue,
		location:    locationValue,
		langTag:     lang,
		avatarURL:   avatar,
		metadata:    metadataValue,
	}}); err != nil {
		l.RaiseError("error while trying to update user: %v", err.Error())
	}

	return 0
}

// @group accounts
// @summary Delete an account by user ID.
// @param userID(type=string) User ID for the account to be deleted. Must be valid UUID.
// @param recorded(type=bool, optional=true, default=false) Whether to record this deletion in the database. By default this is set to false.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) accountDeleteId(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	recorded := l.OptBool(2, false)

	if err := DeleteAccount(l.Context(), n.logger, n.db, n.config, n.leaderboardCache, n.rankCache, n.sessionRegistry, n.sessionCache, n.tracker, userID, recorded); err != nil {
		l.RaiseError("error while trying to delete account: %v", err.Error())
	}

	return 0
}

// @group accounts
// @summary Export account information for a specified user ID.
// @param userID(type=string) User ID for the account to be exported. Must be valid UUID.
// @return export(string) Account information for the provided user ID, in JSON format.
// @return error(error) An optional error value if an error occurred.
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

// @group friends
// @summary List all friends, invites, invited, and blocked which belong to a user.
// @param userID(type=string) The ID of the user whose friends, invites, invited, and blocked you want to list.
// @param limit(type=number, optional=true) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param state(type=number, optional=true) The state of the friendship with the user. If unspecified this returns friends in all states for the user.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return friends(table) The user information for users that are friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendsList(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 1000 {
		l.ArgError(2, "expects limit to be 1-1000")
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

	friends, err := ListFriends(l.Context(), n.logger, n.db, n.statusRegistry, userID, limit, stateWrapper, cursor)
	if err != nil {
		l.RaiseError("error while trying to list friends for a user: %v", err.Error())
		return 0
	}

	userFriends := l.CreateTable(len(friends.Friends), 0)
	for i, f := range friends.Friends {
		u := f.User

		fut, err := userToLuaTable(l, u)
		if err != nil {
			l.RaiseError("failed to convert user data to lua table: %s", err.Error())
			return 0
		}

		ft := l.CreateTable(0, 4)
		ft.RawSetString("state", lua.LNumber(f.State.Value))
		ft.RawSetString("update_time", lua.LNumber(f.UpdateTime.Seconds))
		ft.RawSetString("user", fut)
		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(f.Metadata), &metadataMap)
		if err != nil {
			l.RaiseError("failed to unmarshal friend metadata: %s", err.Error())
			return 0
		}
		metadataTable := RuntimeLuaConvertMap(l, metadataMap)
		ft.RawSetString("metadata", metadataTable)

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

// @group friends
// @summary List all friends, invites, invited, and blocked which belong to a user.
// @param userID(type=string) The ID of the user whose friends, invites, invited, and blocked you want to list.
// @param limit(type=number, optional=true) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return friendsOfFriends(table) The user information for users that are friends of friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or nil when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendsOfFriendsList(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 1000 {
		l.ArgError(2, "expects limit to be 1-1000")
		return 0
	}

	cursor := l.OptString(3, "")

	friends, err := ListFriendsOfFriends(l.Context(), n.logger, n.db, n.statusRegistry, userID, limit, cursor)
	if err != nil {
		l.RaiseError("error while trying to list friends of friends for a user: %v", err.Error())
		return 0
	}

	userFriendsOfFriends := l.CreateTable(len(friends.FriendsOfFriends), 0)
	for i, f := range friends.FriendsOfFriends {
		u := f.User

		fut, err := userToLuaTable(l, u)
		if err != nil {
			l.RaiseError("failed to convert user data to lua table: %s", err.Error())
			return 0
		}

		ft := l.CreateTable(0, 2)
		ft.RawSetString("referrer", lua.LString(f.Referrer))
		ft.RawSetString("user", fut)

		userFriendsOfFriends.RawSetInt(i+1, ft)
	}

	l.Push(userFriendsOfFriends)
	if friends.Cursor == "" {
		l.Push(lua.LNil)
	} else {
		l.Push(lua.LString(friends.Cursor))
	}

	return 2
}

// @group friends
// @summary Add friends to a user.
// @param userID(type=string) The ID of the user to whom you want to add friends.
// @param username(type=string) The name of the user to whom you want to add friends.
// @param userIDs(type=table) The IDs of the users you want to add as friends.
// @param usernames(type=table) The usernames of the users you want to add as friends.
// @param metadataTable(type=table, optional=true) Custom information to store for this friend. Can be left empty as nil/null.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendsAdd(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username string")
		return 0
	}

	userIDs := l.OptTable(3, nil)
	var uids []string
	if userIDs != nil {
		userIDsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
		if !ok {
			l.ArgError(3, "invalid user ids list")
			return 0
		}

		userIDStrings := make([]string, 0, len(userIDsTable))
		for _, id := range userIDsTable {
			if ids, ok := id.(string); !ok || ids == "" {
				l.ArgError(3, "each user id must be a string")
				return 0
			} else if uid, err := uuid.FromString(ids); err != nil || uid == uuid.Nil {
				l.ArgError(3, "invalid user ID "+ids)
				return 0
			} else if userID.String() == ids {
				l.ArgError(3, "cannot add self as friend")
				return 0
			} else {
				userIDStrings = append(userIDStrings, ids)
			}
		}
		uids = userIDStrings
	}

	usernames := l.OptTable(4, nil)
	var usernamesArray []string
	if usernames != nil {
		usernamesIDsTable, ok := RuntimeLuaConvertLuaValue(usernames).([]interface{})
		if !ok {
			l.ArgError(4, "invalid username list")
			return 0
		}

		usernameStrings := make([]string, 0, len(usernamesIDsTable))
		for _, name := range usernamesIDsTable {
			if names, ok := name.(string); !ok || names == "" {
				l.ArgError(4, "each username must be a non-empty string")
				return 0
			} else if username == names {
				l.ArgError(4, "cannot add self as friend")
				return 0
			} else {
				usernameStrings = append(usernameStrings, names)
			}
		}
		usernamesArray = usernameStrings
	}

	if len(uids) == 0 && len(usernamesArray) == 0 {
		return 0
	}

	fetchIDs, err := fetchUserID(l.Context(), n.db, usernamesArray)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
		l.RaiseError("error while trying to add friends")
		return 0
	}

	if len(fetchIDs)+len(uids) == 0 {
		l.RaiseError("no valid ID or username was provided")
		return 0
	}

	allIDs := make([]string, 0, len(uids)+len(fetchIDs))
	allIDs = append(allIDs, uids...)
	allIDs = append(allIDs, fetchIDs...)

	// Parse metadata, optional.
	metadataTable := l.OptTable(5, nil)
	var metadata map[string]any
	if metadataTable != nil {
		metadata = RuntimeLuaConvertLuaTable(metadataTable)
	}

	var metadataStr string
	if metadata != nil {
		bytes, err := json.Marshal(metadata)
		if err != nil {
			n.logger.Error("Could not marshal metadata", zap.Error(err))
			l.RaiseError("error marshalling metadata: %s", err.Error())
			return 0
		}
		metadataStr = string(bytes)
	}

	err = AddFriends(l.Context(), n.logger, n.db, n.tracker, n.router, userID, username, allIDs, metadataStr)
	if err != nil {
		l.RaiseError("error adding friends: %s", err.Error())
		return 0
	}

	return 0
}

// @group friends
// @summary Delete friends from a user.
// @param userID(type=string) The ID of the user from whom you want to delete friends.
// @param username(type=string) The name of the user from whom you want to delete friends.
// @param userIDs(type=table) The IDs of the users you want to delete as friends.
// @param usernames(type=table) The usernames of the users you want to delete as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendsDelete(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username string")
		return 0
	}

	userIDs := l.OptTable(3, nil)
	var uids []string
	if userIDs != nil {
		userIDsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
		if !ok {
			l.ArgError(3, "invalid user ids list")
			return 0
		}

		userIDStrings := make([]string, 0, len(userIDsTable))
		for _, id := range userIDsTable {
			if ids, ok := id.(string); !ok || ids == "" {
				l.ArgError(3, "each user id must be a string")
				return 0
			} else if uid, err := uuid.FromString(ids); err != nil || uid == uuid.Nil {
				l.ArgError(3, "invalid user ID "+ids)
				return 0
			} else if userID.String() == ids {
				l.ArgError(3, "cannot delete self")
				return 0
			} else {
				userIDStrings = append(userIDStrings, ids)
			}
		}
		uids = userIDStrings
	}

	usernames := l.OptTable(4, nil)
	var usernamesArray []string
	if usernames != nil {
		usernamesIDsTable, ok := RuntimeLuaConvertLuaValue(usernames).([]interface{})
		if !ok {
			l.ArgError(4, "invalid username list")
			return 0
		}

		usernameStrings := make([]string, 0, len(usernamesIDsTable))
		for _, name := range usernamesIDsTable {
			if names, ok := name.(string); !ok || names == "" {
				l.ArgError(4, "each username must be a non-empty string")
				return 0
			} else if username == names {
				l.ArgError(4, "cannot delete self")
				return 0
			} else {
				usernameStrings = append(usernameStrings, names)
			}
		}
		usernamesArray = usernameStrings
	}

	if len(uids) == 0 && len(usernamesArray) == 0 {
		return 0
	}

	fetchIDs, err := fetchUserID(l.Context(), n.db, usernamesArray)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
		l.RaiseError("error while trying to delete friends")
		return 0
	}

	if len(fetchIDs)+len(uids) == 0 {
		l.RaiseError("no valid ID or username was provided")
		return 0
	}

	allIDs := make([]string, 0, len(uids)+len(fetchIDs))
	allIDs = append(allIDs, uids...)
	allIDs = append(allIDs, fetchIDs...)

	err = DeleteFriends(l.Context(), n.logger, n.db, n.tracker, n.router, userID, username, allIDs)
	if err != nil {
		l.RaiseError("error deleting friends: %s", err.Error())
		return 0
	}

	return 0
}

// @group friends
// @summary Block friends for a user.
// @param userID(type=string) The ID of the user for whom you want to block friends.
// @param username(type=string) The name of the user for whom you want to block friends.
// @param userIDs(type=table) The IDs of the users you want to block as friends.
// @param usernames(type=table) The usernames of the users you want to block as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendsBlock(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	username := l.CheckString(2)
	if username == "" {
		l.ArgError(2, "expects username string")
		return 0
	}

	userIDs := l.OptTable(3, nil)
	var uids []string
	if userIDs != nil {
		userIDsTable, ok := RuntimeLuaConvertLuaValue(userIDs).([]interface{})
		if !ok {
			l.ArgError(3, "invalid user ids list")
			return 0
		}

		userIDStrings := make([]string, 0, len(userIDsTable))
		for _, id := range userIDsTable {
			if ids, ok := id.(string); !ok || ids == "" {
				l.ArgError(3, "each user id must be a string")
				return 0
			} else if uid, err := uuid.FromString(ids); err != nil || uid == uuid.Nil {
				l.ArgError(3, "invalid user ID "+ids)
				return 0
			} else if userID.String() == ids {
				l.ArgError(3, "cannot block self")
				return 0
			} else {
				userIDStrings = append(userIDStrings, ids)
			}
		}
		uids = userIDStrings
	}

	usernames := l.OptTable(4, nil)
	var usernamesArray []string
	if usernames != nil {
		usernamesIDsTable, ok := RuntimeLuaConvertLuaValue(usernames).([]interface{})
		if !ok {
			l.ArgError(4, "invalid username list")
			return 0
		}

		usernameStrings := make([]string, 0, len(usernamesIDsTable))
		for _, name := range usernamesIDsTable {
			if names, ok := name.(string); !ok || names == "" {
				l.ArgError(4, "each username must be a non-empty string")
				return 0
			} else if username == names {
				l.ArgError(4, "cannot block self")
				return 0
			} else {
				usernameStrings = append(usernameStrings, names)
			}
		}
		usernamesArray = usernameStrings
	}

	if len(uids) == 0 && len(usernamesArray) == 0 {
		return 0
	}

	fetchIDs, err := fetchUserID(l.Context(), n.db, usernamesArray)
	if err != nil {
		n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
		l.RaiseError("error while trying to block friends")
		return 0
	}

	if len(fetchIDs)+len(uids) == 0 {
		l.RaiseError("no valid ID or username was provided")
		return 0
	}

	allIDs := make([]string, 0, len(uids)+len(fetchIDs))
	allIDs = append(allIDs, uids...)
	allIDs = append(allIDs, fetchIDs...)

	err = BlockFriends(l.Context(), n.logger, n.db, n.tracker, userID, allIDs)
	if err != nil {
		l.RaiseError("error blocking friends: %s", err.Error())
		return 0
	}

	return 0
}

// @group parties
// @summary List existing realtime parties and filter them by open or a query based on the set label.
// @param limit(type=number, optional=true, default=10) The maximum number of parties to list.
// @param open(type=bool, optional=true, default=null) Filter open or closed parties. If null, both open and closed parties are returned.
// @param query(type=string, optional=true) Additional query parameters to shortlist parties.
// @param cursor(type=string, optional=true) A cursor to fetch the next page of results.
// @return parties(table) A list of parties matching the filtering criteria.
// @return cursor(string) A cursor to fetch the next page of results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) partyList(l *lua.LState) int {
	// Parse limit.
	limit := l.OptInt(1, 10)
	if limit < 1 || limit > 100 {
		l.ArgError(1, "expects limit to be 1-100")
		return 0
	}

	var open *bool
	if openIn := l.CheckAny(2); openIn.Type() != lua.LTNil {
		if openIn.Type() != lua.LTBool {
			l.ArgError(2, "expects open true/false or nil")
			return 0
		}
		open = new(bool)
		*open = lua.LVAsBool(openIn)
	}

	showHidden := l.CheckBool(3)

	query := l.OptString(4, "")

	cursor := l.OptString(5, "")

	results, cursor, err := n.partyRegistry.PartyList(l.Context(), limit, open, showHidden, query, cursor)
	if err != nil {
		l.RaiseError("failed to list parties: %s", err.Error())
		return 0
	}

	parties := l.CreateTable(len(results), 0)
	for i, result := range results {
		party := l.CreateTable(0, 4)
		party.RawSetString("match_id", lua.LString(result.PartyId))
		party.RawSetString("open", lua.LBool(result.Open))
		party.RawSetString("maxSize", lua.LNumber(result.MaxSize))
		party.RawSetString("label", lua.LString(result.Label))

		parties.RawSetInt(i+1, party)
	}

	l.Push(parties)

	if cursor != "" {
		l.Push(lua.LString(cursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

// @group friends
// @summary Update friend metadata.
// @param userID(type=string) The ID of the user.
// @param friendUserID(type=string) The ID of the friend of the user.
// @param metadata(type=table) The custom metadata to set for the friend.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) friendMetadataUpdate(l *lua.LState) int {
	userID, err := uuid.FromString(l.CheckString(1))
	if err != nil {
		l.ArgError(1, "expects user ID to be a valid identifier")
		return 0
	}

	friendUserID, err := uuid.FromString(l.CheckString(2))
	if err != nil {
		l.ArgError(2, "expects user ID to be a valid identifier")
		return 0
	}

	metadata := RuntimeLuaConvertLuaTable(l.CheckTable(3))

	if err := UpdateFriendMetadata(l.Context(), n.logger, n.db, userID, friendUserID, metadata); err != nil {
		l.RaiseError("error updating friends metadata: %s", err.Error())
		return 0
	}

	return 0
}

// @group utils
// @summary Read file from user device.
// @param relPath(type=string) Relative path to the file to be read.
// @return fileContent(string) The read file contents.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) fileRead(l *lua.LState) int {
	relPath := l.CheckString(1)
	if relPath == "" {
		l.ArgError(1, "expects relative path string")
		return 0
	}

	rootPath := n.config.GetRuntime().Path

	f, err := FileRead(rootPath, relPath)
	if err != nil {
		l.RaiseError("failed to open file: %s", err.Error())
		return 0
	}
	defer f.Close()

	fileContent, err := io.ReadAll(f)
	if err != nil {
		l.RaiseError("failed to read file: %s", err.Error())
		return 0
	}

	l.Push(lua.LString(fileContent))
	return 1
}

// @group chat
// @summary Send a message on a realtime chat channel.
// @param channelID(type=string) The ID of the channel to send the message on.
// @param content(type=table) Message content.
// @param senderID(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return ack(table) Message sent ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) channelMessageSend(l *lua.LState) int {
	channelID := l.CheckString(1)

	content := l.OptTable(2, nil)
	contentStr := "{}"
	if content != nil {
		contentMap := RuntimeLuaConvertLuaTable(content)
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		if len(contentBytes) == 0 || contentBytes[0] != byteBracket {
			l.ArgError(2, "expects message content to be a valid JSON object")
			return 0
		}
		contentStr = string(contentBytes)
	}

	senderID := l.OptString(3, "")
	sid := uuid.Nil.String()
	if senderID != "" {
		suid, err := uuid.FromString(senderID)
		if err != nil {
			l.ArgError(3, "expects sender id to either be not set, empty string or a valid UUID")
			return 0
		}
		sid = suid.String()
	}

	senderUsername := l.OptString(4, "")

	persist := l.OptBool(5, false)

	channelIdToStreamResult, err := ChannelIdToStream(channelID)
	if err != nil {
		l.RaiseError("error converting channel identifier to stream: %s", err.Error())
		return 0
	}

	ack, err := ChannelMessageSend(l.Context(), n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelID, contentStr, sid, senderUsername, persist)
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

// @group chat
// @summary Update a message on a realtime chat channel.
// @param channelID(type=string) The ID of the channel to send the message on.
// @param messageID(type=string) The ID of the message to update.
// @param content(type=table) Message content. Must be set.
// @param senderID(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return ack(table) Message updated ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) channelMessageUpdate(l *lua.LState) int {
	channelID := l.CheckString(1)

	messageID := l.CheckString(2)
	if _, err := uuid.FromString(messageID); err != nil {
		l.ArgError(2, errChannelMessageIdInvalid.Error())
		return 0
	}

	content := l.OptTable(3, nil)
	contentStr := "{}"
	if content != nil {
		contentMap := RuntimeLuaConvertLuaTable(content)
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			l.RaiseError("error encoding metadata: %v", err.Error())
			return 0
		}
		if len(contentBytes) == 0 || contentBytes[0] != byteBracket {
			l.ArgError(3, "expects message content to be a valid JSON object")
			return 0
		}
		contentStr = string(contentBytes)
	}

	senderID := l.OptString(4, "")
	sid := uuid.Nil.String()
	if senderID != "" {
		suid, err := uuid.FromString(senderID)
		if err != nil {
			l.ArgError(4, "expects sender id to either be not set, empty string or a valid UUID")
			return 0
		}
		sid = suid.String()
	}

	senderUsername := l.OptString(5, "")

	persist := l.OptBool(6, false)

	channelIdToStreamResult, err := ChannelIdToStream(channelID)
	if err != nil {
		l.RaiseError("error converting channel identifier to stream: %s", err.Error())
		return 0
	}

	ack, err := ChannelMessageUpdate(l.Context(), n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelID, messageID, contentStr, sid, senderUsername, persist)
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

// @group chat
// @summary Remove a message on a realtime chat channel.
// @param channelID(type=string) The ID of the channel to send the message on.
// @param messageID(type=string) The ID of the message to remove.
// @param senderID(type=string, optional=true) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string, optional=true) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return ack(table) Message removed ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) channelMessageRemove(l *lua.LState) int {
	channelID := l.CheckString(1)

	messageID := l.CheckString(2)
	if _, err := uuid.FromString(messageID); err != nil {
		l.ArgError(2, errChannelMessageIdInvalid.Error())
		return 0
	}

	senderID := l.OptString(3, "")
	sid := uuid.Nil.String()
	if senderID != "" {
		suid, err := uuid.FromString(senderID)
		if err != nil {
			l.ArgError(3, "expects sender id to either be not set, empty string or a valid UUID")
			return 0
		}
		sid = suid.String()
	}

	senderUsername := l.OptString(4, "")

	persist := l.OptBool(5, false)

	channelIdToStreamResult, err := ChannelIdToStream(channelID)
	if err != nil {
		l.RaiseError("error converting channel identifier to stream: %s", err.Error())
		return 0
	}

	ack, err := ChannelMessageRemove(l.Context(), n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelID, messageID, sid, senderUsername, persist)
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

// @group chat
// @summary List messages from a realtime chat channel.
// @param channelID(type=string) The ID of the channel to send the message on.
// @param limit(type=number, optional=true, default=100) The number of messages to return per page.
// @param forward(type=bool, optional=true, default=true) Whether to list messages from oldest to newest, or newest to oldest.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return messages(table) Messages from the specified channel.
// @return nextCursor(string) Cursor for the next page of messages, if any. Will be set to "" or nil when fetching last available page.
// @return prevCursor(string) Cursor for the previous page of messages, if any.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) channelMessagesList(l *lua.LState) int {
	channelID := l.CheckString(1)

	limit := l.OptInt(2, 100)
	if limit < 1 || limit > 100 {
		l.ArgError(2, "limit must be 1-100")
		return 0
	}

	forward := l.OptBool(3, true)

	cursor := l.OptString(4, "")

	channelIdToStreamResult, err := ChannelIdToStream(channelID)
	if err != nil {
		l.RaiseError("error converting leaderboard records: %s", err.Error())
		return 0
	}

	list, err := ChannelMessagesList(l.Context(), n.logger, n.db, uuid.Nil, channelIdToStreamResult.Stream, channelID, limit, forward, cursor)
	if err != nil {
		l.RaiseError("failed to list channel messages: %v", err.Error())
		return 0
	}

	messagesTable := l.CreateTable(len(list.Messages), 0)
	for i, message := range list.Messages {
		messageTable := l.CreateTable(0, 13)

		messageTable.RawSetString("channelId", lua.LString(message.ChannelId))
		messageTable.RawSetString("messageId", lua.LString(message.MessageId))
		messageTable.RawSetString("code", lua.LNumber(message.Code.Value))
		messageTable.RawSetString("senderId", lua.LString(message.SenderId))
		messageTable.RawSetString("username", lua.LString(message.Username))
		messageTable.RawSetString("content", lua.LString(message.Content))
		messageTable.RawSetString("createTime", lua.LNumber(message.CreateTime.Seconds))
		messageTable.RawSetString("updateTime", lua.LNumber(message.UpdateTime.Seconds))
		messageTable.RawSetString("persistent", lua.LBool(message.Persistent.Value))
		messageTable.RawSetString("roomName", lua.LString(message.RoomName))
		messageTable.RawSetString("groupId", lua.LString(message.GroupId))
		messageTable.RawSetString("userIdOne", lua.LString(message.UserIdOne))
		messageTable.RawSetString("userIdTwo", lua.LString(message.UserIdTwo))

		messagesTable.RawSetInt(i+1, messageTable)
	}

	l.Push(messagesTable)

	if list.NextCursor != "" {
		l.Push(lua.LString(list.NextCursor))
	} else {
		l.Push(lua.LNil)
	}

	if list.PrevCursor != "" {
		l.Push(lua.LString(list.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 3
}

// @group chat
// @summary Create a channel identifier to be used in other runtime calls. Does not create a channel.
// @param senderID(type=string) UserID of the message sender (when applicable). An empty string defaults to the system user.
// @param target(type=string) Can be the room name, group identifier, or another username.
// @param chanType(type=int) The type of channel, either Room (1), Direct (2), or Group (3).
// @return channelId(string) The generated ID representing a channel.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) channelIdBuild(l *lua.LState) int {
	senderID := l.CheckString(1)
	suid := uuid.Nil
	if senderID != "" {
		var err error
		suid, err = uuid.FromString(senderID)
		if err != nil {
			l.ArgError(1, "expects sender id to either be not set, empty string or a valid UUID")
			return 0
		}
	}

	target := l.CheckString(2)

	chanType := l.CheckInt(3)
	if chanType < 1 || chanType > 3 {
		l.ArgError(3, "invalid channel type: expects value 1-3")
		return 0
	}

	channelId, _, err := BuildChannelId(l.Context(), n.logger, n.db, suid, target, rtapi.ChannelJoin_Type(chanType))
	if err != nil {
		if errors.Is(err, runtime.ErrInvalidChannelTarget) {
			l.ArgError(1, err.Error())
			return 0
		} else if errors.Is(err, runtime.ErrInvalidChannelType) {
			l.ArgError(2, err.Error())
			return 0
		}
		l.RaiseError("error building channel identifier: %s", err.Error())
		return 0
	}

	l.Push(lua.LString(channelId))
	return 1
}

// @group storage
// @summary List storage index entries
// @param index(type=string) Name of the index to list entries from.
// @param query(type=string) Query to filter index entries.
// @param limit(type=int) Maximum number of results to be returned.
// @param orderTable(type=[]string, optional=true) The storage object fields to sort the query results by. The prefix '-' before a field name indicates descending order. All specified fields must be indexed and sortable.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @param cursor(type=string, optional=true) A cursor to fetch the next page of results.
// @return objects(table) A list of storage objects.
// @return objects(string) A cursor, if there's a next page of results, nil otherwise.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) storageIndexList(l *lua.LState) int {
	index := l.CheckString(1)
	query := l.CheckString(2)
	limit := l.OptInt(3, 100)
	if limit < 1 || limit > 10_000 {
		l.ArgError(3, "invalid limit: expects value 1-10000")
		return 0
	}
	orderTable := l.CheckTable(4)
	order := make([]string, 0, orderTable.Len())
	orderTable.ForEach(func(k, v lua.LValue) {
		if v.Type() != lua.LTString {
			l.ArgError(4, "expects each field to be string")
			return
		}
		order = append(order, v.String())
	})

	callerIDValue := uuid.Nil
	callerID := l.OptString(5, "")
	if callerID != "" {
		cid, err := uuid.FromString(callerID)
		if err != nil {
			l.ArgError(5, "expects caller ID to be empty or a valid identifier")
			return 0
		}
		callerIDValue = cid
	}

	cursor := l.OptString(6, "")

	objectList, newCursor, err := n.storageIndex.List(l.Context(), callerIDValue, index, query, limit, order, cursor)
	if err != nil {
		l.RaiseError("error in storage index list: %s", err.Error())
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
			l.RaiseError("failed to convert value to json: %s", err.Error())
			return 0
		}
		valueTable := RuntimeLuaConvertMap(l, valueMap)
		vt.RawSetString("value", valueTable)

		lv.RawSetInt(i+1, vt)
	}
	l.Push(lv)

	if newCursor != "" {
		l.Push(lua.LString(newCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 2
}

// @group configuration
// @summary Get a subset of the Nakama configuration values.
// @return config(table) A number of Nakama configuration values.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) getConfig(l *lua.LState) int {
	rnc, err := n.config.GetRuntimeConfig()
	if err != nil {
		l.RaiseError("failed to get config: %s", err.Error())
		return 0
	}

	cfgObj := l.CreateTable(0, 10)
	cfgObj.RawSetString("name", lua.LString(rnc.GetName()))
	cfgObj.RawSetString("shutdown_grace_sec", lua.LNumber(rnc.GetShutdownGraceSec()))

	lgCfg := l.CreateTable(0, 1)
	lgCfg.RawSetString("level", lua.LString(rnc.GetLogger().GetLevel()))
	cfgObj.RawSetString("logger", lgCfg)

	sessCfg := l.CreateTable(0, 8)
	sessCfg.RawSetString("encryption_key", lua.LString(rnc.GetSession().GetEncryptionKey()))
	sessCfg.RawSetString("token_expiry_sec", lua.LNumber(rnc.GetSession().GetTokenExpirySec()))
	sessCfg.RawSetString("refresh_encryption_key", lua.LString(rnc.GetSession().GetRefreshEncryptionKey()))
	sessCfg.RawSetString("refresh_token_expiry_sec", lua.LNumber(rnc.GetSession().GetRefreshTokenExpirySec()))
	sessCfg.RawSetString("single_socket", lua.LBool(rnc.GetSession().GetSingleSocket()))
	sessCfg.RawSetString("single_match", lua.LBool(rnc.GetSession().GetSingleMatch()))
	sessCfg.RawSetString("single_party", lua.LBool(rnc.GetSession().GetSingleParty()))
	sessCfg.RawSetString("single_session", lua.LBool(rnc.GetSession().GetSingleSession()))
	cfgObj.RawSetString("session", sessCfg)

	socketCfg := l.CreateTable(0, 4)
	socketCfg.RawSetString("server_key", lua.LString(rnc.GetSocket().GetServerKey()))
	socketCfg.RawSetString("port", lua.LNumber(rnc.GetSocket().GetPort()))
	socketCfg.RawSetString("address", lua.LString(rnc.GetSocket().GetAddress()))
	socketCfg.RawSetString("protocol", lua.LString(rnc.GetSocket().GetProtocol()))
	cfgObj.RawSetString("socket", socketCfg)

	// Social
	steamCfg := l.CreateTable(0, 2)
	steamCfg.RawSetString("publisher_key", lua.LString(rnc.GetSocial().GetSteam().GetPublisherKey()))
	steamCfg.RawSetString("app_id", lua.LNumber(rnc.GetSocial().GetSteam().GetAppID()))

	fbInstantCfg := l.CreateTable(0, 1)
	fbInstantCfg.RawSetString("app_secret", lua.LString(rnc.GetSocial().GetFacebookInstantGame().GetAppSecret()))

	fbLimitedCfg := l.CreateTable(0, 1)
	fbLimitedCfg.RawSetString("app_id", lua.LString(rnc.GetSocial().GetFacebookLimitedLogin().GetAppId()))

	appleCfg := l.CreateTable(0, 1)
	appleCfg.RawSetString("bundle_id", lua.LString(rnc.GetSocial().GetApple().GetBundleId()))

	socialCfg := l.CreateTable(0, 4)
	socialCfg.RawSetString("steam", steamCfg)
	socialCfg.RawSetString("facebook_instant_game", fbInstantCfg)
	socialCfg.RawSetString("facebook_limited_login", fbLimitedCfg)
	socialCfg.RawSetString("apple", appleCfg)
	cfgObj.RawSetString("social", socialCfg)

	runtimeCfg := l.CreateTable(0, 2)
	envTable := l.CreateTable(0, len(rnc.GetRuntime().GetEnv()))
	for _, e := range rnc.GetRuntime().GetEnv() {
		envTable.Append(lua.LString(e))
	}
	runtimeCfg.RawSetString("env", envTable)
	runtimeCfg.RawSetString("http_key", lua.LString(rnc.GetRuntime().GetHTTPKey()))
	cfgObj.RawSetString("runtime", runtimeCfg)

	// IAP
	iapAppleCfg := l.CreateTable(0, 2)
	iapAppleCfg.RawSetString("shared_password", lua.LString(rnc.GetIAP().GetApple().GetSharedPassword()))
	iapAppleCfg.RawSetString("notifications_endpoint_id", lua.LString(rnc.GetIAP().GetApple().GetNotificationsEndpointId()))

	iapGoogleCfg := l.CreateTable(0, 5)
	iapGoogleCfg.RawSetString("client_email", lua.LString(rnc.GetIAP().GetGoogle().GetClientEmail()))
	iapGoogleCfg.RawSetString("private_key", lua.LString(rnc.GetIAP().GetGoogle().GetPrivateKey()))
	iapGoogleCfg.RawSetString("notifications_endpoint_id", lua.LString(rnc.GetIAP().GetGoogle().GetNotificationsEndpointId()))

	iapHuaweiCfg := l.CreateTable(0, 3)
	iapHuaweiCfg.RawSetString("public_key", lua.LString(rnc.GetIAP().GetHuawei().GetPublicKey()))
	iapHuaweiCfg.RawSetString("client_id", lua.LString(rnc.GetIAP().GetHuawei().GetClientID()))
	iapHuaweiCfg.RawSetString("client_secret", lua.LString(rnc.GetIAP().GetHuawei().GetClientSecret()))

	iapFacebookInstantCfg := l.CreateTable(0, 1)
	iapFacebookInstantCfg.RawSetString("app_secret", lua.LString(rnc.GetIAP().GetFacebookInstant().GetAppSecret()))
	iapCfg := l.CreateTable(0, 4)
	iapCfg.RawSetString("apple", iapAppleCfg)
	iapCfg.RawSetString("google", iapGoogleCfg)
	iapCfg.RawSetString("huawei", iapHuaweiCfg)
	iapCfg.RawSetString("facebook_instant", iapFacebookInstantCfg)
	cfgObj.RawSetString("iap", iapCfg)

	googleAuthCfg := l.CreateTable(0, 1)
	googleAuthCfg.RawSetString("credentials_json", lua.LString(rnc.GetGoogleAuth().GetCredentialsJSON()))
	cfgObj.RawSetString("google_auth", googleAuthCfg)

	satoriCfg := l.CreateTable(0, 4)
	satoriCfg.RawSetString("url", lua.LString(rnc.GetSatori().GetUrl()))
	satoriCfg.RawSetString("api_key_name", lua.LString(rnc.GetSatori().GetApiKeyName()))
	satoriCfg.RawSetString("api_key", lua.LString(rnc.GetSatori().GetApiKey()))
	satoriCfg.RawSetString("signing_key", lua.LString(rnc.GetSatori().GetSigningKey()))
	cfgObj.RawSetString("satori", satoriCfg)

	l.Push(cfgObj)

	return 1
}

// @group satori
// @summary Get the Satori client.
// @return satori(table) The satori client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) getSatori(l *lua.LState) int {
	satoriFunctions := map[string]lua.LGFunction{
		"authenticate":          n.satoriAuthenticate,
		"properties_get":        n.satoriPropertiesGet,
		"properties_update":     n.satoriPropertiesUpdate,
		"events_publish":        n.satoriEventsPublish,
		"server_events_publish": n.satoriServerEventsPublish,
		"experiments_list":      n.satoriExperimentsList,
		"flags_list":            n.satoriFlagsList,
		"flags_overrides_list":  n.satoriFlagsOverridesList,
		"live_events_list":      n.satoriLiveEventsList,
		"messages_list":         n.satoriMessagesList,
		"message_update":        n.satoriMessageUpdate,
		"message_delete":        n.satoriMessageDelete,
	}

	satoriMod := l.SetFuncs(l.CreateTable(0, len(satoriFunctions)), satoriFunctions)

	l.Push(satoriMod)
	return 1
}

// @group satori
// @summary Create a new identity.
// @param identifier(type=string) The identifier of the identity.
// @param defaultProperties(type=table, optional=true, default=nil) Default properties.
// @param customProperties(type=table, optional=true, default=nil) Custom properties.
// @param noSession(type=bool, optional=true, default=true) Whether authenticate should skip session tracking.
// @param ipAddress(type=string) An optional client IP address to pass on to Satori for geo-IP lookup.
// @return properties(table) Returned properties.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriAuthenticate(l *lua.LState) int {
	identifier := l.CheckString(1)

	defaultProperties := l.OptTable(2, nil)
	var defaultPropsMap map[string]string
	if defaultProperties != nil {
		var err error
		defaultPropsMap, err = RuntimeLuaConvertLuaTableString(defaultProperties)
		if err != nil {
			l.RaiseError("failed to convert default properties table to map: %s", err.Error())
			return 0
		}
	}

	customProperties := l.OptTable(3, nil)
	var customPropsMap map[string]string
	if customProperties != nil {
		var err error
		customPropsMap, err = RuntimeLuaConvertLuaTableString(customProperties)
		if err != nil {
			l.RaiseError("failed to convert custom properties table to map: %s", err.Error())
			return 0
		}
	}

	noSession := l.OptBool(4, true)

	ipAddress := l.OptString(5, "")

	properties, err := n.satori.Authenticate(l.Context(), identifier, defaultPropsMap, customPropsMap, noSession, ipAddress)
	if err != nil {
		l.RaiseError("failed to satori authenticate: %v", err.Error())
		return 0
	}

	propertiesTable := l.CreateTable(0, 3)
	propertiesTable.RawSetString("default", RuntimeLuaConvertMapString(l, properties.Default))
	propertiesTable.RawSetString("custom", RuntimeLuaConvertMapString(l, properties.Custom))
	propertiesTable.RawSetString("computed", RuntimeLuaConvertMapString(l, properties.Computed))

	l.Push(propertiesTable)
	return 1
}

// @group satori
// @summary Get identity properties.
// @param identifier(type=string) The identifier of the identity.
// @return properties(table) The identity properties.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriPropertiesGet(l *lua.LState) int {
	identifier := l.CheckString(1)

	props, err := n.satori.PropertiesGet(l.Context(), identifier)
	if err != nil {
		l.RaiseError("failed to satori list properties: %v", err.Error())
		return 0
	}

	propertiesTable := l.CreateTable(0, 3)
	propertiesTable.RawSetString("default", RuntimeLuaConvertMapString(l, props.Default))
	propertiesTable.RawSetString("custom", RuntimeLuaConvertMapString(l, props.Custom))
	propertiesTable.RawSetString("computed", RuntimeLuaConvertMapString(l, props.Computed))

	l.Push(propertiesTable)
	return 1
}

// @group satori
// @summary Update identity properties.
// @param identifier(type=string) The identifier of the identity.
// @param properties(type=table) The identity properties to update.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriPropertiesUpdate(l *lua.LState) int {
	identifier := l.CheckString(1)

	properties := l.CheckTable(2)
	if properties == nil {
		l.ArgError(2, "expects properties to be a table")
		return 0
	}
	propertiesValue := &runtime.PropertiesUpdate{}
	var conversionError bool
	properties.ForEach(func(k lua.LValue, v lua.LValue) {
		switch k.String() {
		case "default":
			if v.Type() != lua.LTTable {
				conversionError = true
				l.ArgError(2, "expects default values to be a table of key values and strings")
				return
			}

			defaultMap, err := RuntimeLuaConvertLuaTableString(v.(*lua.LTable))
			if err != nil {
				conversionError = true
				l.ArgError(2, fmt.Sprintf("expects default values to be a table of key values and strings: %s", err.Error()))
				return
			}
			propertiesValue.Default = defaultMap

		case "custom":
			if v.Type() != lua.LTTable {
				conversionError = true
				l.ArgError(2, "expects custom, values to be a table of key values and strings")
				return
			}

			customMap, err := RuntimeLuaConvertLuaTableString(v.(*lua.LTable))
			if err != nil {
				conversionError = true
				l.ArgError(2, fmt.Sprintf("expects custom values to be a table of key values and strings: %s", err.Error()))
				return
			}
			propertiesValue.Custom = customMap
		case "recompute":
			if v.Type() != lua.LTBool {
				conversionError = true
				l.ArgError(3, "expects recompute value to be a bool")
				return
			}
			recompute := lua.LVAsBool(v)
			propertiesValue.Recompute = &recompute
		}
	})

	if conversionError {
		return 0
	}

	if err := n.satori.PropertiesUpdate(l.Context(), identifier, propertiesValue); err != nil {
		l.RaiseError("failed to satori update properties: %v", err.Error())
		return 0
	}

	return 0
}

// @group satori
// @summary Publish events.
// @param identifier(type=string) The identifier of the identity.
// @param events(type=table) An array of events to publish.
// @param ip(type=string) Ip address.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriEventsPublish(l *lua.LState) int {
	identifier := l.CheckString(1)

	events := l.CheckTable(2)
	size := events.Len()
	eventsArray := make([]*runtime.Event, 0, size)
	conversionError := false
	events.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		eventTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of events")
			return
		}

		event := &runtime.Event{}
		eventTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "name":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(2, "expects name to be string")
					return
				}

				event.Name = v.String()
			case "id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(2, "expects id to be string")
					return
				}

				event.Id = v.String()
			case "value":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(2, "expects value to be string")
					return
				}

				event.Value = v.String()
			case "metadata":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(2, "expects metadata to be table")
					return
				}
				metadataMap, err := RuntimeLuaConvertLuaTableString(v.(*lua.LTable))
				if err != nil {
					conversionError = true
					l.ArgError(2, fmt.Sprintf("expects custom values to be a table of key values and strings: %s", err.Error()))
					return
				}

				event.Metadata = metadataMap
			case "timestamp":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(2, "expects timestamp to be a number")
					return
				}

				event.Timestamp = int64(v.(lua.LNumber))

			case "identity_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(2, "expects identity_id to be string")
					return
				}

				event.IdentityId = v.String()

			case "session_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(2, "expects session_id to be string")
					return
				}

				event.SessionId = v.String()

			case "session_issued_at":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(2, "expects session_issued_at to be a number")
					return
				}

				event.SessionIssuedAt = int64(v.(lua.LNumber))

			case "session_expires_at":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(2, "expects session_expires_at to be a number")
					return
				}

				event.SessionIssuedAt = int64(v.(lua.LNumber))
			}
		})
		if conversionError {
			return
		}

		eventsArray = append(eventsArray, event)
	})
	if conversionError {
		return 0
	}

	ip := l.OptString(3, "")

	if err := n.satori.EventsPublish(l.Context(), identifier, eventsArray, ip); err != nil {
		l.RaiseError("failed to satori publish event: %v", err.Error())
		return 0
	}

	return 0
}

// @group satori
// @summary Publish server events.
// @param events(type=table) An array of events to publish.
// @param ip(type=string) Ip address.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriServerEventsPublish(l *lua.LState) int {
	events := l.CheckTable(1)
	size := events.Len()
	eventsArray := make([]*runtime.Event, 0, size)
	conversionError := false
	events.ForEach(func(k, v lua.LValue) {
		if conversionError {
			return
		}

		eventTable, ok := v.(*lua.LTable)
		if !ok {
			conversionError = true
			l.ArgError(1, "expects a valid set of events")
			return
		}

		event := &runtime.Event{}
		eventTable.ForEach(func(k, v lua.LValue) {
			if conversionError {
				return
			}

			switch k.String() {
			case "name":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects name to be string")
					return
				}

				event.Name = v.String()
			case "id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects id to be string")
					return
				}

				event.Id = v.String()
			case "value":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects value to be string")
					return
				}

				event.Value = v.String()
			case "metadata":
				if v.Type() != lua.LTTable {
					conversionError = true
					l.ArgError(1, "expects metadata to be table")
					return
				}
				metadataMap, err := RuntimeLuaConvertLuaTableString(v.(*lua.LTable))
				if err != nil {
					conversionError = true
					l.ArgError(1, fmt.Sprintf("expects custom values to be a table of key values and strings: %s", err.Error()))
					return
				}

				event.Metadata = metadataMap
			case "timestamp":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects timestamp to be a number")
					return
				}

				event.Timestamp = int64(v.(lua.LNumber))

			case "identity_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects identity_id to be string")
					return
				}

				event.IdentityId = v.String()

			case "session_id":
				if v.Type() != lua.LTString {
					conversionError = true
					l.ArgError(1, "expects session_id to be string")
					return
				}

				event.SessionId = v.String()

			case "session_issued_at":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects session_issued_at to be a number")
					return
				}

				event.SessionIssuedAt = int64(v.(lua.LNumber))

			case "session_expires_at":
				if v.Type() != lua.LTNumber {
					conversionError = true
					l.ArgError(1, "expects session_expires_at to be a number")
					return
				}

				event.SessionIssuedAt = int64(v.(lua.LNumber))
			}
		})
		if conversionError {
			return
		}

		eventsArray = append(eventsArray, event)
	})
	if conversionError {
		return 0
	}

	ip := l.OptString(2, "")

	if err := n.satori.ServerEventsPublish(l.Context(), eventsArray, ip); err != nil {
		l.RaiseError("failed to satori publish event: %v", err.Error())
		return 0
	}

	return 0
}

// @group satori
// @summary List experiments.
// @param identifier(type=string) The identifier of the identity.
// @param names(type=table, optional=true, default=[]) Optional list of experiment names to filter.
// @return experiments(table) The experiment list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriExperimentsList(l *lua.LState) int {
	identifier := l.CheckString(1)

	names := l.OptTable(2, nil)
	namesArray := make([]string, 0)
	if names != nil {
		var conversionError bool
		names.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError {
				return
			}
			if v.Type() != lua.LTString {
				l.ArgError(1, "name filter must be a string")
				conversionError = true
				return
			}

			namesArray = append(namesArray, v.String())
		})

		if conversionError {
			return 0
		}
	}

	experiments, err := n.satori.ExperimentsList(l.Context(), identifier, namesArray...)
	if err != nil {
		l.RaiseError("failed to satori list experiments: %v", err.Error())
		return 0
	}

	experimentsTable := l.CreateTable(len(experiments.Experiments), 0)
	for i, e := range experiments.Experiments {
		experimentTable := l.CreateTable(0, 2)
		experimentTable.RawSetString("name", lua.LString(e.Name))
		experimentTable.RawSetString("value", lua.LString(e.Value))

		experimentsTable.RawSetInt(i+1, experimentTable)
	}

	l.Push(experimentsTable)
	return 1
}

// @group satori
// @summary List flags.
// @param identifier(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param names(type=table, optional=true, default=[]) Optional list of flag names to filter.
// @return flags(table) The flag list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriFlagsList(l *lua.LState) int {
	identifier := l.OptString(1, "")

	names := l.OptTable(2, nil)
	namesArray := make([]string, 0)
	if names != nil {
		var conversionError bool
		names.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError {
				return
			}
			if v.Type() != lua.LTString {
				l.ArgError(1, "name filter must be a string")
				conversionError = true
				return
			}

			namesArray = append(namesArray, v.String())
		})

		if conversionError {
			return 0
		}
	}

	flags, err := n.satori.FlagsList(l.Context(), identifier, namesArray...)
	if err != nil {
		l.RaiseError("failed to satori list flags: %v", err.Error())
		return 0
	}

	flagsTable := l.CreateTable(len(flags.Flags), 0)
	for i, f := range flags.Flags {
		flagTable := l.CreateTable(0, 3)
		flagTable.RawSetString("name", lua.LString(f.Name))
		flagTable.RawSetString("value", lua.LString(f.Value))
		flagTable.RawSetString("condition_changed", lua.LBool(f.ConditionChanged))
		if f.ValueChangeReason != nil {
			changeReasonTable := l.CreateTable(0, 3)
			changeReasonTable.RawSetString("name", lua.LString(f.ValueChangeReason.Name))
			changeReasonTable.RawSetString("variant_name", lua.LString(f.ValueChangeReason.VariantName))
			changeReasonTable.RawSetString("type", lua.LNumber(f.ValueChangeReason.Type))

			flagTable.RawSetString("change_reason", changeReasonTable)
		}

		flagsTable.RawSetInt(i+1, flagTable)
	}

	l.Push(flagsTable)
	return 1
}

// @group satori
// @summary List flags overrides.
// @param identifier(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param names(type=table, optional=true, default=[]) Optional list of flag names to filter.
// @return flagsOverrides(table) The flag list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriFlagsOverridesList(l *lua.LState) int {
	identifier := l.OptString(1, "")

	names := l.OptTable(2, nil)
	namesArray := make([]string, 0)
	if names != nil {
		var conversionError bool
		names.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError {
				return
			}
			if v.Type() != lua.LTString {
				l.ArgError(1, "name filter must be a string")
				conversionError = true
				return
			}

			namesArray = append(namesArray, v.String())
		})

		if conversionError {
			return 0
		}
	}

	flagsList, err := n.satori.FlagsOverridesList(l.Context(), identifier, namesArray...)
	if err != nil {
		l.RaiseError("failed to satori list flags: %v", err.Error())
		return 0
	}

	flagOverrides := l.CreateTable(len(flagsList.Flags), 0)
	for i, fl := range flagsList.Flags {
		overridesTable := l.CreateTable(len(fl.Overrides), 0)
		for j, o := range fl.Overrides {
			flagTable := l.CreateTable(0, 5)
			flagTable.RawSetString("name", lua.LString(o.Name))
			flagTable.RawSetString("type", lua.LNumber(o.Type))
			flagTable.RawSetString("variant_name", lua.LString(o.VariantName))
			flagTable.RawSetString("value", lua.LString(o.Value))
			flagTable.RawSetString("create_time_sec", lua.LNumber(o.CreateTimeSec))
			overridesTable.RawSetInt(j+1, flagTable)
		}
		ft := l.CreateTable(2, 0)
		ft.RawSetString("flag_name", lua.LString(fl.FlagName))
		ft.RawSetString("overrides", overridesTable)

		flagOverrides.RawSetInt(i+1, ft)
	}

	l.Push(flagOverrides)
	return 1
}

// @group satori
// @summary List live events.
// @param identifier(type=string) The identifier of the identity.
// @param names(type=table, optional=true, default=[]) Optional list of live event names to filter.
// @return liveEvents(table) The live event list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriLiveEventsList(l *lua.LState) int {
	identifier := l.CheckString(1)

	names := l.OptTable(2, nil)
	namesArray := make([]string, 0)
	if names != nil {
		var conversionError bool
		names.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError {
				return
			}
			if v.Type() != lua.LTString {
				l.ArgError(1, "name filter must be a string")
				conversionError = true
				return
			}

			namesArray = append(namesArray, v.String())
		})

		if conversionError {
			return 0
		}
	}

	liveEvents, err := n.satori.LiveEventsList(l.Context(), identifier, namesArray...)
	if err != nil {
		l.RaiseError("failed to satori list live-events: %v", err.Error())
		return 0
	}

	liveEventsTable := l.CreateTable(len(liveEvents.LiveEvents), 0)
	for i, le := range liveEvents.LiveEvents {
		liveEventTable := l.CreateTable(0, 2)
		liveEventTable.RawSetString("name", lua.LString(le.Name))
		liveEventTable.RawSetString("value", lua.LString(le.Value))
		liveEventTable.RawSetString("description", lua.LString(le.Description))
		liveEventTable.RawSetString("active_start_time", lua.LNumber(le.ActiveStartTimeSec))
		liveEventTable.RawSetString("active_time_end", lua.LNumber(le.ActiveEndTimeSec))
		liveEventTable.RawSetString("id", lua.LString(le.Id))
		liveEventTable.RawSetString("start_time", lua.LNumber(le.StartTimeSec))
		liveEventTable.RawSetString("end_time", lua.LNumber(le.EndTimeSec))
		liveEventTable.RawSetString("duration", lua.LNumber(le.DurationSec))
		liveEventTable.RawSetString("reset_cron", lua.LString(le.ResetCronExpr))

		liveEventsTable.RawSetInt(i+1, liveEventTable)
	}

	l.Push(liveEventsTable)
	return 1
}

// @group satori
// @summary List messages.
// @param identifier(type=string) The identifier of the identity.
// @param limit(type=int, optional=true, default=100) The max number of messages to return.
// @param forward(type=bool, optional=true, default=true) True if listing should be older messages to newer, false if reverse.
// @param cursor(type=string, optional=true, default="") A pagination cursor, if any.
// @return messages(type=table) The messages list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriMessagesList(l *lua.LState) int {
	identifier := l.CheckString(1)

	limit := l.OptInt(2, 100)

	forward := l.OptBool(3, false)

	cursor := l.OptString(4, "")

	messages, err := n.satori.MessagesList(l.Context(), identifier, limit, forward, cursor)
	if err != nil {
		l.RaiseError("failed to list satori messages: %v", err.Error())
		return 0
	}

	messagesTable := l.CreateTable(len(messages.Messages), 0)
	for i, m := range messages.Messages {
		messageTable := l.CreateTable(0, 11)
		messageTable.RawSetString("schedule_id", lua.LString(m.ScheduleId))
		messageTable.RawSetString("send_time", lua.LNumber(m.SendTime))
		messageTable.RawSetString("metadata", RuntimeLuaConvertValue(l, m.Metadata))
		messageTable.RawSetString("create_time", lua.LNumber(m.CreateTime))
		messageTable.RawSetString("update_time", lua.LNumber(m.UpdateTime))
		messageTable.RawSetString("read_time", lua.LNumber(m.ReadTime))
		messageTable.RawSetString("consume_time", lua.LNumber(m.ConsumeTime))
		messageTable.RawSetString("text", lua.LString(m.Text))
		messageTable.RawSetString("id", lua.LString(m.Id))
		messageTable.RawSetString("title", lua.LString(m.Title))
		messageTable.RawSetString("image_url", lua.LString(m.ImageUrl))

		messagesTable.RawSetInt(i+1, messageTable)
	}

	l.Push(messagesTable)

	if messages.NextCursor != "" {
		l.Push(lua.LString(messages.NextCursor))
	} else {
		l.Push(lua.LNil)
	}
	if messages.PrevCursor != "" {
		l.Push(lua.LString(messages.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}
	if messages.CacheableCursor != "" {
		l.Push(lua.LString(messages.PrevCursor))
	} else {
		l.Push(lua.LNil)
	}

	return 4
}

// @group satori
// @summary Update message.
// @param identifier(type=string) The identifier of the identity.
// @param messageID(type=string) The identifier of the message.
// @param readTime(type=string) The time the message was read at the client.
// @param consumeTime(type=string) The time the message was consumed by the identity.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriMessageUpdate(l *lua.LState) int {
	identifier := l.CheckString(1)

	messageID := l.CheckString(2)

	readTime := l.CheckInt64(3)

	consumeTime := l.OptInt64(4, 0)

	if err := n.satori.MessageUpdate(l.Context(), identifier, messageID, readTime, consumeTime); err != nil {
		l.RaiseError("failed to update satori message: %v", err.Error())
	}

	return 0
}

// @group satori
// @summary Delete message.
// @param identifier(type=string) The identifier of the identity.
// @param messageID(type=string) The identifier of the message.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeLuaNakamaModule) satoriMessageDelete(l *lua.LState) int {
	identifier := l.CheckString(1)

	messageID := l.CheckString(2)

	if err := n.satori.MessageDelete(l.Context(), identifier, messageID); err != nil {
		l.RaiseError("failed to delete satori message: %v", err.Error())
	}

	return 0
}

func RuntimeLuaConvertLuaTableString(vars *lua.LTable) (map[string]string, error) {
	varsMap := make(map[string]string)
	if vars != nil {
		var conversionError string
		vars.ForEach(func(k lua.LValue, v lua.LValue) {
			if conversionError != "" {
				return
			}

			if k.Type() != lua.LTString {
				conversionError = "table keys must be strings"
				return
			}
			if v.Type() != lua.LTString {
				conversionError = "table values must be strings"
				return
			}

			varsMap[k.String()] = v.String()
		})

		if conversionError != "" {
			return nil, errors.New(conversionError)
		}
	}
	return varsMap, nil
}
