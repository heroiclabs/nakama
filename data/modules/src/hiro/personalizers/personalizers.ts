namespace HiroPersonalizers {

  interface PersonalizerOverride {
    path: string;
    value: any;
  }

  interface UserOverrides {
    overrides: { [system: string]: PersonalizerOverride[] };
    updatedAt: number;
  }

  var OVERRIDES_COLLECTION = "hiro_personalizer_overrides";

  function deepClone(obj: any): any {
    if (obj === null || typeof obj !== "object") return obj;
    if (Array.isArray(obj)) {
      var arr: any[] = [];
      for (var i = 0; i < obj.length; i++) arr.push(deepClone(obj[i]));
      return arr;
    }
    var clone: any = {};
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) clone[key] = deepClone(obj[key]);
    }
    return clone;
  }

  function setNestedValue(obj: any, path: string, value: any): void {
    var parts = path.split(".");
    var current = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined || current[parts[i]] === null) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  function mergeDeep(target: any, source: any): any {
    if (!source || typeof source !== "object") return target;
    for (var key in source) {
      if (!source.hasOwnProperty(key)) continue;
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key]) &&
          target[key] && typeof target[key] === "object" && !Array.isArray(target[key])) {
        mergeDeep(target[key], source[key]);
      } else {
        target[key] = deepClone(source[key]);
      }
    }
    return target;
  }

  // ---- Storage Personalizer ----
  function applyStorageOverrides(nk: nkruntime.Nakama, userId: string, system: string, config: any, gameId?: string): any {
    var data = Storage.readJson<UserOverrides>(nk, OVERRIDES_COLLECTION, Constants.gameKey(gameId, "overrides"), userId);
    if (!data || !data.overrides || !data.overrides[system]) return config;

    var overrides = data.overrides[system];
    for (var i = 0; i < overrides.length; i++) {
      setNestedValue(config, overrides[i].path, overrides[i].value);
    }
    return config;
  }

  // ---- Satori Personalizer (feature flags + experiments) ----
  function applySatoriOverrides(nk: nkruntime.Nakama, userId: string, system: string, config: any): any {
    // Check feature flags for config overrides
    var flagName = "hiro_" + system + "_override";
    var flag = SatoriFeatureFlags.getFlag(nk, userId, flagName);
    if (flag && flag.value) {
      try {
        var flagOverrides = JSON.parse(flag.value);
        config = mergeDeep(config, flagOverrides);
      } catch (_) {}
    }

    // Check experiment variants for config overrides
    var experiments = ConfigLoader.loadSatoriConfig<{ [id: string]: any }>(nk, "experiments", {});
    for (var expId in experiments) {
      var exp = experiments[expId];
      if (exp.status !== "running") continue;
      if (!exp.configSystem || exp.configSystem !== system) continue;

      var variant = SatoriExperiments.getVariant(nk, userId, expId);
      if (variant && variant.config) {
        try {
          var variantOverrides: any = {};
          for (var key in variant.config) {
            try {
              variantOverrides[key] = JSON.parse(variant.config[key]);
            } catch (_) {
              variantOverrides[key] = variant.config[key];
            }
          }
          config = mergeDeep(config, variantOverrides);
        } catch (_) {}
      }
    }

    return config;
  }

  // ---- Public API ----

  export function personalize<T>(nk: nkruntime.Nakama, userId: string, system: string, baseConfig: T, gameId?: string): T {
    var config = deepClone(baseConfig);
    config = applyStorageOverrides(nk, userId, system, config, gameId);
    config = applySatoriOverrides(nk, userId, system, config);
    return config as T;
  }

  export function personalizeConfig<T>(nk: nkruntime.Nakama, userId: string, system: string, loader: () => T, gameId?: string): T {
    var base = loader();
    return personalize(nk, userId, system, base, gameId);
  }

  // ---- Admin RPCs ----

  function rpcSetOverride(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.system || !data.path) {
      return RpcHelpers.errorResponse("userId, system, and path required");
    }

    var userOverrides = Storage.readJson<UserOverrides>(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
    if (!userOverrides) userOverrides = { overrides: {}, updatedAt: 0 };
    if (!userOverrides.overrides[data.system]) userOverrides.overrides[data.system] = [];

    var existing = false;
    for (var i = 0; i < userOverrides.overrides[data.system].length; i++) {
      if (userOverrides.overrides[data.system][i].path === data.path) {
        userOverrides.overrides[data.system][i].value = data.value;
        existing = true;
        break;
      }
    }
    if (!existing) {
      userOverrides.overrides[data.system].push({ path: data.path, value: data.value });
    }

    userOverrides.updatedAt = Math.floor(Date.now() / 1000);
    Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
    return RpcHelpers.successResponse({ saved: true, system: data.system, path: data.path });
  }

  function rpcRemoveOverride(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.system || !data.path) {
      return RpcHelpers.errorResponse("userId, system, and path required");
    }

    var userOverrides = Storage.readJson<UserOverrides>(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
    if (!userOverrides || !userOverrides.overrides[data.system]) {
      return RpcHelpers.successResponse({ removed: false });
    }

    userOverrides.overrides[data.system] = userOverrides.overrides[data.system].filter(function(o: PersonalizerOverride) {
      return o.path !== data.path;
    });
    userOverrides.updatedAt = Math.floor(Date.now() / 1000);
    Storage.writeJson(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId, userOverrides);
    return RpcHelpers.successResponse({ removed: true });
  }

  function rpcGetOverrides(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId) return RpcHelpers.errorResponse("userId required");

    var userOverrides = Storage.readJson<UserOverrides>(nk, OVERRIDES_COLLECTION, Constants.gameKey(data.gameId, "overrides"), data.userId);
    return RpcHelpers.successResponse({ overrides: userOverrides || { overrides: {} } });
  }

  function rpcPreviewConfig(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.userId || !data.system) return RpcHelpers.errorResponse("userId and system required");

    var base = ConfigLoader.loadConfig<any>(nk, data.system, {});
    var personalized = personalize(nk, data.userId, data.system, base, data.gameId);
    return RpcHelpers.successResponse({ system: data.system, userId: data.userId, baseConfig: base, personalizedConfig: personalized });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("hiro_personalizer_set_override", rpcSetOverride);
    initializer.registerRpc("hiro_personalizer_remove_override", rpcRemoveOverride);
    initializer.registerRpc("hiro_personalizer_get_overrides", rpcGetOverrides);
    initializer.registerRpc("hiro_personalizer_preview", rpcPreviewConfig);
  }
}
