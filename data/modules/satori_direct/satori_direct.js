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
    "iap_purchase":         "purchaseCompleted",
    "iap_completed":        "purchaseCompleted",
    "iap_success":          "purchaseCompleted",
    "purchase_completed":   "purchaseCompleted",
    "purchase_intent":      "purchaseIntent",
    // Ads (these feed adImpression / adRevenue computed properties)
    "ad_impression":        "adImpression",
    "adimpression":         "adImpression",
    "ad_started":           "adStarted",
    "ad_start":             "adStarted",
    "ad_completed":         "adPlacementSucceeded",
    "ad_succeeded":         "adPlacementSucceeded",
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
    for (var i = 0; i < events.length; i++) {
        var e = events[i] || {};
        var ts = (typeof e.timestamp === "number") ? Math.floor(e.timestamp) : Math.floor(Date.now() / 1000);
        var rawName = e.name || "";
        var name = sdNormalizeEventName(rawName);
        if (!name) { dropped++; continue; }  // synthetic events stripped

        var meta = {};
        if (e.metadata && typeof e.metadata === "object") {
            for (var k in e.metadata) {
                if (Object.prototype.hasOwnProperty.call(e.metadata, k)) {
                    var v = e.metadata[k];
                    if (v === null || v === undefined) continue;
                    meta[k] = (typeof v === "object") ? JSON.stringify(v) : String(v);
                }
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
        return null;
    }

    var resp = sdHttp(ctx, nk, logger, "POST", "/v1/server-event",
        { "Authorization": sdBasicAuthHeader(ctx, nk) },
        { events: wireEvents }
    );

    if (!resp.ok) {
        if (logger && logger.info) {
            logger.info("[satori_direct] eventsPublish " + resp.code + " (sent=" + wireEvents.length +
                " skipped=" + dropped + "): " + resp.body.slice(0, 200));
        }
        return resp;
    }
    return null;
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

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_diag", rpcSatoriDiag);
    if (logger && logger.info) {
        logger.info("[satori_direct] v2 module loaded — RPC satori_diag registered, base url=" + SD_URL +
            " (events→/v1/server-event Basic Auth, identity→/v1/authenticate→Bearer)");
    }
}
