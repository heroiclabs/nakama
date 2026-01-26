/**
 * Compatibility Quiz RPC Handlers for Nakama
 * 
 * This file contains all RPC endpoints for the Compatibility Quiz feature.
 * Deploy to Nakama server's data/modules directory.
 * 
 * @author IntelliverseX
 * @version 1.0.0
 */

// Collection constants
const COLLECTION_COMPATIBILITY_SESSIONS = 'compatibility_sessions';
const COLLECTION_COMPATIBILITY_ANSWERS = 'compatibility_answers';

/**
 * Initialize the module - register all RPCs
 */
function InitModule(ctx, logger, nk, initializer) {
    logger.info('Initializing Compatibility Quiz module...');
    
    initializer.registerRpc('compatibility_create_session', createSession);
    initializer.registerRpc('compatibility_join_session', joinSession);
    initializer.registerRpc('compatibility_get_session', getSession);
    initializer.registerRpc('compatibility_submit_answers', submitAnswers);
    initializer.registerRpc('compatibility_calculate', calculateCompatibility);
    initializer.registerRpc('compatibility_list_sessions', listUserSessions);
    
    logger.info('Compatibility Quiz module initialized successfully');
}

/**
 * Create a new compatibility quiz session
 * 
 * Payload: { quizId: string }
 * Returns: { sessionId, shareCode, createdAt, expiresAt, status }
 */
function createSession(ctx, logger, nk, payload) {
    logger.debug('Creating compatibility session for user: ' + ctx.userId);
    
    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }
    
    const quizId = request.quizId || 'compatibility_quiz_v1';
    const sessionId = nk.uuidV4();
    const shareCode = generateShareCode(sessionId);
    const now = Date.now();
    const expiresAt = now + (48 * 60 * 60 * 1000); // 48 hours
    
    // Get user display name
    const users = nk.usersGetId([ctx.userId]);
    const displayName = users.length > 0 ? users[0].displayName || users[0].username : 'Unknown';
    
    const session = {
        sessionId: sessionId,
        shareCode: shareCode,
        quizId: quizId,
        creatorId: ctx.userId,
        creatorName: displayName,
        partnerId: null,
        partnerName: null,
        status: 'waiting_for_partner',
        createdAt: now,
        expiresAt: expiresAt,
        creatorCompleted: false,
        partnerCompleted: false,
        creatorAnswers: null,
        partnerAnswers: null,
        creatorTraitScores: null,
        partnerTraitScores: null,
        compatibilityResult: null
    };
    
    // Store session
    nk.storageWrite([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: ctx.userId,
        value: session,
        permissionRead: 2, // Public read
        permissionWrite: 1  // Owner write
    }]);
    
    // Also store by share code for quick lookup
    nk.storageWrite([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: 'code_' + shareCode,
        userId: ctx.userId,
        value: { sessionId: sessionId, creatorId: ctx.userId },
        permissionRead: 2,
        permissionWrite: 1
    }]);
    
    logger.info('Session created: ' + sessionId + ' with code: ' + shareCode);
    
    return JSON.stringify({
        success: true,
        sessionId: sessionId,
        shareCode: shareCode,
        createdAt: now,
        expiresAt: expiresAt,
        status: 'waiting_for_partner'
    });
}

/**
 * Join an existing compatibility quiz session
 * 
 * Payload: { shareCode: string }
 * Returns: { success, session }
 */
