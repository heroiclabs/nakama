// quizverse_movies_quiz.js — Server-side TMDB movie quiz for QuizVerse
// Nakama V8 JavaScript runtime (No ES Modules)
//
// RPC: quizverse_fetch_movies_quiz
//   Fetches trending/popular movies from TMDB API, filtered by region + language.
//   API key lives in server env vars (TMDB_API_KEY) — never in client code.
//   Results are cached per region for 6 hours.
//
// Required env vars:
//   TMDB_API_KEY  — The Movie Database API key (free tier: 40 req/10s, 100k/month)
//
// Payload: { "country": "in", "lang": "en" }
// Response: { success: true, movies: [{title, posterUrl, year, overview}], count: N, cached: bool }

var MQ_COLLECTION     = "qv_movies_cache";
var MQ_KEY_PREFIX     = "movies_v1_";
var MQ_SYSTEM_USER    = "00000000-0000-0000-0000-000000000000";
var MQ_CACHE_TTL_SECS = 6 * 60 * 60;   // 6 hours
var MQ_TIMEOUT_MS     = 15000;
var MQ_MIN_MOVIES     = 10;
var MQ_MAX_MOVIES     = 40;

var MQ_TMDB_BASE      = "https://api.themoviedb.org/3";
var MQ_IMG_BASE       = "https://image.tmdb.org/t/p/w500";

// TMDB region → ISO 3166-1 alpha-2 (TMDB uses uppercase country codes)
var MQ_SUPPORTED_REGIONS = {
    "in":1,"us":1,"gb":1,"de":1,"fr":1,"it":1,"es":1,"br":1,
    "jp":1,"kr":1,"cn":1,"au":1,"ca":1,"mx":1,"ru":1,"tr":1,
    "pk":1,"ng":1,"za":1,"eg":1,"sa":1,"ae":1,"th":1,"id":1,"ph":1
};

// TMDB-supported language codes (ISO-639-1)
var MQ_SUPPORTED_LANGS = {
    "en":1,"hi":1,"ta":1,"te":1,"ko":1,"ja":1,"zh":1,"fr":1,
    "de":1,"es":1,"pt":1,"ru":1,"ar":1,"it":1,"tr":1,"th":1
};

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function mqEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && String(ctx.env[key]) !== "")
        return String(ctx.env[key]);
    return "";
}

function mqNowUnix() { return Math.floor(Date.now() / 1000); }

function mqOk(data) {
    var out = { success: true };
    for (var k in data) { if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k]; }
    return JSON.stringify(out);
}

function mqErr(msg) { return JSON.stringify({ success: false, error: msg || "internal error" }); }

function mqCacheKey(region, lang) {
    var r = (region || "us").toLowerCase().replace(/[^a-z]/g, "");
    var l = (lang   || "en").toLowerCase().replace(/[^a-z]/g, "");
    return MQ_KEY_PREFIX + r + "_" + l;
}

function mqReadCache(nk, region, lang) {
    try {
        var records = nk.storageRead([{ collection: MQ_COLLECTION, key: mqCacheKey(region, lang), userId: MQ_SYSTEM_USER }]);
        if (records && records.length > 0 && records[0].value) return records[0].value;
    } catch (e) {}
    return null;
}

