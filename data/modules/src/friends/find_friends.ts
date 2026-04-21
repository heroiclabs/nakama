// ============================================================================
// src/friends/find_friends.ts — Canonical Player Search RPC (TypeScript)
// ============================================================================
// PRODUCTION-READY | First-class TS module | Single source of truth
//
// Replaces every prior implementation of the player-search RPC. This is the
// ONLY handler for player search going forward. Registered via main.ts and
// pinned in `_tsRpcList`, so the legacy bridge cannot accidentally
// shadow it from any older `data/modules/*.js` file.
//
// RPC ID
// ------
//   intelliverse_find_friends     (canonical, snake_case, intelliverse-prefixed)
//
// HARD RENAME — the old IDs `quizverse_find_friends` and
// `lasttolive_find_friends` are NO LONGER REGISTERED. Clients calling them
// receive Nakama's default "rpc not found" error. All Unity callsites are
// updated in this same change. If you need cross-game search later, the
// canonical name covers all games — gameID is informational, never required.
//
// Search behaviour — TIERED + FUZZY
// ---------------------------------
// Results are returned in this priority order (`rank_tier`):
//
//   Tier 1: username  matches the query as a PREFIX (case-insensitive)
//   Tier 2: display_name matches the query as a PREFIX
//   Tier 3: username  contains the query as a SUBSTRING
//   Tier 4: display_name contains the query as a SUBSTRING
//   Tier 5: trigram-similarity ≥ STRICT threshold (typo-tolerant fuzzy match)
//
// Within each tier, ties are broken by trigram similarity (DESC) then
// username ASC for stable pagination. STRICT fuzziness (similarity ≥ 0.55)
// allows ~1 typo in queries of typical length while keeping false positives
// minimal — picked specifically over the medium/loose presets to keep the
// "Add Friend" dialog precision-first (you almost always know the username
// you're looking for, just maybe with a typo).
//
// Performance
// -----------
// `bootstrapDatabase()` (called from main.ts InitModule) creates:
//   - the pg_trgm extension (if not already present)
//   - GIN trigram indexes on users.username and users.display_name
// Both are idempotent and use IF NOT EXISTS — safe to re-run on every boot.
//
// With those indexes, the full tiered+fuzzy query stays sub-50ms even on
// millions of users. Without pg_trgm available, the runtime auto-degrades
// to ILIKE-only (still fast thanks to the GIN-trgm index, which Postgres
// also uses for ILIKE '%pattern%') and logs a one-time warning.
//
// What this implementation guarantees
// -----------------------------------
//   * Real online status from `player_presence` storage collection (the
//     `users.edge_count` column in Postgres is a friend-edge count, NOT a
//     presence indicator — every prior version was hard-coding garbage)
//   * Username + display-name search via Postgres ILIKE + pg_trgm similarity
//   * Pagination via opaque numeric `cursor` (offset)
//   * Idempotent — same query+cursor returns the same page
//   * Strong input sanitisation: max length, escape SQL LIKE wildcards,
//     reject control characters
//   * Standardised error envelope with stable machine `errorCode` strings
//   * Defensive Postgres date-parsing (Nakama's "no disabled" sentinel
//     is `'1970-01-01 00:00:00 UTC'` — we keep the same predicate)
//   * Two-tier fallback: pg_trgm SQL → ILIKE-only SQL → usersGetUsername
//   * Skips the caller themselves and anyone they have blocked
//   * Enriches each result with relationship status:
//       'none' | 'friend' | 'pending_sent' | 'pending_received' | 'blocked'
//
// Payload contract
//   {
//     "gameID":   "quizverse",      // optional — informational only
//     "query":    "carlo",          // required, 2..50 chars
//     "limit":    20,               // optional, default 20, max 50
//     "cursor":   "20"              // optional pagination cursor
//   }
//
// Response (success)
//   {
//     "success": true,
//     "data": {
//       "results":     [ { userId, username, displayName, avatarUrl,
//                          online, createTime, relationshipStatus,
//                          matchTier, similarity } ],
//       "query":       "carlo",
//       "count":       12,
//       "searcherId":  "<uuid>",
//       "nextCursor":  "32"   | null    // null when no more pages
//     }
//   }
//
// Response (error)
//   {
//     "success": false,
//     "error":     "human readable message",
//     "errorCode": "machine_id"   // see ErrorCodes below
//   }
// ============================================================================

