package server

import (
	"strings"
	"sync"

	"github.com/dop251/goja"
	"go.uber.org/zap"
)

const INIT_MODULE_FN_NAME = "InitModule"

type RuntimeJavascriptMatchHandlers struct {
	lock    *sync.RWMutex
	mapping map[string]*jsMatchHandlers
}

func (rmh *RuntimeJavascriptMatchHandlers) Add(name string, handlers *jsMatchHandlers) {
	rmh.lock.Lock()
	rmh.mapping[name] = handlers
	rmh.lock.Unlock()
}

func (rmh *RuntimeJavascriptMatchHandlers) Get(name string) *jsMatchHandlers {
	var handlers *jsMatchHandlers
	rmh.lock.RLock()
	handlers = rmh.mapping[name]
	rmh.lock.RUnlock()

	return handlers
}

type jsMatchHandlers struct {
	initFn        goja.Callable
	joinAttemptFn goja.Callable
	joinFn        goja.Callable
	leaveFn       goja.Callable
	loopFn        goja.Callable
	terminateFn   goja.Callable
}

type RuntimeJavascriptCallbacks struct {
	Rpc              map[string]goja.Callable
	Before           map[string]goja.Callable
	After            map[string]goja.Callable
	Matchmaker       goja.Callable
	TournamentEnd    goja.Callable
	TournamentReset  goja.Callable
	LeaderboardReset goja.Callable
}

type RuntimeJavascriptInitModule struct {
	Logger             *zap.Logger
	Callbacks          *RuntimeJavascriptCallbacks
	MatchCallbacks     *RuntimeJavascriptMatchHandlers
	announceCallbackFn func(RuntimeExecutionMode, string)
}

func NewRuntimeJavascriptInitModule(logger *zap.Logger, announceCallbackFn func(RuntimeExecutionMode, string)) *RuntimeJavascriptInitModule {
	callbacks := &RuntimeJavascriptCallbacks{
		Rpc:    make(map[string]goja.Callable),
		Before: make(map[string]goja.Callable),
		After:  make(map[string]goja.Callable),
	}

	matchCallbacks := &RuntimeJavascriptMatchHandlers{
		lock:    &sync.RWMutex{},
		mapping: make(map[string]*jsMatchHandlers, 0),
	}

	return &RuntimeJavascriptInitModule{
		Logger:             logger,
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
		"registerMatch":                                   im.registerMatch(r),
		"registerBeforeGetAccount":                        im.registerBeforeGetAccount(r),
		"registerAfterGetAccount":                         im.registerAfterGetAccount(r),
		"registerBeforeUpdateAccount":                     im.registerBeforeUpdateAccount(r),
		"registerAfterUpdateAccount":                      im.registerAfterUpdateAccount(r),
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
		"registerBeforeDeleteNotification":                im.registerBeforeDeleteNotification(r),
		"registerAfterDeleteNotification":                 im.registerAfterDeleteNotification(r),
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
		"registerBeforeEvent":                             im.registerBeforeEvent(r),
		"registerAfterEvent":                              im.registerAfterEvent(r),
	}
}

func (im *RuntimeJavascriptInitModule) Constructor(r *goja.Runtime) func(goja.ConstructorCall) *goja.Object {
	return func(call goja.ConstructorCall) *goja.Object {
		for key, fn := range im.mappings(r) {
			call.This.Set(key, fn)
		}

		return nil
	}
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

		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		lKey := strings.ToLower(key)
		im.registerCallbackFn(RuntimeExecutionModeRPC, lKey, fn)
		im.announceCallbackFn(RuntimeExecutionModeRPC, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "getaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateAccount(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "updateaccount")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticateapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticatecustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticatedevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticateemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticatefacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticatefacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticategamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticategoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterAuthenticateSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "authenticatesteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerAfterListChannelMessages(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listchannelmessages")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterListFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "addfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "deletefriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterBlockFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "blockfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerAfterImportFacebookFriends(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "importfacebookfriends")
}

func (im *RuntimeJavascriptInitModule) registerBeforeCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterCreateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "creategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterUpdateGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "updategroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "deletegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "joingroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerAfterLeaveGroup(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "leavegroup")
}

func (im *RuntimeJavascriptInitModule) registerBeforeAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterAddGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "addgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterBanGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "bangroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterKickGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "kickgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforePromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterPromoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "promotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterDemoteGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "demotegroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroupUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listgroupusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListUserGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listusergroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerAfterListGroups(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listgroups")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "deleteleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listleaderboardrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteLeaderboardRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "writeleaderboardrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListLeaderboardRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listleaderboardrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterLinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "linksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerAfterListMatches(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listmatches")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerAfterListNotifications(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listnotifications")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteNotification(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "deletenotification")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteNotification(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "deletenotification")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterListStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "liststorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterReadStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "readstorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "writestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerAfterDeleteStorageObjects(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "deletestorageobjects")
}

