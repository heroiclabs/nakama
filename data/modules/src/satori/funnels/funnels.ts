// ---------------------------------------------------------------------------
// Satori Funnels — saved funnel definitions + on-demand conversion analysis
// over captured events, matching the hosted Satori console's funnel surface.
//
// A funnel is an ordered list of event names. A user "completes" step N when
// they have an occurrence of step N's event at/after their step N-1 event
// (and within the optional time window measured from step 0).
//
// Optional variant segmentation: pass an experimentId to split the funnel by
// the variant each user was assigned (reuses the assignment scan from
// SatoriExperimentResults).
//
// All scans are page-capped; truncation is flagged in the response.
// ---------------------------------------------------------------------------
namespace SatoriFunnels {

  var PAGE_SIZE = 100;
  var EVENTS_DEFAULT_PAGES = 320;  // 32K event records — covers the legacy (oldest-first) key tail
  var EVENTS_MAX_PAGES = 800;
  var MAX_STEPS = 8;

  interface FunnelDefinition {
    id: string;
    name: string;
    description?: string;
    steps: string[];
    windowHours?: number;
    createdAt: number;
    updatedAt: number;
  }

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function getFunnels(nk: nkruntime.Nakama, gameId?: string): { [id: string]: FunnelDefinition } {
    return ConfigLoader.loadSatoriConfigForGame<{ [id: string]: FunnelDefinition }>(nk, "funnels", gameId, {});
  }

  // ---- Core computation ----

