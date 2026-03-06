namespace HiroLeaderboards {

  interface LeaderboardConfig {
    leaderboards: { [id: string]: LeaderboardDef };
  }

  interface LeaderboardDef {
    name: string;
    sortOrder: "asc" | "desc";
    operator: "best" | "set" | "incr" | "decr";
    resetSchedule?: string;
    enableGeo: boolean;
    metadata?: { [key: string]: string };
  }

  var DEFAULT_CONFIG: LeaderboardConfig = { leaderboards: {} };

  function getConfig(nk: nkruntime.Nakama): LeaderboardConfig {
    return ConfigLoader.loadConfig<LeaderboardConfig>(nk, "leaderboards", DEFAULT_CONFIG);
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var config = getConfig(nk);
    var result: any[] = [];
    for (var id in config.leaderboards) {
      result.push({ id: id, name: config.leaderboards[id].name, enableGeo: config.leaderboards[id].enableGeo });
    }
    return RpcHelpers.successResponse({ leaderboards: result });
  }

  function rpcSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.leaderboardId || data.score === undefined) return RpcHelpers.errorResponse("leaderboardId and score required");

    var config = getConfig(nk);
    var def = config.leaderboards[data.leaderboardId];
    if (!def) return RpcHelpers.errorResponse("Unknown leaderboard");

    var operator: nkruntime.Operator = nkruntime.Operator.BEST;
    switch (def.operator) {
      case "best": operator = nkruntime.Operator.BEST; break;
      case "set": operator = nkruntime.Operator.SET; break;
      case "incr": case "decr": operator = nkruntime.Operator.INCREMENTAL; break;
    }

    var metadata: { [key: string]: any } = data.metadata || {};
    if (def.enableGeo && data.location) {
      metadata.country = data.location.country || "";
      metadata.region = data.location.region || "";
      metadata.city = data.location.city || "";
    }

    try {
      nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
    } catch (e: any) {
      try {
        var sort: nkruntime.SortOrder = def.sortOrder === "asc" ? nkruntime.SortOrder.ASCENDING : nkruntime.SortOrder.DESCENDING;
        nk.leaderboardCreate(data.leaderboardId, false, sort, operator);
        nk.leaderboardRecordWrite(data.leaderboardId, userId, ctx.username, data.score, data.subscore || 0, metadata, undefined);
      } catch (e2: any) {
        return RpcHelpers.errorResponse("Failed to submit score: " + (e2.message || String(e2)));
      }
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
      userId: userId, leaderboardId: data.leaderboardId, score: data.score
    });

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcGetRecords(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.leaderboardId) return RpcHelpers.errorResponse("leaderboardId required");

    var limit = data.limit || 20;
    var cursor = data.cursor || "";

    try {
      var result = nk.leaderboardRecordsList(data.leaderboardId, [], limit, cursor, undefined);
      var records: any[] = [];
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
        records = records.filter(function(rec: any) {
          if (!rec.metadata) return false;
          var meta = typeof rec.metadata === "string" ? JSON.parse(rec.metadata) : rec.metadata;
          if (data.geoFilter.country && meta.country !== data.geoFilter.country) return false;
          if (data.geoFilter.region && meta.region !== data.geoFilter.region) return false;
          return true;
        });
      }

      return RpcHelpers.successResponse({ records: records, nextCursor: result.nextCursor || "" });
    } catch (e: any) {
      return RpcHelpers.errorResponse("Failed: " + (e.message || String(e)));
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_leaderboards_list", rpcList);
    initializer.registerRpc("hiro_leaderboards_submit", rpcSubmit);
    initializer.registerRpc("hiro_leaderboards_records", rpcGetRecords);
  }
}
