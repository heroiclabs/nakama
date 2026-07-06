namespace LegacyGroups {

  var GROUP_WALLETS_COLLECTION = "group_wallets";

  function rpcCreateGameGroup(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var name = data.name || "Game Group";
      var description = data.description || "";
      var open = data.open !== false;
      var metadata = data.metadata || {};
      if (data.gameId) metadata.gameId = data.gameId;
      var group = nk.groupCreate(userId, name, userId, null, description, null, open, metadata, data.limit || 100);
      return RpcHelpers.successResponse({ group: group });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to create group");
    }
  }

  function rpcUpdateGroupXp(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      var xp = data.xp;
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      if (xp === undefined) return RpcHelpers.errorResponse("xp required");
      var groups = nk.groupsGetId([groupId]);
      if (!groups || groups.length === 0) return RpcHelpers.errorResponse("Group not found");
      var group = groups[0];
      var meta = group.metadata || {};
      var currentXp = typeof meta.xp === "number" ? meta.xp : 0;
      meta.xp = currentXp + (typeof xp === "number" ? xp : parseInt(String(xp), 10));
      nk.groupUpdate(groupId, userId, undefined, undefined, undefined, undefined, undefined, undefined, meta, undefined);
      return RpcHelpers.successResponse({ xp: meta.xp });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to update group XP");
    }
  }

  function getGroupWallet(nk: nkruntime.Nakama, groupId: string): { [key: string]: number } {
    var key = "wallet_" + groupId;
    var data = Storage.readSystemJson<{ [key: string]: number }>(nk, GROUP_WALLETS_COLLECTION, key);
    return data || {};
  }

  function saveGroupWallet(nk: nkruntime.Nakama, groupId: string, wallet: { [key: string]: number }): void {
    var key = "wallet_" + groupId;
    Storage.writeSystemJson(nk, GROUP_WALLETS_COLLECTION, key, wallet);
  }

  function rpcGetGroupWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var wallet = getGroupWallet(nk, groupId);
      return RpcHelpers.successResponse({ wallet: wallet });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get group wallet");
    }
  }

  function rpcUpdateGroupWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      var currencyId = data.currencyId || "game";
      var amount = typeof data.amount === "number" ? data.amount : parseInt(String(data.amount || 0), 10);
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var wallet = getGroupWallet(nk, groupId);
      var current = wallet[currencyId] || 0;
      wallet[currencyId] = current + amount;
      saveGroupWallet(nk, groupId, wallet);
      return RpcHelpers.successResponse({ wallet: wallet });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to update group wallet");
    }
  }

  function rpcGetUserGroups(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var limit = data.limit || 100;
      var state = data.state;
      var cursor = data.cursor || "";
      var result = nk.userGroupsList(userId, limit, state, cursor);
      var userGroups = result.userGroups || [];

      // B-008 fix (2026-07-06, WORLD_CLASS_SOCIAL_FRIENDS_GROUPS_ARCHITECTURE.md
      // §2.1/§7.2): optional server-side gameId filter. Previously every
      // group (all games) was shipped to the client, which then filtered by
      // metadata.gameId — wasted bandwidth and a cross-game data leak.
      // Backward compatible: when the caller omits gameId, behaviour is
      // byte-identical to the old implementation.
      // NOTE on pagination: the filter runs on the current page, so a page
      // can legitimately return fewer than `limit` groups while `cursor` is
      // still set — clients must key "end of list" off cursor, not count.
      var gameId = data.gameId;
      if (gameId && typeof gameId === "string") {
        var filtered: any[] = [];
        for (var i = 0; i < userGroups.length; i++) {
          var ug: any = userGroups[i];
          var meta = (ug && ug.group && ug.group.metadata) || {};
          if (meta.gameId === gameId) filtered.push(ug);
        }
        userGroups = filtered;
      }

      return RpcHelpers.successResponse({
        userGroups: userGroups,
        cursor: result.cursor || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to list user groups");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("create_game_group", rpcCreateGameGroup);
    initializer.registerRpc("update_group_xp", rpcUpdateGroupXp);
    initializer.registerRpc("get_group_wallet", rpcGetGroupWallet);
    initializer.registerRpc("update_group_wallet", rpcUpdateGroupWallet);
    initializer.registerRpc("get_user_groups", rpcGetUserGroups);
  }
}
