/**
 * External Analytics Integration Module
 * Fetches analytics data from Appodeal, Apple App Store Connect, and Unity.
 *
 * RPCs:
 *   - analytics_appodeal           : Fetch ad stats from Appodeal Reporting API (live)
 *   - analytics_apple_appstore     : Read cached App Store Connect data from storage
 *   - analytics_unity              : Read cached Unity Analytics data
 *   - unity_analytics_import       : Import Unity Analytics data from external export
 *   - apple_appstore_import        : Import Apple App Store data from external fetcher
 *
 * QuizVerse App Keys (Appodeal):
 *   Android: 7a1ba193e83636aea003883115a8e95a34308e9eb77ade1e
 *   iOS:     515538dba6c331557f2822d821f99230ddbe539f75e90b88
 *
 * Unity Project ID: 3a1d54d0-7210-4cbc-9def-e741210d9f21
 *
 * Environment variables (docker-compose):
 *   APPODEAL_API_KEY, APPODEAL_USER_ID, APPODEAL_QUIZVERSE_APP_KEY,
 *   APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY, APPLE_QUIZVERSE_BUNDLE_ID,
 *   UNITY_QUIZVERSE_PROJECT_ID
 */

var EXTERNAL_ANALYTICS_COLLECTION = "external_analytics";
var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// QuizVerse Appodeal app keys (both platforms)
var QUIZVERSE_APPODEAL_KEYS = {
    android: "7a1ba193e83636aea003883115a8e95a34308e9eb77ade1e",
    ios: "515538dba6c331557f2822d821f99230ddbe539f75e90b88"
};

// ─── Helpers ──────────────────────────────────────────────

function externalDateRange(payload) {
    var data = {};
    try { data = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }
    var now = new Date();
    var days = parseInt(data.days, 10) || 7;
    var to = now.toISOString().slice(0, 10);
    var from = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
    if (data.date_from) { from = data.date_from; }
    if (data.date_to) { to = data.date_to; }
    return { from: from, to: to, days: days, raw: data };
}

function storageRead(nk, collection, key) {
    var objects = nk.storageRead([{
        collection: collection,
        key: key,
        userId: SYSTEM_USER_ID
    }]);
    if (objects && objects.length > 0) {
        return objects[0].value;
    }
    return null;
}

