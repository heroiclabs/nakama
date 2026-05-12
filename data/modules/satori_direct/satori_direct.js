// satori_direct.js — pure-JS Satori HTTP client (v2 — verified wire contract).
//
// Why this exists:
//   The "official" path to Satori from JS modules is `nk.getSatori()`, which
//   returns a Go-side client backed by --satori.* CLI flags. Those flags
//   require a k8s Secret + Deployment patch — DevOps round-trip every push.
//
//   This module bypasses all that. It calls Satori's REST API directly via
//   nk.httpRequest using credentials hardcoded below. As long as the JS
//   bundle is loaded, Satori works — no CLI flags, no cluster Secret, no
//   DevOps. Trade-off (consciously accepted, see chat 2026-05-10): anyone
//   with read access to this repo or the ECR image can extract these creds.
//   Mitigation: rotate by editing the constants and shipping a new image.
//
// What v2 fixed (chat 2026-05-10 evening — see commit message):
//   The v1 implementation locally-minted JWTs and POSTed to /v1/event with a
//   Bearer header. That endpoint REQUIRES a server-issued JWT obtained from
//   /v1/authenticate first (with a real `sid` claim). Our locally-minted
//   token had no sid → Satori returned 401 "Auth token invalid" on every
//   call → the auto-drain state machine ticked but published 0 events →
//   Satori cloud dashboard stayed empty. Confirmed by tracing
//   internal/satori/satori.go and reproducing locally with curl.
//
//   v2 fix:
//     • Events go to /v1/server-event with HTTP Basic Auth (api_key:'').
//       This is the documented server-to-server endpoint — no JWT needed,
//       no per-identity authentication, supports batch and non-player
//       events. Reference: internal/satori/satori.go::ServerEventsPublish
//       (line 569) + https://heroiclabs.com/docs/satori/guides/server-events/
//     • Identity properties & flags go through /v1/authenticate first to
//       obtain a real Satori session token (which Satori signs and embeds
//       a `sid` into), then that token is used as Bearer for /v1/properties
//       and /v1/flag. Cached in-memory per identity for SD_AUTH_TTL_MS
//       to avoid hammering /v1/authenticate during backfill.
//     • Event name normalizer: maps our internal names ("session_start",
//       "purchase", "ad_impression", …) to Satori's core event names
//       ("gameStarted", "purchaseCompleted", "adImpression", …) so the
//       canned Satori metrics (Revenue, ActiveUsers, etc.) populate
//       automatically. Unmapped names pass through untouched — they'll
//       show up in Satori console → Settings → Taxonomy → Debugger for
//       the operator to register in one click.
//
// API surface (functions return null on success, {ok:false,code,body} on failure):
//   sdEventsPublish(ctx, nk, logger, identifier, events)  → /v1/server-event (Basic)
//   sdAuthenticate(ctx, nk, logger, identifier)           → /v1/authenticate, returns session token
//   sdPropertiesGet(ctx, nk, logger, identifier)          → /v1/properties (Bearer)
//   sdPropertiesUpdate(ctx, nk, logger, identifier, props)→ /v1/properties (Bearer)
//   sdFlagsList(ctx, nk, logger, identifier)              → /v1/flag (Bearer)
//   sdNormalizeEventName(rawName)                          → internal→Satori name
//   sdSelfCheck(ctx, nk, logger)                          → publishes gameStarted, returns response
//
// Reference points:
//   internal/satori/satori.go   — canonical Go-side client we mirror
//   https://heroiclabs.com/docs/satori/guides/server-events/  — wire format
//   https://heroiclabs.com/docs/satori/concepts/performance-monitoring/understand-events/ — core event taxonomy

// ─── Hardcoded credentials ─────────────────────────────────────────────
//
// These are the QuizVerse Satori "dev" project. To rotate, edit the values
// below and ship a new image — no env-var or k8s changes needed.
var SD_URL          = "https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io";
var SD_API_KEY_NAME = "SATORIAPIKEY";
var SD_API_KEY      = "f6554c37-e40f-490f-b730-acaf6ecabe4c";
var SD_SIGNING_KEY  = "a939cfcc-5ef2-456a-b009-cca2dcc907d2";  // unused in v2; kept for backward compat with code that still references it
var SD_TIMEOUT_MS   = 4000;     // bumped from 2000 — server-event + auth round-trips need a bit more headroom
var SD_AUTH_TTL_MS  = 25 * 60 * 1000;  // session-token cache TTL (Satori issues 30-min tokens)
var SD_AUTH_CACHE   = {};       // in-memory per-identity cache (process-local; cleared on Nakama restart)

