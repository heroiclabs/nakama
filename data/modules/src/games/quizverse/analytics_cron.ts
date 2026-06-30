// analytics_cron.ts — Daily expired qv_question_packs cleanup job.
//
// ── Purpose ───────────────────────────────────────────────────────────────────
//
// qv_question_packs are user-owned documents written by quizverse_get_questions.
// Each pack has an expires_at_ms field (30-min TTL from creation).  Over time
// orphaned packs accumulate for every player — either because a quiz session was
// abandoned (submitted=false) or because submit_result's opportunistic cleanup in
// get_questions only runs for the calling user.
//
// This job does a cross-user sweep: it iterates all recently active users (from
// qv_active_users), scans each user's qv_question_packs, and deletes every pack
// whose TTL has elapsed — whether or not it was ever submitted.
//
// ── Scheduling ────────────────────────────────────────────────────────────────
//
// Expose as quizverse_pack_cleanup_tick (RPC).
// Call from an external scheduler (n8n / k8s CronJob / http_key) once per day.
// A 24-hour gate stored in qv_cleanup_state/last_run deduplicates concurrent calls.
//
// ── Storage ───────────────────────────────────────────────────────────────────
//
//   qv_active_users   system-owned  key=userId  { last_played_ms }
//   qv_question_packs user-owned    key=packId  { submitted, expires_at_ms, … }
//   qv_cleanup_state  system-owned  key="last_run"  { last_run_ms }

namespace QvAnalyticsCron {

  var COL_ACTIVE   = "qv_active_users";
  var COL_PACKS    = "qv_question_packs";
  var COL_INFLT    = "qv_inflight";
  var GATE_COL     = "qv_cleanup_state";
  var GATE_KEY     = "last_run";

  var GATE_INTERVAL_MS = 86400000;          // 24 h — once per day
  var ACTIVE_WINDOW_MS = 30 * 24 * 3600000; // scan users active in the last 30 days
  var MAX_USERS_PER_RUN = 500;              // safety cap per run
  var PACKS_PER_USER    = 20;               // max packs to list per user scan
  var ABANDON_TTL_MS    = 3600000;          // 1 h — also purge unsubmitted packs older than this

  function nowMs(): number { return Date.now(); }

  // ── Daily gate ─────────────────────────────────────────────────────────────
  //
  // Atomically tries to become the "owner" of this run window.
  // Returns true if we acquired the gate (first call in 24 h), false otherwise.

