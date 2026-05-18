// analytics_retention_curves.js — Reads cohort docs produced by analytics_rollup
// and returns retention curves & heatmap data shaped for the dashboard.
//
// Problem it solves:
//   analytics_rollup writes `analytics_retention/cohort_<gameId>_<YYYY-MM-DD>`
//   per cohort with shape { cohortDate, gameId, cohortSize, activeByDay: { "1":n,... } }.
//   No RPC consumed these until now, so the dashboard's Retention tab was empty.
//
// Registered RPCs:
//   analytics_retention_curves  { gameId?, days? (default 30) }  admin-gated
//
// Output shape (stable):
//   {
//     success: true,
//     gameId: "…",
//     from: "YYYY-MM-DD",
//     to:   "YYYY-MM-DD",
//     windows: [1, 3, 7, 14, 30],
//     summary: { avg_d1_pct: …, avg_d7_pct: …, avg_d30_pct: …, cohorts_considered: n },
//     cohorts: [
//       { cohortDate, cohortSize, activeByDay: {1:n,3:n,…}, retentionPctByDay: {1:pct,…} },
//       …
//     ],
//     averageCurve: { 1: pct, 3: pct, 7: pct, 14: pct, 30: pct }  // cohort-size-weighted
//   }
//
// Admin-gated identically to analytics_rollup (bearer session w/ admin role
// OR shared DASHBOARD_SECRET). This keeps user-level data out of the public
// http_key path.

var RC_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var RC_ADMIN_USERS_COLLECTION = "admin_users";
var RC_RETENTION_COLLECTION = "analytics_retention";
var RC_WINDOWS = [1, 3, 7, 14, 30];

// ─── Helpers ──────────────────────────────────────────────

// Slug→UUID alias for legacy ingestion ("quizverse" → "126bf539-…").
// Delegates to the bundled global resolveGameIdAlias when available so the
// alias map (defined in analytics.js) stays the single source of truth.
function rcResolveGameId(g) {
    if (!g) return g;
    try {
        if (typeof resolveGameIdAlias === 'function') return resolveGameIdAlias(g);
    } catch (e) { /* fall through */ }
    return g;
}

function rcParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function rcOk(data) {
    var out = { success: true };
    for (var k in data) if (data.hasOwnProperty(k)) out[k] = data[k];
    return JSON.stringify(out);
}

function rcErr(msg, code) {
    return JSON.stringify({ success: false, error: msg, code: code || 500 });
}

function rcEnv(ctx, key) {
    // Fix SR-10: mirror analytics_hardening.js ahEnv — use hardcoded DASHBOARD_SECRET
    // fallback so shared-secret admin auth works even when ctx.env is unpopulated
    // (which is the designed production state per analytics_admin.js comment).
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    try { return (ctx && ctx.env && ctx.env[key]) || null; } catch (e) { return null; }
}

