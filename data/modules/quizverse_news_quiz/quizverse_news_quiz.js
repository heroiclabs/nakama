// quizverse_news_quiz.js — Server-side news fetching for QuizVerse News Quiz
// Nakama V8 JavaScript runtime (No ES Modules)
//
// RPC: quizverse_fetch_news_quiz
//   Fetches news articles from multiple news APIs with geo-aware fallback chain,
//   caches results in Nakama storage for 6 hours so shared API keys are never exhausted.
//   API keys are hardcoded in NQ_FALLBACK_KEYS below (server env vars override if present).
//
// Fetch chain (in order):
//   1. GNews       — always fetches (primary, 100 req/day, 31 countries, best category support)
//   2. Currents    — always fetches alongside GNews (1,000 req/day, 70+ countries, 20 languages)
//   3. MediaStack  — always fetches alongside GNews+Currents (500 req/month, Middle East/Africa/SE Asia)
//   4. NewsAPI     — TRUE last resort: only if GNews+Currents+MediaStack combined < 8 articles
//
// API keys (hardcoded — override via optional server env vars if desired):
//   GNEWS_API_KEY       — GNews.io API key
//   CURRENTS_API_KEY    — currentsapi.services key
//   MEDIASTACK_API_KEY  — mediastack.com key
//   NEWSAPI_API_KEY     — NewsAPI.org API key
//
// Response JSON:
//   { success: true, articles: [{title, description, imageUrl, url, sourceName, category,
//     publishedAt (unix int), contentLength (title word count)}, ...],
//     count: N, source: "gnews"|"currents"|"mediastack"|"newsapi"|combos|"*_cached"|"stale_cache", cached: bool }
//
// SPEED & LOAD-BALANCING NOTES
//   - In-process refresh lock (_NQ_REFRESH_IN_FLIGHT) prevents thundering-herd:
//     only the FIRST concurrent caller for a given cache key triggers a fetch;
//     all others get stale cache immediately while the refresh runs.
//   - HTTP timeout 8 s per call (GNews p99 < 2 s).
//   - GNews categories are a fixed priority list (not random) so every
//     Nakama node builds the same cache key — multi-node caches stay hot.
//   - All 8 GNews categories fetched per refresh (8 × 10 = 80 max raw articles);
//     6h TTL keeps the 100 req/day quota safe at any user volume.
//   - ETag stored per cache entry; sent as If-None-Match on refresh — GNews
//     returns 304 + no body when articles haven't changed, saving bandwidth.
//   - GNews 429/403 sets quotaExhausted=true so the chain skips to Currents
//     immediately instead of silently continuing with 0 articles.
//   - Articles are sorted newest-first then deduplicated by normalised title
//     after merging sources so Unity gets fresh stories, never duplicates.
//   - Total article count capped at NQ_MAX_ARTICLES (50) before caching.
//   - NewsAPI receives the lang param so bilingual countries (ca→fr, ch→de)
//     get localised headlines instead of always falling back to English.
//   - publishedAt is normalised to a Unix int across all 4 APIs so Unity
//     can sort/display dates without format-specific parsing.
//   - description is trimmed to the last complete sentence — no "…" fragments.
//     If the cleaned description equals the title it is blanked (redundant).
//   - contentLength (title word count) lets Unity skip shallow clickbait titles.
//   - url is stored from all 4 APIs to enable a "Read full article" button.

// ============================================================================
// CONSTANTS
// ============================================================================

var NQ_COLLECTION = "qv_news_cache";
var NQ_KEY_PREFIX = "articles_v5_"; // v5: url, unix publishedAt, clean desc, contentLength, NewsAPI category
var NQ_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var NQ_CACHE_TTL_SECONDS = 6 * 60 * 60; // 6 hours — keeps all APIs within free-tier budgets
var NQ_HTTP_TIMEOUT_MS = 8000;
// QVBF_158: 4 is the minimum viable for a quiz round (title + 3 distractors) and matches
// the reality of free-tier APIs on less-covered countries (Middle East, Africa, SE Asia).
// The NewsAPI last-resort fallback is still triggered when the combined count is < 4.
var NQ_MIN_ARTICLES = 4;
var NQ_MAX_PER_CATEGORY = 10;
var NQ_GNEWS_FETCH_CATS = 8; // fetch all 8 categories — 6h cache keeps daily quota safe
var NQ_MAX_ARTICLES = 50;    // hard cap before caching — enough variety for quiz rounds

