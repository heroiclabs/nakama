// analytics_satori_identity.js — Phase 5 (2026-05) Satori identity sync.
//
// Goal: use analytics as truth, Satori as targeting/delivery.
//
// This module computes 10 analytical identity traits from each player's
// GPA (game_player_analytics) document and pushes them to Satori as
// custom identity properties via sdPropertiesUpdate. Once these traits are
// in Satori, the live-ops team can build audiences, run experiments, and
// fire personalised push/offer campaigns without writing backend queries.
//
// ─── The 10 traits ──────────────────────────────────────────────────────────
//
//   skill_band          "beginner" | "intermediate" | "expert"
//                       Derived from eng.avg_accuracy + eng.total_answered.
//
//   favorite_mode       string (most-played quiz mode from fav_mode)
//
//   favorite_topic      string (top key from mode_counts as best available proxy;
//                       null when no data)
//
//   spend_tier          "non_spender" | "low" | "mid" | "high"
//                       Derived from money.iap_count + money.spend_usd.
//
//   ad_tolerance        "low" | "medium" | "high"
//                       Derived from money.ad_completions / (ad_completions + ad_skips).
//
//   churn_risk          "low" | "medium" | "high"
//                       Derived from days since last active (last_active_utc).
//
//   price_sensitivity   "sensitive" | "moderate" | "low"
//                       Derived from paywall_shown_count vs iap_count.
//
//   best_play_hour      "0"–"23" UTC hour of peak session activity, or null.
//                       Derived by scanning gpa.sessions start timestamps.
//
//   country_tier        "t1" | "t2" | "t3"
//                       T1 = US/UK/AU/CA/JP/KR/DE/FR/NL/SE/NO/DK/CH/SG/HK
//                       T2 = BR/MX/TR/PL/RU/ZA/TH/MY/ID/PH/NG/UA/CZ/RO
//                       T3 = everything else
//
//   install_age_days    days since first_seen_utc (integer, capped at 9999)
//
// ─── Registered RPCs ────────────────────────────────────────────────────────
//
//   satori_identity_sync
//     Compute traits for ONE user and push to Satori.
//     Payload: { user_id: "<uuid>", game_id?, force?: bool }
//     Admin-gated; also callable by the user for their own profile.
//
//   satori_identity_batch
//     Scan GPA docs and sync up to `limit` users per call.
//     Payload: { game_id?, limit?: 50–500, cursor? }
//     Designed for a cron tick or manual backfill. Idempotent.
//
//   satori_get_flags
//     Fetch Satori flags for the calling user (or admin-specified user_id)
//     via sdFlagsList, then fire a `flag_exposure` event for each returned
//     flag so A/B coverage is visible in analytics.
//     Payload: { user_id? (admin only) }
//
// ─── Identity-sync state ────────────────────────────────────────────────────
//
//   Last-sync timestamp stored in analytics_satori_id_state/<userId>_<gameId>
//   so batch runs skip recently-synced identities and batch operations can
//   resume where they left off.  Re-sync frequency: 24 h by default.

var SI_SYSTEM_USER      = "00000000-0000-0000-0000-000000000000";
var SI_ADMIN_COLLECTION = "admin_users";
var SI_GPA_COLLECTION   = "game_player_analytics";
var SI_STATE_COLLECTION = "analytics_satori_id_state";
var SI_DEFAULT_GAME_ID  = "126bf539-dae2-4bcf-964d-316c0fa1f92b"; // QuizVerse

// Minimum seconds between re-syncs for the same user. The batch RPC
// skips anyone synced more recently than this threshold so a single
// cron call doesn't hammer Satori with redundant PUT /v1/properties.
var SI_RESYNC_INTERVAL_SEC = 24 * 3600; // 24 hours

// Re-probe backoff for users that had NO GPA doc at sync time. The old code
// wrote synced_at on the no_gpa path even though nothing was pushed, which
// blocked retries for the full 24h window. We now record probed_at instead,
// and only skip if the last probe was within this much shorter interval —
// so a user whose GPA doc appears minutes later gets synced within the hour.
var SI_NO_GPA_PROBE_INTERVAL_SEC = 3600; // 1 hour

