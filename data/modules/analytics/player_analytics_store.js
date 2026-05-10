// player_analytics_store.js — Unified per-player per-game analytics storage
//
// Collection: game_player_analytics
// Key:        {gameId}:{userId}
// Owner:      userId
//
// One document per player per game. Supports cross-game player profiles
// via storageList by userId. All functions prefixed with `gpa` to avoid
// global naming collisions in the concatenated Nakama bundle.

var GPA_COLLECTION       = "game_player_analytics";
var GPA_MAX_EVENTS       = 500;
var GPA_MAX_SESSIONS     = 10;
var GPA_MAX_CRASHES      = 5;
var GPA_MAX_DOC_BYTES    = 450000;
var GPA_CAS_MAX_RETRIES  = 5;
var GPA_SCHEMA_VERSION   = 1;
var GPA_MAX_MODE_COUNT   = 1000000;
var GPA_MAX_MODE_KEY_LEN = 64;
var GPA_MAX_MODE_ENTRIES = 64;
var GPA_MAX_EVENT_FIELD  = 500;

// ─── Empty doc factory ────────────────────────────────────────────

function gpaCreateEmptyDoc(gameId, userId) {
    return {
        v: GPA_SCHEMA_VERSION,
        user_id: userId,
        game_id: gameId,
        display_name: "",
        avatar_url: "",
        platform: "unknown",
        country: "??",
        locale: "en",
        device_tier: "unknown",
        device_model: "",
        os_version: "",
        app_version: "",
        install_source: "",
        first_seen_utc: 0,
        last_active_utc: 0,
        days_since_install: 0,
        lt_events: 0,
        lt_sessions: 0,
        lt_quiz_plays: 0,
        fav_mode: "",
        fav_mode_n: 0,
        mode_counts: {},
        events: [],
        sessions: [],
        crashes: [],
        eng: {
            d1: false, d7: false, d30: false,
            streak: 0, streak_max: 0,
            last_mode: "", last_score: 0,
            avg_accuracy: 0, total_correct: 0, total_answered: 0
        },
        money: {
            spend_usd: 0, last_iap_utc: 0, iap_count: 0,
            ad_views: 0, ad_clicks: 0, rewarded_ads: 0,
            reward_tier: "bronze",
            coins_earned: 0, coins_spent: 0,
            // Phase 5 (2026-05) — paywall + IAP funnel telemetry. Powers
            // the pre-IAP nudge segment ("paywall shown >=1 AND iap_count
            // === 0"). last_paywall_utc is unix-seconds.
            paywall_shown_count: 0, paywall_last_utc: 0,
            paywall_dismissed_count: 0,
            iap_started_count: 0, iap_failed_count: 0
        },
        consent: "unknown",
        att_status: "unknown",
        idem_key: "",
        updated_utc: 0
    };
}

// ─── Schema upgrade ───────────────────────────────────────────────

function gpaUpgradeDoc(doc) {
    if (!doc) return gpaCreateEmptyDoc("", "");
    if (!doc.v || doc.v < 1) {
        doc.v = GPA_SCHEMA_VERSION;
        if (!doc.eng || typeof doc.eng !== "object") {
            doc.eng = { d1: false, d7: false, d30: false, streak: 0, streak_max: 0,
                        last_mode: "", last_score: 0, avg_accuracy: 0, total_correct: 0, total_answered: 0 };
        }
        if (!doc.money || typeof doc.money !== "object") {
            doc.money = { spend_usd: 0, last_iap_utc: 0, iap_count: 0, ad_views: 0,
                          ad_clicks: 0, rewarded_ads: 0, reward_tier: "bronze", coins_earned: 0, coins_spent: 0 };
        }
        if (!Array.isArray(doc.crashes)) doc.crashes = [];
        if (!Array.isArray(doc.sessions)) doc.sessions = [];
        if (!Array.isArray(doc.events)) doc.events = [];
        if (!doc.mode_counts || typeof doc.mode_counts !== "object") doc.mode_counts = {};
    }
    return doc;
}

