// quizverse_music_quiz.js — Server-side music quiz for QuizVerse
// Nakama Goja JavaScript runtime (ES5, no Node.js built-ins)
//
// RPC: quizverse_fetch_music_quiz
//   Fetches top artists from Deezer API (completely free, no API key, no sign-up).
//   Country-specific: searches Deezer for the dominant music genre of that country.
//   Global fallback: Deezer global chart endpoint.
//
// Payload:  { "country": "in" }
// Response: { success: true, artists: [{artistName, imageUrl, fans}], count: N, cached: bool }

var MUSIC_COLLECTION     = "qv_music_cache";
var MUSIC_KEY_PREFIX     = "music_v2_";
var MUSIC_SYSTEM_USER    = "00000000-0000-0000-0000-000000000000";
var MUSIC_CACHE_TTL_SECS = 12 * 60 * 60;  // 12 hours
var MUSIC_TIMEOUT_MS     = 12000;
var MUSIC_MIN_ARTISTS    = 8;

var DEEZER_BASE          = "https://api.deezer.com";

// Country code → genre keyword for Deezer artist search
// Countries without a mapping fall back to the global chart
var MUSIC_COUNTRY_GENRES = {
    "in": "bollywood",
    "pk": "urdu pop",
    "kr": "k-pop",
    "jp": "j-pop",
    "cn": "mandopop",
    "tw": "mandopop",
    "th": "thai pop",
    "id": "dangdut",
    "ph": "opm",
    "br": "mpb",
    "mx": "regional mexicano",
    "co": "cumbia",
    "ar": "tango",
    "cl": "chilean rock",
    "ng": "afrobeats",
    "gh": "highlife",
    "za": "afropop",
    "eg": "arabic pop",
    "sa": "khaleeji",
    "ae": "khaleeji",
    "tr": "türk pop",
    "de": "schlager",
    "fr": "chanson",
    "it": "cantautoría",
    "es": "flamenco",
    "ru": "russian pop",
    "pl": "polish pop",
    "nl": "dutch pop",
    "se": "swedish pop",
    "no": "norwegian pop"
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function musicNowUnix() { return Math.floor(Date.now() / 1000); }

function musicOk(data) {
    var out = { success: true };
    for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k]; }
    return JSON.stringify(out);
}

function musicErr(msg) { return JSON.stringify({ success: false, error: msg || "internal error" }); }

function musicCacheKey(cc) {
    return MUSIC_KEY_PREFIX + (cc || "us").toLowerCase().replace(/[^a-z]/g, "");
}

function musicReadCache(nk, cc) {
    try {
        var records = nk.storageRead([{
            collection: MUSIC_COLLECTION, key: musicCacheKey(cc), userId: MUSIC_SYSTEM_USER
        }]);
        if (records && records.length > 0 && records[0].value) return records[0].value;
    } catch (e) {}
    return null;
}

