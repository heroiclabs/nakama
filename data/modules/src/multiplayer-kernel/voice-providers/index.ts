// IVX kernel voice-provider plumbing.
//
// At kernel boot we install ONE active token-minter (LiveKit by default,
// optionally Agora/Twilio/Dolby in the future) and expose:
//
//   * MpKernelVoiceProviders.activeMinter()      — currently-installed minter
//   * MpKernelVoiceProviders.bootstrap(env)      — one-time install at boot
//   * MpKernelVoiceProviders.b64url(s)           — goja-safe base64url
//   * MpKernelVoiceProviders.hmacSha256B64Url    — uses nk.hmacSha256Hash
//   * RPC `mp_voice_token`                       — clients mint per-match tokens
//
// This file is the ONLY place that should know provider-specific details
// at the kernel level; templates ask for tokens via MpKernelVoice.mintToken
// + activeMinter().

namespace MpKernelVoiceProviders {

  var _activeMinter: MpKernelVoice.ITokenMinter | null = null;

  export function activeMinter(): MpKernelVoice.ITokenMinter | null {
    return _activeMinter;
  }

  export function setActiveMinter(m: MpKernelVoice.ITokenMinter | null): void {
    _activeMinter = m;
  }

  // ── base64url for goja (no Buffer/btoa available) ────────────────────
  // Standard base64 alphabet for binary→text, then translate to URL-safe
  // and strip padding. Input is assumed to be a UTF-8 JS string of the
  // JWT segment payload (header or claims JSON).
  var B64_ALPHABET =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  export function b64url(input: string): string {
    var bytes: number[] = [];
    for (var i = 0; i < input.length; i++) {
      var c = input.charCodeAt(i);
      if (c < 0x80) {
        bytes.push(c);
      } else if (c < 0x800) {
        bytes.push(0xC0 | (c >> 6));
        bytes.push(0x80 | (c & 0x3F));
      } else {
        bytes.push(0xE0 | (c >> 12));
        bytes.push(0x80 | ((c >> 6) & 0x3F));
        bytes.push(0x80 | (c & 0x3F));
      }
    }
    var out = "";
    var n = bytes.length;
    var i2 = 0;
    while (i2 + 3 <= n) {
      var b0 = bytes[i2++], b1 = bytes[i2++], b2 = bytes[i2++];
      out += B64_ALPHABET.charAt(b0 >> 2);
      out += B64_ALPHABET.charAt(((b0 & 3) << 4) | (b1 >> 4));
      out += B64_ALPHABET.charAt(((b1 & 15) << 2) | (b2 >> 6));
      out += B64_ALPHABET.charAt(b2 & 63);
    }
    var rem = n - i2;
    if (rem === 1) {
      var bA = bytes[i2];
      out += B64_ALPHABET.charAt(bA >> 2);
      out += B64_ALPHABET.charAt((bA & 3) << 4);
      out += "==";
    } else if (rem === 2) {
      var bB0 = bytes[i2], bB1 = bytes[i2 + 1];
      out += B64_ALPHABET.charAt(bB0 >> 2);
      out += B64_ALPHABET.charAt(((bB0 & 3) << 4) | (bB1 >> 4));
      out += B64_ALPHABET.charAt((bB1 & 15) << 2);
      out += "=";
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // hex → base64url (LiveKit JWT signature is the HMAC raw bytes encoded
  // as base64url; Nakama's nk.hmacSha256Hash returns hex, so we adapt).
  export function hexToB64url(hex: string): string {
    if (!hex) return "";
    var bytes: number[] = [];
    for (var i = 0; i < hex.length; i += 2) {
      bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    // Reuse the b64url path by manually packing bytes.
    var s = "";
    for (var j = 0; j < bytes.length; j++) s += String.fromCharCode(bytes[j]);
    return b64url(s);
  }

  // Cached env-shape for lazy bootstrap. Set either by:
  //   1. `installEnv(env)` from InitModule for tests/local-dev, or
  //   2. ConfigLoader.loadConfig(nk, "mp_voice_livekit", {}) at first
  //      `mp_voice_token` invocation (production path; admin-rotatable).
  // `nk` isn't available at module register time, so we defer minter
  // creation to first RPC call when `nk` is in scope.
  var _envOverride: { [k: string]: string } | null = null;
  var _installed = false;
  var _installedAtMs = 0;

  // 5-minute hot-reload window — if storage config changes after
  // boot, the new minter takes effect within 5 minutes.
  var REINSTALL_TTL_MS = 300_000;

  export function installEnv(env: { [k: string]: string }): void {
    _envOverride = env || {};
    _installed = false;
  }

  // Storage shape (system collection "ivx_runtime_configs", key "mp_voice_livekit"):
  //   { api_key, api_secret, default_url, regional_urls: { us: ..., eu: ... } }
  interface IStorageConfig {
    api_key?: string;
    api_secret?: string;
    default_url?: string;
    regional_urls?: { [r: string]: string };
  }

  function configFromStorage(nk: nkruntime.Nakama): MpVoiceLiveKit.IConfig | null {
    try {
      var stored = ConfigLoader.loadConfig<IStorageConfig | null>(
        nk, "mp_voice_livekit", null
      );
      if (!stored) return null;
      if (!stored.api_key || !stored.api_secret) return null;
      var regional: { [r: string]: string } = {};
      if (stored.regional_urls) {
        for (var k in stored.regional_urls) {
          regional[k.toLowerCase()] = stored.regional_urls[k];
        }
      }
      return {
        apiKey: stored.api_key,
        apiSecret: stored.api_secret,
        defaultUrl: stored.default_url || "",
        regionalUrls: regional
      };
    } catch (e) {
      return null;
    }
  }

  function lazyInstall(nk: nkruntime.Nakama, logger: nkruntime.Logger | null): void {
    var nowMs = Date.now();
    if (_installed && (nowMs - _installedAtMs) < REINSTALL_TTL_MS) return;
    _installed = true;
    _installedAtMs = nowMs;
    var cfg: MpVoiceLiveKit.IConfig | null = configFromStorage(nk);
    if (!cfg && _envOverride) {
      cfg = MpVoiceLiveKit.loadConfig(_envOverride);
      if (!cfg.apiKey || !cfg.apiSecret) cfg = null;
    }
    if (!cfg) {
      if (logger) logger.info("[MpVoice] LiveKit unconfigured (storage + env both empty); voice-capable templates will degrade to NONE provider");
      _activeMinter = null;
      return;
    }
    var hmacSha256AsB64 = function (key: string, msg: string): string {
      var hex = (nk.hmacSha256Hash(key, msg) as unknown) as string;
      return hexToB64url(hex);
    };
    _activeMinter = MpVoiceLiveKit.makeMinter(cfg, b64url, hmacSha256AsB64);
    if (logger) logger.info("[MpVoice] LiveKit minter installed regions=" + JSON.stringify(Object.keys(cfg.regionalUrls)));
  }

  // ── RPC: clients mint per-match voice session tokens ──────────────────
  //
  // Request:
  //   { match_id: string, can_publish?: bool, can_subscribe?: bool,
  //     spatial?: bool, region?: string }
  //
  // Response (MpKernelVoice.ISessionToken serialized):
  //   { provider, token, room_id, identity, url, expires_at_ms,
  //     can_publish, can_subscribe, spatial, region, provider_opts }
  //
  // Authentication is required (ctx.userId is the LiveKit identity).
  export function rpcVoiceToken(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    if (!ctx.userId) {
      throw { message: "auth required", code: nkruntime.Codes.UNAUTHENTICATED } as nkruntime.Error;
    }
    var req: { match_id?: string; can_publish?: boolean; can_subscribe?: boolean; spatial?: boolean; region?: string };
    try {
      req = JSON.parse(payload || "{}");
    } catch (e) {
      throw { message: "bad json", code: nkruntime.Codes.INVALID_ARGUMENT } as nkruntime.Error;
    }
    if (!req.match_id) {
      throw { message: "match_id required", code: nkruntime.Codes.INVALID_ARGUMENT } as nkruntime.Error;
    }
    lazyInstall(nk, logger);
    var minter = _activeMinter;
    var canPub = req.can_publish !== false;     // default publish=true
    var canSub = req.can_subscribe !== false;   // default subscribe=true
    var spatial = !!req.spatial;
    var region = req.region || "";
    var token = MpKernelVoice.mintToken(
      minter,
      req.match_id,
      ctx.userId,
      canPub, canSub, spatial, region,
      Date.now()
    );
    return JSON.stringify(token);
  }

  export function register(initializer: nkruntime.Initializer, _logger: nkruntime.Logger): void {
    initializer.registerRpc("mp_voice_token", rpcVoiceToken);
  }
}
