// quizverse_news_quiz.js — Server-side news fetching for QuizVerse News Quiz
// Nakama V8 JavaScript runtime (No ES Modules)
//
// RPC: quizverse_fetch_news_quiz
//   Fetches news articles from GNews API (+ NewsAPI fallback), caches results
//   in Nakama storage for 6 hours so the shared API key is never exhausted.
//   API keys live in server env vars — never in client code.
//
// Required env vars:
//   GNEWS_API_KEY   — GNews.io API key (100 req/day free tier)
//   NEWSAPI_API_KEY — NewsAPI.org API key (fallback)
//
// Response JSON:
//   { success: true, articles: [{title, description, imageUrl, sourceName, category, publishedAt}],
//     count: N, source: "gnews"|"newsapi"|"gnews+newsapi"|"*_cached"|"stale_cache", cached: bool }

// ============================================================================
// CONSTANTS
// ============================================================================

var NQ_COLLECTION = "qv_news_cache";
var NQ_KEY_PREFIX = "articles_v2_"; // v2 adds per-country key; old v1 key is abandoned
var NQ_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var NQ_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours — keeps within 100 req/day limit
var NQ_HTTP_TIMEOUT_MS = 15000;
var NQ_MIN_ARTICLES = 8;
var NQ_MAX_PER_CATEGORY = 10;

var NQ_GNEWS_BASE_URL = "https://gnews.io/api/v4";
var NQ_NEWSAPI_BASE_URL = "https://newsapi.org/v2";

// GNews-supported country codes. If the player's country is not in this list
// we fall back to "us" so the API always returns useful articles.
var NQ_GNEWS_SUPPORTED_COUNTRIES = {
    "au":1,"br":1,"ca":1,"cn":1,"de":1,"eg":1,"fr":1,"gb":1,"gr":1,
    "hk":1,"in":1,"ie":1,"il":1,"it":1,"jp":1,"nl":1,"no":1,"pk":1,
    "pe":1,"ph":1,"pt":1,"ro":1,"ru":1,"sg":1,"es":1,"se":1,"ch":1,"tw":1,"ua":1,"us":1
};

// NewsAPI-supported country codes (subset that has top-headlines support)
var NQ_NEWSAPI_SUPPORTED_COUNTRIES = {
    "ae":1,"ar":1,"at":1,"au":1,"be":1,"bg":1,"br":1,"ca":1,"ch":1,"cn":1,
    "co":1,"cu":1,"cz":1,"de":1,"eg":1,"fr":1,"gb":1,"gr":1,"hk":1,"hu":1,
    "id":1,"ie":1,"il":1,"in":1,"it":1,"jp":1,"kr":1,"lt":1,"lv":1,"ma":1,
    "mx":1,"my":1,"ng":1,"nl":1,"no":1,"nz":1,"ph":1,"pl":1,"pt":1,"ro":1,
    "rs":1,"ru":1,"sa":1,"se":1,"sg":1,"si":1,"sk":1,"th":1,"tr":1,"tw":1,
    "ua":1,"us":1,"ve":1,"za":1
};

// GNews-supported language codes
var NQ_GNEWS_SUPPORTED_LANGS = {
    "ar":1,"zh":1,"nl":1,"en":1,"fr":1,"de":1,"el":1,"he":1,"hi":1,
    "it":1,"ja":1,"ml":1,"mr":1,"no":1,"pt":1,"ro":1,"ru":1,"es":1,
    "sv":1,"ta":1,"te":1,"uk":1,"ud":1
};

var NQ_GNEWS_CATEGORIES = [
    "general", "world", "technology", "entertainment", "sports", "science", "health", "business"
];

var NQ_SERVER_USER_AGENT = "Mozilla/5.0 (compatible; QuizVerseServer/1.0)";

// ============================================================================
// HELPERS
// ============================================================================

// Fallback API keys — used when server env vars are not configured.
// Prefer env vars in production; these ensure the RPC never silently fails.
var NQ_FALLBACK_KEYS = {
    "GNEWS_API_KEY": "c34599e145018d0d9e3000a88b9a487f",
    "NEWSAPI_API_KEY": "66829bdff7b448fa8e43427c5c0a22d6"
};

function nqEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null && String(ctx.env[key]) !== "") {
        return String(ctx.env[key]);
    }
    // Fallback to hardcoded keys if env var is missing/empty
    if (NQ_FALLBACK_KEYS[key]) {
        return NQ_FALLBACK_KEYS[key];
    }
    return "";
}

function nqNowUnix() {
    return Math.floor(Date.now() / 1000);
}

