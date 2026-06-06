/**
 * quests_analytics_bridge.js
 *
 * Nakama RPCs that expose analytics and player-profile data for the
 * quests-economy NestJS API.  This replaces the direct SQL queries that
 * the NestJS side was running against Nakama's storage / users tables
 * through the wrong DataSource.
 *
 * RPCs registered:
 *   qe_player_full_profile  – single-user profile aggregate
 *   qe_stale_sessions       – batch: sessions inactive > N days
 *   qe_cohort_export        – batch: active sessions + events
 *   qe_user_event_summary   – single-user event ring-buffer
 */

// ─── helpers ─────────────────────────────────────────────────────

function _qeParseMaybeJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch (e) { return v; }
}

// nk.sqlQuery() returns the storage `value` column (JSON content) as a UTF-8
// BYTE ARRAY in the Goja runtime, not a string or parsed object. _qeParseMaybeJson
// would pass that array straight through, leaving callers with {0:123,1:34,...}
// instead of the event. _qeDecodeJson handles all three shapes: already-parsed
// object, JSON string, or UTF-8 byte array (decoded via the escape/decodeURIComponent
// trick so multi-byte content — e.g. non-Latin quiz text — survives intact).
function _qeDecodeJson(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  if (typeof v === 'object') {
    var looksLikeBytes = (typeof v.length === 'number') &&
      (v.length === 0 || typeof v[0] === 'number');
    if (!looksLikeBytes) return v;
    var bin = '';
    for (var i = 0; i < v.length; i++) bin += String.fromCharCode(v[i] & 0xff);
    var str;
    try { str = decodeURIComponent(escape(bin)); } catch (e) { str = bin; }
    try { return JSON.parse(str); } catch (e2) { return null; }
  }
  return null;
}

/**
 * Attach consent markers IVX-AI analytics-knowledge expects on cohort rows.
 * Reads user_metadata/analytics and scans recent events for consent_state.
 */
function _qeBuildConsentContext(nk, userId, session, events) {
  var out = session && typeof session === 'object' ? Object.assign({}, session) : {};

  try {
    var recs = nk.storageRead([
      { collection: 'user_metadata', key: 'analytics', userId: userId },
      { collection: 'user_metadata', key: 'profile', userId: userId }
    ]);
    for (var ri = 0; ri < recs.length; ri++) {
      var val = recs[ri].value || {};
      if (val.personalization_consent === true || val.analytics_consent === true) {
        out.personalization_consent = true;
        out.analytics_consent = true;
      }
      if (val.personalization_consent === false) out.personalization_consent = false;
      if (val.analytics_consent === false) out.analytics_consent = false;
      if (val.consent_state) out.consent_state = val.consent_state;
    }
  } catch (e) { /* non-fatal */ }

  var evList = Array.isArray(events) ? events : [];
  for (var i = 0; i < evList.length; i++) {
    var ev = evList[i] || {};
    var ed = ev.eventData || ev.data || ev;
    if (ed.consent_state) out.consent_state = ed.consent_state;
    if (ed.personalization_consent === true) out.personalization_consent = true;
    if (ed.personalization_consent === false) out.personalization_consent = false;
    if (ed.analytics_consent) out.analytics_consent = ed.analytics_consent;
  }

  if (out.consent_state === 'granted' || out.personalization_consent === true) {
    out.consent = {
      personalization_consent: true,
      analytics_consent: out.analytics_consent !== false
    };
  } else if (out.consent_state === 'denied' || out.personalization_consent === false) {
    out.consent = {
      personalization_consent: false,
      analytics_consent: false
    };
  }

  return out;
}

var _QE_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
var _QE_GPA_COLLECTION = "game_player_analytics";

/** Expand a GPA ring-buffer tuple {n,t,d} into a normalized analytics event. */
function _qeExpandGpaEvent(doc, ev) {
  var unixSec = parseInt(ev.t, 10) || 0;
  var ed = ev.d || {};
  return {
    eventName: String(ev.n || "unknown"),
    eventData: ed,
    userId: doc.user_id || "",
    gameId: doc.game_id || "",
    platform: doc.platform || "unknown",
    unixTimestamp: unixSec,
    timestamp: unixSec,
    sessionId: ed.session_id ? String(ed.session_id) : ""
  };
}