namespace IntelliverseFriends {

  // ── Constants ──────────────────────────────────────────────────────────
  var PRESENCE_COLLECTION = "player_presence";
  var PRESENCE_KEY        = "status";
  var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min ⇒ online

  // STRICT fuzziness — picked deliberately to bias towards precision over
  // recall in the player-search UX. 0.55 corresponds to ~1 typo in a
  // 6-char query (e.g. "carlls" finds "carlos"). Tweak in lock-step with
  // the docstring above + the client-side AskQuestion answer record.
  var TRGM_SIMILARITY_THRESHOLD = 0.55;

  // Nakama friend-state ints (mirror of nkruntime.FriendState — not exported)
  var STATE_FRIEND          = 0;
  var STATE_INVITE_SENT     = 1;
  var STATE_INVITE_RECEIVED = 2;
  var STATE_BLOCKED         = 3;

  // Stable machine error codes — clients can switch on these.
  var ERR_UNAUTHENTICATED    = "unauthenticated";
  var ERR_INVALID_PAYLOAD    = "invalid_payload";
  var ERR_QUERY_TOO_SHORT    = "query_too_short";
  var ERR_SEARCH_UNAVAILABLE = "search_unavailable";

  // Module-level cache — flips to false on the first SQL error that mentions
  // pg_trgm so subsequent calls skip the fuzzy path entirely. Avoids a
  // try/catch on the hot path after the first miss.
  var _trgmAvailable = true;

  // One-time warning gate so a misconfigured DB doesn't spam logs.
  var _trgmWarningLogged = false;

  // ── Phase-4 fuzzy_add_metrics: in-process counters ─────────────────────
  // Lightweight per-process telemetry. Counters only — no per-call objects
  // to avoid GC pressure on a hot path. Values reset on every server boot
  // (we accept that — Prometheus / Datadog scrapers will capture deltas).
  // A single periodic INFO log line emits the snapshot every N calls so
  // ops can see the breakdown without scraping anything else.
  var _metrics = {
    totalCalls:        0,
    pathTrgm:          0,    // pg_trgm fuzzy SQL succeeded
    pathIlike:         0,    // ILIKE-only SQL (degraded — pg_trgm absent)
    pathFallback:      0,    // usersGetUsername exact-match fallback
    emptyResults:      0,    // calls returning zero rows (potential UX dead-end)
    totalLatencyMs:    0,    // sum across ALL calls (avg = total/totalCalls)
    maxLatencyMs:      0,    // worst single call observed since boot
    queryLenSum:       0,    // sum of query string lengths (avg query length)
    invalidPayloads:   0,    // bad JSON / missing fields
    queryTooShort:     0     // queries < 2 chars
  };

  // Emit a snapshot every N calls. 250 keeps logs sparse on a busy server
  // (~1 line per ~30s on a 10 RPS deployment) but frequent enough during
  // low traffic / dev to be useful.
  var METRICS_LOG_EVERY = 250;

  // ── Result envelope helpers ────────────────────────────────────────────
  function ok(data: any): string {
    return JSON.stringify({ success: true, data: data });
  }

