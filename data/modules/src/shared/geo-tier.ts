// geo-tier.ts — Server-side IP → Country → Ad Tier resolution
// PLAN-ADS-OPTIMIZATION-v2 §6.3
//
// RPC: country_tier_get
//   - Checks per-user 30-day cache first
//   - Falls back to ip-api.com HTTP lookup
//   - Returns { tier, countryCode, source, cached }
//   - Defaults to T3 on any failure (maximize ad volume for unknown geos)

namespace GeoTier {

  // ─── Constants ───────────────────────────────────────────────────────
  const GEO_COLLECTION = "geo_tier";
  const GEO_CACHE_KEY = "resolved";
  const CACHE_TTL_DAYS = 30;
  const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

  // ip-api.com — free tier, 45 req/min, HTTP only
  const IP_API_URL = "http://ip-api.com/json/";

  // ─── Tier Enum (matches Unity TierService.Tier) ──────────────────────
  const TIER_T1 = "t1"; // Low-volume premium (US, UK, CA, AU, etc.)
  const TIER_T2 = "t2"; // Mid-volume (EU, LATAM, SEA)
  const TIER_T3 = "t3"; // High-volume emerging (IN, PK, BD, NG, etc.)

  // ─── Country → Tier Mapping ──────────────────────────────────────────
  // From PLAN-ADS-OPTIMIZATION-v2 §2.4
  const T1_COUNTRIES: { [code: string]: boolean } = {
    "US": true, "GB": true, "CA": true, "AU": true, "NZ": true,
    "DE": true, "FR": true, "JP": true, "KR": true, "NO": true,
    "SE": true, "DK": true, "FI": true, "CH": true, "AT": true,
    "NL": true, "BE": true, "IE": true, "SG": true, "HK": true,
    "TW": true, "IL": true
  };

  const T2_COUNTRIES: { [code: string]: boolean } = {
    "ES": true, "IT": true, "PT": true, "PL": true, "CZ": true,
    "RO": true, "HU": true, "GR": true, "HR": true, "SK": true,
    "BG": true, "RS": true,
    "MX": true, "BR": true, "AR": true, "CL": true, "CO": true,
    "PE": true, "EC": true,
    "TH": true, "MY": true, "PH": true, "VN": true, "ID": true,
    "TR": true, "SA": true, "AE": true, "QA": true, "KW": true,
    "ZA": true, "KE": true, "EG": true, "MA": true,
    "RU": true, "UA": true, "KZ": true,
    "CN": true
  };

  // Everything else → T3

  // ─── Interfaces ──────────────────────────────────────────────────────
  interface GeoCache {
    tier: string;
    countryCode: string;
    source: string;
    resolvedAt: string; // ISO timestamp
    expiresAt: number;  // epoch ms
  }

  interface GeoResult {
    tier: string;
    countryCode: string;
    source: string;
    cached: boolean;
  }

  // ─── Core Logic ──────────────────────────────────────────────────────

  function countryToTier(countryCode: string): string {
    var cc = countryCode.toUpperCase();
    if (T1_COUNTRIES[cc]) return TIER_T1;
    if (T2_COUNTRIES[cc]) return TIER_T2;
    return TIER_T3;
  }

  function readCache(nk: nkruntime.Nakama, userId: string): GeoCache | null {
    try {
      var records = nk.storageRead([{
        collection: GEO_COLLECTION,
        key: GEO_CACHE_KEY,
        userId: userId
      }]);
      if (records && records.length > 0 && records[0].value) {
        var cached = records[0].value as GeoCache;
        // Check expiry
        if (cached.expiresAt && cached.expiresAt > Date.now()) {
          return cached;
        }
      }
    } catch (_) {
      // Cache miss — continue to API
    }
    return null;
  }

  function writeCache(nk: nkruntime.Nakama, userId: string, tier: string, countryCode: string, source: string): void {
    var now = Date.now();
    var cache: GeoCache = {
      tier: tier,
      countryCode: countryCode,
      source: source,
      resolvedAt: new Date(now).toISOString(),
      expiresAt: now + CACHE_TTL_MS
    };
    try {
      nk.storageWrite([{
        collection: GEO_COLLECTION,
        key: GEO_CACHE_KEY,
        userId: userId,
        value: cache,
        permissionRead: 1, // user can read own tier
        permissionWrite: 0  // only server can write
      }]);
    } catch (_) {
      // Non-fatal — will just re-resolve on next call
    }
  }

  function resolveFromIpApi(nk: nkruntime.Nakama, logger: nkruntime.Logger, clientIp: string): { countryCode: string } | null {
    try {
      // ip-api.com accepts the IP as a path segment
      // Fields filter: only request what we need (reduces response size)
      var url = IP_API_URL + clientIp + "?fields=status,countryCode,message";
      var resp = HttpClient.get(nk, url);

      if (resp.code !== 200) {
        logger.warn("[GeoTier] ip-api.com returned HTTP " + resp.code);
        return null;
      }

      var data: any;
      try {
        data = JSON.parse(resp.body);
      } catch (_) {
        logger.warn("[GeoTier] ip-api.com returned invalid JSON");
        return null;
      }

      if (data.status !== "success") {
        logger.warn("[GeoTier] ip-api.com lookup failed: " + (data.message || "unknown"));
        return null;
      }

      if (!data.countryCode || typeof data.countryCode !== "string") {
        logger.warn("[GeoTier] ip-api.com returned no countryCode");
        return null;
      }

      return { countryCode: data.countryCode.toUpperCase() };
    } catch (err: any) {
      logger.error("[GeoTier] ip-api.com request failed: " + (err.message || String(err)));
      return null;
    }
  }