function joinSession(ctx, logger, nk, payload) {
    logger.debug('User ' + ctx.userId + ' attempting to join session');
    
    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }
    
    const shareCode = (request.shareCode || '').toUpperCase().trim();
    if (!shareCode || shareCode.length < 6) {
        throw new Error('Invalid share code');
    }
    
    // Look up session by share code
    const codeResults = nk.storageRead([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: 'code_' + shareCode,
        userId: null // Search across all users
    }]);
    
    if (codeResults.length === 0) {
        throw new Error('Session not found');
    }
    
    const codeRecord = codeResults[0].value;
    const sessionId = codeRecord.sessionId;
    const creatorId = codeRecord.creatorId;
    
    // Read the actual session
    const sessionResults = nk.storageRead([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: creatorId
    }]);
    
    if (sessionResults.length === 0) {
        throw new Error('Session data not found');
    }
    
    const session = sessionResults[0].value;
    
    // Validate session
    if (session.status === 'expired' || Date.now() > session.expiresAt) {
        throw new Error('Session has expired');
    }
    
    if (session.partnerId !== null && session.partnerId !== ctx.userId) {
        throw new Error('Session already has a partner');
    }
    
    if (session.creatorId === ctx.userId) {
        throw new Error('Cannot join your own session');
    }
    
    // Get partner display name
    const users = nk.usersGetId([ctx.userId]);
    const displayName = users.length > 0 ? users[0].displayName || users[0].username : 'Unknown';
    
    // Update session with partner
    session.partnerId = ctx.userId;
    session.partnerName = displayName;
    session.status = 'partner_joined';
    
    nk.storageWrite([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: creatorId,
        value: session,
        permissionRead: 2,
        permissionWrite: 1
    }]);
    
    // Send notification to creator
    sendNotification(nk, session.creatorId, 
        'Partner Joined! 💕',
        displayName + ' has joined your compatibility quiz!',
        { type: 'partner_joined', sessionId: sessionId }
    );
    
    logger.info('User ' + ctx.userId + ' joined session ' + sessionId);
    
    return JSON.stringify({
        success: true,
        session: {
            sessionId: session.sessionId,
            shareCode: session.shareCode,
            quizId: session.quizId,
            creatorName: session.creatorName,
            status: session.status,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt
        }
    });
}

/**
 * Get session details
 * 
 * Payload: { sessionId: string } or { shareCode: string }
 * Returns: { session }
 */
function getSession(ctx, logger, nk, payload) {
    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }
    
    let sessionId = request.sessionId;
    let creatorId = null;
    
    // If share code provided, look up session ID
    if (!sessionId && request.shareCode) {
        const shareCode = request.shareCode.toUpperCase().trim();
        const codeResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: 'code_' + shareCode,
            userId: null
        }]);
        
        if (codeResults.length === 0) {
            throw new Error('Session not found');
        }
        
        sessionId = codeResults[0].value.sessionId;
        creatorId = codeResults[0].value.creatorId;
    }
    
    // Try to find session - first check if user is creator
    let sessionResults = nk.storageRead([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: ctx.userId
    }]);
    
    // If not found as creator, try with known creatorId
    if (sessionResults.length === 0 && creatorId) {
        sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: creatorId
        }]);
    }
    
    if (sessionResults.length === 0) {
        throw new Error('Session not found');
    }
    
    const session = sessionResults[0].value;
    
    // Check if user is authorized to view this session
    if (session.creatorId !== ctx.userId && session.partnerId !== ctx.userId) {
        throw new Error('Not authorized to view this session');
    }
    
    // Check expiry
    if (Date.now() > session.expiresAt && session.status !== 'completed') {
        session.status = 'expired';
    }
    
    return JSON.stringify({
        success: true,
        session: {
            sessionId: session.sessionId,
            shareCode: session.shareCode,
            quizId: session.quizId,
            creatorId: session.creatorId,
            creatorName: session.creatorName,
            partnerId: session.partnerId,
            partnerName: session.partnerName,
            status: session.status,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            creatorCompleted: session.creatorCompleted,
            partnerCompleted: session.partnerCompleted,
            compatibilityResult: session.compatibilityResult
        }
    });
}

/**
 * Submit quiz answers
 * 
 * Payload: { sessionId, answers[], traitScores{} }
 * Returns: { success, sessionStatus }
 */
