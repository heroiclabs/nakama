#!/usr/bin/env node
// =============================================================================
// async_challenge_state_machine_test.js
// =============================================================================
// Pure-function tests for asyncChallengeTransitionState.
// Run with:  node data/modules/tests/async_challenge_state_machine_test.js
//
// These tests have ZERO external dependencies (no Nakama runtime, no DB).
// They validate every state transition the server accepts or rejects.
// If you add a new event or status, add its tests here first (TDD).
//
// NOTE: The shebang above causes the postbuild bundler to skip this file
// (same as leagues/league_season_cron.js). Do NOT remove it.
// =============================================================================

// ── Inline the constants and state machine so this file is self-contained ────

var ASYNC_STATUS_WAITING         = 0;
var ASYNC_STATUS_OPPONENT_JOINED = 1;
var ASYNC_STATUS_BOTH_COMPLETED  = 2;
var ASYNC_STATUS_EXPIRED         = 3;
var ASYNC_STATUS_CANCELLED       = 4;
var ASYNC_STATUS_CREATOR_PLAYED  = 5;

var AC_EVT_JOIN            = 'JOIN';
var AC_EVT_CREATOR_SUBMIT  = 'CREATOR_SUBMIT';
var AC_EVT_OPPONENT_SUBMIT = 'OPPONENT_SUBMIT';
var AC_EVT_CANCEL          = 'CANCEL';

function asyncChallengeTransitionState(session, event, data) {
    var now = Date.now();
    var status = typeof session.status === 'number' ? session.status : 0;
    var userId = data.userId;

    if (status === ASYNC_STATUS_CANCELLED)
        return { ok: false, errorCode: 'TERMINAL', error: 'This challenge has been cancelled.' };
    if (status === ASYNC_STATUS_EXPIRED)
        return { ok: false, errorCode: 'TERMINAL', error: 'This challenge has expired.' };
    if (status === ASYNC_STATUS_BOTH_COMPLETED) {
        if (event !== AC_EVT_CREATOR_SUBMIT && event !== AC_EVT_OPPONENT_SUBMIT && event !== AC_EVT_CANCEL)
            return { ok: false, errorCode: 'TERMINAL', error: 'Challenge is already completed.' };
    }

    if (status !== ASYNC_STATUS_BOTH_COMPLETED && now > session.expiresAt) {
        session.status = ASYNC_STATUS_EXPIRED;
        return { ok: false, errorCode: 'EXPIRED', error: 'This challenge has expired.' };
    }

    switch (event) {
        case AC_EVT_JOIN: {
            if (session.creatorId === userId)
                return { ok: false, errorCode: 'SELF_JOIN', error: 'You cannot join your own challenge.' };
            if (session.opponentId === userId)
                return { ok: true, session: session, errorCode: 'ALREADY_JOINED', error: null, shouldProcessRewards: false };
            if (session.opponentId !== null)
                return { ok: false, errorCode: 'ALREADY_FULL', error: 'Challenge already has an opponent.' };
            if (session.challengedUserId && session.challengedUserId !== userId)
                return { ok: false, errorCode: 'WRONG_PLAYER', error: 'This challenge is for a specific player.' };
            if (status !== ASYNC_STATUS_WAITING && status !== ASYNC_STATUS_CREATOR_PLAYED)
                return { ok: false, errorCode: 'INVALID_STATE', error: 'Cannot join in current state.' };

            session.opponentId   = userId;
            session.opponentName = data.displayName || 'Player B';
            if (status !== ASYNC_STATUS_CREATOR_PLAYED) session.status = ASYNC_STATUS_OPPONENT_JOINED;
            return { ok: true, session: session, errorCode: null, error: null, shouldProcessRewards: false };
        }
        case AC_EVT_CREATOR_SUBMIT: {
            if (session.creatorId !== userId)
                return { ok: false, errorCode: 'NOT_PARTICIPANT', error: 'Not authorized.' };
            if (session.creatorCompleted)
                return { ok: true, session: session, errorCode: 'ALREADY_SUBMITTED', error: null, shouldProcessRewards: false };

            session.creatorCompleted = true; session.creatorScore = data.score;
            session.creatorCorrectAnswers = data.correctAnswers; session.creatorTotalQuestions = data.totalQuestions;
            session.creatorTimeTaken = data.timeTaken; session.creatorCompletedAt = now;

            var cR = false;
            if (session.opponentCompleted) {
                session.status = ASYNC_STATUS_BOTH_COMPLETED;
                if (!session.rewardsProcessed) { session.rewardsProcessed = true; cR = true; }
            } else if (!session.opponentId) {
                session.status = ASYNC_STATUS_CREATOR_PLAYED;
            }
            return { ok: true, session: session, errorCode: null, error: null, shouldProcessRewards: cR };
        }
        case AC_EVT_OPPONENT_SUBMIT: {
            if (session.opponentId !== userId)
                return { ok: false, errorCode: 'NOT_PARTICIPANT', error: 'Not authorized.' };
            if (session.opponentCompleted)
                return { ok: true, session: session, errorCode: 'ALREADY_SUBMITTED', error: null, shouldProcessRewards: false };

            session.opponentCompleted = true; session.opponentScore = data.score;
            session.opponentCorrectAnswers = data.correctAnswers; session.opponentTotalQuestions = data.totalQuestions;
            session.opponentTimeTaken = data.timeTaken; session.opponentCompletedAt = now;

            var oR = false;
            if (session.creatorCompleted) {
                session.status = ASYNC_STATUS_BOTH_COMPLETED;
                if (!session.rewardsProcessed) { session.rewardsProcessed = true; oR = true; }
            }
            return { ok: true, session: session, errorCode: null, error: null, shouldProcessRewards: oR };
        }
        case AC_EVT_CANCEL: {
            if (session.creatorId !== userId)
                return { ok: false, errorCode: 'NOT_CREATOR', error: 'Only the creator can cancel.' };
            if (status === ASYNC_STATUS_BOTH_COMPLETED)
                return { ok: false, errorCode: 'ALREADY_COMPLETED', error: 'Cannot cancel completed challenge.' };
            session.status = ASYNC_STATUS_CANCELLED;
            return { ok: true, session: session, errorCode: null, error: null, shouldProcessRewards: false };
        }
        default:
            return { ok: false, errorCode: 'UNKNOWN_EVENT', error: 'Unknown event: ' + event };
    }
}

