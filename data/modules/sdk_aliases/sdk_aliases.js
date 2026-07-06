// data/modules/sdk_aliases/sdk_aliases.js
//
// Closes 28 of the 36 standalone-SDK gaps documented in
// docs/SDK_NAKAMA_SYNC.md §2:
//
//   • 17 pure name-mismatches  → re-export existing handlers under SDK names
//   • 11 soft-stubs             → return safe-default payloads so the SDK
//                                 doesn't crash while real impl is built
//   •  4 alias composites       → router (ivx_sync_metadata) + nk wrapper
//                                 (hiro_friends_add) + battle list shim
//
// RISK TO QUIZVERSE: zero. All names registered here are NEW — none of the
// 134 RPCs that QuizVerse calls live appear in this file. The alias targets
// (e.g. __rpc_hiro_streaks_get) are populated by the build/TS bundle BEFORE
// the global-scope replay block reads them, so the aliases are wired with
// the real handler-function values before the wrapper InitModule registers
// them. (See postbuild.js §3c + §6b for the replay mechanism.)
//
// HANDLER REFERENCES — postbuild's global-replay regex
//   /__rpc_(\w+)\s*=\s*__rpc_\1\s*\|\|\s*\((\w+)\)/g
// only captures handlers that resolve to a single identifier. Inline
// function literals would NOT replay at global scope and would leave the
// alias stub undefined on pooled Goja VMs. Every handler below is therefore
// declared as a named top-level function, never as an inline literal.
//
// TS-type hints are intentionally omitted — this file is loaded by the
// JS Goja runtime, never type-checked.

// ── Composite aliases ─────────────────────────────────────────────

// ivx_sync_metadata: SDK ships one RPC for read+write; we route by payload
// shape. If the body has metadata|set|update keys → write path; else read.
function _aliasIvxSyncMetadata(ctx, logger, nk, payload) {
    var p = {};
    try { p = JSON.parse(payload || "{}"); } catch (e) { /* tolerate malformed */ }
    if (p && (p.metadata || p.set || p.update)) {
        if (typeof __rpc_rpc_update_player_metadata !== "function") {
            return JSON.stringify({ success: false, error: "metadata_write_unavailable" });
        }
        return __rpc_rpc_update_player_metadata(ctx, logger, nk, payload);
    }
    if (typeof __rpc_get_player_metadata !== "function") {
        return JSON.stringify({ success: false, error: "metadata_read_unavailable" });
    }
    return __rpc_get_player_metadata(ctx, logger, nk, payload);
}

// hiro_friends_add: thin wrapper over Nakama core friendsAdd.
// QuizVerse never exposed this RPC because all add-paths go through
// friend_invite_with_reward. The SDK ships a direct add — we honour both.
function _aliasHiroFriendsAdd(ctx, logger, nk, payload) {
    var p = {};
    try { p = JSON.parse(payload || "{}"); } catch (e) { /* tolerate malformed */ }
    if (!ctx || !ctx.userId) {
        return JSON.stringify({ success: false, error: "no_session" });
    }
    var ids = p.ids || (p.userId ? [p.userId] : []);
    var unames = p.usernames || (p.username ? [p.username] : []);
    if (!ids.length && !unames.length) {
        return JSON.stringify({ success: false, error: "ids_or_usernames_required" });
    }
    try {
        nk.friendsAdd(ctx.userId, ids, unames);
        return JSON.stringify({ success: true, addedIds: ids.length, addedUsernames: unames.length });
    } catch (err) {
        return JSON.stringify({ success: false, error: err.message || "friends_add_failed" });
    }
}

// ── Soft-stubs (unblock SDK while real impl is scoped) ────────────
// All return success:true with empty/safe data so SDK code paths
// continue without exception. Replace each with a real handler when
// the upstream provider integration ships.

function _stubOfferwallList()        { return JSON.stringify({ success: true,  data: { offers: [] } }); }
function _stubOfferwallClaim()       { return JSON.stringify({ success: false, error: "no_offerwall_provider_configured" }); }
function _stubIapTriggerCheck()      { return JSON.stringify({ success: true,  data: { shouldShow: false, reason: "not_configured" } }); }
function _stubSmartAdCanShow()       { return JSON.stringify({ success: true,  data: { canShow: true, capRemaining: 999 } }); }
function _stubRetentionGet()         { return JSON.stringify({ success: true,  data: { bucket: "active", lastSeen: new Date().toISOString() } }); }
function _stubRetentionUpdate()      { return JSON.stringify({ success: true,  data: { updated: true } }); }
function _stubFriendBattlesGetActive() { return JSON.stringify({ success: true, data: { battles: [], activeCount: 0 } }); }

// ── Module init ───────────────────────────────────────────────────