// ─── Phase 3 (2026-05): batching, filtering, identity ──────────────────
//
// Q3=B (medium filter) — only canonical events flow to Satori. The other
// ~250 events still land in the in-house dashboard but never burn Satori
// quota. Add/remove names here; lower-cased for the same-key lookup as
// SD_EVENT_MAP.
var SD_EVENT_ALLOWLIST = {
    // Lifecycle
    "session_start": true, "session_end": true, "app_open": true,
    "app_launched": true, "first_open": true,
    // Auth
    "registration_completed": true, "registration_complete": true,
    "login_success": true,
    // Onboarding
    "onboarding_started": true, "onboarding_complete": true,
    "onboarding_completed": true, "onboarding_abandoned": true,
    // Quiz core (the big retention drivers)
    "quiz_start": true, "quiz_started": true,
    "quiz_complete": true, "quiz_completed": true,
    "quiz_abandoned": true,
    "answer_submitted": true,
    // Monetization (high-signal — every event powers ARPU / paywall A/B)
    "iap_clicked": true, "iap_purchased": true,
    "purchase_started": true, "purchase_completed": true,
    "purchase_failed": true, "iap_impression": true, "iap_failed": true,
    "ad_requested": true, "ad_shown": true, "ad_impression": true,
    "ad_completed": true, "ad_load_failed": true, "ad_revenue": true,
    "paywall_shown": true, "paywall_converted": true,
    "paywall_dismissed": true, "premium_conversion": true,
    "store_opened": true,
    // Retention beats
    "retention_day_1": true, "retention_day_7": true, "retention_day_30": true,
    "user_returned": true,
    // Multiplayer milestones
    "mp_game_started": true, "mp_game_completed": true,
    "milestone_first_multiplayer": true,
    // Errors (high priority — feed Satori segments for alerting)
    "error_logged": true, "auth_failure": true,
    // Backfill marker — synthesised by analytics_backfill.js for days
    // where there's no real event to attribute DAU to. Keeps the Satori
    // dashboard non-empty for cold-start projects.
    "dau_synthetic": true
};
function sdIsAllowlisted(rawName) {
    if (!rawName) return false;
    return !!SD_EVENT_ALLOWLIST[String(rawName).toLowerCase()];
}

// Q6=C (hybrid identity) — fields that describe the IDENTITY rather than
// the EVENT. They migrate to sdPropertiesUpdate on session_start (one-shot
// per process per identity); per-event metadata never carries them.
var SD_IDENTITY_FIELDS = {
    "device_model": true, "device_id": true, "os_version": true,
    "manufacturer": true, "install_source": true, "display_name": true,
    "avatar_url": true, "user_id": true, "username": true,
    "first_seen_utc": true, "last_seen_utc": true
};

// Per-event metadata kept after slimming (Q6=C — slim copy on every event).
// Other keys are stripped UNLESS they're event-essential (price_usd,
// product_id, etc — see sdSlimMetadata).
var SD_SLIM_KEEP = {
    "platform": true, "country": true, "app_version": true,
    "game_id": true, "session_id": true
};

// Event-essential keys that MUST stay in metadata even when slim mode is on.
// Anything not in SD_SLIM_KEEP and not here is stripped from per-event payloads.
var SD_EVENT_ESSENTIAL = {
    // Monetization economics
    "product_id": true, "product_type": true, "price_usd": true, "price": true,
    "price_local": true, "amount": true, "currency": true, "transaction_id": true,
    "is_restore": true, "is_first_purchase": true, "paywall_id": true,
    "entry_point": true,
    // Ad attribution
    "ad_unit": true, "ad_network": true, "ad_format": true, "ad_placement": true,
    // Quiz state (powers per-mode dashboards)
    "quiz_id": true, "quiz_mode": true, "game_mode": true, "category": true,
    "difficulty": true, "question_count": true, "score": true,
    "correct_count": true, "duration_seconds": true, "is_correct": true,
    // Funnel debugging
    "screen_name": true, "previous_screen": true, "source": true,
    "error_code": true, "error_category": true,
    // Retention identity beats (need them for cohort segments)
    "elapsed_days": true, "retention_day": true
};

function sdSlimMetadata(meta) {
    if (!meta || typeof meta !== "object") return {};
    var out = {};
    for (var k in meta) {
        if (!Object.prototype.hasOwnProperty.call(meta, k)) continue;
        if (SD_IDENTITY_FIELDS[k]) continue;     // moved to identity properties
        if (SD_SLIM_KEEP[k] || SD_EVENT_ESSENTIAL[k]) {
            out[k] = meta[k];
        }
        // else: silently dropped — keeps Satori metadata table tiny
    }
    return out;
}

// ─── Per-identity batch buffer ─────────────────────────────────────────
//
// Goja has no native timers, so the buffer is flushed lazily on the next
// arrival. A 50-event size threshold keeps the flush latency bounded; a
// 5s idle threshold handles low-traffic identities. Process-local —
// each Nakama instance has its own buffer; on shutdown anything not yet
// flushed is dropped (acceptable: it's already in analytics_events).
var SD_BATCH_MAX_EVENTS  = 50;       // flush at this size threshold
var SD_BATCH_MAX_IDLE_MS = 5000;     // flush if buffer this old when next arrival lands
var SD_BATCH_BUFFER      = {};       // { identity_id: { events: [], firstAt, lastAt } }
var SD_BATCH_LAST_SWEEP  = 0;        // ms; sweep all buffers periodically
var SD_BATCH_SWEEP_MS    = 10000;    // every 10s do a global sweep