function submitAnswers(ctx, logger, nk, payload) {
    logger.debug('User ' + ctx.userId + ' submitting answers');
    
    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }
    
    const sessionId = request.sessionId;
    const answers = request.answers || [];
    const traitScores = request.traitScores || {};
    
    if (!sessionId) {
        throw new Error('Session ID required');
    }
    
    // Find session
    // Try as creator first
    let sessionResults = nk.storageRead([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: ctx.userId
    }]);
    
    let isCreator = sessionResults.length > 0;
    let creatorId = isCreator ? ctx.userId : null;
    
    // If not creator, need to search differently
    if (!isCreator) {
        // Use a query to find the session
        const query = '+value.sessionId:' + sessionId;
        const results = nk.storageList(null, COLLECTION_COMPATIBILITY_SESSIONS, 100, '');
        
        for (let obj of results.objects || []) {
            if (obj.value.sessionId === sessionId && obj.value.partnerId === ctx.userId) {
                creatorId = obj.value.creatorId;
                break;
            }
        }
        
        if (creatorId) {
            sessionResults = nk.storageRead([{
                collection: COLLECTION_COMPATIBILITY_SESSIONS,
                key: sessionId,
                userId: creatorId
            }]);
        }
    }
    
    if (sessionResults.length === 0) {
        throw new Error('Session not found');
    }
    
    const session = sessionResults[0].value;
    
    // Verify user is part of session
    const isPartner = session.partnerId === ctx.userId;
    isCreator = session.creatorId === ctx.userId;
    
    if (!isCreator && !isPartner) {
        throw new Error('Not authorized for this session');
    }
    
    // Store answers
    if (isCreator) {
        session.creatorAnswers = answers;
        session.creatorTraitScores = traitScores;
        session.creatorCompleted = true;
    } else {
        session.partnerAnswers = answers;
        session.partnerTraitScores = traitScores;
        session.partnerCompleted = true;
    }
    
    // Update status
    if (session.creatorCompleted && session.partnerCompleted) {
        session.status = 'both_completed';
    } else if (session.creatorCompleted) {
        session.status = 'creator_completed';
    } else if (session.partnerCompleted) {
        session.status = 'partner_completed';
    }
    
    // Save updated session
    nk.storageWrite([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: session.creatorId,
        value: session,
        permissionRead: 2,
        permissionWrite: 1
    }]);
    
    // Send notification to the other person
    if (isCreator && session.partnerId) {
        // Notify partner that creator finished (they might be waiting)
        sendNotification(nk, session.partnerId,
            'Your partner finished! 💕',
            session.creatorName + ' completed the quiz. Check your results!',
            { type: 'creator_completed', sessionId: sessionId }
        );
    } else if (isPartner) {
        // Notify creator that partner finished
        sendNotification(nk, session.creatorId,
            'Results are ready! 💕',
            session.partnerName + ' completed the quiz! See your compatibility now!',
            { type: 'partner_completed', sessionId: sessionId }
        );
    }
    
    logger.info('Answers submitted for session ' + sessionId + ' by ' + (isCreator ? 'creator' : 'partner'));
    
    return JSON.stringify({
        success: true,
        status: session.status,
        bothCompleted: session.creatorCompleted && session.partnerCompleted
    });
}

/**
 * Calculate compatibility between two players
 * 
 * Payload: { sessionId: string }
 * Returns: { score, breakdown, message }
 */
