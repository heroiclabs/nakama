// ============================================================================
// src/friends/find_nearby_players.ts — "People Near You" suggestions RPC
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// RPC ID
// ------
//   intelliverse_find_nearby_players   (canonical, snake_case)
//
// Purpose
// -------
// Powers the "People Near You" friend-suggestion strip on the Social Zone
// FRIENDS tab. Returns a short list of *other* players in the SAME COUNTRY
// as the caller who are NOT already friends, NOT blocked (either way), and
// NOT the caller themselves — so the user always sees fresh, actionable
// "add friend" candidates without typing a search query.
//
// Country source
// --------------
// The caller's country is resolved via the shared GeoTier cache
// (geo_tier/resolved), which the platform already populates from the
// client IP on first contact. GeoTier.resolveUserCountry() is cache-first
// and only hits the IP-API on a cold miss, so this stays cheap on the hot
// path. We also opportunistically backfill the caller's
// users.metadata.country so the candidate SQL (which filters on
// metadata->>'country') gains coverage over time. This mirrors how
// hiro/leaderboards already filters players by metadata.country.
//
// Candidate selection
// -------------------
//   * users.metadata->>'country' = caller country (case-insensitive)
//   * exclude self, disabled accounts, and anyone in the caller's friend
//     graph (friends, pending either direction, blocked)
//   * newest accounts first (create_time DESC) so suggestions feel fresh;
//     ties broken by id for stable pagination
//   * enriched with real presence (player_presence/status) + a constant
//     relationshipStatus of "none" (we filtered everything else out)
//
// Graceful degradation
// ---------------------
// If the caller's country cannot be resolved (no IP / IP-API failure),
// we return an empty list with reason="no_geo" rather than erroring — the
// client simply hides the strip. Any SQL failure also degrades to an empty
// list (reason="unavailable"); suggestions are best-effort, never fatal.
//
// Payload contract
//   {
//     "gameID": "quizverse",   // optional — informational only
//     "limit":  10,            // optional, default 10, max 30
//     "cursor": "10"           // optional pagination offset
//   }
//
// Response (success)
//   {
//     "success": true,
//     "data": {
//       "results":    [ { userId, username, displayName, avatarUrl,
//                         online, createTime, relationshipStatus,
//                         country } ],
//       "country":    "US",
//       "count":      8,
//       "searcherId": "<uuid>",
//       "nextCursor": "20" | null,
//       "reason":     "ok" | "no_geo" | "unavailable"
//     }
//   }
// ============================================================================

namespace IntelliverseNearbyPlayers {

  // ── Constants ──────────────────────────────────────────────────────────
  var PRESENCE_COLLECTION = "player_presence";
  var PRESENCE_KEY        = "status";
  var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min => online

  // Nakama friend-state ints (mirror of nkruntime.FriendState — not exported)
  var STATE_FRIEND          = 0;
  var STATE_INVITE_SENT     = 1;
  var STATE_INVITE_RECEIVED = 2;
  var STATE_BLOCKED         = 3;

  var DEFAULT_LIMIT = 10;
  var MAX_LIMIT     = 30;
  var MAX_OFFSET    = 1000; // hard cap — protect DB from runaway pagination

