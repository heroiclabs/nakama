// =============================================================================
// Brain Coins — soft-currency play-to-earn ledger
//
// Implements PLAN-CONVERSATIONAL_HUB.md §G — the ledger users see, plus a
// service-only `redemption_settle` endpoint that the Tremendous mint API
// (web/app/api/p2e/tremendous/mint) calls back into once the gift card is
// minted. All earn rules are enforced server-side; the client cannot
// inflate the balance.
//
// Storage layout
//   brain_coins / wallet                  per-user balance + lifetime earn
//   brain_coins / earn_log_<unix>_<rand>  per-user immutable earn log
//   brain_coins / redemption_<id>         per-user redemption request +
//                                          state machine (pending → minted
//                                          | failed | refunded)
//
// Earn caps (per-day, server-enforced)
//   quiz_attempt:           10 attempts × 5 BC      = 50 BC/day
//   wow_moment_engaged:      6 engagements × 10 BC  = 60 BC/day
//   referral_friend_signup:  20 BC, no day cap (lifetime cap = 5)
//   streak_milestone:        25 BC at d=7, 50 at d=14, 100 at d=30
//
// Payout catalog (USD value at mint time)
//   tremendous_amazon_5_usd  = 1500 BC
//   tremendous_paypal_5_usd  = 1500 BC
//   tremendous_visa_10_usd   = 3200 BC
// =============================================================================

namespace BrainCoins {

  const COLLECTION = "brain_coins";
  const KEY_WALLET = "wallet";
  const EARN_LOG_PREFIX = "earn_log_";
  const REDEMPTION_PREFIX = "redemption_";

  // Earn rule definitions. ALL earn must come from this map; if the
  // service-token caller tries to claim a code not in this list, it's
  // rejected. Edits here are the only place to change the economy.
  interface EarnRule {
    coinsPerEvent: number;
    dailyCap?: number;            // events per UTC day (not coins)
    lifetimeCap?: number;         // events ever (e.g., referral)
  }
  const EARN_RULES: { [code: string]: EarnRule } = {
    "quiz_attempt":            { coinsPerEvent: 5,  dailyCap: 10 },
    "wow_moment_engaged":      { coinsPerEvent: 10, dailyCap: 6  },
    "referral_friend_signup":  { coinsPerEvent: 20, lifetimeCap: 5 },
    "streak_milestone_d7":     { coinsPerEvent: 25, lifetimeCap: 1 },
    "streak_milestone_d14":    { coinsPerEvent: 50, lifetimeCap: 1 },
    "streak_milestone_d30":    { coinsPerEvent: 100, lifetimeCap: 1 },
  };

  // Payout catalog. Tremendous SKU id → BC cost. The /mint route asserts
  // the same map server-side before charging the wallet.
  interface PayoutSku {
    cost: number;
    usdValueCents: number;       // for analytics + AMOE compliance proof
    label: string;
  }
  const PAYOUT_CATALOG: { [sku: string]: PayoutSku } = {
    "tremendous_amazon_5_usd":  { cost: 1500, usdValueCents: 500,  label: "$5 Amazon gift card" },
    "tremendous_paypal_5_usd":  { cost: 1500, usdValueCents: 500,  label: "$5 PayPal payout"   },
    "tremendous_visa_10_usd":   { cost: 3200, usdValueCents: 1000, label: "$10 Visa eGift"     },
  };

  function nowSec(): number { return Math.floor(Date.now() / 1000); }
  function todayUtc(): string { return new Date().toISOString().slice(0, 10); }

