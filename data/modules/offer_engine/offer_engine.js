// offer_engine.js — Phase 6 (2026-05) Personalized Offer Engine.
//
// Goal: deliver measurable offers without over-targeting players.
//
// ─── Design principles ───────────────────────────────────────────────────────
//
//   1. Analytics as truth  — eligibility is always derived from the GPA doc
//      (game_player_analytics) and the Phase 5 identity traits computed by
//      analytics_satori_identity.js. The offer engine never reaches into raw
//      event scans at request time.
//
//   2. Natural moments only — offers are surfaced only at five trigger types:
//      quiz_complete / streak_risk / repeated_wrong / rewarded_ad_result /
//      usual_active_hour. Unity passes the trigger when calling
//      offer_get_eligible so the engine returns only contextually relevant
//      offers.
//
//   3. Cooldowns by default — after a player dismisses an offer it cannot
//      appear again for `cooldown_hours` (default: 24 h). After purchase the
//      offer is suppressed for `purchased_cooldown_hours` (default: 168 h = 7 d).
//      The engine enforces both without any client-side state.
//
//   4. Holdout groups — each offer can define a `holdout_pct` (0–100).
//      Players are hashed deterministically into holdout/treatment using
//      FNV-32 so the assignment is stable and reproducible. A player in
//      holdout never sees the offer but their events are still counted so
//      the dashboard can produce a lift comparison.
//
//   5. Max shows per day — `max_shows_per_day` guards against showing the
//      same offer to the same player more than N times in a 24 h window.
//
// ─── Storage layout ──────────────────────────────────────────────────────────
//
//   offer_catalog / <offer_id>          (system user)
//     The offer definition: metadata, eligibility rules, cooldowns, holdout.
//
//   offer_player_state / <userId>_<offerId>   (system user)
//     Per-player per-offer state: last_viewed_utc, last_dismissed_utc,
//     last_purchased_utc, views_today, assigned, holdout.
//
//   offer_engine_meta / last_status     (system user)
//     Last batch-assign run summary.
//
// ─── Registered RPCs ─────────────────────────────────────────────────────────
//
// Player-facing (require live session, only access own data):
//   offer_get_eligible     { game_id?, trigger?, limit? }
//   offer_record_view      { offer_id, game_id? }
//   offer_record_click     { offer_id, game_id? }
//   offer_record_dismiss   { offer_id, game_id? }
//   offer_record_purchase  { offer_id, game_id?, product_id?, price_usd? }
//
// Admin-gated:
//   offer_upsert           { offer: { offer_id, ... } }      create or update offer
//   offer_list             { game_id?, active_only?: bool }  list offers + stats
//   offer_status           {}                                engine health summary
//
// ─── Offer catalog schema ─────────────────────────────────────────────────────
//
//   {
//     offer_id:              string   (slug, e.g. "starter_pack_50pct")
//     game_id:               string   (filters to this game; "all" = any game)
//     title:                 string   (display name for debugging)
//     product_id:            string   (IAP product ID to unlock)
//     price_usd:             number   (display price)
//     active:                bool     (false = soft-delete)
//     triggers:              string[] (quiz_complete, streak_risk, repeated_wrong,
//                                      rewarded_ad_result, usual_active_hour, any)
//     eligible_spend_tiers:  string[] (non_spender, low, mid, high — from trait)
//     eligible_churn_risks:  string[] (low, medium, high)
//     eligible_skill_bands:  string[] (beginner, intermediate, expert)
//     min_install_age_days:  number   (0 = no minimum)
//     max_install_age_days:  number   (9999 = no maximum)
//     min_quiz_plays:        number
//     cooldown_hours:        number   (default 24)
//     purchased_cooldown_hours: number (default 168)
//     max_shows_per_day:     number   (default 3)
//     holdout_pct:           number   (0–100; default 0 = no holdout)
//     priority:              number   (higher = shown first when multiple match)
//     created_at:            string   (ISO-8601)
//     updated_at:            string   (ISO-8601)
//   }

var OE_SYSTEM_USER      = "00000000-0000-0000-0000-000000000000";
var OE_ADMIN_COLLECTION = "admin_users";
var OE_CATALOG_COLLECTION   = "offer_catalog";
var OE_STATE_COLLECTION     = "offer_player_state";
var OE_META_COLLECTION      = "offer_engine_meta";
var OE_GPA_COLLECTION       = "game_player_analytics";
var OE_SATORI_ID_COLLECTION = "analytics_satori_id_state";

var OE_DEFAULT_COOLDOWN_HOURS           = 24;
var OE_DEFAULT_PURCHASED_COOLDOWN_HOURS = 168;
var OE_DEFAULT_MAX_SHOWS_PER_DAY        = 3;
var OE_MAX_OFFERS_PER_REQUEST           = 10;
var OE_CATALOG_PAGE_SIZE                = 200;

