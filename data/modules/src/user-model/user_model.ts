// =============================================================================
// User Model RPCs — read-side + signal ingest + consent
//
// Implements PLAN-USER_INTELLIGENCE_LOOP.md PR-5. Three RPCs:
//
//   user_model_get             — read derived attrs + raw signal counts +
//                                consent flags. Read by /me/reveal,
//                                Channel Personalizer, voice agent prompt
//                                builder, n8n cadence workflows.
//   user_model_signal_ingest   — bulk-ingest the 25-event behavioural
//                                taxonomy from Unity / web. Closes the
//                                "13 wrappers waiting for inputs" gap.
//   user_model_consent_set     — per-channel opt-in / opt-out, writable
//                                by the user themselves (no service token
//                                needed). Read on every outbound send.
//
// Storage layout
//   user_model / derived       (per-user, owner-readable) — written by
//                              kb-enrichment cron with derived attributes:
//                              predicted_score_pct, personality_archetype,
//                              next_best_topic, peer_percentile_per_topic,
//                              mood_estimate, social_graph_density.
//   user_model / consent       (per-user, owner-readable) — channel→bool
//                              map: { whatsapp, sms, email, push,
//                              telegram, discord, imessage, voice }.
//   qv_u_<sub>_signals / <eventName>
//                              (per-user, system-only) — counter row:
//                              { count, first_at, last_at }.
// =============================================================================

namespace UserModel {

  const COLLECTION_USER_MODEL = "user_model";
  const KEY_DERIVED = "derived";
  const KEY_CONSENT = "consent";
  const COLLECTION_SIGNALS_PREFIX = "qv_u_";
  const COLLECTION_SIGNALS_SUFFIX = "_signals";

  // The 25-event behavioural taxonomy (PLAN-USER_INTELLIGENCE_LOOP.md §6).
  // Anything not in this set is silently dropped — keeps the signal store
  // from being a free-form bucket for any client to dump arbitrary props.
  const ALLOWED_SIGNALS: { [k: string]: boolean } = {
    // WHEN bucket
    "session_start": true, "session_end": true, "morning_session": true,
    "evening_session": true, "weekend_session": true,
    // WHAT bucket
    "topic_attempted": true, "topic_completed": true, "topic_skipped": true,
    "subject_pivoted": true, "diagnostic_taken": true,
    // FEEL bucket
    "frustration_signal": true, "celebration_signal": true,
    "boredom_signal": true, "flow_signal": true, "mood_self_report": true,
    // WHO bucket
    "friend_added": true, "friend_challenge_sent": true,
    "leaderboard_viewed": true, "social_share": true, "invite_sent": true,
    // RESPOND bucket
    "wow_moment_shown": true, "wow_moment_engaged": true,
    "wow_moment_dismissed": true, "deep_link_followed": true, "channel_replied": true,
  };

  const ALLOWED_CHANNELS: { [k: string]: boolean } = {
    whatsapp: true, sms: true, email: true, push: true,
    telegram: true, discord: true, imessage: true, voice: true,
    beehiiv: true,
  };

  const MAX_SIGNALS_PER_INGEST = 50;

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  // Service caller pattern matches WowMoments / ConvCapture. Used by
  // /api/personalize and the kb-enrichment cron when they need to fetch
  // the model on behalf of an arbitrary user_id.
  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["USER_MODEL_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  function readObject(nk: nkruntime.Nakama, userId: string, collection: string, key: string): any {
    try {
      var rows = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value;
    } catch (_) { }
    return null;
  }

  function defaultConsent(): any {
    // Default to OPT-IN for in-app push (user installed the app),
    // OPT-OUT for everything that requires explicit channel linking.
    return {
      whatsapp: false, sms: false, email: false,
      push: true, telegram: false, discord: false, imessage: false,
      voice: false, beehiiv: false,
    };
  }

  function defaultDerived(): any {
    return {
      predicted_score_pct: null,
      personality_archetype: null,
      next_best_topic: null,
      peer_percentile_per_topic: null,
      mood_estimate: null,
      social_graph_density: null,
      computed_at: null,
    };
  }

  // ── RPC: user_model_get ────────────────────────────────────────────────
  // Self-call (ctx.userId) OR service-call (service_token + user_id).
  // Returns derived attributes, consent flags, and a *summary* of raw
  // signals (event name → { count, last_at }), not the full event log.
  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var userId: string = ctx.userId || "";
      if (!userId) {
        if (!isServiceCaller(ctx, data)) {
          return RpcHelpers.errorResponse("not authorised", 401);
        }
        userId = "" + (data.user_id || "");
        if (!userId) return RpcHelpers.errorResponse("user_id required", 400);
      }

      var derived = readObject(nk, userId, COLLECTION_USER_MODEL, KEY_DERIVED) || defaultDerived();
      var consent = readObject(nk, userId, COLLECTION_USER_MODEL, KEY_CONSENT) || defaultConsent();

