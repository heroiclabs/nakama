// collections.js - Collection & Prestige System for D30 Retention
// Provides long-term collectible goals and prestige progression

/**
 * Collections & Prestige System
 * 
 * Features:
 * - Avatar, Badge, Title, Frame collections
 * - Category Mastery system
 * - Prestige levels with permanent bonuses
 * - Collection completion rewards
 * - Per-game support
 */

// Collection categories and items
var COLLECTIONS = {
    avatars: {
        name: "Avatars",
        items: {
            // Common (unlocked easily)
            "avatar_default": { name: "Default", rarity: "common", unlockMethod: "default" },
            "avatar_quiz_starter": { name: "Quiz Starter", rarity: "common", unlockMethod: "complete_first_quiz" },
            "avatar_streak_3": { name: "Streaker", rarity: "common", unlockMethod: "streak_3" },
            
            // Rare (from achievements)
            "avatar_science_expert": { name: "Science Expert", rarity: "rare", unlockMethod: "science_mastery_3" },
            "avatar_history_buff": { name: "History Buff", rarity: "rare", unlockMethod: "history_mastery_3" },
            "avatar_speed_demon": { name: "Speed Demon", rarity: "rare", unlockMethod: "speed_round_100" },
            
            // Epic (from events/season)
            "avatar_season_12": { name: "Season 12", rarity: "epic", unlockMethod: "season_pass_25" },
            "avatar_tournament_winner": { name: "Tournament Champion", rarity: "epic", unlockMethod: "tournament_1st" },
            "avatar_creator_pro": { name: "Creator Pro", rarity: "epic", unlockMethod: "create_10_quizzes" },
            
            // Legendary (very hard)
            "avatar_prestige_5": { name: "Prestige Master", rarity: "legendary", unlockMethod: "prestige_5" },
            "avatar_monthly_legend": { name: "Monthly Legend", rarity: "legendary", unlockMethod: "monthly_milestones_all" },
            "avatar_100_streak": { name: "Century Streak", rarity: "legendary", unlockMethod: "streak_100" }
        }
    },
    badges: {
        name: "Badges",
        items: {
            "badge_first_quiz": { name: "First Steps", rarity: "common", unlockMethod: "complete_first_quiz" },
            "badge_10_quizzes": { name: "Quiz Enthusiast", rarity: "common", unlockMethod: "complete_10_quizzes" },
            "badge_50_quizzes": { name: "Quiz Master", rarity: "rare", unlockMethod: "complete_50_quizzes" },
            "badge_100_quizzes": { name: "Quiz Legend", rarity: "epic", unlockMethod: "complete_100_quizzes" },
            "badge_accuracy_90": { name: "Sharpshooter", rarity: "rare", unlockMethod: "accuracy_90" },
            "badge_perfect_quiz": { name: "Perfectionist", rarity: "epic", unlockMethod: "perfect_quiz" },
            "badge_multiplayer_10": { name: "Challenger", rarity: "rare", unlockMethod: "win_10_multiplayer" },
            "badge_friend_inviter": { name: "Social Butterfly", rarity: "rare", unlockMethod: "invite_5_friends" },
            "badge_guild_leader": { name: "Guild Leader", rarity: "epic", unlockMethod: "create_guild" },
            "badge_all_categories": { name: "Renaissance", rarity: "legendary", unlockMethod: "mastery_all_categories" }
        }
    },
    titles: {
        name: "Titles",
        items: {
            "title_newbie": { name: "Newbie", rarity: "common", unlockMethod: "default" },
            "title_quizzer": { name: "Quizzer", rarity: "common", unlockMethod: "complete_10_quizzes" },
            "title_scholar": { name: "Scholar", rarity: "rare", unlockMethod: "level_20" },
            "title_professor": { name: "Professor", rarity: "rare", unlockMethod: "level_50" },
            "title_champion": { name: "Champion", rarity: "epic", unlockMethod: "tournament_1st" },
            "title_creator": { name: "Content Creator", rarity: "rare", unlockMethod: "create_5_quizzes" },
            "title_legend": { name: "Legend", rarity: "legendary", unlockMethod: "prestige_3" },
            "title_master": { name: "Grand Master", rarity: "legendary", unlockMethod: "prestige_5" }
        }
    },
    frames: {
        name: "Frames",
        items: {
            "frame_default": { name: "Default", rarity: "common", unlockMethod: "default" },
            "frame_bronze": { name: "Bronze", rarity: "common", unlockMethod: "prestige_1" },
            "frame_silver": { name: "Silver", rarity: "rare", unlockMethod: "prestige_2" },
            "frame_gold": { name: "Gold", rarity: "epic", unlockMethod: "prestige_3" },
            "frame_platinum": { name: "Platinum", rarity: "epic", unlockMethod: "prestige_4" },
            "frame_diamond": { name: "Diamond", rarity: "legendary", unlockMethod: "prestige_5" },
            "frame_season": { name: "Season Pass", rarity: "rare", unlockMethod: "season_pass_50" }
        }
    }
};

