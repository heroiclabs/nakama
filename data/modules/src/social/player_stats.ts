// player_stats.ts — per-game weekly activity stats (ML-002, doc §6.2 / §D.4).
//
// THE MISSING LINK THIS CLOSES: friends_list was designed to show
// gameActivity ("xpThisWeek", "quizzesThisWeek") on every friend card —
// Duolingo-style "XP this week, not lifetime" competition — but NOTHING ever
// wrote those stats, so the field could only ever be empty (ML-004's sibling,
// flagged in the doc's interlinking health table as a broken link).
//
// WRITER: recordQuizCompletion() — called from the server quiz submit flow
// only (same trust boundary as duo credits: never client-claimed).
// WEEKLY RESET: rows carry an ISO weekId; the first write of a new week
// resets the counters in place. No cron needed — reset is lazy per user.
//
// STORAGE
//   ivx_game_player_stats / {gameId}_{userId}   owner = user, permRead 2
//   (public-read is safe and intended: these are the social-comparison
//   numbers friends are SUPPOSED to see; nothing sensitive lives here.)
//
// READERS: friends_list.ts enriches friend cards via loadStatsMap (one
// batched read); pressure summary and future league placement can reuse it.

namespace SocialPlayerStats {

  var COLLECTION = "ivx_game_player_stats";

  function isoWeek(d: Date): string {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var dayNum = (t.getUTCDay() + 6) % 7;
    t.setUTCDate(t.getUTCDate() - dayNum + 3);
    var firstThursday = t.getTime();
    t.setUTCMonth(0, 1);
    if (t.getUTCDay() !== 4) t.setUTCMonth(0, 1 + ((4 - t.getUTCDay()) + 7) % 7);
    var week = 1 + Math.ceil((firstThursday - t.getTime()) / 604800000);
    return d.getUTCFullYear() + "-W" + (week < 10 ? "0" + week : week);
  }

  function statKey(gameId: string, userId: string): string {
    return gameId + "_" + userId;
  }

  /**
   * Record one completed quiz. OCC with one retry — a lost increment under
   * pathological contention shows a friend 1 XP low on a card; acceptable.
   * Never throws.
   */
  export function recordQuizCompletion(
    nk: nkruntime.Nakama, logger: nkruntime.Logger,
    userId: string, gameId: string, xpEarned: number, score: number
  ): void {
    try {
      if (!userId || !gameId) return;
      var week = isoWeek(new Date());
      var key = statKey(gameId, userId);

      for (var attempt = 0; attempt < 2; attempt++) {
        var current: any = null;
        var version = "";
        try {
          var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: userId }]);
          if (rows && rows.length > 0 && rows[0] && rows[0].value) {
            current = rows[0].value;
            version = rows[0].version || "";
          }
        } catch (_) {}

        var stats: any;
        if (current && current.weekId === week) {
          stats = current;
          stats.xpThisWeek       = (stats.xpThisWeek || 0) + Math.max(0, xpEarned || 0);
          stats.quizzesThisWeek  = (stats.quizzesThisWeek || 0) + 1;
          stats.bestScoreThisWeek = Math.max(stats.bestScoreThisWeek || 0, score || 0);
        } else {
          // New week (or first ever write) — lazy reset.
          stats = {
            gameId: gameId, userId: userId, weekId: week,
            xpThisWeek: Math.max(0, xpEarned || 0),
            quizzesThisWeek: 1,
            bestScoreThisWeek: Math.max(0, score || 0),
            lifetimeQuizzes: ((current && current.lifetimeQuizzes) || 0)
          };
        }
        stats.lifetimeQuizzes = (stats.lifetimeQuizzes || 0) + 1;
        stats.lastPlayedAt = new Date().toISOString();

        var req: any = {
          collection: COLLECTION, key: key, userId: userId,
          value: stats, permissionRead: 2, permissionWrite: 0
        };
        if (version) req.version = version;
        try {
          nk.storageWrite([req]);
          return;
        } catch (occ) {
          if (attempt === 0) continue; // version clash — retry once
        }
      }
    } catch (e: any) {
      if (logger && logger.warn) logger.warn("[PlayerStats] record failed (non-fatal): " + (e && e.message));
    }
  }

  /**
   * Batch-load stats for many users in ONE storageRead. Returns only rows
   * from the CURRENT ISO week — a friend whose row is from last week simply
   * hasn't played this week, and their card should show zeros, not stale XP.
   */
  export function loadStatsMap(nk: nkruntime.Nakama, gameId: string, userIds: string[]): { [id: string]: any } {
    var out: { [id: string]: any } = {};
    if (!userIds || userIds.length === 0) return out;
    var week = isoWeek(new Date());
    var reads: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < userIds.length; i++) {
      reads.push({ collection: COLLECTION, key: statKey(gameId, userIds[i]), userId: userIds[i] });
    }
    try {
      var rows = nk.storageRead(reads);
      if (rows) {
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (!row || !row.value || !row.userId) continue;
          var v: any = row.value;
          if (v.weekId !== week) continue; // stale week → treat as no activity
          out[row.userId] = {
            xpThisWeek:        v.xpThisWeek || 0,
            quizzesThisWeek:   v.quizzesThisWeek || 0,
            bestScoreThisWeek: v.bestScoreThisWeek || 0,
            lastPlayedAt:      v.lastPlayedAt || ""
          };
        }
      }
    } catch (_) { /* enrichment is optional context — empty map on failure */ }
    return out;
  }
}
