/**
 * Cricket Season Pass Module
 * 
 * Manages the IPL/World Cup 2026 Season Pass:
 * - XP progression
 * - Tier rewards
 * - Premium pass benefits
 * - Season-specific content
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// Collections
const COLLECTIONS = {
    SEASON_PASS: "cricket_season_pass",
    XP_HISTORY: "cricket_xp_history",
    CLAIMED_REWARDS: "cricket_claimed_rewards"
};

// Season configuration
const SEASONS = {
    WORLDCUP_2026: {
        id: "worldcup_2026",
        name: "ICC T20 World Cup 2026",
        startDate: "2026-02-01",
        endDate: "2026-03-15",
        maxLevel: 50,
        xpPerLevel: 1000,
        theme: "national_pride"
    },
    IPL_2026: {
        id: "ipl_2026",
        name: "IPL 2026 Season",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
        maxLevel: 50,
        xpPerLevel: 1000,
        theme: "franchise_glory"
    }
};

// XP sources
const XP_SOURCES = {
    DAILY_LOGIN: 50,
    TRIVIA_COMPLETION: 100,
    PREDICTION_MADE: 75,
    CORRECT_PREDICTION: 200,
    PERFECT_PREDICTION: 500,
    DAILY_CHALLENGE: 150,
    WEEKLY_TOURNAMENT: 300,
    SHARE_MATCH: 50,
    STREAK_BONUS_PER_DAY: 25,
    MATCH_ENGAGEMENT: 100
};

// Tier rewards (every 5 levels)
const TIER_REWARDS = {
    FREE: [
        { level: 1, reward: { type: "cap", id: "basic_cap", name: "Basic Cap" } },
        { level: 5, reward: { type: "coins", amount: 100 } },
        { level: 10, reward: { type: "cap", id: "team_cap_common", name: "Team Cap" } },
        { level: 15, reward: { type: "coins", amount: 200 } },
        { level: 20, reward: { type: "avatar", id: "cricket_avatar_1", name: "Cricket Avatar" } },
        { level: 25, reward: { type: "cap", id: "country_cap", name: "Country Cap" } },
        { level: 30, reward: { type: "coins", amount: 500 } },
        { level: 35, reward: { type: "jersey_shard", amount: 1 } },
        { level: 40, reward: { type: "cap", id: "gold_cap", name: "Gold Cap" } },
        { level: 45, reward: { type: "coins", amount: 1000 } },
        { level: 50, reward: { type: "title", id: "cricket_master", name: "Cricket Master" } }
    ],
    PREMIUM: [
        { level: 1, reward: { type: "jersey", id: "premium_jersey_1", name: "Premium Jersey" } },
        { level: 5, reward: { type: "coins", amount: 250 } },
        { level: 10, reward: { type: "cap", id: "animated_cap", name: "Animated Cap" } },
        { level: 15, reward: { type: "coins", amount: 500 } },
        { level: 20, reward: { type: "jersey", id: "premium_jersey_2", name: "Elite Jersey" } },
        { level: 25, reward: { type: "cap", id: "legendary_cap", name: "Legendary Cap" } },
        { level: 30, reward: { type: "coins", amount: 1000 } },
        { level: 35, reward: { type: "jersey", id: "champion_jersey", name: "Champion Jersey" } },
        { level: 40, reward: { type: "cap", id: "champion_cap", name: "Champion Cap" } },
        { level: 45, reward: { type: "coins", amount: 2000 } },
        { level: 50, reward: { type: "jersey", id: "legendary_kit", name: "Legendary Complete Kit" } }
    ]
};

/**
 * RPC: Get season pass status
 */