// Must match analytics_admin.aaIsAdminUser:
//   - admin_users/profile doc is owned by the admin's Nakama UUID
//   - ctx.username (the "admin:<name>" custom_id) gates eligibility
// The old implementation read `admin_users/<userId>` under SYSTEM_USER, which
// never matched anything admin_login had written, so every call 401'd.
function rcIsAdminUser(nk, logger, userId, username) {
    if (!userId) return false;
    if (!username || username.indexOf("admin:") !== 0) return false;
    try {
        var records = nk.storageRead([{ collection: RC_ADMIN_USERS_COLLECTION, key: "profile", userId: userId }]);
        if (!records || records.length === 0) return false;
        var rec = records[0].value || {};
        if (!rec.isAdmin) return false;
        if (rec.expiresAt && rec.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function rcRequireAdmin(ctx, nk, logger, data) {
    var secret = rcEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true };
    if (ctx.userId && rcIsAdminUser(nk, logger, ctx.userId, ctx.username)) return { ok: true };
    return { ok: false, reason: "admin authentication required" };
}

function rcIsoDate(d) { return d.toISOString().slice(0, 10); }

function rcTodayISO() { return rcIsoDate(new Date()); }

function rcDateMinusDays(dateStr, days) {
    var d = new Date(dateStr + "T00:00:00.000Z");
    d.setUTCDate(d.getUTCDate() - days);
    return rcIsoDate(d);
}

function rcReadOne(nk, collection, key) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: RC_SYSTEM_USER }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

// ─── Core: load cohorts for a date range ──────────────────

/**
 * Reads cohort_<gameId>_<date> docs for the last `days` days for a single gameId.
 * If `gameId` is "all" we don't scan — the rollup module skips the "all"
 * cohort to avoid double-counting across games. Returns an array of cohort
 * objects in date order (oldest first).
 *
 * We do point reads (one per date) rather than a storageList scan because:
 *   • Scans under SYSTEM_USER include retention docs from every gameId,
 *     burning read quota when we only care about one.
 *   • For the 30-day default window this is 30 storage reads, well inside
 *     Nakama's per-RPC budget.
 */
function rcLoadCohorts(nk, logger, gameId, days) {
    if (!gameId || gameId === "all") return [];
    if (!days || days < 1) days = 30;
    if (days > 120) days = 120; // hard cap — heatmap UI can't show more than this cleanly.

    var cohorts = [];
    var today = rcTodayISO();

    for (var offset = days - 1; offset >= 0; offset--) {
        var dateStr = rcDateMinusDays(today, offset);
        var key = "cohort_" + gameId + "_" + dateStr;
        var doc = rcReadOne(nk, RC_RETENTION_COLLECTION, key);
        if (!doc) continue;
        if (!doc.cohortSize) continue; // skip placeholder docs with no cohort seeded

        // Compute retention pct per window for convenience on the client.
        var pctByDay = {};
        var activeByDay = doc.activeByDay || {};
        for (var wi = 0; wi < RC_WINDOWS.length; wi++) {
            var w = RC_WINDOWS[wi];
            var active = activeByDay[String(w)];
            if (typeof active === "number" && doc.cohortSize > 0) {
                pctByDay[w] = Math.round((active / doc.cohortSize) * 1000) / 10; // 1 dp
            } else {
                pctByDay[w] = null; // "not yet observed" — UI renders as gap, not zero.
            }
        }

        cohorts.push({
            cohortDate: doc.cohortDate || dateStr,
            cohortSize: doc.cohortSize,
            activeByDay: activeByDay,
            retentionPctByDay: pctByDay,
            computedAt: doc.computedAt || null
        });
    }

    return cohorts;
}

/**
 * Computes a cohort-size-weighted average retention curve across the loaded
 * cohorts. Weighting matters — a 1000-user cohort with 50% d7 and a 10-user
 * cohort with 100% d7 shouldn't produce a 75% average; it's really ~50.5%.
 *
 * Cohorts that are too young to have an observation for a window (e.g. d30
 * for a cohort seeded 3 days ago) are excluded from that window's average
 * by design — otherwise the curve sags toward the recent days.
 */
function rcAverageCurve(cohorts) {
    var totals = {};   // window -> { active: n, size: n, cohorts: n }
    for (var wi = 0; wi < RC_WINDOWS.length; wi++) {
        totals[RC_WINDOWS[wi]] = { active: 0, size: 0, cohorts: 0 };
    }
    for (var i = 0; i < cohorts.length; i++) {
        var c = cohorts[i];
        for (var wj = 0; wj < RC_WINDOWS.length; wj++) {
            var w = RC_WINDOWS[wj];
            var active = (c.activeByDay || {})[String(w)];
            if (typeof active !== "number") continue;
            totals[w].active += active;
            totals[w].size += c.cohortSize || 0;
            totals[w].cohorts += 1;
        }
    }

    var curve = {};
    var cohortsConsidered = cohorts.length;
    for (var wk = 0; wk < RC_WINDOWS.length; wk++) {
        var ww = RC_WINDOWS[wk];
        var t = totals[ww];
        curve[ww] = (t.size > 0) ? Math.round((t.active / t.size) * 1000) / 10 : null;
    }
    return { curve: curve, cohortsConsidered: cohortsConsidered, totals: totals };
}

// ─── RPC: analytics_retention_curves ──────────────────────

function rpcAnalyticsRetentionCurves(ctx, logger, nk, payload) {
    var data = rcParse(payload);
    var gate = rcRequireAdmin(ctx, nk, logger, data);
    if (!gate.ok) return rcErr(gate.reason, 401);

    var gameId = rcResolveGameId(data.gameId || "all");
    if (gameId === "all") {
        // Retention is per-game because user identity overlaps across games
        // shouldn't be smashed together. Surface this explicitly.
        return rcErr("gameId is required (retention cohorts are per-game).", 400);
    }

    var days = parseInt(data.days, 10);
    if (!days || isNaN(days)) days = 30;
    if (days < 1) days = 1;
    if (days > 120) days = 120;

    var cohorts = rcLoadCohorts(nk, logger, gameId, days);

    var avg = rcAverageCurve(cohorts);

    // Summary KPIs for the UI header (null if we have no data yet).
    var summary = {
        cohorts_considered: cohorts.length,
        avg_d1_pct:  avg.curve[1],
        avg_d3_pct:  avg.curve[3],
        avg_d7_pct:  avg.curve[7],
        avg_d14_pct: avg.curve[14],
        avg_d30_pct: avg.curve[30]
    };

    return rcOk({
        gameId: gameId,
        from: cohorts.length > 0 ? cohorts[0].cohortDate : null,
        to:   cohorts.length > 0 ? cohorts[cohorts.length - 1].cohortDate : null,
        windows: RC_WINDOWS,
        summary: summary,
        averageCurve: avg.curve,
        cohorts: cohorts
    });
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_retention_curves", rpcAnalyticsRetentionCurves);
    logger.info("[analytics_retention_curves] Module registered: 1 RPC");
}
