/**
 * Profile Sync Module
 * 
 * Handles syncing user profile data (including profile pictures) from
 * the UserManagement service to Nakama user accounts.
 * 
 * This enables leaderboards to display profile pictures without
 * requiring changes to game clients.
 * 
 * RPCs:
 * - sync_profile_from_user_management: Sync profile using Cognito token
 * - update_profile_picture: Direct update of profile picture URL
 * - get_user_profile: Get profile with picture from Nakama
 * 
 * @version 1.0.0
 * @author IntelliVerse-X
 */

// UserManagement API Configuration
const USER_MANAGEMENT_API_URL = "https://api.intelli-verse-x.ai/api/user";

// Collection for storing profile sync metadata
const PROFILE_SYNC_COLLECTION = "profile_sync";

/**
 * RPC: Sync profile from UserManagement API to Nakama
 * 
 * Call this after user login or when profile is updated in UserManagement.
 * 
 * Payload: { "authToken": "<cognito_jwt>" }
 * Response: { "success": true, "profilePicture": "...", "displayName": "...", "syncedAt": ... }
 */
function rpcSyncProfileFromUserManagement(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }
    
    let request = {};
    try {
        request = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }
    
    const authToken = request.authToken;
    
    if (!authToken) {
        throw new Error("authToken is required");
    }
    
    logger.info(`[ProfileSync] Syncing profile for user ${userId}`);
    
    try {
        // Call UserManagement API to get profile
        const response = nk.httpRequest(
            `${USER_MANAGEMENT_API_URL}/auth/me`,
            "GET",
            {
                "Authorization": `Bearer ${authToken}`,
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            null
        );
        
        if (response.code === 200) {
            const result = JSON.parse(response.body);
            
            if (result.status && result.data) {
                const profile = result.data;
                const profilePicture = profile.profilePicture || null;
                const firstName = profile.firstName || "";
                const lastName = profile.lastName || "";
                const userName = profile.userName || "";
                
                // Determine display name
                let displayName = userName;
                if (firstName && lastName) {
                    displayName = `${firstName} ${lastName}`;
                } else if (firstName) {
                    displayName = firstName;
                } else if (lastName) {
                    displayName = lastName;
                }
                
                // Get current user metadata
                let currentMetadata = {};
                try {
                    const users = nk.usersGetId([userId]);
                    if (users && users.length > 0 && users[0].metadata) {
                        currentMetadata = typeof users[0].metadata === 'string'
                            ? JSON.parse(users[0].metadata)
                            : users[0].metadata;
                    }
                } catch (e) {
                    // ignore
                }
                
                // Update metadata with profile data
                currentMetadata.profilePicture = profilePicture;
                currentMetadata.externalUserId = profile.id;
                currentMetadata.email = profile.email;
                currentMetadata.firstName = firstName;
                currentMetadata.lastName = lastName;
                currentMetadata.userName = userName;
                currentMetadata.lastSyncedAt = Date.now();
                
                // Update Nakama account with avatar_url and display name
                nk.accountUpdateId(
                    userId,
                    null,                            // username (keep current)
                    displayName || null,             // displayName
                    null,                            // timezone
                    null,                            // location
                    null,                            // langTag
                    profilePicture,                  // avatarUrl - THIS IS THE KEY FIELD
                    JSON.stringify(currentMetadata)  // metadata
                );
                
                // Store sync record
                nk.storageWrite([{
                    collection: PROFILE_SYNC_COLLECTION,
                    key: "last_sync",
                    userId: userId,
                    value: {
                        syncedAt: Date.now(),
                        profilePicture: profilePicture,
                        displayName: displayName,
                        externalUserId: profile.id
                    },
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
                
                logger.info(`[ProfileSync] ✅ Synced profile for ${userId}: profilePicture=${profilePicture ? 'yes' : 'no'}`);
                
                return JSON.stringify({
                    success: true,
                    profilePicture: profilePicture,
                    displayName: displayName,
                    syncedAt: Date.now()
                });
            }
            
            throw new Error("Invalid response structure from UserManagement API");
        } else if (response.code === 401) {
            throw new Error("Invalid or expired auth token");
        } else {
            logger.error(`[ProfileSync] API error: ${response.code} - ${response.body}`);
            throw new Error(`UserManagement API error: ${response.code}`);
        }
        
    } catch (e) {
        logger.error(`[ProfileSync] Failed to sync profile for ${userId}: ${e.message}`);
        throw e;
    }
}

/**
 * RPC: Direct update of profile picture URL in Nakama
 * 
 * Use this when you already have the profile picture URL
 * (e.g., after a successful upload to UserManagement)
 * 
 * Payload: { "profilePictureUrl": "https://..." }
 * Response: { "success": true, "profilePicture": "..." }
 */
function rpcUpdateProfilePicture(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }
    
    let request = {};
    try {
        request = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }
    
    const profilePictureUrl = request.profilePictureUrl;
    
    if (!profilePictureUrl) {
        throw new Error("profilePictureUrl is required");
    }
    
    // Validate URL format (basic check)
    if (!profilePictureUrl.startsWith('http://') && !profilePictureUrl.startsWith('https://')) {
        throw new Error("profilePictureUrl must be a valid HTTP/HTTPS URL");
    }
    
    logger.info(`[ProfileSync] Updating profile picture for user ${userId}`);
    
    // Get current user metadata
    let currentMetadata = {};
    try {
        const users = nk.usersGetId([userId]);
        if (users && users.length > 0 && users[0].metadata) {
            currentMetadata = typeof users[0].metadata === 'string'
                ? JSON.parse(users[0].metadata)
                : users[0].metadata;
        }
    } catch (e) {
        // ignore
    }
    
    // Update metadata
    currentMetadata.profilePicture = profilePictureUrl;
    currentMetadata.profilePictureUpdatedAt = Date.now();
    
    // Update Nakama account with avatar_url
    nk.accountUpdateId(
        userId,
        null,                            // username
        null,                            // displayName
        null,                            // timezone
        null,                            // location
        null,                            // langTag
        profilePictureUrl,               // avatarUrl
        JSON.stringify(currentMetadata)  // metadata
    );
    
    // Store update record
    nk.storageWrite([{
        collection: PROFILE_SYNC_COLLECTION,
        key: "last_picture_update",
        userId: userId,
        value: {
            updatedAt: Date.now(),
            profilePicture: profilePictureUrl
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    logger.info(`[ProfileSync] ✅ Updated profile picture for ${userId}`);
    
    return JSON.stringify({
        success: true,
        profilePicture: profilePictureUrl,
        updatedAt: Date.now()
    });
}

/**
 * RPC: Get user profile with profile picture from Nakama
 * 
 * Payload: { "userId": "optional-user-id" } (defaults to current user)
 * Response: { "userId": "...", "username": "...", "displayName": "...", "profilePicture": "..." }
 */
function rpcGetUserProfile(context, logger, nk, payload) {
    let targetUserId = context.userId;
    
    // Allow fetching other user's public profile
    if (payload) {
        try {
            const request = JSON.parse(payload);
            if (request.userId) {
                targetUserId = request.userId;
            }
        } catch (e) {
            // ignore
        }
    }
    
    if (!targetUserId) {
        throw new Error("userId is required");
    }
    
    try {
        const users = nk.usersGetId([targetUserId]);
        
        if (!users || users.length === 0) {
            throw new Error("User not found");
        }
        
        const user = users[0];
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
        
        return JSON.stringify({
            userId: user.id,
            username: user.username,
            displayName: user.displayName || user.username,
            profilePicture: profilePicture,
            createTime: user.createTime,
            updateTime: user.updateTime
        });
        
    } catch (e) {
        logger.error(`[ProfileSync] Failed to get profile for ${targetUserId}: ${e.message}`);
        throw e;
    }
}

/**
 * RPC: Batch get user profiles with profile pictures
 * 
 * Useful for fetching profiles for multiple users at once
 * (e.g., for displaying in a friends list or leaderboard)
 * 
 * Payload: { "userIds": ["id1", "id2", ...] }
 * Response: { "profiles": { "id1": {...}, "id2": {...} } }
 */
function rpcBatchGetUserProfiles(context, logger, nk, payload) {
    let request = {};
    try {
        request = payload ? JSON.parse(payload) : {};
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }
    
    const userIds = request.userIds;
    
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        throw new Error("userIds array is required");
    }
    
    // Limit batch size to prevent abuse
    if (userIds.length > 100) {
        throw new Error("Maximum 100 user IDs per request");
    }
    
    const profiles = {};
    
    try {
        const users = nk.usersGetId(userIds);
        
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
                userId: user.id,
                username: user.username,
                displayName: user.displayName || user.username,
                profilePicture: profilePicture
            };
        }
        
    } catch (e) {
        logger.error(`[ProfileSync] Batch fetch failed: ${e.message}`);
    }
    
    // Fill in missing entries
    for (const userId of userIds) {
        if (!profiles[userId]) {
            profiles[userId] = {
                userId: userId,
                username: null,
                displayName: null,
                profilePicture: null
            };
        }
    }
    
    return JSON.stringify({
        profiles: profiles,
        fetchedCount: Object.keys(profiles).length
    });
}

/**
 * RPC: Get profile sync status
 * 
 * Check when the profile was last synced from UserManagement
 * 
 * Response: { "lastSyncedAt": ..., "profilePicture": "..." }
 */
function rpcGetProfileSyncStatus(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }
    
    const syncRecords = nk.storageRead([{
        collection: PROFILE_SYNC_COLLECTION,
        key: "last_sync",
        userId: userId
    }]);
    
    if (syncRecords && syncRecords.length > 0) {
        return JSON.stringify({
            synced: true,
            ...syncRecords[0].value
        });
    }
    
    return JSON.stringify({
        synced: false,
        lastSyncedAt: null,
        profilePicture: null
    });
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("👤 Profile Sync Module loading...");
    
    // Register RPC endpoints
    initializer.registerRpc("sync_profile_from_user_management", rpcSyncProfileFromUserManagement);
    initializer.registerRpc("update_profile_picture", rpcUpdateProfilePicture);
    initializer.registerRpc("get_user_profile", rpcGetUserProfile);
    initializer.registerRpc("batch_get_user_profiles", rpcBatchGetUserProfiles);
    initializer.registerRpc("get_profile_sync_status", rpcGetProfileSyncStatus);
    
    logger.info("✅ Profile Sync Module initialized!");
    logger.info(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                    👤 PROFILE SYNC MODULE                                 ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ RPCs Available:                                                           ║
║   • sync_profile_from_user_management - Sync from UserManagement API      ║
║   • update_profile_picture            - Direct URL update                 ║
║   • get_user_profile                  - Get profile with picture          ║
║   • batch_get_user_profiles           - Batch fetch profiles              ║
║   • get_profile_sync_status           - Check last sync time              ║
╠═══════════════════════════════════════════════════════════════════════════╣
║ Integration:                                                              ║
║   1. Call sync_profile_from_user_management after login                   ║
║   2. Call update_profile_picture after profile pic upload                 ║
║   3. Leaderboards will auto-include profilePicture field                  ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);
}

!InitModule.toString().includes("InitModule") || InitModule;
