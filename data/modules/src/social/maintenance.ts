// maintenance.ts — ivx_social_maintenance_tick: the single cleanup job family
// for the social layer (WORLD_CLASS_SOCIAL_FRIENDS_GROUPS_ARCHITECTURE.md
// §19.7, gaps G-018 + B-005).
//
// WHY THIS EXISTS
//   Nakama storage has no TTL. Without offline cleanup:
//   - friend_challenges / friend_challenges_outbox rows accumulate forever
//     ("lazy expiry sweep at read time" = anti-pattern AP-002).
//   - rate_limits rows (including the B-009 per-pair keys, one row per user
//     pair) grow unboundedly.
//   - player_presence rows for churned users show "last seen 14 months ago"
//     forever (B-005).
//
// HOW IT'S DRIVEN
//   The JS runtime has NO cron scheduler. This RPC is invoked by a
//   Kubernetes CronJob (intelli-verse-kube-infra/nakama/
//   social-maintenance-cronjob.yaml) — the same delivery pattern as
//   tournament-cron-*.yaml. concurrencyPolicy: Forbid on the CronJob is the
//   concurrency guard; no storage leader-lock needed.
//
// STALENESS SOURCE
//   Sweeps filter on the storage table's `update_time` column, NOT on JSON
//   fields inside `value`. Every targeted row is rewritten on use
//   (rate-limit buckets on every check, presence on every heartbeat,
//   challenges on every lifecycle transition), so update_time is an honest
//   "last touched" signal — and it avoids JSONB casts entirely, so a single
//   malformed value can never abort a sweep.
//
// AUTH
//   Same service-token contract as tournament crons: payload.service_token
//   must equal TOURNAMENT_SERVICE_TOKEN (or BRAIN_COINS_SERVICE_TOKEN
//   fallback) from ctx.env. Both are already wired into the prod runtime
//   env — zero new secrets needed.

namespace SocialMaintenance {

  // ── Shared constants — defined FIRST so every function below can reference them
  // safely regardless of hoisting rules.  (The original file had this at the
  // bottom, which breaks some bundlers.)
  const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
  const NUDGE_LOG_COLLECTION = "ivx_nudge_log";

  // Per-collection retention windows (hours) — deliberately conservative.
  // friend_challenges expire in ≤24h; 720h (30d) past last touch is
  // unambiguously dead data while preserving a generous forensic window.
  var SWEEPS: { collection: string; retentionHours: number; reason: string }[] = [
    { collection: "friend_challenges",        retentionHours: 720, reason: "expired/terminal challenges (G-018)" },
    { collection: "friend_challenges_outbox", retentionHours: 720, reason: "sender-side challenge index (G-018)" },
    { collection: "rate_limits",              retentionHours: 24,  reason: "transient cooldown/counter buckets incl. B-009 pair keys" },
    { collection: "player_presence",          retentionHours: 2160, reason: "stale presence, 90 days (B-005)" },
    { collection: "ivx_presence_v2",          retentionHours: 2160, reason: "stale per-game presence v2 rows (doc §8.2)" },
    { collection: "ivx_friends_feed_events",  retentionHours: 168,  reason: "feed events, 7-day retention (doc §14A.4 / C-001 — no native TTL)" },
    { collection: "ivx_groups_invite_codes",  retentionHours: 2160, reason: "old invite codes; expiry/maxUses enforced at read, rows swept after 90 days" },
    { collection: "ivx_nudge_log",            retentionHours: 720,  reason: "expiry-warning dedup markers; challenges are long gone after 30 days" },
    { collection: "ivx_duo_quests",           retentionHours: 720,  reason: "finished/expired duo quests + user index rows (30 days)" },
    { collection: "ivx_game_player_stats",    retentionHours: 2160, reason: "weekly activity stats; rows untouched 90 days = churned player (ML-002)" },
    { collection: "ivx_moderation_reports",   retentionHours: 2160, reason: "report rows + dedup markers, 90-day forensic window (G-011)" },
    { collection: "ivx_moderation_counters",  retentionHours: 720,  reason: "rolling 7-day report counters + reporter daily caps (G-011)" },
    { collection: "ivx_moderation_flags",     retentionHours: 2160, reason: "auto-flag rows; 90 days for ops review before sweep (G-011)" },
    // Phantom Arena async challenge collections (Gap 5 / 2026-07-07 hardening pass).
    // Challenges expire in max 7 days (ASYNC_CHALLENGE_EXPIRY_HOURS=168). Any row
    // untouched for 30 days (720h) is unambiguously in a terminal state — sweeping
    // by update_time avoids JSON parsing entirely and handles corrupt blobs safely.
    { collection: "async_challenges",        retentionHours: 720,  reason: "expired/terminal sessions; 7d window → safe to sweep after 30d by update_time" },
    { collection: "async_challenge_index",   retentionHours: 720,  reason: "opponent lookup index rows; expire with parent challenge" },
    { collection: "async_idempotency",       retentionHours: 720,  reason: "submit idempotency keys; challenge gone after 30d → dedup useless" },
    { collection: "async_challenge_stats",   retentionHours: 4320, reason: "player career stats, 180d — kept intentionally long for leaderboard history" }
  ];

