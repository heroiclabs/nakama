// quizverse_movies_quiz.js — Server-side movie quiz for QuizVerse
// Nakama Goja JavaScript runtime (ES5, no Node.js built-ins)
//
// RPC: quizverse_fetch_movies_quiz
//   Fetches top movies from iTunes RSS feed (country-specific, completely free,
//   no API key, no sign-up required).
//   URL: https://itunes.apple.com/{cc}/rss/topmovies/limit=50/json
//
// Payload:  { "country": "in", "lang": "en" }
// Response: { success: true, movies: [{title, posterUrl, director, releaseDate, genre}], count: N, cached: bool }

var MQ_COLLECTION     = "qv_movies_cache";
var MQ_KEY_PREFIX     = "movies_v2_";
var MQ_SYSTEM_USER    = "00000000-0000-0000-0000-000000000000";
var MQ_CACHE_TTL_SECS = 6 * 60 * 60;  // 6 hours
var MQ_TIMEOUT_MS     = 15000;
var MQ_MIN_MOVIES     = 8;

// Countries supported by iTunes RSS top-movies feed
// (subset of all iTunes Store countries — major markets)
var MQ_SUPPORTED_COUNTRIES = {
    "us":1,"gb":1,"ca":1,"au":1,"nz":1,
    "in":1,"jp":1,"kr":1,"cn":1,"hk":1,"tw":1,"sg":1,"my":1,"ph":1,"th":1,"id":1,
    "de":1,"fr":1,"it":1,"es":1,"nl":1,"se":1,"no":1,"dk":1,"fi":1,"pl":1,"ru":1,
    "br":1,"mx":1,"ar":1,"co":1,"cl":1,
    "za":1,"ng":1,"eg":1,"sa":1,"ae":1,"pk":1,"tr":1
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function mqNowUnix() { return Math.floor(Date.now() / 1000); }

function mqOk(data) {
    var out = { success: true };
    for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k]; }
    return JSON.stringify(out);
}

function mqErr(msg) { return JSON.stringify({ success: false, error: msg || "internal error" }); }

function mqCacheKey(cc) {
    return MQ_KEY_PREFIX + (cc || "us").toLowerCase().replace(/[^a-z]/g, "");
}

function mqReadCache(nk, cc) {
    try {
        var records = nk.storageRead([{
            collection: MQ_COLLECTION, key: mqCacheKey(cc), userId: MQ_SYSTEM_USER
        }]);
        if (records && records.length > 0 && records[0].value) return records[0].value;
    } catch (e) {}
    return null;
}

function mqWriteCache(nk, movies, cc) {
    try {
        nk.storageWrite([{
            collection: MQ_COLLECTION, key: mqCacheKey(cc),
            userId: MQ_SYSTEM_USER,
            value: { movies: movies, country: cc, cachedAt: mqNowUnix() },
            permissionRead: 2, permissionWrite: 0
        }]);
    } catch (e) {}
}

// Upgrade iTunes image URL from tiny (60px) to large (340px) poster
function mqUpgradeImageUrl(url) {
    if (!url || typeof url !== "string") return url;
    // Pattern: …/{hash}/39x60bb.png  →  …/{hash}/300x450bb.png
    return url.replace(/\/\d+x\d+(bb|cc)\.(\w+)$/, "/300x450$1.$2");
}

// ─────────────────────────────────────────────────────────────────
// iTunes RSS Fetch
// ─────────────────────────────────────────────────────────────────

