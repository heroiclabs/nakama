// analytics_admin.js — Admin-only RPCs for the Analytics Dashboard.
//
// Registers:
//   - admin_login              : bcrypt login, mints a Nakama session with admin role.
//   - admin_diagnose_env       : returns which required env vars are present on the running container.
//   - dashboard_events_timeline: admin-gated, reads analytics_events without relying on Satori.
//   - dashboard_storage_list   : admin-gated, lists objects in any storage collection.
//
// Auth model:
//   Two equivalent ways to call any admin-gated RPC on this module:
//     A. Bearer token from a prior admin_login call (ctx.userId starts with "admin:", and
//        our "admin_users" storage collection confirms role=admin and not expired).
//     B. Shared secret: payload.dashboard_secret === env.DASHBOARD_SECRET  (for CI/scripts).
//
// Required env vars (set via docker-compose -> runtime env -> ctx.env):
//   ADMIN_USERNAME        e.g. "ivx-admin"
//   ADMIN_PASSWORD_HASH   bcrypt hash, e.g. "$2y$12$..."
//   DASHBOARD_SECRET      any long random string (32+ chars).

var AA_ADMIN_USERS_COLLECTION = "admin_users";
var AA_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var AA_SESSION_TTL_SEC = 12 * 60 * 60; // 12 hours

var AA_REQUIRED_ENV = [
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD_HASH",
    "DASHBOARD_SECRET",
    "DEFAULT_GAME_ID",
    "APPODEAL_API_KEY",
    "APPODEAL_USER_ID",
    "UNITY_KEY_ID",
    "UNITY_SECRET_KEY",
    "APPLE_KEY_ID",
    "APPLE_ISSUER_ID",
    "APPLE_PRIVATE_KEY",
    "GOOGLE_MAPS_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "NAKAMA_WEBHOOK_SECRET"
];

// ─── Helpers ──────────────────────────────────────────────

function aaParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function aaOk(data) {
    var out = { success: true };
    if (data) { for (var k in data) { if (data.hasOwnProperty(k)) out[k] = data[k]; } }
    return JSON.stringify(out);
}

function aaErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function aaEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) {
        return String(ctx.env[key]);
    }
    return "";
}

/**
 * Check admin role by looking up admin_users/profile under the caller's Nakama
 * UUID. The "admin:" prefix gate is applied to `ctx.username` (which IS the
 * custom_id "admin:<name>" after admin_login), not `ctx.userId` (Nakama's
 * internal UUID — never starts with "admin:").
 */
