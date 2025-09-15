// Copyright 2020 The Nakama Authors
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
	"strings"
	"time"
	"unicode/utf8"

	"github.com/dop251/goja"
	"github.com/gofrs/uuid/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/internal/cronexpr"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/zap"
	"golang.org/x/crypto/bcrypt"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
	"google.golang.org/protobuf/types/known/wrapperspb"
)

type RuntimeJavascriptNakamaModule struct {
	ctx                  context.Context
	logger               *zap.Logger
	config               Config
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	httpClient           *http.Client
	httpClientInsecure   *http.Client
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	rankCache            LeaderboardRankCache
	localCache           *RuntimeJavascriptLocalCache
	leaderboardScheduler LeaderboardScheduler
	tracker              Tracker
	metrics              Metrics
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	statusRegistry       StatusRegistry
	matchRegistry        MatchRegistry
	partyRegistry        PartyRegistry
	streamManager        StreamManager
	router               MessageRouter
	storageIndex         StorageIndex

	node          string
	matchCreateFn RuntimeMatchCreateFunction
	eventFn       RuntimeEventCustomFunction

	satori runtime.Satori
}

func NewRuntimeJavascriptNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, storageIndex StorageIndex, localCache *RuntimeJavascriptLocalCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, partyRegistry PartyRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, satoriClient runtime.Satori, eventFn RuntimeEventCustomFunction, matchCreateFn RuntimeMatchCreateFunction) *RuntimeJavascriptNakamaModule {
	return &RuntimeJavascriptNakamaModule{
		ctx:                  context.Background(),
		logger:               logger,
		config:               config,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		streamManager:        streamManager,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		statusRegistry:       statusRegistry,
		matchRegistry:        matchRegistry,
		partyRegistry:        partyRegistry,
		router:               router,
		tracker:              tracker,
		metrics:              metrics,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		rankCache:            rankCache,
		localCache:           localCache,
		leaderboardScheduler: leaderboardScheduler,
		httpClient:           &http.Client{},
		httpClientInsecure:   &http.Client{Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}},
		storageIndex:         storageIndex,

		node:          config.GetName(),
		eventFn:       eventFn,
		matchCreateFn: matchCreateFn,

		satori: satoriClient,
	}
}

func (n *RuntimeJavascriptNakamaModule) Constructor(r *goja.Runtime) (*goja.Object,
	error) {
	satoriJsObj, err := n.satoriConstructor(r)
	if err != nil {
		return nil, err
	}

	constructor := func(call goja.ConstructorCall) *goja.Object {
		for fnName, fn := range n.mappings(r) {
			_ = call.This.Set(fnName, fn)
		}

		_ = call.This.Set("getSatori", n.getSatori(satoriJsObj))

		return nil
	}

	return r.New(r.ToValue(constructor))
}

func (n *RuntimeJavascriptNakamaModule) mappings(r *goja.Runtime) map[string]func(goja.FunctionCall) goja.Value {
	return map[string]func(goja.FunctionCall) goja.Value{
		"event":                                n.event(r),
		"metricsCounterAdd":                    n.metricsCounterAdd(r),
		"metricsGaugeSet":                      n.metricsGaugeSet(r),
		"metricsTimerRecord":                   n.metricsTimerRecord(r),
		"uuidv4":                               n.uuidv4(r),
		"cronPrev":                             n.cronPrev(r),
		"cronNext":                             n.cronNext(r),
		"sqlExec":                              n.sqlExec(r),
		"sqlQuery":                             n.sqlQuery(r),
		"httpRequest":                          n.httpRequest(r),
		"base64Encode":                         n.base64Encode(r),
		"base64Decode":                         n.base64Decode(r),
		"base64UrlEncode":                      n.base64UrlEncode(r),
		"base64UrlDecode":                      n.base64UrlDecode(r),
		"base16Encode":                         n.base16Encode(r),
		"base16Decode":                         n.base16Decode(r),
		"jwtGenerate":                          n.jwtGenerate(r),
		"aes128Encrypt":                        n.aes128Encrypt(r),
		"aes128Decrypt":                        n.aes128Decrypt(r),
		"aes256Encrypt":                        n.aes256Encrypt(r),
		"aes256Decrypt":                        n.aes256Decrypt(r),
		"md5Hash":                              n.md5Hash(r),
		"sha256Hash":                           n.sha256Hash(r),
		"hmacSha256Hash":                       n.hmacSHA256Hash(r),
		"rsaSha256Hash":                        n.rsaSHA256Hash(r),
		"bcryptHash":                           n.bcryptHash(r),
		"bcryptCompare":                        n.bcryptCompare(r),
		"authenticateApple":                    n.authenticateApple(r),
		"authenticateCustom":                   n.authenticateCustom(r),
		"authenticateDevice":                   n.authenticateDevice(r),
		"authenticateEmail":                    n.authenticateEmail(r),
		"authenticateFacebook":                 n.authenticateFacebook(r),
		"authenticateFacebookInstantGame":      n.authenticateFacebookInstantGame(r),
		"authenticateGameCenter":               n.authenticateGameCenter(r),
		"authenticateGoogle":                   n.authenticateGoogle(r),
		"authenticateSteam":                    n.authenticateSteam(r),
		"authenticateTokenGenerate":            n.authenticateTokenGenerate(r),
		"accountGetId":                         n.accountGetId(r),
		"accountsGetId":                        n.accountsGetId(r),
		"accountUpdateId":                      n.accountUpdateId(r),
		"accountDeleteId":                      n.accountDeleteId(r),
		"accountExportId":                      n.accountExportId(r),
		"usersGetId":                           n.usersGetId(r),
		"usersGetUsername":                     n.usersGetUsername(r),
		"usersGetFriendStatus":                 n.usersGetFriendStatus(r),
		"usersGetRandom":                       n.usersGetRandom(r),
		"usersBanId":                           n.usersBanId(r),
		"usersUnbanId":                         n.usersUnbanId(r),
		"linkApple":                            n.linkApple(r),
		"linkCustom":                           n.linkCustom(r),
		"linkDevice":                           n.linkDevice(r),
		"linkEmail":                            n.linkEmail(r),
		"linkFacebook":                         n.linkFacebook(r),
		"linkFacebookInstantGame":              n.linkFacebookInstantGame(r),
		"linkGameCenter":                       n.linkGameCenter(r),
		"linkGoogle":                           n.linkGoogle(r),
		"linkSteam":                            n.linkSteam(r),
		"unlinkApple":                          n.unlinkApple(r),
		"unlinkCustom":                         n.unlinkCustom(r),
		"unlinkDevice":                         n.unlinkDevice(r),
		"unlinkEmail":                          n.unlinkEmail(r),
		"unlinkFacebook":                       n.unlinkFacebook(r),
		"unlinkFacebookInstantGame":            n.unlinkFacebookInstantGame(r),
		"unlinkGameCenter":                     n.unlinkGameCenter(r),
		"unlinkGoogle":                         n.unlinkGoogle(r),
		"unlinkSteam":                          n.unlinkSteam(r),
		"streamUserList":                       n.streamUserList(r),
		"streamUserGet":                        n.streamUserGet(r),
		"streamUserJoin":                       n.streamUserJoin(r),
		"streamUserUpdate":                     n.streamUserUpdate(r),
		"streamUserLeave":                      n.streamUserLeave(r),
		"streamUserKick":                       n.streamUserKick(r),
		"streamCount":                          n.streamCount(r),
		"streamClose":                          n.streamClose(r),
		"streamSend":                           n.streamSend(r),
		"streamSendRaw":                        n.streamSendRaw(r),
		"sessionDisconnect":                    n.sessionDisconnect(r),
		"sessionLogout":                        n.sessionLogout(r),
		"matchCreate":                          n.matchCreate(r),
		"matchGet":                             n.matchGet(r),
		"matchList":                            n.matchList(r),
		"matchSignal":                          n.matchSignal(r),
		"notificationSend":                     n.notificationSend(r),
		"notificationSendAll":                  n.notificationSendAll(r),
		"notificationsList":                    n.notificationsList(r),
		"notificationsSend":                    n.notificationsSend(r),
		"notificationsDelete":                  n.notificationsDelete(r),
		"notificationsUpdate":                  n.notificationsUpdate(r),
		"notificationsGetId":                   n.notificationsGetId(r),
		"notificationsDeleteId":                n.notificationsDeleteId(r),
		"walletUpdate":                         n.walletUpdate(r),
		"walletsUpdate":                        n.walletsUpdate(r),
		"walletLedgerUpdate":                   n.walletLedgerUpdate(r),
		"walletLedgerList":                     n.walletLedgerList(r),
		"statusFollow":                         n.statusFollow(r),
		"statusUnfollow":                       n.statusUnfollow(r),
		"storageList":                          n.storageList(r),
		"storageRead":                          n.storageRead(r),
		"storageWrite":                         n.storageWrite(r),
		"storageDelete":                        n.storageDelete(r),
		"multiUpdate":                          n.multiUpdate(r),
		"leaderboardCreate":                    n.leaderboardCreate(r),
		"leaderboardDelete":                    n.leaderboardDelete(r),
		"leaderboardList":                      n.leaderboardList(r),
		"leaderboardRanksDisable":              n.leaderboardRanksDisable(r),
		"leaderboardRecordsList":               n.leaderboardRecordsList(r),
		"leaderboardRecordsListCursorFromRank": n.leaderboardRecordsListCursorFromRank(r),
		"leaderboardRecordWrite":               n.leaderboardRecordWrite(r),
		"leaderboardRecordDelete":              n.leaderboardRecordDelete(r),
		"leaderboardsGetId":                    n.leaderboardsGetId(r),
		"leaderboardRecordsHaystack":           n.leaderboardRecordsHaystack(r),
		"purchaseValidateApple":                n.purchaseValidateApple(r),
		"purchaseValidateGoogle":               n.purchaseValidateGoogle(r),
		"purchaseValidateHuawei":               n.purchaseValidateHuawei(r),
		"purchaseValidateFacebookInstant":      n.purchaseValidateFacebookInstant(r),
		"purchaseGetByTransactionId":           n.purchaseGetByTransactionId(r),
		"purchasesList":                        n.purchasesList(r),
		"subscriptionValidateApple":            n.subscriptionValidateApple(r),
		"subscriptionValidateGoogle":           n.subscriptionValidateGoogle(r),
		"subscriptionGetByProductId":           n.subscriptionGetByProductId(r),
		"subscriptionsList":                    n.subscriptionsList(r),
		"tournamentCreate":                     n.tournamentCreate(r),
		"tournamentDelete":                     n.tournamentDelete(r),
		"tournamentAddAttempt":                 n.tournamentAddAttempt(r),
		"tournamentJoin":                       n.tournamentJoin(r),
		"tournamentList":                       n.tournamentList(r),
		"tournamentsRanksDisable":              n.tournamentRanksDisable(r),
		"tournamentsGetId":                     n.tournamentsGetId(r),
		"tournamentRecordsList":                n.tournamentRecordsList(r),
		"tournamentRecordWrite":                n.tournamentRecordWrite(r),
		"tournamentRecordDelete":               n.tournamentRecordDelete(r),
		"tournamentRecordsHaystack":            n.tournamentRecordsHaystack(r),
		"groupsGetId":                          n.groupsGetId(r),
		"groupCreate":                          n.groupCreate(r),
		"groupUpdate":                          n.groupUpdate(r),
		"groupDelete":                          n.groupDelete(r),
		"groupUsersKick":                       n.groupUsersKick(r),
		"groupUsersList":                       n.groupUsersList(r),
		"userGroupsList":                       n.userGroupsList(r),
		"friendsList":                          n.friendsList(r),
		"friendsOfFriendsList":                 n.friendsOfFriendsList(r),
		"friendsAdd":                           n.friendsAdd(r),
		"friendsDelete":                        n.friendsDelete(r),
		"friendsBlock":                         n.friendsBlock(r),
		"friendMetadataUpdate":                 n.friendMetadataUpdate(r),
		"groupUserJoin":                        n.groupUserJoin(r),
		"groupUserLeave":                       n.groupUserLeave(r),
		"groupUsersAdd":                        n.groupUsersAdd(r),
		"groupUsersBan":                        n.groupUsersBan(r),
		"groupUsersPromote":                    n.groupUsersPromote(r),
		"groupUsersDemote":                     n.groupUsersDemote(r),
		"groupsList":                           n.groupsList(r),
		"groupsGetRandom":                      n.groupsGetRandom(r),
		"fileRead":                             n.fileRead(r),
		"localcacheGet":                        n.localcacheGet(r),
		"localcachePut":                        n.localcachePut(r),
		"localcacheDelete":                     n.localcacheDelete(r),
		"localcacheClear":                      n.localcacheClear(r),
		"channelMessageSend":                   n.channelMessageSend(r),
		"channelMessageUpdate":                 n.channelMessageUpdate(r),
		"channelMessageRemove":                 n.channelMessageRemove(r),
		"channelMessagesList":                  n.channelMessagesList(r),
		"channelIdBuild":                       n.channelIdBuild(r),
		"binaryToString":                       n.binaryToString(r),
		"stringToBinary":                       n.stringToBinary(r),
		"storageIndexList":                     n.storageIndexList(r),
		"partyList":                            n.partyList(r),
	}
}

// @group utils
// @summary Convert binary data to string.
// @param data(type=ArrayBuffer) The binary data to be converted.
// @return result(string) The resulting string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) binaryToString(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if goja.IsUndefined(f.Argument(0)) || goja.IsNull(f.Argument(0)) {
			panic(r.NewTypeError("expects a ArrayBuffer object"))
		}

		data, ok := f.Argument(0).Export().(goja.ArrayBuffer)
		if !ok {
			panic(r.NewTypeError("expects a ArrayBuffer object"))
		}

		if !utf8.Valid(data.Bytes()) {
			panic(r.NewTypeError("expects data to be UTF-8 encoded"))
		}

		return r.ToValue(string(data.Bytes()))
	}
}

// @group utils
// @summary Convert string data to binary.
// @param str(type=string) The string to be converted.
// @return result(ArrayBuffer) The resulting binary data.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) stringToBinary(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if goja.IsUndefined(f.Argument(0)) || goja.IsNull(f.Argument(0)) {
			panic(r.NewTypeError("expects a string"))
		}

		str, ok := f.Argument(0).Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a string"))
		}

		return r.ToValue(r.NewArrayBuffer([]byte(str)))
	}
}

// @group storage
// @summary List storage index entries
// @param indexName(type=string) Name of the index to list entries from.
// @param query(type=string) Query to filter index entries.
// @param limit(type=int) Maximum number of results to be returned.
// @param order(type=[]string, optional=true) The storage object fields to sort the query results by. The prefix '-' before a field name indicates descending order. All specified fields must be indexed and sortable.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @param cursor(type=string, optional=true) A cursor to fetch the next page of results.
// @return objects(nkruntime.StorageIndexResult) A list of storage objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) storageIndexList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		indexName := getJsString(r, f.Argument(0))
		query := getJsString(r, f.Argument(1))
		limit := 100
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			limit = int(getJsInt(r, f.Argument(2)))
			if limit < 1 || limit > 10_000 {
				panic(r.NewTypeError("limit must be 1-10000"))
			}
		}

		var err error
		orderArray := make([]string, 0)
		order := f.Argument(3)
		if !goja.IsUndefined(order) && !goja.IsNull(order) {
			orderArray, err = exportToSlice[[]string](order)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			callerID := getJsString(r, f.Argument(4))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		var cursor string
		if !goja.IsUndefined(f.Argument(5)) && !goja.IsNull(f.Argument(5)) {
			cursor = getJsString(r, f.Argument(5))
		}

		objectList, newCursor, err := n.storageIndex.List(n.ctx, callerIDValue, indexName, query, int(limit), orderArray, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to lookup storage index: %s", err.Error())))
		}

		objects := make([]any, 0, len(objectList.Objects))
		for _, o := range objectList.Objects {
			obj := r.NewObject()
			_ = obj.Set("key", o.Key)
			_ = obj.Set("collection", o.Collection)
			if o.UserId != "" {
				_ = obj.Set("userId", o.UserId)
			} else {
				_ = obj.Set("userId", nil)
			}
			_ = obj.Set("version", o.Version)
			_ = obj.Set("permissionRead", o.PermissionRead)
			_ = obj.Set("permissionWrite", o.PermissionWrite)
			_ = obj.Set("createTime", o.CreateTime.Seconds)
			_ = obj.Set("updateTime", o.UpdateTime.Seconds)

			valueMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(o.Value), &valueMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert value to json: %s", err.Error())))
			}
			pointerizeSlices(valueMap)
			_ = obj.Set("value", valueMap)

			objects = append(objects, obj)
		}

		outObj := r.NewObject()
		_ = outObj.Set("objects", r.NewArray(objects...))
		if newCursor != "" {
			_ = outObj.Set("cursor", newCursor)
		} else {
			_ = outObj.Set("cursor", goja.Null())
		}

		return r.ToValue(outObj)
	}
}

// @group parties
// @summary List existing realtime parties and filter them by open or a query based on the set label.
// @param limit(type=number, optional=true, default=10) The maximum number of parties to list.
// @param open(type=bool, optional=true, default=null) Filter open or closed parties. If null, both open and closed parties are returned.
// @param query(type=string, optional=true) Additional query parameters to shortlist parties.
// @param cursor(type=string, optional=true) A cursor to fetch the next page of results.
// @return parties(nkruntime.Party[]) A list of parties matching the filtering criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) partyList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		limit := 10
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(0)))
		}
		if limit < 1 || limit > 100 {
			panic(r.NewTypeError("limit must be 1-100"))
		}

		var open *bool
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			open = new(bool)
			*open = getJsBool(r, f.Argument(1))
		}

		showHidden := getJsBool(r, f.Argument(2))

		var query string
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			query = getJsString(r, f.Argument(3))
		}

		var cursor string
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			cursor = getJsString(r, f.Argument(4))
		}

		results, cursor, err := n.partyRegistry.PartyList(n.ctx, limit, open, showHidden, query, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list parties: %s", err.Error())))
		}

		parties := make([]any, 0, len(results))
		for _, party := range results {
			partyData := map[string]any{
				"partyId": party.PartyId,
				"open":    party.Open,
				"maxSize": party.MaxSize,
				"label":   party.Label,
			}

			parties = append(parties, partyData)
		}

		partyList := r.NewObject()
		_ = partyList.Set("parties", r.NewArray(parties...))
		if cursor != "" {
			_ = partyList.Set("cursor", cursor)
		}

		return r.ToValue(partyList)
	}
}

// @group events
// @summary Generate an event.
// @param eventName(type=string) The name of the event to be created.
// @param properties(type=[]string) An array of event properties.
// @param epoch(type=int, optional=true) Timestamp in seconds for when event is created.
// @param external(type=bool, optional=true, default=false) Whether the event is external.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) event(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		eventName := getJsString(r, f.Argument(0))
		properties := getJsStringMap(r, f.Argument(1))
		ts := &timestamppb.Timestamp{}
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			epoch := getJsInt(r, f.Argument(2))
			ts.Seconds = epoch
		} else {
			ts.Seconds = time.Now().Unix()
		}
		external := false
		if f.Argument(3) != goja.Undefined() {
			external = getJsBool(r, f.Argument(3))
		}

		if n.eventFn != nil {
			n.eventFn(n.ctx, &api.Event{
				Name:       eventName,
				Properties: properties,
				Timestamp:  ts,
				External:   external,
			})
		}

		return goja.Undefined()
	}
}

// @group metrics
// @summary Add a custom metrics counter.
// @param name(type=string) The name of the custom metrics counter.
// @param tags(type=map[string]string) The metrics tags associated with this counter.
// @param delta(type=number) An integer value to update this metric with.
func (n *RuntimeJavascriptNakamaModule) metricsCounterAdd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		name := getJsString(r, f.Argument(0))
		tags := getJsStringMap(r, f.Argument(1))
		delta := getJsInt(r, f.Argument(2))
		n.metrics.CustomCounter(name, tags, delta)

		return goja.Undefined()
	}
}

// @group metrics
// @summary Add a custom metrics gauge.
// @param name(type=string) The name of the custom metrics gauge.
// @param tags(type=map[string]string) The metrics tags associated with this gauge.
// @param value(type=number) A value to update this metric with.
func (n *RuntimeJavascriptNakamaModule) metricsGaugeSet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		name := getJsString(r, f.Argument(0))
		tags := getJsStringMap(r, f.Argument(1))
		value := getJsFloat(r, f.Argument(2))
		n.metrics.CustomGauge(name, tags, value)

		return goja.Undefined()
	}
}

// @group metrics
// @summary Add a custom metrics timer.
// @param name(type=string) The name of the custom metrics timer.
// @param tags(type=map[string]string) The metrics tags associated with this timer.
// @param value(type=number) An integer value to update this metric with (in nanoseconds).
func (n *RuntimeJavascriptNakamaModule) metricsTimerRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		name := getJsString(r, f.Argument(0))
		tags := getJsStringMap(r, f.Argument(1))
		value := getJsInt(r, f.Argument(2))
		n.metrics.CustomTimer(name, tags, time.Duration(value))

		return goja.Undefined()
	}
}

// @group utils
// @summary Generate a version 4 UUID in the standard 36-character string representation.
// @return uuid(string) The newly generated version 4 UUID identifier string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) uuidv4(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		return r.ToValue(uuid.Must(uuid.NewV4()).String())
	}
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the next matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=number) A time value expressed as UTC seconds.
// @return next_ts(number) The next UTC seconds timestamp (number) that matches the given CRON expression, and is immediately after the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) cronNext(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		expression := getJsString(r, f.Argument(0))
		timestamp := getJsInt(r, f.Argument(1))

		expr, err := cronexpr.Parse(expression)
		if err != nil {
			panic(r.NewTypeError("expects a valid cron string"))
		}

		t := time.Unix(timestamp, 0).UTC()
		next := expr.Next(t)
		nextTs := next.UTC().Unix()

		return r.ToValue(nextTs)
	}
}

// @group utils
// @summary Parses a CRON expression and a timestamp in UTC seconds, and returns the previous matching timestamp in UTC seconds.
// @param expression(type=string) A valid CRON expression in standard format, for example "0 0 * * *" (meaning at midnight).
// @param timestamp(type=number) A time value expressed as UTC seconds.
// @return prev_ts(number) The previous UTC seconds timestamp (number) that matches the given CRON expression, and is immediately before the given timestamp.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) cronPrev(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		expression := getJsString(r, f.Argument(0))
		timestamp := getJsInt(r, f.Argument(1))

		expr, err := cronexpr.Parse(expression)
		if err != nil {
			panic(r.NewTypeError("expects a valid cron string"))
		}

		t := time.Unix(timestamp, 0).UTC()
		next := expr.Last(t)
		nextTs := next.UTC().Unix()

		return r.ToValue(nextTs)
	}
}

// @group utils
// @summary Execute an arbitrary SQL query and return the number of rows affected. Typically, an "INSERT", "DELETE", or "UPDATE" statement with no return columns.
// @param query(type=string) A SQL query to execute.
// @param args(type=any[]) Arbitrary parameters to pass to placeholders in the query.
// @return rowsAffected(number) A list of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) sqlExec(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		query := getJsString(r, f.Argument(0))
		var args []interface{}
		if f.Argument(1) == goja.Undefined() {
			args = make([]interface{}, 0)
		} else {
			var ok bool
			args, ok = f.Argument(1).Export().([]any)
			if !ok {
				panic(r.NewTypeError("expects array of query params"))
			}
		}

		var res sql.Result
		var err error
		err = ExecuteRetryable(func() error {
			res, err = n.db.ExecContext(n.ctx, query, args...)
			return err
		})
		if err != nil {
			n.logger.Error("Failed to exec db query.", zap.String("query", query), zap.Any("args", args), zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to exec db query: %s", err.Error())))
		}

		nRowsAffected, _ := res.RowsAffected()

		return r.ToValue(
			map[string]interface{}{
				"rowsAffected": nRowsAffected,
			},
		)
	}
}

// @group utils
// @summary Execute an arbitrary SQL query that is expected to return row data. Typically a "SELECT" statement.
// @param query(type=string) A SQL query to execute.
// @param args(type=any[]) Arbitrary parameters to pass to placeholders in the query.
// @return result(nkruntime.SqlQueryResult) An array of rows and the respective columns and values.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) sqlQuery(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		query := getJsString(r, f.Argument(0))
		var args []interface{}
		if f.Argument(1) == goja.Undefined() {
			args = make([]interface{}, 0)
		} else {
			var ok bool
			args, ok = f.Argument(1).Export().([]any)
			if !ok {
				panic(r.NewTypeError("expects array of query params"))
			}
		}

		var rows *sql.Rows
		var err error
		err = ExecuteRetryable(func() error {
			rows, err = n.db.QueryContext(n.ctx, query, args...)
			return err
		})
		if err != nil {
			n.logger.Error("Failed to exec db query.", zap.String("query", query), zap.Any("args", args), zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to exec db query: %s", err.Error())))
		}
		defer rows.Close()

		rowColumns, err := rows.Columns()
		if err != nil {
			n.logger.Error("Failed to get row columns.", zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to get row columns: %s", err.Error())))
		}
		rowsColumnCount := len(rowColumns)
		resultRows := make([]*[]interface{}, 0)
		for rows.Next() {
			resultRowValues := make([]interface{}, rowsColumnCount)
			resultRowPointers := make([]interface{}, rowsColumnCount)
			for i := range resultRowValues {
				resultRowPointers[i] = &resultRowValues[i]
			}
			if err = rows.Scan(resultRowPointers...); err != nil {
				n.logger.Error("Failed to scan row results.", zap.Error(err))
				panic(r.NewGoError(fmt.Errorf("failed to scan row results: %s", err.Error())))
			}
			resultRows = append(resultRows, &resultRowValues)
		}
		if err = rows.Err(); err != nil {
			n.logger.Error("Failed scan rows.", zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to scan rows: %s", err.Error())))
		}

		results := make([]map[string]interface{}, 0, len(resultRows))
		for _, row := range resultRows {
			resultRow := make(map[string]interface{}, rowsColumnCount)
			for i, col := range rowColumns {
				resultRow[col] = (*row)[i]
			}
			results = append(results, resultRow)
		}

		return r.ToValue(results)
	}
}

// @group utils
// @summary Send an HTTP request that returns a data type containing the result of the HTTP response.
// @param url(type=string) The URL of the web resource to request.
// @param method(type=string) The HTTP method verb used with the request.
// @param headers(type=string) A table of headers used with the request.
// @param body(type=string) The bytes to send with the request.
// @param timeout(type=number, optional=true, default=5000) Timeout of the request in milliseconds.
// @param insecure(type=bool, optional=true, default=false) Set to true to skip request TLS validations.
// @return returnVal(nkruntime.httpResponse) Code, Headers, and Body response values for the HTTP response.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) httpRequest(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		url := getJsString(r, f.Argument(0))
		method := strings.ToUpper(getJsString(r, f.Argument(1)))

		headers := make(map[string]string)
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			headers = getJsStringMap(r, f.Argument(2))
		}

		var body string
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			body = getJsString(r, f.Argument(3))
		}

		var timeoutMs int64
		timeout := f.Argument(4)
		if timeout != goja.Undefined() && timeout != goja.Null() {
			timeoutMs = getJsInt(r, timeout)
		}
		if timeoutMs <= 0 {
			timeoutMs = 5_000
		}

		var insecure bool
		if !goja.IsUndefined(f.Argument(5)) && !goja.IsNull(f.Argument(5)) {
			insecure = getJsBool(r, f.Argument(5))
		}

		if url == "" {
			panic(r.NewTypeError("URL string cannot be empty."))
		}

		switch method {
		case http.MethodGet:
		case http.MethodPost:
		case http.MethodPut:
		case http.MethodPatch:
		case http.MethodDelete:
		case http.MethodHead:
		default:
			panic(r.NewTypeError("Invalid method must be one of: 'get', 'post', 'put', 'patch', 'delete', 'head'."))
		}

		var requestBody io.Reader
		if body != "" {
			requestBody = strings.NewReader(body)
		}

		ctx, ctxCancelFn := context.WithTimeout(n.ctx, time.Duration(timeoutMs)*time.Millisecond)
		defer ctxCancelFn()

		req, err := http.NewRequestWithContext(ctx, method, url, requestBody)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("HTTP request is invalid: %v", err.Error())))
		}

		for h, v := range headers {
			// TODO accept multiple values
			req.Header.Add(h, v)
		}

		var resp *http.Response
		if insecure {
			resp, err = n.httpClientInsecure.Do(req)
		} else {
			resp, err = n.httpClient.Do(req)
		}
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("HTTP request error: %v", err.Error())))
		}

		// Read the response body.
		responseBody, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("HTTP response body error: %v", err.Error())))
		}
		respHeaders := make(map[string][]string, len(resp.Header))
		for h, v := range resp.Header {
			respHeaders[h] = v
		}

		returnVal := map[string]interface{}{
			"code":    resp.StatusCode,
			"headers": respHeaders,
			"body":    string(responseBody),
		}

		return r.ToValue(returnVal)
	}
}

// @group utils
// @summary Base64 encode a string or ArrayBuffer input.
// @param input(type=string) The string which will be base64 encoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return out(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base64Encode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if goja.IsUndefined(f.Argument(0)) || goja.IsNull(f.Argument(0)) {
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		var in []byte
		switch input := f.Argument(0).Export(); input.(type) {
		case string:
			in = []byte(input.(string))
		case goja.ArrayBuffer:
			in = input.(goja.ArrayBuffer).Bytes()
		default:
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		e := base64.StdEncoding
		if !padding {
			e = base64.RawStdEncoding
		}

		out := e.EncodeToString(in)
		return r.ToValue(out)
	}
}

// @group utils
// @summary Decode a base64 encoded string.
// @param input(type=string) The string which will be base64 decoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return out(ArrayBuffer) Decoded data.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base64Decode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		if padding {
			// Pad string up to length multiple of 4 if needed to effectively make padding optional.
			if maybePad := len(input) % 4; maybePad != 0 {
				input += strings.Repeat("=", 4-maybePad)
			}
		}

		out, err := base64.StdEncoding.DecodeString(input)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", input)))
		}
		return r.ToValue(r.NewArrayBuffer(out))
	}
}

// @group utils
// @summary Base64 URL encode a string or ArrayBuffer input.
// @param input(type=string) The string which will be base64 URL encoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return out(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base64UrlEncode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if goja.IsUndefined(f.Argument(0)) || goja.IsNull(f.Argument(0)) {
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		var in []byte
		switch input := f.Argument(0).Export(); input.(type) {
		case string:
			in = []byte(input.(string))
		case goja.ArrayBuffer:
			in = input.(goja.ArrayBuffer).Bytes()
		default:
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		e := base64.URLEncoding
		if !padding {
			e = base64.RawURLEncoding
		}

		out := e.EncodeToString(in)
		return r.ToValue(out)
	}
}