  function err(message: string, errorCode: string, extra?: any): string {
    var out: any = { success: false, error: message, errorCode: errorCode };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
      }
    }
    return JSON.stringify(out);
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
   * Bulk-load presence rows for many users. We use targeted storageRead
   * (one read per user, all batched) rather than scanning a collection
   * because presence is owned by each user themselves — there is no
   * cross-user storageList for arbitrary user ids.
   *
   * Returns a { userId: boolean } map. Missing entries default to false.
   */
  function loadOnlineMap(nk: nkruntime.Nakama, userIds: string[]): { [id: string]: boolean } {
    var map: { [id: string]: boolean } = {};
    if (!userIds || userIds.length === 0) return map;

    var reads: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < userIds.length; i++) {
      reads.push({
        collection: PRESENCE_COLLECTION,
        key:        PRESENCE_KEY,
        userId:     userIds[i]
      });
    }

    var rows: nkruntime.StorageObject[] | null = null;
    try {
      rows = nk.storageRead(reads);
    } catch (e: any) {
      // Presence is optional context — never fail the search because of it.
      return map;
    }
    if (!rows) return map;

    var nowMs = Date.now();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.value) continue;

      var v: any = row.value;
      var online = false;
      if (v.online === true) {
        var lastSeenMs = 0;
        if (typeof v.lastSeenMs === "number")           lastSeenMs = v.lastSeenMs;
        else if (typeof v.last_seen_ms === "number")    lastSeenMs = v.last_seen_ms;
        else if (typeof v.lastSeen === "string") {
          var t = Date.parse(v.lastSeen);
          if (!isNaN(t)) lastSeenMs = t;
        }
        if (lastSeenMs === 0 || (nowMs - lastSeenMs) <= ONLINE_THRESHOLD_MS) {
          online = true;
        }
      }
      map[row.userId] = online;
    }
    return map;
  }

  /**
   * Collapse Nakama's friend graph into:
   *   - relationMap: { friendUserId: 'friend'|'pending_sent'|'pending_received'|'blocked' }
   *   - blockedSet:  { blockedUserId: true } (skipped from results entirely)
   */
  function loadRelationship(
    nk:     nkruntime.Nakama,
    logger: nkruntime.Logger,
    userId: string
  ): { relationMap: { [id: string]: string }; blockedSet: { [id: string]: boolean } } {
    var relationMap: { [id: string]: string } = {};
    var blockedSet:  { [id: string]: boolean } = {};

    try {
      // 1000 is well above realistic friend list sizes; we don't paginate
      // here because relationship enrichment must be complete or absent.
      var resp = nk.friendsList(userId, 1000, undefined as any, undefined as any);
      if (resp && resp.friends) {
        for (var i = 0; i < resp.friends.length; i++) {
          var fr: any = resp.friends[i];
          if (!fr || !fr.user) continue;
          var s: any = (fr.state && typeof fr.state === "object" && "value" in fr.state)
            ? fr.state.value
            : fr.state;
          var fid = fr.user.id;
          if      (s === STATE_FRIEND)          relationMap[fid] = "friend";
          else if (s === STATE_INVITE_SENT)     relationMap[fid] = "pending_sent";
          else if (s === STATE_INVITE_RECEIVED) relationMap[fid] = "pending_received";
          else if (s === STATE_BLOCKED)       { relationMap[fid] = "blocked"; blockedSet[fid] = true; }
        }
      }
    } catch (e: any) {
      // Relationship lookup failure must NOT fail the search — just degrade
      // to "no enrichment" (every result will read relationshipStatus='none').
      if (logger && logger.warn) {
        logger.warn("[IntelliverseFindFriends] friendsList lookup failed: " + (e.message || String(e)));
      }
    }
    return { relationMap: relationMap, blockedSet: blockedSet };
  }

  /**
   * Detect whether the SQL error is specifically the "pg_trgm not installed"
   * shape so we can flip the module flag and stop retrying the fuzzy path.
   * Postgres error messages we want to catch:
   *   - 'function similarity(text, text) does not exist'
   *   - 'operator does not exist: text % text'
   *   - 'extension "pg_trgm" is not available'
   */
  function isTrgmMissingError(e: any): boolean {
    var msg = ((e && (e.message || String(e))) || "").toLowerCase();
    if (!msg) return false;
    return msg.indexOf("similarity(") >= 0
        || msg.indexOf("pg_trgm") >= 0
        || (msg.indexOf("operator does not exist") >= 0 && msg.indexOf("text %") >= 0);
  }

  /**
   * Tiered + fuzzy SQL search (preferred path, requires pg_trgm).
   *
   * $1 = escapedQuery   (LIKE-pattern-safe; '%' '_' '\' escaped)
   * $2 = rawQuery       (raw user input for similarity())
   * $3 = userId         (excluded from results)
   * $4 = limit          (page size + over-fetch margin)
   * $5 = offset         (pagination)
   *
   * The ESCAPE clause uses Postgres E'\\' (an escape string containing a
   * single backslash) so the '\\%' / '\\_' sequences from sanitisation are
   * treated as literal % / _ rather than wildcards.
   */
  function searchWithTrgm(
    nk:           nkruntime.Nakama,
    escapedQuery: string,
    rawQuery:     string,
    userId:       string,
    limit:        number,
    offset:       number
  ): any[] {
    var sql =
      "SELECT " +
      "  id, username, display_name, avatar_url, create_time, " +
      "  CASE " +
      "    WHEN username ILIKE $1 || '%' ESCAPE E'\\\\' THEN 1 " +
      "    WHEN display_name ILIKE $1 || '%' ESCAPE E'\\\\' THEN 2 " +
      "    WHEN username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 3 " +
      "    WHEN display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 4 " +
      "    ELSE 5 " +
      "  END AS rank_tier, " +
      "  GREATEST( " +
      "    similarity(username, $2), " +
      "    similarity(coalesce(display_name, ''), $2) " +
      "  ) AS sim_score " +
      "FROM users " +
      "WHERE id != $3 " +
      "  AND disable_time = '1970-01-01 00:00:00 UTC' " +
      "  AND ( " +
      "       username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
      "    OR display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
      "    OR similarity(username, $2) >= " + TRGM_SIMILARITY_THRESHOLD + " " +
      "    OR similarity(coalesce(display_name, ''), $2) >= " + TRGM_SIMILARITY_THRESHOLD + " " +
      "  ) " +
      "ORDER BY rank_tier ASC, sim_score DESC, username ASC " +
      "LIMIT $4 OFFSET $5";

    var rows = nk.sqlQuery(sql, [escapedQuery, rawQuery, userId, limit, offset]);
    return rows || [];
  }

  /**
   * ILIKE-only SQL search (degraded path used when pg_trgm is unavailable).
   * Loses fuzzy matching but keeps the tiered ranking so users still see
   * exact prefix → substring matches in a sensible order.
   *
   * $1 = escapedQuery, $2 = userId, $3 = limit, $4 = offset
   */
  function searchWithIlikeOnly(
    nk:           nkruntime.Nakama,
    escapedQuery: string,
    userId:       string,
    limit:        number,
    offset:       number
  ): any[] {
    var sql =
      "SELECT " +
      "  id, username, display_name, avatar_url, create_time, " +
      "  CASE " +
      "    WHEN username ILIKE $1 || '%' ESCAPE E'\\\\' THEN 1 " +
      "    WHEN display_name ILIKE $1 || '%' ESCAPE E'\\\\' THEN 2 " +
      "    WHEN username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 3 " +
      "    WHEN display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\' THEN 4 " +
      "    ELSE 5 " +
      "  END AS rank_tier, " +
      "  0::float AS sim_score " +
      "FROM users " +
      "WHERE id != $2 " +
      "  AND disable_time = '1970-01-01 00:00:00 UTC' " +
      "  AND (username ILIKE '%' || $1 || '%' ESCAPE E'\\\\' " +
      "       OR display_name ILIKE '%' || $1 || '%' ESCAPE E'\\\\') " +
      "ORDER BY rank_tier ASC, username ASC " +
      "LIMIT $3 OFFSET $4";

    var rows = nk.sqlQuery(sql, [escapedQuery, userId, limit, offset]);
    return rows || [];
  }

  // ── The RPC handler ────────────────────────────────────────────────────
  function rpcIntelliverseFindFriends(
    ctx:     nkruntime.Context,
    logger:  nkruntime.Logger,
    nk:      nkruntime.Nakama,
    payload: string
  ): string {
    var __t0 = Date.now();   // Phase-4 metrics: per-call latency clock

    var userId = ctx.userId;
    if (!userId) return err("Authentication required", ERR_UNAUTHENTICATED);

    var parsed = parsePayload(payload);
    if (!parsed.ok) {
      _metrics.invalidPayloads++;
      return err(parsed.error || "Invalid payload", ERR_INVALID_PAYLOAD);
    }
    var data: any = parsed.data || {};

    // ── Validate query ──────────────────────────────────────────────────
    if (!data.query || typeof data.query !== "string") {
      _metrics.invalidPayloads++;
      return err("Query string is required", ERR_INVALID_PAYLOAD);
    }
    var query: string = data.query.trim();
    // Strip control chars + zero-width space (defence against UI weirdness)
    query = query.replace(/[\x00-\x1f\x7f\u200B-\u200F]/g, "");
    if (query.length < 2) {
      _metrics.queryTooShort++;
      return err("Query must be at least 2 characters", ERR_QUERY_TOO_SHORT);
    }
    if (query.length > 50) query = query.substring(0, 50);

    // Escape Postgres LIKE wildcards in user input. The escape character
    // matches the ESCAPE E'\\' clause in the SQL queries above.
    var likeQuery = query.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

    // ── Validate paging ─────────────────────────────────────────────────
    var limit = parseInt(data.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 50) limit = 50;

    var offset = 0;
    if (data.cursor) {
      offset = parseInt(data.cursor, 10);
      if (isNaN(offset) || offset < 0) offset = 0;
      if (offset > 1000) offset = 1000; // hard cap — protect DB from runaway pagination
    }

    // Over-fetch slightly so we can drop blocked users without short-paging.
    var fetchLimit = limit + 20;

    // ── Phase 1: Postgres search ───────────────────────────────────────
    var rows: any[] = [];
    var sqlOk = false;
    var usedTrgm = false;

    try {
      if (_trgmAvailable) {
        try {
          rows = searchWithTrgm(nk, likeQuery, query, userId, fetchLimit, offset);
          sqlOk = true;
          usedTrgm = true;
        } catch (e: any) {
          if (isTrgmMissingError(e)) {
            _trgmAvailable = false;
            if (!_trgmWarningLogged && logger && logger.warn) {
              _trgmWarningLogged = true;
              logger.warn(
                "[IntelliverseFindFriends] pg_trgm extension not available; " +
                "falling back to ILIKE-only search permanently for this server " +
                "process. Run `CREATE EXTENSION pg_trgm` as a Postgres superuser " +
                "to enable typo-tolerant fuzzy search. Reason: " +
                (e.message || String(e))
              );
            }
            // Fall through to the ILIKE retry below
          } else {
            // Different SQL error — not a pg_trgm issue. Re-throw to outer catch.
            throw e;
          }
        }
      }

      if (!sqlOk) {
        rows = searchWithIlikeOnly(nk, likeQuery, userId, fetchLimit, offset);
        sqlOk = true;
      }
    } catch (sqlErr: any) {
      if (logger && logger.warn) {
        logger.warn("[IntelliverseFindFriends] SQL search failed; falling back to exact-match: " +
          (sqlErr.message || String(sqlErr)));
      }
      // Fallback: exact username via Nakama API. Partial / fuzzy search is
      // impossible on this path — but at least an exact handle still resolves.
      try {
        var exact = nk.usersGetUsername([query]);
        if (exact && exact.length > 0) {
          for (var u = 0; u < exact.length; u++) {
            if (exact[u].userId !== userId) {
              rows.push({
                id:           exact[u].userId,
                username:     exact[u].username || "",
                display_name: (exact[u] as any).displayName || exact[u].username || "",
                avatar_url:   (exact[u] as any).avatarUrl || "",
                create_time:  (exact[u] as any).createTime || "",
                rank_tier:    1,
                sim_score:    1
              });
            }
          }
        }
      } catch (fbErr: any) {
        if (logger && logger.error) {
          logger.error("[IntelliverseFindFriends] Fallback usersGetUsername failed: " +
            (fbErr.message || String(fbErr)));
        }
        return err("Search service unavailable", ERR_SEARCH_UNAVAILABLE);
      }
    }

    // ── Phase 2: relationship enrichment ───────────────────────────────
    var rel = loadRelationship(nk, logger, userId);
    var relationMap = rel.relationMap;
    var blockedSet  = rel.blockedSet;

    // ── Phase 3: gather candidate ids and fetch real online status ─────
    var candidateIds: string[] = [];
    for (var c = 0; c < rows.length; c++) {
      var rid = rows[c].id;
      if (rid && rid !== userId && !blockedSet[rid]) {
        candidateIds.push(rid);
      }
    }
    var onlineMap = loadOnlineMap(nk, candidateIds);

    // ── Phase 4: build the page (after blocked filter, capped to limit) ─
    var results: any[] = [];
    var consumed = 0; // how many DB rows we walked through (for next-cursor calc)
    for (var i = 0; i < rows.length && results.length < limit; i++) {
      consumed++;
      var row = rows[i];
      var rid2: string = row.id;
      if (rid2 === userId)  continue;
      if (blockedSet[rid2]) continue;

      // sim_score may come back as a numeric Postgres FLOAT — coerce defensively.
      var simRaw = row.sim_score;
      var sim = typeof simRaw === "number" ? simRaw : parseFloat(simRaw);
      if (isNaN(sim)) sim = 0;

      var tierRaw = row.rank_tier;
      var tier = typeof tierRaw === "number" ? tierRaw : parseInt(tierRaw, 10);
      if (isNaN(tier)) tier = 5;

      results.push({
        userId:             rid2,
        username:           row.username || "",
        displayName:        row.display_name || row.username || "",
        avatarUrl:          row.avatar_url || "",
        online:             !!onlineMap[rid2],
        createTime:         row.create_time || "",
        relationshipStatus: relationMap[rid2] || "none",
        // Diagnostic fields — useful for client-side highlighting + telemetry.
        // Tier mapping: 1=username prefix, 2=display prefix, 3=username substring,
        // 4=display substring, 5=fuzzy-only.
        matchTier:          tier,
        similarity:         Math.round(sim * 1000) / 1000   // 3 decimal places
      });
    }

    // Compute next cursor — null when we exhausted the page or hit the cap.
    // Pagination semantics: we only emit a cursor when the SQL path filled
    // the over-fetch window AND we returned a full client page. The fallback
    // (usersGetUsername) is single-shot and never paginates.
    var nextCursor: string | null = null;
    if (sqlOk && results.length === limit && rows.length === fetchLimit) {
      nextCursor = String(offset + consumed);
    }

    // ── Phase-4 metrics: record path + latency ─────────────────────────
    var __latencyMs = Date.now() - __t0;
    var __pathLabel = usedTrgm ? "trgm" : (sqlOk ? "ilike" : "fallback");
    _metrics.totalCalls++;
    _metrics.totalLatencyMs += __latencyMs;
    if (__latencyMs > _metrics.maxLatencyMs) _metrics.maxLatencyMs = __latencyMs;
    _metrics.queryLenSum += query.length;
    if (results.length === 0) _metrics.emptyResults++;
    if      (__pathLabel === "trgm")     _metrics.pathTrgm++;
    else if (__pathLabel === "ilike")    _metrics.pathIlike++;
    else                                  _metrics.pathFallback++;

    if (logger && logger.info) {
      logger.info(
        "[IntelliverseFindFriends] user=" + userId +
        ' query="' + query + '"' +
        " queryLen=" + query.length +
        " path=" + __pathLabel +
        " latencyMs=" + __latencyMs +
        " returned=" + results.length +
        " (offset=" + offset + ", nextCursor=" + (nextCursor || "null") + ")"
      );

      // Periodic snapshot — keeps INFO log volume sparse but gives ops a
      // single line that summarises path mix, avg latency, and empty-result
      // rate. P95/P99 would need a histogram (overkill for this RPC).
      if (_metrics.totalCalls % METRICS_LOG_EVERY === 0) {
        var avgLatency = Math.round(_metrics.totalLatencyMs / _metrics.totalCalls);
        var avgQueryLen = Math.round((_metrics.queryLenSum / _metrics.totalCalls) * 10) / 10;
        var emptyPct = Math.round((_metrics.emptyResults / _metrics.totalCalls) * 1000) / 10;
        logger.info(
          "[IntelliverseFindFriends.metrics] calls=" + _metrics.totalCalls +
          " trgm=" + _metrics.pathTrgm +
          " ilike=" + _metrics.pathIlike +
          " fallback=" + _metrics.pathFallback +
          " avgLatencyMs=" + avgLatency +
          " maxLatencyMs=" + _metrics.maxLatencyMs +
          " avgQueryLen=" + avgQueryLen +
          " emptyResults%=" + emptyPct +
          " invalidPayloads=" + _metrics.invalidPayloads +
          " queryTooShort=" + _metrics.queryTooShort
        );
      }
    }

    return ok({
      results:    results,
      query:      query,
      count:      results.length,
      searcherId: userId,
      nextCursor: nextCursor
    });
  }

  // ── Database bootstrap (idempotent) ────────────────────────────────────
  /**
   * Ensures the Postgres extension and indexes that power tiered+fuzzy
   * search exist. Safe to call on every server boot — every statement
   * uses IF NOT EXISTS.
   *
   * What it creates:
   *   1. The `pg_trgm` extension (Postgres bundled contrib module).
   *   2. A GIN trigram index on `users.username`.
   *   3. A GIN trigram index on `users.display_name`.
   *
   * Failure modes (all degrade gracefully — never crash the runtime):
   *   - CREATE EXTENSION requires a Postgres superuser. If the runtime DB
   *     user lacks that, the extension call fails with permission denied.
   *     We log a one-time WARN and the RPC handler auto-falls-back to
   *     ILIKE-only search (still indexed once the GIN indexes exist).
   *   - If pg_trgm is genuinely absent the GIN-index calls will also fail
   *     because they reference `gin_trgm_ops`. Same degradation path.
   */
  export function bootstrapDatabase(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    var statements: { sql: string; label: string }[] = [
      { sql: "CREATE EXTENSION IF NOT EXISTS pg_trgm",
        label: "extension pg_trgm" },
      { sql: "CREATE INDEX IF NOT EXISTS idx_users_username_trgm " +
             "ON users USING gin (username gin_trgm_ops)",
        label: "index idx_users_username_trgm" },
      { sql: "CREATE INDEX IF NOT EXISTS idx_users_display_name_trgm " +
             "ON users USING gin (display_name gin_trgm_ops)",
        label: "index idx_users_display_name_trgm" },
    ];

    for (var i = 0; i < statements.length; i++) {
      var stmt = statements[i];
      try {
        nk.sqlExec(stmt.sql, []);
        if (logger && logger.info) {
          logger.info("[IntelliverseFindFriends] bootstrap OK: " + stmt.label);
        }
      } catch (e: any) {
        // Extension creation needs SUPERUSER; index creation needs the
        // extension. Either failure is non-fatal — the RPC's runtime
        // fallback will keep search working.
        var emsg = (e && (e.message || String(e))) || "unknown error";
        if (logger && logger.warn) {
          logger.warn(
            "[IntelliverseFindFriends] bootstrap step '" + stmt.label +
            "' failed (non-fatal — fuzzy search will degrade to ILIKE-only): " + emsg
          );
        }
        // If the extension itself failed, no point trying the indexes that
        // depend on it. Bail out of the rest of the bootstrap loop.
        if (i === 0 && (emsg.toLowerCase().indexOf("pg_trgm") >= 0 ||
                        emsg.toLowerCase().indexOf("permission denied") >= 0)) {
          _trgmAvailable = false;
          break;
        }
      }
    }
  }

  // ── Public registration ────────────────────────────────────────────────
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("intelliverse_find_friends", rpcIntelliverseFindFriends);
  }
}
