// ============================================================================
// src/friends/friends_list.ts — Canonical friends_list + list_blocked_users
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// Replaces the 6-line passthrough handler that used to live in
// `src/legacy/friends.ts` (LegacyFriends.rpcFriendsList). That handler just
// returned `nk.friendsList()`'s raw nested shape — no presence enrichment,
// no relationship envelope, no displayName flattening — which made the
// friends list inconsistent with `intelliverse_find_friends` results.
//
// What this module owns
// ---------------------
//   friends_list        – the canonical friend roster (state filter optional)
//   list_blocked_users  – the dedicated "Blocked Users" enumeration (Phase-4 H1)
//
// Both RPCs return the SAME flat shape as `intelliverse_find_friends` so
// the Unity adapter can render any of these three sources with identical
// row prefabs:
//
//   {
//     "userId":             string,
//     "username":           string,
//     "displayName":        string,
//     "avatarUrl":          string,
//     "online":             bool,           // from `player_presence` collection
//     "createTime":         iso8601 string, // user creation
//     "relationshipStatus": "friend" | "pending_sent" | "pending_received" | "blocked",
//     "state":              0..3            // raw Nakama FriendState int
//   }
//
// Pagination contract (friends_list only)
// ---------------------------------------
//   request:  { limit?: int (1..500, default 100), state?: 0..3, cursor?: string }
//   response: { results: NakamaFriend[], count: int, nextCursor: string|null }
//
// `state` is OPTIONAL. When omitted, ALL relationship states are returned
// (matches Nakama's default). When set:
//   0 = friends only
//   1 = invites you SENT (still pending)
//   2 = invites you RECEIVED (still pending)
//   3 = users YOU BLOCKED (use list_blocked_users for the Blocked tab UX)
//
// Online status source
// --------------------
// We deliberately do NOT use `friend.user.online` from Nakama. That field
// reflects the realtime SOCKET presence (a player may be logged in but
// have zero meaningful presence — e.g. AFK background app on iOS that lost
// the socket but is still "online"). Instead we read the `player_presence`
// storage collection — the SAME source of truth that
// `intelliverse_find_friends` uses. This is what eliminates the
// "online in search, offline in friends list" inconsistency.
//
// list_blocked_users
// ------------------
// Returns the same flat shape, scoped to STATE_BLOCKED only. Always
// returns relationshipStatus="blocked" so the client UI can show an
// Unblock button without a second relationship lookup. No pagination
// (block lists are tiny — capped at 500).
// ============================================================================

namespace IntelliverseFriendsList {

  // ── Shared constants (mirror of find_friends.ts) ───────────────────────
  var PRESENCE_COLLECTION = "player_presence";
  var PRESENCE_KEY        = "status";
  var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min ⇒ online

  // Nakama friend states
  var STATE_FRIEND          = 0;
  var STATE_INVITE_SENT     = 1;
  var STATE_INVITE_RECEIVED = 2;
  var STATE_BLOCKED         = 3;

  // Hard caps protect the DB from abuse
  var FRIENDS_LIST_MAX_LIMIT  = 500;
  var BLOCKED_LIST_HARD_LIMIT = 500;

  // Stable machine error codes
  var ERR_UNAUTHENTICATED = "unauthenticated";
  var ERR_INVALID_PAYLOAD = "invalid_payload";
  var ERR_INTERNAL        = "internal_error";

  // ── Result envelope helpers ────────────────────────────────────────────
  function ok(data: any): string {
    return JSON.stringify({ success: true, data: data });
  }

