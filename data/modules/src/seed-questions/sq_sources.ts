// sq_sources.ts
// ─────────────────────────────────────────────────────────────────────────────
// Seed Questions — the 13 content-source connectors.
//
//  #  id             site(s)                              kind        feeds
//  1  archive_org    archive.org                          questions   ImageGuess/WhosThat/MediaQuiz/GeoExplore
//  2  wolfram        wolframalpha.com                     questions   CustomTopic/STEM (auto-verified)
//  3  gutenberg      gutenberg.org (Gutendex API)         questions   literature/history/quote packs
//  4  music_tv       everynoise.com + tunefind.com        questions   MediaQuiz music & TV vertical (+Deezer media)
//  5  removebg       remove.bg                            assets      Plus cosmetics / badges / stickers
//  6  youtube_quiz   summarize.tech (+YouTube oEmbed+LLM) questions   YouTube→quiz pipeline / ViralIQ
//  7  media_optimize squoosh.app (wsrv.nl equivalent)     tooling     QuizMediaService load size (SeedQ.optimizeMediaUrl)
//  8  aso_mockups    smartmockups.com + shots.so          tooling     content-factory ASO/trailer pipeline
//  9  art_cleanup    photopea + cleanup.pictures + unscreen tooling   asset editing / video bg removal
// 10  scholar        semanticscholar.org + openculture.com questions  exam/study packs + E-E-A-T citations
// 11  focus_audio    mynoise/coffitivity/musicforprogramming feature  Focus/Study Mode soundscapes (CC tracks)
// 12  justwatch      justwatch.com                        questions   ViralIQ trending freshness
// 13  tineye         tineye.com                           guardrail   image provenance (SeedQQuality.checkProvenance)
//
// "questions" connectors return SeedQ.SeedQuestion[] via fetchQuestions().
// "assets"/"tooling" connectors return executable job descriptors via
// buildAssetJob() — binary work (PNG cutouts, mockup renders) is delegated to
// content-factory / n8n, since Goja strings cannot safely carry binary.

namespace SeedQSources {

  export interface SourceMeta {
    rank: number;
    id: string;
    site: string;
    kind: string;               // "questions" | "assets" | "tooling" | "feature" | "guardrail"
    modes: string[];
    env_keys: string[];         // optional keys that unlock deeper integration
    implemented: string;        // "live" | "env_gated" | "delegated"
    notes: string;
  }