/**
 * O(1) read from game_player_analytics (per-player docs). Returns [] when
 * the user has no GPA doc; null when storage read failed (caller may SQL-fallback).
 */
function _qeLoadEventsFromGpa(nk, userId, activeSinceDays, maxEvents, gameId) {
  var cutoffSec = activeSinceDays > 0
    ? Math.floor(Date.now() / 1000) - (activeSinceDays * 86400)
    : 0;
  var docs = [];
  try {
    if (gameId) {
      var keyed = nk.storageRead([{
        collection: _QE_GPA_COLLECTION,
        key: gameId + ":" + userId,
        userId: userId
      }]);
      if (keyed && keyed.length > 0 && keyed[0].value) docs.push(keyed[0].value);
    } else {
      var cursor = "";
      var pages = 0;
      do {
        var page = nk.storageList(userId, _QE_GPA_COLLECTION, 25, cursor);
        if (!page || !page.objects || page.objects.length === 0) break;
        for (var pi = 0; pi < page.objects.length; pi++) {
          if (page.objects[pi].value) docs.push(page.objects[pi].value);
        }
        cursor = page.cursor || "";
        pages++;
      } while (cursor && pages < 20);
    }
  } catch (e) {
    return null;
  }

  var out = [];
  for (var di = 0; di < docs.length; di++) {
    var doc = docs[di] || {};
    var buf = doc.events || [];
    for (var ei = 0; ei < buf.length; ei++) {
      var expanded = _qeExpandGpaEvent(doc, buf[ei]);
      if (cutoffSec > 0 && expanded.unixTimestamp < cutoffSec) continue;
      out.push(expanded);
    }
  }
  out.sort(function (a, b) {
    return (b.unixTimestamp || 0) - (a.unixTimestamp || 0);
  });
  if (out.length > maxEvents) out = out.slice(0, maxEvents);
  return out;
}

/** Slow fallback: full-table scan on analytics_events JSON userId. */
function _qeLoadEventsFromAnalyticsSql(nk, userId, activeSinceDays, maxEvents) {
  var sql =
    "SELECT value FROM storage " +
    "WHERE collection = 'analytics_events' " +
    "AND value->>'userId' = $1 ";
  var params;
  if (activeSinceDays > 0) {
    sql += "AND update_time >= (CURRENT_TIMESTAMP - ($2::int * interval '1 day')) " +
           "ORDER BY update_time DESC LIMIT $3::int";
    params = [userId, activeSinceDays, maxEvents];
  } else {
    sql += "ORDER BY update_time DESC LIMIT $2::int";
    params = [userId, maxEvents];
  }
  var rows = nk.sqlQuery(sql, params);
  var events = [];
  for (var i = 0; i < rows.length; i++) {
    var parsed = _qeDecodeJson(rows[i].value);
    if (parsed) events.push(parsed);
  }
  return events;
}

/** Prefer GPA ring buffer; SQL-scan only when GPA is empty or unreadable. */
function _qeLoadEventsForUser(nk, logger, userId, activeSinceDays, maxEvents, gameId) {
  var fromGpa = _qeLoadEventsFromGpa(nk, userId, activeSinceDays, maxEvents, gameId);
  if (fromGpa !== null && fromGpa.length > 0) return fromGpa;
  try {
    return _qeLoadEventsFromAnalyticsSql(nk, userId, activeSinceDays, maxEvents);
  } catch (e) {
    if (logger && logger.warn) {
      logger.warn("[QeAnalytics] analytics_events SQL fallback failed for " +
        userId + ": " + (e.message || e));
    }
    return fromGpa || [];
  }
}

