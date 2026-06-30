// Phase 2A (qv-insights-loop) — Pending bundles DLQ.
//
// When InsightsAggregator can't deliver a bundle to the AI svc (network
// blip, AI svc down, HMAC misconfigured) we persist the envelope here so
// it survives the next deploy / pod restart and can be re-driven by
// `pending_bundles_drain` on the next aggregator tick (or manually via
// the admin RPC).
//
// Storage layout:
//   collection: pending_bundles
//   userId:     "" (system-owned)
//   key:        bundleId (idempotent — re-enqueue is a no-op replace)
//   value:      { bundle, attempts, firstSeenMs, lastTriedMs, lastError }
//
// We cap retries at MAX_ATTEMPTS to stop a poison pill from chewing up
// every tick forever. After cap, the row is moved to a `dead_bundles`
// collection (still queryable, no longer auto-retried) and a Discord
// warning is fired so a human can look at it.

namespace PendingBundles {

  export var COLLECTION = "pending_bundles";
  export var DEAD_COLLECTION = "dead_bundles";
  export var MAX_ATTEMPTS = 8;
  export var MAX_DRAIN_PER_TICK = 50;
  export var BACKOFF_BASE_MS = 60_000; // 1 min, exponential

  interface PendingRow {
    bundle: any;
    attempts: number;
    firstSeenMs: number;
    lastTriedMs: number;
    lastError: string;
  }

  export function enqueue(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    bundle: any,
  ): void {
    if (!bundle || !bundle.bundleId) return;
    var now = Date.now();
    var existing = readOne(nk, bundle.bundleId);
    var row: PendingRow = existing ? existing : {
      bundle: bundle,
      attempts: 0,
      firstSeenMs: now,
      lastTriedMs: 0,
      lastError: "",
    };
    if (existing) {
      row.bundle = bundle; // overwrite payload with latest snapshot
      row.lastTriedMs = now;
      row.attempts = (row.attempts || 0) + 1;
    }
    try {
      nk.storageWrite([{
        collection: COLLECTION,
        key: bundle.bundleId,
        userId: "00000000-0000-0000-0000-000000000000",
        value: row,
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (e: any) {
      logger.warn("[PendingBundles] enqueue failed for " + bundle.bundleId + ": " +
        (e && e.message ? e.message : String(e)));
    }
  }

  export function drain(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    poster: (bundle: any) => boolean,
  ): { drained: number; deadLetters: number } {
    var drained = 0;
    var deadLetters = 0;
    try {
      var listRes: any = nk.storageList("", COLLECTION, MAX_DRAIN_PER_TICK);
      var objs = (listRes && listRes.objects) || [];
      var now = Date.now();
      for (var i = 0; i < objs.length; i++) {
        var row: PendingRow = objs[i].value as any;
        if (!row || !row.bundle) continue;
        var attempts = row.attempts || 0;
        var nextEligible = row.lastTriedMs + Math.min(60 * 60 * 1000, BACKOFF_BASE_MS * Math.pow(2, attempts));
        if (now < nextEligible) continue;
        var ok = false;
        try {
          ok = poster(row.bundle);
        } catch (e: any) {
          row.lastError = e && e.message ? e.message : String(e);
        }
        if (ok) {
          // Delete on success.
          try {
            nk.storageDelete([{ collection: COLLECTION, key: objs[i].key, userId: "00000000-0000-0000-0000-000000000000" }]);
            drained++;
          } catch (_) {}
          continue;
        }
        row.attempts = attempts + 1;
        row.lastTriedMs = now;
        if (row.attempts >= MAX_ATTEMPTS) {
          try {
            nk.storageWrite([{
              collection: DEAD_COLLECTION,
              key: objs[i].key,
              userId: "00000000-0000-0000-0000-000000000000",
              value: row,
              permissionRead: 0,
              permissionWrite: 0,
            }]);
            nk.storageDelete([{ collection: COLLECTION, key: objs[i].key, userId: "00000000-0000-0000-0000-000000000000" }]);
          } catch (_) {}
          deadLetters++;
          fireDeadLetterAlert(nk, logger, row);
          continue;
        }
        try {
          nk.storageWrite([{
            collection: COLLECTION,
            key: objs[i].key,
            userId: "00000000-0000-0000-0000-000000000000",
            value: row,
            permissionRead: 0,
            permissionWrite: 0,
          }]);
        } catch (_) {}
      }
    } catch (e: any) {
      logger.warn("[PendingBundles] drain failed: " +
        (e && e.message ? e.message : String(e)));
    }
    return { drained: drained, deadLetters: deadLetters };
  }

  function readOne(nk: nkruntime.Nakama, key: string): PendingRow | null {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: "00000000-0000-0000-0000-000000000000" }]);
      if (rows && rows.length > 0 && rows[0].value) {
        return rows[0].value as PendingRow;
      }
    } catch (_) {}
    return null;
  }

  function fireDeadLetterAlert(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    row: PendingRow,
  ): void {
    var url = "";
    try {
      if (typeof InsightsAggregator !== "undefined" && InsightsAggregator
        && typeof InsightsAggregator.getQvOpsWebhookUrl === "function") {
        url = InsightsAggregator.getQvOpsWebhookUrl();
      }
    } catch (_) {}
    if (!url) return;
    var b = row.bundle || {};
    var content = ":warning: DLQ-letter — persistent failure delivering insights bundle " +
      "`" + (b.bundleId || "unknown") + "` after " + row.attempts +
      " attempts. lastError=`" + (row.lastError || "n/a").slice(0, 200) + "`" +
      " gameId=" + (b.gameId || "?") + " cohort=" + (b.cohortLabel || "?") +
      " bucket=" + (b.bucketStartIso || "?");
    try {
      var payload = JSON.stringify({
        username: "qv-insights-aggregator",
        content: content.slice(0, 1900),
      });
      nk.httpRequest(url, "post", {
        "Content-Type": "application/json",
      }, payload, 5000);
    } catch (e: any) {
      logger.warn("[PendingBundles] dead-letter alert failed: " +
        (e && e.message ? e.message : String(e)));
    }
  }

  function rpcAdminDrain(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    _payload: string,
  ): string {
    // System (no userId) or operator with the well-known admin token only.
    if (typeof ctx.userId === "string" && ctx.userId !== "") {
      return JSON.stringify({ success: false, error: "admin_only" });
    }
    var res = drain(nk, logger, function (bundle: any): boolean {
      if (typeof InsightsAggregator !== "undefined" && InsightsAggregator
        && typeof InsightsAggregator.postBundleNow === "function") {
        return InsightsAggregator.postBundleNow(nk, logger, bundle);
      }
      return false;
    });
    return JSON.stringify({ success: true, data: res });
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("pending_bundles_drain", rpcAdminDrain);
  }
}