function rpcGetSeasonPassStatus(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const currentSeason = getCurrentSeason();
    
    if (!currentSeason) {
        return JSON.stringify({
            active: false,
            message: "No active season",
            nextSeason: getNextSeason()
        });
    }

    // Get user's season pass data
    const passData = nk.storageRead([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId
    }]);

    const userPass = passData.length > 0 ? passData[0].value : {
        seasonId: currentSeason.id,
        currentXP: 0,
        currentLevel: 1,
        isPremium: false,
        claimedFreeRewards: [],
        claimedPremiumRewards: [],
        createdAt: Date.now()
    };

    // Calculate level progress
    const xpForCurrentLevel = (userPass.currentLevel - 1) * currentSeason.xpPerLevel;
    const xpInCurrentLevel = userPass.currentXP - xpForCurrentLevel;
    const xpToNextLevel = currentSeason.xpPerLevel;
    const progressPercent = Math.floor((xpInCurrentLevel / xpToNextLevel) * 100);

    // Get available rewards
    const availableRewards = getAvailableRewards(userPass);

    return JSON.stringify({
        active: true,
        season: {
            id: currentSeason.id,
            name: currentSeason.name,
            theme: currentSeason.theme,
            endDate: currentSeason.endDate,
            daysRemaining: getDaysRemaining(currentSeason.endDate)
        },
        progress: {
            currentLevel: userPass.currentLevel,
            currentXP: userPass.currentXP,
            xpInCurrentLevel,
            xpToNextLevel,
            progressPercent,
            maxLevel: currentSeason.maxLevel,
            isPremium: userPass.isPremium
        },
        rewards: {
            available: availableRewards,
            claimedFree: userPass.claimedFreeRewards,
            claimedPremium: userPass.claimedPremiumRewards
        },
        tiers: {
            free: TIER_REWARDS.FREE,
            premium: TIER_REWARDS.PREMIUM
        }
    });
}

/**
 * RPC: Add XP to season pass
 * 
 * Payload: {
 *   source: string,
 *   amount: number (optional, uses default if not provided),
 *   metadata: object (optional)
 * }
 */
