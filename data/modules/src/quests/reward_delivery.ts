// ─────────────────────────────────────────────────────────────────────────────
// RewardDelivery — server-driven reward fulfilment + player notification layer.
//
// Solves the "client must never change" requirement: what a reward IS (title,
// message, digital asset URL, delivery channel) lives in a per-game Reward
// Catalog in Nakama storage, managed from the admin dashboard / RPCs. When the
// Quest Engine grants a reward it calls onQuestReward() here, which:
//
//   1. Sends a persistent Nakama in-app notification to the player (real-time
//      via socket when online, inbox-delivered on next login when offline).
//      Subject/body come from quest + catalog config — never from client code.
//   2. For catalog entries with deliver.channel = "email": sends the digital
//      asset (video/audiobook/anything with a URL) through the self-hosted
//      Notifuse transactional API using ONE generic template; per-reward
//      content is template data, so a brand-new reward type needs zero new
//      templates and zero client work.
//   3. Writes a per-user delivery ledger ("My Rewards" history) that clients
//      read via reward_delivery_list_mine.
//   4. Fires a Discord ops alert (reuses DISCORD_QV_OPS_WEBHOOK_URL) so the
//      team sees QUEST COMPLETED / DELIVERY FAILED events live.
//
// Runtime env consumed (nakama-secret config.yaml → runtime.env):
//   NOTIFUSE_API_URL              (default https://notifuse.intelli-verse-x.ai)
//   NOTIFUSE_SECRET_KEY           (HMAC root sign-in secret — required for email)
//   NOTIFUSE_ROOT_EMAIL           (default admin@intelli-verse-x.ai)
//   NOTIFUSE_WORKSPACE            (default intelliversex)
//   NOTIFUSE_REWARD_NOTIFICATION  (default qx_reward_delivery — generic template)
//   DISCORD_QV_OPS_WEBHOOK_URL    (optional ops alerts)
// ─────────────────────────────────────────────────────────────────────────────

namespace RewardDelivery {

  // ─── Types ────────────────────────────────────────────────────────────────

  export interface CatalogEntry {
    // Binds to a currency id or item id used in quest rewards
    // (e.g. "simli_video_credit", "jimmy_video", "audiobook_credit").
    id: string;
    title: string;
    // Player-facing message used in the notification + email body.
    message?: string;
    // Direct link to the digital asset (S3 MP4, audiobook, coupon page, …).
    assetUrl?: string;
    // Optional call-to-action label for the email button (default "Open reward").
    ctaLabel?: string;
    // How the asset is fulfilled. "email" → Notifuse transactional send;
    // "none" (default) → in-app notification + ledger only.
    deliver?: { channel: "email" | "none"; notificationId?: string };
    icon?: string;
  }

  interface Catalog { rewards: { [rewardId: string]: CatalogEntry } }

  interface DeliveryRecord {
    ts: number;
    questId: string;
    rewardId: string;
    title: string;
    status: "notified" | "delivered" | "pending_email" | "failed";
    channel: "inapp" | "email";
    email?: string;
    assetUrl?: string;
    detail?: string;
  }

  // ─── Constants ────────────────────────────────────────────────────────────

  var CATALOG_COLLECTION = "qx_reward_catalog";     // key = gameId (system-owned)
  var LEDGER_COLLECTION = "qx_reward_deliveries";   // key = gameId, per-user owner-read
  var PROFILE_COLLECTION = "qx_delivery_profile";   // key = "profile", per-user
  var NOTIFICATION_CODE_REWARD = 9101;
  var MAX_LEDGER_ENTRIES = 200;

  function isAdminCaller(ctx: nkruntime.Context): boolean {
    return !ctx.userId || ctx.userId === Constants.SYSTEM_USER_ID;
  }

  // ─── Catalog storage ──────────────────────────────────────────────────────

  export function loadCatalog(nk: nkruntime.Nakama, gameId: string): Catalog {
    try {
      var rows = nk.storageRead([{ collection: CATALOG_COLLECTION, key: gameId, userId: Constants.SYSTEM_USER_ID }]);
      if (rows.length > 0 && rows[0].value) {
        var v: any = rows[0].value;
        if (v && v.rewards) return v as Catalog;
      }
    } catch (e: any) {
      // fall through to empty catalog
    }
    return { rewards: {} };
  }

  function saveCatalog(nk: nkruntime.Nakama, gameId: string, catalog: Catalog): void {
    nk.storageWrite([{
      collection: CATALOG_COLLECTION,
      key: gameId,
      userId: Constants.SYSTEM_USER_ID,
      value: catalog as any,
      permissionRead: 2,
      permissionWrite: 0
    }]);
  }

  // ─── Delivery ledger ──────────────────────────────────────────────────────

