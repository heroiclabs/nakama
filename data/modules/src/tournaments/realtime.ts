// =============================================================================
// realtime.ts — nk.notificationsSend helpers for tournament events
//
// Plan ref: §1I real-time push topology
//
// Notification codes (per plan):
//   TOURNAMENT_POT_UPDATE   1001 — broadcast to subscribers on pot change
//   TOURNAMENT_LB_UPDATE    1002 — broadcast on leaderboard tick (every ~5s)
//   TOURNAMENT_ELIMINATED   1003 — user-targeted on elimination cut
//   TOURNAMENT_SETTLED      1004 — user-targeted on settlement
//   PREENROLL_SCARCITY      1005 — broadcast when founder cap < 100 left
//
// Web subscribers use @heroiclabs/nakama-js socket; Unity uses ISocket.
// Both already wired in the codebase (existing IVXFriends + CreatorEvent
// patterns reference ReceivedNotification).
// =============================================================================

namespace TournamentRealtime {

  export const CODE_POT_UPDATE = 1001;
  export const CODE_LB_UPDATE = 1002;
  export const CODE_ELIMINATED = 1003;
  export const CODE_SETTLED = 1004;
  export const CODE_PREENROLL_SCARCITY = 1005;

  // Send to a list of user IDs. Nakama notificationsSend accepts a list of
  // notifications, each addressed to one userId.
  export function sendToUsers(nk: nkruntime.Nakama, userIds: string[], code: number, subject: string, content: any, persistent: boolean): void {
    if (!userIds || userIds.length === 0) return;
    var batch: nkruntime.NotificationRequest[] = [];
    for (var i = 0; i < userIds.length; i++) {
      batch.push({
        userId: userIds[i],
        subject: subject,
        content: content,
        code: code,
        persistent: persistent,
        senderId: Constants.SYSTEM_USER_ID,
      });
    }
    try {
      nk.notificationsSend(batch);
    } catch (_) {
      // best-effort — fan-out doesn't block any RPC
    }
  }

  // Convenience: one user
  export function sendToUser(nk: nkruntime.Nakama, userId: string, code: number, subject: string, content: any, persistent: boolean): void {
    sendToUsers(nk, [userId], code, subject, content, persistent);
  }

  // Resolve username best-effort. Returns "" if Nakama doesn't have one.
  function usernameFor(nk: nkruntime.Nakama, userId: string): string {
    if (!userId) return "";
    try {
      var acc = nk.usersGetId([userId]);
      if (acc && acc.length > 0 && acc[0].username) return "" + acc[0].username;
    } catch (_) { }
    return "";
  }

  // Standard payload envelope. ALL clients (web ActivityTicker, Unity
  // TournamentManager) can rely on `slug` being present. Keep
  // `tournament_slug` too so existing string searches in other systems
  // (e.g. analytics) still match. (Fix B4 + B9 + B10.)
  function envelope(slug: string, extra: any): any {
    var base: any = {
      slug: slug,
      tournament_slug: slug,
      ts: Math.floor(Date.now() / 1000),
    };
    if (extra) {
      for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
    }
    return base;
  }

