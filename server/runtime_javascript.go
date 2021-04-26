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
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/dop251/goja"
	"github.com/dop251/goja/ast"
	"github.com/gofrs/uuid"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"io/ioutil"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const JsEntrypointFilename = "index.js"

type RuntimeJS struct {
	logger       *zap.Logger
	node         string
	nkInst       goja.Value
	jsLoggerInst goja.Value
	env          goja.Value
	vm           *goja.Runtime
	callbacks    *RuntimeJavascriptCallbacks
}

func (r *RuntimeJS) GetCallback(e RuntimeExecutionMode, key string) string {
	switch e {
	case RuntimeExecutionModeRPC:
		return r.callbacks.Rpc[key]
	case RuntimeExecutionModeBefore:
		return r.callbacks.Before[key]
	case RuntimeExecutionModeAfter:
		return r.callbacks.After[key]
	case RuntimeExecutionModeMatchmaker:
		return r.callbacks.Matchmaker
	case RuntimeExecutionModeTournamentEnd:
		return r.callbacks.TournamentEnd
	case RuntimeExecutionModeTournamentReset:
		return r.callbacks.TournamentReset
	case RuntimeExecutionModeLeaderboardReset:
		return r.callbacks.LeaderboardReset
	}

	return ""
}

type JsErrorType int

func (e JsErrorType) String() string {
	switch e {
	case JsErrorException:
		return "exception"
	default:
		return ""
	}
}

const (
	JsErrorException JsErrorType = iota
	JsErrorRuntime
)

type jsError struct {
	StackTrace string
	Type       string
	Message    string `json:",omitempty"`
	error      error
}

func (e *jsError) Error() string {
	return e.error.Error()
}

func newJsExceptionError(t JsErrorType, error, st string) *jsError {
	return &jsError{
		StackTrace: st,
		Type:       t.String(),
		error:      errors.New(error),
	}
}

func newJsError(t JsErrorType, err error) *jsError {
	return &jsError{
		Message: err.Error(),
		Type:    t.String(),
		error:   err,
	}
}

type RuntimeJSModule struct {
	Name    string
	Path    string
	Program *goja.Program
	Ast     *ast.Program
}

type RuntimeJSModuleCache struct {
	Names   []string
	Modules map[string]*RuntimeJSModule
}

func (mc *RuntimeJSModuleCache) Add(m *RuntimeJSModule) {
	mc.Names = append(mc.Names, m.Name)
	mc.Modules[m.Name] = m

	// Ensure modules will be listed in ascending order of names.
	sort.Strings(mc.Names)
}

type RuntimeProviderJS struct {
	logger               *zap.Logger
	db                   *sql.DB
	protojsonMarshaler   *protojson.MarshalOptions
	protojsonUnmarshaler *protojson.UnmarshalOptions
	config               Config
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	matchRegistry        MatchRegistry
	tracker              Tracker
	streamManager        StreamManager
	router               MessageRouter
	eventFn              RuntimeEventCustomFunction
	matchCreateFn        RuntimeMatchCreateFunction
	poolCh               chan *RuntimeJS
	maxCount             uint32
	currentCount         *atomic.Uint32
	newFn                func() *RuntimeJS
	metrics              *Metrics
}

func (rp *RuntimeProviderJS) Rpc(ctx context.Context, id string, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
	r, err := rp.Get(ctx)
	if err != nil {
		return "", err, codes.Internal
	}
	jsFn := r.GetCallback(RuntimeExecutionModeRPC, id)
	if jsFn == "" {
		rp.Put(r)
		return "", ErrRuntimeRPCNotFound, codes.NotFound
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return "", errors.New("Could not run Rpc function."), codes.Internal
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("rpc_id", id))
	if err != nil {
		r.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return "", errors.New("Could not run Rpc function."), codes.Internal
	}
	retValue, err, code := r.InvokeFunction(RuntimeExecutionModeRPC, id, fn, jsLogger, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, payload)
	rp.Put(r)
	if err != nil {
		return "", err, code
	}

	if retValue == nil {
		return "", nil, 0
	}

	payload, ok = retValue.(string)
	if !ok {
		msg := "Runtime function returned invalid data - only allowed one return value of type string."
		rp.logger.Error(msg, zap.String("mode", RuntimeExecutionModeRPC.String()), zap.String("id", id))
		return "", errors.New(msg), codes.Internal
	}

	return payload, nil, code
}

func (rp *RuntimeProviderJS) BeforeRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return nil, err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeBefore, id)
	if jsFn == "" {
		rp.Put(r)
		return nil, errors.New("Runtime Before function not found.")
	}

	envelopeJSON, err := rp.protojsonMarshaler.Marshal(envelope)
	if err != nil {
		rp.Put(r)
		logger.Error("Could not marshall envelope to JSON", zap.Any("envelope", envelope), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}
	var envelopeMap map[string]interface{}
	if err := json.Unmarshal(envelopeJSON, &envelopeMap); err != nil {
		rp.Put(r)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("envelope_json", envelopeJSON), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeBefore.String()))
	if err != nil {
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}
	result, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeBefore, id, fn, jsLogger, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, envelopeMap)
	rp.Put(r)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
		return nil, fnErr
	}

	if result == nil {
		return nil, nil
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshal result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	if err = rp.protojsonUnmarshaler.Unmarshal(resultJSON, envelope); err != nil {
		logger.Error("Could not unmarshal result to envelope", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function.")
	}

	return envelope, nil
}

func (rp *RuntimeProviderJS) AfterRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeAfter, id)
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime After function not found.")
	}

	envelopeJSON, err := rp.protojsonMarshaler.Marshal(envelope)
	if err != nil {
		rp.Put(r)
		logger.Error("Could not marshall envelope to JSON", zap.Any("envelope", envelope), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	var envelopeMap map[string]interface{}
	if err := json.Unmarshal([]byte(envelopeJSON), &envelopeMap); err != nil {
		rp.Put(r)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("envelope_json", envelopeJSON), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeAfter.String()))
	if err != nil {
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	_, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeAfter, id, fn, jsLogger, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, envelopeMap)
	rp.Put(r)

	if fnErr != nil {
		logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		return fnErr
	}

	return nil
}

