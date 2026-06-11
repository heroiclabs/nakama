// ---------------------------------------------------------------------------
// Satori Experiment Results — conversion counting + statistical significance
// for A/B experiments, plus a declare-winner action. Closes the biggest gap
// vs the hosted Satori console (which reports per-variant results).
//
// Data sources (no schema changes):
//   - Assignments: `satori_assignments` collection, one object per user
//     (key = gameKey(gameId, "assignments")), written by SatoriExperiments
//     on first getVariant() call → gives EXPOSURES per variant.
//   - Goal events: `satori_events` collection under SYSTEM_USER (records
//     keyed ev_*), written by SatoriEventCapture → gives CONVERSIONS
//     (first goal event at/after the user's assignment time).
//
// Significance: two-proportion z-test of each variant against the control
// (variant whose id/name is "control", else the first variant). Two-tailed
// p-value via the Abramowitz–Stegun erf approximation. 95% => significant.
//
// Both scans are page-capped so a huge dataset degrades to a truncated
// (clearly flagged) estimate instead of hanging a VM.
// ---------------------------------------------------------------------------
namespace SatoriExperimentResults {

  var PAGE_SIZE = 100;
  var ASSIGNMENT_MAX_PAGES = 200;  // 20K users
  var EVENTS_DEFAULT_PAGES = 100;  // 10K event records
  var EVENTS_MAX_PAGES = 400;

  export interface AssignmentInfo {
    variantKey: string;
    assignedAtMs: number;
  }

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function variantKeyOf(variant: any): string {
    return (variant && (variant.id || variant.name)) || "";
  }

  // ---- Normal CDF via erf (Abramowitz & Stegun 7.1.26) ----

  function erf(x: number): number {
    var sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    var a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    var t = 1 / (1 + p * x);
    var y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return sign * y;
  }

