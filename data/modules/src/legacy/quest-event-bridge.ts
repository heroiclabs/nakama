// ============================================================
// Quest Event Bridge — closes the analytics_log_event gap
//
// RPC: quest_game_event
//
// Called by game clients (or internally by other RPCs) when a
// game-play event should trigger quest progress in QuestX.
//
// Payload:
//   { gameId: string, eventName: string, eventData: object }
//
// Flow:
//   game client → Nakama RPC quest_game_event
//              → maps eventName → QuestX GameEventType
//              → POST /game-bridge/s2s/quest-event   (HMAC-signed)
//              → QuestX processNakamaEvent()
//              → GameQuestProgress updated
//              → Points awarded when quest completes
//
// Environment variables used (resolved from ctx.env):
//   QUESTS_ECONOMY_API_URL   — e.g. https://quests.intelli-verse-x.ai
//   NAKAMA_WEBHOOK_SECRET    — shared secret for NakamaS2sGuard
// ============================================================

namespace QuestEventBridge {

  // ── Analytics event name → QuestX GameEventType ──────────────
  // Matches the goal-type map in GameBridgeService.getActiveGameQuestsForEvent()
  var EVENT_MAP: { [key: string]: string } = {
    // Matches / battles
    "match_complete":      "match_result",
    "multiplayer_win":     "match_result",
    // Scores
    "score_submit":        "score_update",
    "quiz_complete":       "score_update",
    "quiz_accuracy":       "score_update",
    // Levels / progression
    "level_up":            "level_reached",
    "season_pass_xp":      "level_reached",
    "collection_unlock":   "level_reached",
    // Achievements
    "achievement_unlock":  "achievement_completed",
    // Missions / daily engagement
    "mission_complete":    "mission_completed",
    "daily_login":         "mission_completed",
    "weekly_goal_complete":"mission_completed",
    // Playtime / streaks
    "session_end":         "playtime_update",
    "playtime_update":     "playtime_update",
    "streak_continue":     "playtime_update",
    // Purchases
    "item_purchase":       "purchase_made",
    // Everything else
    "currency_earn":       "custom_event",
    "friend_challenge":    "custom_event",
    "referral_signup":     "custom_event",
    "ad_watched":          "custom_event",
    "receipt_scanned":     "custom_event",
    "tournament_join":     "custom_event",
    "tournament_win":      "custom_event",
    "weekly_goal_complete_bonus": "custom_event",
  };

  function mapEventType(eventName: string): string {
    return EVENT_MAP[eventName] || "custom_event";
  }

  function rpcQuestGameEvent(
    ctx: nkruntime.Context,
    logger: nkruntime.Logger,
    nk: nkruntime.Nakama,
    payload: string,
  ): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload);

      var gameId = data.gameId || data.game_id;
      var eventName = data.eventName || data.event_name || data.name;
      var eventData = data.eventData || data.event_data || data.data || {};

      if (!gameId) return RpcHelpers.errorResponse("gameId required");
      if (!eventName) return RpcHelpers.errorResponse("eventName required");

      var eventType = mapEventType(eventName);

      var questsApiUrl = (ctx.env && ctx.env["QUESTS_ECONOMY_API_URL"]) || "http://localhost:3001";
      var webhookSecret = (ctx.env && ctx.env["NAKAMA_WEBHOOK_SECRET"]) || "";

      if (!webhookSecret) {
        logger.warn("[QuestEventBridge] NAKAMA_WEBHOOK_SECRET not set — skipping quest sync");
        return RpcHelpers.successResponse({ forwarded: false, reason: "webhook_secret_not_configured" });
      }

      var body = JSON.stringify({
        nakamaGameId: gameId,
        eventType:    eventType,
        eventName:    eventName,
        data:         eventData,
      });

      // HMAC-SHA256 of the body — matches NakamaS2sGuard expectation
      var sig = (nk.hmacSha256Hash(webhookSecret, body) as unknown) as string;

      var url = questsApiUrl.replace(/\/$/, "") + "/game-bridge/s2s/quest-event";

      try {
        nk.httpRequest(
          url,
          "post",
          {
            "Content-Type":       "application/json",
            "X-Source":           "nakama-rpc",
            "X-Webhook-Signature": sig,
            "X-User-Id":          userId,
            "X-Game-Id":          gameId,
          },
          body,
          5000,
        );
        logger.debug("[QuestEventBridge] forwarded event=" + eventName + " type=" + eventType + " user=" + userId + " game=" + gameId);
      } catch (httpErr: any) {
        // Non-fatal: quest sync failure must never break the game session
        logger.warn("[QuestEventBridge] HTTP call failed: " + (httpErr.message || String(httpErr)));
        return RpcHelpers.successResponse({ forwarded: false, reason: "http_error", error: httpErr.message });
      }

      return RpcHelpers.successResponse({
        forwarded:  true,
        eventType:  eventType,
        eventName:  eventName,
        userId:     userId,
        gameId:     gameId,
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse("quest_game_event failed: " + (e.message || String(e)));
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("quest_game_event", rpcQuestGameEvent);
  }
}
