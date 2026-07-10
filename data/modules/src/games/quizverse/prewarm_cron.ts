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
  var WARMABLE_TOPICS: { [topic: string]: boolean } = {
    anime: true, pokemon: true, movies: true, dog: true, dish: true,
    flags: true, countries: true, space: true, music: true,
    video_quiz: true, sports: true, ghibli: true, disney: true,
    starwars: true, news: true, speed_quiz: true, true_false: true,
    opentdb: true, general: true
  };

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
      if (Array.isArray(ids)) {
        return ids.slice(-MAX_SEEN_IDS) as string[];
      }
      if (!ids || typeof ids !== "object") return [];

      // quizverse_seen stores { questionId: isoTimestamp }. Keep the newest
      // entries when the ledger is larger than the prewarm safety cap.
      var entries: Array<{ id: string; ts: number }> = [];
      for (var questionId in ids) {
        if (!ids.hasOwnProperty(questionId)) continue;
        var rawTs: any = ids[questionId];
        var parsedTs = typeof rawTs === "number" ? rawTs : Date.parse(String(rawTs));
        entries.push({ id: questionId, ts: isNaN(parsedTs) ? 0 : parsedTs });
      }
      entries.sort(function(a, b) { return a.ts - b.ts; });
      var start = Math.max(0, entries.length - MAX_SEEN_IDS);
      var result: string[] = [];
      for (var ei = start; ei < entries.length; ei++) result.push(entries[ei].id);
      return result;
    } catch (_e) { return []; }
  }

  // ── Pre-warm one user → one topic ──────────────────────────────────────────

  function prewarmTopic(
    nk:        nkruntime.Nakama,
    logger:    nkruntime.Logger,
    userId:    string,
    topic:     string,
    desiredCount?: number
  ): number {
    var topicSlug = slugify(topic);
    var targetCount = typeof desiredCount === "number"
      ? Math.max(4, Math.min(READYQUEUE_SIZE, Math.floor(desiredCount)))
      : READYQUEUE_SIZE;

    // Skip if readyqueue is still fresh
    try {
      var existing = nk.storageRead([{ collection: COL_READYQUEUE, key: topicSlug, userId: userId }]);
      if (existing && existing.length > 0 && existing[0].value) {
        var rq: any = existing[0].value;
        if (rq.created_at_ms && (nowMs() - rq.created_at_ms) < READYQUEUE_TTL_MS &&
            Array.isArray(rq.questions) && rq.questions.length >= targetCount) {
          return 0; // still fresh — skip
        }
      }
    } catch (_e) {}

    // Use the canonical reader so prewarm follows cache paging/generation rules.
    var cacheResult = QvQuestionCache.readCache(nk, logger, topicSlug);
    var pool: any[] = cacheResult.questions;

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

    var toStore = fresh.slice(0, targetCount);

    // Availability tier: once unseen questions are exhausted, append the
    // oldest previously-seen questions. This preserves variety first while
    // ensuring survival/replay sessions always have a complete ready queue.
    if (toStore.length < targetCount) {
      var storedIds: { [id: string]: boolean } = {};
      for (var tsi = 0; tsi < toStore.length; tsi++) storedIds[toStore[tsi].id] = true;
      var poolById: { [id: string]: any } = {};
      for (var pbi = 0; pbi < pool.length; pbi++) poolById[pool[pbi].id] = pool[pbi];
      for (var bfi = 0; bfi < seenIds.length && toStore.length < targetCount; bfi++) {
        var seenQuestion = poolById[seenIds[bfi]];
        if (!seenQuestion || storedIds[seenQuestion.id]) continue;
        toStore.push(seenQuestion);
        storedIds[seenQuestion.id] = true;
      }
    }
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

  function readReadyQueue(
    nk: nkruntime.Nakama,
    userId: string,
    topic: string
  ): any[] {
    try {
      var rows = nk.storageRead([{
        collection: COL_READYQUEUE, key: slugify(topic), userId: userId
      }]);
      if (rows && rows.length > 0 && rows[0].value &&
          Array.isArray(rows[0].value.questions)) {
        return rows[0].value.questions;
      }
    } catch (_e) {}
    return [];
  }

  function topicCacheNeedsRepair(topic: string, questions: any[], minCount: number): boolean {
    if (!Array.isArray(questions) || questions.length < minCount) return true;

    if (topic === "anime") {
      for (var ai = 0; ai < questions.length; ai++) {
        var aq = questions[ai];
        if (aq && aq.has_media && aq.media && aq.media.type === "image" &&
            aq.question_text !== "Which anime is shown in this image?") {
          return true;
        }
      }
    }

    if (topic === "flags" || topic === "countries") {
      var correctTopicCount = 0;
      for (var fi = 0; fi < questions.length; fi++) {
        if (questions[fi] && questions[fi].topic === topic) correctTopicCount++;
      }
      if (correctTopicCount < Math.max(minCount, 60)) return true;
    }

    if (topic === "music") {
      var audioCount = 0;
      for (var mi = 0; mi < questions.length; mi++) {
        var mm = questions[mi] && questions[mi].media;
        if (mm && mm.type === "audio" && mm.url) audioCount++;
      }
      if (audioCount < minCount) return true;
    }

    if (topic === "video_quiz") {
      var cdnVideoCount = 0;
      for (var vi = 0; vi < questions.length; vi++) {
        var vm = questions[vi] && questions[vi].media;
        if (vm && vm.type === "video" && typeof vm.url === "string" &&
            vm.url.indexOf("cloudfront.net/") !== -1) {
          cdnVideoCount++;
        }
      }
      if (cdnVideoCount < minCount) return true;
    }

    return false;
  }

  /**
   * Authenticated app-start/post-quiz warmup. It never reserves a question pack:
   * it repairs a missing/thin shared topic cache and fills the caller's private
   * ready queue, so the real get_questions call remains authoritative and fast.
   */
  function rpcWarmTopic(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = ctx.userId || "";
    if (!userId) {
      throw new Error(JSON.stringify({ code: 16, message: "authentication required" }));
    }

    var req: any = {};
    try { req = JSON.parse(payload || "{}"); } catch (_pe) {
      throw new Error(JSON.stringify({ code: 3, message: "invalid JSON payload" }));
    }
    var topic = slugify(typeof req.topic === "string" ? req.topic : "");
    if (!topic || !WARMABLE_TOPICS[topic]) {
      throw new Error(JSON.stringify({ code: 3, message: "unsupported warmup topic" }));
    }
    var minCount = typeof req.min_count === "number"
      ? Math.max(4, Math.min(READYQUEUE_SIZE, Math.floor(req.min_count)))
      : READYQUEUE_SIZE;

    var before = QvQuestionCache.readCache(nk, logger, topic);
    var refreshed = false;
    var refreshError = "";
    var needsSchemaRepair = topicCacheNeedsRepair(topic, before.questions, minCount);
    if (before.expired || needsSchemaRepair) {
      var refreshResult = QvQuestionCache.refreshCache(
        nk, logger, ctx.env || {}, topic, needsSchemaRepair);
      refreshed = refreshResult.ok && refreshResult.count > 0;
      refreshError = refreshResult.error || "";
    }

    var after = QvQuestionCache.readCache(nk, logger, topic);
    var queueWritten = prewarmTopic(nk, logger, userId, topic, minCount);
    var readyQuestions = readReadyQueue(nk, userId, topic);
    var mediaUrls: string[] = [];
    var mediaSeen: { [url: string]: boolean } = {};
    for (var mi = 0; mi < readyQuestions.length && mediaUrls.length < 4; mi++) {
      var media = readyQuestions[mi] && readyQuestions[mi].media;
      var mediaUrl = media && typeof media.url === "string" ? media.url : "";
      if (!mediaUrl || mediaSeen[mediaUrl]) continue;
      mediaSeen[mediaUrl] = true;
      mediaUrls.push(mediaUrl);
    }

    logger.info("[QvPrewarm] user warm topic=" + topic +
      " cache=" + after.questions.length + " queue=" + readyQuestions.length +
      " refreshed=" + refreshed + " media=" + mediaUrls.length);
    return JSON.stringify({
      ok:                  after.questions.length > 0 && readyQuestions.length > 0,
      topic:               topic,
      cache_count:         after.questions.length,
      ready_count:         readyQuestions.length,
      queue_written:       queueWritten,
      refreshed:           refreshed,
      refresh_error:       refreshError || undefined,
      media_urls:          mediaUrls
    });
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

      var expectedVersion = rows && rows.length > 0 ? rows[0].version : "*";
      nk.storageWrite([{
        collection: GATE_COL, key: GATE_KEY, userId: "00000000-0000-0000-0000-000000000000",
        value: { last_run_ms: nowMs() },
        version: expectedVersion,
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
    initializer.registerRpc("quizverse_warm_topic", rpcWarmTopic);
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