// Valid trigger names (also accepted: "any" = match any trigger).
var OE_VALID_TRIGGERS = {
    "quiz_complete": 1, "streak_risk": 1, "repeated_wrong": 1,
    "rewarded_ad_result": 1, "usual_active_hour": 1, "any": 1
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function oeParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}

function oeOk(data) {
    var out = { success: true };
    if (data) for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) out[k] = data[k];
    return JSON.stringify(out);
}

function oeErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}

function oeEnv(ctx, key) {
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

function oeIsAdmin(ctx, nk) {
    if (!ctx.userId) return false;
    if (ctx.userId === OE_SYSTEM_USER) return true;
    if (!ctx.username || ctx.username.indexOf("admin:") !== 0) return false;
    try {
        var recs = nk.storageRead([{ collection: OE_ADMIN_COLLECTION, key: "profile", userId: ctx.userId }]);
        if (!recs || recs.length === 0) return false;
        var r = recs[0].value || {};
        if (!r.isAdmin) return false;
        if (r.expiresAt && r.expiresAt < Math.floor(Date.now() / 1000)) return false;
        return true;
    } catch (e) { return false; }
}

function oeRequireAdmin(ctx, nk, data) {
    var secret = oeEnv(ctx, "DASHBOARD_SECRET");
    if (secret && data && data.dashboard_secret === secret) return { ok: true, bypass: "secret" };
    if (oeIsAdmin(ctx, nk)) return { ok: true, bypass: "session" };
    return { ok: false, reason: "admin authentication required" };
}

function oeResolveGameId(g) {
    if (!g) return g;
    try { if (typeof resolveGameIdAlias === "function") return resolveGameIdAlias(g); } catch (e) { /* */ }
    return g;
}

function oeReadOne(nk, collection, key, userId) {
    try {
        var r = nk.storageRead([{ collection: collection, key: key, userId: userId || OE_SYSTEM_USER }]);
        return (r && r.length > 0) ? (r[0].value || null) : null;
    } catch (e) { return null; }
}

function oeWriteOne(nk, collection, key, userId, value) {
    try {
        nk.storageWrite([{
            collection: collection, key: key, userId: userId || OE_SYSTEM_USER,
            value: value, permissionRead: 0, permissionWrite: 0
        }]);
    } catch (e) { /* best-effort */ }
}

function oeNowSec() { return Math.floor(Date.now() / 1000); }

function oeIsoNow() { return new Date().toISOString(); }

// Deterministic FNV-32a hash for holdout assignment.
// userId + offerId → stable 0–99 bucket, consistent across all server nodes.
function oeHoldoutBucket(userId, offerId) {
    var s = userId + ":" + offerId;
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = ((h * 0x01000193) >>> 0); // FNV prime, keep in 32-bit unsigned
    }
    return h % 100;
}

// Fire analytics event via the global analytics log path.
// Falls back gracefully if the analytics module symbols aren't yet available.
function oeFireEvent(ctx, nk, logger, userId, gameId, eventName, eventData) {
    try {
        if (typeof rpcAnalyticsLogEvent === "function") {
            rpcAnalyticsLogEvent(ctx, logger, nk, JSON.stringify({
                event_name: eventName,
                user_id:    userId,
                game_id:    gameId,
                schema_version: 2,
                client_event_id: "oe_" + userId + "_" + eventName + "_" + oeNowSec(),
                event_time: new Date().toISOString(),
                event_data: eventData || {}
            }));
        } else if (typeof sdEventsPublish === "function") {
            // Fallback: push directly to Satori (best-effort)
            sdEventsPublish(ctx, nk, logger, userId, [{
                name: eventName,
                id:   "oe_" + userId + "_" + eventName + "_" + oeNowSec(),
                timestamp: oeNowSec(),
                metadata: eventData || {}
            }]);
        }
    } catch (e) {
        if (logger) logger.warn("[offer_engine] fireEvent error " + eventName + ": " + e.message);
    }
}

// ─── Offer catalog helpers ────────────────────────────────────────────────────

function oeDefaultOffer() {
    return {
        offer_id: "",
        game_id: "all",
        title: "",
        product_id: "",
        price_usd: 0,
        active: true,
        triggers: ["any"],
        eligible_spend_tiers:  [],   // empty = all tiers
        eligible_churn_risks:  [],   // empty = all
        eligible_skill_bands:  [],   // empty = all
        min_install_age_days:  0,
        max_install_age_days:  9999,
        min_quiz_plays:        0,
        cooldown_hours:            OE_DEFAULT_COOLDOWN_HOURS,
        purchased_cooldown_hours:  OE_DEFAULT_PURCHASED_COOLDOWN_HOURS,
        max_shows_per_day:         OE_DEFAULT_MAX_SHOWS_PER_DAY,
        holdout_pct: 0,
        priority: 0,
        created_at: "",
        updated_at: ""
    };
}

