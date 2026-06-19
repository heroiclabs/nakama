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
        // Signature: accountUpdateId(userId, username, displayName, timezone, location, langTag, avatarUrl, metadata)
        nk.accountUpdateId(userId, null, data.displayName || null, null, null, null, data.avatarUrl || null, null);
      } catch (err: any) {
        logger.warn("[Player] Failed to update account: " + err.message);
      }
    }

    savePlayerMetadata(nk, userId, metadata);

    // Best-effort sync to UserMgmt. Never fails the RPC — Nakama state is the
    // source of truth for game data; UserMgmt is the source of truth for
    // identity (firstName/lastName/etc). Sync result is surfaced to the caller
    // under `userMgmtSync` so the client can decide whether to warn the user.
    var syncFields: { [key: string]: any } = {};
    if (data.displayName !== undefined) syncFields.userName = data.displayName;
    if (data.firstName !== undefined) syncFields.firstName = data.firstName;
    if (data.lastName !== undefined) syncFields.lastName = data.lastName;
    if (data.age !== undefined) syncFields.age = data.age;
    if (data.phoneNumber !== undefined) syncFields.phoneNumber = data.phoneNumber;
    var syncResult = LegacyUserMgmtSync.pushProfile(nk, logger, userId, String(data._cognito_jwt || ""), syncFields);

    return RpcHelpers.successResponse({ metadata: metadata, userMgmtSync: syncResult });
  }

  function rpcChangeUsername(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.username) return JSON.stringify({ success: false, error: "username required", error_code: "USERNAME_INVALID" });

    var username = String(data.username).toLowerCase().trim();
    if (username.length < 3) return JSON.stringify({ success: false, error: "Username must be at least 3 characters", error_code: "USERNAME_TOO_SHORT" });
    if (username.length > 20) return JSON.stringify({ success: false, error: "Username must be at most 20 characters", error_code: "USERNAME_TOO_LONG" });
    if (!/^[a-z0-9_]+$/.test(username)) return JSON.stringify({ success: false, error: "Use only letters, numbers, and underscores", error_code: "USERNAME_INVALID" });

    try {
      // QVBF_114: if displayName was empty or just mirrored the old username,
      // keep it in sync — otherwise read-time enrichment (leaderboards, chat,
      // async challenges) keeps resurfacing the old handle forever.
      var newDisplayName: string | null = null;
      try {
        var curAccount = nk.accountGetId(userId);
        var curUsername = (curAccount && curAccount.user && curAccount.user.username) || "";
        var curDisplayName = (curAccount && curAccount.user && (curAccount.user as any).displayName) || "";
        if (!curDisplayName || curDisplayName === curUsername) newDisplayName = username;
      } catch (_) { /* fall back to username-only update */ }
      nk.accountUpdateId(userId, username, newDisplayName, null, null, null, null);
      var syncResult = LegacyUserMgmtSync.pushProfile(nk, logger, userId, String(data._cognito_jwt || ""), { userName: username });
      return RpcHelpers.successResponse({ username: username, userMgmtSync: syncResult });
    } catch (err: any) {
      var msg = err.message || "";
      if (msg.indexOf("unique") !== -1 || msg.indexOf("exists") !== -1 || msg.indexOf("taken") !== -1) {
        return JSON.stringify({ success: false, error: "That username is already taken", error_code: "USERNAME_TAKEN" });
      }
      return JSON.stringify({ success: false, error: "Failed to change username: " + msg, error_code: "UPDATE_FAILED" });
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
