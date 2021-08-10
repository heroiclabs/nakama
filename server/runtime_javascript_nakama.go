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
	"strings"
	"time"

	"github.com/dgrijalva/jwt-go"
	"github.com/dop251/goja"
	"github.com/gofrs/uuid"
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

type runtimeJavascriptNakamaModule struct {
	logger               *zap.Logger
	config               Config
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	httpClient           *http.Client
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	rankCache            LeaderboardRankCache
	localCache           *RuntimeJavascriptLocalCache
	leaderboardScheduler LeaderboardScheduler
	tracker              Tracker
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	matchRegistry        MatchRegistry
	streamManager        StreamManager
	router               MessageRouter

	node          string
	matchCreateFn RuntimeMatchCreateFunction
	eventFn       RuntimeEventCustomFunction
}

func NewRuntimeJavascriptNakamaModule(logger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, rankCache LeaderboardRankCache, localCache *RuntimeJavascriptLocalCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, streamManager StreamManager, router MessageRouter, eventFn RuntimeEventCustomFunction, matchCreateFn RuntimeMatchCreateFunction) *runtimeJavascriptNakamaModule {
	return &runtimeJavascriptNakamaModule{
		logger:               logger,
		config:               config,
		db:                   db,
		protojsonMarshaler:   protojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		streamManager:        streamManager,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		matchRegistry:        matchRegistry,
		router:               router,
		tracker:              tracker,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		rankCache:            rankCache,
		localCache:           localCache,
		leaderboardScheduler: leaderboardScheduler,
		httpClient: &http.Client{
			Timeout: 5 * time.Second,
		},

		node:          config.GetName(),
		eventFn:       eventFn,
		matchCreateFn: matchCreateFn,
	}
}

func (n *runtimeJavascriptNakamaModule) Constructor(r *goja.Runtime) func(goja.ConstructorCall) *goja.Object {
	return func(call goja.ConstructorCall) *goja.Object {
		for fnName, fn := range n.mappings(r) {
			call.This.Set(fnName, fn)
		}
		freeze(call.This)

		return nil
	}
}

func (n *runtimeJavascriptNakamaModule) mappings(r *goja.Runtime) map[string]func(goja.FunctionCall) goja.Value {
	return map[string]func(goja.FunctionCall) goja.Value{
		"event":                           n.event(r),
		"uuidv4":                          n.uuidV4(r),
		"cronNext":                        n.cronNext(r),
		"sqlExec":                         n.sqlExec(r),
		"sqlQuery":                        n.sqlQuery(r),
		"httpRequest":                     n.httpRequest(r),
		"base64Encode":                    n.base64Encode(r),
		"base64Decode":                    n.base64Decode(r),
		"base64UrlEncode":                 n.base64UrlEncode(r),
		"base64UrlDecode":                 n.base64UrlDecode(r),
		"base16Encode":                    n.base16Encode(r),
		"base16Decode":                    n.base16Decode(r),
		"jwtGenerate":                     n.jwtGenerate(r),
		"aes128Encrypt":                   n.aes128Encrypt(r),
		"aes128Decrypt":                   n.aes128Decrypt(r),
		"aes256Encrypt":                   n.aes256Encrypt(r),
		"aes256Decrypt":                   n.aes256Decrypt(r),
		"md5Hash":                         n.md5Hash(r),
		"sha256Hash":                      n.sha256Hash(r),
		"hmacSha256Hash":                  n.hmacSHA256Hash(r),
		"rsaSha256Hash":                   n.rsaSHA256Hash(r),
		"bcryptHash":                      n.bcryptHash(r),
		"bcryptCompare":                   n.bcryptCompare(r),
		"authenticateApple":               n.authenticateApple(r),
		"authenticateCustom":              n.authenticateCustom(r),
		"authenticateDevice":              n.authenticateDevice(r),
		"authenticateEmail":               n.authenticateEmail(r),
		"authenticateFacebook":            n.authenticateFacebook(r),
		"authenticateFacebookInstantGame": n.authenticateFacebookInstantGame(r),
		"authenticateGameCenter":          n.authenticateGameCenter(r),
		"authenticateGoogle":              n.authenticateGoogle(r),
		"authenticateSteam":               n.authenticateSteam(r),
		"authenticateTokenGenerate":       n.authenticateTokenGenerate(r),
		"accountGetId":                    n.accountGetId(r),
		"accountsGetId":                   n.accountsGetId(r),
		"accountUpdateId":                 n.accountUpdateId(r),
		"accountDeleteId":                 n.accountDeleteId(r),
		"accountExportId":                 n.accountExportId(r),
		"usersGetId":                      n.usersGetId(r),
		"usersGetUsername":                n.usersGetUsername(r),
		"usersGetRandom":                  n.usersGetRandom(r),
		"usersBanId":                      n.usersBanId(r),
		"usersUnbanId":                    n.usersUnbanId(r),
		"linkApple":                       n.linkApple(r),
		"linkCustom":                      n.linkCustom(r),
		"linkDevice":                      n.linkDevice(r),
		"linkEmail":                       n.linkEmail(r),
		"linkFacebook":                    n.linkFacebook(r),
		"linkFacebookInstantGame":         n.linkFacebookInstantGame(r),
		"linkGameCenter":                  n.linkGameCenter(r),
		"linkGoogle":                      n.linkGoogle(r),
		"linkSteam":                       n.linkSteam(r),
		"unlinkApple":                     n.unlinkApple(r),
		"unlinkCustom":                    n.unlinkCustom(r),
		"unlinkDevice":                    n.unlinkDevice(r),
		"unlinkEmail":                     n.unlinkEmail(r),
		"unlinkFacebook":                  n.unlinkFacebook(r),
		"unlinkFacebookInstantGame":       n.unlinkFacebookInstantGame(r),
		"unlinkGameCenter":                n.unlinkGameCenter(r),
		"unlinkGoogle":                    n.unlinkGoogle(r),
		"unlinkSteam":                     n.unlinkSteam(r),
		"streamUserList":                  n.streamUserList(r),
		"streamUserGet":                   n.streamUserGet(r),
		"streamUserJoin":                  n.streamUserJoin(r),
		"streamUserUpdate":                n.streamUserUpdate(r),
		"streamUserLeave":                 n.streamUserLeave(r),
		"streamUserKick":                  n.streamUserKick(r),
		"streamCount":                     n.streamCount(r),
		"streamClose":                     n.streamClose(r),
		"streamSend":                      n.streamSend(r),
		"streamSendRaw":                   n.streamSendRaw(r),
		"sessionDisconnect":               n.sessionDisconnect(r),
		"sessionLogout":                   n.sessionLogout(r),
		"matchCreate":                     n.matchCreate(r),
		"matchGet":                        n.matchGet(r),
		"matchList":                       n.matchList(r),
		"notificationSend":                n.notificationSend(r),
		"notificationsSend":               n.notificationsSend(r),
		"walletUpdate":                    n.walletUpdate(r),
		"walletsUpdate":                   n.walletsUpdate(r),
		"walletLedgerUpdate":              n.walletLedgerUpdate(r),
		"walletLedgerList":                n.walletLedgerList(r),
		"storageList":                     n.storageList(r),
		"storageRead":                     n.storageRead(r),
		"storageWrite":                    n.storageWrite(r),
		"storageDelete":                   n.storageDelete(r),
		"multiUpdate":                     n.multiUpdate(r),
		"leaderboardCreate":               n.leaderboardCreate(r),
		"leaderboardDelete":               n.leaderboardDelete(r),
		"leaderboardList":                 n.leaderboardList(r),
		"leaderboardRecordsList":          n.leaderboardRecordsList(r),
		"leaderboardRecordWrite":          n.leaderboardRecordWrite(r),
		"leaderboardRecordDelete":         n.leaderboardRecordDelete(r),
		"leaderboardsGetId":               n.leaderboardsGetId(r),
		"purchaseValidateApple":           n.purchaseValidateApple(r),
		"purchaseValidateGoogle":          n.purchaseValidateGoogle(r),
		"purchaseValidateHuawei":          n.purchaseValidateHuawei(r),
		"purchaseGetByTransactionId":      n.purchaseGetByTransactionId(r),
		"purchasesList":                   n.purchasesList(r),
		"tournamentCreate":                n.tournamentCreate(r),
		"tournamentDelete":                n.tournamentDelete(r),
		"tournamentAddAttempt":            n.tournamentAddAttempt(r),
		"tournamentJoin":                  n.tournamentJoin(r),
		"tournamentList":                  n.tournamentList(r),
		"tournamentsGetId":                n.tournamentsGetId(r),
		"tournamentRecordsList":           n.tournamentRecordsList(r),
		"tournamentRecordWrite":           n.tournamentRecordWrite(r),
		"tournamentRecordsHaystack":       n.tournamentRecordsHaystack(r),
		"groupsGetId":                     n.groupsGetId(r),
		"groupCreate":                     n.groupCreate(r),
		"groupUpdate":                     n.groupUpdate(r),
		"groupDelete":                     n.groupDelete(r),
		"groupUsersKick":                  n.groupUsersKick(r),
		"groupUsersList":                  n.groupUsersList(r),
		"userGroupsList":                  n.userGroupsList(r),
		"friendsList":                     n.friendsList(r),
		"groupUserJoin":                   n.groupUserJoin(r),
		"groupUserLeave":                  n.groupUserLeave(r),
		"groupUsersAdd":                   n.groupUsersAdd(r),
		"groupUsersPromote":               n.groupUsersPromote(r),
		"groupUsersDemote":                n.groupUsersDemote(r),
		"groupsList":                      n.groupsList(r),
		"fileRead":                        n.fileRead(r),
		"localcacheGet":                   n.localcacheGet(r),
		"localcachePut":                   n.localcachePut(r),
		"localcacheDelete":                n.localcacheDelete(r),
		"channelMessageSend":              n.channelMessageSend(r),
		"channeldIdBuild":                 n.channelIdBuild(r),
	}
}

func (n *runtimeJavascriptNakamaModule) event(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		eventName := getJsString(r, f.Argument(0))
		properties := getJsStringMap(r, f.Argument(1))
		ts := &timestamppb.Timestamp{}
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			ts.Seconds = getJsInt(r, f.Argument(2))
		} else {
			ts.Seconds = time.Now().Unix()
		}
		external := false
		if f.Argument(3) != goja.Undefined() {
			external = getJsBool(r, f.Argument(3))
		}

		if n.eventFn != nil {
			n.eventFn(context.Background(), &api.Event{
				Name:       eventName,
				Properties: properties,
				Timestamp:  ts,
				External:   external,
			})
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) uuidV4(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		return r.ToValue(uuid.Must(uuid.NewV4()).String())
	}
}

func (n *runtimeJavascriptNakamaModule) cronNext(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		cron := getJsString(r, f.Argument(0))
		ts := getJsInt(r, f.Argument(1))

		expr, err := cronexpr.Parse(cron)
		if err != nil {
			panic(r.NewTypeError("expects a valid cron string"))
		}

		t := time.Unix(ts, 0).UTC()
		next := expr.Next(t)
		nextTs := next.UTC().Unix()

		return r.ToValue(nextTs)
	}
}