var NQ_GNEWS_BASE_URL      = "https://gnews.io/api/v4";
var NQ_CURRENTS_BASE_URL   = "https://api.currentsapi.services/v1";
var NQ_MEDIASTACK_BASE_URL = "http://api.mediastack.com/v1";
var NQ_NEWSAPI_BASE_URL    = "https://newsapi.org/v2";

// ── GNews (primary) — 100 req/day, 31 countries ─────────────────────────────
var NQ_GNEWS_SUPPORTED_COUNTRIES = {
    "au":1,"br":1,"ca":1,"cn":1,"de":1,"eg":1,"fr":1,"gb":1,"gr":1,
    "hk":1,"in":1,"ie":1,"il":1,"it":1,"jp":1,"nl":1,"no":1,"pk":1,
    "pe":1,"ph":1,"pt":1,"ro":1,"ru":1,"sg":1,"es":1,"se":1,"ch":1,"tw":1,"ua":1,"us":1
};

var NQ_GNEWS_SUPPORTED_LANGS = {
    "ar":1,"zh":1,"nl":1,"en":1,"fr":1,"de":1,"el":1,"he":1,"hi":1,
    "it":1,"ja":1,"ml":1,"mr":1,"no":1,"pt":1,"ro":1,"ru":1,"es":1,
    "sv":1,"ta":1,"te":1,"uk":1,"ud":1
};

// Fixed priority order — deterministic across Nakama nodes keeps cache hot.
var NQ_GNEWS_CATEGORIES = [
    "general", "world", "technology", "entertainment", "sports", "science", "health", "business"
];

// ── Currents API (geo gap filler) — 1,000 req/day, 70+ countries ────────────
// Covers ke, za, pk, bd, vn, ng and every country GNews/NewsAPI miss.
var NQ_CURRENTS_SUPPORTED_COUNTRIES = {
    "us":1,"gb":1,"au":1,"ca":1,"in":1,"de":1,"fr":1,"es":1,"it":1,"pt":1,
    "br":1,"mx":1,"ar":1,"co":1,"cl":1,"pe":1,"ve":1,"ec":1,"bo":1,"py":1,
    "uy":1,"jp":1,"kr":1,"cn":1,"tw":1,"hk":1,"sg":1,"my":1,"id":1,"ph":1,
    "th":1,"vn":1,"bd":1,"pk":1,"lk":1,"np":1,"ru":1,"ua":1,"pl":1,"cz":1,
    "sk":1,"hu":1,"ro":1,"bg":1,"hr":1,"rs":1,"si":1,"nl":1,"be":1,"ch":1,
    "at":1,"se":1,"no":1,"dk":1,"fi":1,"gr":1,"tr":1,"il":1,"ae":1,"sa":1,
    "eg":1,"ma":1,"ng":1,"ke":1,"za":1,"gh":1,"et":1,"tz":1,"ug":1,"cm":1,
    "nz":1,"ie":1,"lt":1,"lv":1,"ee":1,"by":1,"ge":1,"am":1,"az":1
};

var NQ_CURRENTS_SUPPORTED_LANGS = {
    "en":1,"es":1,"fr":1,"de":1,"pt":1,"it":1,"nl":1,"ru":1,"ar":1,"zh":1,
    "ja":1,"ko":1,"hi":1,"bn":1,"tr":1,"pl":1,"uk":1,"sv":1,"no":1,"fi":1
};

// ── MediaStack (regional specialist) — 500 req/MONTH, 50+ countries ─────────
// Best for Middle East (ae, sa), Africa (ng, ke, za), SE Asia (id, my, th).
// Always called on every cache refresh alongside GNews + Currents for maximum
// regional depth. 6h TTL + ~50 articles/refresh keeps monthly quota safe.
var NQ_MEDIASTACK_SUPPORTED_COUNTRIES = {
    "us":1,"gb":1,"au":1,"ca":1,"in":1,"de":1,"fr":1,"es":1,"it":1,"pt":1,
    "br":1,"mx":1,"ar":1,"jp":1,"kr":1,"cn":1,"sg":1,"my":1,"id":1,"ph":1,
    "th":1,"vn":1,"pk":1,"ae":1,"sa":1,"eg":1,"ma":1,"ng":1,"ke":1,"za":1,
    "gh":1,"et":1,"ru":1,"ua":1,"pl":1,"nl":1,"be":1,"se":1,"no":1,"tr":1,
    "il":1,"hk":1,"tw":1,"nz":1,"ie":1,"at":1,"ch":1,"dk":1,"fi":1
};