function calculateCompatibility(ctx, logger, nk, payload) {
    logger.debug('Calculating compatibility for user ' + ctx.userId);
    
    let request;
    try {
        request = JSON.parse(payload);
    } catch (e) {
        throw new Error('Invalid JSON payload');
    }
    
    const sessionId = request.sessionId;
    if (!sessionId) {
        throw new Error('Session ID required');
    }
    
    // Find session
    let sessionResults = nk.storageRead([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: ctx.userId
    }]);
    
    let creatorId = ctx.userId;
    
    if (sessionResults.length === 0) {
        // Try finding session where user is partner
        const results = nk.storageList(null, COLLECTION_COMPATIBILITY_SESSIONS, 100, '');
        for (let obj of results.objects || []) {
            if (obj.value.sessionId === sessionId) {
                creatorId = obj.value.creatorId;
                break;
            }
        }
        
        sessionResults = nk.storageRead([{
            collection: COLLECTION_COMPATIBILITY_SESSIONS,
            key: sessionId,
            userId: creatorId
        }]);
    }
    
    if (sessionResults.length === 0) {
        throw new Error('Session not found');
    }
    
    const session = sessionResults[0].value;
    
    // Verify both completed
    if (!session.creatorCompleted || !session.partnerCompleted) {
        throw new Error('Both players must complete the quiz first');
    }
    
    // If already calculated, return cached result
    if (session.compatibilityResult) {
        return JSON.stringify({
            success: true,
            ...session.compatibilityResult
        });
    }
    
    // Calculate compatibility
    const creatorTraits = session.creatorTraitScores || {};
    const partnerTraits = session.partnerTraitScores || {};
    
    const result = computeCompatibility(creatorTraits, partnerTraits, session.creatorAnswers, session.partnerAnswers);
    
    // Store result
    session.compatibilityResult = result;
    session.status = 'completed';
    
    nk.storageWrite([{
        collection: COLLECTION_COMPATIBILITY_SESSIONS,
        key: sessionId,
        userId: creatorId,
        value: session,
        permissionRead: 2,
        permissionWrite: 1
    }]);
    
    // Notify both users
    const resultMessage = 'Your compatibility score: ' + result.score.toFixed(0) + '%! 💕';
    
    sendNotification(nk, session.creatorId,
        'Compatibility Results! 💕',
        resultMessage,
        { type: 'results_ready', sessionId: sessionId }
    );
    
    if (session.partnerId) {
        sendNotification(nk, session.partnerId,
            'Compatibility Results! 💕',
            resultMessage,
            { type: 'results_ready', sessionId: sessionId }
        );
    }
    
    logger.info('Compatibility calculated for session ' + sessionId + ': ' + result.score + '%');
    
    return JSON.stringify({
        success: true,
        ...result
    });
}

/**
 * List user's compatibility sessions
 * 
 * Payload: { limit?: number, includeExpired?: boolean }
 * Returns: { sessions[] }
 */
