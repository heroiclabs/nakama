// QuizVerse — quizverse_get_questions RPC  (Phase 1b)
//
// Serve layer: reads the server-side question cache, filters out questions
// the user has already seen (qv_seen) or that are in another active session
// (qv_inflight), picks N questions, and returns a pre-rendered pack to Unity.
//
// Unity is a PURE RENDERER — no shuffling, normalising, or parsing happens
// on the client. The server does all heavy lifting at cache-time (Phase 1a).
//
// Storage layout (Phase 1b):
//   qv_rate            system-owned  key={userId}  — sliding-window rate-limit
//   qv_seen            user-owned    key={topic}   — historical seen question IDs
//   qv_inflight        user-owned    key={packId}  — active pack trackers (30-min TTL)
//   qv_question_packs  user-owned    key={packId}  — full pack doc for scoring / review
//
// Request  → { topic, count?, lang?, game_id? }
// Response → { ok, pack_id, topic, lang, lang_actual?, question_count, questions[], cache_expired }

namespace QvGetQuestions {

  // ── Storage collection names ───────────────────────────────────────────────
  var COL_RATE  = "qv_rate";           // system-owned (Constants.SYSTEM_USER_ID)
  var COL_INFLT = "qv_inflight";       // user-owned
  var COL_PACKS = "qv_question_packs"; // user-owned
  // qv_seen: user-owned, key = "global_{topic}" (compatible with quizverse_seen.js)
  // Value format: { ids: { questionId: isoTimestamp } }
  var COL_SEEN  = "qv_seen";

  // ── Limits ─────────────────────────────────────────────────────────────────
  var RATE_WINDOW_MS    = 60000;    // 1-minute sliding window
  var RATE_MAX          = 5;        // max requests per user per minute
  var PACK_MAX          = 3;        // max concurrent active packs per user
  var INFLIGHT_TTL_MS   = 1800000;  // 30 minutes
  var DEFAULT_COUNT     = 10;
  var MAX_COUNT         = 20;
  var MIN_COUNT         = 1;
  var SEEN_MAX          = 500;      // cap the seen-IDs array to keep storage lean
  var COL_READYQUEUE    = "qv_readyqueue"; // pre-warmed per-user question pool
  var READYQUEUE_TTL_MS = 2 * 3600000;    // 2 h — discard stale readyqueue entries

  // Client topic aliases — applied after trim/toLowerCase, before cache lookup
  var TOPIC_ALIASES: { [alias: string]: string } = {
    "dish":           "food",
    "foodish":        "food",
    "guessanime":     "anime",
    "guess_anime":    "anime",
    "guesspokemon":   "pokemon",
    "guess_pokemon":  "pokemon",
    "guessdog":       "dog",
    "guess_dog":      "dog"
  };

  // ── Allowed game IDs (org2) ────────────────────────────────────────────────
  var ALLOWED_GAME_IDS: { [id: string]: boolean } = {
    "126bf539-dae2-4bcf-964d-316c0fa1f92b": true,  // QuizVerse production
    "quizverse": true,
    "":          true   // empty = use DEFAULT_GAME_ID
  };

  // ── Low-level helpers ──────────────────────────────────────────────────────

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function parseJson(payload: string): any {
    try { return JSON.parse(payload || "{}"); }
    catch (_e) { throw nakamaError("invalid JSON payload", nkruntime.Codes.INVALID_ARGUMENT); }
  }

  function nowMs(): number { return Date.now(); }

