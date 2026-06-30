// remote_config.ts — server-driven configuration for the QuizVerse question pipeline.
//
// RPCS IN THIS FILE
//   quizverse_get_config   — public, no auth required
//   quizverse_admin_stats  — admin-only (IVX_SYSTEM_USER_ID gate)
//
// WHY ONE FILE
//   Both RPCs share the same domain (server-owned configuration + health observability)
//   and the same storage namespace (qv_config, qv_cache_*, qv_circuit_breakers,
//   qv_stats). Co-locating them here makes the entire remote-config surface area
//   trivially grep-able by filename and prevents drift between the topic/provider
//   constant lists used by both handlers.
//
// ─── quizverse_get_config ────────────────────────────────────────────────────
//   Unity calls this once on startup (no auth) to receive the full topic catalogue,
//   feature flags, language support matrix, and client_min_version. Zero lists are
//   hardcoded in the APK — everything is server-owned. Adding a topic or toggling a
//   feature is a one-doc Console write; no client release required.
//
//   Storage:  qv_config / "global"  (userId: "", permRead: 2, permWrite: 0)
//   Fallback: built-in defaults — the RPC never errors on a missing doc.
//   Merge:    shallow per-field; stored values win, defaults fill the rest.
//   TTL hint: cache_max_age_seconds tells Unity how long to cache the response.
//
// ─── quizverse_admin_stats ───────────────────────────────────────────────────
//   Admin-only health dashboard for the entire question-delivery pipeline.
//   Returns five sections — all isolated in try/catch; one broken section never
//   kills the whole call:
//     config          — qv_config/global integrity
//     cache           — per-topic cache pool (question count, age, staleness,
//                       quality-gate pass rate, lang breakdown, providers used)
//     circuit_breakers — per-provider circuit state (closed/open/half_open,
//                        fail count, trip count, reset countdown)
//     pack_stats      — aggregate pack issuance/submission/expiry (Phase 1b)
//     summary         — traffic-light status: "healthy" | "degraded" | "critical"
//
//   Auth: ctx.userId must equal IVX_SYSTEM_USER_ID env var.
//   Phase awareness: Phase 1a/1b sections return { phase: "not_yet_deployed" }
//   on a fresh install — zero errors, clear operator messaging.
//
// POSTBUILD NOTE
//   RPC ids in registerRpc() MUST be string literals. Nakama's postbuild AST
//   walker only extracts __rpc_<id> stubs from literals, not variable references.
//   See migration.ts PR #69 / index.ts PR #94/#97/#100 for the incident history.

namespace QvRemoteConfig {

  // ── Storage keys ──────────────────────────────────────────────────────────
  var COL_CONFIG          = "qv_config";
  var COL_CACHE_PREFIX    = "qv_cache_";          // qv_cache_{topic}
  var COL_CIRCUIT_BREAKER = "qv_circuit_breakers";
  var COL_STATS           = "qv_stats";            // aggregate rollup (Phase 1b)
  var KEY_GLOBAL          = "global";

  // S3 base for default topic icon URLs. Overridable per-topic in the stored doc.
  var S3_ICONS_BASE = "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/topic-icons/";

  // ── Domain constants ──────────────────────────────────────────────────────
  // Shared by both RPCs. MUST stay in sync with question_cache.ts when it ships.
  var KNOWN_TOPICS = [
    "anime", "pokemon", "movies",   "sports", "countries", "flags",
    "space", "music",   "disney",   "ghibli", "starwars",  "food",
    "cocktail", "dog",  "news",     "opentdb","ai",        "daily", "weekly"
  ];

  // Every external API provider the cache layer calls. Sync with question_cache.ts.
  var KNOWN_PROVIDERS = [
    "jikan",       "pokeapi",    "tmdb",       "nasa",
    "lastfm",      "deezer",     "gnews",      "currents",
    "mediastack",  "newsapi",    "opentdb",    "disney",
    "ghibli",      "swapi",      "thesportsdb","cocktaildb",
    "themealdb",   "foodfacts",  "dogceo",     "restcountries"
  ];

