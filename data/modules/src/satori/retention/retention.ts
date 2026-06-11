// ---------------------------------------------------------------------------
// Satori Retention — activity-based D1/D3/D7 retention cohorts computed from
// captured events, with optional segmentation by experiment variant.
//
// Cohort = users whose first activity (within the scan window) falls on a
// given date. A user "retains" on D+N when they have any event on that date.
// Note: users whose true first session predates the scan window will appear
// as new — figures are window-relative, which is the standard trade-off for
// log-scan retention. The response carries the window so the UI can label it.
//
// Scan is page-capped and truncation is flagged.
// ---------------------------------------------------------------------------
namespace SatoriRetention {

  var PAGE_SIZE = 100;
  var DEFAULT_PAGES = 150;  // 15K event records
  var MAX_PAGES = 400;
  var MAX_DAYS = 30;

  function toMs(ts: number): number {
    if (!ts) return 0;
    return ts < 100000000000 ? ts * 1000 : ts;
  }

  function dateStrOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10);
  }

  function addDays(dateStr: string, days: number): string {
    var d = new Date(dateStr + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // satori_retention_compute — Payload: { days?, game_id?, experiment_id?, max_pages? }
  function rpcCompute(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var days = Math.min(Math.max(parseInt(data.days, 10) || 14, 3), MAX_DAYS);
    var maxPages = Math.min(Math.max(parseInt(data.max_pages, 10) || DEFAULT_PAGES, 1), MAX_PAGES);
    var gameId = RpcHelpers.gameId(data);

    var nowMs = Date.now();
    var sinceMs = nowMs - days * 86400000;
    var todayStr = dateStrOf(nowMs);

    var assignments: { [userId: string]: SatoriExperimentResults.AssignmentInfo } | null = null;
    var experimentId = data.experiment_id || data.experimentId;
    if (experimentId) {
      assignments = SatoriExperimentResults.collectAssignments(nk, experimentId, gameId).byUser;
    }

    // userId → { first: dateStr, dates: set }
    var perUser: { [userId: string]: { first: string; dates: { [d: string]: boolean } } } = {};
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
        var ts = toMs(rec.timestamp);
        if (ts < sinceMs || ts > nowMs) continue;
        var uid = rec.userId || rec.identityId;
        if (!uid) continue;
        if (assignments && !assignments[uid]) continue;

        var dStr = rec.date || dateStrOf(ts);
        var entry = perUser[uid];
        if (!entry) {
          entry = { first: dStr, dates: {} };
          perUser[uid] = entry;
        }
        entry.dates[dStr] = true;
        if (dStr < entry.first) entry.first = dStr;
      }
      cursor = (page && page.cursor) || "";
      if (!cursor) break;
    }
    if (cursor) truncated = true;

    // Cohorts by first-active date.
    var cohorts: { [date: string]: { size: number; d1: number; d3: number; d7: number } } = {};
    var byVariant: { [variantKey: string]: { size: number; d1: number; d3: number; d7: number; d1Eligible: number; d3Eligible: number; d7Eligible: number } } = {};

    for (var uid2 in perUser) {
      var u = perUser[uid2];
      if (!cohorts[u.first]) cohorts[u.first] = { size: 0, d1: 0, d3: 0, d7: 0 };
      var c = cohorts[u.first];
      c.size++;
      var r1 = !!u.dates[addDays(u.first, 1)];
      var r3 = !!u.dates[addDays(u.first, 3)];
      var r7 = !!u.dates[addDays(u.first, 7)];
      if (r1) c.d1++;
      if (r3) c.d3++;
      if (r7) c.d7++;

      if (assignments) {
        var vk = assignments[uid2].variantKey;
        if (!byVariant[vk]) byVariant[vk] = { size: 0, d1: 0, d3: 0, d7: 0, d1Eligible: 0, d3Eligible: 0, d7Eligible: 0 };
        var v = byVariant[vk];
        v.size++;
        // Only count toward DN rate when D+N has already passed.
        if (addDays(u.first, 1) <= todayStr) { v.d1Eligible++; if (r1) v.d1++; }
        if (addDays(u.first, 3) <= todayStr) { v.d3Eligible++; if (r3) v.d3++; }
        if (addDays(u.first, 7) <= todayStr) { v.d7Eligible++; if (r7) v.d7++; }
      }
    }

    var cohortRows: any[] = [];
    for (var dateKey in cohorts) {
      var row = cohorts[dateKey];
      cohortRows.push({
        date: dateKey,
        size: row.size,
        d1Rate: addDays(dateKey, 1) <= todayStr ? row.d1 / row.size : null,
        d3Rate: addDays(dateKey, 3) <= todayStr ? row.d3 / row.size : null,
        d7Rate: addDays(dateKey, 7) <= todayStr ? row.d7 / row.size : null
      });
    }
    cohortRows.sort(function (a, b) { return a.date < b.date ? 1 : -1; });

    var variantRows: any[] = [];
    for (var vk2 in byVariant) {
      var vr = byVariant[vk2];
      variantRows.push({
        variantId: vk2,
        size: vr.size,
        d1Rate: vr.d1Eligible > 0 ? vr.d1 / vr.d1Eligible : null,
        d3Rate: vr.d3Eligible > 0 ? vr.d3 / vr.d3Eligible : null,
        d7Rate: vr.d7Eligible > 0 ? vr.d7 / vr.d7Eligible : null
      });
    }

    return RpcHelpers.successResponse({
      windowDays: days,
      sinceMs: sinceMs,
      experimentId: experimentId || null,
      cohorts: cohortRows,
      byVariant: experimentId ? variantRows : null,
      totalUsers: Object.keys(perUser).length,
      scannedRecords: scannedRecords,
      truncated: truncated
    });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("satori_retention_compute", rpcCompute);
  }
}
