// quizverse_music_quiz.js — Server-side Last.fm music quiz for QuizVerse
// Nakama V8 JavaScript runtime (No ES Modules)
//
// RPC: quizverse_fetch_music_quiz
//   Fetches top artists by country from Last.fm geo.getTopArtists.
//   API key lives in server env vars (LASTFM_API_KEY) — never in client code.
//   Results are cached per country for 12 hours (Last.fm charts update weekly).
//
// Required env vars:
//   LASTFM_API_KEY  — Last.fm API key (free: register at last.fm/api)
//
// Payload: { "country": "india" }  ← Last.fm uses full country name, not ISO code
// Response: { success: true, artists: [{artistName, imageUrl, playcount}], count: N, cached: bool }

var MUSIC_COLLECTION     = "qv_music_cache";
var MUSIC_KEY_PREFIX     = "music_v1_";
var MUSIC_SYSTEM_USER    = "00000000-0000-0000-0000-000000000000";
var MUSIC_CACHE_TTL_SECS = 12 * 60 * 60; // 12 hours
var MUSIC_TIMEOUT_MS     = 15000;
var MUSIC_MIN_ARTISTS    = 8;

var LASTFM_BASE          = "http://ws.audioscrobbler.com/2.0/";

// ISO 2-letter → Last.fm full country name (Last.fm uses full names, not ISO codes)
var MUSIC_COUNTRY_NAMES = {
    "in":  "India",       "us":  "United States", "gb":  "United Kingdom",
    "de":  "Germany",     "fr":  "France",         "it":  "Italy",
    "es":  "Spain",       "br":  "Brazil",         "jp":  "Japan",
    "kr":  "South Korea", "au":  "Australia",      "ca":  "Canada",
    "mx":  "Mexico",      "ru":  "Russian Federation", "tr": "Turkey",
    "pk":  "Pakistan",    "nl":  "Netherlands",    "se":  "Sweden",
    "no":  "Norway",      "pl":  "Poland",          "ar":  "Argentina",
    "za":  "South Africa","ng":  "Nigeria",         "eg":  "Egypt",
    "id":  "Indonesia",   "ph":  "Philippines",     "th":  "Thailand",
    "sg":  "Singapore",   "my":  "Malaysia"
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function musicEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && String(ctx.env[key]) !== "")
        return String(ctx.env[key]);
    return "";
}

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
        var records = nk.storageRead([{ collection: MUSIC_COLLECTION, key: musicCacheKey(cc), userId: MUSIC_SYSTEM_USER }]);
        if (records && records.length > 0 && records[0].value) return records[0].value;
    } catch (e) {}
    return null;
}