  export function registry(): SourceMeta[] {
    return [
      { rank: 1, id: "archive_org", site: "archive.org", kind: "questions",
        modes: ["ImageGuess", "WhosThat", "MediaQuiz", "GeoExplore"], env_keys: [],
        implemented: "live",
        notes: "advancedsearch API → public-domain image/media questions; thumbnails via archive.org/services/img" },
      { rank: 2, id: "wolfram", site: "wolframalpha.com", kind: "questions",
        modes: ["CustomTopic", "SpeedQuiz", "BrainSprint"], env_keys: ["WOLFRAM_APP_ID"],
        implemented: "live",
        notes: "template-generated math/STEM, locally computed; WOLFRAM_APP_ID enables Short-Answers auto-verification" },
      { rank: 3, id: "gutenberg", site: "gutenberg.org", kind: "questions",
        modes: ["CustomTopic", "PickATopic"], env_keys: [],
        implemented: "live",
        notes: "Gutendex API → author/work attribution questions, 100% public domain" },
      { rank: 4, id: "music_tv", site: "everynoise.com + tunefind.com", kind: "questions",
        modes: ["MediaQuiz", "AudioQuiz", "ViralIQ"], env_keys: ["TUNEFIND_API_KEY"],
        implemented: "live",
        notes: "everynoise genre taxonomy (embedded) + Deezer charts for artist/track questions; tunefind song↔show mapping is partnership-key gated" },
      { rank: 5, id: "removebg", site: "remove.bg", kind: "assets",
        modes: ["cosmetics", "badges", "stickers"], env_keys: ["REMOVE_BG_API_KEY"],
        implemented: "delegated",
        notes: "sticker/cosmetic cutout factory — job descriptor executed by content-factory/n8n (binary-safe)" },
      { rank: 6, id: "youtube_quiz", site: "summarize.tech", kind: "questions",
        modes: ["ViralIQ", "VideoQuiz", "CustomTopic"], env_keys: ["SUMMARIZE_TECH_URL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
        implemented: "live",
        notes: "YouTube oEmbed metadata + caller-provided summary/transcript → LLM question gen; SUMMARIZE_TECH_URL proxy optional" },
      { rank: 7, id: "media_optimize", site: "squoosh.app", kind: "tooling",
        modes: ["*"], env_keys: [],
        implemented: "live",
        notes: "every staged image is rewritten through wsrv.nl (resize+webp) — squoosh-equivalent compression at serve time" },
      { rank: 8, id: "aso_mockups", site: "smartmockups.com + shots.so", kind: "tooling",
        modes: ["marketing"], env_keys: [],
        implemented: "delegated",
        notes: "store-screenshot/mockup job descriptors for the content-factory ASO pipeline" },
      { rank: 9, id: "art_cleanup", site: "photopea.com + cleanup.pictures + unscreen.com", kind: "tooling",
        modes: ["assets"], env_keys: [],
        implemented: "delegated",
        notes: "photopea scripting payloads + cleanup/unscreen job descriptors for source-art cleanup" },
      { rank: 10, id: "scholar", site: "semanticscholar.org + openculture.com", kind: "questions",
        modes: ["CustomTopic", "SubjectiveQuiz"], env_keys: [],
        implemented: "live",
        notes: "Graph API paper search → exam-prep questions with citations (E-E-A-T / CITATIONS.md fuel)" },
      { rank: 11, id: "focus_audio", site: "mynoise.net / coffitivity / musicforprogramming", kind: "feature",
        modes: ["FocusMode"], env_keys: [],
        implemented: "live",
        notes: "CC-licensed ambient tracks from musicforprogramming RSS for Focus/Study Mode (mynoise/coffitivity as licensed-pattern references only)" },
      { rank: 12, id: "justwatch", site: "justwatch.com", kind: "questions",
        modes: ["ViralIQ"], env_keys: [],
        implemented: "live",
        notes: "popular-titles feed → trending film/show questions + sq_trending freshness signal for ViralIQ packs" },
      { rank: 13, id: "tineye", site: "tineye.com", kind: "guardrail",
        modes: ["*media*"], env_keys: ["TINEYE_API_KEY"],
        implemented: "live",
        notes: "image provenance check before media questions ship — TinEye API when keyed, public-domain domain whitelist otherwise" }
    ];
  }

  // ── shared builders ─────────────────────────────────────────────────────────
  function baseQuestion(nk: nkruntime.Nakama, source: string, mode: string, topic: string): SeedQ.SeedQuestion {
    return {
      id: "", question: "", options: [], correct_index: 0, explanation: "",
      category: topic, topic: topic, mode: mode, difficulty: 3,
      question_type: "Text", media_url: "", media_provenance: null,
      source: source, citation: "", lang: "en",
      created_ms: SeedQ.nowMs(),
      quality: { score: 0, status: "pending", checks: [] }
    };
  }

  function finalize(nk: nkruntime.Nakama, q: SeedQ.SeedQuestion): SeedQ.SeedQuestion {
    // Shuffle options while tracking the correct answer.
    var correctText = q.options[q.correct_index];
    SeedQ.shuffle(q.options);
    q.correct_index = q.options.indexOf(correctText);
    q.id = SeedQ.questionId(nk, q.source, q.question, q.options);
    return q;
  }

  function pickDistractors(all: string[], correct: string, n: number): string[] {
    var pool: string[] = [];
    var seen: { [k: string]: boolean } = {};
    seen[("" + correct).toLowerCase()] = true;
    for (var i = 0; i < all.length; i++) {
      var v = "" + (all[i] || "");
      var lower = v.toLowerCase();
      if (!v || seen[lower]) continue;
      seen[lower] = true;
      pool.push(v);
    }
    SeedQ.shuffle(pool);
    return pool.slice(0, n);
  }

  // ── #1 archive.org ──────────────────────────────────────────────────────────
  export function fetchArchiveOrg(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    var query = 'mediatype:image AND subject:("' + topic.replace(/"/g, "") + '")';
    var url = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent(query) +
      "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=creator&rows=50&page=1&output=json";
    var body = SeedQ.cachedHttpGet(nk, logger, url, 6 * 3600 * 1000);
    if (!body) return [];

    var docs: any[] = [];
    try {
      var parsed = JSON.parse(body);
      docs = (parsed && parsed.response && parsed.response.docs) || [];
    } catch (e) { return []; }

    var titles: string[] = [];
    var creators: string[] = [];
    for (var i = 0; i < docs.length; i++) {
      if (docs[i] && docs[i].title) titles.push("" + docs[i].title);
      var cr = docs[i] && docs[i].creator;
      if (cr) creators.push("" + (cr.length !== undefined && typeof cr !== "string" ? cr[0] : cr));
    }

    var out: SeedQ.SeedQuestion[] = [];
    for (var d = 0; d < docs.length && out.length < count; d++) {
      var doc = docs[d];
      if (!doc || !doc.identifier || !doc.title) continue;
      var title = ("" + doc.title).substring(0, 110);
      var imgUrl = "https://archive.org/services/img/" + encodeURIComponent(doc.identifier);

      // Image identification question (ImageGuess / WhosThat / MediaQuiz / GeoExplore)
      var distract = pickDistractors(titles, title, 3);
      if (distract.length === 3) {
        var q = baseQuestion(nk, "archive_org", mode, topic);
        q.question = "This image comes from the public-domain archives. What is it titled?";
        q.options = [title].concat(distract);
        q.correct_index = 0;
        q.question_type = "Image";
        q.media_url = imgUrl;
        q.media_provenance = { source_domain: "archive.org", license: "public_domain", checked: true, method: "domain_whitelist" };
        q.citation = "Internet Archive — archive.org/details/" + doc.identifier;
        q.explanation = "From the Internet Archive collection (" + doc.identifier + ").";
        q.difficulty = 3;
        out.push(finalize(nk, q));
      }

      // Creator question (WhosThat flavor) when we know the creator.
      var creator = doc.creator ? ("" + (typeof doc.creator === "string" ? doc.creator : doc.creator[0])) : "";
      if (creator && out.length < count) {
        var cDistract = pickDistractors(creators, creator, 3);
        if (cDistract.length === 3) {
          var q2 = baseQuestion(nk, "archive_org", mode, topic);
          q2.question = "Who created '" + title + "'?";
          q2.options = [creator].concat(cDistract);
          q2.correct_index = 0;
          q2.question_type = "Image";
          q2.media_url = imgUrl;
          q2.media_provenance = { source_domain: "archive.org", license: "public_domain", checked: true, method: "domain_whitelist" };
          q2.citation = "Internet Archive — archive.org/details/" + doc.identifier;
          q2.difficulty = 4;
          out.push(finalize(nk, q2));
        }
      }
    }
    return out;
  }

  // ── #2 wolframalpha.com ─────────────────────────────────────────────────────
  // Math/STEM questions are generated from templates with locally computed
  // answers, then (when WOLFRAM_APP_ID is set) cross-verified against the
  // Wolfram|Alpha Short Answers API. Verified items carry "wolfram_verified".
  var WOLFRAM_VERIFY_BUDGET = 5; // API calls per ingest batch

  function numericDistractors(answer: number): string[] {
    var deltas = [answer + 1, answer - 1, answer + 2, answer - 2, answer + 10, answer - 10,
      Math.round(answer * 1.1), Math.round(answer * 0.9), answer + 5, answer - 5];
    var out: string[] = [];
    var seen: { [k: string]: boolean } = {};
    seen["" + answer] = true;
    for (var i = 0; i < deltas.length && out.length < 3; i++) {
      var v = "" + deltas[i];
      if (!seen[v]) { seen[v] = true; out.push(v); }
    }
    return out;
  }

  export function fetchWolfram(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    var appId = "" + ((ctx.env && ctx.env["WOLFRAM_APP_ID"]) || "");
    var verifyBudget = appId ? WOLFRAM_VERIFY_BUDGET : 0;
    var out: SeedQ.SeedQuestion[] = [];

    function rnd(lo: number, hi: number): number {
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    }

    for (var i = 0; i < count; i++) {
      var kind = i % 5;
      var text = "", answer = 0, wolframQuery = "", difficulty = 2, explanation = "";

      if (kind === 0) {            // arithmetic
        var a = rnd(12, 99), b = rnd(12, 99);
        answer = a * b;
        text = "What is " + a + " × " + b + "?";
        wolframQuery = a + " * " + b;
        difficulty = 2;
        explanation = a + " × " + b + " = " + answer + ".";
      } else if (kind === 1) {     // percent
        var pct = rnd(1, 19) * 5, base = rnd(4, 40) * 10;
        answer = Math.round(base * pct / 100);
        text = "What is " + pct + "% of " + base + "?";
        wolframQuery = pct + "% of " + base;
        difficulty = 3;
        explanation = pct + "% of " + base + " = " + base + " × " + (pct / 100) + " = " + answer + ".";
      } else if (kind === 2) {     // linear equation
        var m = rnd(2, 12), x = rnd(2, 20), c = rnd(1, 30);
        answer = x;
        text = "Solve for x:  " + m + "x + " + c + " = " + (m * x + c);
        wolframQuery = "solve " + m + "x + " + c + " = " + (m * x + c) + " for x";
        difficulty = 3;
        explanation = m + "x = " + (m * x) + ", so x = " + x + ".";
      } else if (kind === 3) {     // squares
        var s = rnd(11, 29);
        answer = s * s;
        text = "What is " + s + "²?";
        wolframQuery = s + "^2";
        difficulty = 3;
        explanation = s + " × " + s + " = " + answer + ".";
      } else {                     // remainder
        var n1 = rnd(100, 999), n2 = rnd(7, 24);
        answer = n1 % n2;
        text = "What is the remainder when " + n1 + " is divided by " + n2 + "?";
        wolframQuery = n1 + " mod " + n2;
        difficulty = 4;
        explanation = n1 + " = " + Math.floor(n1 / n2) + " × " + n2 + " + " + answer + ".";
      }

      var checks: string[] = ["template_computed"];
      if (verifyBudget > 0) {
        verifyBudget--;
        try {
          var vurl = "https://api.wolframalpha.com/v1/result?appid=" + encodeURIComponent(appId) +
            "&i=" + encodeURIComponent(wolframQuery);
          var resp = nk.httpRequest(vurl, "get", {}, "", 8000);
          if (resp.code >= 200 && resp.code < 300) {
            var m2 = /-?\d+/.exec(resp.body || "");
            if (m2 && parseInt(m2[0], 10) === answer) {
              checks.push("wolfram_verified");
            } else {
              logger.warn("[SeedQ] wolfram verify mismatch for '" + wolframQuery + "' — dropping question");
              continue; // verification failed → never ship it
            }
          }
        } catch (e) { /* verification unavailable → keep template_computed */ }
      }

      var q = baseQuestion(nk, "wolfram", mode, topic || "math");
      q.question = text;
      q.options = ["" + answer].concat(numericDistractors(answer));
      q.correct_index = 0;
      q.explanation = explanation;
      q.difficulty = difficulty;
      q.citation = "Computationally generated; verification via Wolfram|Alpha Short Answers API";
      q.quality.checks = checks;
      if (q.options.length === 4) out.push(finalize(nk, q));
    }
    return out;
  }

  // ── #3 gutenberg.org (Gutendex) ─────────────────────────────────────────────
  export function fetchGutenberg(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    var url = "https://gutendex.com/books?languages=en&topic=" + encodeURIComponent(topic);
    var body = SeedQ.cachedHttpGet(nk, logger, url, 24 * 3600 * 1000);
    if (!body) return [];

    var results: any[] = [];
    try { results = JSON.parse(body).results || []; } catch (e) { return []; }

    var authors: string[] = [];
    var titles: string[] = [];
    for (var i = 0; i < results.length; i++) {
      var b = results[i];
      if (b && b.title) titles.push(("" + b.title).substring(0, 90));
      if (b && b.authors && b.authors.length > 0 && b.authors[0].name) {
        // Gutendex names are "Last, First" — flip for display.
        var parts = ("" + b.authors[0].name).split(", ");
        authors.push(parts.length === 2 ? parts[1] + " " + parts[0] : parts[0]);
      }
    }

    var out: SeedQ.SeedQuestion[] = [];
    for (var r = 0; r < results.length && out.length < count; r++) {
      var book = results[r];
      if (!book || !book.title || !book.authors || book.authors.length === 0 || !book.authors[0].name) continue;
      var title2 = ("" + book.title).substring(0, 90);
      var np = ("" + book.authors[0].name).split(", ");
      var author = np.length === 2 ? np[1] + " " + np[0] : np[0];

      var distract = pickDistractors(authors, author, 3);
      if (distract.length < 3) continue;

      var q = baseQuestion(nk, "gutenberg", mode, topic || "literature");
      q.question = "Who wrote '" + title2 + "'?";
      q.options = [author].concat(distract);
      q.correct_index = 0;
      q.difficulty = 3;
      q.citation = "Project Gutenberg — gutenberg.org/ebooks/" + book.id;
      q.explanation = "'" + title2 + "' is a public-domain work by " + author + " on Project Gutenberg.";
      out.push(finalize(nk, q));

      // Author's birth year question when known (history flavor).
      var by = book.authors[0].birth_year;
      if (by && out.length < count) {
        var q2 = baseQuestion(nk, "gutenberg", mode, topic || "literature");
        q2.question = "In which year was " + author + ", author of '" + title2 + "', born?";
        q2.options = ["" + by].concat(numericDistractors(by).map(function (v) { return v; }));
        q2.correct_index = 0;
        q2.difficulty = 4;
        q2.citation = "Project Gutenberg — gutenberg.org/ebooks/" + book.id;
        if (q2.options.length === 4) out.push(finalize(nk, q2));
      }
    }
    return out;
  }

  // ── #4 everynoise + tunefind (music & TV vertical) ─────────────────────────
  // Genre taxonomy sampled from Every Noise at Once; Deezer charts provide
  // artist/track/cover media (free API, no key — same ToS basis as the
  // existing quizverse_music_quiz module). Tunefind song↔show mapping is
  // partnership-gated behind TUNEFIND_API_KEY.
  var EVERYNOISE_GENRES = [
    "vaporwave", "shoegaze", "afrobeats", "k-pop", "city pop", "drill",
    "synthwave", "bossa nova", "grime", "cumbia", "zydeco", "math rock",
    "trip hop", "delta blues", "dream pop", "post-punk", "hyperpop",
    "lo-fi beats", "reggaeton", "americana", "eurodance", "dark ambient",
    "chiptune", "bluegrass", "j-rock", "highlife", "klezmer", "phonk",
    "italo disco", "dub techno", "neo soul", "gqom", "acid jazz", "sludge metal"
  ];
  var FAKE_GENRE_ADJ = ["quantum", "velvet", "arctic", "plastic", "midnight", "neon", "hollow", "crimson"];
  var FAKE_GENRE_NOUN = ["polka-core", "swampwave", "yodel-hop", "fog jazz", "sprintstep", "mothcore", "gravel soul", "drift folk"];

  export function fetchMusicTv(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    var out: SeedQ.SeedQuestion[] = [];

    // Deezer chart → "who performs this track?" with album-art media.
    var body = SeedQ.cachedHttpGet(nk, logger, "https://api.deezer.com/chart/0/tracks?limit=50", 12 * 3600 * 1000);
    if (body) {
      var tracks: any[] = [];
      try { tracks = JSON.parse(body).data || []; } catch (e) { tracks = []; }
      var artists: string[] = [];
      for (var i = 0; i < tracks.length; i++) {
        if (tracks[i] && tracks[i].artist && tracks[i].artist.name) artists.push("" + tracks[i].artist.name);
      }
      for (var t = 0; t < tracks.length && out.length < Math.ceil(count * 0.7); t++) {
        var tr = tracks[t];
        if (!tr || !tr.title || !tr.artist || !tr.artist.name) continue;
        var artist = "" + tr.artist.name;
        var distract = pickDistractors(artists, artist, 3);
        if (distract.length < 3) continue;

        var q = baseQuestion(nk, "music_tv", mode, topic || "music");
        q.question = "Which artist performs '" + ("" + tr.title).substring(0, 80) + "'?";
        q.options = [artist].concat(distract);
        q.correct_index = 0;
        q.difficulty = 2;
        if (tr.album && tr.album.cover_medium) {
          q.question_type = "Image";
          q.media_url = "" + tr.album.cover_medium;
          q.media_provenance = { source_domain: "dzcdn.net", license: "api_tos", checked: true, method: "domain_whitelist" };
        }
        q.citation = "Deezer charts (genre taxonomy: Every Noise at Once)";
        out.push(finalize(nk, q));
      }
    }

    // Every Noise taxonomy → real-vs-invented genre questions.
    var genres = EVERYNOISE_GENRES.slice(0);
    SeedQ.shuffle(genres);
    for (var g = 0; g < genres.length && out.length < count; g++) {
      var real = genres[g];
      var fakes: string[] = [];
      var used: { [k: string]: boolean } = {};
      while (fakes.length < 3) {
        var f = FAKE_GENRE_ADJ[Math.floor(Math.random() * FAKE_GENRE_ADJ.length)] + " " +
          FAKE_GENRE_NOUN[Math.floor(Math.random() * FAKE_GENRE_NOUN.length)];
        if (!used[f]) { used[f] = true; fakes.push(f); }
      }
      var q2 = baseQuestion(nk, "music_tv", mode, topic || "music");
      q2.question = "Which of these is a real music genre catalogued on Every Noise at Once?";
      q2.options = [real].concat(fakes);
      q2.correct_index = 0;
      q2.difficulty = 3;
      q2.citation = "Every Noise at Once — everynoise.com";
      q2.explanation = "'" + real + "' is a real genre mapped by Every Noise at Once; the others are invented.";
      out.push(finalize(nk, q2));
    }

    return out;
  }

  // ── #6 summarize.tech / YouTube → quiz ──────────────────────────────────────
  function llmGenerateQuestions(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, sourceText: string, topic: string, mode: string, count: number): SeedQ.SeedQuestion[] {
    var prompt = "Generate exactly " + count + " multiple-choice quiz questions from the following content.\n" +
      "Return ONLY a JSON array, no prose, no code fences. Each item:\n" +
      '{"question":"...","options":["a","b","c","d"],"correct_index":0,"explanation":"...","difficulty":1-5}\n' +
      "Rules: 4 distinct options; unambiguous single correct answer; never include the answer text inside the question.\n\nCONTENT:\n" +
      sourceText.substring(0, 6000);

    var raw = "";
    var anthropicKey = "" + ((ctx.env && ctx.env["ANTHROPIC_API_KEY"]) || "");
    var openaiKey = "" + ((ctx.env && ctx.env["OPENAI_API_KEY"]) || "");

    if (anthropicKey) {
      try {
        var resp = nk.httpRequest("https://api.anthropic.com/v1/messages", "post", {
          "content-type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01"
        }, JSON.stringify({
          model: "claude-3-5-haiku-latest",
          max_tokens: 3000,
          messages: [{ role: "user", content: prompt }]
        }), 20000);
        if (resp.code >= 200 && resp.code < 300) {
          var pb = JSON.parse(resp.body || "{}");
          raw = (pb.content && pb.content[0] && pb.content[0].text) || "";
        } else {
          logger.warn("[SeedQ] anthropic gen HTTP " + resp.code + " (check ANTHROPIC_API_KEY)");
        }
      } catch (e: any) {
        logger.warn("[SeedQ] anthropic gen failed: " + (e && e.message ? e.message : String(e)));
      }
    }
    if (!raw && openaiKey) {
      try {
        var resp2 = nk.httpRequest("https://api.openai.com/v1/chat/completions", "post", {
          "content-type": "application/json",
          "authorization": "Bearer " + openaiKey
        }, JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.4
        }), 20000);
        if (resp2.code >= 200 && resp2.code < 300) {
          var pb2 = JSON.parse(resp2.body || "{}");
          raw = (pb2.choices && pb2.choices[0] && pb2.choices[0].message && pb2.choices[0].message.content) || "";
        } else {
          logger.warn("[SeedQ] openai gen HTTP " + resp2.code + " (check OPENAI_API_KEY)");
        }
      } catch (e2: any) {
        logger.warn("[SeedQ] openai gen failed: " + (e2 && e2.message ? e2.message : String(e2)));
      }
    }
    if (!raw) return [];

