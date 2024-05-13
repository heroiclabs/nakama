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
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja/ast"
	"github.com/gofrs/uuid/v5"
	"github.com/heroiclabs/nakama-common/api"
	"github.com/heroiclabs/nakama-common/rtapi"
	"github.com/heroiclabs/nakama/v3/social"
	"go.uber.org/atomic"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

const JsEntrypointFilename = "index.js"

type RuntimeJS struct {
	logger       *zap.Logger
	node         string
	version      string
	nkInst       goja.Value
	jsLoggerInst goja.Value
	env          goja.Value
	vm           *goja.Runtime
	nakamaModule *runtimeJavascriptNakamaModule
	callbacks    *RuntimeJavascriptCallbacks
}

func (r *RuntimeJS) SetContext(ctx context.Context) {
	r.nakamaModule.ctx = ctx
}

func (r *RuntimeJS) GetCallback(e RuntimeExecutionMode, key string) string {
	switch e {
	case RuntimeExecutionModeRPC:
		fnId, ok := r.callbacks.Rpc[key]
		if !ok {
			return ""
		}
		return fnId
	case RuntimeExecutionModeBefore:
		fnId, ok := r.callbacks.Before[key]
		if !ok {
			return ""
		}
		return fnId
	case RuntimeExecutionModeAfter:
		fnId, ok := r.callbacks.After[key]
		if !ok {
			return ""
		}
		return fnId
	case RuntimeExecutionModeMatchmaker:
		return r.callbacks.Matchmaker
	case RuntimeExecutionModeTournamentEnd:
		return r.callbacks.TournamentEnd
	case RuntimeExecutionModeTournamentReset:
		return r.callbacks.TournamentReset
	case RuntimeExecutionModeLeaderboardReset:
		return r.callbacks.LeaderboardReset
	case RuntimeExecutionModeShutdown:
		return r.callbacks.Shutdown
	case RuntimeExecutionModePurchaseNotificationApple:
		return r.callbacks.PurchaseNotificationApple
	case RuntimeExecutionModeSubscriptionNotificationApple:
		return r.callbacks.SubscriptionNotificationApple
	case RuntimeExecutionModePurchaseNotificationGoogle:
		return r.callbacks.PurchaseNotificationGoogle
	case RuntimeExecutionModeSubscriptionNotificationGoogle:
		return r.callbacks.SubscriptionNotificationGoogle
	case RuntimeExecutionModeStorageIndexFilter:
		fnId, ok := r.callbacks.StorageIndexFilter[key]
		if !ok {
			return ""
		}
		return fnId
	}

	return ""
}

type jsError struct {
	StackTrace string `json:"stackTrace,omitempty"`
	custom     bool
	error      error
}

func (e *jsError) Error() string {
	return e.error.Error()
}

func newJsError(error error, stackTrace string, custom bool) *jsError {
	return &jsError{
		error:      error,
		custom:     custom,
		StackTrace: stackTrace,
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
	version              string
	socialClient         *social.Client
	leaderboardCache     LeaderboardCache
	leaderboardRankCache LeaderboardRankCache
	sessionRegistry      SessionRegistry
	sessionCache         SessionCache
	statusRegistry       StatusRegistry
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
	metrics              Metrics
	storageIndex         StorageIndex
}

func (rp *RuntimeProviderJS) Rpc(ctx context.Context, id string, headers, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code) {
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
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return "", errors.New("Could not run Rpc function."), codes.Internal
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("rpc_id", id))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return "", errors.New("Could not run Rpc function."), codes.Internal
	}
	r.SetContext(ctx)
	retValue, err, code := r.InvokeFunction(RuntimeExecutionModeRPC, id, fn, jsLogger, headers, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, payload)
	r.SetContext(context.Background())
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

func (rp *RuntimeProviderJS) BeforeRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
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
		rp.Put(r)
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeBefore.String()))
	if err != nil {
		rp.Put(r)
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return nil, errors.New("Could not run runtime Before function.")
	}
	r.SetContext(ctx)
	result, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeBefore, id, fn, jsLogger, nil, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, envelopeMap)
	r.SetContext(context.Background())
	rp.Put(r)

	if fnErr != nil {
		if jsErr, ok := fnErr.(*jsError); ok {
			if !jsErr.custom {
				logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(fnErr))
			}
		}
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