func (n *runtimeJavascriptNakamaModule) sqlExec(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		query := getJsString(r, f.Argument(0))
		var args []interface{}
		if f.Argument(1) == goja.Undefined() {
			args = make([]interface{}, 0)
		} else {
			var ok bool
			args, ok = f.Argument(1).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects array of query params"))
			}
		}

		var res sql.Result
		var err error
		err = ExecuteRetryable(func() error {
			res, err = n.db.Exec(query, args...)
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

func (n *runtimeJavascriptNakamaModule) sqlQuery(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		query := getJsString(r, f.Argument(0))
		var args []interface{}
		if f.Argument(1) == goja.Undefined() {
			args = make([]interface{}, 0)
		} else {
			var ok bool
			args, ok = f.Argument(1).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects array of query params"))
			}
		}

		var rows *sql.Rows
		var err error
		err = ExecuteRetryable(func() error {
			rows, err = n.db.Query(query, args...)
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

func (n *runtimeJavascriptNakamaModule) httpRequest(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		timeoutArg := f.Argument(4)
		if timeoutArg != goja.Undefined() && timeoutArg != goja.Null() {
			n.httpClient.Timeout = time.Duration(timeoutArg.ToInteger()) * time.Millisecond
		}

		n.logger.Debug(fmt.Sprintf("Http Timeout: %v", n.httpClient.Timeout))

		if url == "" {
			panic(r.NewTypeError("URL string cannot be emptypb."))
		}

		if !(method == "GET" || method == "POST" || method == "PUT" || method == "PATCH") {
			panic(r.NewTypeError("Invalid method must be one of: 'get', 'post', 'put', 'patch'."))
		}

		var requestBody io.Reader
		if body != "" {
			requestBody = strings.NewReader(body)
		}

		req, err := http.NewRequest(method, url, requestBody)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("HTTP request is invalid: %v", err.Error())))
		}

		for h, v := range headers {
			// TODO accept multiple values
			req.Header.Add(h, v)
		}

		resp, err := n.httpClient.Do(req)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("HTTP request error: %v", err.Error())))
		}

		// Read the response body.
		responseBody, err := ioutil.ReadAll(resp.Body)
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

func (n *runtimeJavascriptNakamaModule) base64Encode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		e := base64.URLEncoding
		if !padding {
			e = base64.RawURLEncoding
		}

		out := e.EncodeToString([]byte(in))
		return r.ToValue(out)
	}
}

func (n *runtimeJavascriptNakamaModule) base64Decode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		if !padding {
			// Pad string up to length multiple of 4 if needed to effectively make padding optional.
			if maybePad := len(in) % 4; maybePad != 0 {
				in += strings.Repeat("=", 4-maybePad)
			}
		}

		out, err := base64.StdEncoding.DecodeString(in)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", in)))
		}
		return r.ToValue(string(out))
	}
}

func (n *runtimeJavascriptNakamaModule) base64UrlEncode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		e := base64.URLEncoding
		if !padding {
			e = base64.RawURLEncoding
		}

		out := e.EncodeToString([]byte(in))
		return r.ToValue(out)
	}
}

func (n *runtimeJavascriptNakamaModule) base64UrlDecode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))
		padding := true
		if f.Argument(1) != goja.Undefined() {
			padding = getJsBool(r, f.Argument(1))
		}

		if !padding {
			// Pad string up to length multiple of 4 if needed to effectively make padding optional.
			if maybePad := len(in) % 4; maybePad != 0 {
				in += strings.Repeat("=", 4-maybePad)
			}
		}

		out, err := base64.URLEncoding.DecodeString(in)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", in)))
		}
		return r.ToValue(string(out))
	}
}

func (n *runtimeJavascriptNakamaModule) base16Encode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))

		out := hex.EncodeToString([]byte(in))
		return r.ToValue(out)
	}
}

func (n *runtimeJavascriptNakamaModule) base16Decode(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		in := getJsString(r, f.Argument(0))

		out, err := hex.DecodeString(in)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to decode string: %s", in)))
		}
		return r.ToValue(string(out))
	}
}

func (n *runtimeJavascriptNakamaModule) jwtGenerate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		algoType := getJsString(r, f.Argument(0))

		var signingMethod jwt.SigningMethod
		switch algoType {
		case "HS256":
			signingMethod = jwt.SigningMethodHS256
		case "RS256":
			signingMethod = jwt.SigningMethodRS256
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
		switch signingMethod {
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

		token := jwt.NewWithClaims(signingMethod, jwtClaims)
		signedToken, err := token.SignedString(pk)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to sign token: %v", err.Error())))
		}

		return r.ToValue(signedToken)
	}
}

func (n *runtimeJavascriptNakamaModule) aes128Encrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

func (n *runtimeJavascriptNakamaModule) aes128Decrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

func (n *runtimeJavascriptNakamaModule) aes256Encrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

func (n *runtimeJavascriptNakamaModule) aes256Decrypt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

// Returns the cipher text base64 encoded
func (n *runtimeJavascriptNakamaModule) aesEncrypt(keySize int, input, key string) (string, error) {
	if len(key) != keySize {
		return "", errors.New(fmt.Sprintf("expects key %v bytes long", keySize))
	}

	// Pad string up to length multiple of 4 if needed.
	if maybePad := len(input) % 4; maybePad != 0 {
		input += strings.Repeat(" ", 4-maybePad)
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", errors.New(fmt.Sprintf("error creating cipher block: %v", err.Error()))
	}

	cipherText := make([]byte, aes.BlockSize+len(input))
	iv := cipherText[:aes.BlockSize]
	if _, err = io.ReadFull(rand.Reader, iv); err != nil {
		return "", errors.New(fmt.Sprintf("error getting iv: %v", err.Error()))
	}

	stream := cipher.NewCFBEncrypter(block, iv)
	stream.XORKeyStream(cipherText[aes.BlockSize:], []byte(input))

	return base64.StdEncoding.EncodeToString(cipherText), nil
}

// Expect the input cipher text to be base64 encoded
func (n *runtimeJavascriptNakamaModule) aesDecrypt(keySize int, input, key string) (string, error) {
	if len(key) != keySize {
		return "", errors.New(fmt.Sprintf("expects key %v bytes long", keySize))
	}

	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		return "", errors.New(fmt.Sprintf("error creating cipher block: %v", err.Error()))
	}

	decodedtText, err := base64.StdEncoding.DecodeString(input)
	if err != nil {
		return "", errors.New(fmt.Sprintf("error decoding cipher text: %v", err.Error()))
	}
	cipherText := decodedtText
	iv := cipherText[:aes.BlockSize]
	cipherText = cipherText[aes.BlockSize:]

	stream := cipher.NewCFBDecrypter(block, iv)
	stream.XORKeyStream(cipherText, cipherText)

	return string(cipherText), nil
}

func (n *runtimeJavascriptNakamaModule) md5Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))

		hash := fmt.Sprintf("%x", md5.Sum([]byte(input)))

		return r.ToValue(hash)
	}
}

func (n *runtimeJavascriptNakamaModule) sha256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))

		hash := fmt.Sprintf("%x", sha256.Sum256([]byte(input)))

		return r.ToValue(hash)
	}
}

func (n *runtimeJavascriptNakamaModule) rsaSHA256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

func (n *runtimeJavascriptNakamaModule) hmacSHA256Hash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		return r.ToValue(string(mac.Sum(nil)))
	}
}

func (n *runtimeJavascriptNakamaModule) bcryptHash(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		hash, err := bcrypt.GenerateFromPassword([]byte(input), bcrypt.DefaultCost)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error hashing input: %v", err.Error())))
		}

		return r.ToValue(string(hash))
	}
}

func (n *runtimeJavascriptNakamaModule) bcryptCompare(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		hash := getJsString(r, f.Argument(0))
		if hash == "" {
			panic(r.NewTypeError("hash cannot be empty"))
		}

		plaintext := getJsString(r, f.Argument(1))
		if plaintext == "" {
			panic(r.NewTypeError("plaintext cannot be empty"))
		}

		err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext))
		if err == nil {
			return r.ToValue(true)
		} else if err == bcrypt.ErrHashTooShort || err == bcrypt.ErrMismatchedHashAndPassword {
			return r.ToValue(false)
		}

		panic(r.NewGoError(fmt.Errorf("error comparing hash and plaintext: %v", err.Error())))
	}
}

func (n *runtimeJavascriptNakamaModule) authenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		dbUserID, dbUsername, created, err := AuthenticateApple(context.Background(), n.logger, n.db, n.socialClient, n.config.GetSocial().Apple.BundleId, token, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		if f.Argument(3) != goja.Undefined() {
			create = getJsBool(r, f.Argument(3))
		}

		dbUserID, dbUsername, created, err := AuthenticateCustom(context.Background(), n.logger, n.db, id, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		if f.Argument(3) != goja.Undefined() {
			create = getJsBool(r, f.Argument(3))
		}

		dbUserID, dbUsername, created, err := AuthenticateDevice(context.Background(), n.logger, n.db, id, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
			dbUserID, err = AuthenticateUsername(context.Background(), n.logger, n.db, username, password)
		} else {
			cleanEmail := strings.ToLower(email)

			dbUserID, username, created, err = AuthenticateEmail(context.Background(), n.logger, n.db, cleanEmail, password, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		dbUserID, dbUsername, created, importFriendsPossible, err := AuthenticateFacebook(context.Background(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		if importFriends && importFriendsPossible {
			// Errors are logged before this point and failure here does not invalidate the whole operation.
			_ = importFacebookFriends(context.Background(), n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, token, false)
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": username,
			"created":  created,
		})
	}
}

func (n *runtimeJavascriptNakamaModule) authenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		dbUserID, dbUsername, created, err := AuthenticateFacebookInstantGame(context.Background(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookInstantGame.AppSecret, signedPlayerInfo, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		playerID := getJsString(r, f.Argument(0))
		if playerID == "" {
			panic(r.NewTypeError("expects player ID string"))
		}
		bundleID := getJsString(r, f.Argument(1))
		if bundleID == "" {
			panic(r.NewTypeError("expects bundle ID string"))
		}
		ts := getJsInt(r, f.Argument(2))
		if ts == 0 {
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

		dbUserID, dbUsername, created, err := AuthenticateGameCenter(context.Background(), n.logger, n.db, n.socialClient, playerID, bundleID, ts, salt, signature, publicKeyURL, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		if f.Argument(1) != goja.Undefined() {
			create = getJsBool(r, f.Argument(1))
		}

		dbUserID, dbUsername, created, err := AuthenticateGoogle(context.Background(), n.logger, n.db, n.socialClient, token, username, create)
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

func (n *runtimeJavascriptNakamaModule) authenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		dbUserID, dbUsername, steamID, created, err := AuthenticateSteam(context.Background(), n.logger, n.db, n.socialClient, n.config.GetSocial().Steam.AppID, n.config.GetSocial().Steam.PublisherKey, token, username, create)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error authenticating: %v", err.Error())))
		}

		// Import friends if requested.
		if importFriends {
			// Errors are logged before this point and failure here does not invalidate the whole operation.
			_ = importSteamFriends(context.Background(), n.logger, n.db, n.router, n.socialClient, uuid.FromStringOrNil(dbUserID), dbUsername, n.config.GetSocial().Steam.PublisherKey, steamID, false)
		}

		return r.ToValue(map[string]interface{}{
			"userId":   dbUserID,
			"username": dbUsername,
			"created":  created,
		})
	}
}

func (n *runtimeJavascriptNakamaModule) authenticateTokenGenerate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		// Parse input User ID.
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.NewTypeError("expects user id"))
		}

		uid, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects valid user id"))
		}

		username := getJsString(r, f.Argument(1))
		if username == "" {
			panic(r.NewTypeError("expects username"))
		}

		exp := time.Now().UTC().Add(time.Duration(n.config.GetSession().TokenExpirySec) * time.Second).Unix()
		if f.Argument(2) != goja.Undefined() {
			exp = getJsInt(r, f.Argument(2))
		}

		vars := getJsStringMap(r, f.Argument(3))

		token, exp := generateTokenWithExpiry(n.config.GetSession().EncryptionKey, userIDString, username, vars, exp)
		n.sessionCache.Add(uid, exp, token, 0, "")

		return r.ToValue(map[string]interface{}{
			"token": token,
			"exp":   exp,
		})
	}
}

