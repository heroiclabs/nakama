// presence_v2.ts — per-game presence (doc §8.2, Phase 2 migration).
//
// WHAT CHANGES VS player_presence/status (the legacy single-key presence):
//   - Storage key is {gameId}_{userId} in collection ivx_presence_v2, so a
//     player's presence in QuizVerse is distinct from LastToLive ("is my
//     friend in THIS game right now?").
//   - Explicit heartbeat contract: client calls ivx_social_presence_set every
//     60s while active + once with online:false on quit/background.
//   - Online window is 150 SECONDS (doc C-007: two missed heartbeats +
//     jitter; the legacy 5-minute window shows long-gone players as online).
//   - sessionId + deviceType tracked for multi-device disambiguation.
//   - ivx_social_presence_bulk_get replaces per-caller loadOnlineMap copies
//     as the public batch-read surface (the shared FriendsPresenceShared
//     helper remains for legacy readers during the transition).
//
// MIGRATION (dual-write): every v2 heartbeat ALSO writes the legacy
// player_presence/status row in its exact legacy shape, so friends_list /
// find_friends / find_nearby (which read via FriendsPresenceShared) keep
// working unchanged until they migrate to bulk reads of v2. bulk_get reads
// v2 first and falls back to the legacy row per-user when v2 is absent.
//
// RETENTION: stale v2 rows are swept by ivx_social_maintenance_tick
// (90 days on update_time — see maintenance.ts SWEEPS).

namespace SocialPresenceV2 {

  var COLLECTION_V2       = "ivx_presence_v2";
  var LEGACY_COLLECTION   = "player_presence";
  var LEGACY_KEY          = "status";
  var ONLINE_WINDOW_MS    = 150 * 1000;  // doc §8.2 (corrected from 90s → 150s, C-007)
  var MAX_BULK_USERS      = 200;
  var MAX_STATUS_LEN      = 64;

  // Minimal game registry (doc §5.3). The full storage-backed app registry
  // (§19.3) replaces this when it ships; until then unknown ids fall back to
  // "quizverse" instead of erroring so older clients can never brick presence.
  var KNOWN_GAME_IDS: { [k: string]: boolean } = {
    "quizverse": true, "lasttolive": true, "cricket": true
  };

  function resolveGameId(raw: any): string {
    var g = (typeof raw === "string" && raw) ? raw.toLowerCase() : "quizverse";
    return KNOWN_GAME_IDS[g] ? g : "quizverse";
  }

  function v2Key(gameId: string, userId: string): string {
    return gameId + "_" + userId;
  }

  function collapse(value: any, nowMs: number): { online: boolean; status: string; lastSeenMs: number } {
    var out = { online: false, status: "", lastSeenMs: 0 };
    if (!value) return out;
    var last = (typeof value.lastSeenMs === "number") ? value.lastSeenMs : 0;
    out.lastSeenMs = last;
    out.status = (typeof value.status === "string") ? value.status : "";
    if (value.online === true && last > 0 && (nowMs - last) <= ONLINE_WINDOW_MS) {
      out.online = true;
    }
    return out;
  }