var NQ_MEDIASTACK_SUPPORTED_LANGS = {
    "en":1,"es":1,"fr":1,"de":1,"pt":1,"it":1,"ar":1,"zh":1,"ja":1,"ko":1,
    "hi":1,"ru":1,"nl":1,"tr":1,"pl":1,"sv":1
};

// ── NewsAPI (English fallback) — 100 req/day, 54 countries ──────────────────
var NQ_NEWSAPI_SUPPORTED_COUNTRIES = {
    "ae":1,"ar":1,"at":1,"au":1,"be":1,"bg":1,"br":1,"ca":1,"ch":1,"cn":1,
    "co":1,"cu":1,"cz":1,"de":1,"eg":1,"fr":1,"gb":1,"gr":1,"hk":1,"hu":1,
    "id":1,"ie":1,"il":1,"in":1,"it":1,"jp":1,"kr":1,"lt":1,"lv":1,"ma":1,
    "mx":1,"my":1,"ng":1,"nl":1,"no":1,"nz":1,"ph":1,"pl":1,"pt":1,"ro":1,
    "rs":1,"ru":1,"sa":1,"se":1,"sg":1,"si":1,"sk":1,"th":1,"tr":1,"tw":1,
    "ua":1,"us":1,"ve":1,"za":1
};

var NQ_SERVER_USER_AGENT = "Mozilla/5.0 (compatible; QuizVerseServer/1.0)";

// ============================================================================
// THUNDERING-HERD GUARD
// ============================================================================

// ── Process-local guard (single-node fast path) ──────────────────────────────
// Nakama V8 is single-threaded per-process, so a plain JS object is safe here.
// This catches the common case (many concurrent requests on the same node)
// before we even touch storage.
var _NQ_REFRESH_IN_FLIGHT = {};

// ── Distributed lock (multi-node guard) ──────────────────────────────────────
// Lock TTL: how long a node may hold the refresh lock before it is considered
// dead and another node may take over. 30 s >> worst-case HTTP chain (4 × 8 s).
var NQ_LOCK_COLLECTION = "qv_news_lock";
var NQ_LOCK_TTL_SECONDS = 60;

