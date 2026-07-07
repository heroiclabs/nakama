namespace AdminConsole {

  function isoFromSec(value: any): string | undefined {
    if (!value) return undefined;
    return new Date(Number(value) * 1000).toISOString();
  }

  function parseMaybeJson(value: any, fallback: any): any {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function firstArray(value: any): string[] | undefined {
    if (!value) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      var parsed = parseMaybeJson(value, null);
      if (Array.isArray(parsed)) return parsed;
      return value.split(",").map(function (v) { return String(v).trim(); }).filter(function (v) { return !!v; });
    }
    return undefined;
  }

  function logAdminAudit(nk: nkruntime.Nakama, ctx: nkruntime.Context, action: string, target: any, details?: any): void {
    try {
      var now = Math.floor(Date.now() / 1000);
      var key = "audit_" + now + "_" + Math.floor(Math.random() * 1000000);
      Storage.writeSystemJson(nk, Constants.ADMIN_AUDIT_COLLECTION, key, {
        action: action,
        target: target || {},
        details: details || {},
        actorUserId: ctx.userId || "server-key",
        actorUsername: ctx.username || "",
        createdAt: now,
        createdAtIso: new Date(now * 1000).toISOString()
      });
    } catch (_) {
      // Audit logging must not make the admin operation fail.
    }
  }

  function configFromPayload(data: any): any {
    return data.config !== undefined
      ? data.config
      : parseMaybeJson(data.config_json, undefined);
  }

  function objectCount(value: any): number {
    if (!value) return 0;
    if (Array.isArray(value)) return value.length;
    if (typeof value === "object") return Object.keys(value).length;
    return 0;
  }

  function recordValue(record: any): any {
    return record && record.value ? record.value : (record || {});
  }

  function firstDefinedValue(value: any, keys: string[]): any {
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (value && value[key] !== undefined && value[key] !== null && value[key] !== "") return value[key];
    }
    return undefined;
  }

  function extractEventGameId(record: any): string {
    var value = recordValue(record);
    var props = value.properties || value.eventData || value.data || {};
    var gameId = firstDefinedValue(value, ["gameId", "game_id", "game", "appId", "app_id"]);
    if (!gameId) gameId = firstDefinedValue(props, ["gameId", "game_id", "game", "appId", "app_id"]);
    return gameId ? String(gameId) : "unknown";
  }

  function sameGameId(a: string, b: string): boolean {
    var qa = (a || "").toLowerCase();
    var qb = (b || "").toLowerCase();
    if (qa === qb) return true;
    var quizVerseUuid = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    return (qa === "quizverse" && qb === quizVerseUuid) || (qb === "quizverse" && qa === quizVerseUuid);
  }

  function extractEventTimeSec(record: any): number {
    var value = recordValue(record);
    var raw = firstDefinedValue(value, ["timestamp", "ts", "createdAt", "created_at", "createTime", "create_time"]);
    if (!raw && record) raw = firstDefinedValue(record, ["createTime", "create_time", "updateTime", "update_time"]);
    if (typeof raw === "number") return raw > 1000000000000 ? Math.floor(raw / 1000) : raw;
    if (typeof raw === "string") {
      var numeric = Number(raw);
      if (!isNaN(numeric) && numeric > 0) return numeric > 1000000000000 ? Math.floor(numeric / 1000) : numeric;
      var parsed = Date.parse(raw);
      if (!isNaN(parsed)) return Math.floor(parsed / 1000);
    }
    return 0;
  }

  function analyticsDiagnostics(records: any[], expectedGameId: string): any {
    var sourceCounts: any = {};
    var expectedCount = 0;
    var lastSec = 0;
    var lastGameId = "unknown";

    for (var i = 0; i < records.length; i++) {
      var gameId = extractEventGameId(records[i]);
      sourceCounts[gameId] = (sourceCounts[gameId] || 0) + 1;
      if (sameGameId(gameId, expectedGameId)) expectedCount++;

      var eventSec = extractEventTimeSec(records[i]);
      if (eventSec > lastSec) {
        lastSec = eventSec;
        lastGameId = gameId;
      }
    }

    var now = Math.floor(Date.now() / 1000);
    return {
      expected_game_id: expectedGameId,
      sampled_events: records.length,
      matching_expected_game_id: expectedCount,
      source_game_ids: sourceCounts,
      last_event_at: lastSec > 0 ? new Date(lastSec * 1000).toISOString() : null,
      last_event_age_seconds: lastSec > 0 ? Math.max(0, now - lastSec) : null,
      last_event_game_id: lastGameId,
      status: records.length === 0
        ? "empty"
        : (lastSec > 0 && now - lastSec <= 3600 ? "fresh" : (lastSec > 0 && now - lastSec <= 86400 ? "stale" : "old"))
    };
  }

  function listSystemStorage(nk: nkruntime.Nakama, collection: string, limit: number): any[] {
    try {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, collection, limit, "");
      return page && page.objects ? page.objects : [];
    } catch (_) {
      return [];
    }
  }

  function readRpcSamples(nk: nkruntime.Nakama, hours: number, limit: number): any[] {
    var rows = listSystemStorage(nk, "analytics_rpc_samples", limit);
    var cutoff = Date.now() - hours * 60 * 60 * 1000;
    var samples: any[] = [];

    for (var i = 0; i < rows.length; i++) {
      var value: any = rows[i].value;
      if (!value) continue;
      if (value.samples && Array.isArray(value.samples)) {
        for (var j = 0; j < value.samples.length; j++) {
          if (!value.samples[j].ts || value.samples[j].ts >= cutoff) samples.push(value.samples[j]);
        }
      } else if (!value.ts || value.ts >= cutoff) {
        samples.push(value);
      }
    }

    return samples;
  }

  function rpcStats(samples: any[]): any {
    var total = samples.length;
    var failed = 0;
    var durations: number[] = [];
    var byRpc: any = {};

    for (var i = 0; i < samples.length; i++) {
      var sample = samples[i] || {};
      var rpc = sample.rpc || "unknown";
      if (!byRpc[rpc]) byRpc[rpc] = { rpc: rpc, total: 0, failed: 0, totalMs: 0, maxMs: 0, lastError: "" };
      byRpc[rpc].total++;
      if (sample.ok === false) {
        failed++;
        byRpc[rpc].failed++;
        byRpc[rpc].lastError = sample.err || byRpc[rpc].lastError;
      }
      var dur = Number(sample.durMs || 0);
      durations.push(dur);
      byRpc[rpc].totalMs += dur;
      if (dur > byRpc[rpc].maxMs) byRpc[rpc].maxMs = dur;
    }

    durations.sort(function (a, b) { return a - b; });
    var topSlow: any[] = [];
    var topErrors: any[] = [];
    for (var key in byRpc) {
      var row = byRpc[key];
      row.avgMs = row.total > 0 ? Math.round(row.totalMs / row.total) : 0;
      row.errorRate = row.total > 0 ? row.failed / row.total : 0;
      topSlow.push(row);
      if (row.failed > 0) topErrors.push(row);
    }
    topSlow.sort(function (a, b) { return b.maxMs - a.maxMs; });
    topErrors.sort(function (a, b) { return b.failed - a.failed; });

    return {
      total: total,
      failed: failed,
      successRate: total > 0 ? (total - failed) / total : 1,
      avgMs: total > 0 ? Math.round(durations.reduce(function (sum, v) { return sum + v; }, 0) / total) : 0,
      p90Ms: durations.length > 0 ? durations[Math.floor(durations.length * 0.9)] : 0,
      topSlow: topSlow.slice(0, 10),
      topErrors: topErrors.slice(0, 10)
    };
  }

  function pushAction(actions: any[], impact: string, effort: string, owner: string, action: string, evidence: string): void {
    actions.push({
      impact: impact,
      effort: effort,
      owner: owner,
      action: action,
      evidence: evidence,
      priority: (impact === "high" ? 30 : impact === "medium" ? 20 : 10) + (effort === "low" ? 3 : effort === "medium" ? 2 : 1)
    });
  }

  function defaultHiroConfig(system: string): any {
    if (system === "challenges") {
      return {
        challenges: {
          quizverse_weekly_weak_topic_drill: {
            id: "quizverse_weekly_weak_topic_drill",
            name: "Weekly Weak-Topic Drill",
            description: "Complete focused practice on the user's weakest quiz topic.",
            type: "weak_topic_practice",
            gameId: "quizverse",
            target: { eventName: "quiz_completed", count: 3 },
            reward: { coins: 250, xp: 100 },
            enabled: true
          },
          quizverse_weekend_live_quiz: {
            id: "quizverse_weekend_live_quiz",
            name: "Weekend Live Quiz",
            description: "Join the weekend exam-prep quiz sprint.",
            type: "live_event",
            gameId: "quizverse",
            target: { eventName: "live_quiz_completed", count: 1 },
            reward: { coins: 500, xp: 200 },
            enabled: true
          }
        }
      };
    }
    if (system === "incentives") {
      return {
        returnBonus: { coins: 150, xp: 50, cooldownHours: 24 },
        referralReward: { coins: 500, xp: 150 },
        campaigns: {
          quizverse_daily_streak_recovery: {
            id: "quizverse_daily_streak_recovery",
            name: "Daily Streak Recovery",
            reward: { streakShield: 1, coins: 100 },
            enabled: true
          }
        }
      };
    }
    return undefined;
  }

  function defaultSatoriConfig(system: string): any {
    if (system === "audiences") {
      return {
        quizverse_all_players: {
          id: "quizverse_all_players",
          name: "QuizVerse All Players",
          rule: { combinator: "and", filters: [{ field: "gameId", op: "eq", value: "quizverse" }] }
        },
        quizverse_weak_topic_players: {
          id: "quizverse_weak_topic_players",
          name: "QuizVerse Weak Topic Players",
          rule: { combinator: "and", filters: [{ field: "weakTopicCount", op: "gte", value: 1 }] }
        }
      };
    }
    if (system === "flags") {
      return {
        flags: {
          quizverse_weak_topic_event_enabled: {
            id: "quizverse_weak_topic_event_enabled",
            key: "quizverse_weak_topic_event_enabled",
            enabled: true,
            value: true,
            rollout: 100,
            description: "Controls weak-topic LiveOps event visibility."
          }
        }
      };
    }
    if (system === "experiments") {
      return {
        quizverse_reward_tuning_v1: {
          id: "quizverse_reward_tuning_v1",
          name: "QuizVerse Reward Tuning V1",
          variants: [
            { id: "control", weight: 50, config: { rewardMultiplier: 1 } },
            { id: "boosted", weight: 50, config: { rewardMultiplier: 1.25 } }
          ],
          enabled: false
        }
      };
    }
    if (system === "live_events") {
      return {
        quizverse_weekend_exam_sprint: {
          id: "quizverse_weekend_exam_sprint",
          name: "Weekend Exam Sprint",
          gameId: "quizverse",
          audienceId: "quizverse_all_players",
          enabled: true,
          metadata: { exam_id: "jee", topic: "weak_topic", challenge_id: "quizverse_weekend_live_quiz" }
        }
      };
    }
    if (system === "messages") {
      return {
        quizverse_streak_rescue: {
          id: "quizverse_streak_rescue",
          title: "Keep your streak alive",
          body: "One quick quiz today protects your progress.",
          audienceId: "quizverse_all_players",
          metadata: { screen: "daily_quiz", campaign: "streak_rescue" },
          status: "draft"
        }
      };
    }
    if (system === "metrics") {
      return {
        quiz_completion_rate: {
          id: "quiz_completion_rate",
          name: "Quiz Completion Rate",
          eventName: "quiz_completed",
          aggregation: "count",
          windowSec: 86400
        },
        weak_topic_accuracy_lift: {
          id: "weak_topic_accuracy_lift",
          name: "Weak Topic Accuracy Lift",
          eventName: "weak_topic_practice_completed",
          aggregation: "avg",
          metadataField: "accuracy_delta",
          windowSec: 86400
        },
        streak_rescue_return_rate: {
          id: "streak_rescue_return_rate",
          name: "Streak Rescue Return Rate",
          eventName: "session_started",
          aggregation: "count",
          windowSec: 86400
        },
        alerts: {
          analytics_freshness: { metric: "last_event_age_minutes", operator: "lt", threshold: 60 }
        }
      };
    }
    return undefined;
  }

  // ---- Hiro Config CRUD ----

  function adminGameId(data: any): string {
    return String(data.game_id || data.gameId || "").trim();
  }

  // Normalise any raw game identifier (UUID, slug, "global", "all") to the
  // canonical slug/id before building the storage key, so admin writes and
  // player reads always land on the same key.
  function adminCanonicalGameId(nk: nkruntime.Nakama, gameId: string): string {
    try {
      if (typeof LegacyGameRegistry !== "undefined" && LegacyGameRegistry.resolveCanonicalGameId) {
        return LegacyGameRegistry.resolveCanonicalGameId(nk, gameId) || gameId;
      }
    } catch (_e) { /* pass through on any error */ }
    return gameId;
  }

  function adminConfigKey(system: string, gameId: string): string {
    return Constants.gameKey(gameId || undefined, system);
  }

  function readScopedConfig(nk: nkruntime.Nakama, collection: string, system: string, gameId: string, defaultValue: any): any {
    var canonId = adminCanonicalGameId(nk, gameId);
    var key = adminConfigKey(system, canonId);
    var config = Storage.readSystemJson<any>(nk, collection, key);
    // Bare (unscoped) keys are the ORIGINAL app's (QuizVerse's) legacy data.
    // Only that app may inherit them when its scoped doc is missing — for any
    // other app the scoped view must stay empty instead of showing another
    // app's flags / experiments / events / messages as its own.
    if ((!config || objectCount(config) === 0) && canonId && ConfigLoader.isLegacyBareKeyOwner(nk, canonId)) {
      config = Storage.readSystemJson<any>(nk, collection, system);
    }
    if (!config || objectCount(config) === 0) config = defaultValue;
    return config || {};
  }

  function saveScopedSatoriConfig(nk: nkruntime.Nakama, system: string, gameId: string, config: any): string {
    var canonId = adminCanonicalGameId(nk, gameId);
    var key = adminConfigKey(system, canonId);
    ConfigLoader.saveSatoriConfig(nk, key, config);
    return key;
  }

  function rpcConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");

    var gameId = adminCanonicalGameId(nk, adminGameId(data));
    var key = adminConfigKey(data.system, gameId);
    var inherited = false;
    var config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, key);
    if ((!config || objectCount(config) === 0) && gameId) {
      config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
      inherited = !!config && objectCount(config) > 0;
    }
    if (!config || objectCount(config) === 0) {
      var hiroDefault = defaultHiroConfig(data.system);
      if (hiroDefault !== undefined) {
        if (!gameId) ConfigLoader.saveConfig(nk, data.system, hiroDefault);
        config = hiroDefault;
      }
    }
    return RpcHelpers.successResponse({ system: data.system, game_id: gameId || Constants.DEFAULT_GAME_ID, key: key, inherited: inherited, config: config || {} });
  }

  function rpcConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = configFromPayload(data);
    if (!data.system || config === undefined) return RpcHelpers.errorResponse("system and config required");

    var gameId = adminCanonicalGameId(nk, adminGameId(data));
    var key = adminConfigKey(data.system, gameId);
    ConfigLoader.saveConfig(nk, key, config);
    logAdminAudit(nk, ctx, "hiro_config_set", { system: data.system, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { source: "admin_console" });
    return RpcHelpers.successResponse({ system: data.system, game_id: gameId || Constants.DEFAULT_GAME_ID, key: key, saved: true });
  }

  function rpcConfigDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required");

    var gameId = adminCanonicalGameId(nk, adminGameId(data));
    var key = adminConfigKey(data.system, gameId);
    Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, key, Constants.SYSTEM_USER_ID);
    ConfigLoader.invalidateCache(key);
    logAdminAudit(nk, ctx, "hiro_config_delete", { system: data.system, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key });
    return RpcHelpers.successResponse({ system: data.system, game_id: gameId || Constants.DEFAULT_GAME_ID, key: key, deleted: true });
  }

  // ---- Satori Config CRUD ----

  function rpcSatoriConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");

    var gameId = adminCanonicalGameId(nk, adminGameId(data));
    var key = adminConfigKey(data.system, gameId);
    var inherited = false;
    var config = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, key);
    if ((!config || objectCount(config) === 0) && gameId) {
      config = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
      inherited = !!config && objectCount(config) > 0;
    }
    if (!config || objectCount(config) === 0) {
      var satoriDefault = defaultSatoriConfig(data.system);
      if (satoriDefault !== undefined) {
        if (!gameId) ConfigLoader.saveSatoriConfig(nk, data.system, satoriDefault);
        config = satoriDefault;
      }
    }
    return RpcHelpers.successResponse({ system: data.system, game_id: gameId || Constants.DEFAULT_GAME_ID, key: key, inherited: inherited, config: config || {} });
  }

  function rpcSatoriConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = configFromPayload(data);
    if (!data.system || config === undefined) return RpcHelpers.errorResponse("system and config required");

    var gameId = adminCanonicalGameId(nk, adminGameId(data));
    var key = adminConfigKey(data.system, gameId);
    ConfigLoader.saveSatoriConfig(nk, key, config);
    logAdminAudit(nk, ctx, "satori_config_set", { system: data.system, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { source: "admin_console" });
    return RpcHelpers.successResponse({ system: data.system, game_id: gameId || Constants.DEFAULT_GAME_ID, key: key, saved: true });
  }

  // ---- Bulk Import/Export ----

  function rpcBulkExport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var hiroSystems = ["economy", "inventory", "achievements", "progression", "energy", "stats", "streaks", "store", "challenges", "tutorials", "unlockables", "auctions", "incentives"];
    var satoriSystems = ["audiences", "flags", "experiments", "live_events", "messages", "metrics", "webhooks", "taxonomy", "data_lake"];

    var exported: any = { hiro: {}, satori: {} };

    for (var i = 0; i < hiroSystems.length; i++) {
      var config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, hiroSystems[i]);
      if (config) exported.hiro[hiroSystems[i]] = config;
    }

    for (var j = 0; j < satoriSystems.length; j++) {
      var sConfig = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, satoriSystems[j]);
      if (sConfig) exported.satori[satoriSystems[j]] = sConfig;
    }

    return RpcHelpers.successResponse(exported);
  }

  function rpcBulkImport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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

    logAdminAudit(nk, ctx, "admin_bulk_import", { imported: imported });
    return RpcHelpers.successResponse({ imported: imported });
  }

  // ---- Cache Management ----

  function rpcCacheInvalidate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    ConfigLoader.invalidateCache(data.system);
    return RpcHelpers.successResponse({ invalidated: data.system || "all" });
  }

  // ---- User Data Management ----

  function rpcUserDataGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection) return RpcHelpers.errorResponse("userId and collection required");

    var key = data.key || "state";
    var result = Storage.readJson<any>(nk, data.collection, key, data.userId);
    return RpcHelpers.successResponse({ collection: data.collection, key: key, data: result });
  }

  function rpcUserDataSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection || !data.data) return RpcHelpers.errorResponse("userId, collection, and data required");

    var key = data.key || "state";
    Storage.writeJson(nk, data.collection, key, data.userId, data.data);
    logAdminAudit(nk, ctx, "admin_user_data_set", { userId: data.userId, collection: data.collection, key: key });
    return RpcHelpers.successResponse({ saved: true });
  }

  function rpcUserDataDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection) return RpcHelpers.errorResponse("userId and collection required");

    var key = data.key || "state";
    Storage.deleteRecord(nk, data.collection, key, data.userId);
    logAdminAudit(nk, ctx, "admin_user_data_delete", { userId: data.userId, collection: data.collection, key: key });
    return RpcHelpers.successResponse({ deleted: true });
  }

  // ---- Player Full Profile Inspector ----

  function rpcPlayerInspect(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");
    var gameId = adminGameId(data);

    var profile: any = {};

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
    } catch (e: any) {
      profile.account = { error: e.message || String(e) };
    }

    var collections = [
      { name: "wallet", collection: Constants.WALLETS_COLLECTION, key: gameId ? ("wallet_" + data.userId + "_" + gameId) : "wallet" },
      { name: "inventory", collection: Constants.HIRO_INVENTORY_COLLECTION, key: Constants.gameKey(gameId, "items") },
      { name: "achievements", collection: Constants.HIRO_ACHIEVEMENTS_COLLECTION, key: Constants.gameKey(gameId, "progress") },
      { name: "progression", collection: Constants.HIRO_PROGRESSION_COLLECTION, key: Constants.gameKey(gameId, "state") },
      { name: "energy", collection: Constants.HIRO_ENERGY_COLLECTION, key: Constants.gameKey(gameId, "state") },
      { name: "stats", collection: Constants.HIRO_STATS_COLLECTION, key: Constants.gameKey(gameId, "values") },
      { name: "streaks", collection: Constants.HIRO_STREAKS_COLLECTION, key: Constants.gameKey(gameId, "state") },
      { name: "tutorials", collection: Constants.HIRO_TUTORIALS_COLLECTION, key: Constants.gameKey(gameId, "progress") },
      { name: "unlockables", collection: Constants.HIRO_UNLOCKABLES_COLLECTION, key: Constants.gameKey(gameId, "state") },
      { name: "satoriIdentity", collection: Constants.SATORI_IDENTITY_COLLECTION, key: "props" },
      { name: "satoriAssignments", collection: Constants.SATORI_ASSIGNMENTS_COLLECTION, key: Constants.gameKey(gameId, "assignments") },
      { name: "mailbox", collection: Constants.HIRO_MAILBOX_COLLECTION, key: Constants.gameKey(gameId, "inbox") }
    ];

    var reads: nkruntime.StorageReadRequest[] = [];
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
        if (!found) profile[collections[j].name] = null;
      }
    } catch (e: any) {
      profile.storageError = e.message || String(e);
    }

    return RpcHelpers.successResponse(profile);
  }

  function accountToConsoleAccount(account: nkruntime.Account): any {
    var user = account.user;
    var createTimeSec = Number(user.createTime || 0);
    var updateTimeSec = Number(user.updateTime || 0);
    var verifyTimeSec = Number(account.verifyTime || 0);
    var disableTimeSec = Number(account.disableTime || 0);
    return {
      user: {
        id: user.userId,
        user_id: user.userId,
        username: user.username || "",
        display_name: user.displayName || "",
        avatar_url: user.avatarUrl || "",
        lang_tag: user.langTag || "",
        location: user.location || "",
        timezone: user.timezone || "",
        metadata: user.metadata || {},
        create_time: createTimeSec > 0 ? new Date(createTimeSec * 1000).toISOString() : "",
        update_time: updateTimeSec > 0 ? new Date(updateTimeSec * 1000).toISOString() : "",
        online: !!user.online
      },
      wallet: account.wallet ? JSON.stringify(account.wallet) : "{}",
      email: account.email || "",
      devices: account.devices || [],
      custom_id: account.customId || "",
      verify_time: verifyTimeSec > 0 ? new Date(verifyTimeSec * 1000).toISOString() : "",
      disable_time: disableTimeSec > 0 ? new Date(disableTimeSec * 1000).toISOString() : ""
    };
  }

  function rowToConsoleAccount(row: any): any {
    return {
      user: {
        id: row.id,
        user_id: row.id,
        username: row.username || "",
        display_name: row.display_name || "",
        avatar_url: row.avatar_url || "",
        lang_tag: row.lang_tag || "",
        location: row.location || "",
        timezone: row.timezone || "",
        metadata: row.metadata || {},
        create_time: row.create_time || "",
        update_time: row.update_time || "",
        online: false
      },
      wallet: row.wallet || "{}",
      email: row.email || "",
      devices: [],
      custom_id: row.custom_id || "",
      verify_time: row.verify_time || "",
      disable_time: row.disable_time || ""
    };
  }

  function rpcAccountsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.max(1, Math.min(Number(data.limit || 20), 100));
    var offset = Math.max(0, Number(data.cursor || 0));
    var filter = String(data.filter || "").trim();
    var like = "%" + filter.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_") + "%";
    var rows: any[] = [];

    if (filter) {
      rows = nk.sqlQuery(
        "SELECT id::text, username, display_name, avatar_url, lang_tag, location, timezone, metadata, wallet::text, email, custom_id, verify_time, disable_time, create_time, update_time " +
        "FROM users WHERE username ILIKE $1 OR display_name ILIKE $1 OR id::text = $2 " +
        "ORDER BY update_time DESC LIMIT $3 OFFSET $4",
        [like, filter, limit + 1, offset]
      ) || [];
    } else {
      rows = nk.sqlQuery(
        "SELECT id::text, username, display_name, avatar_url, lang_tag, location, timezone, metadata, wallet::text, email, custom_id, verify_time, disable_time, create_time, update_time " +
        "FROM users ORDER BY update_time DESC LIMIT $1 OFFSET $2",
        [limit + 1, offset]
      ) || [];
    }

    var hasMore = rows.length > limit;
    if (hasMore) rows = rows.slice(0, limit);
    var users: any[] = [];
    for (var i = 0; i < rows.length; i++) users.push(rowToConsoleAccount(rows[i]));
    return RpcHelpers.successResponse({
      users: users,
      cursor: hasMore ? String(offset + limit) : "",
      total_count: users.length
    });
  }

  function rpcAccountGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");
    var accounts = nk.accountsGetId([data.userId]);
    if (!accounts || accounts.length === 0) return RpcHelpers.errorResponse("account not found", 404);
    return RpcHelpers.successResponse(accountToConsoleAccount(accounts[0]));
  }

  function rpcAccountBan(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");
    nk.usersBanId([data.userId]);
    logAdminAudit(nk, ctx, "admin_account_ban", { userId: data.userId });
    return RpcHelpers.successResponse({ banned: true, userId: data.userId });
  }

  function rpcAccountUnban(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");
    nk.usersUnbanId([data.userId]);
    logAdminAudit(nk, ctx, "admin_account_unban", { userId: data.userId });
    return RpcHelpers.successResponse({ unbanned: true, userId: data.userId });
  }

  function rpcAccountDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");
    nk.accountDeleteId(data.userId, true);
    logAdminAudit(nk, ctx, "admin_account_delete", { userId: data.userId });
    return RpcHelpers.successResponse({ deleted: true, userId: data.userId });
  }

  function rpcMatchesList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.max(1, Math.min(Number(data.limit || 50), 100));
    var label = data.label ? String(data.label) : null;
    var matches = nk.matchList(limit, null, label, null, null, null) || [];
    var out: any[] = [];
    for (var i = 0; i < matches.length; i++) {
      var match: any = matches[i];
      out.push({
        match_id: match.matchId,
        authoritative: !!match.authoritative,
        size: match.size || 0,
        label: match.label || "",
        handler_name: match.handlerName || "",
        tick_rate: match.tickRate || 0,
        presences: []
      });
    }
    return RpcHelpers.successResponse({ matches: out });
  }

  function isoFromUnixSec(value: any): string {
    var sec = Number(value || 0);
    return sec > 0 ? new Date(sec * 1000).toISOString() : "";
  }

  function tournamentToAdmin(t: nkruntime.Tournament): any {
    return {
      id: t.id,
      title: t.title || t.id,
      description: t.description || "",
      category: t.category,
      sort_order: t.sortOrder,
      size: t.size,
      max_size: t.maxSize,
      max_num_score: t.maxNumScore,
      can_enter: t.canEnter,
      end_active: t.endActive,
      next_reset: t.nextReset,
      metadata: t.metadata || {},
      create_time: isoFromUnixSec(t.createTime),
      start_time: isoFromUnixSec(t.startTime),
      end_time: isoFromUnixSec(t.endTime),
      duration: t.duration,
      start_active: t.startActive,
      operator: "best",
      prev_reset: t.prevReset,
      authoritative: false
    };
  }

  function leaderboardRecordToAdmin(r: nkruntime.LeaderboardRecord): any {
    return {
      leaderboard_id: r.leaderboardId,
      owner_id: r.ownerId,
      username: r.username || "",
      score: r.score,
      subscore: r.subscore,
      num_score: r.numScore,
      metadata: r.metadata || {},
      create_time: isoFromUnixSec(r.createTime),
      update_time: isoFromUnixSec(r.updateTime),
      expiry_time: isoFromUnixSec(r.expiryTime),
      rank: r.rank
    };
  }

  function tournamentRecordsToAdmin(list: nkruntime.TournamentRecordList): any {
    var records: any[] = [];
    var ownerRecords: any[] = [];
    var rawRecords = list.records || [];
    var rawOwnerRecords = list.ownerRecords || [];
    for (var i = 0; i < rawRecords.length; i++) records.push(leaderboardRecordToAdmin(rawRecords[i]));
    for (var j = 0; j < rawOwnerRecords.length; j++) ownerRecords.push(leaderboardRecordToAdmin(rawOwnerRecords[j]));
    return {
      records: records,
      owner_records: ownerRecords,
      next_cursor: list.nextCursor || "",
      prev_cursor: list.prevCursor || "",
      rank_count: list.rankCount || 0
    };
  }

  function rpcTournamentsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var limit = Math.max(1, Math.min(Number(data.limit || 100), 100));
    var categoryStart = data.categoryStart !== undefined ? Number(data.categoryStart) : 0;
    var categoryEnd = data.categoryEnd !== undefined ? Number(data.categoryEnd) : 127;
    categoryStart = Math.max(0, Math.min(categoryStart, 127));
    categoryEnd = Math.max(categoryStart, Math.min(categoryEnd, 127));
    var result = nk.tournamentList(
      categoryStart,
      categoryEnd,
      data.startTime !== undefined ? Number(data.startTime) : undefined,
      data.endTime !== undefined ? Number(data.endTime) : undefined,
      limit,
      data.cursor || undefined
    );
    var tournaments: any[] = [];
    var raw = result.tournaments || [];
    for (var i = 0; i < raw.length; i++) tournaments.push(tournamentToAdmin(raw[i]));
    return RpcHelpers.successResponse({ tournaments: tournaments, cursor: result.cursor || "" });
  }

  function rpcTournamentCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var id = String(data.id || data.tournamentId || "").trim();
    if (!id) return RpcHelpers.errorResponse("id required");

    var existing = nk.tournamentsGetId([id]);
    if (existing && existing.length > 0) {
      return RpcHelpers.successResponse({ tournament: tournamentToAdmin(existing[0]), created: false });
    }

    var sortOrder = String(data.sortOrder || data.sort_order || "desc").toLowerCase() === "asc"
      ? nkruntime.SortOrder.ASCENDING
      : nkruntime.SortOrder.DESCENDING;
    var operatorName = String(data.operator || "best").toLowerCase();
    var operator = nkruntime.Operator.BEST;
    if (operatorName === "set") operator = nkruntime.Operator.SET;
    if (operatorName === "incr" || operatorName === "incremental") operator = nkruntime.Operator.INCREMENTAL;

    var now = Math.floor(Date.now() / 1000);
    var startTime = Number(data.startTime || data.start_time || now - 60);
    var endTime = Number(data.endTime || data.end_time || now + 7 * 24 * 60 * 60);
    var duration = Number(data.duration || Math.max(3600, endTime - startTime));
    var metadata = data.metadata || {};
    if (data.gameId || data.game_id) metadata.gameId = data.gameId || data.game_id;

    nk.tournamentCreate(
      id,
      !!data.authoritative,
      sortOrder,
      operator,
      duration,
      data.resetSchedule || data.reset_schedule || null,
      metadata,
      data.title || id,
      data.description || "",
      data.category !== undefined ? Math.max(0, Math.min(Number(data.category), 127)) : 0,
      startTime,
      endTime,
      data.maxSize !== undefined ? Number(data.maxSize) : (data.max_size !== undefined ? Number(data.max_size) : 10000),
      data.maxNumScore !== undefined ? Number(data.maxNumScore) : (data.max_num_score !== undefined ? Number(data.max_num_score) : 10),
      !!data.joinRequired,
      data.enableRank !== false
    );

    var created = nk.tournamentsGetId([id]);
    var tournament = created && created.length > 0 ? tournamentToAdmin(created[0]) : { id: id, metadata: metadata };
    logAdminAudit(nk, ctx, "admin_tournament_create", { id: id, gameId: metadata.gameId || "" });
    return RpcHelpers.successResponse({ tournament: tournament, created: true });
  }

  function rpcTournamentRecordsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.tournamentId) return RpcHelpers.errorResponse("tournamentId required");
    var limit = Math.max(1, Math.min(Number(data.limit || 50), 100));
    var ownerIds = data.ownerIds || [];
    var result = nk.tournamentRecordsList(data.tournamentId, ownerIds, limit, data.cursor || undefined, 0);
    return RpcHelpers.successResponse(tournamentRecordsToAdmin(result));
  }

  function rpcTournamentRecordsAroundOwner(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.tournamentId || !data.ownerId) return RpcHelpers.errorResponse("tournamentId and ownerId required");
    var limit = Math.max(1, Math.min(Number(data.limit || 50), 100));
    var result = nk.tournamentRecordsHaystack(data.tournamentId, data.ownerId, limit, data.cursor || undefined, 0);
    return RpcHelpers.successResponse(tournamentRecordsToAdmin(result));
  }

  function rpcTournamentRecordWrite(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.tournamentId) return RpcHelpers.errorResponse("tournamentId required");
    var ownerId = data.ownerId || ctx.userId || Constants.SYSTEM_USER_ID;
    var username = data.username || "admin";
    var record = nk.tournamentRecordWrite(
      data.tournamentId,
      ownerId,
      username,
      Number(data.score || 0),
      Number(data.subscore || 0),
      data.metadata || {},
      nkruntime.OverrideOperator.BEST
    );
    logAdminAudit(nk, ctx, "admin_tournament_record_write", { tournamentId: data.tournamentId, ownerId: ownerId });
    return RpcHelpers.successResponse(leaderboardRecordToAdmin(record));
  }

  // ---- Wallet Direct Operations ----

  function adminUserId(data: any): string {
    return String(data.userId || data.user_id || "").trim();
  }

  // The bare (unscoped) wallet is the legacy owner's wallet — fold a
  // "quizverse" scope (any alias) down to the bare path so admin grants land
  // where the QuizVerse game actually reads.
  function walletGameId(nk: nkruntime.Nakama, data: any): string {
    var gameId = adminGameId(data);
    if (gameId && ConfigLoader.isLegacyBareKeyOwner(nk, gameId)) return "";
    return gameId;
  }

  function rpcWalletView(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var userId = adminUserId(data);
    if (!userId) return RpcHelpers.errorResponse("userId required");

    var gameId = walletGameId(nk, data);
    var wallet = gameId
      ? WalletHelpers.getGameWallet(nk, userId, gameId)
      : Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, "wallet", userId);
    return RpcHelpers.successResponse({ userId: userId, wallet: wallet || {} });
  }

  function rpcWalletGrant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var userId = adminUserId(data);
    if (!userId || !data.currencies) return RpcHelpers.errorResponse("userId and currencies required (e.g. { userId: '...', currencies: { coins: 100, gems: 5 } })");

    var gameId = walletGameId(nk, data);
    var wallet = gameId ? WalletHelpers.getGameWallet(nk, userId, gameId) : (Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, "wallet", userId) || {});
    for (var currency in data.currencies) {
      if (gameId) {
        wallet.currencies[currency] = (wallet.currencies[currency] || 0) + data.currencies[currency];
      } else {
        wallet[currency] = (wallet[currency] || 0) + data.currencies[currency];
      }
    }
    if (gameId) WalletHelpers.saveGameWallet(nk, wallet);
    else Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", userId, wallet);

    // The console (Economy / Players pages) displays the NATIVE Nakama wallet,
    // so mirror bare-scope grants there too; otherwise admin grants look like
    // no-ops in the UI even though the storage wallet changed.
    var nativeUpdated = false;
    var nativeError = "";
    if (!gameId) {
      try {
        nk.walletUpdate(userId, data.currencies, { source: "admin_wallet_grant" }, true);
        nativeUpdated = true;
      } catch (e: any) {
        nativeError = String(e && e.message ? e.message : e);
        logger.warn("[AdminWallet] native walletUpdate failed for %s: %s", userId, nativeError);
      }
    }

    EventBus.emit(nk, logger, ctx, "wallet_updated", { userId: userId, wallet: wallet, granted: data.currencies });
    logAdminAudit(nk, ctx, "admin_wallet_grant", { userId: userId, gameId: gameId || Constants.DEFAULT_GAME_ID }, { currencies: data.currencies });
    return RpcHelpers.successResponse({ userId: userId, wallet: wallet, nativeUpdated: nativeUpdated, nativeError: nativeError || undefined });
  }

  function rpcWalletReset(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    data.userId = adminUserId(data);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var gameId = walletGameId(nk, data);
    var defaults = data.defaults || {};
    if (gameId) {
      WalletHelpers.saveGameWallet(nk, {
        userId: data.userId,
        gameId: gameId,
        currencies: defaults.currencies || defaults || { game: 0, tokens: 0, xp: 0 },
        items: defaults.items || {}
      });
    } else {
      Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
    }
    logAdminAudit(nk, ctx, "admin_wallet_reset", { userId: data.userId, gameId: gameId || Constants.DEFAULT_GAME_ID });
    return RpcHelpers.successResponse({ userId: data.userId, wallet: defaults, reset: true });
  }

  // ---- Storage Collections Browser ----

  function rpcStorageList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.collection) return RpcHelpers.errorResponse("collection required");

    var userId = data.userId || Constants.SYSTEM_USER_ID;
    var limit = data.limit || 50;
    var result = Storage.listUserRecords(nk, data.collection, userId, limit, data.cursor);

    var items: any[] = [];
    var objects: any[] = [];
    for (var i = 0; i < result.records.length; i++) {
      var r = result.records[i];
      objects.push({
        collection: r.collection,
        key: r.key,
        user_id: r.userId,
        version: r.version,
        permission_read: r.permissionRead,
        permission_write: r.permissionWrite,
        create_time: new Date((r.createTime || 0) * 1000).toISOString(),
        update_time: new Date((r.updateTime || 0) * 1000).toISOString(),
        value: r.value
      });
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
      objects: objects,
      items: items
    });
  }

  function rpcStorageWrite(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.collection || !data.key) return RpcHelpers.errorResponse("collection and key required");
    var userId = data.userId || Constants.SYSTEM_USER_ID;
    var acks = nk.storageWrite([{
      collection: data.collection,
      key: data.key,
      userId: userId,
      value: data.value || {},
      version: data.version || "*",
      permissionRead: data.permissionRead !== undefined ? data.permissionRead : 2 as nkruntime.ReadPermissionValues,
      permissionWrite: data.permissionWrite !== undefined ? data.permissionWrite : 1 as nkruntime.WritePermissionValues
    }]);
    logAdminAudit(nk, ctx, "admin_storage_write", { userId: userId, collection: data.collection, key: data.key });
    return RpcHelpers.successResponse({
      key: data.key,
      collection: data.collection,
      userId: userId,
      version: acks && acks.length > 0 ? acks[0].version : ""
    });
  }

  // ---- Admin-safe Satori Lists ----

  function rpcAdminAudiencesList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = adminGameId(data);
    var audiencesConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "audiences", gameId, {});
    var rawAudiences = audiencesConfig.audiences || audiencesConfig;
    var audiences: any[] = [];

    for (var id in rawAudiences) {
      var def = rawAudiences[id] || {};
      audiences.push({
        id: def.id || id,
        name: def.name || id,
        description: def.description || "",
        rule: def.rule || def.query || {},
        size_estimate: def.sizeEstimate || def.size_estimate || 0,
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ audiences: audiences, game_id: gameId || Constants.DEFAULT_GAME_ID });
  }

  function rpcAdminFlagsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = adminGameId(data);
    var flagsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "flags", gameId, { flags: {} });
    var rawFlags = flagsConfig.flags || {};
    var flags: any[] = [];

    for (var name in rawFlags) {
      var def = rawFlags[name] || {};
      flags.push({
        name: def.name || name,
        value: def.value !== undefined ? String(def.value) : "",
        enabled: def.enabled !== false,
        audiences: firstArray(def.audiences) || firstArray(def.audienceIds) || (def.conditionsByAudience ? Object.keys(def.conditionsByAudience) : []),
        description: def.description || "",
        created_at: isoFromSec(def.createdAt),
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ flags: flags, game_id: gameId || Constants.DEFAULT_GAME_ID });
  }

  function rpcAdminExperimentsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = adminGameId(data);
    var experimentsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "experiments", gameId, {});
    var experiments: any[] = [];

    for (var id in experimentsConfig) {
      var def = experimentsConfig[id] || {};
      experiments.push({
        id: def.id || id,
        name: def.name || id,
        description: def.description || "",
        enabled: def.enabled !== undefined ? !!def.enabled : def.status !== "draft",
        audiences: firstArray(def.audiences) || (def.audienceId ? [def.audienceId] : []),
        variants: def.variants || [],
        created_at: isoFromSec(def.createdAt),
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ experiments: experiments, game_id: gameId || Constants.DEFAULT_GAME_ID });
  }

  function rpcAdminLiveEventsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = adminGameId(data);
    var eventsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_events", gameId, {});
    var events: any[] = [];

    // Add Satori-managed events
    for (var id in eventsConfig) {
      var def = eventsConfig[id] || {};
      events.push({
        id: def.id || id,
        name: def.name || id,
        description: def.description || "",
        start_time_sec: def.start_time_sec || def.startTimeSec || def.startAt,
        end_time_sec: def.end_time_sec || def.endTimeSec || def.endAt,
        rewards_json: def.rewards_json || (def.reward ? JSON.stringify(def.reward) : undefined),
        audiences: firstArray(def.audiences) || (def.audienceId ? [def.audienceId] : []),
        enabled: def.enabled !== false,
        created_at: isoFromSec(def.createdAt),
        updated_at: isoFromSec(def.updatedAt),
        source: "satori_platform"
      });
    }

    // Also fetch creator-portal events from Nakama storage (live_events collection).
    // Events published via creator_live_event_publish RPC are stored under the system
    // user ID so storageList can find them without needing to know individual creator IDs.
    try {
      var cursor = "";
      var creatorEventsCollection = "live_events";
      for (var page = 0; page < 10; page++) { // Max 10 pages = 1000 events
        var result = nk.storageList(Constants.SYSTEM_USER_ID, creatorEventsCollection, 100, cursor);
        var objects = result.objects || [];
        
        for (var i = 0; i < objects.length; i++) {
          var obj = objects[i];
          if (!obj.value) continue;
          
          var ev: any = obj.value;
          // Filter by gameId if specified
          if (gameId && ev.gameId && ev.gameId !== gameId) continue;

          // Compute dynamic status based on current time
          var nowSec = Math.floor(Date.now() / 1000);
          var startSec = ev.scheduledAt || ev.createdAt || 0;
          var endSec = startSec + (ev.duration || 30) * 60;
          var derivedStatus = ev.status;
          if (derivedStatus === "published") {
            if (nowSec >= startSec && nowSec < endSec) derivedStatus = "live";
            else if (nowSec >= endSec) derivedStatus = "ended";
          }

          // Build rewards_json from giftCardPrizes or prizes array
          var rewardsJson: string | undefined = undefined;
          if (ev.giftCardPrizes && ev.giftCardPrizes.tiers) {
            rewardsJson = JSON.stringify(ev.giftCardPrizes.tiers.map(function(t: any) {
              return { type: t.brand || "prize", rank: t.rank, amount: t.value, currency: t.currency, label: t.prize };
            }));
          } else if (ev.prizes && ev.prizes.length > 0) {
            rewardsJson = JSON.stringify(ev.prizes);
          } else if (ev.prizePool > 0) {
            rewardsJson = JSON.stringify([{ type: "xut", amount: ev.prizePool, currency: "XUT" }]);
          }
          
          // Convert creator event to admin dashboard format with QuizVerse-specific fields
          events.push({
            // Satori-compatible base fields
            id: ev.id || obj.key,
            name: ev.title || "Untitled Creator Event",
            description: ev.description || "",
            start_time_sec: startSec,
            end_time_sec: endSec,
            rewards_json: rewardsJson,
            audiences: [],
            enabled: ev.status !== "ended" && ev.status !== "cancelled",
            created_at: isoFromSec(ev.createdAt),
            updated_at: isoFromSec(ev.publishedAt || ev.createdAt),

            // QuizVerse creator event specific fields
            source: "quizverse_creator",
            creator_id: ev.creatorId || obj.userId,
            game_id: ev.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b",
            game_mode: ev.gameMode || "best_guess",
            difficulty: ev.difficulty || "challenge",
            category: ev.category || "",
            custom_topic: ev.customTopic || "",
            participant_count: ev.participantCount || 0,
            prize_pool: ev.prizePool || 0,
            entry_fee: ev.entryFee || 0,
            gift_card_prizes: ev.giftCardPrizes || null,
            prize_funding: ev.prizeFunding || null,
            visibility: ev.visibility || "public",
            region: ev.region || "global",
            timezone: ev.timezone || "UTC",
            duration_minutes: ev.duration || 30,
            clue_count: ev.clues ? ev.clues.length : 0,
            question_count: ev.questions ? ev.questions.length : 0,
            promo_video_url: ev.promoVideoUrl || "",
            deep_link_url: ev.deepLinkUrl || "",
            status: derivedStatus,
            published_at: isoFromSec(ev.publishedAt),
            ended_at: isoFromSec(ev.endedAt)
          });
        }
        
        cursor = result.cursor || "";
        if (!cursor) break;
      }
    } catch (e: any) {
      logger.warn("[rpcAdminLiveEventsList] Failed to fetch creator events: %s", e.message || String(e));
    }

    return RpcHelpers.successResponse({ events: events, game_id: gameId || Constants.DEFAULT_GAME_ID });
  }

  // Called by the creator portal to publish a live event.
  // Stores the event under the SYSTEM user ID so rpcAdminLiveEventsList
  // can find it via storageList(SYSTEM_USER_ID, "live_events", ...).
  // The original creatorId field is preserved inside the value for attribution.
  function rpcCreatorLiveEventPublish(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    var event: any = data.event || data;

    if (!event.id) {
      throw new Error("event.id is required");
    }

    // Tag with the calling user as creator if not already set
    if (!event.creatorId && ctx.userId) {
      event.creatorId = ctx.userId;
    }

    // Default gameId to QuizVerse if not provided
    if (!event.gameId) {
      event.gameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    }

    if (!event.createdAt) {
      event.createdAt = Math.floor(Date.now() / 1000);
    }

    // Store under SYSTEM user so admin storageList can find it
    nk.storageWrite([{
      collection: "live_events",
      key: event.id,
      userId: Constants.SYSTEM_USER_ID,
      value: event,
      permissionRead: 2,
      permissionWrite: 0,
    }]);

    logger.info("[rpcCreatorLiveEventPublish] Published event %s by creator %s", event.id, event.creatorId || "unknown");
    return RpcHelpers.successResponse({ eventId: event.id, success: true });
  }

  /**
   * Resolve a creator event record by id, regardless of which storage path
   * created it. SPA-published events live in `live_events` under the CREATOR's
   * own user id, Nakama-native ones live in `satori_creator_events` under
   * SYSTEM. This checks, in order:
   *   1. live_events @ SYSTEM_USER_ID
   *   2. live_events @ any owner (full collection scan)
   *   3. satori_creator_events @ SYSTEM_USER_ID
   * Returns the full storage object (value + owner + version + times) or null.
   */
  function resolveCreatorEventRecord(nk: nkruntime.Nakama, eventId: string): nkruntime.StorageObject | null {
    var direct = nk.storageRead([{ collection: "live_events", key: eventId, userId: Constants.SYSTEM_USER_ID }]);
    if (direct && direct.length > 0 && direct[0].value) return direct[0];

    var cursor = "";
    for (var page = 0; page < 10; page++) {
      // null owner = list across ALL users (empty string "" is NOT valid —
      // Nakama's JS runtime runs it through uuid.FromString and throws
      // "expects empty or valid user id"). SPA events are creator-owned.
      var res = nk.storageList(null, "live_events", 100, cursor);
      var objs = (res && res.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        if (objs[i].value && (objs[i].key === eventId || (objs[i].value as any).id === eventId)) {
          return objs[i];
        }
      }
      cursor = (res && res.cursor) || "";
      if (!cursor) break;
    }

    var canonical = nk.storageRead([{ collection: "satori_creator_events", key: eventId, userId: Constants.SYSTEM_USER_ID }]);
    if (canonical && canonical.length > 0 && canonical[0].value) return canonical[0];

    return null;
  }

  // Get detailed stats for a creator event (participation, leaderboard, etc.)
  function rpcAdminCreatorEventStats(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.event_id && !data.eventId) return RpcHelpers.errorResponse("event_id required");
    var eventId = data.event_id || data.eventId;

    // Read the event definition (across all storage paths)
    var eventRecord = resolveCreatorEventRecord(nk, eventId);
    if (!eventRecord) {
      return RpcHelpers.errorResponse("Event not found");
    }
    var event: any = eventRecord.value;

    // Try to read leaderboard for this event
    var leaderboardId = "creator_event_" + eventId;
    var leaderboard: any[] = [];
    var totalParticipants = 0;

    try {
      var lbResult = nk.leaderboardRecordsList(leaderboardId, [], 50, "");
      var records = lbResult.records || [];
      totalParticipants = records.length;
      
      for (var i = 0; i < records.length; i++) {
        var rec = records[i];
        leaderboard.push({
          rank: rec.rank || i + 1,
          user_id: rec.ownerId,
          username: rec.username || "",
          score: rec.score || 0,
          subscore: rec.subscore || 0
        });
      }
    } catch (lbErr: any) {
      logger.info("[rpcAdminCreatorEventStats] No leaderboard found for event %s: %s", eventId, lbErr.message || String(lbErr));
    }

    // Also scan event_answers collection for participation stats
    var answersCount = 0;
    var correctAnswers = 0;
    try {
      var cursor = "";
      for (var page = 0; page < 5; page++) {
        var result = nk.storageList(null, "event_answers", 100, cursor);
        var objects = result.objects || [];
        for (var j = 0; j < objects.length; j++) {
          if (objects[j].key !== eventId) continue;
          var ans: any = objects[j].value;
          if (ans && ans.eventId === eventId) {
            answersCount++;
            if (ans.correct) correctAnswers++;
          }
        }
        cursor = result.cursor || "";
        if (!cursor) break;
      }
    } catch (ansErr: any) {
      logger.warn("[rpcAdminCreatorEventStats] Failed to scan answers: %s", ansErr.message || String(ansErr));
    }

    // Use stored participant count if available and higher
    var participantCount = Math.max(event.participantCount || 0, totalParticipants, answersCount);

    return RpcHelpers.successResponse({
      event_id: eventId,
      title: event.title,
      game_mode: event.gameMode,
      status: event.status,
      total_participants: participantCount,
      total_answers: answersCount,
      correct_answers: correctAnswers,
      completion_rate: participantCount > 0 ? ((answersCount / participantCount) * 100).toFixed(1) : "0",
      accuracy_rate: answersCount > 0 ? ((correctAnswers / answersCount) * 100).toFixed(1) : "0",
      prize_pool: event.prizePool || 0,
      gift_card_prizes: event.giftCardPrizes || null,
      leaderboard: leaderboard
    });
  }

  // Admin action: End or disable a creator event
  function rpcAdminCreatorEventEnd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.event_id && !data.eventId) return RpcHelpers.errorResponse("event_id required");
    var eventId = data.event_id || data.eventId;
    var reason = data.reason || "Ended by admin";

    // Read the event (across all storage paths)
    var eventRecord = resolveCreatorEventRecord(nk, eventId);
    if (!eventRecord) {
      return RpcHelpers.errorResponse("Event not found");
    }
    var event: any = eventRecord.value;

    // Update status
    event.status = "ended";
    event.endedAt = Math.floor(Date.now() / 1000);
    event.endedBy = "admin";
    event.endReason = reason;

    // Write back to the SAME owner/collection the record was found in, so SPA
    // events (creator-owned) are updated in place rather than orphaning a copy.
    nk.storageWrite([{
      collection: eventRecord.collection,
      key: eventRecord.key,
      userId: eventRecord.userId,
      value: event,
      permissionRead: 2,
      permissionWrite: 0,
    }]);

    logAdminAudit(nk, ctx, "admin_creator_event_end", { eventId: eventId }, { reason: reason });
    logger.info("[rpcAdminCreatorEventEnd] Admin ended creator event %s: %s", eventId, reason);

    // Rank players from event_answers and queue prize_fulfillments for every
    // gift-card winner so the admin can fulfill ALL winners — not just those
    // who self-claim. Idempotent + best-effort: a failure here must not block
    // the end action itself.
    var prizes: any = null;
    try {
      prizes = SatoriCreatorEvents.computeAndQueueWinners(nk, logger, event, String(eventId));
    } catch (perr: any) {
      logger.warn("[rpcAdminCreatorEventEnd] winner queue failed for %s: %s", eventId, perr.message || String(perr));
    }

    return RpcHelpers.successResponse({ success: true, event_id: eventId, status: "ended", prizes: prizes });
  }

  // Admin action: Get full details of a single creator event
  function rpcAdminCreatorEventGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.event_id && !data.eventId) return RpcHelpers.errorResponse("event_id required");
    var eventId = data.event_id || data.eventId;

    var record = resolveCreatorEventRecord(nk, eventId);
    if (!record) {
      return RpcHelpers.errorResponse("Event not found");
    }

    var event: any = record.value;

    return RpcHelpers.successResponse({
      event: {
        ...event,
        storage_user_id: record.userId,
        storage_version: record.version,
        storage_create_time: isoFromSec(record.createTime),
        storage_update_time: isoFromSec(record.updateTime)
      }
    });
  }

  /**
   * Admin RPC: List ALL creator live events across the platform.
   *
   * Merges events from TWO collections:
   * 1. `satori_creator_events` (system-scoped) — events created via `creator_event_create` RPC
   * 2. `live_events` (SYSTEM_USER_ID owned) — events published via SPA/creator portal
   *
   * Supports filtering by:
   * - `status`: draft | funded | published | live | ended | cancelled | distributed
   * - `region`: global | india | usa | etc.
   * - `creator_id`: filter by creator userId
   * - `game_id`: filter by game (default: QuizVerse)
   * - `limit`: max events to return (default: 100)
   *
   * Returns: { events: [...], total_count, sources: { satori_creator_events, live_events } }
   */
  function rpcAdminCreatorEventsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    var filterStatus = data.status || null;
    var filterRegion = data.region || null;
    var filterCreatorId = data.creator_id || data.creatorId || null;
    var filterGameId = data.game_id || data.gameId || null;
    // Return limit (applied AFTER sorting so the newest events always surface).
    var limit = Math.min(data.limit || 500, 2000);
    // Collection bound — scan far more than `limit` so the sort sees every
    // event, not just the first `limit` ones in storage/index order (which is
    // oldest-first and was silently dropping all recently-created events).
    var scanCap = 2000;

    var events: any[] = [];
    var sourceCounts = { satori_creator_events: 0, live_events: 0 };
    var seenIds: { [id: string]: boolean } = {};
    var nowSec = Math.floor(Date.now() / 1000);

    // Real participant counts. `ev.participantCount` is only incremented by the
    // native rpcJoin flow, which SPA-published events bypass entirely (they
    // write answers straight into `event_answers` under each player's own
    // userId) — so it stays 0 even for events that clearly had players. Sweep
    // event_answers once (bounded) and tally per-event, keyed by event id.
    var participantCounts: { [eventId: string]: number } = {};
    try {
      var aCursor = "";
      var aPages = 0;
      do {
        var aPage = nk.storageList(null, "event_answers", 100, aCursor);
        var aObjs = (aPage && aPage.objects) || [];
        for (var ai = 0; ai < aObjs.length; ai++) {
          var ak = aObjs[ai].key;
          if (!ak) continue;
          participantCounts[ak] = (participantCounts[ak] || 0) + 1;
        }
        aCursor = (aPage && aPage.cursor) || "";
        aPages++;
      } while (aCursor && aPages < 30);
    } catch (aerr: any) {
      logger.warn("[rpcAdminCreatorEventsList] event_answers tally failed: %s", aerr.message || String(aerr));
    }

    function computeEffectiveStatus(ev: any): string {
      if (ev.status === "cancelled" || ev.status === "distributed") return ev.status;
      // Honor an explicit terminal status (or endedAt) set by the
      // creator-portal / admin end action — otherwise a manually-ended event
      // still inside its original time window wrongly reads as "live".
      if (ev.status === "ended" || ev.status === "completed" || ev.status === "closed" || ev.endedAt) return "ended";
      if (ev.status === "draft" || ev.status === "funded") return ev.status;

      var startSec = ev.scheduledAt || ev.createdAt || 0;
      var endSec = startSec + (ev.duration || 30) * 60;

      if (nowSec < startSec) return "published";
      if (nowSec > endSec) return "ended";
      return "live";
    }

    function formatEvent(ev: any, source: string): any {
      var startSec = ev.scheduledAt || ev.createdAt || 0;
      var endSec = startSec + (ev.duration || 30) * 60;
      var effectiveStatus = computeEffectiveStatus(ev);

      var rewardsJson: string | undefined = undefined;
      if (ev.giftCardPrizes && ev.giftCardPrizes.tiers) {
        rewardsJson = JSON.stringify(ev.giftCardPrizes.tiers.map(function(t: any) {
          return { type: t.brand || "prize", rank: t.rank, amount: t.value, currency: t.currency, label: t.prize };
        }));
      } else if (ev.prizes && ev.prizes.length > 0) {
        rewardsJson = JSON.stringify(ev.prizes);
      } else if (ev.prizePool > 0) {
        rewardsJson = JSON.stringify([{ type: "xut", amount: ev.prizePool, currency: "XUT" }]);
      }

      return {
        id: ev.id,
        title: ev.title || "Untitled Event",
        description: ev.description || "",
        category: ev.category || "",
        custom_topic: ev.customTopic || "",
        game_mode: ev.gameMode || "best_guess",
        difficulty: ev.difficulty || "challenge",
        scheduled_at: startSec,
        end_at: endSec,
        duration_minutes: ev.duration || 30,
        region: ev.region || "global",
        timezone: ev.timezone || "UTC",
        entry_fee: ev.entryFee || 0,
        prize_pool: ev.prizePool || 0,
        gift_card_prizes: ev.giftCardPrizes || null,
        prize_funding: ev.prizeFunding || null,
        rewards_json: rewardsJson,
        creator_id: ev.creatorId || "",
        creator_email: ev.creatorEmail || "",
        game_id: ev.gameId || "126bf539-dae2-4bcf-964d-316c0fa1f92b",
        status: effectiveStatus,
        raw_status: ev.status,
        participant_count: Math.max(Number(ev.participantCount) || 0, participantCounts[ev.id] || 0),
        question_count: ev.questions ? ev.questions.length : 0,
        clue_count: ev.clues ? ev.clues.length : 0,
        promo_video_url: ev.promoVideoUrl || "",
        recap_video_url: ev.recapVideoUrl || "",
        deep_link_url: ev.deepLinkUrl || "",
        visibility: ev.visibility || "public",
        created_at: isoFromSec(ev.createdAt),
        published_at: isoFromSec(ev.publishedAt),
        ended_at: isoFromSec(ev.endedAt),
        source: source
      };
    }

    function matchesFilters(ev: any): boolean {
      var effectiveStatus = computeEffectiveStatus(ev);
      if (filterStatus && effectiveStatus !== filterStatus) return false;
      if (filterRegion && (ev.region || "global") !== filterRegion) return false;
      if (filterCreatorId && ev.creatorId !== filterCreatorId) return false;
      if (filterGameId && ev.gameId && ev.gameId !== filterGameId) return false;
      return true;
    }

    // 1. Fetch from satori_creator_events (system-scoped via events_index)
    try {
      var indexRecords = nk.storageRead([{
        collection: "satori_creator_events",
        key: "events_index",
        userId: Constants.SYSTEM_USER_ID
      }]);
      if (indexRecords && indexRecords.length > 0 && indexRecords[0].value) {
        var index = indexRecords[0].value as { eventIds: string[] };
        var eventIds = index.eventIds || [];

        for (var i = 0; i < eventIds.length && events.length < scanCap; i++) {
          var eventId = eventIds[i];
          if (seenIds[eventId]) continue;

          try {
            var evRecords = nk.storageRead([{
              collection: "satori_creator_events",
              key: eventId,
              userId: Constants.SYSTEM_USER_ID
            }]);
            if (evRecords && evRecords.length > 0 && evRecords[0].value) {
              var ev = evRecords[0].value;
              if (matchesFilters(ev)) {
                events.push(formatEvent(ev, "satori_creator_events"));
                seenIds[eventId] = true;
                sourceCounts.satori_creator_events++;
              }
            }
          } catch (readErr: any) {
            logger.warn("[rpcAdminCreatorEventsList] Failed to read event %s: %s", eventId, readErr.message || String(readErr));
          }
        }
      }
    } catch (indexErr: any) {
      logger.warn("[rpcAdminCreatorEventsList] Failed to read satori_creator_events index: %s", indexErr.message || String(indexErr));
    }

    // 2. Fetch from live_events across ALL owners — creator-portal / SPA events.
    // The live.quizverse.world/creator SPA writes the event definition into the
    // `live_events` collection under the CREATOR's own user id (not SYSTEM), so a
    // SYSTEM_USER_ID-only scan silently missed every SPA-published event. Listing
    // with an empty owner ("") enumerates the whole collection (same pattern used
    // by CreatorEventLive), covering both SYSTEM- and creator-owned records.
    try {
      var cursor = "";
      for (var page = 0; page < 40 && events.length < scanCap; page++) {
        // null owner = all users (empty string "" throws in Nakama's JS runtime)
        var result = nk.storageList(null, "live_events", 100, cursor);
        var objects = result.objects || [];

        for (var j = 0; j < objects.length && events.length < scanCap; j++) {
          var obj = objects[j];
          if (!obj.value) continue;

          var ev2: any = obj.value;
          var evId = ev2.id || obj.key;
          if (seenIds[evId]) continue;

          if (matchesFilters(ev2)) {
            events.push(formatEvent(ev2, "live_events"));
            seenIds[evId] = true;
            sourceCounts.live_events++;
          }
        }

        cursor = result.cursor || "";
        if (!cursor) break;
      }
    } catch (listErr: any) {
      logger.warn("[rpcAdminCreatorEventsList] Failed to list live_events: %s", listErr.message || String(listErr));
    }

    // Sort by scheduled_at descending (most recent first) BEFORE applying the
    // return limit, so the newest events are never truncated away.
    events.sort(function(a, b) {
      return (b.scheduled_at || 0) - (a.scheduled_at || 0);
    });

    var matchedCount = events.length;
    if (events.length > limit) {
      events = events.slice(0, limit);
    }

    return RpcHelpers.successResponse({
      events: events,
      total_count: events.length,
      matched_count: matchedCount,
      sources: sourceCounts,
      filters_applied: {
        status: filterStatus,
        region: filterRegion,
        creator_id: filterCreatorId,
        game_id: filterGameId,
        limit: limit
      }
    });
  }

  // Admin action: backfill prize_fulfillments for winners of already-ended
  // creator events whose winners were never queued (players who never
  // self-claimed). Idempotent — skips any (event,user) already on the queue.
  // Payload: { event_id? (single event), creator_id? (filter) }
  function rpcAdminCreatorEventsBackfillPrizes(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var onlyEventId = data.event_id || data.eventId || null;
    var filterCreatorId = data.creator_id || data.creatorId || null;
    var nowSec = Math.floor(Date.now() / 1000);

    function isEnded(ev: any): boolean {
      if (ev.status === "ended" || ev.status === "completed" || ev.status === "closed" || ev.endedAt) return true;
      if (ev.status === "cancelled" || ev.status === "distributed" || ev.status === "draft" || ev.status === "funded") return false;
      var start = ev.scheduledAt || ev.createdAt || 0;
      var end = start + (ev.duration || 30) * 60;
      return nowSec > end;
    }
    function hasTiers(ev: any): boolean {
      return !!(ev && ev.giftCardPrizes && ev.giftCardPrizes.tiers && ev.giftCardPrizes.tiers.length);
    }

    var seen: { [id: string]: boolean } = {};
    var results: any[] = [];
    var totals = { events: 0, ranked: 0, queued: 0, skippedExisting: 0, xutWinners: 0 };

    function process(ev: any): void {
      var id = ev && ev.id;
      if (!id || seen[id]) return;
      if (onlyEventId && id !== onlyEventId) return;
      if (filterCreatorId && ev.creatorId !== filterCreatorId) return;
      if (!isEnded(ev) || !hasTiers(ev)) return;
      seen[id] = true;
      var r = SatoriCreatorEvents.computeAndQueueWinners(nk, logger, ev, String(id));
      totals.events++;
      totals.ranked += r.ranked;
      totals.queued += r.queued;
      totals.skippedExisting += r.skippedExisting;
      totals.xutWinners += r.xutWinners;
      results.push({ eventId: id, title: ev.title || "", ranked: r.ranked, queued: r.queued, skippedExisting: r.skippedExisting, xutWinners: r.xutWinners });
    }

    // 1. satori_creator_events via events_index
    try {
      var idxRec = nk.storageRead([{ collection: "satori_creator_events", key: "events_index", userId: Constants.SYSTEM_USER_ID }]);
      if (idxRec && idxRec.length > 0 && idxRec[0].value) {
        var ids = ((idxRec[0].value as { eventIds: string[] }).eventIds) || [];
        for (var i = 0; i < ids.length; i++) {
          try {
            var er = nk.storageRead([{ collection: "satori_creator_events", key: ids[i], userId: Constants.SYSTEM_USER_ID }]);
            if (er && er.length > 0 && er[0].value) process(er[0].value);
          } catch (e1: any) { /* skip unreadable */ }
        }
      }
    } catch (e2: any) {
      logger.warn("[backfillPrizes] satori index read failed: %s", e2.message || String(e2));
    }

    // 2. live_events across all owners (creator-portal / SPA events)
    try {
      var cursor = "";
      var pages = 0;
      do {
        var page = nk.storageList(null, "live_events", 100, cursor);
        var objs = (page && page.objects) || [];
        for (var j = 0; j < objs.length; j++) {
          var val: any = objs[j] && objs[j].value;
          if (!val) continue;
          if (!val.id) val.id = objs[j].key;
          process(val);
        }
        cursor = (page && page.cursor) || "";
        pages++;
      } while (cursor && pages < 40);
    } catch (e3: any) {
      logger.warn("[backfillPrizes] live_events list failed: %s", e3.message || String(e3));
    }

    logger.info("[backfillPrizes] events=%d ranked=%d queued=%d skipped=%d xut=%d",
      totals.events, totals.ranked, totals.queued, totals.skippedExisting, totals.xutWinners);
    return RpcHelpers.successResponse({ totals: totals, events: results });
  }

  function rpcAdminMessagesList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    SatoriMessages.processScheduledMessages(nk, logger);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = adminGameId(data);
    var messagesConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "messages", gameId, {});
    var messages: any[] = [];
    var now = Math.floor(Date.now() / 1000);

    for (var id in messagesConfig) {
      var def = messagesConfig[id] || {};
      var scheduleAt = def.schedule_at || def.scheduleAt;
      // Derive a sensible fallback status: only use "scheduled" when there is
      // a future scheduleAt; messages that were stored with status="scheduled"
      // but no scheduleAt (old bug) are treated as draft.
      var derivedStatus = (scheduleAt && scheduleAt > now) ? "scheduled" : "draft";
      // Honour the persisted status (e.g. "sent") but guard against "scheduled"
      // with no actual scheduleAt — that was the "all players, no schedule" bug.
      var persistedStatus = def.status === "delivered" ? "sent" : def.status;
      var finalStatus = (persistedStatus && !(persistedStatus === "scheduled" && !scheduleAt))
        ? persistedStatus
        : derivedStatus;
      messages.push({
        id: def.id || id,
        title: def.title || id,
        body: def.body || "",
        audience_id: def.audience_id || def.audienceId,
        schedule_at: scheduleAt,
        rewards_json: def.rewards_json || (def.reward ? JSON.stringify(def.reward) : undefined),
        status: finalStatus,
        delivered_count: def.deliveredCount,
        sent_at: def.sentAt ? isoFromSec(def.sentAt) : undefined,
        created_at: isoFromSec(def.createdAt),
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ messages: messages, game_id: gameId || Constants.DEFAULT_GAME_ID });
  }

  // ---- Feature Flag Quick Toggle ----

  function rpcFlagToggle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required (flag name to toggle)");

    var gameId = adminGameId(data);
    var flagsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "flags", gameId, { flags: {} }) as Satori.FlagsConfig;
    if (!flagsConfig.flags) flagsConfig.flags = {};

    var existing = flagsConfig.flags[data.name];
    var now = Math.floor(Date.now() / 1000);
    var audiences = firstArray(data.audiences) || firstArray(data.audiences_json);
    var conditionsByAudience = data.conditionsByAudience;
    if (!conditionsByAudience && audiences) {
      conditionsByAudience = {};
      for (var ai = 0; ai < audiences.length; ai++) {
        conditionsByAudience[audiences[ai]] = data.value !== undefined ? String(data.value) : "";
      }
    }

    if (existing) {
      existing.enabled = data.enabled !== undefined ? data.enabled : !existing.enabled;
      if (data.value !== undefined) existing.value = String(data.value);
      if (conditionsByAudience) existing.conditionsByAudience = conditionsByAudience;
      existing.updatedAt = now;
    } else if (data.value !== undefined) {
      flagsConfig.flags[data.name] = {
        name: data.name,
        value: String(data.value),
        description: data.description || "",
        conditionsByAudience: conditionsByAudience,
        enabled: data.enabled !== undefined ? data.enabled : true,
        createdAt: now,
        updatedAt: now
      };
    } else {
      return RpcHelpers.errorResponse("Flag '" + data.name + "' not found. Provide value to create.");
    }

    var key = saveScopedSatoriConfig(nk, "flags", gameId, flagsConfig);
    logAdminAudit(nk, ctx, "satori_flag_toggle", { name: data.name, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { enabled: flagsConfig.flags[data.name].enabled });
    return RpcHelpers.successResponse({ flag: flagsConfig.flags[data.name], action: existing ? "toggled" : "created" });
  }

  // ---- Live Event Quick Schedule ----

  function rpcLiveEventSchedule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name) return RpcHelpers.errorResponse("id and name required");

    var gameId = adminGameId(data);
    var eventsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_events", gameId, {}) as { [id: string]: any };
    var now = Math.floor(Date.now() / 1000);

    var audiences = firstArray(data.audiences) || firstArray(data.audiences_json);
    var reward = data.reward || parseMaybeJson(data.rewards_json, undefined);

    var newEvent: any = {
      id: data.id,
      name: data.name,
      description: data.description || "",
      startAt: data.start_time_sec || data.startTimeSec || data.startAt || now,
      endAt: data.end_time_sec || data.endTimeSec || data.endAt || now + 86400,
      audienceId: (audiences && audiences[0]) || data.audience_id || data.audienceId || undefined,
      reward: reward,
      config: data.config || {},
      recurrenceCron: data.recurrenceCron,
      recurrenceIntervalSec: data.recurrenceIntervalSec,
      sticky: data.sticky || false,
      requiresJoin: data.requiresJoin || false,
      category: data.category || "",
      gameId: gameId || data.gameId || data.game_id || undefined,
      flagOverrides: data.flagOverrides,
      onJoinMessageId: data.onJoinMessageId,
      createdAt: (eventsConfig[data.id] && eventsConfig[data.id].createdAt) || now,
      updatedAt: now
    };

    var action = eventsConfig[data.id] ? "updated" : "created";
    eventsConfig[data.id] = newEvent;
    var key = saveScopedSatoriConfig(nk, "live_events", gameId, eventsConfig);
    logAdminAudit(nk, ctx, "satori_live_event_schedule", { id: data.id, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { action: action });
    return RpcHelpers.successResponse({ event: newEvent, action: action });
  }

  // ---- Experiment Quick Setup ----

  function rpcExperimentSetup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var variants = data.variants || parseMaybeJson(data.variants_json, undefined);
    if (!data.id || !data.name || !variants) return RpcHelpers.errorResponse("id, name, and variants[] required");

    var gameId = adminGameId(data);
    var expConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "experiments", gameId, {}) as { [id: string]: any };
    var now = Math.floor(Date.now() / 1000);
    var audiences = firstArray(data.audiences) || firstArray(data.audiences_json);

    var newExp: any = {
      id: data.id,
      name: data.name,
      description: data.description || "",
      status: data.status || (data.enabled === false ? "draft" : "running"),
      audienceId: (audiences && audiences[0]) || data.audience_id || data.audienceId || undefined,
      variants: variants,
      goalMetric: data.goalMetric,
      splitKey: data.splitKey,
      lockParticipation: data.lockParticipation || false,
      admissionDeadline: data.admissionDeadline,
      startAt: data.startAt,
      endAt: data.endAt,
      phases: data.phases,
      experimentType: data.experimentType || "custom",
      gameId: gameId || data.gameId || data.game_id || undefined,
      createdAt: (expConfig[data.id] && expConfig[data.id].createdAt) || now,
      updatedAt: now
    };

    var action = expConfig[data.id] ? "updated" : "created";
    expConfig[data.id] = newExp;
    var key = saveScopedSatoriConfig(nk, "experiments", gameId, expConfig);
    logAdminAudit(nk, ctx, "satori_experiment_setup", { id: data.id, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { action: action });
    return RpcHelpers.successResponse({ experiment: newExp, action: action });
  }

  // ---- Message Broadcast / Schedule ----

  function rpcAdminMessageBroadcast(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.title) return RpcHelpers.errorResponse("title required");

    var now = Math.floor(Date.now() / 1000);
    var messageId = data.id || ("admin_msg_" + now + "_" + Math.floor(Math.random() * 100000));
    var scheduleAt = data.schedule_at || data.scheduleAt;
    var audienceId = data.audience_id || data.audienceId;
    var reward = data.reward || parseMaybeJson(data.rewards_json, undefined);
    var gameId = adminGameId(data);
    var definitions = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "messages", gameId, {});
    if (definitions && definitions.messages) definitions = definitions.messages;

    var messageDef: any = {
      id: messageId,
      title: data.title,
      body: data.body || "",
      imageUrl: data.image_url || data.imageUrl,
      metadata: data.metadata || {},
      gameId: gameId || data.gameId || data.game_id || undefined,
      reward: reward,
      audienceId: audienceId,
      scheduleAt: scheduleAt,
      expiresAt: data.expires_at || data.expiresAt,
      status: scheduleAt && scheduleAt > now ? "scheduled" : "draft",
      createdAt: (definitions[messageId] && definitions[messageId].createdAt) || now,
      updatedAt: now
    };
    var delivered = 0;
    var sendNow = !scheduleAt || scheduleAt <= now;
    if (sendNow) {
      if (audienceId) {
        delivered = SatoriMessages.deliverToAudience(nk, logger, messageDef, audienceId, gameId);
      } else {
        // "All players (no filter)": deliver to a random sample of up to 100 users,
        // mirroring satori_messages_broadcast. Without this the message was saved
        // as "draft" and never left the config store.
        var allUsers = nk.usersGetRandom(100);
        for (var ui = 0; ui < allUsers.length; ui++) {
          SatoriMessages.deliverMessage(nk, allUsers[ui].userId, messageDef, gameId);
          delivered++;
        }
      }
      messageDef.status = "sent";
      messageDef.deliveredCount = delivered;
      messageDef.sentAt = now;
      messageDef.deliveredAt = now;
    }

    // Persist ONCE, after delivery. A second storageWrite to the same key in
    // the same RPC invocation is rejected by Nakama's version check (observed
    // on prod: "Storage write rejected - version check failed"), which was
    // leaving immediate sends stuck at status=draft.
    definitions[messageId] = messageDef;
    var key = saveScopedSatoriConfig(nk, "messages", gameId, definitions);
    logAdminAudit(nk, ctx, "satori_message_broadcast", { id: messageId, audienceId: audienceId, gameId: gameId || Constants.DEFAULT_GAME_ID, key: key }, { scheduled: !!scheduleAt, delivered: delivered });
    return RpcHelpers.successResponse({ scheduled: !!(scheduleAt && scheduleAt > now), delivered: delivered, messageId: messageId });
  }

  // ---- Game Intelligence ----

  function rpcQuizverseGameIntelligenceReport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.game_id || data.gameId || "quizverse";
    var hours = typeof data.hours === "number" && data.hours > 0 ? Math.min(data.hours, 72) : 24;
    var days = typeof data.days === "number" && data.days > 0 ? Math.min(data.days, 30) : 7;

    var flagsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "flags", gameId, { flags: {} });
    var eventsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "live_events", gameId, {});
    var experimentsConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "experiments", gameId, {});
    var messagesConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "messages", gameId, {});
    var audiencesConfig = readScopedConfig(nk, Constants.SATORI_CONFIGS_COLLECTION, "audiences", gameId, {});
    var challengesConfig = readScopedConfig(nk, Constants.HIRO_CONFIGS_COLLECTION, "challenges", gameId, { challenges: {} });
    var incentivesConfig = readScopedConfig(nk, Constants.HIRO_CONFIGS_COLLECTION, "incentives", gameId, {});

    var analyticsEvents = listSystemStorage(nk, Constants.ANALYTICS_COLLECTION, 1000);
    var analyticsErrors = listSystemStorage(nk, Constants.ANALYTICS_ERRORS_COLLECTION, 500);
    var quizResults = listSystemStorage(nk, "quiz_results", 500);
    var samples = readRpcSamples(nk, hours, 5000);
    var rpc = rpcStats(samples);
    var analyticsDiag = analyticsDiagnostics(analyticsEvents, gameId);

    var flagCount = objectCount(flagsConfig.flags || flagsConfig);
    var liveEventCount = objectCount(eventsConfig);
    var experimentCount = objectCount(experimentsConfig);
    var messageCount = objectCount(messagesConfig);
    var audienceCount = objectCount(audiencesConfig);
    var challengeCount = objectCount(challengesConfig.challenges || challengesConfig);
    var hasIncentives = objectCount(incentivesConfig) > 0;

    var topWins: string[] = [];
    var topProblems: string[] = [];
    var risks: string[] = [];
    var actions: any[] = [];

    if (flagCount > 0) topWins.push("Feature flag configuration is available for controlled rollouts.");
    if (liveEventCount > 0) topWins.push("Live event configuration is available for scheduled campaigns.");
    if (experimentCount > 0) topWins.push("Experiment configuration is available for A/B testing.");
    if (challengeCount > 0) topWins.push("Hiro challenge configuration is available for task/reward loops.");
    if (hasIncentives) topWins.push("Hiro incentive configuration is available for referrals and return bonuses.");
    if (rpc.successRate >= 0.98 && rpc.total > 0) topWins.push("Runtime RPC health is strong in the selected window.");

    if (flagCount === 0) {
      topProblems.push("No Satori flags are configured; rollout control is limited.");
      pushAction(actions, "high", "low", "liveops", "Create at least one game-scoped feature flag.", "Satori flags config is empty.");
    }
    if (liveEventCount === 0) {
      topProblems.push("No live events are configured; there is no scheduled engagement surface.");
      pushAction(actions, "high", "medium", "liveops", "Create a game-scoped live event tied to a weak topic or retention moment.", "Satori live events config is empty.");
    }
    if (experimentCount === 0) {
      topProblems.push("No experiments are configured; onboarding and monetization changes cannot be measured as A/B tests.");
      pushAction(actions, "medium", "medium", "product", "Add one experiment for onboarding, reward cadence, or quiz difficulty.", "Satori experiments config is empty.");
    }
    if (challengeCount === 0) {
      topProblems.push("No Hiro challenges are configured; challenge-based retention loops are unavailable.");
      pushAction(actions, "high", "low", "liveops", "Seed a game-scoped challenge config and verify it through hiro_challenges_list.", "Hiro challenges config is empty.");
    }
    if (!hasIncentives) {
      topProblems.push("No Hiro incentives are configured; referral and return-bonus loops are unavailable.");
      pushAction(actions, "medium", "low", "liveops", "Seed return-bonus and referral incentive config.", "Hiro incentives config is empty.");
    }
    if (rpc.failed > 0) {
      topProblems.push("Runtime RPC errors were observed in the selected window.");
      risks.push("RPC failures may affect analytics, LiveOps, or game feature availability.");
      pushAction(actions, "high", "medium", "backend", "Review top erroring RPCs and fix the highest-volume failure first.", String(rpc.failed) + " failed RPC samples found.");
    }
    if (rpc.p90Ms > 1000) {
      topProblems.push("Runtime RPC p90 latency is above 1s.");
      risks.push("Slow RPCs can affect dashboard and client UX.");
      pushAction(actions, "medium", "medium", "backend", "Profile top slow RPCs and cache expensive config reads.", "p90 latency is " + rpc.p90Ms + "ms.");
    }
    if (analyticsEvents.length === 0) {
      risks.push("No system-owned analytics events were found in the sampled storage page; confirm events are stored under expected owners/collections.");
    }
    if (analyticsEvents.length > 0 && analyticsDiag.matching_expected_game_id === 0) {
      risks.push("Analytics events exist, but none match the selected game ID in the sampled page.");
      pushAction(actions, "high", "low", "analytics", "Verify the dashboard game selector and Unity runtime gameId alias.", "Observed source game IDs: " + JSON.stringify(analyticsDiag.source_game_ids));
    }
    if (analyticsDiag.status === "stale" || analyticsDiag.status === "old") {
      risks.push("Analytics data is not fresh for the sampled storage page.");
      pushAction(actions, "medium", "low", "analytics", "Check Unity analytics emitter, game ID, and Nakama analytics storage writes.", "Last event at " + analyticsDiag.last_event_at + " for " + analyticsDiag.last_event_game_id + ".");
    }

    actions.sort(function (a, b) { return b.priority - a.priority; });

    var healthScore = 100;
    healthScore -= Math.min(35, rpc.failed * 5);
    healthScore -= flagCount === 0 ? 10 : 0;
    healthScore -= liveEventCount === 0 ? 10 : 0;
    healthScore -= experimentCount === 0 ? 8 : 0;
    healthScore -= challengeCount === 0 ? 10 : 0;
    healthScore -= hasIncentives ? 0 : 7;
    healthScore -= rpc.p90Ms > 1000 ? 10 : 0;
    if (healthScore < 0) healthScore = 0;

    return RpcHelpers.successResponse({
      game_id: gameId,
      generated_at: new Date().toISOString(),
      windows: { rpc_hours: hours, gameplay_days: days },
      executive_summary: {
        health_score: healthScore,
        status: healthScore < 40 ? "critical" : healthScore < 70 ? "warning" : "healthy",
        headline: topProblems.length > 0 ? topProblems[0] : (topWins[0] || "No urgent issues detected from configured sources.")
      },
      top_wins: topWins.slice(0, 10),
      top_problems: topProblems.slice(0, 10),
      segment_insights: [
        audienceCount > 0
          ? "Audience config exists; segment-level LiveOps can be targeted from Satori."
          : "Audience config is empty; segment-level insights are limited until audiences are configured.",
        quizResults.length > 0
          ? "Quiz result storage has sampled data for weak-topic analysis."
          : "Quiz result storage sample is empty; verify quiz result writes for exam-prep insights."
      ],
      liveops_impact: {
        flags_configured: flagCount,
        live_events_configured: liveEventCount,
        experiments_configured: experimentCount,
        messages_configured: messageCount,
        audiences_configured: audienceCount,
        challenges_configured: challengeCount,
        incentives_configured: hasIncentives
      },
      action_list: actions.slice(0, 10),
      key_metrics: {
        rpc: {
          calls: rpc.total,
          failed: rpc.failed,
          success_rate: rpc.successRate,
          avg_ms: rpc.avgMs,
          p90_ms: rpc.p90Ms
        },
        storage_samples: {
          analytics_events: analyticsEvents.length,
          analytics_errors: analyticsErrors.length,
          quiz_results: quizResults.length
        }
      },
      analytics_diagnostics: analyticsDiag,
      risks: risks,
      evidence: {
        top_slow: rpc.topSlow,
        top_errors: rpc.topErrors,
        liveops: {
          flags: flagsConfig,
          live_events: eventsConfig,
          experiments: experimentsConfig,
          messages: messagesConfig,
          audiences: audiencesConfig,
          hiro_challenges: challengesConfig,
          hiro_incentives: incentivesConfig
        }
      }
    });
  }

  // ---- User Search ----

  function rpcUserSearch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.username) return RpcHelpers.errorResponse("username required");

    try {
      var users = nk.usersGetUsername([data.username]);
      if (!users || users.length === 0) return RpcHelpers.successResponse({ found: false });

      var results: any[] = [];
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
    } catch (e: any) {
      return RpcHelpers.errorResponse("Search failed: " + (e.message || String(e)));
    }
  }

  // ---- Player Inventory Grant (admin shortcut) ----

  function rpcInventoryGrant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.itemId) return RpcHelpers.errorResponse("userId and itemId required. Optional: quantity (default 1)");

    var gameId = adminGameId(data);
    var qty = data.quantity || 1;
    var stringProps = data.stringProperties || data.string_properties || data.properties || {};
    var numericProps = data.numericProperties || data.numeric_properties || {};
    var item = HiroInventory.grantItem(nk, logger, ctx, data.userId, data.itemId, qty, stringProps, numericProps, gameId || undefined);
    logAdminAudit(nk, ctx, "admin_inventory_grant", { userId: data.userId, itemId: data.itemId, gameId: gameId || Constants.DEFAULT_GAME_ID }, { quantity: qty });
    return RpcHelpers.successResponse({ userId: data.userId, item: item });
  }

  // ---- Send Admin Mailbox Message ----

  function rpcMailboxSend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.subject) return RpcHelpers.errorResponse("userId and subject required. Optional: body, rewards, expiresInSec");

    var gameId = adminGameId(data);
    var inboxKey = Constants.gameKey(gameId, "inbox");
    var inbox = Storage.readJson<any>(nk, Constants.HIRO_MAILBOX_COLLECTION, inboxKey, data.userId) || { messages: [] };
    var messages = inbox.messages || [];

    var now = Math.floor(Date.now() / 1000);
    var msg: any = {
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
    Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, inboxKey, data.userId, inbox);
    logAdminAudit(nk, ctx, "admin_mailbox_send", { userId: data.userId, messageId: msg.id, gameId: gameId || Constants.DEFAULT_GAME_ID });
    return RpcHelpers.successResponse({ sent: true, messageId: msg.id, to: data.userId });
  }

  // ---- Satori Events Timeline (recent events for a user) ----

  function rpcEventsTimeline(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    // 2026-04 backward-compat: legacy clients (and the old "satori_events_timeline"
    // RPC name) sent the target user as `user_id` (snake_case). New admin UI sends
    // `userId` (camelCase). Accept either so we don't break older builds while we
    // roll out the rename.
    var userId = data.userId || data.user_id;
    if (!userId) return RpcHelpers.errorResponse("userId required");

    var events = Storage.readJson<any>(nk, Constants.SATORI_EVENTS_COLLECTION, "history", userId) || { events: [] };
    var list = events.events || [];
    var limit = data.limit || 50;
    var recent = list.slice(Math.max(0, list.length - limit));

    return RpcHelpers.successResponse({
      userId: userId,
      count: recent.length,
      totalEvents: list.length,
      events: recent
    });
  }

  // ---- System Health ----

  function rpcHealthCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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

  export function register(initializer: nkruntime.Initializer): void {
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
    initializer.registerRpc("admin_accounts_list", rpcAccountsList);
    initializer.registerRpc("admin_account_get", rpcAccountGet);
    initializer.registerRpc("admin_account_ban", rpcAccountBan);
    initializer.registerRpc("admin_account_unban", rpcAccountUnban);
    initializer.registerRpc("admin_account_delete", rpcAccountDelete);
    initializer.registerRpc("admin_matches_list", rpcMatchesList);
    initializer.registerRpc("admin_tournaments_list", rpcTournamentsList);
    initializer.registerRpc("admin_tournament_create", rpcTournamentCreate);
    initializer.registerRpc("admin_tournament_records_list", rpcTournamentRecordsList);
    initializer.registerRpc("admin_tournament_records_around_owner", rpcTournamentRecordsAroundOwner);
    initializer.registerRpc("admin_tournament_record_write", rpcTournamentRecordWrite);
    initializer.registerRpc("admin_player_inspect", rpcPlayerInspect);
    initializer.registerRpc("admin_user_search", rpcUserSearch);
    initializer.registerRpc("admin_wallet_view", rpcWalletView);
    initializer.registerRpc("admin_wallet_grant", rpcWalletGrant);
    initializer.registerRpc("admin_wallet_reset", rpcWalletReset);
    initializer.registerRpc("admin_inventory_grant", rpcInventoryGrant);
    initializer.registerRpc("admin_mailbox_send", rpcMailboxSend);

    // Satori quick-ops
    initializer.registerRpc("admin_satori_audiences_list", rpcAdminAudiencesList);
    initializer.registerRpc("admin_satori_flags_list", rpcAdminFlagsList);
    initializer.registerRpc("admin_satori_experiments_list", rpcAdminExperimentsList);
    initializer.registerRpc("admin_satori_messages_list", rpcAdminMessagesList);
    initializer.registerRpc("admin_satori_live_events_list", rpcAdminLiveEventsList);
    initializer.registerRpc("admin_flag_toggle", rpcFlagToggle);
    initializer.registerRpc("admin_live_event_schedule", rpcLiveEventSchedule);
    // Creator portal live event publish (stores under system user for admin visibility)
    initializer.registerRpc("creator_live_event_publish", rpcCreatorLiveEventPublish);
    // Creator event admin operations
    initializer.registerRpc("admin_creator_event_get", rpcAdminCreatorEventGet);
    initializer.registerRpc("admin_creator_event_stats", rpcAdminCreatorEventStats);
    initializer.registerRpc("admin_creator_event_end", rpcAdminCreatorEventEnd);
    initializer.registerRpc("admin_creator_events_list", rpcAdminCreatorEventsList);
    initializer.registerRpc("admin_creator_events_backfill_prizes", rpcAdminCreatorEventsBackfillPrizes);
    // Live-event prize fulfillment (admin console)
    initializer.registerRpc("admin_prize_fulfillments_list", rpcAdminPrizeFulfillmentsList);
    initializer.registerRpc("admin_prize_fulfillment_settle", rpcAdminPrizeFulfillmentSettle);
    initializer.registerRpc("admin_prize_backfill_emails", rpcAdminPrizeBackfillEmails);
    initializer.registerRpc("admin_experiment_setup", rpcExperimentSetup);
    initializer.registerRpc("admin_satori_message_broadcast", rpcAdminMessageBroadcast);
    initializer.registerRpc("quizverse_game_intelligence_report", rpcQuizverseGameIntelligenceReport);
    initializer.registerRpc("admin_events_timeline", rpcEventsTimeline);

    // 2026-04 backward-compat aliases: the admin UI / shared SDK call these
    // RPC IDs directly (without the "admin_" prefix). Register the legacy
    // names as aliases pointing at the same handlers so existing clients keep
    // working without requiring a coordinated client rollout.
    initializer.registerRpc("satori_events_timeline", rpcEventsTimeline);
    initializer.registerRpc("satori_config_get", rpcSatoriConfigGet);
    initializer.registerRpc("satori_config_set", rpcSatoriConfigSet);
    initializer.registerRpc("satori_flags_toggle", rpcFlagToggle);
    initializer.registerRpc("satori_live_event_schedule", rpcLiveEventSchedule);
    initializer.registerRpc("satori_experiment_setup", rpcExperimentSetup);
    // NOTE: satori_message_broadcast (singular) is aliased in
    // data/modules/src/satori/messages/messages.ts → rpcBroadcast, since that
    // handler has the correct audience-broadcast semantics. Do NOT alias it
    // to rpcMailboxSend here (rpcMailboxSend writes to a single user's inbox).

    // Storage browser
    initializer.registerRpc("admin_storage_list", rpcStorageList);
    initializer.registerRpc("admin_storage_write", rpcStorageWrite);

    // Gift claims
    initializer.registerRpc("gift_claims_list", rpcGiftClaimsList);
    initializer.registerRpc("admin_gift_claim_update", rpcGiftClaimUpdate);

    // Health
    initializer.registerRpc("admin_health_check", rpcHealthCheck);

    // ============================================================================
    // 2026-04-24 Client/Server RPC naming-mismatch aliases
    // ----------------------------------------------------------------------------
    // The QuizVerse Unity client + Intelli-verse-X SDK call a number of RPC IDs
    // whose names diverged from the canonical server-side handler names over time
    // (verb-position swaps, singular/plural drift, "_get/_config" naming, etc.).
    // We register lightweight delegating aliases here so the client doesn't need
    // a coordinated rollout. Aliases delegate to the canonical handler at
    // runtime via `globalThis.__rpc_<id>` (which postbuild.js produces for every
    // registered RPC). For client RPCs that have no server equivalent yet, we
    // expose safe-default soft-stubs to unblock the SDK without throwing.
    // See Docs/analytics/ANALYTICS-AUDIT-2026-04-22.md §16 for full mapping.
    // ============================================================================
    var g: any = globalThis as any;
    function delegate(targetVar: string): nkruntime.RpcFunction {
      return function (ctx, logger, nk, payload) {
        var fn = g[targetVar];
        if (typeof fn !== "function") {
          return JSON.stringify({ success: false, error: "alias target unavailable: " + targetVar });
        }
        return fn(ctx, logger, nk, payload);
      };
    }
    function softStub(payload: any): nkruntime.RpcFunction {
      return function (_ctx, _logger, _nk, _p) {
        return JSON.stringify(payload);
      };
    }

    // ---- Daily missions (client uses daily_missions_*; server uses *_mission_reward / get_daily_missions) ----
    initializer.registerRpc("daily_missions_get",             delegate("__rpc_get_daily_missions"));
    initializer.registerRpc("daily_missions_claim",           delegate("__rpc_claim_mission_reward"));
    initializer.registerRpc("daily_missions_update_progress", softStub({ success: true, updated: false, note: "progress is auto-tracked server-side" }));

    // ---- Daily rewards ----
    initializer.registerRpc("daily_rewards_get_state",    delegate("__rpc_daily_rewards_get_status"));
    initializer.registerRpc("daily_rewards_get_calendar", delegate("__rpc_daily_rewards_get_status"));

    // ---- Fortune wheel ----
    initializer.registerRpc("fortune_wheel_get_config", delegate("__rpc_fortune_wheel_get_state"));

    // ---- Hiro Ad-revenue (no server impl yet — soft-stub) ----
    initializer.registerRpc("hiro_ad_revenue_get_config",        softStub({ enabled: false, config: {} }));
    initializer.registerRpc("hiro_ad_revenue_record_impression", softStub({ success: true }));

    // ---- Hiro Appointment system (no server impl yet) ----
    initializer.registerRpc("hiro_appointment_get",   softStub({ appointments: [] }));
    initializer.registerRpc("hiro_appointment_claim", softStub({ success: false, error: "appointment system not configured" }));

    // ---- Hiro Daily content (no server impl yet) ----
    initializer.registerRpc("hiro_daily_content_get",   softStub({ content: [] }));
    initializer.registerRpc("hiro_daily_content_claim", softStub({ success: false, error: "daily content system not configured" }));

    // ---- Hiro Friend battles (singular client → plural server) ----
    initializer.registerRpc("hiro_friend_battle_get",    delegate("__rpc_hiro_friend_battles_get_active"));
    initializer.registerRpc("hiro_friend_battle_send",   delegate("__rpc_hiro_friend_battles_challenge"));
    initializer.registerRpc("hiro_friend_battle_accept", softStub({ success: true, accepted: true }));
    initializer.registerRpc("hiro_friend_battle_submit", softStub({ success: true, submitted: true }));

    // ---- Hiro Friend quests (singular client → plural server) ----
    initializer.registerRpc("hiro_friend_quest_get",      delegate("__rpc_hiro_friend_quests_get_active"));
    initializer.registerRpc("hiro_friend_quest_progress", delegate("__rpc_hiro_friend_quests_contribute"));
    initializer.registerRpc("hiro_friend_quest_accept",   softStub({ success: true, accepted: true }));

    // ---- Hiro Friend streak (different verb names) ----
    initializer.registerRpc("hiro_friend_streak_get",             delegate("__rpc_friend_streak_get_state"));
    initializer.registerRpc("hiro_friend_streak_interact",        delegate("__rpc_friend_streak_record_contribution"));
    initializer.registerRpc("hiro_friend_streak_claim_milestone", delegate("__rpc_friend_streak_milestone_reward"));

    // ---- Hiro IAP triggers ----
    // evaluate: delegates to the Hiro trigger-check RPC.
    // dismiss:  records user dismissal in storage so the same trigger isn't re-shown
    //           on the next session (prevents popup spam).
    // convert:  client handles the real purchase via hiro_iap_validate; this endpoint
    //           records the conversion event for analytics.
    initializer.registerRpc("hiro_iap_trigger_evaluate", delegate("__rpc_hiro_iap_trigger_check"));

    initializer.registerRpc("hiro_iap_trigger_dismiss", function(ctx, logger, nk, payload) {
      try {
        var userId = ctx.userId;
        if (!userId) return JSON.stringify({ success: false, error: "unauthenticated" });
        var data: any = {};
        try { data = JSON.parse(payload || "{}"); } catch (_) {}
        var triggerId: string = (data && data.triggerId) ? String(data.triggerId) : "unknown";
        var DISMISS_COLLECTION = "hiro_iap_trigger_dismissals";
        var existing: any = {};
        try {
          var raw = nk.storageRead([{ collection: DISMISS_COLLECTION, key: "dismissed", userId: userId }]);
          if (raw && raw.length > 0) existing = raw[0].value || {};
        } catch (_) {}
        existing[triggerId] = { dismissedAt: new Date().toISOString() };
        nk.storageWrite([{
          collection: DISMISS_COLLECTION, key: "dismissed", userId: userId,
          value: existing,
          permissionRead: 1, permissionWrite: 0
        }]);
        logger.info("[IAPTrigger] dismiss: user=" + userId + " triggerId=" + triggerId);
        return JSON.stringify({ success: true, dismissed: true, triggerId: triggerId });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e && e.message ? e.message : String(e) });
      }
    });

    initializer.registerRpc("hiro_iap_trigger_convert", function(ctx, logger, nk, payload) {
      try {
        var userId = ctx.userId;
        if (!userId) return JSON.stringify({ success: false, error: "unauthenticated" });
        var data: any = {};
        try { data = JSON.parse(payload || "{}"); } catch (_) {}
        var triggerId: string = (data && data.triggerId) ? String(data.triggerId) : "unknown";
        var productId: string = (data && data.productId) ? String(data.productId) : "";
        // Record conversion event for analytics; actual purchase is done by the
        // client via hiro_iap_validate after the Unity IAP dialog completes.
        logger.info("[IAPTrigger] convert: user=" + userId + " triggerId=" + triggerId + " productId=" + productId);
        return JSON.stringify({ success: true, converted: true, triggerId: triggerId,
          note: "Purchase initiated client-side via hiro_iap_validate" });
      } catch (e: any) {
        return JSON.stringify({ success: false, error: e && e.message ? e.message : String(e) });
      }
    });

    // ---- Hiro Offerwall (verb naming drift) ----
    initializer.registerRpc("hiro_offerwall_get",      delegate("__rpc_hiro_offerwall_list"));
    initializer.registerRpc("hiro_offerwall_complete", delegate("__rpc_hiro_offerwall_claim"));

    // ---- Hiro Retention / Onboarding bridge (client uses hiro_retention_*; server uses retention_* / onboarding_*) ----
    initializer.registerRpc("hiro_retention_claim_comeback",      delegate("__rpc_retention_claim_welcome_bonus"));
    initializer.registerRpc("hiro_retention_complete_onboarding", delegate("__rpc_onboarding_complete"));
    initializer.registerRpc("hiro_retention_heartbeat",           delegate("__rpc_onboarding_track_session"));

    // ---- Hiro Session boosters (no server impl yet) ----
    initializer.registerRpc("hiro_session_booster_get",        softStub({ boosters: [], activeBooster: null }));
    initializer.registerRpc("hiro_session_booster_activate",   softStub({ success: false, error: "session booster system not enabled" }));
    initializer.registerRpc("hiro_session_booster_claim_free", softStub({ success: false, error: "session booster system not enabled" }));

    // ---- Hiro Smart-ad timer (one alias + two soft-stubs) ----
    initializer.registerRpc("hiro_smart_ad_timer_can_show", delegate("__rpc_hiro_smart_ad_can_show"));
    initializer.registerRpc("hiro_smart_ad_timer_get",      softStub({ nextShowAt: 0, canShow: true, cooldownSec: 0 }));
    initializer.registerRpc("hiro_smart_ad_timer_record",   softStub({ success: true, recorded: true }));

    // ---- Hiro Social pressure ----
    initializer.registerRpc("hiro_social_pressure_get", delegate("__rpc_social_pressure_get_today_summary"));

    // ---- Hiro Spin wheel (suffix drift) ----
    // NOTE: We intentionally bypass __rpc_hiro_spin_wheel{,_config} (set in
    // sdk_aliases.js → __ModuleInit_73) because postbuild.js replays those
    // guarded ` || ` assignments at global scope BEFORE the legacy module
    // assigns __rpc_fortune_wheel_{spin,get_state}, leaving the intermediate
    // vars cemented to `undefined`. Delegate straight to the canonical
    // legacy stubs which ARE defined by the time the alias is invoked.
    initializer.registerRpc("hiro_spin_wheel_get",  delegate("__rpc_fortune_wheel_get_state"));
    initializer.registerRpc("hiro_spin_wheel_spin", delegate("__rpc_fortune_wheel_spin"));

    // ---- Hiro Streak shield (client uses hiro_streak_shield_*; server uses retention_*_streak_shield) ----
    initializer.registerRpc("hiro_streak_shield_get",        delegate("__rpc_retention_get_streak_shield"));
    initializer.registerRpc("hiro_streak_shield_activate",   delegate("__rpc_retention_use_streak_shield"));
    initializer.registerRpc("hiro_streak_shield_replenish",  delegate("__rpc_retention_grant_streak_shield"));
  }

  // ────────────────────────────────────────────────────────────────────
  //  Live-event prize fulfillment (admin console)
  //
  //  Gift-card wins are queued into the system-owned `prize_fulfillments`
  //  collection (status "pending") by the creator-event claim RPCs. The
  //  existing creator_event_fulfillments_list / _settle RPCs are gated by a
  //  service token (NAKAMA_WEBHOOK_SECRET) for the Next.js admin / n8n. These
  //  two RPCs expose the SAME queue + settle flow to the IVX admin console via
  //  the normal requireAdmin gate, so no secret has to ship to the browser.
  // ────────────────────────────────────────────────────────────────────

  function rpcAdminPrizeFulfillmentsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var statusFilter = typeof data.status === "string" ? String(data.status) : "";
    var eventIdFilter = data.eventId || data.event_id || "";
    if (eventIdFilter) eventIdFilter = String(eventIdFilter);
    var limit = Math.min(200, Math.max(1, Number(data.limit) || 100));
    var offset = Math.max(0, Number(data.offset) || 0);
    var storageCursor = (typeof data.cursor === "string" && data.cursor) ? String(data.cursor) : "";

    function prizeFulfillmentStorageCreateTimeSec(storageObj: any): number {
      if (!storageObj) return 0;
      var ct = Number(storageObj.createTime || 0);
      return ct > 0 ? ct : 0;
    }

    function mapFulfillmentRow(key: string, v: any, storageObj?: any): any {
      var createTime = prizeFulfillmentStorageCreateTimeSec(storageObj);
      var queuedAt = v.queuedAt || v.claimedAt || 0;
      var sortAt = createTime || queuedAt;
      return {
        key: key,
        userId: v.userId || "",
        eventId: v.eventId || "",
        eventTitle: v.eventTitle || "",
        rank: v.rank || 0,
        giftCard: v.giftCard || null,
        status: v.status || "pending",
        region: v.region || "",
        email: v.email || "",
        source: v.source || "",
        queuedAt: queuedAt,
        createTime: createTime,
        sortAt: sortAt,
        emailPatchedAt: v.emailPatchedAt || 0,
        settledAt: v.settledAt || 0,
        voucher: v.voucher || null,
        error: v.error || "",
      };
    }

    function rowMatchesFilters(v: any): boolean {
      if (statusFilter && v.status !== statusFilter) return false;
      if (eventIdFilter && String(v.eventId || "") !== eventIdFilter) return false;
      return true;
    }

    // Default admin view: scan the full queue (capped), sort newest-first.
    // storageList returns keys alphabetically — a single page hides events whose
    // keys sort after the first ~200 rows (e.g. fc64c27e-…).
    if (!storageCursor) {
      var allRows: any[] = [];
      var scanCursor: string | undefined = undefined;
      var pages = 0;
      var maxPages = 50;
      do {
        var page = nk.storageList(Constants.SYSTEM_USER_ID, "prize_fulfillments", 100, scanCursor);
        var pageObjs = (page && page.objects) || [];
        for (var pi = 0; pi < pageObjs.length; pi++) {
          var pv: any = pageObjs[pi].value || {};
          if (!rowMatchesFilters(pv)) continue;
          allRows.push(mapFulfillmentRow(pageObjs[pi].key, pv, pageObjs[pi]));
        }
        scanCursor = (page && page.cursor) ? String(page.cursor) : "";
        pages++;
      } while (scanCursor && pages < maxPages);

      allRows.sort(function (a: any, b: any) {
        return (b.sortAt || 0) - (a.sortAt || 0);
      });

      var total = allRows.length;
      var pageRows = allRows.slice(offset, offset + limit);
      var nextOffset = offset + pageRows.length;
      return RpcHelpers.successResponse({
        fulfillments: pageRows,
        total: total,
        cursor: nextOffset < total ? String(nextOffset) : "",
      });
    }

    // Legacy storage cursor passthrough (offset cursors handled above).
    var res = nk.storageList(Constants.SYSTEM_USER_ID, "prize_fulfillments", limit, storageCursor);
    var rows: any[] = [];
    var objs = (res && res.objects) || [];
    for (var i = 0; i < objs.length; i++) {
      var v: any = objs[i].value || {};
      if (!rowMatchesFilters(v)) continue;
      rows.push(mapFulfillmentRow(objs[i].key, v, objs[i]));
    }
    return RpcHelpers.successResponse({
      fulfillments: rows,
      cursor: (res && res.cursor) || "",
    });
  }

  function rpcAdminPrizeFulfillmentSettle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var eventId = data.eventId || data.event_id;
    var targetUserId = data.userId || data.user_id;
    if (!eventId || !targetUserId) {
      return RpcHelpers.errorResponse("eventId and userId required");
    }
    var status = data.status === "fulfilled" ? "fulfilled" : (data.status === "failed" ? "failed" : "");
    if (!status) {
      return RpcHelpers.errorResponse("status must be 'fulfilled' or 'failed'");
    }
    eventId = String(eventId);
    targetUserId = String(targetUserId);
    var fKey = eventId + ":" + targetUserId;

    var recs = nk.storageRead([{ collection: "prize_fulfillments", key: fKey, userId: Constants.SYSTEM_USER_ID }]);
    if (!recs || recs.length === 0 || !recs[0].value) {
      return RpcHelpers.errorResponse("Fulfillment record not found: " + fKey);
    }
    var rec: any = recs[0].value;

    var settledAt = Math.floor(Date.now() / 1000);
    rec.status = status;
    rec.settledAt = settledAt;
    rec.settledBy = "admin_console";
    if (status === "fulfilled") {
      // Never store the full card code server-side — it is delivered by email.
      rec.voucher = {
        provider: String(data.provider || "reloadly"),
        orderId: String(data.orderId || ""),
        deliveredTo: String(data.deliveredTo || rec.email || ""),
        cardLast4: String(data.cardLast4 || ""),
        codeDelivered: !!data.codeDelivered,
      };
      rec.error = "";
    } else {
      rec.error = String(data.error || "fulfillment failed");
    }
    nk.storageWrite([{
      collection: "prize_fulfillments",
      key: fKey,
      userId: Constants.SYSTEM_USER_ID,
      value: rec,
      permissionRead: 2,
      permissionWrite: 0,
    }]);

    // Mirror onto the player's claim record so the SPA "My Prizes" card can
    // show "Voucher sent" without another server round-trip.
    try {
      var claimKey = "claim_" + eventId;
      var claimRecs = nk.storageRead([{ collection: "creator_event_claims", key: claimKey, userId: targetUserId }]);
      if (claimRecs && claimRecs.length > 0 && claimRecs[0].value) {
        var claim: any = claimRecs[0].value;
        claim.voucher = {
          status: status,
          provider: (rec.voucher && rec.voucher.provider) || "reloadly",
          deliveredTo: (rec.voucher && rec.voucher.deliveredTo) || "",
          settledAt: settledAt,
        };
        nk.storageWrite([{
          collection: "creator_event_claims",
          key: claimKey,
          userId: targetUserId,
          value: claim,
          permissionRead: 1,
          permissionWrite: 1,
        }]);
      }
    } catch (merr: any) {
      logger.warn("[admin_prize_fulfillment_settle] Failed to mirror voucher onto claim record: %s", merr.message || String(merr));
    }

    logAdminAudit(nk, ctx, "admin_prize_fulfillment_settle", { eventId: eventId, userId: targetUserId }, { status: status, orderId: (rec.voucher && rec.voucher.orderId) || "" });
    logger.info("[admin_prize_fulfillment_settle] %s settled key=%s status=%s", ctx.userId || "admin", fKey, status);

    return RpcHelpers.successResponse({ success: true, key: fKey, status: status, settledAt: settledAt });
  }

  /**
   * Scans all pending prize_fulfillments records with an empty email field
   * and attempts to populate them from the winner's Nakama account (works for
   * email+password registrations; social-login users will remain empty and
   * require admin to enter the email manually in the Approve panel).
   */
  function rpcAdminPrizeBackfillEmails(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var patched = 0;
    var skippedNoAccount = 0;
    var cursor: string | undefined = undefined;
    var pages = 0;
    do {
      var res = nk.storageList(Constants.SYSTEM_USER_ID, "prize_fulfillments", 100, cursor);
      var objs = (res && res.objects) || [];
      cursor = (res && res.cursor) ? res.cursor : undefined;

      // Batch all userIds in this page that have empty email and are pending
      var needEmail: Array<{ key: string; userId: string; value: any }> = [];
      for (var i = 0; i < objs.length; i++) {
        var v: any = objs[i].value || {};
        if (!v.email && v.status === "pending" && v.userId) {
          needEmail.push({ key: objs[i].key, userId: v.userId, value: v });
        }
      }

      if (needEmail.length === 0) { pages++; continue; }

      // Batch-fetch accounts
      var uids = needEmail.map(function(n) { return n.userId; });
      var emailMap: { [uid: string]: string } = {};
      try {
        var accounts = nk.accountsGetId(uids);
        for (var ai = 0; ai < accounts.length; ai++) {
          var acct = accounts[ai];
          var uid = acct && acct.user && (acct.user as any).id;
          var email = (acct && acct.email) || "";
          if (uid && email) emailMap[uid] = email;
        }
      } catch (lookupErr: any) {
        logger.warn("[admin_prize_backfill_emails] batch account lookup failed: %s", lookupErr.message || String(lookupErr));
      }

      // Write back records where we found an email
      for (var ni = 0; ni < needEmail.length; ni++) {
        var entry = needEmail[ni];
        var foundEmail = emailMap[entry.userId] || "";
        if (!foundEmail) { skippedNoAccount++; continue; }
        var updated = Object.assign({}, entry.value, {
          email: foundEmail,
          emailPatchedAt: Math.floor(Date.now() / 1000),
        });
        try {
          Storage.writeSystemJson(nk, "prize_fulfillments", entry.key, updated);
          patched++;
        } catch (writeErr: any) {
          logger.warn("[admin_prize_backfill_emails] write failed for %s: %s", entry.key, writeErr.message || String(writeErr));
        }
      }
      pages++;
    } while (cursor && pages < 20);

    logger.info("[admin_prize_backfill_emails] patched=%d skipped_no_account=%d", patched, skippedNoAccount);
    return RpcHelpers.successResponse({ patched: patched, skippedNoAccount: skippedNoAccount });
  }

  function rpcGiftClaimsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var claims = RewardEngine.getGiftClaims(nk, userId);
    return RpcHelpers.successResponse({ claims: claims });
  }

  function rpcGiftClaimUpdate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.claimId || !data.status) {
      return RpcHelpers.errorResponse("userId, claimId, and status required");
    }
    var updated = RewardEngine.updateGiftClaimStatus(nk, data.userId, data.claimId, data.status);
    if (!updated) return RpcHelpers.errorResponse("Claim not found");
    logAdminAudit(nk, ctx, "admin_gift_claim_update", { userId: data.userId, claimId: data.claimId }, { status: data.status });
    return RpcHelpers.successResponse({ updated: true });
  }
}
