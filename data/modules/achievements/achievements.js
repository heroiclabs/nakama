/**
 * Achievement System for Multi-Game Platform
 * Supports per-game achievements with unlock tracking and rewards
 * 
 * Collections:
 * - achievements: Stores achievement definitions (system-owned)
 * - achievement_progress: Stores player progress per game
 */

const ACHIEVEMENT_COLLECTION = "achievements";
const ACHIEVEMENT_PROGRESS_COLLECTION = "achievement_progress";

/**
 * RPC: achievements_get_all
 * Get all achievements for a game with player progress
 */
var rpcAchievementsGetAll = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        
        logger.info("[Achievements] Getting all achievements for game: " + gameId);
        
        // Get achievement definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];
        
        try {
            var defRecords = nk.storageRead([{
                collection: ACHIEVEMENT_COLLECTION,
                key: definitionsKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.achievements || [];
            }
        } catch (err) {
            logger.warn("[Achievements] No definitions found for game: " + gameId);
        }
        
        // Get player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progress = {};
        
        try {
            var progRecords = nk.storageRead([{
                collection: ACHIEVEMENT_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);
            
            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progress = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Achievements] No progress found for user: " + userId);
        }
        
        // Merge definitions with progress
        var achievements = [];
        for (var i = 0; i < definitions.length; i++) {
            var def = definitions[i];
            var prog = progress[def.achievement_id] || {
                progress: 0,
                unlocked: false,
                unlock_date: null
            };
            
            // Hide secret achievements if not unlocked
            if (def.hidden && !prog.unlocked) {
                achievements.push({
                    achievement_id: def.achievement_id,
                    title: "???",
                    description: "Hidden achievement",
                    icon_url: "mystery_icon.png",
                    rarity: def.rarity,
                    category: def.category,
                    progress: 0,
                    target: def.target,
                    unlocked: false,
                    hidden: true,
                    points: def.points
                });
            } else {
                achievements.push({
                    achievement_id: def.achievement_id,
                    title: def.title,
                    description: def.description,
                    icon_url: def.icon_url,
                    rarity: def.rarity,
                    category: def.category,
                    type: def.type,
                    progress: prog.progress,
                    target: def.target,
                    unlocked: prog.unlocked,
                    unlock_date: prog.unlock_date,
                    rewards: def.rewards,
                    hidden: def.hidden || false,
                    points: def.points
                });
            }
        }
        
        // Calculate total achievement points
        var totalPoints = 0;
        var unlockedPoints = 0;
        
        for (var j = 0; j < achievements.length; j++) {
            totalPoints += achievements[j].points || 0;
            if (achievements[j].unlocked) {
                unlockedPoints += achievements[j].points || 0;
            }
        }
        
        return JSON.stringify({
            success: true,
            achievements: achievements,
            stats: {
                total_achievements: achievements.length,
                unlocked: achievements.filter(function(a) { return a.unlocked; }).length,
                total_points: totalPoints,
                unlocked_points: unlockedPoints,
                completion_percentage: achievements.length > 0 
                    ? Math.round((achievements.filter(function(a) { return a.unlocked; }).length / achievements.length) * 100)
                    : 0
            }
        });
        
    } catch (err) {
        logger.error("[Achievements] Get all error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: achievements_update_progress
 * Update progress towards an achievement
 */
var rpcAchievementsUpdateProgress = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.achievement_id || data.progress === undefined) {
            throw Error("game_id, achievement_id, and progress are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var achievementId = data.achievement_id;
        var newProgress = data.progress;
        var increment = data.increment || false;
        
        logger.info("[Achievements] Updating progress for " + achievementId + ": " + newProgress);
        
        // Get achievement definition
        var definitionsKey = "definitions_" + gameId;
        var achievement = null;
        
        var defRecords = nk.storageRead([{
            collection: ACHIEVEMENT_COLLECTION,
            key: definitionsKey,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.achievements || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].achievement_id === achievementId) {
                    achievement = definitions[i];
                    break;
                }
            }
        }
        
        if (!achievement) {
            throw Error("Achievement not found: " + achievementId);
        }
        
        // Get or create progress record
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};
        
        try {
            var progRecords = nk.storageRead([{
                collection: ACHIEVEMENT_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);
            
            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progressData = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Achievements] Creating new progress record");
        }
        
        // Initialize achievement progress if doesn't exist
        if (!progressData[achievementId]) {
            progressData[achievementId] = {
                progress: 0,
                unlocked: false,
                unlock_date: null
            };
        }
        
        var achievementProgress = progressData[achievementId];
        
        // Don't update if already unlocked
        if (achievementProgress.unlocked) {
            return JSON.stringify({
                success: true,
                achievement: {
                    achievement_id: achievementId,
                    progress: achievementProgress.progress,
                    target: achievement.target,
                    unlocked: true,
                    already_unlocked: true
                }
            });
        }
        
        // Update progress
        if (increment) {
            achievementProgress.progress += newProgress;
        } else {
            achievementProgress.progress = newProgress;
        }
        
        // Check if unlocked
        var justUnlocked = false;
        if (achievementProgress.progress >= achievement.target) {
            achievementProgress.unlocked = true;
            achievementProgress.unlock_date = new Date().toISOString();
            justUnlocked = true;
            
            logger.info("[Achievements] Achievement unlocked: " + achievementId);
        }
        
        // Save progress
        progressData[achievementId] = achievementProgress;
        
        nk.storageWrite([{
            collection: ACHIEVEMENT_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId,
            value: progressData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Grant rewards if unlocked
        var rewardsGranted = null;
        if (justUnlocked && achievement.rewards) {
            rewardsGranted = grantAchievementRewards(nk, logger, userId, gameId, achievement.rewards);
        }
        
        return JSON.stringify({
            success: true,
            achievement: {
                achievement_id: achievementId,
                progress: achievementProgress.progress,
                target: achievement.target,
                unlocked: achievementProgress.unlocked,
                just_unlocked: justUnlocked,
                unlock_date: achievementProgress.unlock_date
            },
            rewards_granted: rewardsGranted
        });
        
    } catch (err) {
        logger.error("[Achievements] Update progress error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * Helper: Grant achievement rewards
 */
var grantAchievementRewards = function(nk, logger, userId, gameId, rewards) {
    var granted = {
        coins: 0,
        xp: 0,
        items: [],
        badge: null,
        title: null
    };
    
    try {
        // Grant coins
        if (rewards.coins && rewards.coins > 0) {
            var walletKey = "wallet_" + userId + "_" + gameId;
            var wallet = { balance: 0 };
            
            try {
                var walletRecords = nk.storageRead([{
                    collection: gameId + "_wallets",
                    key: walletKey,
                    userId: userId
                }]);
                
                if (walletRecords && walletRecords.length > 0 && walletRecords[0].value) {
                    wallet = walletRecords[0].value;
                }
            } catch (err) {
                logger.debug("[Achievements] Creating new wallet");
            }
            
            wallet.balance = (wallet.balance || 0) + rewards.coins;
            wallet.updated_at = new Date().toISOString();
            
            nk.storageWrite([{
                collection: gameId + "_wallets",
                key: walletKey,
                userId: userId,
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }]);
            
            granted.coins = rewards.coins;
        }
        
        // Grant items (simplified - integrate with inventory system)
        if (rewards.items && rewards.items.length > 0) {
            granted.items = rewards.items;
            logger.info("[Achievements] Items granted: " + rewards.items.join(", "));
        }
        
        // Grant badge/title
        if (rewards.badge) {
            granted.badge = rewards.badge;
        }
        
        if (rewards.title) {
            granted.title = rewards.title;
        }
        
        return granted;
        
    } catch (err) {
        logger.error("[Achievements] Reward grant error: " + err.message);
        return granted;
    }
};

/**
 * RPC: achievements_create_definition (Admin only)
 * Create a new achievement definition
 */
var rpcAchievementsCreateDefinition = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.achievement_id || !data.title) {
            throw Error("game_id, achievement_id, and title are required");
        }
        
        var gameId = data.game_id;
        var definitionsKey = "definitions_" + gameId;
        
        // Get existing definitions
        var definitions = { achievements: [] };
        
        try {
            var records = nk.storageRead([{
                collection: ACHIEVEMENT_COLLECTION,
                key: definitionsKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Achievements] Creating new definitions collection");
        }
        
        // Check if achievement already exists
        for (var i = 0; i < definitions.achievements.length; i++) {
            if (definitions.achievements[i].achievement_id === data.achievement_id) {
                throw Error("Achievement already exists: " + data.achievement_id);
            }
        }
        
        // Create achievement definition
        var achievement = {
            achievement_id: data.achievement_id,
            game_id: gameId,
            title: data.title,
            description: data.description || "",
            icon_url: data.icon_url || "default_icon.png",
            rarity: data.rarity || "common",
            category: data.category || "general",
            type: data.type || "simple",
            target: data.target || 1,
            rewards: data.rewards || { coins: 100, xp: 50 },
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            hidden: data.hidden || false,
            points: data.points || 10
        };
        
        definitions.achievements.push(achievement);
        
        // Save definitions
        nk.storageWrite([{
            collection: ACHIEVEMENT_COLLECTION,
            key: definitionsKey,
            userId: "00000000-0000-0000-0000-000000000000",
            value: definitions,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info("[Achievements] Created definition: " + data.achievement_id);
        
        return JSON.stringify({
            success: true,
            achievement: achievement
        });
        
    } catch (err) {
        logger.error("[Achievements] Create definition error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: achievements_bulk_create (Admin only)
 * Create multiple achievement definitions at once
 */
var rpcAchievementsBulkCreate = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.achievements || !Array.isArray(data.achievements)) {
            throw Error("game_id and achievements array are required");
        }
        
        var gameId = data.game_id;
        var achievementsToCreate = data.achievements;
        var definitionsKey = "definitions_" + gameId;
        
        // Get existing definitions
        var definitions = { achievements: [] };
        
        try {
            var records = nk.storageRead([{
                collection: ACHIEVEMENT_COLLECTION,
                key: definitionsKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Achievements] Creating new definitions collection");
        }
        
        var created = [];
        var errors = [];
        
        for (var i = 0; i < achievementsToCreate.length; i++) {
            var achData = achievementsToCreate[i];
            
            try {
                if (!achData.achievement_id || !achData.title) {
                    throw Error("achievement_id and title are required");
                }
                
                // Check if already exists
                var exists = false;
                for (var j = 0; j < definitions.achievements.length; j++) {
                    if (definitions.achievements[j].achievement_id === achData.achievement_id) {
                        exists = true;
                        break;
                    }
                }
                
                if (exists) {
                    throw Error("Achievement already exists: " + achData.achievement_id);
                }
                
                var achievement = {
                    achievement_id: achData.achievement_id,
                    game_id: gameId,
                    title: achData.title,
                    description: achData.description || "",
                    icon_url: achData.icon_url || "default_icon.png",
                    rarity: achData.rarity || "common",
                    category: achData.category || "general",
                    type: achData.type || "simple",
                    target: achData.target || 1,
                    rewards: achData.rewards || { coins: 100, xp: 50 },
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                    hidden: achData.hidden || false,
                    points: achData.points || 10
                };
                
                definitions.achievements.push(achievement);
                created.push(achievement.achievement_id);
                
            } catch (err) {
                errors.push({
                    achievement_id: achData.achievement_id,
                    error: err.message
                });
            }
        }
        
        // Save definitions if any were created
        if (created.length > 0) {
            nk.storageWrite([{
                collection: ACHIEVEMENT_COLLECTION,
                key: definitionsKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: definitions,
                permissionRead: 2,
                permissionWrite: 0
            }]);
        }
        
        logger.info("[Achievements] Bulk create completed: " + created.length + " created, " + errors.length + " errors");
        
        return JSON.stringify({
            success: true,
            created: created,
            total_created: created.length,
            errors: errors,
            total_errors: errors.length
        });
        
    } catch (err) {
        logger.error("[Achievements] Bulk create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};
