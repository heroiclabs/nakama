// ---------------------------------------------------------------------------
// Satori Direct Control — admin kill-switch for the Satori Cloud event
// mirror (data/modules/satori_direct/satori_direct.js).
//
// The legacy module gates every outbound HTTP call to satoricloud.io on the
// `satori_configs/satori_direct` storage object ({ enabled: boolean }, cached
// 60s in each VM). These RPCs flip and report that flag, so the paid Satori
// instance can be cut off without a redeploy — and re-enabled just as fast.
// ---------------------------------------------------------------------------
namespace SatoriDirectControl {

  var CONFIG_KEY = "satori_direct";

  function readConfig(nk: nkruntime.Nakama): { enabled: boolean; updatedAt?: number; updatedBy?: string } {
    var cfg = Storage.readSystemJson<any>(nk, Constants.SATORI_CONFIGS_COLLECTION, CONFIG_KEY);
    if (!cfg || cfg.enabled === undefined) return { enabled: true };
    return cfg;
  }

  // satori_direct_status — current mirror state.
  function rpcStatus(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var cfg = readConfig(nk);
    return RpcHelpers.successResponse({
      enabled: cfg.enabled !== false,
      updatedAt: cfg.updatedAt || null,
      updatedBy: cfg.updatedBy || null,
      note: "Controls outbound event mirroring to the hosted Satori Cloud instance. Takes effect within ~60s on all pods."
    });
  }

  // satori_direct_toggle — Payload: { enabled: boolean }
  function rpcToggle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (data.enabled === undefined) return RpcHelpers.errorResponse("enabled (boolean) required");

    var cfg = {
      enabled: !!data.enabled,
      updatedAt: Math.floor(Date.now() / 1000),
      updatedBy: ctx.userId || "server"
    };
    Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, CONFIG_KEY, cfg);
    logger.info("[SatoriDirectControl] Satori Cloud mirror %s by %s", cfg.enabled ? "ENABLED" : "DISABLED", cfg.updatedBy);
    return RpcHelpers.successResponse({ enabled: cfg.enabled, updatedAt: cfg.updatedAt });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_direct_status", rpcStatus);
    initializer.registerRpc("satori_direct_toggle", rpcToggle);
  }
}
