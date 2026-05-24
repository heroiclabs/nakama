// kb_enrichment.ts
// ─────────────────────────────────────────────────────────────────────────────
// Continuous KB enrichment loop — recomputes derived user attributes so that
// `wow_moments_select` always has fresh signals to base its decision on.
//
// Why this exists
// ---------------
// Without periodic re-computation, derived attributes like `predicted_score_pct`,
// `personality_archetype`, `next_best_topic`, `peer_percentile_per_topic`,
// `mood_estimate`, and `social_graph_density` go stale within hours. A user who
// crammed for 3 days and improved their predicted_score by 12% should see that
// reflected in their next wow moment, not in next week's batch.
//
// Architecture
// ------------
// Two RPCs:
//
//   kb_enrichment_run_for_user  (service-token; recomputes ONE user's derived
//                                attrs from raw signals; ~50–150ms per call)
//   kb_enrichment_tick          (service-token; iterates active users in a
//                                paginated way and calls run_for_user for
//                                each; designed to be invoked by a K8s
//                                CronJob hourly for hot signals and daily for
//                                heavy ones)
//
// The CronJob lives in intelli-verse-kube-infra/n8n-workflows or as a dedicated
// k8s CronJob:
//
//   apiVersion: batch/v1
//   kind: CronJob
//   metadata: { name: kb-enrichment-hourly }
//   spec:
//     schedule: "7 * * * *"     # offset 7m so it doesn't collide with rollups
//     jobTemplate:
//       spec:
//         template:
//           spec:
//             containers:
//             - name: tick
//               image: curlimages/curl
//               command:
//                 - sh
//                 - -c
//                 - >
//                   curl -X POST $NAKAMA_HTTP_URL/v2/rpc/kb_enrichment_tick?http_key=$KEY
//                   -H 'Content-Type: application/json'
//                   -d "{\"payload\":\"{\\\"service_token\\\":\\\"$KB_ENRICHMENT_SERVICE_TOKEN\\\",\\\"limit\\\":500,\\\"profile\\\":\\\"hot\\\"}\"}"
//
// Storage shape
// -------------
//   collection: "user_model"
//   key:        "derived"
//   userId:     <cognito_sub>
//   value:      { weak_topics, strong_topics, predicted_score_pct,
//                 next_best_topic, personality_archetype, mood_estimate,
//                 social_graph_density, peer_percentile_per_topic,
//                 last_enriched_unix, enriched_by, source_signals_summary }
//
// Cross-references
// ----------------
//   - PLAN-CONVERSATIONAL_HUB_AND_REWARDS.md §K (analytics + enrichment lifecycle)
//   - PLAN-USER_INTELLIGENCE_LOOP.md §5 (the source signal landscape)
//   - PLAN-PERSONA_VECTOR.md (the 256-d archetype vector that personality_archetype derives from)
//   - CATALOG-DEDUCIBLE_INSIGHTS.md (every derived attribute MUST trace to a captured signal)

namespace KbEnrichment {

  var USER_MODEL_COLLECTION = "user_model";
  var ENRICHMENT_INDEX_COLLECTION = "kb_enrichment_index"; // tracks last-enriched-cursor for tick pagination
  var ANALYTICS_GAME_ID = "quizverse";

