namespace ConfigLoader {

  var configCache: { [key: string]: { data: any; loadedAt: number } } = {};
  var CACHE_TTL_MS = 60000; // 1 minute

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

  export function saveConfig(nk: nkruntime.Nakama, configKey: string, data: any): void {
    Storage.writeSystemJson(nk, Constants.HIRO_CONFIGS_COLLECTION, configKey, data);
    delete configCache[configKey];
  }

  export function saveSatoriConfig(nk: nkruntime.Nakama, configKey: string, data: any): void {
    Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey, data);
    delete configCache["satori_" + configKey];
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