  function computeFunnel(
    nk: nkruntime.Nakama,
    steps: string[],
    sinceMs: number,
    untilMs: number,
    maxPages: number,
    assignments: { [userId: string]: SatoriExperimentResults.AssignmentInfo } | null,
    windowMs?: number
  ): any {
    var stepSet: { [name: string]: number } = {};
    for (var s = 0; s < steps.length; s++) stepSet[steps[s]] = s;

    // userId → per-step sorted-ish timestamp lists (only steps we care about).
    var perUser: { [userId: string]: number[][] } = {};
    var cursor = "";
    var scannedRecords = 0;
    var truncated = false;

    for (var p = 0; p < maxPages; p++) {
      var page = nk.storageList(Constants.SYSTEM_USER_ID, Constants.SATORI_EVENTS_COLLECTION, PAGE_SIZE, cursor);
      var objects = (page && page.objects) || [];
      for (var i = 0; i < objects.length; i++) {
        var obj = objects[i];
        if (!obj.key || obj.key.indexOf("ev_") !== 0 || !obj.value) continue;
        scannedRecords++;
        var rec = obj.value as any;
        var stepIdx = stepSet[rec.name];
        if (stepIdx === undefined) continue;
        var ts = toMs(rec.timestamp);
        if (ts < sinceMs || ts > untilMs) continue;
        var uid = rec.userId || rec.identityId;
        if (!uid) continue;
        if (assignments && !assignments[uid]) continue;

        if (!perUser[uid]) {
          perUser[uid] = [];
          for (var k = 0; k < steps.length; k++) perUser[uid].push([]);
        }
        perUser[uid][stepIdx].push(ts);
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;

    // Walk each user's funnel.
    var stepUsers: number[] = [];
    var stepUsersByVariant: { [variantKey: string]: number[] } = {};
    for (var z = 0; z < steps.length; z++) stepUsers.push(0);

    for (var uid2 in perUser) {
      var lists = perUser[uid2];
      for (var sl = 0; sl < lists.length; sl++) {
        lists[sl].sort(function (a, b) { return a - b; });
      }
      if (lists[0].length === 0) continue;

      var variantKey: string | null = null;
      if (assignments) {
        variantKey = assignments[uid2].variantKey;
        if (!stepUsersByVariant[variantKey]) {
          stepUsersByVariant[variantKey] = [];
          for (var zv = 0; zv < steps.length; zv++) stepUsersByVariant[variantKey].push(0);
        }
      }

      var startTs = lists[0][0];
      var deadline = windowMs ? startTs + windowMs : Number.MAX_VALUE;
      var prevTs = startTs;
      var reached = 0;

      for (var st = 0; st < steps.length; st++) {
        if (st === 0) {
          reached = 1;
        } else {
          // first occurrence at/after the previous step (and before deadline)
          var found = -1;
          for (var t = 0; t < lists[st].length; t++) {
            if (lists[st][t] >= prevTs && lists[st][t] <= deadline) { found = lists[st][t]; break; }
          }
          if (found < 0) break;
          prevTs = found;
          reached = st + 1;
        }
        stepUsers[st]++;
        if (variantKey !== null) stepUsersByVariant[variantKey][st]++;
      }
    }

    var stepRows: any[] = [];
    for (var r = 0; r < steps.length; r++) {
      stepRows.push({
        name: steps[r],
        users: stepUsers[r],
        conversionFromStart: stepUsers[0] > 0 ? stepUsers[r] / stepUsers[0] : 0,
        conversionFromPrevious: r === 0 ? 1 : (stepUsers[r - 1] > 0 ? stepUsers[r] / stepUsers[r - 1] : 0)
      });
    }

    var byVariant: any = null;
    if (assignments) {
      byVariant = {};
      for (var vk in stepUsersByVariant) {
        var counts = stepUsersByVariant[vk];
        var rows: any[] = [];
        for (var rv = 0; rv < steps.length; rv++) {
          rows.push({
            name: steps[rv],
            users: counts[rv],
            conversionFromStart: counts[0] > 0 ? counts[rv] / counts[0] : 0
          });
        }
        byVariant[vk] = rows;
      }
    }

    return {
      steps: stepRows,
      entered: stepUsers[0],
      completed: stepUsers[steps.length - 1],
      overallConversion: stepUsers[0] > 0 ? stepUsers[steps.length - 1] / stepUsers[0] : 0,
      byVariant: byVariant,
      scannedRecords: scannedRecords,
      truncated: truncated
    };
  }

  // ---- Legacy event-volume funnel ----
  //
  // The per-user funnel above needs raw per-event rows (only available in the
  // sparse `satori_events` ring). For the common case (no experiment variant
  // split) we instead build the funnel from the real analytics pipeline's
  // per-day `by_name` event counts — true event volume, fast, no scan. This is
  // an event-volume funnel (occurrences per step), not distinct-user, so a
  // later step can exceed an earlier one; conversions are reported as-is.

  function computeFunnelLegacy(
    nk: nkruntime.Nakama,
    steps: string[],
    sinceMs: number,
    untilMs: number,
    gameId?: string
  ): any {
    var stepTotals: number[] = [];
    for (var z = 0; z < steps.length; z++) stepTotals.push(0);

    var startDayMs = new Date(LegacyAnalytics.dateStrOf(sinceMs) + "T00:00:00Z").getTime();
    var endDayMs = new Date(LegacyAnalytics.dateStrOf(untilMs) + "T00:00:00Z").getTime();
    var dayCount = 0;
    for (var t = startDayMs; t <= endDayMs; t += 86400000) {
      var day = LegacyAnalytics.readDay(nk, LegacyAnalytics.dateStrOf(t), gameId);
      dayCount++;
      for (var s = 0; s < steps.length; s++) {
        stepTotals[s] += (day.byName[steps[s]] || 0);
      }
    }

    var stepRows: any[] = [];
    for (var r = 0; r < steps.length; r++) {
      stepRows.push({
        name: steps[r],
        users: stepTotals[r],
        conversionFromStart: stepTotals[0] > 0 ? stepTotals[r] / stepTotals[0] : 0,
        conversionFromPrevious: r === 0 ? 1 : (stepTotals[r - 1] > 0 ? stepTotals[r] / stepTotals[r - 1] : 0)
      });
    }

    return {
      steps: stepRows,
      entered: stepTotals[0],
      completed: stepTotals[steps.length - 1],
      overallConversion: stepTotals[0] > 0 ? stepTotals[steps.length - 1] / stepTotals[0] : 0,
      byVariant: null,
      scannedRecords: dayCount,
      truncated: false,
      source: "analytics_pipeline",
      basis: "event_volume"
    };
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var funnels = getFunnels(nk, RpcHelpers.gameId(data));
    var list: FunnelDefinition[] = [];
    for (var id in funnels) list.push(funnels[id]);
    return RpcHelpers.successResponse({ funnels: list });
  }

  function rpcSave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var steps: string[] = data.steps || [];
    if (!data.id || !data.name) return RpcHelpers.errorResponse("id and name required");
    if (!Array.isArray(steps) || steps.length < 2) return RpcHelpers.errorResponse("steps[] requires at least 2 event names");
    if (steps.length > MAX_STEPS) return RpcHelpers.errorResponse("steps[] supports at most " + MAX_STEPS + " events");
    var gameId = RpcHelpers.gameId(data);

    var funnels = getFunnels(nk, gameId);
    var now = Math.floor(Date.now() / 1000);
    funnels[data.id] = {
      id: data.id,
      name: data.name,
      description: data.description || "",
      steps: steps,
      windowHours: data.windowHours ? Number(data.windowHours) : undefined,
      createdAt: (funnels[data.id] && funnels[data.id].createdAt) || now,
      updatedAt: now
    };
    ConfigLoader.saveSatoriConfigForGame(nk, "funnels", gameId, funnels);
    return RpcHelpers.successResponse({ funnel: funnels[data.id] });
  }

  function rpcDelete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.id) return RpcHelpers.errorResponse("id required");
    var gameId = RpcHelpers.gameId(data);
    var funnels = getFunnels(nk, gameId);
    delete funnels[data.id];
    ConfigLoader.saveSatoriConfigForGame(nk, "funnels", gameId, funnels);
    return RpcHelpers.successResponse({ deleted: data.id });
  }

  // satori_funnels_compute — Payload: { funnelId? | steps[], since_ms?,
  //   until_ms?, experiment_id?, game_id?, max_pages? }
  function rpcCompute(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var gameId = RpcHelpers.gameId(data);

    var steps: string[] = data.steps || [];
    var windowHours: number | undefined = data.window_hours ? Number(data.window_hours) : undefined;
    if (data.funnelId || data.funnel_id) {
      var def = getFunnels(nk, gameId)[data.funnelId || data.funnel_id];
      if (!def) return RpcHelpers.errorResponse("Funnel not found");
      steps = def.steps;
      if (windowHours === undefined) windowHours = def.windowHours;
    }
    if (!Array.isArray(steps) || steps.length < 2) return RpcHelpers.errorResponse("steps[] (>=2) or funnelId required");
    if (steps.length > MAX_STEPS) return RpcHelpers.errorResponse("steps[] supports at most " + MAX_STEPS + " events");

    var sinceMs = Number(data.since_ms || data.sinceMs) || (Date.now() - 7 * 86400000);
    var untilMs = Number(data.until_ms || data.untilMs) || Date.now();
    var maxPages = Math.min(Math.max(parseInt(data.max_pages, 10) || EVENTS_DEFAULT_PAGES, 1), EVENTS_MAX_PAGES);

    var experimentId = data.experiment_id || data.experimentId;

    var result: any;
    if (experimentId) {
      // Variant segmentation: per-user scan with assignment filter.
      var assignments = SatoriExperimentResults.collectAssignments(nk, experimentId, gameId).byUser;
      result = computeFunnel(nk, steps, sinceMs, untilMs, maxPages, assignments, windowHours ? windowHours * 3600000 : undefined);
      result.basis = "distinct_users";
    } else {
      // Default: try the per-user event scan first (distinct users, accurate funnel).
      // This uses the satori_events ring buffer which stores per-event rows.
      var perUserResult = computeFunnel(nk, steps, sinceMs, untilMs, maxPages, null, windowHours ? windowHours * 3600000 : undefined);
      if (perUserResult.scannedRecords > 0) {
        // Per-user data available — use it (distinct users, step N cannot exceed step N-1).
        result = perUserResult;
        result.basis = "distinct_users";
      } else {
        // No per-user event rows in the ring buffer — fall back to aggregated event counts.
        // NOTE: event-volume counts raw occurrences per step, so a later step can exceed
        // an earlier one (e.g. a user starts 3 quizzes = 3 quiz_start events).
        result = computeFunnelLegacy(nk, steps, sinceMs, untilMs, gameId);
        result.basis = "event_volume";
      }
    }
    result.sinceMs = sinceMs;
    result.untilMs = untilMs;
    result.experimentId = experimentId || null;
    return RpcHelpers.successResponse(result);
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_funnels_list", rpcList);
    initializer.registerRpc("satori_funnels_save", rpcSave);
    initializer.registerRpc("satori_funnels_delete", rpcDelete);
    initializer.registerRpc("satori_funnels_compute", rpcCompute);
  }
}
