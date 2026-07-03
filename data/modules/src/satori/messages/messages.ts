namespace SatoriMessages {

  function getMessageDefinitions(nk: nkruntime.Nakama, gameId?: string): { [id: string]: Satori.MessageDefinition } {
    var raw = ConfigLoader.loadSatoriConfigForGame<any>(nk, "messages", gameId, {});
    return raw && raw.messages ? raw.messages : raw;
  }

  function getUserMessages(nk: nkruntime.Nakama, userId: string, gameId?: string): Satori.UserMessages {
    var data = Storage.readJson<Satori.UserMessages>(nk, Constants.SATORI_MESSAGES_COLLECTION, Constants.gameKey(gameId, "inbox"), userId);
    return data || { messages: [] };
  }

  function saveUserMessages(nk: nkruntime.Nakama, userId: string, data: Satori.UserMessages, gameId?: string): void {
    Storage.writeJson(nk, Constants.SATORI_MESSAGES_COLLECTION, Constants.gameKey(gameId, "inbox"), userId, data);
  }

  export function deliverMessage(nk: nkruntime.Nakama, userId: string, messageDef: Satori.MessageDefinition, gameId?: string): void {
    var inbox = getUserMessages(nk, userId, gameId);

    var alreadyDelivered = false;
    for (var i = 0; i < inbox.messages.length; i++) {
      if (inbox.messages[i].messageDefId === messageDef.id) {
        alreadyDelivered = true;
        break;
      }
    }
    if (alreadyDelivered) return;

    var msg: Satori.UserMessage = {
      id: nk.uuidv4(),
      messageDefId: messageDef.id,
      title: messageDef.title,
      body: messageDef.body,
      imageUrl: messageDef.imageUrl,
      metadata: messageDef.metadata,
      reward: messageDef.reward,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: messageDef.expiresAt
    };
    inbox.messages.push(msg);
    saveUserMessages(nk, userId, inbox, gameId);
  }

  export function deliverToAudience(nk: nkruntime.Nakama, logger: nkruntime.Logger, messageDef: Satori.MessageDefinition, audienceId: string, gameId?: string): number {
    var delivered = 0;
    try {
      // 1. Explicit include-list first (admin-pinned users always get it)
      var explicitIds = SatoriAudiences.getExplicitIncludeIds(nk, audienceId, gameId);
      for (var ei = 0; ei < explicitIds.length; ei++) {
        if (SatoriAudiences.isInAudience(nk, explicitIds[ei], audienceId, gameId)) {
          deliverMessage(nk, explicitIds[ei], messageDef, gameId);
          delivered++;
        }
      }
      if (delivered > 0) return delivered;

      // 2. Check if audience has property-based rules.
      //    If yes, scan satori_identity_props (users who sent events) — they have
      //    the properties needed to evaluate the rule correctly.
      //    If no rules (e.g. all_players), fall back to random Nakama users.
      var audienceDef = SatoriAudiences.getDefinition(nk, audienceId, gameId);
      var hasRuleFilters = audienceDef &&
        audienceDef.rule &&
        audienceDef.rule.filters &&
        audienceDef.rule.filters.length > 0;

      if (hasRuleFilters) {
        // Scan identity props pages (up to 500 users = 5 pages × 100)
        var cursor = "";
        var PAGE_SIZE = 100;
        var MAX_PAGES = 5;
        for (var p = 0; p < MAX_PAGES; p++) {
          var page = nk.storageList(null, Constants.SATORI_IDENTITY_COLLECTION, PAGE_SIZE, cursor);
          var objects = (page && page.objects) || [];
          for (var oi = 0; oi < objects.length; oi++) {
            var obj = objects[oi];
            if (obj.key !== "props" || !obj.userId) continue;
            if (SatoriAudiences.isInAudience(nk, obj.userId, audienceId, gameId)) {
              deliverMessage(nk, obj.userId, messageDef, gameId);
              delivered++;
            }
          }
          cursor = (page && page.cursor) || "";
          if (!cursor) break;
        }
      } else {
        // No property rules — audience is open (e.g. all_players).
        // Use random nakama users (covers users without identity props too).
        var users = nk.usersGetRandom(100);
        for (var i = 0; i < users.length; i++) {
          if (SatoriAudiences.isInAudience(nk, users[i].userId, audienceId, gameId)) {
            deliverMessage(nk, users[i].userId, messageDef, gameId);
            delivered++;
          }
        }
      }
    } catch (e: any) {
      logger.warn("deliverToAudience error: %s", e.message || String(e));
    }
    return delivered;
  }

  export function processScheduledMessages(nk: nkruntime.Nakama, logger: nkruntime.Logger, gameId?: string): void {
    var definitions = getMessageDefinitions(nk, gameId);
    var now = Math.floor(Date.now() / 1000);

    for (var id in definitions) {
      var def = definitions[id];
      if (!def.scheduleAt || def.scheduleAt > now) continue;

      var deliveryState = Storage.readSystemJson<{ delivered: boolean }>(nk, Constants.SATORI_MESSAGES_COLLECTION, Constants.gameKey(gameId, "schedule_" + id));
      if (deliveryState && deliveryState.delivered) continue;

      var scheduledDelivered = 0;
      if (def.audienceId) {
        scheduledDelivered = deliverToAudience(nk, logger, def, def.audienceId, gameId);
      } else {
        // No audience filter = "all players": same random-sample delivery as
        // the immediate-send path, so scheduled broadcasts actually go out.
        var sampled = nk.usersGetRandom(100);
        for (var si = 0; si < sampled.length; si++) {
          deliverMessage(nk, sampled[si].userId, def, gameId);
          scheduledDelivered++;
        }
      }

      // Mark message as sent in definitions
      (def as any).status = "sent";
      (def as any).deliveredCount = scheduledDelivered;
      (def as any).sentAt = now;
      definitions[id] = def;
      ConfigLoader.saveSatoriConfigForGame(nk, "messages", gameId, definitions);

      Storage.writeSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, Constants.gameKey(gameId, "schedule_" + id), { delivered: true, deliveredAt: now, count: scheduledDelivered });
      logger.info("Delivered scheduled message: %s count=%d", id, scheduledDelivered);
    }
  }

  function purgeExpired(inbox: Satori.UserMessages): Satori.UserMessages {
    var now = Math.floor(Date.now() / 1000);
    inbox.messages = inbox.messages.filter(function (m) {
      return !m.expiresAt || m.expiresAt > now;
    });
    return inbox;
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);

    processScheduledMessages(nk, logger, gameId);

    var inbox = getUserMessages(nk, userId, gameId);
    inbox = purgeExpired(inbox);
    saveUserMessages(nk, userId, inbox, gameId);

    return RpcHelpers.successResponse({
      messages: inbox.messages.map(function (m) {
        return {
          id: m.id,
          title: m.title,
          body: m.body,
          imageUrl: m.imageUrl,
          metadata: m.metadata,
          hasReward: !!m.reward,
          createdAt: m.createdAt,
          expiresAt: m.expiresAt,
          readAt: m.readAt,
          consumedAt: m.consumedAt
        };
      })
    });
  }

  function rpcRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.messageId) return RpcHelpers.errorResponse("messageId required");
    var gameId = RpcHelpers.gameId(data);

    var inbox = getUserMessages(nk, userId, gameId);
    var msg: Satori.UserMessage | undefined;
    for (var i = 0; i < inbox.messages.length; i++) {
      if (inbox.messages[i].id === data.messageId) { msg = inbox.messages[i]; break; }
    }
    if (!msg) return RpcHelpers.errorResponse("Message not found");

    if (!msg.readAt) {
      msg.readAt = Math.floor(Date.now() / 1000);
      saveUserMessages(nk, userId, inbox, gameId);
    }

    var reward: Hiro.ResolvedReward | null = null;
    if (msg.reward && !msg.consumedAt) {
      reward = RewardEngine.resolveReward(nk, msg.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, gameId || "default", reward);
      msg.consumedAt = Math.floor(Date.now() / 1000);
      saveUserMessages(nk, userId, inbox, gameId);
    }

    return RpcHelpers.successResponse({ message: msg, reward: reward });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.messageId) return RpcHelpers.errorResponse("messageId required");
    var gameId = RpcHelpers.gameId(data);

    var inbox = getUserMessages(nk, userId, gameId);
    inbox.messages = inbox.messages.filter(function (m) { return m.id !== data.messageId; });
    saveUserMessages(nk, userId, inbox, gameId);

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcBroadcast(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.title) return RpcHelpers.errorResponse("title required");
    var gameId = RpcHelpers.gameId(data);

    var now = Math.floor(Date.now() / 1000);
    var scheduleAt = data.scheduleAt || data.schedule_at;
    var audienceId = data.audienceId || data.audience_id;
    var reward = data.reward;
    if (!reward && data.rewards_json) {
      try { reward = JSON.parse(data.rewards_json); } catch (_) { reward = undefined; }
    }
    var msgDef: Satori.MessageDefinition = {
      id: data.id || nk.uuidv4(),
      title: data.title,
      body: data.body,
      imageUrl: data.imageUrl,
      metadata: data.metadata,
      reward: reward,
      audienceId: audienceId,
      scheduleAt: scheduleAt,
      expiresAt: data.expiresAt,
      createdAt: now
    };

    if (!scheduleAt) {
      // No schedule → send immediately, regardless of whether an audience is specified.
      var delivered = 0;
      if (audienceId) {
        delivered = deliverToAudience(nk, logger, msgDef, audienceId, gameId);
      } else {
        // "All players (no filter)": deliver to a random sample of up to 100 current users.
        var allUsers = nk.usersGetRandom(100);
        for (var ui = 0; ui < allUsers.length; ui++) {
          deliverMessage(nk, allUsers[ui].userId, msgDef, gameId);
          delivered++;
        }
      }
      // Persist message with sent status so it appears in admin history.
      var definitions = getMessageDefinitions(nk, gameId);
      (msgDef as any).status = "sent";
      (msgDef as any).deliveredCount = delivered;
      (msgDef as any).sentAt = now;
      definitions[msgDef.id] = msgDef;
      ConfigLoader.saveSatoriConfigForGame(nk, "messages", gameId, definitions);
      return RpcHelpers.successResponse({ delivered: delivered, audienceId: audienceId || "all", messageId: msgDef.id });
    }

    var definitions = getMessageDefinitions(nk, gameId);
    (msgDef as any).status = "scheduled";
    definitions[msgDef.id] = msgDef;
    ConfigLoader.saveSatoriConfigForGame(nk, "messages", gameId, definitions);
    return RpcHelpers.successResponse({ scheduled: true, messageId: msgDef.id });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_messages_list", rpcList);
    initializer.registerRpc("satori_messages_read", rpcRead);
    initializer.registerRpc("satori_messages_delete", rpcDelete);
    initializer.registerRpc("satori_messages_broadcast", rpcBroadcast);
    // 2026-04 backward-compat alias: shared admin SDK calls singular
    // "satori_message_broadcast". Map it to the same broadcast handler.
    initializer.registerRpc("satori_message_broadcast", rpcBroadcast);
  }
}
