// =============================================================================
// Conversation → User KB capture
//
// Implements PLAN-CONVERSATIONAL_HUB.md §E.5 — every channel adapter that
// receives inbound text / voice / image / interactive content from a user
// (WhatsApp, Telegram, Discord, iMessage, SMS reply, Beehiiv reply, Web chat)
// funnels the payload here so the per-user Knowledge Base stays current and
// the personalizer/voice agent can ground responses in real chat history.
//
// All writes are scoped to the resolved Cognito sub → Nakama userId. Public
// reads are limited to the user's own collection (qv_user_conv); cross-user
// reads happen via service-token-only RPCs from the dashboard / cron.
// =============================================================================

namespace ConvCapture {

  // ── Storage layout ──────────────────────────────────────────────────────
  // Per-user message log. One storage object per inbound message.
  // key = `${unix_ts}_${random6}` so listings are time-ordered ascending.
  const COLLECTION_CONV = "qv_user_conv";

  // Per-user mood / sentiment summary (rolled up by kb-enrichment cron).
  // We only ingest the raw signal here; derivation happens in
  // src/satori/identities/kb_enrichment.ts on the */15 schedule.
  const COLLECTION_MOOD = "qv_user_mood";

  // Hard caps — both anti-abuse and DPDP Article 17 hygiene.
  const MAX_TEXT_CHARS = 8192;        // ~6KB JSON-encoded inbound message
  const MAX_LIST_LIMIT = 200;         // conv_my_list page size cap
  const MAX_LIST_DAYS = 90;           // conv_my_list lookback cap
  const PURGE_BATCH_SIZE = 200;       // conv_user_purge inner storageList page

  // Allowed enums — keep these tight; the lint at
  // tools/lint-channel-conv-capture.ts in the web repo enforces that every
  // adapter passes one of these.
  const ALLOWED_CHANNELS: { [k: string]: boolean } = {
    whatsapp: true, telegram: true, discord: true, imessage: true,
    sms: true, email: true, beehiiv: true, livekit: true, pstn: true,
    web_chat: true, in_app: true,
  };
  const ALLOWED_KINDS: { [k: string]: boolean } = {
    text: true, voice: true, image: true, interactive: true,
  };
  const ALLOWED_DIRECTIONS: { [k: string]: boolean } = {
    inbound: true, outbound: true,
  };