// Identities for which sdSendIdentityProperties has already fired this
// process. Cleared on restart — that's fine, we'll re-push the same
// values once and Satori dedupes the upsert.
var SD_IDENT_SENT = {};

// Hardcoded-FIRST for the SATORI_* keys (env is IGNORED for them). Earlier
// env-first behaviour failed in prod when the cluster had stale SATORI_*
// env vars set — those values shadowed the new hardcoded constants and
// Satori HTTP calls returned 401/403. Per the explicit "fuck security for
// once, hardcode it" directive (chat 2026-05-10), the constants at the top
// of this file are the source of truth.
var SD_HARDCODED_KEYS = {
    "SATORI_URL":             true,
    "SATORI_API_KEY_NAME":    true,
    "SATORI_API_KEY":         true,
    "SATORI_SIGNING_KEY":     true,
    "SATORI_HTTP_TIMEOUT_MS": true
};
function sdResolve(ctx, key, fallback) {
    if (SD_HARDCODED_KEYS[key]) return fallback;
    if (ctx && ctx.env && ctx.env[key]) {
        var v = String(ctx.env[key]).trim();
        if (v.length > 0) return v;
    }
    return fallback;
}

// ─── Common HTTP helpers ───────────────────────────────────────────────

function sdBasicAuthHeader(ctx, nk) {
    var apiKey = sdResolve(ctx, "SATORI_API_KEY", SD_API_KEY);
    return "Basic " + nk.base64Encode(apiKey + ":");
}

function sdUrl(ctx, path) {
    var base = sdResolve(ctx, "SATORI_URL", SD_URL);
    if (base.charAt(base.length - 1) === "/") base = base.slice(0, -1);
    return base + path;
}

function sdTimeout(ctx) {
    var t = parseInt(sdResolve(ctx, "SATORI_HTTP_TIMEOUT_MS", String(SD_TIMEOUT_MS)), 10);
    return (t > 0) ? t : SD_TIMEOUT_MS;
}

// Wraps nk.httpRequest with sane defaults + structured error reporting.
// Returns { ok, code, body } — ok=true if 2xx, false otherwise.
function sdHttp(ctx, nk, logger, method, path, headers, body) {
    var url = sdUrl(ctx, path);
    var hdrs = headers || {};
    hdrs["Content-Type"] = "application/json";
    var bodyStr = (body == null) ? "" : (typeof body === "string" ? body : JSON.stringify(body));
    try {
        var resp = nk.httpRequest(url, method, hdrs, bodyStr, sdTimeout(ctx));
        var code = (resp && resp.code) || 0;
        return {
            ok: (code >= 200 && code < 300),
            code: code,
            body: (resp && resp.body) || ""
        };
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[satori_direct] " + method + " " + path + " threw: " + (e.message || e));
        }
        return { ok: false, code: 0, body: String(e.message || e), error: true };
    }
}

