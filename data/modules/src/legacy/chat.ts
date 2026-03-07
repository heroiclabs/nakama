namespace LegacyChat {

  function rpcSendGroupChatMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      var content = data.content || data.message || "";
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var channelId = nk.channelIdBuild(userId, groupId, 3);
      var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
      return RpcHelpers.successResponse({ messageId: ack.messageId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send group message");
    }
  }

  function rpcSendDirectMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      var content = data.content || data.message || "";
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      var channelId = nk.channelIdBuild(userId, targetUserId, 2);
      var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
      return RpcHelpers.successResponse({ messageId: ack.messageId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send direct message");
    }
  }

  function rpcSendChatRoomMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var roomName = data.roomName || data.room || "general";
      var content = data.content || data.message || "";
      var channelId = nk.channelIdBuild(undefined, roomName, 1);
      var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
      return RpcHelpers.successResponse({ messageId: ack.messageId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send room message");
    }
  }

  function rpcGetGroupChatHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var channelId = nk.channelIdBuild(userId, groupId, 3);
      var limit = data.limit || 100;
      var forward = data.forward !== false;
      var cursor = data.cursor || "";
      var result = nk.channelMessagesList(channelId, limit, forward, cursor);
      return RpcHelpers.successResponse({
        messages: result.messages || [],
        nextCursor: result.nextCursor || "",
        prevCursor: result.prevCursor || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get group chat history");
    }
  }

  function rpcGetDirectMessageHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      var channelId = nk.channelIdBuild(userId, targetUserId, 2);
      var limit = data.limit || 100;
      var forward = data.forward !== false;
      var cursor = data.cursor || "";
      var result = nk.channelMessagesList(channelId, limit, forward, cursor);
      return RpcHelpers.successResponse({
        messages: result.messages || [],
        nextCursor: result.nextCursor || "",
        prevCursor: result.prevCursor || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get direct message history");
    }
  }

  function rpcGetChatRoomHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var roomName = data.roomName || data.room || "general";
      var channelId = nk.channelIdBuild(undefined, roomName, 1);
      var limit = data.limit || 100;
      var forward = data.forward !== false;
      var cursor = data.cursor || "";
      var result = nk.channelMessagesList(channelId, limit, forward, cursor);
      return RpcHelpers.successResponse({
        messages: result.messages || [],
        nextCursor: result.nextCursor || "",
        prevCursor: result.prevCursor || ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get room history");
    }
  }

  function rpcMarkDirectMessagesRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var targetUserId = data.userId || data.targetUserId;
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      return RpcHelpers.successResponse({ success: true });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to mark messages read");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("send_group_chat_message", rpcSendGroupChatMessage);
    initializer.registerRpc("send_direct_message", rpcSendDirectMessage);
    initializer.registerRpc("send_chat_room_message", rpcSendChatRoomMessage);
    initializer.registerRpc("get_group_chat_history", rpcGetGroupChatHistory);
    initializer.registerRpc("get_direct_message_history", rpcGetDirectMessageHistory);
    initializer.registerRpc("get_chat_room_history", rpcGetChatRoomHistory);
    initializer.registerRpc("mark_direct_messages_read", rpcMarkDirectMessagesRead);
  }
}