// @group utils
// @summary Decode a base64 URL encoded string.
// @param input(type=string) The string to be decoded.
// @param padding(type=bool, optional=true, default=true) Pad the string if padding is missing.
// @return out(ArrayBuffer) Decoded data.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base64UrlDecode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		if !padding {
			// Pad string up to length multiple of 4 if needed to effectively make padding optional.
			if maybePad := len(input) % 4; maybePad != 0 {
				input += strings.Repeat("=", 4-maybePad)
			}
		}

		out, err := base64.URLEncoding.DecodeString(input)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", input)))
		}
		return r.ToValue(r.NewArrayBuffer(out))
	}
}

// @group utils
// @summary base16 encode a string or ArrayBuffer input.
// @param input(type=string) The string to be encoded.
// @return out(string) Encoded string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base16Encode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if goja.IsUndefined(f.Argument(0)) || goja.IsNull(f.Argument(0)) {
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		var in []byte
		switch input := f.Argument(0).Export(); input.(type) {
		case string:
			in = []byte(input.(string))
		case goja.ArrayBuffer:
			in = input.(goja.ArrayBuffer).Bytes()
		default:
			panic(r.NewTypeError("expects a string or ArrayBuffer object"))
		}

		out := hex.EncodeToString(in)
		return r.ToValue(out)
	}
}

// @group utils
// @summary Decode a base16 encoded string.
// @param input(type=string) The string to be decoded.
// @return out(ArrayBuffer) Decoded data.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) base16Decode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))

		out, err := hex.DecodeString(input)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", input)))
		}
		return r.ToValue(r.NewArrayBuffer(out))
	}
}

// @group utils
// @summary Generate a JSON Web Token.
// @param signingMethod(type=string) The signing method to be used, either HS256 or RS256.
// @param signingKey(type=string) The signing key to be used.
// @param claims(type=[]string) The JWT payload.
// @return signedToken(string) The newly generated JWT.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) jwtGenerate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		signingMethod := getJsString(r, f.Argument(0))

		var signingMethodValue jwt.SigningMethod
		switch signingMethod {
		case "HS256":
			signingMethodValue = jwt.SigningMethodHS256
		case "RS256":
			signingMethodValue = jwt.SigningMethodRS256
		default:
			panic(r.NewTypeError("unsupported algo type - only allowed 'HS256', 'RS256'."))
		}

		signingKey := getJsString(r, f.Argument(1))
		if signingKey == "" {
			panic(r.NewTypeError("signing key cannot be empty"))
		}

		if f.Argument(1) == goja.Undefined() {
			panic(r.NewTypeError("claims argument is required"))
		}

		claims, ok := f.Argument(2).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("claims must be an object"))
		}
		jwtClaims := jwt.MapClaims{}
		for k, v := range claims {
			jwtClaims[k] = v
		}

		var pk interface{}
		switch signingMethodValue {
		case jwt.SigningMethodRS256:
			block, _ := pem.Decode([]byte(signingKey))
			if block == nil {
				panic(r.NewGoError(errors.New("could not parse private key: no valid blocks found")))
			}

			var err error
			pk, err = x509.ParsePKCS8PrivateKey(block.Bytes)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("could not parse private key: %v", err.Error())))
			}
		case jwt.SigningMethodHS256:
			pk = []byte(signingKey)
		}

		token := jwt.NewWithClaims(signingMethodValue, jwtClaims)
		signedToken, err := token.SignedString(pk)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to sign token: %v", err.Error())))
		}

		return r.ToValue(signedToken)
	}
}

// @group utils
// @summary aes128 encrypt a string input.
// @param input(type=string) The string which will be aes128 encrypted.
// @param key(type=string) The 16 Byte encryption key.
// @return cipherText(string) The ciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aes128Encrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))

		cipherText, err := n.aesEncrypt(16, input, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(cipherText)
	}
}

// @group utils
// @summary Decrypt an aes128 encrypted string.
// @param input(type=string) The string to be decrypted.
// @param key(type=string) The 16 Byte decryption key.
// @return clearText(string) The deciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aes128Decrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))

		clearText, err := n.aesDecrypt(16, input, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(clearText)
	}
}

// @group utils
// @summary aes256 encrypt a string input.
// @param input(type=string) The string which will be aes256 encrypted.
// @param key(type=string) The 32 Byte encryption key.
// @return cipherText(string) The ciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aes256Encrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))

		cipherText, err := n.aesEncrypt(32, input, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(cipherText)
	}
}

// @group utils
// @summary Decrypt an aes256 encrypted string.
// @param input(type=string) The string to be decrypted.
// @param key(type=string) The 32 Byte decryption key.
// @return clearText(string) The deciphered input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aes256Decrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))

		clearText, err := n.aesDecrypt(32, input, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(clearText)
	}
}

// @group utils
// @summary aes encrypt a string input and return the cipher text base64 encoded.
// @param keySize(type=int) The size in bytes of the encryption key.
// @param input(type=string) The string which will be encrypted.
// @param key(type=string) The encryption key.
// @return cipherText(string) The ciphered and base64 encoded input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aesEncrypt(keySize int, input, key string) (string, error) {
	if len(key) != keySize {
		return "", fmt.Errorf("expects key %v bytes long", keySize)
	}

	// Pad string up to length multiple of 4 if needed.
	if maybePad := len(input) % 4; maybePad != 0 {
		input += strings.Repeat(" ", 4-maybePad)
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", fmt.Errorf("error creating cipher block: %v", err.Error())
	}

	cipherText := make([]byte, aes.BlockSize+len(input))
	iv := cipherText[:aes.BlockSize]
	if _, err = io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("error getting iv: %v", err.Error())
	}

	stream := cipher.NewCFBEncrypter(block, iv) //nolint:staticcheck
	stream.XORKeyStream(cipherText[aes.BlockSize:], []byte(input))

	return base64.StdEncoding.EncodeToString(cipherText), nil
}

// @group utils
// @summary aes decrypt a base 64 encoded string input.
// @param keySize(type=int) The size in bytes of the decryption key.
// @param input(type=string) The string which will be decrypted.
// @param key(type=string) The encryption key.
// @return clearText(string) The deciphered and decoded input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) aesDecrypt(keySize int, input, key string) (string, error) {
	if len(key) != keySize {
		return "", fmt.Errorf("expects key %v bytes long", keySize)
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", fmt.Errorf("error creating cipher block: %v", err.Error())
	}

	decodedtText, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		return "", fmt.Errorf("error decoding cipher text: %v", err.Error())
	}
	cipherText := decodedtText
	iv := cipherText[:aes.BlockSize]
	cipherText = cipherText[aes.BlockSize:]

	stream := cipher.NewCFBDecrypter(block, iv) //nolint:staticcheck
	stream.XORKeyStream(cipherText, cipherText)

	return string(cipherText), nil
}

// @group utils
// @summary Create an md5 hash from the input.
// @param input(type=string) The input string to hash.
// @return hash(string) A string with the md5 hash of the input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) md5Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))

		hash := fmt.Sprintf("%x", md5.Sum([]byte(input)))

		return r.ToValue(hash)
	}
}

// @group utils
// @summary Create an SHA256 hash from the input.
// @param input(type=string) The input string to hash.
// @return hash(string) A string with the SHA256 hash of the input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) sha256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))

		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(input)))

		return r.ToValue(hash)
	}
}

// @group utils
// @summary Create a RSA encrypted SHA256 hash from the input.
// @param input(type=string) The input string to hash.
// @param key(type=string) The RSA private key.
// @return signature(string) A string with the RSA encrypted SHA256 hash of the input.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) rsaSHA256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))
		if key == "" {
			panic(r.NewTypeError("key cannot be empty"))
		}

		block, _ := pem.Decode([]byte(key))
		if block == nil {
			panic(r.NewGoError(errors.New("could not parse private key: no valid blocks found")))
		}
		rsaPrivateKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error parsing key: %v", err.Error())))
		}

		hashed := sha256.Sum256([]byte(input))
		signature, err := rsa.SignPKCS1v15(rand.Reader, rsaPrivateKey, crypto.SHA256, hashed[:])
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error signing input: %v", err.Error())))
		}

		return r.ToValue(string(signature))
	}
}

// @group utils
// @summary Create a HMAC-SHA256 hash from input and key.
// @param input(type=string) The input string to hash.
// @param key(type=string) The hashing key.
// @return mac(string) Hashed input as a string using the key.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) hmacSHA256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		key := getJsString(r, f.Argument(1))
		if key == "" {
			panic(r.NewTypeError("key cannot be empty"))
		}

		mac := hmac.New(sha256.New, []byte(key))
		_, err := mac.Write([]byte(input))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating hash: %v", err.Error())))
		}

		return r.ToValue(r.NewArrayBuffer(mac.Sum(nil)))
	}
}

// @group utils
// @summary Generate one-way hashed string using bcrypt.
// @param input(type=string) The input string to bcrypt.
// @return hash(string) Hashed string.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) bcryptHash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		hash, err := bcrypt.GenerateFromPassword([]byte(input), bcrypt.DefaultCost)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error hashing input: %v", err.Error())))
		}

		return r.ToValue(string(hash))
	}
}

// @group utils
// @summary Compare hashed input against a plaintext input.
// @param input(type=string) The bcrypted input string.
// @param plaintext(type=string) Plaintext input to compare against.
// @return result(bool) True if they are the same, false otherwise.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) bcryptCompare(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		if input == "" {
			panic(r.NewTypeError("hash cannot be empty"))
		}

		plaintext := getJsString(r, f.Argument(1))
		if plaintext == "" {
			panic(r.NewTypeError("plaintext cannot be empty"))
		}

		err := bcrypt.CompareHashAndPassword([]byte(input), []byte(plaintext))
		switch {
		case err == nil:
			return r.ToValue(true)
		case errors.Is(err, bcrypt.ErrHashTooShort), errors.Is(err, bcrypt.ErrMismatchedHashAndPassword):
			return r.ToValue(false)
		default:
			panic(r.NewGoError(fmt.Errorf("error comparing hash and plaintext: %v", err.Error())))
		}
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using an Apple sign in token.
// @param token(type=string) Apple sign in token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetSocial().Apple.BundleId == "" {
			panic(r.NewGoError(errors.New("Apple authentication is not configured")))
		}

		token := getJsString(r, f.Argument(0))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}

		username := ""
		if f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(2) != goja.Undefined() {
			create = getJsBool(r, f.Argument(2))
		}

		dbUserID, dbUsername, created, err := AuthenticateApple(n.ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().Apple.BundleId, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a custom authentication managed by an external service or source not already supported by Nakama.
// @param id(type=string) Custom ID to use to authenticate the user. Must be between 6-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects id string"))
		} else if invalidCharsRegex.MatchString(id) {
			panic(r.NewTypeError("expects id to be valid, no spaces or control characters allowed"))
		} else if len(id) < 6 || len(id) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 6-128 bytes"))
		}

		username := ""
		if f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(2) != goja.Undefined() {
			create = getJsBool(r, f.Argument(2))
		}

		dbUserID, dbUsername, created, err := AuthenticateCustom(n.ctx, n.logger, n.db, id, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a device identifier.
// @param id(type=string) Device ID to use to authenticate the user. Must be between 1-128 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects id string"))
		} else if invalidCharsRegex.MatchString(id) {
			panic(r.NewTypeError("expects id to be valid, no spaces or control characters allowed"))
		} else if len(id) < 10 || len(id) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 10-128 bytes"))
		}

		username := ""
		if f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(2) != goja.Undefined() {
			create = getJsBool(r, f.Argument(2))
		}

		dbUserID, dbUsername, created, err := AuthenticateDevice(n.ctx, n.logger, n.db, id, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using an email address and password.
// @param email(type=string) Email address to use to authenticate the user. Must be between 10-255 characters.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var attemptUsernameLogin bool
		// Parse email.
		email := getJsString(r, f.Argument(0))
		if email == "" {
			attemptUsernameLogin = true
		} else if invalidCharsRegex.MatchString(email) {
			panic(r.NewTypeError("expects email to be valid, no spaces or control characters allowed"))
		} else if !emailRegex.MatchString(email) {
			panic(r.NewTypeError("expects email to be valid, invalid email address format"))
		} else if len(email) < 10 || len(email) > 255 {
			panic(r.NewTypeError("expects email to be valid, must be 10-255 bytes"))
		}

		// Parse password.
		password := getJsString(r, f.Argument(1))
		if password == "" {
			panic(r.NewTypeError("expects password string"))
		} else if len(password) < 8 {
			panic(r.NewTypeError("expects password to be valid, must be longer than 8 characters"))
		}

		username := ""
		if f.Argument(2) != goja.Undefined() {
			username = getJsString(r, f.Argument(2))
		}

		if username == "" {
			if attemptUsernameLogin {
				panic(r.NewTypeError("expects username string when email is not supplied"))
			}

			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(3) != goja.Undefined() {
			create = getJsBool(r, f.Argument(3))
		}

		var dbUserID string
		var created bool
		var err error

		if attemptUsernameLogin {
			dbUserID, err = AuthenticateUsername(n.ctx, n.logger, n.db, username, password)
		} else {
			cleanEmail := strings.ToLower(email)

			dbUserID, username, created, err = AuthenticateEmail(n.ctx, n.logger, n.db, cleanEmail, password, username, create)
		}
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": username,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook account token.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Facebook friends after authentication.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		token := getJsString(r, f.Argument(0))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}

		importFriends := true
		if f.Argument(1) != goja.Undefined() {
			importFriends = getJsBool(r, f.Argument(1))
		}

		username := ""
		if f.Argument(2) != goja.Undefined() {
			username = getJsString(r, f.Argument(2))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(3) != goja.Undefined() {
			create = getJsBool(r, f.Argument(3))
		}

		dbUserID, dbUsername, created, err := AuthenticateFacebook(n.ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		if importFriends {
			// Errors are logged before this point and failure here does not invalidate the whole operation.
			_ = importFacebookFriends(n.ctx, n.logger, n.db, n.tracker, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": username,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a Facebook Instant Game.
// @param signedPlayerInfo(type=string) Facebook Player info.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		signedPlayerInfo := getJsString(r, f.Argument(0))
		if signedPlayerInfo == "" {
			panic(r.NewTypeError("expects signed player info"))
		}

		username := ""
		if f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(2) != goja.Undefined() {
			create = getJsBool(r, f.Argument(2))
		}

		dbUserID, dbUsername, created, err := AuthenticateFacebookInstantGame(n.ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookInstantGame.AppSecret, signedPlayerInfo, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using Apple Game Center credentials.
// @param playerID(type=string) PlayerId provided by GameCenter.
// @param bundleID(type=string) BundleId of your app on iTunesConnect.
// @param timestamp(type=int64) Timestamp at which Game Center authenticated the client and issued a signature.
// @param salt(type=string) A random string returned by Game Center authentication on client.
// @param signature(type=string) A signature returned by Game Center authentication on client.
// @param publicKeyURL(type=string) A URL to the public key returned by Game Center authentication on client.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		playerID := getJsString(r, f.Argument(0))
		if playerID == "" {
			panic(r.NewTypeError("expects player ID string"))
		}
		bundleID := getJsString(r, f.Argument(1))
		if bundleID == "" {
			panic(r.NewTypeError("expects bundle ID string"))
		}
		timestamp := getJsInt(r, f.Argument(2))
		if timestamp == 0 {
			panic(r.NewTypeError("expects timestamp value"))
		}
		salt := getJsString(r, f.Argument(3))
		if salt == "" {
			panic(r.NewTypeError("expects salt string"))
		}
		signature := getJsString(r, f.Argument(4))
		if signature == "" {
			panic(r.NewTypeError("expects signature string"))
		}
		publicKeyURL := getJsString(r, f.Argument(5))
		if publicKeyURL == "" {
			panic(r.NewTypeError("expects public key URL string"))
		}

		username := ""
		if f.Argument(6) != goja.Undefined() {
			username = getJsString(r, f.Argument(6))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(7) != goja.Undefined() {
			create = getJsBool(r, f.Argument(7))
		}

		dbUserID, dbUsername, created, err := AuthenticateGameCenter(n.ctx, n.logger, n.db, n.socialClient, playerID, bundleID, timestamp, salt, signature, publicKeyURL, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a Google ID token.
// @param token(type=string) Google OAuth access token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		token := getJsString(r, f.Argument(0))
		if token == "" {
			panic(r.NewTypeError("expects ID token string"))
		}

		username := ""
		if f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(2) != goja.Undefined() {
			create = getJsBool(r, f.Argument(2))
		}

		dbUserID, dbUsername, created, err := AuthenticateGoogle(n.ctx, n.logger, n.db, n.socialClient, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Authenticate user and create a session token using a Steam account token.
// @param token(type=string) Steam token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Steam friends after authentication.
// @param create(type=bool, optional=true, default=true) Create user if one didn't exist previously.
// @return userID(string) The user ID of the authenticated user.
// @return username(string) The username of the authenticated user.
// @return create(bool) Value indicating if this account was just created or already existed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetSocial().Steam.PublisherKey == "" || n.config.GetSocial().Steam.AppID == 0 {
			panic(r.NewGoError(errors.New("Steam authentication is not configured")))
		}

		token := getJsString(r, f.Argument(0))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}

		importFriends := true
		if f.Argument(1) != goja.Undefined() {
			importFriends = getJsBool(r, f.Argument(1))
		}

		username := ""
		if f.Argument(2) != goja.Undefined() {
			username = getJsString(r, f.Argument(2))
		}

		if username == "" {
			username = generateUsername()
		} else if invalidUsernameRegex.MatchString(username) {
			panic(r.NewTypeError("expects username to be valid, no spaces or control characters allowed"))
		} else if len(username) > 128 {
			panic(r.NewTypeError("expects id to be valid, must be 1-128 bytes"))
		}

		create := true
		if f.Argument(3) != goja.Undefined() {
			create = getJsBool(r, f.Argument(3))
		}

		dbUserID, dbUsername, steamID, created, err := AuthenticateSteam(n.ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		// Import friends if requested.
		if importFriends {
			// Errors are logged before this point and failure here does not invalidate the whole operation.
			_ = importSteamFriends(n.ctx, n.logger, n.db, n.tracker, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, n.config.GetSocial().Steam.PublisherKey, steamID, false)
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

// @group authenticate
// @summary Generate a Nakama session token from a user ID.
// @param userID(type=string) User ID to use to generate the token.
// @param username(type=string, optional=true) The user's username. If left empty, one is generated.
// @param exp(type=number, optional=true) UTC time in seconds when the token must expire. Defaults to server configured expiry time.
// @param vars(type={[key:string]:string}, optional=true) Extra information that will be bundled in the session token.
// @return token(string) The Nakama session token.
// @return validity(number) The period for which the token remains valid.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) authenticateTokenGenerate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		// Parse input User ID.
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects user id"))
		}

		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects valid user id"))
		}

		var username string
		if f.Argument(1) != goja.Null() && f.Argument(1) != goja.Undefined() {
			username = getJsString(r, f.Argument(1))
		}
		if username == "" {
			username = generateUsername()
		}

		exp := time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpirySec) * time.Second).Unix()
		if f.Argument(2) != goja.Null() && f.Argument(2) != goja.Undefined() {
			exp = getJsInt(r, f.Argument(2))
		}

		var vars map[string]string
		if f.Argument(3) != goja.Null() && f.Argument(3) != goja.Undefined() {
			vars = getJsStringMap(r, f.Argument(3))
		}

		tokenId := uuid.Must(uuid.NewV4()).String()
		tokenIssuedAt := time.Now().Unix()
		token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, tokenId, tokenIssuedAt, userID, username, vars, exp)
		n.sessionCache.Add(uid, exp, tokenId, 0, "")

		return r.ToValue(map[string]interface{}{
			"token": token,
			"exp":   exp,
		})
	}
}

// @group accounts
// @summary Fetch account information by user ID.
// @param userID(type=string) User ID to fetch information for. Must be valid UUID.
// @return account(nkruntime.Account) All account information including wallet, device IDs and more.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) accountGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects user id"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		account, err := GetAccount(n.ctx, n.logger, n.db, n.statusRegistry, uid)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error getting account: %v", err.Error())))
		}

		accountData, err := accountToJsObject(account)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(accountData)
	}
}

// @group accounts
// @summary Fetch information for multiple accounts by user IDs.
// @param userIDs(type=[]string) Array of user IDs to fetch information for. Must be valid UUID.
// @return account(nkruntime.Account[]) Array of accounts.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) accountsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDs := f.Argument(0)
		if userIDs == goja.Undefined() || userIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		uids, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}
		for _, uid := range uids {
			if _, err := uuid.FromString(uid); err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %s", uid)))
			}
		}

		accounts, err := GetAccounts(n.ctx, n.logger, n.db, n.statusRegistry, uids)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get accounts: %s", err.Error())))
		}

		accountsData := make([]map[string]interface{}, 0, len(accounts))
		for _, account := range accounts {
			accountData, err := accountToJsObject(account)
			if err != nil {
				panic(r.NewGoError(err))
			}
			accountsData = append(accountsData, accountData)
		}

		return r.ToValue(accountsData)
	}
}

// @group accounts
// @summary Update an account by user ID.
// @param userID(type=string) User ID for which the information is to be updated. Must be valid UUID.
// @param username(type=string, optional=true) Username to be set. Must be unique. Use null if it is not being updated.
// @param displayName(type=string, optional=true) Display name to be updated. Use null if it is not being updated.
// @param timezone(type=string, optional=true) Timezone to be updated. Use null if it is not being updated.
// @param location(type=string, optional=true) Location to be updated. Use null if it is not being updated.
// @param langTag(type=string, optional=true) Lang tag to be updated. Use null if it is not being updated.
// @param avatarURL(type=string, optional=true) User's avatar URL. Use null if it is not being updated.
// @param metadataMap(type=object, optional=true) The metadata to update for this account.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) accountUpdateId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("expects a valid user id"))
		}

		var username string
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			username = getJsString(r, f.Argument(1))
		}

		var displayName *wrapperspb.StringValue
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			displayName = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(2))}
		}

		var timezone *wrapperspb.StringValue
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			timezone = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(3))}
		}

		var location *wrapperspb.StringValue
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			location = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(4))}
		}

		var langTag *wrapperspb.StringValue
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			langTag = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(5))}
		}

		var avatarURL *wrapperspb.StringValue
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			avatarURL = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(6))}
		}

		var metadata *wrapperspb.StringValue
		if f.Argument(7) != goja.Undefined() && f.Argument(7) != goja.Null() {
			metadataMap, ok := f.Argument(7).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
			}
			metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
		}

		if err = UpdateAccounts(n.ctx, n.logger, n.db, []*accountUpdate{{
			userID:      userID,
			username:    username,
			displayName: displayName,
			timezone:    timezone,
			location:    location,
			langTag:     langTag,
			avatarURL:   avatarURL,
			metadata:    metadata,
		}}); err != nil {
			panic(r.NewGoError(fmt.Errorf("error trying to update user: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group accounts
// @summary Delete an account by user ID.
// @param userID(type=string) User ID for the account to be deleted. Must be valid UUID.
// @param recorded(type=bool, optional=true, default=false) Whether to record this deletion in the database.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) accountDeleteId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		recorded := false
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			recorded = getJsBool(r, f.Argument(1))
		}

		if err := DeleteAccount(n.ctx, n.logger, n.db, n.config, n.leaderboardCache, n.rankCache, n.sessionRegistry, n.sessionCache, n.tracker, userID, recorded); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to delete account: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group accounts
// @summary Export account information for a specified user ID.
// @param userID(type=string) User ID for the account to be exported. Must be valid UUID.
// @return export(string) Account information for the provided user ID, in JSON format.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) accountExportId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		export, err := ExportAccount(n.ctx, n.logger, n.db, userID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error exporting account: %v", err.Error())))
		}

		exportString, err := n.protojsonMarshaler.Marshal(export)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error encoding account export: %v", err.Error())))
		}

		return r.ToValue(string(exportString))
	}
}

// @group users
// @summary Fetch one or more users by ID.
// @param userIDs(type=[]string) An array of user IDs to fetch.
// @param facebookIDs(type=[]string) An array of Facebook IDs to fetch.
// @return users(nkruntime.User[]) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var uids []string
		userIDs := f.Argument(0)
		if userIDs != goja.Undefined() && userIDs != goja.Null() {
			var err error
			uids, err = exportToSlice[[]string](userIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, userID := range uids {
				if _, err = uuid.FromString(userID); err != nil {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
				}
			}
		}

		var fids []string
		facebookIDs := f.Argument(1)
		if facebookIDs != goja.Undefined() && facebookIDs != goja.Null() {
			var err error
			fids, err = exportToSlice[[]string](facebookIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
		}

		if userIDs == nil && fids == nil {
			return r.ToValue(make([]string, 0))
		}

		users, err := GetUsers(n.ctx, n.logger, n.db, n.statusRegistry, uids, nil, fids)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]any, 0, len(users.Users))
		for _, user := range users.Users {
			userData, err := userToJsObject(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

// @group users
// @summary Fetch one or more users by username.
// @param usernames(type=[]string) An array of usernames to fetch.
// @return users(nkruntime.User[]) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersGetUsername(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		usernames := f.Argument(0)
		if usernames == goja.Undefined() || usernames == goja.Null() {
			panic(r.NewTypeError("expects an array of usernames"))
		}

		usernamesArray, err := exportToSlice[[]string](usernames)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		users, err := GetUsers(n.ctx, n.logger, n.db, n.statusRegistry, nil, usernamesArray, nil)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]interface{}, 0, len(users.Users))
		for _, user := range users.Users {
			userData, err := userToJsObject(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

// @group users
// @summary Get user's friend status information for a list of target users.
// @param userID(type=string) The current user ID.
// @param userIDs(type=string[]) An array of target user IDs.
// @return friends(nkruntime.Friend[]) A list of user friends objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersGetFriendStatus(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))

		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		userIDs := f.Argument(1)

		uids, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		fids := make([]uuid.UUID, 0, len(uids))
		for _, id := range uids {
			fid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("invalid user id"))
			}
			fids = append(fids, fid)
		}

		friends, err := GetFriends(n.ctx, n.logger, n.db, n.statusRegistry, uid, fids)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get user friends status: %s", err.Error())))
		}

		userFriends := make([]interface{}, 0, len(friends))
		for _, f := range friends {
			fum, err := userToJsObject(f.User)
			if err != nil {
				panic(r.NewGoError(err))
			}

			fm := make(map[string]interface{}, 4)
			fm["state"] = f.State.Value
			fm["updateTime"] = f.UpdateTime.Seconds
			fm["user"] = fum
			metadata := make(map[string]interface{})
			if err = json.Unmarshal([]byte(f.Metadata), &metadata); err != nil {
				panic(r.NewGoError(fmt.Errorf("error while trying to unmarshal friend metadata: %v", err.Error())))
			}
			pointerizeSlices(metadata)
			fm["metadata"] = metadata

			userFriends = append(userFriends, fm)
		}

		return r.ToValue(userFriends)
	}
}

