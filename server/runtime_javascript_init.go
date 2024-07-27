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
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/dop251/goja"
	"github.com/dop251/goja/ast"
	"go.uber.org/zap"
)

const INIT_MODULE_FN_NAME = "InitModule"

var inlinedFunctionError = errors.New("function literal found: javascript functions cannot be inlined")

type RuntimeJavascriptMatchHandlers struct {
	sync.RWMutex
	mapping map[string]*jsMatchHandlers
}

func (rmh *RuntimeJavascriptMatchHandlers) Add(name string, handlers *jsMatchHandlers) {
	rmh.Lock()
	rmh.mapping[name] = handlers
	rmh.Unlock()
}

func (rmh *RuntimeJavascriptMatchHandlers) Get(name string) *jsMatchHandlers {
	var handlers *jsMatchHandlers
	rmh.RLock()
	handlers = rmh.mapping[name]
	rmh.RUnlock()

	return handlers
}

type jsMatchHandlers struct {
	initFn        string
	joinAttemptFn string
	joinFn        string
	leaveFn       string
	loopFn        string
	terminateFn   string
	signalFn      string
}

type RuntimeJavascriptCallbacks struct {
	Rpc                            map[string]string
	Before                         map[string]string
	After                          map[string]string
	StorageIndexFilter             map[string]string
	Matchmaker                     string
	TournamentEnd                  string
	TournamentReset                string
	LeaderboardReset               string
	Shutdown                       string
	PurchaseNotificationApple      string
	SubscriptionNotificationApple  string
	PurchaseNotificationGoogle     string
	SubscriptionNotificationGoogle string
}

type RuntimeJavascriptInitModule struct {
	Logger             *zap.Logger
	Callbacks          *RuntimeJavascriptCallbacks
	MatchCallbacks     *RuntimeJavascriptMatchHandlers
	announceCallbackFn func(RuntimeExecutionMode, string)
	storageIndex       StorageIndex
	ast                *ast.Program
}