// Max users to sync per batch call (caller can request less).
var SI_BATCH_MAX = 500;
var SI_BATCH_DEFAULT = 100;

// ─── Country-tier lookup ─────────────────────────────────────────────────────
var SI_COUNTRY_T1 = {
    "US":1,"GB":1,"AU":1,"CA":1,"JP":1,"KR":1,"DE":1,"FR":1,"NL":1,
    "SE":1,"NO":1,"DK":1,"FI":1,"CH":1,"AT":1,"IE":1,"NZ":1,"SG":1,
    "HK":1,"IL":1,"BE":1,"LU":1,"IT":1,"ES":1
};
var SI_COUNTRY_T2 = {
    "BR":1,"MX":1,"TR":1,"PL":1,"RU":1,"ZA":1,"TH":1,"MY":1,"ID":1,
    "PH":1,"NG":1,"UA":1,"CZ":1,"RO":1,"HU":1,"AR":1,"CL":1,"CO":1,
    "PE":1,"VN":1,"EG":1,"SA":1,"AE":1,"QA":1,"KW":1,"PK":1,"BD":1
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function siParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function siOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    return JSON.stringify(out);
}

function siErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function siEnv(ctx, key) {
    if (key === "DASHBOARD_SECRET" && typeof AA_FALLBACK_DASHBOARD_SECRET === "string") {
        return AA_FALLBACK_DASHBOARD_SECRET;
    }
    try {
        if (ctx && ctx.env && ctx.env[key]) {
            var v = String(ctx.env[key]).trim();
            if (v.length > 0) return v;
        }
    } catch (e) { /* */ }
    return "";
}

function siIsAdmin(ctx, nk) {
    if (!ctx.userId) return false;
    if (ctx.userId === SI_SYSTEM_USER) return true;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: SI_ADMIN_COLLECTION, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var r = recs[0].value || {};
        if (!r.isAdmin) return false;
        if (r.expiresAt && r.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function siRequireAdmin(ctx, nk, data) {
    var secret = siEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (siIsAdmin(ctx, nk)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function siResolveGameId(g) {
    if (!g) return g;
    try { if (typeof resolveGameIdAlias === "function") return resolveGameIdAlias(g); } catch (e) { /* */ }
    return g;
}

function siReadOne(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId || SI_SYSTEM_USER }]);
        return (r && r.length > 0) ? (r[0].value || null) : null;
    } catch (e) { return null; }
}

function siWriteOne(nk, collection, key, userId, value) {
    try {
        nk.storageWrite([{
            collection: collection, key: key, userId: userId || SI_SYSTEM_USER,
            value: value, permissionRead: 0, permissionWrite: 0
        }]);
    } catch (e) { /* best-effort */ }
}

// ─── Core: compute identity traits from a GPA doc ────────────────────────────

/**
 * Derives the 10 Satori identity properties from a GPA document.
 *
 * All values are returned as strings (Satori's /v1/properties API only
 * accepts string values). Missing/insufficient data results in "unknown"
 * rather than null so Satori always has a value to segment on.
 *
 * @param  {object} gpa  A GPA doc as returned by gpaReadProfile.
 * @param  {string} nowSec  Current Unix seconds (for churn_risk + install_age).
 * @returns {object}  { custom: { k: "v" } }  ready for sdPropertiesUpdate.
 */