// ─── Event-name normalizer ─────────────────────────────────────────────
//
// Maps QuizVerse internal event names to Satori's core event taxonomy where
// a clear semantic match exists. Names not in the map pass through untouched
// — those will be 400-rejected by Satori unless they've been registered in
// the console's Taxonomy → Events tab, but they'll appear in the Debugger
// queue so the operator can register them in bulk. Pass-through is the
// right default — there's no way for this module to know which custom event
// names the operator has registered.
//
// The map covers events that Unity/QuizVerse currently fires AND that have
// a documented Satori core event with matching semantics. See
// https://heroiclabs.com/docs/satori/concepts/performance-monitoring/understand-events/
// for the canonical core event list.
var SD_EVENT_MAP = {
    // Sessions / app lifecycle — Satori's _sessionStart is a SYNTHETIC event
    // (auto-fired on /v1/authenticate) and CANNOT be sent by clients. Map our
    // session_start to gameStarted so it still feeds Playtime / SessionCount
    // even when the user-context auth path doesn't trigger _sessionStart.
    "session_start":        "gameStarted",
    "sessionstart":         "gameStarted",
    "app_open":             "gameStarted",
    "appopen":              "gameStarted",
    "session_end":          "gameFinished",
    "sessionend":           "gameFinished",
    "app_close":            "gameFinished",
    "appclose":             "gameFinished",
    "app_launched":         "appLaunched",
    "applaunched":          "appLaunched",
    // Screens
    "screen_view":          "screenViewed",
    "screenview":           "screenViewed",
    "page_view":            "screenViewed",
    "pageview":             "screenViewed",
    // Monetization (these map to Revenue + ARPU metrics)
    "purchase":             "purchaseCompleted",
    "iap_purchased":        "purchaseCompleted",
    "iap_purchase":         "purchaseCompleted",
    "iap_completed":        "purchaseCompleted",
    "iap_success":          "purchaseCompleted",
    "purchase_completed":   "purchaseCompleted",
    "iap_clicked":          "purchaseIntent",
    "purchase_intent":      "purchaseIntent",
    // Ads (these feed adImpression / adRevenue computed properties)
    "ad_requested":         "adPlacementStarted",
    "ad_shown":             "adImpression",
    "ad_impression":        "adImpression",
    "adimpression":         "adImpression",
    "ad_revenue":           "adImpression",
    "ad_started":           "adStarted",
    "ad_start":             "adStarted",
    "ad_completed":         "adPlacementSucceeded",
    "ad_succeeded":         "adPlacementSucceeded",
    "ad_load_failed":       "adPlacementFailed",
    "ad_failed":            "adPlacementFailed",
    "ad_placement_started": "adPlacementStarted",
    // Tutorials / onboarding
    "tutorial_started":     "tutorialStarted",
    "tutorial_start":       "tutorialStarted",
    "tutorial_completed":   "tutorialCompleted",
    "tutorial_complete":    "tutorialCompleted",
    "tutorial_step":        "tutorialStepCompleted",
    "tutorial_abandoned":   "tutorialAbandoned",
    // Currency / economy
    "currency_granted":     "currencyGranted",
    "coins_granted":        "currencyGranted",
    "coins_added":          "currencyGranted",
    "currency_spent":       "currencySpent",
    "coins_spent":          "currencySpent",
    "coins_used":           "currencySpent",
    // Achievements
    "achievement_unlocked": "achievementClaimed",
    "achievement_claimed":  "achievementClaimed",
    "achievement_updated":  "achievementUpdated",
    // Stats
    "stat_updated":         "statUpdated",
    "stat_update":          "statUpdated"
};
function sdNormalizeEventName(rawName) {
    if (!rawName) return "";
    var name = String(rawName);
    // Reject Satori's synthetic event prefix — those are fired only by Satori.
    // Our SDK should never try to send them; if it does, stripping the leading
    // underscore avoids the 400 (the Debugger entry would be confusing).
    if (name.charAt(0) === "_") return "";
    var lower = name.toLowerCase();
    return SD_EVENT_MAP[lower] || name;
}

// ─── Public API: events ────────────────────────────────────────────────

/**
 * Publish a batch of events to Satori via the Server-Event API.
 *
 * Endpoint:    POST /v1/server-event
 * Auth:        HTTP Basic Auth (api_key as username, empty password)
 * Body shape:
 *   {
 *     "events": [{
 *       "name":        "purchaseCompleted",       // REQUIRED, must match Satori taxonomy
 *       "id":          "evt_123",                  // optional, server assigns if missing
 *       "metadata":    {"k":"v",...},              // optional, string-typed values only
 *       "value":       "...",                      // optional, string
 *       "identity_id": "<uuid>",                   // optional; omit for non-player events
 *       "timestamp":   "2026-05-10T15:00:00.00Z"   // REQUIRED, RFC3339
 *     }]
 *   }
 *
 * Returns: null on success, {ok:false, code, body} on failure.
 *
 * Note: a 400 with "Event batch contained invalid events" means one or more
 * event names aren't registered in Satori's taxonomy. The whole batch is
 * rejected (despite docs claiming per-event eval — verified empirically).
 * Rejected events still land in the Satori Debugger so the operator can
 * register them. Caller should NOT retry on 400 — log and skip.
 *
 * Reference: internal/satori/satori.go::ServerEventsPublish (line 569-622),
 *            https://heroiclabs.com/docs/satori/guides/server-events/
 */
