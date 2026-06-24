// nakama-allow-dynamic-rpc-id:file
//
// Intentional file-level exemption from check-rpc-literals.js.
//
// `registerGameRpcs(initializer, prefix, gameId)` registers RPCs of
// the form `<prefix><suffix>` for an enumerated suffix list. Goja's
// AST walker would not extract these dynamic ids on its own, but
// postbuild.js text-scans this file for the
// `initializer.registerRpc(prefix + "<suffix>", gameRpcHandler(gameId, fn))`
// pattern and emits explicit
// `initializer.registerRpc("<prefix><suffix>", ...)` calls into the
// generated bundle for every (prefix, suffix) pair declared at the
// `register(...)` call sites below. The dynamic-looking source is
// the input to that generator, not the runtime form.
//
// If you ADD or REMOVE rpcs in this file, also re-run `npm run build`
// to regenerate the postbuild expansion. See `postbuild.js` ~line 199
// for the matching extractor.
namespace LegacyMultiGame {

  function gameRpcHandler(gameId: string, handler: (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gameId: string) => any): (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string {
    return function (ctx, logger, nk, payload) {
      try {
        var userId = RpcHelpers.requireUserId(ctx);
        var data = RpcHelpers.parseRpcPayload(payload);
        var result = handler(ctx, logger, nk, data, userId, gameId);
        return RpcHelpers.successResponse(result);
      } catch (err: any) {
        return RpcHelpers.errorResponse(err.message);
      }
    };
  }

  function updateUserProfile(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var metadata = Storage.readJson<any>(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId) || {};
    if (data.displayName) metadata.displayName = data.displayName;
    if (data.avatarUrl) metadata.avatarUrl = data.avatarUrl;
    if (data.level !== undefined) metadata.level = data.level;
    Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
    return { metadata: metadata };
  }

  function grantCurrency(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var wallet = WalletHelpers.addCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
    return { wallet: wallet.currencies };
  }

  function spendCurrency(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var wallet = WalletHelpers.spendCurrency(nk, logger, ctx, userId, gId, data.currencyId || "game", data.amount || 0);
    return { wallet: wallet.currencies };
  }

  function validatePurchase(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.itemId || !data.price) throw new Error("itemId and price required");
    var canAfford = WalletHelpers.hasCurrency(nk, userId, gId, data.currencyId || "game", data.price);
    return { valid: canAfford, itemId: data.itemId, price: data.price };
  }

  function listInventory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var inv = Storage.readJson<any>(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
    return inv;
  }