/** Active cohort from GPA (indexed user_id); falls back to analytics_events JSON scan. */
function _qeLoadActiveCohortUserIds(nk, logger, activeSinceDays, limit) {
  try {
    var gpaRows = nk.sqlQuery(
      "SELECT user_id::text AS uid, MAX(update_time) AS last_seen " +
      "FROM storage " +
      "WHERE collection = $1 " +
      "AND update_time >= (CURRENT_TIMESTAMP - ($2::int * interval '1 day')) " +
      "AND user_id IS NOT NULL " +
      "AND user_id <> $3 " +
      "GROUP BY user_id " +
      "ORDER BY last_seen DESC LIMIT $4::int",
      [_QE_GPA_COLLECTION, activeSinceDays, _QE_SYSTEM_USER_ID, limit]
    );
    if (gpaRows && gpaRows.length > 0) return gpaRows;
  } catch (eGpa) {
    if (logger && logger.warn) {
      logger.warn("[QeAnalytics] GPA cohort query failed, falling back: " +
        (eGpa.message || eGpa));
    }
  }
  return nk.sqlQuery(
    "SELECT value->>'userId' AS uid, MAX(update_time) AS last_seen " +
    "FROM storage " +
    "WHERE collection = 'analytics_events' " +
    "AND update_time >= (CURRENT_TIMESTAMP - ($1::int * interval '1 day')) " +
    "AND value->>'userId' IS NOT NULL " +
    "AND value->>'userId' <> '' " +
    "AND value->>'userId' <> $2 " +
    "GROUP BY value->>'userId' " +
    "ORDER BY last_seen DESC LIMIT $3::int",
    [activeSinceDays, _QE_SYSTEM_USER_ID, limit]
  );
}

// 2026-04 polish — return HTTP 400 (not generic 500) when callers send a
// malformed payload or omit a required field. Nakama's JS runtime expects
// the thrown `code` field to be a **gRPC status code** (0-16), NOT an HTTP
// status — anything outside the valid gRPC range falls through to UNKNOWN
// which the HTTP layer surfaces as 500. The other places in the bundle
// that throw `{code: 400, ...}` (e.g. quizverse_get_item_catalog) actually
// produce HTTP 500 too — they just happen to ship a "400" inside the JSON
// body, which is misleading. We use gRPC code 3 (INVALID_ARGUMENT) so the
// HTTP layer correctly returns 400 for missing/malformed input.
//
//   gRPC 3  = INVALID_ARGUMENT → HTTP 400  (this function)
//   gRPC 16 = UNAUTHENTICATED  → HTTP 401
//   gRPC 7  = PERMISSION_DENIED→ HTTP 403
//   gRPC 5  = NOT_FOUND        → HTTP 404
function _qeBadRequest(message) {
  return {
    code: 3, // gRPC INVALID_ARGUMENT → HTTP 400
    message: String(message || 'invalid request'),
    data: {}
  };
}

function _qeSafeParsePayload(payload) {
  // Empty / null payload is treated as `{}` so missing-field validation
  // below is the *only* thing that can trip the 400 — keeps behaviour
  // predictable for callers that omit the body entirely.
  if (payload === null || payload === undefined || payload === '') return {};
  try {
    var parsed = JSON.parse(payload);
    if (parsed && typeof parsed === 'object') return parsed;
    throw _qeBadRequest('payload must be a JSON object');
  } catch (e) {
    // Re-throw structured 400s as-is; wrap only raw SyntaxError from JSON.parse.
    if (e && typeof e === 'object' && e.code === 3) throw e;
    throw _qeBadRequest('payload is not valid JSON: ' + (e && e.message ? e.message : e));
  }
}

// ─── RPC: qe_player_full_profile ─────────────────────────────────