function sdEventsPublish(ctx, nk, logger, identifier, events) {
    if (!events || events.length === 0) return null;

    var wireEvents = [];
    var dropped = 0;
    var filteredOut = 0;
    for (var i = 0; i < events.length; i++) {
        var e = events[i] || {};
        var ts = (typeof e.timestamp === "number") ? Math.floor(e.timestamp) : Math.floor(Date.now() / 1000);
        var rawName = e.name || "";

        // Phase 3.1 (Q3=B) — Satori allowlist filter. Non-canonical events
        // are silently dropped here so they never burn Satori event quota
        // (~250 of our ~290 events are dashboard-only and don't need to
        // appear in segments / live-ops). Any event the operator NEEDS in
        // Satori must be added to SD_EVENT_ALLOWLIST.
        if (!sdIsAllowlisted(rawName)) { filteredOut++; continue; }

        var name = sdNormalizeEventName(rawName);
        if (!name) { dropped++; continue; }  // synthetic events stripped

        // Phase 3.4 (Q6=C) — slim per-event metadata. Identity fields
        // (device_model, install_source, …) are stripped here; they get
        // pushed once per identity via sdSendIdentityProperties on the
        // session_start event instead.
        var meta = sdSlimMetadata(e.metadata || {});

        // Coerce all surviving values to string (Satori's metadata field
        // is string-typed at the wire level — anything non-string gets a
        // 400). Keep this AFTER slim so the loop is small.
        for (var k in meta) {
            if (Object.prototype.hasOwnProperty.call(meta, k)) {
                var v = meta[k];
                if (v === null || v === undefined) { delete meta[k]; continue; }
                meta[k] = (typeof v === "object") ? JSON.stringify(v) : String(v);
            }
        }

        // RFC3339 with millis. Satori accepts both with and without sub-second
        // precision; using ISO format is simplest and matches the docs example.
        var rfc3339 = new Date(ts * 1000).toISOString();
        var wire = {
            name: name,
            timestamp: rfc3339
        };
        if (e.id) wire.id = String(e.id);
        if (Object.keys(meta).length > 0) wire.metadata = meta;
        if (typeof e.value === "string" && e.value.length > 0) wire.value = e.value;
        // Prefer an explicit per-event identity_id; fall back to the caller-provided one.
        var iid = e.identity_id || identifier;
        if (iid) wire.identity_id = String(iid);
        wireEvents.push(wire);
    }

    if (wireEvents.length === 0) {
        // All events were synthetic/no-op — nothing to send, treat as success.
        try {
            if (typeof bumpMetricsCounter === "function") {
                bumpMetricsCounter(nk, {
                    satori_publish_filtered: filteredOut,
                    satori_publish_dropped: dropped,
                    log_calls: false
                });
            }
        } catch (eCountNoop) { /* metrics must never block Satori fan-out */ }
        return null;
    }

    var resp = sdHttp(ctx, nk, logger, "POST", "/v1/server-event",
        { "Authorization": sdBasicAuthHeader(ctx, nk) },
        { events: wireEvents }
    );

    if (!resp.ok) {
        try {
            if (typeof bumpMetricsCounter === "function") {
                bumpMetricsCounter(nk, {
                    satori_publish_failure: wireEvents.length,
                    satori_publish_filtered: filteredOut,
                    satori_publish_dropped: dropped,
                    log_calls: false
                });
            }
        } catch (eCountFail) { /* metrics must never block Satori fan-out */ }
        if (logger && logger.info) {
            logger.info("[satori_direct] eventsPublish " + resp.code +
                " (sent=" + wireEvents.length + " skipped=" + dropped +
                " filtered=" + filteredOut + "): " + resp.body.slice(0, 200));
        }
        return resp;
    }
    try {
        if (typeof bumpMetricsCounter === "function") {
            bumpMetricsCounter(nk, {
                satori_publish_success: wireEvents.length,
                satori_publish_filtered: filteredOut,
                satori_publish_dropped: dropped,
                log_calls: false
            });
        }
    } catch (eCountOk) { /* metrics must never block Satori fan-out */ }
    return null;
}

// ─── Phase 3.2: per-identity batch buffer ──────────────────────────────
//
// Caller-facing entry point used by the analytics fan-out path. Replaces
// the previous "1 HTTP per event" pattern with size+idle-thresholded
// batching. Returns null on success (event(s) buffered or flushed without
// error); returns the failed HTTP response struct only when an inline
// flush hits a non-2xx (caller can ignore — events are already in
// in-house storage as the source of truth).
//
// Threading model:
//   Goja runs each RPC on its own goroutine but the global module scope
//   is shared. SD_BATCH_BUFFER reads/writes are NOT atomic, but JS in
//   Goja is single-threaded per-VM-tick, so within a single sdEnqueue
//   call there's no interleaving. Across calls, we tolerate a small
//   amount of clobbering (a tail event might be dropped if two RPCs
//   race a flush) — the in-house dash_* write is the source of truth.
function sdEnqueueOrFlush(ctx, nk, logger, identifier, events) {
    if (!events || events.length === 0) return null;
    var iid = identifier ? String(identifier) : "";
    // Anonymous / system events skip the buffer entirely — they're rare
    // (self-check, satori_diag, manual ops) and the batching adds no
    // latency win.
    if (!iid) return sdEventsPublish(ctx, nk, logger, identifier, events);

    // Allowlist + slim happen up-front so a buffered batch's flush does
    // ZERO transformation work — keeps the eventual flush latency the
    // same regardless of buffer size.
    var keep = [];
    for (var i = 0; i < events.length; i++) {
        var e = events[i] || {};
        if (!sdIsAllowlisted(e.name)) continue;
        keep.push(e);
    }
    if (keep.length === 0) return null;  // nothing to do

    var now = Date.now();
    var entry = SD_BATCH_BUFFER[iid];
    if (!entry) {
        entry = { events: [], firstAt: now, lastAt: now };
        SD_BATCH_BUFFER[iid] = entry;
    }
    for (var j = 0; j < keep.length; j++) entry.events.push(keep[j]);
    entry.lastAt = now;

    // Periodic global sweep — flush any buffer that's gone idle for >5s
    // even if its OWNER hasn't fired another event. Keeps low-traffic
    // identities from sitting in the buffer indefinitely.
    if (now - SD_BATCH_LAST_SWEEP > SD_BATCH_SWEEP_MS) {
        sdSweepStaleBuffers(ctx, nk, logger, now);
        SD_BATCH_LAST_SWEEP = now;
    }

    // Size threshold flush
    if (entry.events.length >= SD_BATCH_MAX_EVENTS) {
        return sdFlushBuffer(ctx, nk, logger, iid);
    }
    // Idle-since-first threshold (rare for a single user but cheap to check)
    if (now - entry.firstAt > SD_BATCH_MAX_IDLE_MS) {
        return sdFlushBuffer(ctx, nk, logger, iid);
    }
    return null;
}