function nqOk(data) {
    var out = { success: true };
    if (data) {
        for (var k in data) {
            if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
        }
    }
    return JSON.stringify(out);
}

function nqErr(msg) {
    return JSON.stringify({ success: false, error: msg || "internal error" });
}

// Fisher-Yates shuffle
function nqShuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
}

// ============================================================================
// STORAGE CACHE
// ============================================================================

function nqCacheKey(country, lang) {
    // Cache is per-country+language so Indian users get Indian news independently of US cache.
    var cc = (country || "us").toLowerCase().replace(/[^a-z]/g, "");
    var lc = (lang    || "en").toLowerCase().replace(/[^a-z]/g, "");
    return NQ_KEY_PREFIX + cc + "_" + lc;
}

function nqReadCache(nk, country, lang) {
    try {
        var records = nk.storageRead([{
            collection: NQ_COLLECTION,
            key: nqCacheKey(country, lang),
            userId: NQ_SYSTEM_USER
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (e) { /* cache miss */ }
    return null;
}

function nqWriteCache(nk, articles, source, country, lang) {
    try {
        nk.storageWrite([{
            collection: NQ_COLLECTION,
            key: nqCacheKey(country, lang),
            userId: NQ_SYSTEM_USER,
            value: {
                articles: articles,
                source: source,
                country: country || "us",
                lang: lang || "en",
                cachedAt: nqNowUnix()
            },
            permissionRead: 2,  // Public read so any authenticated user can hit it
            permissionWrite: 0  // Server-only write
        }]);
    } catch (e) { /* best-effort */ }
}

// ============================================================================
// GNEWS FETCH (primary)
// ============================================================================

function nqFetchFromGNews(nk, logger, apiKey, country, lang) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] GNEWS_API_KEY not set in env vars");
        return articles;
    }

    // Validate country/lang against GNews supported values; fall back to us/en
    var cc = (country && NQ_GNEWS_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : "us";
    var lc = (lang    && NQ_GNEWS_SUPPORTED_LANGS[lang.toLowerCase()])         ? lang.toLowerCase()    : "en";
    logger.info("[NewsQuiz] GNews fetch country=" + cc + " lang=" + lc);

    var cats = nqShuffle(NQ_GNEWS_CATEGORIES.slice()).slice(0, 3);

    for (var ci = 0; ci < cats.length; ci++) {
        var cat = cats[ci];
        var url = NQ_GNEWS_BASE_URL + "/top-headlines?category=" + cat +
                  "&lang=" + lc + "&country=" + cc + "&max=" + NQ_MAX_PER_CATEGORY +
                  "&apikey=" + apiKey;
        try {
            var resp = nk.httpRequest(url, "get", {
                "User-Agent": NQ_SERVER_USER_AGENT,
                "Accept": "application/json"
            }, null, NQ_HTTP_TIMEOUT_MS);

            if (resp.code !== 200) {
                logger.warn("[NewsQuiz] GNews '" + cat + "' HTTP " + resp.code);
                if (resp.code === 403 || resp.code === 429) break; // key exhausted or rate-limited
                continue;
            }

            var data = JSON.parse(resp.body || "{}");
            if (!data.articles) continue;

            for (var ai = 0; ai < data.articles.length; ai++) {
                var a = data.articles[ai];
                if (!a.title || !a.image) continue;
                if (a.title.indexOf("[Removed]") >= 0) continue;
                articles.push({
                    title: a.title,
                    description: a.description || a.title,
                    imageUrl: a.image,
                    sourceName: (a.source && a.source.name) ? a.source.name : "Unknown",
                    category: cat.charAt(0).toUpperCase() + cat.slice(1),
                    publishedAt: a.publishedAt || ""
                });
            }
            logger.info("[NewsQuiz] GNews '" + cat + "': " + articles.length + " articles so far");
        } catch (e) {
            logger.error("[NewsQuiz] GNews '" + cat + "' error: " + e.message);
        }
    }

    return articles;
}

// ============================================================================
// NEWSAPI FALLBACK
// ============================================================================

function nqFetchFromNewsApi(nk, logger, apiKey, country) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] NEWSAPI_API_KEY not set in env vars");
        return articles;
    }

    // NewsAPI top-headlines only supports a subset of country codes; fall back to us
    var cc = (country && NQ_NEWSAPI_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : "us";
    var url = NQ_NEWSAPI_BASE_URL + "/top-headlines?country=" + cc + "&pageSize=30&apiKey=" + apiKey;
    try {
        var resp = nk.httpRequest(url, "get", {
            "User-Agent": NQ_SERVER_USER_AGENT,
            "Accept": "application/json",
            "X-Api-Key": apiKey
        }, null, NQ_HTTP_TIMEOUT_MS);

        if (resp.code !== 200) {
            logger.warn("[NewsQuiz] NewsAPI HTTP " + resp.code);
            return articles;
        }

        var data = JSON.parse(resp.body || "{}");
        if (!data.articles) return articles;

        for (var ai = 0; ai < data.articles.length; ai++) {
            var a = data.articles[ai];
            if (!a.title || !a.urlToImage) continue;
            if (a.title.indexOf("[Removed]") >= 0) continue;
            articles.push({
                title: a.title,
                description: a.description || a.title,
                imageUrl: a.urlToImage,
                sourceName: (a.source && a.source.name) ? a.source.name : "Unknown",
                category: "News",
                publishedAt: a.publishedAt || ""
            });
        }
        logger.info("[NewsQuiz] NewsAPI: " + articles.length + " articles");
    } catch (e) {
        logger.error("[NewsQuiz] NewsAPI error: " + e.message);
    }

    return articles;
}

