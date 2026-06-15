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
  //
  // IMPORTANT: this map is built LAZILY (inside a function), not at namespace
  // eval time. Reading `EventBus.Events.*` at module scope creates an
  // eval-time dependency on the EventBus namespace having already been
  // initialised — but the merged bundle's namespace order is not guaranteed
  // (it shifts with the TypeScript compiler version / file ordering). When
  // this namespace's IIFE ran before EventBus's, `EventBus` was `undefined`
  // and the whole goja runtime failed to load with
  // "Cannot read property 'Events' of undefined". Deferring the reads to
  // call-time (register(), invoked from InitModule) guarantees EventBus is
  // fully defined first.
  var _eventTypeMap: { [eventBusEvent: string]: string } | null = null;

  function eventTypeMap(): { [eventBusEvent: string]: string } {
    if (_eventTypeMap) {
      return _eventTypeMap;
    }
    var m: { [eventBusEvent: string]: string } = {};
    // Core gameplay events
    m[EventBus.Events.QUIZ_COMPLETED] = "quiz_completed";
    m[EventBus.Events.GAME_COMPLETED] = "game_completed";
    m[EventBus.Events.GAME_STARTED] = "game_started";
    // Progression events
    m[EventBus.Events.LEVEL_UP] = "level_up";
    m[EventBus.Events.XP_EARNED] = "xp_earned";
    // Score events
    m[EventBus.Events.SCORE_SUBMITTED] = "score_submitted";
    // Achievement events
    m[EventBus.Events.ACHIEVEMENT_COMPLETED] = "achievement_completed";
    m[EventBus.Events.ACHIEVEMENT_CLAIMED] = "achievement_claimed";
    // Challenge events
    m[EventBus.Events.CHALLENGE_COMPLETED] = "challenge_completed";
    // Streak events
    m[EventBus.Events.STREAK_UPDATED] = "streak_updated";
    m[EventBus.Events.STREAK_BROKEN] = "streak_broken";
    // Economy events
    m[EventBus.Events.CURRENCY_EARNED] = "currency_earned";
    m[EventBus.Events.CURRENCY_SPENT] = "currency_spent";
    m[EventBus.Events.STORE_PURCHASE] = "store_purchase";
    // Inventory events
    m[EventBus.Events.ITEM_GRANTED] = "item_granted";
    m[EventBus.Events.ITEM_CONSUMED] = "item_consumed";
    // Energy events
    m[EventBus.Events.ENERGY_SPENT] = "energy_spent";
    m[EventBus.Events.ENERGY_REFILLED] = "energy_refilled";
    // Session events
    m[EventBus.Events.SESSION_START] = "session_start";
    m[EventBus.Events.SESSION_END] = "session_end";
    // Stat events
    m[EventBus.Events.STAT_UPDATED] = "stat_updated";
    // Reward events
    m[EventBus.Events.REWARD_GRANTED] = "reward_granted";
    _eventTypeMap = m;
    return m;
  }

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

    var questEventType = eventTypeMap()[eventName];
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
    var map = eventTypeMap();
    var subscribedEvents = Object.keys(map);
    logger.info("[QuestEventBusBridge] Registering EventBus subscriptions for %d events", subscribedEvents.length);
    
    for (var i = 0; i < subscribedEvents.length; i++) {
      var eventName = subscribedEvents[i];
      
      // Create a closure to capture eventName for each handler
      (function(capturedEventName: string) {
        EventBus.on(capturedEventName, function(nk, logger, ctx, data) {
          handleEvent(nk, logger, ctx, capturedEventName, data);
        });
      })(eventName);
      
      logger.debug("[QuestEventBusBridge] Subscribed to: %s → %s", eventName, map[eventName]);
    }
    
    logger.info("[QuestEventBusBridge] Registration complete. Quest progress will auto-track from EventBus events.");
  }
}