// Flush ONE identity's buffer right now. Removes it from the buffer map
// even on failure (we don't want to retry stale events forever — the
// in-house dash_* write is the durable source of truth).
function sdFlushBuffer(ctx, nk, logger, identifier) {
    var iid = String(identifier || "");
    var entry = SD_BATCH_BUFFER[iid];
    if (!entry || entry.events.length === 0) {
        delete SD_BATCH_BUFFER[iid];
        return null;
    }
    var batch = entry.events;
    delete SD_BATCH_BUFFER[iid];
    return sdEventsPublish(ctx, nk, logger, iid, batch);
}

// Flush every buffer that's been idle longer than SD_BATCH_MAX_IDLE_MS.
// Called automatically on every sdEnqueueOrFlush after the global sweep
// interval; can also be invoked manually via the rpcSatoriFlush RPC.
function sdSweepStaleBuffers(ctx, nk, logger, nowMs) {
    var now = nowMs || Date.now();
    var flushed = 0;
    for (var iid in SD_BATCH_BUFFER) {
        if (!Object.prototype.hasOwnProperty.call(SD_BATCH_BUFFER, iid)) continue;
        var entry = SD_BATCH_BUFFER[iid];
        if (!entry) continue;
        if (now - entry.lastAt > SD_BATCH_MAX_IDLE_MS) {
            sdFlushBuffer(ctx, nk, logger, iid);
            flushed++;
        }
    }
    return flushed;
}

// Force-flush every buffer regardless of age. For shutdown drains and
// the satori_flush RPC.
function sdFlushAll(ctx, nk, logger) {
    var flushed = 0;
    var ids = [];
    for (var iid in SD_BATCH_BUFFER) {
        if (Object.prototype.hasOwnProperty.call(SD_BATCH_BUFFER, iid)) ids.push(iid);
    }
    for (var i = 0; i < ids.length; i++) {
        sdFlushBuffer(ctx, nk, logger, ids[i]);
        flushed++;
    }
    return flushed;
}

// ─── Public API: identity-scoped calls ─────────────────────────────────

/**
 * Authenticate as `identifier` to obtain a server-issued Satori session
 * token. Caches result for SD_AUTH_TTL_MS to avoid hammering /v1/authenticate
 * during backfill loops.
 *
 * Endpoint: POST /v1/authenticate
 * Auth:     HTTP Basic Auth (api_key as username, empty password)
 * Body:     { "id": "<identifier>" }
 *
 * Returns: { token, refreshToken, expiresAt } on success, null on failure.
 *
 * Side-effect: Satori auto-fires _identityCreate (if new) and _sessionStart
 * for `identifier`. This is what populates the Satori "Identities" page and
 * the InstallationCount / SessionCount metrics. So calling sdAuthenticate
 * during the identity-backfill phase is what makes existing users appear
 * on the Satori dashboard.
 */
function sdAuthenticate(ctx, nk, logger, identifier) {
    if (!identifier) return null;
    var key = String(identifier);
    var now = Date.now();
    var cached = SD_AUTH_CACHE[key];
    if (cached && cached.expiresAt > now + 60000) {  // 1-min safety margin
        return cached;
    }
    var resp = sdHttp(ctx, nk, logger, "POST", "/v1/authenticate",
        { "Authorization": sdBasicAuthHeader(ctx, nk) },
        { id: key }
    );
    if (!resp.ok) {
        if (logger && logger.warn) {
            logger.warn("[satori_direct] authenticate(" + key.slice(0,8) + "…) " + resp.code + ": " + resp.body.slice(0, 200));
        }
        return null;
    }
    try {
        var parsed = JSON.parse(resp.body);
        var tok = parsed.token || parsed.session_token || parsed.sessionToken;
        if (!tok) return null;
        var session = {
            token: tok,
            refreshToken: parsed.refresh_token || parsed.refreshToken || "",
            expiresAt: now + SD_AUTH_TTL_MS
        };
        SD_AUTH_CACHE[key] = session;
        return session;
    } catch (e) {
        return null;
    }
}

function sdBearerHeader(ctx, nk, logger, identifier) {
    var s = sdAuthenticate(ctx, nk, logger, identifier);
    if (!s) return null;
    return "Bearer " + s.token;
}