function oeValidateOffer(offer) {
    if (!offer) return "offer object required";
    if (!offer.offer_id || typeof offer.offer_id !== "string" || offer.offer_id.trim().length === 0) {
        return "offer_id (non-empty string) required";
    }
    if (!/^[a-z0-9_\-]{1,64}$/.test(offer.offer_id)) {
        return "offer_id must match /^[a-z0-9_\\-]{1,64}$/";
    }
    if (offer.holdout_pct !== undefined) {
        var hp = parseInt(offer.holdout_pct, 10);
        if (isNaN(hp) || hp < 0 || hp > 100) return "holdout_pct must be 0–100";
    }
    return null; // valid
}

function oeReadCatalog(nk) {
    var offers = [];
    var cursor = "";
    var iter   = 0;
    try {
        do {
            var r = nk.storageList(OE_SYSTEM_USER, OE_CATALOG_COLLECTION, OE_CATALOG_PAGE_SIZE, cursor);
            if (!r || !r.objects || r.objects.length === 0) break;
            for (var i = 0; i < r.objects.length; i++) {
                var v = r.objects[i].value;
                if (v) offers.push(v);
            }
            cursor = r.cursor || "";
            iter++;
        } while (cursor && iter < 10);
    } catch (e) { /* ignore */ }
    return offers;
}

// ─── Eligibility engine ──────────────────────────────────────────────────────

/**
 * Read player's GPA doc and Satori identity state to assemble their traits.
 * Returns a lightweight trait snapshot for eligibility checks.
 */
function oeGetPlayerTraits(nk, userId, gameId) {
    gameId = oeResolveGameId(gameId || "default");
    var gpaKey = gameId + ":" + userId;
    var gpa = null;
    try {
        var recs = nk.storageRead([{ collection: OE_GPA_COLLECTION, key: gpaKey, userId: userId }]);
        if (recs && recs.length > 0) gpa = recs[0].value || null;
    } catch (e) { /* not found */ }

    if (!gpa) return null; // no profile = no offers (player too new)

    var nowSec = oeNowSec();
    var money  = gpa.money  || {};
    var eng    = gpa.eng    || {};

    // Re-compute traits inline (mirrors siComputeTraits from analytics_satori_identity.js)
    // so the offer engine works even if the Satori sync hasn't run yet.
    var iapCount  = money.iap_count || 0;
    var spendUsd  = money.spend_usd || 0;
    var spendTier;
    if (iapCount === 0)                      spendTier = "non_spender";
    else if (iapCount <= 2 || spendUsd < 10) spendTier = "low";
    else if (iapCount <= 5 || spendUsd < 50) spendTier = "mid";
    else                                     spendTier = "high";

    var lastActiveSec   = gpa.last_active_utc || 0;
    var daysSinceActive = lastActiveSec > 0 ? Math.floor((nowSec - lastActiveSec) / 86400) : null;
    var churnRisk;
    if (daysSinceActive === null)      churnRisk = "unknown";
    else if (daysSinceActive <= 3)     churnRisk = "low";
    else if (daysSinceActive <= 14)    churnRisk = "medium";
    else                               churnRisk = "high";

    var avgAcc = (typeof eng.avg_accuracy === "number") ? eng.avg_accuracy : -1;
    var totalAnswered = (typeof eng.total_answered === "number") ? eng.total_answered : 0;
    var skillBand;
    if (totalAnswered < 10 || avgAcc < 0) skillBand = "beginner";
    else if (avgAcc >= 70)                skillBand = "expert";
    else if (avgAcc >= 40)                skillBand = "intermediate";
    else                                  skillBand = "beginner";

    var firstSeen    = gpa.first_seen_utc || 0;
    var installAgeDays = firstSeen > 0 ? Math.floor((nowSec - firstSeen) / 86400) : 0;

    var ltQuizPlays  = gpa.lt_quiz_plays || 0;

    // Best play hour from sessions
    var bestPlayHour = null;
    try {
        var sessions = gpa.sessions || [];
        if (sessions.length > 0) {
            var hc = {};
            for (var si = 0; si < sessions.length; si++) {
                var ts = parseInt(sessions[si].start || sessions[si].startUtc || sessions[si].ts || 0, 10);
                if (ts > 0) {
                    var h = new Date(ts > 1e12 ? ts : ts * 1000).getUTCHours();
                    hc[h] = (hc[h] || 0) + 1;
                }
            }
            var bestH = -1, bestHN = 0;
            for (var hk in hc) {
                if (Object.prototype.hasOwnProperty.call(hc, hk) && hc[hk] > bestHN) {
                    bestHN = hc[hk]; bestH = parseInt(hk, 10);
                }
            }
            if (bestH >= 0) bestPlayHour = bestH;
        }
    } catch (e) { /* */ }

    var currentHour = new Date().getUTCHours();

    return {
        user_id:          userId,
        game_id:          gameId,
        spend_tier:       spendTier,
        churn_risk:       churnRisk,
        skill_band:       skillBand,
        install_age_days: installAgeDays,
        lt_quiz_plays:    ltQuizPlays,
        best_play_hour:   bestPlayHour,
        current_hour:     currentHour,
        is_best_play_hour: (bestPlayHour !== null && Math.abs(bestPlayHour - currentHour) <= 1)
    };
}

