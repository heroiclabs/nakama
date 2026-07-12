// ---------------------------------------------------------------------------
// lap-note-quota.ts — server-authoritative Link & Play note creation quota.
//
// Free: 5/day. QuizVerse Pro/Plus or LinkPlay Pro: 20/day.
// QuizVerse Pro+ or LinkPlay Pro+: unlimited.
// Reset boundary: 00:00 UTC.
//
// The reserve/release contract lets the web proxy reserve before dispatching
// the AI job and refund the slot if the upstream request fails.
// ---------------------------------------------------------------------------

namespace QvLapNoteQuota {
  var COLLECTION = "qv_lap_note_quota";
  var KEY_PREFIX = "notes_";
  var OCC_MAX_RETRIES = 4;

  interface QuotaState {
    date: string;
    used: number;
    reservations: { [id: string]: boolean };
    updatedAt: string;
  }

  interface StoredQuota {
    value: QuotaState;
    version: string;
    exists: boolean;
  }

  function utcDate(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  function nextUtcReset(now: Date): string {
    return new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
      0,
      0,
      0
    )).toISOString();
  }

  function quotaKey(date: string): string {
    return KEY_PREFIX + date;
  }

  function subscriptionTier(nk: nkruntime.Nakama, userId: string, nowMs: number): string {
    var rows = nk.storageRead([{
      collection: "qv_entitlements",
      key: "subscriptions",
      userId: userId
    }]);
    if (!rows || rows.length === 0 || !rows[0].value) return "free";

    var subs: any = rows[0].value;
    var tier = String(subs.tier || "").toLowerCase();
    var status = String(subs.status || "active").toLowerCase();
    if (!tier || status === "expired" || status === "revoked" || status === "inactive") {
      return "free";
    }
    if (subs.expiresAt) {
      var expiryMs = new Date(subs.expiresAt).getTime();
      if (!isNaN(expiryMs) && expiryMs <= nowMs) return "free";
    }
    return tier;
  }

  function limitForTier(tier: string): number {
    if (tier === "pro_plus" || tier === "linkplay_proplus") return -1;
    if (tier === "pro" || tier === "plus" || tier === "linkplay_pro") return 20;
    return 5;
  }

  function readQuota(
    nk: nkruntime.Nakama,
    userId: string,
    date: string
  ): StoredQuota {
    var rows = nk.storageRead([{
      collection: COLLECTION,
      key: quotaKey(date),
      userId: userId
    }]);
    if (!rows || rows.length === 0) {
      return {
        value: { date: date, used: 0, reservations: {}, updatedAt: new Date().toISOString() },
        version: "*",
        exists: false
      };
    }
    var value: any = rows[0].value || {};
    return {
      value: {
        date: date,
        used: Math.max(0, Number(value.used) || 0),
        reservations: value.reservations || {},
        updatedAt: String(value.updatedAt || "")
      },
      version: rows[0].version || "",
      exists: true
    };
  }

  function writeQuota(
    nk: nkruntime.Nakama,
    userId: string,
    stored: StoredQuota
  ): void {
    stored.value.updatedAt = new Date().toISOString();
    nk.storageWrite([{
      collection: COLLECTION,
      key: quotaKey(stored.value.date),
      userId: userId,
      value: stored.value as any,
      version: stored.exists ? stored.version : "*",
      permissionRead: 1,
      permissionWrite: 0
    }]);
  }

  function response(
    state: QuotaState,
    tier: string,
    limit: number,
    resetAt: string,
    allowed?: boolean,
    reservationId?: string
  ): string {
    return RpcHelpers.successResponse({
      allowed: allowed !== false,
      tier: tier,
      limit: limit < 0 ? null : limit,
      unlimited: limit < 0,
      used: state.used,
      remaining: limit < 0 ? null : Math.max(0, limit - state.used),
      date: state.date,
      resetAt: resetAt,
      reservationId: reservationId || ""
    });
  }

  function rpcLapNoteQuota(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload) || {};
    var action = String(data.action || "status").toLowerCase();
    var now = new Date();
    var date = action === "release" && data.date ? String(data.date) : utcDate(now);
    var tier = subscriptionTier(nk, userId, now.getTime());
    var limit = limitForTier(tier);
    var resetAt = nextUtcReset(now);

    if (limit < 0) {
      var unlimitedState = readQuota(nk, userId, date).value;
      return response(unlimitedState, tier, limit, resetAt, true, "");
    }

    if (action === "status") {
      return response(readQuota(nk, userId, date).value, tier, limit, resetAt);
    }

    if (action !== "reserve" && action !== "release") {
      return RpcHelpers.errorResponse("action must be status, reserve, or release");
    }

    var reservationId = action === "release" ? String(data.reservationId || "") : "";
    if (action === "release" && !reservationId) {
      return RpcHelpers.errorResponse("reservationId required for release");
    }
    if (action === "release") {
      var expectedSecret = String(ctx.env["NAKAMA_WEBHOOK_SECRET"] || "");
      var suppliedSecret = String(data.refundSecret || "");
      if (!expectedSecret || suppliedSecret !== expectedSecret) {
        return RpcHelpers.errorResponse("release is server-only");
      }
    }

    var lastError: any = null;
    for (var attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
      var stored = readQuota(nk, userId, date);
      var state = stored.value;

      if (action === "reserve") {
        if (state.used >= limit) {
          return response(state, tier, limit, resetAt, false, "");
        }
        reservationId = nk.uuidv4();
        state.used += 1;
        state.reservations[reservationId] = true;
      } else {
        if (!state.reservations[reservationId]) {
          return response(state, tier, limit, resetAt, true, "");
        }
        delete state.reservations[reservationId];
        state.used = Math.max(0, state.used - 1);
      }

      try {
        writeQuota(nk, userId, stored);
        return response(
          state,
          tier,
          limit,
          resetAt,
          true,
          action === "reserve" ? reservationId : ""
        );
      } catch (err: any) {
        lastError = err;
      }
    }

    logger.error("[QvLapNoteQuota] OCC exhausted user=" + userId + " action=" + action);
    throw lastError || new Error("lap_note_quota_contention");
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_lap_note_quota", rpcLapNoteQuota);
  }
}