function rpcQePlayerFullProfile(ctx, logger, nk, payload) {
  var input = _qeSafeParsePayload(payload);
  var userId = input.user_id || '';
  if (!userId) {
    throw _qeBadRequest('user_id is required');
  }
  var gameId = input.game_id || input.gameId || '126bf539-dae2-4bcf-964d-316c0fa1f92b';

  var profile = {};
  var gameStats = {};
  var analytics = {};
  var questAnalytics = null;

  try {
    var records = nk.storageRead([
      { collection: 'user_metadata', key: 'profile',    userId: userId },
      { collection: 'user_metadata', key: 'game_stats', userId: userId },
      { collection: 'user_metadata', key: 'analytics',  userId: userId },
      { collection: 'quest_analytics', key: 'summary',  userId: userId }
    ]);

    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      if (rec.collection === 'user_metadata') {
        if (rec.key === 'profile')    profile    = rec.value || {};
        if (rec.key === 'game_stats') gameStats  = rec.value || {};
        if (rec.key === 'analytics')  analytics  = rec.value || {};
      }
      if (rec.collection === 'quest_analytics' && rec.key === 'summary') {
        questAnalytics = rec.value || null;
      }
    }
  } catch (e) {
    logger.warn('[QeAnalytics] storageRead failed for ' + userId + ': ' + e);
  }

  // GPA doc — primary source of truth for all live player KPIs.
  // Canonical key is {gameId}:{userId}; stored under the player's userId.
  var gpaDoc = null;
  try {
    var gpaKey = gameId + ':' + userId;
    var gpaRecs = nk.storageRead([{
      collection: _QE_GPA_COLLECTION, key: gpaKey, userId: userId
    }]);
    if (gpaRecs && gpaRecs.length > 0 && gpaRecs[0].value) {
      gpaDoc = gpaRecs[0].value;
    }
  } catch (eGpa) {
    logger.warn('[QeAnalytics] GPA read failed for ' + userId + ': ' + eGpa);
  }

  // When legacy user_metadata is empty, backfill from the GPA doc so callers
  // that key off profile.display_name / analytics.last_active_utc etc. still
  // get real data without needing a separate code change on their end.
  if (gpaDoc) {
    if (!profile.display_name && gpaDoc.display_name) profile.display_name = gpaDoc.display_name;
    if (!profile.avatar_url   && gpaDoc.avatar_url)   profile.avatar_url   = gpaDoc.avatar_url;
    if (!profile.platform     && gpaDoc.platform)     profile.platform     = gpaDoc.platform;
    if (!profile.country      && gpaDoc.country)      profile.country      = gpaDoc.country;
    if (!analytics.last_active_utc && gpaDoc.last_active_utc) analytics.last_active_utc = gpaDoc.last_active_utc;
    if (!analytics.first_seen_utc  && gpaDoc.first_seen_utc)  analytics.first_seen_utc  = gpaDoc.first_seen_utc;
    if (!analytics.lt_events       && gpaDoc.lt_events)       analytics.lt_events       = gpaDoc.lt_events;
    if (!analytics.lt_sessions     && gpaDoc.lt_sessions)     analytics.lt_sessions     = gpaDoc.lt_sessions;
    if (!analytics.lt_quiz_plays   && gpaDoc.lt_quiz_plays)   analytics.lt_quiz_plays   = gpaDoc.lt_quiz_plays;
    if (!gameStats.fav_mode        && gpaDoc.fav_mode)        gameStats.fav_mode        = gpaDoc.fav_mode;
    if (gameStats.fav_mode_n === undefined && gpaDoc.fav_mode_n) gameStats.fav_mode_n   = gpaDoc.fav_mode_n;
  }

  var userRow = null;
  try {
    var userRows = nk.sqlQuery(
      'SELECT id, username, display_name, lang_tag, location, timezone, ' +
      'metadata, wallet, create_time, update_time, edge_count ' +
      'FROM users WHERE id = $1 LIMIT 1',
      [userId]
    );
    if (userRows && userRows.length > 0) {
      userRow = userRows[0];
      if (userRow.metadata && typeof userRow.metadata === 'string') {
        try { userRow.metadata = JSON.parse(userRow.metadata); } catch (e2) { /* keep raw */ }
      }
    }
  } catch (e) {
    logger.warn('[QeAnalytics] users query failed: ' + e);
  }

  var leaderboardCount = 0;
  try {
    var lbRows = nk.sqlQuery(
      'SELECT COUNT(*)::int AS cnt FROM leaderboard_record WHERE owner_id = $1',
      [userId]
    );
    if (lbRows && lbRows.length > 0) {
      leaderboardCount = Number(lbRows[0].cnt) || 0;
    }
  } catch (e) {
    logger.warn('[QeAnalytics] leaderboard count query failed: ' + e);
  }

  return JSON.stringify({
    profile:           profile,
    game_stats:        gameStats,
    analytics:         analytics,
    quest_analytics:   questAnalytics,
    gpa:               gpaDoc,
    user:              userRow,
    leaderboard_count: leaderboardCount
  });
}

// ─── RPC: qe_stale_sessions ─────────────────────────────────────