// ── Test harness ──────────────────────────────────────────────────────────────

var passed = 0, failed = 0;
function assert(description, actual, expected) {
    if (actual === expected) {
        console.log('  ✓ ' + description);
        passed++;
    } else {
        console.error('  ✗ ' + description + ' — expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(actual));
        failed++;
    }
}

function makeSession(overrides) {
    return Object.assign({
        sessionId: 'sess-1', shareCode: '123456',
        creatorId: 'user-creator', opponentId: null,
        challengedUserId: null,
        status: ASYNC_STATUS_WAITING,
        expiresAt: Date.now() + 1000 * 60 * 60 * 24, // 24h from now
        creatorCompleted: false, creatorScore: 0, creatorCorrectAnswers: 0, creatorTotalQuestions: 0, creatorTimeTaken: 0,
        opponentCompleted: false, opponentScore: 0, opponentCorrectAnswers: 0, opponentTotalQuestions: 0, opponentTimeTaken: 0,
        rewardsProcessed: false
    }, overrides || {});
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== JOIN transitions ===');

(function() {
    var s = makeSession();
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-opponent', displayName: 'OpponentName' });
    assert('WAITING → OPPONENT_JOINED on valid join', r.ok, true);
    assert('status becomes OPPONENT_JOINED', r.session.status, ASYNC_STATUS_OPPONENT_JOINED);
    assert('opponentId set', r.session.opponentId, 'user-opponent');
    assert('no rewards on join', r.shouldProcessRewards, false);
})();

(function() {
    var s = makeSession();
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-creator' });
    assert('Creator cannot join own challenge', r.ok, false);
    assert('errorCode=SELF_JOIN', r.errorCode, 'SELF_JOIN');
})();

(function() {
    var s = makeSession({ opponentId: 'user-other' });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-third' });
    assert('Full room rejects new joiner', r.ok, false);
    assert('errorCode=ALREADY_FULL', r.errorCode, 'ALREADY_FULL');
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent' });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-opponent' });
    assert('Same user re-joining is idempotent ok', r.ok, true);
    assert('errorCode=ALREADY_JOINED', r.errorCode, 'ALREADY_JOINED');
})();

