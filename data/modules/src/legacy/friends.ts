namespace LegacyFriends {

  function rpcFriendsBlock(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var ids: string[] = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
      var usernames: string[] = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
      if (data.userId) ids.push(data.userId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      var result = nk.friendsBlock(userId, username, ids, usernames);
      return RpcHelpers.successResponse({ friends: result.friends || [] });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to block");
    }
  }

  function rpcFriendsUnblock(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var ids: string[] = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
      var usernames: string[] = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
      if (data.userId) ids.push(data.userId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      var result = nk.friendsDelete(userId, username, ids, usernames);
      return RpcHelpers.successResponse({ friends: result.friends || [] });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to unblock");
    }
  }

  function rpcFriendsRemove(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var ids: string[] = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
      var usernames: string[] = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
      if (data.userId) ids.push(data.userId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      var result = nk.friendsDelete(userId, username, ids, usernames);
      return RpcHelpers.successResponse({ friends: result.friends || [] });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to remove friend");
    }
  }

  function rpcFriendsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var limit = data.limit || 100;
      var state = data.state;
      var cursor = data.cursor || "";
      var result = nk.friendsList(userId, limit, state, cursor);
      return RpcHelpers.successResponse({
        friends: result.friends || [],
        cursor: result.cursor || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to list friends");
    }
  }

  function rpcFriendsChallengeUser(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      nk.notificationsSend([{
        userId: targetUserId,
        subject: "friend_challenge",
        content: { senderId: userId, senderUsername: username, gameId: data.gameId || "", matchId: data.matchId || "" },
        code: 1,
        persistent: false
      }]);
      return RpcHelpers.successResponse({ success: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send challenge");
    }
  }

  function rpcFriendsSpectate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      nk.notificationsSend([{
        userId: targetUserId,
        subject: "friend_spectate",
        content: { spectatorId: userId, matchId: data.matchId || "" },
        code: 2,
        persistent: false
      }]);
      return RpcHelpers.successResponse({ success: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send spectate request");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("friends_block", rpcFriendsBlock);
    initializer.registerRpc("friends_unblock", rpcFriendsUnblock);
    initializer.registerRpc("friends_remove", rpcFriendsRemove);
    initializer.registerRpc("friends_list", rpcFriendsList);
    initializer.registerRpc("friends_challenge_user", rpcFriendsChallengeUser);
    initializer.registerRpc("friends_spectate", rpcFriendsSpectate);
  }
}