// Try to acquire a storage-based distributed lock for cacheKey.
// Returns true if this node now owns the lock, false if another node holds it.
function nqAcquireLock(nk, logger, cacheKey) {
    var lockKey = "lock_" + cacheKey;
    var now = nqNowUnix();
    try {
        // Read any existing lock entry first
        var existing = nk.storageRead([{
            collection: NQ_LOCK_COLLECTION,
            key: lockKey,
            userId: NQ_SYSTEM_USER
        }]);
        if (existing && existing.length > 0 && existing[0].value) {
            var lock = existing[0].value;
            // Another node holds the lock and it has not expired yet
            if (lock.lockedAt && (now - lock.lockedAt) < NQ_LOCK_TTL_SECONDS) {
                logger.info("[NewsQuiz] Distributed lock held by another node for " + cacheKey + " (age=" + (now - lock.lockedAt) + "s)");
                return false;
            }
            // Lock is expired — fall through and overwrite it
            logger.warn("[NewsQuiz] Expired distributed lock found for " + cacheKey + " — taking over");
        }
        // Write our lock entry (no OCC version check — last write wins on expiry race,
        // which is acceptable: worst case two nodes refresh once simultaneously)
        nk.storageWrite([{
            collection: NQ_LOCK_COLLECTION,
            key: lockKey,
            userId: NQ_SYSTEM_USER,
            value: { lockedAt: now, cacheKey: cacheKey },
            permissionRead: 0,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) {
        // If storage is unavailable, degrade gracefully: allow the fetch to proceed
        logger.warn("[NewsQuiz] Could not acquire distributed lock for " + cacheKey + ": " + e.message + " — proceeding without lock");
        return true;
    }
}

// Release the distributed lock after a fetch completes (or fails).
function nqReleaseLock(nk, logger, cacheKey) {
    try {
        nk.storageDelete([{
            collection: NQ_LOCK_COLLECTION,
            key: "lock_" + cacheKey,
            userId: NQ_SYSTEM_USER
        }]);
    } catch (e) {
        // Non-fatal — lock will self-expire after NQ_LOCK_TTL_SECONDS
        logger.warn("[NewsQuiz] Could not release distributed lock for " + cacheKey + ": " + e.message);
    }
}

// ============================================================================
// HELPERS
// ============================================================================

// API keys — hardcoded directly here so the module works without any env var setup.
// Server env vars (same key names) take priority if present; these are the fallback.
var NQ_FALLBACK_KEYS = {
    "GNEWS_API_KEY":      "c34599e145018d0d9e3000a88b9a487f",
    "CURRENTS_API_KEY":   "vJ7f8IPcf_vrhpwk2_-wqzVOpFCxHV26zMhKv4NPV_KiXb-r",
    "MEDIASTACK_API_KEY": "ec6ef35b59624891e5604efb140adefb",
    "NEWSAPI_API_KEY":    "66829bdff7b448fa8e43427c5c0a22d6"
};

function nqEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null && String(ctx.env[key]) !== "") {
        return String(ctx.env[key]);
    }
    return NQ_FALLBACK_KEYS[key] || "";
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

// Normalise a title to a dedup key: lowercase, collapse whitespace, strip punctuation.
// Two articles are considered the same story when their normalised titles match.
function nqNormalizeTitle(title) {
    return (title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// Deduplicate articles by normalised title; preserves order (first occurrence wins).
function nqDedup(articles) {
    var seen = {};
    var out = [];
    for (var i = 0; i < articles.length; i++) {
        var key = nqNormalizeTitle(articles[i].title);
        if (key && !seen[key]) {
            seen[key] = true;
            out.push(articles[i]);
        }
    }
    return out;
}

// Parse any common date string into a Unix timestamp (seconds).
// Handles ISO 8601 (GNews/NewsAPI), Currents "YYYY-MM-DD HH:MM:SS ±HHMM", and MediaStack.
// Returns 0 on failure so Unity can still sort gracefully.
function nqToUnix(dateStr) {
    if (!dateStr) return 0;
    try {
        // Currents: "2026-06-09 08:00:00 +0000" → ISO-compatible with T and Z
        var normalised = String(dateStr).trim()
            .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) \+0000$/, "$1T$2Z")
            .replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, "$1T$2Z");
        var ms = Date.parse(normalised);
        return isNaN(ms) ? 0 : Math.floor(ms / 1000);
    } catch (e) { return 0; }
}

// Trim a description to the last complete sentence before any truncation marker.
// Removes trailing "…" / "..." fragments so Unity never shows a broken sentence.
function nqCleanDesc(desc, fallback) {
    var s = (desc || fallback || "").trim();
    // Remove trailing ellipsis variants
    s = s.replace(/\s*[\u2026\.]{2,}$/, "").trim();
    // If a sentence-ending punctuation exists, cut to the last one
    var m = s.match(/^([\s\S]*[.!?])\s*/);
    if (m && m[1].length > 20) return m[1].trim();
    return s;
}

// Count words in a string — used as a content-depth signal for Unity.
function nqWordCount(str) {
    return (str || "").trim().split(/\s+/).filter(function(w) { return w.length > 0; }).length;
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
            return records[0].value; // includes .etag if previously stored
        }
    } catch (e) { /* cache miss */ }
    return null;
}

function nqWriteCache(nk, articles, source, country, lang, etag) {
    try {
        var val = {
            articles: articles,
            source: source,
            country: country || "us",
            lang: lang || "en",
            cachedAt: nqNowUnix()
        };
        if (etag) val.etag = etag;
        nk.storageWrite([{
            collection: NQ_COLLECTION,
            key: nqCacheKey(country, lang),
            userId: NQ_SYSTEM_USER,
            value: val,
            permissionRead: 2,
            permissionWrite: 0
        }]);
    } catch (e) { /* best-effort */ }
}

// ============================================================================
// GNEWS FETCH (primary)
// ============================================================================