  function normalCdf(z: number): number {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  // Two-proportion z-test. Returns null when sample sizes are too small.
  function zTest(c1: number, n1: number, c2: number, n2: number): { z: number; pValue: number } | null {
    if (n1 < 1 || n2 < 1) return null;
    var p1 = c1 / n1;
    var p2 = c2 / n2;
    var pooled = (c1 + c2) / (n1 + n2);
    var se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
    if (se === 0) return null;
    var z = (p2 - p1) / se;
    var pValue = 2 * (1 - normalCdf(Math.abs(z)));
    return { z: z, pValue: pValue };
  }

  // ---- Data collection ----

  function loadExperimentDef(nk: nkruntime.Nakama, experimentId: string, gameId?: string): any {
    var experiments = ConfigLoader.loadSatoriConfigForGame<{ [id: string]: any }>(nk, "experiments", gameId, {});
    return experiments[experimentId] || null;
  }

  // Scan all users' assignment objects, collect userId → assignment for this
  // experiment. Assignment objects are stored per-user, so we list across
  // owners with an empty userId. Exported for reuse by funnels/retention
  // variant segmentation.
  export function collectAssignments(nk: nkruntime.Nakama, experimentId: string, gameId?: string): { byUser: { [userId: string]: AssignmentInfo }; truncated: boolean; scanned: number } {
    var expectedKey = Constants.gameKey(gameId, "assignments");
    var byUser: { [userId: string]: AssignmentInfo } = {};
    var cursor = "";
    var truncated = false;
    var scanned = 0;

    for (var p = 0; p < ASSIGNMENT_MAX_PAGES; p++) {
      var page = nk.storageList("", Constants.SATORI_ASSIGNMENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (obj.key !== expectedKey || !obj.value || !obj.userId) continue;
        scanned++;
        var assignments = (obj.value as any).assignments || {};
        var a = assignments[experimentId];
        if (!a || !a.variantId) continue;
        byUser[obj.userId] = {
          variantKey: a.variantId,
          assignedAtMs: toMs(a.assignedAt || 0)
        };
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;
    return { byUser: byUser, truncated: truncated, scanned: scanned };
  }

  // Scan goal events; a user converts when their FIRST goal event happens at
  // or after their assignment time. Also tallies total goal-event volume.
  function collectConversions(
    nk: nkruntime.Nakama,
    goalEvent: string,
    byUser: { [userId: string]: AssignmentInfo },
    maxPages: number
  ): { convertedUsers: { [userId: string]: boolean }; totalGoalEvents: number; truncated: boolean; scannedRecords: number } {
    var convertedUsers: { [userId: string]: boolean } = {};
    var totalGoalEvents = 0;
    var scannedRecords = 0;
    var cursor = "";
    var truncated = false;

    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.key || obj.key.indexOf("ev_") !== 0 || !obj.value) continue;
        scannedRecords++;
        var rec = obj.value as any;
        if (rec.name !== goalEvent) continue;
        var uid = rec.userId || rec.identityId;
        if (!uid) continue;
        var assignment = byUser[uid];
        if (!assignment) continue;
        totalGoalEvents++;
        if (toMs(rec.timestamp) >= assignment.assignedAtMs) {
          convertedUsers[uid] = true;
        }
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;
    return { convertedUsers: convertedUsers, totalGoalEvents: totalGoalEvents, truncated: truncated, scannedRecords: scannedRecords };
  }

  // ---- RPCs ----

  // satori_experiments_results — per-variant exposures, conversions, rates,
  // z-test vs control, and a recommendation.
  // Payload: { experimentId, game_id?, goal_event?, max_event_pages? }
  function rpcResults(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.experimentId && !data.experiment_id) return RpcHelpers.errorResponse("experimentId required");
    var experimentId = data.experimentId || data.experiment_id;
    var gameId = RpcHelpers.gameId(data);

    var def = loadExperimentDef(nk, experimentId, gameId);
    if (!def) return RpcHelpers.errorResponse("Experiment '" + experimentId + "' not found");

    var goalEvent = data.goal_event || data.goalEvent || def.goalEvent || def.goalMetric;
    if (!goalEvent) {
      return RpcHelpers.errorResponse("No goal event: pass goal_event or set goalMetric on the experiment definition");
    }

    var variants: any[] = def.variants || [];
    if (variants.length < 2) return RpcHelpers.errorResponse("Experiment needs at least 2 variants for results");

    var maxEventPages = Math.min(Math.max(parseInt(data.max_event_pages, 10) || EVENTS_DEFAULT_PAGES, 1), EVENTS_MAX_PAGES);

    var assignmentScan = collectAssignments(nk, experimentId, gameId);
    var conversionScan = collectConversions(nk, goalEvent, assignmentScan.byUser, maxEventPages);

    // Tally per variant.
    var exposures: { [variantKey: string]: number } = {};
    var conversions: { [variantKey: string]: number } = {};
    for (var uid in assignmentScan.byUser) {
      var vk = assignmentScan.byUser[uid].variantKey;
      exposures[vk] = (exposures[vk] || 0) + 1;
      if (conversionScan.convertedUsers[uid]) {
        conversions[vk] = (conversions[vk] || 0) + 1;
      }
    }

    // Control = variant with id/name "control", else first.
    var controlKey = variantKeyOf(variants[0]);
    for (var c = 0; c < variants.length; c++) {
      var key = variantKeyOf(variants[c]);
      if (key === "control" || (variants[c].name || "").toLowerCase() === "control") {
        controlKey = key;
        break;
      }
    }

    var variantRows: any[] = [];
    for (var v = 0; v < variants.length; v++) {
      var vKey = variantKeyOf(variants[v]);
      var n = exposures[vKey] || 0;
      var conv = conversions[vKey] || 0;
      variantRows.push({
        id: vKey,
        name: variants[v].name || vKey,
        isControl: vKey === controlKey,
        exposures: n,
        conversions: conv,
        rate: n > 0 ? conv / n : 0
      });
    }

    // Compare every non-control variant to control.
    var cN = exposures[controlKey] || 0;
    var cConv = conversions[controlKey] || 0;
    var cRate = cN > 0 ? cConv / cN : 0;
    var comparisons: any[] = [];
    var winner: string | null = null;
    var bestLift = 0;

    for (var w = 0; w < variantRows.length; w++) {
      var row = variantRows[w];
      if (row.isControl) continue;
      var test = zTest(cConv, cN, row.conversions, row.exposures);
      var lift = cRate > 0 ? (row.rate - cRate) / cRate : (row.rate > 0 ? 1 : 0);
      var significant = !!(test && test.pValue < 0.05);
      comparisons.push({
        variantId: row.id,
        controlId: controlKey,
        lift: lift,
        zScore: test ? test.z : null,
        pValue: test ? test.pValue : null,
        significant: significant,
        confidence: test ? (1 - test.pValue) : null
      });
      if (significant && row.rate > cRate && lift > bestLift) {
        winner = row.id;
        bestLift = lift;
      }
    }

    var recommendation: string;
    if (winner) {
      recommendation = "Variant '" + winner + "' beats control with 95% confidence — consider declaring it the winner.";
    } else {
      var anySignificantLoss = false;
      for (var s = 0; s < comparisons.length; s++) {
        if (comparisons[s].significant && comparisons[s].lift < 0) anySignificantLoss = true;
      }
      recommendation = anySignificantLoss
        ? "Control significantly outperforms at least one variant — consider declaring control the winner."
        : "No statistically significant difference yet — keep the experiment running.";
    }

    return RpcHelpers.successResponse({
      experimentId: experimentId,
      name: def.name || experimentId,
      status: def.status || "unknown",
      goalEvent: goalEvent,
      winnerVariantId: def.winnerVariantId || null,
      variants: variantRows,
      comparisons: comparisons,
      suggestedWinner: winner,
      recommendation: recommendation,
      scan: {
        assignmentObjectsScanned: assignmentScan.scanned,
        assignmentsTruncated: assignmentScan.truncated,
        eventRecordsScanned: conversionScan.scannedRecords,
        eventsTruncated: conversionScan.truncated,
        totalGoalEvents: conversionScan.totalGoalEvents
      }
    });
  }

  // satori_experiments_declare_winner — end the experiment and record the
  // winning variant on its definition.
  // Payload: { experimentId, variantId, game_id? }
  function rpcDeclareWinner(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var experimentId = data.experimentId || data.experiment_id;
    var variantId = data.variantId || data.variant_id;
    if (!experimentId || !variantId) return RpcHelpers.errorResponse("experimentId and variantId required");
    var gameId = RpcHelpers.gameId(data);

    // Resolve the exact config key the definition lives under (scoped first,
    // then global) so we write back to the same object we read.
    var scopedKey = Constants.gameKey(gameId, "experiments");
    var configKey = scopedKey;
    var experiments = Storage.readSystemJson<{ [id: string]: any }>(nk, Constants.SATORI_CONFIGS_COLLECTION, scopedKey);
    if ((!experiments || !experiments[experimentId]) && scopedKey !== "experiments") {
      configKey = "experiments";
      experiments = Storage.readSystemJson<{ [id: string]: any }>(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey);
    }
    if (!experiments || !experiments[experimentId]) {
      return RpcHelpers.errorResponse("Experiment '" + experimentId + "' not found");
    }

    var def = experiments[experimentId];
    var validVariant = false;
    var defVariants: any[] = def.variants || [];
    for (var i = 0; i < defVariants.length; i++) {
      if (variantKeyOf(defVariants[i]) === variantId) { validVariant = true; break; }
    }
    if (!validVariant) return RpcHelpers.errorResponse("Variant '" + variantId + "' not found on experiment");

    var now = Math.floor(Date.now() / 1000);
    def.status = "ended";
    def.winnerVariantId = variantId;
    def.endedAt = now;
    def.updatedAt = now;
    experiments[experimentId] = def;

    Storage.writeSystemJson(nk, Constants.SATORI_CONFIGS_COLLECTION, configKey, experiments);
    ConfigLoader.invalidateCache(configKey);

    logger.info("[ExperimentResults] '%s' ended, winner='%s' (by admin)", experimentId, variantId);
    return RpcHelpers.successResponse({ experimentId: experimentId, winnerVariantId: variantId, status: "ended" });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_experiments_results", rpcResults);
    initializer.registerRpc("satori_experiments_declare_winner", rpcDeclareWinner);
  }
}
