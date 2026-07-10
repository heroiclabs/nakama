// =============================================================================
// Quizverse Brain contextual prompt gate
// =============================================================================
// RPCs:
//   quizverse_brain_prompt_evaluate — eligibility + short OCC reservation
//   quizverse_brain_prompt_commit   — idempotent shown/accepted/opened/suppressed
//
// Nakama owns cross-device frequency and visit state. Unity owns session-level
// result signals. AI topic coverage is advisory input only: it unlocks no
// entitlement/reward and never carries a Cognito token through Nakama.
// =============================================================================

declare function persistNormalizedEvent(
  nk: nkruntime.Nakama,
  logger: nkruntime.Logger,
  ev: any
): void;

namespace QuizVerseBrainPrompts {
  var COLLECTION = "qv_brain_prompt";
  var KEY = "state";
  var SCHEMA_VERSION = 1;
  var RESERVATION_TTL_MS = 10 * 60 * 1000;
  var WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  var OCC_MAX_RETRIES = 5;
  var IDEM_MAX_ENTRIES = 32;
  var DEFAULT_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";

  interface PromptBucket {
    consumed: boolean;
    promptId: string;
    shownMs: number;
    openedMs: number;
  }

  interface PromptReservation {
    token: string;
    promptId: string;
    bucket: "daily" | "weekly";
    clientEventId: string;
    resultId: string;
    createdMs: number;
    expiresMs: number;
  }

  interface IdempotencyRecord {
    action: string;
    promptId: string;
    atMs: number;
  }

  interface PromptState {
    schemaVersion: number;
    utcDay: string;
    isoWeek: string;
    lastSuccessfulBrainVisitMs: number;
    daily: PromptBucket;
    weekly: PromptBucket;
    reservation: PromptReservation | null;
    idempotency: { [key: string]: IdempotencyRecord };
  }

  interface StoredState {
    value: PromptState;
    version: string;
    exists: boolean;
  }

  interface MutationResult {
    write: boolean;
    response: any;
  }

  function emptyBucket(): PromptBucket {
    return { consumed: false, promptId: "", shownMs: 0, openedMs: 0 };
  }

  function utcDay(nowMs: number): string {
    return new Date(nowMs).toISOString().slice(0, 10);
  }

  function isoWeek(nowMs: number): string {
    var date = new Date(nowMs);
    var day = date.getUTCDay();
    var isoDay = day === 0 ? 7 : day;
    date.setUTCDate(date.getUTCDate() + 4 - isoDay);
    var yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
    var week = Math.ceil((((date.getTime() - yearStart) / 86400000) + 1) / 7);
    return date.getUTCFullYear() + "-W" + (week < 10 ? "0" : "") + week;
  }

  function createState(nowMs: number): PromptState {
    return {
      schemaVersion: SCHEMA_VERSION,
      utcDay: utcDay(nowMs),
      isoWeek: isoWeek(nowMs),
      lastSuccessfulBrainVisitMs: 0,
      daily: emptyBucket(),
      weekly: emptyBucket(),
      reservation: null,
      idempotency: {}
    };
  }

  function normalizeState(raw: any, nowMs: number): PromptState {
    var state = raw && typeof raw === "object" ? raw as PromptState : createState(nowMs);
    state.schemaVersion = SCHEMA_VERSION;
    state.lastSuccessfulBrainVisitMs = Number(state.lastSuccessfulBrainVisitMs || 0);
    state.daily = state.daily || emptyBucket();
    state.weekly = state.weekly || emptyBucket();
    state.idempotency = state.idempotency || {};
    if (state.utcDay !== utcDay(nowMs)) {
      state.utcDay = utcDay(nowMs);
      state.daily = emptyBucket();
      if (state.reservation && state.reservation.bucket === "daily") state.reservation = null;
    }
    if (state.isoWeek !== isoWeek(nowMs)) {
      state.isoWeek = isoWeek(nowMs);
      state.weekly = emptyBucket();
      if (state.reservation && state.reservation.bucket === "weekly") state.reservation = null;
    }
    if (state.reservation && state.reservation.expiresMs <= nowMs) {
      var reservedBucket = state.reservation.bucket === "weekly" ? state.weekly : state.daily;
      if (!reservedBucket.consumed) state.reservation = null;
    }
    return state;
  }