function rpcQeStaleSessions(ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var inactiveDays = Number(input.inactive_days) || 3;
  var limit = Math.min(Number(input.limit) || 5000, 10000);

  try {
    var rows = nk.sqlQuery(
      "SELECT user_id, value FROM storage " +
      "WHERE collection = 'user_sessions' AND key = 'current' " +
      "AND update_time < (CURRENT_TIMESTAMP - ($1::int * interval '1 day')) " +
      "ORDER BY update_time ASC LIMIT $2::int",
      [inactiveDays, limit]
    );

    var results = [];
    for (var i = 0; i < rows.length; i++) {
      results.push({
        user_id: rows[i].user_id,
        session: _qeParseMaybeJson(rows[i].value)
      });
    }

    return JSON.stringify({ sessions: results, count: results.length });
  } catch (e) {
    logger.error('[QeAnalytics] qe_stale_sessions failed: ' + e);
    return JSON.stringify({ sessions: [], count: 0, error: String(e) });
  }
}

// ─── RPC: qe_cohort_export ──────────────────────────────────────

function rpcQeCohortExport(ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var activeSinceDays = Number(input.active_since_days) || 30;
  var limit = Math.min(Number(input.limit) || 500, 2000);
  var maxEventsPerUser = Math.min(Number(input.max_events_per_user) || 500, 1000);
  var gameId = input.game_id || input.gameId || null;

  try {
    // Step 1 — active learners (GPA fast path uses indexed storage.user_id).
    var userRows = _qeLoadActiveCohortUserIds(nk, logger, activeSinceDays, limit);

    var cohort = [];
    for (var k = 0; k < userRows.length; k++) {
      var uid = userRows[k].uid;
      if (!uid) continue;

      var events = [];
      try {
        events = _qeLoadEventsForUser(
          nk, logger, uid, activeSinceDays, maxEventsPerUser, gameId
        );
      } catch (eEv) {
        logger.warn('[QeAnalytics] event fetch failed for ' + uid + ': ' + eEv);
      }

      // Best-effort session doc — usually absent in prod, but surface it when
      // present so any consent metadata stored on the session is honoured.
      var session = null;
      try {
        var sRec = nk.storageRead([{ collection: 'user_sessions', key: 'current', userId: uid }]);
        if (sRec && sRec.length > 0 && sRec[0].value) session = sRec[0].value;
      } catch (eS) { /* session optional */ }

      var eventsOut = events.length ? events : null;
      cohort.push({
        user_id: uid,
        session: _qeBuildConsentContext(nk, uid, session, eventsOut),
        events:  eventsOut
      });
    }

    return JSON.stringify({ cohort: cohort, count: cohort.length });
  } catch (e) {
    logger.error('[QeAnalytics] qe_cohort_export failed: ' + e);
    return JSON.stringify({ cohort: [], count: 0, error: String(e) });
  }
}

// ─── RPC: qe_user_event_summary ─────────────────────────────────

function rpcQeUserEventSummary(ctx, logger, nk, payload) {
  var input = _qeSafeParsePayload(payload);
  var userId = input.user_id || '';
  if (!userId) {
    throw _qeBadRequest('user_id is required');
  }
  // Optional window (days); 0/absent = all-time. Bounded event cap.
  var activeSinceDays = Number(input.active_since_days) || 0;
  var maxEvents = Math.min(Number(input.limit) || 500, 1000);
  var gameId = input.game_id || input.gameId || null;

  try {
    var events = _qeLoadEventsForUser(
      nk, logger, userId, activeSinceDays, maxEvents, gameId
    );
    if (events.length) {
      return JSON.stringify({
        events: events,
        found: true,
        session: _qeBuildConsentContext(nk, userId, null, events)
      });
    }
  } catch (e) {
    logger.warn('[QeAnalytics] qe_user_event_summary failed for ' + userId + ': ' + e);
  }

  return JSON.stringify({ events: null, found: false });
}

// ─── Registration (postbuild picks up initializer.registerRpc) ──

function _QeAnalyticsBridgeInit(ctx, logger, nk, initializer) {
  logger.info('[QeAnalyticsBridge] Registering RPCs');
  initializer.registerRpc('qe_player_full_profile', rpcQePlayerFullProfile);
  initializer.registerRpc('qe_stale_sessions',      rpcQeStaleSessions);
  initializer.registerRpc('qe_cohort_export',        rpcQeCohortExport);
  initializer.registerRpc('qe_user_event_summary',   rpcQeUserEventSummary);
  logger.info('[QeAnalyticsBridge] 4 RPCs registered');
}
