// data/modules/ivx_quest/ivx_quest.js
//
// IVX cross-game quest layer (distinct from QuizVerse's friend_quest_*).
// Closes 4 of the 36 standalone-SDK gaps documented in
// docs/SDK_NAKAMA_SYNC.md §2:
//   • ivx_quest_config   — list available quests (catalog)
//   • ivx_quest_get      — read user's active + completed quest state
//   • ivx_quest_progress — record progress on a quest
//   • ivx_quest_claim    — claim reward when objective met
//
// STORAGE
//   collection "ivx_quests"       key=userId      owner=user
//     { active: { qid: { progress, target, startedAt, expiresAt } },
//       completed: [ { qid, completedAt, claimed } ],
//       totalEarned: { coins, xp } }
//
//   collection "ivx_quests_catalog" key="active"   owner=system
//     { quests: [ { id, name, type, target, rewards:{coins,xp},
//                   durationDays, gameId, description } ] }
//
// RISK TO QUIZVERSE: zero. New collections, new RPC names, no overlap with
// friend_quest_* (which is QuizVerse-only and friend-bound). The catalog
// has a built-in default so the SDK works out-of-box without admin setup.

var IVX_QUEST_COLLECTION = "ivx_quests";
var IVX_QUEST_CATALOG_COLLECTION = "ivx_quests_catalog";
var IVX_QUEST_CATALOG_KEY = "active";
var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

// ── Default catalog (used when no admin-set catalog exists) ───────
// Three baseline cross-game quests so the SDK has something to show
// on day-one. All cross-game (gameId="*") so they accumulate from any
// IVX-enrolled title.
var IVX_DEFAULT_CATALOG = {
    quests: [
        {
            id: "ivx_play_3_games",
            name: "Triple Play",
            description: "Complete 3 quizzes/games in any IVX title",
            type: "session_count",
            target: 3,
            rewards: { coins: 100, xp: 50 },
            durationDays: 1,
            gameId: "*"
        },
        {
            id: "ivx_score_1000",
            name: "Score Hunter",
            description: "Earn a cumulative 1000 points across IVX titles today",
            type: "score_total",
            target: 1000,
            rewards: { coins: 250, xp: 120 },
            durationDays: 1,
            gameId: "*"
        },
        {
            id: "ivx_weekly_streak",
            name: "Weekly Warrior",
            description: "Open any IVX game on 5 different days this week",
            type: "daily_open_count",
            target: 5,
            rewards: { coins: 750, xp: 400 },
            durationDays: 7,
            gameId: "*"
        }
    ]
};

function _readCatalog(nk) {
    try {
        var rows = nk.storageRead([{
            collection: IVX_QUEST_CATALOG_COLLECTION,
            key: IVX_QUEST_CATALOG_KEY,
            userId: SYSTEM_USER
        }]);
        if (rows && rows.length > 0 && rows[0].value && Array.isArray(rows[0].value.quests)) {
            return rows[0].value;
        }
    } catch (e) { /* fall through to default */ }
    return IVX_DEFAULT_CATALOG;
}

function _readUserState(nk, userId) {
    try {
        var rows = nk.storageRead([{
            collection: IVX_QUEST_COLLECTION,
            key: userId,
            userId: userId
        }]);
        if (rows && rows.length > 0 && rows[0].value) {
            var v = rows[0].value;
            return {
                active: v.active || {},
                completed: Array.isArray(v.completed) ? v.completed : [],
                totalEarned: v.totalEarned || { coins: 0, xp: 0 }
            };
        }
    } catch (e) { /* new user */ }
    return { active: {}, completed: [], totalEarned: { coins: 0, xp: 0 } };
}

function _writeUserState(nk, userId, state) {
    nk.storageWrite([{
        collection: IVX_QUEST_COLLECTION,
        key: userId,
        userId: userId,
        value: state,
        permissionRead: 1,
        permissionWrite: 1
    }]);
}

function _findQuestInCatalog(catalog, questId) {
    for (var i = 0; i < catalog.quests.length; i++) {
        if (catalog.quests[i].id === questId) return catalog.quests[i];
    }
    return null;
}

function _ensureActive(state, quest, nowSec) {
    if (state.active[quest.id]) return state.active[quest.id];
    var entry = {
        progress: 0,
        target: quest.target,
        startedAt: nowSec,
        expiresAt: nowSec + (quest.durationDays || 1) * 86400
    };
    state.active[quest.id] = entry;
    return entry;
}

// ── ivx_quest_config — return the active quest catalog ────────────

function rpcIvxQuestConfig(ctx, logger, nk, payload) {
    try {
        var catalog = _readCatalog(nk);
        return JSON.stringify({ success: true, data: { catalog: catalog } });
    } catch (err) {
        logger.warn("[ivx_quest_config] " + err.message);
        return JSON.stringify({ success: false, error: err.message || "catalog_read_failed" });
    }
}

// ── ivx_quest_get — return user's active+completed quest state ────

