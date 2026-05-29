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

  try {
    var rows = nk.sqlQuery(
      "SELECT user_id, value FROM storage " +
      "WHERE collection = 'user_sessions' AND key = 'current' " +
      "AND update_time >= (CURRENT_TIMESTAMP - ($1::int * interval '1 day')) " +
      "ORDER BY update_time DESC LIMIT $2::int",
      [activeSinceDays, limit]
    );

    // Batch-read game_player_analytics docs (the per-user analytics
    // ring buffer maintained by analytics/player_analytics_store.js).
    // Earlier this read `analytics_events`/key=`events` per userId, but
    // current ingestion writes `dash_*` keys under SYSTEM_USER instead —
    // the legacy per-user shape is never created so cohort exports
    // always saw null events. GPA docs are keyed `gameId:userId` and
    // hold up to 500 most-recent events under `value.events`.
    //
    // Without a gameId hint we'd have to know every game the user has
    // played; instead, list ALL keys with prefix `*:user_id` and pick
    // the most recent doc. For the cohort export use case (any game
    // activity is fine), reading the union of every game's most recent
    // doc is the practical answer.
    var evMap = {};
    for (var i = 0; i < rows.length; i++) {
      var uid = rows[i].user_id;
      try {
        var listRes = nk.storageList(uid, 'game_player_analytics', 5, '');
        if (listRes && listRes.objects) {
          var combined = [];
          for (var lo = 0; lo < listRes.objects.length; lo++) {
            var v = listRes.objects[lo].value || {};
            if (v.events && v.events.length) {
              for (var ev = 0; ev < v.events.length; ev++) combined.push(v.events[ev]);
            }
          }
          if (combined.length) {
            // Sort newest-first; cap at 500 to keep payload bounded.
            combined.sort(function(a, b) { return (b.t || 0) - (a.t || 0); });
            if (combined.length > 500) combined.length = 500;
            evMap[uid] = combined;
          }
        }
      } catch (e) {
        logger.warn('[QeAnalytics] GPA list failed for ' + uid + ': ' + e);
      }
    }

    var cohort = [];
    for (var k = 0; k < rows.length; k++) {
      var uid = rows[k].user_id;
      var session = _qeParseMaybeJson(rows[k].value);
      var events = evMap[uid] || null;
      cohort.push({
        user_id: uid,
        session: _qeBuildConsentContext(nk, uid, session, events),
        events:  events
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

  // Read ALL game_player_analytics docs for this user (one per game)
  // and merge the per-game `events` rings into a single newest-first
  // list. See cohort-export comment above for why we list instead of
  // a direct storageRead — the legacy shape (key=`events`) was never
  // populated by the current ingestion path.
  try {
    var listRes = nk.storageList(userId, 'game_player_analytics', 10, '');
    if (listRes && listRes.objects && listRes.objects.length > 0) {
      var combined = [];
      for (var i = 0; i < listRes.objects.length; i++) {
        var v = listRes.objects[i].value || {};
        if (v.events && v.events.length) {
          for (var ev = 0; ev < v.events.length; ev++) combined.push(v.events[ev]);
        }
      }
      if (combined.length) {
        combined.sort(function(a, b) { return (b.t || 0) - (a.t || 0); });
        if (combined.length > 500) combined.length = 500;
        return JSON.stringify({
          events: combined,
          found: true,
          session: _qeBuildConsentContext(nk, userId, null, combined)
        });
      }
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