  function readState(nk: nkruntime.Nakama, userId: string, nowMs: number): StoredState {
    var rows = nk.storageRead([{ collection: COLLECTION, key: KEY, userId: userId }]);
    if (!rows || rows.length === 0) {
      return { value: createState(nowMs), version: "*", exists: false };
    }
    return {
      value: normalizeState(rows[0].value, nowMs),
      version: rows[0].version || "",
      exists: true
    };
  }

  function writeState(
    nk: nkruntime.Nakama,
    userId: string,
    stored: StoredState
  ): void {
    nk.storageWrite([{
      collection: COLLECTION,
      key: KEY,
      userId: userId,
      value: stored.value as any,
      version: stored.exists ? stored.version : "*",
      permissionRead: 1,
      permissionWrite: 0
    }]);
  }

  function mutateState(
    nk: nkruntime.Nakama,
    userId: string,
    nowMs: number,
    mutator: (state: PromptState) => MutationResult
  ): any {
    var lastError: any = null;
    for (var attempt = 0; attempt < OCC_MAX_RETRIES; attempt++) {
      var stored = readState(nk, userId, nowMs);
      var result = mutator(stored.value);
      if (!result.write) return result.response;
      try {
        writeState(nk, userId, stored);
        return result.response;
      } catch (err: any) {
        lastError = err;
      }
    }
    throw lastError || new Error("brain_prompt_occ_exhausted");
  }

  function parsePayload(payload: string): any {
    if (!payload) return {};
    try { return JSON.parse(payload); }
    catch (_) { return null; }
  }

  function safeString(value: any, maxLength: number): string {
    return String(value || "").trim().slice(0, maxLength);
  }

  function emit(
    ctx: nkruntime.Context,
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    eventName: string,
    eventData: any,
    clientEventId: string
  ): void {
    try {
      var nowSec = Math.floor(Date.now() / 1000);
      persistNormalizedEvent(nk, logger, {
        userId: userId,
        gameId: (ctx.env && ctx.env["DEFAULT_GAME_ID"]) || DEFAULT_GAME_ID,
        eventName: eventName,
        originalEventName: eventName,
        canonicalized: false,
        eventData: eventData || {},
        platform: "unity",
        sessionId: ctx.sessionId || null,
        timestamp: new Date(nowSec * 1000).toISOString(),
        unixTimestamp: nowSec,
        schemaVersion: 1,
        clientEventId: clientEventId || null,
        eventTime: null,
        quizSessionId: eventData && eventData.result_id || null,
        screenId: eventData && eventData.screen_id || null,
        privacyTier: 1,
        v2Warnings: []
      });
    } catch (err: any) {
      logger.warn("[BrainPrompt] analytics failed: " + (err && err.message ? err.message : String(err)));
    }
  }

  function readPremiumHint(nk: nkruntime.Nakama, userId: string): any {
    try {
      var rows = nk.storageRead([{ collection: "qv_entitlements", key: "subscriptions", userId: userId }]);
      var subs: any = rows && rows.length ? rows[0].value : {};
      var tier = safeString(subs && subs.tier, 64).toLowerCase();
      var active = !!tier && String(subs && subs.status || "active").toLowerCase() !== "expired";
      if (active && subs && subs.expiresAt) {
        var exp = new Date(subs.expiresAt).getTime();
        if (!isNaN(exp) && exp <= Date.now()) active = false;
      }
      return { tier: tier || "free", isPremium: active };
    } catch (_) {
      return { tier: "free", isPremium: false };
    }
  }

  function selectPrompt(data: any): any {
    var trigger = safeString(data.trigger, 32).toLowerCase();
    var session = data.session && typeof data.session === "object" ? data.session : {};
    if (trigger === "app_home_open") {
      return { promptId: "weekly_recap", bucket: "weekly" };
    }
    if (trigger !== "post_quiz_results") return null;

    var maxWrong = Math.max(0, Math.min(1000, Number(session.max_consecutive_wrong || 0)));
    if (maxWrong >= 3) return { promptId: "wrong_streak", bucket: "daily" };

    var accuracy = Number(session.category_accuracy_pct);
    var notesEligible = data.notes_eligible === true;
    if (isFinite(accuracy) && accuracy >= 0 && accuracy < 60 && notesEligible) {
      return { promptId: "post_quiz_weak", bucket: "daily" };
    }
    return null;
  }