// Category mastery configuration
var MASTERY_CATEGORIES = [
    "Science", "History", "Geography", "Sports", "Entertainment", 
    "Technology", "Art", "Literature", "Nature", "General"
];

var MASTERY_LEVELS = [
    { level: 1, xpRequired: 0, bonus: 0 },
    { level: 2, xpRequired: 500, bonus: 5 },
    { level: 3, xpRequired: 1500, bonus: 10 },
    { level: 4, xpRequired: 3000, bonus: 15 },
    { level: 5, xpRequired: 5000, bonus: 20 } // Master
];

// Prestige configuration
var PRESTIGE_LEVELS = [
    { level: 0, xpRequired: 0, bonus: 0, frame: null },
    { level: 1, xpRequired: 50000, bonus: 10, frame: "frame_bronze" },
    { level: 2, xpRequired: 150000, bonus: 15, frame: "frame_silver" },
    { level: 3, xpRequired: 300000, bonus: 20, frame: "frame_gold" },
    { level: 4, xpRequired: 500000, bonus: 25, frame: "frame_platinum" },
    { level: 5, xpRequired: 1000000, bonus: 30, frame: "frame_diamond" }
];

/**
 * Read collection data for user
 */
function getCollectionData(nk, logger, userId, gameId) {
    var collection = "user_collections";
    var key = "data_" + userId + "_" + gameId;
    
    try {
        var records = nk.storageRead([{
            collection: collection,
            key: key,
            userId: userId
        }]);
        
        if (records && records.length > 0 && records[0].value) {
            return records[0].value;
        }
    } catch (err) {
        logger.warn("[Collections] Failed to read data: " + err.message);
    }
    
    return null;
}

/**
 * Save collection data
 */
