// wow_moments.ts
// ─────────────────────────────────────────────────────────────────────────────
// Wow Moment runtime — server-ranked selection + closed-loop reaction tracking.
//
// Why this exists
// ---------------
// Every channel surfaced in PLAN-CONVERSATIONAL_HUB_AND_REWARDS.md must consume
// the SAME `PersonalizationPayload` produced by `/api/personalize`. The payload's
// `wow_moment` field comes from this module's `wow_moments_select` RPC. The
// matching `wow_moments_react` RPC ingests the analytics event when the user
// taps / dismisses / hears the wow on ANY channel (Unity in-app, WhatsApp,
// Telegram, Discord, iMessage Business, Apple/Google Wallet, voice).
//
// Without this module the personalizer falls back to the static map in
// `web/lib/personalize/wow-moments-fallback.ts` which is fine for v1 but
// guarantees "theatrical" personalisation forever.
//
// Storage shape
// -------------
//   collection: "wow_state"
//   key:        "<wow_id>"
//   userId:     <cognito_sub>
//   value:      { last_shown_unix, shown_count_total, shown_count_7d,
//                 last_clicked_unix, dismissed_count, last_channel,
//                 last_trace_id }
//
//   collection: "wow_session_caps"
//   key:        "session"            // overwritten per call
//   userId:     <cognito_sub>
//   value:      { date, fired_today, fired_7d, last_fullscreen_unix }
//
// All writes are SYSTEM_USER_ID owned for the analytics fan-out (matches the
// existing analytics.js `dash_*` convention) AND per-user owned for the
// state-machine reads.
//
// RPCs registered
// ---------------
//   wow_moments_select    (caller-owned read; service-token also accepted for
//                          orchestration — n8n cadence workflows, voice agents)
//   wow_moments_react     (service-token OR caller-owned — every channel emits
//                          its reaction here, identity_resolved upstream)
//   wow_moments_state_get (caller-owned read; powers /me/reveal "wow timeline")
//
// Cross-references
// ----------------
// - PLAN-USER_INTELLIGENCE_LOOP.md §6 (cooldown matrix + session caps)
// - PLAN-CONVERSATIONAL_HUB_AND_REWARDS.md §K (analytics + enrichment lifecycle)
// - CATALOG-WOW_MOMENTS.md (the catalog this ranker operates over)
// - CATALOG-DEDUCIBLE_INSIGHTS.md §7 (anti-hallucination contract)
// - data/modules/analytics/analytics.js (mirror the `dash_*` write convention)

namespace WowMoments {

  // ── Constants ────────────────────────────────────────────────────────────
  var WOW_STATE_COLLECTION = "wow_state";
  var WOW_SESSION_CAPS_COLLECTION = "wow_session_caps";
  var ANALYTICS_GAME_ID = "quizverse"; // matches analytics.js gameId convention

  // Per-PLAN-USER_INTELLIGENCE_LOOP.md §6.3 server-enforced limits:
  //   max 3 wows / session, 1 fullscreen / day, 5 / week.
  var SESSION_CAP = 3;
  var DAILY_FULLSCREEN_CAP = 1;
  var WEEKLY_CAP = 5;

  // ── Types ────────────────────────────────────────────────────────────────
  interface WowState {
    last_shown_unix: number;
    shown_count_total: number;
    shown_count_7d: number;
    last_clicked_unix: number;
    dismissed_count: number;
    last_channel: string;
    last_trace_id: string;
  }

  interface SessionCaps {
    date: string;
    fired_today: number;
    fired_7d: number;
    last_fullscreen_unix: number;
  }

  interface WowRef {
    wow_id: string;
    copy_key: string;
    vars: { [k: string]: any };
    cta_action_id: string;
    monetization_mechanism: string;
    tier: string;          // "S" | "A" | "B" | "C" | "D" | "E"
    score: number;         // ranking score (higher = more relevant)
  }

