// question_cache.ts — QuizVerse question-delivery cache layer.
//
// NO RPCS IN THIS FILE — utility namespace only.
// Called by get_questions.ts (Phase 1b) and by a background cron refresh.
// NEVER called inline on a live player request.
//
// ── Pipeline (runs once per topic per TTL, NOT per player request) ────────────
//
//   fetchForTopic()   fetch raw data from external provider API
//       ↓
//   validateAndDecodeRaw()   HTML-decode + 6 QvQualityGate checks in-place
//       ↓
//   shuffleAndAssign()   Fisher-Yates shuffle → assign A/B/C/D letter IDs
//       ↓
//   enrichExplanation()   fill empty explanations from structured metadata
//       ↓
//   writeCache()   write qv_cache_{topic}/pool_0 … pool_N (max 100 q/doc)
//
// ── Public API ────────────────────────────────────────────────────────────────
//
//   QvQuestionCache.refreshCache(nk, logger, env, topic)
//     Full pipeline — fetch → validate → enrich → shuffle → store.
//     Returns { ok, topic, count, error? }.
//
//   QvQuestionCache.readCache(nk, logger, topic)
//     Read all pages from storage, return merged pool + metadata.
//
//   QvQuestionCache.isCacheValid(nk, topic)
//     Lightweight check of pool_0 expiry — does NOT load questions.
//
// ── Circuit breaker ───────────────────────────────────────────────────────────
//   Opens after FAIL_THRESHOLD consecutive failures. Cooldown = CIRCUIT_COOLDOWN.
//   State stored in qv_circuit_breakers/{provider} (system-owned, no-write).
//   readCache falls back to stale pool when the circuit is open.
//
  // ── Providers ─────────────────────────────────────────────────────────────────
  //   No-auth (always available): OpenTDB, Jikan, PokeAPI, CocktailDB, MealDB,
  //     Dog CEO, Disney, Ghibli, SWAPI
  //   Key-gated (env var required): RestCountries (v5), NASA, TMDB, TheSportsDB,
  //     Last.fm, GNews/Currents/MediaStack/NewsAPI
//   S3-based (env S3_BASE_URL): daily, weekly
//
// ── postbuild note ────────────────────────────────────────────────────────────
//   No registerRpc() calls in this file — postbuild will not extract any RPC
//   stubs. This is correct and expected for a utility-only namespace.

namespace QvQuestionCache {

  // ── Constants ──────────────────────────────────────────────────────────────
  var MAX_PER_DOC      = 100;  // questions per storage page
  var FAIL_THRESHOLD   = 3;    // consecutive failures → open circuit
  var CIRCUIT_COOLDOWN = 5 * 60 * 1000;  // 5 min open cooldown (ms)

  var COL_CACHE        = "qv_cache_";        // full key: qv_cache_{topic}
  var COL_CIRCUIT      = "qv_circuit_breakers";
  var COL_REFRESH_GATE = "qv_cache_refresh_gate";
  var REFRESH_GATE_MS  = 30 * 1000;          // dedupe concurrent / back-to-back refreshes

  // Per-topic cache TTL (ms)
  var TOPIC_TTL: { [t: string]: number } = {
    opentdb:     1  * 3600000,
    speed_quiz:  1  * 3600000,
    true_false:  1  * 3600000,
    movies:    2  * 3600000,
    music:     2  * 3600000,
    sports:    2  * 3600000,
    news:      6  * 3600000,
    space:     6  * 3600000,
    food:      12 * 3600000,
    cocktail:  12 * 3600000,
    anime:     24 * 3600000,
    dog:       24 * 3600000,
    disney:    24 * 3600000,
    pokemon:   72 * 3600000,
    ghibli:    72 * 3600000,
    starwars:  72 * 3600000,
    countries: 7  * 24 * 3600000,
    flags:     7  * 24 * 3600000,
    daily:       24 * 3600000,
    weekly:      7  * 24 * 3600000,
    video_quiz:  7  * 24 * 3600000,
    ai:          0   // never cached
  };

  var COL_VIDEO_CATALOG = "qv_catalog_video_quiz";

  // ── Hardcoded fallback API keys ───────────────────────────────────────────
  //
  // These are the LAST-RESORT fallbacks used when a key is not present in
  // ctx.env (i.e. not injected via Kubernetes / SSM Parameter Store).
  //
  // Priority:  ctx.env['KEY']  →  FALLBACK_KEYS.KEY  →  disabled
  //
  // HOW TO SET PERMANENTLY (preferred):
  //   1. Go to AWS Console → Systems Manager → Parameter Store
  //   2. Create /nakama/TMDB_API_KEY  (SecureString, your actual key)
  //   3. Push code → CodeBuild injects it automatically via buildspec.yml
  //
  // HOW TO USE THESE FALLBACKS (quick fix):
  //   Fill in your key below, push code, done.
  //   The fallback is only reached when the SSM/env key is absent.
  //
  // Get free keys:
  //   TMDB        → https://www.themoviedb.org/settings/api
  //   LASTFM      → https://www.last.fm/api/account/create
  //   GNEWS       → https://gnews.io  (100 req/day free)
  //   CURRENTS    → https://currentsapi.services/en/register  (1000/day)
  //   MEDIASTACK  → https://mediastack.com/signup/free  (500/month)
  //   NEWSAPI     → https://newsapi.org/register  (100/day)
  //   GUARDIAN    → https://open-platform.theguardian.com/access/  (free dev key; "test" works)
  //   SPACEFLIGHT → https://api.spaceflightnewsapi.net/v4/  (no key — open API, 100% images)
  //   NASA        → https://api.nasa.gov  (already defaults to DEMO_KEY)

  var FALLBACK_KEYS: { [k: string]: string } = {
    TMDB_API_KEY:       "93ca6d6373e2584a56bfe144bee48280",
    LASTFM_API_KEY:     "",   // ← paste your Last.fm key here
    GNEWS_API_KEY:      "996c2e560c01a91df9d4a9ddbef0e38e",
    CURRENTS_API_KEY:   "vJ7f8IPcf_vrhpwk2_-wqzVOpFCxHV26zMhKv4NPV_KiXb-r",
    MEDIASTACK_API_KEY: "ec6ef35b59624891e5604efb140adefb",
    NEWSAPI_API_KEY:    "5cbc52d4e9e14df683ed965b04cbf6fb",
    GUARDIAN_API_KEY:   "test",   // Guardian developer tier — replace with production key when ready
    NASA_API_KEY:       "g2ofGlzt9YRi0pt2xHhLjCygLWdi6536mEGezmr9"   // safe public fallback (50 req/day)
  };

  function envKey(env: any, key: string): string {
    if (env && env[key] && String(env[key]).trim()) return String(env[key]).trim();
    if (FALLBACK_KEYS[key] && String(FALLBACK_KEYS[key]).trim()) return String(FALLBACK_KEYS[key]).trim();
    return "";
  }


  // Option letter IDs
  var LETTERS = ["A", "B", "C", "D", "E", "F"];

  // ── Static wrong-answer pools (shared across providers) ────────────────────
  var ANIME_GENRES = [
    "Action", "Adventure", "Comedy", "Drama", "Fantasy", "Horror",
    "Mystery", "Romance", "Sci-Fi", "Slice of Life", "Sports",
    "Thriller", "Mecha", "Isekai", "Shounen", "Shoujo", "Seinen", "Josei"
  ];
  var POKEMON_TYPES = [
    "Normal", "Fire", "Water", "Electric", "Grass", "Ice",
    "Fighting", "Poison", "Ground", "Flying", "Psychic", "Bug",
    "Rock", "Ghost", "Dragon", "Dark", "Steel", "Fairy"
  ];
  var SPACE_OBJECTS = [
    "Black Hole", "Neutron Star", "Pulsar", "Nebula", "Galaxy",
    "Star Cluster", "Supernova Remnant", "Quasar", "White Dwarf",
    "Red Giant", "Brown Dwarf", "Asteroid Belt", "Comet", "Exoplanet"
  ];
  var COCKTAIL_CATS = [
    "Ordinary Drink", "Cocktail", "Shot", "Punch / Party Drink",
    "Homemade Liqueur", "Beer", "Soft Drink / Soda", "Other / Unknown"
  ];
  var MEAL_AREAS = [
    "British", "American", "Italian", "Mexican", "Japanese", "Chinese",
    "French", "Indian", "Moroccan", "Turkish", "Greek", "Thai", "Spanish",
    "Portuguese", "Canadian", "Jamaican", "Croatian", "Egyptian",
    "Filipino", "Malaysian", "Polish", "Russian", "Vietnamese"
  ];
  var SW_DIRECTORS = [
    "George Lucas", "Irvin Kershner", "Richard Marquand",
    "J.J. Abrams", "Rian Johnson", "Gareth Edwards", "Ron Howard"
  ];

  // ── Internal types ─────────────────────────────────────────────────────────
  //   (TypeScript-only, erased at compile time — no runtime overhead)

  interface RawOpt {
    text:       string;
    is_correct: boolean;
  }

  interface RawQuestion {
    provider_key:  string;
    topic:         string;
    lang:          string;
    question_text: string;
    question_type: string;    // single_select | multiple_select | true_false
    raw_options:   RawOpt[];
    has_media:     boolean;
    media:         any;       // null | { type, url, thumbnail_url, duration_seconds, mime_type }
    explanation:   string;
    difficulty:    string;    // easy | medium | hard
    provider:      string;
    meta:          any;       // topic-specific enrichment data
  }

  interface NormalizedQuestion {
    id:                 string;
    topic:              string;
    lang:               string;
    question_text:      string;
    question_type:      string;
    options:            Array<{ id: string; text: string }>;
    correct_option_ids: string[];
    has_media:          boolean;
    media:              any;
    explanation:        string;
    difficulty:         string;
    provider:           string;
  }


  // ── Low-level helpers ──────────────────────────────────────────────────────

  function nowMs(): number { return Date.now(); }

  function padTwo(n: number): string { return n < 10 ? "0" + String(n) : String(n); }

  // Busy-wait sleep — only safe in background cache-refresh jobs, never in player RPC paths.
  function sleep(ms: number): void {
    var end = nowMs() + ms;
    while (nowMs() < end) { /* spin */ }
  }