// ─── Safe read with defaults ──────────────────────────────────────

function gpaSafeRead(doc) {
    if (!doc) doc = {};
    return {
        v:                 doc.v || GPA_SCHEMA_VERSION,
        user_id:           doc.user_id || "",
        game_id:           doc.game_id || "",
        display_name:      doc.display_name || "",
        avatar_url:        doc.avatar_url || "",
        platform:          doc.platform || "unknown",
        country:           doc.country || "??",
        locale:            doc.locale || "en",
        device_tier:       doc.device_tier || "unknown",
        device_model:      doc.device_model || "",
        os_version:        doc.os_version || "",
        app_version:       doc.app_version || "",
        install_source:    doc.install_source || "",
        first_seen_utc:    parseInt(doc.first_seen_utc, 10) || 0,
        last_active_utc:   parseInt(doc.last_active_utc, 10) || 0,
        days_since_install:parseInt(doc.days_since_install, 10) || 0,
        lt_events:         parseInt(doc.lt_events, 10) || 0,
        lt_sessions:       parseInt(doc.lt_sessions, 10) || 0,
        lt_quiz_plays:     parseInt(doc.lt_quiz_plays, 10) || 0,
        fav_mode:          doc.fav_mode || "",
        fav_mode_n:        parseInt(doc.fav_mode_n, 10) || 0,
        mode_counts:       (doc.mode_counts && typeof doc.mode_counts === "object") ? doc.mode_counts : {},
        events:            Array.isArray(doc.events) ? doc.events : [],
        sessions:          Array.isArray(doc.sessions) ? doc.sessions : [],
        crashes:           Array.isArray(doc.crashes) ? doc.crashes : [],
        eng:               (doc.eng && typeof doc.eng === "object") ? doc.eng : {},
        money:             (doc.money && typeof doc.money === "object") ? doc.money : {},
        consent:           doc.consent || "unknown",
        att_status:        doc.att_status || "unknown",
        idem_key:          doc.idem_key || "",
        updated_utc:       parseInt(doc.updated_utc, 10) || 0
    };
}

// ─── CAS upsert ───────────────────────────────────────────────────

function gpaCasUpsert(nk, logger, gameId, userId, mutateFn) {
    var key = gameId + ":" + userId;
    for (var attempt = 0; attempt < GPA_CAS_MAX_RETRIES; attempt++) {
        var existing = null;
        var version = null;
        try {
            var objs = nk.storageRead([{
                collection: GPA_COLLECTION, key: key, userId: userId
            }]);
            if (objs && objs.length > 0) {
                existing = objs[0].value || null;
                version = objs[0].version || null;
            }
        } catch (e) { /* treat as not-exists */ }

        var isCreate = !existing;
        var doc = existing ? JSON.parse(JSON.stringify(existing)) : gpaCreateEmptyDoc(gameId, userId);
        doc = gpaUpgradeDoc(doc);

        var modified = mutateFn(doc, isCreate);
        if (!modified) return true; // no change needed

        modified.updated_utc = Math.floor(Date.now() / 1000);

        try {
            nk.storageWrite([{
                collection: GPA_COLLECTION,
                key: key,
                userId: userId,
                value: modified,
                permissionRead: 1,
                permissionWrite: 0,
                version: isCreate ? "*" : version
            }]);
            return true;
        } catch (e) {
            if (attempt === GPA_CAS_MAX_RETRIES - 1 && logger && logger.warn) {
                logger.warn("[game_player_analytics] CAS failed after " +
                    GPA_CAS_MAX_RETRIES + " retries: " + key + " (" + e.message + ")");
            }
        }
    }
    return false;
}

// ─── Event buffer append ──────────────────────────────────────────

