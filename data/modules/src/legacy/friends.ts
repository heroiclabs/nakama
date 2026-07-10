// ============================================================================
// src/legacy/friends.ts — Legacy friend mutation RPCs (block/unblock/remove)
// ============================================================================
// HISTORY
// -------
// This namespace used to register six friend RPCs: friends_block, friends_unblock,
// friends_remove, friends_list, friends_challenge_user, friends_spectate.
//
// Phase-3a moved friends_challenge_user + friends_spectate ownership to
// data/modules/friends/friend_challenges.js (canonical lifecycle module).
// Their dead handlers were already physically removed from this file in
// that pass.
//
// Phase-4 C1 moves friends_list ownership to src/friends/friends_list.ts
// (canonical flat-shape module with presence + relationship enrichment).
// The dead rpcFriendsList handler is removed here too.
//
// What remains
// ------------
// Three thin wrappers around Nakama's built-in friend-graph mutation APIs.
// These are intentionally minimal — they just shape the response envelope
// and merge the `userId`/`username` convenience args with the array forms.
// We keep them in TypeScript (not in the legacy JS bridge) because:
//   1) They're small enough that maintenance cost is zero.
//   2) The TS path wins precedence in postbuild merging, so any JS twin
//      in data/modules/friends/friends.js is silently shadowed — keeping
//      them in TS is the cleanest way to make THIS file the source of truth.
//
// Notification follow-ups
// -----------------------
// Currently these handlers do NOT emit notifications. That is intentional:
//   - friends_block: silent by product policy (don't tell the blocked user).
//   - friends_unblock: silent (no user-facing event).
//   - friends_remove: notifies removed user via FRIEND_REMOVED (code 5).
//   - friends_block: still silent by product policy.
// ============================================================================

namespace LegacyFriends {

  function rpcFriendsBlock(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var ids: string[] = data.ids ? (Array.isArray(data.ids) ? data.ids : [data.ids]) : [];
      var usernames: string[] = data.usernames ? (Array.isArray(data.usernames) ? data.usernames : [data.usernames]) : [];
      if (data.userId) ids.push(data.userId);
      if (data.targetUserId) ids.push(data.targetUserId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      // nakama-common's .d.ts types this as returning FriendList, but this
      // server's Goja binding hands back `undefined` — every single call
      // crashed with "Cannot read property 'friends' of undefined" (found
      // live by the Social Zone eval suite's friends_block round-trip
      // test). Guard defensively instead of assuming either shape.
      var result: any = nk.friendsBlock(userId, username, ids, usernames);
      return RpcHelpers.successResponse({ friends: (result && result.friends) || [] });
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
      if (data.targetUserId) ids.push(data.targetUserId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      // Same defensive guard as rpcFriendsBlock above — this server's
      // nk.friendsDelete binding also hands back `undefined`.
      var result: any = nk.friendsDelete(userId, username, ids, usernames);
      return RpcHelpers.successResponse({ friends: (result && result.friends) || [] });
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
      if (data.friendUserId) ids.push(data.friendUserId);
      if (data.username) usernames.push(data.username);
      if (ids.length === 0 && usernames.length === 0) {
        return RpcHelpers.errorResponse("ids or usernames required");
      }
      // Same defensive guard as rpcFriendsBlock/rpcFriendsUnblock above.
      var result: any = nk.friendsDelete(userId, username, ids, usernames);

      var sendNotif = (globalThis as any).sendFriendsNotification as
        | ((nk: nkruntime.Nakama, logger: nkruntime.Logger, subjectKey: string,
            targetUserId: string, payload: object, senderId: string | null) => boolean)
        | undefined;
      if (typeof sendNotif === "function") {
        for (let i = 0; i < ids.length; i++) {
          const removedId = ids[i];
          if (!removedId || removedId === userId) continue;
          try {
            sendNotif(nk, logger, "FRIEND_REMOVED", removedId, {
              removedByUserId: userId,
              friendUserId:    userId,
            }, userId);
          } catch (notifyErr: any) {
            if (logger && logger.warn) {
              logger.warn("[Friends] friends_remove notify failed: " + (notifyErr.message || notifyErr));
            }
          }
        }
      }

      return RpcHelpers.successResponse({ friends: (result && result.friends) || [] });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to remove friend");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("friends_block",   rpcFriendsBlock);
    initializer.registerRpc("friends_unblock", rpcFriendsUnblock);
    initializer.registerRpc("friends_remove",  rpcFriendsRemove);
    // Phase-3a: friends_challenge_user + friends_spectate are registered by
    //   data/modules/friends/friend_challenges.js (canonical lifecycle module).
    // Phase-4 C1: friends_list is registered by src/friends/friends_list.ts
    //   (canonical flat-shape module). Lines physically removed (not commented)
    //   so postbuild's textual regex doesn't pick them up.
  }
}