func (rp *RuntimeProviderJS) BeforeReq(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, req interface{}) (interface{}, error, codes.Code) {
	r, err := rp.Get(ctx)
	if err != nil {
		return nil, err, codes.Internal
	}
	jsFn := r.GetCallback(RuntimeExecutionModeBefore, id)
	if jsFn == "" {
		rp.Put(r)
		return nil, errors.New("Runtime Before function not found."), codes.NotFound
	}

	var reqMap map[string]interface{}
	var reqProto proto.Message
	if req != nil {
		// Req may be nil for requests that carry no input body.
		var ok bool
		reqProto, ok = req.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast request to message", zap.Any("request", req))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
		reqJSON, err := rp.protojsonMarshaler.Marshal(reqProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
		if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
			return nil, errors.New("Could not run runtime Before function."), codes.Internal
		}
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, API_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeAfter.String()))
	if err != nil {
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}
	result, fnErr, code := r.InvokeFunction(RuntimeExecutionModeBefore, id, fn, jsLogger, nil, userID, username, vars, expiry, "", clientIP, clientPort, reqMap)
	rp.Put(r)

	if fnErr != nil {
		logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(err))
		return nil, fnErr, code
	}

	if result == nil || reqMap == nil {
		// There was no return value, or a return value was not expected (no input to override).
		return nil, nil, codes.OK
	}

	resultJSON, err := json.Marshal(result)
	if err != nil {
		logger.Error("Could not marshall result to JSON", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	if err = rp.protojsonUnmarshaler.Unmarshal(resultJSON, reqProto); err != nil {
		logger.Error("Could not unmarshall result to request", zap.Any("result", result), zap.Error(err))
		return nil, errors.New("Could not complete runtime Before function."), codes.Internal
	}

	return req, nil, codes.OK
}

func (rp *RuntimeProviderJS) AfterReq(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, res interface{}, req interface{}) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeAfter, id)
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime After function not found.")
	}

	var resMap map[string]interface{}
	if res != nil {
		// Res may be nil if there is no response body.
		resProto, ok := res.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast response to message", zap.Any("response", res))
			return errors.New("Could not run runtime After function.")
		}
		resJSON, err := rp.protojsonMarshaler.Marshal(resProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall response to JSON", zap.Any("response", resProto), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}

		if err := json.Unmarshal([]byte(resJSON), &resMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall response to interface{}", zap.Any("response_json", resJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	var reqMap map[string]interface{}
	if req != nil {
		// Req may be nil if there is no request body.
		reqProto, ok := req.(proto.Message)
		if !ok {
			rp.Put(r)
			logger.Error("Could not cast request to message", zap.Any("request", req))
			return errors.New("Could not run runtime After function.")
		}
		reqJSON, err := rp.protojsonMarshaler.Marshal(reqProto)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall request to JSON", zap.Any("request", reqProto), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}

		if err := json.Unmarshal([]byte(reqJSON), &reqMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall request to interface{}", zap.Any("request_json", reqJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("api_id", strings.TrimPrefix(id, API_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeAfter.String()))
	if err != nil {
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	_, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeAfter, id, fn, jsLogger, nil, userID, username, vars, expiry, "", clientIP, clientPort, resMap, reqMap)
	rp.Put(r)

	if fnErr != nil {
		logger.Error("JavaScript runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
		return fnErr
	}

	return nil
}

func (r *RuntimeJS) InvokeFunction(execMode RuntimeExecutionMode, id string, fn goja.Callable, logger goja.Value, queryParams map[string][]string, uid, username string, vars map[string]string, sessionExpiry int64, sid, clientIP, clientPort string, payloads ...interface{}) (interface{}, error, codes.Code) {
	ctx := NewRuntimeJsContext(r.vm, r.node, r.env, execMode, queryParams, sessionExpiry, uid, username, vars, sid, clientIP, clientPort)

	args := []goja.Value{ctx, logger, r.nkInst}
	jsArgs := make([]goja.Value, 0, len(args)+len(payloads))
	jsArgs = append(jsArgs, args...)
	for _, payload := range payloads {
		jsArgs = append(jsArgs, r.vm.ToValue(payload))
	}

	retVal, err, code := r.invokeFunction(execMode, id, fn, jsArgs...)
	if err != nil {
		return nil, err, code
	}

	if retVal == nil {
		return nil, nil, codes.OK
	} else {
		return retVal.Export(), nil, codes.OK
	}
}

func (r *RuntimeJS) invokeFunction(execMode RuntimeExecutionMode, id string, fn goja.Callable, args ...goja.Value) (goja.Value, error, codes.Code) {
	// First argument is null because the js fn is not executed in the context of an object.
	retVal, err := fn(goja.Null(), args...)
	if err != nil {
		if exErr, ok := err.(*goja.Exception); ok {
			r.logger.Error("JavaScript runtime function raised an uncaught exception", zap.String("mode", execMode.String()), zap.String("id", id), zap.Error(err))
			return nil, newJsExceptionError(JsErrorException, exErr.Error(), exErr.String()), codes.Internal
		}
		r.logger.Error("JavaScript runtime function caused an error", zap.String("mode", execMode.String()), zap.String("id", id), zap.Error(err))
		return nil, newJsError(JsErrorRuntime, err), codes.Internal
	}
	if retVal == nil || retVal == goja.Undefined() || retVal == goja.Null() {
		return nil, nil, codes.OK
	}

	return retVal, nil, codes.OK
}

func (rp *RuntimeProviderJS) Get(ctx context.Context) (*RuntimeJS, error) {
	select {
	case <-ctx.Done():
		// Context cancelled
		return nil, ctx.Err()
	case r := <-rp.poolCh:
		// Ideally use an available idle runtime.
		return r, nil
	default:
		// If there was no idle runtime, see if we can allocate a new one.
		if rp.currentCount.Load() >= rp.maxCount {
			// No further runtime allocation allowed.
			break
		}
		currentCount := rp.currentCount.Inc()
		if currentCount > rp.maxCount {
			// When we've incremented see if we can still allocate or a concurrent operation has already done so up to the limit.
			// The current count value may go above max count value, but we will never over-allocate runtimes.
			// This discrepancy is allowed as it avoids a full mutex locking scenario.
			break
		}
		rp.metrics.GaugeJsRuntimes(float64(currentCount))
		return rp.newFn(), nil
	}

	// If we reach here then we were unable to find an available idle runtime, and allocation was not allowed.
	// Wait as needed.
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case r := <-rp.poolCh:
		return r, nil
	}
}

func (rp *RuntimeProviderJS) Put(r *RuntimeJS) {
	select {
	case rp.poolCh <- r:
		// Runtime is successfully returned to the pool.
	default:
		// The pool is over capacity. Should never happen but guard anyway.
		// Safe to continue processing, the runtime is just discarded.
		rp.logger.Warn("JavaScript runtime pool full, discarding runtime")
	}
}

func NewRuntimeProviderJS(logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, matchRegistry MatchRegistry, tracker Tracker, metrics *Metrics, streamManager StreamManager, router MessageRouter, eventFn RuntimeEventCustomFunction, path, entrypoint string, matchProvider *MatchProvider) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, error) {
	startupLogger.Info("Initialising JavaScript runtime provider", zap.String("path", path), zap.String("entrypoint", entrypoint))

	modCache, err := cacheJavascriptModules(startupLogger, path, entrypoint)
	if err != nil {
		startupLogger.Fatal("Failed to load JavaScript files", zap.Error(err))
	}

	jsprotojsonMarshaler := &protojson.MarshalOptions{
		UseProtoNames:   false,
		UseEnumNumbers:  protojsonMarshaler.UseEnumNumbers,
		EmitUnpopulated: protojsonMarshaler.EmitUnpopulated,
		Indent:          protojsonMarshaler.Indent,
	}

	localCache := NewRuntimeJavascriptLocalCache()

	runtimeProviderJS := &RuntimeProviderJS{
		config:               config,
		logger:               logger,
		db:                   db,
		eventFn:              eventFn,
		matchCreateFn:        matchProvider.CreateMatch,
		matchRegistry:        matchRegistry,
		protojsonMarshaler:   jsprotojsonMarshaler,
		protojsonUnmarshaler: protojsonUnmarshaler,
		socialClient:         socialClient,
		leaderboardCache:     leaderboardCache,
		leaderboardRankCache: leaderboardRankCache,
		sessionRegistry:      sessionRegistry,
		sessionCache:         sessionCache,
		tracker:              tracker,
		streamManager:        streamManager,
		router:               router,
		metrics:              metrics,
		poolCh:               make(chan *RuntimeJS, config.GetRuntime().JsMaxCount),
		maxCount:             uint32(config.GetRuntime().JsMaxCount),
		currentCount:         atomic.NewUint32(uint32(config.GetRuntime().JsMinCount)),
	}

	rpcFunctions := make(map[string]RuntimeRpcFunction, 0)
	beforeRtFunctions := make(map[string]RuntimeBeforeRtFunction, 0)
	afterRtFunctions := make(map[string]RuntimeAfterRtFunction, 0)
	beforeReqFunctions := &RuntimeBeforeReqFunctions{}
	afterReqFunctions := &RuntimeAfterReqFunctions{}
	var matchmakerMatchedFunction RuntimeMatchmakerMatchedFunction
	var tournamentEndFunction RuntimeTournamentEndFunction
	var tournamentResetFunction RuntimeTournamentResetFunction
	var leaderboardResetFunction RuntimeLeaderboardResetFunction

	callbacks, matchHandlers, err := evalRuntimeModules(runtimeProviderJS, modCache, matchProvider, leaderboardScheduler, localCache, func(mode RuntimeExecutionMode, id string) {
		switch mode {
		case RuntimeExecutionModeRPC:
			rpcFunctions[id] = func(ctx context.Context, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, payload string) (string, error, codes.Code) {
				return runtimeProviderJS.Rpc(ctx, id, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, payload)
			}
		case RuntimeExecutionModeBefore:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				beforeRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
					return runtimeProviderJS.BeforeRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, envelope)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortID := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortID {
				case "getaccount":
					beforeReqFunctions.beforeGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
						_, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil)
						if err != nil {
							return err, code
						}
						return nil, 0
					}
				case "updateaccount":
					beforeReqFunctions.beforeUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) (*api.UpdateAccountRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateAccountRequest), nil, 0
					}
				case "sessionrefresh":
					beforeReqFunctions.beforeSessionRefreshFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionRefreshRequest) (*api.SessionRefreshRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.SessionRefreshRequest), nil, 0
					}
				case "sessionlogout":
					beforeReqFunctions.beforeSessionLogoutFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) (*api.SessionLogoutRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.SessionLogoutRequest), nil, 0
					}
				case "authenticateapple":
					beforeReqFunctions.beforeAuthenticateAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateAppleRequest) (*api.AuthenticateAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateAppleRequest), nil, 0
					}
				case "authenticatecustom":
					beforeReqFunctions.beforeAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateCustomRequest) (*api.AuthenticateCustomRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateCustomRequest), nil, 0
					}
				case "authenticatedevice":
					beforeReqFunctions.beforeAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateDeviceRequest) (*api.AuthenticateDeviceRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateDeviceRequest), nil, 0
					}
				case "authenticateemail":
					beforeReqFunctions.beforeAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateEmailRequest) (*api.AuthenticateEmailRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateEmailRequest), nil, 0
					}
				case "authenticatefacebook":
					beforeReqFunctions.beforeAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookRequest) (*api.AuthenticateFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateFacebookRequest), nil, 0
					}
				case "authenticatefacebookinstantgame":
					beforeReqFunctions.beforeAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateFacebookInstantGameRequest) (*api.AuthenticateFacebookInstantGameRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateFacebookInstantGameRequest), nil, 0
					}
				case "authenticategamecenter":
					beforeReqFunctions.beforeAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGameCenterRequest) (*api.AuthenticateGameCenterRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGameCenterRequest), nil, 0
					}
				case "authenticategoogle":
					beforeReqFunctions.beforeAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateGoogleRequest) (*api.AuthenticateGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateGoogleRequest), nil, 0
					}
				case "authenticatesteam":
					beforeReqFunctions.beforeAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AuthenticateSteamRequest) (*api.AuthenticateSteamRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AuthenticateSteamRequest), nil, 0
					}
				case "listchannelmessages":
					beforeReqFunctions.beforeListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListChannelMessagesRequest) (*api.ListChannelMessagesRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListChannelMessagesRequest), nil, 0
					}
				case "listfriends":
					beforeReqFunctions.beforeListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListFriendsRequest) (*api.ListFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListFriendsRequest), nil, 0
					}
				case "addfriends":
					beforeReqFunctions.beforeAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) (*api.AddFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddFriendsRequest), nil, 0
					}
				case "deletefriends":
					beforeReqFunctions.beforeDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) (*api.DeleteFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteFriendsRequest), nil, 0
					}
				case "blockfriends":
					beforeReqFunctions.beforeBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) (*api.BlockFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.BlockFriendsRequest), nil, 0
					}
				case "importfacebookfriends":
					beforeReqFunctions.beforeImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) (*api.ImportFacebookFriendsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ImportFacebookFriendsRequest), nil, 0
					}
				case "creategroup":
					beforeReqFunctions.beforeCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.CreateGroupRequest) (*api.CreateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.CreateGroupRequest), nil, 0
					}
				case "updategroup":
					beforeReqFunctions.beforeUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) (*api.UpdateGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.UpdateGroupRequest), nil, 0
					}
				case "deletegroup":
					beforeReqFunctions.beforeDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) (*api.DeleteGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteGroupRequest), nil, 0
					}
				case "joingroup":
					beforeReqFunctions.beforeJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) (*api.JoinGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinGroupRequest), nil, 0
					}
				case "leavegroup":
					beforeReqFunctions.beforeLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) (*api.LeaveGroupRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LeaveGroupRequest), nil, 0
					}
				case "addgroupusers":
					beforeReqFunctions.beforeAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) (*api.AddGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AddGroupUsersRequest), nil, 0
					}
				case "bangroupusers":
					beforeReqFunctions.beforeBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) (*api.BanGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.BanGroupUsersRequest), nil, 0
					}
				case "kickgroupusers":
					beforeReqFunctions.beforeKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) (*api.KickGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.KickGroupUsersRequest), nil, 0
					}
				case "promotegroupusers":
					beforeReqFunctions.beforePromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) (*api.PromoteGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.PromoteGroupUsersRequest), nil, 0
					}
				case "listgroupusers":
					beforeReqFunctions.beforeListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupUsersRequest) (*api.ListGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupUsersRequest), nil, 0
					}
				case "listusergroups":
					beforeReqFunctions.beforeListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListUserGroupsRequest) (*api.ListUserGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListUserGroupsRequest), nil, 0
					}
				case "listgroups":
					beforeReqFunctions.beforeListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListGroupsRequest) (*api.ListGroupsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListGroupsRequest), nil, 0
					}
				case "deleteleaderboardrecord":
					beforeReqFunctions.beforeDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) (*api.DeleteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecords":
					beforeReqFunctions.beforeListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsRequest) (*api.ListLeaderboardRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsRequest), nil, 0
					}
				case "writeleaderboardrecord":
					beforeReqFunctions.beforeWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteLeaderboardRecordRequest) (*api.WriteLeaderboardRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteLeaderboardRecordRequest), nil, 0
					}
				case "listleaderboardrecordsaroundowner":
					beforeReqFunctions.beforeListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListLeaderboardRecordsAroundOwnerRequest) (*api.ListLeaderboardRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListLeaderboardRecordsAroundOwnerRequest), nil, 0
					}
				case "linkapple":
					beforeReqFunctions.beforeLinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountApple), nil, 0
					}
				case "linkcustom":
					beforeReqFunctions.beforeLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "linkdevice":
					beforeReqFunctions.beforeLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "linkemail":
					beforeReqFunctions.beforeLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "linkfacebook":
					beforeReqFunctions.beforeLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) (*api.LinkFacebookRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LinkFacebookRequest), nil, 0
					}
				case "linkfacebookinstantgame":
					beforeReqFunctions.beforeLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebookInstantGame), nil, 0
					}
				case "linkgamecenter":
					beforeReqFunctions.beforeLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "linkgoogle":
					beforeReqFunctions.beforeLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "linksteam":
					beforeReqFunctions.beforeLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) (*api.LinkSteamRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.LinkSteamRequest), nil, 0
					}
				case "listmatches":
					beforeReqFunctions.beforeListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListMatchesRequest) (*api.ListMatchesRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListMatchesRequest), nil, 0
					}
				case "listnotifications":
					beforeReqFunctions.beforeListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListNotificationsRequest) (*api.ListNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListNotificationsRequest), nil, 0
					}
				case "deletenotification":
					beforeReqFunctions.beforeDeleteNotificationFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteNotificationsRequest), nil, 0
					}
				case "liststorageobjects":
					beforeReqFunctions.beforeListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListStorageObjectsRequest) (*api.ListStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListStorageObjectsRequest), nil, 0
					}
				case "readstorageobjects":
					beforeReqFunctions.beforeReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ReadStorageObjectsRequest) (*api.ReadStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ReadStorageObjectsRequest), nil, 0
					}
				case "writestorageobjects":
					beforeReqFunctions.beforeWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteStorageObjectsRequest) (*api.WriteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteStorageObjectsRequest), nil, 0
					}
				case "deletestorageobjects":
					beforeReqFunctions.beforeDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) (*api.DeleteStorageObjectsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DeleteStorageObjectsRequest), nil, 0
					}
				case "jointournament":
					beforeReqFunctions.beforeJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) (*api.JoinTournamentRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.JoinTournamentRequest), nil, 0
					}
				case "listtournamentrecords":
					beforeReqFunctions.beforeListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsRequest) (*api.ListTournamentRecordsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsRequest), nil, 0
					}
				case "listtournaments":
					beforeReqFunctions.beforeListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentsRequest) (*api.ListTournamentsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentsRequest), nil, 0
					}
				case "writetournamentrecord":
					beforeReqFunctions.beforeWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.WriteTournamentRecordRequest) (*api.WriteTournamentRecordRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.WriteTournamentRecordRequest), nil, 0
					}
				case "listtournamentrecordsaroundowner":
					beforeReqFunctions.beforeListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListTournamentRecordsAroundOwnerRequest) (*api.ListTournamentRecordsAroundOwnerRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListTournamentRecordsAroundOwnerRequest), nil, 0
					}
				case "unlinkapple":
					beforeReqFunctions.beforeUnlinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) (*api.AccountApple, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountApple), nil, 0
					}
				case "unlinkcustom":
					beforeReqFunctions.beforeUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) (*api.AccountCustom, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountCustom), nil, 0
					}
				case "unlinkdevice":
					beforeReqFunctions.beforeUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) (*api.AccountDevice, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountDevice), nil, 0
					}
				case "unlinkemail":
					beforeReqFunctions.beforeUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) (*api.AccountEmail, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountEmail), nil, 0
					}
				case "unlinkfacebook":
					beforeReqFunctions.beforeUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) (*api.AccountFacebook, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebook), nil, 0
					}
				case "unlinkfacebookinstantgame":
					beforeReqFunctions.beforeUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) (*api.AccountFacebookInstantGame, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountFacebookInstantGame), nil, 0
					}
				case "unlinkgamecenter":
					beforeReqFunctions.beforeUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) (*api.AccountGameCenter, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGameCenter), nil, 0
					}
				case "unlinkgoogle":
					beforeReqFunctions.beforeUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) (*api.AccountGoogle, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountGoogle), nil, 0
					}
				case "unlinksteam":
					beforeReqFunctions.beforeUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) (*api.AccountSteam, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.AccountSteam), nil, 0
					}
				case "getusers":
					beforeReqFunctions.beforeGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetUsersRequest) (*api.GetUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.GetUsersRequest), nil, 0
					}
				case "event":
					beforeReqFunctions.beforeEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) (*api.Event, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.Event), nil, 0
					}
				}
			}
		case RuntimeExecutionModeAfter:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				afterRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort string, envelope *rtapi.Envelope) error {
					return runtimeProviderJS.AfterRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, envelope)
				}
			} else if strings.HasPrefix(id, strings.ToLower(API_PREFIX)) {
				shortID := strings.TrimPrefix(id, strings.ToLower(API_PREFIX))
				switch shortID {
				case "getaccount":
					afterReqFunctions.afterGetAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Account) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "updateaccount":
					afterReqFunctions.afterUpdateAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateAccountRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "sessionrefresh":
					afterReqFunctions.afterSessionRefreshFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.SessionRefreshRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "sessionlogout":
					afterReqFunctions.afterSessionLogoutFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.SessionLogoutRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "authenticateapple":
					afterReqFunctions.afterAuthenticateAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateAppleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatecustom":
					afterReqFunctions.afterAuthenticateCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateCustomRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatedevice":
					afterReqFunctions.afterAuthenticateDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateDeviceRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticateemail":
					afterReqFunctions.afterAuthenticateEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateEmailRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatefacebook":
					afterReqFunctions.afterAuthenticateFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatefacebookinstantgame":
					afterReqFunctions.afterAuthenticateFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateFacebookInstantGameRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticategamecenter":
					afterReqFunctions.afterAuthenticateGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGameCenterRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticategoogle":
					afterReqFunctions.afterAuthenticateGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateGoogleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "authenticatesteam":
					afterReqFunctions.afterAuthenticateSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Session, in *api.AuthenticateSteamRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listchannelmessages":
					afterReqFunctions.afterListChannelMessagesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ChannelMessageList, in *api.ListChannelMessagesRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listfriends":
					afterReqFunctions.afterListFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.FriendList) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, nil)
					}
				case "addfriends":
					afterReqFunctions.afterAddFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddFriendsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "deletefriends":
					afterReqFunctions.afterDeleteFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteFriendsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "blockfriends":
					afterReqFunctions.afterBlockFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BlockFriendsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "importfacebookfriends":
					afterReqFunctions.afterImportFacebookFriendsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ImportFacebookFriendsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "creategroup":
					afterReqFunctions.afterCreateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Group, in *api.CreateGroupRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "updategroup":
					afterReqFunctions.afterUpdateGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.UpdateGroupRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "deletegroup":
					afterReqFunctions.afterDeleteGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteGroupRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "joingroup":
					afterReqFunctions.afterJoinGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinGroupRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "leavegroup":
					afterReqFunctions.afterLeaveGroupFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LeaveGroupRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "addgroupusers":
					afterReqFunctions.afterAddGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AddGroupUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "bangroupusers":
					afterReqFunctions.afterBanGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.BanGroupUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "kickgroupusers":
					afterReqFunctions.afterKickGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.KickGroupUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "promotegroupusers":
					afterReqFunctions.afterPromoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.PromoteGroupUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listgroupusers":
					afterReqFunctions.afterListGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupUserList, in *api.ListGroupUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listusergroups":
					afterReqFunctions.afterListUserGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.UserGroupList, in *api.ListUserGroupsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listgroups":
					afterReqFunctions.afterListGroupsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.GroupList, in *api.ListGroupsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deleteleaderboardrecord":
					afterReqFunctions.afterDeleteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteLeaderboardRecordRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listleaderboardrecords":
					afterReqFunctions.afterListLeaderboardRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writeleaderboardrecord":
					afterReqFunctions.afterWriteLeaderboardRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteLeaderboardRecordRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listleaderboardrecordsaroundowner":
					afterReqFunctions.afterListLeaderboardRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecordList, in *api.ListLeaderboardRecordsAroundOwnerRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "linkapple":
					afterReqFunctions.afterLinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkcustom":
					afterReqFunctions.afterLinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkdevice":
					afterReqFunctions.afterLinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkemail":
					afterReqFunctions.afterLinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkfacebook":
					afterReqFunctions.afterLinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkFacebookRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkfacebookinstantgame":
					afterReqFunctions.afterLinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkgamecenter":
					afterReqFunctions.afterLinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linkgoogle":
					afterReqFunctions.afterLinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "linksteam":
					afterReqFunctions.afterLinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.LinkSteamRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listmatches":
					afterReqFunctions.afterListMatchesFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.MatchList, in *api.ListMatchesRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listnotifications":
					afterReqFunctions.afterListNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.NotificationList, in *api.ListNotificationsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deletenotification":
					afterReqFunctions.afterDeleteNotificationFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "liststorageobjects":
					afterReqFunctions.afterListStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectList, in *api.ListStorageObjectsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "readstorageobjects":
					afterReqFunctions.afterReadStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjects, in *api.ReadStorageObjectsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writestorageobjects":
					afterReqFunctions.afterWriteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.StorageObjectAcks, in *api.WriteStorageObjectsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "deletestorageobjects":
					afterReqFunctions.afterDeleteStorageObjectsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteStorageObjectsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "jointournament":
					afterReqFunctions.afterJoinTournamentFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.JoinTournamentRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "listtournamentrecords":
					afterReqFunctions.afterListTournamentRecordsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listtournaments":
					afterReqFunctions.afterListTournamentsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentList, in *api.ListTournamentsRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "writetournamentrecord":
					afterReqFunctions.afterWriteTournamentRecordFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.LeaderboardRecord, in *api.WriteTournamentRecordRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listtournamentrecordsaroundowner":
					afterReqFunctions.afterListTournamentRecordsAroundOwnerFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.TournamentRecordList, in *api.ListTournamentRecordsAroundOwnerRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "unlinkapple":
					afterReqFunctions.afterUnlinkAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountApple) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkcustom":
					afterReqFunctions.afterUnlinkCustomFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountCustom) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkdevice":
					afterReqFunctions.afterUnlinkDeviceFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountDevice) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkemail":
					afterReqFunctions.afterUnlinkEmailFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountEmail) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkfacebook":
					afterReqFunctions.afterUnlinkFacebookFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebook) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkfacebookinstantgame":
					afterReqFunctions.afterUnlinkFacebookInstantGameFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountFacebookInstantGame) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkgamecenter":
					afterReqFunctions.afterUnlinkGameCenterFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGameCenter) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinkgoogle":
					afterReqFunctions.afterUnlinkGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountGoogle) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "unlinksteam":
					afterReqFunctions.afterUnlinkSteamFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.AccountSteam) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				case "getusers":
					afterReqFunctions.afterGetUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.Users, in *api.GetUsersRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "event":
					afterReqFunctions.afterEventFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.Event) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, in)
					}
				}
			}
		case RuntimeExecutionModeMatchmaker:
			matchmakerMatchedFunction = func(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
				return runtimeProviderJS.MatchmakerMatched(ctx, entries)
			}
		case RuntimeExecutionModeTournamentEnd:
			tournamentEndFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderJS.TournamentEnd(ctx, tournament, end, reset)
			}
		case RuntimeExecutionModeTournamentReset:
			tournamentResetFunction = func(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
				return runtimeProviderJS.TournamentReset(ctx, tournament, end, reset)
			}
		case RuntimeExecutionModeLeaderboardReset:
			leaderboardResetFunction = func(ctx context.Context, leaderboard runtime.Leaderboard, reset int64) error {
				return runtimeProviderJS.LeaderboardReset(ctx, leaderboard, reset)
			}
		}
	}, false)
	if err != nil {
		logger.Error("Failed to eval JavaScript modules.", zap.Error(err))
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
	}

	matchProvider.RegisterCreateFn("javascript",
		func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
			mc := matchHandlers.Get(name)
			if mc == nil {
				return nil, nil
			}

			return NewRuntimeJavascriptMatchCore(logger, name, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, localCache, leaderboardScheduler, sessionRegistry, sessionCache, matchRegistry, tracker, streamManager, router, matchProvider.CreateMatch, eventFn, id, node, stopped, mc, modCache)
		})

	runtimeProviderJS.newFn = func() *RuntimeJS {
		runtime := goja.New()

		runtime.RunProgram(modCache.Modules[modCache.Names[0]].Program)

		jsLoggerInst, err := NewJsLogger(runtime, logger)
		if err != nil {
			logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
		}

		nakamaModule := NewRuntimeJavascriptNakamaModule(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, localCache, leaderboardScheduler, sessionRegistry, sessionCache, matchRegistry, tracker, streamManager, router, eventFn, matchProvider.CreateMatch)
		nk := runtime.ToValue(nakamaModule.Constructor(runtime))
		nkInst, err := runtime.New(nk)
		if err != nil {
			logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
		}

		return &RuntimeJS{
			logger:       logger,
			jsLoggerInst: jsLoggerInst,
			nkInst:       nkInst,
			node:         config.GetName(),
			vm:           runtime,
			env:          runtime.ToValue(config.GetRuntime().Environment),
			callbacks:    callbacks,
		}
	}

	startupLogger.Info("JavaScript runtime modules loaded")

	// Warm up the pool.
	startupLogger.Info("Allocating minimum JavaScript runtime pool", zap.Int("count", config.GetRuntime().JsMinCount))
	if len(modCache.Names) > 0 {
		// Only if there are runtime modules to load.
		for i := 0; i < config.GetRuntime().JsMinCount; i++ {
			runtimeProviderJS.poolCh <- runtimeProviderJS.newFn()
		}
		runtimeProviderJS.metrics.GaugeJsRuntimes(float64(config.GetRuntime().JsMinCount))
	}
	startupLogger.Info("Allocated minimum JavaScript runtime pool")

	return modCache.Names, rpcFunctions, beforeRtFunctions, afterRtFunctions, beforeReqFunctions, afterReqFunctions, matchmakerMatchedFunction, tournamentEndFunction, tournamentResetFunction, leaderboardResetFunction, nil
}

