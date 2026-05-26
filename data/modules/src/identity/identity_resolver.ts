// identity_resolver.ts
// ─────────────────────────────────────────────────────────────────────────────
// Identity Resolver — maps inbound channel identifiers (phone, telegram_id,
// discord_id, beehiiv_id, apple_wallet pass serial, imessage_id, livekit_id)
// to the canonical Cognito `sub` (which equals the Nakama userId after the
// cognito_wallet_mapper bootstrap).
//
// Why this exists:
//   Every channel surfaced in PLAN-CONVERSATIONAL_HUB_AND_REWARDS.md (WhatsApp,
//   SMS, Telegram, Discord, iMessage Business, Apple Wallet pass, Beehiiv, voice)
//   delivers an external identifier rather than a Nakama userId. Without a
//   resolver every per-channel agent must invent its own bookkeeping. With this
//   module each channel has one tiny adapter (~1 dev-day) over a shared spine.
//
// Storage shape (Nakama storageWrite, system-owned):
//   collection: "identity_links"
//   key:        "<channel>:<external_id_lower>"     // e.g. "whatsapp:+919876543210"
//   value:      { cognito_sub, channel, external_id, linked_at, source, confidence, last_seen }
//   userId:     SYSTEM_USER_ID                       // resolver index is system-owned
//
//   collection: "identity_links_user"
//   key:        "<channel>:<external_id_lower>"
//   value:      { channel, external_id, linked_at, source, confidence }
//   userId:     <cognito_sub>                        // per-user reverse index for /me/reveal
//
// RPCs registered:
//   identity_resolve   — read-only: external id → cognito_sub (used by Channel Personalizer)
//   identity_link      — opt-in write: caller's cognito_sub ← external id (used by web /api/identity/link)
//   identity_unlink    — caller-owned removal of a binding (privacy escape hatch)
//   identity_list_mine — caller-owned read of all their bindings (powers /me/reveal)
//
// Cross-references:
//   - PLAN-CONVERSATIONAL_HUB_AND_REWARDS.md §C.1 (Identity Resolver Service)
//   - cognito_wallet_mapper.js (bootstraps cognito_sub → Nakama userId on first auth)
//   - PLAN-USER_INTELLIGENCE_LOOP.md §7.3 ("/me/reveal" trust anchor)
//   - CATALOG-DEDUCIBLE_INSIGHTS.md (every linked external id must be deducible
//     from a user-initiated action — never inferred)
//
// Privacy contract:
//   - Linking ALWAYS requires the caller to be authenticated as the cognito_sub
//     they want to bind to (prevents impersonation).
//   - identity_resolve refuses to return cognito_sub to unauthenticated callers
//     by default; service-account callers (e.g. n8n channel adapters) must
//     supply IDENTITY_RESOLVER_SERVICE_TOKEN as the `service_token` payload
//     field. Token is rotated via env var; see ops runbook.
//   - identity_unlink immediately invalidates the binding — there is no soft-
//     delete; we re-link on next opt-in if the user comes back.

namespace IdentityResolver {

