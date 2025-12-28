/**
 * Prestige & Category Mastery System
 * Rewards deep engagement with specific categories and long-term progression
 * 
 * Impact: D30 +10% retention, increases session duration
 */

// ============================================================================
// MASTERY CONFIGURATION
// ============================================================================

var MASTERY_CONFIG = {
    // XP needed for each level in a category
    levels: [
        0,      // Level 0
        100,    // Level 1
        250,    // Level 2
        500,    // Level 3 (Bronze Badge)
        1000,   // Level 4
        2000,   // Level 5 (Silver Badge)
        4000,   // Level 6
        8000,   // Level 7 (Gold Badge)
        15000,  // Level 8
        30000   // Level 9 (Platinum Badge)
    ],
    
    // Rewards for reaching levels
    rewards: {
        3: { coins: 500, badge: "bronze" },
        5: { coins: 1500, gems: 20, badge: "silver" },
        7: { coins: 5000, gems: 100, badge: "gold" },
        9: { coins: 15000, gems: 500, badge: "platinum" }
    },
    
    // Prestige configuration
    prestige: {
        maxMasteryLevel: 9,
        prestigeLevels: [
            { id: 1, name: "Novice", xpBoost: 1.1, coinBoost: 1.05, requirements: { totalMastery: 5 } },
            { id: 2, name: "Scholar", xpBoost: 1.2, coinBoost: 1.1, requirements: { totalMastery: 15 } },
            { id: 3, name: "Sage", xpBoost: 1.5, coinBoost: 1.2, requirements: { totalMastery: 40 } },
            { id: 4, name: "Master", xpBoost: 2.0, coinBoost: 1.5, requirements: { totalMastery: 80 } },
            { id: 5, name: "Legend", xpBoost: 3.0, coinBoost: 2.0, requirements: { totalMastery: 150 } }
        ]
    }
};

// ============================================================================
// STORAGE KEYS
// ============================================================================

var STORAGE_COLLECTION = "progression";
var STORAGE_KEY_MASTERY = "category_mastery";
var STORAGE_KEY_PRESTIGE = "prestige_data";

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getMasteryData(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION,
            key: STORAGE_KEY_MASTERY,
            userId: userId
        }]);
        
        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }
    
    return {
        categories: {}, // categoryId -> { xp, level, badges: [] }
        totalMasteryLevel: 0,
        lastUpdated: Date.now()
    };
}

function getPrestigeData(nk, userId) {
    try {
        var objects = nk.storageRead([{
            collection: STORAGE_COLLECTION,
            key: STORAGE_KEY_PRESTIGE,
            userId: userId
        }]);
        
        if (objects && objects.length > 0) {
            return objects[0].value;
        }
    } catch (e) {
        // No data yet
    }
    
    return {
        prestigeLevel: 0,
        unlockedPrestigeNames: [],
        currentXpBoost: 1.0,
        currentCoinBoost: 1.0,
        lastUpdated: Date.now()
    };
}