func NewRuntimeJavascriptInitModule(logger *zap.Logger, ast *ast.Program, storageIndex StorageIndex, callbacks *RuntimeJavascriptCallbacks, matchCallbacks *RuntimeJavascriptMatchHandlers, announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeJavascriptInitModule {
	return &RuntimeJavascriptInitModule{
		Logger:             logger,
		storageIndex:       storageIndex,
		announceCallbackFn: announceCallbackFn,
		Callbacks:          callbacks,
		MatchCallbacks:     matchCallbacks,
		ast:                ast,
	}
}

func (im *RuntimeJavascriptInitModule) mappings(r *goja.Runtime) map[string]func(goja.FunctionCall) goja.Value {
	return map[string]func(goja.FunctionCall) goja.Value{
		"registerRpc":                                     im.registerRpc(r),
		"registerRtBefore":                                im.registerRtBefore(r),
		"registerRtAfter":                                 im.registerRtAfter(r),
		"registerMatchmakerMatched":                       im.registerMatchmakerMatched(r),
		"registerTournamentEnd":                           im.registerTournamentEnd(r),
		"registerTournamentReset":                         im.registerTournamentReset(r),
		"registerLeaderboardReset":                        im.registerLeaderboardReset(r),
		"registerShutdown":                                im.registerShutdown(r),
		"registerPurchaseNotificationApple":               im.registerPurchaseNotificationApple(r),
		"registerSubscriptionNotificationApple":           im.registerSubscriptionNotificationApple(r),
		"registerPurchaseNotificationGoogle":              im.registerPurchaseNotificationGoogle(r),
		"registerSubscriptionNotificationGoogle":          im.registerSubscriptionNotificationGoogle(r),
		"registerMatch":                                   im.registerMatch(r),
		"registerBeforeGetAccount":                        im.registerBeforeGetAccount(r),
		"registerAfterGetAccount":                         im.registerAfterGetAccount(r),
		"registerBeforeGetMatchmakerStats":                im.registerBeforeGetMatchmakerStats(r),
		"registerAfterGetMatchmakerStats":                 im.registerAfterGetMatchmakerStats(r),
		"registerBeforeUpdateAccount":                     im.registerBeforeUpdateAccount(r),
		"registerAfterUpdateAccount":                      im.registerAfterUpdateAccount(r),
		"registerBeforeDeleteAccount":                     im.registerBeforeDeleteAccount(r),
		"registerAfterDeleteAccount":                      im.registerAfterDeleteAccount(r),
		"registerBeforeAuthenticateApple":                 im.registerBeforeAuthenticateApple(r),
		"registerAfterAuthenticateApple":                  im.registerAfterAuthenticateApple(r),
		"registerBeforeAuthenticateCustom":                im.registerBeforeAuthenticateCustom(r),
		"registerAfterAuthenticateCustom":                 im.registerAfterAuthenticateCustom(r),
		"registerBeforeAuthenticateDevice":                im.registerBeforeAuthenticateDevice(r),
		"registerAfterAuthenticateDevice":                 im.registerAfterAuthenticateDevice(r),
		"registerBeforeAuthenticateEmail":                 im.registerBeforeAuthenticateEmail(r),
		"registerAfterAuthenticateEmail":                  im.registerAfterAuthenticateEmail(r),
		"registerBeforeAuthenticateFacebook":              im.registerBeforeAuthenticateFacebook(r),
		"registerAfterAuthenticateFacebook":               im.registerAfterAuthenticateFacebook(r),
		"registerBeforeAuthenticateFacebookInstantGame":   im.registerBeforeAuthenticateFacebookInstantGame(r),
		"registerAfterAuthenticateFacebookInstantGame":    im.registerAfterAuthenticateFacebookInstantGame(r),
		"registerBeforeAuthenticateGameCenter":            im.registerBeforeAuthenticateGameCenter(r),
		"registerAfterAuthenticateGameCenter":             im.registerAfterAuthenticateGameCenter(r),
		"registerBeforeAuthenticateGoogle":                im.registerBeforeAuthenticateGoogle(r),
		"registerAfterAuthenticateGoogle":                 im.registerAfterAuthenticateGoogle(r),
		"registerBeforeAuthenticateSteam":                 im.registerBeforeAuthenticateSteam(r),
		"registerAfterAuthenticateSteam":                  im.registerAfterAuthenticateSteam(r),
		"registerBeforeListChannelMessages":               im.registerBeforeListChannelMessages(r),
		"registerAfterListChannelMessages":                im.registerAfterListChannelMessages(r),
		"registerBeforeListFriends":                       im.registerBeforeListFriends(r),
		"registerAfterListFriends":                        im.registerAfterListFriends(r),
		"registerBeforeListFriendsOfFriends":              im.registerBeforeListFriendsOfFriends(r),
		"registerAfterListFriendsOfFriends":               im.registerAfterListFriendsOfFriends(r),
		"registerBeforeAddFriends":                        im.registerBeforeAddFriends(r),
		"registerAfterAddFriends":                         im.registerAfterAddFriends(r),
		"registerBeforeDeleteFriends":                     im.registerBeforeDeleteFriends(r),
		"registerAfterDeleteFriends":                      im.registerAfterDeleteFriends(r),
		"registerBeforeBlockFriends":                      im.registerBeforeBlockFriends(r),
		"registerAfterBlockFriends":                       im.registerAfterBlockFriends(r),
		"registerBeforeImportFacebookFriends":             im.registerBeforeImportFacebookFriends(r),
		"registerAfterImportFacebookFriends":              im.registerAfterImportFacebookFriends(r),
		"registerBeforeImportSteamFriends":                im.registerBeforeImportSteamFriends(r),
		"registerAfterImportSteamFriends":                 im.registerAfterImportSteamFriends(r),
		"registerBeforeCreateGroup":                       im.registerBeforeCreateGroup(r),
		"registerAfterCreateGroup":                        im.registerAfterCreateGroup(r),
		"registerBeforeUpdateGroup":                       im.registerBeforeUpdateGroup(r),
		"registerAfterUpdateGroup":                        im.registerAfterUpdateGroup(r),
		"registerBeforeDeleteGroup":                       im.registerBeforeDeleteGroup(r),
		"registerAfterDeleteGroup":                        im.registerAfterDeleteGroup(r),
		"registerBeforeJoinGroup":                         im.registerBeforeJoinGroup(r),
		"registerAfterJoinGroup":                          im.registerAfterJoinGroup(r),
		"registerBeforeLeaveGroup":                        im.registerBeforeLeaveGroup(r),
		"registerAfterLeaveGroup":                         im.registerAfterLeaveGroup(r),
		"registerBeforeAddGroupUsers":                     im.registerBeforeAddGroupUsers(r),
		"registerAfterAddGroupUsers":                      im.registerAfterAddGroupUsers(r),
		"registerBeforeBanGroupUsers":                     im.registerBeforeBanGroupUsers(r),
		"registerAfterBanGroupUsers":                      im.registerAfterBanGroupUsers(r),
		"registerBeforeKickGroupUsers":                    im.registerBeforeKickGroupUsers(r),
		"registerAfterKickGroupUsers":                     im.registerAfterKickGroupUsers(r),
		"registerBeforePromoteGroupUsers":                 im.registerBeforePromoteGroupUsers(r),
		"registerAfterPromoteGroupUsers":                  im.registerAfterPromoteGroupUsers(r),
		"registerBeforeDemoteGroupUsers":                  im.registerBeforeDemoteGroupUsers(r),
		"registerAfterDemoteGroupUsers":                   im.registerAfterDemoteGroupUsers(r),
		"registerBeforeListGroupUsers":                    im.registerBeforeListGroupUsers(r),
		"registerAfterListGroupUsers":                     im.registerAfterListGroupUsers(r),
		"registerBeforeListUserGroups":                    im.registerBeforeListUserGroups(r),
		"registerAfterListUserGroups":                     im.registerAfterListUserGroups(r),
		"registerBeforeListGroups":                        im.registerBeforeListGroups(r),
		"registerAfterListGroups":                         im.registerAfterListGroups(r),
		"registerBeforeDeleteLeaderboardRecord":           im.registerBeforeDeleteLeaderboardRecord(r),
		"registerAfterDeleteLeaderboardRecord":            im.registerAfterDeleteLeaderboardRecord(r),
		"registerBeforeDeleteTournamentRecord":            im.registerBeforeDeleteTournamentRecord(r),
		"registerAfterDeleteTournamentRecord":             im.registerAfterDeleteTournamentRecord(r),
		"registerBeforeListLeaderboardRecords":            im.registerBeforeListLeaderboardRecords(r),
		"registerAfterListLeaderboardRecords":             im.registerAfterListLeaderboardRecords(r),
		"registerBeforeWriteLeaderboardRecord":            im.registerBeforeWriteLeaderboardRecord(r),
		"registerAfterWriteLeaderboardRecord":             im.registerAfterWriteLeaderboardRecord(r),
		"registerBeforeListLeaderboardRecordsAroundOwner": im.registerBeforeListLeaderboardRecordsAroundOwner(r),
		"registerAfterListLeaderboardRecordsAroundOwner":  im.registerAfterListLeaderboardRecordsAroundOwner(r),
		"registerBeforeLinkApple":                         im.registerBeforeLinkApple(r),
		"registerAfterLinkApple":                          im.registerAfterLinkApple(r),
		"registerBeforeLinkCustom":                        im.registerBeforeLinkCustom(r),
		"registerAfterLinkCustom":                         im.registerAfterLinkCustom(r),
		"registerBeforeLinkDevice":                        im.registerBeforeLinkDevice(r),
		"registerAfterLinkDevice":                         im.registerAfterLinkDevice(r),
		"registerBeforeLinkEmail":                         im.registerBeforeLinkEmail(r),
		"registerAfterLinkEmail":                          im.registerAfterLinkEmail(r),
		"registerBeforeLinkFacebook":                      im.registerBeforeLinkFacebook(r),
		"registerAfterLinkFacebook":                       im.registerAfterLinkFacebook(r),
		"registerBeforeLinkFacebookInstantGame":           im.registerBeforeLinkFacebookInstantGame(r),
		"registerAfterLinkFacebookInstantGame":            im.registerAfterLinkFacebookInstantGame(r),
		"registerBeforeLinkGameCenter":                    im.registerBeforeLinkGameCenter(r),
		"registerAfterLinkGameCenter":                     im.registerAfterLinkGameCenter(r),
		"registerBeforeLinkGoogle":                        im.registerBeforeLinkGoogle(r),
		"registerAfterLinkGoogle":                         im.registerAfterLinkGoogle(r),
		"registerBeforeLinkSteam":                         im.registerBeforeLinkSteam(r),
		"registerAfterLinkSteam":                          im.registerAfterLinkSteam(r),
		"registerBeforeListMatches":                       im.registerBeforeListMatches(r),
		"registerAfterListMatches":                        im.registerAfterListMatches(r),
		"registerBeforeListNotifications":                 im.registerBeforeListNotifications(r),
		"registerAfterListNotifications":                  im.registerAfterListNotifications(r),
		"registerBeforeDeleteNotifications":               im.registerBeforeDeleteNotifications(r),
		"registerAfterDeleteNotifications":                im.registerAfterDeleteNotifications(r),
		"registerBeforeListStorageObjects":                im.registerBeforeListStorageObjects(r),
		"registerAfterListStorageObjects":                 im.registerAfterListStorageObjects(r),
		"registerBeforeReadStorageObjects":                im.registerBeforeReadStorageObjects(r),
		"registerAfterReadStorageObjects":                 im.registerAfterReadStorageObjects(r),
		"registerBeforeWriteStorageObjects":               im.registerBeforeWriteStorageObjects(r),
		"registerAfterWriteStorageObjects":                im.registerAfterWriteStorageObjects(r),
		"registerBeforeDeleteStorageObjects":              im.registerBeforeDeleteStorageObjects(r),
		"registerAfterDeleteStorageObjects":               im.registerAfterDeleteStorageObjects(r),
		"registerBeforeJoinTournament":                    im.registerBeforeJoinTournament(r),
		"registerAfterJoinTournament":                     im.registerAfterJoinTournament(r),
		"registerBeforeListTournamentRecords":             im.registerBeforeListTournamentRecords(r),
		"registerAfterListTournamentRecords":              im.registerAfterListTournamentRecords(r),
		"registerBeforeListTournaments":                   im.registerBeforeListTournaments(r),
		"registerAfterListTournaments":                    im.registerAfterListTournaments(r),
		"registerBeforeWriteTournamentRecord":             im.registerBeforeWriteTournamentRecord(r),
		"registerAfterWriteTournamentRecord":              im.registerAfterWriteTournamentRecord(r),
		"registerBeforeListTournamentRecordsAroundOwner":  im.registerBeforeListTournamentRecordsAroundOwner(r),
		"registerAfterListTournamentRecordsAroundOwner":   im.registerAfterListTournamentRecordsAroundOwner(r),
		"registerBeforeUnlinkApple":                       im.registerBeforeUnlinkApple(r),
		"registerAfterUnlinkApple":                        im.registerAfterUnlinkApple(r),
		"registerBeforeUnlinkCustom":                      im.registerBeforeUnlinkCustom(r),
		"registerAfterUnlinkCustom":                       im.registerAfterUnlinkCustom(r),
		"registerBeforeUnlinkDevice":                      im.registerBeforeUnlinkDevice(r),
		"registerAfterUnlinkDevice":                       im.registerAfterUnlinkDevice(r),
		"registerBeforeUnlinkEmail":                       im.registerBeforeUnlinkEmail(r),
		"registerAfterUnlinkEmail":                        im.registerAfterUnlinkEmail(r),
		"registerBeforeUnlinkFacebook":                    im.registerBeforeUnlinkFacebook(r),
		"registerAfterUnlinkFacebook":                     im.registerAfterUnlinkFacebook(r),
		"registerBeforeUnlinkFacebookInstantGame":         im.registerBeforeUnlinkFacebookInstantGame(r),
		"registerAfterUnlinkFacebookInstantGame":          im.registerAfterUnlinkFacebookInstantGame(r),
		"registerBeforeUnlinkGameCenter":                  im.registerBeforeUnlinkGameCenter(r),
		"registerAfterUnlinkGameCenter":                   im.registerAfterUnlinkGameCenter(r),
		"registerBeforeUnlinkGoogle":                      im.registerBeforeUnlinkGoogle(r),
		"registerAfterUnlinkGoogle":                       im.registerAfterUnlinkGoogle(r),
		"registerBeforeUnlinkSteam":                       im.registerBeforeUnlinkSteam(r),
		"registerAfterUnlinkSteam":                        im.registerAfterUnlinkSteam(r),
		"registerBeforeGetUsers":                          im.registerBeforeGetUsers(r),
		"registerAfterGetUsers":                           im.registerAfterGetUsers(r),
		"registerBeforeValidatePurchaseApple":             im.registerBeforeValidatePurchaseApple(r),
		"registerAfterValidatePurchaseApple":              im.registerAfterValidatePurchaseApple(r),
		"registerBeforeValidateSubscriptionApple":         im.registerBeforeValidateSubscriptionApple(r),
		"registerAfterValidateSubscriptionApple":          im.registerAfterValidateSubscriptionApple(r),
		"registerBeforeValidatePurchaseGoogle":            im.registerBeforeValidatePurchaseGoogle(r),
		"registerAfterValidatePurchaseGoogle":             im.registerAfterValidatePurchaseGoogle(r),
		"registerBeforeValidateSubscriptionGoogle":        im.registerBeforeValidateSubscriptionGoogle(r),
		"registerAfterValidateSubscriptionGoogle":         im.registerAfterValidateSubscriptionGoogle(r),
		"registerBeforeValidatePurchaseHuawei":            im.registerBeforeValidatePurchaseHuawei(r),
		"registerAfterValidatePurchaseHuawei":             im.registerAfterValidatePurchaseHuawei(r),
		"registerBeforeValidatePurchaseFacebookInstant":   im.registerBeforeValidatePurchaseFacebookInstant(r),
		"registerAfterValidatePurchaseFacebookInstant":    im.registerAfterValidatePurchaseFacebookInstant(r),
		"registerBeforeListSubscriptions":                 im.registerBeforeListSubscriptions(r),
		"registerAfterListSubscriptions":                  im.registerAfterListSubscriptions(r),
		"registerBeforeGetSubscription":                   im.registerBeforeGetSubscription(r),
		"registerAfterGetSubscription":                    im.registerAfterGetSubscription(r),
		"registerBeforeEvent":                             im.registerBeforeEvent(r),
		"registerAfterEvent":                              im.registerAfterEvent(r),
		"registerStorageIndex":                            im.registerStorageIndex(r),
		"registerStorageIndexFilter":                      im.registerStorageIndexFilter(r),
	}
}

func (im *RuntimeJavascriptInitModule) Constructor(r *goja.Runtime) (*goja.Object, error) {
	constructor := func(call goja.ConstructorCall) *goja.Object {
		for key, fn := range im.mappings(r) {
			_ = call.This.Set(key, fn)
		}

		return nil
	}

	return r.New(r.ToValue(constructor))
}

func (im *RuntimeJavascriptInitModule) registerRpc(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok = goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractRpcFn(r, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		lKey := strings.ToLower(key)
		im.registerCallbackFn(RuntimeExecutionModeRPC, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeRPC, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) extractRpcFn(r *goja.Runtime, rpcFnName string) (string, error) {
	bs, initFnVarName, err := im.getInitModuleFn()
	if err != nil {
		return "", err
	}

	globalFnId, err := im.getRegisteredRpcFnIdentifier(r, bs, initFnVarName, rpcFnName)
	if err != nil {
		return "", fmt.Errorf("js %s function key could not be extracted: %s", rpcFnName, err.Error())
	}

	return globalFnId, nil
}

func (im *RuntimeJavascriptInitModule) extractStorageIndexFilterFn(r *goja.Runtime, indexName string) (string, error) {
	bs, initFnVarName, err := im.getInitModuleFn()
	if err != nil {
		return "", err
	}

	globalFnId, err := im.getRegisteredFnIdentifier(r, bs, initFnVarName, indexName, "registerStorageIndexFilter")
	if err != nil {
		return "", fmt.Errorf("js %s function key could not be extracted: %s", indexName, err.Error())
	}

	return globalFnId, nil
}

func (im *RuntimeJavascriptInitModule) getRegisteredRpcFnIdentifier(r *goja.Runtime, bs *ast.BlockStatement, initFnVarName, rpcFnName string) (string, error) {
	return im.getRegisteredFnIdentifier(r, bs, initFnVarName, rpcFnName, "registerRpc")
}

func (im *RuntimeJavascriptInitModule) getRegisteredFnIdentifier(r *goja.Runtime, bs *ast.BlockStatement, initFnVarName, rpcFnName, registerFnName string) (string, error) {
	for _, exp := range bs.List {
		if try, ok := exp.(*ast.TryStatement); ok {
			if s, err := im.getRegisteredRpcFnIdentifier(r, try.Body, initFnVarName, rpcFnName); err != nil {
				continue
			} else {
				return s, nil
			}
		}

		if expStat, ok := exp.(*ast.ExpressionStatement); ok {
			if callExp, ok := expStat.Expression.(*ast.CallExpression); ok {
				if callee, ok := callExp.Callee.(*ast.DotExpression); ok {
					if callee.Left.(*ast.Identifier).Name.String() == initFnVarName && callee.Identifier.Name.String() == registerFnName {
						if modNameArg, ok := callExp.ArgumentList[0].(*ast.Identifier); ok {
							id := modNameArg.Name.String()
							if r.Get(id).String() != rpcFnName {
								continue
							}
						} else if modNameArg, ok := callExp.ArgumentList[0].(*ast.StringLiteral); ok {
							if modNameArg.Value.String() != rpcFnName {
								continue
							}
						}

						if modNameArg, ok := callExp.ArgumentList[1].(*ast.Identifier); ok {
							return modNameArg.Name.String(), nil
						} else if modNameArg, ok := callExp.ArgumentList[1].(*ast.StringLiteral); ok {
							return modNameArg.Value.String(), nil
						} else if modNameArg, ok := callExp.ArgumentList[1].(*ast.DotExpression); ok {
							return string(modNameArg.Identifier.Name), nil
						} else {
							return "", inlinedFunctionError
						}
					}
				}
			}
		}
	}

	return "", errors.New("not found")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeGetAccount", "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterGetAccount", "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetMatchmakerStats(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeGetMatchmakerStats", "getmatchmakerstats")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetMatchmakerStats(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterGetMatchmakerStats", "getmatchmakerstats")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUpdateAccount", "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUpdateAccount", "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteAccount", "deleteaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteAccount", "deleteaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateApple", "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateApple", "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateCustom", "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateCustom", "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateDevice", "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateDevice", "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateEmail", "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateEmail", "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateFacebook", "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateFacebook", "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateFacebookInstantGame", "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateFacebookInstantGame", "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateGameCenter", "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateGameCenter", "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateGoogle", "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateGoogle", "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAuthenticateSteam", "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAuthenticateSteam", "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListChannelMessages", "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerAfterListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListChannelMessages", "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListFriends", "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListFriends", "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListFriendsOfFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListFriendsOfFriends", "listfriendsoffriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterListFriendsOfFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListFriendsOfFriends", "listfriendsoffriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAddFriends", "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAddFriends", "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteFriends", "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteFriends", "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeBlockFriends", "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterBlockFriends", "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeImportFacebookFriends", "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterImportFacebookFriends", "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeImportSteamFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeImportSteamFriends", "importsteamfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterImportSteamFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterImportSteamFriends", "importsteamfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeCreateGroup", "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterCreateGroup", "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUpdateGroup", "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUpdateGroup", "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteGroup", "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteGroup", "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeJoinGroup", "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterJoinGroup", "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLeaveGroup", "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLeaveGroup", "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeAddGroupUsers", "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterAddGroupUsers", "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeBanGroupUsers", "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterBanGroupUsers", "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeKickGroupUsers", "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterKickGroupUsers", "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforePromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforePromoteGroupUsers", "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterPromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterPromoteGroupUsers", "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDemoteGroupUsers", "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDemoteGroupUsers", "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListGroupUsers", "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListGroupUsers", "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListUserGroups", "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListUserGroups", "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListGroups", "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListGroups", "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteLeaderboardRecord", "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteLeaderboardRecord", "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteTournamentRecord", "deletetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteTournamentRecord", "deletetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListLeaderboardRecords", "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListLeaderboardRecords", "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeWriteLeaderboardRecord", "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterWriteLeaderboardRecord", "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListLeaderboardRecordsAroundOwner", "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListLeaderboardRecordsAroundOwner", "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkApple", "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkApple", "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkCustom", "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkCustom", "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkDevice", "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkDevice", "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkEmail", "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkEmail", "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkFacebook", "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkFacebook", "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkFacebookInstantGame", "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkFacebookInstantGame", "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkGameCenter", "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkGameCenter", "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkGoogle", "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkGoogle", "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeLinkSteam", "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterLinkSteam", "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListMatches", "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerAfterListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListMatches", "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListNotifications", "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerAfterListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListNotifications", "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteNotifications", "deletenotifications")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteNotifications", "deletenotifications")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListStorageObjects", "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListStorageObjects", "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeReadStorageObjects", "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterReadStorageObjects", "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeWriteStorageObjects", "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterWriteStorageObjects", "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeDeleteStorageObjects", "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterDeleteStorageObjects", "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeJoinTournament", "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterJoinTournament", "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListTournamentRecords", "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListTournamentRecords", "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListTournaments", "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListTournaments", "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeWriteTournamentRecord", "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterWriteTournamentRecord", "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListTournamentRecordsAroundOwner", "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListTournamentRecordsAroundOwner", "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkApple", "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkApple", "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkCustom", "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkCustom", "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkDevice", "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkDevice", "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkEmail", "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkEmail", "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkFacebook", "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkFacebook", "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkFacebookInstantGame", "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkFacebookInstantGame", "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkGameCenter", "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkGameCenter", "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkGoogle", "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkGoogle", "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeUnlinkSteam", "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterUnlinkSteam", "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeGetUsers", "getusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterGetUsers", "getusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidatePurchaseApple", "validatepurchaseapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidatePurchaseApple", "validatepurchaseapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidateSubscriptionApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidateSubscriptionApple", "validatesubscriptionapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidateSubscriptionApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidateSubscriptionApple", "validatesubscriptionapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidatePurchaseGoogle", "validatepurchasegoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidatePurchaseGoogle", "validatepurchasegoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidateSubscriptionGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidateSubscriptionGoogle", "validatesubscriptiongoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidateSubscriptionGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidateSubscriptionGoogle", "validatesubscriptiongoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidatePurchaseHuawei", "validatepurchasehuawei")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidatePurchaseHuawei", "validatepurchasehuawei")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseFacebookInstant(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeValidatePurchaseFacebookInstant", "validatepurchasefacebookinstant")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseFacebookInstant(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterValidatePurchaseFacebookInstant", "validatepurchasefacebookinstant")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListSubscriptions(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeListSubscriptions", "listsubscriptions")
}

func (im *RuntimeJavascriptInitModule) registerAfterListSubscriptions(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterListSubscriptions", "listsubscriptions")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetSubscription(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeGetSubscription", "getsubscription")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetSubscription(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterGetSubscription", "getsubscription")
}

func (im *RuntimeJavascriptInitModule) registerBeforeEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "registerBeforeEvent", "event")
}