  function rpcEvaluate(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = parsePayload(payload);
    if (data === null) return RpcHelpers.errorResponse("invalid JSON payload", 400);

    var selected = selectPrompt(data);
    var clientEventId = safeString(data.client_event_id, 128);
    var nowMs = Date.now();
    if (!selected) {
      emit(ctx, nk, logger, userId, "brain_prompt_suppressed",
        { reason: "criteria_not_met", trigger: safeString(data.trigger, 32) }, clientEventId);
      return RpcHelpers.successResponse({
        status: "suppressed",
        prompt_id: null,
        reason: "criteria_not_met",
        server_time_ms: nowMs
      });
    }

    var response = mutateState(nk, userId, nowMs, function (state: PromptState): MutationResult {
      var bucket = selected.bucket === "weekly" ? state.weekly : state.daily;
      if (bucket.consumed) {
        return {
          write: false,
          response: {
            status: "suppressed",
            prompt_id: null,
            reason: selected.bucket + "_slot_consumed",
            server_time_ms: nowMs
          }
        };
      }

      if (selected.promptId === "weekly_recap") {
        if (!state.lastSuccessfulBrainVisitMs) {
          return {
            write: false,
            response: {
              status: "suppressed",
              prompt_id: null,
              reason: "brain_never_opened",
              server_time_ms: nowMs
            }
          };
        }
        if (nowMs - state.lastSuccessfulBrainVisitMs < WEEK_MS) {
          return {
            write: false,
            response: {
              status: "suppressed",
              prompt_id: null,
              reason: "brain_visit_recent",
              next_eligible_ms: state.lastSuccessfulBrainVisitMs + WEEK_MS,
              server_time_ms: nowMs
            }
          };
        }
      }

      if (state.reservation && state.reservation.expiresMs > nowMs) {
        if (clientEventId && state.reservation.clientEventId === clientEventId &&
            state.reservation.promptId === selected.promptId) {
          return {
            write: false,
            response: {
              status: "eligible",
              prompt_id: selected.promptId,
              reservation_token: state.reservation.token,
              reservation_expires_ms: state.reservation.expiresMs,
              replay: true,
              server_time_ms: nowMs
            }
          };
        }
        return {
          write: false,
          response: {
            status: "suppressed",
            prompt_id: null,
            reason: "reservation_active",
            server_time_ms: nowMs
          }
        };
      }

      var token = nk.uuidv4();
      state.reservation = {
        token: token,
        promptId: selected.promptId,
        bucket: selected.bucket,
        clientEventId: clientEventId,
        resultId: safeString(data.session && data.session.result_id, 128),
        createdMs: nowMs,
        expiresMs: nowMs + RESERVATION_TTL_MS
      };
      return {
        write: true,
        response: {
          status: "eligible",
          prompt_id: selected.promptId,
          reservation_token: token,
          reservation_expires_ms: nowMs + RESERVATION_TTL_MS,
          context: selected.promptId,
          category: safeString(data.session && data.session.category, 128),
          server_time_ms: nowMs
        }
      };
    });

    response.premium_hint = readPremiumHint(nk, userId);
    emit(ctx, nk, logger, userId,
      response.status === "eligible" ? "brain_prompt_eligible" : "brain_prompt_suppressed",
      {
        prompt_id: response.prompt_id,
        reason: response.reason || "",
        trigger: safeString(data.trigger, 32),
        result_id: safeString(data.session && data.session.result_id, 128)
      },
      clientEventId);
    return RpcHelpers.successResponse(response);
  }