func (rp *RuntimeProviderJS) AfterRt(ctx context.Context, id string, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, out, in *rtapi.Envelope) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeAfter, id)
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime After function not found.")
	}

	var outMap map[string]interface{}
	if out != nil {
		outJSON, err := rp.protojsonMarshaler.Marshal(out)
		if err != nil {
			rp.Put(r)
			logger.Error("Could not marshall envelope to JSON", zap.Any("out", out), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
		if err := json.Unmarshal([]byte(outJSON), &outMap); err != nil {
			rp.Put(r)
			logger.Error("Could not unmarshall envelope to interface{}", zap.Any("out_json", outJSON), zap.Error(err))
			return errors.New("Could not run runtime After function.")
		}
	}

	inJSON, err := rp.protojsonMarshaler.Marshal(in)
	if err != nil {
		rp.Put(r)
		logger.Error("Could not marshall envelope to JSON", zap.Any("in", in), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	var inMap map[string]interface{}
	if err := json.Unmarshal([]byte(inJSON), &inMap); err != nil {
		rp.Put(r)
		logger.Error("Could not unmarshall envelope to interface{}", zap.Any("in_json", inJSON), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, RTAPI_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeAfter.String()))
	if err != nil {
		rp.Put(r)
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	r.SetContext(ctx)
	_, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeAfter, id, fn, jsLogger, nil, nil, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, outMap, inMap)
	r.SetContext(context.Background())
	rp.Put(r)

	if fnErr != nil {
		if jsErr, ok := fnErr.(*jsError); ok {
			if !jsErr.custom {
				logger.Error("Runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
			}
		}
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
		rp.Put(r)
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}

	jsLogger, err := NewJsLogger(r.vm, logger, zap.String("api_id", strings.TrimPrefix(id, API_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeBefore.String()))
	if err != nil {
		rp.Put(r)
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return nil, errors.New("Could not run runtime Before function."), codes.Internal
	}
	r.SetContext(ctx)
	result, fnErr, code := r.InvokeFunction(RuntimeExecutionModeBefore, id, fn, jsLogger, nil, nil, userID, username, vars, expiry, "", clientIP, clientPort, "", reqMap)
	r.SetContext(context.Background())
	rp.Put(r)

	if fnErr != nil {
		if jsErr, ok := fnErr.(*jsError); ok {
			if !jsErr.custom {
				logger.Error("Runtime Before function caused an error.", zap.String("id", id), zap.Error(err))
			}
		}
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
		rp.Put(r)
		logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("api_id", strings.TrimPrefix(id, API_PREFIX_LOWERCASE)), zap.String("mode", RuntimeExecutionModeAfter.String()))
	if err != nil {
		rp.Put(r)
		logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run runtime After function.")
	}
	r.SetContext(ctx)
	_, fnErr, _ := r.InvokeFunction(RuntimeExecutionModeAfter, id, fn, jsLogger, nil, nil, userID, username, vars, expiry, "", clientIP, clientPort, "", resMap, reqMap)
	r.SetContext(context.Background())
	rp.Put(r)

	if fnErr != nil {
		if jsErr, ok := fnErr.(*jsError); ok {
			if !jsErr.custom {
				logger.Error("JavaScript runtime After function caused an error.", zap.String("id", id), zap.Error(fnErr))
			}
		}
		return fnErr
	}

	return nil
}

func (r *RuntimeJS) InvokeFunction(execMode RuntimeExecutionMode, id string, fn goja.Callable, logger goja.Value, httpHeaders, queryParams map[string][]string, uid, username string, vars map[string]string, sessionExpiry int64, sid, clientIP, clientPort, lang string, payloads ...interface{}) (interface{}, error, codes.Code) {
	ctx := NewRuntimeJsContext(r.vm, r.node, r.version, r.env, execMode, httpHeaders, queryParams, sessionExpiry, uid, username, vars, sid, clientIP, clientPort, lang)

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
			errMsg := exErr.Error()
			errCode := codes.Internal
			custom := false
			if errMap, ok := exErr.Value().Export().(map[string]interface{}); ok {
				// Custom exception with message and code
				if msg, ok := errMap["message"]; ok {
					if msgStr, ok := msg.(string); ok {
						errMsg = msgStr
						custom = true
					}
				}
				if code, ok := errMap["code"]; ok {
					if codeInt, ok := code.(int64); ok {
						errCode = codes.Code(codeInt)
						custom = true
					}
				}
			}

			if !custom {
				r.logger.Error("JavaScript runtime function raised an uncaught exception", zap.String("mode", execMode.String()), zap.String("id", id), zap.Error(err))
			}
			return nil, newJsError(errors.New(errMsg), exErr.String(), custom), errCode
		}
		r.logger.Error("JavaScript runtime error", zap.String("mode", execMode.String()), zap.String("id", id), zap.Error(err))
		return nil, err, codes.Internal
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

func NewRuntimeProviderJS(ctx context.Context, logger, startupLogger *zap.Logger, db *sql.DB, protojsonMarshaler *protojson.MarshalOptions, protojsonUnmarshaler *protojson.UnmarshalOptions, config Config, version string, socialClient *social.Client, leaderboardCache LeaderboardCache, leaderboardRankCache LeaderboardRankCache, leaderboardScheduler LeaderboardScheduler, sessionRegistry SessionRegistry, sessionCache SessionCache, statusRegistry StatusRegistry, matchRegistry MatchRegistry, tracker Tracker, metrics Metrics, streamManager StreamManager, router MessageRouter, eventFn RuntimeEventCustomFunction, path, entrypoint string, matchProvider *MatchProvider, storageIndex StorageIndex) ([]string, map[string]RuntimeRpcFunction, map[string]RuntimeBeforeRtFunction, map[string]RuntimeAfterRtFunction, *RuntimeBeforeReqFunctions, *RuntimeAfterReqFunctions, RuntimeMatchmakerMatchedFunction, RuntimeTournamentEndFunction, RuntimeTournamentResetFunction, RuntimeLeaderboardResetFunction, RuntimeShutdownFunction, RuntimePurchaseNotificationAppleFunction, RuntimeSubscriptionNotificationAppleFunction, RuntimePurchaseNotificationGoogleFunction, RuntimeSubscriptionNotificationGoogleFunction, map[string]RuntimeStorageIndexFilterFunction, error) {
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

	localCache := NewRuntimeJavascriptLocalCache(ctx)

	runtimeProviderJS := &RuntimeProviderJS{
		config:               config,
		version:              version,
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
		statusRegistry:       statusRegistry,
		tracker:              tracker,
		streamManager:        streamManager,
		router:               router,
		metrics:              metrics,
		poolCh:               make(chan *RuntimeJS, config.GetRuntime().JsMaxCount),
		maxCount:             uint32(config.GetRuntime().JsMaxCount),
		currentCount:         atomic.NewUint32(uint32(config.GetRuntime().JsMinCount)),
		storageIndex:         storageIndex,
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
	var shutdownFunction RuntimeShutdownFunction
	var purchaseNotificationAppleFunction RuntimePurchaseNotificationAppleFunction
	var subscriptionNotificationAppleFunction RuntimeSubscriptionNotificationAppleFunction
	var purchaseNotificationGoogleFunction RuntimePurchaseNotificationGoogleFunction
	var subscriptionNotificationGoogleFunction RuntimeSubscriptionNotificationGoogleFunction
	storageIndexFilterFunctions := make(map[string]RuntimeStorageIndexFilterFunction, 0)

	matchHandlers := &RuntimeJavascriptMatchHandlers{
		mapping: make(map[string]*jsMatchHandlers, 0),
	}

	matchProvider.RegisterCreateFn("javascript",
		func(ctx context.Context, logger *zap.Logger, id uuid.UUID, node string, stopped *atomic.Bool, name string) (RuntimeMatchCore, error) {
			mc := matchHandlers.Get(name)
			if mc == nil {
				return nil, nil
			}

			return NewRuntimeJavascriptMatchCore(logger, name, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, localCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, matchProvider.CreateMatch, eventFn, id, node, version, stopped, mc, modCache, storageIndex)
		})

	callbacks, err := evalRuntimeModules(runtimeProviderJS, modCache, matchHandlers, matchProvider, leaderboardScheduler, storageIndex, localCache, func(mode RuntimeExecutionMode, id string) {
		switch mode {
		case RuntimeExecutionModeRPC:
			rpcFunctions[id] = func(ctx context.Context, headers, queryParams map[string][]string, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang, payload string) (string, error, codes.Code) {
				return runtimeProviderJS.Rpc(ctx, id, headers, queryParams, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, payload)
			}
		case RuntimeExecutionModeBefore:
			if strings.HasPrefix(id, strings.ToLower(RTAPI_PREFIX)) {
				beforeRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, envelope *rtapi.Envelope) (*rtapi.Envelope, error) {
					return runtimeProviderJS.BeforeRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, envelope)
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
				case "deleteaccount":
					beforeReqFunctions.beforeDeleteAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) (error, codes.Code) {
						_, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil)
						if err != nil {
							return err, code
						}
						return nil, 0
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
				case "demotegroupusers":
					beforeReqFunctions.beforeDemoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) (*api.DemoteGroupUsersRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.DemoteGroupUsersRequest), nil, 0
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
				case "deletenotifications":
					beforeReqFunctions.beforeDeleteNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) (*api.DeleteNotificationsRequest, error, codes.Code) {
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
				case "validatepurchaseapple":
					beforeReqFunctions.beforeValidatePurchaseAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseAppleRequest) (*api.ValidatePurchaseAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseAppleRequest), nil, 0
					}
				case "validatepurchasegoogle":
					beforeReqFunctions.beforeValidatePurchaseGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseGoogleRequest) (*api.ValidatePurchaseGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseGoogleRequest), nil, 0
					}
				case "validatepurchasehuawei":
					beforeReqFunctions.beforeValidatePurchaseHuaweiFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseHuaweiRequest) (*api.ValidatePurchaseHuaweiRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseHuaweiRequest), nil, 0
					}
				case "validatepurchasefacebookinstant":
					beforeReqFunctions.beforeValidatePurchaseFacebookInstantFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidatePurchaseFacebookInstantRequest) (*api.ValidatePurchaseFacebookInstantRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidatePurchaseFacebookInstantRequest), nil, 0
					}
				case "validatesubscriptionapple":
					beforeReqFunctions.beforeValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionAppleRequest) (*api.ValidateSubscriptionAppleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidateSubscriptionAppleRequest), nil, 0
					}
				case "validatesubscriptiongoogle":
					beforeReqFunctions.beforeValidateSubscriptionGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ValidateSubscriptionGoogleRequest) (*api.ValidateSubscriptionGoogleRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ValidateSubscriptionGoogleRequest), nil, 0
					}
				case "getsubscription":
					beforeReqFunctions.beforeGetSubscriptionFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.GetSubscriptionRequest) (*api.GetSubscriptionRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.GetSubscriptionRequest), nil, 0
					}
				case "listsubscriptions":
					beforeReqFunctions.beforeListSubscriptionsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.ListSubscriptionsRequest) (*api.ListSubscriptionsRequest, error, codes.Code) {
						result, err, code := runtimeProviderJS.BeforeReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, in)
						if result == nil || err != nil {
							return nil, err, code
						}
						return result.(*api.ListSubscriptionsRequest), nil, 0
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
				afterRtFunctions[id] = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, sessionID, clientIP, clientPort, lang string, out, in *rtapi.Envelope) error {
					return runtimeProviderJS.AfterRt(ctx, id, logger, userID, username, vars, expiry, sessionID, clientIP, clientPort, lang, out, in)
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
				case "deleteaccount":
					afterReqFunctions.afterDeleteAccountFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, nil, nil)
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
				case "demotegroupusers":
					afterReqFunctions.afterDemoteGroupUsersFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DemoteGroupUsersRequest) error {
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
				case "deletenotifications":
					afterReqFunctions.afterDeleteNotificationsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, in *api.DeleteNotificationsRequest) error {
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
				case "validatepurchaseapple":
					afterReqFunctions.afterValidatePurchaseAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseAppleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasegoogle":
					afterReqFunctions.afterValidatePurchaseGoogleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseGoogleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasehuawei":
					afterReqFunctions.afterValidatePurchaseHuaweiFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseHuaweiRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatepurchasefacebookinstant":
					afterReqFunctions.afterValidatePurchaseFacebookInstantFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatePurchaseResponse, in *api.ValidatePurchaseFacebookInstantRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatesubscriptionapple":
					afterReqFunctions.afterValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "validatesubscriptiongoogle":
					afterReqFunctions.afterValidateSubscriptionAppleFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidateSubscriptionResponse, in *api.ValidateSubscriptionAppleRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "getsubscription":
					afterReqFunctions.afterGetSubscriptionFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.ValidatedSubscription, in *api.GetSubscriptionRequest) error {
						return runtimeProviderJS.AfterReq(ctx, id, logger, userID, username, vars, expiry, clientIP, clientPort, out, in)
					}
				case "listsubscriptions":
					afterReqFunctions.afterListSubscriptionsFunction = func(ctx context.Context, logger *zap.Logger, userID, username string, vars map[string]string, expiry int64, clientIP, clientPort string, out *api.SubscriptionList, in *api.ListSubscriptionsRequest) error {
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
			leaderboardResetFunction = func(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
				return runtimeProviderJS.LeaderboardReset(ctx, leaderboard, reset)
			}
		case RuntimeExecutionModeShutdown:
			shutdownFunction = func(ctx context.Context) {
				runtimeProviderJS.Shutdown(ctx)
			}
		case RuntimeExecutionModePurchaseNotificationApple:
			purchaseNotificationAppleFunction = func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
				return runtimeProviderJS.PurchaseNotificationApple(ctx, purchase, providerPayload)
			}
		case RuntimeExecutionModeSubscriptionNotificationApple:
			subscriptionNotificationAppleFunction = func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
				return runtimeProviderJS.SubscriptionNotificationApple(ctx, subscription, providerPayload)
			}
		case RuntimeExecutionModePurchaseNotificationGoogle:
			purchaseNotificationGoogleFunction = func(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
				return runtimeProviderJS.PurchaseNotificationGoogle(ctx, purchase, providerPayload)
			}
		case RuntimeExecutionModeSubscriptionNotificationGoogle:
			subscriptionNotificationGoogleFunction = func(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
				return runtimeProviderJS.SubscriptionNotificationGoogle(ctx, subscription, providerPayload)
			}
		case RuntimeExecutionModeStorageIndexFilter:
			storageIndexFilterFunctions[id] = func(ctx context.Context, write *StorageOpWrite) (bool, error) {
				return runtimeProviderJS.StorageIndexFilter(ctx, id, write)
			}
		}
	}, false)
	if err != nil {
		logger.Error("Failed to eval JavaScript modules.", zap.Error(err))
		return nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, err
	}

	runtimeProviderJS.newFn = func() *RuntimeJS {
		runtime := goja.New()

		_, err := runtime.RunProgram(modCache.Modules[modCache.Names[0]].Program)
		if err != nil {
			logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
		}
		freezeGlobalObject(config, runtime)

		jsLoggerInst, err := NewJsLogger(runtime, logger)
		if err != nil {
			logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
		}

		nakamaModule := NewRuntimeJavascriptNakamaModule(logger, db, protojsonMarshaler, protojsonUnmarshaler, config, socialClient, leaderboardCache, leaderboardRankCache, storageIndex, localCache, leaderboardScheduler, sessionRegistry, sessionCache, statusRegistry, matchRegistry, tracker, metrics, streamManager, router, eventFn, matchProvider.CreateMatch)
		nk, err := nakamaModule.Constructor(runtime)
		if err != nil {
			logger.Fatal("Failed to initialize JavaScript runtime", zap.Error(err))
		}

		return &RuntimeJS{
			logger:       logger,
			jsLoggerInst: jsLoggerInst,
			nkInst:       nk,
			node:         config.GetName(),
			version:      version,
			vm:           runtime,
			nakamaModule: nakamaModule,
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

	return modCache.Names, rpcFunctions, beforeRtFunctions, afterRtFunctions, beforeReqFunctions, afterReqFunctions, matchmakerMatchedFunction, tournamentEndFunction, tournamentResetFunction, leaderboardResetFunction, shutdownFunction, purchaseNotificationAppleFunction, subscriptionNotificationAppleFunction, purchaseNotificationGoogleFunction, subscriptionNotificationGoogleFunction, storageIndexFilterFunctions, nil
}

func CheckRuntimeProviderJavascript(logger *zap.Logger, config Config, version string) error {
	modCache, err := cacheJavascriptModules(logger, config.GetRuntime().Path, config.GetRuntime().JsEntrypoint)
	if err != nil {
		return err
	}
	rp := &RuntimeProviderJS{
		logger:  logger,
		config:  config,
		version: version,
	}

	matchHandlers := &RuntimeJavascriptMatchHandlers{
		mapping: make(map[string]*jsMatchHandlers, 0),
	}

	_, err = evalRuntimeModules(rp, modCache, matchHandlers, nil, nil, nil, nil, func(RuntimeExecutionMode, string) {}, true)
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
	if content, err = os.ReadFile(absEntrypoint); err != nil {
		logger.Error("Could not read JavaScript module", zap.String("entrypoint", absEntrypoint), zap.Error(err))
		return nil, err
	}

	var modName string
	if entrypoint == "" {
		modName = filepath.Base(JsEntrypointFilename)
	} else {
		modName = filepath.Base(entrypoint)
	}
	modAst, _ := goja.Parse(modName, string(content))
	prg, err := goja.Compile(modName, string(content), true)
	if err != nil {
		logger.Error("Could not compile JavaScript module", zap.String("module", modName), zap.Error(err))
		return nil, err
	}

	moduleCache.Add(&RuntimeJSModule{
		Name:    modName,
		Path:    absEntrypoint,
		Program: prg,
		Ast:     modAst,
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
		_ = presenceObj.Set("userId", e.Presence.UserId)
		_ = presenceObj.Set("sessionId", e.Presence.SessionId)
		_ = presenceObj.Set("username", e.Presence.Username)
		_ = presenceObj.Set("node", e.Presence.Node)

		propertiesObj := r.vm.NewObject()
		for k, v := range e.StringProperties {
			_ = propertiesObj.Set(k, v)
		}
		for k, v := range e.NumericProperties {
			_ = propertiesObj.Set(k, v)
		}

		entry := r.vm.NewObject()
		_ = entry.Set("presence", presenceObj)
		_ = entry.Set("properties", propertiesObj)

		if e.PartyId != "" {
			_ = entry.Set("partyId", e.PartyId)
		}

		entriesSlice = append(entriesSlice, entry)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return "", false, errors.New("Could not run matchmaker matched hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeMatchmaker.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return "", false, errors.New("Could not run matchmaker matched hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeMatchmaker, "matchmakerMatched", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(entriesSlice))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return "", false, fmt.Errorf("Error running runtime Matchmaker Matched hook: %v", err.Error())
	}

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
	_ = tournamentObj.Set("id", tournament.Id)
	_ = tournamentObj.Set("title", tournament.Title)
	_ = tournamentObj.Set("description", tournament.Description)
	_ = tournamentObj.Set("category", tournament.Category)
	_ = tournamentObj.Set("sortOrder", tournament.SortOrder)
	_ = tournamentObj.Set("size", tournament.Size)
	_ = tournamentObj.Set("maxSize", tournament.MaxSize)
	_ = tournamentObj.Set("maxNumScore", tournament.MaxNumScore)
	_ = tournamentObj.Set("duration", tournament.Duration)
	_ = tournamentObj.Set("startActive", tournament.StartActive)
	_ = tournamentObj.Set("endActive", tournament.EndActive)
	_ = tournamentObj.Set("canEnter", tournament.CanEnter)
	if tournament.PrevReset != 0 {
		_ = tournamentObj.Set("prevReset", tournament.PrevReset)
	}
	if tournament.NextReset != 0 {
		_ = tournamentObj.Set("nextReset", tournament.NextReset)
	}
	_ = tournamentObj.Set("operator", strings.ToLower(tournament.Operator.String()))
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	_ = tournamentObj.Set("metadata", metadataMap)
	_ = tournamentObj.Set("createTime", tournament.CreateTime.Seconds)
	_ = tournamentObj.Set("startTime", tournament.StartTime.Seconds)
	if tournament.EndTime == nil {
		_ = tournamentObj.Set("endTime", goja.Null())
	} else {
		_ = tournamentObj.Set("endTime", tournament.EndTime.Seconds)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run tournament end hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeTournamentEnd.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run tournament end hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeTournamentEnd, "tournamentEnd", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", tournamentObj, r.vm.ToValue(end), r.vm.ToValue(reset))
	r.SetContext(context.Background())
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
	_ = tournamentObj.Set("id", tournament.Id)
	_ = tournamentObj.Set("title", tournament.Title)
	_ = tournamentObj.Set("description", tournament.Description)
	_ = tournamentObj.Set("category", tournament.Category)
	_ = tournamentObj.Set("sortOrder", tournament.SortOrder)
	_ = tournamentObj.Set("size", tournament.Size)
	_ = tournamentObj.Set("maxSize", tournament.MaxSize)
	_ = tournamentObj.Set("maxNumScore", tournament.MaxNumScore)
	_ = tournamentObj.Set("duration", tournament.Duration)
	_ = tournamentObj.Set("startActive", tournament.StartActive)
	_ = tournamentObj.Set("endActive", tournament.EndActive)
	_ = tournamentObj.Set("canEnter", tournament.CanEnter)
	if tournament.PrevReset != 0 {
		_ = tournamentObj.Set("prevReset", tournament.PrevReset)
	}
	if tournament.NextReset != 0 {
		_ = tournamentObj.Set("nextReset", tournament.NextReset)
	}
	_ = tournamentObj.Set("operator", strings.ToLower(tournament.Operator.String()))
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(tournament.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	_ = tournamentObj.Set("metadata", metadataMap)
	_ = tournamentObj.Set("createTime", tournament.CreateTime.Seconds)
	_ = tournamentObj.Set("startTime", tournament.StartTime.Seconds)
	if tournament.EndTime == nil {
		_ = tournamentObj.Set("endTime", goja.Null())
	} else {
		_ = tournamentObj.Set("endTime", tournament.EndTime.Seconds)
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run tournament reset hook")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeTournamentReset.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run tournament reset hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeTournamentReset, "tournamentReset", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", tournamentObj, r.vm.ToValue(end), r.vm.ToValue(reset))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Tournament Reset hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Tournament Reset hook, must be null or undefined.")
}

func (rp *RuntimeProviderJS) LeaderboardReset(ctx context.Context, leaderboard *api.Leaderboard, reset int64) error {
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
	_ = leaderboardObj.Set("id", leaderboard.Id)
	_ = leaderboardObj.Set("authoritative", leaderboard.Authoritative)
	_ = leaderboardObj.Set("sortOrder", leaderboard.SortOrder)
	_ = leaderboardObj.Set("operator", strings.ToLower(leaderboard.Operator.String()))
	if leaderboard.PrevReset != 0 {
		_ = leaderboardObj.Set("prevReset", leaderboard.PrevReset)
	}
	if leaderboard.NextReset != 0 {
		_ = leaderboardObj.Set("nextReset", leaderboard.NextReset)
	}
	metadataMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(leaderboard.Metadata), &metadataMap)
	if err != nil {
		rp.Put(r)
		return fmt.Errorf("failed to convert metadata to json: %s", err.Error())
	}
	pointerizeSlices(metadataMap)
	_ = leaderboardObj.Set("metadata", metadataMap)
	_ = leaderboardObj.Set("createTime", leaderboard.CreateTime)

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run leaderboard reset hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeLeaderboardReset.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run leaderboard reset hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeLeaderboardReset, "leaderboardReset", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", leaderboardObj, r.vm.ToValue(reset))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Leaderboard Reset hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Leaderboard Reset hook, must be nil.")
}

func (rp *RuntimeProviderJS) Shutdown(ctx context.Context) {
	r, err := rp.Get(ctx)
	if err != nil {
		return
	}
	jsFn := r.GetCallback(RuntimeExecutionModeShutdown, "")
	if jsFn == "" {
		rp.Put(r)
		rp.logger.Error("Runtime Shutdown function not found.")
		return
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeShutdown.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return
	}

	r.SetContext(ctx)
	_, err, _ = r.InvokeFunction(RuntimeExecutionModeShutdown, "shutdown", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "")
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		rp.logger.Error(fmt.Sprintf("Error running runtime Shutdown hook: %v", err.Error()))
		return
	}
}

func (rp *RuntimeProviderJS) PurchaseNotificationApple(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModePurchaseNotificationApple, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Purchase Notification Apple function not found.")
	}

	purchaseMap := validatedPurchaseToJsObject(purchase)

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run Purchase Notification Apple hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModePurchaseNotificationApple.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run Purchase Notification Apple hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModePurchaseNotificationApple, "purchaseNotificationApple", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(purchaseMap), r.vm.ToValue(providerPayload))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Purchase Notification Apple hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Purchase Notification Apple hook, must be nil.")
}

