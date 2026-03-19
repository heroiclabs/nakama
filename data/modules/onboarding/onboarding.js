/**
 * Nakama Onboarding Module
 * Handles user onboarding state, preferences, and first-session hooks
 * 
 * Storage Collections:
 * - onboarding_state: User's onboarding progress
 * - user_preferences: User interests and personalization
 * - first_session: First session hooks and rewards
 * - retention_data: D1-D7 retention tracking
 */

// Collection names
var COLLECTION_ONBOARDING = "onboarding_state";
var COLLECTION_PREFERENCES = "user_preferences";
var COLLECTION_FIRST_SESSION = "first_session";
var COLLECTION_RETENTION = "retention_data";

// Keys
var KEY_ONBOARDING = "state";
var KEY_PREFERENCES = "prefs";
var KEY_SESSION = "session";
var KEY_RETENTION = "retention";

// ============================================================================
// DEFAULT AVATAR SYSTEM
// ============================================================================
var DEFAULT_AVATARS = [
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Female1.png",
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Female2.png",
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Female3.png",
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Group-1.png",
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Male1.png",
    "https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/quiz-verse/DefaultAvatar/Male2.png"
];

/**
 * Deterministically pick a default avatar from the pool.
 * Same userId always gets the same avatar (hash-based, not random).
 */
function getDefaultAvatarUrl(userId) {
    var hash = 0;
    for (var i = 0; i < userId.length; i++) {
        hash = ((hash << 5) - hash) + userId.charCodeAt(i);
        hash |= 0; // Convert to 32-bit integer
    }
    return DEFAULT_AVATARS[Math.abs(hash) % DEFAULT_AVATARS.length];
}

/**
 * Ensure a user has an avatar URL. If not, assign a deterministic default.
 * Non-fatal — wrapped in try-catch to never block authentication.
 */
function ensureUserHasAvatar(nk, logger, userId) {
    try {
        var accounts = nk.accountsGetId([userId]);
        if (accounts && accounts.length > 0) {
            var account = accounts[0];
            if (!account.user.avatarUrl || account.user.avatarUrl === "") {
                var defaultAvatar = getDefaultAvatarUrl(userId);
                nk.accountUpdateId(userId, null, null, null, null, null, defaultAvatar, null);
                logger.info("[Onboarding] Assigned default avatar to user " + userId + ": " + defaultAvatar);
                return true;
            }
        }
    } catch (avatarErr) {
        logger.warn("[Onboarding] Failed to assign default avatar for " + userId + ": " + avatarErr.message);
    }
    return false;
}

/**
 * Initialize onboarding module
 */
function _OnboardingInit(ctx, logger, nk, initializer) {
    logger.info("[Onboarding] Initializing onboarding module...");

    // Register RPCs
    initializer.registerRpc("onboarding_get_state", rpcGetOnboardingState);
    initializer.registerRpc("onboarding_update_state", rpcUpdateOnboardingState);
    initializer.registerRpc("onboarding_complete_step", rpcCompleteStep);
    initializer.registerRpc("onboarding_set_interests", rpcSetInterests);
    initializer.registerRpc("onboarding_get_interests", rpcGetInterests);
    initializer.registerRpc("onboarding_claim_welcome_bonus", rpcClaimWelcomeBonus);
    initializer.registerRpc("onboarding_first_quiz_complete", rpcFirstQuizComplete);
    initializer.registerRpc("onboarding_get_tomorrow_preview", rpcGetTomorrowPreview);
    initializer.registerRpc("onboarding_track_session", rpcTrackSession);
    initializer.registerRpc("onboarding_get_retention_data", rpcGetRetentionData);
    initializer.registerRpc("onboarding_grant_streak_shield", rpcGrantStreakShield);

    // Register hooks
    initializer.registerAfterAuthenticateDevice(afterAuthHook);
    initializer.registerAfterAuthenticateEmail(afterAuthHook);
    initializer.registerAfterAuthenticateApple(afterAuthHook);
    initializer.registerAfterAuthenticateGoogle(afterAuthHook);

    logger.info("[Onboarding] Module initialized successfully");
}

/**
 * After authentication hook - Initialize new users
 */
function afterAuthHook(ctx, logger, nk, data, request) {
    var userId = ctx.userId;
    
    try {
        // Check if user has onboarding state
        var existing = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (existing.length === 0) {
            // New user - initialize onboarding state
            logger.info(`[Onboarding] New user detected: ${userId}`);
            initializeNewUser(nk, logger, userId);
            // Assign default avatar for new user
            ensureUserHasAvatar(nk, logger, userId);
        } else {
            // Returning user - track session
            trackUserSession(nk, logger, userId);
            // Backfill avatar for returning users who don't have one
            ensureUserHasAvatar(nk, logger, userId);
        }
    } catch (e) {
        logger.error(`[Onboarding] Auth hook error: ${e.message}`);
    }
}