function rpcAddSeasonXP(context, logger, nk, payload) {
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

    const { source, amount, metadata } = data;

    if (!source) {
        throw new Error("source is required");
    }

    const currentSeason = getCurrentSeason();
    
    if (!currentSeason) {
        return JSON.stringify({ success: false, message: "No active season" });
    }

    // Get XP amount from source or use provided amount
    const xpAmount = amount || XP_SOURCES[source.toUpperCase()] || 0;

    if (xpAmount <= 0) {
        return JSON.stringify({ success: false, message: "Invalid XP amount" });
    }

    // Get user's season pass data
    const passData = nk.storageRead([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId
    }]);

    const userPass = passData.length > 0 ? passData[0].value : {
        seasonId: currentSeason.id,
        currentXP: 0,
        currentLevel: 1,
        isPremium: false,
        claimedFreeRewards: [],
        claimedPremiumRewards: [],
        createdAt: Date.now()
    };

    // Apply premium bonus if applicable
    const finalXP = userPass.isPremium ? Math.floor(xpAmount * 1.5) : xpAmount;

    const previousLevel = userPass.currentLevel;
    userPass.currentXP += finalXP;

    // Calculate new level
    const newLevel = Math.min(
        Math.floor(userPass.currentXP / currentSeason.xpPerLevel) + 1,
        currentSeason.maxLevel
    );
    userPass.currentLevel = newLevel;

    const levelsGained = newLevel - previousLevel;

    // Save updated pass
    nk.storageWrite([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId,
        value: userPass,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Log XP gain
    nk.storageWrite([{
        collection: COLLECTIONS.XP_HISTORY,
        key: `${currentSeason.id}_${Date.now()}`,
        userId: userId,
        value: {
            source,
            amount: finalXP,
            previousXP: userPass.currentXP - finalXP,
            newXP: userPass.currentXP,
            previousLevel,
            newLevel,
            metadata,
            timestamp: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} gained ${finalXP} XP (${source}), now level ${newLevel}`);

    // Check for newly available rewards
    const newRewards = [];
    if (levelsGained > 0) {
        for (let level = previousLevel + 1; level <= newLevel; level++) {
            const freeReward = TIER_REWARDS.FREE.find(r => r.level === level);
            if (freeReward) {
                newRewards.push({ tier: 'free', ...freeReward });
            }
            if (userPass.isPremium) {
                const premiumReward = TIER_REWARDS.PREMIUM.find(r => r.level === level);
                if (premiumReward) {
                    newRewards.push({ tier: 'premium', ...premiumReward });
                }
            }
        }
    }

    return JSON.stringify({
        success: true,
        xpGained: finalXP,
        premiumBonus: userPass.isPremium ? Math.floor(xpAmount * 0.5) : 0,
        currentXP: userPass.currentXP,
        currentLevel: userPass.currentLevel,
        previousLevel,
        levelsGained,
        newRewards
    });
}

/**
 * RPC: Claim season pass reward
 * 
 * Payload: {
 *   level: number,
 *   tier: "free" | "premium"
 * }
 */
function rpcClaimSeasonReward(context, logger, nk, payload) {
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

    const { level, tier } = data;

    if (!level || !tier) {
        throw new Error("level and tier are required");
    }

    const currentSeason = getCurrentSeason();
    
    if (!currentSeason) {
        return JSON.stringify({ success: false, message: "No active season" });
    }

    // Get user's season pass data
    const passData = nk.storageRead([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId
    }]);

    if (passData.length === 0) {
        return JSON.stringify({ success: false, message: "No season pass data found" });
    }

    const userPass = passData[0].value;

    // Check level requirement
    if (userPass.currentLevel < level) {
        return JSON.stringify({ 
            success: false, 
            message: `Level ${level} required, you are level ${userPass.currentLevel}` 
        });
    }

    // Check premium requirement
    if (tier === 'premium' && !userPass.isPremium) {
        return JSON.stringify({ success: false, message: "Premium pass required" });
    }

    // Find reward
    const rewardList = tier === 'premium' ? TIER_REWARDS.PREMIUM : TIER_REWARDS.FREE;
    const rewardEntry = rewardList.find(r => r.level === level);

    if (!rewardEntry) {
        return JSON.stringify({ success: false, message: "Reward not found for this level" });
    }

    // Check if already claimed
    const claimedList = tier === 'premium' ? userPass.claimedPremiumRewards : userPass.claimedFreeRewards;
    if (claimedList.includes(level)) {
        return JSON.stringify({ success: false, message: "Reward already claimed" });
    }

    // Award reward
    const reward = rewardEntry.reward;
    let awardedItem = null;

    switch (reward.type) {
        case 'coins':
            try {
                nk.walletUpdate(userId, { coins: reward.amount }, { reason: `season_pass_${tier}_${level}` }, true);
                awardedItem = { type: 'coins', amount: reward.amount };
            } catch (e) {
                logger.error(`Failed to award coins: ${e.message}`);
            }
            break;

        case 'cap':
        case 'jersey':
        case 'avatar':
        case 'title':
            // Store item in user's inventory
            nk.storageWrite([{
                collection: 'cricket_inventory',
                key: `${reward.type}_${reward.id}`,
                userId: userId,
                value: {
                    type: reward.type,
                    id: reward.id,
                    name: reward.name,
                    source: `season_pass_${tier}_${level}`,
                    acquiredAt: Date.now()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
            awardedItem = { type: reward.type, id: reward.id, name: reward.name };
            break;

        case 'jersey_shard':
            // Store shard
            nk.storageWrite([{
                collection: 'cricket_shards',
                key: `shard_${Date.now()}`,
                userId: userId,
                value: {
                    type: 'jersey_shard',
                    amount: reward.amount,
                    source: `season_pass_${tier}_${level}`,
                    acquiredAt: Date.now()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
            awardedItem = { type: 'jersey_shard', amount: reward.amount };
            break;
    }

    // Mark as claimed
    claimedList.push(level);
    
    if (tier === 'premium') {
        userPass.claimedPremiumRewards = claimedList;
    } else {
        userPass.claimedFreeRewards = claimedList;
    }

    // Save updated pass
    nk.storageWrite([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId,
        value: userPass,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} claimed ${tier} reward at level ${level}: ${JSON.stringify(awardedItem)}`);

    return JSON.stringify({
        success: true,
        level,
        tier,
        reward: awardedItem,
        claimedCount: {
            free: userPass.claimedFreeRewards.length,
            premium: userPass.claimedPremiumRewards.length
        }
    });
}

/**
 * RPC: Upgrade to premium pass
 * 
 * Called after IAP verification
 */
function rpcUpgradeToPremium(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    const currentSeason = getCurrentSeason();
    
    if (!currentSeason) {
        return JSON.stringify({ success: false, message: "No active season" });
    }

    // Get user's season pass data
    const passData = nk.storageRead([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId
    }]);

    const userPass = passData.length > 0 ? passData[0].value : {
        seasonId: currentSeason.id,
        currentXP: 0,
        currentLevel: 1,
        isPremium: false,
        claimedFreeRewards: [],
        claimedPremiumRewards: [],
        createdAt: Date.now()
    };

    if (userPass.isPremium) {
        return JSON.stringify({ success: false, message: "Already premium" });
    }

    userPass.isPremium = true;
    userPass.premiumUpgradeDate = Date.now();

    // Calculate retroactive rewards (premium rewards for already reached levels)
    const retroactiveRewards = [];
    for (const rewardEntry of TIER_REWARDS.PREMIUM) {
        if (rewardEntry.level <= userPass.currentLevel && !userPass.claimedPremiumRewards.includes(rewardEntry.level)) {
            retroactiveRewards.push({
                level: rewardEntry.level,
                reward: rewardEntry.reward
            });
        }
    }

    // Save updated pass
    nk.storageWrite([{
        collection: COLLECTIONS.SEASON_PASS,
        key: currentSeason.id,
        userId: userId,
        value: userPass,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} upgraded to premium pass`);

    return JSON.stringify({
        success: true,
        isPremium: true,
        currentLevel: userPass.currentLevel,
        retroactiveRewards,
        message: `Welcome to Premium! You have ${retroactiveRewards.length} rewards waiting to be claimed!`
    });
}

// Helper functions
function getCurrentSeason() {
    const now = new Date();
    
    for (const season of Object.values(SEASONS)) {
        const start = new Date(season.startDate);
        const end = new Date(season.endDate);
        
        if (now >= start && now <= end) {
            return season;
        }
    }
    
    // For development, return World Cup if before any season
    return SEASONS.WORLDCUP_2026;
}

function getNextSeason() {
    const now = new Date();
    
    for (const season of Object.values(SEASONS)) {
        const start = new Date(season.startDate);
        
        if (now < start) {
            return {
                id: season.id,
                name: season.name,
                startDate: season.startDate,
                daysUntilStart: Math.ceil((start - now) / (1000 * 60 * 60 * 24))
            };
        }
    }
    
    return null;
}

function getDaysRemaining(endDate) {
    const end = new Date(endDate);
    const now = new Date();
    return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
}

function getAvailableRewards(userPass) {
    const available = [];
    
    for (const rewardEntry of TIER_REWARDS.FREE) {
        if (rewardEntry.level <= userPass.currentLevel && !userPass.claimedFreeRewards.includes(rewardEntry.level)) {
            available.push({ tier: 'free', level: rewardEntry.level, reward: rewardEntry.reward });
        }
    }
    
    if (userPass.isPremium) {
        for (const rewardEntry of TIER_REWARDS.PREMIUM) {
            if (rewardEntry.level <= userPass.currentLevel && !userPass.claimedPremiumRewards.includes(rewardEntry.level)) {
                available.push({ tier: 'premium', level: rewardEntry.level, reward: rewardEntry.reward });
            }
        }
    }
    
    return available;
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Season Pass Module loaded");

    initializer.registerRpc("cricket_get_season_pass", rpcGetSeasonPassStatus);
    initializer.registerRpc("cricket_add_season_xp", rpcAddSeasonXP);
    initializer.registerRpc("cricket_claim_season_reward", rpcClaimSeasonReward);
    initializer.registerRpc("cricket_upgrade_to_premium", rpcUpgradeToPremium);

    logger.info("Cricket Season Pass Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

