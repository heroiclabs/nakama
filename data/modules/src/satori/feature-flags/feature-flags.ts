namespace SatoriFeatureFlags {

  var DEFAULT_CONFIG: Satori.FlagsConfig = { flags: {} };

  function getConfig(nk: nkruntime.Nakama): Satori.FlagsConfig {
    return ConfigLoader.loadSatoriConfig<Satori.FlagsConfig>(nk, "flags", DEFAULT_CONFIG);
  }

  export function getFlag(nk: nkruntime.Nakama, userId: string, flagName: string, defaultValue?: string): Satori.Flag {
    var config = getConfig(nk);
    var def = config.flags[flagName];
    if (!def || !def.enabled) {
      return { name: flagName, value: defaultValue || "" };
    }

    if (def.conditionsByAudience && userId) {
      for (var audienceId in def.conditionsByAudience) {
        if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
          return { name: flagName, value: def.conditionsByAudience[audienceId] };
        }
      }
    }

    return { name: flagName, value: def.value };
  }

  export function getAllFlags(nk: nkruntime.Nakama, userId: string): Satori.Flag[] {
    var config = getConfig(nk);
    var flags: Satori.Flag[] = [];

    for (var name in config.flags) {
      var def = config.flags[name];
      if (!def.enabled) continue;

      var value = def.value;
      if (def.conditionsByAudience && userId) {
        for (var audienceId in def.conditionsByAudience) {
          if (SatoriAudiences.isInAudience(nk, userId, audienceId)) {
            value = def.conditionsByAudience[audienceId];
            break;
          }
        }
      }

      flags.push({ name: name, value: value });
    }

    return flags;
  }

  // ---- RPCs ----

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("Flag name required");

    var flag = getFlag(nk, userId, data.name, data.defaultValue);
    return RpcHelpers.successResponse({ flag: flag });
  }

  function rpcGetAll(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    var flags: Satori.Flag[];
    if (data.names && Array.isArray(data.names)) {
      flags = [];
      for (var i = 0; i < data.names.length; i++) {
        flags.push(getFlag(nk, userId, data.names[i]));
      }
    } else {
      flags = getAllFlags(nk, userId);
    }

    return RpcHelpers.successResponse({ flags: flags });
  }

  function rpcSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    // Admin RPC
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("Flag name required");

    var config = getConfig(nk);
    var now = Math.floor(Date.now() / 1000);
    var existing = config.flags[data.name];

    config.flags[data.name] = {
      name: data.name,
      value: data.value !== undefined ? data.value : (existing ? existing.value : ""),
      description: data.description || (existing ? existing.description : ""),
      conditionsByAudience: data.conditionsByAudience || (existing ? existing.conditionsByAudience : undefined),
      enabled: data.enabled !== undefined ? data.enabled : (existing ? existing.enabled : true),
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    ConfigLoader.saveSatoriConfig(nk, "flags", config);
    return RpcHelpers.successResponse({ flag: config.flags[data.name] });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_flags_get", rpcGet);
    initializer.registerRpc("satori_flags_get_all", rpcGetAll);
    initializer.registerRpc("satori_flags_set", rpcSet);
  }
}
