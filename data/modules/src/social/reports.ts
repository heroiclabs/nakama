// reports.ts — user/content reporting (G-011, doc §E.3 "Report System —
// Missing Entirely").
//
// Without this: toxic players can't be actioned without ad-hoc admin work,
// spam groups surface in search forever, abusive challenges sit in inboxes.
//
// RPCs
//   ivx_social_report        — session RPC: report a user/group/challenge/chat
//   ivx_social_reports_list  — service-token: moderation queue for ops tooling
//
// PIPELINE (minimum-viable per the doc — flag for review, never auto-ban):
//   1. Report row written (system-owned, immutable).
//   2. Rolling 7-day counter per target incremented (OCC, retry once).
//   3. Counter crossing REPORT_AUTO_FLAG_THRESHOLD (per-app registry
//      moderation config, default 5) writes a review-flag row — ops tooling
//      and the admin console query flagged targets from one collection.
//
// ABUSE-OF-ABUSE CONTROLS: 10 reports/reporter/day cap; duplicate report of
// the same target by the same reporter within 7 days is idempotent (returns
// the original, does not re-increment).
//
// RETENTION: reports 90d, counters/flags 90d (maintenance-tick sweeps).

namespace SocialReports {

  var REPORTS_COLLECTION  = "ivx_moderation_reports";
  var COUNTERS_COLLECTION = "ivx_moderation_counters";
  var FLAGS_COLLECTION    = "ivx_moderation_flags";
  var SYSTEM_USER         = "00000000-0000-0000-0000-000000000000";

  var VALID_TARGET_TYPES: { [t: string]: boolean } = { user: true, group: true, challenge: true, chat: true };
  var VALID_REASONS: { [r: string]: boolean } = {
    spam: true, harassment: true, inappropriate_name: true, inappropriate_content: true,
    cheating: true, impersonation: true, other: true
  };
  var MAX_DETAILS_LEN         = 500;
  var REPORTER_DAILY_CAP      = 10;
  var COUNTER_WINDOW_MS       = 7 * 24 * 3600 * 1000;
  var DEFAULT_FLAG_THRESHOLD  = 5;

  function pairDedupKey(reporterId: string, targetType: string, targetId: string): string {
    return "dedup_" + reporterId + "_" + targetType + "_" + targetId;
  }

  function rpcReport(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var reporterId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};

      var targetType = (typeof data.targetType === "string") ? data.targetType.toLowerCase() : "";
      var targetId   = (typeof data.targetId === "string") ? data.targetId : "";
      var reason     = (typeof data.reason === "string") ? data.reason.toLowerCase() : "";
      var details    = (typeof data.details === "string") ? data.details.substring(0, MAX_DETAILS_LEN) : "";
      var gameId     = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";

      if (!VALID_TARGET_TYPES[targetType]) return RpcHelpers.errorResponse("targetType must be one of: user, group, challenge, chat");
      if (!targetId) return RpcHelpers.errorResponse("targetId is required");
      if (!VALID_REASONS[reason]) return RpcHelpers.errorResponse("reason must be one of: spam, harassment, inappropriate_name, inappropriate_content, cheating, impersonation, other");
      if (targetType === "user" && targetId === reporterId) return RpcHelpers.errorResponse("You cannot report yourself");

      // ── Reporter daily cap (report-bombing guard) ───────────────────────
      var dayKey = "rl_reports_" + reporterId + "_" + new Date().toISOString().slice(0, 10);
      var used = 0;
      try {
        var rlRows = nk.storageRead([{ collection: COUNTERS_COLLECTION, key: dayKey, userId: SYSTEM_USER }]);
        if (rlRows && rlRows.length > 0 && rlRows[0] && rlRows[0].value) used = rlRows[0].value.count || 0;
      } catch (_) {}
      if (used >= REPORTER_DAILY_CAP) {
        return RpcHelpers.errorResponse("Daily report limit reached — thank you, our team is on it");
      }

      // ── Duplicate-report idempotency (same reporter → same target, 7d) ──
      var dedupKey = pairDedupKey(reporterId, targetType, targetId);
      try {
        var dupRows = nk.storageRead([{ collection: REPORTS_COLLECTION, key: dedupKey, userId: SYSTEM_USER }]);
        if (dupRows && dupRows.length > 0 && dupRows[0] && dupRows[0].value) {
          var prior: any = dupRows[0].value;
          if (Date.parse(prior.reportedAt || "") > Date.now() - COUNTER_WINDOW_MS) {
            return RpcHelpers.successResponse({ reportId: prior.reportId, alreadyReported: true });
          }
        }
      } catch (_) {}