function siComputeTraits(gpa, nowSec) {
    nowSec = nowSec || Math.floor(Date.now() / 1000);

    // ── skill_band ─────────────────────────────────────────
    var eng = gpa.eng || {};
    var avgAcc = (typeof eng.avg_accuracy === "number") ? eng.avg_accuracy : -1;
    var totalAnswered = (typeof eng.total_answered === "number") ? eng.total_answered : 0;
    var skillBand;
    if (totalAnswered < 10 || avgAcc < 0) {
        skillBand = "beginner";  // insufficient data — safe default
    } else if (avgAcc >= 70) {
        skillBand = "expert";
    } else if (avgAcc >= 40) {
        skillBand = "intermediate";
    } else {
        skillBand = "beginner";
    }

    // ── favorite_mode ──────────────────────────────────────
    var favMode = gpa.fav_mode || null;
    if (!favMode || favMode === "") {
        // Derive from mode_counts if fav_mode not set
        var modeCounts = gpa.mode_counts || {};
        var bestMode = null, bestN = 0;
        for (var mk in modeCounts) {
            if (Object.prototype.hasOwnProperty.call(modeCounts, mk)) {
                var n = modeCounts[mk] || 0;
                if (n > bestN) { bestN = n; bestMode = mk; }
            }
        }
        favMode = bestMode;
    }

    // ── favorite_topic ─────────────────────────────────────
    // GPA doesn't store per-category counts; use mode as proxy.
    // When true category tracking is added (future GPA schema v2), swap in.
    var favTopic = favMode; // best available proxy

    // ── spend_tier ─────────────────────────────────────────
    var money = gpa.money || {};
    var iapCount  = money.iap_count  || 0;
    var spendUsd  = money.spend_usd  || 0;
    var spendTier;
    if (iapCount === 0) {
        spendTier = "non_spender";
    } else if (iapCount <= 2 || spendUsd < 10) {
        spendTier = "low";
    } else if (iapCount <= 5 || spendUsd < 50) {
        spendTier = "mid";
    } else {
        spendTier = "high";
    }

    // ── ad_tolerance ───────────────────────────────────────
    var adComp  = money.ad_completions || 0;
    var adSkips = money.ad_skips       || 0;
    var adViews = money.ad_views       || adComp + adSkips;
    var adTol;
    if (adViews < 3) {
        adTol = "unknown"; // too few data points
    } else {
        var skipRate = adViews > 0 ? (adSkips / adViews) : 0;
        if (skipRate > 0.5)       adTol = "low";
        else if (skipRate > 0.2)  adTol = "medium";
        else                      adTol = "high";
    }

    // ── churn_risk ─────────────────────────────────────────
    var lastActiveSec = gpa.last_active_utc || 0;
    var daysSinceActive = lastActiveSec > 0
        ? Math.floor((nowSec - lastActiveSec) / 86400)
        : null;
    var churnRisk;
    if (daysSinceActive === null) {
        churnRisk = "unknown";
    } else if (daysSinceActive <= 3) {
        churnRisk = "low";
    } else if (daysSinceActive <= 14) {
        churnRisk = "medium";
    } else {
        churnRisk = "high";
    }

    // ── price_sensitivity ──────────────────────────────────
    var paywallShown = money.paywall_shown_count || 0;
    var priceSens;
    if (iapCount > 0) {
        priceSens = "low";         // already bought → low sensitivity
    } else if (paywallShown >= 3) {
        priceSens = "sensitive";   // seen paywall many times, still not buying
    } else if (paywallShown >= 1) {
        priceSens = "moderate";
    } else {
        priceSens = "unknown";     // never shown a paywall
    }

    // ── best_play_hour ─────────────────────────────────────
    // Derived from gpa.sessions (each entry has a start timestamp).
    var bestPlayHour = null;
    try {
        var sessions = gpa.sessions || [];
        if (sessions.length > 0) {
            var hourCounts = {};
            for (var si = 0; si < sessions.length; si++) {
                var s = sessions[si];
                var ts = parseInt(s.start || s.startUtc || s.ts || 0, 10);
                if (ts > 0) {
                    var h = new Date(ts > 1e12 ? ts : ts * 1000).getUTCHours();
                    hourCounts[h] = (hourCounts[h] || 0) + 1;
                }
            }
            var bestH = -1, bestHCount = 0;
            for (var hk in hourCounts) {
                if (Object.prototype.hasOwnProperty.call(hourCounts, hk)) {
                    if (hourCounts[hk] > bestHCount) {
                        bestHCount = hourCounts[hk];
                        bestH = parseInt(hk, 10);
                    }
                }
            }
            if (bestH >= 0) bestPlayHour = String(bestH);
        }
    } catch (e) { bestPlayHour = null; }

    // ── country_tier ───────────────────────────────────────
    var country = (gpa.country || "??").toUpperCase();
    var countryTier;
    if (SI_COUNTRY_T1[country]) countryTier = "t1";
    else if (SI_COUNTRY_T2[country]) countryTier = "t2";
    else if (country === "??" || country === "") countryTier = "unknown";
    else countryTier = "t3";

    // ── install_age_days ───────────────────────────────────
    var firstSeen = gpa.first_seen_utc || 0;
    var installAgeDays = firstSeen > 0
        ? Math.min(9999, Math.floor((nowSec - firstSeen) / 86400))
        : null;

    // ─── Assemble output ───────────────────────────────────
    // All values are strings (Satori /v1/properties type restriction).
    var custom = {};
    custom["skill_band"]        = skillBand;
    if (favMode)     custom["favorite_mode"]  = String(favMode).slice(0, 64);
    if (favTopic)    custom["favorite_topic"] = String(favTopic).slice(0, 64);
    custom["spend_tier"]        = spendTier;
    custom["ad_tolerance"]      = adTol;
    custom["churn_risk"]        = churnRisk;
    custom["price_sensitivity"] = priceSens;
    if (bestPlayHour !== null) custom["best_play_hour"] = bestPlayHour;
    custom["country_tier"]      = countryTier;
    if (installAgeDays !== null) custom["install_age_days"] = String(installAgeDays);

    return { custom: custom };
}