func (im *RuntimeJavascriptInitModule) registerAfterEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "registerAfterEvent", "event")
}

func (im *RuntimeJavascriptInitModule) registerStorageIndex(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		idxName := getJsString(r, f.Argument(0))
		idxCollection := getJsString(r, f.Argument(1))

		var idxKey string
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			idxKey = getJsString(r, f.Argument(2))
		}

		ownersArray := f.Argument(3)
		if goja.IsUndefined(ownersArray) || goja.IsNull(ownersArray) {
			panic(r.NewTypeError("expects an array of fields"))
		}
		fields, err := exportToSlice[[]string](ownersArray)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		ownersSortArray := f.Argument(4)
		if goja.IsUndefined(ownersSortArray) || goja.IsNull(ownersSortArray) {
			panic(r.NewTypeError("expects an array of fields"))
		}
		sortableFields, err := exportToSlice[[]string](ownersSortArray)
		if err != nil {
			panic(r.NewTypeError("expects an array of strings"))
		}

		idxMaxEntries := int(getJsInt(r, f.Argument(5)))

		indexOnly := false
		if !goja.IsUndefined(f.Argument(6)) && !goja.IsNull(f.Argument(6)) {
			indexOnly = getJsBool(r, f.Argument(6))
		}

		if err := im.storageIndex.CreateIndex(context.Background(), idxName, idxCollection, idxKey, fields, sortableFields, idxMaxEntries, indexOnly); err != nil {
			panic(r.NewGoError(fmt.Errorf("Failed to register storage index: %s", err.Error())))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerStorageIndexFilter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok = goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractStorageIndexFilterFn(r, key)
		if err != nil {
			panic(r.NewGoError(err))
		}

		lKey := strings.ToLower(key)
		im.registerCallbackFn(RuntimeExecutionModeStorageIndexFilter, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeStorageIndexFilter, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerHook(r *goja.Runtime, execMode RuntimeExecutionMode, registerFnName, fnName string) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		lKey := strings.ToLower(API_PREFIX + fnName)

		fnKey, err := im.extractHookFn(registerFnName)
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(execMode, lKey, fnKey)
		im.announceCallbackFn(execMode, lKey)

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) extractHookFn(registerFnName string) (string, error) {
	bs, initFnVarName, err := im.getInitModuleFn()
	if err != nil {
		return "", err
	}

	globalFnId, err := im.getHookFnIdentifier(bs, initFnVarName, registerFnName)
	if err != nil {
		return "", fmt.Errorf("js %s function key could not be extracted: %s", registerFnName, err.Error())
	}

	return globalFnId, nil
}

func (im *RuntimeJavascriptInitModule) getInitModuleFn() (*ast.BlockStatement, string, error) {
	var fl *ast.FunctionLiteral
	for _, dec := range im.ast.Body {
		if funDecl, ok := dec.(*ast.FunctionDeclaration); ok && funDecl.Function.Name.Name == INIT_MODULE_FN_NAME {
			fl = funDecl.Function
			break
		} else if varStat, ok := dec.(*ast.VariableStatement); ok {
			if id, ok := varStat.List[0].Target.(*ast.Identifier); ok && id.Name == INIT_MODULE_FN_NAME {
				if fnLit, ok := varStat.List[0].Initializer.(*ast.FunctionLiteral); ok {
					fl = fnLit
				}
			}
		}
	}

	if fl == nil {
		return nil, "", errors.New("failed to find InitModule function")
	}
	if len(fl.ParameterList.List) < 4 {
		return nil, "", errors.New("InitModule function is missing params")
	}

	initFnName := fl.ParameterList.List[3].Target.(*ast.Identifier).Name.String() // Initializer is the 4th argument of InitModule

	return fl.Body, initFnName, nil
}

func (im *RuntimeJavascriptInitModule) getHookFnIdentifier(bs *ast.BlockStatement, initVarName, registerFnName string) (string, error) {
	for _, exp := range bs.List {
		if try, ok := exp.(*ast.TryStatement); ok {
			if s, err := im.getHookFnIdentifier(try.Body, initVarName, registerFnName); err != nil {
				continue
			} else {
				return s, nil
			}
		}
		if expStat, ok := exp.(*ast.ExpressionStatement); ok {
			if callExp, ok := expStat.Expression.(*ast.CallExpression); ok {
				if callee, ok := callExp.Callee.(*ast.DotExpression); ok {
					if callee.Left.(*ast.Identifier).Name.String() == initVarName && callee.Identifier.Name.String() == registerFnName {
						if modNameArg, ok := callExp.ArgumentList[0].(*ast.Identifier); ok {
							return modNameArg.Name.String(), nil
						} else if modNameArg, ok := callExp.ArgumentList[0].(*ast.StringLiteral); ok {
							return modNameArg.Value.String(), nil
						} else {
							return "", errors.New("not found")
						}
					}
				}
			}
		}
	}

	return "", errors.New("not found")
}

func (im *RuntimeJavascriptInitModule) registerRtBefore(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok = goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractRtHookFn(r, "registerRtBefore", key)
		if err != nil {
			panic(r.NewGoError(err))
		}
		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeBefore, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeBefore, lKey)

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerRtAfter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok = goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractRtHookFn(r, "registerRtAfter", key)
		if err != nil {
			panic(r.NewGoError(err))
		}
		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeAfter, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeAfter, lKey)

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) extractRtHookFn(r *goja.Runtime, registerFnName, fnName string) (string, error) {
	bs, initFnVarName, err := im.getInitModuleFn()
	if err != nil {
		return "", err
	}

	globalFnId, err := im.getRtHookFnIdentifier(r, bs, initFnVarName, registerFnName, fnName)
	if err != nil {
		return "", fmt.Errorf("js realtime %s hook function key could not be extracted: %s", registerFnName, err.Error())
	}

	return globalFnId, nil
}