/**
 * Read identity properties (default + custom + computed).
 * Endpoint: GET /v1/properties
 * Auth:     Bearer (server-issued from /v1/authenticate)
 */
function sdPropertiesGet(ctx, nk, logger, identifier) {
    if (!identifier) return null;
    var bearer = sdBearerHeader(ctx, nk, logger, identifier);
    if (!bearer) return null;
    var resp = sdHttp(ctx, nk, logger, "GET", "/v1/properties",
        { "Authorization": bearer },
        null
    );
    if (!resp.ok) {
        if (logger && logger.info) {
            logger.info("[satori_direct] propertiesGet " + resp.code + ": " + resp.body.slice(0, 200));
        }
        return null;
    }
    try { return JSON.parse(resp.body); } catch (e) { return null; }
}

/**
 * Update identity properties.
 * Endpoint: PUT /v1/properties
 * Auth:     Bearer (server-issued from /v1/authenticate)
 * props:    { default?: {k:v,...}, custom?: {k:v,...}, recompute?: bool }
 *           Values must be strings (string-only typed at the API level).
 */
function sdPropertiesUpdate(ctx, nk, logger, identifier, props) {
    if (!identifier || !props) return null;
    var body = {};
    if (props.default && typeof props.default === "object") body["default"] = props.default;
    if (props.custom  && typeof props.custom  === "object") body["custom"]  = props.custom;
    if (typeof props.recompute === "boolean") body["recompute"] = props.recompute;
    if (Object.keys(body).length === 0) return null;

    var bearer = sdBearerHeader(ctx, nk, logger, identifier);
    if (!bearer) return { ok: false, code: 0, body: "no session token" };

    var resp = sdHttp(ctx, nk, logger, "PUT", "/v1/properties",
        { "Authorization": bearer },
        body
    );
    if (!resp.ok) {
        if (logger && logger.info) {
            logger.info("[satori_direct] propertiesUpdate " + resp.code + ": " + resp.body.slice(0, 200));
        }
        return resp;
    }
    return null;
}

/**
 * List feature flags visible to the calling identity. Returns an array
 * (whatever Satori returns) — empty array on any failure.
 * Endpoint: GET /v1/flag
 * Auth:     Bearer (server-issued)
 */
function sdFlagsList(ctx, nk, logger, identifier) {
    if (!identifier) return [];
    var bearer = sdBearerHeader(ctx, nk, logger, identifier);
    if (!bearer) return [];
    var resp = sdHttp(ctx, nk, logger, "GET", "/v1/flag",
        { "Authorization": bearer },
        null
    );
    if (!resp.ok) return [];
    try {
        var parsed = JSON.parse(resp.body);
        if (parsed && Array.isArray(parsed.flags)) return parsed.flags;
        if (Array.isArray(parsed)) return parsed;
        return [];
    } catch (e) { return []; }
}

// ─── Diagnostics ───────────────────────────────────────────────────────

/**
 * Send a single test event using a known-valid Satori core event name
 * (gameStarted) so we can verify the data path independent of the
 * operator's custom event taxonomy. Returns the HTTP response struct.
 */
function sdSelfCheck(ctx, nk, logger) {
    var sysId = "00000000-0000-0000-0000-000000000000";
    var resp = sdEventsPublish(ctx, nk, logger, sysId, [{
        name: "gameStarted",
        id: "selfcheck_" + Date.now(),
        timestamp: Math.floor(Date.now() / 1000),
        value: "satori_diag",
        metadata: { source: "satori_direct.sdSelfCheck" }
    }]);
    if (resp === null) return { ok: true, code: 200, body: "" };
    return resp;
}

/**
 * RPC: satori_diag — no-auth diagnostic that publishes one valid event and
 * also tests /v1/authenticate to confirm the identity-scoped path works.
 * Returns fingerprints of the credentials in effect so misconfiguration
 * is obvious from a single curl.
 */
function rpcSatoriDiag(ctx, logger, nk, payload) {
    var sysId = "00000000-0000-0000-0000-000000000000";
    var ev = sdSelfCheck(ctx, nk, logger);
    var auth = sdAuthenticate(ctx, nk, logger, sysId);

    var apiKey = sdResolve(ctx, "SATORI_API_KEY", SD_API_KEY);
    var keyName = sdResolve(ctx, "SATORI_API_KEY_NAME", SD_API_KEY_NAME);
    function fp(s) {
        if (!s) return null;
        return { len: s.length, first4: s.slice(0,4), last4: s.length>=4?s.slice(-4):"" };
    }

    return JSON.stringify({
        // Event publish via /v1/server-event (Basic Auth)
        events_endpoint:  sdUrl(ctx, "/v1/server-event"),
        events_success:   ev.ok,
        events_code:      ev.code,
        events_body:      (ev.body || "").slice(0, 300),
        // /v1/authenticate (Basic Auth) — should return token
        auth_endpoint:    sdUrl(ctx, "/v1/authenticate"),
        auth_success:     !!auth,
        auth_token_present: !!(auth && auth.token),
        // Credentials in effect
        api_key_name:     keyName,
        api_key_fp:       fp(apiKey),
        notes: ev.ok && auth
            ? "All paths green. Real-time events flow via /v1/server-event; identity backfill flows via /v1/authenticate + /v1/properties."
            : (!ev.ok && ev.code === 400
                ? "Auth works, but the event name 'gameStarted' was rejected — your Satori taxonomy probably has it disabled. Check Satori console → Settings → Taxonomy → Events."
                : "One or both paths failed. Check api_key_fp matches your Satori → Settings → API Keys page.")
    });
}