// ─── Core: sync one user to Satori ──────────────────────────────────────────

/**
 * Reads the GPA doc for userId+gameId, computes traits, and pushes them
 * to Satori via sdPropertiesUpdate. Records the sync time so batch runs
 * can skip recently-synced identities.
 *
 * @returns { ok: bool, skipped: bool, traits: object, satori_resp: object }
 */
function siSyncUser(ctx, nk, logger, userId, gameId) {
    gameId = siResolveGameId(gameId || SI_DEFAULT_GAME_ID);
    var nowSec = Math.floor(Date.now() / 1000);

    // Read last-sync state.
    var stateKey = userId + "_" + gameId;
    var state    = siReadOne(nk, SI_STATE_COLLECTION, stateKey, SI_SYSTEM_USER) || {};
    var lastSync = state.synced_at || 0;

    if ((nowSec - lastSync) < SI_RESYNC_INTERVAL_SEC) {
        return { ok: true, skipped: true, reason: "recently_synced" };
    }

    // no_gpa probes use a much shorter backoff than full syncs: skip only if
    // we probed (and found no GPA) within the last hour. Do NOT consult
    // synced_at here — a no_gpa probe never pushed anything to Satori.
    var lastProbe = state.probed_at || 0;
    if ((nowSec - lastProbe) < SI_NO_GPA_PROBE_INTERVAL_SEC) {
        return { ok: true, skipped: true, reason: "recently_probed" };
    }

    // Read GPA.
    var gpaKey = gameId + ":" + userId;
    var gpa    = null;
    try {
        var recs = nk.storageRead([{ collection: SI_GPA_COLLECTION, key: gpaKey, userId: userId }]);
        if (recs && recs.length > 0) gpa = recs[0].value || null;
    } catch (e) { /* not found */ }

    if (!gpa) {
        // No GPA doc yet — record probed_at (NOT synced_at: nothing was
        // pushed) so the next tick retries after the short probe backoff
        // instead of being blocked for the full 24h re-sync window.
        siWriteOne(nk, SI_STATE_COLLECTION, stateKey, SI_SYSTEM_USER, {
            user_id: userId, game_id: gameId,
            synced_at: lastSync,
            probed_at: nowSec,
            reason: "no_gpa"
        });
        return { ok: true, skipped: true, reason: "no_gpa" };
    }

    // Compute traits.
    var props = siComputeTraits(gpa, nowSec);

    // Also include durable identity fields (country, platform, etc.)
    // as Satori "default" properties so they appear in the standard columns.
    var def = {};
    if (gpa.country && gpa.country !== "??") def["country"] = gpa.country;
    if (gpa.platform && gpa.platform !== "unknown") def["platform"] = gpa.platform;
    if (gpa.locale)    def["language"]    = gpa.locale;
    if (gpa.app_version) def["app_version"] = gpa.app_version;
    if (Object.keys(def).length > 0) props["default"] = def;

    // Push to Satori.
    var satResp = null;
    var pushOk  = false;
    try {
        if (typeof sdPropertiesUpdate === "function") {
            satResp  = sdPropertiesUpdate(ctx, nk, logger, userId, props);
            pushOk   = (satResp === null); // sdPropertiesUpdate returns null on success
        } else {
            satResp  = { ok: false, code: 0, body: "sdPropertiesUpdate not available" };
        }
    } catch (e) {
        satResp = { ok: false, code: 0, body: e.message };
    }

    // Optionally fire a satori_identity_synced event so the sync is
    // visible in the analytics timeline and can be correlated with
    // offer/experiment assignment changes.
    if (pushOk) {
        try {
            if (typeof sdEventsPublish === "function") {
                sdEventsPublish(ctx, nk, logger, userId, [{
                    name: "satori_identity_synced",
                    id: "si_" + userId + "_" + nowSec,
                    timestamp: nowSec,
                    value: gameId,
                    metadata: {
                        skill_band:   props.custom.skill_band,
                        spend_tier:   props.custom.spend_tier,
                        churn_risk:   props.custom.churn_risk,
                        country_tier: props.custom.country_tier
                    }
                }]);
            }
        } catch (e) { /* best-effort */ }
    }

    // Record sync state.
    siWriteOne(nk, SI_STATE_COLLECTION, stateKey, SI_SYSTEM_USER, {
        user_id: userId, game_id: gameId, synced_at: nowSec,
        push_ok: pushOk, traits: props.custom
    });

    return {
        ok:         pushOk,
        skipped:    false,
        traits:     props.custom,
        satori_ok:  pushOk,
        satori_body: satResp ? (typeof satResp.body === "string" ? satResp.body.slice(0, 300) : null) : null
    };
}