    // Strip code fences and grab the outermost JSON array.
    raw = raw.replace(/```json/gi, "").replace(/```/g, "");
    var start = raw.indexOf("["), end = raw.lastIndexOf("]");
    if (start < 0 || end <= start) return [];

    var items: any[] = [];
    try { items = JSON.parse(raw.substring(start, end + 1)); } catch (e3) { return []; }

    var out: SeedQ.SeedQuestion[] = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.question || !it.options || it.options.length !== 4) continue;
      var q = baseQuestion(nk, "youtube_quiz", mode, topic);
      q.question = "" + it.question;
      q.options = [];
      for (var o = 0; o < 4; o++) q.options.push("" + it.options[o]);
      q.correct_index = SeedQ.clampInt(it.correct_index, 0, 3, 0);
      q.explanation = "" + (it.explanation || "");
      q.difficulty = SeedQ.clampInt(it.difficulty, 1, 5, 3);
      q.quality.checks = ["llm_generated"];
      out.push(finalize(nk, q));
    }
    return out;
  }

  export function fetchYoutubeQuiz(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number, params: any): SeedQ.SeedQuestion[] {
    params = params || {};
    var videoUrl = "" + (params.video_url || "");
    var basis = "" + (params.summary || params.transcript || "");
    var title = "", channel = "";

    if (videoUrl) {
      var oembed = SeedQ.cachedHttpGet(nk, logger,
        "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent(videoUrl), 24 * 3600 * 1000);
      if (oembed) {
        try {
          var meta = JSON.parse(oembed);
          title = "" + (meta.title || "");
          channel = "" + (meta.author_name || "");
        } catch (e) { /* ignore */ }
      }
      // Optional summarize.tech-style proxy (self-hosted; no public API exists).
      var sumUrl = "" + ((ctx.env && ctx.env["SUMMARIZE_TECH_URL"]) || "");
      if (!basis && sumUrl) {
        var sum = SeedQ.cachedHttpGet(nk, logger, sumUrl + encodeURIComponent(videoUrl), 24 * 3600 * 1000);
        if (sum) basis = sum.substring(0, 8000);
      }
    }

    if (!basis && title) basis = "Video: '" + title + "' by channel '" + channel + "'. Topic: " + topic + ".";
    if (!basis) return [];

    var out = llmGenerateQuestions(ctx, nk, logger, basis, topic || title || "video", mode, count);
    for (var i = 0; i < out.length; i++) {
      out[i].citation = videoUrl ? ("YouTube — " + videoUrl + (title ? " ('" + title + "')" : "")) : out[i].citation;
    }
    return out;
  }

  // ── #10 semanticscholar.org + openculture.com ──────────────────────────────
  export function fetchScholar(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    var url = "https://api.semanticscholar.org/graph/v1/paper/search?query=" + encodeURIComponent(topic) +
      "&fields=title,year,authors,venue&limit=25";
    var body = SeedQ.cachedHttpGet(nk, logger, url, 24 * 3600 * 1000);
    if (!body) return [];

    var papers: any[] = [];
    try { papers = JSON.parse(body).data || []; } catch (e) { return []; }

    var authorNames: string[] = [];
    for (var i = 0; i < papers.length; i++) {
      var au = papers[i] && papers[i].authors;
      if (au && au.length > 0 && au[0].name) authorNames.push("" + au[0].name);
    }

    var out: SeedQ.SeedQuestion[] = [];
    for (var p = 0; p < papers.length && out.length < count; p++) {
      var paper = papers[p];
      if (!paper || !paper.title || !paper.year) continue;
      var title = ("" + paper.title).substring(0, 110);
      var citation = "Semantic Scholar: \"" + title + "\" (" + paper.year + ")" +
        (paper.venue ? ", " + paper.venue : "") + " — semanticscholar.org (see also openculture.com)";

      // Publication-year question.
      var yq = baseQuestion(nk, "scholar", mode, topic);
      yq.question = "In which year was the research paper '" + title + "' published?";
      yq.options = ["" + paper.year].concat(numericDistractors(paper.year));
      yq.correct_index = 0;
      yq.difficulty = 4;
      yq.citation = citation;
      if (yq.options.length === 4) out.push(finalize(nk, yq));

      // First-author question when we have enough distractor authors.
      var firstAuthor = (paper.authors && paper.authors.length > 0 && paper.authors[0].name) ? "" + paper.authors[0].name : "";
      if (firstAuthor && out.length < count) {
        var distract = pickDistractors(authorNames, firstAuthor, 3);
        if (distract.length === 3) {
          var aq = baseQuestion(nk, "scholar", mode, topic);
          aq.question = "Who is the first author of the paper '" + title + "'?";
          aq.options = [firstAuthor].concat(distract);
          aq.correct_index = 0;
          aq.difficulty = 5;
          aq.citation = citation;
          out.push(finalize(nk, aq));
        }
      }
    }
    return out;
  }

  // ── #12 justwatch.com (ViralIQ freshness) ───────────────────────────────────
  export function fetchJustWatch(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, mode: string, topic: string, count: number): SeedQ.SeedQuestion[] {
    // JustWatch retired the legacy REST popular-titles endpoint; the public
    // GraphQL endpoint serves the same data.
    var gql = "query($country:Country!,$language:Language!,$first:Int!){" +
      "popularTitles(country:$country,first:$first){edges{node{" +
      "... on MovieOrShow{objectType content(country:$country,language:$language){title originalReleaseYear}}}}}}";
    var reqBody = JSON.stringify({ query: gql, variables: { country: "US", language: "en", first: 40 } });

    // 12h cache keyed on the request signature (POST — cachedHttpGet is GET-only).
    var cacheKey = "post:" + nk.sha256Hash("justwatch_popular_v1").substring(0, 24);
    var cached = SeedQ.readSystem(nk, SeedQ.COLL_SOURCE_CACHE, cacheKey);
    var body: string | null = null;
    if (cached && cached.body && (SeedQ.nowMs() - (cached.fetched_ms || 0)) < 12 * 3600 * 1000) {
      body = cached.body;
    } else {
      try {
        var resp = nk.httpRequest("https://apis.justwatch.com/graphql", "post",
          { "Content-Type": "application/json", "User-Agent": "quizverse-seedq/1.0" }, reqBody, 15000);
        if (resp.code >= 200 && resp.code < 300 && resp.body) {
          body = resp.body;
          SeedQ.writeSystem(nk, SeedQ.COLL_SOURCE_CACHE, cacheKey, { fetched_ms: SeedQ.nowMs(), body: body });
        } else {
          logger.warn("[SeedQ] justwatch graphql -> " + resp.code);
        }
      } catch (err: any) {
        logger.warn("[SeedQ] justwatch graphql failed: " + (err && err.message ? err.message : String(err)));
      }
      if (!body && cached && cached.body) body = cached.body; // stale fallback
    }
    if (!body) return [];

    var items: any[] = [];
    try {
      var edges = JSON.parse(body).data.popularTitles.edges || [];
      for (var e = 0; e < edges.length; e++) {
        var node = edges[e] && edges[e].node;
        if (node && node.content && node.content.title) {
          items.push({
            title: node.content.title,
            original_release_year: node.content.originalReleaseYear,
            object_type: ("" + (node.objectType || "")).toLowerCase() === "show" ? "show" : "movie"
          });
        }
      }
    } catch (e2) { return []; }
    if (items.length === 0) return [];

    // Freshness signal for ViralIQ packs — consumed by the client/live-ops.
    var trendingTitles: string[] = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i] && items[i].title) trendingTitles.push("" + items[i].title);
    }
    SeedQ.writeSystem(nk, SeedQ.COLL_SOURCE_CACHE, "sq_trending", {
      fetched_ms: SeedQ.nowMs(), titles: trendingTitles.slice(0, 40), source: "justwatch.com"
    });

    var out: SeedQ.SeedQuestion[] = [];
    for (var t = 0; t < items.length && out.length < count; t++) {
      var it = items[t];
      if (!it || !it.title || !it.original_release_year) continue;
      var title = ("" + it.title).substring(0, 90);

      var q = baseQuestion(nk, "justwatch", mode, topic || "trending");
      q.question = "'" + title + "' is trending right now. In which year was it originally released?";
      q.options = ["" + it.original_release_year].concat(numericDistractors(it.original_release_year));
      q.correct_index = 0;
      q.difficulty = 2;
      q.citation = "JustWatch popular titles — justwatch.com";
      q.explanation = "'" + title + "' (" + (it.object_type === "show" ? "series" : "film") + ", " + it.original_release_year + ") is on the current JustWatch popularity chart.";
      if (q.options.length === 4) out.push(finalize(nk, q));
    }
    return out;
  }

  // ── #11 Focus/Study Mode soundscapes ────────────────────────────────────────
  // CC-licensed long-form ambient mixes from the musicforprogramming RSS feed.
  // mynoise.net / coffitivity are referenced as the UX pattern — their audio
  // is NOT redistributed (licensing), which is exactly the caveat in the plan.
  export function getFocusTracks(nk: nkruntime.Nakama, logger: nkruntime.Logger): any {
    var doc = SeedQ.readSystem(nk, SeedQ.COLL_FOCUS_TRACKS, "tracks");
    if (doc && doc.tracks && doc.tracks.length > 0 && (SeedQ.nowMs() - (doc.fetched_ms || 0)) < 7 * 86400 * 1000) {
      return doc;
    }

    var tracks: any[] = [];
    var body = SeedQ.cachedHttpGet(nk, logger, "https://musicforprogramming.net/rss.xml", 24 * 3600 * 1000, { "Accept": "application/rss+xml" });
    if (body) {
      // <item><title>…</title> … <enclosure url="…"/></item>
      var itemRe = /<item>([\s\S]*?)<\/item>/g;
      var m: any;
      while ((m = itemRe.exec(body)) !== null && tracks.length < 20) {
        var chunk = m[1];
        var tm = /<title>([^<]+)<\/title>/.exec(chunk);
        var em = /<enclosure[^>]*url="([^"]+)"/.exec(chunk);
        if (tm && em) {
          tracks.push({
            title: tm[1],
            url: em[1],
            source: "musicforprogramming.net",
            license: "CC — attribution required",
            kind: "ambient_mix"
          });
        }
      }
    }

    var out = {
      fetched_ms: SeedQ.nowMs(),
      tracks: tracks,
      pattern_references: [
        { site: "mynoise.net", note: "soundscape-blend UX pattern reference only — do not redistribute audio" },
        { site: "coffitivity.com", note: "ambient-cafe UX pattern reference only — do not redistribute audio" }
      ]
    };
    if (tracks.length > 0) SeedQ.writeSystem(nk, SeedQ.COLL_FOCUS_TRACKS, "tracks", out);
    return out;
  }

  // ── #5 / #8 / #9 asset-factory job descriptors ──────────────────────────────
  // Binary pipelines (PNG cutouts, mockup renders, video bg removal) run in
  // content-factory / n8n; Nakama emits ready-to-execute job descriptors so
  // API keys and parameters live in ONE audited place.
  export function buildAssetJob(ctx: nkruntime.Context, kind: string, params: any): any {
    params = params || {};
    if (kind === "removebg") {
      var key = "" + ((ctx.env && ctx.env["REMOVE_BG_API_KEY"]) || "");
      return {
        ok: true,
        job: {
          connector: "removebg",
          purpose: "" + (params.purpose || "plus_cosmetics"), // plus_cosmetics | badges | stickers | imageguess_cleanup
          request: {
            endpoint: "https://api.remove.bg/v1.0/removebg",
            method: "POST",
            headers: { "X-Api-Key": key ? "<REMOVE_BG_API_KEY set>" : "<MISSING — set REMOVE_BG_API_KEY>" },
            form: { image_url: "" + (params.image_url || ""), size: "auto", format: "png" }
          },
          output: { upload_to: "s3://" + ((ctx.env && ctx.env["AWS_S3_BUCKET"]) || "<AWS_S3_BUCKET>") + "/quiz-verse/cosmetics/" },
          key_present: !!key
        }
      };
    }
    if (kind === "aso_mockups") {
      return {
        ok: true,
        job: {
          connector: "aso_mockups",
          purpose: "store_screenshots",
          steps: [
            { tool: "smartmockups.com", action: "device-frame raw screenshots", inputs: params.screenshot_urls || [] },
            { tool: "shots.so", action: "compose gradient/branded store shots", inputs: params.screenshot_urls || [] },
            { tool: "content-factory", action: "assemble ASO set (6.5in + 5.5in + tablet) and push to App Store Connect / Play Console pipeline" }
          ],
          notes: "manual/browser tools — no public APIs; executed by the marketing content-factory run"
        }
      };
    }
    if (kind === "art_cleanup") {
      return {
        ok: true,
        job: {
          connector: "art_cleanup",
          purpose: "" + (params.purpose || "imageguess_source_art"),
          steps: [
            {
              tool: "photopea.com", action: "scripted edit",
              script: 'app.open("' + ("" + (params.image_url || "")) + '"); /* crop/levels */ app.activeDocument.saveToOE("png");'
            },
            { tool: "cleanup.pictures", action: "erase watermarks/objects", input: "" + (params.image_url || "") },
            { tool: "unscreen.com", action: "video background removal (AIHost/AIFortuneTeller/trailer clips)", input: "" + (params.video_url || "") }
          ],
          output: { upload_to: "s3://" + ((ctx.env && ctx.env["AWS_S3_BUCKET"]) || "<AWS_S3_BUCKET>") + "/quiz-verse/cleaned/" }
        }
      };
    }
    return { ok: false, error: "unknown asset job kind: " + kind + " (expected removebg | aso_mockups | art_cleanup)" };
  }

  // ── dispatcher ──────────────────────────────────────────────────────────────
  export function fetchQuestions(ctx: nkruntime.Context, nk: nkruntime.Nakama, logger: nkruntime.Logger, sourceId: string, mode: string, topic: string, count: number, params: any): SeedQ.SeedQuestion[] {
    if (sourceId === "archive_org") return fetchArchiveOrg(ctx, nk, logger, mode, topic, count);
    if (sourceId === "wolfram") return fetchWolfram(ctx, nk, logger, mode, topic, count);
    if (sourceId === "gutenberg") return fetchGutenberg(ctx, nk, logger, mode, topic, count);
    if (sourceId === "music_tv") return fetchMusicTv(ctx, nk, logger, mode, topic, count);
    if (sourceId === "youtube_quiz") return fetchYoutubeQuiz(ctx, nk, logger, mode, topic, count, params);
    if (sourceId === "scholar") return fetchScholar(ctx, nk, logger, mode, topic, count);
    if (sourceId === "justwatch") return fetchJustWatch(ctx, nk, logger, mode, topic, count);
    return [];
  }

  export var QUESTION_SOURCES = ["archive_org", "wolfram", "gutenberg", "music_tv", "youtube_quiz", "scholar", "justwatch"];
}