/**
 * Check whether a player is eligible for a specific offer.
 * Returns { eligible: bool, reason: string }.
 */
function oeCheckEligibility(offer, traits, trigger, playerState, nowSec) {
    if (!offer.active) return { eligible: false, reason: "offer_inactive" };

    // ── Trigger match ────────────────────────────────
    if (trigger && trigger !== "any") {
        var offerTriggers = offer.triggers || ["any"];
        var hasAny = false;
        for (var ti = 0; ti < offerTriggers.length; ti++) {
            if (offerTriggers[ti] === "any" || offerTriggers[ti] === trigger) { hasAny = true; break; }
        }
        if (!hasAny) return { eligible: false, reason: "trigger_mismatch" };
    }

    // ── Segment filters (empty array = no restriction) ──
    if (offer.eligible_spend_tiers && offer.eligible_spend_tiers.length > 0) {
        var foundTier = false;
        for (var si = 0; si < offer.eligible_spend_tiers.length; si++) {
            if (offer.eligible_spend_tiers[si] === traits.spend_tier) { foundTier = true; break; }
        }
        if (!foundTier) return { eligible: false, reason: "spend_tier_mismatch" };
    }

    if (offer.eligible_churn_risks && offer.eligible_churn_risks.length > 0) {
        var foundChurn = false;
        for (var ci = 0; ci < offer.eligible_churn_risks.length; ci++) {
            if (offer.eligible_churn_risks[ci] === traits.churn_risk) { foundChurn = true; break; }
        }
        if (!foundChurn) return { eligible: false, reason: "churn_risk_mismatch" };
    }

    if (offer.eligible_skill_bands && offer.eligible_skill_bands.length > 0) {
        var foundSkill = false;
        for (var ki = 0; ki < offer.eligible_skill_bands.length; ki++) {
            if (offer.eligible_skill_bands[ki] === traits.skill_band) { foundSkill = true; break; }
        }
        if (!foundSkill) return { eligible: false, reason: "skill_band_mismatch" };
    }

    // ── Install age ──────────────────────────────────
    var minAge = offer.min_install_age_days || 0;
    var maxAge = offer.max_install_age_days !== undefined ? offer.max_install_age_days : 9999;
    if (traits.install_age_days < minAge) return { eligible: false, reason: "too_new" };
    if (traits.install_age_days > maxAge) return { eligible: false, reason: "too_old" };

    // ── Min quiz plays ───────────────────────────────
    var minPlays = offer.min_quiz_plays || 0;
    if (traits.lt_quiz_plays < minPlays) return { eligible: false, reason: "not_enough_plays" };

    // ── Usual active hour ────────────────────────────
    if (trigger === "usual_active_hour" && !traits.is_best_play_hour) {
        return { eligible: false, reason: "not_active_hour" };
    }

    // ── Holdout group ────────────────────────────────
    var holdoutPct = offer.holdout_pct || 0;
    if (holdoutPct > 0) {
        var bucket = oeHoldoutBucket(traits.user_id, offer.offer_id);
        if (bucket < holdoutPct) {
            return { eligible: false, reason: "holdout_group", holdout: true };
        }
    }

    // ── Cooldowns ────────────────────────────────────
    if (playerState) {
        var cooldownHours = offer.cooldown_hours !== undefined
            ? offer.cooldown_hours : OE_DEFAULT_COOLDOWN_HOURS;
        if (playerState.last_dismissed_utc && cooldownHours > 0) {
            var cooldownSec = cooldownHours * 3600;
            if ((nowSec - playerState.last_dismissed_utc) < cooldownSec) {
                return { eligible: false, reason: "on_dismiss_cooldown" };
            }
        }

        var purchasedCooldownHours = offer.purchased_cooldown_hours !== undefined
            ? offer.purchased_cooldown_hours : OE_DEFAULT_PURCHASED_COOLDOWN_HOURS;
        if (playerState.last_purchased_utc && purchasedCooldownHours > 0) {
            var purchasedCooldownSec = purchasedCooldownHours * 3600;
            if ((nowSec - playerState.last_purchased_utc) < purchasedCooldownSec) {
                return { eligible: false, reason: "on_purchase_cooldown" };
            }
        }

        // ── Max shows per day ────────────────────────
        var maxShows = offer.max_shows_per_day !== undefined
            ? offer.max_shows_per_day : OE_DEFAULT_MAX_SHOWS_PER_DAY;
        if (maxShows > 0 && playerState.views_today >= maxShows) {
            var today = new Date().toISOString().slice(0, 10);
            if (playerState.views_today_date === today) {
                return { eligible: false, reason: "max_shows_reached" };
            }
        }
    }

    return { eligible: true, reason: "ok" };
}

