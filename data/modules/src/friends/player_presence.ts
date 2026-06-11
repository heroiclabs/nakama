// ============================================================================
// src/friends/player_presence.ts — Player Presence + Cross-Game Messages
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// Owns three RPCs:
//
//   ivx_set_player_presence
//   -----------------------
//   Called by the Unity SDK (IVXNManager) on session start and game-change.
//   Writes the caller's presence record to `player_presence/status` using
//   the canonical schema read by `find_friends.ts` and `friends_list.ts`:
//
//     { online: true, lastSeenMs: number, gameId: string, gameName: string }
//
//   The legacy handler in `legacy_runtime.js` (rpcIvxSetPlayerPresence) wrote
//   to `player_presence/current` with a different schema — the wrong key means
//   find_friends and friends_list ALWAYS reported everyone as offline. This
//   module is the authoritative replacement; `ivx_set_player_presence` is
//   pinned in __TS_OWNED_RPCS via postbuild so the legacy stub is suppressed.
//
//   Request:  { gameId?: string, gameName?: string }
//   Response: { success, userId, gameId, gameName, timestamp }
//
//   ivx_get_cross_game_messages
//   ---------------------------
//   Returns pending cross-game messages (e.g. game-challenge notifications
//   sent by friends in other IVX titles). Each message is stored as an
//   individual document in the `cross_game_messages` collection so that
//   marking one read does not require a read-modify-write on a shared array
//   (race-free, works across replicated Nakama pods).
//
//   Request:  { limit?: int (1..200, default 50) }
//   Response: { success, userId, messages: CrossGameMessage[], count, timestamp }
//
//   ivx_mark_message_read
//   ---------------------
//   Deletes a single cross-game message by its storage key, preventing it from
//   appearing in future `ivx_get_cross_game_messages` responses.
//
//   Request:  { messageKey: string }
//   Response: { success, messageKey, timestamp }
//
// Storage layout
// --------------
//   player_presence / status      (per userId)  — online heartbeat
//   cross_game_messages / <key>   (per userId)  — per-message documents
// ============================================================================

namespace IvxPresence {

  // ── Presence constants ────────────────────────────────────────────────────
  var PRESENCE_COLLECTION = "player_presence";
  var PRESENCE_KEY        = "status";

  // ── Cross-game message constants ──────────────────────────────────────────
  var MESSAGES_COLLECTION = "cross_game_messages";
  var MESSAGES_LIST_LIMIT = 200;
  var MESSAGES_DEFAULT_LIMIT = 50;

  // ── Stable error codes ────────────────────────────────────────────────────
  var ERR_UNAUTHENTICATED = "unauthenticated";
  var ERR_INVALID_PAYLOAD = "invalid_payload";
  var ERR_MISSING_FIELD   = "missing_field";
  var ERR_INTERNAL        = "internal_error";

  // ── Helpers ───────────────────────────────────────────────────────────────
  function ok(data: any): string {
    return JSON.stringify(data);
  }

  function fail(message: string, errorCode: string): string {
    return JSON.stringify({ success: false, error: message, errorCode: errorCode });
  }

  function parsePayload(payload: string): { ok: boolean; data?: any; error?: string } {
    if (!payload || payload === "") return { ok: true, data: {} };
    try {
      return { ok: true, data: JSON.parse(payload) };
    } catch (e: any) {
      return { ok: false, error: "Invalid JSON payload: " + (e.message || String(e)) };
    }
  }

  // ── RPC: ivx_set_player_presence ─────────────────────────────────────────
  // Writes a canonical presence record to `player_presence/status`.
  // This is the correct key read by find_friends.ts and friends_list.ts.
  export function rpcSetPlayerPresence(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    if (!ctx || !ctx.userId) {
      return fail("Authentication required", ERR_UNAUTHENTICATED);
    }

    var parsed = parsePayload(payload);
    if (!parsed.ok) {
      return fail(parsed.error || "bad payload", ERR_INVALID_PAYLOAD);
    }
    var data  = parsed.data || {};
    var gameId   = (typeof data.gameId   === "string" && data.gameId)   ? data.gameId   : "quizverse";
    var gameName = (typeof data.gameName === "string" && data.gameName) ? data.gameName : "";

    var nowMs = Date.now();
    var presence = {
      online:      true,
      lastSeenMs:  nowMs,
      gameId:      gameId,
      gameName:    gameName,
      updatedAt:   Math.floor(nowMs / 1000)
    };

    try {
      nk.storageWrite([{
        collection:      PRESENCE_COLLECTION,
        key:             PRESENCE_KEY,
        userId:          ctx.userId,
        value:           presence,
        permissionRead:  2,
        permissionWrite: 0
      }]);
    } catch (e: any) {
      logger.error("[IvxPresence] storageWrite failed for userId=" + ctx.userId + ": " + (e.message || String(e)));
      return fail("Failed to write presence", ERR_INTERNAL);
    }

    var timestamp = new Date(nowMs).toISOString();

    if (logger && logger.debug) {
      logger.debug("[IvxPresence] presence set userId=" + ctx.userId + " gameId=" + gameId);
    }

    return ok({
      success:   true,
      userId:    ctx.userId,
      gameId:    gameId,
      gameName:  gameName,
      timestamp: timestamp
    });
  }

