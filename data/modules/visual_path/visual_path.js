// ============================================================================
// visual_path.js — Visual Path / Milestone System
// ============================================================================
// PRODUCTION-READY | ES5 (Goja runtime)
//
// Implements the server side of PLAN-ENGAGEMENT_SYSTEM_02_VISUAL_PATH:
//
//   visual_path_get_state
//       -> per-user progress: currentDay, currentMilestoneId, completedMilestoneIds,
//          lastVisitDay, totalPlayDays
//
//   visual_path_get_schedule
//       -> the milestone catalog. Reads from system storage
//          (collection=visual_path_config, key=schedule_v1, userId=00000…).
//          If no record exists yet, returns the seeded default schedule so
//          the client never sees an empty list. Includes a `version` field
//          for client cache invalidation.
//
//   visual_path_skip_day_with_ad
//       -> rewarded-ad path: caller spends a watched ad (client claims they
//          watched; trust boundary = SDK-level ad token, validated upstream)
//          to advance currentDay by 1. Rate-limited: max 1 per day, max 5
//          per 30-day window.
//
// Storage:
//   visual_path/state_<userId>            — per-user state (perm 1/0)
//   visual_path_config/schedule_v1        — system-level schedule (perm 2/0)
//   visual_path/skip_log_<userId>         — rate-limit ledger (perm 0/0)
//
// SECURITY: every mutation is authenticated. The schedule write path is NOT
// exposed as an RPC — admin must seed the row directly via the Nakama
// console / a separate admin-guarded endpoint.
// ============================================================================

var VP_STATE_COLLECTION  = 'visual_path';
var VP_CONFIG_COLLECTION = 'visual_path_config';
var VP_CONFIG_KEY        = 'schedule_v1';
var VP_SYSTEM_USER_ID    = '00000000-0000-0000-0000-000000000000';
var VP_SKIP_LOG_KEY_PFX  = 'skip_log_';
var VP_SKIPS_PER_30D     = 5;

// Default schedule — used when no admin-seeded row exists yet so the client
// always has a milestone list to render. Mirrors the client-side hardcoded
// list (PLAN-02 §V1) but lets us roll new milestones server-side without a
// client deploy.
var VP_DEFAULT_SCHEDULE = {
    version: '1.0.0',
    milestones: [
        { id: 'first_steps',    name: 'First Steps',     description: 'Complete your first quiz',                          dayRequired: 1,  iconCdnPath: 'milestones/first_steps.png' },
        { id: 'three_day',      name: '3-Day Streak',    description: 'Play 3 days in a row',                              dayRequired: 3,  iconCdnPath: 'milestones/three_day.png' },
        { id: 'week_warrior',   name: 'Week Warrior',    description: 'Play 7 days in a row',                              dayRequired: 7,  iconCdnPath: 'milestones/week_warrior.png' },
        { id: 'two_weeks',      name: 'Two Weeks Strong',description: 'Play 14 days in a row',                             dayRequired: 14, iconCdnPath: 'milestones/two_weeks.png' },
        { id: 'monthly',        name: 'Monthly Master',  description: 'Play 30 days in a row',
          dayRequired: 30, iconCdnPath: 'milestones/monthly.png' },
        { id: 'sixty_days',     name: 'Two Months',      description: 'Play 60 days in a row',                             dayRequired: 60, iconCdnPath: 'milestones/sixty_days.png' },
        { id: 'hundred_days',   name: 'Centurion',       description: 'Play 100 days in a row',                            dayRequired: 100,iconCdnPath: 'milestones/hundred_days.png' },
        { id: 'half_year',      name: 'Half Year Hero',  description: 'Play 180 days in a row',                            dayRequired: 180,iconCdnPath: 'milestones/half_year.png' },
        { id: 'year',           name: 'Year-Long Legend',description: 'Play 365 days in a row',                            dayRequired: 365,iconCdnPath: 'milestones/year.png' }
    ]
};

// ─── Tiny helpers ───────────────────────────────────────────────────────────

function _vpNowIso() { return new Date().toISOString(); }
function _vpTodayKey() { return _vpNowIso().slice(0, 10); }

function _vpOk(extra) {
    var out = { success: true };
    if (extra) {
        for (var k in extra) {
            if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
        }
    }
    return JSON.stringify(out);
}

function _vpErr(message, errorCode) {
    return JSON.stringify({
        success: false,
        error: message,
        errorCode: errorCode || 'unknown'
    });
}

function _vpParse(payload) {
    if (!payload || payload === '') return { ok: true, data: {} };
    try { return { ok: true, data: JSON.parse(payload) }; }
    catch (e) { return { ok: false, error: 'Invalid JSON: ' + e.message }; }
}