func (n *runtimeJavascriptNakamaModule) accountGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		input := getJsString(r, f.Argument(0))
		if input == "" {
			panic(r.NewTypeError("expects user id"))
		}
		userID, err := uuid.FromString(input)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		account, err := GetAccount(context.Background(), n.logger, n.db, n.tracker, userID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error getting account: %v", err.Error())))
		}

		accountData, err := getJsAccountData(account)
		if err != nil {
			panic(r.NewGoError(err))
		}

		return r.ToValue(accountData)
	}
}

func (n *runtimeJavascriptNakamaModule) accountsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var input []interface{}
		if f.Argument(0) == goja.Undefined() {
			panic(r.NewTypeError("expects list of user ids"))
		} else {
			var ok bool
			input, ok = f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - user ids must be an array."))
			}
		}

		userIDs := make([]string, 0, len(input))
		for _, userID := range input {
			id, ok := userID.(string)
			if !ok {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v - must be a string", userID)))
			}
			if _, err := uuid.FromString(id); err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
			}
			userIDs = append(userIDs, id)
		}

		accounts, err := GetAccounts(context.Background(), n.logger, n.db, n.tracker, userIDs)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get accounts: %s", err.Error())))
		}

		accountsData := make([]map[string]interface{}, 0, len(accounts))
		for _, account := range accounts {
			accountData, err := getJsAccountData(account)
			if err != nil {
				panic(r.NewGoError(err))
			}
			accountsData = append(accountsData, accountData)
		}

		return r.ToValue(accountsData)
	}
}

func (n *runtimeJavascriptNakamaModule) accountUpdateId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		var lang *wrapperspb.StringValue
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			lang = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(5))}
		}

		var avatar *wrapperspb.StringValue
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			avatar = &wrapperspb.StringValue{Value: getJsString(r, f.Argument(6))}
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

		if err = UpdateAccounts(context.Background(), n.logger, n.db, []*accountUpdate{{
			userID:      userID,
			username:    username,
			displayName: displayName,
			timezone:    timezone,
			location:    location,
			langTag:     lang,
			avatarURL:   avatar,
			metadata:    metadata,
		}}); err != nil {
			panic(r.NewGoError(fmt.Errorf("error trying to update user: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) accountDeleteId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		recorded := false
		if !goja.IsUndefined(f.Argument(1)) && !goja.IsNull(f.Argument(1)) {
			recorded = getJsBool(r, f.Argument(1))
		}

		if err := DeleteAccount(context.Background(), n.logger, n.db, userID, recorded); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to delete account: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) accountExportId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userID, err := uuid.FromString(getJsString(r, f.Argument(0)))
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		export, err := ExportAccount(context.Background(), n.logger, n.db, userID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error exporting account: %v", err.Error())))
		}

		exportString, err := n.protojsonMarshaler.Marshal(export)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error encoding account export: %v", err.Error())))
		}

		return r.ToValue(exportString)
	}
}

func (n *runtimeJavascriptNakamaModule) usersGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var userIds []string
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			var ok bool
			userIdsIn, ok := f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - user ids must be an array."))
			}
			uIds := make([]string, 0, len(userIdsIn))
			for _, userID := range userIdsIn {
				id, ok := userID.(string)
				if !ok {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v - must be a string", userID)))
				} else if _, err := uuid.FromString(id); err != nil {
					panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
				}
				uIds = append(uIds, id)
			}
			userIds = uIds
		}

		var facebookIds []string
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			facebookIdsIn, ok := f.Argument(1).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - facebook ids must be an array."))
			}
			fIds := make([]string, 0, len(facebookIdsIn))
			for _, fIdIn := range facebookIdsIn {
				fId, ok := fIdIn.(string)
				if !ok {
					panic(r.NewTypeError("Invalid argument - facebook id must be a string"))
				}
				fIds = append(fIds, fId)
			}
			facebookIds = fIds
		}

		if userIds == nil && facebookIds == nil {
			return r.ToValue(make([]string, 0, 0))
		}

		users, err := GetUsers(context.Background(), n.logger, n.db, n.tracker, userIds, nil, facebookIds)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]interface{}, 0, len(users.Users))
		for _, user := range users.Users {
			userData, err := getJsUserData(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

func (n *runtimeJavascriptNakamaModule) usersGetUsername(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var input []interface{}
		if f.Argument(0) == goja.Undefined() {
			panic(r.NewTypeError("expects list of usernames"))
		} else {
			var ok bool
			input, ok = f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - usernames must be an array."))
			}
		}

		usernames := make([]string, 0, len(input))
		for _, userID := range input {
			id, ok := userID.(string)
			if !ok {
				panic(r.NewTypeError(fmt.Sprintf("invalid username: %v - must be a string", userID)))
			}
			usernames = append(usernames, id)
		}

		users, err := GetUsers(context.Background(), n.logger, n.db, n.tracker, nil, usernames, nil)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]interface{}, 0, len(users.Users))
		for _, user := range users.Users {
			userData, err := getJsUserData(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

func (n *runtimeJavascriptNakamaModule) usersGetRandom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		count := getJsInt(r, f.Argument(0))

		if count < 0 || count > 1000 {
			panic(r.NewTypeError("count must be 0-1000"))
		}

		users, err := GetRandomUsers(context.Background(), n.logger, n.db, n.tracker, int(count))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get users: %s", err.Error())))
		}

		usersData := make([]map[string]interface{}, 0, len(users))
		for _, user := range users {
			userData, err := getJsUserData(user)
			if err != nil {
				panic(r.NewGoError(err))
			}
			usersData = append(usersData, userData)
		}

		return r.ToValue(usersData)
	}
}

