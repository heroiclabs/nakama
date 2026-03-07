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

  function findFriends(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var friends = nk.friendsList(userId, 100, 0, "");
    var result = (friends.friends || []).map(function (f: any) {
      return { userId: f.user.userId, username: f.user.username, displayName: f.user.displayName };
    });
    return { friends: result };
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

  function logEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var key = "ev_" + gId + "_" + userId + "_" + Date.now();
    Storage.writeJson(nk, Constants.ANALYTICS_COLLECTION, key, Constants.SYSTEM_USER_ID, {
      userId: userId, gameId: gId, event: data.eventName, data: data.eventData, timestamp: new Date().toISOString()
    }, 0, 0);
    return { success: true };
  }

  function trackSessionStart(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    var key = "session_" + gId + "_" + userId;
    Storage.writeJson(nk, "sessions", key, userId, { gameId: gId, startedAt: new Date().toISOString(), platform: data.platform });
    EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_START, { userId: userId, gameId: gId });
    return { success: true };
  }

  function trackSessionEnd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: any, userId: string, gId: string): any {
    EventBus.emit(nk, logger, ctx, EventBus.Events.SESSION_END, { userId: userId, gameId: gId, duration: data.duration });
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
    initializer.registerRpc(prefix + "find_friends", gameRpcHandler(gameId, findFriends));
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
