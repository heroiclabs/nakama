// satori_direct.js — pure-JS Satori HTTP client.
//
// Why this exists:
//   The "official" path to Satori from JS modules is `nk.getSatori()`, which
//   returns a Go-side client backed by the --satori.url / --satori.api_key /
//   --satori.signing_key CLI flags. That requires the production Nakama
//   Deployment to be patched with those flags AND a k8s Secret holding the
//   credentials — which means a DevOps round-trip every time we want to ship.
//
//   This module bypasses all that. It calls the Satori REST API directly via
//   nk.httpRequest, mints session JWTs locally via nk.jwtGenerate, and reads
//   credentials from hardcoded constants below. As long as the JS bundle is
//   in the runtime path, Satori works — no CLI flags, no secrets in the
//   cluster, no DevOps.
//
//   The trade-off (consciously accepted, see chat 2026-05-10): credentials
//   are visible in the ECR image and the git history of this repo. Anyone
//   with read access to either can extract them.
//
// API surface (all functions return null on success, throw on hard errors):
//   sdEventsPublish(nk, logger, identifier, events) — POST /v1/event
//   sdPropertiesGet(nk, logger, identifier)         — GET  /v1/properties
//   sdPropertiesUpdate(nk, logger, identifier, props) — PUT /v1/properties
//   sdFlagsList(nk, logger, identifier)             — GET  /v1/flag
//
// Reference: internal/satori/satori.go for the canonical Go-side flow that
// this mirrors. JWT shape comes from sessionTokenClaims (line 178).

// ─── Hardcoded credentials ─────────────────────────────────────────────
//
// These are the QuizVerse Satori "dev" project. If you spin up a new Satori
// project, paste the new values here and ship a new image — no env-var or
// k8s changes needed.
var SD_URL          = "https://quizverse-satori-dev-8bf5.us-east1-b.satoricloud.io";
var SD_API_KEY_NAME = "SATORIAPIKEY";
var SD_API_KEY      = "f6554c37-e40f-490f-b730-acaf6ecabe4c";
var SD_SIGNING_KEY  = "a939cfcc-5ef2-456a-b009-cca2dcc907d2";
var SD_TIMEOUT_MS   = 2000;

// Hardcoded-FIRST for the SATORI_* keys (env is IGNORED for them).
// Earlier env-first behaviour failed in prod when the cluster had stale
// SATORI_* env vars from before — those values shadowed the new hardcoded
// constants and Satori HTTP calls returned 401/403. Per the explicit "fuck
// security for once, hardcode it" directive (chat 2026-05-10), the
// constants at the top of this file are the source of truth. To rotate,
// edit them and ship a new image. For ALL OTHER keys we still consult
// ctx.env (preserves the override path for non-Satori keys callers might
// pass through this helper).
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

// ─── JWT minting ───────────────────────────────────────────────────────
//
// Mirror of internal/satori/satori.go::generateToken (line 233-244) and
// the on-the-wire claim names from sessionTokenClaims (line 175-181):
//
//   sid (SessionID, optional)  iid (IdentityId)  exp  iat  api (ApiKeyName)
//
// CRITICAL: Satori expects the identity in the `iid` claim, NOT the
// standard `sub` claim. Using `sub` causes Satori to reject every
// Bearer-auth call with 401. Verified against satori.go:233-239.
function sdMintToken(ctx, nk, identifier) {
    var apiKeyName = sdResolve(ctx, "SATORI_API_KEY_NAME", SD_API_KEY_NAME);
    var signingKey = sdResolve(ctx, "SATORI_SIGNING_KEY", SD_SIGNING_KEY);
    var now = Math.floor(Date.now() / 1000);
    var claims = {
        iid: String(identifier || ""),
        iat: now,
        exp: now + 3600,
        api: apiKeyName
    };
    return nk.jwtGenerate("HS256", signingKey, claims);
}

// ─── Common HTTP helpers ───────────────────────────────────────────────

function sdBasicAuthHeader(ctx, nk) {
    var apiKey = sdResolve(ctx, "SATORI_API_KEY", SD_API_KEY);
    return "Basic " + nk.base64Encode(apiKey + ":");
}