function gpaAppendEvent(doc, event) {
    if (!event) return doc;
    // Truncate large string fields in event data
    if (event.d && typeof event.d === "object") {
        for (var k in event.d) {
            if (Object.prototype.hasOwnProperty.call(event.d, k)) {
                if (typeof event.d[k] === "string" && event.d[k].length > GPA_MAX_EVENT_FIELD) {
                    event.d[k] = event.d[k].substring(0, GPA_MAX_EVENT_FIELD);
                }
            }
        }
    }
    doc.events.push(event);
    // FIFO eviction at cap
    while (doc.events.length > GPA_MAX_EVENTS) {
        doc.events.shift();
    }
    // Safety: if doc is still huge, trim aggressively
    var docStr = JSON.stringify(doc);
    while (docStr.length > GPA_MAX_DOC_BYTES && doc.events.length > 50) {
        doc.events.splice(0, 50);
        docStr = JSON.stringify(doc);
    }
    return doc;
}

// ─── Retention & streak update ────────────────────────────────────

function gpaUpdateRetention(doc) {
    if (!doc.first_seen_utc) return doc;
    var nowUtc = Math.floor(Date.now() / 1000);
    var daysSince = Math.floor((nowUtc - doc.first_seen_utc) / 86400);
    doc.days_since_install = daysSince;
    if (!doc.eng) doc.eng = {};
    // Monotonic — once true, never revert
    if (daysSince >= 1 && !doc.eng.d1) doc.eng.d1 = true;
    if (daysSince >= 7 && !doc.eng.d7) doc.eng.d7 = true;
    if (daysSince >= 30 && !doc.eng.d30) doc.eng.d30 = true;
    // Streak: check if last_active was yesterday
    var lastDay = Math.floor((doc.last_active_utc || 0) / 86400);
    var today = Math.floor(nowUtc / 86400);
    if (today === lastDay + 1) {
        doc.eng.streak = (doc.eng.streak || 0) + 1;
        doc.eng.streak_max = Math.max(doc.eng.streak_max || 0, doc.eng.streak);
    } else if (today > lastDay + 1 && lastDay > 0) {
        doc.eng.streak = 1;
    }
    return doc;
}

// ─── Mode counts monotonic merge ──────────────────────────────────

function gpaMergeModeCounts(doc, incoming) {
    if (!incoming || typeof incoming !== "object") return doc;
    var entries = 0;
    for (var k in incoming) {
        if (!Object.prototype.hasOwnProperty.call(incoming, k)) continue;
        if (entries >= GPA_MAX_MODE_ENTRIES) break;
        var key = ("" + k).substring(0, GPA_MAX_MODE_KEY_LEN);
        var iv = parseInt(incoming[k], 10) || 0;
        if (iv < 0) iv = 0;
        if (iv > GPA_MAX_MODE_COUNT) iv = GPA_MAX_MODE_COUNT;
        var prev = doc.mode_counts[key] || 0;
        doc.mode_counts[key] = Math.max(prev, iv);
        entries++;
    }
    // Recompute favorite
    var maxN = 0, maxK = "";
    for (var m in doc.mode_counts) {
        if (Object.prototype.hasOwnProperty.call(doc.mode_counts, m)) {
            if (doc.mode_counts[m] > maxN) { maxN = doc.mode_counts[m]; maxK = m; }
        }
    }
    doc.fav_mode = maxK;
    doc.fav_mode_n = maxN;
    // Sum for lt_quiz_plays
    var total = 0;
    for (var q in doc.mode_counts) {
        if (Object.prototype.hasOwnProperty.call(doc.mode_counts, q)) {
            total += doc.mode_counts[q];
        }
    }
    doc.lt_quiz_plays = total;
    return doc;
}

// ─── PUBLIC: Upsert from event ────────────────────────────────────
// Called from persistNormalizedEvent in analytics.js