func CheckRuntimeProviderJavascript(logger *zap.Logger, config Config) error {
	modCache, err := cacheJavascriptModules(logger, config.GetRuntime().Path, config.GetRuntime().JsEntrypoint)
	if err != nil {
		return err
	}
	rp := &RuntimeProviderJS{
		logger: logger,
		config: config,
	}
	_, _, err = evalRuntimeModules(rp, modCache, nil, nil, nil, func(RuntimeExecutionMode, string) {}, true)
	if err != nil {
		logger.Error("Failed to load JavaScript module.", zap.Error(err))
	}
	return err
}

func cacheJavascriptModules(logger *zap.Logger, path, entrypoint string) (*RuntimeJSModuleCache, error) {
	moduleCache := &RuntimeJSModuleCache{
		Names:   make([]string, 0),
		Modules: make(map[string]*RuntimeJSModule),
	}

	var absEntrypoint string
	if entrypoint == "" {
		// If entrypoint is not set, look for index.js file in path; skip if not found.
		absEntrypoint = filepath.Join(path, JsEntrypointFilename)
		if _, err := os.Stat(absEntrypoint); os.IsNotExist(err) {
			return moduleCache, nil
		}
	} else {
		absEntrypoint = filepath.Join(path, entrypoint)
	}

	var content []byte
	var err error
	if content, err = ioutil.ReadFile(absEntrypoint); err != nil {
		logger.Error("Could not read JavaScript module", zap.String("entrypoint", absEntrypoint), zap.Error(err))
		return nil, err
	}

	modName := filepath.Base(entrypoint)
	ast, _ := goja.Parse(modName, string(content))
	prg, err := goja.Compile(modName, string(content), true)
	if err != nil {
		logger.Error("Could not compile JavaScript module", zap.String("module", modName), zap.Error(err))
		return nil, err
	}

	moduleCache.Add(&RuntimeJSModule{
		Name:    modName,
		Path:    absEntrypoint,
		Program: prg,
		Ast:     ast,
	})

	return moduleCache, nil
}