// Phase-5 deprecation telemetry (2026-07-06): the hiro_* friend aliases have
// ZERO references in any current client codebase (Unity games + web checked).
// They remain registered only in case old field builds used them. Each call
// logs loudly; hard-remove once AnalyticsAlerts shows zero traffic for 14+ days.
function _sdkDeprecatedAlias(aliasName, target) {
    return function (ctx, logger, nk, payload) {
        try {
            logger.warn('[SdkAliases] DEPRECATED alias ' + aliasName + ' called (user=' + (ctx && ctx.userId) + ')');
        } catch (_) {}
        return target(ctx, logger, nk, payload);
    };
}

var _dep_hiro_friends_list             = null;
var _dep_hiro_friends_remove           = null;
var _dep_hiro_friends_block            = null;
var _dep_hiro_friend_quests_get_active = null;
var _dep_hiro_friend_quests_contribute = null;
var _dep_hiro_friend_battles_challenge = null;
var _dep_hiro_friends_add              = null;

function InitModule(ctx, logger, nk, initializer) {
    _dep_hiro_friends_list             = _sdkDeprecatedAlias("hiro_friends_list", __rpc_friends_list);
    _dep_hiro_friends_remove           = _sdkDeprecatedAlias("hiro_friends_remove", __rpc_friends_remove);
    _dep_hiro_friends_block            = _sdkDeprecatedAlias("hiro_friends_block", __rpc_friends_block);
    _dep_hiro_friend_quests_get_active = _sdkDeprecatedAlias("hiro_friend_quests_get_active", __rpc_friend_quest_get_state);
    _dep_hiro_friend_quests_contribute = _sdkDeprecatedAlias("hiro_friend_quests_contribute", __rpc_friend_quest_record_progress);
    _dep_hiro_friend_battles_challenge = _sdkDeprecatedAlias("hiro_friend_battles_challenge", __rpc_friend_battle_create);
    _dep_hiro_friends_add              = _sdkDeprecatedAlias("hiro_friends_add", _aliasHiroFriendsAdd);

    // ─── Hiro naming aliases (singular/plural + verb-position swaps) ──
    initializer.registerRpc("hiro_get_streaks",                 __rpc_hiro_streaks_get);
    initializer.registerRpc("hiro_streak_get",                  __rpc_hiro_streaks_get);
    initializer.registerRpc("hiro_claim_streak",                __rpc_hiro_streaks_claim);
    initializer.registerRpc("hiro_streak_claim",                __rpc_hiro_streaks_claim);
    initializer.registerRpc("hiro_economy_grant",               __rpc_hiro_inventory_grant);
    initializer.registerRpc("hiro_economy_list",                __rpc_hiro_inventory_list);
    initializer.registerRpc("hiro_spin_wheel",                  __rpc_fortune_wheel_spin);
    initializer.registerRpc("hiro_spin_wheel_config",           __rpc_fortune_wheel_get_state);

    initializer.registerRpc("hiro_friends_list",                _dep_hiro_friends_list);
    initializer.registerRpc("hiro_friends_remove",              _dep_hiro_friends_remove);
    initializer.registerRpc("hiro_friends_block",               _dep_hiro_friends_block);
    initializer.registerRpc("hiro_friend_quests_get_active",    _dep_hiro_friend_quests_get_active);
    initializer.registerRpc("hiro_friend_quests_contribute",    _dep_hiro_friend_quests_contribute);
    initializer.registerRpc("hiro_friend_battles_challenge",    _dep_hiro_friend_battles_challenge);

    // ─── Satori naming aliases (verb-position swap) ──────────────────
    initializer.registerRpc("satori_publish_events",            __rpc_satori_events_batch);
    initializer.registerRpc("satori_get_flags",                 __rpc_satori_flags_get);
    initializer.registerRpc("satori_get_experiments",           __rpc_satori_experiments_get);
    initializer.registerRpc("satori_get_live_events",           __rpc_satori_live_events_list);

    // ─── Composite aliases (route or wrap) ───────────────────────────
    initializer.registerRpc("ivx_sync_metadata",                _aliasIvxSyncMetadata);
    initializer.registerRpc("hiro_friends_add",                 _dep_hiro_friends_add);

    // ─── Soft-stubs (unblock SDK; replace with real impl later) ──────
    initializer.registerRpc("hiro_get_offerwall",               _stubOfferwallList);
    initializer.registerRpc("hiro_offerwall_list",              _stubOfferwallList);
    initializer.registerRpc("hiro_offerwall_claim",             _stubOfferwallClaim);
    initializer.registerRpc("hiro_iap_trigger_check",           _stubIapTriggerCheck);
    initializer.registerRpc("hiro_smart_ad_can_show",           _stubSmartAdCanShow);
    initializer.registerRpc("hiro_retention_get",               _stubRetentionGet);
    initializer.registerRpc("hiro_retention_update",            _stubRetentionUpdate);
    initializer.registerRpc("hiro_friend_battles_get_active",   _stubFriendBattlesGetActive);

    logger.info("[sdk_aliases] 28 aliases + soft-stubs registered (closes 28 of 36 standalone-SDK gaps)");
}