/**
 * Initialize new user with default onboarding state
 */
function initializeNewUser(nk, logger, userId) {
    var now = Date.now();
    
    // Default onboarding state
    var onboardingState = {
        userId: userId,
        createdAt: now,
        currentStep: 1,
        totalSteps: 5,
        completedSteps: [],
        welcomeBonusClaimed: false,
        firstQuizCompleted: false,
        onboardingComplete: false,
        streakShieldExpiry: 0,
        lastUpdated: now
    };

    // Default preferences
    var preferences = {
        userId: userId,
        interests: [],
        preferredDifficulty: "easy",
        dailyReminderEnabled: true,
        reminderTime: "09:00",
        language: "en",
        createdAt: now,
        lastUpdated: now
    };

    // Session data
    var sessionData = {
        userId: userId,
        firstSessionAt: now,
        totalSessions: 1,
        lastSessionAt: now,
        totalQuizzesPlayed: 0,
        totalCoinsEarned: 0,
        currentStreak: 0,
        longestStreak: 0,
        d1Returned: false,
        d7Returned: false
    };

    // Write all initial data
    nk.storageWrite([
        {
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: onboardingState,
            permissionRead: 1, // Owner read
            permissionWrite: 0 // Server write only
        },
        {
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId,
            value: preferences,
            permissionRead: 1,
            permissionWrite: 0
        },
        {
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId,
            value: sessionData,
            permissionRead: 1,
            permissionWrite: 0
        }
    ]);

    logger.info(`[Onboarding] Initialized new user: ${userId}`);
}

/**
 * Track returning user session
 */