func (rp *RuntimeProviderJS) MatchmakerMatched(ctx context.Context, entries []*MatchmakerEntry) (string, bool, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return "", false, err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeMatchmaker, "")
	if jsFn == "" {
		rp.Put(r)
		return "", false, errors.New("Runtime Matchmaker Matched function not found.")
	}

	entriesSlice := make([]interface{}, 0, len(entries))
	for _, e := range entries {
		presenceObj := r.vm.NewObject()
		presenceObj.Set("userId", e.Presence.UserId)
		presenceObj.Set("sessionId", e.Presence.SessionId)
		presenceObj.Set("username", e.Presence.Username)
		presenceObj.Set("node", e.Presence.Node)

		propertiesObj := r.vm.NewObject()
		for k, v := range e.StringProperties {
			propertiesObj.Set(k, v)
		}
		for k, v := range e.NumericProperties {
			propertiesObj.Set(k, v)
		}

		entry := r.vm.NewObject()
		entry.Set("presence", presenceObj)
		entry.Set("properties", propertiesObj)

		entriesSlice = append(entriesSlice, entry)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return "", false, errors.New("Could not run matchmaker matched hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeMatchmaker.String()))
	if err != nil {
		r.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return "", false, errors.New("Could not run matchmaker matched hook.")
	}

	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeMatchmaker, "matchmakerMatched", fn, jsLogger, nil, "", "", nil, 0, "", "", "", r.vm.ToValue(entriesSlice))
	rp.Put(r)

	if retValue == nil {
		// No return value or hook decided not to return an authoritative match ID.
		return "", false, nil
	}

	retString, ok := retValue.(string)
	if ok {
		matchIDComponents := strings.SplitN(retString, ".", 2)
		if len(matchIDComponents) != 2 {
			return "", false, errors.New("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
		}
		_, err = uuid.FromString(matchIDComponents[0])
		if err != nil {
			return "", false, errors.New("Invalid return value from runtime Matchmaker Matched hook, not a valid match ID.")
		}

		return retString, true, nil
	}

	return "", false, errors.New("Unexpected return type from runtime Matchmaker Matched hook, must be string, null or undefined.")
}

func (rp *RuntimeProviderJS) TournamentEnd(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeTournamentEnd, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Tournament End function not found.")
	}

	tournamentObj := r.vm.NewObject()
	tournamentObj.Set("id", tournament.Id)
	tournamentObj.Set("id", tournament.Id)
	tournamentObj.Set("title", tournament.Title)
	tournamentObj.Set("description", tournament.Description)
	tournamentObj.Set("category", tournament.Category)
	if tournament.SortOrder == LeaderboardSortOrderAscending {
		tournamentObj.Set("sortOrder", "asc")
	} else {
		tournamentObj.Set("sortOrder", "desc")
	}
	tournamentObj.Set("size", tournament.Size)
	tournamentObj.Set("maxSize", tournament.MaxSize)
	tournamentObj.Set("maxNumScore", tournament.MaxNumScore)
	tournamentObj.Set("duration", tournament.Duration)
	tournamentObj.Set("startActive", tournament.StartActive)
	tournamentObj.Set("endActive", tournament.EndActive)
	tournamentObj.Set("canEnter", tournament.CanEnter)
	tournamentObj.Set("nextReset", tournament.NextReset)
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	tournamentObj.Set("metadata", metadataMap)
	tournamentObj.Set("createTime", tournament.CreateTime.Seconds)
	tournamentObj.Set("startTime", tournament.StartTime.Seconds)
	if tournament.EndTime == nil {
		tournamentObj.Set("endTime", goja.Null())
	} else {
		tournamentObj.Set("endTime", tournament.EndTime.Seconds)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run tournament end hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeTournamentEnd.String()))
	if err != nil {
		r.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run tournament end hook.")
	}

	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeTournamentEnd, "tournamentEnd", fn, jsLogger, nil, "", "", nil, 0, "", "", "", tournamentObj, r.vm.ToValue(end), r.vm.ToValue(reset))
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament End hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament End hook, must be null or undefined.")
}

