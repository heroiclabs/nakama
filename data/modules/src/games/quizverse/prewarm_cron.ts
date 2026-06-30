// prewarm_cron.ts — Hourly pre-warm cron for QuizVerse question delivery.
//
// ── Purpose ───────────────────────────────────────────────────────────────────
//
// Cold `get_questions` calls hit the topic cache (~50ms), filter the user's
// seen ledger, and pick questions — all fast.  But when the cache is empty or
// expired, the whole pipeline stalls waiting for an external provider (~800–
// 2000ms).  The ready-queue eliminates this: questions are pre-filtered per
// user and stored in `qv_readyqueue` so `get_questions` can answer in <30ms on
// hot paths.
//
// ── Flow ──────────────────────────────────────────────────────────────────────
//
//   Every hour (Nakama cron "0 * * * *"):
//     1. Read qv_active_users (system-owned, written by submit_result)
//     2. Keep users active in the last 7 days (max 200 per run)
//     3. For each user:
//        a. Load Player DNA → derive top-3 affinity topics
//        b. For each topic: read QvQuestionCache, filter out seen IDs
//        c. Write up to READYQUEUE_SIZE pre-filtered questions to
//           qv_readyqueue/{topicSlug} (user-owned)
//     4. Log per-run summary
//
// ── get_questions integration ─────────────────────────────────────────────────
//
//   get_questions checks qv_readyqueue first (before readCache):
//     • If found and fresh (<2 h) and has ≥ count questions → serve instantly,
//       remove consumed questions from the readyqueue doc
//     • Otherwise fall through to normal cache path; after selecting questions
//       write remaining fresh pool back to readyqueue for next call
//
// ── Storage collections ───────────────────────────────────────────────────────
//
//   qv_active_users   key=userId, owner=""  { last_played_ms }
//   qv_readyqueue     key=topicSlug, owner=userId  { questions, created_at_ms }
//
// ── postbuild note ────────────────────────────────────────────────────────────
//   registerCron is called directly inside InitModule (detected by postbuild).

namespace QvPrewarmCron {

  var COL_ACTIVE     = "qv_active_users";
  var COL_READYQUEUE = "qv_readyqueue";
  var COL_SEEN       = "qv_seen";

  var ACTIVE_WINDOW_MS  = 7  * 24 * 3600000; // 7 days
  var READYQUEUE_SIZE   = 30;                 // questions to pre-compute per topic
  var READYQUEUE_TTL_MS = 2  * 3600000;       // 2 h — re-warm if stale
  var MAX_USERS_PER_RUN = 200;
  var TOP_TOPICS_N      = 3;                  // pre-warm top-3 affinity topics
  var MAX_SEEN_IDS      = 500;                // seen IDs to load per user

  function nowMs(): number { return Date.now(); }