// ─── RPC: satori_identity_sync (single-user) ────────────────────────────────

/**
 * Compute traits for one user and push to Satori.
 * Admin can target any user; a player can sync their own profile.
 *
 * Payload: { user_id?, game_id?, force?: true }
 *   force=true   bypasses the 24-h re-sync cooldown
 */
function rpcSatoriIdentitySync(ctx, logger, nk, payload) {
    var data = siParse(payload);

    var targetId = data.user_id || ctx.userId;
    if (!targetId) return siErr("user_id required", 400);

    var isAdmin  = siIsAdmin(ctx, nk);
    var secret   = siEnv(ctx, "DASHBOARD_SECRET");
    var bySecret = (secret && data.dashboard_secret === secret);

    if (targetId !== ctx.userId && !isAdmin && !bySecret) {
        return siErr("admin authentication required", 401);
    }

    var gameId = siResolveGameId(data.game_id || data.gameId || SI_DEFAULT_GAME_ID);

    // force=true resets the last-sync state so siSyncUser won't skip.
    if (data.force === true || data.force === "true") {
        siWriteOne(nk, SI_STATE_COLLECTION, targetId + "_" + gameId, SI_SYSTEM_USER, {
            user_id: targetId, game_id: gameId, synced_at: 0, reason: "force_reset"
        });
    }

    var result = siSyncUser(ctx, nk, logger, targetId, gameId);
    return siOk({
        user_id:    targetId,
        game_id:    gameId,
        result:     result,
        computed_at: new Date().toISOString()
    });
}

// ─── RPC: satori_identity_batch ─────────────────────────────────────────────