func (n *runtimeJavascriptNakamaModule) usersBanId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var input []interface{}
		if f.Argument(0) == goja.Undefined() {
			panic(r.NewTypeError("expects list of user ids"))
		} else {
			var ok bool
			input, ok = f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - user ids must be an array."))
			}
		}

		userIDs := make([]uuid.UUID, 0, len(input))
		for _, userID := range input {
			id, ok := userID.(string)
			if !ok {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v - must be a string", userID)))
			}
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
			}
			userIDs = append(userIDs, uid)
		}

		err := BanUsers(context.Background(), n.logger, n.db, n.sessionCache, userIDs)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to ban users: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) usersUnbanId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var input []interface{}
		if f.Argument(0) == goja.Undefined() {
			panic(r.NewTypeError("expects list of user ids"))
		} else {
			var ok bool
			input, ok = f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("Invalid argument - user ids must be an array."))
			}
		}

		userIDs := make([]uuid.UUID, 0, len(input))
		for _, userID := range input {
			id, ok := userID.(string)
			if !ok {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v - must be a string", userID)))
			}
			uid, err := uuid.FromString(id)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("invalid user id: %v", userID)))
			}
			userIDs = append(userIDs, uid)
		}

		err := UnbanUsers(context.Background(), n.logger, n.db, n.sessionCache, userIDs)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to unban users: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkApple(context.Background(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkCustom(context.Background(), n.logger, n.db, id, customID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkCustom(context.Background(), n.logger, n.db, id, deviceID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkEmail(context.Background(), n.logger, n.db, id, email, password); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkFacebook(context.Background(), n.logger, n.db, n.socialClient, n.router, id, username, n.config.GetSocial().FacebookLimitedLogin.AppId, token, importFriends); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkFacebookInstantGame(context.Background(), n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		ts := getJsInt(r, f.Argument(3))
		if ts == 0 {
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

		if err := LinkGameCenter(context.Background(), n.logger, n.db, n.socialClient, id, playerID, bundleID, ts, salt, signature, publicKeyURL); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkGoogle(context.Background(), n.logger, n.db, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) linkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := LinkSteam(context.Background(), n.logger, n.db, n.config, n.socialClient, n.router, id, username, token, importFriends); err != nil {
			panic(r.NewGoError(fmt.Errorf("error linking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkApple(context.Background(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkCustom(context.Background(), n.logger, n.db, id, customID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkDevice(context.Background(), n.logger, n.db, id, deviceID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkEmail(context.Background(), n.logger, n.db, id, email); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkFacebook(context.Background(), n.logger, n.db, n.socialClient, n.config.GetSocial().FacebookLimitedLogin.AppId, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkFacebookInstantGame(context.Background(), n.logger, n.db, n.config, n.socialClient, id, signedPlayerInfo); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		ts := getJsInt(r, f.Argument(3))
		if ts == 0 {
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

		if err := UnlinkGameCenter(context.Background(), n.logger, n.db, n.socialClient, id, playerID, bundleID, ts, salt, signature, publicKeyURL); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkGoogle(context.Background(), n.logger, n.db, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) unlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		if err := UnlinkSteam(context.Background(), n.logger, n.db, n.config, n.socialClient, id, token); err != nil {
			panic(r.NewGoError(fmt.Errorf("error unlinking: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) streamUserList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		stream := getStreamData(r, streamObj)
		presences := n.tracker.ListByStream(stream, includeHidden, includeNotHidden)

		presencesList := make([]map[string]interface{}, 0, len(presences))
		for _, p := range presences {
			presenceObj := make(map[string]interface{})
			presenceObj["userId"] = p.UserID.String()
			presenceObj["sessionId"] = p.ID.SessionID.String()
			presenceObj["nodeId"] = p.ID.Node
			presenceObj["hidden"] = p.Meta.Hidden
			presenceObj["persistence"] = p.Meta.Persistence
			presenceObj["username"] = p.Meta.Username
			presenceObj["status"] = p.Meta.Status
			presenceObj["reason"] = p.Meta.Reason
		}

		return r.ToValue(presencesList)
	}
}

func (n *runtimeJavascriptNakamaModule) streamUserGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionIDString := getJsString(r, f.Argument(1))
		if sessionIDString == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sessionID, err := uuid.FromString(sessionIDString)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		streamIn := f.Argument(2)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)
		meta := n.tracker.GetLocalBySessionIDStreamUserID(sessionID, stream, userID)
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

func (n *runtimeJavascriptNakamaModule) streamUserJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionIDString := getJsString(r, f.Argument(1))
		if sessionIDString == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sessionID, err := uuid.FromString(sessionIDString)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		streamIn := f.Argument(2)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		// By default generate presence events.
		hidden := false
		if f.Argument(3) != goja.Undefined() {
			hidden = getJsBool(r, f.Argument(3))
		}
		// By default persistence is enabled, if the stream supports it.
		persistence := true
		if f.Argument(4) != goja.Undefined() {
			persistence = getJsBool(r, f.Argument(4))
		}
		// By default no status is set.
		status := ""
		if f.Argument(5) != goja.Undefined() {
			status = getJsString(r, f.Argument(5))
		}

		stream := getStreamData(r, streamObj)

		success, newlyTracked, err := n.streamManager.UserJoin(stream, userID, sessionID, hidden, persistence, status)
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

func (n *runtimeJavascriptNakamaModule) streamUserUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionIDString := getJsString(r, f.Argument(1))
		if sessionIDString == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sessionID, err := uuid.FromString(sessionIDString)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		streamIn := f.Argument(2)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		// By default generate presence events.
		hidden := false
		if f.Argument(3) != goja.Undefined() {
			hidden = getJsBool(r, f.Argument(3))
		}
		// By default persistence is enabled, if the stream supports it.
		persistence := true
		if f.Argument(4) != goja.Undefined() {
			persistence = getJsBool(r, f.Argument(4))
		}
		// By default no status is set.
		status := ""
		if f.Argument(5) != goja.Undefined() {
			status = getJsString(r, f.Argument(5))
		}

		stream := getStreamData(r, streamObj)

		success, err := n.streamManager.UserUpdate(stream, userID, sessionID, hidden, persistence, status)
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

func (n *runtimeJavascriptNakamaModule) streamUserLeave(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.ToValue(r.NewTypeError("expects user id")))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("invalid user id"))
		}

		sessionIDString := getJsString(r, f.Argument(1))
		if sessionIDString == "" {
			panic(r.NewTypeError("expects session id"))
		}
		sessionID, err := uuid.FromString(sessionIDString)
		if err != nil {
			panic(r.NewTypeError("invalid session id"))
		}

		streamIn := f.Argument(2)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

		if err := n.streamManager.UserLeave(stream, userID, sessionID); err != nil {
			panic(r.NewGoError(fmt.Errorf("stream user leave failed: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) streamUserKick(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		presenceIn := f.Argument(0)
		if presenceIn == goja.Undefined() {
			panic(r.NewTypeError("expects presence object"))
		}
		presence, ok := presenceIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a presence object"))
		}

		userID := uuid.Nil
		sessionID := uuid.Nil
		node := n.node

		userIDRaw, ok := presence["userId"]
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

		sessionIdRaw, ok := presence["sessionId"]
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

		nodeRaw, ok := presence["node"]
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

		streamIn := f.Argument(1)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

		if err := n.streamManager.UserLeave(stream, userID, sessionID); err != nil {
			panic(r.NewGoError(fmt.Errorf("stream user kick failed: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) streamCount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		streamIn := f.Argument(0)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

		count := n.tracker.CountByStream(stream)

		return r.ToValue(count)
	}
}

func (n *runtimeJavascriptNakamaModule) streamClose(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		streamIn := f.Argument(0)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

		n.tracker.UntrackByStream(stream)

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) streamSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		streamIn := f.Argument(0)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

		data := getJsString(r, f.Argument(1))

		presencesIn := f.Argument(2)
		var presences []interface{}
		if presencesIn == goja.Undefined() || presencesIn == goja.Null() {
			presences = make([]interface{}, 0)
		} else {
			presences, ok = presencesIn.Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects a presences array"))
			}
		}

		presenceIDs := make([]*PresenceID, 0, len(presences))
		for _, presenceRaw := range presences {
			presence, ok := presenceRaw.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a presence object"))
			}

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

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) streamSendRaw(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		streamIn := f.Argument(0)
		if streamIn == goja.Undefined() {
			panic(r.NewTypeError("expects stream object"))
		}
		streamObj, ok := streamIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a stream object"))
		}

		stream := getStreamData(r, streamObj)

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

		presencesIn := f.Argument(2)
		var presences []interface{}
		if presencesIn == goja.Undefined() || presencesIn == goja.Null() {
			presences = make([]interface{}, 0)
		} else {
			presences, ok = presencesIn.Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects a presences array"))
			}
		}

		presenceIDs := make([]*PresenceID, 0, len(presences))
		for _, presenceRaw := range presences {
			presence, ok := presenceRaw.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a presence object"))
			}

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
			n.router.SendToStream(n.logger, stream, msg, reliable)
		} else {
			// Sending to a subset of stream users.
			n.router.SendToPresenceIDs(n.logger, presenceIDs, msg, reliable)
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) sessionDisconnect(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		sessionIDString := getJsString(r, f.Argument(0))
		if sessionIDString == "" {
			panic(r.NewTypeError("expects a session id"))
		}
		sessionID, err := uuid.FromString(sessionIDString)
		if err != nil {
			panic(r.NewTypeError("expects a valid session id"))
		}

		reason := make([]runtime.PresenceReason, 0, 1)
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			reasonInt := getJsInt(r, f.Argument(1))
			if reasonInt < 0 || reasonInt > 4 {
				panic(r.NewTypeError("invalid disconnect reason, must be a value 0-4"))
			}
			reason = append(reason, runtime.PresenceReason(reasonInt))
		}

		if err := n.sessionRegistry.Disconnect(context.Background(), sessionID, reason...); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to disconnect: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) sessionLogout(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.NewTypeError("expects a user id"))
		}
		userID, err := uuid.FromString(userIDString)
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

		if err := SessionLogout(n.config, n.sessionCache, userID, tokenString, refreshTokenString); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to logout: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) matchCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		id, err := n.matchRegistry.CreateMatch(context.Background(), n.logger, n.matchCreateFn, module, paramsMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating match: %s", err.Error())))
		}

		return r.ToValue(id)
	}
}

func (n *runtimeJavascriptNakamaModule) matchGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))

		result, err := n.matchRegistry.GetMatch(context.Background(), id)
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

func (n *runtimeJavascriptNakamaModule) matchList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		results, err := n.matchRegistry.ListMatches(context.Background(), limit, authoritative, label, minSize, maxSize, query)
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

func (n *runtimeJavascriptNakamaModule) notificationSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects valid user id"))
		}

		subject := getJsString(r, f.Argument(1))
		if subject == "" {
			panic(r.NewTypeError("expects subject to be a non empty string"))
		}

		contentIn := f.Argument(2)
		if contentIn == goja.Undefined() {
			panic(r.NewTypeError("expects content"))
		}
		contentMap, ok := contentIn.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects content to be an object"))
		}
		contentBytes, err := json.Marshal(contentMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert content: %s", err.Error())))
		}
		content := string(contentBytes)

		code := getJsInt(r, f.Argument(3))
		if code <= 0 {
			panic(r.NewGoError(errors.New("expects code number to be a positive integer")))
		}

		senderIdIn := f.Argument(4)
		senderID := uuid.Nil.String()
		if senderIdIn != goja.Undefined() && senderIdIn != goja.Null() {
			suid, err := uuid.FromString(getJsString(r, senderIdIn))
			if err != nil {
				panic(r.NewTypeError("expects senderId to either be not set, empty string or a valid UUID"))
			}
			senderID = suid.String()
		}

		persistent := false
		if f.Argument(5) != goja.Undefined() {
			persistent = getJsBool(r, f.Argument(5))
		}

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

		if err := NotificationSend(context.Background(), n.logger, n.db, n.router, notifications); err != nil {
			panic(fmt.Sprintf("failed to send notifications: %s", err.Error()))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) notificationsSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		notificationsIn := f.Argument(0)
		if notificationsIn == goja.Undefined() {
			panic(r.NewTypeError("expects a valid set of notifications"))
		}

		notificationsSlice, ok := notificationsIn.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects notifications to be an array"))
		}

		notifications := make(map[uuid.UUID][]*api.Notification)
		for _, notificationRaw := range notificationsSlice {
			notificationObj, ok := notificationRaw.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects notification to be an object"))
			}

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
					panic(r.NewTypeError("expects 'userId' value to be a string"))
				}
				uid, err := uuid.FromString(senderIDStr)
				if err != nil {
					panic(r.NewTypeError("expects 'userId' value to be a valid id"))
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

			no := notifications[userID]
			if no == nil {
				no = make([]*api.Notification, 0, 1)
			}
			no = append(no, notification)
			notifications[userID] = no
		}

		if err := NotificationSend(context.Background(), n.logger, n.db, n.router, notifications); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to send notifications: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) walletUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		uid := getJsString(r, f.Argument(0))
		if uid == "" {
			panic(r.NewTypeError("expects a valid user id"))
		}
		userID, err := uuid.FromString(uid)
		if err != nil {
			panic(r.NewTypeError("expects a valid user id"))
		}

		changeSetMap, ok := f.Argument(1).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects a changeset object"))
		}
		changeSet := make(map[string]int64)
		for k, v := range changeSetMap {
			i64, ok := v.(int64)
			if !ok {
				panic(r.NewTypeError("expects changeset values to be whole numbers"))
			}
			changeSet[k] = i64
		}

		metadataBytes := []byte("{}")
		metadataIn := f.Argument(2)
		if metadataIn != goja.Undefined() && metadataIn != goja.Null() {
			metadataMap, ok := metadataIn.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be a key value object"))
			}
			metadataBytes, err = json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
			}
		}

		updateLedger := true
		if f.Argument(3) != goja.Undefined() {
			updateLedger = getJsBool(r, f.Argument(3))
		}

		results, err := UpdateWallets(context.Background(), n.logger, n.db, []*walletUpdate{{
			UserID:    userID,
			Changeset: changeSet,
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
		})
	}
}

func (n *runtimeJavascriptNakamaModule) walletsUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		updatesIn, ok := f.Argument(0).Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of wallet update objects"))
		}

		updates := make([]*walletUpdate, 0, len(updatesIn))
		for _, updateIn := range updatesIn {
			updateMap, ok := updateIn.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects an update to be a wallet update object"))
			}

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

			updates = append(updates, update)
		}

		updateLedger := false
		if f.Argument(1) != goja.Undefined() {
			updateLedger = getJsBool(r, f.Argument(1))
		}

		results, err := UpdateWallets(context.Background(), n.logger, n.db, updates, updateLedger)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet: %s", err.Error())))
		}

		retResults := make([]map[string]interface{}, 0, len(results))
		for _, r := range results {
			retResults = append(retResults,
				map[string]interface{}{
					"updated":  r.Updated,
					"previous": r.Previous,
				},
			)
		}

		return r.ToValue(retResults)
	}
}

