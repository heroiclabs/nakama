// external_pollers.js — Phase 2.2 scheduled external-provider pollers.
//
// Solves: Revenue tabs (Appodeal / Apple App Store / Unity Gaming Services)
// currently do live API fetches on every dashboard request. That's slow,
// rate-limits easily, and flaky. This module polls each provider once per
// cadence window and writes canonical docs the dashboard can read cheaply.
//
// Output collections:
//   external_analytics/<provider>/<gameId>/<YYYY-MM-DD>   normalized snapshot
//   external_analytics_last_poll/<provider>                rate-limit meta
//
// Registered RPCs (all admin-gated):
//   external_poll_appodeal    { gameId?, date?, force?, days? }
//   external_poll_appstore    { gameId?, date?, force? }
//   external_poll_ugs         { gameId?, date?, force? }
//   external_poll_all         { force? }                            -> runs all three
//   external_poll_status      {}                                    -> last-poll meta
//
// Auth:
//   Admin session OR payload.dashboard_secret === env.DASHBOARD_SECRET.
//   The cron sidecar uses the shared-secret path.
//
// Feature flag: EXTERNAL_POLLERS_ENABLED=false disables all RPCs (503).
//
// Rate limiting:
//   Default min-interval 1h between polls per provider. Can be bypassed
//   with { force: true } (useful for manual refresh / testing).

var EP_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var EP_ADMIN_USERS_COLLECTION = "admin_users";
var EP_COLLECTION = "external_analytics";
var EP_META_COLLECTION = "external_analytics_last_poll";
var EP_DEFAULT_GAME_ID_ENV = "DEFAULT_GAME_ID";
var EP_MIN_POLL_INTERVAL_SECONDS = 3600; // 1 hour

// ─── Helpers ──────────────────────────────────────────────

function epParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function epOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k];
    return JSON.stringify(out);
}

function epErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function epEnv(ctx, key) {
    if (ctx && ctx.env && ctx.env[key] !== undefined && ctx.env[key] !== null) return String(ctx.env[key]);
    return "";
}

function epFeatureEnabled(ctx) {
    var v = epEnv(ctx, "EXTERNAL_POLLERS_ENABLED");
    if (v === "" || v === "true" || v === "1") return true;
    return false;
}

