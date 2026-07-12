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
    /** AI-expanded synonym list (publish time). Grading checks any entry. */
    acceptedAnswers?: string[];
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
    else if (rank === 6) keys.push("6th", "6_10");
    else if (rank === 7) keys.push("7th", "6_10");
    else if (rank === 8) keys.push("8th", "6_10");
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
    /** Best Guess: AI-expanded synonym list (publish time). */
    acceptedAnswers?: string[];
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
    abandonedAt?: number;
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

  /** Fuzzy normalizer — keep in sync with SPA `_qvNormAnswer()` in quizverse-live-events.html */
  function normalizeAnswer(value: any): string {
    return String(value === undefined || value === null ? "" : value)
      .toLowerCase()
      .replace(/^ans\s*[:\.]\s*/i, "")
      .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\b(the|a|an)\b/g, " ")
      .replace(/s\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Numeric equality only when both sides are pure numbers (matches SPA `_qvStrictNumber`). */
  function strictNumber(value: any): number | null {
    var raw = String(value === undefined || value === null ? "" : value).trim().replace(/,/g, "").replace(/\s+/g, "");
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(raw)) return null;
    var n = Number(raw);
    return isFinite(n) ? n : null;
  }

  function answersMatch(given: any, expected: any): boolean {
    var u = normalizeAnswer(given);
    var e = normalizeAnswer(expected);
    if (!u || !e) return false;
    if (u === e) return true;
    var uNum = strictNumber(given);
    var eNum = strictNumber(expected);
    if (uNum !== null && eNum !== null && uNum === eNum) return true;
    return false;
  }

  function questionAcceptedAnswers(q: any): string[] {
    var primary = questionAnswer(q);
    var list: string[] = [];
    if (q && Array.isArray(q.acceptedAnswers)) {
      for (var i = 0; i < q.acceptedAnswers.length; i++) {
        var item = String(q.acceptedAnswers[i] || "").trim();
        if (item) list.push(item);
      }
    }
    if (list.length === 0) {
      if (primary) list.push(primary);
      return list;
    }
    if (primary) {
      var hasPrimary = false;
      for (var j = 0; j < list.length; j++) {
        if (answersMatch(list[j], primary)) {
          hasPrimary = true;
          break;
        }
      }
      if (!hasPrimary) list.unshift(primary);
    }
    return list;
  }

  function eventAcceptedAnswers(def: CreatorEventDefinition): string[] {
    var primary = String(def.answer || "");
    var list: string[] = [];
    var raw = def.acceptedAnswers;
    if (Array.isArray(raw)) {
      for (var i = 0; i < raw.length; i++) {
        var item = String(raw[i] || "").trim();
        if (item) list.push(item);
      }
    }
    if (list.length === 0) {
      if (primary) list.push(primary);
      return list;
    }
    if (primary) {
      var hasPrimary = false;
      for (var j = 0; j < list.length; j++) {
        if (answersMatch(list[j], primary)) {
          hasPrimary = true;
          break;
        }
      }
      if (!hasPrimary) list.unshift(primary);
    }
    return list;
  }

  function answersMatchAny(given: any, acceptedList: string[]): boolean {
    for (var i = 0; i < acceptedList.length; i++) {
      if (answersMatch(given, acceptedList[i])) return true;
    }
    return false;
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

  interface LiveEventStorageRecord {
    def: CreatorEventDefinition;
    creatorId: string;
    version: string;
  }

  function findLiveEventStorageRecord(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventId: string, creatorId?: string): LiveEventStorageRecord | null {
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
          return {
            def: records[0].value as CreatorEventDefinition,
            creatorId: owner,
            version: records[0].version || "",
          };
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
            var objOwner = (obj.userId || (obj as any).user_id || "").toString();
            return {
              def: obj.value as CreatorEventDefinition,
              creatorId: objOwner,
              version: obj.version || "",
            };
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

  function findLiveEventDefinition(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventId: string, creatorId?: string): CreatorEventDefinition | null {
    var located = findLiveEventStorageRecord(nk, logger, eventId, creatorId);
    return located ? located.def : null;
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
    var acceptedList = eventAcceptedAnswers(def);
    var correct = answersMatchAny(answer, acceptedList);
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

  function questionElapsedMs(provided: any, perQuestionSec: number): number | null {
    if (!provided || typeof provided !== "object") return null;
    var raw = (provided as any).elapsedMs;
    if (raw === undefined || raw === null) raw = (provided as any).elapsed_ms;
    if (raw === undefined || raw === null) raw = (provided as any).answerMs;
    var n = Number(raw);
    if (!isFinite(n) || n < 0) return null;
    var capMs = Math.max(1, perQuestionSec * 1000);
    return Math.min(capMs, Math.floor(n));
  }

  function perQuestionSpeedBonus(correct: boolean, elapsedMs: number | null, perQuestionSec: number, maxSpeedBonus: number): number {
    if (!correct || elapsedMs === null) return 0;
    var capMs = Math.max(1, perQuestionSec * 1000);
    var ratio = Math.max(0, Math.min(1, (capMs - elapsedMs) / capMs));
    return Math.floor(maxSpeedBonus * ratio);
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

    for (var i = 0; i < questions.length; i++) {
      var question = questions[i] as any;
      var provided = submitted.length > 0 ? submittedByIndex[i] : splitAnswers[i];
      var given = "";

      if (provided !== undefined && provided !== null && typeof provided === "object") {
        given = String((provided as any).given || (provided as any).answer || "");
      } else {
        given = String(provided || "").trim();
      }

      var acceptedList = questionAcceptedAnswers(question);
      var correct = answersMatchAny(given, acceptedList);
      var baseScore = correct ? Math.floor(numericValue(question.points, 100)) : 0;
      var questionMs = questionElapsedMs(provided, perQuestionSec);
      var appliedSpeedBonus = perQuestionSpeedBonus(correct, questionMs, perQuestionSec, maxSpeedBonus);

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

  function rpcAbandon(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var eventId = String(data.eventId);
    var existing = readCompletedAnswer(nk, eventId, userId);
    if (existing) {
      if (existing.abandoned === true) {
        return RpcHelpers.successResponse({ success: true, eventId: eventId, abandoned: true });
      }
      return RpcHelpers.errorResponse("You have already finished this event.");
    }

    var userStates = getUserStates(nk, userId);
    if (!userStates[eventId] || !userStates[eventId].joinedAt) {
      return RpcHelpers.errorResponse("You have not joined this event.");
    }

    var nowMs = Date.now();
    var answerRecord: any = {
      eventId: eventId,
      playerId: userId,
      deviceId: data.deviceId || data.device_id || "",
      playerName: String(data.playerName || data.displayName || data.player_name || ctx.username || "").trim(),
      answer: "",
      correct: false,
      score: 0,
      speedBonus: 0,
      submitMs: nowMs,
      elapsedSec: 0,
      answered: false,
      abandoned: true,
      correctCount: 0,
      totalQuestions: 0,
      qAnswers: [],
      source: "creator_event_abandon_rpc",
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
      logger.warn("[CreatorEvent] Abandon write failed for user=%s event=%s: %s", userId, eventId, writeErr.message || String(writeErr));
      return RpcHelpers.errorResponse("Could not record event exit.");
    }

    writeSpaAnswerIndexEntry(nk, logger, eventId, userId, 0, nowMs);

    userStates[eventId].abandonedAt = Math.floor(nowMs / 1000);
    saveUserStates(nk, userId, userStates);

    return RpcHelpers.successResponse({ success: true, eventId: eventId, abandoned: true });
  }

  function rpcCanPlay(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var eventId = String(data.eventId);
    var completedAnswer = readCompletedAnswer(nk, eventId, userId);
    if (completedAnswer) {
      var abandoned = completedAnswer.abandoned === true;
      return RpcHelpers.successResponse({
        success: true,
        eventId: eventId,
        canPlay: false,
        played: abandoned ? 0 : 1,
        completed: !abandoned,
        submitted: !abandoned,
        abandoned: abandoned,
        reason: abandoned
          ? "You left this event and cannot play again."
          : "You have already completed this event.",
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

    writeSpaAnswerIndexEntry(nk, logger, eventId, userId, scoreResult.score, nowMs);

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
    // Allow server-to-server calls (Content Factory / n8n via http_key) — same
    // pattern as rpcUpdatePromo. Unauthenticated calls without admin key are rejected.
    var userId = ctx.userId || "";
    var isServerCall = !userId;
    if (isServerCall && !isAdminCtx(ctx, nk)) {
      return RpcHelpers.errorResponse("AUTH_REQUIRED: sign in or use admin http_key");
    }
    if (isServerCall) {
      userId = Constants.SYSTEM_USER_ID;
    }
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
        userId: "00000000-0000-0000-0000-000000000000",
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
    // Allow server-to-server calls (Content Factory bootstrap / n8n via http_key).
    var userId = ctx.userId || "";
    var isServerCall = !userId;
    if (isServerCall && !isAdminCtx(ctx, nk)) {
      return RpcHelpers.errorResponse("AUTH_REQUIRED: sign in or use admin http_key");
    }
    var isAdmin = isServerCall || isAdminCtx(ctx, nk);
    if (isServerCall) {
      userId = Constants.SYSTEM_USER_ID;
    }
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

  interface FinalizeEndResult {
    totalParticipants: number;
    tierAssignments: { [userId: string]: string };
    winnersPerTier: { [tier: string]: number };
    prizeQueue: any;
  }

  /**
   * Shared end-of-event finalization: reads the event leaderboard, assigns
   * prize tiers by rank, persists status="ended", emits EVENT_ENDED (recap
   * pipeline trigger via SatoriWebhooks → n8n) and auto-queues gift-card
   * prize fulfillments.
   *
   * Called by rpcEnd (manual creator/admin end) and rpcAutoEndSweep
   * (zero-touch Path A auto-end). Caller must have already authorized and
   * verified the event is not already ended/cancelled.
   */
  function finalizeEndedEvent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, def: CreatorEventDefinition, endedBy: string): FinalizeEndResult {
    var leaderboardId = LEADERBOARD_PREFIX + def.id;
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
        if (userStates[def.id]) {
          userStates[def.id].tierEarned = assignedTier || undefined;
          userStates[def.id].rank = currentRank;
          saveUserStates(nk, record.ownerId, userStates);
        }
      } catch (err: any) {
        logger.warn("[CreatorEvent] Failed to update user state for %s: %s", record.ownerId, err.message || String(err));
      }
    }

    def.status = "ended";
    def.endedAt = Math.floor(Date.now() / 1000);
    saveEventDefinition(nk, def);

    logger.info("[CreatorEvent] Ended event %s (by %s) — %d participants, %d tier assignments",
      def.id, endedBy, allRecords.length, Object.keys(tierAssignments).length);

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
      endedBy: endedBy,
      nextEvent: nextEvent,
      idempotencyKey: "event_ended_" + def.id,
    });

    var prizeQueueResult: { ranked: number; queued: number; skippedExisting: number; xutWinners: number; xutCredited: number; tiersConfigured: boolean } | null = null;
    try {
      prizeQueueResult = computeAndQueueWinners(nk, logger, def, def.id);
      if (prizeQueueResult.queued > 0) {
        logger.info("[CreatorEvent] Auto-queued %d prize fulfillments for event %s (ranked=%d xut=%d skipped=%d)",
          prizeQueueResult.queued, def.id, prizeQueueResult.ranked, prizeQueueResult.xutWinners, prizeQueueResult.skippedExisting);
      }
    } catch (pqErr: any) {
      logger.warn("[CreatorEvent] Prize auto-queue failed for event %s (non-fatal): %s", def.id, pqErr.message || String(pqErr));
    }

    return {
      totalParticipants: allRecords.length,
      tierAssignments: tierAssignments,
      winnersPerTier: winnersPerTier,
      prizeQueue: prizeQueueResult || undefined,
    };
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

    var endResult = finalizeEndedEvent(ctx, logger, nk, def, userId);

    return RpcHelpers.successResponse({
      success: true,
      eventId: def.id,
      totalParticipants: endResult.totalParticipants,
      tierAssignments: endResult.tierAssignments,
      winnersPerTier: endResult.winnersPerTier,
      prizeQueue: endResult.prizeQueue,
    });
  }

  /**
   * creator_event_auto_end_sweep — system/admin only (n8n every-minute cron
   * primary + k8s CronJob fallback).
   *
   * Path A zero-touch lifecycle: finds published events whose
   * scheduledAt + duration has elapsed and finalizes them exactly like a
   * manual creator_event_end — tier assignment, EVENT_ENDED webhook (recap
   * pipeline), prize fulfillment queue. The EVENT_ENDED idempotencyKey
   * ("event_ended_<id>") keeps downstream recap generation deduped even if a
   * manual end races the sweep.
   *
   * Payload: { graceSec?: number, limit?: number }
   *   graceSec — extra seconds past endAt before auto-ending (default 0)
   *   limit    — max events finalized per sweep (default 25)
   */
  function rpcAutoEndSweep(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var graceSec = typeof data.graceSec === "number" ? Math.max(0, Math.floor(data.graceSec)) : 0;
    var limit = typeof data.limit === "number" ? Math.max(1, Math.floor(data.limit)) : 25;

    var now = serverNowSec();
    var index = getEventsIndex(nk);
    var scanned = 0;
    var ended: any[] = [];
    var failed: any[] = [];

    for (var i = 0; i < index.eventIds.length; i++) {
      if (ended.length >= limit) break;
      var eventId = index.eventIds[i];
      var def = getEventDefinition(nk, eventId);
      if (!def) continue;
      scanned++;

      // Only persisted-"published" events run and auto-end. Draft/funded never
      // started; ended/distributed/cancelled are terminal.
      if ((def.status || "draft") !== "published") continue;

      var endAt = (def.scheduledAt || 0) + Math.floor((def.duration || 30) * 60);
      if (!def.scheduledAt || now <= endAt + graceSec) continue;

      try {
        var res = finalizeEndedEvent(ctx, logger, nk, def, "auto_end_sweep");
        ended.push({
          eventId: def.id,
          title: def.title,
          region: def.region,
          totalParticipants: res.totalParticipants,
        });
      } catch (err: any) {
        var msg = (err && err.message) ? err.message : String(err);
        logger.error("[CreatorEvent] auto-end failed for event %s: %s", eventId, msg);
        failed.push({ eventId: eventId, error: msg });
      }
    }

    if (ended.length > 0) {
      logger.info("[CreatorEvent] Auto-end sweep finalized %d event(s): %s",
        ended.length, JSON.stringify(ended));
    }

    return RpcHelpers.successResponse({
      now: now,
      scanned: scanned,
      endedCount: ended.length,
      ended: ended,
      failed: failed,
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
    initializer.registerRpc("creator_event_abandon", rpcAbandon);
    initializer.registerRpc("creator_event_can_play", rpcCanPlay);
    initializer.registerRpc("creator_event_submit", rpcSubmit);
    initializer.registerRpc("creator_event_leaderboard", rpcLeaderboard);
    initializer.registerRpc("creator_event_results", rpcResults);
    initializer.registerRpc("creator_event_claim", rpcClaim);
    initializer.registerRpc("creator_event_create", rpcCreate);
    initializer.registerRpc("creator_event_publish", rpcPublish);
    initializer.registerRpc("creator_event_end", rpcEnd);
    initializer.registerRpc("creator_event_auto_end_sweep", rpcAutoEndSweep);
    initializer.registerRpc("creator_event_cancel", rpcCancel);
    initializer.registerRpc("creator_event_update_promo", rpcUpdatePromo);
    initializer.registerRpc("creator_event_fund_pool", rpcFundPool);
    initializer.registerRpc("creator_event_spa_claim", rpcSpaClaim);
    initializer.registerRpc("creator_event_spa_join", rpcSpaJoin);
    initializer.registerRpc("creator_event_spa_save_delivery", rpcSpaSaveDelivery);
    initializer.registerRpc("creator_event_spa_end_queue", rpcSpaEndQueue);
    initializer.registerRpc("creator_event_spa_auto_end_sweep", rpcSpaAutoEndSweep);
    initializer.registerRpc("creator_event_fulfillments_list", rpcFulfillmentsList);
    initializer.registerRpc("creator_event_fulfillment_get", rpcFulfillmentGet);
    initializer.registerRpc("creator_event_fulfillment_settle", rpcFulfillmentSettle);
    initializer.registerRpc("quizverse_prize_catalog_get", rpcPrizeCatalogGet);
    initializer.registerRpc("admin_prize_catalog_set", rpcAdminPrizeCatalogSet);
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
  //    5. XUT/coin tiers are auto-credited at event end (computeAndQueueWinners).
  //       Claim reads the audit record; retries only if auto-credit failed.
  //    6. Gift-card tiers queue a `prize_fulfillments` record for admin approval.
  //    7. Best-effort POST to quests-api SES endpoint
  //       (/api/live-events/email/prize-delivery) for inbox confirmation.
  //    8. Idempotent — a per-(event,user) `creator_event_claims`
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

  interface SpaRankingRow {
    userId: string;
    score: number;
    submitMs: number;
  }

  interface SpaEventRankingResult {
    rankings: SpaRankingRow[];
    answerCount: number;
    participantCount: number;
    backfilledCount: number;
  }

  var SPA_PARTICIPANTS_COLLECTION = "event_participants";
  var SPA_ANSWERS_COLLECTION = "event_answers";
  var SPA_ANSWER_INDEX_COLLECTION = "event_answer_index";
  var SPA_ANSWER_SCAN_MAX_PAGES = 10;
  var SPA_PARTICIPANT_SCAN_MAX_PAGES = 50;

  function spaAnswerIndexKey(eventId: string, userId: string): string {
    return eventId + ":" + userId;
  }

  function writeSpaAnswerIndexEntry(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    userId: string,
    score: number,
    submitMs: number,
  ): void {
    try {
      Storage.writeSystemJson(nk, SPA_ANSWER_INDEX_COLLECTION, spaAnswerIndexKey(eventId, userId), {
        userId: userId,
        eventId: eventId,
        score: score,
        submitMs: submitMs,
      });
    } catch (idxErr: any) {
      logger.warn("[CreatorEvent SPA] answer index write failed event=%s user=%s: %s",
        eventId, userId, idxErr.message || String(idxErr));
    }
  }

  function readSpaAnswerIndexEntry(
    nk: nkruntime.Nakama,
    eventId: string,
    userId: string,
  ): SpaRankingRow | null {
    var iv = Storage.readSystemJson<{ userId?: string; score?: number; submitMs?: number }>(
      nk, SPA_ANSWER_INDEX_COLLECTION, spaAnswerIndexKey(eventId, userId)
    );
    if (!iv || !iv.userId) return null;
    return {
      userId: iv.userId,
      score: typeof iv.score === "number" ? iv.score : 0,
      submitMs: typeof iv.submitMs === "number" ? iv.submitMs : 0,
    };
  }

  function answerRowFromStorageValue(uid: string, v: SpaEventAnswer | null): SpaRankingRow | null {
    if (!v || !uid) return null;
    return {
      userId: uid,
      score: typeof v.score === "number" ? v.score : 0,
      submitMs: typeof v.submitMs === "number" ? v.submitMs : 0,
    };
  }

  function mergeRankingRow(
    byUser: { [uid: string]: SpaRankingRow },
    row: SpaRankingRow | null,
  ): boolean {
    if (!row || !row.userId) return false;
    var existing = byUser[row.userId];
    if (!existing || row.score > existing.score ||
        (row.score === existing.score && row.submitMs < (existing.submitMs || 0))) {
      byUser[row.userId] = row;
      return true;
    }
    return false;
  }

  /** Legacy global scan — fallback for events created before the answer index existed. */
  function collectSpaAnswersLegacyScan(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    byUser: { [uid: string]: SpaRankingRow },
  ): number {
    var answerCount = 0;
    var cursor = "";
    var pages = 0;

    do {
      var page: any;
      try {
        page = nk.storageList(null, SPA_ANSWERS_COLLECTION, 100, cursor);
      } catch (lerr: any) {
        logger.warn("[collectSpaAnswersLegacyScan] event_answers list failed: %s", lerr.message || String(lerr));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        var v = o.value as SpaEventAnswer;
        if (!o || o.key !== eventId) continue;
        if (!v || v.eventId !== eventId) continue;
        answerCount++;
        var uid = o.userId;
        if (!uid) continue;
        mergeRankingRow(byUser, answerRowFromStorageValue(uid, v));
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < SPA_ANSWER_SCAN_MAX_PAGES);

    return answerCount;
  }

  /**
   * O(participants) targeted reads: index entry per player, then direct
   * event_answers read as fallback. Avoids scanning the global collection.
   */
  function collectSpaAnswersTargeted(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    participantUserIds: string[],
    byUser: { [uid: string]: SpaRankingRow },
  ): number {
    var answerCount = 0;
    var seen: { [uid: string]: boolean } = {};

    for (var pi = 0; pi < participantUserIds.length; pi++) {
      var uid = participantUserIds[pi];
      if (!uid || seen[uid]) continue;
      seen[uid] = true;

      var indexed = readSpaAnswerIndexEntry(nk, eventId, uid);
      if (indexed) {
        if (mergeRankingRow(byUser, indexed)) answerCount++;
        continue;
      }

      var direct = readCompletedAnswer(nk, eventId, uid) as SpaEventAnswer | null;
      var row = answerRowFromStorageValue(uid, direct);
      if (row && mergeRankingRow(byUser, row)) answerCount++;
    }

    return answerCount;
  }

  /** List joined players for one SPA event (key === eventId in event_participants). */
  function listSpaEventParticipants(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    maxPages: number
  ): { userId: string; joinedAtSec: number; playerEmail: string }[] {
    var participants: { userId: string; joinedAtSec: number; playerEmail: string }[] = [];
    var seen: { [uid: string]: boolean } = {};
    var cursor = "";
    var pages = 0;

    do {
      var page: any;
      try {
        page = nk.storageList(null, SPA_PARTICIPANTS_COLLECTION, 100, cursor);
      } catch (err: any) {
        logger.warn("[CreatorEvent SPA] participants storageList failed: %s", err.message || String(err));
        break;
      }
      var objs = (page && page.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        if (!o || o.key !== eventId) continue;
        var uid = o.userId;
        if (!uid || seen[uid]) continue;
        seen[uid] = true;
        var joinedAtSec = 0;
        var playerEmail = "";
        var pv = o.value as any;
        if (pv && typeof pv.joinedAt === "number") joinedAtSec = pv.joinedAt;
        if (pv) {
          var emRaw = pv.playerEmail || pv.email || "";
          if (typeof emRaw === "string") {
            var emTrim = emRaw.trim();
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emTrim)) playerEmail = emTrim;
          }
        }
        participants.push({ userId: uid, joinedAtSec: joinedAtSec, playerEmail: playerEmail });
      }
      cursor = (page && page.cursor) || "";
      pages++;
    } while (cursor && pages < maxPages);

    return participants;
  }

  /**
   * Canonical SPA ranking: event_answers for this event, plus event_participants
   * who never submitted (score 0, tie-break by joinedAt). Shared by prize
   * auto-queue and spa_claim so ranks stay consistent.
   */
  function collectSpaEventRankings(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    opts?: { ensureUserId?: string; ensureAnswer?: SpaEventAnswer | null }
  ): SpaEventRankingResult {
    var byUser: { [uid: string]: SpaRankingRow } = {};
    var participants = listSpaEventParticipants(nk, logger, eventId, SPA_PARTICIPANT_SCAN_MAX_PAGES);
    var participantUserIds: string[] = [];
    for (var pIdx = 0; pIdx < participants.length; pIdx++) {
      if (participants[pIdx].userId) participantUserIds.push(participants[pIdx].userId);
    }

    var answerCount = collectSpaAnswersTargeted(nk, logger, eventId, participantUserIds, byUser);

    var ensureUid = opts && opts.ensureUserId;
    var ensureAnswer = opts && opts.ensureAnswer;
    if (ensureUid && ensureAnswer) {
      if (mergeRankingRow(byUser, answerRowFromStorageValue(ensureUid, ensureAnswer))) {
        answerCount++;
      }
    } else if (ensureUid && !byUser[ensureUid]) {
      var ensuredIndexed = readSpaAnswerIndexEntry(nk, eventId, ensureUid);
      if (ensuredIndexed && mergeRankingRow(byUser, ensuredIndexed)) {
        answerCount++;
      } else {
        var ensuredDirect = readCompletedAnswer(nk, eventId, ensureUid) as SpaEventAnswer | null;
        if (mergeRankingRow(byUser, answerRowFromStorageValue(ensureUid, ensuredDirect))) {
          answerCount++;
        }
      }
    }

    if (answerCount === 0) {
      answerCount = collectSpaAnswersLegacyScan(nk, logger, eventId, byUser);
      if (answerCount > 0) {
        logger.info("[collectSpaEventRankings] event=%s used legacy global answer scan (%d rows)", eventId, answerCount);
      }
    }

    var backfilledCount = 0;
    for (var pi = 0; pi < participants.length; pi++) {
      var p = participants[pi];
      if (!p.userId || byUser[p.userId]) continue;
      backfilledCount++;
      var joinMs = p.joinedAtSec > 0 ? p.joinedAtSec * 1000 : 2147483647000;
      byUser[p.userId] = { userId: p.userId, score: 0, submitMs: joinMs };
    }

    var rankings: SpaRankingRow[] = [];
    for (var uidKey in byUser) {
      if (byUser.hasOwnProperty(uidKey)) rankings.push(byUser[uidKey]);
    }
    rankings.sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return (a.submitMs || 0) - (b.submitMs || 0);
    });

    if (backfilledCount > 0 || answerCount > 0) {
      logger.info("[collectSpaEventRankings] event=%s answers=%d participants=%d backfilled=%d ranked=%d",
        eventId, answerCount, participants.length, backfilledCount, rankings.length);
    }

    return {
      rankings: rankings,
      answerCount: answerCount,
      participantCount: participants.length,
      backfilledCount: backfilledCount,
    };
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

  function isXutFulfillmentTier(tier: SpaEventTier | null): boolean {
    if (!tier) return false;
    return (tier.currency || "").toUpperCase() === "XUT" || (tier.fulfillment || "") === "nakama";
  }

  function spaEventCoinAmountForRank(tier: SpaEventTier | null, rank: number): number {
    if (!isXutFulfillmentTier(tier)) return 0;
    // Explicit admin-catalog bonus tiers (6th/7th/8th) use their configured
    // value so admins can change bonus amounts; fall back to 75/50/25 if unset.
    if (tier && (tier.rank === "6th" || tier.rank === "7th" || tier.rank === "8th")) {
      var bonus = Math.max(0, Math.floor(tier.value || 0));
      if (bonus > 0) return bonus;
    }
    if (rank === 6) return 75;
    if (rank === 7) return 50;
    if (rank === 8) return 25;
    if (rank === 9 || rank === 10) return 0;
    return Math.max(0, Math.floor((tier && tier.value) || 0));
  }

  function creditSpaEventCoinPrize(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    winnerId: string,
    amount: number,
    eventId: string,
    rank: number,
    gameId: string,
  ): { credited: number; balanceAfter: number; error: string } {
    var amt = Math.max(0, Math.floor(amount || 0));
    if (amt <= 0) return { credited: 0, balanceAfter: 0, error: "" };
    var gid = gameId || Constants.DEFAULT_GAME_ID;
    try {
      // Credit the GAME wallet (currency "game", mirrored to "tokens") — this is
      // the balance QuizVerse shows the player as coins. Mirrors the Unity
      // client wallet_update_game_wallet { currency:"game", operation:"add" } path
      // so live-event coin prizes land in the same wallet players spend from.
      var wallet = WalletHelpers.getGameWallet(nk, winnerId, gid);
      if (wallet.currencies.game === undefined) wallet.currencies.game = 0;
      if (wallet.currencies.tokens === undefined) wallet.currencies.tokens = 0;
      wallet.currencies.game += amt;
      wallet.currencies.tokens += amt;
      WalletHelpers.saveGameWallet(nk, wallet);
      var newBalance = wallet.currencies.game;
      logger.info("[CreatorEvent SPA] Auto-credited %d game coins to %s for event %s rank=%d balanceAfter=%d",
        amt, winnerId, eventId, rank, newBalance);
      return { credited: amt, balanceAfter: newBalance, error: "" };
    } catch (e: any) {
      var em = (e && e.message) ? e.message : String(e);
      logger.error("[CreatorEvent SPA] Auto-credit FAILED for %s event %s rank=%d: %s",
        winnerId, eventId, rank, em);
      return { credited: 0, balanceAfter: 0, error: em || "wallet credit failed" };
    }
  }

  function spaGiftCardTier(rank: number): string {
    // Map server rank → quests-api SES "tier" enum (cosmetic for the email).
    if (rank === 1) return "platinum";
    if (rank === 2) return "gold";
    if (rank === 3) return "silver";
    return "bronze";
  }

  var SPA_DELIVERY_COLLECTION = "creator_event_delivery";

  function parseDeliveryEmailFromPayload(data: any): string {
    if (typeof data.email !== "string") return "";
    var em = (data.email as string).trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return em;
    return "";
  }

  function readDeliveryPref(
    nk: nkruntime.Nakama,
    userId: string,
    eventId: string,
  ): { email: string; playerName: string } | null {
    var pref = Storage.readJson<{ email?: string; playerName?: string }>(
      nk, SPA_DELIVERY_COLLECTION, eventId, userId
    );
    if (!pref || typeof pref.email !== "string") return null;
    var em = pref.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return null;
    return {
      email: em,
      playerName: typeof pref.playerName === "string" ? pref.playerName.trim().slice(0, 120) : "",
    };
  }

  function applyFulfillmentEmailPatch(existing: any, email: string): boolean {
    if (!existing || !email) return false;
    if (existing.email && String(existing.email).trim()) return false;
    var originalQueuedAt = existing.queuedAt;
    existing.email = email;
    existing.emailPatchedAt = Math.floor(Date.now() / 1000);
    if (originalQueuedAt !== undefined && originalQueuedAt !== null) {
      existing.queuedAt = originalQueuedAt;
    }
    return true;
  }

  function patchFulfillmentEmailIfEmpty(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    userId: string,
    email: string,
  ): void {
    if (!email) return;
    var fKey = eventId + ":" + userId;
    var existing = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
    if (!existing) return;
    if (!applyFulfillmentEmailPatch(existing, email)) return;
    Storage.writeSystemJson(nk, "prize_fulfillments", fKey, existing);
    logger.info("[CreatorEvent SPA] Patched fulfillment email: event=%s user=%s", eventId, userId);
  }

  function fulfillmentStorageCreateTimeSec(storageObj: any): number {
    if (!storageObj) return 0;
    var ct = Number(storageObj.createTime || 0);
    return ct > 0 ? ct : 0;
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
   *  - XUT / Nakama-fulfilled tiers are credited here at event end via the global
   *    wallet (same storage path as wallet_update_game_wallet). An audit row is
   *    written to prize_fulfillments with source auto_winner_xut.
   *  - Records are queued as `pending`; an operator still manually approves each
   *    one before any real gift card is minted, so a mis-rank is human-reviewable.
   */
  export function computeAndQueueWinners(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    def: any,
    eventId: string,
  ): { ranked: number; queued: number; skippedExisting: number; xutWinners: number; xutCredited: number; tiersConfigured: boolean } {
    var tiers: SpaEventTier[] | undefined =
      def && def.giftCardPrizes && def.giftCardPrizes.tiers ? def.giftCardPrizes.tiers : undefined;

    var rankingResult = collectSpaEventRankings(nk, logger, eventId);
    var allAnswers = rankingResult.rankings;

    var ranked = allAnswers.length;
    if (!tiers || tiers.length === 0) {
      return { ranked: ranked, queued: 0, skippedExisting: 0, xutWinners: 0, xutCredited: 0, tiersConfigured: false };
    }

    var nowSec = Math.floor(Date.now() / 1000);
    var eventGameId = (def && def.gameId) ? String(def.gameId) : Constants.DEFAULT_GAME_ID;
    var queued = 0;
    var skipped = 0;
    var xutWinners = 0;
    var xutCredited = 0;

    // Pre-fetch emails for all ranked players in one batch call.
    var emailByUserId: { [uid: string]: string } = {};
    var allWinnerIds: string[] = [];
    for (var wi = 0; wi < allAnswers.length; wi++) {
      var wuid = allAnswers[wi].userId;
      if (wuid) allWinnerIds.push(wuid);
    }
    if (allWinnerIds.length > 0) {
      try {
        var accounts = nk.accountsGetId(allWinnerIds);
        for (var ai = 0; ai < accounts.length; ai++) {
          var acct = accounts[ai];
          var uid = acct && acct.user && (acct.user as any).id;
          var email = (acct && acct.email) || "";
          if (uid) emailByUserId[uid] = email || "";
        }
      } catch (emailErr: any) {
        logger.warn("[computeAndQueueWinners] Failed to batch-fetch account emails: %s", emailErr.message || String(emailErr));
      }
    }

    // Player-submitted delivery emails (lobby / results screen) override empty
    // Nakama account emails for device-authenticated winners.
    for (var di = 0; di < allWinnerIds.length; di++) {
      var du = allWinnerIds[di];
      var savedPref = readDeliveryPref(nk, du, eventId);
      if (savedPref && savedPref.email) {
        emailByUserId[du] = savedPref.email;
      }
    }

    var joinedPlayers = listSpaEventParticipants(nk, logger, eventId, SPA_PARTICIPANT_SCAN_MAX_PAGES);
    for (var je = 0; je < joinedPlayers.length; je++) {
      var jp = joinedPlayers[je];
      if (jp.userId && jp.playerEmail && !emailByUserId[jp.userId]) {
        emailByUserId[jp.userId] = jp.playerEmail;
      }
    }

    for (var r = 0; r < allAnswers.length; r++) {
      var rank = r + 1;
      var tier = findTierForRank(tiers, rank);
      if (!tier) continue;

      var winnerId = allAnswers[r].userId;
      var fKey = eventId + ":" + winnerId;

      var existing = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
      var isXut = isXutFulfillmentTier(tier);

      if (existing) {
        var patchEmail = emailByUserId[winnerId] || "";
        if (applyFulfillmentEmailPatch(existing, patchEmail)) {
          Storage.writeSystemJson(nk, "prize_fulfillments", fKey, existing);
        }
        if (isXut) {
          xutWinners++;
          if (existing.source === "auto_winner_xut" && existing.status === "fulfilled") {
            skipped++;
            continue;
          }
          if (existing.source === "auto_winner_xut" && existing.status === "failed") {
            var retryAmt = spaEventCoinAmountForRank(tier, rank);
            var retryCredit = creditSpaEventCoinPrize(nk, logger, winnerId, retryAmt, eventId, rank, eventGameId);
            existing.status = retryCredit.credited > 0 ? "fulfilled" : "failed";
            existing.xutGranted = retryCredit.credited;
            existing.fulfilledAt = retryCredit.credited > 0 ? nowSec : existing.fulfilledAt;
            existing.walletBalanceAfter = retryCredit.balanceAfter;
            existing.walletError = retryCredit.error || "";
            Storage.writeSystemJson(nk, "prize_fulfillments", fKey, existing);
            if (retryCredit.credited > 0) xutCredited++;
            continue;
          }
        }
        skipped++;
        continue;
      }

      if (isXut) {
        xutWinners++;
        var xutAmount = spaEventCoinAmountForRank(tier, rank);
        if (xutAmount <= 0) continue;

        var credit = creditSpaEventCoinPrize(nk, logger, winnerId, xutAmount, eventId, rank, eventGameId);
        Storage.writeSystemJson(nk, "prize_fulfillments", fKey, {
          userId: winnerId,
          eventId: eventId,
          rank: rank,
          giftCard: tier,
          status: credit.credited > 0 ? "fulfilled" : "failed",
          queuedAt: nowSec,
          fulfilledAt: credit.credited > 0 ? nowSec : undefined,
          eventTitle: (def && def.title) || "",
          region: (def && def.region) || (def && def.giftCardPrizes && def.giftCardPrizes.region) || "global",
          source: "auto_winner_xut",
          email: emailByUserId[winnerId] || "",
          xutGranted: credit.credited,
          walletBalanceAfter: credit.balanceAfter,
          walletError: credit.error || "",
        });
        if (credit.credited > 0) xutCredited++;
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
        email: emailByUserId[winnerId] || "",
      });
      queued++;
    }

    logger.info("[computeAndQueueWinners] event=%s ranked=%d queued=%d skipped=%d xut=%d credited=%d",
      eventId, ranked, queued, skipped, xutWinners, xutCredited);
    return { ranked: ranked, queued: queued, skippedExisting: skipped, xutWinners: xutWinners, xutCredited: xutCredited, tiersConfigured: true };
  }

  function validateSpaJoinWindow(def: CreatorEventDefinition, nowSec: number): string {
    var status = (def.status || "published").toString().toLowerCase();
    if (status === "cancelled" || status === "draft") return "Event is not accepting participants";
    if (status === "ended" || status === "distributed") return "Event has ended";

    var startAt = Math.floor(numericValue(def.scheduledAt, 0));
    var durationMin = numericValue(def.duration, 30);
    if (startAt > 0 && durationMin > 0) {
      var endAt = startAt + Math.floor(durationMin * 60);
      if (nowSec >= endAt) return "Event has ended";
    }
    return "";
  }

  function parsePlayerEmailFromPayload(data: any): string {
    var candidates = [data.email, data.playerEmail, data.player_email];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "string") {
        var em = (candidates[i] as string).trim();
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return em;
      }
    }
    return "";
  }

  function incrementSpaParticipantCount(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    creatorId: string,
    eventId: string,
    delta: number,
  ): number {
    var attempts = 0;
    var maxAttempts = 3;
    while (attempts < maxAttempts) {
      attempts++;
      try {
        var recs = nk.storageRead([{ collection: "live_events", key: eventId, userId: creatorId }]);
        if (!recs || recs.length === 0 || !recs[0].value) return -1;
        var evDef: any = recs[0].value;
        var current = Math.max(0, Math.floor(numericValue(evDef.participantCount, 0)));
        evDef.participantCount = current + delta;
        nk.storageWrite([{
          collection: "live_events",
          key: eventId,
          userId: creatorId,
          value: evDef,
          permissionRead: 2 as nkruntime.ReadPermissionValues,
          permissionWrite: 1 as nkruntime.WritePermissionValues,
          version: recs[0].version,
        }]);
        return evDef.participantCount;
      } catch (pcErr: any) {
        if (attempts >= maxAttempts) {
          logger.warn("[CreatorEvent] participantCount increment failed for event %s: %s", eventId, pcErr.message || String(pcErr));
          return -1;
        }
      }
    }
    return -1;
  }

  /**
   * Server-authoritative SPA join: writes event_participants and increments
   * live_events.participantCount (Gap 2). The SPA hybrid router previously
   * wrote participants via client storage only, leaving participantCount at 0.
   */
  function rpcSpaJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    var eventId = String(data.eventId);
    var located = findLiveEventStorageRecord(nk, logger, eventId, data.creatorId || data.creator_id);
    if (!located || !located.creatorId) return RpcHelpers.errorResponse("Event not found");

    var def = located.def;
    var creatorId = located.creatorId;
    var nowSec = Math.floor(Date.now() / 1000);

    var windowErr = validateSpaJoinWindow(def, nowSec);
    if (windowErr) return RpcHelpers.errorResponse(windowErr);

    var existing = Storage.readJson<{ joinedAt?: number }>(nk, "event_participants", eventId, userId);
    if (existing && existing.joinedAt) {
      var existingCount = Math.max(0, Math.floor(numericValue(def.participantCount, 0)));
      return RpcHelpers.successResponse({
        success: true,
        eventId: eventId,
        joinedAt: existing.joinedAt,
        participantCount: existingCount,
        alreadyJoined: true,
      });
    }

    var playerName = "";
    if (typeof data.playerName === "string") {
      playerName = (data.playerName as string).trim().slice(0, 120);
    } else if (typeof data.displayName === "string") {
      playerName = (data.displayName as string).trim().slice(0, 120);
    }
    var playerEmail = parsePlayerEmailFromPayload(data);
    var deviceId = "";
    if (typeof data.deviceId === "string") deviceId = (data.deviceId as string).trim().slice(0, 120);
    else if (typeof data.device_id === "string") deviceId = (data.device_id as string).trim().slice(0, 120);

    var participantRecord = {
      eventId: eventId,
      playerId: userId,
      joinedAt: nowSec,
      deviceId: deviceId,
      playerName: playerName,
      playerEmail: playerEmail,
      email: playerEmail,
    };

    try {
      Storage.writeJson(nk, "event_participants", eventId, userId, participantRecord, 2 as nkruntime.ReadPermissionValues, 1 as nkruntime.WritePermissionValues);
    } catch (joinErr: any) {
      return RpcHelpers.errorResponse("Failed to join event: " + (joinErr.message || String(joinErr)));
    }

    var newCount = incrementSpaParticipantCount(nk, logger, creatorId, eventId, 1);
    if (newCount < 0) {
      newCount = Math.max(0, Math.floor(numericValue(def.participantCount, 0))) + 1;
    }

    logger.info("[CreatorEvent SPA] Joined user=%s event=%s count=%d", userId, eventId, newCount);
    return RpcHelpers.successResponse({
      success: true,
      eventId: eventId,
      joinedAt: nowSec,
      participantCount: newCount,
    });
  }

  /**
   * SPA event-end hook: rank all players and queue gift-card fulfillments
   * immediately when the creator ends an event.
   *
   * The SPA stores events in the creator-OWNED `live_events` collection and
   * ends them with a direct storage write, so the system-collection rpcEnd
   * path never runs for SPA events — historically winners were only queued
   * when a player self-claimed or an admin ran the backfill. The SPA calls
   * this right after its end-write; idempotent via computeAndQueueWinners'
   * per-(event,user) existing-row skip.
   */
  function rpcSpaEndQueue(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");

    // The caller must own the event record (i.e. be the creator).
    var recs: nkruntime.StorageObject[] = [];
    try {
      recs = nk.storageRead([{ collection: "live_events", key: data.eventId, userId: userId }]);
    } catch (rerr: any) {
      return RpcHelpers.errorResponse("Event read failed: " + (rerr.message || String(rerr)));
    }
    if (!recs || recs.length === 0 || !recs[0].value) {
      return RpcHelpers.errorResponse("Event not found or not owned by you");
    }
    var def: any = recs[0].value;
    if (!def.id) def.id = data.eventId;
    if (def.status !== "ended") {
      return RpcHelpers.errorResponse("Event is not ended yet (status: " + (def.status || "unknown") + ")");
    }

    var result = computeAndQueueWinners(nk, logger, def, data.eventId);
    logger.info("[SpaEndQueue] event=%s ranked=%d queued=%d skipped=%d xut=%d",
      data.eventId, result.ranked, result.queued, result.skippedExisting, result.xutWinners);
    return RpcHelpers.successResponse({ eventId: data.eventId, prizeQueue: result });
  }

  function spaEventStorageEndAtSec(ev: any): number {
    var scheduledAt = Math.floor(numericValue(ev && ev.scheduledAt, 0));
    var durationMin = numericValue(ev && ev.duration, 30);
    if (scheduledAt <= 0 || durationMin <= 0) return 0;
    return scheduledAt + Math.floor(durationMin * 60);
  }

  function shouldSpaAutoEnd(ev: any, nowSec: number, graceSec: number): boolean {
    if (!ev) return false;
    var status = (ev.status || "published").toString().toLowerCase();
    if (status === "ended" || status === "cancelled" || status === "draft" || status === "funded") return false;
    var endAt = spaEventStorageEndAtSec(ev);
    if (endAt <= 0) return false;
    return nowSec > endAt + graceSec;
  }

  function finalizeSpaAutoEndedEvent(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    eventId: string,
    creatorId: string,
    ev: any,
    version: string,
    endedBy: string,
  ): { ranked: number; queued: number; skippedExisting: number; xutWinners: number; xutCredited: number; tiersConfigured: boolean } {
    var nowSec = Math.floor(Date.now() / 1000);
    ev.status = "ended";
    ev.endedAt = nowSec;
    if (!ev.id) ev.id = eventId;
    nk.storageWrite([{
      collection: "live_events",
      key: eventId,
      userId: creatorId,
      value: ev,
      permissionRead: 2 as nkruntime.ReadPermissionValues,
      permissionWrite: 1 as nkruntime.WritePermissionValues,
      version: version,
    }]);
    var prizeQueue = computeAndQueueWinners(nk, logger, ev, eventId);
    logger.info("[CreatorEvent SPA] Auto-ended event=%s by=%s ranked=%d queued=%d",
      eventId, endedBy, prizeQueue.ranked, prizeQueue.queued);
    return prizeQueue;
  }

  /**
   * creator_event_spa_auto_end_sweep — system/admin only (n8n cron alongside
   * creator_event_auto_end_sweep).
   *
   * SPA events live in creator-owned `live_events` storage; the module-path
   * auto-end sweep only reads `satori_creator_events`. This sweep ends expired
   * SPA events and calls computeAndQueueWinners so prizes queue even when the
   * creator never clicks End in the web UI.
   *
   * Payload: { graceSec?: number, limit?: number }
   */
  function rpcSpaAutoEndSweep(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    var graceSec = typeof data.graceSec === "number" ? Math.max(0, Math.floor(data.graceSec)) : 0;
    var limit = typeof data.limit === "number" ? Math.max(1, Math.floor(data.limit)) : 25;

    var now = serverNowSec();
    var cursor = "";
    var pages = 0;
    var maxPages = 20;
    var scanned = 0;
    var ended: any[] = [];
    var failed: any[] = [];

    do {
      var res: any;
      try {
        res = nk.storageList(null, "live_events", 100, cursor);
      } catch (listErr: any) {
        return RpcHelpers.errorResponse("live_events list failed: " + (listErr.message || String(listErr)));
      }
      var objs = (res && res.objects) || [];
      for (var i = 0; i < objs.length; i++) {
        if (ended.length >= limit) break;
        var obj = objs[i];
        if (!obj || !obj.value) continue;
        scanned++;

        var ev: any = obj.value;
        var eventId = String(ev.id || obj.key || "");
        var creatorId = String(ev.creatorId || obj.userId || (obj as any).user_id || "");
        // The storage write MUST target the row's actual owner. Events published
        // via the admin/system path are owned by the zero UUID while ev.creatorId
        // holds the human creator — writing with creatorId + this row's version
        // fails the OCC check on every sweep (event b108b2fb…, Jul 7 2026).
        var rowOwner = String(obj.userId || (obj as any).user_id || "");
        if (!eventId || !rowOwner) continue;
        if (!shouldSpaAutoEnd(ev, now, graceSec)) continue;

        try {
          var prizeQueue = finalizeSpaAutoEndedEvent(nk, logger, eventId, rowOwner, ev, obj.version || "", "spa_auto_end_sweep");
          ended.push({
            eventId: eventId,
            title: ev.title || "",
            creatorId: creatorId,
            ranked: prizeQueue.ranked,
            queued: prizeQueue.queued,
          });
        } catch (err: any) {
          var msg = (err && err.message) ? err.message : String(err);
          logger.error("[CreatorEvent SPA] auto-end failed for event %s: %s", eventId, msg);
          try {
            var reread = nk.storageRead([{ collection: "live_events", key: eventId, userId: rowOwner }]);
            if (reread && reread.length > 0 && reread[0].value &&
              String(reread[0].value.status || "").toLowerCase() === "ended") {
              var recovered = computeAndQueueWinners(nk, logger, reread[0].value, eventId);
              ended.push({
                eventId: eventId,
                title: reread[0].value.title || "",
                creatorId: creatorId,
                ranked: recovered.ranked,
                queued: recovered.queued,
                recovered: true,
              });
              continue;
            }
          } catch (_recoverErr: any) {
            // fall through to failed
          }
          failed.push({ eventId: eventId, error: msg });
        }
      }
      cursor = (res && res.cursor) || "";
      pages++;
    } while (cursor && ended.length < limit && pages < maxPages);

    if (ended.length > 0) {
      logger.info("[CreatorEvent SPA] Auto-end sweep finalized %d event(s)", ended.length);
    }

    return RpcHelpers.successResponse({
      now: now,
      scanned: scanned,
      endedCount: ended.length,
      ended: ended,
      failed: failed,
    });
  }

  /**
   * Persist a player's prize-delivery email before the event ends.
   * The SPA results screen collects email while the quiz is still live;
   * without this, the address lived only in localStorage and was lost if
   * the player never reopened the app after the event closed.
   */
  function rpcSpaSaveDelivery(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");
    if (!data.creatorId) return RpcHelpers.errorResponse("creatorId required (the event creator's userId)");

    var eventId = String(data.eventId);
    var creatorId = String(data.creatorId);
    var deliveryEmail = parseDeliveryEmailFromPayload(data);
    if (!deliveryEmail) return RpcHelpers.errorResponse("Valid email required");

    var defRecords = nk.storageRead([{ collection: "live_events", key: eventId, userId: creatorId }]);
    if (!defRecords || defRecords.length === 0 || !defRecords[0].value) {
      return RpcHelpers.errorResponse("Event not found in SPA storage");
    }

    var joined = Storage.readJson<{ joinedAt?: number }>(nk, "event_participants", eventId, userId);
    var myRecords = nk.storageRead([{ collection: "event_answers", key: eventId, userId: userId }]);
    var hasAnswer = myRecords && myRecords.length > 0 && myRecords[0].value;
    if (!joined && !hasAnswer) {
      return RpcHelpers.errorResponse("You did not join this event");
    }

    var deliveryName = "";
    if (typeof data.playerName === "string") {
      deliveryName = (data.playerName as string).trim().slice(0, 120);
    }

    var nowSec = Math.floor(Date.now() / 1000);
    try {
      Storage.writeJson(nk, SPA_DELIVERY_COLLECTION, eventId, userId, {
        email: deliveryEmail,
        playerName: deliveryName,
        savedAt: nowSec,
        eventId: eventId,
      });
    } catch (werr: any) {
      return RpcHelpers.errorResponse("Failed to save delivery email: " + (werr.message || String(werr)));
    }

    patchFulfillmentEmailIfEmpty(nk, logger, eventId, userId, deliveryEmail);
    logger.info("[CreatorEvent SPA] Saved delivery email: user=%s event=%s", userId, eventId);

    return RpcHelpers.successResponse({
      success: true,
      eventId: eventId,
      email: deliveryEmail,
      savedAt: nowSec,
    });
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

    var rankingResult = collectSpaEventRankings(nk, logger, eventId, {
      ensureUserId: userId,
      ensureAnswer: myAnswer,
    });
    var allAnswers = rankingResult.rankings;

    // Premature-claim guard — storageList can lag right after event end.
    // After participant backfill, only hold when participant rows are still
    // not fully visible (participantCount > ranked list length).
    var CLAIM_GRACE_SEC = 120;
    if (nowSec < endAt + CLAIM_GRACE_SEC) {
      if (rankingResult.participantCount > rankingResult.answerCount &&
          rankingResult.participantCount > allAnswers.length) {
        logger.info("[CreatorEvent SPA] Claim held for %s on %s: %d participants vs %d answers visible (%d ranked, grace window)",
          userId, eventId, rankingResult.participantCount, rankingResult.answerCount, allAnswers.length);
        return RpcHelpers.errorResponse("Your score is still syncing to the final leaderboard. Your answers were received — please wait a moment and try again.");
      }
    }

    var myRank = 0;
    for (var ri = 0; ri < allAnswers.length; ri++) {
      if (allAnswers[ri].userId === userId) { myRank = ri + 1; break; }
    }
    if (myRank === 0) {
      return RpcHelpers.errorResponse("Your score is still syncing to the final leaderboard. Your answers were received — please wait a moment and try again.");
    }

    // Parse delivery email early — the fulfillment queue record needs it so
    // the admin voucher pipeline knows where to send the gift card code.
    var deliveryEmail = parseDeliveryEmailFromPayload(data);
    var deliveryName = "";
    if (typeof data.playerName === "string") {
      deliveryName = (data.playerName as string).trim().slice(0, 120);
    }
    if (!deliveryEmail) {
      var savedPref = readDeliveryPref(nk, userId, eventId);
      if (savedPref) {
        deliveryEmail = savedPref.email;
        if (!deliveryName && savedPref.playerName) deliveryName = savedPref.playerName;
      }
    }

    // 7. Pick tier + compute reward
    var tier = findTierForRank(def.giftCardPrizes && def.giftCardPrizes.tiers, myRank);
    if (def.giftCardPrizes && def.giftCardPrizes.tiers && def.giftCardPrizes.tiers.length > 0 && !tier) {
      return RpcHelpers.errorResponse("No prize for rank " + myRank + " — this event only rewards top 10");
    }
    var xutGranted = 0;
    var giftCard: SpaEventTier | null = null;

    if (tier) {
      var isXut = isXutFulfillmentTier(tier);
      if (isXut) {
        // Coin prizes (incl. rank 6-8 bonus coins) are credited to the game
        // wallet exactly ONCE, at event end, by computeAndQueueWinners — never
        // instantly on claim. The event is already ended here (guarded above),
        // so if the end sweep hasn't processed this event yet we run it now;
        // it is idempotent (per-(event,user) fulfillment row) and credits every
        // winner. Claim then just reports what was granted.
        var fKey = eventId + ":" + userId;
        var priorFulfillment = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
        if (!priorFulfillment ||
            priorFulfillment.source !== "auto_winner_xut" ||
            priorFulfillment.status !== "fulfilled") {
          if (!def.id) def.id = eventId;
          computeAndQueueWinners(nk, logger, def, eventId);
          priorFulfillment = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
        }
        if (priorFulfillment && priorFulfillment.source === "auto_winner_xut") {
          xutGranted = Math.max(0, Math.floor(priorFulfillment.xutGranted || 0));
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
  //    creator_event_fulfillment_get     → direct read by eventId + userId key
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
    var eventIdFilter = typeof data.eventId === "string" ? String(data.eventId) : (typeof data.event_id === "string" ? String(data.event_id) : "");
    var limit = Math.min(100, Math.max(1, Number(data.limit) || 100));
    var cursor = (typeof data.cursor === "string" && data.cursor) ? String(data.cursor) : undefined;

    var res = nk.storageList(Constants.SYSTEM_USER_ID, "prize_fulfillments", limit, cursor);
    var rows: any[] = [];
    var objs = (res && res.objects) || [];
    for (var i = 0; i < objs.length; i++) {
      var v: any = objs[i].value || {};
      if (statusFilter && v.status !== statusFilter) continue;
      if (eventIdFilter && String(v.eventId || "") !== eventIdFilter) continue;
      rows.push(mapFulfillmentRow(objs[i].key, v, objs[i]));
    }
    return RpcHelpers.successResponse({
      fulfillments: rows,
      cursor: (res && res.cursor) || "",
    });
  }

  function mapFulfillmentRow(key: string, v: any, storageObj?: any): any {
    var createTime = fulfillmentStorageCreateTimeSec(storageObj);
    var queuedAt = v.queuedAt || v.claimedAt || 0;
    var sortAt = createTime || queuedAt;
    return {
      key: key,
      userId: v.userId || "",
      eventId: v.eventId || "",
      eventTitle: v.eventTitle || "",
      rank: v.rank || 0,
      giftCard: v.giftCard || null,
      status: v.status || "pending",
      region: v.region || "",
      email: v.email || "",
      source: v.source || "",
      queuedAt: queuedAt,
      createTime: createTime,
      sortAt: sortAt,
      emailPatchedAt: v.emailPatchedAt || 0,
      settledAt: v.settledAt || 0,
      voucher: v.voucher || null,
      error: v.error || "",
    };
  }

  function rpcFulfillmentGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!isFulfillServiceCaller(ctx, data)) {
      return RpcHelpers.errorResponse("Unauthorized — valid service_token required");
    }
    if (!data.eventId || !data.userId) {
      return RpcHelpers.errorResponse("eventId and userId required");
    }
    var eventId = String(data.eventId);
    var targetUserId = String(data.userId);
    var fKey = eventId + ":" + targetUserId;
    var rec = Storage.readSystemJson<any>(nk, "prize_fulfillments", fKey);
    if (!rec) {
      return RpcHelpers.errorResponse("Fulfillment record not found: " + fKey);
    }
    return RpcHelpers.successResponse(mapFulfillmentRow(fKey, rec));
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

  // ────────────────────────────────────────────────────────────────────
  //  Prize Catalog — admin-managed, creator-readable
  //
  //  Stored in system-owned `prize_catalog / active`. Admin sets tiers
  //  via admin_prize_catalog_set (requireAdmin). Creators fetch the live
  //  catalog via quizverse_prize_catalog_get (public) so event creation
  //  always reflects the current admin config instead of the hardcoded
  //  GC constant in the SPA.
  // ────────────────────────────────────────────────────────────────────

  var PRIZE_CATALOG_COLLECTION = "prize_catalog";
  var PRIZE_CATALOG_KEY = "active";

  var DEFAULT_PRIZE_CATALOG = {
    version: 1,
    updatedAt: 0,
    updatedBy: "system",
    regions: {
      india: {
        region: "india",
        label: "🇮🇳 India",
        tiers: [
          { rank: "1st", prize: "Flipkart ₹100", brand: "flipkart", value: 100, currency: "INR", fulfillment: "reloadly" },
          { rank: "2nd", prize: "Flipkart ₹100", brand: "flipkart", value: 100, currency: "INR", fulfillment: "reloadly" },
          { rank: "3rd", prize: "Flipkart ₹50",  brand: "flipkart", value: 50,  currency: "INR", fulfillment: "reloadly" },
          { rank: "4th", prize: "Flipkart ₹50",  brand: "flipkart", value: 50,  currency: "INR", fulfillment: "reloadly" },
          { rank: "5th", prize: "Flipkart ₹50",  brand: "flipkart", value: 50,  currency: "INR", fulfillment: "reloadly" },
        ],
        totalValue: 400,
        totalCurrency: "INR",
      },
      usa: {
        region: "usa",
        label: "🇺🇸 USA",
        tiers: [
          { rank: "1st", prize: "Amazon US $1", brand: "amazon us", value: 1, currency: "USD", fulfillment: "reloadly" },
          { rank: "2nd", prize: "Amazon US $1", brand: "amazon us", value: 1, currency: "USD", fulfillment: "reloadly" },
          { rank: "3rd", prize: "Amazon US $1", brand: "amazon us", value: 1, currency: "USD", fulfillment: "reloadly" },
          { rank: "4th", prize: "Amazon US $1", brand: "amazon us", value: 1, currency: "USD", fulfillment: "reloadly" },
          { rank: "5th", prize: "Amazon US $1", brand: "amazon us", value: 1, currency: "USD", fulfillment: "reloadly" },
        ],
        totalValue: 5,
        totalCurrency: "USD",
      },
      xut: {
        region: "global",
        label: "🪙 Coins",
        tiers: [
          { rank: "1st",    prize: "5,000 XUT", brand: "xut", value: 5000, currency: "XUT", fulfillment: "nakama" },
          { rank: "2nd",    prize: "2,500 XUT", brand: "xut", value: 2500, currency: "XUT", fulfillment: "nakama" },
          { rank: "3rd",    prize: "1,000 XUT", brand: "xut", value: 1000, currency: "XUT", fulfillment: "nakama" },
          { rank: "top_10", prize: "500 XUT",   brand: "xut", value: 500,  currency: "XUT", fulfillment: "nakama" },
          { rank: "all",    prize: "100 XUT participation bonus", brand: "xut", value: 100, currency: "XUT", fulfillment: "nakama" },
        ],
        totalValue: 9100,
        totalCurrency: "XUT",
      },
    },
    coinBonusTiers: [
      { rank: "6th", prize: "75 bonus coins", brand: "xut", value: 75, currency: "XUT", fulfillment: "nakama" },
      { rank: "7th", prize: "50 bonus coins", brand: "xut", value: 50, currency: "XUT", fulfillment: "nakama" },
      { rank: "8th", prize: "25 bonus coins", brand: "xut", value: 25, currency: "XUT", fulfillment: "nakama" },
    ],
  };

  function rpcPrizeCatalogGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string {
    var stored = Storage.readSystemJson<any>(nk, PRIZE_CATALOG_COLLECTION, PRIZE_CATALOG_KEY);
    return RpcHelpers.successResponse(stored || DEFAULT_PRIZE_CATALOG);
  }

  function rpcAdminPrizeCatalogSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    RpcHelpers.requireAdmin(ctx, nk);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.regions || typeof data.regions !== "object") {
      return RpcHelpers.errorResponse("regions object required");
    }
    var existing = Storage.readSystemJson<any>(nk, PRIZE_CATALOG_COLLECTION, PRIZE_CATALOG_KEY) || DEFAULT_PRIZE_CATALOG;
    var catalog = {
      version: ((existing.version || 1) as number) + 1,
      updatedAt: Math.floor(Date.now() / 1000),
      updatedBy: ctx.userId || "admin",
      regions: data.regions,
      coinBonusTiers: data.coinBonusTiers || existing.coinBonusTiers || DEFAULT_PRIZE_CATALOG.coinBonusTiers,
    };
    Storage.writeSystemJson(nk, PRIZE_CATALOG_COLLECTION, PRIZE_CATALOG_KEY, catalog);
    logger.info("[PrizeCatalog] Updated by %s, version %d", ctx.userId, catalog.version);
    return RpcHelpers.successResponse({ ok: true, version: catalog.version, updatedAt: catalog.updatedAt });
  }
}