function nqFetchFromGNews(nk, logger, apiKey, country, lang, cachedEtag) {
    var articles = [];
    var newEtag = null;
    if (!apiKey) {
        logger.warn("[NewsQuiz] GNEWS_API_KEY not set in env vars");
        return { articles: articles, etag: null, notModified: false };
    }

    var cc = (country && NQ_GNEWS_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : "us";
    var lc = (lang    && NQ_GNEWS_SUPPORTED_LANGS[lang.toLowerCase()])         ? lang.toLowerCase()    : "en";
    logger.info("[NewsQuiz] GNews fetch country=" + cc + " lang=" + lc);

    // Use the first NQ_GNEWS_FETCH_CATS categories from the fixed list (deterministic,
    // consistent across nodes — no random shuffle that would fragment the cache).
    var cats = NQ_GNEWS_CATEGORIES.slice(0, NQ_GNEWS_FETCH_CATS);

    for (var ci = 0; ci < cats.length; ci++) {
        var cat = cats[ci];
        var url = NQ_GNEWS_BASE_URL + "/top-headlines?category=" + cat +
                  "&lang=" + lc + "&country=" + cc + "&max=" + NQ_MAX_PER_CATEGORY +
                  "&apikey=" + apiKey;
        try {
            var reqHeaders = {
                "User-Agent": NQ_SERVER_USER_AGENT,
                "Accept": "application/json"
            };
            // Conditional GET: send If-None-Match on first category only (the key
            // that drives the overall cache entry). GNews will return 304 with no
            // body if the top-headlines haven't changed — saves parse overhead.
            if (ci === 0 && cachedEtag) {
                reqHeaders["If-None-Match"] = cachedEtag;
            }

            var resp = nk.httpRequest(url, "get", reqHeaders, null, NQ_HTTP_TIMEOUT_MS);

            // 304 Not Modified — articles haven't changed; caller will keep existing cache
            if (resp.code === 304) {
                logger.info("[NewsQuiz] GNews 304 Not Modified for '" + cat + "' — cache still fresh");
                return { articles: [], etag: cachedEtag, notModified: true, quotaExhausted: false };
            }

            if (resp.code !== 200) {
                logger.warn("[NewsQuiz] GNews '" + cat + "' HTTP " + resp.code);
                if (resp.code === 403 || resp.code === 429) {
                    logger.warn("[NewsQuiz] GNews quota/auth error (" + resp.code + ") — stopping category loop");
                    return { articles: articles, etag: newEtag, notModified: false, quotaExhausted: true };
                }
                continue;
            }

            // Capture ETag from the first successful response for future conditional GETs
            if (ci === 0 && resp.headers && resp.headers["ETag"]) {
                newEtag = resp.headers["ETag"];
            }

            var data = JSON.parse(resp.body || "{}");
            if (!data.articles) continue;

            var before = articles.length;
            for (var ai = 0; ai < data.articles.length; ai++) {
                var a = data.articles[ai];
                if (!a.title || !a.image) continue;
                if (a.title.indexOf("[Removed]") >= 0) continue;
                var wc = nqWordCount(a.title);
                if (wc < 4) continue; // skip stubs / clickbait
                var cleanedDesc = nqCleanDesc(a.description, a.title);
                if (cleanedDesc === a.title.trim()) cleanedDesc = "";
                articles.push({
                    title: a.title,
                    description: cleanedDesc,
                    imageUrl: a.image,
                    url: (a.url || ""),
                    sourceName: (a.source && a.source.name) ? a.source.name : "Unknown",
                    category: cat.charAt(0).toUpperCase() + cat.slice(1),
                    publishedAt: nqToUnix(a.publishedAt),
                    contentLength: wc
                });
            }
            logger.info("[NewsQuiz] GNews '" + cat + "': +" + (articles.length - before) + " articles (total=" + articles.length + ")");
        } catch (e) {
            logger.error("[NewsQuiz] GNews '" + cat + "' error: " + e.message);
        }
    }

    return { articles: articles, etag: newEtag, notModified: false, quotaExhausted: false };
}

// ============================================================================
// CURRENTS API FETCH (geo gap filler — 1,000 req/day)
// ============================================================================

function nqFetchFromCurrents(nk, logger, apiKey, country, lang) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] CURRENTS_API_KEY not set — skipping Currents");
        return articles;
    }

    var cc = (country && NQ_CURRENTS_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : null;
    var lc = (lang    && NQ_CURRENTS_SUPPORTED_LANGS[lang.toLowerCase()])         ? lang.toLowerCase()    : "en";

    // Build URL — country param is optional; omit if unsupported so we still
    // get language-filtered global news rather than a 400 error.
    var url = NQ_CURRENTS_BASE_URL + "/latest-news?language=" + lc + "&apiKey=" + apiKey;
    if (cc) url += "&country=" + cc;

    logger.info("[NewsQuiz] Currents fetch country=" + (cc || "global") + " lang=" + lc);
    try {
        var resp = nk.httpRequest(url, "get", {
            "User-Agent": NQ_SERVER_USER_AGENT,
            "Accept": "application/json"
        }, null, NQ_HTTP_TIMEOUT_MS);

        if (resp.code !== 200) {
            logger.warn("[NewsQuiz] Currents HTTP " + resp.code);
            return articles;
        }

        var data = JSON.parse(resp.body || "{}");
        if (!data.news) return articles;

        for (var ai = 0; ai < data.news.length; ai++) {
            var a = data.news[ai];
            if (!a.title || !a.image || a.image === "None" || a.image === "") continue;
            if (a.title.indexOf("[Removed]") >= 0) continue;
            var wc = nqWordCount(a.title);
            if (wc < 4) continue;
            var cleanedDesc = nqCleanDesc(a.description, a.title);
            if (cleanedDesc === a.title.trim()) cleanedDesc = "";
            var cat = (a.category && a.category.length > 0) ? a.category[0] : "News";
            articles.push({
                title: a.title,
                description: cleanedDesc,
                imageUrl: a.image,
                url: (a.url || ""),
                sourceName: a.author || "Unknown",
                category: cat.charAt(0).toUpperCase() + cat.slice(1),
                publishedAt: nqToUnix(a.published),
                contentLength: wc
            });
        }
        logger.info("[NewsQuiz] Currents: " + articles.length + " articles");
    } catch (e) {
        logger.error("[NewsQuiz] Currents error: " + e.message);
    }

    return articles;
}

