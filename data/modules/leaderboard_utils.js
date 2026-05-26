/**
 * Leaderboard Utilities Module
 * 
 * Provides shared utilities for enriching leaderboard records with user profile data
 * including profile pictures from the UserManagement service.
 * 
 * This module is used by all game-specific leaderboard RPCs to add profile pictures
 * without requiring changes to game clients.
 * 
 * @version 1.0.0
 * @author IntelliVerse-X
 */

// UserManagement API Configuration
const USER_MANAGEMENT_API_URL = "https://api.intelli-verse-x.ai/api/user";

/**
 * Enrich a single leaderboard record with profile picture
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID (ownerId from leaderboard record)
 * @returns {object} Profile data { profilePicture, displayName }
 */
function getUserProfileData(nk, logger, userId) {
    let profilePicture = null;
    let displayName = null;
    
    try {
        const users = nk.usersGetId([userId]);
        if (users && users.length > 0) {
            const user = users[0];
            displayName = user.displayName || user.username || null;
            
            // Primary: Use avatar_url (synced from UserManagement)
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
        logger.warn(`[LeaderboardUtils] Failed to get profile for ${userId}: ${e.message}`);
    }
    
    return { profilePicture, displayName };
}

/**
 * Enrich an array of leaderboard records with profile pictures
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {array} records - Array of leaderboard records from nk.leaderboardRecordsList()
 * @returns {array} Enriched records with profilePicture field
 */
function enrichLeaderboardRecords(nk, logger, records) {
    if (!records || records.length === 0) {
        return [];
    }
    
    return records.map(record => {
        const profileData = getUserProfileData(nk, logger, record.ownerId);
        
        return {
            rank: record.rank,
            userId: record.ownerId,
            username: record.username?.value || record.username || "Anonymous",
            displayName: profileData.displayName || record.username?.value || record.username || "Anonymous",
            score: record.score,
            subscore: record.subscore,
            numScore: record.numScore,
            metadata: record.metadata ? (typeof record.metadata === 'string' ? JSON.parse(record.metadata) : record.metadata) : null,
            updateTime: record.updateTime,
            // Profile Picture - THE KEY ADDITION
            profilePicture: profileData.profilePicture
        };
    });
}

/**
 * Enrich custom leaderboard entries (for storage-based leaderboards)
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {array} entries - Array of custom entries with userId field
 * @returns {array} Enriched entries with profilePicture field
 */
function enrichCustomEntries(nk, logger, entries) {
    if (!entries || entries.length === 0) {
        return [];
    }
    
    return entries.map(entry => {
        const profileData = getUserProfileData(nk, logger, entry.userId);
        
        return {
            ...entry,
            displayName: profileData.displayName || entry.username || "Anonymous",
            profilePicture: profileData.profilePicture
        };
    });
}

/**
 * Batch fetch profile pictures for multiple user IDs
 * More efficient when you need profiles for many users
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {array} userIds - Array of user IDs
 * @returns {object} Map of userId -> { profilePicture, displayName }
 */
function batchGetUserProfiles(nk, logger, userIds) {
    const profiles = {};
    
    if (!userIds || userIds.length === 0) {
        return profiles;
    }
    
    // Deduplicate user IDs
    const uniqueUserIds = [...new Set(userIds)];
    
    try {
        const users = nk.usersGetId(uniqueUserIds);
        
        for (const user of users) {
            let profilePicture = user.avatarUrl || null;
            
            // Check metadata if no avatar_url
            if (!profilePicture && user.metadata) {
                try {
                    const metadata = typeof user.metadata === 'string' 
                        ? JSON.parse(user.metadata) 
                        : user.metadata;
                    profilePicture = metadata.profilePicture || null;
                } catch (e) {
                    // ignore
                }
            }
            
            profiles[user.id] = {
                profilePicture: profilePicture,
                displayName: user.displayName || user.username || null
            };
        }
    } catch (e) {
        logger.warn(`[LeaderboardUtils] Batch profile fetch failed: ${e.message}`);
    }
    
    // Fill in missing entries with nulls
    for (const userId of uniqueUserIds) {
        if (!profiles[userId]) {
            profiles[userId] = { profilePicture: null, displayName: null };
        }
    }
    
    return profiles;
}

/**
 * Get a complete leaderboard with profile pictures
 * This is a convenience function that wraps leaderboardRecordsList
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {string} leaderboardId - Leaderboard ID
 * @param {number} limit - Number of records to fetch
 * @param {string|null} cursor - Pagination cursor
 * @returns {object} { records, prevCursor, nextCursor }
 */
function getLeaderboardWithProfiles(nk, logger, leaderboardId, limit, cursor) {
    limit = limit || 10;
    cursor = cursor || null;
    
    const result = nk.leaderboardRecordsList(leaderboardId, null, limit, cursor, 0);
    
    const enrichedRecords = enrichLeaderboardRecords(nk, logger, result.records || []);
    
    return {
        records: enrichedRecords,
        prevCursor: result.prevCursor || null,
        nextCursor: result.nextCursor || null
    };
}

/**
 * Get user's leaderboard position with profile picture
 * @param {object} nk - Nakama module
 * @param {object} logger - Logger instance
 * @param {string} leaderboardId - Leaderboard ID
 * @param {string} userId - User ID
 * @returns {object|null} User's record with profile picture, or null if not found
 */
function getUserLeaderboardPosition(nk, logger, leaderboardId, userId) {
    if (!userId) {
        return null;
    }
    
    try {
        const result = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
        
        if (result.records && result.records.length > 0) {
            const enriched = enrichLeaderboardRecords(nk, logger, result.records);
            return enriched[0];
        }
    } catch (e) {
        logger.warn(`[LeaderboardUtils] Failed to get user position for ${userId}: ${e.message}`);
    }
    
    return null;
}

// Export functions for use in other modules
// Note: In Nakama JS runtime, we expose these as global functions
var LeaderboardUtils = {
    getUserProfileData: getUserProfileData,
    enrichLeaderboardRecords: enrichLeaderboardRecords,
    enrichCustomEntries: enrichCustomEntries,
    batchGetUserProfiles: batchGetUserProfiles,
    getLeaderboardWithProfiles: getLeaderboardWithProfiles,
    getUserLeaderboardPosition: getUserLeaderboardPosition
};

// Make functions globally available
function _getUserProfileData(nk, logger, userId) {
    return getUserProfileData(nk, logger, userId);
}

function _enrichLeaderboardRecords(nk, logger, records) {
    return enrichLeaderboardRecords(nk, logger, records);
}

function _enrichCustomEntries(nk, logger, entries) {
    return enrichCustomEntries(nk, logger, entries);
}

function _batchGetUserProfiles(nk, logger, userIds) {
    return batchGetUserProfiles(nk, logger, userIds);
}

function _getLeaderboardWithProfiles(nk, logger, leaderboardId, limit, cursor) {
    return getLeaderboardWithProfiles(nk, logger, leaderboardId, limit, cursor);
}

function _getUserLeaderboardPosition(nk, logger, leaderboardId, userId) {
    return getUserLeaderboardPosition(nk, logger, leaderboardId, userId);
}

// Module initialization (empty - this is a utility module)
function InitModule(ctx, logger, nk, initializer) {
    logger.info("📊 Leaderboard Utils Module loaded");
    logger.info("   Available functions:");
    logger.info("   - getUserProfileData(nk, logger, userId)");
    logger.info("   - enrichLeaderboardRecords(nk, logger, records)");
    logger.info("   - enrichCustomEntries(nk, logger, entries)");
    logger.info("   - batchGetUserProfiles(nk, logger, userIds)");
    logger.info("   - getLeaderboardWithProfiles(nk, logger, leaderboardId, limit, cursor)");
    logger.info("   - getUserLeaderboardPosition(nk, logger, leaderboardId, userId)");
}

!InitModule.toString().includes("InitModule") || InitModule;
