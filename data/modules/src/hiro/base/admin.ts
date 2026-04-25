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
      if (gameId === expectedGameId) expectedCount++;

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
        metrics: {
          quiz_completion_rate: { name: "Quiz Completion Rate", type: "ratio", goal: "increase" },
          weak_topic_accuracy_lift: { name: "Weak Topic Accuracy Lift", type: "percentage", goal: "increase" },
          streak_rescue_return_rate: { name: "Streak Rescue Return Rate", type: "ratio", goal: "increase" }
        },
        alerts: {
          analytics_freshness: { metric: "last_event_age_minutes", operator: "lt", threshold: 60 }
        }
      };
    }
    return undefined;
  }

  // ---- Hiro Config CRUD ----

  function rpcConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");

    var config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
    if (!config || objectCount(config) === 0) {
      var hiroDefault = defaultHiroConfig(data.system);
      if (hiroDefault !== undefined) {
        ConfigLoader.saveConfig(nk, data.system, hiroDefault);
        config = hiroDefault;
      }
    }
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = configFromPayload(data);
    if (!data.system || config === undefined) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveConfig(nk, data.system, config);
    logAdminAudit(nk, ctx, "hiro_config_set", { system: data.system }, { source: "admin_console" });
    return RpcHelpers.successResponse({ system: data.system, saved: true });
  }

  function rpcConfigDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required");

    Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system, Constants.SYSTEM_USER_ID);
    ConfigLoader.invalidateCache(data.system);
    logAdminAudit(nk, ctx, "hiro_config_delete", { system: data.system });
    return RpcHelpers.successResponse({ system: data.system, deleted: true });
  }

  // ---- Satori Config CRUD ----

  function rpcSatoriConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");

    var config = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
    if (!config || objectCount(config) === 0) {
      var satoriDefault = defaultSatoriConfig(data.system);
      if (satoriDefault !== undefined) {
        ConfigLoader.saveSatoriConfig(nk, data.system, satoriDefault);
        config = satoriDefault;
      }
    }
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcSatoriConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var config = configFromPayload(data);
    if (!data.system || config === undefined) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveSatoriConfig(nk, data.system, config);
    logAdminAudit(nk, ctx, "satori_config_set", { system: data.system }, { source: "admin_console" });
    return RpcHelpers.successResponse({ system: data.system, saved: true });
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

  // ---- Wallet Direct Operations ----

  function rpcWalletView(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var wallet = Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId);
    return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet || {} });
  }

  function rpcWalletGrant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.currencies) return RpcHelpers.errorResponse("userId and currencies required (e.g. { userId: '...', currencies: { coins: 100, gems: 5 } })");

    var wallet = Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId) || {};
    for (var currency in data.currencies) {
      wallet[currency] = (wallet[currency] || 0) + data.currencies[currency];
    }
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, wallet);

    EventBus.emit(nk, logger, ctx, "wallet_updated", { userId: data.userId, wallet: wallet, granted: data.currencies });
    logAdminAudit(nk, ctx, "admin_wallet_grant", { userId: data.userId }, { currencies: data.currencies });
    return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet });
  }

  function rpcWalletReset(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var defaults = data.defaults || {};
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
    logAdminAudit(nk, ctx, "admin_wallet_reset", { userId: data.userId });
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

  // ---- Admin-safe Satori Lists ----

  function rpcAdminFlagsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var flagsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "flags", { flags: {} });
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

    return RpcHelpers.successResponse({ flags: flags });
  }

  function rpcAdminExperimentsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var experimentsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "experiments", {});
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

    return RpcHelpers.successResponse({ experiments: experiments });
  }

  function rpcAdminLiveEventsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var eventsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "live_events", {});
    var events: any[] = [];

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
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ events: events });
  }

  function rpcAdminMessagesList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    SatoriMessages.processScheduledMessages(nk, logger);
    var messagesConfig = ConfigLoader.loadSatoriConfig<any>(nk, "messages", {});
    var messages: any[] = [];
    var now = Math.floor(Date.now() / 1000);

    for (var id in messagesConfig) {
      var def = messagesConfig[id] || {};
      var scheduleAt = def.schedule_at || def.scheduleAt;
      var status = scheduleAt && scheduleAt > now ? "scheduled" : "draft";
      messages.push({
        id: def.id || id,
        title: def.title || id,
        body: def.body || "",
        audience_id: def.audience_id || def.audienceId,
        schedule_at: scheduleAt,
        rewards_json: def.rewards_json || (def.reward ? JSON.stringify(def.reward) : undefined),
        status: def.status || status,
        created_at: isoFromSec(def.createdAt),
        updated_at: isoFromSec(def.updatedAt)
      });
    }

    return RpcHelpers.successResponse({ messages: messages });
  }

  // ---- Feature Flag Quick Toggle ----

  function rpcFlagToggle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required (flag name to toggle)");

    var flagsConfig = ConfigLoader.loadSatoriConfig<Satori.FlagsConfig>(nk, "flags", { flags: {} });
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

    ConfigLoader.saveSatoriConfig(nk, "flags", flagsConfig);
    logAdminAudit(nk, ctx, "satori_flag_toggle", { name: data.name }, { enabled: flagsConfig.flags[data.name].enabled });
    return RpcHelpers.successResponse({ flag: flagsConfig.flags[data.name], action: existing ? "toggled" : "created" });
  }

  // ---- Live Event Quick Schedule ----

  function rpcLiveEventSchedule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name) return RpcHelpers.errorResponse("id and name required");

    var eventsConfig = ConfigLoader.loadSatoriConfig<{ [id: string]: any }>(nk, "live_events", {});
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
      flagOverrides: data.flagOverrides,
      onJoinMessageId: data.onJoinMessageId,
      createdAt: (eventsConfig[data.id] && eventsConfig[data.id].createdAt) || now,
      updatedAt: now
    };

    var action = eventsConfig[data.id] ? "updated" : "created";
    eventsConfig[data.id] = newEvent;
    ConfigLoader.saveSatoriConfig(nk, "live_events", eventsConfig);
    logAdminAudit(nk, ctx, "satori_live_event_schedule", { id: data.id }, { action: action });
    return RpcHelpers.successResponse({ event: newEvent, action: action });
  }

  // ---- Experiment Quick Setup ----

  function rpcExperimentSetup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var variants = data.variants || parseMaybeJson(data.variants_json, undefined);
    if (!data.id || !data.name || !variants) return RpcHelpers.errorResponse("id, name, and variants[] required");

    var expConfig = ConfigLoader.loadSatoriConfig<{ [id: string]: any }>(nk, "experiments", {});
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
      createdAt: (expConfig[data.id] && expConfig[data.id].createdAt) || now,
      updatedAt: now
    };

    var action = expConfig[data.id] ? "updated" : "created";
    expConfig[data.id] = newExp;
    ConfigLoader.saveSatoriConfig(nk, "experiments", expConfig);
    logAdminAudit(nk, ctx, "satori_experiment_setup", { id: data.id }, { action: action });
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
    var definitions = ConfigLoader.loadSatoriConfig<any>(nk, "messages", {});
    if (definitions && definitions.messages) definitions = definitions.messages;

    var messageDef: any = {
      id: messageId,
      title: data.title,
      body: data.body || "",
      imageUrl: data.image_url || data.imageUrl,
      metadata: data.metadata || {},
      reward: reward,
      audienceId: audienceId,
      scheduleAt: scheduleAt,
      expiresAt: data.expires_at || data.expiresAt,
      status: scheduleAt && scheduleAt > now ? "scheduled" : "draft",
      createdAt: (definitions[messageId] && definitions[messageId].createdAt) || now,
      updatedAt: now
    };
    definitions[messageId] = messageDef;

    ConfigLoader.saveSatoriConfig(nk, "messages", definitions);
    var delivered = 0;
    if (audienceId && (!scheduleAt || scheduleAt <= now)) {
      delivered = SatoriMessages.deliverToAudience(nk, logger, messageDef, audienceId);
      messageDef.status = "delivered";
      messageDef.deliveredAt = now;
      ConfigLoader.saveSatoriConfig(nk, "messages", definitions);
    }
    logAdminAudit(nk, ctx, "satori_message_broadcast", { id: messageId, audienceId: audienceId }, { scheduled: !!scheduleAt, delivered: delivered });
    return RpcHelpers.successResponse({ scheduled: !!(scheduleAt && scheduleAt > now), delivered: delivered, messageId: messageId });
  }

  // ---- Game Intelligence ----

  function rpcQuizverseGameIntelligenceReport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.game_id || data.gameId || "quizverse";
    var hours = typeof data.hours === "number" && data.hours > 0 ? Math.min(data.hours, 72) : 24;
    var days = typeof data.days === "number" && data.days > 0 ? Math.min(data.days, 30) : 7;

    var flagsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "flags", { flags: {} });
    var eventsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "live_events", {});
    var experimentsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "experiments", {});
    var messagesConfig = ConfigLoader.loadSatoriConfig<any>(nk, "messages", {});
    var audiencesConfig = ConfigLoader.loadSatoriConfig<any>(nk, "audiences", {});
    var challengesConfig = ConfigLoader.loadConfig<any>(nk, "challenges", { challenges: {} });
    var incentivesConfig = ConfigLoader.loadConfig<any>(nk, "incentives", {});

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

    var inv = Storage.readJson<any>(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId) || { items: {} };
    var items = inv.items || {};
    var qty = data.quantity || 1;

    if (items[data.itemId]) {
      items[data.itemId].count = (items[data.itemId].count || 0) + qty;
    } else {
      items[data.itemId] = { id: data.itemId, count: qty, properties: data.properties || {} };
    }

    inv.items = items;
    Storage.writeJson(nk, Constants.HIRO_INVENTORY_COLLECTION, "state", data.userId, inv);
    logAdminAudit(nk, ctx, "admin_inventory_grant", { userId: data.userId, itemId: data.itemId }, { quantity: qty });
    return RpcHelpers.successResponse({ userId: data.userId, item: items[data.itemId] });
  }

  // ---- Send Admin Mailbox Message ----

  function rpcMailboxSend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.subject) return RpcHelpers.errorResponse("userId and subject required. Optional: body, rewards, expiresInSec");

    var inbox = Storage.readJson<any>(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId) || { messages: [] };
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
    Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, "inbox", data.userId, inbox);
    logAdminAudit(nk, ctx, "admin_mailbox_send", { userId: data.userId, messageId: msg.id });
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
    initializer.registerRpc("admin_player_inspect", rpcPlayerInspect);
    initializer.registerRpc("admin_user_search", rpcUserSearch);
    initializer.registerRpc("admin_wallet_view", rpcWalletView);
    initializer.registerRpc("admin_wallet_grant", rpcWalletGrant);
    initializer.registerRpc("admin_wallet_reset", rpcWalletReset);
    initializer.registerRpc("admin_inventory_grant", rpcInventoryGrant);
    initializer.registerRpc("admin_mailbox_send", rpcMailboxSend);

    // Satori quick-ops
    initializer.registerRpc("admin_satori_flags_list", rpcAdminFlagsList);
    initializer.registerRpc("admin_satori_experiments_list", rpcAdminExperimentsList);
    initializer.registerRpc("admin_satori_messages_list", rpcAdminMessagesList);
    initializer.registerRpc("admin_satori_live_events_list", rpcAdminLiveEventsList);
    initializer.registerRpc("admin_flag_toggle", rpcFlagToggle);
    initializer.registerRpc("admin_live_event_schedule", rpcLiveEventSchedule);
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

    // ---- Hiro IAP triggers (extra verbs the server doesn't model) ----
    initializer.registerRpc("hiro_iap_trigger_evaluate", delegate("__rpc_hiro_iap_trigger_check"));
    initializer.registerRpc("hiro_iap_trigger_dismiss",  softStub({ success: true, dismissed: true }));
    initializer.registerRpc("hiro_iap_trigger_convert",  softStub({ success: true, converted: false, note: "IAP receipts handled via client SDK" }));

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