// @group users
// @summary Fetch one or more users randomly.
// @param count(type=number) The number of users to fetch.
// @return users(nkruntime.User[]) A list of user record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersGetRandom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		count := getJsInt(r, f.Argument(0))

		if count < 0 || count > 1000 {
			panic(r.NewTypeError("count must be 0-1000"))
		}

		users, err := GetRandomUsers(n.ctx, n.logger, n.db, n.statusRegistry, int(count))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]interface{}, 0, len(users))
		for _, user := range users {
			userData, err := userToJsObject(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

// @group users
// @summary Ban one or more users by ID.
// @param userIDs(type=string[]) An array of user IDs to ban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersBanId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDs := f.Argument(0)
		if userIDs == goja.Undefined() || userIDs == goja.Null() {
			panic(r.NewTypeError("expects array of user ids"))
		}

		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", id)))
			}
			uids = append(uids, uid)
		}

		if err = BanUsers(n.ctx, n.logger, n.db, n.config, n.sessionCache, n.sessionRegistry, n.tracker, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to ban users: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group users
// @summary Unban one or more users by ID.
// @param userIDs(type=string[]) An array of user IDs to unban.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) usersUnbanId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDs := f.Argument(0)
		if userIDs == goja.Undefined() || userIDs == goja.Null() {
			panic(r.NewTypeError("expects array of user ids"))
		}

		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", id)))
			}
			uids = append(uids, uid)
		}

		if err = UnbanUsers(n.ctx, n.logger, n.db, n.sessionCache, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to unban users: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link Apple authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param token(type=string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := getJsString(r, f.Argument(1))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}

		if err := LinkApple(n.ctx, n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link custom authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param customID(type=string) Custom ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		customID := getJsString(r, f.Argument(1))
		if customID == "" {
			panic(r.NewTypeError("expects custom ID string"))
		}

		if err := LinkCustom(n.ctx, n.logger, n.db, id, customID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link device authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param deviceID(type=string) Device ID to be linked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		deviceID := getJsString(r, f.Argument(1))
		if deviceID == "" {
			panic(r.NewTypeError("expects device ID string"))
		}

		if err := LinkDevice(n.ctx, n.logger, n.db, id, deviceID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link email authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param email(type=string) Authentication email to be linked to the user.
// @param password(type=string) Password to set. Must be longer than 8 characters.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		email := getJsString(r, f.Argument(1))
		if email == "" {
			panic(r.NewTypeError("expects email string"))
		}
		password := getJsString(r, f.Argument(2))
		if password == "" {
			panic(r.NewTypeError("expects password string"))
		}

		if err := LinkEmail(n.ctx, n.logger, n.db, id, email, password); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link Facebook authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param username(type=string, optional=true) If left empty, one is generated.
// @param token(type=string) Facebook OAuth or Limited Login (JWT) access token.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Facebook friends after authentication.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects username string"))
		}
		token := getJsString(r, f.Argument(2))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}
		importFriends := true
		if f.Argument(3) != goja.Undefined() {
			importFriends = getJsBool(r, f.Argument(3))
		}

		if err := LinkFacebook(n.ctx, n.logger, n.db, n.socialClient, n.tracker, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link Facebook Instant Game authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param signedPlayerInfo(type=string) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		signedPlayerInfo := getJsString(r, f.Argument(1))
		if signedPlayerInfo == "" {
			panic(r.NewTypeError("expects signed player info string"))
		}

		if err := LinkFacebookInstantGame(n.ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
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
func (n *RuntimeJavascriptNakamaModule) linkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		playerID := getJsString(r, f.Argument(1))
		if playerID == "" {
			panic(r.NewTypeError("expects player ID string"))
		}
		bundleID := getJsString(r, f.Argument(2))
		if bundleID == "" {
			panic(r.NewTypeError("expects bundle ID string"))
		}
		timestamp := getJsInt(r, f.Argument(3))
		if timestamp == 0 {
			panic(r.NewTypeError("expects timestamp value"))
		}
		salt := getJsString(r, f.Argument(4))
		if salt == "" {
			panic(r.NewTypeError("expects salt string"))
		}
		signature := getJsString(r, f.Argument(5))
		if signature == "" {
			panic(r.NewTypeError("expects signature string"))
		}
		publicKeyURL := getJsString(r, f.Argument(6))
		if publicKeyURL == "" {
			panic(r.NewTypeError("expects public key URL string"))
		}

		if err := LinkGameCenter(n.ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyURL); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link Google authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param token(type=string) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := getJsString(r, f.Argument(1))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}

		if err := LinkGoogle(n.ctx, n.logger, n.db, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Link Steam authentication to a user ID.
// @param userID(type=string) The user ID to be linked.
// @param username(type=string, optional=true) If left empty, one is generated.
// @param token(type=string) Steam access token.
// @param importFriends(type=bool, optional=true, default=true) Whether to automatically import Steam friends after authentication.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) linkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects username string"))
		}
		token := getJsString(r, f.Argument(2))
		if token == "" {
			panic(r.NewTypeError("expects token string"))
		}
		importFriends := true
		if f.Argument(3) != goja.Undefined() {
			importFriends = getJsBool(r, f.Argument(3))
		}

		if err := LinkSteam(n.ctx, n.logger, n.db, n.config, n.socialClient, n.tracker, n.router, id, username, token, importFriends); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink Apple authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string) Apple sign in token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := ""
		if f.Argument(1) != goja.Undefined() {
			token = getJsString(r, f.Argument(1))
		}

		if err := UnlinkApple(n.ctx, n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink custom authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param customID(type=string, optional=true) Custom ID to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		customID := ""
		if f.Argument(1) != goja.Undefined() {
			customID = getJsString(r, f.Argument(1))
		}

		if err := UnlinkCustom(n.ctx, n.logger, n.db, id, customID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink device authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param deviceID(type=string) Device ID to be unlinked to the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		deviceID := getJsString(r, f.Argument(1))
		if deviceID == "" {
			panic(r.NewTypeError("expects device ID string"))
		}

		if err := UnlinkDevice(n.ctx, n.logger, n.db, id, deviceID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink email authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param email(type=string, optional=true) Email to be unlinked from the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		email := ""
		if f.Argument(1) != goja.Undefined() {
			email = getJsString(r, f.Argument(1))
		}

		if err := UnlinkEmail(n.ctx, n.logger, n.db, id, email); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink Facebook authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Facebook OAuth or Limited Login (JWT) access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := ""
		if f.Argument(1) != goja.Undefined() {
			token = getJsString(r, f.Argument(1))
		}

		if err := UnlinkFacebook(n.ctx, n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink Facebook Instant Game authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param signedPlayerInfo(type=string, optional=true) Facebook player info.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		signedPlayerInfo := ""
		if f.Argument(1) != goja.Undefined() {
			signedPlayerInfo = getJsString(r, f.Argument(1))
		}

		if err := UnlinkFacebookInstantGame(n.ctx, n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
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
func (n *RuntimeJavascriptNakamaModule) unlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		playerID := ""
		if f.Argument(1) != goja.Undefined() {
			playerID = getJsString(r, f.Argument(1))
		}
		bundleID := ""
		if f.Argument(2) != goja.Undefined() {
			bundleID = getJsString(r, f.Argument(2))
		}
		timestamp := int64(0)
		if f.Argument(3) != goja.Undefined() {
			timestamp = getJsInt(r, f.Argument(3))
		}
		salt := ""
		if f.Argument(4) != goja.Undefined() {
			salt = getJsString(r, f.Argument(4))
		}
		signature := ""
		if f.Argument(5) != goja.Undefined() {
			signature = getJsString(r, f.Argument(5))
		}
		publicKeyURL := ""
		if f.Argument(6) != goja.Undefined() {
			publicKeyURL = getJsString(r, f.Argument(6))
		}

		if err := UnlinkGameCenter(n.ctx, n.logger, n.db, n.socialClient, id, playerID, bundleID, timestamp, salt, signature, publicKeyURL); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink Google authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Google OAuth access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := ""
		if f.Argument(1) != goja.Undefined() {
			token = getJsString(r, f.Argument(1))
		}

		if err := UnlinkGoogle(n.ctx, n.logger, n.db, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group authenticate
// @summary Unlink Steam authentication from a user ID.
// @param userID(type=string) The user ID to be unlinked.
// @param token(type=string, optional=true) Steam access token.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) unlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		id, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		token := ""
		if f.Argument(1) != goja.Undefined() {
			token = getJsString(r, f.Argument(1))
		}

		if err := UnlinkSteam(n.ctx, n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group streams
// @summary List all users currently online and connected to a stream.
// @param streamIn(type=nkruntime.Stream) A stream object.
// @param includeHidden(type=bool, optional=true) Include stream presences marked as hidden in the results.
// @param includeNotHidden(type=bool, optional=true) Include stream presences not marked as hidden in the results.
// @return presences(nkruntime.Presences[]) Array of stream presences and their information.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		streamIn := f.Argument(0)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}
		includeHidden := true
		if f.Argument(1) != goja.Undefined() {
			includeHidden = getJsBool(r, f.Argument(1))
		}
		includeNotHidden := true
		if f.Argument(2) != goja.Undefined() {
			includeNotHidden = getJsBool(r, f.Argument(2))
		}

		stream := jsObjectToPresenceStream(r, streamObj)
		presences := n.tracker.ListByStream(stream, includeHidden, includeNotHidden)

		presencesList := make([]map[string]interface{}, 0, len(presences))
		for _, p := range presences {
			presenceObj := make(map[string]interface{}, 8)
			presenceObj["userId"] = p.UserID.String()
			presenceObj["sessionId"] = p.ID.SessionID.String()
			presenceObj["nodeId"] = p.ID.Node
			presenceObj["hidden"] = p.Meta.Hidden
			presenceObj["persistence"] = p.Meta.Persistence
			presenceObj["username"] = p.Meta.Username
			presenceObj["status"] = p.Meta.Status
			presenceObj["reason"] = p.Meta.Reason
			presencesList = append(presencesList, presenceObj)
		}

		return r.ToValue(presencesList)
	}
}

// @group streams
// @summary Retrieve a stream presence and metadata by user ID.
// @param userID(type=string) The user ID to fetch information for.
// @param sessionID(type=string) The current session ID for the user.
// @param stream(type=nkruntime.Stream) A stream object.
// @return meta(nkruntime.Presence) Presence for the user.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionID := getJsString(r, f.Argument(1))
		if sessionID == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		stream := f.Argument(2)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)
		meta := n.tracker.GetLocalBySessionIDStreamUserID(sid, streamValue, uid)
		if meta == nil {
			return goja.Null()
		}

		return r.ToValue(map[string]interface{}{
			"hidden":      meta.Hidden,
			"persistence": meta.Persistence,
			"username":    meta.Username,
			"status":      meta.Status,
			"reason":      meta.Reason,
		})
	}
}

// @group streams
// @summary Add a user to a stream.
// @param userID(type=string) The user ID to be added.
// @param sessionID(type=string) The current session ID for the user.
// @param stream(type=nkruntime.Stream) A stream object.
// @param hidden(type=bool) Whether the user will be marked as hidden.
// @param persistence(type=bool) Whether message data should be stored in the database.
// @param status(type=string) User status message.
// @return success(bool) Whether the user was successfully added.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionID := getJsString(r, f.Argument(1))
		if sessionID == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		stream := f.Argument(2)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		// By default generate presence events.
		hidden := false
		if f.Argument(3) != goja.Undefined() {
			hidden = getJsBool(r, f.Argument(3))
		}
		// By default, persistence is enabled, if the stream supports it.
		persistence := true
		if f.Argument(4) != goja.Undefined() {
			persistence = getJsBool(r, f.Argument(4))
		}
		// By default, no status is set.
		status := ""
		if f.Argument(5) != goja.Undefined() {
			status = getJsString(r, f.Argument(5))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		success, newlyTracked, err := n.streamManager.UserJoin(streamValue, uid, sid, hidden, persistence, status)
		if err != nil {
			if err == ErrSessionNotFound {
				panic(r.NewGoError(errors.New("session id does not exist")))
			}
			panic(r.NewGoError(fmt.Errorf("stream user join failed: %v", err.Error())))
		}
		if !success {
			panic(r.NewGoError(errors.New("tracker rejected new presence, session is closing")))
		}

		return r.ToValue(newlyTracked)
	}
}

// @group streams
// @summary Update a stream user by ID.
// @param userID(type=string) The user ID to be updated.
// @param sessionID(type=string) The current session ID for the user.
// @param stream(type=nkruntime.Stream) A stream object.
// @param hidden(type=bool) Whether the user will be marked as hidden.
// @param persistence(type=bool) Whether message data should be stored in the database.
// @param status(type=string) User status message.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionID := getJsString(r, f.Argument(1))
		if sessionID == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		stream := f.Argument(2)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		// By default generate presence events.
		hidden := false
		if f.Argument(3) != goja.Undefined() {
			hidden = getJsBool(r, f.Argument(3))
		}
		// By default, persistence is enabled, if the stream supports it.
		persistence := true
		if f.Argument(4) != goja.Undefined() {
			persistence = getJsBool(r, f.Argument(4))
		}
		// By default, no status is set.
		status := ""
		if f.Argument(5) != goja.Undefined() {
			status = getJsString(r, f.Argument(5))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		success, err := n.streamManager.UserUpdate(streamValue, uid, sid, hidden, persistence, status)
		if err != nil {
			if err == ErrSessionNotFound {
				panic(r.NewGoError(errors.New("session id does not exist")))
			}
			panic(r.NewGoError(fmt.Errorf("stream user update failed: %v", err.Error())))
		}
		if !success {
			panic(r.NewGoError(errors.New("tracker rejected updated presence, session is closing")))
		}

		return goja.Undefined()
	}
}

// @group streams
// @summary Remove a user from a stream.
// @param userID(type=string) The user ID to be removed.
// @param sessionID(type=string) The current session ID for the user.
// @param stream(type=nkruntime.Stream) A stream object.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserLeave(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionID := getJsString(r, f.Argument(1))
		if sessionID == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		stream := f.Argument(2)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		if err := n.streamManager.UserLeave(streamValue, uid, sid); err != nil {
			panic(r.NewGoError(fmt.Errorf("stream user leave failed: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group streams
// @summary Kick a user from a stream.
// @param presence(type=nkruntime.Presence) The presence to be kicked.
// @param stream(type=nkruntime.Stream) A stream object.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamUserKick(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		presence := f.Argument(0)
		if presence == goja.Undefined() {
			panic(r.NewTypeError("expects presence object"))
		}
		presenceMap, ok := presence.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a presence object"))
		}

		userID := uuid.Nil
		sessionID := uuid.Nil
		node := n.node

		userIDRaw, ok := presenceMap["userId"]
		if ok {
			userIDString, ok := userIDRaw.(string)
			if !ok {
				panic(r.NewTypeError("presence userId must be a string"))
			}
			id, err := uuid.FromString(userIDString)
			if err != nil {
				panic(r.NewTypeError("invalid userId"))
			}
			userID = id
		}

		sessionIdRaw, ok := presenceMap["sessionId"]
		if ok {
			sessionIDString, ok := sessionIdRaw.(string)
			if !ok {
				panic(r.NewTypeError("presence sessionId must be a string"))
			}
			id, err := uuid.FromString(sessionIDString)
			if err != nil {
				panic(r.NewTypeError("invalid sessionId"))
			}
			sessionID = id
		}

		nodeRaw, ok := presenceMap["node"]
		if ok {
			nodeString, ok := nodeRaw.(string)
			if !ok {
				panic(r.NewTypeError(errors.New("expects node to be a string")))
			}
			node = nodeString
		}

		if userID == uuid.Nil || sessionID == uuid.Nil || node == "" {
			panic(r.NewTypeError("expects each presence to have a valid userId, sessionId, and node"))
		}

		stream := f.Argument(1)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		if err := n.streamManager.UserLeave(streamValue, userID, sessionID); err != nil {
			panic(r.NewGoError(fmt.Errorf("stream user kick failed: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group streams
// @summary Get a count of stream presences.
// @param stream(type=nkruntime.Stream) A stream object.
// @return countByStream(number) Number of current stream presences.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamCount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		stream := f.Argument(0)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		count := n.tracker.CountByStream(streamValue)

		return r.ToValue(count)
	}
}

// @group streams
// @summary Close a stream and remove all presences on it.
// @param stream(type=nkruntime.Stream) A stream object.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamClose(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		stream := f.Argument(0)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		n.tracker.UntrackByStream(streamValue)

		return goja.Undefined()
	}
}

// @group streams
// @summary Send data to presences on a stream.
// @param stream(type=nkruntime.Stream) A stream object.
// @param data(type=string) The data to send.
// @param presences(type=nkruntime.Presence[], optional=true, default=all) Array of presences to receive the sent data.
// @param reliable(type=bool, optional=true, default=true) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		stream := f.Argument(0)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		data := getJsString(r, f.Argument(1))

		presences := f.Argument(2)
		var presencesArray []map[string]any
		if presences == goja.Undefined() || presences == goja.Null() {
			presencesArray = make([]map[string]any, 0)
		} else {
			var err error
			presencesArray, err = exportToSlice[[]map[string]any](presences)
			if err != nil {
				panic(r.NewTypeError("expects an array of presence objects"))
			}
		}

		presenceIDs := make([]*PresenceID, 0, len(presencesArray))
		for _, presence := range presencesArray {
			presenceID := &PresenceID{}
			sessionIdRaw, ok := presence["sessionId"]
			if ok {
				sessionIDString, ok := sessionIdRaw.(string)
				if !ok {
					panic(r.NewTypeError("presence sessionId must be a string"))
				}
				id, err := uuid.FromString(sessionIDString)
				if err != nil {
					panic(r.NewTypeError("invalid presence sessionId"))
				}
				presenceID.SessionID = id
			}

			nodeIDRaw, ok := presence["nodeId"]
			if ok {
				nodeString, ok := nodeIDRaw.(string)
				if !ok {
					panic(r.NewTypeError("expects node id to be a string"))
				}
				presenceID.Node = nodeString
			}

			presenceIDs = append(presenceIDs, presenceID)
		}

		reliable := true
		if f.Argument(3) != goja.Undefined() {
			reliable = getJsBool(r, f.Argument(3))
		}

		streamWire := &rtapi.Stream{
			Mode:  int32(streamValue.Mode),
			Label: streamValue.Label,
		}
		if streamValue.Subject != uuid.Nil {
			streamWire.Subject = streamValue.Subject.String()
		}
		if streamValue.Subcontext != uuid.Nil {
			streamWire.Subcontext = streamValue.Subcontext.String()
		}
		msg := &rtapi.Envelope{Message: &rtapi.Envelope_StreamData{StreamData: &rtapi.StreamData{
			Stream: streamWire,
			// No sender.
			Data:     data,
			Reliable: reliable,
		}}}

		if len(presenceIDs) == 0 {
			// Sending to whole stream.
			n.router.SendToStream(n.logger, streamValue, msg, reliable)
		} else {
			// Sending to a subset of stream users.
			n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
		}

		return goja.Undefined()
	}
}

// @group streams
// @summary Send a message to presences on a stream.
// @param stream(type=nkruntime.Stream) A stream object.
// @param envelopeMap(type=&rtapi.Envelope{}) The message to send.
// @param presences(type=nkruntime.Presence[], optional=true, default=all) Array of presences to receive the sent data.
// @param reliable(type=bool, optional=true, default=true) Whether the sender has been validated prior.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) streamSendRaw(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		stream := f.Argument(0)
		if stream == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := stream.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		streamValue := jsObjectToPresenceStream(r, streamObj)

		envelopeMap, ok := f.Argument(1).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects envelope object"))
		}
		envelopeBytes, err := json.Marshal(envelopeMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert envelope: %s", err.Error())))
		}

		msg := &rtapi.Envelope{}
		if err = n.protojsonUnmarshaler.Unmarshal(envelopeBytes, msg); err != nil {
			panic(r.NewGoError(fmt.Errorf("not a valid envelope: %s", err.Error())))
		}

		presences := f.Argument(2)
		var presencesArray []map[string]any
		if presences == goja.Undefined() || presences == goja.Null() {
			presencesArray = make([]map[string]any, 0)
		} else {
			presencesArray, err = exportToSlice[[]map[string]any](presences)
			if err != nil {
				panic(r.NewTypeError("expects a presences array"))
			}
		}

		presenceIDs := make([]*PresenceID, 0, len(presencesArray))
		for _, presence := range presencesArray {
			presenceID := &PresenceID{}
			sessionIdRaw, ok := presence["sessionId"]
			if ok {
				sessionIDString, ok := sessionIdRaw.(string)
				if !ok {
					panic(r.NewTypeError("presence sessionId must be a string"))
				}
				id, err := uuid.FromString(sessionIDString)
				if err != nil {
					panic(r.NewTypeError(errors.New("invalid presence sessionId")))
				}
				presenceID.SessionID = id
			}

			nodeIDRaw, ok := presence["nodeId"]
			if ok {
				nodeString, ok := nodeIDRaw.(string)
				if !ok {
					panic(r.NewTypeError("expects node id to be a string"))
				}
				presenceID.Node = nodeString
			}

			presenceIDs = append(presenceIDs, presenceID)
		}

		reliable := true
		if f.Argument(3) != goja.Undefined() {
			reliable = getJsBool(r, f.Argument(3))
		}

		if len(presenceIDs) == 0 {
			// Sending to whole stream.
			n.router.SendToStream(n.logger, streamValue, msg, reliable)
		} else {
			// Sending to a subset of stream users.
			n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
		}

		return goja.Undefined()
	}
}

// @group sessions
// @summary Disconnect a session.
// @param sessionID(type=string) The ID of the session to be disconnected.
// @param reason(type=nkruntime.PresenceReason) The reason for the session disconnect.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) sessionDisconnect(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		sessionID := getJsString(r, f.Argument(0))
		if sessionID == "" {
			panic(r.NewTypeError("expects a session id"))
		}
		sid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("expects a valid session id"))
		}

		reasonArray := make([]runtime.PresenceReason, 0, 1)
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			reason := getJsInt(r, f.Argument(1))
			if reason < 0 || reason > 4 {
				panic(r.NewTypeError("invalid disconnect reason, must be a value 0-4"))
			}
			reasonArray = append(reasonArray, runtime.PresenceReason(reason))
		}

		if err := n.sessionRegistry.Disconnect(n.ctx, sid, false, reasonArray...); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to disconnect: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group sessions
// @summary Log out a user from their current session.
// @param userID(type=string) The ID of the user to be logged out.
// @param token(type=string, optional=true) The current session authentication token. If the current auth and refresh tokens are not provided, all user sessions will be logged out.
// @param refreshToken(type=string, optional=true) The current session refresh token. If the current auth and refresh tokens are not provided, all user sessions will be logged out.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) sessionLogout(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user id"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects a valid user id"))
		}

		token := f.Argument(1)
		var tokenString string
		if token != goja.Undefined() {
			var ok bool
			tokenString, ok = token.Export().(string)
			if !ok {
				panic(r.NewTypeError("expects token to be a string"))
			}
		}

		refreshToken := f.Argument(2)
		var refreshTokenString string
		if refreshToken != goja.Undefined() {
			var ok bool
			refreshTokenString, ok = refreshToken.Export().(string)
			if !ok {
				panic(r.NewTypeError("expects refresh token to be a string"))
			}
		}

		if err := SessionLogout(n.config, n.sessionCache, uid, tokenString, refreshTokenString); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to logout: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group matches
// @summary Create a new authoritative realtime multiplayer match running on the given runtime module name. The given params are passed to the match's init hook.
// @param module(type=string) The name of an available runtime module that will be responsible for the match. This was registered in InitModule.
// @param params(type={[key:string]:any}, optional=true) Any value to pass to the match init hook.
// @return matchId(string) The match ID of the newly created match. Clients can immediately use this ID to join the match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) matchCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		module := getJsString(r, f.Argument(0))
		if module == "" {
			panic(r.NewTypeError("expects module name"))
		}

		params := f.Argument(1)
		var paramsMap map[string]interface{}
		if params == goja.Undefined() {
			paramsMap = make(map[string]interface{})
		} else {
			var ok bool
			paramsMap, ok = params.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects params to be an object"))
			}
		}

		id, err := n.matchRegistry.CreateMatch(n.ctx, n.matchCreateFn, module, paramsMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating match: %s", err.Error())))
		}

		return r.ToValue(id)
	}
}

// @group matches
// @summary Get information on a running match.
// @param id(type=string) The ID of the match to fetch.
// @return match(nkruntime.Match) Information for the running match.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) matchGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		result, _, err := n.matchRegistry.GetMatch(n.ctx, id)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get match: %s", err.Error())))
		}

		if result == nil {
			return goja.Null()
		}

		matchData := map[string]interface{}{
			"matchId":       result.MatchId,
			"authoritative": result.Authoritative,
			"size":          result.Size,
		}
		if result.Label == nil {
			matchData["label"] = nil
		} else {
			matchData["label"] = result.Label.Value
		}

		return r.ToValue(matchData)
	}
}

// @group matches
// @summary List currently running realtime multiplayer matches and optionally filter them by authoritative mode, label, and current participant count.
// @param limit(type=number, optional=true, default=1) The maximum number of matches to list.
// @param authoritative(type=bool, optional=true, default=nil) Set true to only return authoritative matches, false to only return relayed matches and nil to return both.
// @param label(type=string, optional=true, default="") A label to filter authoritative matches by. Default "" meaning any label matches.
// @param minSize(type=number, optional=true) Inclusive lower limit of current match participants.
// @param maxSize(type=number, optional=true) Inclusive upper limit of current match participants.
// @param query(type=string, optional=true) Additional query parameters to shortlist matches.
// @return match(nkruntime.Match[]) A list of matches matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) matchList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		limit := 1
		if f.Argument(0) != goja.Undefined() {
			limit = int(getJsInt(r, f.Argument(0)))
		}

		var authoritative *wrapperspb.BoolValue
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			authoritative = &wrapperspb.BoolValue{Value: getJsBool(r, f.Argument(1))}
		}

		var label *wrapperspb.StringValue
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			label = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(2))}
		}

		var minSize *wrapperspb.Int32Value
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			minSize = &wrapperspb.Int32Value{Value: int32(getJsInt(r, f.Argument(3)))}
		}

		var maxSize *wrapperspb.Int32Value
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			maxSize = &wrapperspb.Int32Value{Value: int32(getJsInt(r, f.Argument(4)))}
		}

		var query *wrapperspb.StringValue
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			query = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(5))}
		}

		results, _, err := n.matchRegistry.ListMatches(n.ctx, limit, authoritative, label, minSize, maxSize, query, nil)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list matches: %s", err.Error())))
		}

		matches := make([]interface{}, 0, len(results))
		for _, match := range results {
			matchData := map[string]interface{}{
				"matchId":       match.MatchId,
				"authoritative": match.Authoritative,
				"size":          match.Size,
			}
			if match.Label == nil {
				matchData["label"] = nil
			} else {
				matchData["label"] = match.Label.Value
			}

			matches = append(matches, matchData)
		}

		return r.ToValue(matches)
	}
}

// @group matches
// @summary Allow the match handler to be sent a reservation signal to mark a user ID or session ID into the match state ahead of their join attempt and eventual join flow. Called when the match handler receives a runtime signal.
// @param id(type=string) The user ID or session ID to send a reservation signal for.
// @param data(type=string) An arbitrary input supplied by the runtime caller of the signal.
// @return state(interface{}) An (optionally) updated state. May be any non-nil value, or nil to end the match.
// @return data(string) Arbitrary data to return to the runtime caller of the signal. May be a string or nil.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) matchSignal(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		var data string
		if f.Argument(1) != goja.Undefined() {
			data = getJsString(r, f.Argument(1))
		}

		responseData, err := n.matchRegistry.Signal(n.ctx, id, data)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to signal match: %s", err.Error())))
		}

		return r.ToValue(responseData)
	}
}

// @group notifications
// @summary Send one in-app notification to a user.
// @param userID(type=string) The user ID of the user to be sent the notification.
// @param subject(type=string) Notification subject.
// @param content(type=object) Notification content. Must be set but can be empty object.
// @param code(type=number) Notification code to use. Must be equal or greater than 0.
// @param senderID(type=string, optional=true) The sender of this notification. If left empty, it will be assumed that it is a system notification.
// @param persistent(type=bool, optional=true, default=false) Whether to record this in the database for later listing.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects valid user id"))
		}

		subject := getJsString(r, f.Argument(1))
		if subject == "" {
			panic(r.NewTypeError("expects subject to be a non empty string"))
		}

		content := f.Argument(2)
		if content == goja.Undefined() {
			panic(r.NewTypeError("expects content"))
		}
		contentMap, ok := content.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects content to be an object"))
		}
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert content: %s", err.Error())))
		}
		contentValue := string(contentBytes)

		code := getJsInt(r, f.Argument(3))
		if code <= 0 && !(-2000 <= code && code <= -1000) {
			panic(r.NewGoError(errors.New("expects code number to be a positive integer")))
		}

		senderID := f.Argument(4)
		sid := uuid.Nil.String()
		if senderID != goja.Undefined() && senderID != goja.Null() {
			suid, err := uuid.FromString(getJsString(r, senderID))
			if err != nil {
				panic(r.NewTypeError("expects senderId to either be not set, empty string or a valid UUID"))
			}
			sid = suid.String()
		}

		persistent := false
		if f.Argument(5) != goja.Undefined() {
			persistent = getJsBool(r, f.Argument(5))
		}

		nots := []*api.Notification{{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    subject,
			Content:    contentValue,
			Code:       int32(code),
			SenderId:   sid,
			Persistent: persistent,
			CreateTime: &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()},
		}}
		notifications := map[uuid.UUID][]*api.Notification{
			uid: nots,
		}

		if err := NotificationSend(n.ctx, n.logger, n.db, n.tracker, n.router, notifications); err != nil {
			panic(fmt.Sprintf("failed to send notifications: %s", err.Error()))
		}

		return goja.Undefined()
	}
}

// @group notifications
// @summary List notifications by user id.
// @param userID(type=string) Optional userID to scope results to that user only.
// @param limit(type=int, optiona=true, default=100) Limit number of results. Must be a value between 1 and 1000.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return notifications(nkruntime.NotificationList) A list of notifications.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		limit := 100
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 1000 {
				panic(r.ToValue(r.NewTypeError("expects limit between 1 and 1000")))
			}
		}

		cursor := ""
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			cursor = getJsString(r, f.Argument(2))
		}

		list, err := NotificationList(n.ctx, n.logger, n.db, uid, limit, cursor, false)
		if err != nil {
			panic(r.ToValue(r.NewGoError(fmt.Errorf("failed to list notifications: %s", err.Error()))))
		}

		if len(list.Notifications) == 0 {
			list.CacheableCursor = ""
		}

		notObjs := make([]any, 0, len(list.Notifications))
		for _, n := range list.Notifications {
			no := r.NewObject()
			_ = no.Set("id", n.Id)
			_ = no.Set("subject", n.Subject)
			_ = no.Set("content", n.Content)
			_ = no.Set("code", n.Code)
			_ = no.Set("senderId", n.SenderId)
			_ = no.Set("persistent", n.Persistent)
			_ = no.Set("createTime", n.CreateTime.Seconds)

			notObjs = append(notObjs, no)
		}

		outObj := r.NewObject()
		_ = outObj.Set("notifications", r.NewArray(notObjs...))
		if list.CacheableCursor != "" {
			_ = outObj.Set("cursor", list.CacheableCursor)
		} else {
			_ = outObj.Set("cursor", goja.Null())
		}

		return outObj
	}
}

// @group notifications
// @summary Send one or more in-app notifications to a user.
// @param notifications(type=any[]) A list of notifications to be sent together.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		notifications := f.Argument(0)
		if notifications == goja.Undefined() || notifications == goja.Null() {
			panic(r.NewTypeError("expects a valid array of notifications"))
		}

		notificationsSlice, err := exportToSlice[[]map[string]any](notifications)
		if err != nil {
			panic(r.NewTypeError("expects notifications to be an array"))
		}

		notificationsMap := make(map[uuid.UUID][]*api.Notification)
		for _, notificationObj := range notificationsSlice {
			notification := &api.Notification{}
			userID := uuid.Nil
			senderID := uuid.Nil

			var persistent bool
			if _, ok := notificationObj["persistent"]; ok {
				persistent, ok = notificationObj["persistent"].(bool)
				if !ok {
					panic(r.NewTypeError("expects 'persistent' value to be a boolean"))
				}
				notification.Persistent = persistent
			}

			if _, ok := notificationObj["subject"]; ok {
				subject, ok := notificationObj["subject"].(string)
				if !ok {
					panic(r.NewTypeError("expects 'subject' value to be a string"))
				}
				notification.Subject = subject
			}

			if _, ok := notificationObj["content"]; ok {
				content, ok := notificationObj["content"].(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects 'content' value to be an object"))
				}
				contentBytes, err := json.Marshal(content)
				if err != nil {
					panic(r.NewGoError(fmt.Errorf("failed to convert content: %s", err.Error())))
				}
				notification.Content = string(contentBytes)
			}

			if _, ok := notificationObj["code"]; ok {
				code, ok := notificationObj["code"].(int64)
				if !ok {
					panic(r.NewTypeError("expects 'code' value to be a number"))
				}
				if code <= 0 && !(-2000 <= code && code <= -1000) {
					panic(r.NewTypeError("expects 'code' value to be a positive integer."))
				}
				notification.Code = int32(code)
			}

			if _, ok := notificationObj["userId"]; ok {
				userIDStr, ok := notificationObj["userId"].(string)
				if !ok {
					panic(r.NewTypeError("expects 'userId' value to be a string"))
				}
				uid, err := uuid.FromString(userIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'userId' value to be a valid id"))
				}
				userID = uid
			}

			if _, ok := notificationObj["senderId"]; ok {
				senderIDStr, ok := notificationObj["senderId"].(string)
				if !ok {
					panic(r.NewTypeError("expects 'senderId' value to be a string"))
				}
				uid, err := uuid.FromString(senderIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'senderId' value to be a valid id"))
				}
				senderID = uid
			}

			if notification.Subject == "" {
				panic(r.NewTypeError("expects subject to be provided and to be non-empty"))
			} else if len(notification.Content) == 0 {
				panic(r.NewTypeError("expects content to be provided and be valid JSON"))
			} else if userID == uuid.Nil {
				panic(r.NewTypeError("expects userId to be provided and be a valid UUID"))
			} else if notification.Code == 0 {
				panic(r.NewTypeError("expects code to be provided and be a number above 0"))
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
		}

		if err := NotificationSend(n.ctx, n.logger, n.db, n.tracker, n.router, notificationsMap); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to send notifications: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group notifications
// @summary Send an in-app notification to all users.
// @param subject(type=string) Notification subject.
// @param content(type=object) Notification content. Must be set but can be an empty object.
// @param code(type=number) Notification code to use. Must be greater than or equal to 0.
// @param persistent(type=bool, optional=true, default=false) Whether to record this in the database for later listing.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationSendAll(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		subject := getJsString(r, f.Argument(0))
		if subject == "" {
			panic(r.NewTypeError("expects subject to be a non empty string"))
		}

		content := f.Argument(1)
		if content == goja.Undefined() {
			panic(r.NewTypeError("expects content"))
		}
		contentMap, ok := content.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects content to be an object"))
		}
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert content: %s", err.Error())))
		}
		contentValue := string(contentBytes)

		code := getJsInt(r, f.Argument(2))
		if code <= 0 {
			panic(r.NewGoError(errors.New("expects code number to be a positive integer")))
		}

		persistent := false
		if f.Argument(3) != goja.Undefined() {
			persistent = getJsBool(r, f.Argument(3))
		}

		senderID := uuid.Nil.String()
		createTime := &timestamppb.Timestamp{Seconds: time.Now().UTC().Unix()}

		not := &api.Notification{
			Id:         uuid.Must(uuid.NewV4()).String(),
			Subject:    subject,
			Content:    contentValue,
			Code:       int32(code),
			SenderId:   senderID,
			Persistent: persistent,
			CreateTime: createTime,
		}

		if err := NotificationSendAll(n.ctx, n.logger, n.db, n.tracker, n.router, not); err != nil {
			panic(fmt.Sprintf("failed to send notification: %s", err.Error()))
		}

		return goja.Undefined()
	}
}

