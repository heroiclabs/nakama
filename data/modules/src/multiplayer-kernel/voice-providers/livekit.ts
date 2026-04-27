// LiveKit voice provider — server-side bearer-token minter.
//
// Conforms to MpKernelVoice.ITokenMinter. Tokens are short-lived
// JWTs signed with the LiveKit api_key/api_secret. Identity is the
// IVX user_id (or 'agt_*' for agents). The room id is the IVX match_id.
//
// Configuration is loaded from Nakama runtime env:
//
//   IVX_LIVEKIT_URL          - wss://<host>:<port> (or set per-region)
//   IVX_LIVEKIT_API_KEY      - LiveKit API key
//   IVX_LIVEKIT_API_SECRET   - LiveKit API secret
//   IVX_LIVEKIT_REGION_<R>_URL - optional regional override (e.g. _US, _EU)
//
// HMAC-SHA256 in goja: we hand-roll a tiny JWT signer because the goja
// runtime has no Web Crypto API. SHA256 + HMAC implementations are
// resident as kernel utilities (see crypto/hmac.ts).

namespace MpVoiceLiveKit {

  export interface IConfig {
    apiKey: string;
    apiSecret: string;
    defaultUrl: string;
    regionalUrls: { [region: string]: string };
  }

  export function loadConfig(env: { [k: string]: string }): IConfig {
    var regional: { [r: string]: string } = {};
    for (var k in env) {
      var m = /^IVX_LIVEKIT_REGION_([A-Z0-9_]+)_URL$/.exec(k);
      if (m) regional[m[1].toLowerCase()] = env[k];
    }
    return {
      apiKey:     env["IVX_LIVEKIT_API_KEY"] || "",
      apiSecret:  env["IVX_LIVEKIT_API_SECRET"] || "",
      defaultUrl: env["IVX_LIVEKIT_URL"] || "",
      regionalUrls: regional
    };
  }

  // Returns the wss URL for a given region, falling back to the default.
  export function urlFor(cfg: IConfig, region: string): string {
    if (region) {
      var key = region.toLowerCase();
      if (cfg.regionalUrls[key]) return cfg.regionalUrls[key];
    }
    return cfg.defaultUrl;
  }

  // Build a minimal LiveKit JWT (https://docs.livekit.io/realtime/concepts/authentication/).
  // grants:
  //   - room: ivx_<matchId>
  //   - roomJoin: true
  //   - canPublish: <bool>
  //   - canSubscribe: <bool>
  //   - canPublishData: <bool>  (used for visemes / control)
  //
  // Implementation note: goja can JSON.stringify but lacks btoa; we use a
  // base64 helper. Signing is HMAC-SHA256 over `${b64header}.${b64body}`.
  export function makeMinter(cfg: IConfig, b64url: (s: string) => string, hmacSha256: (key: string, msg: string) => string): MpKernelVoice.ITokenMinter {
    return {
      name: "livekit",
      mint: function(args) {
        if (!cfg.apiKey || !cfg.apiSecret) {
          // No creds -> degrade to "none" provider in the kernel.
          return { token: "", url: "", opts: { error: "livekit_unconfigured" } };
        }
        var nowSec = Math.floor(Date.now() / 1000);
        var ttlSec = Math.max(30, Math.floor(args.ttlMs / 1000));
        var payload = {
          iss: cfg.apiKey,
          sub: args.identity,
          iat: nowSec,
          nbf: nowSec - 5,
          exp: nowSec + ttlSec,
          name: args.identity,
          video: {
            room: "ivx_" + args.roomId,
            roomJoin: true,
            canPublish: !!args.canPublish,
            canSubscribe: !!args.canSubscribe,
            canPublishData: true
          }
        };
        var header = { alg: "HS256", typ: "JWT" };
        var b64header = b64url(JSON.stringify(header));
        var b64body = b64url(JSON.stringify(payload));
        var signingInput = b64header + "." + b64body;
        var sig = hmacSha256(cfg.apiSecret, signingInput);
        var token = signingInput + "." + sig;
        return {
          token: token,
          url: urlFor(cfg, args.region),
          opts: {
            // Hint for clients: identity matches kernel user_id.
            identity_kind: args.identity.indexOf("agt_") === 0 ? "agent" : "human",
            spatial: args.spatial ? "true" : "false"
          }
        };
      }
    };
  }
}