function gpaUpsertEvent(nk, logger, ev) {
    if (!ev || !ev.gameId || !ev.userId) return false;
    return gpaCasUpsert(nk, logger, ev.gameId, ev.userId, function (doc, isCreate) {
        var nowUtc = Math.floor(Date.now() / 1000);
        // First seen (immutable after first set)
        if (!doc.first_seen_utc || doc.first_seen_utc === 0) {
            doc.first_seen_utc = ev.unixTimestamp || nowUtc;
        }
        doc.last_active_utc = ev.unixTimestamp || nowUtc;
        doc.lt_events = (doc.lt_events || 0) + 1;
        // Device context from event data (update on every event to stay fresh)
        var ed = ev.eventData || {};
        if (ed.platform) doc.platform = ed.platform;
        if (ed.country) doc.country = ed.country;
        if (ed.locale) doc.locale = ed.locale;
        if (ed.device_tier) doc.device_tier = ed.device_tier;
        if (ed.device_model) doc.device_model = ed.device_model;
        if (ed.os_version) doc.os_version = ed.os_version;
        if (ed.app_version) doc.app_version = ed.app_version;
        if (ed.install_source) doc.install_source = ed.install_source;
        if (ed.consent_state) doc.consent = ed.consent_state;
        if (ed.att_status) doc.att_status = ed.att_status;
        // Quiz mode tracking
        if (ed.quiz_mode) {
            if (!doc.eng) doc.eng = {};
            doc.eng.last_mode = ed.quiz_mode;
        }
        // ── Play type counts (Solo / SyncMultiplayer / AsyncMultiplayer / LocalBattle / PartyTrivia / AIMode) ──
        if (ed.play_category) {
            if (!doc.play_type_counts) doc.play_type_counts = {};
            var ptKey = ("" + ed.play_category).substring(0, 30);
            doc.play_type_counts[ptKey] = (doc.play_type_counts[ptKey] || 0) + 1;
            // Derive most-played play type
            var maxPT = "", maxPTN = 0;
            for (var ptk in doc.play_type_counts) {
                if (Object.prototype.hasOwnProperty.call(doc.play_type_counts, ptk) &&
                    doc.play_type_counts[ptk] > maxPTN) {
                    maxPTN = doc.play_type_counts[ptk]; maxPT = ptk;
                }
            }
            if (!doc.eng) doc.eng = {};
            doc.eng.fav_play_type = maxPT;
            doc.eng.fav_play_type_n = maxPTN;
        }
        // ── Per-quiz ID counts (which specific quiz was taken how many times) ──
        var evName = ev.eventName || "";
        if ((evName === "quiz_completed" || evName === "quiz_session_started" ||
             evName === "daily_quiz_completed" || evName === "compatibility_quiz_completed") && ed.quiz_id) {
            if (!doc.quiz_id_counts) doc.quiz_id_counts = {};
            var qid = ("" + ed.quiz_id).substring(0, 80);
            doc.quiz_id_counts[qid] = (doc.quiz_id_counts[qid] || 0) + 1;
            // Cap at 50 entries (keep top by count, evict lowest)
            var qKeys = Object.keys(doc.quiz_id_counts);
            if (qKeys.length > 50) {
                var minQK = qKeys[0], minQV = doc.quiz_id_counts[qKeys[0]] || 0;
                for (var qi = 1; qi < qKeys.length; qi++) {
                    if ((doc.quiz_id_counts[qKeys[qi]] || 0) < minQV) {
                        minQV = doc.quiz_id_counts[qKeys[qi]]; minQK = qKeys[qi];
                    }
                }
                delete doc.quiz_id_counts[minQK];
            }
            // Derive most-played quiz
            var maxQID = "", maxQN = 0;
            for (var qk in doc.quiz_id_counts) {
                if (Object.prototype.hasOwnProperty.call(doc.quiz_id_counts, qk) &&
                    doc.quiz_id_counts[qk] > maxQN) {
                    maxQN = doc.quiz_id_counts[qk]; maxQID = qk;
                }
            }
            if (!doc.eng) doc.eng = {};
            doc.eng.fav_quiz_id = maxQID;
            doc.eng.fav_quiz_id_n = maxQN;
        }
        // ── Identity: populate from session_start (no extra server read) ──
        if (evName === "session_start") {
            if (ed.display_name) doc.display_name = ("" + ed.display_name).substring(0, 100);
            if (ed.avatar_url) doc.avatar_url = ("" + ed.avatar_url).substring(0, 500);
        }
        // ── Monetization: ad events ──────────────────────────────────
        if (!doc.money) doc.money = {};
        if (evName === "ad_shown" || evName === "ad_impression") {
            doc.money.ad_views = (doc.money.ad_views || 0) + 1;
        }
        if (evName === "ad_clicked") {
            doc.money.ad_clicks = (doc.money.ad_clicks || 0) + 1;
        }
        if (evName === "ad_reward_granted" || evName === "ad_completed") {
            doc.money.rewarded_ads = (doc.money.rewarded_ads || 0) + 1;
        }
        // ── Monetization: Paywall + IAP funnel (Phase 5) ─────────────
        // These counters drive the pre-IAP nudge Satori segment. Tracked
        // per-user in GPA so the nightly sweep can match without doing
        // an event scan.
        if (evName === "paywall_shown") {
            doc.money.paywall_shown_count = (doc.money.paywall_shown_count || 0) + 1;
            doc.money.paywall_last_utc = ev.unixTimestamp || nowUtc;
        }
        if (evName === "paywall_dismissed") {
            doc.money.paywall_dismissed_count = (doc.money.paywall_dismissed_count || 0) + 1;
        }
        if (evName === "purchase_started" || evName === "iap_started") {
            doc.money.iap_started_count = (doc.money.iap_started_count || 0) + 1;
        }
        if (evName === "purchase_failed" || evName === "iap_failed") {
            doc.money.iap_failed_count = (doc.money.iap_failed_count || 0) + 1;
        }
        // ── Monetization: IAP events ─────────────────────────────────
        if (evName === "iap_completed" || evName === "purchase_completed") {
            doc.money.iap_count = (doc.money.iap_count || 0) + 1;
            doc.money.last_iap_utc = ev.unixTimestamp || nowUtc;
            var priceVal = parseFloat(ed.price || ed.revenue_usd || 0);
            if (priceVal > 0 && priceVal < 100000) {
                doc.money.spend_usd = (doc.money.spend_usd || 0) + priceVal;
            }
            // Tier upgrade based on total spend
            var spend = doc.money.spend_usd || 0;
            if (spend >= 100) doc.money.reward_tier = "gold";
            else if (spend >= 25) doc.money.reward_tier = "silver";
            else doc.money.reward_tier = "bronze";
        }
        // ── Coin economy ─────────────────────────────────────────────
        if (ed.coins_earned) {
            var ce = parseInt(ed.coins_earned, 10) || 0;
            if (ce > 0) doc.money.coins_earned = (doc.money.coins_earned || 0) + ce;
        }
        if (ed.coins_spent) {
            var cs = parseInt(ed.coins_spent, 10) || 0;
            if (cs > 0) doc.money.coins_spent = (doc.money.coins_spent || 0) + cs;
        }
        // ── Crash fingerprinting ─────────────────────────────────────
        if (evName === "app_exception" || evName === "crash" || evName === "crash_report") {
            if (!Array.isArray(doc.crashes)) doc.crashes = [];
            var crashMsg = ("" + (ed.message || ed.error || ed.reason || "unknown")).substring(0, 200);
            // Fingerprint by first 80 chars
            var fingerprint = crashMsg.substring(0, 80);
            var found = false;
            for (var ci = 0; ci < doc.crashes.length; ci++) {
                if (doc.crashes[ci].fp === fingerprint) {
                    doc.crashes[ci].n = (doc.crashes[ci].n || 1) + 1;
                    doc.crashes[ci].last = ev.unixTimestamp || nowUtc;
                    found = true;
                    break;
                }
            }
            if (!found) {
                doc.crashes.push({
                    fp: fingerprint,
                    msg: crashMsg,
                    n: 1,
                    first: ev.unixTimestamp || nowUtc,
                    last: ev.unixTimestamp || nowUtc
                });
                // Keep top N by count
                while (doc.crashes.length > GPA_MAX_CRASHES) {
                    // Remove the entry with lowest count
                    var minIdx = 0, minN = doc.crashes[0].n || 0;
                    for (var cj = 1; cj < doc.crashes.length; cj++) {
                        if ((doc.crashes[cj].n || 0) < minN) { minN = doc.crashes[cj].n; minIdx = cj; }
                    }
                    doc.crashes.splice(minIdx, 1);
                }
            }
        }
        // ── Quiz accuracy: update on quiz_completed / daily_quiz_completed ──
        if (evName === "quiz_completed" || evName === "daily_quiz_completed" ||
            evName === "compatibility_quiz_completed") {
            if (!doc.eng) doc.eng = {};
            var correct = parseInt(ed.correct_count, 10) || 0;
            var total = parseInt(ed.total_questions, 10) || 0;
            if (total > 0 && total <= 1000 && correct >= 0 && correct <= total) {
                doc.eng.total_correct = (doc.eng.total_correct || 0) + correct;
                doc.eng.total_answered = (doc.eng.total_answered || 0) + total;
                doc.eng.avg_accuracy = doc.eng.total_answered > 0
                    ? Math.round((doc.eng.total_correct / doc.eng.total_answered) * 100)
                    : 0;
            }
            if (ed.score !== undefined) {
                doc.eng.last_score = parseInt(ed.score, 10) || 0;
            }
        }
        // Append to rolling buffer
        var compressedEvent = {
            n: ev.eventName,
            t: ev.unixTimestamp || nowUtc
        };
        // Only store non-empty event data
        if (ed && Object.keys(ed).length > 0) {
            // Strip heavy fields that are already in the doc root
            var slim = {};
            var skipFields = { platform: 1, country: 1, locale: 1, device_tier: 1,
                device_model: 1, os_version: 1, app_version: 1, install_source: 1,
                consent_state: 1, att_status: 1, session_id: 1, session_number: 1,
                display_name: 1, avatar_url: 1, schema_version: 1,
                play_category: 1, quiz_mode: 1, quiz_session_id: 1, quiz_mode_name: 1 };
            for (var dk in ed) {
                if (Object.prototype.hasOwnProperty.call(ed, dk) && !skipFields[dk]) {
                    slim[dk] = ed[dk];
                }
            }
            if (Object.keys(slim).length > 0) {
                compressedEvent.d = slim;
            }
        }
        gpaAppendEvent(doc, compressedEvent);
        gpaUpdateRetention(doc);
        return doc;
    });
}

