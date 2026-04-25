namespace AdminConsole {

  // ---- Hiro Config CRUD ----

  function rpcConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");

    var config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system || !data.config) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveConfig(nk, data.system, data.config);
    return RpcHelpers.successResponse({ system: data.system, saved: true });
  }

  function rpcConfigDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required");

    Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system, Constants.SYSTEM_USER_ID);
    ConfigLoader.invalidateCache(data.system);
    return RpcHelpers.successResponse({ system: data.system, deleted: true });
  }

  // ---- Satori Config CRUD ----

  function rpcSatoriConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");

    var config = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcSatoriConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system || !data.config) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveSatoriConfig(nk, data.system, data.config);
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
    return RpcHelpers.successResponse({ saved: true });
  }

  function rpcUserDataDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection) return RpcHelpers.errorResponse("userId and collection required");

    var key = data.key || "state";
    Storage.deleteRecord(nk, data.collection, key, data.userId);
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
    return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet });
  }

  function rpcWalletReset(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var defaults = data.defaults || {};
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
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

  // ---- Feature Flag Quick Toggle ----

  function rpcFlagToggle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required (flag name to toggle)");

    var flagsConfig = ConfigLoader.loadSatoriConfig<Satori.FlagsConfig>(nk, "flags", { flags: {} });
    if (!flagsConfig.flags) flagsConfig.flags = {};

    var existing = flagsConfig.flags[data.name];
    var now = Math.floor(Date.now() / 1000);

    if (existing) {
      existing.enabled = data.enabled !== undefined ? data.enabled : !existing.enabled;
      if (data.value !== undefined) existing.value = String(data.value);
      if (data.conditionsByAudience) existing.conditionsByAudience = data.conditionsByAudience;
      existing.updatedAt = now;
    } else if (data.value !== undefined) {
      flagsConfig.flags[data.name] = {
        name: data.name,
        value: String(data.value),
        description: data.description || "",
        conditionsByAudience: data.conditionsByAudience,
        enabled: data.enabled !== undefined ? data.enabled : true,
        createdAt: now,
        updatedAt: now
      };
    } else {
      return RpcHelpers.errorResponse("Flag '" + data.name + "' not found. Provide value to create.");
    }

    ConfigLoader.saveSatoriConfig(nk, "flags", flagsConfig);
    return RpcHelpers.successResponse({ flag: flagsConfig.flags[data.name], action: existing ? "toggled" : "created" });
  }

  // ---- Live Event Quick Schedule ----

  function rpcLiveEventSchedule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name) return RpcHelpers.errorResponse("id and name required");

    var eventsConfig = ConfigLoader.loadSatoriConfig<{ [id: string]: any }>(nk, "live_events", {});
    var now = Math.floor(Date.now() / 1000);

    var newEvent: any = {
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

  function rpcExperimentSetup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name || !data.variants) return RpcHelpers.errorResponse("id, name, and variants[] required");

    var expConfig = ConfigLoader.loadSatoriConfig<{ [id: string]: any }>(nk, "experiments", {});
    var now = Math.floor(Date.now() / 1000);

    var newExp: any = {
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
    initializer.registerRpc("admin_flag_toggle", rpcFlagToggle);
    initializer.registerRpc("admin_live_event_schedule", rpcLiveEventSchedule);
    initializer.registerRpc("admin_experiment_setup", rpcExperimentSetup);
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
    return RpcHelpers.successResponse({ updated: true });
  }
}
