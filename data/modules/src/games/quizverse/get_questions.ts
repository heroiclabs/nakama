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
// Response → { ok, pack_id, topic, lang, lang_actual?, question_count, requested_count?,
//              partial?, pool_size?, questions[], cache_expired }

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
  var RATE_MAX_DEFAULT  = 10000;        // max requests per user per minute (override via QV_GET_QUESTIONS_RATE_MAX)
  var PACK_MAX          = 3;        // max concurrent active packs per user
  var INFLIGHT_TTL_MS   = 1800000;  // 30 minutes
  var ABANDON_TTL_GETQUESTIONS_MS = 5 * 60 * 1000; // 5 min — purge unsubmitted packs per request
  var DEFAULT_COUNT     = 10;
  var MAX_COUNT         = 100;
  var MIN_COUNT         = 1;
  var MAX_FULFILL_ATTEMPTS = 3;
  var SEEN_MAX          = 500;      // cap the seen-IDs array to keep storage lean
  var COL_READYQUEUE    = "qv_readyqueue"; // pre-warmed per-user question pool
  // 8 h hard TTL — overnight reopen still hits fast path. Soft window below
  // allows stale-while-revalidate up to 2× TTL (industry CDN pattern).
  var READYQUEUE_TTL_MS = 8 * 3600000;

  // Client topic aliases — applied after trim/toLowerCase, before cache lookup
  var TOPIC_ALIASES: { [alias: string]: string } = {
    "dish":           "food",
    "foodish":        "food",
    "guessanime":     "anime",
    "guess_anime":    "anime",
    "guesspokemon":   "pokemon",
    "guess_pokemon":  "pokemon",
    "guessdog":       "dog",
    "guess_dog":      "dog",
    "flagquiz":       "flags",
    "newsquiz":       "news",
    "starwarsquiz":   "starwars",
    "disneyquiz":     "disney",
    "ghibli":         "ghibli",
    "iqrush":         "iqrush",
    "speedquiz":      "speed_quiz",
    "speed-quiz":     "speed_quiz",
    "truefalse":      "true_false",
    "true-false":     "true_false",
    "true_false_quiz":"true_false",
    "videoquiz":      "video_quiz",
    "video-quiz":     "video_quiz"
  };

  // Every topic the cache/provider layer actually understands — mirrors the
  // `switch(topic)` in question_cache.ts's fetchForTopic(). Keep in sync manually
  // whenever a new case is added there.
  var KNOWN_TOPICS: { [t: string]: boolean } = {
    geography: true, speed_quiz: true, true_false: true, anime: true, pokemon: true,
    cocktail: true, food: true, dog: true, ghibli: true, disney: true, starwars: true,
    countries: true, flags: true, space: true, movies: true, sports: true, music: true,
    news: true, daily: true, weekly: true, video_quiz: true, ai: true,
    opentdb: true, // general OpenTDB (TrueFalse / Speed fallbacks)
    // New topics (2026-07): infinite-content providers, all free/no-key
    math: true,    // OpenTDB Mathematics (cat 19) + Computers (cat 18)
    art: true,     // Art Institute of Chicago API — CC0 artwork images
    history: true  // OpenTDB History (cat 23) + jService Jeopardy archive
  };

  // Media-pool topics the AI-driven image/media quiz modes (Who's That, Brain Sprint,
  // Image Quiz, Audio Quiz) mix together for their "Random Mix" category.
  var MEDIA_MIX_TOPICS = ["anime", "dog", "pokemon", "sports"];

  // #QVVBS-CACHE (2026-07): UnifiedRoomPanel bakes the UI display label of the
  // selected mode ("Who's That — Random Mix", "Brain Sprint - Random Mix", "Audio
  // Quiz — Random Mix", …) straight into CreateRoomRequest.CustomTopic when priming
  // multiplayer lazy question generation, instead of a real topic slug — confirmed
  // live in qv_circuit_breakers ("Unknown topic: brain sprint - random mix" /
  // "Unknown topic: audio quiz — random mix"). An unrecognized label used to fall
  // straight through to fetchForTopic()'s `default: throw`, which tripped that
  // (bogus, one-off) topic's circuit breaker and returned zero AI-generated
  // questions for the rest of the match — the "AI could not generate additional
  // questions" symptom reported for Who's That / Brain Sprint / Image Quiz / Audio
  // Quiz. Rather than patch every current and future Unity call site, normalize
  // server-side so any caller sending a human-readable label still resolves to a
  // real, cacheable topic.
  function normalizeUnresolvedTopic(topic: string, seedKey: string): string {
    for (var i = 0; i < MEDIA_MIX_TOPICS.length; i++) {
      if (topic.indexOf(MEDIA_MIX_TOPICS[i]) !== -1) return MEDIA_MIX_TOPICS[i];
    }
    if (topic.indexOf("space") !== -1 || topic.indexOf("nasa") !== -1) return "space";
    if (topic.indexOf("flag") !== -1 || topic.indexOf("countr") !== -1) return "flags";
    if (topic.indexOf("video") !== -1) return "video_quiz";
    if (topic.indexOf("movie") !== -1 || topic.indexOf("film") !== -1) return "movies";
    // "audio" must resolve here too — Audio Quiz's raw label is "audio quiz — random
    // mix" and contains no "music"/"song" keyword, so it used to fall all the way
    // through to a MEDIA_MIX_TOPICS guess (an image-only topic), still leaving Audio
    // Quiz with zero real audio content. "music" is now the one topic with actual
    // media.type==="audio" questions (Deezer, see question_cache.ts fetchDeezer).
    if (topic.indexOf("music") !== -1 || topic.indexOf("song") !== -1 || topic.indexOf("audio") !== -1) return "music";
    if (topic.indexOf("news") !== -1) return "news";
    // New topic aliases (2026-07)
    if (topic.indexOf("math") !== -1 || topic.indexOf("maths") !== -1 || topic.indexOf("comput") !== -1) return "math";
    if (topic.indexOf("art") !== -1 || topic.indexOf("paint") !== -1 || topic.indexOf("museum") !== -1) return "art";
    if (topic.indexOf("histor") !== -1 || topic.indexOf("jeopardy") !== -1) return "history";

    // No recognizable topic keyword — likely a bare "<mode> — random mix" label.
    // Deterministically pick a media topic from a hash of the caller-supplied label
    // so repeated requests with the SAME bad label resolve the same way (stable, not
    // literally random per-call), while still spreading load across providers.
    if (topic.indexOf("random") !== -1 || topic.indexOf("mix") !== -1 || topic === "") {
      var hash = 0;
      for (var j = 0; j < seedKey.length; j++) hash = (hash * 31 + seedKey.charCodeAt(j)) | 0;
      return MEDIA_MIX_TOPICS[Math.abs(hash) % MEDIA_MIX_TOPICS.length];
    }

    return topic; // genuinely unknown — let fetchForTopic's `default: throw` handle it as before
  }

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

  var CACHE_REFRESH_RETRY_SEC    = 30;
  var POOL_EXHAUSTED_RETRY_SEC   = 30;

  // Grafana/Loki-friendly log line: tag + flat key=value tokens (spaces → underscores in values).
  function formatQvLog(tag: string, fields: { [k: string]: string | number | boolean }): string {
    var parts: string[] = [tag];
    for (var fk in fields) {
      if (!fields.hasOwnProperty(fk)) continue;
      var fv = fields[fk];
      if (typeof fv === "boolean") {
        parts.push(fk + "=" + (fv ? "true" : "false"));
      } else if (typeof fv === "number") {
        parts.push(fk + "=" + String(fv));
      } else {
        parts.push(fk + "=" + String(fv).replace(/\s+/g, "_"));
      }
    }
    return parts.join(" ");
  }

  function resolveRateMax(env: { [k: string]: string } | undefined): number {
    if (env && env["QV_GET_QUESTIONS_RATE_MAX"]) {
      var parsed = parseInt(env["QV_GET_QUESTIONS_RATE_MAX"], 10);
      if (!isNaN(parsed) && parsed >= 1) return parsed;
    }
    return RATE_MAX_DEFAULT;
  }

  function topicProviderForLog(topic: string): string {
    var map: { [t: string]: string } = {
      opentdb: "opentdb", speed_quiz: "opentdb", true_false: "opentdb", anime: "jikan+anilist+opentdb", pokemon: "pokeapi",
      cocktail: "cocktaildb", food: "themealdb", dog: "dogceo",
      ghibli: "ghibli", disney: "disney", starwars: "swapi",
      countries: "restcountries", flags: "restcountries",
      space: "nasa", movies: "tmdb", sports: "sportsdb+opentdb",
      music: "deezer", news: "gnews", daily: "s3", weekly: "s3",
      video_quiz: "catalog", ai: "claude",
      math: "opentdb", art: "artic", history: "opentdb+jservice"
    };
    return map[topic] || topic;
  }

  /**
   * On cache miss: perform one gated emergency refresh before returning an
   * error. Normal traffic is still served stale-while-revalidate, but a cold
   * deploy can no longer leave a topic permanently empty while waiting for an
   * external scheduler to drain the refresh request.
   */
  function handleEmptyTopicCache(
    nk:              nkruntime.Nakama,
    logger:          nkruntime.Logger,
    env:             { [k: string]: string },
    topic:           string,
    traceId:         string,
    coldStartApplied: boolean,
    userId:          string
  ): {
    pool:        any[];
    cacheResult: { questions: any[]; expired: boolean; cached_at_ms: number };
    earlyReturn: string | null;
  } {
    logger.warn(formatQvLog("[QvGetQ][GATE:cache_miss]", {
      event:     "cache_miss",
      traceId:   traceId,
      topic:     topic,
      coldStart: coldStartApplied,
      userId:    userId,
      rpc:       "quizverse_get_questions"
    }));

    var t0 = nowMs();
    var emergencyRefresh = QvQuestionCache.refreshCache(nk, logger, env, topic);
    var cacheResult = QvQuestionCache.readCache(nk, logger, topic);
    var elapsedMs = nowMs() - t0;
    if (cacheResult.questions.length > 0) {
      logger.info(formatQvLog("[QvGetQ][GATE:cache_recovered]", {
        event:      "cache_emergency_refresh_ok",
        traceId:    traceId,
        topic:      topic,
        pool_size:  cacheResult.questions.length,
        elapsed_ms: elapsedMs
      }));
      return {
        pool:        cacheResult.questions,
        cacheResult: cacheResult,
        earlyReturn: null
      };
    }

    QvQuestionCache.requestRefresh(nk, logger, topic, "cache_empty");
    logger.warn(formatQvLog("[QvGetQ][GATE:cache_empty]", {
      event:               "cache_empty",
      traceId:             traceId,
      topic:               topic,
      refresh_queued:      true,
      refresh_error:       emergencyRefresh.error || "none",
      elapsed_ms:           elapsedMs,
      retry_after_seconds: CACHE_REFRESH_RETRY_SEC
    }));

    if (coldStartApplied) {
      logger.error(formatQvLog("[QvGetQ][COLD_START_BLOCKED]", {
        event:   "cold_start_blocked",
        traceId: traceId,
        topic:   topic,
        error:   "cache_empty",
        userId:  userId
      }));
    }

    return {
      pool:        [],
      cacheResult: cacheResult,
      earlyReturn: JSON.stringify({
        ok:                  false,
        error:               "cache_empty",
        topic:               topic,
        message:             "Questions are warming in the background. Please retry shortly.",
        refresh_queued:      true,
        retry_after_seconds: CACHE_REFRESH_RETRY_SEC
      })
    };
  }

  // Key format used by quizverse_seen.js: "global_{topic_slug}"
  function seenStorageKey(topic: string): string {
    return slugify("global") + "_" + slugify(topic);
  }

  // ── Rate limiter (Task 1b.1) ───────────────────────────────────────────────
  //
  // Sliding-window counter stored in qv_rate/{userId} (system-owned, no-read,
  // no-write from client).  Prunes timestamps older than RATE_WINDOW_MS,
  // checks count ≤ rateMax, then appends current timestamp and writes back.

  function enforceRateLimit(
    nk:      nkruntime.Nakama,
    userId:  string,
    logger:  nkruntime.Logger,
    logCtx:  { traceId: string; topic: string },
    rateMax: number
  ): void {
    // User-owned storage (userId = actual user UUID) — system-owned (userId="")
    // is rejected by production Nakama JS runtime with "expects 'userId' value to be a valid id".
    var rows = nk.storageRead([{ collection: COL_RATE, key: "rl", userId: userId }]);
    var doc: any = (rows && rows.length > 0 && rows[0].value) ? rows[0].value : {};
    var timestamps: number[] = Array.isArray(doc.timestamps) ? doc.timestamps : [];
    var windowStart = nowMs() - RATE_WINDOW_MS;

    var fresh: number[] = [];
    for (var i = 0; i < timestamps.length; i++) {
      if (timestamps[i] > windowStart) fresh.push(timestamps[i]);
    }

    if (fresh.length >= rateMax) {
      var retryInSec = Math.ceil((fresh[0] + RATE_WINDOW_MS - nowMs()) / 1000);
      logger.warn(formatQvLog("[QvGetQ][GATE:rate_limited]", {
        event:        "rate_limited",
        traceId:      logCtx.traceId,
        userId:       userId,
        topic:        logCtx.topic,
        window_count: fresh.length,
        retry_in_sec: retryInSec
      }));
      throw nakamaError(
        "Rate limit exceeded: max " + rateMax + " requests/min. Retry in " + retryInSec + "s.",
        nkruntime.Codes.RESOURCE_EXHAUSTED
      );
    }

    fresh.push(nowMs());
    nk.storageWrite([{
      collection: COL_RATE, key: "rl", userId: userId,
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

  function filterToTextPool(pool: any[]): any[] {
    var out: any[] = [];
    for (var ti = 0; ti < pool.length; ti++) {
      var q = pool[ti];
      if (!q || !q.has_media || !q.media || !q.media.url) out.push(q);
    }
    return out;
  }

  function filterToTopicContract(pool: any[], topic: string, requireMedia: boolean, mediaType: string): any[] {
    if (topic !== "flags" && topic !== "countries" &&
        !(topic === "anime" && requireMedia && (!mediaType || mediaType === "image"))) {
      return pool;
    }

    var out: any[] = [];
    for (var ci = 0; ci < pool.length; ci++) {
      var q = pool[ci];
      if (!q) continue;
      if ((topic === "flags" || topic === "countries") && q.topic !== topic) continue;
      if (topic === "anime" &&
          q.question_text !== "Which anime is shown in this image?") continue;
      out.push(q);
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

    // --- Backfill tiers until count or unique pool is consumed ---------------
    // Build a lookup of questions that ARE in the pool (some seen IDs may
    // have been evicted from the cache since they were first delivered).
    var poolById: { [id: string]: any } = {};
    for (var pb = 0; pb < pool.length; pb++) poolById[pool[pb].id] = pool[pb];

    var pickedIds: { [id: string]: boolean } = {};
    for (var pk = 0; pk < fresh.length; pk++) {
      if (fresh[pk] && fresh[pk].id) pickedIds[fresh[pk].id] = true;
    }

    // Tier 2: walk seenIds oldest-first; collect those still in pool, not picked
    var tier2: any[] = [];
    var needed = count - fresh.length;
    for (var oi = 0; oi < seenIds.length && tier2.length < needed; oi++) {
      var sid = seenIds[oi];
      if (pickedIds[sid]) continue;
      var q2 = poolById[sid];
      if (q2) {
        tier2.push(q2);
        pickedIds[sid] = true;
      }
    }

    needed = count - fresh.length - tier2.length;
    if (needed <= 0) return fresh.concat(tier2).slice(0, count);

    // Tier 3: any remaining non-reserved pool question. Inflight IDs are never
    // reused, even when that means returning a partial pack.
    var tier3: any[] = [];
    for (var ti = 0; ti < pool.length && tier3.length < needed; ti++) {
      var pq = pool[ti];
      if (!pq || !pq.id) continue;
      if (pickedIds[pq.id]) continue;
      if (excluded[pq.id]) continue;
      tier3.push(pq);
      pickedIds[pq.id] = true;
    }

    return fresh.concat(tier2).concat(tier3).slice(0, count);
  }

  function collectInflightIdsForTopic(inflightPacks: any[], topic: string): string[] {
    var ids: string[] = [];
    for (var ip = 0; ip < inflightPacks.length; ip++) {
      var pack = inflightPacks[ip];
      if (pack.topic !== topic) continue;
      var qids = pack.question_ids;
      if (Array.isArray(qids)) {
        for (var qi = 0; qi < qids.length; qi++) ids.push(qids[qi]);
      }
    }
    return ids;
  }

  function snapshotInflightStats(
    inflightPacks: any[],
    topic:         string
  ): {
    inflight_packs:           number;
    inflight_ids_total:       number;
    inflight_ids_same_topic:  number;
    inflight_ids_other_topic: number;
  } {
    var total = 0;
    var same  = 0;
    for (var i = 0; i < inflightPacks.length; i++) {
      var qids = inflightPacks[i].question_ids;
      if (!Array.isArray(qids)) continue;
      total += qids.length;
      if (inflightPacks[i].topic === topic) same += qids.length;
    }
    return {
      inflight_packs:           inflightPacks.length,
      inflight_ids_total:       total,
      inflight_ids_same_topic:  same,
      inflight_ids_other_topic: total - same
    };
  }

  function countPickBreakdown(picked: any[], seenIds: string[]): { freshCount: number; backfillCount: number } {
    var seenSet: { [id: string]: boolean } = {};
    for (var si = 0; si < seenIds.length; si++) seenSet[seenIds[si]] = true;
    var backfill = 0;
    for (var pi = 0; pi < picked.length; pi++) {
      if (seenSet[picked[pi].id]) backfill++;
    }
    return { freshCount: picked.length - backfill, backfillCount: backfill };
  }

  function rebuildLangPool(
    pool:         any[],
    lang:         string,
    requireMedia: boolean,
    reqMediaType: string,
    excludeMedia: boolean
  ): { langPool: any[]; langActual: string } {
    var langActual = lang;
    var langPool: any[] = [];

    if (lang !== "en") {
      for (var lp = 0; lp < pool.length; lp++) {
        if (pool[lp].lang === lang) langPool.push(pool[lp]);
      }
    }

    if (langPool.length === 0) {
      if (lang !== "en") langActual = "en";
      for (var ep = 0; ep < pool.length; ep++) {
        if (!pool[ep].lang || pool[ep].lang === "en") langPool.push(pool[ep]);
      }
    }

    if (langPool.length === 0) langPool = pool;

    if (requireMedia) {
      var mediaPool = filterToMediaPool(langPool, reqMediaType);
      if (mediaPool.length > 0) langPool = mediaPool;
    } else if (excludeMedia) {
      var textPool = filterToTextPool(langPool);
      if (textPool.length > 0) langPool = textPool;
    }

    return { langPool: langPool, langActual: langActual };
  }

  function evictUnsubmittedInflightForTopic(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    topic:  string
  ): number {
    var deleted = 0;
    try {
      var result = nk.storageList(userId, COL_PACKS, 10, "");
      if (!result || !Array.isArray(result.objects) || result.objects.length === 0) return 0;
      var toDelete: nkruntime.StorageDeleteRequest[] = [];
      for (var i = 0; i < result.objects.length; i++) {
        var obj = result.objects[i];
        if (!obj || !obj.value || !obj.key) continue;
        var v: any = obj.value;
        if (v.submitted === true) continue;
        if (v.topic !== topic) continue;
        toDelete.push({ collection: COL_PACKS, key: obj.key, userId: userId });
        toDelete.push({ collection: COL_INFLT, key: obj.key, userId: userId });
        deleted++;
      }
      if (toDelete.length > 0) {
        nk.storageDelete(toDelete);
        logger.info("[QvGetQ] self-heal evicted " + deleted + " unsubmitted packs topic=" + topic);
      }
    } catch (_e) { /* non-fatal */ }
    return deleted;
  }

  /**
   * Make one bounded synchronous repair attempt when the selected pool cannot
   * satisfy the requested count. This is the cold-cache safety net; normal
   * requests remain storage-only and use the ready queue.
   */
  function fulfillRequestedCount(
    nk:             nkruntime.Nakama,
    logger:         nkruntime.Logger,
    env:            { [k: string]: string },
    userId:         string,
    topic:          string,
    lang:           string,
    requireMedia:   boolean,
    reqMediaType:   string,
    excludeMedia:   boolean,
    requestedCount: number,
    seenIds:        string[],
    inflightPacks:  any[],
    pool:           any[],
    langPool:       any[],
    langActual:     string,
    cacheResult:    any,
    picked:         any[],
    traceId:        string
  ): {
    picked:                any[];
    pool:                  any[];
    langPool:              any[];
    langActual:            string;
    cacheResult:           any;
    inflightPacks:         any[];
    inflightIds:           string[];
    cacheRefreshAttempted: boolean;
    fulfillAttempts:       number;
  } {
    var cacheRefreshAttempted = false;
    var inflightIds           = collectInflightIdsForTopic(inflightPacks, topic);
    var fulfillAttempts       = 0;

    if (picked.length < requestedCount) {
      fulfillAttempts++;
      var poolBefore = pool.length;
      cacheRefreshAttempted = true;

      var refreshResult = QvQuestionCache.refreshCache(nk, logger, env, topic);
      var refreshedCache = QvQuestionCache.readCache(nk, logger, topic);
      if (refreshedCache.questions.length > 0) {
        cacheResult = refreshedCache;
        pool = refreshedCache.questions;

        var rebuiltLangPool: any[] = [];
        langActual = lang;
        if (lang !== "en") {
          for (var rli = 0; rli < pool.length; rli++) {
            if (pool[rli].lang === lang) rebuiltLangPool.push(pool[rli]);
          }
        }
        if (rebuiltLangPool.length === 0) {
          if (lang !== "en") langActual = "en";
          for (var rei = 0; rei < pool.length; rei++) {
            if (!pool[rei].lang || pool[rei].lang === "en") rebuiltLangPool.push(pool[rei]);
          }
        }
        if (rebuiltLangPool.length === 0) rebuiltLangPool = pool;
        if (requireMedia) {
          rebuiltLangPool = filterToMediaPool(rebuiltLangPool, reqMediaType);
        } else if (excludeMedia) {
          var refreshedTextPool = filterToTextPool(rebuiltLangPool);
          if (refreshedTextPool.length > 0) rebuiltLangPool = refreshedTextPool;
        }

        langPool = rebuiltLangPool;
        inflightPacks = listInflight(nk, userId);
        inflightIds = collectInflightIdsForTopic(inflightPacks, topic);
        picked = filterAndPick(langPool, seenIds, inflightIds, requestedCount);
      }

      logger.info(formatQvLog("[QvGetQ][FULFILL:attempt]", {
        event:            "fulfill_attempt",
        traceId:          traceId,
        topic:            topic,
        attempt:          fulfillAttempts,
        requested:        requestedCount,
        picked:           picked.length,
        pool_before:      poolBefore,
        pool_after:       pool.length,
        refresh_ok:       refreshResult.ok,
        refresh_error:    refreshResult.error || "none"
      }));
    }

    // Last-resort availability tier: a stale unsubmitted pack must not force a
    // short quiz. Reuse those IDs only after fresh and oldest-seen candidates
    // have been exhausted. Packs remain unique internally; this only permits
    // overlap with another abandoned/inflight session owned by the same user.
    if (picked.length < requestedCount && langPool.length >= requestedCount && inflightIds.length > 0) {
      var withoutInflightExclusion = filterAndPick(langPool, seenIds, [], requestedCount);
      if (withoutInflightExclusion.length > picked.length) {
        picked = withoutInflightExclusion;
        logger.warn(formatQvLog("[QvGetQ][FULFILL:inflight_reuse]", {
          event:          "fulfill_inflight_reuse",
          traceId:        traceId,
          topic:          topic,
          requested:      requestedCount,
          delivered:      picked.length,
          inflight_count: inflightIds.length
        }));
      }
    }

    logger.info(formatQvLog("[QvGetQ][FULFILL:done]", {
      event:         "fulfill_done",
      traceId:       traceId,
      topic:         topic,
      requested:     requestedCount,
      delivered:     picked.length,
      attempts_used: fulfillAttempts,
      partial:       picked.length < requestedCount,
      served_from:   "cache"
    }));

    return {
      picked:                picked,
      pool:                  pool,
      langPool:              langPool,
      langActual:            langActual,
      cacheResult:           cacheResult,
      inflightPacks:         inflightPacks,
      inflightIds:           inflightIds,
      cacheRefreshAttempted: cacheRefreshAttempted,
      fulfillAttempts:       fulfillAttempts
    };
  }

  function determinePoolExhaustedReason(
    seenIds:               string[],
    inflightIds:           string[],
    langPool:              any[],
    count:                 number
  ): "all_seen" | "inflight_blocked" | "cache_thin" {
    if (langPool.length < count) return "cache_thin";
    if (inflightIds.length > 0 && seenIds.length === 0) return "inflight_blocked";
    return "all_seen";
  }

  function poolExhaustedMessage(reason: string): string {
    if (reason === "inflight_blocked") {
      return "Questions reserved from a previous session. Retry shortly.";
    }
    if (reason === "cache_thin") {
      return "Not enough questions cached yet. Retry shortly.";
    }
    return "All available questions for this topic have been seen. New questions are being fetched.";
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

  // Shared delete path for unsubmitted packs — used by abandon RPC and opportunistic cleanup.
  function deleteUnsubmittedPack(
    nk:     nkruntime.Nakama,
    userId: string,
    packId: string,
    logger: nkruntime.Logger
  ): { deleted: boolean; reason?: string } {
    try {
      var rows = nk.storageRead([{ collection: COL_PACKS, key: packId, userId: userId }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        return { deleted: false, reason: "not_found" };
      }
      var v: any = rows[0].value;
      if (v.submitted === true) {
        return { deleted: false, reason: "already_submitted" };
      }
      nk.storageDelete([
        { collection: COL_PACKS, key: packId, userId: userId },
        { collection: COL_INFLT, key: packId, userId: userId }
      ]);
      return { deleted: true };
    } catch (e: any) {
      var errMsg = (e && e.message) ? e.message : String(e);
      logger.warn("[QvAbandonPack] delete failed pack=" + packId + " err=" + errMsg);
      return { deleted: false, reason: "error" };
    }
  }

  // Deletes unsubmitted packs older than ABANDON_TTL_GETQUESTIONS_MS and their
  // matching qv_inflight sentinels. Runs before listInflight so stale locks
  // from abandoned ImageGuess sessions do not block the next request.
  function cleanAbandonedPacksOpportunistic(
    nk:      nkruntime.Nakama,
    logger:  nkruntime.Logger,
    userId:  string,
    traceId: string
  ): void {
    var t0 = nowMs();
    var packsDeleted = 0;
    try {
      var result = nk.storageList(userId, COL_PACKS, 10, "");
      if (!result || !Array.isArray(result.objects) || result.objects.length === 0) {
        logger.info(formatQvLog("[QvGetQ][DEBUG:abandon_cleanup]", {
          event:             "abandon_cleanup",
          traceId:           traceId,
          userId:            userId,
          packs_deleted:     0,
          inflight_deleted:  0,
          elapsed_ms:        nowMs() - t0
        }));
        return;
      }
      var now = nowMs();
      for (var i = 0; i < result.objects.length; i++) {
        var obj = result.objects[i];
        if (!obj || !obj.value || !obj.key) continue;
        var v: any = obj.value;
        var isAbandoned = v.submitted !== true &&
          typeof v.created_at_ms === "number" &&
          v.created_at_ms < now - ABANDON_TTL_GETQUESTIONS_MS;
        if (isAbandoned) {
          var delResult = deleteUnsubmittedPack(nk, userId, obj.key, logger);
          if (delResult.deleted) packsDeleted++;
        }
      }
      logger.info(formatQvLog("[QvGetQ][DEBUG:abandon_cleanup]", {
        event:             "abandon_cleanup",
        traceId:           traceId,
        userId:            userId,
        packs_deleted:     packsDeleted,
        inflight_deleted:  packsDeleted,
        elapsed_ms:        nowMs() - t0
      }));
    } catch (_e) { /* non-fatal */ }
  }

  // ── Ready-queue helpers (prewarm fast path) ───────────────────────────────
  //
  // qv_readyqueue/{topicSlug} (user-owned) is populated by prewarm_cron.ts
  // every hour and self-refreshed here after each cache-path delivery.
  //
  // serveFromReadyQueue(): revalidates seen/inflight/lang/media, then reserves
  //   the queue slice and pack atomically (null = cache-path fallback).
  // writeReadyQueue():     writes remaining fresh questions for next call.

  function serveFromReadyQueue(
    nk:       nkruntime.Nakama,
    logger:   nkruntime.Logger,
    userId:   string,
    topic:    string,
    count:    number,
    lang:     string,
    gameId:   string,
    requireMedia: boolean,
    mediaType: string,
    excludeMedia: boolean,
    seenIds: string[],
    inflightIds: string[]
  ): { questions: any[]; langActual: string; packId: string } | null {
    try {
      var topicSlug = topic.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "").substring(0, 64);
      var rows = nk.storageRead([{ collection: COL_READYQUEUE, key: topicSlug, userId: userId }]);
      if (!rows || rows.length === 0 || !rows[0].value) return null;
      var rq: any = rows[0].value;
      if (!rq.created_at_ms || !Array.isArray(rq.questions)) return null;
      // Hard drop after 2× TTL. Between TTL and 2×TTL: stale-while-revalidate —
      // still serve a complete eligible slice so cold origin refresh never blocks
      // the player while cron/client warm rewrites the queue.
      var rqAge = nowMs() - rq.created_at_ms;
      if (rqAge > READYQUEUE_TTL_MS * 2) return null;

      // Ready queues are only an optimization. Re-apply every correctness
      // filter because seen/inflight state may have changed after prewarming.
      var excluded: { [id: string]: boolean } = {};
      for (var si = 0; si < seenIds.length; si++) excluded[seenIds[si]] = true;
      for (var ii = 0; ii < inflightIds.length; ii++) excluded[inflightIds[ii]] = true;

      var fresh: any[] = [];
      for (var qi = 0; qi < rq.questions.length; qi++) {
        var candidate = rq.questions[qi];
        if (candidate && candidate.id && !excluded[candidate.id]) fresh.push(candidate);
      }

      var langActual = lang;
      var eligible: any[] = [];
      if (lang !== "en") {
        for (var li = 0; li < fresh.length; li++) {
          if (fresh[li].lang === lang) eligible.push(fresh[li]);
        }
      }
      if (eligible.length < count) {
        eligible = [];
        if (lang !== "en") langActual = "en";
        for (var ei = 0; ei < fresh.length; ei++) {
          if (!fresh[ei].lang || fresh[ei].lang === "en") eligible.push(fresh[ei]);
        }
      }
      if (eligible.length === 0 && lang === "en") eligible = fresh;

      if (requireMedia) {
        eligible = filterToMediaPool(eligible, mediaType);
      } else if (excludeMedia) {
        eligible = filterToTextPool(eligible);
      }
      if (eligible.length < count) return null;

      var served = eligible.slice(0, count);
      var servedIds: { [id: string]: boolean } = {};
      for (var sqi = 0; sqi < served.length; sqi++) servedIds[served[sqi].id] = true;
      var remaining: any[] = [];
      for (var rqi = 0; rqi < fresh.length; rqi++) {
        if (!servedIds[fresh[rqi].id]) remaining.push(fresh[rqi]);
      }

      // Reserve the queue slice and create its pack in one CAS transaction.
      // A concurrent request can never consume the same ready-queue version.
      var packId = makePackId(nk, gameId, topic);
      var now = nowMs();
      var expiry = now + INFLIGHT_TTL_MS;
      var questionIds: string[] = [];
      for (var qii = 0; qii < served.length; qii++) questionIds.push(served[qii].id);
      nk.storageWrite([
        {
          collection: COL_READYQUEUE, key: topicSlug, userId: userId,
          value: { topic: rq.topic, questions: remaining, created_at_ms: rq.created_at_ms },
          version: rows[0].version,
          permissionRead: 0, permissionWrite: 0
        },
        {
          collection: COL_INFLT, key: packId, userId: userId,
          value: {
            pack_id: packId, topic: topic, question_ids: questionIds,
            created_at_ms: now, expires_at_ms: expiry
          },
          permissionRead: 0, permissionWrite: 0
        },
        {
          collection: COL_PACKS, key: packId, userId: userId,
          value: {
            pack_id: packId, topic: topic, lang: lang, lang_actual: langActual,
            game_id: gameId, question_ids: questionIds,
            question_count: served.length, questions: served,
            created_at_ms: now, expires_at_ms: expiry
          },
          permissionRead: 1, permissionWrite: 0
        }
      ]);

      logger.info("[QvGetQ] readyqueue HIT user=" + userId + " topic=" + topicSlug +
        " served=" + served.length + " remaining=" + remaining.length);
      return { questions: served, langActual: langActual, packId: packId };
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
   *     question_count:  number,
   *     requested_count: number,      // echo of input count
   *     partial:         boolean,     // question_count < requested_count
   *     pool_size:       number,      // cache pool size before pick
   *     questions:       Question[],  // pre-shuffled, A/B/C/D already assigned
   *     cache_expired:   boolean      // hint: cache refresh may be due
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

    var _traceId = (ctx.userId || "anon") + "_" + Date.now();
    logger.info("[QvGetQ][ENTER] traceId=" + _traceId + " rawPayload=" + (payload || ""));

    try {
      return _rpcGetQuestionsImpl(ctx, logger, nk, payload, _traceId);
    } catch (e: any) {
      var errMsg  = (e && e.message) ? e.message : String(e);
      var errCode = (e && typeof e.code === "number") ? e.code : -1;
      // Full structured error — visible in Grafana / CloudWatch under /aws/ecs/nakama
      logger.error("[QvGetQ][ERROR] traceId=" + _traceId +
        " userId=" + (ctx.userId || "anon") +
        " payload=" + (payload || "") +
        " errCode=" + errCode +
        " errMsg=" + errMsg);
      throw e; // re-throw so Nakama returns proper gRPC status to Unity
    }
  }

  function _rpcGetQuestionsImpl(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string,
    traceId: string
  ): string {

    // ── Auth ───────────────────────────────────────────────────────────────
    var userId = ctx.userId;
    if (!userId) throw nakamaError("not authenticated", nkruntime.Codes.UNAUTHENTICATED);

    // ── Parse + validate request ───────────────────────────────────────────
    var req   = parseJson(payload);
    var topic = (typeof req.topic === "string" && req.topic) ? req.topic.toLowerCase().trim() : "";
    if (!topic) throw nakamaError("topic is required", nkruntime.Codes.INVALID_ARGUMENT);
    if (TOPIC_ALIASES[topic]) topic = TOPIC_ALIASES[topic];

    if (!KNOWN_TOPICS[topic]) {
      var normalizedTopic = normalizeUnresolvedTopic(topic, userId + "|" + topic);
      if (normalizedTopic !== topic) {
        logger.warn("[QvGetQ] normalized unrecognized topic '" + topic + "' -> '" + normalizedTopic + "' user=" + userId);
        topic = normalizedTopic;
      }
    }

    var count = DEFAULT_COUNT;
    if (typeof req.count === "number" && req.count >= MIN_COUNT) {
      count = Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.floor(req.count)));
    }

    var lang = (typeof req.lang === "string" && req.lang) ? req.lang.toLowerCase().trim() : "en";

    var requireMedia = req.has_media === true;
    var excludeMedia = req.exclude_media === true;
    var reqMediaType = (typeof req.media_type === "string" && req.media_type)
      ? req.media_type.toLowerCase().trim() : "";
    if (!requireMedia && reqMediaType) requireMedia = true;
    // A media request without an explicit type must never mix audio and image
    // rows. Unity's visual modes expect images; the music topic is the one
    // intentional audio-first exception.
    if (requireMedia && !reqMediaType) {
      reqMediaType = topic === "music" ? "audio" : "image";
    }
    if (requireMedia) excludeMedia = false;

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

    var requestedTopic = topic;
    var requestedCount = count;

    logger.info("[QvGetQ][REQ] traceId=" + traceId +
      " user=" + userId + " topic=" + topic +
      " count=" + count + " lang=" + lang + " gameId=" + gameId +
      " mode=" + mode + " country=" + countryCode);

    // ── 0a. Cold start protocol ─────────────────────────────────────────────
    //
    // New players (total_sessions < 3) get a guided onboarding experience when
    // they request the session's guided topic (anime → pokemon → movies).
    // Question count is honored; cold_start flag hints Unity to show onboarding UI.
    //
    // cold_start_done is set to true by submit_result after the 3rd session;
    // afterwards this block is a no-op (PlayerDNA.load returns cold_start_done=true).
    var coldStartApplied = false;
    try {
      var coldDna = PlayerDNA.load(nk, userId);
      var beh = coldDna.behavioral;
      if (!beh.cold_start_done && beh.total_sessions < 3) {
        var forcedTopic = PlayerDNA.coldStartTopic(beh.total_sessions);

        if (topic === forcedTopic) {
          coldStartApplied = true;
          mode = "standard";
          logger.info(formatQvLog("[QvGetQ][COLD_START:apply]", {
            event:           "cold_start_apply",
            traceId:         traceId,
            userId:          userId,
            sessions:        beh.total_sessions,
            requested_topic: requestedTopic,
            guided_topic:    forcedTopic,
            requested_count: requestedCount,
            cold_start_done: beh.cold_start_done
          }));
        } else {
          logger.info(formatQvLog("[QvGetQ][COLD_START:skip]", {
            event:           "cold_start_skip",
            traceId:         traceId,
            userId:          userId,
            sessions:        beh.total_sessions,
            requested_topic: requestedTopic,
            guided_topic:    forcedTopic,
            reason:          "explicit_topic_mismatch",
            cold_start_done: beh.cold_start_done
          }));
        }
      }
    } catch (_cse) { /* non-fatal: proceed with original topic */ }

    // ── 0. Opportunistic pack cleanup (org5) ────────────────────────────────
    cleanExpiredPacksOpportunistic(nk, logger, userId);
    cleanAbandonedPacksOpportunistic(nk, logger, userId, traceId);

    // ── 1. Rate limit (Task 1b.1) ──────────────────────────────────────────
    logger.info("[QvGetQ][GATE:rate_check] traceId=" + traceId + " user=" + userId);
    enforceRateLimit(nk, userId, logger, { traceId: traceId, topic: topic }, resolveRateMax(ctx.env));

    // ── 2. Pack limit — evict oldest if at cap (Task 1b.1) ─────────────────
    var inflightPacks = listInflight(nk, userId);
    var inflightSnap  = snapshotInflightStats(inflightPacks, topic);
    logger.info(formatQvLog("[QvGetQ][DEBUG:inflight_snapshot]", {
      event:                    "inflight_snapshot",
      traceId:                  traceId,
      userId:                   userId,
      topic:                    topic,
      inflight_packs:           inflightSnap.inflight_packs,
      inflight_ids_total:       inflightSnap.inflight_ids_total,
      inflight_ids_same_topic:  inflightSnap.inflight_ids_same_topic,
      inflight_ids_other_topic: inflightSnap.inflight_ids_other_topic
    }));
    inflightPacks = enforcePacks(nk, logger, userId, inflightPacks);

    // Collect question IDs reserved by active packs for this topic only
    var inflightIds = collectInflightIdsForTopic(inflightPacks, topic);
    var seenIds = readSeenIds(nk, userId, topic);

    // ── 3. Ready-queue fast path (prewarm hit) ─────────────────────────────
    //
    // Checks qv_readyqueue first. The queue is revalidated against current
    // seen/inflight/language/media state before its CAS reservation is served.

    if (mode !== "personalized") { // personalized mode always uses live cache+SRQ
      var rqResult = serveFromReadyQueue(
        nk, logger, userId, topic, count, lang, gameId, requireMedia, reqMediaType,
        excludeMedia, seenIds, inflightIds
      );
      if (rqResult !== null) {
        var rqServed = rqResult.questions;
        var rqLangActual = rqResult.langActual;
        var rqPackId = rqResult.packId;
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
          ok:              true,
          pack_id:         rqPackId,
          topic:           topic,
          lang:            lang,
          mode:            mode,
          country_code:    countryCode,
          question_count:  rqClientQs.length,
          requested_count: requestedCount,
          partial:         rqClientQs.length < requestedCount,
          questions:       rqClientQs,
          cache_expired:   false,
          served_from:     "readyqueue"
        };
        if (rqLangActual !== lang) rqResp.lang_actual = rqLangActual;
        return JSON.stringify(rqResp);
      }

      // A queue CAS may have lost to another request. Re-read reservations
      // before selecting from the shared cache.
      inflightPacks = listInflight(nk, userId);
      inflightIds = collectInflightIdsForTopic(inflightPacks, topic);
    }

    // ── 3. Read cache (normal path) ────────────────────────────────────────
    var cacheResult = QvQuestionCache.readCache(nk, logger, topic);
    var pool        = cacheResult.questions;

    if (pool.length === 0) {
      var emptyCache = handleEmptyTopicCache(nk, logger, ctx.env || {}, topic, traceId, coldStartApplied, userId);
      pool        = emptyCache.pool;
      cacheResult = emptyCache.cacheResult;
      if (emptyCache.earlyReturn) return emptyCache.earlyReturn;
    }
    logger.info("[QvGetQ][GATE:cache_ok] traceId=" + traceId + " topic=" + topic +
      " poolSize=" + pool.length + " cacheExpired=" + cacheResult.expired);
    if (cacheResult.expired) {
      QvQuestionCache.requestRefresh(nk, logger, topic, "cache_expired");
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
    langPool = filterToTopicContract(langPool, topic, requireMedia, reqMediaType);

    // ── 4a. Media filter (ImageGuess / audio quiz modes) ────────────────────
    if (requireMedia) {
      var mediaPool = filterToMediaPool(langPool, reqMediaType);
      if (mediaPool.length === 0) {
        logger.warn(formatQvLog("[QvGetQ][GATE:stale_cache_media]", {
          event:      "stale_cache_media_heal",
          traceId:    traceId,
          topic:      topic,
          langPool:   langPool.length,
          media_type: reqMediaType || "any"
        }));
        // Repair stale schemas synchronously once. This covers old anime
        // genre/year rows, mixed flags/countries caches, and pre-Deezer music
        // caches without making the player retry after deployment.
        QvQuestionCache.refreshCache(nk, logger, ctx.env || {}, topic, true);
        var repairedCache = QvQuestionCache.readCache(nk, logger, topic);
        if (repairedCache.questions.length > 0) {
          pool = repairedCache.questions;
          cacheResult = repairedCache;
          var repairedLangPool: any[] = [];
          for (var rmi = 0; rmi < pool.length; rmi++) {
            var repairedQ = pool[rmi];
            if (lang === "en") {
              if (!repairedQ.lang || repairedQ.lang === "en") repairedLangPool.push(repairedQ);
            } else if (repairedQ.lang === lang) {
              repairedLangPool.push(repairedQ);
            }
          }
          if (repairedLangPool.length === 0 && lang !== "en") {
            langActual = "en";
            for (var rme = 0; rme < pool.length; rme++) {
              if (!pool[rme].lang || pool[rme].lang === "en") repairedLangPool.push(pool[rme]);
            }
          }
          if (repairedLangPool.length === 0) repairedLangPool = pool;
          repairedLangPool = filterToTopicContract(
            repairedLangPool, topic, requireMedia, reqMediaType);
          mediaPool = filterToMediaPool(repairedLangPool, reqMediaType);
        }
        if (mediaPool.length === 0) {
          QvQuestionCache.requestRefresh(nk, logger, topic, "media_pool_empty");
        }
        logger.info(formatQvLog("[QvGetQ][GATE:stale_cache_media_done]", {
          event:       "stale_cache_media_refresh_queued",
          traceId:     traceId,
          topic:       topic,
          pool_after:  pool.length,
          media_after: mediaPool.length
        }));
      }
      if (mediaPool.length === 0) {
        logger.warn("[QvGetQ] no media questions topic=" + topic + " pool_size=" + pool.length +
          " langPool=" + langPool.length + " media_type=" + (reqMediaType || "any"));
        return JSON.stringify({
          ok:        false,
          error:     "no_media_questions",
          topic:     topic,
          message:   "No questions with media available for this topic.",
          pool_size: pool.length
        });
      }
      langPool = mediaPool;
    } else if (excludeMedia) {
      var textOnlyPool = filterToTextPool(langPool);
      if (textOnlyPool.length > 0) {
        langPool = textOnlyPool;
      } else if (langPool.length > 0) {
        logger.warn("[QvGetQ] exclude_media but no text questions topic=" + topic +
          " langPool=" + langPool.length);
      }
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
    var poolSizeBeforePick = pool.length;
    var picked  = filterAndPick(langPool, seenIds, inflightIds, requestedCount);

    var fulfillResult = fulfillRequestedCount(
      nk, logger, ctx.env || {}, userId, topic, lang, requireMedia, reqMediaType, excludeMedia,
      requestedCount, seenIds, inflightPacks, pool, langPool, langActual, cacheResult,
      picked, traceId
    );
    picked                  = fulfillResult.picked;
    pool                    = fulfillResult.pool;
    langPool                = fulfillResult.langPool;
    langActual              = fulfillResult.langActual;
    cacheResult             = fulfillResult.cacheResult;
    inflightPacks           = fulfillResult.inflightPacks;
    inflightIds             = fulfillResult.inflightIds;
    var cacheRefreshAttempted = fulfillResult.cacheRefreshAttempted;

    if (picked.length === 0) {
      var exhaustedReason = determinePoolExhaustedReason(seenIds, inflightIds, langPool, requestedCount);
      var blockedQId      = inflightIds.length > 0 ? inflightIds[0] : "";
      logger.warn(formatQvLog("[QvGetQ][GATE:pool_exhausted]", {
        event:                    "pool_exhausted",
        traceId:                  traceId,
        topic:                    topic,
        reason:                   exhaustedReason,
        seen:                     seenIds.length,
        langPool:                 langPool.length,
        inflight_same_topic:      inflightIds.length,
        blocked_q_id:             blockedQId,
        cache_refresh_attempted:  cacheRefreshAttempted
      }));
      return JSON.stringify({
        ok:                  false,
        error:               "pool_exhausted",
        reason:              exhaustedReason,
        topic:               topic,
        message:             poolExhaustedMessage(exhaustedReason),
        retry_after_seconds: POOL_EXHAUSTED_RETRY_SEC
      });
    }

    if (picked.length > 0 && picked.length < requestedCount) {
      logger.warn(formatQvLog("[QvGetQ][FULFILL:exhausted]", {
        event:               "fulfill_exhausted",
        traceId:             traceId,
        topic:               topic,
        requested:           requestedCount,
        delivered:           picked.length,
        pool_size:           pool.length,
        seen:                seenIds.length,
        inflight_same_topic: inflightIds.length
      }));
    }

    var pickBreakdown = countPickBreakdown(picked, seenIds);
    logger.info(formatQvLog("[QvGetQ][GATE:picked]", {
      event:                        "picked",
      traceId:                      traceId,
      topic:                        topic,
      picked:                       picked.length,
      from_langPool:                langPool.length,
      seen:                         seenIds.length,
      inflightExcluded:             inflightIds.length,
      fresh_count:                  pickBreakdown.freshCount,
      backfill_count:               pickBreakdown.backfillCount,
      inflight_excluded_same_topic: inflightIds.length
    }));

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

    logger.info("[QvGetQ][DONE] traceId=" + traceId +
      " pack=" + packId + " topic=" + topic +
      " requested_topic=" + requestedTopic +
      " topic_mismatch=" + (topic !== requestedTopic ? "true" : "false") +
      " delivered=" + picked.length + "/" + requestedCount +
      " partial=" + (picked.length < requestedCount ? "true" : "false") +
      " pool=" + pool.length + " seen=" + seenIds.length +
      " inflight=" + inflightIds.length + " cache_expired=" + cacheResult.expired +
      " coldStart=" + coldStartApplied + " mode=" + mode);

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
      ok:              true,
      pack_id:         packId,
      topic:           topic,
      lang:            lang,
      mode:            mode,
      country_code:    countryCode,
      question_count:  clientQs.length,
      requested_count: requestedCount,
      partial:         clientQs.length < requestedCount,
      pool_size:       poolSizeBeforePick,
      questions:       clientQs,
      cache_expired:   cacheResult.expired   // hint: client may show "refreshing…"
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

  /**
   * quizverse_abandon_pack
   *
   * Immediately releases an unsubmitted question pack and its inflight sentinel.
   * Idempotent — safe to call multiple times on the same pack_id.
   *
   * Input:  { pack_id: string } | { pack_ids: string[] }
   * Output: { ok: true, abandoned: number, skipped: number, details: [...] }
   */
  function rpcAbandonPack(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = ctx.userId || "";
    if (!userId) {
      throw nakamaError("authentication required", nkruntime.Codes.UNAUTHENTICATED);
    }

    var req = parseJson(payload);
    var packIds: string[] = [];
    if (req.pack_id) {
      packIds.push(String(req.pack_id));
    }
    if (Array.isArray(req.pack_ids)) {
      for (var pi = 0; pi < req.pack_ids.length; pi++) {
        if (req.pack_ids[pi]) packIds.push(String(req.pack_ids[pi]));
      }
    }
    if (packIds.length === 0) {
      throw nakamaError("pack_id or pack_ids required", nkruntime.Codes.INVALID_ARGUMENT);
    }

    var abandoned = 0;
    var skipped   = 0;
    var details: any[] = [];

    for (var i = 0; i < packIds.length; i++) {
      var packId   = packIds[i];
      var result   = deleteUnsubmittedPack(nk, userId, packId, logger);
      var reason   = result.reason || (result.deleted ? "deleted" : "skipped");
      details.push({ pack_id: packId, deleted: result.deleted, reason: reason });
      logger.info(formatQvLog("[QvAbandonPack]", {
        pack_id:   packId,
        abandoned: result.deleted ? 1 : 0,
        reason:    reason
      }));
      if (result.deleted) {
        abandoned++;
      } else {
        skipped++;
      }
    }

    return JSON.stringify({ ok: true, abandoned: abandoned, skipped: skipped, details: details });
  }

  // ── Registration ───────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_get_questions", rpcGetQuestions);
    initializer.registerRpc("quizverse_abandon_pack", rpcAbandonPack);
  }

  // IIFE NOOP — required by postbuild.js to hoist __rpc_ assignments at
  // module-load time before InitModule fires. See migration.ts for rationale.
  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