function musicWriteCache(nk, artists, cc) {
    try {
        nk.storageWrite([{
            collection: MUSIC_COLLECTION, key: musicCacheKey(cc),
            userId: MUSIC_SYSTEM_USER,
            value: { artists: artists, country: cc, cachedAt: musicNowUnix() },
            permissionRead: 2, permissionWrite: 0
        }]);
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────
// Deezer Fetch — genre search (country-specific)
// ─────────────────────────────────────────────────────────────────

function deezerSearchArtists(nk, logger, genre) {
    var artists = [];
    var url = DEEZER_BASE + "/search/artist?q=" + encodeURIComponent(genre) + "&limit=50&order=RANKING";
    try {
        var resp = nk.httpRequest(url, "get", { "User-Agent": "QuizVerseServer/1.0" }, "", MUSIC_TIMEOUT_MS);
        if (!resp || resp.code !== 200) {
            logger.warn("[MusicQuiz] Deezer search returned code=" + (resp ? resp.code : "null") + " genre=" + genre);
            return artists;
        }
        var data = JSON.parse(resp.body);
        var items = (data && data.data) ? data.data : [];
        for (var i = 0; i < items.length; i++) {
            var a = items[i];
            if (!a.name || !a.picture_medium) continue;
            artists.push({
                artistName: a.name,
                imageUrl:   a.picture_big || a.picture_medium,
                fans:       a.nb_fan || 0
            });
        }
        logger.info("[MusicQuiz] Deezer genre search '" + genre + "': " + artists.length + " artists");
    } catch (ex) {
        logger.error("[MusicQuiz] Deezer search error: " + ex.message);
    }
    return artists;
}

// ─────────────────────────────────────────────────────────────────
// Deezer Fetch — global chart (fallback)
// ─────────────────────────────────────────────────────────────────

function deezerGlobalChart(nk, logger) {
    var artists = [];
    var url = DEEZER_BASE + "/chart/0/artists?limit=50";
    try {
        var resp = nk.httpRequest(url, "get", { "User-Agent": "QuizVerseServer/1.0" }, "", MUSIC_TIMEOUT_MS);
        if (!resp || resp.code !== 200) {
            logger.warn("[MusicQuiz] Deezer global chart code=" + (resp ? resp.code : "null"));
            return artists;
        }
        var data = JSON.parse(resp.body);
        var items = (data && data.data) ? data.data : [];
        for (var i = 0; i < items.length; i++) {
            var a = items[i];
            if (!a.name || !a.picture_medium) continue;
            artists.push({
                artistName: a.name,
                imageUrl:   a.picture_big || a.picture_medium,
                fans:       a.nb_fan || 0
            });
        }
        logger.info("[MusicQuiz] Deezer global chart: " + artists.length + " artists");
    } catch (ex) {
        logger.error("[MusicQuiz] Deezer global chart error: " + ex.message);
    }
    return artists;
}

// ─────────────────────────────────────────────────────────────────
// RPC Handler
// ─────────────────────────────────────────────────────────────────

/**
 * quizverse_fetch_music_quiz
 *
 * Payload:  { "country": "in" }
 * Response: { success: true, artists: [...], count: N, genre: "bollywood", cached: bool }
 */
function rpcQuizverseFetchMusicQuiz(ctx, logger, nk, payload) {
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }

    var cc    = (data.country && typeof data.country === "string")
                ? data.country.toLowerCase().replace(/[^a-z]/g, "")
                : "us";
    var genre = MUSIC_COUNTRY_GENRES[cc] || null;  // null = no local genre → use global chart

    logger.info("[MusicQuiz] Request cc=" + cc + " genre=" + (genre || "global-chart"));

    // 1. Serve from cache
    var cached = musicReadCache(nk, cc);
    if (cached && cached.artists && cached.artists.length >= MUSIC_MIN_ARTISTS) {
        var age = musicNowUnix() - (cached.cachedAt || 0);
        if (age < MUSIC_CACHE_TTL_SECS) {
            logger.info("[MusicQuiz] Cache hit: " + cached.artists.length + " artists, age=" + age + "s");
            return musicOk({ artists: cached.artists, count: cached.artists.length, country: cc, genre: genre, cached: true });
        }
        logger.info("[MusicQuiz] Cache stale (" + age + "s) — refreshing");
    }

    // 2. Fetch — country genre first, then merge with global if sparse
    var artists = genre ? deezerSearchArtists(nk, logger, genre) : [];

    if (artists.length < MUSIC_MIN_ARTISTS) {
        logger.info("[MusicQuiz] Supplementing with global chart (local=" + artists.length + ")");
        var global = deezerGlobalChart(nk, logger);
        // Merge: local first, avoid duplicates
        var seen = {};
        for (var i = 0; i < artists.length; i++) seen[artists[i].artistName] = true;
        for (var gi = 0; gi < global.length; gi++) {
            if (!seen[global[gi].artistName]) {
                artists.push(global[gi]);
                seen[global[gi].artistName] = true;
            }
        }
        logger.info("[MusicQuiz] After merge: " + artists.length + " total artists");
    }

    if (artists.length === 0) {
        if (cached && cached.artists && cached.artists.length > 0) {
            logger.warn("[MusicQuiz] Returning stale cache");
            return musicOk({ artists: cached.artists, count: cached.artists.length, country: cc, genre: genre, cached: true, source: "stale" });
        }
        return musicErr("No music data available from Deezer.");
    }

    // 3. Cache + return
    musicWriteCache(nk, artists, cc);
    return musicOk({ artists: artists, count: artists.length, country: cc, genre: genre, cached: false });
}

// ─────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────
// IMPORTANT: this file is concatenated into data/modules/index.js by
// postbuild.js. Top-level `var InitModule = function(...)` here would
// SHADOW the wrapper InitModule that postbuild generates and contains
// the 1000+ direct registerRpc calls Goja's AST walker requires — every
// other RPC then returns 404 (smoke-test caught this regression on
// build #373 / sha 6f79b127). Use the canonical `register(initializer)`
// export that postbuild auto-invokes from inside the wrapper.
function register(initializer) {
    initializer.registerRpc("quizverse_fetch_music_quiz", rpcQuizverseFetchMusicQuiz);
}