// @group notifications
// @summary Delete one or more in-app notifications.
// @param notifications(type=any[]) A list of notifications to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		notifications := f.Argument(0)
		if notifications == goja.Undefined() || notifications == goja.Null() {
			panic(r.NewTypeError("expects a valid array of notifications"))
		}

		notificationsSlice, err := exportToSlice[[]map[string]any](notifications)
		if err != nil {
			panic(r.NewTypeError("expects notifications to be an array"))
		}

		notificationsMap := make(map[uuid.UUID][]string)
		for _, notificationObj := range notificationsSlice {
			userID := uuid.Nil
			notificationIDStr := ""

			if _, ok := notificationObj["userId"]; ok {
				userIDStr, ok := notificationObj["userId"].(string)
				if !ok {
					panic(r.NewTypeError("expects 'userId' value to be a string"))
				}
				uid, err := uuid.FromString(userIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'userId' value to be a valid id"))
				}
				userID = uid
			}

			if _, ok := notificationObj["notificationId"]; ok {
				notificationIDStr, ok = notificationObj["notificationId"].(string)
				if !ok {
					panic(r.NewTypeError("expects 'notificationId' value to be a string"))
				}
				_, err := uuid.FromString(notificationIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'notificationId' value to be a valid id"))
				}
			}

			no := notificationsMap[userID]
			if no == nil {
				no = make([]string, 0, 1)
			}
			no = append(no, notificationIDStr)
			notificationsMap[userID] = no
		}

		for uid, notificationIDs := range notificationsMap {
			if err := NotificationDelete(n.ctx, n.logger, n.db, uid, notificationIDs); err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to delete notifications: %s", err.Error())))
			}
		}

		return goja.Undefined()
	}
}

// @group notifications
// @summary Update notifications by their id.
// @param updates(type=nkruntime.NotificationUpdate[]) A list of notifications to be updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		updates := f.Argument(0)

		dataSlice, err := exportToSlice[[]map[string]any](updates)
		if err != nil {
			panic(r.NewTypeError("expects an array of notification updates objects"))
		}

		nUpdates := make([]notificationUpdate, 0, len(dataSlice))
		for _, u := range dataSlice {
			update := notificationUpdate{}
			id, ok := u["id"]
			if !ok || id == "" {
				panic(r.NewTypeError("expects 'id' value to be set"))
			}
			idstr, ok := id.(string)
			if !ok || idstr == "" {
				panic(r.NewTypeError("expects 'id' value to be a non-empty string"))
			}
			uid, err := uuid.FromString(idstr)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("expects 'id' value to be a valid id")))
			}
			update.Id = uid

			content, ok := u["content"]
			if ok {
				cmap, ok := content.(map[string]any)
				if !ok {
					panic(r.NewTypeError("expects 'content' value to be a non-empty map"))
				}
				update.Content = cmap
			}

			subject, ok := u["subject"]
			if ok {
				substr, ok := subject.(string)
				if !ok || substr == "" {
					panic(r.NewTypeError("expects 'subject' value to be a non-empty string"))
				}
				update.Subject = &substr
			}

			sender, ok := u["sender"]
			if ok {
				substr, ok := sender.(string)
				if !ok || substr == "" {
					panic(r.NewTypeError("expects 'sender' value to be a non-empty string"))
				}
				update.Sender = &substr
			}

			nUpdates = append(nUpdates, update)
		}

		if err := NotificationsUpdate(n.ctx, n.logger, n.db, nUpdates...); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update notifications: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group notifications
// @summary Get notifications by their id.
// @param notifIDs(type=string[]) A list of notification ids.
// @param userIDIn(type=string) Optional userID to scope results to that user only.
// @return notifications(type=runtime.Notification[]) A list of notifications.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		notifIDs := f.Argument(0)

		if notifIDs == goja.Undefined() || notifIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of ids"))
		}

		notifIDsArray, err := exportToSlice[[]string](notifIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}
		for _, userID := range notifIDsArray {
			if _, err = uuid.FromString(userID); err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
			}
		}

		if notifIDsArray == nil {
			return r.ToValue(make([]string, 0))
		}

		userIDIn := f.Argument(1)
		userID := ""
		if userIDIn != goja.Undefined() && userIDIn != goja.Null() {
			userID = getJsString(r, userIDIn)
		}

		results, err := NotificationsGetId(n.ctx, n.logger, n.db, userID, notifIDsArray...)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get notifications by id: %s", err.Error())))
		}

		notifications := make([]any, 0, len(results))
		for _, no := range results {
			notifObj := r.NewObject()

			_ = notifObj.Set("id", no.Id)
			_ = notifObj.Set("userId", no.UserID)
			_ = notifObj.Set("subject", no.Subject)
			_ = notifObj.Set("persistent", no.Persistent)
			_ = notifObj.Set("content", no.Content)
			_ = notifObj.Set("code", no.Code)
			_ = notifObj.Set("sender", no.Sender)
			_ = notifObj.Set("createTime", no.CreateTime.Seconds)
			_ = notifObj.Set("persistent", no.Persistent)

			notifications = append(notifications, notifObj)
		}

		return r.NewArray(notifications...)
	}
}

// @group notifications
// @summary Delete notifications by their id.
// @param notifIDs(type=string[]) A list of notification ids.
// @param userID(type=string) Optional userID to scope deletions to that user only.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) notificationsDeleteId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		notifIDs := f.Argument(0)

		if notifIDs == goja.Undefined() || notifIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of ids"))
		}

		notifIDsArray, err := exportToSlice[[]string](notifIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}
		for _, userID := range notifIDsArray {
			if _, err = uuid.FromString(userID); err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
			}
		}

		if notifIDsArray == nil {
			return r.ToValue(make([]string, 0))
		}

		userID := f.Argument(1)
		uid := ""
		if userID != goja.Undefined() && userID != goja.Null() {
			uid = getJsString(r, userID)
		}

		if err := NotificationsDeleteId(n.ctx, n.logger, n.db, uid, notifIDsArray...); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get notifications by id: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group wallets
// @summary Update a user's wallet with the given changeset.
// @param userID(type=string) The ID of the user whose wallet to update.
// @param changeset(type={[key: string]: number}) The set of wallet operations to apply.
// @param metadata(type=object, optional=true) Additional metadata to tag the wallet update with.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this update in the ledger.
// @return result(nkruntime.WalletUpdateResult) The changeset after the update and before to the update, respectively.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) walletUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a valid user id"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects a valid user id"))
		}

		changeset, ok := f.Argument(1).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a changeset object"))
		}
		changesetMap := make(map[string]int64)
		for k, v := range changeset {
			i64, ok := v.(int64)
			if !ok {
				panic(r.NewTypeError("expects changeset values to be whole numbers"))
			}
			changesetMap[k] = i64
		}

		metadataBytes := []byte("{}")
		metadata := f.Argument(2)
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := metadata.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be a key value object"))
			}
			metadataBytes, err = json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
			}
		}

		updateLedger := false
		if f.Argument(3) != goja.Undefined() {
			updateLedger = getJsBool(r, f.Argument(3))
		}

		results, err := UpdateWallets(n.ctx, n.logger, n.db, []*walletUpdate{{
			UserID:    uid,
			Changeset: changesetMap,
			Metadata:  string(metadataBytes),
		}}, updateLedger)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet: %s", err.Error())))
		}

		if len(results) == 0 {
			panic(r.NewTypeError("user not found"))
		}

		return r.ToValue(map[string]interface{}{
			"updated":  results[0].Updated,
			"previous": results[0].Previous,
			"userId":   results[0].UserID,
		})
	}
}

// @group wallets
// @summary Update one or more user wallets with individual changesets. This function will also insert a new wallet ledger item into each user's wallet history that tracks their update.
// @param updates(type=nkruntime.WalletUpdate[]) The set of user wallet update operations to apply.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this update in the ledger.
// @return updateWallets(nkruntime.WalletUpdateResult[]) A list of wallet update results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) walletsUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		updates, err := exportToSlice[[]map[string]any](f.Argument(0))
		if err != nil {
			panic(r.NewTypeError("expects an array of wallet update objects"))
		}

		updatesMap := make([]*walletUpdate, 0, len(updates))
		for _, updateMap := range updates {
			update := &walletUpdate{}

			uidRaw, ok := updateMap["userId"]
			if !ok {
				panic(r.NewTypeError("expects a user id"))
			}
			uid, ok := uidRaw.(string)
			if !ok {
				panic(r.NewTypeError("expects a valid user id"))
			}
			userID, err := uuid.FromString(uid)
			if err != nil {
				panic(r.NewTypeError("expects a valid user id"))
			}
			update.UserID = userID

			changeSetRaw, ok := updateMap["changeset"]
			if !ok {
				panic(r.NewTypeError("expects changeset object"))
			}
			changeSetMap, ok := changeSetRaw.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects changeset object"))
			}
			changeSet := make(map[string]int64)
			for k, v := range changeSetMap {
				i64, ok := v.(int64)
				if !ok {
					panic(r.NewTypeError("expects changeset values to be whole numbers"))
				}
				changeSet[k] = i64
			}
			update.Changeset = changeSet

			metadataBytes := []byte("{}")
			metadataRaw, ok := updateMap["metadata"]
			if ok {
				metadataMap, ok := metadataRaw.(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects metadata object"))
				}
				metadataBytes, err = json.Marshal(metadataMap)
				if err != nil {
					panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
				}
			}
			update.Metadata = string(metadataBytes)

			updatesMap = append(updatesMap, update)
		}

		updateLedger := false
		if f.Argument(1) != goja.Undefined() {
			updateLedger = getJsBool(r, f.Argument(1))
		}

		results, err := UpdateWallets(n.ctx, n.logger, n.db, updatesMap, updateLedger)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet: %s", err.Error())))
		}

		retResults := make([]map[string]interface{}, 0, len(results))
		for _, r := range results {
			retResults = append(retResults,
				map[string]interface{}{
					"updated":  r.Updated,
					"previous": r.Previous,
					"userId":   r.UserID,
				},
			)
		}

		return r.ToValue(retResults)
	}
}

// @group wallets
// @summary Update the metadata for a particular wallet update in a user's wallet ledger history. Useful when adding a note to a transaction for example.
// @param itemID(type=string) The ID of the wallet ledger item to update.
// @param metadata(type=object) The new metadata to set on the wallet ledger item.
// @return updateWalletLedger(nkruntime.WalletLedgerItem) The updated wallet ledger item.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) walletLedgerUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		// Parse ledger ID.
		itemID := getJsString(r, f.Argument(0))
		if itemID == "" {
			panic(r.NewTypeError("expects a valid id"))
		}
		iid, err := uuid.FromString(itemID)
		if err != nil {
			panic(r.NewTypeError("expects a valid id"))
		}

		metadata, ok := f.Argument(1).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects metadata object"))
		}
		metadataBytes, err := json.Marshal(metadata)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
		}
		item, err := UpdateWalletLedger(n.ctx, n.logger, n.db, iid, string(metadataBytes))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet ledger: %s", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"id":         itemID,
			"userId":     item.UserID,
			"createTime": item.CreateTime,
			"updateTime": item.UpdateTime,
			"changeset":  metadata,
			"metadata":   item.Metadata,
		})
	}
}

// @group status
// @summary Follow a player's status changes on a given session.
// @param sessionID(type=string) A valid session identifier.
// @param userIDs(type=string[]) A list of userIDs to follow.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) statusFollow(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		sessionID := getJsString(r, f.Argument(0))

		suid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("expects a valid session id"))
		}

		userIDs := f.Argument(1)

		uidsSlice, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		if len(uidsSlice) == 0 {
			return goja.Undefined()
		}

		uids := make(map[uuid.UUID]struct{}, len(uidsSlice))
		for _, id := range uidsSlice {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects a valid user id"))
			}
			uids[uid] = struct{}{}
		}

		n.statusRegistry.Follow(suid, uids)

		return nil
	}
}

// @group status
// @summary Unfollow a player's status changes on a given session.
// @param sessionID(type=string) A valid session identifier.
// @param userIDs(type=string[]) A list of userIDs to unfollow.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) statusUnfollow(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		sessionID := getJsString(r, f.Argument(0))

		suid, err := uuid.FromString(sessionID)
		if err != nil {
			panic(r.NewTypeError("expects a valid session id"))
		}

		userIDs := f.Argument(1)

		uidsSlice, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		if len(uidsSlice) == 0 {
			return goja.Undefined()
		}

		uids := make([]uuid.UUID, 0, len(uidsSlice))
		for _, id := range uidsSlice {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects a valid user id"))
			}
			uids = append(uids, uid)
		}

		n.statusRegistry.Unfollow(suid, uids)

		return nil
	}
}

// @group wallets
// @summary List all wallet updates for a particular user from oldest to newest.
// @param userID(type=string) The ID of the user to list wallet updates for.
// @param limit(type=number, optional=true, default=100) Limit number of results.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return runtimeItems(nkruntime.WalletLedgerItem[]) A JavaScript Object containing wallet entries with Id, UserId, CreateTime, UpdateTime, Changeset, Metadata parameters, and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) walletLedgerList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a valid user id"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects a valid user id"))
		}

		limit := 100
		if f.Argument(1) != goja.Undefined() {
			limit = int(getJsInt(r, f.Argument(1)))
		}

		cursor := ""
		if f.Argument(2) != goja.Undefined() {
			cursor = getJsString(r, f.Argument(2))
		}

		items, newCursor, _, err := ListWalletLedger(n.ctx, n.logger, n.db, uid, &limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to retrieve user wallet ledger: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(items))
		for _, item := range items {
			results = append(results, map[string]interface{}{
				"id":         item.ID,
				"userId":     userID,
				"createTime": item.CreateTime,
				"updateTime": item.UpdateTime,
				"changeset":  item.Changeset,
				"metadata":   item.Metadata,
			})
		}

		returnObj := map[string]interface{}{
			"items": results,
		}
		if newCursor == "" {
			returnObj["cursor"] = nil
		} else {
			returnObj["cursor"] = newCursor
		}

		return r.ToValue(returnObj)
	}
}

// @group storage
// @summary List records in a collection and page through results. The records returned can be filtered to those owned by the user or "" for public records.
// @param userID(type=string) User ID to list records for or "" (empty string) for public records.
// @param collection(type=string) Collection to list data from.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return objects(nkruntime.StorageObjectList) A list of storage objects.
// @return cursor(string) Pagination cursor. Will be set to "" or null when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) storageList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var uid *uuid.UUID
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			userID := getJsString(r, f.Argument(0))
			u, err := uuid.FromString(userID)
			if err != nil {
				panic(r.NewTypeError("expects empty or valid user id"))
			}
			uid = &u
		}

		collection := ""
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			collection = getJsString(r, f.Argument(1))
		}

		limit := 100
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(2)))
		}
		if limit < 0 {
			panic(r.NewTypeError("limit must not be negative"))
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			callerID := getJsString(r, f.Argument(4))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		objectList, _, err := StorageListObjects(n.ctx, n.logger, n.db, callerIDValue, uid, collection, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list storage objects: %s", err.Error())))
		}

		objects := make([]interface{}, 0, len(objectList.Objects))
		for _, o := range objectList.Objects {
			objectMap := make(map[string]interface{}, 9)
			objectMap["key"] = o.Key
			objectMap["collection"] = o.Collection
			if o.UserId != "" {
				objectMap["userId"] = o.UserId
			} else {
				objectMap["userId"] = nil
			}
			objectMap["version"] = o.Version
			objectMap["permissionRead"] = o.PermissionRead
			objectMap["permissionWrite"] = o.PermissionWrite
			objectMap["createTime"] = o.CreateTime.Seconds
			objectMap["updateTime"] = o.UpdateTime.Seconds

			valueMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(o.Value), &valueMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert value to json: %s", err.Error())))
			}
			pointerizeSlices(valueMap)
			objectMap["value"] = valueMap

			objects = append(objects, objectMap)
		}

		returnObj := map[string]interface{}{
			"objects": objects,
		}
		if objectList.Cursor == "" {
			returnObj["cursor"] = nil
		} else {
			returnObj["cursor"] = objectList.Cursor
		}

		return r.ToValue(returnObj)
	}
}

// @group storage
// @summary Fetch one or more records by their bucket/collection/keyname and optional user.
// @param objectIDs(type=nkruntime.StorageReadRequest[]) An array of object identifiers to be fetched.
// @return objects(nkruntime.StorageObject[]) A list of storage records matching the parameters criteria.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) storageRead(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		objectIDs := f.Argument(0)
		if objectIDs == goja.Undefined() || objectIDs == goja.Null() {
			panic(r.NewTypeError("expects an array ok keys"))
		}

		keysSlice, err := exportToSlice[[]map[string]any](objectIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of keys"))
		}

		if len(keysSlice) == 0 {
			return r.ToValue([]any{})
		}

		objectIDsMap := make([]*api.ReadStorageObjectId, 0, len(keysSlice))
		for _, objMap := range keysSlice {
			objectID := &api.ReadStorageObjectId{}

			if collectionIn, ok := objMap["collection"]; ok {
				collection, ok := collectionIn.(string)
				if !ok {
					panic(r.NewTypeError("expects 'collection' value to be a string"))
				}
				if collectionIn == "" {
					panic(r.NewTypeError("expects 'collection' value to be a non empty string"))
				}
				objectID.Collection = collection
			}

			if keyIn, ok := objMap["key"]; ok {
				key, ok := keyIn.(string)
				if !ok {
					panic(r.NewTypeError("expects 'key' value to be a string"))
				}
				objectID.Key = key
			}

			if userID, ok := objMap["userId"]; ok {
				userIDStr, ok := userID.(string)
				if !ok {
					panic(r.NewTypeError("expects 'userId' value to be a string"))
				}
				_, err := uuid.FromString(userIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'userId' value to be a valid id"))
				}
				objectID.UserId = userIDStr
			}

			if objectID.UserId == "" {
				// Default to server-owned data if no owner is supplied.
				objectID.UserId = uuid.Nil.String()
			}

			objectIDsMap = append(objectIDsMap, objectID)
		}

		objects, err := StorageReadObjects(n.ctx, n.logger, n.db, uuid.Nil, objectIDsMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to read storage objects: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(objects.Objects))
		for _, o := range objects.GetObjects() {
			oMap := make(map[string]interface{})

			oMap["key"] = o.Key
			oMap["collection"] = o.Collection
			if o.UserId != "" {
				oMap["userId"] = o.UserId
			} else {
				oMap["userId"] = nil
			}
			oMap["version"] = o.Version
			oMap["permissionRead"] = o.PermissionRead
			oMap["permissionWrite"] = o.PermissionWrite
			oMap["createTime"] = o.CreateTime.Seconds
			oMap["updateTime"] = o.UpdateTime.Seconds

			valueMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(o.Value), &valueMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert value to json: %s", err.Error())))
			}
			pointerizeSlices(valueMap)
			oMap["value"] = valueMap

			results = append(results, oMap)
		}

		return r.ToValue(results)
	}
}

// @group storage
// @summary Write one or more objects by their collection/keyname and optional user.
// @param objectIDs(type=nkruntime.StorageWriteRequest[]) An array of object identifiers to be written.
// @return acks(nkruntime.StorageWriteAck[]) A list of acks with the version of the written objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) storageWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		objectIDs := f.Argument(0)
		if objectIDs == goja.Undefined() || objectIDs == goja.Null() {
			panic(r.NewTypeError("expects a valid array of data"))
		}

		dataSlice, err := exportToSlice[[]map[string]any](objectIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of storage write objects"))
		}

		ops, err := jsArrayToStorageOpWrites(dataSlice)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		acks, _, err := StorageWriteObjects(n.ctx, n.logger, n.db, n.metrics, n.storageIndex, true, ops)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to write storage objects: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(acks.Acks))
		for _, ack := range acks.Acks {
			result := make(map[string]interface{}, 4)
			result["key"] = ack.Key
			result["collection"] = ack.Collection
			result["userId"] = ack.UserId
			result["version"] = ack.Version

			results = append(results, result)
		}

		return r.ToValue(results)
	}
}

func jsArrayToStorageOpWrites(dataSlice []map[string]any) (StorageOpWrites, error) {
	ops := make(StorageOpWrites, 0, len(dataSlice))
	for _, dataMap := range dataSlice {
		var userID uuid.UUID
		writeOp := &api.WriteStorageObject{}

		if collectionIn, ok := dataMap["collection"]; ok {
			collection, ok := collectionIn.(string)
			if !ok {
				return nil, errors.New("expects 'collection' value to be a string")
			}
			if collection == "" {
				return nil, errors.New("expects 'collection' value to be non-empty")
			}
			writeOp.Collection = collection
		}

		keyIn := dataMap["key"]
		key, ok := keyIn.(string)
		if !ok {
			return nil, errors.New("expects 'key' value to be a string")
		}
		if key == "" {
			return nil, errors.New("expects 'key' value to be non-empty")
		}
		writeOp.Key = key

		userIDIn := dataMap["userId"]
		if userIDIn == nil {
			userID = uuid.Nil
		} else {
			userIDStr, ok := userIDIn.(string)
			if !ok {
				return nil, errors.New("expects 'userId' value to be a string")
			}
			var err error
			userID, err = uuid.FromString(userIDStr)
			if err != nil {
				return nil, errors.New("expects 'userId' value to be a valid id")
			}
		}

		valueIn := dataMap["value"]
		valueMap, ok := valueIn.(map[string]interface{})
		if !ok {
			return nil, errors.New("expects 'value' value to be an object")
		}
		valueBytes, err := json.Marshal(valueMap)
		if err != nil {
			return nil, fmt.Errorf("failed to convert value: %s", err.Error())
		}
		writeOp.Value = string(valueBytes)

		if versionIn := dataMap["version"]; versionIn != nil {
			version, ok := versionIn.(string)
			if !ok {
				return nil, errors.New("expects 'version' value to be a string")
			}
			if version == "" {
				return nil, errors.New("expects 'version' value to be a non-empty string")
			}
			writeOp.Version = version
		}

		if permissionReadIn, ok := dataMap["permissionRead"]; ok {
			permissionRead, ok := permissionReadIn.(int64)
			if !ok {
				return nil, errors.New("expects 'permissionRead' value to be a number")
			}
			writeOp.PermissionRead = &wrapperspb.Int32Value{Value: int32(permissionRead)}
		} else {
			writeOp.PermissionRead = &wrapperspb.Int32Value{Value: 1}
		}

		if permissionWriteIn, ok := dataMap["permissionWrite"]; ok {
			permissionWrite, ok := permissionWriteIn.(int64)
			if !ok {
				return nil, errors.New("expects 'permissionWrite' value to be a number")
			}
			writeOp.PermissionWrite = &wrapperspb.Int32Value{Value: int32(permissionWrite)}
		} else {
			writeOp.PermissionWrite = &wrapperspb.Int32Value{Value: 1}
		}

		if writeOp.Collection == "" {
			return nil, errors.New("expects collection to be supplied")
		} else if writeOp.Key == "" {
			return nil, errors.New("expects key to be supplied")
		} else if writeOp.Value == "" {
			return nil, errors.New("expects value to be supplied")
		}

		ops = append(ops, &StorageOpWrite{
			OwnerID: userID.String(),
			Object:  writeOp,
		})
	}

	return ops, nil
}

// @group storage
// @summary Remove one or more objects by their collection/keyname and optional user.
// @param objectIDs(type=nkruntime.StorageDeleteRequest[]) An array of object identifiers to be deleted.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) storageDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		objectIDs := f.Argument(0)
		if objectIDs == goja.Undefined() {
			panic(r.NewTypeError("expects an array ok keys"))
		}
		keysSlice, err := exportToSlice[[]map[string]any](objectIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of keys"))
		}

		ops := make(StorageOpDeletes, 0, len(keysSlice))
		for _, dataMap := range keysSlice {
			var userID uuid.UUID
			objectID := &api.DeleteStorageObjectId{}

			if collectionIn, ok := dataMap["collection"]; ok {
				collection, ok := collectionIn.(string)
				if !ok {
					panic(r.NewTypeError("expects 'collection' value to be a string"))
				}
				if collection == "" {
					panic(r.NewTypeError("expects 'collection' value to be non-empty"))
				}
				objectID.Collection = collection
			}

			if keyIn, ok := dataMap["key"]; ok {
				key, ok := keyIn.(string)
				if !ok {
					panic(r.NewTypeError("expects 'key' value to be a string"))
				}
				if key == "" {
					panic(r.NewTypeError("expects 'key' value to be non-empty"))
				}
				objectID.Key = key
			}

			if uid, ok := dataMap["userId"]; ok {
				userIDStr, ok := uid.(string)
				if !ok {
					panic(r.NewTypeError("expects 'userId' value to be a string"))
				}
				var err error
				userID, err = uuid.FromString(userIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'userId' value to be a valid id"))
				}
			}

			if versionIn, ok := dataMap["version"]; ok {
				version, ok := versionIn.(string)
				if !ok {
					panic(r.NewTypeError("expects 'version' value to be a string"))
				}
				if version == "" {
					panic(r.NewTypeError("expects 'version' value to be a non-empty string"))
				}
				objectID.Version = version
			}

			if objectID.Collection == "" {
				panic(r.NewTypeError("expects collection to be supplied"))
			} else if objectID.Key == "" {
				panic(r.NewTypeError("expects key to be supplied"))
			}

			ops = append(ops, &StorageOpDelete{
				OwnerID:  userID.String(),
				ObjectID: objectID,
			})
		}

		if _, err := StorageDeleteObjects(n.ctx, n.logger, n.db, n.storageIndex, true, ops); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to remove storage: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group users