  function loadLedger(nk: nkruntime.Nakama, userId: string, gameId: string): DeliveryRecord[] {
    try {
      var rows = nk.storageRead([{ collection: LEDGER_COLLECTION, key: gameId, userId: userId }]);
      if (rows.length > 0 && rows[0].value && (rows[0].value as any).entries) {
        return (rows[0].value as any).entries as DeliveryRecord[];
      }
    } catch (e: any) { /* empty ledger */ }
    return [];
  }

  function appendLedger(nk: nkruntime.Nakama, userId: string, gameId: string, rec: DeliveryRecord): void {
    var entries = loadLedger(nk, userId, gameId);
    entries.unshift(rec);
    if (entries.length > MAX_LEDGER_ENTRIES) entries = entries.slice(0, MAX_LEDGER_ENTRIES);
    nk.storageWrite([{
      collection: LEDGER_COLLECTION,
      key: gameId,
      userId: userId,
      value: { entries: entries } as any,
      permissionRead: 1,
      permissionWrite: 0
    }]);
  }

  // ─── Delivery email resolution ────────────────────────────────────────────
  // Priority: explicit per-user delivery profile → Nakama account email.

  export function deliveryEmail(nk: nkruntime.Nakama, userId: string): string {
    try {
      var rows = nk.storageRead([{ collection: PROFILE_COLLECTION, key: "profile", userId: userId }]);
      if (rows.length > 0 && rows[0].value && (rows[0].value as any).email) {
        return String((rows[0].value as any).email);
      }
    } catch (e: any) { /* fall through */ }
    try {
      var account = nk.accountGetId(userId);
      if (account && account.email) return account.email;
    } catch (e: any) { /* fall through */ }
    return "";
  }

  // ─── Notifuse transactional email (server-side, generic template) ─────────

