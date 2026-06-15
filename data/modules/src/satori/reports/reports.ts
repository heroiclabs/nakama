// ---------------------------------------------------------------------------
// Satori Reports — saved/reusable report definitions. Mirrors Satori Cloud's
// "Reports" surface: an admin saves a named query (a funnel, retention,
// metric, or timeline view with its parameters) and re-runs it later. The
// definition is stored here; the admin UI executes it by calling the existing
// funnel / retention / metric / timeline RPCs with the saved params.
//
// Definitions live in satori_configs/"reports" ({ reports: { [id]: def } }).
// Admin-only.
// ---------------------------------------------------------------------------
namespace SatoriReports {

  interface ReportDef {
    id: string;
    name: string;
    type: string;            // "funnel" | "retention" | "metric" | "timeline"
    description?: string;
    params: { [key: string]: any };
    createdAt: number;
    updatedAt: number;
  }

  function getReports(nk: nkruntime.Nakama): { [id: string]: ReportDef } {
    var raw = ConfigLoader.loadSatoriConfig<any>(nk, "reports", { reports: {} });
    return (raw && raw.reports) ? raw.reports : {};
  }

  function saveReports(nk: nkruntime.Nakama, reports: { [id: string]: ReportDef }): void {
    ConfigLoader.saveSatoriConfig(nk, "reports", { reports: reports });
  }

  function toList(reports: { [id: string]: ReportDef }): ReportDef[] {
    var out: ReportDef[] = [];
    for (var id in reports) out.push(reports[id]);
    out.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
    return out;
  }

  // satori_reports_list
  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    return RpcHelpers.successResponse({ reports: toList(getReports(nk)) });
  }

  var VALID_TYPES: { [t: string]: boolean } = { funnel: true, retention: true, metric: true, timeline: true };

  // satori_reports_save — Payload: { id?, name, type, description?, params }
  function rpcSave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.name) return RpcHelpers.errorResponse("name required");
    if (!data.type || !VALID_TYPES[data.type]) return RpcHelpers.errorResponse("type must be one of funnel|retention|metric|timeline");

    var reports = getReports(nk);
    var now = Math.floor(Date.now() / 1000);
    var id = data.id || ("rep_" + now + "_" + Math.floor(Math.random() * 100000));
    var existing = reports[id];

    reports[id] = {
      id: id,
      name: String(data.name).slice(0, 120),
      type: data.type,
      description: data.description ? String(data.description).slice(0, 500) : "",
      params: data.params && typeof data.params === "object" ? data.params : {},
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    saveReports(nk, reports);
    return RpcHelpers.successResponse({ report: reports[id] });
  }

  // satori_reports_delete — Payload: { id }
  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");
    var reports = getReports(nk);
    delete reports[data.id];
    saveReports(nk, reports);
    return RpcHelpers.successResponse({ deleted: data.id });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_reports_list", rpcList);
    initializer.registerRpc("satori_reports_save", rpcSave);
    initializer.registerRpc("satori_reports_delete", rpcDelete);
  }
}