/**
 * Scan GPA docs and sync up to `limit` users. Designed for cron ticks.
 * Skips users synced within the last 24 h unless force=true.
 *
 * Payload: { game_id?, limit?: 50–500, cursor?, force?: bool,
 *            dashboard_secret? }
 *
 * Response: { synced, skipped, errors, next_cursor, has_more }
 */
function rpcSatoriIdentityBatch(ctx, logger, nk, payload) {
    var data = siParse(payload);
    var gate = siRequireAdmin(ctx, nk, data);
    if (!gate.ok) return siErr(gate.reason, 401);

    var gameId = siResolveGameId(data.game_id || data.gameId || SI_DEFAULT_GAME_ID);
    var limit  = Math.min(SI_BATCH_MAX, Math.max(50, parseInt(data.limit, 10) || SI_BATCH_DEFAULT));
    var cursor = data.cursor || "";
    var force  = (data.force === true || data.force === "true");

    var synced     = 0;
    var skipped    = 0;
    var errors     = 0;
    var nextCursor = null;
    var processed  = 0;
    // Per-reason skip tally (recently_synced, recently_probed, no_gpa,
    // game_id_filter, ...) so ops can see WHY records skip, not just counts.
    var skipReasons = {};
    function siTallySkip(reason) {
        var r = reason || "unknown";
        skipReasons[r] = (skipReasons[r] || 0) + 1;
    }

    try {
        var scanLimit = limit * 3; // scan 3x more than needed to account for skips
        var result    = nk.storageList(SI_SYSTEM_USER, SI_GPA_COLLECTION, scanLimit, cursor);
        var items     = (result && result.objects) ? result.objects : [];
        nextCursor    = (result && result.cursor)  ? result.cursor  : null;

        for (var i = 0; i < items.length && (synced + skipped + errors) < limit * 3; i++) {
            var obj = items[i];
            var v   = obj && obj.value;
            if (!v) continue;

            var userId = v.user_id || obj.userId;
            var docGameId = v.game_id || gameId;
            if (!userId) continue;

            // Filter by game_id if specified.
            if (gameId && gameId !== "all" && docGameId !== gameId) { skipped++; siTallySkip("game_id_filter"); continue; }

            processed++;
            if (synced >= limit) break; // reached the sync quota for this call

            // For force=true, reset the state to bypass the cooldown.
            if (force) {
                siWriteOne(nk, SI_STATE_COLLECTION, userId + "_" + docGameId, SI_SYSTEM_USER, {
                    user_id: userId, game_id: docGameId, synced_at: 0, reason: "batch_force"
                });
            }

            try {
                var r = siSyncUser(ctx, nk, logger, userId, docGameId);
                if (r.skipped) {
                    skipped++;
                    siTallySkip(r.reason);
                } else if (r.ok) {
                    synced++;
                } else {
                    errors++;
                    logger.warn("[satori_identity] batch sync error uid=" + userId + ": " +
                        (r.satori_body || "unknown"));
                }
            } catch (eu) {
                errors++;
                logger.warn("[satori_identity] batch exception uid=" + userId + ": " + eu.message);
            }
        }
    } catch (e) {
        logger.warn("[satori_identity] batch scan error: " + e.message);
        return siErr("scan error: " + e.message, 500);
    }

    return siOk({
        synced:     synced,
        skipped:    skipped,
        skip_reasons: skipReasons,
        errors:     errors,
        processed:  processed,
        next_cursor: nextCursor || null,
        has_more:    !!(nextCursor),
        game_id:    gameId,
        limit:      limit,
        computed_at: new Date().toISOString()
    });
}

// ─── RPC: satori_get_flags ───────────────────────────────────────────────────

/**
 * Fetch Satori flags for the calling user (or admin-specified user_id).
 *
 * After fetching flags, this RPC fires a `flag_exposure` event for each
 * returned flag via sdEventsPublish, so A/B test coverage is visible in
 * the analytics timeline and can be sliced by segment in the dashboard.
 *
 * Payload: { user_id? (admin only), game_id? }
 *
 * Response: { flags: [...], exposure_count, satori_ok }
 *
 * Idempotent: repeated calls within the same session are allowed — Satori
 * deduplicates flag events by (identity, event_id) so the Satori dashboard
 * won't double-count.
 */