(function() {
    var s = makeSession({ challengedUserId: 'user-alice' });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-bob' });
    assert('Wrong player in targeted challenge rejected', r.ok, false);
    assert('errorCode=WRONG_PLAYER', r.errorCode, 'WRONG_PLAYER');
})();

(function() {
    var s = makeSession({ status: ASYNC_STATUS_CREATOR_PLAYED });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-opponent' });
    assert('Can join CREATOR_PLAYED session', r.ok, true);
    assert('Status stays CREATOR_PLAYED after join', r.session.status, ASYNC_STATUS_CREATOR_PLAYED);
})();

(function() {
    var s = makeSession({ status: ASYNC_STATUS_CANCELLED });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-opponent' });
    assert('Cannot join cancelled session', r.ok, false);
    assert('errorCode=TERMINAL', r.errorCode, 'TERMINAL');
})();

(function() {
    var s = makeSession({ expiresAt: Date.now() - 1000 });
    var r = asyncChallengeTransitionState(s, AC_EVT_JOIN, { userId: 'user-opponent' });
    assert('Cannot join expired session', r.ok, false);
    assert('errorCode=EXPIRED', r.errorCode, 'EXPIRED');
})();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== CREATOR_SUBMIT transitions ===');

(function() {
    var s = makeSession();
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 900, correctAnswers: 9, totalQuestions: 10, timeTaken: 45 });
    assert('WAITING creator submit → CREATOR_PLAYED (no opponent)', r.ok, true);
    assert('status=CREATOR_PLAYED when no opponent', r.session.status, ASYNC_STATUS_CREATOR_PLAYED);
    assert('creatorCompleted=true', r.session.creatorCompleted, true);
    assert('score recorded', r.session.creatorScore, 900);
    assert('no rewards yet (no opponent)', r.shouldProcessRewards, false);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED });
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 800, correctAnswers: 8, totalQuestions: 10, timeTaken: 50 });
    assert('OPPONENT_JOINED creator submit → status stays OPPONENT_JOINED', r.session.status, ASYNC_STATUS_OPPONENT_JOINED);
    assert('No rewards until opponent submits', r.shouldProcessRewards, false);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED, opponentCompleted: true, opponentScore: 700 });
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 800, correctAnswers: 8, totalQuestions: 10, timeTaken: 50 });
    assert('Both completed → BOTH_COMPLETED status', r.session.status, ASYNC_STATUS_BOTH_COMPLETED);
    assert('shouldProcessRewards=true on first completion', r.shouldProcessRewards, true);
    assert('rewardsProcessed flag set', r.session.rewardsProcessed, true);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', opponentCompleted: true, rewardsProcessed: true, status: ASYNC_STATUS_BOTH_COMPLETED });
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 800, correctAnswers: 8, totalQuestions: 10, timeTaken: 50 });
    assert('Double-reward guard: shouldProcessRewards=false when already processed', r.shouldProcessRewards, false);
})();

(function() {
    var s = makeSession({ creatorCompleted: true, creatorScore: 900 });
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 500, correctAnswers: 5, totalQuestions: 10, timeTaken: 60 });
    assert('Double-submit is idempotent (ok=true)', r.ok, true);
    assert('errorCode=ALREADY_SUBMITTED on double-submit', r.errorCode, 'ALREADY_SUBMITTED');
    assert('Original score NOT overwritten on double-submit', r.session.creatorScore, 900);
})();

(function() {
    var s = makeSession();
    var r = asyncChallengeTransitionState(s, AC_EVT_CREATOR_SUBMIT, { userId: 'user-opponent', score: 500, correctAnswers: 5, totalQuestions: 10, timeTaken: 60 });
    assert('Opponent cannot creator-submit', r.ok, false);
    assert('errorCode=NOT_PARTICIPANT', r.errorCode, 'NOT_PARTICIPANT');
})();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== OPPONENT_SUBMIT transitions ===');