func (rp *RuntimeProviderJS) TournamentReset(ctx context.Context, tournament *api.Tournament, end, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeTournamentReset, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Tournament Reset function not found.")
	}

	tournamentObj := r.vm.NewObject()
	tournamentObj.Set("id", tournament.Id)
	tournamentObj.Set("id", tournament.Id)
	tournamentObj.Set("title", tournament.Title)
	tournamentObj.Set("description", tournament.Description)
	tournamentObj.Set("category", tournament.Category)
	if tournament.SortOrder == LeaderboardSortOrderAscending {
		tournamentObj.Set("sortOrder", "asc")
	} else {
		tournamentObj.Set("sortOrder", "desc")
	}
	tournamentObj.Set("size", tournament.Size)
	tournamentObj.Set("maxSize", tournament.MaxSize)
	tournamentObj.Set("maxNumScore", tournament.MaxNumScore)
	tournamentObj.Set("duration", tournament.Duration)
	tournamentObj.Set("startActive", tournament.StartActive)
	tournamentObj.Set("endActive", tournament.EndActive)
	tournamentObj.Set("canEnter", tournament.CanEnter)
	tournamentObj.Set("nextReset", tournament.NextReset)
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	tournamentObj.Set("metadata", metadataMap)
	tournamentObj.Set("createTime", tournament.CreateTime.Seconds)
	tournamentObj.Set("startTime", tournament.StartTime.Seconds)
	if tournament.EndTime == nil {
		tournamentObj.Set("endTime", goja.Null())
	} else {
		tournamentObj.Set("endTime", tournament.EndTime.Seconds)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run tournament reset hook")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeTournamentReset.String()))
	if err != nil {
		r.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run tournament reset hook.")
	}

	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeTournamentReset, "tournamentReset", fn, jsLogger, nil, "", "", nil, 0, "", "", "", tournamentObj, r.vm.ToValue(end), r.vm.ToValue(reset))
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament Reset hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament Reset hook, must be null or undefined.")
}