// @summary Update account, storage, and wallet information simultaneously.
// @param accountUpdates(type=nkruntime.AccountUpdate[]) Array of account information to be updated.
// @param storageWrites(type=nkruntime.StorageWriteRequest[]) Array of storage objects to be updated.
// @param storageDeletes(type=nkruntime.StorageDeleteRequest[]) Array of storage objects to be deleted.
// @param walletUpdates(type=nkruntime.WalletUpdate[]) Array of wallet updates to be made.
// @param updateLedger(type=bool, optional=true, default=false) Whether to record this wallet update in the ledger.
// @return storageWriteAcks(nkruntime.StorageWriteAck[]) A list of acks with the version of the written objects.
// @return walletUpdateAcks(nkruntime.WalletUpdateResult[]) A list of wallet updates results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) multiUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		// Process account update inputs.
		var accountUpdatesArray []*accountUpdate
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			accountUpdates, err := exportToSlice[[]map[string]any](f.Argument(0))
			if err != nil {
				panic(r.NewTypeError("expects an array of account updates"))
			}

			accountUpdatesArray = make([]*accountUpdate, 0, len(accountUpdates))
			for _, accUpdateObj := range accountUpdates {
				update := &accountUpdate{}
				if userIDIn, ok := accUpdateObj["userId"]; ok {
					userIDStr, ok := userIDIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'userId' value to be a string"))
					}
					uid, err := uuid.FromString(userIDStr)
					if err != nil {
						panic(r.NewTypeError("expects 'userId' value to be a valid id"))
					}
					update.userID = uid
				}

				if usernameIn, ok := accUpdateObj["username"]; ok {
					username, ok := usernameIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.username = username
				}

				if displayNameIn, ok := accUpdateObj["displayName"]; ok {
					displayNameStr, ok := displayNameIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.displayName = &wrapperspb.StringValue{Value: displayNameStr}
				}

				if timezoneIn, ok := accUpdateObj["timezone"]; ok {
					timezoneStr, ok := timezoneIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.timezone = &wrapperspb.StringValue{Value: timezoneStr}
				}

				if locationIn, ok := accUpdateObj["location"]; ok {
					locationStr, ok := locationIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.location = &wrapperspb.StringValue{Value: locationStr}
				}

				if langIn, ok := accUpdateObj["langTag"]; ok {
					langStr, ok := langIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.langTag = &wrapperspb.StringValue{Value: langStr}
				}

				if avatarIn, ok := accUpdateObj["avatarUrl"]; ok {
					avatarStr, ok := avatarIn.(string)
					if !ok {
						panic(r.NewTypeError("expects a string"))
					}
					update.avatarURL = &wrapperspb.StringValue{Value: avatarStr}
				}

				if metadataIn, ok := accUpdateObj["metadata"]; ok {
					metadataMap, ok := metadataIn.(map[string]interface{})
					if !ok {
						panic(r.NewTypeError("expects metadata to be a key value object"))
					}
					metadataBytes, err := json.Marshal(metadataMap)
					if err != nil {
						panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
					}
					update.metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
				}

				accountUpdatesArray = append(accountUpdatesArray, update)
			}
		}

		// Process storage update inputs.
		var storageWriteOps StorageOpWrites
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			storageWrites := f.Argument(1)
			dataSlice, err := exportToSlice[[]map[string]any](storageWrites)
			if err != nil {
				panic(r.ToValue(r.NewTypeError("expects a valid array of data")))
			}

			storageWriteOps = make(StorageOpWrites, 0, len(dataSlice))
			for _, dataMap := range dataSlice {
				var userID uuid.UUID
				writeOp := &api.WriteStorageObject{}

				if collectionIn, ok := dataMap["collection"]; ok {
					collection, ok := collectionIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'collection' value to be a string"))
					}
					if collection == "" {
						panic(r.NewTypeError("expects 'collection' value to be non-empty"))
					}
					writeOp.Collection = collection
				}

				if keyIn, ok := dataMap["key"]; ok {
					key, ok := keyIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'key' value to be a string"))
					}
					if key == "" {
						panic(r.NewTypeError("expects 'key' value to be non-empty"))
					}
					writeOp.Key = key
				}

				if userIDIn, ok := dataMap["userId"]; ok {
					userIDStr, ok := userIDIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'userId' value to be a string"))
					}
					var err error
					userID, err = uuid.FromString(userIDStr)
					if err != nil {
						panic(r.NewTypeError("expects 'userId' value to be a valid id"))
					}
				}

				if valueIn, ok := dataMap["value"]; ok {
					valueMap, ok := valueIn.(map[string]interface{})
					if !ok {
						panic(r.NewTypeError("expects 'value' value to be an object"))
					}
					valueBytes, err := json.Marshal(valueMap)
					if err != nil {
						panic(r.NewGoError(fmt.Errorf("failed to convert value: %s", err.Error())))
					}
					writeOp.Value = string(valueBytes)
				}

				if versionIn, ok := dataMap["version"]; ok {
					version, ok := versionIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'version' value to be a string"))
					}
					if version == "" {
						panic(r.NewTypeError("expects 'version' value to be a non-empty string"))
					}
					writeOp.Version = version
				}

				if permissionReadIn, ok := dataMap["permissionRead"]; ok {
					permissionRead, ok := permissionReadIn.(int64)
					if !ok {
						panic(r.NewTypeError("expects 'permissionRead' value to be a number"))
					}
					writeOp.PermissionRead = &wrapperspb.Int32Value{Value: int32(permissionRead)}
				} else {
					writeOp.PermissionRead = &wrapperspb.Int32Value{Value: 1}
				}

				if permissionWriteIn, ok := dataMap["permissionWrite"]; ok {
					permissionWrite, ok := permissionWriteIn.(int64)
					if !ok {
						panic(r.NewTypeError("expects 'permissionWrite' value to be a number"))
					}
					writeOp.PermissionWrite = &wrapperspb.Int32Value{Value: int32(permissionWrite)}
				} else {
					writeOp.PermissionWrite = &wrapperspb.Int32Value{Value: 1}
				}

				if writeOp.Collection == "" {
					panic(r.NewTypeError("expects collection to be supplied"))
				} else if writeOp.Key == "" {
					panic(r.NewTypeError("expects key to be supplied"))
				} else if writeOp.Value == "" {
					panic(r.NewTypeError("expects value to be supplied"))
				}

				storageWriteOps = append(storageWriteOps, &StorageOpWrite{
					OwnerID: userID.String(),
					Object:  writeOp,
				})
			}
		}

		// Process storage delete inputs.
		var storageDeleteOps StorageOpDeletes
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			storageDeletes := f.Argument(2)
			dataSlice, err := exportToSlice[[]map[string]any](storageDeletes)
			if err != nil {
				panic(r.ToValue(r.NewTypeError("expects a valid array of data")))
			}

			storageDeleteOps = make(StorageOpDeletes, 0, len(dataSlice))
			for _, dataMap := range dataSlice {
				var userID uuid.UUID
				deleteOp := &api.DeleteStorageObjectId{}

				if collectionIn, ok := dataMap["collection"]; ok {
					collection, ok := collectionIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'collection' value to be a string"))
					}
					if collection == "" {
						panic(r.NewTypeError("expects 'collection' value to be non-empty"))
					}
					deleteOp.Collection = collection
				}

				if keyIn, ok := dataMap["key"]; ok {
					key, ok := keyIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'key' value to be a string"))
					}
					if key == "" {
						panic(r.NewTypeError("expects 'key' value to be non-empty"))
					}
					deleteOp.Key = key
				}

				if userIDIn, ok := dataMap["userId"]; ok {
					userIDStr, ok := userIDIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'userId' value to be a string"))
					}
					var err error
					userID, err = uuid.FromString(userIDStr)
					if err != nil {
						panic(r.NewTypeError("expects 'userId' value to be a valid id"))
					}
				}

				if versionIn, ok := dataMap["version"]; ok {
					version, ok := versionIn.(string)
					if !ok {
						panic(r.NewTypeError("expects 'version' value to be a string"))
					}
					if version == "" {
						panic(r.NewTypeError("expects 'version' value to be a non-empty string"))
					}
					deleteOp.Version = version
				}

				if deleteOp.Collection == "" {
					panic(r.NewTypeError("expects collection to be supplied"))
				} else if deleteOp.Key == "" {
					panic(r.NewTypeError("expects key to be supplied"))
				}

				storageDeleteOps = append(storageDeleteOps, &StorageOpDelete{
					OwnerID:  userID.String(),
					ObjectID: deleteOp,
				})
			}
		}

		// Process wallet update inputs.
		var walletUpdateOps []*walletUpdate
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			walletUpdates := f.Argument(3)

			updates, err := exportToSlice[[]map[string]any](walletUpdates)
			if err != nil {
				panic(r.NewTypeError("expects an array of wallet update objects"))
			}

			walletUpdateOps = make([]*walletUpdate, 0, len(updates))
			for _, updateMap := range updates {
				update := &walletUpdate{}

				uidRaw, ok := updateMap["userId"]
				if !ok {
					panic(r.NewTypeError("expects a user id"))
				}
				uid, ok := uidRaw.(string)
				if !ok {
					panic(r.NewTypeError("expects a valid user id"))
				}
				userID, err := uuid.FromString(uid)
				if err != nil {
					panic(r.NewTypeError("expects a valid user id"))
				}
				update.UserID = userID

				changeSetRaw, ok := updateMap["changeset"]
				if !ok {
					panic(r.NewTypeError("expects changeset object"))
				}
				changeSetMap, ok := changeSetRaw.(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects changeset object"))
				}
				changeSet := make(map[string]int64)
				for k, v := range changeSetMap {
					i64, ok := v.(int64)
					if !ok {
						panic(r.NewTypeError("expects changeset values to be whole numbers"))
					}
					changeSet[k] = i64
				}
				update.Changeset = changeSet

				metadataBytes := []byte("{}")
				metadataRaw, ok := updateMap["metadata"]
				if ok {
					metadataMap, ok := metadataRaw.(map[string]interface{})
					if !ok {
						panic(r.NewTypeError("expects metadata object"))
					}
					metadataBytes, err = json.Marshal(metadataMap)
					if err != nil {
						panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
					}
				}
				update.Metadata = string(metadataBytes)

				walletUpdateOps = append(walletUpdateOps, update)
			}
		}

		updateLedger := false
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			updateLedger = getJsBool(r, f.Argument(4))
		}

		acks, results, err := MultiUpdate(n.ctx, n.logger, n.db, n.metrics, accountUpdatesArray, storageWriteOps, storageDeleteOps, n.storageIndex, walletUpdateOps, updateLedger)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error running multi update: %s", err.Error())))
		}

		storgeWritesResults := make([]interface{}, 0, len(acks))
		for _, ack := range acks {
			result := make(map[string]interface{}, 4)
			result["key"] = ack.Key
			result["collection"] = ack.Collection
			if ack.UserId != "" {
				result["userId"] = ack.UserId
			} else {
				result["userId"] = nil
			}
			result["version"] = ack.Version

			storgeWritesResults = append(storgeWritesResults, result)
		}

		updateWalletResults := make([]map[string]interface{}, 0, len(results))
		for _, r := range results {
			updateWalletResults = append(updateWalletResults,
				map[string]interface{}{
					"updated":  r.Updated,
					"previous": r.Previous,
					"userId":   r.UserID,
				},
			)
		}

		returnObj := map[string]interface{}{
			"walletUpdateAcks": updateWalletResults,
			"storageWriteAcks": storgeWritesResults,
		}

		return r.ToValue(returnObj)
	}
}

// @group leaderboards
// @summary Set up a new dynamic leaderboard with the specified ID and various configuration settings. The leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param leaderboardID(type=string) The unique identifier for the new leaderboard. This is used by clients to submit scores.
// @param authoritative(type=bool, optional=true, default=false) Mark the leaderboard as authoritative which ensures updates can only be made via the Go runtime. No client can submit a score directly.
// @param sortOrder(type=string, optional=true, default="desc") The sort order for records in the leaderboard. Possible values are "asc" or "desc".
// @param operator(type=string, optional=true, default="best") The operator that determines how scores behave when submitted. Possible values are "best", "set", or "incr".
// @param resetSchedule(type=string, optional=true) The cron format used to define the reset schedule for the leaderboard. This controls when a leaderboard is reset and can be used to power daily/weekly/monthly leaderboards.
// @param metadataMap(type=object, optional=true) The metadata you want associated to the leaderboard. Some good examples are weather conditions for a racing game.
// @param enableRanks(type=bool, optional=true, default=false) Whether to enable rank values for the leaderboard.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		leaderboardID := getJsString(r, f.Argument(0))
		if leaderboardID == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		authoritative := false
		if f.Argument(1) != goja.Undefined() {
			authoritative = getJsBool(r, f.Argument(1))
		}

		sortOrder := "desc"
		if f.Argument(2) != goja.Undefined() {
			sortOrder = getJsString(r, f.Argument(2))
		}

		var sortOrderNumber int
		switch sortOrder {
		case "asc", "ascending":
			sortOrderNumber = LeaderboardSortOrderAscending
		case "desc", "descending":
			sortOrderNumber = LeaderboardSortOrderDescending
		default:
			panic(r.NewTypeError("expects sort order to be 'asc' or 'desc'"))
		}

		operator := "best"
		if f.Argument(3) != goja.Undefined() {
			operator = getJsString(r, f.Argument(3))
		}
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
			panic(r.NewTypeError("expects operator to be 'best', 'set', 'decr' or 'incr'"))
		}

		resetSchedule := ""
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			resetSchedule = getJsString(r, f.Argument(4))
		}
		if resetSchedule != "" {
			if _, err := cronexpr.Parse(resetSchedule); err != nil {
				panic(r.NewTypeError("expects reset schedule to be a valid CRON expression"))
			}
		}

		metadata := "{}"
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			metadataMap, ok := f.Argument(5).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("error encoding metadata: %v", err.Error())))
			}
			metadata = string(metadataBytes)
		}

		enableRanks := false
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			enableRanks = getJsBool(r, f.Argument(6))
		}

		_, created, err := n.leaderboardCache.Create(n.ctx, leaderboardID, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadata, enableRanks)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating leaderboard: %v", err.Error())))
		}

		if created {
			// Only need to update the scheduler for newly created leaderboards.
			n.leaderboardScheduler.Update()
		}

		return goja.Undefined()
	}
}

// @group leaderboards
// @summary Delete a leaderboard and all scores that belong to it.
// @param id(type=string) The unique identifier for the leaderboard to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		_, err := n.leaderboardCache.Delete(n.ctx, n.rankCache, n.leaderboardScheduler, id)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting leaderboard: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group leaderboards
// @summary Find leaderboards which have been created on the server. Leaderboards can be filtered with categories.
// @param limit(type=number, optional=true, default=10) Return only the required number of leaderboards denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return leaderboardList(nkruntime.LeaderboardList[]) A list of leaderboard results and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		limit := 10
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(0)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		var cursorValue *LeaderboardListCursor
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			cursor := getJsString(r, f.Argument(1))
			cb, err := base64.URLEncoding.DecodeString(cursor)
			if err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
			cursorValue = &LeaderboardListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursorValue); err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
		}

		list, err := LeaderboardList(n.logger, n.leaderboardCache, limit, cursorValue)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing leaderboards: %v", err.Error())))
		}

		results := make([]interface{}, 0, len(list.Leaderboards))
		for _, leaderboard := range list.Leaderboards {
			t, err := leaderboardToJsObject(leaderboard)
			if err != nil {
				panic(r.NewGoError(err))
			}

			results = append(results, t)
		}

		resultMap := make(map[string]interface{}, 2)

		if list.Cursor == "" {
			resultMap["cursor"] = nil
		} else {
			resultMap["cursor"] = list.Cursor
		}

		resultMap["leaderboards"] = results

		return r.ToValue(resultMap)
	}
}

// @group leaderboards
// @summary Disable a leaderboard rank cache freeing its allocated resources. If already disabled is a NOOP.
// @param id(type=string) The leaderboard id.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRanksDisable(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		if err := disableLeaderboardRanks(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, id); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

// @group leaderboards
// @summary List records on the specified leaderboard, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured leaderboard sort order.
// @param id(type=string) The unique identifier for the leaderboard to list. Mandatory field.
// @param ownerIDs(type=string[]) Array of owners to filter to.
// @param limitNumber(type=number) The maximum number of records to return (Max 10,000).
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param overrideExpiry(type=int, optional=true) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0.
// @return records(nkruntime.LeaderboardRecord[]) A page of leaderboard records.
// @return ownerRecords(nkruntime.LeaderboardRecord[]) A list of owner leaderboard records (empty if the owners input parameter is not set).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or null when fetching last available page.
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRecordsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		var ownerIDsArray []string
		ownerIDs := f.Argument(1)
		if ownerIDs != goja.Undefined() && ownerIDs != goja.Null() {
			var err error
			ownerIDsArray, err = exportToSlice[[]string](ownerIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of user ids"))
			}

			for _, owner := range ownerIDsArray {
				if _, err := uuid.FromString(owner); err != nil {
					panic(r.NewTypeError("expects a valid owner id"))
				}
			}
		}

		var limitNumber int32
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			limitNumber = int32(getJsInt(r, f.Argument(2)))
		}
		var limit *wrapperspb.Int32Value
		if limitNumber != 0 {
			limit = &wrapperspb.Int32Value{Value: limitNumber}
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		overrideExpiry := int64(0)
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			overrideExpiry = getJsInt(r, f.Argument(4))
		}

		records, err := LeaderboardRecordsList(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, id, limit, cursor, ownerIDsArray, overrideExpiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing leaderboard records: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount)
	}
}

// @group leaderboards
// @summary Build a cursor to be used with leaderboardRecordsList to fetch records starting at a given rank. Only available if rank cache is not disabled for the leaderboard.
// @param leaderboardID(type=string) The unique identifier of the leaderboard.
// @param rank(type=number) The rank to start listing leaderboard records from.
// @param overrideExpiry(type=number, optional=true) Records with expiry in the past are not returned unless within this defined limit. Must be equal or greater than 0.
// @return leaderboardListCursor(string) A string cursor to be used with leaderboardRecordsList.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRecordsListCursorFromRank(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		leaderboardID := getJsString(r, f.Argument(0))
		rank := getJsInt(r, f.Argument(1))

		if leaderboardID == "" {
			panic(r.NewTypeError("invalid leaderboard id"))
		}

		if rank < 1 {
			panic(r.NewTypeError("invalid rank - must be > 1"))
		}

		var overrideExpiry int64
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			overrideExpiry = getJsInt(r, f.Argument(2))
		}

		l := n.leaderboardCache.Get(leaderboardID)
		if l == nil {
			panic(r.NewTypeError(ErrLeaderboardNotFound.Error()))
		}

		expiryTime, ok := calculateExpiryOverride(overrideExpiry, l)
		if !ok {
			panic(r.NewTypeError("invalid expiry"))
		}

		rank-- // Fetch previous entry to include requested rank in the results

		if rank == 0 {
			return r.ToValue("")
		}

		ownerId, score, subscore, err := n.rankCache.GetDataByRank(leaderboardID, expiryTime, l.SortOrder, rank)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get cursor from rank: %s", err.Error())))
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
			panic(r.NewGoError(fmt.Errorf("failed to marshal leaderboard cursor: %s", err.Error())))
		}

		return r.ToValue(cursorStr)
	}
}

// @group leaderboards
// @summary Use the preconfigured operator for the given leaderboard to submit a score for a particular user.
// @param id(type=string) The unique identifier for the leaderboard to submit to.
// @param ownerID(type=string) The owner of this score submission.
// @param username(type=string, optional=true) The owner username of this score submission, if it's a user.
// @param score(type=number, optional=true, default=0) The score to submit.
// @param subscore(type=number, optional=true, default=0) A secondary subscore parameter for the submission.
// @param metadata(type=object, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param overrideOperator(type=nkruntime.OverrideOperator, optional=true) An override operator for the new record. The accepted values include: 0 (no override), 1 (best), 2 (set), 3 (incr), 4 (decr).
// @return record(nkruntime.LeaderboardRecord) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRecordWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(ownerID); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		username := ""
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			username = getJsString(r, f.Argument(2))
		}

		var score int64
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			score = getJsInt(r, f.Argument(3))
		}

		var subscore int64
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			subscore = getJsInt(r, f.Argument(4))
		}

		metadata := f.Argument(5)
		metadataStr := ""
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := metadata.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("error encoding metadata: %v", err.Error())))
			}
			metadataStr = string(metadataBytes)
		}

		overrideOperatorValue := api.Operator_NO_OVERRIDE
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			overrideOperator := strings.ToLower(getJsString(r, f.Argument(6)))
			switch overrideOperator {
			case "best":
				overrideOperatorValue = api.Operator_BEST
			case "set":
				overrideOperatorValue = api.Operator_SET
			case "incr", "increment":
				overrideOperatorValue = api.Operator_INCREMENT
			case "decr", "decrement":
				overrideOperatorValue = api.Operator_DECREMENT
			default:
				panic(r.NewTypeError(ErrInvalidOperator.Error()))
			}
		}

		record, err := LeaderboardRecordWrite(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr, overrideOperatorValue)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error writing leaderboard record: %v", err.Error())))
		}

		return r.ToValue(leaderboardRecordToJsMap(r, record))
	}
}

// @group leaderboards
// @summary Remove an owner's record from a leaderboard, if one exists.
// @param id(type=string) The unique identifier for the leaderboard to delete from.
// @param ownerID(type=string) The owner of the score to delete. Mandatory field.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRecordDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(ownerID); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		if err := LeaderboardRecordDelete(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting leaderboard record: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group leaderboards
// @summary Fetch one or more leaderboards by ID.
// @param leaderboardIDs(type=string[]) The array of leaderboard ids.
// @return leaderboards(nkruntime.Leaderboard[]) The leaderboard records according to ID.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		leaderboardIDs := f.Argument(0)
		if leaderboardIDs == goja.Undefined() || leaderboardIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of leaderboard ids"))
		}
		leaderboardIDsArray, err := exportToSlice[[]string](leaderboardIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		leaderboards := LeaderboardsGet(n.leaderboardCache, leaderboardIDsArray)

		leaderboardsSlice := make([]interface{}, 0, len(leaderboards))
		for _, l := range leaderboards {
			leaderboardMap, err := leaderboardToJsObject(l)
			if err != nil {
				panic(r.NewGoError(err))
			}

			leaderboardsSlice = append(leaderboardsSlice, leaderboardMap)
		}

		return r.ToValue(leaderboardsSlice)
	}
}

// @group leaderboards
// @summary Fetch the list of leaderboard records around the owner.
// @param id(type=string) The unique identifier for the leaderboard.
// @param ownerID(type=string) The owner of the score to list records around. Mandatory field.
// @param limit(type=number) Return only the required number of leaderboard records denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param overrideExpiry(type=number, optional=true, default=0) Optionally retrieve records from previous resets by specifying the reset point in time in UTC seconds. Must be equal or greater than 0.
// @return records(nkruntime.LeaderboardRecordList) The leaderboard records according to ID and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) leaderboardRecordsHaystack(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		uid, err := uuid.FromString(ownerID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		limit := 10
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(2)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		overrideExpiry := int64(0)
		if f.Argument(4) != goja.Undefined() {
			overrideExpiry = getJsInt(r, f.Argument(4))
		}

		records, err := LeaderboardRecordsHaystack(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, id, cursor, uid, limit, overrideExpiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing leaderboard records around owner: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount)
	}
}

// @group purchases
// @summary Validates and stores the purchases present in an Apple App Store Receipt.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param password(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(nkruntime.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchaseValidateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		password := n.config.GetIAP().Apple.SharedPassword
		if f.Argument(3) != goja.Undefined() {
			password = getJsString(r, f.Argument(3))
		}

		if password == "" {
			panic(r.NewGoError(errors.New("apple IAP is not configured")))
		}

		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		receipt := getJsString(r, f.Argument(1))
		if receipt == "" {
			panic(r.NewTypeError("expects receipt"))
		}

		persist := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			persist = getJsBool(r, f.Argument(2))
		}

		validation, err := ValidatePurchasesApple(n.ctx, n.logger, n.db, uid, password, receipt, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Apple receipt: %s", err.Error())))
		}

		validationResult := purchaseResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Google Play Store.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param clientEmail(type=string, optional=true) Override the iap.google.client_email provided in your configuration.
// @param privateKey(type=string, optional=true) Override the iap.google.private_key provided in your configuration.
// @return validation(nkruntime.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchaseValidateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		receipt := getJsString(r, f.Argument(1))
		if receipt == "" {
			panic(r.NewTypeError("expects receipt"))
		}

		persist := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			persist = getJsBool(r, f.Argument(2))
		}

		clientEmail := n.config.GetIAP().Google.ClientEmail
		privateKey := n.config.GetIAP().Google.PrivateKey

		if f.Argument(3) != goja.Undefined() {
			clientEmail = getJsString(r, f.Argument(3))
		}
		if f.Argument(4) != goja.Undefined() {
			privateKey = getJsString(r, f.Argument(4))
		}

		if clientEmail == "" || privateKey == "" {
			panic(r.NewGoError(errors.New("google IAP is not configured")))
		}

		validation, err := ValidatePurchaseGoogle(n.ctx, n.logger, n.db, uid, &IAPGoogleConfig{clientEmail, privateKey, "", 0, ""}, receipt, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Google receipt: %s", err.Error())))
		}

		validationResult := purchaseResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group purchases
// @summary Validates and stores a purchase receipt from the Huawei App Gallery.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) The Huawei receipt data.
// @param signature(type=string) The receipt signature.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(nkruntime.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchaseValidateHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetIAP().Huawei.ClientID == "" ||
			n.config.GetIAP().Huawei.ClientSecret == "" ||
			n.config.GetIAP().Huawei.PublicKey == "" {
			panic(r.NewGoError(errors.New("huawei IAP is not configured")))
		}

		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		receipt := getJsString(r, f.Argument(1))
		if receipt == "" {
			panic(r.NewTypeError("expects receipt"))
		}

		signature := getJsString(r, f.Argument(2))
		if signature == "" {
			panic(r.NewTypeError("expects signature"))
		}

		persist := true
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			persist = getJsBool(r, f.Argument(3))
		}

		validation, err := ValidatePurchaseHuawei(n.ctx, n.logger, n.db, uid, n.config.GetIAP().Huawei, receipt, signature, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Huawei receipt: %s", err.Error())))
		}

		validationResult := purchaseResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group purchases
// @summary Validates and stores a purchase receipt from Facebook Instant Games.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param signedRequest(type=string) The Facebook Instant signedRequest receipt data.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @return validation(nkruntime.ValidatePurchaseResponse) The resulting successfully validated purchases. Any previously validated purchases are returned with a seenBefore flag.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchaseValidateFacebookInstant(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetIAP().FacebookInstant.AppSecret == "" {
			panic(r.NewGoError(errors.New("facebook instant IAP is not configured")))
		}

		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		signedRequest := getJsString(r, f.Argument(1))
		if signedRequest == "" {
			panic(r.NewTypeError("expects signedRequest"))
		}

		persist := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			persist = getJsBool(r, f.Argument(2))
		}

		validation, err := ValidatePurchaseFacebookInstant(n.ctx, n.logger, n.db, uid, n.config.GetIAP().FacebookInstant, signedRequest, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Facebook Instant receipt: %s", err.Error())))
		}

		validationResult := purchaseResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group purchases
// @summary Look up a purchase receipt by transaction ID.
// @param transactionID(type=string) Transaction ID of the purchase to look up.
// @return purchase(nkruntime.ValidatedPurchaseAroundOwner) A validated purchase.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchaseGetByTransactionId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		transactionID := getJsString(r, f.Argument(0))
		if transactionID == "" {
			panic(r.NewTypeError("expects a transaction id string"))
		}

		purchase, err := GetPurchaseByTransactionId(n.ctx, n.logger, n.db, transactionID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchase: %s", err.Error())))
		}

		return r.ToValue(validatedPurchaseToJsObject(purchase))
	}
}

// @group purchases
// @summary List stored validated purchase receipts.
// @param userID(type=string, optional=true) Filter by user ID. Can be an empty string to list purchases for all users.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listPurchases(nkruntime.ValidatedPurchaseList) A page of stored validated purchases and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) purchasesList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := ""
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			userID = getJsString(r, f.Argument(0))
			if _, err := uuid.FromString(userID); err != nil {
				panic(r.NewTypeError("expects a valid user ID"))
			}
		}

		limit := 100
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		var cursor string
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			cursor = getJsString(r, f.Argument(2))
		}

		purchases, err := ListPurchases(n.ctx, n.logger, n.db, userID, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchases: %s", err.Error())))
		}

		validatedPurchases := make([]interface{}, 0, len(purchases.ValidatedPurchases))
		for _, p := range purchases.ValidatedPurchases {
			validatedPurchase := validatedPurchaseToJsObject(p)
			validatedPurchases = append(validatedPurchases, validatedPurchase)
		}

		result := make(map[string]interface{}, 2)
		result["validatedPurchases"] = validatedPurchases
		if purchases.Cursor != "" {
			result["cursor"] = purchases.Cursor
		} else {
			result["cursor"] = goja.Null()
		}
		if purchases.PrevCursor != "" {
			result["prevCursor"] = purchases.PrevCursor
		} else {
			result["prevCursor"] = goja.Null()
		}

		return r.ToValue(result)
	}
}

// @group subscriptions
// @summary Validates and stores the subscription present in an Apple App Store Receipt.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) Base-64 encoded receipt data returned by the purchase operation itself.
// @param persist(type=bool, optional=true, default=true) Persist the purchase so that seenBefore can be computed to protect against replay attacks.
// @param password(type=string, optional=true) Override the iap.apple.shared_password provided in your configuration.
// @return validation(nkruntime.ValidateSubscriptionResponse) The resulting successfully validated subscription.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) subscriptionValidateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		receipt := getJsString(r, f.Argument(1))
		if receipt == "" {
			panic(r.NewTypeError("expects receipt"))
		}

		persist := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			persist = getJsBool(r, f.Argument(2))
		}

		password := n.config.GetIAP().Apple.SharedPassword
		if f.Argument(3) != goja.Undefined() {
			password = getJsString(r, f.Argument(3))
		}
		if password == "" {
			panic(r.NewGoError(errors.New("apple IAP is not configured")))
		}

		validation, err := ValidateSubscriptionApple(n.ctx, n.logger, n.db, uid, password, receipt, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Apple receipt: %s", err.Error())))
		}

		validationResult := subscriptionResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group subscriptions
// @summary Validates and stores a subscription purchase receipt from the Google Play Store.
// @param userID(type=string) The user ID of the owner of the receipt.
// @param receipt(type=string) JSON encoded Google receipt.
// @param persist(type=bool, optional=true, default=true) Persist the subscription.
// @param clientEmail(type=string, optional=true) Override the iap.google.client_email provided in your configuration.
// @param privateKey(type=string, optional=true) Override the iap.google.private_key provided in your configuration.
// @return validation(nkruntime.ValidateSubscriptionResponse) The resulting successfully validated subscriptions.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) subscriptionValidateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		receipt := getJsString(r, f.Argument(1))
		if receipt == "" {
			panic(r.NewTypeError("expects receipt"))
		}

		persist := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			persist = getJsBool(r, f.Argument(2))
		}

		clientEmail := n.config.GetIAP().Google.ClientEmail
		privateKey := n.config.GetIAP().Google.PrivateKey

		if f.Argument(3) != goja.Undefined() {
			clientEmail = getJsString(r, f.Argument(3))
		}
		if f.Argument(4) != goja.Undefined() {
			privateKey = getJsString(r, f.Argument(4))
		}

		if clientEmail == "" || privateKey == "" {
			panic(r.NewGoError(errors.New("google IAP is not configured")))
		}

		configOverride := &IAPGoogleConfig{
			ClientEmail: clientEmail,
			PrivateKey:  privateKey,
		}

		validation, err := ValidateSubscriptionGoogle(n.ctx, n.logger, n.db, uid, configOverride, receipt, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Google receipt: %s", err.Error())))
		}

		validationResult := subscriptionResponseToJsObject(validation)

		return r.ToValue(validationResult)
	}
}

// @group subscriptions
// @summary Look up a subscription by product ID.
// @param userID(type=string) The user ID of the subscription owner.
// @param productID(type=string) Transaction ID of the purchase to look up.
// @return subscription(nkruntime.ValidatedSubscription) A validated subscription.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) subscriptionGetByProductId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		productID := getJsString(r, f.Argument(1))
		if productID == "" {
			panic(r.NewTypeError("expects a transaction id string"))
		}

		subscription, err := GetSubscriptionByProductId(n.ctx, n.logger, n.db, uid.String(), productID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchase: %s", err.Error())))
		}

		return r.ToValue(subscriptionToJsObject(subscription))
	}
}

// @group subscriptions
// @summary List stored validated subscriptions.
// @param userID(type=string, optional=true) Filter by user ID. Can be an empty string to list subscriptions for all users.
// @param limit(type=number, optional=true, default=100) Limit number of records retrieved.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return listSubscriptions(nkruntime.SubscriptionList) A page of stored validated subscriptions and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) subscriptionsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := ""
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			userID = getJsString(r, f.Argument(0))
			if _, err := uuid.FromString(userID); err != nil {
				panic(r.NewTypeError("expects a valid user ID"))
			}
		}

		limit := 100
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		var cursor string
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			cursor = getJsString(r, f.Argument(2))
		}

		subscriptions, err := ListSubscriptions(n.ctx, n.logger, n.db, userID, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchases: %s", err.Error())))
		}

		validatedSubscriptions := make([]interface{}, 0, len(subscriptions.ValidatedSubscriptions))
		for _, s := range subscriptions.ValidatedSubscriptions {
			validatedSubscription := subscriptionToJsObject(s)
			validatedSubscriptions = append(validatedSubscriptions, validatedSubscription)
		}

		result := make(map[string]interface{}, 2)
		result["validatedSubscriptions"] = validatedSubscriptions
		if subscriptions.Cursor != "" {
			result["cursor"] = subscriptions.Cursor
		} else {
			result["cursor"] = goja.Null()
		}
		if subscriptions.PrevCursor != "" {
			result["prevCursor"] = subscriptions.PrevCursor
		} else {
			result["prevCursor"] = goja.Null()
		}

		return r.ToValue(result)
	}
}