  function notifuseSend(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context,
    notificationId: string, email: string, data: { [k: string]: string }
  ): { ok: boolean; reason?: string } {
    var apiUrl = ctx.env["NOTIFUSE_API_URL"] || "https://notifuse.intelli-verse-x.ai";
    var secret = ctx.env["NOTIFUSE_SECRET_KEY"] || "";
    var rootEmail = ctx.env["NOTIFUSE_ROOT_EMAIL"] || "admin@intelli-verse-x.ai";
    var workspace = ctx.env["NOTIFUSE_WORKSPACE"] || "intelliversex";
    if (!secret) return { ok: false, reason: "NOTIFUSE_SECRET_KEY not configured" };

    // HMAC root sign-in → short-lived admin token (same contract the demo used)
    var ts = Math.floor(Date.now() / 1000);
    var sig = "";
    try {
      var raw = nk.hmacSha256Hash(rootEmail + ":" + ts, secret);
      sig = nk.base16Encode(raw, false).toLowerCase();
    } catch (e: any) {
      return { ok: false, reason: "hmac failed: " + String(e && e.message ? e.message : e) };
    }

    var token = "";
    try {
      var signin: any = nk.httpRequest(apiUrl + "/api/user.rootSignin", "post",
        { "Content-Type": "application/json" },
        JSON.stringify({ email: rootEmail, timestamp: ts, signature: sig }), 8000);
      var sj = JSON.parse(signin.body || "{}");
      token = sj.token || "";
    } catch (e: any) {
      return { ok: false, reason: "rootSignin failed: " + String(e && e.message ? e.message : e) };
    }
    if (!token) return { ok: false, reason: "notifuse auth returned no token" };

    try {
      var resp: any = nk.httpRequest(apiUrl + "/api/transactional.send", "post",
        { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        JSON.stringify({
          workspace_id: workspace,
          notification: { id: notificationId, contact: { email: email }, channels: ["email"], data: data }
        }), 15000);
      if (resp.code >= 200 && resp.code < 300) return { ok: true };
      return { ok: false, reason: "transactional.send HTTP " + resp.code + ": " + String(resp.body || "").slice(0, 200) };
    } catch (e: any) {
      return { ok: false, reason: "transactional.send failed: " + String(e && e.message ? e.message : e) };
    }
  }

  // ─── Discord ops alert (best-effort) ──────────────────────────────────────

  function discordAlert(nk: nkruntime.Nakama, ctx: nkruntime.Context, content: string): void {
    var webhook = ctx.env["DISCORD_QV_OPS_WEBHOOK_URL"] || "";
    if (!webhook) return;
    try {
      nk.httpRequest(webhook, "post", { "Content-Type": "application/json" },
        JSON.stringify({ content: content }), 5000);
    } catch (e: any) { /* alerts must never break gameplay */ }
  }

  // ─── Core: called by QuestEngine after a reward grant ─────────────────────
  // Never throws — every failure is logged + ledgered, gameplay is sacred.

  export function onQuestReward(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context,
    userId: string, gameId: string,
    questId: string, questName: string,
    resolved: any /* Hiro.ResolvedReward */
  ): void {
    var now = Math.floor(Date.now() / 1000);
    var catalog = loadCatalog(nk, gameId);

    // Collect every granted currency/item id so catalog entries can bind to either.
    var grantedIds: string[] = [];
    var summaryParts: string[] = [];
    var cur = (resolved && resolved.currencies) || {};
    for (var cid in cur) {
      if (cur[cid] > 0) { grantedIds.push(cid); summaryParts.push("+" + cur[cid] + " " + cid); }
    }
    var items = (resolved && resolved.items) || {};
    for (var iid in items) {
      if (items[iid] > 0) { grantedIds.push(iid); summaryParts.push(items[iid] + "x " + iid); }
    }

    // 1) In-app notification — content is entirely server config.
    //    Catalog title/message wins over the generic quest-complete wording.
    var richEntry: CatalogEntry | null = null;
    for (var g = 0; g < grantedIds.length; g++) {
      var e = catalog.rewards[grantedIds[g]];
      if (e) { richEntry = e; break; }
    }
    var subject = richEntry ? ("\uD83C\uDF81 " + richEntry.title) : ("\uD83C\uDF89 Quest complete: " + questName);
    var body = richEntry && richEntry.message ? richEntry.message
      : ("You earned " + (summaryParts.join(", ") || "a reward") + "!");
    try {
      nk.notificationSend(userId, subject, {
        questId: questId, questName: questName, body: body,
        rewards: summaryParts, assetUrl: (richEntry && richEntry.assetUrl) || ""
      }, NOTIFICATION_CODE_REWARD, "", true);
    } catch (e2: any) {
      logger.warn("[RewardDelivery] notificationSend failed: " + String(e2 && e2.message ? e2.message : e2));
    }
    appendLedger(nk, userId, gameId, {
      ts: now, questId: questId, rewardId: grantedIds.join(",") || "reward",
      title: subject, status: "notified", channel: "inapp",
      assetUrl: (richEntry && richEntry.assetUrl) || undefined, detail: body
    });

    // 2) Email fulfilment for catalog entries that ask for it.
    var genericTemplate = ctx.env["NOTIFUSE_REWARD_NOTIFICATION"] || "qx_reward_delivery";
    for (var g2 = 0; g2 < grantedIds.length; g2++) {
      var entry = catalog.rewards[grantedIds[g2]];
      if (!entry || !entry.deliver || entry.deliver.channel !== "email") continue;

      var email = deliveryEmail(nk, userId);
      if (!email) {
        appendLedger(nk, userId, gameId, {
          ts: now, questId: questId, rewardId: entry.id, title: entry.title,
          status: "pending_email", channel: "email", assetUrl: entry.assetUrl,
          detail: "No delivery email on account — call reward_delivery_set_email to receive it."
        });
        discordAlert(nk, ctx, "\u26A0\uFE0F DELIVERY PENDING | " + entry.title + " | user " + userId + " has no email | " + gameId);
        continue;
      }

      var notifId = entry.deliver.notificationId || genericTemplate;
      var send = notifuseSend(nk, logger, ctx, notifId, email, {
        title: entry.title,
        message: entry.message || ("Your reward from quest \"" + questName + "\" is ready."),
        asset_url: entry.assetUrl || "",
        cta_label: entry.ctaLabel || "Open reward",
        quest_name: questName
      });
      appendLedger(nk, userId, gameId, {
        ts: now, questId: questId, rewardId: entry.id, title: entry.title,
        status: send.ok ? "delivered" : "failed", channel: "email", email: email,
        assetUrl: entry.assetUrl, detail: send.ok ? ("Emailed to " + email) : (send.reason || "send failed")
      });
      if (send.ok) {
        logger.info("[RewardDelivery] Delivered %s to %s (quest=%s)", entry.id, email, questId);
        discordAlert(nk, ctx, "\u2705 REWARD DELIVERED | " + entry.title + " | " + email + " | quest " + questId + " | " + gameId);
      } else {
        logger.error("[RewardDelivery] Email delivery failed: %s", send.reason || "unknown");
        discordAlert(nk, ctx, "\u274C DELIVERY FAILED | " + entry.title + " | " + email + " | " + (send.reason || "unknown") + " | " + gameId);
      }
    }
  }

  // ─── RPCs ────────────────────────────────────────────────────────────────

  // Admin: save/replace the reward catalog for a game.
  // Payload: { gameId, rewards: { id: CatalogEntry } }  or  { gameId, rewards: [CatalogEntry] }
  function rpcCatalogAdminSave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!isAdminCaller(ctx)) return RpcHelpers.errorResponse("Forbidden: server key required");
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId as string;
    if (!gameId) return RpcHelpers.errorResponse("gameId is required");