  // ── RPC: ivx_get_cross_game_messages ─────────────────────────────────────
  // Lists individual message documents from the `cross_game_messages`
  // collection (one Nakama storage object per message, keyed by sender+ts).
  export function rpcGetCrossGameMessages(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    if (!ctx || !ctx.userId) {
      return fail("Authentication required", ERR_UNAUTHENTICATED);
    }

    var parsed = parsePayload(payload);
    if (!parsed.ok) {
      return fail(parsed.error || "bad payload", ERR_INVALID_PAYLOAD);
    }
    var data  = parsed.data || {};
    var limit = (typeof data.limit === "number" && data.limit > 0 && data.limit <= MESSAGES_LIST_LIMIT)
      ? Math.floor(data.limit)
      : MESSAGES_DEFAULT_LIMIT;

    var nowMs     = Date.now();
    var timestamp = new Date(nowMs).toISOString();
    var messages: any[] = [];

    try {
      // List all documents in the collection owned by this user.
      // nk.storageList returns objects in ascending createTime order.
      var cursor: string | null = null;
      do {
        var page: nkruntime.StorageObjectList | null = null;
        try {
          page = nk.storageList(ctx.userId, MESSAGES_COLLECTION, limit, cursor || "");
        } catch (e: any) {
          logger.error("[IvxPresence] storageList failed for userId=" + ctx.userId + ": " + (e.message || String(e)));
          break;
        }
        if (!page || !page.objects) break;

        for (var i = 0; i < page.objects.length; i++) {
          var obj = page.objects[i];
          if (!obj || !obj.value) continue;
          var msg: any = obj.value;
          // Stamp the storageKey so the client can pass it to ivx_mark_message_read.
          msg.storageKey = obj.key;
          messages.push(msg);
        }

        cursor = page.cursor || null;
        // Stop once we have enough messages (limit) or exhaust the collection.
        if (messages.length >= limit) break;
      } while (cursor);
    } catch (e: any) {
      logger.error("[IvxPresence] get_cross_game_messages error for userId=" + ctx.userId + ": " + (e.message || String(e)));
      return fail("Failed to retrieve messages", ERR_INTERNAL);
    }

    // Trim to limit (in case multiple pages pushed us over).
    if (messages.length > limit) {
      messages = messages.slice(0, limit);
    }

    if (logger && logger.debug) {
      logger.debug("[IvxPresence] get_cross_game_messages userId=" + ctx.userId + " count=" + messages.length);
    }

    return ok({
      success:   true,
      userId:    ctx.userId,
      messages:  messages,
      count:     messages.length,
      timestamp: timestamp
    });
  }

  // ── RPC: ivx_mark_message_read ────────────────────────────────────────────
  // Deletes the message document from the `cross_game_messages` collection.
  // Idempotent: if the key does not exist the call still succeeds.
  export function rpcMarkMessageRead(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    if (!ctx || !ctx.userId) {
      return fail("Authentication required", ERR_UNAUTHENTICATED);
    }

    var parsed = parsePayload(payload);
    if (!parsed.ok) {
      return fail(parsed.error || "bad payload", ERR_INVALID_PAYLOAD);
    }
    var data = parsed.data || {};
    var messageKey = typeof data.messageKey === "string" ? data.messageKey.trim() : "";
    if (!messageKey) {
      return fail("messageKey is required", ERR_MISSING_FIELD);
    }

    try {
      nk.storageDelete([{
        collection: MESSAGES_COLLECTION,
        key:        messageKey,
        userId:     ctx.userId
      }]);
    } catch (e: any) {
      logger.error("[IvxPresence] storageDelete failed for userId=" + ctx.userId + " key=" + messageKey + ": " + (e.message || String(e)));
      return fail("Failed to delete message", ERR_INTERNAL);
    }

    var timestamp = new Date().toISOString();

    if (logger && logger.debug) {
      logger.debug("[IvxPresence] mark_message_read userId=" + ctx.userId + " key=" + messageKey);
    }

    return ok({
      success:    true,
      messageKey: messageKey,
      timestamp:  timestamp
    });
  }

  // ── Public registration ───────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_set_player_presence",    rpcSetPlayerPresence);
    initializer.registerRpc("ivx_get_cross_game_messages", rpcGetCrossGameMessages);
    initializer.registerRpc("ivx_mark_message_read",       rpcMarkMessageRead);
  }
}
