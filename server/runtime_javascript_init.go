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
	"go.uber.org/zap"
)

const INIT_MODULE_FN_NAME = "InitModule"

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
	PurchaseNotificationApple      string
	SubscriptionNotificationApple  string
	PurchaseNotificationGoogle     string
	SubscriptionNotificationGoogle string
}

type RuntimeJavascriptInitModule struct {
	Logger             *zap.Logger
	Callbacks          *RuntimeJavascriptCallbacks
	MatchCallbacks     *RuntimeJavascriptMatchHandlers
	storageIndex       StorageIndex
	announceCallbackFn func(RuntimeExecutionMode, string)
}

func NewRuntimeJavascriptInitModule(logger *zap.Logger, storageIndex StorageIndex, callbacks *RuntimeJavascriptCallbacks, matchCallbacks *RuntimeJavascriptMatchHandlers, announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeJavascriptInitModule {
	return &RuntimeJavascriptInitModule{
		Logger:             logger,
		storageIndex:       storageIndex,
		announceCallbackFn: announceCallbackFn,
		Callbacks:          callbacks,
		MatchCallbacks:     matchCallbacks,
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
		"registerPurchaseNotificationApple":               im.registerPurchaseNotificationApple(r),
		"registerSubscriptionNotificationApple":           im.registerSubscriptionNotificationApple(r),
		"registerPurchaseNotificationGoogle":              im.registerPurchaseNotificationGoogle(r),
		"registerSubscriptionNotificationGoogle":          im.registerSubscriptionNotificationGoogle(r),
		"registerMatch":                                   im.registerMatch(r),
		"registerBeforeGetAccount":                        im.registerBeforeGetAccount(r),
		"registerAfterGetAccount":                         im.registerAfterGetAccount(r),
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
		key := fName.String()
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnObj, ok := fn.(*goja.Object)
		if !ok {
			panic(r.NewTypeError("expects an object"))
		}

		v := fnObj.Get("name")
		if v == nil || v.String() == "" {
			panic(r.NewTypeError("function key could not be extracted: cannot register an anonymous function"))
		}

		fnKey := strings.Clone(v.String())

		lKey := strings.ToLower(key)
		im.registerCallbackFn(RuntimeExecutionModeRPC, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeRPC, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deleteaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deleteaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerAfterListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeImportSteamFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "importsteamfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterImportSteamFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "importsteamfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforePromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterPromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deletetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deletetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerAfterListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerAfterListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deletenotifications")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deletenotifications")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "getusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "getusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "validatepurchaseapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "validatepurchaseapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidateSubscriptionApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "validatesubscriptionapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidateSubscriptionApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "validatesubscriptionapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "validatepurchasegoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "validatepurchasegoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidateSubscriptionGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "validatesubscriptiongoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidateSubscriptionGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "validatesubscriptiongoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeValidatePurchaseHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "validatepurchasehuawei")
}

func (im *RuntimeJavascriptInitModule) registerAfterValidatePurchaseHuawei(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "validatepurchasehuawei")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListSubscriptions(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "listsubscriptions")
}

func (im *RuntimeJavascriptInitModule) registerAfterListSubscriptions(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "listsubscriptions")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetSubscription(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "getsubscription")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetSubscription(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "getsubscription")
}

func (im *RuntimeJavascriptInitModule) registerBeforeEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeBefore, "event")
}

func (im *RuntimeJavascriptInitModule) registerAfterEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerHook(r, RuntimeExecutionModeAfter, "event")
}