// ─── RPC: offer_get_eligible ──────────────────────────────────────────────────

/**
 * Returns offers the calling player can see right now.
 *
 * Payload:
 *   game_id   : optional
 *   trigger   : optional — one of quiz_complete | streak_risk | repeated_wrong |
 *               rewarded_ad_result | usual_active_hour | any (default: any)
 *   limit     : 1–10, default 3
 *
 * For each returned offer, also emits:
 *   - offer_eligible  (always, so the funnel denominator is always counted)
 *   - offer_assigned  (if the player is in treatment, not holdout)
 */
function rpcOfferGetEligible(ctx, logger, nk, payload) {
    var data   = oeParse(payload);
    var userId = ctx.userId;
    if (!userId) return oeErr("session required", 401);

    var gameId  = oeResolveGameId(data.game_id || data.gameId || "default");
    var trigger = (data.trigger || "any").toLowerCase();
    var limit   = Math.min(OE_MAX_OFFERS_PER_REQUEST, Math.max(1, parseInt(data.limit, 10) || 3));

    // Load traits.
    var traits = oeGetPlayerTraits(nk, userId, gameId);
    if (!traits) {
        return oeOk({ offers: [], reason: "no_player_profile", trigger: trigger });
    }

    // Load catalog.
    var catalog = oeReadCatalog(nk);
    if (!catalog.length) {
        return oeOk({ offers: [], reason: "empty_catalog", trigger: trigger });
    }

    var nowSec = oeNowSec();
    var eligible = [];

    for (var ci = 0; ci < catalog.length; ci++) {
        var offer = catalog[ci];
        if (!offer || !offer.offer_id) continue;

        // Filter by game_id if the offer specifies one.
        if (offer.game_id && offer.game_id !== "all" && offer.game_id !== gameId) continue;

        // Load per-player state for this offer.
        var stateKey    = userId + "_" + offer.offer_id;
        var playerState = oeReadOne(nk, OE_STATE_COLLECTION, stateKey, OE_SYSTEM_USER);

        // Always fire offer_eligible so the funnel denominator is counted.
        oeFireEvent(ctx, nk, logger, userId, gameId, "offer_eligible", {
            offer_id:   offer.offer_id,
            product_id: offer.product_id || null,
            trigger:    trigger
        });

        var check = oeCheckEligibility(offer, traits, trigger, playerState, nowSec);

        if (!check.eligible) {
            // If the player is in holdout, fire offer_cooldown_blocked so the
            // holdout/treatment split is visible in the offer funnel dashboard.
            if (check.holdout) {
                oeFireEvent(ctx, nk, logger, userId, gameId, "offer_cooldown_blocked", {
                    offer_id: offer.offer_id,
                    reason:   "holdout_group"
                });
            }
            continue;
        }

        // Assign the offer.
        var assigned = (playerState && playerState.assigned) ? playerState.assigned : false;
        if (!assigned) {
            // First time this player was assigned this offer.
            var newState = playerState || { offer_id: offer.offer_id, user_id: userId };
            newState.assigned    = true;
            newState.assigned_at = nowSec;
            oeWriteOne(nk, OE_STATE_COLLECTION, stateKey, OE_SYSTEM_USER, newState);

            oeFireEvent(ctx, nk, logger, userId, gameId, "offer_assigned", {
                offer_id:   offer.offer_id,
                product_id: offer.product_id || null,
                trigger:    trigger
            });
        }

        eligible.push({
            offer_id:     offer.offer_id,
            title:        offer.title        || "",
            product_id:   offer.product_id   || "",
            price_usd:    offer.price_usd    || 0,
            trigger:      trigger,
            priority:     offer.priority     || 0
        });

        if (eligible.length >= limit) break;
    }

    // Sort by priority descending.
    eligible.sort(function (a, b) { return b.priority - a.priority; });

    return oeOk({
        offers:       eligible,
        offer_count:  eligible.length,
        trigger:      trigger,
        game_id:      gameId,
        traits: {
            spend_tier:       traits.spend_tier,
            churn_risk:       traits.churn_risk,
            skill_band:       traits.skill_band,
            install_age_days: traits.install_age_days,
            lt_quiz_plays:    traits.lt_quiz_plays
        }
    });
}