func (im *RuntimeJavascriptInitModule) getRtHookFnIdentifier(r *goja.Runtime, bs *ast.BlockStatement, initVarName, registerFnName, rtFnName string) (string, error) {
	for _, exp := range bs.List {
		if try, ok := exp.(*ast.TryStatement); ok {
			if s, err := im.getRtHookFnIdentifier(r, try.Body, initVarName, registerFnName, rtFnName); err != nil {
				continue
			} else {
				return s, nil
			}
		}
		if expStat, ok := exp.(*ast.ExpressionStatement); ok {
			if callExp, ok := expStat.Expression.(*ast.CallExpression); ok {
				if callee, ok := callExp.Callee.(*ast.DotExpression); ok {
					if callee.Left.(*ast.Identifier).Name.String() == initVarName && callee.Identifier.Name.String() == registerFnName {
						if modNameArg, ok := callExp.ArgumentList[0].(*ast.Identifier); ok {
							id := modNameArg.Name.String()
							if r.Get(id).String() != rtFnName {
								continue
							}
						} else if modNameArg, ok := callExp.ArgumentList[0].(*ast.StringLiteral); ok {
							if modNameArg.Value.String() != rtFnName {
								continue
							}
						}

						if modNameArg, ok := callExp.ArgumentList[1].(*ast.Identifier); ok {
							return modNameArg.Name.String(), nil
						} else if modNameArg, ok := callExp.ArgumentList[1].(*ast.StringLiteral); ok {
							return modNameArg.Value.String(), nil
						} else {
							return "", errors.New("not found")
						}
					}
				}
			}
		}
	}

	return "", errors.New("not found")
}