  // djb2 hash → base36 string — stable, collision-resistant for trivia text
  function djb2(s: string): string {
    var h = 5381;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h = h & h; // 32-bit truncation
    }
    return Math.abs(h).toString(36);
  }

  function stableId(topic: string, provider: string, key: string): string {
    return "ext_" + topic + "_" + djb2(provider + "|" + key);
  }

  function capitalize(s: string): string {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  // Fisher-Yates shuffle (returns a new array)
  function shuffle(arr: any[]): any[] {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Pick up to n random items from arr
  function pick(arr: any[], n: number): any[] {
    return shuffle(arr).slice(0, Math.min(n, arr.length));
  }

  // Pick up to n items from arr whose string value is NOT in the exclude set
  function pickExcluding(arr: string[], exclude: { [k: string]: boolean }, n: number): string[] {
    var pool: string[] = [];
    for (var i = 0; i < arr.length; i++) {
      if (!exclude[arr[i]]) pool.push(arr[i]);
    }
    return pick(pool, n);
  }

  function topicProvider(topic: string): string {
    var map: { [t: string]: string } = {
      opentdb: "opentdb", speed_quiz: "opentdb", true_false: "opentdb", anime: "jikan", pokemon: "pokeapi",
      cocktail: "cocktaildb", food: "themealdb", dog: "dogceo",
      ghibli: "ghibli", disney: "disney", starwars: "swapi",
      countries: "restcountries", flags: "restcountries",
      space: "nasa", movies: "tmdb", sports: "sportsdb",
      music: "lastfm", news: "gnews", daily: "s3", weekly: "s3",
      video_quiz: "catalog", ai: "claude"
    };
    return map[topic] || topic;
  }

  // ── HTTP helper ────────────────────────────────────────────────────────────

  // Max retries on HTTP 429; backoff doubles each attempt (1 s → 2 s → 4 s).
  var HTTP_MAX_RETRIES = 3;

  function httpGet(nk: nkruntime.Nakama, url: string, extraHeaders?: { [k: string]: string }): any {
    var headers: { [k: string]: string } = { "Accept": "application/json", "User-Agent": "QuizVerse/1.0" };
    if (extraHeaders) {
      for (var k in extraHeaders) {
        if (extraHeaders.hasOwnProperty(k)) headers[k] = extraHeaders[k];
      }
    }
    var backoffMs = 1000;
    for (var attempt = 0; attempt <= HTTP_MAX_RETRIES; attempt++) {
      if (attempt > 0) sleep(backoffMs);
      var resp = nk.httpRequest(url, "get", headers, null);
      if (!resp) throw new Error("no_response from " + url.substring(0, 80));
      if (resp.code === 429) {
        if (attempt === HTTP_MAX_RETRIES) {
          throw new Error("HTTP 429 rate-limited after " + HTTP_MAX_RETRIES + " retries: " + url.substring(0, 80));
        }
        backoffMs = backoffMs * 2;
        continue;
      }
      if (resp.code < 200 || resp.code >= 300) {
        throw new Error("HTTP " + resp.code + " from " + url.substring(0, 80));
      }
      return JSON.parse(resp.body);
    }
    throw new Error("httpGet exhausted retries for " + url.substring(0, 80));
  }

  // ── Circuit breaker ────────────────────────────────────────────────────────

  function readCircuit(nk: nkruntime.Nakama, provider: string): any {
    try {
      var rows = nk.storageRead([{ collection: COL_CIRCUIT, key: provider, userId: "00000000-0000-0000-0000-000000000000" }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (_e) {}
    return { state: "closed", fail_count: 0, success_count: 0, trip_count: 0, open_until_ms: 0 };
  }

  function writeCircuit(nk: nkruntime.Nakama, provider: string, doc: any): void {
    try {
      nk.storageWrite([{
        collection: COL_CIRCUIT, key: provider, userId: "00000000-0000-0000-0000-000000000000",
        value: doc, permissionRead: 1, permissionWrite: 0
      }]);
    } catch (_e) {}
  }

  function circuitIsOpen(nk: nkruntime.Nakama, provider: string): boolean {
    var c = readCircuit(nk, provider);
    if (c.state !== "open") return false;
    // Cooldown elapsed → treat as half_open (allow one probe)
    return !(c.open_until_ms && c.open_until_ms < nowMs());
  }

  function recordSuccess(nk: nkruntime.Nakama, provider: string): void {
    var c = readCircuit(nk, provider);
    writeCircuit(nk, provider, {
      state: "closed", fail_count: 0,
      success_count: (c.success_count || 0) + 1,
      trip_count: c.trip_count || 0, open_until_ms: 0,
      last_succeeded_at_ms: nowMs()
    });
  }

  function recordFailure(nk: nkruntime.Nakama, provider: string, errMsg: string): void {
    var c    = readCircuit(nk, provider);
    var fails = (c.fail_count || 0) + 1;
    var open  = fails >= FAIL_THRESHOLD;
    var now   = nowMs();
    writeCircuit(nk, provider, {
      state:             open ? "open" : (c.state || "closed"),
      fail_count:        fails,
      success_count:     c.success_count || 0,
      trip_count:        open ? (c.trip_count || 0) + 1 : (c.trip_count || 0),
      open_until_ms:     open ? now + CIRCUIT_COOLDOWN : (c.open_until_ms || 0),
      last_failed_at_ms: now,
      last_opened_at_ms: open ? now : (c.last_opened_at_ms || 0),
      last_error:        errMsg.substring(0, 200)
    });
  }

  // ── Quality gate bridge ────────────────────────────────────────────────────
  // RawQuestion.raw_options uses {text, is_correct} shape.
  // QvQualityGate.validateQuestion() expects {options:[{id,text}], correct_option_ids}.
  // We convert to a bridge object, validate (which HTML-decodes in-place on the bridge),
  // then write the decoded text back to the original raw question.
  // This avoids a double-decode pass and keeps the gate's mutation semantics intact.

  function validateAndDecodeRaw(
    raw:      RawQuestion,
    seenSet:  { [key: string]: boolean }
  ): { valid: boolean; reject_reason: string | null } {

    // Build bridge
    var bridgeOpts: Array<{ id: string; text: string }> = [];
    var correctIds: string[] = [];
    for (var i = 0; i < raw.raw_options.length; i++) {
      var oid = "o" + i;
      bridgeOpts.push({ id: oid, text: raw.raw_options[i].text });
      if (raw.raw_options[i].is_correct) correctIds.push(oid);
    }
    var bridge: any = {
      question_text:      raw.question_text,
      options:            bridgeOpts,
      correct_option_ids: correctIds,
      has_media:          raw.has_media,
      provider_key:       raw.provider_key,
      media:              raw.media
    };

    // Run gate (mutates bridge.question_text and bridge.options[].text)
    var result = QvQualityGate.validateQuestion(bridge, seenSet);

    if (result.valid) {
      // Write HTML-decoded text back to the raw question in-place
      raw.question_text = bridge.question_text;
      for (var oi = 0; oi < raw.raw_options.length && oi < bridgeOpts.length; oi++) {
        raw.raw_options[oi].text = bridgeOpts[oi].text;
      }
      if (raw.explanation) {
        raw.explanation = QvQualityGate.htmlDecode(raw.explanation);
      }
    }

    return result;
  }

  // ── Shuffle + A/B/C/D assignment ───────────────────────────────────────────

  function shuffleAndAssign(raw: RawQuestion): NormalizedQuestion {
    var shuffled = shuffle(raw.raw_options);
    var options: Array<{ id: string; text: string }> = [];
    var correctIds: string[] = [];
    for (var i = 0; i < shuffled.length && i < LETTERS.length; i++) {
      options.push({ id: LETTERS[i], text: shuffled[i].text });
      if (shuffled[i].is_correct) correctIds.push(LETTERS[i]);
    }
    return {
      id:                 stableId(raw.topic, raw.provider, raw.provider_key),
      topic:              raw.topic,
      lang:               raw.lang,
      question_text:      raw.question_text,
      question_type:      raw.question_type,
      options:            options,
      correct_option_ids: correctIds,
      has_media:          raw.has_media,
      media:              raw.media,
      explanation:        raw.explanation,
      difficulty:         raw.difficulty,
      provider:           raw.provider
    };
  }

  // ── Explanation enrichment ─────────────────────────────────────────────────
  // Fills empty explanations from structured metadata. Called AFTER shuffleAndAssign
  // because meta is carried on the RawQuestion and passed in separately.

  function enrichExplanation(q: NormalizedQuestion, meta: any): string {
    if (q.explanation && q.explanation.trim().length > 8) return q.explanation;
    var m = meta || {};
    switch (q.topic) {
      case "anime":
        if (m.title && m.year) return "\"" + m.title + "\" first aired in " + m.year + ".";
        if (m.title)           return "From the anime series \"" + m.title + "\".";
        break;
      case "pokemon":
        if (m.types && m.name) return capitalize(m.name) + " is a " + (m.types as string[]).join("/") + "-type Pokémon.";
        break;
      case "countries":
      case "flags":
        if (m.capital && m.region) return (m.name || "") + " is in " + m.region + "; capital: " + m.capital + ".";
        break;
      case "movies":
        if (m.title && m.year) return "\"" + m.title + "\" was released in " + m.year + ".";
        break;
      case "ghibli":
        if (m.title && m.director) return "\"" + m.title + "\" was directed by " + m.director + " (Studio Ghibli).";
        break;
      case "starwars":
        if (m.title && m.year) return "\"" + m.title + "\" was released in " + m.year + ".";
        break;
      case "cocktail":
        if (m.name) return "The " + m.name + " is a classic cocktail.";
        break;
      case "food":
        if (m.name && m.area) return "\"" + m.name + "\" is a traditional " + m.area + " dish.";
        break;
      case "dog":
        if (m.breed) return "This is a " + m.breed + ".";
        break;
      case "disney":
        if (m.name && m.source) return m.name + " is a Disney character from \"" + m.source + "\".";
        break;
      case "space":
        if (m.title) return "NASA APOD: " + m.title + ".";
        break;
    }
    return "";
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PROVIDERS
  // Each fetch function returns RawQuestion[] — pre-shuffle, unvalidated.
  // Quality gate + shuffle happen in refreshCache().
  // ══════════════════════════════════════════════════════════════════════════

  // ── 1. OpenTDB ────────────────────────────────────────────────────────────

  function fetchOpenTdbCategory(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    categoryId: number,
    amount: number,
    topicSlug: string,
    subtopic: string
  ): RawQuestion[] {
    var results: RawQuestion[] = [];
    // url3986 encoding — decode with decodeURIComponent
    var url = "https://opentdb.com/api.php?amount=" + amount + "&category=" + categoryId + "&type=multiple";
    var data = httpGet(nk, url);
    if (!data || !Array.isArray(data.results) || data.response_code !== 0) {
      throw new Error("OpenTDB response_code=" + (data && data.response_code) + " category=" + categoryId);
    }
    for (var i = 0; i < data.results.length; i++) {
      var item: any = data.results[i];
      try {
        if (item.type !== "multiple") continue;
        var qText = decodeURIComponent(item.question || "");
        var correct = decodeURIComponent(item.correct_answer || "");
        var wrongs: string[] = [];
        if (Array.isArray(item.incorrect_answers)) {
          for (var w = 0; w < item.incorrect_answers.length; w++) {
            var wt = decodeURIComponent(item.incorrect_answers[w] || "");
            if (wt) wrongs.push(wt);
          }
        }
        if (!qText || !correct) continue;
        var opts: RawOpt[] = [{ text: correct, is_correct: true }];
        for (var wi = 0; wi < wrongs.length; wi++) opts.push({ text: wrongs[wi], is_correct: false });
        var diff = item.difficulty === "hard" ? "hard" : item.difficulty === "easy" ? "easy" : "medium";
        var meta: any = {};
        if (subtopic) meta.subtopic = subtopic;
        results.push({
          provider_key:  djb2(qText),
          topic:         topicSlug,
          lang:          "en",
          question_text: qText,
          question_type: "single_select",
          raw_options:   opts,
          has_media:     false,
          media:         null,
          explanation:   decodeURIComponent(item.category || ""),
          difficulty:    diff,
          provider:      "opentdb",
          meta:          meta
        });
      } catch (e: any) { logger.debug("[QvQCache/opentdb] skip[" + i + "] cat=" + categoryId + ": " + (e && e.message)); }
    }
    return results;
  }

  function fetchOpenTdbBoolean(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    categoryId: number,
    amount: number,
    topicSlug: string,
    subtopic: string
  ): RawQuestion[] {
    var results: RawQuestion[] = [];
    var url = "https://opentdb.com/api.php?amount=" + amount + "&category=" + categoryId + "&type=boolean";
    var data = httpGet(nk, url);
    if (!data || !Array.isArray(data.results) || data.response_code !== 0) {
      throw new Error("OpenTDB boolean response_code=" + (data && data.response_code) + " category=" + categoryId);
    }
    for (var i = 0; i < data.results.length; i++) {
      var item: any = data.results[i];
      try {
        if (item.type !== "boolean") continue;
        var qText = decodeURIComponent(item.question || "");
        var correct = decodeURIComponent(item.correct_answer || "");
        var wrong = "";
        if (Array.isArray(item.incorrect_answers) && item.incorrect_answers.length > 0) {
          wrong = decodeURIComponent(item.incorrect_answers[0] || "");
        }
        if (!qText || !correct || !wrong) continue;
        var opts: RawOpt[] = [
          { text: correct, is_correct: true },
          { text: wrong,    is_correct: false }
        ];
        var diff = item.difficulty === "hard" ? "hard" : item.difficulty === "easy" ? "easy" : "medium";
        var meta: any = {};
        if (subtopic) meta.subtopic = subtopic;
        results.push({
          provider_key:  djb2(qText),
          topic:         topicSlug,
          lang:          "en",
          question_text: qText,
          question_type: "true_false",
          raw_options:   opts,
          has_media:     false,
          media:         null,
          explanation:   decodeURIComponent(item.category || ""),
          difficulty:    diff,
          provider:      "opentdb",
          meta:          meta
        });
      } catch (e: any) { logger.debug("[QvQCache/opentdb-boolean] skip[" + i + "] cat=" + categoryId + ": " + (e && e.message)); }
    }
    return results;
  }

  function fetchGeoQuiz(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    return fetchOpenTdbCategory(nk, logger, 22, 50, "opentdb", "");
  }

  var SPEED_QUIZ_CATEGORY_POOL: { id: number; key: string; label: string }[] = [
    { id: 17, key: "science_nature",      label: "Science & Nature" },
    { id: 18, key: "science_computers",   label: "Science: Computers" },
    { id: 19, key: "science_mathematics", label: "Science: Mathematics" },
    { id: 20, key: "mythology",           label: "Mythology" },
    { id: 15, key: "video_games",         label: "Video Games" },
    { id: 27, key: "animals",             label: "Animals" },
    { id: 9,  key: "general_knowledge",   label: "General Knowledge" }
  ];

  function fetchSpeedQuiz(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var picked = pick(SPEED_QUIZ_CATEGORY_POOL, 3);
    var perCat = Math.ceil(50 / picked.length);
    var results: RawQuestion[] = [];
    var pickedIds: number[] = [];
    var pickedKeys: string[] = [];
    for (var p = 0; p < picked.length; p++) {
      var cat = picked[p];
      pickedIds.push(cat.id);
      pickedKeys.push(cat.key);
      try {
        var batch = fetchOpenTdbCategory(nk, logger, cat.id, perCat, "speed_quiz", cat.key);
        for (var b = 0; b < batch.length; b++) results.push(batch[b]);
      } catch (e: any) {
        logger.warn("[QvQCache/speed_quiz] category " + cat.id + " failed: " + (e && e.message));
      }
    }
    logger.info(
      "[QvQCache/speed_quiz] event=speed_quiz_fetch categories=" + pickedIds.join(",") +
      " keys=" + pickedKeys.join(",") + " per_cat=" + perCat + " count=" + results.length
    );
    if (results.length === 0) {
      throw new Error("speed_quiz: all OpenTDB category fetches failed or returned 0 questions");
    }
    return results;
  }

  var TRUE_FALSE_CATEGORY_POOL: { id: number; key: string; label: string }[] = [
    { id: 23, key: "history",           label: "History" },
    { id: 9,  key: "general_knowledge", label: "General Knowledge" },
    { id: 17, key: "science_nature",    label: "Science & Nature" },
    { id: 21, key: "sports",            label: "Sports" },
    { id: 22, key: "geography",         label: "Geography" },
    { id: 27, key: "animals",           label: "Animals" },
    { id: 10, key: "books",             label: "Books" },
    { id: 11, key: "film",              label: "Film" },
    { id: 12, key: "music",             label: "Music" },
    { id: 14, key: "television",        label: "Television" }
  ];

  function fetchTrueFalseQuiz(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var picked = pick(TRUE_FALSE_CATEGORY_POOL, 3);
    var perCat = Math.ceil(50 / picked.length);
    var results: RawQuestion[] = [];
    var pickedIds: number[] = [];
    var pickedKeys: string[] = [];
    for (var p = 0; p < picked.length; p++) {
      var cat = picked[p];
      pickedIds.push(cat.id);
      pickedKeys.push(cat.key);
      try {
        var batch = fetchOpenTdbBoolean(nk, logger, cat.id, perCat, "true_false", cat.key);
        for (var b = 0; b < batch.length; b++) results.push(batch[b]);
      } catch (e: any) {
        logger.warn("[QvQCache/true_false] category " + cat.id + " failed: " + (e && e.message));
      }
    }
    logger.info(
      "[QvQCache/true_false] event=true_false_fetch categories=" + pickedIds.join(",") +
      " keys=" + pickedKeys.join(",") + " per_cat=" + perCat + " count=" + results.length
    );
    if (results.length === 0) {
      throw new Error("true_false: all OpenTDB boolean category fetches failed or returned 0 questions");
    }
    return results;
  }

  // ── 2. Jikan (Anime) ──────────────────────────────────────────────────────
  function fetchJikan(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data = httpGet(nk, "https://api.jikan.moe/v4/top/anime?page=1&limit=25&filter=bypopularity");
    if (!data || !Array.isArray(data.data)) throw new Error("Jikan: no data array");

    var animeList: any[] = data.data;
    // Collect all genres from results for wrong-answer pool
    var genreSet: { [g: string]: boolean } = {};
    for (var ag = 0; ag < animeList.length; ag++) {
      var gens: any[] = animeList[ag].genres || [];
      for (var gi2 = 0; gi2 < gens.length; gi2++) genreSet[gens[gi2].name] = true;
    }
    var allGenres: string[] = Object.keys(genreSet).length >= 6 ? Object.keys(genreSet) : ANIME_GENRES;

    for (var ai = 0; ai < animeList.length; ai++) {
      var a: any = animeList[ai];
      try {
        var title = a.title_english || a.title || "Unknown";
        var year = a.year
          || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year)
          || null;
        var episodes = a.episodes || null;
        var genres: string[] = [];
        var agenres: any[] = a.genres || [];
        for (var gi3 = 0; gi3 < agenres.length; gi3++) genres.push(agenres[gi3].name);
        var imageUrl: string | null = (a.images && a.images.jpg && a.images.jpg.image_url)
          ? a.images.jpg.image_url : null;

        var media: any = imageUrl ? { type: "image", url: imageUrl, thumbnail_url: null, duration_seconds: null, mime_type: "image/jpeg" } : null;
        var tpl = Math.floor(Math.random() * 3);
        var q: RawQuestion | null = null;

        if (tpl === 0 && genres.length > 0) {
          // Genre template
          var correctGenre = genres[0];
          var exSet: { [k: string]: boolean } = {};
          for (var gx = 0; gx < genres.length; gx++) exSet[genres[gx]] = true;
          var wg = pickExcluding(allGenres, exSet, 3);
          if (wg.length < 3) tpl = 2; // fall through to year
          else {
            var gOpts: RawOpt[] = [{ text: correctGenre, is_correct: true }];
            for (var wgi = 0; wgi < wg.length; wgi++) gOpts.push({ text: wg[wgi], is_correct: false });
            q = {
              provider_key: "jikan_genre_" + (a.mal_id || ai),
              topic: "anime", lang: "en",
              question_text: "What genre best describes the anime \"" + title + "\"?",
              question_type: "single_select",
              raw_options: gOpts, has_media: !!imageUrl, media: media,
              explanation: "\"" + title + "\" belongs to the " + genres.join(", ") + " genre(s).",
              difficulty: "medium", provider: "jikan",
              meta: { title: title, year: year, genres: genres }
            };
          }
        }
        if (tpl === 1 && episodes) {
          // Episode count template
          var ep = episodes;
          var eOpts: RawOpt[] = [
            { text: String(ep), is_correct: true },
            { text: String(Math.max(1, ep - Math.floor(Math.random() * 8) - 3)), is_correct: false },
            { text: String(ep + Math.floor(Math.random() * 10) + 2), is_correct: false },
            { text: String(ep + Math.floor(Math.random() * 20) + 14), is_correct: false }
          ];
          q = {
            provider_key: "jikan_ep_" + (a.mal_id || ai),
            topic: "anime", lang: "en",
            question_text: "How many episodes does \"" + title + "\" have?",
            question_type: "single_select",
            raw_options: eOpts, has_media: !!imageUrl, media: media,
            explanation: "\"" + title + "\" has " + ep + " episodes.",
            difficulty: "hard", provider: "jikan",
            meta: { title: title, year: year }
          };
        }
        if ((tpl === 2 || !q) && year) {
          // Release year template
          var yr = Number(year);
          if (isNaN(yr)) { q = null; } else {
            var yOpts: RawOpt[] = [
              { text: String(yr),     is_correct: true },
              { text: String(yr - 2), is_correct: false },
              { text: String(yr + 1), is_correct: false },
              { text: String(yr - 5), is_correct: false }
            ];
            q = {
              provider_key: "jikan_year_" + (a.mal_id || ai),
              topic: "anime", lang: "en",
              question_text: "In what year did \"" + title + "\" first air?",
              question_type: "single_select",
              raw_options: yOpts, has_media: !!imageUrl, media: media,
              explanation: "\"" + title + "\" first aired in " + yr + ".",
              difficulty: "medium", provider: "jikan",
              meta: { title: title, year: year }
            };
          }
        }
        if (q) results.push(q);
      } catch (e: any) { logger.debug("[QvQCache/jikan] skip[" + ai + "]: " + (e && e.message)); }
    }
    return results;
  }

  // ── 3. PokeAPI ────────────────────────────────────────────────────────────
  function fetchPokeapi(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var listData = httpGet(nk, "https://pokeapi.co/api/v2/pokemon?limit=151&offset=0");
    if (!listData || !Array.isArray(listData.results)) throw new Error("PokeAPI: no list");
    var sample: any[] = pick(listData.results, 40);

    for (var pi = 0; pi < sample.length; pi++) {
      try {
        var detail: any = httpGet(nk, sample[pi].url);
        if (!detail) continue;
        var pokeName = capitalize(detail.name || "Unknown");
        var types: string[] = [];
        var ptypes: any[] = detail.types || [];
        for (var ti = 0; ti < ptypes.length; ti++) types.push(capitalize(ptypes[ti].type.name));
        if (types.length === 0) continue;
        var sprite: string | null = (detail.sprites && detail.sprites.front_default) ? detail.sprites.front_default : null;
        var correctType = types[0];
        var exSet2: { [k: string]: boolean } = {};
        for (var tx = 0; tx < types.length; tx++) exSet2[types[tx]] = true;
        var wt = pickExcluding(POKEMON_TYPES, exSet2, 3);
        if (wt.length < 3) continue;
        var pOpts: RawOpt[] = [{ text: correctType, is_correct: true }];
        for (var wi2 = 0; wi2 < wt.length; wi2++) pOpts.push({ text: wt[wi2], is_correct: false });
        results.push({
          provider_key: "pokeapi_type_" + detail.id,
          topic: "pokemon", lang: "en",
          question_text: "What primary type is the Pokémon " + pokeName + "?",
          question_type: "single_select",
          raw_options: pOpts,
          has_media: !!sprite,
          media: sprite ? { type: "image", url: sprite, thumbnail_url: null, duration_seconds: null, mime_type: "image/png" } : null,
          explanation: pokeName + " is a " + types.join("/") + "-type Pokémon.",
          difficulty: "easy", provider: "pokeapi",
          meta: { name: detail.name, types: types }
        });
      } catch (e: any) { logger.debug("[QvQCache/pokeapi] skip[" + pi + "]: " + (e && e.message)); }
    }
    return results;
  }

  // ── 4. TheCocktailDB ──────────────────────────────────────────────────────
  function fetchCocktaildb(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var seen: { [n: string]: boolean } = {};
    for (var ci = 0; ci < 40; ci++) {
      try {
        var data: any = httpGet(nk, "https://www.thecocktaildb.com/api/json/v1/1/random.php");
        if (!data || !data.drinks || !data.drinks[0]) continue;
        var d: any = data.drinks[0];
        var name = d.strDrink || "Unknown";
        if (seen[name]) continue;
        seen[name] = true;
        var category = d.strCategory || "Cocktail";
        var glass = d.strGlass || "Glass";
        var alcoholic = d.strAlcoholic || "";
        var img: string | null = d.strDrinkThumb || null;
        var wc = COCKTAIL_CATS.filter(function(c) { return c !== category; });
        var wca = pick(wc, 3);
        if (wca.length < 3) continue;
        var cOpts: RawOpt[] = [{ text: category, is_correct: true }];
        for (var wci = 0; wci < wca.length; wci++) cOpts.push({ text: wca[wci] as string, is_correct: false });
        results.push({
          provider_key: "cocktaildb_" + (d.idDrink || djb2(name)),
          topic: "cocktail", lang: "en",
          question_text: "What category of drink is a \"" + name + "\"?",
          question_type: "single_select",
          raw_options: cOpts,
          has_media: !!img,
          media: img ? { type: "image", url: img, thumbnail_url: null, duration_seconds: null, mime_type: "image/jpeg" } : null,
          explanation: "The " + name + " is a " + category + (alcoholic ? " (" + alcoholic + ")" : "") + ", typically served in a " + glass + ".",
          difficulty: "medium", provider: "cocktaildb",
          meta: { name: name }
        });
      } catch (e: any) { logger.debug("[QvQCache/cocktaildb] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 5. TheMealDB (Food) ───────────────────────────────────────────────────
  function fetchMealdb(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var seen2: { [n: string]: boolean } = {};
    for (var mi = 0; mi < 40; mi++) {
      try {
        var data2: any = httpGet(nk, "https://www.themealdb.com/api/json/v1/1/random.php");
        if (!data2 || !data2.meals || !data2.meals[0]) continue;
        var m: any = data2.meals[0];
        var mname = m.strMeal || "Unknown";
        var area = m.strArea || "";
        if (!area || area === "Unknown" || seen2[mname]) continue;
        seen2[mname] = true;
        var category2 = m.strCategory || "Main";
        var img2: string | null = m.strMealThumb || null;
        var wa = MEAL_AREAS.filter(function(a) { return a !== area; });
        var waa = pick(wa, 3);
        if (waa.length < 3) continue;
        var mOpts: RawOpt[] = [{ text: area, is_correct: true }];
        for (var wai = 0; wai < waa.length; wai++) mOpts.push({ text: waa[wai] as string, is_correct: false });
        results.push({
          provider_key: "mealdb_" + (m.idMeal || djb2(mname)),
          topic: "food", lang: "en",
          question_text: "\"" + mname + "\" is a traditional dish from which country or region?",
          question_type: "single_select",
          raw_options: mOpts,
          has_media: !!img2,
          media: img2 ? { type: "image", url: img2, thumbnail_url: null, duration_seconds: null, mime_type: "image/jpeg" } : null,
          explanation: "\"" + mname + "\" is a traditional " + area + " dish in the " + category2 + " category.",
          difficulty: "medium", provider: "themealdb",
          meta: { name: mname, area: area }
        });
      } catch (e: any) { logger.debug("[QvQCache/mealdb] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 6. Dog CEO ────────────────────────────────────────────────────────────
  function fetchDogceo(nk: nkruntime.Nakama, env: { [k: string]: string }, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var breedsData: any = httpGet(nk, "https://dog.ceo/api/breeds/list/all");
    if (!breedsData || !breedsData.message) throw new Error("Dog CEO: no breeds");
    var allBreeds: string[] = [];
    var bm: any = breedsData.message;
    for (var breed in bm) {
      if (!bm.hasOwnProperty(breed)) continue;
      var subs: string[] = bm[breed];
      if (subs.length > 0) {
        for (var si = 0; si < subs.length; si++) allBreeds.push(subs[si] + " " + breed);
      } else {
        allBreeds.push(breed);
      }
    }
    var breedSample = 40;
    if (env && env["QV_DOGCEO_BREED_SAMPLE"]) {
      var parsed = parseInt(env["QV_DOGCEO_BREED_SAMPLE"], 40);
      if (!isNaN(parsed) && parsed > 0) breedSample = parsed;
    }
    var selected = pick(allBreeds, breedSample);
    for (var bi = 0; bi < selected.length; bi++) {
      var breedName: string = selected[bi] as string;
      try {
        var parts = breedName.indexOf(" ") !== -1 ? breedName.split(" ") : [breedName];
        var breedKey = parts.length >= 2 ? parts[1] + "/" + parts[0] : parts[0];
        var imgData: any = httpGet(nk, "https://dog.ceo/api/breed/" + breedKey + "/images/random");
        if (!imgData || !imgData.message) {
          logger.info("[QvQCache/dogceo] event=dogceo_breed_skip breed=" +
            breedName.replace(/\s+/g, "_") + " reason=no_image");
          continue;
        }
        var exSet3: { [k: string]: boolean } = {};
        exSet3[breedName] = true;
        var wb = pickExcluding(allBreeds, exSet3, 3);
        if (wb.length < 3) {
          logger.info("[QvQCache/dogceo] event=dogceo_breed_skip breed=" +
            breedName.replace(/\s+/g, "_") + " reason=insufficient_wrong_options");
          continue;
        }
        var dOpts: RawOpt[] = [{ text: capitalize(breedName), is_correct: true }];
        for (var wbi = 0; wbi < wb.length; wbi++) dOpts.push({ text: capitalize(wb[wbi] as string), is_correct: false });
        results.push({
          provider_key: "dogceo_" + djb2(breedName),
          topic: "dog", lang: "en",
          question_text: "What breed of dog is shown in the image?",
          question_type: "single_select",
          raw_options: dOpts,
          has_media: true,
          media: { type: "image", url: imgData.message, thumbnail_url: null, duration_seconds: null, mime_type: "image/jpeg" },
          explanation: "This is a " + breedName + " — a well-known dog breed.",
          difficulty: "hard", provider: "dogceo",
          meta: { breed: breedName }
        });
      } catch (e: any) {
        var skipReason = e && e.message ? String(e.message).replace(/\s+/g, "_") : "unknown";
        logger.info("[QvQCache/dogceo] event=dogceo_breed_skip breed=" +
          breedName.replace(/\s+/g, "_") + " reason=" + skipReason);
      }
    }
    return results;
  }

  // ── 7. Studio Ghibli ──────────────────────────────────────────────────────
  function fetchGhibli(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data3: any[] = httpGet(nk, "https://ghibliapi.vercel.app/films");
    if (!Array.isArray(data3)) throw new Error("Ghibli API: no array");
    var titlePool: string[] = [];
    for (var gx2 = 0; gx2 < data3.length; gx2++) {
      if (data3[gx2].title) titlePool.push(data3[gx2].title);
    }
    var withImage = 0;
    var skipped = 0;

    for (var gi4 = 0; gi4 < data3.length; gi4++) {
      var film: any = data3[gi4];
      try {
        var ftitle = film.title || null;
        var filmImage = film.movie_banner || null;
        var fdirector = film.director || null;
        var fyear = film.release_date || null;
        if (!ftitle || !filmImage) {
          skipped++;
          continue;
        }
        withImage++;
        var exTitle: { [k: string]: boolean } = {};
        exTitle[ftitle] = true;
        var wt = pickExcluding(titlePool, exTitle, 3);
        if (wt.length < 3) {
          skipped++;
          continue;
        }
        var gOpts2: RawOpt[] = [{ text: ftitle, is_correct: true }];
        for (var wti = 0; wti < wt.length; wti++) gOpts2.push({ text: wt[wti] as string, is_correct: false });
        results.push({
          provider_key: "ghibli_poster_" + (film.id || djb2(ftitle)),
          topic: "ghibli", lang: "en",
          question_text: "Which Studio Ghibli film is this?",
          question_type: "single_select",
          raw_options: gOpts2,
          has_media: true,
          media: { type: "image", url: filmImage, thumbnail_url: filmImage, duration_seconds: null, mime_type: "image/jpeg" },
          explanation: "\"" + ftitle + "\" (" + (fyear || "?") + ") — directed by " + (fdirector || "unknown") + ".",
          difficulty: "medium", provider: "ghibli",
          meta: { title: ftitle, director: fdirector, year: fyear }
        });
      } catch (e: any) {
        skipped++;
        logger.debug("[QvQCache/ghibli] skip: " + (e && e.message));
      }
    }
    logger.info("[QvQCache/ghibli] event=ghibli_fetch_summary total_films=" + data3.length +
      " with_image=" + withImage + " skipped=" + skipped + " emitted=" + results.length);
    return results;
  }

  function getRandomInt(min: number, max: number): number {
    // Use Math.floor to round down to the nearest whole number
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ── 8. Disney API ─────────────────────────────────────────────────────────
  function fetchDisney(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    // Random offset for Disney API pagination
    var data4: any = httpGet(nk, "https://api.disneyapi.dev/character?pageSize=50&page=" + getRandomInt(1, 50));
    if (!data4 || !Array.isArray(data4.data)) throw new Error("Disney API: no data");
    var chars: any[] = data4.data;
    // Build pool of all source titles
    var sourcePool: string[] = [];
    for (var dx = 0; dx < chars.length; dx++) {
      var df: any[] = chars[dx].films || [];
      var ds: any[] = chars[dx].tvShows || [];
      for (var dfi = 0; dfi < df.length; dfi++) sourcePool.push(df[dfi]);
      for (var dsi = 0; dsi < ds.length; dsi++) sourcePool.push(ds[dsi]);
    }
    for (var di = 0; di < chars.length; di++) {
      var char: any = chars[di];
      try {
        var cname = char.name || "Unknown";
        var films2: string[] = char.films || [];
        var shows: string[] = char.tvShows || [];
        var img3: string | null = char.imageUrl || null;
        var allSrc: string[] = films2.concat(shows);
        if (allSrc.length === 0) continue;
        var src = allSrc[0];
        var exSrc: { [k: string]: boolean } = {};
        exSrc[src] = true;
        var wss = pickExcluding(sourcePool, exSrc, 3);
        if (wss.length < 3) continue;
        var dsOpts: RawOpt[] = [{ text: src, is_correct: true }];
        for (var wsi = 0; wsi < wss.length; wsi++) dsOpts.push({ text: wss[wsi] as string, is_correct: false });
        results.push({
          provider_key: "disney_" + (char._id || djb2(cname)),
          topic: "disney", lang: "en",
          question_text: "Which Disney title features the character \"" + cname + "\"?",
          question_type: "single_select",
          raw_options: dsOpts,
          has_media: !!img3,
          media: img3 ? { type: "image", url: img3, thumbnail_url: null, duration_seconds: null, mime_type: "image/jpeg" } : null,
          explanation: cname + " is a Disney character from \"" + src + "\".",
          difficulty: "medium", provider: "disney",
          meta: { name: cname, source: src }
        });
      } catch (e: any) { logger.debug("[QvQCache/disney] skip " + (char && char.name) + ": " + (e && e.message)); }
    }
    return results;
  }

  // ── 9. SWAPI (Star Wars) ──────────────────────────────────────────────────
  function fetchSwapi(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data5: any = httpGet(nk, "https://swapi.dev/api/films/");
    if (!data5 || !Array.isArray(data5.results)) throw new Error("SWAPI: no films");
    var films3: any[] = data5.results;
    for (var si2 = 0; si2 < films3.length; si2++) {
      var f: any = films3[si2];
      try {
        var stitle = f.title || "Unknown";
        var sdir = f.director || null;
        var syear = f.release_date ? f.release_date.split("-")[0] : null;
        var sep = f.episode_id || "?";
        if (!sdir) continue;
        var exSW: { [k: string]: boolean } = {};
        exSW[sdir] = true;
        var wsd = pickExcluding(SW_DIRECTORS, exSW, 3);
        if (wsd.length < 3) continue;
        var swOpts: RawOpt[] = [{ text: sdir, is_correct: true }];
        for (var wsdi = 0; wsdi < wsd.length; wsdi++) swOpts.push({ text: wsd[wsdi] as string, is_correct: false });
        results.push({
          provider_key: "swapi_dir_" + si2,
          topic: "starwars", lang: "en",
          question_text: "Who directed Star Wars Episode " + sep + ": \"" + stitle + "\"?",
          question_type: "single_select",
          raw_options: swOpts,
          has_media: false, media: null,
          explanation: "\"" + stitle + "\" (Episode " + sep + (syear ? ", " + syear : "") + ") was directed by " + sdir + ".",
          difficulty: "medium", provider: "swapi",
          meta: { title: stitle, director: sdir, year: syear }
        });
        // Bonus year question
        if (syear) {
          var yr2 = Number(syear);
          if (!isNaN(yr2)) {
            var yrSwOpts: RawOpt[] = [
              { text: String(yr2),     is_correct: true },
              { text: String(yr2 - 3), is_correct: false },
              { text: String(yr2 + 2), is_correct: false },
              { text: String(yr2 - 7), is_correct: false }
            ];
            results.push({
              provider_key: "swapi_year_" + si2,
              topic: "starwars", lang: "en",
              question_text: "In which year was \"" + stitle + "\" released?",
              question_type: "single_select",
              raw_options: yrSwOpts,
              has_media: false, media: null,
              explanation: "\"" + stitle + "\" was released in " + yr2 + ".",
              difficulty: "easy", provider: "swapi",
              meta: { title: stitle, year: syear }
            });
          }
        }
      } catch (e: any) { logger.debug("[QvQCache/swapi] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 10. RestCountries v5 (Countries + Flags) — key-gated ─────────────────
  function rcV5Str(obj: any, flatKey: string, nestedKeys: string[]): string {
    if (obj && obj[flatKey] !== undefined && obj[flatKey] !== null) return String(obj[flatKey]);
    var cur: any = obj;
    for (var ni = 0; ni < nestedKeys.length; ni++) {
      if (!cur) return "";
      cur = cur[nestedKeys[ni]];
    }
    return cur ? String(cur) : "";
  }

  function rcV5CommonName(country: any): string {
    return rcV5Str(country, "names.common", ["names", "common"]);
  }

  function rcV5Capital(country: any): string {
    if (country && country["capitals.name"]) return String(country["capitals.name"]);
    if (country && country.capitals && country.capitals.length > 0) {
      var cap = country.capitals[0];
      if (typeof cap === "string") return cap;
      if (cap && cap.name) return String(cap.name);
    }
    return "";
  }

  function rcV5Alpha2(country: any): string {
    return rcV5Str(country, "codes.alpha_2", ["codes", "alpha_2"]);
  }

  function rcV5Region(country: any): string {
    var region = rcV5Str(country, "region", ["region"]);
    return region || "Unknown";
  }

  function rcV5FlagPng(country: any, alpha2: string): string | null {
    var url = rcV5Str(country, "flag.url_png", ["flag", "url_png"]);
    if (url) return url;
    if (alpha2) return "https://flags.restcountries.com/v5/w320/" + alpha2.toLowerCase() + ".png";
    return null;
  }

  function fetchRestcountries(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger, topic: string): RawQuestion[] {
    var results: RawQuestion[] = [];
    var apiKey = envKey(env, "REST_COUNTRIES_API_KEY");
    var keyPresent = !!apiKey;

    logger.info("[QvQCache/restcountries] event=provider_v5_fetch_start topic=" + topic +
      " key_present=" + (keyPresent ? "true" : "false") +
      " host=api.restcountries.com limit=100 paginated=true");

    if (!apiKey) throw new Error("missing_api_key");

    var authHeaders: { [k: string]: string } = { "Authorization": "Bearer " + apiKey };
    var baseUrl = "https://api.restcountries.com/countries/v5?response_fields=names.common,capitals,region,population,codes.alpha_2,flag.url_png&limit=100";
    var objects: any[] = [];
    var offset = 0;
    var pagesFetched = 0;

    while (true) {
      var pageUrl = baseUrl + "&offset=" + offset;
      var parsed: any;
      try {
        parsed = httpGet(nk, pageUrl, authHeaders);
      } catch (he: any) {
        var hmsg = he && he.message ? he.message : String(he);
        if (hmsg.indexOf("HTTP 401") !== -1) throw new Error("http_401");
        if (hmsg.indexOf("HTTP 403") !== -1) throw new Error("http_403");
        throw he;
      }

      if (parsed && parsed.success === false && parsed.errors) {
        throw new Error("restcountries_v3_deprecated");
      }
      if (!parsed || !parsed.data || !parsed.data.objects || !Array.isArray(parsed.data.objects)) {
        throw new Error("unexpected_response_shape");
      }

      var pageObjects: any[] = parsed.data.objects;
      var meta: any = parsed.data.meta || {};
      pagesFetched++;
      logger.info("[QvQCache/restcountries] event=provider_v5_page_done topic=" + topic +
        " offset=" + offset +
        " page_count=" + pageObjects.length +
        " meta_total=" + (meta.total ? meta.total : 0) +
        " meta_more=" + (meta.more ? "true" : "false"));

      for (var pi = 0; pi < pageObjects.length; pi++) objects.push(pageObjects[pi]);

      if (!meta.more) break;
      offset += 100;
      if (offset > 1000) break;
    }

    logger.info("[QvQCache/restcountries] event=provider_v5_fetch_done topic=" + topic +
      " object_count=" + objects.length +
      " pages_fetched=" + pagesFetched);

    if (objects.length === 0) throw new Error("provider_returned_zero");

    var withCap: any[] = [];
    for (var rc = 0; rc < objects.length; rc++) {
      if (rcV5CommonName(objects[rc]) && rcV5Capital(objects[rc])) {
        withCap.push(objects[rc]);
      }
    }
    var allCaps: string[] = [];
    var allCNames: string[] = [];
    for (var rc2 = 0; rc2 < withCap.length; rc2++) {
      var capName = rcV5Capital(withCap[rc2]);
      if (capName) allCaps.push(capName);
      allCNames.push(rcV5CommonName(withCap[rc2]));
    }

    var flagRawCount = 0;
    var capRawCount = 0;
    var sample2 = pick(withCap, 40);
    for (var ci3 = 0; ci3 < sample2.length; ci3++) {
      var country: any = sample2[ci3];
      try {
        var cname2 = rcV5CommonName(country);
        var capital = rcV5Capital(country);
        var region = rcV5Region(country);
        var alpha2 = rcV5Alpha2(country);
        var flagPng: string | null = rcV5FlagPng(country, alpha2);

        // Capital question
        var exCap: { [k: string]: boolean } = {};
        exCap[capital] = true;
        var wc2 = pickExcluding(allCaps, exCap, 3);
        if (wc2.length >= 3) {
          var capOpts: RawOpt[] = [{ text: capital, is_correct: true }];
          for (var wci2 = 0; wci2 < wc2.length; wci2++) capOpts.push({ text: wc2[wci2] as string, is_correct: false });
          results.push({
            provider_key: "rc_cap_" + djb2(cname2),
            topic: "countries", lang: "en",
            question_text: "What is the capital city of " + cname2 + "?",
            question_type: "single_select",
            raw_options: capOpts,
            has_media: !!flagPng,
            media: flagPng ? { type: "image", url: flagPng, thumbnail_url: null, duration_seconds: null, mime_type: "image/png" } : null,
            explanation: cname2 + " is located in " + region + ". Its capital city is " + capital + ".",
            difficulty: "medium", provider: "restcountries",
            meta: { name: cname2, capital: capital, region: region }
          });
          capRawCount++;
        }

        // Flag question (topic = "flags")
        if (flagPng) {
          var exCN: { [k: string]: boolean } = {};
          exCN[cname2] = true;
          var wcn = pickExcluding(allCNames, exCN, 3);
          if (wcn.length >= 3) {
            var flagOpts: RawOpt[] = [{ text: cname2, is_correct: true }];
            for (var wfci = 0; wfci < wcn.length; wfci++) flagOpts.push({ text: wcn[wfci] as string, is_correct: false });
            results.push({
              provider_key: "rc_flag_" + djb2(cname2),
              topic: "flags", lang: "en",
              question_text: "Which country does this flag belong to?",
              question_type: "single_select",
              raw_options: flagOpts,
              has_media: true,
              media: { type: "image", url: flagPng, thumbnail_url: null, duration_seconds: null, mime_type: "image/png" },
              explanation: "This is the flag of " + cname2 + " (" + region + "). Capital: " + capital + ".",
              difficulty: "medium", provider: "restcountries",
              meta: { name: cname2, capital: capital, region: region }
            });
            flagRawCount++;
          }
        }
      } catch (e: any) { logger.debug("[QvQCache/restcountries] skip " + rcV5CommonName(country) + ": " + (e && e.message)); }
    }

    logger.info("[QvQCache/restcountries] event=provider_v5_raw_built topic=" + topic +
      " countries_sampled=" + sample2.length +
      " raw_flags=" + flagRawCount +
      " raw_countries=" + capRawCount);

    return results;
  }

  // ── 11. NASA APOD (Space) — key-gated; falls back to DEMO_KEY ─────────────
  function fetchNasa(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger, ): RawQuestion[] {
    var results: RawQuestion[] = [];
    var apiKey = envKey(env, "NASA_API_KEY") || "DEMO_KEY";
    var data7: any = httpGet(nk, "https://api.nasa.gov/planetary/apod?api_key=" + apiKey + "&count=50&thumbs=true");
    if (!Array.isArray(data7)) throw new Error("NASA APOD: expected array");

    for (var ni = 0; ni < data7.length; ni++) {
      var apod: any = data7[ni];
      try {
        var atitle = (apod.title || "").trim();
        var adate  = apod.date || "";
        var aurl   = apod.hdurl || apod.url || null;
        var athumb = apod.thumbnail_url || aurl;
        if (!atitle || atitle.length < 5 || !aurl) continue;
        var exSp: { [k: string]: boolean } = {};
        exSp[atitle] = true;
        var wspc = pickExcluding(SPACE_OBJECTS, exSp, 3);
        if (wspc.length < 3) {
          wspc = pick(SPACE_OBJECTS.filter(function(s) { return s !== atitle; }), 3);
        }
        if (wspc.length < 3) continue;
        var sOpts: RawOpt[] = [{ text: atitle, is_correct: true }];
        for (var wspi = 0; wspi < wspc.length; wspi++) sOpts.push({ text: wspc[wspi] as string, is_correct: false });
        var aexpl = (apod.explanation || "").substring(0, 200);
        results.push({
          provider_key: "nasa_" + djb2(atitle + adate),
          topic: "space", lang: "en",
          question_text: "What is featured in this NASA Astronomy Picture of the Day?",
          question_type: "single_select",
          raw_options: sOpts,
          has_media: true,
          media: { type: "image", url: athumb, thumbnail_url: athumb, duration_seconds: null, mime_type: "image/jpeg" },
          explanation: "NASA APOD " + adate + ": " + atitle + ". " + aexpl,
          difficulty: "hard", provider: "nasa",
          meta: { title: atitle }
        });
      } catch (e: any) { logger.debug("[QvQCache/nasa] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 12. TMDB (Movies) — requires TMDB_API_KEY ─────────────────────────────
  function fetchTmdb(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var apiKey2 = envKey(env, "TMDB_API_KEY");
    if (!apiKey2) throw new Error("TMDB_API_KEY not set — add to SSM /nakama/TMDB_API_KEY or FALLBACK_KEYS in question_cache.ts");
    var data8: any = httpGet(nk, "https://api.themoviedb.org/3/movie/popular?api_key=" + apiKey2 + "&language=en-US&page=1");
    if (!data8 || !Array.isArray(data8.results)) throw new Error("TMDB: no results array");
    var movies: any[] = data8.results;
    for (var mi2 = 0; mi2 < movies.length; mi2++) {
      var mov: any = movies[mi2];
      try {
        var mtitle = mov.title || "Unknown";
        var myear  = mov.release_date ? mov.release_date.split("-")[0] : null;
        if (!myear) continue;
        var yr3 = Number(myear);
        if (isNaN(yr3)) continue;
        var poster: string | null = mov.poster_path ? "https://image.tmdb.org/t/p/w500" + mov.poster_path : null;
        var tOpts: RawOpt[] = [
          { text: String(yr3),     is_correct: true },
          { text: String(yr3 - 1), is_correct: false },
          { text: String(yr3 + 1), is_correct: false },
          { text: String(yr3 - 2), is_correct: false }
        ];
        results.push({
          provider_key: "tmdb_" + (mov.id || djb2(mtitle)),
          topic: "movies", lang: "en",
          question_text: "In which year was the film \"" + mtitle + "\" released?",
          question_type: "single_select",
          raw_options: tOpts,
          has_media: !!poster,
          media: poster ? { type: "image", url: poster, thumbnail_url: poster, duration_seconds: null, mime_type: "image/jpeg" } : null,
          explanation: "\"" + mtitle + "\" was released in " + yr3 + ".",
          difficulty: "medium", provider: "tmdb",
          meta: { title: mtitle, year: myear }
        });
      } catch (e: any) { logger.debug("[QvQCache/tmdb] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 13. TheSportsDB (Sports) — free tier (key=3) ──────────────────────────
  function fetchSportsdb(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var leagues = [
      { id: "4328", name: "English Premier League" },
      { id: "4335", name: "NBA" },
      { id: "4424", name: "NFL" },
      { id: "4346", name: "NHL" }
    ];
    var totalTeams = 0;
    var withBadge = 0;
    var skipped = 0;

    for (var li = 0; li < leagues.length; li++) {
      var league = leagues[li];
      try {
        var sdata: any = httpGet(nk, "https://www.thesportsdb.com/api/v1/json/3/lookup_all_teams.php?id=" + league.id);
        if (!sdata || !Array.isArray(sdata.teams)) continue;
        var teams: any[] = sdata.teams.slice(0, 20);
        var teamPool: string[] = [];
        for (var sx = 0; sx < teams.length; sx++) {
          if (teams[sx].strTeam) teamPool.push(teams[sx].strTeam);
        }
        for (var ti2 = 0; ti2 < teams.length; ti2++) {
          var team: any = teams[ti2];
          totalTeams++;
          try {
            var tname = team.strTeam || null;
            var tbadge: string | null = team.strFanart1 || team.strBadge|| null;
            var tfounded = team.intFormedYear || null;
            if (!tname || !tbadge) {
              skipped++;
              continue;
            }
            withBadge++;
            var exTeam: { [k: string]: boolean } = {};
            exTeam[tname] = true;
            var ws2 = pickExcluding(teamPool, exTeam, 3);
            if (ws2.length < 3) {
              skipped++;
              continue;
            }
            var stOpts: RawOpt[] = [{ text: tname, is_correct: true }];
            for (var wsi2 = 0; wsi2 < ws2.length; wsi2++) stOpts.push({ text: ws2[wsi2] as string, is_correct: false });
            results.push({
              provider_key: "sdb_badge_" + (team.idTeam || djb2(tname)),
              topic: "sports", lang: "en",
              question_text: "Who is this athlete/team?",
              question_type: "single_select",
              raw_options: stOpts,
              has_media: true,
              media: { type: "image", url: tbadge, thumbnail_url: tbadge, duration_seconds: null, mime_type: "image/png" },
              explanation: tname + " (" + league.name + ")" + (tfounded ? ", founded in " + tfounded : "") + ".",
              difficulty: "medium", provider: "sportsdb",
              meta: { team: tname, league: league.name }
            });
          } catch (e: any) {
            skipped++;
            logger.debug("[QvQCache/sdb] skip team: " + (e && e.message));
          }
        }
      } catch (e: any) { logger.debug("[QvQCache/sdb] skip league " + league.name + ": " + (e && e.message)); }
    }
    logger.info("[QvQCache/sdb] event=sports_fetch_summary total_teams=" + totalTeams +
      " with_badge=" + withBadge + " skipped=" + skipped + " emitted=" + results.length);
    return results;
  }

  // ── 14. Last.fm (Music) — requires LASTFM_API_KEY ─────────────────────────
  function fetchLastfm(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var fmKey = envKey(env, "LASTFM_API_KEY");
    if (!fmKey) throw new Error("LASTFM_API_KEY not set — add to SSM /nakama/LASTFM_API_KEY or FALLBACK_KEYS in question_cache.ts");
    var artists: any = httpGet(nk, "https://ws.audioscrobbler.com/2.0/?method=chart.getTopArtists&api_key=" + fmKey + "&format=json&limit=50");
    var tracks: any  = httpGet(nk, "https://ws.audioscrobbler.com/2.0/?method=chart.getTopTracks&api_key=" + fmKey + "&format=json&limit=30");
    if (!artists || !artists.artists || !artists.artists.artist) throw new Error("Last.fm: no artists");
    if (!tracks  || !tracks.tracks  || !tracks.tracks.track)   throw new Error("Last.fm: no tracks");
    var artistNames: string[] = [];
    var aa: any[] = artists.artists.artist;
    for (var ai2 = 0; ai2 < aa.length; ai2++) { if (aa[ai2].name) artistNames.push(aa[ai2].name); }
    var trackList: any[] = tracks.tracks.track;
    for (var ti3 = 0; ti3 < trackList.length; ti3++) {
      var track: any = trackList[ti3];
      try {
        var tname2 = track.name || "Unknown";
        var aname  = track.artist && track.artist.name ? track.artist.name : null;
        if (!aname) continue;
        var exFM: { [k: string]: boolean } = {};
        exFM[aname] = true;
        var wfm = pickExcluding(artistNames, exFM, 3);
        if (wfm.length < 3) continue;
        var fmOpts: RawOpt[] = [{ text: aname, is_correct: true }];
        for (var wfmi = 0; wfmi < wfm.length; wfmi++) fmOpts.push({ text: wfm[wfmi] as string, is_correct: false });
        results.push({
          provider_key: "lfm_" + djb2(tname2 + aname),
          topic: "music", lang: "en",
          question_text: "Which artist performed the song \"" + tname2 + "\"?",
          question_type: "single_select",
          raw_options: fmOpts,
          has_media: false, media: null,
          explanation: "\"" + tname2 + "\" is performed by " + aname + ".",
          difficulty: "medium", provider: "lastfm",
          meta: {}
        });
      } catch (e: any) { logger.debug("[QvQCache/lastfm] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 15. News — keyed APIs + Guardian + Spaceflight News (open) ─────────────
  function newsArticleImage(art: any): string | null {
    if (!art) return null;
    if (art.image && String(art.image).trim()) return String(art.image).trim();
    if (art.urlToImage && String(art.urlToImage).trim()) return String(art.urlToImage).trim();
    if (art.image_url && String(art.image_url).trim()) return String(art.image_url).trim();
    if (art.fields && art.fields.thumbnail && String(art.fields.thumbnail).trim()) {
      return String(art.fields.thumbnail).trim();
    }
    return null;
  }

  function appendGuardianArticles(
    nk: nkruntime.Nakama, logger: nkruntime.Logger, articles: any[], apiKey: string
  ): void {
    if (!apiKey) return;
    try {
      var gdata: any = httpGet(nk,
        "https://content.guardianapis.com/search?show-fields=thumbnail,trailText&page-size=20&order-by=newest&api-key=" + apiKey
      );
      if (!gdata || !gdata.response || !Array.isArray(gdata.response.results)) return;
      var gr: any[] = gdata.response.results;
      for (var gi = 0; gi < gr.length; gi++) {
        var item: any = gr[gi];
        if (!item.webTitle) continue;
        articles.push({
          title: item.webTitle,
          description: (item.fields && item.fields.trailText) ? item.fields.trailText : "",
          image: (item.fields && item.fields.thumbnail) ? item.fields.thumbnail : null,
          source: { name: "The Guardian" },
          provider: "guardian"
        });
      }
    } catch (e: any) { logger.warn("[QvQCache/news] Guardian: " + (e && e.message)); }
  }

  function appendSpaceflightArticles(nk: nkruntime.Nakama, logger: nkruntime.Logger, articles: any[]): void {
    try {
      var sf: any = httpGet(nk, "https://api.spaceflightnewsapi.net/v4/articles/?limit=20");
      if (!sf || !Array.isArray(sf.results)) return;
      for (var si = 0; si < sf.results.length; si++) {
        var item: any = sf.results[si];
        if (!item.title) continue;
        articles.push({
          title: item.title,
          description: item.summary || "",
          image: item.image_url || null,
          source: { name: item.news_site || "Spaceflight News" },
          provider: "spaceflightnews"
        });
      }
    } catch (e: any) { logger.warn("[QvQCache/news] SpaceflightNews: " + (e && e.message)); }
  }

  function fetchNews(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var articles: any[] = [];
    var gnKey  = envKey(env, "GNEWS_API_KEY");
    var curKey = envKey(env, "CURRENTS_API_KEY");
    var msKey  = envKey(env, "MEDIASTACK_API_KEY");
    var naKey  = envKey(env, "NEWSAPI_API_KEY");
    var guKey  = envKey(env, "GUARDIAN_API_KEY");

    if (msKey) {
      try {
        var md: any = httpGet(nk, "http://api.mediastack.com/v1/news?access_key=" + msKey + "&languages=en&limit=50");
        if (md && Array.isArray(md.data)) {
          for (var mni = 0; mni < md.data.length; mni++) {
            var mn: any = md.data[mni];
            articles.push({
              title: mn.title, description: mn.description || "",
              image: mn.image || null,
              source: { name: mn.source || "MediaStack" },
              provider: "mediastack"
            });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] MediaStack: " + (e && e.message)); }
    }
    if (gnKey) {
      try {
        var gd: any = httpGet(nk, "https://gnews.io/api/v4/top-headlines?token=" + gnKey + "&lang=en&max=50");
        if (gd && gd.articles) {
          for (var gni = 0; gni < gd.articles.length; gni++) {
            var ga: any = gd.articles[gni];
            articles.push({
              title: ga.title, description: ga.description || "",
              image: ga.image || null,
              source: ga.source || { name: "GNews" },
              provider: "gnews"
            });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] GNews: " + (e && e.message)); }
    }
    if (curKey) {
      try {
        var cd: any = httpGet(nk, "https://api.currentsapi.services/v1/latest-news?apiKey=" + curKey + "&language=en");
        if (cd && Array.isArray(cd.news)) {
          for (var cni = 0; cni < cd.news.length; cni++) {
            var cn: any = cd.news[cni];
            articles.push({
              title: cn.title, description: cn.description || "",
              image: cn.image || null,
              source: { name: cn.author || "Currents" },
              provider: "currents"
            });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] Currents: " + (e && e.message)); }
    }
    if (naKey) {
      try {
        var nd: any = httpGet(nk, "https://newsapi.org/v2/top-headlines?apiKey=" + naKey + "&language=en&pageSize=50");
        if (nd && Array.isArray(nd.articles)) {
          for (var nai = 0; nai < nd.articles.length; nai++) {
            var na: any = nd.articles[nai];
            articles.push({
              title: na.title, description: na.description || "",
              image: na.urlToImage || null,
              source: na.source || { name: "NewsAPI" },
              provider: "newsapi"
            });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] NewsAPI: " + (e && e.message)); }
    }

    // Open fallbacks — no paid keys required; guarantee image+headline coverage
    appendGuardianArticles(nk, logger, articles, guKey);
    appendSpaceflightArticles(nk, logger, articles);

    if (articles.length === 0) {
      throw new Error("All news providers failed (GNews, Currents, MediaStack, NewsAPI, Guardian, Spaceflight News API)");
    }

    var headlinePool: string[] = [];
    for (var hpi = 0; hpi < articles.length; hpi++) {
      var ht = (articles[hpi].title || "").trim();
      if (ht.length >= 20) headlinePool.push(ht);
    }
    var withImage = 0;
    var skipped = 0;

    for (var ni2 = 0; ni2 < articles.length; ni2++) {
      var art: any = articles[ni2];
      try {
        var headline = (art.title || "").trim();
        var desc = art.description || "";
        var srcName = art.source && art.source.name ? art.source.name : "News";
        var imgUrl: string | null = newsArticleImage(art);
        var artProvider = art.provider || "gnews";
        if (!headline || headline.length < 20 || !imgUrl) {
          skipped++;
          continue;
        }
        withImage++;
        var exHead: { [k: string]: boolean } = {};
        exHead[headline] = true;
        var wh = pickExcluding(headlinePool, exHead, 3);
        if (wh.length < 3) {
          skipped++;
          continue;
        }
        var hlShort = headline.length > 120 ? headline.substring(0, 117) + "..." : headline;
        var nOpts: RawOpt[] = [{ text: hlShort, is_correct: true }];
        for (var whi = 0; whi < wh.length; whi++) {
          var wrongHl = wh[whi] as string;
          nOpts.push({
            text: wrongHl.length > 120 ? wrongHl.substring(0, 117) + "..." : wrongHl,
            is_correct: false
          });
        }
        results.push({
          provider_key: "news_img_" + djb2(headline),
          topic: "news", lang: "en",
          question_text: "What is shown in this news image?",
          question_type: "single_select",
          raw_options: nOpts,
          has_media: true,
          media: { type: "image", url: imgUrl, thumbnail_url: imgUrl, duration_seconds: null, mime_type: "image/jpeg" },
          explanation: "This headline is from " + srcName + ". " + desc.substring(0, 150),
          difficulty: "medium", provider: artProvider,
          meta: { headline: headline, source: srcName }
        });
      } catch (e: any) {
        skipped++;
        logger.debug("[QvQCache/news] skip: " + (e && e.message));
      }
    }
    logger.info("[QvQCache/news] event=news_fetch_summary total_articles=" + articles.length +
      " with_image=" + withImage + " skipped=" + skipped + " emitted=" + results.length);
    if (results.length === 0) {
      throw new Error("No news articles with images — total_articles=" + articles.length + " with_image=" + withImage);
    }
    return results;
  }

  // ── 16. Video Quiz catalog (Nakama storage, seeded from build embed) ───────

  /**
   * Idempotent seed: writes qv_catalog_video_quiz/catalog_{lang} + meta when the
   * bundled version differs from storage. Reads globalThis.__QV_VIDEO_QUIZ_CATALOG__
   * injected by postbuild.js at deploy time.
   */
  export function ensureVideoQuizCatalogSeeded(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger
  ): { ok: boolean; version?: string; question_count?: number; skipped?: boolean; error?: string } {
    var bundle: any = null;
    try {
      var g = (globalThis as any).__QV_VIDEO_QUIZ_CATALOG__;
      if (g && typeof g === "object") bundle = g;
    } catch (_ge) {}

    if (!bundle || !bundle.version || !bundle.langs || typeof bundle.langs !== "object") {
      logger.warn("[QvQCache/video_quiz] catalog bundle missing or empty — postbuild embed absent?");
      return { ok: false, error: "catalog_bundle_missing" };
    }

    var needsWrite = false;
    try {
      var metaRows = nk.storageRead([{
        collection: COL_VIDEO_CATALOG, key: "meta", userId: Constants.SYSTEM_USER_ID
      }]);
      if (!metaRows || metaRows.length === 0 || !metaRows[0].value) {
        needsWrite = true;
      } else {
        var storedVersion: string = metaRows[0].value.version || "";
        if (storedVersion !== bundle.version) needsWrite = true;
      }
    } catch (_re) {
      needsWrite = true;
    }

    if (!needsWrite) {
      logger.info("[QvQCache/video_quiz] catalog already seeded version=" + bundle.version);
      return { ok: true, version: bundle.version, skipped: true };
    }

    var totalCount = 0;
    var langCount  = 0;
    var writes: nkruntime.StorageWriteRequest[] = [];
    var langKeys   = Object.keys(bundle.langs);

    for (var li = 0; li < langKeys.length; li++) {
      var lang = langKeys[li];
      var questions: any = bundle.langs[lang];
      if (!Array.isArray(questions) || questions.length === 0) continue;
      totalCount += questions.length;
      langCount++;
      writes.push({
        collection:      COL_VIDEO_CATALOG,
        key:             "catalog_" + lang,
        userId:          Constants.SYSTEM_USER_ID,
        value: {
          topic:     "video_quiz",
          lang:      lang,
          version:   bundle.version,
          questions: questions
        },
        permissionRead:  1,
        permissionWrite: 0
      });
    }

    if (langCount === 0) {
      logger.warn("[QvQCache/video_quiz] catalog bundle has no lang entries");
      return { ok: false, error: "catalog_no_langs" };
    }

    writes.push({
      collection: COL_VIDEO_CATALOG,
      key:        "meta",
      userId:     Constants.SYSTEM_USER_ID,
      value: {
        version:        bundle.version,
        seeded_at_ms:   nowMs(),
        question_count: totalCount,
        source:         bundle.source || "FallbackQuestions_csv"
      },
      permissionRead:  1,
      permissionWrite: 0
    });

    nk.storageWrite(writes);
    logger.info(
      "[QvQCache/video_quiz] seeded catalog version=" + bundle.version +
      " questions=" + totalCount + " langs=" + langCount
    );
    return { ok: true, version: bundle.version, question_count: totalCount };
  }

  function fetchVideoQuiz(
    nk:     nkruntime.Nakama,
    env:    any,
    logger: nkruntime.Logger
  ): RawQuestion[] {
    var seedResult = ensureVideoQuizCatalogSeeded(nk, logger);
    if (!seedResult.ok) {
      throw new Error("video_quiz: catalog not seeded — " + (seedResult.error || "unknown"));
    }

    var lang = "en";
    var rows = nk.storageRead([{
      collection: COL_VIDEO_CATALOG, key: "catalog_" + lang, userId: Constants.SYSTEM_USER_ID
    }]);
    if (!rows || rows.length === 0 || !rows[0].value || !Array.isArray(rows[0].value.questions)) {
      throw new Error("video_quiz: catalog_" + lang + " missing or empty");
    }

    var catalogQs: any[] = rows[0].value.questions;
    var results: RawQuestion[] = [];

    for (var vi = 0; vi < catalogQs.length; vi++) {
      var cq: any = catalogQs[vi];
      try {
        if (!cq.has_media || !cq.media || cq.media.type !== "video") continue;
        if (!cq.media.url || String(cq.media.url).trim().length === 0) continue;
        if (!cq.question_text || !Array.isArray(cq.options) || cq.options.length < 2) continue;
        if (!Array.isArray(cq.correct_option_ids) || cq.correct_option_ids.length === 0) continue;

        var rOpts: RawOpt[] = [];
        for (var oi = 0; oi < cq.options.length; oi++) {
          var opt: any = cq.options[oi];
          if (!opt || !opt.text) continue;
          var optId = opt.id || LETTERS[oi];
          var isC   = cq.correct_option_ids.indexOf(optId) !== -1;
          rOpts.push({ text: String(opt.text), is_correct: isC });
        }
        if (rOpts.filter(function(o) { return o.is_correct; }).length === 0) continue;

        results.push({
          provider_key:  cq.id || djb2(cq.question_text),
          topic:         "video_quiz",
          lang:          lang,
          question_text: cq.question_text,
          question_type: "single_select",
          raw_options:   rOpts,
          has_media:     true,
          media:         cq.media,
          explanation:   cq.explanation || "",
          difficulty:    cq.difficulty || "medium",
          provider:      "catalog",
          meta:          {}
        });
      } catch (e: any) {
        logger.debug("[QvQCache/video_quiz] skip[" + vi + "]: " + (e && e.message));
      }
    }

    if (results.length === 0) {
      throw new Error("video_quiz: zero valid questions after validation");
    }

    logger.info("[QvQCache/video_quiz] loaded " + results.length + " questions from catalog_" + lang);
    return results;
  }

  // ── 17. S3 (daily / weekly) ───────────────────────────────────────────────
  function fetchS3(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger, topic: string): RawQuestion[] {
    var results: RawQuestion[] = [];
    var base = (env && env.S3_BASE_URL) ? env.S3_BASE_URL : "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com";
    var url = "";

    if (topic === "daily") {
      var d = new Date();
      url = base + "/daily-quiz/dailyquiz-" + d.getFullYear() + "-" + padTwo(d.getMonth() + 1) + "-" + padTwo(d.getDate()) + ".json";
    } else if (topic === "weekly") {
      var d2 = new Date();
      var dow = d2.getDay() || 7;
      d2.setDate(d2.getDate() + 4 - dow);
      var yearStart = new Date(d2.getFullYear(), 0, 1);
      var wk = Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      url = base + "/quiz-verse/weekly/" + d2.getFullYear() + "-" + wk + "-1-en.json";
    }
    if (!url) return results;

    try {
      var data9: any = httpGet(nk, url);
      var qs: any[] = Array.isArray(data9) ? data9 : (data9.questions || []);
      for (var qi2 = 0; qi2 < qs.length; qi2++) {
        var sq: any = qs[qi2];
        try {
          if (!sq.question_text || !sq.options) continue;
          var rOpts: RawOpt[] = [];
          for (var soi = 0; soi < sq.options.length; soi++) {
            var sopt: any = sq.options[soi];
            var isC = sq.correct_option_ids
              ? (sq.correct_option_ids as string[]).indexOf(sopt.id) !== -1
              : !!sopt.is_correct;
            rOpts.push({ text: sopt.text || String(sopt), is_correct: isC });
          }
          results.push({
            provider_key: sq.id || djb2(sq.question_text),
            topic: topic, lang: sq.lang || "en",
            question_text: sq.question_text,
            question_type: sq.question_type || "single_select",
            raw_options: rOpts,
            has_media: !!sq.has_media,
            media: sq.media || null,
            explanation: sq.explanation || "",
            difficulty: sq.difficulty || "medium",
            provider: "s3", meta: {}
          });
        } catch (e: any) { logger.debug("[QvQCache/s3/" + topic + "] skip q: " + (e && e.message)); }
      }
    } catch (e: any) { logger.warn("[QvQCache/s3/" + topic + "] " + url + " → " + (e && e.message)); }
    return results;
  }

  // ── Provider router ────────────────────────────────────────────────────────

  function fetchForTopic(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger, topic: string): RawQuestion[] {
    switch (topic) {
      case "geography":   return fetchGeoQuiz(nk, logger);
      case "speed_quiz":  return fetchSpeedQuiz(nk, logger);
      case "true_false":  return fetchTrueFalseQuiz(nk, logger);
      case "anime":     return fetchJikan(nk, logger);
      case "pokemon":   return fetchPokeapi(nk, logger);
      case "cocktail":  return fetchCocktaildb(nk, logger);
      case "food":      return fetchMealdb(nk, logger);
      case "dog":       return fetchDogceo(nk, env, logger);
      case "ghibli":    return fetchGhibli(nk, logger);
      case "disney":    return fetchDisney(nk, logger);
      case "starwars":  return fetchSwapi(nk, logger);
      case "countries": {
        var all = fetchRestcountries(nk, env, logger, "countries");
        return all.filter(function(q) { return q.topic === "countries"; });
      }
      case "flags": {
        var all2 = fetchRestcountries(nk, env, logger, "flags");
        return all2.filter(function(q) { return q.topic === "flags"; });
      }
      case "space":    return fetchNasa(nk, env, logger);
      case "movies":   return fetchTmdb(nk, env, logger);
      case "sports":   return fetchSportsdb(nk, logger);
      case "music":    return fetchLastfm(nk, env, logger);
      case "news":     return fetchNews(nk, env, logger);
      case "daily":
      case "weekly":   return fetchS3(nk, env, logger, topic);
      case "video_quiz": return fetchVideoQuiz(nk, env, logger);
      case "ai":       throw new Error("ai topic is generated on-demand — never cached");
      default:         throw new Error("Unknown topic: " + topic);
    }
  }

  // ── Write cache pages ──────────────────────────────────────────────────────

  function writeCache(
    nk:        nkruntime.Nakama,
    logger:    nkruntime.Logger,
    topic:     string,
    questions: NormalizedQuestion[],
    provider:  string,
    qStats:    any,
    ttlMs:     number
  ): void {
    var now = nowMs();
    var pages = Math.ceil(questions.length / MAX_PER_DOC);
    for (var p = 0; p < pages; p++) {
      var slice = questions.slice(p * MAX_PER_DOC, (p + 1) * MAX_PER_DOC);
      var langs: { [l: string]: number } = {};
      for (var qi = 0; qi < slice.length; qi++) {
        var l = slice[qi].lang || "en";
        langs[l] = (langs[l] || 0) + 1;
      }
      nk.storageWrite([{
        collection:      COL_CACHE + topic,
        key:             "pool_" + p,
        userId:          Constants.SYSTEM_USER_ID,
        value: {
          topic:          topic,
          page:           p,
          page_count:     pages,
          cached_at_ms:   now,
          expires_at_ms:  ttlMs > 0 ? now + ttlMs : 0,
          ttl_ms:         ttlMs,
          provider:       provider,
          question_count: slice.length,
          providers_used: [provider],
          lang_breakdown: langs,
          quality_gate:   qStats,
          questions:      slice
        },
        permissionRead:  1,
        permissionWrite: 0
      }]);
      logger.info("[QvQCache/" + topic + "] wrote pool_" + p + " (" + slice.length + " questions)");
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CLAUDE ENRICHMENT (Task 1.5)
  // For questions still missing an explanation after template pass, call
  // claude-haiku-20240307 for a single factual sentence.  Capped at
  // CLAUDE_ENRICH_MAX per refresh cycle to control cost.
  // ══════════════════════════════════════════════════════════════════════════

  var CLAUDE_ENRICH_MAX = 10;

  function claudeEnrichBatch(
    nk:        nkruntime.Nakama,
    env:       { [k: string]: string },
    logger:    nkruntime.Logger,
    questions: NormalizedQuestion[]
  ): void {
    var apiKey = envKey(env, "ANTHROPIC_API_KEY");
    if (!apiKey) return;

    var enriched = 0;
    for (var i = 0; i < questions.length; i++) {
      if (enriched >= CLAUDE_ENRICH_MAX) break;
      var q = questions[i];
      if (q.explanation && q.explanation.trim().length > 8) continue;

      try {
        var prompt =
          "Provide exactly one short educational sentence (25 words or fewer) that explains " +
          "the correct answer to this quiz question: \"" + q.question_text + "\"";
        var body = JSON.stringify({
          model:      "claude-3-5-haiku-20241022",
          max_tokens: 100,
          messages:   [{ role: "user", content: prompt }]
        });
        var cresp = nk.httpRequest(
          "https://api.anthropic.com/v1/messages",
          "post",
          {
            "Content-Type":      "application/json",
            "x-api-key":         apiKey,
            "anthropic-version": "2023-06-01"
          },
          body
        );
        if (cresp && cresp.code === 200) {
          var cdata: any = JSON.parse(cresp.body);
          if (cdata.content && cdata.content.length > 0 && cdata.content[0].text) {
            q.explanation = cdata.content[0].text.trim();
            enriched++;
          }
        } else {
          logger.warn("[QvQCache/claude] status " + (cresp ? cresp.code : "null") + " for q=" + q.id);
        }
      } catch (ce: any) {
        logger.warn("[QvQCache/claude] enrich failed q=" + q.id + ": " + (ce && ce.message ? ce.message : String(ce)));
      }
    }
    if (enriched > 0) {
      logger.info("[QvQCache/claude] enriched " + enriched + " explanations via Claude Haiku");
    }
  }

  // ── Per-topic refresh gate ─────────────────────────────────────────────────
  //
  // Prevents duplicate provider fetches when multiple get_questions calls hit
  // a cold cache simultaneously. Gate failure is non-fatal — caller proceeds.

  function tryAcquireRefreshGate(nk: nkruntime.Nakama, topic: string): boolean {
    try {
      var rows = nk.storageRead([{ collection: COL_REFRESH_GATE, key: topic, userId: Constants.SYSTEM_USER_ID }]);
      var lastMs: number = (rows && rows.length > 0 && rows[0].value && rows[0].value.last_refresh_ms)
        ? rows[0].value.last_refresh_ms : 0;
      if (nowMs() - lastMs < REFRESH_GATE_MS) return false;

      nk.storageWrite([{
        collection: COL_REFRESH_GATE, key: topic, userId: Constants.SYSTEM_USER_ID,
        value: { last_refresh_ms: nowMs() },
        permissionRead: 0, permissionWrite: 0
      }]);
      return true;
    } catch (_e) { return true; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Full cache refresh pipeline for one topic.
   * Steps: circuit-check → fetch → validate+decode → shuffle+assign → enrich → store.
   * Falls back silently (keeps stale cache) on any error; records failure in circuit breaker.
   */
  export function refreshCache(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string },
    topic:  string,
    force?: boolean
  ): { ok: boolean; topic: string; count: number; error?: string } {

    if (topic === "ai") return { ok: false, topic: topic, count: 0, error: "ai topic is never cached" };

    var ttlMs    = TOPIC_TTL[topic] !== undefined ? TOPIC_TTL[topic] : 24 * 3600000;
    var provider = topicProvider(topic);

    if (circuitIsOpen(nk, provider)) {
      var cbMsg = "circuit open for provider=" + provider + " — skipping refresh";
      logger.warn("[QvQCache/" + topic + "] " + cbMsg +
        " event=circuit_open provider=" + provider + " topic=" + topic);
      return { ok: false, topic: topic, count: 0, error: cbMsg };
    }

    if (!force && !tryAcquireRefreshGate(nk, topic)) {
      logger.info("[QvQCache/" + topic + "] refresh gated — recent refresh in progress or completed" +
        " event=provider_refresh_gated topic=" + topic);
      return { ok: true, topic: topic, count: 0 };
    }

    try {
      // ── Fetch ─────────────────────────────────────────────────────────────
      logger.info("[QvQCache/" + topic + "] fetching from " + provider + "…" +
        " event=provider_fetch_start topic=" + topic + " provider=" + provider);
      var rawList = fetchForTopic(nk, env, logger, topic);
      logger.info("[QvQCache/" + topic + "] fetched " + rawList.length + " raw questions");
      if (rawList.length === 0) throw new Error("Provider returned 0 questions");

      // ── Validate + HTML-decode (bridge approach) ──────────────────────────
      var seenSet: { [k: string]: boolean } = {};
      var passed: RawQuestion[] = [];
      var rejected = 0;
      var topRejectReason: string | null = null;

      for (var qi = 0; qi < rawList.length; qi++) {
        var vr = validateAndDecodeRaw(rawList[qi], seenSet);
        if (!vr.valid) {
          rejected++;
          if (!topRejectReason) topRejectReason = vr.reject_reason;
          continue;
        }
        // Gate passed — add to seen set to catch within-batch duplicates
        seenSet[QvQualityGate.questionDedupeKey(rawList[qi])] = true;
        passed.push(rawList[qi]);
      }

      logger.info("[QvQCache/" + topic + "] gate: " + passed.length + "/" + rawList.length +
        " passed (rejected=" + rejected + ", top_reason=" + topRejectReason + ")");

      if (topic === "dog") {
        var dogBreedSample = 40;
        if (env && env["QV_DOGCEO_BREED_SAMPLE"]) {
          var dogSampleParsed = parseInt(env["QV_DOGCEO_BREED_SAMPLE"], 10);
          if (!isNaN(dogSampleParsed) && dogSampleParsed > 0) dogBreedSample = dogSampleParsed;
        }
        logger.info("[QvQCache/dog] event=provider_gate_summary topic=dog raw_count=" + rawList.length +
          " passed_count=" + passed.length + " breed_sample=" + dogBreedSample + " provider=dogceo");
      }

      if (passed.length === 0) throw new Error("All questions rejected by quality gate. top_reason=" + topRejectReason);

      // ── Shuffle + A/B/C/D + Template Enrich ──────────────────────────────
      var normalized: NormalizedQuestion[] = [];
      for (var ni3 = 0; ni3 < passed.length; ni3++) {
        var raw  = passed[ni3];
        var meta = raw.meta;
        var norm = shuffleAndAssign(raw);
        norm.explanation = enrichExplanation(norm, meta);
        normalized.push(norm);
      }

      // ── Claude 1-sentence enrichment for still-blank explanations ─────────
      claudeEnrichBatch(nk, env, logger, normalized);

      // Cap: max 500 questions total (5 pages × 100) — keeps storage sane
      var capped = normalized.slice(0, MAX_PER_DOC * 5);

      // ── Write cache ───────────────────────────────────────────────────────
      var qStats = {
        total_processed:   rawList.length,
        passed:            passed.length,
        rejected:          rejected,
        top_reject_reason: topRejectReason
      };
      writeCache(nk, logger, topic, capped, provider, qStats, ttlMs);

      recordSuccess(nk, provider);
      logger.info("[QvQCache/" + topic + "] refresh complete — " + capped.length + " stored, TTL=" + (ttlMs / 3600000).toFixed(1) + "h" +
        " event=provider_refresh_done topic=" + topic + " count=" + capped.length + " provider=" + provider);
      return { ok: true, topic: topic, count: capped.length };

    } catch (err: any) {
      var errMsg = err && err.message ? err.message : String(err);
      // Existing cached data (stale or not) is intentionally NOT overwritten —
      // Unity clients keep serving from the last good cache until next refresh.
      logger.error("[QvQCache/" + topic + "] refresh FAILED — keeping stale cache: " + errMsg +
        " event=provider_refresh_failed topic=" + topic + " error=" + errMsg.replace(/\s+/g, "_"));
      recordFailure(nk, provider, errMsg);
      return { ok: false, topic: topic, count: 0, error: errMsg };
    }
  }

  /**
   * Read the full validated pool for a topic (all pages merged).
   * Returns empty array + expired=true on cache miss.
   * Caller decides whether to trigger refreshCache().
   */
  export function readCache(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    topic:  string
  ): { questions: NormalizedQuestion[]; expired: boolean; cached_at_ms: number } {
    var questions: NormalizedQuestion[] = [];
    try {
      var rows = nk.storageRead([{ collection: COL_CACHE + topic, key: "pool_0", userId: "00000000-0000-0000-0000-000000000000" }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        logger.info("[QvQCache/" + topic + "] cache miss event=provider_cache_miss topic=" + topic);
        return { questions: [], expired: true, cached_at_ms: 0 };
      }
      var page0: any      = rows[0].value;
      var pageCount: number = page0.page_count || 1;
      var expiresMs: number = page0.expires_at_ms || 0;
      var cachedMs: number  = page0.cached_at_ms  || 0;
      var expired = expiresMs > 0 ? expiresMs < nowMs() : true;

      if (Array.isArray(page0.questions)) questions = questions.concat(page0.questions);

      if (pageCount > 1) {
        var reqs: nkruntime.StorageReadRequest[] = [];
        for (var p = 1; p < pageCount; p++) reqs.push({ collection: COL_CACHE + topic, key: "pool_" + p, userId: "00000000-0000-0000-0000-000000000000" });
        var extra = nk.storageRead(reqs);
        if (extra) {
          for (var ei = 0; ei < extra.length; ei++) {
            if (extra[ei] && extra[ei].value && Array.isArray(extra[ei].value.questions)) {
              questions = questions.concat(extra[ei].value.questions);
            }
          }
        }
      }
      logger.info("[QvQCache/" + topic + "] read " + questions.length + " questions, expired=" + expired);
      return { questions: questions, expired: expired, cached_at_ms: cachedMs };
    } catch (err: any) {
      logger.error("[QvQCache/" + topic + "] readCache error: " + (err && err.message ? err.message : String(err)));
      return { questions: [], expired: true, cached_at_ms: 0 };
    }
  }

  /**
   * Lightweight freshness check — reads only pool_0 metadata (no questions loaded).
   * Use before readCache to decide whether to trigger a background refresh.
   */
  export function isCacheValid(nk: nkruntime.Nakama, topic: string): boolean {
    try {
      var rows = nk.storageRead([{ collection: COL_CACHE + topic, key: "pool_0", userId: "00000000-0000-0000-0000-000000000000" }]);
      if (!rows || rows.length === 0 || !rows[0].value) return false;
      var doc: any = rows[0].value;
      return doc.expires_at_ms ? doc.expires_at_ms > nowMs() : false;
    } catch (_e) { return false; }
  }

  /**
   * Refresh ALL cacheable topics one-by-one with a 2 s stagger between each.
   * The stagger prevents simultaneous bursts against external providers.
   * Intended for a Nakama scheduled / cron job — NEVER call from a player RPC.
   * Returns an array of per-topic results (same shape as refreshCache).
   */
  export function refreshAllTopics(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    env:    { [k: string]: string }
  ): Array<{ ok: boolean; topic: string; count: number; error?: string }> {
    var topics = Object.keys(TOPIC_TTL).filter(function(t) { return t !== "ai"; });
    var results: Array<{ ok: boolean; topic: string; count: number; error?: string }> = [];
    logger.info("[QvQCache/stagger] starting full refresh — " + topics.length + " topics, 2 s stagger");
    for (var i = 0; i < topics.length; i++) {
      if (i > 0) sleep(2000); // 2 s between topics — keeps provider rate limits healthy
      var r = refreshCache(nk, logger, env, topics[i]);
      results.push(r);
      logger.info(
        "[QvQCache/stagger] " + (i + 1) + "/" + topics.length +
        " — " + topics[i] + " ok=" + r.ok + (r.error ? " err=" + r.error : " count=" + r.count)
      );
    }
    var okCount  = results.filter(function(r) { return r.ok; }).length;
    logger.info("[QvQCache/stagger] done — " + okCount + "/" + topics.length + " succeeded");
    return results;
  }
}