// ─── RPC helpers: per-offer lifecycle recording ──────────────────────────────

function oeRecordLifecycle(ctx, nk, logger, userId, gameId, offerId, eventName, extra) {
    if (!userId || !offerId) return oeErr("session + offer_id required", 400);
    var nowSec  = oeNowSec();
    var stateKey = userId + "_" + offerId;
    var state    = oeReadOne(nk, OE_STATE_COLLECTION, stateKey, OE_SYSTEM_USER) || {};
    var today    = new Date().toISOString().slice(0, 10);

    // Ensure the offer exists in catalog (best-effort — don't block the lifecycle
    // call if the catalog read fails, since client may have a valid offer
    // from a previous get_eligible call).
    var offer = oeReadOne(nk, OE_CATALOG_COLLECTION, offerId, OE_SYSTEM_USER) || {};

    switch (eventName) {
        case "offer_viewed":
            state.last_viewed_utc = nowSec;
            // Daily view counter (resets when date changes).
            if (state.views_today_date !== today) {
                state.views_today      = 0;
                state.views_today_date = today;
            }
            state.views_today = (state.views_today || 0) + 1;
            state.total_views = (state.total_views  || 0) + 1;
            break;

        case "offer_clicked":
            state.last_clicked_utc = nowSec;
            state.total_clicks     = (state.total_clicks || 0) + 1;
            break;

        case "offer_dismissed":
            state.last_dismissed_utc = nowSec;
            state.total_dismissals   = (state.total_dismissals || 0) + 1;
            break;

        case "offer_purchased":
            state.last_purchased_utc = nowSec;
            state.total_purchases    = (state.total_purchases || 0) + 1;
            state.last_product_id    = extra.product_id || offer.product_id || null;
            state.last_price_usd     = extra.price_usd  || offer.price_usd  || 0;
            break;
    }

    state.offer_id = offerId;
    state.user_id  = userId;
    oeWriteOne(nk, OE_STATE_COLLECTION, stateKey, OE_SYSTEM_USER, state);

    // Fire analytics event.
    oeFireEvent(ctx, nk, logger, userId, gameId, eventName, Object.assign({
        offer_id:   offerId,
        product_id: offer.product_id || extra.product_id || null,
        price_usd:  offer.price_usd  || extra.price_usd  || 0
    }, extra || {}));

    return null; // success
}

// ─── RPC: offer_record_view ──────────────────────────────────────────────────

function rpcOfferRecordView(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    if (!ctx.userId) return oeErr("session required", 401);
    var gameId  = oeResolveGameId(data.game_id || data.gameId || "default");
    var offerId = data.offer_id || data.offerId;
    if (!offerId) return oeErr("offer_id required", 400);
    var err = oeRecordLifecycle(ctx, nk, logger, ctx.userId, gameId, offerId, "offer_viewed", {});
    return err || oeOk({ offer_id: offerId, recorded: "viewed" });
}

// ─── RPC: offer_record_click ─────────────────────────────────────────────────

function rpcOfferRecordClick(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    if (!ctx.userId) return oeErr("session required", 401);
    var gameId  = oeResolveGameId(data.game_id || data.gameId || "default");
    var offerId = data.offer_id || data.offerId;
    if (!offerId) return oeErr("offer_id required", 400);
    var err = oeRecordLifecycle(ctx, nk, logger, ctx.userId, gameId, offerId, "offer_clicked", {});
    return err || oeOk({ offer_id: offerId, recorded: "clicked" });
}

// ─── RPC: offer_record_dismiss ───────────────────────────────────────────────

function rpcOfferRecordDismiss(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    if (!ctx.userId) return oeErr("session required", 401);
    var gameId  = oeResolveGameId(data.game_id || data.gameId || "default");
    var offerId = data.offer_id || data.offerId;
    if (!offerId) return oeErr("offer_id required", 400);
    var err = oeRecordLifecycle(ctx, nk, logger, ctx.userId, gameId, offerId, "offer_dismissed", {});
    return err || oeOk({ offer_id: offerId, recorded: "dismissed" });
}

// ─── RPC: offer_record_purchase ──────────────────────────────────────────────

function rpcOfferRecordPurchase(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    if (!ctx.userId) return oeErr("session required", 401);
    var gameId  = oeResolveGameId(data.game_id || data.gameId || "default");
    var offerId = data.offer_id || data.offerId;
    if (!offerId) return oeErr("offer_id required", 400);
    var extra = {
        product_id: data.product_id || null,
        price_usd:  parseFloat(data.price_usd || 0)
    };
    var err = oeRecordLifecycle(ctx, nk, logger, ctx.userId, gameId, offerId, "offer_purchased", extra);
    return err || oeOk({ offer_id: offerId, recorded: "purchased" });
}