func (im *RuntimeJavascriptInitModule) registerHook(r *goja.Runtime, execMode RuntimeExecutionMode, fnName string) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register %q %s hook: %s", fnName, execMode.String(), err.Error()))
		}

		lKey := strings.ToLower(API_PREFIX + fnName)

		im.registerCallbackFn(execMode, lKey, fnKey)
		im.announceCallbackFn(execMode, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerRtBefore(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key := fName.String()
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to rt before hook on %q: %s", fName, err.Error()))
		}

		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeBefore, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeBefore, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerRtAfter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fName := f.Argument(0)
		if goja.IsNull(fName) || goja.IsUndefined(fName) {
			panic(r.NewTypeError("expects a non empty string"))
		}
		key := fName.String()
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to rt after hook on %q: %s", fName, err.Error()))
		}

		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeAfter, lKey, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeAfter, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerMatchmakerMatched(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register matchmakerMatched hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeMatchmaker, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeMatchmaker, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentEnd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register tournamentEnd hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeTournamentEnd, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeTournamentEnd, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register tournamentReset hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeTournamentReset, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeTournamentReset, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerLeaderboardReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register leaderboardReset hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeLeaderboardReset, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeLeaderboardReset, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerPurchaseNotificationApple(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register purchaseNotificationApple hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModePurchaseNotificationApple, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModePurchaseNotificationApple, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerSubscriptionNotificationApple(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register subscriptionNotificationApple hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeSubscriptionNotificationApple, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeSubscriptionNotificationApple, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerPurchaseNotificationGoogle(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register purchaseNotificationGoogle hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModePurchaseNotificationGoogle, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModePurchaseNotificationGoogle, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerSubscriptionNotificationGoogle(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn := f.Argument(0)

		fnKey, err := im.getFnKey(r, fn)
		if err != nil {
			panic(r.NewTypeError("failed to register subscriptionNotificationGoogle hook: %s", err.Error()))
		}

		im.registerCallbackFn(RuntimeExecutionModeSubscriptionNotificationGoogle, "", fnKey)
		im.announceCallbackFn(RuntimeExecutionModeSubscriptionNotificationGoogle, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerStorageIndex(r *goja.Runtime) func(call goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		idxName := getJsString(r, f.Argument(0))
		idxCollection := getJsString(r, f.Argument(1))

		var idxKey string
		if !goja.IsUndefined(f.Argument(2)) && !goja.IsNull(f.Argument(2)) {
			idxKey = getJsString(r, f.Argument(2))
		}

		var fields []string
		ownersArray := f.Argument(3)
		if goja.IsUndefined(ownersArray) || goja.IsNull(ownersArray) {
			panic(r.NewTypeError("expects an array of fields"))
		}
		fieldsSlice, ok := ownersArray.Export().([]interface{})
		if !ok {
			panic(r.NewTypeError("expects an array of fields"))
		}
		if len(fieldsSlice) < 1 {
			panic(r.NewTypeError("expects at least one field to be set"))
		}
		fields = make([]string, 0, len(fieldsSlice))
		for _, field := range fieldsSlice {
			fieldStr, ok := field.(string)
			if !ok {
				panic(r.NewTypeError("expects a string field"))
			}
			fields = append(fields, fieldStr)
		}

		idxMaxEntries := int(getJsInt(r, f.Argument(4)))

		if err := im.storageIndex.CreateIndex(context.Background(), idxName, idxCollection, idxKey, fields, idxMaxEntries); err != nil {
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
		key := fName.String()
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn := f.Argument(1)
		_, ok := goja.AssertFunction(fn)
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		fnObj, ok := fn.(*goja.Object)
		if !ok {
			panic(r.NewTypeError("expects an object"))
		}

		v := fnObj.Get("name")
		if v == nil {
			panic(r.NewTypeError("function key could not be extracted"))
		}

		fnKey := strings.Clone(v.String())

		im.registerCallbackFn(RuntimeExecutionModeStorageIndexFilter, key, fnKey)
		im.announceCallbackFn(RuntimeExecutionModeStorageIndexFilter, key)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) getFnKey(r *goja.Runtime, fn goja.Value) (string, error) {
	if fn == nil {
		return "", errors.New("not found")
	}

	_, ok := goja.AssertFunction(fn)
	if !ok {
		return "", errors.New("value is not a valid function")
	}

	fnObj := fn.ToObject(r)

	v := fnObj.Get("name")
	if v == nil || v.String() == "" {
		return "", errors.New("function object 'name' property not found or empty")
	}

	return strings.Clone(v.String()), nil
}

func (im *RuntimeJavascriptInitModule) registerMatch(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		name := getJsString(r, f.Argument(0))

		funcs := f.Argument(1)
		if goja.IsNull(funcs) || goja.IsUndefined(funcs) {
			panic(r.NewTypeError("expects an object"))
		}

		funcObj := funcs.ToObject(r)

		functions := &jsMatchHandlers{}

		key, err := im.getFnKey(r, funcObj.Get(string(MatchInit)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchInit), err.Error()))
		}
		functions.initFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchJoinAttempt)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchJoinAttempt), err.Error()))
		}
		functions.joinAttemptFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchJoin)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchJoin), err.Error()))
		}
		functions.joinFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchLeave)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchLeave), err.Error()))
		}
		functions.leaveFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchLoop)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchLoop), err.Error()))
		}
		functions.loopFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchTerminate)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchTerminate), err.Error()))
		}
		functions.terminateFn = key

		key, err = im.getFnKey(r, funcObj.Get(string(MatchSignal)))
		if err != nil {
			panic(r.NewTypeError("match handler required function %q invalid: %s", string(MatchSignal), err.Error()))
		}
		functions.signalFn = key

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