// @group tournaments
// @summary Set up a new dynamic tournament with the specified ID and various configuration settings. The underlying leaderboard will be created if it doesn't already exist, otherwise its configuration will not be updated.
// @param id(type=string) The unique identifier for the new tournament. This is used by clients to submit scores.
// @param authoritative(type=bool, optional=true, default=true) Whether the tournament created is server authoritative.
// @param sortOrder(type=string, optional=true, default="desc") The sort order for records in the tournament. Possible values are "asc" or "desc".
// @param operator(type=string, optional=true, default="best") The operator that determines how scores behave when submitted. The possible values are "best", "set", or "incr".
// @param resetSchedule(type=string, optional=true) The cron format used to define the reset schedule for the tournament. This controls when the underlying leaderboard resets and the tournament is considered active again.
// @param metadata(type=object, optional=true) The metadata you want associated to the tournament. Some good examples are weather conditions for a racing game.
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
func (n *RuntimeJavascriptNakamaModule) tournamentCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		authoritative := true
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			authoritative = getJsBool(r, f.Argument(1))
		}

		sortOrder := "desc"
		if f.Argument(2) != goja.Undefined() {
			sortOrder = getJsString(r, f.Argument(2))
		}
		var sortOrderNumber int
		switch sortOrder {
		case "asc", "ascending":
			sortOrderNumber = LeaderboardSortOrderAscending
		case "desc", "descending":
			sortOrderNumber = LeaderboardSortOrderDescending
		default:
			panic(r.NewTypeError("expects sort order to be 'asc' or 'desc'"))
		}

		operator := "best"
		if f.Argument(3) != goja.Undefined() {
			operator = getJsString(r, f.Argument(3))
		}
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
			panic(r.NewTypeError("expects operator to be 'best', 'set', 'decr' or 'incr'"))
		}

		var duration int
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			duration = int(getJsInt(r, f.Argument(4)))
		}
		if duration <= 0 {
			panic(r.NewTypeError("duration must be > 0"))
		}

		resetSchedule := ""
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			resetSchedule = getJsString(r, f.Argument(5))
		}
		if resetSchedule != "" {
			if _, err := cronexpr.Parse(resetSchedule); err != nil {
				panic(r.NewTypeError("expects reset schedule to be a valid CRON expression"))
			}
		}

		metadata := f.Argument(6)
		metadataStr := "{}"
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := metadata.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("error encoding metadata: %v", err.Error())))
			}
			metadataStr = string(metadataBytes)
		}

		title := ""
		if f.Argument(7) != goja.Undefined() && f.Argument(7) != goja.Null() {
			title = getJsString(r, f.Argument(7))
		}

		description := ""
		if f.Argument(8) != goja.Undefined() && f.Argument(8) != goja.Null() {
			description = getJsString(r, f.Argument(8))
		}

		var category int
		if f.Argument(9) != goja.Undefined() && f.Argument(9) != goja.Null() {
			category = int(getJsInt(r, f.Argument(9)))
			if category < 0 || category >= 128 {
				panic(r.NewTypeError("category must be 0-127"))
			}
		}

		var startTime int
		if f.Argument(10) != goja.Undefined() && f.Argument(10) != goja.Null() {
			startTime = int(getJsInt(r, f.Argument(10)))
			if startTime < 0 {
				panic(r.NewTypeError("startTime must be >= 0."))
			}
		}

		var endTime int
		if f.Argument(11) != goja.Undefined() && f.Argument(11) != goja.Null() {
			endTime = int(getJsInt(r, f.Argument(11)))
		}
		if endTime != 0 && endTime <= startTime {
			panic(r.NewTypeError("endTime must be > startTime. Use 0 to indicate a tournament that never ends."))
		}

		var maxSize int
		if f.Argument(12) != goja.Undefined() && f.Argument(12) != goja.Null() {
			maxSize = int(getJsInt(r, f.Argument(12)))
			if maxSize < 0 {
				panic(r.NewTypeError("maxSize must be >= 0"))
			}
		}

		var maxNumScore int
		if f.Argument(13) != goja.Undefined() && f.Argument(13) != goja.Null() {
			maxNumScore = int(getJsInt(r, f.Argument(13)))
			if maxNumScore < 0 {
				panic(r.NewTypeError("maxNumScore must be >= 0"))
			}
		}

		joinRequired := false
		if f.Argument(14) != goja.Undefined() && f.Argument(14) != goja.Null() {
			joinRequired = getJsBool(r, f.Argument(14))
		}

		enableRanks := false
		if f.Argument(15) != goja.Undefined() && f.Argument(15) != goja.Null() {
			enableRanks = getJsBool(r, f.Argument(15))
		}

		if err := TournamentCreate(n.ctx, n.logger, n.leaderboardCache, n.leaderboardScheduler, id, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired, enableRanks); err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary Delete a tournament and all records that belong to it.
// @param id(type=string) The unique identifier for the tournament to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		if err := TournamentDelete(n.ctx, n.leaderboardCache, n.rankCache, n.leaderboardScheduler, id); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary Add additional score attempts to the owner's tournament record. This overrides the max number of score attempts allowed in the tournament for this specific owner.
// @param id(type=string) The unique identifier for the tournament to update.
// @param ownerID(type=string) The owner of the records to increment the count for.
// @param count(type=number) The number of attempt counts to increment. Can be negative to decrease count.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentAddAttempt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		if ownerID == "" {
			panic(r.NewTypeError("expects an owner ID string"))
		} else if _, err := uuid.FromString(ownerID); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		count := int(getJsInt(r, f.Argument(2)))
		if count == 0 {
			panic(r.NewTypeError("expects an attempt count number != 0"))
		}

		if err := TournamentAddAttempt(n.ctx, n.logger, n.db, n.leaderboardCache, id, ownerID, count); err != nil {
			panic(r.NewTypeError("error adding tournament attempts: %v", err.Error()))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary A tournament may need to be joined before the owner can submit scores. This operation is idempotent and will always succeed for the owner even if they have already joined the tournament.
// @param id(type=string) The unique identifier for the tournament to join.
// @param userID(type=string) The owner of the record.
// @param username(type=string) The username of the record owner.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		userID := getJsString(r, f.Argument(1))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := TournamentJoin(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, uid, username, id); err != nil {
			panic(r.NewGoError(fmt.Errorf("error joining tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary Fetch one or more tournaments by ID.
// @param tournamentIDs(type=string[]) The table array of tournament ids.
// @return result(nkruntime.Tournament[]) Array of tournament records.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		tournamentIDs := f.Argument(0)
		if tournamentIDs == goja.Undefined() || tournamentIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of tournament ids"))
		}
		tournmentIDsArray, err := exportToSlice[[]string](tournamentIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		if len(tournmentIDsArray) == 0 {
			return r.ToValue(make([]interface{}, 0))
		}

		list, err := TournamentsGet(n.ctx, n.logger, n.db, n.leaderboardCache, tournmentIDsArray)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get tournaments: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(list))
		for _, tournament := range list {
			tournament, err := tournamentToJsObject(tournament)
			if err != nil {
				panic(r.NewGoError(err))
			}

			results = append(results, tournament)
		}

		return r.ToValue(results)
	}
}

// @group tournaments
// @summary List records on the specified tournament, optionally filtering to only a subset of records by their owners. Records will be listed in the preconfigured tournament sort order.
// @param tournamentID(type=string) The ID of the tournament to list records for.
// @param ownerIDs(type=string[], optional=true) Array of owner IDs to filter results by. Optional.
// @param limit(type=number, optional=true) Return only the required number of tournament records denoted by this limit value. Max is 10000.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param overrideExpiry(type=number, optional=true, default=0) Optionally retrieve records from previous resets by specifying the reset point in time in UTC seconds. Must be equal or greater than 0.
// @return records(nkruntime.LeaderboardRecord) A page of tournament records.
// @return ownerRecords(nkruntime.LeaderboardRecord) A list of owner tournament records (empty if the owners input parameter is not set).
// @return prevCursor(string) An optional previous page cursor that can be used to retrieve the previous page of records (if any).
// @return nextCursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or null when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentRecordsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		tournamentID := getJsString(r, f.Argument(0))
		if tournamentID == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		var owners []string
		ownerIDs := f.Argument(1)
		if ownerIDs != goja.Undefined() && ownerIDs != goja.Null() {
			var err error
			owners, err = exportToSlice[[]string](ownerIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of user ids"))
			}

			for _, owner := range owners {
				if _, err := uuid.FromString(owner); err != nil {
					panic(r.NewTypeError("expects a valid owner id"))
				}
			}
		}

		limit := 0
		if f.Argument(2) != goja.Undefined() {
			limit = int(getJsInt(r, f.Argument(2)))
		}
		var limitValue *wrapperspb.Int32Value
		if limit != 0 {
			limitValue = &wrapperspb.Int32Value{Value: int32(limit)}
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() {
			cursor = getJsString(r, f.Argument(3))
		}

		overrideExpiry := int64(0)
		if f.Argument(4) != goja.Undefined() {
			overrideExpiry = getJsInt(r, f.Argument(4))
		}

		records, err := TournamentRecordsList(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, tournamentID, owners, limitValue, cursor, overrideExpiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournament records: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount)
	}
}

func leaderboardRecordsListToJs(r *goja.Runtime, records []*api.LeaderboardRecord, ownerRecords []*api.LeaderboardRecord, prevCursor, nextCursor string, rankCount int64) goja.Value {
	recordsSlice := make([]interface{}, 0, len(records))
	for _, record := range records {
		recordsSlice = append(recordsSlice, leaderboardRecordToJsMap(r, record))
	}

	ownerRecordsSlice := make([]interface{}, 0, len(ownerRecords))
	for _, ownerRecord := range ownerRecords {
		ownerRecordsSlice = append(ownerRecordsSlice, leaderboardRecordToJsMap(r, ownerRecord))
	}

	resultMap := make(map[string]interface{}, 5)

	resultMap["records"] = recordsSlice
	resultMap["ownerRecords"] = ownerRecordsSlice

	if nextCursor != "" {
		resultMap["nextCursor"] = nextCursor
	} else {
		resultMap["nextCursor"] = nil
	}

	if prevCursor != "" {
		resultMap["prevCursor"] = prevCursor
	} else {
		resultMap["prevCursor"] = nil
	}

	resultMap["rankCount"] = rankCount

	return r.ToValue(resultMap)
}

func leaderboardRecordToJsMap(r *goja.Runtime, record *api.LeaderboardRecord) map[string]interface{} {
	recordMap := make(map[string]interface{}, 12)
	recordMap["leaderboardId"] = record.LeaderboardId
	recordMap["ownerId"] = record.OwnerId
	if record.Username != nil {
		recordMap["username"] = record.Username.Value
	} else {
		recordMap["username"] = nil
	}
	recordMap["score"] = record.Score
	recordMap["subscore"] = record.Subscore
	recordMap["numScore"] = record.NumScore
	recordMap["maxNumScore"] = record.MaxNumScore
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(record.Metadata), &metadataMap)
	if err != nil {
		panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
	}
	pointerizeSlices(metadataMap)
	recordMap["metadata"] = metadataMap
	recordMap["createTime"] = record.CreateTime.Seconds
	recordMap["updateTime"] = record.UpdateTime.Seconds
	if record.ExpiryTime != nil {
		recordMap["expiryTime"] = record.ExpiryTime.Seconds
	} else {
		recordMap["expiryTime"] = nil
	}
	recordMap["rank"] = record.Rank

	return recordMap
}

// @group tournaments
// @summary Find tournaments which have been created on the server. Tournaments can be filtered with categories and via start and end times.
// @param categoryStart(type=number) Filter tournament with categories greater or equal than this value.
// @param categoryEnd(type=number) Filter tournament with categories equal or less than this value.
// @param startTime(type=number, optional=true) Filter tournament with that start after this time.
// @param endTime(type=number, optional=true) Filter tournament with that end before this time.
// @param limit(type=number, optional=true, default=10) Return only the required number of tournament denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return tournamentList(nkruntime.TournamentList[]) A list of tournament results and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var categoryStart int
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			categoryStart = int(getJsInt(r, f.Argument(0)))
			if categoryStart < 0 || categoryStart >= 128 {
				panic(r.NewTypeError("category start must be 0-127"))
			}
		}

		var categoryEnd int
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			categoryEnd = int(getJsInt(r, f.Argument(1)))
			if categoryEnd < 0 || categoryEnd >= 128 {
				panic(r.NewTypeError("category end must be 0-127"))
			}
		}

		if categoryStart > categoryEnd {
			panic(r.NewTypeError("category end must be >= category start"))
		}

		startTime := -1
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			startTime = int(getJsInt(r, f.Argument(2)))
			if startTime < 0 {
				panic(r.NewTypeError("start time must be >= 0"))
			}
		}

		endTime := -1
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			endTime = int(getJsInt(r, f.Argument(3)))
			if endTime < 0 {
				panic(r.NewTypeError("end time must be >= 0"))
			}
		}

		if startTime > endTime {
			panic(r.NewTypeError("end time must be >= start time"))
		}

		limit := 10
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(4)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		var cursorValue *TournamentListCursor
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			cursor := getJsString(r, f.Argument(5))
			cb, err := base64.URLEncoding.DecodeString(cursor)
			if err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
			cursorValue = &TournamentListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursorValue); err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
		}

		list, err := TournamentList(n.ctx, n.logger, n.db, n.leaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit, cursorValue)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournaments: %v", err.Error())))
		}

		results := make([]interface{}, 0, len(list.Tournaments))
		for _, tournament := range list.Tournaments {
			t, err := tournamentToJsObject(tournament)
			if err != nil {
				panic(r.NewGoError(err))
			}

			results = append(results, t)
		}

		resultMap := make(map[string]interface{}, 2)

		if list.Cursor == "" {
			resultMap["cursor"] = nil
		} else {
			resultMap["cursor"] = list.Cursor
		}

		resultMap["tournaments"] = results

		return r.ToValue(resultMap)
	}
}

// @group tournaments
// @summary Disable a tournament rank cache freeing its allocated resources. If already disabled is a NOOP.
// @param id(type=string) The tournament id.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentRanksDisable(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		if err := DisableTournamentRanks(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, id); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary Submit a score and optional subscore to a tournament leaderboard. If the tournament has been configured with join required this will fail unless the owner has already joined the tournament.
// @param id(type=string) The unique identifier for the tournament leaderboard to submit to.
// @param ownerID(type=string) The owner of this score submission. Mandatory field.
// @param username(type=string, optional=true) The owner username of this score submission, if it's a user.
// @param score(type=number, optional=true, default=0) The score to submit.
// @param subscore(type=number, optional=true, default=0) A secondary subscore parameter for the submission.
// @param metadataMap(type=object) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param metadata(type=map[string]interface{}, optional=true) The metadata you want associated to this submission. Some good examples are weather conditions for a racing game.
// @param overrideOperatorString(type=*int) An override operator for the new record. The accepted values include: 0 (no override), 1 (best), 2 (set), 3 (incr), 4 (decr). Passing nil is the same as passing a pointer to 0 (no override), which uses the default leaderboard operator.
// @return result(nkruntime.LeaderboardRecord) The newly created leaderboard record.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentRecordWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		userID, err := uuid.FromString(ownerID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := ""
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			username = getJsString(r, f.Argument(2))
		}

		var score int64
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			score = getJsInt(r, f.Argument(3))
		}

		var subscore int64
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			subscore = getJsInt(r, f.Argument(4))
		}

		metadata := f.Argument(5)
		metadataStr := ""
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := f.Argument(5).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("error encoding metadata: %v", err.Error())))
			}
			metadataStr = string(metadataBytes)
		}

		overrideOperator := int32(api.Operator_NO_OVERRIDE)
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			overrideOperatorString := getJsString(r, f.Argument(6))
			var ok bool
			if overrideOperator, ok = api.Operator_value[strings.ToUpper(overrideOperatorString)]; !ok {
				panic(r.NewTypeError(ErrInvalidOperator.Error()))
			}
		}

		record, err := TournamentRecordWrite(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, userID, username, score, subscore, metadataStr, api.Operator(overrideOperator))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error writing tournament record: %v", err.Error())))
		}

		return r.ToValue(leaderboardRecordToJsMap(r, record))
	}
}

// @group tournaments
// @summary Remove an owner's record from a tournament, if one exists.
// @param id(type=string) The unique identifier for the tournament to delete from.
// @param ownerID(type=string) The owner of the score to delete. Mandatory field.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentRecordDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(ownerID); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		if err := TournamentRecordDelete(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting tournament record: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group tournaments
// @summary Fetch the list of tournament records around the owner.
// @param id(type=string) The ID of the tournament to list records for.
// @param ownerID(type=string) The owner ID around which to show records.
// @param limit(type=number, optional=true, default=10) Return only the required number of tournament records denoted by this limit value. Between 1-100.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @param expiry(type=number, optional=true, default=0) Time since epoch in seconds. Must be greater than 0.
// @return tournamentRecordsHaystack(nkruntime.LeaderboardRecord) A list of tournament records and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) tournamentRecordsHaystack(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		oid, err := uuid.FromString(ownerID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		limit := 10
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(2)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		var expiry int64
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			expiry = getJsInt(r, f.Argument(4))
			if expiry < 0 {
				panic(r.NewTypeError("expiry should be time since epoch in seconds and has to be a positive integer"))
			}
		}

		records, err := TournamentRecordsHaystack(n.ctx, n.logger, n.db, n.leaderboardCache, n.rankCache, id, cursor, oid, limit, expiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournament records haystack: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor, records.RankCount)
	}
}

// @group groups
// @summary Fetch one or more groups by their ID.
// @param groupIDs(type=string[]) An array of strings of the IDs for the groups to get.
// @return getGroups(nkruntime.Group[]) An array of groups with their fields.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDs := f.Argument(0)
		if groupIDs == goja.Undefined() || groupIDs == goja.Null() {
			panic(r.NewTypeError("expects an array of group ids"))
		}
		groupIDsArray, err := exportToSlice[[]string](groupIDs)
		if err != nil {
			panic(r.NewTypeError("expects array of strings"))
		}

		groups, err := GetGroups(n.ctx, n.logger, n.db, groupIDsArray)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get groups: %s", err.Error())))
		}

		resultsSlice := make([]interface{}, 0, len(groups))
		for _, group := range groups {
			groupMap := make(map[string]interface{}, 11)

			groupMap["id"] = group.Id
			groupMap["creatorId"] = group.CreatorId
			groupMap["name"] = group.Name
			groupMap["description"] = group.Description
			groupMap["avatarUrl"] = group.AvatarUrl
			groupMap["langTag"] = group.LangTag
			metadataMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(group.Metadata), &metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
			}
			groupMap["metadata"] = metadataMap
			groupMap["open"] = group.Open.Value
			groupMap["edgeCount"] = group.EdgeCount
			groupMap["maxCount"] = group.MaxCount
			groupMap["createTime"] = group.CreateTime.Seconds
			groupMap["updateTime"] = group.UpdateTime.Seconds

			resultsSlice = append(resultsSlice, groupMap)
		}

		return r.ToValue(resultsSlice)
	}
}

// @group groups
// @summary Set up a group with various configuration settings. The group will be created if they don't exist or fail if the group name is taken.
// @param userID(type=string) The user ID to be associated as the group superadmin.
// @param name(type=string) Group name, must be unique.
// @param creatorID(type=string, optional=true) The user ID to be associated as creator. If not set or nil/null, system user will be set.
// @param langTag(type=string, optional=true, default="en") Group language.
// @param description(type=string, optional=true) Group description, can be left empty as nil/null.
// @param avatarURL(type=string, optional=true) URL to the group avatar, can be left empty as nil/null.
// @param open(type=bool, optional=true, default=false) Whether the group is for anyone to join, or members will need to send invitations to join.
// @param metadata(type=object, optional=true) Custom information to store for this group. Can be left empty as nil/null.
// @param maxCount(type=number, optional=true, default=100) Maximum number of members to have in the group.
// @return createGroup(nkruntime.Group) The groupId of the newly created group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		name := getJsString(r, f.Argument(1))
		if name == "" {
			panic(r.NewTypeError("expects group name to not be empty"))
		}

		creatorID := uuid.Nil.String()
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			creatorID = getJsString(r, f.Argument(2))
		}
		cid, err := uuid.FromString(creatorID)
		if err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		langTag := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			langTag = getJsString(r, f.Argument(3))
		}

		description := ""
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			description = getJsString(r, f.Argument(4))
		}

		avatarURL := ""
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			avatarURL = getJsString(r, f.Argument(5))
		}

		open := false
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			open = getJsBool(r, f.Argument(6))
		}

		metadata := f.Argument(7)
		metadataStr := ""
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := metadata.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("error encoding metadata: %v", err.Error())))
			}
			metadataStr = string(metadataBytes)
		}

		maxCount := 100
		if f.Argument(8) != goja.Undefined() && f.Argument(8) != goja.Null() {
			maxCount = int(getJsInt(r, f.Argument(8)))
		}

		group, err := CreateGroup(n.ctx, n.logger, n.db, uid, cid, name, langTag, description, avatarURL, metadataStr, open, maxCount)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to create group: %v", err.Error())))
		}

		if group == nil {
			panic(r.NewGoError(errors.New("did not create group as a group already exists with the same name")))
		}

		groupResult := make(map[string]interface{}, 12)
		groupResult["id"] = group.Id
		groupResult["creatorId"] = group.CreatorId
		groupResult["name"] = group.Name
		groupResult["description"] = group.Description
		groupResult["avatarUrl"] = group.AvatarUrl
		groupResult["langTag"] = group.LangTag
		metadataMap := make(map[string]interface{})
		err = json.Unmarshal([]byte(group.Metadata), &metadataMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
		}
		groupResult["metadata"] = metadataMap
		groupResult["open"] = group.Open.Value
		groupResult["edgeCount"] = group.EdgeCount
		groupResult["maxCount"] = group.MaxCount
		groupResult["createTime"] = group.CreateTime.Seconds
		groupResult["updateTime"] = group.UpdateTime.Seconds

		return r.ToValue(groupResult)
	}
}

// @group groups
// @summary Update a group with various configuration settings. The group which is updated can change some or all of its fields.
// @param groupID(type=string) The ID of the group to update.
// @param userID(type=string) User ID calling the update operation for permission checking. Set as nil to enact the changes as the system user.
// @param name(type=string, optional=true) Group name, can be empty if not changed.
// @param creatorID(type=string, optional=true) The user ID to be associated as creator. Can be empty if not changed.
// @param langTag(type=string, optional=true) Group language. Empty if not updated.
// @param description(type=string, optional=true) Group description, can be left empty if not updated.
// @param avatarURL(type=string, optional=true) URL to the group avatar, can be left empty if not updated.
// @param open(type=bool, optional=true) Whether the group is for anyone to join or not.
// @param metadata(type=object, optional=true) Custom information to store for this group. Use nil if field is not being updated.
// @param maxCount(type=number, optional=true) Maximum number of members to have in the group. Use 0, nil/null if field is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		uid := uuid.Nil
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			userID := getJsString(r, f.Argument(1))
			uid, err = uuid.FromString(userID)
			if err != nil {
				panic(r.NewTypeError("expects user ID to be a valid identifier"))
			}
		}

		var nameValue *wrapperspb.StringValue
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			name := getJsString(r, f.Argument(2))
			nameValue = &wrapperspb.StringValue{Value: name}
		}

		cid := uuid.Nil
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			creatorID := getJsString(r, f.Argument(3))
			cid, err = uuid.FromString(creatorID)
			if err != nil {
				panic(r.NewTypeError("expects creator ID to be a valid identifier"))
			}
		}

		var lang *wrapperspb.StringValue
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			langTag := getJsString(r, f.Argument(4))
			lang = &wrapperspb.StringValue{Value: langTag}
		}

		var desc *wrapperspb.StringValue
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			description := getJsString(r, f.Argument(5))
			desc = &wrapperspb.StringValue{Value: description}
		}

		var avatar *wrapperspb.StringValue
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			avatarURL := getJsString(r, f.Argument(6))
			avatar = &wrapperspb.StringValue{Value: avatarURL}
		}

		var open *wrapperspb.BoolValue
		if f.Argument(7) != goja.Undefined() && f.Argument(7) != goja.Null() {
			open = &wrapperspb.BoolValue{Value: getJsBool(r, f.Argument(7))}
		}

		var metadataValue *wrapperspb.StringValue
		metadata := f.Argument(8)
		if metadata != goja.Undefined() && metadata != goja.Null() {
			metadataMap, ok := metadata.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be a key value object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
			}
			metadataValue = &wrapperspb.StringValue{Value: string(metadataBytes)}
		}

		maxCount := 0
		if f.Argument(9) != goja.Undefined() && f.Argument(9) != goja.Null() {
			maxCount = int(getJsInt(r, f.Argument(9)))
		}

		if err = UpdateGroup(n.ctx, n.logger, n.db, gid, uid, cid, nameValue, lang, desc, avatar, metadataValue, open, maxCount); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to update group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Delete a group.
// @param groupID(type=string) The ID of the group to delete.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		if err = DeleteGroup(n.ctx, n.logger, n.db, n.tracker, gid, uuid.Nil); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to delete group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Kick users from a group. This can also be used to remove pending requests for groups that require acceptance.
// @param groupID(type=string) The ID of the group to kick users from.
// @param userIDs(type=string[]) Table array of user IDs to kick.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersKick(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDs := f.Argument(1)
		if goja.IsUndefined(userIDs) || goja.IsNull(userIDs) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		usersSlice, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		userIDsArray := make([]uuid.UUID, 0, len(usersSlice))
		for _, id := range usersSlice {
			userID, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if userID == uuid.Nil {
				panic(r.NewTypeError("cannot kick the root user"))
			}
			userIDsArray = append(userIDsArray, userID)
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerID := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		if err := KickGroupUsers(n.ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, callerIDValue, gid, userIDsArray, false); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to kick users from a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary List all members, admins and superadmins which belong to a group. This also list incoming join requests.
// @param groupID(type=string) The ID of the group to list members for.
// @param limit(type=int, optional=true, default=100) The maximum number of entries in the listing.
// @param state(type=int, optional=true, default=null) The state of the user within the group. If unspecified this returns users in all states.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return groupUsers(nkruntime.GroupUserList) The user information for members, admins and superadmins for the group. Also users who sent a join request.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		limit := 100
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 10000 {
				panic(r.NewTypeError("expects limit to be 1-10000"))
			}
		}

		var stateWrapper *wrapperspb.Int32Value
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			state := getJsInt(r, f.Argument(2))
			if state != -1 {
				if state < 0 || state > 4 {
					panic(r.NewTypeError("expects state to be 0-4"))
				}
				stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
			}
		}

		cursor := ""
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			cursor = getJsString(r, f.Argument(3))
		}

		res, err := ListGroupUsers(n.ctx, n.logger, n.db, n.statusRegistry, gid, limit, stateWrapper, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to list users in a group: %v", err.Error())))
		}

		groupUsers := make([]interface{}, 0, len(res.GroupUsers))
		for _, gu := range res.GroupUsers {
			u := gu.User

			guMap := make(map[string]interface{}, 18)

			guMap["userId"] = u.Id
			guMap["username"] = u.Username
			guMap["displayName"] = u.DisplayName
			guMap["avatarUrl"] = u.AvatarUrl
			guMap["langTag"] = u.LangTag
			guMap["location"] = u.Location
			guMap["timezone"] = u.Timezone
			if u.AppleId != "" {
				guMap["appleId"] = u.AppleId
			}
			if u.FacebookId != "" {
				guMap["facebookId"] = u.FacebookId
			}
			if u.FacebookInstantGameId != "" {
				guMap["facebookInstantGameId"] = u.FacebookInstantGameId
			}
			if u.GoogleId != "" {
				guMap["googleId"] = u.GoogleId
			}
			if u.GamecenterId != "" {
				guMap["gamecenterId"] = u.GamecenterId
			}
			if u.SteamId != "" {
				guMap["steamId"] = u.SteamId
			}
			guMap["online"] = u.Online
			guMap["edgeCount"] = u.EdgeCount
			guMap["createTime"] = u.CreateTime.Seconds
			guMap["updateTime"] = u.UpdateTime.Seconds

			metadataMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(u.Metadata), &metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
			}
			pointerizeSlices(metadataMap)
			guMap["metadata"] = metadataMap

			groupUsers = append(groupUsers, map[string]interface{}{
				"user":  guMap,
				"state": gu.State.Value,
			})
		}

		result := make(map[string]interface{}, 2)
		result["groupUsers"] = groupUsers

		if res.Cursor == "" {
			result["cursor"] = nil
		} else {
			result["cursor"] = res.Cursor
		}

		return r.ToValue(result)
	}
}

// @group groups
// @summary List all groups which a user belongs to and whether they've been accepted or if it's an invitation.
// @param userID(type=string) The ID of the user to list groups for.
// @param limit(type=int, optional=true, default=100) The maximum number of entries in the listing.
// @param state(type=int optional=true) The state of the user within the group. If unspecified this returns users in all states.
// @param cursor(type=string, optional=true) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return userGroups(nkruntime.UserGroupList) A table of groups with their fields.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any).
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) userGroupsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		limit := 100
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("expects limit to be 1-100"))
			}
		}

		var stateWrapper *wrapperspb.Int32Value
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			state := getJsInt(r, f.Argument(2))
			if state != -1 {
				if state < 0 || state > 4 {
					panic(r.NewTypeError("expects state to be 0-4"))
				}
				stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
			}
		}

		cursor := ""
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			cursor = getJsString(r, f.Argument(3))
		}

		res, err := ListUserGroups(n.ctx, n.logger, n.db, uid, limit, stateWrapper, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to list groups for a user: %v", err.Error())))
		}

		userGroups := make([]interface{}, 0, len(res.UserGroups))
		for _, ug := range res.UserGroups {
			g := ug.Group

			ugMap := make(map[string]interface{}, 12)

			ugMap["id"] = g.Id
			ugMap["creatorId"] = g.CreatorId
			ugMap["name"] = g.Name
			ugMap["description"] = g.Description
			ugMap["avatarUrl"] = g.AvatarUrl
			ugMap["langTag"] = g.LangTag
			ugMap["open"] = g.Open.Value
			ugMap["edgeCount"] = g.EdgeCount
			ugMap["maxCount"] = g.MaxCount
			ugMap["createTime"] = g.CreateTime.Seconds
			ugMap["updateTime"] = g.UpdateTime.Seconds

			metadataMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(g.Metadata), &metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
			}
			pointerizeSlices(metadataMap)
			ugMap["metadata"] = metadataMap

			userGroups = append(userGroups, map[string]interface{}{
				"group": ugMap,
				"state": ug.State.Value,
			})
		}

		result := make(map[string]interface{}, 2)
		result["userGroups"] = userGroups

		if res.Cursor == "" {
			result["cursor"] = nil
		} else {
			result["cursor"] = res.Cursor
		}

		return r.ToValue(result)
	}
}

