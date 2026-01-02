/**
 * Cricket Retention Module
 * 
 * Implements psychological daily return triggers:
 * 
 * Day 1:  Login streak counter ("You're on fire - 1 day!")
 * Day 3:  Leaderboard decay ("You've dropped to #52!")
 * Day 5:  Squad pressure ("Your squad needs you - join war!")
 * Day 7:  Bonus hour notification ("2x coins for 60 min - NOW!")
 * Day 14: Tier progression ("You're close to Silver Expert!")
 * Day 30: Monthly reset ("Fresh season starts - compete again!")
 * 
 * Additional triggers:
 * - Loss aversion ("Don't lose your streak!")
 * - Social proof ("Your friend just passed you!")
 * - FOMO ("Match in 2 hours - predict now!")
 * - Near-miss ("1 more correct = next reward tier!")
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    RETENTION_DATA: "cricket_retention_data",
    STREAK_HISTORY: "cricket_streak_history",
    TRIGGER_HISTORY: "cricket_trigger_history",
    BONUS_HOURS: "cricket_bonus_hours",
    RANK_SNAPSHOTS: "cricket_rank_snapshots"
};

// Trigger types
const TRIGGER_TYPES = {
    STREAK_START: "streak_start",
    LEADERBOARD_DECAY: "leaderboard_decay",
    SQUAD_PRESSURE: "squad_pressure",
    BONUS_HOUR: "bonus_hour",
    TIER_PROGRESSION: "tier_progression",
    MONTHLY_RESET: "monthly_reset",
    LOSS_AVERSION: "loss_aversion",
    SOCIAL_PROOF: "social_proof",
    FOMO: "fomo",
    NEAR_MISS: "near_miss",
    COMEBACK_BONUS: "comeback_bonus"
};

// Streak milestone configurations
const STREAK_MILESTONES = {
    1: {
        type: TRIGGER_TYPES.STREAK_START,
        title: "🔥 You're On Fire!",
        message: "Day 1 streak started! Keep it going for awesome rewards!",
        reward: { coins: 10, xp: 25 }
    },
    3: {
        type: TRIGGER_TYPES.LEADERBOARD_DECAY,
        title: "📉 Rank Protection Active!",
        message: "Your 3-day streak shields your rank from decay!",
        reward: { coins: 25, xp: 50, effect: "rank_shield" }
    },
    5: {
        type: TRIGGER_TYPES.SQUAD_PRESSURE,
        title: "⚔️ Squad Commander!",
        message: "5-day streak! You can now lead squad battles!",
        reward: { coins: 50, xp: 100, effect: "squad_leader" }
    },
    7: {
        type: TRIGGER_TYPES.BONUS_HOUR,
        title: "🚀 2X COINS ACTIVATED!",
        message: "WEEK STREAK! Enjoy 60 minutes of double earnings!",
        reward: { coins: 100, xp: 150, bonusMultiplier: 2.0, bonusDuration: 60 }
    },
    14: {
        type: TRIGGER_TYPES.TIER_PROGRESSION,
        title: "⬆️ Tier Boost Token!",
        message: "2 WEEK STREAK! Use your token for instant tier progress!",
        reward: { coins: 200, xp: 250, item: "tier_boost_token" }
    },
    30: {
        type: TRIGGER_TYPES.MONTHLY_RESET,
        title: "🏆 Season Champion!",
        message: "MONTH STREAK! You've earned the Season Starter Pack!",
        reward: { coins: 500, xp: 500, item: "season_starter_pack" }
    }
};

// Tier configuration
const TIERS = {
    BRONZE: { name: "Bronze", xpRequired: 0, multiplier: 1.0 },
    SILVER: { name: "Silver", xpRequired: 1000, multiplier: 1.1 },
    GOLD: { name: "Gold", xpRequired: 2500, multiplier: 1.2 },
    PLATINUM: { name: "Platinum", xpRequired: 5000, multiplier: 1.3 },
    DIAMOND: { name: "Diamond", xpRequired: 10000, multiplier: 1.4 },
    MASTER: { name: "Master", xpRequired: 25000, multiplier: 1.5 },
    LEGEND: { name: "Legend", xpRequired: 50000, multiplier: 2.0 }
};

/**
 * RPC: Process daily login and return triggers
 * 
 * Returns all applicable triggers for the user's current state
 */
