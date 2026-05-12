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
    var userId = ctx.userId;
    if (!userId) return { __invalid: "User not authenticated" };

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
 * Persist a single normalized event + fan-out to DAU + session aggregator.
 * Returns null on success, or a string error.
 */
function persistNormalizedEvent(nk, logger, ev) {
    // ── Unified player analytics store (game_player_analytics) ──
    // All per-player event data goes to a single doc keyed {gameId}:{userId}.
    try {
        gpaUpsertEvent(nk, logger, ev);
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[analytics] gpaUpsertEvent failed: " + (e.message || e));
        }
        return "Failed to write player analytics";
    }

    // ── In-house dashboard fan-out (analytics_events / dash_* keys) ──
    // The legacy dashboard rollup scanners (analytics_rollup.js::arScanEventsForDate,
    // admin_events_timeline, admin_top_events) all query the `analytics_events`
    // collection with a key prefix of `dash_<gameId>_<YYYY-MM-DD>_*`. Without this
    // write, the dashboard at /analytics.html shows zero events.
    //
    // Wrapped in try/catch so a transient storage error never breaks the player
    // analytics store write above (which is the primary source of truth for the
    // game_player_analytics doc and the per-user buffer).
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
        if (logger && logger.warn) {
            logger.warn("[analytics] dash_* fan-out failed (dashboard rollups will miss this event): " + (e.message || e));
        }
    }

    // ── Heroic Labs Satori cloud fan-out (direct HTTP, hardcoded creds) ──
    //
    // Phase 3 (2026-05) overhaul:
    //   • Allowlist filter — sdEnqueueOrFlush early-returns for any event
    //     not in SD_EVENT_ALLOWLIST (~30 canonical events). The other ~250
    //     dashboard-only events stay in-house and never touch Satori.
    //   • Per-identity batch buffer — events accumulate in process memory
    //     and flush at 50 events OR 5 s idle. Drops Satori HTTP from
    //     ~1-per-event to ~1-per-50-events for active users.
    //   • Identity hybrid (Q6=C) — on session_start we push the full
    //     identity property bag to /v1/properties exactly once per
    //     process per identity; per-event metadata is slimmed down to
    //     platform/country/app_version + event-essentials inside
    //     sdSlimMetadata.
    //
    // Fan-out failures NEVER abort the main RPC — the in-house dash_*
    // write above is the durable source of truth and the dashboard
    // doesn't depend on Satori at all.
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
        trackPlatform(nk, logger, ev.gameId, ev.platform);
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
        if (data.events.length > 200) {
            return utils.handleError(ctx, null, "Batch too large: max 200 events per call");
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

    for (var i = 0; i < inbound.length; i++) {
        var normalized = normalizeInboundEvent(ctx, inbound[i], nk, logger);
        if (!normalized || normalized.__invalid) {
            rejected++;
            var rejReason = (normalized && normalized.__invalid) || "Invalid event";
            errors.push({ index: i, reason: rejReason });
            // Persist to ring buffer so the dashboard's Pipeline tab can show it.
            recordFailedEvent(nk, logger, ctx, inbound[i], rejReason);
            continue;
        }
        var err = persistNormalizedEvent(nk, logger, normalized);
        if (err) {
            rejected++;
            errors.push({ index: i, reason: err });
            recordFailedEvent(nk, logger, ctx, inbound[i], err);
        } else {
            if (normalized.canonicalized) aliasNormalized++;
            if (normalized.schemaVersion === 2) {
                v2EventsCount++;
                v2WarningsCount += (normalized.v2Warnings && normalized.v2Warnings.length) || 0;
            }
            accepted++;
        }
    }

    utils.logInfo(logger, "analytics_log_event accepted=" + accepted + " rejected=" + rejected);

    // Best-effort counter tick (for analytics_metrics RPC). Ignored on failure
    // so it never blocks event ingestion.
    try {
        bumpMetricsCounter(nk, {
            accepted:         accepted,
            rejected:         rejected,
            alias_normalized: aliasNormalized,
            schema_v2_events:   v2EventsCount,
            schema_v2_warnings: v2WarningsCount
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

    // Satori identity piggyback (Phase 8 wiring, 2026-05): debounced 1 h.
    // Keeps Satori trait properties (skill_band, churn_risk, spend_tier, …)
    // fresh without any external cron dependency. The 1-h gate means this
    // fires at most once per Nakama process per hour, regardless of traffic.
    try {
        if (typeof siAutoRunIfNeeded === "function") {
            siAutoRunIfNeeded(ctx, nk, logger);
        }
    } catch (e) { /* swallow */ }

    var resp = {
        success:          accepted > 0 || rejected === 0,
        accepted:         accepted,
        rejected:         rejected,
        alias_normalized: aliasNormalized,
        schema_v2_events: v2EventsCount
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
        if (delta.log_calls !== false) rec.log_calls += 1;
        rec.updated_at = new Date().toISOString();
        return rec;
    });
}

/**
 * Track per-platform daily counter (used by analytics_platform_breakdown).
 */
function trackPlatform(nk, logger, gameId, platform) {
    var today = utils.getStartOfDay();
    var key = "platform_" + gameId + "_" + today + "_" + platform;
    casUpdate(nk, logger, "analytics_platform", key, SYSTEM_USER, function (rec) {
        if (!rec) rec = { gameId: gameId, date: today, platform: platform, count: 0 };
        rec.count = (rec.count || 0) + 1;
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
function trackDAU(nk, logger, userId, gameId, isNewUser) {
    var today = utils.getStartOfDay();
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
                if (dauData.uniqueUsers.indexOf(userId) !== -1) return null; // no-op, already recorded
                dauData.uniqueUsers.push(userId);
                dauData.count = dauData.uniqueUsers.length;
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
    var today = utils.getStartOfDay();
    var collection = "analytics_sessions";
    var keys = ["session_stats_" + today];
    if (gameId) keys.push("session_stats_" + gameId + "_" + today);
    for (var k = 0; k < keys.length; k++) {
        (function (key) {
            casUpdate(nk, logger, collection, key, SYSTEM_USER, function (stats) {
                if (!stats) {
                    stats = { date: today, gameId: gameId || null, totalSessions: 0, totalDuration: 0, avgDuration: 0 };
                }
                stats.totalSessions++;
                stats.totalDuration += (durationSeconds || 0);
                stats.avgDuration = stats.totalSessions > 0 ? Math.round(stats.totalDuration / stats.totalSessions) : 0;
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
 * RPC: analytics_dashboard
 * Returns DAU, WAU, MAU, retention ratios, trends for the dashboard.
 *
 * Phase-2 read path: for every day older than today we try to read a
 * pre-computed rollup from `analytics_rollup_daily` first. Only fall back
 * to the legacy DAU storageRead when the rollup is missing. Today is always
 * computed live (from analytics_dau counters) because the nightly rollup
 * hasn't run yet for today's date.
 *
 * Payload: { game_id?: string, gameId?: string, days?: number }
 */
function rpcAnalyticsDashboard(ctx, logger, nk, payload) {
    var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";
    var parsed = {};
    try { parsed = JSON.parse(payload || '{}'); } catch (e) { /* ignore */ }

    var gameId = resolveGameIdAlias(parsed.game_id || parsed.gameId || 'all');
    var days = parseInt(parsed.days, 10) || 30;

    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
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

    for (var d = 0; d < days; d++) {
        var date = new Date(now.getTime() - d * 86400000);
        var dateStr = date.toISOString().slice(0, 10);

        var dayUsers = 0;
        var dayNewUsers = 0;
        var resolved = false;
        var dayHasUserList = false;

        // Phase-2: try rollup first for any day older than today.
        if (useRollups && d > 0) {
            var rollup = readRollupDaily(nk, gameId, dateStr);
            if (rollup) {
                dayUsers = rollup.dau || 0;
                dayNewUsers = rollup.new_users || 0;
                if (d < 7) { wauDailySum += dayUsers; wauAnyRollup = true; }
                mauDailySum += dayUsers; mauAnyRollup = true;
                rollupHits++;
                resolved = true;
            }
        }

        if (!resolved) {
            var key = gameId === 'all' ? 'dau_platform_' + dateStr : 'dau_' + gameId + '_' + dateStr;
            var record = null;
            try {
                var objs = nk.storageRead([{ collection: 'analytics_dau', key: key, userId: SYSTEM_USER }]);
                if (objs && objs.length > 0) record = objs[0].value;
            } catch (e) { /* no data */ }
            liveFallbacks++;

            if (record) {
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
            }
        }

        dauTrend.unshift({ date: dateStr, count: dayUsers, newUsers: dayNewUsers });
    }

    // Calculate DAU (today), WAU (7d), MAU (30d).
    var dau = dauTrend.length > 0 ? dauTrend[dauTrend.length - 1].count : 0;
    var wauUnique = Object.keys(wauUserSet).length;
    var mauUnique = Object.keys(mauUserSet).length;
    // If we saw any rollup days (no user lists), we must use the sum path to
    // avoid silently undercounting. The sum is an upper bound but more honest
    // than zero or a days-with-data count.
    var wau = wauAnyRollup ? (wauUnique + wauDailySum) : Math.max(wauUnique, wauDailySum);
    var mau = mauAnyRollup ? (mauUnique + mauDailySum) : Math.max(mauUnique, mauDailySum);
    var wauEstimated = wauAnyRollup || (wauUnique === 0 && wauDailySum > 0);
    var mauEstimated = mauAnyRollup || (mauUnique === 0 && mauDailySum > 0);

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

    var avgSessionDuration = sessionStats ? sessionStats.avgDuration : 0;

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
            topGames = Object.keys(gameStats).map(function(gid) {
                var avgDau = Math.round(gameStats[gid].totalDau / Math.max(1, gameStats[gid].days));
                return {
                    gameId: gid,
                    game_id: gid,
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

    return JSON.stringify({
        success: true,
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
        dau_trend: dauTrend.slice(-14).map(function(d) { return { date: d.date, dau: d.count }; }),
        trends: {
            dau_7d_change_pct: dau7dChangePct
        },
        top_games: topGames,
        _meta: {
            read_path: useRollups ? "rollup-preferred" : "live-only",
            rollup_hits: rollupHits,
            live_fallbacks: liveFallbacks,
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

    var gameId = parsed.game_id || parsed.gameId || "all";
    var dateStr = parsed.date;
    if (!dateStr) {
        var y = new Date();
        y.setUTCDate(y.getUTCDate() - 1);
        dateStr = y.toISOString().slice(0, 10);
    }

    var doc = readRollupDaily(nk, gameId, dateStr);
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

// Registration - postbuild.js scans for this
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_log_event", rpcAnalyticsLogEvent);
    initializer.registerRpc("analytics_dashboard", rpcAnalyticsDashboard);
    initializer.registerRpc("analytics_dashboard_summary", rpcAnalyticsDashboardSummary);
    logger.info("[Analytics] Module registered: 3 RPCs");
}