  function isServiceCaller(ctx: nkruntime.Context, payload: any): boolean {
    var token = payload && payload.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["BRAIN_COINS_SERVICE_TOKEN"]) || "");
    return expected.length > 0 && token === expected;
  }

  function readWallet(nk: nkruntime.Nakama, userId: string): any {
    try {
      var rows = nk.storageRead([{ collection: COLLECTION, key: KEY_WALLET, userId: userId }]);
      if (rows && rows.length > 0) return rows[0].value;
    } catch (_) { }
    return { balance: 0, lifetime_earned: 0, lifetime_redeemed: 0, updated_at: 0 };
  }

  function writeWallet(nk: nkruntime.Nakama, userId: string, wallet: any): void {
    wallet.updated_at = nowSec();
    nk.storageWrite([{
      collection: COLLECTION,
      key: KEY_WALLET,
      userId: userId,
      value: wallet,
      permissionRead: 1,
      permissionWrite: 0,
    }]);
  }

  function countEventsForCap(nk: nkruntime.Nakama, userId: string, code: string, sinceUnix: number): number {
    // Walk the earn log paged. Cheap: at most ~100 entries/day per user
    // and we only care about ones tagged with `code` since `sinceUnix`.
    var count = 0;
    var cursor = "";
    var safety = 0;
    while (safety < 10) {
      safety++;
      var page = nk.storageList(userId, COLLECTION, 100, cursor);
      if (!page || !page.objects) break;
      for (var i = 0; i < page.objects.length; i++) {
        var o = page.objects[i];
        if (o.key.indexOf(EARN_LOG_PREFIX) !== 0) continue;
        var v = o.value as any;
        if (!v) continue;
        if (v.code !== code) continue;
        if (v.unix_ts < sinceUnix) continue;
        count++;
      }
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    return count;
  }

  function startOfTodayUnix(): number {
    var d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  }

  // ── RPC: brain_coins_get ───────────────────────────────────────────────
  // User-side. Returns wallet + payout catalog + per-rule earn-cap status
  // for today (so the UI can show "you've earned 4/10 attempts today").
  function rpcGet(ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var wallet = readWallet(nk, userId);

    // Compute per-rule daily-cap status.
    var startOfDay = startOfTodayUnix();
    var earnStatus: { [code: string]: any } = {};
    for (var code in EARN_RULES) {
      if (!EARN_RULES.hasOwnProperty(code)) continue;
      var rule = EARN_RULES[code];
      if (rule.dailyCap) {
        var done = countEventsForCap(nk, userId, code, startOfDay);
        earnStatus[code] = {
          coinsPerEvent: rule.coinsPerEvent,
          dailyCap: rule.dailyCap,
          doneToday: done,
          remaining: Math.max(0, rule.dailyCap - done),
        };
      } else if (rule.lifetimeCap) {
        var doneEver = countEventsForCap(nk, userId, code, 0);
        earnStatus[code] = {
          coinsPerEvent: rule.coinsPerEvent,
          lifetimeCap: rule.lifetimeCap,
          doneLifetime: doneEver,
          remaining: Math.max(0, rule.lifetimeCap - doneEver),
        };
      } else {
        earnStatus[code] = { coinsPerEvent: rule.coinsPerEvent };
      }
    }

    return RpcHelpers.successResponse({
      wallet: wallet,
      earn_rules: earnStatus,
      payout_catalog: PAYOUT_CATALOG,
      served_at: nowSec(),
    });
  }

  // ── RPC: brain_coins_earn ──────────────────────────────────────────────
  // Service-only. The Unity client posts a quiz_attempt event to the
  // analytics pipeline; the analytics rollup cron forwards it here with a
  // BRAIN_COINS_SERVICE_TOKEN — that's what enforces "client can't fake
  // their own earn". Idempotency key prevents double-credit on retries.
  function rpcEarn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised — earn is service-only", 401);
      }
      var userId = "" + (data.user_id || "");
      var code = "" + (data.code || "");
      var idempotencyKey = "" + (data.idempotency_key || "");
      if (!userId || !code) {
        return RpcHelpers.errorResponse("user_id + code required", 400);
      }
      if (!EARN_RULES.hasOwnProperty(code)) {
        return RpcHelpers.errorResponse("unknown earn code: " + code, 400);
      }
      var rule = EARN_RULES[code];

      // Idempotency check — log key embeds the idempotency_key when supplied.
      if (idempotencyKey) {
        var probeKey = EARN_LOG_PREFIX + "idem_" + idempotencyKey;
        try {
          var existing = nk.storageRead([{ collection: COLLECTION, key: probeKey, userId: userId }]);
          if (existing && existing.length > 0) {
            return RpcHelpers.successResponse({
              wallet: readWallet(nk, userId),
              credited: 0,
              skipped: "idempotent",
            });
          }
        } catch (_) { }
      }

      // Cap enforcement.
      if (rule.dailyCap) {
        var doneToday = countEventsForCap(nk, userId, code, startOfTodayUnix());
        if (doneToday >= rule.dailyCap) {
          return RpcHelpers.successResponse({
            wallet: readWallet(nk, userId),
            credited: 0,
            skipped: "daily_cap",
          });
        }
      }
      if (rule.lifetimeCap) {
        var doneEver = countEventsForCap(nk, userId, code, 0);
        if (doneEver >= rule.lifetimeCap) {
          return RpcHelpers.successResponse({
            wallet: readWallet(nk, userId),
            credited: 0,
            skipped: "lifetime_cap",
          });
        }
      }

      // Credit.
      var wallet = readWallet(nk, userId);
      wallet.balance = (wallet.balance | 0) + rule.coinsPerEvent;
      wallet.lifetime_earned = (wallet.lifetime_earned | 0) + rule.coinsPerEvent;
      writeWallet(nk, userId, wallet);

      // Append immutable earn log row.
      var logKey = idempotencyKey
        ? EARN_LOG_PREFIX + "idem_" + idempotencyKey
        : EARN_LOG_PREFIX + nowSec() + "_" + Math.random().toString(36).slice(2, 8);
      nk.storageWrite([{
        collection: COLLECTION,
        key: logKey,
        userId: userId,
        value: {
          code: code,
          coins: rule.coinsPerEvent,
          unix_ts: nowSec(),
          date: todayUtc(),
          source: "" + (data.source || "system"),
          trace_id: data.trace_id || null,
          idempotency_key: idempotencyKey || null,
        },
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({
        wallet: wallet,
        credited: rule.coinsPerEvent,
      });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[BrainCoins] earn failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "brain_coins_earn", msg);
      return RpcHelpers.errorResponse("earn failed: " + msg, 500);
    }
  }

  // ── RPC: brain_coins_redeem_request ────────────────────────────────────
  // User-side. Locks the cost out of balance, returns a redemption_id the
  // /api/p2e/tremendous/mint route uses to call the Tremendous API. The
  // settle RPC below confirms or refunds based on Tremendous response.
  function rpcRedeemRequest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);
      var sku = "" + (data.sku || "");
      if (!PAYOUT_CATALOG.hasOwnProperty(sku)) {
        return RpcHelpers.errorResponse("unknown sku: " + sku, 400);
      }
      var entry = PAYOUT_CATALOG[sku];
      var wallet = readWallet(nk, userId);
      if ((wallet.balance | 0) < entry.cost) {
        return RpcHelpers.errorResponse("insufficient balance", 402);
      }

      // Lock the funds.
      wallet.balance = (wallet.balance | 0) - entry.cost;
      writeWallet(nk, userId, wallet);

      var redemptionId = "rdmp_" + nowSec() + "_" + Math.random().toString(36).slice(2, 10);
      nk.storageWrite([{
        collection: COLLECTION,
        key: REDEMPTION_PREFIX + redemptionId,
        userId: userId,
        value: {
          redemption_id: redemptionId,
          sku: sku,
          cost: entry.cost,
          usd_value_cents: entry.usdValueCents,
          state: "pending",
          requested_at: nowSec(),
          email: "" + (data.email || ""),
        },
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({
        redemption_id: redemptionId,
        sku: sku,
        cost: entry.cost,
        wallet: wallet,
      });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[BrainCoins] redeem_request failed: " + msg);
      return RpcHelpers.errorResponse("redeem_request failed: " + msg, 500);
    }
  }

  // ── RPC: brain_coins_redemption_settle ─────────────────────────────────
  // Service-only. Tremendous mint endpoint POSTs back here with state
  // ∈ {minted, failed}. On `failed` we refund the balance; on `minted` we
  // record the gift card delivery proof and bump lifetime_redeemed.
  function rpcRedemptionSettle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var data = RpcHelpers.parseRpcPayload(payload);
      if (!isServiceCaller(ctx, data)) {
        return RpcHelpers.errorResponse("not authorised — settle is service-only", 401);
      }
      var userId = "" + (data.user_id || "");
      var redemptionId = "" + (data.redemption_id || "");
      var newState = "" + (data.state || "");
      if (!userId || !redemptionId || !newState) {
        return RpcHelpers.errorResponse("user_id + redemption_id + state required", 400);
      }
      if (newState !== "minted" && newState !== "failed") {
        return RpcHelpers.errorResponse("state must be 'minted' or 'failed'", 400);
      }

      var key = REDEMPTION_PREFIX + redemptionId;
      var rows = nk.storageRead([{ collection: COLLECTION, key: key, userId: userId }]);
      if (!rows || rows.length === 0) {
        return RpcHelpers.errorResponse("redemption not found", 404);
      }
      var record: any = rows[0].value;
      if (record.state !== "pending") {
        // Already settled — return the same response idempotently.
        return RpcHelpers.successResponse({ redemption: record, idempotent: true });
      }

      var wallet = readWallet(nk, userId);
      if (newState === "failed") {
        wallet.balance = (wallet.balance | 0) + (record.cost | 0);
        writeWallet(nk, userId, wallet);
        record.state = "failed";
        record.error = "" + (data.error || "tremendous_failed");
        record.settled_at = nowSec();
      } else {
        wallet.lifetime_redeemed = (wallet.lifetime_redeemed | 0) + (record.cost | 0);
        writeWallet(nk, userId, wallet);
        record.state = "minted";
        record.tremendous_order_id = "" + (data.tremendous_order_id || "");
        record.delivery_url = "" + (data.delivery_url || "");
        record.settled_at = nowSec();
      }

      nk.storageWrite([{
        collection: COLLECTION,
        key: key,
        userId: userId,
        value: record,
        permissionRead: 1,
        permissionWrite: 0,
      }]);

      return RpcHelpers.successResponse({ redemption: record, wallet: wallet });
    } catch (err: any) {
      var msg = err && err.message ? err.message : String(err);
      logger.error("[BrainCoins] redemption_settle failed: " + msg);
      RpcHelpers.logRpcError(nk, logger, "brain_coins_redemption_settle", msg);
      return RpcHelpers.errorResponse("redemption_settle failed: " + msg, 500);
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("brain_coins_get", rpcGet);
    initializer.registerRpc("brain_coins_earn", rpcEarn);
    initializer.registerRpc("brain_coins_redeem_request", rpcRedeemRequest);
    initializer.registerRpc("brain_coins_redemption_settle", rpcRedemptionSettle);
  }
}