function rpcSatoriGetFlags(ctx, logger, nk, payload) {
    var data = siParse(payload);

    var targetId = data.user_id || ctx.userId;
    if (!targetId) return siErr("user_id required", 400);

    var isAdmin  = siIsAdmin(ctx, nk);
    var secret   = siEnv(ctx, "DASHBOARD_SECRET");
    var bySecret = (secret && data.dashboard_secret === secret);

    if (targetId !== ctx.userId && !isAdmin && !bySecret) {
        return siErr("admin authentication required", 401);
    }

    // Fetch flags from Satori.
    var flags = [];
    var satoriOk = false;
    try {
        if (typeof sdFlagsList === "function") {
            flags    = sdFlagsList(ctx, nk, logger, targetId);
            satoriOk = true;
        }
    } catch (e) {
        logger.warn("[satori_identity] sdFlagsList error: " + e.message);
    }

    // Fire flag_exposure events.
    var nowSec        = Math.floor(Date.now() / 1000);
    var exposureCount = 0;

    if (satoriOk && flags && flags.length > 0) {
        try {
            if (typeof sdEventsPublish === "function") {
                var exposureEvents = [];
                for (var fi = 0; fi < flags.length; fi++) {
                    var flag = flags[fi];
                    var flagName  = (flag.name  || flag.id   || "unknown").slice(0, 64);
                    var flagValue = (flag.value  !== undefined) ? String(flag.value).slice(0, 64)
                                                                : (flag.enabled ? "true" : "false");
                    exposureEvents.push({
                        name: "flag_exposure",
                        id:   "fe_" + targetId + "_" + flagName + "_" + nowSec,
                        timestamp: nowSec,
                        value: flagValue,
                        metadata: {
                            flag_name:     flagName,
                            flag_value:    flagValue,
                            experiment_id: flag.experiment_id || flag.experimentId || null
                        }
                    });
                    exposureCount++;
                }
                sdEventsPublish(ctx, nk, logger, targetId, exposureEvents);
            }
        } catch (e) {
            logger.warn("[satori_identity] flag_exposure publish error: " + e.message);
        }
    }

    // Shape the response to match what Unity expects:
    // a list of { name, value, enabled } flags.
    var flagList = [];
    if (Array.isArray(flags)) {
        for (var i = 0; i < flags.length; i++) {
            var f = flags[i];
            flagList.push({
                name:          f.name  || f.id    || "unknown",
                value:         f.value !== undefined ? f.value : null,
                enabled:       f.enabled !== undefined ? f.enabled : true,
                experiment_id: f.experiment_id || f.experimentId || null
            });
        }
    }

    return siOk({
        user_id:        targetId,
        flags:          flagList,
        flag_count:     flagList.length,
        exposure_count: exposureCount,
        satori_ok:      satoriOk,
        fetched_at:     new Date().toISOString()
    });
}

// ─── Piggyback auto-sync (Phase 8 wiring) ─────────────────────────────────────
//
// Called from analytics_log_event on every ingest. Debounced to at most one
// batch of 50 users per hour per Nakama process instance so the ingest hot
// path never takes a Satori hit outside the normal batch window.
//
// Pattern mirrors abAutoRunIfNeeded in analytics_backfill.js.

var siPiggybackNextAllowedSec  = 0;   // process-local: 0 = run immediately
var SI_PIGGYBACK_DEBOUNCE_SEC  = 3600; // 1 h between piggyback runs
var SI_PIGGYBACK_BATCH_LIMIT   = 50;   // users per piggyback tick
// Well-known key in SI_STATE_COLLECTION storing the storageList cursor the
// piggyback batch should resume from. Without this, every tick restarted
// from the FIRST page of game_player_analytics, so only the first ~150 GPA
// docs were ever considered and the rest of the population never synced.
var SI_PIGGYBACK_CURSOR_KEY    = "__piggyback_cursor__";