function saveMasteryData(nk, userId, data) {
    data.lastUpdated = Date.now();
    nk.storageWrite([{
        collection: STORAGE_COLLECTION,
        key: STORAGE_KEY_MASTERY,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function savePrestigeData(nk, userId, data) {
    data.lastUpdated = Date.now();
    nk.storageWrite([{
        collection: STORAGE_COLLECTION,
        key: STORAGE_KEY_PRESTIGE,
        userId: userId,
        value: data,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function calculateLevel(xp) {
    var level = 0;
    for (var i = 0; i < MASTERY_CONFIG.levels.length; i++) {
        if (xp >= MASTERY_CONFIG.levels[i]) {
            level = i;
        } else {
            break;
        }
    }
    return level;
}

// ============================================================================
// RPC FUNCTIONS
// ============================================================================

/**
 * Add XP to a category after a quiz
 * Payload: { categoryId: string, xp: number }
 */
function rpcAddMasteryXp(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var request = {};
    try {
        request = JSON.parse(payload || "{}");
    } catch (e) {
        return JSON.stringify({ success: false, error: "Invalid payload" });
    }
    
    var categoryId = request.categoryId;
    var xpToAdd = request.xp || 0;
    
    if (!categoryId) {
        return JSON.stringify({ success: false, error: "Category ID required" });
    }
    
    var masteryData = getMasteryData(nk, ctx.userId);
    var prestigeData = getPrestigeData(nk, ctx.userId);
    
    // Apply prestige boost
    var boostedXp = Math.floor(xpToAdd * (prestigeData.currentXpBoost || 1.0));
    
    if (!masteryData.categories[categoryId]) {
        masteryData.categories[categoryId] = { xp: 0, level: 0, badges: [] };
    }
    
    var oldLevel = masteryData.categories[categoryId].level;
    masteryData.categories[categoryId].xp += boostedXp;
    var newLevel = calculateLevel(masteryData.categories[categoryId].xp);
    
    var levelUps = [];
    if (newLevel > oldLevel) {
        masteryData.categories[categoryId].level = newLevel;
        
        // Grant rewards for each level up
        for (var l = oldLevel + 1; l <= newLevel; l++) {
            var reward = MASTERY_CONFIG.rewards[l];
            if (reward) {
                // Grant rewards to wallet
                var walletChanges = {};
                if (reward.coins) walletChanges.coins = reward.coins;
                if (reward.gems) walletChanges.gems = reward.gems;
                
                if (Object.keys(walletChanges).length > 0) {
                    nk.walletUpdate(ctx.userId, walletChanges, {}, true);
                }
                
                if (reward.badge) {
                    masteryData.categories[categoryId].badges.push(reward.badge);
                }
                
                levelUps.push({ level: l, reward: reward });
            } else {
                levelUps.push({ level: l });
            }
        }
        
        // Update total mastery level
        var total = 0;
        for (var cat in masteryData.categories) {
            total += masteryData.categories[cat].level;
        }
        masteryData.totalMasteryLevel = total;
    }
    
    saveMasteryData(nk, ctx.userId, masteryData);
    
    return JSON.stringify({
        success: true,
        data: {
            categoryId: categoryId,
            addedXp: boostedXp,
            totalXp: masteryData.categories[categoryId].xp,
            level: newLevel,
            levelUps: levelUps,
            totalMasteryLevel: masteryData.totalMasteryLevel
        }
    });
}

/**
 * Get current mastery and prestige state
 */
function rpcGetProgressionState(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var masteryData = getMasteryData(nk, ctx.userId);
    var prestigeData = getPrestigeData(nk, ctx.userId);
    
    // Check if new prestige levels are available
    var nextPrestige = null;
    for (var i = 0; i < MASTERY_CONFIG.prestige.prestigeLevels.length; i++) {
        var p = MASTERY_CONFIG.prestige.prestigeLevels[i];
        if (p.id > prestigeData.prestigeLevel) {
            var met = masteryData.totalMasteryLevel >= p.requirements.totalMastery;
            nextPrestige = {
                id: p.id,
                name: p.name,
                requirements: p.requirements,
                met: met,
                xpBoost: p.xpBoost,
                coinBoost: p.coinBoost
            };
            break;
        }
    }
    
    return JSON.stringify({
        success: true,
        data: {
            mastery: masteryData,
            prestige: prestigeData,
            nextPrestige: nextPrestige,
            levelConfig: MASTERY_CONFIG.levels
        }
    });
}

/**
 * Claim a prestige level if requirements are met
 */
function rpcClaimPrestige(ctx, logger, nk, payload) {
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "Not authenticated" });
    }
    
    var masteryData = getMasteryData(nk, ctx.userId);
    var prestigeData = getPrestigeData(nk, ctx.userId);
    
    var nextLevelId = prestigeData.prestigeLevel + 1;
    var nextLevelConfig = null;
    
    for (var i = 0; i < MASTERY_CONFIG.prestige.prestigeLevels.length; i++) {
        if (MASTERY_CONFIG.prestige.prestigeLevels[i].id === nextLevelId) {
            nextLevelConfig = MASTERY_CONFIG.prestige.prestigeLevels[i];
            break;
        }
    }
    
    if (!nextLevelConfig) {
        return JSON.stringify({ success: false, error: "No more prestige levels" });
    }
    
    if (masteryData.totalMasteryLevel < nextLevelConfig.requirements.totalMastery) {
        return JSON.stringify({ success: false, error: "Requirements not met" });
    }
    
    // Update prestige
    prestigeData.prestigeLevel = nextLevelConfig.id;
    prestigeData.unlockedPrestigeNames.push(nextLevelConfig.name);
    prestigeData.currentXpBoost = nextLevelConfig.xpBoost;
    prestigeData.currentCoinBoost = nextLevelConfig.coinBoost;
    
    savePrestigeData(nk, ctx.userId, prestigeData);
    
    logger.info("User " + ctx.userId + " reached prestige level " + nextLevelConfig.id + " (" + nextLevelConfig.name + ")");
    
    return JSON.stringify({
        success: true,
        data: {
            prestigeLevel: prestigeData.prestigeLevel,
            name: nextLevelConfig.name,
            xpBoost: prestigeData.currentXpBoost,
            coinBoost: prestigeData.currentCoinBoost
        }
    });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    rpcAddMasteryXp: rpcAddMasteryXp,
    rpcGetProgressionState: rpcGetProgressionState,
    rpcClaimPrestige: rpcClaimPrestige
};


