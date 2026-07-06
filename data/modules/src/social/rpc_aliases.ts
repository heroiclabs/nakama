// rpc_aliases.ts — Phase-3 RPC consolidation (doc §12 / Appendix C).
//
// Registers the canonical `ivx_social_*` names as wrappers over the existing
// battle-tested handlers, translating every response into the UNIFIED
// ENVELOPE (doc §6.1):
//
//   { success, data: {...}, meta: { gameId, timestamp, apiVersion } }
//   { success: false, error, errorCode, meta: {...} }
//
// This kills the dual-envelope problem (TS modules returned nested
// {success,data}, JS modules returned flat {success,...}) WITHOUT touching a
// single legacy handler: old names keep answering with their exact legacy
// shapes forever (Unity untouched — Phase 4 migrates at its own pace), new
// names answer with the standard envelope.
//
// MECHANICS: the merged bundle hoists every module-JS handler (function
// rpcFriendsSendInvite(...) { ... }) to global scope — postbuild only
// prefixes legacy_runtime.js functions. Each alias resolves its handler by
// bare global reference behind a typeof guard: if a handler is missing
// (module dropped from a build), the alias returns a clean error instead of
// crashing registration.

// Global handlers provided by the plain-JS modules in the merged bundle.
declare var rpcFriendsSendInvite: any;            // friends/friend_invites.js
declare var rpcFriendsAcceptInvite: any;
declare var rpcFriendsDeclineInvite: any;
declare var rpcFriendsCancelInvite: any;
declare var rpcFriendsListPendingInvites: any;
declare var rpcSendFriendChallenge: any;          // friends/friend_challenges.js
declare var rpcAcceptFriendChallenge: any;
declare var rpcDeclineFriendChallenge: any;
declare var rpcCancelFriendChallenge: any;
declare var rpcListPendingFriendChallenges: any;
declare var rpcFriendsSpectate: any;
declare var rpcFriendStreakGetState: any;         // friend_streaks/friend_streaks.js
declare var rpcFriendStreakRecordContribution: any;
declare var rpcFriendStreakSendNudge: any;
declare var rpcFriendStreakGetBrokenLog: any;
declare var rpcFriendStreakRepair: any;
declare var rpcFriendsGetOnlineCount: any;        // friends/friends_extras.js
declare var rpcFriendBattleCreate: any;
declare var rpcFriendInviteWithReward: any;
declare var rpcSendDirectMessage: any;            // DM module
declare var rpcGetDirectMessageHistory: any;
declare var rpcMarkDirectMessagesRead: any;

namespace SocialRpcAliases {

  var API_VERSION = 1;

  interface AliasDef { newId: string; handler: () => any; }