  // ── Result envelope helpers ────────────────────────────────────────────
  function ok(data: any): string {
    return JSON.stringify({ success: true, data: data });
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
   * Bulk-load presence for many users via batched targeted storageRead.
   * Returns a { userId: boolean } map; missing entries default to false.
   * Presence is best-effort context — never fails the suggestion query.
   */
  // B-004 fix (2026-07-06): canonical implementation lives in
  // FriendsPresenceShared (presence_shared.ts). This wrapper keeps every
  // call site unchanged while eliminating the triple copy-paste.
  function loadOnlineMap(nk: nkruntime.Nakama, userIds: string[]): { [id: string]: boolean } {
    return FriendsPresenceShared.loadOnlineMap(nk, userIds);
  }

  /**
   * Build a set of every userId the caller already has a relationship with
   * (friend / pending either direction / blocked). These are all excluded
   * from suggestions — "People Near You" only surfaces brand-new faces.
   */
  function loadExcludedSet(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): { [id: string]: boolean } {
    var excluded: { [id: string]: boolean } = {};
    try {
      var resp = nk.friendsList(userId, 1000, undefined as any, undefined as any);
      if (resp && resp.friends) {
        for (var i = 0; i < resp.friends.length; i++) {
          var fr: any = resp.friends[i];
          if (!fr || !fr.user) continue;
          var s: any = (fr.state && typeof fr.state === "object" && "value" in fr.state)
            ? fr.state.value
            : fr.state;
          if (s === STATE_FRIEND || s === STATE_INVITE_SENT ||
              s === STATE_INVITE_RECEIVED || s === STATE_BLOCKED) {
            excluded[fr.user.id] = true;
          }
        }
      }
    } catch (e: any) {
      // Degrade to "no exclusions" — worst case the user sees an existing
      // friend in suggestions, which the client-side row renderer still
      // labels correctly (relationshipStatus is recomputed on tap).
      if (logger && logger.warn) {
        logger.warn("[IntelliverseNearbyPlayers] friendsList lookup failed: " + (e.message || String(e)));
      }
    }
    return excluded;
  }

  /**
   * Opportunistically persist the caller's resolved country into their
   * Nakama account metadata (users.metadata.country) so the candidate SQL
   * — which filters on metadata->>'country' — gains coverage over time.
   * No-op when metadata.country already matches. Never fatal.
   */
  function backfillMetadataCountry(
    nk:      nkruntime.Nakama,
    logger:  nkruntime.Logger,
    userId:  string,
    country: string
  ): void {
    if (!country) return;
    try {
      var accounts = nk.accountsGetId([userId]);
      if (!accounts || accounts.length === 0) return;
      var acct: any = accounts[0];
      var meta: any = (acct.user && acct.user.metadata) ? acct.user.metadata : {};
      if (meta && typeof meta.country === "string" && meta.country.toUpperCase() === country) {
        return; // already up to date
      }
      meta.country = country;
      // Signature: accountUpdateId(userId, username, displayName, timezone,
      //                            location, langTag, avatarUrl, metadata)
      nk.accountUpdateId(userId, null, null, null, null, null, null, meta);
    } catch (e: any) {
      if (logger && logger.warn) {
        logger.warn("[IntelliverseNearbyPlayers] metadata.country backfill failed: " + (e.message || String(e)));
      }
    }
  }

  /**
   * Same-country candidate query.
   *   $1 = country (alpha-2, upper-cased)
   *   $2 = userId  (excluded)
   *   $3 = limit   (page size + over-fetch margin)
   *   $4 = offset  (pagination)
   *
   * Filters on the JSONB users.metadata->>'country'. disable_time sentinel
   * '1970-01-01 00:00:00 UTC' is Nakama's "not disabled" marker. Newest
   * accounts first so suggestions feel fresh; id tie-break keeps paging
   * stable.
   */
  function queryNearby(
    nk:      nkruntime.Nakama,
    country: string,
    userId:  string,
    limit:   number,
    offset:  number
  ): any[] {
    var sql =
      "SELECT id, username, display_name, avatar_url, create_time " +
      "FROM users " +
      "WHERE id != $2 " +
      "  AND disable_time = '1970-01-01 00:00:00 UTC' " +
      "  AND upper(metadata->>'country') = $1 " +
      "ORDER BY create_time DESC, id ASC " +
      "LIMIT $3 OFFSET $4";
    var rows = nk.sqlQuery(sql, [country, userId, limit, offset]);
    return rows || [];
  }

  // ── The RPC handler ────────────────────────────────────────────────────
  function rpcFindNearbyPlayers(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var userId = ctx.userId;
    if (!userId) {
      return JSON.stringify({ success: false, error: "Authentication required", errorCode: "unauthenticated" });
    }

    var parsed = parsePayload(payload);
    var data: any = (parsed.ok && parsed.data) ? parsed.data : {};

    // ── Paging ──────────────────────────────────────────────────────────
    var limit = parseInt(data.limit, 10);
    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    var offset = 0;
    if (data.cursor) {
      offset = parseInt(data.cursor, 10);
      if (isNaN(offset) || offset < 0) offset = 0;
      if (offset > MAX_OFFSET) offset = MAX_OFFSET;
    }

    // ── Resolve caller country (cache-first, IP-API on cold miss) ────────
    var country = "";
    try {
      country = GeoTier.resolveUserCountry(ctx, logger, nk, userId) || "";
    } catch (e: any) {
      country = "";
    }
    if (!country) {
      return ok({ results: [], country: "", count: 0, searcherId: userId, nextCursor: null, reason: "no_geo" });
    }
    country = country.toUpperCase();

    // Opportunistic backfill so the SQL filter covers this user next time.
    backfillMetadataCountry(nk, logger, userId, country);

    // Over-fetch so we can drop already-related users without short-paging.
    var fetchLimit = limit + 30;

    // ── Query candidates ────────────────────────────────────────────────
    var rows: any[] = [];
    try {
      rows = queryNearby(nk, country, userId, fetchLimit, offset);
    } catch (sqlErr: any) {
      if (logger && logger.warn) {
        logger.warn("[IntelliverseNearbyPlayers] SQL failed: " + (sqlErr.message || String(sqlErr)));
      }
      return ok({ results: [], country: country, count: 0, searcherId: userId, nextCursor: null, reason: "unavailable" });
    }

    // ── Exclude existing relationships ──────────────────────────────────
    var excluded = loadExcludedSet(nk, logger, userId);

    var candidateIds: string[] = [];
    for (var c = 0; c < rows.length; c++) {
      var rid = rows[c].id;
      if (rid && rid !== userId && !excluded[rid]) candidateIds.push(rid);
    }
    var onlineMap = loadOnlineMap(nk, candidateIds);

    // ── Build page ──────────────────────────────────────────────────────
    var results: any[] = [];
    var consumed = 0;
    for (var i = 0; i < rows.length && results.length < limit; i++) {
      consumed++;
      var row = rows[i];
      var rid2: string = row.id;
      if (rid2 === userId)  continue;
      if (excluded[rid2])   continue;

      results.push({
        userId:             rid2,
        username:           row.username || "",
        displayName:        row.display_name || row.username || "",
        avatarUrl:          row.avatar_url || "",
        online:             !!onlineMap[rid2],
        createTime:         row.create_time || "",
        relationshipStatus: "none",
        country:            country
      });
    }

    var nextCursor: string | null = null;
    if (results.length === limit && rows.length === fetchLimit) {
      nextCursor = String(offset + consumed);
    }

    if (logger && logger.info) {
      logger.info(
        "[IntelliverseNearbyPlayers] user=" + userId +
        " country=" + country +
        " returned=" + results.length +
        " (offset=" + offset + ", nextCursor=" + (nextCursor || "null") + ")"
      );
    }

    return ok({
      results:    results,
      country:    country,
      count:      results.length,
      searcherId: userId,
      nextCursor: nextCursor,
      reason:     "ok"
    });
  }

  // ── Public registration ────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("intelliverse_find_nearby_players", rpcFindNearbyPlayers);
    initializer.registerRpc("ivx_social_friend_nearby", rpcFindNearbyPlayers); // Phase-3 alias (doc Appendix C)
  }
}
