// analytics.js - Analytics System (Per gameId UUID)

var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
var FIRST_SEEN_COLLECTION = "analytics_user_first_seen";

/**
 * Slug → canonical UUID alias table.
 *
 * Older Unity clients (and some server-side adapters) emit gameId values as
 * human-readable slugs ("quizverse", "lasttolive", …). All downstream
 * dashboards / RPC filters key off the canonical game UUID, so we MUST
 * resolve the slug BEFORE the UUID-shape validation in normalizeInboundEvent
 * — otherwise the legacy events get rejected at ingestion and never appear
 * on the dashboard at all.
 *
 * Mirrors GAME_REWARD_CONFIGS in legacy_runtime.js + KNOWN_GAMES in
 * cross_game/cross_game.js. Keep these in sync when onboarding a new game.
 */
var GAME_ID_SLUG_ALIASES = {
    "quizverse": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "quiz-verse": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "QuizVerse": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "lasttolive": "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c",
    "last-to-live": "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c",
    "LastToLive": "8f3b1c2a-5d6e-4f7a-9b8c-1d2e3f4a5b6c"
};

function resolveGameIdAlias(gameId) {
    if (!gameId) return gameId;
    if (GAME_ID_SLUG_ALIASES[gameId]) return GAME_ID_SLUG_ALIASES[gameId];
    // Case-insensitive fallback for slugs (UUIDs are already lowercase-canonical).
    if (typeof gameId === "string" && !utils.isValidUUID(gameId)) {
        var lower = gameId.toLowerCase();
        if (GAME_ID_SLUG_ALIASES[lower]) return GAME_ID_SLUG_ALIASES[lower];
    }
    return gameId;
}

/**
 * Canonical event-name alias map. Clients emit various "-ed" suffix variants
 * (historical), but the rollup/funnel logic keys on a single canonical form.
 * Applied in normalizeInboundEvent so every downstream consumer sees the same
 * name. Mirrored in analytics_rollup.js for events that may have been written
 * before this alias map existed.
 */
var EVENT_ALIASES = {
    "quiz_started": "quiz_start",
    "quiz_completed": "quiz_complete",
    "quiz_session_completed": "quiz_complete",
    "quiz_abandon": "quiz_abandoned",
    "purchase_completed": "iap_purchased",
    "purchase_started": "iap_clicked",
    "iap_completed": "iap_purchased",
    "iap_started": "iap_clicked",
    "iap_purchase_completed": "iap_purchased",
    "iap_purchase_started": "iap_clicked",
    "login_succeeded": "login_success",
    "onboarding_completed": "onboarded",
    "onboarding_complete": "onboarded",
    "registration_completed": "registration_complete",
    "paywall_viewed": "paywall_shown",
    "paywall_view": "paywall_shown",
    // ── 2026-04 Unity analytics-hardening additions ──
    // Normalize legacy ad-failure event names emitted by older clients /
    // adapters so the rollup / monetization dashboards see a single canonical
    // "ad_load_failed" bucket. Mirror map exists in analytics_rollup.js.
    "ad_failed": "ad_load_failed",
    "purchase_failed": "iap_failed",
    // Ad-network adapters historically emit "ad_started" the moment the SDK
    // begins playback. From a billing/dashboard perspective that is the same
    // event as our canonical "ad_shown" impression — fold them together so
    // we never under-report impressions.
    "ad_started": "ad_shown"
};

/**
 * Accept a client-supplied unix timestamp only if it's within ±48h of server
 * clock. This lets the Unity offline-queue replay attribute events to the day
 * they actually happened, while rejecting clock-skew / malicious future dates.
 */
function resolveEventTimestamp(rawEvent) {
    var serverNow = utils.getUnixTimestamp();
    var candidate = null;
    if (rawEvent.unixTimestamp != null) candidate = parseInt(rawEvent.unixTimestamp, 10);
    else if (rawEvent.unix_timestamp != null) candidate = parseInt(rawEvent.unix_timestamp, 10);
    else if (rawEvent.client_unix_ts != null) candidate = parseInt(rawEvent.client_unix_ts, 10);
    else if (typeof rawEvent.timestamp === "string" && rawEvent.timestamp) {
        var parsedMs = Date.parse(rawEvent.timestamp);
        if (!isNaN(parsedMs)) candidate = Math.floor(parsedMs / 1000);
    } else if (typeof rawEvent.timestamp === "number" && isFinite(rawEvent.timestamp)) {
        // JSON numeric epoch seconds (e.g. Unity Newtonsoft serializing long timestamp).
        candidate = Math.floor(rawEvent.timestamp);
    }
    if (!candidate || !isFinite(candidate)) return serverNow;
    // Guard: reject absurd values (before 2020 or > 48h in future).
    if (candidate < 1577836800) return serverNow;
    if (candidate > serverNow + 172800) return serverNow;
    return candidate;
}

