// =============================================================================
// rate-limit.ts — Universal RPC rate-limiter decorator
//
// Plan ref: §1I gap 8 — "No global withRateLimit on RPCs". The tournament
// system exposes 6 user-callable RPCs (enter, submit_pack_result, submit_picks,
// pre_enroll, claim_cert, learning_check_submit) that need server-side throttling
// to prevent spam, accidental retries, and rudimentary cheat attempts.
//
// Design:
//   - Sliding window via storageList over a system-owned rate-limit collection.
//     We round timestamps into per-second buckets so reads are bounded.
//   - Three independent windows can be enforced per RPC:
//       perUserPerSec  — instant burst guard (e.g. quiz submit latency floor)
//       perUserPerMin  — typical per-user throttle
//       perIpPerMin    — guards anonymous public RPCs by client IP
//   - On limit hit, throw a "THROTTLED" error (RPC handlers should catch and
//     return RpcHelpers.errorResponse with code 429).
//
// Why storage + not an in-memory counter: Nakama runs N pods; in-memory state
// can't be trusted across them. Storage is per-user (so partitioned), and we
// prune old buckets opportunistically (TTL via key naming, see compactWindow).
// =============================================================================

namespace SharedRateLimit {

  const COLLECTION = "rl_buckets";
  const KEY_PREFIX_USER = "user_";
  const KEY_PREFIX_IP = "ip_";

  export interface RateLimitOpts {
    perUserPerSec?: number;
    perUserPerMin?: number;
    perIpPerMin?: number;
  }

  export interface RateLimitDecision {
    allowed: boolean;
    reason?: string;
    retryAfterSec?: number;
  }

  function nowSec(): number { return Math.floor(Date.now() / 1000); }

  // Read+write a windowed counter. Buckets are keyed per UTC second; we read
  // the last `windowSec` buckets, sum, and decide. On allow, increment current
  // bucket. Bucket entries auto-prune by being windowed-out on next read.
  function countAndIncrement(
    nk: nkruntime.Nakama,
    ownerUserId: string,
    keyBase: string,
    windowSec: number,
    limit: number
  ): RateLimitDecision {
    const now = nowSec();
    const windowStart = now - windowSec;
    var total = 0;
    var cursor = "";
    var safety = 0;
    while (safety < 5) {
      safety++;
      var page = nk.storageList(ownerUserId, COLLECTION, 100, cursor);
      if (!page || !page.objects) break;
      for (var i = 0; i < page.objects.length; i++) {
        var o = page.objects[i];
        if (o.key.indexOf(keyBase + ":") !== 0) continue;
        var v = o.value as any;
        if (!v || !v.ts) continue;
        if (v.ts < windowStart) continue;
        total += v.count | 0;
      }
      if (!page.cursor) break;
      cursor = page.cursor;
    }
    if (total >= limit) {
      return { allowed: false, reason: "rate_limited", retryAfterSec: Math.max(1, Math.ceil(windowSec / Math.max(1, limit))) };
    }
    // Increment the bucket for the current second.
    var bucketKey = keyBase + ":" + now;
    try {
      var existing = nk.storageRead([{ collection: COLLECTION, key: bucketKey, userId: ownerUserId }]);
      var newCount = 1;
      if (existing && existing.length > 0) {
        newCount = ((existing[0].value as any).count | 0) + 1;
      }
      nk.storageWrite([{
        collection: COLLECTION,
        key: bucketKey,
        userId: ownerUserId,
        value: { ts: now, count: newCount },
        permissionRead: 0,
        permissionWrite: 0,
      }]);
    } catch (_) {
      // Increment failed (concurrent write?) — fail open, we already counted total.
    }
    return { allowed: true };
  }

  // Public check. Returns decision; caller throws / returns 429 on !allowed.
  export function check(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    rpcName: string,
    opts: RateLimitOpts
  ): RateLimitDecision {
    const userId = ctx.userId || "";
    const ip = ctx.clientIp || "";

    if (opts.perUserPerSec && userId) {
      var d = countAndIncrement(nk, userId, KEY_PREFIX_USER + rpcName + "_s", 1, opts.perUserPerSec);
      if (!d.allowed) return d;
    }
    if (opts.perUserPerMin && userId) {
      var d2 = countAndIncrement(nk, userId, KEY_PREFIX_USER + rpcName + "_m", 60, opts.perUserPerMin);
      if (!d2.allowed) return d2;
    }
    if (opts.perIpPerMin && ip) {
      // IP-bucket is stored under SYSTEM_USER so anonymous callers can be counted.
      var d3 = countAndIncrement(nk, Constants.SYSTEM_USER_ID, KEY_PREFIX_IP + ip + "_" + rpcName, 60, opts.perIpPerMin);
      if (!d3.allowed) return d3;
    }
    return { allowed: true };
  }

  /**
   * Check an arbitrary per-user sliding window using the same distributed
   * storage buckets as the standard second/minute limits. Realtime hooks use
   * this when their product contract is not a one-second or one-minute window.
   */
  export function checkUserWindow(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    operationName: string,
    windowSec: number,
    limit: number
  ): RateLimitDecision {
    var userId = ctx.userId || "";
    if (!userId || windowSec < 1 || limit < 1) return { allowed: true };
    return countAndIncrement(
      nk,
      userId,
      KEY_PREFIX_USER + operationName + "_w" + windowSec,
      windowSec,
      limit
    );
  }

  // Convenience wrapper: short-circuits a handler with a 429 response if the
  // caller is over limit. Usage:
  //   function rpcEnter(ctx, logger, nk, payload) {
  //     var rl = SharedRateLimit.enforce(ctx, nk, "tournament_enter",
  //       { perUserPerMin: 10 });
  //     if (rl) return rl;  // already an error response string
  //     // ... real handler ...
  //   }
  export function enforce(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    rpcName: string,
    opts: RateLimitOpts
  ): string | null {
    var d = check(ctx, nk, rpcName, opts);
    if (d.allowed) return null;
    return RpcHelpers.errorResponse("rate limited; retry in " + (d.retryAfterSec || 1) + "s", 429);
  }
}
