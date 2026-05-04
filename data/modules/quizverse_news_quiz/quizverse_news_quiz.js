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
var NQ_KEY = "articles_v1";
var NQ_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var NQ_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours — keeps within 100 req/day limit
var NQ_HTTP_TIMEOUT_MS = 15000;
var NQ_MIN_ARTICLES = 8;
var NQ_MAX_PER_CATEGORY = 10;

var NQ_GNEWS_BASE_URL = "https://gnews.io/api/v4";
var NQ_NEWSAPI_BASE_URL = "https://newsapi.org/v2";

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

function nqReadCache(nk) {
    try {
        var records = nk.storageRead([{
            collection: NQ_COLLECTION,
            key: NQ_KEY,
            userId: NQ_SYSTEM_USER
        }]);
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (e) { /* cache miss */ }
    return null;
}

function nqWriteCache(nk, articles, source) {
    try {
        nk.storageWrite([{
            collection: NQ_COLLECTION,
            key: NQ_KEY,
            userId: NQ_SYSTEM_USER,
            value: {
                articles: articles,
                source: source,
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

function nqFetchFromGNews(nk, logger, apiKey) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] GNEWS_API_KEY not set in env vars");
        return articles;
    }

    var cats = nqShuffle(NQ_GNEWS_CATEGORIES.slice()).slice(0, 3);

    for (var ci = 0; ci < cats.length; ci++) {
        var cat = cats[ci];
        var url = NQ_GNEWS_BASE_URL + "/top-headlines?category=" + cat +
                  "&lang=en&country=us&max=" + NQ_MAX_PER_CATEGORY +
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

function nqFetchFromNewsApi(nk, logger, apiKey) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] NEWSAPI_API_KEY not set in env vars");
        return articles;
    }

    var url = NQ_NEWSAPI_BASE_URL + "/top-headlines?country=us&pageSize=30&apiKey=" + apiKey;
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
 * Request payload: {} (no parameters needed)
 * Response: { success: true, articles: [...], count: N, source: "...", cached: bool }
 */
function rpcQuizverseFetchNewsQuiz(ctx, logger, nk, payload) {
    // 1. Serve from storage cache if still fresh
    var cached = nqReadCache(nk);
    if (cached && cached.articles && cached.articles.length >= NQ_MIN_ARTICLES) {
        var ageSeconds = nqNowUnix() - (cached.cachedAt || 0);
        if (ageSeconds < NQ_CACHE_TTL_SECONDS) {
            logger.info("[NewsQuiz] Cache hit: " + cached.articles.length + " articles, age=" + ageSeconds + "s");
            return nqOk({
                articles: cached.articles,
                count: cached.articles.length,
                source: (cached.source || "unknown") + "_cached",
                cached: true
            });
        }
        logger.info("[NewsQuiz] Cache stale (age=" + ageSeconds + "s) — refreshing");
    }

    // 2. Fetch fresh data
    var gnewsKey = nqEnv(ctx, "GNEWS_API_KEY");
    var newsApiKey = nqEnv(ctx, "NEWSAPI_API_KEY");

    var articles = nqFetchFromGNews(nk, logger, gnewsKey);
    var source = "gnews";

    if (articles.length < NQ_MIN_ARTICLES) {
        logger.warn("[NewsQuiz] GNews returned only " + articles.length + " articles, trying NewsAPI fallback...");
        var fallback = nqFetchFromNewsApi(nk, logger, newsApiKey);
        if (fallback.length > 0) {
            articles = articles.concat(fallback);
            source = articles.length > 0 ? "gnews+newsapi" : source;
        }
    }

    // 3. Handle empty response — return stale cache rather than nothing
    if (articles.length === 0) {
        logger.error("[NewsQuiz] All sources returned 0 articles");
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

    // 4. Write to storage cache
    nqWriteCache(nk, articles, source);

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
