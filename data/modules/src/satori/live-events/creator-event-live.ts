namespace SatoriCreatorEvents {

  // ---- Types ----

  interface CreatorEventQuestion {
    id: string;
    text: string;
    options?: string[];
    correctAnswer: string;
    timeLimit: number;
    points: number;
  }

  interface CreatorEventPrizeTier {
    tier: string;
    percentage: number;
    maxWinners: number;
    nftBadgeId?: string;
  }

  interface GiftCardTier {
    rank: string;       // "1st", "2nd", "3rd", "top_10", "all"
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

  interface CreatorEventDefinition {
    id: string;
    creatorId: string;
    title: string;
    description: string;
    category: string;
    customTopic?: string;
    gameMode: string;
    scheduledAt: number;
    duration: number;
    region: string;
    timezone: string;
    entryFee: number;
    prizePool: number;
    prizes: CreatorEventPrizeTier[];
    giftCardPrizes?: GiftCardPrizes;
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

    var now = Math.floor(Date.now() / 1000);
    var endAt = def.scheduledAt + (def.duration * 60);

    if (now < def.scheduledAt) return "published";
    if (now > endAt) return "ended";
    return "live";
  }

  // ---- RPCs ----

  function rpcList(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    var filterStatus = data.status || null;

    var index = getEventsIndex(nk);
    var userStates = getUserStates(nk, userId);

    var result: any[] = [];
    for (var i = 0; i < index.eventIds.length; i++) {
      var eventId = index.eventIds[i];
      var def = getEventDefinition(nk, eventId);
      if (!def) continue;

      var status = computeEffectiveStatus(def);
      if (filterStatus && status !== filterStatus) continue;
      if (status === "draft" || status === "funded") continue;

      var userState = userStates[eventId];
      var endAt = def.scheduledAt + (def.duration * 60);

      result.push({
        id: def.id,
        creatorId: def.creatorId,
        title: def.title,
        description: def.description,
        category: def.category,
        customTopic: def.customTopic || "",
        gameMode: def.gameMode,
        scheduledAt: def.scheduledAt,
        duration: def.duration,
        endAt: endAt,
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
      });
    }

    return RpcHelpers.successResponse({ events: result });
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

  function rpcSubmit(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    var userId = RpcHelpers.requireUserId(ctx);
    var data = RpcHelpers.parseRpcPayload(payload);
    if (!data.eventId) return RpcHelpers.errorResponse("eventId required");
    if (data.answer === undefined || data.answer === null) return RpcHelpers.errorResponse("answer required");

    var def = getEventDefinition(nk, data.eventId);
    if (!def) return RpcHelpers.errorResponse("Event not found");

    var status = computeEffectiveStatus(def);
    if (status !== "live") return RpcHelpers.errorResponse("Event is not live");

    var userStates = getUserStates(nk, userId);
    var state = userStates[data.eventId];
    if (!state || !state.joinedAt) return RpcHelpers.errorResponse("Not joined");
    if (state.eliminated) return RpcHelpers.errorResponse("Eliminated from event");

    var now = Math.floor(Date.now() / 1000);
    var leaderboardId = LEADERBOARD_PREFIX + data.eventId;

    // ---- Best Guess mode ----
    if (def.gameMode === "best_guess") {
      var userAnswer = data.answer.toString().toLowerCase().trim();
      var correctAnswer = (def.answer || "").toLowerCase().trim();
      var isCorrect = userAnswer === correctAnswer;

      var elapsedSec = now - def.scheduledAt;
      var maxDuration = def.duration * 60;
      var timeBonus = isCorrect ? Math.max(0, Math.floor(((maxDuration - elapsedSec) / maxDuration) * 1000)) : 0;
      var points = isCorrect ? 1000 + timeBonus : 0;

      state.score = points;
      state.answers.push({
        questionId: "best_guess",
        answer: data.answer.toString(),
        correct: isCorrect,
        answeredAt: now,
        points: points,
      });
      saveUserStates(nk, userId, userStates);

      try {
        nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", points, 0);
      } catch (err: any) {
        logger.warn("[CreatorEvent] Leaderboard write failed: %s", err.message || String(err));
      }

      return RpcHelpers.successResponse({
        correct: isCorrect,
        score: points,
        timeBonus: timeBonus,
      });
    }

    // ---- Speed Quiz / Elimination mode ----
    if (!data.questionId) return RpcHelpers.errorResponse("questionId required");

    var question: CreatorEventQuestion | null = null;
    for (var qi = 0; qi < def.questions.length; qi++) {
      if (def.questions[qi].id === data.questionId) {
        question = def.questions[qi];
        break;
      }
    }
    if (!question) return RpcHelpers.errorResponse("Question not found");

    for (var ai = 0; ai < state.answers.length; ai++) {
      if (state.answers[ai].questionId === data.questionId) {
        return RpcHelpers.errorResponse("Question already answered");
      }
    }

    var isCorrect = data.answer.toString().toLowerCase().trim() === question.correctAnswer.toLowerCase().trim();
    var points = isCorrect ? question.points : 0;

    if (isCorrect && typeof data.timeElapsed === "number") {
      var speedBonus = Math.max(0, Math.floor(((question.timeLimit - data.timeElapsed) / question.timeLimit) * (question.points * 0.5)));
      points += speedBonus;
    }

    if (def.gameMode === "elimination" && !isCorrect) {
      state.eliminated = true;
    }

    state.score += points;
    state.currentQuestion++;
    state.answers.push({
      questionId: data.questionId,
      answer: data.answer.toString(),
      correct: isCorrect,
      answeredAt: now,
      points: points,
    });
    saveUserStates(nk, userId, userStates);

    try {
      nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", state.score, 0);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Leaderboard write failed: %s", err.message || String(err));
    }

    EventBus.emit(nk, logger, ctx, EventBus.Events.SCORE_SUBMITTED, {
      userId: userId,
      eventId: data.eventId,
      score: state.score,
      questionId: data.questionId,
    });

    return RpcHelpers.successResponse({
      correct: isCorrect,
      points: points,
      totalScore: state.score,
      eliminated: state.eliminated || false,
      questionsAnswered: state.answers.length,
      totalQuestions: def.questions.length,
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

    if (tierReward) {
      grantedReward = RewardEngine.resolveReward(nk, tierReward);
      RewardEngine.grantReward(nk, logger, ctx, userId, gameId, grantedReward);
    }

    state.claimedAt = Math.floor(Date.now() / 1000);
    saveUserStates(nk, userId, userStates);

    EventBus.emit(nk, logger, ctx, EventBus.Events.REWARD_GRANTED, {
      userId: userId,
      eventId: data.eventId,
      tier: state.tierEarned,
      reward: grantedReward,
    });

    return RpcHelpers.successResponse({
      success: true,
      eventId: data.eventId,
      tier: state.tierEarned,
      reward: grantedReward,
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
      nk.leaderboardCreate(leaderboardId, true, nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST);
    } catch (err: any) {
      logger.warn("[CreatorEvent] Leaderboard may already exist: %s", err.message || String(err));
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

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("creator_event_list", rpcList);
    initializer.registerRpc("creator_event_join", rpcJoin);
    initializer.registerRpc("creator_event_submit", rpcSubmit);
    initializer.registerRpc("creator_event_leaderboard", rpcLeaderboard);
    initializer.registerRpc("creator_event_results", rpcResults);
    initializer.registerRpc("creator_event_claim", rpcClaim);
    initializer.registerRpc("creator_event_create", rpcCreate);
    initializer.registerRpc("creator_event_publish", rpcPublish);
    initializer.registerRpc("creator_event_end", rpcEnd);
    initializer.registerRpc("creator_event_cancel", rpcCancel);
    initializer.registerRpc("creator_event_update_promo", rpcUpdatePromo);
  }
}
