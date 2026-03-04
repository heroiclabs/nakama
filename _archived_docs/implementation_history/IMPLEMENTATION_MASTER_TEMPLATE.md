# Master Implementation Template for Nakama Multi-Game Platform

**Version**: 2.0.0  
**Date**: November 16, 2025  
**Status**: Implementation Ready

---

## Table of Contents

1. [Implementation Overview](#implementation-overview)
2. [Server-Side Implementation](#server-side-implementation)
3. [Achievement System](#achievement-system)
4. [Matchmaking System](#matchmaking-system)
5. [Tournament System](#tournament-system)
6. [Season/Battle Pass System](#season-battle-pass-system)
7. [Events System](#events-system)
8. [Server Improvements](#server-improvements)
9. [Testing Templates](#testing-templates)
10. [Deployment Guide](#deployment-guide)

---

## Implementation Overview

### Architecture Principles

1. **GameID-First**: All features must support multi-game isolation via gameID
2. **Backwards Compatible**: Don't break existing RPCs
3. **Scalable**: Design for 1000+ concurrent users per game
4. **Secure**: Validate all inputs, prevent cheating
5. **Observable**: Log metrics, track performance

### File Organization

```
nakama/data/modules/
├── achievements/
│   ├── achievements.js           # Achievement system
│   ├── achievement_definitions.js # Achievement templates
│   └── achievement_progress.js    # Progress tracking
├── matchmaking/
│   ├── matchmaking.js            # Core matchmaking logic
│   ├── skill_rating.js           # ELO/rating system
│   └── party_system.js           # Party/squad support
├── tournaments/
│   ├── tournaments.js            # Tournament management
│   ├── tournament_brackets.js    # Bracket generation
│   └── tournament_prizes.js      # Prize distribution
├── seasons/
│   ├── seasons.js                # Season/battle pass
│   ├── season_rewards.js         # Reward tiers
│   └── season_xp.js              # XP tracking
├── events/
│   ├── events.js                 # Event management
│   ├── event_missions.js         # Event-specific missions
│   └── event_rewards.js          # Event rewards
└── infrastructure/
    ├── batch_operations.js       # Batch RPC handler
    ├── rate_limiting.js          # Rate limit middleware
    ├── caching.js                # Caching layer
    ├── transactions.js           # Transaction support
    └── metrics.js                # Analytics & monitoring
```

---

## Achievement System

### Implementation Template

```javascript
// achievements/achievements.js

/**
 * Achievement System for Multi-Game Platform
 * Supports per-game achievements with unlock tracking and rewards
 */

// Achievement storage collection naming
const ACHIEVEMENT_COLLECTION = "achievements";
const ACHIEVEMENT_PROGRESS_COLLECTION = "achievement_progress";

/**
 * Achievement definition structure
 */
const AchievementSchema = {
    achievement_id: "string",        // Unique identifier
    game_id: "string (UUID)",        // Game this achievement belongs to
    title: "string",                 // Display name
    description: "string",           // What player needs to do
    icon_url: "string",              // Achievement icon
    rarity: "common|rare|epic|legendary",
    category: "string",              // combat, social, progression, etc.
    type: "simple|incremental|tiered",
    
    // Requirements
    target: "number",                // Target value (for incremental)
    conditions: {                    // Unlock conditions
        stat_name: "string",         // e.g., "total_kills", "games_won"
        operator: ">=|<=|==",
        value: "number"
    },
    
    // Rewards
    rewards: {
        coins: "number",
        xp: "number",
        items: ["item_id_1", "item_id_2"],
        badge: "badge_id",           // Optional cosmetic badge
        title: "player_title"        // Optional title unlock
    },
    
    // Metadata
    created_at: "ISO timestamp",
    updated_at: "ISO timestamp",
    hidden: "boolean",               // Secret achievement
    points: "number"                 // Achievement points
};

/**
 * RPC: achievements_get_all
 * Get all achievements for a game with player progress
 */
function rpcAchievementsGetAll(ctx, logger, nk, payload) {
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
}

/**
 * RPC: achievements_update_progress
 * Update progress towards an achievement
 */
function rpcAchievementsUpdateProgress(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.achievement_id || data.progress === undefined) {
            throw Error("game_id, achievement_id, and progress are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var achievementId = data.achievement_id;
        var newProgress = data.progress;
        var increment = data.increment || false; // If true, add to existing progress
        
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
}

/**
 * Helper: Grant achievement rewards
 */
function grantAchievementRewards(nk, logger, userId, gameId, rewards) {
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
        
        // Grant badge/title (store in profile)
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
}

/**
 * RPC: achievements_create_definition (Admin only)
 * Create a new achievement definition
 */
function rpcAchievementsCreateDefinition(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        // Validate admin permissions (implement proper auth check)
        // For now, we'll allow any authenticated user
        
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
            permissionRead: 2, // Public read
            permissionWrite: 0 // No public write
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
}

// Export functions (add to main index.js registration)
```

---

## Matchmaking System

### Implementation Template

```javascript
// matchmaking/matchmaking.js

/**
 * Matchmaking System for Multi-Game Platform
 * Supports skill-based matching, party queues, and game modes
 */

const MATCHMAKING_TICKETS_COLLECTION = "matchmaking_tickets";
const MATCHMAKING_HISTORY_COLLECTION = "matchmaking_history";

/**
 * RPC: matchmaking_find_match
 * Create matchmaking ticket and find match
 */
function rpcMatchmakingFindMatch(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.mode) {
            throw Error("game_id and mode are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var mode = data.mode; // "solo", "duo", "squad", etc.
        var skillLevel = data.skill_level || 1000; // ELO rating
        var partyMembers = data.party_members || []; // Array of user IDs
        
        logger.info("[Matchmaking] Finding match for user: " + userId + ", mode: " + mode);
        
        // Calculate skill range
        var minSkill = skillLevel - 100;
        var maxSkill = skillLevel + 100;
        
        // Party size
        var partySize = partyMembers.length + 1; // Include self
        
        // Create matchmaking ticket
        var query = "+properties.game_id:" + gameId + " +properties.mode:" + mode;
        
        var ticket = nk.matchmakerAdd(
            query,                  // Query
            minSkill,               // Min skill
            maxSkill,               // Max skill
            query,                  // String properties query
            {                       // Numeric properties
                skill: skillLevel,
                party_size: partySize
            },
            {                       // String properties
                game_id: gameId,
                mode: mode,
                user_id: userId
            }
        );
        
        // Store ticket info
        var ticketKey = "ticket_" + userId + "_" + gameId;
        var ticketData = {
            ticket_id: ticket,
            user_id: userId,
            game_id: gameId,
            mode: mode,
            skill_level: skillLevel,
            party_members: partyMembers,
            created_at: new Date().toISOString(),
            status: "searching"
        };
        
        nk.storageWrite([{
            collection: MATCHMAKING_TICKETS_COLLECTION,
            key: ticketKey,
            userId: userId,
            value: ticketData,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[Matchmaking] Ticket created: " + ticket);
        
        return JSON.stringify({
            success: true,
            ticket_id: ticket,
            estimated_wait_seconds: 30,
            mode: mode,
            skill_level: skillLevel
        });
        
    } catch (err) {
        logger.error("[Matchmaking] Find match error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: matchmaking_cancel
 * Cancel matchmaking ticket
 */
function rpcMatchmakingCancel(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.ticket_id) {
            throw Error("ticket_id is required");
        }
        
        var ticketId = data.ticket_id;
        
        // Remove from matchmaker
        nk.matchmakerRemove(ticketId);
        
        logger.info("[Matchmaking] Ticket cancelled: " + ticketId);
        
        return JSON.stringify({
            success: true,
            ticket_id: ticketId
        });
        
    } catch (err) {
        logger.error("[Matchmaking] Cancel error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: matchmaking_get_status
 * Check matchmaking status
 */
function rpcMatchmakingGetStatus(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        
        // Get ticket info
        var ticketKey = "ticket_" + userId + "_" + gameId;
        
        var records = nk.storageRead([{
            collection: MATCHMAKING_TICKETS_COLLECTION,
            key: ticketKey,
            userId: userId
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            return JSON.stringify({
                success: true,
                status: "idle",
                message: "No active matchmaking"
            });
        }
        
        var ticketData = records[0].value;
        
        return JSON.stringify({
            success: true,
            status: ticketData.status,
            ticket_id: ticketData.ticket_id,
            mode: ticketData.mode,
            created_at: ticketData.created_at
        });
        
    } catch (err) {
        logger.error("[Matchmaking] Get status error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Match found callback (called by Nakama when match is found)
function matchmakerMatched(ctx, logger, nk, matches) {
    logger.info("[Matchmaking] Match found! Processing " + matches.length + " players");
    
    // Create match
    var matchId = nk.matchCreate("match_module", {
        players: matches.map(function(m) { return m.presence.userId; })
    });
    
    // Notify players
    for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        
        // Update ticket status
        var ticketKey = "ticket_" + match.presence.userId + "_" + match.properties.game_id;
        
        nk.storageWrite([{
            collection: MATCHMAKING_TICKETS_COLLECTION,
            key: ticketKey,
            userId: match.presence.userId,
            value: {
                status: "found",
                match_id: matchId,
                matched_at: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Send notification
        nk.notificationSend(
            match.presence.userId,
            "Match Found!",
            {
                match_id: matchId,
                code: 1 // Match found code
            },
            1, // Code for match notifications
            "", // Sender ID (system)
            true // Persistent
        );
    }
    
    return matchId;
}

// Export functions
```

---

## Tournament System

### Implementation Template

```javascript
// tournaments/tournaments.js

/**
 * Tournament System for Multi-Game Platform
 * Supports scheduled tournaments with brackets and prizes
 */

const TOURNAMENT_COLLECTION = "tournaments";
const TOURNAMENT_ENTRIES_COLLECTION = "tournament_entries";

/**
 * RPC: tournament_create (Admin only)
 * Create a new tournament
 */
function rpcTournamentCreate(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.title || !data.start_time || !data.end_time) {
            throw Error("game_id, title, start_time, and end_time are required");
        }
        
        var gameId = data.game_id;
        var tournamentId = "tournament_" + gameId + "_" + Date.now();
        
        // Create tournament leaderboard
        var metadata = {
            title: data.title,
            description: data.description || "",
            start_time: data.start_time,
            end_time: data.end_time,
            entry_fee: data.entry_fee || 0,
            max_players: data.max_players || 100,
            prize_pool: data.prize_pool || {},
            format: data.format || "leaderboard", // "leaderboard" or "bracket"
            game_id: gameId
        };
        
        nk.leaderboardCreate(
            tournamentId,
            false,      // Not authoritative
            "desc",     // Sort descending
            "reset",    // Operator (will reset after tournament ends)
            metadata
        );
        
        // Store tournament info
        var tournament = {
            tournament_id: tournamentId,
            game_id: gameId,
            title: data.title,
            description: data.description || "",
            start_time: data.start_time,
            end_time: data.end_time,
            entry_fee: data.entry_fee || 0,
            max_players: data.max_players || 100,
            prize_pool: data.prize_pool || {
                1: { coins: 5000, items: ["legendary_trophy"] },
                2: { coins: 3000, items: ["epic_trophy"] },
                3: { coins: 2000, items: ["rare_trophy"] }
            },
            format: data.format || "leaderboard",
            status: "upcoming",
            players_joined: 0,
            created_at: new Date().toISOString()
        };
        
        nk.storageWrite([{
            collection: TOURNAMENT_COLLECTION,
            key: tournamentId,
            userId: "00000000-0000-0000-0000-000000000000",
            value: tournament,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info("[Tournament] Created: " + tournamentId);
        
        return JSON.stringify({
            success: true,
            tournament: tournament
        });
        
    } catch (err) {
        logger.error("[Tournament] Create error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: tournament_join
 * Join a tournament
 */
function rpcTournamentJoin(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.tournament_id) {
            throw Error("tournament_id is required");
        }
        
        var userId = ctx.userId;
        var tournamentId = data.tournament_id;
        
        logger.info("[Tournament] User " + userId + " joining tournament: " + tournamentId);
        
        // Get tournament info
        var records = nk.storageRead([{
            collection: TOURNAMENT_COLLECTION,
            key: tournamentId,
            userId: "00000000-0000-0000-0000-000000000000"
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            throw Error("Tournament not found");
        }
        
        var tournament = records[0].value;
        
        // Check if tournament is open for registration
        var now = new Date();
        var startTime = new Date(tournament.start_time);
        
        if (now >= startTime) {
            throw Error("Tournament has already started");
        }
        
        // Check if tournament is full
        if (tournament.players_joined >= tournament.max_players) {
            throw Error("Tournament is full");
        }
        
        // Check if already joined
        var entryKey = "entry_" + userId + "_" + tournamentId;
        
        try {
            var entryRecords = nk.storageRead([{
                collection: TOURNAMENT_ENTRIES_COLLECTION,
                key: entryKey,
                userId: userId
            }]);
            
            if (entryRecords && entryRecords.length > 0 && entryRecords[0].value) {
                throw Error("Already joined this tournament");
            }
        } catch (err) {
            // Not joined yet, continue
        }
        
        // Check and deduct entry fee
        if (tournament.entry_fee > 0) {
            var walletKey = "wallet_" + userId + "_" + tournament.game_id;
            var wallet = null;
            
            var walletRecords = nk.storageRead([{
                collection: tournament.game_id + "_wallets",
                key: walletKey,
                userId: userId
            }]);
            
            if (walletRecords && walletRecords.length > 0 && walletRecords[0].value) {
                wallet = walletRecords[0].value;
            }
            
            if (!wallet || wallet.balance < tournament.entry_fee) {
                throw Error("Insufficient balance for entry fee");
            }
            
            // Deduct entry fee
            wallet.balance -= tournament.entry_fee;
            wallet.updated_at = new Date().toISOString();
            
            nk.storageWrite([{
                collection: tournament.game_id + "_wallets",
                key: walletKey,
                userId: userId,
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }
        
        // Create entry
        var entry = {
            user_id: userId,
            tournament_id: tournamentId,
            joined_at: new Date().toISOString(),
            entry_fee_paid: tournament.entry_fee
        };
        
        nk.storageWrite([{
            collection: TOURNAMENT_ENTRIES_COLLECTION,
            key: entryKey,
            userId: userId,
            value: entry,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        // Update tournament player count
        tournament.players_joined += 1;
        
        nk.storageWrite([{
            collection: TOURNAMENT_COLLECTION,
            key: tournamentId,
            userId: "00000000-0000-0000-0000-000000000000",
            value: tournament,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info("[Tournament] User joined: " + userId);
        
        return JSON.stringify({
            success: true,
            tournament_id: tournamentId,
            players_joined: tournament.players_joined,
            max_players: tournament.max_players
        });
        
    } catch (err) {
        logger.error("[Tournament] Join error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: tournament_list_active
 * Get all active tournaments for a game
 */
function rpcTournamentListActive(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var gameId = data.game_id;
        
        // List all tournaments for this game
        var records = nk.storageList("00000000-0000-0000-0000-000000000000", TOURNAMENT_COLLECTION, 100);
        
        var tournaments = [];
        var now = new Date();
        
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var tournament = records.objects[i].value;
                
                if (tournament.game_id !== gameId) {
                    continue;
                }
                
                var endTime = new Date(tournament.end_time);
                
                // Only include active or upcoming tournaments
                if (now <= endTime) {
                    tournaments.push({
                        tournament_id: tournament.tournament_id,
                        title: tournament.title,
                        description: tournament.description,
                        start_time: tournament.start_time,
                        end_time: tournament.end_time,
                        entry_fee: tournament.entry_fee,
                        players_joined: tournament.players_joined,
                        max_players: tournament.max_players,
                        prize_pool: tournament.prize_pool,
                        format: tournament.format,
                        status: now < new Date(tournament.start_time) ? "upcoming" : "active"
                    });
                }
            }
        }
        
        return JSON.stringify({
            success: true,
            tournaments: tournaments
        });
        
    } catch (err) {
        logger.error("[Tournament] List active error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: tournament_submit_score
 * Submit score to tournament
 */
function rpcTournamentSubmitScore(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.tournament_id || data.score === undefined) {
            throw Error("tournament_id and score are required");
        }
        
        var userId = ctx.userId;
        var username = ctx.username || "Player";
        var tournamentId = data.tournament_id;
        var score = data.score;
        var metadata = data.metadata || {};
        
        // Verify user joined tournament
        var entryKey = "entry_" + userId + "_" + tournamentId;
        
        var entryRecords = nk.storageRead([{
            collection: TOURNAMENT_ENTRIES_COLLECTION,
            key: entryKey,
            userId: userId
        }]);
        
        if (!entryRecords || entryRecords.length === 0 || !entryRecords[0].value) {
            throw Error("You must join the tournament first");
        }
        
        // Submit score to tournament leaderboard
        nk.leaderboardRecordWrite(
            tournamentId,
            userId,
            username,
            score,
            0,
            metadata
        );
        
        // Get rank
        var leaderboard = nk.leaderboardRecordsList(tournamentId, [userId], 1);
        var rank = 999;
        
        if (leaderboard && leaderboard.records && leaderboard.records.length > 0) {
            rank = leaderboard.records[0].rank;
        }
        
        logger.info("[Tournament] Score submitted: " + score + ", rank: " + rank);
        
        return JSON.stringify({
            success: true,
            tournament_id: tournamentId,
            score: score,
            rank: rank
        });
        
    } catch (err) {
        logger.error("[Tournament] Submit score error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Export functions
```

---

## Server Improvements - Batch Operations

### Implementation Template

```javascript
// infrastructure/batch_operations.js

/**
 * Batch RPC Operations
 * Execute multiple RPCs in a single call
 */

/**
 * RPC: batch_execute
 * Execute multiple RPCs in one call
 */
function rpcBatchExecute(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.operations || !Array.isArray(data.operations)) {
            throw Error("operations array is required");
        }
        
        var operations = data.operations;
        var atomic = data.atomic || false; // All or nothing
        
        logger.info("[Batch] Executing " + operations.length + " operations, atomic: " + atomic);
        
        var results = [];
        var allSuccessful = true;
        
        for (var i = 0; i < operations.length; i++) {
            var op = operations[i];
            
            try {
                if (!op.rpc_id || !op.payload) {
                    throw Error("Each operation must have rpc_id and payload");
                }
                
                var result = nk.rpc(ctx, op.rpc_id, JSON.stringify(op.payload));
                var parsedResult = JSON.parse(result);
                
                results.push({
                    success: true,
                    operation_index: i,
                    rpc_id: op.rpc_id,
                    data: parsedResult
                });
                
            } catch (err) {
                allSuccessful = false;
                
                results.push({
                    success: false,
                    operation_index: i,
                    rpc_id: op.rpc_id,
                    error: err.message
                });
                
                // If atomic, stop on first error
                if (atomic) {
                    logger.error("[Batch] Atomic batch failed at operation " + i);
                    break;
                }
            }
        }
        
        return JSON.stringify({
            success: !atomic || allSuccessful,
            atomic: atomic,
            total_operations: operations.length,
            successful_operations: results.filter(function(r) { return r.success; }).length,
            failed_operations: results.filter(function(r) { return !r.success; }).length,
            results: results
        });
        
    } catch (err) {
        logger.error("[Batch] Execute error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Export function
```

---

## Rate Limiting Implementation

### Implementation Template

```javascript
// infrastructure/rate_limiting.js

/**
 * Rate Limiting System
 * Prevent RPC abuse and spam
 */

// In-memory rate limit store (use Redis in production)
var rateLimits = {};

/**
 * Check rate limit for user/RPC combination
 */
function checkRateLimit(userId, rpcName, maxCalls, windowSeconds) {
    var key = userId + "_" + rpcName;
    var now = Math.floor(Date.now() / 1000);
    
    // Initialize if doesn't exist
    if (!rateLimits[key]) {
        rateLimits[key] = {
            calls: [],
            window_start: now
        };
    }
    
    var record = rateLimits[key];
    
    // Remove calls outside window
    record.calls = record.calls.filter(function(timestamp) {
        return timestamp > now - windowSeconds;
    });
    
    // Check if limit exceeded
    if (record.calls.length >= maxCalls) {
        var oldestCall = record.calls[0];
        var retryAfter = Math.ceil(oldestCall + windowSeconds - now);
        
        return {
            allowed: false,
            retry_after: retryAfter,
            calls_remaining: 0
        };
    }
    
    // Add current call
    record.calls.push(now);
    
    return {
        allowed: true,
        retry_after: 0,
        calls_remaining: maxCalls - record.calls.length
    };
}

/**
 * Wrapper function to add rate limiting to any RPC
 */
function withRateLimit(rpcFunction, rpcName, maxCalls, windowSeconds) {
    return function(ctx, logger, nk, payload) {
        var limit = checkRateLimit(ctx.userId, rpcName, maxCalls, windowSeconds);
        
        if (!limit.allowed) {
            logger.warn("[RateLimit] User " + ctx.userId + " exceeded limit for " + rpcName);
            
            return JSON.stringify({
                success: false,
                error: "Rate limit exceeded. Try again in " + limit.retry_after + " seconds.",
                retry_after: limit.retry_after
            });
        }
        
        // Call original function
        return rpcFunction(ctx, logger, nk, payload);
    };
}

// Example usage:
// var rateLimitedSubmitScore = withRateLimit(rpcSubmitScore, "submit_score", 10, 60);

// Export functions
```

---

Continue to part 2...