  function djb2(s: string): string {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h = h & h;
    }
    return Math.abs(h).toString(36);
  }

  // Namespaced pack ID: {gameId}_{base}
  // The storage key for both qv_inflight and qv_question_packs is this full string,
  // so submit_result can look up packs using the pack_id returned by get_questions.
  function makePackId(nk: nkruntime.Nakama, gameId: string, topic: string): string {
    var base = "pk_" + slugify(topic) + "_" + nk.uuidv4().replace(/-/g, "");
    return gameId ? gameId + "_" + base : base;
  }

  // Convert topic to storage-key slug — must match quizverse_seen.js qvsSlugify()
  function slugify(s: string): string {
    return s.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .substring(0, 64);
  }

  // Key format used by quizverse_seen.js: "global_{topic_slug}"
  function seenStorageKey(topic: string): string {
    return slugify("global") + "_" + slugify(topic);
  }

  // ── Rate limiter (Task 1b.1) ───────────────────────────────────────────────
  //
  // Sliding-window counter stored in qv_rate/{userId} (system-owned, no-read,
  // no-write from client).  Prunes timestamps older than RATE_WINDOW_MS,
  // checks count ≤ RATE_MAX, then appends current timestamp and writes back.

  function enforceRateLimit(nk: nkruntime.Nakama, userId: string): void {
    var rows = nk.storageRead([{ collection: COL_RATE, key: userId, userId: Constants.SYSTEM_USER_ID }]);
    var doc: any = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : {};
    var timestamps: number[] = Array.isArray(doc.timestamps) ? doc.timestamps : [];
    var windowStart = nowMs() - RATE_WINDOW_MS;

    var fresh: number[] = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (timestamps[i] > windowStart) fresh.push(timestamps[i]);
    }

    if (fresh.length >= RATE_MAX) {
      var retryInSec = Math.ceil((fresh[0] + RATE_WINDOW_MS - nowMs()) / 1000);
      throw nakamaError(
        "Rate limit exceeded: max " + RATE_MAX + " requests/min. Retry in " + retryInSec + "s.",
        nkruntime.Codes.RESOURCE_EXHAUSTED
      );
    }

    fresh.push(nowMs());
    nk.storageWrite([{
      collection: COL_RATE, key: userId, userId: Constants.SYSTEM_USER_ID,
      value: { timestamps: fresh, updated_ms: nowMs() },
      permissionRead: 0, permissionWrite: 0
    }]);
  }

  // ── Inflight pack management (Task 1b.1 / 1b.3) ───────────────────────────

  // List all non-expired inflight packs for a user, sorted oldest-first.
  function listInflight(nk: nkruntime.Nakama, userId: string): any[] {
    try {
      var result = nk.storageList(userId, COL_INFLT, 20, "");
      if (!result || !Array.isArray(result.objects)) return [];
      var packs: any[] = [];
      var now = nowMs();
      for (var i = 0; i < result.objects.length; i++) {
        var obj = result.objects[i];
        if (obj && obj.value && obj.value.expires_at_ms > now) {
          packs.push(obj.value);
        }
      }
      packs.sort(function(a: any, b: any) { return a.created_at_ms - b.created_at_ms; });
      return packs;
    } catch (_e) { return []; }
  }

  // Enforce max 3 active packs.  Deletes oldest (inflight + full pack) until
  // count < PACK_MAX.  Mutates and returns the updated list.
  function enforcePacks(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    packs:  any[]
  ): any[] {
    while (packs.length >= PACK_MAX) {
      var oldest = packs.shift(); // sorted oldest-first
      if (!oldest) break;
      try {
        nk.storageDelete([
          { collection: COL_INFLT, key: oldest.pack_id, userId: userId },
          { collection: COL_PACKS, key: oldest.pack_id, userId: userId }
        ]);
        logger.info("[QvGetQ] evicted pack=" + oldest.pack_id + " (PACK_MAX=" + PACK_MAX + ")");
      } catch (e: any) {
        logger.warn("[QvGetQ] evict failed pack=" + oldest.pack_id + ": " + (e && e.message));
      }
    }
    return packs;
  }

  // ── Seen questions (Task 1b.2) ─────────────────────────────────────────────
  //
  // qv_seen/{topic} stores an ordered string[] where index 0 = oldest seen.
  // This ordering enables oldest-first backfill when the fresh pool is short.

  // Reads seen IDs from quizverse_seen.js-compatible format:
  //   collection = qv_seen, key = "global_{topic}", value = { ids: { qid: isoTimestamp } }
  // Returns IDs sorted oldest-first so filterAndPick can backfill in correct order.
  function readSeenIds(nk: nkruntime.Nakama, userId: string, topic: string): string[] {
    try {
      var key  = seenStorageKey(topic);
      var rows = nk.storageRead([{ collection: COL_SEEN, key: key, userId: userId }]);
      if (!rows || rows.length === 0 || !rows[0].value || !rows[0].value.ids) return [];
      var idsDict: any = rows[0].value.ids;
      // Convert dict { qid: iso|unixTs } → array sorted by timestamp asc (oldest first)
      var entries: Array<{ id: string; ts: number }> = [];
      for (var qid in idsDict) {
        if (!idsDict.hasOwnProperty(qid)) continue;
        var raw: any = idsDict[qid];
        var ts = 0;
        if (typeof raw === "number") {
          ts = raw;
        } else if (typeof raw === "string") {
          var ms = Date.parse(raw);
          if (!isNaN(ms)) ts = Math.floor(ms / 1000);
        }
        entries.push({ id: qid, ts: ts });
      }
      entries.sort(function(a, b) { return a.ts - b.ts; });
      var result: string[] = [];
      for (var i = 0; i < entries.length; i++) result.push(entries[i].id);
      return result;
    } catch (_e) { return []; }
  }

  // ── Filter + pick (Task 1b.2) ──────────────────────────────────────────────
  //
  // 1. Exclude seen ∪ inflight IDs from the pool.
  // 2. Shuffle the remaining "fresh" questions.
  // 3. If fresh count < requested count: backfill from oldest-seen questions
  //    (seenIds is ordered oldest-first — index 0 was seen the longest ago).

  function mediaEligible(q: any, mediaType: string): boolean {
    if (!q || !q.has_media || !q.media || !q.media.url) return false;
    if (mediaType) {
      var qType = (typeof q.media.type === "string") ? q.media.type.toLowerCase() : "";
      if (qType !== mediaType) return false;
    }
    return true;
  }

  function filterToMediaPool(pool: any[], mediaType: string): any[] {
    var out: any[] = [];
    for (var mi = 0; mi < pool.length; mi++) {
      if (mediaEligible(pool[mi], mediaType)) out.push(pool[mi]);
    }
    return out;
  }

  function filterAndPick(
    pool:        any[],
    seenIds:     string[],
    inflightIds: string[],
    count:       number
  ): any[] {
    // Build exclusion set
    var excluded: { [id: string]: boolean } = {};
    for (var si = 0; si < seenIds.length; si++)     excluded[seenIds[si]]     = true;
    for (var ii = 0; ii < inflightIds.length; ii++) excluded[inflightIds[ii]] = true;

    var fresh: any[] = [];
    for (var pi = 0; pi < pool.length; pi++) {
      if (!excluded[pool[pi].id]) fresh.push(pool[pi]);
    }

    // Fisher-Yates shuffle on the fresh pool
    for (var fi = fresh.length - 1; fi > 0; fi--) {
      var ri  = Math.floor(Math.random() * (fi + 1));
      var tmp = fresh[fi]; fresh[fi] = fresh[ri]; fresh[ri] = tmp;
    }

    if (fresh.length >= count) return fresh.slice(0, count);

    // --- Backfill from oldest-seen -------------------------------------------
    // Build a lookup of questions that ARE in the pool (some seen IDs may
    // have been evicted from the cache since they were first delivered).
    var poolById: { [id: string]: any } = {};
    for (var pb = 0; pb < pool.length; pb++) poolById[pool[pb].id] = pool[pb];

    // Walk seenIds oldest-first; collect those still in pool
    var backfill: any[] = [];
    var needed = count - fresh.length;
    for (var oi = 0; oi < seenIds.length && backfill.length < needed; oi++) {
      var q = poolById[seenIds[oi]];
      if (q) backfill.push(q);
    }

    return fresh.concat(backfill);
  }

  // ── Opportunistic expired-pack cleanup (org5) ─────────────────────────────
  //
  // Deletes already-submitted packs whose TTL has elapsed.  Runs at most once
  // per GetQuestions call; lightweight — only lists submitted packs (≤10) and
  // skips storage-write if nothing to delete.

  function cleanExpiredPacksOpportunistic(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): void {
    try {
      var result = nk.storageList(userId, COL_PACKS, 10, "");
      if (!result || !Array.isArray(result.objects) || result.objects.length === 0) return;
      var now = nowMs();
      var toDelete: nkruntime.StorageDeleteRequest[] = [];
      for (var i = 0; i < result.objects.length; i++) {
        var obj = result.objects[i];
        if (obj && obj.value &&
            obj.value.submitted === true &&
            obj.value.expires_at_ms && obj.value.expires_at_ms < now) {
          toDelete.push({ collection: COL_PACKS, key: obj.key, userId: userId });
        }
      }
      if (toDelete.length > 0) {
        nk.storageDelete(toDelete);
        logger.info("[QvGetQ] cleaned " + toDelete.length + " expired packs for user=" + userId);
      }
    } catch (_e) { /* non-fatal */ }
  }

  // ── Ready-queue helpers (prewarm fast path) ───────────────────────────────
  //
  // qv_readyqueue/{topicSlug} (user-owned) is populated by prewarm_cron.ts
  // every hour and self-refreshed here after each cache-path delivery.
  //
  // serveFromReadyQueue(): returns pre-filtered questions from the queue,
  //   removes consumed entries, and returns the list (empty = cache miss).
  // writeReadyQueue():     writes remaining fresh questions for next call.

  function serveFromReadyQueue(
    nk:       nkruntime.Nakama,
    logger:   nkruntime.Logger,
    userId:   string,
    topic:    string,
    count:    number
  ): any[] | null {
    try {
      var topicSlug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "").substring(0, 64);
      var rows = nk.storageRead([{ collection: COL_READYQUEUE, key: topicSlug, userId: userId }]);
      if (!rows || rows.length === 0 || !rows[0].value) return null;
      var rq: any = rows[0].value;
      if (!rq.created_at_ms || (nowMs() - rq.created_at_ms) > READYQUEUE_TTL_MS) return null;
      if (!Array.isArray(rq.questions) || rq.questions.length < count) return null;

      var served    = rq.questions.slice(0, count);
      var remaining = rq.questions.slice(count);

      // Write back remaining (or delete if empty)
      if (remaining.length > 0) {
        nk.storageWrite([{
          collection: COL_READYQUEUE, key: topicSlug, userId: userId,
          value: { topic: rq.topic, questions: remaining, created_at_ms: rq.created_at_ms },
          permissionRead: 0, permissionWrite: 0
        }]);
      } else {
        nk.storageDelete([{ collection: COL_READYQUEUE, key: topicSlug, userId: userId }]);
      }

      logger.info("[QvGetQ] readyqueue HIT user=" + userId + " topic=" + topicSlug +
        " served=" + served.length + " remaining=" + remaining.length);
      return served;
    } catch (e: any) {
      logger.warn("[QvGetQ] readyqueue read failed (non-fatal): " + (e && e.message));
      return null;
    }
  }

  function writeReadyQueue(
    nk:       nkruntime.Nakama,
    logger:   nkruntime.Logger,
    userId:   string,
    topic:    string,
    freshPool: any[]
  ): void {
    if (freshPool.length === 0) return;
    try {
      var topicSlug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "").substring(0, 64);
      var toStore = freshPool.slice(0, 30); // cap at 30 pre-warmed questions
      nk.storageWrite([{
        collection: COL_READYQUEUE, key: topicSlug, userId: userId,
        value: { topic: topic, questions: toStore, created_at_ms: nowMs() },
        permissionRead: 0, permissionWrite: 0
      }]);
      logger.info("[QvGetQ] readyqueue refreshed user=" + userId + " topic=" + topicSlug +
        " n=" + toStore.length);
    } catch (e: any) {
      logger.warn("[QvGetQ] readyqueue write failed (non-fatal): " + (e && e.message));
    }
  }

  // ── Write inflight + pack (Task 1b.3) ─────────────────────────────────────

  function writePackStorage(
    nk:         nkruntime.Nakama,
    userId:     string,
    packId:     string,
    topic:      string,
    lang:       string,
    langActual: string,
    gameId:     string,
    questions:  any[]
  ): void {
    var now    = nowMs();
    var expiry = now + INFLIGHT_TTL_MS;

    var questionIds: string[] = [];
    for (var i = 0; i < questions.length; i++) questionIds.push(questions[i].id);

    nk.storageWrite([
      // Lightweight inflight tracker — only IDs + metadata (no full question text)
      {
        collection: COL_INFLT, key: packId, userId: userId,
        value: {
          pack_id:       packId,
          topic:         topic,
          question_ids:  questionIds,
          created_at_ms: now,
          expires_at_ms: expiry
        },
        permissionRead: 0, permissionWrite: 0  // server-only
      },
      // Full pack — contains pre-rendered questions, used by scoring + review
      {
        collection: COL_PACKS, key: packId, userId: userId,
        value: {
          pack_id:        packId,
          topic:          topic,
          lang:           lang,
          lang_actual:    langActual,
          game_id:        gameId,
          question_ids:   questionIds,
          question_count: questions.length,
          questions:      questions,
          created_at_ms:  now,
          expires_at_ms:  expiry
        },
        permissionRead: 1, permissionWrite: 0  // owner-read, server-write
      }
    ]);
  }

  // ── Main RPC handler ───────────────────────────────────────────────────────

  /**
   * quizverse_get_questions
   *
   * Input:
   *   { topic: string, count?: number, lang?: string, game_id?: string }
   *
   * Output (success):
   *   {
   *     ok:             true,
   *     pack_id:        string,      // reference for scoring / review RPCs
   *     topic:          string,
   *     lang:           string,      // requested lang
   *     lang_actual?:   string,      // only present when lang fell back to "en"
   *     question_count: number,
   *     questions:      Question[],  // pre-shuffled, A/B/C/D already assigned
   *     cache_expired:  boolean      // hint: cache refresh may be due
   *   }
   *
   * Output (soft error):
   *   { ok: false, error: string, topic: string, message: string }
   */
  function rpcGetQuestions(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {

    // ── Auth ───────────────────────────────────────────────────────────────
    var userId = ctx.userId;
    if (!userId) throw nakamaError("not authenticated", nkruntime.Codes.UNAUTHENTICATED);

    // ── Parse + validate request ───────────────────────────────────────────
    var req   = parseJson(payload);
    var topic = (typeof req.topic === "string" && req.topic) ? req.topic.toLowerCase().trim() : "";
    if (!topic) throw nakamaError("topic is required", nkruntime.Codes.INVALID_ARGUMENT);
    if (TOPIC_ALIASES[topic]) topic = TOPIC_ALIASES[topic];

    var count = DEFAULT_COUNT;
    if (typeof req.count === "number" && req.count >= MIN_COUNT) {
      count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(req.count)));
    }

    var lang = (typeof req.lang === "string" && req.lang) ? req.lang.toLowerCase().trim() : "en";

    var requireMedia = req.has_media === true;
    var reqMediaType = (typeof req.media_type === "string" && req.media_type)
      ? req.media_type.toLowerCase().trim() : "";
    if (!requireMedia && reqMediaType) requireMedia = true;

    // ── game_id: validate against allowlist (org2) ─────────────────────────
    var rawGameId = (typeof req.game_id === "string" && req.game_id) ? req.game_id : "";
    var defaultGameId = (ctx.env && ctx.env["DEFAULT_GAME_ID"]) ? ctx.env["DEFAULT_GAME_ID"] : "";
    var gameId: string;
    if (!rawGameId) {
      gameId = defaultGameId;
    } else if (ALLOWED_GAME_IDS[rawGameId]) {
      gameId = rawGameId;
    } else {
      // Unknown game_id — soft-fail to default (log warning, no hard error)
      logger.warn("[QvGetQ] unknown game_id=" + rawGameId + " for user=" + userId + " — using default");
      gameId = defaultGameId;
    }

    // ── country_code: req → Nakama profile location → "US" (yel2) ──────────
    var countryCode = "US";
    var reqCC = (typeof req.country_code === "string") ? req.country_code.trim().toUpperCase() : "";
    if (reqCC.length === 2) {
      countryCode = reqCC;
    } else {
      try {
        var acc = nk.accountGetId(userId);
        if (acc && acc.user && acc.user.location && acc.user.location.length === 2) {
          countryCode = acc.user.location.toUpperCase();
        }
      } catch (_e2) {}
    }

    // ── mode: "standard" | "personalized" (org3) ──────────────────────────
    var mode = (typeof req.mode === "string" && req.mode) ? req.mode : "standard";

    logger.info("[QvGetQ] user=" + userId + " topic=" + topic +
      " count=" + count + " lang=" + lang + " gameId=" + gameId +
      " mode=" + mode + " country=" + countryCode);

    // ── 0a. Cold start protocol ─────────────────────────────────────────────
    //
    // New players (total_sessions < 3) get a guided onboarding experience:
    //   - Force topic to one of the universally-familiar starter topics
    //     (anime → pokemon → movies, cycling by session number)
    //   - Cap the pack at 5 easy questions so first sessions feel achievable
    //
    // cold_start_done is set to true by submit_result after the 3rd session;
    // afterwards this block is a no-op (PlayerDNA.load returns cold_start_done=true).
    var coldStartApplied = false;
    try {
        var coldDna = PlayerDNA.load(nk, userId);
      var beh = coldDna.behavioral;
      if (!beh.cold_start_done && beh.total_sessions < 3) {
        var COLD_TOPICS = ["anime", "pokemon", "movies"];
        var forcedTopic = COLD_TOPICS[beh.total_sessions % COLD_TOPICS.length];
        logger.info("[QvGetQ] cold-start user=" + userId +
          " sessions=" + beh.total_sessions +
          " overriding topic=" + topic + " → " + forcedTopic + " count=" + count + " → 5");
        topic            = forcedTopic;
        count            = 5;
        coldStartApplied = true;
        // Force standard mode so ready-queue / cache path is used (personalized path
        // skips topic override and would call PlayerDNA again unnecessarily)
        mode = "standard";
      }
    } catch (_cse) { /* non-fatal: proceed with original topic */ }

    // ── 0. Opportunistic expired-pack cleanup (org5) ────────────────────────
    cleanExpiredPacksOpportunistic(nk, logger, userId);

    // ── 1. Rate limit (Task 1b.1) ──────────────────────────────────────────
    enforceRateLimit(nk, userId);

    // ── 2. Pack limit — evict oldest if at cap (Task 1b.1) ─────────────────
    var inflightPacks = listInflight(nk, userId);
    inflightPacks = enforcePacks(nk, logger, userId, inflightPacks);

    // Collect all question IDs currently in any active session for this user
    var inflightIds: string[] = [];
    for (var ip = 0; ip < inflightPacks.length; ip++) {
      var ids = inflightPacks[ip].question_ids;
      if (Array.isArray(ids)) {
        for (var qi = 0; qi < ids.length; qi++) inflightIds.push(ids[qi]);
      }
    }

    // ── 3. Ready-queue fast path (prewarm hit) ─────────────────────────────
    //
    // Checks qv_readyqueue first — pre-filtered, per-user question pool
    // written by prewarm_cron or by this RPC after a previous cache-path call.
    // Skips seen-filtering, cache reading, and lang-filtering when available.

    if (mode !== "personalized") { // personalized mode always uses live cache+SRQ
      var rqServed = serveFromReadyQueue(nk, logger, userId, topic, count);
      if (rqServed !== null && requireMedia) {
        var rqMedia = filterToMediaPool(rqServed, reqMediaType);
        if (rqMedia.length < count) {
          rqServed = null;
        } else {
          rqServed = rqMedia.slice(0, count);
        }
      }
      if (rqServed !== null) {
        var rqPackId = makePackId(nk, gameId, topic);
        writePackStorage(nk, userId, rqPackId, topic, lang, lang, gameId, rqServed);
        logger.info("[QvGetQ] ⚡ readyqueue fast-path pack=" + rqPackId +
          " topic=" + topic + " n=" + rqServed.length);
        var rqClientQs: any[] = [];
        for (var rqi = 0; rqi < rqServed.length; rqi++) {
          var rqq = rqServed[rqi];
          rqClientQs.push({
            id:                 rqq.id,
            topic:              rqq.topic,
            question_text:      rqq.question_text,
            question_type:      rqq.question_type,
            options:            rqq.options,
            correct_option_ids: rqq.correct_option_ids,
            has_media:          rqq.has_media,
            media:              rqq.media,
            explanation:        rqq.explanation,
            difficulty:         rqq.difficulty
          });
        }
        var rqResp: any = {
          ok:             true,
          pack_id:        rqPackId,
          topic:          topic,
          lang:           lang,
          mode:           mode,
          country_code:   countryCode,
          question_count: rqClientQs.length,
          questions:      rqClientQs,
          cache_expired:  false,
          served_from:    "readyqueue"
        };
        return JSON.stringify(rqResp);
      }
    }

    // ── 3. Read cache (normal path) ────────────────────────────────────────
    var cacheResult = QvQuestionCache.readCache(nk, logger, topic);
    var pool        = cacheResult.questions;

    if (pool.length === 0) {
      logger.info("[QvGetQ] cache empty topic=" + topic + " — triggering refresh");
      var refreshResult = QvQuestionCache.refreshCache(nk, logger, ctx.env || {}, topic);
      logger.info("[QvGetQ] cache refresh topic=" + topic +
        " ok=" + refreshResult.ok + " count=" + refreshResult.count +
        (refreshResult.error ? " error=" + refreshResult.error : ""));
      cacheResult = QvQuestionCache.readCache(nk, logger, topic);
      pool        = cacheResult.questions;
      if (pool.length === 0) {
        logger.warn("[QvGetQ] cache still empty after refresh topic=" + topic);
        var emptyResp: any = {
          ok:      false,
          error:   "cache_empty",
          topic:   topic,
          message: "No questions cached for this topic yet. Please try again later."
        };
        if (refreshResult.error) emptyResp.refresh_error = refreshResult.error;
        return JSON.stringify(emptyResp);
      }
    }

    // ── 4. Lang validation + fallback (Task 1b.1 / 1b.4) ──────────────────
    var langActual = lang;
    var langPool: any[] = [];

    if (lang !== "en") {
      for (var lp = 0; lp < pool.length; lp++) {
        if (pool[lp].lang === lang) langPool.push(pool[lp]);
      }
    }

    // Fallback: requested lang has no questions → use English
    if (langPool.length === 0) {
      if (lang !== "en") {
        langActual = "en";
        logger.info("[QvGetQ] lang=" + lang + " not available for topic=" + topic + " — falling back to en");
      }
      for (var ep = 0; ep < pool.length; ep++) {
        if (!pool[ep].lang || pool[ep].lang === "en") langPool.push(pool[ep]);
      }
    }

    // Last resort: language field absent on all cached questions
    if (langPool.length === 0) langPool = pool;

    // ── 4a. Media filter (ImageGuess / audio quiz modes) ────────────────────
    if (requireMedia) {
      var mediaPool = filterToMediaPool(langPool, reqMediaType);
      if (mediaPool.length === 0) {
        logger.warn("[QvGetQ] no media questions topic=" + topic +
          " media_type=" + (reqMediaType || "any"));
        return JSON.stringify({
          ok:      false,
          error:   "no_media_questions",
          topic:   topic,
          message: "No questions with media available for this topic."
        });
      }
      langPool = mediaPool;
    }

    // ── 4b. Elo-range filter ────────────────────────────────────────────────
    //
    // Keep only questions whose difficulty maps within the player's Elo ± 200.
    // Difficulty→Elo midpoints: easy=800, medium=1200, hard=1600.
    // Fall back to the full langPool when the filtered set is empty (prevents
    // "pool exhausted" for new topics where most questions are out of range).
    try {
      var eloDna = PlayerDNA.load(nk, userId);
      var eloTopicSlug = slugify(topic);
      var playerEloForFilter: number = (typeof eloDna.elos[eloTopicSlug] === "number")
        ? eloDna.elos[eloTopicSlug] : 1200;
      var ELO_RADIUS = 200;
      var diffToElo: { [d: string]: number } = { easy: 800, medium: 1200, hard: 1600 };
      var eloFiltered: any[] = [];
      for (var ef = 0; ef < langPool.length; ef++) {
        var qDiff = (langPool[ef].difficulty || "medium").toLowerCase();
        var qElo  = (typeof langPool[ef].elo === "number") ? langPool[ef].elo
          : (diffToElo[qDiff] || 1200);
        if (Math.abs(qElo - playerEloForFilter) <= ELO_RADIUS) {
          eloFiltered.push(langPool[ef]);
        }
      }
      if (eloFiltered.length >= Math.min(count, 3)) {
        // Only apply the filter when enough questions pass the range check
        langPool = eloFiltered;
        logger.info("[QvGetQ] elo-filter: playerElo=" + playerEloForFilter +
          " ±" + ELO_RADIUS + " → pool " + pool.length + " → " + langPool.length);
      } else {
        logger.info("[QvGetQ] elo-filter: too few matching questions (" + eloFiltered.length +
          "), using full pool (" + langPool.length + ")");
      }
    } catch (_efe) { /* non-fatal */ }

    // ── 5. Read seen IDs + filter pool (Task 1b.2) ─────────────────────────
    var seenIds = readSeenIds(nk, userId, topic);
    var picked  = filterAndPick(langPool, seenIds, inflightIds, count);

    if (picked.length === 0) {
      logger.info("[QvGetQ] pool exhausted topic=" + topic + " seen=" + seenIds.length);
      return JSON.stringify({
        ok:      false,
        error:   "pool_exhausted",
        topic:   topic,
        message: "All available questions for this topic have been seen. New questions are being fetched."
      });
    }

    // ── 5b. Personalized mix algorithm (org3) ──────────────────────────────
    //
    // When mode="personalized":
    //   1. Inject SRQ due-questions at the front of the pack so the player
    //      reviews weak spots before fresh questions.
    //   2. Bias difficulty selection toward the player's Elo for this topic:
    //      players rated < 1000 prefer easy questions; > 1600 prefer hard.
    //
    // The pool is already shuffled by filterAndPick; we only re-sort / inject
    // the front slice — the rest stays random.

    if (mode === "personalized") {
      try {
        var dna = PlayerDNA.load(nk, userId);
        var topicSlug = slugify(topic);
        var playerElo = dna.elos[topicSlug] !== undefined ? dna.elos[topicSlug] : 1200;

        // SRQ injection: prepend due questions (max 3) to pack front
        var srqDue = QvSRQ.getDueInPool(nk, userId, topicSlug, langPool);
        var srqDueLimit = Math.min(3, Math.floor(count / 3));
        var srqInserted: any[] = [];
        if (srqDue.length > 0) {
          // Build exclusion set from picked
          var pickedIds: { [id: string]: boolean } = {};
          for (var pki = 0; pki < picked.length; pki++) pickedIds[picked[pki].id] = true;

          for (var sri = 0; sri < srqDue.length && srqInserted.length < srqDueLimit; sri++) {
            var sqId = srqDue[sri].id;
            if (!pickedIds[sqId]) {
              // Remove from end of picked to stay at `count` total
              if (picked.length >= count) picked.pop();
              srqInserted.push(srqDue[sri]);
              pickedIds[sqId] = true;
            }
          }
          // Prepend SRQ questions so player sees them first
          picked = srqInserted.concat(picked);
        }

        // Elo-biased difficulty sort of the non-SRQ portion
        // Preferred difficulty band: easy(800) ±200, medium(1200) ±200, hard(1600) ±200
        var preferDiff = playerElo < 1000 ? "easy" : (playerElo < 1600 ? "medium" : "hard");
        var biasStart = srqInserted.length;  // don't re-sort the SRQ prefix
        var sliceToBias = picked.slice(biasStart);

        // Stable partial sort: preferred-difficulty questions float to front
        var preferred: any[] = [];
        var others: any[] = [];
        for (var bsi = 0; bsi < sliceToBias.length; bsi++) {
          var bq = sliceToBias[bsi];
          var bqDiff = bq.difficulty || "medium";
          if (bqDiff === preferDiff) preferred.push(bq);
          else                       others.push(bq);
        }
        // Keep 60% preferred + 40% other for variety
        var preferCount = Math.ceil(sliceToBias.length * 0.6);
        var biasedSlice = preferred.slice(0, preferCount).concat(others).slice(0, sliceToBias.length);
        picked = picked.slice(0, biasStart).concat(biasedSlice);

        logger.info("[QvGetQ] personalized: elo=" + playerElo + " preferDiff=" + preferDiff +
          " srqInjected=" + srqInserted.length + " topic=" + topicSlug);
      } catch (e: any) {
        logger.warn("[QvGetQ] personalized mix failed (non-fatal): " + (e && e.message));
      }
    }

    // ── 5c. Refresh readyqueue for next call (cache-path only) ────────────
    // After filtering + picking, the remaining fresh pool is stored as the
    // ready-queue for the NEXT request — so cold-cache users converge to
    // sub-30ms latency after just one standard-path call.
    if (mode !== "personalized") {
      try {
        // Build fresh remainder: questions in langPool that were NOT picked
        var pickedIdSet: { [id: string]: boolean } = {};
        for (var prwi = 0; prwi < picked.length; prwi++) pickedIdSet[picked[prwi].id] = true;
        var freshRemainder: any[] = [];
        for (var fri = 0; fri < langPool.length; fri++) {
          if (!pickedIdSet[langPool[fri].id]) freshRemainder.push(langPool[fri]);
        }
        writeReadyQueue(nk, logger, userId, topic, freshRemainder);
      } catch (_rwq) { /* non-critical */ }
    }

    // ── 6. Write inflight + pack document (Task 1b.3) ──────────────────────
    var packId = makePackId(nk, gameId, topic);
    writePackStorage(nk, userId, packId, topic, lang, langActual, gameId, picked);

    logger.info("[QvGetQ] pack=" + packId + " topic=" + topic +
      " delivered=" + picked.length + "/" + count +
      " pool=" + pool.length + " seen=" + seenIds.length +
      " inflight=" + inflightIds.length + " cache_expired=" + cacheResult.expired);

    // ── 7. Build client-safe response ──────────────────────────────────────
    // Strip internal `provider` field — Unity doesn't need to know the source.
    var clientQs: any[] = [];
    for (var ci = 0; ci < picked.length; ci++) {
      var q = picked[ci];
      clientQs.push({
        id:                 q.id,
        topic:              q.topic,
        question_text:      q.question_text,
        question_type:      q.question_type,
        options:            q.options,
        correct_option_ids: q.correct_option_ids,
        has_media:          q.has_media,
        media:              q.media,
        explanation:        q.explanation,
        difficulty:         q.difficulty
      });
    }

    var resp: any = {
      ok:             true,
      pack_id:        packId,
      topic:          topic,
      lang:           lang,
      mode:           mode,
      country_code:   countryCode,
      question_count: clientQs.length,
      questions:      clientQs,
      cache_expired:  cacheResult.expired   // hint: client may show "refreshing…"
    };

    // Task 1b.4 — lang_actual only present when fallback occurred
    if (langActual !== lang) {
      resp.lang_actual = langActual;
    }

    // Cold start hint: Unity can suppress topic picker and show a guided message
    if (coldStartApplied) {
      resp.cold_start = true;
    }

    try {
      QvPrewarmCron.opportunisticTick(ctx, logger, nk);
    } catch (_pt) { /* non-fatal */ }

    return JSON.stringify(resp);
  }

  // ── Registration ───────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_get_questions", rpcGetQuestions);
  }

  // IIFE NOOP — required by postbuild.js to hoist __rpc_ assignments at
  // module-load time before InitModule fires. See migration.ts for rationale.
  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