func (rp *RuntimeProviderJS) SubscriptionNotificationApple(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeSubscriptionNotificationApple, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Subscription Notification Apple function not found.")
	}

	subscriptionMap := subscriptionToJsObject(subscription)

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run Subscription Notification Apple hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeSubscriptionNotificationApple.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run Subscription Notification Apple hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeSubscriptionNotificationApple, "subscriptionNotificationApple", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(subscriptionMap), r.vm.ToValue(providerPayload))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Subscription Notification Apple hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Subscription Notification Apple hook, must be nil.")
}

func (rp *RuntimeProviderJS) PurchaseNotificationGoogle(ctx context.Context, purchase *api.ValidatedPurchase, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModePurchaseNotificationGoogle, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Purchase Notification Google function not found.")
	}

	purchaseMap := validatedPurchaseToJsObject(purchase)

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run Purchase Notification Google hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModePurchaseNotificationGoogle.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run Purchase Notification Google hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModePurchaseNotificationGoogle, "purchaseNotificationGoogle", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(purchaseMap), r.vm.ToValue(providerPayload))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Purchase Notification Google hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Purchase Notification Google hook, must be nil.")
}

func (rp *RuntimeProviderJS) SubscriptionNotificationGoogle(ctx context.Context, subscription *api.ValidatedSubscription, providerPayload string) error {
	r, err := rp.Get(ctx)
	if err != nil {
		return err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeSubscriptionNotificationGoogle, "")
	if jsFn == "" {
		rp.Put(r)
		return errors.New("Runtime Subscription Notification Google function not found.")
	}

	subscriptionMap := subscriptionToJsObject(subscription)

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return errors.New("Could not run Subscription Notification Google hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeSubscriptionNotificationGoogle.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return errors.New("Could not run Subscription Notification Google hook.")
	}

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeSubscriptionNotificationGoogle, "subscriptionNotificationGoogle", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(subscriptionMap), r.vm.ToValue(providerPayload))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return fmt.Errorf("Error running runtime Subscription Notification Google hook: %v", err.Error())
	}

	if retValue == nil {
		return nil
	}

	return errors.New("Unexpected return type from runtime Subscription Notification Google hook, must be nil.")
}

