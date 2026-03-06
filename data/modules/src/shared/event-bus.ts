namespace EventBus {

  type EventHandler = (nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, data: any) => void;

  var handlers: { [eventName: string]: EventHandler[] } = {};

  export function on(eventName: string, handler: EventHandler): void {
    if (!handlers[eventName]) {
      handlers[eventName] = [];
    }
    handlers[eventName].push(handler);
  }

  export function emit(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, eventName: string, data: any): void {
    var eventHandlers = handlers[eventName];
    if (!eventHandlers) return;

    for (var i = 0; i < eventHandlers.length; i++) {
      try {
        eventHandlers[i](nk, logger, ctx, data);
      } catch (err: any) {
        logger.error("EventBus handler error for '%s': %s", eventName, err.message || String(err));
      }
    }
  }

  // Well-known event names
  export var Events = {
    CURRENCY_SPENT: "currency_spent",
    CURRENCY_EARNED: "currency_earned",
    ITEM_GRANTED: "item_granted",
    ITEM_CONSUMED: "item_consumed",
    ACHIEVEMENT_PROGRESS: "achievement_progress",
    ACHIEVEMENT_COMPLETED: "achievement_completed",
    ACHIEVEMENT_CLAIMED: "achievement_claimed",
    LEVEL_UP: "level_up",
    XP_EARNED: "xp_earned",
    ENERGY_SPENT: "energy_spent",
    ENERGY_REFILLED: "energy_refilled",
    STAT_UPDATED: "stat_updated",
    STREAK_UPDATED: "streak_updated",
    STREAK_BROKEN: "streak_broken",
    STORE_PURCHASE: "store_purchase",
    SCORE_SUBMITTED: "score_submitted",
    CHALLENGE_COMPLETED: "challenge_completed",
    REWARD_GRANTED: "reward_granted",
    GAME_STARTED: "game_started",
    GAME_COMPLETED: "game_completed",
    SESSION_START: "session_start",
    SESSION_END: "session_end",
  };
}
