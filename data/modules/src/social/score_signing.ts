// score_signing.ts — server-signed score tokens (G-013, doc §E.3 / AP-007).
//
// THE EXPLOIT THIS CLOSES: async/friend challenges accept a client-supplied
// score. Any client can send { myScore: 999999 } — the server range-checks
// but cannot know whether the score was EARNED. This module lets the quiz
// completion RPC (the only place a score is truly known) mint a short-lived
// HMAC token binding (userId, score, refId); consumers verify the token
// before trusting the number.
//
// TOKEN FORMAT:  v1.<base64(json payload)>.<hex hmac-sha256>
//   payload = { u: userId, s: score, r: refId (packId etc.), t: mintedAtMs }
//   TTL: 15 minutes (a challenge is sent right after finishing the quiz).
//
// SECRET: env SCORE_SIGNING_SECRET, falling back to TOURNAMENT_SERVICE_TOKEN
// (already present in the prod runtime env — zero new secret plumbing needed
// on day one; move to a dedicated secret when convenient).
//
// ROLLOUT (doc §19.9 — flag-first): verification is enforced only when the
// app registry feature "scoreSigning" is on for the app. Until then tokens
// are minted (clients can start attaching them) but absence is tolerated —
// no client-breaking flag-day.

namespace ScoreSigning {

  var TOKEN_TTL_MS = 15 * 60 * 1000;

  function secret(ctx: nkruntime.Context): string {
    return "" + ((ctx.env && ctx.env["SCORE_SIGNING_SECRET"]) ||
                 (ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                 (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
  }

  function toHex(buf: ArrayBuffer): string {
    var bytes = new Uint8Array(buf);
    var hex = "";
    for (var i = 0; i < bytes.length; i++) {
      var h = bytes[i].toString(16);
      hex += (h.length === 1 ? "0" : "") + h;
    }
    return hex;
  }

  function hmacHex(nk: nkruntime.Nakama, input: string, key: string): string {
    return toHex(nk.hmacSha256Hash(input, key));
  }

  // base64Decode returns an ArrayBuffer in this runtime; the payload is
  // ASCII JSON so a byte-wise charCode rebuild is lossless.
  function bufToString(buf: any): string {
    if (typeof buf === "string") return buf;
    var bytes = new Uint8Array(buf);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  /** Mint a token. Returns "" when no secret is configured (fail-open mint). */
  export function sign(ctx: nkruntime.Context, nk: nkruntime.Nakama, userId: string, score: number, refId: string): string {
    var key = secret(ctx);
    if (!key) return "";
    try {
      var body = JSON.stringify({ u: userId, s: score, r: refId || "", t: Date.now() });
      var b64 = nk.base64Encode(body);
      return "v1." + b64 + "." + hmacHex(nk, b64, key);
    } catch (_) {
      return "";
    }
  }

  export interface VerifyResult { valid: boolean; reason: string; score: number; refId: string; }

  /** Verify a token against the expected user + claimed score. */
  export function verify(ctx: nkruntime.Context, nk: nkruntime.Nakama, token: any, expectedUserId: string, claimedScore: number): VerifyResult {
    var fail = function (reason: string): VerifyResult { return { valid: false, reason: reason, score: 0, refId: "" }; };
    var key = secret(ctx);
    if (!key) return fail("signing_not_configured");
    if (!token || typeof token !== "string") return fail("missing_token");
    var parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== "v1") return fail("malformed_token");
    var expectedMac = hmacHex(nk, parts[1], key);
    // Constant-time-ish compare (Goja strings; length check + full scan).
    if (expectedMac.length !== parts[2].length) return fail("bad_signature");
    var diff = 0;
    for (var i = 0; i < expectedMac.length; i++) {
      diff |= expectedMac.charCodeAt(i) ^ parts[2].charCodeAt(i);
    }
    if (diff !== 0) return fail("bad_signature");
    var body: any;
    try { body = JSON.parse(bufToString(nk.base64Decode(parts[1]))); } catch (_) { return fail("bad_payload"); }
    if (!body || body.u !== expectedUserId) return fail("wrong_user");
    if (typeof body.t !== "number" || (Date.now() - body.t) > TOKEN_TTL_MS) return fail("token_expired");
    if (typeof claimedScore === "number" && typeof body.s === "number" && body.s !== claimedScore) return fail("score_mismatch");
    return { valid: true, reason: "", score: body.s, refId: body.r || "" };
  }
}