func (rp *RuntimeProviderJS) StorageIndexFilter(ctx context.Context, indexName string, storageWrite *StorageOpWrite) (bool, error) {
	r, err := rp.Get(ctx)
	if err != nil {
		return false, err
	}
	jsFn := r.GetCallback(RuntimeExecutionModeStorageIndexFilter, indexName)
	if jsFn == "" {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return false, errors.New("Could not run Storage Index Filter hook.")
	}

	fn, ok := goja.AssertFunction(r.vm.Get(jsFn))
	if !ok {
		rp.Put(r)
		rp.logger.Error("JavaScript runtime function invalid.", zap.String("key", jsFn), zap.Error(err))
		return false, errors.New("Could not run Storage Index Filter hook.")
	}

	jsLogger, err := NewJsLogger(r.vm, r.logger, zap.String("mode", RuntimeExecutionModeStorageIndexFilter.String()))
	if err != nil {
		rp.Put(r)
		rp.logger.Error("Could not instantiate js logger.", zap.Error(err))
		return false, errors.New("Could not run Storage Index Filter hook.")
	}

	objectMap := make(map[string]interface{}, 7)
	objectMap["key"] = storageWrite.Object.Key
	objectMap["collection"] = storageWrite.Object.Collection
	if storageWrite.OwnerID != "" {
		objectMap["userId"] = storageWrite.OwnerID
	} else {
		objectMap["userId"] = nil
	}
	objectMap["version"] = storageWrite.Object.Version
	objectMap["permissionRead"] = storageWrite.Object.PermissionRead
	objectMap["permissionWrite"] = storageWrite.Object.PermissionWrite

	valueMap := make(map[string]interface{})
	err = json.Unmarshal([]byte(storageWrite.Object.Value), &valueMap)
	if err != nil {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: %v", indexName, err.Error())
	}
	pointerizeSlices(valueMap)
	objectMap["value"] = valueMap

	r.SetContext(ctx)
	retValue, err, _ := r.InvokeFunction(RuntimeExecutionModeStorageIndexFilter, "storageIndexFilter", fn, jsLogger, nil, nil, "", "", nil, 0, "", "", "", "", r.vm.ToValue(objectMap))
	r.SetContext(context.Background())
	rp.Put(r)
	if err != nil {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: %v", indexName, err.Error())
	}

	if retValue == nil {
		return false, errors.New("Invalid return type for Storage Index Filter function: bool expected")
	}

	filterResult, ok := retValue.(bool)
	if !ok {
		return false, fmt.Errorf("Error running runtime Storage Index Filter hook for %q index: failed to assert js fn expected return type", indexName)
	}

	return filterResult, nil
}