func (n *runtimeJavascriptNakamaModule) walletLedgerUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		// Parse ledger ID.
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a valid id"))
		}
		itemID, err := uuid.FromString(id)
		if err != nil {
			panic(r.NewTypeError("expects a valid id"))
		}

		metadataBytes := []byte("{}")
		metadataMap, ok := f.Argument(1).Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects metadata object"))
		}
		metadataBytes, err = json.Marshal(metadataMap)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
		}
		item, err := UpdateWalletLedger(context.Background(), n.logger, n.db, itemID, string(metadataBytes))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet ledger: %s", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"id":         id,
			"userId":     item.UserID,
			"createTime": item.CreateTime,
			"updateTime": item.UpdateTime,
			"changeset":  metadataMap,
			"metadata":   item.Metadata,
		})
	}
}

func (n *runtimeJavascriptNakamaModule) walletLedgerList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a valid user id"))
		}
		userID, err := uuid.FromString(id)
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

		items, newCursor, err := ListWalletLedger(context.Background(), n.logger, n.db, userID, &limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to retrieve user wallet ledger: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(items))
		for _, item := range items {
			results = append(results, map[string]interface{}{
				"id":         item.ID,
				"userId":     id,
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

func (n *runtimeJavascriptNakamaModule) storageList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		var uid *uuid.UUID
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			userIDString := getJsString(r, f.Argument(0))
			u, err := uuid.FromString(userIDString)
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

		cursor := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursor = getJsString(r, f.Argument(3))
		}

		objectList, _, err := StorageListObjects(context.Background(), n.logger, n.db, uuid.Nil, uid, collection, limit, cursor)

		objects := make([]interface{}, 0, len(objectList.Objects))
		for _, o := range objectList.Objects {
			objectMap := make(map[string]interface{})
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

func (n *runtimeJavascriptNakamaModule) storageRead(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		keysIn := f.Argument(0)
		if keysIn == goja.Undefined() {
			panic(r.NewTypeError("expects an array ok keys"))
		}

		keysSlice, ok := keysIn.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of keys"))
		}

		if len(keysSlice) == 0 {
			return r.ToValue([]interface{}{})
		}

		objectIDs := make([]*api.ReadStorageObjectId, 0, len(keysSlice))
		for _, obj := range keysSlice {
			objMap, ok := obj.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects an object"))
			}

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

			objectIDs = append(objectIDs, objectID)
		}

		objects, err := StorageReadObjects(context.Background(), n.logger, n.db, uuid.Nil, objectIDs)
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

func (n *runtimeJavascriptNakamaModule) storageWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		data := f.Argument(0)
		if data == goja.Undefined() {
			panic(r.NewTypeError("expects a valid array of data"))
		}
		dataSlice, ok := data.Export().([]interface{})
		if !ok {
			panic(r.ToValue(r.NewTypeError("expects a valid array of data")))
		}

		ops := make(StorageOpWrites, 0, len(dataSlice))
		for _, data := range dataSlice {
			dataMap, ok := data.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a data entry to be an object"))
			}

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

			keyIn, ok := dataMap["key"]
			key, ok := keyIn.(string)
			if !ok {
				panic(r.NewTypeError("expects 'key' value to be a string"))
			}
			if key == "" {
				panic(r.NewTypeError("expects 'key' value to be non-empty"))
			}
			writeOp.Key = key

			userIDIn, ok := dataMap["userId"]
			userIDStr, ok := userIDIn.(string)
			if !ok {
				panic(r.NewTypeError("expects 'userId' value to be a string"))
			}
			var err error
			userID, err = uuid.FromString(userIDStr)
			if err != nil {
				panic(r.NewTypeError("expects 'userId' value to be a valid id"))
			}

			valueIn, ok := dataMap["value"]
			valueMap, ok := valueIn.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects 'value' value to be an object"))
			}
			valueBytes, err := json.Marshal(valueMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert value: %s", err.Error())))
			}
			writeOp.Value = string(valueBytes)

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

			ops = append(ops, &StorageOpWrite{
				OwnerID: userID.String(),
				Object:  writeOp,
			})
		}

		acks, _, err := StorageWriteObjects(context.Background(), n.logger, n.db, true, ops)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to write storage objects: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(acks.Acks))
		for _, ack := range acks.Acks {
			result := make(map[string]interface{}, 4)
			result["key"] = ack.Key
			result["collection"] = ack.Collection
			if ack.UserId != "" {
				result["userId"] = ack.UserId
			} else {
				result["userId"] = nil
			}
			result["version"] = ack.Version

			results = append(results, result)
		}

		return r.ToValue(results)
	}
}

func (n *runtimeJavascriptNakamaModule) storageDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		keysIn := f.Argument(0)
		if keysIn == goja.Undefined() {
			panic(r.NewTypeError("expects an array ok keys"))
		}
		keysSlice, ok := keysIn.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of keys"))
		}

		ops := make(StorageOpDeletes, 0, len(keysSlice))
		for _, data := range keysSlice {
			dataMap, ok := data.(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects a data entry to be an object"))
			}

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

			if userID, ok := dataMap["userId"]; ok {
				userIDStr, ok := userID.(string)
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

		if _, err := StorageDeleteObjects(context.Background(), n.logger, n.db, true, ops); err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to remove storage: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) multiUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		returnObj := make(map[string]interface{})

		// Process account update inputs.
		var accountUpdates []*accountUpdate
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			accountUpdatesSlice, ok := f.Argument(0).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects an array of account updates"))
			}

			accountUpdates = make([]*accountUpdate, 0, len(accountUpdatesSlice))
			for _, accUpdate := range accountUpdatesSlice {
				accUpdateObj, ok := accUpdate.(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects an account update object"))
				}

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

				accountUpdates = append(accountUpdates, update)
			}
		}

		// Process storage update inputs.
		var storageWriteOps StorageOpWrites
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			data := f.Argument(1)
			dataSlice, ok := data.Export().([]interface{})
			if !ok {
				panic(r.ToValue(r.NewTypeError("expects a valid array of data")))
			}

			storageWriteOps = make(StorageOpWrites, 0, len(dataSlice))
			for _, data := range dataSlice {
				dataMap, ok := data.(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects a data entry to be an object"))
				}

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

			acks, _, err := StorageWriteObjects(context.Background(), n.logger, n.db, true, storageWriteOps)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to write storage objects: %s", err.Error())))
			}

			storgeWritesResults := make([]interface{}, 0, len(acks.Acks))
			for _, ack := range acks.Acks {
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

			returnObj["storageWriteAcks"] = storgeWritesResults
		}

		// Process wallet update inputs.
		var walletUpdates []*walletUpdate
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			updatesIn, ok := f.Argument(2).Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects an array of wallet update objects"))
			}

			walletUpdates = make([]*walletUpdate, 0, len(updatesIn))
			for _, updateIn := range updatesIn {
				updateMap, ok := updateIn.(map[string]interface{})
				if !ok {
					panic(r.NewTypeError("expects an update to be a wallet update object"))
				}

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

				walletUpdates = append(walletUpdates, update)
			}
		}

		updateLedger := false
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			updateLedger = getJsBool(r, f.Argument(3))
		}

		results, err := UpdateWallets(context.Background(), n.logger, n.db, walletUpdates, updateLedger)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to update user wallet: %s", err.Error())))
		}

		updateWalletResults := make([]map[string]interface{}, 0, len(results))
		for _, r := range results {
			updateWalletResults = append(updateWalletResults,
				map[string]interface{}{
					"updated":  r.Updated,
					"previous": r.Previous,
				},
			)
		}
		returnObj["walletUpdateAcks"] = updateWalletResults

		return r.ToValue(returnObj)
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
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
		case "asc":
			sortOrderNumber = LeaderboardSortOrderAscending
		case "desc":
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
		case "incr":
			operatorNumber = LeaderboardOperatorIncrement
		case "decr":
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

		metadataStr := "{}"
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			metadataMap, ok := f.Argument(5).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be an object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("error encoding metadata: %v", err.Error())))
			}
			metadataStr = string(metadataBytes)
		}

		if _, err := n.leaderboardCache.Create(context.Background(), id, authoritative, sortOrderNumber, operatorNumber, resetSchedule, metadataStr); err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating leaderboard: %v", err.Error())))
		}

		n.leaderboardScheduler.Update()

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		if err := n.leaderboardCache.Delete(context.Background(), id); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting leaderboard: %v", err.Error())))
		}

		n.leaderboardScheduler.Update()

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		limit := 10
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			limit = int(getJsInt(r, f.Argument(2)))
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("limit must be 1-100"))
			}
		}

		var cursor *LeaderboardListCursor
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			cursorStr := getJsString(r, f.Argument(3))
			cb, err := base64.StdEncoding.DecodeString(cursorStr)
			if err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
			cursor = &LeaderboardListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
		}

		list, err := LeaderboardList(n.logger, n.leaderboardCache, categoryStart, categoryEnd, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing leaderboards: %v", err.Error())))
		}

		results := make([]interface{}, 0, len(list.Leaderboards))
		for _, leaderboard := range list.Leaderboards {
			t, err := getJsLeaderboardData(leaderboard)
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

func (n *runtimeJavascriptNakamaModule) leaderboardRecordsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		var ownerIds []string
		owners := f.Argument(1)
		if owners != goja.Undefined() && owners != goja.Null() {
			ownersSlice, ok := owners.Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects an array of owner ids"))
			}
			ownerIds = make([]string, 0, len(ownersSlice))
			for _, owner := range ownersSlice {
				ownerStr, ok := owner.(string)
				if !ok {
					panic(r.NewTypeError("expects a valid owner id"))
				}
				if _, err := uuid.FromString(ownerStr); err != nil {
					panic(r.NewTypeError("expects a valid owner id"))
				}
				ownerIds = append(ownerIds, ownerStr)
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

		records, err := LeaderboardRecordsList(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, limit, cursor, ownerIds, overrideExpiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing leaderboard records: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor)
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardRecordWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		overrideOperator := api.Operator_NO_OVERRIDE
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			operatorString := strings.ToLower(getJsString(r, f.Argument(6)))
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
				panic(r.NewTypeError(ErrInvalidOperator.Error()))
			}
		}

		record, err := LeaderboardRecordWrite(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID, username, score, subscore, metadataStr, overrideOperator)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error writing leaderboard record: %v", err.Error())))
		}

		return r.ToValue(leaderboardRecordToJsMap(r, record))
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardRecordDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a leaderboard ID string"))
		}

		ownerID := getJsString(r, f.Argument(1))
		if _, err := uuid.FromString(ownerID); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		if err := LeaderboardRecordDelete(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, ownerID); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting leaderboard record: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) leaderboardsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		leaderboardIdsIn := f.Argument(0)
		if leaderboardIdsIn == goja.Undefined() || leaderboardIdsIn == goja.Null() {
			panic(r.NewTypeError("expects an array of leaderboard ids"))
		}
		leaderboardIdsSlice := leaderboardIdsIn.Export().([]interface{})

		leaderboardIDs := make([]string, 0, len(leaderboardIdsSlice))
		for _, id := range leaderboardIdsSlice {
			idString, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects a leaderboard ID to be a string"))
			}
			leaderboardIDs = append(leaderboardIDs, idString)
		}

		leaderboards := LeaderboardsGet(n.leaderboardCache, leaderboardIDs)

		leaderboardsSlice := make([]interface{}, 0, len(leaderboards))
		for _, l := range leaderboards {
			leaderboardMap, err := getJsLeaderboardData(l)
			if err != nil {
				panic(r.NewGoError(err))
			}

			leaderboardsSlice = append(leaderboardsSlice, leaderboardMap)
		}

		return r.ToValue(leaderboardsSlice)
	}
}

