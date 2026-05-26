/**
 * Platform Leaderboard Module
 * 
 * Generic leaderboard system that works for ALL games on the platform.
 * Supports Daily, Weekly, Monthly, and All-Time leaderboards with automatic
 * profile picture enrichment.
 * 
 * @version 1.0.0
 * @author IntelliVerse-X
 * @date 2026-01-10
 * 
 * RPCs Registered:
 * - get_platform_leaderboard       : Generic leaderboard with profile pictures
 * - get_platform_leaderboard_multi : Multiple timeframes at once
 * - submit_platform_score          : Submit score to any game leaderboard
 * - get_user_leaderboard_stats     : Get user's stats across all timeframes
 */

// ============================================================================
// LEADERBOARD ID PATTERNS
// ============================================================================
// Format: {gameId}_{timeframe}_{type}
// Examples:
//   - quiz_daily_score
//   - quiz_weekly_score
//   - quiz_monthly_score
//   - quiz_alltime_score
//   - cricket_daily_predictions
//   - cricket_weekly_trivia

// Reset schedules (cron format)
const RESET_SCHEDULES = {
    daily: "0 0 * * *",      // Every day at midnight UTC
    weekly: "0 0 * * 1",      // Every Monday at midnight UTC
    monthly: "0 0 1 * *",     // First of every month at midnight UTC
    alltime: ""               // Never resets
};

// Sort orders
const LEADERBOARD_CONFIG = {
    descending: "desc",
    ascending: "asc",
    best: "best",     // Keep best score
    incr: "incr",     // Sum/increment scores
    set: "set"        // Replace score
};

// ============================================================================
// HELPER: Get User Profile Data (Profile Picture + Display Name)
// ============================================================================
function getUserProfileData(nk, logger, userId) {
    let profilePicture = null;
    let displayName = null;
    
    try {
        const users = nk.usersGetId([userId]);
        if (users && users.length > 0) {
            const user = users[0];
            displayName = user.displayName || user.username || null;
            
            // Primary: Use avatarUrl (synced from UserManagement)
            if (user.avatarUrl) {
                profilePicture = user.avatarUrl;
            }
            
            // Fallback: Check user metadata
            if (!profilePicture && user.metadata) {
                try {
                    const metadata = typeof user.metadata === 'string' 
                        ? JSON.parse(user.metadata) 
                        : user.metadata;
                    profilePicture = metadata.profilePicture || null;
                } catch (e) {
                    // Metadata parse failed, ignore
                }
            }
        }
    } catch (e) {
        logger.warn(`[PlatformLeaderboard] Failed to get profile for ${userId}: ${e.message}`);
    }
    
    return { profilePicture, displayName };
}

// ============================================================================
// HELPER: Enrich Leaderboard Records with Profile Pictures
// ============================================================================
function enrichLeaderboardRecords(nk, logger, records) {
    if (!records || records.length === 0) {
        return [];
    }
    
    return records.map(record => {
        const profileData = getUserProfileData(nk, logger, record.ownerId);
        
        // Parse metadata if it's a string
        let parsedMetadata = null;
        if (record.metadata) {
            try {
                parsedMetadata = typeof record.metadata === 'string' 
                    ? JSON.parse(record.metadata) 
                    : record.metadata;
            } catch (e) {
                parsedMetadata = null;
            }
        }
        
        return {
            rank: record.rank,
            userId: record.ownerId,
            username: record.username?.value || record.username || "Anonymous",
            displayName: profileData.displayName || record.username?.value || record.username || "Anonymous",
            score: record.score,
            subscore: record.subscore,
            numScore: record.numScore,
            metadata: parsedMetadata,
            updateTime: record.updateTime,
            // Profile Picture - THE KEY ADDITION
            profilePicture: profileData.profilePicture
        };
    });
}

// ============================================================================
// HELPER: Build Leaderboard ID
// ============================================================================
function buildLeaderboardId(gameId, timeframe, type) {
    type = type || "score";
    return `${gameId}_${timeframe}_${type}`;
}

// ============================================================================
// HELPER: Ensure Leaderboard Exists
// ============================================================================
function ensureLeaderboardExists(nk, logger, leaderboardId, timeframe, sortOrder, operator) {
    sortOrder = sortOrder || "desc";
    operator = operator || "best";
    
    const resetSchedule = RESET_SCHEDULES[timeframe] || "";
    
    try {
        nk.leaderboardCreate(
            leaderboardId,
            false,           // authoritative
            sortOrder,       // sort order
            operator,        // operator
            resetSchedule,   // reset schedule
            null             // metadata
        );
        logger.debug(`[PlatformLeaderboard] Created/ensured leaderboard: ${leaderboardId}`);
    } catch (e) {
        // Already exists, which is fine
    }
}