// ─── RPC: offer_upsert (admin) ───────────────────────────────────────────────

/**
 * Create or update an offer in the catalog.
 *
 * Payload: { offer: { offer_id, ...fields }, dashboard_secret? }
 *
 * Merges into existing doc (fields not provided keep their old values).
 */
function rpcOfferUpsert(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    var gate = oeRequireAdmin(ctx, nk, data);
    if (!gate.ok) return oeErr(gate.reason, 401);

    var incoming = data.offer || data;
    var err = oeValidateOffer(incoming);
    if (err) return oeErr(err, 400);

    var offerId  = incoming.offer_id.trim().toLowerCase();
    var existing = oeReadOne(nk, OE_CATALOG_COLLECTION, offerId, OE_SYSTEM_USER) || oeDefaultOffer();

    // Merge incoming fields into the existing doc.
    var fields = [
        "game_id","title","product_id","price_usd","active","triggers",
        "eligible_spend_tiers","eligible_churn_risks","eligible_skill_bands",
        "min_install_age_days","max_install_age_days","min_quiz_plays",
        "cooldown_hours","purchased_cooldown_hours","max_shows_per_day",
        "holdout_pct","priority"
    ];
    for (var fi = 0; fi < fields.length; fi++) {
        var f = fields[fi];
        if (Object.prototype.hasOwnProperty.call(incoming, f)) existing[f] = incoming[f];
    }
    existing.offer_id   = offerId;
    existing.updated_at = oeIsoNow();
    if (!existing.created_at) existing.created_at = oeIsoNow();

    oeWriteOne(nk, OE_CATALOG_COLLECTION, offerId, OE_SYSTEM_USER, existing);
    logger.info("[offer_engine] upserted offer " + offerId);

    return oeOk({ offer: existing });
}

// ─── RPC: offer_list (admin) ─────────────────────────────────────────────────

/**
 * List all offers in the catalog with optional filtering.
 *
 * Payload: { game_id?, active_only?: bool }
 */
function rpcOfferList(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    var gate = oeRequireAdmin(ctx, nk, data);
    if (!gate.ok) return oeErr(gate.reason, 401);

    var gameId     = data.game_id ? oeResolveGameId(data.game_id) : null;
    var activeOnly = (data.active_only === true || data.active_only === "true");

    var catalog = oeReadCatalog(nk);
    var results = [];
    for (var i = 0; i < catalog.length; i++) {
        var o = catalog[i];
        if (activeOnly && !o.active) continue;
        if (gameId && o.game_id && o.game_id !== "all" && o.game_id !== gameId) continue;
        results.push(o);
    }
    results.sort(function (a, b) { return (b.priority || 0) - (a.priority || 0); });

    return oeOk({ offers: results, count: results.length });
}

// ─── RPC: offer_status (admin) ───────────────────────────────────────────────

/**
 * Engine health summary: catalog size, active offers, recent funnel snapshot.
 */
function rpcOfferStatus(ctx, logger, nk, payload) {
    var data = oeParse(payload);
    var gate = oeRequireAdmin(ctx, nk, data);
    if (!gate.ok) return oeErr(gate.reason, 401);

    var catalog = oeReadCatalog(nk);
    var total   = catalog.length;
    var active  = 0;
    var withHoldout = 0;
    for (var i = 0; i < catalog.length; i++) {
        if (catalog[i].active) active++;
        if ((catalog[i].holdout_pct || 0) > 0) withHoldout++;
    }

    return oeOk({
        catalog_size:     total,
        active_offers:    active,
        inactive_offers:  total - active,
        offers_with_holdout: withHoldout,
        valid_triggers:   Object.keys(OE_VALID_TRIGGERS),
        default_cooldown_hours: OE_DEFAULT_COOLDOWN_HOURS,
        default_purchased_cooldown_hours: OE_DEFAULT_PURCHASED_COOLDOWN_HOURS,
        default_max_shows_per_day: OE_DEFAULT_MAX_SHOWS_PER_DAY,
        checked_at: oeIsoNow()
    });
}

// ─── Registration ─────────────────────────────────────────────────────────────