  // ── Tournament-specific helpers ────────────────────────────────────────────
  // B3 fix: every fanout helper now pulls the live subscriber list from
  // storage (populated by tournament_pre_enroll / tournament_enter /
  // tournament_caller_status) rather than relying on the caller to pass it.
  export function notifyPotUpdate(nk: nkruntime.Nakama, tournamentSlug: string, newPotBc: number, recentDelta: number, _subscribers?: string[], scorer?: { userId: string; score?: number }): void {
    var subs = (_subscribers && _subscribers.length > 0) ? _subscribers : TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length === 0) return;
    var payload = envelope(tournamentSlug, {
      pot_bc: newPotBc,
      delta_bc: recentDelta,
      entries_count: undefined,  // filled by caller via incrementPot if relevant
    });
    if (scorer && scorer.userId) {
      payload.username = usernameFor(nk, scorer.userId);
      if (typeof scorer.score === "number") payload.score = scorer.score;
    }
    sendToUsers(nk, subs, CODE_POT_UPDATE, "tournament_pot_update", payload, false);
  }

  export function notifyEliminated(nk: nkruntime.Nakama, userId: string, tournamentSlug: string, round: number, finalRank: number): void {
    sendToUser(nk, userId, CODE_ELIMINATED, "tournament_eliminated", envelope(tournamentSlug, {
      round: round,
      final_rank: finalRank,
      username: usernameFor(nk, userId),
    }), true);  // persistent so user sees it next session
    // Also broadcast a slim ticker event to subscribers for social proof.
    var subs = TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length > 0) {
      sendToUsers(nk, subs, CODE_ELIMINATED, "tournament_eliminated_broadcast", envelope(tournamentSlug, {
        round: round,
        username: usernameFor(nk, userId),
      }), false);
    }
  }

  export function notifySettled(nk: nkruntime.Nakama, userId: string, tournamentSlug: string, payoutBc: number, finalRank: number, certId: string | null): void {
    sendToUser(nk, userId, CODE_SETTLED, "tournament_settled", envelope(tournamentSlug, {
      payout_bc: payoutBc,
      final_rank: finalRank,
      cert_id: certId,
      username: usernameFor(nk, userId),
    }), true);
  }

  export function notifyPreEnrollScarcity(nk: nkruntime.Nakama, tournamentSlug: string, founderSpotsLeft: number, _subscribers?: string[]): void {
    if (founderSpotsLeft > 100) return;  // only fire under threshold
    var subs = (_subscribers && _subscribers.length > 0) ? _subscribers : TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length === 0) return;
    var meta = TournamentsStorage.readMeta(nk, tournamentSlug);
    sendToUsers(nk, subs, CODE_PREENROLL_SCARCITY, "preenroll_scarcity", envelope(tournamentSlug, {
      founder_spots_left: founderSpotsLeft,
      spots_left: founderSpotsLeft,                     // alias for legacy Unity readers
      pre_enroll_count: meta ? (meta.pre_enroll_count | 0) : 0,
    }), false);
  }

  // Score tick for the activity ticker — fired whenever a user scores in a
  // tournament. Includes the username so the web ActivityTicker can render
  // "Sarah just scored 4,200".
  export function notifyScoreTick(nk: nkruntime.Nakama, tournamentSlug: string, scorerUserId: string, newTotalScore: number): void {
    var subs = TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length === 0) return;
    sendToUsers(nk, subs, CODE_LB_UPDATE, "tournament_score_tick", envelope(tournamentSlug, {
      username: usernameFor(nk, scorerUserId),
      score: newTotalScore,
      scorer_user_id: scorerUserId,
    }), false);
  }

  // Entry tick — emitted on every tournament_enter. Powers the ticker
  // "Alex just entered" entries.
  export function notifyEntered(nk: nkruntime.Nakama, tournamentSlug: string, enteredUserId: string, newPotBc: number, newEntriesCount: number): void {
    var subs = TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length === 0) return;
    sendToUsers(nk, subs, CODE_POT_UPDATE, "tournament_entered", envelope(tournamentSlug, {
      username: usernameFor(nk, enteredUserId),
      pot_bc: newPotBc,
      entries_count: newEntriesCount,
    }), false);
  }

  // Leaderboard ticker (manual call site; kept for completeness).
  export function notifyLeaderboardTick(nk: nkruntime.Nakama, tournamentSlug: string, topRows: any[]): void {
    var subs = TournamentsStorage.listSubscribers(nk, tournamentSlug);
    if (subs.length === 0) return;
    sendToUsers(nk, subs, CODE_LB_UPDATE, "tournament_lb_update", envelope(tournamentSlug, {
      top: topRows,
    }), false);
  }
}