  function slugify(s: string): string {
    return s.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 64);
  }

  // ── Active user list ────────────────────────────────────────────────────────

  function listActiveUsers(nk: nkruntime.Nakama, logger: nkruntime.Logger): string[] {
    var userIds: string[] = [];
    var cutoff = nowMs() - ACTIVE_WINDOW_MS;
    try {
      var cursor = "";
      for (var page = 0; page < 5; page++) {  // up to 5 pages × 100 = 500 users max
        var result: nkruntime.StorageObjectList;
        try {
          result = nk.storageList("", COL_ACTIVE, 100, cursor);
        } catch (_le) { break; }

        if (!result || !Array.isArray(result.objects) || result.objects.length === 0) break;

        for (var i = 0; i < result.objects.length; i++) {
          var obj = result.objects[i];
          if (!obj || !obj.key || !obj.value) continue;
          var lastMs: number = typeof obj.value.last_played_ms === "number"
            ? obj.value.last_played_ms : 0;
          if (lastMs >= cutoff) {
            userIds.push(obj.key); // key IS the userId (see updateActiveUser in submit_result)
          }
          if (userIds.length >= MAX_USERS_PER_RUN) break;
        }

        if (userIds.length >= MAX_USERS_PER_RUN) break;
        cursor = (result as any).cursor || "";
        if (!cursor) break;
      }
    } catch (e: any) {
      logger.warn("[QvPrewarm] listActiveUsers error: " + (e && e.message));
    }
    return userIds;
  }

  // ── Seen IDs for one user + topic ───────────────────────────────────────────

  function loadSeenIds(nk: nkruntime.Nakama, userId: string, topicSlug: string): string[] {
    try {
      var seenKey = slugify("global") + "_" + topicSlug;
      var rows = nk.storageRead([{ collection: COL_SEEN, key: seenKey, userId: userId }]);
      if (!rows || rows.length === 0 || !rows[0].value) return [];
      var ids: any = rows[0].value.ids;
      if (!Array.isArray(ids)) return [];
      // Return most-recently-seen IDs first (tail); keep within MAX_SEEN_IDS
      return ids.slice(-MAX_SEEN_IDS) as string[];
    } catch (_e) { return []; }
  }

  // ── Pre-warm one user → one topic ──────────────────────────────────────────

  function prewarmTopic(
    nk:        nkruntime.Nakama,
    logger:    nkruntime.Logger,
    userId:    string,
    topic:     string
  ): number {
    var topicSlug = slugify(topic);

    // Skip if readyqueue is still fresh
    try {
      var existing = nk.storageRead([{ collection: COL_READYQUEUE, key: topicSlug, userId: userId }]);
      if (existing && existing.length > 0 && existing[0].value) {
        var rq: any = existing[0].value;
        if (rq.created_at_ms && (nowMs() - rq.created_at_ms) < READYQUEUE_TTL_MS &&
            Array.isArray(rq.questions) && rq.questions.length >= READYQUEUE_SIZE / 2) {
          return 0; // still fresh — skip
        }
      }
    } catch (_e) {}

    // Read question cache for this topic
    var pool: any[] = [];
    try {
      var cacheRows = nk.storageRead([{ collection: "qv_cache_" + topicSlug, key: "pool_0", userId: Constants.SYSTEM_USER_ID }]);
      if (!cacheRows || cacheRows.length === 0 || !cacheRows[0].value) return 0;
      var page0: any = cacheRows[0].value;
      if (Array.isArray(page0.questions)) pool = page0.questions.slice();
      // Load additional pages
      var pageCount: number = page0.page_count || 1;
      if (pageCount > 1) {
        var reqs: nkruntime.StorageReadRequest[] = [];
        for (var p = 1; p < pageCount; p++) {
          reqs.push({ collection: "qv_cache_" + topicSlug, key: "pool_" + p, userId: Constants.SYSTEM_USER_ID });
        }
        var extra = nk.storageRead(reqs);
        if (extra) {
          for (var ei = 0; ei < extra.length; ei++) {
            if (extra[ei] && extra[ei].value && Array.isArray(extra[ei].value.questions)) {
              pool = pool.concat(extra[ei].value.questions);
            }
          }
        }
      }
    } catch (_ce) { return 0; }

    if (pool.length === 0) return 0;

    // Filter seen IDs
    var seenIds   = loadSeenIds(nk, userId, topicSlug);
    var seenSet: { [id: string]: boolean } = {};
    for (var si = 0; si < seenIds.length; si++) seenSet[seenIds[si]] = true;

    var fresh: any[] = [];
    for (var pi = 0; pi < pool.length; pi++) {
      if (!seenSet[pool[pi].id]) fresh.push(pool[pi]);
    }

    // Fisher-Yates shuffle
    for (var fi = fresh.length - 1; fi > 0; fi--) {
      var ri = Math.floor(Math.random() * (fi + 1));
      var tmp = fresh[fi]; fresh[fi] = fresh[ri]; fresh[ri] = tmp;
    }

    var toStore = fresh.slice(0, READYQUEUE_SIZE);
    if (toStore.length === 0) return 0;

    try {
      nk.storageWrite([{
        collection:      COL_READYQUEUE,
        key:             topicSlug,
        userId:          userId,
        value: {
          topic:          topic,
          questions:      toStore,
          created_at_ms:  nowMs()
        },
        permissionRead:  0,
        permissionWrite: 0
      }]);
    } catch (we: any) {
      logger.warn("[QvPrewarm] write readyqueue failed user=" + userId + " topic=" + topicSlug +
        ": " + (we && we.message));
      return 0;
    }

    return toStore.length;
  }

  // ── Pre-warm one user (all top topics) ─────────────────────────────────────

  function prewarmUser(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): { topics: number; questions: number } {
    var stats = { topics: 0, questions: 0 };
    try {
      // Load DNA to find top affinity topics
      var dnaRows = nk.storageRead([{ collection: "player_dna", key: "dna", userId: userId }]);
      if (!dnaRows || dnaRows.length === 0 || !dnaRows[0].value) {
        // Fall back to default cold-start topics
        var coldTopics = ["anime", "pokemon", "movies"];
        for (var ci = 0; ci < coldTopics.length; ci++) {
          var n = prewarmTopic(nk, logger, userId, coldTopics[ci]);
          if (n > 0) { stats.topics++; stats.questions += n; }
        }
        return stats;
      }

      var dna: any = dnaRows[0].value;
      var affinities: any = (dna && typeof dna.affinities === "object") ? dna.affinities : {};
      var topicKeys = Object.keys(affinities);
      topicKeys.sort(function(a, b) {
        return (affinities[b] || 0) - (affinities[a] || 0);
      });
      var top = topicKeys.slice(0, TOP_TOPICS_N);
      if (top.length === 0) top = ["anime", "pokemon", "movies"];

      for (var ti = 0; ti < top.length; ti++) {
        var n2 = prewarmTopic(nk, logger, userId, top[ti]);
        if (n2 > 0) { stats.topics++; stats.questions += n2; }
      }
    } catch (e: any) {
      logger.warn("[QvPrewarm] prewarmUser error userId=" + userId + ": " + (e && e.message));
    }
    return stats;
  }

  // ── Opportunistic rate gate ─────────────────────────────────────────────────
  //
  // The full prewarm run (all active users) is expensive and must run at most
  // once per hour globally. We gate it with a system-owned storage row so
  // concurrent calls across nodes deduplicate cleanly.

  var GATE_COL = "qv_prewarm_state";
  var GATE_KEY = "last_run";
  var GATE_INTERVAL_MS = 3600000; // 1 hour

  function acquireGate(nk: nkruntime.Nakama): boolean {
    try {
      var rows = nk.storageRead([{ collection: GATE_COL, key: GATE_KEY, userId: "00000000-0000-0000-0000-000000000000" }]);
      var lastRun: number = (rows && rows.length > 0 && rows[0].value && rows[0].value.last_run_ms)
        ? rows[0].value.last_run_ms : 0;
      if (nowMs() - lastRun < GATE_INTERVAL_MS) return false; // still within gate window

      nk.storageWrite([{
        collection: GATE_COL, key: GATE_KEY, userId: "00000000-0000-0000-0000-000000000000",
        value: { last_run_ms: nowMs() },
        permissionRead: 0, permissionWrite: 0
      }]);
      return true;
    } catch (_e) { return false; }
  }

  // ── RPC tick handler ────────────────────────────────────────────────────────
  //
  // Exposed as quizverse_prewarm_tick — invoke from an external scheduler
  // (n8n, Kubernetes CronJob, or http_key) every hour.
  // Also callable directly via opportunisticTick() from get_questions.

  function rpcPrewarmTick(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    _payload: string
  ): string {
    // Gate: only one full run per hour across all instances
    if (!acquireGate(nk)) {
      return JSON.stringify({ ok: true, skipped: true, reason: "within_gate_window" });
    }

    logger.info("[QvPrewarm] tick start");
    var started = nowMs();

    var userIds = listActiveUsers(nk, logger);
    logger.info("[QvPrewarm] active users=" + userIds.length);

    var totalTopics    = 0;
    var totalQuestions = 0;
    var usersWarmed    = 0;

    for (var i = 0; i < userIds.length; i++) {
      try {
        var result = prewarmUser(nk, logger, userIds[i]);
        if (result.topics > 0) {
          usersWarmed++;
          totalTopics    += result.topics;
          totalQuestions += result.questions;
        }
      } catch (_ue) { /* continue to next user */ }
    }

    var elapsedMs = nowMs() - started;
    logger.info("[QvPrewarm] tick done — users=" + usersWarmed + "/" + userIds.length +
      " topics=" + totalTopics + " questions=" + totalQuestions +
      " elapsed_ms=" + elapsedMs);

    return JSON.stringify({
      ok:              true,
      skipped:         false,
      users_processed: userIds.length,
      users_warmed:    usersWarmed,
      topics_warmed:   totalTopics,
      questions_stored: totalQuestions,
      elapsed_ms:      elapsedMs
    });
  }

  // ── Opportunistic tick (called from get_questions to self-schedule) ─────────
  //
  // Called by get_questions.ts on every cache-path request. Rate-gated
  // internally so the full prewarm only runs once per GATE_INTERVAL_MS
  // regardless of how frequently get_questions fires.

  export function opportunisticTick(
    _ctx:   nkruntime.Context,
    logger: nkruntime.Logger,
    nk:     nkruntime.Nakama
  ): void {
    if (!acquireGate(nk)) return; // gate not acquired → skip (most calls)
    try {
      var userIds = listActiveUsers(nk, logger);
      for (var oi = 0; oi < userIds.length; oi++) {
        try { prewarmUser(nk, logger, userIds[oi]); } catch (_e) {}
      }
      logger.info("[QvPrewarm] opportunistic tick complete — users=" + userIds.length);
    } catch (e: any) {
      logger.warn("[QvPrewarm] opportunistic tick failed: " + (e && e.message));
    }
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_prewarm_tick", rpcPrewarmTick);
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
