// ──────────────────────────────────────────────────────────────────────────
// JS-runtime health probe RPC (`nakama_js_health`).
//
// Why this exists (cbeacf6 outage, 2026-04-22):
//   The k8s probe is `GET /healthcheck`, which is Nakama's HTTP server
//   liveness check. It returns 200 even when the JavaScript runtime
//   provider failed to compile any modules — so pods come up "Ready"
//   while every game RPC is dead. The cbeacf6 deploy ran in that state
//   for 7+ hours before anyone noticed.
//
// What this RPC does:
//   • Just being callable proves the JS runtime is alive (the bundle
//     compiled, InitModule ran, this RPC was registered).
//   • Returns the auto-discovered TS-owned RPC count from
//     __TS_OWNED_RPCS so the CI smoke-test can also assert "we
//     registered the expected number of RPCs", catching silent dropouts.
//
// Wire-up:
//   • Registered as `nakama_js_health` in src/main.ts (BEFORE the legacy
//     bridge so it's also available in the trivial case where the bridge
//     itself failed).
//   • The k8s deployment (intelli-verse-kube-infra/nakama/deployment.yaml)
//     should call it via:
//       livenessProbe:
//         exec:
//           command:
//             - /bin/sh
//             - -c
//             - 'curl -fsS -X POST http://127.0.0.1:7350/v2/rpc/nakama_js_health?http_key=$HTTP_KEY -H "Content-Type: application/json" -d "{}" >/dev/null'
//         initialDelaySeconds: 30
//         periodSeconds: 30
//         failureThreshold: 3
//   • CI buildspec.yml runs the same curl post-rollout as a deploy gate.
//
// Safe to call publicly — returns no PII, only counts. Authentication is
// required by Nakama's default (any session token, or http_key for
// server-to-server). Does NOT require admin auth so the probe sidecar
// doesn't need to carry the dashboard secret.
// ──────────────────────────────────────────────────────────────────────────

namespace JsRuntimeHealth {
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("nakama_js_health", rpcHealth);
  }

  function rpcHealth(
    _ctx: nkruntime.Context,
    _logger: nkruntime.Logger,
    _nk: nkruntime.Nakama,
    _payload: string,
  ): string {
    var tsOwned = (typeof __TS_OWNED_RPCS !== "undefined" && __TS_OWNED_RPCS) ? __TS_OWNED_RPCS : {};
    var tsOwnedCount = 0;
    for (var k in tsOwned) {
      if (Object.prototype.hasOwnProperty.call(tsOwned, k)) tsOwnedCount++;
    }

    return JSON.stringify({
      ok: true,
      runtime: "javascript",
      ts_owned_rpc_count: tsOwnedCount,
      // ISO-8601 timestamp so logs/metrics can correlate. Using Date()
      // directly is safe in Goja (it implements ECMAScript Date).
      now: new Date().toISOString(),
    });
  }
}
