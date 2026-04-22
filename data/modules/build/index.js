"use strict";
function InitModule(ctx, logger, nk, initializer) {
    logger.info("========================================");
    logger.info("IntelliVerse-X Nakama Runtime v2.0");
    logger.info("Hiro + Satori Custom Build");
    logger.info("========================================");
    // ---- JS-runtime health probe (registered FIRST so it's available even
    //      if any later subsystem fails). Used by the k8s liveness/readiness
    //      probe and the CI deploy gate to detect "JS bundle failed to
    //      compile" — the cbeacf6 outage mode where Nakama serves HTTP 200
    //      on /healthcheck but every game RPC is dead.
    try {
        JsRuntimeHealth.register(initializer);
        logger.info("[Health] nakama_js_health registered");
    }
    catch (err) {
        logger.error("[Health] failed to register nakama_js_health: " + (err && err.message ? err.message : String(err)));
    }
    // ---- Analytics Alerts: init + instrument initializer BEFORE any module registers RPCs ----
    // Every subsequent initializer.registerRpc() call is auto-wrapped with timing/error capture.
    // The analytics RPCs themselves are registered on the ORIGINAL initializer to avoid
    // sampling-the-sampler recursion via the opportunistic scheduler tick.
    var originalInitializer = initializer;
    try {
        AnalyticsAlerts.init(ctx, logger);
        AnalyticsAlerts.register(originalInitializer);
        initializer = AnalyticsAlerts.instrumentInitializer(originalInitializer, logger);
        logger.info("[AnalyticsAlerts] hooks installed; all subsequent RPCs will be sampled");
    }
    catch (err) {
        logger.error("[AnalyticsAlerts] failed to install: " + (err && err.message ? err.message : String(err)));
    }
    // ---- Legacy System Registration (backward-compatible RPCs) ----
    try {
        logger.info("[Legacy] Registering wallet RPCs...");
        LegacyWallet.register(initializer);
        logger.info("[Legacy] Registering leaderboard RPCs...");
        LegacyLeaderboards.register(initializer);
        logger.info("[Legacy] Registering game registry RPCs...");
        LegacyGameRegistry.register(initializer);
        logger.info("[Legacy] Registering daily rewards RPCs...");
        LegacyDailyRewards.register(initializer);
        logger.info("[Legacy] Registering quiz RPCs...");
        LegacyQuiz.register(initializer);
        logger.info("[Legacy] Registering game entry RPCs...");
        LegacyGameEntry.register(initializer);
        logger.info("[Legacy] Registering missions RPCs...");
        LegacyMissions.register(initializer);
        logger.info("[Legacy] Registering analytics RPCs...");
        LegacyAnalytics.register(initializer);
        logger.info("[Legacy] Registering friends RPCs...");
        LegacyFriends.register(initializer);
        // ── First-class IntelliVerse friend search (replaces the historical
        //   quizverse_find_friends / lasttolive_find_friends RPCs which lived
        //   in `data/modules/multigame_rpcs.js` + `legacy_runtime.js` and were
        //   silently shadowed by a stub. The new TS implementation is in
        //   src/friends/find_friends.ts and wins precedence because main.ts
        //   runs before the legacy bridge and `intelliverse_find_friends` is
        //   pinned in `_tsRpcList` below.) ────────────────────────────────────
        logger.info("[Friends] Bootstrapping fuzzy-search DB extension + indexes (idempotent)...");
        // Ensures pg_trgm + GIN trigram indexes exist on users.username and
        // users.display_name. Safe to run on every boot — every statement uses
        // IF NOT EXISTS. If the runtime DB user lacks SUPERUSER (needed for
        // CREATE EXTENSION), the call logs a one-time WARN and the RPC handler
        // automatically degrades to ILIKE-only search (still tiered, no fuzzy).
        IntelliverseFriends.bootstrapDatabase(nk, logger);
        logger.info("[Friends] Registering intelliverse_find_friends RPC...");
        IntelliverseFriends.register(initializer);
        // ── Phase-4 C1+H1: canonical friends_list + list_blocked_users with
        //   flat shape + presence/relationship enrichment. Replaces the
        //   6-line passthrough that used to live in LegacyFriends.rpcFriendsList
        //   (which has been stripped from src/legacy/friends.ts in the same
        //   change) and adds the new list_blocked_users RPC. Both pinned in
        //   _tsRpcList below so the legacy bridge cannot shadow them. ────────
        logger.info("[Friends] Registering canonical friends_list + list_blocked_users...");
        IntelliverseFriendsList.register(initializer);
        logger.info("[Legacy] Registering groups RPCs...");
        LegacyGroups.register(initializer);
        logger.info("[Legacy] Registering push RPCs...");
        LegacyPush.register(initializer);
        logger.info("[Legacy] Registering player RPCs...");
        LegacyPlayer.register(initializer);
        logger.info("[Legacy] Registering chat RPCs...");
        LegacyChat.register(initializer);
        logger.info("[Legacy] Registering quests-economy bridge RPCs...");
        LegacyQuestsEconomyBridge.register(initializer);
        logger.info("[Legacy] Registering multi-game RPCs...");
        LegacyMultiGame.register(initializer);
        logger.info("[Shared] Registering storage RPCs...");
        Storage.register(initializer);
        logger.info("[Legacy] Registering analytics retention RPCs...");
        LegacyAnalyticsRetention.register(initializer);
        logger.info("[Legacy] Registering gift cards RPCs...");
        LegacyGiftCards.register(initializer);
        logger.info("[Legacy] Registering coupons RPCs...");
        LegacyCoupons.register(initializer);
        logger.info("[Legacy] All legacy RPCs registered successfully");
    }
    catch (err) {
        logger.error("[Legacy] Failed to register legacy RPCs: " + (err.message || String(err)));
    }
    // ---- Hiro Systems Registration ----
    try {
        logger.info("[Hiro] Registering Economy RPCs...");
        HiroEconomy.register(initializer);
        logger.info("[Hiro] Registering Inventory RPCs...");
        HiroInventory.register(initializer);
        logger.info("[Hiro] Registering Achievements RPCs...");
        HiroAchievements.register(initializer);
        logger.info("[Hiro] Registering Progression RPCs...");
        HiroProgression.register(initializer);
        logger.info("[Hiro] Registering Energy RPCs...");
        HiroEnergy.register(initializer);
        logger.info("[Hiro] Registering Stats RPCs...");
        HiroStats.register(initializer);
        logger.info("[Hiro] Registering Event Leaderboards RPCs...");
        HiroEventLeaderboards.register(initializer);
        logger.info("[Hiro] Registering Streaks RPCs...");
        HiroStreaks.register(initializer);
        logger.info("[Hiro] Registering Store RPCs...");
        HiroStore.register(initializer);
        logger.info("[Hiro] Registering Challenges RPCs...");
        HiroChallenges.register(initializer);
        logger.info("[Hiro] Registering Teams RPCs...");
        HiroTeams.register(initializer);
        logger.info("[Hiro] Registering Tutorials RPCs...");
        HiroTutorials.register(initializer);
        logger.info("[Hiro] Registering Unlockables RPCs...");
        HiroUnlockables.register(initializer);
        logger.info("[Hiro] Registering Auctions RPCs...");
        HiroAuctions.register(initializer);
        logger.info("[Hiro] Registering Incentives RPCs...");
        HiroIncentives.register(initializer);
        logger.info("[Hiro] Registering Mailbox RPCs...");
        HiroMailbox.register(initializer);
        logger.info("[Hiro] Registering Reward Bucket RPCs...");
        HiroRewardBucket.register(initializer);
        logger.info("[Hiro] Registering Creator Event Rewards RPCs...");
        HiroCreatorEventRewards.register(initializer);
        logger.info("[Hiro] Registering Personalizers RPCs...");
        HiroPersonalizers.register(initializer);
        logger.info("[Hiro] Registering Base Module RPCs...");
        HiroBase.register(initializer);
        logger.info("[Hiro] Registering Leaderboards RPCs...");
        HiroLeaderboards.register(initializer);
        logger.info("[Hiro] All Hiro systems registered successfully");
    }
    catch (err) {
        logger.error("[Hiro] Failed to register Hiro systems: " + (err.message || String(err)));
    }
    // ---- Satori Systems Registration ----
    try {
        logger.info("[Satori] Registering Event Capture RPCs...");
        SatoriEventCapture.register(initializer);
        logger.info("[Satori] Registering Identities RPCs...");
        SatoriIdentities.register(initializer);
        logger.info("[Satori] Registering Audiences RPCs...");
        SatoriAudiences.register(initializer);
        logger.info("[Satori] Registering Feature Flags RPCs...");
        SatoriFeatureFlags.register(initializer);
        logger.info("[Satori] Registering Experiments RPCs...");
        SatoriExperiments.register(initializer);
        logger.info("[Satori] Registering Live Events RPCs...");
        SatoriLiveEvents.register(initializer);
        logger.info("[Satori] Registering Creator Events RPCs...");
        SatoriCreatorEvents.register(initializer);
        logger.info("[Satori] Registering Video Feed RPCs...");
        SatoriVideoFeed.register(initializer);
        logger.info("[Satori] Registering Messages RPCs...");
        SatoriMessages.register(initializer);
        logger.info("[Satori] Registering Metrics RPCs...");
        SatoriMetrics.register(initializer);
        logger.info("[Satori] Registering Webhooks RPCs...");
        SatoriWebhooks.register(initializer);
        logger.info("[Satori] Registering Taxonomy RPCs...");
        SatoriTaxonomy.register(initializer);
        logger.info("[Satori] Registering Data Lake RPCs...");
        SatoriDataLake.register(initializer);
        logger.info("[Satori] All Satori systems registered successfully");
    }
    catch (err) {
        logger.error("[Satori] Failed to register Satori systems: " + (err.message || String(err)));
    }
    // ---- Fantasy Cricket RPCs ----
    try {
        logger.info("[Fantasy] Registering Team RPCs...");
        FantasyTeam.register(initializer);
        logger.info("[Fantasy] Registering Transfer RPCs...");
        FantasyTransfer.register(initializer);
        logger.info("[Fantasy] Registering Scoring Engine RPCs...");
        FantasyScoring.register(initializer);
        logger.info("[Fantasy] Registering League RPCs...");
        FantasyLeague.register(initializer);
        logger.info("[Fantasy] All Fantasy Cricket RPCs registered successfully");
    }
    catch (err) {
        logger.error("[Fantasy] Failed to register Fantasy Cricket RPCs: " + (err.message || String(err)));
    }
    // ---- Cricket Game Modules ----
    try {
        logger.info("[Cricket] Registering Auction RPCs...");
        CricketAuction.register(initializer);
        logger.info("[Cricket] Registering Director RPCs...");
        CricketDirector.register(initializer);
        logger.info("[Cricket] All Cricket RPCs registered successfully");
    }
    catch (err) {
        logger.error("[Cricket] Failed to register Cricket RPCs: " + (err.message || String(err)));
    }
    // ---- Admin Console RPCs ----
    try {
        logger.info("[Admin] Registering Admin Console RPCs...");
        AdminConsole.register(initializer);
        logger.info("[Admin] Admin Console registered successfully");
    }
    catch (err) {
        logger.error("[Admin] Failed to register Admin Console: " + (err.message || String(err)));
    }
    // ---- Event Bus Handlers ----
    try {
        HiroAchievements.registerEventHandlers();
        SatoriMetrics.registerEventHandlers();
        HiroRewardBucket.registerEventHandlers();
        SatoriWebhooks.registerEventHandlers();
        logger.info("[EventBus] Event handlers registered");
    }
    catch (err) {
        logger.error("[EventBus] Failed to register event handlers: " + (err.message || String(err)));
    }
    // ---- Legacy Master Bridge ----
    // Bridge the RPCs from master's index.js that aren't in our TypeScript build.
    // LegacyInitModule is defined in data/modules/index.js (renamed from InitModule).
    // All handler functions live in the same VM global scope.
    //
    // The set of TS-owned RPC IDs (so the bridge knows which legacy IDs to
    // skip) is now AUTO-POPULATED by data/modules/postbuild.js as the global
    // `__TS_OWNED_RPCS`. It is built by scanning every
    // `initializer.registerRpc("...", ...)` call in src/**/*.ts at build time
    // and so cannot drift when a TS RPC is added/renamed/removed. If the
    // global is missing (e.g. the file is loaded outside the postbuild
    // pipeline), we fall back to an empty allow-set — i.e. legacy wins for
    // every duplicate ID, which is the historical behaviour and safe for
    // dev iteration.
    try {
        if (typeof LegacyInitModule === "function") {
            var _alreadyRegistered = {};
            var _tsOwned = (typeof __TS_OWNED_RPCS !== "undefined" && __TS_OWNED_RPCS) ? __TS_OWNED_RPCS : {};
            for (var _id in _tsOwned) {
                if (Object.prototype.hasOwnProperty.call(_tsOwned, _id)) {
                    _alreadyRegistered[_id] = true;
                }
            }
            var _tsOwnedCount = 0;
            for (var _k in _alreadyRegistered) {
                if (Object.prototype.hasOwnProperty.call(_alreadyRegistered, _k))
                    _tsOwnedCount++;
            }
            logger.info("[Bridge] TS-owned RPCs (auto-discovered by postbuild): " + _tsOwnedCount);
            var _bridgedCount = 0;
            var _skippedCount = 0;
            var _proxyInit = Object.create(initializer);
            _proxyInit.registerRpc = function (id, fn) {
                if (_alreadyRegistered[id]) {
                    _skippedCount++;
                }
                else {
                    initializer.registerRpc(id, fn);
                    _alreadyRegistered[id] = true;
                    _bridgedCount++;
                }
            };
            LegacyInitModule(ctx, logger, nk, _proxyInit);
            logger.info("[Bridge] Bridged " + _bridgedCount + " legacy master RPCs (skipped " + _skippedCount + " duplicates)");
        }
        else {
            logger.warn("[Bridge] LegacyInitModule not found - legacy RPCs not available");
        }
    }
    catch (err) {
        logger.error("[Bridge] Failed to bridge legacy RPCs: " + (err.message || String(err)));
    }
    logger.info("========================================");
    logger.info("IntelliVerse-X Runtime initialized!");
    logger.info("========================================");
}
/**
 * Cricket Auction — Nakama server module
 *
 * Provides real-time, server-authoritative IPL-style auction rooms.
 * Each room is identified by {leagueId}_{seasonId} and persists in
 * the CRICKET_AUCTION_COLLECTION storage collection.
 *
 * RPCs:
 *   cricket_auction_create_room   — create / reset an auction room
 *   cricket_auction_get_room      — read current room state
 *   cricket_auction_place_bid     — place a server-validated bid
 *   cricket_auction_next_player   — advance to the next nominated player
 *   cricket_auction_get_events    — paginated event log for replay / UI
 */
// ─────────────────────────────── Constants ────────────────────────────────────
var TOTAL_BUDGET = 12000;
var MAX_PLAYERS = 25;
var MAX_OVERSEAS = 8;
// ─────────────────────────────── Helpers ──────────────────────────────────────
function roomKey(leagueId, seasonId) {
    return leagueId.toLowerCase() + "_" + seasonId;
}
function readRoom(nk, key) {
    return Storage.readSystemJson(nk, Constants.CRICKET_AUCTION_COLLECTION, key);
}
function writeRoom(nk, key, state) {
    state.updatedAt = new Date().toISOString();
    Storage.writeSystemJson(nk, Constants.CRICKET_AUCTION_COLLECTION, key, state);
}
function appendEvent(nk, event) {
    Storage.writeSystemJson(nk, Constants.CRICKET_AUCTION_EVENTS_COLLECTION, event.eventId, event);
}
function generateId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).substring(2, 8);
    return ts + "_" + rand;
}
// ─────────────────────────────── RPC: Create Room ────────────────────────────
function rpcCreateRoom(ctx, logger, nk, payload) {
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId", "teams"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
    }
    var key = roomKey(data.leagueId, data.seasonId);
    var existing = readRoom(nk, key);
    if (existing && existing.status === "active") {
        return RpcHelpers.errorResponse("Auction room already active. Pause or complete it first.");
    }
    var budgets = {};
    var teams = data.teams;
    for (var i = 0; i < teams.length; i++) {
        budgets[teams[i]] = { remaining: TOTAL_BUDGET, playersAcquired: 0, overseasUsed: 0 };
    }
    var now = new Date().toISOString();
    var state = {
        leagueId: data.leagueId,
        seasonId: data.seasonId,
        status: "active",
        currentPlayer: null,
        currentBid: null,
        bidHistory: [],
        soldPlayers: [],
        unsoldPlayers: [],
        teamBudgets: budgets,
        round: 1,
        createdAt: now,
        updatedAt: now,
    };
    writeRoom(nk, key, state);
    appendEvent(nk, {
        eventId: generateId(),
        roomKey: key,
        type: "room_created",
        data: { teams: teams, round: 1 },
        userId: ctx.userId || "",
        timestamp: now,
    });
    logger.info("[CricketAuction] Room created: " + key + " with " + teams.length + " teams");
    return RpcHelpers.successResponse({ roomKey: key, status: "active", teams: teams.length });
}
// ─────────────────────────────── RPC: Get Room ───────────────────────────────
function rpcGetRoom(ctx, logger, nk, payload) {
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
    }
    var state = readRoom(nk, roomKey(data.leagueId, data.seasonId));
    if (!state) {
        return RpcHelpers.errorResponse("Auction room not found");
    }
    return RpcHelpers.successResponse(state);
}
// ─────────────────────────────── RPC: Place Bid ──────────────────────────────
function rpcPlaceBid(ctx, logger, nk, payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId", "teamId", "amount"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
    }
    var key = roomKey(data.leagueId, data.seasonId);
    var state = readRoom(nk, key);
    if (!state)
        return RpcHelpers.errorResponse("Auction room not found");
    if (state.status !== "active")
        return RpcHelpers.errorResponse("Auction is not active (status: " + state.status + ")");
    if (!state.currentPlayer)
        return RpcHelpers.errorResponse("No player currently nominated");
    var budget = state.teamBudgets[data.teamId];
    if (!budget)
        return RpcHelpers.errorResponse("Team not in this auction: " + data.teamId);
    var amount = data.amount;
    var minBid = state.currentBid ? state.currentBid.amount + 5 : state.currentPlayer.basePrice;
    if (amount < minBid)
        return RpcHelpers.errorResponse("Bid must be at least " + minBid);
    if (amount > budget.remaining)
        return RpcHelpers.errorResponse("Exceeds remaining budget (" + budget.remaining + ")");
    if (budget.playersAcquired >= MAX_PLAYERS)
        return RpcHelpers.errorResponse("Squad full (25 players)");
    var now = new Date().toISOString();
    var bid = { teamId: data.teamId, amount: amount, bidderId: userId, timestamp: now };
    state.currentBid = bid;
    state.bidHistory.push(bid);
    writeRoom(nk, key, state);
    appendEvent(nk, {
        eventId: generateId(),
        roomKey: key,
        type: "bid_placed",
        data: { teamId: data.teamId, playerId: state.currentPlayer.playerId, amount: amount },
        userId: userId,
        timestamp: now,
    });
    logger.info("[CricketAuction] Bid: " + data.teamId + " → " + amount + " for " + state.currentPlayer.playerName);
    return RpcHelpers.successResponse({
        accepted: true,
        currentBid: bid,
        budgetRemaining: budget.remaining - amount,
    });
}
// ─────────────────────────────── RPC: Next Player ────────────────────────────
function rpcNextPlayer(ctx, logger, nk, payload) {
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
    }
    var key = roomKey(data.leagueId, data.seasonId);
    var state = readRoom(nk, key);
    if (!state)
        return RpcHelpers.errorResponse("Auction room not found");
    if (state.status !== "active")
        return RpcHelpers.errorResponse("Auction is not active");
    var now = new Date().toISOString();
    // Resolve current player if there was one
    if (state.currentPlayer) {
        if (state.currentBid) {
            var winTeam = state.currentBid.teamId;
            var winAmount = state.currentBid.amount;
            state.soldPlayers.push({
                playerId: state.currentPlayer.playerId,
                playerName: state.currentPlayer.playerName,
                soldToTeamId: winTeam,
                soldPrice: winAmount,
            });
            state.teamBudgets[winTeam].remaining -= winAmount;
            state.teamBudgets[winTeam].playersAcquired++;
            appendEvent(nk, {
                eventId: generateId(),
                roomKey: key,
                type: "player_sold",
                data: { playerId: state.currentPlayer.playerId, teamId: winTeam, price: winAmount },
                userId: ctx.userId || "",
                timestamp: now,
            });
            logger.info("[CricketAuction] SOLD: " + state.currentPlayer.playerName + " → " + winTeam + " @ " + winAmount);
        }
        else {
            state.unsoldPlayers.push(state.currentPlayer.playerId);
            appendEvent(nk, {
                eventId: generateId(),
                roomKey: key,
                type: "player_unsold",
                data: { playerId: state.currentPlayer.playerId },
                userId: ctx.userId || "",
                timestamp: now,
            });
            logger.info("[CricketAuction] UNSOLD: " + state.currentPlayer.playerName);
        }
    }
    // Nominate next player (from payload or null to complete)
    if (data.nextPlayer) {
        var np = {
            playerId: data.nextPlayer.playerId,
            playerName: data.nextPlayer.playerName || data.nextPlayer.playerId,
            basePrice: data.nextPlayer.basePrice || 20,
            category: data.nextPlayer.category || "General",
            role: data.nextPlayer.role || "Unknown",
            nationality: data.nextPlayer.nationality || "",
        };
        state.currentPlayer = np;
        state.currentBid = null;
        state.bidHistory = [];
        appendEvent(nk, {
            eventId: generateId(),
            roomKey: key,
            type: "next_player",
            data: { playerId: np.playerId, basePrice: np.basePrice },
            userId: ctx.userId || "",
            timestamp: now,
        });
    }
    else {
        state.currentPlayer = null;
        state.currentBid = null;
        state.status = "completed";
        appendEvent(nk, {
            eventId: generateId(),
            roomKey: key,
            type: "room_completed",
            data: { soldCount: state.soldPlayers.length, unsoldCount: state.unsoldPlayers.length },
            userId: ctx.userId || "",
            timestamp: now,
        });
        logger.info("[CricketAuction] Auction completed: " + key);
    }
    writeRoom(nk, key, state);
    return RpcHelpers.successResponse(state);
}
// ─────────────────────────────── RPC: Get Events ─────────────────────────────
function rpcGetEvents(ctx, logger, nk, payload) {
    var data = RpcHelpers.parseRpcPayload(payload);
    var validation = RpcHelpers.validatePayload(data, ["leagueId", "seasonId"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("Missing fields: " + validation.missing.join(", "));
    }
    var key = roomKey(data.leagueId, data.seasonId);
    var limit = data.limit || 50;
    var cursor = data.cursor || "";
    var result = Storage.listUserRecords(nk, Constants.CRICKET_AUCTION_EVENTS_COLLECTION, Constants.SYSTEM_USER_ID, limit, cursor);
    var events = [];
    for (var i = 0; i < result.records.length; i++) {
        var rec = result.records[i].value;
        if (rec.roomKey === key) {
            events.push(rec);
        }
    }
    return RpcHelpers.successResponse({
        events: events,
        cursor: result.cursor || null,
        total: events.length,
    });
}
// ─────────────────────────────── Registration ────────────────────────────────
var CricketAuction;
(function (CricketAuction) {
    function register(initializer) {
        initializer.registerRpc("cricket_auction_create_room", rpcCreateRoom);
        initializer.registerRpc("cricket_auction_get_room", rpcGetRoom);
        initializer.registerRpc("cricket_auction_place_bid", rpcPlaceBid);
        initializer.registerRpc("cricket_auction_next_player", rpcNextPlayer);
        initializer.registerRpc("cricket_auction_get_events", rpcGetEvents);
    }
    CricketAuction.register = register;
})(CricketAuction || (CricketAuction = {}));
/**
 * Cricket Director — Nakama server module
 *
 * Enforces single-active session per player for the AI Director game mode.
 * Supports save / resume / end flows so players can leave and return
 * to the exact same game state.
 *
 * Storage: CRICKET_DIRECTOR_COLLECTION  (one key per userId)
 *
 * RPCs:
 *   cricket_director_start_session   — start or resume a session
 *   cricket_director_save_session    — checkpoint current state
 *   cricket_director_end_session     — explicitly finish a session
 *   cricket_director_get_session     — read current session (if any)
 *   cricket_director_list_history    — past completed sessions
 */
// ─────────────────────────────── Constants ────────────────────────────────────
var HISTORY_COLLECTION = "cricket_director_history";
var SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity → auto-pause
// ─────────────────────────────── Helpers ──────────────────────────────────────
function generateSessionId() {
    var ts = Date.now().toString(36);
    var rand = Math.random().toString(36).substring(2, 8);
    return "dir_" + ts + "_" + rand;
}
function readSession(nk, userId) {
    return Storage.readJson(nk, Constants.CRICKET_DIRECTOR_COLLECTION, "active_session", userId);
}
function writeSession(nk, userId, session) {
    session.updatedAt = new Date().toISOString();
    session.lastActiveAt = session.updatedAt;
    Storage.writeJson(nk, Constants.CRICKET_DIRECTOR_COLLECTION, "active_session", userId, session, 2, // owner-read + public-read
    1);
}
function deleteSession(nk, userId) {
    Storage.deleteRecord(nk, Constants.CRICKET_DIRECTOR_COLLECTION, "active_session", userId);
}
function archiveSession(nk, userId, session) {
    var entry = {
        sessionId: session.sessionId,
        gameMode: session.gameMode,
        fixtureId: session.fixtureId,
        finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
        totalPlayTimeSec: session.totalPlayTimeSec,
        completedAt: session.completedAt || new Date().toISOString(),
    };
    Storage.writeJson(nk, HISTORY_COLLECTION, session.sessionId, userId, entry, 2, 1);
}
function isTimedOut(session) {
    var lastActive = new Date(session.lastActiveAt).getTime();
    return Date.now() - lastActive > SESSION_TIMEOUT_MS;
}
// ─────────────────────────────── RPC: Start Session ──────────────────────────
function rpcStartSession(ctx, logger, nk, payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var existing = readSession(nk, userId);
    if (existing) {
        if (existing.status === "active" && !isTimedOut(existing)) {
            return RpcHelpers.successResponse({
                resumed: true,
                message: "Existing active session resumed",
                session: existing,
            });
        }
        if (existing.status === "active" && isTimedOut(existing)) {
            existing.status = "paused";
            writeSession(nk, userId, existing);
            logger.info("[CricketDirector] Auto-paused timed-out session: " + existing.sessionId);
        }
        if (existing.status === "paused") {
            existing.status = "active";
            writeSession(nk, userId, existing);
            logger.info("[CricketDirector] Resumed paused session: " + existing.sessionId);
            return RpcHelpers.successResponse({
                resumed: true,
                message: "Paused session resumed",
                session: existing,
            });
        }
        // abandoned or completed — archive and allow new
        archiveSession(nk, userId, existing);
        deleteSession(nk, userId);
    }
    // Create new session
    var validation = RpcHelpers.validatePayload(data, ["gameMode", "fixtureId"]);
    if (!validation.valid) {
        return RpcHelpers.errorResponse("New session requires: " + validation.missing.join(", "));
    }
    var now = new Date().toISOString();
    var session = {
        sessionId: generateSessionId(),
        userId: userId,
        status: "active",
        gameMode: data.gameMode,
        fixtureId: data.fixtureId,
        matchContext: {
            battingTeamId: data.battingTeamId || "",
            bowlingTeamId: data.bowlingTeamId || "",
            innings: 1,
            overs: 0,
            balls: 0,
            score: 0,
            wickets: 0,
        },
        directorState: {
            commentaryQueue: [],
            soundManifestVersion: data.soundManifestVersion || "v1",
            difficultyLevel: data.difficultyLevel || 3,
            aiPersonality: data.aiPersonality || "neutral",
            lastDecisionTimestamp: now,
        },
        checkpoints: [],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        totalPlayTimeSec: 0,
        lastActiveAt: now,
    };
    writeSession(nk, userId, session);
    EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_START, {
        gameId: "cricket_director",
        sessionId: session.sessionId,
        gameMode: session.gameMode,
        fixtureId: session.fixtureId,
    });
    logger.info("[CricketDirector] New session: " + session.sessionId + " for user " + userId);
    return RpcHelpers.successResponse({ resumed: false, message: "New session created", session: session });
}
// ─────────────────────────────── RPC: Save Session ───────────────────────────
function rpcSaveSession(ctx, logger, nk, payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var session = readSession(nk, userId);
    if (!session)
        return RpcHelpers.errorResponse("No active session found");
    if (session.status !== "active")
        return RpcHelpers.errorResponse("Session is not active (status: " + session.status + ")");
    // Merge matchContext updates
    if (data.matchContext) {
        var mc = session.matchContext;
        var incoming = data.matchContext;
        if (incoming.innings !== undefined)
            mc.innings = incoming.innings;
        if (incoming.overs !== undefined)
            mc.overs = incoming.overs;
        if (incoming.balls !== undefined)
            mc.balls = incoming.balls;
        if (incoming.score !== undefined)
            mc.score = incoming.score;
        if (incoming.wickets !== undefined)
            mc.wickets = incoming.wickets;
        if (incoming.battingTeamId)
            mc.battingTeamId = incoming.battingTeamId;
        if (incoming.bowlingTeamId)
            mc.bowlingTeamId = incoming.bowlingTeamId;
    }
    // Merge directorState updates
    if (data.directorState) {
        var ds = session.directorState;
        var incDs = data.directorState;
        if (incDs.commentaryQueue)
            ds.commentaryQueue = incDs.commentaryQueue;
        if (incDs.difficultyLevel !== undefined)
            ds.difficultyLevel = incDs.difficultyLevel;
        if (incDs.aiPersonality)
            ds.aiPersonality = incDs.aiPersonality;
        ds.lastDecisionTimestamp = new Date().toISOString();
    }
    // Add checkpoint if label provided
    if (data.checkpointLabel) {
        session.checkpoints.push({
            timestamp: new Date().toISOString(),
            label: data.checkpointLabel,
            stateSnapshot: { matchContext: session.matchContext },
        });
        if (session.checkpoints.length > 20) {
            session.checkpoints = session.checkpoints.slice(-20);
        }
    }
    if (data.playTimeDelta) {
        session.totalPlayTimeSec += data.playTimeDelta;
    }
    writeSession(nk, userId, session);
    logger.info("[CricketDirector] Session saved: " + session.sessionId);
    return RpcHelpers.successResponse({ saved: true, sessionId: session.sessionId, checkpoints: session.checkpoints.length });
}
// ─────────────────────────────── RPC: End Session ────────────────────────────
function rpcEndSession(ctx, logger, nk, payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var session = readSession(nk, userId);
    if (!session)
        return RpcHelpers.errorResponse("No active session found");
    var reason = data.reason || "player_ended";
    if (data.matchContext) {
        var mc = session.matchContext;
        var fin = data.matchContext;
        if (fin.score !== undefined)
            mc.score = fin.score;
        if (fin.wickets !== undefined)
            mc.wickets = fin.wickets;
        if (fin.overs !== undefined)
            mc.overs = fin.overs;
    }
    session.status = reason === "abandoned" ? "abandoned" : "completed";
    session.completedAt = new Date().toISOString();
    if (data.playTimeDelta)
        session.totalPlayTimeSec += data.playTimeDelta;
    archiveSession(nk, userId, session);
    deleteSession(nk, userId);
    EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, {
        gameId: "cricket_director",
        sessionId: session.sessionId,
        reason: reason,
        totalPlayTimeSec: session.totalPlayTimeSec,
        finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
    });
    logger.info("[CricketDirector] Session ended: " + session.sessionId + " (" + reason + ")");
    return RpcHelpers.successResponse({
        ended: true,
        sessionId: session.sessionId,
        finalScore: session.matchContext.score + "/" + session.matchContext.wickets,
        totalPlayTimeSec: session.totalPlayTimeSec,
    });
}
// ─────────────────────────────── RPC: Get Session ────────────────────────────
function rpcGetSession(ctx, logger, nk, _payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var session = readSession(nk, userId);
    if (!session) {
        return RpcHelpers.successResponse({ hasActiveSession: false, session: null });
    }
    if (session.status === "active" && isTimedOut(session)) {
        session.status = "paused";
        writeSession(nk, userId, session);
    }
    return RpcHelpers.successResponse({ hasActiveSession: true, session: session });
}
// ─────────────────────────────── RPC: List History ────────────────────────────
function rpcListHistory(ctx, logger, nk, payload) {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = data.limit || 20;
    var cursor = data.cursor || "";
    var result = Storage.listUserRecords(nk, HISTORY_COLLECTION, userId, limit, cursor);
    var sessions = [];
    for (var i = 0; i < result.records.length; i++) {
        sessions.push(result.records[i].value);
    }
    return RpcHelpers.successResponse({
        sessions: sessions,
        cursor: result.cursor || null,
        total: sessions.length,
    });
}
// ─────────────────────────────── Registration ────────────────────────────────
var CricketDirector;
(function (CricketDirector) {
    function register(initializer) {
        initializer.registerRpc("cricket_director_start_session", rpcStartSession);
        initializer.registerRpc("cricket_director_save_session", rpcSaveSession);
        initializer.registerRpc("cricket_director_end_session", rpcEndSession);
        initializer.registerRpc("cricket_director_get_session", rpcGetSession);
        initializer.registerRpc("cricket_director_list_history", rpcListHistory);
    }
    CricketDirector.register = register;
})(CricketDirector || (CricketDirector = {}));
// ============================================================================
// FANTASY CRICKET — Private Leagues
// ============================================================================
// RPCs:
//   fantasy_league_create      — Create a private league (Nakama Group)
//   fantasy_league_join         — Join via invite code
//   fantasy_league_leave        — Leave a league
//   fantasy_league_leaderboard  — Get league-specific leaderboard
//   fantasy_league_my_leagues   — List user's leagues
//   fantasy_league_info         — Get league details
// ============================================================================
var FantasyLeague;
(function (FantasyLeague) {
    var DEFAULT_MAX_MEMBERS = 20;
    var INVITE_CODE_LENGTH = 8;
    // ---- Helpers ----
    function generateInviteCode() {
        var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var code = "";
        for (var i = 0; i < INVITE_CODE_LENGTH; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return code;
    }
    function saveLeagueMeta(nk, meta) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.LEAGUE_META + "_" + meta.groupId, Constants.SYSTEM_USER_ID, meta, 2, 0);
        // Also index by invite code for lookups
        Storage.writeJson(nk, FantasyTypes.COLLECTION, "league_invite_" + meta.inviteCode, Constants.SYSTEM_USER_ID, { groupId: meta.groupId, inviteCode: meta.inviteCode }, 2, 0);
    }
    function getLeagueMetaByGroup(nk, groupId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.LEAGUE_META + "_" + groupId, Constants.SYSTEM_USER_ID);
    }
    function lookupGroupByInviteCode(nk, code) {
        var data = Storage.readJson(nk, FantasyTypes.COLLECTION, "league_invite_" + code.toUpperCase(), Constants.SYSTEM_USER_ID);
        return data ? data.groupId : null;
    }
    function ensureLeagueLeaderboard(nk, leaderboardId) {
        try {
            nk.leaderboardCreate(leaderboardId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "increment" /* nkruntime.Operator.INCREMENTAL */, "", {});
        }
        catch (e) {
            // Leaderboard may already exist — that's fine
        }
    }
    // ---- RPCs ----
    function rpcCreateLeague(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        var check = RpcHelpers.validatePayload(input, ["leagueName", "seasonId"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        var maxMembers = input.maxMembers || DEFAULT_MAX_MEMBERS;
        if (maxMembers < 2 || maxMembers > 100) {
            return RpcHelpers.errorResponse("maxMembers must be between 2 and 100");
        }
        var inviteCode = generateInviteCode();
        // Create Nakama Group
        var group;
        try {
            group = nk.groupCreate(userId, input.leagueName, userId, // creator as initial member
            "", // lang tag
            "Fantasy league for " + input.seasonId, "", // avatar
            false, // open = false (invite-only)
            { seasonId: input.seasonId, inviteCode: inviteCode }, maxMembers);
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to create group: " + (e.message || String(e)));
        }
        var leaderboardId = FantasyTypes.LEADERBOARD_LEAGUE_PREFIX + group.id;
        ensureLeagueLeaderboard(nk, leaderboardId);
        var meta = {
            groupId: group.id,
            leagueName: input.leagueName,
            creatorId: userId,
            seasonId: input.seasonId,
            leaderboardId: leaderboardId,
            maxMembers: maxMembers,
            inviteCode: inviteCode,
            createdAt: new Date().toISOString(),
        };
        saveLeagueMeta(nk, meta);
        logger.info("[FantasyLeague] User %s created league '%s' (group: %s, code: %s)", userId, input.leagueName, group.id, inviteCode);
        EventBus.emit(nk, logger, ctx, "fantasy_league_created", {
            userId: userId,
            groupId: group.id,
            seasonId: input.seasonId,
            leagueName: input.leagueName,
        });
        return RpcHelpers.successResponse({
            groupId: group.id,
            leagueName: input.leagueName,
            inviteCode: inviteCode,
            leaderboardId: leaderboardId,
            maxMembers: maxMembers,
        });
    }
    function rpcJoinLeague(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        if (!input.inviteCode) {
            return RpcHelpers.errorResponse("inviteCode is required");
        }
        var groupId = lookupGroupByInviteCode(nk, input.inviteCode);
        if (!groupId) {
            return RpcHelpers.errorResponse("Invalid invite code: " + input.inviteCode);
        }
        var meta = getLeagueMetaByGroup(nk, groupId);
        if (!meta) {
            return RpcHelpers.errorResponse("League metadata not found");
        }
        // Check current member count
        var members;
        try {
            members = nk.groupUsersList(groupId, 100, undefined, "");
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to check league members: " + (e.message || String(e)));
        }
        if (members.groupUsers && members.groupUsers.length >= meta.maxMembers) {
            return RpcHelpers.errorResponse("League is full (" + meta.maxMembers + " members max)");
        }
        // Check if already a member
        if (members.groupUsers) {
            for (var i = 0; i < members.groupUsers.length; i++) {
                if (members.groupUsers[i].user && members.groupUsers[i].user.userId === userId) {
                    return RpcHelpers.errorResponse("Already a member of this league");
                }
            }
        }
        // Join the group
        try {
            nk.groupUsersAdd(groupId, [userId]);
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to join league: " + (e.message || String(e)));
        }
        logger.info("[FantasyLeague] User %s joined league %s (code: %s)", userId, groupId, input.inviteCode);
        return RpcHelpers.successResponse({
            groupId: groupId,
            leagueName: meta.leagueName,
            seasonId: meta.seasonId,
            leaderboardId: meta.leaderboardId,
        });
    }
    function rpcLeaveLeague(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        if (!input.groupId) {
            return RpcHelpers.errorResponse("groupId is required");
        }
        var meta = getLeagueMetaByGroup(nk, input.groupId);
        if (!meta) {
            return RpcHelpers.errorResponse("League not found");
        }
        if (meta.creatorId === userId) {
            return RpcHelpers.errorResponse("League creator cannot leave — transfer ownership or delete the league");
        }
        try {
            nk.groupUsersKick(input.groupId, [userId]);
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to leave league: " + (e.message || String(e)));
        }
        logger.info("[FantasyLeague] User %s left league %s", userId, input.groupId);
        return RpcHelpers.successResponse({ left: true, groupId: input.groupId });
    }
    function rpcLeagueLeaderboard(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.groupId) {
            return RpcHelpers.errorResponse("groupId is required");
        }
        var meta = getLeagueMetaByGroup(nk, input.groupId);
        if (!meta) {
            return RpcHelpers.errorResponse("League not found");
        }
        // Get member user IDs
        var memberIds = [];
        try {
            var members = nk.groupUsersList(input.groupId, 100, undefined, "");
            if (members.groupUsers) {
                for (var i = 0; i < members.groupUsers.length; i++) {
                    if (members.groupUsers[i].user && members.groupUsers[i].user.userId) {
                        memberIds.push(members.groupUsers[i].user.userId);
                    }
                }
            }
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to list members: " + (e.message || String(e)));
        }
        if (memberIds.length === 0) {
            return RpcHelpers.successResponse({
                groupId: input.groupId,
                leagueName: meta.leagueName,
                records: [],
            });
        }
        // Read league leaderboard records for these members
        var limit = input.limit || 50;
        var records = [];
        try {
            var lbRecords = nk.leaderboardRecordsList(meta.leaderboardId, memberIds, limit, "", 0);
            if (lbRecords && lbRecords.records) {
                for (var i = 0; i < lbRecords.records.length; i++) {
                    var rec = lbRecords.records[i];
                    records.push({
                        userId: rec.ownerId,
                        score: Number(rec.score) || 0,
                        rank: rec.rank ? Number(rec.rank) : i + 1,
                    });
                }
            }
        }
        catch (e) {
            logger.warn("[FantasyLeague] LB read failed for league %s: %s", input.groupId, e.message || String(e));
        }
        return RpcHelpers.successResponse({
            groupId: input.groupId,
            leagueName: meta.leagueName,
            seasonId: meta.seasonId,
            memberCount: memberIds.length,
            records: records,
        });
    }
    function rpcMyLeagues(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        var leagues = [];
        try {
            var userGroups = nk.userGroupsList(userId, 100, undefined, "");
            if (userGroups.userGroups) {
                for (var i = 0; i < userGroups.userGroups.length; i++) {
                    var ug = userGroups.userGroups[i];
                    if (!ug.group || !ug.group.id)
                        continue;
                    var meta = getLeagueMetaByGroup(nk, ug.group.id);
                    if (!meta)
                        continue;
                    leagues.push({
                        groupId: meta.groupId,
                        leagueName: meta.leagueName,
                        seasonId: meta.seasonId,
                        inviteCode: meta.inviteCode,
                        memberCount: ug.group.edgeCount || 0,
                        isCreator: meta.creatorId === userId,
                    });
                }
            }
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to list groups: " + (e.message || String(e)));
        }
        return RpcHelpers.successResponse({ leagues: leagues });
    }
    function rpcLeagueInfo(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.groupId) {
            return RpcHelpers.errorResponse("groupId is required");
        }
        var meta = getLeagueMetaByGroup(nk, input.groupId);
        if (!meta) {
            return RpcHelpers.errorResponse("League not found");
        }
        var memberCount = 0;
        try {
            var members = nk.groupUsersList(input.groupId, 1, undefined, "");
            if (members.groupUsers) {
                memberCount = members.groupUsers.length;
            }
        }
        catch (e) {
            // ignore
        }
        return RpcHelpers.successResponse({
            groupId: meta.groupId,
            leagueName: meta.leagueName,
            creatorId: meta.creatorId,
            seasonId: meta.seasonId,
            leaderboardId: meta.leaderboardId,
            maxMembers: meta.maxMembers,
            inviteCode: meta.inviteCode,
            memberCount: memberCount,
            createdAt: meta.createdAt,
        });
    }
    function rpcListLeagues(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var limit = input.limit || 100;
        var leagues = [];
        try {
            var cursor = "";
            var keepGoing = true;
            while (keepGoing && leagues.length < limit) {
                var result = nk.storageList(Constants.SYSTEM_USER_ID, FantasyTypes.COLLECTION, 100, cursor);
                if (!result || !result.objects || result.objects.length === 0) {
                    keepGoing = false;
                    break;
                }
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    if (!obj.key || obj.key.indexOf(FantasyTypes.Keys.LEAGUE_META + "_") !== 0)
                        continue;
                    var meta = obj.value;
                    if (!meta || !meta.groupId)
                        continue;
                    if (input.seasonId && meta.seasonId !== input.seasonId)
                        continue;
                    leagues.push({
                        groupId: meta.groupId,
                        leagueName: meta.leagueName,
                        seasonId: meta.seasonId,
                        inviteCode: meta.inviteCode,
                        maxMembers: meta.maxMembers,
                        createdAt: meta.createdAt,
                    });
                }
                cursor = result.cursor || "";
                keepGoing = cursor.length > 0;
            }
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed to list leagues: " + (e.message || String(e)));
        }
        return RpcHelpers.successResponse({ leagues: leagues, count: leagues.length });
    }
    // ---- Registration ----
    function register(initializer) {
        initializer.registerRpc("fantasy_league_create", rpcCreateLeague);
        initializer.registerRpc("fantasy_league_join", rpcJoinLeague);
        initializer.registerRpc("fantasy_league_leave", rpcLeaveLeague);
        initializer.registerRpc("fantasy_league_leaderboard", rpcLeagueLeaderboard);
        initializer.registerRpc("fantasy_league_my_leagues", rpcMyLeagues);
        initializer.registerRpc("fantasy_league_info", rpcLeagueInfo);
        initializer.registerRpc("fantasy_league_list", rpcListLeagues);
    }
    FantasyLeague.register = register;
})(FantasyLeague || (FantasyLeague = {}));
// ============================================================================
// FANTASY CRICKET — Scoring Engine
// ============================================================================
// RPCs:
//   fantasy_scoring_process    — Process BallEvent[] batch → update player stats
//   fantasy_scoring_finalize   — End-of-innings/match: apply SR/ER bonuses,
//                                 compute per-user totals, write leaderboards
//   fantasy_scoring_get_points — Get a user's points for a specific match
//   fantasy_scoring_live       — Get live (partial) player stats for a fixture
//   fantasy_event_leaderboard  — Live event leaderboard: rank all participants
// ============================================================================
var FantasyScoring;
(function (FantasyScoring) {
    // ---- Helpers ----
    function getScoringConfig(nk, seasonId) {
        var cfg = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SCORING_CONFIG + "_" + seasonId, Constants.SYSTEM_USER_ID);
        return cfg || FantasyTypes.defaultScoringConfig(seasonId);
    }
    function getPlayerStats(nk, fixtureId) {
        var data = Storage.readJson(nk, FantasyTypes.COLLECTION, "live_stats_" + fixtureId, Constants.SYSTEM_USER_ID);
        return data ? data.stats : {};
    }
    function savePlayerStats(nk, fixtureId, stats) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, "live_stats_" + fixtureId, Constants.SYSTEM_USER_ID, { fixtureId: fixtureId, stats: stats, updatedAt: new Date().toISOString() }, 2, 0);
    }
    function initPlayerStats(playerId) {
        return {
            playerId: playerId,
            runsScored: 0,
            ballsFaced: 0,
            fours: 0,
            sixes: 0,
            wicketsTaken: 0,
            oversBowled: 0,
            ballsBowled: 0,
            runsConceded: 0,
            maidens: 0,
            catches: 0,
            stumpings: 0,
            runOuts: 0,
            runOutAssists: 0,
            isDismissed: false,
            dismissalType: null,
            isDuck: false,
            fantasyPoints: 0,
        };
    }
    function ensurePlayer(stats, playerId) {
        if (!stats[playerId]) {
            stats[playerId] = initPlayerStats(playerId);
        }
        return stats[playerId];
    }
    function processSingleBall(event, stats, cfg) {
        var batsman = ensurePlayer(stats, event.batsmanId);
        var bowler = ensurePlayer(stats, event.bowlerId);
        var batsmanRuns = event.batsmanRuns !== undefined ? event.batsmanRuns : event.runs;
        // Batting
        batsman.ballsFaced++;
        batsman.runsScored += batsmanRuns;
        batsman.fantasyPoints += batsmanRuns * cfg.batting.perRun;
        if (event.isBoundary) {
            batsman.fours++;
            batsman.fantasyPoints += cfg.batting.boundaryBonus;
        }
        if (event.isSix) {
            batsman.sixes++;
            batsman.fantasyPoints += cfg.batting.sixBonus;
        }
        // Milestone bonuses (incremental — only award when crossing the threshold)
        if (batsman.runsScored >= 100 && (batsman.runsScored - batsmanRuns) < 100) {
            batsman.fantasyPoints += cfg.batting.centuryBonus;
        }
        else if (batsman.runsScored >= 50 && (batsman.runsScored - batsmanRuns) < 50) {
            batsman.fantasyPoints += cfg.batting.halfCenturyBonus;
        }
        // Bowling — count legal deliveries
        if (!event.extras || event.extras.type !== "wide") {
            bowler.ballsBowled++;
            bowler.runsConceded += event.runs;
            if (bowler.ballsBowled > 0 && bowler.ballsBowled % 6 === 0) {
                bowler.oversBowled++;
            }
        }
        // Wicket
        if (event.isWicket && event.wicket) {
            var dismissal = event.wicket;
            if (dismissal.dismissalType !== "run out" && dismissal.dismissalType !== "retired hurt" && dismissal.dismissalType !== "retired") {
                bowler.wicketsTaken++;
                bowler.fantasyPoints += cfg.bowling.perWicket;
                if (dismissal.dismissalType === "bowled") {
                    bowler.fantasyPoints += cfg.bowling.bonusBowled;
                }
                if (dismissal.dismissalType === "lbw") {
                    bowler.fantasyPoints += cfg.bowling.bonusLbw;
                }
                if (bowler.wicketsTaken === 3)
                    bowler.fantasyPoints += cfg.bowling.threeWicketBonus;
                if (bowler.wicketsTaken === 4)
                    bowler.fantasyPoints += cfg.bowling.fourWicketBonus;
                if (bowler.wicketsTaken === 5)
                    bowler.fantasyPoints += cfg.bowling.fiveWicketBonus;
            }
            // Fielding
            if (dismissal.dismissalType === "caught" && dismissal.fielderId) {
                var fielder = ensurePlayer(stats, dismissal.fielderId);
                fielder.catches++;
                fielder.fantasyPoints += cfg.fielding.perCatch;
            }
            if (dismissal.dismissalType === "stumped" && dismissal.fielderId) {
                var stumper = ensurePlayer(stats, dismissal.fielderId);
                stumper.stumpings++;
                stumper.fantasyPoints += cfg.fielding.perStumping;
            }
            if (dismissal.dismissalType === "run out") {
                if (dismissal.fielderId) {
                    var runOutFielder = ensurePlayer(stats, dismissal.fielderId);
                    runOutFielder.runOuts++;
                    runOutFielder.fantasyPoints += cfg.fielding.perRunOut;
                }
                if (dismissal.assistFielderId) {
                    var assister = ensurePlayer(stats, dismissal.assistFielderId);
                    assister.runOutAssists++;
                    assister.fantasyPoints += cfg.fielding.perRunOutAssist;
                }
            }
            // Mark batsman as dismissed
            var dismissed = ensurePlayer(stats, dismissal.dismissedPlayerId);
            dismissed.isDismissed = true;
            dismissed.dismissalType = dismissal.dismissalType;
        }
    }
    function applyEndOfMatchBonuses(stats, cfg) {
        var playerIds = Object.keys(stats);
        for (var i = 0; i < playerIds.length; i++) {
            var p = stats[playerIds[i]];
            // Duck penalty (dismissed for 0 runs having faced at least 1 ball)
            if (p.isDismissed && p.runsScored === 0 && p.ballsFaced > 0) {
                p.isDuck = true;
                p.fantasyPoints += cfg.batting.duckPenalty;
            }
            // Strike-rate bonuses (only if faced enough balls)
            if (p.ballsFaced >= cfg.bonuses.minimumBallsForSR) {
                var sr = (p.runsScored / p.ballsFaced) * 100;
                if (sr > 170)
                    p.fantasyPoints += cfg.bonuses.strikeRateAbove170;
                else if (sr > 150)
                    p.fantasyPoints += cfg.bonuses.strikeRateAbove150;
                else if (sr > 130)
                    p.fantasyPoints += cfg.bonuses.strikeRateAbove130;
                else if (sr < 50)
                    p.fantasyPoints += cfg.bonuses.strikeRateBelow50;
                else if (sr < 60)
                    p.fantasyPoints += cfg.bonuses.strikeRateBelow60;
            }
            // Economy-rate bonuses (only if bowled enough overs)
            if (p.oversBowled >= cfg.bonuses.minimumOversForER) {
                var er = p.runsConceded / p.oversBowled;
                if (er < 5)
                    p.fantasyPoints += cfg.bonuses.economyBelow5;
                else if (er < 6)
                    p.fantasyPoints += cfg.bonuses.economyBelow6;
                else if (er < 7)
                    p.fantasyPoints += cfg.bonuses.economyBelow7;
                else if (er > 12)
                    p.fantasyPoints += cfg.bonuses.economyAbove12;
                else if (er > 11)
                    p.fantasyPoints += cfg.bonuses.economyAbove11;
                else if (er > 10)
                    p.fantasyPoints += cfg.bonuses.economyAbove10;
            }
            // Maiden tracking: check if any completed over had 0 runs
            // (Maidens are detected during ball processing; if bowled a full over with 0 runs)
            if (p.maidens > 0) {
                p.fantasyPoints += p.maidens * cfg.bowling.maidenOverBonus;
            }
        }
    }
    function computeUserMatchPoints(nk, userId, seasonId, fixtureId, matchday, stats, cfg) {
        var team = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + seasonId, userId);
        if (!team)
            return null;
        // Use the match XI if the user selected one; otherwise fall back to full squad
        var matchXI = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_XI + "_" + fixtureId, userId);
        var activeCaptainId = team.captainId;
        var activeVcId = team.viceCaptainId;
        var activePlayerIds = {};
        if (matchXI && matchXI.selectedPlayerIds && matchXI.selectedPlayerIds.length > 0) {
            // Score only the selected 11
            for (var j = 0; j < matchXI.selectedPlayerIds.length; j++) {
                activePlayerIds[matchXI.selectedPlayerIds[j]] = true;
            }
            activeCaptainId = matchXI.captainId;
            activeVcId = matchXI.viceCaptainId;
        }
        else {
            // Fallback: score all 15 in the squad
            for (var j = 0; j < team.players.length; j++) {
                activePlayerIds[team.players[j].playerId] = true;
            }
        }
        var playerPoints = {};
        var totalPoints = 0;
        var captainPts = 0;
        var vcPts = 0;
        for (var i = 0; i < team.players.length; i++) {
            var sp = team.players[i];
            // Skip players not in the active XI
            if (!activePlayerIds[sp.playerId])
                continue;
            var rawPts = 0;
            if (stats[sp.playerId]) {
                rawPts = stats[sp.playerId].fantasyPoints;
            }
            var multiplier = 1;
            if (sp.playerId === activeCaptainId)
                multiplier = cfg.captainMultiplier;
            else if (sp.playerId === activeVcId)
                multiplier = cfg.viceCaptainMultiplier;
            var finalPts = Math.round(rawPts * multiplier * 10) / 10;
            playerPoints[sp.playerId] = finalPts;
            totalPoints += finalPts;
            if (sp.playerId === activeCaptainId)
                captainPts = finalPts;
            if (sp.playerId === activeVcId)
                vcPts = finalPts;
        }
        // Subtract any penalty points from extra transfers
        var seasonState = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + seasonId, userId);
        if (seasonState && seasonState.penaltyPointsAccrued > 0) {
            totalPoints -= seasonState.penaltyPointsAccrued;
        }
        var result = {
            userId: userId,
            fixtureId: fixtureId,
            matchday: matchday,
            playerPoints: playerPoints,
            captainPoints: captainPts,
            viceCaptainPoints: vcPts,
            totalPoints: Math.round(totalPoints * 10) / 10,
            calculatedAt: new Date().toISOString(),
        };
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_POINTS + "_" + fixtureId, userId, result, 2, 0);
        return result;
    }
    function getOverTracker(nk, fixtureId) {
        var data = Storage.readJson(nk, FantasyTypes.COLLECTION, "over_tracker_" + fixtureId, Constants.SYSTEM_USER_ID);
        return data ? data.tracker : {};
    }
    function saveOverTracker(nk, fixtureId, tracker) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, "over_tracker_" + fixtureId, Constants.SYSTEM_USER_ID, { tracker: tracker }, 2, 0);
    }
    function trackMaidenProgress(event, stats, tracker) {
        if (event.extras && event.extras.type === "wide")
            return;
        if (!tracker[event.bowlerId]) {
            tracker[event.bowlerId] = { currentOverBalls: 0, currentOverRuns: 0 };
        }
        var t = tracker[event.bowlerId];
        t.currentOverBalls++;
        t.currentOverRuns += event.runs;
        if (t.currentOverBalls >= 6) {
            if (t.currentOverRuns === 0) {
                var bowler = ensurePlayer(stats, event.bowlerId);
                bowler.maidens++;
            }
            t.currentOverBalls = 0;
            t.currentOverRuns = 0;
        }
    }
    // ---- RPCs ----
    function rpcProcessBallEvents(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["fixtureId", "matchday", "events"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (!input.events || input.events.length === 0) {
            return RpcHelpers.errorResponse("No events to process");
        }
        var seasonId = input.fixtureId.split("_")[0] || "ipl2026";
        var cfg = getScoringConfig(nk, seasonId);
        var stats = getPlayerStats(nk, input.fixtureId);
        var tracker = getOverTracker(nk, input.fixtureId);
        for (var i = 0; i < input.events.length; i++) {
            processSingleBall(input.events[i], stats, cfg);
            trackMaidenProgress(input.events[i], stats, tracker);
        }
        savePlayerStats(nk, input.fixtureId, stats);
        saveOverTracker(nk, input.fixtureId, tracker);
        logger.info("[FantasyScoring] Processed %d ball events for fixture %s", input.events.length, input.fixtureId);
        return RpcHelpers.successResponse({
            fixtureId: input.fixtureId,
            eventsProcessed: input.events.length,
            playersTracked: Object.keys(stats).length,
        });
    }
    function rpcFinalize(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["fixtureId", "matchday", "seasonId"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        var cfg = getScoringConfig(nk, input.seasonId);
        var stats = getPlayerStats(nk, input.fixtureId);
        if (Object.keys(stats).length === 0) {
            return RpcHelpers.errorResponse("No player stats found for fixture " + input.fixtureId);
        }
        applyEndOfMatchBonuses(stats, cfg);
        savePlayerStats(nk, input.fixtureId, stats);
        // Enumerate users with fantasy teams via the system-owned team index
        var idxPrefix = "team_idx_" + input.seasonId + "_";
        var cursor = undefined;
        var usersProcessed = 0;
        var allMatchPoints = [];
        do {
            var list = nk.storageList(Constants.SYSTEM_USER_ID, FantasyTypes.COLLECTION, 100, cursor);
            if (list && list.objects) {
                for (var i = 0; i < list.objects.length; i++) {
                    var obj = list.objects[i];
                    if (obj.key.indexOf(idxPrefix) !== 0)
                        continue;
                    var idxEntry = obj.value;
                    if (!idxEntry || !idxEntry.userId)
                        continue;
                    var teamUserId = idxEntry.userId;
                    var mp = computeUserMatchPoints(nk, teamUserId, input.seasonId, input.fixtureId, input.matchday, stats, cfg);
                    if (mp) {
                        allMatchPoints.push(mp);
                        usersProcessed++;
                        // Write to season leaderboard
                        try {
                            nk.leaderboardRecordWrite(FantasyTypes.LEADERBOARD_SEASON + "_" + input.seasonId, teamUserId, "", Math.round(mp.totalPoints), 0, { matchday: input.matchday, fixtureId: input.fixtureId });
                        }
                        catch (e) {
                            logger.warn("[FantasyScoring] Leaderboard write failed for user %s: %s", teamUserId, e.message || String(e));
                        }
                        // Write to per-match leaderboard
                        try {
                            nk.leaderboardRecordWrite(FantasyTypes.LEADERBOARD_MATCH_PREFIX + input.fixtureId, teamUserId, "", Math.round(mp.totalPoints), 0, {});
                        }
                        catch (e) {
                            logger.warn("[FantasyScoring] Match LB write failed for user %s: %s", teamUserId, e.message || String(e));
                        }
                        // Write to league leaderboards the user belongs to
                        try {
                            var userGroups = nk.userGroupsList(teamUserId, 100);
                            if (userGroups && userGroups.userGroups) {
                                for (var g = 0; g < userGroups.userGroups.length; g++) {
                                    var ug = userGroups.userGroups[g];
                                    if (!ug.group)
                                        continue;
                                    var leagueLeaderboardId = FantasyTypes.LEADERBOARD_LEAGUE_PREFIX + ug.group.id;
                                    try {
                                        nk.leaderboardRecordWrite(leagueLeaderboardId, teamUserId, "", Math.round(mp.totalPoints), 0, { matchday: input.matchday, fixtureId: input.fixtureId });
                                    }
                                    catch (le) {
                                        // Leaderboard may not exist yet for non-fantasy groups; skip silently
                                    }
                                }
                            }
                        }
                        catch (e) {
                            logger.warn("[FantasyScoring] League LB write failed for user %s: %s", teamUserId, e.message || String(e));
                        }
                    }
                }
                cursor = list.cursor;
            }
            else {
                break;
            }
        } while (cursor);
        logger.info("[FantasyScoring] Finalized fixture %s — %d users scored", input.fixtureId, usersProcessed);
        EventBus.emit(nk, logger, ctx, "fantasy_match_finalized", {
            fixtureId: input.fixtureId,
            seasonId: input.seasonId,
            matchday: input.matchday,
            usersProcessed: usersProcessed,
        });
        return RpcHelpers.successResponse({
            fixtureId: input.fixtureId,
            usersProcessed: usersProcessed,
            playerStatsCount: Object.keys(stats).length,
        });
    }
    function rpcGetPoints(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.fixtureId) {
            return RpcHelpers.errorResponse("fixtureId is required");
        }
        var mp = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_POINTS + "_" + input.fixtureId, userId);
        if (!mp) {
            return RpcHelpers.errorResponse("No points found for fixture " + input.fixtureId);
        }
        return RpcHelpers.successResponse(mp);
    }
    function rpcLiveStats(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.fixtureId) {
            return RpcHelpers.errorResponse("fixtureId is required");
        }
        var stats = getPlayerStats(nk, input.fixtureId);
        if (Object.keys(stats).length === 0) {
            return RpcHelpers.successResponse({ fixtureId: input.fixtureId, players: {}, message: "No stats yet" });
        }
        return RpcHelpers.successResponse({
            fixtureId: input.fixtureId,
            players: stats,
        });
    }
    function rpcEventLeaderboard(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.fixtureId) {
            return RpcHelpers.errorResponse("fixtureId is required");
        }
        var seasonId = input.seasonId || "ipl-2026";
        var limit = input.limit || 50;
        var cfg = getScoringConfig(nk, seasonId);
        var stats = getPlayerStats(nk, input.fixtureId);
        if (Object.keys(stats).length === 0) {
            return RpcHelpers.successResponse({
                fixtureId: input.fixtureId,
                seasonId: seasonId,
                rankings: [],
                totalParticipants: 0,
                message: "No stats yet — match may not have started",
            });
        }
        var rankings = [];
        var idxPrefix = "team_idx_" + seasonId + "_";
        var cursor = undefined;
        do {
            var list = nk.storageList(Constants.SYSTEM_USER_ID, FantasyTypes.COLLECTION, 100, cursor);
            if (list && list.objects) {
                for (var i = 0; i < list.objects.length; i++) {
                    var obj = list.objects[i];
                    if (obj.key.indexOf(idxPrefix) !== 0)
                        continue;
                    var idxEntry = obj.value;
                    if (!idxEntry || !idxEntry.userId)
                        continue;
                    var team = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + seasonId, idxEntry.userId);
                    if (!team)
                        continue;
                    var matchXI = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_XI + "_" + input.fixtureId, idxEntry.userId);
                    var activeCaptainId = team.captainId;
                    var activeVcId = team.viceCaptainId;
                    var activePlayerIds = {};
                    if (matchXI && matchXI.selectedPlayerIds && matchXI.selectedPlayerIds.length > 0) {
                        for (var j = 0; j < matchXI.selectedPlayerIds.length; j++) {
                            activePlayerIds[matchXI.selectedPlayerIds[j]] = true;
                        }
                        activeCaptainId = matchXI.captainId;
                        activeVcId = matchXI.viceCaptainId;
                    }
                    else {
                        for (var j = 0; j < team.players.length; j++) {
                            activePlayerIds[team.players[j].playerId] = true;
                        }
                    }
                    var totalPoints = 0;
                    for (var k = 0; k < team.players.length; k++) {
                        var sp = team.players[k];
                        if (!activePlayerIds[sp.playerId])
                            continue;
                        var rawPts = 0;
                        if (stats[sp.playerId]) {
                            rawPts = stats[sp.playerId].fantasyPoints;
                        }
                        var multiplier = 1;
                        if (sp.playerId === activeCaptainId)
                            multiplier = cfg.captainMultiplier;
                        else if (sp.playerId === activeVcId)
                            multiplier = cfg.viceCaptainMultiplier;
                        totalPoints += Math.round(rawPts * multiplier * 10) / 10;
                    }
                    rankings.push({
                        userId: idxEntry.userId,
                        totalPoints: Math.round(totalPoints * 10) / 10,
                        captainId: activeCaptainId,
                        viceCaptainId: activeVcId,
                    });
                }
                cursor = list.cursor;
            }
            else {
                break;
            }
        } while (cursor);
        rankings.sort(function (a, b) { return b.totalPoints - a.totalPoints; });
        var total = rankings.length;
        if (rankings.length > limit) {
            rankings = rankings.slice(0, limit);
        }
        var ranked = rankings.map(function (r, idx) {
            return {
                rank: idx + 1,
                userId: r.userId,
                totalPoints: r.totalPoints,
                captainId: r.captainId,
                viceCaptainId: r.viceCaptainId,
            };
        });
        return RpcHelpers.successResponse({
            fixtureId: input.fixtureId,
            seasonId: seasonId,
            rankings: ranked,
            totalParticipants: total,
        });
    }
    // ---- Registration ----
    function register(initializer) {
        initializer.registerRpc("fantasy_scoring_process", rpcProcessBallEvents);
        initializer.registerRpc("fantasy_scoring_finalize", rpcFinalize);
        initializer.registerRpc("fantasy_scoring_get_points", rpcGetPoints);
        initializer.registerRpc("fantasy_scoring_live", rpcLiveStats);
        initializer.registerRpc("fantasy_event_leaderboard", rpcEventLeaderboard);
    }
    FantasyScoring.register = register;
})(FantasyScoring || (FantasyScoring = {}));
// ============================================================================
// FANTASY CRICKET — Team Creation & Validation
// ============================================================================
// RPCs:
//   fantasy_team_create  — Create/replace a 15-player squad
//   fantasy_team_get     — Retrieve the current user's squad
//   fantasy_team_update_captain — Change captain / vice-captain
// ============================================================================
var FantasyTeam;
(function (FantasyTeam) {
    // ---- Helpers ----
    function getPlayerCatalog(nk, seasonId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.PLAYER_CATALOG + "_" + seasonId, Constants.SYSTEM_USER_ID);
    }
    function saveTeam(nk, team) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + team.seasonId, team.userId, team, 2, // owner-read
        1 // owner-write
        );
    }
    function getTeam(nk, userId, seasonId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + seasonId, userId);
    }
    function getMatchDeadline(nk, fixtureId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_DEADLINE + "_" + fixtureId, Constants.SYSTEM_USER_ID);
    }
    /**
     * After a squad update, remove any un-locked Playing XI records that contain
     * players no longer in the new squad.
     */
    function invalidateStaleXIs(nk, logger, userId, newSquadPlayerIds) {
        var squadSet = {};
        for (var i = 0; i < newSquadPlayerIds.length; i++) {
            squadSet[newSquadPlayerIds[i]] = true;
        }
        var invalidated = [];
        var cursor = "";
        var keepGoing = true;
        while (keepGoing) {
            var result = Storage.listUserRecords(nk, FantasyTypes.COLLECTION, userId, 100, cursor);
            for (var j = 0; j < result.records.length; j++) {
                var obj = result.records[j];
                if (!obj.key || obj.key.indexOf(FantasyTypes.Keys.MATCH_XI + "_") !== 0)
                    continue;
                var xi = obj.value;
                if (!xi || !xi.selectedPlayerIds || !xi.fixtureId)
                    continue;
                var fixtureId = xi.fixtureId;
                // Skip locked XIs (deadline has passed)
                var deadline = getMatchDeadline(nk, fixtureId);
                if (deadline) {
                    var nowSec = Math.floor(Date.now() / 1000);
                    if (nowSec >= deadline.deadlineAt)
                        continue;
                }
                // Check if any XI player is no longer in the squad
                var hasStale = false;
                for (var k = 0; k < xi.selectedPlayerIds.length; k++) {
                    if (!squadSet[xi.selectedPlayerIds[k]]) {
                        hasStale = true;
                        break;
                    }
                }
                if (hasStale) {
                    Storage.deleteRecord(nk, FantasyTypes.COLLECTION, obj.key, userId);
                    invalidated.push(fixtureId);
                    logger.info("[FantasyTeam] Invalidated stale XI for fixture %s (user %s) — squad was updated", fixtureId, userId);
                }
            }
            cursor = result.cursor;
            keepGoing = cursor.length > 0;
        }
        return invalidated;
    }
    function validateSquad(players, catalog) {
        var errors = [];
        if (players.length !== FantasyTypes.SQUAD_SIZE) {
            errors.push("Squad must contain exactly " + FantasyTypes.SQUAD_SIZE + " players, got " + players.length);
        }
        var uniqueIds = {};
        for (var i = 0; i < players.length; i++) {
            if (uniqueIds[players[i].playerId]) {
                errors.push("Duplicate player: " + players[i].playerId);
            }
            uniqueIds[players[i].playerId] = true;
        }
        var captainCount = 0;
        var vcCount = 0;
        for (var i = 0; i < players.length; i++) {
            if (players[i].isCaptain)
                captainCount++;
            if (players[i].isViceCaptain)
                vcCount++;
        }
        if (captainCount !== 1)
            errors.push("Exactly 1 captain required, got " + captainCount);
        if (vcCount !== 1)
            errors.push("Exactly 1 vice-captain required, got " + vcCount);
        for (var i = 0; i < players.length; i++) {
            if (players[i].isCaptain && players[i].isViceCaptain) {
                errors.push("Captain and vice-captain must be different players");
                break;
            }
        }
        var totalCredits = 0;
        var overseasCount = 0;
        var teamCounts = {};
        var roleCounts = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };
        for (var i = 0; i < players.length; i++) {
            var entry = catalog.players[players[i].playerId];
            if (!entry) {
                errors.push("Unknown player ID: " + players[i].playerId);
                continue;
            }
            totalCredits += entry.creditValue;
            if (entry.isOverseas)
                overseasCount++;
            if (!teamCounts[entry.teamId])
                teamCounts[entry.teamId] = 0;
            teamCounts[entry.teamId]++;
            if (roleCounts[entry.role] !== undefined) {
                roleCounts[entry.role]++;
            }
        }
        if (totalCredits > FantasyTypes.CREDIT_BUDGET) {
            errors.push("Total credits " + totalCredits.toFixed(1) + " exceeds budget of " + FantasyTypes.CREDIT_BUDGET);
        }
        if (overseasCount > FantasyTypes.MAX_OVERSEAS_IN_SQUAD) {
            errors.push("Max " + FantasyTypes.MAX_OVERSEAS_IN_SQUAD + " overseas players in squad, got " + overseasCount);
        }
        var teamIds = Object.keys(teamCounts);
        for (var i = 0; i < teamIds.length; i++) {
            if (teamCounts[teamIds[i]] > FantasyTypes.MAX_PER_REAL_TEAM) {
                errors.push("Max " + FantasyTypes.MAX_PER_REAL_TEAM + " players from one team, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
            }
        }
        var roles = Object.keys(FantasyTypes.SQUAD_MIN_ROLES);
        for (var i = 0; i < roles.length; i++) {
            var r = roles[i];
            if ((roleCounts[r] || 0) < FantasyTypes.SQUAD_MIN_ROLES[r]) {
                errors.push("Need at least " + FantasyTypes.SQUAD_MIN_ROLES[r] + " " + r + "(s), got " + (roleCounts[r] || 0));
            }
        }
        return { valid: errors.length === 0, errors: errors };
    }
    // ---- Match XI Validation ----
    function validateMatchXI(playerIds, captainId, viceCaptainId, squad, catalog) {
        var errors = [];
        if (playerIds.length !== FantasyTypes.XI_SIZE) {
            errors.push("Playing XI must contain exactly " + FantasyTypes.XI_SIZE + " players, got " + playerIds.length);
        }
        // Check for duplicates
        var uniqueIds = {};
        for (var i = 0; i < playerIds.length; i++) {
            if (uniqueIds[playerIds[i]]) {
                errors.push("Duplicate player in XI: " + playerIds[i]);
            }
            uniqueIds[playerIds[i]] = true;
        }
        // All XI players must be in the 15-player squad
        var squadLookup = {};
        for (var i = 0; i < squad.players.length; i++) {
            squadLookup[squad.players[i].playerId] = squad.players[i];
        }
        for (var i = 0; i < playerIds.length; i++) {
            if (!squadLookup[playerIds[i]]) {
                errors.push("Player " + playerIds[i] + " is not in your squad");
            }
        }
        // Captain and vice-captain must be in XI
        if (!uniqueIds[captainId]) {
            errors.push("Captain " + captainId + " must be in the playing XI");
        }
        if (!uniqueIds[viceCaptainId]) {
            errors.push("Vice-captain " + viceCaptainId + " must be in the playing XI");
        }
        if (captainId === viceCaptainId) {
            errors.push("Captain and vice-captain must be different players");
        }
        // Role composition and overseas limit for the XI
        var overseasCount = 0;
        var teamCounts = {};
        var roleCounts = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };
        for (var i = 0; i < playerIds.length; i++) {
            var entry = catalog.players[playerIds[i]];
            if (!entry)
                continue;
            if (entry.isOverseas)
                overseasCount++;
            if (!teamCounts[entry.teamId])
                teamCounts[entry.teamId] = 0;
            teamCounts[entry.teamId]++;
            if (roleCounts[entry.role] !== undefined) {
                roleCounts[entry.role]++;
            }
        }
        if (overseasCount > FantasyTypes.MAX_OVERSEAS_IN_XI) {
            errors.push("Max " + FantasyTypes.MAX_OVERSEAS_IN_XI + " overseas players in XI, got " + overseasCount);
        }
        var teamIds = Object.keys(teamCounts);
        for (var i = 0; i < teamIds.length; i++) {
            if (teamCounts[teamIds[i]] > FantasyTypes.MAX_PER_REAL_TEAM) {
                errors.push("Max " + FantasyTypes.MAX_PER_REAL_TEAM + " players from one team in XI, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
            }
        }
        var roles = Object.keys(FantasyTypes.XI_MIN_ROLES);
        for (var i = 0; i < roles.length; i++) {
            var r = roles[i];
            if ((roleCounts[r] || 0) < FantasyTypes.XI_MIN_ROLES[r]) {
                errors.push("XI needs at least " + FantasyTypes.XI_MIN_ROLES[r] + " " + r + "(s), got " + (roleCounts[r] || 0));
            }
        }
        return { valid: errors.length === 0, errors: errors };
    }
    // ---- RPCs ----
    function rpcCreateTeam(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        var check = RpcHelpers.validatePayload(input, ["seasonId", "leagueId", "teamName", "players"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (!input.players || !input.players.length) {
            return RpcHelpers.errorResponse("Players array is required");
        }
        var catalog = getPlayerCatalog(nk, input.seasonId);
        if (!catalog) {
            return RpcHelpers.errorResponse("Player catalog not found for season " + input.seasonId);
        }
        var validation = validateSquad(input.players, catalog);
        if (!validation.valid) {
            return RpcHelpers.errorResponse("Squad validation failed: " + validation.errors.join("; "));
        }
        var squadPlayers = [];
        var totalCredits = 0;
        var captainId = "";
        var vcId = "";
        for (var i = 0; i < input.players.length; i++) {
            var p = input.players[i];
            var catEntry = catalog.players[p.playerId];
            totalCredits += catEntry.creditValue;
            if (p.isCaptain)
                captainId = p.playerId;
            if (p.isViceCaptain)
                vcId = p.playerId;
            squadPlayers.push({
                playerId: p.playerId,
                creditValue: catEntry.creditValue,
                teamId: catEntry.teamId,
                role: catEntry.role,
                isCaptain: p.isCaptain,
                isViceCaptain: p.isViceCaptain,
            });
        }
        var now = new Date().toISOString();
        var team = {
            userId: userId,
            seasonId: input.seasonId,
            leagueId: input.leagueId,
            teamName: input.teamName,
            players: squadPlayers,
            totalCredits: totalCredits,
            captainId: captainId,
            viceCaptainId: vcId,
            createdAt: now,
            updatedAt: now,
        };
        saveTeam(nk, team);
        // Invalidate any un-locked Playing XI selections that contain removed players
        var newSquadIds = squadPlayers.map(function (p) { return p.playerId; });
        var invalidatedFixtures = invalidateStaleXIs(nk, logger, userId, newSquadIds);
        var existing = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + input.seasonId, userId);
        if (!existing) {
            var state = {
                userId: userId,
                seasonId: input.seasonId,
                freeTransfersRemaining: 1,
                maxFreeTransfers: 1,
                totalTransfersMade: 0,
                penaltyPointsAccrued: 0,
                boostersUsed: [],
                transferHistory: [],
                updatedAt: now,
            };
            Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + input.seasonId, userId, state, 2, 1);
        }
        // Write to team index so auto-join can discover all users with teams
        Storage.writeJson(nk, FantasyTypes.COLLECTION, "team_idx_" + input.seasonId + "_" + userId, Constants.SYSTEM_USER_ID, { userId: userId, seasonId: input.seasonId, teamName: input.teamName, lockedAt: now }, 2, 0);
        logger.info("[FantasyTeam] User %s created squad '%s' (credits: %s)", userId, input.teamName, totalCredits.toFixed(1));
        EventBus.emit(nk, logger, ctx, "fantasy_team_created", {
            userId: userId, seasonId: input.seasonId, teamName: input.teamName, totalCredits: totalCredits,
        });
        var response = team;
        if (invalidatedFixtures.length > 0) {
            response = {
                team: team,
                invalidatedXIs: invalidatedFixtures,
                warning: "Playing XI cleared for " + invalidatedFixtures.length +
                    " fixture(s) due to squad changes. Please re-select your XI.",
            };
        }
        return RpcHelpers.successResponse(response);
    }
    function rpcGetTeam(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        if (!input.seasonId) {
            return RpcHelpers.errorResponse("seasonId is required");
        }
        var team = getTeam(nk, userId, input.seasonId);
        if (!team) {
            return RpcHelpers.errorResponse("No team found for this season");
        }
        return RpcHelpers.successResponse(team);
    }
    function rpcUpdateCaptain(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        var check = RpcHelpers.validatePayload(input, ["seasonId", "captainId", "viceCaptainId"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (input.captainId === input.viceCaptainId) {
            return RpcHelpers.errorResponse("Captain and vice-captain must be different");
        }
        var team = getTeam(nk, userId, input.seasonId);
        if (!team) {
            return RpcHelpers.errorResponse("No team found");
        }
        var captainFound = false;
        var vcFound = false;
        for (var i = 0; i < team.players.length; i++) {
            if (team.players[i].playerId === input.captainId)
                captainFound = true;
            if (team.players[i].playerId === input.viceCaptainId)
                vcFound = true;
        }
        if (!captainFound)
            return RpcHelpers.errorResponse("Captain not in squad: " + input.captainId);
        if (!vcFound)
            return RpcHelpers.errorResponse("Vice-captain not in squad: " + input.viceCaptainId);
        for (var i = 0; i < team.players.length; i++) {
            team.players[i].isCaptain = team.players[i].playerId === input.captainId;
            team.players[i].isViceCaptain = team.players[i].playerId === input.viceCaptainId;
        }
        team.captainId = input.captainId;
        team.viceCaptainId = input.viceCaptainId;
        team.updatedAt = new Date().toISOString();
        saveTeam(nk, team);
        return RpcHelpers.successResponse(team);
    }
    // ---- Match XI RPCs ----
    function rpcSelectMatchXI(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        var check = RpcHelpers.validatePayload(input, ["fixtureId", "seasonId", "playerIds", "captainId", "viceCaptainId"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (!input.playerIds || !input.playerIds.length) {
            return RpcHelpers.errorResponse("playerIds array is required");
        }
        // Deadline enforcement
        var deadline = getMatchDeadline(nk, input.fixtureId);
        if (deadline) {
            var nowSec = Math.floor(Date.now() / 1000);
            if (nowSec >= deadline.deadlineAt) {
                return RpcHelpers.errorResponse("Selection deadline has passed for this match. " +
                    "Deadline was " + new Date(deadline.deadlineAt * 1000).toISOString());
            }
        }
        // Get squad
        var squad = getTeam(nk, userId, input.seasonId);
        if (!squad) {
            return RpcHelpers.errorResponse("No squad found for season " + input.seasonId + ". Create a team first.");
        }
        // Get catalog for role/overseas validation
        var catalog = getPlayerCatalog(nk, input.seasonId);
        if (!catalog) {
            return RpcHelpers.errorResponse("Player catalog not found for season " + input.seasonId);
        }
        // Validate the XI
        var validation = validateMatchXI(input.playerIds, input.captainId, input.viceCaptainId, squad, catalog);
        if (!validation.valid) {
            return RpcHelpers.errorResponse("XI validation failed: " + validation.errors.join("; "));
        }
        var now = new Date().toISOString();
        var matchXI = {
            userId: userId,
            fixtureId: input.fixtureId,
            seasonId: input.seasonId,
            selectedPlayerIds: input.playerIds,
            captainId: input.captainId,
            viceCaptainId: input.viceCaptainId,
            lockedAt: now,
        };
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_XI + "_" + input.fixtureId, userId, matchXI, 2, 1);
        logger.info("[FantasyTeam] User %s selected XI for fixture %s (captain=%s, vc=%s)", userId, input.fixtureId, input.captainId, input.viceCaptainId);
        return RpcHelpers.successResponse(matchXI);
    }
    function rpcGetMatchXI(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var userId = RpcHelpers.resolveUserId(ctx, input);
        if (!input.fixtureId) {
            return RpcHelpers.errorResponse("fixtureId is required");
        }
        var xi = Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_XI + "_" + input.fixtureId, userId);
        if (!xi) {
            return RpcHelpers.errorResponse("No playing XI selected for fixture " + input.fixtureId);
        }
        return RpcHelpers.successResponse(xi);
    }
    /**
     * Admin RPC to set the selection deadline for a fixture.
     * Called by Intelliverse-X-AI when a match is scheduled.
     */
    function rpcSetMatchDeadline(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["fixtureId", "seasonId", "deadlineAt", "matchStartAt"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        var dl = {
            fixtureId: input.fixtureId,
            seasonId: input.seasonId,
            deadlineAt: input.deadlineAt,
            matchStartAt: input.matchStartAt,
        };
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.MATCH_DEADLINE + "_" + input.fixtureId, Constants.SYSTEM_USER_ID, dl, 2, 0);
        logger.info("[FantasyTeam] Deadline set for fixture %s: %s", input.fixtureId, new Date(input.deadlineAt * 1000).toISOString());
        return RpcHelpers.successResponse(dl);
    }
    /**
     * Admin RPC to sync the player catalog from the AI microservice.
     * Called by Intelliverse-X-AI after publishing player data to S3.
     * This bridges the S3 → Nakama storage gap so validateSquad() can
     * look up player IDs, credit values, roles, and team membership.
     */
    function rpcCatalogSync(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["seasonId", "players"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (!input.players || typeof input.players !== "object") {
            return RpcHelpers.errorResponse("players must be a non-empty object keyed by playerId");
        }
        var playerIds = Object.keys(input.players);
        if (playerIds.length < 50) {
            return RpcHelpers.errorResponse("Catalog rejected: only " + playerIds.length + " players (minimum 50 required). " +
                "This prevents accidental overwrites from partial/test data.");
        }
        var catalog = {
            seasonId: input.seasonId,
            leagueId: input.leagueId || "",
            updatedAt: input.updatedAt || new Date().toISOString(),
            players: input.players,
        };
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.PLAYER_CATALOG + "_" + input.seasonId, Constants.SYSTEM_USER_ID, catalog, 2, 0);
        logger.info("[FantasyTeam] Player catalog synced for season %s: %d players", input.seasonId, playerIds.length);
        return RpcHelpers.successResponse({
            seasonId: input.seasonId,
            playerCount: playerIds.length,
            syncedAt: catalog.updatedAt,
        });
    }
    /**
     * Admin RPC to inspect what's currently in the player catalog.
     * Useful for debugging "Unknown player ID" errors.
     */
    function rpcCatalogGet(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.seasonId) {
            return RpcHelpers.errorResponse("seasonId is required");
        }
        var catalog = getPlayerCatalog(nk, input.seasonId);
        if (!catalog) {
            return RpcHelpers.errorResponse("No player catalog found for season " + input.seasonId);
        }
        var playerIds = Object.keys(catalog.players);
        return RpcHelpers.successResponse({
            seasonId: catalog.seasonId,
            leagueId: catalog.leagueId,
            updatedAt: catalog.updatedAt,
            playerCount: playerIds.length,
            players: catalog.players,
        });
    }
    // ---- Registration ----
    function register(initializer) {
        initializer.registerRpc("fantasy_team_create", rpcCreateTeam);
        initializer.registerRpc("fantasy_team_get", rpcGetTeam);
        initializer.registerRpc("fantasy_team_update_captain", rpcUpdateCaptain);
        initializer.registerRpc("fantasy_match_xi_select", rpcSelectMatchXI);
        initializer.registerRpc("fantasy_match_xi_get", rpcGetMatchXI);
        initializer.registerRpc("fantasy_match_deadline_set", rpcSetMatchDeadline);
        initializer.registerRpc("fantasy_catalog_sync", rpcCatalogSync);
        initializer.registerRpc("fantasy_catalog_get", rpcCatalogGet);
    }
    FantasyTeam.register = register;
})(FantasyTeam || (FantasyTeam = {}));
// ============================================================================
// FANTASY CRICKET — Transfers
// ============================================================================
// RPCs:
//   fantasy_transfer        — Execute a set of transfers (in/out pairs)
//   fantasy_transfer_window  — Get current transfer window status
//   fantasy_transfer_history — Get user's transfer history for a season
// ============================================================================
var FantasyTransfer;
(function (FantasyTransfer) {
    var PENALTY_PER_EXTRA_TRANSFER = -4;
    // ---- Helpers ----
    function getTransferWindow(nk, seasonId, matchday) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TRANSFER_WINDOW + "_" + seasonId + "_" + matchday, Constants.SYSTEM_USER_ID);
    }
    function getSeasonState(nk, userId, seasonId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + seasonId, userId);
    }
    function saveSeasonState(nk, state) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.SEASON_STATE + "_" + state.seasonId, state.userId, state, 2, 1);
    }
    function getCatalog(nk, seasonId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.PLAYER_CATALOG + "_" + seasonId, Constants.SYSTEM_USER_ID);
    }
    function getTeam(nk, userId, seasonId) {
        return Storage.readJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + seasonId, userId);
    }
    function saveTeam(nk, team) {
        Storage.writeJson(nk, FantasyTypes.COLLECTION, FantasyTypes.Keys.TEAM + "_" + team.seasonId, team.userId, team, 2, 1);
    }
    // ---- RPCs ----
    function rpcTransfer(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["seasonId", "matchday", "transfersIn", "transfersOut"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        if (input.transfersIn.length !== input.transfersOut.length) {
            return RpcHelpers.errorResponse("transfersIn and transfersOut must be equal length");
        }
        if (input.transfersIn.length === 0) {
            return RpcHelpers.errorResponse("At least one transfer pair required");
        }
        var window = getTransferWindow(nk, input.seasonId, input.matchday);
        if (!window || !window.isOpen) {
            return RpcHelpers.errorResponse("Transfer window is closed for matchday " + input.matchday);
        }
        var now = new Date();
        if (window.closesAt && new Date(window.closesAt) < now) {
            return RpcHelpers.errorResponse("Transfer window has expired");
        }
        if (window.opensAt && new Date(window.opensAt) > now) {
            return RpcHelpers.errorResponse("Transfer window has not opened yet");
        }
        var catalog = getCatalog(nk, input.seasonId);
        if (!catalog)
            return RpcHelpers.errorResponse("Player catalog not found");
        var team = getTeam(nk, userId, input.seasonId);
        if (!team)
            return RpcHelpers.errorResponse("No squad found — create a team first");
        var seasonState = getSeasonState(nk, userId, input.seasonId);
        if (!seasonState)
            return RpcHelpers.errorResponse("Season state not found");
        var currentPlayerIds = {};
        for (var i = 0; i < team.players.length; i++) {
            currentPlayerIds[team.players[i].playerId] = true;
        }
        for (var i = 0; i < input.transfersOut.length; i++) {
            if (!currentPlayerIds[input.transfersOut[i]]) {
                return RpcHelpers.errorResponse("Player " + input.transfersOut[i] + " not in your squad");
            }
        }
        for (var i = 0; i < input.transfersIn.length; i++) {
            if (currentPlayerIds[input.transfersIn[i]]) {
                return RpcHelpers.errorResponse("Player " + input.transfersIn[i] + " already in your squad");
            }
            if (!catalog.players[input.transfersIn[i]]) {
                return RpcHelpers.errorResponse("Unknown player: " + input.transfersIn[i]);
            }
        }
        var numTransfers = input.transfersIn.length;
        var freeAvailable = seasonState.freeTransfersRemaining;
        var extraTransfers = Math.max(0, numTransfers - freeAvailable);
        var isBoosted = false;
        if (input.boosterId) {
            try {
                var inventoryItems = nk.storageRead([{
                        collection: "hiro_inventory",
                        key: input.boosterId,
                        userId: userId,
                    }]);
                if (inventoryItems && inventoryItems.length > 0) {
                    isBoosted = true;
                    extraTransfers = 0;
                    nk.storageDelete([{
                            collection: "hiro_inventory",
                            key: input.boosterId,
                            userId: userId,
                        }]);
                    seasonState.boostersUsed.push(input.boosterId);
                    logger.info("[FantasyTransfer] Booster %s consumed for user %s", input.boosterId, userId);
                }
                else {
                    return RpcHelpers.errorResponse("Booster not found in inventory: " + input.boosterId);
                }
            }
            catch (err) {
                return RpcHelpers.errorResponse("Failed to consume booster: " + (err.message || String(err)));
            }
        }
        var penaltyPoints = extraTransfers * PENALTY_PER_EXTRA_TRANSFER;
        var newPlayers = [];
        for (var i = 0; i < team.players.length; i++) {
            var isBeingRemoved = false;
            for (var j = 0; j < input.transfersOut.length; j++) {
                if (team.players[i].playerId === input.transfersOut[j]) {
                    isBeingRemoved = true;
                    break;
                }
            }
            if (!isBeingRemoved) {
                newPlayers.push(team.players[i]);
            }
        }
        for (var i = 0; i < input.transfersIn.length; i++) {
            var catEntry = catalog.players[input.transfersIn[i]];
            newPlayers.push({
                playerId: input.transfersIn[i],
                creditValue: catEntry.creditValue,
                teamId: catEntry.teamId,
                role: catEntry.role,
                isCaptain: false,
                isViceCaptain: false,
            });
        }
        var totalCredits = 0;
        var teamCounts = {};
        var roleCounts = { "batsman": 0, "bowler": 0, "all-rounder": 0, "wicket-keeper": 0 };
        for (var i = 0; i < newPlayers.length; i++) {
            totalCredits += newPlayers[i].creditValue;
            if (!teamCounts[newPlayers[i].teamId])
                teamCounts[newPlayers[i].teamId] = 0;
            teamCounts[newPlayers[i].teamId]++;
            if (roleCounts[newPlayers[i].role] !== undefined) {
                roleCounts[newPlayers[i].role]++;
            }
        }
        if (totalCredits > 100) {
            return RpcHelpers.errorResponse("Post-transfer credits " + totalCredits.toFixed(1) + " exceeds budget of 100");
        }
        var teamIds = Object.keys(teamCounts);
        for (var i = 0; i < teamIds.length; i++) {
            if (teamCounts[teamIds[i]] > 7) {
                return RpcHelpers.errorResponse("Post-transfer: max 7 per team, team " + teamIds[i] + " has " + teamCounts[teamIds[i]]);
            }
        }
        if (roleCounts["batsman"] < 3)
            return RpcHelpers.errorResponse("Post-transfer: need at least 3 batsmen");
        if (roleCounts["bowler"] < 3)
            return RpcHelpers.errorResponse("Post-transfer: need at least 3 bowlers");
        if (roleCounts["all-rounder"] < 1)
            return RpcHelpers.errorResponse("Post-transfer: need at least 1 all-rounder");
        if (roleCounts["wicket-keeper"] < 1)
            return RpcHelpers.errorResponse("Post-transfer: need at least 1 wicket-keeper");
        var captainStillPresent = false;
        var vcStillPresent = false;
        for (var i = 0; i < newPlayers.length; i++) {
            if (newPlayers[i].playerId === team.captainId)
                captainStillPresent = true;
            if (newPlayers[i].playerId === team.viceCaptainId)
                vcStillPresent = true;
        }
        if (!captainStillPresent) {
            return RpcHelpers.errorResponse("Captain was transferred out — set a new captain first or keep them in the squad");
        }
        if (!vcStillPresent) {
            return RpcHelpers.errorResponse("Vice-captain was transferred out — set a new VC first or keep them in the squad");
        }
        team.players = newPlayers;
        team.totalCredits = totalCredits;
        team.updatedAt = new Date().toISOString();
        saveTeam(nk, team);
        var nowIso = new Date().toISOString();
        for (var i = 0; i < input.transfersIn.length; i++) {
            var inEntry = catalog.players[input.transfersIn[i]];
            var outEntry = catalog.players[input.transfersOut[i]];
            seasonState.transferHistory.push({
                matchday: input.matchday,
                transferredIn: input.transfersIn[i],
                transferredOut: input.transfersOut[i],
                creditDelta: inEntry.creditValue - outEntry.creditValue,
                boosterUsed: isBoosted ? input.boosterId : null,
                timestamp: nowIso,
            });
        }
        seasonState.totalTransfersMade += numTransfers;
        seasonState.freeTransfersRemaining = Math.max(0, freeAvailable - numTransfers);
        seasonState.penaltyPointsAccrued += Math.abs(penaltyPoints);
        seasonState.updatedAt = nowIso;
        saveSeasonState(nk, seasonState);
        logger.info("[FantasyTransfer] User %s: %d transfers (free: %d, extra: %d, penalty: %d)", userId, numTransfers, Math.min(numTransfers, freeAvailable), extraTransfers, penaltyPoints);
        EventBus.emit(nk, logger, ctx, "fantasy_transfer_executed", {
            userId: userId,
            seasonId: input.seasonId,
            matchday: input.matchday,
            transferCount: numTransfers,
            penaltyPoints: penaltyPoints,
            boosterUsed: isBoosted,
        });
        return RpcHelpers.successResponse({
            team: team,
            transfersMade: numTransfers,
            freeTransfersUsed: Math.min(numTransfers, freeAvailable),
            extraTransfers: extraTransfers,
            penaltyPoints: penaltyPoints,
            boosterConsumed: isBoosted ? input.boosterId : null,
            freeTransfersRemaining: seasonState.freeTransfersRemaining,
        });
    }
    function rpcTransferWindow(ctx, logger, nk, payload) {
        var input = RpcHelpers.parseRpcPayload(payload);
        var check = RpcHelpers.validatePayload(input, ["seasonId", "matchday"]);
        if (!check.valid) {
            return RpcHelpers.errorResponse("Missing fields: " + check.missing.join(", "));
        }
        var window = getTransferWindow(nk, input.seasonId, input.matchday);
        if (!window) {
            return RpcHelpers.errorResponse("No transfer window found for matchday " + input.matchday);
        }
        return RpcHelpers.successResponse(window);
    }
    function rpcTransferHistory(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var input = RpcHelpers.parseRpcPayload(payload);
        if (!input.seasonId) {
            return RpcHelpers.errorResponse("seasonId is required");
        }
        var state = getSeasonState(nk, userId, input.seasonId);
        if (!state) {
            return RpcHelpers.errorResponse("Season state not found");
        }
        return RpcHelpers.successResponse({
            totalTransfers: state.totalTransfersMade,
            freeTransfersRemaining: state.freeTransfersRemaining,
            penaltyPointsAccrued: state.penaltyPointsAccrued,
            boostersUsed: state.boostersUsed,
            history: state.transferHistory,
        });
    }
    // ---- Registration ----
    function register(initializer) {
        initializer.registerRpc("fantasy_transfer", rpcTransfer);
        initializer.registerRpc("fantasy_transfer_window", rpcTransferWindow);
        initializer.registerRpc("fantasy_transfer_history", rpcTransferHistory);
    }
    FantasyTransfer.register = register;
})(FantasyTransfer || (FantasyTransfer = {}));
// ============================================================================
// FANTASY CRICKET — Shared Types
// ============================================================================
var FantasyTypes;
(function (FantasyTypes) {
    // ---- Storage Collection & Key Constants ----
    FantasyTypes.COLLECTION = "fantasy_cricket";
    FantasyTypes.Keys = {
        TEAM: "team", // per-user squad
        MATCH_XI: "match_xi", // per-user per-fixture playing XI (11 from 15)
        SEASON_STATE: "season_state", // per-user season metadata (transfers, boosters)
        SCORING_CONFIG: "scoring_config", // system-level scoring rules
        PLAYER_CATALOG: "player_catalog", // system-level credit values
        TRANSFER_WINDOW: "transfer_window", // system-level window state
        MATCH_POINTS: "match_points", // per-user per-match points
        LEAGUE_META: "league_meta", // per-group metadata
        MATCH_DEADLINE: "match_deadline", // system-level per-fixture deadline
    };
    FantasyTypes.LEADERBOARD_SEASON = "fantasy_season";
    FantasyTypes.LEADERBOARD_MATCH_PREFIX = "fantasy_match_";
    FantasyTypes.LEADERBOARD_LEAGUE_PREFIX = "fantasy_league_";
    // ---- Squad Composition Constants ----
    FantasyTypes.SQUAD_SIZE = 15;
    FantasyTypes.XI_SIZE = 11;
    FantasyTypes.CREDIT_BUDGET = 100;
    FantasyTypes.MAX_PER_REAL_TEAM = 7;
    FantasyTypes.MAX_OVERSEAS_IN_XI = 4;
    FantasyTypes.MAX_OVERSEAS_IN_SQUAD = 8;
    FantasyTypes.SQUAD_MIN_ROLES = {
        "batsman": 3,
        "bowler": 3,
        "all-rounder": 1,
        "wicket-keeper": 1,
    };
    FantasyTypes.XI_MIN_ROLES = {
        "batsman": 3,
        "bowler": 2,
        "all-rounder": 1,
        "wicket-keeper": 1,
    };
    // ---- Default Scoring Config ----
    function defaultScoringConfig(seasonId) {
        return {
            seasonId: seasonId,
            batting: {
                perRun: 1,
                boundaryBonus: 1,
                sixBonus: 2,
                halfCenturyBonus: 8,
                centuryBonus: 16,
                duckPenalty: -2,
            },
            bowling: {
                perWicket: 25,
                bonusBowled: 8,
                bonusLbw: 8,
                threeWicketBonus: 4,
                fourWicketBonus: 8,
                fiveWicketBonus: 16,
                maidenOverBonus: 12,
            },
            fielding: {
                perCatch: 8,
                perStumping: 12,
                perRunOut: 6,
                perRunOutAssist: 4,
            },
            bonuses: {
                strikeRateAbove170: 6,
                strikeRateAbove150: 4,
                strikeRateAbove130: 2,
                strikeRateBelow60: -4,
                strikeRateBelow50: -6,
                economyBelow5: 6,
                economyBelow6: 4,
                economyBelow7: 2,
                economyAbove10: -2,
                economyAbove11: -4,
                economyAbove12: -6,
                minimumBallsForSR: 10,
                minimumOversForER: 2,
            },
            penalties: {
                perExtraPenaltyTransfer: -4,
            },
            captainMultiplier: 2,
            viceCaptainMultiplier: 1.5,
        };
    }
    FantasyTypes.defaultScoringConfig = defaultScoringConfig;
})(FantasyTypes || (FantasyTypes = {}));
// ============================================================================
// src/friends/find_friends.ts — Canonical Player Search RPC (TypeScript)
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// Replaces every prior implementation of the player-search RPC. This is the
// ONLY handler for player search going forward. Registered via main.ts and
// pinned in `_tsRpcList`, so the legacy bridge cannot accidentally
// shadow it from any older `data/modules/*.js` file.
//
// RPC ID
// ------
//   intelliverse_find_friends     (canonical, snake_case, intelliverse-prefixed)
//
// HARD RENAME — the old IDs `quizverse_find_friends` and
// `lasttolive_find_friends` are NO LONGER REGISTERED. Clients calling them
// receive Nakama's default "rpc not found" error. All Unity callsites are
// updated in this same change. If you need cross-game search later, the
// canonical name covers all games — gameID is informational, never required.
//
// Search behaviour — TIERED + FUZZY
// ---------------------------------
// Results are returned in this priority order (`rank_tier`):
//
//   Tier 1: username  matches the query as a PREFIX (case-insensitive)
//   Tier 2: display_name matches the query as a PREFIX
//   Tier 3: username  contains the query as a SUBSTRING
//   Tier 4: display_name contains the query as a SUBSTRING
//   Tier 5: trigram-similarity ≥ PERMISSIVE threshold (typo-tolerant fuzzy match)
//
// Within each tier, ties are broken by trigram similarity (DESC) then
// username ASC for stable pagination. PERMISSIVE fuzziness (similarity ≥ 0.30,
// Postgres' default pg_trgm threshold) catches realistic typos like "ahmd" →
// "ahmed" or "carlls" → "carlos". Recall is favoured here because the tiered
// ORDER BY guarantees exact prefix/substring matches are still returned at
// the top of the list — the loosened fuzzy tier only fills in below them, so
// the "as-you-type" suggestion experience stays sharp without dropping legit
// typo'd queries on the floor.
//
// Performance
// -----------
// `bootstrapDatabase()` (called from main.ts InitModule) creates:
//   - the pg_trgm extension (if not already present)
//   - GIN trigram indexes on users.username and users.display_name
// Both are idempotent and use IF NOT EXISTS — safe to re-run on every boot.
//
// With those indexes, the full tiered+fuzzy query stays sub-50ms even on
// millions of users. Without pg_trgm available, the runtime auto-degrades
// to ILIKE-only (still fast thanks to the GIN-trgm index, which Postgres
// also uses for ILIKE '%pattern%') and logs a one-time warning.
//
// What this implementation guarantees
// -----------------------------------
//   * Real online status from `player_presence` storage collection (the
//     `users.edge_count` column in Postgres is a friend-edge count, NOT a
//     presence indicator — every prior version was hard-coding garbage)
//   * Username + display-name search via Postgres ILIKE + pg_trgm similarity
//   * Pagination via opaque numeric `cursor` (offset)
//   * Idempotent — same query+cursor returns the same page
//   * Strong input sanitisation: max length, escape SQL LIKE wildcards,
//     reject control characters
//   * Standardised error envelope with stable machine `errorCode` strings
//   * Defensive Postgres date-parsing (Nakama's "no disabled" sentinel
//     is `'1970-01-01 00:00:00 UTC'` — we keep the same predicate)
//   * Two-tier fallback: pg_trgm SQL → ILIKE-only SQL → usersGetUsername
//   * Skips the caller themselves and anyone they have blocked
//   * Enriches each result with relationship status:
//       'none' | 'friend' | 'pending_sent' | 'pending_received' | 'blocked'
//
// Payload contract
//   {
//     "gameID":   "quizverse",      // optional — informational only
//     "query":    "carlo",          // required, 2..50 chars
//     "limit":    20,               // optional, default 20, max 50
//     "cursor":   "20"              // optional pagination cursor
//   }
//
// Response (success)
//   {
//     "success": true,
//     "data": {
//       "results":     [ { userId, username, displayName, avatarUrl,
//                          online, createTime, relationshipStatus,
//                          matchTier, similarity } ],
//       "query":       "carlo",
//       "count":       12,
//       "searcherId":  "<uuid>",
//       "nextCursor":  "32"   | null    // null when no more pages
//     }
//   }
//
// Response (error)
//   {
//     "success": false,
//     "error":     "human readable message",
//     "errorCode": "machine_id"   // see ErrorCodes below
//   }
// ============================================================================
var IntelliverseFriends;
(function (IntelliverseFriends) {
    // ── Constants ──────────────────────────────────────────────────────────
    var PRESENCE_COLLECTION = "player_presence";
    var PRESENCE_KEY = "status";
    var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min ⇒ online
    // PERMISSIVE fuzziness — biased towards recall so the player-search UX
    // catches realistic typos. 0.30 is Postgres' default pg_trgm threshold
    // and reliably matches a single dropped/swapped char in a 4–6 char
    // query (e.g. "ahmd" finds "ahmed", "carlls" finds "carlos"). The
    // tiered ORDER BY (rank_tier ASC, sim_score DESC) keeps exact prefix
    // matches at the top, so loosening recall here doesn't degrade the
    // primary "as-you-type" suggestion experience. Tweak in lock-step
    // with the docstring above.
    var TRGM_SIMILARITY_THRESHOLD = 0.30;
    // Nakama friend-state ints (mirror of nkruntime.FriendState — not exported)
    var STATE_FRIEND = 0;
    var STATE_INVITE_SENT = 1;
    var STATE_INVITE_RECEIVED = 2;
    var STATE_BLOCKED = 3;
    // Stable machine error codes — clients can switch on these.
    var ERR_UNAUTHENTICATED = "unauthenticated";
    var ERR_INVALID_PAYLOAD = "invalid_payload";
    var ERR_QUERY_TOO_SHORT = "query_too_short";
    var ERR_SEARCH_UNAVAILABLE = "search_unavailable";
    // Module-level cache — flips to false on the first SQL error that mentions
    // pg_trgm so subsequent calls skip the fuzzy path entirely. Avoids a
    // try/catch on the hot path after the first miss.
    var _trgmAvailable = true;
    // One-time warning gate so a misconfigured DB doesn't spam logs.
    var _trgmWarningLogged = false;
    // ── Phase-4 fuzzy_add_metrics: in-process counters ─────────────────────
    // Lightweight per-process telemetry. Counters only — no per-call objects
    // to avoid GC pressure on a hot path. Values reset on every server boot
    // (we accept that — Prometheus / Datadog scrapers will capture deltas).
    // A single periodic INFO log line emits the snapshot every N calls so
    // ops can see the breakdown without scraping anything else.
    var _metrics = {
        totalCalls: 0,
        pathTrgm: 0, // pg_trgm fuzzy SQL succeeded
        pathIlike: 0, // ILIKE-only SQL (degraded — pg_trgm absent)
        pathFallback: 0, // usersGetUsername exact-match fallback
        emptyResults: 0, // calls returning zero rows (potential UX dead-end)
        totalLatencyMs: 0, // sum across ALL calls (avg = total/totalCalls)
        maxLatencyMs: 0, // worst single call observed since boot
        queryLenSum: 0, // sum of query string lengths (avg query length)
        invalidPayloads: 0, // bad JSON / missing fields
        queryTooShort: 0 // queries < 2 chars
    };
    // Emit a snapshot every N calls. 250 keeps logs sparse on a busy server
    // (~1 line per ~30s on a 10 RPS deployment) but frequent enough during
    // low traffic / dev to be useful.
    var METRICS_LOG_EVERY = 250;
    // ── Result envelope helpers ────────────────────────────────────────────
    function ok(data) {
        return JSON.stringify({ success: true, data: data });
    }
    function err(message, errorCode, extra) {
        var out = { success: false, error: message, errorCode: errorCode };
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k))
                    out[k] = extra[k];
            }
        }
        return JSON.stringify(out);
    }
    function parsePayload(payload) {
        if (!payload || payload === "")
            return { ok: true, data: {} };
        try {
            return { ok: true, data: JSON.parse(payload) };
        }
        catch (e) {
            return { ok: false, error: "Invalid JSON payload: " + (e.message || String(e)) };
        }
    }
    /**
     * Bulk-load presence rows for many users. We use targeted storageRead
     * (one read per user, all batched) rather than scanning a collection
     * because presence is owned by each user themselves — there is no
     * cross-user storageList for arbitrary user ids.
     *
     * Returns a { userId: boolean } map. Missing entries default to false.
     */
    function loadOnlineMap(nk, userIds) {
        var map = {};
        if (!userIds || userIds.length === 0)
            return map;
        var reads = [];
        for (var i = 0; i < userIds.length; i++) {
            reads.push({
                collection: PRESENCE_COLLECTION,
                key: PRESENCE_KEY,
                userId: userIds[i]
            });
        }
        var rows = null;
        try {
            rows = nk.storageRead(reads);
        }
        catch (e) {
            // Presence is optional context — never fail the search because of it.
            return map;
        }
        if (!rows)
            return map;
        var nowMs = Date.now();
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !row.value)
                continue;
            var v = row.value;
            var online = false;
            if (v.online === true) {
                var lastSeenMs = 0;
                if (typeof v.lastSeenMs === "number")
                    lastSeenMs = v.lastSeenMs;
                else if (typeof v.last_seen_ms === "number")
                    lastSeenMs = v.last_seen_ms;
                else if (typeof v.lastSeen === "string") {
                    var t = Date.parse(v.lastSeen);
                    if (!isNaN(t))
                        lastSeenMs = t;
                }
                if (lastSeenMs === 0 || (nowMs - lastSeenMs) <= ONLINE_THRESHOLD_MS) {
                    online = true;
                }
            }
            map[row.userId] = online;
        }
        return map;
    }
    /**
     * Collapse Nakama's friend graph into:
     *   - relationMap: { friendUserId: 'friend'|'pending_sent'|'pending_received'|'blocked' }
     *   - blockedSet:  { blockedUserId: true } (skipped from results entirely)
     */
    function loadRelationship(nk, logger, userId) {
        var relationMap = {};
        var blockedSet = {};
        try {
            // 1000 is well above realistic friend list sizes; we don't paginate
            // here because relationship enrichment must be complete or absent.
            var resp = nk.friendsList(userId, 1000, undefined, undefined);
            if (resp && resp.friends) {
                for (var i = 0; i < resp.friends.length; i++) {
                    var fr = resp.friends[i];
                    if (!fr || !fr.user)
                        continue;
                    var s = (fr.state && typeof fr.state === "object" && "value" in fr.state)
                        ? fr.state.value
                        : fr.state;
                    var fid = fr.user.id;
                    if (s === STATE_FRIEND)
                        relationMap[fid] = "friend";
                    else if (s === STATE_INVITE_SENT)
                        relationMap[fid] = "pending_sent";
                    else if (s === STATE_INVITE_RECEIVED)
                        relationMap[fid] = "pending_received";
                    else if (s === STATE_BLOCKED) {
                        relationMap[fid] = "blocked";
                        blockedSet[fid] = true;
                    }
                }
            }
        }
        catch (e) {
            // Relationship lookup failure must NOT fail the search — just degrade
            // to "no enrichment" (every result will read relationshipStatus='none').
            if (logger && logger.warn) {
                logger.warn("[IntelliverseFindFriends] friendsList lookup failed: " + (e.message || String(e)));
            }
        }
        return { relationMap: relationMap, blockedSet: blockedSet };
    }
    /**
     * Detect whether the SQL error is specifically the "pg_trgm not installed"
     * shape so we can flip the module flag and stop retrying the fuzzy path.
     * Postgres error messages we want to catch:
     *   - 'function similarity(text, text) does not exist'
     *   - 'operator does not exist: text % text'
     *   - 'extension "pg_trgm" is not available'
     */
    function isTrgmMissingError(e) {
        var msg = ((e && (e.message || String(e))) || "").toLowerCase();
        if (!msg)
            return false;
        return msg.indexOf("similarity(") >= 0
            || msg.indexOf("pg_trgm") >= 0
            || (msg.indexOf("operator does not exist") >= 0 && msg.indexOf("text %") >= 0);
    }
    /**
     * Tiered + fuzzy SQL search (preferred path, requires pg_trgm).
     *
     * $1 = escapedQuery   (LIKE-pattern-safe; '%' '_' '\' escaped)
     * $2 = rawQuery       (raw user input for similarity())
     * $3 = userId         (excluded from results)
     * $4 = limit          (page size + over-fetch margin)
     * $5 = offset         (pagination)
     *
     * The ESCAPE clause uses Postgres E'\\' (an escape string containing a
     * single backslash) so the '\\%' / '\\_' sequences from sanitisation are
     * treated as literal % / _ rather than wildcards.
     */
    function searchWithTrgm(nk, escapedQuery, rawQuery, userId, limit, offset) {
        var sql = "SELECT " +
            "  id, username, display_name, avatar_url, create_time, " +
            "  CASE " +
            "    WHEN username ILIKE $1 || '%' ESCAPE E'\\\\' THEN 1 " +
            "    WHEN display_name ILIKE $1 || '%' ESCAPE E'\\\\' THEN 2 " +
            "    WHEN username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 3 " +
            "    WHEN display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 4 " +
            "    ELSE 5 " +
            "  END AS rank_tier, " +
            "  GREATEST( " +
            "    similarity(username, $2), " +
            "    similarity(coalesce(display_name, ''), $2) " +
            "  ) AS sim_score " +
            "FROM users " +
            "WHERE id != $3 " +
            "  AND disable_time = '1970-01-01 00:00:00 UTC' " +
            "  AND ( " +
            "       username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
            "    OR display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
            "    OR similarity(username, $2) >= " + TRGM_SIMILARITY_THRESHOLD + " " +
            "    OR similarity(coalesce(display_name, ''), $2) >= " + TRGM_SIMILARITY_THRESHOLD + " " +
            "  ) " +
            "ORDER BY rank_tier ASC, sim_score DESC, username ASC " +
            "LIMIT $4 OFFSET $5";
        var rows = nk.sqlQuery(sql, [escapedQuery, rawQuery, userId, limit, offset]);
        return rows || [];
    }
    /**
     * ILIKE-only SQL search (degraded path used when pg_trgm is unavailable).
     * Loses fuzzy matching but keeps the tiered ranking so users still see
     * exact prefix → substring matches in a sensible order.
     *
     * $1 = escapedQuery, $2 = userId, $3 = limit, $4 = offset
     */
    function searchWithIlikeOnly(nk, escapedQuery, userId, limit, offset) {
        var sql = "SELECT " +
            "  id, username, display_name, avatar_url, create_time, " +
            "  CASE " +
            "    WHEN username ILIKE $1 || '%' ESCAPE E'\\\\' THEN 1 " +
            "    WHEN display_name ILIKE $1 || '%' ESCAPE E'\\\\' THEN 2 " +
            "    WHEN username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 3 " +
            "    WHEN display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 4 " +
            "    ELSE 5 " +
            "  END AS rank_tier, " +
            "  0::float AS sim_score " +
            "FROM users " +
            "WHERE id != $2 " +
            "  AND disable_time = '1970-01-01 00:00:00 UTC' " +
            "  AND (username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
            "       OR display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\') " +
            "ORDER BY rank_tier ASC, username ASC " +
            "LIMIT $3 OFFSET $4";
        var rows = nk.sqlQuery(sql, [escapedQuery, userId, limit, offset]);
        return rows || [];
    }
    // ── The RPC handler ────────────────────────────────────────────────────
    function rpcIntelliverseFindFriends(ctx, logger, nk, payload) {
        var __t0 = Date.now(); // Phase-4 metrics: per-call latency clock
        var userId = ctx.userId;
        if (!userId)
            return err("Authentication required", ERR_UNAUTHENTICATED);
        var parsed = parsePayload(payload);
        if (!parsed.ok) {
            _metrics.invalidPayloads++;
            return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);
        }
        var data = parsed.data || {};
        // ── Validate query ──────────────────────────────────────────────────
        if (!data.query || typeof data.query !== "string") {
            _metrics.invalidPayloads++;
            return err("Query string is required", ERR_INVALID_PAYLOAD);
        }
        var query = data.query.trim();
        // Strip control chars + zero-width space (defence against UI weirdness)
        query = query.replace(/[\x00-\x1f\x7f\u200B-\u200F]/g, "");
        if (query.length < 2) {
            _metrics.queryTooShort++;
            return err("Query must be at least 2 characters", ERR_QUERY_TOO_SHORT);
        }
        if (query.length > 50)
            query = query.substring(0, 50);
        // Escape Postgres LIKE wildcards in user input. The escape character
        // matches the ESCAPE E'\\' clause in the SQL queries above.
        var likeQuery = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
        // ── Validate paging ─────────────────────────────────────────────────
        var limit = parseInt(data.limit, 10);
        if (isNaN(limit) || limit < 1)
            limit = 20;
        if (limit > 50)
            limit = 50;
        var offset = 0;
        if (data.cursor) {
            offset = parseInt(data.cursor, 10);
            if (isNaN(offset) || offset < 0)
                offset = 0;
            if (offset > 1000)
                offset = 1000; // hard cap — protect DB from runaway pagination
        }
        // Over-fetch slightly so we can drop blocked users without short-paging.
        var fetchLimit = limit + 20;
        // ── Phase 1: Postgres search ───────────────────────────────────────
        var rows = [];
        var sqlOk = false;
        var usedTrgm = false;
        try {
            if (_trgmAvailable) {
                try {
                    rows = searchWithTrgm(nk, likeQuery, query, userId, fetchLimit, offset);
                    sqlOk = true;
                    usedTrgm = true;
                }
                catch (e) {
                    if (isTrgmMissingError(e)) {
                        _trgmAvailable = false;
                        if (!_trgmWarningLogged && logger && logger.warn) {
                            _trgmWarningLogged = true;
                            logger.warn("[IntelliverseFindFriends] pg_trgm extension not available; " +
                                "falling back to ILIKE-only search permanently for this server " +
                                "process. Run `CREATE EXTENSION pg_trgm` as a Postgres superuser " +
                                "to enable typo-tolerant fuzzy search. Reason: " +
                                (e.message || String(e)));
                        }
                        // Fall through to the ILIKE retry below
                    }
                    else {
                        // Different SQL error — not a pg_trgm issue. Re-throw to outer catch.
                        throw e;
                    }
                }
            }
            if (!sqlOk) {
                rows = searchWithIlikeOnly(nk, likeQuery, userId, fetchLimit, offset);
                sqlOk = true;
            }
        }
        catch (sqlErr) {
            if (logger && logger.warn) {
                logger.warn("[IntelliverseFindFriends] SQL search failed; falling back to exact-match: " +
                    (sqlErr.message || String(sqlErr)));
            }
            // Fallback: exact username via Nakama API. Partial / fuzzy search is
            // impossible on this path — but at least an exact handle still resolves.
            try {
                var exact = nk.usersGetUsername([query]);
                if (exact && exact.length > 0) {
                    for (var u = 0; u < exact.length; u++) {
                        if (exact[u].userId !== userId) {
                            rows.push({
                                id: exact[u].userId,
                                username: exact[u].username || "",
                                display_name: exact[u].displayName || exact[u].username || "",
                                avatar_url: exact[u].avatarUrl || "",
                                create_time: exact[u].createTime || "",
                                rank_tier: 1,
                                sim_score: 1
                            });
                        }
                    }
                }
            }
            catch (fbErr) {
                if (logger && logger.error) {
                    logger.error("[IntelliverseFindFriends] Fallback usersGetUsername failed: " +
                        (fbErr.message || String(fbErr)));
                }
                return err("Search service unavailable", ERR_SEARCH_UNAVAILABLE);
            }
        }
        // ── Phase 2: relationship enrichment ───────────────────────────────
        var rel = loadRelationship(nk, logger, userId);
        var relationMap = rel.relationMap;
        var blockedSet = rel.blockedSet;
        // ── Phase 3: gather candidate ids and fetch real online status ─────
        var candidateIds = [];
        for (var c = 0; c < rows.length; c++) {
            var rid = rows[c].id;
            if (rid && rid !== userId && !blockedSet[rid]) {
                candidateIds.push(rid);
            }
        }
        var onlineMap = loadOnlineMap(nk, candidateIds);
        // ── Phase 4: build the page (after blocked filter, capped to limit) ─
        var results = [];
        var consumed = 0; // how many DB rows we walked through (for next-cursor calc)
        for (var i = 0; i < rows.length && results.length < limit; i++) {
            consumed++;
            var row = rows[i];
            var rid2 = row.id;
            if (rid2 === userId)
                continue;
            if (blockedSet[rid2])
                continue;
            // sim_score may come back as a numeric Postgres FLOAT — coerce defensively.
            var simRaw = row.sim_score;
            var sim = typeof simRaw === "number" ? simRaw : parseFloat(simRaw);
            if (isNaN(sim))
                sim = 0;
            var tierRaw = row.rank_tier;
            var tier = typeof tierRaw === "number" ? tierRaw : parseInt(tierRaw, 10);
            if (isNaN(tier))
                tier = 5;
            results.push({
                userId: rid2,
                username: row.username || "",
                displayName: row.display_name || row.username || "",
                avatarUrl: row.avatar_url || "",
                online: !!onlineMap[rid2],
                createTime: row.create_time || "",
                relationshipStatus: relationMap[rid2] || "none",
                // Diagnostic fields — useful for client-side highlighting + telemetry.
                // Tier mapping: 1=username prefix, 2=display prefix, 3=username substring,
                // 4=display substring, 5=fuzzy-only.
                matchTier: tier,
                similarity: Math.round(sim * 1000) / 1000 // 3 decimal places
            });
        }
        // Compute next cursor — null when we exhausted the page or hit the cap.
        // Pagination semantics: we only emit a cursor when the SQL path filled
        // the over-fetch window AND we returned a full client page. The fallback
        // (usersGetUsername) is single-shot and never paginates.
        var nextCursor = null;
        if (sqlOk && results.length === limit && rows.length === fetchLimit) {
            nextCursor = String(offset + consumed);
        }
        // ── Phase-4 metrics: record path + latency ─────────────────────────
        var __latencyMs = Date.now() - __t0;
        var __pathLabel = usedTrgm ? "trgm" : (sqlOk ? "ilike" : "fallback");
        _metrics.totalCalls++;
        _metrics.totalLatencyMs += __latencyMs;
        if (__latencyMs > _metrics.maxLatencyMs)
            _metrics.maxLatencyMs = __latencyMs;
        _metrics.queryLenSum += query.length;
        if (results.length === 0)
            _metrics.emptyResults++;
        if (__pathLabel === "trgm")
            _metrics.pathTrgm++;
        else if (__pathLabel === "ilike")
            _metrics.pathIlike++;
        else
            _metrics.pathFallback++;
        if (logger && logger.info) {
            logger.info("[IntelliverseFindFriends] user=" + userId +
                ' query="' + query + '"' +
                " queryLen=" + query.length +
                " path=" + __pathLabel +
                " latencyMs=" + __latencyMs +
                " returned=" + results.length +
                " (offset=" + offset + ", nextCursor=" + (nextCursor || "null") + ")");
            // Periodic snapshot — keeps INFO log volume sparse but gives ops a
            // single line that summarises path mix, avg latency, and empty-result
            // rate. P95/P99 would need a histogram (overkill for this RPC).
            if (_metrics.totalCalls % METRICS_LOG_EVERY === 0) {
                var avgLatency = Math.round(_metrics.totalLatencyMs / _metrics.totalCalls);
                var avgQueryLen = Math.round((_metrics.queryLenSum / _metrics.totalCalls) * 10) / 10;
                var emptyPct = Math.round((_metrics.emptyResults / _metrics.totalCalls) * 1000) / 10;
                logger.info("[IntelliverseFindFriends.metrics] calls=" + _metrics.totalCalls +
                    " trgm=" + _metrics.pathTrgm +
                    " ilike=" + _metrics.pathIlike +
                    " fallback=" + _metrics.pathFallback +
                    " avgLatencyMs=" + avgLatency +
                    " maxLatencyMs=" + _metrics.maxLatencyMs +
                    " avgQueryLen=" + avgQueryLen +
                    " emptyResults%=" + emptyPct +
                    " invalidPayloads=" + _metrics.invalidPayloads +
                    " queryTooShort=" + _metrics.queryTooShort);
            }
        }
        return ok({
            results: results,
            query: query,
            count: results.length,
            searcherId: userId,
            nextCursor: nextCursor
        });
    }
    // ── Database bootstrap (idempotent) ────────────────────────────────────
    /**
     * Ensures the Postgres extension and indexes that power tiered+fuzzy
     * search exist. Safe to call on every server boot — every statement
     * uses IF NOT EXISTS.
     *
     * What it creates:
     *   1. The `pg_trgm` extension (Postgres bundled contrib module).
     *   2. A GIN trigram index on `users.username`.
     *   3. A GIN trigram index on `users.display_name`.
     *
     * Failure modes (all degrade gracefully — never crash the runtime):
     *   - CREATE EXTENSION requires a Postgres superuser. If the runtime DB
     *     user lacks that, the extension call fails with permission denied.
     *     We log a one-time WARN and the RPC handler auto-falls-back to
     *     ILIKE-only search (still indexed once the GIN indexes exist).
     *   - If pg_trgm is genuinely absent the GIN-index calls will also fail
     *     because they reference `gin_trgm_ops`. Same degradation path.
     */
    function bootstrapDatabase(nk, logger) {
        var statements = [
            { sql: "CREATE EXTENSION IF NOT EXISTS pg_trgm",
                label: "extension pg_trgm" },
            { sql: "CREATE INDEX IF NOT EXISTS idx_users_username_trgm " +
                    "ON users USING gin (username gin_trgm_ops)",
                label: "index idx_users_username_trgm" },
            { sql: "CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm " +
                    "ON users USING gin (display_name gin_trgm_ops)",
                label: "index idx_users_display_name_trgm" },
        ];
        for (var i = 0; i < statements.length; i++) {
            var stmt = statements[i];
            try {
                nk.sqlExec(stmt.sql, []);
                if (logger && logger.info) {
                    logger.info("[IntelliverseFindFriends] bootstrap OK: " + stmt.label);
                }
            }
            catch (e) {
                // Extension creation needs SUPERUSER; index creation needs the
                // extension. Either failure is non-fatal — the RPC's runtime
                // fallback will keep search working.
                var emsg = (e && (e.message || String(e))) || "unknown error";
                if (logger && logger.warn) {
                    logger.warn("[IntelliverseFindFriends] bootstrap step '" + stmt.label +
                        "' failed (non-fatal — fuzzy search will degrade to ILIKE-only): " + emsg);
                }
                // If the extension itself failed, no point trying the indexes that
                // depend on it. Bail out of the rest of the bootstrap loop.
                if (i === 0 && (emsg.toLowerCase().indexOf("pg_trgm") >= 0 ||
                    emsg.toLowerCase().indexOf("permission denied") >= 0)) {
                    _trgmAvailable = false;
                    break;
                }
            }
        }
    }
    IntelliverseFriends.bootstrapDatabase = bootstrapDatabase;
    // ── Public registration ────────────────────────────────────────────────
    function register(initializer) {
        initializer.registerRpc("intelliverse_find_friends", rpcIntelliverseFindFriends);
    }
    IntelliverseFriends.register = register;
})(IntelliverseFriends || (IntelliverseFriends = {}));
// ============================================================================
// src/friends/friends_list.ts — Canonical friends_list + list_blocked_users
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// Replaces the 6-line passthrough handler that used to live in
// `src/legacy/friends.ts` (LegacyFriends.rpcFriendsList). That handler just
// returned `nk.friendsList()`'s raw nested shape — no presence enrichment,
// no relationship envelope, no displayName flattening — which made the
// friends list inconsistent with `intelliverse_find_friends` results.
//
// What this module owns
// ---------------------
//   friends_list        – the canonical friend roster (state filter optional)
//   list_blocked_users  – the dedicated "Blocked Users" enumeration (Phase-4 H1)
//
// Both RPCs return the SAME flat shape as `intelliverse_find_friends` so
// the Unity adapter can render any of these three sources with identical
// row prefabs:
//
//   {
//     "userId":             string,
//     "username":           string,
//     "displayName":        string,
//     "avatarUrl":          string,
//     "online":             bool,           // from `player_presence` collection
//     "createTime":         iso8601 string, // user creation
//     "relationshipStatus": "friend" | "pending_sent" | "pending_received" | "blocked",
//     "state":              0..3            // raw Nakama FriendState int
//   }
//
// Pagination contract (friends_list only)
// ---------------------------------------
//   request:  { limit?: int (1..500, default 100), state?: 0..3, cursor?: string }
//   response: { results: NakamaFriend[], count: int, nextCursor: string|null }
//
// `state` is OPTIONAL. When omitted, ALL relationship states are returned
// (matches Nakama's default). When set:
//   0 = friends only
//   1 = invites you SENT (still pending)
//   2 = invites you RECEIVED (still pending)
//   3 = users YOU BLOCKED (use list_blocked_users for the Blocked tab UX)
//
// Online status source
// --------------------
// We deliberately do NOT use `friend.user.online` from Nakama. That field
// reflects the realtime SOCKET presence (a player may be logged in but
// have zero meaningful presence — e.g. AFK background app on iOS that lost
// the socket but is still "online"). Instead we read the `player_presence`
// storage collection — the SAME source of truth that
// `intelliverse_find_friends` uses. This is what eliminates the
// "online in search, offline in friends list" inconsistency.
//
// list_blocked_users
// ------------------
// Returns the same flat shape, scoped to STATE_BLOCKED only. Always
// returns relationshipStatus="blocked" so the client UI can show an
// Unblock button without a second relationship lookup. No pagination
// (block lists are tiny — capped at 500).
// ============================================================================
var IntelliverseFriendsList;
(function (IntelliverseFriendsList) {
    // ── Shared constants (mirror of find_friends.ts) ───────────────────────
    var PRESENCE_COLLECTION = "player_presence";
    var PRESENCE_KEY = "status";
    var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min ⇒ online
    // Nakama friend states
    var STATE_FRIEND = 0;
    var STATE_INVITE_SENT = 1;
    var STATE_INVITE_RECEIVED = 2;
    var STATE_BLOCKED = 3;
    // Hard caps protect the DB from abuse
    var FRIENDS_LIST_MAX_LIMIT = 500;
    var BLOCKED_LIST_HARD_LIMIT = 500;
    // Stable machine error codes
    var ERR_UNAUTHENTICATED = "unauthenticated";
    var ERR_INVALID_PAYLOAD = "invalid_payload";
    var ERR_INTERNAL = "internal_error";
    // ── Result envelope helpers ────────────────────────────────────────────
    function ok(data) {
        return JSON.stringify({ success: true, data: data });
    }
    function err(message, errorCode) {
        return JSON.stringify({ success: false, error: message, errorCode: errorCode });
    }
    function parsePayload(payload) {
        if (!payload || payload === "")
            return { ok: true, data: {} };
        try {
            return { ok: true, data: JSON.parse(payload) };
        }
        catch (e) {
            return { ok: false, error: "Invalid JSON payload: " + (e.message || String(e)) };
        }
    }
    /**
     * Bulk-load presence rows from the `player_presence` storage collection.
     * Returns a { userId: boolean } map. Missing entries default to false.
     *
     * Identical algorithm to IntelliverseFriends.loadOnlineMap in
     * find_friends.ts — duplicated here (rather than imported) because
     * Nakama's Goja runtime does not support cross-namespace function calls
     * once postbuild has merged everything; namespace boundaries are real.
     * Keeping these in sync is enforced by code review.
     */
    function loadOnlineMap(nk, userIds) {
        var map = {};
        if (!userIds || userIds.length === 0)
            return map;
        var reads = [];
        for (var i = 0; i < userIds.length; i++) {
            reads.push({
                collection: PRESENCE_COLLECTION,
                key: PRESENCE_KEY,
                userId: userIds[i]
            });
        }
        var rows = null;
        try {
            rows = nk.storageRead(reads);
        }
        catch (e) {
            // Presence is optional context — never fail the list because of it.
            return map;
        }
        if (!rows)
            return map;
        var nowMs = Date.now();
        for (var r = 0; r < rows.length; r++) {
            var row = rows[r];
            if (!row || !row.value)
                continue;
            var v = row.value;
            var online = false;
            if (v.online === true) {
                var lastSeenMs = 0;
                if (typeof v.lastSeenMs === "number")
                    lastSeenMs = v.lastSeenMs;
                else if (typeof v.last_seen_ms === "number")
                    lastSeenMs = v.last_seen_ms;
                else if (typeof v.lastSeen === "string") {
                    var t = Date.parse(v.lastSeen);
                    if (!isNaN(t))
                        lastSeenMs = t;
                }
                if (lastSeenMs === 0 || (nowMs - lastSeenMs) <= ONLINE_THRESHOLD_MS) {
                    online = true;
                }
            }
            map[row.userId] = online;
        }
        return map;
    }
    /**
     * Map a Nakama `friend.state` int to the canonical relationshipStatus
     * string used by every Phase-4 client model.
     */
    function stateToRelationship(state) {
        if (state === STATE_FRIEND)
            return "friend";
        if (state === STATE_INVITE_SENT)
            return "pending_sent";
        if (state === STATE_INVITE_RECEIVED)
            return "pending_received";
        if (state === STATE_BLOCKED)
            return "blocked";
        return "none";
    }
    /**
     * Coerce Nakama's wrapped state value (`{value: 0}` in some runtime
     * versions, plain int in others) into a stable JS number.
     */
    function unwrapState(rawState) {
        if (typeof rawState === "number")
            return rawState;
        if (rawState && typeof rawState === "object" && "value" in rawState) {
            var v = rawState.value;
            if (typeof v === "number")
                return v;
        }
        return -1;
    }
    /**
     * Flatten a Nakama friend object into our canonical wire shape.
     * Caller supplies the resolved `online` flag (from loadOnlineMap).
     */
    function flattenFriend(fr, online) {
        var u = fr.user || {};
        var state = unwrapState(fr.state);
        return {
            userId: u.id || "",
            username: u.username || "",
            displayName: u.displayName || u.display_name || u.username || "",
            avatarUrl: u.avatarUrl || u.avatar_url || "",
            online: online,
            createTime: u.createTime || u.create_time || "",
            relationshipStatus: stateToRelationship(state),
            state: state,
            // Pass through optional Nakama metadata when present (clients can ignore)
            updateTime: u.updateTime || u.update_time || "",
            edgeUpdateTime: fr.updateTime || fr.update_time || ""
        };
    }
    // ── friends_list RPC ───────────────────────────────────────────────────
    function rpcFriendsList(ctx, logger, nk, payload) {
        var userId = ctx.userId;
        if (!userId)
            return err("Authentication required", ERR_UNAUTHENTICATED);
        var parsed = parsePayload(payload);
        if (!parsed.ok)
            return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);
        var data = parsed.data || {};
        // ── Pagination ──────────────────────────────────────────────────────
        var limit = parseInt(data.limit, 10);
        if (isNaN(limit) || limit < 1)
            limit = 100;
        if (limit > FRIENDS_LIST_MAX_LIMIT)
            limit = FRIENDS_LIST_MAX_LIMIT;
        // Nakama wants the cursor as a string (or null/undefined for "first page").
        // We accept "", null, or undefined as "first page" for client convenience.
        var cursor = undefined;
        if (typeof data.cursor === "string" && data.cursor.length > 0) {
            cursor = data.cursor;
        }
        // Optional state filter. Reject silently-out-of-range values rather than
        // erroring — clients sometimes pass legacy 4 (was used for "all" in
        // very old QV builds) which we treat as "no filter".
        var stateFilter = undefined;
        if (data.state !== undefined && data.state !== null) {
            var s = parseInt(data.state, 10);
            if (!isNaN(s) && s >= 0 && s <= 3)
                stateFilter = s;
        }
        // ── Fetch from Nakama ───────────────────────────────────────────────
        var friendsResp = null;
        try {
            friendsResp = nk.friendsList(userId, limit, stateFilter, cursor);
        }
        catch (e) {
            if (logger && logger.error) {
                logger.error("[FriendsList] nk.friendsList failed: " + (e.message || String(e)));
            }
            return err("Failed to load friends", ERR_INTERNAL);
        }
        var rawFriends = (friendsResp && friendsResp.friends) ? friendsResp.friends : [];
        var nextCursor = (friendsResp && friendsResp.cursor) || null;
        // ── Bulk-load presence ──────────────────────────────────────────────
        var ids = [];
        for (var i = 0; i < rawFriends.length; i++) {
            var u = rawFriends[i] && rawFriends[i].user;
            if (u && u.id)
                ids.push(u.id);
        }
        var onlineMap = loadOnlineMap(nk, ids);
        // ── Flatten ─────────────────────────────────────────────────────────
        var results = [];
        for (var j = 0; j < rawFriends.length; j++) {
            var fr = rawFriends[j];
            if (!fr || !fr.user || !fr.user.id)
                continue;
            var online = !!onlineMap[fr.user.id];
            results.push(flattenFriend(fr, online));
        }
        if (logger && logger.info) {
            logger.info("[FriendsList] user=" + userId +
                " state=" + (stateFilter === undefined ? "any" : String(stateFilter)) +
                " returned=" + results.length +
                " nextCursor=" + (nextCursor || "null"));
        }
        return ok({
            results: results,
            count: results.length,
            nextCursor: nextCursor
        });
    }
    // ── list_blocked_users RPC (Phase-4 H1) ────────────────────────────────
    function rpcListBlockedUsers(ctx, logger, nk, payload) {
        var userId = ctx.userId;
        if (!userId)
            return err("Authentication required", ERR_UNAUTHENTICATED);
        // No required payload fields, but still parse defensively
        var parsed = parsePayload(payload);
        if (!parsed.ok)
            return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);
        var rawList = [];
        try {
            // Block lists are tiny in practice (<100 users for >99.9% of accounts);
            // we hard-cap at 500 to prevent abuse + memory blow-ups.
            var resp = nk.friendsList(userId, BLOCKED_LIST_HARD_LIMIT, STATE_BLOCKED, undefined);
            if (resp && resp.friends)
                rawList = resp.friends;
        }
        catch (e) {
            if (logger && logger.error) {
                logger.error("[ListBlockedUsers] nk.friendsList failed: " + (e.message || String(e)));
            }
            return err("Failed to load blocked users", ERR_INTERNAL);
        }
        // Presence is conceptually meaningless for a "blocked" relationship,
        // but we still return it so the row prefab is identical to friends_list.
        // Cheap (one batched read) so worth the consistency.
        var ids = [];
        for (var i = 0; i < rawList.length; i++) {
            var u = rawList[i] && rawList[i].user;
            if (u && u.id)
                ids.push(u.id);
        }
        var onlineMap = loadOnlineMap(nk, ids);
        var results = [];
        for (var j = 0; j < rawList.length; j++) {
            var fr = rawList[j];
            if (!fr || !fr.user || !fr.user.id)
                continue;
            // Force relationshipStatus to "blocked" — defensive normalisation in
            // case Nakama ever returns mixed-state results when filtering.
            var flat = flattenFriend(fr, !!onlineMap[fr.user.id]);
            flat.relationshipStatus = "blocked";
            flat.state = STATE_BLOCKED;
            results.push(flat);
        }
        if (logger && logger.info) {
            logger.info("[ListBlockedUsers] user=" + userId + " returned=" + results.length);
        }
        return ok({
            results: results,
            count: results.length
        });
    }
    // ── Public registration ────────────────────────────────────────────────
    function register(initializer) {
        initializer.registerRpc("friends_list", rpcFriendsList);
        initializer.registerRpc("list_blocked_users", rpcListBlockedUsers);
    }
    IntelliverseFriendsList.register = register;
})(IntelliverseFriendsList || (IntelliverseFriendsList = {}));
var HiroAchievements;
(function (HiroAchievements) {
    var DEFAULT_CONFIG = { achievements: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "achievements", DEFAULT_CONFIG);
    }
    HiroAchievements.getConfig = getConfig;
    function getUserAchievements(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
        return data || { achievements: {} };
    }
    function saveUserAchievements(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
    }
    function addProgress(nk, logger, ctx, userId, achievementId, amount, gameId) {
        var config = getConfig(nk);
        var def = config.achievements[achievementId];
        if (!def)
            return null;
        if (def.preconditionIds) {
            var ua = getUserAchievements(nk, userId, gameId);
            for (var i = 0; i < def.preconditionIds.length; i++) {
                var pre = ua.achievements[def.preconditionIds[i]];
                if (!pre || !pre.completedAt)
                    return null;
            }
        }
        var userAchievements = getUserAchievements(nk, userId, gameId);
        var progress = userAchievements.achievements[achievementId];
        var now = Math.floor(Date.now() / 1000);
        if (!progress) {
            progress = { id: achievementId, count: 0 };
        }
        if (progress.completedAt && !def.resetSchedule) {
            return progress;
        }
        if (def.resetSchedule && progress.resetAt) {
            // If reset time has passed, reset progress
            if (now >= progress.resetAt) {
                progress.count = 0;
                progress.completedAt = undefined;
                progress.claimedAt = undefined;
            }
        }
        progress.count = Math.min(progress.count + amount, def.maxCount || def.count);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_PROGRESS, {
            userId: userId, achievementId: achievementId, count: progress.count, target: def.count
        });
        if (progress.count >= def.count && !progress.completedAt) {
            progress.completedAt = now;
            EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_COMPLETED, {
                userId: userId, achievementId: achievementId
            });
            if (def.autoClaimReward && def.reward) {
                var resolved = RewardEngine.resolveReward(nk, def.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
                progress.claimedAt = now;
                EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
                    userId: userId, achievementId: achievementId, reward: resolved
                });
            }
            if (def.resetSchedule) {
                progress.resetAt = computeNextReset(now, def.resetSchedule);
            }
        }
        // Sub-achievements
        if (def.subAchievements) {
            if (!progress.subAchievements)
                progress.subAchievements = {};
            for (var sid in def.subAchievements) {
                var subDef = def.subAchievements[sid];
                var subProgress = progress.subAchievements[sid];
                if (!subProgress)
                    subProgress = { count: 0 };
                if (!subProgress.completedAt) {
                    subProgress.count = Math.min(subProgress.count + amount, subDef.count);
                    if (subProgress.count >= subDef.count) {
                        subProgress.completedAt = now;
                        if (subDef.reward) {
                            var subResolved = RewardEngine.resolveReward(nk, subDef.reward);
                            RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", subResolved);
                        }
                    }
                }
                progress.subAchievements[sid] = subProgress;
            }
        }
        userAchievements.achievements[achievementId] = progress;
        saveUserAchievements(nk, userId, userAchievements, gameId);
        return progress;
    }
    HiroAchievements.addProgress = addProgress;
    function computeNextReset(now, schedule) {
        // Simplified: "daily" = 24h, "weekly" = 7d, "monthly" = 30d
        switch (schedule) {
            case "daily": return now + 86400;
            case "weekly": return now + 604800;
            case "monthly": return now + 2592000;
            default: return now + 86400;
        }
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var config = getConfig(nk);
        var userAchievements = getUserAchievements(nk, userId, gameId);
        var result = [];
        for (var id in config.achievements) {
            var def = config.achievements[id];
            var progress = userAchievements.achievements[id] || { id: id, count: 0 };
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                category: def.category,
                targetCount: def.count,
                currentCount: progress.count,
                completedAt: progress.completedAt,
                claimedAt: progress.claimedAt,
                autoClaimReward: def.autoClaimReward,
                hasReward: !!def.reward,
                subAchievements: def.subAchievements ? Object.keys(def.subAchievements).map(function (sid) {
                    var subDef = def.subAchievements[sid];
                    var subProgress = (progress.subAchievements && progress.subAchievements[sid]) || { count: 0 };
                    return { id: sid, name: subDef.name, targetCount: subDef.count, currentCount: subProgress.count, completedAt: subProgress.completedAt };
                }) : []
            });
        }
        return RpcHelpers.successResponse({ achievements: result });
    }
    function rpcProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.achievementId)
            return RpcHelpers.errorResponse("achievementId required");
        var progress = addProgress(nk, logger, ctx, userId, data.achievementId, data.amount || 1, data.gameId);
        if (!progress)
            return RpcHelpers.errorResponse("Achievement not found or preconditions not met");
        return RpcHelpers.successResponse({ progress: progress });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.achievementId)
            return RpcHelpers.errorResponse("achievementId required");
        var config = getConfig(nk);
        var def = config.achievements[data.achievementId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown achievement");
        var ua = getUserAchievements(nk, userId, data.gameId);
        var progress = ua.achievements[data.achievementId];
        if (!progress || !progress.completedAt)
            return RpcHelpers.errorResponse("Achievement not completed");
        if (progress.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        progress.claimedAt = Math.floor(Date.now() / 1000);
        var resolved = null;
        if (def.reward) {
            resolved = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        }
        ua.achievements[data.achievementId] = progress;
        saveUserAchievements(nk, userId, ua, data.gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ACHIEVEMENT_CLAIMED, {
            userId: userId, achievementId: data.achievementId, reward: resolved
        });
        return RpcHelpers.successResponse({ progress: progress, reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_achievements_list", rpcList);
        initializer.registerRpc("hiro_achievements_progress", rpcProgress);
        initializer.registerRpc("hiro_achievements_claim", rpcClaim);
    }
    HiroAchievements.register = register;
    function registerEventHandlers() {
        // Auto-track achievements from other system events
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.achievements) {
                var def = config.achievements[id];
                if (def.category === "games_played") {
                    addProgress(nk, logger, ctx, data.userId, id, 1, data.gameId);
                }
            }
        });
        EventBus.on(EventBus.Events.SCORE_SUBMITTED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.achievements) {
                var def = config.achievements[id];
                if (def.category === "score_threshold" && data.score >= def.count) {
                    addProgress(nk, logger, ctx, data.userId, id, def.count, data.gameId);
                }
            }
        });
    }
    HiroAchievements.registerEventHandlers = registerEventHandlers;
})(HiroAchievements || (HiroAchievements = {}));
var HiroAuctions;
(function (HiroAuctions) {
    var DEFAULT_CONFIG = { categories: [], listingFeePct: 5, durationSec: 86400, maxActiveListings: 5 };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "auctions", DEFAULT_CONFIG);
    }
    HiroAuctions.getConfig = getConfig;
    function getListing(nk, listingId) {
        return Storage.readSystemJson(nk, Constants.HIRO_AUCTIONS_COLLECTION, listingId);
    }
    function saveListing(nk, listing) {
        Storage.writeSystemJson(nk, Constants.HIRO_AUCTIONS_COLLECTION, listing.id, listing);
    }
    function rpcList(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var result = Storage.listUserRecords(nk, Constants.HIRO_AUCTIONS_COLLECTION, Constants.SYSTEM_USER_ID, data.limit || 20, data.cursor);
        var now = Math.floor(Date.now() / 1000);
        var listings = result.records.filter(function (r) {
            var l = r.value;
            return !l.resolved && l.endsAt > now && (!data.category || l.category === data.category);
        }).map(function (r) { return r.value; });
        return RpcHelpers.successResponse({ listings: listings, cursor: result.cursor });
    }
    function rpcCreate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.startingBid || !data.currencyId) {
            return RpcHelpers.errorResponse("itemId, startingBid, and currencyId required");
        }
        var config = getConfig(nk);
        var count = data.itemCount || 1;
        if (!HiroInventory.consumeItem(nk, logger, ctx, userId, data.itemId, count, data.gameId)) {
            return RpcHelpers.errorResponse("Insufficient items");
        }
        var now = Math.floor(Date.now() / 1000);
        var listing = {
            id: nk.uuidv4(),
            sellerId: userId,
            itemId: data.itemId,
            itemCount: count,
            startingBid: data.startingBid,
            currentBid: data.startingBid,
            currencyId: data.currencyId,
            category: data.category || "general",
            createdAt: now,
            endsAt: now + config.durationSec,
            resolved: false
        };
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function rpcBid(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.listingId || !data.amount)
            return RpcHelpers.errorResponse("listingId and amount required");
        var listing = getListing(nk, data.listingId);
        if (!listing || listing.resolved)
            return RpcHelpers.errorResponse("Listing not found or resolved");
        var now = Math.floor(Date.now() / 1000);
        if (now > listing.endsAt)
            return RpcHelpers.errorResponse("Auction ended");
        if (data.amount <= listing.currentBid)
            return RpcHelpers.errorResponse("Bid must exceed current bid of " + listing.currentBid);
        if (listing.highestBidderId) {
            WalletHelpers.addCurrency(nk, logger, ctx, listing.highestBidderId, data.gameId || "default", listing.currencyId, listing.currentBid);
        }
        WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", listing.currencyId, data.amount);
        listing.currentBid = data.amount;
        listing.highestBidderId = userId;
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function rpcResolve(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.listingId)
            return RpcHelpers.errorResponse("listingId required");
        var listing = getListing(nk, data.listingId);
        if (!listing || listing.resolved)
            return RpcHelpers.errorResponse("Listing not found or already resolved");
        var config = getConfig(nk);
        listing.resolved = true;
        if (listing.highestBidderId) {
            HiroInventory.grantItem(nk, logger, ctx, listing.highestBidderId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
            var fee = Math.floor(listing.currentBid * config.listingFeePct / 100);
            var sellerProceeds = listing.currentBid - fee;
            WalletHelpers.addCurrency(nk, logger, ctx, listing.sellerId, data.gameId || "default", listing.currencyId, sellerProceeds);
        }
        else {
            HiroInventory.grantItem(nk, logger, ctx, listing.sellerId, listing.itemId, listing.itemCount, undefined, undefined, data.gameId);
        }
        saveListing(nk, listing);
        return RpcHelpers.successResponse({ listing: listing });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_auctions_list", rpcList);
        initializer.registerRpc("hiro_auctions_create", rpcCreate);
        initializer.registerRpc("hiro_auctions_bid", rpcBid);
        initializer.registerRpc("hiro_auctions_resolve", rpcResolve);
    }
    HiroAuctions.register = register;
})(HiroAuctions || (HiroAuctions = {}));
var AdminConsole;
(function (AdminConsole) {
    // ---- Hiro Config CRUD ----
    function rpcConfigGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");
        var config = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
        return RpcHelpers.successResponse({ system: data.system, config: config || {} });
    }
    function rpcConfigSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system || !data.config)
            return RpcHelpers.errorResponse("system and config required");
        ConfigLoader.saveConfig(nk, data.system, data.config);
        return RpcHelpers.successResponse({ system: data.system, saved: true });
    }
    function rpcConfigDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required");
        Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system, Constants.SYSTEM_USER_ID);
        ConfigLoader.invalidateCache(data.system);
        return RpcHelpers.successResponse({ system: data.system, deleted: true });
    }
    // ---- Satori Config CRUD ----
    function rpcSatoriConfigGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system)
            return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");
        var config = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
        return RpcHelpers.successResponse({ system: data.system, config: config || {} });
    }
    function rpcSatoriConfigSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.system || !data.config)
            return RpcHelpers.errorResponse("system and config required");
        ConfigLoader.saveSatoriConfig(nk, data.system, data.config);
        return RpcHelpers.successResponse({ system: data.system, saved: true });
    }
    // ---- Bulk Import/Export ----
    function rpcBulkExport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var hiroSystems = ["economy", "inventory", "achievements", "progression", "energy", "stats", "streaks", "store", "challenges", "tutorials", "unlockables", "auctions", "incentives"];
        var satoriSystems = ["audiences", "flags", "experiments", "live_events", "messages", "metrics", "webhooks", "taxonomy", "data_lake"];
        var exported = { hiro: {}, satori: {} };
        for (var i = 0; i < hiroSystems.length; i++) {
            var config = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, hiroSystems[i]);
            if (config)
                exported.hiro[hiroSystems[i]] = config;
        }
        for (var j = 0; j < satoriSystems.length; j++) {
            var sConfig = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, satoriSystems[j]);
            if (sConfig)
                exported.satori[satoriSystems[j]] = sConfig;
        }
        return RpcHelpers.successResponse(exported);
    }
    function rpcBulkImport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var imported = { hiro: 0, satori: 0 };
        if (data.hiro) {
            for (var key in data.hiro) {
                ConfigLoader.saveConfig(nk, key, data.hiro[key]);
                imported.hiro++;
            }
        }
        if (data.satori) {
            for (var sKey in data.satori) {
                ConfigLoader.saveSatoriConfig(nk, sKey, data.satori[sKey]);
                imported.satori++;
            }
        }
        return RpcHelpers.successResponse({ imported: imported });
    }
    // ---- Cache Management ----
    function rpcCacheInvalidate(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        ConfigLoader.invalidateCache(data.system);
        return RpcHelpers.successResponse({ invalidated: data.system || "all" });
    }
    // ---- User Data Management ----
    function rpcUserDataGet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection)
            return RpcHelpers.errorResponse("userId and collection required");
        var key = data.key || "state";
        var result = Storage.readJson(nk, data.collection, key, data.userId);
        return RpcHelpers.successResponse({ collection: data.collection, key: key, data: result });
    }
    function rpcUserDataSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection || !data.data)
            return RpcHelpers.errorResponse("userId, collection, and data required");
        var key = data.key || "state";
        Storage.writeJson(nk, data.collection, key, data.userId, data.data);
        return RpcHelpers.successResponse({ saved: true });
    }
    function rpcUserDataDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.collection)
            return RpcHelpers.errorResponse("userId and collection required");
        var key = data.key || "state";
        Storage.deleteRecord(nk, data.collection, key, data.userId);
        return RpcHelpers.successResponse({ deleted: true });
    }
    // ---- Player Full Profile Inspector ----
    function rpcPlayerInspect(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var profile = {};
        try {
            var accounts = nk.accountsGetId([data.userId]);
            if (accounts && accounts.length > 0) {
                var acct = accounts[0];
                profile.account = {
                    userId: acct.user.userId,
                    username: acct.user.username,
                    displayName: acct.user.displayName,
                    avatarUrl: acct.user.avatarUrl,
                    langTag: acct.user.langTag,
                    location: acct.user.location,
                    timezone: acct.user.timezone,
                    createTime: acct.user.createTime,
                    updateTime: acct.user.updateTime,
                    online: acct.user.online,
                    edgeCount: acct.user.edgeCount
                };
            }
        }
        catch (e) {
            profile.account = { error: e.message || String(e) };
        }
        var collections = [
            { name: "wallet", collection: Constants.WALLETS_COLLECTION, key: "wallet" },
            { name: "inventory", collection: Constants.HIRO_INVENTORY_COLLECTION, key: "items" },
            { name: "achievements", collection: Constants.HIRO_ACHIEVEMENTS_COLLECTION, key: "progress" },
            { name: "progression", collection: Constants.HIRO_PROGRESSION_COLLECTION, key: "state" },
            { name: "energy", collection: Constants.HIRO_ENERGY_COLLECTION, key: "state" },
            { name: "stats", collection: Constants.HIRO_STATS_COLLECTION, key: "values" },
            { name: "streaks", collection: Constants.HIRO_STREAKS_COLLECTION, key: "state" },
            { name: "tutorials", collection: Constants.HIRO_TUTORIALS_COLLECTION, key: "progress" },
            { name: "unlockables", collection: Constants.HIRO_UNLOCKABLES_COLLECTION, key: "state" },
            { name: "satoriIdentity", collection: Constants.SATORI_IDENTITY_COLLECTION, key: "props" },
            { name: "satoriAssignments", collection: Constants.SATORI_ASSIGNMENTS_COLLECTION, key: "assignments" },
            { name: "mailbox", collection: Constants.HIRO_MAILBOX_COLLECTION, key: "inbox" }
        ];
        var reads = [];
        for (var i = 0; i < collections.length; i++) {
            reads.push({ collection: collections[i].collection, key: collections[i].key, userId: data.userId });
        }
        try {
            var records = nk.storageRead(reads);
            for (var j = 0; j < collections.length; j++) {
                var found = false;
                for (var k = 0; k < records.length; k++) {
                    if (records[k].collection === collections[j].collection) {
                        profile[collections[j].name] = records[k].value;
                        found = true;
                        break;
                    }
                }
                if (!found)
                    profile[collections[j].name] = null;
            }
        }
        catch (e) {
            profile.storageError = e.message || String(e);
        }
        return RpcHelpers.successResponse(profile);
    }
    // ---- Wallet Direct Operations ----
    function rpcWalletView(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId);
        return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet || {} });
    }
    function rpcWalletGrant(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.currencies)
            return RpcHelpers.errorResponse("userId and currencies required (e.g. { userId: '...', currencies: { coins: 100, gems: 5 } })");
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId) || {};
        for (var currency in data.currencies) {
            wallet[currency] = (wallet[currency] || 0) + data.currencies[currency];
        }
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, wallet);
        EventBus.emit(nk, logger, ctx, "wallet_updated", { userId: data.userId, wallet: wallet, granted: data.currencies });
        return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet });
    }
    function rpcWalletReset(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var defaults = data.defaults || {};
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
        return RpcHelpers.successResponse({ userId: data.userId, wallet: defaults, reset: true });
    }
    // ---- Storage Collections Browser ----
    function rpcStorageList(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.collection)
            return RpcHelpers.errorResponse("collection required");
        var userId = data.userId || Constants.SYSTEM_USER_ID;
        var limit = data.limit || 50;
        var result = Storage.listUserRecords(nk, data.collection, userId, limit, data.cursor);
        var items = [];
        for (var i = 0; i < result.records.length; i++) {
            var r = result.records[i];
            items.push({
                key: r.key,
                userId: r.userId,
                version: r.version,
                updateTime: r.updateTime,
                valueSummary: JSON.stringify(r.value).substring(0, 200)
            });
        }
        return RpcHelpers.successResponse({
            collection: data.collection,
            count: items.length,
            cursor: result.cursor,
            items: items
        });
    }
    // ---- Feature Flag Quick Toggle ----
    function rpcFlagToggle(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required (flag name to toggle)");
        var flagsConfig = ConfigLoader.loadSatoriConfig(nk, "flags", { flags: {} });
        if (!flagsConfig.flags)
            flagsConfig.flags = {};
        var existing = flagsConfig.flags[data.name];
        var now = Math.floor(Date.now() / 1000);
        if (existing) {
            existing.enabled = data.enabled !== undefined ? data.enabled : !existing.enabled;
            if (data.value !== undefined)
                existing.value = String(data.value);
            if (data.conditionsByAudience)
                existing.conditionsByAudience = data.conditionsByAudience;
            existing.updatedAt = now;
        }
        else if (data.value !== undefined) {
            flagsConfig.flags[data.name] = {
                name: data.name,
                value: String(data.value),
                description: data.description || "",
                conditionsByAudience: data.conditionsByAudience,
                enabled: data.enabled !== undefined ? data.enabled : true,
                createdAt: now,
                updatedAt: now
            };
        }
        else {
            return RpcHelpers.errorResponse("Flag '" + data.name + "' not found. Provide value to create.");
        }
        ConfigLoader.saveSatoriConfig(nk, "flags", flagsConfig);
        return RpcHelpers.successResponse({ flag: flagsConfig.flags[data.name], action: existing ? "toggled" : "created" });
    }
    // ---- Live Event Quick Schedule ----
    function rpcLiveEventSchedule(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name)
            return RpcHelpers.errorResponse("id and name required");
        var eventsConfig = ConfigLoader.loadSatoriConfig(nk, "live_events", {});
        var now = Math.floor(Date.now() / 1000);
        var newEvent = {
            id: data.id,
            name: data.name,
            description: data.description || "",
            startAt: data.startTimeSec || data.startAt || now,
            endAt: data.endTimeSec || data.endAt || now + 86400,
            audienceId: (data.audiences && data.audiences[0]) || data.audienceId || undefined,
            reward: data.reward || undefined,
            config: data.config || {},
            recurrenceCron: data.recurrenceCron,
            recurrenceIntervalSec: data.recurrenceIntervalSec,
            sticky: data.sticky || false,
            requiresJoin: data.requiresJoin || false,
            category: data.category || "",
            flagOverrides: data.flagOverrides,
            onJoinMessageId: data.onJoinMessageId,
            createdAt: (eventsConfig[data.id] && eventsConfig[data.id].createdAt) || now,
            updatedAt: now
        };
        var action = eventsConfig[data.id] ? "updated" : "created";
        eventsConfig[data.id] = newEvent;
        ConfigLoader.saveSatoriConfig(nk, "live_events", eventsConfig);
        return RpcHelpers.successResponse({ event: newEvent, action: action });
    }
    // ---- Experiment Quick Setup ----
    function rpcExperimentSetup(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name || !data.variants)
            return RpcHelpers.errorResponse("id, name, and variants[] required");
        var expConfig = ConfigLoader.loadSatoriConfig(nk, "experiments", {});
        var now = Math.floor(Date.now() / 1000);
        var newExp = {
            id: data.id,
            name: data.name,
            description: data.description || "",
            status: data.status || (data.enabled === false ? "draft" : "running"),
            audienceId: (data.audiences && data.audiences[0]) || data.audienceId || undefined,
            variants: data.variants,
            goalMetric: data.goalMetric,
            splitKey: data.splitKey,
            lockParticipation: data.lockParticipation || false,
            admissionDeadline: data.admissionDeadline,
            startAt: data.startAt,
            endAt: data.endAt,
            phases: data.phases,
            experimentType: data.experimentType || "custom",
            createdAt: (expConfig[data.id] && expConfig[data.id].createdAt) || now,
            updatedAt: now
        };
        var action = expConfig[data.id] ? "updated" : "created";
        expConfig[data.id] = newExp;
        ConfigLoader.saveSatoriConfig(nk, "experiments", expConfig);
        return RpcHelpers.successResponse({ experiment: newExp, action: action });
    }
    // ---- User Search ----
    function rpcUserSearch(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.username)
            return RpcHelpers.errorResponse("username required");
        try {
            var users = nk.usersGetUsername([data.username]);
            if (!users || users.length === 0)
                return RpcHelpers.successResponse({ found: false });
            var results = [];
            for (var i = 0; i < users.length; i++) {
                results.push({
                    userId: users[i].userId,
                    username: users[i].username,
                    displayName: users[i].displayName,
                    online: users[i].online,
                    createTime: users[i].createTime,
                    updateTime: users[i].updateTime
                });
            }
            return RpcHelpers.successResponse({ found: true, users: results });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Search failed: " + (e.message || String(e)));
        }
    }
    // ---- Player Inventory Grant (admin shortcut) ----
    function rpcInventoryGrant(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.itemId)
            return RpcHelpers.errorResponse("userId and itemId required. Optional: quantity (default 1)");
        var inv = Storage.readJson(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId) || { items: {} };
        var items = inv.items || {};
        var qty = data.quantity || 1;
        if (items[data.itemId]) {
            items[data.itemId].count = (items[data.itemId].count || 0) + qty;
        }
        else {
            items[data.itemId] = { id: data.itemId, count: qty, properties: data.properties || {} };
        }
        inv.items = items;
        Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId, inv);
        return RpcHelpers.successResponse({ userId: data.userId, item: items[data.itemId] });
    }
    // ---- Send Admin Mailbox Message ----
    function rpcMailboxSend(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.subject)
            return RpcHelpers.errorResponse("userId and subject required. Optional: body, rewards, expiresInSec");
        var inbox = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId) || { messages: [] };
        var messages = inbox.messages || [];
        var now = Math.floor(Date.now() / 1000);
        var msg = {
            id: nk.uuidv4(),
            subject: data.subject,
            body: data.body || "",
            rewards: data.rewards || [],
            createdAt: now,
            expiresAt: data.expiresInSec ? now + data.expiresInSec : 0,
            read: false,
            claimed: false,
            sender: "admin"
        };
        messages.push(msg);
        inbox.messages = messages;
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId, inbox);
        return RpcHelpers.successResponse({ sent: true, messageId: msg.id, to: data.userId });
    }
    // ---- Satori Events Timeline (recent events for a user) ----
    function rpcEventsTimeline(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var events = Storage.readJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", data.userId) || { events: [] };
        var list = events.events || [];
        var limit = data.limit || 50;
        var recent = list.slice(Math.max(0, list.length - limit));
        return RpcHelpers.successResponse({
            userId: data.userId,
            count: recent.length,
            totalEvents: list.length,
            events: recent
        });
    }
    // ---- System Health ----
    function rpcHealthCheck(ctx, logger, nk, payload) {
        return RpcHelpers.successResponse({
            status: "healthy",
            version: "2.0.0",
            systems: {
                hiro: ["economy", "inventory", "achievements", "progression", "energy", "stats",
                    "event_leaderboards", "streaks", "store", "challenges", "teams",
                    "tutorials", "unlockables", "auctions", "incentives", "mailbox"],
                satori: ["event_capture", "identities", "audiences", "feature_flags",
                    "experiments", "live_events", "messages", "metrics",
                    "webhooks", "taxonomy", "data_lake"]
            },
            collections: {
                hiro: [Constants.HIRO_CONFIGS_COLLECTION, Constants.HIRO_ACHIEVEMENTS_COLLECTION, Constants.HIRO_INVENTORY_COLLECTION,
                    Constants.HIRO_PROGRESSION_COLLECTION, Constants.HIRO_ENERGY_COLLECTION, Constants.HIRO_STATS_COLLECTION,
                    Constants.HIRO_STREAKS_COLLECTION, Constants.HIRO_TUTORIALS_COLLECTION, Constants.HIRO_UNLOCKABLES_COLLECTION,
                    Constants.HIRO_MAILBOX_COLLECTION, Constants.HIRO_CHALLENGES_COLLECTION, Constants.HIRO_AUCTIONS_COLLECTION],
                satori: [Constants.SATORI_CONFIGS_COLLECTION, Constants.SATORI_EVENTS_COLLECTION, Constants.SATORI_IDENTITY_COLLECTION,
                    Constants.SATORI_ASSIGNMENTS_COLLECTION, Constants.SATORI_MESSAGES_COLLECTION, Constants.SATORI_METRICS_COLLECTION],
                legacy: [Constants.WALLETS_COLLECTION, Constants.DAILY_REWARDS_COLLECTION, Constants.MISSIONS_COLLECTION,
                    Constants.QUIZ_RESULTS_COLLECTION, Constants.GAME_REGISTRY_COLLECTION, Constants.ANALYTICS_COLLECTION]
            },
            timestamp: new Date().toISOString()
        });
    }
    function register(initializer) {
        // Hiro config CRUD
        initializer.registerRpc("admin_config_get", rpcConfigGet);
        initializer.registerRpc("admin_config_set", rpcConfigSet);
        initializer.registerRpc("admin_config_delete", rpcConfigDelete);
        // Satori config CRUD
        initializer.registerRpc("admin_satori_config_get", rpcSatoriConfigGet);
        initializer.registerRpc("admin_satori_config_set", rpcSatoriConfigSet);
        // Bulk operations
        initializer.registerRpc("admin_bulk_export", rpcBulkExport);
        initializer.registerRpc("admin_bulk_import", rpcBulkImport);
        // Cache
        initializer.registerRpc("admin_cache_invalidate", rpcCacheInvalidate);
        // User data (generic)
        initializer.registerRpc("admin_user_data_get", rpcUserDataGet);
        initializer.registerRpc("admin_user_data_set", rpcUserDataSet);
        initializer.registerRpc("admin_user_data_delete", rpcUserDataDelete);
        // Player tools
        initializer.registerRpc("admin_player_inspect", rpcPlayerInspect);
        initializer.registerRpc("admin_user_search", rpcUserSearch);
        initializer.registerRpc("admin_wallet_view", rpcWalletView);
        initializer.registerRpc("admin_wallet_grant", rpcWalletGrant);
        initializer.registerRpc("admin_wallet_reset", rpcWalletReset);
        initializer.registerRpc("admin_inventory_grant", rpcInventoryGrant);
        initializer.registerRpc("admin_mailbox_send", rpcMailboxSend);
        // Satori quick-ops
        initializer.registerRpc("admin_flag_toggle", rpcFlagToggle);
        initializer.registerRpc("admin_live_event_schedule", rpcLiveEventSchedule);
        initializer.registerRpc("admin_experiment_setup", rpcExperimentSetup);
        initializer.registerRpc("admin_events_timeline", rpcEventsTimeline);
        // Storage browser
        initializer.registerRpc("admin_storage_list", rpcStorageList);
        // Gift claims
        initializer.registerRpc("gift_claims_list", rpcGiftClaimsList);
        initializer.registerRpc("admin_gift_claim_update", rpcGiftClaimUpdate);
        // Health
        initializer.registerRpc("admin_health_check", rpcHealthCheck);
    }
    AdminConsole.register = register;
    function rpcGiftClaimsList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var claims = RewardEngine.getGiftClaims(nk, userId);
        return RpcHelpers.successResponse({ claims: claims });
    }
    function rpcGiftClaimUpdate(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.claimId || !data.status) {
            return RpcHelpers.errorResponse("userId, claimId, and status required");
        }
        var updated = RewardEngine.updateGiftClaimStatus(nk, data.userId, data.claimId, data.status);
        if (!updated)
            return RpcHelpers.errorResponse("Claim not found");
        return RpcHelpers.successResponse({ updated: true });
    }
})(AdminConsole || (AdminConsole = {}));
var HiroBase;
(function (HiroBase) {
    // ---- IAP Validation ----
    var IAP_COLLECTION = "hiro_iap_purchases";
    var allowFakeReceipts = true;
    function validateReceipt(nk, logger, userId, request) {
        switch (request.storeType) {
            case "apple":
                return validateApple(nk, logger, userId, request);
            case "google":
                return validateGoogle(nk, logger, userId, request);
            case "facebook":
                return validateFacebook(nk, logger, userId, request);
            case "fake":
                if (!allowFakeReceipts) {
                    return { valid: false, productId: request.productId, storeType: request.storeType, error: "Fake receipts disabled" };
                }
                return { valid: true, productId: request.productId, storeType: request.storeType, transactionId: "fake_" + nk.uuidv4() };
            default:
                return { valid: false, productId: request.productId, storeType: request.storeType, error: "Unknown store type" };
        }
    }
    HiroBase.validateReceipt = validateReceipt;
    function validateApple(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateApple(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "apple", request.price);
                return { valid: true, productId: request.productId, storeType: "apple", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "apple", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Apple IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "apple", error: e.message || String(e) };
        }
    }
    function validateGoogle(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateGoogle(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "google", request.price);
                return { valid: true, productId: request.productId, storeType: "google", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "google", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Google IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "google", error: e.message || String(e) };
        }
    }
    function validateFacebook(nk, logger, userId, request) {
        try {
            var validation = nk.purchaseValidateFacebookInstant(userId, request.receipt);
            if (validation && validation.validatedPurchases && validation.validatedPurchases.length > 0) {
                var purchase = validation.validatedPurchases[0];
                recordPurchase(nk, userId, purchase.transactionId || nk.uuidv4(), request.productId, "facebook", request.price);
                return { valid: true, productId: request.productId, storeType: "facebook", transactionId: purchase.transactionId };
            }
            return { valid: false, productId: request.productId, storeType: "facebook", error: "Validation failed" };
        }
        catch (e) {
            logger.warn("Facebook IAP validation error: %s", e.message || String(e));
            return { valid: false, productId: request.productId, storeType: "facebook", error: e.message || String(e) };
        }
    }
    function recordPurchase(nk, userId, transactionId, productId, storeType, price) {
        var history = Storage.readJson(nk, IAP_COLLECTION, "history", userId);
        if (!history)
            history = { purchases: [] };
        history.purchases.push({
            transactionId: transactionId,
            productId: productId,
            storeType: storeType,
            validatedAt: Math.floor(Date.now() / 1000),
            price: price
        });
        Storage.writeJson(nk, IAP_COLLECTION, "history", userId, history);
    }
    // ---- Default Username Generation ----
    function generateDefaultUsername(nk) {
        var counter = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter");
        var count = (counter && counter.count) || 0;
        count++;
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "username_counter", { count: count });
        var padded = String(count);
        while (padded.length < 8)
            padded = "0" + padded;
        return "Player" + padded;
    }
    HiroBase.generateDefaultUsername = generateDefaultUsername;
    // ---- Store IAP Purchase ----
    function rpcIAPPurchase(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.receipt || !data.storeType || !data.productId) {
            return RpcHelpers.errorResponse("receipt, storeType, and productId required");
        }
        var result = validateReceipt(nk, logger, userId, {
            receipt: data.receipt,
            storeType: data.storeType,
            productId: data.productId,
            price: data.price,
            currency: data.currency
        });
        if (!result.valid) {
            return RpcHelpers.errorResponse("IAP validation failed: " + (result.error || "unknown"));
        }
        var storeConfig = HiroStore.getConfig(nk);
        var offer = null;
        for (var sectionId in storeConfig.sections) {
            for (var offerId in storeConfig.sections[sectionId].items) {
                var item = storeConfig.sections[sectionId].items[offerId];
                if (item.cost && item.cost.iapProductId === data.productId) {
                    offer = item;
                    break;
                }
            }
            if (offer)
                break;
        }
        if (!offer) {
            return RpcHelpers.errorResponse("No store item found for product ID: " + data.productId);
        }
        var resolved = RewardEngine.resolveReward(nk, offer.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
            userId: userId, offerId: data.productId, reward: resolved, iap: true, price: data.price
        });
        return RpcHelpers.successResponse({ valid: true, reward: resolved, transactionId: result.transactionId });
    }
    function rpcGetPurchaseHistory(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var history = Storage.readJson(nk, IAP_COLLECTION, "history", userId);
        return RpcHelpers.successResponse({ purchases: (history && history.purchases) || [] });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_iap_validate", rpcIAPPurchase);
        initializer.registerRpc("hiro_iap_history", rpcGetPurchaseHistory);
    }
    HiroBase.register = register;
})(HiroBase || (HiroBase = {}));
var HiroChallenges;
(function (HiroChallenges) {
    var DEFAULT_CONFIG = { challenges: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "challenges", DEFAULT_CONFIG);
    }
    HiroChallenges.getConfig = getConfig;
    function getChallengeInstance(nk, instanceId) {
        return Storage.readSystemJson(nk, Constants.HIRO_CHALLENGES_COLLECTION, instanceId);
    }
    function saveChallengeInstance(nk, instance) {
        Storage.writeSystemJson(nk, Constants.HIRO_CHALLENGES_COLLECTION, instance.id, instance);
    }
    function rpcCreate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.challengeId)
            return RpcHelpers.errorResponse("challengeId required");
        var config = getConfig(nk);
        var def = config.challenges[data.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown challenge");
        if (def.entryCost && def.entryCost.currencies) {
            for (var cid in def.entryCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.entryCost.currencies[cid]);
            }
        }
        var now = Math.floor(Date.now() / 1000);
        var instanceId = nk.uuidv4();
        var lbId = "challenge_" + instanceId;
        var sortOrder = def.sortOrder === "asc" ? "ascending" /* nkruntime.SortOrder.ASCENDING */ : "descending" /* nkruntime.SortOrder.DESCENDING */;
        var operatorMap = { best: "best" /* nkruntime.Operator.BEST */, set: "set" /* nkruntime.Operator.SET */, incr: "increment" /* nkruntime.Operator.INCREMENTAL */ };
        nk.leaderboardCreate(lbId, false, sortOrder, operatorMap[def.scoreOperator] || "best" /* nkruntime.Operator.BEST */);
        var instance = {
            id: instanceId,
            challengeId: data.challengeId,
            creatorId: userId,
            participants: {},
            leaderboardId: lbId,
            startAt: now,
            endAt: now + def.durationSec,
            claimedBy: []
        };
        instance.participants[userId] = { score: 0, joinedAt: now };
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ challenge: instance });
    }
    function rpcJoin(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId)
            return RpcHelpers.errorResponse("instanceId required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        var config = getConfig(nk);
        var def = config.challenges[instance.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Challenge config not found");
        var participantCount = Object.keys(instance.participants).length;
        if (participantCount >= def.maxParticipants)
            return RpcHelpers.errorResponse("Challenge full");
        var now = Math.floor(Date.now() / 1000);
        if (now > instance.endAt)
            return RpcHelpers.errorResponse("Challenge ended");
        if (def.entryCost && def.entryCost.currencies) {
            for (var cid in def.entryCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.entryCost.currencies[cid]);
            }
        }
        instance.participants[userId] = { score: 0, joinedAt: now };
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ challenge: instance });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId || data.score === undefined)
            return RpcHelpers.errorResponse("instanceId and score required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        if (!instance.participants[userId])
            return RpcHelpers.errorResponse("Not a participant");
        var now = Math.floor(Date.now() / 1000);
        if (now > instance.endAt)
            return RpcHelpers.errorResponse("Challenge ended");
        nk.leaderboardRecordWrite(instance.leaderboardId, userId, ctx.username || "", data.score, 0, {}, "best" /* nkruntime.OverrideOperator.BEST */);
        instance.participants[userId].score = data.score;
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.instanceId)
            return RpcHelpers.errorResponse("instanceId required");
        var instance = getChallengeInstance(nk, data.instanceId);
        if (!instance)
            return RpcHelpers.errorResponse("Challenge not found");
        if (instance.claimedBy.indexOf(userId) >= 0)
            return RpcHelpers.errorResponse("Already claimed");
        var config = getConfig(nk);
        var def = config.challenges[instance.challengeId];
        if (!def)
            return RpcHelpers.errorResponse("Challenge config not found");
        var records = nk.leaderboardRecordsList(instance.leaderboardId, [userId], 1, undefined, 0);
        var rank = 0;
        if (records.records && records.records.length > 0) {
            rank = records.records[0].rank;
        }
        if (rank === 1 && def.reward) {
            var resolved = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            instance.claimedBy.push(userId);
            saveChallengeInstance(nk, instance);
            EventBus.emit(nk, logger, ctx, EventBus.Events.CHALLENGE_COMPLETED, {
                userId: userId, challengeId: instance.challengeId, rank: rank
            });
            return RpcHelpers.successResponse({ rank: rank, reward: resolved });
        }
        instance.claimedBy.push(userId);
        saveChallengeInstance(nk, instance);
        return RpcHelpers.successResponse({ rank: rank, reward: null });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_challenges_create", rpcCreate);
        initializer.registerRpc("hiro_challenges_join", rpcJoin);
        initializer.registerRpc("hiro_challenges_submit", rpcSubmit);
        initializer.registerRpc("hiro_challenges_claim", rpcClaim);
    }
    HiroChallenges.register = register;
})(HiroChallenges || (HiroChallenges = {}));
var HiroEconomy;
(function (HiroEconomy) {
    var DEFAULT_CONFIG = {
        currencies: {
            game: { name: "Game Coins", initialAmount: 0 },
            tokens: { name: "Tokens", initialAmount: 0 },
            xp: { name: "Experience Points", initialAmount: 0 }
        },
        donations: {},
        storeItems: {}
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "economy", DEFAULT_CONFIG);
    }
    HiroEconomy.getConfig = getConfig;
    function getUserDonations(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId);
        return data || { outgoing: [], incoming: {} };
    }
    function saveUserDonations(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "donations_" + userId), userId, data);
    }
    function getRewardedVideoState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "rewarded_video_" + userId), userId);
        return data || { viewsToday: 0, lastViewDate: "", totalViews: 0 };
    }
    // ---- RPCs ----
    function rpcDonationRequest(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var donationId = data.donationId;
        if (!donationId)
            return RpcHelpers.errorResponse("donationId is required");
        var config = getConfig(nk);
        var donationDef = config.donations[donationId];
        if (!donationDef)
            return RpcHelpers.errorResponse("Unknown donation: " + donationId);
        var donations = getUserDonations(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var newDonation = {
            id: nk.uuidv4(),
            donationId: donationId,
            requesterId: userId,
            contributions: {},
            totalContributed: 0,
            createdAt: now,
            expiresAt: now + donationDef.durationSec
        };
        donations.outgoing.push(newDonation);
        saveUserDonations(nk, userId, donations, data.gameId);
        return RpcHelpers.successResponse(newDonation);
    }
    HiroEconomy.rpcDonationRequest = rpcDonationRequest;
    function rpcDonationGive(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId;
        var donationId = data.donationId;
        if (!targetUserId || !donationId)
            return RpcHelpers.errorResponse("userId and donationId required");
        var config = getConfig(nk);
        var donationDef = config.donations[donationId];
        if (!donationDef)
            return RpcHelpers.errorResponse("Unknown donation: " + donationId);
        if (donationDef.cost && donationDef.cost.currencies) {
            for (var cid in donationDef.cost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, donationDef.cost.currencies[cid]);
            }
        }
        var targetDonations = getUserDonations(nk, targetUserId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        for (var i = 0; i < targetDonations.outgoing.length; i++) {
            var d = targetDonations.outgoing[i];
            if (d.donationId === donationId && !d.claimedAt && d.expiresAt > now) {
                var userContrib = d.contributions[userId] || 0;
                if (donationDef.userContributionMaxCount && userContrib >= donationDef.userContributionMaxCount) {
                    return RpcHelpers.errorResponse("Max contributions reached");
                }
                if (d.totalContributed >= donationDef.maxCount) {
                    return RpcHelpers.errorResponse("Donation is full");
                }
                d.contributions[userId] = userContrib + 1;
                d.totalContributed++;
                break;
            }
        }
        saveUserDonations(nk, targetUserId, targetDonations, data.gameId);
        if (donationDef.senderReward) {
            var senderResolved = RewardEngine.resolveReward(nk, donationDef.senderReward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", senderResolved);
        }
        return RpcHelpers.successResponse({ success: true });
    }
    HiroEconomy.rpcDonationGive = rpcDonationGive;
    function rpcDonationClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var donationIds = data.donationIds;
        if (!donationIds || donationIds.length === 0)
            return RpcHelpers.errorResponse("donationIds required");
        var config = getConfig(nk);
        var donations = getUserDonations(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var claimed = [];
        for (var i = 0; i < donations.outgoing.length; i++) {
            var d = donations.outgoing[i];
            if (donationIds.indexOf(d.donationId) >= 0 && !d.claimedAt && d.totalContributed > 0) {
                d.claimedAt = now;
                var donationDef = config.donations[d.donationId];
                if (donationDef && donationDef.reward) {
                    var resolved = RewardEngine.resolveReward(nk, donationDef.reward);
                    RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
                }
                claimed.push(d.donationId);
            }
        }
        saveUserDonations(nk, userId, donations, data.gameId);
        return RpcHelpers.successResponse({ claimed: claimed });
    }
    HiroEconomy.rpcDonationClaim = rpcDonationClaim;
    function rpcRewardedVideoComplete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getRewardedVideoState(nk, userId, data.gameId);
        var today = new Date().toISOString().slice(0, 10);
        if (state.lastViewDate !== today) {
            state.viewsToday = 0;
            state.lastViewDate = today;
        }
        state.viewsToday++;
        state.totalViews++;
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(data.gameId, "rewarded_video_" + userId), userId, state);
        if (data.reward) {
            var resolved = RewardEngine.resolveReward(nk, data.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            return RpcHelpers.successResponse({ reward: resolved, state: state });
        }
        return RpcHelpers.successResponse({ state: state });
    }
    HiroEconomy.rpcRewardedVideoComplete = rpcRewardedVideoComplete;
    function register(initializer) {
        initializer.registerRpc("hiro_economy_donation_request", rpcDonationRequest);
        initializer.registerRpc("hiro_economy_donation_give", rpcDonationGive);
        initializer.registerRpc("hiro_economy_donation_claim", rpcDonationClaim);
        initializer.registerRpc("hiro_economy_rewarded_video", rpcRewardedVideoComplete);
    }
    HiroEconomy.register = register;
})(HiroEconomy || (HiroEconomy = {}));
var HiroEnergy;
(function (HiroEnergy) {
    var DEFAULT_CONFIG = {
        energies: {
            lives: { name: "Lives", maxEnergy: 5, startCount: 5, regenTimeSec: 1800 }
        }
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "energy", DEFAULT_CONFIG);
    }
    HiroEnergy.getConfig = getConfig;
    function getUserEnergy(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        if (data)
            return data;
        var config = getConfig(nk);
        var energies = {};
        var now = Math.floor(Date.now() / 1000);
        for (var id in config.energies) {
            var def = config.energies[id];
            energies[id] = {
                current: def.startCount,
                maxEnergy: def.maxEnergy,
                regenTimeSec: def.regenTimeSec,
                lastRegenAt: now
            };
        }
        return { energies: energies };
    }
    function saveUserEnergy(nk, userId, state, gameId) {
        Storage.writeJson(nk, Constants.HIRO_ENERGY_COLLECTION, Constants.gameKey(gameId, "state"), userId, state);
    }
    function applyRegen(state) {
        var now = Math.floor(Date.now() / 1000);
        if (state.current >= state.maxEnergy) {
            state.lastRegenAt = now;
            return state;
        }
        if (state.regenTimeSec <= 0)
            return state;
        var elapsed = now - state.lastRegenAt;
        var regenUnits = Math.floor(elapsed / state.regenTimeSec);
        // Purge expired modifiers
        if (state.modifiers) {
            state.modifiers = state.modifiers.filter(function (m) { return !m.expiresAt || m.expiresAt > now; });
            for (var mi = 0; mi < state.modifiers.length; mi++) {
                var mod = state.modifiers[mi];
                if (mod.id === "max_energy") {
                    if (mod.operator === "add")
                        state.maxEnergy += mod.value;
                    else if (mod.operator === "multiply")
                        state.maxEnergy = Math.floor(state.maxEnergy * mod.value);
                }
                if (mod.id === "regen_rate") {
                    if (mod.operator === "add")
                        state.regenTimeSec = Math.max(1, state.regenTimeSec - mod.value);
                    else if (mod.operator === "multiply")
                        state.regenTimeSec = Math.max(1, Math.floor(state.regenTimeSec / mod.value));
                }
            }
        }
        if (regenUnits > 0) {
            state.current = Math.min(state.current + regenUnits, state.maxEnergy);
            state.lastRegenAt = state.lastRegenAt + (regenUnits * state.regenTimeSec);
        }
        return state;
    }
    function addEnergy(nk, logger, ctx, userId, energyId, amount, gameId) {
        var state = getUserEnergy(nk, userId, gameId);
        var e = state.energies[energyId];
        if (!e) {
            var config = getConfig(nk);
            var def = config.energies[energyId];
            if (!def)
                return;
            e = {
                current: def.startCount,
                maxEnergy: def.maxEnergy,
                regenTimeSec: def.regenTimeSec,
                lastRegenAt: Math.floor(Date.now() / 1000)
            };
        }
        e = applyRegen(e);
        var maxOverfill = e.maxOverfill || e.maxEnergy;
        e.current = Math.min(e.current + amount, maxOverfill);
        state.energies[energyId] = e;
        saveUserEnergy(nk, userId, state, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_REFILLED, {
            userId: userId, energyId: energyId, amount: amount, current: e.current
        });
    }
    HiroEnergy.addEnergy = addEnergy;
    function spendEnergy(nk, logger, ctx, userId, energyId, amount, gameId) {
        var state = getUserEnergy(nk, userId, gameId);
        var e = state.energies[energyId];
        if (!e)
            return false;
        e = applyRegen(e);
        if (e.current < amount)
            return false;
        e.current -= amount;
        state.energies[energyId] = e;
        saveUserEnergy(nk, userId, state, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ENERGY_SPENT, {
            userId: userId, energyId: energyId, amount: amount, current: e.current
        });
        return true;
    }
    HiroEnergy.spendEnergy = spendEnergy;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var state = getUserEnergy(nk, userId, gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = {};
        for (var id in state.energies) {
            var e = applyRegen(state.energies[id]);
            var secsToNext = e.current >= e.maxEnergy ? 0 : e.regenTimeSec - (now - e.lastRegenAt);
            result[id] = {
                current: e.current,
                max: e.maxEnergy,
                regenTimeSec: e.regenTimeSec,
                secsToNextRegen: Math.max(0, secsToNext)
            };
        }
        saveUserEnergy(nk, userId, state, gameId);
        return RpcHelpers.successResponse({ energies: result });
    }
    function rpcSpend(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId || !data.amount)
            return RpcHelpers.errorResponse("energyId and amount required");
        if (!spendEnergy(nk, logger, ctx, userId, data.energyId, data.amount, data.gameId)) {
            return RpcHelpers.errorResponse("Insufficient energy");
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcRefill(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId)
            return RpcHelpers.errorResponse("energyId required");
        var config = getConfig(nk);
        var def = config.energies[data.energyId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown energy type");
        addEnergy(nk, logger, ctx, userId, data.energyId, def.maxEnergy, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcAddModifier(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.energyId || !data.modifierId || !data.durationSec) {
            return RpcHelpers.errorResponse("energyId, modifierId, and durationSec required");
        }
        var state = getUserEnergy(nk, userId, data.gameId);
        var e = state.energies[data.energyId];
        if (!e)
            return RpcHelpers.errorResponse("Unknown energy type");
        if (!e.modifiers)
            e.modifiers = [];
        var now = Math.floor(Date.now() / 1000);
        e.modifiers.push({
            id: data.modifierId,
            operator: data.operator || "add",
            value: data.value || 0,
            durationSec: data.durationSec,
            expiresAt: now + data.durationSec
        });
        state.energies[data.energyId] = e;
        saveUserEnergy(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ success: true, modifiers: e.modifiers });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_energy_get", rpcGet);
        initializer.registerRpc("hiro_energy_spend", rpcSpend);
        initializer.registerRpc("hiro_energy_refill", rpcRefill);
        initializer.registerRpc("hiro_energy_add_modifier", rpcAddModifier);
    }
    HiroEnergy.register = register;
})(HiroEnergy || (HiroEnergy = {}));
var HiroEventLeaderboards;
(function (HiroEventLeaderboards) {
    var DEFAULT_CONFIG = { events: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "event_leaderboards", DEFAULT_CONFIG);
    }
    HiroEventLeaderboards.getConfig = getConfig;
    function getUserEventState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId);
        return data || { events: {} };
    }
    function saveUserEventState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "event_lb_state_" + userId), userId, data);
    }
    function getActiveEvents(nk) {
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "active_event_lbs");
        return (data && data.events) || [];
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var activeEvents = getActiveEvents(nk);
        var userState = getUserEventState(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = [];
        for (var i = 0; i < activeEvents.length; i++) {
            var ae = activeEvents[i];
            var def = config.events[ae.eventId];
            if (!def)
                continue;
            var status = now < ae.startAt ? "upcoming" : now > ae.endAt ? "ended" : "active";
            var us = userState.events[ae.eventId];
            result.push({
                eventId: ae.eventId,
                name: def.name,
                description: def.description,
                leaderboardId: ae.leaderboardId,
                startAt: ae.startAt,
                endAt: ae.endAt,
                status: status,
                joined: us ? us.joined : false,
                claimed: us ? !!us.claimedAt : false,
                tiers: def.tiers
            });
        }
        return RpcHelpers.successResponse({ events: result });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId || data.score === undefined)
            return RpcHelpers.errorResponse("eventId and score required");
        var config = getConfig(nk);
        var def = config.events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown event");
        var activeEvents = getActiveEvents(nk);
        var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
        if (!ae)
            return RpcHelpers.errorResponse("Event not active");
        var now = Math.floor(Date.now() / 1000);
        if (now < ae.startAt || now > ae.endAt)
            return RpcHelpers.errorResponse("Event not in active window");
        var userState = getUserEventState(nk, userId, data.gameId);
        if (!userState.events[data.eventId]) {
            userState.events[data.eventId] = { joined: true, cohortId: ae.cohortId || "default" };
        }
        userState.events[data.eventId].joined = true;
        saveUserEventState(nk, userId, userState, data.gameId);
        var operatorMap = { best: "best" /* nkruntime.OverrideOperator.BEST */, set: "set" /* nkruntime.OverrideOperator.SET */, incr: "increment" /* nkruntime.OverrideOperator.INCREMENTAL */, decr: "decrement" /* nkruntime.OverrideOperator.DECREMENTAL */ };
        var op = operatorMap[def.operator] || "best" /* nkruntime.OverrideOperator.BEST */;
        nk.leaderboardRecordWrite(ae.leaderboardId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, op);
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
            userId: userId, eventId: data.eventId, score: data.score
        });
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var config = getConfig(nk);
        var def = config.events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown event");
        var userState = getUserEventState(nk, userId, data.gameId);
        var us = userState.events[data.eventId];
        if (!us || !us.joined)
            return RpcHelpers.errorResponse("Not joined");
        if (us.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var activeEvents = getActiveEvents(nk);
        var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
        if (!ae)
            return RpcHelpers.errorResponse("Event not found");
        var records = nk.leaderboardRecordsList(ae.leaderboardId, [userId], 1, undefined, 0);
        var rank = 0;
        if (records.records && records.records.length > 0) {
            rank = records.records[0].rank;
        }
        var reward = null;
        for (var i = 0; i < def.tiers.length; i++) {
            var tier = def.tiers[i];
            if (rank >= tier.rankMin && rank <= tier.rankMax) {
                reward = RewardEngine.resolveReward(nk, tier.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
                break;
            }
        }
        us.claimedAt = Math.floor(Date.now() / 1000);
        saveUserEventState(nk, userId, userState, data.gameId);
        return RpcHelpers.successResponse({ rank: rank, reward: reward });
    }
    function rpcGetRankings(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var activeEvents = getActiveEvents(nk);
        var ae = activeEvents.find(function (e) { return e.eventId === data.eventId; });
        if (!ae)
            return RpcHelpers.errorResponse("Event not found or not active");
        var config = getConfig(nk);
        var def = config.events[ae.eventId];
        var limit = data.limit || 50;
        var cursor = data.cursor || undefined;
        var result = nk.leaderboardRecordsList(ae.leaderboardId, [], limit, cursor, 0);
        var rankings = [];
        if (result.records) {
            for (var i = 0; i < result.records.length; i++) {
                var r = result.records[i];
                rankings.push({
                    rank: r.rank,
                    userId: r.ownerId,
                    username: r.username || "",
                    score: r.score,
                    subscore: r.subscore,
                    metadata: r.metadata,
                    updateTime: r.updateTime,
                });
            }
        }
        var callerRank = null;
        var userId = ctx.userId;
        if (userId) {
            var ownerRecords = nk.leaderboardRecordsList(ae.leaderboardId, [userId], 1, undefined, 0);
            if (ownerRecords.records && ownerRecords.records.length > 0) {
                var cr = ownerRecords.records[0];
                callerRank = {
                    rank: cr.rank,
                    userId: cr.ownerId,
                    username: cr.username || "",
                    score: cr.score,
                    subscore: cr.subscore,
                };
            }
        }
        return RpcHelpers.successResponse({
            eventId: data.eventId,
            name: def ? def.name : data.eventId,
            leaderboardId: ae.leaderboardId,
            rankings: rankings,
            nextCursor: result.nextCursor || "",
            prevCursor: result.prevCursor || "",
            callerRank: callerRank,
        });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_event_lb_list", rpcList);
        initializer.registerRpc("hiro_event_lb_submit", rpcSubmit);
        initializer.registerRpc("hiro_event_lb_claim", rpcClaim);
        initializer.registerRpc("hiro_event_lb_get", rpcGetRankings);
    }
    HiroEventLeaderboards.register = register;
})(HiroEventLeaderboards || (HiroEventLeaderboards = {}));
var HiroIncentives;
(function (HiroIncentives) {
    var DEFAULT_CONFIG = {};
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "incentives", DEFAULT_CONFIG);
    }
    HiroIncentives.getConfig = getConfig;
    function getUserState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId);
        return data || { referralsClaimed: [], lastSeenAt: 0, returnBonusClaimed: false };
    }
    function saveUserState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "incentives_" + userId), userId, data);
    }
    function rpcGetReferralCode(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getUserState(nk, userId, data.gameId);
        if (!state.referralCode) {
            state.referralCode = userId.substring(0, 8).toUpperCase();
            saveUserState(nk, userId, state, data.gameId);
        }
        return RpcHelpers.successResponse({ referralCode: state.referralCode });
    }
    function rpcApplyReferral(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.referralCode)
            return RpcHelpers.errorResponse("referralCode required");
        var state = getUserState(nk, userId, data.gameId);
        if (state.referredBy)
            return RpcHelpers.errorResponse("Already referred");
        var config = getConfig(nk);
        state.referredBy = data.referralCode;
        saveUserState(nk, userId, state, data.gameId);
        if (config.referralReward) {
            var resolved = RewardEngine.resolveReward(nk, config.referralReward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        }
        if (config.referrerReward) {
            RewardEngine.grantToMailbox(nk, data.referralCode, "Referral Reward", config.referrerReward);
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcCheckReturnBonus(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var state = getUserState(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var eligible = false;
        if (!state.returnBonusClaimed && state.lastSeenAt > 0 && config.returnBonusDays) {
            var daysSinceLastSeen = (now - state.lastSeenAt) / 86400;
            eligible = daysSinceLastSeen >= config.returnBonusDays;
        }
        state.lastSeenAt = now;
        saveUserState(nk, userId, state, data.gameId);
        if (eligible && config.returnBonus) {
            var resolved = RewardEngine.resolveReward(nk, config.returnBonus);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            state.returnBonusClaimed = true;
            saveUserState(nk, userId, state, data.gameId);
            return RpcHelpers.successResponse({ eligible: true, reward: resolved });
        }
        return RpcHelpers.successResponse({ eligible: eligible });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_incentives_referral_code", rpcGetReferralCode);
        initializer.registerRpc("hiro_incentives_apply_referral", rpcApplyReferral);
        initializer.registerRpc("hiro_incentives_return_bonus", rpcCheckReturnBonus);
    }
    HiroIncentives.register = register;
})(HiroIncentives || (HiroIncentives = {}));
var HiroInventory;
(function (HiroInventory) {
    var DEFAULT_CONFIG = { items: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "inventory", DEFAULT_CONFIG);
    }
    HiroInventory.getConfig = getConfig;
    function getUserInventory(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId);
        return data || { items: {} };
    }
    function saveUserInventory(nk, userId, inv, gameId) {
        Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, Constants.gameKey(gameId, "items"), userId, inv);
    }
    function grantItem(nk, logger, ctx, userId, itemId, count, stringProps, numericProps, gameId) {
        var config = getConfig(nk);
        var itemDef = config.items[itemId];
        var inv = getUserInventory(nk, userId, gameId);
        var now = Math.floor(Date.now() / 1000);
        var existing = inv.items[itemId];
        if (existing && itemDef && itemDef.stackable) {
            existing.count += count;
            if (itemDef.maxCount && existing.count > itemDef.maxCount) {
                existing.count = itemDef.maxCount;
            }
        }
        else {
            inv.items[itemId] = {
                id: itemId,
                count: count,
                acquiredAt: now,
                expiresAt: (itemDef && itemDef.durableSec) ? now + itemDef.durableSec : undefined,
                stringProperties: stringProps || {},
                numericProperties: numericProps || {}
            };
        }
        saveUserInventory(nk, userId, inv, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_GRANTED, {
            userId: userId, itemId: itemId, count: count
        });
        return inv.items[itemId];
    }
    HiroInventory.grantItem = grantItem;
    function consumeItem(nk, logger, ctx, userId, itemId, count, gameId) {
        var inv = getUserInventory(nk, userId, gameId);
        var item = inv.items[itemId];
        if (!item || item.count < count) {
            return false;
        }
        item.count -= count;
        if (item.count <= 0) {
            delete inv.items[itemId];
        }
        saveUserInventory(nk, userId, inv, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.ITEM_CONSUMED, {
            userId: userId, itemId: itemId, count: count
        });
        return true;
    }
    HiroInventory.consumeItem = consumeItem;
    function hasItem(nk, userId, itemId, count, gameId) {
        var inv = getUserInventory(nk, userId, gameId);
        var item = inv.items[itemId];
        return !!item && item.count >= count;
    }
    HiroInventory.hasItem = hasItem;
    function purgeExpired(inv) {
        var now = Math.floor(Date.now() / 1000);
        for (var id in inv.items) {
            if (inv.items[id].expiresAt && inv.items[id].expiresAt <= now) {
                delete inv.items[id];
            }
        }
        return inv;
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var inv = getUserInventory(nk, userId, gameId);
        inv = purgeExpired(inv);
        saveUserInventory(nk, userId, inv, gameId);
        if (data.category) {
            var config = getConfig(nk);
            var filtered = {};
            for (var id in inv.items) {
                var def = config.items[id];
                if (def && def.category === data.category) {
                    filtered[id] = inv.items[id];
                }
            }
            return RpcHelpers.successResponse({ items: filtered });
        }
        return RpcHelpers.successResponse({ items: inv.items });
    }
    function rpcGrant(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.count)
            return RpcHelpers.errorResponse("itemId and count required");
        var item = grantItem(nk, logger, ctx, userId, data.itemId, data.count, data.stringProperties, data.numericProperties, data.gameId);
        return RpcHelpers.successResponse({ item: item });
    }
    function rpcConsume(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.itemId || !data.count)
            return RpcHelpers.errorResponse("itemId and count required");
        var ok = consumeItem(nk, logger, ctx, userId, data.itemId, data.count, data.gameId);
        if (!ok)
            return RpcHelpers.errorResponse("Insufficient items");
        return RpcHelpers.successResponse({ success: true });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_inventory_list", rpcList);
        initializer.registerRpc("hiro_inventory_grant", rpcGrant);
        initializer.registerRpc("hiro_inventory_consume", rpcConsume);
    }
    HiroInventory.register = register;
})(HiroInventory || (HiroInventory = {}));
var HiroLeaderboards;
(function (HiroLeaderboards) {
    var DEFAULT_CONFIG = { leaderboards: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "leaderboards", DEFAULT_CONFIG);
    }
    function rpcList(ctx, logger, nk, payload) {
        var config = getConfig(nk);
        var result = [];
        for (var id in config.leaderboards) {
            result.push({ id: id, name: config.leaderboards[id].name, enableGeo: config.leaderboards[id].enableGeo });
        }
        return RpcHelpers.successResponse({ leaderboards: result });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.leaderboardId || data.score === undefined)
            return RpcHelpers.errorResponse("leaderboardId and score required");
        var config = getConfig(nk);
        var def = config.leaderboards[data.leaderboardId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown leaderboard");
        var operator = "best" /* nkruntime.Operator.BEST */;
        switch (def.operator) {
            case "best":
                operator = "best" /* nkruntime.Operator.BEST */;
                break;
            case "set":
                operator = "set" /* nkruntime.Operator.SET */;
                break;
            case "incr":
            case "decr":
                operator = "increment" /* nkruntime.Operator.INCREMENTAL */;
                break;
        }
        var metadata = data.metadata || {};
        if (def.enableGeo && data.location) {
            metadata.country = data.location.country || "";
            metadata.region = data.location.region || "";
            metadata.city = data.location.city || "";
        }
        try {
            nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
        }
        catch (e) {
            try {
                var sort = def.sortOrder === "asc" ? "ascending" /* nkruntime.SortOrder.ASCENDING */ : "descending" /* nkruntime.SortOrder.DESCENDING */;
                nk.leaderboardCreate(data.leaderboardId, false, sort, operator);
                nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
            }
            catch (e2) {
                return RpcHelpers.errorResponse("Failed to submit score: " + (e2.message || String(e2)));
            }
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
            userId: userId, leaderboardId: data.leaderboardId, score: data.score
        });
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcGetRecords(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.leaderboardId)
            return RpcHelpers.errorResponse("leaderboardId required");
        var limit = data.limit || 20;
        var cursor = data.cursor || "";
        try {
            var result = nk.leaderboardRecordsList(data.leaderboardId, [], limit, cursor, undefined);
            var records = [];
            if (result.records) {
                for (var i = 0; i < result.records.length; i++) {
                    var r = result.records[i];
                    records.push({
                        userId: r.ownerId,
                        username: r.username || "",
                        score: r.score,
                        subscore: r.subscore,
                        rank: r.rank,
                        metadata: r.metadata,
                        updateTime: r.updateTime
                    });
                }
            }
            if (data.geoFilter) {
                records = records.filter(function (rec) {
                    if (!rec.metadata)
                        return false;
                    var meta = typeof rec.metadata === "string" ? JSON.parse(rec.metadata) : rec.metadata;
                    if (data.geoFilter.country && meta.country !== data.geoFilter.country)
                        return false;
                    if (data.geoFilter.region && meta.region !== data.geoFilter.region)
                        return false;
                    return true;
                });
            }
            return RpcHelpers.successResponse({ records: records, nextCursor: result.nextCursor || "" });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Failed: " + (e.message || String(e)));
        }
    }
    function register(initializer) {
        initializer.registerRpc("hiro_leaderboards_list", rpcList);
        initializer.registerRpc("hiro_leaderboards_submit", rpcSubmit);
        initializer.registerRpc("hiro_leaderboards_records", rpcGetRecords);
    }
    HiroLeaderboards.register = register;
})(HiroLeaderboards || (HiroLeaderboards = {}));
var HiroMailbox;
(function (HiroMailbox) {
    function getUserMailbox(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId);
        return data || { messages: [] };
    }
    function saveUserMailbox(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId, data);
    }
    function purgeExpired(mailbox) {
        var now = Math.floor(Date.now() / 1000);
        mailbox.messages = mailbox.messages.filter(function (m) {
            return !m.expiresAt || m.expiresAt > now;
        });
        return mailbox;
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ messages: mailbox.messages });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        var msg = mailbox.messages.find(function (m) { return m.id === data.messageId; });
        if (!msg)
            return RpcHelpers.errorResponse("Message not found");
        if (msg.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var reward = null;
        if (msg.reward) {
            reward = RewardEngine.resolveReward(nk, msg.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        msg.claimedAt = Math.floor(Date.now() / 1000);
        msg.readAt = msg.readAt || msg.claimedAt;
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ reward: reward });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox.messages = mailbox.messages.filter(function (m) { return m.id !== data.messageId; });
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaimAll(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var mailbox = getUserMailbox(nk, userId, data.gameId);
        mailbox = purgeExpired(mailbox);
        var now = Math.floor(Date.now() / 1000);
        var claimed = 0;
        for (var i = 0; i < mailbox.messages.length; i++) {
            var msg = mailbox.messages[i];
            if (!msg.claimedAt && msg.reward) {
                var reward = RewardEngine.resolveReward(nk, msg.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
                msg.claimedAt = now;
                msg.readAt = msg.readAt || now;
                claimed++;
            }
        }
        saveUserMailbox(nk, userId, mailbox, data.gameId);
        return RpcHelpers.successResponse({ claimed: claimed });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_mailbox_list", rpcList);
        initializer.registerRpc("hiro_mailbox_claim", rpcClaim);
        initializer.registerRpc("hiro_mailbox_claim_all", rpcClaimAll);
        initializer.registerRpc("hiro_mailbox_delete", rpcDelete);
    }
    HiroMailbox.register = register;
})(HiroMailbox || (HiroMailbox = {}));
var HiroPersonalizers;
(function (HiroPersonalizers) {
    var OVERRIDES_COLLECTION = "hiro_personalizer_overrides";
    function deepClone(obj) {
        if (obj === null || typeof obj !== "object")
            return obj;
        if (Array.isArray(obj)) {
            var arr = [];
            for (var i = 0; i < obj.length; i++)
                arr.push(deepClone(obj[i]));
            return arr;
        }
        var clone = {};
        for (var key in obj) {
            if (obj.hasOwnProperty(key))
                clone[key] = deepClone(obj[key]);
        }
        return clone;
    }
    function setNestedValue(obj, path, value) {
        var parts = path.split(".");
        var current = obj;
        for (var i = 0; i < parts.length - 1; i++) {
            if (current[parts[i]] === undefined || current[parts[i]] === null) {
                current[parts[i]] = {};
            }
            current = current[parts[i]];
        }
        current[parts[parts.length - 1]] = value;
    }
    function mergeDeep(target, source) {
        if (!source || typeof source !== "object")
            return target;
        for (var key in source) {
            if (!source.hasOwnProperty(key))
                continue;
            if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) &&
                target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
                mergeDeep(target[key], source[key]);
            }
            else {
                target[key] = deepClone(source[key]);
            }
        }
        return target;
    }
    // ---- Storage Personalizer ----
    function applyStorageOverrides(nk, userId, system, config, gameId) {
        var data = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(gameId, "overrides"), userId);
        if (!data || !data.overrides || !data.overrides[system])
            return config;
        var overrides = data.overrides[system];
        for (var i = 0; i < overrides.length; i++) {
            setNestedValue(config, overrides[i].path, overrides[i].value);
        }
        return config;
    }
    // ---- Satori Personalizer (feature flags + experiments) ----
    function applySatoriOverrides(nk, userId, system, config) {
        // Check feature flags for config overrides
        var flagName = "hiro_" + system + "_override";
        var flag = SatoriFeatureFlags.getFlag(nk, userId, flagName);
        if (flag && flag.value) {
            try {
                var flagOverrides = JSON.parse(flag.value);
                config = mergeDeep(config, flagOverrides);
            }
            catch (_) { }
        }
        // Check experiment variants for config overrides
        var experiments = ConfigLoader.loadSatoriConfig(nk, "experiments", {});
        for (var expId in experiments) {
            var exp = experiments[expId];
            if (exp.status !== "running")
                continue;
            if (!exp.configSystem || exp.configSystem !== system)
                continue;
            var variant = SatoriExperiments.getVariant(nk, userId, expId);
            if (variant && variant.config) {
                try {
                    var variantOverrides = {};
                    for (var key in variant.config) {
                        try {
                            variantOverrides[key] = JSON.parse(variant.config[key]);
                        }
                        catch (_) {
                            variantOverrides[key] = variant.config[key];
                        }
                    }
                    config = mergeDeep(config, variantOverrides);
                }
                catch (_) { }
            }
        }
        return config;
    }
    // ---- Public API ----
    function personalize(nk, userId, system, baseConfig, gameId) {
        var config = deepClone(baseConfig);
        config = applyStorageOverrides(nk, userId, system, config, gameId);
        config = applySatoriOverrides(nk, userId, system, config);
        return config;
    }
    HiroPersonalizers.personalize = personalize;
    function personalizeConfig(nk, userId, system, loader, gameId) {
        var base = loader();
        return personalize(nk, userId, system, base, gameId);
    }
    HiroPersonalizers.personalizeConfig = personalizeConfig;
    // ---- Admin RPCs ----
    function rpcSetOverride(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system || !data.path) {
            return RpcHelpers.errorResponse("userId, system, and path required");
        }
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        if (!userOverrides)
            userOverrides = { overrides: {}, updatedAt: 0 };
        if (!userOverrides.overrides[data.system])
            userOverrides.overrides[data.system] = [];
        var existing = false;
        for (var i = 0; i < userOverrides.overrides[data.system].length; i++) {
            if (userOverrides.overrides[data.system][i].path === data.path) {
                userOverrides.overrides[data.system][i].value = data.value;
                existing = true;
                break;
            }
        }
        if (!existing) {
            userOverrides.overrides[data.system].push({ path: data.path, value: data.value });
        }
        userOverrides.updatedAt = Math.floor(Date.now() / 1000);
        Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
        return RpcHelpers.successResponse({ saved: true, system: data.system, path: data.path });
    }
    function rpcRemoveOverride(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system || !data.path) {
            return RpcHelpers.errorResponse("userId, system, and path required");
        }
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        if (!userOverrides || !userOverrides.overrides[data.system]) {
            return RpcHelpers.successResponse({ removed: false });
        }
        userOverrides.overrides[data.system] = userOverrides.overrides[data.system].filter(function (o) {
            return o.path !== data.path;
        });
        userOverrides.updatedAt = Math.floor(Date.now() / 1000);
        Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
        return RpcHelpers.successResponse({ removed: true });
    }
    function rpcGetOverrides(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        var userOverrides = Storage.readJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
        return RpcHelpers.successResponse({ overrides: userOverrides || { overrides: {} } });
    }
    function rpcPreviewConfig(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId || !data.system)
            return RpcHelpers.errorResponse("userId and system required");
        var base = ConfigLoader.loadConfig(nk, data.system, {});
        var personalized = personalize(nk, data.userId, data.system, base, data.gameId);
        return RpcHelpers.successResponse({ system: data.system, userId: data.userId, baseConfig: base, personalizedConfig: personalized });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_personalizer_set_override", rpcSetOverride);
        initializer.registerRpc("hiro_personalizer_remove_override", rpcRemoveOverride);
        initializer.registerRpc("hiro_personalizer_get_overrides", rpcGetOverrides);
        initializer.registerRpc("hiro_personalizer_preview", rpcPreviewConfig);
    }
    HiroPersonalizers.register = register;
})(HiroPersonalizers || (HiroPersonalizers = {}));
var HiroProgression;
(function (HiroProgression) {
    var DEFAULT_CONFIG = {
        levels: [
            { level: 1, xpRequired: 0 },
            { level: 2, xpRequired: 100 },
            { level: 3, xpRequired: 300 },
            { level: 4, xpRequired: 600 },
            { level: 5, xpRequired: 1000 }
        ],
        maxLevel: 100
    };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "progression", DEFAULT_CONFIG);
    }
    HiroProgression.getConfig = getConfig;
    function getUserProgression(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { xp: 0, level: 1, totalXpEarned: 0 };
    }
    HiroProgression.getUserProgression = getUserProgression;
    function saveUserProgression(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_PROGRESSION_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function getLevelForXp(config, xp) {
        var level = 1;
        for (var i = 0; i < config.levels.length; i++) {
            if (xp >= config.levels[i].xpRequired) {
                level = config.levels[i].level;
            }
            else {
                break;
            }
        }
        return Math.min(level, config.maxLevel);
    }
    function addXp(nk, logger, ctx, userId, amount, gameId) {
        var config = getConfig(nk);
        var state = getUserProgression(nk, userId, gameId);
        var oldLevel = state.level;
        state.xp += amount;
        state.totalXpEarned += amount;
        state.level = getLevelForXp(config, state.xp);
        EventBus.emit(nk, logger, ctx, EventBus.Events.XP_EARNED, {
            userId: userId, amount: amount, totalXp: state.xp, level: state.level
        });
        // Grant level-up rewards
        if (state.level > oldLevel) {
            for (var l = oldLevel + 1; l <= state.level; l++) {
                var levelConfig = config.levels.find(function (lc) { return lc.level === l; });
                if (levelConfig && levelConfig.reward) {
                    var resolved = RewardEngine.resolveReward(nk, levelConfig.reward);
                    RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", resolved);
                }
                EventBus.emit(nk, logger, ctx, EventBus.Events.LEVEL_UP, {
                    userId: userId, newLevel: l, previousLevel: l - 1
                });
            }
        }
        saveUserProgression(nk, userId, state, gameId);
        return state;
    }
    HiroProgression.addXp = addXp;
    function getXpToNextLevel(nk, userId, gameId) {
        var config = getConfig(nk);
        var state = getUserProgression(nk, userId, gameId);
        var nextLevel = config.levels.find(function (lc) { return lc.level === state.level + 1; });
        var required = nextLevel ? nextLevel.xpRequired : state.xp;
        return {
            current: state.xp,
            required: required,
            remaining: Math.max(0, required - state.xp)
        };
    }
    HiroProgression.getXpToNextLevel = getXpToNextLevel;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var state = getUserProgression(nk, userId, gameId);
        var xpInfo = getXpToNextLevel(nk, userId, gameId);
        return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
    }
    function rpcAddXp(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.amount || data.amount <= 0)
            return RpcHelpers.errorResponse("Positive amount required");
        var state = addXp(nk, logger, ctx, userId, data.amount, data.gameId);
        var xpInfo = getXpToNextLevel(nk, userId, data.gameId);
        return RpcHelpers.successResponse({ progression: state, nextLevel: xpInfo });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_progression_get", rpcGet);
        initializer.registerRpc("hiro_progression_add_xp", rpcAddXp);
    }
    HiroProgression.register = register;
})(HiroProgression || (HiroProgression = {}));
var HiroCreatorEventRewards;
(function (HiroCreatorEventRewards) {
    var BUCKET_COLLECTION = "hiro_creator_event_rewards";
    var BUCKET_PREFIX = "creator_event_";
    var TIER_ORDER = ["platinum", "gold", "silver", "bronze", "participation"];
    function getBucketDefinition(nk, eventId) {
        return Storage.readSystemJson(nk, BUCKET_COLLECTION, BUCKET_PREFIX + eventId);
    }
    function saveBucketDefinition(nk, def) {
        Storage.writeSystemJson(nk, BUCKET_COLLECTION, BUCKET_PREFIX + def.eventId, def);
    }
    function createBucketForEvent(nk, logger, eventId, prizes, prizePool) {
        var tiers = [];
        for (var to = 0; to < TIER_ORDER.length; to++) {
            for (var pi = 0; pi < prizes.length; pi++) {
                if (prizes[pi].tier !== TIER_ORDER[to])
                    continue;
                var prize = prizes[pi];
                var tierPoolAmount = Math.floor((prizePool * prize.percentage) / 100);
                var perWinnerAmount = prize.maxWinners > 0 ? Math.floor(tierPoolAmount / prize.maxWinners) : 0;
                var reward = {};
                var grant = {};
                var hasGrant = false;
                if (perWinnerAmount > 0) {
                    grant.currencies = { xut: perWinnerAmount };
                    hasGrant = true;
                }
                if (prize.nftBadgeId) {
                    grant.items = {};
                    grant.items[prize.nftBadgeId] = { min: 1 };
                    hasGrant = true;
                }
                if (hasGrant) {
                    reward.guaranteed = grant;
                }
                tiers.push({
                    tier: prize.tier,
                    percentage: prize.percentage,
                    maxWinners: prize.maxWinners,
                    nftBadgeId: prize.nftBadgeId,
                    xutPerWinner: perWinnerAmount,
                    totalPool: tierPoolAmount,
                    reward: reward,
                });
            }
        }
        var def = {
            eventId: eventId,
            name: "Creator Event: " + eventId,
            prizePool: prizePool,
            tiers: tiers,
            createdAt: Math.floor(Date.now() / 1000),
        };
        saveBucketDefinition(nk, def);
        logger.info("[CreatorEventRewards] Created reward bucket for event %s with %d tiers, pool=%d", eventId, tiers.length, prizePool);
    }
    HiroCreatorEventRewards.createBucketForEvent = createBucketForEvent;
    function getTierReward(nk, eventId, tierName) {
        var def = getBucketDefinition(nk, eventId);
        if (!def)
            return null;
        for (var i = 0; i < def.tiers.length; i++) {
            if (def.tiers[i].tier === tierName) {
                return def.tiers[i].reward;
            }
        }
        return null;
    }
    HiroCreatorEventRewards.getTierReward = getTierReward;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getBucketDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Reward bucket not found for event");
        var tiersResponse = [];
        for (var i = 0; i < def.tiers.length; i++) {
            var tier = def.tiers[i];
            tiersResponse.push({
                tier: tier.tier,
                percentage: tier.percentage,
                maxWinners: tier.maxWinners,
                nftBadgeId: tier.nftBadgeId || "",
                xutPerWinner: tier.xutPerWinner,
                totalPool: tier.totalPool,
            });
        }
        return RpcHelpers.successResponse({
            eventId: def.eventId,
            name: def.name,
            prizePool: def.prizePool,
            tiers: tiersResponse,
            createdAt: def.createdAt,
        });
    }
    function rpcCreate(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var validation = RpcHelpers.validatePayload(data, ["eventId", "prizes", "prizePool"]);
        if (!validation.valid)
            return RpcHelpers.errorResponse("Missing: " + validation.missing.join(", "));
        createBucketForEvent(nk, logger, data.eventId, data.prizes, data.prizePool);
        return RpcHelpers.successResponse({
            success: true,
            bucketId: BUCKET_PREFIX + data.eventId,
        });
    }
    function register(initializer) {
        initializer.registerRpc("creator_event_rewards_get", rpcGet);
        initializer.registerRpc("creator_event_rewards_create", rpcCreate);
    }
    HiroCreatorEventRewards.register = register;
})(HiroCreatorEventRewards || (HiroCreatorEventRewards = {}));
var HiroRewardBucket;
(function (HiroRewardBucket) {
    var BUCKET_COLLECTION = "hiro_reward_buckets";
    var DEFAULT_CONFIG = { buckets: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "reward_buckets", DEFAULT_CONFIG);
    }
    function getUserBuckets(nk, userId, gameId) {
        var data = Storage.readJson(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { buckets: {} };
    }
    function saveUserBuckets(nk, userId, data, gameId) {
        Storage.writeJson(nk, BUCKET_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function addProgress(nk, logger, ctx, userId, bucketId, amount, gameId) {
        var config = getConfig(nk);
        var def = config.buckets[bucketId];
        if (!def)
            return;
        var userBuckets = getUserBuckets(nk, userId, gameId);
        if (!userBuckets.buckets[bucketId]) {
            userBuckets.buckets[bucketId] = { progress: 0, unlockedTiers: [], totalUnlocks: 0 };
        }
        var state = userBuckets.buckets[bucketId];
        state.progress = Math.min(state.progress + amount, def.maxProgress);
        saveUserBuckets(nk, userId, userBuckets, gameId);
    }
    HiroRewardBucket.addProgress = addProgress;
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var userBuckets = getUserBuckets(nk, userId, data.gameId);
        var result = [];
        for (var id in config.buckets) {
            var def = config.buckets[id];
            var state = userBuckets.buckets[id] || { progress: 0, unlockedTiers: [], totalUnlocks: 0 };
            var tiers = [];
            for (var i = 0; i < def.tiers.length; i++) {
                tiers.push({
                    index: i,
                    progressRequired: def.tiers[i].progressRequired,
                    unlocked: state.unlockedTiers.indexOf(i) >= 0,
                    reachable: state.progress >= def.tiers[i].progressRequired
                });
            }
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                progress: state.progress,
                maxProgress: def.maxProgress,
                tiers: tiers,
                unlockCost: def.unlockCost,
                totalUnlocks: state.totalUnlocks,
                additionalProperties: def.additionalProperties
            });
        }
        return RpcHelpers.successResponse({ buckets: result });
    }
    function rpcProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.bucketId || !data.amount)
            return RpcHelpers.errorResponse("bucketId and amount required");
        addProgress(nk, logger, ctx, userId, data.bucketId, data.amount, data.gameId);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcUnlock(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.bucketId)
            return RpcHelpers.errorResponse("bucketId required");
        var tierIndex = data.tierIndex !== undefined ? data.tierIndex : -1;
        var config = getConfig(nk);
        var def = config.buckets[data.bucketId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown bucket");
        var userBuckets = getUserBuckets(nk, userId, data.gameId);
        var state = userBuckets.buckets[data.bucketId];
        if (!state)
            return RpcHelpers.errorResponse("No progress in this bucket");
        if (tierIndex < 0 || tierIndex >= def.tiers.length)
            return RpcHelpers.errorResponse("Invalid tier index");
        if (state.unlockedTiers.indexOf(tierIndex) >= 0)
            return RpcHelpers.errorResponse("Tier already unlocked");
        if (state.progress < def.tiers[tierIndex].progressRequired)
            return RpcHelpers.errorResponse("Insufficient progress");
        if (def.unlockCost) {
            for (var cid in def.unlockCost) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.unlockCost[cid]);
            }
        }
        var resolved = RewardEngine.resolveReward(nk, def.tiers[tierIndex].reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        state.unlockedTiers.push(tierIndex);
        state.lastUnlockedAt = Math.floor(Date.now() / 1000);
        state.totalUnlocks++;
        if (def.resetOnUnlock && state.unlockedTiers.length >= def.tiers.length) {
            state.progress = 0;
            state.unlockedTiers = [];
        }
        saveUserBuckets(nk, userId, userBuckets, data.gameId);
        return RpcHelpers.successResponse({ reward: resolved, state: state });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_reward_bucket_get", rpcGet);
        initializer.registerRpc("hiro_reward_bucket_progress", rpcProgress);
        initializer.registerRpc("hiro_reward_bucket_unlock", rpcUnlock);
    }
    HiroRewardBucket.register = register;
    function registerEventHandlers() {
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.buckets) {
                addProgress(nk, logger, ctx, data.userId, id, 1);
            }
        });
        EventBus.on(EventBus.Events.STORE_PURCHASE, function (nk, logger, ctx, data) {
            var config = getConfig(nk);
            for (var id in config.buckets) {
                addProgress(nk, logger, ctx, data.userId, id, 5);
            }
        });
    }
    HiroRewardBucket.registerEventHandlers = registerEventHandlers;
})(HiroRewardBucket || (HiroRewardBucket = {}));
var HiroStats;
(function (HiroStats) {
    var DEFAULT_CONFIG = { stats: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "stats", DEFAULT_CONFIG);
    }
    HiroStats.getConfig = getConfig;
    function getUserStats(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId);
        if (data)
            return data;
        var config = getConfig(nk);
        var stats = {};
        for (var id in config.stats) {
            stats[id] = config.stats[id].defaultValue || 0;
        }
        return { stats: stats };
    }
    function saveUserStats(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_STATS_COLLECTION, Constants.gameKey(gameId, "values"), userId, data);
    }
    function updateStat(nk, logger, ctx, userId, statId, value, gameId) {
        var config = getConfig(nk);
        var def = config.stats[statId];
        var userStats = getUserStats(nk, userId, gameId);
        var current = userStats.stats[statId] || 0;
        var aggregation = (def && def.aggregation) || "sum";
        switch (aggregation) {
            case "sum":
                current += value;
                break;
            case "max":
                current = Math.max(current, value);
                break;
            case "min":
                current = Math.min(current, value);
                break;
            case "latest":
                current = value;
                break;
        }
        if (def && def.maxValue !== undefined) {
            current = Math.min(current, def.maxValue);
        }
        userStats.stats[statId] = current;
        saveUserStats(nk, userId, userStats, gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STAT_UPDATED, {
            userId: userId, statId: statId, value: current, delta: value
        });
        return current;
    }
    HiroStats.updateStat = updateStat;
    function getStat(nk, userId, statId, gameId) {
        var userStats = getUserStats(nk, userId, gameId);
        return userStats.stats[statId] || 0;
    }
    HiroStats.getStat = getStat;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var userStats = getUserStats(nk, userId, gameId);
        var config = getConfig(nk);
        if (data.publicOnly) {
            var publicStats = {};
            for (var id in userStats.stats) {
                if (config.stats[id] && config.stats[id].isPublic) {
                    publicStats[id] = userStats.stats[id];
                }
            }
            return RpcHelpers.successResponse({ stats: publicStats });
        }
        return RpcHelpers.successResponse({ stats: userStats.stats });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.statId)
            return RpcHelpers.errorResponse("statId required");
        var newVal = updateStat(nk, logger, ctx, userId, data.statId, data.value || 1, data.gameId);
        return RpcHelpers.successResponse({ statId: data.statId, value: newVal });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_stats_get", rpcGet);
        initializer.registerRpc("hiro_stats_update", rpcUpdate);
    }
    HiroStats.register = register;
})(HiroStats || (HiroStats = {}));
var HiroStore;
(function (HiroStore) {
    var DEFAULT_CONFIG = { sections: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "store", DEFAULT_CONFIG);
    }
    HiroStore.getConfig = getConfig;
    function getUserPurchases(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId);
        return data || { purchases: {} };
    }
    function saveUserPurchases(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_CONFIGS_COLLECTION, Constants.gameKey(gameId, "store_purchases_" + userId), userId, data);
    }
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var purchases = getUserPurchases(nk, userId, data.gameId);
        var now = Math.floor(Date.now() / 1000);
        var result = {};
        for (var sectionId in config.sections) {
            var section = config.sections[sectionId];
            var items = [];
            for (var offerId in section.items) {
                var offer = section.items[offerId];
                if (offer.availableAt && now < offer.availableAt)
                    continue;
                if (offer.expiresAt && now > offer.expiresAt)
                    continue;
                var purchaseCount = purchases.purchases[offerId] ? purchases.purchases[offerId].count : 0;
                var available = !offer.maxPurchases || purchaseCount < offer.maxPurchases;
                items.push({
                    id: offerId,
                    name: offer.name,
                    description: offer.description,
                    cost: offer.cost,
                    available: available,
                    purchaseCount: purchaseCount,
                    maxPurchases: offer.maxPurchases,
                    expiresAt: offer.expiresAt,
                    additionalProperties: offer.additionalProperties
                });
            }
            result[sectionId] = { name: section.name, items: items };
        }
        return RpcHelpers.successResponse({ sections: result });
    }
    function rpcPurchase(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.offerId)
            return RpcHelpers.errorResponse("offerId required");
        var config = getConfig(nk);
        var offer = null;
        for (var sectionId in config.sections) {
            if (config.sections[sectionId].items[data.offerId]) {
                offer = config.sections[sectionId].items[data.offerId];
                break;
            }
        }
        if (!offer)
            return RpcHelpers.errorResponse("Unknown offer");
        var now = Math.floor(Date.now() / 1000);
        if (offer.availableAt && now < offer.availableAt)
            return RpcHelpers.errorResponse("Offer not yet available");
        if (offer.expiresAt && now > offer.expiresAt)
            return RpcHelpers.errorResponse("Offer expired");
        var purchases = getUserPurchases(nk, userId, data.gameId);
        var purchaseCount = purchases.purchases[data.offerId] ? purchases.purchases[data.offerId].count : 0;
        if (offer.maxPurchases && purchaseCount >= offer.maxPurchases)
            return RpcHelpers.errorResponse("Max purchases reached");
        if (offer.cost && offer.cost.currencies) {
            for (var cid in offer.cost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, offer.cost.currencies[cid]);
            }
        }
        var resolved = RewardEngine.resolveReward(nk, offer.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        if (!purchases.purchases[data.offerId]) {
            purchases.purchases[data.offerId] = { count: 0, lastPurchaseAt: 0 };
        }
        purchases.purchases[data.offerId].count++;
        purchases.purchases[data.offerId].lastPurchaseAt = now;
        saveUserPurchases(nk, userId, purchases, data.gameId);
        EventBus.emit(nk, logger, ctx, EventBus.Events.STORE_PURCHASE, {
            userId: userId, offerId: data.offerId, reward: resolved
        });
        return RpcHelpers.successResponse({ reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_store_list", rpcList);
        initializer.registerRpc("hiro_store_purchase", rpcPurchase);
    }
    HiroStore.register = register;
})(HiroStore || (HiroStore = {}));
var HiroStreaks;
(function (HiroStreaks) {
    var DEFAULT_CONFIG = { streaks: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "streaks", DEFAULT_CONFIG);
    }
    HiroStreaks.getConfig = getConfig;
    function getUserStreaks(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { streaks: {} };
    }
    function saveUserStreaks(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_STREAKS_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function updateStreak(nk, logger, ctx, userId, streakId, gameId) {
        var config = getConfig(nk);
        var def = config.streaks[streakId];
        if (!def)
            throw new Error("Unknown streak: " + streakId);
        var streaks = getUserStreaks(nk, userId, gameId);
        var state = streaks.streaks[streakId];
        var now = Math.floor(Date.now() / 1000);
        if (!state) {
            state = { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
        }
        var elapsed = now - state.lastUpdateAt;
        var gracePeriod = def.gracePeriodSec || 0;
        if (state.lastUpdateAt > 0 && elapsed > def.resetIntervalSec + gracePeriod) {
            EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_BROKEN, {
                userId: userId, streakId: streakId, count: state.count
            });
            state.count = 0;
            state.claimedMilestones = [];
        }
        if (elapsed >= def.resetIntervalSec || state.lastUpdateAt === 0) {
            state.count++;
            state.lastUpdateAt = now;
            EventBus.emit(nk, logger, ctx, EventBus.Events.STREAK_UPDATED, {
                userId: userId, streakId: streakId, count: state.count
            });
        }
        streaks.streaks[streakId] = state;
        saveUserStreaks(nk, userId, streaks, gameId);
        return state;
    }
    HiroStreaks.updateStreak = updateStreak;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId;
        var config = getConfig(nk);
        var streaks = getUserStreaks(nk, userId, gameId);
        var result = {};
        for (var id in config.streaks) {
            var def = config.streaks[id];
            var state = streaks.streaks[id] || { count: 0, lastUpdateAt: 0, claimedMilestones: [] };
            var milestones = [];
            for (var count in def.milestones) {
                milestones.push({
                    count: parseInt(count),
                    claimed: state.claimedMilestones.indexOf(count) >= 0,
                    reachable: state.count >= parseInt(count)
                });
            }
            result[id] = { name: def.name, count: state.count, lastUpdateAt: state.lastUpdateAt, milestones: milestones };
        }
        return RpcHelpers.successResponse({ streaks: result });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.streakId)
            return RpcHelpers.errorResponse("streakId required");
        var state = updateStreak(nk, logger, ctx, userId, data.streakId, data.gameId);
        return RpcHelpers.successResponse({ streak: state });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.streakId || !data.milestone)
            return RpcHelpers.errorResponse("streakId and milestone required");
        var config = getConfig(nk);
        var def = config.streaks[data.streakId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown streak");
        var milestone = String(data.milestone);
        var reward = def.milestones[milestone];
        if (!reward)
            return RpcHelpers.errorResponse("Unknown milestone");
        var streaks = getUserStreaks(nk, userId, data.gameId);
        var state = streaks.streaks[data.streakId];
        if (!state || state.count < parseInt(milestone))
            return RpcHelpers.errorResponse("Milestone not reached");
        if (state.claimedMilestones.indexOf(milestone) >= 0)
            return RpcHelpers.errorResponse("Already claimed");
        var resolved = RewardEngine.resolveReward(nk, reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
        state.claimedMilestones.push(milestone);
        streaks.streaks[data.streakId] = state;
        saveUserStreaks(nk, userId, streaks, data.gameId);
        return RpcHelpers.successResponse({ reward: resolved });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_streaks_get", rpcGet);
        initializer.registerRpc("hiro_streaks_update", rpcUpdate);
        initializer.registerRpc("hiro_streaks_claim", rpcClaim);
    }
    HiroStreaks.register = register;
})(HiroStreaks || (HiroStreaks = {}));
var HiroTeams;
(function (HiroTeams) {
    function getTeamData(nk, groupId) {
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + groupId);
        return data || { groupId: groupId, stats: {}, wallet: {}, achievements: {} };
    }
    function saveTeamData(nk, data) {
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, "team_" + data.groupId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ team: teamData });
    }
    function rpcUpdateStats(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId || !data.statId)
            return RpcHelpers.errorResponse("groupId and statId required");
        var teamData = getTeamData(nk, data.groupId);
        var current = teamData.stats[data.statId] || 0;
        teamData.stats[data.statId] = current + (data.value || 1);
        saveTeamData(nk, teamData);
        return RpcHelpers.successResponse({ statId: data.statId, value: teamData.stats[data.statId] });
    }
    function rpcGetWallet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ wallet: teamData.wallet });
    }
    function rpcUpdateWallet(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId || !data.currencyId || data.amount === undefined) {
            return RpcHelpers.errorResponse("groupId, currencyId, and amount required");
        }
        var teamData = getTeamData(nk, data.groupId);
        var current = teamData.wallet[data.currencyId] || 0;
        var newBalance = current + data.amount;
        if (newBalance < 0)
            return RpcHelpers.errorResponse("Insufficient team funds");
        teamData.wallet[data.currencyId] = newBalance;
        saveTeamData(nk, teamData);
        return RpcHelpers.successResponse({ currencyId: data.currencyId, balance: newBalance });
    }
    function rpcAchievements(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.groupId)
            return RpcHelpers.errorResponse("groupId required");
        var teamData = getTeamData(nk, data.groupId);
        return RpcHelpers.successResponse({ achievements: teamData.achievements });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_teams_get", rpcGet);
        initializer.registerRpc("hiro_teams_stats", rpcUpdateStats);
        initializer.registerRpc("hiro_teams_wallet_get", rpcGetWallet);
        initializer.registerRpc("hiro_teams_wallet_update", rpcUpdateWallet);
        initializer.registerRpc("hiro_teams_achievements", rpcAchievements);
    }
    HiroTeams.register = register;
})(HiroTeams || (HiroTeams = {}));
var HiroTutorials;
(function (HiroTutorials) {
    var DEFAULT_CONFIG = { tutorials: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "tutorials", DEFAULT_CONFIG);
    }
    HiroTutorials.getConfig = getConfig;
    function getUserTutorials(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId);
        return data || { tutorials: {} };
    }
    function saveUserTutorials(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_TUTORIALS_COLLECTION, Constants.gameKey(gameId, "progress"), userId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        var progress = getUserTutorials(nk, userId, data.gameId);
        var result = {};
        for (var id in config.tutorials) {
            var def = config.tutorials[id];
            var state = progress.tutorials[id] || { step: 0 };
            result[id] = {
                name: def.name,
                totalSteps: def.steps.length,
                currentStep: state.step,
                completed: !!state.completedAt,
                steps: def.steps.map(function (s, i) {
                    return { id: s.id, name: s.name, completed: i < state.step };
                })
            };
        }
        return RpcHelpers.successResponse({ tutorials: result });
    }
    function rpcAdvance(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.tutorialId)
            return RpcHelpers.errorResponse("tutorialId required");
        var config = getConfig(nk);
        var def = config.tutorials[data.tutorialId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown tutorial");
        var progress = getUserTutorials(nk, userId, data.gameId);
        var state = progress.tutorials[data.tutorialId] || { step: 0 };
        if (state.completedAt)
            return RpcHelpers.errorResponse("Tutorial already completed");
        if (state.step < def.steps.length) {
            var stepDef = def.steps[state.step];
            if (stepDef.reward) {
                var resolved = RewardEngine.resolveReward(nk, stepDef.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", resolved);
            }
            state.step++;
        }
        if (state.step >= def.steps.length) {
            state.completedAt = Math.floor(Date.now() / 1000);
            if (def.reward) {
                var finalResolved = RewardEngine.resolveReward(nk, def.reward);
                RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", finalResolved);
            }
        }
        progress.tutorials[data.tutorialId] = state;
        saveUserTutorials(nk, userId, progress, data.gameId);
        return RpcHelpers.successResponse({ tutorial: state });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_tutorials_get", rpcGet);
        initializer.registerRpc("hiro_tutorials_advance", rpcAdvance);
    }
    HiroTutorials.register = register;
})(HiroTutorials || (HiroTutorials = {}));
var HiroUnlockables;
(function (HiroUnlockables) {
    var DEFAULT_CONFIG = { unlockables: {} };
    function getConfig(nk) {
        return ConfigLoader.loadConfig(nk, "unlockables", DEFAULT_CONFIG);
    }
    HiroUnlockables.getConfig = getConfig;
    function getUserState(nk, userId, gameId) {
        var data = Storage.readJson(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId);
        return data || { activeSlots: {}, totalSlots: 1 };
    }
    function saveUserState(nk, userId, data, gameId) {
        Storage.writeJson(nk, Constants.HIRO_UNLOCKABLES_COLLECTION, Constants.gameKey(gameId, "state"), userId, data);
    }
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var state = getUserState(nk, userId, data.gameId);
        var config = getConfig(nk);
        var now = Math.floor(Date.now() / 1000);
        var slots = [];
        for (var slotId in state.activeSlots) {
            var slot = state.activeSlots[slotId];
            slots.push({
                slotId: slotId,
                unlockableId: slot.unlockableId,
                startedAt: slot.startedAt,
                completesAt: slot.completesAt,
                ready: now >= slot.completesAt,
                claimed: !!slot.claimedAt
            });
        }
        return RpcHelpers.successResponse({ slots: slots, totalSlots: state.totalSlots, availableUnlockables: Object.keys(config.unlockables) });
    }
    function rpcStart(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.unlockableId)
            return RpcHelpers.errorResponse("unlockableId required");
        var config = getConfig(nk);
        var def = config.unlockables[data.unlockableId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown unlockable");
        var state = getUserState(nk, userId, data.gameId);
        var activeCount = Object.keys(state.activeSlots).length;
        if (activeCount >= state.totalSlots)
            return RpcHelpers.errorResponse("No free slots");
        var now = Math.floor(Date.now() / 1000);
        var slotId = nk.uuidv4();
        state.activeSlots[slotId] = {
            unlockableId: data.unlockableId,
            startedAt: now,
            completesAt: now + def.waitTimeSec
        };
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ slotId: slotId });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.slotId)
            return RpcHelpers.errorResponse("slotId required");
        var state = getUserState(nk, userId, data.gameId);
        var slot = state.activeSlots[data.slotId];
        if (!slot)
            return RpcHelpers.errorResponse("Slot not found");
        if (slot.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        var now = Math.floor(Date.now() / 1000);
        if (now < slot.completesAt)
            return RpcHelpers.errorResponse("Not ready yet");
        var config = getConfig(nk);
        var def = config.unlockables[slot.unlockableId];
        var reward = null;
        if (def && def.reward) {
            reward = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        slot.claimedAt = now;
        delete state.activeSlots[data.slotId];
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ reward: reward });
    }
    function rpcBuySlot(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.unlockableId)
            return RpcHelpers.errorResponse("unlockableId required");
        var config = getConfig(nk);
        var def = config.unlockables[data.unlockableId];
        if (!def)
            return RpcHelpers.errorResponse("Unknown unlockable");
        var state = getUserState(nk, userId, data.gameId);
        if (state.totalSlots >= (def.maxSlots || 4))
            return RpcHelpers.errorResponse("Max slots reached");
        if (def.slotCost && def.slotCost.currencies) {
            for (var cid in def.slotCost.currencies) {
                WalletHelpers.spendCurrency(nk, logger, ctx, userId, data.gameId || "default", cid, def.slotCost.currencies[cid]);
            }
        }
        state.totalSlots++;
        saveUserState(nk, userId, state, data.gameId);
        return RpcHelpers.successResponse({ totalSlots: state.totalSlots });
    }
    function register(initializer) {
        initializer.registerRpc("hiro_unlockables_get", rpcGet);
        initializer.registerRpc("hiro_unlockables_start", rpcStart);
        initializer.registerRpc("hiro_unlockables_claim", rpcClaim);
        initializer.registerRpc("hiro_unlockables_buy_slot", rpcBuySlot);
    }
    HiroUnlockables.register = register;
})(HiroUnlockables || (HiroUnlockables = {}));
var LegacyAnalyticsRetention;
(function (LegacyAnalyticsRetention) {
    function readAggStorage(nk, collection, key) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: Constants.SYSTEM_USER_ID }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function writeAggStorage(nk, collection, key, value) {
        nk.storageWrite([{
                collection: collection, key: key, userId: Constants.SYSTEM_USER_ID,
                value: value, permissionRead: 0, permissionWrite: 0
            }]);
    }
    function rpcCohortRetention(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId || null;
        var daysBack = parseInt(data.daysBack, 10) || 60;
        var now = Date.now();
        var cohorts = [];
        for (var d = 0; d < daysBack; d++) {
            var cohortDay = new Date(now - d * 86400000);
            var cohortKey = cohortDay.toISOString().split("T")[0];
            var dauKey = gameId ? "dau_" + gameId + "_" + cohortKey : "dau_platform_" + cohortKey;
            var dauData = readAggStorage(nk, "analytics_dau", dauKey);
            if (dauData && dauData.uniqueUsers) {
                cohorts.push({ date: cohortKey, dau: dauData.uniqueUsers.length || 0, newUsers: dauData.newUsers || 0 });
            }
        }
        var retentionData = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {};
        var total = retentionData.totalSignups || 0;
        return RpcHelpers.successResponse({
            cohorts: cohorts,
            retention: {
                totalSignups: total,
                d1Returns: retentionData.d1Returns || 0,
                d7Returns: retentionData.d7Returns || 0,
                d30Returns: retentionData.d30Returns || 0,
                d1Rate: total > 0 ? ((retentionData.d1Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
                d7Rate: total > 0 ? ((retentionData.d7Returns || 0) / total * 100).toFixed(1) + "%" : "0%",
                d30Rate: total > 0 ? ((retentionData.d30Returns || 0) / total * 100).toFixed(1) + "%" : "0%"
            },
            gameId: gameId, daysBack: daysBack
        });
    }
    function rpcTrackRetentionEvent(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var eventType = data.eventType || "session";
        var counters = readAggStorage(nk, "analytics_retention_agg", "retention_counters") || {
            totalSignups: 0, d1Returns: 0, d7Returns: 0, d30Returns: 0
        };
        if (eventType === "signup")
            counters.totalSignups = (counters.totalSignups || 0) + 1;
        else if (eventType === "d1_return")
            counters.d1Returns = (counters.d1Returns || 0) + 1;
        else if (eventType === "d7_return")
            counters.d7Returns = (counters.d7Returns || 0) + 1;
        else if (eventType === "d30_return")
            counters.d30Returns = (counters.d30Returns || 0) + 1;
        writeAggStorage(nk, "analytics_retention_agg", "retention_counters", counters);
        var today = new Date().toISOString().split("T")[0];
        var platformDauKey = "dau_platform_" + today;
        var platformDau = readAggStorage(nk, "analytics_dau", platformDauKey) || { uniqueUsers: [], count: 0, newUsers: 0 };
        if (platformDau.uniqueUsers.indexOf(userId) === -1) {
            platformDau.uniqueUsers.push(userId);
            platformDau.count = platformDau.uniqueUsers.length;
            if (eventType === "signup")
                platformDau.newUsers = (platformDau.newUsers || 0) + 1;
            writeAggStorage(nk, "analytics_dau", platformDauKey, platformDau);
        }
        return RpcHelpers.successResponse({ eventType: eventType });
    }
    function rpcArpu(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var period = data.period || "30d";
        var gameId = data.gameId || null;
        var daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
        var now = Date.now();
        var totalRevenue = 0;
        var totalPurchases = 0;
        var uniquePayingUsers = [];
        var totalActiveUsers = 0;
        for (var d = 0; d < daysBack; d++) {
            var dayStr = new Date(now - d * 86400000).toISOString().split("T")[0];
            var revData = readAggStorage(nk, "analytics_revenue", "revenue_" + dayStr);
            if (revData) {
                totalRevenue += revData.totalAmount || 0;
                totalPurchases += revData.purchaseCount || 0;
                if (revData.payingUsers) {
                    for (var i = 0; i < revData.payingUsers.length; i++) {
                        if (uniquePayingUsers.indexOf(revData.payingUsers[i]) === -1)
                            uniquePayingUsers.push(revData.payingUsers[i]);
                    }
                }
            }
            var dauKey = gameId ? "dau_" + gameId + "_" + dayStr : "dau_platform_" + dayStr;
            var dauData = readAggStorage(nk, "analytics_dau", dauKey);
            if (dauData && dauData.count)
                totalActiveUsers += dauData.count;
        }
        var avgDau = daysBack > 0 ? Math.round(totalActiveUsers / daysBack) : 0;
        var arpu = avgDau > 0 ? (totalRevenue / avgDau).toFixed(2) : "0.00";
        var arppu = uniquePayingUsers.length > 0 ? (totalRevenue / uniquePayingUsers.length).toFixed(2) : "0.00";
        return RpcHelpers.successResponse({
            period: period, daysBack: daysBack, totalRevenue: totalRevenue,
            totalPurchases: totalPurchases, uniquePayingUsers: uniquePayingUsers.length,
            avgDau: avgDau, arpu: parseFloat(arpu), arppu: parseFloat(arppu),
            conversionRate: avgDau > 0 ? ((uniquePayingUsers.length / avgDau) * 100).toFixed(2) + "%" : "0%",
            gameId: gameId
        });
    }
    function rpcTrackRevenue(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var amount = parseFloat(data.amount) || 0;
        var currency = data.currency || "USD";
        var productId = data.productId || "unknown";
        if (amount <= 0)
            return RpcHelpers.errorResponse("amount must be > 0");
        var today = new Date().toISOString().split("T")[0];
        var revenueKey = "revenue_" + today;
        var revData = readAggStorage(nk, "analytics_revenue", revenueKey) || {
            totalAmount: 0, purchaseCount: 0, payingUsers: [], transactions: []
        };
        revData.totalAmount = (revData.totalAmount || 0) + amount;
        revData.purchaseCount = (revData.purchaseCount || 0) + 1;
        if (revData.payingUsers.indexOf(userId) === -1)
            revData.payingUsers.push(userId);
        revData.transactions = revData.transactions || [];
        revData.transactions.push({
            userId: userId, amount: amount, currency: currency, productId: productId,
            timestamp: new Date().toISOString()
        });
        writeAggStorage(nk, "analytics_revenue", revenueKey, revData);
        return RpcHelpers.successResponse({
            tracked: { userId: userId, amount: amount, currency: currency, productId: productId }
        });
    }
    function register(initializer) {
        initializer.registerRpc("analytics_cohort_retention", rpcCohortRetention);
        initializer.registerRpc("analytics_track_retention_event", rpcTrackRetentionEvent);
        initializer.registerRpc("analytics_arpu", rpcArpu);
        initializer.registerRpc("analytics_track_revenue", rpcTrackRevenue);
    }
    LegacyAnalyticsRetention.register = register;
})(LegacyAnalyticsRetention || (LegacyAnalyticsRetention = {}));
var LegacyAnalytics;
(function (LegacyAnalytics) {
    function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var eventName = data.name || data.eventName || "unknown";
            var properties = data.properties || data.data || {};
            var timestamp = Math.floor(Date.now() / 1000);
            var key = "evt_" + timestamp + "_" + userId + "_" + nk.uuidv4().slice(0, 8);
            var record = {
                eventName: eventName,
                userId: userId,
                properties: properties,
                timestamp: timestamp,
                date: new Date().toISOString().slice(0, 10)
            };
            nk.storageWrite([{
                    collection: Constants.ANALYTICS_COLLECTION,
                    key: key,
                    userId: Constants.SYSTEM_USER_ID,
                    value: record,
                    permissionRead: 0,
                    permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ success: true, key: key });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to log event");
        }
    }
    function register(initializer) {
        initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    }
    LegacyAnalytics.register = register;
})(LegacyAnalytics || (LegacyAnalytics = {}));
var LegacyChat;
(function (LegacyChat) {
    function rpcSendGroupChatMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var content = data.content || data.message || "";
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var channelId = nk.channelIdBuild(userId, groupId, 3);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send group message");
        }
    }
    function rpcSendDirectMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            var content = data.content || data.message || "";
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            var channelId = nk.channelIdBuild(userId, targetUserId, 2);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send direct message");
        }
    }
    function rpcSendChatRoomMessage(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var roomName = data.roomName || data.room || "general";
            var content = data.content || data.message || "";
            var channelId = nk.channelIdBuild(undefined, roomName, 1);
            var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
            return RpcHelpers.successResponse({ messageId: ack.messageId });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send room message");
        }
    }
    function rpcGetGroupChatHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var channelId = nk.channelIdBuild(userId, groupId, 3);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get group chat history");
        }
    }
    function rpcGetDirectMessageHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            var channelId = nk.channelIdBuild(userId, targetUserId, 2);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get direct message history");
        }
    }
    function rpcGetChatRoomHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var roomName = data.roomName || data.room || "general";
            var channelId = nk.channelIdBuild(undefined, roomName, 1);
            var limit = data.limit || 100;
            var forward = data.forward !== false;
            var cursor = data.cursor || "";
            var result = nk.channelMessagesList(channelId, limit, forward, cursor);
            return RpcHelpers.successResponse({
                messages: result.messages || [],
                nextCursor: result.nextCursor || "",
                prevCursor: result.prevCursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get room history");
        }
    }
    function rpcMarkDirectMessagesRead(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to mark messages read");
        }
    }
    function register(initializer) {
        initializer.registerRpc("send_group_chat_message", rpcSendGroupChatMessage);
        initializer.registerRpc("send_direct_message", rpcSendDirectMessage);
        initializer.registerRpc("send_chat_room_message", rpcSendChatRoomMessage);
        initializer.registerRpc("get_group_chat_history", rpcGetGroupChatHistory);
        initializer.registerRpc("get_direct_message_history", rpcGetDirectMessageHistory);
        initializer.registerRpc("get_chat_room_history", rpcGetChatRoomHistory);
        initializer.registerRpc("mark_direct_messages_read", rpcMarkDirectMessagesRead);
    }
    LegacyChat.register = register;
})(LegacyChat || (LegacyChat = {}));
var LegacyCoupons;
(function (LegacyCoupons) {
    function safeRead(nk, collection, key, userId) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function rpcList(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var records = [];
            try {
                var result = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
                if (result && result.length > 0 && result[0].value && result[0].value.coupons)
                    records = result[0].value.coupons;
            }
            catch (_) { }
            var now = Date.now();
            var active = [];
            for (var i = 0; i < records.length; i++) {
                var c = records[i];
                if (c.status !== "active")
                    continue;
                if (c.valid_from && new Date(c.valid_from).getTime() > now)
                    continue;
                if (c.valid_until && new Date(c.valid_until).getTime() < now)
                    continue;
                if (c.max_redemptions !== null && c.current_redemptions >= c.max_redemptions)
                    continue;
                active.push(c);
            }
            return RpcHelpers.successResponse({ coupons: active, total: active.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcRedeem(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            var couponId = data.coupon_id;
            if (!gameId || !couponId)
                return RpcHelpers.errorResponse("game_id and coupon_id required");
            var catalogRecs = nk.storageRead([{ collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
            if (!catalogRecs || catalogRecs.length === 0)
                return RpcHelpers.errorResponse("No coupon catalog for this game");
            var coupons = catalogRecs[0].value.coupons || [];
            var coupon = null;
            var couponIdx = -1;
            for (var i = 0; i < coupons.length; i++) {
                if (coupons[i].id === couponId) {
                    coupon = coupons[i];
                    couponIdx = i;
                    break;
                }
            }
            if (!coupon)
                return RpcHelpers.errorResponse("Coupon not found");
            if (coupon.status !== "active")
                return RpcHelpers.errorResponse("Coupon not available");
            var now = Date.now();
            if (coupon.valid_from && new Date(coupon.valid_from).getTime() > now)
                return RpcHelpers.errorResponse("Coupon not yet available");
            if (coupon.valid_until && new Date(coupon.valid_until).getTime() < now)
                return RpcHelpers.errorResponse("Coupon has expired");
            if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions)
                return RpcHelpers.errorResponse("Coupon fully redeemed");
            if (coupon.max_per_user > 0) {
                var redemptionKey = "redemptions:" + gameId + ":" + userId;
                var userRedemptions = safeRead(nk, "game_coupon_redemptions", redemptionKey, userId);
                var userCount = 0;
                if (userRedemptions && userRedemptions.redemptions) {
                    for (var j = 0; j < userRedemptions.redemptions.length; j++) {
                        if (userRedemptions.redemptions[j].coupon_id === couponId)
                            userCount++;
                    }
                }
                if (userCount >= coupon.max_per_user)
                    return RpcHelpers.errorResponse("Maximum redemptions per user reached");
            }
            if (coupon.coin_cost > 0) {
                var currency = coupon.coin_currency || "coins";
                var debitChangeset = {};
                debitChangeset[currency] = -coupon.coin_cost;
                try {
                    nk.walletUpdate(userId, debitChangeset, { reason: "game_coupon:" + couponId }, true);
                }
                catch (walletErr) {
                    return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
                }
            }
            coupons[couponIdx].current_redemptions = (coupons[couponIdx].current_redemptions || 0) + 1;
            if (coupons[couponIdx].max_redemptions !== null && coupons[couponIdx].current_redemptions >= coupons[couponIdx].max_redemptions) {
                coupons[couponIdx].status = "exhausted";
            }
            nk.storageWrite([{
                    collection: "game_coupons", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
                    value: { coupons: coupons, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            var redemptionRecord = {
                redemption_id: nk.uuidv4(), coupon_id: couponId, coupon_title: coupon.title,
                coupon_code: coupon.coupon_code, coin_cost: coupon.coin_cost,
                discount_type: coupon.discount_type, discount_value: coupon.discount_value,
                reward_payload: coupon.reward_payload, redeemed_at: new Date().toISOString()
            };
            var historyKey = "redemptions:" + gameId + ":" + userId;
            var existing = safeRead(nk, "game_coupon_redemptions", historyKey, userId);
            var allRedemptions = (existing && existing.redemptions) ? existing.redemptions : [];
            allRedemptions.push(redemptionRecord);
            nk.storageWrite([{
                    collection: "game_coupon_redemptions", key: historyKey, userId: userId,
                    value: { redemptions: allRedemptions, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ redemption: redemptionRecord, message: "Coupon redeemed successfully" });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcSyncCatalog(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id || !data.coupons)
                return RpcHelpers.errorResponse("game_id and coupons[] required");
            nk.storageWrite([{
                    collection: "game_coupons", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
                    value: { coupons: data.coupons, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ synced: data.coupons.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_coupon_list", rpcList);
        initializer.registerRpc("game_coupon_redeem", rpcRedeem);
        initializer.registerRpc("game_coupon_sync_catalog", rpcSyncCatalog);
    }
    LegacyCoupons.register = register;
})(LegacyCoupons || (LegacyCoupons = {}));
var LegacyDailyRewards;
(function (LegacyDailyRewards) {
    var CYCLE_DAYS = 7;
    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }
    function getTodayDateString() {
        var d = new Date();
        return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
    }
    function getStatus(nk, userId) {
        return Storage.readJson(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId);
    }
    function saveStatus(nk, userId, status) {
        Storage.writeJson(nk, Constants.DAILY_REWARDS_COLLECTION, "status_" + userId, userId, status);
    }
    function rpcGetStatus(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var status = getStatus(nk, userId);
        var today = getTodayDateString();
        if (!status) {
            status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
        }
        return RpcHelpers.successResponse({
            day: status.day,
            lastClaimDate: status.lastClaimDate,
            streak: status.streak,
            rewards: status.rewards,
            canClaim: status.lastClaimDate !== today
        });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var gameId = data.gameId || "default";
        var status = getStatus(nk, userId);
        var today = getTodayDateString();
        if (!status) {
            status = { day: 0, lastClaimDate: "", streak: 0, rewards: [] };
        }
        if (status.lastClaimDate === today) {
            return RpcHelpers.errorResponse("Already claimed today");
        }
        var prevDate = status.lastClaimDate;
        var dayDiff = 1;
        if (prevDate) {
            var prev = new Date(prevDate);
            var curr = new Date(today);
            dayDiff = Math.floor((curr.getTime() - prev.getTime()) / 86400000);
        }
        if (dayDiff > 1) {
            status.streak = 0;
        }
        else if (dayDiff === 1) {
            status.streak = (status.streak || 0) + 1;
        }
        status.day = ((status.day || 0) % CYCLE_DAYS) + 1;
        status.lastClaimDate = today;
        var rewardConfig = status.day <= 7
            ? { game: 50 * status.day, tokens: 10 * status.day, xp: 5 * status.day }
            : { game: 100, tokens: 20, xp: 10 };
        if (rewardConfig.game && rewardConfig.game > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", rewardConfig.game);
        }
        if (rewardConfig.tokens && rewardConfig.tokens > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", rewardConfig.tokens);
        }
        if (rewardConfig.xp && rewardConfig.xp > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", rewardConfig.xp);
        }
        status.rewards = status.rewards || [];
        status.rewards.push({
            day: status.day,
            date: today,
            game: rewardConfig.game,
            tokens: rewardConfig.tokens,
            xp: rewardConfig.xp
        });
        saveStatus(nk, userId, status);
        try {
            var syncPayload = {
                userId: userId,
                day: status.day,
                streak: status.streak,
                lastClaimDate: today,
                rewards: rewardConfig
            };
            var syncUrl = data.syncUrl;
            if (syncUrl && typeof syncUrl === "string") {
                HttpClient.post(nk, syncUrl, JSON.stringify(syncPayload));
            }
        }
        catch (_) { }
        var rewardAmount = (rewardConfig.game || 0) + (rewardConfig.tokens || 0);
        if (rewardAmount > 0) {
            try {
                var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
                var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
                var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
                var syncBody = JSON.stringify({ amount: rewardAmount, sourceType: "daily_reward", sourceId: "daily:day_" + status.day, description: "Daily reward day " + status.day });
                var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
                var sig = nk.binaryToString(sigBytes);
                nk.httpRequest(questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post", { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId }, syncBody);
            }
            catch (_) { }
        }
        return RpcHelpers.successResponse({
            day: status.day,
            streak: status.streak,
            reward: rewardConfig
        });
    }
    function register(initializer) {
        initializer.registerRpc("daily_rewards_get_status", rpcGetStatus);
        initializer.registerRpc("daily_rewards_claim", rpcClaim);
    }
    LegacyDailyRewards.register = register;
})(LegacyDailyRewards || (LegacyDailyRewards = {}));
// ============================================================================
// src/legacy/friends.ts — Legacy friend mutation RPCs (block/unblock/remove)
// ============================================================================
// HISTORY
// -------
// This namespace used to register six friend RPCs: friends_block, friends_unblock,
// friends_remove, friends_list, friends_challenge_user, friends_spectate.
//
// Phase-3a moved friends_challenge_user + friends_spectate ownership to
// data/modules/friends/friend_challenges.js (canonical lifecycle module).
// Their dead handlers were already physically removed from this file in
// that pass.
//
// Phase-4 C1 moves friends_list ownership to src/friends/friends_list.ts
// (canonical flat-shape module with presence + relationship enrichment).
// The dead rpcFriendsList handler is removed here too.
//
// What remains
// ------------
// Three thin wrappers around Nakama's built-in friend-graph mutation APIs.
// These are intentionally minimal — they just shape the response envelope
// and merge the `userId`/`username` convenience args with the array forms.
// We keep them in TypeScript (not in the legacy JS bridge) because:
//   1) They're small enough that maintenance cost is zero.
//   2) The TS path wins precedence in postbuild merging, so any JS twin
//      in data/modules/friends/friends.js is silently shadowed — keeping
//      them in TS is the cleanest way to make THIS file the source of truth.
//
// Notification follow-ups
// -----------------------
// Currently these handlers do NOT emit notifications. That is intentional:
//   - friends_block: silent by product policy (don't tell the blocked user).
//   - friends_unblock: silent (no user-facing event).
//   - friends_remove: silent (the removed friend simply no longer sees you
//     in their list; we deliberately do not notify them — most social apps
//     follow the same convention).
// If product wants to change this, add `sendFriendsNotification` calls using
// `FRIEND_REMOVED` (code 5) / `FRIEND_BLOCKED` (code 6) — both already
// reserved in friends/notification_codes.js.
// ============================================================================
var LegacyFriends;
(function (LegacyFriends) {
    function rpcFriendsBlock(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsBlock(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to block");
        }
    }
    function rpcFriendsUnblock(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsDelete(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to unblock");
        }
    }
    function rpcFriendsRemove(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var ids = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
            var usernames = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
            if (data.userId)
                ids.push(data.userId);
            if (data.username)
                usernames.push(data.username);
            if (ids.length === 0 && usernames.length === 0) {
                return RpcHelpers.errorResponse("ids or usernames required");
            }
            var result = nk.friendsDelete(userId, username, ids, usernames);
            return RpcHelpers.successResponse({ friends: result.friends || [] });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to remove friend");
        }
    }
    function register(initializer) {
        initializer.registerRpc("friends_block", rpcFriendsBlock);
        initializer.registerRpc("friends_unblock", rpcFriendsUnblock);
        initializer.registerRpc("friends_remove", rpcFriendsRemove);
        // Phase-3a: friends_challenge_user + friends_spectate are registered by
        //   data/modules/friends/friend_challenges.js (canonical lifecycle module).
        // Phase-4 C1: friends_list is registered by src/friends/friends_list.ts
        //   (canonical flat-shape module). Lines physically removed (not commented)
        //   so postbuild's textual regex doesn't pick them up.
    }
    LegacyFriends.register = register;
})(LegacyFriends || (LegacyFriends = {}));
var LegacyGameEntry;
(function (LegacyGameEntry) {
    var GAME_ENTRY_COLLECTION = "game_entry";
    function getEntryKey(userId, gameId) {
        return "entry_" + userId + "_" + gameId;
    }
    function getEntry(nk, userId, gameId) {
        var key = getEntryKey(userId, gameId);
        return Storage.readJson(nk, GAME_ENTRY_COLLECTION, key, userId);
    }
    function saveEntry(nk, userId, entry) {
        var key = getEntryKey(entry.userId, entry.gameId);
        Storage.writeJson(nk, GAME_ENTRY_COLLECTION, key, userId, entry);
    }
    function rpcGameEntryValidate(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var currencyId = data.currencyId || "game";
            var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
            if (amount <= 0)
                return RpcHelpers.errorResponse("amount must be positive");
            if (!WalletHelpers.hasCurrency(nk, userId, gameId, currencyId, amount)) {
                return RpcHelpers.errorResponse("Insufficient " + currencyId);
            }
            WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, currencyId, amount);
            var now = Math.floor(Date.now() / 1000);
            var entry = {
                userId: userId,
                gameId: gameId,
                currencyId: currencyId,
                amount: amount,
                status: "validated",
                validatedAt: now
            };
            saveEntry(nk, userId, entry);
            return RpcHelpers.successResponse({ valid: true, entry: entry });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Validation failed");
        }
    }
    function rpcGameEntryComplete(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var success = data.success !== false;
            var entry = getEntry(nk, userId, gameId);
            if (!entry)
                return RpcHelpers.errorResponse("No active entry found");
            if (entry.status !== "validated")
                return RpcHelpers.errorResponse("Entry already completed");
            var now = Math.floor(Date.now() / 1000);
            if (!success) {
                WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, entry.currencyId, entry.amount);
                entry.status = "refunded";
            }
            else {
                entry.status = "completed";
            }
            entry.completedAt = now;
            saveEntry(nk, userId, entry);
            return RpcHelpers.successResponse({ entry: entry });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Completion failed");
        }
    }
    function rpcGameEntryGetStatus(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "default";
            var entry = getEntry(nk, userId, gameId);
            return RpcHelpers.successResponse({ entry: entry || null });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get status");
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_entry_validate", rpcGameEntryValidate);
        initializer.registerRpc("game_entry_complete", rpcGameEntryComplete);
        initializer.registerRpc("game_entry_get_status", rpcGameEntryGetStatus);
    }
    LegacyGameEntry.register = register;
})(LegacyGameEntry || (LegacyGameEntry = {}));
var LegacyGameRegistry;
(function (LegacyGameRegistry) {
    function getGameRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry");
        return data || { games: [] };
    }
    function rpcGetGameRegistry(ctx, logger, nk, payload) {
        var registry = getGameRegistry(nk);
        return RpcHelpers.successResponse({ games: registry.games, lastSyncAt: registry.lastSyncAt });
    }
    function rpcGetGameById(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.gameId)
            return RpcHelpers.errorResponse("gameId required");
        var registry = getGameRegistry(nk);
        var game = registry.games.find(function (g) { return g.id === data.gameId; });
        if (!game)
            return RpcHelpers.errorResponse("Game not found: " + data.gameId);
        return RpcHelpers.successResponse({ game: game });
    }
    function rpcSyncGameRegistry(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var apiUrl = data.apiUrl || "https://api.intelliversex.com/games";
            var response;
            try {
                response = HttpClient.get(nk, apiUrl);
            }
            catch (err) {
                logger.warn("[GameRegistry] API fetch failed, using existing data: " + err.message);
                var existing = getGameRegistry(nk);
                return RpcHelpers.successResponse({ success: true, gamesSync: existing.games.length, source: "cache" });
            }
            var games = [];
            if (response && response.code === 200 && response.body) {
                try {
                    var parsed = JSON.parse(response.body);
                    games = parsed.games || parsed.data || parsed || [];
                }
                catch (_) {
                    games = [];
                }
            }
            var registry = {
                games: games,
                lastSyncAt: new Date().toISOString()
            };
            Storage.writeSystemJson(nk, Constants.GAME_REGISTRY_COLLECTION, "registry", registry);
            return RpcHelpers.successResponse({ success: true, gamesSync: games.length });
        }
        catch (err) {
            return RpcHelpers.errorResponse("Sync failed: " + err.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("get_game_registry", rpcGetGameRegistry);
        initializer.registerRpc("get_game_by_id", rpcGetGameById);
        initializer.registerRpc("sync_game_registry", rpcSyncGameRegistry);
    }
    LegacyGameRegistry.register = register;
})(LegacyGameRegistry || (LegacyGameRegistry = {}));
var LegacyGiftCards;
(function (LegacyGiftCards) {
    function safeRead(nk, collection, key, userId) {
        try {
            var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
            if (recs && recs.length > 0)
                return recs[0].value;
        }
        catch (_) { }
        return null;
    }
    function rpcList(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var records = [];
            try {
                var result = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
                if (result && result.length > 0 && result[0].value && result[0].value.cards)
                    records = result[0].value.cards;
            }
            catch (_) { }
            var now = Date.now();
            var active = [];
            for (var i = 0; i < records.length; i++) {
                var c = records[i];
                if (c.status !== "active")
                    continue;
                if (c.valid_from && new Date(c.valid_from).getTime() > now)
                    continue;
                if (c.valid_until && new Date(c.valid_until).getTime() < now)
                    continue;
                if (c.stock_total !== null && c.stock_sold >= c.stock_total)
                    continue;
                active.push(c);
            }
            return RpcHelpers.successResponse({ cards: active, total: active.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcPurchase(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id;
            var cardId = data.card_id;
            if (!gameId || !cardId)
                return RpcHelpers.errorResponse("game_id and card_id required");
            var catalogRecs = nk.storageRead([{ collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID }]);
            if (!catalogRecs || catalogRecs.length === 0)
                return RpcHelpers.errorResponse("No gift card catalog for this game");
            var cards = catalogRecs[0].value.cards || [];
            var card = null;
            var cardIdx = -1;
            for (var i = 0; i < cards.length; i++) {
                if (cards[i].id === cardId) {
                    card = cards[i];
                    cardIdx = i;
                    break;
                }
            }
            if (!card)
                return RpcHelpers.errorResponse("Gift card not found");
            if (card.status !== "active")
                return RpcHelpers.errorResponse("Gift card not available");
            var now = Date.now();
            if (card.valid_from && new Date(card.valid_from).getTime() > now)
                return RpcHelpers.errorResponse("Gift card not yet available");
            if (card.valid_until && new Date(card.valid_until).getTime() < now)
                return RpcHelpers.errorResponse("Gift card has expired");
            if (card.stock_total !== null && card.stock_sold >= card.stock_total)
                return RpcHelpers.errorResponse("Gift card sold out");
            if (card.max_per_user > 0) {
                var purchaseKey = "purchases:" + gameId + ":" + userId;
                var userPurchases = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
                var userCount = 0;
                if (userPurchases && userPurchases.purchases) {
                    for (var j = 0; j < userPurchases.purchases.length; j++) {
                        if (userPurchases.purchases[j].card_id === cardId)
                            userCount++;
                    }
                }
                if (userCount >= card.max_per_user)
                    return RpcHelpers.errorResponse("Maximum purchases per user reached");
            }
            var currency = card.coin_currency || "coins";
            var debitChangeset = {};
            debitChangeset[currency] = -card.coin_price;
            var walletResult;
            try {
                walletResult = nk.walletUpdate(userId, debitChangeset, { reason: "game_gift_card:" + cardId }, true);
            }
            catch (walletErr) {
                return RpcHelpers.errorResponse("Insufficient coins: " + walletErr.message);
            }
            cards[cardIdx].stock_sold = (cards[cardIdx].stock_sold || 0) + 1;
            if (cards[cardIdx].stock_total !== null && cards[cardIdx].stock_sold >= cards[cardIdx].stock_total) {
                cards[cardIdx].status = "sold_out";
            }
            nk.storageWrite([{
                    collection: "game_gift_cards", key: "catalog:" + gameId, userId: Constants.SYSTEM_USER_ID,
                    value: { cards: cards, updated_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            var purchaseRecord = {
                purchase_id: nk.uuidv4(), card_id: cardId, card_name: card.name,
                coin_price: card.coin_price, coin_currency: currency,
                reward_type: card.reward_type, reward_payload: card.reward_payload,
                purchased_at: new Date().toISOString()
            };
            var purchaseHistoryKey = "purchases:" + gameId + ":" + userId;
            var existing = safeRead(nk, "game_gift_card_purchases", purchaseHistoryKey, userId);
            var allPurchases = (existing && existing.purchases) ? existing.purchases : [];
            allPurchases.push(purchaseRecord);
            nk.storageWrite([{
                    collection: "game_gift_card_purchases", key: purchaseHistoryKey, userId: userId,
                    value: { purchases: allPurchases, updated_at: new Date().toISOString() }, permissionRead: 1, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ purchase: purchaseRecord, new_wallet: walletResult || {}, message: "Gift card purchased successfully" });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcSyncCatalog(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id || !data.cards)
                return RpcHelpers.errorResponse("game_id and cards[] required");
            nk.storageWrite([{
                    collection: "game_gift_cards", key: "catalog:" + data.game_id, userId: Constants.SYSTEM_USER_ID,
                    value: { cards: data.cards, synced_at: new Date().toISOString() }, permissionRead: 2, permissionWrite: 0
                }]);
            return RpcHelpers.successResponse({ synced: data.cards.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function rpcGetPurchases(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.game_id)
                return RpcHelpers.errorResponse("game_id required");
            var purchaseKey = "purchases:" + data.game_id + ":" + userId;
            var existing = safeRead(nk, "game_gift_card_purchases", purchaseKey, userId);
            var purchases = (existing && existing.purchases) ? existing.purchases : [];
            return RpcHelpers.successResponse({ purchases: purchases, total: purchases.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("game_gift_card_list", rpcList);
        initializer.registerRpc("game_gift_card_purchase", rpcPurchase);
        initializer.registerRpc("game_gift_card_sync_catalog", rpcSyncCatalog);
        initializer.registerRpc("game_gift_card_get_purchases", rpcGetPurchases);
    }
    LegacyGiftCards.register = register;
})(LegacyGiftCards || (LegacyGiftCards = {}));
var LegacyGroups;
(function (LegacyGroups) {
    var GROUP_WALLETS_COLLECTION = "group_wallets";
    function rpcCreateGameGroup(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var username = ctx.username || "";
            var data = RpcHelpers.parseRpcPayload(payload);
            var name = data.name || "Game Group";
            var description = data.description || "";
            var open = data.open !== false;
            var metadata = data.metadata || {};
            if (data.gameId)
                metadata.gameId = data.gameId;
            var group = nk.groupCreate(userId, name, userId, null, description, null, open, metadata, data.limit || 100);
            return RpcHelpers.successResponse({ group: group });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to create group");
        }
    }
    function rpcUpdateGroupXp(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var xp = data.xp;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            if (xp === undefined)
                return RpcHelpers.errorResponse("xp required");
            var groups = nk.groupsGetId([groupId]);
            if (!groups || groups.length === 0)
                return RpcHelpers.errorResponse("Group not found");
            var group = groups[0];
            var meta = group.metadata || {};
            var currentXp = typeof meta.xp === "number" ? meta.xp : 0;
            meta.xp = currentXp + (typeof xp === "number" ? xp : parseInt(String(xp), 10));
            nk.groupUpdate(groupId, userId, undefined, undefined, undefined, undefined, undefined, undefined, meta, undefined);
            return RpcHelpers.successResponse({ xp: meta.xp });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to update group XP");
        }
    }
    function getGroupWallet(nk, groupId) {
        var key = "wallet_" + groupId;
        var data = Storage.readSystemJson(nk, GROUP_WALLETS_COLLECTION, key);
        return data || {};
    }
    function saveGroupWallet(nk, groupId, wallet) {
        var key = "wallet_" + groupId;
        Storage.writeSystemJson(nk, GROUP_WALLETS_COLLECTION, key, wallet);
    }
    function rpcGetGroupWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var wallet = getGroupWallet(nk, groupId);
            return RpcHelpers.successResponse({ wallet: wallet });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get group wallet");
        }
    }
    function rpcUpdateGroupWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var groupId = data.groupId;
            var currencyId = data.currencyId || "game";
            var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
            if (!groupId)
                return RpcHelpers.errorResponse("groupId required");
            var wallet = getGroupWallet(nk, groupId);
            var current = wallet[currencyId] || 0;
            wallet[currencyId] = current + amount;
            saveGroupWallet(nk, groupId, wallet);
            return RpcHelpers.successResponse({ wallet: wallet });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to update group wallet");
        }
    }
    function rpcGetUserGroups(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var limit = data.limit || 100;
            var state = data.state;
            var cursor = data.cursor || "";
            var result = nk.userGroupsList(userId, limit, state, cursor);
            return RpcHelpers.successResponse({
                userGroups: result.userGroups || [],
                cursor: result.cursor || ""
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to list user groups");
        }
    }
    function register(initializer) {
        initializer.registerRpc("create_game_group", rpcCreateGameGroup);
        initializer.registerRpc("update_group_xp", rpcUpdateGroupXp);
        initializer.registerRpc("get_group_wallet", rpcGetGroupWallet);
        initializer.registerRpc("update_group_wallet", rpcUpdateGroupWallet);
        initializer.registerRpc("get_user_groups", rpcGetUserGroups);
    }
    LegacyGroups.register = register;
})(LegacyGroups || (LegacyGroups = {}));
var LegacyLeaderboards;
(function (LegacyLeaderboards) {
    var RESET_SCHEDULES = {
        daily: "0 0 * * *",
        weekly: "0 0 * * 0",
        monthly: "0 0 1 * *",
        alltime: ""
    };
    var PERIODS = ["daily", "weekly", "monthly", "alltime"];
    function ensureLeaderboardExists(nk, logger, leaderboardId, resetSchedule, metadata) {
        try {
            try {
                var existing = nk.leaderboardsGetId([leaderboardId]);
                if (existing && existing.length > 0)
                    return true;
            }
            catch (_) { /* proceed to create */ }
            nk.leaderboardCreate(leaderboardId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, resetSchedule || "", metadata || {});
            logger.info("[LegacyLeaderboards] Created: " + leaderboardId);
            return true;
        }
        catch (err) {
            logger.warn("[LegacyLeaderboards] ensureLeaderboardExists: " + err.message);
            return false;
        }
    }
    function readRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created");
        return data || [];
    }
    function readTimePeriodRegistry(nk) {
        var data = Storage.readSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "time_period_leaderboards");
        return (data && data.leaderboards) ? data.leaderboards : [];
    }
    function getAllLeaderboardIds(nk, logger) {
        var ids = [];
        var registry = readRegistry(nk);
        for (var i = 0; i < registry.length; i++) {
            if (registry[i].leaderboardId)
                ids.push(registry[i].leaderboardId);
        }
        var timeReg = readTimePeriodRegistry(nk);
        for (var j = 0; j < timeReg.length; j++) {
            var lb = timeReg[j];
            if (lb.leaderboardId && ids.indexOf(lb.leaderboardId) === -1)
                ids.push(lb.leaderboardId);
        }
        return ids;
    }
    function writeToAllLeaderboards(nk, logger, userId, username, gameId, score) {
        var updated = [];
        var metadata = { source: "submit_score_and_sync", gameId: gameId, submittedAt: new Date().toISOString() };
        var mainId = "leaderboard_" + gameId;
        if (ensureLeaderboardExists(nk, logger, mainId, "", { scope: "game", gameId: gameId })) {
            try {
                nk.leaderboardRecordWrite(mainId, userId, username, score, 0, metadata);
                updated.push(mainId);
            }
            catch (_) { /* skip */ }
        }
        for (var i = 0; i < PERIODS.length; i++) {
            var period = PERIODS[i];
            var periodId = "leaderboard_" + gameId + "_" + period;
            if (ensureLeaderboardExists(nk, logger, periodId, RESET_SCHEDULES[period], { scope: "game", gameId: gameId, timePeriod: period })) {
                try {
                    nk.leaderboardRecordWrite(periodId, userId, username, score, 0, metadata);
                    updated.push(periodId);
                }
                catch (_) { /* skip */ }
            }
        }
        var globalId = "leaderboard_global";
        if (ensureLeaderboardExists(nk, logger, globalId, "", { scope: "global" })) {
            try {
                nk.leaderboardRecordWrite(globalId, userId, username, score, 0, metadata);
                updated.push(globalId);
            }
            catch (_) { /* skip */ }
        }
        for (var k = 0; k < PERIODS.length; k++) {
            var gp = PERIODS[k];
            var gid = "leaderboard_global_" + gp;
            if (ensureLeaderboardExists(nk, logger, gid, RESET_SCHEDULES[gp], { scope: "global", timePeriod: gp })) {
                try {
                    nk.leaderboardRecordWrite(gid, userId, username, score, 0, metadata);
                    updated.push(gid);
                }
                catch (_) { /* skip */ }
            }
        }
        var allIds = getAllLeaderboardIds(nk, logger);
        for (var m = 0; m < allIds.length; m++) {
            var lbId = allIds[m];
            if (updated.indexOf(lbId) !== -1)
                continue;
            if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
                try {
                    nk.leaderboardRecordWrite(lbId, userId, username, score, 0, metadata);
                    updated.push(lbId);
                }
                catch (_) { /* skip */ }
            }
        }
        return updated;
    }
    function rpcCreateAllLeaderboardsPersistent(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            var existingRecords = readRegistry(nk);
            var existingIds = {};
            for (var i = 0; i < existingRecords.length; i++)
                existingIds[existingRecords[i].leaderboardId] = true;
            var created = [];
            var skipped = [];
            var globalId = "leaderboard_global";
            if (!existingIds[globalId]) {
                try {
                    nk.leaderboardCreate(globalId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, "0 0 * * 0", { scope: "global", desc: "Global Ecosystem Leaderboard" });
                    created.push(globalId);
                    existingRecords.push({ leaderboardId: globalId, scope: "global", createdAt: new Date().toISOString() });
                }
                catch (err) {
                    skipped.push(globalId);
                }
            }
            else {
                skipped.push(globalId);
            }
            var games = data.games || [];
            for (var j = 0; j < games.length; j++) {
                var game = games[j];
                var gid = game.id || game.gameId;
                if (!gid)
                    continue;
                var lbId = "leaderboard_" + gid;
                if (existingIds[lbId]) {
                    skipped.push(lbId);
                    continue;
                }
                try {
                    nk.leaderboardCreate(lbId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, "0 0 * * 0", {
                        desc: "Leaderboard for " + (game.gameTitle || game.name || "Untitled"),
                        gameId: gid,
                        scope: "game"
                    });
                    created.push(lbId);
                    existingRecords.push({ leaderboardId: lbId, gameId: gid, scope: "game", createdAt: new Date().toISOString() });
                }
                catch (err) {
                    skipped.push(lbId);
                }
            }
            Storage.writeSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created", existingRecords);
            return RpcHelpers.successResponse({ created: created, skipped: skipped, totalProcessed: games.length, storedRecords: existingRecords.length });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to create leaderboards");
        }
    }
    function rpcCreateTimePeriodLeaderboards(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            var games = data.games || [];
            var allLeaderboards = [];
            for (var i = 0; i < PERIODS.length; i++) {
                var period = PERIODS[i];
                var gid = "leaderboard_global_" + period;
                try {
                    nk.leaderboardsGetId([gid]);
                }
                catch (_) {
                    try {
                        nk.leaderboardCreate(gid, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, RESET_SCHEDULES[period], { scope: "global", timePeriod: period });
                        allLeaderboards.push({ leaderboardId: gid, period: period, scope: "global" });
                    }
                    catch (e) {
                        logger.warn("[LegacyLeaderboards] create global " + period + ": " + e.message);
                    }
                }
            }
            for (var j = 0; j < games.length; j++) {
                var game = games[j];
                var gameId = game.id || game.gameId;
                if (!gameId)
                    continue;
                for (var k = 0; k < PERIODS.length; k++) {
                    var p = PERIODS[k];
                    var lid = "leaderboard_" + gameId + "_" + p;
                    try {
                        nk.leaderboardsGetId([lid]);
                    }
                    catch (_) {
                        try {
                            nk.leaderboardCreate(lid, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */, RESET_SCHEDULES[p], {
                                gameId: gameId,
                                gameTitle: game.gameTitle || game.name,
                                scope: "game",
                                timePeriod: p
                            });
                            allLeaderboards.push({ leaderboardId: lid, period: p, gameId: gameId });
                        }
                        catch (e) {
                            logger.warn("[LegacyLeaderboards] create " + lid + ": " + e.message);
                        }
                    }
                }
            }
            Storage.writeSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "time_period_leaderboards", {
                leaderboards: allLeaderboards,
                lastUpdated: new Date().toISOString(),
                totalGames: games.length
            });
            return RpcHelpers.successResponse({
                summary: { totalCreated: allLeaderboards.length, gamesProcessed: games.length },
                leaderboards: allLeaderboards
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to create time-period leaderboards");
        }
    }
    function rpcSubmitScoreToTimePeriods(ctx, logger, nk, payload) {
        try {
            if (!ctx.userId)
                return RpcHelpers.errorResponse("Authentication required");
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId || (data.score === undefined || data.score === null))
                return RpcHelpers.errorResponse("gameId and score required");
            var score = parseInt(String(data.score));
            if (isNaN(score))
                return RpcHelpers.errorResponse("Score must be a number");
            var gameId = data.gameId;
            var subscore = parseInt(String(data.subscore)) || 0;
            var metadata = data.metadata || {};
            metadata.submittedAt = new Date().toISOString();
            metadata.gameId = gameId;
            metadata.source = "submit_score_to_time_periods";
            var userId = ctx.userId;
            var username = ctx.username || userId;
            var results = [];
            var errors = [];
            for (var i = 0; i < PERIODS.length; i++) {
                var period = PERIODS[i];
                var lbId = "leaderboard_" + gameId + "_" + period;
                try {
                    nk.leaderboardRecordWrite(lbId, userId, username, score, subscore, metadata);
                    results.push({ leaderboardId: lbId, period: period, scope: "game", success: true });
                }
                catch (e) {
                    errors.push({ leaderboardId: lbId, period: period, error: e.message });
                }
            }
            for (var j = 0; j < PERIODS.length; j++) {
                var p = PERIODS[j];
                var gid = "leaderboard_global_" + p;
                try {
                    nk.leaderboardRecordWrite(gid, userId, username, score, subscore, metadata);
                    results.push({ leaderboardId: gid, period: p, scope: "global", success: true });
                }
                catch (e) {
                    errors.push({ leaderboardId: gid, period: p, error: e.message });
                }
            }
            return RpcHelpers.successResponse({ gameId: gameId, score: score, userId: userId, results: results, errors: errors });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetTimePeriodLeaderboard(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId && data.scope !== "global")
                return RpcHelpers.errorResponse("gameId or scope=global required");
            if (!data.period)
                return RpcHelpers.errorResponse("period required (daily, weekly, monthly, alltime)");
            var period = data.period;
            if (PERIODS.indexOf(period) === -1)
                return RpcHelpers.errorResponse("Invalid period");
            var leaderboardId = data.scope === "global" ? "leaderboard_global_" + period : "leaderboard_" + data.gameId + "_" + period;
            var limit = parseInt(String(data.limit)) || 10;
            var cursor = data.cursor || "";
            var ownerIds = data.ownerIds || null;
            var result = nk.leaderboardRecordsList(leaderboardId, ownerIds, limit, cursor, 0);
            return RpcHelpers.successResponse({
                leaderboardId: leaderboardId,
                period: period,
                gameId: data.gameId,
                scope: data.scope || "game",
                records: result.records || [],
                ownerRecords: result.ownerRecords || [],
                prevCursor: result.prevCursor || "",
                nextCursor: result.nextCursor || "",
                rankCount: result.rankCount || 0
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to fetch leaderboard");
        }
    }
    function rpcSubmitScoreAndSync(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["score", "device_id", "game_id"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var score = parseInt(String(data.score));
            if (isNaN(score))
                return RpcHelpers.errorResponse("Score must be a number");
            var deviceId = data.device_id;
            var gameId = data.game_id;
            var userId = ctx.userId || deviceId;
            var username = ctx.username || "";
            if (!username) {
                try {
                    var users = nk.usersGetId([userId]);
                    if (users && users.length > 0 && users[0].username)
                        username = users[0].username;
                }
                catch (_) { }
            }
            if (!username)
                username = userId;
            var updated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);
            return RpcHelpers.successResponse({
                success: true,
                score: score,
                leaderboards_updated: updated,
                game_id: gameId
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetAllLeaderboards(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.device_id || !data.game_id)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var deviceId = data.device_id;
            var gameId = data.game_id;
            var limit = parseInt(String(data.limit)) || 10;
            var userId = ctx.userId || deviceId;
            var leaderboardIds = [];
            leaderboardIds.push("leaderboard_" + gameId);
            for (var i = 0; i < PERIODS.length; i++) {
                leaderboardIds.push("leaderboard_" + gameId + "_" + PERIODS[i]);
            }
            leaderboardIds.push("leaderboard_global");
            for (var j = 0; j < PERIODS.length; j++) {
                leaderboardIds.push("leaderboard_global_" + PERIODS[j]);
            }
            leaderboardIds.push("leaderboard_friends_" + gameId);
            leaderboardIds.push("leaderboard_friends_global");
            var allIds = getAllLeaderboardIds(nk, logger);
            for (var k = 0; k < allIds.length; k++) {
                var lb = allIds[k];
                if (leaderboardIds.indexOf(lb) === -1 && (lb.indexOf(gameId) !== -1 || lb.indexOf("global") !== -1)) {
                    leaderboardIds.push(lb);
                }
            }
            var leaderboards = {};
            var successCount = 0;
            for (var m = 0; m < leaderboardIds.length; m++) {
                var lbId = leaderboardIds[m];
                try {
                    var recs = nk.leaderboardRecordsList(lbId, null, limit, null, 0);
                    var userRec = null;
                    try {
                        var ur = nk.leaderboardRecordsList(lbId, [userId], 1, null, 0);
                        if (ur && ur.records && ur.records.length > 0)
                            userRec = ur.records[0];
                    }
                    catch (_) { }
                    leaderboards[lbId] = {
                        leaderboard_id: lbId,
                        records: recs.records || [],
                        user_record: userRec,
                        next_cursor: recs.nextCursor || "",
                        prev_cursor: recs.prevCursor || ""
                    };
                    successCount++;
                }
                catch (e) {
                    leaderboards[lbId] = { leaderboard_id: lbId, error: e.message, records: [], user_record: null };
                }
            }
            return RpcHelpers.successResponse({
                device_id: deviceId,
                game_id: gameId,
                leaderboards: leaderboards,
                total_leaderboards: leaderboardIds.length,
                successful_queries: successCount
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to get leaderboards");
        }
    }
    function rpcSubmitLeaderboardScore(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            if (!data.device_id || !data.game_id)
                return RpcHelpers.errorResponse("device_id and game_id required");
            if (data.score === undefined || data.score === null)
                return RpcHelpers.errorResponse("score required");
            var score = Number(data.score);
            if (isNaN(score))
                return RpcHelpers.errorResponse("score must be a number");
            var syncPayload = JSON.stringify({
                device_id: data.device_id,
                game_id: data.game_id,
                score: score,
                metadata: data.metadata || {}
            });
            var resultStr = rpcSubmitScoreAndSync(ctx, logger, nk, syncPayload);
            var result = JSON.parse(resultStr);
            if (!result.success)
                return RpcHelpers.errorResponse("Failed to submit score: " + (result.error || ""));
            return RpcHelpers.successResponse({
                success: true,
                leaderboards_updated: result.data.leaderboards_updated || [],
                score: score,
                message: "Score submitted successfully"
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to submit score");
        }
    }
    function rpcGetLeaderboard(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload || "{}");
            if (!data.game_id)
                return RpcHelpers.errorResponse("game_id required");
            var period = data.period || "alltime";
            var limit = Math.min(Math.max(parseInt(String(data.limit)) || 10, 1), 100);
            var cursor = data.cursor || "";
            var innerPayload = JSON.stringify({
                gameId: data.game_id,
                period: period,
                limit: limit,
                cursor: cursor
            });
            var resultStr = rpcGetTimePeriodLeaderboard(ctx, logger, nk, innerPayload);
            var result = JSON.parse(resultStr);
            if (!result.success)
                return RpcHelpers.errorResponse("Failed to get leaderboard: " + (result.error || ""));
            var lbData = result.data || result;
            return RpcHelpers.successResponse({
                leaderboard_id: lbData.leaderboardId,
                records: lbData.records || [],
                next_cursor: lbData.nextCursor || "",
                prev_cursor: lbData.prevCursor || "",
                period: period,
                game_id: data.game_id
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse(err.message || "Failed to get leaderboard");
        }
    }
    function register(initializer) {
        initializer.registerRpc("create_all_leaderboards_persistent", rpcCreateAllLeaderboardsPersistent);
        initializer.registerRpc("create_time_period_leaderboards", rpcCreateTimePeriodLeaderboards);
        initializer.registerRpc("submit_score_to_time_periods", rpcSubmitScoreToTimePeriods);
        initializer.registerRpc("get_time_period_leaderboard", rpcGetTimePeriodLeaderboard);
        initializer.registerRpc("submit_score_and_sync", rpcSubmitScoreAndSync);
        initializer.registerRpc("get_all_leaderboards", rpcGetAllLeaderboards);
        initializer.registerRpc("submit_leaderboard_score", rpcSubmitLeaderboardScore);
        initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
    }
    LegacyLeaderboards.register = register;
})(LegacyLeaderboards || (LegacyLeaderboards = {}));
var LegacyMissions;
(function (LegacyMissions) {
    function pad2(n) {
        return n < 10 ? "0" + n : String(n);
    }
    function getTodayDateString() {
        var d = new Date();
        return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
    }
    function getDefaultMissions() {
        return [
            { id: "play_3", type: "play_games", description: "Play 3 games", target: 3, progress: 0, completed: false, claimed: false, reward: { game: 30 } },
            { id: "win_1", type: "win_games", description: "Win 1 game", target: 1, progress: 0, completed: false, claimed: false, reward: { tokens: 15 } },
            { id: "correct_10", type: "correct_answers", description: "Get 10 correct answers", target: 10, progress: 0, completed: false, claimed: false, reward: { xp: 25 } }
        ];
    }
    function getMissionsForUser(nk, userId, date) {
        var key = "daily_" + userId + "_" + date;
        var data = Storage.readJson(nk, Constants.MISSIONS_COLLECTION, key, userId);
        if (!data || data.date !== date) {
            return { missions: getDefaultMissions(), date: date };
        }
        return data;
    }
    function saveMissions(nk, userId, data) {
        var key = "daily_" + userId + "_" + data.date;
        Storage.writeJson(nk, Constants.MISSIONS_COLLECTION, key, userId, data);
    }
    function rpcGetDailyMissions(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var today = getTodayDateString();
        var data = getMissionsForUser(nk, userId, today);
        return RpcHelpers.successResponse({ missions: data.missions, date: data.date });
    }
    function rpcSubmitProgress(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.missionId || data.amount === undefined) {
            return RpcHelpers.errorResponse("missionId and amount required");
        }
        var today = getTodayDateString();
        var missionsData = getMissionsForUser(nk, userId, today);
        var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });
        if (!mission) {
            return RpcHelpers.errorResponse("Mission not found");
        }
        if (mission.completed && mission.claimed) {
            return RpcHelpers.successResponse({ mission: mission, alreadyComplete: true });
        }
        var amount = Math.max(0, Number(data.amount) || 0);
        if (mission.type === "play_games" || mission.type === "win_games" || mission.type === "correct_answers") {
            mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
            mission.completed = mission.progress >= mission.target;
        }
        else {
            mission.progress = Math.min(mission.target, (mission.progress || 0) + amount);
            mission.completed = mission.progress >= mission.target;
        }
        saveMissions(nk, userId, missionsData);
        return RpcHelpers.successResponse({ mission: mission });
    }
    function rpcClaimReward(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.missionId)
            return RpcHelpers.errorResponse("missionId required");
        var gameId = data.gameId || "default";
        var today = getTodayDateString();
        var missionsData = getMissionsForUser(nk, userId, today);
        var mission = missionsData.missions.find(function (m) { return m.id === data.missionId; });
        if (!mission) {
            return RpcHelpers.errorResponse("Mission not found");
        }
        if (!mission.completed) {
            return RpcHelpers.errorResponse("Mission not completed");
        }
        if (mission.claimed) {
            return RpcHelpers.errorResponse("Reward already claimed");
        }
        var reward = mission.reward || {};
        if (reward.game && reward.game > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "game", reward.game);
        }
        if (reward.tokens && reward.tokens > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "tokens", reward.tokens);
        }
        if (reward.xp && reward.xp > 0) {
            WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, "xp", reward.xp);
        }
        mission.claimed = true;
        saveMissions(nk, userId, missionsData);
        try {
            var syncUrl = data.syncUrl;
            if (syncUrl && typeof syncUrl === "string") {
                HttpClient.post(nk, syncUrl, JSON.stringify({
                    userId: userId,
                    missionId: mission.id,
                    reward: reward
                }));
            }
        }
        catch (_) { }
        var missionRewardTotal = (reward.game || 0) + (reward.tokens || 0);
        if (missionRewardTotal > 0) {
            try {
                var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
                var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";
                var qeGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || "f6f7fe36-03de-43b8-8b5d-1a1892da4eed";
                var syncBody = JSON.stringify({ amount: missionRewardTotal, sourceType: "mission_reward", sourceId: "mission:" + mission.id, description: "Mission reward claimed" });
                var sigBytes = nk.hmacSha256Hash(webhookSecret, syncBody);
                var sig = nk.binaryToString(sigBytes);
                nk.httpRequest(questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/wallet/earn", "post", { "Content-Type": "application/json", "X-Source": "nakama-rpc", "X-Webhook-Signature": sig, "X-User-Id": userId, "X-Game-Id": qeGameId }, syncBody);
            }
            catch (_) { }
        }
        return RpcHelpers.successResponse({ mission: mission, reward: reward });
    }
    function register(initializer) {
        initializer.registerRpc("get_daily_missions", rpcGetDailyMissions);
        initializer.registerRpc("submit_mission_progress", rpcSubmitProgress);
        initializer.registerRpc("claim_mission_reward", rpcClaimReward);
    }
    LegacyMissions.register = register;
})(LegacyMissions || (LegacyMissions = {}));
var LegacyMultiGame;
(function (LegacyMultiGame) {
    function gameRpcHandler(gameId, handler) {
        return function (ctx, logger, nk, payload) {
            try {
                var userId = RpcHelpers.requireUserId(ctx);
                var data = RpcHelpers.parseRpcPayload(payload);
                var result = handler(ctx, logger, nk, data, userId, gameId);
                return RpcHelpers.successResponse(result);
            }
            catch (err) {
                return RpcHelpers.errorResponse(err.message);
            }
        };
    }
    function updateUserProfile(ctx, logger, nk, data, userId, gId) {
        var metadata = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId) || {};
        if (data.displayName)
            metadata.displayName = data.displayName;
        if (data.avatarUrl)
            metadata.avatarUrl = data.avatarUrl;
        if (data.level !== undefined)
            metadata.level = data.level;
        Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
        return { metadata: metadata };
    }
    function grantCurrency(ctx, logger, nk, data, userId, gId) {
        var wallet = WalletHelpers.addCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
        return { wallet: wallet.currencies };
    }
    function spendCurrency(ctx, logger, nk, data, userId, gId) {
        var wallet = WalletHelpers.spendCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
        return { wallet: wallet.currencies };
    }
    function validatePurchase(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId || !data.price)
            throw new Error("itemId and price required");
        var canAfford = WalletHelpers.hasCurrency(nk, userId, gId, data.currencyId || "game", data.price);
        return { valid: canAfford, itemId: data.itemId, price: data.price };
    }
    function listInventory(ctx, logger, nk, data, userId, gId) {
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        return inv;
    }
    function grantItem(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId)
            throw new Error("itemId required");
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        if (!inv.items[data.itemId])
            inv.items[data.itemId] = { count: 0 };
        inv.items[data.itemId].count += (data.count || 1);
        Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
        return { item: inv.items[data.itemId] };
    }
    function consumeItem(ctx, logger, nk, data, userId, gId) {
        if (!data.itemId)
            throw new Error("itemId required");
        var inv = Storage.readJson(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
        var item = inv.items[data.itemId];
        if (!item || item.count < (data.count || 1))
            throw new Error("Insufficient items");
        item.count -= (data.count || 1);
        if (item.count <= 0)
            delete inv.items[data.itemId];
        Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
        return { success: true };
    }
    function submitScore(ctx, logger, nk, data, userId, gId) {
        if (data.score === undefined)
            throw new Error("score required");
        var lbId = gId + "_leaderboard";
        try {
            nk.leaderboardCreate(lbId, false, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */);
        }
        catch (_) { }
        nk.leaderboardRecordWrite(lbId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, "best" /* nkruntime.OverrideOperator.BEST */);
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, { userId: userId, gameId: gId, score: data.score });
        return { success: true };
    }
    function getLeaderboard(ctx, logger, nk, data, userId, gId) {
        var lbId = gId + "_leaderboard";
        var limit = data.limit || 20;
        var records = nk.leaderboardRecordsList(lbId, [], limit, data.cursor || undefined, 0);
        return { records: records.records || [], ownerRecords: records.ownerRecords || [] };
    }
    function joinOrCreateMatch(ctx, logger, nk, data, userId, gId) {
        return { success: true, message: "Matchmaking handled by client" };
    }
    function claimDailyReward(ctx, logger, nk, data, userId, gId) {
        var key = "daily_" + gId + "_" + userId;
        var state = Storage.readJson(nk, "daily_rewards", key, userId) || { lastClaimDate: "", streak: 0 };
        var today = new Date().toISOString().slice(0, 10);
        if (state.lastClaimDate === today)
            return { alreadyClaimed: true, streak: state.streak };
        state.streak = state.lastClaimDate ? state.streak + 1 : 1;
        if (state.streak > 7)
            state.streak = 1;
        state.lastClaimDate = today;
        var rewardAmount = state.streak * 10;
        WalletHelpers.addCurrency(nk, logger, ctx, userId, gId, "game", rewardAmount);
        Storage.writeJson(nk, "daily_rewards", key, userId, state);
        return { streak: state.streak, reward: rewardAmount };
    }
    // ⚠ DEAD CODE — superseded by src/friends/find_friends.ts ⚠
    // The per-game `<game>_find_friends` registration has been removed in
    // favour of the canonical cross-game `intelliverse_find_friends` RPC.
    // The function body is kept only so the surrounding namespace continues
    // to compile (TS6133 unused-warning is OK because this is in an outFile
    // bundle). It is no longer reachable from any registered RPC.
    // DO NOT MODIFY. Make changes in src/friends/find_friends.ts.
    function findFriends(ctx, logger, nk, data, userId, gId) {
        var query = (data.query || "").trim();
        if (query.length < 1)
            throw new Error("Query must be at least 1 character");
        if (query.length > 50)
            query = query.substring(0, 50);
        var limit = parseInt(data.limit) || 20;
        if (limit < 1)
            limit = 1;
        if (limit > 100)
            limit = 100;
        // Escape SQL ILIKE wildcard characters in user input
        var safeQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
        // SQL search: prefix match for 1-char, contains match for 2+
        var sqlPattern = query.length === 1 ? (safeQuery + "%") : ("%" + safeQuery + "%");
        var rows = [];
        try {
            rows = nk.sqlQuery("SELECT id, username, display_name, avatar_url, create_time " +
                "FROM users " +
                "WHERE (username ILIKE $1 OR display_name ILIKE $1) " +
                "AND id != $2 " +
                "AND disable_time = '1970-01-01 00:00:00 UTC' " +
                "ORDER BY username ASC LIMIT $3", [sqlPattern, userId, limit]);
        }
        catch (sqlErr) {
            logger.warn("findFriends SQL error: " + sqlErr.message);
        }
        // Build relationship map
        var relationMap = {};
        try {
            var friendsResult = nk.friendsList(userId, 1000, 0, "");
            (friendsResult.friends || []).forEach(function (fr) {
                var fid = fr.user.userId || fr.user.id;
                if (fr.state === 0)
                    relationMap[fid] = "friend";
                else if (fr.state === 1)
                    relationMap[fid] = "pending_sent";
                else if (fr.state === 2)
                    relationMap[fid] = "pending_received";
                else if (fr.state === 3)
                    relationMap[fid] = "blocked";
            });
        }
        catch (e) { /* continue without relationship data */ }
        var results = rows.filter(function (r) { return r.id !== userId; }).map(function (r) {
            return {
                userId: r.id,
                username: r.username || "",
                displayName: r.display_name || r.username || "",
                avatarUrl: r.avatar_url || "",
                online: false,
                relationshipStatus: relationMap[r.id] || "none"
            };
        });
        return { success: true, data: { results: results, query: query, count: results.length, searcherId: userId } };
    }
    function savePlayerData(ctx, logger, nk, data, userId, gId) {
        if (!data.data)
            throw new Error("data required");
        Storage.writeJson(nk, "player_data", gId + "_save", userId, data.data);
        return { success: true };
    }
    function loadPlayerData(ctx, logger, nk, data, userId, gId) {
        var saved = Storage.readJson(nk, "player_data", gId + "_save", userId);
        return { data: saved || {} };
    }
    function getItemCatalog(ctx, logger, nk, data, userId, gId) {
        var catalog = Storage.readSystemJson(nk, "game_catalogs", gId + "_catalog");
        return catalog || { items: [] };
    }
    function searchItems(ctx, logger, nk, data, userId, gId) {
        var catalog = Storage.readSystemJson(nk, "game_catalogs", gId + "_catalog") || { items: [] };
        var query = (data.query || "").toLowerCase();
        var results = catalog.items.filter(function (item) {
            return item.name && item.name.toLowerCase().indexOf(query) >= 0;
        });
        return { items: results };
    }
    function getQuizCategories(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_quiz_categories");
        return config || { categories: [] };
    }
    function getWeaponStats(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_weapon_stats");
        return config || { weapons: [] };
    }
    function refreshServerCache(ctx, logger, nk, data, userId, gId) {
        ConfigLoader.invalidateCache();
        return { success: true };
    }
    function guildCreate(ctx, logger, nk, data, userId, gId) {
        if (!data.name)
            throw new Error("name required");
        var group = nk.groupCreate(userId, data.name, userId, gId, data.description || "", data.avatarUrl || "", false, {}, data.maxMembers || 50);
        return { groupId: group.id, name: data.name };
    }
    function guildJoin(ctx, logger, nk, data, userId, gId) {
        if (!data.groupId)
            throw new Error("groupId required");
        nk.groupUserJoin(data.groupId, userId, ctx.username || "");
        return { success: true };
    }
    function guildLeave(ctx, logger, nk, data, userId, gId) {
        if (!data.groupId)
            throw new Error("groupId required");
        nk.groupUserLeave(data.groupId, userId, ctx.username || "");
        return { success: true };
    }
    function guildList(ctx, logger, nk, data, userId, gId) {
        var groups = nk.groupsList(data.name || "", gId, null, null, data.limit || 20, data.cursor || undefined);
        return { groups: groups.groups || [] };
    }
    function sendChannelMessage(ctx, logger, nk, data, userId, gId) {
        if (!data.channelId || !data.content)
            throw new Error("channelId and content required");
        nk.channelMessageSend(data.channelId, { message: data.content }, userId, ctx.username || "", true);
        return { success: true };
    }
    // ── QuizVerse Game ID (canonical UUID for analytics) ─────────────
    var QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    var MAX_EVENT_NAME_LENGTH = 256;
    var MAX_EVENT_DATA_SIZE = 50; // max top-level keys in eventData
    function getStartOfDay() {
        return new Date().toISOString().slice(0, 10);
    }
    function resolveGameId(gId) {
        return (gId === "quizverse") ? QUIZVERSE_GAME_ID : gId;
    }
    function resolveTimestamp(clientTimestamp) {
        // Prefer client timestamp if valid (within 24h of server time), else use server time
        var serverNow = Date.now();
        var serverUnix = Math.floor(serverNow / 1000);
        if (clientTimestamp && typeof clientTimestamp === "number") {
            // Handle both seconds and milliseconds
            var clientMs = clientTimestamp > 1e12 ? clientTimestamp : clientTimestamp * 1000;
            var drift = Math.abs(clientMs - serverNow);
            // Accept if within 24 hours
            if (drift < 86400000) {
                return { iso: new Date(clientMs).toISOString(), unix: Math.floor(clientMs / 1000) };
            }
        }
        return { iso: new Date(serverNow).toISOString(), unix: serverUnix };
    }
    function validateEventPayload(data) {
        var eventName = data.eventName;
        if (!eventName || typeof eventName !== "string" || eventName.length === 0) {
            return { valid: false, eventName: "", eventData: {}, error: "eventName is required and must be a non-empty string" };
        }
        if (eventName.length > MAX_EVENT_NAME_LENGTH) {
            return { valid: false, eventName: "", eventData: {}, error: "eventName exceeds " + MAX_EVENT_NAME_LENGTH + " characters" };
        }
        var eventData = data.eventData || data.properties || {};
        if (typeof eventData !== "object" || Array.isArray(eventData)) {
            eventData = {};
        }
        // Limit top-level keys to prevent oversized payloads
        var keys = Object.keys(eventData);
        if (keys.length > MAX_EVENT_DATA_SIZE) {
            var trimmed = {};
            for (var i = 0; i < MAX_EVENT_DATA_SIZE; i++) {
                trimmed[keys[i]] = eventData[keys[i]];
            }
            eventData = trimmed;
        }
        return { valid: true, eventName: eventName, eventData: eventData };
    }
    function logEvent(ctx, logger, nk, data, userId, gId) {
        // 1. Validate payload
        var validation = validateEventPayload(data);
        if (!validation.valid) {
            logger.warn("[logEvent] Invalid payload from " + userId + ": " + validation.error);
            return { success: false, error: validation.error };
        }
        var eventName = validation.eventName;
        var eventData = validation.eventData;
        var now = Date.now();
        // 2. Resolve canonical game ID and timestamp
        var canonicalGameId = resolveGameId(gId);
        var ts = resolveTimestamp(data.timestamp);
        // 3. Extract platform from eventData for DAU platform breakdown
        var platform = (eventData.platform || "unknown").toString().toLowerCase();
        // 4. Build event record (dashboard-compatible format)
        var event = {
            userId: userId,
            gameId: canonicalGameId,
            eventName: eventName,
            eventData: eventData,
            timestamp: ts.iso,
            unixTimestamp: ts.unix,
            platform: platform
        };
        // 5. Write to analytics_events (dashboard primary collection) under user
        var userKey = "event_" + userId + "_" + canonicalGameId + "_" + now;
        Storage.writeJson(nk, "analytics_events", userKey, userId, event, 1, 1);
        // 6. Write to analytics_events under SYSTEM_USER (dashboard aggregation)
        var dashKey = "dash_" + getStartOfDay() + "_" + eventName + "_" + now;
        Storage.writeJson(nk, "analytics_events", dashKey, Constants.SYSTEM_USER_ID, event, 0, 0);
        // 7. Also write to legacy collection for backward compat
        var legacyKey = "ev_" + gId + "_" + userId + "_" + now;
        Storage.writeJson(nk, Constants.ANALYTICS_COLLECTION, legacyKey, Constants.SYSTEM_USER_ID, {
            userId: userId, gameId: gId, event: eventName, data: eventData, timestamp: ts.iso
        }, 0, 0);
        // 8. Track DAU (game-level + platform-level + per-platform)
        trackDAUForEvent(nk, userId, canonicalGameId, platform);
        // 9. Track session metrics if session event
        if (eventName === "session_start" || eventName === "session_end") {
            trackSessionForEvent(nk, userId, canonicalGameId, eventName, eventData);
        }
        return { success: true };
    }
    function trackDAUForEvent(nk, userId, gameId, platform) {
        var today = getStartOfDay();
        // Game-level + platform-aggregate + per-platform keys
        var keys = ["dau_" + gameId + "_" + today, "dau_platform_" + today];
        if (platform && platform !== "unknown") {
            keys.push("dau_" + platform + "_" + today);
        }
        for (var k = 0; k < keys.length; k++) {
            try {
                var existing = Storage.readSystemJson(nk, "analytics_dau", keys[k]);
                if (!existing) {
                    existing = { date: today, uniqueUsers: [], count: 0, newUsers: 0 };
                }
                if (!Array.isArray(existing.uniqueUsers)) {
                    existing.uniqueUsers = Array.isArray(existing.users) ? existing.users : [];
                    delete existing.users; // migrate legacy field
                }
                if (existing.uniqueUsers.indexOf(userId) === -1) {
                    existing.uniqueUsers.push(userId);
                    existing.count = existing.uniqueUsers.length;
                    Storage.writeJson(nk, "analytics_dau", keys[k], Constants.SYSTEM_USER_ID, existing, 0, 0);
                }
            }
            catch (e) { /* DAU tracking non-fatal */ }
        }
    }
    function trackSessionForEvent(nk, userId, gameId, eventName, eventData) {
        var sessionKey = "analytics_session_" + userId + "_" + gameId;
        try {
            if (eventName === "session_start") {
                var sessionData = {
                    userId: userId,
                    gameId: gameId,
                    startTime: Math.floor(Date.now() / 1000),
                    startTimestamp: new Date().toISOString(),
                    active: true
                };
                Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, sessionData, 1, 1);
            }
            else if (eventName === "session_end") {
                var existing = Storage.readJson(nk, "analytics_sessions", sessionKey, userId);
                if (existing && existing.active) {
                    existing.endTime = Math.floor(Date.now() / 1000);
                    existing.endTimestamp = new Date().toISOString();
                    existing.duration = existing.endTime - existing.startTime;
                    existing.active = false;
                    var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + existing.startTime;
                    Storage.writeJson(nk, "analytics_session_summaries", summaryKey, userId, existing, 1, 1);
                    aggregateSessionStats(nk, existing.duration);
                    Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, { active: false }, 1, 1);
                }
                else {
                    // Orphaned session_end — no matching session_start (crash recovery)
                    var duration = (eventData && eventData.duration) ? parseInt(eventData.duration, 10) : 0;
                    if (duration > 0) {
                        var orphanKey = "session_orphan_" + userId + "_" + gameId + "_" + Date.now();
                        Storage.writeJson(nk, "analytics_session_summaries", orphanKey, userId, {
                            userId: userId, gameId: gameId, duration: duration,
                            endTimestamp: new Date().toISOString(), orphaned: true
                        }, 1, 1);
                        aggregateSessionStats(nk, duration);
                    }
                }
            }
        }
        catch (e) { /* Session tracking non-fatal */ }
    }
    function aggregateSessionStats(nk, durationSeconds) {
        var today = getStartOfDay();
        var statsKey = "session_stats_" + today;
        var stats = Storage.readSystemJson(nk, "analytics_sessions", statsKey);
        if (!stats) {
            stats = { date: today, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
        }
        stats.totalSessions++;
        stats.totalDuration += (durationSeconds || 0);
        stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;
        Storage.writeJson(nk, "analytics_sessions", statsKey, Constants.SYSTEM_USER_ID, stats, 0, 0);
    }
    function trackSessionStart(ctx, logger, nk, data, userId, gId) {
        var canonicalGameId = resolveGameId(gId);
        // Extract device info (store full details, not just platform)
        var platform = (data.platform || "unknown").toString().toLowerCase();
        var deviceInfo = data.deviceInfo || {};
        // Write to analytics_sessions (dashboard-readable)
        var sessionData = {
            userId: userId,
            gameId: canonicalGameId,
            startTime: Math.floor(Date.now() / 1000),
            startTimestamp: new Date().toISOString(),
            active: true,
            platform: platform,
            deviceModel: deviceInfo.deviceModel || "unknown",
            operatingSystem: deviceInfo.operatingSystem || "unknown",
            appVersion: deviceInfo.version || "unknown"
        };
        var sessionKey = "analytics_session_" + userId + "_" + canonicalGameId;
        Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, sessionData, 1, 1);
        // Also write to legacy "sessions" collection for backward compat
        var legacyKey = "session_" + gId + "_" + userId;
        Storage.writeJson(nk, "sessions", legacyKey, userId, { gameId: gId, startedAt: new Date().toISOString(), platform: data.platform });
        // Track DAU (game-level + platform-level + per-platform)
        trackDAUForEvent(nk, userId, canonicalGameId, platform);
        EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_START, { userId: userId, gameId: canonicalGameId });
        return { success: true };
    }
    function trackSessionEnd(ctx, logger, nk, data, userId, gId) {
        var canonicalGameId = resolveGameId(gId);
        // Update analytics_sessions with end data
        var sessionKey = "analytics_session_" + userId + "_" + canonicalGameId;
        try {
            var existing = Storage.readJson(nk, "analytics_sessions", sessionKey, userId);
            if (existing && existing.active) {
                existing.endTime = Math.floor(Date.now() / 1000);
                existing.endTimestamp = new Date().toISOString();
                existing.duration = data.duration || (existing.endTime - existing.startTime);
                existing.active = false;
                // Save session summary
                var summaryKey = "session_summary_" + userId + "_" + canonicalGameId + "_" + existing.startTime;
                Storage.writeJson(nk, "analytics_session_summaries", summaryKey, userId, existing, 1, 1);
                aggregateSessionStats(nk, existing.duration);
                // Clear active session
                Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, { active: false }, 1, 1);
            }
            else {
                // Orphaned session end — no matching start (app crash, server restart, etc.)
                var duration = data.duration || 0;
                if (duration > 0) {
                    var orphanKey = "session_orphan_" + userId + "_" + canonicalGameId + "_" + Date.now();
                    Storage.writeJson(nk, "analytics_session_summaries", orphanKey, userId, {
                        userId: userId, gameId: canonicalGameId, duration: duration,
                        endTimestamp: new Date().toISOString(), orphaned: true
                    }, 1, 1);
                    aggregateSessionStats(nk, duration);
                }
            }
        }
        catch (e) { /* Session end tracking non-fatal */ }
        EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, { userId: userId, gameId: canonicalGameId, duration: data.duration });
        return { success: true };
    }
    function getServerConfig(ctx, logger, nk, data, userId, gId) {
        var config = Storage.readSystemJson(nk, "game_configs", gId + "_server_config");
        return config || {};
    }
    function adminGrantItem(ctx, logger, nk, data, userId, gId) {
        var targetUserId = data.targetUserId || userId;
        return grantItem(ctx, logger, nk, data, targetUserId, gId);
    }
    function registerGameRpcs(initializer, prefix, gameId) {
        initializer.registerRpc(prefix + "update_user_profile", gameRpcHandler(gameId, updateUserProfile));
        initializer.registerRpc(prefix + "grant_currency", gameRpcHandler(gameId, grantCurrency));
        initializer.registerRpc(prefix + "spend_currency", gameRpcHandler(gameId, spendCurrency));
        initializer.registerRpc(prefix + "validate_purchase", gameRpcHandler(gameId, validatePurchase));
        initializer.registerRpc(prefix + "list_inventory", gameRpcHandler(gameId, listInventory));
        initializer.registerRpc(prefix + "grant_item", gameRpcHandler(gameId, grantItem));
        initializer.registerRpc(prefix + "consume_item", gameRpcHandler(gameId, consumeItem));
        initializer.registerRpc(prefix + "submit_score", gameRpcHandler(gameId, submitScore));
        initializer.registerRpc(prefix + "get_leaderboard", gameRpcHandler(gameId, getLeaderboard));
        initializer.registerRpc(prefix + "join_or_create_match", gameRpcHandler(gameId, joinOrCreateMatch));
        initializer.registerRpc(prefix + "claim_daily_reward", gameRpcHandler(gameId, claimDailyReward));
        // ── REMOVED (HARD RENAME) ───────────────────────────────────────────
        //   The per-game `<game>_find_friends` registration was here. It has
        //   been replaced by the cross-game `intelliverse_find_friends` RPC,
        //   registered in main.ts via IntelliverseFriends.register().
        //   Implementation: src/friends/find_friends.ts
        //
        //   The literal registration line has been DELETED (not just commented)
        //   because postbuild.js performs text-based pattern matching for
        //   dynamic RPC suffixes — even inside `//` comments — which would
        //   re-emit `quizverse_find_friends` and `lasttolive_find_friends`
        //   into the bundle. See git blame for the original line.
        // ────────────────────────────────────────────────────────────────────
        initializer.registerRpc(prefix + "save_player_data", gameRpcHandler(gameId, savePlayerData));
        initializer.registerRpc(prefix + "load_player_data", gameRpcHandler(gameId, loadPlayerData));
        initializer.registerRpc(prefix + "get_item_catalog", gameRpcHandler(gameId, getItemCatalog));
        initializer.registerRpc(prefix + "search_items", gameRpcHandler(gameId, searchItems));
        initializer.registerRpc(prefix + "refresh_server_cache", gameRpcHandler(gameId, refreshServerCache));
        initializer.registerRpc(prefix + "guild_create", gameRpcHandler(gameId, guildCreate));
        initializer.registerRpc(prefix + "guild_join", gameRpcHandler(gameId, guildJoin));
        initializer.registerRpc(prefix + "guild_leave", gameRpcHandler(gameId, guildLeave));
        initializer.registerRpc(prefix + "guild_list", gameRpcHandler(gameId, guildList));
        initializer.registerRpc(prefix + "send_channel_message", gameRpcHandler(gameId, sendChannelMessage));
        initializer.registerRpc(prefix + "log_event", gameRpcHandler(gameId, logEvent));
        initializer.registerRpc(prefix + "track_session_start", gameRpcHandler(gameId, trackSessionStart));
        initializer.registerRpc(prefix + "track_session_end", gameRpcHandler(gameId, trackSessionEnd));
        initializer.registerRpc(prefix + "get_server_config", gameRpcHandler(gameId, getServerConfig));
        initializer.registerRpc(prefix + "admin_grant_item", gameRpcHandler(gameId, adminGrantItem));
    }
    function register(initializer) {
        registerGameRpcs(initializer, "quizverse_", "quizverse");
        // QuizVerse-specific
        initializer.registerRpc("quizverse_get_quiz_categories", gameRpcHandler("quizverse", getQuizCategories));
        registerGameRpcs(initializer, "lasttolive_", "lasttolive");
        // LastToLive-specific
        initializer.registerRpc("lasttolive_get_weapon_stats", gameRpcHandler("lasttolive", getWeaponStats));
    }
    LegacyMultiGame.register = register;
})(LegacyMultiGame || (LegacyMultiGame = {}));
var LegacyPlayer;
(function (LegacyPlayer) {
    function getPlayerMetadata(nk, userId) {
        var data = Storage.readJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
        return data || {};
    }
    function savePlayerMetadata(nk, userId, metadata) {
        metadata.updatedAt = new Date().toISOString();
        Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
    }
    function rpcGetPlayerPortfolio(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || userId;
        var metadata = getPlayerMetadata(nk, targetUserId);
        var account = nk.accountGetId(targetUserId);
        var user = account.user;
        return RpcHelpers.successResponse({
            userId: targetUserId,
            username: user ? user.username : "",
            displayName: user ? user.displayName : metadata.displayName || "",
            avatarUrl: user ? user.avatarUrl : metadata.avatarUrl || "",
            metadata: metadata,
            createTime: user ? user.createTime : 0
        });
    }
    function rpcUpdatePlayerMetadataUnified(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.displayName !== undefined)
            metadata.displayName = data.displayName;
        if (data.avatarUrl !== undefined)
            metadata.avatarUrl = data.avatarUrl;
        if (data.country !== undefined)
            metadata.country = data.country;
        if (data.language !== undefined)
            metadata.language = data.language;
        if (data.timezone !== undefined)
            metadata.timezone = data.timezone;
        if (data.bio !== undefined)
            metadata.bio = data.bio;
        if (data.favoriteGame !== undefined)
            metadata.favoriteGame = data.favoriteGame;
        if (data.customData !== undefined) {
            if (!metadata.customData)
                metadata.customData = {};
            for (var k in data.customData) {
                metadata.customData[k] = data.customData[k];
            }
        }
        if (data.displayName || data.avatarUrl) {
            try {
                nk.accountUpdateId(userId, null, data.displayName || null, data.avatarUrl || null, null, null, null);
            }
            catch (err) {
                logger.warn("[Player] Failed to update account: " + err.message);
            }
        }
        savePlayerMetadata(nk, userId, metadata);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcChangeUsername(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.username)
            return RpcHelpers.errorResponse("username required");
        try {
            nk.accountUpdateId(userId, data.username, null, null, null, null, null);
            return RpcHelpers.successResponse({ username: data.username });
        }
        catch (err) {
            return RpcHelpers.errorResponse("Failed to change username: " + err.message);
        }
    }
    function rpcGetPlayerMetadata(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || userId;
        var metadata = getPlayerMetadata(nk, targetUserId);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcAdminDeletePlayerMetadata(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.userId)
            return RpcHelpers.errorResponse("userId required");
        Storage.deleteRecord(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", data.userId);
        return RpcHelpers.successResponse({ deleted: true });
    }
    function rpcCheckGeoAndUpdateProfile(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.country)
            metadata.country = data.country;
        if (data.timezone)
            metadata.timezone = data.timezone;
        if (data.language)
            metadata.language = data.language;
        savePlayerMetadata(nk, userId, metadata);
        return RpcHelpers.successResponse({ metadata: metadata });
    }
    function rpcCreateOrSyncUser(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var metadata = getPlayerMetadata(nk, userId);
        if (data.displayName)
            metadata.displayName = data.displayName;
        if (data.avatarUrl)
            metadata.avatarUrl = data.avatarUrl;
        savePlayerMetadata(nk, userId, metadata);
        var account = nk.accountGetId(userId);
        return RpcHelpers.successResponse({
            userId: userId,
            username: account.user ? account.user.username : "",
            metadata: metadata,
            synced: true
        });
    }
    function register(initializer) {
        initializer.registerRpc("get_player_portfolio", rpcGetPlayerPortfolio);
        initializer.registerRpc("rpc_update_player_metadata", rpcUpdatePlayerMetadataUnified);
        initializer.registerRpc("rpc_change_username", rpcChangeUsername);
        initializer.registerRpc("get_player_metadata", rpcGetPlayerMetadata);
        initializer.registerRpc("admin_delete_player_metadata", rpcAdminDeletePlayerMetadata);
        initializer.registerRpc("check_geo_and_update_profile", rpcCheckGeoAndUpdateProfile);
        initializer.registerRpc("create_or_sync_user", rpcCreateOrSyncUser);
    }
    LegacyPlayer.register = register;
})(LegacyPlayer || (LegacyPlayer = {}));
var LegacyPush;
(function (LegacyPush) {
    function getPushTokens(nk, userId) {
        var key = "token_" + userId;
        var data = Storage.readJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId);
        return data || { tokens: [] };
    }
    function savePushTokens(nk, userId, data) {
        var key = "token_" + userId;
        Storage.writeJson(nk, Constants.PUSH_TOKENS_COLLECTION, key, userId, data);
    }
    function rpcPushRegisterToken(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var token = data.token;
            var platform = data.platform || "unknown";
            if (!token)
                return RpcHelpers.errorResponse("token required");
            var tokensData = getPushTokens(nk, userId);
            var now = Math.floor(Date.now() / 1000);
            var existing = tokensData.tokens.find(function (t) { return t.token === token; });
            if (existing) {
                existing.platform = platform;
                existing.updatedAt = now;
            }
            else {
                tokensData.tokens.push({ token: token, platform: platform, updatedAt: now });
            }
            savePushTokens(nk, userId, tokensData);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to register token");
        }
    }
    function rpcPushSendEvent(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || data.targetUserId;
            var subject = data.subject || "push_event";
            var content = data.content || {};
            if (!targetUserId)
                return RpcHelpers.errorResponse("userId required");
            nk.notificationsSend([{
                    userId: targetUserId,
                    subject: subject,
                    content: content,
                    code: data.code || 0,
                    persistent: data.persistent !== false
                }]);
            return RpcHelpers.successResponse({ success: true });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to send event");
        }
    }
    function rpcPushGetEndpoints(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var targetUserId = data.userId || userId;
            var tokensData = getPushTokens(nk, targetUserId);
            var endpoints = tokensData.tokens.map(function (t) {
                return { token: t.token, platform: t.platform };
            });
            return RpcHelpers.successResponse({ endpoints: endpoints });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "Failed to get endpoints");
        }
    }
    function register(initializer) {
        initializer.registerRpc("push_register_token", rpcPushRegisterToken);
        initializer.registerRpc("push_send_event", rpcPushSendEvent);
        initializer.registerRpc("push_get_endpoints", rpcPushGetEndpoints);
    }
    LegacyPush.register = register;
})(LegacyPush || (LegacyPush = {}));
var LegacyQuestsEconomyBridge;
(function (LegacyQuestsEconomyBridge) {
    function getBridgeConfig(nk) {
        var config = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "bridge_config");
        return config || { apiBaseUrl: "https://quests-economy-api.intelliversex.com" };
    }
    function apiCall(nk, endpoint, data) {
        var config = getBridgeConfig(nk);
        var url = config.apiBaseUrl + endpoint;
        if (config.webhookSecret) {
            return HttpClient.signedPost(nk, url, data, config.webhookSecret);
        }
        return HttpClient.postJson(nk, url, data);
    }
    // IntelliDraws RPCs
    function rpcIntelliDrawsList(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var result = apiCall(nk, "/intellidraws/list", { userId: userId });
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws list failed: " + err.message);
        }
    }
    function rpcIntelliDrawsWinners(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/intellidraws/winners", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws winners failed: " + err.message);
        }
    }
    function rpcIntelliDrawsEnter(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            data.userId = userId;
            var result = apiCall(nk, "/intellidraws/enter", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws enter failed: " + err.message);
        }
    }
    function rpcIntelliDrawsPast(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/intellidraws/past", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("IntelliDraws past failed: " + err.message);
        }
    }
    // Conversion ratio RPCs
    function rpcConversionRatioSet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/conversion/ratio/set", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Conversion ratio set failed: " + err.message);
        }
    }
    function rpcConversionRatioGet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/conversion/ratio/get", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Conversion ratio get failed: " + err.message);
        }
    }
    // Game-to-global conversion RPCs
    function rpcGameToGlobalConvert(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            data.userId = userId;
            var result = apiCall(nk, "/wallet/game-to-global", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Game to global convert failed: " + err.message);
        }
    }
    function rpcGameToGlobalPreview(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var result = apiCall(nk, "/wallet/game-to-global/preview", data);
            return RpcHelpers.successResponse(result);
        }
        catch (err) {
            return RpcHelpers.errorResponse("Game to global preview failed: " + err.message);
        }
    }
    function register(initializer) {
        initializer.registerRpc("intellidraws_list", rpcIntelliDrawsList);
        initializer.registerRpc("intellidraws_winners", rpcIntelliDrawsWinners);
        initializer.registerRpc("intellidraws_enter", rpcIntelliDrawsEnter);
        initializer.registerRpc("intellidraws_past", rpcIntelliDrawsPast);
        initializer.registerRpc("game_to_global_convert", rpcGameToGlobalConvert);
        initializer.registerRpc("game_to_global_preview", rpcGameToGlobalPreview);
        initializer.registerRpc("conversion_ratio_set", rpcConversionRatioSet);
        initializer.registerRpc("conversion_ratio_get", rpcConversionRatioGet);
    }
    LegacyQuestsEconomyBridge.register = register;
})(LegacyQuestsEconomyBridge || (LegacyQuestsEconomyBridge = {}));
var LegacyQuiz;
(function (LegacyQuiz) {
    function getStats(nk, userId) {
        return Storage.readJson(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId);
    }
    function saveStats(nk, userId, stats) {
        Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, "stats_" + userId, userId, stats);
    }
    function rpcSubmitResult(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var score = Math.max(0, Number(data.score) || 0);
        var totalQuestions = Math.max(1, Number(data.totalQuestions) || 1);
        var correctAnswers = Math.min(totalQuestions, Math.max(0, Number(data.correctAnswers) || 0));
        var category = data.category || "general";
        var ts = Math.floor(Date.now() / 1000);
        var result = {
            score: score,
            totalQuestions: totalQuestions,
            correctAnswers: correctAnswers,
            category: category,
            timestamp: ts
        };
        var resultKey = "result_" + userId + "_" + ts;
        Storage.writeJson(nk, Constants.QUIZ_RESULTS_COLLECTION, resultKey, userId, result);
        var stats = getStats(nk, userId) || {
            totalGames: 0,
            totalCorrect: 0,
            totalQuestions: 0,
            averageScore: 0,
            lastPlayedAt: 0
        };
        var oldGames = stats.totalGames;
        stats.totalGames += 1;
        stats.totalCorrect += correctAnswers;
        stats.totalQuestions += totalQuestions;
        stats.averageScore = oldGames > 0
            ? Math.round((stats.averageScore * oldGames + score) / stats.totalGames * 100) / 100
            : score;
        stats.lastPlayedAt = ts;
        saveStats(nk, userId, stats);
        EventBus.emit(nk, logger, ctx, EventBus.Events.QUIZ_COMPLETED, {
            userId: userId,
            score: score,
            totalQuestions: totalQuestions,
            correctAnswers: correctAnswers,
            category: category,
            timestamp: ts,
        });
        return RpcHelpers.successResponse({ result: result, stats: stats });
    }
    function rpcGetHistory(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var limit = Math.min(50, Math.max(1, Number(data.limit) || 20));
        var cursor = data.cursor || "";
        var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, limit, cursor);
        var records = listResult.records || [];
        var results = [];
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
                results.push(rec.value);
            }
        }
        results.sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
        return RpcHelpers.successResponse({ results: results, cursor: listResult.cursor });
    }
    function rpcGetStats(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var stats = getStats(nk, userId);
        if (!stats) {
            stats = {
                totalGames: 0,
                totalCorrect: 0,
                totalQuestions: 0,
                averageScore: 0,
                lastPlayedAt: 0
            };
        }
        return RpcHelpers.successResponse({
            totalGames: stats.totalGames,
            totalCorrect: stats.totalCorrect,
            totalQuestions: stats.totalQuestions,
            averageScore: stats.averageScore,
            lastPlayedAt: stats.lastPlayedAt
        });
    }
    function rpcCheckDailyCompletion(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var dateStr = data.date;
        if (!dateStr || typeof dateStr !== "string") {
            var d = new Date();
            var pad2 = function (n) { return n < 10 ? "0" + n : String(n); };
            dateStr = d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
        }
        var listResult = Storage.listUserRecords(nk, Constants.QUIZ_RESULTS_COLLECTION, userId, 100, "");
        var records = listResult.records || [];
        var dayStart = new Date(dateStr).getTime() / 1000;
        var dayEnd = dayStart + 86400;
        var completedToday = false;
        for (var i = 0; i < records.length; i++) {
            var rec = records[i];
            if (rec.key && rec.key.indexOf("result_") === 0 && rec.value) {
                var val = rec.value;
                if (val.timestamp >= dayStart && val.timestamp < dayEnd) {
                    completedToday = true;
                    break;
                }
            }
        }
        return RpcHelpers.successResponse({ date: dateStr, completed: completedToday });
    }
    function register(initializer) {
        initializer.registerRpc("quiz_submit_result", rpcSubmitResult);
        initializer.registerRpc("quiz_get_history", rpcGetHistory);
        initializer.registerRpc("quiz_get_stats", rpcGetStats);
        initializer.registerRpc("quiz_check_daily_completion", rpcCheckDailyCompletion);
    }
    LegacyQuiz.register = register;
})(LegacyQuiz || (LegacyQuiz = {}));
var LegacyWallet;
(function (LegacyWallet) {
    var DEFAULT_REWARD_CONFIG = {
        game_name: "Default",
        score_to_coins_multiplier: 0.1,
        min_score_for_reward: 0,
        max_reward_per_match: 100000,
        currency: "coins",
        bonus_thresholds: [],
        streak_multipliers: {}
    };
    function getGlobalApiConfig(nk) {
        var config = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "wallet_api_config");
        return config && config.url ? config : null;
    }
    function getConversionRatios(nk) {
        var data = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "conversion_rate");
        return (data && data.ratios) ? data.ratios : {};
    }
    function getRewardConfig(nk, gameId) {
        var cfg = Storage.readSystemJson(nk, Constants.WALLETS_COLLECTION, "reward_config_" + gameId);
        if (!cfg)
            return DEFAULT_REWARD_CONFIG;
        return {
            game_name: cfg.game_name || "Default",
            score_to_coins_multiplier: cfg.score_to_coins_multiplier !== undefined ? cfg.score_to_coins_multiplier : 0.1,
            min_score_for_reward: cfg.min_score_for_reward !== undefined ? cfg.min_score_for_reward : 0,
            max_reward_per_match: cfg.max_reward_per_match !== undefined ? cfg.max_reward_per_match : 100000,
            currency: cfg.currency || "coins",
            bonus_thresholds: cfg.bonus_thresholds || [],
            streak_multipliers: cfg.streak_multipliers || {}
        };
    }
    function proxyGlobalApi(nk, logger, userId, endpoint, body, gameId) {
        var config = getGlobalApiConfig(nk);
        if (!config || !config.url) {
            throw new Error("Global wallet API not configured. Store wallet_api_config in wallets collection.");
        }
        var url = config.url.replace(/\/$/, "") + "/game-bridge/s2s/wallet/" + endpoint;
        var bodyStr = JSON.stringify(body || {});
        var headers = {
            "Content-Type": "application/json",
            "X-Source": "nakama-rpc",
            "X-User-Id": userId,
            "X-Game-Id": gameId || config.defaultGameId || "00000000-0000-0000-0000-000000000000"
        };
        if (config.webhookSecret) {
            var sig = nk.hmacSha256Hash(config.webhookSecret, bodyStr);
            headers["X-Webhook-Signature"] = sig;
        }
        return HttpClient.postJson(nk, url, body, headers);
    }
    function getGlobalWallet(nk, userId) {
        var key = "global_" + userId;
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, userId);
        if (!wallet) {
            wallet = { userId: userId, currencies: { global: 0, xut: 0, xp: 0 }, items: {} };
        }
        if (wallet.currencies) {
            if (wallet.currencies.global === undefined)
                wallet.currencies.global = wallet.currencies.xut || 0;
            if (wallet.currencies.xut === undefined)
                wallet.currencies.xut = wallet.currencies.global || 0;
        }
        return wallet;
    }
    function saveGlobalWallet(nk, userId, wallet) {
        var key = "global_" + userId;
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, userId, wallet);
    }
    // ---- RPC implementations ----
    function rpcGetUserWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var userId = ctx.userId || data.userId || data.sub;
            var username = ctx.username || data.username || userId;
            if (!userId)
                return RpcHelpers.errorResponse("User ID required");
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
            if (!registry) {
                registry = {
                    walletId: userId,
                    userId: userId,
                    gamesLinked: [],
                    status: "active",
                    createdAt: new Date().toISOString()
                };
                Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
            }
            return RpcHelpers.successResponse({
                walletId: registry.walletId,
                userId: registry.userId,
                status: registry.status,
                gamesLinked: registry.gamesLinked || [],
                createdAt: registry.createdAt
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_user_wallet failed");
        }
    }
    LegacyWallet.rpcGetUserWallet = rpcGetUserWallet;
    function rpcLinkWalletToGame(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("gameId required");
            var userId = ctx.userId || data.userId || data.sub;
            var username = ctx.username || data.username || userId;
            if (!userId)
                return RpcHelpers.errorResponse("User ID required");
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
            if (!registry) {
                registry = { walletId: userId, userId: userId, gamesLinked: [] };
            }
            if (!registry.gamesLinked)
                registry.gamesLinked = [];
            if (registry.gamesLinked.indexOf(gameId) === -1) {
                registry.gamesLinked.push(gameId);
            }
            Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
            return RpcHelpers.successResponse({
                walletId: registry.walletId,
                gameId: gameId,
                gamesLinked: registry.gamesLinked,
                message: "Game successfully linked to wallet"
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "link_wallet_to_game failed");
        }
    }
    LegacyWallet.rpcLinkWalletToGame = rpcLinkWalletToGame;
    function rpcGetWalletRegistry(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var limit = data.limit || 100;
            var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.WALLETS_COLLECTION, limit, "");
            var wallets = [];
            if (result && result.objects) {
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    if (obj.key && obj.key.indexOf("registry_") === 0 && obj.value) {
                        wallets.push(obj.value);
                    }
                }
            }
            return RpcHelpers.successResponse({ wallets: wallets, count: wallets.length });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_wallet_registry failed");
        }
    }
    LegacyWallet.rpcGetWalletRegistry = rpcGetWalletRegistry;
    function rpcWalletGetAll(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var globalWallet = getGlobalWallet(nk, userId);
            var result = Storage.listUserRecords(nk, Constants.WALLETS_COLLECTION, userId, 100);
            var gameWallets = [];
            var prefix = "wallet_" + userId + "_";
            for (var i = 0; i < result.records.length; i++) {
                var r = result.records[i];
                if (r.key && r.key.indexOf(prefix) === 0 && r.value) {
                    gameWallets.push(r.value);
                }
            }
            return RpcHelpers.successResponse({
                userId: userId,
                globalWallet: globalWallet,
                gameWallets: gameWallets,
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_get_all failed");
        }
    }
    LegacyWallet.rpcWalletGetAll = rpcWalletGetAll;
    function rpcWalletUpdateGlobal(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["currency", "amount", "operation"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var wallet = getGlobalWallet(nk, userId);
            if (!wallet.currencies[data.currency])
                wallet.currencies[data.currency] = 0;
            var op = data.operation;
            var amt = Number(data.amount);
            if (op === "add")
                wallet.currencies[data.currency] += amt;
            else if (op === "subtract") {
                wallet.currencies[data.currency] -= amt;
                if (wallet.currencies[data.currency] < 0)
                    wallet.currencies[data.currency] = 0;
            }
            else
                return RpcHelpers.errorResponse("Invalid operation");
            saveGlobalWallet(nk, userId, wallet);
            return RpcHelpers.successResponse({
                userId: userId,
                currency: data.currency,
                newBalance: wallet.currencies[data.currency],
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_update_global failed");
        }
    }
    LegacyWallet.rpcWalletUpdateGlobal = rpcWalletUpdateGlobal;
    function rpcWalletUpdateGameWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["gameId", "currency", "amount", "operation"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var currency = data.currency;
            var currenciesToUpdate = (currency === "game" || currency === "tokens") ? ["game", "tokens"] : [currency];
            var amt = Number(data.amount);
            var op = data.operation;
            for (var i = 0; i < currenciesToUpdate.length; i++) {
                var c = currenciesToUpdate[i];
                if (wallet.currencies[c] === undefined)
                    wallet.currencies[c] = 0;
                if (op === "add")
                    wallet.currencies[c] += amt;
                else if (op === "subtract") {
                    wallet.currencies[c] -= amt;
                    if (wallet.currencies[c] < 0)
                        wallet.currencies[c] = 0;
                }
                else
                    return RpcHelpers.errorResponse("Invalid operation");
            }
            WalletHelpers.saveGameWallet(nk, wallet);
            return RpcHelpers.successResponse({
                userId: userId,
                gameId: data.gameId,
                currency: currency,
                newBalance: wallet.currencies[currency] || wallet.currencies.game || 0,
                game_balance: wallet.currencies.game || 0,
                currencies: wallet.currencies,
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_update_game_wallet failed");
        }
    }
    LegacyWallet.rpcWalletUpdateGameWallet = rpcWalletUpdateGameWallet;
    function rpcWalletTransferBetweenGameWallets(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["fromGameId", "toGameId", "currency", "amount"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var from = WalletHelpers.getGameWallet(nk, userId, data.fromGameId);
            var to = WalletHelpers.getGameWallet(nk, userId, data.toGameId);
            var amt = Number(data.amount);
            var cur = data.currency;
            var bal = from.currencies[cur] || 0;
            if (bal < amt)
                return RpcHelpers.errorResponse("Insufficient balance in source wallet");
            from.currencies[cur] = bal - amt;
            to.currencies[cur] = (to.currencies[cur] || 0) + amt;
            WalletHelpers.saveGameWallet(nk, from);
            WalletHelpers.saveGameWallet(nk, to);
            return RpcHelpers.successResponse({
                userId: userId,
                fromGameId: data.fromGameId,
                toGameId: data.toGameId,
                currency: cur,
                amount: amt,
                fromBalance: from.currencies[cur],
                toBalance: to.currencies[cur],
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_transfer_between_game_wallets failed");
        }
    }
    LegacyWallet.rpcWalletTransferBetweenGameWallets = rpcWalletTransferBetweenGameWallets;
    function rpcWalletGetBalances(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId)
                return RpcHelpers.errorResponse("gameId required");
            var userId = RpcHelpers.requireUserId(ctx);
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var global = getGlobalWallet(nk, userId);
            var ratios = getConversionRatios(nk);
            var ratio = ratios[data.gameId] || 0;
            var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
            var globalBal = global.currencies.global || global.currencies.xut || 0;
            var globalEquivalent = ratio > 0 ? Math.floor(gameBal / ratio) : 0;
            return RpcHelpers.successResponse({
                userId: userId,
                gameId: data.gameId,
                game_balance: gameBal,
                global_balance: globalBal,
                currencies: wallet.currencies,
                conversion: { ratio: ratio, globalEquivalent: globalEquivalent, canConvert: ratio > 0 && gameBal >= ratio, minConvertAmount: ratio },
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_get_balances failed");
        }
    }
    LegacyWallet.rpcWalletGetBalances = rpcWalletGetBalances;
    function rpcWalletConvertPreview(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.gameId)
                return RpcHelpers.errorResponse("gameId required");
            var userId = RpcHelpers.requireUserId(ctx);
            var ratios = getConversionRatios(nk);
            var ratio = ratios[data.gameId] || 0;
            if (ratio <= 0)
                return RpcHelpers.errorResponse("No conversion ratio configured for game");
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
            var reqAmt = data.amount != null ? Number(data.amount) : gameBal;
            if (reqAmt <= 0)
                return RpcHelpers.errorResponse("No game coins to convert");
            var globalYield = Math.floor(reqAmt / ratio);
            var coinsUsed = globalYield * ratio;
            var coinsLeft = reqAmt - coinsUsed;
            return RpcHelpers.successResponse({
                userId: userId,
                gameId: data.gameId,
                gameBalance: gameBal,
                requestedAmount: reqAmt,
                ratio: ratio,
                globalPointsYield: globalYield,
                coinsUsed: coinsUsed,
                coinsLeftOver: coinsLeft,
                canConvert: gameBal >= ratio,
                minConvertAmount: ratio,
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_convert_preview failed");
        }
    }
    LegacyWallet.rpcWalletConvertPreview = rpcWalletConvertPreview;
    function rpcWalletConvertToGlobal(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var v = RpcHelpers.validatePayload(data, ["gameId", "amount"]);
            if (!v.valid)
                return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));
            var userId = RpcHelpers.requireUserId(ctx);
            var amt = Number(data.amount);
            if (isNaN(amt) || amt <= 0)
                return RpcHelpers.errorResponse("amount must be positive");
            var ratios = getConversionRatios(nk);
            var ratio = ratios[data.gameId] || 0;
            if (ratio <= 0)
                return RpcHelpers.errorResponse("No conversion ratio configured");
            if (amt < ratio)
                return RpcHelpers.errorResponse("Minimum conversion is " + ratio + " game coins");
            var wallet = WalletHelpers.getGameWallet(nk, userId, data.gameId);
            var gameBal = wallet.currencies.game || wallet.currencies.tokens || 0;
            if (gameBal < amt)
                return RpcHelpers.errorResponse("Insufficient game balance");
            var globalEarned = Math.floor(amt / ratio);
            var coinsBurned = globalEarned * ratio;
            var keys = ["game", "tokens"];
            for (var i = 0; i < keys.length; i++) {
                var k = keys[i];
                if (wallet.currencies[k] !== undefined) {
                    wallet.currencies[k] -= coinsBurned;
                    if (wallet.currencies[k] < 0)
                        wallet.currencies[k] = 0;
                }
            }
            WalletHelpers.saveGameWallet(nk, wallet);
            var newGlobal = null;
            try {
                var res = proxyGlobalApi(nk, logger, userId, "earn", {
                    amount: globalEarned,
                    sourceType: "game_to_global_conversion",
                    sourceId: data.gameId,
                    description: "Converted " + coinsBurned + " game coins -> " + globalEarned + " global points"
                }, data.gameId);
                newGlobal = res && res.newBalance != null ? res.newBalance : null;
            }
            catch (_) { /* non-critical */ }
            return RpcHelpers.successResponse({
                userId: userId,
                gameId: data.gameId,
                coinsBurned: coinsBurned,
                globalPointsEarned: globalEarned,
                ratio: ratio,
                newGameBalance: wallet.currencies.game || wallet.currencies.tokens || 0,
                newGlobalBalance: newGlobal,
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_convert_to_global failed");
        }
    }
    LegacyWallet.rpcWalletConvertToGlobal = rpcWalletConvertToGlobal;
    function rpcWalletConversionRate(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var ratios = getConversionRatios(nk);
            if (data.gameId) {
                var r = ratios[data.gameId] || 0;
                return RpcHelpers.successResponse({
                    gameId: data.gameId,
                    ratio: r,
                    configured: r > 0,
                    description: r > 0 ? (r + " game coins = 1 global point") : "No conversion configured",
                    timestamp: new Date().toISOString()
                });
            }
            return RpcHelpers.successResponse({ ratios: ratios, timestamp: new Date().toISOString() });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "wallet_conversion_rate failed");
        }
    }
    LegacyWallet.rpcWalletConversionRate = rpcWalletConversionRate;
    function rpcGlobalToGameConvert(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.gameId || "";
            var amt = parseInt(String(data.amount), 10) || 0;
            if (!gameId)
                return RpcHelpers.errorResponse("gameId required");
            if (amt <= 0)
                return RpcHelpers.errorResponse("amount must be > 0");
            proxyGlobalApi(nk, logger, userId, "spend", {
                amount: amt,
                sourceType: "global_to_game_convert",
                sourceId: "game:" + gameId,
                description: "Convert " + amt + " global points to game currency"
            }, gameId);
            var ratios = getConversionRatios(nk);
            var ratio = ratios[gameId] || 100;
            var gameCurrency = amt * ratio;
            var wallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var cur = data.currency || "game";
            wallet.currencies[cur] = (wallet.currencies[cur] || 0) + gameCurrency;
            WalletHelpers.saveGameWallet(nk, wallet);
            return RpcHelpers.successResponse({
                userId: userId,
                gameId: gameId,
                globalPointsSpent: amt,
                gameCurrencyEarned: gameCurrency,
                conversionRatio: ratio,
                timestamp: new Date().toISOString()
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_to_game_convert failed");
        }
    }
    LegacyWallet.rpcGlobalToGameConvert = rpcGlobalToGameConvert;
    function rpcGlobalWalletBalance(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var result = proxyGlobalApi(nk, logger, userId, "balance", {});
            return RpcHelpers.successResponse({ userId: userId, balance: result.balance || result || 0 });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_balance failed");
        }
    }
    LegacyWallet.rpcGlobalWalletBalance = rpcGlobalWalletBalance;
    function rpcGlobalWalletEarn(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.amount || data.amount <= 0)
                return RpcHelpers.errorResponse("amount required and must be > 0");
            var body = {
                amount: data.amount,
                sourceType: data.sourceType || "nakama_rpc",
                sourceId: data.sourceId || ("rpc:" + userId),
                description: data.description || "Earn via Nakama RPC"
            };
            var result = proxyGlobalApi(nk, logger, userId, "earn", body, data.gameId);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_earn failed");
        }
    }
    LegacyWallet.rpcGlobalWalletEarn = rpcGlobalWalletEarn;
    function rpcGlobalWalletSpend(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            if (!data.amount || data.amount <= 0)
                return RpcHelpers.errorResponse("amount required and must be > 0");
            var body = {
                amount: data.amount,
                sourceType: data.sourceType || "nakama_rpc",
                sourceId: data.sourceId || ("rpc:" + userId),
                description: data.description || "Spend via Nakama RPC"
            };
            var result = proxyGlobalApi(nk, logger, userId, "spend", body, data.gameId);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_spend failed");
        }
    }
    LegacyWallet.rpcGlobalWalletSpend = rpcGlobalWalletSpend;
    function rpcGlobalWalletHistory(ctx, logger, nk, payload) {
        try {
            var userId = RpcHelpers.requireUserId(ctx);
            var data = RpcHelpers.parseRpcPayload(payload);
            var body = { page: data.page || 1, limit: data.limit || 20 };
            var result = proxyGlobalApi(nk, logger, userId, "history", body);
            return RpcHelpers.successResponse({ userId: userId, result: result });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "global_wallet_history failed");
        }
    }
    LegacyWallet.rpcGlobalWalletHistory = rpcGlobalWalletHistory;
    function rpcCreatePlayerWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            var key = "registry_" + userId;
            var registry = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID);
            if (!registry) {
                registry = { walletId: userId, userId: userId, gamesLinked: [gameId], status: "active", createdAt: new Date().toISOString() };
                Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
            }
            else if (registry.gamesLinked && registry.gamesLinked.indexOf(gameId) === -1) {
                registry.gamesLinked.push(gameId);
                Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, Constants.SYSTEM_USER_ID, registry);
            }
            return RpcHelpers.successResponse({
                wallet_id: registry.walletId,
                global_wallet_id: userId,
                game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
                global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" },
                message: "Player wallet created successfully"
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "create_player_wallet failed");
        }
    }
    LegacyWallet.rpcCreatePlayerWallet = rpcCreatePlayerWallet;
    function rpcUpdateWalletBalance(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            if (data.balance === undefined || data.balance === null)
                return RpcHelpers.errorResponse("balance required");
            var userId = ctx.userId || deviceId;
            var bal = Number(data.balance);
            if (isNaN(bal) || bal < 0)
                return RpcHelpers.errorResponse("balance must be non-negative");
            var walletType = data.wallet_type || data.walletType || "game";
            if (walletType === "global") {
                var gw = getGlobalWallet(nk, userId);
                gw.currencies.global = gw.currencies.xut = bal;
                saveGlobalWallet(nk, userId, gw);
                return RpcHelpers.successResponse({ wallet_type: "global", balance: bal, message: "Wallet balance updated" });
            }
            else {
                var w = WalletHelpers.getGameWallet(nk, userId, gameId);
                w.currencies.game = w.currencies.tokens = bal;
                WalletHelpers.saveGameWallet(nk, w);
                return RpcHelpers.successResponse({ wallet_type: "game", balance: bal, message: "Wallet balance updated" });
            }
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "update_wallet_balance failed");
        }
    }
    LegacyWallet.rpcUpdateWalletBalance = rpcUpdateWalletBalance;
    function rpcGetWalletBalance(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            return RpcHelpers.successResponse({
                game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
                global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" },
                device_id: deviceId,
                game_id: gameId
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "get_wallet_balance failed");
        }
    }
    LegacyWallet.rpcGetWalletBalance = rpcGetWalletBalance;
    function rpcCreateOrGetWallet(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var deviceId = data.device_id || data.deviceId;
            var gameId = data.game_id || data.gameId;
            if (!deviceId || !gameId)
                return RpcHelpers.errorResponse("device_id and game_id required");
            var userId = ctx.userId || deviceId;
            var gameWallet = WalletHelpers.getGameWallet(nk, userId, gameId);
            var globalWallet = getGlobalWallet(nk, userId);
            return RpcHelpers.successResponse({
                game_wallet: { wallet_id: "wallet_" + userId + "_" + gameId, balance: gameWallet.currencies.game || 0, currency: "game", game_id: gameId },
                global_wallet: { wallet_id: "global_" + userId, balance: globalWallet.currencies.global || 0, currency: "global" }
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "create_or_get_wallet failed");
        }
    }
    LegacyWallet.rpcCreateOrGetWallet = rpcCreateOrGetWallet;
    function calculateScoreReward(nk, gameId, score, currentStreak) {
        var config = getRewardConfig(nk, gameId);
        if (score < config.min_score_for_reward) {
            return {
                reward: 0,
                currency: config.currency,
                bonuses: [],
                details: { reason: "below_minimum", min_required: config.min_score_for_reward }
            };
        }
        var baseReward = Math.floor(score * config.score_to_coins_multiplier);
        var streakMult = 1.0;
        if (currentStreak && config.streak_multipliers) {
            var keys = Object.keys(config.streak_multipliers).map(Number).sort(function (a, b) { return b - a; });
            for (var i = 0; i < keys.length; i++) {
                if (currentStreak >= keys[i]) {
                    streakMult = config.streak_multipliers[keys[i]];
                    break;
                }
            }
        }
        var rewardWithStreak = Math.floor(baseReward * streakMult);
        var bonuses = [];
        var totalBonus = 0;
        if (config.bonus_thresholds) {
            for (var j = 0; j < config.bonus_thresholds.length; j++) {
                var t = config.bonus_thresholds[j];
                if (score >= t.score) {
                    bonuses.push({ type: t.type, amount: t.bonus, threshold: t.score });
                    totalBonus += t.bonus;
                }
            }
        }
        var finalReward = Math.min(rewardWithStreak + totalBonus, config.max_reward_per_match);
        return {
            reward: finalReward,
            currency: config.currency,
            bonuses: bonuses,
            details: {
                game_name: config.game_name,
                score: score,
                base_reward: baseReward,
                multiplier: config.score_to_coins_multiplier,
                streak: currentStreak,
                streak_multiplier: streakMult,
                milestone_bonus: totalBonus,
                final_reward: finalReward,
                capped: finalReward === config.max_reward_per_match
            }
        };
    }
    function rpcCalculateScoreReward(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id || data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            if (data.score === undefined && data.score !== 0)
                return RpcHelpers.errorResponse("score required");
            var score = parseInt(String(data.score), 10) || 0;
            var streak = data.current_streak != null ? parseInt(String(data.current_streak), 10) || 0 : 0;
            var result = calculateScoreReward(nk, gameId, score, streak);
            return RpcHelpers.successResponse({
                reward: result.reward,
                currency: result.currency,
                bonuses: result.bonuses,
                details: result.details
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "calculate_score_reward failed");
        }
    }
    LegacyWallet.rpcCalculateScoreReward = rpcCalculateScoreReward;
    function rpcUpdateGameRewardConfig(ctx, logger, nk, payload) {
        try {
            var data = RpcHelpers.parseRpcPayload(payload);
            var gameId = data.game_id || data.gameId;
            if (!gameId)
                return RpcHelpers.errorResponse("game_id required");
            var config = data.config;
            if (!config)
                return RpcHelpers.errorResponse("config object required");
            if (config.score_to_coins_multiplier === undefined || config.min_score_for_reward === undefined ||
                config.max_reward_per_match === undefined || !config.currency) {
                return RpcHelpers.errorResponse("Invalid config: score_to_coins_multiplier, min_score_for_reward, max_reward_per_match, currency required");
            }
            Storage.writeSystemJson(nk, Constants.WALLETS_COLLECTION, "reward_config_" + gameId, config);
            return RpcHelpers.successResponse({
                game_id: gameId,
                config: config,
                message: "Reward configuration updated successfully"
            });
        }
        catch (e) {
            return RpcHelpers.errorResponse(e.message || "update_game_reward_config failed");
        }
    }
    LegacyWallet.rpcUpdateGameRewardConfig = rpcUpdateGameRewardConfig;
    function register(initializer) {
        initializer.registerRpc("get_user_wallet", rpcGetUserWallet);
        initializer.registerRpc("link_wallet_to_game", rpcLinkWalletToGame);
        initializer.registerRpc("get_wallet_registry", rpcGetWalletRegistry);
        initializer.registerRpc("wallet_get_all", rpcWalletGetAll);
        initializer.registerRpc("wallet_update_global", rpcWalletUpdateGlobal);
        initializer.registerRpc("wallet_update_game_wallet", rpcWalletUpdateGameWallet);
        initializer.registerRpc("wallet_transfer_between_game_wallets", rpcWalletTransferBetweenGameWallets);
        initializer.registerRpc("wallet_get_balances", rpcWalletGetBalances);
        initializer.registerRpc("wallet_convert_preview", rpcWalletConvertPreview);
        initializer.registerRpc("wallet_convert_to_global", rpcWalletConvertToGlobal);
        initializer.registerRpc("wallet_conversion_rate", rpcWalletConversionRate);
        initializer.registerRpc("global_to_game_convert", rpcGlobalToGameConvert);
        initializer.registerRpc("global_wallet_balance", rpcGlobalWalletBalance);
        initializer.registerRpc("global_wallet_earn", rpcGlobalWalletEarn);
        initializer.registerRpc("global_wallet_spend", rpcGlobalWalletSpend);
        initializer.registerRpc("global_wallet_history", rpcGlobalWalletHistory);
        initializer.registerRpc("create_player_wallet", rpcCreatePlayerWallet);
        initializer.registerRpc("update_wallet_balance", rpcUpdateWalletBalance);
        initializer.registerRpc("get_wallet_balance", rpcGetWalletBalance);
        initializer.registerRpc("create_or_get_wallet", rpcCreateOrGetWallet);
        initializer.registerRpc("calculate_score_reward", rpcCalculateScoreReward);
        initializer.registerRpc("update_game_reward_config", rpcUpdateGameRewardConfig);
    }
    LegacyWallet.register = register;
})(LegacyWallet || (LegacyWallet = {}));
// =============================================================================
// AnalyticsAlerts — Hardened RPC analytics + Discord summaries for Nakama
// =============================================================================
// Mirrors the Intelliverse-X-AI Tier-3 hardened analytics scheduler:
//   • Auto-instruments every registered RPC (latency + success + error)
//   • In-memory sample buffer flushed to Nakama storage (multi-replica safe)
//   • Cron-aligned 3-hour slot summaries posted to Discord
//   • Multi-replica safe leader election via storageWrite version="*"
//   • Opportunistic scheduling (on RPC) + external CronJob tick RPC
//   • Top-slow / top-error RPC deep-dive in the same payload
//
// All code lives in a single namespace so the TypeScript build (concatenated
// to a single index.js) has zero ordering dependencies.
// =============================================================================
var AnalyticsAlerts;
(function (AnalyticsAlerts) {
    // ---------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------
    var SAMPLE_COLLECTION = "analytics_rpc_samples";
    var STATE_COLLECTION = "analytics_state";
    var LOCK_COLLECTION = "analytics_locks";
    // 3-hour window for general Nakama RPC summary (Intelliverse-X-AI used 3h for AI / 5h for Notes;
    // Nakama RPCs have a more uniform load so a single 3h cadence keeps signal high).
    var SUMMARY_INTERVAL_MS = 3 * 60 * 60 * 1000;
    var SUMMARY_SLOT_KEY = "last_posted_3h";
    // Lock TTL — long enough to cover slot post + flush, short enough to free quickly on crash.
    var LOCK_TTL_MS = 5 * 60 * 1000;
    // In-memory buffer thresholds (per replica).
    var BUFFER_MAX_SIZE = 50;
    var BUFFER_FLUSH_INTERVAL_MS = 30 * 1000;
    // Sample retention — drop anything older than 24h.
    var SAMPLE_RETENTION_MS = 24 * 60 * 60 * 1000;
    // Opportunistic scheduler: at most one tick attempt every 60s per replica.
    var TICK_RATE_LIMIT_MS = 60 * 1000;
    // Deep-dive top-N for slowest / most-errored RPCs.
    var TOP_N = 5;
    // Webhook env var name (set on the Nakama deployment).
    var WEBHOOK_ENV = "DISCORD_NAKAMA_WEBHOOK_URL";
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    // RPC ID prefix → human-readable group label (matches the user request).
    var GROUP_PREFIXES = [
        { prefix: "hiro_", label: "Hiro" },
        { prefix: "satori_", label: "Satori" },
        { prefix: "cricket_", label: "Cricket" },
        { prefix: "creator_event_", label: "CreatorEvents" },
        { prefix: "intellidraws_", label: "IntelliDraws" },
        { prefix: "quizverse_", label: "QuizVerse" },
        { prefix: "quiz_", label: "Quiz" },
        { prefix: "wallet_", label: "Wallet" },
        { prefix: "global_wallet_", label: "Wallet" },
        { prefix: "friends_", label: "Social" },
        { prefix: "groups_", label: "Social" },
        { prefix: "admin_", label: "Admin" },
        { prefix: "analytics_", label: "Analytics" },
        { prefix: "fantasy_", label: "Fantasy" },
        { prefix: "push_", label: "Push" },
        { prefix: "video_", label: "Video" },
        { prefix: "leaderboard_", label: "Leaderboards" },
    ];
    // ---------------------------------------------------------------------------
    // Module-level state (per replica / VM)
    // ---------------------------------------------------------------------------
    var podId = "pod_" + Math.random().toString(36).slice(2, 10) + "_" + Date.now();
    var webhookUrl = "";
    var instrumentationActive = false;
    var buffer = [];
    var lastBufferFlushMs = 0;
    var bufferSeq = 0;
    var lastTickAttemptMs = 0;
    var totalRecorded = 0;
    var totalFlushed = 0;
    var totalErrors = 0;
    // ---------------------------------------------------------------------------
    // Public init — called from InitModule with ctx so we can read env.
    // ---------------------------------------------------------------------------
    function init(ctx, logger) {
        try {
            if (ctx.env && ctx.env[WEBHOOK_ENV]) {
                webhookUrl = ctx.env[WEBHOOK_ENV] || "";
            }
            logger.info("[AnalyticsAlerts] init pod=%s webhook=%s interval=%sms", podId, webhookUrl ? "configured" : "MISSING (" + WEBHOOK_ENV + ")", String(SUMMARY_INTERVAL_MS));
        }
        catch (e) {
            logger.warn("[AnalyticsAlerts] init failed: " + (e && e.message ? e.message : String(e)));
        }
    }
    AnalyticsAlerts.init = init;
    // ---------------------------------------------------------------------------
    // Group resolution
    // ---------------------------------------------------------------------------
    function groupForRpc(rpcId) {
        if (!rpcId)
            return "Other";
        for (var i = 0; i < GROUP_PREFIXES.length; i++) {
            if (rpcId.indexOf(GROUP_PREFIXES[i].prefix) === 0) {
                return GROUP_PREFIXES[i].label;
            }
        }
        return "Other";
    }
    AnalyticsAlerts.groupForRpc = groupForRpc;
    // ---------------------------------------------------------------------------
    // recordSample — buffered per replica, flushed on threshold/interval.
    // ---------------------------------------------------------------------------
    function recordSample(nk, logger, rpc, durMs, ok, err, userId) {
        try {
            var s = {
                ts: Date.now(),
                rpc: rpc,
                group: groupForRpc(rpc),
                durMs: Math.round(durMs),
                ok: ok,
            };
            if (err)
                s.err = String(err).slice(0, 240);
            if (userId)
                s.userId = userId;
            buffer.push(s);
            totalRecorded++;
            var now = Date.now();
            var shouldFlush = buffer.length >= BUFFER_MAX_SIZE
                || (now - lastBufferFlushMs) >= BUFFER_FLUSH_INTERVAL_MS;
            if (shouldFlush) {
                flushBuffer(nk, logger);
            }
            // Opportunistic scheduler — try to post a summary if a slot has just closed.
            if ((now - lastTickAttemptMs) >= TICK_RATE_LIMIT_MS) {
                lastTickAttemptMs = now;
                try {
                    runSchedulerTick(nk, logger);
                }
                catch (_) {
                    // never break the host RPC
                }
            }
        }
        catch (e) {
            // analytics must never throw into the host RPC
            try {
                logger.warn("[AnalyticsAlerts] recordSample swallowed error: " + (e && e.message ? e.message : String(e)));
            }
            catch (_) { }
        }
    }
    AnalyticsAlerts.recordSample = recordSample;
    // ---------------------------------------------------------------------------
    // flushBuffer — writes the in-memory samples to one storage record.
    // Key collision is avoided by including pod id + monotonic sequence.
    // ---------------------------------------------------------------------------
    function flushBuffer(nk, logger) {
        if (buffer.length === 0)
            return;
        var batch = buffer;
        buffer = [];
        lastBufferFlushMs = Date.now();
        bufferSeq++;
        try {
            var key = pad(lastBufferFlushMs) + "_" + podId + "_" + bufferSeq;
            nk.storageWrite([{
                    collection: SAMPLE_COLLECTION,
                    key: key,
                    userId: SYSTEM_USER,
                    value: { samples: batch, podId: podId, ts: lastBufferFlushMs },
                    permissionRead: 0,
                    permissionWrite: 0,
                }]);
            totalFlushed += batch.length;
        }
        catch (e) {
            totalErrors++;
            // restore samples on failure (best-effort)
            try {
                for (var i = 0; i < batch.length && buffer.length < BUFFER_MAX_SIZE * 2; i++) {
                    buffer.push(batch[i]);
                }
            }
            catch (_) { }
            try {
                logger.warn("[AnalyticsAlerts] flushBuffer failed: " + (e && e.message ? e.message : String(e)));
            }
            catch (_) { }
        }
    }
    function pad(n) {
        var s = String(n);
        while (s.length < 14)
            s = "0" + s;
        return s;
    }
    // ---------------------------------------------------------------------------
    // getSamplesInWindow — reads samples from storage between [startMs, endMs).
    // Uses storageList with cursor pagination.
    // ---------------------------------------------------------------------------
    function getSamplesInWindow(nk, startMs, endMs, maxRecords) {
        var out = [];
        var cursor = undefined;
        var pages = 0;
        var maxPages = maxRecords ? Math.ceil(maxRecords / 100) : 200;
        var pageSize = 100;
        do {
            var listResp;
            try {
                listResp = nk.storageList(SYSTEM_USER, SAMPLE_COLLECTION, pageSize, cursor);
            }
            catch (_) {
                break;
            }
            var objects = listResp && listResp.objects ? listResp.objects : [];
            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (!obj || !obj.value)
                    continue;
                var ts = obj.value.ts || 0;
                // Quick filter on flush-time timestamp (samples within a flush are within a 30s window).
                if (ts < startMs - BUFFER_FLUSH_INTERVAL_MS - 5000)
                    continue;
                if (ts >= endMs + BUFFER_FLUSH_INTERVAL_MS + 5000)
                    continue;
                var samples = obj.value.samples || [];
                for (var j = 0; j < samples.length; j++) {
                    var s = samples[j];
                    if (!s || typeof s.ts !== "number")
                        continue;
                    if (s.ts >= startMs && s.ts < endMs)
                        out.push(s);
                }
            }
            cursor = listResp && listResp.cursor ? listResp.cursor : undefined;
            pages++;
        } while (cursor && pages < maxPages);
        return out;
    }
    AnalyticsAlerts.getSamplesInWindow = getSamplesInWindow;
    // ---------------------------------------------------------------------------
    // cleanupOldSamples — deletes records whose flush ts is older than retention.
    // ---------------------------------------------------------------------------
    function cleanupOldSamples(nk, logger) {
        var threshold = Date.now() - SAMPLE_RETENTION_MS;
        var cursor = undefined;
        var deleted = 0;
        var pages = 0;
        do {
            var listResp;
            try {
                listResp = nk.storageList(SYSTEM_USER, SAMPLE_COLLECTION, 100, cursor);
            }
            catch (_) {
                break;
            }
            var objects = listResp && listResp.objects ? listResp.objects : [];
            var toDelete = [];
            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (!obj || !obj.value)
                    continue;
                var ts = obj.value.ts || 0;
                if (ts > 0 && ts < threshold) {
                    toDelete.push({ collection: SAMPLE_COLLECTION, key: obj.key, userId: SYSTEM_USER });
                }
            }
            if (toDelete.length > 0) {
                try {
                    nk.storageDelete(toDelete);
                    deleted += toDelete.length;
                }
                catch (e) {
                    try {
                        logger.warn("[AnalyticsAlerts] cleanup delete failed: " + (e && e.message ? e.message : String(e)));
                    }
                    catch (_) { }
                }
            }
            cursor = listResp && listResp.cursor ? listResp.cursor : undefined;
            pages++;
        } while (cursor && pages < 100);
        return deleted;
    }
    AnalyticsAlerts.cleanupOldSamples = cleanupOldSamples;
    // ---------------------------------------------------------------------------
    // Leader election — multi-replica safe via storageWrite version="*".
    // ---------------------------------------------------------------------------
    function tryAcquireSlotLock(nk, slotIso) {
        var key = "lock_3h_" + slotIso;
        var now = Date.now();
        var lockObj = { holder: podId, expiresAt: now + LOCK_TTL_MS };
        // Fast path: try create-only (version="*") — succeeds only if lock doesn't exist.
        try {
            nk.storageWrite([{
                    collection: LOCK_COLLECTION,
                    key: key,
                    userId: SYSTEM_USER,
                    value: lockObj,
                    permissionRead: 0,
                    permissionWrite: 0,
                    version: "*",
                }]);
            return true;
        }
        catch (_) {
            // existed; check expiry / steal
        }
        // Slow path: read existing lock; if expired, try to steal with the existing version hash.
        try {
            var read = nk.storageRead([{ collection: LOCK_COLLECTION, key: key, userId: SYSTEM_USER }]);
            if (!read || read.length === 0) {
                // race: gone now — try create again
                try {
                    nk.storageWrite([{
                            collection: LOCK_COLLECTION,
                            key: key,
                            userId: SYSTEM_USER,
                            value: lockObj,
                            permissionRead: 0,
                            permissionWrite: 0,
                            version: "*",
                        }]);
                    return true;
                }
                catch (_) {
                    return false;
                }
            }
            var existing = read[0].value || {};
            if (existing.expiresAt && existing.expiresAt > now) {
                // Held and not expired
                return false;
            }
            // Expired — steal with conditional version
            var ver = read[0].version;
            try {
                nk.storageWrite([{
                        collection: LOCK_COLLECTION,
                        key: key,
                        userId: SYSTEM_USER,
                        value: lockObj,
                        permissionRead: 0,
                        permissionWrite: 0,
                        version: ver,
                    }]);
                return true;
            }
            catch (_) {
                return false;
            }
        }
        catch (_) {
            return false;
        }
    }
    AnalyticsAlerts.tryAcquireSlotLock = tryAcquireSlotLock;
    function releaseSlotLock(nk, slotIso) {
        var key = "lock_3h_" + slotIso;
        try {
            nk.storageDelete([{ collection: LOCK_COLLECTION, key: key, userId: SYSTEM_USER }]);
        }
        catch (_) { }
    }
    // ---------------------------------------------------------------------------
    // Last-posted-slot persistence
    // ---------------------------------------------------------------------------
    function recordLastPostedSlot(nk, slotIso) {
        var state = { slotIso: slotIso, postedAt: Date.now(), podId: podId };
        try {
            nk.storageWrite([{
                    collection: STATE_COLLECTION,
                    key: SUMMARY_SLOT_KEY,
                    userId: SYSTEM_USER,
                    value: state,
                    permissionRead: 0,
                    permissionWrite: 0,
                }]);
        }
        catch (_) { }
    }
    function getLastPostedSlot(nk) {
        try {
            var read = nk.storageRead([{ collection: STATE_COLLECTION, key: SUMMARY_SLOT_KEY, userId: SYSTEM_USER }]);
            if (read && read.length > 0 && read[0].value && read[0].value.slotIso) {
                return read[0].value.slotIso;
            }
        }
        catch (_) { }
        return "";
    }
    // ---------------------------------------------------------------------------
    // Slot math — cron-aligned to UTC 00,03,06,09,12,15,18,21
    // ---------------------------------------------------------------------------
    function lastClosedSlotStart(intervalMs, nowMs) {
        return Math.floor(nowMs / intervalMs) * intervalMs - intervalMs;
    }
    AnalyticsAlerts.lastClosedSlotStart = lastClosedSlotStart;
    // ---------------------------------------------------------------------------
    // Stats helpers
    // ---------------------------------------------------------------------------
    function percentile(sortedAsc, p) {
        if (!sortedAsc || sortedAsc.length === 0)
            return 0;
        if (sortedAsc.length === 1)
            return sortedAsc[0];
        var rank = (p / 100) * (sortedAsc.length - 1);
        var lo = Math.floor(rank);
        var hi = Math.ceil(rank);
        if (lo === hi)
            return sortedAsc[lo];
        var w = rank - lo;
        return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
    }
    AnalyticsAlerts.percentile = percentile;
    function latencyStats(samples) {
        if (!samples || samples.length === 0) {
            return { count: 0, avg: 0, p50: 0, p90: 0, p99: 0, max: 0 };
        }
        var arr = [];
        var sum = 0;
        var max = 0;
        for (var i = 0; i < samples.length; i++) {
            var d = samples[i].durMs || 0;
            arr.push(d);
            sum += d;
            if (d > max)
                max = d;
        }
        arr.sort(function (a, b) { return a - b; });
        return {
            count: samples.length,
            avg: Math.round(sum / samples.length),
            p50: Math.round(percentile(arr, 50)),
            p90: Math.round(percentile(arr, 90)),
            p99: Math.round(percentile(arr, 99)),
            max: Math.round(max),
        };
    }
    AnalyticsAlerts.latencyStats = latencyStats;
    // ---------------------------------------------------------------------------
    // Discord summary builder + poster
    // ---------------------------------------------------------------------------
    function fmtMs(n) {
        if (n >= 1000)
            return (n / 1000).toFixed(2) + "s";
        return Math.round(n) + "ms";
    }
    function buildSummaryEmbed(samples, slotStartMs, slotEndMs) {
        var total = samples.length;
        var ok = 0;
        var groupMap = {};
        var rpcMap = {};
        var errMap = {};
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            if (s.ok)
                ok++;
            if (!groupMap[s.group])
                groupMap[s.group] = [];
            groupMap[s.group].push(s);
            if (!rpcMap[s.rpc])
                rpcMap[s.rpc] = [];
            rpcMap[s.rpc].push(s);
            if (!errMap[s.rpc])
                errMap[s.rpc] = { total: 0, failed: 0 };
            errMap[s.rpc].total++;
            if (!s.ok)
                errMap[s.rpc].failed++;
        }
        var overall = latencyStats(samples);
        var successRate = total > 0 ? Math.round((ok / total) * 1000) / 10 : 100;
        var fields = [];
        // Window
        fields.push({
            name: "🕒 Window",
            value: "`" + new Date(slotStartMs).toISOString() + "`\n→ `" +
                new Date(slotEndMs).toISOString() + "`",
            inline: false,
        });
        // Overall
        fields.push({
            name: "📊 Overall",
            value: "Calls: **" + total + "**\n" +
                "Success: **" + successRate + "%**\n" +
                "avg: **" + fmtMs(overall.avg) + "**\n" +
                "p50/p90/p99: " + fmtMs(overall.p50) + " / " + fmtMs(overall.p90) + " / " + fmtMs(overall.p99) + "\n" +
                "max: " + fmtMs(overall.max),
            inline: false,
        });
        // Per-group breakdown (sorted by call count, top 8)
        var groupRows = [];
        for (var g in groupMap) {
            if (groupMap.hasOwnProperty(g))
                groupRows.push({ name: g, samples: groupMap[g], count: groupMap[g].length });
        }
        groupRows.sort(function (a, b) { return b.count - a.count; });
        var top = groupRows.slice(0, 8);
        var groupLines = [];
        for (var k = 0; k < top.length; k++) {
            var st = latencyStats(top[k].samples);
            var okC = 0;
            for (var m = 0; m < top[k].samples.length; m++)
                if (top[k].samples[m].ok)
                    okC++;
            var sr = top[k].count > 0 ? Math.round((okC / top[k].count) * 1000) / 10 : 100;
            groupLines.push("`" + top[k].name + "` " + top[k].count + " calls · " + sr + "% ok · " +
                "p50 " + fmtMs(st.p50) + " / p90 " + fmtMs(st.p90) + " / p99 " + fmtMs(st.p99));
        }
        if (groupLines.length > 0) {
            fields.push({
                name: "🧩 Top Groups",
                value: groupLines.join("\n").slice(0, 1024),
                inline: false,
            });
        }
        // Top slow RPCs (by p99, min 5 calls)
        var rpcRows = [];
        for (var r in rpcMap) {
            if (rpcMap.hasOwnProperty(r) && rpcMap[r].length >= 5) {
                var stats = latencyStats(rpcMap[r]);
                rpcRows.push({ name: r, samples: rpcMap[r], p99: stats.p99, count: rpcMap[r].length });
            }
        }
        rpcRows.sort(function (a, b) { return b.p99 - a.p99; });
        var slowest = rpcRows.slice(0, TOP_N);
        if (slowest.length > 0) {
            var slowLines = [];
            for (var n = 0; n < slowest.length; n++) {
                var st2 = latencyStats(slowest[n].samples);
                slowLines.push("`" + slowest[n].name + "` p99=" + fmtMs(st2.p99) +
                    " p90=" + fmtMs(st2.p90) + " avg=" + fmtMs(st2.avg) + " · " + slowest[n].count + " calls");
            }
            fields.push({
                name: "🐌 Slowest RPCs (p99)",
                value: slowLines.join("\n").slice(0, 1024),
                inline: false,
            });
        }
        // Top error RPCs
        var errRows = [];
        for (var er in errMap) {
            if (errMap.hasOwnProperty(er) && errMap[er].failed > 0) {
                errRows.push({
                    name: er,
                    total: errMap[er].total,
                    failed: errMap[er].failed,
                    rate: errMap[er].total > 0 ? errMap[er].failed / errMap[er].total : 0,
                });
            }
        }
        errRows.sort(function (a, b) { return b.failed - a.failed; });
        var topErr = errRows.slice(0, TOP_N);
        if (topErr.length > 0) {
            var errLines = [];
            for (var p2 = 0; p2 < topErr.length; p2++) {
                var pct = Math.round(topErr[p2].rate * 1000) / 10;
                errLines.push("`" + topErr[p2].name + "` " + topErr[p2].failed + "/" + topErr[p2].total +
                    " failed (" + pct + "%)");
            }
            fields.push({
                name: "💥 Top Error RPCs",
                value: errLines.join("\n").slice(0, 1024),
                inline: false,
            });
        }
        var color = total === 0 ? 0x95a5a6
            : successRate >= 99 ? 0x2ecc71
                : successRate >= 95 ? 0xf1c40f
                    : 0xe74c3c;
        return {
            title: "🎮 Nakama RPC Summary — last 3h",
            description: "Aggregated analytics across all Nakama RPCs.",
            color: color,
            timestamp: new Date().toISOString(),
            footer: { text: "Pod " + podId + " · slot " + new Date(slotStartMs).toISOString() },
            fields: fields,
        };
    }
    function postDiscord(nk, logger, embed) {
        if (!webhookUrl) {
            logger.warn("[AnalyticsAlerts] postDiscord skipped: " + WEBHOOK_ENV + " not set");
            return false;
        }
        try {
            var body = JSON.stringify({ embeds: [embed] });
            var headers = { "Content-Type": "application/json" };
            var resp = nk.httpRequest(webhookUrl, "post", headers, body, 5000);
            var code = resp && resp.code ? resp.code : 0;
            if (code >= 200 && code < 300)
                return true;
            logger.warn("[AnalyticsAlerts] discord post non-2xx: code=" + String(code) +
                " body=" + (resp && resp.body ? String(resp.body).slice(0, 200) : ""));
            return false;
        }
        catch (e) {
            logger.warn("[AnalyticsAlerts] discord post failed: " + (e && e.message ? e.message : String(e)));
            return false;
        }
    }
    // ---------------------------------------------------------------------------
    // postSummaryForSlot — collects samples, builds embed, posts to Discord.
    // Returns true on successful post.
    // ---------------------------------------------------------------------------
    function postSummaryForSlot(nk, logger, slotStartMs) {
        var slotEndMs = slotStartMs + SUMMARY_INTERVAL_MS;
        var samples = getSamplesInWindow(nk, slotStartMs, slotEndMs);
        var embed = buildSummaryEmbed(samples, slotStartMs, slotEndMs);
        var ok = postDiscord(nk, logger, embed);
        if (ok) {
            logger.info("[AnalyticsAlerts] posted 3h summary slot=" +
                new Date(slotStartMs).toISOString() + " samples=" + samples.length);
        }
        return ok;
    }
    AnalyticsAlerts.postSummaryForSlot = postSummaryForSlot;
    // ---------------------------------------------------------------------------
    // runSchedulerTick — opportunistic + leader-elected post for the last closed slot.
    // ---------------------------------------------------------------------------
    function runSchedulerTick(nk, logger) {
        if (!webhookUrl)
            return { posted: false, reason: "webhook_not_configured" };
        var now = Date.now();
        var slotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, now);
        var slotIso = new Date(slotStart).toISOString();
        var lastPosted = getLastPostedSlot(nk);
        if (lastPosted === slotIso) {
            return { posted: false, reason: "already_posted", slotIso: slotIso };
        }
        if (!tryAcquireSlotLock(nk, slotIso)) {
            return { posted: false, reason: "lock_held", slotIso: slotIso };
        }
        // Force flush any in-memory samples so the slot read picks them up.
        try {
            flushBuffer(nk, logger);
        }
        catch (_) { }
        var ok = false;
        try {
            ok = postSummaryForSlot(nk, logger, slotStart);
            if (ok) {
                recordLastPostedSlot(nk, slotIso);
                // Periodic cleanup (cheap, only one replica wins)
                try {
                    cleanupOldSamples(nk, logger);
                }
                catch (_) { }
            }
        }
        finally {
            // Always release the lock so another replica can retry on failure.
            releaseSlotLock(nk, slotIso);
        }
        return { posted: ok, reason: ok ? "posted" : "post_failed", slotIso: slotIso };
    }
    AnalyticsAlerts.runSchedulerTick = runSchedulerTick;
    // ---------------------------------------------------------------------------
    // instrumentInitializer — proxy that wraps every registerRpc with timing.
    // Must be called BEFORE other modules call register(initializer).
    // ---------------------------------------------------------------------------
    function instrumentInitializer(initializer, logger) {
        if (instrumentationActive) {
            // Returning a fresh proxy is harmless but the flag prevents double-counting logs.
        }
        instrumentationActive = true;
        var proxy = Object.create(initializer);
        proxy.registerRpc = function (id, fn) {
            var wrapped = function (ctx, rpcLogger, nk, payload) {
                var start = Date.now();
                var userId;
                try {
                    userId = ctx && ctx.userId ? ctx.userId : undefined;
                }
                catch (_) { }
                try {
                    var out = fn(ctx, rpcLogger, nk, payload);
                    recordSample(nk, rpcLogger, id, Date.now() - start, true, undefined, userId);
                    return out;
                }
                catch (err) {
                    var msg = err && err.message ? err.message : String(err);
                    recordSample(nk, rpcLogger, id, Date.now() - start, false, msg, userId);
                    throw err;
                }
            };
            initializer.registerRpc(id, wrapped);
        };
        logger.info("[AnalyticsAlerts] initializer instrumented — all RPCs will be sampled");
        return proxy;
    }
    AnalyticsAlerts.instrumentInitializer = instrumentInitializer;
    // ---------------------------------------------------------------------------
    // RPC handlers (admin-style; gated by HTTP key via ctx)
    // ---------------------------------------------------------------------------
    function rpcTick(ctx, logger, nk, _payload) {
        var res = runSchedulerTick(nk, logger);
        return JSON.stringify({ success: true, data: res });
    }
    function rpcStatus(_ctx, _logger, nk, _payload) {
        var lastPosted = getLastPostedSlot(nk);
        var nextSlotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, Date.now());
        return JSON.stringify({
            success: true,
            data: {
                podId: podId,
                webhookConfigured: !!webhookUrl,
                intervalMs: SUMMARY_INTERVAL_MS,
                bufferSize: buffer.length,
                bufferMax: BUFFER_MAX_SIZE,
                lastBufferFlushMs: lastBufferFlushMs,
                lastTickAttemptMs: lastTickAttemptMs,
                totalRecorded: totalRecorded,
                totalFlushed: totalFlushed,
                totalErrors: totalErrors,
                lastPostedSlot: lastPosted,
                currentSlotStart: new Date(nextSlotStart).toISOString(),
                currentSlotEnd: new Date(nextSlotStart + SUMMARY_INTERVAL_MS).toISOString(),
                instrumentationActive: instrumentationActive,
            },
        });
    }
    function rpcRecent(_ctx, _logger, nk, payload) {
        var p = {};
        try {
            p = payload ? JSON.parse(payload) : {};
        }
        catch (_) { }
        var minutes = typeof p.minutes === "number" && p.minutes > 0 ? p.minutes : 60;
        var limit = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 5000) : 500;
        var endMs = Date.now();
        var startMs = endMs - minutes * 60 * 1000;
        var samples = getSamplesInWindow(nk, startMs, endMs, limit);
        samples.sort(function (a, b) { return b.ts - a.ts; });
        if (samples.length > limit)
            samples = samples.slice(0, limit);
        return JSON.stringify({ success: true, data: { count: samples.length, samples: samples } });
    }
    function rpcSummary(_ctx, _logger, nk, payload) {
        var p = {};
        try {
            p = payload ? JSON.parse(payload) : {};
        }
        catch (_) { }
        var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
        var endMs = Date.now();
        var startMs = endMs - hours * 60 * 60 * 1000;
        var samples = getSamplesInWindow(nk, startMs, endMs);
        var overall = latencyStats(samples);
        var groupMap = {};
        var rpcMap = {};
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            if (!groupMap[s.group])
                groupMap[s.group] = [];
            groupMap[s.group].push(s);
            if (!rpcMap[s.rpc])
                rpcMap[s.rpc] = [];
            rpcMap[s.rpc].push(s);
        }
        var groupStats = {};
        for (var g in groupMap) {
            if (groupMap.hasOwnProperty(g)) {
                var st = latencyStats(groupMap[g]);
                var okC = 0;
                for (var j = 0; j < groupMap[g].length; j++)
                    if (groupMap[g][j].ok)
                        okC++;
                groupStats[g] = {
                    count: st.count,
                    successRate: groupMap[g].length > 0 ? okC / groupMap[g].length : 1,
                    avg: st.avg, p50: st.p50, p90: st.p90, p99: st.p99, max: st.max,
                };
            }
        }
        var rpcStats = {};
        for (var r in rpcMap) {
            if (rpcMap.hasOwnProperty(r)) {
                var rst = latencyStats(rpcMap[r]);
                var okR = 0;
                for (var k = 0; k < rpcMap[r].length; k++)
                    if (rpcMap[r][k].ok)
                        okR++;
                rpcStats[r] = {
                    count: rst.count,
                    successRate: rpcMap[r].length > 0 ? okR / rpcMap[r].length : 1,
                    avg: rst.avg, p50: rst.p50, p90: rst.p90, p99: rst.p99, max: rst.max,
                };
            }
        }
        return JSON.stringify({
            success: true,
            data: {
                windowHours: hours,
                startIso: new Date(startMs).toISOString(),
                endIso: new Date(endMs).toISOString(),
                overall: overall,
                byGroup: groupStats,
                byRpc: rpcStats,
            },
        });
    }
    function rpcTopSlow(_ctx, _logger, nk, payload) {
        var p = {};
        try {
            p = payload ? JSON.parse(payload) : {};
        }
        catch (_) { }
        var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
        var topN = typeof p.top === "number" && p.top > 0 ? p.top : 10;
        var minCalls = typeof p.minCalls === "number" && p.minCalls >= 1 ? p.minCalls : 5;
        var endMs = Date.now();
        var startMs = endMs - hours * 60 * 60 * 1000;
        var samples = getSamplesInWindow(nk, startMs, endMs);
        var rpcMap = {};
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            if (!rpcMap[s.rpc])
                rpcMap[s.rpc] = [];
            rpcMap[s.rpc].push(s);
        }
        var rows = [];
        for (var r in rpcMap) {
            if (rpcMap.hasOwnProperty(r) && rpcMap[r].length >= minCalls) {
                var st = latencyStats(rpcMap[r]);
                rows.push({ rpc: r, count: st.count, avg: st.avg, p50: st.p50, p90: st.p90, p99: st.p99, max: st.max });
            }
        }
        rows.sort(function (a, b) { return b.p99 - a.p99; });
        return JSON.stringify({ success: true, data: { hours: hours, top: rows.slice(0, topN) } });
    }
    function rpcTopErrors(_ctx, _logger, nk, payload) {
        var p = {};
        try {
            p = payload ? JSON.parse(payload) : {};
        }
        catch (_) { }
        var hours = typeof p.hours === "number" && p.hours > 0 ? p.hours : 3;
        var topN = typeof p.top === "number" && p.top > 0 ? p.top : 10;
        var endMs = Date.now();
        var startMs = endMs - hours * 60 * 60 * 1000;
        var samples = getSamplesInWindow(nk, startMs, endMs);
        var rpcMap = {};
        for (var i = 0; i < samples.length; i++) {
            var s = samples[i];
            if (!rpcMap[s.rpc])
                rpcMap[s.rpc] = { total: 0, failed: 0 };
            rpcMap[s.rpc].total++;
            if (!s.ok) {
                rpcMap[s.rpc].failed++;
                if (s.err)
                    rpcMap[s.rpc].lastErr = s.err;
            }
        }
        var rows = [];
        for (var r in rpcMap) {
            if (rpcMap.hasOwnProperty(r) && rpcMap[r].failed > 0) {
                rows.push({
                    rpc: r,
                    total: rpcMap[r].total,
                    failed: rpcMap[r].failed,
                    errorRate: rpcMap[r].failed / rpcMap[r].total,
                    lastError: rpcMap[r].lastErr || "",
                });
            }
        }
        rows.sort(function (a, b) { return b.failed - a.failed; });
        return JSON.stringify({ success: true, data: { hours: hours, top: rows.slice(0, topN) } });
    }
    function rpcForcePost(_ctx, logger, nk, payload) {
        var p = {};
        try {
            p = payload ? JSON.parse(payload) : {};
        }
        catch (_) { }
        var nowMs = Date.now();
        var slotStart;
        if (typeof p.slotStartMs === "number" && p.slotStartMs > 0) {
            slotStart = p.slotStartMs;
        }
        else if (typeof p.slotStartIso === "string" && p.slotStartIso) {
            slotStart = new Date(p.slotStartIso).getTime();
        }
        else {
            slotStart = lastClosedSlotStart(SUMMARY_INTERVAL_MS, nowMs);
        }
        try {
            flushBuffer(nk, logger);
        }
        catch (_) { }
        var ok = postSummaryForSlot(nk, logger, slotStart);
        return JSON.stringify({
            success: ok,
            data: { slotStartIso: new Date(slotStart).toISOString(), posted: ok },
        });
    }
    // ---------------------------------------------------------------------------
    // register — wires the RPCs (NOT instrumented; analytics RPCs sample themselves
    // would create infinite recursion via opportunistic tick path).
    // ---------------------------------------------------------------------------
    function register(initializer) {
        initializer.registerRpc("nakama_analytics_tick", rpcTick);
        initializer.registerRpc("nakama_analytics_status", rpcStatus);
        initializer.registerRpc("nakama_analytics_recent", rpcRecent);
        initializer.registerRpc("nakama_analytics_summary", rpcSummary);
        initializer.registerRpc("nakama_analytics_top_slow", rpcTopSlow);
        initializer.registerRpc("nakama_analytics_top_errors", rpcTopErrors);
        initializer.registerRpc("nakama_analytics_force_post", rpcForcePost);
    }
    AnalyticsAlerts.register = register;
})(AnalyticsAlerts || (AnalyticsAlerts = {}));
var SatoriAudiences;
(function (SatoriAudiences) {
    function getAudienceDefinitions(nk) {
        var custom = ConfigLoader.loadSatoriConfig(nk, "audiences", {});
        return applyDefaults(custom);
    }
    function applyDefaults(audiences) {
        if (!audiences["new_players"]) {
            audiences["new_players"] = {
                id: "new_players",
                name: "New Players",
                description: "Players who joined in the last 7 days",
                rule: {
                    combinator: "and",
                    filters: [{ property: "first_seen_days_ago", operator: "lte", value: "7" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        if (!audiences["returning_players"]) {
            audiences["returning_players"] = {
                id: "returning_players",
                name: "Returning Players",
                description: "Players with 3+ sessions",
                rule: {
                    combinator: "and",
                    filters: [{ property: "session_count", operator: "gte", value: "3" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        if (!audiences["spenders"]) {
            audiences["spenders"] = {
                id: "spenders",
                name: "Spenders",
                description: "Players who have spent money",
                rule: {
                    combinator: "and",
                    filters: [{ property: "total_spend", operator: "gt", value: "0" }]
                },
                createdAt: 0,
                updatedAt: 0
            };
        }
        return audiences;
    }
    function isInAudience(nk, userId, audienceId) {
        var audiences = getAudienceDefinitions(nk);
        var def = audiences[audienceId];
        if (!def)
            return false;
        if (def.excludeIds && def.excludeIds.indexOf(userId) >= 0)
            return false;
        if (def.includeIds && def.includeIds.indexOf(userId) >= 0)
            return true;
        if (def.samplePct !== undefined && def.samplePct < 100) {
            var hash = 0;
            var seed = userId + ":" + audienceId;
            for (var c = 0; c < seed.length; c++) {
                hash = ((hash << 5) - hash) + seed.charCodeAt(c);
                hash = hash & 0x7FFFFFFF;
            }
            if ((hash % 100) >= def.samplePct)
                return false;
        }
        var props = SatoriIdentities.getAllProperties(nk, userId);
        var allProps = {};
        for (var k in props.defaultProperties)
            allProps[k] = props.defaultProperties[k];
        for (var ck in props.customProperties)
            allProps[ck] = props.customProperties[ck];
        for (var pk in props.computedProperties)
            allProps[pk] = props.computedProperties[pk];
        // Add computed time-based properties
        if (allProps["first_seen"]) {
            var firstSeen = new Date(allProps["first_seen"]).getTime();
            var daysSince = Math.floor((Date.now() - firstSeen) / 86400000);
            allProps["first_seen_days_ago"] = String(daysSince);
        }
        return evaluateRule(allProps, def.rule);
    }
    SatoriAudiences.isInAudience = isInAudience;
    function evaluateRule(props, rule) {
        var results = [];
        if (rule.filters) {
            for (var i = 0; i < rule.filters.length; i++) {
                results.push(evaluateFilter(props, rule.filters[i]));
            }
        }
        if (rule.rules) {
            for (var j = 0; j < rule.rules.length; j++) {
                results.push(evaluateRule(props, rule.rules[j]));
            }
        }
        if (results.length === 0)
            return true;
        if (rule.combinator === "or") {
            for (var r = 0; r < results.length; r++) {
                if (results[r])
                    return true;
            }
            return false;
        }
        for (var a = 0; a < results.length; a++) {
            if (!results[a])
                return false;
        }
        return true;
    }
    function evaluateFilter(props, filter) {
        var propValue = props[filter.property];
        switch (filter.operator) {
            case "exists": return propValue !== undefined && propValue !== null;
            case "not_exists": return propValue === undefined || propValue === null;
            case "eq": return propValue === filter.value;
            case "neq": return propValue !== filter.value;
            case "gt": return parseFloat(propValue || "0") > parseFloat(filter.value);
            case "gte": return parseFloat(propValue || "0") >= parseFloat(filter.value);
            case "lt": return parseFloat(propValue || "0") < parseFloat(filter.value);
            case "lte": return parseFloat(propValue || "0") <= parseFloat(filter.value);
            case "contains": return (propValue || "").indexOf(filter.value) >= 0;
            case "not_contains": return (propValue || "").indexOf(filter.value) < 0;
            case "in": return filter.value.split(",").indexOf(propValue || "") >= 0;
            case "not_in": return filter.value.split(",").indexOf(propValue || "") < 0;
            case "matches":
                try {
                    return new RegExp(filter.value).test(propValue || "");
                }
                catch (_) {
                    return false;
                }
            default: return false;
        }
    }
    // ---- RPCs ----
    function rpcGetMemberships(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var audiences = getAudienceDefinitions(nk);
        var memberships = [];
        for (var id in audiences) {
            if (isInAudience(nk, userId, id)) {
                memberships.push(id);
            }
        }
        return RpcHelpers.successResponse({ audiences: memberships });
    }
    function rpcCompute(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var targetUserId = data.userId || ctx.userId;
        if (!targetUserId)
            return RpcHelpers.errorResponse("userId required");
        var audiences = getAudienceDefinitions(nk);
        var memberships = [];
        for (var id in audiences) {
            if (isInAudience(nk, targetUserId, id)) {
                memberships.push(id);
            }
        }
        return RpcHelpers.successResponse({ userId: targetUserId, audiences: memberships });
    }
    function register(initializer) {
        initializer.registerRpc("satori_audiences_get_memberships", rpcGetMemberships);
        initializer.registerRpc("satori_audiences_compute", rpcCompute);
    }
    SatoriAudiences.register = register;
})(SatoriAudiences || (SatoriAudiences = {}));
var SatoriDataLake;
(function (SatoriDataLake) {
    var DEFAULT_CONFIG = {
        targets: [],
        retentionDays: 90,
        enabledGlobally: false
    };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "data_lake", DEFAULT_CONFIG);
    }
    function buildExportPayload(events) {
        var lines = [];
        for (var i = 0; i < events.length; i++) {
            lines.push(JSON.stringify(events[i]));
        }
        return lines.join("\n");
    }
    function exportBatch(nk, logger, events) {
        var config = getConfig(nk);
        if (!config.enabledGlobally || config.targets.length === 0 || events.length === 0)
            return;
        var payload = buildExportPayload(events);
        for (var i = 0; i < config.targets.length; i++) {
            var target = config.targets[i];
            if (!target.enabled)
                continue;
            try {
                switch (target.type) {
                    case "s3":
                        exportToS3(nk, logger, target, payload);
                        break;
                    case "bigquery":
                        exportToBigQuery(nk, logger, target, events);
                        break;
                    case "snowflake":
                        exportToSnowflake(nk, logger, target, events);
                        break;
                    case "redshift":
                        exportToRedshift(nk, logger, target, events);
                        break;
                }
            }
            catch (e) {
                logger.warn("[DataLake] Export to %s/%s failed: %s", target.type, target.id, e.message || String(e));
            }
        }
    }
    SatoriDataLake.exportBatch = exportBatch;
    function exportToS3(nk, logger, target, payload) {
        var bucket = target.config["bucket"];
        var region = target.config["region"] || "us-east-1";
        var prefix = target.config["prefix"] || "satori-events";
        var endpoint = target.config["endpoint"];
        if (!bucket || !endpoint) {
            logger.warn("[DataLake/S3] Missing bucket or endpoint config for target %s", target.id);
            return;
        }
        var dateStr = new Date().toISOString().slice(0, 10);
        var ts = Date.now();
        var key = prefix + "/" + dateStr + "/" + ts + ".jsonl";
        var url = endpoint + "/" + bucket + "/" + key;
        var headers = {
            "Content-Type": "application/x-ndjson"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        nk.httpRequest(url, "put", headers, payload);
        logger.info("[DataLake/S3] Exported %d bytes to %s", payload.length, key);
    }
    function exportToBigQuery(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/BigQuery] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        var body = JSON.stringify({ rows: events.map(function (e) { return { json: e }; }) });
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/BigQuery] Exported %d events to %s", events.length, target.id);
    }
    function exportToSnowflake(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/Snowflake] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["token"]) {
            headers["Authorization"] = "Snowflake Token=\"" + target.config["token"] + "\"";
        }
        var body = JSON.stringify(events);
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/Snowflake] Exported %d events to %s", events.length, target.id);
    }
    function exportToRedshift(nk, logger, target, events) {
        var endpoint = target.config["endpoint"];
        if (!endpoint) {
            logger.warn("[DataLake/Redshift] Missing endpoint for target %s", target.id);
            return;
        }
        var headers = {
            "Content-Type": "application/json"
        };
        if (target.config["apiKey"]) {
            headers["Authorization"] = "Bearer " + target.config["apiKey"];
        }
        var body = JSON.stringify({ records: events });
        nk.httpRequest(endpoint, "post", headers, body);
        logger.info("[DataLake/Redshift] Exported %d events to %s", events.length, target.id);
    }
    function rpcGetConfig(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var config = getConfig(nk);
        return RpcHelpers.successResponse(config);
    }
    function rpcUpsertTarget(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.type)
            return RpcHelpers.errorResponse("id and type required");
        var validTypes = ["bigquery", "snowflake", "redshift", "s3"];
        if (validTypes.indexOf(data.type) === -1)
            return RpcHelpers.errorResponse("type must be one of: " + validTypes.join(", "));
        var config = getConfig(nk);
        var idx = config.targets.findIndex(function (t) { return t.id === data.id; });
        var target = {
            id: data.id,
            type: data.type,
            enabled: data.enabled !== false,
            config: data.config || {},
            eventFilters: data.eventFilters,
            batchSize: data.batchSize || 100,
            flushIntervalSec: data.flushIntervalSec || 300
        };
        if (idx >= 0) {
            config.targets[idx] = target;
        }
        else {
            config.targets.push(target);
        }
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ target: target });
    }
    function rpcDeleteTarget(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        config.targets = config.targets.filter(function (t) { return t.id !== data.id; });
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ deleted: data.id });
    }
    function rpcSetEnabled(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        config.enabledGlobally = !!data.enabled;
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ enabledGlobally: config.enabledGlobally });
    }
    function rpcSetRetention(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.days || data.days < 1)
            return RpcHelpers.errorResponse("days required (positive integer)");
        var config = getConfig(nk);
        config.retentionDays = data.days;
        ConfigLoader.saveSatoriConfig(nk, "data_lake", config);
        return RpcHelpers.successResponse({ retentionDays: config.retentionDays });
    }
    function rpcManualExport(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var events = [];
        var cursor = "";
        var limit = data.limit || 500;
        var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, limit > 100 ? 100 : limit, cursor);
        if (result.objects) {
            for (var i = 0; i < result.objects.length; i++) {
                events.push(result.objects[i].value);
            }
        }
        if (events.length > 0) {
            exportBatch(nk, logger, events);
        }
        return RpcHelpers.successResponse({ exportedCount: events.length });
    }
    function register(initializer) {
        initializer.registerRpc("satori_datalake_config", rpcGetConfig);
        initializer.registerRpc("satori_datalake_upsert_target", rpcUpsertTarget);
        initializer.registerRpc("satori_datalake_delete_target", rpcDeleteTarget);
        initializer.registerRpc("satori_datalake_set_enabled", rpcSetEnabled);
        initializer.registerRpc("satori_datalake_set_retention", rpcSetRetention);
        initializer.registerRpc("satori_datalake_manual_export", rpcManualExport);
    }
    SatoriDataLake.register = register;
})(SatoriDataLake || (SatoriDataLake = {}));
var SatoriEventCapture;
(function (SatoriEventCapture) {
    function appendToUserHistory(nk, userId, event) {
        var history = Storage.readJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId);
        if (!history)
            history = { events: [] };
        history.events.push({
            name: event.name,
            timestamp: event.timestamp,
            metadata: event.metadata || {}
        });
        if (history.events.length > 500) {
            history.events = history.events.slice(history.events.length - 500);
        }
        Storage.writeJson(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId, history);
    }
    function captureEvent(nk, logger, userId, event) {
        var validation = SatoriTaxonomy.validateEvent(nk, event);
        if (!validation.valid) {
            logger.warn("[EventCapture] Rejected event '%s': %s", event.name, validation.errors.join("; "));
            return;
        }
        var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
        var key = "ev_" + dateStr + "_" + userId + "_" + Date.now();
        var record = {
            userId: userId,
            name: event.name,
            timestamp: event.timestamp,
            metadata: event.metadata || {},
            date: dateStr
        };
        nk.storageWrite([{
                collection: Constants.SATORI_EVENTS_COLLECTION,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            }]);
        appendToUserHistory(nk, userId, event);
        SatoriIdentities.onEvent(nk, logger, userId, event);
        SatoriMetrics.processEvent(nk, logger, userId, event.name, event.metadata || {});
        SatoriWebhooks.dispatch(nk, logger, "event:" + event.name, record);
        SatoriDataLake.exportBatch(nk, logger, [record]);
    }
    SatoriEventCapture.captureEvent = captureEvent;
    function captureEvents(nk, logger, userId, events) {
        var writes = [];
        var validEvents = [];
        var exportRecords = [];
        for (var i = 0; i < events.length; i++) {
            var event = events[i];
            var validation = SatoriTaxonomy.validateEvent(nk, event);
            if (!validation.valid) {
                continue;
            }
            validEvents.push(event);
            var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
            var key = "ev_" + dateStr + "_" + userId + "_" + (Date.now() + i);
            var record = {
                userId: userId,
                name: event.name,
                timestamp: event.timestamp,
                metadata: event.metadata || {},
                date: dateStr
            };
            exportRecords.push(record);
            writes.push({
                collection: Constants.SATORI_EVENTS_COLLECTION,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            });
        }
        if (writes.length > 0) {
            Storage.writeMultiple(nk, writes);
        }
        for (var j = 0; j < validEvents.length; j++) {
            appendToUserHistory(nk, userId, validEvents[j]);
            SatoriIdentities.onEvent(nk, logger, userId, validEvents[j]);
            SatoriMetrics.processEvent(nk, logger, userId, validEvents[j].name, validEvents[j].metadata || {});
            SatoriWebhooks.dispatch(nk, logger, "event:" + validEvents[j].name, exportRecords[j]);
        }
        if (exportRecords.length > 0) {
            SatoriDataLake.exportBatch(nk, logger, exportRecords);
        }
    }
    SatoriEventCapture.captureEvents = captureEvents;
    // ---- RPCs ----
    function rpcEvent(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Event name required");
        var event = {
            name: data.name,
            timestamp: data.timestamp || Date.now(),
            metadata: data.metadata
        };
        captureEvent(nk, logger, userId, event);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcEventsBatch(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.events || !Array.isArray(data.events))
            return RpcHelpers.errorResponse("events array required");
        var events = [];
        for (var i = 0; i < data.events.length; i++) {
            var e = data.events[i];
            if (!e.name)
                continue;
            events.push({
                name: e.name,
                timestamp: e.timestamp || Date.now(),
                metadata: e.metadata
            });
        }
        var preCount = events.length;
        captureEvents(nk, logger, userId, events);
        return RpcHelpers.successResponse({ captured: preCount, submitted: data.events.length });
    }
    // ---------------------------------------------------------------------------
    // External / server-to-server event capture
    // ---------------------------------------------------------------------------
    //
    // The standard `satori_event` RPC requires an authenticated userId on the
    // ctx. That works when a game client calls it (the client has a session
    // token), but it breaks the server-to-server use case: the QR Studio
    // smartlink redirector and the qr-studio NestJS backend don't have a
    // user session — they need to publish events using only the Nakama
    // `http_key` (Basic auth on the URL query string).
    //
    // `satori_event_external` accepts the same `{name, timestamp, metadata,
    // properties}` payload but additionally carries an `identity_id` field
    // (the synthetic Satori identity the publisher computed locally — for QR
    // Studio that's a SHA-256 of the UID cookie + tenant salt). The event is
    // written against that identity ID instead of `ctx.userId`. Validation
    // still runs through `SatoriTaxonomy.validateEvent`, so any QR-side
    // schema mismatch is rejected at ingest with the same fidelity as the
    // game-client path.
    //
    // The RPC also does NOT require authentication — it's intentionally
    // open to http_key callers (and only http_key callers, since Nakama
    // refuses HTTP RPC invocations without either a session token or a
    // matching http_key). Misuse vector: someone with the http_key can
    // forge events with arbitrary identity_id. That's the same trust
    // boundary as the game-client path; treat the http_key like a
    // shared secret.
    //
    // Storage layout matches `captureEvent` / `captureEvents`: events land
    // in the `satori_events` collection under SYSTEM_USER, plus a
    // per-identity rolling history under the identity_id. Downstream
    // (metrics, webhooks, data lake) gets the same fan-out so the QR
    // events show up in the Nakama console alongside game events without
    // any further plumbing.
    // ---------------------------------------------------------------------------
    // captureEventExternal — same fan-out as captureEvent but does NOT touch
    // per-user storage (Nakama requires storage userId to be a valid Nakama
    // user UUID; external publishers only have a synthetic identity_id like a
    // SHA-256 of a UID cookie). Per-identity history is therefore stored under
    // SYSTEM_USER with the identity_id baked into the key, matching the layout
    // of the per-event records below.
    //
    // Fan-out parity with captureEvent:
    //   - Validation via SatoriTaxonomy.validateEvent
    //   - Event row written to SYSTEM_USER in `satori_events` collection
    //   - SatoriMetrics.processEvent (counters, alerts, prometheus)
    //   - SatoriWebhooks.dispatch (downstream fan-out)
    //   - SatoriDataLake.exportBatch (S3 NDJSON warehouse)
    // What we skip (and why):
    //   - appendToUserHistory: requires nk.storageRead(userId) — would fail
    //   - SatoriIdentities.onEvent: also keys storage by userId
    // The skipped paths are nice-to-have for game clients, but the data still
    // exists per-event in `satori_events` keyed by identity_id, so metrics
    // dashboards and the data lake can rebuild per-identity views from there.
    function captureEventExternal(nk, logger, identityId, event) {
        var validation = SatoriTaxonomy.validateEvent(nk, event);
        if (!validation.valid) {
            logger.warn("[EventCaptureExternal] Rejected event '%s' (identity=%s): %s", event.name, identityId, validation.errors.join("; "));
            return false;
        }
        var dateStr = new Date(event.timestamp).toISOString().slice(0, 10);
        var key = "ev_ext_" + dateStr + "_" + identityId + "_" + Date.now();
        var record = {
            identityId: identityId,
            name: event.name,
            timestamp: event.timestamp,
            metadata: event.metadata || {},
            date: dateStr,
            external: true
        };
        nk.storageWrite([{
                collection: Constants.SATORI_EVENTS_COLLECTION,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: record,
                permissionRead: 0,
                permissionWrite: 0
            }]);
        SatoriMetrics.processEvent(nk, logger, identityId, event.name, event.metadata || {});
        SatoriWebhooks.dispatch(nk, logger, "event:" + event.name, record);
        SatoriDataLake.exportBatch(nk, logger, [record]);
        return true;
    }
    function rpcEventExternal(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Event name required");
        var identityId = (data.identity_id || data.identityId || "").toString();
        if (!identityId) {
            identityId = "anon-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
        }
        var event = {
            name: data.name,
            timestamp: data.timestamp || Date.now(),
            metadata: data.metadata || {}
        };
        var captured = captureEventExternal(nk, logger, identityId, event);
        return RpcHelpers.successResponse({ success: captured, identity_id: identityId });
    }
    function rpcEventsBatchExternal(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.events || !Array.isArray(data.events))
            return RpcHelpers.errorResponse("events array required");
        var identityId = (data.identity_id || data.identityId || "").toString();
        if (!identityId) {
            identityId = "anon-batch-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now();
        }
        var capturedCount = 0;
        for (var i = 0; i < data.events.length; i++) {
            var e = data.events[i];
            if (!e.name)
                continue;
            var event = {
                name: e.name,
                timestamp: e.timestamp || Date.now(),
                metadata: e.metadata || {}
            };
            if (captureEventExternal(nk, logger, identityId, event))
                capturedCount++;
        }
        return RpcHelpers.successResponse({ captured: capturedCount, submitted: data.events.length, identity_id: identityId });
    }
    function register(initializer) {
        initializer.registerRpc("satori_event", rpcEvent);
        initializer.registerRpc("satori_events_batch", rpcEventsBatch);
        initializer.registerRpc("satori_event_external", rpcEventExternal);
        initializer.registerRpc("satori_events_batch_external", rpcEventsBatchExternal);
    }
    SatoriEventCapture.register = register;
})(SatoriEventCapture || (SatoriEventCapture = {}));
var SatoriExperiments;
(function (SatoriExperiments) {
    function getExperiments(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "experiments", {});
    }
    function getUserExperiments(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId);
        return data || { assignments: {} };
    }
    function saveUserExperiments(nk, userId, data) {
        Storage.writeJson(nk, Constants.SATORI_ASSIGNMENTS_COLLECTION, "assignments", userId, data);
    }
    function deterministicAssign(userId, experimentId, variants, splitKey) {
        var totalWeight = 0;
        for (var i = 0; i < variants.length; i++) {
            totalWeight += variants[i].weight;
        }
        if (totalWeight <= 0)
            return variants[0].id;
        var seed = userId + ":" + experimentId;
        if (splitKey === "random") {
            seed = userId + ":" + experimentId + ":" + Date.now();
        }
        var hash = 0;
        for (var c = 0; c < seed.length; c++) {
            hash = ((hash << 5) - hash) + seed.charCodeAt(c);
            hash = hash & 0x7FFFFFFF;
        }
        var bucket = hash % totalWeight;
        var cumulative = 0;
        for (var j = 0; j < variants.length; j++) {
            cumulative += variants[j].weight;
            if (bucket < cumulative)
                return variants[j].id;
        }
        return variants[variants.length - 1].id;
    }
    function isExperimentActive(def) {
        if (def.status !== "running")
            return false;
        var now = Math.floor(Date.now() / 1000);
        if (def.startAt && now < def.startAt)
            return false;
        if (def.endAt && now > def.endAt)
            return false;
        return true;
    }
    function isWithinAdmissionDeadline(def) {
        if (!def.admissionDeadline)
            return true;
        return Math.floor(Date.now() / 1000) <= def.admissionDeadline;
    }
    function getVariant(nk, userId, experimentId) {
        var experiments = getExperiments(nk);
        var def = experiments[experimentId];
        if (!def || !isExperimentActive(def))
            return null;
        if (!def.variants || def.variants.length === 0)
            return null;
        if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId)) {
            return null;
        }
        var userExp = getUserExperiments(nk, userId);
        var assignment = userExp.assignments[experimentId];
        if (!assignment) {
            if (!isWithinAdmissionDeadline(def))
                return null;
            var variantId = deterministicAssign(userId, experimentId, def.variants, def.splitKey);
            assignment = {
                experimentId: experimentId,
                variantId: variantId,
                assignedAt: Math.floor(Date.now() / 1000)
            };
            userExp.assignments[experimentId] = assignment;
            saveUserExperiments(nk, userId, userExp);
        }
        if (def.lockParticipation && assignment.locked) {
            // locked assignments cannot change
        }
        var found = null;
        for (var i = 0; i < def.variants.length; i++) {
            if (def.variants[i].id === assignment.variantId) {
                found = def.variants[i];
                break;
            }
        }
        // Multi-phase: check if current phase has different variants
        if (def.phases && Array.isArray(def.phases)) {
            var now = Math.floor(Date.now() / 1000);
            for (var p = 0; p < def.phases.length; p++) {
                var phase = def.phases[p];
                if (now >= phase.startAt && now <= phase.endAt && phase.variants) {
                    for (var pv = 0; pv < phase.variants.length; pv++) {
                        if (phase.variants[pv].id === assignment.variantId) {
                            found = phase.variants[pv];
                            break;
                        }
                    }
                    break;
                }
            }
        }
        return found;
    }
    SatoriExperiments.getVariant = getVariant;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var experiments = getExperiments(nk);
        var result = [];
        for (var id in experiments) {
            var def = experiments[id];
            if (!isExperimentActive(def))
                continue;
            if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId))
                continue;
            var variant = getVariant(nk, userId, id);
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                type: def.experimentType || "custom",
                variant: variant ? { id: variant.id, name: variant.name, config: variant.config } : null,
                startAt: def.startAt,
                endAt: def.endAt,
                goalMetric: def.goalMetric
            });
        }
        return RpcHelpers.successResponse({ experiments: result });
    }
    function rpcGetVariant(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.experimentId)
            return RpcHelpers.errorResponse("experimentId required");
        var variant = getVariant(nk, userId, data.experimentId);
        return RpcHelpers.successResponse({ variant: variant });
    }
    function register(initializer) {
        initializer.registerRpc("satori_experiments_get", rpcGet);
        initializer.registerRpc("satori_experiments_get_variant", rpcGetVariant);
    }
    SatoriExperiments.register = register;
})(SatoriExperiments || (SatoriExperiments = {}));
var SatoriFeatureFlags;
(function (SatoriFeatureFlags) {
    var DEFAULT_CONFIG = { flags: {} };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "flags", DEFAULT_CONFIG);
    }
    function getFlag(nk, userId, flagName, defaultValue) {
        var config = getConfig(nk);
        var def = config.flags[flagName];
        if (!def || !def.enabled) {
            return { name: flagName, value: defaultValue || "" };
        }
        if (def.conditionsByAudience && userId) {
            for (var audienceId in def.conditionsByAudience) {
                if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
                    return { name: flagName, value: def.conditionsByAudience[audienceId] };
                }
            }
        }
        return { name: flagName, value: def.value };
    }
    SatoriFeatureFlags.getFlag = getFlag;
    function getAllFlags(nk, userId) {
        var config = getConfig(nk);
        var flags = [];
        for (var name in config.flags) {
            var def = config.flags[name];
            if (!def.enabled)
                continue;
            var value = def.value;
            if (def.conditionsByAudience && userId) {
                for (var audienceId in def.conditionsByAudience) {
                    if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
                        value = def.conditionsByAudience[audienceId];
                        break;
                    }
                }
            }
            flags.push({ name: name, value: value });
        }
        return flags;
    }
    SatoriFeatureFlags.getAllFlags = getAllFlags;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Flag name required");
        var flag = getFlag(nk, userId, data.name, data.defaultValue);
        return RpcHelpers.successResponse({ flag: flag });
    }
    function rpcGetAll(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var flags;
        if (data.names && Array.isArray(data.names)) {
            flags = [];
            for (var i = 0; i < data.names.length; i++) {
                flags.push(getFlag(nk, userId, data.names[i]));
            }
        }
        else {
            flags = getAllFlags(nk, userId);
        }
        return RpcHelpers.successResponse({ flags: flags });
    }
    function rpcSet(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("Flag name required");
        var config = getConfig(nk);
        var now = Math.floor(Date.now() / 1000);
        var existing = config.flags[data.name];
        config.flags[data.name] = {
            name: data.name,
            value: data.value !== undefined ? data.value : (existing ? existing.value : ""),
            description: data.description || (existing ? existing.description : ""),
            conditionsByAudience: data.conditionsByAudience || (existing ? existing.conditionsByAudience : undefined),
            enabled: data.enabled !== undefined ? data.enabled : (existing ? existing.enabled : true),
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now
        };
        ConfigLoader.saveSatoriConfig(nk, "flags", config);
        return RpcHelpers.successResponse({ flag: config.flags[data.name] });
    }
    function register(initializer) {
        initializer.registerRpc("satori_flags_get", rpcGet);
        initializer.registerRpc("satori_flags_get_all", rpcGetAll);
        initializer.registerRpc("satori_flags_set", rpcSet);
    }
    SatoriFeatureFlags.register = register;
})(SatoriFeatureFlags || (SatoriFeatureFlags = {}));
var SatoriIdentities;
(function (SatoriIdentities) {
    function getProperties(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId);
        return data || {
            defaultProperties: {},
            customProperties: {},
            computedProperties: {}
        };
    }
    function saveProperties(nk, userId, props) {
        Storage.writeJson(nk, Constants.SATORI_IDENTITY_COLLECTION, "props", userId, props);
    }
    function onEvent(nk, logger, userId, event) {
        try {
            var props = getProperties(nk, userId);
            var now = new Date().toISOString();
            if (!props.defaultProperties.first_seen) {
                props.defaultProperties.first_seen = now;
            }
            props.defaultProperties.last_seen = now;
            var sessionCount = parseInt(props.computedProperties.session_count || "0");
            if (event.name === "session_start") {
                props.computedProperties.session_count = String(sessionCount + 1);
            }
            var eventCount = parseInt(props.computedProperties["event_count_" + event.name] || "0");
            props.computedProperties["event_count_" + event.name] = String(eventCount + 1);
            var totalEvents = parseInt(props.computedProperties.total_events || "0");
            props.computedProperties.total_events = String(totalEvents + 1);
            if (event.name === "purchase" && event.metadata && event.metadata.amount) {
                var totalSpend = parseFloat(props.computedProperties.total_spend || "0");
                totalSpend += parseFloat(event.metadata.amount);
                props.computedProperties.total_spend = String(totalSpend);
            }
            saveProperties(nk, userId, props);
        }
        catch (err) {
            logger.warn("SatoriIdentities.onEvent error: %s", err.message || String(err));
        }
    }
    SatoriIdentities.onEvent = onEvent;
    function getProperty(nk, userId, key) {
        var props = getProperties(nk, userId);
        return props.defaultProperties[key] || props.customProperties[key] || props.computedProperties[key] || null;
    }
    SatoriIdentities.getProperty = getProperty;
    function getAllProperties(nk, userId) {
        return getProperties(nk, userId);
    }
    SatoriIdentities.getAllProperties = getAllProperties;
    // ---- RPCs ----
    function rpcGet(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var props = getProperties(nk, userId);
        return RpcHelpers.successResponse({ properties: props });
    }
    function rpcUpdate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var props = getProperties(nk, userId);
        if (data.defaultProperties) {
            for (var k in data.defaultProperties) {
                props.defaultProperties[k] = data.defaultProperties[k];
            }
        }
        if (data.customProperties) {
            for (var ck in data.customProperties) {
                props.customProperties[ck] = data.customProperties[ck];
            }
        }
        saveProperties(nk, userId, props);
        return RpcHelpers.successResponse({ properties: props });
    }
    function register(initializer) {
        initializer.registerRpc("satori_identity_get", rpcGet);
        initializer.registerRpc("satori_identity_update_properties", rpcUpdate);
    }
    SatoriIdentities.register = register;
})(SatoriIdentities || (SatoriIdentities = {}));
var SatoriCreatorEvents;
(function (SatoriCreatorEvents) {
    // ---- Types ----
    var COLLECTION = "satori_creator_events";
    var LEADERBOARD_PREFIX = "creator_event_";
    var TIER_ORDER = ["platinum", "gold", "silver", "bronze", "participation"];
    // ---- Storage helpers ----
    function getEventDefinition(nk, eventId) {
        return Storage.readSystemJson(nk, COLLECTION, eventId);
    }
    function saveEventDefinition(nk, def) {
        Storage.writeSystemJson(nk, COLLECTION, def.id, def);
    }
    function getEventsIndex(nk) {
        var data = Storage.readSystemJson(nk, COLLECTION, "events_index");
        return data || { eventIds: [] };
    }
    function saveEventsIndex(nk, index) {
        Storage.writeSystemJson(nk, COLLECTION, "events_index", index);
    }
    function getUserStates(nk, userId) {
        var data = Storage.readJson(nk, COLLECTION, "user_state", userId);
        return (data && data.events) || {};
    }
    function saveUserStates(nk, userId, states) {
        Storage.writeJson(nk, COLLECTION, "user_state", userId, { events: states });
    }
    function computeEffectiveStatus(def) {
        if (def.status === "cancelled" || def.status === "distributed")
            return def.status;
        if (def.status === "draft" || def.status === "funded")
            return def.status;
        var now = Math.floor(Date.now() / 1000);
        var endAt = def.scheduledAt + (def.duration * 60);
        if (now < def.scheduledAt)
            return "published";
        if (now > endAt)
            return "ended";
        return "live";
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var filterStatus = data.status || null;
        var index = getEventsIndex(nk);
        var userStates = getUserStates(nk, userId);
        var result = [];
        for (var i = 0; i < index.eventIds.length; i++) {
            var eventId = index.eventIds[i];
            var def = getEventDefinition(nk, eventId);
            if (!def)
                continue;
            var status = computeEffectiveStatus(def);
            if (filterStatus && status !== filterStatus)
                continue;
            if (status === "draft" || status === "funded")
                continue;
            var userState = userStates[eventId];
            var endAt = def.scheduledAt + (def.duration * 60);
            result.push({
                id: def.id,
                creatorId: def.creatorId,
                title: def.title,
                description: def.description,
                category: def.category,
                customTopic: def.customTopic || "",
                gameMode: def.gameMode,
                scheduledAt: def.scheduledAt,
                duration: def.duration,
                endAt: endAt,
                region: def.region,
                entryFee: def.entryFee,
                prizePool: def.prizePool,
                prizes: def.prizes,
                promoVideoUrl: def.promoVideoUrl || "",
                deepLinkUrl: def.deepLinkUrl || "",
                status: status,
                participantCount: def.participantCount,
                questionCount: def.questions ? def.questions.length : 0,
                joined: userState ? !!userState.joinedAt : false,
                score: userState ? userState.score : 0,
                tierEarned: userState ? userState.tierEarned || "" : "",
                claimed: userState ? !!userState.claimedAt : false,
            });
        }
        return RpcHelpers.successResponse({ events: result });
    }
    function rpcJoin(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = computeEffectiveStatus(def);
        if (status !== "live" && status !== "published") {
            return RpcHelpers.errorResponse("Event is not accepting participants");
        }
        var userStates = getUserStates(nk, userId);
        if (userStates[data.eventId] && userStates[data.eventId].joinedAt) {
            return RpcHelpers.errorResponse("Already joined");
        }
        var gameId = data.gameId || Constants.DEFAULT_GAME_ID;
        if (def.entryFee > 0) {
            if (!WalletHelpers.hasCurrency(nk, userId, gameId, "xut", def.entryFee)) {
                return RpcHelpers.errorResponse("Insufficient XUT balance for entry fee");
            }
            WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, "xut", def.entryFee);
            EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_SPENT, {
                userId: userId,
                gameId: gameId,
                currencyId: "xut",
                amount: def.entryFee,
                reason: "creator_event_entry_fee",
                eventId: data.eventId,
            });
        }
        userStates[data.eventId] = {
            eventId: data.eventId,
            joinedAt: Math.floor(Date.now() / 1000),
            currentQuestion: 0,
            score: 0,
            answers: [],
            eliminated: false,
        };
        saveUserStates(nk, userId, userStates);
        def.participantCount = (def.participantCount || 0) + 1;
        saveEventDefinition(nk, def);
        var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
        try {
            nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", 0, 0);
        }
        catch (err) {
            logger.warn("[CreatorEvent] Failed to write initial leaderboard record: %s", err.message || String(err));
        }
        return RpcHelpers.successResponse({
            success: true,
            eventId: data.eventId,
            entryFeePaid: def.entryFee,
        });
    }
    function rpcSubmit(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        if (data.answer === undefined || data.answer === null)
            return RpcHelpers.errorResponse("answer required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = computeEffectiveStatus(def);
        if (status !== "live")
            return RpcHelpers.errorResponse("Event is not live");
        var userStates = getUserStates(nk, userId);
        var state = userStates[data.eventId];
        if (!state || !state.joinedAt)
            return RpcHelpers.errorResponse("Not joined");
        if (state.eliminated)
            return RpcHelpers.errorResponse("Eliminated from event");
        var now = Math.floor(Date.now() / 1000);
        var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
        // ---- Best Guess mode ----
        if (def.gameMode === "best_guess") {
            var userAnswer = data.answer.toString().toLowerCase().trim();
            var correctAnswer = (def.answer || "").toLowerCase().trim();
            var isCorrect = userAnswer === correctAnswer;
            var elapsedSec = now - def.scheduledAt;
            var maxDuration = def.duration * 60;
            var timeBonus = isCorrect ? Math.max(0, Math.floor(((maxDuration - elapsedSec) / maxDuration) * 1000)) : 0;
            var points = isCorrect ? 1000 + timeBonus : 0;
            state.score = points;
            state.answers.push({
                questionId: "best_guess",
                answer: data.answer.toString(),
                correct: isCorrect,
                answeredAt: now,
                points: points,
            });
            saveUserStates(nk, userId, userStates);
            try {
                nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", points, 0);
            }
            catch (err) {
                logger.warn("[CreatorEvent] Leaderboard write failed: %s", err.message || String(err));
            }
            return RpcHelpers.successResponse({
                correct: isCorrect,
                score: points,
                timeBonus: timeBonus,
            });
        }
        // ---- Speed Quiz / Elimination mode ----
        if (!data.questionId)
            return RpcHelpers.errorResponse("questionId required");
        var question = null;
        for (var qi = 0; qi < def.questions.length; qi++) {
            if (def.questions[qi].id === data.questionId) {
                question = def.questions[qi];
                break;
            }
        }
        if (!question)
            return RpcHelpers.errorResponse("Question not found");
        for (var ai = 0; ai < state.answers.length; ai++) {
            if (state.answers[ai].questionId === data.questionId) {
                return RpcHelpers.errorResponse("Question already answered");
            }
        }
        var isCorrect = data.answer.toString().toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
        var points = isCorrect ? question.points : 0;
        if (isCorrect && typeof data.timeElapsed === "number") {
            var speedBonus = Math.max(0, Math.floor(((question.timeLimit - data.timeElapsed) / question.timeLimit) * (question.points * 0.5)));
            points += speedBonus;
        }
        if (def.gameMode === "elimination" && !isCorrect) {
            state.eliminated = true;
        }
        state.score += points;
        state.currentQuestion++;
        state.answers.push({
            questionId: data.questionId,
            answer: data.answer.toString(),
            correct: isCorrect,
            answeredAt: now,
            points: points,
        });
        saveUserStates(nk, userId, userStates);
        try {
            nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", state.score, 0);
        }
        catch (err) {
            logger.warn("[CreatorEvent] Leaderboard write failed: %s", err.message || String(err));
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
            userId: userId,
            eventId: data.eventId,
            score: state.score,
            questionId: data.questionId,
        });
        return RpcHelpers.successResponse({
            correct: isCorrect,
            points: points,
            totalScore: state.score,
            eliminated: state.eliminated || false,
            questionsAnswered: state.answers.length,
            totalQuestions: def.questions.length,
        });
    }
    function rpcLeaderboard(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
        var limit = data.limit || 50;
        try {
            var records = nk.leaderboardRecordsList(leaderboardId, [], limit, data.cursor || "");
            var entries = [];
            var ownerRecords = records.records || [];
            for (var ri = 0; ri < ownerRecords.length; ri++) {
                var rec = ownerRecords[ri];
                entries.push({
                    userId: rec.ownerId,
                    username: rec.username || "",
                    score: rec.score,
                    rank: rec.rank,
                });
            }
            var userRank = null;
            try {
                var userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "");
                var userOwnerRecs = userRecords.ownerRecords || [];
                if (userOwnerRecs.length > 0) {
                    userRank = {
                        userId: userOwnerRecs[0].ownerId,
                        username: userOwnerRecs[0].username || "",
                        score: userOwnerRecs[0].score,
                        rank: userOwnerRecs[0].rank,
                    };
                }
            }
            catch (_) {
                // user may not have a record yet
            }
            return RpcHelpers.successResponse({
                eventId: data.eventId,
                entries: entries,
                userRank: userRank,
                nextCursor: records.nextCursor || "",
                prevCursor: records.prevCursor || "",
            });
        }
        catch (err) {
            return RpcHelpers.errorResponse("Failed to fetch leaderboard: " + (err.message || String(err)));
        }
    }
    function rpcResults(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = computeEffectiveStatus(def);
        if (status !== "ended" && status !== "distributed") {
            return RpcHelpers.errorResponse("Event has not ended yet");
        }
        var userStates = getUserStates(nk, userId);
        var state = userStates[data.eventId];
        if (!state || !state.joinedAt)
            return RpcHelpers.errorResponse("Not a participant");
        var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
        var userRank = 0;
        try {
            var userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "");
            var ownerRecs = userRecords.ownerRecords || [];
            if (ownerRecs.length > 0) {
                userRank = ownerRecs[0].rank;
            }
        }
        catch (_) {
            // record may not exist
        }
        return RpcHelpers.successResponse({
            eventId: data.eventId,
            score: state.score,
            rank: state.rank || userRank,
            tierEarned: state.tierEarned || "",
            claimed: !!state.claimedAt,
            answers: state.answers,
            totalParticipants: def.participantCount,
            prizePool: def.prizePool,
            prizes: def.prizes,
        });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = computeEffectiveStatus(def);
        if (status !== "ended" && status !== "distributed") {
            return RpcHelpers.errorResponse("Event has not ended yet");
        }
        var userStates = getUserStates(nk, userId);
        var state = userStates[data.eventId];
        if (!state || !state.joinedAt)
            return RpcHelpers.errorResponse("Not a participant");
        if (state.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        if (!state.tierEarned) {
            return RpcHelpers.errorResponse("No tier assigned - results not yet processed");
        }
        var gameId = data.gameId || Constants.DEFAULT_GAME_ID;
        var tierReward = HiroCreatorEventRewards.getTierReward(nk, data.eventId, state.tierEarned);
        var grantedReward = null;
        if (tierReward) {
            grantedReward = RewardEngine.resolveReward(nk, tierReward);
            RewardEngine.grantReward(nk, logger, ctx, userId, gameId, grantedReward);
        }
        state.claimedAt = Math.floor(Date.now() / 1000);
        saveUserStates(nk, userId, userStates);
        EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
            userId: userId,
            eventId: data.eventId,
            tier: state.tierEarned,
            reward: grantedReward,
        });
        return RpcHelpers.successResponse({
            success: true,
            eventId: data.eventId,
            tier: state.tierEarned,
            reward: grantedReward,
        });
    }
    // ---- Creator RPCs ----
    function isAdminCtx(ctx, nk) {
        try {
            RpcHelpers.requireAdmin(ctx, nk);
            return true;
        }
        catch (_) {
            return false;
        }
    }
    function rpcCreate(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.title)
            return RpcHelpers.errorResponse("title required");
        if (!data.category)
            return RpcHelpers.errorResponse("category required");
        if (!data.scheduledAt)
            return RpcHelpers.errorResponse("scheduledAt required");
        if (typeof data.scheduledAt !== "number")
            return RpcHelpers.errorResponse("scheduledAt must be a unix timestamp (number)");
        var event = {
            id: nk.uuidv4(),
            creatorId: userId,
            title: String(data.title),
            description: String(data.description || ""),
            category: String(data.category),
            customTopic: data.customTopic ? String(data.customTopic) : "",
            gameMode: String(data.gameMode || "best_guess"),
            scheduledAt: data.scheduledAt,
            duration: typeof data.duration === "number" ? data.duration : 30,
            region: String(data.region || "global"),
            timezone: String(data.timezone || "UTC"),
            entryFee: typeof data.entryFee === "number" ? data.entryFee : 0,
            prizePool: typeof data.prizePool === "number" ? data.prizePool : 0,
            prizes: Array.isArray(data.prizes) ? data.prizes : [],
            giftCardPrizes: data.giftCardPrizes || undefined,
            questions: Array.isArray(data.questions) ? data.questions : [],
            clues: Array.isArray(data.clues) ? data.clues : [],
            answer: data.answer ? String(data.answer) : "",
            promoVideoUrl: data.promoVideoUrl ? String(data.promoVideoUrl) : "",
            deepLinkUrl: data.deepLinkUrl ? String(data.deepLinkUrl) : "",
            status: "draft",
            participantCount: 0,
            createdAt: Math.floor(Date.now() / 1000),
        };
        saveEventDefinition(nk, event);
        logger.info("[CreatorEvent] Draft created by %s: %s (%s)", userId, event.title, event.id);
        // Emit EVENT_CREATED so Content Factory can begin PRE-GENERATING the promo
        // video immediately (well before rpcPublish). This gives the pipeline the
        // maximum runway between creation and scheduledAt.
        EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_CREATED, {
            eventId: event.id,
            creatorId: event.creatorId,
            title: event.title,
            description: event.description,
            category: event.category,
            gameMode: event.gameMode,
            region: event.region,
            scheduledAt: event.scheduledAt,
            duration: event.duration,
            prizePool: event.prizePool,
            giftCardPrizes: event.giftCardPrizes || null,
            deepLinkUrl: event.deepLinkUrl || "",
            createdAt: event.createdAt,
            idempotencyKey: "event_created_" + event.id,
        });
        return RpcHelpers.successResponse({
            success: true,
            eventId: event.id,
            status: event.status,
        });
    }
    function broadcastEventPublishedNotification(nk, logger, event) {
        try {
            var title = "🎮 New Live Event: " + event.title;
            var body = event.description || "A new event is live — join now!";
            if (event.giftCardPrizes && event.giftCardPrizes.totalValue) {
                body = body + " Prizes up to " + event.giftCardPrizes.totalCurrency + " " + event.giftCardPrizes.totalValue + "!";
            }
            else if (event.prizePool) {
                body = body + " Prize pool: " + event.prizePool + " XUT!";
            }
            nk.notificationsSend([{
                    userId: "",
                    code: 1001,
                    subject: title,
                    content: {
                        eventId: event.id,
                        title: event.title,
                        scheduledAt: event.scheduledAt,
                        deepLinkUrl: event.deepLinkUrl || "",
                        promoVideoUrl: event.promoVideoUrl || "",
                        type: "creator_event_published",
                        body: body,
                    },
                    persistent: true,
                }]);
            logger.info("[CreatorEvent] Broadcast notification for event %s", event.id);
        }
        catch (err) {
            logger.warn("[CreatorEvent] Failed to broadcast notification: %s", err.message || String(err));
        }
    }
    function rpcPublish(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var isAdmin = isAdminCtx(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var event = null;
        // Two modes: full event object (admin path) OR eventId-only (creator path publishing own draft)
        if (data.event) {
            event = data.event;
            if (!event.id)
                return RpcHelpers.errorResponse("event.id required");
            var existingByObject = getEventDefinition(nk, event.id);
            if (!isAdmin) {
                if (!existingByObject)
                    return RpcHelpers.errorResponse("Event not found — create it first via creator_event_create");
                if (existingByObject.creatorId !== userId)
                    return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
                // Preserve creatorId and createdAt on creator self-publish
                event.creatorId = existingByObject.creatorId;
                event.createdAt = existingByObject.createdAt;
            }
        }
        else if (data.eventId) {
            event = getEventDefinition(nk, String(data.eventId));
            if (!event)
                return RpcHelpers.errorResponse("Event not found");
            if (!isAdmin && event.creatorId !== userId) {
                return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
            }
        }
        else {
            return RpcHelpers.errorResponse("Either event object or eventId required");
        }
        var currentStatus = event.status || "draft";
        if (currentStatus !== "funded" && currentStatus !== "draft") {
            return RpcHelpers.errorResponse("Event must be in funded or draft status to publish (currently: " + currentStatus + ")");
        }
        event.status = "published";
        event.publishedAt = Math.floor(Date.now() / 1000);
        event.participantCount = event.participantCount || 0;
        saveEventDefinition(nk, event);
        var index = getEventsIndex(nk);
        if (index.eventIds.indexOf(event.id) < 0) {
            index.eventIds.push(event.id);
            saveEventsIndex(nk, index);
        }
        var leaderboardId = LEADERBOARD_PREFIX + event.id;
        try {
            nk.leaderboardCreate(leaderboardId, true, "descending" /* nkruntime.SortOrder.DESCENDING */, "best" /* nkruntime.Operator.BEST */);
        }
        catch (err) {
            logger.warn("[CreatorEvent] Leaderboard may already exist: %s", err.message || String(err));
        }
        try {
            HiroCreatorEventRewards.createBucketForEvent(nk, logger, event.id, event.prizes, event.prizePool);
        }
        catch (err) {
            logger.warn("[CreatorEvent] Failed to create reward bucket: %s", err.message || String(err));
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_PUBLISHED, {
            eventId: event.id,
            creatorId: event.creatorId,
            title: event.title,
            description: event.description,
            category: event.category,
            gameMode: event.gameMode,
            region: event.region,
            scheduledAt: event.scheduledAt,
            duration: event.duration,
            prizePool: event.prizePool,
            giftCardPrizes: event.giftCardPrizes || null,
            deepLinkUrl: event.deepLinkUrl || "",
            publishedAt: event.publishedAt,
            idempotencyKey: "event_published_" + event.id,
        });
        broadcastEventPublishedNotification(nk, logger, event);
        logger.info("[CreatorEvent] Published event %s by %s: %s", event.id, event.creatorId, event.title);
        return RpcHelpers.successResponse({
            success: true,
            eventId: event.id,
            leaderboardId: leaderboardId,
            status: event.status,
        });
    }
    function rpcUpdatePromo(ctx, logger, nk, payload) {
        // Allow server-to-server calls (no userId) as trusted admin — this RPC is
        // commonly invoked by Content Factory when a promo/recap video is published.
        var userId = ctx.userId || "";
        var isServerCall = !userId;
        var isAdmin = isServerCall || isAdminCtx(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, String(data.eventId));
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        if (!isAdmin && def.creatorId !== userId) {
            return RpcHelpers.errorResponse("Not authorized");
        }
        if (typeof data.promoVideoUrl === "string")
            def.promoVideoUrl = data.promoVideoUrl;
        if (typeof data.recapVideoUrl === "string")
            def.recapVideoUrl = data.recapVideoUrl;
        if (typeof data.deepLinkUrl === "string")
            def.deepLinkUrl = data.deepLinkUrl;
        saveEventDefinition(nk, def);
        logger.info("[CreatorEvent] Updated media URLs for event %s", def.id);
        return RpcHelpers.successResponse({
            success: true,
            eventId: def.id,
            promoVideoUrl: def.promoVideoUrl || "",
            recapVideoUrl: def.recapVideoUrl || "",
            deepLinkUrl: def.deepLinkUrl || "",
        });
    }
    function rpcEnd(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var isAdmin = isAdminCtx(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, data.eventId);
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        if (!isAdmin && def.creatorId !== userId) {
            return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
        }
        if (def.status === "ended" || def.status === "distributed" || def.status === "cancelled") {
            return RpcHelpers.errorResponse("Event already ended/cancelled");
        }
        var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
        var allRecords = [];
        var cursor = "";
        do {
            try {
                var result = nk.leaderboardRecordsList(leaderboardId, [], 100, cursor);
                var records = result.records || [];
                for (var ri = 0; ri < records.length; ri++) {
                    allRecords.push(records[ri]);
                }
                cursor = result.nextCursor || "";
            }
            catch (err) {
                logger.error("[CreatorEvent] Failed to read leaderboard: %s", err.message || String(err));
                break;
            }
        } while (cursor);
        var sortedPrizes = [];
        var winnersPerTier = {};
        for (var to = 0; to < TIER_ORDER.length; to++) {
            for (var pi = 0; pi < def.prizes.length; pi++) {
                if (def.prizes[pi].tier === TIER_ORDER[to]) {
                    sortedPrizes.push(def.prizes[pi]);
                    winnersPerTier[def.prizes[pi].tier] = 0;
                }
            }
        }
        var tierAssignments = {};
        for (var ri = 0; ri < allRecords.length; ri++) {
            var record = allRecords[ri];
            var currentRank = ri + 1;
            var assignedTier = "";
            for (var si = 0; si < sortedPrizes.length; si++) {
                var prize = sortedPrizes[si];
                if (winnersPerTier[prize.tier] < prize.maxWinners) {
                    assignedTier = prize.tier;
                    winnersPerTier[prize.tier]++;
                    break;
                }
            }
            if (assignedTier) {
                tierAssignments[record.ownerId] = assignedTier;
            }
            try {
                var userStates = getUserStates(nk, record.ownerId);
                if (userStates[data.eventId]) {
                    userStates[data.eventId].tierEarned = assignedTier || undefined;
                    userStates[data.eventId].rank = currentRank;
                    saveUserStates(nk, record.ownerId, userStates);
                }
            }
            catch (err) {
                logger.warn("[CreatorEvent] Failed to update user state for %s: %s", record.ownerId, err.message || String(err));
            }
        }
        def.status = "ended";
        def.endedAt = Math.floor(Date.now() / 1000);
        saveEventDefinition(nk, def);
        logger.info("[CreatorEvent] Ended event %s — %d participants, %d tier assignments", def.id, allRecords.length, Object.keys(tierAssignments).length);
        // Resolve usernames for winner + runners-up so downstream recap pipelines
        // (n8n → Content Factory event-recap) can produce a real highlight video
        // without having to do their own lookup.
        var topOwnerIds = [];
        for (var oi = 0; oi < allRecords.length && oi < 4; oi++) {
            topOwnerIds.push(allRecords[oi].ownerId);
        }
        var idToUsername = {};
        if (topOwnerIds.length > 0) {
            try {
                var accts = nk.accountsGetId(topOwnerIds);
                for (var ai = 0; ai < accts.length; ai++) {
                    var u = accts[ai].user;
                    if (u && u.id)
                        idToUsername[u.id] = u.username || "";
                }
            }
            catch (err) {
                logger.warn("[CreatorEvent] Failed to resolve usernames for recap: %s", err.message || String(err));
            }
        }
        function rankInfo(rec, rank) {
            return {
                userId: rec.ownerId,
                username: idToUsername[rec.ownerId] || "",
                rank: rank,
                score: rec.score || 0,
            };
        }
        var winner = allRecords.length > 0 ? rankInfo(allRecords[0], 1) : null;
        var runnersUp = [];
        for (var ri2 = 1; ri2 < allRecords.length && ri2 < 4; ri2++) {
            runnersUp.push(rankInfo(allRecords[ri2], ri2 + 1));
        }
        // Next upcoming event lookup — lets the recap pipeline generate a
        // "next event Thursday 8PM IST" CTA instead of a hard-coded "tomorrow".
        // Scan the events index for the nearest scheduledAt > now, preferring
        // same-region first so regional recaps promote their own region's next.
        var nextEvent = null;
        try {
            var nowTs = Math.floor(Date.now() / 1000);
            var idx = getEventsIndex(nk);
            var bestSame = null;
            var bestAny = null;
            for (var ei = 0; ei < idx.eventIds.length; ei++) {
                var eid = idx.eventIds[ei];
                if (eid === def.id)
                    continue;
                var other = getEventDefinition(nk, eid);
                if (!other)
                    continue;
                if (other.status === "cancelled" || other.status === "ended" || other.status === "distributed")
                    continue;
                if (!other.scheduledAt || other.scheduledAt <= nowTs)
                    continue;
                var candidate = {
                    eventId: other.id,
                    title: other.title,
                    category: other.category,
                    region: other.region,
                    scheduledAt: other.scheduledAt,
                    duration: other.duration,
                };
                if (other.region === def.region) {
                    if (!bestSame || other.scheduledAt < bestSame.scheduledAt)
                        bestSame = candidate;
                }
                else {
                    if (!bestAny || other.scheduledAt < bestAny.scheduledAt)
                        bestAny = candidate;
                }
            }
            nextEvent = bestSame || bestAny;
        }
        catch (err) {
            logger.warn("[CreatorEvent] next-event lookup failed: %s", err.message || String(err));
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_ENDED, {
            eventId: def.id,
            creatorId: def.creatorId,
            title: def.title,
            description: def.description,
            category: def.category,
            gameMode: def.gameMode,
            region: def.region,
            totalParticipants: allRecords.length,
            tierAssignments: tierAssignments,
            winnersPerTier: winnersPerTier,
            winner: winner,
            runnersUp: runnersUp,
            answer: def.answer || "",
            prizePool: def.prizePool,
            giftCardPrizes: def.giftCardPrizes || null,
            endedAt: def.endedAt,
            nextEvent: nextEvent,
            idempotencyKey: "event_ended_" + def.id,
        });
        return RpcHelpers.successResponse({
            success: true,
            eventId: def.id,
            totalParticipants: allRecords.length,
            tierAssignments: tierAssignments,
            winnersPerTier: winnersPerTier,
        });
    }
    /**
     * Cancel a draft or published event BEFORE it starts running.
     *
     * Emits EVENT_CANCELLED so the n8n takedown workflow can unpublish any
     * already-scheduled promo posts on YouTube/TikTok/Instagram (via Postiz).
     *
     * Only draft | funded | published events can be cancelled. Events that
     * have already ended or been distributed are terminal.
     */
    function rpcCancel(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var isAdmin = isAdminCtx(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var def = getEventDefinition(nk, String(data.eventId));
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        if (!isAdmin && def.creatorId !== userId) {
            return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
        }
        var current = def.status || "draft";
        if (current !== "draft" && current !== "funded" && current !== "published") {
            return RpcHelpers.errorResponse("Event cannot be cancelled once it's " + current);
        }
        def.status = "cancelled";
        var now = Math.floor(Date.now() / 1000);
        def.cancelledAt = now;
        def.cancelReason = data.reason ? String(data.reason) : "";
        saveEventDefinition(nk, def);
        logger.info("[CreatorEvent] Cancelled by %s: %s (%s) — reason=%s", userId, def.title, def.id, def.cancelReason || "(none)");
        // Fan out to n8n → Postiz takedown + Content Factory registry cleanup.
        EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_CANCELLED, {
            eventId: def.id,
            creatorId: def.creatorId,
            title: def.title,
            description: def.description,
            category: def.category,
            region: def.region,
            scheduledAt: def.scheduledAt,
            cancelledAt: now,
            cancelledBy: userId,
            reason: def.cancelReason || "",
            // Carry the prior idempotency keys so downstream can identify the
            // exact promo tasks to tear down.
            priorPromoIdempotencyKeys: [
                "event_created_" + def.id,
                "event_published_" + def.id,
            ],
            idempotencyKey: "event_cancelled_" + def.id,
        });
        return RpcHelpers.successResponse({
            success: true,
            eventId: def.id,
            status: "cancelled",
        });
    }
    function register(initializer) {
        initializer.registerRpc("creator_event_list", rpcList);
        initializer.registerRpc("creator_event_join", rpcJoin);
        initializer.registerRpc("creator_event_submit", rpcSubmit);
        initializer.registerRpc("creator_event_leaderboard", rpcLeaderboard);
        initializer.registerRpc("creator_event_results", rpcResults);
        initializer.registerRpc("creator_event_claim", rpcClaim);
        initializer.registerRpc("creator_event_create", rpcCreate);
        initializer.registerRpc("creator_event_publish", rpcPublish);
        initializer.registerRpc("creator_event_end", rpcEnd);
        initializer.registerRpc("creator_event_cancel", rpcCancel);
        initializer.registerRpc("creator_event_update_promo", rpcUpdatePromo);
    }
    SatoriCreatorEvents.register = register;
})(SatoriCreatorEvents || (SatoriCreatorEvents = {}));
var SatoriLiveEvents;
(function (SatoriLiveEvents) {
    function getEventDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "live_events", {});
    }
    function getUserLiveEventStates(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId);
        return (data && data.events) || {};
    }
    function saveUserLiveEventStates(nk, userId, states) {
        Storage.writeJson(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_event_state_" + userId, userId, { events: states });
    }
    function getEventStatus(def) {
        var now = Math.floor(Date.now() / 1000);
        var startAt = def.startAt;
        var endAt = def.endAt;
        if (def.recurrenceCron && def.recurrenceIntervalSec) {
            var runState = computeRecurrence(def);
            startAt = runState.currentStart;
            endAt = runState.currentEnd;
        }
        if (now < startAt)
            return "upcoming";
        if (now > endAt)
            return "ended";
        return "active";
    }
    function computeRecurrence(def) {
        var now = Math.floor(Date.now() / 1000);
        var interval = def.recurrenceIntervalSec || 86400;
        var duration = def.endAt - def.startAt;
        var elapsed = now - def.startAt;
        if (elapsed < 0)
            return { currentStart: def.startAt, currentEnd: def.endAt };
        var cycleIndex = Math.floor(elapsed / interval);
        var currentStart = def.startAt + (cycleIndex * interval);
        return { currentStart: currentStart, currentEnd: currentStart + duration };
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var events = getEventDefinitions(nk);
        var userStates = getUserLiveEventStates(nk, userId);
        var result = [];
        for (var id in events) {
            var def = events[id];
            if (def.audienceId && !SatoriAudiences.isInAudience(nk, userId, def.audienceId))
                continue;
            var status = getEventStatus(def);
            if (data.names && data.names.indexOf(def.name) < 0)
                continue;
            var userState = userStates[id];
            var effectiveStart = def.startAt;
            var effectiveEnd = def.endAt;
            if (def.recurrenceCron && def.recurrenceIntervalSec) {
                var run = computeRecurrence(def);
                effectiveStart = run.currentStart;
                effectiveEnd = run.currentEnd;
            }
            result.push({
                id: id,
                name: def.name,
                description: def.description,
                category: def.category || "",
                startAt: effectiveStart,
                endAt: effectiveEnd,
                status: status,
                config: def.config,
                joined: userState ? !!userState.joinedAt : false,
                claimed: userState ? !!userState.claimedAt : false,
                hasReward: !!def.reward,
                hasGifts: !!(def.reward && def.reward.guaranteed && def.reward.guaranteed.gifts && def.reward.guaranteed.gifts.length > 0),
                prizeTiers: def.prizeTiers || [],
                sticky: !!def.sticky,
                requiresJoin: !!def.requiresJoin,
                flagOverrides: def.flagOverrides
            });
        }
        return RpcHelpers.successResponse({ events: result });
    }
    function rpcJoin(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var events = getEventDefinitions(nk);
        var def = events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var status = getEventStatus(def);
        if (status !== "active")
            return RpcHelpers.errorResponse("Event is not active");
        var userStates = getUserLiveEventStates(nk, userId);
        if (!userStates[data.eventId]) {
            userStates[data.eventId] = { eventId: data.eventId };
        }
        userStates[data.eventId].joinedAt = Math.floor(Date.now() / 1000);
        saveUserLiveEventStates(nk, userId, userStates);
        if (def.onJoinMessageId) {
            var msgDefs = ConfigLoader.loadSatoriConfig(nk, "messages", {});
            if (msgDefs[def.onJoinMessageId]) {
                SatoriMessages.deliverMessage(nk, userId, msgDefs[def.onJoinMessageId]);
            }
        }
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcClaim(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId)
            return RpcHelpers.errorResponse("eventId required");
        var events = getEventDefinitions(nk);
        var def = events[data.eventId];
        if (!def)
            return RpcHelpers.errorResponse("Event not found");
        var userStates = getUserLiveEventStates(nk, userId);
        var state = userStates[data.eventId];
        if (def.requiresJoin && (!state || !state.joinedAt))
            return RpcHelpers.errorResponse("Not joined");
        if (state && state.claimedAt)
            return RpcHelpers.errorResponse("Already claimed");
        if (!state) {
            state = { eventId: data.eventId };
            userStates[data.eventId] = state;
        }
        var reward = null;
        if (def.reward) {
            reward = RewardEngine.resolveReward(nk, def.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        }
        state.claimedAt = Math.floor(Date.now() / 1000);
        saveUserLiveEventStates(nk, userId, userStates);
        return RpcHelpers.successResponse({ reward: reward });
    }
    /**
     * Auto-join all users who have locked fantasy teams for a given season
     * to a specific live event. Called server-to-server by Intelliverse-X-AI
     * after creating a live event for a match.
     */
    function rpcAutoJoinFantasyTeamHolders(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.eventId || !data.seasonId) {
            return RpcHelpers.errorResponse("eventId and seasonId required");
        }
        var events = getEventDefinitions(nk);
        var def = events[data.eventId];
        if (!def) {
            return RpcHelpers.errorResponse("Event not found: " + data.eventId);
        }
        var keyPrefix = "team_idx_" + data.seasonId + "_";
        var cursor = "";
        var joinedCount = 0;
        var totalScanned = 0;
        var now = Math.floor(Date.now() / 1000);
        // Scan the fantasy team index (system-owned records)
        do {
            var result = nk.storageList(Constants.SYSTEM_USER_ID, Constants.FANTASY_COLLECTION, 100, cursor);
            var objects = result.objects || [];
            for (var i = 0; i < objects.length; i++) {
                var obj = objects[i];
                if (obj.key.indexOf(keyPrefix) !== 0)
                    continue;
                totalScanned++;
                var entry = obj.value;
                if (!entry.userId)
                    continue;
                // Write join state for this user
                try {
                    var userStates = getUserLiveEventStates(nk, entry.userId);
                    if (!userStates[data.eventId] || !userStates[data.eventId].joinedAt) {
                        if (!userStates[data.eventId]) {
                            userStates[data.eventId] = { eventId: data.eventId };
                        }
                        userStates[data.eventId].joinedAt = now;
                        saveUserLiveEventStates(nk, entry.userId, userStates);
                        joinedCount++;
                    }
                }
                catch (err) {
                    logger.warn("[AutoJoin] Failed to join user %s to event %s: %s", entry.userId, data.eventId, err.message);
                }
            }
            cursor = result.cursor || "";
        } while (cursor);
        logger.info("[AutoJoin] Joined %d users to event %s (scanned %d index entries for season %s)", joinedCount, data.eventId, totalScanned, data.seasonId);
        return RpcHelpers.successResponse({
            eventId: data.eventId,
            seasonId: data.seasonId,
            joinedCount: joinedCount,
            totalTeamHolders: totalScanned,
        });
    }
    function register(initializer) {
        initializer.registerRpc("satori_live_events_list", rpcList);
        initializer.registerRpc("satori_live_events_join", rpcJoin);
        initializer.registerRpc("satori_live_events_claim", rpcClaim);
        initializer.registerRpc("fantasy_auto_join_live_event", rpcAutoJoinFantasyTeamHolders);
    }
    SatoriLiveEvents.register = register;
})(SatoriLiveEvents || (SatoriLiveEvents = {}));
var SatoriMessages;
(function (SatoriMessages) {
    function getMessageDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "messages", {});
    }
    function getUserMessages(nk, userId) {
        var data = Storage.readJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId);
        return data || { messages: [] };
    }
    function saveUserMessages(nk, userId, data) {
        Storage.writeJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId, data);
    }
    function deliverMessage(nk, userId, messageDef) {
        var inbox = getUserMessages(nk, userId);
        var alreadyDelivered = false;
        for (var i = 0; i < inbox.messages.length; i++) {
            if (inbox.messages[i].messageDefId === messageDef.id) {
                alreadyDelivered = true;
                break;
            }
        }
        if (alreadyDelivered)
            return;
        var msg = {
            id: nk.uuidv4(),
            messageDefId: messageDef.id,
            title: messageDef.title,
            body: messageDef.body,
            imageUrl: messageDef.imageUrl,
            metadata: messageDef.metadata,
            reward: messageDef.reward,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: messageDef.expiresAt
        };
        inbox.messages.push(msg);
        saveUserMessages(nk, userId, inbox);
    }
    SatoriMessages.deliverMessage = deliverMessage;
    function deliverToAudience(nk, logger, messageDef, audienceId) {
        var delivered = 0;
        try {
            var users = nk.usersGetRandom(100);
            for (var i = 0; i < users.length; i++) {
                if (SatoriAudiences.isInAudience(nk, users[i].userId, audienceId)) {
                    deliverMessage(nk, users[i].userId, messageDef);
                    delivered++;
                }
            }
        }
        catch (e) {
            logger.warn("deliverToAudience error: %s", e.message || String(e));
        }
        return delivered;
    }
    SatoriMessages.deliverToAudience = deliverToAudience;
    function processScheduledMessages(nk, logger) {
        var definitions = getMessageDefinitions(nk);
        var now = Math.floor(Date.now() / 1000);
        for (var id in definitions) {
            var def = definitions[id];
            if (!def.scheduleAt || def.scheduleAt > now)
                continue;
            var deliveryState = Storage.readSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id);
            if (deliveryState && deliveryState.delivered)
                continue;
            if (def.audienceId) {
                deliverToAudience(nk, logger, def, def.audienceId);
            }
            Storage.writeSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id, { delivered: true, deliveredAt: now });
            logger.info("Delivered scheduled message: %s", id);
        }
    }
    SatoriMessages.processScheduledMessages = processScheduledMessages;
    function purgeExpired(inbox) {
        var now = Math.floor(Date.now() / 1000);
        inbox.messages = inbox.messages.filter(function (m) {
            return !m.expiresAt || m.expiresAt > now;
        });
        return inbox;
    }
    // ---- RPCs ----
    function rpcList(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        processScheduledMessages(nk, logger);
        var inbox = getUserMessages(nk, userId);
        inbox = purgeExpired(inbox);
        saveUserMessages(nk, userId, inbox);
        return RpcHelpers.successResponse({
            messages: inbox.messages.map(function (m) {
                return {
                    id: m.id,
                    title: m.title,
                    body: m.body,
                    imageUrl: m.imageUrl,
                    metadata: m.metadata,
                    hasReward: !!m.reward,
                    createdAt: m.createdAt,
                    expiresAt: m.expiresAt,
                    readAt: m.readAt,
                    consumedAt: m.consumedAt
                };
            })
        });
    }
    function rpcRead(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var inbox = getUserMessages(nk, userId);
        var msg;
        for (var i = 0; i < inbox.messages.length; i++) {
            if (inbox.messages[i].id === data.messageId) {
                msg = inbox.messages[i];
                break;
            }
        }
        if (!msg)
            return RpcHelpers.errorResponse("Message not found");
        if (!msg.readAt) {
            msg.readAt = Math.floor(Date.now() / 1000);
            saveUserMessages(nk, userId, inbox);
        }
        var reward = null;
        if (msg.reward && !msg.consumedAt) {
            reward = RewardEngine.resolveReward(nk, msg.reward);
            RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
            msg.consumedAt = Math.floor(Date.now() / 1000);
            saveUserMessages(nk, userId, inbox);
        }
        return RpcHelpers.successResponse({ message: msg, reward: reward });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.messageId)
            return RpcHelpers.errorResponse("messageId required");
        var inbox = getUserMessages(nk, userId);
        inbox.messages = inbox.messages.filter(function (m) { return m.id !== data.messageId; });
        saveUserMessages(nk, userId, inbox);
        return RpcHelpers.successResponse({ success: true });
    }
    function rpcBroadcast(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.title)
            return RpcHelpers.errorResponse("title required");
        var now = Math.floor(Date.now() / 1000);
        var msgDef = {
            id: data.id || nk.uuidv4(),
            title: data.title,
            body: data.body,
            imageUrl: data.imageUrl,
            metadata: data.metadata,
            reward: data.reward,
            audienceId: data.audienceId,
            scheduleAt: data.scheduleAt,
            expiresAt: data.expiresAt,
            createdAt: now
        };
        if (data.audienceId) {
            var delivered = deliverToAudience(nk, logger, msgDef, data.audienceId);
            return RpcHelpers.successResponse({ delivered: delivered, audienceId: data.audienceId });
        }
        var definitions = getMessageDefinitions(nk);
        definitions[msgDef.id] = msgDef;
        ConfigLoader.saveSatoriConfig(nk, "messages", definitions);
        return RpcHelpers.successResponse({ scheduled: true, messageId: msgDef.id });
    }
    function register(initializer) {
        initializer.registerRpc("satori_messages_list", rpcList);
        initializer.registerRpc("satori_messages_read", rpcRead);
        initializer.registerRpc("satori_messages_delete", rpcDelete);
        initializer.registerRpc("satori_messages_broadcast", rpcBroadcast);
    }
    SatoriMessages.register = register;
})(SatoriMessages || (SatoriMessages = {}));
var SatoriMetrics;
(function (SatoriMetrics) {
    function getMetricDefinitions(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "metrics", {});
    }
    function getMetricState(nk, metricId) {
        var data = Storage.readSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, metricId);
        return data || { buckets: {} };
    }
    function saveMetricState(nk, metricId, state) {
        Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, metricId, state);
    }
    function processEvent(nk, logger, userId, eventName, metadata) {
        var definitions = getMetricDefinitions(nk);
        for (var id in definitions) {
            var def = definitions[id];
            if (def.eventName !== eventName)
                continue;
            var state = getMetricState(nk, id);
            var now = Math.floor(Date.now() / 1000);
            var bucketKey = def.windowSec ? String(Math.floor(now / def.windowSec) * def.windowSec) : "all";
            if (!state.buckets[bucketKey]) {
                state.buckets[bucketKey] = { value: 0, count: 0, uniqueUsers: [] };
            }
            var bucket = state.buckets[bucketKey];
            var numericValue = 1;
            if (def.metadataField && metadata[def.metadataField]) {
                numericValue = parseFloat(metadata[def.metadataField]) || 1;
            }
            switch (def.aggregation) {
                case "count":
                    bucket.value++;
                    break;
                case "sum":
                    bucket.value += numericValue;
                    break;
                case "avg":
                    bucket.value = ((bucket.value * bucket.count) + numericValue) / (bucket.count + 1);
                    break;
                case "min":
                    bucket.value = bucket.count === 0 ? numericValue : Math.min(bucket.value, numericValue);
                    break;
                case "max":
                    bucket.value = Math.max(bucket.value, numericValue);
                    break;
                case "unique":
                    if (bucket.uniqueUsers.indexOf(userId) < 0) {
                        bucket.uniqueUsers.push(userId);
                        bucket.value = bucket.uniqueUsers.length;
                    }
                    break;
            }
            bucket.count++;
            saveMetricState(nk, id, state);
            checkAlerts(nk, logger, id, bucket.value);
        }
    }
    SatoriMetrics.processEvent = processEvent;
    function getAlerts(nk) {
        var data = Storage.readSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts");
        return (data && data.alerts) || [];
    }
    function checkAlerts(nk, logger, metricId, value) {
        var alerts = getAlerts(nk);
        for (var i = 0; i < alerts.length; i++) {
            var alert = alerts[i];
            if (!alert.enabled || alert.metricId !== metricId)
                continue;
            var triggered = false;
            switch (alert.operator) {
                case "gt":
                    triggered = value > alert.threshold;
                    break;
                case "lt":
                    triggered = value < alert.threshold;
                    break;
                case "gte":
                    triggered = value >= alert.threshold;
                    break;
                case "lte":
                    triggered = value <= alert.threshold;
                    break;
            }
            if (triggered) {
                logger.warn("[MetricAlert] %s triggered: %s = %f (threshold: %f)", alert.name, metricId, value, alert.threshold);
                Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alert_triggered_" + alert.name, {
                    alert: alert, value: value, triggeredAt: Math.floor(Date.now() / 1000)
                });
            }
        }
    }
    // ---- RPCs ----
    function rpcQuery(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        var definitions = getMetricDefinitions(nk);
        var results = [];
        var now = Math.floor(Date.now() / 1000);
        var metricIds = data.metricIds || Object.keys(definitions);
        for (var i = 0; i < metricIds.length; i++) {
            var metricId = metricIds[i];
            var state = getMetricState(nk, metricId);
            var latestBucket = "all";
            var latestTime = 0;
            for (var bk in state.buckets) {
                var bkTime = parseInt(bk) || 0;
                if (bkTime > latestTime) {
                    latestTime = bkTime;
                    latestBucket = bk;
                }
            }
            var bucket = state.buckets[latestBucket];
            if (bucket) {
                results.push({
                    metricId: metricId,
                    value: bucket.value,
                    computedAt: now
                });
            }
        }
        return RpcHelpers.successResponse({ metrics: results });
    }
    function rpcDefine(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.name || !data.eventName || !data.aggregation) {
            return RpcHelpers.errorResponse("id, name, eventName, and aggregation required");
        }
        var definitions = getMetricDefinitions(nk);
        definitions[data.id] = {
            id: data.id,
            name: data.name,
            eventName: data.eventName,
            metadataField: data.metadataField,
            aggregation: data.aggregation,
            windowSec: data.windowSec
        };
        ConfigLoader.saveSatoriConfig(nk, "metrics", definitions);
        return RpcHelpers.successResponse({ metric: definitions[data.id] });
    }
    function rpcSetAlert(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.metricId || !data.name || data.threshold === undefined || !data.operator) {
            return RpcHelpers.errorResponse("metricId, name, threshold, and operator required");
        }
        var alerts = getAlerts(nk);
        var existing = false;
        for (var i = 0; i < alerts.length; i++) {
            if (alerts[i].name === data.name) {
                alerts[i] = { metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false };
                existing = true;
                break;
            }
        }
        if (!existing) {
            alerts.push({ metricId: data.metricId, threshold: data.threshold, operator: data.operator, name: data.name, enabled: data.enabled !== false });
        }
        Storage.writeSystemJson(nk, Constants.SATORI_METRICS_COLLECTION, "alerts", { alerts: alerts });
        return RpcHelpers.successResponse({ alerts: alerts });
    }
    function rpcPrometheus(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var definitions = getMetricDefinitions(nk);
        var lines = [];
        for (var id in definitions) {
            var state = getMetricState(nk, id);
            var latestValue = 0;
            var latestTime = 0;
            for (var bk in state.buckets) {
                var bkTime = parseInt(bk) || 0;
                if (bkTime >= latestTime) {
                    latestTime = bkTime;
                    latestValue = state.buckets[bk].value;
                }
            }
            var safeName = id.replace(/[^a-zA-Z0-9_]/g, "_");
            lines.push("# HELP " + safeName + " " + (definitions[id].name || id));
            lines.push("# TYPE " + safeName + " gauge");
            lines.push(safeName + " " + latestValue);
        }
        return RpcHelpers.successResponse({ text: lines.join("\n") });
    }
    function register(initializer) {
        initializer.registerRpc("satori_metrics_query", rpcQuery);
        initializer.registerRpc("satori_metrics_define", rpcDefine);
        initializer.registerRpc("satori_metrics_set_alert", rpcSetAlert);
        initializer.registerRpc("satori_metrics_prometheus", rpcPrometheus);
    }
    SatoriMetrics.register = register;
    function registerEventHandlers() {
        EventBus.on(EventBus.Events.CURRENCY_EARNED, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "currency_earned", { currency: data.currencyId, amount: String(data.amount) });
        });
        EventBus.on(EventBus.Events.CURRENCY_SPENT, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "currency_spent", { currency: data.currencyId, amount: String(data.amount) });
        });
        EventBus.on(EventBus.Events.STORE_PURCHASE, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "store_purchase", { offerId: data.offerId });
        });
        EventBus.on(EventBus.Events.GAME_COMPLETED, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "game_completed", { gameId: data.gameId });
        });
        EventBus.on(EventBus.Events.SESSION_START, function (nk, logger, ctx, data) {
            processEvent(nk, logger, data.userId, "session_start", {});
        });
    }
    SatoriMetrics.registerEventHandlers = registerEventHandlers;
})(SatoriMetrics || (SatoriMetrics = {}));
var SatoriTaxonomy;
(function (SatoriTaxonomy) {
    var DEFAULT_CONFIG = {
        schemas: {},
        enforceStrict: false,
        maxEventNameLength: 128,
        maxMetadataValueLength: 1024,
        allowedCategories: ["engagement", "monetization", "progression", "social", "system", "custom"]
    };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "taxonomy", DEFAULT_CONFIG);
    }
    function validateEvent(nk, event) {
        var config = getConfig(nk);
        var errors = [];
        var warnings = [];
        if (!event.name) {
            errors.push("Event name is required");
            return { valid: false, errors: errors, warnings: warnings };
        }
        if (event.name.length > config.maxEventNameLength) {
            errors.push("Event name exceeds max length of " + config.maxEventNameLength);
        }
        var schema = config.schemas[event.name];
        if (!schema && config.enforceStrict) {
            errors.push("Unknown event '" + event.name + "' (strict mode enabled)");
            return { valid: false, errors: errors, warnings: warnings };
        }
        if (!schema) {
            warnings.push("No schema defined for event '" + event.name + "'");
            return { valid: errors.length === 0, errors: errors, warnings: warnings };
        }
        if (schema.deprecated) {
            warnings.push("Event '" + event.name + "' is deprecated");
        }
        if (schema.requiredMetadata && event.metadata) {
            for (var i = 0; i < schema.requiredMetadata.length; i++) {
                var reqKey = schema.requiredMetadata[i];
                if (event.metadata[reqKey] === undefined || event.metadata[reqKey] === null) {
                    errors.push("Missing required metadata key: " + reqKey);
                }
            }
        }
        else if (schema.requiredMetadata && schema.requiredMetadata.length > 0 && !event.metadata) {
            errors.push("Metadata required but not provided");
        }
        if (event.metadata) {
            var metaKeys = Object.keys(event.metadata);
            if (schema.maxMetadataKeys && metaKeys.length > schema.maxMetadataKeys) {
                errors.push("Too many metadata keys: " + metaKeys.length + " (max " + schema.maxMetadataKeys + ")");
            }
            for (var j = 0; j < metaKeys.length; j++) {
                var val = event.metadata[metaKeys[j]];
                if (val && val.length > config.maxMetadataValueLength) {
                    errors.push("Metadata value for '" + metaKeys[j] + "' exceeds max length");
                }
                if (schema.metadataTypes && schema.metadataTypes[metaKeys[j]]) {
                    var expectedType = schema.metadataTypes[metaKeys[j]];
                    if (expectedType === "number" && isNaN(parseFloat(val))) {
                        errors.push("Metadata '" + metaKeys[j] + "' should be a number");
                    }
                    if (expectedType === "boolean" && val !== "true" && val !== "false") {
                        errors.push("Metadata '" + metaKeys[j] + "' should be 'true' or 'false'");
                    }
                }
            }
        }
        return { valid: errors.length === 0, errors: errors, warnings: warnings };
    }
    SatoriTaxonomy.validateEvent = validateEvent;
    function rpcGetSchemas(ctx, logger, nk, payload) {
        var config = getConfig(nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (data.category) {
            var filtered = {};
            for (var name in config.schemas) {
                if (config.schemas[name].category === data.category)
                    filtered[name] = config.schemas[name];
            }
            return RpcHelpers.successResponse({ schemas: filtered, category: data.category });
        }
        return RpcHelpers.successResponse({
            schemas: config.schemas,
            enforceStrict: config.enforceStrict,
            categories: config.allowedCategories,
            totalSchemas: Object.keys(config.schemas).length
        });
    }
    function rpcUpsertSchema(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var config = getConfig(nk);
        config.schemas[data.name] = {
            name: data.name,
            description: data.description || "",
            category: data.category || "custom",
            requiredMetadata: data.requiredMetadata || [],
            optionalMetadata: data.optionalMetadata || [],
            metadataTypes: data.metadataTypes || {},
            maxMetadataKeys: data.maxMetadataKeys || 50,
            deprecated: data.deprecated || false
        };
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ schema: config.schemas[data.name] });
    }
    function rpcDeleteSchema(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var config = getConfig(nk);
        delete config.schemas[data.name];
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ deleted: data.name });
    }
    function rpcValidateEvent(ctx, logger, nk, payload) {
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.name)
            return RpcHelpers.errorResponse("name required");
        var result = validateEvent(nk, { name: data.name, timestamp: Math.floor(Date.now() / 1000), metadata: data.metadata });
        return RpcHelpers.successResponse(result);
    }
    function rpcSetStrictMode(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        var config = getConfig(nk);
        config.enforceStrict = !!data.enforceStrict;
        ConfigLoader.saveSatoriConfig(nk, "taxonomy", config);
        return RpcHelpers.successResponse({ enforceStrict: config.enforceStrict });
    }
    function register(initializer) {
        initializer.registerRpc("satori_taxonomy_schemas", rpcGetSchemas);
        initializer.registerRpc("satori_taxonomy_upsert", rpcUpsertSchema);
        initializer.registerRpc("satori_taxonomy_delete", rpcDeleteSchema);
        initializer.registerRpc("satori_taxonomy_validate", rpcValidateEvent);
        initializer.registerRpc("satori_taxonomy_strict_mode", rpcSetStrictMode);
    }
    SatoriTaxonomy.register = register;
})(SatoriTaxonomy || (SatoriTaxonomy = {}));
var SatoriVideoFeed;
(function (SatoriVideoFeed) {
    var COLLECTION = "satori_video_feed";
    var INDEX_KEY = "videos_index";
    var MAX_FEED_SIZE = 200;
    function getIndex(nk) {
        return Storage.readSystemJson(nk, COLLECTION, INDEX_KEY) || { videoIds: [] };
    }
    function saveIndex(nk, index) {
        Storage.writeSystemJson(nk, COLLECTION, INDEX_KEY, index);
    }
    function getVideo(nk, videoId) {
        return Storage.readSystemJson(nk, COLLECTION, videoId);
    }
    function saveVideo(nk, video) {
        Storage.writeSystemJson(nk, COLLECTION, video.id, video);
    }
    function rpcList(ctx, logger, nk, payload) {
        RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var filterRegion = data.region ? String(data.region) : "";
        var filterSeries = data.series ? String(data.series) : "";
        var filterCategory = data.category ? String(data.category) : "";
        var filterEventId = data.eventId ? String(data.eventId) : "";
        var limit = typeof data.limit === "number" ? Math.min(100, Math.max(1, data.limit)) : 20;
        var index = getIndex(nk);
        var now = Math.floor(Date.now() / 1000);
        var results = [];
        for (var i = 0; i < index.videoIds.length; i++) {
            var v = getVideo(nk, index.videoIds[i]);
            if (!v)
                continue;
            if (v.expiresAt && v.expiresAt > 0 && v.expiresAt < now)
                continue;
            if (filterRegion && v.region !== filterRegion && v.region !== "global")
                continue;
            if (filterSeries && v.series !== filterSeries)
                continue;
            if (filterCategory && v.category !== filterCategory)
                continue;
            if (filterEventId && v.eventId !== filterEventId)
                continue;
            results.push(v);
        }
        results.sort(function (a, b) {
            if (a.priority !== b.priority)
                return b.priority - a.priority;
            return b.publishedAt - a.publishedAt;
        });
        if (results.length > limit)
            results = results.slice(0, limit);
        return RpcHelpers.successResponse({ videos: results, total: results.length });
    }
    function rpcAdd(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.videoUrl)
            return RpcHelpers.errorResponse("videoUrl required");
        if (!data.title)
            return RpcHelpers.errorResponse("title required");
        var id = data.id ? String(data.id) : nk.uuidv4();
        var video = {
            id: id,
            title: String(data.title),
            description: String(data.description || ""),
            videoUrl: String(data.videoUrl),
            thumbnailUrl: String(data.thumbnailUrl || ""),
            platform: String(data.platform || "youtube"),
            category: String(data.category || "general"),
            region: String(data.region || "global"),
            series: String(data.series || "custom"),
            eventId: data.eventId ? String(data.eventId) : undefined,
            deepLinkUrl: data.deepLinkUrl ? String(data.deepLinkUrl) : undefined,
            seriesPart: typeof data.seriesPart === "number" ? data.seriesPart : undefined,
            mysteryId: data.mysteryId ? String(data.mysteryId) : undefined,
            publishedAt: typeof data.publishedAt === "number" ? data.publishedAt : Math.floor(Date.now() / 1000),
            expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : 0,
            priority: typeof data.priority === "number" ? data.priority : 0,
            views: typeof data.views === "number" ? data.views : 0,
            clicks: typeof data.clicks === "number" ? data.clicks : 0,
            metadata: data.metadata || undefined,
        };
        saveVideo(nk, video);
        var index = getIndex(nk);
        var existingIdx = index.videoIds.indexOf(id);
        if (existingIdx < 0) {
            index.videoIds.push(id);
        }
        // Prune old entries beyond MAX_FEED_SIZE
        if (index.videoIds.length > MAX_FEED_SIZE) {
            var all = [];
            for (var j = 0; j < index.videoIds.length; j++) {
                var vv = getVideo(nk, index.videoIds[j]);
                if (vv)
                    all.push(vv);
            }
            all.sort(function (a, b) { return b.publishedAt - a.publishedAt; });
            var keep = all.slice(0, MAX_FEED_SIZE);
            var keepIds = [];
            for (var k = 0; k < keep.length; k++)
                keepIds.push(keep[k].id);
            index.videoIds = keepIds;
        }
        saveIndex(nk, index);
        logger.info("[VideoFeed] Added video %s (%s/%s)", id, video.series, video.category);
        return RpcHelpers.successResponse({ success: true, videoId: id });
    }
    function rpcRemove(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.videoId)
            return RpcHelpers.errorResponse("videoId required");
        var id = String(data.videoId);
        var index = getIndex(nk);
        var idx = index.videoIds.indexOf(id);
        if (idx >= 0) {
            index.videoIds.splice(idx, 1);
            saveIndex(nk, index);
        }
        try {
            nk.storageDelete([{ collection: COLLECTION, key: id, userId: Constants.SYSTEM_USER_ID }]);
        }
        catch (err) {
            logger.warn("[VideoFeed] Failed to delete video %s: %s", id, err.message || String(err));
        }
        return RpcHelpers.successResponse({ success: true, videoId: id });
    }
    function rpcTrackClick(ctx, logger, nk, payload) {
        RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.videoId)
            return RpcHelpers.errorResponse("videoId required");
        var v = getVideo(nk, String(data.videoId));
        if (!v)
            return RpcHelpers.errorResponse("Video not found");
        var field = data.field === "view" ? "view" : "click";
        if (field === "view")
            v.views = (v.views || 0) + 1;
        else
            v.clicks = (v.clicks || 0) + 1;
        saveVideo(nk, v);
        return RpcHelpers.successResponse({ success: true, videoId: v.id, views: v.views, clicks: v.clicks });
    }
    function register(initializer) {
        initializer.registerRpc("video_feed_list", rpcList);
        initializer.registerRpc("video_feed_add", rpcAdd);
        initializer.registerRpc("video_feed_remove", rpcRemove);
        initializer.registerRpc("video_feed_track", rpcTrackClick);
    }
    SatoriVideoFeed.register = register;
})(SatoriVideoFeed || (SatoriVideoFeed = {}));
var SatoriWebhooks;
(function (SatoriWebhooks) {
    var DEFAULT_CONFIG = { webhooks: [] };
    function getConfig(nk) {
        return ConfigLoader.loadSatoriConfig(nk, "webhooks", DEFAULT_CONFIG);
    }
    function dispatch(nk, logger, eventName, payload) {
        var config = getConfig(nk);
        if (!config.webhooks || config.webhooks.length === 0)
            return;
        for (var i = 0; i < config.webhooks.length; i++) {
            var wh = config.webhooks[i];
            if (!wh.enabled)
                continue;
            if (wh.events.indexOf(eventName) === -1 && wh.events.indexOf("*") === -1)
                continue;
            try {
                var body = JSON.stringify({
                    event: eventName,
                    timestamp: Math.floor(Date.now() / 1000),
                    data: payload
                });
                var headers = {
                    "Content-Type": "application/json",
                    "X-Webhook-Event": eventName
                };
                if (wh.secret) {
                    var sigBytes = nk.hmacSha256Hash(wh.secret, body);
                    headers["X-Webhook-Signature"] = nk.binaryToString(sigBytes);
                }
                if (wh.headers) {
                    for (var h in wh.headers) {
                        headers[h] = wh.headers[h];
                    }
                }
                nk.httpRequest(wh.url, "post", headers, body);
            }
            catch (e) {
                logger.warn("[Webhooks] Failed to dispatch '%s' to %s: %s", eventName, wh.url, e.message || String(e));
            }
        }
    }
    SatoriWebhooks.dispatch = dispatch;
    function rpcList(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var config = getConfig(nk);
        return RpcHelpers.successResponse({ webhooks: config.webhooks });
    }
    function rpcUpsert(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id || !data.url || !data.events)
            return RpcHelpers.errorResponse("id, url, and events[] required");
        var config = getConfig(nk);
        var existing = config.webhooks.findIndex(function (w) { return w.id === data.id; });
        var wh = {
            id: data.id,
            url: data.url,
            events: data.events,
            enabled: data.enabled !== false,
            secret: data.secret,
            headers: data.headers,
            retryCount: data.retryCount || 0,
            timeoutMs: data.timeoutMs || 5000
        };
        if (existing >= 0) {
            config.webhooks[existing] = wh;
        }
        else {
            config.webhooks.push(wh);
        }
        ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
        return RpcHelpers.successResponse({ webhook: wh });
    }
    function rpcDelete(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        config.webhooks = config.webhooks.filter(function (w) { return w.id !== data.id; });
        ConfigLoader.saveSatoriConfig(nk, "webhooks", config);
        return RpcHelpers.successResponse({ deleted: data.id });
    }
    function rpcTest(ctx, logger, nk, payload) {
        RpcHelpers.requireAdmin(ctx, nk);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.id)
            return RpcHelpers.errorResponse("id required");
        var config = getConfig(nk);
        var wh = config.webhooks.find(function (w) { return w.id === data.id; });
        if (!wh)
            return RpcHelpers.errorResponse("Webhook not found");
        try {
            dispatch(nk, logger, "test_ping", { message: "Test webhook dispatch", webhookId: data.id });
            return RpcHelpers.successResponse({ success: true, url: wh.url });
        }
        catch (e) {
            return RpcHelpers.errorResponse("Test failed: " + (e.message || String(e)));
        }
    }
    function register(initializer) {
        initializer.registerRpc("satori_webhooks_list", rpcList);
        initializer.registerRpc("satori_webhooks_upsert", rpcUpsert);
        initializer.registerRpc("satori_webhooks_delete", rpcDelete);
        initializer.registerRpc("satori_webhooks_test", rpcTest);
    }
    SatoriWebhooks.register = register;
    function registerEventHandlers() {
        var events = [
            EventBus.Events.CURRENCY_EARNED, EventBus.Events.CURRENCY_SPENT,
            EventBus.Events.ITEM_GRANTED, EventBus.Events.ITEM_CONSUMED,
            EventBus.Events.ACHIEVEMENT_COMPLETED, EventBus.Events.ACHIEVEMENT_CLAIMED,
            EventBus.Events.LEVEL_UP, EventBus.Events.STORE_PURCHASE,
            EventBus.Events.GAME_STARTED, EventBus.Events.GAME_COMPLETED,
            EventBus.Events.SESSION_START, EventBus.Events.SESSION_END,
            EventBus.Events.EVENT_CREATED, EventBus.Events.EVENT_PUBLISHED,
            EventBus.Events.EVENT_ENDED, EventBus.Events.EVENT_CANCELLED,
            EventBus.Events.QUIZ_COMPLETED, EventBus.Events.SCORE_SUBMITTED,
            EventBus.Events.REWARD_GRANTED
        ];
        for (var i = 0; i < events.length; i++) {
            (function (eventName) {
                EventBus.on(eventName, function (nk, logger, _ctx, data) {
                    dispatch(nk, logger, eventName, data);
                });
            })(events[i]);
        }
    }
    SatoriWebhooks.registerEventHandlers = registerEventHandlers;
})(SatoriWebhooks || (SatoriWebhooks = {}));
var ConfigLoader;
(function (ConfigLoader) {
    var configCache = {};
    var CACHE_TTL_MS = 60000; // 1 minute
    function loadConfig(nk, configKey, defaultValue) {
        var now = Date.now();
        var cached = configCache[configKey];
        if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
        var data = Storage.readSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey);
        if (!data) {
            data = defaultValue;
        }
        configCache[configKey] = { data: data, loadedAt: now };
        return data;
    }
    ConfigLoader.loadConfig = loadConfig;
    function loadSatoriConfig(nk, configKey, defaultValue) {
        var now = Date.now();
        var cacheKey = "satori_" + configKey;
        var cached = configCache[cacheKey];
        if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
            return cached.data;
        }
        var data = Storage.readSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey);
        if (!data) {
            data = defaultValue;
        }
        configCache[cacheKey] = { data: data, loadedAt: now };
        return data;
    }
    ConfigLoader.loadSatoriConfig = loadSatoriConfig;
    function saveConfig(nk, configKey, data) {
        Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey, data);
        delete configCache[configKey];
    }
    ConfigLoader.saveConfig = saveConfig;
    function saveSatoriConfig(nk, configKey, data) {
        Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey, data);
        delete configCache["satori_" + configKey];
    }
    ConfigLoader.saveSatoriConfig = saveSatoriConfig;
    function invalidateCache(configKey) {
        if (configKey) {
            delete configCache[configKey];
            delete configCache["satori_" + configKey];
        }
        else {
            configCache = {};
        }
    }
    ConfigLoader.invalidateCache = invalidateCache;
})(ConfigLoader || (ConfigLoader = {}));
var Constants;
(function (Constants) {
    Constants.SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
    Constants.DEFAULT_GAME_ID = "default";
    function gameKey(gameId, key) {
        var gid = gameId || Constants.DEFAULT_GAME_ID;
        if (gid === Constants.DEFAULT_GAME_ID)
            return key;
        return gid + ":" + key;
    }
    Constants.gameKey = gameKey;
    // Hiro storage collections
    Constants.HIRO_CONFIGS_COLLECTION = "hiro_configs";
    Constants.HIRO_ACHIEVEMENTS_COLLECTION = "hiro_achievements";
    Constants.HIRO_INVENTORY_COLLECTION = "hiro_inventory";
    Constants.HIRO_PROGRESSION_COLLECTION = "hiro_progression";
    Constants.HIRO_ENERGY_COLLECTION = "hiro_energy";
    Constants.HIRO_STATS_COLLECTION = "hiro_stats";
    Constants.HIRO_STREAKS_COLLECTION = "hiro_streaks";
    Constants.HIRO_TUTORIALS_COLLECTION = "hiro_tutorials";
    Constants.HIRO_UNLOCKABLES_COLLECTION = "hiro_unlockables";
    Constants.HIRO_MAILBOX_COLLECTION = "hiro_mailbox";
    Constants.HIRO_CHALLENGES_COLLECTION = "hiro_challenges";
    Constants.HIRO_AUCTIONS_COLLECTION = "hiro_auctions";
    // Satori storage collections
    Constants.SATORI_CONFIGS_COLLECTION = "satori_configs";
    Constants.SATORI_EVENTS_COLLECTION = "satori_events";
    Constants.SATORI_IDENTITY_COLLECTION = "satori_identity_props";
    Constants.SATORI_ASSIGNMENTS_COLLECTION = "satori_assignments";
    Constants.SATORI_MESSAGES_COLLECTION = "satori_messages";
    Constants.SATORI_METRICS_COLLECTION = "satori_metrics";
    // Cricket Auction storage collections
    Constants.CRICKET_AUCTION_COLLECTION = "cricket_auctions";
    Constants.CRICKET_AUCTION_EVENTS_COLLECTION = "cricket_auction_events";
    // Cricket Director storage collections
    Constants.CRICKET_DIRECTOR_COLLECTION = "cricket_director_sessions";
    // Fantasy Cricket storage collections
    Constants.FANTASY_COLLECTION = "fantasy_cricket";
    Constants.FANTASY_SEASON_LEADERBOARD = "fantasy_season";
    Constants.FANTASY_MATCH_LB_PREFIX = "fantasy_match_";
    Constants.FANTASY_LEAGUE_LB_PREFIX = "fantasy_league_";
    // Legacy storage collections (preserved for backward compatibility)
    Constants.WALLETS_COLLECTION = "wallets";
    Constants.LEADERBOARDS_REGISTRY_COLLECTION = "leaderboards_registry";
    Constants.DAILY_REWARDS_COLLECTION = "daily_rewards";
    Constants.MISSIONS_COLLECTION = "missions";
    Constants.QUIZ_RESULTS_COLLECTION = "quiz_results";
    Constants.GAME_REGISTRY_COLLECTION = "game_registry";
    Constants.ANALYTICS_COLLECTION = "analytics_error_events";
    Constants.PLAYER_METADATA_COLLECTION = "player_metadata";
    Constants.PUSH_TOKENS_COLLECTION = "push_tokens";
})(Constants || (Constants = {}));
var EventBus;
(function (EventBus) {
    var handlers = {};
    function on(eventName, handler) {
        if (!handlers[eventName]) {
            handlers[eventName] = [];
        }
        handlers[eventName].push(handler);
    }
    EventBus.on = on;
    function emit(nk, logger, ctx, eventName, data) {
        var eventHandlers = handlers[eventName];
        if (!eventHandlers)
            return;
        for (var i = 0; i < eventHandlers.length; i++) {
            try {
                eventHandlers[i](nk, logger, ctx, data);
            }
            catch (err) {
                logger.error("EventBus handler error for '%s': %s", eventName, err.message || String(err));
            }
        }
    }
    EventBus.emit = emit;
    // Well-known event names
    EventBus.Events = {
        CURRENCY_SPENT: "currency_spent",
        CURRENCY_EARNED: "currency_earned",
        ITEM_GRANTED: "item_granted",
        ITEM_CONSUMED: "item_consumed",
        ACHIEVEMENT_PROGRESS: "achievement_progress",
        ACHIEVEMENT_COMPLETED: "achievement_completed",
        ACHIEVEMENT_CLAIMED: "achievement_claimed",
        LEVEL_UP: "level_up",
        XP_EARNED: "xp_earned",
        ENERGY_SPENT: "energy_spent",
        ENERGY_REFILLED: "energy_refilled",
        STAT_UPDATED: "stat_updated",
        STREAK_UPDATED: "streak_updated",
        STREAK_BROKEN: "streak_broken",
        STORE_PURCHASE: "store_purchase",
        SCORE_SUBMITTED: "score_submitted",
        CHALLENGE_COMPLETED: "challenge_completed",
        REWARD_GRANTED: "reward_granted",
        GAME_STARTED: "game_started",
        GAME_COMPLETED: "game_completed",
        SESSION_START: "session_start",
        SESSION_END: "session_end",
        EVENT_CREATED: "event_created",
        EVENT_PUBLISHED: "event_published",
        EVENT_ENDED: "event_ended",
        EVENT_CANCELLED: "event_cancelled",
        QUIZ_COMPLETED: "quiz_completed",
    };
})(EventBus || (EventBus = {}));
// ──────────────────────────────────────────────────────────────────────────
// JS-runtime health probe RPC (`nakama_js_health`).
//
// Why this exists (cbeacf6 outage, 2026-04-22):
//   The k8s probe is `GET /healthcheck`, which is Nakama's HTTP server
//   liveness check. It returns 200 even when the JavaScript runtime
//   provider failed to compile any modules — so pods come up "Ready"
//   while every game RPC is dead. The cbeacf6 deploy ran in that state
//   for 7+ hours before anyone noticed.
//
// What this RPC does:
//   • Just being callable proves the JS runtime is alive (the bundle
//     compiled, InitModule ran, this RPC was registered).
//   • Returns the auto-discovered TS-owned RPC count from
//     __TS_OWNED_RPCS so the CI smoke-test can also assert "we
//     registered the expected number of RPCs", catching silent dropouts.
//
// Wire-up:
//   • Registered as `nakama_js_health` in src/main.ts (BEFORE the legacy
//     bridge so it's also available in the trivial case where the bridge
//     itself failed).
//   • The k8s deployment (intelli-verse-kube-infra/nakama/deployment.yaml)
//     should call it via:
//       livenessProbe:
//         exec:
//           command:
//             - /bin/sh
//             - -c
//             - 'curl -fsS -X POST http://127.0.0.1:7350/v2/rpc/nakama_js_health?http_key=$HTTP_KEY -H "Content-Type: application/json" -d "{}" >/dev/null'
//         initialDelaySeconds: 30
//         periodSeconds: 30
//         failureThreshold: 3
//   • CI buildspec.yml runs the same curl post-rollout as a deploy gate.
//
// Safe to call publicly — returns no PII, only counts. Authentication is
// required by Nakama's default (any session token, or http_key for
// server-to-server). Does NOT require admin auth so the probe sidecar
// doesn't need to carry the dashboard secret.
// ──────────────────────────────────────────────────────────────────────────
var JsRuntimeHealth;
(function (JsRuntimeHealth) {
    function register(initializer) {
        initializer.registerRpc("nakama_js_health", rpcHealth);
    }
    JsRuntimeHealth.register = register;
    function rpcHealth(_ctx, _logger, _nk, _payload) {
        var tsOwned = (typeof __TS_OWNED_RPCS !== "undefined" && __TS_OWNED_RPCS) ? __TS_OWNED_RPCS : {};
        var tsOwnedCount = 0;
        for (var k in tsOwned) {
            if (Object.prototype.hasOwnProperty.call(tsOwned, k))
                tsOwnedCount++;
        }
        return JSON.stringify({
            ok: true,
            runtime: "javascript",
            ts_owned_rpc_count: tsOwnedCount,
            // ISO-8601 timestamp so logs/metrics can correlate. Using Date()
            // directly is safe in Goja (it implements ECMAScript Date).
            now: new Date().toISOString(),
        });
    }
})(JsRuntimeHealth || (JsRuntimeHealth = {}));
var HttpClient;
(function (HttpClient) {
    function get(nk, url, headers) {
        var resp = nk.httpRequest(url, "get", headers || {}, "");
        return { code: resp.code, body: resp.body, headers: resp.headers || {} };
    }
    HttpClient.get = get;
    function post(nk, url, body, headers) {
        var hdrs = headers || {};
        if (!hdrs["Content-Type"]) {
            hdrs["Content-Type"] = "application/json";
        }
        var resp = nk.httpRequest(url, "post", hdrs, body);
        return { code: resp.code, body: resp.body, headers: resp.headers || {} };
    }
    HttpClient.post = post;
    function postJson(nk, url, data, headers) {
        var resp = post(nk, url, JSON.stringify(data), headers);
        if (resp.code >= 200 && resp.code < 300) {
            try {
                return JSON.parse(resp.body);
            }
            catch (_) {
                return resp.body;
            }
        }
        throw new Error("HTTP " + resp.code + ": " + resp.body);
    }
    HttpClient.postJson = postJson;
    function signedPost(nk, url, data, secret, additionalHeaders) {
        var body = JSON.stringify(data);
        var signatureBytes = nk.hmacSha256Hash(secret, body);
        var signature = nk.binaryToString(signatureBytes);
        var headers = {
            "Content-Type": "application/json",
            "X-Webhook-Signature": signature
        };
        if (additionalHeaders) {
            for (var k in additionalHeaders) {
                headers[k] = additionalHeaders[k];
            }
        }
        return postJson(nk, url, data, headers);
    }
    HttpClient.signedPost = signedPost;
})(HttpClient || (HttpClient = {}));
var RewardEngine;
(function (RewardEngine) {
    function resolveReward(nk, reward) {
        var result = {
            currencies: {},
            items: {},
            energies: {},
            gifts: [],
            modifiers: []
        };
        if (reward.guaranteed) {
            mergeGrant(result, reward.guaranteed);
        }
        if (reward.weighted && reward.weighted.length > 0) {
            var rolls = reward.maxRolls || 1;
            for (var r = 0; r < rolls; r++) {
                var picked = pickWeighted(nk, reward.weighted);
                if (picked) {
                    mergeGrant(result, picked);
                }
            }
        }
        return result;
    }
    RewardEngine.resolveReward = resolveReward;
    function pickWeighted(nk, pool) {
        var totalWeight = 0;
        for (var i = 0; i < pool.length; i++) {
            totalWeight += pool[i].weight;
        }
        if (totalWeight <= 0)
            return null;
        var randStr = nk.uuidv4();
        var rand = simpleHash(randStr) % totalWeight;
        var cumulative = 0;
        for (var j = 0; j < pool.length; j++) {
            cumulative += pool[j].weight;
            if (rand < cumulative) {
                return pool[j];
            }
        }
        return pool[pool.length - 1];
    }
    function simpleHash(str) {
        var hash = 0;
        for (var i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & 0x7FFFFFFF;
        }
        return hash;
    }
    function mergeGrant(target, grant) {
        if (grant.currencies) {
            for (var cid in grant.currencies) {
                if (!target.currencies[cid])
                    target.currencies[cid] = 0;
                target.currencies[cid] += grant.currencies[cid];
            }
        }
        if (grant.items) {
            for (var iid in grant.items) {
                var itemDef = grant.items[iid];
                var qty = itemDef.min;
                if (itemDef.max && itemDef.max > itemDef.min) {
                    qty = itemDef.min + Math.floor(Math.random() * (itemDef.max - itemDef.min + 1));
                }
                if (!target.items[iid])
                    target.items[iid] = 0;
                target.items[iid] += qty;
            }
        }
        if (grant.energies) {
            for (var eid in grant.energies) {
                if (!target.energies[eid])
                    target.energies[eid] = 0;
                target.energies[eid] += grant.energies[eid];
            }
        }
        if (grant.gifts) {
            for (var g = 0; g < grant.gifts.length; g++) {
                target.gifts.push(grant.gifts[g]);
            }
        }
        if (grant.energyModifiers) {
            for (var m = 0; m < grant.energyModifiers.length; m++) {
                target.modifiers.push(grant.energyModifiers[m]);
            }
        }
        if (grant.rewardModifiers) {
            for (var n = 0; n < grant.rewardModifiers.length; n++) {
                target.modifiers.push(grant.rewardModifiers[n]);
            }
        }
    }
    function grantReward(nk, logger, ctx, userId, gameId, resolved) {
        // Grant currencies
        for (var cid in resolved.currencies) {
            if (resolved.currencies[cid] > 0) {
                WalletHelpers.addCurrency(nk, logger, ctx, userId, gameId, cid, resolved.currencies[cid]);
            }
        }
        // Grant items via inventory system
        for (var iid in resolved.items) {
            if (resolved.items[iid] > 0) {
                HiroInventory.grantItem(nk, logger, ctx, userId, iid, resolved.items[iid], undefined, undefined, gameId);
            }
        }
        // Grant energy
        for (var eid in resolved.energies) {
            if (resolved.energies[eid] > 0) {
                HiroEnergy.addEnergy(nk, logger, ctx, userId, eid, resolved.energies[eid], gameId);
            }
        }
        // Record gift claims for fulfillment (physical items, vouchers, etc.)
        if (resolved.gifts && resolved.gifts.length > 0) {
            var existing = Storage.readJson(nk, "gift_claims", "pending_" + userId, userId);
            var claims = (existing && existing.claims) || [];
            var now = Math.floor(Date.now() / 1000);
            for (var gi = 0; gi < resolved.gifts.length; gi++) {
                var gift = resolved.gifts[gi];
                claims.push({
                    claimId: nk.uuidv4(),
                    giftId: gift.id,
                    name: gift.name,
                    description: gift.description,
                    imageUrl: gift.imageUrl || "",
                    type: gift.type,
                    value: gift.value || "",
                    quantity: gift.quantity || 1,
                    fulfillmentUrl: gift.fulfillmentUrl || "",
                    terms: gift.terms || "",
                    status: "pending",
                    claimedAt: now,
                    fulfilledAt: 0
                });
            }
            Storage.writeJson(nk, "gift_claims", "pending_" + userId, userId, { claims: claims });
            logger.info("[RewardEngine] Recorded %d gift claim(s) for user %s", resolved.gifts.length, userId);
        }
        EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
            userId: userId, gameId: gameId, reward: resolved
        });
    }
    RewardEngine.grantReward = grantReward;
    function getGiftClaims(nk, userId) {
        var data = Storage.readJson(nk, "gift_claims", "pending_" + userId, userId);
        return (data && data.claims) || [];
    }
    RewardEngine.getGiftClaims = getGiftClaims;
    function updateGiftClaimStatus(nk, userId, claimId, status) {
        var data = Storage.readJson(nk, "gift_claims", "pending_" + userId, userId);
        if (!data || !data.claims)
            return false;
        var found = false;
        for (var i = 0; i < data.claims.length; i++) {
            if (data.claims[i].claimId === claimId) {
                data.claims[i].status = status;
                if (status === "fulfilled" || status === "delivered") {
                    data.claims[i].fulfilledAt = Math.floor(Date.now() / 1000);
                }
                found = true;
                break;
            }
        }
        if (found) {
            Storage.writeJson(nk, "gift_claims", "pending_" + userId, userId, data);
        }
        return found;
    }
    RewardEngine.updateGiftClaimStatus = updateGiftClaimStatus;
    function grantToMailbox(nk, userId, subject, reward, expiresAt) {
        var msg = {
            id: nk.uuidv4(),
            subject: subject,
            reward: reward,
            createdAt: Math.floor(Date.now() / 1000),
            expiresAt: expiresAt
        };
        var mailbox = Storage.readJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId);
        if (!mailbox) {
            mailbox = { messages: [] };
        }
        mailbox.messages.push(msg);
        Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", userId, mailbox);
    }
    RewardEngine.grantToMailbox = grantToMailbox;
})(RewardEngine || (RewardEngine = {}));
var RpcHelpers;
(function (RpcHelpers) {
    function validatePayload(payload, fields) {
        var missing = [];
        for (var i = 0; i < fields.length; i++) {
            if (!payload.hasOwnProperty(fields[i]) || payload[fields[i]] === null || payload[fields[i]] === undefined) {
                missing.push(fields[i]);
            }
        }
        return { valid: missing.length === 0, missing: missing };
    }
    RpcHelpers.validatePayload = validatePayload;
    function safeJsonParse(payload) {
        try {
            var data = JSON.parse(payload);
            return { success: true, data: data, error: null };
        }
        catch (err) {
            return { success: false, data: null, error: err.message || "Invalid JSON" };
        }
    }
    RpcHelpers.safeJsonParse = safeJsonParse;
    function successResponse(data) {
        return JSON.stringify({ success: true, data: data });
    }
    RpcHelpers.successResponse = successResponse;
    function errorResponse(message, code) {
        return JSON.stringify({ success: false, error: message, code: code || 0 });
    }
    RpcHelpers.errorResponse = errorResponse;
    function parseRpcPayload(payload) {
        if (!payload || payload === "") {
            return {};
        }
        var result = safeJsonParse(payload);
        if (!result.success) {
            throw new Error("Invalid JSON payload: " + result.error);
        }
        return result.data;
    }
    RpcHelpers.parseRpcPayload = parseRpcPayload;
    function logRpcError(nk, logger, rpcName, errorMessage, userId, gameId) {
        try {
            var now = new Date();
            var key = "err_" + rpcName + "_" + (userId || "system") + "_" + Date.now();
            nk.storageWrite([{
                    collection: Constants.ANALYTICS_COLLECTION,
                    key: key,
                    userId: Constants.SYSTEM_USER_ID,
                    value: {
                        rpc_name: rpcName,
                        error_message: errorMessage,
                        user_id: userId || null,
                        game_id: gameId || null,
                        timestamp: now.toISOString(),
                        date: now.toISOString().slice(0, 10)
                    },
                    permissionRead: 0,
                    permissionWrite: 0
                }]);
        }
        catch (_) {
            // Silently ignore logging failures
        }
    }
    RpcHelpers.logRpcError = logRpcError;
    function requireUserId(ctx) {
        if (!ctx.userId) {
            throw new Error("User ID is required");
        }
        return ctx.userId;
    }
    RpcHelpers.requireUserId = requireUserId;
    function resolveUserId(ctx, payload) {
        if (ctx.userId) {
            return ctx.userId;
        }
        if (payload && typeof payload.userId === "string" && payload.userId.length > 0) {
            return payload.userId;
        }
        throw new Error("User ID is required (provide via auth token or 'userId' field in payload)");
    }
    RpcHelpers.resolveUserId = resolveUserId;
    function requireAdmin(ctx, nk) {
        // Server-to-server calls via http_key have no userId — treat as trusted
        if (!ctx.userId)
            return;
        try {
            var accounts = nk.accountsGetId([ctx.userId]);
            if (accounts && accounts.length > 0) {
                var metadata = accounts[0].user.metadata;
                if (metadata && metadata.admin === true)
                    return;
            }
        }
        catch (_) { }
        throw new Error("Admin access required");
    }
    RpcHelpers.requireAdmin = requireAdmin;
})(RpcHelpers || (RpcHelpers = {}));
var Storage;
(function (Storage) {
    function readJson(nk, collection, key, userId) {
        var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
        return null;
    }
    Storage.readJson = readJson;
    function writeJson(nk, collection, key, userId, value, permissionRead, permissionWrite) {
        nk.storageWrite([{
                collection: collection,
                key: key,
                userId: userId,
                value: value,
                permissionRead: permissionRead !== undefined ? permissionRead : 1,
                permissionWrite: permissionWrite !== undefined ? permissionWrite : 1
            }]);
    }
    Storage.writeJson = writeJson;
    function writeSystemJson(nk, collection, key, value) {
        nk.storageWrite([{
                collection: collection,
                key: key,
                userId: Constants.SYSTEM_USER_ID,
                value: value,
                permissionRead: 2,
                permissionWrite: 0
            }]);
    }
    Storage.writeSystemJson = writeSystemJson;
    function readSystemJson(nk, collection, key) {
        return readJson(nk, collection, key, Constants.SYSTEM_USER_ID);
    }
    Storage.readSystemJson = readSystemJson;
    function deleteRecord(nk, collection, key, userId) {
        nk.storageDelete([{ collection: collection, key: key, userId: userId }]);
    }
    Storage.deleteRecord = deleteRecord;
    function readMultiple(nk, reads) {
        return nk.storageRead(reads) || [];
    }
    Storage.readMultiple = readMultiple;
    function writeMultiple(nk, writes) {
        if (writes.length > 0) {
            nk.storageWrite(writes);
        }
    }
    Storage.writeMultiple = writeMultiple;
    function listUserRecords(nk, collection, userId, limit, cursor) {
        var result = nk.storageList(userId, collection, limit || 100, cursor);
        return {
            records: result.objects || [],
            cursor: result.cursor || ""
        };
    }
    Storage.listUserRecords = listUserRecords;
    function rpcStorageWrite(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.collection || !data.key)
            return RpcHelpers.errorResponse("collection and key required");
        var targetUserId = data.user_id || userId;
        var value = typeof data.value === "string" ? JSON.parse(data.value) : (data.value || {});
        var permRead = (data.permission_read !== undefined ? data.permission_read : 1);
        var permWrite = (data.permission_write !== undefined ? data.permission_write : 1);
        var acks = nk.storageWrite([{
                collection: data.collection,
                key: data.key,
                userId: targetUserId,
                value: value,
                permissionRead: permRead,
                permissionWrite: permWrite
            }]);
        return RpcHelpers.successResponse({
            version: acks && acks.length > 0 ? acks[0].version : ""
        });
    }
    function rpcStorageRead(ctx, logger, nk, payload) {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        if (!data.collection || !data.key)
            return RpcHelpers.errorResponse("collection and key required");
        var targetUserId = data.user_id || userId;
        var records = nk.storageRead([{
                collection: data.collection,
                key: data.key,
                userId: targetUserId
            }]);
        if (records && records.length > 0) {
            return RpcHelpers.successResponse({
                value: records[0].value,
                version: records[0].version || ""
            });
        }
        return RpcHelpers.successResponse({ value: null, version: "" });
    }
    function register(initializer) {
        initializer.registerRpc("storage_write", rpcStorageWrite);
        initializer.registerRpc("storage_read", rpcStorageRead);
    }
    Storage.register = register;
})(Storage || (Storage = {}));
var WalletHelpers;
(function (WalletHelpers) {
    function getGameWallet(nk, userId, gameId) {
        var key = "wallet_" + userId + "_" + gameId;
        var wallet = Storage.readJson(nk, Constants.WALLETS_COLLECTION, key, userId);
        if (!wallet) {
            return {
                userId: userId,
                gameId: gameId,
                currencies: { game: 0, tokens: 0, xp: 0 },
                items: {}
            };
        }
        if (wallet.currencies) {
            if (wallet.currencies.game === undefined)
                wallet.currencies.game = wallet.currencies.tokens || 0;
            if (wallet.currencies.tokens === undefined)
                wallet.currencies.tokens = wallet.currencies.game || 0;
        }
        return wallet;
    }
    WalletHelpers.getGameWallet = getGameWallet;
    function saveGameWallet(nk, wallet) {
        var key = "wallet_" + wallet.userId + "_" + wallet.gameId;
        Storage.writeJson(nk, Constants.WALLETS_COLLECTION, key, wallet.userId, wallet, 1, 1);
    }
    WalletHelpers.saveGameWallet = saveGameWallet;
    function addCurrency(nk, logger, ctx, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        if (!wallet.currencies[currencyId]) {
            wallet.currencies[currencyId] = 0;
        }
        wallet.currencies[currencyId] += amount;
        saveGameWallet(nk, wallet);
        EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_EARNED, {
            userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
        });
        return wallet;
    }
    WalletHelpers.addCurrency = addCurrency;
    function spendCurrency(nk, logger, ctx, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        var balance = wallet.currencies[currencyId] || 0;
        if (balance < amount) {
            throw new Error("Insufficient " + currencyId + ": have " + balance + ", need " + amount);
        }
        wallet.currencies[currencyId] = balance - amount;
        saveGameWallet(nk, wallet);
        EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_SPENT, {
            userId: userId, gameId: gameId, currencyId: currencyId, amount: amount, newBalance: wallet.currencies[currencyId]
        });
        return wallet;
    }
    WalletHelpers.spendCurrency = spendCurrency;
    function hasCurrency(nk, userId, gameId, currencyId, amount) {
        var wallet = getGameWallet(nk, userId, gameId);
        return (wallet.currencies[currencyId] || 0) >= amount;
    }
    WalletHelpers.hasCurrency = hasCurrency;
})(WalletHelpers || (WalletHelpers = {}));