func evalRuntimeModules(rp *RuntimeProviderJS, modCache *RuntimeJSModuleCache, matchHandlers *RuntimeJavascriptMatchHandlers, matchProvider *MatchProvider, leaderboardScheduler LeaderboardScheduler, storageIndex StorageIndex, localCache *RuntimeJavascriptLocalCache, announceCallbackFn func(RuntimeExecutionMode, string), dryRun bool) (*RuntimeJavascriptCallbacks, error) {
	logger := rp.logger

	r := goja.New()

	callbacks := &RuntimeJavascriptCallbacks{
		Rpc:                make(map[string]string),
		Before:             make(map[string]string),
		After:              make(map[string]string),
		StorageIndexFilter: make(map[string]string),
	}

	if len(modCache.Names) == 0 {
		// There are no JS runtime modules to run.
		return callbacks, nil
	}
	modName := modCache.Names[0]

	initializer := NewRuntimeJavascriptInitModule(logger, modCache.Modules[modName].Ast, storageIndex, callbacks, matchHandlers, announceCallbackFn)
	init, err := initializer.Constructor(r)
	if err != nil {
		return nil, err
	}

	jsLoggerInst, err := NewJsLogger(r, logger)
	if err != nil {
		return nil, err
	}

	nakamaModule := NewRuntimeJavascriptNakamaModule(rp.logger, rp.db, rp.protojsonMarshaler, rp.protojsonUnmarshaler, rp.config, rp.socialClient, rp.leaderboardCache, rp.leaderboardRankCache, storageIndex, localCache, leaderboardScheduler, rp.sessionRegistry, rp.sessionCache, rp.statusRegistry, rp.matchRegistry, rp.tracker, rp.metrics, rp.streamManager, rp.router, rp.eventFn, matchProvider.CreateMatch)
	nk, err := nakamaModule.Constructor(r)
	if err != nil {
		return nil, err
	}

	_, err = r.RunProgram(modCache.Modules[modName].Program)
	if err != nil {
		return nil, err
	}

	initMod := r.Get("InitModule")
	initModFn, ok := goja.AssertFunction(initMod)
	if !ok {
		logger.Error("InitModule function not found. Function must be defined at top level.", zap.String("module", modName))
		return nil, errors.New(INIT_MODULE_FN_NAME + " function not found.")
	}

	if dryRun {
		// Parse JavaScript code for syntax errors but do not execute the InitModule function.
		return nil, nil
	}

	// Execute init module function
	ctx := NewRuntimeJsInitContext(r, rp.config.GetName(), rp.version, rp.config.GetRuntime().Environment)
	_, err = initModFn(goja.Null(), ctx, jsLoggerInst, nk, init)
	if err != nil {
		if exErr, ok := err.(*goja.Exception); ok {
			return nil, errors.New(exErr.String())
		}
		return nil, err
	}

	return initializer.Callbacks, nil
}