// ============================================================================
// RPC HANDLER
// ============================================================================

/**
 * quizverse_fetch_news_quiz
 *
 * Returns cached or freshly fetched news articles for the News Quiz mode.
 * Request payload: { "country": "in", "lang": "en" }
 *   country — ISO 2-letter code from GeoLocatorService (defaults to "us")
 *   lang    — BCP-47 language code (defaults to "en"; only override when app lang changed)
 * Response: { success: true, articles: [...], count: N, source: "...", cached: bool }
 */
function rpcQuizverseFetchNewsQuiz(ctx, logger, nk, payload) {
    // Parse optional country + lang from client payload
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }
    var country = (data.country && typeof data.country === "string") ? data.country.toLowerCase() : "us";
    var lang    = (data.lang    && typeof data.lang    === "string") ? data.lang.toLowerCase()    : "en";
    logger.info("[NewsQuiz] Request: country=" + country + " lang=" + lang);

    // 1. Serve from storage cache if still fresh (per-country+language bucket)
    var cached = nqReadCache(nk, country, lang);
    if (cached && cached.articles && cached.articles.length >= NQ_MIN_ARTICLES) {
        var ageSeconds = nqNowUnix() - (cached.cachedAt || 0);
        if (ageSeconds < NQ_CACHE_TTL_SECONDS) {
            logger.info("[NewsQuiz] Cache hit: " + cached.articles.length + " articles, age=" + ageSeconds + "s country=" + country);
            return nqOk({
                articles: cached.articles,
                count: cached.articles.length,
                source: (cached.source || "unknown") + "_cached",
                cached: true
            });
        }
        logger.info("[NewsQuiz] Cache stale (age=" + ageSeconds + "s) — refreshing for country=" + country);
    }

    // 2. Fetch fresh data, passing country+lang so APIs return regional headlines
    var gnewsKey   = nqEnv(ctx, "GNEWS_API_KEY");
    var newsApiKey = nqEnv(ctx, "NEWSAPI_API_KEY");

    var articles = nqFetchFromGNews(nk, logger, gnewsKey, country, lang);
    var source = "gnews";

    if (articles.length < NQ_MIN_ARTICLES) {
        logger.warn("[NewsQuiz] GNews returned only " + articles.length + " articles, trying NewsAPI fallback...");
        var fallback = nqFetchFromNewsApi(nk, logger, newsApiKey, country);
        if (fallback.length > 0) {
            articles = articles.concat(fallback);
            source = articles.length > 0 ? "gnews+newsapi" : source;
        }
    }

    // 3. Handle empty response — return stale cache rather than nothing
    if (articles.length === 0) {
        logger.error("[NewsQuiz] All sources returned 0 articles for country=" + country);
        if (cached && cached.articles && cached.articles.length > 0) {
            logger.warn("[NewsQuiz] Returning stale cache (" + cached.articles.length + " articles)");
            return nqOk({
                articles: cached.articles,
                count: cached.articles.length,
                source: "stale_cache",
                cached: true
            });
        }
        return nqErr("No news articles available — check GNEWS_API_KEY and NEWSAPI_API_KEY env vars");
    }

    // 4. Write to per-country storage cache
    nqWriteCache(nk, articles, source, country, lang);

    logger.info("[NewsQuiz] Fetched " + articles.length + " articles from " + source + " — cached for 6h");
    return nqOk({
        articles: articles,
        count: articles.length,
        source: source,
        cached: false
    });
}

// ============================================================================
// MODULE INIT
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("quizverse_fetch_news_quiz", rpcQuizverseFetchNewsQuiz);
    logger.info("[NewsQuiz] Registered RPC: quizverse_fetch_news_quiz");
}