  // ── Constants ────────────────────────────────────────────────────────────
  var IDENTITY_LINKS_COLLECTION = "identity_links";              // system-owned forward index
  var IDENTITY_LINKS_USER_COLLECTION = "identity_links_user";    // per-user reverse index
  var SUPPORTED_CHANNELS: { [k: string]: boolean } = {
    "whatsapp": true,
    "sms": true,
    "telegram": true,
    "discord": true,
    "imessage": true,
    "beehiiv": true,
    "apple_wallet": true,
    "livekit": true,
    "fonoster": true,
    "email": true,
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function normalizeExternalId(channel: string, externalId: string): string {
    // Channel-specific normalization rules. Phones get + prefix and digits only;
    // emails lowercase + trim; everything else lowercase.
    var trimmed = ("" + externalId).trim();
    if (channel === "whatsapp" || channel === "sms") {
      // E.164: keep digits + leading + (if present)
      var hasPlus = trimmed.charAt(0) === "+";
      var digits = trimmed.replace(/[^0-9]/g, "");
      if (digits.length === 0) return "";
      return (hasPlus ? "+" : "") + digits;
    }
    if (channel === "email" || channel === "beehiiv") {
      return trimmed.toLowerCase();
    }
    return trimmed.toLowerCase();
  }

  function buildKey(channel: string, externalId: string): string {
    return channel + ":" + externalId;
  }

  function readLink(nk: nkruntime.Nakama, channel: string, externalId: string): any | null {
    var key = buildKey(channel, externalId);
    try {
      var records = nk.storageRead([{
        collection: IDENTITY_LINKS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
      }]);
      if (records && records.length > 0 && records[0].value) {
        return records[0].value;
      }
    } catch (err: any) {
      // Read failures yield "not linked" — never throw to caller.
    }
    return null;
  }

  function writeLink(nk: nkruntime.Nakama, channel: string, externalId: string, cognitoSub: string, source: string, confidence: string): void {
    var key = buildKey(channel, externalId);
    var now = Math.floor(Date.now() / 1000);
    var forward = {
      cognito_sub: cognitoSub,
      channel: channel,
      external_id: externalId,
      linked_at: now,
      source: source,
      confidence: confidence,
      last_seen: now,
    };
    var reverse = {
      channel: channel,
      external_id: externalId,
      linked_at: now,
      source: source,
      confidence: confidence,
    };
    nk.storageWrite([
      {
        collection: IDENTITY_LINKS_COLLECTION,
        key: key,
        userId: Constants.SYSTEM_USER_ID,
        value: forward,
        permissionRead: 1,
        permissionWrite: 0,
      },
      {
        collection: IDENTITY_LINKS_USER_COLLECTION,
        key: key,
        userId: cognitoSub,
        value: reverse,
        permissionRead: 2,
        permissionWrite: 0,
      },
    ]);
  }

  function deleteLink(nk: nkruntime.Nakama, channel: string, externalId: string, cognitoSub: string): void {
    var key = buildKey(channel, externalId);
    try {
      nk.storageDelete([
        { collection: IDENTITY_LINKS_COLLECTION, key: key, userId: Constants.SYSTEM_USER_ID },
        { collection: IDENTITY_LINKS_USER_COLLECTION, key: key, userId: cognitoSub },
      ]);
    } catch (err: any) {
      // Idempotent delete; if already gone, that's fine.
    }
  }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    // Nakama's Goja runtime exposes runtime.env (set in nakama config.yaml
    // under runtime.env) via ctx.env. Container-level env vars are NOT
    // visible inside Goja — see data/modules/src/legacy/daily-rewards.ts
    // and library/n8n-pack-state.ts for the canonical pattern.
    var expected = "" + ((ctx.env && ctx.env["IDENTITY_RESOLVER_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // ── RPC: identity_resolve ────────────────────────────────────────────────
  // Read-only. Looks up the cognito_sub bound to a (channel, external_id) pair.
  // Authentication: either (a) ctx.userId is set (Nakama session), or
  // (b) payload.service_token matches IDENTITY_RESOLVER_SERVICE_TOKEN.
  //
  // Request:
  //   { "channel": "whatsapp", "external_id": "+919876543210", "service_token": "..." }
  //
  // Response (linked):
  //   { "success": true, "data": {
  //       "cognito_sub": "...",
  //       "channel": "whatsapp", "external_id": "+919876543210",
  //       "linked_at": 1735000000, "confidence": "high"
  //   }}
  //
  // Response (unlinked):
  //   { "success": true, "data": null }
  function rpcResolve(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);

      var channel = ("" + (data.channel || "")).toLowerCase();
      var externalIdRaw = data.external_id || data.externalId;
      if (!channel || !SUPPORTED_CHANNELS[channel]) {
        return RpcHelpers.errorResponse("unsupported channel", 400);
      }
      if (!externalIdRaw) {
        return RpcHelpers.errorResponse("external_id is required", 400);
      }
      var externalId = normalizeExternalId(channel, "" + externalIdRaw);
      if (!externalId) {
        return RpcHelpers.errorResponse("external_id failed normalisation", 400);
      }

      // Authentication: must be either Nakama-authenticated or a trusted service.
      if (!ctx.userId && !isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised", 401);
      }

      var record = readLink(nk, channel, externalId);
      if (!record) {
        return RpcHelpers.successResponse(null);
      }

      // Last-seen update is best-effort and does not block the read.
      try {
        record.last_seen = Math.floor(Date.now() / 1000);
        nk.storageWrite([{
          collection: IDENTITY_LINKS_COLLECTION,
          key: buildKey(channel, externalId),
          userId: Constants.SYSTEM_USER_ID,
          value: record,
        }]);
      } catch (e: any) { /* swallow */ }

      return RpcHelpers.successResponse({
        cognito_sub: record.cognito_sub,
        channel: channel,
        external_id: externalId,
        linked_at: record.linked_at,
        confidence: record.confidence || "medium",
      });
    } catch (err: any) {
      logger.error("identity_resolve failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: identity_link ───────────────────────────────────────────────────
  // Caller MUST be authenticated as the cognito_sub being linked. We do not
  // permit "link this stranger's whatsapp to my account" — see privacy contract.
  //
  // Request:
  //   { "channel": "whatsapp", "external_id": "+919876543210",
  //     "source": "wa_magic_link", "confidence": "high" }
  //
  // Response:
  //   { "success": true, "data": { "linked": true, "channel": "whatsapp", ... }}
  function rpcLink(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);

      var channel = ("" + (data.channel || "")).toLowerCase();
      var externalIdRaw = data.external_id || data.externalId;
      if (!channel || !SUPPORTED_CHANNELS[channel]) {
        return RpcHelpers.errorResponse("unsupported channel", 400);
      }
      if (!externalIdRaw) {
        return RpcHelpers.errorResponse("external_id is required", 400);
      }
      var externalId = normalizeExternalId(channel, "" + externalIdRaw);
      if (!externalId) {
        return RpcHelpers.errorResponse("external_id failed normalisation", 400);
      }

      // If a binding already exists to a DIFFERENT user, refuse and surface the
      // collision. The web layer will then show "this channel is already linked
      // to another account; contact support to merge."
      var existing = readLink(nk, channel, externalId);
      if (existing && existing.cognito_sub && existing.cognito_sub !== userId) {
        logger.warn("identity_link conflict: channel=" + channel + " external_id=" + externalId + " existing_sub=" + existing.cognito_sub + " caller_sub=" + userId);
        return RpcHelpers.errorResponse("external_id is already linked to another account", 409);
      }

      var source = ("" + (data.source || "user_opt_in")).slice(0, 64);
      var confidence = ("" + (data.confidence || "high")).slice(0, 16);
      writeLink(nk, channel, externalId, userId, source, confidence);

      logger.info("identity_link ok: user=" + userId + " channel=" + channel + " ext=" + externalId);

      return RpcHelpers.successResponse({
        linked: true,
        channel: channel,
        external_id: externalId,
        cognito_sub: userId,
        confidence: confidence,
      });
    } catch (err: any) {
      logger.error("identity_link failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: identity_unlink ─────────────────────────────────────────────────
  // Caller MUST own the binding. Idempotent.
  //
  // Request:  { "channel": "whatsapp", "external_id": "+919876543210" }
  // Response: { "success": true, "data": { "unlinked": true }}
  function rpcUnlink(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);

      var channel = ("" + (data.channel || "")).toLowerCase();
      var externalIdRaw = data.external_id || data.externalId;
      if (!channel || !SUPPORTED_CHANNELS[channel]) {
        return RpcHelpers.errorResponse("unsupported channel", 400);
      }
      if (!externalIdRaw) {
        return RpcHelpers.errorResponse("external_id is required", 400);
      }
      var externalId = normalizeExternalId(channel, "" + externalIdRaw);

      var existing = readLink(nk, channel, externalId);
      if (!existing) {
        return RpcHelpers.successResponse({ unlinked: true });
      }
      if (existing.cognito_sub !== userId) {
        return RpcHelpers.errorResponse("not authorised to unlink this binding", 403);
      }

      deleteLink(nk, channel, externalId, userId);
      logger.info("identity_unlink ok: user=" + userId + " channel=" + channel + " ext=" + externalId);

      return RpcHelpers.successResponse({ unlinked: true });
    } catch (err: any) {
      logger.error("identity_unlink failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: identity_list_mine ──────────────────────────────────────────────
  // Powers the /me/reveal "Connected channels" panel. Caller-owned read.
  //
  // Response: { "success": true, "data": { "links": [ {channel, external_id_masked, linked_at, ...}, ...] }}
  function rpcListMine(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var records: nkruntime.StorageObject[] = [];
      try {
        var page = nk.storageList(userId, IDENTITY_LINKS_USER_COLLECTION, 100);
        if (page && page.objects) {
          records = page.objects;
        }
      } catch (e: any) {
        // empty
      }

      var links: any[] = [];
      for (var i = 0; i < records.length; i++) {
        var v = records[i].value as any;
        if (!v) continue;
        links.push({
          channel: v.channel,
          external_id_masked: maskExternalId(v.channel, v.external_id),
          linked_at: v.linked_at,
          source: v.source,
          confidence: v.confidence,
        });
      }

      return RpcHelpers.successResponse({ links: links, count: links.length });
    } catch (err: any) {
      logger.error("identity_list_mine failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // Privacy: never echo back full phone numbers / emails / pass serials.
  function maskExternalId(channel: string, externalId: string): string {
    if (!externalId) return "";
    if (channel === "whatsapp" || channel === "sms") {
      // Show country code + last 2 digits: "+91 ******10"
      if (externalId.length <= 4) return externalId;
      return externalId.substr(0, 3) + " ****" + externalId.substr(externalId.length - 2);
    }
    if (channel === "email" || channel === "beehiiv") {
      var atIdx = externalId.indexOf("@");
      if (atIdx <= 1) return externalId;
      return externalId.charAt(0) + "***" + externalId.substr(atIdx);
    }
    if (externalId.length <= 6) return externalId;
    return externalId.substr(0, 3) + "***" + externalId.substr(externalId.length - 2);
  }

  // ── RPC: identity_resolve_or_ghost_create ────────────────────────────────
  // Service-only. Lookup-or-mint variant of identity_resolve. Used by
  // outbound surfaces that want a stable cognito_sub for HMAC-signed CTA
  // tracking even when the contact has never authenticated against
  // Cognito (e.g. anonymous newsletter signups via web form).
  //
  // Behaviour:
  //   1. If a binding already exists → return that cognito_sub (no mint).
  //   2. Else → mint a brand-new Nakama user via authenticateCustom() with
  //      a deterministic ghost custom_id derived from (channel, external_id),
  //      write the binding, return the new userId as cognito_sub.
  //
  // The minted user has no Cognito account behind it. When the human later
  // signs up via Cognito with the same email/phone, the cognito_wallet_mapper
  // bootstrap should merge the ghost record into the real cognito_sub (TODO:
  // implement merge — for now both records coexist, last write wins via
  // identity_link).
  //
  // Auth: REQUIRES service_token (no Nakama session caller path). The
  // operation has side effects so we restrict to trusted backends.
  //
  // Request:
  //   { "channel": "email", "external_id": "user@example.com",
  //     "source": "newsletter_subscribe", "service_token": "..." }
  //
  // Response (existing binding):
  //   { "success": true, "data": {
  //       "cognito_sub": "...", "channel": "email", "external_id": "...",
  //       "linked_at": 1735000000, "confidence": "medium", "is_ghost": false
  //   }}
  //
  // Response (newly minted ghost):
  //   { "success": true, "data": {
  //       "cognito_sub": "<freshly-minted nakama userId>",
  //       "channel": "email", "external_id": "...",
  //       "linked_at": <now>, "confidence": "low", "is_ghost": true
  //   }}
  function rpcResolveOrGhostCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);

      // Auth: service-only — this RPC has side effects (user mint + storage write).
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised — identity_resolve_or_ghost_create is service-only", 401);
      }

      var channel = ("" + (data.channel || "")).toLowerCase();
      var externalIdRaw = data.external_id || data.externalId;
      if (!channel || !SUPPORTED_CHANNELS[channel]) {
        return RpcHelpers.errorResponse("unsupported channel", 400);
      }
      if (!externalIdRaw) {
        return RpcHelpers.errorResponse("external_id is required", 400);
      }
      var externalId = normalizeExternalId(channel, "" + externalIdRaw);
      if (!externalId) {
        return RpcHelpers.errorResponse("external_id failed normalisation", 400);
      }

      // 1. Fast path: existing binding.
      var existing = readLink(nk, channel, externalId);
      if (existing && existing.cognito_sub) {
        return RpcHelpers.successResponse({
          cognito_sub: existing.cognito_sub,
          channel: channel,
          external_id: externalId,
          linked_at: existing.linked_at,
          confidence: existing.confidence || "medium",
          is_ghost: false,
        });
      }

      // 2. Slow path: mint a ghost. authenticateCustom with create=true
      //    is idempotent — passing the same custom_id always returns the
      //    same userId, so we get exactly-once semantics even under
      //    concurrent subscribes for the same email.
      var customId = "ghost:" + channel + ":" + externalId;
      // Nakama enforces custom_id ≤ 128 chars. Email + channel + prefix
      // usually fits comfortably; truncate defensively just in case.
      if (customId.length > 128) {
        customId = customId.substr(0, 128);
      }
      var username = "ghost_" + channel + "_" + maskExternalId(channel, externalId).replace(/[^a-zA-Z0-9_]/g, "_");
      // Nakama usernames are unique + ≤ 128 chars. We don't actually
      // care about collisions for ghost users, so suffix with a short
      // hash of the custom_id to disambiguate.
      var suffix = customId.length > 8 ? customId.substr(customId.length - 8) : customId;
      username = (username + "_" + suffix).substr(0, 128);

      var authResult: nkruntime.AuthResult;
      try {
        authResult = nk.authenticateCustom(customId, username, true);
      } catch (e: any) {
        logger.error("identity_resolve_or_ghost_create: authenticateCustom failed: " + (e && e.message ? e.message : String(e)));
        return RpcHelpers.errorResponse("ghost mint failed", 500);
      }

      var ghostSub = authResult && authResult.userId ? authResult.userId : "";
      if (!ghostSub) {
        return RpcHelpers.errorResponse("ghost mint returned no userId", 500);
      }

      // 3. Bind the new ghost to the channel.
      var source = ("" + (data.source || "service_ghost_create")).slice(0, 64);
      writeLink(nk, channel, externalId, ghostSub, source, "low");

      logger.info("identity_resolve_or_ghost_create minted ghost: sub=" + ghostSub + " channel=" + channel + " ext=" + maskExternalId(channel, externalId));

      return RpcHelpers.successResponse({
        cognito_sub: ghostSub,
        channel: channel,
        external_id: externalId,
        linked_at: Math.floor(Date.now() / 1000),
        confidence: "low",
        is_ghost: true,
      });
    } catch (err: any) {
      logger.error("identity_resolve_or_ghost_create failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ─────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("identity_resolve", rpcResolve);
    initializer.registerRpc("identity_resolve_or_ghost_create", rpcResolveOrGhostCreate);
    initializer.registerRpc("identity_link", rpcLink);
    initializer.registerRpc("identity_unlink", rpcUnlink);
    initializer.registerRpc("identity_list_mine", rpcListMine);
  }
}