func (im *RuntimeJavascriptInitModule) registerMatchmakerMatched(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerMatchmakerMatched")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeMatchmaker, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeMatchmaker, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentEnd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerTournamentEnd")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeTournamentEnd, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeTournamentEnd, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerTournamentReset")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeTournamentReset, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeTournamentReset, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerLeaderboardReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerLeaderboardReset")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeLeaderboardReset, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeLeaderboardReset, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerShutdown(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerShutdown")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeShutdown, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeShutdown, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerPurchaseNotificationApple(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerPurchaseNotificationApple")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModePurchaseNotificationApple, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModePurchaseNotificationApple, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerSubscriptionNotificationApple(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerSubscriptionNotificationApple")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeSubscriptionNotificationApple, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeSubscriptionNotificationApple, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerPurchaseNotificationGoogle(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerPurchaseNotificationGoogle")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModePurchaseNotificationGoogle, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModePurchaseNotificationGoogle, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerSubscriptionNotificationGoogle(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnKey, err := im.extractHookFn("registerSubscriptionNotificationGoogle")
		if err != nil {
			panic(r.NewGoError(err))
		}
		im.registerCallbackFn(RuntimeExecutionModeSubscriptionNotificationGoogle, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeSubscriptionNotificationGoogle, "")

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerMatch(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		name := getJsString(r, f.Argument(0))

		funcObj := f.Argument(1)
		if goja.IsNull(funcObj) || goja.IsUndefined(funcObj) {
			panic(r.NewTypeError("expects an object"))
		}

		funcMap, ok := funcObj.Export().(map[string]interface{})
		if !ok {
			panic(r.NewTypeError("expects an object"))
		}

		functions := &jsMatchHandlers{}

		fnValue, ok := funcMap[string(MatchInit)]
		if !ok {
			panic(r.NewTypeError(string(MatchInit) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchInit) + " value not a valid function"))
		}
		fnKey, err := im.extractMatchFnKey(r, name, MatchInit)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.initFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchJoinAttempt)]
		if !ok {
			panic(r.NewTypeError(string(MatchJoinAttempt) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchJoinAttempt) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchJoinAttempt)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.joinAttemptFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchJoin)]
		if !ok {
			panic(r.NewTypeError(string(MatchJoin) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchJoin) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchJoin)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.joinFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchLeave)]
		if !ok {
			panic(r.NewTypeError(string(MatchLeave) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchLeave) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchLeave)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.leaveFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchLoop)]
		if !ok {
			panic(r.NewTypeError(string(MatchLoop) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchLoop) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchLoop)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.loopFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchTerminate)]
		if !ok {
			panic(r.NewTypeError(string(MatchTerminate) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchTerminate) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchTerminate)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.terminateFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		fnValue, ok = funcMap[string(MatchSignal)]
		if !ok {
			panic(r.NewTypeError(string(MatchSignal) + " not found"))
		}
		_, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError(string(MatchSignal) + " value not a valid function"))
		}
		fnKey, err = im.extractMatchFnKey(r, name, MatchSignal)
		if err != nil {
			panic(r.NewGoError(err))
		}
		functions.signalFn = fnKey

		if err = im.checkFnScope(r, fnKey); err != nil {
			panic(r.NewGoError(err))
		}

		im.MatchCallbacks.Add(name, functions)

		return goja.Undefined()
	}
}