function rpcProcessDailyLogin(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0];

    // Get user's retention data
    const retentionData = getRetentionData(nk, userId);

    // Calculate streak
    const lastLoginDate = retentionData.lastLoginDate;
    const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    let streakResult = {
        continued: false,
        broken: false,
        isNew: false,
        daysAway: 0
    };

    if (lastLoginDate === today) {
        // Already logged in today
        return JSON.stringify({
            success: true,
            alreadyLoggedIn: true,
            currentStreak: retentionData.currentStreak,
            triggers: [],
            message: "Welcome back!"
        });
    } else if (lastLoginDate === yesterday) {
        // Streak continues
        retentionData.currentStreak++;
        streakResult.continued = true;
    } else if (lastLoginDate && lastLoginDate < yesterday) {
        // Streak broken
        const lastDate = new Date(lastLoginDate);
        const nowDate = new Date(today);
        streakResult.daysAway = Math.floor((nowDate - lastDate) / (1000 * 60 * 60 * 24));
        streakResult.broken = true;
        
        retentionData.previousStreak = retentionData.currentStreak;
        retentionData.currentStreak = 1;
    } else {
        // First login ever
        retentionData.currentStreak = 1;
        streakResult.isNew = true;
    }

    retentionData.lastLoginDate = today;
    retentionData.highestStreak = Math.max(retentionData.highestStreak || 0, retentionData.currentStreak);
    retentionData.totalLogins = (retentionData.totalLogins || 0) + 1;

    // Process triggers
    const triggers = [];

    // 1. Streak milestone triggers
    const milestoneTrigger = processStreakMilestone(nk, userId, retentionData, now);
    if (milestoneTrigger) {
        triggers.push(milestoneTrigger);
    }

    // 2. Comeback bonus (if was away 3+ days)
    if (streakResult.broken && streakResult.daysAway >= 3) {
        const comebackTrigger = createComebackTrigger(streakResult.daysAway, now);
        triggers.push(comebackTrigger);
    }

    // 3. Leaderboard decay check
    const rankDecayTrigger = checkLeaderboardDecay(nk, userId, retentionData, now);
    if (rankDecayTrigger) {
        triggers.push(rankDecayTrigger);
    }

    // 4. Tier progression check
    const tierTrigger = checkTierProgress(nk, userId, retentionData, now);
    if (tierTrigger) {
        triggers.push(tierTrigger);
    }

    // 5. FOMO trigger (upcoming matches)
    const fomoTrigger = checkUpcomingMatches(nk, userId, now);
    if (fomoTrigger) {
        triggers.push(fomoTrigger);
    }

    // 6. Social proof trigger (friends passing)
    const socialTrigger = checkFriendProgress(nk, userId, retentionData, now);
    if (socialTrigger) {
        triggers.push(socialTrigger);
    }

    // Save updated retention data
    saveRetentionData(nk, userId, retentionData);

    // Log streak history
    logStreakHistory(nk, userId, retentionData.currentStreak, streakResult);

    // Sort triggers by priority
    triggers.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    logger.info(`User ${userId} daily login: Day ${retentionData.currentStreak}, ${triggers.length} triggers`);

    return JSON.stringify({
        success: true,
        currentStreak: retentionData.currentStreak,
        highestStreak: retentionData.highestStreak,
        previousStreak: retentionData.previousStreak,
        totalLogins: retentionData.totalLogins,
        currentTier: retentionData.currentTier || "Bronze",
        tierProgress: retentionData.tierProgress || 0,
        triggers,
        streakResult,
        bonusMultiplier: getActiveMultiplier(nk, userId)
    });
}

/**
 * RPC: Claim trigger reward
 */