(function() {
    var s = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED, creatorCompleted: true, creatorScore: 800 });
    var r = asyncChallengeTransitionState(s, AC_EVT_OPPONENT_SUBMIT, { userId: 'user-opponent', score: 750, correctAnswers: 7, totalQuestions: 10, timeTaken: 55 });
    assert('Opponent submit when creator already done → BOTH_COMPLETED', r.session.status, ASYNC_STATUS_BOTH_COMPLETED);
    assert('shouldProcessRewards=true', r.shouldProcessRewards, true);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', opponentCompleted: true, opponentScore: 750 });
    var r = asyncChallengeTransitionState(s, AC_EVT_OPPONENT_SUBMIT, { userId: 'user-opponent', score: 100, correctAnswers: 1, totalQuestions: 10, timeTaken: 99 });
    assert('Opponent double-submit is idempotent', r.ok, true);
    assert('errorCode=ALREADY_SUBMITTED', r.errorCode, 'ALREADY_SUBMITTED');
    assert('Original opponent score NOT overwritten', r.session.opponentScore, 750);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED });
    var r = asyncChallengeTransitionState(s, AC_EVT_OPPONENT_SUBMIT, { userId: 'user-creator', score: 900, correctAnswers: 9, totalQuestions: 10, timeTaken: 40 });
    assert('Creator cannot opponent-submit', r.ok, false);
    assert('errorCode=NOT_PARTICIPANT', r.errorCode, 'NOT_PARTICIPANT');
})();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== CANCEL transitions ===');

(function() {
    var s = makeSession();
    var r = asyncChallengeTransitionState(s, AC_EVT_CANCEL, { userId: 'user-creator' });
    assert('Creator can cancel WAITING session', r.ok, true);
    assert('status=CANCELLED', r.session.status, ASYNC_STATUS_CANCELLED);
})();

(function() {
    var s = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED });
    var r = asyncChallengeTransitionState(s, AC_EVT_CANCEL, { userId: 'user-opponent' });
    assert('Opponent cannot cancel', r.ok, false);
    assert('errorCode=NOT_CREATOR', r.errorCode, 'NOT_CREATOR');
})();

(function() {
    var s = makeSession({ status: ASYNC_STATUS_BOTH_COMPLETED });
    var r = asyncChallengeTransitionState(s, AC_EVT_CANCEL, { userId: 'user-creator' });
    assert('Cannot cancel completed challenge', r.ok, false);
    assert('errorCode=ALREADY_COMPLETED', r.errorCode, 'ALREADY_COMPLETED');
})();

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Terminal state guards ===');

(['CANCELLED', 'EXPIRED'].forEach(function(label) {
    var statusCode = label === 'CANCELLED' ? ASYNC_STATUS_CANCELLED : ASYNC_STATUS_EXPIRED;
    [AC_EVT_JOIN, AC_EVT_CANCEL].forEach(function(evt) {
        var s = makeSession({ status: statusCode });
        var r = asyncChallengeTransitionState(s, evt, { userId: 'user-opponent' });
        assert(label + ' session rejects ' + evt, r.ok, false);
    });
}));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== Concurrent submission race ===');

(function() {
    // Simulate two concurrent submits: both read the same session (creatorCompleted=false),
    // both call the state machine. First write wins; second re-reads and sees ALREADY_SUBMITTED.
    var s1 = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED });
    var s2 = makeSession({ opponentId: 'user-opponent', status: ASYNC_STATUS_OPPONENT_JOINED }); // same snapshot

    var r1 = asyncChallengeTransitionState(s1, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 900, correctAnswers: 9, totalQuestions: 10, timeTaken: 45 });
    assert('First submit succeeds', r1.ok, true);

    // Second: re-reads updated session (s1 is now mutated), calls state machine again.
    var r2 = asyncChallengeTransitionState(r1.session, AC_EVT_CREATOR_SUBMIT, { userId: 'user-creator', score: 900, correctAnswers: 9, totalQuestions: 10, timeTaken: 45 });
    assert('Second submit is idempotent (ALREADY_SUBMITTED)', r2.errorCode, 'ALREADY_SUBMITTED');
    assert('Double-reward guard: no rewards on second submit', r2.shouldProcessRewards, false);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Summary
console.log('\n─────────────────────────────────────────');
console.log('  Tests passed: ' + passed);
console.log('  Tests failed: ' + failed);
console.log('─────────────────────────────────────────\n');
if (failed > 0) process.exit(1);
