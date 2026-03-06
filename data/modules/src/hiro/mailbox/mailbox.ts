namespace HiroMailbox {

  function getUserMailbox(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserMailbox {
    var data = Storage.readJson<Hiro.UserMailbox>(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId);
    return data || { messages: [] };
  }

  function saveUserMailbox(nk: nkruntime.Nakama, userId: string, data: Hiro.UserMailbox, gameId?: string): void {
    Storage.writeJson(nk, Constants.HIRO_MAILBOX_COLLECTION, Constants.gameKey(gameId, "inbox"), userId, data);
  }

  function purgeExpired(mailbox: Hiro.UserMailbox): Hiro.UserMailbox {
    var now = Math.floor(Date.now() / 1000);
    mailbox.messages = mailbox.messages.filter(function (m) {
      return !m.expiresAt || m.expiresAt > now;
    });
    return mailbox;
  }

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var mailbox = getUserMailbox(nk, userId, data.gameId);
    mailbox = purgeExpired(mailbox);
    saveUserMailbox(nk, userId, mailbox, data.gameId);

    return RpcHelpers.successResponse({ messages: mailbox.messages });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.messageId) return RpcHelpers.errorResponse("messageId required");

    var mailbox = getUserMailbox(nk, userId, data.gameId);
    mailbox = purgeExpired(mailbox);
    var msg = mailbox.messages.find(function (m) { return m.id === data.messageId; });
    if (!msg) return RpcHelpers.errorResponse("Message not found");
    if (msg.claimedAt) return RpcHelpers.errorResponse("Already claimed");

    var reward: Hiro.ResolvedReward | null = null;
    if (msg.reward) {
      reward = RewardEngine.resolveReward(nk, msg.reward);
      RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
    }

    msg.claimedAt = Math.floor(Date.now() / 1000);
    msg.readAt = msg.readAt || msg.claimedAt;
    saveUserMailbox(nk, userId, mailbox, data.gameId);

    return RpcHelpers.successResponse({ reward: reward });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.messageId) return RpcHelpers.errorResponse("messageId required");

    var mailbox = getUserMailbox(nk, userId, data.gameId);
    mailbox.messages = mailbox.messages.filter(function (m) { return m.id !== data.messageId; });
    saveUserMailbox(nk, userId, mailbox, data.gameId);

    return RpcHelpers.successResponse({ success: true });
  }

  function rpcClaimAll(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var mailbox = getUserMailbox(nk, userId, data.gameId);
    mailbox = purgeExpired(mailbox);
    var now = Math.floor(Date.now() / 1000);
    var claimed = 0;

    for (var i = 0; i < mailbox.messages.length; i++) {
      var msg = mailbox.messages[i];
      if (!msg.claimedAt && msg.reward) {
        var reward = RewardEngine.resolveReward(nk, msg.reward);
        RewardEngine.grantReward(nk, logger, ctx, userId, data.gameId || "default", reward);
        msg.claimedAt = now;
        msg.readAt = msg.readAt || now;
        claimed++;
      }
    }

    saveUserMailbox(nk, userId, mailbox, data.gameId);
    return RpcHelpers.successResponse({ claimed: claimed });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_mailbox_list", rpcList);
    initializer.registerRpc("hiro_mailbox_claim", rpcClaim);
    initializer.registerRpc("hiro_mailbox_claim_all", rpcClaimAll);
    initializer.registerRpc("hiro_mailbox_delete", rpcDelete);
  }
}
