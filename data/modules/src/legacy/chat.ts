namespace LegacyChat {

  // Max characters of the message we surface in the push body preview.
  var PUSH_PREVIEW_MAX = 120;

  // ─── Failed-push retry queue ────────────────────────────────────────────────
  // When a chat push returns false because the SNS/Lambda send failed (NOT
  // because the recipient simply has no device token), we persist the attempt
  // to a per-recipient queue. The notification scheduler calls
  // flushFailedChatPushes() every few minutes to replay them. This makes chat
  // pushes best-effort-with-retry instead of best-effort-fire-and-forget.
  var FAILED_PUSH_COLLECTION = "chat_failed_push";
  var FAILED_PUSH_INDEX_COLLECTION = "chat_failed_push_index";
  var FAILED_PUSH_INDEX_KEY = "index";
  var FAILED_PUSH_MAX_RETRIES = 8;          // ~ a few hours at the flush cadence
  var FAILED_PUSH_RETRY_INTERVAL_SEC = 120; // don't replay the same row too fast
  var FAILED_PUSH_TTL_SEC = 24 * 60 * 60;   // drop rows older than 24h regardless

  // ─── Read-state tracking ────────────────────────────────────────────────────
  // Per-user record mapping conversationKey -> last-read message createTime (ms).
  // conversationKey is "dm:<otherUserId>" or "grp:<groupId>". Unread counts are
  // derived by listing channel messages newer than the stored watermark.
  var READ_STATE_COLLECTION = "chat_read_state";
  var READ_STATE_KEY = "state";

  interface FailedPushRow {
    kind: string;          // "direct" | "group"
    recipientId: string;
    senderId: string;
    senderName: string;
    eventType: string;     // "direct_message" | "group_message"
    title: string;
    body: string;
    data: { [k: string]: any };
    retries: number;
    lastAttempt: number;   // epoch seconds
    createdAt: number;     // epoch seconds
  }

  interface ReadStateData {
    // conversationKey -> last-read message createTime in epoch milliseconds.
    lastRead: { [conversationKey: string]: number };
  }

  // Resolve a friendly sender name for push copy: account display name first,
  // then username, then the raw username from the socket context, else "Someone".
  function resolveSenderName(nk: nkruntime.Nakama, userId: string, fallbackUsername: string): string {
    try {
      var users = nk.usersGetId([userId]);
      if (users && users.length > 0) {
        var u: any = users[0];
        if (u.displayName && String(u.displayName).trim() !== "") return String(u.displayName);
        if (u.username && String(u.username).trim() !== "") return String(u.username);
      }
    } catch (_) {}
    return (fallbackUsername && fallbackUsername.trim() !== "") ? fallbackUsername : "Someone";
  }

  // Build a short, single-line preview of the message body for the push.
  function buildPreview(content: any): string {
    var text = "";
    if (typeof content === "string") {
      text = content;
    } else if (content && typeof content === "object") {
      text = String(content.body || content.text || content.message || "");
    }
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > PUSH_PREVIEW_MAX) text = text.substring(0, PUSH_PREVIEW_MAX - 1) + "\u2026";
    return text;
  }

  // ─── System/structured payload guard (Phantom Arena triple-notify fix) ─────
  // AsyncChallengeChatIntegration.cs (Unity) sends machine-readable DMs prefixed
  // with these tags to sync challenge invites / joiner names / results between
  // devices via the chat channel. Every one of those events ALREADY has its own
  // clean, localized in-app notification + device push from the dedicated
  // async-challenge system (legacy_runtime.js: asyncChallengeSendNotification,
  // codes challenge_received / opponent_joined / opponent_completed /
  // results_ready / rematch_requested). Without this guard, afterChannelMessageSend
  // ALSO fires a generic chat push + ephemeral in-app ping (code 9001) whose body
  // is the raw JSON payload text — a third, redundant, and visually broken
  // notification for the same event. [ASYNC_CHALLENGE_JOINER] is pure internal
  // state sync and must never surface to the user at all.
  var SYSTEM_PAYLOAD_PREFIXES = ["[ASYNC_CHALLENGE_JOINER]", "[ASYNC_CHALLENGE]", "[ASYNC_RESULT]"];

  function isSystemPayloadMessage(content: any): boolean {
    var text = "";
    if (typeof content === "string") {
      text = content;
    } else if (content && typeof content === "object") {
      text = String(content.text || content.body || content.message || "");
    }
    text = text.trim();
    for (var i = 0; i < SYSTEM_PAYLOAD_PREFIXES.length; i++) {
      if (text.indexOf(SYSTEM_PAYLOAD_PREFIXES[i]) === 0) return true;
    }
    return false;
  }

  // ─── Failed-push queue helpers ──────────────────────────────────────────────

  // Add a recipient to the failed-push index so the scheduler can find them.
  function addToFailedPushIndex(nk: nkruntime.Nakama, recipientId: string): void {
    try {
      var objs = nk.storageRead([{ collection: FAILED_PUSH_INDEX_COLLECTION, key: FAILED_PUSH_INDEX_KEY, userId: Constants.SYSTEM_USER_ID }]);
      var ids: string[] = (objs && objs.length > 0 && objs[0].value && (objs[0].value as any).userIds)
        ? ((objs[0].value as any).userIds as string[]) : [];
      if (ids.indexOf(recipientId) < 0) ids.push(recipientId);
      nk.storageWrite([{
        collection: FAILED_PUSH_INDEX_COLLECTION, key: FAILED_PUSH_INDEX_KEY, userId: Constants.SYSTEM_USER_ID,
        value: { userIds: ids }, permissionRead: 0, permissionWrite: 0
      }]);
    } catch (_) { /* non-fatal — flush just won't pick this user up this tick */ }
  }

  // Persist a failed chat push so the scheduler can retry it. Keyed per
  // recipient; multiple pending messages for the same recipient are stored as a
  // rows[] array on one record (keeps the index small and reads cheap).
  function enqueueFailedPush(nk: nkruntime.Nakama, logger: nkruntime.Logger, row: FailedPushRow): void {
    try {
      var existing = Storage.readJson<{ rows: FailedPushRow[] }>(nk, FAILED_PUSH_COLLECTION, row.recipientId, Constants.SYSTEM_USER_ID);
      var rows: FailedPushRow[] = (existing && existing.rows) ? existing.rows : [];
      // Cap per-recipient backlog so a permanently-unreachable device can't grow
      // an unbounded record. Keep the newest 50.
      rows.push(row);
      if (rows.length > 50) rows = rows.slice(rows.length - 50);
      Storage.writeJson(nk, FAILED_PUSH_COLLECTION, row.recipientId, Constants.SYSTEM_USER_ID, { rows: rows }, 0, 0);
      addToFailedPushIndex(nk, row.recipientId);
    } catch (e: any) {
      logger.warn("[Chat] enqueueFailedPush failed: %s", e && e.message ? e.message : String(e));
    }
  }

  // Fire a localized chat push and, if it failed for a retryable reason, queue
  // it. Returns true if the push was delivered to at least one device.
  // sendLocalizedPushToUser returns false both when there are no tokens AND when
  // every provider send failed; we only enqueue when there was something to
  // retry, which we approximate by checking the recipient has tokens.
  function deliverChatPush(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    kind: string, recipientId: string, senderId: string, senderName: string,
    eventType: string, title: string, body: string, vars: any, data: { [k: string]: any }
  ): void {
    var delivered = false;
    try {
      delivered = LegacyPush.sendLocalizedPushToUser(
        ctx, logger, nk, recipientId, eventType, title, body, vars,
        { skipQuietHours: true, data: data }
      );
    } catch (e: any) {
      logger.warn("[Chat] chat push threw: %s", e && e.message ? e.message : String(e));
    }
    if (delivered) return;

    // Only worth retrying if the recipient actually has a registered device.
    // Otherwise there is nothing a retry could ever deliver to.
    if (!LegacyPush.userHasPushTokens(nk, recipientId)) return;

    var now = Math.floor(Date.now() / 1000);
    enqueueFailedPush(nk, logger, {
      kind: kind, recipientId: recipientId, senderId: senderId, senderName: senderName,
      eventType: eventType, title: title, body: body, data: data,
      retries: 0, lastAttempt: now, createdAt: now
    });
  }

  // ─── Read-state helpers ─────────────────────────────────────────────────────

  function dmConversationKey(otherUserId: string): string { return "dm:" + otherUserId; }
  function grpConversationKey(groupId: string): string { return "grp:" + groupId; }

  function readReadState(nk: nkruntime.Nakama, userId: string): ReadStateData {
    var data = Storage.readJson<ReadStateData>(nk, READ_STATE_COLLECTION, READ_STATE_KEY, userId);
    if (!data || !data.lastRead) return { lastRead: {} };
    return data;
  }

  function writeReadState(nk: nkruntime.Nakama, userId: string, data: ReadStateData): void {
    // Owner-only: read-state is private to the user. permRead=1 (owner), permWrite=0
    // (server-authoritative — clients update via mark_*_read RPCs, never directly).
    Storage.writeJson(nk, READ_STATE_COLLECTION, READ_STATE_KEY, userId, data, 1, 0);
  }

  // Set the read watermark for one conversation to nowMs (or an explicit value).
  function markConversationRead(nk: nkruntime.Nakama, userId: string, conversationKey: string, atMs?: number): void {
    var state = readReadState(nk, userId);
    var ts = (atMs !== undefined && atMs > 0) ? atMs : Date.now();
    // Never move the watermark backwards.
    if (!state.lastRead[conversationKey] || ts > state.lastRead[conversationKey]) {
      state.lastRead[conversationKey] = ts;
      writeReadState(nk, userId, state);
    }
  }

  // Convert a Nakama channel message's createTime to epoch ms. createTime comes
  // back as an RFC3339 string or {seconds} object depending on call path.
  function messageCreateMs(msg: any): number {
    if (!msg) return 0;
    var ct: any = msg.createTime;
    if (ct === undefined || ct === null) return 0;
    if (typeof ct === "number") return ct < 1e12 ? ct * 1000 : ct;
    if (typeof ct === "string") {
      var parsed = Date.parse(ct);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (typeof ct === "object" && ct.seconds !== undefined) {
      return Number(ct.seconds) * 1000;
    }
    return 0;
  }

  // Count messages in a channel created after the read watermark, authored by
  // someone other than `userId`. Capped at `cap` to bound work for very active
  // conversations (the client only needs "N" vs "N+").
  function countUnread(nk: nkruntime.Nakama, channelId: string, userId: string, sinceMs: number, cap: number): number {
    var unread = 0;
    var cursor = "";
    var pages = 0;
    try {
      do {
        // forward=false → newest first, so we can stop as soon as we cross the
        // watermark instead of scanning the whole history.
        var result: any = nk.channelMessagesList(channelId, 100, false, cursor);
        var msgs: any[] = (result && result.messages) ? result.messages : [];
        for (var i = 0; i < msgs.length; i++) {
          var msg = msgs[i];
          var ms = messageCreateMs(msg);
          if (ms <= sinceMs) return unread;            // reached read messages → done
          var sender = msg.senderId ? String(msg.senderId) : "";
          if (sender && sender === userId) continue;    // own messages aren't "unread"
          unread++;
          if (unread >= cap) return unread;
        }
        cursor = (result && result.nextCursor) ? result.nextCursor : "";
        pages++;
      } while (cursor && pages < 20);
    } catch (_) {}
    return unread;
  }

  // Fire a best-effort device push (APNs/FCM) for a direct message. Failures are
  // swallowed — chat delivery must never fail because the recipient has no token
  // or push is gated by quiet hours. Quiet hours ARE respected for chat.
  function pushDirectMessage(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    senderId: string, senderName: string, targetUserId: string, content: any
  ): void {
    try {
      var preview = buildPreview(content);
      var body = preview !== "" ? preview : (senderName + " sent you a message");
      // Chat is real-time conversation — bypass quiet hours so DMs always reach
      // the device (parity with WhatsApp/Telegram). Quiet hours still apply to
      // non-conversational pushes (daily quiz, reminders, etc.). On provider
      // failure the push is queued for retry by the scheduler.
      deliverChatPush(
        ctx, logger, nk, "direct", targetUserId, senderId, senderName,
        "direct_message", senderName, body, { name: senderName },
        { screen: "chat", chatType: "direct", fromUserId: senderId, sender_name: senderName }
      );
    } catch (e: any) {
      logger.warn("[Chat] direct message push failed: %s", e && e.message ? e.message : String(e));
    }
  }

  // Fire a best-effort device push to every other member of a group chat.
  function pushGroupMessage(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    senderId: string, senderName: string, groupId: string, content: any
  ): void {
    try {
      var groupName = "your group";
      try {
        var groups = nk.groupsGetId([groupId]);
        if (groups && groups.length > 0 && groups[0].name) groupName = String(groups[0].name);
      } catch (_) {}

      var preview = buildPreview(content);
      var body = preview !== ""
        ? (senderName + ": " + preview)
        : (senderName + " sent a message in " + groupName);

      var cursor = "";
      var notified = 0;
      // 2 = MEMBER, 1 = ADMIN, 0 = SUPERADMIN — notify all accepted members.
      // No member cap: every paginated member must receive the push. The old
      // `scanned < 500` guard silently dropped notifications for everyone past
      // the 500th member in large groups. We page until the cursor is exhausted.
      do {
        var page: any = nk.groupUsersList(groupId, 100, undefined, cursor);
        var members: any[] = (page && page.groupUsers) ? page.groupUsers : [];
        for (var i = 0; i < members.length; i++) {
          var m: any = members[i];
          // state 4 = pending join request; skip non-members.
          if (m.state !== undefined && m.state > 2) continue;
          var memberId = m.user && m.user.id ? String(m.user.id) : "";
          if (!memberId || memberId === senderId) continue;
          notified++;
          // Bypass quiet hours: group chat is real-time conversation. Failed
          // provider sends are queued for scheduler retry per recipient.
          deliverChatPush(
            ctx, logger, nk, "group", memberId, senderId, senderName,
            "group_message", groupName, body, { name: senderName, group: groupName },
            { screen: "chat", chatType: "group", groupId: groupId, fromUserId: senderId, sender_name: senderName }
          );
        }
        cursor = (page && page.cursor) ? page.cursor : "";
      } while (cursor);
      logger.info("[Chat] group push fan-out complete: groupId=%s notified=%d", groupId, notified);
    } catch (e: any) {
      logger.warn("[Chat] group message push failed: %s", e && e.message ? e.message : String(e));
    }
  }

  // After-hook for messages sent directly over the realtime socket
  // (ChannelMessageSend), as opposed to the RPC paths above. Server-side
  // nk.channelMessageSend() calls do NOT trigger this hook, so there is no
  // double-push risk with the RPCs. We read the resolved target from the
  // output ack (groupId / userIdOne / userIdTwo); the input channelId is opaque.
  function afterChannelMessageSend(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    output: nkruntime.EnvelopeChannelMessageSend | null, input: nkruntime.EnvelopeChannelMessageSend
  ): void {
    try {
      var ack: any = output ? (output as any).channelMessageSend : null;
      if (!ack) return;

      var senderId = ctx.userId || (ack.senderId ? String(ack.senderId) : "");
      if (!senderId) return;

      // Reconstruct message content from the input envelope for the preview.
      var content: any = "";
      try {
        var sent: any = input ? (input as any).channelMessageSend : null;
        if (sent && sent.content !== undefined) {
          content = (typeof sent.content === "string") ? JSON.parse(sent.content) : sent.content;
        }
      } catch (_) { content = ""; }

      var senderName = resolveSenderName(nk, senderId, ack.username ? String(ack.username) : (ctx.username || ""));

      var groupId = ack.groupId ? String(ack.groupId) : "";
      var userIdOne = ack.userIdOne ? String(ack.userIdOne) : "";
      var userIdTwo = ack.userIdTwo ? String(ack.userIdTwo) : "";

      if (groupId !== "") {
        // Group channel message.
        pushGroupMessage(ctx, logger, nk, senderId, senderName, groupId, content);
      } else if (userIdOne !== "" && userIdTwo !== "") {
        // Direct message (both user IDs must be set — `||` would admit a malformed ack
        // where one ID is missing, producing a wrong targetUserId calculation).
        var targetUserId = (userIdOne === senderId) ? userIdTwo : userIdOne;
        if (targetUserId && targetUserId !== senderId && !isSystemPayloadMessage(content)) {
          pushDirectMessage(ctx, logger, nk, senderId, senderName, targetUserId, content);
          // Ephemeral in-app socket notification (code 9001 = incoming_dm).
          // Delivered to recipient's connected socket without requiring channel join,
          // enabling real-time Social Zone badge/toast updates when chat screen is closed.
          try { nk.notificationSend(targetUserId, senderName, { screen: "chat", fromUserId: senderId, preview: buildPreview(content) }, 9001, senderId, false); } catch (_) {}
        }
      }
      // Room messages (roomName set) are intentionally not pushed to avoid broadcast spam.
    } catch (e: any) {
      logger.warn("[Chat] afterChannelMessageSend push failed: %s", e && e.message ? e.message : String(e));
    }
  }

  function rpcSendGroupChatMessage(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var username = ctx.username || "";
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      var content = data.content || data.message || data.messageText || "";
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var channelId = nk.channelIdBuild(userId, groupId, 3);
      var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
      var senderName = resolveSenderName(nk, userId, username);
      pushGroupMessage(ctx, logger, nk, userId, senderName, groupId, content);
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
      var content = data.content || data.message || data.messageText || "";
      if (!targetUserId) return RpcHelpers.errorResponse("userId required");
      var channelId = nk.channelIdBuild(userId, targetUserId, 2);
      var ack = nk.channelMessageSend(channelId, { body: content }, userId, username, true);
      var senderName = resolveSenderName(nk, userId, username);
      pushDirectMessage(ctx, logger, nk, userId, senderName, targetUserId, content);
      // Ephemeral in-app socket notification — delivered to recipient's connected socket
      // without requiring them to have joined the DM channel (code 9001 = incoming_dm).
      try { nk.notificationSend(targetUserId, senderName, { screen: "chat", fromUserId: userId, preview: buildPreview(content) }, 9001, userId, false); } catch (_) {}
      return RpcHelpers.successResponse({ messageId: ack.messageId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to send direct message");
    }
  }

  // ─── Pending offline message delivery ───────────────────────────────────────
  // Challenge messages are written to `pending_chat_messages` storage when the
  // Nakama channel send fails (recipient offline / channel not yet created).
  // This RPC is called by the Unity client once per session (on first socket
  // connect) to flush those queued messages into the DM channel. Messages are
  // deleted only after a confirmed delivery; failed items stay for next session.
  //
  // Registered as: quizverse_deliver_pending_chat_messages
  // ─────────────────────────────────────────────────────────────────────────────
  function rpcDeliverPendingChatMessages(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var delivered = 0;
      var cursor = "";
      var keysToDelete: nkruntime.StorageDeleteRequest[] = [];

      // Page through all pending records owned by this recipient.
      do {
        var page = nk.storageList(userId, "pending_chat_messages", 50, cursor);
        var objects: nkruntime.StorageObject[] = (page && page.objects) ? page.objects : [];
        cursor = (page && page.cursor) ? page.cursor : "";

        for (var i = 0; i < objects.length; i++) {
          var obj = objects[i];
          try {
            var msg: any = obj.value;
            var senderId: string   = msg && msg.senderId   ? String(msg.senderId)   : "";
            var senderName: string = msg && msg.senderName ? String(msg.senderName) : "";
            var content: any       = msg && msg.content    ? msg.content            : null;

            if (!senderId || !content) {
              // Corrupt record — remove it so it doesn't block future delivery.
              keysToDelete.push({ collection: "pending_chat_messages", key: obj.key, userId: userId });
              continue;
            }

            // nk.channelIdBuild sorts the two IDs internally, so A→B and B→A
            // produce the same channel — matches the ID Unity's client uses.
            var channelId = nk.channelIdBuild(senderId, userId, 2);

            // Re-deliver with the original sender identity (server-authoritative,
            // no active session required for the sender).
            // content was stored as a JS object; cast to the required map type.
            var msgObj: { [key: string]: any } = (typeof content === "object" && content !== null)
              ? content as { [key: string]: any }
              : { body: String(content) };
            nk.channelMessageSend(channelId, msgObj, senderId, senderName, true);
            keysToDelete.push({ collection: "pending_chat_messages", key: obj.key, userId: userId });
            delivered++;
          } catch (itemErr: any) {
            // Keep the record — it will be retried on the next session connect.
            logger.warn("[Chat] Pending message delivery failed for key %s: %s",
              obj.key, itemErr && itemErr.message ? itemErr.message : String(itemErr));
          }
        }
      } while (cursor && cursor !== "");

      // Best-effort delete of successfully delivered records.
      if (keysToDelete.length > 0) {
        try { nk.storageDelete(keysToDelete); } catch (delErr: any) {
          logger.warn("[Chat] Failed to delete %d delivered pending records: %s",
            keysToDelete.length, delErr && delErr.message ? delErr.message : String(delErr));
        }
      }

      if (delivered > 0) {
        logger.info("[Chat] Delivered %d pending chat messages for user %s", delivered, userId);
      }
      return RpcHelpers.successResponse({ delivered: delivered });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e && e.message ? e.message : "Failed to deliver pending messages");
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
      // Optional explicit watermark (ms). Defaults to now — i.e. "I've read
      // everything up to this moment in the conversation with targetUserId".
      var atMs = (data.upToMs !== undefined) ? Number(data.upToMs) : (data.atMs !== undefined ? Number(data.atMs) : 0);
      markConversationRead(nk, userId, dmConversationKey(String(targetUserId)), atMs);
      return RpcHelpers.successResponse({ success: true, userId: targetUserId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to mark messages read");
    }
  }

  function rpcMarkGroupMessagesRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var groupId = data.groupId;
      if (!groupId) return RpcHelpers.errorResponse("groupId required");
      var atMs = (data.upToMs !== undefined) ? Number(data.upToMs) : (data.atMs !== undefined ? Number(data.atMs) : 0);
      markConversationRead(nk, userId, grpConversationKey(String(groupId)), atMs);
      return RpcHelpers.successResponse({ success: true, groupId: groupId });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to mark group messages read");
    }
  }

  // Return unread counts for the conversations the client asks about. Payload:
  //   { directUserIds?: string[], groupIds?: string[], cap?: number }
  // Response: { direct: { <userId>: count }, group: { <groupId>: count }, total }
  // Counts are derived from per-conversation read watermarks vs. channel history,
  // so they survive app restarts and are consistent across devices.
  function rpcGetUnreadCounts(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var directIds: string[] = data.directUserIds || data.userIds || [];
      var groupIds: string[] = data.groupIds || [];
      var cap = (data.cap && data.cap > 0) ? Math.min(Number(data.cap), 999) : 99;

      var state = readReadState(nk, userId);
      var direct: { [k: string]: number } = {};
      var group: { [k: string]: number } = {};
      var total = 0;

      for (var i = 0; i < directIds.length; i++) {
        var other = String(directIds[i]);
        if (!other) continue;
        var dKey = dmConversationKey(other);
        var dSince = state.lastRead[dKey] || 0;
        var dChannel = nk.channelIdBuild(userId, other, 2);
        var dCount = countUnread(nk, dChannel, userId, dSince, cap);
        direct[other] = dCount;
        total += dCount;
      }

      for (var j = 0; j < groupIds.length; j++) {
        var gid = String(groupIds[j]);
        if (!gid) continue;
        var gKey = grpConversationKey(gid);
        var gSince = state.lastRead[gKey] || 0;
        var gChannel = nk.channelIdBuild(userId, gid, 3);
        var gCount = countUnread(nk, gChannel, userId, gSince, cap);
        group[gid] = gCount;
        total += gCount;
      }

      return RpcHelpers.successResponse({ direct: direct, group: group, total: total });
    } catch (e: any) {
      return RpcHelpers.errorResponse(e.message || "Failed to get unread counts");
    }
  }

  // ─── Failed-push flush (called by the notification scheduler) ───────────────
  // Walks the per-recipient failed-push index and replays provider sends for
  // rows that are due (throttled) and under the retry/TTL limits. Successful or
  // exhausted rows are removed; recipients with no remaining rows drop out of
  // the index. Mirrors LegacyPush.flushPendingRegistrations' index pattern.
  export function flushFailedChatPushes(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    try {
      var indexObjs = nk.storageRead([{ collection: FAILED_PUSH_INDEX_COLLECTION, key: FAILED_PUSH_INDEX_KEY, userId: Constants.SYSTEM_USER_ID }]);
      var recipientIds: string[] = (indexObjs && indexObjs.length > 0 && indexObjs[0].value && (indexObjs[0].value as any).userIds)
        ? ((indexObjs[0].value as any).userIds as string[]) : [];
      if (!recipientIds || recipientIds.length === 0) return;

      var now = Math.floor(Date.now() / 1000);
      var remaining: string[] = [];

      for (var u = 0; u < recipientIds.length; u++) {
        var rid = recipientIds[u];
        try {
          var rec = Storage.readJson<{ rows: FailedPushRow[] }>(nk, FAILED_PUSH_COLLECTION, rid, Constants.SYSTEM_USER_ID);
          var rows: FailedPushRow[] = (rec && rec.rows) ? rec.rows : [];
          var keep: FailedPushRow[] = [];

          for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            // Drop rows that are too old or maxed out on retries.
            if ((now - row.createdAt) > FAILED_PUSH_TTL_SEC) continue;
            if ((row.retries || 0) >= FAILED_PUSH_MAX_RETRIES) {
              logger.warn("[Chat] failed-push maxed retries — dropping. recipient=%s eventType=%s", rid, row.eventType);
              continue;
            }
            // Throttle: don't replay the same row too aggressively.
            if (row.lastAttempt && (now - row.lastAttempt) < FAILED_PUSH_RETRY_INTERVAL_SEC) {
              keep.push(row);
              continue;
            }

            var ok = false;
            try {
              ok = LegacyPush.retryChatProviderPush(ctx, logger, nk, row.recipientId, row.eventType, row.title, row.body, row.data);
            } catch (_) { ok = false; }

            if (ok) {
              logger.info("[Chat] failed-push retry SUCCESS. recipient=%s eventType=%s attempt=%d", rid, row.eventType, (row.retries || 0) + 1);
              continue; // delivered → drop
            }
            row.retries = (row.retries || 0) + 1;
            row.lastAttempt = now;
            // If the recipient no longer has any device, stop retrying.
            if (!LegacyPush.userHasPushTokens(nk, rid)) continue;
            keep.push(row);
          }

          if (keep.length > 0) {
            Storage.writeJson(nk, FAILED_PUSH_COLLECTION, rid, Constants.SYSTEM_USER_ID, { rows: keep }, 0, 0);
            remaining.push(rid);
          } else {
            try { nk.storageDelete([{ collection: FAILED_PUSH_COLLECTION, key: rid, userId: Constants.SYSTEM_USER_ID }]); } catch (_) {}
          }
        } catch (ue: any) {
          logger.warn("[Chat] flushFailedChatPushes: error for recipient=%s (will retry): %s", rid, ue && ue.message ? ue.message : String(ue));
          remaining.push(rid); // keep so next tick retries
        }
      }

      nk.storageWrite([{
        collection: FAILED_PUSH_INDEX_COLLECTION, key: FAILED_PUSH_INDEX_KEY, userId: Constants.SYSTEM_USER_ID,
        value: { userIds: remaining }, permissionRead: 0, permissionWrite: 0
      }]);
      logger.info("[Chat] flushFailedChatPushes done. recipients with backlog: %d", remaining.length);
    } catch (e: any) {
      logger.error("[Chat] flushFailedChatPushes exception: %s", e && e.message ? e.message : String(e));
    }
  }

  // ─── Message hygiene guardrails (length cap + light spam throttle) ─────────
  // Nothing upstream of this hook validates the raw socket payload, so one
  // bad client or a buggy retry loop could persist huge/flood messages.
  // Throwing here is the documented Nakama pattern for rejecting a realtime
  // before-hook — the client gets the error back, the send never lands.
  var MAX_MESSAGE_CHARS = 4000;
  var CHAT_RATE_MAX = 10;           // messages
  var CHAT_RATE_WINDOW_SEC = 10;     // per this many seconds, per user

  function enforceChatHygiene(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    content: string
  ): void {
    if (content.length > MAX_MESSAGE_CHARS) {
      throw new Error("Message too long (max " + MAX_MESSAGE_CHARS + " characters).");
    }

    // Nakama executes handlers across a Goja VM pool (and multiple pods in
    // production), so module-local counters are not authoritative. Use the
    // shared storage-backed limiter to enforce one contract everywhere.
    var decision = SharedRateLimit.checkUserWindow(
      ctx,
      nk,
      "channel_message_send",
      CHAT_RATE_WINDOW_SEC,
      CHAT_RATE_MAX
    );
    if (!decision.allowed) {
      throw new Error("You're sending messages too fast — slow down.");
    }
  }

  // Before-hook for realtime ChannelMessageSend. Forces persist=true so every
  // chat message is written to channel history. Without persistence the message
  // is only delivered to currently-connected sockets — offline recipients never
  // see it, unread counts can't be derived, and history RPCs return nothing.
  // Clients sometimes omit `persist` or send it false; we override server-side
  // so durability is not client-dependent.
  function beforeChannelMessageSend(
    ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama,
    envelope: nkruntime.EnvelopeChannelMessageSend
  ): nkruntime.EnvelopeChannelMessageSend | void {
    var msg: any = envelope ? (envelope as any).channelMessageSend : null;
    if (msg) {
      enforceChatHygiene(ctx, nk, String(msg.content || ""));
      try {
        msg.persist = true;
      } catch (e: any) {
        logger.warn("[Chat] beforeChannelMessageSend failed to force persist: %s", e && e.message ? e.message : String(e));
      }
    }
    return envelope;
  }

  function registerRealtimeHooks(initializer: nkruntime.Initializer): void {
    initializer.registerRtBefore("ChannelMessageSend", beforeChannelMessageSend);
    initializer.registerRtAfter("ChannelMessageSend", afterChannelMessageSend);
  }

  export function register(initializer: nkruntime.Initializer): void {
    // withCleanAuthError wraps a handler once at registration time, but when
    // register() is auto-invoked at IIFE scope by the postbuild script,
    // RpcHelpers may not be initialised yet — it lives in a later IIFE and
    // 'legacy' sorts before 'shared' on Linux (case-sensitive readdir), so an
    // eager RpcHelpers.withCleanAuthError(...) here throws at startup and
    // takes down the entire JS runtime (deploy gha66 failure). Use a lazy
    // wrapper (same pattern as hermes.ts / quests/quest_engine.ts) so the
    // wrap is deferred to first-call time.
    type StrictRpc = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string;
    function auth(fn: nkruntime.RpcFunction): nkruntime.RpcFunction {
      var wrapped: StrictRpc | null = null;
      return function(ctx, logger, nk, payload): string {
        if (!wrapped) {
          const strictFn = fn as StrictRpc;
          wrapped = (typeof RpcHelpers !== "undefined" && RpcHelpers.withCleanAuthError)
            ? RpcHelpers.withCleanAuthError(strictFn)
            : strictFn;
        }
        return wrapped(ctx, logger, nk, payload);
      };
    }
    initializer.registerRpc("send_group_chat_message", rpcSendGroupChatMessage);
    initializer.registerRpc("send_direct_message", rpcSendDirectMessage);
    initializer.registerRpc("send_chat_room_message", rpcSendChatRoomMessage);
    // Delivers queued offline challenge messages; Unity calls this once per session.
    // withCleanAuthError: live-server smoke test (2026-07-09) found this + the two
    // read/unread RPCs below throwing a raw Goja 500 for unauthenticated callers
    // instead of the clean JSON every other chat RPC in this file returns — belt
    // and suspenders on top of each handler's own try/catch.
    initializer.registerRpc("quizverse_deliver_pending_chat_messages", auth(rpcDeliverPendingChatMessages));
    initializer.registerRpc("get_group_chat_history", rpcGetGroupChatHistory);
    initializer.registerRpc("get_direct_message_history", rpcGetDirectMessageHistory);
    initializer.registerRpc("get_chat_room_history", rpcGetChatRoomHistory);
    initializer.registerRpc("mark_direct_messages_read", rpcMarkDirectMessagesRead);
    initializer.registerRpc("mark_group_messages_read", auth(rpcMarkGroupMessagesRead));
    initializer.registerRpc("get_unread_counts", auth(rpcGetUnreadCounts));

    // Force durable persistence for realtime chat (offline delivery + history +
    // unread counts), then push-notify after the message lands. postbuild also
    // invokes register() without an initializer on every pooled Goja VM to bind
    // RPC stubs; only the real InitModule call may install realtime hooks.
    if (initializer) registerRealtimeHooks(initializer);
  }
}