function listUserSessions(ctx, logger, nk, payload) {
    let request = {};
    try {
        if (payload) {
            request = JSON.parse(payload);
        }
    } catch (e) {
        // Use defaults
    }
    
    const limit = Math.min(request.limit || 20, 100);
    const includeExpired = request.includeExpired || false;
    
    // Get sessions where user is creator
    const creatorSessions = nk.storageList(ctx.userId, COLLECTION_COMPATIBILITY_SESSIONS, limit, '');
    
    const sessions = [];
    const now = Date.now();
    
    for (let obj of creatorSessions.objects || []) {
        const session = obj.value;
        
        // Skip code lookup records
        if (obj.key.startsWith('code_')) continue;
        
        // Skip expired unless requested
        if (!includeExpired && (session.status === 'expired' || now > session.expiresAt)) {
            continue;
        }
        
        sessions.push({
            sessionId: session.sessionId,
            shareCode: session.shareCode,
            role: 'creator',
            partnerName: session.partnerName,
            status: session.status,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            hasResults: session.compatibilityResult !== null
        });
    }
    
    // Also find sessions where user is partner (would need additional lookup)
    // For efficiency, this could be enhanced with a secondary index
    
    return JSON.stringify({
        success: true,
        sessions: sessions,
        count: sessions.length
    });
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Generate a unique share code from session ID
 */
function generateShareCode(sessionId) {
    // Take first 8 characters of UUID and convert to uppercase
    return sessionId.replace(/-/g, '').substring(0, 8).toUpperCase();
}

/**
 * Send a push notification to a user
 */
function sendNotification(nk, userId, subject, content, data) {
    try {
        const notifications = [{
            userId: userId,
            subject: subject,
            content: JSON.stringify({
                message: content,
                ...data
            }),
            code: 100, // Custom code for compatibility notifications
            persistent: true
        }];
        
        nk.notificationsSend(notifications);
    } catch (e) {
        // Log but don't fail if notification fails
        // logger.warn('Failed to send notification: ' + e.message);
    }
}

/**
 * Compute compatibility score based on trait scores and answers
 */
function computeCompatibility(creatorTraits, partnerTraits, creatorAnswers, partnerAnswers) {
    let totalScore = 0;
    let categoryCount = 0;
    const breakdown = {};
    
    // 1. Communication Style (based on MBTI E/I and J/P)
    const commScore = calculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:E', 'mbti:I', 'mbti:J', 'mbti:P']
    );
    breakdown.communicationStyle = Math.round(commScore * 100);
    totalScore += commScore;
    categoryCount++;
    
    // 2. Emotional Connection (based on MBTI F/T and Big Five)
    const emotionalScore = calculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:F', 'mbti:T', 'big_five:high_agreeableness', 'big_five:high_openness']
    );
    breakdown.emotionalConnection = Math.round(emotionalScore * 100);
    totalScore += emotionalScore;
    categoryCount++;
    
    // 3. Shared Values (based on N/S preferences)
    const valuesScore = calculateTraitSimilarity(
        creatorTraits,
        partnerTraits,
        ['mbti:N', 'mbti:S', 'big_five:high_conscientiousness']
    );
    breakdown.sharedValues = Math.round(valuesScore * 100);
    totalScore += valuesScore;
    categoryCount++;
    
    // 4. Direct answer matching bonus
    const matchingAnswers = countMatchingAnswers(creatorAnswers, partnerAnswers);
    const matchRatio = matchingAnswers / Math.max(creatorAnswers.length, partnerAnswers.length, 1);
    breakdown.answerAlignment = Math.round(matchRatio * 100);
    totalScore += matchRatio * 0.5; // Weight matching answers less
    categoryCount += 0.5;
    
    // Calculate final score
    const finalScore = (totalScore / categoryCount) * 100;
    
    // Generate message based on score
    let message;
    let emoji;
    if (finalScore >= 90) {
        message = "You're a perfect match! 💕 Your connection is extraordinary!";
        emoji = "💕";
    } else if (finalScore >= 75) {
        message = "Highly compatible! 💗 You complement each other wonderfully!";
        emoji = "💗";
    } else if (finalScore >= 60) {
        message = "Good compatibility! 💖 You share many common values!";
        emoji = "💖";
    } else if (finalScore >= 45) {
        message = "Moderate compatibility! 💛 Opposites can attract!";
        emoji = "💛";
    } else {
        message = "Different perspectives! 🌟 Diversity makes life interesting!";
        emoji = "🌟";
    }
    
    return {
        score: finalScore,
        breakdown: breakdown,
        message: message,
        emoji: emoji,
        matchingAnswers: matchingAnswers,
        totalQuestions: Math.max(creatorAnswers.length, partnerAnswers.length)
    };
}

/**
 * Calculate similarity between two trait score sets
 */
function calculateTraitSimilarity(traits1, traits2, relevantTraits) {
    let similarity = 0;
    let count = 0;
    
    for (let trait of relevantTraits) {
        const score1 = traits1[trait] || 0;
        const score2 = traits2[trait] || 0;
        
        // Normalize to 0-1 scale (assuming max score of 5 per trait)
        const norm1 = Math.min(score1 / 5, 1);
        const norm2 = Math.min(score2 / 5, 1);
        
        // Calculate similarity (1 - difference)
        const diff = Math.abs(norm1 - norm2);
        similarity += (1 - diff);
        count++;
    }
    
    return count > 0 ? similarity / count : 0.5;
}

/**
 * Count how many answers match between two players
 */
function countMatchingAnswers(answers1, answers2) {
    let matches = 0;
    
    for (let i = 0; i < Math.min(answers1.length, answers2.length); i++) {
        const a1 = answers1[i];
        const a2 = answers2[i];
        
        if (a1 && a2 && a1.optionId === a2.optionId) {
            matches++;
        }
    }
    
    return matches;
}