      // Summarise raw signals from the per-user collection — keeps the
      // /me/reveal payload small while still letting the user verify
      // every signal type that's been captured.
      var signalCol = COLLECTION_SIGNALS_PREFIX + userId + COLLECTION_SIGNALS_SUFFIX;
      var signalsByName: { [k: string]: any } = {};
      try {
        var page = nk.storageList(userId, signalCol, 100, "");
        if (page && page.objects) {
          for (var i = 0; i < page.objects.length; i++) {
            signalsByName[page.objects[i].key] = page.objects[i].value;
          }
        }
      } catch (_) { /* user may have zero signals; that's fine */ }

      return RpcHelpers.successResponse({
        user_id: userId,
        derived: derived,
        consent: consent,
        signals: signalsByName,
        served_at: nowSec(),
      });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[UserModel] get failed: " + msg);
      return RpcHelpers.errorResponse("get failed: " + msg, 500);
    }
  }

  // ── RPC: user_model_signal_ingest ──────────────────────────────────────
  // The Unity client and the web frontend bulk-POST batches of allowed
  // events here. Each event bumps a per-event counter row in
  // qv_u_<userId>_signals. The kb-enrichment cron reads these counters
  // (plus quiz_results) to recompute derived attributes.
  //
  // Self-call only — we never let services impersonate users when
  // claiming behavioural signals (would let a bad actor inflate
  // "celebration_signal" to game the personality archetype).
  function rpcSignalIngest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var events = data && data.events;
      if (!events || !Array.isArray(events)) {
        return RpcHelpers.errorResponse("events array required", 400);
      }
      if (events.length === 0) {
        return RpcHelpers.successResponse({ accepted: 0, dropped: 0 });
      }
      if (events.length > MAX_SIGNALS_PER_INGEST) {
        return RpcHelpers.errorResponse(
          "too many events (max " + MAX_SIGNALS_PER_INGEST + " per call)", 400);
      }

      var signalCol = COLLECTION_SIGNALS_PREFIX + userId + COLLECTION_SIGNALS_SUFFIX;
      var accepted = 0;
      var dropped = 0;
      var writes: nkruntime.StorageWriteRequest[] = [];
      var ts = nowSec();

      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        if (!ev || typeof ev.name !== "string") { dropped++; continue; }
        if (!ALLOWED_SIGNALS[ev.name]) { dropped++; continue; }

        var existing = readObject(nk, userId, signalCol, ev.name) || {
          count: 0, first_at: ts, last_at: ts,
        };
        existing.count = (existing.count | 0) + 1;
        existing.last_at = ts;
        if (!existing.first_at) existing.first_at = ts;
        // Capture the latest props envelope (small; bounded) for ad-hoc
        // dashboarding — derivation jobs read counters, not props.
        existing.last_props = ev.props || null;

        writes.push({
          collection: signalCol,
          key: ev.name,
          userId: userId,
          value: existing,
          permissionRead: 1,
          permissionWrite: 0,
        });
        accepted++;
      }

      if (writes.length > 0) {
        nk.storageWrite(writes);
      }

      return RpcHelpers.successResponse({ accepted: accepted, dropped: dropped });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[UserModel] signal_ingest failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "user_model_signal_ingest", msg);
      return RpcHelpers.errorResponse("signal_ingest failed: " + msg, 500);
    }
  }

  // ── RPC: user_model_consent_set ────────────────────────────────────────
  // User-side toggle for any of the channel consents. Called from
  // /me/reveal and the in-app settings screen. Writes a full snapshot
  // (server-side merge with previous) so partial updates work.
  function rpcConsentSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var updates = data && data.consent;
      if (!updates || typeof updates !== "object") {
        return RpcHelpers.errorResponse("consent object required", 400);
      }

      var existing = readObject(nk, userId, COLLECTION_USER_MODEL, KEY_CONSENT) || defaultConsent();
      var merged: any = {};
      var defaults = defaultConsent();
      // Start from defaults, then overlay existing, then overlay updates.
      // This way new channels added later default to false even on old rows.
      for (var k in defaults) if (defaults.hasOwnProperty(k)) merged[k] = defaults[k];
      for (var k2 in existing) if (existing.hasOwnProperty(k2)) merged[k2] = existing[k2];
      for (var k3 in updates) {
        if (!updates.hasOwnProperty(k3)) continue;
        if (!ALLOWED_CHANNELS[k3]) continue;        // ignore unknown channels
        merged[k3] = !!updates[k3];
      }
      merged.updated_at = nowSec();

      nk.storageWrite([{
        collection: COLLECTION_USER_MODEL,
        key: KEY_CONSENT,
        userId: userId,
        value: merged,
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({ consent: merged });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[UserModel] consent_set failed: " + msg);
      return RpcHelpers.errorResponse("consent_set failed: " + msg, 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("user_model_get", rpcGet);
    initializer.registerRpc("user_model_signal_ingest", rpcSignalIngest);
    initializer.registerRpc("user_model_consent_set", rpcConsentSet);
  }
}
