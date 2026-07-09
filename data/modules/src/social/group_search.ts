// group_search.ts — server-side, gameId-filtered group discovery (doc §7.4).
//
// REPLACES the Unity client calling raw client.ListGroupsAsync, which cannot
// filter by metadata.gameId — the client currently downloads every game's
// groups and filters locally (bandwidth waste + cross-game leak, B-008's
// sibling on the discovery path).
//
// Single SQL query over Nakama's first-class `groups` table (NOT the storage
// table — groups have their own schema with a JSONB metadata column).
// Precedent for raw SQL in this runtime: find_friends.ts, insights-aggregator.
// Every group created via create_quizverse_group / create_game_group has
// metadata.gameId set (createGroupMetadata in groups/groups.js), so the
// strict filter matches all platform-created groups.
//
// Pagination: numeric offset cursor (opaque string to clients — doc §19.5:
// clients must never parse cursors).

namespace SocialGroupSearch {

  var MAX_LIMIT   = 50;
  var MAX_QUERY   = 64;

  function rpcGroupSearch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string {
    try {
      RpcHelpers.requireUserId(ctx);
      var data = RpcHelpers.parseRpcPayload(payload) || {};

      var gameId = (typeof data.gameId === "string" && data.gameId) ? data.gameId : "quizverse";
      var limit = (typeof data.limit === "number" && data.limit > 0) ? Math.min(Math.floor(data.limit), MAX_LIMIT) : 20;

      var offset = 0;
      if (typeof data.cursor === "string" && data.cursor) {
        var parsedOffset = parseInt(data.cursor, 10);
        if (!isNaN(parsedOffset) && parsedOffset > 0) offset = parsedOffset;
      }

      var query = "";
      if (typeof data.query === "string" && data.query.trim()) {
        query = data.query.trim().substring(0, MAX_QUERY);
      }

      // open-only filter (default true): closed groups are invite-only and
      // should not surface in public discovery unless explicitly requested.
      var openOnly = data.openOnly !== false;

      var rows: any[] = [];
      try {
        if (query) {
          // Escape ILIKE wildcards in user input, then wrap in %...%.
          var escaped = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
          rows = nk.sqlQuery(
            "SELECT id, name, description, avatar_url, edge_count, max_count, state, metadata " +
            "FROM groups " +
            "WHERE (metadata->>'gameId') = $1 " +
            "  AND ($2 = false OR state = 0) " +
            "  AND name ILIKE $3 " +
            "ORDER BY edge_count DESC, name ASC " +
            "LIMIT $4 OFFSET $5",
            [gameId, openOnly, "%" + escaped + "%", limit + 1, offset]
          ) as any[];
        } else {
          rows = nk.sqlQuery(
            "SELECT id, name, description, avatar_url, edge_count, max_count, state, metadata " +
            "FROM groups " +
            "WHERE (metadata->>'gameId') = $1 " +
            "  AND ($2 = false OR state = 0) " +
            "ORDER BY edge_count DESC, name ASC " +
            "LIMIT $3 OFFSET $4",
            [gameId, openOnly, limit + 1, offset]
          ) as any[];
        }
      } catch (sqlErr: any) {
        logger.error("[GroupSearch] SQL failed: " + (sqlErr && sqlErr.message));
        return RpcHelpers.errorResponse("Group search unavailable — try again");
      }

      if (!rows) rows = [];
      // We fetched limit+1 to detect whether another page exists.
      var hasMore = rows.length > limit;
      if (hasMore) rows = rows.slice(0, limit);

      var groups: any[] = [];
      for (var i = 0; i < rows.length; i++) {
        var r: any = rows[i];
        if (!r) continue;
        var meta: any = {};
        try { meta = (typeof r.metadata === "string") ? JSON.parse(r.metadata || "{}") : (r.metadata || {}); } catch (_) {}
        groups.push({
          id:          r.id,
          name:        r.name || "",
          description: r.description || "",
          avatarUrl:   r.avatar_url || "",
          memberCount: (typeof r.edge_count === "number") ? r.edge_count : parseInt(String(r.edge_count || 0), 10),
          maxCount:    (typeof r.max_count === "number") ? r.max_count : parseInt(String(r.max_count || 0), 10),
          open:        String(r.state) === "0",
          gameId:      meta.gameId || gameId,
          groupType:   meta.groupType || "",
          level:       (typeof meta.level === "number") ? meta.level : 1,
          xp:          (typeof meta.xp === "number") ? meta.xp : 0,
          trophies:    (typeof meta.trophies === "number") ? meta.trophies : 0,
          badge:       meta.badge || "",
          joinPolicy:  meta.joinPolicy || (String(r.state) === "0" ? "open" : "private")
        });
      }

      return RpcHelpers.successResponse({
        groups:     groups,
        count:      groups.length,
        nextCursor: hasMore ? String(offset + limit) : ""
      });
    } catch (e: any) {
      return RpcHelpers.errorResponse((e && e.message) || "Failed to search groups");
    }
  }

  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("ivx_social_group_search", rpcGroupSearch);
  }
}