// @group friends
// @summary List all friends, invites, invited, and blocked which belong to a user.
// @param userID(type=string) The ID of the user whose friends, invites, invited, and blocked you want to list.
// @param limit(type=number, optional=true, default=100) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param state(type=number, optional=true) The state of the friendship with the user. If unspecified this returns friends in all states for the user.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return friends(nkruntime.FriendList) The user information for users that are friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or null when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		limit := 100
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 1000 {
				panic(r.NewTypeError("expects limit to be 1-1000"))
			}
		}

		var stateWrapper *wrapperspb.Int32Value
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			state := getJsInt(r, f.Argument(2))
			if state != -1 {
				if state < 0 || state > 3 {
					panic(r.NewTypeError("expects state to be 0-3"))
				}
				stateWrapper = &wrapperspb.Int32Value{Value: int32(state)}
			}
		}

		cursor := ""
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			cursor = getJsString(r, f.Argument(3))
		}

		friends, err := ListFriends(n.ctx, n.logger, n.db, n.statusRegistry, uid, limit, stateWrapper, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to list friends for a user: %v", err.Error())))
		}

		userFriends := make([]interface{}, 0, len(friends.Friends))
		for _, f := range friends.Friends {
			fum, err := userToJsObject(f.User)
			if err != nil {
				panic(r.NewGoError(err))
			}

			fm := make(map[string]interface{}, 4)
			fm["state"] = f.State.Value
			fm["updateTime"] = f.UpdateTime.Seconds
			fm["user"] = fum
			metadata := make(map[string]interface{})
			if err = json.Unmarshal([]byte(f.Metadata), &metadata); err != nil {
				panic(r.NewGoError(fmt.Errorf("error while trying to unmarshal friend metadata: %v", err.Error())))
			}
			pointerizeSlices(metadata)
			fm["metadata"] = metadata

			userFriends = append(userFriends, fm)
		}

		result := map[string]interface{}{
			"friends": userFriends,
		}
		if friends.Cursor != "" {
			result["cursor"] = friends.Cursor
		}

		return r.ToValue(result)
	}
}

// @group friends
// @summary List all friends of friends of a user.
// @param userIDString(type=string) The ID of the user whose friends of friends you want to list.
// @param limit(type=number, optional=true, default=10) The number of friends to retrieve in this page of results. No more than 100 limit allowed per result.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return friends(nkruntime.FriendsOfFriendsList) The user information for users that are friends of friends of the current user.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or null when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendsOfFriendsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		limit := 100
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 1000 {
				panic(r.NewTypeError("expects limit to be 1-1000"))
			}
		}

		cursor := ""
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			cursor = getJsString(r, f.Argument(2))
		}

		friends, err := ListFriendsOfFriends(n.ctx, n.logger, n.db, n.statusRegistry, userID, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to list friends for a user: %v", err.Error())))
		}

		userFriendsOfFriends := make([]interface{}, 0, len(friends.FriendsOfFriends))
		for _, f := range friends.FriendsOfFriends {
			fum, err := userToJsObject(f.User)
			if err != nil {
				panic(r.NewGoError(err))
			}

			fm := make(map[string]interface{}, 3)
			fm["referrer"] = f.Referrer
			fm["user"] = fum

			userFriendsOfFriends = append(userFriendsOfFriends, fm)
		}

		result := map[string]interface{}{
			"friendsOfFriends": userFriendsOfFriends,
		}
		if friends.Cursor != "" {
			result["cursor"] = friends.Cursor
		}

		return r.ToValue(result)
	}
}

// @group friends
// @summary Add friends to a user.
// @param userID(type=string) The ID of the user to whom you want to add friends.
// @param username(type=string) The name of the user to whom you want to add friends.
// @param userIDs(type=[]string) Table array of IDs of the users you want to add as friends.
// @param usernames(type=[]string) Table array of usernames of the users you want to add as friends.
// @param metadataMap(type=object, optional=true) Custom information to store for this friend. Use nil if field is not being updated.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendsAdd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		userIDValue, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		userIDs := f.Argument(2)
		var userIDsArray []string
		if userIDs != goja.Undefined() && userIDs != goja.Null() {
			userIDsArray, err = exportToSlice[[]string](userIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, id := range userIDsArray {
				if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userIDValue)))
				} else if userID == id {
					panic(r.NewTypeError("cannot add self as friend"))
				}
			}
		}

		var usernamesArray []string
		usernames := f.Argument(3)
		if usernames != goja.Undefined() && usernames != goja.Null() {
			usernamesArray, err = exportToSlice[[]string](usernames)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, uname := range usernamesArray {
				if uname == "" {
					panic(r.NewTypeError("username to add must not be empty"))
				} else if uname == username {
					panic(r.NewTypeError("cannot add self as friend"))
				}
			}
		}

		if userIDs == nil && usernamesArray == nil {
			return goja.Undefined()
		}

		fetchIDs, err := fetchUserID(n.ctx, n.db, usernamesArray)
		if err != nil {
			n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
			panic(r.NewTypeError("error while trying to add friends"))
		}

		if len(fetchIDs)+len(userIDsArray) == 0 {
			panic(r.NewTypeError("no valid ID or username was provided"))
		}

		allIDs := make([]string, 0, len(userIDsArray)+len(fetchIDs))
		allIDs = append(allIDs, userIDsArray...)
		allIDs = append(allIDs, fetchIDs...)

		metadataMap := f.Argument(4)
		metadata, ok := metadataMap.Export().(map[string]any)
		if !ok {
			panic(r.NewTypeError("invalid metadata: must be an object"))
		}

		var metadataStr string
		if metadata != nil {
			bytes, err := json.Marshal(metadata)
			if err != nil {
				n.logger.Error("Could not marshal metadata", zap.Error(err))
				panic(r.NewTypeError("failed to marshal metadata: %s", err.Error()))
			}
			metadataStr = string(bytes)
		}

		err = AddFriends(n.ctx, n.logger, n.db, n.tracker, n.router, userIDValue, username, allIDs, metadataStr)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		return goja.Undefined()
	}
}

// @group friends
// @summary Delete friends from a user.
// @param userID(type=string) The ID of the user from whom you want to delete friends.
// @param username(type=string) The name of the user from whom you want to delete friends.
// @param userIDs(type=[]string) Table array of IDs of the users you want to delete as friends.
// @param usernames(type=[]string) Table array of usernames of the users you want to delete as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendsDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		userIDValue, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		var userIDsArray []string
		userIDs := f.Argument(2)
		if userIDs != goja.Undefined() && userIDs != goja.Null() {
			userIDsArray, err = exportToSlice[[]string](userIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, userId := range userIDsArray {
				if uid, err := uuid.FromString(userId); err != nil || uid == uuid.Nil {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userIDValue)))
				} else if userID == userId {
					panic(r.NewTypeError("cannot delete self"))
				}
			}
		}

		var usernamesArray []string
		usernames := f.Argument(3)
		if usernames != goja.Undefined() && usernames != goja.Null() {
			usernamesArray, err = exportToSlice[[]string](usernames)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, uname := range usernamesArray {
				if uname == "" {
					panic(r.NewTypeError("username to delete must not be empty"))
				} else if uname == username {
					panic(r.NewTypeError("cannot delete self"))
				}
			}
		}

		if userIDsArray == nil && usernamesArray == nil {
			return goja.Undefined()
		}

		fetchIDs, err := fetchUserID(n.ctx, n.db, usernamesArray)
		if err != nil {
			n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
			panic(r.NewTypeError("error while trying to delete friends"))
		}

		if len(fetchIDs)+len(userIDsArray) == 0 {
			panic(r.NewTypeError("no valid ID or username was provided"))
		}

		allIDs := make([]string, 0, len(userIDsArray)+len(fetchIDs))
		allIDs = append(allIDs, userIDsArray...)
		allIDs = append(allIDs, fetchIDs...)

		err = DeleteFriends(n.ctx, n.logger, n.db, n.tracker, n.router, userIDValue, username, allIDs)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		return goja.Undefined()
	}
}

// @group friends
// @summary Block friends for a user.
// @param userID(type=string) The ID of the user for whom you want to block friends.
// @param username(type=string) The name of the user for whom you want to block friends.
// @param userIDs(type=[]string) Table array of IDs of the users you want to block as friends.
// @param usernames(type=[]string) Table array of usernames of the users you want to block as friends.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendsBlock(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID := getJsString(r, f.Argument(0))
		userIDValue, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		var userIDsArray []string
		userIDs := f.Argument(2)
		if userIDs != goja.Undefined() && userIDs != goja.Null() {
			userIDsArray, err = exportToSlice[[]string](userIDs)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}

			for _, id := range userIDsArray {
				if uid, err := uuid.FromString(id); err != nil || uid == uuid.Nil {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userIDValue)))
				} else if userID == id {
					panic(r.NewTypeError("cannot block self"))
				}
			}
		}

		var usernamesArray []string
		usernames := f.Argument(3)
		if usernames != goja.Undefined() && usernames != goja.Null() {
			usernamesArray, err = exportToSlice[[]string](usernames)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
			for _, uname := range usernamesArray {
				if uname == "" {
					panic(r.NewTypeError("username to block must not be empty"))
				} else if uname == username {
					panic(r.NewTypeError("cannot block self"))
				}
			}
		}

		if userIDsArray == nil && usernamesArray == nil {
			return goja.Undefined()
		}

		fetchIDs, err := fetchUserID(n.ctx, n.db, usernamesArray)
		if err != nil {
			n.logger.Error("Could not fetch user IDs.", zap.Error(err), zap.Strings("usernames", usernamesArray))
			panic(r.NewTypeError("error while trying to block friends"))
		}

		if len(fetchIDs)+len(userIDsArray) == 0 {
			panic(r.NewTypeError("no valid ID or username was provided"))
		}

		allIDs := make([]string, 0, len(userIDsArray)+len(fetchIDs))
		allIDs = append(allIDs, userIDsArray...)
		allIDs = append(allIDs, fetchIDs...)

		err = BlockFriends(n.ctx, n.logger, n.db, n.tracker, userIDValue, allIDs)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to block friends: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group friends
// @summary Update friend metadata.
// @param userID(type=string) The ID of the user.
// @param friendUserID(type=string) The ID of the friend of the user.
// @param metadata(type=object, optional=true) The custom metadata to set for the friend.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) friendMetadataUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		friendUserID, err := uuid.FromString(getJsString(r, f.Argument(1)))
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		metadata, ok := f.Argument(2).Export().(map[string]any)
		if !ok {
			panic(r.NewTypeError("expects metadata to be an object"))
		}

		if err := UpdateFriendMetadata(n.ctx, n.logger, n.db, userID, friendUserID, metadata); err != nil {
			panic(r.NewGoError(fmt.Errorf("error updating froind metadata: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Join a group for a particular user.
// @param groupID(type=string) The ID of the group to join.
// @param userID(type=string) The user ID to add to this group.
// @param username(type=string) The username of the user to add to this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUserJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userID := getJsString(r, f.Argument(1))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := JoinGroup(n.ctx, n.logger, n.db, n.tracker, n.router, gid, uid, username); err != nil {
			panic(r.NewGoError(fmt.Errorf("error trying to join group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Leave a group for a particular user.
// @param groupID(type=string) The ID of the group to leave.
// @param userID(type=string) The user ID to remove from this group.
// @param username(type=string) The username of the user to remove from this group.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUserLeave(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userID := getJsString(r, f.Argument(1))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		uid, err := uuid.FromString(userID)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := LeaveGroup(n.ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, gid, uid, username); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to leave group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Add users to a group.
// @param groupID(type=string) The ID of the group to add users to.
// @param userIDs(type=string[]) Table array of user IDs to add to this group.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersAdd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDs := f.Argument(1)
		if goja.IsUndefined(userIDs) || goja.IsNull(userIDs) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if uid == uuid.Nil {
				panic(r.NewTypeError("cannot add the root user"))
			}
			uids = append(uids, uid)
		}
		if len(userIDsArray) == 0 {
			return goja.Undefined()
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerID := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		if err := AddGroupUsers(n.ctx, n.logger, n.db, n.tracker, n.router, callerIDValue, gid, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to add users into group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Ban users from a group.
// @param groupID(string) The ID of the group to ban users from.
// @param userIDs(string[]) Table array of user IDs to ban from this group.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersBan(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDs := f.Argument(1)
		if goja.IsUndefined(userIDs) || goja.IsNull(userIDs) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if uid == uuid.Nil {
				panic(r.NewTypeError("cannot ban the root user"))
			}
			uids = append(uids, uid)
		}
		if len(userIDsArray) == 0 {
			return goja.Undefined()
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerID := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		if err := BanGroupUsers(n.ctx, n.logger, n.db, n.tracker, n.router, n.streamManager, callerIDValue, gid, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to ban users from group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Promote users in a group.
// @param groupID(type=string) The ID of the group whose members are being promoted.
// @param userIDs(type=string[]) Table array of user IDs to promote.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersPromote(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDs := f.Argument(1)
		if goja.IsUndefined(userIDs) || goja.IsNull(userIDs) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if uid == uuid.Nil {
				panic(r.NewTypeError("cannot promote the root user"))
			}
			uids = append(uids, uid)
		}
		if len(userIDsArray) == 0 {
			return goja.Undefined()
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerID := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		if err := PromoteGroupUsers(n.ctx, n.logger, n.db, n.router, callerIDValue, gid, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to promote users in a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Demote users in a group.
// @param groupID(type=string) The ID of the group whose members are being demoted.
// @param userIDs(type=string[]) Table array of user IDs to demote.
// @param callerID(type=string, optional=true) User ID of the caller, will apply permissions checks of the user. If empty defaults to system user and permission checks are bypassed.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupUsersDemote(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupID := getJsString(r, f.Argument(0))
		if groupID == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		gid, err := uuid.FromString(groupID)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDs := f.Argument(1)
		if goja.IsUndefined(userIDs) || goja.IsNull(userIDs) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		userIDsArray, err := exportToSlice[[]string](userIDs)
		if err != nil {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		uids := make([]uuid.UUID, 0, len(userIDsArray))
		for _, id := range userIDsArray {
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if uid == uuid.Nil {
				panic(r.NewTypeError("cannot demote the root user"))
			}
			uids = append(uids, uid)
		}
		if len(userIDsArray) == 0 {
			return goja.Undefined()
		}

		callerIDValue := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerID := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerID)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerIDValue = cid
		}

		if err := DemoteGroupUsers(n.ctx, n.logger, n.db, n.router, callerIDValue, gid, uids); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to demote users in a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group groups
// @summary Find groups based on the entered criteria.
// @param name(type=string) Search for groups that contain this value in their name.
// @param langTag(type=string, optional=true) Filter based upon the entered language tag.
// @param open(type=bool, optional=true) Filter based on whether groups are Open or Closed.
// @param edgeCount(type=number, optional=true) Search groups with an equal or lower number of members in descending order.
// @param limit(type=number, optional=true, default=100) Return only the required number of groups denoted by this limit value.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return groups(nkruntime.GroupList) A list of groups.
// @return cursor(string) An optional next page cursor that can be used to retrieve the next page of records (if any). Will be set to "" or null when fetching last available page.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var name string
		if !goja.IsUndefined(f.Argument(0)) && !goja.IsNull(f.Argument(0)) {
			name = getJsString(r, f.Argument(0))
		}

		var langTag string
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			langTag = getJsString(r, f.Argument(1))
		}

		var open *bool
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			open = new(bool)
			*open = getJsBool(r, f.Argument(2))
		}

		edgeCount := -1
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			edgeCount = int(getJsInt(r, f.Argument(3)))
		}

		limit := 100
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			limit = int(getJsInt(r, f.Argument(4)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("expects limit to be 1-100"))
			}
		}

		cursor := ""
		if !goja.IsUndefined(f.Argument(5)) && !goja.IsNull(f.Argument(5)) {
			cursor = getJsString(r, f.Argument(5))
		}

		groups, err := ListGroups(n.ctx, n.logger, n.db, name, langTag, open, edgeCount, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing groups: %s", err.Error())))
		}

		groupsSlice := make([]interface{}, 0, len(groups.Groups))
		for _, g := range groups.Groups {
			groupData, err := groupToJsObject(g)
			if err != nil {
				panic(r.NewGoError(err))
			}

			groupsSlice = append(groupsSlice, groupData)
		}

		result := make(map[string]interface{}, 2)
		result["groups"] = groupsSlice

		if groups.Cursor == "" {
			result["cursor"] = nil
		} else {
			result["cursor"] = groups.Cursor
		}

		return r.ToValue(result)
	}
}

// @group groups
// @summary Fetch one or more groups randomly.
// @param count(type=number) The number of groups to fetch.
// @return groups(nkruntime.Group[]) A list of group record objects.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) groupsGetRandom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		count := getJsInt(r, f.Argument(0))

		if count < 0 || count > 1000 {
			panic(r.NewTypeError("count must be 0-1000"))
		}

		groups, err := GetRandomGroups(n.ctx, n.logger, n.db, int(count))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get groups: %s", err.Error())))
		}

		groupsData := make([]map[string]interface{}, 0, len(groups))
		for _, group := range groups {
			userData, err := groupToJsObject(group)
			if err != nil {
				panic(r.NewGoError(err))
			}
			groupsData = append(groupsData, userData)
		}

		return r.ToValue(groupsData)
	}
}

// @group utils
// @summary Read file from user device.
// @param relPath(type=string) Relative path to the file to be read.
// @return fileRead(string) The read file contents.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) fileRead(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		relPath := getJsString(r, f.Argument(0))
		if relPath == "" {
			panic(r.NewTypeError("expects relative path string"))
		}

		rootPath := n.config.GetRuntime().Path

		file, err := FileRead(rootPath, relPath)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to open file: %s", err.Error())))
		}
		defer file.Close()

		fContent, err := io.ReadAll(file)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to read file: %s", err.Error())))
		}

		return r.ToValue(string(fContent))
	}
}

func (n *RuntimeJavascriptNakamaModule) localcacheGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		key := getJsString(r, f.Argument(0))
		if key == "" {
			panic(r.NewTypeError("expects non empty key string"))
		}

		defVal := goja.Undefined()
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			defVal = f.Argument(1)
		}

		value, found := n.localCache.Get(key)
		if !found {
			return defVal
		}

		return r.ToValue(value)
	}
}

func (n *RuntimeJavascriptNakamaModule) localcachePut(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		key := getJsString(r, f.Argument(0))
		if key == "" {
			panic(r.NewTypeError("expects non empty key string"))
		}

		value := f.Argument(1)
		if value == goja.Undefined() || value == goja.Null() {
			panic(r.NewTypeError("expects a non empty value"))
		}

		var ttl int64
		ttlArg := f.Argument(2)
		if ttlArg != goja.Undefined() && ttlArg != goja.Null() {
			ttl = getJsInt(r, f.Argument(2))
		}
		if ttl < 0 {
			panic(r.NewTypeError("ttl must be 0 or more"))
		}

		v := value.Export()

		switch v.(type) {
		case string, int64, float64, bool:
		default:
			panic(r.NewTypeError("unsupported value type: must be string, numeric or boolean"))
		}

		n.localCache.Put(key, v, ttl)

		return goja.Undefined()
	}
}

func (n *RuntimeJavascriptNakamaModule) localcacheDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		key := getJsString(r, f.Argument(0))
		if key == "" {
			panic(r.NewTypeError("expects non empty key string"))
		}

		n.localCache.Delete(key)

		return goja.Undefined()
	}
}

func (n *RuntimeJavascriptNakamaModule) localcacheClear(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		n.localCache.Clear()

		return goja.Undefined()
	}
}

// @group chat
// @summary Send a message on a realtime chat channel.
// @param channelId(type=string) The ID of the channel to send the message on.
// @param content(type=object) Message content.
// @param senderID(type=string) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return channelMessageSend(nkruntime.ChannelMessageAck) Message sent ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) channelMessageSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		channelId := getJsString(r, f.Argument(0))

		contentStr := "{}"
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			content, ok := f.Argument(1).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects content to be an object"))
			}
			contentBytes, err := json.Marshal(content)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("error encoding content: %v", err.Error())))
			}
			if len(contentBytes) == 0 || contentBytes[0] != byteBracket {
				panic(r.NewTypeError("expects message content to be a valid JSON object"))
			}
			contentStr = string(contentBytes)
		}

		sid := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			senderID := getJsString(r, f.Argument(2))
			senderUUID, err := uuid.FromString(senderID)
			if err != nil {
				panic(r.NewTypeError("expects sender id to be valid identifier"))
			}
			sid = senderUUID
		}

		var senderUsername string
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			senderUsername = getJsString(r, f.Argument(3))
		}

		persist := true
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			persist = getJsBool(r, f.Argument(4))
		}

		channelIdToStreamResult, err := ChannelIdToStream(channelId)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		ack, err := ChannelMessageSend(n.ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, contentStr, sid.String(), senderUsername, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to send channel message: %s", err.Error())))
		}

		channelMessageAckMap := make(map[string]interface{}, 7)
		channelMessageAckMap["channelId"] = ack.ChannelId
		channelMessageAckMap["messageId"] = ack.MessageId
		channelMessageAckMap["code"] = ack.Code
		channelMessageAckMap["username"] = ack.Username
		channelMessageAckMap["createTime"] = ack.CreateTime.Seconds
		channelMessageAckMap["updateTime"] = ack.UpdateTime.Seconds
		channelMessageAckMap["persistent"] = ack.Persistent

		return r.ToValue(channelMessageAckMap)
	}
}

// @group chat
// @summary Update a message on a realtime chat channel.
// @param channelId(type=string) The ID of the channel to send the message on.
// @param messageId(type=string) The ID of the message to update.
// @param content(type=object) Message content.
// @param senderID(type=string) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return channelMessageUpdate(nkruntime.ChannelMessageAck) Message updated ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) channelMessageUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		channelId := getJsString(r, f.Argument(0))

		messageId := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(messageId); err != nil {
			panic(r.NewTypeError(errChannelMessageIdInvalid.Error()))
		}

		contentStr := "{}"
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			content, ok := f.Argument(2).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects content to be an object"))
			}
			contentBytes, err := json.Marshal(content)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("error encoding content: %v", err.Error())))
			}
			if len(contentBytes) == 0 || contentBytes[0] != byteBracket {
				panic(r.NewTypeError("expects message content to be a valid JSON object"))
			}
			contentStr = string(contentBytes)
		}

		sid := uuid.Nil
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			senderID := getJsString(r, f.Argument(3))
			senderUUID, err := uuid.FromString(senderID)
			if err != nil {
				panic(r.NewTypeError("expects sender id to be valid identifier"))
			}
			sid = senderUUID
		}

		var senderUsername string
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			senderUsername = getJsString(r, f.Argument(4))
		}

		persist := true
		if !goja.IsUndefined(f.Argument(5)) && !goja.IsNull(f.Argument(5)) {
			persist = getJsBool(r, f.Argument(5))
		}

		channelIdToStreamResult, err := ChannelIdToStream(channelId)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		ack, err := ChannelMessageUpdate(n.ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, messageId, contentStr, sid.String(), senderUsername, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update channel message: %s", err.Error())))
		}

		channelMessageAckMap := make(map[string]interface{}, 7)
		channelMessageAckMap["channelId"] = ack.ChannelId
		channelMessageAckMap["messageId"] = ack.MessageId
		channelMessageAckMap["code"] = ack.Code
		channelMessageAckMap["username"] = ack.Username
		channelMessageAckMap["createTime"] = ack.CreateTime.Seconds
		channelMessageAckMap["updateTime"] = ack.UpdateTime.Seconds
		channelMessageAckMap["persistent"] = ack.Persistent

		return r.ToValue(channelMessageAckMap)
	}
}

// @group chat
// @summary Remove a message on a realtime chat channel.
// @param channelID(type=string) The ID of the channel to send the message on.
// @param messageID(type=string) The ID of the message to remove.
// @param senderID(type=string) The UUID for the sender of this message. If left empty, it will be assumed that it is a system message.
// @param senderUsername(type=string) The username of the user to send this message as. If left empty, it will be assumed that it is a system message.
// @param persist(type=bool, optional=true, default=true) Whether to record this message in the channel history.
// @return channelMessageRemove(nkruntime.ChannelMessageAck) Message removed ack containing the following variables: 'channelId', 'messageId', 'code', 'username', 'createTime', 'updateTime', and 'persistent'.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) channelMessageRemove(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		channelID := getJsString(r, f.Argument(0))

		messageID := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(messageID); err != nil {
			panic(r.NewTypeError(errChannelMessageIdInvalid.Error()))
		}

		sid := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			senderID := getJsString(r, f.Argument(2))
			senderUUID, err := uuid.FromString(senderID)
			if err != nil {
				panic(r.NewTypeError("expects sender id to be valid identifier"))
			}
			sid = senderUUID
		}

		var senderUsername string
		if !goja.IsUndefined(f.Argument(3)) && !goja.IsNull(f.Argument(3)) {
			senderUsername = getJsString(r, f.Argument(3))
		}

		persist := true
		if !goja.IsUndefined(f.Argument(4)) && !goja.IsNull(f.Argument(4)) {
			persist = getJsBool(r, f.Argument(4))
		}

		channelIdToStreamResult, err := ChannelIdToStream(channelID)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		ack, err := ChannelMessageRemove(n.ctx, n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelID, messageID, sid.String(), senderUsername, persist)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to remove channel message: %s", err.Error())))
		}

		channelMessageAckMap := make(map[string]interface{}, 7)
		channelMessageAckMap["channelId"] = ack.ChannelId
		channelMessageAckMap["messageId"] = ack.MessageId
		channelMessageAckMap["code"] = ack.Code
		channelMessageAckMap["username"] = ack.Username
		channelMessageAckMap["createTime"] = ack.CreateTime.Seconds
		channelMessageAckMap["updateTime"] = ack.UpdateTime.Seconds
		channelMessageAckMap["persistent"] = ack.Persistent

		return r.ToValue(channelMessageAckMap)
	}
}

// @group chat
// @summary List messages from a realtime chat channel.
// @param channelId(type=string) The ID of the channel to list messages from.
// @param limit(type=number, optional=true, default=100) The number of messages to return per page.
// @param forward(type=bool, optional=true, default=true) Whether to list messages from oldest to newest, or newest to oldest.
// @param cursor(type=string, optional=true, default="") Pagination cursor from previous result. Don't set to start fetching from the beginning.
// @return channelMessagesList(nkruntime.ChannelMessageList) Messages from the specified channel and possibly a cursor. If cursor is empty/null there are no further results.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) channelMessagesList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		channelId := getJsString(r, f.Argument(0))

		limit := 100
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(1)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		forward := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			forward = getJsBool(r, f.Argument(2))
		}

		var cursor string
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		channelIdToStreamResult, err := ChannelIdToStream(channelId)
		if err != nil {
			panic(r.NewTypeError(err.Error()))
		}

		list, err := ChannelMessagesList(n.ctx, n.logger, n.db, uuid.Nil, channelIdToStreamResult.Stream, channelId, limit, forward, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list channel messages: %s", err.Error())))
		}

		messages := make([]interface{}, 0, len(list.Messages))
		for _, message := range list.Messages {
			messages = append(messages, map[string]interface{}{
				"channelId":  message.ChannelId,
				"messageId":  message.MessageId,
				"code":       message.Code.Value,
				"senderId":   message.SenderId,
				"username":   message.Username,
				"content":    message.Content,
				"createTime": message.CreateTime.Seconds,
				"updateTime": message.UpdateTime.Seconds,
				"persistent": message.Persistent.Value,
				"roomName":   message.RoomName,
				"groupId":    message.GroupId,
				"userIdOne":  message.UserIdOne,
				"userIdTwo":  message.UserIdTwo,
			})
		}

		result := map[string]interface{}{
			"messages":   messages,
			"nextCursor": list.NextCursor,
			"prevCursor": list.PrevCursor,
		}

		return r.ToValue(result)
	}
}

// @group chat
// @summary Create a channel identifier to be used in other runtime calls. Does not create a channel.
// @param senderID(type=string) UserID of the message sender (when applicable). Defaults to the system user if void.
// @param target(type=string) Can be the room name, group identifier, or another username.
// @param chanType(type=nkruntime.ChannelType) The type of channel, either Room (1), Direct (2), or Group (3).
// @return channelID(string) The generated ID representing a channel.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) channelIdBuild(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		sid := uuid.Nil
		senderID := f.Argument(0)
		if senderID != goja.Undefined() && senderID != goja.Null() {
			senderIDStr := getJsString(r, senderID)
			senderUUID, err := uuid.FromString(senderIDStr)
			if err != nil {
				panic(r.NewTypeError("expects sender id to be valid identifier"))
			}
			sid = senderUUID
		}

		target := getJsString(r, f.Argument(1))

		chanType := getJsInt(r, f.Argument(2))
		if chanType < 1 || chanType > 3 {
			panic(r.NewTypeError("invalid channel type: expects value 1-3"))
		}

		channelId, _, err := BuildChannelId(n.ctx, n.logger, n.db, sid, target, rtapi.ChannelJoin_Type(chanType))
		if err != nil {
			if errors.Is(err, runtime.ErrInvalidChannelTarget) || errors.Is(err, runtime.ErrInvalidChannelType) {
				panic(r.NewTypeError(err.Error()))
			}
			panic(r.NewGoError(err))
		}

		return r.ToValue(channelId)
	}
}

func (n *RuntimeJavascriptNakamaModule) satoriConstructor(r *goja.Runtime) (*goja.Object, error) {
	mappings := map[string]func(goja.FunctionCall) goja.Value{
		"authenticate":        n.satoriAuthenticate(r),
		"propertiesGet":       n.satoriPropertiesGet(r),
		"propertiesUpdate":    n.satoriPropertiesUpdate(r),
		"eventsPublish":       n.satoriPublishEvents(r),
		"serverEventsPublish": n.satoriServerEventsPublish(r),
		"experimentsList":     n.satoriExperimentsList(r),
		"flagsList":           n.satoriFlagsList(r),
		"flagsOverridesList":  n.satoriFlagsOverridesList(r),
		"liveEventsList":      n.satoriLiveEventsList(r),
		"messagesList":        n.satoriMessagesList(r),
		"messageUpdate":       n.satoriMessageUpdate(r),
		"messageDelete":       n.satoriMessageDelete(r),
	}

	constructor := func(call goja.ConstructorCall) *goja.Object {
		for k, f := range mappings {
			_ = call.This.Set(k, f)
		}

		return nil
	}

	return r.New(r.ToValue(constructor))
}