function rpcIvxQuestGet(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: "no_session" });
        var catalog = _readCatalog(nk);
        var state = _readUserState(nk, ctx.userId);
        var nowSec = Math.floor(Date.now() / 1000);

        // Auto-prune expired actives (no claim path → silent expiry).
        var prunedKeys = Object.keys(state.active);
        for (var i = 0; i < prunedKeys.length; i++) {
            var k = prunedKeys[i];
            if (state.active[k].expiresAt && state.active[k].expiresAt < nowSec) {
                delete state.active[k];
            }
        }

        // Decorate active entries with catalog metadata so the SDK can
        // render them without a second round-trip.
        var activeDecorated = {};
        var activeKeys = Object.keys(state.active);
        for (var j = 0; j < activeKeys.length; j++) {
            var qid = activeKeys[j];
            var meta = _findQuestInCatalog(catalog, qid);
            activeDecorated[qid] = {
                progress: state.active[qid].progress,
                target: state.active[qid].target,
                startedAt: state.active[qid].startedAt,
                expiresAt: state.active[qid].expiresAt,
                meta: meta || null
            };
        }

        return JSON.stringify({
            success: true,
            data: {
                active: activeDecorated,
                completed: state.completed,
                totalEarned: state.totalEarned
            }
        });
    } catch (err) {
        logger.warn("[ivx_quest_get] " + err.message);
        return JSON.stringify({ success: false, error: err.message || "state_read_failed" });
    }
}

// ── ivx_quest_progress — record N units of progress on a quest ────

function rpcIvxQuestProgress(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: "no_session" });
        var p = {};
        try { p = JSON.parse(payload || "{}"); } catch (_) { /* tolerate */ }

        var questId = p.questId || p.quest_id;
        var amount = parseInt(p.amount || 1, 10);
        if (!questId) return JSON.stringify({ success: false, error: "questId_required" });
        if (!isFinite(amount) || amount <= 0) amount = 1;

        var catalog = _readCatalog(nk);
        var quest = _findQuestInCatalog(catalog, questId);
        if (!quest) return JSON.stringify({ success: false, error: "unknown_quest_id" });

        var state = _readUserState(nk, ctx.userId);
        var nowSec = Math.floor(Date.now() / 1000);
        var entry = _ensureActive(state, quest, nowSec);

        // Cap at target — clients can over-report safely.
        entry.progress = Math.min(entry.target, entry.progress + amount);
        var done = entry.progress >= entry.target;

        _writeUserState(nk, ctx.userId, state);

        return JSON.stringify({
            success: true,
            data: {
                questId: questId,
                progress: entry.progress,
                target: entry.target,
                completed: done
            }
        });
    } catch (err) {
        logger.warn("[ivx_quest_progress] " + err.message);
        return JSON.stringify({ success: false, error: err.message || "progress_failed" });
    }
}

// ── ivx_quest_claim — move a completed quest to completed[] + grant ──

function rpcIvxQuestClaim(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: "no_session" });
        var p = {};
        try { p = JSON.parse(payload || "{}"); } catch (_) { /* tolerate */ }

        var questId = p.questId || p.quest_id;
        if (!questId) return JSON.stringify({ success: false, error: "questId_required" });

        var catalog = _readCatalog(nk);
        var quest = _findQuestInCatalog(catalog, questId);
        if (!quest) return JSON.stringify({ success: false, error: "unknown_quest_id" });

        var state = _readUserState(nk, ctx.userId);
        var entry = state.active[questId];
        if (!entry) return JSON.stringify({ success: false, error: "quest_not_active" });
        if (entry.progress < entry.target) {
            return JSON.stringify({
                success: false,
                error: "quest_not_complete",
                progress: entry.progress,
                target: entry.target
            });
        }

        // Idempotency — if already in completed[] AND claimed, no-op.
        for (var i = 0; i < state.completed.length; i++) {
            if (state.completed[i].qid === questId && state.completed[i].claimed) {
                return JSON.stringify({
                    success: true,
                    data: { alreadyClaimed: true, rewards: quest.rewards }
                });
            }
        }

        var nowSec = Math.floor(Date.now() / 1000);
        var rewards = quest.rewards || { coins: 0, xp: 0 };
        state.completed.push({
            qid: questId,
            completedAt: nowSec,
            claimed: true,
            rewards: rewards
        });
        state.totalEarned.coins = (state.totalEarned.coins || 0) + (rewards.coins || 0);
        state.totalEarned.xp = (state.totalEarned.xp || 0) + (rewards.xp || 0);
        delete state.active[questId];

        _writeUserState(nk, ctx.userId, state);

        return JSON.stringify({
            success: true,
            data: { claimed: true, rewards: rewards, totalEarned: state.totalEarned }
        });
    } catch (err) {
        logger.warn("[ivx_quest_claim] " + err.message);
        return JSON.stringify({ success: false, error: err.message || "claim_failed" });
    }
}

// ── Module init ───────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("ivx_quest_config",   rpcIvxQuestConfig);
    initializer.registerRpc("ivx_quest_get",      rpcIvxQuestGet);
    initializer.registerRpc("ivx_quest_progress", rpcIvxQuestProgress);
    initializer.registerRpc("ivx_quest_claim",    rpcIvxQuestClaim);
    logger.info("[ivx_quest] Module registered: 4 RPCs (cross-game IVX quest layer)");
}