  // typeof-guarded accessors — evaluated at CALL time, so bundle load order
  // can never break registration.
  var ALIASES: AliasDef[] = [
    { newId: "ivx_social_invite_send",         handler: function () { return typeof rpcFriendsSendInvite !== "undefined" ? rpcFriendsSendInvite : null; } },
    { newId: "ivx_social_invite_accept",       handler: function () { return typeof rpcFriendsAcceptInvite !== "undefined" ? rpcFriendsAcceptInvite : null; } },
    { newId: "ivx_social_invite_decline",      handler: function () { return typeof rpcFriendsDeclineInvite !== "undefined" ? rpcFriendsDeclineInvite : null; } },
    { newId: "ivx_social_invite_cancel",       handler: function () { return typeof rpcFriendsCancelInvite !== "undefined" ? rpcFriendsCancelInvite : null; } },
    { newId: "ivx_social_invites_pending",     handler: function () { return typeof rpcFriendsListPendingInvites !== "undefined" ? rpcFriendsListPendingInvites : null; } },
    { newId: "ivx_social_challenge_send",      handler: function () { return typeof rpcSendFriendChallenge !== "undefined" ? rpcSendFriendChallenge : null; } },
    { newId: "ivx_social_challenge_accept",    handler: function () { return typeof rpcAcceptFriendChallenge !== "undefined" ? rpcAcceptFriendChallenge : null; } },
    { newId: "ivx_social_challenge_decline",   handler: function () { return typeof rpcDeclineFriendChallenge !== "undefined" ? rpcDeclineFriendChallenge : null; } },
    { newId: "ivx_social_challenge_cancel",    handler: function () { return typeof rpcCancelFriendChallenge !== "undefined" ? rpcCancelFriendChallenge : null; } },
    { newId: "ivx_social_challenges_pending",  handler: function () { return typeof rpcListPendingFriendChallenges !== "undefined" ? rpcListPendingFriendChallenges : null; } },
    { newId: "ivx_social_spectate",            handler: function () { return typeof rpcFriendsSpectate !== "undefined" ? rpcFriendsSpectate : null; } },
    { newId: "ivx_social_streak_get",          handler: function () { return typeof rpcFriendStreakGetState !== "undefined" ? rpcFriendStreakGetState : null; } },
    { newId: "ivx_social_streak_record",       handler: function () { return typeof rpcFriendStreakRecordContribution !== "undefined" ? rpcFriendStreakRecordContribution : null; } },
    { newId: "ivx_social_streak_nudge",        handler: function () { return typeof rpcFriendStreakSendNudge !== "undefined" ? rpcFriendStreakSendNudge : null; } },
    { newId: "ivx_social_streak_broken_log",   handler: function () { return typeof rpcFriendStreakGetBrokenLog !== "undefined" ? rpcFriendStreakGetBrokenLog : null; } },
    { newId: "ivx_social_streak_repair",       handler: function () { return typeof rpcFriendStreakRepair !== "undefined" ? rpcFriendStreakRepair : null; } },
    { newId: "ivx_social_friends_online_count", handler: function () { return typeof rpcFriendsGetOnlineCount !== "undefined" ? rpcFriendsGetOnlineCount : null; } },
    { newId: "ivx_social_battle_create",       handler: function () { return typeof rpcFriendBattleCreate !== "undefined" ? rpcFriendBattleCreate : null; } },
    { newId: "ivx_social_invite_with_reward",  handler: function () { return typeof rpcFriendInviteWithReward !== "undefined" ? rpcFriendInviteWithReward : null; } },
    { newId: "ivx_social_dm_send",             handler: function () { return typeof rpcSendDirectMessage !== "undefined" ? rpcSendDirectMessage : null; } },
    { newId: "ivx_social_dm_history",          handler: function () { return typeof rpcGetDirectMessageHistory !== "undefined" ? rpcGetDirectMessageHistory : null; } },
    { newId: "ivx_social_dm_mark_read",        handler: function () { return typeof rpcMarkDirectMessagesRead !== "undefined" ? rpcMarkDirectMessagesRead : null; } }
  ];

  /**
   * Translate a legacy response (flat `{success, ...fields}` OR nested
   * `{success, data}` OR `{ok, ...}`) into the unified §6.1 envelope.
   * Unknown/unparseable output is passed through inside data.raw so nothing
   * is ever lost.
   */
  function toEnvelope(raw: string, gameId: string): string {
    var meta = { gameId: gameId || "quizverse", timestamp: new Date().toISOString(), apiVersion: API_VERSION };
    var parsed: any = null;
    try { parsed = JSON.parse(raw); } catch (_) {
      return JSON.stringify({ success: true, data: { raw: raw }, meta: meta });
    }
    if (parsed === null || typeof parsed !== "object") {
      return JSON.stringify({ success: true, data: { value: parsed }, meta: meta });
    }

    var success = (parsed.success === true) || (parsed.ok === true) ||
                  (parsed.success === undefined && parsed.ok === undefined && !parsed.error);
    if (!success) {
      return JSON.stringify({
        success: false,
        error: parsed.error || parsed.message || "Request failed",
        errorCode: parsed.errorCode || parsed.error_code || "unknown",
        meta: meta
      });
    }

    // Nested shape already? Keep its data. Flat shape? Lift all non-envelope
    // fields into data.
    var data: any;
    if (parsed.data !== undefined && typeof parsed.data === "object") {
      data = parsed.data;
    } else {
      data = {};
      for (var k in parsed) {
        if (!Object.prototype.hasOwnProperty.call(parsed, k)) continue;
        if (k === "success" || k === "ok" || k === "error" || k === "errorCode") continue;
        data[k] = parsed[k];
      }
    }
    return JSON.stringify({ success: true, data: data, meta: meta });
  }