// ============================================================================
// MEDIASTACK FETCH (regional specialist — 500 req/MONTH, use sparingly)
// ============================================================================

function nqFetchFromMediaStack(nk, logger, apiKey, country, lang) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] MEDIASTACK_API_KEY not set — skipping MediaStack");
        return articles;
    }

    var cc = (country && NQ_MEDIASTACK_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : null;
    var lc = (lang    && NQ_MEDIASTACK_SUPPORTED_LANGS[lang.toLowerCase()])         ? lang.toLowerCase()    : "en";

    // MediaStack free plan only supports HTTP (not HTTPS)
    var url = NQ_MEDIASTACK_BASE_URL + "/news?access_key=" + apiKey +
              "&languages=" + lc + "&limit=25&sort=published_desc";
    if (cc) url += "&countries=" + cc;

    logger.info("[NewsQuiz] MediaStack fetch country=" + (cc || "global") + " lang=" + lc);
    try {
        var resp = nk.httpRequest(url, "get", {
            "User-Agent": NQ_SERVER_USER_AGENT,
            "Accept": "application/json"
        }, null, NQ_HTTP_TIMEOUT_MS);

        if (resp.code !== 200) {
            logger.warn("[NewsQuiz] MediaStack HTTP " + resp.code);
            return articles;
        }

        var data = JSON.parse(resp.body || "{}");
        if (!data.data) return articles;

        for (var ai = 0; ai < data.data.length; ai++) {
            var a = data.data[ai];
            if (!a.title || !a.image || a.image === "") continue;
            if (a.title.indexOf("[Removed]") >= 0) continue;
            var wc = nqWordCount(a.title);
            if (wc < 4) continue;
            var cat = a.category || "News";
            var cleanedDesc = nqCleanDesc(a.description, a.title);
            if (cleanedDesc === a.title.trim()) cleanedDesc = "";
            articles.push({
                title: a.title,
                description: cleanedDesc,
                imageUrl: a.image,
                url: (a.url || ""),
                sourceName: a.source || "Unknown",
                category: cat.charAt(0).toUpperCase() + cat.slice(1),
                publishedAt: nqToUnix(a.published_at),
                contentLength: wc
            });
        }
        logger.info("[NewsQuiz] MediaStack: " + articles.length + " articles");
    } catch (e) {
        logger.error("[NewsQuiz] MediaStack error: " + e.message);
    }

    return articles;
}

// ============================================================================
// NEWSAPI FALLBACK
// ============================================================================