function mqFetchFromItunes(nk, logger, cc) {
    var country = (cc && MQ_SUPPORTED_COUNTRIES[cc.toLowerCase()]) ? cc.toLowerCase() : "us";
    var url = "https://itunes.apple.com/" + country + "/rss/topmovies/limit=50/json";

    logger.info("[MoviesQuiz] iTunes RSS fetch cc=" + country + " url=" + url);

    try {
        var resp = nk.httpRequest(url, "get", {
            "User-Agent": "QuizVerseServer/1.0",
            "Accept": "application/json"
        }, "", MQ_TIMEOUT_MS);

        if (!resp || resp.code !== 200) {
            logger.warn("[MoviesQuiz] iTunes returned code=" + (resp ? resp.code : "null"));
            return [];
        }

        var data = JSON.parse(resp.body);
        var entries = (data.feed && data.feed.entry) ? data.feed.entry : [];
        if (!Array.isArray(entries)) entries = [entries];

        var movies = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var title = e["im:name"] && e["im:name"].label ? e["im:name"].label : null;
            if (!title) continue;

            // Pick the largest available image and upgrade to 300x450
            var posterUrl = "";
            if (e["im:image"] && Array.isArray(e["im:image"]) && e["im:image"].length > 0) {
                posterUrl = mqUpgradeImageUrl(e["im:image"][e["im:image"].length - 1].label || "");
            }
            if (!posterUrl) continue;

            var director = (e["im:artist"] && e["im:artist"].label) ? e["im:artist"].label : "";
            var releaseDate = "";
            if (e["im:releaseDate"] && e["im:releaseDate"].attributes && e["im:releaseDate"].attributes.label) {
                releaseDate = e["im:releaseDate"].attributes.label;
            }
            var genre = "";
            if (e.category && e.category.attributes && e.category.attributes.term) {
                genre = e.category.attributes.term;
            }
            var overview = (e.summary && e.summary.label) ? e.summary.label.substring(0, 200) : "";

            movies.push({
                title:       title,
                posterUrl:   posterUrl,
                director:    director,
                releaseDate: releaseDate,
                genre:       genre,
                overview:    overview
            });
        }

        logger.info("[MoviesQuiz] iTunes returned " + movies.length + " movies for " + country);
        return movies;
    } catch (ex) {
        logger.error("[MoviesQuiz] iTunes fetch error: " + ex.message);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────
// RPC Handler
// ─────────────────────────────────────────────────────────────────

/**
 * quizverse_fetch_movies_quiz
 *
 * Payload:  { "country": "in", "lang": "en" }
 * Response: { success: true, movies: [...], count: N, country: "in", cached: bool }
 */
function rpcQuizverseFetchMoviesQuiz(ctx, logger, nk, payload) {
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }

    var cc = (data.country && typeof data.country === "string")
        ? data.country.toLowerCase().replace(/[^a-z]/g, "")
        : "us";

    logger.info("[MoviesQuiz] Request cc=" + cc);

    // 1. Serve from cache
    var cached = mqReadCache(nk, cc);
    if (cached && cached.movies && cached.movies.length >= MQ_MIN_MOVIES) {
        var age = mqNowUnix() - (cached.cachedAt || 0);
        if (age < MQ_CACHE_TTL_SECS) {
            logger.info("[MoviesQuiz] Cache hit: " + cached.movies.length + " movies, age=" + age + "s");
            return mqOk({ movies: cached.movies, count: cached.movies.length, country: cc, cached: true });
        }
        logger.info("[MoviesQuiz] Cache stale (" + age + "s) — refreshing");
    }

    // 2. Fetch from iTunes RSS
    var movies = mqFetchFromItunes(nk, logger, cc);

    // 3. Fallback to US if country returned nothing
    if (movies.length < MQ_MIN_MOVIES && cc !== "us") {
        logger.warn("[MoviesQuiz] Only " + movies.length + " movies for " + cc + ", falling back to US");
        var usFallback = mqFetchFromItunes(nk, logger, "us");
        if (usFallback.length > movies.length) movies = usFallback;
    }

    if (movies.length === 0) {
        // Return stale cache if available
        if (cached && cached.movies && cached.movies.length > 0) {
            logger.warn("[MoviesQuiz] Returning stale cache");
            return mqOk({ movies: cached.movies, count: cached.movies.length, country: cc, cached: true, source: "stale" });
        }
        return mqErr("No movie data available from iTunes RSS.");
    }

    // 4. Cache + return
    mqWriteCache(nk, movies, cc);
    return mqOk({ movies: movies, count: movies.length, country: cc, cached: false });
}

// ─────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────
var InitModule = function(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_fetch_movies_quiz", rpcQuizverseFetchMoviesQuiz);
    logger.info("[MoviesQuiz] Module registered — RPC: quizverse_fetch_movies_quiz (iTunes RSS, no key)");
};