function storageWrite(nk, collection, key, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: SYSTEM_USER_ID,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

// ─── Appodeal ─────────────────────────────────────────────

/**
 * Helper: Submit a single Appodeal stats request and poll for results.
 * Returns the data array or null on failure.
 */
function appodealFetchStats(nk, logger, apiKey, userId, dateFrom, dateTo, appKeys, detalisation) {
    // Build URL
    var url = "https://api-services.appodeal.com/api/v2/stats_api" +
        "?api_key=" + apiKey +
        "&user_id=" + userId +
        "&date_from=" + dateFrom +
        "&date_to=" + dateTo;

    // Add detalisation params
    for (var d = 0; d < detalisation.length; d++) {
        url += "&detalisation%5B%5D=" + detalisation[d];
    }

    // Add app key filters
    for (var a = 0; a < appKeys.length; a++) {
        url += "&app%5B%5D=" + appKeys[a];
    }

    logger.info("[Appodeal] Submitting: " + dateFrom + " to " + dateTo + " apps=" + appKeys.length);
    var submitResp = nk.httpRequest(url, "get", {}, "");
    var submitBody = {};
    try { submitBody = JSON.parse(submitResp.body); } catch (e) {
        logger.error("[Appodeal] Parse error: " + e.message);
        return null;
    }

    // Error check
    if (submitBody.code && submitBody.code !== 0) {
        logger.error("[Appodeal] API error: " + submitBody.message);
        return null;
    }

    // Direct data (fast query)
    if (submitBody.data) {
        return submitBody.data;
    }

    // Async: poll task_id
    if (submitBody.task_id) {
        var taskId = submitBody.task_id;
        var maxAttempts = 15;
        var taskReady = false;

        for (var attempt = 0; attempt < maxAttempts; attempt++) {
            var checkUrl = "https://api-services.appodeal.com/api/v2/check_status" +
                "?api_key=" + apiKey +
                "&user_id=" + userId +
                "&task_id=" + taskId;
            var checkResp = nk.httpRequest(checkUrl, "get", {}, "");
            var checkBody = {};
            try { checkBody = JSON.parse(checkResp.body); } catch (e) { continue; }

            // task_status "1" = ready
            if (checkBody.task_status === "1" || checkBody.task_status === 1) {
                taskReady = true;
                break;
            }
        }

        if (!taskReady) {
            logger.warn("[Appodeal] Task " + taskId + " not ready after " + maxAttempts + " polls");
            return null;
        }

        // Fetch results
        var resultUrl = "https://api-services.appodeal.com/api/v2/output_result" +
            "?api_key=" + apiKey +
            "&user_id=" + userId +
            "&task_id=" + taskId;
        var resultResp = nk.httpRequest(resultUrl, "get", {}, "");
        var resultBody = {};
        try { resultBody = JSON.parse(resultResp.body); } catch (e) {
            logger.error("[Appodeal] Result parse error: " + e.message);
            return null;
        }

        if (resultBody.code === 0 && resultBody.data) {
            return resultBody.data;
        }
        return resultBody.data || null;
    }

    return null;
}

/**
 * RPC: analytics_appodeal
 * Fetches QuizVerse ad revenue stats from Appodeal Reporting API.
 * Fetches BOTH Android and iOS data.
 *
 * Payload: { days?: number, date_from?: string, date_to?: string, platform?: "all"|"android"|"ios" }
 *
 * Response fields per row:
 *   date, app_key, app_name, package_name, platform, 
 *   requests, fills, impressions, fillrate, clicks, ctr, views, revenue, ecpm
 */
function rpcAnalyticsAppodeal(ctx, logger, nk, payload) {
    try {
        var apiKey = ctx.env['APPODEAL_API_KEY'] || '';
        var userId = ctx.env['APPODEAL_USER_ID'] || '';
        if (!apiKey || !userId) {
            return JSON.stringify({
                success: false,
                error: "Appodeal credentials not configured. Set APPODEAL_API_KEY and APPODEAL_USER_ID in .env file.",
                setup: {
                    step1: "Open https://www.appodeal.com/profile/api_credentials",
                    step2: "Copy API Key and User ID",
                    step3: "Set in .env: APPODEAL_API_KEY=xxx, APPODEAL_USER_ID=xxx"
                }
            });
        }

        var range = externalDateRange(payload);
        var platform = range.raw.platform || "all";

        // Determine which app keys to fetch
        var appKeys = [];
        if (platform === "android") {
            appKeys.push(QUIZVERSE_APPODEAL_KEYS.android);
        } else if (platform === "ios") {
            appKeys.push(QUIZVERSE_APPODEAL_KEYS.ios);
        } else {
            // Fetch both platforms
            appKeys.push(QUIZVERSE_APPODEAL_KEYS.android);
            appKeys.push(QUIZVERSE_APPODEAL_KEYS.ios);
        }

        // Allow explicit app_key from payload to override (for custom queries)
        var customKey = range.raw.app_key || '';
        if (customKey) {
            appKeys = [customKey];
        }

        // Fetch with date + app detalisation (per day, per app)
        var data = appodealFetchStats(nk, logger, apiKey, userId, range.from, range.to, appKeys, ["date", "app"]);

        if (!data) {
            // Try reading from cache
            var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "appodeal_latest");
            if (cached) {
                return JSON.stringify({
                    success: true,
                    source: "appodeal",
                    from_cache: true,
                    fetched_at: cached.fetched_at || "unknown",
                    data: cached.results || cached
                });
            }
            return JSON.stringify({
                success: false,
                error: "Appodeal task still processing or no data. Try again in a few seconds.",
                hint: "If this persists, check Appodeal credentials and API status."
            });
        }

        // Calculate aggregated totals
        var totalRevenue = 0, totalImpressions = 0, totalClicks = 0, totalRequests = 0;
        var androidRevenue = 0, iosRevenue = 0;
        for (var i = 0; i < data.length; i++) {
            var row = data[i];
            totalRevenue += parseFloat(row.revenue || 0);
            totalImpressions += parseInt(row.impressions || 0, 10);
            totalClicks += parseInt(row.clicks || 0, 10);
            totalRequests += parseInt(row.requests || 0, 10);
            if (row.platform === "Google") { androidRevenue += parseFloat(row.revenue || 0); }
            if (row.platform === "Apple") { iosRevenue += parseFloat(row.revenue || 0); }
        }

        var result = {
            success: true,
            source: "appodeal",
            from_cache: false,
            date_from: range.from,
            date_to: range.to,
            summary: {
                total_revenue: parseFloat(totalRevenue.toFixed(4)),
                android_revenue: parseFloat(androidRevenue.toFixed(4)),
                ios_revenue: parseFloat(iosRevenue.toFixed(4)),
                total_impressions: totalImpressions,
                total_clicks: totalClicks,
                total_requests: totalRequests,
                avg_ecpm: totalImpressions > 0 ? parseFloat((totalRevenue / totalImpressions * 1000).toFixed(2)) : 0,
                avg_fillrate: totalRequests > 0 ? parseFloat((totalImpressions / totalRequests * 100).toFixed(1)) : 0
            },
            data: data
        };

        // Cache the results
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "appodeal_latest", {
            fetched_at: new Date().toISOString(),
            date_from: range.from,
            date_to: range.to,
            results: data,
            summary: result.summary
        });
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "appodeal_" + range.from + "_" + range.to, {
            fetched_at: new Date().toISOString(),
            results: data
        });

        return JSON.stringify(result);

    } catch (err) {
        logger.error("[ExternalAnalytics] Appodeal error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Apple App Store Connect ──────────────────────────────

/**
 * RPC: analytics_apple_appstore
 * Reads cached App Store Connect data from Nakama storage.
 * Data is populated by:
 *   1. External script: node scripts/apple_data_fetcher.js
 *   2. Import RPC: apple_appstore_import
 *
 * Note: App Store Connect API requires ES256 JWT signing,
 * which is not available in Nakama's Goja JS runtime.
 *
 * Payload: { days?: number, date_from?: string, date_to?: string, metric?: string }
 */
function rpcAnalyticsAppleAppstore(ctx, logger, nk, payload) {
    try {
        var range = externalDateRange(payload);
        var metric = range.raw.metric || "all";
        var bundleId = ctx.env['APPLE_QUIZVERSE_BUNDLE_ID'] || 'com.intelliversex.quizverse';

        // Read cached data written by external fetcher or import RPC
        var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "apple_quizverse_latest");
        if (!cached) {
            cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "apple_latest");
        }

        if (!cached) {
            // Check if Apple credentials are configured
            var hasCredentials = ctx.env['APPLE_KEY_ID'] && ctx.env['APPLE_ISSUER_ID'] && ctx.env['APPLE_PRIVATE_KEY'];
            return JSON.stringify({
                success: false,
                error: "No Apple App Store data cached.",
                credentials_configured: !!hasCredentials,
                bundle_id: bundleId,
                how_to_populate: {
                    option1: "Run: cd scripts && node apple_data_fetcher.js",
                    option2: "Call RPC: apple_appstore_import with {data: {...}}",
                    option3: "Export from App Store Connect → Analytics → Download"
                }
            });
        }

        // Filter by metric if requested
        if (metric !== "all" && cached.metrics) {
            var filtered = {};
            filtered[metric] = cached.metrics[metric];
            return JSON.stringify({
                success: true,
                source: "apple_appstore",
                bundle_id: bundleId,
                fetched_at: cached.fetched_at || "unknown",
                data: filtered
            });
        }

        return JSON.stringify({
            success: true,
            source: "apple_appstore",
            bundle_id: bundleId,
            fetched_at: cached.fetched_at || "unknown",
            data: cached
        });

    } catch (err) {
        logger.error("[ExternalAnalytics] Apple error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: apple_appstore_import
 * Import Apple App Store data (from apple_data_fetcher.js or manual export).
 * Payload: { data: {...}, source?: string }
 */
function rpcAppleImport(ctx, logger, nk, payload) {
    try {
        var input = {};
        try { input = JSON.parse(payload || '{}'); } catch (e) {
            return JSON.stringify({ success: false, error: "Invalid JSON payload" });
        }

        if (!input.data) {
            return JSON.stringify({ success: false, error: "Missing 'data' field in payload" });
        }

        var cacheData = {
            fetched_at: new Date().toISOString(),
            source: input.source || "manual_import",
            metrics: input.data.metrics || input.data,
            apps: input.data.apps || []
        };

        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "apple_quizverse_latest", cacheData);
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "apple_latest", cacheData);

        logger.info("[ExternalAnalytics] Apple data imported successfully");
        return JSON.stringify({ success: true, message: "Apple App Store data imported" });

    } catch (err) {
        logger.error("[ExternalAnalytics] Apple import error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Unity Gaming Services ───────────────────────────────

/**
 * RPC: analytics_unity
 * Reads Unity Analytics data from cache.
 * 
 * NOTE: Unity Analytics REST API is for SUBMITTING events only, not reading.
 * To populate data, use unity_analytics_import RPC or external script.
 * 
 * Project ID: 3a1d54d0-7210-4cbc-9def-e741210d9f21 (QuizVerse)
 * 
 * Payload: { days?: number }
 */
function rpcAnalyticsUnity(ctx, logger, nk, payload) {
    try {
        var range = externalDateRange(payload);
        var projectId = ctx.env['UNITY_QUIZVERSE_PROJECT_ID'] || '3a1d54d0-7210-4cbc-9def-e741210d9f21';
        
        // Read cached data (populated by external script or unity_analytics_import RPC)
        var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_quizverse_latest");
        if (!cached) {
            cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_latest");
        }

        if (!cached) {
            return JSON.stringify({
                success: false,
                error: "No Unity Analytics data cached.",
                hint: "Unity Analytics API only supports event submission, not reading. Export data from Unity Dashboard (cloud.unity.com) → Analytics → Data Export, then use unity_analytics_import RPC to load it.",
                project_id: projectId
            });
        }

        return JSON.stringify({
            success: true,
            source: "unity_analytics",
            from_cache: true,
            project_id: projectId,
            fetched_at: cached.fetched_at || "unknown",
            data: cached
        });

    } catch (err) {
        logger.error("[ExternalAnalytics] Unity error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: unity_analytics_import
 * Import Unity Analytics data (exported from Unity Dashboard).
 * Call this from admin panel or script after exporting data from Unity Cloud.
 * 
 * Payload: { data: {...}, source?: string }
 */
function rpcUnityAnalyticsImport(ctx, logger, nk, payload) {
    try {
        var input = {};
        try { input = JSON.parse(payload || '{}'); } catch (e) {
            return JSON.stringify({ success: false, error: "Invalid JSON payload" });
        }
        
        if (!input.data) {
            return JSON.stringify({ success: false, error: "Missing 'data' field in payload" });
        }
        
        var cacheKey = "unity_quizverse_latest";
        var cacheData = {
            fetched_at: new Date().toISOString(),
            source: input.source || "manual_import",
            data: input.data
        };
        
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, cacheKey, cacheData);
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_latest", cacheData);
        
        logger.info("[ExternalAnalytics] Unity analytics data imported successfully");
        return JSON.stringify({ success: true, message: "Unity analytics data imported", key: cacheKey });
        
    } catch (err) {
        logger.error("[ExternalAnalytics] Unity import error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Google Play Console import ───────────────────────────
//
// Google Play Developer Reporting API requires OAuth2 with a service account
// (RS256-signed JWTs), which Goja cannot compute at runtime. The recommended
// flow is an external Node.js script (scripts/play_data_fetcher.js) that
// fetches from the Reporting API and POSTs the result to this import RPC.
//
// Alternatively, export a CSV from Play Console → Statistics → Installs,
// parse it with the same script, and call this RPC with the JSON payload.
//
// Stored snapshot keys:
//   external_analytics / play_quizverse_latest   — latest cumulative snapshot
//   external_analytics / play_<gameId>_<date>    — per-date snapshots
//
// Payload: {
//   data: {
//     total_installs?: number,   // cumulative lifetime installs
//     installs_7d?:   number,    // last 7-day installs
//     installs?:      number,    // alias for total_installs
//     active_users?:  number,    // current active install count
//     rating?:        number,    // avg store rating
//     ratings_count?: number,    // total rating count
//     crashes_7d?:    number,    // last 7-day crash count
//     country_breakdown?: [{country, installs}],
//     date_range?: { from, to }
//   },
//   source?: string,             // "play_data_fetcher" | "manual_csv" | etc.
//   gameId?: string
// }
function rpcPlayConsoleImport(ctx, logger, nk, payload) {
    try {
        var input = {};
        try { input = JSON.parse(payload || '{}'); } catch (e) {
            return JSON.stringify({ success: false, error: "Invalid JSON" });
        }
        if (!input.data) {
            return JSON.stringify({ success: false, error: "Missing 'data' field. Payload must be { data: { total_installs, installs_7d, ... } }" });
        }

        var gameId = input.gameId || ctx.env['DEFAULT_GAME_ID'] || "126bf539-dae2-4bcf-964d-316c0fa1f92b";
        var now    = new Date().toISOString();
        var today  = now.slice(0, 10);

        var snapshot = {
            provider:        "play_console",
            gameId:          gameId,
            fetched_at:      now,
            source:          input.source || "manual",
            total_installs:  input.data.total_installs || input.data.installs || 0,
            installs_7d:     input.data.installs_7d || 0,
            active_users:    input.data.active_users || 0,
            rating:          input.data.rating || 0,
            ratings_count:   input.data.ratings_count || 0,
            crashes_7d:      input.data.crashes_7d || 0,
            country_breakdown: input.data.country_breakdown || [],
            date_range:      input.data.date_range || { from: today, to: today },
            raw:             input.data
        };

        // Write latest + dated snapshot
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "play_quizverse_latest", snapshot);
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "play_" + gameId + "_" + today, snapshot);

        logger.info("[ExternalAnalytics] Play Console import: total=" + snapshot.total_installs + " source=" + snapshot.source);
        return JSON.stringify({
            success: true,
            message: "Google Play Console data imported",
            total_installs: snapshot.total_installs,
            keys: ["play_quizverse_latest", "play_" + gameId + "_" + today]
        });
    } catch (err) {
        logger.error("[ExternalAnalytics] Play import error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: analytics_play_console
 * Read cached Play Console data from storage (mirrors analytics_apple_appstore).
 */
function rpcAnalyticsPlayConsole(ctx, logger, nk, payload) {
    try {
        var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "play_quizverse_latest") ||
                     storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "play_latest");
        if (!cached) {
            return JSON.stringify({
                success: false,
                error: "No Google Play Console data cached.",
                how_to_populate: {
                    option1: "Run: node scripts/play_data_fetcher.js  (fetches via Developer Reporting API)",
                    option2: "Call RPC: play_console_import with { data: { total_installs, installs_7d, ... } }",
                    option3: "Export CSV from Play Console → Statistics → Installs, then call play_console_import"
                }
            });
        }
        return JSON.stringify({ success: true, source: "play_console", data: cached });
    } catch (err) {
        logger.error("[ExternalAnalytics] Play Console read error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Registration ─────────────────────────────────────────
// postbuild.js scans for initializer.registerRpc() calls

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_appodeal",       rpcAnalyticsAppodeal);
    initializer.registerRpc("analytics_apple_appstore", rpcAnalyticsAppleAppstore);
    initializer.registerRpc("apple_appstore_import",    rpcAppleImport);
    initializer.registerRpc("analytics_unity",          rpcAnalyticsUnity);
    initializer.registerRpc("unity_analytics_import",   rpcUnityAnalyticsImport);
    initializer.registerRpc("play_console_import",      rpcPlayConsoleImport);
    initializer.registerRpc("analytics_play_console",   rpcAnalyticsPlayConsole);
    logger.info("[ExternalAnalytics] Module registered: 7 RPCs (appodeal, apple, apple_import, unity, unity_import, play_import, play_console)");
}