// ============================================================================
// RPC: Get Platform Leaderboard (Generic for ALL Games)
// ============================================================================
/**
 * Generic leaderboard RPC that works for any game.
 * Automatically includes profile pictures for all entries.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",           // Required: Game identifier
 *   "timeframe": "daily",       // Required: daily | weekly | monthly | alltime
 *   "type": "score",            // Optional: leaderboard type (default: "score")
 *   "leaderboardId": "...",     // Optional: Override full leaderboard ID
 *   "limit": 100,               // Optional: Max records (default: 100)
 *   "cursor": null              // Optional: Pagination cursor
 * }
 * 
 * Response includes profilePicture field for each entry.
 */
function rpcGetPlatformLeaderboard(context, logger, nk, payload) {
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        timeframe,
        type = "score",
        leaderboardId: customLeaderboardId,
        limit = 100,
        cursor = null
    } = data;

    // Determine leaderboard ID
    let leaderboardId = customLeaderboardId;
    if (!leaderboardId) {
        if (!gameId || !timeframe) {
            throw new Error("Either leaderboardId OR (gameId + timeframe) is required");
        }
        leaderboardId = buildLeaderboardId(gameId, timeframe, type);
    }

    const userId = context.userId;

    // Ensure leaderboard exists
    ensureLeaderboardExists(nk, logger, leaderboardId, timeframe || "alltime");

    // Get leaderboard records
    let records;
    try {
        records = nk.leaderboardRecordsList(leaderboardId, null, limit, cursor || "", 0);
    } catch (e) {
        logger.error(`[PlatformLeaderboard] Failed to get leaderboard ${leaderboardId}: ${e.message}`);
        throw new Error(`Leaderboard not found: ${leaderboardId}`);
    }

    // Enrich with profile pictures
    const enrichedRecords = enrichLeaderboardRecords(nk, logger, records.records || []);

    // Get user's own position
    let userRecord = null;
    if (userId) {
        try {
            const userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
            if (userRecords.records && userRecords.records.length > 0) {
                const enriched = enrichLeaderboardRecords(nk, logger, userRecords.records);
                userRecord = enriched[0];
            }
        } catch (e) {
            logger.warn(`[PlatformLeaderboard] Failed to get user record: ${e.message}`);
        }
    }

    return JSON.stringify({
        success: true,
        leaderboardId: leaderboardId,
        gameId: gameId,
        timeframe: timeframe,
        type: type,
        records: enrichedRecords,
        userRecord: userRecord,
        nextCursor: records.nextCursor || null,
        prevCursor: records.prevCursor || null,
        totalRecords: enrichedRecords.length
    });
}

// ============================================================================
// RPC: Get Multiple Timeframes at Once
// ============================================================================
/**
 * Get leaderboards for multiple timeframes in a single call.
 * Useful for showing daily/weekly/alltime tabs simultaneously.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",                           // Required
 *   "timeframes": ["daily", "weekly", "alltime"], // Required
 *   "type": "score",                            // Optional
 *   "limit": 10                                 // Optional (per timeframe)
 * }
 */
function rpcGetPlatformLeaderboardMulti(context, logger, nk, payload) {
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        timeframes = ["daily", "weekly", "alltime"],
        type = "score",
        limit = 10
    } = data;

    if (!gameId) {
        throw new Error("gameId is required");
    }

    const userId = context.userId;
    const result = {};

    for (const timeframe of timeframes) {
        const leaderboardId = buildLeaderboardId(gameId, timeframe, type);
        
        // Ensure leaderboard exists
        ensureLeaderboardExists(nk, logger, leaderboardId, timeframe);

        try {
            const records = nk.leaderboardRecordsList(leaderboardId, null, limit, "", 0);
            const enrichedRecords = enrichLeaderboardRecords(nk, logger, records.records || []);

            // Get user's position in this timeframe
            let userRecord = null;
            if (userId) {
                try {
                    const userRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
                    if (userRecords.records && userRecords.records.length > 0) {
                        const enriched = enrichLeaderboardRecords(nk, logger, userRecords.records);
                        userRecord = enriched[0];
                    }
                } catch (e) { }
            }

            result[timeframe] = {
                leaderboardId: leaderboardId,
                records: enrichedRecords,
                userRecord: userRecord
            };
        } catch (e) {
            result[timeframe] = {
                leaderboardId: leaderboardId,
                records: [],
                userRecord: null,
                error: e.message
            };
        }
    }

    return JSON.stringify({
        success: true,
        gameId: gameId,
        type: type,
        leaderboards: result
    });
}

// ============================================================================
// RPC: Submit Score to Platform Leaderboard
// ============================================================================
/**
 * Submit a score to any game leaderboard.
 * Automatically updates all relevant timeframes.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",           // Required
 *   "score": 1500,              // Required
 *   "subscore": 0,              // Optional
 *   "type": "score",            // Optional
 *   "metadata": {},             // Optional: Additional data
 *   "timeframes": ["daily", "weekly", "monthly", "alltime"] // Optional
 * }
 */