  function err(message: string, errorCode: string): string {
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

  /**
   * Bulk-load presence rows from the `player_presence` storage collection.
   * Returns a { userId: boolean } map. Missing entries default to false.
   *
   * Identical algorithm to IntelliverseFriends.loadOnlineMap in
   * find_friends.ts — duplicated here (rather than imported) because
   * Nakama's Goja runtime does not support cross-namespace function calls
   * once postbuild has merged everything; namespace boundaries are real.
   * Keeping these in sync is enforced by code review.
   */
  // B-004 fix (2026-07-06): canonical implementation lives in
  // FriendsPresenceShared (presence_shared.ts). This wrapper keeps every
  // call site unchanged while eliminating the triple copy-paste.
  function loadOnlineMap(nk: nkruntime.Nakama, userIds: string[]): { [id: string]: boolean } {
    return FriendsPresenceShared.loadOnlineMap(nk, userIds);
  }

  /**
   * Map a Nakama `friend.state` int to the canonical relationshipStatus
   * string used by every Phase-4 client model.
   */
  function stateToRelationship(state: number): string {
    if (state === STATE_FRIEND)          return "friend";
    if (state === STATE_INVITE_SENT)     return "pending_sent";
    if (state === STATE_INVITE_RECEIVED) return "pending_received";
    if (state === STATE_BLOCKED)         return "blocked";
    return "none";
  }

  /**
   * Coerce Nakama's wrapped state value (`{value: 0}` in some runtime
   * versions, plain int in others) into a stable JS number.
   */
  function unwrapState(rawState: any): number {
    if (typeof rawState === "number") return rawState;
    if (rawState && typeof rawState === "object" && "value" in rawState) {
      var v = (rawState as any).value;
      if (typeof v === "number") return v;
    }
    return -1;
  }

  /**
   * Bulk-load each friend's ISO alpha-2 country from users.metadata->>'country'
   * in a single SQL round-trip. Returns a { userId: "US" } map (upper-cased);
   * users without a resolved country are simply absent from the map.
   *
   * This is the SAME source `intelliverse_find_nearby_players` filters on, so
   * the Social Zone "Friends Nearby" client filter (my country === friend
   * country) stays consistent with the suggestion strip. Best-effort: any SQL
   * failure degrades to an empty map (friends still render, just without a
   * country tag).
   */
  function loadCountryMap(
    nk:      nkruntime.Nakama,
    logger:  nkruntime.Logger,
    userIds: string[]
  ): { [id: string]: string } {
    var map: { [id: string]: string } = {};
    if (!userIds || userIds.length === 0) return map;

    // Build a parameterised IN ($1,$2,...) list — never interpolate ids.
    var placeholders: string[] = [];
    for (var p = 0; p < userIds.length; p++) {
      placeholders.push("$" + (p + 1));
    }

    var sql =
      "SELECT id, upper(metadata->>'country') AS country " +
      "FROM users " +
      "WHERE id IN (" + placeholders.join(",") + ") " +
      "  AND metadata->>'country' IS NOT NULL";

    try {
      var rows = nk.sqlQuery(sql, userIds as any);
      if (rows) {
        for (var r = 0; r < rows.length; r++) {
          var row: any = rows[r];
          if (row && row.id && row.country) {
            map[row.id] = String(row.country);
          }
        }
      }
    } catch (e: any) {
      if (logger && logger.warn) {
        logger.warn("[FriendsList] country map lookup failed: " + (e.message || String(e)));
      }
    }
    return map;
  }

  /**
   * Normalize nk.friendsList / FriendList shapes across Goja bindings.
   */
  function normalizeFriendsList(friendsResp: any): any[] {
    if (!friendsResp) return [];
    if (Array.isArray(friendsResp)) return friendsResp;
    if (friendsResp.friends && Array.isArray(friendsResp.friends)) return friendsResp.friends;
    if (friendsResp.Friends && Array.isArray(friendsResp.Friends)) return friendsResp.Friends;
    return [];
  }

  /**
   * SQL fallback when nk.friendsList returns empty despite a live friend graph
   * (seen on prod 2026-07-11 — native /v2/friend had rows, Goja list did not).
   * Builds the same { user, state } objects flattenFriend expects.
   */
  function loadFriendsViaSql(
    nk: nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string,
    limit: number,
    stateFilter: number | undefined
  ): any[] {
    var out: any[] = [];
    try {
      var rows: any[] = [];
      if (stateFilter === undefined || stateFilter === null) {
        rows = nk.sqlQuery(
          "SELECT e.destination_id AS friend_id, e.state AS edge_state, e.update_time AS edge_update_time, " +
          "       u.username, u.display_name, u.avatar_url, u.create_time, u.update_time, u.metadata " +
          "FROM user_edge e " +
          "JOIN users u ON u.id = e.destination_id " +
          "WHERE e.source_id = $1 " +
          "ORDER BY e.update_time DESC " +
          "LIMIT $2",
          [userId, limit]
        ) as any[];
      } else {
        rows = nk.sqlQuery(
          "SELECT e.destination_id AS friend_id, e.state AS edge_state, e.update_time AS edge_update_time, " +
          "       u.username, u.display_name, u.avatar_url, u.create_time, u.update_time, u.metadata " +
          "FROM user_edge e " +
          "JOIN users u ON u.id = e.destination_id " +
          "WHERE e.source_id = $1 AND e.state = $2 " +
          "ORDER BY e.update_time DESC " +
          "LIMIT $3",
          [userId, stateFilter, limit]
        ) as any[];
      }
      if (!rows) return out;
      for (var i = 0; i < rows.length; i++) {
        var row: any = rows[i];
        if (!row || !row.friend_id) continue;
        var edgeState = (typeof row.edge_state === "number")
          ? row.edge_state
          : parseInt(String(row.edge_state || 0), 10);
        out.push({
          state: edgeState,
          updateTime: row.edge_update_time || "",
          user: {
            id: String(row.friend_id),
            username: row.username || "",
            displayName: row.display_name || "",
            display_name: row.display_name || "",
            avatarUrl: row.avatar_url || "",
            avatar_url: row.avatar_url || "",
            createTime: row.create_time || "",
            create_time: row.create_time || "",
            updateTime: row.update_time || "",
            update_time: row.update_time || "",
            metadata: row.metadata || {}
          }
        });
      }
    } catch (e: any) {
      if (logger && logger.warn) {
        logger.warn("[FriendsList] user_edge SQL fallback failed: " + (e && e.message));
      }
    }
    return out;
  }

  /**
   * Flatten a Nakama friend object into our canonical wire shape.
   * Caller supplies the resolved `online` flag (from loadOnlineMap) and the
   * resolved alpha-2 `country` (from loadCountryMap; "" when unknown).
   */
  function flattenFriend(fr: any, online: boolean, country: string, gameActivity?: any): any {
    var u: any = fr.user || {};
    var state = unwrapState(fr.state);
    return {
      // ML-002 fix (2026-07-06): per-friend weekly activity ("xpThisWeek",
      // "quizzesThisWeek", "bestScoreThisWeek", "lastPlayedAt") from
      // ivx_game_player_stats, written by the quiz submit flow. null =
      // friend hasn't played this week; clients render zeros/dashes.
      gameActivity:       gameActivity || null,
      userId:             u.id || "",
      username:           u.username || "",
      displayName:        u.displayName || u.display_name || u.username || "",
      avatarUrl:          u.avatarUrl || u.avatar_url || "",
      online:             online,
      createTime:         u.createTime || u.create_time || "",
      relationshipStatus: stateToRelationship(state),
      state:              state,
      // ISO alpha-2 country (upper-cased) or "" when unresolved. Powers the
      // Social Zone "Friends Nearby" same-country filter.
      country:            country || "",
      // Pass through optional Nakama metadata when present (clients can ignore)
      updateTime:         u.updateTime || u.update_time || "",
      edgeUpdateTime:     fr.updateTime || fr.update_time || ""
    };
  }

  // ── friends_list RPC ───────────────────────────────────────────────────
  function rpcFriendsList(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = ctx.userId;
    if (!userId) return err("Authentication required", ERR_UNAUTHENTICATED);

    var parsed = parsePayload(payload);
    if (!parsed.ok) return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);
    var data: any = parsed.data || {};

    // ── Pagination ──────────────────────────────────────────────────────
    var limit = parseInt(data.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 100;
    if (limit > FRIENDS_LIST_MAX_LIMIT) limit = FRIENDS_LIST_MAX_LIMIT;

    // Nakama wants the cursor as a string (or null/undefined for "first page").
    // We accept "", null, or undefined as "first page" for client convenience.
    var cursor: string | undefined = undefined;
    if (typeof data.cursor === "string" && data.cursor.length > 0) {
      cursor = data.cursor;
    }

    // Optional state filter. Reject silently-out-of-range values rather than
    // erroring — clients sometimes pass legacy 4 (was used for "all" in
    // very old QV builds) which we treat as "no filter".
    var stateFilter: number | undefined = undefined;
    if (data.state !== undefined && data.state !== null) {
      var s = parseInt(data.state, 10);
      if (!isNaN(s) && s >= 0 && s <= 3) stateFilter = s;
    }

    // ── Fetch from Nakama ───────────────────────────────────────────────
    var friendsResp: nkruntime.FriendList | null = null;
    try {
      // Prefer null cursor (matches duo_quests / friends_feed call sites).
      // Passing JS `undefined` has been observed on prod Goja to yield an
      // empty FriendList while the native /v2/friend graph still has rows.
      friendsResp = nk.friendsList(
        userId,
        limit,
        (stateFilter === undefined ? null : stateFilter) as any,
        (cursor === undefined ? null : cursor) as any
      );
    } catch (e: any) {
      if (logger && logger.error) {
        logger.error("[FriendsList] nk.friendsList failed: " + (e.message || String(e)));
      }
      return err("Failed to load friends", ERR_INTERNAL);
    }

    // Nakama releases have exposed this binding both as FriendList and as a
    // direct array in Goja. Normalize both shapes so a valid native graph can
    // never become an empty Social Zone roster after a runtime upgrade.
    var rawFriends: any[] = normalizeFriendsList(friendsResp);

    // Prod incident 2026-07-11 (Sid): nk.friendsList returned {friends:[]} while
    // GET /v2/friend returned 14 edges. Fall back to user_edge SQL so Social
    // Zone never shows an empty roster when the graph is non-empty.
    if (rawFriends.length === 0) {
      rawFriends = loadFriendsViaSql(nk, logger, userId, limit, stateFilter);
      if (rawFriends.length > 0 && logger && logger.warn) {
        logger.warn(
          "[FriendsList] nk.friendsList empty — recovered " + rawFriends.length +
          " rows via user_edge SQL for user=" + userId
        );
      }
    }

    var nextCursor: string | null =
      (!Array.isArray(friendsResp as any) && friendsResp && (friendsResp as any).cursor) || null;

    // ── Bulk-load presence ──────────────────────────────────────────────
    var ids: string[] = [];
    for (var i = 0; i < rawFriends.length; i++) {
      var u = rawFriends[i] && rawFriends[i].user;
      if (u && u.id) ids.push(u.id);
    }
    var onlineMap = loadOnlineMap(nk, ids);

    // ── Bulk-load each friend's country (single batched SQL) ────────────
    var countryMap = loadCountryMap(nk, logger, ids);

    // ── Resolve the CALLER's own country (cache-first; never fatal) ──────
    // Returned at the envelope level so the client can run a "same country
    // as me" filter for the Social Zone "Friends Nearby" strip without a
    // second RPC. Empty string when geo is unknown — client simply skips
    // the nearby filter in that case.
    var myCountry = "";
    try {
      myCountry = GeoTier.resolveUserCountry(ctx, logger, nk, userId) || "";
    } catch (e: any) {
      myCountry = "";
    }

    // ── Bulk-load weekly game activity (ML-002 — one batched read) ──────
    var statsMap: { [id: string]: any } = {};
    try {
      if (typeof SocialPlayerStats !== "undefined" && SocialPlayerStats.loadStatsMap) {
        statsMap = SocialPlayerStats.loadStatsMap(nk, "quizverse", ids);
      }
    } catch (_) { /* optional enrichment — cards degrade to no-activity */ }

    // ── Flatten ─────────────────────────────────────────────────────────
    var results: any[] = [];
    var cntFriend = 0;
    var cntPendingRecv = 0;
    var cntPendingSent = 0;
    var cntBlocked = 0;
    var cntOther = 0;
    var samplePendingRecv: string[] = [];
    for (var j = 0; j < rawFriends.length; j++) {
      var fr = rawFriends[j];
      if (!fr || !fr.user || !fr.user.id) continue;
      var online = !!onlineMap[fr.user.id];
      var fcountry = countryMap[fr.user.id] || "";
      var flat = flattenFriend(fr, online, fcountry, statsMap[fr.user.id] || null);
      results.push(flat);
      var st = flat.relationshipStatus;
      if (st === "friend") cntFriend++;
      else if (st === "pending_received") {
        cntPendingRecv++;
        if (samplePendingRecv.length < 5) samplePendingRecv.push(String(flat.userId || fr.user.id));
      } else if (st === "pending_sent") cntPendingSent++;
      else if (st === "blocked") cntBlocked++;
      else cntOther++;
    }

    if (logger && logger.info) {
      logger.info(
        "[SZ-DIAG][SERVER][FriendsList] user=" + userId +
        " stateFilter=" + (stateFilter === undefined ? "any" : String(stateFilter)) +
        " country=" + (myCountry || "?") +
        " returned=" + results.length +
        " friend=" + cntFriend +
        " pending_received=" + cntPendingRecv +
        " pending_sent=" + cntPendingSent +
        " blocked=" + cntBlocked +
        " other=" + cntOther +
        " pendingRecvSample=" + samplePendingRecv.join(",") +
        " nextCursor=" + (nextCursor || "null")
      );
      logger.info(
        "[FriendsList] user=" + userId +
        " state=" + (stateFilter === undefined ? "any" : String(stateFilter)) +
        " country=" + (myCountry || "?") +
        " returned=" + results.length +
        " nextCursor=" + (nextCursor || "null")
      );
    }

    return ok({
      results:    results,
      friends:    results, // Dual-mapping alias for absolute C# serialization safety
      count:      results.length,
      nextCursor: nextCursor,
      country:    myCountry
    });
  }

  // ── list_blocked_users RPC (Phase-4 H1) ────────────────────────────────
  function rpcListBlockedUsers(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = ctx.userId;
    if (!userId) return err("Authentication required", ERR_UNAUTHENTICATED);

    // No required payload fields, but still parse defensively
    var parsed = parsePayload(payload);
    if (!parsed.ok) return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);

    var rawList: any[] = [];
    try {
      // Block lists are tiny in practice (<100 users for >99.9% of accounts);
      // we hard-cap at 500 to prevent abuse + memory blow-ups.
      var resp = nk.friendsList(
        userId,
        BLOCKED_LIST_HARD_LIMIT,
        STATE_BLOCKED as any,
        undefined as any
      );
      if (Array.isArray(resp as any)) rawList = resp as any;
      else if (resp && (resp as any).friends) rawList = (resp as any).friends;
    } catch (e: any) {
      if (logger && logger.error) {
        logger.error("[ListBlockedUsers] nk.friendsList failed: " + (e.message || String(e)));
      }
      return err("Failed to load blocked users", ERR_INTERNAL);
    }

    // Presence is conceptually meaningless for a "blocked" relationship,
    // but we still return it so the row prefab is identical to friends_list.
    // Cheap (one batched read) so worth the consistency.
    var ids: string[] = [];
    for (var i = 0; i < rawList.length; i++) {
      var u = rawList[i] && rawList[i].user;
      if (u && u.id) ids.push(u.id);
    }
    var onlineMap = loadOnlineMap(nk, ids);
    var countryMap = loadCountryMap(nk, logger, ids);

    var results: any[] = [];
    for (var j = 0; j < rawList.length; j++) {
      var fr = rawList[j];
      if (!fr || !fr.user || !fr.user.id) continue;
      // Force relationshipStatus to "blocked" — defensive normalisation in
      // case Nakama ever returns mixed-state results when filtering.
      var flat = flattenFriend(fr, !!onlineMap[fr.user.id], countryMap[fr.user.id] || "");
      flat.relationshipStatus = "blocked";
      flat.state              = STATE_BLOCKED;
      results.push(flat);
    }

    if (logger && logger.info) {
      logger.info("[ListBlockedUsers] user=" + userId + " returned=" + results.length);
    }

    return ok({
      results: results,
      count:   results.length
    });
  }

  // ── Public registration ────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("friends_list",        rpcFriendsList);
    // Phase-3 canonical aliases (doc Appendix C): same handlers, new ivx_
    // names. These keep the module's existing flat shape — the unified
    // envelope for this cluster ships when the module migrates natively
    // (its shape is already flat + presence-enriched, the Phase-4 target).
    initializer.registerRpc("ivx_social_friends_list", rpcFriendsList);
    initializer.registerRpc("list_blocked_users",  rpcListBlockedUsers);
    initializer.registerRpc("ivx_social_friends_blocked", rpcListBlockedUsers);
  }
}