function trackUserSession(nk, logger, userId) {
    try {
        var result = nk.storageRead([{
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId
        }]);

        if (result.length > 0) {
            var sessionData = result[0].value;
            var now = Date.now();
            var firstSession = sessionData.firstSessionAt;
            var hoursSinceFirst = (now - firstSession) / (1000 * 60 * 60);

            sessionData.totalSessions++;
            sessionData.lastSessionAt = now;

            // Track D1 return (returned within 24-48 hours)
            if (!sessionData.d1Returned && hoursSinceFirst >= 20 && hoursSinceFirst <= 48) {
                sessionData.d1Returned = true;
                logger.info(`[Onboarding] User ${userId} returned on D1!`);
            }

            // Track D7 return
            if (!sessionData.d7Returned && hoursSinceFirst >= 144 && hoursSinceFirst <= 192) {
                sessionData.d7Returned = true;
                logger.info(`[Onboarding] User ${userId} returned on D7!`);
            }

            nk.storageWrite([{
                collection: COLLECTION_FIRST_SESSION,
                key: KEY_SESSION,
                userId: userId,
                value: sessionData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
    } catch (e) {
        logger.error(`[Onboarding] Track session error: ${e.message}`);
    }
}

// ==================== RPC HANDLERS ====================

/**
 * RPC: Get user's onboarding state
 */
function rpcGetOnboardingState(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    
    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            // Initialize if not exists
            initializeNewUser(nk, logger, userId);
            return JSON.stringify({
                success: true,
                isNewUser: true,
                state: {
                    currentStep: 1,
                    totalSteps: 5,
                    completedSteps: [],
                    welcomeBonusClaimed: false,
                    firstQuizCompleted: false,
                    onboardingComplete: false
                }
            });
        }

        return JSON.stringify({
            success: true,
            isNewUser: false,
            state: result[0].value
        });
    } catch (e) {
        logger.error(`[Onboarding] Get state error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Update onboarding state
 */
function rpcUpdateOnboardingState(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state found" });
        }

        var state = result[0].value;
        
        // Update fields
        if (input.currentStep !== undefined) state.currentStep = input.currentStep;
        if (input.completedSteps !== undefined) state.completedSteps = input.completedSteps;
        if (input.onboardingComplete !== undefined) state.onboardingComplete = input.onboardingComplete;
        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({ success: true, state: state });
    } catch (e) {
        logger.error(`[Onboarding] Update state error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Complete a specific onboarding step
 */
function rpcCompleteStep(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var stepId = input.stepId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;
        
        // Add step to completed if not already
        if (!state.completedSteps.includes(stepId)) {
            state.completedSteps.push(stepId);
        }

        // Auto-advance to next step
        if (stepId >= state.currentStep) {
            state.currentStep = stepId + 1;
        }

        // Check if onboarding is complete
        if (state.completedSteps.length >= state.totalSteps) {
            state.onboardingComplete = true;
            logger.info(`[Onboarding] User ${userId} completed onboarding!`);
        }

        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Return rewards for completing step
        var rewards = getStepRewards(stepId);

        return JSON.stringify({ 
            success: true, 
            state: state,
            rewards: rewards
        });
    } catch (e) {
        logger.error(`[Onboarding] Complete step error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Set user interests/preferences
 */
function rpcSetInterests(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        var prefs;
        if (result.length === 0) {
            prefs = {
                userId: userId,
                interests: input.interests || [],
                preferredDifficulty: input.difficulty || "easy",
                dailyReminderEnabled: true,
                reminderTime: "09:00",
                language: input.language || "en",
                createdAt: Date.now(),
                lastUpdated: Date.now()
            };
        } else {
            prefs = result[0].value;
            if (input.interests) prefs.interests = input.interests;
            if (input.difficulty) prefs.preferredDifficulty = input.difficulty;
            if (input.language) prefs.language = input.language;
            if (input.reminderEnabled !== undefined) prefs.dailyReminderEnabled = input.reminderEnabled;
            if (input.reminderTime) prefs.reminderTime = input.reminderTime;
            prefs.lastUpdated = Date.now();
        }

        nk.storageWrite([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId,
            value: prefs,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info(`[Onboarding] User ${userId} set interests: ${prefs.interests.join(", ")}`);

        return JSON.stringify({ success: true, preferences: prefs });
    } catch (e) {
        logger.error(`[Onboarding] Set interests error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Get user interests
 */
function rpcGetInterests(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ 
                success: true, 
                preferences: {
                    interests: [],
                    preferredDifficulty: "easy"
                }
            });
        }

        return JSON.stringify({ success: true, preferences: result[0].value });
    } catch (e) {
        logger.error(`[Onboarding] Get interests error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Claim welcome bonus (50 coins for new users)
 */
function rpcClaimWelcomeBonus(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var WELCOME_BONUS = 50;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;

        if (state.welcomeBonusClaimed) {
            return JSON.stringify({ 
                success: false, 
                error: "Welcome bonus already claimed",
                alreadyClaimed: true
            });
        }

        // Grant coins via wallet
        var changeset = { coins: WELCOME_BONUS };
        var metadata = { source: "welcome_bonus" };
        nk.walletUpdate(userId, changeset, metadata, true);

        // Update state
        state.welcomeBonusClaimed = true;
        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        logger.info(`[Onboarding] User ${userId} claimed welcome bonus: ${WELCOME_BONUS} coins`);

        return JSON.stringify({ 
            success: true, 
            coinsAwarded: WELCOME_BONUS,
            message: "Welcome! Here's 50 free coins! 🎉"
        });
    } catch (e) {
        logger.error(`[Onboarding] Claim welcome bonus error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: First quiz completed - award bonus
 */
function rpcFirstQuizComplete(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var FIRST_QUIZ_BONUS = 200;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;

        if (state.firstQuizCompleted) {
            return JSON.stringify({ 
                success: false, 
                error: "First quiz bonus already claimed",
                alreadyClaimed: true
            });
        }

        // Grant bonus
        var changeset = { coins: FIRST_QUIZ_BONUS };
        var metadata = { 
            source: "first_quiz_bonus",
            score: input.score || 0,
            correctAnswers: input.correctAnswers || 0
        };
        nk.walletUpdate(userId, changeset, metadata, true);

        // Update state
        state.firstQuizCompleted = true;
        state.lastUpdated = Date.now();

        // Also grant streak shield (48 hours)
        state.streakShieldExpiry = Date.now() + (48 * 60 * 60 * 1000);

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Update session data
        updateSessionStats(nk, logger, userId, {
            quizzesPlayed: 1,
            coinsEarned: FIRST_QUIZ_BONUS
        });

        logger.info(`[Onboarding] User ${userId} completed first quiz: ${FIRST_QUIZ_BONUS} coins + streak shield`);

        return JSON.stringify({ 
            success: true, 
            coinsAwarded: FIRST_QUIZ_BONUS,
            streakShieldHours: 48,
            message: "Amazing! First Quiz Bonus: +200 Coins! 🎉\n🛡️ Streak Shield activated for 48 hours!"
        });
    } catch (e) {
        logger.error(`[Onboarding] First quiz complete error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Get tomorrow's preview (personalized hook)
 */
function rpcGetTomorrowPreview(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        // Get user preferences
        var prefsResult = nk.storageRead([{
            collection: COLLECTION_PREFERENCES,
            key: KEY_PREFERENCES,
            userId: userId
        }]);

        var interests = ["General Knowledge"];
        if (prefsResult.length > 0 && prefsResult[0].value.interests.length > 0) {
            interests = prefsResult[0].value.interests;
        }

        // Pick a random interest for tomorrow's quiz
        var tomorrowCategory = interests[Math.floor(Math.random() * interests.length)];

        // Generate preview
        var preview = {
            category: tomorrowCategory,
            xpMultiplier: 2,
            bonusCoins: 100,
            specialReward: "Mystery Box",
            message: `Tomorrow: ${tomorrowCategory} Quiz with 2x XP! 🔥`,
            notificationText: `Your ${tomorrowCategory} quiz is ready! Don't miss the 2x XP bonus!`
        };

        return JSON.stringify({ success: true, preview: preview });
    } catch (e) {
        logger.error(`[Onboarding] Get tomorrow preview error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Track session for retention analytics
 */
function rpcTrackSession(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);

    try {
        trackUserSession(nk, logger, userId);

        if (input.quizzesPlayed || input.coinsEarned) {
            updateSessionStats(nk, logger, userId, input);
        }

        return JSON.stringify({ success: true });
    } catch (e) {
        logger.error(`[Onboarding] Track session error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Get retention data for analytics
 */
function rpcGetRetentionData(ctx, logger, nk, payload) {
    var userId = ctx.userId;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No session data" });
        }

        var sessionData = result[0].value;
        var now = Date.now();
        var daysSinceFirst = Math.floor((now - sessionData.firstSessionAt) / (1000 * 60 * 60 * 24));

        var data = {};
        for (var k in sessionData) { data[k] = sessionData[k]; }
        data.daysSinceFirstSession = daysSinceFirst;
        data.isD1 = daysSinceFirst === 1;
        data.isD7 = daysSinceFirst === 7;

        return JSON.stringify({
            success: true,
            data: data
        });
    } catch (e) {
        logger.error(`[Onboarding] Get retention data error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

/**
 * RPC: Grant streak shield to user
 */
function rpcGrantStreakShield(ctx, logger, nk, payload) {
    var userId = ctx.userId;
    var input = JSON.parse(payload);
    var hours = input.hours || 48;

    try {
        var result = nk.storageRead([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId
        }]);

        if (result.length === 0) {
            return JSON.stringify({ success: false, error: "No onboarding state" });
        }

        var state = result[0].value;
        state.streakShieldExpiry = Date.now() + (hours * 60 * 60 * 1000);
        state.lastUpdated = Date.now();

        nk.storageWrite([{
            collection: COLLECTION_ONBOARDING,
            key: KEY_ONBOARDING,
            userId: userId,
            value: state,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        return JSON.stringify({ 
            success: true, 
            streakShieldExpiry: state.streakShieldExpiry,
            hoursRemaining: hours
        });
    } catch (e) {
        logger.error(`[Onboarding] Grant streak shield error: ${e.message}`);
        return JSON.stringify({ success: false, error: e.message });
    }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get rewards for completing a specific step
 */
function getStepRewards(stepId) {
    var stepRewards = {
        1: { coins: 0, message: "Welcome to QuizVerse!" },
        2: { coins: 50, message: "Interests saved! +50 coins" },
        3: { coins: 200, message: "First quiz done! +200 coins + Streak Shield!" },
        4: { coins: 50, message: "Daily rewards unlocked! +50 coins" },
        5: { coins: 100, message: "Onboarding complete! +100 bonus coins!" }
    };
    return stepRewards[stepId] || { coins: 0, message: "" };
}

/**
 * Update session statistics
 */
function updateSessionStats(nk, logger, userId, stats) {
    try {
        var result = nk.storageRead([{
            collection: COLLECTION_FIRST_SESSION,
            key: KEY_SESSION,
            userId: userId
        }]);

        if (result.length > 0) {
            var sessionData = result[0].value;
            
            if (stats.quizzesPlayed) {
                sessionData.totalQuizzesPlayed += stats.quizzesPlayed;
            }
            if (stats.coinsEarned) {
                sessionData.totalCoinsEarned += stats.coinsEarned;
            }
            if (stats.streak !== undefined) {
                sessionData.currentStreak = stats.streak;
                if (stats.streak > sessionData.longestStreak) {
                    sessionData.longestStreak = stats.streak;
                }
            }

            nk.storageWrite([{
                collection: COLLECTION_FIRST_SESSION,
                key: KEY_SESSION,
                userId: userId,
                value: sessionData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
    } catch (e) {
        logger.error(`[Onboarding] Update session stats error: ${e.message}`);
    }
}

// Export for Nakama
!InitModule.toString().includes("InitModule") || InitModule;