    var rewards: { [id: string]: CatalogEntry } = {};
    var raw = data.rewards;
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var r = raw[i] as CatalogEntry;
        if (r && r.id) rewards[r.id] = r;
      }
    } else if (raw && typeof raw === "object") {
      for (var k in (raw as any)) {
        var r2 = (raw as any)[k] as CatalogEntry;
        if (r2) { if (!r2.id) r2.id = k; rewards[r2.id] = r2; }
      }
    } else {
      return RpcHelpers.errorResponse("rewards map or array is required");
    }

    saveCatalog(nk, gameId, { rewards: rewards });
    logger.info("[RewardDelivery] Catalog saved: game=%s rewards=%d", gameId, Object.keys(rewards).length);
    return RpcHelpers.successResponse({ gameId: gameId, rewardCount: Object.keys(rewards).length });
  }

  // Admin: read full catalog.
  function rpcCatalogAdminGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    if (!isAdminCaller(ctx)) return RpcHelpers.errorResponse("Forbidden: server key required");
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId as string;
    if (!gameId) return RpcHelpers.errorResponse("gameId is required");
    var catalog = loadCatalog(nk, gameId);
    return RpcHelpers.successResponse({ gameId: gameId, rewards: catalog.rewards });
  }

  // Player: readable catalog (titles/icons — lets a dumb client render rewards).
  function rpcCatalogGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId as string;
    if (!gameId) return RpcHelpers.errorResponse("gameId is required");
    var catalog = loadCatalog(nk, gameId);
    var out: { [id: string]: any } = {};
    for (var id in catalog.rewards) {
      var e = catalog.rewards[id];
      out[id] = { id: e.id, title: e.title, message: e.message || "", icon: e.icon || "", requiresEmail: !!(e.deliver && e.deliver.channel === "email") };
    }
    return RpcHelpers.successResponse({ rewards: out });
  }

  // Player: delivery/notification history ("My Rewards").
  function rpcListMine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = data.gameId as string;
    if (!gameId) return RpcHelpers.errorResponse("gameId is required");
    return RpcHelpers.successResponse({ deliveries: loadLedger(nk, userId, gameId) });
  }

  // Player: set delivery email; retries any pending_email deliveries for this game.
  function rpcSetEmail(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var email = String(data.email || "").trim().toLowerCase();
    var gameId = data.gameId as string;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return RpcHelpers.errorResponse("Valid email is required");

    nk.storageWrite([{
      collection: PROFILE_COLLECTION, key: "profile", userId: userId,
      value: { email: email, updatedAt: Math.floor(Date.now() / 1000) } as any,
      permissionRead: 1, permissionWrite: 0
    }]);

    // Retry pending deliveries now that we have an address.
    var retried = 0;
    if (gameId) {
      var catalog = loadCatalog(nk, gameId);
      var entries = loadLedger(nk, userId, gameId);
      var genericTemplate = ctx.env["NOTIFUSE_REWARD_NOTIFICATION"] || "qx_reward_delivery";
      for (var i = 0; i < entries.length; i++) {
        var rec = entries[i];
        if (rec.status !== "pending_email") continue;
        var entry = catalog.rewards[rec.rewardId];
        if (!entry) continue;
        var send = notifuseSend(nk, logger, ctx, (entry.deliver && entry.deliver.notificationId) || genericTemplate, email, {
          title: entry.title,
          message: entry.message || "Your reward is ready.",
          asset_url: entry.assetUrl || "",
          cta_label: entry.ctaLabel || "Open reward",
          quest_name: rec.questId
        });
        if (send.ok) { rec.status = "delivered"; rec.email = email; rec.detail = "Emailed to " + email; retried++; }
      }
      if (retried > 0) {
        nk.storageWrite([{
          collection: LEDGER_COLLECTION, key: gameId, userId: userId,
          value: { entries: entries } as any, permissionRead: 1, permissionWrite: 0
        }]);
      }
    }
    return RpcHelpers.successResponse({ email: email, retriedDeliveries: retried });
  }

  // ─── Registration ────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("reward_catalog_admin_save", rpcCatalogAdminSave);
    initializer.registerRpc("reward_catalog_admin_get", rpcCatalogAdminGet);
    initializer.registerRpc("reward_catalog_get", rpcCatalogGet);
    initializer.registerRpc("reward_delivery_list_mine", rpcListMine);
    initializer.registerRpc("reward_delivery_set_email", rpcSetEmail);
  }
}