function aaIsAdminUser(nk, logger, userId, username) {
    if (!userId) return false;
    // Username gate — only accounts provisioned via admin_login (custom_id
    // prefix "admin:") are eligible. This protects against any other user
    // whose admin_users/profile doc somehow exists.
    if (!username || username.indexOf("admin:") !== 0) return false;
    try {
        var records = nk.storageRead([{
            collection: AA_ADMIN_USERS_COLLECTION,
            key: "profile",
            userId: userId
        }]);
        if (!records || records.length === 0) return false;
        var rec = records[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) {
        if (logger && logger.warn) logger.warn("[analytics_admin] isAdmin check failed: " + e.message);
        return false;
    }
}

/**
 * Require that the caller is an authenticated admin.
 * Returns { ok: bool, reason?: string, bypass?: 'secret' | 'session' }.
 */
function aaRequireAdmin(ctx, nk, logger, data) {
    // Path 1: shared secret for CI / scripts
    var configuredSecret = aaEnv(ctx, "DASHBOARD_SECRET");
    if (configuredSecret && data && data.dashboard_secret && data.dashboard_secret === configuredSecret) {
        return { ok: true, bypass: "secret" };
    }
    // Path 2: admin session token minted by admin_login. ctx.username carries
    // the "admin:<name>" custom_id; ctx.userId is the Nakama UUID.
    if (ctx.userId && aaIsAdminUser(nk, logger, ctx.userId, ctx.username)) {
        return { ok: true, bypass: "session" };
    }
    return { ok: false, reason: "admin authentication required" };
}

// ─── RPC: admin_login ─────────────────────────────────────

function rpcAdminLogin(ctx, logger, nk, payload) {
    var data = aaParse(payload);

    var expectedUser = aaEnv(ctx, "ADMIN_USERNAME");
    var expectedHash = aaEnv(ctx, "ADMIN_PASSWORD_HASH");

    if (!expectedUser || !expectedHash) {
        logger.error("[analytics_admin] admin_login: ADMIN_USERNAME/ADMIN_PASSWORD_HASH not set in runtime env");
        return aaErr("Admin login not configured on server. Set ADMIN_USERNAME and ADMIN_PASSWORD_HASH.", 503);
    }

    if (!data.username || !data.password) {
        return aaErr("username and password required", 400);
    }

    // Constant-ish-time user comparison
    if (String(data.username) !== expectedUser) {
        // Run bcrypt anyway to reduce timing difference
        try { nk.bcryptCompare(expectedHash, "dummy"); } catch (e) { /* ignore */ }
        return aaErr("Invalid credentials", 401);
    }

    var passOk = false;
    try {
        passOk = nk.bcryptCompare(expectedHash, String(data.password));
    } catch (e) {
        logger.error("[analytics_admin] bcryptCompare threw: " + e.message);
        return aaErr("Password verification failed on server", 500);
    }

    if (!passOk) {
        return aaErr("Invalid credentials", 401);
    }

    // Ensure an admin user exists and authenticate to generate a session token.
    var customId = "admin:" + expectedUser;
    var authResult;
    try {
        authResult = nk.authenticateCustom(customId, customId, true);
    } catch (e) {
        logger.error("[analytics_admin] authenticateCustom failed: " + e.message);
        return aaErr("Failed to mint admin session: " + e.message, 500);
    }

    var userId = (authResult && (authResult.userId || authResult.user_id)) || null;
    if (!userId) {
        return aaErr("Admin session mint returned no userId", 500);
    }

    var now = Math.floor(Date.now() / 1000);
    var expiresAt = now + AA_SESSION_TTL_SEC;

    // Persist admin marker (for aaIsAdminUser on subsequent RPCs).
    try {
        nk.storageWrite([{
            collection: AA_ADMIN_USERS_COLLECTION,
            key: "profile",
            userId: userId,
            value: {
                username: expectedUser,
                isAdmin: true,
                role: "admin",
                loginAt: now,
                expiresAt: expiresAt
            },
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (e) {
        logger.error("[analytics_admin] failed to write admin profile: " + e.message);
        return aaErr("Failed to persist admin profile: " + e.message, 500);
    }

    // Mint a session token bound to the admin user. expiresAt is seconds since epoch.
    var token;
    try {
        var tokenResult = nk.authenticateTokenGenerate(userId, customId, expiresAt, { role: "admin" });
        token = tokenResult && (tokenResult.token || tokenResult.Token);
    } catch (e) {
        logger.error("[analytics_admin] authenticateTokenGenerate failed: " + e.message);
        return aaErr("Failed to generate admin token: " + e.message, 500);
    }

    logger.info("[analytics_admin] admin_login ok user=" + expectedUser + " userId=" + userId);

    return aaOk({
        token: token,
        userId: userId,
        username: expectedUser,
        role: "admin",
        expiresAt: expiresAt,
        expiresInSeconds: AA_SESSION_TTL_SEC
    });
}

// ─── RPC: admin_diagnose_env ──────────────────────────────

function rpcAdminDiagnoseEnv(ctx, logger, nk, payload) {
    var data = aaParse(payload);
    var gate = aaRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return aaErr(gate.reason, 401);

    var present = {};
    var missing = [];
    for (var i = 0; i < AA_REQUIRED_ENV.length; i++) {
        var key = AA_REQUIRED_ENV[i];
        var v = aaEnv(ctx, key);
        var isSet = !!(v && v.length > 0);
        present[key] = isSet;
        if (!isSet) missing.push(key);
    }

    // Module presence sanity check (catches "modules not redeployed" scenario).
    var modulesOk = {};
    var expectedRpcs = [
        "analytics_log_event",
        "analytics_dashboard",
        "analytics_dashboard_summary",
        "analytics_session_stats",
        "analytics_appodeal",
        "analytics_apple_appstore",
        "analytics_unity",
        "admin_login",
        "admin_diagnose_env",
        "dashboard_events_timeline",
        "dashboard_storage_list",
        // Phase 2
        "analytics_rollup_run",
        "analytics_rollup_backfill",
        "analytics_rollup_status",
        "external_poll_appodeal",
        "external_poll_appstore",
        "external_poll_ugs",
        "external_poll_all",
        "external_poll_status",
        // Phase 3 (retention UI + native metrics)
        "analytics_retention_curves",
        "analytics_schema_check",
        "analytics_backfill_events",
        "analytics_feature_flags",
        "analytics_metrics"
    ];

    // Storage sanity — tell operator if analytics_events is empty (common symptom).
    var analyticsEventsSample = 0;
    try {
        var list = nk.storageList(AA_SYSTEM_USER, "analytics_events", 5, null);
        analyticsEventsSample = (list && list.objects) ? list.objects.length : 0;
    } catch (e) { /* ignore */ }

    var analyticsDauSample = 0;
    try {
        var list2 = nk.storageList(AA_SYSTEM_USER, "analytics_dau", 5, null);
        analyticsDauSample = (list2 && list2.objects) ? list2.objects.length : 0;
    } catch (e) { /* ignore */ }

    // Go plugin health probe — the native Prometheus plugin (Phase 3) writes no
    // storage docs itself, so we can only detect it indirectly: its side effect
    // is that `analytics_metrics_counters/counter_<today>` exists once any
    // events have been logged. A missing-doc + non-empty analytics_events pair
    // is a strong signal that either the plugin failed to build or the JS
    // bumpMetricsCounter helper silently crashed.
    var counterKey = "counter_" + new Date().toISOString().slice(0, 10);
    var metricsCounterDocPresent = false;
    try {
        var cnt = nk.storageRead([{ collection: "analytics_metrics_counters", key: counterKey, userId: AA_SYSTEM_USER }]);
        metricsCounterDocPresent = !!(cnt && cnt.length > 0);
    } catch (e) { /* ignore */ }

    var goPluginHint;
    if (metricsCounterDocPresent) {
        goPluginHint = "analytics_metrics_counters is live — JS metrics pipeline is writing; if native Prometheus counters are missing at /metrics, rebuild the Go plugin (scripts/build-plugin.ps1 or docker compose build nakama).";
    } else if (analyticsEventsSample === 0) {
        goPluginHint = "No events logged yet, so the metrics counter doc hasn't been created. Log an event via the Smoke Test button and re-run diagnose.";
    } else {
        goPluginHint = "analytics_events has data but analytics_metrics_counters is empty — JS bumpMetricsCounter may be failing. Check Nakama logs for [bumpMetricsCounter] errors.";
    }

    return aaOk({
        envVars: present,
        missingEnvVars: missing,
        envAllGreen: missing.length === 0,
        expectedRpcs: expectedRpcs,
        storageProbe: {
            analytics_events_sample_count: analyticsEventsSample,
            analytics_dau_sample_count: analyticsDauSample,
            metrics_counter_doc_present: metricsCounterDocPresent,
            hint: (analyticsEventsSample === 0
                ? "analytics_events is empty — confirm client is calling analytics_log_event (NOT quizverse_log_event) and that events are reaching the server."
                : "analytics_events has data — server-side pipeline is live.")
        },
        nativeMetrics: {
            // The Go plugin does not register an RPC; its presence is observed
            // via /metrics output. This hint tells the operator where to look.
            scrapeEndpoint: "http://<nakama-host>:9100/",
            expectedMetrics: [
                "analytics_events_total",
                "analytics_rollup_runs_total",
                "analytics_poller_runs_total",
                "analytics_pipeline_age_seconds",
                "analytics_events_today"
            ],
            hint: goPluginHint
        },
        bypass: gate.bypass,
        timestamp: new Date().toISOString()
    });
}

// ─── RPC: dashboard_events_timeline ───────────────────────

/**
 * Reads the newest N events from analytics_events, optionally filtered by gameId / eventName.
 * Does NOT require Satori. This is the dashboard-facing replacement for admin_events_timeline.
 *
 * Payload: { gameId?: string, eventName?: string, days?: number, limit?: number, cursor?: string }
 * Returns: { events: [...], count, nextCursor, filteredBy: {...} }
 */
function rpcDashboardEventsTimeline(ctx, logger, nk, payload) {
    var data = aaParse(payload);
    var gate = aaRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return aaErr(gate.reason, 401);

    var limit = Math.max(1, Math.min(500, parseInt(data.limit, 10) || 100));
    var days = Math.max(1, Math.min(90, parseInt(data.days, 10) || 7));
    var cutoffSec = Math.floor(Date.now() / 1000) - days * 86400;

    var gameIdFilter = data.gameId || data.game_id || null;
    if (gameIdFilter === "all") gameIdFilter = null;
    var eventNameFilter = data.eventName || data.event_name || null;

    var collected = [];
    var cursor = data.cursor || null;
    var scanned = 0;
    var maxScan = 2000; // bound scan to keep request fast

    try {
        while (collected.length < limit && scanned < maxScan) {
            var page = nk.storageList(AA_SYSTEM_USER, "analytics_events", 200, cursor);
            if (!page || !page.objects || page.objects.length === 0) break;

            for (var i = 0; i < page.objects.length; i++) {
                scanned++;
                var obj = page.objects[i];
                var ev = obj.value || {};

                var evUnix = ev.unixTimestamp;
                if (!evUnix && ev.timestamp) {
                    evUnix = Math.floor(new Date(ev.timestamp).getTime() / 1000);
                }
                if (evUnix && evUnix < cutoffSec) continue;

                if (gameIdFilter && ev.gameId && ev.gameId !== gameIdFilter) continue;
                if (eventNameFilter && ev.eventName !== eventNameFilter) continue;

                collected.push({
                    key: obj.key,
                    user_id: ev.userId || "",
                    game_id: ev.gameId || "",
                    name: ev.eventName || "",
                    event_name: ev.eventName || "",
                    timestamp: ev.timestamp || null,
                    unix_timestamp: evUnix || null,
                    properties: ev.eventData || {}
                });

                if (collected.length >= limit) break;
            }

            if (!page.cursor) break;
            cursor = page.cursor;
        }
    } catch (e) {
        logger.error("[analytics_admin] dashboard_events_timeline scan failed: " + e.message);
        return aaErr("Scan failed: " + e.message, 500);
    }

    // Newest first.
    collected.sort(function (a, b) {
        return (b.unix_timestamp || 0) - (a.unix_timestamp || 0);
    });

    return aaOk({
        events: collected,
        count: collected.length,
        scanned: scanned,
        nextCursor: cursor || null,
        filteredBy: {
            gameId: gameIdFilter,
            eventName: eventNameFilter,
            days: days,
            limit: limit
        }
    });
}

// ─── RPC: dashboard_storage_list ──────────────────────────

/**
 * Lists objects in any storage collection (admin-gated).
 * Payload: { collection: string, userId?: string, limit?: number, cursor?: string }
 * Returns: { collection, objects: [...], count, nextCursor }
 */
function rpcDashboardStorageList(ctx, logger, nk, payload) {
    var data = aaParse(payload);
    var gate = aaRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return aaErr(gate.reason, 401);

    var collection = data.collection;
    if (!collection) return aaErr("collection required", 400);

    var limit = Math.max(1, Math.min(200, parseInt(data.limit, 10) || 50));
    var userId = data.userId || AA_SYSTEM_USER;
    var cursor = data.cursor || null;

    var page;
    try {
        page = nk.storageList(userId, collection, limit, cursor);
    } catch (e) {
        logger.error("[analytics_admin] dashboard_storage_list failed: " + e.message);
        return aaErr("Storage list failed: " + e.message, 500);
    }

    var objects = [];
    if (page && page.objects) {
        for (var i = 0; i < page.objects.length; i++) {
            var obj = page.objects[i];
            var previewStr = "";
            try { previewStr = JSON.stringify(obj.value || {}).substring(0, 300); }
            catch (e) { previewStr = String(obj.value || "").substring(0, 300); }

            objects.push({
                collection: obj.collection || collection,
                key: obj.key,
                user_id: obj.userId || userId,
                version: obj.version,
                create_time: obj.createTime || null,
                update_time: obj.updateTime || null,
                value_preview: previewStr
            });
        }
    }

    return aaOk({
        collection: collection,
        user_id: userId,
        objects: objects,
        count: objects.length,
        nextCursor: (page && page.cursor) ? page.cursor : null
    });
}

// ─── Registration ─────────────────────────────────────────
// postbuild.js scans for registerRpc calls in InitModule and rewires them.

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("admin_login", rpcAdminLogin);
    initializer.registerRpc("admin_diagnose_env", rpcAdminDiagnoseEnv);
    initializer.registerRpc("dashboard_events_timeline", rpcDashboardEventsTimeline);
    initializer.registerRpc("dashboard_storage_list", rpcDashboardStorageList);
    logger.info("[analytics_admin] Module registered: 4 RPCs (admin_login, admin_diagnose_env, dashboard_events_timeline, dashboard_storage_list)");
}
