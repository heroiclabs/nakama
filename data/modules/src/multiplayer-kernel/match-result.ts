// MatchResultEnvelope persistence + AnalyticsAlerts wiring (Pillar 1).
//
// Templates call MpKernelMatchResult.persist(...) on natural / forced
// match end. The result is stored in Hiro storage under a deterministic
// key (audit-able) AND fanned out as an analytics event so the per-game
// dashboard (Pillar 9) and SLO board (Pillar 10) can update.

namespace MpKernelMatchResult {
  export var COLLECTION = "mp_match_results";

  // Default match-result retention in storage. Operators can override
  // per-template via setRetentionDays().
  export var DEFAULT_RETENTION_DAYS = 90;
  var retentionDays = DEFAULT_RETENTION_DAYS;

  export function setRetentionDays(days: number): void {
    if (days > 0) retentionDays = days;
  }

  export function persist(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    result: MpKernel.IMatchResultEnvelope
  ): { ok: boolean; error?: string } {
    if (!result.match_id || !result.template_id || !result.game_id) {
      return { ok: false, error: "missing required identifiers" };
    }
    var key = result.match_id;
    var write: nkruntime.StorageWriteRequest = {
      collection: COLLECTION,
      key: key,
      value: result as any,
      // Permissions: 1 = owner-only read; 0 = no public write.
      permissionRead: 2,   // public-read (admin dashboard reads under system).
      permissionWrite: 0,
      userId: ""           // System-owned record.
    };
    try {
      nk.storageWrite([write]);
    } catch (e: any) {
      logger.warn("[MpKernelMatchResult] storageWrite failed match=%s err=%s",
        result.match_id, (e && e.message) ? e.message : String(e));
      return { ok: false, error: (e && e.message) ? e.message : String(e) };
    }

    // Best-effort analytics emission. Mirrors the existing AnalyticsAlerts
    // shape so the same Discord summarizer / Grafana exporter pipeline
    // picks up multiplayer matches without a separate ingest.
    //
    // Phase 0 fix (qv-insights-loop): the previous call passed a single
    // object literal but recordSample's actual signature is positional:
    //   recordSample(nk, logger, rpc, durMs, ok, err?, userId?)
    // (see data/modules/src/satori/analytics-alerts.ts line 145). The
    // object-style call silently no-op'd because the buffered sample was
    // never built. We now call the function correctly. Match-level context
    // (game_id, template_id, region, player_count) is encoded into the
    // rpc string until Phase 1A's universal enricher provides a richer
    // shape.
    try {
      if (typeof AnalyticsAlerts !== "undefined" && AnalyticsAlerts && typeof (AnalyticsAlerts as any).recordSample === "function") {
        var rpcId = "mp_match_finished:" + result.template_id + ":" + result.game_id;
        // Best-effort owner attribution: pick the first non-agent outcome.
        var ownerUserId: string | undefined = undefined;
        for (var i = 0; i < result.outcomes.length; i++) {
          if (!result.outcomes[i].is_agent) {
            ownerUserId = result.outcomes[i].user_id;
            break;
          }
        }
        AnalyticsAlerts.recordSample(
          nk,
          logger,
          rpcId,
          result.duration_ms,
          true,
          undefined,
          ownerUserId,
        );
      }
    } catch (e: any) {
      logger.warn("[MpKernelMatchResult] analytics record swallowed: %s",
        (e && e.message) ? e.message : String(e));
    }

    return { ok: true };
  }

  export function read(
    nk: nkruntime.Nakama,
    matchId: string
  ): MpKernel.IMatchResultEnvelope | null {
    try {
      var rows = nk.storageRead([{
        collection: COLLECTION,
        key: matchId,
        userId: ""
      }]);
      if (!rows || rows.length === 0) return null;
      return rows[0].value as MpKernel.IMatchResultEnvelope;
    } catch (e) {
      return null;
    }
  }

  // Build a baseline outcome row, leaving game-specific fields for the
  // template's buildResult() to fill.
  export function newOutcome(userId: string, isAgent: boolean): MpKernel.IPlayerOutcome {
    return {
      user_id: userId,
      is_agent: isAgent,
      placement: 0,
      score: 0,
      completed: false,
      left_early: false
    };
  }
}