function rpcSubmitPlatformScore(context, logger, nk, payload) {
    const userId = context.userId;
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        score,
        subscore = 0,
        type = "score",
        metadata = {},
        timeframes = ["daily", "weekly", "monthly", "alltime"],
        operator = "best"
    } = data;

    if (!gameId) {
        throw new Error("gameId is required");
    }
    if (score === undefined || score === null) {
        throw new Error("score is required");
    }

    const results = {};
    const metadataStr = JSON.stringify(metadata);

    for (const timeframe of timeframes) {
        const leaderboardId = buildLeaderboardId(gameId, timeframe, type);
        
        // Ensure leaderboard exists
        ensureLeaderboardExists(nk, logger, leaderboardId, timeframe, "desc", operator);

        try {
            const record = nk.leaderboardRecordWrite(
                leaderboardId,
                userId,
                "",           // username (optional, will use account username)
                score,
                subscore,
                metadataStr,
                operator
            );

            results[timeframe] = {
                success: true,
                leaderboardId: leaderboardId,
                rank: record.rank,
                score: record.score
            };
        } catch (e) {
            results[timeframe] = {
                success: false,
                error: e.message
            };
        }
    }

    logger.info(`[PlatformLeaderboard] Score ${score} submitted for ${userId} in ${gameId}`);

    return JSON.stringify({
        success: true,
        gameId: gameId,
        score: score,
        results: results
    });
}

// ============================================================================
// RPC: Get User's Leaderboard Stats Across All Timeframes
// ============================================================================
/**
 * Get user's rank and score across all timeframes for a game.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",    // Required
 *   "type": "score"      // Optional
 * }
 */
function rpcGetUserLeaderboardStats(context, logger, nk, payload) {
    const userId = context.userId;
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        type = "score"
    } = data;

    if (!gameId) {
        throw new Error("gameId is required");
    }

    const timeframes = ["daily", "weekly", "monthly", "alltime"];
    const stats = {};

    // Get user profile data once
    const profileData = getUserProfileData(nk, logger, userId);

    for (const timeframe of timeframes) {
        const leaderboardId = buildLeaderboardId(gameId, timeframe, type);
        
        try {
            const records = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
            
            if (records.records && records.records.length > 0) {
                const record = records.records[0];
                stats[timeframe] = {
                    rank: record.rank,
                    score: record.score,
                    subscore: record.subscore,
                    numScore: record.numScore,
                    updateTime: record.updateTime
                };
            } else {
                stats[timeframe] = {
                    rank: null,
                    score: 0,
                    message: "No record in this timeframe"
                };
            }
        } catch (e) {
            stats[timeframe] = {
                rank: null,
                score: 0,
                error: e.message
            };
        }
    }

    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        displayName: profileData.displayName,
        profilePicture: profileData.profilePicture,
        stats: stats
    });
}

// ============================================================================
// RPC: Get Leaderboard Around User
// ============================================================================
/**
 * Get leaderboard entries around the current user's position.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",       // Required
 *   "timeframe": "daily",   // Required
 *   "type": "score",        // Optional
 *   "limit": 10             // Optional: entries above and below user
 * }
 */
function rpcGetLeaderboardAroundUser(context, logger, nk, payload) {
    const userId = context.userId;
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        timeframe,
        type = "score",
        limit = 10
    } = data;

    if (!gameId || !timeframe) {
        throw new Error("gameId and timeframe are required");
    }

    const leaderboardId = buildLeaderboardId(gameId, timeframe, type);

    // Get records around user
    try {
        const records = nk.leaderboardRecordsList(leaderboardId, [userId], limit, "", userId);
        const enrichedRecords = enrichLeaderboardRecords(nk, logger, records.records || []);

        // Find user in the enriched records
        let userRecord = null;
        for (const record of enrichedRecords) {
            if (record.userId === userId) {
                userRecord = record;
                break;
            }
        }

        return JSON.stringify({
            success: true,
            leaderboardId: leaderboardId,
            gameId: gameId,
            timeframe: timeframe,
            records: enrichedRecords,
            userRecord: userRecord
        });
    } catch (e) {
        throw new Error(`Failed to get leaderboard: ${e.message}`);
    }
}

