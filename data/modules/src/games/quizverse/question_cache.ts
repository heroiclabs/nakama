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
//     Dog CEO, Disney, Ghibli, SWAPI, RestCountries
//   Key-gated (env var required): NASA, TMDB, TheSportsDB, Last.fm,
//     GNews/Currents/MediaStack/NewsAPI
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

  var COL_CACHE   = "qv_cache_";        // full key: qv_cache_{topic}
  var COL_CIRCUIT = "qv_circuit_breakers";

  // Per-topic cache TTL (ms)
  var TOPIC_TTL: { [t: string]: number } = {
    opentdb:   1  * 3600000,
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
    daily:     24 * 3600000,
    weekly:    7  * 24 * 3600000,
    ai:        0   // never cached
  };

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
  //   NASA        → https://api.nasa.gov  (already defaults to DEMO_KEY)

  var FALLBACK_KEYS: { [k: string]: string } = {
    TMDB_API_KEY:       "",   // ← paste your TMDB key here
    LASTFM_API_KEY:     "",   // ← paste your Last.fm key here
    GNEWS_API_KEY:      "996c2e560c01a91df9d4a9ddbef0e38e",
    CURRENTS_API_KEY:   "vJ7f8IPcf_vrhpwk2_-wqzVOpFCxHV26zMhKv4NPV_KiXb-r",
    MEDIASTACK_API_KEY: "ec6ef35b59624891e5604efb140adefb",
    NEWSAPI_API_KEY:    "5cbc52d4e9e14df683ed965b04cbf6fb",
    NASA_API_KEY:       "DEMO_KEY"   // safe public fallback (50 req/day)
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
      opentdb: "opentdb", anime: "jikan", pokemon: "pokeapi",
      cocktail: "cocktaildb", food: "themealdb", dog: "dogceo",
      ghibli: "ghibli", disney: "disney", starwars: "swapi",
      countries: "restcountries", flags: "restcountries",
      space: "nasa", movies: "tmdb", sports: "sportsdb",
      music: "lastfm", news: "gnews", daily: "s3", weekly: "s3", ai: "claude"
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
      var rows = nk.storageRead([{ collection: COL_CIRCUIT, key: provider, userId: "" }]);
      if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (_e) {}
    return { state: "closed", fail_count: 0, success_count: 0, trip_count: 0, open_until_ms: 0 };
  }

  function writeCircuit(nk: nkruntime.Nakama, provider: string, doc: any): void {
    try {
      nk.storageWrite([{
        collection: COL_CIRCUIT, key: provider, userId: "",
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
      correct_option_ids: correctIds
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
  function fetchOpentdb(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    // url3986 encoding — decode with decodeURIComponent
    var data = httpGet(nk, "https://opentdb.com/api.php?amount=50&encode=url3986&type=multiple");
    if (!data || !Array.isArray(data.results) || data.response_code !== 0) {
      throw new Error("OpenTDB response_code=" + (data && data.response_code));
    }
    for (var i = 0; i < data.results.length; i++) {
      var item: any = data.results[i];
      try {
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
        results.push({
          provider_key:  djb2(qText),
          topic:         "opentdb",
          lang:          "en",
          question_text: qText,
          question_type: item.type === "boolean" ? "true_false" : "single_select",
          raw_options:   opts,
          has_media:     false,
          media:         null,
          explanation:   decodeURIComponent(item.category || ""),
          difficulty:    diff,
          provider:      "opentdb",
          meta:          {}
        });
      } catch (e: any) { logger.debug("[QvQCache/opentdb] skip[" + i + "]: " + (e && e.message)); }
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
    var sample: any[] = pick(listData.results, 12);  // 12 fetches to stay fast

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
    for (var ci = 0; ci < 20; ci++) {
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
    for (var mi = 0; mi < 20; mi++) {
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
  function fetchDogceo(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
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
    var selected = pick(allBreeds, 10);
    for (var bi = 0; bi < selected.length; bi++) {
      var breedName: string = selected[bi] as string;
      try {
        var parts = breedName.indexOf(" ") !== -1 ? breedName.split(" ") : [breedName];
        var breedKey = parts.length >= 2 ? parts[1] + "/" + parts[0] : parts[0];
        var imgData: any = httpGet(nk, "https://dog.ceo/api/breed/" + breedKey + "/images/random");
        if (!imgData || !imgData.message) continue;
        var exSet3: { [k: string]: boolean } = {};
        exSet3[breedName] = true;
        var wb = pickExcluding(allBreeds, exSet3, 3);
        if (wb.length < 3) continue;
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
      } catch (e: any) { logger.debug("[QvQCache/dogceo] skip " + breedName + ": " + (e && e.message)); }
    }
    return results;
  }

  // ── 7. Studio Ghibli ──────────────────────────────────────────────────────
  function fetchGhibli(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data3: any[] = httpGet(nk, "https://ghibliapi.vercel.app/films");
    if (!Array.isArray(data3)) throw new Error("Ghibli API: no array");
    var directorPool: string[] = [];
    for (var gx2 = 0; gx2 < data3.length; gx2++) {
      if (data3[gx2].director) directorPool.push(data3[gx2].director);
    }
    var extraDirs = ["Akira Kurosawa", "Satoshi Kon", "Mamoru Hosoda", "Makoto Shinkai",
      "Hideaki Anno", "Katsuhiro Otomo", "Yoshiyuki Tomino"];
    var fullDirPool = directorPool.concat(extraDirs);

    for (var gi4 = 0; gi4 < data3.length; gi4++) {
      var film: any = data3[gi4];
      try {
        var ftitle = film.title || "Unknown";
        var fdirector = film.director || null;
        var fyear = film.release_date || null;
        if (!fdirector) continue;
        var exDir: { [k: string]: boolean } = {};
        exDir[fdirector] = true;
        var wd = pickExcluding(fullDirPool, exDir, 3);
        if (wd.length < 3) continue;
        var gOpts2: RawOpt[] = [{ text: fdirector, is_correct: true }];
        for (var wdi = 0; wdi < wd.length; wdi++) gOpts2.push({ text: wd[wdi] as string, is_correct: false });
        results.push({
          provider_key: "ghibli_dir_" + djb2(ftitle),
          topic: "ghibli", lang: "en",
          question_text: "Who directed the Studio Ghibli film \"" + ftitle + "\"?",
          question_type: "single_select",
          raw_options: gOpts2,
          has_media: false, media: null,
          explanation: "\"" + ftitle + "\" (" + (fyear || "?") + ") was directed by " + fdirector + " and produced by Studio Ghibli.",
          difficulty: "medium", provider: "ghibli",
          meta: { title: ftitle, director: fdirector, year: fyear }
        });
      } catch (e: any) { logger.debug("[QvQCache/ghibli] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 8. Disney API ─────────────────────────────────────────────────────────
  function fetchDisney(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data4: any = httpGet(nk, "https://api.disneyapi.dev/character?pageSize=50&page=1");
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

  // ── 10. RestCountries (Countries + Flags) ─────────────────────────────────
  function fetchRestcountries(nk: nkruntime.Nakama, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var data6: any = httpGet(nk, "https://restcountries.com/v3.1/all?fields=name,capital,region,flags,population");
    if (!Array.isArray(data6)) throw new Error("RestCountries: no array");

    var withCap: any[] = [];
    for (var rc = 0; rc < data6.length; rc++) {
      if (data6[rc].capital && data6[rc].capital.length > 0 && data6[rc].name && data6[rc].name.common) {
        withCap.push(data6[rc]);
      }
    }
    var allCaps: string[] = [];
    var allCNames: string[] = [];
    for (var rc2 = 0; rc2 < withCap.length; rc2++) {
      if (withCap[rc2].capital[0]) allCaps.push(withCap[rc2].capital[0]);
      allCNames.push(withCap[rc2].name.common);
    }

    var sample2 = pick(withCap, 40);
    for (var ci3 = 0; ci3 < sample2.length; ci3++) {
      var country: any = sample2[ci3];
      try {
        var cname2 = country.name.common;
        var capital = country.capital[0];
        var region = country.region || "Unknown";
        var flagPng: string | null = (country.flags && country.flags.png) ? country.flags.png : null;

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
          }
        }
      } catch (e: any) { logger.debug("[QvQCache/restcountries] skip " + (country && country.name && country.name.common) + ": " + (e && e.message)); }
    }
    return results;
  }

  // ── 11. NASA APOD (Space) — key-gated; falls back to DEMO_KEY ─────────────
  function fetchNasa(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var apiKey = envKey(env, "NASA_API_KEY") || "DEMO_KEY";
    var data7: any = httpGet(nk, "https://api.nasa.gov/planetary/apod?api_key=" + apiKey + "&count=20&thumbs=true");
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
    for (var li = 0; li < leagues.length; li++) {
      var league = leagues[li];
      try {
        var sdata: any = httpGet(nk, "https://www.thesportsdb.com/api/v1/json/3/lookup_all_teams.php?id=" + league.id);
        if (!sdata || !Array.isArray(sdata.teams)) continue;
        var teams: any[] = sdata.teams.slice(0, 20);
        var stadiums: string[] = [];
        for (var sx = 0; sx < teams.length; sx++) { if (teams[sx].strStadium) stadiums.push(teams[sx].strStadium); }
        for (var ti2 = 0; ti2 < teams.length; ti2++) {
          var team: any = teams[ti2];
          try {
            var tname = team.strTeam || "Unknown";
            var stadium = team.strStadium || null;
            var tbadge: string | null = team.strTeamBadge || null;
            var tfounded = team.intFormedYear || null;
            if (!stadium) continue;
            var exStad: { [k: string]: boolean } = {};
            exStad[stadium] = true;
            var ws2 = pickExcluding(stadiums, exStad, 3);
            if (ws2.length < 3) continue;
            var stOpts: RawOpt[] = [{ text: stadium, is_correct: true }];
            for (var wsi2 = 0; wsi2 < ws2.length; wsi2++) stOpts.push({ text: ws2[wsi2] as string, is_correct: false });
            results.push({
              provider_key: "sdb_stad_" + (team.idTeam || djb2(tname)),
              topic: "sports", lang: "en",
              question_text: "What is the home stadium of " + tname + "?",
              question_type: "single_select",
              raw_options: stOpts,
              has_media: !!tbadge,
              media: tbadge ? { type: "image", url: tbadge, thumbnail_url: null, duration_seconds: null, mime_type: "image/png" } : null,
              explanation: tname + " (" + league.name + ") plays at " + stadium + (tfounded ? ", founded in " + tfounded : "") + ".",
              difficulty: "medium", provider: "sportsdb",
              meta: {}
            });
          } catch (e: any) { logger.debug("[QvQCache/sdb] skip team: " + (e && e.message)); }
        }
      } catch (e: any) { logger.debug("[QvQCache/sdb] skip league " + league.name + ": " + (e && e.message)); }
    }
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

  // ── 15. News — GNews → Currents → MediaStack → NewsAPI failover chain ──────
  function fetchNews(nk: nkruntime.Nakama, env: any, logger: nkruntime.Logger): RawQuestion[] {
    var results: RawQuestion[] = [];
    var articles: any[] = [];
    var gnKey  = envKey(env, "GNEWS_API_KEY");
    var curKey = envKey(env, "CURRENTS_API_KEY");
    var msKey  = envKey(env, "MEDIASTACK_API_KEY");
    var naKey  = envKey(env, "NEWSAPI_API_KEY");

    if (gnKey) {
      try {
        var gd: any = httpGet(nk, "https://gnews.io/api/v4/top-headlines?token=" + gnKey + "&lang=en&max=10");
        if (gd && gd.articles) articles = articles.concat(gd.articles);
      } catch (e: any) { logger.warn("[QvQCache/news] GNews: " + (e && e.message)); }
    }
    if (curKey && articles.length < 10) {
      try {
        var cd: any = httpGet(nk, "https://api.currentsapi.services/v1/latest-news?apiKey=" + curKey + "&language=en");
        if (cd && Array.isArray(cd.news)) {
          for (var cni = 0; cni < cd.news.length; cni++) {
            var cn: any = cd.news[cni];
            articles.push({ title: cn.title, description: cn.description, source: { name: cn.author || "Currents" } });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] Currents: " + (e && e.message)); }
    }
    if (msKey && articles.length < 10) {
      try {
        var md: any = httpGet(nk, "http://api.mediastack.com/v1/news?access_key=" + msKey + "&languages=en&limit=10");
        if (md && Array.isArray(md.data)) {
          for (var mni = 0; mni < md.data.length; mni++) {
            var mn: any = md.data[mni];
            articles.push({ title: mn.title, description: mn.description, source: { name: mn.source || "MediaStack" } });
          }
        }
      } catch (e: any) { logger.warn("[QvQCache/news] MediaStack: " + (e && e.message)); }
    }
    if (naKey && articles.length < 10) {
      try {
        var nd: any = httpGet(nk, "https://newsapi.org/v2/top-headlines?apiKey=" + naKey + "&language=en&pageSize=10");
        if (nd && Array.isArray(nd.articles)) articles = articles.concat(nd.articles);
      } catch (e: any) { logger.warn("[QvQCache/news] NewsAPI: " + (e && e.message)); }
    }
    if (articles.length === 0) throw new Error("All news providers failed or not configured (set at least one of GNEWS_API_KEY, CURRENTS_API_KEY, MEDIASTACK_API_KEY, NEWSAPI_API_KEY)");

    for (var ni2 = 0; ni2 < articles.length; ni2++) {
      var art: any = articles[ni2];
      try {
        var headline = (art.title || "").trim();
        var desc = art.description || "";
        var srcName = art.source && art.source.name ? art.source.name : "News";
        if (!headline || headline.length < 20) continue;
        results.push({
          provider_key: "news_" + djb2(headline),
          topic: "news", lang: "en",
          question_text: "Is this a real news headline: \"" + headline.substring(0, 120) + "\"?",
          question_type: "true_false",
          raw_options: [
            { text: "True — this is a real headline",  is_correct: true },
            { text: "False — this is a fake headline", is_correct: false }
          ],
          has_media: false, media: null,
          explanation: "This headline is from " + srcName + ". " + desc.substring(0, 150),
          difficulty: "easy", provider: "gnews",
          meta: {}
        });
      } catch (e: any) { logger.debug("[QvQCache/news] skip: " + (e && e.message)); }
    }
    return results;
  }

  // ── 16. S3 (daily / weekly) ───────────────────────────────────────────────
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
      case "opentdb":   return fetchOpentdb(nk, logger);
      case "anime":     return fetchJikan(nk, logger);
      case "pokemon":   return fetchPokeapi(nk, logger);
      case "cocktail":  return fetchCocktaildb(nk, logger);
      case "food":      return fetchMealdb(nk, logger);
      case "dog":       return fetchDogceo(nk, logger);
      case "ghibli":    return fetchGhibli(nk, logger);
      case "disney":    return fetchDisney(nk, logger);
      case "starwars":  return fetchSwapi(nk, logger);
      case "countries": {
        var all = fetchRestcountries(nk, logger);
        return all.filter(function(q) { return q.topic === "countries"; });
      }
      case "flags": {
        var all2 = fetchRestcountries(nk, logger);
        return all2.filter(function(q) { return q.topic === "flags"; });
      }
      case "space":    return fetchNasa(nk, env, logger);
      case "movies":   return fetchTmdb(nk, env, logger);
      case "sports":   return fetchSportsdb(nk, logger);
      case "music":    return fetchLastfm(nk, env, logger);
      case "news":     return fetchNews(nk, env, logger);
      case "daily":
      case "weekly":   return fetchS3(nk, env, logger, topic);
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
        userId:          "",
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
    topic:  string
  ): { ok: boolean; topic: string; count: number; error?: string } {

    if (topic === "ai") return { ok: false, topic: topic, count: 0, error: "ai topic is never cached" };

    var ttlMs    = TOPIC_TTL[topic] !== undefined ? TOPIC_TTL[topic] : 24 * 3600000;
    var provider = topicProvider(topic);

    if (circuitIsOpen(nk, provider)) {
      var cbMsg = "circuit open for provider=" + provider + " — skipping refresh";
      logger.warn("[QvQCache/" + topic + "] " + cbMsg);
      return { ok: false, topic: topic, count: 0, error: cbMsg };
    }

    try {
      // ── Fetch ─────────────────────────────────────────────────────────────
      logger.info("[QvQCache/" + topic + "] fetching from " + provider + "…");
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
        seenSet[QvQualityGate.normalizeForDedup(rawList[qi].question_text)] = true;
        passed.push(rawList[qi]);
      }

      logger.info("[QvQCache/" + topic + "] gate: " + passed.length + "/" + rawList.length +
        " passed (rejected=" + rejected + ", top_reason=" + topRejectReason + ")");

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
      logger.info("[QvQCache/" + topic + "] refresh complete — " + capped.length + " stored, TTL=" + (ttlMs / 3600000).toFixed(1) + "h");
      return { ok: true, topic: topic, count: capped.length };

    } catch (err: any) {
      var errMsg = err && err.message ? err.message : String(err);
      // Existing cached data (stale or not) is intentionally NOT overwritten —
      // Unity clients keep serving from the last good cache until next refresh.
      logger.error("[QvQCache/" + topic + "] refresh FAILED — keeping stale cache: " + errMsg);
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
      var rows = nk.storageRead([{ collection: COL_CACHE + topic, key: "pool_0", userId: "" }]);
      if (!rows || rows.length === 0 || !rows[0].value) {
        logger.info("[QvQCache/" + topic + "] cache miss");
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
        for (var p = 1; p < pageCount; p++) reqs.push({ collection: COL_CACHE + topic, key: "pool_" + p, userId: "" });
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
      var rows = nk.storageRead([{ collection: COL_CACHE + topic, key: "pool_0", userId: "" }]);
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