type MatchFnId string

const (
	MatchInit        MatchFnId = "matchInit"
	MatchJoinAttempt MatchFnId = "matchJoinAttempt"
	MatchJoin        MatchFnId = "matchJoin"
	MatchLeave       MatchFnId = "matchLeave"
	MatchLoop        MatchFnId = "matchLoop"
	MatchTerminate   MatchFnId = "matchTerminate"
	MatchSignal      MatchFnId = "matchSignal"
)

func (im *RuntimeJavascriptInitModule) extractMatchFnKey(r *goja.Runtime, modName string, matchFnId MatchFnId) (string, error) {
	bs, initFnVarName, err := im.getInitModuleFn()
	if err != nil {
		return "", err
	}

	globalFnId, err := im.getMatchHookFnIdentifier(r, bs, initFnVarName, modName, matchFnId)
	if err != nil {
		return "", fmt.Errorf("js match handler %q function for module %q global id could not be extracted: %s", string(matchFnId), modName, err.Error())
	}

	return globalFnId, nil
}

func (im *RuntimeJavascriptInitModule) getMatchHookFnIdentifier(r *goja.Runtime, bs *ast.BlockStatement, initFnVarName, modName string, matchfnId MatchFnId) (string, error) {
	for _, exp := range bs.List {
		if try, ok := exp.(*ast.TryStatement); ok {
			if s, err := im.getMatchHookFnIdentifier(r, try.Body, initFnVarName, modName, matchfnId); err != nil {
				continue
			} else {
				return s, nil
			}
		}
		if expStat, ok := exp.(*ast.ExpressionStatement); ok {
			if callExp, ok := expStat.Expression.(*ast.CallExpression); ok {
				if callee, ok := callExp.Callee.(*ast.DotExpression); ok {
					if callee.Left.(*ast.Identifier).Name.String() == initFnVarName && callee.Identifier.Name == "registerMatch" {
						if modNameArg, ok := callExp.ArgumentList[0].(*ast.Identifier); ok {
							id := modNameArg.Name.String()
							if r.Get(id).String() != modName {
								continue
							}
						} else if modNameArg, ok := callExp.ArgumentList[0].(*ast.StringLiteral); ok {
							if modNameArg.Value.String() != modName {
								continue
							}
						}

						var obj *ast.ObjectLiteral
						if matchHandlerId, ok := callExp.ArgumentList[1].(*ast.Identifier); ok {
							// We know the obj is an identifier, we need to lookup it's definition in the AST
							matchHandlerIdStr := matchHandlerId.Name.String()
							for _, mhDec := range im.ast.DeclarationList {
								if mhDecId, ok := mhDec.List[0].Target.(*ast.Identifier); ok && mhDecId.Name.String() == matchHandlerIdStr {
									objLiteral, ok := mhDec.List[0].Initializer.(*ast.ObjectLiteral)
									if ok {
										obj = objLiteral
									}
								}
							}
						} else {
							obj, _ = callExp.ArgumentList[1].(*ast.ObjectLiteral)
						}

						for _, prop := range obj.Value {
							if propKeyed, ok := prop.(*ast.PropertyKeyed); ok {
								if key, ok := propKeyed.Key.(*ast.StringLiteral); ok {
									if key.Literal == string(matchfnId) {
										if sl, ok := propKeyed.Value.(*ast.StringLiteral); ok {
											return sl.Literal, nil
										} else if id, ok := propKeyed.Value.(*ast.Identifier); ok {
											return id.Name.String(), nil
										} else {
											return "", inlinedFunctionError
										}
									}
								}
							}

							if propShort, ok := prop.(*ast.PropertyShort); ok {
								if string(propShort.Name.Name) == string(matchfnId) {
									return string(propShort.Name.Name), nil
								}
							}
						}
						break
					}
				}
			}
		}
	}

	return "", errors.New("not found")
}