// Mirrors analytics_admin: the admin_users/profile doc is keyed by the
// Nakama UUID (ctx.userId); the "admin:" gate applies to ctx.username.
function epIsAdminUser(nk, userId, username) {
    if (!userId) return false;
    if (!username || username.indexOf("admin:") !== 0) return false;
    try {
        var records = nk.storageRead([{ collection: EP_ADMIN_USERS_COLLECTION, key: "profile", userId: userId }]);
        if (!records || records.length === 0) return false;
        var rec = records[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function epRequireAdmin(ctx, nk, data) {
    var secret = epEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (ctx.userId && epIsAdminUser(nk, ctx.userId, ctx.username)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function epReadOne(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId || EP_SYSTEM_USER }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function epWriteOne(nk, collection, key, value) {
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: EP_SYSTEM_USER,
            value: value,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) { return false; }
}

function epYesterday() {
    var d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

function epDefaultGameId(ctx) {
    var v = epEnv(ctx, EP_DEFAULT_GAME_ID_ENV);
    return v || "126bf539-dae2-4bcf-964d-316c0fa1f92b"; // QuizVerse fallback
}

/**
 * Enforce min-interval between polls per provider. Writes `last_poll`
 * meta-doc after success so subsequent calls within the window skip.
 */
function epCheckRateLimit(nk, provider, force) {
    if (force) return { allowed: true, reason: "force" };
    var meta = epReadOne(nk, EP_META_COLLECTION, provider, EP_SYSTEM_USER) || {};
    if (!meta.lastPollUnix) return { allowed: true, reason: "first-poll" };

    var nowUnix = Math.floor(Date.now() / 1000);
    var elapsed = nowUnix - meta.lastPollUnix;
    if (elapsed < EP_MIN_POLL_INTERVAL_SECONDS) {
        return {
            allowed: false,
            reason: "rate-limited",
            secondsUntilNext: EP_MIN_POLL_INTERVAL_SECONDS - elapsed,
            lastPoll: meta
        };
    }
    return { allowed: true, reason: "interval-ok", lastPoll: meta };
}

function epRecordPoll(nk, provider, success, summary) {
    var nowUnix = Math.floor(Date.now() / 1000);
    epWriteOne(nk, EP_META_COLLECTION, provider, {
        provider: provider,
        lastPollUnix: nowUnix,
        lastPollAt: new Date().toISOString(),
        success: !!success,
        summary: summary || null
    });
}

// ─── Internal: dispatch existing RPCs ─────────────────────
//
// We reuse the existing analytics_appodeal / _apple_appstore / _unity
// handlers rather than re-implementing the API clients. Those handlers
// are exposed via __rpc_<name> globals after postbuild processing.
// To avoid a hard dependency on that global, we try-catch the lookup
// and fall back to a clean error if the legacy RPC isn't present.

function epCallInternalRpc(ctx, logger, nk, rpcName, payload) {
    try {
        // Postbuild exposes every registered RPC as a top-level __rpc_* global.
        var fn;
        try { fn = eval("(typeof __rpc_" + rpcName + " === 'function') ? __rpc_" + rpcName + " : null"); }
        catch (e) { fn = null; }
        if (!fn) return { ok: false, reason: "handler_not_found:" + rpcName };

        var rawPayload = typeof payload === "string" ? payload : JSON.stringify(payload || {});
        var raw = fn(ctx, logger, nk, rawPayload);
        var parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return { ok: true, data: parsed };
    } catch (e) {
        return { ok: false, reason: "internal_rpc_error: " + e.message };
    }
}

// ─── RPC: external_poll_appodeal ──────────────────────────

function rpcExternalPollAppodeal(ctx, logger, nk, payload) {
    if (!epFeatureEnabled(ctx)) return epErr("External pollers disabled", 503);

    var data = epParse(payload);
    var gate = epRequireAdmin(ctx, nk, data);
    if (!gate.ok) return epErr(gate.reason, 401);

    var rate = epCheckRateLimit(nk, "appodeal", data.force);
    if (!rate.allowed) {
        return epOk({ skipped: true, reason: rate.reason, seconds_until_next: rate.secondsUntilNext, last_poll: rate.lastPoll });
    }

    if (!epEnv(ctx, "APPODEAL_API_KEY") || !epEnv(ctx, "APPODEAL_USER_ID")) {
        epRecordPoll(nk, "appodeal", false, { error: "APPODEAL credentials missing" });
        return epErr("APPODEAL_API_KEY / APPODEAL_USER_ID not set in runtime env", 503);
    }

    var gameId = data.gameId || epDefaultGameId(ctx);
    var dateStr = data.date || epYesterday();
    var days = parseInt(data.days, 10) || 7;

    // Reuse existing analytics_appodeal handler (admin privilege already checked).
    var call = epCallInternalRpc(ctx, logger, nk, "analytics_appodeal", {
        days: days, date_to: dateStr
    });
    if (!call.ok) {
        epRecordPoll(nk, "appodeal", false, { error: call.reason });
        return epErr("Appodeal poll failed: " + call.reason, 500);
    }
    var fetched = call.data || {};
    if (!fetched.success) {
        epRecordPoll(nk, "appodeal", false, { error: fetched.error || "unknown" });
        return epErr("Appodeal returned error: " + (fetched.error || "unknown"), 502);
    }

    var summary = fetched.summary || {};
    var snapshot = {
        provider: "appodeal",
        gameId: gameId,
        date: dateStr,
        fetchedAt: new Date().toISOString(),
        revenue_usd: summary.total_revenue || 0,
        android_revenue_usd: summary.android_revenue || 0,
        ios_revenue_usd: summary.ios_revenue || 0,
        impressions: summary.total_impressions || 0,
        clicks: summary.total_clicks || 0,
        requests: summary.total_requests || 0,
        avg_ecpm: summary.avg_ecpm || 0,
        avg_fillrate: summary.avg_fillrate || 0,
        raw_rows: fetched.data || []
    };
    epWriteOne(nk, EP_COLLECTION, "appodeal_" + gameId + "_" + dateStr, snapshot);
    epRecordPoll(nk, "appodeal", true, {
        gameId: gameId, date: dateStr, revenue_usd: snapshot.revenue_usd, rows: snapshot.raw_rows.length
    });

    return epOk({ provider: "appodeal", gameId: gameId, date: dateStr, snapshot_keys: ["appodeal_" + gameId + "_" + dateStr], summary: summary });
}

// ─── RPC: external_poll_appstore ──────────────────────────

function rpcExternalPollAppstore(ctx, logger, nk, payload) {
    if (!epFeatureEnabled(ctx)) return epErr("External pollers disabled", 503);

    var data = epParse(payload);
    var gate = epRequireAdmin(ctx, nk, data);
    if (!gate.ok) return epErr(gate.reason, 401);

    var rate = epCheckRateLimit(nk, "appstore", data.force);
    if (!rate.allowed) {
        return epOk({ skipped: true, reason: rate.reason, seconds_until_next: rate.secondsUntilNext, last_poll: rate.lastPoll });
    }

    // App Store Connect requires KEY_ID + ISSUER_ID + PRIVATE_KEY.
    if (!epEnv(ctx, "APPLE_KEY_ID") || !epEnv(ctx, "APPLE_ISSUER_ID") || !epEnv(ctx, "APPLE_PRIVATE_KEY")) {
        epRecordPoll(nk, "appstore", false, { error: "Apple credentials missing" });
        return epErr("APPLE_KEY_ID / APPLE_ISSUER_ID / APPLE_PRIVATE_KEY not set", 503);
    }

    var gameId = data.gameId || epDefaultGameId(ctx);
    var dateStr = data.date || epYesterday();

    var call = epCallInternalRpc(ctx, logger, nk, "analytics_apple_appstore", { date_to: dateStr });
    if (!call.ok) {
        epRecordPoll(nk, "appstore", false, { error: call.reason });
        return epErr("App Store poll failed: " + call.reason, 500);
    }
    var fetched = call.data || {};
    if (!fetched.success) {
        epRecordPoll(nk, "appstore", false, { error: fetched.error || "unknown" });
        return epErr("App Store returned error: " + (fetched.error || "unknown"), 502);
    }

    var snapshot = {
        provider: "appstore",
        gameId: gameId,
        date: dateStr,
        fetchedAt: new Date().toISOString(),
        raw: fetched.data || fetched.summary || fetched
    };
    epWriteOne(nk, EP_COLLECTION, "appstore_" + gameId + "_" + dateStr, snapshot);
    epRecordPoll(nk, "appstore", true, { gameId: gameId, date: dateStr });

    return epOk({ provider: "appstore", gameId: gameId, date: dateStr });
}

// ─── RPC: external_poll_ugs (Unity Gaming Services) ───────

function rpcExternalPollUgs(ctx, logger, nk, payload) {
    if (!epFeatureEnabled(ctx)) return epErr("External pollers disabled", 503);

    var data = epParse(payload);
    var gate = epRequireAdmin(ctx, nk, data);
    if (!gate.ok) return epErr(gate.reason, 401);

    var rate = epCheckRateLimit(nk, "ugs", data.force);
    if (!rate.allowed) {
        return epOk({ skipped: true, reason: rate.reason, seconds_until_next: rate.secondsUntilNext, last_poll: rate.lastPoll });
    }

    if (!epEnv(ctx, "UNITY_KEY_ID") || !epEnv(ctx, "UNITY_SECRET_KEY")) {
        epRecordPoll(nk, "ugs", false, { error: "Unity credentials missing" });
        return epErr("UNITY_KEY_ID / UNITY_SECRET_KEY not set", 503);
    }

    var gameId = data.gameId || epDefaultGameId(ctx);
    var dateStr = data.date || epYesterday();

    var call = epCallInternalRpc(ctx, logger, nk, "analytics_unity", { date_to: dateStr });
    if (!call.ok) {
        epRecordPoll(nk, "ugs", false, { error: call.reason });
        return epErr("UGS poll failed: " + call.reason, 500);
    }
    var fetched = call.data || {};
    if (!fetched.success) {
        epRecordPoll(nk, "ugs", false, { error: fetched.error || "unknown" });
        return epErr("UGS returned error: " + (fetched.error || "unknown"), 502);
    }

    var snapshot = {
        provider: "ugs",
        gameId: gameId,
        date: dateStr,
        fetchedAt: new Date().toISOString(),
        raw: fetched.data || fetched.summary || fetched
    };
    epWriteOne(nk, EP_COLLECTION, "ugs_" + gameId + "_" + dateStr, snapshot);
    epRecordPoll(nk, "ugs", true, { gameId: gameId, date: dateStr });

    return epOk({ provider: "ugs", gameId: gameId, date: dateStr });
}

// ─── RPC: external_poll_all ───────────────────────────────

function rpcExternalPollAll(ctx, logger, nk, payload) {
    if (!epFeatureEnabled(ctx)) return epErr("External pollers disabled", 503);

    var data = epParse(payload);
    var gate = epRequireAdmin(ctx, nk, data);
    if (!gate.ok) return epErr(gate.reason, 401);

    var base = { force: !!data.force, dashboard_secret: data.dashboard_secret, gameId: data.gameId };
    var results = {};

    var rpcs = [
        { key: "appodeal", handler: rpcExternalPollAppodeal },
        { key: "appstore", handler: rpcExternalPollAppstore },
        { key: "ugs",      handler: rpcExternalPollUgs }
    ];

    for (var i = 0; i < rpcs.length; i++) {
        var item = rpcs[i];
        try {
            var raw = item.handler(ctx, logger, nk, JSON.stringify(base));
            results[item.key] = JSON.parse(raw);
        } catch (e) {
            results[item.key] = { success: false, error: e.message };
        }
    }
    return epOk({ results: results, ranAt: new Date().toISOString() });
}

// ─── RPC: external_poll_status ────────────────────────────

function rpcExternalPollStatus(ctx, logger, nk, payload) {
    var data = epParse(payload);
    var gate = epRequireAdmin(ctx, nk, data);
    if (!gate.ok) return epErr(gate.reason, 401);

    var providers = ["appodeal", "appstore", "ugs"];
    var status = {};
    for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        status[p] = epReadOne(nk, EP_META_COLLECTION, p, EP_SYSTEM_USER) || { provider: p, lastPollUnix: 0 };
    }
    return epOk({ enabled: epFeatureEnabled(ctx), providers: status });
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("external_poll_appodeal", rpcExternalPollAppodeal);
    initializer.registerRpc("external_poll_appstore", rpcExternalPollAppstore);
    initializer.registerRpc("external_poll_ugs", rpcExternalPollUgs);
    initializer.registerRpc("external_poll_all", rpcExternalPollAll);
    initializer.registerRpc("external_poll_status", rpcExternalPollStatus);
    logger.info("[external_pollers] Module registered: 5 RPCs (appodeal/appstore/ugs/all/status)");
}