func (n *runtimeJavascriptNakamaModule) purchaseValidateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		password := n.config.GetIAP().Apple.SharedPassword
		if f.Argument(2) != goja.Undefined() {
			password = getJsString(r, f.Argument(2))
		}

		if password == "" {
			panic(r.NewGoError(errors.New("Apple IAP is not configured.")))
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

		validation, err := ValidatePurchasesApple(context.Background(), n.logger, n.db, uid, password, receipt)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Apple receipt: %s", err.Error())))
		}

		validationResult := getJsValidatedPurchasesData(validation)

		return r.ToValue(validationResult)
	}
}

func (n *runtimeJavascriptNakamaModule) purchaseValidateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetIAP().Google.ClientEmail == "" || n.config.GetIAP().Google.PrivateKey == "" {
			panic(r.NewGoError(errors.New("Google IAP is not configured.")))
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

		validation, err := ValidatePurchaseGoogle(context.Background(), n.logger, n.db, uid, n.config.GetIAP().Google, receipt)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Google receipt: %s", err.Error())))
		}

		validationResult := getJsValidatedPurchasesData(validation)

		return r.ToValue(validationResult)
	}
}

func (n *runtimeJavascriptNakamaModule) purchaseValidateHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		if n.config.GetIAP().Huawei.ClientID == "" ||
			n.config.GetIAP().Huawei.ClientSecret == "" ||
			n.config.GetIAP().Huawei.PublicKey == "" {
			panic(r.NewGoError(errors.New("Huawei IAP is not configured.")))
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

		validation, err := ValidatePurchaseHuawei(context.Background(), n.logger, n.db, uid, n.config.GetIAP().Huawei, receipt, signature)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error validating Huawei receipt: %s", err.Error())))
		}

		validationResult := getJsValidatedPurchasesData(validation)

		return r.ToValue(validationResult)
	}
}

func (n *runtimeJavascriptNakamaModule) purchaseGetByTransactionId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		transactionID := getJsString(r, f.Argument(0))
		if transactionID == "" {
			panic(r.NewTypeError("expects a transaction id string"))
		}

		userID, purchase, err := GetPurchaseByTransactionID(context.Background(), n.logger, n.db, transactionID)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchase: %s", err.Error())))
		}

		return r.ToValue(map[string]interface{}{
			"userId":            &userID,
			"validatedPurchase": getJsValidatedPurchaseData(purchase),
		})
	}
}

func (n *runtimeJavascriptNakamaModule) purchasesList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDStr := ""
		if f.Argument(0) != goja.Undefined() && f.Argument(0) != goja.Null() {
			userIDStr = getJsString(r, f.Argument(0))
			if _, err := uuid.FromString(userIDStr); err != nil {
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

		purchases, err := ListPurchases(context.Background(), n.logger, n.db, userIDStr, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error retrieving purchases: %s", err.Error())))
		}

		validatedPurchases := make([]interface{}, 0, len(purchases.ValidatedPurchases))
		for _, p := range purchases.ValidatedPurchases {
			validatedPurchase := getJsValidatedPurchaseData(p)
			validatedPurchases = append(validatedPurchases, validatedPurchase)
		}

		result := make(map[string]interface{}, 2)
		result["validatedPurchases"] = validatedPurchases
		if purchases.Cursor != "" {
			result["cursor"] = purchases.Cursor
		}

		return r.ToValue(result)
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		sortOrder := "desc"
		if f.Argument(1) != goja.Undefined() {
			sortOrder = getJsString(r, f.Argument(1))
		}
		var sortOrderNumber int
		switch sortOrder {
		case "asc":
			sortOrderNumber = LeaderboardSortOrderAscending
		case "desc":
			sortOrderNumber = LeaderboardSortOrderDescending
		default:
			panic(r.NewTypeError("expects sort order to be 'asc' or 'desc'"))
		}

		operator := "best"
		if f.Argument(2) != goja.Undefined() {
			operator = getJsString(r, f.Argument(2))
		}
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
			panic(r.NewTypeError("expects sort order to be 'best', 'set', 'decr' or 'incr'"))
		}

		var duration int
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			duration = int(getJsInt(r, f.Argument(3)))
		}
		if duration <= 0 {
			panic(r.NewTypeError("duration must be > 0"))
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

		metadata := f.Argument(5)
		metadataStr := "{}"
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

		title := ""
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			title = getJsString(r, f.Argument(6))
		}

		description := ""
		if f.Argument(7) != goja.Undefined() && f.Argument(7) != goja.Null() {
			description = getJsString(r, f.Argument(7))
		}

		var category int
		if f.Argument(8) != goja.Undefined() && f.Argument(8) != goja.Null() {
			category = int(getJsInt(r, f.Argument(8)))
			if category < 0 || category >= 128 {
				panic(r.NewTypeError("category must be 0-127"))
			}
		}

		var startTime int
		if f.Argument(9) != goja.Undefined() && f.Argument(9) != goja.Null() {
			startTime = int(getJsInt(r, f.Argument(9)))
			if startTime < 0 {
				panic(r.NewTypeError("startTime must be >= 0."))
			}
		}

		var endTime int
		if f.Argument(10) != goja.Undefined() && f.Argument(10) != goja.Null() {
			endTime = int(getJsInt(r, f.Argument(10)))
		}
		if endTime != 0 && endTime <= startTime {
			panic(r.NewTypeError("endTime must be > startTime. Use 0 to indicate a tournament that never ends."))
		}

		var maxSize int
		if f.Argument(11) != goja.Undefined() && f.Argument(11) != goja.Null() {
			maxSize = int(getJsInt(r, f.Argument(11)))
			if maxSize < 0 {
				panic(r.NewTypeError("maxSize must be >= 0"))
			}
		}

		var maxNumScore int
		if f.Argument(12) != goja.Undefined() && f.Argument(12) != goja.Null() {
			maxNumScore = int(getJsInt(r, f.Argument(12)))
			if maxNumScore < 0 {
				panic(r.NewTypeError("maxNumScore must be >= 0"))
			}
		}

		joinRequired := false
		if f.Argument(13) != goja.Undefined() && f.Argument(13) != goja.Null() {
			joinRequired = getJsBool(r, f.Argument(13))
		}

		if err := TournamentCreate(context.Background(), n.logger, n.leaderboardCache, n.leaderboardScheduler, id, sortOrderNumber, operatorNumber, resetSchedule, metadataStr, title, description, category, startTime, endTime, duration, maxSize, maxNumScore, joinRequired); err != nil {
			panic(r.NewGoError(fmt.Errorf("error creating tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		if err := TournamentDelete(context.Background(), n.leaderboardCache, n.rankCache, n.leaderboardScheduler, id); err != nil {
			panic(r.NewGoError(fmt.Errorf("error deleting tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentAddAttempt(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		owner := getJsString(r, f.Argument(1))
		if owner == "" {
			panic(r.NewTypeError("expects an owner ID string"))
		} else if _, err := uuid.FromString(owner); err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		count := int(getJsInt(r, f.Argument(2)))
		if count == 0 {
			panic(r.NewTypeError("expects an attempt count number != 0"))
		}

		if err := TournamentAddAttempt(context.Background(), n.logger, n.db, n.leaderboardCache, id, owner, count); err != nil {
			panic(r.NewTypeError("error adding tournament attempts: %v", err.Error()))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		userID := getJsString(r, f.Argument(1))
		if userID == "" {
			panic(r.NewTypeError("expects a user ID string"))
		} else if _, err := uuid.FromString(userID); err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := TournamentJoin(context.Background(), n.logger, n.db, n.leaderboardCache, userID, username, id); err != nil {
			panic(r.NewGoError(fmt.Errorf("error joining tournament: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		tournamentIdsIn := f.Argument(0)
		if tournamentIdsIn == goja.Undefined() || tournamentIdsIn == goja.Null() {
			panic(r.NewTypeError("expects an array of tournament ids"))
		}
		tournamentIdsSlice := tournamentIdsIn.Export().([]interface{})

		tournmentIDs := make([]string, 0, len(tournamentIdsSlice))
		for _, id := range tournamentIdsSlice {
			idString, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects a tournament ID to be a string"))
			}
			tournmentIDs = append(tournmentIDs, idString)
		}

		list, err := TournamentsGet(context.Background(), n.logger, n.db, tournmentIDs)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to get tournaments: %s", err.Error())))
		}

		results := make([]interface{}, 0, len(list))
		for _, tournament := range list {
			tournament, err := getJsTournamentData(tournament)
			if err != nil {
				panic(r.NewGoError(err))
			}

			results = append(results, tournament)
		}

		return r.ToValue(results)
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentRecordsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		var ownerIds []string
		owners := f.Argument(1)
		if owners != goja.Undefined() && owners != goja.Null() {
			ownersSlice, ok := owners.Export().([]interface{})
			if !ok {
				panic(r.NewTypeError("expects an array of owner ids"))
			}
			ownerIds = make([]string, 0, len(ownersSlice))
			for _, owner := range ownersSlice {
				ownerStr, ok := owner.(string)
				if !ok {
					panic(r.NewTypeError("expects a valid owner id"))
				}
				if _, err := uuid.FromString(ownerStr); err != nil {
					panic(r.NewTypeError("expects a valid owner id"))
				}
				ownerIds = append(ownerIds, ownerStr)
			}
		}

		limitNumber := 0
		if f.Argument(2) != goja.Undefined() {
			limitNumber = int(getJsInt(r, f.Argument(2)))
		}
		var limit *wrapperspb.Int32Value
		if limitNumber != 0 {
			limit = &wrapperspb.Int32Value{Value: int32(limitNumber)}
		}

		cursor := ""
		if f.Argument(3) != goja.Undefined() {
			cursor = getJsString(r, f.Argument(3))
		}

		overrideExpiry := int64(0)
		if f.Argument(4) != goja.Undefined() {
			overrideExpiry = getJsInt(r, f.Argument(4))
		}

		records, err := TournamentRecordsList(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, ownerIds, limit, cursor, overrideExpiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournament records: %v", err.Error())))
		}

		return leaderboardRecordsListToJs(r, records.Records, records.OwnerRecords, records.PrevCursor, records.NextCursor)
	}
}

func leaderboardRecordsListToJs(r *goja.Runtime, records []*api.LeaderboardRecord, ownerRecords []*api.LeaderboardRecord, prevCursor, nextCursor string) goja.Value {
	recordsSlice := make([]interface{}, 0, len(records))
	for _, record := range records {
		recordsSlice = append(recordsSlice, leaderboardRecordToJsMap(r, record))
	}

	ownerRecordsSlice := make([]interface{}, 0, len(ownerRecords))
	for _, ownerRecord := range ownerRecords {
		ownerRecordsSlice = append(ownerRecordsSlice, leaderboardRecordToJsMap(r, ownerRecord))
	}

	resultMap := make(map[string]interface{}, 4)

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

	return r.ToValue(resultMap)
}

func leaderboardRecordToJsMap(r *goja.Runtime, record *api.LeaderboardRecord) map[string]interface{} {
	recordMap := make(map[string]interface{}, 11)
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
	metadataMap := make(map[string]interface{})
	err := json.Unmarshal([]byte(record.Metadata), &metadataMap)
	if err != nil {
		panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
	}
	pointerizeSlices(metadataMap)
	metadataMap["metadata"] = metadataMap
	metadataMap["createTime"] = record.CreateTime.Seconds
	metadataMap["updateTime"] = record.UpdateTime.Seconds
	if record.ExpiryTime != nil {
		recordMap["expiryTime"] = record.ExpiryTime.Seconds
	} else {
		recordMap["expiryTime"] = nil
	}
	recordMap["rank"] = record.Rank

	return recordMap
}

func (n *runtimeJavascriptNakamaModule) tournamentList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		startTime := 0
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			startTime = int(getJsInt(r, f.Argument(2)))
			if startTime < 0 {
				panic(r.NewTypeError("start time must be >= 0"))
			}
		}

		endTime := 0
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

		var cursor *TournamentListCursor
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			cursorStr := getJsString(r, f.Argument(5))
			cb, err := base64.StdEncoding.DecodeString(cursorStr)
			if err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
			cursor = &TournamentListCursor{}
			if err := gob.NewDecoder(bytes.NewReader(cb)).Decode(cursor); err != nil {
				panic(r.NewTypeError("expects cursor to be valid when provided"))
			}
		}

		list, err := TournamentList(context.Background(), n.logger, n.db, n.leaderboardCache, categoryStart, categoryEnd, startTime, endTime, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournaments: %v", err.Error())))
		}

		results := make([]interface{}, 0, len(list.Tournaments))
		for _, tournament := range list.Tournaments {
			t, err := getJsTournamentData(tournament)
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

func (n *runtimeJavascriptNakamaModule) tournamentRecordWrite(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		userIDStr := getJsString(r, f.Argument(1))
		userID, err := uuid.FromString(userIDStr)
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
			operatorString := getJsString(r, f.Argument(6))
			var ok bool
			if overrideOperator, ok = api.Operator_value[strings.ToUpper(operatorString)]; !ok {
				panic(r.NewTypeError(ErrInvalidOperator.Error()))
			}
		}

		record, err := TournamentRecordWrite(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, uuid.Nil, id, userID, username, score, subscore, metadataStr, api.Operator(overrideOperator))
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error writing tournament record: %v", err.Error())))
		}

		return r.ToValue(leaderboardRecordToJsMap(r, record))
	}
}

func (n *runtimeJavascriptNakamaModule) tournamentRecordsHaystack(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		id := getJsString(r, f.Argument(0))
		if id == "" {
			panic(r.NewTypeError("expects a tournament ID string"))
		}

		userIDStr := getJsString(r, f.Argument(1))
		userID, err := uuid.FromString(userIDStr)
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

		var expiry int64
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			expiry = getJsInt(r, f.Argument(3))
			if expiry < 0 {
				panic(r.NewTypeError("expiry should be time since epoch in seconds and has to be a positive integer"))
			}
		}

		records, err := TournamentRecordsHaystack(context.Background(), n.logger, n.db, n.leaderboardCache, n.rankCache, id, userID, limit, expiry)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing tournament records haystack: %v", err.Error())))
		}

		results := make([]interface{}, 0, len(records))
		for _, record := range records {
			results = append(results, leaderboardRecordToJsMap(r, record))
		}

		return r.ToValue(results)
	}
}

func (n *runtimeJavascriptNakamaModule) groupsGetId(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIdsIn := f.Argument(0)
		if groupIdsIn == goja.Undefined() || groupIdsIn == goja.Null() {
			panic(r.NewTypeError("expects an array of group ids"))
		}
		tournamentIdsSlice, ok := groupIdsIn.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects array of group ids"))
		}

		groupIDs := make([]string, 0, len(tournamentIdsSlice))
		for _, id := range tournamentIdsSlice {
			idString, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects group ID to be a string"))
			}
			groupIDs = append(groupIDs, idString)
		}

		groups, err := GetGroups(context.Background(), n.logger, n.db, groupIDs)
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