  interface CaptureRequest {
    user_id?: string;
    service_token?: string;
    channel: string;
    kind: string;
    direction?: string;            // default "inbound"
    text?: string;                 // required for kind=text|interactive
    media_ref?: string;            // S3 / WhatsApp media id for kind=voice|image
    interaction_id?: string;       // CTA tap id, slash-command name, etc.
    trace_id?: string;             // wow_moment trace_id if known
    wow_id?: string;
    locale?: string;
    received_at?: number;          // unix seconds; defaults to now
  }

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  // Mirrors WowMoments.isServiceCaller — uses ctx.env (the Goja runtime
  // environment block), not process.env. The deploy operator must set
  // CONV_CAPTURE_SERVICE_TOKEN in nakama config.yaml runtime.env (or
  // injected via the eks helmchart values).
  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["CONV_CAPTURE_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  function emitAnalytics(nk: nkruntime.Nakama, userId: string, eventName: string, properties: any): void {
    try {
      var unixTs = nowSec();
      var dateStr = todayDate();
      var rand = Math.random().toString(36).slice(2, 8);
      var dashKey = "dash_quizverse_" + dateStr + "_" + eventName + "_" + unixTs + "_" + rand;
      nk.storageWrite([{
        collection: Constants.ANALYTICS_COLLECTION,
        key: dashKey,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          eventName: eventName,
          gameId: "quizverse",
          userId: userId,
          properties: properties,
          unixTimestamp: unixTs,
          date: dateStr,
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) { /* swallow */ }
  }

  // ── RPC: conv_message_capture ──────────────────────────────────────────
  // Service-only. The web frontend's /api/conv/capture proxies inbound
  // channel webhooks here after resolving external_id → cognito_sub →
  // nakama userId via identity_resolve.
  //
  // Request: see CaptureRequest interface above.
  // Response: { success, data: { stored_at, key } }
  function rpcMessageCapture(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload) as CaptureRequest;

      // 1. Auth — must be a service caller. We never let an end-user JWT
      //    write into someone else's qv_user_conv.
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised — conv_message_capture is service-only", 401);
      }

      // 2. Resolve target user.
      var userId = "" + (data.user_id || "");
      if (!userId) {
        return RpcHelpers.errorResponse("user_id required", 400);
      }

      // 3. Validate enums.
      var channel = ("" + (data.channel || "")).toLowerCase();
      if (!ALLOWED_CHANNELS[channel]) {
        return RpcHelpers.errorResponse("unsupported channel: " + channel, 400);
      }
      var kind = ("" + (data.kind || "")).toLowerCase();
      if (!ALLOWED_KINDS[kind]) {
        return RpcHelpers.errorResponse("unsupported kind: " + kind, 400);
      }
      var direction = ("" + (data.direction || "inbound")).toLowerCase();
      if (!ALLOWED_DIRECTIONS[direction]) {
        return RpcHelpers.errorResponse("unsupported direction: " + direction, 400);
      }

      // 4. Body sanity.
      var text = "" + (data.text || "");
      if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
      if ((kind === "text" || kind === "interactive") && text.length === 0 && !data.interaction_id) {
        return RpcHelpers.errorResponse("text or interaction_id required for text/interactive", 400);
      }
      if ((kind === "voice" || kind === "image") && !data.media_ref) {
        return RpcHelpers.errorResponse("media_ref required for voice/image", 400);
      }

      // 5. Build the storage object.
      var unixTs = data.received_at && typeof data.received_at === "number"
        ? Math.floor(data.received_at)
        : nowSec();
      var rand = Math.random().toString(36).slice(2, 8);
      var key = unixTs + "_" + rand;

      var record = {
        channel: channel,
        kind: kind,
        direction: direction,
        text: text,
        media_ref: data.media_ref || null,
        interaction_id: data.interaction_id || null,
        trace_id: data.trace_id || null,
        wow_id: data.wow_id || null,
        locale: ("" + (data.locale || "")).toLowerCase() || null,
        received_at: unixTs,
        date: new Date(unixTs * 1000).toISOString().slice(0, 10),
      };

      nk.storageWrite([{
        collection: COLLECTION_CONV,
        key: key,
        userId: userId,
        value: record,
        // Permission 1/0 — owner can read, nobody but server can write.
        // The /me/reveal page reads via Nakama session; the kb-enrichment
        // cron reads via service-token RPC, never via direct storage list
        // across users.
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      // 6. Mirror to analytics event so the Wow Moment loop can join
      //    inbound messages with their parent moment via trace_id.
      emitAnalytics(nk, userId, "conv_message_captured", {
        channel: channel,
        kind: kind,
        direction: direction,
        has_text: text.length > 0,
        has_trace_id: !!data.trace_id,
        wow_id: data.wow_id || null,
        text_len: text.length,
      });

      return RpcHelpers.successResponse({ key: key, stored_at: unixTs });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[ConvCapture] capture failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "conv_message_capture", msg);
      return RpcHelpers.errorResponse("capture failed: " + msg, 500);
    }
  }

  // ── RPC: conv_my_list ──────────────────────────────────────────────────
  // User-side. Powers the /me/reveal trust-anchor page — returns the most
  // recent N messages for the authenticated caller. NEVER accepts user_id
  // from the payload (that would let a JWT enumerate other users' chat).
  function rpcMyConvList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var limit = Math.min(Math.max(parseInt("" + (data.limit || "50")) || 50, 1), MAX_LIST_LIMIT);
      var cursor = "" + (data.cursor || "");

      var page = nk.storageList(userId, COLLECTION_CONV, limit, cursor);
      var items: any[] = [];
      if (page && page.objects) {
        for (var i = 0; i < page.objects.length; i++) {
          var o = page.objects[i];
          items.push({
            key: o.key,
            channel: (o.value as any).channel,
            kind: (o.value as any).kind,
            direction: (o.value as any).direction,
            text: (o.value as any).text,
            received_at: (o.value as any).received_at,
            trace_id: (o.value as any).trace_id,
            wow_id: (o.value as any).wow_id,
          });
        }
      }
      return RpcHelpers.successResponse({
        items: items,
        cursor: (page && page.cursor) || "",
      });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[ConvCapture] list failed: " + msg);
      return RpcHelpers.errorResponse("list failed: " + msg, 500);
    }
  }

  // ── RPC: conv_user_purge ───────────────────────────────────────────────
  // DPDP Article 17 / GDPR Right-to-erasure. The /me/reveal page calls this
  // when the user clicks "Delete my conversation history". Idempotent.
  // Returns count of deleted objects so the page can show a confirmation.
  function rpcUserPurge(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var totalDeleted = 0;
      var cursor = "";
      var safety = 0;
      // Page through every object; cap iterations so a runaway dataset
      // can't lock the runtime.
      while (safety < 50) {
        safety++;
        var page = nk.storageList(userId, COLLECTION_CONV, PURGE_BATCH_SIZE, cursor);
        if (!page || !page.objects || page.objects.length === 0) break;
        var deletes: nkruntime.StorageDeleteRequest[] = [];
        for (var i = 0; i < page.objects.length; i++) {
          deletes.push({
            collection: COLLECTION_CONV,
            key: page.objects[i].key,
            userId: userId,
          });
        }
        if (deletes.length > 0) {
          nk.storageDelete(deletes);
          totalDeleted += deletes.length;
        }
        if (!page.cursor) break;
        cursor = page.cursor;
      }

      // Also delete the mood roll-up — it's derived from conv data so it
      // would be PII to retain after the source is gone.
      try {
        nk.storageDelete([{ collection: COLLECTION_MOOD, key: "current", userId: userId }]);
      } catch (_) { /* it may not exist; that's fine */ }

      emitAnalytics(nk, userId, "conv_user_purged", { count: totalDeleted });
      return RpcHelpers.successResponse({ deleted: totalDeleted });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[ConvCapture] purge failed: " + msg);
      return RpcHelpers.errorResponse("purge failed: " + msg, 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("conv_message_capture", rpcMessageCapture);
    initializer.registerRpc("conv_my_list", rpcMyConvList);
    initializer.registerRpc("conv_user_purge", rpcUserPurge);
  }
}
