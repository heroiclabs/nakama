/**
 * Badge & Collectable System for Multi-Game Platform
 * Supports per-game badges and collectables with player tracking
 * 
 * Collections:
 * - badges: Stores badge definitions (system-owned)
 * - badge_progress: Stores player badge progress per game
 * - collectables: Stores collectable definitions (system-owned)
 * - collectable_inventory: Stores player collectable inventory per game
 */

// ============================================================================
// CONSTANTS
// ============================================================================
var BADGE_COLLECTION = "badges";
var BADGE_PROGRESS_COLLECTION = "badge_progress";
var COLLECTABLE_COLLECTION = "collectables";
var COLLECTABLE_INVENTORY_COLLECTION = "collectable_inventory";
var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// Badge categories
var BADGE_CATEGORIES = {
    COMBAT: "combat",
    QUIZ: "quiz",
    SOCIAL: "social",
    STREAK: "streak",
    SPECIAL: "special",
    SEASONAL: "seasonal"
};

// Rarity tiers
var RARITY = {
    COMMON: "common",
    RARE: "rare",
    EPIC: "epic",
    LEGENDARY: "legendary"
};

// ============================================================================
// BADGE RPCs
// ============================================================================

/**
 * RPC: badges_get_all
 * Get all badges for a game with player progress
 * 
 * @param {Object} payload - { game_id: string }
 * @returns {Object} - { success, badges[], stats }
 */