  function grantItem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.itemId) throw new Error("itemId required");
    var inv = Storage.readJson<any>(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
    if (!inv.items[data.itemId]) inv.items[data.itemId] = { count: 0 };
    inv.items[data.itemId].count += (data.count || 1);
    Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
    return { item: inv.items[data.itemId] };
  }

  function consumeItem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.itemId) throw new Error("itemId required");
    var inv = Storage.readJson<any>(nk, "game_inventory", gId + "_" + userId, userId) || { items: {} };
    var item = inv.items[data.itemId];
    if (!item || item.count < (data.count || 1)) throw new Error("Insufficient items");
    item.count -= (data.count || 1);
    if (item.count <= 0) delete inv.items[data.itemId];
    Storage.writeJson(nk, "game_inventory", gId + "_" + userId, userId, inv);
    return { success: true };
  }

  function submitScore(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (data.score === undefined) throw new Error("score required");
    var lbId = gId + "_leaderboard";
    try { nk.leaderboardCreate(lbId, false, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST); } catch (_) { }
    nk.leaderboardRecordWrite(lbId, userId, ctx.username || "", data.score, data.subscore || 0, data.metadata || {}, nkruntime.OverrideOperator.BEST);
    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, { userId: userId, gameId: gId, score: data.score });
    return { success: true };
  }

  function getLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var lbId = gId + "_leaderboard";
    var limit = data.limit || 20;
    var records = nk.leaderboardRecordsList(lbId, [], limit, data.cursor || undefined, 0);
    return { records: records.records || [], ownerRecords: records.ownerRecords || [] };
  }

  function joinOrCreateMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    return { success: true, message: "Matchmaking handled by client" };
  }

  function claimDailyReward(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var key = "daily_" + gId + "_" + userId;
    var state = Storage.readJson<any>(nk, "daily_rewards", key, userId) || { lastClaimDate: "", streak: 0 };
    var today = new Date().toISOString().slice(0, 10);
    if (state.lastClaimDate === today) return { alreadyClaimed: true, streak: state.streak };

    state.streak = state.lastClaimDate ? state.streak + 1 : 1;
    if (state.streak > 7) state.streak = 1;
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
  function findFriends(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var query = (data.query || "").trim();
    if (query.length < 1) throw new Error("Query must be at least 1 character");
    if (query.length > 50) query = query.substring(0, 50);

    var limit = parseInt(data.limit) || 20;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    // Escape SQL ILIKE wildcard characters in user input
    var safeQuery = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

    // SQL search: prefix match for 1-char, contains match for 2+
    var sqlPattern = query.length === 1 ? (safeQuery + "%") : ("%" + safeQuery + "%");
    var rows: any[] = [];
    try {
      rows = nk.sqlQuery(
        "SELECT id, username, display_name, avatar_url, create_time " +
        "FROM users " +
        "WHERE (username ILIKE $1 OR display_name ILIKE $1) " +
        "AND id != $2 " +
        "AND disable_time = '1970-01-01 00:00:00 UTC' " +
        "ORDER BY username ASC LIMIT $3",
        [sqlPattern, userId, limit]
      );
    } catch (sqlErr: any) {
      logger.warn("findFriends SQL error: " + sqlErr.message);
    }

    // Build relationship map
    var relationMap: Record<string, string> = {};
    try {
      var friendsResult = nk.friendsList(userId, 1000, 0, "");
      (friendsResult.friends || []).forEach(function (fr: any) {
        var fid = fr.user.userId || fr.user.id;
        if (fr.state === 0) relationMap[fid] = "friend";
        else if (fr.state === 1) relationMap[fid] = "pending_sent";
        else if (fr.state === 2) relationMap[fid] = "pending_received";
        else if (fr.state === 3) relationMap[fid] = "blocked";
      });
    } catch (e) { /* continue without relationship data */ }

    var results = rows.filter(function (r: any) { return r.id !== userId; }).map(function (r: any) {
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

  function savePlayerData(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.data) throw new Error("data required");
    Storage.writeJson(nk, "player_data", gId + "_save", userId, data.data);
    return { success: true };
  }

  function loadPlayerData(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var saved = Storage.readJson<any>(nk, "player_data", gId + "_save", userId);
    return { data: saved || {} };
  }

  function getItemCatalog(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var catalog = Storage.readSystemJson<any>(nk, "game_catalogs", gId + "_catalog");
    return catalog || { items: [] };
  }

  function searchItems(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var catalog = Storage.readSystemJson<any>(nk, "game_catalogs", gId + "_catalog") || { items: [] };
    var query = (data.query || "").toLowerCase();
    var results = catalog.items.filter(function (item: any) {
      return item.name && item.name.toLowerCase().indexOf(query) >= 0;
    });
    return { items: results };
  }

  function getQuizCategories(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var config = Storage.readSystemJson<any>(nk, "game_configs", gId + "_quiz_categories");
    return config || { categories: [] };
  }

  function getWeaponStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var config = Storage.readSystemJson<any>(nk, "game_configs", gId + "_weapon_stats");
    return config || { weapons: [] };
  }

  function refreshServerCache(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    ConfigLoader.invalidateCache();
    return { success: true };
  }

  function guildCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.name) throw new Error("name required");
    var group = nk.groupCreate(userId, data.name, userId, gId, data.description || "", data.avatarUrl || "", false, {}, data.maxMembers || 50);
    return { groupId: group.id, name: data.name };
  }

  function guildJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.groupId) throw new Error("groupId required");
    nk.groupUserJoin(data.groupId, userId, ctx.username || "");
    return { success: true };
  }

  function guildLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.groupId) throw new Error("groupId required");
    nk.groupUserLeave(data.groupId, userId, ctx.username || "");
    return { success: true };
  }

  function guildList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var groups = nk.groupsList(data.name || "", gId, null, null, data.limit || 20, data.cursor || undefined);
    return { groups: groups.groups || [] };
  }

  function sendChannelMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    if (!data.channelId || !data.content) throw new Error("channelId and content required");
    nk.channelMessageSend(data.channelId, { message: data.content }, userId, ctx.username || "", true);
    return { success: true };
  }

  // ── QuizVerse Game ID (canonical UUID for analytics) ─────────────
  var QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
  var MAX_EVENT_NAME_LENGTH = 256;
  var MAX_EVENT_DATA_SIZE = 50; // max top-level keys in eventData

  function getStartOfDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function resolveGameId(gId: string): string {
    return (gId === "quizverse") ? QUIZVERSE_GAME_ID : gId;
  }

  function resolveTimestamp(clientTimestamp: any): { iso: string; unix: number } {
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

  function validateEventPayload(data: any): { valid: boolean; eventName: string; eventData: any; error?: string } {
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
      var trimmed: any = {};
      for (var i = 0; i < MAX_EVENT_DATA_SIZE; i++) {
        trimmed[keys[i]] = eventData[keys[i]];
      }
      eventData = trimmed;
    }

    return { valid: true, eventName: eventName, eventData: eventData };
  }

  function logEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
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
    var event: any = {
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

    // 6. Write to analytics_events under SYSTEM_USER (dashboard aggregation).
    // Key format must match what dashboard_events_timeline and analytics_rollup
    // expect: dash_<gameId>_<YYYY-MM-DD>_<eventName>_<ts>_<rand>
    var rand6 = Math.random().toString(36).slice(2, 8);
    var dashKey = "dash_" + canonicalGameId + "_" + getStartOfDay() + "_" + eventName + "_" + now + "_" + rand6;
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

  function trackDAUForEvent(nk: nkruntime.Nakama, userId: string, gameId: string, platform?: string): void {
    var today = getStartOfDay();
    // Game-level + platform-aggregate + per-platform keys
    var keys = ["dau_" + gameId + "_" + today, "dau_platform_" + today];
    if (platform && platform !== "unknown") {
      keys.push("dau_" + platform + "_" + today);
    }

    for (var k = 0; k < keys.length; k++) {
      try {
        var existing = Storage.readSystemJson<any>(nk, "analytics_dau", keys[k]);
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
      } catch (e) { /* DAU tracking non-fatal */ }
    }
  }

  function trackSessionForEvent(nk: nkruntime.Nakama, userId: string, gameId: string, eventName: string, eventData: any): void {
    var sessionKey = "analytics_session_" + userId + "_" + gameId;
    try {
      if (eventName === "session_start") {
        var sessionData: any = {
          userId: userId,
          gameId: gameId,
          startTime: Math.floor(Date.now() / 1000),
          startTimestamp: new Date().toISOString(),
          active: true
        };
        Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, sessionData, 1, 1);
      } else if (eventName === "session_end") {
        var existing = Storage.readJson<any>(nk, "analytics_sessions", sessionKey, userId);
        if (existing && existing.active) {
          existing.endTime = Math.floor(Date.now() / 1000);
          existing.endTimestamp = new Date().toISOString();
          existing.duration = existing.endTime - existing.startTime;
          existing.active = false;

          var summaryKey = "session_summary_" + userId + "_" + gameId + "_" + existing.startTime;
          Storage.writeJson(nk, "analytics_session_summaries", summaryKey, userId, existing, 1, 1);

          aggregateSessionStats(nk, existing.duration, gameId);
          Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, { active: false }, 1, 1);
        } else {
          // Orphaned session_end — no matching session_start (crash recovery)
          var duration = (eventData && eventData.duration) ? parseInt(eventData.duration, 10) : 0;
          if (duration > 0) {
            var orphanKey = "session_orphan_" + userId + "_" + gameId + "_" + Date.now();
            Storage.writeJson(nk, "analytics_session_summaries", orphanKey, userId, {
              userId: userId, gameId: gameId, duration: duration,
              endTimestamp: new Date().toISOString(), orphaned: true
            }, 1, 1);
            aggregateSessionStats(nk, duration, gameId);
          }
        }
      }
    } catch (e) { /* Session tracking non-fatal */ }
  }

  function aggregateSessionStats(nk: nkruntime.Nakama, durationSeconds: number, gameId?: string): void {
    var today = getStartOfDay();
    var statsKeys = ["session_stats_" + today];
    if (gameId) statsKeys.push("session_stats_" + gameId + "_" + today);
    for (var k = 0; k < statsKeys.length; k++) {
      var statsKey = statsKeys[k];
      var stats = Storage.readSystemJson<any>(nk, "analytics_sessions", statsKey);
      if (!stats) {
        stats = { date: today, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
      }
      stats.totalSessions++;
      stats.totalDuration += (durationSeconds || 0);
      stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;
      Storage.writeJson(nk, "analytics_sessions", statsKey, Constants.SYSTEM_USER_ID, stats, 0, 0);
    }
  }

  function trackSessionStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var canonicalGameId = resolveGameId(gId);

    // Extract device info (store full details, not just platform)
    var platform = (data.platform || "unknown").toString().toLowerCase();
    var deviceInfo = data.deviceInfo || {};

    // Write to analytics_sessions (dashboard-readable)
    var sessionData: any = {
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

  function trackSessionEnd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var canonicalGameId = resolveGameId(gId);

    // Update analytics_sessions with end data
    var sessionKey = "analytics_session_" + userId + "_" + canonicalGameId;
    try {
      var existing = Storage.readJson<any>(nk, "analytics_sessions", sessionKey, userId);
      if (existing && existing.active) {
        existing.endTime = Math.floor(Date.now() / 1000);
        existing.endTimestamp = new Date().toISOString();
        existing.duration = data.duration || (existing.endTime - existing.startTime);
        existing.active = false;

        // Save session summary
        var summaryKey = "session_summary_" + userId + "_" + canonicalGameId + "_" + existing.startTime;
        Storage.writeJson(nk, "analytics_session_summaries", summaryKey, userId, existing, 1, 1);

        aggregateSessionStats(nk, existing.duration, canonicalGameId);

        // Clear active session
        Storage.writeJson(nk, "analytics_sessions", sessionKey, userId, { active: false }, 1, 1);
      } else {
        // Orphaned session end — no matching start (app crash, server restart, etc.)
        var duration = data.duration || 0;
        if (duration > 0) {
          var orphanKey = "session_orphan_" + userId + "_" + canonicalGameId + "_" + Date.now();
          Storage.writeJson(nk, "analytics_session_summaries", orphanKey, userId, {
            userId: userId, gameId: canonicalGameId, duration: duration,
            endTimestamp: new Date().toISOString(), orphaned: true
          }, 1, 1);
          aggregateSessionStats(nk, duration, canonicalGameId);
        }
      }
    } catch (e) { /* Session end tracking non-fatal */ }

    EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, { userId: userId, gameId: canonicalGameId, duration: data.duration });
    return { success: true };
  }

  function getServerConfig(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var config = Storage.readSystemJson<any>(nk, "game_configs", gId + "_server_config");
    return config || {};
  }

  function adminGrantItem(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var targetUserId = data.targetUserId || userId;
    return grantItem(ctx, logger, nk, data, targetUserId, gId);
  }

  function registerGameRpcs(initializer: nkruntime.Initializer, prefix: string, gameId: string): void {
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

  export function register(initializer: nkruntime.Initializer): void {
    registerGameRpcs(initializer, "quizverse_", "quizverse");
    // QuizVerse-specific
    initializer.registerRpc("quizverse_get_quiz_categories", gameRpcHandler("quizverse", getQuizCategories));

    registerGameRpcs(initializer, "lasttolive_", "lasttolive");
    // LastToLive-specific
    initializer.registerRpc("lasttolive_get_weapon_stats", gameRpcHandler("lasttolive", getWeaponStats));
  }
}