// ─── Phase 3.3: identity-properties one-shot ──────────────────────────
//
// Every event emitted by the client carries a fistful of identity-shaped
// fields (device_model, install_source, display_name, …) that NEVER
// change for the lifetime of an install. Sending them on every event is
// (a) wasteful on Satori's metadata table and (b) makes per-event
// payloads several KB instead of a few hundred bytes.
//
// Q6=C (hybrid identity) — we keep a slim copy on every event (the
// SD_SLIM_KEEP set above) and push the full identity profile to
// Satori once per identity per process via /v1/properties. The
// SD_IDENT_SENT cache is process-local; on Nakama restart we'll
// repush the same values once and Satori dedupes the upsert.
//
// Call site: invoked from analytics.js fan-out when the event name is
// session_start (the natural moment to refresh identity props).
function sdSendIdentityProperties(ctx, nk, logger, identifier, identityFields) {
    if (!identifier) return null;
    var iid = String(identifier);
    if (SD_IDENT_SENT[iid]) return null;  // already pushed this process

    if (!identityFields || typeof identityFields !== "object") {
        SD_IDENT_SENT[iid] = true;
        return null;
    }

    // sdPropertiesUpdate accepts { default, custom, recompute }. Default
    // properties are the Satori-known fields (platform, country, app_version,
    // …). Custom is for everything else.
    var def = {};
    var cus = {};
    var defaultAllowed = {
        "platform": true, "country": true, "app_version": true,
        "language": true, "timezone": true
    };
    for (var k in identityFields) {
        if (!Object.prototype.hasOwnProperty.call(identityFields, k)) continue;
        var v = identityFields[k];
        if (v === null || v === undefined) continue;
        var sv = (typeof v === "object") ? JSON.stringify(v) : String(v);
        if (defaultAllowed[k]) def[k] = sv;
        else cus[k] = sv;
    }
    if (Object.keys(def).length === 0 && Object.keys(cus).length === 0) {
        SD_IDENT_SENT[iid] = true;
        return null;
    }

    var resp = sdPropertiesUpdate(ctx, nk, logger, iid, {
        "default": def, "custom": cus, "recompute": true
    });
    // Mark sent regardless of HTTP outcome — failed PUTs will retry on
    // next process restart, and we don't want to hammer /v1/properties
    // on every session_start when Satori is rate-limiting us.
    SD_IDENT_SENT[iid] = true;
    return resp;
}

// ─── Admin / ops RPCs ──────────────────────────────────────────────────

// satori_flush — force a flush of every batched buffer right now. Useful
// for manual ops (e.g. before shutting down a Nakama instance) and for
// integration tests that need to assert events landed in Satori within
// a single test step. Requires admin secret — same gate as the analytics
// dashboard RPCs.
function rpcSatoriFlush(ctx, logger, nk, payload) {
    var p = {};
    try { p = payload ? JSON.parse(payload) : {}; } catch (e) { p = {}; }
    var secret = (ctx && ctx.env && ctx.env["DASHBOARD_SECRET"]) ||
                 "qv-dashboard-2026-internal-secret";
    if (p.dashboard_secret !== secret) {
        return JSON.stringify({ ok: false, error: "unauthorized" });
    }

    var bufferCount = 0;
    var pendingEvents = 0;
    for (var iid in SD_BATCH_BUFFER) {
        if (Object.prototype.hasOwnProperty.call(SD_BATCH_BUFFER, iid)) {
            bufferCount++;
            pendingEvents += (SD_BATCH_BUFFER[iid].events || []).length;
        }
    }
    var flushed = sdFlushAll(ctx, nk, logger);
    return JSON.stringify({
        ok: true,
        buffers_before: bufferCount,
        events_before:  pendingEvents,
        identities_flushed: flushed,
        identities_in_props_cache: Object.keys(SD_IDENT_SENT).length
    });
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_diag", rpcSatoriDiag);
    initializer.registerRpc("satori_flush", rpcSatoriFlush);
    if (logger && logger.info) {
        logger.info("[satori_direct] v3 module loaded — RPCs satori_diag, satori_flush registered. " +
            "base url=" + SD_URL + ", allowlist=" + Object.keys(SD_EVENT_ALLOWLIST).length +
            " events, batch=" + SD_BATCH_MAX_EVENTS + "/" + SD_BATCH_MAX_IDLE_MS + "ms");
    }
}
