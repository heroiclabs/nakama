$filePath = "C:\Office\Backend\nakama\data\modules\index.js"
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)

$marker = "logger.info('[Gifts] Registered gift_send');"
$markerIdx = $content.IndexOf($marker)

if ($markerIdx -lt 0) {
    Write-Error "Marker not found!"
    exit 1
}

# Find end of the try-catch block after the marker (the closing line)
$afterMarker = $content.IndexOf("} catch (err) { logger.error('[Gifts] Failed: ' + err.message); }", $markerIdx)
if ($afterMarker -lt 0) {
    Write-Error "Gifts try-catch close not found!"
    exit 1
}
# Position right after that closing line (including the newline)
$insertAfterLine = $content.IndexOf("`n", $afterMarker) + 1

# Find the logger summary block to replace
$summaryStart = $content.IndexOf("    logger.info('========================================');`r`n    logger.info('JavaScript Runtime Initialization Complete');", $afterMarker)
if ($summaryStart -lt 0) {
    $summaryStart = $content.IndexOf("    logger.info('========================================');", $afterMarker)
}

$summaryEnd = $content.IndexOf("}", $content.IndexOf("All v3.0 RPCs registered successfully!", $summaryStart))
# Find the next newline after that closing brace of InitModule
$endOfFunction = $content.IndexOf("`n", $summaryEnd) + 1