func (im *RuntimeJavascriptInitModule) registerBeforeJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerAfterJoinTournament(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "jointournament")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecords(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listtournamentrecords")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournaments(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listtournaments")
}

func (im *RuntimeJavascriptInitModule) registerBeforeWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerAfterWriteTournamentRecord(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "writetournamentrecord")
}

func (im *RuntimeJavascriptInitModule) registerBeforeListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerAfterListTournamentRecordsAroundOwner(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "listtournamentrecordsaroundowner")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkApple(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkapple")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkCustom(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkcustom")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkDevice(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkdevice")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkEmail(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkemail")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebook(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkfacebook")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkFacebookInstantGame(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkfacebookinstantgame")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGameCenter(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkgamecenter")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkGoogle(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinkgoogle")
}

func (im *RuntimeJavascriptInitModule) registerBeforeUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerAfterUnlinkSteam(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "unlinksteam")
}

func (im *RuntimeJavascriptInitModule) registerBeforeGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "getusers")
}

func (im *RuntimeJavascriptInitModule) registerAfterGetUsers(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "getusers")
}

func (im *RuntimeJavascriptInitModule) registerBeforeEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeBefore, "event")
}

func (im *RuntimeJavascriptInitModule) registerAfterEvent(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return im.registerReq(r, RuntimeExecutionModeAfter, "event")
}

func (im *RuntimeJavascriptInitModule) registerReq(r *goja.Runtime, execMode RuntimeExecutionMode, fnName string) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(f.Argument(0))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		lKey := strings.ToLower(API_PREFIX + fnName)
		im.registerCallbackFn(execMode, lKey, fn)
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
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeBefore, lKey, fn)
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
		key, ok := fName.Export().(string)
		if !ok {
			panic(r.NewTypeError("expects a non empty string"))
		}
		if key == "" {
			panic(r.NewTypeError("expects a non empty string"))
		}

		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		lKey := strings.ToLower(RTAPI_PREFIX + key)
		im.registerCallbackFn(RuntimeExecutionModeAfter, lKey, fn)
		im.announceCallbackFn(RuntimeExecutionModeAfter, lKey)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerMatchmakerMatched(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		im.registerCallbackFn(RuntimeExecutionModeMatchmaker, "", fn)
		im.announceCallbackFn(RuntimeExecutionModeMatchmaker, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentEnd(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		im.registerCallbackFn(RuntimeExecutionModeTournamentEnd, "", fn)
		im.announceCallbackFn(RuntimeExecutionModeTournamentEnd, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerTournamentReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		im.registerCallbackFn(RuntimeExecutionModeTournamentReset, "", fn)
		im.announceCallbackFn(RuntimeExecutionModeTournamentReset, "")

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerLeaderboardReset(r *goja.Runtime) func(goja.FunctionCall) goja.Value {
	return func(f goja.FunctionCall) goja.Value {
		fn, ok := goja.AssertFunction(f.Argument(1))
		if !ok {
			panic(r.NewTypeError("expects a function"))
		}

		im.registerCallbackFn(RuntimeExecutionModeLeaderboardReset, "", fn)
		im.announceCallbackFn(RuntimeExecutionModeLeaderboardReset, "")

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

		fnValue, ok := funcMap["matchInit"]
		if !ok {
			panic(r.NewTypeError("matchInit not found"))
		}
		fn, ok := goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchInit value not a valid function"))
		}
		functions.initFn = fn

		fnValue, ok = funcMap["matchJoinAttempt"]
		if !ok {
			panic(r.NewTypeError("matchJoinAttempt not found"))
		}
		fn, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchJoinAttempt value not a valid function"))
		}
		functions.joinAttemptFn = fn

		fnValue, ok = funcMap["matchJoin"]
		if !ok {
			panic(r.NewTypeError("matchJoin not found"))
		}
		fn, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchJoin value not a valid function"))
		}
		functions.joinFn = fn

		fnValue, ok = funcMap["matchLeave"]
		if !ok {
			panic(r.NewTypeError("matchLeave not found"))
		}
		fn, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchLeave value not a valid function"))
		}
		functions.leaveFn = fn

		fnValue, ok = funcMap["matchLoop"]
		if !ok {
			panic(r.NewTypeError("matchLoop not found"))
		}
		fn, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchLoop value not a valid function"))
		}
		functions.loopFn = fn

		fnValue, ok = funcMap["matchTerminate"]
		if !ok {
			panic(r.NewTypeError("matchTerminate not found"))
		}
		fn, ok = goja.AssertFunction(r.ToValue(fnValue))
		if !ok {
			panic(r.NewTypeError("matchTerminate value not a valid function"))
		}
		functions.terminateFn = fn

		im.MatchCallbacks.Add(name, functions)

		return goja.Undefined()
	}
}

func (im *RuntimeJavascriptInitModule) registerCallbackFn(mode RuntimeExecutionMode, key string, fn goja.Callable) {
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
	}
}