func (im *RuntimeJavascriptInitModule) checkFnScope(r *goja.Runtime, key string) error {
	if r.GlobalObject().Get(key) == nil {
		return fmt.Errorf("function %q not registered in the global object scope", key)
	}
	return nil
}

func (im *RuntimeJavascriptInitModule) registerCallbackFn(mode RuntimeExecutionMode, key string, fn string) {
	switch mode {
	case RuntimeExecutionModeRPC:
		im.Callbacks.Rpc[key] = fn
	case RuntimeExecutionModeBefore:
		im.Callbacks.Before[key] = fn
	case RuntimeExecutionModeAfter:
		im.Callbacks.After[key] = fn
	case RuntimeExecutionModeMatchmaker:
		im.Callbacks.Matchmaker = fn
	case RuntimeExecutionModeTournamentEnd:
		im.Callbacks.TournamentEnd = fn
	case RuntimeExecutionModeTournamentReset:
		im.Callbacks.TournamentReset = fn
	case RuntimeExecutionModeLeaderboardReset:
		im.Callbacks.LeaderboardReset = fn
	case RuntimeExecutionModeShutdown:
		im.Callbacks.Shutdown = fn
	case RuntimeExecutionModePurchaseNotificationApple:
		im.Callbacks.PurchaseNotificationApple = fn
	case RuntimeExecutionModeSubscriptionNotificationApple:
		im.Callbacks.SubscriptionNotificationApple = fn
	case RuntimeExecutionModePurchaseNotificationGoogle:
		im.Callbacks.PurchaseNotificationGoogle = fn
	case RuntimeExecutionModeSubscriptionNotificationGoogle:
		im.Callbacks.SubscriptionNotificationGoogle = fn
	case RuntimeExecutionModeStorageIndexFilter:
		im.Callbacks.StorageIndexFilter[key] = fn
	}
}