func (rp *RuntimeProviderJS) LeaderboardReset(ctx context.Context, leaderboard runtime.Leaderboard, reset int64) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeLeaderboardReset, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Leaderboard Reset function not found.")
	}

	leaderboardObj := r.vm.NewObject()
	leaderboardObj.Set("id", leaderboard.GetId())
	leaderboardObj.Set("authoritative", leaderboard.GetAuthoritative())
	leaderboardObj.Set("sortOrder", leaderboard.GetSortOrder())
	leaderboardObj.Set("operator", leaderboard.GetOperator())
	leaderboardObj.Set("reset", leaderboard.GetReset())
	leaderboardObj.Set("metadata", leaderboard.GetMetadata())
	leaderboardObj.Set("createTime", leaderboard.GetCreateTime())

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run leaderboard reset hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeLeaderboardReset.String()))
	if err != nil {
		r.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run leaderboard reset hook.")
	}

	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeLeaderboardReset, "leaderboardReset", fn, jsLogger, nil, "", "", nil, 0, "", "", "", leaderboardObj, r.vm.ToValue(reset))
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Leaderboard Reset hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Leaderboard Reset hook, must be nil.")
}

func evalRuntimeModules(rp *RuntimeProviderJS, modCache *RuntimeJSModuleCache, matchProvider *MatchProvider, leaderboardScheduler LeaderboardScheduler, localCache *RuntimeJavascriptLocalCache, announceCallbackFn func(RuntimeExecutionMode, string), dryRun bool) (*RuntimeJavascriptCallbacks, *RuntimeJavascriptMatchHandlers, error) {
	logger := rp.logger

	r := goja.New()

	callbacks := &RuntimeJavascriptCallbacks{
		Rpc:    make(map[string]string),
		Before: make(map[string]string),
		After:  make(map[string]string),
	}

	matchHandlers := &RuntimeJavascriptMatchHandlers{
		mapping: make(map[string]*jsMatchHandlers, 0),
	}

	// TODO: refactor modCache
	if len(modCache.Names) == 0 {
		// There are no JS runtime modules to run.
		return callbacks, matchHandlers, nil
	}
	modName := modCache.Names[0]

	initializer := NewRuntimeJavascriptInitModule(logger, modCache.Modules[modName].Ast, callbacks, matchHandlers, announceCallbackFn)
	initializerValue := r.ToValue(initializer.Constructor(r))
	initializerInst, err := r.New(initializerValue)
	if err != nil {
		return nil, nil, err
	}

	jsLoggerInst, err := NewJsLogger(r, logger)
	if err != nil {
		return nil, nil, err
	}

	nakamaModule := NewRuntimeJavascriptNakamaModule(rp.logger, rp.db, rp.protojsonMarshaler, rp.protojsonUnmarshaler, rp.config, rp.socialClient, rp.leaderboardCache, rp.leaderboardRankCache, localCache, leaderboardScheduler, rp.sessionRegistry, rp.sessionCache, rp.matchRegistry, rp.tracker, rp.streamManager, rp.router, rp.eventFn, matchProvider.CreateMatch)
	nk := r.ToValue(nakamaModule.Constructor(r))
	nkInst, err := r.New(nk)
	if err != nil {
		return nil, nil, err
	}

	_, err = r.RunProgram(modCache.Modules[modName].Program)
	if err != nil {
		return nil, nil, err
	}

	initMod := r.Get("InitModule")
	initModFn, ok := goja.AssertFunction(initMod)
	if !ok {
		logger.Error("InitModule function not found. Function must be defined at top level.", zap.String("module", modName))
		return nil, nil, errors.New(INIT_MODULE_FN_NAME + " function not found.")
	}

	if dryRun {
		// Parse JavaScript code for syntax errors but do not execute the InitModule function.
		return nil, nil, nil
	}

	// Execute init module function
	ctx := NewRuntimeJsInitContext(r, rp.config.GetName(), rp.config.GetRuntime().Environment)
	_, err = initModFn(goja.Null(), ctx, jsLoggerInst, nkInst, initializerInst)
	if err != nil {
		if exErr, ok := err.(*goja.Exception); ok {
			return nil, nil, errors.New(exErr.String())
		}
		return nil, nil, err
	}

	return initializer.Callbacks, initializer.MatchCallbacks, nil
}