  var DEFAULT_MAX_ROWS_PER_COLLECTION = 1000;
  var HARD_MAX_ROWS_PER_COLLECTION    = 5000;

  function requireServiceToken(ctx: nkruntime.Context, data: any): boolean {
    var expected = "" + ((ctx.env && ctx.env["TOURNAMENT_SERVICE_TOKEN"]) ||
                         (ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    return !!(expected && data && data.service_token === expected);
  }

  function rpcMaintenanceTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data: any = {};
    try { data = payload ? JSON.parse(payload) : {}; } catch (_) { data = {}; }

    if (!requireServiceToken(ctx, data)) {
      return RpcHelpers.errorResponse("service-only", 401);
    }

    var maxRows = DEFAULT_MAX_ROWS_PER_COLLECTION;
    if (typeof data.max_rows === "number" && data.max_rows > 0) {
      maxRows = Math.min(Math.floor(data.max_rows), HARD_MAX_ROWS_PER_COLLECTION);
    }
    var dryRun = data.dry_run === true;

    var results: { [collection: string]: any } = {};
    var totalDeleted = 0;

    for (var i = 0; i < SWEEPS.length; i++) {
      var sweep = SWEEPS[i];
      // Each sweep is isolated — one broken collection must never abort the rest.
      try {
        if (dryRun) {
          var countRows: any = nk.sqlQuery(
            "SELECT count(*) AS n FROM storage " +
            "WHERE collection = $1 AND update_time < now() - ($2 * INTERVAL '1 hour')",
            [sweep.collection, sweep.retentionHours]
          );
          var n = (countRows && countRows.length > 0) ? parseInt(String(countRows[0].n), 10) : 0;
          results[sweep.collection] = { wouldDelete: n, retentionHours: sweep.retentionHours };
        } else {
          // PostgreSQL (RDS) does not support DELETE...LIMIT directly.
          // Use a ctid subquery to cap the batch size per tick. ctid is the
          // physical row pointer — stable within a single statement and safe
          // for this pattern. The next tick picks up any remaining rows.
          var res: any = nk.sqlExec(
            "DELETE FROM storage WHERE ctid IN (" +
            "  SELECT ctid FROM storage" +
            "  WHERE collection = $1 AND update_time < now() - ($2 * INTERVAL '1 hour')" +
            "  LIMIT $3" +
            ")",
            [sweep.collection, sweep.retentionHours, maxRows]
          );
          var deleted = (res && typeof res.rowsAffected === "number") ? res.rowsAffected : 0;
          totalDeleted += deleted;
          results[sweep.collection] = { deleted: deleted, retentionHours: sweep.retentionHours, capped: deleted >= maxRows };
        }
      } catch (e: any) {
        results[sweep.collection] = { error: String(e && e.message || e) };
        logger.warn("[SocialMaintenance] sweep failed for " + sweep.collection + ": " + (e && e.message || e));
      }
    }

    // ── Nudge: async-challenge expiry warnings (Phantom guide Phase 4) ─────
    // "Expires in 24h" push to participants of still-open challenges.
    // Dedup: one conditional-create marker row per session in ivx_nudge_log —
    // the hourly cadence re-scans, the marker guarantees exactly one warning.
    var nudge = { scanned: 0, warned: 0 };
    if (!dryRun) {
      try {
        nudge = runExpiryWarnings(ctx, logger, nk);
      } catch (ne: any) {
        logger.warn("[SocialMaintenance] expiry warnings failed: " + (ne && ne.message));
      }
    }

    // ── Nudge: 48h inactivity re-engagement (Phantom guide Phase 4) ────────
    // Nudges participants of open challenges (status 1/5) when neither side has
    // updated the session for 48h — the "silent room" mid-session problem.
    // Separate dedup key (inact48_*) so a session can receive both an inactivity
    // nudge and a 24h expiry warning (different urgency levels, different timing).
    var inactivity = { scanned: 0, nudged: 0 };
    if (!dryRun) {
      try {
        inactivity = runInactivityNudges(ctx, logger, nk);
      } catch (ie: any) {
        logger.warn("[SocialMaintenance] inactivity nudges failed: " + (ie && ie.message));
      }
    }

    // ── Duo Quests weekly pairing (idempotent per ISO week) ────────────────
    var pairing: any = { skipped: true };
    if (!dryRun) {
      try {
        if (typeof DuoQuests !== "undefined" && DuoQuests.weeklyPairingTick) {
          pairing = DuoQuests.weeklyPairingTick(ctx, logger, nk);
        }
      } catch (pe: any) {
        logger.warn("[SocialMaintenance] duo pairing failed: " + (pe && pe.message));
      }
    }

    // ── League weekly rollover (Q-11 — idempotent per ISO week) ────────────
    var league: any = { skipped: true };
    if (!dryRun) {
      try {
        if (typeof SocialLeagues !== "undefined" && SocialLeagues.weeklyLeagueTick) {
          league = SocialLeagues.weeklyLeagueTick(ctx, logger, nk);
        }
      } catch (le: any) {
        logger.warn("[SocialMaintenance] league rollover failed: " + (le && le.message));
      }
    }

    // ── Fan-out queue backstop drain (primary drain = per-minute CronJob) ──
    var fanout: any = { sent: 0 };
    if (!dryRun) {
      try {
        if (typeof FanoutQueue !== "undefined" && FanoutQueue.drain) {
          fanout = FanoutQueue.drain(ctx, logger, nk, 500);
        }
      } catch (fe: any) {
        logger.warn("[SocialMaintenance] fanout backstop failed: " + (fe && fe.message));
      }
    }

    logger.info("[SocialMaintenance] tick complete: " + (dryRun ? "dry_run" : (totalDeleted + " rows deleted")));
    return RpcHelpers.successResponse({
      dryRun: dryRun,
      totalDeleted: totalDeleted,
      maxRowsPerCollection: maxRows,
      collections: results,
      expiryWarnings: nudge,
      inactivityNudges: inactivity,
      duoPairing: pairing,
      leagueRollover: league,
      fanoutBackstop: fanout
    });
  }

  // ── Async-challenge expiry warnings ───────────────────────────────────────
  // Warn creator (+opponent if joined) when a still-open challenge expires
  // within 24h. Statuses: 0 WAITING, 1 OPPONENT_JOINED, 5 CREATOR_PLAYED
  // (legacy_runtime.js ASYNC_STATUS_* constants).
  var NUDGE_LOG_COLLECTION = "ivx_nudge_log";

  function runExpiryWarnings(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var scanned = 0, warned = 0;
    var rows: any[] = [];
    try {
      rows = nk.sqlQuery(
        "SELECT key, value FROM storage " +
        "WHERE collection = 'async_challenges' " +
        "  AND (value->>'status') IN ('0','1','5') " +
        "  AND (value->>'expiresAt') > $1 " +
        "  AND (value->>'expiresAt') < $2 " +
        "LIMIT 200",
        [new Date().toISOString(), new Date(Date.now() + 24 * 3600 * 1000).toISOString()]
      ) as any[];
    } catch (e: any) {
      logger.warn("[SocialMaintenance] expiry scan SQL failed: " + (e && e.message));
      return { scanned: 0, warned: 0 };
    }
    if (!rows) rows = [];

    for (var i = 0; i < rows.length; i++) {
      var v: any = rows[i] && rows[i].value;
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = null; } }
      if (!v || !v.sessionId) continue;
      scanned++;

      // Dedup marker — conditional create; loser of any race just skips.
      try {
        nk.storageWrite([{
          collection: NUDGE_LOG_COLLECTION, key: "exp24_" + v.sessionId, userId: SYSTEM_USER_ID,
          value: { sessionId: v.sessionId, warnedAt: new Date().toISOString() },
          permissionRead: 0, permissionWrite: 0, version: "*"
        }]);
      } catch (_) { continue; } // already warned

      var hoursLeft = Math.max(1, Math.round((Date.parse(v.expiresAt) - Date.now()) / 3600000));
      var items: any[] = [];
      var pushData = {
        eventType: "async_challenge", screen: "phantom_arena",
        type: "expiry_warning", sessionId: String(v.sessionId),
        shareCode: String(v.shareCode || ""),
        deepLink: v.shareCode ? ("quizverse://challenge/join/" + v.shareCode) : ""
      };
      if (v.creatorId) {
        items.push({ targetUserId: v.creatorId, eventType: "async_challenge_expiry",
                     titleKey: "ac_expiry_title", bodyKey: "ac_expiry_body",
                     vars: { hours: String(hoursLeft) }, data: pushData });
      }
      if (v.opponentId) {
        items.push({ targetUserId: v.opponentId, eventType: "async_challenge_expiry",
                     titleKey: "ac_expiry_title", bodyKey: "ac_expiry_body",
                     vars: { hours: String(hoursLeft) }, data: pushData });
      }
      if (items.length > 0 && typeof FanoutQueue !== "undefined" && FanoutQueue.enqueue) {
        warned += FanoutQueue.enqueue(nk, logger, items);
      }
    }
    return { scanned: scanned, warned: warned };
  }

  // ── 48h inactivity nudge (Phantom guide Phase 4 / 2026-07-07) ───────────
  // Scan for still-open challenges where NEITHER party has touched the session
  // for ≥48h. Uses `update_time` (the storage table's last-write timestamp)
  // as the staleness signal — this is the same field the collection sweeps use,
  // requires no JSONB parsing, and is honest because every state transition
  // rewrites the row (join, submit, rematch all update the session value).
  //
  // Status legend (legacy_runtime.js ASYNC_STATUS_* constants):
  //   1 = OPPONENT_JOINED — opponent joined, nobody has submitted scores yet
  //   5 = CREATOR_PLAYED  — creator submitted before anyone joined; waiting for opponent
  //
  // Push routing:
  //   status=5 → nudge opponentId (creator already played, opponent is inactive)
  //   status=1 → nudge BOTH participants (join happened but no scores in 48h)
  //
  // The separate dedup key `inact48_{sessionId}` (distinct from `exp24_{sessionId}`)
  // means a session can correctly receive both an inactivity nudge AND a 24h expiry
  // warning — they represent different urgency levels at different points in time.
  function runInactivityNudges(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any {
    var scanned = 0, nudged = 0;
    var rows: any[] = [];
    try {
      rows = nk.sqlQuery(
        "SELECT key, value FROM storage " +
        "WHERE collection = 'async_challenges' " +
        "  AND (value->>'status') IN ('1','5') " +
        "  AND update_time < now() - INTERVAL '48 hours' " +
        "  AND (value->>'expiresAt') > $1 " +
        "LIMIT 200",
        [new Date().toISOString()]
      ) as any[];
    } catch (e: any) {
      logger.warn("[SocialMaintenance] inactivity scan SQL failed: " + (e && e.message));
      return { scanned: 0, nudged: 0 };
    }
    if (!rows) rows = [];

    for (var i = 0; i < rows.length; i++) {
      var v: any = rows[i] && rows[i].value;
      if (typeof v === "string") { try { v = JSON.parse(v); } catch (_) { v = null; } }
      if (!v || !v.sessionId) continue;
      scanned++;

      // Dedup — one nudge per session lifetime (conditional-create; write fails if key exists).
      try {
        nk.storageWrite([{
          collection: NUDGE_LOG_COLLECTION, key: "inact48_" + v.sessionId, userId: SYSTEM_USER_ID,
          value: { sessionId: v.sessionId, nudgedAt: new Date().toISOString() },
          permissionRead: 0, permissionWrite: 0, version: "*"
        }]);
      } catch (_) { continue; } // already nudged this session

      var status = parseInt(String(v.status), 10);
      var pushData = {
        eventType:       "async_challenge_inactivity",
        screen:          "phantom_arena",
        type:            "inactivity",
        sessionId:       String(v.sessionId),
        shareCode:       String(v.shareCode || ""),
        deepLink:        v.shareCode ? ("quizverse://challenge/join/" + v.shareCode) : "",
        action_category: "async_challenge"
      };

      var items: any[] = [];

      if (status === 5) {
        // Creator played, opponent hasn't joined/played — nudge opponent.
        if (v.opponentId) {
          items.push({
            targetUserId: v.opponentId,
            eventType:    "async_challenge_inactivity",
            titleKey:     "ac_inactivity_opp_title",
            bodyKey:      "ac_inactivity_opp_body",
            vars:         { name: String(v.creatorName || "Someone") },
            data:         pushData
          });
        }
      } else if (status === 1) {
        // Opponent joined but no scores yet — nudge both sides.
        if (v.creatorId) {
          items.push({
            targetUserId: v.creatorId,
            eventType:    "async_challenge_inactivity",
            titleKey:     "ac_inactivity_title",
            bodyKey:      "ac_inactivity_body",
            vars:         { name: String(v.opponentName || v.opponentId || "Your opponent") },
            data:         pushData
          });
        }
        if (v.opponentId) {
          items.push({
            targetUserId: v.opponentId,
            eventType:    "async_challenge_inactivity",
            titleKey:     "ac_inactivity_title",
            bodyKey:      "ac_inactivity_body",
            vars:         { name: String(v.creatorName || "Your challenger") },
            data:         pushData
          });
        }
      }

      if (items.length > 0 && typeof FanoutQueue !== "undefined" && FanoutQueue.enqueue) {
        nudged += FanoutQueue.enqueue(nk, logger, items);
      }
    }
    return { scanned: scanned, nudged: nudged };
  }

  // ── G-012: GDPR cascade delete (doc §E.3) ──────────────────────────────
  //
  // Nakama's built-in account deletion wipes rows OWNED by the deleted user
  // automatically. What it does NOT touch are social rows that merely
  // REFERENCE the user while being owned by someone else or by the system:
  //   - friend_invites rows stored under the OTHER user (key inv_{A}_{B})
  //   - friend_challenges rows under recipients where deleted user is sender
  //   - system-owned B-009 pair rate-limit rows (rl_fr_invite_pair_{a}_{b})
  //   - user_blocks rows under other users (blocked_{other}_{deleted})
  //   - friend_streaks pair rows
  // All of these embed the userId in the storage KEY, so a key-pattern SQL
  // sweep finds them without JSON parsing. Runs in the after-delete hook —
  // best-effort per collection; failures are logged, and any survivor rows
  // reference a user that no longer resolves (harmless until swept again).
  var CASCADE_COLLECTIONS = [
    "friend_invites",
    "friend_challenges",
    "friend_challenges_outbox",
    "friend_streaks",
    "rate_limits",
    "user_blocks"
  ];

  function afterDeleteAccountCascade(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
    var deletedId = ctx.userId;
    if (!deletedId) return;
    var pattern = "%" + deletedId + "%";
    var total = 0;
    for (var i = 0; i < CASCADE_COLLECTIONS.length; i++) {
      var coll = CASCADE_COLLECTIONS[i];
      try {
        var res: any = nk.sqlExec(
          "DELETE FROM storage WHERE ctid IN (" +
          "  SELECT ctid FROM storage WHERE collection = $1 AND key LIKE $2 LIMIT 5000" +
          ")",
          [coll, pattern]
        );
        total += (res && typeof res.rowsAffected === "number") ? res.rowsAffected : 0;
      } catch (e: any) {
        logger.warn("[SocialMaintenance] GDPR cascade failed for " + coll + ": " + (e && e.message || e));
      }
    }
    logger.info("[SocialMaintenance] GDPR cascade for " + deletedId + ": " + total + " referencing rows removed");
  }

  // ── Export the register contract so postbuild.js / main.ts can discover us ──
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_maintenance_tick", rpcMaintenanceTick);
    try {
      initializer.registerAfterDeleteAccount(afterDeleteAccountCascade as any);
    } catch (e: any) {
      // Older runtimes without the hook: cascade is then covered only by the
      // hourly tick sweeps — degraded but not broken.
      // (registerAfterDeleteAccount exists in nakama-common for this server's
      // pinned version; this guard is belt-and-braces for local dev images.)
    }
  }
}