function _vpReadState(nk, logger, userId) {
    try {
        var rows = nk.storageRead([{
            collection: VP_STATE_COLLECTION,
            key: 'state_' + userId,
            userId: userId
        }]);
        if (rows && rows.length > 0 && rows[0].value) return rows[0].value;
    } catch (err) {
        if (logger && logger.warn) logger.warn('[VisualPath] state read failed: ' + err.message);
    }
    return null;
}

function _vpWriteState(nk, logger, userId, state) {
    try {
        nk.storageWrite([{
            collection: VP_STATE_COLLECTION,
            key: 'state_' + userId,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        if (logger && logger.error) logger.error('[VisualPath] state write failed: ' + err.message);
        return false;
    }
}

function _vpInitState() {
    var now = _vpNowIso();
    return {
        currentDay:            1,
        totalPlayDays:         1,
        lastVisitDay:          _vpTodayKey(),
        currentMilestoneId:    'first_steps',
        completedMilestoneIds: [],
        skipsUsed:             [],
        createdAt:             now,
        updatedAt:             now
    };
}

function _vpReadSchedule(nk, logger) {
    try {
        var rows = nk.storageRead([{
            collection: VP_CONFIG_COLLECTION,
            key:        VP_CONFIG_KEY,
            userId:     VP_SYSTEM_USER_ID
        }]);
        if (rows && rows.length > 0 && rows[0].value && rows[0].value.milestones) {
            return rows[0].value;
        }
    } catch (err) {
        if (logger && logger.warn) logger.warn('[VisualPath] schedule read failed: ' + err.message);
    }
    return VP_DEFAULT_SCHEDULE;
}

// Given currentDay + schedule, recomputes currentMilestoneId and the list of
// completedMilestoneIds. Pure function — no side-effects.
function _vpRecomputeMilestone(state, schedule) {
    var done = [];
    var current = null;
    for (var i = 0; i < schedule.milestones.length; i++) {
        var m = schedule.milestones[i];
        if ((state.currentDay || 1) >= (m.dayRequired || 1)) {
            done.push(m.id);
            current = m.id;
        } else {
            if (!current) current = m.id; // first not-yet-reached
            break;
        }
    }
    state.completedMilestoneIds = done;
    state.currentMilestoneId    = current || (schedule.milestones.length > 0 ? schedule.milestones[0].id : null);
    return state;
}

// ============================================================================
// RPC: visual_path_get_state
// ============================================================================
function rpcVisualPathGetState(ctx, logger, nk, payload) {
    if (!ctx.userId) return _vpErr('Authentication required', 'unauthenticated');

    var schedule = _vpReadSchedule(nk, logger);
    var state    = _vpReadState(nk, logger, ctx.userId);
    var isNew    = false;

    if (!state) {
        state = _vpInitState();
        isNew = true;
    } else {
        // Increment day-counter when a new calendar day is detected
        var today = _vpTodayKey();
        if (state.lastVisitDay !== today) {
            // If the visit was yesterday, advance currentDay by 1 (streak continues).
            // If the gap is >1 day, currentDay still advances by 1 — calendar-day
            // count, not "consecutive" — to align with client semantics in
            // PLAN-02 §V1 which uses totalPlayDays as the milestone driver.
            state.currentDay   = (state.currentDay || 1) + 1;
            state.totalPlayDays = (state.totalPlayDays || 1) + 1;
            state.lastVisitDay = today;
        }
    }

    state = _vpRecomputeMilestone(state, schedule);
    state.updatedAt = _vpNowIso();
    _vpWriteState(nk, logger, ctx.userId, state);

    // Find the next-milestone object for the client to render the "X days
    // until next milestone" UI.
    var nextMilestone = null;
    for (var i = 0; i < schedule.milestones.length; i++) {
        var m = schedule.milestones[i];
        if ((m.dayRequired || 1) > (state.currentDay || 1)) { nextMilestone = m; break; }
    }

    return _vpOk({
        currentDay:            state.currentDay,
        totalPlayDays:         state.totalPlayDays,
        lastVisitDay:          state.lastVisitDay,
        currentMilestoneId:    state.currentMilestoneId,
        completedMilestoneIds: state.completedMilestoneIds,
        nextMilestone:         nextMilestone,
        scheduleVersion:       schedule.version || '1.0.0',
        isNewUser:             isNew,
        timestamp:             _vpNowIso()
    });
}

// ============================================================================
// RPC: visual_path_get_schedule
// ============================================================================
//
// Payload: { knownVersion?: <string> }
//
// If `knownVersion` matches the server schedule version, returns
// `{ success: true, unchanged: true, version }` so the client can skip the
// full milestone list (cheap cache-validation round-trip).
function rpcVisualPathGetSchedule(ctx, logger, nk, payload) {
    var p = _vpParse(payload);
    if (!p.ok) return _vpErr(p.error, 'invalid_payload');
    var knownVersion = (p.data || {}).knownVersion;

    var schedule = _vpReadSchedule(nk, logger);

    if (knownVersion && schedule.version && knownVersion === schedule.version) {
        return _vpOk({
            unchanged: true,
            version:   schedule.version,
            timestamp: _vpNowIso()
        });
    }

    return _vpOk({
        version:    schedule.version || '1.0.0',
        milestones: schedule.milestones || [],
        unchanged:  false,
        timestamp:  _vpNowIso()
    });
}

// ============================================================================
// RPC: visual_path_skip_day_with_ad
// ============================================================================
//
// Lets a player advance currentDay by 1 in exchange for a watched rewarded
// ad. Rate-limited:
//   - max 1 skip per calendar day
//   - max VP_SKIPS_PER_30D (5) skips in any rolling 30-day window
//
// Payload: { adImpressionId?: <string> }   // SDK-level token; logged for audit
//
// We trust the client's "ad watched" claim because the upstream ad-SDK uses
// signed callbacks; storing the impressionId lets us correlate with the
// ad-network reconciliation pipeline if abuse is suspected later.
function rpcVisualPathSkipDayWithAd(ctx, logger, nk, payload) {
    if (!ctx.userId) return _vpErr('Authentication required', 'unauthenticated');

    var p = _vpParse(payload);
    if (!p.ok) return _vpErr(p.error, 'invalid_payload');
    var data = p.data || {};
    var impressionId = data.adImpressionId || '';

    var schedule = _vpReadSchedule(nk, logger);
    var state    = _vpReadState(nk, logger, ctx.userId) || _vpInitState();
    var today    = _vpTodayKey();

    if (!state.skipsUsed) state.skipsUsed = [];

    // Daily cap: refuse if already skipped today
    for (var i = 0; i < state.skipsUsed.length; i++) {
        if (state.skipsUsed[i].day === today) {
            return _vpErr('Already used your daily skip', 'daily_skip_used',
                          { skippedAt: state.skipsUsed[i].at });
        }
    }

    // 30-day cap: count skips in trailing 30 days
    var nowMs = Date.now();
    var freshSkips = [];
    for (var j = 0; j < state.skipsUsed.length; j++) {
        var sk = state.skipsUsed[j];
        var ms = new Date(sk.at).getTime();
        if ((nowMs - ms) < (30 * 86400000)) freshSkips.push(sk);
    }
    if (freshSkips.length >= VP_SKIPS_PER_30D) {
        return _vpErr('30-day skip limit reached (' + VP_SKIPS_PER_30D + ')',
                      'monthly_skip_limit', { freshSkipsCount: freshSkips.length });
    }

    // Apply skip
    state.currentDay    = (state.currentDay || 1) + 1;
    state.totalPlayDays = (state.totalPlayDays || 1) + 1;
    state.lastVisitDay  = today;
    state.skipsUsed     = freshSkips.concat([{
        day: today,
        at: _vpNowIso(),
        impressionId: impressionId
    }]);

    state = _vpRecomputeMilestone(state, schedule);
    state.updatedAt = _vpNowIso();
    if (!_vpWriteState(nk, logger, ctx.userId, state)) {
        return _vpErr('Failed to persist skip', 'storage_write_failed');
    }

    if (logger && logger.info) {
        logger.info('[VisualPath] skip_day_with_ad user=' + ctx.userId +
                    ' day=' + state.currentDay +
                    ' impressionId=' + impressionId);
    }

    return _vpOk({
        currentDay:            state.currentDay,
        totalPlayDays:         state.totalPlayDays,
        currentMilestoneId:    state.currentMilestoneId,
        completedMilestoneIds: state.completedMilestoneIds,
        skipsUsedThisMonth:    state.skipsUsed.length,
        skipsRemainingThisMonth: Math.max(0, VP_SKIPS_PER_30D - state.skipsUsed.length),
        timestamp:             _vpNowIso()
    });
}

// ============================================================================
// Module Init — register Visual Path RPCs
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('visual_path_get_state',        rpcVisualPathGetState);
    initializer.registerRpc('visual_path_get_schedule',     rpcVisualPathGetSchedule);
    initializer.registerRpc('visual_path_skip_day_with_ad', rpcVisualPathSkipDayWithAd);
    if (logger && logger.info) {
        logger.info('[VisualPath] Registered 3 RPCs (get_state, get_schedule, skip_day_with_ad)');
    }
}
