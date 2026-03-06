namespace AdminConsole {

  // ---- Hiro Config CRUD ----

  function rpcConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. economy, inventory, achievements)");

    var config = Storage.readSystemJson<any>(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system);
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system || !data.config) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveConfig(nk, data.system, data.config);
    return RpcHelpers.successResponse({ system: data.system, saved: true });
  }

  function rpcConfigDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required");

    Storage.deleteRecord(nk, Constants.HIRO_CONFIGS_COLLECTION, data.system, Constants.SYSTEM_USER_ID);
    ConfigLoader.invalidateCache(data.system);
    return RpcHelpers.successResponse({ system: data.system, deleted: true });
  }

  // ---- Satori Config CRUD ----

  function rpcSatoriConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system) return RpcHelpers.errorResponse("system required (e.g. flags, experiments, audiences, live_events, messages, metrics)");

    var config = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, data.system);
    return RpcHelpers.successResponse({ system: data.system, config: config || {} });
  }

  function rpcSatoriConfigSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.system || !data.config) return RpcHelpers.errorResponse("system and config required");

    ConfigLoader.saveSatoriConfig(nk, data.system, data.config);
    return RpcHelpers.successResponse({ system: data.system, saved: true });
  }

  // ---- Bulk Import/Export ----

  function rpcBulkExport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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
    var data = RpcHelpers.parseRpcPayload(payload);
    ConfigLoader.invalidateCache(data.system);
    return RpcHelpers.successResponse({ invalidated: data.system || "all" });
  }

  // ---- User Data Management ----

  function rpcUserDataGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection) return RpcHelpers.errorResponse("userId and collection required");

    var key = data.key || "state";
    var result = Storage.readJson<any>(nk, data.collection, key, data.userId);
    return RpcHelpers.successResponse({ collection: data.collection, key: key, data: result });
  }

  function rpcUserDataSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection || !data.data) return RpcHelpers.errorResponse("userId, collection, and data required");

    var key = data.key || "state";
    Storage.writeJson(nk, data.collection, key, data.userId, data.data);
    return RpcHelpers.successResponse({ saved: true });
  }

  function rpcUserDataDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.collection) return RpcHelpers.errorResponse("userId and collection required");

    var key = data.key || "state";
    Storage.deleteRecord(nk, data.collection, key, data.userId);
    return RpcHelpers.successResponse({ deleted: true });
  }

  // ---- Player Full Profile Inspector ----

  function rpcPlayerInspect(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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
      { name: "inventory", collection: Constants.HIRO_INVENTORY_COLLECTION, key: "state" },
      { name: "achievements", collection: Constants.HIRO_ACHIEVEMENTS_COLLECTION, key: "state" },
      { name: "progression", collection: Constants.HIRO_PROGRESSION_COLLECTION, key: "state" },
      { name: "energy", collection: Constants.HIRO_ENERGY_COLLECTION, key: "state" },
      { name: "stats", collection: Constants.HIRO_STATS_COLLECTION, key: "state" },
      { name: "streaks", collection: Constants.HIRO_STREAKS_COLLECTION, key: "state" },
      { name: "tutorials", collection: Constants.HIRO_TUTORIALS_COLLECTION, key: "state" },
      { name: "unlockables", collection: Constants.HIRO_UNLOCKABLES_COLLECTION, key: "state" },
      { name: "satoriIdentity", collection: Constants.SATORI_IDENTITY_COLLECTION, key: "properties" },
      { name: "satoriAssignments", collection: Constants.SATORI_ASSIGNMENTS_COLLECTION, key: "state" },
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
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var wallet = Storage.readJson<any>(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId);
    return RpcHelpers.successResponse({ userId: data.userId, wallet: wallet || {} });
  }

  function rpcWalletGrant(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var defaults = data.defaults || {};
    Storage.writeJson(nk, Constants.WALLETS_COLLECTION, "wallet", data.userId, defaults);
    return RpcHelpers.successResponse({ userId: data.userId, wallet: defaults, reset: true });
  }

  // ---- Storage Collections Browser ----

  function rpcStorageList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required (flag name to toggle)");

    var flagsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "flags", { flags: [] });
    var flags = flagsConfig.flags || [];
    var found = false;

    for (var i = 0; i < flags.length; i++) {
      if (flags[i].name === data.name) {
        flags[i].enabled = data.enabled !== undefined ? data.enabled : !flags[i].enabled;
        found = true;
        break;
      }
    }

    if (!found && data.value !== undefined) {
      flags.push({
        name: data.name,
        value: String(data.value),
        enabled: data.enabled !== undefined ? data.enabled : true,
        audiences: data.audiences || []
      });
      found = true;
    }

    if (!found) return RpcHelpers.errorResponse("Flag '" + data.name + "' not found. Provide value to create.");

    flagsConfig.flags = flags;
    ConfigLoader.saveSatoriConfig(nk, "flags", flagsConfig);

    var flag = flags.filter(function(f: any) { return f.name === data.name; })[0];
    return RpcHelpers.successResponse({ flag: flag, action: found ? "toggled" : "created" });
  }

  // ---- Live Event Quick Schedule ----

  function rpcLiveEventSchedule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name) return RpcHelpers.errorResponse("id and name required");

    var eventsConfig = ConfigLoader.loadSatoriConfig<any>(nk, "live_events", { events: [] });
    var events = eventsConfig.events || [];

    var now = Date.now();
    var newEvent: any = {
      id: data.id,
      name: data.name,
      description: data.description || "",
      startTimeSec: data.startTimeSec || Math.floor(now / 1000),
      endTimeSec: data.endTimeSec || Math.floor(now / 1000) + 86400,
      audiences: data.audiences || [],
      rewards: data.rewards || [],
      maxClaims: data.maxClaims || 1,
      activeGames: data.activeGames || [],
      enabled: data.enabled !== undefined ? data.enabled : true
    };

    var replaced = false;
    for (var i = 0; i < events.length; i++) {
      if (events[i].id === data.id) {
        events[i] = newEvent;
        replaced = true;
        break;
      }
    }
    if (!replaced) events.push(newEvent);

    eventsConfig.events = events;
    ConfigLoader.saveSatoriConfig(nk, "live_events", eventsConfig);
    return RpcHelpers.successResponse({ event: newEvent, action: replaced ? "updated" : "created" });
  }

  // ---- Experiment Quick Setup ----

  function rpcExperimentSetup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id || !data.name || !data.variants) return RpcHelpers.errorResponse("id, name, and variants[] required");

    var expConfig = ConfigLoader.loadSatoriConfig<any>(nk, "experiments", { experiments: [] });
    var experiments = expConfig.experiments || [];

    var newExp: any = {
      id: data.id,
      name: data.name,
      description: data.description || "",
      audiences: data.audiences || [],
      enabled: data.enabled !== undefined ? data.enabled : true,
      variants: data.variants
    };

    var replaced = false;
    for (var i = 0; i < experiments.length; i++) {
      if (experiments[i].id === data.id) {
        experiments[i] = newExp;
        replaced = true;
        break;
      }
    }
    if (!replaced) experiments.push(newExp);

    expConfig.experiments = experiments;
    ConfigLoader.saveSatoriConfig(nk, "experiments", expConfig);
    return RpcHelpers.successResponse({ experiment: newExp, action: replaced ? "updated" : "created" });
  }

  // ---- User Search ----

  function rpcUserSearch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var events = Storage.readJson<any>(nk, Constants.SATORI_EVENTS_COLLECTION, "history", data.userId) || { events: [] };
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

    // Storage browser
    initializer.registerRpc("admin_storage_list", rpcStorageList);

    // Health
    initializer.registerRpc("admin_health_check", rpcHealthCheck);
  }
}