  // ── RPC: ivx_social_presence_set ──────────────────────────────────────────
  // Payload: { gameId?, online?: bool (default true), status?: string,
  //            deviceType?: string, sessionId?: string, gameName?: string }
  function rpcPresenceSet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      var userId = RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};

      var gameId = resolveGameId(data.gameId);
      var online = data.online !== false; // default true — heartbeat implies presence
      var status = (typeof data.status === "string") ? data.status.substring(0, MAX_STATUS_LEN) : (online ? "browsing" : "");
      var nowMs  = Date.now();

      var v2Value = {
        userId:     userId,
        gameId:     gameId,
        online:     online,
        status:     status,
        lastSeenMs: nowMs,
        sessionId:  (typeof data.sessionId === "string") ? data.sessionId.substring(0, 64) : "",
        deviceType: (typeof data.deviceType === "string") ? data.deviceType.substring(0, 32) : "",
        updatedAt:  nowMs
      };

      // Legacy mirror — EXACT shape rpcSetPlayerPresence writes today, so
      // FriendsPresenceShared.loadOnlineMap keeps working during migration.
      var legacyValue = {
        online:      online,
        lastSeenMs:  nowMs,
        gameId:      gameId,
        gameName:    (typeof data.gameName === "string") ? data.gameName : "",
        updatedAt:   Math.floor(nowMs / 1000)
      };

      nk.storageWrite([
        {
          collection: COLLECTION_V2, key: v2Key(gameId, userId), userId: userId,
          value: v2Value, permissionRead: 2, permissionWrite: 0
        },
        {
          collection: LEGACY_COLLECTION, key: LEGACY_KEY, userId: userId,
          value: legacyValue, permissionRead: 2, permissionWrite: 0
        }
      ]);

      return RpcHelpers.successResponse({
        gameId: gameId, online: online, status: status,
        lastSeenMs: nowMs, onlineWindowMs: ONLINE_WINDOW_MS,
        heartbeatSeconds: 60
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to set presence");
    }
  }

  // ── RPC: ivx_social_presence_bulk_get ─────────────────────────────────────
  // Payload: { gameId?, userIds: string[] (max 200) }
  // Response data: { presence: { [userId]: { online, status, lastSeenMs, source } } }
  function rpcPresenceBulkGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};
      var gameId = resolveGameId(data.gameId);

      var userIds: string[] = [];
      if (data.userIds && Object.prototype.toString.call(data.userIds) === "[object Array]") {
        for (var i = 0; i < data.userIds.length && userIds.length < MAX_BULK_USERS; i++) {
          if (typeof data.userIds[i] === "string" && data.userIds[i]) userIds.push(data.userIds[i]);
        }
      }
      if (userIds.length === 0) {
        return RpcHelpers.errorResponse("userIds (non-empty array, max " + MAX_BULK_USERS + ") is required");
      }

      var nowMs = Date.now();
      var out: { [id: string]: any } = {};

      // Pass 1 — v2 rows (one batched read).
      var v2Reads: nkruntime.StorageReadRequest[] = [];
      for (var a = 0; a < userIds.length; a++) {
        v2Reads.push({ collection: COLLECTION_V2, key: v2Key(gameId, userIds[a]), userId: userIds[a] });
      }
      var missing: { [id: string]: boolean } = {};
      for (var m = 0; m < userIds.length; m++) missing[userIds[m]] = true;
      try {
        var v2Rows = nk.storageRead(v2Reads);
        if (v2Rows) {
          for (var r = 0; r < v2Rows.length; r++) {
            var row = v2Rows[r];
            if (!row || !row.value || !row.userId) continue;
            var c = collapse(row.value, nowMs);
            out[row.userId] = { online: c.online, status: c.status, lastSeenMs: c.lastSeenMs, source: "v2" };
            delete missing[row.userId];
          }
        }
      } catch (e: any) {
        logger.warn("[PresenceV2] v2 bulk read failed: " + (e && e.message));
      }

      // Pass 2 — legacy fallback for users without a v2 row yet (one batched read).
      var legacyIds: string[] = [];
      for (var mk in missing) {
        if (Object.prototype.hasOwnProperty.call(missing, mk)) legacyIds.push(mk);
      }
      if (legacyIds.length > 0) {
        var legReads: nkruntime.StorageReadRequest[] = [];
        for (var l = 0; l < legacyIds.length; l++) {
          legReads.push({ collection: LEGACY_COLLECTION, key: LEGACY_KEY, userId: legacyIds[l] });
        }
        try {
          var legRows = nk.storageRead(legReads);
          if (legRows) {
            for (var lr = 0; lr < legRows.length; lr++) {
              var lrow = legRows[lr];
              if (!lrow || !lrow.value || !lrow.userId) continue;
              var lc = collapse(lrow.value, nowMs);
              out[lrow.userId] = { online: lc.online, status: lc.status, lastSeenMs: lc.lastSeenMs, source: "legacy" };
            }
          }
        } catch (e2: any) {
          logger.warn("[PresenceV2] legacy fallback read failed: " + (e2 && e2.message));
        }
      }

      // Users with no row anywhere: explicit offline (never omit — clients
      // must not have to distinguish "missing key" from "offline").
      for (var u = 0; u < userIds.length; u++) {
        if (!out[userIds[u]]) {
          out[userIds[u]] = { online: false, status: "", lastSeenMs: 0, source: "none" };
        }
      }

      return RpcHelpers.successResponse({
        gameId: gameId,
        onlineWindowMs: ONLINE_WINDOW_MS,
        presence: out
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to read presence");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_presence_set", rpcPresenceSet);
    initializer.registerRpc("ivx_social_presence_bulk_get", rpcPresenceBulkGet);
  }
}
