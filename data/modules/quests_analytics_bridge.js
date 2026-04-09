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

// ─── RPC: qe_player_full_profile ─────────────────────────────────

function rpcQePlayerFullProfile(ctx, logger, nk, payload) {
  var input = JSON.parse(payload);
  var userId = input.user_id || '';
  if (!userId) {
    throw Error('user_id is required');
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

    // Batch-read analytics_events for every returned user in one call
    var readRequests = [];
    for (var i = 0; i < rows.length; i++) {
      readRequests.push({
        collection: 'analytics_events',
        key:        'events',
        userId:     rows[i].user_id
      });
    }

    var evMap = {};
    if (readRequests.length > 0) {
      try {
        var evRecords = nk.storageRead(readRequests);
        for (var j = 0; j < evRecords.length; j++) {
          evMap[evRecords[j].userId] = evRecords[j].value;
        }
      } catch (e) {
        logger.warn('[QeAnalytics] batch event read failed: ' + e);
      }
    }

    var cohort = [];
    for (var k = 0; k < rows.length; k++) {
      var uid = rows[k].user_id;
      cohort.push({
        user_id: uid,
        session: _qeParseMaybeJson(rows[k].value),
        events:  evMap[uid] || null
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
  var input = JSON.parse(payload);
  var userId = input.user_id || '';
  if (!userId) {
    throw Error('user_id is required');
  }

  try {
    var records = nk.storageRead([
      { collection: 'analytics_events', key: 'events', userId: userId }
    ]);

    if (records && records.length > 0 && records[0].value) {
      return JSON.stringify({ events: records[0].value, found: true });
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