function rpcClaimTriggerReward(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { triggerId, triggerType } = data;

    if (!triggerId) {
        throw new Error("triggerId is required");
    }

    // Check if already claimed
    const claimKey = `claim_${triggerId}`;
    const existing = nk.storageRead([{
        collection: COLLECTIONS.TRIGGER_HISTORY,
        key: claimKey,
        userId: userId
    }]);

    if (existing.length > 0) {
        return JSON.stringify({
            success: false,
            message: "Reward already claimed"
        });
    }

    // Get retention data for reward calculation
    const retentionData = getRetentionData(nk, userId);

    // Determine reward based on trigger type
    let reward = { coins: 0, xp: 0 };
    let effects = [];

    // Check streak milestones
    if (STREAK_MILESTONES[retentionData.currentStreak]) {
        const milestone = STREAK_MILESTONES[retentionData.currentStreak];
        reward = { ...milestone.reward };
        
        // Handle special effects
        if (reward.bonusDuration) {
            activateBonusHour(nk, userId, reward.bonusMultiplier || 2.0, reward.bonusDuration);
            effects.push("bonus_hour_activated");
        }
        
        if (reward.effect) {
            effects.push(reward.effect);
        }
    }

    // Apply comeback bonus
    if (triggerType === TRIGGER_TYPES.COMEBACK_BONUS) {
        const daysAway = data.daysAway || 3;
        reward.coins = Math.min(daysAway * 50, 500);
        reward.xp = reward.coins / 2;
    }

    // Award coins
    if (reward.coins > 0) {
        const multiplier = getActiveMultiplier(nk, userId);
        const finalCoins = Math.floor(reward.coins * multiplier);
        
        try {
            nk.walletUpdate(userId, { coins: finalCoins }, { 
                reason: `trigger_${triggerType}`,
                triggerId: triggerId
            }, true);
            reward.coinsAwarded = finalCoins;
        } catch (e) {
            logger.error(`Failed to award coins: ${e.message}`);
        }
    }

    // Award XP (to season pass)
    if (reward.xp > 0) {
        updateUserXP(nk, userId, reward.xp);
    }

    // Award items
    if (reward.item) {
        awardItem(nk, userId, reward.item, `trigger_${triggerId}`);
        effects.push(`item_${reward.item}`);
    }

    // Record claim
    nk.storageWrite([{
        collection: COLLECTIONS.TRIGGER_HISTORY,
        key: claimKey,
        userId: userId,
        value: {
            triggerId,
            triggerType,
            reward,
            effects,
            claimedAt: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} claimed trigger ${triggerId}: ${JSON.stringify(reward)}`);

    return JSON.stringify({
        success: true,
        reward,
        effects,
        message: getRewardMessage(triggerType, reward)
    });
}

/**
 * RPC: Get retention status
 */
function rpcGetRetentionStatus(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const retentionData = getRetentionData(nk, userId);
    const now = Date.now();

    // Calculate time until streak breaks
    const lastLogin = retentionData.lastLoginDate;
    let hoursUntilStreakBreaks = 24;
    
    if (lastLogin) {
        const lastLoginTime = new Date(lastLogin).getTime();
        const breakTime = lastLoginTime + (24 * 60 * 60 * 1000);
        hoursUntilStreakBreaks = Math.max(0, (breakTime - now) / (1000 * 60 * 60));
    }

    // Get bonus hour status
    const bonusHour = getBonusHourStatus(nk, userId);

    // Get next milestone
    const nextMilestone = getNextMilestone(retentionData.currentStreak);

    // Get tier info
    const tierInfo = getTierInfo(retentionData.totalXP || 0);

    return JSON.stringify({
        currentStreak: retentionData.currentStreak || 0,
        highestStreak: retentionData.highestStreak || 0,
        totalLogins: retentionData.totalLogins || 0,
        lastLoginDate: retentionData.lastLoginDate,
        hoursUntilStreakBreaks,
        isStreakInDanger: hoursUntilStreakBreaks <= 4,
        nextMilestone,
        daysToNextMilestone: nextMilestone ? nextMilestone.day - retentionData.currentStreak : 0,
        bonusHour,
        tier: tierInfo,
        currentRank: retentionData.currentRank || 0,
        previousRank: retentionData.previousRank || 0
    });
}

/**
 * RPC: Activate bonus hour manually (for testing or purchases)
 */
function rpcActivateBonusHour(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { multiplier = 2.0, duration = 60 } = data;

    activateBonusHour(nk, userId, multiplier, duration);

    logger.info(`User ${userId} activated bonus hour: ${multiplier}x for ${duration}min`);

    return JSON.stringify({
        success: true,
        multiplier,
        duration,
        expiresAt: Date.now() + (duration * 60 * 1000)
    });
}

/**
 * RPC: Record rank snapshot (called periodically or after ranking changes)
 */
function rpcRecordRankSnapshot(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { leaderboardId, rank, score } = data;

    const retentionData = getRetentionData(nk, userId);
    
    // Store previous rank
    retentionData.previousRank = retentionData.currentRank || rank;
    retentionData.currentRank = rank;
    retentionData.lastRankUpdate = Date.now();

    saveRetentionData(nk, userId, retentionData);

    // Store snapshot
    nk.storageWrite([{
        collection: COLLECTIONS.RANK_SNAPSHOTS,
        key: `${leaderboardId}_${Date.now()}`,
        userId: userId,
        value: {
            leaderboardId,
            rank,
            score,
            timestamp: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    return JSON.stringify({
        success: true,
        currentRank: rank,
        previousRank: retentionData.previousRank,
        rankChange: retentionData.previousRank - rank
    });
}

// Helper functions
function getRetentionData(nk, userId) {
    const data = nk.storageRead([{
        collection: COLLECTIONS.RETENTION_DATA,
        key: "data",
        userId: userId
    }]);

    return data.length > 0 ? data[0].value : {
        currentStreak: 0,
        highestStreak: 0,
        previousStreak: 0,
        totalLogins: 0,
        lastLoginDate: null,
        currentTier: "Bronze",
        tierProgress: 0,
        totalXP: 0,
        currentRank: 0,
        previousRank: 0
    };
}

function saveRetentionData(nk, userId, data) {
    nk.storageWrite([{
        collection: COLLECTIONS.RETENTION_DATA,
        key: "data",
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function processStreakMilestone(nk, userId, retentionData, now) {
    const streak = retentionData.currentStreak;
    const milestone = STREAK_MILESTONES[streak];

    if (!milestone) return null;

    // Check if already claimed today
    const claimKey = `milestone_${streak}_${new Date(now).toISOString().split('T')[0]}`;
    const existing = nk.storageRead([{
        collection: COLLECTIONS.TRIGGER_HISTORY,
        key: claimKey,
        userId: userId
    }]);

    if (existing.length > 0) return null;

    return {
        id: `${milestone.type}_${streak}_${now}`,
        type: milestone.type,
        title: milestone.title,
        message: milestone.message,
        emoji: milestone.title.split(' ')[0],
        reward: milestone.reward,
        priority: streak >= 7 ? 5 : streak >= 3 ? 3 : 1,
        streakDay: streak,
        expiresAt: now + (24 * 60 * 60 * 1000)
    };
}

function createComebackTrigger(daysAway, now) {
    const bonusCoins = Math.min(daysAway * 50, 500);

    return {
        id: `comeback_${now}`,
        type: TRIGGER_TYPES.COMEBACK_BONUS,
        title: "🎉 Welcome Back Champion!",
        message: `We missed you for ${daysAway} days! Here's your comeback bonus!`,
        emoji: "🎉",
        reward: { coins: bonusCoins, xp: bonusCoins / 2 },
        priority: 5,
        daysAway,
        expiresAt: now + (24 * 60 * 60 * 1000)
    };
}

function checkLeaderboardDecay(nk, userId, retentionData, now) {
    const currentRank = retentionData.currentRank || 0;
    const previousRank = retentionData.previousRank || 0;

    if (currentRank <= 0 || previousRank <= 0) return null;

    const rankDrop = currentRank - previousRank;

    if (rankDrop >= 5) {
        return {
            id: `decay_${now}`,
            type: TRIGGER_TYPES.LEADERBOARD_DECAY,
            title: "📉 Your Rank is Slipping!",
            message: `You've dropped from #${previousRank} to #${currentRank}! Play now to reclaim your spot!`,
            emoji: "📉",
            reward: { coins: 25, bonusMultiplier: 1.25 },
            priority: 3,
            oldRank: previousRank,
            newRank: currentRank,
            expiresAt: now + (12 * 60 * 60 * 1000)
        };
    }

    return null;
}

function checkTierProgress(nk, userId, retentionData, now) {
    const tierProgress = retentionData.tierProgress || 0;

    if (tierProgress >= 0.8 && tierProgress < 1.0) {
        const currentTier = retentionData.currentTier || "Bronze";
        const nextTier = getNextTier(currentTier);
        const remaining = Math.floor((1.0 - tierProgress) * getTierXPRequirement(nextTier));

        return {
            id: `tier_${now}`,
            type: TRIGGER_TYPES.TIER_PROGRESSION,
            title: `⬆️ ${nextTier} is Within Reach!`,
            message: `Just ${remaining} XP away from ${nextTier}! Complete a quick trivia!`,
            emoji: "⬆️",
            reward: { xp: 50 },
            priority: 4,
            currentTier,
            nextTier,
            remaining,
            expiresAt: now + (24 * 60 * 60 * 1000)
        };
    }

    return null;
}

function checkUpcomingMatches(nk, userId, now) {
    // Check for matches in the next 2-6 hours
    const schedules = nk.storageList(null, "cricket_schedules", 50, null);
    
    for (const schedule of (schedules.objects || [])) {
        const match = schedule.value;
        const matchTime = new Date(match.matchTime).getTime();
        const hoursUntil = (matchTime - now) / (1000 * 60 * 60);

        if (hoursUntil >= 2 && hoursUntil <= 6) {
            // Check if user has predicted
            const prediction = nk.storageRead([{
                collection: "cricket_predictions",
                key: `${userId}_${match.matchId}`,
                userId: userId
            }]);

            if (prediction.length === 0) {
                return {
                    id: `fomo_${match.matchId}_${now}`,
                    type: TRIGGER_TYPES.FOMO,
                    title: `🏏 Match in ${Math.floor(hoursUntil)} Hours!`,
                    message: `${match.team1} vs ${match.team2} - Predict NOW for max points!`,
                    emoji: "🏏",
                    reward: { xp: 25 },
                    priority: 4,
                    matchId: match.matchId,
                    team1: match.team1,
                    team2: match.team2,
                    expiresAt: matchTime
                };
            }
        }
    }

    return null;
}

function checkFriendProgress(nk, userId, retentionData, now) {
    // This would check friend leaderboard standings
    // For now, return null - would need friend system integration
    return null;
}

function activateBonusHour(nk, userId, multiplier, duration) {
    const now = Date.now();
    const expiresAt = now + (duration * 60 * 1000);

    nk.storageWrite([{
        collection: COLLECTIONS.BONUS_HOURS,
        key: "active",
        userId: userId,
        value: {
            multiplier,
            startedAt: now,
            expiresAt,
            duration
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function getBonusHourStatus(nk, userId) {
    const bonus = nk.storageRead([{
        collection: COLLECTIONS.BONUS_HOURS,
        key: "active",
        userId: userId
    }]);

    if (bonus.length === 0) return null;

    const data = bonus[0].value;
    const now = Date.now();

    if (now >= data.expiresAt) {
        // Expired, clean up
        nk.storageDelete([{
            collection: COLLECTIONS.BONUS_HOURS,
            key: "active",
            userId: userId
        }]);
        return null;
    }

    return {
        active: true,
        multiplier: data.multiplier,
        remainingMinutes: Math.floor((data.expiresAt - now) / (1000 * 60)),
        expiresAt: data.expiresAt
    };
}

function getActiveMultiplier(nk, userId) {
    const bonusHour = getBonusHourStatus(nk, userId);
    return bonusHour?.multiplier || 1.0;
}

function getNextMilestone(currentStreak) {
    const milestones = [3, 7, 14, 30, 60, 90, 180, 365];
    
    for (const day of milestones) {
        if (currentStreak < day) {
            return {
                day,
                daysRemaining: day - currentStreak,
                reward: STREAK_MILESTONES[day]
            };
        }
    }
    return null;
}

function getNextTier(currentTier) {
    const tierOrder = ["Bronze", "Silver", "Gold", "Platinum", "Diamond", "Master", "Legend"];
    const index = tierOrder.indexOf(currentTier);
    return index < tierOrder.length - 1 ? tierOrder[index + 1] : currentTier;
}

function getTierXPRequirement(tier) {
    const requirements = {
        Silver: 1000,
        Gold: 2500,
        Platinum: 5000,
        Diamond: 10000,
        Master: 25000,
        Legend: 50000
    };
    return requirements[tier] || 1000;
}

function getTierInfo(totalXP) {
    const tiers = [
        { name: "Bronze", min: 0 },
        { name: "Silver", min: 1000 },
        { name: "Gold", min: 2500 },
        { name: "Platinum", min: 5000 },
        { name: "Diamond", min: 10000 },
        { name: "Master", min: 25000 },
        { name: "Legend", min: 50000 }
    ];

    let current = tiers[0];
    let next = tiers[1];

    for (let i = 0; i < tiers.length; i++) {
        if (totalXP >= tiers[i].min) {
            current = tiers[i];
            next = tiers[i + 1] || current;
        }
    }

    const progress = next ? (totalXP - current.min) / (next.min - current.min) : 1.0;

    return {
        current: current.name,
        next: next?.name || current.name,
        totalXP,
        progress: Math.min(progress, 1.0),
        xpToNext: next ? next.min - totalXP : 0
    };
}

function updateUserXP(nk, userId, xpGained) {
    const retentionData = getRetentionData(nk, userId);
    retentionData.totalXP = (retentionData.totalXP || 0) + xpGained;
    
    // Update tier progress
    const tierInfo = getTierInfo(retentionData.totalXP);
    retentionData.currentTier = tierInfo.current;
    retentionData.tierProgress = tierInfo.progress;

    saveRetentionData(nk, userId, retentionData);
}

function awardItem(nk, userId, itemId, source) {
    nk.storageWrite([{
        collection: "cricket_inventory",
        key: `${itemId}_${Date.now()}`,
        userId: userId,
        value: {
            itemId,
            source,
            awardedAt: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function logStreakHistory(nk, userId, streak, result) {
    nk.storageWrite([{
        collection: COLLECTIONS.STREAK_HISTORY,
        key: `${Date.now()}`,
        userId: userId,
        value: {
            streak,
            continued: result.continued,
            broken: result.broken,
            isNew: result.isNew,
            daysAway: result.daysAway,
            timestamp: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function getRewardMessage(triggerType, reward) {
    const coinMsg = reward.coins ? `+${reward.coinsAwarded || reward.coins} coins` : "";
    const xpMsg = reward.xp ? `+${reward.xp} XP` : "";
    
    const parts = [coinMsg, xpMsg].filter(p => p);
    return parts.length > 0 ? `Claimed: ${parts.join(", ")}!` : "Reward claimed!";
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Retention Module loaded");

    initializer.registerRpc("cricket_process_daily_login", rpcProcessDailyLogin);
    initializer.registerRpc("cricket_claim_trigger_reward", rpcClaimTriggerReward);
    initializer.registerRpc("cricket_get_retention_status", rpcGetRetentionStatus);
    initializer.registerRpc("cricket_activate_bonus_hour", rpcActivateBonusHour);
    initializer.registerRpc("cricket_record_rank_snapshot", rpcRecordRankSnapshot);

    logger.info("Cricket Retention Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