// ─── Default offer catalog seed ──────────────────────────────────────────────
//
// Three "starter offers" written on first boot (skipped if an offer with the
// same offer_id already exists in the catalog). These are intentionally
// conservative targeting ranges so they never fire in error. Live-ops can
// adjust them via offer_upsert at any time.
//
// Offer design rationale:
//   quiz_bundle_starter  — shown after first 3 quiz plays to brand-new
//                          non-spenders. Low-friction entry-level SKU.
//   premium_week_trial   — shown on paywall_shown trigger to mid-skill players
//                          who have seen the paywall twice (price-sensitive
//                          explorers likely to trial before committing).
//   coin_booster_churn   — shown at quiz_complete to players with high
//                          churn_risk (haven't played in 5-10 days).
//                          20% holdout by default for lift measurement.

var OE_DEFAULT_SEED_OFFERS = [
    {
        offer_id:    "quiz_bundle_starter",
        game_id:     "all",
        title:       "Starter Bundle — 5 Quiz Packs",
        product_id:  "com.intelliversex.quizverse.starter_bundle",
        price_usd:   1.99,
        active:      true,
        triggers:    ["quiz_complete"],
        eligible_spend_tiers:  ["non_spender"],
        eligible_churn_risks:  [],
        eligible_skill_bands:  [],
        min_install_age_days:  0,
        max_install_age_days:  30,
        min_quiz_plays:        3,
        cooldown_hours:        48,
        purchased_cooldown_hours: 720,
        max_shows_per_day:     2,
        holdout_pct:           10,
        priority:              10
    },
    {
        offer_id:    "premium_week_trial",
        game_id:     "all",
        title:       "1-Week Premium Trial",
        product_id:  "com.intelliversex.quizverse.premium_trial_7d",
        price_usd:   0.99,
        active:      true,
        triggers:    ["quiz_complete", "any"],
        eligible_spend_tiers:  ["non_spender", "low"],
        eligible_churn_risks:  ["low", "medium"],
        eligible_skill_bands:  ["intermediate", "expert"],
        min_install_age_days:  3,
        max_install_age_days:  60,
        min_quiz_plays:        5,
        cooldown_hours:        72,
        purchased_cooldown_hours: 720,
        max_shows_per_day:     1,
        holdout_pct:           15,
        priority:              20
    },
    {
        offer_id:    "coin_booster_churn",
        game_id:     "all",
        title:       "500 Coins — Welcome Back Deal",
        product_id:  "com.intelliversex.quizverse.coins_500",
        price_usd:   0.99,
        active:      true,
        triggers:    ["quiz_complete"],
        eligible_spend_tiers:  [],
        eligible_churn_risks:  ["high"],
        eligible_skill_bands:  [],
        min_install_age_days:  7,
        max_install_age_days:  9999,
        min_quiz_plays:        3,
        cooldown_hours:        24,
        purchased_cooldown_hours: 168,
        max_shows_per_day:     2,
        holdout_pct:           20,
        priority:              30
    }
];

function oeSeedDefaultOffers(nk, logger) {
    var now = new Date().toISOString();
    var seeded = 0;
    for (var i = 0; i < OE_DEFAULT_SEED_OFFERS.length; i++) {
        var offer = OE_DEFAULT_SEED_OFFERS[i];
        // Only write if not already present — never overwrite live-ops edits.
        var existing = oeReadOne(nk, OE_CATALOG_COLLECTION, offer.offer_id, OE_SYSTEM_USER);
        if (existing && existing.offer_id) continue;
        var full = {};
        for (var k in offer) if (Object.prototype.hasOwnProperty.call(offer, k)) full[k] = offer[k];
        full.created_at = now;
        full.updated_at = now;
        oeWriteOne(nk, OE_CATALOG_COLLECTION, offer.offer_id, OE_SYSTEM_USER, full);
        seeded++;
    }
    if (seeded > 0) logger.info("[offer_engine] Seeded " + seeded + " default offer(s) into catalog.");
}

function InitModule(ctx, logger, nk, initializer) {
    // Player-facing
    initializer.registerRpc("offer_get_eligible",    rpcOfferGetEligible);
    initializer.registerRpc("offer_record_view",     rpcOfferRecordView);
    initializer.registerRpc("offer_record_click",    rpcOfferRecordClick);
    initializer.registerRpc("offer_record_dismiss",  rpcOfferRecordDismiss);
    initializer.registerRpc("offer_record_purchase", rpcOfferRecordPurchase);
    // Admin
    initializer.registerRpc("offer_upsert",  rpcOfferUpsert);
    initializer.registerRpc("offer_list",    rpcOfferList);
    initializer.registerRpc("offer_status",  rpcOfferStatus);
    logger.info("[offer_engine] Registered 8 RPCs: offer_get_eligible, " +
                "offer_record_view/click/dismiss/purchase, offer_upsert/list/status. " +
                "Triggers: " + Object.keys(OE_VALID_TRIGGERS).join(", "));
    // Seed starter offers if catalog is empty.
    try { oeSeedDefaultOffers(nk, logger); } catch (e) { /* never fail startup */ }
}
