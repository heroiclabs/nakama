namespace SatoriCreatorEvents {

  // ---- Types ----

  interface CreatorEventQuestion {
    id?: string;
    text?: string;
    question?: string;
    q?: string;
    options?: string[];
    correctAnswer?: string;
    answer?: string;
    a?: string;
    timeLimit?: number;
    points?: number;
  }

  interface CreatorEventPrizeTier {
    tier: string;
    percentage: number;
    maxWinners: number;
    nftBadgeId?: string;
  }

  interface GiftCardTier {
    rank: string;       // "1st", "2nd", "3rd", "4th", "5th", "6_10", "top_10", "all"
    prize: string;      // "Amazon India ₹1,000"
    brand: string;      // "amazon_in", "swiggy", "google_play", "starbucks"
    value: number;
    currency: string;   // "INR" | "USD"
    fulfillment?: string; // "gyftr" | "tremendous" | "manual"
  }

  interface GiftCardPrizes {
    region: string;     // "india" | "usa" | "global"
    tiers: GiftCardTier[];
    totalValue: number;
    totalCurrency: string;
  }

  /** Rank → tier keys to try (most specific first; legacy top_10/all kept for USA pool). */
  function tierLookupKeysForRank(rank: number): string[] {
    var keys: string[] = [];
    if (rank === 1) keys.push("1st");
    else if (rank === 2) keys.push("2nd");
    else if (rank === 3) keys.push("3rd");
    else if (rank === 4) keys.push("4th");
    else if (rank === 5) keys.push("5th");
    else if (rank >= 6 && rank <= 10) keys.push("6_10");
    if (rank > 3 && rank <= 10) keys.push("top_10");
    if (rank > 10) keys.push("all");
    return keys;
  }

  function findGiftCardTierForRank(tiers: GiftCardTier[] | undefined, rank: number): GiftCardTier | null {
    if (!tiers || tiers.length === 0) return null;
    var keys = tierLookupKeysForRank(rank);
    for (var ki = 0; ki < keys.length; ki++) {
      for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i];
        if (t && t.rank === keys[ki]) return t;
      }
    }
    return null;
  }

  interface PrizeFunding {
    method: "free" | "coins" | "pool" | "stripe";
    amount?: number;
    currency?: string;
    status?: string;
    stripeSessionId?: string;
  }

  interface CreatorEventDefinition {
    id: string;
    creatorId: string;
    title: string;
    description: string;
    category: string;
    customTopic?: string;
    gameMode: string;
    /** "casual" | "challenge" | "expert" — controls speed-bonus multiplier. */
    difficulty?: string;
    scheduledAt: number;
    duration: number;
    region: string;
    timezone: string;
    entryFee: number;
    prizePool: number;
    prizes: CreatorEventPrizeTier[];
    giftCardPrizes?: GiftCardPrizes;
    prizeFunding?: PrizeFunding;
    creatorEmail?: string;
    questions: CreatorEventQuestion[];
    clues?: string[];
    answer?: string;
    promoVideoUrl?: string;
    recapVideoUrl?: string;
    deepLinkUrl?: string;
    status: string;
    participantCount: number;
    publishedAt?: number;
    endedAt?: number;
    createdAt?: number;
  }

  interface UserAnswer {
    questionId: string;
    answer: string;
    correct: boolean;
    answeredAt: number;
    points: number;
  }

  interface UserCreatorEventState {
    eventId: string;
    joinedAt?: number;
    currentQuestion: number;
    score: number;
    answers: UserAnswer[];
    tierEarned?: string;
    rank?: number;
    claimedAt?: number;
    eliminated?: boolean;
  }

  interface CreatorEventsIndex {
    eventIds: string[];
  }

  var COLLECTION = "satori_creator_events";
  var LEADERBOARD_PREFIX = "creator_event_";
  var TIER_ORDER = ["platinum", "gold", "silver", "bronze", "participation"];

  // ---- Storage helpers ----

  function getEventDefinition(nk: nkruntime.Nakama, eventId: string): CreatorEventDefinition | null {
    return Storage.readSystemJson<CreatorEventDefinition>(nk, COLLECTION, eventId);
  }

  function saveEventDefinition(nk: nkruntime.Nakama, def: CreatorEventDefinition): void {
    Storage.writeSystemJson(nk, COLLECTION, def.id, def);
  }

  function getEventsIndex(nk: nkruntime.Nakama): CreatorEventsIndex {
    var data = Storage.readSystemJson<CreatorEventsIndex>(nk, COLLECTION, "events_index");
    return data || { eventIds: [] };
  }

  function saveEventsIndex(nk: nkruntime.Nakama, index: CreatorEventsIndex): void {
    Storage.writeSystemJson(nk, COLLECTION, "events_index", index);
  }

  function getUserStates(nk: nkruntime.Nakama, userId: string): { [eventId: string]: UserCreatorEventState } {
    var data = Storage.readJson<{ events: { [eventId: string]: UserCreatorEventState } }>(nk, COLLECTION, "user_state", userId);
    return (data && data.events) || {};
  }

  function saveUserStates(nk: nkruntime.Nakama, userId: string, states: { [eventId: string]: UserCreatorEventState }): void {
    Storage.writeJson(nk, COLLECTION, "user_state", userId, { events: states });
  }

  function computeEffectiveStatus(def: CreatorEventDefinition): string {
    if (def.status === "cancelled" || def.status === "distributed") return def.status;
    if (def.status === "draft" || def.status === "funded") return def.status;

    var now = serverNowSec();
    var endAt = def.scheduledAt + (def.duration * 60);

    if (now < def.scheduledAt) return "published";
    if (now > endAt) return "ended";
    return "live";
  }

  /** Authoritative server unix time (seconds) for cross-device countdown sync. */
  function serverNowSec(): number {
    return Math.floor(Date.now() / 1000);
  }

  function eventTimingFields(def: CreatorEventDefinition, now: number): { endAt: number; startsInSec: number; endsInSec: number } {
    var startAt = def.scheduledAt || 0;
    var durMin = def.duration || 30;
    var endAt = startAt + durMin * 60;
    var startsInSec = startAt > now ? startAt - now : 0;
    var endsInSec = endAt > now ? endAt - now : 0;
    return { endAt: endAt, startsInSec: startsInSec, endsInSec: endsInSec };
  }

  function toPublicEventRow(
    def: CreatorEventDefinition,
    status: string,
    userState: UserCreatorEventState | null | undefined,
    now: number
  ): any {
    var timing = eventTimingFields(def, now);
    return {
      id: def.id,
      creatorId: def.creatorId,
      title: def.title,
      description: def.description,
      category: def.category,
      customTopic: def.customTopic || "",
      gameMode: def.gameMode,
      scheduledAt: def.scheduledAt,
      duration: def.duration,
      endAt: timing.endAt,
      startsInSec: timing.startsInSec,
      endsInSec: timing.endsInSec,
      region: def.region,
      entryFee: def.entryFee,
      prizePool: def.prizePool,
      prizes: def.prizes,
      promoVideoUrl: def.promoVideoUrl || "",
      deepLinkUrl: def.deepLinkUrl || "",
      status: status,
      participantCount: def.participantCount,
      questionCount: def.questions ? def.questions.length : 0,
      joined: userState ? !!userState.joinedAt : false,
      score: userState ? userState.score : 0,
      tierEarned: userState ? userState.tierEarned || "" : "",
      claimed: userState ? !!userState.claimedAt : false,
    };
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var filterStatus = data.status || null;

    var index = getEventsIndex(nk);
    var userStates = getUserStates(nk, userId);

    var now = serverNowSec();
    var result: any[] = [];
    for (var i = 0; i < index.eventIds.length; i++) {
      var eventId = index.eventIds[i];
      var def = getEventDefinition(nk, eventId);
      if (!def) continue;

      var status = computeEffectiveStatus(def);
      if (filterStatus && status !== filterStatus) continue;
      if (status === "draft" || status === "funded") continue;

      var userState = userStates[eventId];
      result.push(toPublicEventRow(def, status, userState, now));
    }

    return RpcHelpers.successResponse({ events: result, server_time: now });
  }

  function rpcGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, String(data.eventId));
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var now = serverNowSec();
    var status = computeEffectiveStatus(def);
    var userStates = getUserStates(nk, userId);
    var userState = userStates[def.id] || null;

    return RpcHelpers.successResponse({
      event: toPublicEventRow(def, status, userState, now),
      server_time: now,
    });
  }

  function rpcServerClock(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireUserId(ctx);
    var now = serverNowSec();
    return RpcHelpers.successResponse({ server_time: now });
  }

  function rpcJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var status = computeEffectiveStatus(def);
    if (status !== "live" && status !== "published") {
      return RpcHelpers.errorResponse("Event is not accepting participants");
    }

    var userStates = getUserStates(nk, userId);
    if (userStates[data.eventId] && userStates[data.eventId].joinedAt) {
      return RpcHelpers.errorResponse("Already joined");
    }

    var gameId = data.gameId || Constants.DEFAULT_GAME_ID;

    if (def.entryFee > 0) {
      if (!WalletHelpers.hasCurrency(nk, userId, gameId, "xut", def.entryFee)) {
        return RpcHelpers.errorResponse("Insufficient XUT balance for entry fee");
      }
      WalletHelpers.spendCurrency(nk, logger, ctx, userId, gameId, "xut", def.entryFee);
      EventBus.emit(nk, logger, ctx, EventBus.Events.CURRENCY_SPENT, {
        userId: userId,
        gameId: gameId,
        currencyId: "xut",
        amount: def.entryFee,
        reason: "creator_event_entry_fee",
        eventId: data.eventId,
      });
    }

    userStates[data.eventId] = {
      eventId: data.eventId,
      joinedAt: Math.floor(Date.now() / 1000),
      currentQuestion: 0,
      score: 0,
      answers: [],
      eliminated: false,
    };
    saveUserStates(nk, userId, userStates);

    def.participantCount = (def.participantCount || 0) + 1;
    saveEventDefinition(nk, def);

    var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
    try {
      nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", 0, 0);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Failed to write initial leaderboard record: %s", err.message || String(err));
    }

    return RpcHelpers.successResponse({
      success: true,
      eventId: data.eventId,
      entryFeePaid: def.entryFee,
    });
  }

  /** Convert a stored difficulty string into a server-trusted speed-bonus multiplier.
   *  This is the single source of truth — clients can't influence the multiplier
   *  because the value comes from the event definition, not the request payload. */
  function difficultySpeedMultiplier(diff: string | undefined | null): number {
    var d = (diff || "challenge").toString().toLowerCase().trim();
    if (d === "casual" || d === "easy") return 1.0;
    if (d === "expert" || d === "hard" || d === "pro") return 2.0;
    return 1.5; // challenge / default
  }

  function normalizeAnswer(value: any): string {
    return String(value === undefined || value === null ? "" : value).toLowerCase().replace(/\s+/g, " ").trim();
  }

  function answersMatch(given: any, expected: any): boolean {
    var g = normalizeAnswer(given);
    var e = normalizeAnswer(expected);
    return !!g && !!e && g === e;
  }

  function questionAnswer(q: any): string {
    if (!q) return "";
    return String(q.correctAnswer || q.answer || q.a || "");
  }

  function questionPrompt(q: any): string {
    if (!q) return "";
    return String(q.text || q.question || q.q || q.id || "");
  }

  function numericValue(value: any, fallback: number): number {
    var n = Number(value);
    return isFinite(n) ? n : fallback;
  }

  function speedQuizQuestionSeconds(diff: string | undefined | null): number {
    var d = (diff || "challenge").toString().toLowerCase().trim();
    if (d === "casual" || d === "easy") return 25;
    if (d === "expert" || d === "hard" || d === "pro") return 12;
    return 18;
  }

  function findLiveEventDefinition(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventId: string, creatorId?: string): CreatorEventDefinition | null {
    var seen: { [id: string]: boolean } = {};
    var owners: string[] = [];
    if (creatorId) owners.push(String(creatorId));
    owners.push(Constants.SYSTEM_USER_ID);

    for (var oi = 0; oi < owners.length; oi++) {
      var owner = owners[oi];
      if (!owner || seen[owner]) continue;
      seen[owner] = true;
      try {
        var records = nk.storageRead([{ collection: "live_events", key: eventId, userId: owner }]);
        if (records && records.length > 0 && records[0].value) {
          return records[0].value as CreatorEventDefinition;
        }
      } catch (readErr: any) {
        logger.warn("[CreatorEvent] live_events read failed for event %s owner %s: %s", eventId, owner, readErr.message || String(readErr));
      }
    }

    var cursor = "";
    for (var page = 0; page < 10; page++) {
      try {
        var result = nk.storageList(null, "live_events", 100, cursor);
        var objects = result.objects || [];
        for (var i = 0; i < objects.length; i++) {
          var obj = objects[i];
          if (obj && obj.key === eventId && obj.value) {
            return obj.value as CreatorEventDefinition;
          }
        }
        cursor = result.cursor || "";
        if (!cursor) break;
      } catch (listErr: any) {
        logger.warn("[CreatorEvent] live_events list failed while locating event %s: %s", eventId, listErr.message || String(listErr));
        break;
      }
    }

    return null;
  }

  function loadSubmitEventDefinition(nk: nkruntime.Nakama, logger: nkruntime.Logger, data: any, eventId: string): CreatorEventDefinition | null {
    var def = getEventDefinition(nk, eventId);
    if (def) return def;
    return findLiveEventDefinition(nk, logger, eventId, data.creatorId || data.creator_id);
  }

  function readCompletedAnswer(nk: nkruntime.Nakama, eventId: string, userId: string): any {
    var records = nk.storageRead([{ collection: "event_answers", key: eventId, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
      return records[0].value;
    }
    return null;
  }

  function validateSubmitWindow(def: CreatorEventDefinition, nowSec: number): string {
    var status = (def.status || "published").toString().toLowerCase();
    if (status === "cancelled") return "Event is cancelled";
    if (status === "ended" || status === "distributed") return "Event has ended";
    if (status === "draft" || status === "funded") return "Event is not live";

    var startAt = Math.floor(numericValue(def.scheduledAt, 0));
    var durationMin = numericValue(def.duration, 30);
    if (startAt <= 0 || durationMin <= 0) return "Event schedule is invalid";

    var endAt = startAt + Math.floor(durationMin * 60);
    if (nowSec < startAt) return "Event has not started yet";
    if (nowSec >= endAt) return "Event has ended";
    return "";
  }

  function scoreBestGuess(def: CreatorEventDefinition, answer: any, nowMs: number): any {
    var correctAnswer = String(def.answer || "");
    var correct = answersMatch(answer, correctAnswer);
    var startMs = Math.floor(numericValue(def.scheduledAt, 0) * 1000);
    var durationSec = Math.max(1, Math.floor(numericValue(def.duration, 30) * 60));
    var elapsedSec = startMs > 0 ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0;
    var speedBonus = 0;

    if (correct) {
      var remainingRatio = Math.max(0, Math.min(1, (durationSec - elapsedSec) / durationSec));
      speedBonus = Math.floor(Math.round(900 * remainingRatio) * difficultySpeedMultiplier(def.difficulty));
    }

    return {
      answer: String(answer),
      correct: correct,
      score: correct ? 100 + speedBonus : 0,
      speedBonus: speedBonus,
      elapsedSec: elapsedSec,
      correctAnswer: correctAnswer,
      funFact: (def as any).funFact || "",
      correctCount: correct ? 1 : 0,
      totalQuestions: 1,
      qAnswers: [],
    };
  }

  function scoreQuestionSet(def: CreatorEventDefinition, data: any, nowMs: number): any {
    var questions = def.questions || [];
    if (!questions || questions.length === 0) {
      return { error: "Event has no questions configured" };
    }

    var submitted = Array.isArray(data.answers) ? data.answers : (Array.isArray(data.qAnswers) ? data.qAnswers : []);
    var splitAnswers = submitted.length === 0 ? String(data.answer || "").split("|") : [];
    var submittedByIndex: { [idx: number]: any } = {};
    for (var si = 0; si < submitted.length; si++) {
      var submittedItem = submitted[si];
      var submittedIdx = si;
      if (submittedItem !== undefined && submittedItem !== null && typeof submittedItem === "object") {
        var idxValue = (submittedItem as any).questionIdx;
        if (idxValue === undefined || idxValue === null) idxValue = (submittedItem as any).question_idx;
        var parsedIdx = Number(idxValue);
        if (isFinite(parsedIdx) && parsedIdx >= 0) submittedIdx = Math.floor(parsedIdx);
      }
      submittedByIndex[submittedIdx] = submittedItem;
    }

    var correctCount = 0;
    var totalScore = 0;
    var totalSpeedBonus = 0;
    var sanitizedAnswers: any[] = [];
    var perQuestionSec = speedQuizQuestionSeconds(def.difficulty);
    var maxSpeedBonus = Math.floor(perQuestionSec * 10 * difficultySpeedMultiplier(def.difficulty));
    var startMs = Math.floor(numericValue(def.scheduledAt, 0) * 1000);
    var elapsedSec = startMs > 0 ? Math.max(0, Math.floor((nowMs - startMs) / 1000)) : 0;
    var trustedQuestionBudget = Math.max(1, questions.length * perQuestionSec);
    var trustedSpeedRatio = Math.max(0, Math.min(1, (trustedQuestionBudget - elapsedSec) / trustedQuestionBudget));

    for (var i = 0; i < questions.length; i++) {
      var question = questions[i] as any;
      var provided = submitted.length > 0 ? submittedByIndex[i] : splitAnswers[i];
      var given = "";

      if (provided !== undefined && provided !== null && typeof provided === "object") {
        given = String((provided as any).given || (provided as any).answer || "");
      } else {
        given = String(provided || "").trim();
      }

      var expected = questionAnswer(question);
      var correct = answersMatch(given, expected);
      var baseScore = correct ? Math.floor(numericValue(question.points, 100)) : 0;
      var appliedSpeedBonus = 0;
      if (correct) {
        appliedSpeedBonus = Math.floor(maxSpeedBonus * trustedSpeedRatio);
      }

      var qScore = baseScore + appliedSpeedBonus;
      if (correct) correctCount++;
      totalScore += qScore;
      totalSpeedBonus += appliedSpeedBonus;
      sanitizedAnswers.push({
        questionIdx: i,
        question: questionPrompt(question),
        given: given,
        correct: correct,
        score: qScore,
        speedBonus: appliedSpeedBonus,
      });
    }

    var answerText = String(data.answer || "");
    if (!answerText) {
      var parts: string[] = [];
      for (var pi = 0; pi < sanitizedAnswers.length; pi++) parts.push(String(sanitizedAnswers[pi].given || ""));
      answerText = parts.join(" | ");
    }

    var correctAnswers: string[] = [];
    for (var ci = 0; ci < questions.length; ci++) correctAnswers.push(questionAnswer(questions[ci]));

    return {
      answer: answerText,
      correct: correctCount > 0,
      score: totalScore,
      speedBonus: totalSpeedBonus,
      elapsedSec: elapsedSec,
      correctAnswer: correctAnswers.join(" | "),
      funFact: (def as any).funFact || "",
      correctCount: correctCount,
      totalQuestions: questions.length,
      qAnswers: sanitizedAnswers,
    };
  }

  function rpcCanPlay(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var eventId = String(data.eventId);
    var completedAnswer = readCompletedAnswer(nk, eventId, userId);
    if (completedAnswer) {
      return RpcHelpers.successResponse({
        success: true,
        eventId: eventId,
        canPlay: false,
        played: 1,
        completed: true,
        submitted: true,
        reason: "You have already completed this event.",
        score: completedAnswer.score || 0,
        correct: completedAnswer.correct === true,
      });
    }

    var def = loadSubmitEventDefinition(nk, logger, data, eventId);
    var checkWindow = data.checkWindow !== false && data.check_window !== false;
    if (def && checkWindow) {
      var windowError = validateSubmitWindow(def, Math.floor(Date.now() / 1000));
      if (windowError) {
        return RpcHelpers.successResponse({
          success: true,
          eventId: eventId,
          canPlay: false,
          played: 0,
          completed: false,
          submitted: false,
          reason: windowError,
        });
      }
    }

    return RpcHelpers.successResponse({
      success: true,
      eventId: eventId,
      canPlay: true,
      played: 0,
      completed: false,
      submitted: false,
    });
  }

  function rpcSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var eventId = String(data.eventId);
    if (readCompletedAnswer(nk, eventId, userId)) {
      return RpcHelpers.errorResponse("You have already completed this event.");
    }

    var def = loadSubmitEventDefinition(nk, logger, data, eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var nowMs = Date.now();
    var nowSec = Math.floor(nowMs / 1000);
    var windowError = validateSubmitWindow(def, nowSec);
    if (windowError) return RpcHelpers.errorResponse(windowError);

    var mode = String(def.gameMode || "best_guess").toLowerCase();
    if (mode === "speed_quiz" || mode === "elimination") {
      var hasAnswerArray = Array.isArray(data.answers) || Array.isArray(data.qAnswers);
      if (!hasAnswerArray && (data.answer === undefined || data.answer === null)) return RpcHelpers.errorResponse("answers required");
    } else if (data.answer === undefined || data.answer === null) {
      return RpcHelpers.errorResponse("answer required");
    }

    var scoreResult = (mode === "speed_quiz" || mode === "elimination")
      ? scoreQuestionSet(def, data, nowMs)
      : scoreBestGuess(def, data.answer, nowMs);
    if (scoreResult.error) return RpcHelpers.errorResponse(scoreResult.error);

    var answerRecord: any = {
      eventId: eventId,
      playerId: userId,
      deviceId: data.deviceId || data.device_id || "",
      playerName: String(data.playerName || data.displayName || data.player_name || ctx.username || "").trim(),
      answer: scoreResult.answer,
      correct: scoreResult.correct,
      score: scoreResult.score,
      speedBonus: scoreResult.speedBonus,
      submitMs: nowMs,
      elapsedSec: scoreResult.elapsedSec,
      answered: true,
      correctCount: scoreResult.correctCount,
      totalQuestions: scoreResult.totalQuestions,
      qAnswers: scoreResult.qAnswers,
      source: "creator_event_submit_rpc",
    };

    try {
      nk.storageWrite([{
        collection: "event_answers",
        key: eventId,
        userId: userId,
        value: answerRecord,
        permissionRead: 2,
        permissionWrite: 0,
        version: "*",
      }]);
    } catch (writeErr: any) {
      logger.warn("[CreatorEvent] Duplicate/failed answer write for user=%s event=%s: %s", userId, eventId, writeErr.message || String(writeErr));
      return RpcHelpers.errorResponse("You have already completed this event.");
    }

    var leaderboardId = LEADERBOARD_PREFIX + eventId;

    try {
      var lbUsername = String(data.playerName || data.displayName || data.player_name || ctx.username || "").trim();
      nk.leaderboardRecordWrite(leaderboardId, userId, lbUsername, scoreResult.score, 0);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Leaderboard write failed: %s", err.message || String(err));
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
      userId: userId,
      eventId: eventId,
      score: scoreResult.score,
      correct: scoreResult.correct,
    });

    return RpcHelpers.successResponse({
      success: true,
      correct: scoreResult.correct,
      score: scoreResult.score,
      speedBonus: scoreResult.speedBonus,
      totalScore: scoreResult.score,
      correctAnswer: scoreResult.correctAnswer,
      funFact: scoreResult.funFact,
      correctCount: scoreResult.correctCount,
      totalQuestions: scoreResult.totalQuestions,
      difficulty: def.difficulty || "challenge",
      speedMultiplier: difficultySpeedMultiplier(def.difficulty),
    });
  }

  function rpcLeaderboard(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
    var limit = data.limit || 50;

    try {
      var records = nk.leaderboardRecordsList(leaderboardId, [], limit, data.cursor || "");
      var entries: any[] = [];
      var ownerRecords = records.records || [];
      for (var ri = 0; ri < ownerRecords.length; ri++) {
        var rec = ownerRecords[ri];
        entries.push({
          userId: rec.ownerId,
          username: rec.username || "",
          score: rec.score,
          rank: rec.rank,
        });
      }

      var userRank: any = null;
      try {
        var userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "");
        var userOwnerRecs = userRecords.ownerRecords || [];
        if (userOwnerRecs.length > 0) {
          userRank = {
            userId: userOwnerRecs[0].ownerId,
            username: userOwnerRecs[0].username || "",
            score: userOwnerRecs[0].score,
            rank: userOwnerRecs[0].rank,
          };
        }
      } catch (_: any) {
        // user may not have a record yet
      }

      return RpcHelpers.successResponse({
        eventId: data.eventId,
        entries: entries,
        userRank: userRank,
        nextCursor: records.nextCursor || "",
        prevCursor: records.prevCursor || "",
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse("Failed to fetch leaderboard: " + (err.message || String(err)));
    }
  }

  function rpcResults(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var status = computeEffectiveStatus(def);
    if (status !== "ended" && status !== "distributed") {
      return RpcHelpers.errorResponse("Event has not ended yet");
    }

    var userStates = getUserStates(nk, userId);
    var state = userStates[data.eventId];
    if (!state || !state.joinedAt) return RpcHelpers.errorResponse("Not a participant");

    var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
    var userRank = 0;
    try {
      var userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "");
      var ownerRecs = userRecords.ownerRecords || [];
      if (ownerRecs.length > 0) {
        userRank = ownerRecs[0].rank;
      }
    } catch (_: any) {
      // record may not exist
    }

    return RpcHelpers.successResponse({
      eventId: data.eventId,
      score: state.score,
      rank: state.rank || userRank,
      tierEarned: state.tierEarned || "",
      claimed: !!state.claimedAt,
      answers: state.answers,
      totalParticipants: def.participantCount,
      prizePool: def.prizePool,
      prizes: def.prizes,
    });
  }

  function rpcClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    // Player-supplied delivery email (optional). Used to send a SES prize-delivery
    // email *only* if there is a real prize (XUT > 0, gift card, or merchandise).
    var deliveryEmail = "";
    if (typeof data.email === "string") {
      var em = (data.email as string).trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) deliveryEmail = em;
    }
    var deliveryName = "";
    if (typeof data.playerName === "string") {
      deliveryName = (data.playerName as string).trim().slice(0, 120);
    }

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var status = computeEffectiveStatus(def);
    if (status !== "ended" && status !== "distributed") {
      return RpcHelpers.errorResponse("Event has not ended yet");
    }

    var userStates = getUserStates(nk, userId);
    var state = userStates[data.eventId];
    if (!state || !state.joinedAt) return RpcHelpers.errorResponse("Not a participant");
    if (state.claimedAt) return RpcHelpers.errorResponse("Already claimed");
    if (!state.tierEarned) {
      return RpcHelpers.errorResponse("No tier assigned - results not yet processed");
    }

    var gameId = data.gameId || Constants.DEFAULT_GAME_ID;
    var tierReward = HiroCreatorEventRewards.getTierReward(nk, data.eventId, state.tierEarned);
    var grantedReward: Hiro.ResolvedReward | null = null;
    var xutGranted = 0;

    if (tierReward) {
      grantedReward = RewardEngine.resolveReward(nk, tierReward);
      RewardEngine.grantReward(nk, logger, ctx, userId, gameId, grantedReward);
      // Extract actual XUT amount from resolved reward for response
      if (grantedReward && grantedReward.currencies && (grantedReward.currencies as any).xut) {
        xutGranted = (grantedReward.currencies as any).xut as number;
      }
    }

    state.claimedAt = Math.floor(Date.now() / 1000);
    saveUserStates(nk, userId, userStates);

    // Gift card fulfillment lookup
    var giftCardTier: GiftCardTier | null = null;
    if (def.giftCardPrizes && def.giftCardPrizes.tiers && def.giftCardPrizes.tiers.length > 0) {
      var matched = findGiftCardTierForRank(def.giftCardPrizes.tiers, state.rank || 0);
      if (matched && matched.fulfillment !== "nakama") {
        giftCardTier = matched;
      }
    }

    // Store pending gift card fulfillment record so admin/n8n can process it
    if (giftCardTier && giftCardTier.fulfillment !== "nakama") {
      var fulfillmentRecord = {
        userId: userId,
        eventId: data.eventId,
        rank: state.rank || 0,
        tier: state.tierEarned || "",
        giftCard: giftCardTier,
        status: "pending",
        claimedAt: state.claimedAt,
        eventTitle: def.title,
        region: def.region,
        email: deliveryEmail || "",
      };
      try {
        Storage.writeSystemJson(nk, "prize_fulfillments", data.eventId + ":" + userId, fulfillmentRecord);
        logger.info("[CreatorEvent] Gift card fulfillment queued: userId=%s event=%s tier=%s gift=%s",
          userId, data.eventId, state.tierEarned, giftCardTier.prize);
      } catch (fErr: any) {
        logger.warn("[CreatorEvent] Failed to store fulfillment record: %s", fErr.message || String(fErr));
      }
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
      userId: userId,
      eventId: data.eventId,
      tier: state.tierEarned,
      reward: grantedReward,
    });

    EventBus.emit(nk, logger, ctx, EventBus.Events.PRIZE_FULFILLMENT_REQUESTED, {
      userId: userId,
      eventId: data.eventId,
      rank: state.rank || 0,
      tier: state.tierEarned || "",
      xutGranted: xutGranted,
      giftCard: giftCardTier,
      claimedAt: state.claimedAt,
      eventTitle: def.title,
    });

    // ---- Prize delivery email (SES via quests-api, best-effort) ----
    var emailSent = false;
    var emailError = "";
    var hasRealPrize = (xutGranted > 0) || !!giftCardTier;
    if (deliveryEmail && hasRealPrize) {
      try {
        var apiBase = (ctx.env && ctx.env["QUESTS_API_BASE_URL"])
          || (ctx.env && ctx.env["LIVE_EVENTS_API_BASE_URL"])
          || "https://api.intelli-verse-x.ai";
        var sharedSecret = (ctx.env && ctx.env["LIVE_EVENTS_INTERNAL_SECRET"]) || "";
        if (!sharedSecret) {
          logger.warn("[CreatorEvent] LIVE_EVENTS_INTERNAL_SECRET not configured; skipping prize email");
        } else {
          var emailPrize: any = {
            type: giftCardTier && xutGranted > 0 ? "mixed"
              : giftCardTier ? "giftcard"
              : xutGranted > 0 ? "xut"
              : "xut",
          };
          if (xutGranted > 0) emailPrize.xutAmount = xutGranted;
          if (giftCardTier) {
            // Map server gift-card tier → flat structure expected by quests-api SES service.
            // Approximate USD value from currency (INR ≈ /83).
            var usdValue = giftCardTier.currency === "USD"
              ? giftCardTier.value
              : Math.max(1, Math.round((giftCardTier.value || 0) / 83));
            emailPrize.giftCard = {
              tier: state.rank === 1 ? "platinum"
                : state.rank === 2 ? "gold"
                : state.rank === 3 ? "silver"
                : "bronze",
              vendor: giftCardTier.brand || "amazon",
              valueUsd: usdValue,
              currency: giftCardTier.currency || "USD",
            };
          }

          var emailPayload = {
            to: deliveryEmail,
            playerName: deliveryName || "",
            eventTitle: def.title || "Live Event",
            eventId: data.eventId,
            rank: state.rank || 0,
            prize: emailPrize,
          };
          var emailUrl = apiBase.replace(/\/+$/, "") + "/api/live-events/email/prize-delivery";
          var emailHeaders: { [k: string]: string } = {
            "Content-Type": "application/json",
            "x-internal-secret": sharedSecret,
          };
          var emailResp: any = nk.httpRequest(emailUrl, "post", emailHeaders, JSON.stringify(emailPayload), 8000);
          if (emailResp && emailResp.code >= 200 && emailResp.code < 300) {
            emailSent = true;
            logger.info("[CreatorEvent] Prize email sent: user=%s event=%s to=%s", userId, data.eventId, deliveryEmail);
          } else {
            emailError = "HTTP " + (emailResp ? emailResp.code : "?") + " " + (emailResp ? (emailResp.body || "").slice(0, 200) : "");
            logger.warn("[CreatorEvent] Prize email failed: %s", emailError);
          }
        }
      } catch (eErr: any) {
        emailError = (eErr && eErr.message) ? eErr.message : String(eErr);
        logger.warn("[CreatorEvent] Prize email exception: %s", emailError);
      }
    }

    return RpcHelpers.successResponse({
      success: true,
      eventId: data.eventId,
      tier: state.tierEarned,
      rank: state.rank || 0,
      reward: grantedReward,
      xutGranted: xutGranted,
      giftCard: giftCardTier ? {
        prize: giftCardTier.prize,
        brand: giftCardTier.brand,
        value: giftCardTier.value,
        currency: giftCardTier.currency,
        fulfillment: giftCardTier.fulfillment,
        status: "pending",
      } : null,
      email: deliveryEmail ? {
        requested: true,
        sent: emailSent,
        error: emailError || undefined,
        to: deliveryEmail,
      } : { requested: false, sent: false },
    });
  }

  // ---- Creator RPCs ----

  function isAdminCtx(ctx: nkruntime.Context, nk: nkruntime.Nakama): boolean {
    try {
      RpcHelpers.requireAdmin(ctx, nk);
      return true;
    } catch (_: any) {
      return false;
    }
  }

  function rpcCreate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);

    if (!data.title) return RpcHelpers.errorResponse("title required");
    if (!data.category) return RpcHelpers.errorResponse("category required");
    if (!data.scheduledAt) return RpcHelpers.errorResponse("scheduledAt required");
    if (typeof data.scheduledAt !== "number") return RpcHelpers.errorResponse("scheduledAt must be a unix timestamp (number)");

    var event: CreatorEventDefinition = {
      id: nk.uuidv4(),
      creatorId: userId,
      title: String(data.title),
      description: String(data.description || ""),
      category: String(data.category),
      customTopic: data.customTopic ? String(data.customTopic) : "",
      gameMode: String(data.gameMode || "best_guess"),
      difficulty: data.difficulty ? String(data.difficulty).toLowerCase() : "challenge",
      scheduledAt: data.scheduledAt,
      duration: typeof data.duration === "number" ? data.duration : 30,
      region: String(data.region || "global"),
      timezone: String(data.timezone || "UTC"),
      entryFee: typeof data.entryFee === "number" ? data.entryFee : 0,
      prizePool: typeof data.prizePool === "number" ? data.prizePool : 0,
      prizes: Array.isArray(data.prizes) ? data.prizes : [],
      giftCardPrizes: data.giftCardPrizes || undefined,
      questions: Array.isArray(data.questions) ? data.questions : [],
      clues: Array.isArray(data.clues) ? data.clues : [],
      answer: data.answer ? String(data.answer) : "",
      promoVideoUrl: data.promoVideoUrl ? String(data.promoVideoUrl) : "",
      deepLinkUrl: data.deepLinkUrl ? String(data.deepLinkUrl) : "",
      status: "draft",
      participantCount: 0,
      createdAt: Math.floor(Date.now() / 1000),
    };

    saveEventDefinition(nk, event);
    logger.info("[CreatorEvent] Draft created by %s: %s (%s)", userId, event.title, event.id);

    // Emit EVENT_CREATED so Content Factory can begin PRE-GENERATING the promo
    // video immediately (well before rpcPublish). This gives the pipeline the
    // maximum runway between creation and scheduledAt.
    EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_CREATED, {
      eventId: event.id,
      creatorId: event.creatorId,
      title: event.title,
      description: event.description,
      category: event.category,
      gameMode: event.gameMode,
      region: event.region,
      scheduledAt: event.scheduledAt,
      duration: event.duration,
      prizePool: event.prizePool,
      giftCardPrizes: event.giftCardPrizes || null,
      deepLinkUrl: event.deepLinkUrl || "",
      createdAt: event.createdAt,
      idempotencyKey: "event_created_" + event.id,
    });

    return RpcHelpers.successResponse({
      success: true,
      eventId: event.id,
      status: event.status,
    });
  }

  function broadcastEventPublishedNotification(nk: nkruntime.Nakama, logger: nkruntime.Logger, event: CreatorEventDefinition): void {
    try {
      var title = "🎮 New Live Event: " + event.title;
      var body = event.description || "A new event is live — join now!";
      if (event.giftCardPrizes && event.giftCardPrizes.totalValue) {
        body = body + " Prizes up to " + event.giftCardPrizes.totalCurrency + " " + event.giftCardPrizes.totalValue + "!";
      } else if (event.prizePool) {
        body = body + " Prize pool: " + event.prizePool + " XUT!";
      }
      nk.notificationsSend([{
        userId: "",
        code: 1001,
        subject: title,
        content: {
          eventId: event.id,
          title: event.title,
          scheduledAt: event.scheduledAt,
          deepLinkUrl: event.deepLinkUrl || "",
          promoVideoUrl: event.promoVideoUrl || "",
          type: "creator_event_published",
          body: body,
        },
        persistent: true,
      }]);
      logger.info("[CreatorEvent] Broadcast notification for event %s", event.id);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Failed to broadcast notification: %s", err.message || String(err));
    }
  }

  function rpcPublish(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var isAdmin = isAdminCtx(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    var event: CreatorEventDefinition | null = null;

    // Two modes: full event object (admin path) OR eventId-only (creator path publishing own draft)
    if (data.event) {
      event = data.event as CreatorEventDefinition;
      if (!event.id) return RpcHelpers.errorResponse("event.id required");

      var existingByObject = getEventDefinition(nk, event.id);
      if (!isAdmin) {
        if (!existingByObject) return RpcHelpers.errorResponse("Event not found — create it first via creator_event_create");
        if (existingByObject.creatorId !== userId) return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
        // Preserve creatorId and createdAt on creator self-publish
        event.creatorId = existingByObject.creatorId;
        event.createdAt = existingByObject.createdAt;
      }
    } else if (data.eventId) {
      event = getEventDefinition(nk, String(data.eventId));
      if (!event) return RpcHelpers.errorResponse("Event not found");
      if (!isAdmin && event.creatorId !== userId) {
        return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
      }
    } else {
      return RpcHelpers.errorResponse("Either event object or eventId required");
    }

    var currentStatus = event.status || "draft";
    if (currentStatus !== "funded" && currentStatus !== "draft") {
      return RpcHelpers.errorResponse("Event must be in funded or draft status to publish (currently: " + currentStatus + ")");
    }

    // Debit creator wallet when funding method is 'coins' and pool > 0
    if (event.prizeFunding && event.prizeFunding.method === "coins" && event.prizePool > 0) {
      try {
        nk.walletUpdate(userId, { xut: -event.prizePool }, { reason: "prize_pool_funded:" + event.id }, false);
        logger.info("[CreatorEvent] Debited %d XUT from creator %s for event %s prize pool", event.prizePool, userId, event.id);
        event.prizeFunding.status = "funded";
      } catch (walletErr: any) {
        return RpcHelpers.errorResponse(
          "Insufficient XUT balance to fund prize pool (" + event.prizePool + " XUT needed). " +
          "Earn or purchase more XUT, or choose a different funding method."
        );
      }
    }

    event.status = "published";
    event.publishedAt = Math.floor(Date.now() / 1000);
    event.participantCount = event.participantCount || 0;
    saveEventDefinition(nk, event);

    var index = getEventsIndex(nk);
    if (index.eventIds.indexOf(event.id) < 0) {
      index.eventIds.push(event.id);
      saveEventsIndex(nk, index);
    }

    var leaderboardId = LEADERBOARD_PREFIX + event.id;
    try {
      // Pass full 6-arg signature (id, authoritative, sort, operator, resetSchedule, metadata)
      // to match the working legacy/leaderboards.ts pattern. The shorter 4-arg form has been
      // observed to silently no-op in our cluster, leaving rpcSubmit/rpcEnd unable to
      // read scores → claim flow blocked.
      nk.leaderboardCreate(
        leaderboardId,
        true,
        nkruntime.SortOrder.DESCENDING,
        nkruntime.Operator.BEST,
        "",
        { scope: "creator_event", eventId: event.id, title: event.title }
      );
      logger.info("[CreatorEvent] Leaderboard created: %s", leaderboardId);
    } catch (err: any) {
      // "already exists" is fine; anything else needs visibility.
      var msg = (err && err.message) ? err.message : String(err);
      if (/exist/i.test(msg)) {
        logger.info("[CreatorEvent] Leaderboard already exists: %s", leaderboardId);
      } else {
        logger.error("[CreatorEvent] leaderboardCreate FAILED for %s: %s", leaderboardId, msg);
      }
    }

    try {
      HiroCreatorEventRewards.createBucketForEvent(nk, logger, event.id, event.prizes, event.prizePool);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Failed to create reward bucket: %s", err.message || String(err));
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_PUBLISHED, {
      eventId: event.id,
      creatorId: event.creatorId,
      title: event.title,
      description: event.description,
      category: event.category,
      gameMode: event.gameMode,
      region: event.region,
      scheduledAt: event.scheduledAt,
      duration: event.duration,
      prizePool: event.prizePool,
      giftCardPrizes: event.giftCardPrizes || null,
      deepLinkUrl: event.deepLinkUrl || "",
      publishedAt: event.publishedAt,
      idempotencyKey: "event_published_" + event.id,
    });

    broadcastEventPublishedNotification(nk, logger, event);

    logger.info("[CreatorEvent] Published event %s by %s: %s", event.id, event.creatorId, event.title);

    return RpcHelpers.successResponse({
      success: true,
      eventId: event.id,
      leaderboardId: leaderboardId,
      status: event.status,
    });
  }

  function rpcUpdatePromo(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    // Allow server-to-server calls (no userId) as trusted admin — this RPC is
    // commonly invoked by Content Factory when a promo/recap video is published.
    var userId = ctx.userId || "";
    var isServerCall = !userId;
    var isAdmin = isServerCall || isAdminCtx(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, String(data.eventId));
    if (!def) return RpcHelpers.errorResponse("Event not found");
    if (!isAdmin && def.creatorId !== userId) {
      return RpcHelpers.errorResponse("Not authorized");
    }

    if (typeof data.promoVideoUrl === "string") def.promoVideoUrl = data.promoVideoUrl;
    if (typeof data.recapVideoUrl === "string") def.recapVideoUrl = data.recapVideoUrl;
    if (typeof data.deepLinkUrl === "string") def.deepLinkUrl = data.deepLinkUrl;

    saveEventDefinition(nk, def);
    logger.info("[CreatorEvent] Updated media URLs for event %s", def.id);

    return RpcHelpers.successResponse({
      success: true,
      eventId: def.id,
      promoVideoUrl: def.promoVideoUrl || "",
      recapVideoUrl: def.recapVideoUrl || "",
      deepLinkUrl: def.deepLinkUrl || "",
    });
  }

  function rpcEnd(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var isAdmin = isAdminCtx(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");
    if (!isAdmin && def.creatorId !== userId) {
      return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
    }

    if (def.status === "ended" || def.status === "distributed" || def.status === "cancelled") {
      return RpcHelpers.errorResponse("Event already ended/cancelled");
    }

    var leaderboardId = LEADERBOARD_PREFIX + data.eventId;
    var allRecords: any[] = [];
    var cursor = "";

    do {
      try {
        var result = nk.leaderboardRecordsList(leaderboardId, [], 100, cursor);
        var records = result.records || [];
        for (var ri = 0; ri < records.length; ri++) {
          allRecords.push(records[ri]);
        }
        cursor = result.nextCursor || "";
      } catch (err: any) {
        logger.error("[CreatorEvent] Failed to read leaderboard: %s", err.message || String(err));
        break;
      }
    } while (cursor);

    var sortedPrizes: CreatorEventPrizeTier[] = [];
    var winnersPerTier: { [tier: string]: number } = {};

    for (var to = 0; to < TIER_ORDER.length; to++) {
      for (var pi = 0; pi < def.prizes.length; pi++) {
        if (def.prizes[pi].tier === TIER_ORDER[to]) {
          sortedPrizes.push(def.prizes[pi]);
          winnersPerTier[def.prizes[pi].tier] = 0;
        }
      }
    }

    var tierAssignments: { [userId: string]: string } = {};

    for (var ri = 0; ri < allRecords.length; ri++) {
      var record = allRecords[ri];
      var currentRank = ri + 1;
      var assignedTier = "";

      for (var si = 0; si < sortedPrizes.length; si++) {
        var prize = sortedPrizes[si];
        if (winnersPerTier[prize.tier] < prize.maxWinners) {
          assignedTier = prize.tier;
          winnersPerTier[prize.tier]++;
          break;
        }
      }

      if (assignedTier) {
        tierAssignments[record.ownerId] = assignedTier;
      }

      try {
        var userStates = getUserStates(nk, record.ownerId);
        if (userStates[data.eventId]) {
          userStates[data.eventId].tierEarned = assignedTier || undefined;
          userStates[data.eventId].rank = currentRank;
          saveUserStates(nk, record.ownerId, userStates);
        }
      } catch (err: any) {
        logger.warn("[CreatorEvent] Failed to update user state for %s: %s", record.ownerId, err.message || String(err));
      }
    }

    def.status = "ended";
    def.endedAt = Math.floor(Date.now() / 1000);
    saveEventDefinition(nk, def);

    logger.info("[CreatorEvent] Ended event %s — %d participants, %d tier assignments",
      def.id, allRecords.length, Object.keys(tierAssignments).length);

    // Resolve usernames for winner + runners-up so downstream recap pipelines
    // (n8n → Content Factory event-recap) can produce a real highlight video
    // without having to do their own lookup.
    var topOwnerIds: string[] = [];
    for (var oi = 0; oi < allRecords.length && oi < 4; oi++) {
      topOwnerIds.push(allRecords[oi].ownerId);
    }
    var idToUsername: { [uid: string]: string } = {};
    if (topOwnerIds.length > 0) {
      try {
        var accts = nk.accountsGetId(topOwnerIds);
        for (var ai = 0; ai < accts.length; ai++) {
          var u: any = accts[ai].user;
          if (u && u.id) idToUsername[u.id] = u.username || "";
        }
      } catch (err: any) {
        logger.warn("[CreatorEvent] Failed to resolve usernames for recap: %s", err.message || String(err));
      }
    }
    function rankInfo(rec: any, rank: number) {
      return {
        userId: rec.ownerId,
        username: idToUsername[rec.ownerId] || "",
        rank: rank,
        score: rec.score || 0,
      };
    }
    var winner = allRecords.length > 0 ? rankInfo(allRecords[0], 1) : null;
    var runnersUp: any[] = [];
    for (var ri2 = 1; ri2 < allRecords.length && ri2 < 4; ri2++) {
      runnersUp.push(rankInfo(allRecords[ri2], ri2 + 1));
    }

    // Next upcoming event lookup — lets the recap pipeline generate a
    // "next event Thursday 8PM IST" CTA instead of a hard-coded "tomorrow".
    // Scan the events index for the nearest scheduledAt > now, preferring
    // same-region first so regional recaps promote their own region's next.
    var nextEvent: any = null;
    try {
      var nowTs = Math.floor(Date.now() / 1000);
      var idx = getEventsIndex(nk);
      var bestSame: any = null;
      var bestAny: any = null;
      for (var ei = 0; ei < idx.eventIds.length; ei++) {
        var eid = idx.eventIds[ei];
        if (eid === def.id) continue;
        var other = getEventDefinition(nk, eid);
        if (!other) continue;
        if (other.status === "cancelled" || other.status === "ended" || other.status === "distributed") continue;
        if (!other.scheduledAt || other.scheduledAt <= nowTs) continue;
        var candidate = {
          eventId: other.id,
          title: other.title,
          category: other.category,
          region: other.region,
          scheduledAt: other.scheduledAt,
          duration: other.duration,
        };
        if (other.region === def.region) {
          if (!bestSame || other.scheduledAt < bestSame.scheduledAt) bestSame = candidate;
        } else {
          if (!bestAny || other.scheduledAt < bestAny.scheduledAt) bestAny = candidate;
        }
      }
      nextEvent = bestSame || bestAny;
    } catch (err: any) {
      logger.warn("[CreatorEvent] next-event lookup failed: %s", err.message || String(err));
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_ENDED, {
      eventId: def.id,
      creatorId: def.creatorId,
      title: def.title,
      description: def.description,
      category: def.category,
      gameMode: def.gameMode,
      region: def.region,
      totalParticipants: allRecords.length,
      tierAssignments: tierAssignments,
      winnersPerTier: winnersPerTier,
      winner: winner,
      runnersUp: runnersUp,
      answer: def.answer || "",
      prizePool: def.prizePool,
      giftCardPrizes: def.giftCardPrizes || null,
      endedAt: def.endedAt,
      nextEvent: nextEvent,
      idempotencyKey: "event_ended_" + def.id,
    });

    return RpcHelpers.successResponse({
      success: true,
      eventId: def.id,
      totalParticipants: allRecords.length,
      tierAssignments: tierAssignments,
      winnersPerTier: winnersPerTier,
    });
  }

  /**
   * Cancel a draft or published event BEFORE it starts running.
   *
   * Emits EVENT_CANCELLED so the n8n takedown workflow can unpublish any
   * already-scheduled promo posts on YouTube/TikTok/Instagram (via Postiz).
   *
   * Only draft | funded | published events can be cancelled. Events that
   * have already ended or been distributed are terminal.
   */
  function rpcCancel(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var isAdmin = isAdminCtx(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);

    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var def = getEventDefinition(nk, String(data.eventId));
    if (!def) return RpcHelpers.errorResponse("Event not found");

    if (!isAdmin && def.creatorId !== userId) {
      return RpcHelpers.errorResponse("Not authorized — must be event creator or admin");
    }

    var current = def.status || "draft";
    if (current !== "draft" && current !== "funded" && current !== "published") {
      return RpcHelpers.errorResponse("Event cannot be cancelled once it's " + current);
    }

    def.status = "cancelled";
    var now = Math.floor(Date.now() / 1000);
    (def as any).cancelledAt = now;
    (def as any).cancelReason = data.reason ? String(data.reason) : "";
    saveEventDefinition(nk, def);

    logger.info("[CreatorEvent] Cancelled by %s: %s (%s) — reason=%s",
      userId, def.title, def.id, (def as any).cancelReason || "(none)");

    // Fan out to n8n → Postiz takedown + Content Factory registry cleanup.
    EventBus.emit(nk, logger, ctx, EventBus.Events.EVENT_CANCELLED, {
      eventId: def.id,
      creatorId: def.creatorId,
      title: def.title,
      description: def.description,
      category: def.category,
      region: def.region,
      scheduledAt: def.scheduledAt,
      cancelledAt: now,
      cancelledBy: userId,
      reason: (def as any).cancelReason || "",
      // Carry the prior idempotency keys so downstream can identify the
      // exact promo tasks to tear down.
      priorPromoIdempotencyKeys: [
        "event_created_" + def.id,
        "event_published_" + def.id,
      ],
      idempotencyKey: "event_cancelled_" + def.id,
    });

    return RpcHelpers.successResponse({
      success: true,
      eventId: def.id,
      status: "cancelled",
    });
  }

  function beforeStorageWrite(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, writes: nkruntime.StorageWriteRequest[]): nkruntime.StorageWriteRequest[] {
    if (!writes || writes.length === 0) return writes;

    for (var i = 0; i < writes.length; i++) {
      var w = writes[i];
      if (w && w.collection === "event_answers") {
        logger.warn("[CreatorEvent] Blocked client storage write to event_answers user=%s key=%s", ctx.userId || "", w.key || "");
        throw new Error("event_answers is server-authoritative; use creator_event_submit.");
      }
    }

    return writes;
  }

  export function register(initializer: nkruntime.Initializer): void {
    var runtimeInitializer = initializer as any;
    if (runtimeInitializer && typeof runtimeInitializer.registerBeforeStorageWrite === "function") {
      runtimeInitializer.registerBeforeStorageWrite(beforeStorageWrite);
    }
    initializer.registerRpc("creator_event_list", rpcList);
    initializer.registerRpc("creator_event_get", rpcGet);
    initializer.registerRpc("creator_event_clock", rpcServerClock);
    initializer.registerRpc("creator_event_join", rpcJoin);
    initializer.registerRpc("creator_event_can_play", rpcCanPlay);
    initializer.registerRpc("creator_event_submit", rpcSubmit);
    initializer.registerRpc("creator_event_leaderboard", rpcLeaderboard);
    initializer.registerRpc("creator_event_results", rpcResults);
    initializer.registerRpc("creator_event_claim", rpcClaim);
    initializer.registerRpc("creator_event_create", rpcCreate);
    initializer.registerRpc("creator_event_publish", rpcPublish);
    initializer.registerRpc("creator_event_end", rpcEnd);
    initializer.registerRpc("creator_event_cancel", rpcCancel);
    initializer.registerRpc("creator_event_update_promo", rpcUpdatePromo);
    initializer.registerRpc("creator_event_fund_pool", rpcFundPool);
    initializer.registerRpc("creator_event_spa_claim", rpcSpaClaim);
    initializer.registerRpc("creator_event_fulfillments_list", rpcFulfillmentsList);
    initializer.registerRpc("creator_event_fulfillment_settle", rpcFulfillmentSettle);
  }

  /**
   * Lightweight, idempotent prize-pool funding RPC.
   *
   * Used by the SPA's hybrid publish flow: SPA writes the event to Storage
   * directly (existing UX preserved), then immediately calls this RPC to
   * debit the creator's XUT wallet for the chosen prizePool amount.
   *
   * Idempotency: a `funded_pools` record per (eventId, creatorId) prevents
   * double-debit if the SPA retries.
   *
   * Payload: { eventId, prizePool, method }   // method must be "coins"
   * Returns: { success, debited, balanceAfter? }
   */
  function rpcFundPool(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");
    var amount = Math.floor(Number(data.prizePool || 0));
    if (amount <= 0) return RpcHelpers.successResponse({ success: true, debited: 0, skipped: "non-positive amount" });
    var method = String(data.method || "coins");
    if (method !== "coins") return RpcHelpers.successResponse({ success: true, debited: 0, skipped: "non-coins method" });

    // Idempotency check
    var fundedKey = "funded_" + data.eventId;
    var prior = Storage.readJson<{ amount: number; ts: number }>(nk, COLLECTION, fundedKey, userId);
    if (prior && prior.amount > 0) {
      return RpcHelpers.successResponse({ success: true, debited: 0, alreadyFunded: prior.amount });
    }

    try {
      var result = nk.walletUpdate(userId, { xut: -amount }, { reason: "prize_pool_funded:" + data.eventId }, false);
      Storage.writeJson(nk, COLLECTION, fundedKey, userId, { amount: amount, ts: Math.floor(Date.now() / 1000) });
      var balAfter = (result && (result as any).updated && (result as any).updated.xut) || 0;
      logger.info("[CreatorEvent] Funded prize pool: user=%s event=%s amount=%d balanceAfter=%d", userId, data.eventId, amount, balAfter);
      return RpcHelpers.successResponse({
        success: true,
        debited: amount,
        balanceAfter: balAfter,
        eventId: data.eventId,
      });
    } catch (err: any) {
      return RpcHelpers.errorResponse(
        "Insufficient XUT balance to fund prize pool (" + amount + " XUT needed). " +
        "Earn more XUT or pick a different funding method."
      );
    }
  }

  // ============================================================
  //  SPA-AWARE CLAIM RPC
  // ============================================================
  //
  //  Background:
  //    The QuizVerse Live SPA (live.quizverse.world) writes events to a
  //    *user-scoped* storage layout (collections: live_events,
  //    event_participants, event_answers) and runs all gameplay
  //    client-side via a "hybrid router". This means rpcPublish /
  //    rpcJoin / rpcSubmit / rpcEnd never run for SPA-published events,
  //    so the system-scoped satori_creator_events world stays empty and
  //    rpcClaim above always returns "Event not found".
  //
  //  This RPC plugs that gap:
  //    1. Reads the event from `live_events` (creator-owned).
  //    2. Reads the player's answer from `event_answers`.
  //    3. Lists canonical `event_answers` rows (key === eventId) and ranks players.
  //    4. Picks the matching gift-card / XUT tier from
  //       `giftCardPrizes.tiers` (rank → '1st' | '2nd' | '3rd' |
  //       'top_10' | 'all').
  //    5. Grants XUT directly via nk.walletUpdate when the tier is
  //       Nakama-fulfilled, or queues a `prize_fulfillments` record
  //       for the gift-card pipeline (gyftr / tremendous).
  //    6. Best-effort POST to quests-api SES endpoint
  //       (/api/live-events/email/prize-delivery) for inbox confirmation.
  //    7. Idempotent — a per-(event,user) `creator_event_claims`
  //       record blocks double-claim.
  //
  //  Payload:
  //    { eventId, creatorId, email?, playerName? }
  //
  //  Response:
  //    { success, eventId, rank, totalParticipants, tier?,
  //      xutGranted, giftCard?, email: { requested, sent, error?, to } }
  //
  interface SpaEventTier {
    rank: string;
    prize: string;
    brand: string;
    value: number;
    currency: string;
    fulfillment?: string;
  }

  interface SpaEventDef {
    id: string;
    creatorId: string;
    title: string;
    scheduledAt: number;
    duration: number;
    visibility?: string;
    prizeFunding?: { method?: string; amount?: number; currency?: string };
    giftCardPrizes?: { region?: string; tiers?: SpaEventTier[] };
    region?: string;
    difficulty?: string;
  }

  interface SpaEventAnswer {
    eventId: string;
    playerId?: string;
    answer: string;
    correct: boolean;
    score: number;
    speedBonus?: number;
    submitMs?: number;
    elapsedSec?: number;
  }

  function findTierForRank(tiers: SpaEventTier[] | undefined, rank: number): SpaEventTier | null {
    if (!tiers || tiers.length === 0) return null;
    var keys = tierLookupKeysForRank(rank);
    for (var ki = 0; ki < keys.length; ki++) {
      for (var i = 0; i < tiers.length; i++) {
        var t = tiers[i];
        if (t && t.rank === keys[ki]) return t;
      }
    }
    return null;
  }

  function spaGiftCardTier(rank: number): string {
    // Map server rank → quests-api SES "tier" enum (cosmetic for the email).
    if (rank === 1) return "platinum";
    if (rank === 2) return "gold";
    if (rank === 3) return "silver";
    return "bronze";
  }

  /**
   * Rank every player in an event from `event_answers` and queue a
   * `prize_fulfillments` record for each gift-card prize-tier winner — WITHOUT
   * waiting for the winner to self-claim. Used by the admin "end event" action
   * and the prize-backfill RPC so operators can fulfill ALL winners, not just
   * the ones who happened to claim.
   *
   * Safety:
   *  - Idempotent: skips any (event,user) that already has a fulfillment record
   *    (incl. ones written by the self-claim flow), so re-runs never duplicate.
   *  - XUT / Nakama-fulfilled tiers are NOT credited here — wallet grants stay
   *    with the idempotent self-claim flow to avoid double-crediting; we only
   *    count them for reporting.
   *  - Records are queued as `pending`; an operator still manually approves each
   *    one before any real gift card is minted, so a mis-rank is human-reviewable.
   */
  export function computeAndQueueWinners(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    def: any,
    eventId: string,
  ): { ranked: number; queued: number; skippedExisting: number; xutWinners: number; tiersConfigured: boolean } {
    var tiers: SpaEventTier[] | undefined =
      def && def.giftCardPrizes && def.giftCardPrizes.tiers ? def.giftCardPrizes.tiers : undefined;

    // Rank all players (score desc, submit-time asc) — mirrors the self-claim flow.
    var allAnswers: { userId: string; score: number; submitMs: number }[] = [];
    var cursor = "";
    var pages = 0;
    do {
      var page: any;
      try {
        page = nk.storageList(null, "event_answers", 100, cursor);
      } catch (lerr: any) {
        logger.warn("[computeAndQueueWinners] event_answers list failed: %s", lerr.message || String(lerr));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        var v = o.value as SpaEventAnswer;
        if (!o || o.key !== eventId) continue;
        if (!v || v.eventId !== eventId) continue;
        allAnswers.push({
          userId: o.userId,
          score: typeof v.score === "number" ? v.score : 0,
          submitMs: typeof v.submitMs === "number" ? v.submitMs : 0,
        });
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < 10);

    allAnswers.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return (a.submitMs || 0) - (b.submitMs || 0);
    });

    var ranked = allAnswers.length;
    if (!tiers || tiers.length === 0) {
      return { ranked: ranked, queued: 0, skippedExisting: 0, xutWinners: 0, tiersConfigured: false };
    }

    var nowSec = Math.floor(Date.now() / 1000);
    var queued = 0;
    var skipped = 0;
    var xutWinners = 0;

    for (var r = 0; r < allAnswers.length; r++) {
      var rank = r + 1;
      var tier = findTierForRank(tiers, rank);
      if (!tier) continue;

      var winnerId = allAnswers[r].userId;
      var fKey = eventId + ":" + winnerId;

      var existing = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
      if (existing) { skipped++; continue; }

      var isXut = (tier.currency || "").toUpperCase() === "XUT" || (tier.fulfillment || "") === "nakama";
      if (isXut) {
        xutWinners++;
        continue;
      }

      Storage.writeSystemJson(nk, "prize_fulfillments", fKey, {
        userId: winnerId,
        eventId: eventId,
        rank: rank,
        giftCard: tier,
        status: "pending",
        queuedAt: nowSec,
        eventTitle: (def && def.title) || "",
        region: (def && def.region) || (def && def.giftCardPrizes && def.giftCardPrizes.region) || "global",
        source: "auto_winner",
        email: "",
      });
      queued++;
    }

    logger.info("[computeAndQueueWinners] event=%s ranked=%d queued=%d skipped=%d xut=%d",
      eventId, ranked, queued, skipped, xutWinners);
    return { ranked: ranked, queued: queued, skippedExisting: skipped, xutWinners: xutWinners, tiersConfigured: true };
  }

  function rpcSpaClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");
    if (!data.creatorId) return RpcHelpers.errorResponse("creatorId required (the event creator's userId)");

    var eventId = String(data.eventId);
    var creatorId = String(data.creatorId);

    // 1. Read event def from live_events (creator-owned)
    var defRecords = nk.storageRead([{ collection: "live_events", key: eventId, userId: creatorId }]);
    if (!defRecords || defRecords.length === 0 || !defRecords[0].value) {
      return RpcHelpers.errorResponse("Event not found in SPA storage");
    }
    var def = defRecords[0].value as SpaEventDef;

    // 2. Verify event has actually ended
    var nowSec = Math.floor(Date.now() / 1000);
    var endAt = (def.scheduledAt || 0) + (def.duration || 30) * 60;
    if (nowSec < endAt) {
      return RpcHelpers.errorResponse("Event has not ended yet");
    }

    // 3. Idempotency — already claimed?
    var claimKey = "claim_" + eventId;
    var prior = Storage.readJson<{ rank: number; tier?: string; xut: number; claimedAt: number }>(
      nk, "creator_event_claims", claimKey, userId
    );
    if (prior) {
      return RpcHelpers.errorResponse("Already claimed (rank " + prior.rank + ", " + prior.xut + " XUT, at " + prior.claimedAt + ")");
    }

    // 4. Read player's own answer
    var myRecords = nk.storageRead([{ collection: "event_answers", key: eventId, userId: userId }]);
    if (!myRecords || myRecords.length === 0 || !myRecords[0].value) {
      return RpcHelpers.errorResponse("You did not participate in this event");
    }
    var myAnswer = myRecords[0].value as SpaEventAnswer;

    // 5. List all answers across players (paginated, capped at 5 pages × 100 = 500)
    var allAnswers: { userId: string; score: number; submitMs: number }[] = [];
    var cursor = "";
    var pages = 0;
    do {
      var page: any;
      try {
        page = nk.storageList(null, "event_answers", 100, cursor);
      } catch (lerr: any) {
        logger.warn("[CreatorEvent SPA] storageList failed: %s", lerr.message || String(lerr));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        var v = o.value as SpaEventAnswer;
        if (!o || o.key !== eventId) continue;
        if (!v || v.eventId !== eventId) continue;
        allAnswers.push({
          userId: o.userId,
          score: typeof v.score === "number" ? v.score : 0,
          submitMs: typeof v.submitMs === "number" ? v.submitMs : 0,
        });
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < 5);

    // 5b. storageList can lag behind storageRead — always include caller's own answer
    var selfInList = false;
    for (var sj = 0; sj < allAnswers.length; sj++) {
      if (allAnswers[sj].userId === userId) { selfInList = true; break; }
    }
    if (!selfInList && myAnswer) {
      allAnswers.push({
        userId: userId,
        score: typeof myAnswer.score === "number" ? myAnswer.score : 0,
        submitMs: typeof myAnswer.submitMs === "number" ? myAnswer.submitMs : 0,
      });
    }

    // 5c. Premature-claim guard — the same storageList lag that 5b works
    // around for the caller ALSO hides other players' answers right after
    // the event ends. Ranking against that incomplete list hands a rank-1
    // prize to whoever claims first (real bug: player ranked #2 on the
    // final leaderboard claimed a #1-tier prize). While inside a short
    // grace window after the end, require the answer list to cover the
    // joined participant count; otherwise return the rank-sync error so
    // the client's pending-retry flow claims again once the list settles.
    var CLAIM_GRACE_SEC = 120;
    if (nowSec < endAt + CLAIM_GRACE_SEC) {
      var participantCount = 0;
      var pCursor = "";
      var pPages = 0;
      do {
        var pPage: any;
        try {
          pPage = nk.storageList(null, "event_participants", 100, pCursor);
        } catch (perr: any) {
          logger.warn("[CreatorEvent SPA] participants storageList failed: %s", perr.message || String(perr));
          break;
        }
        var pObjs = (pPage && pPage.objects) || [];
        for (var pi = 0; pi < pObjs.length; pi++) {
          if (pObjs[pi] && pObjs[pi].key === eventId) participantCount++;
        }
        pCursor = (pPage && pPage.cursor) || "";
        pPages++;
      } while (pCursor && pPages < 5);

      if (participantCount > allAnswers.length) {
        logger.info("[CreatorEvent SPA] Claim held for %s on %s: %d participants vs %d answers visible (grace window)",
          userId, eventId, participantCount, allAnswers.length);
        return RpcHelpers.errorResponse("Your score is still syncing to the final leaderboard. Your answers were received — please wait a moment and try again.");
      }
    }

    // 6. Sort: score desc, submit-time asc (ties broken by speed)
    allAnswers.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return (a.submitMs || 0) - (b.submitMs || 0);
    });

    var myRank = 0;
    for (var ri = 0; ri < allAnswers.length; ri++) {
      if (allAnswers[ri].userId === userId) { myRank = ri + 1; break; }
    }
    if (myRank === 0) {
      return RpcHelpers.errorResponse("Your score is still syncing to the final leaderboard. Your answers were received — please wait a moment and try again.");
    }

    // Parse delivery email early — the fulfillment queue record needs it so
    // the admin voucher pipeline knows where to send the gift card code.
    var deliveryEmail = "";
    if (typeof data.email === "string") {
      var em = (data.email as string).trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) deliveryEmail = em;
    }

    // 7. Pick tier + compute reward
    var tier = findTierForRank(def.giftCardPrizes && def.giftCardPrizes.tiers, myRank);
    if (def.giftCardPrizes && def.giftCardPrizes.tiers && def.giftCardPrizes.tiers.length > 0 && !tier) {
      return RpcHelpers.errorResponse("No prize for rank " + myRank + " — this event only rewards top 10");
    }
    var xutGranted = 0;
    var giftCard: SpaEventTier | null = null;

    if (tier) {
      var isXut = (tier.currency || "").toUpperCase() === "XUT" || (tier.fulfillment || "") === "nakama";
      if (isXut) {
        xutGranted = Math.max(0, Math.floor(tier.value || 0));
        if (xutGranted > 0) {
          try {
            nk.walletUpdate(userId, { xut: xutGranted }, {
              reason: "spa_event_prize:" + eventId,
              tier: tier.rank,
              rank: myRank,
            }, true);
            logger.info("[CreatorEvent SPA] Granted %d XUT to %s for event %s rank=%d", xutGranted, userId, eventId, myRank);
          } catch (werr: any) {
            logger.error("[CreatorEvent SPA] walletUpdate FAILED for %s: %s", userId, werr.message || String(werr));
            xutGranted = 0;
          }
        }
      } else {
        giftCard = tier;
        // Queue fulfillment for n8n / admin pipeline
        try {
          Storage.writeSystemJson(nk, "prize_fulfillments", eventId + ":" + userId, {
            userId: userId,
            eventId: eventId,
            rank: myRank,
            giftCard: tier,
            status: "pending",
            queuedAt: nowSec,
            eventTitle: def.title || "",
            region: def.region || (def.giftCardPrizes && def.giftCardPrizes.region) || "global",
            source: "spa_claim",
            email: deliveryEmail || "",
          });
          logger.info("[CreatorEvent SPA] Gift card queued: user=%s event=%s tier=%s prize=%s",
            userId, eventId, tier.rank, tier.prize);
        } catch (ferr: any) {
          logger.warn("[CreatorEvent SPA] failed to queue fulfillment: %s", ferr.message || String(ferr));
        }
      }
    }

    // 8. Mark claimed (idempotent)
    try {
      Storage.writeJson(nk, "creator_event_claims", claimKey, userId, {
        rank: myRank,
        tier: tier ? tier.rank : "",
        xut: xutGranted,
        giftCard: giftCard ? { brand: giftCard.brand, value: giftCard.value, currency: giftCard.currency } : null,
        claimedAt: nowSec,
      });
    } catch (cerr: any) {
      logger.warn("[CreatorEvent SPA] failed to write claim record: %s", cerr.message || String(cerr));
    }

    // 9. Best-effort SES email (deliveryEmail parsed above, before step 7)
    var deliveryName = "";
    if (typeof data.playerName === "string") {
      deliveryName = (data.playerName as string).trim().slice(0, 120);
    }

    var emailRequested = !!deliveryEmail;
    var emailSent = false;
    var emailError = "";
    var hasRealPrize = (xutGranted > 0) || !!giftCard;

    if (emailRequested && hasRealPrize) {
      try {
        var apiBase = (ctx.env && ctx.env["QUESTS_API_BASE_URL"])
          || (ctx.env && ctx.env["LIVE_EVENTS_API_BASE_URL"])
          || "https://quests.intelli-verse-x.ai";
        var sharedSecret = (ctx.env && ctx.env["LIVE_EVENTS_INTERNAL_SECRET"]) || "";
        if (!sharedSecret) {
          emailError = "LIVE_EVENTS_INTERNAL_SECRET not configured";
          logger.warn("[CreatorEvent SPA] %s", emailError);
        } else {
          var emailPrize: any = {
            type: giftCard && xutGranted > 0 ? "mixed"
              : giftCard ? "giftcard"
              : "xut",
          };
          if (xutGranted > 0) emailPrize.xutAmount = xutGranted;
          if (giftCard) {
            // Approximate USD value — INR /83, USD as-is, XUT skipped (already in xutAmount).
            var usdValue = (giftCard.currency || "").toUpperCase() === "USD"
              ? giftCard.value
              : Math.max(1, Math.round((giftCard.value || 0) / 83));
            emailPrize.giftCard = {
              tier: spaGiftCardTier(myRank),
              vendor: giftCard.brand || "amazon",
              valueUsd: usdValue,
              currency: giftCard.currency || "USD",
            };
          }

          var emailUrl = String(apiBase).replace(/\/+$/, "") + "/api/live-events/email/prize-delivery";
          var emailPayload = {
            to: deliveryEmail,
            playerName: deliveryName || "",
            eventTitle: def.title || "Live Event",
            eventId: eventId,
            rank: myRank,
            prize: emailPrize,
          };
          var headers: { [k: string]: string } = {
            "Content-Type": "application/json",
            "x-internal-secret": sharedSecret,
          };
          var resp: any = nk.httpRequest(emailUrl, "post", headers, JSON.stringify(emailPayload), 8000);
          if (resp && resp.code >= 200 && resp.code < 300) {
            emailSent = true;
            logger.info("[CreatorEvent SPA] Prize email sent: user=%s event=%s to=%s", userId, eventId, deliveryEmail);
          } else {
            emailError = "HTTP " + (resp ? resp.code : "?") + " " + (resp ? (resp.body || "").slice(0, 200) : "");
            logger.warn("[CreatorEvent SPA] Prize email failed: %s", emailError);
          }
        }
      } catch (eerr: any) {
        emailError = (eerr && eerr.message) ? eerr.message : String(eerr);
        logger.warn("[CreatorEvent SPA] Prize email exception: %s", emailError);
      }
    }

    return RpcHelpers.successResponse({
      success: true,
      eventId: eventId,
      rank: myRank,
      totalParticipants: allAnswers.length,
      tier: tier ? tier.rank : "",
      xutGranted: xutGranted,
      giftCard: giftCard ? {
        prize: giftCard.prize,
        brand: giftCard.brand,
        value: giftCard.value,
        currency: giftCard.currency,
        fulfillment: giftCard.fulfillment || "manual",
        status: "pending",
      } : null,
      email: emailRequested
        ? { requested: true, sent: emailSent, error: emailError || undefined, to: deliveryEmail }
        : { requested: false, sent: false },
    });
  }

  // ────────────────────────────────────────────────────────────────────
  //  Prize fulfillment pipeline (admin / service-to-service)
  //
  //  The claim RPCs above queue gift-card wins into the system-owned
  //  `prize_fulfillments` collection with status "pending". These two
  //  RPCs let the QuizVerse web admin dashboard (Next.js) consume that
  //  queue and settle each record after a real voucher is issued via
  //  Reloadly:
  //
  //    creator_event_fulfillments_list   → list queue (filter by status)
  //    creator_event_fulfillment_settle  → mark fulfilled/failed + mirror
  //                                        voucher status onto the player's
  //                                        claim record for the SPA UI
  //
  //  Both are gated by NAKAMA_WEBHOOK_SECRET (already in RUNTIME_ENV_KEYS)
  //  passed as payload.service_token — same pattern as brain_coins settle.
  // ────────────────────────────────────────────────────────────────────

  function isFulfillServiceCaller(ctx: nkruntime.Context, data: any): boolean {
    var token = data && data.service_token;
    if (!token) return false;
    var expected = "" + ((ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "");
    return expected.length > 0 && token === expected;
  }

  function rpcFulfillmentsList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isFulfillServiceCaller(ctx, data)) {
      return RpcHelpers.errorResponse("Unauthorized — valid service_token required");
    }
    var statusFilter = typeof data.status === "string" ? String(data.status) : "";
    var limit = Math.min(100, Math.max(1, Number(data.limit) || 100));
    var cursor = (typeof data.cursor === "string" && data.cursor) ? String(data.cursor) : undefined;

    var res = nk.storageList(Constants.SYSTEM_USER_ID, "prize_fulfillments", limit, cursor);
    var rows: any[] = [];
    var objs = (res && res.objects) || [];
    for (var i = 0; i < objs.length; i++) {
      var v: any = objs[i].value || {};
      if (statusFilter && v.status !== statusFilter) continue;
      rows.push({
        key: objs[i].key,
        userId: v.userId || "",
        eventId: v.eventId || "",
        eventTitle: v.eventTitle || "",
        rank: v.rank || 0,
        giftCard: v.giftCard || null,
        status: v.status || "pending",
        region: v.region || "",
        email: v.email || "",
        source: v.source || "",
        queuedAt: v.queuedAt || v.claimedAt || 0,
        settledAt: v.settledAt || 0,
        voucher: v.voucher || null,
        error: v.error || "",
      });
    }
    return RpcHelpers.successResponse({
      fulfillments: rows,
      cursor: (res && res.cursor) || "",
    });
  }

  function rpcFulfillmentSettle(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isFulfillServiceCaller(ctx, data)) {
      return RpcHelpers.errorResponse("Unauthorized — valid service_token required");
    }
    if (!data.eventId || !data.userId) {
      return RpcHelpers.errorResponse("eventId and userId required");
    }
    var status = data.status === "fulfilled" ? "fulfilled" : (data.status === "failed" ? "failed" : "");
    if (!status) {
      return RpcHelpers.errorResponse("status must be 'fulfilled' or 'failed'");
    }

    var eventId = String(data.eventId);
    var targetUserId = String(data.userId);
    var fKey = eventId + ":" + targetUserId;
    var rec = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
    if (!rec) {
      return RpcHelpers.errorResponse("Fulfillment record not found: " + fKey);
    }

    var settledAt = Math.floor(Date.now() / 1000);
    rec.status = status;
    rec.settledAt = settledAt;
    if (status === "fulfilled") {
      // Never store the full card code server-side — it is delivered by email.
      rec.voucher = {
        provider: String(data.provider || "reloadly"),
        orderId: String(data.orderId || ""),
        deliveredTo: String(data.deliveredTo || rec.email || ""),
        cardLast4: String(data.cardLast4 || ""),
        codeDelivered: !!data.codeDelivered,
      };
      rec.error = "";
    } else {
      rec.error = String(data.error || "fulfillment failed");
    }
    Storage.writeSystemJson(nk, "prize_fulfillments", fKey, rec);
    logger.info("[CreatorEvent] Fulfillment settled: key=%s status=%s order=%s",
      fKey, status, (rec.voucher && rec.voucher.orderId) || "-");

    // Mirror onto the player's claim record so the SPA "My Prizes" card can
    // show "Voucher sent" without another server round-trip.
    try {
      var claimKey = "claim_" + eventId;
      var claim = Storage.readJson<any>(nk, "creator_event_claims", claimKey, targetUserId);
      if (claim) {
        claim.voucher = {
          status: status,
          provider: (rec.voucher && rec.voucher.provider) || "reloadly",
          deliveredTo: (rec.voucher && rec.voucher.deliveredTo) || "",
          settledAt: settledAt,
        };
        Storage.writeJson(nk, "creator_event_claims", claimKey, targetUserId, claim);
      }
    } catch (merr: any) {
      logger.warn("[CreatorEvent] Failed to mirror voucher onto claim record: %s", merr.message || String(merr));
    }

    return RpcHelpers.successResponse({
      success: true,
      key: fKey,
      status: status,
      settledAt: settledAt,
    });
  }
}