  function makeAlias(def: AliasDef) {
    return function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
      var gameId = "quizverse";
      try {
        var p = payload ? JSON.parse(payload) : {};
        if (p && typeof p.gameId === "string" && p.gameId) gameId = p.gameId;
      } catch (_) {}
      var fn = def.handler();
      if (typeof fn !== "function") {
        return JSON.stringify({
          success: false, error: "Handler unavailable", errorCode: "handler_missing",
          meta: { gameId: gameId, timestamp: new Date().toISOString(), apiVersion: API_VERSION }
        });
      }
      var raw = "";
      try {
        raw = fn(ctx, logger, nk, payload);
      } catch (e: any) {
        return JSON.stringify({
          success: false, error: (e && e.message) || "Internal error", errorCode: "internal",
          meta: { gameId: gameId, timestamp: new Date().toISOString(), apiVersion: API_VERSION }
        });
      }
      return toEnvelope(raw, gameId);
    };
  }

  export function register(initializer: nkruntime.Initializer): void {
    // NOTE: postbuild requires literal RPC id strings in registerRpc calls —
    // a loop with variable ids would not survive the AST walker. Each alias
    // is therefore registered with its literal id below.
    initializer.registerRpc("ivx_social_invite_send",          makeAlias(ALIASES[0]));
    initializer.registerRpc("ivx_social_invite_accept",        makeAlias(ALIASES[1]));
    initializer.registerRpc("ivx_social_invite_decline",       makeAlias(ALIASES[2]));
    initializer.registerRpc("ivx_social_invite_cancel",        makeAlias(ALIASES[3]));
    initializer.registerRpc("ivx_social_invites_pending",      makeAlias(ALIASES[4]));
    initializer.registerRpc("ivx_social_challenge_send",       makeAlias(ALIASES[5]));
    initializer.registerRpc("ivx_social_challenge_accept",     makeAlias(ALIASES[6]));
    initializer.registerRpc("ivx_social_challenge_decline",    makeAlias(ALIASES[7]));
    initializer.registerRpc("ivx_social_challenge_cancel",     makeAlias(ALIASES[8]));
    initializer.registerRpc("ivx_social_challenges_pending",   makeAlias(ALIASES[9]));
    initializer.registerRpc("ivx_social_spectate",             makeAlias(ALIASES[10]));
    initializer.registerRpc("ivx_social_streak_get",           makeAlias(ALIASES[11]));
    initializer.registerRpc("ivx_social_streak_record",        makeAlias(ALIASES[12]));
    initializer.registerRpc("ivx_social_streak_nudge",         makeAlias(ALIASES[13]));
    initializer.registerRpc("ivx_social_streak_broken_log",    makeAlias(ALIASES[14]));
    initializer.registerRpc("ivx_social_streak_repair",        makeAlias(ALIASES[15]));
    initializer.registerRpc("ivx_social_friends_online_count", makeAlias(ALIASES[16]));
    initializer.registerRpc("ivx_social_battle_create",        makeAlias(ALIASES[17]));
    initializer.registerRpc("ivx_social_invite_with_reward",   makeAlias(ALIASES[18]));
    initializer.registerRpc("ivx_social_dm_send",              makeAlias(ALIASES[19]));
    initializer.registerRpc("ivx_social_dm_history",           makeAlias(ALIASES[20]));
    initializer.registerRpc("ivx_social_dm_mark_read",         makeAlias(ALIASES[21]));
  }
}
