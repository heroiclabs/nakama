// satori_compat.js — Unity client compatibility shim for Satori RPCs.
//
// The Unity QuizVerse client (Assets/_QuizVerse/Scripts/Analytics/Satori/) calls
// these RPC names directly:
//   - satori_event                       (single event from CaptureEventAsync)
//   - satori_events_batch                (buffered batch from FlushAsync)
//   - satori_identity_get                (GetIdentityAsync)
//   - satori_identity_update_properties  (UpdateIdentityPropertiesAsync)
//   - satori_flags_get_all               (FeatureFlagService.FetchFromServer)
//
// Without these handlers registered, every Unity SatoriService.* call returns
// "RPC not found" and spams the Nakama logs. Two strategies for events:
//
//   A. Forward each satori_event call straight to nk.getSatori().eventsPublish.
//   B. No-op the event RPCs and rely on the analytics_log_event fan-out
//      (analytics.js::persistNormalizedEvent already publishes to Satori).
//
// We pick (B) because Unity AnalyticsManager already triple-routes every event
// (Firebase + analytics_log_event + satori_event). Strategy (A) would mean
// every event reaches Satori TWICE (once from analytics_log_event's fan-out,
// once from satori_event). That doubles billing on Heroic Labs Satori and
// inflates DAU charts. Strategy (B) keeps a single source of truth.
//
// Identity + flags ARE forwarded to Satori cloud — those are pure client-init
// signals (device tier, network type, feature flag fetch) that don't flow
// through analytics_log_event.

var SC_SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

function scParse(payload) {
    try { return JSON.parse(payload || "{}"); } catch (e) { return {}; }
}
function scOk(data) {
    var out = { success: true };
    if (data) { for (var k in data) { if (data.hasOwnProperty(k)) out[k] = data[k]; } }
    return JSON.stringify(out);
}
function scErr(msg, code) {
    return JSON.stringify({ success: false, error: msg || "error", code: code || 400 });
}
// satori_direct.js exposes hardcoded-creds helpers (sdPropertiesGet,
// sdPropertiesUpdate, sdFlagsList) that bypass nk.getSatori() entirely. We
// just check that the global symbol exists once postbuild has bundled all
// modules together.
function scSatoriAvailable() {
    return (typeof sdPropertiesGet === "function");
}

// ─── Event handlers (no-op, single source of truth via analytics_log_event) ─

/**
 * RPC: satori_event — Unity's CaptureEventAsync calls this for "send-now"
 * events that bypass the SatoriService internal buffer.
 *
 * Acknowledged with success=true so the Unity client doesn't re-buffer or
 * spam logs. The event itself is NOT pushed to Satori from here — the same
 * AnalyticsManager.Track() call that fired this RPC also fired
 * analytics_log_event, which goes through persistNormalizedEvent's Satori
 * fan-out. One write, not two.
 */
function rpcSatoriEvent(ctx, logger, nk, payload) {
    return scOk({ captured: 1, deduplicated: true, source: "analytics_log_event" });
}

/**
 * RPC: satori_events_batch — Unity's FlushAsync calls this with the buffered
 * event list. Same rationale as rpcSatoriEvent: events already flow via
 * analytics_log_event so this is a noop ack to keep the client happy.
 *
 * Returns `captured = events.length` because Unity's response parser
 * (SatoriBatchResponse.captured) expects a numeric count and treats anything
 * less than the input length as a partial failure that triggers re-buffering.
 */
function rpcSatoriEventsBatch(ctx, logger, nk, payload) {
    var data = scParse(payload);
    var n = (Array.isArray(data.events)) ? data.events.length : 0;
    return scOk({ captured: n, deduplicated: true, source: "analytics_log_event" });
}

// ─── Identity handlers (real, forwarded to Satori) ─────────────────────────

