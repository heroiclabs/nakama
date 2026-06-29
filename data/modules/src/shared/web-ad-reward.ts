// web-ad-reward.ts
// Rewarded-ad → Brain Coin grant for the QuizVerse WEB client (web.quizverse.world).
//
// Mirrors the server-authoritative pattern of fortune_wheel_ad_spin: the web
// client plays an Applixir rewarded ad, then calls this RPC. The SERVER owns
// the reward amount, the daily cap, the cooldown and idempotency — the client
// is never trusted to self-credit.
//
// Why session-authed (not the Applixir S2S callback):
//   The web runs on authenticated Nakama ghost sessions, so `ctx.userId` is a
//   real account. Crediting it directly keeps the reward on the SAME wallet the
//   shop/leaderboard read (no guest-localStorage disconnect). The Applixir S2S
//   callback remains a separate fraud/accounting signal.
//
// Flow:
//   1. Client finishes rewarded ad → quizverse_web_ad_reward { placement, txnId }
//   2. Server validates: cap not hit, cooldown elapsed, txn not already claimed
//   3. Server grants `coins` atomically and records the txn
//   4. Returns { success, reward, grantedToday, dailyCap, cooldownSeconds }

namespace WebAdReward {

  const COLLECTION = "web_ad_rewards";
  const STATE_KEY = "state";

  const REWARD_COINS = 25;          // Brain Coins per rewarded ad
  const DAILY_CAP = 10;             // max rewarded grants per UTC day
  const COOLDOWN_SECONDS = 30;      // anti-spam gap between grants
  const TXN_MEMORY = 40;            // recent txn ids retained for idempotency

  interface State {
    day: string;        // UTC YYYY-MM-DD bucket
    count: number;      // grants used today
    lastAt: number;     // unix epoch seconds of last grant
    seenTxns: string[]; // recent claimed txn ids (idempotency)
  }

  function utcDay(): string {
    return new Date().toISOString().slice(0, 10);
  }

  function readState(nk: nkruntime.Nakama, userId: string): State {
    try {
      const recs = nk.storageRead([{ collection: COLLECTION, key: STATE_KEY, userId: userId }]);
      if (recs && recs.length > 0 && recs[0].value) {
        const v = recs[0].value as Partial<State>;
        return {
          day: v.day || utcDay(),
          count: typeof v.count === "number" ? v.count : 0,
          lastAt: typeof v.lastAt === "number" ? v.lastAt : 0,
          seenTxns: Array.isArray(v.seenTxns) ? v.seenTxns : [],
        };
      }
    } catch (_e) { /* fall through */ }
    return { day: utcDay(), count: 0, lastAt: 0, seenTxns: [] };
  }

  function writeState(nk: nkruntime.Nakama, userId: string, state: State): void {
    nk.storageWrite([{
      collection: COLLECTION,
      key: STATE_KEY,
      userId: userId,
      value: state as unknown as { [key: string]: unknown },
      permissionRead: 1,
      permissionWrite: 0,
    }]);
  }

  export function rpcWebAdReward(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    const userId = ctx.userId;
    if (!userId) {
      return JSON.stringify({ success: false, error: "Authentication required", errorCode: "NO_AUTH" });
    }

    let req: { placement?: string; txnId?: string } = {};
    try { req = payload ? JSON.parse(payload) : {}; } catch (_e) { req = {}; }
    const placement = String(req.placement || "web_rewarded");
    const txnId = String(req.txnId || "");

    const now = Math.floor(Date.now() / 1000);
    const today = utcDay();
    let state = readState(nk, userId);

    // New UTC day → reset the cap window (keep txn memory short-lived too).
    if (state.day !== today) {
      state = { day: today, count: 0, lastAt: 0, seenTxns: [] };
    }

    // Idempotency: same Applixir txn must not double-credit.
    if (txnId && state.seenTxns.indexOf(txnId) !== -1) {
      return JSON.stringify({
        success: true, deduped: true, reward: 0,
        grantedToday: state.count, dailyCap: DAILY_CAP,
      });
    }

    // Daily cap.
    if (state.count >= DAILY_CAP) {
      return JSON.stringify({
        success: false, error: "Daily reward cap reached", errorCode: "DAILY_CAP",
        grantedToday: state.count, dailyCap: DAILY_CAP,
      });
    }

    // Cooldown.
    if (state.lastAt > 0 && (now - state.lastAt) < COOLDOWN_SECONDS) {
      const remaining = COOLDOWN_SECONDS - (now - state.lastAt);
      return JSON.stringify({
        success: false, error: "Cooldown active", errorCode: "COOLDOWN",
        cooldownRemaining: remaining,
      });
    }

    // Grant Brain Coins atomically (ledgered).
    try {
      nk.walletUpdate(
        userId,
        { coins: REWARD_COINS },
        { source: "web_rewarded_ad", placement: placement, txn: txnId || "n/a" },
        true
      );
    } catch (err: any) {
      logger.error("[WebAdReward] wallet grant failed for " + userId + ": " + (err && err.message ? err.message : String(err)));
      return JSON.stringify({ success: false, error: "Server error", errorCode: "GRANT_FAILED" });
    }

    // Record state.
    state.count += 1;
    state.lastAt = now;
    if (txnId) {
      state.seenTxns.push(txnId);
      if (state.seenTxns.length > TXN_MEMORY) {
        state.seenTxns = state.seenTxns.slice(state.seenTxns.length - TXN_MEMORY);
      }
    }
    try {
      writeState(nk, userId, state);
    } catch (err: any) {
      logger.warn("[WebAdReward] state write failed for " + userId + ": " + (err && err.message ? err.message : String(err)));
    }

    logger.info("[WebAdReward] +" + REWARD_COINS + " coins → " + userId + " (placement=" + placement + ", " + state.count + "/" + DAILY_CAP + ")");

    return JSON.stringify({
      success: true,
      reward: REWARD_COINS,
      currency: "coins",
      grantedToday: state.count,
      dailyCap: DAILY_CAP,
      cooldownSeconds: COOLDOWN_SECONDS,
    });
  }

  // Single-parameter, registerRpc-only so postbuild auto-invokes this on EVERY
  // pooled Goja VM (see ad-revenue-event.ts for the full rationale). A second
  // `logger` param made postbuild skip auto-invoke, leaving
  // __rpc_quizverse_web_ad_reward undefined on non-init VMs → intermittent
  // "JavaScript runtime function invalid." Init logging lives in main.ts.
  export function register(
    initializer: nkruntime.Initializer
  ): void {
    initializer.registerRpc("quizverse_web_ad_reward", rpcWebAdReward);
  }
}