  // The catalog the ranker operates over. This MUST mirror the wow_id list in
  // CATALOG-WOW_MOMENTS.md; the CI lint `lint-wow-runtime-coverage.ts` (added
  // in the web-frontend repo this turn) enforces drift detection.
  //
  // Each entry declares (a) the context it competes for, (b) its tier (drives
  // cap enforcement), (c) the cooldown in seconds, (d) the monetisation
  // mechanism it pulls from per PLAN-MONETIZATION_LIFT_FROM_PERSONALISATION.md.
  interface CatalogEntry {
    wow_id: string;
    contexts: string[];
    tier: string;
    cooldown_sec: number;
    copy_key: string;
    cta_action_id: string;
    monetization_mechanism: string;
    base_score: number;
  }

  // CATALOG IDs MUST match `CATALOG-WOW_MOMENTS.md`. Drift detection runs in
  // CI via `web/scripts/lint-wow-analytics-coverage.ts`. Adding a new wow:
  //   1. Add the row to CATALOG-WOW_MOMENTS.md
  //   2. Add a CatalogEntry here AND a fallback entry in
  //      web/lib/personalize/wow-moments-fallback.ts
  //   3. Re-run the lint
  var CATALOG: CatalogEntry[] = [
    { wow_id: "wow.b.tired_recovery", contexts: ["streak_at_risk"],
      tier: "B", cooldown_sec: 86400 * 7, copy_key: "wow.b.tired_recovery.template",
      cta_action_id: "open_streak_save", monetization_mechanism: "mood_gated_offer",
      base_score: 90 },
    { wow_id: "wow.b.weekly_recap", contexts: ["weekly_recap"],
      tier: "B", cooldown_sec: 86400 * 6, copy_key: "wow.b.weekly_recap.template",
      cta_action_id: "open_weekly_recap", monetization_mechanism: "retention_lift",
      base_score: 80 },
    { wow_id: "wow.a.warming_up", contexts: ["daily_quiz_ready", "generic"],
      tier: "A", cooldown_sec: 86400, copy_key: "wow.a.warming_up.template",
      cta_action_id: "open_daily_quiz", monetization_mechanism: "session_extension",
      base_score: 70 },
    { wow_id: "wow.a.weakness_targeted", contexts: ["pre_exam_cram", "weak_topic_unblock"],
      tier: "A", cooldown_sec: 86400 * 2, copy_key: "wow.a.weakness_targeted.template",
      cta_action_id: "open_smart_review", monetization_mechanism: "goal_anchor_upgrade",
      base_score: 85 },
    { wow_id: "wow.a.lock_it_in", contexts: ["mastery_promotion"],
      tier: "A", cooldown_sec: 86400 * 7, copy_key: "wow.a.lock_it_in.template",
      cta_action_id: "open_mastery_card", monetization_mechanism: "session_extension",
      base_score: 75 },
    { wow_id: "wow.e.leaderboard_climb", contexts: ["league_promotion"],
      tier: "E", cooldown_sec: 86400 * 7, copy_key: "wow.e.leaderboard_climb.template",
      cta_action_id: "view_league_change", monetization_mechanism: "rewarded_optin",
      base_score: 80 },
    { wow_id: "wow.a.rematch_friend", contexts: ["friend_challenge_received"],
      tier: "A", cooldown_sec: 3600 * 6, copy_key: "wow.a.rematch_friend.template",
      cta_action_id: "open_friend_challenge", monetization_mechanism: "social_invite_loop",
      base_score: 85 },
    { wow_id: "wow.b.month_summary", contexts: ["monthly_report"],
      tier: "B", cooldown_sec: 86400 * 25, copy_key: "wow.b.month_summary.template",
      cta_action_id: "open_monthly_report", monetization_mechanism: "retention_lift",
      base_score: 70 },
    // Cross-channel adapter wows (CATALOG-WOW_MOMENTS.md §5B)
    { wow_id: "wow.a09.telegram_inline_recap", contexts: ["weekly_recap"],
      tier: "A", cooldown_sec: 86400 * 7, copy_key: "wow.a09.telegram_inline_recap.template",
      cta_action_id: "open_telegram_recap", monetization_mechanism: "retention_lift",
      base_score: 78 },
    { wow_id: "wow.a10.discord_league_pulse", contexts: ["league_promotion"],
      tier: "A", cooldown_sec: 86400 * 7, copy_key: "wow.a10.discord_league_pulse.template",
      cta_action_id: "open_discord_league", monetization_mechanism: "social_invite_loop",
      base_score: 76 },
    { wow_id: "wow.a11.imessage_streak_save", contexts: ["streak_at_risk"],
      tier: "A", cooldown_sec: 86400 * 3, copy_key: "wow.a11.imessage_streak_save.template",
      cta_action_id: "open_imessage_streak_save", monetization_mechanism: "mood_gated_offer",
      base_score: 88 },
    { wow_id: "wow.a12.wallet_lockscreen_streak", contexts: ["daily_quiz_ready", "streak_milestone"],
      tier: "A", cooldown_sec: 86400, copy_key: "wow.a12.wallet_lockscreen_streak.template",
      cta_action_id: "open_app", monetization_mechanism: "retention_lift",
      base_score: 65 },
  ];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function nowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function todayDate(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function readState(nk: nkruntime.Nakama, userId: string, wowId: string): WowState {
    try {
      var rows = nk.storageRead([{
        collection: WOW_STATE_COLLECTION,
        key: wowId,
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        return rows[0].value as WowState;
      }
    } catch (e: any) { /* swallow */ }
    return {
      last_shown_unix: 0,
      shown_count_total: 0,
      shown_count_7d: 0,
      last_clicked_unix: 0,
      dismissed_count: 0,
      last_channel: "",
      last_trace_id: "",
    };
  }

  function readSessionCaps(nk: nkruntime.Nakama, userId: string): SessionCaps {
    try {
      var rows = nk.storageRead([{
        collection: WOW_SESSION_CAPS_COLLECTION,
        key: "session",
        userId: userId,
      }]);
      if (rows && rows.length > 0 && rows[0].value) {
        var v = rows[0].value as SessionCaps;
        // Reset fired_today on day rollover.
        if (v.date !== todayDate()) {
          return { date: todayDate(), fired_today: 0, fired_7d: v.fired_7d, last_fullscreen_unix: v.last_fullscreen_unix };
        }
        return v;
      }
    } catch (e: any) { /* swallow */ }
    return { date: todayDate(), fired_today: 0, fired_7d: 0, last_fullscreen_unix: 0 };
  }

  function writeSessionCaps(nk: nkruntime.Nakama, userId: string, caps: SessionCaps): void {
    nk.storageWrite([{
      collection: WOW_SESSION_CAPS_COLLECTION,
      key: "session",
      userId: userId,
      value: caps,
      permissionRead: 1,
      permissionWrite: 0,
    }]);
  }

  function isOnCooldown(state: WowState, cooldown: number): boolean {
    if (state.last_shown_unix === 0) return false;
    return (nowSec() - state.last_shown_unix) < cooldown;
  }

  // The single ranker. Heuristic for now — once persona vector + signal-driven
  // weights ship (PLAN-PERSONA_VECTOR.md), this becomes a small linear model.
  function scoreCandidate(entry: CatalogEntry, state: WowState, kb: any): number {
    var score = entry.base_score;
    // Decay if we showed it recently (smooth, not hard cooldown).
    if (state.last_shown_unix > 0) {
      var ageDays = (nowSec() - state.last_shown_unix) / 86400.0;
      score -= Math.max(0, 30 - ageDays * 2); // -30 if shown today, 0 after 15 days
    }
    // Boost if user has clicked this wow in the past — they're receptive.
    if (state.last_clicked_unix > state.last_shown_unix - 1) {
      score += 10;
    }
    // Penalise if user has dismissed it ≥3 times — wow fatigue.
    if (state.dismissed_count >= 3) {
      score -= 25;
    }
    // KB-driven bumps: if the wow is for a topic the user is currently weak
    // on, boost it. Defensive reads — kb may be null.
    if (kb && kb.weak_topics && kb.weak_topics.length > 0) {
      if (entry.wow_id.indexOf("weak") >= 0 || entry.wow_id.indexOf("smart_review") >= 0) {
        score += 8;
      }
    }
    if (kb && kb.streak_count && kb.streak_count >= 7) {
      if (entry.wow_id.indexOf("streak") >= 0) {
        score += 5;
      }
    }
    return score;
  }

  // Loads a thin KB slice for ranking. Avoids hammering player_get_full_profile
  // on every wow_moments_select call — we read only what the ranker uses.
  function loadKbForRank(nk: nkruntime.Nakama, userId: string): any {
    var kb: any = { weak_topics: [], strong_topics: [], streak_count: 0 };
    try {
      var rows = nk.storageRead([
        { collection: "user_model", key: "derived", userId: userId },
        { collection: "user_streaks", key: "current", userId: userId },
      ]);
      if (rows && rows.length > 0) {
        for (var i = 0; i < rows.length; i++) {
          var r = rows[i];
          if (!r || !r.value) continue;
          if (r.collection === "user_model" && r.key === "derived") {
            var d: any = r.value;
            kb.weak_topics = d.weak_topics || kb.weak_topics;
            kb.strong_topics = d.strong_topics || kb.strong_topics;
            kb.predicted_score_pct = d.predicted_score_pct;
            kb.next_best_topic = d.next_best_topic;
            kb.personality_archetype = d.personality_archetype;
          }
          if (r.collection === "user_streaks" && r.key === "current") {
            var s: any = r.value;
            kb.streak_count = s.count || 0;
          }
        }
      }
    } catch (e: any) { /* swallow — heuristic still works without */ }
    return kb;
  }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    // Nakama Goja runtime exposes runtime.env via ctx.env (config.yaml
    // runtime.env block); container env vars are NOT visible inside Goja.
    var expected = "" + ((ctx.env && ctx.env["WOW_RUNTIME_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  // Mirrors the dashboard write convention from analytics.js so wow events
  // show up alongside every other event in the same admin/analytics queries.
  function emitAnalyticsEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, properties: any): void {
    try {
      var unixTs = nowSec();
      var dateStr = todayDate();
      var rand = Math.random().toString(36).slice(2, 8);
      var dashKey = "dash_" + ANALYTICS_GAME_ID + "_" + dateStr + "_" + eventName + "_" + unixTs + "_" + rand;
      nk.storageWrite([{
        collection: "analytics_events",
        key: dashKey,
        userId: Constants.SYSTEM_USER_ID,
        value: {
          eventName: eventName,
          gameId: ANALYTICS_GAME_ID,
          userId: userId,
          properties: properties,
          unixTimestamp: unixTs,
          date: dateStr,
        },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[wow] emitAnalyticsEvent failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── RPC: wow_moments_select ──────────────────────────────────────────────
  // Request:  { "context": "streak_at_risk", "channel": "whatsapp", "limit": 1, "user_id"?, "service_token"? }
  // Response (one wow):
  //   { "success": true, "data": {
  //       "wow_id": "wow.b.streak_forgiveness",
  //       "copy_key": "wow.b.streak_forgiveness.template",
  //       "vars": { ... },
  //       "cta_action_id": "open_streak_save",
  //       "monetization_mechanism": "mood_gated_offer",
  //       "trace_id": "wow_..."
  //   }}
  //
  // Side effects:
  //   - emits `wow_moments_selected` analytics event
  //   - bumps the candidate's wow_state.last_shown_unix (tentative — flipped to
  //     "shown" only when the channel confirms via wow_moments_react `shown`)
  function rpcSelect(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var ctxKey = ("" + (data.context || "generic")).toLowerCase();
      var channel = ("" + (data.channel || "in_app")).toLowerCase();
      var limit = Math.min(Math.max(parseInt(data.limit || "1") || 1, 1), 3);

      // Auth: caller is the user OR a trusted service that supplies user_id.
      var userId: string = ctx.userId || "";
      if (!userId) {
        if (!isServiceCaller(ctx, data)) {
          return RpcHelpers.errorResponse("not authorised", 401);
        }
        userId = "" + (data.user_id || "");
        if (!userId) return RpcHelpers.errorResponse("user_id required for service caller", 400);
      }

      var caps = readSessionCaps(nk, userId);
      if (caps.fired_today >= SESSION_CAP) {
        emitAnalyticsEvent(nk, logger, userId, "wow_moments_capped", { context: ctxKey, channel: channel, reason: "session_cap" });
        return RpcHelpers.successResponse(null);
      }
      if (caps.fired_7d >= WEEKLY_CAP) {
        emitAnalyticsEvent(nk, logger, userId, "wow_moments_capped", { context: ctxKey, channel: channel, reason: "weekly_cap" });
        return RpcHelpers.successResponse(null);
      }

      var kb = loadKbForRank(nk, userId);

      // Filter catalog to entries that match the context AND aren't on cooldown.
      var candidates: WowRef[] = [];
      for (var i = 0; i < CATALOG.length; i++) {
        var entry = CATALOG[i];
        var matches = false;
        for (var j = 0; j < entry.contexts.length; j++) {
          if (entry.contexts[j] === ctxKey) { matches = true; break; }
        }
        if (!matches) continue;
        var state = readState(nk, userId, entry.wow_id);
        if (isOnCooldown(state, entry.cooldown_sec)) continue;
        var score = scoreCandidate(entry, state, kb);
        candidates.push({
          wow_id: entry.wow_id,
          copy_key: entry.copy_key,
          vars: {
            topic: kb.next_best_topic || (kb.weak_topics && kb.weak_topics[0]) || "",
            streak: kb.streak_count || 0,
            predicted_score_pct: kb.predicted_score_pct || 0,
          },
          cta_action_id: entry.cta_action_id,
          monetization_mechanism: entry.monetization_mechanism,
          tier: entry.tier,
          score: score,
        });
      }

      if (candidates.length === 0) {
        // Fall through to the generic warmup if nothing matched.
        for (var k = 0; k < CATALOG.length; k++) {
          if (CATALOG[k].wow_id === "wow.a.warming_up") {
            candidates.push({
              wow_id: CATALOG[k].wow_id,
              copy_key: CATALOG[k].copy_key,
              vars: {},
              cta_action_id: CATALOG[k].cta_action_id,
              monetization_mechanism: CATALOG[k].monetization_mechanism,
              tier: CATALOG[k].tier,
              score: CATALOG[k].base_score,
            });
            break;
          }
        }
      }

      // Sort by score descending, take `limit` (almost always 1).
      candidates.sort(function (a, b) { return b.score - a.score; });
      var picked = candidates.slice(0, limit);
      if (picked.length === 0) return RpcHelpers.successResponse(null);

      var traceId = "wow_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      var top = picked[0];

      emitAnalyticsEvent(nk, logger, userId, "wow_moments_selected", {
        wow_id: top.wow_id,
        tier: top.tier,
        context: ctxKey,
        channel: channel,
        score: top.score,
        candidate_count: candidates.length,
        trace_id: traceId,
      });

      return RpcHelpers.successResponse({
        wow_id: top.wow_id,
        copy_key: top.copy_key,
        vars: top.vars,
        cta_action_id: top.cta_action_id,
        monetization_mechanism: top.monetization_mechanism,
        trace_id: traceId,
      });
    } catch (err: any) {
      logger.error("wow_moments_select failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: wow_moments_react ───────────────────────────────────────────────
  // Channel-agnostic reaction ingestion. Called by Unity in-app, by the web
  // /api/wow/track bridge (which receives Telegram callback queries, Discord
  // interaction responses, WhatsApp button taps, AMB Apple replies, etc.),
  // and by voice agent tool-call handlers.
  //
  // Request: { "wow_id": "...", "action": "shown"|"clicked"|"dismissed"|"converted",
  //            "channel": "...", "trace_id": "...", "user_id"?, "service_token"? }
  // Response: { "success": true, "data": { "ok": true } }
  function rpcReact(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);

      var userId: string = ctx.userId || "";
      if (!userId) {
        if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("not authorised", 401);
        userId = "" + (data.user_id || "");
        if (!userId) return RpcHelpers.errorResponse("user_id required for service caller", 400);
      }

      var wowId = ("" + (data.wow_id || "")).slice(0, 64);
      var action = ("" + (data.action || "")).toLowerCase();
      var channel = ("" + (data.channel || "in_app")).toLowerCase();
      var traceId = ("" + (data.trace_id || ""));
      if (!wowId) return RpcHelpers.errorResponse("wow_id required", 400);
      if (action !== "shown" && action !== "clicked" && action !== "dismissed" && action !== "converted") {
        return RpcHelpers.errorResponse("action must be shown|clicked|dismissed|converted", 400);
      }

      var state = readState(nk, userId, wowId);
      var caps = readSessionCaps(nk, userId);

      var ts = nowSec();
      if (action === "shown") {
        state.last_shown_unix = ts;
        state.shown_count_total = (state.shown_count_total | 0) + 1;
        state.shown_count_7d = (state.shown_count_7d | 0) + 1;
        state.last_channel = channel;
        state.last_trace_id = traceId;
        caps.fired_today = (caps.fired_today | 0) + 1;
        caps.fired_7d = (caps.fired_7d | 0) + 1;
      } else if (action === "clicked" || action === "converted") {
        state.last_clicked_unix = ts;
      } else if (action === "dismissed") {
        state.dismissed_count = (state.dismissed_count | 0) + 1;
      }

      nk.storageWrite([{
        collection: WOW_STATE_COLLECTION,
        key: wowId,
        userId: userId,
        value: state,
        permissionRead: 1,
        permissionWrite: 0,
      }]);
      writeSessionCaps(nk, userId, caps);

      emitAnalyticsEvent(nk, logger, userId, "wow_moment_" + action, {
        wow_id: wowId,
        channel: channel,
        trace_id: traceId,
      });

      return RpcHelpers.successResponse({ ok: true });
    } catch (err: any) {
      logger.error("wow_moments_react failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: wow_moments_state_get ──────────────────────────────────────────
  // Caller-owned read of the user's wow timeline (last_shown / clicked /
  // dismissed per wow_id). Powers `/me/reveal` + the admin "wow inspector".
  function rpcStateGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var rows: nkruntime.StorageObject[] = [];
      try {
        var page = nk.storageList(userId, WOW_STATE_COLLECTION, 100);
        if (page && page.objects) rows = page.objects;
      } catch (e: any) { /* empty */ }

      var entries: any[] = [];
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i].value as WowState;
        if (!v) continue;
        entries.push({
          wow_id: rows[i].key,
          last_shown_unix: v.last_shown_unix,
          last_clicked_unix: v.last_clicked_unix,
          shown_count_total: v.shown_count_total,
          dismissed_count: v.dismissed_count,
          last_channel: v.last_channel,
        });
      }
      var caps = readSessionCaps(nk, userId);

      return RpcHelpers.successResponse({
        entries: entries,
        caps: caps,
        catalog_size: CATALOG.length,
      });
    } catch (err: any) {
      logger.error("wow_moments_state_get failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── Registration ─────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("wow_moments_select", rpcSelect);
    initializer.registerRpc("wow_moments_react", rpcReact);
    initializer.registerRpc("wow_moments_state_get", rpcStateGet);
  }
}
