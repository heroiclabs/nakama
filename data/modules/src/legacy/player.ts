namespace LegacyPlayer {

  interface PlayerMetadata {
    displayName?: string;
    avatarUrl?: string;
    country?: string;
    language?: string;
    timezone?: string;
    level?: number;
    xp?: number;
    totalGamesPlayed?: number;
    totalWins?: number;
    favoriteGame?: string;
    bio?: string;
    customData?: { [key: string]: any };
    updatedAt?: string;
  }

  function getPlayerMetadata(nk: nkruntime.Nakama, userId: string): PlayerMetadata {
    var data = Storage.readJson<PlayerMetadata>(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId);
    return data || {};
  }

  function savePlayerMetadata(nk: nkruntime.Nakama, userId: string, metadata: PlayerMetadata): void {
    metadata.updatedAt = new Date().toISOString();
    Storage.writeJson(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", userId, metadata, 2, 1);
  }

  function rpcGetPlayerPortfolio(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
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

  function rpcUpdatePlayerMetadataUnified(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var metadata = getPlayerMetadata(nk, userId);

    if (data.displayName !== undefined) metadata.displayName = data.displayName;
    if (data.avatarUrl !== undefined) metadata.avatarUrl = data.avatarUrl;
    if (data.country !== undefined) metadata.country = data.country;
    if (data.language !== undefined) metadata.language = data.language;
    if (data.timezone !== undefined) metadata.timezone = data.timezone;
    if (data.bio !== undefined) metadata.bio = data.bio;
    if (data.favoriteGame !== undefined) metadata.favoriteGame = data.favoriteGame;
    if (data.customData !== undefined) {
      if (!metadata.customData) metadata.customData = {};
      for (var k in data.customData) {
        metadata.customData[k] = data.customData[k];
      }
    }

    if (data.displayName || data.avatarUrl) {
      try {
        nk.accountUpdateId(userId, null, data.displayName || null, data.avatarUrl || null, null, null, null);
      } catch (err: any) {
        logger.warn("[Player] Failed to update account: " + err.message);
      }
    }

    savePlayerMetadata(nk, userId, metadata);
    return RpcHelpers.successResponse({ metadata: metadata });
  }

  function rpcChangeUsername(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.username) return RpcHelpers.errorResponse("username required");

    try {
      nk.accountUpdateId(userId, data.username, null, null, null, null, null);
      return RpcHelpers.successResponse({ username: data.username });
    } catch (err: any) {
      return RpcHelpers.errorResponse("Failed to change username: " + err.message);
    }
  }

  function rpcGetPlayerMetadata(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var targetUserId = data.userId || userId;

    var metadata = getPlayerMetadata(nk, targetUserId);
    return RpcHelpers.successResponse({ metadata: metadata });
  }

  function rpcAdminDeletePlayerMetadata(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    Storage.deleteRecord(nk, Constants.PLAYER_METADATA_COLLECTION, "metadata", data.userId);
    return RpcHelpers.successResponse({ deleted: true });
  }

  function rpcCheckGeoAndUpdateProfile(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var metadata = getPlayerMetadata(nk, userId);

    if (data.country) metadata.country = data.country;
    if (data.timezone) metadata.timezone = data.timezone;
    if (data.language) metadata.language = data.language;

    savePlayerMetadata(nk, userId, metadata);
    return RpcHelpers.successResponse({ metadata: metadata });
  }

  function rpcCreateOrSyncUser(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var metadata = getPlayerMetadata(nk, userId);
    if (data.displayName) metadata.displayName = data.displayName;
    if (data.avatarUrl) metadata.avatarUrl = data.avatarUrl;
    savePlayerMetadata(nk, userId, metadata);

    var account = nk.accountGetId(userId);
    return RpcHelpers.successResponse({
      userId: userId,
      username: account.user ? account.user.username : "",
      metadata: metadata,
      synced: true
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("get_player_portfolio", rpcGetPlayerPortfolio);
    initializer.registerRpc("rpc_update_player_metadata", rpcUpdatePlayerMetadataUnified);
    initializer.registerRpc("rpc_change_username", rpcChangeUsername);
    initializer.registerRpc("get_player_metadata", rpcGetPlayerMetadata);
    initializer.registerRpc("admin_delete_player_metadata", rpcAdminDeletePlayerMetadata);
    initializer.registerRpc("check_geo_and_update_profile", rpcCheckGeoAndUpdateProfile);
    initializer.registerRpc("create_or_sync_user", rpcCreateOrSyncUser);
  }
}