      // ── Write the report (immutable row + dedup marker) ─────────────────
      var reportId = "rpt_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1679616).toString(36);
      var report = {
        reportId: reportId, gameId: gameId,
        reporterId: reporterId,
        targetType: targetType, targetId: targetId,
        reason: reason, details: details,
        status: "open",                      // open | reviewed | actioned | dismissed
        reportedAt: new Date().toISOString()
      };
      nk.storageWrite([
        { collection: REPORTS_COLLECTION, key: reportId, userId: SYSTEM_USER,
          value: report, permissionRead: 0, permissionWrite: 0 },
        { collection: REPORTS_COLLECTION, key: dedupKey, userId: SYSTEM_USER,
          value: { reportId: reportId, reportedAt: report.reportedAt }, permissionRead: 0, permissionWrite: 0 },
        { collection: COUNTERS_COLLECTION, key: dayKey, userId: SYSTEM_USER,
          value: { count: used + 1 }, permissionRead: 0, permissionWrite: 0 }
      ]);

      // ── Rolling 7-day target counter + auto-flag (OCC, retry once) ──────
      var counterKey = targetType + "_" + targetId;
      var total = 1;
      for (var attempt = 0; attempt < 2; attempt++) {
        var cur: any = null, version = "";
        try {
          var cRows = nk.storageRead([{ collection: COUNTERS_COLLECTION, key: counterKey, userId: SYSTEM_USER }]);
          if (cRows && cRows.length > 0 && cRows[0] && cRows[0].value) {
            cur = cRows[0].value; version = cRows[0].version || "";
          }
        } catch (_) {}
        var counter: any;
        if (cur && typeof cur.windowStart === "number" && (Date.now() - cur.windowStart) < COUNTER_WINDOW_MS) {
          counter = cur; counter.count = (counter.count || 0) + 1;
        } else {
          counter = { targetType: targetType, targetId: targetId, count: 1, windowStart: Date.now() };
        }
        total = counter.count;
        var wreq: any = { collection: COUNTERS_COLLECTION, key: counterKey, userId: SYSTEM_USER,
                          value: counter, permissionRead: 0, permissionWrite: 0 };
        if (version) wreq.version = version;
        try { nk.storageWrite([wreq]); break; }
        catch (occ) { if (attempt === 1) break; }
      }

      // Per-app threshold from the registry moderation config (default 5).
      var threshold = DEFAULT_FLAG_THRESHOLD;
      try {
        if (typeof SocialAppRegistry !== "undefined" && SocialAppRegistry.resolveApp) {
          var app: any = SocialAppRegistry.resolveApp(nk, gameId);
          if (app && app.moderation && typeof app.moderation.reportAutoFlagThreshold === "number") {
            threshold = app.moderation.reportAutoFlagThreshold;
          }
        }
      } catch (_) {}

      var flagged = false;
      if (total >= threshold) {
        flagged = true;
        try {
          nk.storageWrite([{
            collection: FLAGS_COLLECTION, key: counterKey, userId: SYSTEM_USER,
            value: { targetType: targetType, targetId: targetId, gameId: gameId,
                     reportCount7d: total, flaggedAt: new Date().toISOString(), status: "pending_review" },
            permissionRead: 0, permissionWrite: 0
          }]);
          logger.warn("[Reports] AUTO-FLAGGED " + targetType + " " + targetId + " (" + total + " reports/7d)");
        } catch (_) {}
      }

      return RpcHelpers.successResponse({ reportId: reportId, received: true, flaggedForReview: flagged });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to submit report");
    }
  }

  // ── Moderation queue read for ops tooling (service token) ────────────────
  function rpcReportsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data: any = {};
      try { data = payload ? JSON.parse(payload) : {}; } catch (_) {}
      var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                           (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
      if (!expected || data.service_token !== expected) {
        return RpcHelpers.errorResponse("service-only", 401);
      }

      var flaggedOnly = data.flaggedOnly === true;
      var limit = (typeof data.limit === "number" && data.limit > 0) ? Math.min(data.limit, 200) : 50;
      var collection = flaggedOnly ? FLAGS_COLLECTION : REPORTS_COLLECTION;

      var rows: any = nk.storageList(SYSTEM_USER, collection, limit,
        (typeof data.cursor === "string" && data.cursor) ? data.cursor : (undefined as any));
      var objs: any[] = (rows && rows.objects) ? rows.objects : [];
      var items: any[] = [];
      for (var i = 0; i < objs.length; i++) {
        var v: any = objs[i] && objs[i].value;
        // Skip dedup marker rows (they live in the same collection).
        if (!v || (!flaggedOnly && !v.reportId)) continue;
        items.push(v);
      }
      return RpcHelpers.successResponse({
        items: items, count: items.length,
        nextCursor: (rows && rows.cursor) ? rows.cursor : ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to list reports");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_report", rpcReport);
    initializer.registerRpc("ivx_social_reports_list", rpcReportsList);
  }
}