// ─── Phase 8: event name safety guard ────────────────────────────────────────
//
// Validates the raw eventName BEFORE alias expansion so malformed input
// never reaches the rest of the normalization pipeline.
// Returns { ok: true } or { ok: false, reason: string }.
//
// Rules:
//   1. Must be a non-empty string.
//   2. Length 1–128 chars (protects storage keys + Satori taxonomy).
//   3. Only alphanumeric, underscore, hyphen (no spaces, slashes, brackets,
//      injection patterns). This is the canonical event-name alphabet already
//      used by all our typed wrappers — rejecting others catches client bugs
//      early rather than silently persisting junk into analytics_events.
//   4. Must not look like a script-injection or SQL fragment.
//
// Phase 8 also supports ANALYTICS_STRICT_EVENTS=true, which additionally
// rejects any event not registered in the tracking plan. Default: false.
var AN_EVENT_NAME_RE = /^[a-zA-Z0-9_\-]{1,128}$/;
var AN_INJECTION_RE  = /[<>;"'`]|--|\/\*|\*\/|<script/i;

function eventNameSafety(ctx, name) {
    if (!name || typeof name !== "string") {
        return { ok: false, reason: "eventName must be a non-empty string" };
    }
    if (!AN_EVENT_NAME_RE.test(name)) {
        return { ok: false, reason: "eventName '" + name.slice(0, 64) +
            "' contains invalid characters (allowed: a-z A-Z 0-9 _ -)" };
    }
    if (AN_INJECTION_RE.test(name)) {
        return { ok: false, reason: "eventName rejected: injection pattern detected" };
    }
    return { ok: true };
}

// ─── 2026-05 Pipeline observability: failed-event ring buffer ─────────────────
//
// When normalizeInboundEvent or persistNormalizedEvent rejects an event, the
// reason is returned to the caller in the RPC response — but operators have no
// way to drill into rejected events historically (which event names, which
// reasons, which clients). To plug that gap without bloating storage we record
// each rejected event into a small per-day capped collection. The dashboard
// reads this via analytics_failed_events_recent (registered in
// analytics_hardening.js) and surfaces it in the Pipeline tab.
//
// Storage shape:
//   collection: "analytics_failed_events"
//   key:        "fail_{YYYY-MM-DD}_{unix}_{rand}"
//   userId:     SYSTEM_USER
//   value:      { reason, event_name?, game_id?, user_id, raw_event_keys[],
//                 client_event_id?, schema_version?, platform?,
//                 occurred_at_iso, occurred_at_unix }
//
// Failures here NEVER bubble — capturing failures must not itself cause
// ingestion to fail. We hard-cap raw_event_keys to 32 names so a malicious
// client can't blow up the ring buffer.
var AN_FAILED_COLLECTION = "analytics_failed_events";

function recordFailedEvent(nk, logger, ctx, rawEvent, reason) {
    try {
        var nowSec = utils.getUnixTimestamp();
        var dateStr = new Date(nowSec * 1000).toISOString().slice(0, 10);
        var rand = Math.random().toString(36).slice(2, 8);
        var key = "fail_" + dateStr + "_" + nowSec + "_" + rand;
        var keys = [];
        if (rawEvent && typeof rawEvent === "object") {
            var i = 0;
            for (var k in rawEvent) {
                if (Object.prototype.hasOwnProperty.call(rawEvent, k)) {
                    keys.push(k);
                    if (++i >= 32) break;
                }
            }
        }
        var value = {
            reason:           String(reason || "unknown").slice(0, 256),
            event_name:       (rawEvent && (rawEvent.eventName || rawEvent.event_name || rawEvent.event)) || null,
            game_id:          (rawEvent && (rawEvent.gameId || rawEvent.game_id || rawEvent.gameID)) || null,
            user_id:          (ctx && ctx.userId) || null,
            client_event_id:  (rawEvent && rawEvent.client_event_id) || null,
            schema_version:   (rawEvent && rawEvent.schema_version) || null,
            platform:         (rawEvent && rawEvent.platform) || null,
            raw_event_keys:   keys,
            occurred_at_iso:  new Date(nowSec * 1000).toISOString(),
            occurred_at_unix: nowSec
        };
        nk.storageWrite([{
            collection: AN_FAILED_COLLECTION,
            key: key,
            userId: SYSTEM_USER,
            value: value,
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (e) {
        if (logger && logger.info) {
            logger.info("[analytics] recordFailedEvent skipped: " + (e.message || e));
        }
    }
}

// ─── Phase 8: PII field list for Satori scrubbing ─────────────────────────────
//
// Fields that must be stripped from the Satori metadata bag for tier-2 events
// (privacy_tier === 2). These are stored raw in analytics_events (Nakama) but
// must NEVER be forwarded to Satori or any other 3rd-party sink.
var AN_PII_FIELDS = {
    "display_name": true, "username": true,    "user_name": true,
    "email": true,        "phone": true,        "full_name": true,
    "first_name": true,   "last_name": true,
    "error_message": true,"crash_log": true,    "stack_trace": true,
    "log_message": true,  "raw_message": true,  "message": true,
    "ip_address": true,   "device_id": true,    "advertising_id": true,
    "idfa": true,         "idfv": true,          "gaid": true
};

/**
 * Normalize a single inbound event into the canonical server-side record.
 * Handles legacy casings (gameID, eventData=properties, etc.) so the dashboard
 * sees one consistent shape regardless of client version.
 */
function normalizeInboundEvent(ctx, rawEvent, nk, logger) {
    if (!rawEvent || typeof rawEvent !== 'object') return null;

    var gameId = rawEvent.gameId || rawEvent.game_id || rawEvent.gameID || null;
    if (!gameId) return { __invalid: "Invalid or missing gameId UUID" };
    // Resolve human-readable slugs ("quizverse", "lasttolive", …) to their canonical UUID
    // BEFORE validation. Legacy clients still emit slugs and would otherwise be rejected.
    gameId = resolveGameIdAlias(gameId);
    if (!utils.isValidUUID(gameId)) return { __invalid: "Invalid or missing gameId UUID" };

    var eventName = rawEvent.eventName || rawEvent.event_name || rawEvent.event || null;
    if (!eventName) return { __invalid: "Missing eventName" };

    // Phase 8 — safety guard: reject malformed / injection event names early.
    var nameCheck = eventNameSafety(ctx, eventName);
    if (!nameCheck.ok) return { __invalid: nameCheck.reason };

    var originalEventName = eventName;
    if (EVENT_ALIASES[eventName]) eventName = EVENT_ALIASES[eventName];

    var eventData = rawEvent.eventData || rawEvent.event_data || rawEvent.properties || rawEvent.data || {};
    if (typeof eventData !== 'object' || eventData === null) eventData = {};

    // Inject dimensional fields from top-level if client didn't put them in eventData.
    // These power the audience / platform / retention slices on the dashboard, so we
    // need them on EVERY event regardless of which schema the client is using.
    if (!eventData.platform && rawEvent.platform) eventData.platform = rawEvent.platform;
    if (!eventData.app_version && rawEvent.app_version) eventData.app_version = rawEvent.app_version;
    if (!eventData.device_model && rawEvent.device_model) eventData.device_model = rawEvent.device_model;
    if (!eventData.device_tier && rawEvent.device_tier) eventData.device_tier = rawEvent.device_tier;
    if (!eventData.country && rawEvent.country) eventData.country = rawEvent.country;
    if (!eventData.locale && rawEvent.locale) eventData.locale = rawEvent.locale;
    if (!eventData.os && rawEvent.os) eventData.os = rawEvent.os;
    if (!eventData.os_version && rawEvent.os_version) eventData.os_version = rawEvent.os_version;
    if (!eventData.unity_ver && rawEvent.unity_ver) eventData.unity_ver = rawEvent.unity_ver;
    if (!eventData.install_source && rawEvent.install_source) eventData.install_source = rawEvent.install_source;
    if (!eventData.consent_state && rawEvent.consent_state) eventData.consent_state = rawEvent.consent_state;
    if (!eventData.att_status && rawEvent.att_status) eventData.att_status = rawEvent.att_status;
    if (!eventData.session_id && rawEvent.session_id) eventData.session_id = rawEvent.session_id;
    if (!eventData.session_id && rawEvent.sessionId) eventData.session_id = rawEvent.sessionId;
    if (!eventData.session_number && rawEvent.session_number) eventData.session_number = rawEvent.session_number;
    if (!eventData.current_scene && rawEvent.current_scene) eventData.current_scene = rawEvent.current_scene;
    if (!eventData.quiz_mode && rawEvent.quiz_mode) eventData.quiz_mode = rawEvent.quiz_mode;
    // EventEnricher REQUIRED_FIELDS uses `screen`; Unity sends current_scene.
    if (!eventData.screen) {
        if (eventData.current_scene) eventData.screen = eventData.current_scene;
        else if (eventData.screen_name) eventData.screen = eventData.screen_name;
        else if (eventData.screen_id) eventData.screen = eventData.screen_id;
    }

    // ── Phase 2: additional dimensional fields (v2 schema) ──
    // quiz_session_id is a per-play-through UUID, distinct from the lobby session_id.
    if (!eventData.quiz_session_id && rawEvent.quiz_session_id) eventData.quiz_session_id = rawEvent.quiz_session_id;
    // screen_id: which screen originated the event (e.g. 'quiz_lobby', 'quiz_result').
    if (!eventData.screen_id && rawEvent.screen_id) eventData.screen_id = rawEvent.screen_id;
    // privacy_tier: 0=unclassified, 1=non_pii, 2=pii_risk.
    if (eventData.privacy_tier === undefined && rawEvent.privacy_tier !== undefined) {
        eventData.privacy_tier = rawEvent.privacy_tier;
    }

    // ── Phase 2: schema version detection ──
    var schemaVersion = parseInt(rawEvent.schema_version, 10) || 1;
    var clientEventId = rawEvent.client_event_id || null;
    var eventTime     = rawEvent.event_time     || null;

    // v2 warning-mode validation. tpValidateV2 is defined in analytics_tracking_plan.js
    // and concatenated at global scope by postbuild.js. Guard ensures graceful degradation
    // on environments where the module hasn't been bundled yet.
    var v2Warnings = [];
    if (schemaVersion === 2 && typeof tpValidateV2 === "function") {
        try {
            var v2Result = tpValidateV2(rawEvent, eventName, eventData);
            v2Warnings = v2Result.warnings || [];
        } catch (e) { /* never block ingestion on validation errors */ }
    }

    // Phase 8 — schema enforcement mode.
    // When ANALYTICS_ENFORCE_SCHEMA=true, v2 events missing required fields are
    // REJECTED rather than warned. Default is false (warning-only) so existing
    // clients that haven't upgraded to schema v2 are not suddenly broken.
    // Turn this on only after confirming Unity clients emit client_event_id + event_time.
    if (schemaVersion === 2 && v2Warnings.length > 0) {
        var enforceRaw = (ctx && ctx.env && ctx.env["ANALYTICS_ENFORCE_SCHEMA"]) || "";
        var enforce    = (enforceRaw === "true" || enforceRaw === "1");
        if (enforce) {
            // Only hard-reject for REQUIRED fields (client_event_id, event_time).
            // Recommended-field warnings are always soft even in enforcement mode.
            var hardFail = null;
            for (var wi = 0; wi < v2Warnings.length; wi++) {
                var wMsg = v2Warnings[wi];
                if (wMsg && (wMsg.indexOf("client_event_id") !== -1 ||
                             wMsg.indexOf("event_time") !== -1)) {
                    hardFail = wMsg;
                    break;
                }
            }
            if (hardFail) {
                return { __invalid: "[schema_v2_enforcement] " + hardFail };
            }
        }
    }

    // Auto-assign privacy tier from tracking plan when client didn't provide one.
    if (eventData.privacy_tier === undefined && typeof tpGetPrivacyTier === "function") {
        try { eventData.privacy_tier = tpGetPrivacyTier(eventName); } catch (e) { /* swallow */ }
    }

    // Server-authoritative user id.
    // Allow server-side callers (HTTP-key / cron) whose ctx.userId is empty —
    // those are internal system calls, not unauthenticated players. Nakama
    // enforces player auth at the session layer before any RPC reaches here,
    // so an empty userId here can only come from a trusted --http-key caller.
    var userId = ctx.userId || SYSTEM_USER;

    var unixTs = resolveEventTimestamp(rawEvent);

    // Phase 1A (qv-insights-loop): universal event enricher. Back-fills
    // any field still empty after the dimensional logic above by reading
    // the per-session context from `game_session_index`. Anything still
    // missing is recorded into `game_coverage_gap_log` so #qv-ops can
    // surface the worst offenders in the daily coverage health embed.
    // Defined in src/analytics/event-enricher.ts; concatenated at global
    // scope by postbuild.js so this typeof check succeeds in production.
    if (nk && typeof EventEnricher !== "undefined" && EventEnricher && typeof EventEnricher.enrich === "function") {
        try {
            var sid = eventData.session_id || null;
            var enrichResult = EventEnricher.enrich(nk, logger, eventName, eventData, sid, gameId);
            if (enrichResult && enrichResult.gaps && enrichResult.gaps.length > 0) {
                EventEnricher.recordCoverageGap(nk, logger, gameId, eventName, enrichResult.gaps);
            }
            // session_start = upsert the session-context row. The full set
            // of immutable session fields (app_version/os/country/tier) is
            // captured here so every later event can back-fill against it.
            if (eventName === "session_start" && sid) {
                EventEnricher.upsertSessionIndex(nk, logger, ctx, {
                    sessionId: sid,
                    gameId: gameId,
                    userId: ctx.userId,
                    appVersion: eventData.app_version,
                    sdkVersion: eventData.sdk_version,
                    os: eventData.os,
                    osVersion: eventData.os_version,
                    country: eventData.country,
                    locale: eventData.locale,
                    tier: eventData.device_tier,
                    deviceModel: eventData.device_model,
                    installSource: eventData.install_source,
                    consentState: eventData.consent_state,
                    attStatus: eventData.att_status,
                    cohortLabel: eventData.cohort_label,
                    cohortDefVersion: eventData.cohort_def_version,
                    cohortHoldout: eventData.cohort_holdout,
                });
            }
        } catch (enrichErr) {
            // never throw into the host RPC
        }
    }

    return {
        userId: userId,
        gameId: gameId,
        eventName: eventName,
        originalEventName: originalEventName,
        canonicalized: originalEventName !== eventName,
        eventData: eventData,
        platform: eventData.platform || null,
        sessionId: eventData.session_id || null,
        timestamp: new Date(unixTs * 1000).toISOString(),
        unixTimestamp: unixTs,
        // ── Phase 2: schema v2 fields ──
        schemaVersion:  schemaVersion,
        clientEventId:  clientEventId,
        eventTime:      eventTime,
        quizSessionId:  eventData.quiz_session_id || null,
        screenId:       eventData.screen_id       || null,
        privacyTier:    eventData.privacy_tier !== undefined ? eventData.privacy_tier : 1,
        v2Warnings:     v2Warnings
    };
}

/**
 * Atomic first-seen marker: creates analytics_user_first_seen/first_<uid>_<gid>
 * on first write, otherwise no-ops. Returns true when THIS call created the
 * doc (i.e. the user is new for this game on this day). Uses version:"*" for
 * create-only semantics — the race loser reads back the winner's doc.
 */
function trackFirstSeen(nk, logger, userId, gameId, unixTs) {
    if (!userId || !gameId) return false;
    var key = "first_" + userId + "_" + gameId;
    try {
        var existing = nk.storageRead([{ collection: FIRST_SEEN_COLLECTION, key: key, userId: SYSTEM_USER }]);
        if (existing && existing.length > 0 && existing[0].value) return false;
    } catch (e) { /* fall through to create */ }
    try {
        var dateStr = new Date((unixTs || utils.getUnixTimestamp()) * 1000).toISOString().slice(0, 10);
        nk.storageWrite([{
            collection: FIRST_SEEN_COLLECTION,
            key: key,
            userId: SYSTEM_USER,
            value: { userId: userId, gameId: gameId, firstSeenDate: dateStr, firstSeenUnix: unixTs || utils.getUnixTimestamp() },
            permissionRead: 2,
            permissionWrite: 0,
            version: "*"
        }]);
        return true;
    } catch (e) {
        // Lost race — another call created it first. Treat as not new.
        return false;
    }
}

/**
 * Increment the live event counter for today in analytics_live_daily.
 * Key: live_{gameId}_{YYYY-MM-DD}  (stored under SYSTEM_USER)
 * Shape: { total, by_name: {eventName: count}, last_event_at }
 *
 * Uses a read-modify-write with OCC (version check). Retries once on
 * version conflict. On failure it is silently swallowed — the nightly
 * rollup is the durable source; this is a fast-read overlay only.
 */
/**
 * OCC-safe upsert of a live_daily counter doc.
 * Shared by both the per-game key and the "all" aggregate key.
 */
// metrics: optional { revenue_usd, ad_revenue_usd, session_count, session_seconds,
//                     coins_earned, coins_spent } — accumulated into the live doc.
function _liveCountersUpsert(nk, col, key, en, platform, country, city, unixTs, metrics, audienceDims) {
    for (var attempt = 0; attempt < 2; attempt++) {
        var existing = null;
        var version  = null;
        try {
            var recs = nk.storageRead([{ collection: col, key: key, userId: SYSTEM_USER }]);
            if (recs && recs.length > 0) {
                existing = recs[0].value || {};
                version  = recs[0].version;
            }
        } catch (_) { /* treat as empty */ }

        var doc = existing || { total: 0, by_name: {}, by_platform: {}, by_country: {}, by_city: {}, last_event_at: 0 };
        doc.total = (doc.total || 0) + 1;
        if (!doc.by_name)     doc.by_name     = {};
        if (!doc.by_platform) doc.by_platform = {};
        if (!doc.by_country)  doc.by_country  = {};
        if (!doc.by_city)     doc.by_city     = {};

        doc.by_name[en] = (doc.by_name[en] || 0) + 1;
        if (platform) { doc.by_platform[platform] = (doc.by_platform[platform] || 0) + 1; }
        if (country)  { doc.by_country[country]   = (doc.by_country[country]   || 0) + 1; }
        if (city)     { doc.by_city[city]         = (doc.by_city[city]         || 0) + 1; }
        doc.last_event_at = Math.max(doc.last_event_at || 0, unixTs || 0);

        // Audience dimensions: device_tier, locale, app_version, install_source,
        // consent_state, att_status — written today so the Audience tab shows
        // live data before the nightly rollup runs.
        if (audienceDims) {
            var aDimKeys = ['device_tier', 'locale', 'app_version', 'install_source', 'consent_state', 'att_status'];
            for (var _ai = 0; _ai < aDimKeys.length; _ai++) {
                var _adk = aDimKeys[_ai];
                var _adv = audienceDims[_adk];
                if (!_adv) continue;
                var _byKey = 'by_' + _adk;
                if (!doc[_byKey]) doc[_byKey] = {};
                doc[_byKey][_adv] = (doc[_byKey][_adv] || 0) + 1;
            }
        }

        // ── Real-time KPI accumulators ──────────────────────────────────
        // Accumulated here so the dashboard never needs a rollup to show
        // today's revenue, session count, or economy figures.
        if (metrics) {
            if (metrics.revenue_usd)    doc.revenue_usd    = (doc.revenue_usd    || 0) + metrics.revenue_usd;
            if (metrics.ad_revenue_usd) doc.ad_revenue_usd = (doc.ad_revenue_usd || 0) + metrics.ad_revenue_usd;
            if (metrics.session_count)  doc.session_count  = (doc.session_count  || 0) + 1;
            if (metrics.session_seconds)doc.session_seconds= (doc.session_seconds|| 0) + metrics.session_seconds;
            if (metrics.coins_earned)   doc.coins_earned   = (doc.coins_earned   || 0) + metrics.coins_earned;
            if (metrics.coins_spent)    doc.coins_spent    = (doc.coins_spent    || 0) + metrics.coins_spent;
        }

        var writeObj = {
            collection: col, key: key, userId: SYSTEM_USER,
            value: doc, permissionRead: 0, permissionWrite: 0
        };
        if (version) writeObj.version = version;

        try {
            nk.storageWrite([writeObj]);
            return;
        } catch (_w) {
            if (attempt === 0) continue;
            // Second OCC conflict: silently drop.
        }
    }
}

/** High-signal gameplay events that count toward in-app "active now" windows. */
var IN_APP_ACTIVE_TOUCH_EVENTS = {
    session_start: true,
    session_end: true,
    screen_view: true,
    quiz_complete: true,
    quiz_completed: true,
    game_started: true,
    game_completed: true,
    media_question_started: true,
    media_question_completed: true,
    store_purchase: true,
    iap_purchased: true
};

/**
 * True when an iap_purchased event must NOT contribute to revenue_usd.
 * Defense-in-depth: Unity should set is_sandbox; server also catches editor
 * installs, RC/n8n environment=sandbox, and Unity editor platform strings.
 */
function analyticsIsSandboxIap(ed, ev) {
    if (!ed) ed = {};
    if (ed.is_sandbox === true || ed.isSandbox === true) return true;
    if (ed.sandbox === true) return true;

    var env = String(ed.environment || ed.Environment || "").toLowerCase();
    if (env === "sandbox") return true;

    var installSrc = String(ed.install_source || ed.installSource || "").toLowerCase();
    if (installSrc === "editor" || installSrc.indexOf("editor") >= 0) return true;

    var plat = String((ed.platform || ed.Platform) || (ev && ev.platform) || "").toLowerCase();
    if (plat.indexOf("editor") >= 0) return true;
    if (plat === "windowseditor" || plat === "osxeditor" || plat === "linuxeditor" ||
        plat === "iphoneplayer" || plat === "androidemulator") return true;

    var store = String(ed.store || ed.Store || "").toLowerCase();
    if (store === "sandbox" || store === "fake" || store === "fakestore" || store === "test") return true;

    return false;
}

/**
 * USD revenue for dashboard rollups. Never treat local-currency price/amount as USD.
 *
 * REVENUE-AUTHORITY FIX (2026-07): RevenueCat's server-to-server webhook
 * (quizverse_rc_sync → recordRcRevenueLive, eventData.source ===
 * "revenuecat_webhook") is now the SOLE contributor to revenue_usd, across
 * every store (App Store / Play Store / Stripe) and every product type.
 *
 * Before this fix, the client ALSO sent its own iap_purchased/purchase_completed
 * event the moment a purchase finished. Once the RC webhook started reporting
 * revenue too, the same purchase was counted twice — client fires immediately,
 * RC's webhook fires moments later, both wrote separate revenue_usd increments.
 *
 * Client-fired iap_purchased events are still fully valid for everything else
 * (funnels, dropoff analysis, tracking-plan validation, "purchases made"
 * counts) — they just no longer contribute a dollar amount. Only the
 * webhook-tagged event carries revenue, and it already has its own
 * idempotency ledger (qv_rc_revenue_ledger) guarding against RC's own
 * webhook retries.
 */
function analyticsExtractIapRevenueUsd(ed, ev) {
    if (analyticsIsSandboxIap(ed, ev)) return 0;
    if (!ed || ed.source !== "revenuecat_webhook") return 0;
    var rev = parseFloat(ed.revenue_usd || ed.price_usd || ed.revenueUsd || ed.priceUsd || 0);
    if (isFinite(rev) && rev > 0) return rev;
    return 0;
}

function liveCountersUpdate(nk, ev) {
    var dateStr = new Date(ev.unixTimestamp * 1000).toISOString().slice(0, 10);
    var col = "analytics_live_daily";

    var en       = ev.eventName || "unknown";
    var ed       = ev.eventData || {};
    var platform = ((ed.platform || ed.Platform) || ev.platform || "").toLowerCase() || null;
    var country  = ((ed.country) || ev.country || "").toUpperCase().slice(0, 2) || null;
    var city     = ((ed.city) || ev.city || "") || null;

    // Audience dimensions passed through to live_daily so the Audience tab
    // shows today's breakdown before the nightly rollup runs.
    var audienceDims = {
        device_tier:    ed.device_tier    || null,
        locale:         ed.locale         || null,
        app_version:    ed.app_version    || null,
        install_source: ed.install_source || null,
        consent_state:  ed.consent_state  || null,
        att_status:     ed.att_status     || null
    };

    // ── Extract per-event KPI metrics ───────────────────────────────────
    // These accumulate into the live counter doc so the dashboard always
    // shows live revenue, session counts, and economy data with zero lag
    // and without requiring a nightly rollup.
    var metrics = null;
    if (en === "iap_purchased") {
        var rev = analyticsExtractIapRevenueUsd(ed, ev);
        if (rev > 0) metrics = { revenue_usd: rev };
    } else if (en === "ad_revenue") {
        var adRev = parseFloat(ed.revenue_usd || ed.revenueUSD || 0) || 0;
        if (adRev > 0) metrics = { ad_revenue_usd: adRev };
    } else if (en === "session_end") {
        var secs = parseFloat(ed.duration_seconds || 0) || 0;
        metrics = { session_count: 1, session_seconds: secs };
    } else if (en === "coins_earned") {
        var ce = parseInt(ed.coins_earned || ed.amount || 0, 10) || 0;
        if (ce > 0) metrics = { coins_earned: ce };
    } else if (en === "coins_spent") {
        var cs = parseInt(ed.coins_spent || ed.amount || 0, 10) || 0;
        if (cs > 0) metrics = { coins_spent: cs };
    }

    // Per-game doc — keyed by canonical UUID (slug was resolved in normalizeInboundEvent).
    _liveCountersUpsert(nk, col, "live_" + ev.gameId + "_" + dateStr, en, platform, country, city, ev.unixTimestamp, metrics, audienceDims);

    // "All games" aggregate doc — lets the dashboard "All Games" selector show
    // today's live data without waiting for the nightly rollup.
    _liveCountersUpsert(nk, col, "live_all_" + dateStr, en, platform, country, city, ev.unixTimestamp, metrics, audienceDims);

    // Rolling in-app active users (dashboard Status tab).
    try {
        if (ev.userId && typeof ActiveRolling !== "undefined" && ActiveRolling.touch) {
            var touchEvent = IN_APP_ACTIVE_TOUCH_EVENTS[en];
            if (touchEvent) {
                ActiveRolling.touch(nk, "in_app", ev.userId, ev.gameId, ev.unixTimestamp * 1000);
            }
        }
    } catch (_activeTouch) { /* non-fatal */ }
}

/**
 * Read today's live counter doc for a given gameId.
 * Returns the doc value or null. Never throws.
 */
function liveCountersRead(nk, gameId) {
    try {
        var dateStr = new Date().toISOString().slice(0, 10);
        var key = "live_" + (gameId || "all") + "_" + dateStr;
        var recs = nk.storageRead([{
            collection: "analytics_live_daily",
            key: key,
            userId: SYSTEM_USER
        }]);
        return (recs && recs.length > 0) ? (recs[0].value || null) : null;
    } catch (_) { return null; }
}

/**
 * Persist a single normalized event + fan-out to DAU + session aggregator.
 * Returns null on success, or a string error.
 */
function persistNormalizedEvent(nk, logger, ev) {
    // ── In-house dashboard fan-out (analytics_events / dash_* keys) ──
    // Runs FIRST so the dashboard always captures the event regardless of whether
    // the per-player GPA write below succeeds. The legacy dashboard rollup scanners
    // (analytics_rollup.js::arScanEventsForDate, admin_events_timeline,
    // admin_top_events) all query the `analytics_events` collection with a key
    // prefix of `dash_<gameId>_<YYYY-MM-DD>_*`. Without this write the dashboard
    // at /analytics.html shows zero events.
    var dashWriteErr = null;
    try {
        var dateStr = new Date(ev.unixTimestamp * 1000).toISOString().slice(0, 10);
        var rand = Math.random().toString(36).slice(2, 8);
        var dashKey = "dash_" + ev.gameId + "_" + dateStr + "_" + ev.eventName +
                      "_" + ev.unixTimestamp + "_" + rand;
        nk.storageWrite([{
            collection: "analytics_events",
            key: dashKey,
            userId: SYSTEM_USER,
            value: ev,
            permissionRead: 0,
            permissionWrite: 0
        }]);
    } catch (e) {
        dashWriteErr = (e.message || e);
        if (logger && logger.warn) {
            logger.warn("[analytics] dash_* fan-out failed (dashboard rollups will miss this event): " + dashWriteErr);
        }
    }

    // ── Live counters (real-time dashboard, no rollup needed for today) ──
    // Increments analytics_live_daily/live_{gameId}_{date} on every accepted
    // event so the dashboard can show today's data immediately without waiting
    // for the nightly analytics_rollup cron. The rollup still runs at midnight
    // for historical accuracy — this is an additive fast-read layer only.
    try {
        liveCountersUpdate(nk, ev);
    } catch (eLive) {
        // Non-fatal — dashboard falls back to rollup data if this fails.
    }

    // ── Unified player analytics store (game_player_analytics) ──
    // Runs after the dashboard write so a GPA failure never blocks dashboard data.
    // All per-player event data goes to a single doc keyed {gameId}:{userId}.
    var gpaFailed = false;
    try {
        gpaUpsertEvent(nk, logger, ev);
    } catch (e) {
        gpaFailed = true;
        if (logger && logger.warn) {
            logger.warn("[analytics] gpaUpsertEvent failed: " + (e.message || e));
        }
    }

    // ── Heroic Labs Satori cloud fan-out (direct HTTP, hardcoded creds) ──
    //
    // ALL events are forwarded to Satori — no allowlist filter.
    //   • Mapped events (in SD_EVENT_MAP) → sent as one batch with core
    //     Satori taxonomy names (guaranteed registered → no 400).
    //   • Unmapped events → sent individually so a 400 on one unknown
    //     name never kills the mapped batch.
    //   • Per-identity batch buffer — accumulates in process memory and
    //     flushes at 50 events OR 5 s idle.
    //   • Identity hybrid (Q6=C) — on session_start the full identity
    //     property bag is pushed to /v1/properties once per process per
    //     identity; per-event metadata is slimmed to essentials.
    //
    // Fan-out failures NEVER abort the main RPC — the in-house dash_*
    // write above is the durable source of truth.
    try {
        var sEv = {
            name: ev.eventName,
            timestamp: ev.unixTimestamp,
            metadata: {}
        };
        if (ev.gameId) sEv.metadata.game_id = String(ev.gameId);
        if (ev.platform) sEv.metadata.platform = String(ev.platform);
        if (ev.sessionId) sEv.metadata.session_id = String(ev.sessionId);
        if (ev.eventData && typeof ev.eventData === "object") {
            // Phase 8 — PII scrubbing: strip tier-2 fields before forwarding to Satori.
            // These fields are stored raw in analytics_events (Nakama) but must never
            // leave our infrastructure to 3rd-party sinks.
            var isTier2 = (ev.privacyTier === 2);
            for (var k in ev.eventData) {
                if (Object.prototype.hasOwnProperty.call(ev.eventData, k)) {
                    if (isTier2 && AN_PII_FIELDS[k]) continue; // scrubbed
                    var v = ev.eventData[k];
                    if (v === null || v === undefined) continue;
                    sEv.metadata[k] = (typeof v === "object") ? JSON.stringify(v) : String(v);
                }
            }
        }

        // Push full identity properties to Satori on session_start (once
        // per identity per process). Done BEFORE the event enqueue so
        // Satori has the identity bag when the event lands. Failure here
        // is silently absorbed by sdSendIdentityProperties.
        if (ev.eventName === "session_start" || ev.eventName === "first_open") {
            try {
                sdSendIdentityProperties(null, nk, logger, ev.userId, sEv.metadata);
            } catch (eIdent) {
                if (logger && logger.info) {
                    logger.info("[analytics] satori identity props skipped: " + (eIdent.message || eIdent));
                }
            }
        }

        sdEnqueueOrFlush(null, nk, logger, ev.userId, [sEv]);
    } catch (e) {
        if (logger && logger.info) {
            logger.info("[analytics] satori publish skipped: " + (e.message || e));
        }
    }

    // First-seen → daily active users. isNew only bumps newUsers on the day
    // where the creator "won" the atomic storageWrite above.
    var isNew = trackFirstSeen(nk, logger, ev.userId, ev.gameId, ev.unixTimestamp);
    trackDAU(nk, logger, ev.userId, ev.gameId, isNew);

    // Session lifecycle — writes to game_player_analytics.sessions[]
    // and still feeds system-level aggregateSessionStats.
    if (ev.eventName === "session_start" || ev.eventName === "session_end") {
        trackSession(nk, logger, ev.userId, ev.gameId, ev.eventName, ev.eventData);
    }

    // Platform breakdown key (cheap counter keyed per day+platform+gameId).
    if (ev.platform) {
        trackPlatform(nk, logger, ev.gameId, ev.platform, ev.userId);
    }

    // Heatmap pre-aggregation — runs for all click/tap/screen/view/popup/modal
    // events so rpcAnalyticsHomeHeatmap can do O(1) point-reads.
    var evNameLow = (ev.eventName || '').toLowerCase();
    if (evNameLow.indexOf('click') !== -1 || evNameLow.indexOf('tap') !== -1 ||
        evNameLow.indexOf('screen') !== -1 || evNameLow.indexOf('view') !== -1 ||
        evNameLow.indexOf('popup') !== -1 || evNameLow.indexOf('modal') !== -1) {
        try {
            trackHeatmap(nk, logger, ev.gameId, ev.eventName, ev.eventData || {});
        } catch (eHm) {
            if (logger && logger.warn) {
                logger.warn("[analytics] trackHeatmap failed (event still recorded): " + (eHm.message || eHm));
            }
        }
    }

    // Only surface an error when the dashboard write itself failed — that is the
    // primary signal for operators (no data in analytics_events = nothing on the dashboard).
    // Fix #6: GPA-only failures (dashboard write succeeded) are demoted to a warning.
    // Previously returning an error here caused the event to be counted as "rejected"
    // even though it was fully queryable in analytics_events and on the dashboard.
    if (dashWriteErr) return "Failed to write dashboard event: " + dashWriteErr;
    if (gpaFailed && logger && logger.warn) {
        logger.warn("[analytics] GPA write failed for " + ev.eventName +
            " (dashboard write succeeded — event is queryable)");
    }
    return null;
}

/**
 * RPC: Log analytics event(s). Accepts a SINGLE event payload OR a BATCH.
 *   Single: { gameId, eventName, eventData }
 *   Batch : { events: [ { gameId, eventName, eventData }, ... ] }
 *
 * Returns: { success, accepted, rejected, errors?: [...] }
 */
function rpcAnalyticsLogEvent(ctx, logger, nk, payload) {
    utils.logInfo(logger, "RPC analytics_log_event called");

    var parsed = utils.safeJsonParse(payload);
    if (!parsed.success) {
        return utils.handleError(ctx, null, "Invalid JSON payload");
    }

    var data = parsed.data || {};

    // Accept batch or single.
    var inbound = [];
    if (Array.isArray(data.events) && data.events.length > 0) {
        if (data.events.length > 500) {
            return utils.handleError(ctx, null, "Batch too large: max 500 events per call");
        }
        inbound = data.events;
    } else {
        inbound = [data];
    }

    var accepted = 0;
    var rejected = 0;
    var aliasNormalized = 0;
    var v2EventsCount   = 0;
    var v2WarningsCount = 0;
    var errors = [];
    var acceptedEventNames = [];
    var resolvedGameId = null;

    for (var i = 0; i < inbound.length; i++) {
        var normalized = normalizeInboundEvent(ctx, inbound[i], nk, logger);
        if (!normalized || normalized.__invalid) {
            rejected++;
            var rejReason = (normalized && normalized.__invalid) || "Invalid event";
            errors.push({ index: i, event_name: (inbound[i] && inbound[i].eventName) || null, reason: rejReason });
            // Persist to ring buffer so the dashboard's Pipeline tab can show it.
            recordFailedEvent(nk, logger, ctx, inbound[i], rejReason);
            continue;
        }
        var err = persistNormalizedEvent(nk, logger, normalized);
        if (err) {
            rejected++;
            errors.push({ index: i, event_name: (inbound[i] && inbound[i].eventName) || null, reason: err });
            recordFailedEvent(nk, logger, ctx, inbound[i], err);
        } else {
            if (normalized.canonicalized) aliasNormalized++;
            if (normalized.schemaVersion === 2) {
                v2EventsCount++;
                v2WarningsCount += (normalized.v2Warnings && normalized.v2Warnings.length) || 0;
            }
            accepted++;
            acceptedEventNames.push(normalized.eventName || (inbound[i] && inbound[i].eventName) || "unknown");
            // Capture the resolved (canonical UUID) gameId from the first accepted event
            if (!resolvedGameId && normalized.gameId) resolvedGameId = normalized.gameId;
        }
    }

    utils.logInfo(logger, "analytics_log_event accepted=" + accepted + " rejected=" + rejected);

    // Best-effort counter tick (for analytics_metrics RPC). Ignored on failure
    // so it never blocks event ingestion.
    try {
        // Fix #7: include satori_module_available so operators can see whether
        // the Satori direct module is loaded (and fan-out is actually happening).
        bumpMetricsCounter(nk, {
            accepted:                accepted,
            rejected:                rejected,
            alias_normalized:        aliasNormalized,
            schema_v2_events:        v2EventsCount,
            schema_v2_warnings:      v2WarningsCount,
            satori_module_available: (typeof sdEnqueueOrFlush === "function") ? 1 : 0
        });
    } catch (e) { /* swallow */ }

    // Auto-drain piggyback (2026-05-10): every ingest call runs ONE debounced
    // tick of the historical-backfill state machine. The 5-sec debounce
    // inside abAutoRunIfNeeded makes this a no-op for most calls and a
    // ~500ms-1s page of work for the rest. Wrapped so a backfill failure
    // never poisons live event ingestion.
    try {
        if (typeof abAutoRunIfNeeded === "function") {
            abAutoRunIfNeeded(ctx, nk, logger);
        }
    } catch (e) { /* swallow */ }

    // Satori identity sync (Phase 8) is NO LONGER piggybacked here.
    //
    // Why removed (2026-06-14): the 1-h debounce gate (siPiggybackNextAllowedSec)
    // was a *module-level* variable. Goja's VM pool hands each RPC call a fresh
    // module-scope snapshot, so that gate reset to 0 on essentially every call
    // and never engaged. As a result rpcSatoriIdentityBatch — which does up to
    // 50 users × (Satori auth + identity-properties HTTP round-trips) — ran on
    // a large fraction of analytics_log_event calls, blocking the synchronous
    // response for multiple seconds and tripping the client's 12 s timeout.
    //
    // Identity sync now runs strictly out-of-band via the DASHBOARD_SECRET /
    // admin-guarded `satori_identity_auto_kick` RPC (mirrors analytics_auto_kick),
    // driven by the external scheduler. Trait freshness is preserved without
    // putting unbounded external HTTP on the user-facing ingest path.

    var resp = {
        success:          accepted > 0 || rejected === 0,
        accepted:         accepted,
        rejected:         rejected,
        batch_size:       inbound.length,
        game_id:          resolvedGameId,
        server_ts:        Math.floor(Date.now() / 1000),
        alias_normalized: aliasNormalized,
        schema_v2_events: v2EventsCount,
        event_names:      acceptedEventNames
    };
    if (v2WarningsCount > 0) resp.v2_warnings_total = v2WarningsCount;
    if (errors.length > 0)   resp.errors = errors.slice(0, 20);
    return JSON.stringify(resp);
}

/**
 * Optimistic-concurrency helper for read-modify-write counters.
 *
 * Race fix: prior versions did a naïve read → mutate → write. Under burst
 * load (e.g. simultaneous iap_purchased and ad_impression for the same
 * gameId/platform/day), two concurrent writers would both read the same
 * stale doc, increment their copies, and the later writer would clobber
 * the earlier one — losing increments silently.
 *
 * We now pass the record's `version` back to storageWrite; Nakama rejects
 * the write with OCC failure if the doc changed underneath us, and we
 * retry up to `maxRetries` times. On create we use version:"*" so only
 * one of the racing creators wins; losers retry as updaters.
 */
function casUpdate(nk, logger, collection, key, owner, mutate) {
    var maxRetries = 5;
    for (var attempt = 0; attempt < maxRetries; attempt++) {
        var existing = null;
        var version = null;
        try {
            var objs = nk.storageRead([{ collection: collection, key: key, userId: owner }]);
            if (objs && objs.length > 0) {
                existing = objs[0].value || null;
                version = objs[0].version || null;
            }
        } catch (e) { /* treat as not-exists */ }

        var isCreate = !existing;
        var next = mutate(existing ? JSON.parse(JSON.stringify(existing)) : null);
        if (!next) return true; // mutator returned nothing → no write needed

        try {
            nk.storageWrite([{
                collection: collection,
                key: key,
                userId: owner,
                value: next,
                permissionRead: 2,
                permissionWrite: 0,
                version: isCreate ? "*" : version
            }]);
            return true;
        } catch (e) {
            // Race lost — loop and re-read. If we keep losing after maxRetries,
            // fall through to logging but don't throw: losing an occasional
            // counter tick under extreme contention is better than failing
            // the whole event-ingest path.
            if (attempt === maxRetries - 1 && logger && logger.warn) {
                logger.warn("[Analytics] CAS update lost after " + maxRetries + " tries: " +
                            collection + "/" + key + " (" + e.message + ")");
            }
        }
    }
    return false;
}

/**
 * Lightweight ops counter, bucketed by UTC day.
 * Collection: analytics_metrics_counters
 * Key:        counter_<YYYY-MM-DD>
 * Prometheus-style reset on day boundary. Used by analytics_metrics RPC.
 */
function bumpMetricsCounter(nk, delta) {
    var today = new Date().toISOString().slice(0, 10);
    var key = "counter_" + today;
    casUpdate(nk, null, "analytics_metrics_counters", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { date: today, events_accepted: 0, events_rejected: 0, log_calls: 0, updated_at: null };
        rec.events_accepted += (delta.accepted || 0);
        rec.events_rejected += (delta.rejected || 0);
        rec.alias_normalized = (rec.alias_normalized || 0) + (delta.alias_normalized || 0);
        rec.satori_publish_success = (rec.satori_publish_success || 0) + (delta.satori_publish_success || 0);
        rec.satori_publish_failure = (rec.satori_publish_failure || 0) + (delta.satori_publish_failure || 0);
        rec.satori_publish_filtered = (rec.satori_publish_filtered || 0) + (delta.satori_publish_filtered || 0);
        rec.satori_publish_dropped = (rec.satori_publish_dropped || 0) + (delta.satori_publish_dropped || 0);
        // Phase 2: schema v2 counters.
        rec.schema_v2_events   = (rec.schema_v2_events   || 0) + (delta.schema_v2_events   || 0);
        rec.schema_v2_warnings = (rec.schema_v2_warnings || 0) + (delta.schema_v2_warnings || 0);
        // Fix #7: track whether Satori direct module is loaded (0/1 flag written each call).
        if (delta.satori_module_available !== undefined) {
            rec.satori_module_available = delta.satori_module_available > 0;
        }
        if (delta.log_calls !== false) rec.log_calls += 1;
        rec.updated_at = new Date().toISOString();
        return rec;
    });
}

/**
 * Track per-platform daily counter (used by analytics_platform_breakdown).
 *
 * Key shape: platform_<gameId>_<YYYY-MM-DD>_<platform>. Was previously using
 * unix-seconds in the date slot, breaking dashboard reads (see trackDAU note).
 *
 * Also tracks unique_users using the same bounded-array approach as trackDAU
 * (capped at DAU_MAX_TRACKED_USERS) so the dashboard can show Users by Platform.
 */
function trackPlatform(nk, logger, gameId, platform, userId) {
    var today = new Date().toISOString().slice(0, 10);
    var key = "platform_" + gameId + "_" + today + "_" + platform;
    casUpdate(nk, logger, "analytics_platform", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { gameId: gameId, date: today, platform: platform, count: 0, unique_users: 0, uniqueUsers: [] };
        rec.count = (rec.count || 0) + 1;
        if (userId) {
            if (!Array.isArray(rec.uniqueUsers)) rec.uniqueUsers = [];
            if (rec.uniqueUsers.length < DAU_MAX_TRACKED_USERS) {
                if (rec.uniqueUsers.indexOf(userId) === -1) {
                    rec.uniqueUsers.push(userId);
                }
            }
            rec.unique_users = rec.uniqueUsers.length + (rec.overflow_users || 0);
            if (rec.uniqueUsers.length >= DAU_MAX_TRACKED_USERS && rec.uniqueUsers.indexOf(userId) === -1) {
                rec.overflow_users = (rec.overflow_users || 0) + 1;
                rec.unique_users = DAU_MAX_TRACKED_USERS + rec.overflow_users;
            }
        }
        return rec;
    });
}

/**
 * Pre-aggregate heatmap counters (button clicks, screen views, popup shown,
 * screen time) into a single daily doc per gameId so that
 * rpcAnalyticsHomeHeatmap can do N point-reads instead of a 50k-object scan.
 *
 * Collection : analytics_heatmap
 * Key shape  : heatmap_<gameId>_<YYYY-MM-DD>
 *
 * Doc shape:
 *   {
 *     gameId, date,
 *     buttons  : { [buttonName]: count },
 *     screens  : { [screenName]: { views, totalSec, samples } },
 *     popups   : { [popupName]:  count }
 *   }
 */
function trackHeatmap(nk, logger, gameId, eventName, eventData) {
    var today = new Date().toISOString().slice(0, 10);
    var key = "heatmap_" + gameId + "_" + today;
    var nameLow = (eventName || '').toLowerCase();
    var isClick = nameLow.indexOf('click') !== -1 || nameLow.indexOf('tap') !== -1;
    var isScreen = nameLow.indexOf('screen') !== -1 || nameLow.indexOf('view') !== -1;
    var isPopup = nameLow.indexOf('popup') !== -1 || nameLow.indexOf('modal') !== -1;

    casUpdate(nk, logger, "analytics_heatmap", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { gameId: gameId, date: today, buttons: {}, screens: {}, popups: {} };
        if (!rec.buttons) rec.buttons = {};
        if (!rec.screens) rec.screens = {};
        if (!rec.popups) rec.popups = {};

        var ed = eventData || {};

        if (isClick) {
            var btn = ed.button || ed.buttonName || eventName;
            rec.buttons[btn] = (rec.buttons[btn] || 0) + 1;
        }

        if (isScreen) {
            var scr = ed.screen || ed.screenName || eventName;
            if (!rec.screens[scr]) rec.screens[scr] = { views: 0, totalSec: 0, samples: 0 };
            rec.screens[scr].views++;
            var dur = ed.duration || ed.timeSpent || 0;
            if (dur) {
                rec.screens[scr].totalSec += dur;
                rec.screens[scr].samples++;
            }
        }

        if (isPopup) {
            var pop = ed.popup || ed.popupName || eventName;
            rec.popups[pop] = (rec.popups[pop] || 0) + 1;
        }

        return rec;
    });
}

/**
 * Track Daily Active User - writes both game-level and platform-level DAU keys.
 * Dashboard reads: dauData.uniqueUsers, dauData.count, dauData.newUsers
 *
 * isNewUser signals that trackFirstSeen just created the first-seen doc for
 * this (user,game) pair. We bump newUsers only once per user per day-per-key.
 */
// Fix #4: cap the uniqueUsers array to prevent document bloat at high DAU.
// Above DAU_MAX_TRACKED_USERS the array stays frozen; overflow_count tracks
// additional increments so `count` stays accurate (with minor overcount risk
// past the cap since dedup can no longer be applied).
//
// CRITICAL 2026-05-27: The previous implementation used utils.getStartOfDay()
// which returns a unix-seconds number (e.g. 1716768000), but EVERY downstream
// reader of analytics_dau expects ISO-date keys (e.g. dau_<gameId>_2026-05-27).
// That made the per-game + platform DAU permanently zero on the live branch
// of analytics_dashboard_summary — even though events were flowing. Also
// previously embedded `gameId` into the platform-wide key, but the reader
// looks for dau_platform_<date> (no gameId), so that aggregate was also
// invisible. Fixed both in this commit.
var DAU_MAX_TRACKED_USERS = 10000;

function trackDAU(nk, logger, userId, gameId, isNewUser) {
    var today = new Date().toISOString().slice(0, 10);
    var collection = "analytics_dau";

    var keys = [
        "dau_" + gameId + "_" + today,
        "dau_platform_" + today
    ];

    for (var k = 0; k < keys.length; k++) {
        (function (key) {
            casUpdate(nk, logger, collection, key, SYSTEM_USER, function (dauData) {
                if (!dauData) {
                    dauData = { date: today, uniqueUsers: [], count: 0, newUsers: 0 };
                }
                if (!Array.isArray(dauData.uniqueUsers)) {
                    dauData.uniqueUsers = Array.isArray(dauData.users) ? dauData.users : [];
                }
                // Fix #4: once the array hits the cap, fall back to an increment counter
                // (overflow_count) so the document never exceeds the storage size limit.
                if (dauData.uniqueUsers.length < DAU_MAX_TRACKED_USERS) {
                    if (dauData.uniqueUsers.indexOf(userId) !== -1) return null; // already recorded
                    dauData.uniqueUsers.push(userId);
                    dauData.count = dauData.uniqueUsers.length + (dauData.overflow_count || 0);
                } else {
                    // Array is frozen at cap — increment approximate count only.
                    dauData.overflow_count = (dauData.overflow_count || 0) + 1;
                    dauData.count = DAU_MAX_TRACKED_USERS + dauData.overflow_count;
                }
                if (isNewUser) dauData.newUsers = (dauData.newUsers || 0) + 1;
                return dauData;
            });
        })(keys[k]);
    }
}

/**
 * Track session data (start/end).
 *
 * Double-fire guard: if a session_start arrives while the previous session
 * is still "active" (client missed a session_end on kill/crash/background),
 * we synthesize an end for the dangling session before starting the new one.
 * Previously we silently overwrote the active-session doc and lost the
 * prior session's duration entirely.
 */
function trackSession(nk, logger, userId, gameId, eventName, eventData) {
    // ── Per-player session data → game_player_analytics.sessions[] ──
    // System-level aggregateSessionStats is still called for dashboard rollups.
    try {
        var sessionResult = gpaUpsertSession(nk, logger, userId, gameId, eventName, eventData);
        // Feed system-level session stats aggregator
        if (sessionResult.staleDuration > 0) {
            aggregateSessionStats(nk, logger, sessionResult.staleDuration, gameId);
        }
        if (sessionResult.endedDuration > 0) {
            aggregateSessionStats(nk, logger, sessionResult.endedDuration, gameId);
        }
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[analytics] gpaUpsertSession failed: " + (e.message || e));
        }
    }
}

/**
 * Aggregate session stats into a daily summary for the analytics dashboard.
 * Writes TWO keys so both "All games" and per-game dashboard views can resolve:
 *   - session_stats_{YYYY-MM-DD}                  (platform-wide)
 *   - session_stats_{gameId}_{YYYY-MM-DD}         (per-game)
 * Both stored under SYSTEM_USER so dashboard scans don't need to cross users.
 * Uses casUpdate to survive concurrent session_end bursts.
 */
function aggregateSessionStats(nk, logger, durationSeconds, gameId) {
    // ISO date — matches what every reader (analytics_dashboard,
    // analytics_dashboard_summary, analytics_session_stats) expects. Was
    // previously utils.getStartOfDay() returning unix-seconds, so dashboard
    // sessions card showed 0 even when sessions were flowing.
    var today = new Date().toISOString().slice(0, 10);
    var collection = "analytics_sessions";
    var keys = ["session_stats_" + today];
    if (gameId) keys.push("session_stats_" + gameId + "_" + today);
    for (var k = 0; k < keys.length; k++) {
        (function (key) {
            casUpdate(nk, logger, collection, key, SYSTEM_USER, function (stats) {
                if (!stats) {
                    stats = { date: today, gameId: gameId || null, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
                }
                var dur = parseFloat(durationSeconds) || 0;
                if (dur < 0) dur = 0;
                // Cap per-session contribution so a bad client timestamp cannot
                // poison dashboard avg (e.g. 3h+ from millis treated as seconds).
                if (dur > 14400) dur = 14400;
                stats.totalSessions++;
                stats.totalDuration += dur;
                stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;
                if (!stats.durations) stats.durations = [];
                if (stats.durations.length < 5000) stats.durations.push(dur);
                return stats;
            });
        })(keys[k]);
    }
}

/**
 * Read a pre-aggregated rollup doc (written by analytics_rollup_run).
 * Returns null if the rollup is missing for that date (caller should
 * fall back to live-compute).
 */
function readRollupDaily(nk, gameId, dateStr) {
    try {
        var key = "rollup_" + (gameId || "all") + "_" + dateStr;
        var r = nk.storageRead([{
            collection: "analytics_rollup_daily",
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function preferRollups(ctx) {
    if (!ctx || !ctx.env) return true;
    var v = ctx.env.DASHBOARD_PREFER_ROLLUPS;
    if (v === undefined || v === null || v === "" || v === "true" || v === "1") return true;
    return false;
}

/**
 * Read the platform-wide lifetime totals doc written by the rollup.
 * Returns { total_users_lifetime, last_rollup_date } or null.
 */
function readPlatformTotals(nk) {
    try {
        var r = nk.storageRead([{
            collection: "analytics_rollup_meta",
            key: "platform_totals",
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * Read cached external analytics (App Store / Play Console / UGS).
 * Returns the raw snapshot doc or null if not yet populated.
 */
function readExternalSnapshot(nk, key) {
    try {
        var r = nk.storageRead([{
            collection: "external_analytics",
            key: key,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        if (r && r.length > 0) return r[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

/**
 * Extract cumulative installs/downloads from an App Store Connect snapshot.
 * The snapshot may be structured as { metrics: { installs: { total, dates: [...] } } }
 * or a flat { total_installs, units } depending on which importer was used.
 */
function extractDownloadsFromSnapshot(snap) {
    if (!snap) return 0;
    // External pollers write: { raw: { ... } } or flat fields
    var raw = snap.raw || snap;
    // App Store Connect: units field = new downloads
    if (typeof raw.units === 'number') return raw.units;
    if (raw.metrics && raw.metrics.installs) {
        var inst = raw.metrics.installs;
        if (typeof inst.total === 'number') return inst.total;
        if (Array.isArray(inst)) {
            var t = 0;
            for (var i = 0; i < inst.length; i++) t += (inst[i].value || inst[i].count || 0);
            return t;
        }
    }
    if (typeof raw.total_installs === 'number') return raw.total_installs;
    if (typeof raw.installs === 'number') return raw.installs;
    if (typeof raw.downloads === 'number') return raw.downloads;
    return 0;
}

/**
 * RPC: analytics_dashboard
 * Returns DAU, WAU, MAU, retention ratios, trends for the dashboard.
 *
 * Phase-2 read path: for every day older than today we try to read a
 * pre-computed rollup from `analytics_rollup_daily` first. Only fall back
 * to the legacy DAU storageRead when the rollup is missing. Today is always
 * computed live (from analytics_dau counters) because the nightly rollup
 * hasn't run yet for today's date.
 *
 * Payload: {
 *   game_id?:   string,
 *   gameId?:    string,
 *   days?:      number,      // number of days back from today (default 30)
 *   from_date?: "YYYY-MM-DD", // custom range start (overrides days)
 *   to_date?:   "YYYY-MM-DD"  // custom range end   (default today)
 * }
 *
 * Custom date range: when from_date is supplied the RPC computes how many
 * days back from today cover the requested window. Results outside the
 * requested window are trimmed from dau_trend before returning.
 */
function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    // Wall-clock anchor for the request. The socket read/write timeouts are
    // 30s (config.yaml) and in prod the HTTP context is observed dead by
    // ~22s — any storage op after that fails with "context canceled". Used
    // by the self-healing auto-rollup guard below.
    var __adStartMs = Date.now();
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var gameId = resolveGameIdAlias(parsed.game_id || parsed.gameId || 'all');

    // ── Date range resolution ────────────────────────────────────────────
    // Supports three modes:
    //   1. days only  → scan last N days from today
    //   2. from_date  → scan from from_date to today (or to_date)
    //   3. from_date + to_date → scan the explicit window
    var rangeFromDate = null; // ISO "YYYY-MM-DD" lower bound (inclusive)
    var rangeToDate   = null; // ISO "YYYY-MM-DD" upper bound (inclusive)
    var days;

    var todayStr = new Date().toISOString().slice(0, 10);

    if (parsed.from_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.from_date)) {
        rangeFromDate = parsed.from_date;
        rangeToDate   = (parsed.to_date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.to_date))
            ? parsed.to_date : todayStr;
        // Inclusive day count inside the requested window (not always through today).
        var fromMs = new Date(rangeFromDate + 'T00:00:00Z').getTime();
        var toMs   = new Date(rangeToDate + 'T00:00:00Z').getTime();
        days = Math.max(1, Math.round((toMs - fromMs) / 86400000) + 1);
    } else {
        days = parseInt(parsed.days, 10) || 30;
    }

    // Scan back far enough to include the whole custom window (and at least
    // 30 days for default rolling WAU/MAU when no custom range is set).
    var scanDays = rangeFromDate
        ? Math.max(days, 30, Math.round((new Date(todayStr + 'T00:00:00Z').getTime() -
            new Date(rangeFromDate + 'T00:00:00Z').getTime()) / 86400000) + 1)
        : Math.max(days, 30);

    var now = new Date();
    // todayStr is already set above during date-range resolution; this line
    // re-uses the same variable (ES5 var is function-scoped / hoisted).
    todayStr = now.toISOString().slice(0, 10);
    var useRollups = preferRollups(ctx);
    var rollupHits = 0;
    var liveFallbacks = 0;

    // Collect DAU for the past N days.
    //
    // WAU/MAU strategy: we dedup across days using the full user list when
    // available (live-fallback path stores the list in analytics_dau). Rollup
    // docs don't carry user lists — we fall back to summing daily DAU with an
    // explicit `wau_estimated`/`mau_estimated` flag so the dashboard knows it
    // is an upper-bound approximation, not an undercount. Previously the
    // rollup-hit path bucketed each day into a distinct key (`rollup_<date>`),
    // which made `Object.keys(wauSet).length` return the *day count* (≤7) and
    // capped WAU at 7 — completely wrong.
    var dauTrend = [];
    var wauUserSet = {};
    var mauUserSet = {};
    var wauDailySum = 0;
    var mauDailySum = 0;
    var wauAnyRollup = false;
    var mauAnyRollup = false;
    var newUsersToday = 0;

    // Build the list of dates we need (newest → oldest) and the storage keys
    // for each. We then read them in BATCHES (one storageRead per data source)
    // instead of 2–3 sequential reads per day. With a 30-day window the old
    // loop issued 30–90 sequential storageRead round-trips, which pushed the
    // RPC past the 30s gateway timeout. Batching collapses that to 3 reads.
    var dayInfos = []; // { d, dateStr, dauKey, legacyKey, rollupKey }
    for (var d = 0; d < scanDays; d++) {
        var date = new Date(now.getTime() - d * 86400000);
        var dateStr = date.toISOString().slice(0, 10);
        var unixTs = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 1000);
        dayInfos.push({
            d: d,
            dateStr: dateStr,
            dauKey: gameId === 'all' ? 'dau_platform_' + dateStr : 'dau_' + gameId + '_' + dateStr,
            legacyKey: gameId === 'all' ? 'dau_platform_' + unixTs : 'dau_' + gameId + '_' + unixTs,
            rollupKey: 'rollup_' + (gameId || 'all') + '_' + dateStr
        });
    }

    // Helper: read many keys from one collection in a single call and return a
    // { key: value } map. Nakama caps a single storageRead at 100 objects, so
    // we chunk to stay within that limit.
    function batchRead(collection, keys) {
        var out = {};
        for (var c = 0; c < keys.length; c += 100) {
            var slice = keys.slice(c, c + 100);
            var reqs = [];
            for (var i = 0; i < slice.length; i++) {
                reqs.push({ collection: collection, key: slice[i], userId: SYSTEM_USER });
            }
            try {
                var res = nk.storageRead(reqs);
                if (res) {
                    for (var r = 0; r < res.length; r++) {
                        out[res[r].key] = res[r].value;
                    }
                }
            } catch (e) { /* no data for this chunk */ }
        }
        return out;
    }

    // Pass 1: primary YYYY-MM-DD dau docs (carry the user list → exact dedup).
    var primaryKeys = [];
    for (var pi = 0; pi < dayInfos.length; pi++) primaryKeys.push(dayInfos[pi].dauKey);
    var dauByKey = batchRead('analytics_dau', primaryKeys);

    // Pass 2: legacy unix-timestamp dau docs, but ONLY for days that missed.
    var legacyNeeded = [];
    for (var li = 0; li < dayInfos.length; li++) {
        if (!dauByKey[dayInfos[li].dauKey]) legacyNeeded.push(dayInfos[li].legacyKey);
    }
    var legacyByKey = legacyNeeded.length > 0 ? batchRead('analytics_dau', legacyNeeded) : {};

    // Pass 3: rollup counts (no user list), ONLY for days still unresolved and
    // older than today.
    var rollupNeeded = [];
    for (var ri = 0; ri < dayInfos.length; ri++) {
        var infoR = dayInfos[ri];
        var hasDau = dauByKey[infoR.dauKey] || legacyByKey[infoR.legacyKey];
        if (!hasDau && useRollups && infoR.d > 0) rollupNeeded.push(infoR.rollupKey);
    }
    var rollupByKey = rollupNeeded.length > 0 ? batchRead('analytics_rollup_daily', rollupNeeded) : {};

    for (var di = 0; di < dayInfos.length; di++) {
        var info = dayInfos[di];
        var d = info.d;
        var dateStr = info.dateStr;

        var dayUsers = 0;
        var dayNewUsers = 0;
        var resolved = false;
        var dayHasUserList = false;

        // Prefer the per-day analytics_dau doc: it carries the user-ID list
        // which is the ONLY source that lets us dedup across days for an exact
        // WAU/MAU. Rollup docs store a COUNT only (no IDs).
        var record = dauByKey[info.dauKey] || legacyByKey[info.legacyKey] || null;

        if (record) {
            liveFallbacks++;
            var uniqueUsersRaw = record.uniqueUsers;
            var recordUsers = record.users || (Array.isArray(uniqueUsersRaw) ? uniqueUsersRaw : []);
            dayUsers = (parseInt(record.count, 10) || 0) ||
                (Array.isArray(uniqueUsersRaw) ? uniqueUsersRaw.length : (parseInt(uniqueUsersRaw, 10) || 0)) ||
                (recordUsers ? recordUsers.length : 0);
            dayNewUsers = record.newUsers || 0;
            if (d === 0) newUsersToday = dayNewUsers;

            var userList = recordUsers || [];
            if (Array.isArray(userList) && userList.length > 0) {
                dayHasUserList = true;
                for (var ui = 0; ui < userList.length; ui++) {
                    var uid = userList[ui];
                    if (d < 7) wauUserSet[uid] = true;
                    mauUserSet[uid] = true;
                }
            }
            if (!dayHasUserList && typeof dayUsers === 'number') {
                if (d < 7) wauDailySum += dayUsers;
                mauDailySum += dayUsers;
            }
            resolved = true;
        }

        // Fall back to the rollup COUNT only when there's no per-day doc.
        if (!resolved && useRollups && d > 0) {
            var rollup = rollupByKey[info.rollupKey];
            if (rollup) {
                dayUsers = rollup.dau || 0;
                dayNewUsers = rollup.new_users || 0;
                if (d < 7) { wauDailySum += dayUsers; wauAnyRollup = true; }
                mauDailySum += dayUsers; mauAnyRollup = true;
                rollupHits++;
                resolved = true;
            }
        }

        dauTrend.unshift({ date: dateStr, count: dayUsers, newUsers: dayNewUsers });
    }

    // Calculate DAU (today), WAU (7d), MAU (30d).
    var dau = dauTrend.length > 0 ? dauTrend[dauTrend.length - 1].count : 0;
    var wauUnique = Object.keys(wauUserSet).length;
    var mauUnique = Object.keys(mauUserSet).length;
    // WAU/MAU: per-day analytics_dau docs carry the user-ID list, so days that
    // resolved that way are deduped EXACTLY (wauUnique / mauUnique). Rollup-only
    // days carry just a count (no IDs) and accumulate into wauDailySum /
    // mauDailySum. Those two sets of days are disjoint, so the best single
    // estimate is unique + rollupSum. When there are no rollup-only days
    // (rollupSum === 0) this collapses to the exact deduped figure.
    var wau = wauUnique + wauDailySum;
    var mau = mauUnique + mauDailySum;
    var wauEstimated = wauAnyRollup;
    var mauEstimated = mauAnyRollup;

    var dauMauRatio = mau > 0 ? dau / mau : 0;

    // 7-day change percent
    var dau7dAgo = dauTrend.length >= 8 ? dauTrend[dauTrend.length - 8].count : dau;
    var dau7dChangePct = dau7dAgo > 0 ? Math.round(((dau - dau7dAgo) / dau7dAgo) * 100) : 0;

    // Session stats
    var sessionKey = gameId === 'all'
        ? 'session_stats_' + todayStr
        : 'session_stats_' + gameId + '_' + todayStr;
    var sessionStats = null;
    try {
        var sessObjs = nk.storageRead([{ collection: 'analytics_sessions', key: sessionKey, userId: SYSTEM_USER }]);
        if (sessObjs && sessObjs.length > 0) sessionStats = sessObjs[0].value;
    } catch (e) { /* no data */ }

    var avgSessionDuration = 0;
    if (sessionStats) {
        if (sessionStats.durations && sessionStats.durations.length > 0) {
            var sSum = 0;
            for (var si = 0; si < sessionStats.durations.length; si++) {
                sSum += parseFloat(sessionStats.durations[si]) || 0;
            }
            avgSessionDuration = Math.round(sSum / sessionStats.durations.length);
        } else {
            avgSessionDuration = sessionStats.avgDuration || 0;
        }
        if (avgSessionDuration > 14400) avgSessionDuration = 14400;
    }

    // Top games (if platform-wide). Paginate up to 10 pages * 100 = 1000
    // DAU records so active games beyond the first page aren't silently
    // truncated. Previously a single 100-row slice capped the entire scan.
    var topGames = [];
    if (gameId === 'all') {
        try {
            var gameStats = {};
            var cursor = null;
            var pagesScanned = 0;
            var maxPages = 10;
            var pageSize = 100;
            while (pagesScanned < maxPages) {
                var scanObjs = nk.storageList(SYSTEM_USER, 'analytics_dau', pageSize, cursor);
                if (!scanObjs || !scanObjs.objects || scanObjs.objects.length === 0) break;
                for (var i = 0; i < scanObjs.objects.length; i++) {
                    var obj = scanObjs.objects[i];
                    if (!obj.key || obj.key.indexOf('dau_') !== 0) continue;
                    if (obj.key.indexOf('dau_platform_') === 0) continue;
                    var parts = obj.key.split('_');
                    if (parts.length < 3) continue;
                    var gid = parts[1];
                    if (!gameStats[gid]) gameStats[gid] = { gameId: gid, totalDau: 0, days: 0 };
                    gameStats[gid].totalDau += (obj.value && (obj.value.count || obj.value.uniqueUsers)) || 0;
                    gameStats[gid].days++;
                }
                pagesScanned++;
                if (!scanObjs.cursor) break;
                cursor = scanObjs.cursor;
            }
            // Reverse-alias UUID → human slug for the dashboard top-games card.
        var UUID_TO_SLUG = {};
        for (var _slug in GAME_ID_SLUG_ALIASES) {
            if (Object.prototype.hasOwnProperty.call(GAME_ID_SLUG_ALIASES, _slug)) {
                UUID_TO_SLUG[GAME_ID_SLUG_ALIASES[_slug]] = _slug;
            }
        }
        topGames = Object.keys(gameStats).map(function(gid) {
                var avgDau = Math.round(gameStats[gid].totalDau / Math.max(1, gameStats[gid].days));
                return {
                    gameId: gid,
                    game_id: gid,
                    // Human-readable name for dashboard rendering (falls back to UUID)
                    game_name: UUID_TO_SLUG[gid] || gid,
                    avgDau: avgDau,
                    avg_dau: avgDau,
                    dau: avgDau
                };
            }).sort(function(a, b) { return b.avgDau - a.avgDau; }).slice(0, 5);
        } catch (e) {
            if (logger && logger.warn) logger.warn('[Analytics] Top games scan error: ' + e.message);
        }
    }

    var dauWindow = dauTrend.slice(-7).map(function(day) { return day.count || 0; });
    var dau7dMin = dauWindow.length > 0 ? Math.min.apply(null, dauWindow) : 0;
    var dau7dMax = dauWindow.length > 0 ? Math.max.apply(null, dauWindow) : 0;

    // When the client sent from_date/to_date, headline KPIs should describe
    // that window (e.g. "today only"), not rolling calendar WAU/MAU on today.
    var metricsWindowMode = 'rolling';
    if (rangeFromDate) {
        metricsWindowMode = 'custom';
        var windowTrend = [];
        for (var wt = 0; wt < dauTrend.length; wt++) {
            var wDay = dauTrend[wt];
            if (wDay.date >= rangeFromDate && wDay.date <= (rangeToDate || todayStr)) {
                windowTrend.push(wDay);
            }
        }
        if (windowTrend.length > 0) {
            var lastInWindow = windowTrend[windowTrend.length - 1];
            dau = lastInWindow.count || 0;
            newUsersToday = lastInWindow.newUsers || 0;
            var windowCounts = windowTrend.map(function(wd) { return wd.count || 0; });
            dau7dMin = Math.min.apply(null, windowCounts);
            dau7dMax = Math.max.apply(null, windowCounts);
            if (windowTrend.length === 1) {
                wau = dau;
                mau = dau;
                wauEstimated = false;
                mauEstimated = false;
            } else if (windowTrend.length <= 7) {
                wau = Math.max.apply(null, windowCounts);
                wauEstimated = true;
                mau = windowTrend.length <= 30 ? Math.max.apply(null, windowCounts) : mau;
                mauEstimated = windowTrend.length < 30;
            }
            dauMauRatio = mau > 0 ? dau / mau : 0;

            var rangeEnd = rangeToDate || todayStr;
            var rangeSessionKey = gameId === 'all'
                ? 'session_stats_' + rangeEnd
                : 'session_stats_' + gameId + '_' + rangeEnd;
            try {
                var rangeSessObjs = nk.storageRead([{
                    collection: 'analytics_sessions',
                    key: rangeSessionKey,
                    userId: SYSTEM_USER
                }]);
                if (rangeSessObjs && rangeSessObjs.length > 0 && rangeSessObjs[0].value) {
                    var rv = rangeSessObjs[0].value;
                    if (rv.durations && rv.durations.length > 0) {
                        var rSum = 0;
                        for (var rdi = 0; rdi < rv.durations.length; rdi++) {
                            rSum += parseFloat(rv.durations[rdi]) || 0;
                        }
                        avgSessionDuration = Math.round(rSum / rv.durations.length);
                    } else {
                        avgSessionDuration = rv.avgDuration || avgSessionDuration;
                    }
                    if (avgSessionDuration > 14400) avgSessionDuration = 14400;
                }
            } catch (eRangeSess) { /* non-fatal */ }
        }
    }

    // ── Total players (lifetime unique users) ─────────────────────────────
    // Read from the cumulative counter written by rpcAnalyticsRollupRun on
    // every successful daily run. Starts at 0 until the first rollup runs.
    var totalPlayersLifetime = 0;
    var totalPlayersLastDate = null;
    try {
        var platformTotals = readPlatformTotals(nk);
        if (platformTotals) {
            totalPlayersLifetime = parseInt(platformTotals.total_users_lifetime, 10) || 0;
            totalPlayersLastDate = platformTotals.last_rollup_date || null;
        }
    } catch (eTp) { /* non-fatal */ }

    // ── Downloads from App Store & Play Console ───────────────────────────
    // Populated by: external_poll_appstore / play_console_import RPCs.
    // Returns 0 until data is first imported. See docs/STORE_INTEGRATION.md.
    var totalDownloadsIos     = 0;
    var totalDownloadsAndroid = 0;
    var downloadSources       = {};
    try {
        // App Store Connect — keyed by apple_appstore_import or external_poll_appstore
        var appleLatest = readExternalSnapshot(nk, "apple_quizverse_latest") ||
                          readExternalSnapshot(nk, "apple_latest");
        if (appleLatest) {
            totalDownloadsIos = extractDownloadsFromSnapshot(appleLatest);
            downloadSources.ios = { source: "appstore", fetched_at: appleLatest.fetched_at || appleLatest.fetchedAt };
        }
    } catch (eIos) { /* non-fatal */ }
    try {
        // Google Play Console — keyed by play_console_import RPC
        var playLatest = readExternalSnapshot(nk, "play_quizverse_latest") ||
                         readExternalSnapshot(nk, "play_latest");
        if (playLatest) {
            totalDownloadsAndroid = extractDownloadsFromSnapshot(playLatest);
            downloadSources.android = { source: "play_console", fetched_at: playLatest.fetched_at || playLatest.fetchedAt };
        }
    } catch (ePlay) { /* non-fatal */ }

    // ── Self-healing auto-rollup ──────────────────────────────────────────
    // If the cron is not running (e.g. production K8s without a CronJob),
    // the daily rollup will never execute. To prevent DEGRADED status and
    // missing WAU/MAU history, auto-trigger yesterday's rollup here when it
    // is absent. Wrapped in try/catch so a slow or failing rollup never
    // breaks the dashboard response.
    //
    // 2026-07-09 hardening (context-canceled incident). The old block called
    // rpcAnalyticsRollupRun unconditionally whenever readRollupDaily returned
    // null. Two failure modes stacked there:
    //   1. readRollupDaily swallows read errors, so once this request's HTTP
    //      context was already canceled (the 30-day trend reads above can
    //      burn the ~22s prod context budget; socket read/write timeouts are
    //      30s in config.yaml), an EXISTING rollup read back as "missing"
    //      and the trigger fired anyway.
    //   2. The rollup then ran its scan + compute/write phase on the dying
    //      context — storageList failed ("Could not list storage.") and every
    //      write failed with "context canceled", logged as
    //      "[analytics_rollup] critical write failures ... rollup_all/funnel_all".
    // Fixes: (a) error-aware existence check — a failed read means "unknown",
    // never "missing", so no trigger; (b) only trigger while enough of the
    // request budget remains, and hand the rollup a scan budget sized to the
    // time actually left (the run checkpoints and resumes, so a short pass
    // still makes progress); (c) env kill-switch DASHBOARD_AUTO_ROLLUP=false.
    var autoRollupMeta = null;
    try {
        var arqEnabled = !(ctx && ctx.env &&
            (ctx.env.DASHBOARD_AUTO_ROLLUP === "false" || ctx.env.DASHBOARD_AUTO_ROLLUP === "0"));
        var yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        var rollupAbsent = false;
        if (arqEnabled) {
            // Direct read (NOT readRollupDaily): let a storage error throw so
            // the catch below records it instead of treating it as absence.
            var exRead = nk.storageRead([{
                collection: "analytics_rollup_daily",
                key: "rollup_all_" + yday,
                userId: SYSTEM_USER
            }]);
            rollupAbsent = !exRead || exRead.length === 0;
        }
        if (arqEnabled && rollupAbsent && typeof rpcAnalyticsRollupRun === 'function') {
            // Budget guard: prod HTTP contexts die at ~22s. Reserve headroom
            // for the rollup's checkpoint/compute writes and this RPC's own
            // response; skip entirely when too little time remains — the
            // cron (or the next early-arriving dashboard request) picks it up.
            var arqDeadlineMs = 22000;
            var arqHeadroomMs = 5000;
            var arqRemainingMs = arqDeadlineMs - (Date.now() - __adStartMs) - arqHeadroomMs;
            if (arqRemainingMs < 3000) {
                autoRollupMeta = { triggered: false, skipped: "insufficient_budget", date: yday };
            } else {
                var aSecret = (ctx && ctx.env && ctx.env.DASHBOARD_SECRET) ||
                    "2074ff0e9dea8fb3c8162a0301b6ea06bbb938187b89a0b6789ea583f25d34c8";
                logger.info("[analytics_dashboard] stale rollup for " + yday +
                            " — auto-triggering one pass (budget_ms=" + arqRemainingMs + ")");
                var passRaw = rpcAnalyticsRollupRun(ctx, logger, nk, JSON.stringify({
                    date: yday,
                    dashboard_secret: aSecret,
                    budget_ms: arqRemainingMs
                }));
                var passRes = {};
                try { passRes = JSON.parse(passRaw || "{}"); } catch (ePr) { /* ignore */ }
                autoRollupMeta = {
                    triggered: true,
                    date: yday,
                    partial: passRes.partial === true,
                    complete: passRes.complete === true
                };
                logger.info("[analytics_dashboard] auto-rollup pass done for " + yday +
                            (passRes.partial ? " (partial — checkpointed, will resume)" : ""));
            }
        }
    } catch (autoRollupErr) {
        logger.warn("[analytics_dashboard] auto-rollup skipped/failed: " + (autoRollupErr && autoRollupErr.message));
        autoRollupMeta = { triggered: false, error: autoRollupErr && autoRollupErr.message };
    }

    return JSON.stringify({
        success: true,
        // ── Core engagement KPIs ──────────────────────────────────────────
        dau: dau,
        wau: wau,
        mau: mau,
        wau_estimated: wauEstimated,
        mau_estimated: mauEstimated,
        dau_mau_ratio: dauMauRatio,
        new_users_today: newUsersToday,
        returning_users_today: Math.max(0, dau - newUsersToday),
        avg_session_duration_seconds: avgSessionDuration,
        dau_7d_min: dau7dMin,
        dau_7d_max: dau7dMax,
        dau_trend: (function() {
            var trend = dauTrend.map(function(d) { return { date: d.date, dau: d.count }; });
            // Apply custom date-range filter when the client sent from_date/to_date
            if (rangeFromDate) {
                trend = trend.filter(function(d) {
                    return d.date >= rangeFromDate && d.date <= (rangeToDate || todayStr);
                });
            } else {
                // Default: return all days within the requested window (no 14-day cap)
                trend = trend.slice(0); // all days
            }
            return trend;
        })(),
        // Range metadata echoed back so the frontend knows what window was served
        range_from: rangeFromDate || null,
        range_to:   rangeToDate   || null,
        range_days: days,
        metrics_window: metricsWindowMode,
        trends: {
            dau_7d_change_pct: dau7dChangePct
        },
        top_games: topGames,
        // ── Platform-wide lifetime counters ───────────────────────────────
        // total_players = unique users who have ever played (cumulative,
        //   incremented by each daily rollup run; reachable via
        //   analytics_rollup_meta/platform_totals).
        // total_downloads_* = cumulative installs from store console APIs.
        //   Populated by external_poll_appstore (iOS) and play_console_import
        //   (Android). Shows 0 until first import runs.
        total_players:           totalPlayersLifetime,
        total_players_as_of:     totalPlayersLastDate,
        total_downloads_ios:     totalDownloadsIos,
        total_downloads_android: totalDownloadsAndroid,
        total_downloads:         totalDownloadsIos + totalDownloadsAndroid,
        download_sources:        downloadSources,
        // ── Live counter doc for today ─────────────────────────────────────
        live_today: liveCountersRead(nk, resolveGameIdAlias(gameId)),
        _meta: {
            read_path: useRollups ? "rollup-preferred" : "live-only",
            rollup_hits: rollupHits,
            live_fallbacks: liveFallbacks,
            auto_rollup: autoRollupMeta,
            generated_at: new Date().toISOString()
        }
    });
}

// ─── RPC: analytics_dashboard_summary ────────────────────
//
// Phase-2 convenience RPC. Returns the full rollup doc for a single date
// (defaults to yesterday) so the dashboard can render one card with one
// round-trip. Complements analytics_dashboard (trend) with one-shot "KPI
// for the most recent rolled-up day" reads.

function rpcAnalyticsDashboardSummary(ctx, logger, nk, payload) {
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var SYSTEM_USER_LOCAL = "00000000-0000-0000-0000-000000000000";
    var gameId  = parsed.game_id || parsed.gameId || "all";
    var todayStr = new Date().toISOString().slice(0, 10);
    var dateStr = parsed.date;
    if (!dateStr) {
        var y = new Date();
        y.setUTCDate(y.getUTCDate() - 1);
        dateStr = y.toISOString().slice(0, 10);
    }

    // If the caller is asking for today, serve the live counter doc first.
    // This makes event counts visible on the dashboard within seconds of the
    // event being received — no rollup run needed for the current day.
    if (dateStr === todayStr) {
        var liveKey = "live_" + resolveGameIdAlias(gameId) + "_" + todayStr;
        var liveDoc = null;
        try {
            var lRecs = nk.storageRead([{
                collection: "analytics_live_daily",
                key: liveKey,
                userId: SYSTEM_USER_LOCAL
            }]);
            if (lRecs && lRecs.length > 0) liveDoc = lRecs[0].value;
        } catch (_) { /* fall through to rollup */ }

        if (liveDoc) {
            // Merge today's live event counts with DAU from analytics_dau so the
            // dashboard gets both the "how many events" and "how many users" numbers.
            var dauKey = gameId === "all"
                ? "dau_platform_" + todayStr
                : "dau_" + resolveGameIdAlias(gameId) + "_" + todayStr;
            var dauDoc = null;
            try {
                var dRecs = nk.storageRead([{
                    collection: "analytics_dau",
                    key: dauKey,
                    userId: SYSTEM_USER_LOCAL
                }]);
                if (dRecs && dRecs.length > 0) dauDoc = dRecs[0].value;
            } catch (_) { /* no DAU yet today */ }

            var dauCount = 0;
            if (dauDoc) {
                dauCount = parseInt(dauDoc.count, 10) ||
                    (Array.isArray(dauDoc.users) ? dauDoc.users.length : 0) ||
                    (Array.isArray(dauDoc.uniqueUsers) ? dauDoc.uniqueUsers.length : 0) || 0;
            }

            return JSON.stringify({
                success: true,
                source: "live",
                gameId: gameId,
                date: todayStr,
                total_events: liveDoc.total || 0,
                event_counts: liveDoc.by_name || {},
                last_event_at: liveDoc.last_event_at || 0,
                dau: dauCount
            });
        }
    }

    var doc = readRollupDaily(nk, resolveGameIdAlias(gameId), dateStr);
    if (!doc) {
        return JSON.stringify({
            success: false,
            error: "No rollup for " + gameId + "/" + dateStr + ". Trigger analytics_rollup_run first.",
            gameId: gameId,
            date: dateStr
        });
    }
    doc.success = true;
    doc.source = "rollup";
    return JSON.stringify(doc);
}

/**
 * analytics_events_today — lightweight public RPC for E2E testing.
 *
 * Returns the live ingest counters for today from analytics_metrics_counters.
 * No admin auth required — intended for the Unity Analytics E2E test window
 * to verify that events are actually reaching the server.
 *
 * Response: { success, date, events_today_accepted, events_today_rejected,
 *             events_accepted, events_rejected, log_calls }
 */
function rpcAnalyticsEventsToday(ctx, logger, nk, payload) {
    var today = new Date().toISOString().slice(0, 10);
    var key = "counter_" + today;
    var rec = null;
    try {
        var docs = nk.storageRead([{ collection: "analytics_metrics_counters", key: key, userId: SYSTEM_USER }]);
        if (docs && docs.length > 0) {
            // docs[0].value is already a parsed JS object (nk.storageRead deserialises JSON);
            // JSON.parse on an object would throw — handle both forms safely.
            var raw = docs[0].value;
            rec = (raw && typeof raw === "object") ? raw : JSON.parse(raw);
        }
    } catch (e) {
        logger.warn("[analytics_events_today] storageRead failed: " + e.message);
    }
    if (!rec) {
        rec = { events_accepted: 0, events_rejected: 0, log_calls: 0 };
    }
    return JSON.stringify({
        success: true,
        date: today,
        events_today_accepted: rec.events_accepted || 0,
        events_today_rejected: rec.events_rejected || 0,
        // duplicate fields for backward compat with various client parsers
        events_accepted:       rec.events_accepted || 0,
        events_rejected:       rec.events_rejected || 0,
        log_calls:             rec.log_calls       || 0
    });
}

// Registration - postbuild.js scans for this
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    initializer.registerRpc("analytics_dashboard", rpcAnalyticsDashboard);
    initializer.registerRpc("analytics_dashboard_summary", rpcAnalyticsDashboardSummary);
    initializer.registerRpc("analytics_events_today", rpcAnalyticsEventsToday);
    logger.info("[Analytics] Module registered: 4 RPCs");
}
