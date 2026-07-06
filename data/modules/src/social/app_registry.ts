// app_registry.ts — storage-backed multi-app registry (doc §19.3).
//
// Replaces hardcoded game-id lists scattered through modules with ONE
// server-owned document per app. Onboarding a new app = one Console write
// (the proven qv_config/global pattern) — no build, no deploy.
//
// STORAGE
//   ivx_app_registry / {appId}    system-owned, permRead 2 (public read —
//   registry entries hold config, never secrets), permWrite 0.
//
// RPCs
//   ivx_app_config_get       — client fetch of one app's public config
//   ivx_app_registry_upsert  — service-token admin write (deep-merged)
//
// RESOLUTION CONTRACT (SocialAppRegistry.resolveApp):
//   unknown/missing appId → the built-in "quizverse" default entry, never an
//   error — an older client must never brick on registry lookups. Every
//   entry carries features (per-app kill switches) and limits (quotas).

namespace SocialAppRegistry {

  var COLLECTION  = "ivx_app_registry";
  var SYSTEM_USER = "00000000-0000-0000-0000-000000000000";

  export interface AppEntry {
    appId: string;
    appUuid: string;
    status: string;                    // "active" | "suspended"
    features: { [k: string]: boolean };
    limits: { [k: string]: number };
    branding: { [k: string]: string };
    [k: string]: any;
  }

  var DEFAULT_FEATURES = {
    friends: true, groups: true, challenges: true, feed: true,
    presence: true, inviteLinks: true, duoQuests: true, chat: true,
    // Progressive-enable flags: default OFF until the client build that
    // supports them has rolled out (doc §19.9 flag-first shipping).
    leagues: false, contactImport: false, scoreSigning: false
  };

  var DEFAULT_LIMITS = {
    maxFriends: 1000, maxGroupsPerUser: 20, maxGroupSize: 100,
    invitesPerHour: 20, pushPerUserPerDay: 2
  };

  // Built-in seeds — used when no storage doc exists yet. Writing a storage
  // doc OVERRIDES these field-by-field (shallow merge, stored wins).
  var SEEDS: { [appId: string]: AppEntry } = {
    "quizverse": {
      appId: "quizverse", appUuid: "126bf539-dae2-4bcf-964d-316c0fa1f92b",
      status: "active", features: DEFAULT_FEATURES, limits: DEFAULT_LIMITS,
      branding: { displayName: "QuizVerse", deepLinkHost: "quizverse.world", scheme: "quizverse" }
    },
    "lasttolive": {
      appId: "lasttolive", appUuid: "", status: "active",
      features: DEFAULT_FEATURES, limits: DEFAULT_LIMITS,
      branding: { displayName: "LastToLive", deepLinkHost: "", scheme: "lasttolive" }
    },
    "cricket": {
      appId: "cricket", appUuid: "", status: "active",
      features: DEFAULT_FEATURES, limits: DEFAULT_LIMITS,
      branding: { displayName: "Cricket King", deepLinkHost: "", scheme: "cricket" }
    }
  };

  function shallowMerge(base: any, over: any): any {
    var out: any = {};
    var k: string;
    for (k in base) { if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k]; }
    for (k in over) {
      if (!Object.prototype.hasOwnProperty.call(over, k)) continue;
      if (out[k] && typeof out[k] === "object" && typeof over[k] === "object" &&
          !Array.isArray(out[k]) && !Array.isArray(over[k])) {
        var inner: any = {};
        var ik: string;
        for (ik in out[k]) { if (Object.prototype.hasOwnProperty.call(out[k], ik)) inner[ik] = out[k][ik]; }
        for (ik in over[k]) { if (Object.prototype.hasOwnProperty.call(over[k], ik)) inner[ik] = over[k][ik]; }
        out[k] = inner;
      } else {
        out[k] = over[k];
      }
    }
    return out;
  }

  /**
   * Resolve an appId to its full registry entry. Storage doc wins over the
   * built-in seed field-by-field; unknown ids fall back to quizverse.
   * One storage read per call (Goja VMs are pooled — no module-level cache,
   * per AGENTS.md rule 4). Callers on hot paths should resolve once per RPC.
   */
  export function resolveApp(nk: nkruntime.Nakama, rawAppId: any): AppEntry {
    var appId = (typeof rawAppId === "string" && rawAppId) ? rawAppId.toLowerCase() : "quizverse";
    var seed = SEEDS[appId] || SEEDS["quizverse"];
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: appId, userId: SYSTEM_USER }]);
      if (rows && rows.length > 0 && rows[0] && rows[0].value) {
        return shallowMerge(seed, rows[0].value) as AppEntry;
      }
    } catch (_) { /* seed applies */ }
    return seed;
  }

  /** Convenience: is a feature enabled for this app? Missing key = seed default. */
  export function featureEnabled(nk: nkruntime.Nakama, appId: any, feature: string): boolean {
    var entry = resolveApp(nk, appId);
    if (entry.status !== "active") return false;
    return !entry.features || entry.features[feature] !== false;
  }

  function rpcAppConfigGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var entry = resolveApp(nk, data.appId || data.gameId);
      return RpcHelpers.successResponse({ app: entry });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to read app config");
    }
  }

  function rpcRegistryUpsert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data: any = {};
      try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
      var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                           (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
      if (!expected || data.service_token !== expected) {
        return RpcHelpers.errorResponse("service-only", 401);
      }
      var appId = (typeof data.appId === "string" && data.appId) ? data.appId.toLowerCase() : "";
      if (!appId || !data.entry || typeof data.entry !== "object") {
        return RpcHelpers.errorResponse("appId and entry are required");
      }
      // Merge over the current effective entry so partial updates are safe.
      var merged = shallowMerge(resolveApp(nk, appId), data.entry);
      merged.appId = appId;
      merged.updatedAt = new Date().toISOString();
      nk.storageWrite([{
        collection: COLLECTION, key: appId, userId: SYSTEM_USER,
        value: merged, permissionRead: 2, permissionWrite: 0
      }]);
      logger.info("[AppRegistry] upsert " + appId);
      return RpcHelpers.successResponse({ app: merged });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to upsert app registry");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_app_config_get", rpcAppConfigGet);
    initializer.registerRpc("ivx_app_registry_upsert", rpcRegistryUpsert);
  }
}