function musicWriteCache(nk, artists, cc, countryName) {
    try {
        nk.storageWrite([{
            collection: MUSIC_COLLECTION, key: musicCacheKey(cc),
            userId: MUSIC_SYSTEM_USER,
            value: { artists: artists, country: countryName, cachedAt: musicNowUnix() },
            permissionRead: 2, permissionWrite: 0
        }]);
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────
// Last.fm Fetch — geo.getTopArtists
// ─────────────────────────────────────────────────────────────────

function fetchTopArtists(nk, logger, apiKey, countryName) {
    var artists = [];
    if (!apiKey) {
        logger.warn("[MusicQuiz] LASTFM_API_KEY not set in env vars");
        return artists;
    }

    var url = LASTFM_BASE + "?method=geo.gettopartists" +
              "&country=" + encodeURIComponent(countryName) +
              "&limit=50&format=json&api_key=" + apiKey;

    try {
        var resp = nk.httpRequest(url, "get", { "User-Agent": "QuizVerseServer/1.0" }, "", MUSIC_TIMEOUT_MS);
        if (!resp || resp.code !== 200) {
            logger.warn("[MusicQuiz] Last.fm returned code=" + (resp ? resp.code : "null") + " for country=" + countryName);
            return artists;
        }

        var data = JSON.parse(resp.body);
        var topArtists = data.topartists && data.topartists.artist ? data.topartists.artist : [];
        if (!Array.isArray(topArtists)) topArtists = [topArtists]; // single result edge case

        for (var i = 0; i < topArtists.length; i++) {
            var a = topArtists[i];
            if (!a.name) continue;

            // Last.fm returns an array of image objects; pick the "extralarge" or largest
            var imgUrl = "";
            if (a.image && Array.isArray(a.image)) {
                for (var j = a.image.length - 1; j >= 0; j--) {
                    if (a.image[j]["#text"] && a.image[j]["#text"].indexOf("http") === 0) {
                        imgUrl = a.image[j]["#text"];
                        break;
                    }
                }
            }

            // Skip artists with no image — quiz requires an image
            if (!imgUrl) continue;

            artists.push({
                artistName: a.name,
                imageUrl:   imgUrl,
                playcount:  a.playcount || "0"
            });
        }

        logger.info("[MusicQuiz] Last.fm returned " + artists.length + " artists with images for " + countryName);
    } catch (e) {
        logger.error("[MusicQuiz] Last.fm error: " + e.message);
    }

    return artists;
}

// Fallback: global chart (chart.getTopArtists) when country returns < minimum artists
function fetchGlobalTopArtists(nk, logger, apiKey) {
    var artists = [];
    var url = LASTFM_BASE + "?method=chart.gettopartists&limit=50&format=json&api_key=" + apiKey;
    try {
        var resp = nk.httpRequest(url, "get", { "User-Agent": "QuizVerseServer/1.0" }, "", MUSIC_TIMEOUT_MS);
        if (!resp || resp.code !== 200) return artists;

        var data = JSON.parse(resp.body);
        var topArtists = data.artists && data.artists.artist ? data.artists.artist : [];
        if (!Array.isArray(topArtists)) topArtists = [topArtists];

        for (var i = 0; i < topArtists.length; i++) {
            var a = topArtists[i];
            if (!a.name) continue;
            var imgUrl = "";
            if (a.image && Array.isArray(a.image)) {
                for (var j = a.image.length - 1; j >= 0; j--) {
                    if (a.image[j]["#text"] && a.image[j]["#text"].indexOf("http") === 0) {
                        imgUrl = a.image[j]["#text"]; break;
                    }
                }
            }
            if (!imgUrl) continue;
            artists.push({ artistName: a.name, imageUrl: imgUrl, playcount: a.playcount || "0" });
        }
        logger.info("[MusicQuiz] Global fallback: " + artists.length + " artists");
    } catch (e) {
        logger.error("[MusicQuiz] Global fallback error: " + e.message);
    }
    return artists;
}

// ─────────────────────────────────────────────────────────────────
// RPC Handler
// ─────────────────────────────────────────────────────────────────

/**
 * quizverse_fetch_music_quiz
 *
 * Payload: { "country": "in" }
 * Response: { success: true, artists: [...], count: N, country: "India", cached: bool }
 */
function rpcQuizverseFetchMusicQuiz(ctx, logger, nk, payload) {
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }
    var cc = (data.country && typeof data.country === "string") ? data.country.toLowerCase() : "us";
    var countryName = MUSIC_COUNTRY_NAMES[cc] || "United States";
    logger.info("[MusicQuiz] Request cc=" + cc + " countryName=" + countryName);

    // 1. Serve from cache
    var cached = musicReadCache(nk, cc);
    if (cached && cached.artists && cached.artists.length >= MUSIC_MIN_ARTISTS) {
        var age = musicNowUnix() - (cached.cachedAt || 0);
        if (age < MUSIC_CACHE_TTL_SECS) {
            logger.info("[MusicQuiz] Cache hit: " + cached.artists.length + " artists, age=" + age + "s");
            return musicOk({ artists: cached.artists, count: cached.artists.length, country: countryName, cached: true });
        }
        logger.info("[MusicQuiz] Cache stale (age=" + age + "s) — refreshing");
    }

    // 2. Fetch from Last.fm
    var apiKey  = musicEnv(ctx, "LASTFM_API_KEY");
    var artists = fetchTopArtists(nk, logger, apiKey, countryName);

    // 3. Fallback to global chart if country has < minimum (many small countries have sparse data)
    if (artists.length < MUSIC_MIN_ARTISTS && apiKey) {
        logger.warn("[MusicQuiz] Only " + artists.length + " artists for " + countryName + ", fetching global chart as supplement");
        var global = fetchGlobalTopArtists(nk, logger, apiKey);
        // Merge: local first, then global (avoid duplicates)
        var seen = {};
        for (var i = 0; i < artists.length; i++) seen[artists[i].artistName] = true;
        for (var gi = 0; gi < global.length; gi++) {
            if (!seen[global[gi].artistName]) { artists.push(global[gi]); seen[global[gi].artistName] = true; }
        }
        logger.info("[MusicQuiz] After merge: " + artists.length + " artists");
    }

    if (artists.length === 0) {
        logger.error("[MusicQuiz] No artists returned for country=" + countryName);
        if (cached && cached.artists && cached.artists.length > 0) {
            logger.warn("[MusicQuiz] Returning stale cache");
            return musicOk({ artists: cached.artists, count: cached.artists.length, country: countryName, cached: true, source: "stale_cache" });
        }
        return musicErr("No music data available. Set LASTFM_API_KEY env var.");
    }

    // 4. Cache + return
    musicWriteCache(nk, artists, cc, countryName);
    return musicOk({ artists: artists, count: artists.length, country: countryName, cached: false });
}

// ─────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────
var InitModule = function(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_fetch_music_quiz", rpcQuizverseFetchMusicQuiz);
    logger.info("[MusicQuiz] Module registered — RPC: quizverse_fetch_music_quiz");
};
