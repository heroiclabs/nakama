// ============================================================
// Quest EventBus Bridge — Auto-progress quests from existing events
//
// This module subscribes to EventBus events (QUIZ_COMPLETED, LEVEL_UP,
// GAME_COMPLETED, etc.) that apps/games ALREADY emit, and automatically
// progresses matching quests.
//
// KEY INSIGHT: Apps don't need to call any new RPC for quest progress.
// They just send their normal analytics/gameplay events → EventBus emits
// → this bridge listens → quests progress automatically.
//
// This replaces the old approach where Unity had to call RecordEvent()
// explicitly for quest progress.
// ============================================================

namespace QuestEventBusBridge {

  // ── EventBus event name → Quest eventType mapping ─────────────────────────
  // These map the well-known EventBus events to quest step eventTypes.
  // Quest configs define steps with eventType like "quiz_completed", "level_up", etc.
  
  var EVENT_TYPE_MAP: { [eventBusEvent: string]: string } = {
    // Core gameplay events
    [EventBus.Events.QUIZ_COMPLETED]:        "quiz_completed",
    [EventBus.Events.GAME_COMPLETED]:        "game_completed",
    [EventBus.Events.GAME_STARTED]:          "game_started",
    
    // Progression events
    [EventBus.Events.LEVEL_UP]:              "level_up",
    [EventBus.Events.XP_EARNED]:             "xp_earned",
    
    // Score events
    [EventBus.Events.SCORE_SUBMITTED]:       "score_submitted",
    
    // Achievement events
    [EventBus.Events.ACHIEVEMENT_COMPLETED]: "achievement_completed",
    [EventBus.Events.ACHIEVEMENT_CLAIMED]:   "achievement_claimed",
    
    // Challenge events
    [EventBus.Events.CHALLENGE_COMPLETED]:   "challenge_completed",
    
    // Streak events
    [EventBus.Events.STREAK_UPDATED]:        "streak_updated",
    [EventBus.Events.STREAK_BROKEN]:         "streak_broken",
    
    // Economy events
    [EventBus.Events.CURRENCY_EARNED]:       "currency_earned",
    [EventBus.Events.CURRENCY_SPENT]:        "currency_spent",
    [EventBus.Events.STORE_PURCHASE]:        "store_purchase",
    
    // Inventory events
    [EventBus.Events.ITEM_GRANTED]:          "item_granted",
    [EventBus.Events.ITEM_CONSUMED]:         "item_consumed",
    
    // Energy events
    [EventBus.Events.ENERGY_SPENT]:          "energy_spent",
    [EventBus.Events.ENERGY_REFILLED]:       "energy_refilled",
    
    // Session events
    [EventBus.Events.SESSION_START]:         "session_start",
    [EventBus.Events.SESSION_END]:           "session_end",
    
    // Stat events
    [EventBus.Events.STAT_UPDATED]:          "stat_updated",
    
    // Reward events
    [EventBus.Events.REWARD_GRANTED]:        "reward_granted",
  };

  // List of events to subscribe to
  var SUBSCRIBED_EVENTS = Object.keys(EVENT_TYPE_MAP);

  // ── Handler for EventBus events ───────────────────────────────────────────
  function handleEvent(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    ctx: nkruntime.Context,
    eventName: string,
    data: any
  ): void {
    // Skip if no user context (system events without user)
    if (!ctx.userId) {
      return;
    }

    var questEventType = EVENT_TYPE_MAP[eventName];
    if (!questEventType) {
      return;
    }

    // Extract common fields from event data
    var gameId = data.gameId || data.appId || Constants.DEFAULT_GAME_ID;
    var value = extractValue(eventName, data);
    var metadata = extractMetadata(eventName, data);

    logger.debug(
      "[QuestEventBusBridge] Processing event=%s → questEventType=%s user=%s game=%s value=%d",
      eventName, questEventType, ctx.userId, gameId, value
    );

    // Call the quest engine to process this event
    try {
      QuestEngine.processEvent(nk, logger, ctx, ctx.userId, gameId, questEventType, value, metadata);
    } catch (err: any) {
      logger.warn(
        "[QuestEventBusBridge] Quest processing failed for event=%s user=%s: %s",
        eventName, ctx.userId, err.message || String(err)
      );
    }
  }

  // ── Value extraction per event type ───────────────────────────────────────
  function extractValue(eventName: string, data: any): number {
    switch (eventName) {
      case EventBus.Events.QUIZ_COMPLETED:
        return data.score || data.correctAnswers || 1;
      case EventBus.Events.SCORE_SUBMITTED:
        return data.score || 0;
      case EventBus.Events.XP_EARNED:
        return data.amount || data.xp || 0;
      case EventBus.Events.LEVEL_UP:
        return data.level || data.newLevel || 1;
      case EventBus.Events.CURRENCY_EARNED:
      case EventBus.Events.CURRENCY_SPENT:
        return data.amount || 0;
      case EventBus.Events.SESSION_END:
        return data.duration || data.durationMinutes || 0;
      case EventBus.Events.STREAK_UPDATED:
        return data.streak || data.currentStreak || 1;
      default:
        return data.value || data.count || 1;
    }
  }

  // ── Metadata extraction per event type ────────────────────────────────────
  function extractMetadata(eventName: string, data: any): { [k: string]: string } {
    var meta: { [k: string]: string } = {};
    
    // Common fields
    if (data.gameId) meta.gameId = String(data.gameId);
    if (data.appId) meta.appId = String(data.appId);
    if (data.category) meta.category = String(data.category);
    if (data.type) meta.type = String(data.type);
    
    // Event-specific fields
    switch (eventName) {
      case EventBus.Events.QUIZ_COMPLETED:
        if (data.quizId) meta.quizId = String(data.quizId);
        if (data.mode) meta.mode = String(data.mode);
        if (data.difficulty) meta.difficulty = String(data.difficulty);
        break;
      case EventBus.Events.ACHIEVEMENT_COMPLETED:
        if (data.achievementId) meta.achievementId = String(data.achievementId);
        break;
      case EventBus.Events.CHALLENGE_COMPLETED:
        if (data.challengeId) meta.challengeId = String(data.challengeId);
        break;
      case EventBus.Events.LEVEL_UP:
        if (data.previousLevel) meta.previousLevel = String(data.previousLevel);
        break;
      case EventBus.Events.CURRENCY_EARNED:
      case EventBus.Events.CURRENCY_SPENT:
        if (data.currency) meta.currency = String(data.currency);
        if (data.source) meta.source = String(data.source);
        break;
      case EventBus.Events.STORE_PURCHASE:
        if (data.itemId) meta.itemId = String(data.itemId);
        break;
    }
    
    return meta;
  }

  // ── Registration ──────────────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    logger.info("[QuestEventBusBridge] Registering EventBus subscriptions for %d events", SUBSCRIBED_EVENTS.length);
    
    for (var i = 0; i < SUBSCRIBED_EVENTS.length; i++) {
      var eventName = SUBSCRIBED_EVENTS[i];
      
      // Create a closure to capture eventName for each handler
      (function(capturedEventName: string) {
        EventBus.on(capturedEventName, function(nk, logger, ctx, data) {
          handleEvent(nk, logger, ctx, capturedEventName, data);
        });
      })(eventName);
      
      logger.debug("[QuestEventBusBridge] Subscribed to: %s → %s", eventName, EVENT_TYPE_MAP[eventName]);
    }
    
    logger.info("[QuestEventBusBridge] Registration complete. Quest progress will auto-track from EventBus events.");
  }
}
