namespace SatoriMessages {

  function getMessageDefinitions(nk: nkruntime.Nakama): { [id: string]: Satori.MessageDefinition } {
    var raw = ConfigLoader.loadSatoriConfig<any>(nk, "messages", {});
    return raw && raw.messages ? raw.messages : raw;
  }

  function getUserMessages(nk: nkruntime.Nakama, userId: string): Satori.UserMessages {
    var data = Storage.readJson<Satori.UserMessages>(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId);
    return data || { messages: [] };
  }

  function saveUserMessages(nk: nkruntime.Nakama, userId: string, data: Satori.UserMessages): void {
    Storage.writeJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "inbox", userId, data);
  }

  export function deliverMessage(nk: nkruntime.Nakama, userId: string, messageDef: Satori.MessageDefinition): void {
    var inbox = getUserMessages(nk, userId);

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
    saveUserMessages(nk, userId, inbox);
  }

  export function deliverToAudience(nk: nkruntime.Nakama, logger: nkruntime.Logger, messageDef: Satori.MessageDefinition, audienceId: string): number {
    var delivered = 0;
    try {
      var explicitIds = SatoriAudiences.getExplicitIncludeIds(nk, audienceId);
      for (var explicitIndex = 0; explicitIndex < explicitIds.length; explicitIndex++) {
        if (SatoriAudiences.isInAudience(nk, explicitIds[explicitIndex], audienceId)) {
          deliverMessage(nk, explicitIds[explicitIndex], messageDef);
          delivered++;
        }
      }
      if (delivered > 0) return delivered;

      var users = nk.usersGetRandom(100);
      for (var i = 0; i < users.length; i++) {
        if (SatoriAudiences.isInAudience(nk, users[i].userId, audienceId)) {
          deliverMessage(nk, users[i].userId, messageDef);
          delivered++;
        }
      }
    } catch (e: any) {
      logger.warn("deliverToAudience error: %s", e.message || String(e));
    }
    return delivered;
  }

  export function processScheduledMessages(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    var definitions = getMessageDefinitions(nk);
    var now = Math.floor(Date.now() / 1000);

    for (var id in definitions) {
      var def = definitions[id];
      if (!def.scheduleAt || def.scheduleAt > now) continue;

      var deliveryState = Storage.readSystemJson<{ delivered: boolean }>(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id);
      if (deliveryState && deliveryState.delivered) continue;

      if (def.audienceId) {
        deliverToAudience(nk, logger, def, def.audienceId);
      }

      Storage.writeSystemJson(nk, Constants.SATORI_MESSAGES_COLLECTION, "schedule_" + id, { delivered: true, deliveredAt: now });
      logger.info("Delivered scheduled message: %s", id);
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

    processScheduledMessages(nk, logger);

    var inbox = getUserMessages(nk, userId);
    inbox = purgeExpired(inbox);
    saveUserMessages(nk, userId, inbox);

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

    var inbox = getUserMessages(nk, userId);
    var msg: Satori.UserMessage | undefined;
    for (var i = 0; i < inbox.messages.length; i++) {
      if (inbox.messages[i].id === data.messageId) { msg = inbox.messages[i]; break; }
    }
    if (!msg) return RpcHelpers.errorResponse("Message not found");

    if (!msg.readAt) {
      msg.readAt = Math.floor(Date.now() / 1000);
      saveUserMessages(nk, userId, inbox);
    }

    var reward: Hiro.ResolvedReward | null = null;
    if (msg.reward && !msg.consumedAt) {
      reward = RewardEngine.resolveReward(nk, msg.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
      msg.consumedAt = Math.floor(Date.now() / 1000);
      saveUserMessages(nk, userId, inbox);
    }

    return RpcHelpers.successResponse({ message: msg, reward: reward });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.messageId) return RpcHelpers.errorResponse("messageId required");

    var inbox = getUserMessages(nk, userId);
    inbox.messages = inbox.messages.filter(function (m) { return m.id !== data.messageId; });
    saveUserMessages(nk, userId, inbox);

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcBroadcast(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.title) return RpcHelpers.errorResponse("title required");

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

    if (audienceId && !scheduleAt) {
      var delivered = deliverToAudience(nk, logger, msgDef, audienceId);
      return RpcHelpers.successResponse({ delivered: delivered, audienceId: audienceId });
    }

    var definitions = getMessageDefinitions(nk);
    definitions[msgDef.id] = msgDef;
    ConfigLoader.saveSatoriConfig(nk, "messages", definitions);
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