func (n *runtimeJavascriptNakamaModule) groupCreate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDString := getJsString(r, f.Argument(0))
		if userIDString == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		name := getJsString(r, f.Argument(1))
		if name == "" {
			panic(r.NewTypeError("expects group name to not be empty"))
		}

		creatorIDString := uuid.Nil.String()
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			creatorIDString = getJsString(r, f.Argument(2))
		}
		creatorID, err := uuid.FromString(creatorIDString)
		if err != nil {
			panic(r.NewTypeError("expects owner ID to be a valid identifier"))
		}

		lang := ""
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			lang = getJsString(r, f.Argument(3))
		}

		desc := ""
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			desc = getJsString(r, f.Argument(4))
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
			metadataMap, ok := f.Argument(7).Export().(map[string]interface{})
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

		group, err := CreateGroup(context.Background(), n.logger, n.db, userID, creatorID, name, lang, desc, avatarURL, metadataStr, open, maxCount)
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

func (n *runtimeJavascriptNakamaModule) groupUpdate(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDStr := getJsString(r, f.Argument(0))
		groupID, err := uuid.FromString(groupIDStr)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userId := uuid.Nil
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			userIdStr := getJsString(r, f.Argument(1))
			userId, err = uuid.FromString(userIdStr)
			if err != nil {
				panic(r.NewTypeError("expects user ID to be a valid identifier"))
			}
		}

		var name *wrapperspb.StringValue
		if f.Argument(2) != goja.Undefined() && f.Argument(2) != goja.Null() {
			nameStr := getJsString(r, f.Argument(2))
			name = &wrapperspb.StringValue{Value: nameStr}
		}

		creatorID := uuid.Nil
		if f.Argument(3) != goja.Undefined() && f.Argument(3) != goja.Null() {
			creatorIDStr := getJsString(r, f.Argument(3))
			creatorID, err = uuid.FromString(creatorIDStr)
			if err != nil {
				panic(r.NewTypeError("expects creator ID to be a valid identifier"))
			}
		}

		var lang *wrapperspb.StringValue
		if f.Argument(4) != goja.Undefined() && f.Argument(4) != goja.Null() {
			langStr := getJsString(r, f.Argument(4))
			lang = &wrapperspb.StringValue{Value: langStr}
		}

		var desc *wrapperspb.StringValue
		if f.Argument(5) != goja.Undefined() && f.Argument(5) != goja.Null() {
			descStr := getJsString(r, f.Argument(5))
			desc = &wrapperspb.StringValue{Value: descStr}
		}

		var avatarURL *wrapperspb.StringValue
		if f.Argument(6) != goja.Undefined() && f.Argument(6) != goja.Null() {
			avatarStr := getJsString(r, f.Argument(6))
			avatarURL = &wrapperspb.StringValue{Value: avatarStr}
		}

		var open *wrapperspb.BoolValue
		if f.Argument(7) != goja.Undefined() && f.Argument(7) != goja.Null() {
			open = &wrapperspb.BoolValue{Value: getJsBool(r, f.Argument(7))}
		}

		var metadata *wrapperspb.StringValue
		metadataIn := f.Argument(8)
		if metadataIn != goja.Undefined() && metadataIn != goja.Null() {
			metadataMap, ok := metadataIn.Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects metadata to be a key value object"))
			}
			metadataBytes, err := json.Marshal(metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata: %s", err.Error())))
			}
			metadata = &wrapperspb.StringValue{Value: string(metadataBytes)}
		}

		maxCount := 0
		if f.Argument(9) != goja.Undefined() && f.Argument(9) != goja.Null() {
			maxCountIn := int(getJsInt(r, f.Argument(9)))
			if maxCountIn > 0 && maxCountIn <= 100 {
				maxCount = maxCountIn
			} else {
				panic(r.NewTypeError("max count must be 1-100"))
			}
		}

		if err = UpdateGroup(context.Background(), n.logger, n.db, groupID, userId, creatorID, name, lang, desc, avatarURL, metadata, open, maxCount); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to update group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDStr := getJsString(r, f.Argument(0))
		groupID, err := uuid.FromString(groupIDStr)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		if err = DeleteGroup(context.Background(), n.logger, n.db, groupID, uuid.Nil); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to delete group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUsersKick(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDStr := getJsString(r, f.Argument(0))
		groupID, err := uuid.FromString(groupIDStr)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		users := f.Argument(1)
		if goja.IsUndefined(users) || goja.IsNull(users) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		usersSlice, ok := users.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		userIDs := make([]uuid.UUID, 0, len(usersSlice))
		for _, id := range usersSlice {
			idStr, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			userID, err := uuid.FromString(idStr)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if userID == uuid.Nil {
				panic(r.NewTypeError("cannot kick the root user"))
			}
			userIDs = append(userIDs, userID)
		}

		callerID := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerIdStr := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerIdStr)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerID = cid
		}

		if err := KickGroupUsers(context.Background(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to kick users from a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUsersList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDStr := getJsString(r, f.Argument(0))
		groupID, err := uuid.FromString(groupIDStr)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
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

		res, err := ListGroupUsers(context.Background(), n.logger, n.db, n.tracker, groupID, limit, stateWrapper, cursor)
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

func (n *runtimeJavascriptNakamaModule) userGroupsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		userIDStr := getJsString(r, f.Argument(0))
		userID, err := uuid.FromString(userIDStr)
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

		res, err := ListUserGroups(context.Background(), n.logger, n.db, userID, limit, stateWrapper, cursor)
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

func (n *runtimeJavascriptNakamaModule) friendsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
			if limit < 1 || limit > 100 {
				panic(r.NewTypeError("expects limit to be 1-100"))
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

		friends, err := ListFriends(context.Background(), n.logger, n.db, n.tracker, userID, limit, stateWrapper, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to list friends for a user: %v", err.Error())))
		}

		userFriends := make([]interface{}, 0, len(friends.Friends))
		for _, f := range friends.Friends {
			fum, err := getJsUserData(f.User)
			if err != nil {
				panic(r.NewGoError(err))
			}

			fm := make(map[string]interface{}, 3)
			fm["state"] = f.State.Value
			fm["update_time"] = f.UpdateTime.Seconds
			fm["user"] = fum

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

func (n *runtimeJavascriptNakamaModule) groupUserJoin(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDString := getJsString(r, f.Argument(0))
		if groupIDString == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		groupID, err := uuid.FromString(groupIDString)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDString := getJsString(r, f.Argument(1))
		if userIDString == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := JoinGroup(context.Background(), n.logger, n.db, n.router, groupID, userID, username); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to join a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUserLeave(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDString := getJsString(r, f.Argument(0))
		if groupIDString == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		groupID, err := uuid.FromString(groupIDString)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		userIDString := getJsString(r, f.Argument(1))
		if userIDString == "" {
			panic(r.NewTypeError("expects a user ID string"))
		}
		userID, err := uuid.FromString(userIDString)
		if err != nil {
			panic(r.NewTypeError("expects user ID to be a valid identifier"))
		}

		username := getJsString(r, f.Argument(2))
		if username == "" {
			panic(r.NewTypeError("expects a username string"))
		}

		if err := LeaveGroup(context.Background(), n.logger, n.db, n.router, groupID, userID, username); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to leave a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUsersAdd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDString := getJsString(r, f.Argument(0))
		if groupIDString == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		groupID, err := uuid.FromString(groupIDString)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		users := f.Argument(1)
		if goja.IsUndefined(users) || goja.IsNull(users) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		usersSlice, ok := users.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		userIDs := make([]uuid.UUID, 0, len(usersSlice))
		for _, id := range usersSlice {
			idStr, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			userID, err := uuid.FromString(idStr)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if userID == uuid.Nil {
				panic(r.NewTypeError("cannot add the root user"))
			}
			userIDs = append(userIDs, userID)
		}
		if len(userIDs) == 0 {
			return goja.Undefined()
		}

		callerID := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerIdStr := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerIdStr)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerID = cid
		}

		if err := AddGroupUsers(context.Background(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to add users into a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUsersPromote(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDString := getJsString(r, f.Argument(0))
		if groupIDString == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		groupID, err := uuid.FromString(groupIDString)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		users := f.Argument(1)
		if goja.IsUndefined(users) || goja.IsNull(users) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		usersSlice, ok := users.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		userIDs := make([]uuid.UUID, 0, len(usersSlice))
		for _, id := range usersSlice {
			idStr, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			userID, err := uuid.FromString(idStr)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if userID == uuid.Nil {
				panic(r.NewTypeError("cannot promote the root user"))
			}
			userIDs = append(userIDs, userID)
		}
		if len(userIDs) == 0 {
			return goja.Undefined()
		}

		callerID := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerIdStr := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerIdStr)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerID = cid
		}

		if err := PromoteGroupUsers(context.Background(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to promote users in a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupUsersDemote(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		groupIDString := getJsString(r, f.Argument(0))
		if groupIDString == "" {
			panic(r.NewTypeError("expects a group ID string"))
		}
		groupID, err := uuid.FromString(groupIDString)
		if err != nil {
			panic(r.NewTypeError("expects group ID to be a valid identifier"))
		}

		users := f.Argument(1)
		if goja.IsUndefined(users) || goja.IsNull(users) {
			panic(r.NewTypeError("expects an array of user ids"))
		}
		usersSlice, ok := users.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of user ids"))
		}

		userIDs := make([]uuid.UUID, 0, len(usersSlice))
		for _, id := range usersSlice {
			idStr, ok := id.(string)
			if !ok {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			userID, err := uuid.FromString(idStr)
			if err != nil {
				panic(r.NewTypeError("expects user id to be valid identifier"))
			}
			if userID == uuid.Nil {
				panic(r.NewTypeError("cannot demote the root user"))
			}
			userIDs = append(userIDs, userID)
		}
		if len(userIDs) == 0 {
			return goja.Undefined()
		}

		callerID := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			callerIdStr := getJsString(r, f.Argument(2))
			cid, err := uuid.FromString(callerIdStr)
			if err != nil {
				panic(r.NewTypeError("expects caller id to be valid identifier"))
			}
			callerID = cid
		}

		if err := DemoteGroupUsers(context.Background(), n.logger, n.db, n.router, callerID, groupID, userIDs); err != nil {
			panic(r.NewGoError(fmt.Errorf("error while trying to demote users in a group: %v", err.Error())))
		}

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) groupsList(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		groups, err := ListGroups(context.Background(), n.logger, n.db, name, langTag, open, edgeCount, limit, cursor)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("error listing groups: %s", err.Error())))
		}

		groupsSlice := make([]interface{}, 0, len(groups.Groups))
		for _, g := range groups.Groups {
			groupMap := make(map[string]interface{}, 12)

			groupMap["id"] = g.Id
			groupMap["creatorId"] = g.CreatorId
			groupMap["name"] = g.Name
			groupMap["description"] = g.Description
			groupMap["avatarUrl"] = g.AvatarUrl
			groupMap["langTag"] = g.LangTag
			groupMap["open"] = g.Open.Value
			groupMap["edgeCount"] = g.EdgeCount
			groupMap["maxCount"] = g.MaxCount
			groupMap["createTime"] = g.CreateTime.Seconds
			groupMap["updateTime"] = g.UpdateTime.Seconds

			metadataMap := make(map[string]interface{})
			err = json.Unmarshal([]byte(g.Metadata), &metadataMap)
			if err != nil {
				panic(r.NewGoError(fmt.Errorf("failed to convert metadata to json: %s", err.Error())))
			}
			pointerizeSlices(metadataMap)
			groupMap["metadata"] = metadataMap

			groupsSlice = append(groupsSlice, groupMap)
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

func (n *runtimeJavascriptNakamaModule) fileRead(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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

		fContent, err := ioutil.ReadAll(file)
		if err != nil {
			panic(r.NewGoError(fmt.Errorf("failed to read file: %s", err.Error())))
		}

		return r.ToValue(string(fContent))
	}
}

func (n *runtimeJavascriptNakamaModule) localcacheGet(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
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
		if found {
			return value
		}

		return defVal
	}
}

func (n *runtimeJavascriptNakamaModule) localcachePut(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		key := getJsString(r, f.Argument(0))
		if key == "" {
			panic(r.NewTypeError("expects non empty key string"))
		}

		value := f.Argument(1)
		if value == goja.Undefined() || value == goja.Null() {
			panic(r.NewTypeError("expects a non empty value"))
		}

		n.localCache.Put(key, value)

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) localcacheDelete(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		key := getJsString(r, f.Argument(0))
		if key == "" {
			panic(r.NewTypeError("expects non empty key string"))
		}

		n.localCache.Delete(key)

		return goja.Undefined()
	}
}

func (n *runtimeJavascriptNakamaModule) channelMessageSend(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		channelId := getJsString(r, f.Argument(0))

		contentStr := "{}"
		if f.Argument(1) != goja.Undefined() && f.Argument(1) != goja.Null() {
			contentMap, ok := f.Argument(1).Export().(map[string]interface{})
			if !ok {
				panic(r.NewTypeError("expects content to be an object"))
			}
			contentBytes, err := json.Marshal(contentMap)
			if err != nil {
				panic(r.NewTypeError(fmt.Sprintf("error encoding content: %v", err.Error())))
			}
			contentStr = string(contentBytes)
		}

		senderId := uuid.Nil
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			senderIdStr := getJsString(r, f.Argument(2))
			senderUUID, err := uuid.FromString(senderIdStr)
			if err != nil {
				panic(r.NewTypeError("expects sender id to be valid identifier"))
			}
			senderId = senderUUID
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

		ack, err := ChannelMessageSend(context.Background(), n.logger, n.db, n.router, channelIdToStreamResult.Stream, channelId, contentStr, senderId.String(), senderUsername, persist)
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

func (n *runtimeJavascriptNakamaModule) channelIdBuild(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		target := getJsString(r, f.Argument(0))

		chanType := getJsInt(r, f.Argument(1))
		if chanType < 1 || chanType > 3 {
			panic(r.NewTypeError("invalid channel type: expects value 1-3"))
		}

		channelId, _, err := BuildChannelId(context.Background(), n.logger, n.db, uuid.Nil, target, rtapi.ChannelJoin_Type(chanType))
		if err != nil {
			if errors.Is(err, errInvalidChannelTarget) || errors.Is(err, errInvalidChannelType) {
				panic(r.NewTypeError(err.Error()))
			}
			panic(r.NewGoError(err))
		}

		return r.ToValue(channelId)
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

func getJsBool(r *goja.Runtime, v goja.Value) bool {
	b, ok := v.Export().(bool)
	if !ok {
		panic(r.NewTypeError("expects boolean"))
	}
	return b
}

func getJsAccountData(account *api.Account) (map[string]interface{}, error) {
	accountData := make(map[string]interface{})
	userData, err := getJsUserData(account.User)
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

func getJsUserData(user *api.User) (map[string]interface{}, error) {
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

func getJsLeaderboardData(leaderboard *api.Leaderboard) (map[string]interface{}, error) {
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
	leaderboardMap["createTime"] = leaderboard.CreateTime
	if leaderboard.PrevReset != 0 {
		leaderboardMap["prevReset"] = leaderboard.PrevReset
	}
	if leaderboard.NextReset != 0 {
		leaderboardMap["nextReset"] = leaderboard.NextReset
	}
	leaderboardMap["authoritative"] = leaderboard.Authoritative

	return leaderboardMap, nil
}

func getJsTournamentData(tournament *api.Tournament) (map[string]interface{}, error) {
	tournamentMap := make(map[string]interface{}, 18)

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

	return tournamentMap, nil
}

func getJsValidatedPurchasesData(validation *api.ValidatePurchaseResponse) map[string]interface{} {
	validatedPurchases := make([]interface{}, 0, len(validation.ValidatedPurchases))
	for _, v := range validation.ValidatedPurchases {
		validatedPurchases = append(validatedPurchases, getJsValidatedPurchaseData(v))
	}

	validationMap := make(map[string]interface{}, 1)
	validationMap["validatedPurchases"] = validatedPurchases

	return validationMap
}

func getJsValidatedPurchaseData(purchase *api.ValidatedPurchase) map[string]interface{} {
	validatedPurchaseMap := make(map[string]interface{}, 7)
	validatedPurchaseMap["productId"] = purchase.ProductId
	validatedPurchaseMap["transactionId"] = purchase.TransactionId
	validatedPurchaseMap["store"] = purchase.Store.String()
	validatedPurchaseMap["ProviderResponse"] = purchase.ProviderResponse
	validatedPurchaseMap["purchaseTime"] = purchase.PurchaseTime.Seconds
	validatedPurchaseMap["createTime"] = purchase.CreateTime.Seconds
	validatedPurchaseMap["updateTime"] = purchase.UpdateTime.Seconds

	return validatedPurchaseMap
}

func getStreamData(r *goja.Runtime, streamObj map[string]interface{}) PresenceStream {
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