// ─── PUBLIC: Upsert from session ──────────────────────────────────
// Called from trackSession in analytics.js. Returns { staleDuration, endedDuration }
// so the caller can still feed aggregateSessionStats.

function gpaUpsertSession(nk, logger, userId, gameId, eventName, eventData) {
    var result = { staleDuration: 0, endedDuration: 0 };
    gpaCasUpsert(nk, logger, gameId, userId, function (doc) {
        var nowUtc = Math.floor(Date.now() / 1000);
        if (eventName === "session_start") {
            // Close any dangling active session
            for (var i = 0; i < doc.sessions.length; i++) {
                if (doc.sessions[i].active) {
                    var dur = nowUtc - (doc.sessions[i].start || nowUtc);
                    if (dur > 0 && dur < 86400) {
                        doc.sessions[i].active = false;
                        doc.sessions[i].end = nowUtc;
                        doc.sessions[i].dur = dur;
                        result.staleDuration = dur;
                    } else {
                        doc.sessions[i].active = false;
                    }
                }
            }
            // Add new session
            doc.sessions.push({
                sid: (eventData && eventData.session_id) || ("s_" + nowUtc),
                start: nowUtc,
                end: 0,
                dur: 0,
                evts: 0,
                active: true
            });
            doc.lt_sessions = (doc.lt_sessions || 0) + 1;
            // Trim to max
            while (doc.sessions.length > GPA_MAX_SESSIONS) {
                doc.sessions.shift();
            }
            gpaUpdateRetention(doc);
        } else if (eventName === "session_end") {
            // Find and close the active session
            for (var j = doc.sessions.length - 1; j >= 0; j--) {
                if (doc.sessions[j].active) {
                    doc.sessions[j].end = nowUtc;
                    doc.sessions[j].dur = nowUtc - doc.sessions[j].start;
                    doc.sessions[j].active = false;
                    result.endedDuration = doc.sessions[j].dur;
                    break;
                }
            }
        }
        doc.last_active_utc = nowUtc;
        return doc;
    });
    return result;
}