function sdBearerHeader(ctx, nk, identifier) {
    return "Bearer " + sdMintToken(ctx, nk, identifier);
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
// Returns { ok, code, body } — ok=true if 2xx, ok=false otherwise.
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

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Publish a batch of events. Mirrors internal/satori/satori.go::EventsPublish
 * line 505-560.
 *
 * Wire contract (verified against the Go-side struct definitions at
 * internal/satori/satori.go:485 + vendor/.../runtime.go:1451):
 *   POST /v1/event
 *   Authorization: Bearer <jwt>   ← signed with SIGNING_KEY, sub=identifier
 *   {
 *     "events": [{
 *       "name":        "session_start",
 *       "id":          "evt_123",         // optional
 *       "metadata":    {"k":"v"},          // string-typed values only
 *       "identity_id": "<uuid>",           // optional; defaults to JWT.sub
 *       "value":       "...",              // optional, string-only
 *       "timestamp":   "2026-05-10T15:00:00Z"  // RFC3339, NOT unix int
 *     }]
 *   }
 *
 * Why RFC3339 and not int: the Go wrapper at satori.go:485 declares
 * `TimestampPb string \`json:"timestamp,omitempty"\`` which shadows the
 * embedded runtime.Event.Timestamp int64 (which has json tag `-`, never
 * serialized). setTimestamp() formats the int into RFC3339 before send.
 *
 * events param: array of {name, timestamp (unix seconds int), metadata, value, id}.
 *               We do the int→RFC3339 conversion here, mirroring satori.go:495.
 */
function sdEventsPublish(ctx, nk, logger, identifier, events) {
    if (!events || events.length === 0) return null;

    var wireEvents = [];
    for (var i = 0; i < events.length; i++) {
        var e = events[i] || {};
        var ts = (typeof e.timestamp === "number") ? Math.floor(e.timestamp) : Math.floor(Date.now() / 1000);
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
        // RFC3339 — drop millis to match time.Unix(sec, 0).Format(time.RFC3339)
        // exactly (the Go side does NOT include millis or subsecond precision).
        var rfc3339 = new Date(ts * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
        var wire = {
            name: String(e.name || "unknown"),
            timestamp: rfc3339
        };
        if (e.id) wire.id = String(e.id);
        if (Object.keys(meta).length > 0) wire.metadata = meta;
        if (typeof e.value === "string" && e.value.length > 0) wire.value = e.value;
        if (e.identity_id) wire.identity_id = String(e.identity_id);
        wireEvents.push(wire);
    }

    var resp = sdHttp(ctx, nk, logger, "POST", "/v1/event",
        { "Authorization": sdBearerHeader(ctx, nk, identifier) },
        { events: wireEvents }
    );

    if (!resp.ok) {
        if (logger && logger.info) {
            logger.info("[satori_direct] eventsPublish " + resp.code + ": " + resp.body.slice(0, 200));
        }
        // Non-fatal — the caller decides whether to retry / drop.
        return resp;
    }
    return null;
}

/**
 * Read identity properties (default + custom + computed). Bearer-auth
 * mirror of internal/satori/satori.go::PropertiesGet line 380-440.
 */
function sdPropertiesGet(ctx, nk, logger, identifier) {
    if (!identifier) return null;
    var resp = sdHttp(ctx, nk, logger, "GET", "/v1/properties",
        { "Authorization": sdBearerHeader(ctx, nk, identifier) },
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
 * Update identity properties. Bearer-auth mirror of
 * internal/satori/satori.go::PropertiesUpdate line 450-500.
 *
 * props: { default?: {k:v,...}, custom?: {k:v,...}, recompute?: bool }
 *        Values must be strings (string-only typed at the API level).
 */
function sdPropertiesUpdate(ctx, nk, logger, identifier, props) {
    if (!identifier || !props) return null;
    var body = {};
    if (props.default && typeof props.default === "object") body["default"] = props.default;
    if (props.custom  && typeof props.custom  === "object") body["custom"]  = props.custom;
    if (typeof props.recompute === "boolean") body["recompute"] = props.recompute;
    if (Object.keys(body).length === 0) return null;

    var resp = sdHttp(ctx, nk, logger, "PUT", "/v1/properties",
        { "Authorization": sdBearerHeader(ctx, nk, identifier) },
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
 * List all feature flags visible to the calling identity. Returns an array
 * of flag objects (whatever Satori returns) — empty array on any failure.
 */
function sdFlagsList(ctx, nk, logger, identifier) {
    if (!identifier) return [];
    var resp = sdHttp(ctx, nk, logger, "GET", "/v1/flag",
        { "Authorization": sdBearerHeader(ctx, nk, identifier) },
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

/**
 * Diagnostic: send a single test event and return the HTTP response so an
 * RPC can verify connectivity. Used by satori_diag (registered below).
 */
function sdSelfCheck(ctx, nk, logger) {
    var sysId = "00000000-0000-0000-0000-000000000000";
    return sdEventsPublish(ctx, nk, logger, sysId, [{
        name: "satori_direct_selfcheck",
        id: "selfcheck_" + Date.now(),
        timestamp: Math.floor(Date.now() / 1000),
        metadata: { source: "satori_direct.sdSelfCheck" }
    }]) || { ok: true, code: 200, body: "(success returns null from sdEventsPublish)" };
}

/**
 * RPC: satori_diag — admin-gated. Hits Satori with one test event and
 * returns the result (no auth/admin check up front because the user
 * specifically wants this to "just work" for verification — a bad call
 * costs Satori a single ignored event).
 */
function rpcSatoriDiag(ctx, logger, nk, payload) {
    var resp = sdSelfCheck(ctx, nk, logger);
    return JSON.stringify({
        success: resp.ok,
        code: resp.code,
        body: (resp.body || "").slice(0, 500),
        url: sdUrl(ctx, "/v1/event"),
        api_key_name: sdResolve(ctx, "SATORI_API_KEY_NAME", SD_API_KEY_NAME),
        api_key_present: !!sdResolve(ctx, "SATORI_API_KEY", SD_API_KEY),
        signing_key_present: !!sdResolve(ctx, "SATORI_SIGNING_KEY", SD_SIGNING_KEY)
    });
}

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("satori_diag", rpcSatoriDiag);
    if (logger && logger.info) {
        logger.info("[satori_direct] module loaded — RPC satori_diag registered, base url=" + SD_URL);
    }
}
