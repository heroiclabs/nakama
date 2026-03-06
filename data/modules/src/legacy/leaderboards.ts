namespace LegacyLeaderboards {

  var RESET_SCHEDULES: { [key: string]: string } = {
    daily: "0 0 * * *",
    weekly: "0 0 * * 0",
    monthly: "0 0 1 * *",
    alltime: ""
  };

  var PERIODS = ["daily", "weekly", "monthly", "alltime"];

  function ensureLeaderboardExists(nk: nkruntime.Nakama, logger: nkruntime.Logger, leaderboardId: string, resetSchedule: string, metadata: any): boolean {
    try {
      try {
        var existing = nk.leaderboardsGetId([leaderboardId]);
        if (existing && existing.length > 0) return true;
      } catch (_) { /* proceed to create */ }
      nk.leaderboardCreate(leaderboardId, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, resetSchedule || "", metadata || {});
      logger.info("[LegacyLeaderboards] Created: " + leaderboardId);
      return true;
    } catch (err: any) {
      logger.warn("[LegacyLeaderboards] ensureLeaderboardExists: " + err.message);
      return false;
    }
  }

  function readRegistry(nk: nkruntime.Nakama): any[] {
    var data = Storage.readSystemJson<any[]>(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created");
    return data || [];
  }

  function readTimePeriodRegistry(nk: nkruntime.Nakama): any[] {
    var data = Storage.readSystemJson<{ leaderboards?: any[] }>(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "time_period_leaderboards");
    return (data && data.leaderboards) ? data.leaderboards : [];
  }

  function getAllLeaderboardIds(nk: nkruntime.Nakama, logger: nkruntime.Logger): string[] {
    var ids: string[] = [];
    var registry = readRegistry(nk);
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].leaderboardId) ids.push(registry[i].leaderboardId);
    }
    var timeReg = readTimePeriodRegistry(nk);
    for (var j = 0; j < timeReg.length; j++) {
      var lb = timeReg[j];
      if (lb.leaderboardId && ids.indexOf(lb.leaderboardId) === -1) ids.push(lb.leaderboardId);
    }
    return ids;
  }

  function writeToAllLeaderboards(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, username: string, gameId: string, score: number): string[] {
    var updated: string[] = [];
    var metadata = { source: "submit_score_and_sync", gameId: gameId, submittedAt: new Date().toISOString() };

    var mainId = "leaderboard_" + gameId;
    if (ensureLeaderboardExists(nk, logger, mainId, "", { scope: "game", gameId: gameId })) {
      try {
        nk.leaderboardRecordWrite(mainId, userId, username, score, 0, metadata);
        updated.push(mainId);
      } catch (_) { /* skip */ }
    }

    for (var i = 0; i < PERIODS.length; i++) {
      var period = PERIODS[i];
      var periodId = "leaderboard_" + gameId + "_" + period;
      if (ensureLeaderboardExists(nk, logger, periodId, RESET_SCHEDULES[period], { scope: "game", gameId: gameId, timePeriod: period })) {
        try {
          nk.leaderboardRecordWrite(periodId, userId, username, score, 0, metadata);
          updated.push(periodId);
        } catch (_) { /* skip */ }
      }
    }

    var globalId = "leaderboard_global";
    if (ensureLeaderboardExists(nk, logger, globalId, "", { scope: "global" })) {
      try {
        nk.leaderboardRecordWrite(globalId, userId, username, score, 0, metadata);
        updated.push(globalId);
      } catch (_) { /* skip */ }
    }

    for (var k = 0; k < PERIODS.length; k++) {
      var gp = PERIODS[k];
      var gid = "leaderboard_global_" + gp;
      if (ensureLeaderboardExists(nk, logger, gid, RESET_SCHEDULES[gp], { scope: "global", timePeriod: gp })) {
        try {
          nk.leaderboardRecordWrite(gid, userId, username, score, 0, metadata);
          updated.push(gid);
        } catch (_) { /* skip */ }
      }
    }

    var allIds = getAllLeaderboardIds(nk, logger);
    for (var m = 0; m < allIds.length; m++) {
      var lbId = allIds[m];
      if (updated.indexOf(lbId) !== -1) continue;
      if (lbId.indexOf(gameId) !== -1 || lbId.indexOf("global") !== -1) {
        try {
          nk.leaderboardRecordWrite(lbId, userId, username, score, 0, metadata);
          updated.push(lbId);
        } catch (_) { /* skip */ }
      }
    }
    return updated;
  }

  function rpcCreateAllLeaderboardsPersistent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload || "{}");
      var existingRecords = readRegistry(nk);
      var existingIds: { [id: string]: boolean } = {};
      for (var i = 0; i < existingRecords.length; i++) existingIds[existingRecords[i].leaderboardId] = true;

      var created: string[] = [];
      var skipped: string[] = [];

      var globalId = "leaderboard_global";
      if (!existingIds[globalId]) {
        try {
          nk.leaderboardCreate(globalId, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, "0 0 * * 0", { scope: "global", desc: "Global Ecosystem Leaderboard" });
          created.push(globalId);
          existingRecords.push({ leaderboardId: globalId, scope: "global", createdAt: new Date().toISOString() });
        } catch (err: any) {
          skipped.push(globalId);
        }
      } else {
        skipped.push(globalId);
      }

      var games = data.games || [];
      for (var j = 0; j < games.length; j++) {
        var game = games[j];
        var gid = game.id || game.gameId;
        if (!gid) continue;
        var lbId = "leaderboard_" + gid;
        if (existingIds[lbId]) {
          skipped.push(lbId);
          continue;
        }
        try {
          nk.leaderboardCreate(lbId, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, "0 0 * * 0", {
            desc: "Leaderboard for " + (game.gameTitle || game.name || "Untitled"),
            gameId: gid,
            scope: "game"
          });
          created.push(lbId);
          existingRecords.push({ leaderboardId: lbId, gameId: gid, scope: "game", createdAt: new Date().toISOString() });
        } catch (err: any) {
          skipped.push(lbId);
        }
      }

      Storage.writeSystemJson(nk, Constants.LEADERBOARDS_REGISTRY_COLLECTION, "all_created", existingRecords);
      return RpcHelpers.successResponse({ created: created, skipped: skipped, totalProcessed: games.length, storedRecords: existingRecords.length });
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to create leaderboards");
    }
  }

  function rpcCreateTimePeriodLeaderboards(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload || "{}");
      var games = data.games || [];
      var allLeaderboards: any[] = [];

      for (var i = 0; i < PERIODS.length; i++) {
        var period = PERIODS[i];
        var gid = "leaderboard_global_" + period;
        try {
          nk.leaderboardsGetId([gid]);
        } catch (_) {
          try {
            nk.leaderboardCreate(gid, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, RESET_SCHEDULES[period], { scope: "global", timePeriod: period });
            allLeaderboards.push({ leaderboardId: gid, period: period, scope: "global" });
          } catch (e: any) { logger.warn("[LegacyLeaderboards] create global " + period + ": " + e.message); }
        }
      }

      for (var j = 0; j < games.length; j++) {
        var game = games[j];
        var gameId = game.id || game.gameId;
        if (!gameId) continue;
        for (var k = 0; k < PERIODS.length; k++) {
          var p = PERIODS[k];
          var lid = "leaderboard_" + gameId + "_" + p;
          try {
            nk.leaderboardsGetId([lid]);
          } catch (_) {
          try {
            nk.leaderboardCreate(lid, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST, RESET_SCHEDULES[p], {
                gameId: gameId,
                gameTitle: game.gameTitle || game.name,
                scope: "game",
                timePeriod: p
              });
              allLeaderboards.push({ leaderboardId: lid, period: p, gameId: gameId });
            } catch (e: any) { logger.warn("[LegacyLeaderboards] create " + lid + ": " + e.message); }
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
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to create time-period leaderboards");
    }
  }

  function rpcSubmitScoreToTimePeriods(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      if (!ctx.userId) return RpcHelpers.errorResponse("Authentication required");
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.gameId || (data.score === undefined || data.score === null)) return RpcHelpers.errorResponse("gameId and score required");

      var score = parseInt(String(data.score));
      if (isNaN(score)) return RpcHelpers.errorResponse("Score must be a number");

      var gameId = data.gameId;
      var subscore = parseInt(String(data.subscore)) || 0;
      var metadata = data.metadata || {};
      metadata.submittedAt = new Date().toISOString();
      metadata.gameId = gameId;
      metadata.source = "submit_score_to_time_periods";

      var userId = ctx.userId;
      var username = ctx.username || userId;
      var results: any[] = [];
      var errors: any[] = [];

      for (var i = 0; i < PERIODS.length; i++) {
        var period = PERIODS[i];
        var lbId = "leaderboard_" + gameId + "_" + period;
        try {
          nk.leaderboardRecordWrite(lbId, userId, username, score, subscore, metadata);
          results.push({ leaderboardId: lbId, period: period, scope: "game", success: true });
        } catch (e: any) {
          errors.push({ leaderboardId: lbId, period: period, error: e.message });
        }
      }
      for (var j = 0; j < PERIODS.length; j++) {
        var p = PERIODS[j];
        var gid = "leaderboard_global_" + p;
        try {
          nk.leaderboardRecordWrite(gid, userId, username, score, subscore, metadata);
          results.push({ leaderboardId: gid, period: p, scope: "global", success: true });
        } catch (e: any) {
          errors.push({ leaderboardId: gid, period: p, error: e.message });
        }
      }

      return RpcHelpers.successResponse({ gameId: gameId, score: score, userId: userId, results: results, errors: errors });
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to submit score");
    }
  }

  function rpcGetTimePeriodLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.gameId && data.scope !== "global") return RpcHelpers.errorResponse("gameId or scope=global required");
      if (!data.period) return RpcHelpers.errorResponse("period required (daily, weekly, monthly, alltime)");

      var period = data.period;
      if (PERIODS.indexOf(period) === -1) return RpcHelpers.errorResponse("Invalid period");

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
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to fetch leaderboard");
    }
  }

  function rpcSubmitScoreAndSync(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var v = RpcHelpers.validatePayload(data, ["score", "device_id", "game_id"]);
      if (!v.valid) return RpcHelpers.errorResponse("Missing: " + v.missing.join(", "));

      var score = parseInt(String(data.score));
      if (isNaN(score)) return RpcHelpers.errorResponse("Score must be a number");

      var deviceId = data.device_id;
      var gameId = data.game_id;
      var userId = ctx.userId || deviceId;

      var username = ctx.username || "";
      if (!username) {
        try {
          var users = nk.usersGetId([userId]);
          if (users && users.length > 0 && users[0].username) username = users[0].username;
        } catch (_) { }
      }
      if (!username) username = userId;

      var updated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);
      return RpcHelpers.successResponse({
        success: true,
        score: score,
        leaderboards_updated: updated,
        game_id: gameId
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to submit score");
    }
  }

  function rpcGetAllLeaderboards(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!data.device_id || !data.game_id) return RpcHelpers.errorResponse("device_id and game_id required");

      var deviceId = data.device_id;
      var gameId = data.game_id;
      var limit = parseInt(String(data.limit)) || 10;
      var userId = ctx.userId || deviceId;

      var leaderboardIds: string[] = [];
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

      var leaderboards: any = {};
      var successCount = 0;

      for (var m = 0; m < leaderboardIds.length; m++) {
        var lbId = leaderboardIds[m];
        try {
          var recs = nk.leaderboardRecordsList(lbId, null, limit, null, 0);
          var userRec = null;
          try {
            var ur = nk.leaderboardRecordsList(lbId, [userId], 1, null, 0);
            if (ur && ur.records && ur.records.length > 0) userRec = ur.records[0];
          } catch (_) { }
          leaderboards[lbId] = {
            leaderboard_id: lbId,
            records: recs.records || [],
            user_record: userRec,
            next_cursor: recs.nextCursor || "",
            prev_cursor: recs.prevCursor || ""
          };
          successCount++;
        } catch (e: any) {
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
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to get leaderboards");
    }
  }

  function rpcSubmitLeaderboardScore(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload || "{}");
      if (!data.device_id || !data.game_id) return RpcHelpers.errorResponse("device_id and game_id required");
      if (data.score === undefined || data.score === null) return RpcHelpers.errorResponse("score required");

      var score = Number(data.score);
      if (isNaN(score)) return RpcHelpers.errorResponse("score must be a number");

      var syncPayload = JSON.stringify({
        device_id: data.device_id,
        game_id: data.game_id,
        score: score,
        metadata: data.metadata || {}
      });
      var resultStr = rpcSubmitScoreAndSync(ctx, logger, nk, syncPayload);
      var result = JSON.parse(resultStr);

      if (!result.success) return RpcHelpers.errorResponse("Failed to submit score: " + (result.error || ""));
      return RpcHelpers.successResponse({
        success: true,
        leaderboards_updated: result.data.leaderboards_updated || [],
        score: score,
        message: "Score submitted successfully"
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to submit score");
    }
  }

  function rpcGetLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload || "{}");
      if (!data.game_id) return RpcHelpers.errorResponse("game_id required");

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

      if (!result.success) return RpcHelpers.errorResponse("Failed to get leaderboard: " + (result.error || ""));

      var lbData = result.data || result;
      return RpcHelpers.successResponse({
        leaderboard_id: lbData.leaderboardId,
        records: lbData.records || [],
        next_cursor: lbData.nextCursor || "",
        prev_cursor: lbData.prevCursor || "",
        period: period,
        game_id: data.game_id
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse(err.message || "Failed to get leaderboard");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("create_all_leaderboards_persistent", rpcCreateAllLeaderboardsPersistent);
    initializer.registerRpc("create_time_period_leaderboards", rpcCreateTimePeriodLeaderboards);
    initializer.registerRpc("submit_score_to_time_periods", rpcSubmitScoreToTimePeriods);
    initializer.registerRpc("get_time_period_leaderboard", rpcGetTimePeriodLeaderboard);
    initializer.registerRpc("submit_score_and_sync", rpcSubmitScoreAndSync);
    initializer.registerRpc("get_all_leaderboards", rpcGetAllLeaderboards);
    initializer.registerRpc("submit_leaderboard_score", rpcSubmitLeaderboardScore);
    initializer.registerRpc("get_leaderboard", rpcGetLeaderboard);
  }
}