// @group satori
// @summary Get the Satori client.
// @return satori(*nkruntime.Satori) The satori client.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) getSatori(r *goja.Object) func(goja.FunctionCall) goja.Value {
	return func(goja.FunctionCall) goja.Value {
		return r
	}
}

// @group satori
// @summary Create a new identity.
// @param id(type=string) The identifier of the identity.
// @param props(type=nkruntime.AuthPropertiesUpdate, optional=true, default=null) Opt. Properties to update.
// @param noSession(type=bool, optional=true, default=true) Whether authenticate should skip session tracking.
// @param ipAddress(type=string, optional=true, default="") An optional client IP address to pass on to Satori for geo-IP lookup.
// @return properties(nkruntime.Properties) Returned properties.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriAuthenticate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		var props map[string]any
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			var ok bool
			props, ok = f.Argument(1).Export().(map[string]any)
			if !ok {
				panic(r.NewTypeError("expects properties must be an object"))
			}
		}

		var defPropsMap, customPropsMap map[string]string
		defaultProps, ok := props["default"]
		if ok {
			defPropsMap = getJsStringMap(r, r.ToValue(defaultProps))
		}
		customProps, ok := props["custom"]
		if ok {
			customPropsMap = getJsStringMap(r, r.ToValue(customProps))
		}

		noSession := true
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			noSession = getJsBool(r, f.Argument(2))
		}

		var ipAddress string
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			ipAddress = getJsString(r, f.Argument(2))
		}

		properties, err := n.satori.Authenticate(n.ctx, id, defPropsMap, customPropsMap, noSession, ipAddress)
		if err != nil {
			n.logger.Error("Failed to Satori Authenticate.", zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to satori authenticate: %s", err.Error())))
		}

		return r.ToValue(map[string]any{
			"default":  properties.Default,
			"custom":   properties.Custom,
			"computed": properties.Computed,
		})
	}
}

// @group satori
// @summary Get identity properties.
// @param id(type=string) The identifier of the identity.
// @return properties(nkruntime.Properties) The identity properties.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriPropertiesGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		props, err := n.satori.PropertiesGet(n.ctx, id)
		if err != nil {
			n.logger.Error("Failed to Satori Authenticate.", zap.Error(err))
			panic(r.NewGoError(fmt.Errorf("failed to satori list properties: %s", err.Error())))
		}

		return r.ToValue(map[string]any{
			"default":  props.Default,
			"custom":   props.Custom,
			"computed": props.Computed,
		})
	}
}

// @group satori
// @summary Update identity properties.
// @param id(type=string) The identifier of the identity.
// @param props(type=nkruntime.PropertiesUpdate) The identity properties to update.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriPropertiesUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		props, ok := f.Argument(1).Export().(map[string]any)
		if !ok {
			panic(r.NewTypeError("expects properties must be an object"))
		}

		properties := &runtime.PropertiesUpdate{}
		defProps, ok := props["default"]
		if ok {
			defPropsMap := getJsStringMap(r, r.ToValue(defProps))
			properties.Default = defPropsMap
		}
		customProps, ok := props["custom"]
		if ok {
			customPropsMap := getJsStringMap(r, r.ToValue(customProps))
			properties.Custom = customPropsMap
		}

		if recompute, ok := props["recompute"]; ok {
			recomputeBool, ok := recompute.(bool)
			if !ok {
				panic(r.NewTypeError("expects recompute to be a boolean"))
			}
			properties.Recompute = &recomputeBool
		}

		if err := n.satori.PropertiesUpdate(n.ctx, id, properties); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to satori update properties: %s", err.Error())))
		}

		return nil
	}
}

// @group satori
// @summary Publish events.
// @param identifier(type=string) The identifier of the identity.
// @param events(type=nkruntime.Event[]) An array of events to publish.
// @param ip(type=string, optional=true, default="") An optional client IP address to pass on to Satori for geo-IP lookup.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriPublishEvents(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		events := f.Argument(1)
		eventsArray, err := exportToSlice[[]map[string]any](events)
		if err != nil {
			panic(r.NewTypeError("expects array of event objects"))
		}

		evts := make([]*runtime.Event, 0, len(eventsArray))
		for _, eMap := range eventsArray {
			evt := &runtime.Event{}

			name, ok := eMap["name"]
			if ok {
				nameStr, ok := name.(string)
				if !ok {
					panic(r.NewTypeError("expects event name to be a string"))
				}
				evt.Name = nameStr
			}

			id, ok := eMap["id"]
			if ok {
				idStr, ok := id.(string)
				if !ok {
					panic(r.NewTypeError("expects event id to be a string"))
				}
				evt.Id = idStr
			}

			metadata, ok := eMap["metadata"]
			if ok {
				metadataMap := getJsStringMap(r, r.ToValue(metadata))
				if !ok {
					panic(r.NewTypeError("expects event metadata to be an object with string keys and values"))
				}
				evt.Metadata = metadataMap
			}

			value, ok := eMap["value"]
			if ok {
				valueStr, ok := value.(string)
				if !ok {
					panic(r.NewTypeError("expects event value to be a string"))
				}
				evt.Value = valueStr
			}

			ts, ok := eMap["timestamp"]
			if ok {
				tsInt, ok := ts.(int64)
				if !ok {
					panic(r.NewTypeError("expects event timestamp to be a number"))
				}
				evt.Timestamp = tsInt
			}

			evts = append(evts, evt)
		}

		var ip string
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			ip = getJsString(r, f.Argument(2))
		}

		if err := n.satori.EventsPublish(n.ctx, identifier, evts, ip); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to publish satori events: %s", err.Error())))
		}

		return nil
	}
}

// @group satori
// @summary Publish server events.
// @param events(type=nkruntime.Event[]) An array of events to publish.
// @param ip(type=string, optional=true, default="") An optional client IP address to pass on to Satori for geo-IP lookup.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriServerEventsPublish(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		events := f.Argument(0)
		eventsArray, err := exportToSlice[[]map[string]any](events)
		if err != nil {
			panic(r.NewTypeError("expects array of event objects"))
		}

		evts := make([]*runtime.Event, 0, len(eventsArray))
		for _, eMap := range eventsArray {
			evt := &runtime.Event{}

			name, ok := eMap["name"]
			if ok {
				nameStr, ok := name.(string)
				if !ok {
					panic(r.NewTypeError("expects event name to be a string"))
				}
				evt.Name = nameStr
			}

			id, ok := eMap["id"]
			if ok {
				idStr, ok := id.(string)
				if !ok {
					panic(r.NewTypeError("expects event id to be a string"))
				}
				evt.Id = idStr
			}

			metadata, ok := eMap["metadata"]
			if ok {
				metadataMap := getJsStringMap(r, r.ToValue(metadata))
				if !ok {
					panic(r.NewTypeError("expects event metadata to be an object with string keys and values"))
				}
				evt.Metadata = metadataMap
			}

			value, ok := eMap["value"]
			if ok {
				valueStr, ok := value.(string)
				if !ok {
					panic(r.NewTypeError("expects event value to be a string"))
				}
				evt.Value = valueStr
			}

			ts, ok := eMap["timestamp"]
			if ok {
				tsInt, ok := ts.(int64)
				if !ok {
					panic(r.NewTypeError("expects event timestamp to be a number"))
				}
				evt.Timestamp = tsInt
			}

			identityId, ok := eMap["identityId"]
			if ok {
				identityIdStr, ok := identityId.(string)
				if !ok {
					panic(r.NewTypeError("expects event identityId to be a string"))
				}
				evt.IdentityId = identityIdStr
			}

			sessionId, ok := eMap["sessionId"]
			if ok {
				sessionIdStr, ok := sessionId.(string)
				if !ok {
					panic(r.NewTypeError("expects event sessionId to be a string"))
				}
				evt.SessionId = sessionIdStr
			}

			sessionIssuedAt, ok := eMap["sessionIssuedAt"]
			if ok {
				sessionIssuedAtInt, ok := sessionIssuedAt.(int64)
				if !ok {
					panic(r.NewTypeError("expects event sessionIssuedAt to be a number"))
				}
				evt.SessionIssuedAt = sessionIssuedAtInt
			}

			sessionExpiresAt, ok := eMap["sessionExpiresAt"]
			if ok {
				sessionExpiresAtInt, ok := sessionExpiresAt.(int64)
				if !ok {
					panic(r.NewTypeError("expects event sessionExpiresAt to be a number"))
				}
				evt.SessionExpiresAt = sessionExpiresAtInt
			}

			evts = append(evts, evt)
		}

		var ip string
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			ip = getJsString(r, f.Argument(1))
		}

		if err := n.satori.ServerEventsPublish(n.ctx, evts, ip); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to publish satori events: %s", err.Error())))
		}

		return nil
	}
}

// @group satori
// @summary List experiments.
// @param identifier(type=string) The identifier of the identity.
// @param nameFilters(type=string[], optional=true, default=[]) Optional list of experiment names to filter.
// @return experiments(nkruntime.Experiment[]) The experiment list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriExperimentsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		nameFiltersArray := make([]string, 0)
		nameFilters := f.Argument(1)
		if !goja.IsUndefined(nameFilters) && !goja.IsNull(nameFilters) {
			var err error
			nameFiltersArray, err = exportToSlice[[]string](nameFilters)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
		}

		experimentList, err := n.satori.ExperimentsList(n.ctx, identifier, nameFiltersArray...)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list satori experiments: %s", err.Error())))
		}

		experiments := make([]any, 0, len(experimentList.Experiments))
		for _, e := range experimentList.Experiments {
			experiments = append(experiments, map[string]any{
				"name":  e.Name,
				"value": e.Value,
			})
		}

		return r.ToValue(map[string]any{
			"experiments": experiments,
		})
	}
}

// @group satori
// @summary List flags.
// @param identifier(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param nameFilters(type=string[], optional=true, default=[]) Optional list of flag names to filter.
// @return flags(nkruntime.Flag[]) The flag list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriFlagsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var identifier string
		if !goja.IsUndefined(f.Argument(0)) && !goja.IsNull(f.Argument(0)) {
			identifier = getJsString(r, f.Argument(0))
		}

		nameFiltersArray := make([]string, 0)
		nameFilters := f.Argument(1)
		if !goja.IsUndefined(nameFilters) && !goja.IsNull(nameFilters) {
			var err error
			nameFiltersArray, err = exportToSlice[[]string](nameFilters)
			if err != nil {
				panic(r.NewTypeError("expect array of strings"))
			}
		}

		flagsList, err := n.satori.FlagsList(n.ctx, identifier, nameFiltersArray...)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list satori flags: %s", err.Error())))
		}

		flags := make([]any, 0, len(flagsList.Flags))
		for _, flag := range flagsList.Flags {
			outFlag := map[string]any{
				"name":             flag.Name,
				"value":            flag.Value,
				"conditionChanged": flag.ConditionChanged,
			}
			if flag.ValueChangeReason != nil {
				outFlag["changeReason"] = map[string]any{
					"name":        flag.ValueChangeReason.Name,
					"variantName": flag.ValueChangeReason.VariantName,
					"type":        flag.ValueChangeReason.Type,
				}
			}
			flags = append(flags, outFlag)
		}

		return r.ToValue(map[string]any{
			"flags": flags,
		})
	}
}

// @group satori
// @summary List flags overrides.
// @param identifier(type=string) The identifier of the identity. Set to empty string to fetch all default flag values.
// @param nameFilters(type=string[], optional=true, default=[]) Optional list of flag names to filter.
// @return flagsOverrides(nkruntime.FlagOverride[]) The flag list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriFlagsOverridesList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var identifier string
		if !goja.IsUndefined(f.Argument(0)) && !goja.IsNull(f.Argument(0)) {
			identifier = getJsString(r, f.Argument(0))
		}

		nameFiltersArray := make([]string, 0)
		nameFilters := f.Argument(1)
		if !goja.IsUndefined(nameFilters) && !goja.IsNull(nameFilters) {
			var err error
			nameFiltersArray, err = exportToSlice[[]string](nameFilters)
			if err != nil {
				panic(r.NewTypeError("expect array of strings"))
			}
		}

		flagsList, err := n.satori.FlagsOverridesList(n.ctx, identifier, nameFiltersArray...)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list satori flags overrides: %s", err.Error())))
		}

		flagOverrides := make([]any, len(flagsList.Flags))
		for i, fl := range flagsList.Flags {
			overridesArray := make([]any, len(fl.Overrides))
			for j, o := range fl.Overrides {
				oo := r.NewObject()
				_ = oo.Set("name", o.Name)
				_ = oo.Set("type", o.Type)
				_ = oo.Set("variantName", o.VariantName)
				_ = oo.Set("value", o.Value)
				_ = oo.Set("createTimeSec", o.CreateTimeSec)
				overridesArray[j] = oo
			}
			fo := r.NewObject()
			_ = fo.Set("flagName", fl.FlagName)
			_ = fo.Set("overrides", overridesArray)
			flagOverrides[i] = fo
		}

		ro := r.NewObject()
		_ = ro.Set("flags", flagOverrides)

		return ro
	}
}

// @group satori
// @summary List live events.
// @param identifier(type=string) The identifier of the identity.
// @param nameFilters(type=string[], optional=true, default=[]) Optional list of live event names to filter.
// @return liveEvents(*nkruntime.LiveEvent[]) The live event list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriLiveEventsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		nameFiltersArray := make([]string, 0)
		nameFilters := f.Argument(1)
		if !goja.IsUndefined(nameFilters) && !goja.IsNull(nameFilters) {
			var err error
			nameFiltersArray, err = exportToSlice[[]string](nameFilters)
			if err != nil {
				panic(r.NewTypeError("expects an array of strings"))
			}
		}

		liveEventsList, err := n.satori.LiveEventsList(n.ctx, identifier, nameFiltersArray...)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list satori live-events %s:", err.Error())))
		}

		liveEvents := make([]any, 0, len(liveEventsList.LiveEvents))
		for _, le := range liveEventsList.LiveEvents {
			liveEvents = append(liveEvents, map[string]any{
				"name":            le.Name,
				"description":     le.Description,
				"value":           le.Value,
				"activeStartTime": le.ActiveStartTimeSec,
				"activeEndTime":   le.ActiveEndTimeSec,
				"id":              le.Id,
				"startTime":       le.StartTimeSec,
				"endTime":         le.EndTimeSec,
				"duration":        le.DurationSec,
				"resetCron":       le.ResetCronExpr,
			})
		}

		return r.ToValue(map[string]any{
			"liveEvents": liveEvents,
		})
	}
}

// @group satori
// @summary List messages.
// @param identifier(type=string) The identifier of the identity.
// @param limit(type=int, optional=true, default=100) The max number of messages to return.
// @param forward(type=bool, optional=true, default=true) True if listing should be older messages to newer, false if reverse.
// @param cursor(type=string, optional=true, default="") A pagination cursor, if any.
// @return messages(*nkruntime.Message[]) The message list.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriMessagesList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		limit := int64(100)
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			limit = getJsInt(r, f.Argument(1))
		}

		forward := false
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			forward = getJsBool(r, f.Argument(2))
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		messagesList, err := n.satori.MessagesList(n.ctx, identifier, int(limit), forward, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to list satori messages %s:", err.Error())))
		}

		messages := make([]any, 0, len(messagesList.Messages))
		for _, m := range messagesList.Messages {
			messages = append(messages, map[string]any{
				"scheduleId":  m.ScheduleId,
				"sendTime":    m.SendTime,
				"metadata":    m.Metadata,
				"createTime":  m.CreateTime,
				"updateTime":  m.UpdateTime,
				"readTime":    m.ReadTime,
				"consumeTime": m.ConsumeTime,
				"text":        m.Text,
				"id":          m.Id,
				"title":       m.Title,
				"imageUrl":    m.ImageUrl,
			})
		}

		out := map[string]any{
			"messages": messages,
		}

		if messagesList.PrevCursor != "" {
			out["prevCursor"] = messagesList.PrevCursor
		}
		if messagesList.NextCursor != "" {
			out["nextCursor"] = messagesList.NextCursor
		}

		return r.ToValue(out)
	}
}

// @group satori
// @summary Update message.
// @param identifier(type=string) The identifier of the identity.
// @param messageID(type=string) The id of the message.
// @param readTime(type=int) The time the message was read at the client.
// @param consumeTime(type=int, optiona=true, default=0) The time the message was consumed by the identity.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriMessageUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		messageID := getJsString(r, f.Argument(1))

		readTime := getJsInt(r, f.Argument(2))

		consumeTime := int64(0)
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			consumeTime = getJsInt(r, f.Argument(3))
		}

		if err := n.satori.MessageUpdate(n.ctx, identifier, messageID, readTime, consumeTime); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update satori message %s:", err.Error())))
		}

		return goja.Undefined()
	}
}

// @group satori
// @summary Delete message.
// @param identifier(type=string) The identifier of the identity.
// @param messageID(type=string) The identifier of the message.
// @return error(error) An optional error value if an error occurred.
func (n *RuntimeJavascriptNakamaModule) satoriMessageDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		identifier := getJsString(r, f.Argument(0))

		messageID := getJsString(r, f.Argument(1))

		if err := n.satori.MessageDelete(n.ctx, identifier, messageID); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to delete satori message %s:", err.Error())))
		}

		return goja.Undefined()
	}
}

func getJsString(r *goja.Runtime, v goja.Value) string {
	s, ok := v.Export().(string)
	if !ok {
		panic(r.NewTypeError("expects string"))
	}
	return s
}

func getJsStringMap(r *goja.Runtime, v goja.Value) map[string]string {
	m, ok := v.Export().(map[string]interface{})
	if !ok {
		panic(r.NewTypeError("expects object with string keys and values"))
	}

	res := make(map[string]string)
	for k, v := range m {
		s, ok := v.(string)
		if !ok {
			panic(r.NewTypeError("expects string"))
		}
		res[k] = s
	}
	return res
}

func getJsInt(r *goja.Runtime, v goja.Value) int64 {
	i, ok := v.Export().(int64)
	if !ok {
		panic(r.NewTypeError("expects number"))
	}
	return i
}

func getJsFloat(r *goja.Runtime, v goja.Value) float64 {
	e := v.Export()
	f, ok := e.(float64)
	if !ok {
		i, ok := e.(int64)
		if ok {
			return float64(i)
		} else {
			panic(r.NewTypeError("expects number"))
		}
	}
	return f
}

func getJsBool(r *goja.Runtime, v goja.Value) bool {
	b, ok := v.Export().(bool)
	if !ok {
		panic(r.NewTypeError("expects boolean"))
	}
	return b
}

func accountToJsObject(account *api.Account) (map[string]interface{}, error) {
	accountData := make(map[string]interface{})
	userData, err := userToJsObject(account.User)
	if err != nil {
		return nil, err
	}
	accountData["user"] = userData

	walletData := make(map[string]int64)
	err = json.Unmarshal([]byte(account.Wallet), &walletData)
	if err != nil {
		return nil, fmt.Errorf("failed to convert wallet to json: %s", err.Error())
	}
	accountData["wallet"] = walletData

	if account.Email != "" {
		accountData["email"] = account.Email
	}
	if len(account.Devices) != 0 {
		devices := make([]map[string]string, 0, len(account.Devices))
		for _, device := range account.Devices {
			deviceData := make(map[string]string)
			deviceData["id"] = device.Id
			devices = append(devices, deviceData)
		}
		accountData["devices"] = devices
	}

	if account.CustomId != "" {
		accountData["customId"] = account.CustomId
	}
	if account.VerifyTime != nil {
		accountData["verifyTime"] = account.VerifyTime.Seconds
	}
	if account.DisableTime != nil {
		accountData["disableTime"] = account.DisableTime.Seconds
	}

	return accountData, nil
}

func userToJsObject(user *api.User) (map[string]interface{}, error) {
	userData := make(map[string]interface{}, 18)
	userData["userId"] = user.Id
	userData["username"] = user.Username
	userData["displayName"] = user.DisplayName
	userData["avatarUrl"] = user.AvatarUrl
	userData["langTag"] = user.LangTag
	userData["location"] = user.Location
	userData["timezone"] = user.Timezone
	if user.AppleId != "" {
		userData["appleId"] = user.AppleId
	}
	if user.FacebookId != "" {
		userData["facebookId"] = user.FacebookId
	}
	if user.FacebookInstantGameId != "" {
		userData["facebookInstantGameId"] = user.FacebookInstantGameId
	}
	if user.GoogleId != "" {
		userData["googleId"] = user.GoogleId
	}
	if user.GamecenterId != "" {
		userData["gamecenterId"] = user.GamecenterId
	}
	if user.SteamId != "" {
		userData["steamId"] = user.SteamId
	}
	userData["online"] = user.Online
	userData["edgeCount"] = user.EdgeCount
	userData["createTime"] = user.CreateTime.Seconds
	userData["updateTime"] = user.UpdateTime.Seconds

	metadata := make(map[string]interface{})
	err := json.Unmarshal([]byte(user.Metadata), &metadata)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadata)
	userData["metadata"] = metadata

	return userData, nil
}

func groupToJsObject(group *api.Group) (map[string]interface{}, error) {
	groupMap := make(map[string]interface{}, 12)

	groupMap["id"] = group.Id
	groupMap["creatorId"] = group.CreatorId
	groupMap["name"] = group.Name
	groupMap["description"] = group.Description
	groupMap["avatarUrl"] = group.AvatarUrl
	groupMap["langTag"] = group.LangTag
	groupMap["open"] = group.Open.Value
	groupMap["edgeCount"] = group.EdgeCount
	groupMap["maxCount"] = group.MaxCount
	groupMap["createTime"] = group.CreateTime.Seconds
	groupMap["updateTime"] = group.UpdateTime.Seconds

	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(group.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert group metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	groupMap["metadata"] = metadataMap

	return groupMap, nil
}

func leaderboardToJsObject(leaderboard *api.Leaderboard) (map[string]interface{}, error) {
	leaderboardMap := make(map[string]interface{}, 11)
	leaderboardMap["id"] = leaderboard.Id
	leaderboardMap["operator"] = strings.ToLower(leaderboard.Operator.String())
	leaderboardMap["sortOrder"] = leaderboard.SortOrder
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(leaderboard.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	leaderboardMap["metadata"] = metadataMap
	leaderboardMap["createTime"] = leaderboard.CreateTime.Seconds
	if leaderboard.PrevReset != 0 {
		leaderboardMap["prevReset"] = leaderboard.PrevReset
	}
	if leaderboard.NextReset != 0 {
		leaderboardMap["nextReset"] = leaderboard.NextReset
	}
	leaderboardMap["authoritative"] = leaderboard.Authoritative

	return leaderboardMap, nil
}

func tournamentToJsObject(tournament *api.Tournament) (map[string]interface{}, error) {
	tournamentMap := make(map[string]interface{}, 19)

	tournamentMap["id"] = tournament.Id
	tournamentMap["title"] = tournament.Title
	tournamentMap["description"] = tournament.Description
	tournamentMap["category"] = tournament.Category
	tournamentMap["sortOrder"] = tournament.SortOrder
	tournamentMap["size"] = tournament.Size
	tournamentMap["maxSize"] = tournament.MaxSize
	tournamentMap["maxNumScore"] = tournament.MaxNumScore
	tournamentMap["duration"] = tournament.Duration
	tournamentMap["startActive"] = tournament.StartActive
	tournamentMap["endActive"] = tournament.EndActive
	tournamentMap["canEnter"] = tournament.CanEnter
	if tournament.PrevReset != 0 {
		tournamentMap["prevReset"] = tournament.PrevReset
	}
	if tournament.NextReset != 0 {
		tournamentMap["nextReset"] = tournament.NextReset
	}
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		return nil, fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	tournamentMap["metadata"] = metadataMap
	tournamentMap["createTime"] = tournament.CreateTime.Seconds
	tournamentMap["startTime"] = tournament.StartTime.Seconds
	if tournament.EndTime == nil {
		tournamentMap["endTime"] = nil
	} else {
		tournamentMap["endTime"] = tournament.EndTime.Seconds
	}
	tournamentMap["operator"] = strings.ToLower(tournament.Operator.String())
	tournamentMap["joinRequired"] = tournament.JoinRequired

	return tournamentMap, nil
}

func purchaseResponseToJsObject(validation *api.ValidatePurchaseResponse) map[string]interface{} {
	validatedPurchases := make([]interface{}, 0, len(validation.ValidatedPurchases))
	for _, v := range validation.ValidatedPurchases {
		validatedPurchases = append(validatedPurchases, validatedPurchaseToJsObject(v))
	}

	validationMap := make(map[string]interface{}, 1)
	validationMap["validatedPurchases"] = validatedPurchases

	return validationMap
}

func validatedPurchaseToJsObject(purchase *api.ValidatedPurchase) map[string]interface{} {
	validatedPurchaseMap := make(map[string]interface{}, 11)
	validatedPurchaseMap["userId"] = purchase.UserId
	validatedPurchaseMap["productId"] = purchase.ProductId
	validatedPurchaseMap["transactionId"] = purchase.TransactionId
	validatedPurchaseMap["store"] = purchase.Store.String()
	validatedPurchaseMap["providerResponse"] = purchase.ProviderResponse
	validatedPurchaseMap["purchaseTime"] = purchase.PurchaseTime.Seconds
	if purchase.CreateTime != nil {
		// Create time is empty for non-persisted purchases.
		validatedPurchaseMap["createTime"] = purchase.CreateTime.Seconds
	}
	if purchase.UpdateTime != nil {
		// Update time is empty for non-persisted purchases.
		validatedPurchaseMap["updateTime"] = purchase.UpdateTime.Seconds
	}
	if purchase.RefundTime != nil {
		validatedPurchaseMap["refundTime"] = purchase.RefundTime.Seconds
	}
	validatedPurchaseMap["environment"] = purchase.Environment.String()
	validatedPurchaseMap["seenBefore"] = purchase.SeenBefore

	return validatedPurchaseMap
}

func subscriptionResponseToJsObject(validation *api.ValidateSubscriptionResponse) map[string]interface{} {
	return map[string]interface{}{"validatedSubscription": subscriptionToJsObject(validation.ValidatedSubscription)}
}

func subscriptionToJsObject(subscription *api.ValidatedSubscription) map[string]interface{} {
	validatedSubMap := make(map[string]interface{}, 13)
	validatedSubMap["userId"] = subscription.UserId
	validatedSubMap["productId"] = subscription.ProductId
	validatedSubMap["originalTransactionId"] = subscription.OriginalTransactionId
	validatedSubMap["store"] = subscription.Store.String()
	validatedSubMap["purchaseTime"] = subscription.PurchaseTime.Seconds
	validatedSubMap["expiryTime"] = subscription.ExpiryTime.Seconds
	if subscription.CreateTime != nil {
		// Create time is empty for non-persisted subscriptions.
		validatedSubMap["createTime"] = subscription.CreateTime.Seconds
	}
	if subscription.UpdateTime != nil {
		// Update time is empty for non-persisted subscriptions.
		validatedSubMap["updateTime"] = subscription.UpdateTime.Seconds
	}
	if subscription.RefundTime != nil {
		validatedSubMap["refundTime"] = subscription.RefundTime.Seconds
	}
	validatedSubMap["environment"] = subscription.Environment.String()
	validatedSubMap["active"] = subscription.Active
	validatedSubMap["providerResponse"] = subscription.ProviderResponse
	validatedSubMap["providerNotification"] = subscription.ProviderNotification

	return validatedSubMap
}

func jsObjectToPresenceStream(r *goja.Runtime, streamObj map[string]interface{}) PresenceStream {
	stream := PresenceStream{}

	modeRaw, ok := streamObj["mode"]
	if ok {
		mode, ok := modeRaw.(int64)
		if !ok {
			panic(r.NewTypeError("stream mode must be a number"))
		}
		stream.Mode = uint8(mode)
	}

	subjectRaw, ok := streamObj["subject"]
	if ok {
		subject, ok := subjectRaw.(string)
		if !ok {
			panic(r.NewTypeError("stream subject must be a string"))
		}
		uuid, err := uuid.FromString(subject)
		if err != nil {
			panic(r.NewTypeError("stream subject must be a valid identifier"))
		}
		stream.Subject = uuid
	}

	subcontextRaw, ok := streamObj["subcontext"]
	if ok {
		subcontext, ok := subcontextRaw.(string)
		if !ok {
			panic(r.NewTypeError("stream subcontext must be a string"))
		}
		uuid, err := uuid.FromString(subcontext)
		if err != nil {
			panic(r.NewTypeError("stream subcontext must be a valid identifier"))
		}
		stream.Subcontext = uuid
	}

	labelRaw, ok := streamObj["label"]
	if ok {
		label, ok := labelRaw.(string)
		if !ok {
			panic(r.NewTypeError("stream label must be a string"))
		}
		stream.Label = label
	}

	return stream
}

// pointerizeSlices recursively walks a map[string]interface{} and replaces any []interface{} references for *[]interface{}.
// This is needed to allow goja operations that resize a JS wrapped Go slice to work as expected, otherwise
// such operations won't reflect on the original slice as it would be passed by value and not by reference.
func pointerizeSlices(m interface{}) {
	switch i := m.(type) {
	case map[string]interface{}:
		for k, v := range i {
			if s, ok := v.([]interface{}); ok {
				i[k] = &s
				pointerizeSlices(&s)
			}
			if mi, ok := v.(map[string]interface{}); ok {
				pointerizeSlices(mi)
			}
		}
	case *[]interface{}:
		for idx, v := range *i {
			if s, ok := v.([]interface{}); ok {
				(*i)[idx] = &s
				pointerizeSlices(&s)
			}
			if mi, ok := v.(map[string]interface{}); ok {
				pointerizeSlices(mi)
			}
		}
	}
}

func exportToSlice[S ~[]E, E any](v goja.Value) (S, error) {
	value := v.Export()
	slice, ok := value.([]any)
	if !ok {
		slicePtr, ok := value.(*[]any)
		if !ok {
			return nil, errors.New("invalid input: expects an array")
		}
		slice = *slicePtr
	}

	results := make(S, 0, len(slice))

	for _, e := range slice {
		r, ok := e.(E)
		if !ok {
			return nil, fmt.Errorf("invalid array entry type: %v", e)
		}
		results = append(results, r)
	}

	return results, nil
}