function mqWriteCache(nk, movies, region, lang) {
    try {
        nk.storageWrite([{
            collection: MQ_COLLECTION, key: mqCacheKey(region, lang),
            userId: MQ_SYSTEM_USER,
            value: { movies: movies, region: region, lang: lang, cachedAt: mqNowUnix() },
            permissionRead: 2, permissionWrite: 0
        }]);
    } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────
// TMDB Fetch
// ─────────────────────────────────────────────────────────────────

function mqFetchFromTmdb(nk, logger, apiKey, region, lang) {
    var movies = [];
    if (!apiKey) {
        logger.warn("[MoviesQuiz] TMDB_API_KEY not set in env vars");
        return movies;
    }

    // Validate region + lang
    var r = (region && MQ_SUPPORTED_REGIONS[region.toLowerCase()]) ? region.toUpperCase() : "US";
    var l = (lang   && MQ_SUPPORTED_LANGS[lang.toLowerCase()])     ? lang.toLowerCase()   : "en";
    logger.info("[MoviesQuiz] TMDB fetch region=" + r + " lang=" + l);

    // Fetch trending (week) + popular — merge for best variety
    var endpoints = [
        MQ_TMDB_BASE + "/trending/movie/week?language=" + l + "-" + r + "&api_key=" + apiKey,
        MQ_TMDB_BASE + "/movie/popular?language="       + l + "&region=" + r + "&page=1&api_key=" + apiKey
    ];

    var seenIds = {};

    for (var ei = 0; ei < endpoints.length; ei++) {
        try {
            var resp = nk.httpRequest(endpoints[ei], "get", { "User-Agent": "QuizVerseServer/1.0" }, "", MQ_TIMEOUT_MS);
            if (!resp || resp.code !== 200) {
                logger.warn("[MoviesQuiz] TMDB endpoint " + ei + " returned code=" + (resp ? resp.code : "null"));
                continue;
            }
            var data = JSON.parse(resp.body);
            var results = data.results || [];

            for (var i = 0; i < results.length && movies.length < MQ_MAX_MOVIES; i++) {
                var m = results[i];
                if (!m.title || !m.poster_path) continue;
                if (seenIds[m.id]) continue;
                seenIds[m.id] = true;

                var year = "";
                if (m.release_date && m.release_date.length >= 4)
                    year = m.release_date.substring(0, 4);

                movies.push({
                    title:     m.title,
                    posterUrl: MQ_IMG_BASE + m.poster_path,
                    year:      year,
                    overview:  m.overview ? m.overview.substring(0, 200) : ""
                });
            }
            logger.info("[MoviesQuiz] TMDB endpoint " + ei + " yielded " + results.length + " results, total=" + movies.length);
        } catch (e) {
            logger.error("[MoviesQuiz] TMDB endpoint " + ei + " error: " + e.message);
        }
    }

    return movies;
}

// ─────────────────────────────────────────────────────────────────
// RPC Handler
// ─────────────────────────────────────────────────────────────────

/**
 * quizverse_fetch_movies_quiz
 *
 * Payload: { "country": "in", "lang": "en" }
 * Response: { success: true, movies: [...], count: N, cached: bool }
 */
function rpcQuizverseFetchMoviesQuiz(ctx, logger, nk, payload) {
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }
    var country = (data.country && typeof data.country === "string") ? data.country.toLowerCase() : "us";
    var lang    = (data.lang    && typeof data.lang    === "string") ? data.lang.toLowerCase()    : "en";
    logger.info("[MoviesQuiz] Request country=" + country + " lang=" + lang);

    // 1. Serve from cache
    var cached = mqReadCache(nk, country, lang);
    if (cached && cached.movies && cached.movies.length >= MQ_MIN_MOVIES) {
        var age = mqNowUnix() - (cached.cachedAt || 0);
        if (age < MQ_CACHE_TTL_SECS) {
            logger.info("[MoviesQuiz] Cache hit: " + cached.movies.length + " movies, age=" + age + "s");
            return mqOk({ movies: cached.movies, count: cached.movies.length, cached: true });
        }
        logger.info("[MoviesQuiz] Cache stale (age=" + age + "s) — refreshing");
    }

    // 2. Fetch from TMDB
    var apiKey = mqEnv(ctx, "TMDB_API_KEY");
    var movies = mqFetchFromTmdb(nk, logger, apiKey, country, lang);

    if (movies.length === 0) {
        logger.error("[MoviesQuiz] No movies returned from TMDB for country=" + country);
        if (cached && cached.movies && cached.movies.length > 0) {
            logger.warn("[MoviesQuiz] Returning stale cache");
            return mqOk({ movies: cached.movies, count: cached.movies.length, cached: true, source: "stale_cache" });
        }
        return mqErr("No movie data available. Set TMDB_API_KEY env var.");
    }

    // 3. Cache + return
    mqWriteCache(nk, movies, country, lang);
    return mqOk({ movies: movies, count: movies.length, cached: false });
}

// ─────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────
var InitModule = function(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_fetch_movies_quiz", rpcQuizverseFetchMoviesQuiz);
    logger.info("[MoviesQuiz] Module registered — RPC: quizverse_fetch_movies_quiz");
};