// Equivalent to calling freeze on the JavaScript global object making it immutable
// https://github.com/dop251/goja/issues/362
func freezeGlobalObject(config Config, r *goja.Runtime) {
	if !config.GetRuntime().JsReadOnlyGlobals {
		return
	}
	_, _ = r.RunString(`
for (const k of Reflect.ownKeys(globalThis)) {
    const v = globalThis[k];
    if (v) {
        Object.freeze(v);
        v.prototype && Object.freeze(v.prototype);
        v.__proto__ && Object.freeze(v.__proto__);
    }
}
`)
}

// Profile responds with the pprof-formatted cpu profile.
// Profiling lasts for duration specified in seconds GET parameter, or for 30 seconds if not specified.
// https://github.com/dop251/goja/blob/master/profiler.go#L271
func ProfileGoja(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	sec, err := strconv.ParseInt(r.FormValue("seconds"), 10, 64)
	if sec <= 0 || err != nil {
		sec = 30
	}

	if durationExceedsWriteTimeout(r, float64(sec)) {
		serveError(w, http.StatusBadRequest, "profile duration exceeds server's WriteTimeout")
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="profile"`)
	if err := goja.StartProfile(w); err != nil {
		// StartCPUProfile failed, so no writes yet.
		serveError(w, http.StatusInternalServerError,
			fmt.Sprintf("Could not enable CPU profiling: %s", err))
		return
	}

	sleep(r, time.Duration(sec)*time.Second)
	goja.StopProfile()
}

func durationExceedsWriteTimeout(r *http.Request, seconds float64) bool {
	srv, ok := r.Context().Value(http.ServerContextKey).(*http.Server)
	return ok && srv.WriteTimeout != 0 && seconds >= srv.WriteTimeout.Seconds()
}

func serveError(w http.ResponseWriter, status int, txt string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("X-Go-Pprof", "1")
	w.Header().Del("Content-Disposition")
	w.WriteHeader(status)
	fmt.Fprintln(w, txt)
}

func sleep(r *http.Request, d time.Duration) {
	select {
	case <-time.After(d):
	case <-r.Context().Done():
	}
}