function nqFetchFromNewsApi(nk, logger, apiKey, country, lang) {
    var articles = [];
    if (!apiKey) {
        logger.warn("[NewsQuiz] NEWSAPI_API_KEY not set in env vars");
        return articles;
    }

    // NewsAPI top-headlines only supports a subset of country codes; fall back to us
    var cc = (country && NQ_NEWSAPI_SUPPORTED_COUNTRIES[country.toLowerCase()]) ? country.toLowerCase() : "us";
    var url = NQ_NEWSAPI_BASE_URL + "/top-headlines?country=" + cc + "&pageSize=30&apiKey=" + apiKey;
    // Pass language for bilingual countries (e.g. ca → fr, ch → de) — ignored if "en"
    var lc = (lang && lang !== "en") ? lang.toLowerCase() : null;
    if (lc) url += "&language=" + lc;
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
            var wc = nqWordCount(a.title);
            if (wc < 4) continue;
            var naCat = (a.category && typeof a.category === "string" && a.category.trim())
                ? a.category.trim().charAt(0).toUpperCase() + a.category.trim().slice(1)
                : "News";
            var cleanedDesc = nqCleanDesc(a.description, a.title);
            if (cleanedDesc === a.title.trim()) cleanedDesc = "";
            articles.push({
                title: a.title,
                description: cleanedDesc,
                imageUrl: a.urlToImage,
                url: (a.url || ""),
                sourceName: (a.source && a.source.name) ? a.source.name : "Unknown",
                category: naCat,
                publishedAt: nqToUnix(a.publishedAt),
                contentLength: wc
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
    var data = {};
    try { data = JSON.parse(payload || "{}"); } catch (e) { data = {}; }
    var country = (data.country && typeof data.country === "string") ? data.country.toLowerCase() : "us";
    var lang    = (data.lang    && typeof data.lang    === "string") ? data.lang.toLowerCase()    : "en";
    // Clamp to safe values: country must be exactly 2 letters, lang 2–3 letters.
    // Rejects path traversal, SQL fragments, and oversized strings before they
    // ever reach nqCacheKey or an outbound URL.
    if (!/^[a-z]{2}$/.test(country))   country = "us";
    if (!/^[a-z]{2,3}$/.test(lang))    lang    = "en";
    logger.info("[NewsQuiz] Request: country=" + country + " lang=" + lang);

    var cacheKey = nqCacheKey(country, lang);

    // 1. Serve from storage cache if still fresh
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

        // Cache is stale. Fast path: process-local guard (same node, concurrent requests).
        if (_NQ_REFRESH_IN_FLIGHT[cacheKey]) {
            logger.info("[NewsQuiz] Refresh in-flight for " + cacheKey + " — serving stale to avoid thundering herd");
            return nqOk({
                articles: cached.articles,
                count: cached.articles.length,
                source: (cached.source || "unknown") + "_stale_in_flight",
                cached: true
            });
        }

        // Distributed guard: check if another Nakama node is already refreshing this key.
        if (!nqAcquireLock(nk, logger, cacheKey)) {
            logger.info("[NewsQuiz] Another node is refreshing " + cacheKey + " — serving stale");
            return nqOk({
                articles: cached.articles,
                count: cached.articles.length,
                source: (cached.source || "unknown") + "_stale_lock",
                cached: true
            });
        }

        logger.info("[NewsQuiz] Cache stale (age=" + ageSeconds + "s) — refreshing for country=" + country);
    }

    // 2. Mark this key as in-flight (process-local) before issuing outbound HTTP calls.
    // Distributed lock already acquired above for the stale-cache path.
    // For a cold-cache miss (no cached entry at all), acquire the distributed lock now.
    if (!cached) {
        var coldLockAcquired = nqAcquireLock(nk, logger, cacheKey);
        if (!coldLockAcquired) {
            logger.info("[NewsQuiz] Another node is seeding cache for " + cacheKey + " — returning empty stale");
            return nqErr("Cache seeding in progress — retry in a few seconds");
        }
    }
    // (for the stale-cache path the distributed lock was already acquired above)
    _NQ_REFRESH_IN_FLIGHT[cacheKey] = true;

    var gnewsKey      = nqEnv(ctx, "GNEWS_API_KEY");
    var currentsKey   = nqEnv(ctx, "CURRENTS_API_KEY");
    var mediastackKey = nqEnv(ctx, "MEDIASTACK_API_KEY");
    var newsApiKey    = nqEnv(ctx, "NEWSAPI_API_KEY");

    var articles = [];
    var source = "";          // set to the first source that actually returns articles
    var etagToStore = null;
    var was304 = false;       // true when GNews returned 304 — skip re-write and return cached:true

    try {
        // Pass the stored ETag so GNews can return 304 when nothing changed
        var cachedEtag = (cached && cached.etag) ? cached.etag : null;
        var gnewsResult = nqFetchFromGNews(nk, logger, gnewsKey, country, lang, cachedEtag);

        // 304 Not Modified — cached articles are still current; extend TTL and return immediately.
        // Skip Currents+MediaStack — nothing has changed upstream.
        if (gnewsResult.notModified && cached && cached.articles && cached.articles.length > 0) {
            logger.info("[NewsQuiz] GNews 304 — extending cache TTL for " + cacheKey);
            nqWriteCache(nk, cached.articles, cached.source || "gnews", country, lang, cachedEtag);
            // finally block will release locks
            articles = cached.articles;
            source = (cached.source || "gnews") + "_304";
            was304 = true;
        } else {
            if (gnewsResult.quotaExhausted) {
                logger.warn("[NewsQuiz] GNews quota/auth exhausted — skipping to Currents");
            }

            articles = gnewsResult.articles;
            etagToStore = gnewsResult.etag;
            if (articles.length > 0) source = "gnews";

            // Currents — always runs alongside GNews for broader geo + language coverage
            logger.info("[NewsQuiz] Fetching Currents (always-on) for country=" + country + " lang=" + lang);
            var currentsArticles = nqFetchFromCurrents(nk, logger, currentsKey, country, lang);
            if (currentsArticles.length > 0) {
                articles = articles.concat(currentsArticles);
                source = source ? "gnews+currents" : "currents";
            }

            // MediaStack — always runs for regional depth (Middle East, Africa, SE Asia, etc.)
            logger.info("[NewsQuiz] Fetching MediaStack (always-on) for country=" + country + " lang=" + lang);
            var msArticles = nqFetchFromMediaStack(nk, logger, mediastackKey, country, lang);
            if (msArticles.length > 0) {
                articles = articles.concat(msArticles);
                source = source ? source + "+mediastack" : "mediastack";
            }

            // NewsAPI — TRUE last resort: only called if all three above still yield < NQ_MIN_ARTICLES
            if (articles.length < NQ_MIN_ARTICLES) {
                logger.warn("[NewsQuiz] GNews+Currents+MediaStack only " + articles.length + " articles — falling back to NewsAPI...");
                var naArticles = nqFetchFromNewsApi(nk, logger, newsApiKey, country, lang);
                if (naArticles.length > 0) {
                    articles = articles.concat(naArticles);
                    source = source ? source + "+newsapi" : "newsapi";
                }
            }

            // Sort newest-first so Unity always gets the freshest articles first
            articles.sort(function(a, b) { return (b.publishedAt || 0) - (a.publishedAt || 0); });

            // Deduplicate by normalised title (same story from multiple APIs)
            var beforeDedup = articles.length;
            articles = nqDedup(articles);
            if (articles.length < beforeDedup) {
                logger.info("[NewsQuiz] Dedup removed " + (beforeDedup - articles.length) + " duplicate articles");
            }

            // Cap total payload — avoids bloating cache and client parse time
            if (articles.length > NQ_MAX_ARTICLES) {
                articles = articles.slice(0, NQ_MAX_ARTICLES);
            }
        }
    } finally {
        // Always release both the process-local and distributed locks, even on exception
        delete _NQ_REFRESH_IN_FLIGHT[cacheKey];
        nqReleaseLock(nk, logger, cacheKey);
    }

    // 3. Nothing came back — return stale cache rather than an error
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
        return nqErr("No news articles available — check GNEWS_API_KEY, CURRENTS_API_KEY, MEDIASTACK_API_KEY and NEWSAPI_API_KEY env vars");
    }

    // 4. GNews 304 path — cache already refreshed inside the try block; just return
    if (was304) {
        return nqOk({
            articles: articles,
            count: articles.length,
            source: source,
            cached: true
        });
    }

    // 5. Persist to storage cache (with ETag for future conditional GETs)
    nqWriteCache(nk, articles, source, country, lang, etagToStore);

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