function saveCollectionData(nk, logger, userId, gameId, data) {
    var collection = "user_collections";
    var key = "data_" + userId + "_" + gameId;
    
    try {
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: data,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (err) {
        logger.error("[Collections] Failed to save data: " + err.message);
        return false;
    }
}

/**
 * Initialize collection data for new user
 */
function initializeCollectionData() {
    // Initialize unlocked items with defaults
    var unlocked = {
        avatars: ["avatar_default"],
        badges: [],
        titles: ["title_newbie"],
        frames: ["frame_default"]
    };
    
    // Initialize mastery for each category
    var mastery = {};
    for (var i = 0; i < MASTERY_CATEGORIES.length; i++) {
        var cat = MASTERY_CATEGORIES[i];
        mastery[cat] = {
            level: 1,
            xp: 0,
            questionsAnswered: 0,
            correctAnswers: 0
        };
    }
    
    return {
        unlocked: unlocked,
        equipped: {
            avatar: "avatar_default",
            title: "title_newbie",
            frame: "frame_default",
            badge: null
        },
        mastery: mastery,
        prestige: {
            level: 0,
            totalXp: 0
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

/**
 * Calculate mastery level from XP
 */
function getMasteryLevel(xp) {
    for (var i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
        if (xp >= MASTERY_LEVELS[i].xpRequired) {
            return MASTERY_LEVELS[i];
        }
    }
    return MASTERY_LEVELS[0];
}

/**
 * Calculate prestige level from total XP
 */
function getPrestigeLevel(totalXp) {
    for (var i = PRESTIGE_LEVELS.length - 1; i >= 0; i--) {
        if (totalXp >= PRESTIGE_LEVELS[i].xpRequired) {
            return PRESTIGE_LEVELS[i];
        }
    }
    return PRESTIGE_LEVELS[0];
}

/**
 * RPC: collections_get_status
 * Get user's collection status
 */
function rpcCollectionsGetStatus(ctx, logger, nk, payload) {
    logger.info("[Collections] RPC collections_get_status called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload || "{}");
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    var gameId = data.gameId;
    if (!gameId) {
        return JSON.stringify({ success: false, error: "Missing required field: gameId" });
    }
    
    var collectionData = getCollectionData(nk, logger, ctx.userId, gameId);
    
    if (!collectionData) {
        collectionData = initializeCollectionData();
        saveCollectionData(nk, logger, ctx.userId, gameId, collectionData);
    }
    
    // Build collections overview
    var collectionsOverview = {};
    for (var collType in COLLECTIONS) {
        var coll = COLLECTIONS[collType];
        var totalItems = Object.keys(coll.items).length;
        var unlockedCount = collectionData.unlocked[collType] ? collectionData.unlocked[collType].length : 0;
        
        collectionsOverview[collType] = {
            name: coll.name,
            unlocked: unlockedCount,
            total: totalItems,
            percentage: Math.round((unlockedCount / totalItems) * 100)
        };
    }
    
    // Build mastery overview
    var masteryOverview = [];
    for (var i = 0; i < MASTERY_CATEGORIES.length; i++) {
        var cat = MASTERY_CATEGORIES[i];
        var m = collectionData.mastery[cat];
        var levelInfo = getMasteryLevel(m.xp);
        var nextLevel = MASTERY_LEVELS[Math.min(levelInfo.level, MASTERY_LEVELS.length - 1)];
        
        masteryOverview.push({
            category: cat,
            level: levelInfo.level,
            xp: m.xp,
            xpToNext: levelInfo.level < 5 ? nextLevel.xpRequired - m.xp : 0,
            bonus: levelInfo.bonus,
            isMaster: levelInfo.level >= 5,
            questionsAnswered: m.questionsAnswered,
            accuracy: m.questionsAnswered > 0 ? Math.round((m.correctAnswers / m.questionsAnswered) * 100) : 0
        });
    }
    
    // Get prestige info
    var prestigeInfo = getPrestigeLevel(collectionData.prestige.totalXp);
    var nextPrestige = PRESTIGE_LEVELS[Math.min(prestigeInfo.level + 1, PRESTIGE_LEVELS.length - 1)];
    
    return JSON.stringify({
        success: true,
        userId: ctx.userId,
        gameId: gameId,
        collections: collectionsOverview,
        allCollections: COLLECTIONS,
        unlocked: collectionData.unlocked,
        equipped: collectionData.equipped,
        mastery: masteryOverview,
        prestige: {
            level: prestigeInfo.level,
            totalXp: collectionData.prestige.totalXp,
            xpToNext: prestigeInfo.level < 5 ? nextPrestige.xpRequired - collectionData.prestige.totalXp : 0,
            bonus: prestigeInfo.bonus,
            frame: prestigeInfo.frame
        },
        prestigeLevels: PRESTIGE_LEVELS,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: collections_unlock_item
 * Unlock a collectible item
 */
function rpcCollectionsUnlockItem(ctx, logger, nk, payload) {
    logger.info("[Collections] RPC collections_unlock_item called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.collectionType || !data.itemId) {
        return JSON.stringify({ success: false, error: "Missing required fields" });
    }
    
    var gameId = data.gameId;
    var collectionType = data.collectionType;
    var itemId = data.itemId;
    
    // Validate collection type
    if (!COLLECTIONS[collectionType]) {
        return JSON.stringify({ success: false, error: "Invalid collection type" });
    }
    
    // Validate item exists
    if (!COLLECTIONS[collectionType].items[itemId]) {
        return JSON.stringify({ success: false, error: "Item not found" });
    }
    
    var collectionData = getCollectionData(nk, logger, ctx.userId, gameId);
    if (!collectionData) {
        collectionData = initializeCollectionData();
    }
    
    // Check if already unlocked
    if (collectionData.unlocked[collectionType].indexOf(itemId) !== -1) {
        return JSON.stringify({
            success: true,
            alreadyUnlocked: true,
            itemId: itemId
        });
    }
    
    // Unlock item
    collectionData.unlocked[collectionType].push(itemId);
    collectionData.updatedAt = new Date().toISOString();
    
    saveCollectionData(nk, logger, ctx.userId, gameId, collectionData);
    
    var item = COLLECTIONS[collectionType].items[itemId];
    logger.info("[Collections] Item unlocked: " + itemId + " for user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        itemId: itemId,
        collectionType: collectionType,
        item: {
            name: item.name,
            rarity: item.rarity
        },
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: collections_equip_item
 * Equip a collectible item
 */
function rpcCollectionsEquipItem(ctx, logger, nk, payload) {
    logger.info("[Collections] RPC collections_equip_item called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.slot || !data.itemId) {
        return JSON.stringify({ success: false, error: "Missing required fields" });
    }
    
    var gameId = data.gameId;
    var slot = data.slot; // avatar, title, frame, badge
    var itemId = data.itemId;
    
    var collectionData = getCollectionData(nk, logger, ctx.userId, gameId);
    if (!collectionData) {
        return JSON.stringify({ success: false, error: "Collection not initialized" });
    }
    
    // Map slot to collection type
    var collectionType = slot + "s"; // avatar -> avatars, etc.
    if (slot === "badge") collectionType = "badges";
    
    // Check if item is unlocked
    if (collectionData.unlocked[collectionType].indexOf(itemId) === -1) {
        return JSON.stringify({ success: false, error: "Item not unlocked" });
    }
    
    // Equip item
    collectionData.equipped[slot] = itemId;
    collectionData.updatedAt = new Date().toISOString();
    
    saveCollectionData(nk, logger, ctx.userId, gameId, collectionData);
    
    return JSON.stringify({
        success: true,
        slot: slot,
        itemId: itemId,
        equipped: collectionData.equipped,
        timestamp: new Date().toISOString()
    });
}

/**
 * RPC: collections_add_mastery_xp
 * Add XP to a category mastery
 */
function rpcCollectionsAddMasteryXP(ctx, logger, nk, payload) {
    logger.info("[Collections] RPC collections_add_mastery_xp called");
    
    if (!ctx.userId) {
        return JSON.stringify({ success: false, error: "User not authenticated" });
    }
    
    var data;
    try {
        data = JSON.parse(payload);
    } catch (err) {
        return JSON.stringify({ success: false, error: "Invalid JSON payload" });
    }
    
    if (!data.gameId || !data.category || data.xp === undefined) {
        return JSON.stringify({ success: false, error: "Missing required fields" });
    }
    
    var gameId = data.gameId;
    var category = data.category;
    var xpToAdd = parseInt(data.xp);
    var questionsAnswered = data.questionsAnswered || 0;
    var correctAnswers = data.correctAnswers || 0;
    
    if (MASTERY_CATEGORIES.indexOf(category) === -1) {
        return JSON.stringify({ success: false, error: "Invalid category" });
    }
    
    var collectionData = getCollectionData(nk, logger, ctx.userId, gameId);
    if (!collectionData) {
        collectionData = initializeCollectionData();
    }
    
    var mastery = collectionData.mastery[category];
    var oldLevel = getMasteryLevel(mastery.xp).level;
    
    mastery.xp += xpToAdd;
    mastery.questionsAnswered += questionsAnswered;
    mastery.correctAnswers += correctAnswers;
    
    var newLevelInfo = getMasteryLevel(mastery.xp);
    var leveledUp = newLevelInfo.level > oldLevel;
    
    // Update prestige XP
    collectionData.prestige.totalXp += xpToAdd;
    var oldPrestige = getPrestigeLevel(collectionData.prestige.totalXp - xpToAdd).level;
    var newPrestige = getPrestigeLevel(collectionData.prestige.totalXp).level;
    var prestigeUp = newPrestige > oldPrestige;
    
    collectionData.updatedAt = new Date().toISOString();
    saveCollectionData(nk, logger, ctx.userId, gameId, collectionData);
    
    logger.info("[Collections] Added " + xpToAdd + " XP to " + category + " mastery for user " + ctx.userId);
    
    return JSON.stringify({
        success: true,
        category: category,
        xpAdded: xpToAdd,
        mastery: {
            level: newLevelInfo.level,
            xp: mastery.xp,
            bonus: newLevelInfo.bonus,
            leveledUp: leveledUp
        },
        prestige: {
            level: newPrestige,
            totalXp: collectionData.prestige.totalXp,
            prestigeUp: prestigeUp
        },
        timestamp: new Date().toISOString()
    });
}