var rpcBadgesGetAll = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        
        logger.info("[Badges] Getting all badges for game: " + gameId + ", user: " + userId);
        
        // Get badge definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];
        
        try {
            var defRecords = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.badges || [];
            }
        } catch (err) {
            logger.warn("[Badges] No definitions found for game: " + gameId);
        }
        
        // Get player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progress = {};
        
        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);
            
            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progress = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] No progress found for user: " + userId);
        }
        
        // Merge definitions with progress
        var badges = [];
        for (var i = 0; i < definitions.length; i++) {
            var def = definitions[i];
            var prog = progress[def.badge_id] || {
                progress: 0,
                unlocked: false,
                unlock_date: null,
                displayed: false
            };
            
            // Hide secret badges if not unlocked
            if (def.hidden && !prog.unlocked) {
                badges.push({
                    badge_id: def.badge_id,
                    title: "???",
                    description: "Hidden badge",
                    icon_url: "badges/mystery.png",
                    category: def.category,
                    rarity: def.rarity,
                    progress: 0,
                    target: def.target,
                    unlocked: false,
                    hidden: true,
                    points: def.points,
                    order: def.order || 999
                });
            } else {
                badges.push({
                    badge_id: def.badge_id,
                    title: def.title,
                    description: def.description,
                    icon_url: def.icon_url,
                    category: def.category,
                    rarity: def.rarity,
                    type: def.type,
                    progress: prog.progress,
                    target: def.target,
                    unlocked: prog.unlocked,
                    unlock_date: prog.unlock_date,
                    displayed: prog.displayed,
                    rewards: def.rewards,
                    hidden: def.hidden || false,
                    points: def.points,
                    order: def.order || 999
                });
            }
        }
        
        // Sort by order, then by unlocked status
        badges.sort(function(a, b) {
            if (a.unlocked !== b.unlocked) return b.unlocked ? 1 : -1;
            return a.order - b.order;
        });
        
        // Calculate stats
        var totalPoints = 0;
        var unlockedPoints = 0;
        var unlockedCount = 0;
        
        for (var j = 0; j < badges.length; j++) {
            totalPoints += badges[j].points || 0;
            if (badges[j].unlocked) {
                unlockedPoints += badges[j].points || 0;
                unlockedCount++;
            }
        }
        
        return JSON.stringify({
            success: true,
            badges: badges,
            stats: {
                total_badges: badges.length,
                unlocked: unlockedCount,
                total_points: totalPoints,
                unlocked_points: unlockedPoints,
                completion_percentage: badges.length > 0 
                    ? Math.round((unlockedCount / badges.length) * 100)
                    : 0
            }
        });
        
    } catch (err) {
        logger.error("[Badges] Get all error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: badges_update_progress
 * Update progress towards a badge (called when game events happen)
 * 
 * @param {Object} payload - { game_id, badge_id, progress, increment? }
 * @returns {Object} - { success, badge, just_unlocked, rewards_granted }
 */
var rpcBadgesUpdateProgress = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.badge_id || data.progress === undefined) {
            throw Error("game_id, badge_id, and progress are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var badgeId = data.badge_id;
        var newProgress = data.progress;
        var increment = data.increment || false;
        
        logger.info("[Badges] Updating progress for " + badgeId + ": " + newProgress);
        
        // Get badge definition
        var definitionsKey = "definitions_" + gameId;
        var badge = null;
        
        var defRecords = nk.storageRead([{
            collection: BADGE_COLLECTION,
            key: definitionsKey,
            userId: SYSTEM_USER_ID
        }]);
        
        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.badges || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].badge_id === badgeId) {
                    badge = definitions[i];
                    break;
                }
            }
        }
        
        if (!badge) {
            throw Error("Badge not found: " + badgeId);
        }
        
        // Get or create progress record
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};
        
        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);
            
            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progressData = progRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] Creating new progress record");
        }
        
        // Initialize badge progress if doesn't exist
        if (!progressData[badgeId]) {
            progressData[badgeId] = {
                progress: 0,
                unlocked: false,
                unlock_date: null,
                displayed: false
            };
        }
        
        var badgeProgress = progressData[badgeId];
        
        // Don't update if already unlocked
        if (badgeProgress.unlocked) {
            return JSON.stringify({
                success: true,
                badge: {
                    badge_id: badgeId,
                    progress: badgeProgress.progress,
                    target: badge.target,
                    unlocked: true,
                    already_unlocked: true
                }
            });
        }
        
        // Update progress
        if (increment) {
            badgeProgress.progress += newProgress;
        } else {
            badgeProgress.progress = Math.max(badgeProgress.progress, newProgress);
        }
        
        // Check if unlocked
        var justUnlocked = false;
        if (badgeProgress.progress >= badge.target) {
            badgeProgress.unlocked = true;
            badgeProgress.unlock_date = new Date().toISOString();
            justUnlocked = true;
            
            logger.info("[Badges] Badge unlocked: " + badgeId + " for user: " + userId);
            
            // Send notification
            try {
                nk.notificationsSend([{
                    userId: userId,
                    subject: "Badge Unlocked!",
                    content: {
                        type: "badge_unlocked",
                        badge_id: badgeId,
                        title: badge.title,
                        icon_url: badge.icon_url,
                        rarity: badge.rarity,
                        rewards: badge.rewards
                    },
                    code: 100, // Custom code for badge notifications
                    persistent: true
                }]);
            } catch (notifErr) {
                logger.warn("[Badges] Failed to send notification: " + notifErr.message);
            }
        }
        
        // Save progress
        progressData[badgeId] = badgeProgress;
        
        nk.storageWrite([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId,
            value: progressData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Grant rewards if unlocked
        var rewardsGranted = null;
        if (justUnlocked && badge.rewards) {
            rewardsGranted = grantBadgeRewards(nk, logger, userId, gameId, badge.rewards);
        }
        
        return JSON.stringify({
            success: true,
            badge: {
                badge_id: badgeId,
                title: badge.title,
                progress: badgeProgress.progress,
                target: badge.target,
                unlocked: badgeProgress.unlocked,
                just_unlocked: justUnlocked,
                unlock_date: badgeProgress.unlock_date
            },
            rewards_granted: rewardsGranted
        });
        
    } catch (err) {
        logger.error("[Badges] Update progress error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: badges_check_event
 * Check and update badges based on a game event (server-side trigger)
 * 
 * @param {Object} payload - { game_id, event_type, event_data }
 * @returns {Object} - { success, badges_updated[], badges_unlocked[] }
 */
var rpcBadgesCheckEvent = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.event_type) {
            throw Error("game_id and event_type are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var eventType = data.event_type;
        var eventData = data.event_data || {};
        
        logger.info("[Badges] Checking event: " + eventType + " for game: " + gameId);
        
        // Get all badge definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];
        
        try {
            var defRecords = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.badges || [];
            }
        } catch (err) {
            return JSON.stringify({
                success: true,
                badges_updated: [],
                badges_unlocked: [],
                message: "No badges configured"
            });
        }
        
        // Get player progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};
        
        try {
            var progRecords = nk.storageRead([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId
            }]);
            
            if (progRecords && progRecords.length > 0 && progRecords[0].value) {
                progressData = progRecords[0].value;
            }
        } catch (err) {
            // New player, no progress yet
        }
        
        var badgesUpdated = [];
        var badgesUnlocked = [];
        
        // Check each badge that matches this event
        for (var i = 0; i < definitions.length; i++) {
            var badge = definitions[i];
            
            // Skip if already unlocked
            if (progressData[badge.badge_id] && progressData[badge.badge_id].unlocked) {
                continue;
            }
            
            // Check if this badge matches the event
            if (badge.unlock_criteria && badge.unlock_criteria.event === eventType) {
                // Initialize progress if needed
                if (!progressData[badge.badge_id]) {
                    progressData[badge.badge_id] = {
                        progress: 0,
                        unlocked: false,
                        unlock_date: null,
                        displayed: false
                    };
                }
                
                var prog = progressData[badge.badge_id];
                
                // Increment progress based on event
                var increment = eventData.count || 1;
                prog.progress += increment;
                
                badgesUpdated.push({
                    badge_id: badge.badge_id,
                    title: badge.title,
                    progress: prog.progress,
                    target: badge.target
                });
                
                // Check if unlocked
                if (prog.progress >= badge.target) {
                    prog.unlocked = true;
                    prog.unlock_date = new Date().toISOString();
                    
                    badgesUnlocked.push({
                        badge_id: badge.badge_id,
                        title: badge.title,
                        icon_url: badge.icon_url,
                        rarity: badge.rarity,
                        rewards: badge.rewards
                    });
                    
                    // Grant rewards
                    if (badge.rewards) {
                        grantBadgeRewards(nk, logger, userId, gameId, badge.rewards);
                    }
                    
                    // Send notification
                    try {
                        nk.notificationsSend([{
                            userId: userId,
                            subject: "Badge Unlocked: " + badge.title,
                            content: {
                                type: "badge_unlocked",
                                badge_id: badge.badge_id,
                                title: badge.title,
                                icon_url: badge.icon_url,
                                rarity: badge.rarity
                            },
                            code: 100,
                            persistent: true
                        }]);
                    } catch (notifErr) {
                        logger.warn("[Badges] Notification error: " + notifErr.message);
                    }
                }
                
                progressData[badge.badge_id] = prog;
            }
        }
        
        // Save updated progress
        if (badgesUpdated.length > 0) {
            nk.storageWrite([{
                collection: BADGE_PROGRESS_COLLECTION,
                key: progressKey,
                userId: userId,
                value: progressData,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
        
        return JSON.stringify({
            success: true,
            badges_updated: badgesUpdated,
            badges_unlocked: badgesUnlocked
        });
        
    } catch (err) {
        logger.error("[Badges] Check event error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: badges_set_displayed
 * Set which badge the player wants to display on their profile
 * 
 * @param {Object} payload - { game_id, badge_id }
 */
var rpcBadgesSetDisplayed = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.badge_id) {
            throw Error("game_id and badge_id are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var badgeId = data.badge_id;
        
        // Get progress
        var progressKey = "progress_" + userId + "_" + gameId;
        var progressData = {};
        
        var progRecords = nk.storageRead([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId
        }]);
        
        if (progRecords && progRecords.length > 0 && progRecords[0].value) {
            progressData = progRecords[0].value;
        }
        
        // Check if badge is unlocked
        if (!progressData[badgeId] || !progressData[badgeId].unlocked) {
            throw Error("Badge not unlocked");
        }
        
        // Clear all displayed flags, set the new one
        for (var key in progressData) {
            if (progressData.hasOwnProperty(key)) {
                progressData[key].displayed = (key === badgeId);
            }
        }
        
        // Save
        nk.storageWrite([{
            collection: BADGE_PROGRESS_COLLECTION,
            key: progressKey,
            userId: userId,
            value: progressData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Also update account metadata for quick access
        var account = nk.accountGetId(userId);
        var metadata = account.user.metadata || {};
        metadata.displayed_badge = badgeId;
        metadata.displayed_badge_game = gameId;
        
        nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);
        
        return JSON.stringify({
            success: true,
            displayed_badge: badgeId
        });
        
    } catch (err) {
        logger.error("[Badges] Set displayed error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

// ============================================================================
// COLLECTABLE RPCs
// ============================================================================

/**
 * RPC: collectables_get_all
 * Get all collectables for a game with player inventory
 * 
 * @param {Object} payload - { game_id }
 * @returns {Object} - { success, collectables[], inventory_stats }
 */
var rpcCollectablesGetAll = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        
        logger.info("[Collectables] Getting all for game: " + gameId + ", user: " + userId);
        
        // Get collectable definitions
        var definitionsKey = "definitions_" + gameId;
        var definitions = [];
        
        try {
            var defRecords = nk.storageRead([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (defRecords && defRecords.length > 0 && defRecords[0].value) {
                definitions = defRecords[0].value.collectables || [];
            }
        } catch (err) {
            logger.warn("[Collectables] No definitions found for game: " + gameId);
        }
        
        // Get player inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};
        
        try {
            var invRecords = nk.storageRead([{
                collection: COLLECTABLE_INVENTORY_COLLECTION,
                key: inventoryKey,
                userId: userId
            }]);
            
            if (invRecords && invRecords.length > 0 && invRecords[0].value) {
                inventory = invRecords[0].value;
            }
        } catch (err) {
            logger.debug("[Collectables] No inventory found for user: " + userId);
        }
        
        // Merge definitions with inventory
        var collectables = [];
        var ownedCount = 0;
        var totalCount = definitions.length;
        
        for (var i = 0; i < definitions.length; i++) {
            var def = definitions[i];
            var inv = inventory[def.collectable_id] || {
                quantity: 0,
                acquired_date: null,
                equipped: false
            };
            
            var owned = inv.quantity > 0;
            if (owned) ownedCount++;
            
            collectables.push({
                collectable_id: def.collectable_id,
                title: def.title,
                description: def.description,
                icon_url: def.icon_url,
                category: def.category,
                rarity: def.rarity,
                max_quantity: def.max_quantity,
                tradeable: def.tradeable,
                source: def.source,
                metadata: def.metadata,
                // Player-specific data
                quantity: inv.quantity,
                owned: owned,
                acquired_date: inv.acquired_date,
                equipped: inv.equipped
            });
        }
        
        // Sort by owned status, then rarity, then name
        var rarityOrder = { legendary: 0, epic: 1, rare: 2, common: 3 };
        collectables.sort(function(a, b) {
            if (a.owned !== b.owned) return b.owned ? 1 : -1;
            var rarityDiff = (rarityOrder[a.rarity] || 3) - (rarityOrder[b.rarity] || 3);
            if (rarityDiff !== 0) return rarityDiff;
            return a.title.localeCompare(b.title);
        });
        
        return JSON.stringify({
            success: true,
            collectables: collectables,
            inventory_stats: {
                total_collectables: totalCount,
                owned: ownedCount,
                completion_percentage: totalCount > 0 
                    ? Math.round((ownedCount / totalCount) * 100)
                    : 0
            }
        });
        
    } catch (err) {
        logger.error("[Collectables] Get all error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: collectables_grant
 * Grant a collectable to a player (server-side or admin)
 * 
 * @param {Object} payload - { game_id, collectable_id, quantity?, source? }
 */
var rpcCollectablesGrant = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.collectable_id) {
            throw Error("game_id and collectable_id are required");
        }
        
        var userId = data.user_id || ctx.userId;
        var gameId = data.game_id;
        var collectableId = data.collectable_id;
        var quantity = data.quantity || 1;
        var source = data.source || "system";
        
        logger.info("[Collectables] Granting " + collectableId + " (x" + quantity + ") to user: " + userId);
        
        // Verify collectable exists
        var definitionsKey = "definitions_" + gameId;
        var collectable = null;
        
        var defRecords = nk.storageRead([{
            collection: COLLECTABLE_COLLECTION,
            key: definitionsKey,
            userId: SYSTEM_USER_ID
        }]);
        
        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.collectables || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].collectable_id === collectableId) {
                    collectable = definitions[i];
                    break;
                }
            }
        }
        
        if (!collectable) {
            throw Error("Collectable not found: " + collectableId);
        }
        
        // Get or create inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};
        
        try {
            var invRecords = nk.storageRead([{
                collection: COLLECTABLE_INVENTORY_COLLECTION,
                key: inventoryKey,
                userId: userId
            }]);
            
            if (invRecords && invRecords.length > 0 && invRecords[0].value) {
                inventory = invRecords[0].value;
            }
        } catch (err) {
            // New inventory
        }
        
        // Initialize if needed
        if (!inventory[collectableId]) {
            inventory[collectableId] = {
                quantity: 0,
                acquired_date: null,
                equipped: false,
                acquisition_history: []
            };
        }
        
        var item = inventory[collectableId];
        var isFirstAcquisition = item.quantity === 0;
        
        // Check max quantity
        var maxQty = collectable.max_quantity || 999;
        var newQuantity = Math.min(item.quantity + quantity, maxQty);
        var actualGranted = newQuantity - item.quantity;
        
        if (actualGranted <= 0) {
            return JSON.stringify({
                success: true,
                collectable_id: collectableId,
                quantity_granted: 0,
                current_quantity: item.quantity,
                at_max: true
            });
        }
        
        // Update inventory
        item.quantity = newQuantity;
        if (isFirstAcquisition) {
            item.acquired_date = new Date().toISOString();
        }
        item.acquisition_history.push({
            date: new Date().toISOString(),
            quantity: actualGranted,
            source: source
        });
        
        inventory[collectableId] = item;
        
        // Save inventory
        nk.storageWrite([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Send notification for new collectables
        if (isFirstAcquisition) {
            try {
                nk.notificationsSend([{
                    userId: userId,
                    subject: "New Collectable!",
                    content: {
                        type: "collectable_acquired",
                        collectable_id: collectableId,
                        title: collectable.title,
                        icon_url: collectable.icon_url,
                        rarity: collectable.rarity
                    },
                    code: 101, // Custom code for collectable notifications
                    persistent: true
                }]);
            } catch (notifErr) {
                logger.warn("[Collectables] Notification error: " + notifErr.message);
            }
        }
        
        return JSON.stringify({
            success: true,
            collectable_id: collectableId,
            title: collectable.title,
            quantity_granted: actualGranted,
            current_quantity: newQuantity,
            is_new: isFirstAcquisition
        });
        
    } catch (err) {
        logger.error("[Collectables] Grant error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: collectables_equip
 * Equip a collectable (e.g., profile frame, avatar border)
 * 
 * @param {Object} payload - { game_id, collectable_id, slot? }
 */
var rpcCollectablesEquip = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.collectable_id) {
            throw Error("game_id and collectable_id are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collectableId = data.collectable_id;
        var slot = data.slot || "default";
        
        // Get inventory
        var inventoryKey = "inventory_" + userId + "_" + gameId;
        var inventory = {};
        
        var invRecords = nk.storageRead([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId
        }]);
        
        if (invRecords && invRecords.length > 0 && invRecords[0].value) {
            inventory = invRecords[0].value;
        }
        
        // Check if owned
        if (!inventory[collectableId] || inventory[collectableId].quantity <= 0) {
            throw Error("Collectable not owned");
        }
        
        // Get collectable definition for category
        var definitionsKey = "definitions_" + gameId;
        var collectable = null;
        
        var defRecords = nk.storageRead([{
            collection: COLLECTABLE_COLLECTION,
            key: definitionsKey,
            userId: SYSTEM_USER_ID
        }]);
        
        if (defRecords && defRecords.length > 0 && defRecords[0].value) {
            var definitions = defRecords[0].value.collectables || [];
            for (var i = 0; i < definitions.length; i++) {
                if (definitions[i].collectable_id === collectableId) {
                    collectable = definitions[i];
                    break;
                }
            }
        }
        
        if (!collectable) {
            throw Error("Collectable definition not found");
        }
        
        // Unequip any other items in the same category/slot
        for (var key in inventory) {
            if (inventory.hasOwnProperty(key) && inventory[key].equipped) {
                // Check if same category
                for (var j = 0; j < definitions.length; j++) {
                    if (definitions[j].collectable_id === key && 
                        definitions[j].category === collectable.category) {
                        inventory[key].equipped = false;
                    }
                }
            }
        }
        
        // Equip the selected item
        inventory[collectableId].equipped = true;
        inventory[collectableId].equipped_date = new Date().toISOString();
        
        // Save inventory
        nk.storageWrite([{
            collection: COLLECTABLE_INVENTORY_COLLECTION,
            key: inventoryKey,
            userId: userId,
            value: inventory,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Update account metadata for quick profile access
        var account = nk.accountGetId(userId);
        var metadata = account.user.metadata || {};
        
        if (!metadata.equipped_collectables) {
            metadata.equipped_collectables = {};
        }
        metadata.equipped_collectables[collectable.category] = {
            collectable_id: collectableId,
            icon_url: collectable.icon_url,
            game_id: gameId
        };
        
        nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);
        
        return JSON.stringify({
            success: true,
            equipped: collectableId,
            category: collectable.category
        });
        
    } catch (err) {
        logger.error("[Collectables] Equip error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

// ============================================================================
// ADMIN RPCs - Bulk Create Definitions
// ============================================================================

/**
 * RPC: badges_bulk_create (Admin only)
 * Create multiple badge definitions for a game
 * 
 * @param {Object} payload - { game_id, badges[] }
 */
var rpcBadgesBulkCreate = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.badges || !Array.isArray(data.badges)) {
            throw Error("game_id and badges array are required");
        }
        
        var gameId = data.game_id;
        var badgesToCreate = data.badges;
        var definitionsKey = "definitions_" + gameId;
        
        // Get existing definitions
        var definitions = { badges: [] };
        
        try {
            var records = nk.storageRead([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Badges] Creating new definitions collection");
        }
        
        var created = [];
        var updated = [];
        var errors = [];
        
        for (var i = 0; i < badgesToCreate.length; i++) {
            var badgeData = badgesToCreate[i];
            
            try {
                if (!badgeData.badge_id || !badgeData.title) {
                    throw Error("badge_id and title are required");
                }
                
                // Check if exists
                var existingIndex = -1;
                for (var j = 0; j < definitions.badges.length; j++) {
                    if (definitions.badges[j].badge_id === badgeData.badge_id) {
                        existingIndex = j;
                        break;
                    }
                }
                
                var badge = {
                    badge_id: badgeData.badge_id,
                    game_id: gameId,
                    title: badgeData.title,
                    description: badgeData.description || "",
                    icon_url: badgeData.icon_url || "badges/default.png",
                    category: badgeData.category || "general",
                    rarity: badgeData.rarity || "common",
                    type: badgeData.type || "progressive",
                    target: badgeData.target || 1,
                    unlock_criteria: badgeData.unlock_criteria || null,
                    rewards: badgeData.rewards || { coins: 100 },
                    hidden: badgeData.hidden || false,
                    points: badgeData.points || 10,
                    order: badgeData.order || (definitions.badges.length + i + 1),
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                if (existingIndex >= 0) {
                    badge.created_at = definitions.badges[existingIndex].created_at;
                    definitions.badges[existingIndex] = badge;
                    updated.push(badge.badge_id);
                } else {
                    definitions.badges.push(badge);
                    created.push(badge.badge_id);
                }
                
            } catch (err) {
                errors.push({
                    badge_id: badgeData.badge_id,
                    error: err.message
                });
            }
        }
        
        // Save definitions
        if (created.length > 0 || updated.length > 0) {
            nk.storageWrite([{
                collection: BADGE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID,
                value: definitions,
                permissionRead: 2,
                permissionWrite: 0
            }]);
        }
        
        logger.info("[Badges] Bulk create completed - created: " + created.length + ", updated: " + updated.length);
        
        return JSON.stringify({
            success: true,
            created: created,
            updated: updated,
            errors: errors,
            total_badges: definitions.badges.length
        });
        
    } catch (err) {
        logger.error("[Badges] Bulk create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: collectables_bulk_create (Admin only)
 * Create multiple collectable definitions for a game
 */
var rpcCollectablesBulkCreate = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.collectables || !Array.isArray(data.collectables)) {
            throw Error("game_id and collectables array are required");
        }
        
        var gameId = data.game_id;
        var collectablesToCreate = data.collectables;
        var definitionsKey = "definitions_" + gameId;
        
        // Get existing definitions
        var definitions = { collectables: [] };
        
        try {
            var records = nk.storageRead([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (records && records.length > 0 && records[0].value) {
                definitions = records[0].value;
            }
        } catch (err) {
            logger.debug("[Collectables] Creating new definitions collection");
        }
        
        var created = [];
        var updated = [];
        var errors = [];
        
        for (var i = 0; i < collectablesToCreate.length; i++) {
            var colData = collectablesToCreate[i];
            
            try {
                if (!colData.collectable_id || !colData.title) {
                    throw Error("collectable_id and title are required");
                }
                
                // Check if exists
                var existingIndex = -1;
                for (var j = 0; j < definitions.collectables.length; j++) {
                    if (definitions.collectables[j].collectable_id === colData.collectable_id) {
                        existingIndex = j;
                        break;
                    }
                }
                
                var collectable = {
                    collectable_id: colData.collectable_id,
                    game_id: gameId,
                    title: colData.title,
                    description: colData.description || "",
                    icon_url: colData.icon_url || "collectables/default.png",
                    category: colData.category || "general",
                    rarity: colData.rarity || "common",
                    max_quantity: colData.max_quantity || 1,
                    tradeable: colData.tradeable || false,
                    source: colData.source || ["system"],
                    metadata: colData.metadata || {},
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                if (existingIndex >= 0) {
                    collectable.created_at = definitions.collectables[existingIndex].created_at;
                    definitions.collectables[existingIndex] = collectable;
                    updated.push(collectable.collectable_id);
                } else {
                    definitions.collectables.push(collectable);
                    created.push(collectable.collectable_id);
                }
                
            } catch (err) {
                errors.push({
                    collectable_id: colData.collectable_id,
                    error: err.message
                });
            }
        }
        
        // Save definitions
        if (created.length > 0 || updated.length > 0) {
            nk.storageWrite([{
                collection: COLLECTABLE_COLLECTION,
                key: definitionsKey,
                userId: SYSTEM_USER_ID,
                value: definitions,
                permissionRead: 2,
                permissionWrite: 0
            }]);
        }
        
        logger.info("[Collectables] Bulk create completed - created: " + created.length + ", updated: " + updated.length);
        
        return JSON.stringify({
            success: true,
            created: created,
            updated: updated,
            errors: errors,
            total_collectables: definitions.collectables.length
        });
        
    } catch (err) {
        logger.error("[Collectables] Bulk create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Grant badge rewards (coins, XP, items)
 */
function grantBadgeRewards(nk, logger, userId, gameId, rewards) {
    var granted = {
        coins: 0,
        xp: 0,
        items: []
    };
    
    try {
        // Grant coins via wallet
        if (rewards.coins && rewards.coins > 0) {
            try {
                // Use Nakama wallet
                var walletUpdate = {};
                walletUpdate["coins"] = rewards.coins;
                
                nk.walletUpdate(userId, walletUpdate, {
                    source: "badge_reward",
                    game_id: gameId
                });
                
                granted.coins = rewards.coins;
                logger.info("[Badges] Granted " + rewards.coins + " coins to user: " + userId);
            } catch (walletErr) {
                logger.warn("[Badges] Wallet update failed: " + walletErr.message);
            }
        }
        
        // Grant XP (stored in player metadata)
        if (rewards.xp && rewards.xp > 0) {
            try {
                var account = nk.accountGetId(userId);
                var metadata = account.user.metadata || {};
                metadata.total_xp = (metadata.total_xp || 0) + rewards.xp;
                
                nk.accountUpdateId(userId, null, null, null, null, null, null, metadata);
                granted.xp = rewards.xp;
            } catch (xpErr) {
                logger.warn("[Badges] XP grant failed: " + xpErr.message);
            }
        }
        
        // Grant collectables
        if (rewards.collectables && rewards.collectables.length > 0) {
            for (var i = 0; i < rewards.collectables.length; i++) {
                var col = rewards.collectables[i];
                granted.items.push(col);
            }
        }
        
        return granted;
        
    } catch (err) {
        logger.error("[Badges] Reward grant error: " + err.message);
        return granted;
    }
}

// ============================================================================
// MODULE EXPORTS / REGISTRATION
// ============================================================================

// Export functions for registration in index.js
if (typeof module !== 'undefined') {
    module.exports = {
        // Badge RPCs
        rpcBadgesGetAll: rpcBadgesGetAll,
        rpcBadgesUpdateProgress: rpcBadgesUpdateProgress,
        rpcBadgesCheckEvent: rpcBadgesCheckEvent,
        rpcBadgesSetDisplayed: rpcBadgesSetDisplayed,
        rpcBadgesBulkCreate: rpcBadgesBulkCreate,
        
        // Collectable RPCs
        rpcCollectablesGetAll: rpcCollectablesGetAll,
        rpcCollectablesGrant: rpcCollectablesGrant,
        rpcCollectablesEquip: rpcCollectablesEquip,
        rpcCollectablesBulkCreate: rpcCollectablesBulkCreate,
        
        // Constants
        BADGE_CATEGORIES: BADGE_CATEGORIES,
        RARITY: RARITY
    };
}