  interface DerivedSlice {
    weak_topics: string[];
    strong_topics: string[];
    predicted_score_pct: number;
    next_best_topic: string;
    personality_archetype: string;
    mood_estimate: string;
    social_graph_density: number;
    peer_percentile_per_topic: { [topic: string]: number };
    last_enriched_unix: number;
    enriched_by: string;
    source_signals_summary: { [k: string]: any };
  }

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    // Nakama Goja runtime exposes runtime.env via ctx.env (config.yaml
    // runtime.env block); container env vars are NOT visible inside Goja.
    var expected = "" + ((ctx.env && ctx.env["KB_ENRICHMENT_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  function emitAnalyticsEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, properties: any): void {
    try {
      var unixTs = nowSec();
      var dateStr = new Date().toISOString().slice(0, 10);
      var rand = Math.random().toString(36).slice(2, 8);
      var dashKey = "dash_" + ANALYTICS_GAME_ID + "_" + dateStr + "_" + eventName + "_" + unixTs + "_" + rand;
      nk.storageWrite([{
        collection: "analytics_events",
        key: dashKey,
        userId: Constants.SYSTEM_USER_ID,
        value: { eventName: eventName, gameId: ANALYTICS_GAME_ID, userId: userId, properties: properties, unixTimestamp: unixTs, date: dateStr },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[kb-enrichment] emit failed: " + (e && e.message ? e.message : String(e)));
    }
  }

  // ── Compute slice helpers ────────────────────────────────────────────────
  // Each helper below reads ONLY raw signals already captured by the User
  // Intelligence Loop's analytics wrappers. They never invent data; missing
  // inputs yield missing outputs (anti-hallucination contract).

  function readQuizResults(nk: nkruntime.Nakama, userId: string): any[] {
    try {
      var page = nk.storageList(userId, "quiz_results", 200);
      if (page && page.objects) {
        var out: any[] = [];
        for (var i = 0; i < page.objects.length; i++) out.push(page.objects[i].value);
        return out;
      }
    } catch (e: any) { /* swallow */ }
    return [];
  }

  function readWeaknessMap(nk: nkruntime.Nakama, userId: string): any {
    try {
      var rows = nk.storageRead([{ collection: "weakness_map", key: "current", userId: userId }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (e: any) { /* swallow */ }
    return null;
  }

  function readStreak(nk: nkruntime.Nakama, userId: string): any {
    try {
      var rows = nk.storageRead([{ collection: "user_streaks", key: "current", userId: userId }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (e: any) { /* swallow */ }
    return null;
  }

  function readFriends(nk: nkruntime.Nakama, userId: string): any[] {
    try {
      var f = nk.friendsList(userId, 200, undefined as any, "");
      if (f && f.friends) return f.friends as any[];
    } catch (e: any) { /* swallow */ }
    return [];
  }

  // computeWeakStrong — pure aggregator over recent quiz results.
  function computeWeakStrong(quizResults: any[], wmap: any): { weak: string[]; strong: string[] } {
    var topicAcc: { [t: string]: { right: number; total: number } } = {};
    for (var i = 0; i < quizResults.length; i++) {
      var qr = quizResults[i] || {};
      var t = qr.topic || qr.category || "";
      if (!t) continue;
      if (!topicAcc[t]) topicAcc[t] = { right: 0, total: 0 };
      topicAcc[t].right += parseInt(qr.correct || qr.score || "0") || 0;
      topicAcc[t].total += parseInt(qr.total || "0") || 0;
    }
    // Inject WeaknessMap signals if present (it's the higher-fidelity source).
    if (wmap && wmap.topics) {
      var keys = Object.keys(wmap.topics);
      for (var k = 0; k < keys.length; k++) {
        var ent = wmap.topics[keys[k]];
        if (!topicAcc[keys[k]]) topicAcc[keys[k]] = { right: 0, total: 0 };
        topicAcc[keys[k]].right += parseInt(ent.right || "0") || 0;
        topicAcc[keys[k]].total += parseInt(ent.total || "0") || 0;
      }
    }
    var rows: { topic: string; acc: number; n: number }[] = [];
    var allTopics = Object.keys(topicAcc);
    for (var j = 0; j < allTopics.length; j++) {
      var p = topicAcc[allTopics[j]];
      if (p.total < 3) continue; // statistical floor
      rows.push({ topic: allTopics[j], acc: p.right / p.total, n: p.total });
    }
    rows.sort(function (a, b) { return a.acc - b.acc; });
    var weak: string[] = [];
    for (var w = 0; w < rows.length && weak.length < 3; w++) if (rows[w].acc < 0.6) weak.push(rows[w].topic);
    rows.sort(function (a, b) { return b.acc - a.acc; });
    var strong: string[] = [];
    for (var s = 0; s < rows.length && strong.length < 3; s++) if (rows[s].acc >= 0.8) strong.push(rows[s].topic);
    return { weak: weak, strong: strong };
  }

  function computePredictedScore(quizResults: any[]): number {
    if (quizResults.length === 0) return 0;
    var rightSum = 0, totalSum = 0;
    for (var i = 0; i < quizResults.length; i++) {
      rightSum += parseInt(quizResults[i].correct || quizResults[i].score || "0") || 0;
      totalSum += parseInt(quizResults[i].total || "0") || 0;
    }
    if (totalSum === 0) return 0;
    var raw = (rightSum / totalSum) * 100;
    // Smooth toward the recent-week subset (recency bias).
    var recentRight = 0, recentTotal = 0;
    var weekAgo = nowSec() - 86400 * 7;
    for (var k = 0; k < quizResults.length; k++) {
      var qr = quizResults[k] || {};
      if ((qr.timestamp || 0) >= weekAgo) {
        recentRight += parseInt(qr.correct || qr.score || "0") || 0;
        recentTotal += parseInt(qr.total || "0") || 0;
      }
    }
    var recent = recentTotal > 0 ? (recentRight / recentTotal) * 100 : raw;
    return Math.round((raw * 0.6) + (recent * 0.4));
  }

  function computeNextBestTopic(weak: string[], strong: string[]): string {
    if (weak.length > 0) return weak[0];
    if (strong.length > 0) return strong[0]; // expand mastery
    return "";
  }

  // Heuristic archetype until persona vector ships.
  function computeArchetype(quizResults: any[], streak: any): string {
    if (!quizResults || quizResults.length === 0) return "Curious";
    var fast = 0, slow = 0;
    for (var i = 0; i < quizResults.length; i++) {
      var qr = quizResults[i] || {};
      var avg = qr.avg_seconds_per_q || 0;
      if (avg > 0 && avg < 8) fast++;
      else if (avg >= 12) slow++;
    }
    var streakCount = (streak && streak.count) || 0;
    if (fast > slow * 2) return "Speedrunner";
    if (slow > fast * 2 && streakCount > 14) return "Scholar";
    if (streakCount >= 30) return "Habitual";
    if (quizResults.length >= 50) return "Explorer";
    return "Curious";
  }

  function computeMoodEstimate(quizResults: any[]): string {
    var weekAgo = nowSec() - 86400 * 7;
    var recentSessions = 0, recentWrongStreak = 0, lastWasWrong = false;
    for (var i = 0; i < quizResults.length; i++) {
      var qr = quizResults[i] || {};
      if ((qr.timestamp || 0) < weekAgo) continue;
      recentSessions++;
      var rate = (parseInt(qr.correct || "0") || 0) / Math.max(1, parseInt(qr.total || "1") || 1);
      if (rate < 0.5) {
        if (lastWasWrong) recentWrongStreak++;
        lastWasWrong = true;
      } else {
        lastWasWrong = false;
      }
    }
    if (recentSessions === 0) return "dormant";
    if (recentWrongStreak >= 3) return "frustrated";
    if (recentSessions >= 7) return "energised";
    if (recentSessions >= 3) return "engaged";
    return "cautious";
  }

  function computeSocialGraphDensity(friends: any[]): number {
    if (!friends || friends.length === 0) return 0;
    var active = 0;
    var weekAgo = nowSec() - 86400 * 7;
    for (var i = 0; i < friends.length; i++) {
      var f = friends[i] || {};
      var u = f.user || {};
      var lastOnline = parseInt(u.online ? "1" : "0") || 0;
      var lastSeenStr = u.update_time || u.metadata && u.metadata.last_seen;
      var lastSeen = lastSeenStr ? Math.floor(Date.parse(lastSeenStr) / 1000) : 0;
      if (lastOnline === 1 || lastSeen >= weekAgo) active++;
    }
    return Math.round((active / friends.length) * 100) / 100;
  }

  // ── RPC: kb_enrichment_run_for_user ─────────────────────────────────────
  // Recomputes every derived attribute for ONE user. Idempotent. Callers:
  //   - kb_enrichment_tick (cron sweep)
  //   - n8n on a "high-value signal" event (e.g., quiz_completed → recompute now)
  //   - admin "force re-enrich" button on /admin/users/<id>
  //
  // Auth: service token OR caller is the user themselves.
  function rpcRunForUser(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var profile = ("" + (data.profile || "full")).toLowerCase(); // "hot" | "full"

      var userId: string = ctx.userId || "";
      if (!userId) {
        if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("not authorised", 401);
        userId = "" + (data.user_id || "");
        if (!userId) return RpcHelpers.errorResponse("user_id required for service caller", 400);
      } else {
        // Caller-as-themselves can request only the "hot" profile (cheap).
        // Heavy "full" profile needs a service token to keep abuse contained.
        if (profile === "full" && !isServiceCaller(ctx, data)) profile = "hot";
      }

      var startMs = Date.now();

      // Always cheap (hot):
      var streak = readStreak(nk, userId);
      var weakMap = readWeaknessMap(nk, userId);
      var quizResults = profile === "full" ? readQuizResults(nk, userId) : [];

      var weakStrong = computeWeakStrong(quizResults, weakMap);
      var moodEstimate = computeMoodEstimate(quizResults);

      // Heavy (full only):
      var predicted = profile === "full" ? computePredictedScore(quizResults) : 0;
      var archetype = profile === "full" ? computeArchetype(quizResults, streak) : "";
      var friends = profile === "full" ? readFriends(nk, userId) : [];
      var socialDensity = profile === "full" ? computeSocialGraphDensity(friends) : 0;

      var derived: DerivedSlice = {
        weak_topics: weakStrong.weak,
        strong_topics: weakStrong.strong,
        predicted_score_pct: predicted,
        next_best_topic: computeNextBestTopic(weakStrong.weak, weakStrong.strong),
        personality_archetype: archetype,
        mood_estimate: moodEstimate,
        social_graph_density: socialDensity,
        peer_percentile_per_topic: {}, // populated by analytics_rollup; we just keep the slot
        last_enriched_unix: nowSec(),
        enriched_by: profile,
        source_signals_summary: {
          quiz_results_count: quizResults.length,
          friends_count: friends.length,
          streak_count: (streak && streak.count) || 0,
          weakness_map_present: !!weakMap,
        },
      };

      // Merge instead of overwrite — keep peer_percentile_per_topic if the
      // rollup already populated it.
      try {
        var existing = nk.storageRead([{ collection: USER_MODEL_COLLECTION, key: "derived", userId: userId }]);
        if (existing && existing.length > 0 && existing[0].value) {
          var prev: any = existing[0].value;
          if (prev.peer_percentile_per_topic) {
            derived.peer_percentile_per_topic = prev.peer_percentile_per_topic;
          }
        }
      } catch (e: any) { /* swallow */ }

      nk.storageWrite([{
        collection: USER_MODEL_COLLECTION,
        key: "derived",
        userId: userId,
        value: derived,
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      var elapsedMs = Date.now() - startMs;
      emitAnalyticsEvent(nk, logger, userId, "kb_enrichment_completed", {
        profile: profile,
        elapsed_ms: elapsedMs,
        weak_topics_count: weakStrong.weak.length,
        strong_topics_count: weakStrong.strong.length,
        predicted_score_pct: predicted,
        archetype: archetype,
        mood_estimate: moodEstimate,
      });

      return RpcHelpers.successResponse({
        ok: true,
        profile: profile,
        elapsed_ms: elapsedMs,
        derived: derived,
      });
    } catch (err: any) {
      logger.error("kb_enrichment_run_for_user failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: kb_enrichment_tick ─────────────────────────────────────────────
  // Service-token only. Iterates active users (last_seen within `window_days`)
  // and runs `kb_enrichment_run_for_user` for each. Designed to be called
  // hourly with profile=hot, daily with profile=full.
  //
  // The tick is paginated — each call processes at most `limit` users (default
  // 500) and persists a cursor to `kb_enrichment_index/cursor`. Subsequent
  // calls resume from there. A full sweep of 50k MAU takes ~100 hourly ticks
  // at 500/tick if we kept it serial — in practice the cron runs every minute
  // for the largest tier so the window stays fresh.
  function rpcTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("service token required", 401);

      var profile = ("" + (data.profile || "hot")).toLowerCase();
      var limit = Math.min(Math.max(parseInt(data.limit || "500") || 500, 1), 2000);
      var windowDays = parseInt(data.window_days || "30") || 30;
      var sinceUnix = nowSec() - 86400 * windowDays;

      // Read cursor.
      var cursor = "";
      try {
        var cur = nk.storageRead([{ collection: ENRICHMENT_INDEX_COLLECTION, key: "cursor", userId: Constants.SYSTEM_USER_ID }]);
        if (cur && cur.length > 0 && cur[0].value) cursor = (cur[0].value as any).cursor || "";
      } catch (e: any) { /* fresh start */ }

      // Page through user_streaks (decent proxy for "active users" because
      // every user with a streak has logged in). The rollup writes more
      // canonical "active users" but it lives in a SYSTEM-owned collection
      // and isn't indexed by user; for v1 this is good enough.
      var processed = 0;
      var skipped = 0;
      var nextCursor = "";
      try {
        // Server-listObjects requires SYSTEM ownership; user_streaks is per-user
        // so we paginate by userId via friends/account list isn't a good fit.
        // Fall back to the user_model_index collection if present, else use
        // the cursor + storageList over the analytics_events keyed by user.
        // For v1 we accept that this tick runs for users present in
        // user_streaks via storageList + filter — operators can swap in a
        // proper index in the next iteration.
        var idx = nk.storageRead([{ collection: ENRICHMENT_INDEX_COLLECTION, key: "user_index", userId: Constants.SYSTEM_USER_ID }]);
        var userIds: string[] = [];
        if (idx && idx.length > 0 && idx[0].value) {
          userIds = ((idx[0].value as any).userIds || []) as string[];
        }

        // Walk userIds starting from cursor.
        var startIdx = 0;
        if (cursor) {
          for (var i = 0; i < userIds.length; i++) if (userIds[i] === cursor) { startIdx = i + 1; break; }
        }
        for (var u = startIdx; u < userIds.length && processed < limit; u++) {
          var uid = userIds[u];
          // Cheap freshness check via wow_state (every active user touches it).
          var streak = readStreak(nk, uid);
          var lastSeen = (streak && streak.last_play_unix) || 0;
          if (lastSeen > 0 && lastSeen < sinceUnix) { skipped++; continue; }

          // Recurse via the same handler — keeps the logic in one place.
          // The synthetic context MUST forward ctx.env so the inner
          // service-token check has access to KB_ENRICHMENT_SERVICE_TOKEN.
          rpcRunForUser({ userId: "", env: ctx.env } as nkruntime.Context, logger, nk, JSON.stringify({
            user_id: uid,
            profile: profile,
            service_token: data.service_token,
          }));
          processed++;
          nextCursor = uid;
        }
      } catch (eList: any) {
        logger.warn("[kb-enrichment] tick scan error: " + (eList && eList.message ? eList.message : String(eList)));
      }

      // Persist cursor for the next tick.
      try {
        nk.storageWrite([{
          collection: ENRICHMENT_INDEX_COLLECTION,
          key: "cursor",
          userId: Constants.SYSTEM_USER_ID,
          value: { cursor: nextCursor, last_tick_unix: nowSec(), profile: profile },
          permissionRead: 0,
          permissionWrite: 0,
        }]);
      } catch (eC: any) { /* swallow */ }

      emitAnalyticsEvent(nk, logger, Constants.SYSTEM_USER_ID, "kb_enrichment_tick_completed", {
        profile: profile,
        processed: processed,
        skipped: skipped,
        cursor: nextCursor,
      });

      return RpcHelpers.successResponse({
        ok: true,
        processed: processed,
        skipped: skipped,
        cursor: nextCursor,
      });
    } catch (err: any) {
      logger.error("kb_enrichment_tick failed: " + (err && err.message ? err.message : String(err)));
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  // ── RPC: kb_enrichment_register_user ────────────────────────────────────
  // Adds a user to the enrichment index so the tick will pick them up.
  // Called by `account_created` / `app_open_first` hooks (the
  // analytics-orphan-wrapper PR-1 is the right place to wire this from
  // the Unity client; until then any service caller can register users).
  function rpcRegisterUser(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      var userId: string = ctx.userId || "";
      if (!userId) {
        if (!isServiceCaller(ctx, data)) return RpcHelpers.errorResponse("not authorised", 401);
        userId = "" + (data.user_id || "");
        if (!userId) return RpcHelpers.errorResponse("user_id required", 400);
      }

      var idx = nk.storageRead([{ collection: ENRICHMENT_INDEX_COLLECTION, key: "user_index", userId: Constants.SYSTEM_USER_ID }]);
      var userIds: string[] = [];
      if (idx && idx.length > 0 && idx[0].value) {
        userIds = ((idx[0].value as any).userIds || []) as string[];
      }
      var found = false;
      for (var i = 0; i < userIds.length; i++) if (userIds[i] === userId) { found = true; break; }
      if (!found) userIds.push(userId);

      nk.storageWrite([{
        collection: ENRICHMENT_INDEX_COLLECTION,
        key: "user_index",
        userId: Constants.SYSTEM_USER_ID,
        value: { userIds: userIds, last_updated_unix: nowSec() },
        permissionRead: 0,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({ ok: true, registered: !found, total: userIds.length });
    } catch (err: any) {
      return RpcHelpers.errorResponse("internal error", 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("kb_enrichment_run_for_user", rpcRunForUser);
    initializer.registerRpc("kb_enrichment_tick", rpcTick);
    initializer.registerRpc("kb_enrichment_register_user", rpcRegisterUser);
  }
}