/**
 * RPC: satori_identity_get
 *
 * Returns the Satori identity record for the calling user — properties +
 * computed fields the live-ops team has attached to the player. The Unity
 * client uses this for cohort gating and personalisation.
 */
function rpcSatoriIdentityGet(ctx, logger, nk, payload) {
    if (!ctx.userId) return scErr("not authenticated", 401);
    if (!scSatoriAvailable()) return scOk({ identity: null, satori_disabled: true });

    try {
        // sdPropertiesGet returns { default, custom, computed } from Satori
        // (or null on any HTTP failure — already logged at INFO level).
        var props = sdPropertiesGet(ctx, nk, logger, ctx.userId);
        return scOk({ identity: props || null });
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[satori_compat] sdPropertiesGet threw: " + (e.message || e));
        }
        return scOk({ identity: null, error: String(e.message || e) });
    }
}

/**
 * RPC: satori_identity_update_properties
 *
 * Sets custom properties on the calling user's Satori identity. Unity sends
 * stable client-only signals here (device_tier, network_type, etc.) that
 * Satori uses for cohort filters in the dashboard.
 */
function rpcSatoriIdentityUpdate(ctx, logger, nk, payload) {
    if (!ctx.userId) return scErr("not authenticated", 401);
    var data = scParse(payload);
    var props = data.properties || {};
    if (!props || typeof props !== "object" || Array.isArray(props)) {
        return scErr("properties must be an object", 400);
    }
    if (!scSatoriAvailable()) return scOk({ updated: 0, satori_disabled: true });

    // Coerce all values to strings — Satori identity properties are typed
    // string-only at the API level.
    var customProps = {};
    var n = 0;
    for (var k in props) {
        if (Object.prototype.hasOwnProperty.call(props, k)) {
            var v = props[k];
            if (v === null || v === undefined) continue;
            customProps[k] = (typeof v === "object") ? JSON.stringify(v) : String(v);
            n++;
        }
    }

    try {
        var resp = sdPropertiesUpdate(ctx, nk, logger, ctx.userId, { custom: customProps });
        if (resp && resp.ok === false) {
            return scErr("Satori responded " + resp.code + ": " + (resp.body || "").slice(0, 200), 502);
        }
        return scOk({ updated: n });
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[satori_compat] sdPropertiesUpdate threw: " + (e.message || e));
        }
        return scErr("sdPropertiesUpdate failed: " + (e.message || e), 500);
    }
}

// ─── Flag handlers (real, forwarded to Satori) ─────────────────────────────

/**
 * RPC: satori_flags_get_all
 *
 * Returns every feature flag visible to the calling user. The Unity
 * FeatureFlagService caches the result for 5 minutes (see _lastFetchTime).
 */
function rpcSatoriFlagsGetAll(ctx, logger, nk, payload) {
    if (!ctx.userId) return scErr("not authenticated", 401);
    if (!scSatoriAvailable()) return scOk({ flags: [], satori_disabled: true });

    try {
        // sdFlagsList already normalises {flags:[...]} vs [...] and returns
        // an empty array on any failure.
        var flags = sdFlagsList(ctx, nk, logger, ctx.userId);
        return scOk({ flags: flags || [] });
    } catch (e) {
        if (logger && logger.warn) {
            logger.warn("[satori_compat] sdFlagsList threw: " + (e.message || e));
        }
        return scOk({ flags: [], error: String(e.message || e) });
    }
}

// ── Module init ───────────────────────────────────────────
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_event", rpcSatoriEvent);
    initializer.registerRpc("satori_events_batch", rpcSatoriEventsBatch);
    initializer.registerRpc("satori_identity_get", rpcSatoriIdentityGet);
    initializer.registerRpc("satori_identity_update_properties", rpcSatoriIdentityUpdate);
    initializer.registerRpc("satori_flags_get_all", rpcSatoriFlagsGetAll);
    if (logger && logger.info) {
        logger.info("[satori_compat] module loaded — 5 RPCs registered");
    }
}