$newRpcs = @'

    // ============================================================================
    // v3.1 NEW RPCs - Compatibility Quiz System (5 RPCs)
    // ============================================================================
    function generateShareCode() {
        var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        var code = '';
        for (var i = 0; i < 6; i++) { code += chars.charAt(Math.floor(Math.random() * chars.length)); }
        return code;
    }

    try {
        initializer.registerRpc('compatibility_create_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId;
                var sessionId = nk.uuidv4();
                var code = generateShareCode();
                var session = {
                    sessionId: sessionId, shareCode: code, gameId: data.gameId || 'quiz-verse',
                    quizId: data.quizId || '', quizTitle: data.quizTitle || 'Compatibility Quiz',
                    createdByUserId: userId, createdByDisplayName: data.playerDisplayName || '',
                    status: 'waiting_for_partner', playerAAnswers: [], playerBAnswers: [],
                    createdAt: Math.floor(Date.now() / 1000), expiresAt: Math.floor(Date.now() / 1000) + (48 * 3600)
                };
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: userId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                nk.storageWrite([{ collection: 'compatibility_codes', key: code, userId: userId, value: JSON.stringify({ sessionId: sessionId, createdBy: userId }), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] create_session: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('compatibility_join_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId; var sessionId = data.sessionId || ''; var shareCode = data.shareCode || '';
                if (!sessionId && shareCode) {
                    var cr = nk.storageRead([{ collection: 'compatibility_codes', key: shareCode.toUpperCase() }]);
                    if (cr && cr.length > 0) { sessionId = JSON.parse(cr[0].value).sessionId; }
                }
                if (!sessionId) { return JSON.stringify({ success: false, error: 'Session not found' }); }
                var records = nk.storageRead([{ collection: 'compatibility_sessions', key: sessionId }]);
                if (!records || records.length === 0) { return JSON.stringify({ success: false, error: 'Session not found' }); }
                var session = JSON.parse(records[0].value);
                session.partnerUserId = userId; session.partnerDisplayName = data.playerDisplayName || ''; session.status = 'both_joined';
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: records[0].userId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] join_session: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('compatibility_submit_answers', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var userId = ctx.userId; var sessionId = data.sessionId || '';
                var records = nk.storageRead([{ collection: 'compatibility_sessions', key: sessionId }]);
                if (!records || records.length === 0) { return JSON.stringify({ success: false, error: 'Session not found' }); }
                var session = JSON.parse(records[0].value);
                if (userId === session.createdByUserId) {
                    session.playerAAnswers = data.answers || []; session.playerAResult = { resultId: data.resultId, title: data.personalityTitle, emoji: data.personalityEmoji };
                } else {
                    session.playerBAnswers = data.answers || []; session.playerBResult = { resultId: data.resultId, title: data.personalityTitle, emoji: data.personalityEmoji };
                }
                if (session.playerAAnswers.length > 0 && session.playerBAnswers.length > 0) { session.status = 'both_completed'; }
                nk.storageWrite([{ collection: 'compatibility_sessions', key: sessionId, userId: records[0].userId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: session });
            } catch(e) { logger.error('[Compatibility] submit_answers: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('compatibility_get_session', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var records = nk.storageRead([{ collection: 'compatibility_sessions', key: data.sessionId || '' }]);
                if (!records || records.length === 0) { return JSON.stringify({ success: false, error: 'Session not found' }); }
                return JSON.stringify({ success: true, data: JSON.parse(records[0].value) });
            } catch(e) { logger.error('[Compatibility] get_session: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('compatibility_calculate', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {};
                var records = nk.storageRead([{ collection: 'compatibility_sessions', key: data.sessionId || '' }]);
                if (!records || records.length === 0) { return JSON.stringify({ success: false, error: 'Session not found' }); }
                var session = JSON.parse(records[0].value);
                if (!session.playerAAnswers || !session.playerBAnswers || session.playerAAnswers.length === 0 || session.playerBAnswers.length === 0) {
                    return JSON.stringify({ success: false, error: 'Both players must complete first' });
                }
                var totalQ = Math.min(session.playerAAnswers.length, session.playerBAnswers.length); var matching = 0;
                for (var i = 0; i < totalQ; i++) { if (session.playerAAnswers[i].selectedOptionId === session.playerBAnswers[i].selectedOptionId) { matching++; } }
                var score = totalQ > 0 ? Math.round((matching / totalQ) * 100) : 0;
                var result = { sessionId: data.sessionId, overallScore: score, matchingAnswers: matching, totalQuestions: totalQ, playerAResult: session.playerAResult || {}, playerBResult: session.playerBResult || {}, calculatedAt: Math.floor(Date.now() / 1000) };
                session.compatibilityScore = score; session.compatibilityResult = result;
                nk.storageWrite([{ collection: 'compatibility_sessions', key: data.sessionId, userId: records[0].userId, value: JSON.stringify(session), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: result });
            } catch(e) { logger.error('[Compatibility] calculate: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        logger.info('[Compatibility] Registered 5 Compatibility Quiz RPCs');
    } catch (err) { logger.error('[Compatibility] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Clan System (3 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('get_clan_challenges', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var clanId = data.clanId || '';
                if (!clanId) { return JSON.stringify({ success: false, error: 'clanId required' }); }
                var records = nk.storageRead([{ collection: 'clan_challenges', key: clanId }]);
                var challenges = (records && records.length > 0) ? JSON.parse(records[0].value) : { challenges: [], lastUpdated: 0 };
                return JSON.stringify({ success: true, data: challenges });
            } catch(e) { logger.error('[Clan] get_clan_challenges: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('contribute_clan_challenge', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var clanId = data.clanId || ''; var challengeId = data.challengeId || ''; var contribution = data.contribution || 0;
                if (!clanId || !challengeId) { return JSON.stringify({ success: false, error: 'clanId and challengeId required' }); }
                var records = nk.storageRead([{ collection: 'clan_challenges', key: clanId }]);
                var store = (records && records.length > 0) ? JSON.parse(records[0].value) : { challenges: [], lastUpdated: 0 };
                var found = false;
                for (var i = 0; i < store.challenges.length; i++) {
                    if (store.challenges[i].id === challengeId) {
                        store.challenges[i].currentProgress = (store.challenges[i].currentProgress || 0) + contribution;
                        store.challenges[i].contributors = store.challenges[i].contributors || [];
                        store.challenges[i].contributors.push({ userId: ctx.userId, amount: contribution, at: Math.floor(Date.now() / 1000) });
                        found = true; break;
                    }
                }
                if (!found) { return JSON.stringify({ success: false, error: 'Challenge not found' }); }
                store.lastUpdated = Math.floor(Date.now() / 1000);
                nk.storageWrite([{ collection: 'clan_challenges', key: clanId, userId: ctx.userId, value: JSON.stringify(store), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: store });
            } catch(e) { logger.error('[Clan] contribute_clan_challenge: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('get_clan_leaderboard', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var clanId = data.clanId || ''; var period = data.period || 'weekly';
                if (!clanId) { return JSON.stringify({ success: false, error: 'clanId required' }); }
                var leaderboardId = 'clan_' + clanId + '_' + period; var result = { entries: [], clanId: clanId, period: period };
                try {
                    var recs = nk.leaderboardRecordsList(leaderboardId, null, 50, null, 0);
                    if (recs && recs.records) { result.entries = recs.records.map(function(r) { return { userId: r.ownerId, username: r.username, score: r.score, rank: r.rank }; }); }
                } catch(le) { logger.warn('[Clan] Leaderboard not found: ' + leaderboardId); }
                return JSON.stringify({ success: true, data: result });
            } catch(e) { logger.error('[Clan] get_clan_leaderboard: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        logger.info('[Clan] Registered 3 Clan RPCs');
    } catch (err) { logger.error('[Clan] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Matchmaking System (5 RPCs)
    // ============================================================================
    try {
        initializer.registerRpc('matchmaking_find_match', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var gameMode = data.gameMode || 'standard';
                var query = '+properties.gameMode:' + gameMode;
                var ticket = nk.matchmakerAdd(ctx.userId, data.minPlayers || 2, data.maxPlayers || 4, query, { gameMode: gameMode, difficulty: data.difficulty || 'medium' }, {});
                return JSON.stringify({ success: true, data: { ticketId: ticket.ticket, status: 'searching', gameMode: gameMode } });
            } catch(e) { logger.error('[Matchmaking] find_match: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('matchmaking_cancel', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var ticketId = data.ticketId || '';
                if (!ticketId) { return JSON.stringify({ success: false, error: 'ticketId required' }); }
                nk.matchmakerRemove(ticketId);
                return JSON.stringify({ success: true, data: { ticketId: ticketId, status: 'cancelled' } });
            } catch(e) { logger.error('[Matchmaking] cancel: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('matchmaking_get_status', function(ctx, logger, nk, payload) {
            try {
                var records = nk.storageRead([{ collection: 'matchmaking_state', key: 'status', userId: ctx.userId }]);
                var status = (records && records.length > 0) ? JSON.parse(records[0].value) : { status: 'idle', ticketId: null };
                return JSON.stringify({ success: true, data: status });
            } catch(e) { logger.error('[Matchmaking] get_status: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('matchmaking_create_party', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var partyCode = generateShareCode();
                var party = { partyId: nk.uuidv4(), partyCode: partyCode, leaderId: ctx.userId, members: [ctx.userId], maxMembers: data.maxMembers || 4, status: 'waiting', createdAt: Math.floor(Date.now() / 1000) };
                nk.storageWrite([{ collection: 'parties', key: party.partyId, userId: ctx.userId, value: JSON.stringify(party), permissionRead: 2, permissionWrite: 0 }]);
                nk.storageWrite([{ collection: 'party_codes', key: partyCode, userId: ctx.userId, value: JSON.stringify({ partyId: party.partyId }), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: party });
            } catch(e) { logger.error('[Matchmaking] create_party: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        initializer.registerRpc('matchmaking_join_party', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var partyCode = (data.partyCode || '').toUpperCase();
                if (!partyCode) { return JSON.stringify({ success: false, error: 'partyCode required' }); }
                var cr = nk.storageRead([{ collection: 'party_codes', key: partyCode }]);
                if (!cr || cr.length === 0) { return JSON.stringify({ success: false, error: 'Party not found' }); }
                var partyId = JSON.parse(cr[0].value).partyId;
                var records = nk.storageRead([{ collection: 'parties', key: partyId }]);
                if (!records || records.length === 0) { return JSON.stringify({ success: false, error: 'Party not found' }); }
                var party = JSON.parse(records[0].value);
                if (party.members.length >= party.maxMembers) { return JSON.stringify({ success: false, error: 'Party is full' }); }
                if (party.members.indexOf(ctx.userId) === -1) { party.members.push(ctx.userId); }
                nk.storageWrite([{ collection: 'parties', key: partyId, userId: records[0].userId, value: JSON.stringify(party), permissionRead: 2, permissionWrite: 0 }]);
                return JSON.stringify({ success: true, data: party });
            } catch(e) { logger.error('[Matchmaking] join_party: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        logger.info('[Matchmaking] Registered 5 Matchmaking RPCs');
    } catch (err) { logger.error('[Matchmaking] Failed: ' + err.message); }

    // ============================================================================
    // v3.1 NEW RPCs - Player Stats (1 RPC)
    // ============================================================================
    try {
        initializer.registerRpc('get_player_stats', function(ctx, logger, nk, payload) {
            try {
                var data = payload ? JSON.parse(payload) : {}; var targetUserId = data.userId || ctx.userId;
                var records = nk.storageRead([{ collection: 'player_stats', key: 'stats', userId: targetUserId }]);
                var stats = (records && records.length > 0) ? JSON.parse(records[0].value) : {
                    userId: targetUserId, totalGamesPlayed: 0, totalCorrectAnswers: 0, totalQuestions: 0,
                    winRate: 0, currentStreak: 0, bestStreak: 0, averageScore: 0, favoriteCategory: '', lastPlayedAt: 0
                };
                try { var accts = nk.accountsGetId([targetUserId]); if (accts && accts.length > 0) { stats.displayName = accts[0].user.displayName || accts[0].user.username || ''; stats.avatarUrl = accts[0].user.avatarUrl || ''; } } catch(ae) {}
                return JSON.stringify({ success: true, data: stats });
            } catch(e) { logger.error('[Profile] get_player_stats: ' + e.message); return JSON.stringify({ success: false, error: e.message }); }
        });

        logger.info('[Profile] Registered 1 Player Stats RPC');
    } catch (err) { logger.error('[Profile] Failed: ' + err.message); }

'@

$newSummary = @'
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Complete');
    logger.info('Total System RPCs: 233');

    logger.info('  - Core Multi-Game RPCs: 71');
    logger.info('  - Achievement System: 4');
    logger.info('  - Matchmaking System: 5');
    logger.info('  - Tournament System: 6');
    logger.info('  - Infrastructure (Batch/Cache/Rate): 6');
    logger.info('  - QuizVerse Multiplayer: 3');
    logger.info('  - Guest Cleanup: 1');
    logger.info('  - Onboarding System: 11');
    logger.info('  - Retention System: 7');
    logger.info('  - Weekly Goals System: 4');
    logger.info('  - Season Pass System: 5');
    logger.info('  - Monthly Milestones System: 4');
    logger.info('  - Collections System: 4');
    logger.info('  - Winback System: 4');
    logger.info('  - Async Challenge System: 9');
    logger.info('  - Badges System: 5');
    logger.info('  - Collectables System: 4');
    logger.info('  - Plus existing Copilot RPCs');
    logger.info('  --- v3.0 New RPCs ---');
    logger.info('  - League System: 4');
    logger.info('  - Streak Repair & Wager: 2');
    logger.info('  - Character System: 3');
    logger.info('  - Notification System: 3');
    logger.info('  - Smart Review (SM-2): 2');
    logger.info('  - Friend Streaks: 3');
    logger.info('  - Friend Quests: 2');
    logger.info('  - Fortune Wheel: 2');
    logger.info('  - Asset Manifest: 1');
    logger.info('  - Player Full Profile: 1');
    logger.info('  --- v3.1 New RPCs ---');
    logger.info('  - Compatibility Quiz System: 5');
    logger.info('  - Clan System: 3');
    logger.info('  - Matchmaking System (Client): 5');
    logger.info('  - Player Stats: 1');
    logger.info('========================================');
    logger.info('All v3.1 RPCs registered successfully!');
    logger.info('========================================');
}


'@

# Find the old summary block and replace everything from gifts close to end
$oldBlock = $content.Substring($afterMarker)
$giftsClose = "} catch (err) { logger.error('[Gifts] Failed: ' + err.message); }"
$afterGiftsIdx = $content.IndexOf($giftsClose)
$afterGiftsEnd = $afterGiftsIdx + $giftsClose.Length

$beforeBlock = $content.Substring(0, $afterGiftsEnd)
$result = $beforeBlock + "`r`n" + $newRpcs + "`r`n" + $newSummary

[System.IO.File]::WriteAllText($filePath, $result, [System.Text.Encoding]::UTF8)
Write-Host "SUCCESS: Injected 14 new RPCs into index.js"