  function pruneIdempotency(state: PromptState): void {
    var keys = Object.keys(state.idempotency || {});
    if (keys.length <= IDEM_MAX_ENTRIES) return;
    keys.sort(function (a, b) {
      return (state.idempotency[a].atMs || 0) - (state.idempotency[b].atMs || 0);
    });
    while (keys.length > IDEM_MAX_ENTRIES) {
      delete state.idempotency[keys.shift() as string];
    }
  }

  function rpcCommit(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string
  ): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = parsePayload(payload);
    if (data === null) return RpcHelpers.errorResponse("invalid JSON payload", 400);

    var action = safeString(data.action, 32).toLowerCase();
    if (action !== "shown" && action !== "accepted" &&
        action !== "opened" && action !== "suppressed") {
      return RpcHelpers.errorResponse("action must be shown|accepted|opened|suppressed", 400);
    }

    var promptId = safeString(data.prompt_id, 64);
    var token = safeString(data.reservation_token, 64);
    var idemKey = safeString(data.idempotency_key, 128);
    var clientEventId = safeString(data.client_event_id, 128);
    var directOpen = action === "opened" &&
      (promptId === "graph" || promptId === "profile" || promptId === "manual");
    if (!directOpen && !token) return RpcHelpers.errorResponse("reservation_token required", 400);
    if (!idemKey) return RpcHelpers.errorResponse("idempotency_key required", 400);

    var nowMs = Date.now();
    var response = mutateState(nk, userId, nowMs, function (state: PromptState): MutationResult {
      var replay = state.idempotency[idemKey];
      if (replay) {
        return {
          write: false,
          response: {
            status: "replay",
            action: replay.action,
            prompt_id: replay.promptId,
            slot_consumed: replay.promptId === "weekly_recap"
              ? state.weekly.consumed : state.daily.consumed,
            last_successful_brain_visit_ms: state.lastSuccessfulBrainVisitMs,
            server_time_ms: nowMs
          }
        };
      }

      var reservation = state.reservation;
      if (!directOpen) {
        if (!reservation || reservation.token !== token || reservation.promptId !== promptId) {
          return {
            write: false,
            response: { status: "rejected", reason: "reservation_mismatch", server_time_ms: nowMs }
          };
        }
        var reservedBucket = reservation.bucket === "weekly" ? state.weekly : state.daily;
        if (reservation.expiresMs <= nowMs && !reservedBucket.consumed) {
          state.reservation = null;
          return {
            write: true,
            response: { status: "rejected", reason: "reservation_expired", server_time_ms: nowMs }
          };
        }
      }

      var bucket = reservation && reservation.bucket === "weekly" ? state.weekly : state.daily;
      if (action === "shown") {
        bucket.consumed = true;
        bucket.promptId = promptId;
        bucket.shownMs = nowMs;
      } else if (action === "opened") {
        state.lastSuccessfulBrainVisitMs = nowMs;
        if (!directOpen) {
          bucket.consumed = true;
          bucket.promptId = promptId;
          if (!bucket.shownMs) bucket.shownMs = nowMs;
          bucket.openedMs = nowMs;
        }
      } else if (action === "suppressed") {
        state.reservation = null;
      }

      state.idempotency[idemKey] = { action: action, promptId: promptId, atMs: nowMs };
      pruneIdempotency(state);
      return {
        write: true,
        response: {
          status: action,
          prompt_id: promptId,
          slot_consumed: directOpen ? false : bucket.consumed,
          last_successful_brain_visit_ms: state.lastSuccessfulBrainVisitMs,
          server_time_ms: nowMs
        }
      };
    });

    var eventName = action === "shown" ? "brain_prompt_shown" :
      action === "accepted" ? "brain_prompt_accepted" :
      action === "opened" ? "brain_prompt_opened" : "brain_prompt_suppressed";
    emit(ctx, nk, logger, userId, eventName, {
      prompt_id: promptId,
      status: response.status,
      reason: safeString(data.suppress_reason || response.reason, 128),
      result_id: safeString(data.result_id, 128),
      screen_id: safeString(data.screen_id, 64)
    }, clientEventId);
    return RpcHelpers.successResponse(response);
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quizverse_brain_prompt_evaluate", rpcEvaluate);
    initializer.registerRpc("quizverse_brain_prompt_commit", rpcCommit);
  }
}
