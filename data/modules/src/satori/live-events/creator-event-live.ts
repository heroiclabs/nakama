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

  /** Convert a stored difficulty string into a server-trusted speed-bonus multiplier.
   *  This is the single source of truth — clients can't influence the multiplier
   *  because the value comes from the event definition, not the request payload. */
  function difficultySpeedMultiplier(diff: string | undefined | null): number {
    var d = (diff || "challenge").toString().toLowerCase().trim();
    if (d === "casual" || d === "easy") return 1.0;
    if (d === "expert" || d === "hard" || d === "pro") return 2.0;
    return 1.5; // challenge / default
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

    var speedMult = difficultySpeedMultiplier(def.difficulty);

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
      var rawTimeBonus = isCorrect ? Math.max(0, Math.floor(((maxDuration - elapsedSec) / maxDuration) * 1000)) : 0;
      var timeBonus = Math.floor(rawTimeBonus * speedMult);
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
        difficulty: def.difficulty || "challenge",
        speedMultiplier: speedMult,
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

    var appliedSpeedBonus = 0;
    if (isCorrect && typeof data.timeElapsed === "number") {
      var rawSpeedBonus = Math.max(0, Math.floor(((question.timeLimit - data.timeElapsed) / question.timeLimit) * (question.points * 0.5)));
      appliedSpeedBonus = Math.floor(rawSpeedBonus * speedMult);
      points += appliedSpeedBonus;
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
      speedBonus: appliedSpeedBonus,
      totalScore: state.score,
      eliminated: state.eliminated || false,
      questionsAnswered: state.answers.length,
      totalQuestions: def.questions.length,
      difficulty: def.difficulty || "challenge",
      speedMultiplier: speedMult,
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
      var rankStr = state.rank === 1 ? "1st"
        : state.rank === 2 ? "2nd"
        : state.rank === 3 ? "3rd"
        : (state.rank || 99) <= 10 ? "top_10"
        : "all";
      for (var gti = 0; gti < def.giftCardPrizes.tiers.length; gti++) {
        if (def.giftCardPrizes.tiers[gti].rank === rankStr) {
          giftCardTier = def.giftCardPrizes.tiers[gti];
          break;
        }
      }
      if (!giftCardTier) {
        for (var gti2 = 0; gti2 < def.giftCardPrizes.tiers.length; gti2++) {
          if (def.giftCardPrizes.tiers[gti2].rank === "all") {
            giftCardTier = def.giftCardPrizes.tiers[gti2];
            break;
          }
        }
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
    initializer.registerRpc("creator_event_fund_pool", rpcFundPool);
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
}
