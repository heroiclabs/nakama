namespace ConfigLoader {

  var configCache: { [key: string]: { data: any; loadedAt: number } } = {};
  var CACHE_TTL_MS = 60000; // 1 minute

  // Fold every alias of a registered app (UUID / slug / platform aliases) down
  // to one canonical scope before building the storage key, so the same app
  // never splits across two config stores. Defensive: if the registry helper
  // is unavailable for any reason, fall back to the raw id (legacy behaviour).
  function canonicalGameId(nk: nkruntime.Nakama, gameId: string | undefined): string | undefined {
    try {
      if (typeof LegacyGameRegistry !== "undefined" && LegacyGameRegistry.resolveCanonicalGameId) {
        return LegacyGameRegistry.resolveCanonicalGameId(nk, gameId);
      }
    } catch (_e) { /* fall through to raw */ }
    return gameId;
  }

  // Bare (unscoped) config keys are the legacy home of the ORIGINAL app's data —
  // QuizVerse predates multi-tenancy, so "experiments", "live_events",
  // "messages", "flags", … without a game prefix are ITS configs. Only that app
  // may fall back to the bare key when its scoped doc is missing; every other
  // game must stay strict, otherwise the console (and worse, the game client)
  // would surface another app's experiments / events / messages as its own.
  var LEGACY_BARE_KEY_OWNER = "quizverse";

  function mayFallBackToBareKey(canonicalId: string | undefined): boolean {
    return !!canonicalId && String(canonicalId).toLowerCase() === LEGACY_BARE_KEY_OWNER;
  }

  /** True when gameId resolves to the app that owns the legacy bare-key data
   *  (and the other unscopable legacy stores: onboarding rolling actives,
   *  satori_debugger ring). Used by read surfaces to decide whether platform
   *  legacy sources may represent this app. */
  export function isLegacyBareKeyOwner(nk: nkruntime.Nakama, gameId: string | undefined): boolean {
    return mayFallBackToBareKey(canonicalGameId(nk, gameId));
  }

  export function loadConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T {
    var now = Date.now();
    var cached = configCache[configKey];
    if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
      return cached.data as T;
    }

    var data = Storage.readSystemJson<T>(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey);
    if (!data) {
      data = defaultValue;
    }
    configCache[configKey] = { data: data, loadedAt: now };
    return data;
  }

  export function loadConfigForGame<T>(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, defaultValue: T): T {
    var canonical = canonicalGameId(nk, gameId);
    var scopedKey = Constants.gameKey(canonical, configKey);
    var data = loadConfig<T>(nk, scopedKey, defaultValue);
    if (scopedKey !== configKey && data === defaultValue && mayFallBackToBareKey(canonical)) {
      return loadConfig<T>(nk, configKey, defaultValue);
    }
    return data;
  }

  export function loadSatoriConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T {
    var now = Date.now();
    var cacheKey = "satori_" + configKey;
    var cached = configCache[cacheKey];
    if (cached && (now - cached.loadedAt) < CACHE_TTL_MS) {
      return cached.data as T;
    }

    var data = Storage.readSystemJson<T>(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey);
    if (!data) {
      data = defaultValue;
    }
    configCache[cacheKey] = { data: data, loadedAt: now };
    return data;
  }

  export function loadSatoriConfigForGame<T>(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, defaultValue: T): T {
    var canonical = canonicalGameId(nk, gameId);
    var scopedKey = Constants.gameKey(canonical, configKey);
    var data = loadSatoriConfig<T>(nk, scopedKey, defaultValue);
    if (scopedKey !== configKey && data === defaultValue && mayFallBackToBareKey(canonical)) {
      return loadSatoriConfig<T>(nk, configKey, defaultValue);
    }
    return data;
  }

  export function saveConfig(nk: nkruntime.Nakama, configKey: string, data: any): void {
    Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey, data);
    delete configCache[configKey];
  }

  export function saveSatoriConfig(nk: nkruntime.Nakama, configKey: string, data: any): void {
    Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey, data);
    delete configCache["satori_" + configKey];
  }

  export function saveSatoriConfigForGame(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, data: any): void {
    saveSatoriConfig(nk, Constants.gameKey(canonicalGameId(nk, gameId), configKey), data);
  }

  export function invalidateCache(configKey?: string): void {
    if (configKey) {
      delete configCache[configKey];
      delete configCache["satori_" + configKey];
    } else {
      configCache = {};
    }
  }
}