// ─── PUBLIC: Upsert from rollup ───────────────────────────────────
// Called from rpcAnalyticsRecordUserRollup in analytics_player_profile.js

function gpaUpsertRollup(nk, logger, userId, gameId, rollupData) {
    if (!userId || !gameId) return false;
    return gpaCasUpsert(nk, logger, gameId, userId, function (doc) {
        // Idempotency check
        var idemKey = rollupData.idempotencyKey || "";
        if (idemKey && doc.idem_key === idemKey) {
            return null; // no-op
        }
        // Additive merge for lifetime counters
        var ed = parseInt(rollupData.eventsDelta, 10) || 0;
        var sd = parseInt(rollupData.sessionsDelta, 10) || 0;
        if (ed < 0) ed = 0;
        if (sd < 0) sd = 0;
        if (ed > 10000) ed = 10000;
        if (sd > 50) sd = 50;
        doc.lt_events = (doc.lt_events || 0) + ed;
        doc.lt_sessions = (doc.lt_sessions || 0) + sd;
        // Last event UTC
        var lastUtc = parseInt(rollupData.lastEventUtc, 10) || 0;
        var nowUtc = Math.floor(Date.now() / 1000);
        if (lastUtc > nowUtc + 300) lastUtc = nowUtc;
        if (lastUtc > (doc.last_active_utc || 0)) doc.last_active_utc = lastUtc;
        // Mode counts: monotonic max-merge
        if (rollupData.modeCounts) {
            gpaMergeModeCounts(doc, rollupData.modeCounts);
        }
        doc.idem_key = idemKey;
        gpaUpdateRetention(doc);
        return doc;
    });
}