  // Cache is considered "near expiry" when ≤ 10 min remain.
  // Ops gets a warning window before questions run dry.
  var STALE_WARNING_MS = 10 * 60 * 1000;

  // ── Shared helpers ────────────────────────────────────────────────────────

  function nakamaError(msg: string, code: number): nkruntime.Error {
    return { message: msg, code: code };
  }

  function nowMs(): number {
    return Date.now();
  }

  function isoOf(ms: number): string {
    return new Date(ms).toISOString();
  }

  function requireAdmin(ctx: nkruntime.Context): void {
    var userId = ctx.userId;
    if (!userId) throw nakamaError("not authenticated", nkruntime.Codes.UNAUTHENTICATED);
    var env: any = ctx.env || {};
    var systemId = env.IVX_SYSTEM_USER_ID || "";
    if (!systemId || userId !== systemId) throw nakamaError("admin only", nkruntime.Codes.PERMISSION_DENIED);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — GET CONFIG (public RPC)
  // ══════════════════════════════════════════════════════════════════════════

  function buildDefaultTopics(): any[] {
    return [
      { id: "anime",     label: "Anime",         icon_url: S3_ICONS_BASE + "anime.png",     has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 1,  max_count: 20 },
      { id: "pokemon",   label: "Pokémon",        icon_url: S3_ICONS_BASE + "pokemon.png",   has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 2,  max_count: 20 },
      { id: "movies",    label: "Movies",         icon_url: S3_ICONS_BASE + "movies.png",    has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 3,  max_count: 20 },
      { id: "sports",    label: "Sports",         icon_url: S3_ICONS_BASE + "sports.png",    has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 4,  max_count: 20 },
      { id: "countries", label: "Countries",      icon_url: S3_ICONS_BASE + "countries.png", has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 5,  max_count: 20 },
      { id: "flags",     label: "Flags",          icon_url: S3_ICONS_BASE + "flags.png",     has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 6,  max_count: 20 },
      { id: "space",     label: "Space",          icon_url: S3_ICONS_BASE + "space.png",     has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 7,  max_count: 10 },
      { id: "music",     label: "Music",          icon_url: S3_ICONS_BASE + "music.png",     has_media: true,  media_type: "audio", enabled: true,  is_new: false, badge: null, sort_order: 8,  max_count: 15 },
      { id: "disney",    label: "Disney",         icon_url: S3_ICONS_BASE + "disney.png",    has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 9,  max_count: 20 },
      { id: "ghibli",    label: "Studio Ghibli",  icon_url: S3_ICONS_BASE + "ghibli.png",    has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 10, max_count: 20 },
      { id: "starwars",  label: "Star Wars",      icon_url: S3_ICONS_BASE + "starwars.png",  has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 11, max_count: 20 },
      { id: "food",      label: "Food",           icon_url: S3_ICONS_BASE + "food.png",      has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 12, max_count: 20 },
      { id: "cocktail",  label: "Cocktails",      icon_url: S3_ICONS_BASE + "cocktail.png",  has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 13, max_count: 20 },
      { id: "dog",       label: "Dogs",           icon_url: S3_ICONS_BASE + "dog.png",       has_media: true,  media_type: "image", enabled: true,  is_new: false, badge: null, sort_order: 14, max_count: 20 },
      { id: "news",      label: "News",           icon_url: S3_ICONS_BASE + "news.png",      has_media: false, media_type: null,    enabled: true,  is_new: false, badge: null, sort_order: 15, max_count: 10 },
      { id: "opentdb",   label: "General Trivia", icon_url: S3_ICONS_BASE + "general.png",   has_media: false, media_type: null,    enabled: true,  is_new: false, badge: null, sort_order: 16, max_count: 20 },
      { id: "ai",        label: "AI Quiz",        icon_url: S3_ICONS_BASE + "ai.png",        has_media: false, media_type: null,    enabled: true,  is_new: false, badge: null, sort_order: 17, max_count: 10 },
      { id: "daily",     label: "Daily Quiz",     icon_url: S3_ICONS_BASE + "daily.png",     has_media: false, media_type: null,    enabled: true,  is_new: false, badge: null, sort_order: 18, max_count: 10 },
      { id: "weekly",    label: "Weekly Quiz",    icon_url: S3_ICONS_BASE + "weekly.png",    has_media: false, media_type: null,    enabled: true,  is_new: false, badge: null, sort_order: 19, max_count: 10 }
    ];
  }

  function buildDefaultSupportedLangs(): any {
    return {
      anime:     ["en"],
      pokemon:   ["en"],
      movies:    ["en"],
      sports:    ["en"],
      countries: ["en"],
      flags:     ["en"],
      space:     ["en"],
      music:     ["en"],
      disney:    ["en"],
      ghibli:    ["en"],
      starwars:  ["en"],
      food:      ["en"],
      cocktail:  ["en"],
      dog:       ["en"],
      news:      ["en", "es", "fr", "de", "pt", "it"],
      opentdb:   ["en"],
      ai:        ["en", "hi", "es", "fr", "de", "ja", "ko", "pt", "ar", "ru", "id"],
      daily:     ["en"],
      weekly:    ["en"]
    };
  }

  function buildDefaultConfig(): any {
    return {
      schema_version:        1,
      topics:                buildDefaultTopics(),
      max_count:             20,
      features: {
        review_and_learn:    true,
        daily_quiz:          true,
        weekly_quiz:         true,
        personalized_mode:   false,
        ai_topic:            true,
        music_topic:         true
      },
      supported_langs:       buildDefaultSupportedLangs(),
      client_min_version:    "1.0.0",
      cache_max_age_seconds: 300,
      last_updated_at:       ""
    };
  }

  // Shallow-merges stored doc fields over defaults.
  // Stored value wins per top-level key; untouched keys come from defaults.
  // Partial admin edits (e.g. only updating topics[]) cannot break other fields.
  function mergeConfig(defaults: any, stored: any): any {
    if (!stored || typeof stored !== "object") return defaults;

    var merged: any = {};

    var scalars = ["schema_version", "max_count", "client_min_version", "cache_max_age_seconds", "last_updated_at"];
    for (var i = 0; i < scalars.length; i++) {
      var f = scalars[i];
      merged[f] = (stored[f] !== undefined && stored[f] !== null) ? stored[f] : defaults[f];
    }

    // topics[] — stored replaces the whole array (no per-topic merge to keep it simple).
    merged.topics = (stored.topics && stored.topics.length > 0) ? stored.topics : defaults.topics;

    // features — per-key merge; stored wins per flag, new defaults fill gaps.
    merged.features = {};
    var df = defaults.features || {};
    var sf = stored.features   || {};
    for (var fk in df) {
      if (df.hasOwnProperty(fk)) merged.features[fk] = (sf[fk] !== undefined) ? sf[fk] : df[fk];
    }
    for (var sfk in sf) {
      if (sf.hasOwnProperty(sfk) && merged.features[sfk] === undefined) merged.features[sfk] = sf[sfk];
    }

    // supported_langs — same per-key strategy as features.
    merged.supported_langs = {};
    var dl = defaults.supported_langs || {};
    var sl = stored.supported_langs   || {};
    for (var lk in dl) {
      if (dl.hasOwnProperty(lk)) merged.supported_langs[lk] = (sl[lk] !== undefined) ? sl[lk] : dl[lk];
    }
    for (var slk in sl) {
      if (sl.hasOwnProperty(slk) && merged.supported_langs[slk] === undefined) merged.supported_langs[slk] = sl[slk];
    }

    return merged;
  }

  // ── Client response builder ────────────────────────────────────────────────
  //
  // Converts the internal merged config (which uses server-side field names) into
  // the flat shape that Unity's QuizConfigResponse model expects:
  //   topics[]:       slug, label, icon, enabled, description, is_new
  //   features:       review_and_learn, image_questions, ai_explanations,
  //                   adaptive_difficulty, daily_quiz, weekly_quiz, personalized_mode
  //   supported_langs: sorted unique lang codes across all topics (flat string[])
  //   client_min_version, cache_max_age_seconds

  function buildClientResponse(merged: any): any {
    // topics: map internal shape (id / icon_url) → Unity shape (slug / icon)
    var rawTopics: any[] = Array.isArray(merged.topics) ? merged.topics : [];
    var clientTopics: any[] = [];
    for (var ti = 0; ti < rawTopics.length; ti++) {
      var t = rawTopics[ti];
      if (!t) continue;
      clientTopics.push({
        slug:        t.id        || t.slug        || "",
        label:       t.label     || t.id          || "",
        icon:        t.icon_url  || t.icon        || "",
        enabled:     t.enabled !== false,
        description: t.description || "",
        is_new:      t.is_new === true
      });
    }

    // supported_langs: flatten map → sorted unique lang codes
    var langSet: { [l: string]: boolean } = {};
    var slMap: any = merged.supported_langs || {};
    for (var lk in slMap) {
      if (!slMap.hasOwnProperty(lk)) continue;
      var arr: string[] = slMap[lk];
      if (!Array.isArray(arr)) continue;
      for (var li = 0; li < arr.length; li++) if (arr[li]) langSet[arr[li]] = true;
    }
    var supportedLangs: string[] = Object.keys(langSet).sort();
    if (supportedLangs.length === 0) supportedLangs = ["en"];

    // features: server-side flag names → Unity ConfigFeatures field names
    var sf: any = merged.features || {};
    var clientFeatures: any = {
      review_and_learn:    sf.review_and_learn    !== false,
      image_questions:     sf.image_questions     === true,    // off by default
      ai_explanations:     sf.ai_explanations     === true,    // off by default
      adaptive_difficulty: sf.personalized_mode   !== false,
      daily_quiz:          sf.daily_quiz          !== false,
      weekly_quiz:         sf.weekly_quiz         !== false,
      personalized_mode:   sf.personalized_mode   !== false,
      ai_topic:            sf.ai_topic            !== false
    };

    return {
      ok:                   true,
      topics:               clientTopics,
      features:             clientFeatures,
      supported_langs:      supportedLangs,
      client_min_version:   merged.client_min_version   || "1.0.0",
      cache_max_age_seconds: merged.cache_max_age_seconds || 300
    };
  }

  function rpcGetConfig(
    _ctx:     nkruntime.Context,
    logger:   nkruntime.Logger,
    nk:       nkruntime.Nakama,
    _payload: string
  ): string {
    var defaults = buildDefaultConfig();
    var stored: any = null;

    try {
      var rows = nk.storageRead([{ collection: COL_CONFIG, key: KEY_GLOBAL, userId: "" }]);
      if (rows && rows.length > 0 && rows[0].value) {
        stored = rows[0].value;
      } else {
        logger.warn("[QvRemoteConfig/get_config] qv_config/global not found — using built-in defaults. " +
          "Create the doc in Nakama Console to customise the topic list.");
      }
    } catch (err: any) {
      logger.error("[QvRemoteConfig/get_config] storage read error: " +
        (err && err.message ? err.message : String(err)) + " — falling back to built-in defaults.");
    }

    return JSON.stringify(buildClientResponse(mergeConfig(defaults, stored)));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — ADMIN STATS (admin-only RPC)
  // ══════════════════════════════════════════════════════════════════════════
  // Section readers are all isolated — one storage failure never kills the call.

  function readConfigHealth(nk: nkruntime.Nakama, logger: nkruntime.Logger): any {
    try {
      var rows = nk.storageRead([{ collection: COL_CONFIG, key: KEY_GLOBAL, userId: "" }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        return {
          present: false,
          source:  "built_in_defaults",
          note:    "qv_config/global not found — server is using built-in defaults. " +
                   "Create the doc in Nakama Console to customise the topic list."
        };
      }
      var v: any      = rows[0].value;
      var topics: any[] = v.topics || [];
      var enabledCount = 0;
      var mediaCount   = 0;
      for (var i = 0; i < topics.length; i++) {
        if (topics[i].enabled !== false) enabledCount++;
        if (topics[i].has_media)         mediaCount++;
      }
      return {
        present:            true,
        schema_version:     v.schema_version     || 0,
        topic_count:        topics.length,
        enabled_topics:     enabledCount,
        media_topics:       mediaCount,
        features:           v.features           || {},
        client_min_version: v.client_min_version || "",
        last_updated_at:    v.last_updated_at    || "",
        storage_version:    rows[0].version      || "",
        storage_updated_ms: rows[0].updateTime ? rows[0].updateTime * 1000 : 0,
        storage_updated_at: rows[0].updateTime ? isoOf(rows[0].updateTime * 1000) : ""
      };
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[QvRemoteConfig/admin_stats/config] " + msg);
      return { present: false, _error: msg };
    }
  }

  function readCacheHealth(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    now:    number
  ): { topics: { [k: string]: any }; phase: string; summary: any } {

    var topics: { [k: string]: any } = {};
    var phase          = "not_yet_deployed";
    var anyFound       = false;
    var totalQuestions = 0;
    var healthyCount   = 0;
    var staleCount     = 0;
    var missingCount   = 0;

    var probe: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < KNOWN_TOPICS.length; i++) {
      probe.push({ collection: COL_CACHE_PREFIX + KNOWN_TOPICS[i], key: "pool_0", userId: "" });
    }

    try {
      var rows = nk.storageRead(probe);

      var byCol: { [col: string]: any } = {};
      if (rows) {
        for (var ri = 0; ri < rows.length; ri++) {
          var r = rows[ri];
          if (r && r.value) byCol[r.collection] = r;
        }
      }

      for (var ti = 0; ti < KNOWN_TOPICS.length; ti++) {
        var topic = KNOWN_TOPICS[ti];
        var row   = byCol[COL_CACHE_PREFIX + topic];

        if (!row || !row.value) {
          topics[topic] = { present: false };
          missingCount++;
          continue;
        }

        anyFound = true;
        var v: any            = row.value;
        var expiresMs: number = v.expires_at_ms || 0;
        var cachedMs: number  = v.cached_at_ms  || (row.updateTime ? row.updateTime * 1000 : 0);
        var ageMs             = cachedMs > 0 ? now - cachedMs : -1;
        var isExpired         = expiresMs > 0 && expiresMs < now;
        var isNearExpiry      = !isExpired && expiresMs > 0 && (expiresMs - now) < STALE_WARNING_MS;
        var isStale           = isExpired || isNearExpiry;
        var qCount            = v.question_count || (v.questions ? v.questions.length : 0);
        totalQuestions       += qCount;

        var qg: any   = v.quality_gate || {};
        var passRate  = (qg.total_processed && qg.total_processed > 0)
          ? Math.round((qg.passed / qg.total_processed) * 1000) / 10
          : null;

        topics[topic] = {
          present:         true,
          question_count:  qCount,
          page_count:      v.page_count || 1,
          cached_at_ms:    cachedMs,
          cached_at:       cachedMs > 0 ? isoOf(cachedMs) : "",
          expires_at_ms:   expiresMs,
          expires_at:      expiresMs > 0 ? isoOf(expiresMs) : "",
          age_seconds:     ageMs > 0 ? Math.floor(ageMs / 1000) : -1,
          stale:           isStale,
          stale_reason:    isExpired ? "expired" : isNearExpiry ? "near_expiry" : null,
          providers_used:  v.providers_used  || [],
          lang_breakdown:  v.lang_breakdown  || {},
          quality_gate: {
            total_processed:   qg.total_processed    || 0,
            passed:            qg.passed             || 0,
            rejected:          qg.rejected           || 0,
            pass_rate_pct:     passRate,
            top_reject_reason: qg.top_reject_reason  || null
          }
        };

        if (isStale) staleCount++;
        else         healthyCount++;
      }

      phase = anyFound ? "deployed" : "not_yet_deployed";

    } catch (err: any) {
      logger.warn("[QvRemoteConfig/admin_stats/cache] " + (err && err.message ? err.message : String(err)));
      phase = "read_error";
    }

    return {
      topics:  topics,
      phase:   phase,
      summary: {
        total_topics:    KNOWN_TOPICS.length,
        healthy:         healthyCount,
        stale:           staleCount,
        missing:         missingCount,
        total_questions: totalQuestions
      }
    };
  }

  function readCircuitBreakers(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    now:    number
  ): { providers: { [k: string]: any }; phase: string; summary: any } {

    var providers: { [k: string]: any } = {};
    var phase         = "not_yet_deployed";
    var openCount     = 0;
    var halfOpenCount = 0;
    var closedCount   = 0;
    var noDataCount   = 0;
    var anyFound      = false;

    var probe: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < KNOWN_PROVIDERS.length; i++) {
      probe.push({ collection: COL_CIRCUIT_BREAKER, key: KNOWN_PROVIDERS[i], userId: "" });
    }

    try {
      var rows = nk.storageRead(probe);

      var byKey: { [k: string]: any } = {};
      if (rows) {
        for (var ri = 0; ri < rows.length; ri++) {
          var r = rows[ri];
          if (r && r.value) byKey[r.key] = r.value;
        }
      }

      for (var pi = 0; pi < KNOWN_PROVIDERS.length; pi++) {
        var provider = KNOWN_PROVIDERS[pi];
        var v: any   = byKey[provider];

        if (!v) {
          providers[provider] = { state: "no_data", phase: "not_yet_deployed" };
          noDataCount++;
          continue;
        }

        anyFound = true;
        var state: string       = v.state || "unknown";
        var openUntilMs: number = v.open_until_ms || 0;

        // Reconcile stale "open" doc: if open_until has already passed, the
        // circuit is effectively half_open (probe on next cache refresh).
        if (state === "open" && openUntilMs > 0 && openUntilMs <= now) state = "half_open";

        if (state === "open")           openCount++;
        else if (state === "half_open") halfOpenCount++;
        else if (state === "closed")    closedCount++;

        providers[provider] = {
          state:             state,
          fail_count:        v.fail_count          || 0,
          success_count:     v.success_count        || 0,
          trip_count:        v.trip_count           || 0,
          open_until_ms:     openUntilMs,
          open_until:        openUntilMs > 0 ? isoOf(openUntilMs) : null,
          resets_in_seconds: (state === "open" && openUntilMs > now)
                               ? Math.ceil((openUntilMs - now) / 1000) : null,
          last_failed_at:    v.last_failed_at_ms    ? isoOf(v.last_failed_at_ms)    : null,
          last_opened_at:    v.last_opened_at_ms    ? isoOf(v.last_opened_at_ms)    : null,
          last_succeeded_at: v.last_succeeded_at_ms ? isoOf(v.last_succeeded_at_ms) : null
        };
      }

      phase = anyFound ? "deployed" : "not_yet_deployed";

    } catch (err: any) {
      logger.warn("[QvRemoteConfig/admin_stats/circuits] " + (err && err.message ? err.message : String(err)));
      phase = "read_error";
    }

    return {
      providers: providers,
      phase:     phase,
      summary: {
        total_providers: KNOWN_PROVIDERS.length,
        closed:          closedCount,
        open:            openCount,
        half_open:       halfOpenCount,
        no_data:         noDataCount
      }
    };
  }

  function readPackStats(nk: nkruntime.Nakama, logger: nkruntime.Logger): any {
    try {
      var rows = nk.storageRead([{ collection: COL_STATS, key: KEY_GLOBAL, userId: "" }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        return {
          phase: "not_yet_deployed",
          note:  "qv_stats/global not yet written. Deploy submit_result.ts (Phase 1b) to populate."
        };
      }
      var v: any = rows[0].value;
      return {
        phase:                 "deployed",
        total_packs_issued:    v.total_packs_issued    || 0,
        total_packs_submitted: v.total_packs_submitted || 0,
        total_packs_expired:   v.total_packs_expired   || 0,
        active_packs:          v.active_packs           || 0,
        daily_issued:          v.daily_issued           || 0,
        daily_submitted:       v.daily_submitted        || 0,
        last_updated_ms:       v.last_updated_ms        || 0,
        last_updated_at:       v.last_updated_ms ? isoOf(v.last_updated_ms) : "",
        inflight: v.inflight ? {
          total_active:        v.inflight.total_active        || 0,
          avg_per_active_user: v.inflight.avg_per_active_user || 0,
          max_per_user_limit:  v.inflight.max_per_user_limit  || 3
        } : { phase: "not_yet_deployed" }
      };
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.warn("[QvRemoteConfig/admin_stats/packs] " + msg);
      return { phase: "read_error", _error: msg };
    }
  }

  // Traffic-light status — only escalates, never downgrades.
  function buildSummary(
    configOk: boolean,
    cache:    { summary: any; phase: string },
    circuits: { summary: any; phase: string },
    packPhase: string
  ): any {
    var status = "healthy";

    // Config missing → degraded (defaults work but no admin customisation).
    if (!configOk) status = "degraded";

    // Cache — read_error also counts as degraded (can't confirm health).
    if (cache.phase === "read_error") {
      if (status !== "critical") status = "degraded";
    } else if (cache.phase === "deployed") {
      var cs    = cache.summary || {};
      var total = (cs.total_topics && cs.total_topics > 0) ? cs.total_topics : 1;
      var bad   = ((cs.stale || 0) + (cs.missing || 0)) / total;
      if (bad > 0.5)                              status = "critical";
      else if (bad > 0.2 && status !== "critical") status = "degraded";
    }

    // Circuits — read_error = degraded; open circuit = critical.
    if (circuits.phase === "read_error") {
      if (status !== "critical") status = "degraded";
    } else if (circuits.phase === "deployed") {
      var cbs = circuits.summary || {};
      if ((cbs.open || 0) > 0)                                    status = "critical";
      else if ((cbs.half_open || 0) > 0 && status !== "critical") status = "degraded";
    }

    var cs2  = cache.summary    || {};
    var cbs2 = circuits.summary || {};
    return {
      overall_status:         status,
      config_present:         configOk,
      cache_phase:            cache.phase,
      circuit_phase:          circuits.phase,
      pack_phase:             packPhase,
      total_cached_questions: cs2.total_questions || 0,
      healthy_topics:         cs2.healthy         || 0,
      stale_topics:           cs2.stale           || 0,
      missing_topics:         cs2.missing         || 0,
      open_circuits:          cbs2.open           || 0,
      half_open_circuits:     cbs2.half_open      || 0
    };
  }

  function rpcAdminStats(
    ctx:      nkruntime.Context,
    logger:   nkruntime.Logger,
    nk:       nkruntime.Nakama,
    _payload: string
  ): string {
    requireAdmin(ctx);

    var now           = nowMs();
    var configHealth  = readConfigHealth(nk, logger);
    var cacheHealth   = readCacheHealth(nk, logger, now);
    var circuitHealth = readCircuitBreakers(nk, logger, now);
    var packStats     = readPackStats(nk, logger);
    var summary       = buildSummary(
      !!(configHealth.present),
      cacheHealth,
      circuitHealth,
      packStats.phase || "unknown"
    );

    return JSON.stringify({
      ok: true,
      stats: {
        generated_at_ms:  now,
        generated_at:     isoOf(now),
        summary:          summary,
        config:           configHealth,
        cache:            cacheHealth,
        circuit_breakers: circuitHealth,
        pack_stats:       packStats
      }
    });
  }

  // ── Registration ──────────────────────────────────────────────────────────
  // Single-arg register() so postbuild.js autoInvokeRegister replays it on
  // every pooled Goja VM (not just the InitModule VM). RPC id strings MUST be
  // literals here — the AST walker cannot resolve namespaced variable references.
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_get_config",  rpcGetConfig);
    initializer.registerRpc("quizverse_admin_stats", rpcAdminStats);
  }

  // IIFE NOOP — populates __rpc_quizverse_get_config and
  // __rpc_quizverse_admin_stats on every VM at module-load time so pooled
  // VMs (which never run InitModule) can resolve the handlers.
  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