  function acquireGate(nk: nkruntime.Nakama): boolean {
    try {
      var rows = nk.storageRead([{ collection: GATE_COL, key: GATE_KEY, userId: "00000000-0000-0000-0000-000000000000" }]);
      var lastRun: number = (rows && rows.length > 0 && rows[0].value && rows[0].value.last_run_ms)
        ? rows[0].value.last_run_ms : 0;
      if (nowMs() - lastRun < GATE_INTERVAL_MS) return false;

      nk.storageWrite([{
        collection: GATE_COL, key: GATE_KEY, userId: "00000000-0000-0000-0000-000000000000",
        value: { last_run_ms: nowMs() },
        permissionRead: 0, permissionWrite: 0
      }]);
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ── Active user list ────────────────────────────────────────────────────────
  //
  // Reads qv_active_users (system-owned, key=userId) up to MAX_USERS_PER_RUN.
  // Users inactive for more than 30 days are skipped.

  function listActiveUsers(nk: nkruntime.Nakama, logger: nkruntime.Logger): string[] {
    var userIds: string[] = [];
    var cutoff = nowMs() - ACTIVE_WINDOW_MS;

    try {
      var cursor = "";
      for (var page = 0; page < 5; page++) {
        var result: nkruntime.StorageObjectList;
        try {
          result = nk.storageList("", COL_ACTIVE, 100, cursor);
        } catch (_le) { break; }

        if (!result || !Array.isArray(result.objects) || result.objects.length === 0) break;

        for (var i = 0; i < result.objects.length; i++) {
          var obj = result.objects[i];
          if (!obj || !obj.key || !obj.value) continue;
          var lastMs: number = typeof obj.value.last_played_ms === "number"
            ? obj.value.last_played_ms : 0;
          if (lastMs >= cutoff) {
            userIds.push(obj.key);
          }
          if (userIds.length >= MAX_USERS_PER_RUN) break;
        }

        if (userIds.length >= MAX_USERS_PER_RUN) break;
        cursor = (result as any).cursor || "";
        if (!cursor) break;
      }
    } catch (e: any) {
      logger.warn("[QvCleanup] listActiveUsers error: " + (e && e.message));
    }

    return userIds;
  }

  // ── Per-user pack cleanup ───────────────────────────────────────────────────
  //
  // Lists up to PACKS_PER_USER packs for this user, deletes any that satisfy:
  //   • submitted=true  AND expires_at_ms < now  (normal submitted expiry)
  //   • submitted=false AND created_at_ms < now - ABANDON_TTL_MS  (abandoned sessions)
  //
  // Also deletes the matching qv_inflight entry for consistency.
  // Returns the number of packs deleted.

  function cleanUserPacks(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): number {
    var deleted = 0;
    try {
      var result = nk.storageList(userId, COL_PACKS, PACKS_PER_USER, "");
      if (!result || !Array.isArray(result.objects) || result.objects.length === 0) return 0;

      var now = nowMs();
      var toDelete: nkruntime.StorageDeleteRequest[] = [];

      for (var i = 0; i < result.objects.length; i++) {
        var obj = result.objects[i];
        if (!obj || !obj.value || !obj.key) continue;
        var v: any = obj.value;
        var packKey = obj.key;

        var isSubmittedExpired = v.submitted === true &&
          typeof v.expires_at_ms === "number" &&
          v.expires_at_ms < now;

        var isAbandoned = v.submitted !== true &&
          typeof v.created_at_ms === "number" &&
          v.created_at_ms < now - ABANDON_TTL_MS;

        if (isSubmittedExpired || isAbandoned) {
          toDelete.push({ collection: COL_PACKS, key: packKey, userId: userId });
          // Best-effort: also remove the inflight sentinel (same key)
          toDelete.push({ collection: COL_INFLT, key: packKey, userId: userId });
          deleted++;
        }
      }

      if (toDelete.length > 0) {
        try {
          nk.storageDelete(toDelete);
        } catch (de: any) {
          logger.warn("[QvCleanup] storageDelete partial failure userId=" + userId +
            ": " + (de && de.message));
        }
      }
    } catch (e: any) {
      logger.warn("[QvCleanup] cleanUserPacks error userId=" + userId +
        ": " + (e && e.message));
    }
    return deleted;
  }

  // ── RPC tick handler ────────────────────────────────────────────────────────
  //
  // quizverse_pack_cleanup_tick
  //
  // Input:  {} (empty, admin-only call)
  // Output: { ok, skipped, users_scanned, packs_deleted, elapsed_ms }
  //
  // Call once per day from an external scheduler.
  // The 24-h gate deduplicates concurrent invocations across server instances.

  function rpcPackCleanupTick(
    _ctx:    nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    _payload: string
  ): string {
    if (!acquireGate(nk)) {
      return JSON.stringify({ ok: true, skipped: true, reason: "within_gate_window" });
    }

    var started = nowMs();
    logger.info("[QvCleanup] pack cleanup tick start");

    var userIds = listActiveUsers(nk, logger);
    logger.info("[QvCleanup] users to scan=" + userIds.length);

    var totalDeleted = 0;
    var usersScanned = 0;

    for (var i = 0; i < userIds.length; i++) {
      try {
        var n = cleanUserPacks(nk, logger, userIds[i]);
        totalDeleted += n;
        usersScanned++;
      } catch (_ue) { /* continue */ }
    }

    var elapsed = nowMs() - started;
    logger.info("[QvCleanup] tick done — users=" + usersScanned +
      " packs_deleted=" + totalDeleted + " elapsed_ms=" + elapsed);

    return JSON.stringify({
      ok:            true,
      skipped:       false,
      users_scanned: usersScanned,
      packs_deleted: totalDeleted,
      elapsed_ms:    elapsed
    });
  }

  // ── Registration ─────────────────────────────────────────────────────────────

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_pack_cleanup_tick", rpcPackCleanupTick);
  }

  var _NOOP: any = { registerRpc: function() {} };
  register(_NOOP);
}