function siAutoRunIfNeeded(ctx, nk, logger) {
    try {
        var now = Math.floor(Date.now() / 1000);
        if (now < siPiggybackNextAllowedSec) return null;
        siPiggybackNextAllowedSec = now + SI_PIGGYBACK_DEBOUNCE_SEC;

        // Resume the GPA scan from where the previous tick left off (persisted,
        // so it advances across process restarts too). When the cursor is
        // exhausted we wrap back to the start of the collection.
        var savedCursor = "";
        try {
            var curDoc = siReadOne(nk, SI_STATE_COLLECTION, SI_PIGGYBACK_CURSOR_KEY, SI_SYSTEM_USER);
            if (curDoc && typeof curDoc.cursor === "string") savedCursor = curDoc.cursor;
        } catch (eCur) { /* best-effort — fall back to start */ }

        // Use a system-user context so the admin gate always passes.
        // siAutoRunIfNeeded is only called from rpcAnalyticsLogEvent (internal
        // path) — never from a client RPC. The process-local debounce already
        // rate-limits to at most one batch per hour, so no abuse surface here.
        var sysCtx = { userId: SI_SYSTEM_USER, env: (ctx && ctx.env) || {} };
        var batchData = { limit: SI_PIGGYBACK_BATCH_LIMIT, cursor: savedCursor };
        var fakePayload = JSON.stringify(batchData);
        var result = JSON.parse(rpcSatoriIdentityBatch(sysCtx, logger, nk, fakePayload) || "{}");

        // Persist the next cursor so the following tick continues through the
        // population. An exhausted cursor (no next_cursor) wraps to "".
        try {
            siWriteOne(nk, SI_STATE_COLLECTION, SI_PIGGYBACK_CURSOR_KEY, SI_SYSTEM_USER, {
                cursor: (result && result.next_cursor) ? String(result.next_cursor) : "",
                updated_at: new Date().toISOString()
            });
        } catch (eCw) { /* best-effort */ }

        if (logger && logger.info) {
            logger.info("[satori_identity] piggyback synced=" + (result.synced || 0) +
                        " skipped=" + (result.skipped || 0) +
                        " errors=" + (result.errors || 0) +
                        " skip_reasons=" + JSON.stringify(result.skip_reasons || {}) +
                        " resumed_cursor=" + (savedCursor ? "yes" : "no") +
                        " wrapped=" + ((result && result.next_cursor) ? "no" : "yes"));
        }

        // Write a sync heartbeat so the Pipeline Health freshness check knows
        // the Satori identity-sync stage is running, even when all users were
        // recently synced (skipped > 0) and no new state docs were written.
        try {
            nk.storageWrite([{
                collection: "analytics_rollup_meta",
                key:        "satori_sync_heartbeat",
                userId:     SI_SYSTEM_USER,
                value:      {
                    timestamp:  new Date().toISOString(),
                    synced:     result.synced  || 0,
                    skipped:    result.skipped || 0,
                    skip_reasons: result.skip_reasons || {},
                    errors:     result.errors  || 0,
                    has_more:   result.has_more || false
                },
                permissionRead: 0, permissionWrite: 0
            }]);
        } catch (eHb) { /* best-effort — never block the piggyback */ }

        return result;
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[satori_identity] piggyback error: " + (e.message || e));
        }
        return null;
    }
}

// ─── Registration ─────────────────────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_identity_sync",  rpcSatoriIdentitySync);
    initializer.registerRpc("satori_identity_batch", rpcSatoriIdentityBatch);
    initializer.registerRpc("satori_get_flags",      rpcSatoriGetFlags);
    logger.info("[analytics_satori_identity] Registered: satori_identity_sync, " +
                "satori_identity_batch, satori_get_flags. " +
                "Traits: skill_band, favorite_mode, favorite_topic, spend_tier, " +
                "ad_tolerance, churn_risk, price_sensitivity, best_play_hour, " +
                "country_tier, install_age_days");
}