// ─── PUBLIC: Read profile ─────────────────────────────────────────
// Single read for full player profile

function gpaReadProfile(nk, gameId, userId) {
    if (!gameId || !userId) return gpaSafeRead(null);
    var key = gameId + ":" + userId;
    try {
        var objs = nk.storageRead([{
            collection: GPA_COLLECTION, key: key, userId: userId
        }]);
        if (objs && objs.length > 0 && objs[0].value) {
            return gpaSafeRead(gpaUpgradeDoc(objs[0].value));
        }
    } catch (e) { /* not found */ }
    return gpaSafeRead(null);
}

// ─── PUBLIC: GDPR purge ───────────────────────────────────────────

function gpaPurgePlayer(nk, logger, userId) {
    if (!userId) return 0;
    var deleted = 0;
    try {
        var cursor = "";
        do {
            var list = nk.storageList(userId, GPA_COLLECTION, 100, cursor);
            if (!list || !list.objects || list.objects.length === 0) break;
            var deletes = [];
            for (var i = 0; i < list.objects.length; i++) {
                deletes.push({
                    collection: GPA_COLLECTION,
                    key: list.objects[i].key,
                    userId: userId
                });
            }
            nk.storageDelete(deletes);
            deleted += deletes.length;
            cursor = list.cursor || "";
        } while (cursor);
    } catch (e) {
        if (logger) logger.warn("[game_player_analytics] purge error: " + e.message);
    }
    return deleted;
}