  function resolve(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    userId: string
  ): GeoResult {
    // 1. Check cache
    var cached = readCache(nk, userId);
    if (cached) {
      return {
        tier: cached.tier,
        countryCode: cached.countryCode,
        source: cached.source,
        cached: true
      };
    }

    // 2. Resolve via IP API
    var clientIp = ctx.clientIp || "";
    if (clientIp) {
      var geoResult = resolveFromIpApi(nk, logger, clientIp);
      if (geoResult) {
        var tier = countryToTier(geoResult.countryCode);
        // Cache for 30 days
        writeCache(nk, userId, tier, geoResult.countryCode, "server_ip_geo");
        logger.info("[GeoTier] Resolved user " + userId + " → " + geoResult.countryCode + " → " + tier);
        return {
          tier: tier,
          countryCode: geoResult.countryCode,
          source: "server_ip_geo",
          cached: false
        };
      }
    } else {
      logger.warn("[GeoTier] No client IP available for user " + userId);
    }

    // 3. Fallback: T3 (maximize ad volume for unknown geos)
    var fallbackTier = TIER_T3;
    // Cache fallback too — prevents hammering API on every request
    writeCache(nk, userId, fallbackTier, "XX", "fallback");
    logger.info("[GeoTier] Fallback for user " + userId + " → " + fallbackTier);
    return {
      tier: fallbackTier,
      countryCode: "XX",
      source: "fallback",
      cached: false
    };
  }

  // ─── RPC Handler ────────────────────────────────────────────────────

  /**
   * RPC: country_tier_get
   * 
   * Payload (optional): { force_refresh?: boolean }
   *   - force_refresh: if true, bypasses cache and re-resolves from IP API
   * 
   * Response: { success: true, data: { tier, countryCode, source, cached } }
   */
  function rpcCountryTierGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);

    var data: any = {};
    if (payload && payload !== "") {
      data = RpcHelpers.parseRpcPayload(payload);
    }

    // Optional force refresh — invalidates cache
    if (data.force_refresh === true) {
      try {
        nk.storageDelete([{
          collection: GEO_COLLECTION,
          key: GEO_CACHE_KEY,
          userId: userId
        }]);
        logger.info("[GeoTier] Cache cleared for user " + userId + " (force_refresh)");
      } catch (_) {
        // Non-fatal
      }
    }

    var result = resolve(ctx, logger, nk, userId);
    return RpcHelpers.successResponse(result);
  }

  // ─── Public API (for other server modules) ──────────────────────────

  /**
   * Called by rewarded_ads.js to get the user's tier for cap scaling.
   * Returns the tier string (t1/t2/t3). Uses cache, never blocks on API.
   */
  export function getUserTier(nk: nkruntime.Nakama, userId: string): string {
    var cached = readCache(nk, userId);
    if (cached) return cached.tier;
    return TIER_T3; // Default if no cache — safe for ad volume
  }

  /**
   * Returns the user's cached ISO-3166 alpha-2 country code (e.g. "US",
   * "IN") from the 30-day geo cache, or "" when there is no fresh cache
   * entry. Never blocks on the IP-API HTTP call — callers that need a
   * guaranteed resolution should invoke the `country_tier_get` RPC first
   * (which resolves + caches), then read this. Used by the "People Near
   * You" suggestion RPC to scope candidates to the same country without
   * introducing any new permission or storage surface.
   *
   * Returns "" for the "XX" fallback sentinel too, so callers can treat
   * an unknown geo as "no nearby scoping possible".
   */
  export function getUserCountry(nk: nkruntime.Nakama, userId: string): string {
    var cached = readCache(nk, userId);
    if (cached && cached.countryCode && cached.countryCode !== "XX") {
      return cached.countryCode.toUpperCase();
    }
    return "";
  }

  /**
   * Resolve + cache the user's country in one call (cache-first, then
   * IP-API fallback). Returns the resolved alpha-2 code, or "" when even
   * the IP lookup fails (geo unknown). Unlike getUserCountry this WILL
   * perform the HTTP lookup on a cache miss, so the very first "People
   * Near You" load for a brand-new user still scopes correctly.
   */
  export function resolveUserCountry(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    userId: string
  ): string {
    var result = resolve(ctx, logger, nk, userId);
    if (result && result.countryCode && result.countryCode !== "XX") {
      return result.countryCode.toUpperCase();
    }
    return "";
  }

  // ─── Registration ───────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("country_tier_get", rpcCountryTierGet);
  }
}