// ============================================================================
// RPC: Get All Leaderboards (Generic for ANY Game)
// ============================================================================
/**
 * Get ALL leaderboards (daily, weekly, monthly, alltime) for any game in one call.
 * All records include profilePicture field.
 * 
 * Payload:
 * {
 *   "gameId": "quiz",    // Required: Any game ID (quiz, cricket, trivia, etc.)
 *   "type": "score",     // Optional: leaderboard type (default: "score")
 *   "limit": 20          // Optional: records per timeframe (default: 20)
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "gameId": "quiz",
 *   "leaderboards": {
 *     "daily": { "records": [...], "ownerRecord": {...} },
 *     "weekly": { "records": [...], "ownerRecord": {...} },
 *     "monthly": { "records": [...], "ownerRecord": {...} },
 *     "alltime": { "records": [...], "ownerRecord": {...} }
 *   }
 * }
 * 
 * Each record includes: rank, userId, username, displayName, score, profilePicture
 */
function rpcGetAllLeaderboards(context, logger, nk, payload) {
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { 
        gameId,
        type = "score",
        limit = 20
    } = data;

    if (!gameId) {
        throw new Error("gameId is required");
    }

    const userId = context.userId;
    const timeframes = ["daily", "weekly", "monthly", "alltime"];
    const result = {};

    for (const timeframe of timeframes) {
        const leaderboardId = buildLeaderboardId(gameId, timeframe, type);
        
        // Ensure leaderboard exists
        ensureLeaderboardExists(nk, logger, leaderboardId, timeframe);

        try {
            const records = nk.leaderboardRecordsList(leaderboardId, userId ? [userId] : [], limit, "", 0);
            
            // Enrich with profile pictures
            const enrichedRecords = enrichLeaderboardRecords(nk, logger, records.records || []);
            
            // Get owner record if user is authenticated
            let ownerRecord = null;
            if (userId && records.ownerRecords && records.ownerRecords.length > 0) {
                const enrichedOwner = enrichLeaderboardRecords(nk, logger, [records.ownerRecords[0]]);
                ownerRecord = enrichedOwner[0];
            }

            result[timeframe] = {
                leaderboardId: leaderboardId,
                records: enrichedRecords,
                ownerRecord: ownerRecord
            };
        } catch (e) {
            result[timeframe] = {
                leaderboardId: leaderboardId,
                records: [],
                ownerRecord: null,
                error: e.message
            };
        }
    }

    return JSON.stringify({
        success: true,
        gameId: gameId,
        type: type,
        leaderboards: result
    });
}

// ============================================================================
// RPC: Delete User from Leaderboard (Admin)
// ============================================================================
function rpcDeleteLeaderboardRecord(context, logger, nk, payload) {
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { leaderboardId, userId: targetUserId } = data;

    if (!leaderboardId || !targetUserId) {
        throw new Error("leaderboardId and userId are required");
    }

    try {
        nk.leaderboardRecordDelete(leaderboardId, targetUserId);
        logger.info(`[PlatformLeaderboard] Deleted record for ${targetUserId} from ${leaderboardId}`);
        
        return JSON.stringify({
            success: true,
            message: `Record deleted from ${leaderboardId}`
        });
    } catch (e) {
        throw new Error(`Failed to delete record: ${e.message}`);
    }
}

// ============================================================================
// Initialize Platform Leaderboard Module
// ============================================================================
function InitModule(ctx, logger, nk, initializer) {
    logger.info("🏆 Platform Leaderboard Module loading...");
    logger.info("   Supports: Daily, Weekly, Monthly, All-Time leaderboards");
    logger.info("   Feature: Automatic profile picture enrichment");

    // Register RPCs
    initializer.registerRpc("get_platform_leaderboard", rpcGetPlatformLeaderboard);
    logger.info("   ✅ Registered: get_platform_leaderboard");

    initializer.registerRpc("get_platform_leaderboard_multi", rpcGetPlatformLeaderboardMulti);
    logger.info("   ✅ Registered: get_platform_leaderboard_multi");

    // Generic "get_all_leaderboards" - works for ANY gameId
    initializer.registerRpc("get_all_leaderboards", rpcGetAllLeaderboards);
    logger.info("   ✅ Registered: get_all_leaderboards (ANY game)");

    initializer.registerRpc("submit_platform_score", rpcSubmitPlatformScore);
    logger.info("   ✅ Registered: submit_platform_score");

    initializer.registerRpc("get_user_leaderboard_stats", rpcGetUserLeaderboardStats);
    logger.info("   ✅ Registered: get_user_leaderboard_stats");

    initializer.registerRpc("get_leaderboard_around_user", rpcGetLeaderboardAroundUser);
    logger.info("   ✅ Registered: get_leaderboard_around_user");

    initializer.registerRpc("delete_leaderboard_record", rpcDeleteLeaderboardRecord);
    logger.info("   ✅ Registered: delete_leaderboard_record (admin)");

    logger.info("🏆 Platform Leaderboard Module initialized successfully!");
    logger.info("   Games can use: quiz, cricket, trivia, or any custom gameId");
    logger.info("   📷 ALL leaderboards include profilePicture field!");
}

!InitModule.toString().includes("InitModule") || InitModule;
