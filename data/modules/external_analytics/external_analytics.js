/**
 * External Analytics Integration Module
 * Fetches analytics data from Appodeal, Apple App Store Connect, and Unity.
 *
 * RPCs:
 *   - analytics_appodeal         : Fetch ad stats from Appodeal Reporting API
 *   - analytics_apple_appstore   : Read cached App Store Connect data from storage
 *   - analytics_unity            : Fetch data from Unity Gaming Services API
 *
 * Environment variables (docker-compose):
 *   APPODEAL_API_KEY, APPODEAL_USER_ID,
 *   APPLE_KEY_ID, APPLE_ISSUER_ID, APPLE_PRIVATE_KEY,
 *   UNITY_KEY_ID, UNITY_SECRET_KEY
 */

var EXTERNAL_ANALYTICS_COLLECTION = "external_analytics";
var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

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
 * RPC: analytics_appodeal
 * Fetches ad revenue stats from Appodeal Reporting API.
 * Payload: { days?: number, date_from?: string, date_to?: string }
 */
function rpcAnalyticsAppodeal(ctx, logger, nk, payload) {
    try {
        var apiKey = ctx.env['APPODEAL_API_KEY'] || '';
        var userId = ctx.env['APPODEAL_USER_ID'] || '';
        if (!apiKey || !userId) {
            return JSON.stringify({
                success: false,
                error: "Appodeal credentials not configured"
            });
        }

        var range = externalDateRange(payload);

        // Step 1: Submit stats request
        var submitUrl = "https://api-services.appodeal.com/api/v2/stats_api" +
            "?api_key=" + apiKey +
            "&user_id=" + userId +
            "&date_from=" + range.from +
            "&date_to=" + range.to +
            "&group_by=date" +
            "&format=json";

        logger.info("[ExternalAnalytics] Appodeal: submitting stats request " + range.from + " to " + range.to);
        var submitResp = nk.httpRequest(submitUrl, "get", {}, "");
        var submitBody = {};
        try { submitBody = JSON.parse(submitResp.body); } catch (e) {
            logger.error("[ExternalAnalytics] Appodeal submit parse error: " + e.message);
            return JSON.stringify({ success: false, error: "Appodeal API parse error" });
        }

        // If the response has results directly (some endpoints return inline)
        if (submitBody.results || submitBody.data) {
            var results = submitBody.results || submitBody.data;
            var cacheKey = "appodeal_" + range.from + "_" + range.to;
            storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, cacheKey, {
                fetched_at: new Date().toISOString(),
                date_from: range.from,
                date_to: range.to,
                results: results
            });
            return JSON.stringify({ success: true, source: "appodeal", data: results });
        }

        // Async flow: task_id based polling
        if (submitBody.task_id) {
            var taskId = submitBody.task_id;
            var maxAttempts = 10;
            var attempt = 0;
            var taskDone = false;
            var taskResult = null;

            while (attempt < maxAttempts && !taskDone) {
                attempt++;
                // Small delay via a lightweight noop (Goja has no setTimeout)
                var checkUrl = "https://api-services.appodeal.com/api/v2/stats_api/check_status" +
                    "?api_key=" + apiKey +
                    "&task_id=" + taskId;
                var checkResp = nk.httpRequest(checkUrl, "get", {}, "");
                var checkBody = {};
                try { checkBody = JSON.parse(checkResp.body); } catch (e) { /* retry */ }

                if (checkBody.status === "completed" || checkBody.state === "completed") {
                    taskDone = true;
                } else if (checkBody.status === "failed" || checkBody.state === "failed") {
                    return JSON.stringify({ success: false, error: "Appodeal task failed" });
                }
            }

            if (!taskDone) {
                return JSON.stringify({
                    success: false,
                    error: "Appodeal task not completed after " + maxAttempts + " attempts",
                    task_id: taskId
                });
            }

            // Step 3: Fetch results
            var resultUrl = "https://api-services.appodeal.com/api/v2/stats_api/output_result" +
                "?api_key=" + apiKey +
                "&task_id=" + taskId;
            var resultResp = nk.httpRequest(resultUrl, "get", {}, "");
            var resultBody = {};
            try { resultBody = JSON.parse(resultResp.body); } catch (e) {
                return JSON.stringify({ success: false, error: "Appodeal result parse error" });
            }

            taskResult = resultBody.results || resultBody.data || resultBody;
            var cacheKey2 = "appodeal_" + range.from + "_" + range.to;
            storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, cacheKey2, {
                fetched_at: new Date().toISOString(),
                date_from: range.from,
                date_to: range.to,
                results: taskResult
            });
            return JSON.stringify({ success: true, source: "appodeal", data: taskResult });
        }

        // Fallback: return whatever we got
        return JSON.stringify({ success: true, source: "appodeal", data: submitBody });

    } catch (err) {
        logger.error("[ExternalAnalytics] Appodeal error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Apple App Store Connect ──────────────────────────────

/**
 * RPC: analytics_apple_appstore
 * Reads cached App Store Connect data from Nakama storage.
 * Data is populated by an external Node.js script (apple_data_fetcher.js)
 * because App Store Connect API requires ES256 JWT signing,
 * which is not available in Nakama's Goja JS runtime.
 *
 * Payload: { days?: number, date_from?: string, date_to?: string, metric?: string }
 */
function rpcAnalyticsAppleAppstore(ctx, logger, nk, payload) {
    try {
        var range = externalDateRange(payload);
        var metric = range.raw.metric || "all";

        // Read cached data written by external fetcher
        var cacheKey = "apple_latest";
        var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, cacheKey);

        if (!cached) {
            // Try date-specific key
            cacheKey = "apple_" + range.from + "_" + range.to;
            cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, cacheKey);
        }

        if (!cached) {
            return JSON.stringify({
                success: false,
                error: "No Apple App Store data cached. Run apple_data_fetcher.js to populate data.",
                hint: "node scripts/apple_data_fetcher.js"
            });
        }

        // Filter by metric if requested
        if (metric !== "all" && cached.metrics) {
            var filtered = {};
            filtered[metric] = cached.metrics[metric];
            return JSON.stringify({
                success: true,
                source: "apple_appstore",
                fetched_at: cached.fetched_at || "unknown",
                data: filtered
            });
        }

        return JSON.stringify({
            success: true,
            source: "apple_appstore",
            fetched_at: cached.fetched_at || "unknown",
            data: cached
        });

    } catch (err) {
        logger.error("[ExternalAnalytics] Apple error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Unity Gaming Services ───────────────────────────────

/**
 * RPC: analytics_unity
 * Fetches data from Unity Gaming Services REST API using Basic auth.
 * Payload: { days?: number, date_from?: string, date_to?: string }
 */
function rpcAnalyticsUnity(ctx, logger, nk, payload) {
    try {
        var keyId = ctx.env['UNITY_KEY_ID'] || '';
        var secretKey = ctx.env['UNITY_SECRET_KEY'] || '';
        if (!keyId || !secretKey) {
            return JSON.stringify({
                success: false,
                error: "Unity credentials not configured"
            });
        }

        var range = externalDateRange(payload);

        // Build Basic auth header: base64(keyId:secretKey)
        // Goja doesn't have btoa, but nk.httpRequest handles headers directly.
        // We pass the pre-encoded Authorization header from env if available.
        var authHeader = ctx.env['UNITY_AUTH_HEADER'] || '';
        if (!authHeader) {
            // Fallback: construct from key:secret (base64 encoded in env)
            return JSON.stringify({
                success: false,
                error: "UNITY_AUTH_HEADER not configured. Set base64(keyId:secretKey) as env var."
            });
        }

        // Unity IAP Validation / Analytics endpoint
        // This calls the Unity Gaming Services API for purchase/revenue data
        var baseUrl = "https://services.api.unity.com";
        var headers = {
            "Authorization": "Basic " + authHeader,
            "Content-Type": "application/json"
        };

        // Try to fetch revenue/IAP data from Unity
        var iapUrl = baseUrl + "/iap/v1/purchases?startDate=" + range.from + "&endDate=" + range.to;
        logger.info("[ExternalAnalytics] Unity: fetching " + range.from + " to " + range.to);

        var resp = nk.httpRequest(iapUrl, "get", headers, "");
        var body = {};
        try { body = JSON.parse(resp.body); } catch (e) {
            // If this endpoint doesn't work, try to read from cache
            logger.warn("[ExternalAnalytics] Unity API response not JSON, checking cache");
            var cached = storageRead(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_latest");
            if (cached) {
                return JSON.stringify({
                    success: true,
                    source: "unity",
                    from_cache: true,
                    fetched_at: cached.fetched_at || "unknown",
                    data: cached
                });
            }
            return JSON.stringify({ success: false, error: "Unity API error and no cached data" });
        }

        // Cache the result
        var cacheData = {
            fetched_at: new Date().toISOString(),
            date_from: range.from,
            date_to: range.to,
            results: body
        };
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_latest", cacheData);
        storageWrite(nk, EXTERNAL_ANALYTICS_COLLECTION, "unity_" + range.from + "_" + range.to, cacheData);

        return JSON.stringify({ success: true, source: "unity", data: body });

    } catch (err) {
        logger.error("[ExternalAnalytics] Unity error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ─── Registration ─────────────────────────────────────────
// postbuild.js scans for initializer.registerRpc() calls

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_appodeal", rpcAnalyticsAppodeal);
    initializer.registerRpc("analytics_apple_appstore", rpcAnalyticsAppleAppstore);
    initializer.registerRpc("analytics_unity", rpcAnalyticsUnity);
    logger.info("[ExternalAnalytics] Module registered: 3 RPCs");
}
