// groups.js - Groups/Clans/Guilds system for multi-game backend
// Provides comprehensive group management with roles, shared wallets, and group challenges

/**
 * Groups/Clans/Guilds System
 * 
 * Features:
 * - Create and manage groups with roles (Owner, Admin, Member)
 * - Group leaderboards and shared wallets
 * - Group XP and quest challenges
 * - Group chat channels (via Nakama built-in)
 * - Per-game group support
 */

// Group role hierarchy
var GROUP_ROLES = {
    OWNER: 0,      // Creator, full control
    ADMIN: 1,      // Can manage members, not delete group
    MEMBER: 2      // Regular member
};

// Group metadata structure
function createGroupMetadata(gameId, groupType, customData) {
    return {
        gameId: gameId,
        groupType: groupType || "guild",
        createdAt: new Date().toISOString(),
        level: 1,
        xp: 0,
        totalMembers: 1,
        customData: customData || {}
    };
}

/**
 * RPC: create_game_group
 * Create a group/clan/guild for a specific game
 */
function rpcCreateGameGroup(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        // Validate required fields
        if (!data.gameId || !data.name) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: gameId, name"
            });
        }

        var gameId = data.gameId;
        var name = data.name;
        var description = data.description || "";
        var avatarUrl = data.avatarUrl || "";
        var langTag = data.langTag || "en";
        var open = data.open !== undefined ? data.open : false;
        var maxCount = data.maxCount || 100;
        var groupType = data.groupType || "guild";

        // Create group metadata
        var metadata = createGroupMetadata(gameId, groupType, data.customData);

        // Create group using Nakama's built-in Groups API
        var group;
        try {
            group = nk.groupCreate(
                ctx.userId,
                name,
                description,
                avatarUrl,
                langTag,
                JSON.stringify(metadata),
                open,
                maxCount
            );
        } catch (err) {
            logger.error("[Groups] Failed to create group: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Failed to create group: " + err.message
            });
        }

        // Initialize group wallet
        try {
            var walletKey = "group_wallet_" + group.id;
            nk.storageWrite([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: {
                    groupId: group.id,
                    gameId: gameId,
                    currencies: {
                        tokens: 0,
                        xp: 0
                    },
                    createdAt: new Date().toISOString()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.warn("[Groups] Failed to create group wallet: " + err.message);
        }

        logger.info("[Groups] Created group: " + group.id + " for game: " + gameId);

        return JSON.stringify({
            success: true,
            group: {
                id: group.id,
                creatorId: group.creatorId,
                name: group.name,
                description: group.description,
                avatarUrl: group.avatarUrl,
                langTag: group.langTag,
                open: group.open,
                edgeCount: group.edgeCount,
                maxCount: group.maxCount,
                createTime: group.createTime,
                updateTime: group.updateTime,
                metadata: metadata
            },
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcCreateGameGroup: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: update_group_xp
 * Update group XP (for challenges/quests)
 */
function rpcUpdateGroupXP(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId || data.xp === undefined) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: groupId, xp"
            });
        }

        var groupId = data.groupId;
        var xpToAdd = parseInt(data.xp);

        // Get group to verify it exists and get metadata
        var groups;
        try {
            groups = nk.groupsGetId([groupId]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        if (!groups || groups.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        var group = groups[0];
        var metadata = JSON.parse(group.metadata || "{}");
        
        // Update XP
        metadata.xp = (metadata.xp || 0) + xpToAdd;
        
        // Calculate level (100 XP per level)
        var newLevel = Math.floor(metadata.xp / 100) + 1;
        var leveledUp = newLevel > (metadata.level || 1);
        metadata.level = newLevel;

        // Update group metadata
        try {
            nk.groupUpdate(
                groupId,
                ctx.userId,
                group.name,
                group.description,
                group.avatarUrl,
                group.langTag,
                JSON.stringify(metadata),
                group.open,
                group.maxCount
            );
        } catch (err) {
            logger.error("[Groups] Failed to update group: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Failed to update group XP"
            });
        }

        logger.info("[Groups] Updated group XP: " + groupId + " +" + xpToAdd + " XP");

        return JSON.stringify({
            success: true,
            groupId: groupId,
            xpAdded: xpToAdd,
            totalXP: metadata.xp,
            level: metadata.level,
            leveledUp: leveledUp,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcUpdateGroupXP: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: get_group_wallet
 * Get group's shared wallet
 */
function rpcGetGroupWallet(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId) {
            return JSON.stringify({
                success: false,
                error: "Missing required field: groupId"
            });
        }

        var groupId = data.groupId;
        var walletKey = "group_wallet_" + groupId;

        // Read wallet from storage
        var records;
        try {
            records = nk.storageRead([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to read group wallet"
            });
        }

        if (!records || records.length === 0) {
            // Initialize wallet if it doesn't exist
            var wallet = {
                groupId: groupId,
                gameId: data.gameId || "",
                currencies: {
                    tokens: 0,
                    xp: 0
                },
                createdAt: new Date().toISOString()
            };

            try {
                nk.storageWrite([{
                    collection: "group_wallets",
                    key: walletKey,
                    userId: "00000000-0000-0000-0000-000000000000",
                    value: wallet,
                    permissionRead: 1,
                    permissionWrite: 0
                }]);
            } catch (err) {
                logger.warn("[Groups] Failed to create group wallet: " + err.message);
            }

            return JSON.stringify({
                success: true,
                wallet: wallet,
                timestamp: new Date().toISOString()
            });
        }

        return JSON.stringify({
            success: true,
            wallet: records[0].value,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcGetGroupWallet: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: update_group_wallet
 * Update group's shared wallet (admins only)
 */
function rpcUpdateGroupWallet(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId || !data.currency || data.amount === undefined || !data.operation) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: groupId, currency, amount, operation"
            });
        }

        var groupId = data.groupId;
        var currency = data.currency;
        var amount = parseInt(data.amount);
        var operation = data.operation; // "add" or "subtract"

        // Verify user is admin of the group
        var userGroups;
        try {
            userGroups = nk.userGroupsList(ctx.userId);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to verify group membership"
            });
        }

        var isAdmin = false;
        if (userGroups && userGroups.userGroups) {
            for (var i = 0; i < userGroups.userGroups.length; i++) {
                var ug = userGroups.userGroups[i];
                if (ug.group.id === groupId && (ug.state <= GROUP_ROLES.ADMIN)) {
                    isAdmin = true;
                    break;
                }
            }
        }

        if (!isAdmin) {
            return JSON.stringify({
                success: false,
                error: "Only group admins can update group wallet"
            });
        }

        // Get current wallet
        var walletKey = "group_wallet_" + groupId;
        var records;
        try {
            records = nk.storageRead([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000"
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to read group wallet"
            });
        }

        if (!records || records.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Group wallet not found"
            });
        }

        var wallet = records[0].value;
        var currentBalance = wallet.currencies[currency] || 0;
        var newBalance;

        if (operation === "add") {
            newBalance = currentBalance + amount;
        } else if (operation === "subtract") {
            newBalance = currentBalance - amount;
            if (newBalance < 0) {
                return JSON.stringify({
                    success: false,
                    error: "Insufficient balance"
                });
            }
        } else {
            return JSON.stringify({
                success: false,
                error: "Invalid operation. Use 'add' or 'subtract'"
            });
        }

        wallet.currencies[currency] = newBalance;

        // Update wallet
        try {
            nk.storageWrite([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to update group wallet"
            });
        }

        logger.info("[Groups] Updated group wallet: " + groupId + " " + operation + " " + amount + " " + currency);

        return JSON.stringify({
            success: true,
            groupId: groupId,
            currency: currency,
            operation: operation,
            amount: amount,
            newBalance: newBalance,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcUpdateGroupWallet: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: get_user_groups
 * Get all groups for a user (filtered by gameId if provided)
 */
function rpcGetUserGroups(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        var gameId = data.gameId || null;

        // Get user groups
        var userGroups;
        try {
            userGroups = nk.userGroupsList(ctx.userId);
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Failed to retrieve user groups"
            });
        }

        var groups = [];
        if (userGroups && userGroups.userGroups) {
            for (var i = 0; i < userGroups.userGroups.length; i++) {
                var ug = userGroups.userGroups[i];
                var group = ug.group;
                var metadata = JSON.parse(group.metadata || "{}");

                // Filter by gameId if provided
                if (gameId && metadata.gameId !== gameId) {
                    continue;
                }

                groups.push({
                    id: group.id,
                    name: group.name,
                    description: group.description,
                    avatarUrl: group.avatarUrl,
                    langTag: group.langTag,
                    open: group.open,
                    edgeCount: group.edgeCount,
                    maxCount: group.maxCount,
                    createTime: group.createTime,
                    updateTime: group.updateTime,
                    metadata: metadata,
                    userRole: ug.state,
                    userRoleName: getRoleName(ug.state)
                });
            }
        }

        return JSON.stringify({
            success: true,
            userId: ctx.userId,
            gameId: gameId,
            groups: groups,
            count: groups.length,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcGetUserGroups: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

function getRoleName(state) {
    if (state === GROUP_ROLES.OWNER) return "Owner";
    if (state === GROUP_ROLES.ADMIN) return "Admin";
    if (state === GROUP_ROLES.MEMBER) return "Member";
    return "Unknown";
}

/**
 * RPC: get_group_details
 * Get comprehensive group details including members, stats, activity, and current user's role.
 * This provides all data needed for the Group Detail UI screen.
 */
function rpcGetGroupDetails(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId) {
            return JSON.stringify({
                success: false,
                error: "Missing required field: groupId"
            });
        }

        var groupId = data.groupId;
        var includeMembers = data.includeMembers !== false;
        var includeActivity = data.includeActivity !== false;
        var memberLimit = data.memberLimit || 50;
        var activityLimit = data.activityLimit || 20;

        // 1. Get group basic info
        var groups;
        try {
            groups = nk.groupsGetId([groupId]);
        } catch (err) {
            logger.error("[Groups] Failed to get group: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        if (!groups || groups.length === 0) {
            return JSON.stringify({
                success: false,
                error: "Group not found"
            });
        }

        var group = groups[0];
        var metadata = {};
        try {
            metadata = JSON.parse(group.metadata || "{}");
        } catch (_) {
            metadata = {};
        }

        // Calculate XP progress to next level (with edge case handling)
        var currentXP = Math.max(0, metadata.xp || 0);
        var currentLevel = Math.max(1, metadata.level || 1);
        var xpPerLevel = 100;
        var xpForCurrentLevel = (currentLevel - 1) * xpPerLevel;
        var xpIntoLevel = Math.max(0, currentXP - xpForCurrentLevel);
        // Prevent division by zero and clamp to valid range
        var progressPercent = xpPerLevel > 0 
            ? Math.min(100, Math.max(0, Math.floor((xpIntoLevel / xpPerLevel) * 100)))
            : 0;

        // 2. Check if current user is a member and get their role
        var userRole = null;
        var isMember = false;
        var isOwner = false;
        var isAdmin = false;
        var joinRequestPending = false;

        try {
            var userGroups = nk.userGroupsList(ctx.userId);
            if (userGroups && userGroups.userGroups) {
                for (var i = 0; i < userGroups.userGroups.length; i++) {
                    var ug = userGroups.userGroups[i];
                    if (ug.group && ug.group.id === groupId) {
                        userRole = ug.state;
                        // Nakama: 3 = join request pending (not a full member yet)
                        if (ug.state === 3) {
                            joinRequestPending = true;
                            isMember = false;
                        } else {
                            isMember = true;
                            isOwner = (ug.state === GROUP_ROLES.OWNER);
                            isAdmin = (ug.state === GROUP_ROLES.OWNER || ug.state === GROUP_ROLES.ADMIN);
                        }
                        break;
                    }
                }
            }
        } catch (err) {
            logger.warn("[Groups] Failed to check user membership: " + err.message);
        }

        // Non-members (and non-pending joiners) only receive a public summary.
        var canViewPrivateDetails = isMember || joinRequestPending;

        // 3. Get group members if requested
        var members = [];
        var memberCount = Math.max(0, group.edgeCount || 0);
        if (includeMembers && canViewPrivateDetails) {
            try {
                var groupMembers = nk.groupUsersList(groupId, memberLimit, null, "");
                if (groupMembers && groupMembers.groupUsers) {
                    for (var j = 0; j < groupMembers.groupUsers.length; j++) {
                        var gu = groupMembers.groupUsers[j];
                        if (!gu || !gu.user) continue;
                        
                        // Safe extraction with defaults
                        var userId = gu.user.id || "";
                        var username = gu.user.username || "user_" + j;
                        var displayName = gu.user.displayName || username;
                        var avatarUrl = gu.user.avatarUrl || "";
                        var role = typeof gu.state === "number" ? gu.state : GROUP_ROLES.MEMBER;
                        
                        members.push({
                            userId: userId,
                            username: username,
                            displayName: displayName,
                            avatarUrl: avatarUrl,
                            role: role,
                            roleName: getRoleName(role),
                            online: gu.user.online === true,
                            joinedAt: gu.user.createTime || null
                        });
                    }
                }
            } catch (err) {
                logger.warn("[Groups] Failed to list group members: " + err.message);
            }
        }

        // 4. Get group activity feed if requested
        var activity = [];
        if (includeActivity && canViewPrivateDetails) {
            try {
                var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
                var activityRecords = nk.storageList(SYSTEM_USER_ID, "group_activity", activityLimit, "");
                
                var allActivity = [];
                if (activityRecords && activityRecords.objects) {
                    allActivity = activityRecords.objects;
                } else if (activityRecords && Array.isArray(activityRecords)) {
                    allActivity = activityRecords;
                }
                
                for (var k = 0; k < allActivity.length; k++) {
                    var actRecord = allActivity[k];
                    if (!actRecord) continue;
                    
                    var act = actRecord.value || actRecord;
                    if (!act || act.group_id !== groupId) continue;
                    
                    // Safe extraction of activity fields
                    activity.push({
                        user_id: act.user_id || "",
                        action: act.action || "unknown",
                        details: act.details || {},
                        timestamp: act.timestamp || new Date().toISOString(),
                        group_id: act.group_id
                    });
                }
                
                // Sort by timestamp descending
                activity.sort(function(a, b) {
                    var tsA = a.timestamp || "";
                    var tsB = b.timestamp || "";
                    return tsB.localeCompare(tsA);
                });
                
                // Limit results
                if (activity.length > activityLimit) {
                    activity = activity.slice(0, activityLimit);
                }
            } catch (err) {
                logger.warn("[Groups] Failed to get group activity: " + err.message);
            }
        }

        // 5. Get group wallet balance (members only)
        var wallet = null;
        if (canViewPrivateDetails) try {
            var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
            var walletKey = "group_wallet_" + groupId;
            var walletRecords = nk.storageRead([{
                collection: "group_wallets",
                key: walletKey,
                userId: SYSTEM_USER_ID
            }]);
            
            if (walletRecords && walletRecords.length > 0) {
                wallet = walletRecords[0].value;
            }
        } catch (err) {
            logger.warn("[Groups] Failed to get group wallet: " + err.message);
        }

        // 6. Get group leaderboard rank (if leaderboard exists)
        var rank = null;
        var score = 0;
        try {
            var leaderboardId = "group_leaderboard";
            var records = nk.leaderboardRecordsList(leaderboardId, [groupId], 1, "", 0);
            if (records && records.ownerRecords && records.ownerRecords.length > 0) {
                rank = records.ownerRecords[0].rank;
                score = records.ownerRecords[0].score;
            }
        } catch (_) {
            // Leaderboard may not exist, that's okay
        }

        // 7. Get active group quests (members only)
        var activeQuests = [];
        if (canViewPrivateDetails) try {
            var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
            var questRecords = nk.storageList(SYSTEM_USER_ID, "group_quests", 50, "");
            
            var allQuests = [];
            if (questRecords && questRecords.objects) {
                allQuests = questRecords.objects;
            } else if (questRecords && questRecords.length) {
                allQuests = questRecords;
            }
            
            var now = new Date();
            for (var q = 0; q < allQuests.length; q++) {
                var quest = allQuests[q].value || allQuests[q];
                if (quest.group_id === groupId && quest.status === "active") {
                    // Check if expired
                    if (quest.expires_at && new Date(quest.expires_at) < now) {
                        continue;
                    }
                    activeQuests.push({
                        questId: quest.quest_id,
                        name: quest.quest_name,
                        targetType: quest.target_type,
                        targetValue: quest.target_value,
                        currentValue: quest.current_value,
                        progressPercent: Math.min(100, Math.floor((quest.current_value / quest.target_value) * 100)),
                        expiresAt: quest.expires_at,
                        status: quest.status
                    });
                }
            }
        } catch (err) {
            logger.warn("[Groups] Failed to get group quests: " + err.message);
        }

        logger.info("[Groups] Retrieved details for group: " + groupId);

        if (!canViewPrivateDetails) {
            return JSON.stringify({
                success: true,
                group: {
                    id: group.id,
                    name: group.name,
                    description: group.description || "",
                    avatarUrl: group.avatarUrl || "",
                    langTag: group.langTag || "en",
                    open: group.open,
                    memberCount: memberCount,
                    maxCount: group.maxCount
                },
                stats: {
                    level: currentLevel,
                    memberCount: memberCount
                },
                membership: {
                    isMember: false,
                    joinRequestPending: joinRequestPending,
                    userRole: userRole,
                    userRoleName: userRole !== null ? getRoleName(userRole) : null,
                    isOwner: false,
                    isAdmin: false
                },
                members: [],
                activity: [],
                wallet: null,
                quests: [],
                metadata: {},
                timestamp: new Date().toISOString()
            });
        }

        return JSON.stringify({
            success: true,
            group: {
                id: group.id,
                creatorId: group.creatorId,
                name: group.name,
                description: group.description || "",
                avatarUrl: group.avatarUrl || "",
                langTag: group.langTag || "en",
                open: group.open,
                memberCount: memberCount,
                maxCount: group.maxCount,
                createTime: group.createTime,
                updateTime: group.updateTime
            },
            stats: {
                level: currentLevel,
                xp: currentXP,
                xpToNextLevel: xpPerLevel,
                xpProgress: xpIntoLevel,
                progressPercent: progressPercent,
                rank: rank,
                score: score,
                trophies: metadata.trophies || 0
            },
            membership: {
                isMember: isMember,
                joinRequestPending: joinRequestPending,
                userRole: userRole,
                userRoleName: userRole !== null ? getRoleName(userRole) : null,
                isOwner: isOwner,
                isAdmin: isAdmin
            },
            members: members,
            activity: activity,
            wallet: wallet,
            quests: activeQuests,
            metadata: metadata,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcGetGroupDetails: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

/**
 * RPC: log_group_activity
 * Log an activity event for a group (member actions, achievements, etc.)
 */
function rpcLogGroupActivity(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({
                success: false,
                error: "Authentication required"
            });
        }

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            return JSON.stringify({
                success: false,
                error: "Invalid JSON payload"
            });
        }

        if (!data.groupId || !data.action) {
            return JSON.stringify({
                success: false,
                error: "Missing required fields: groupId, action"
            });
        }
        
        // Validate action string
        var action = String(data.action).trim();
        if (action.length === 0 || action.length > 100) {
            return JSON.stringify({
                success: false,
                error: "Invalid action: must be 1-100 characters"
            });
        }
        
        // Validate groupId format (UUID)
        var groupId = String(data.groupId).trim();
        if (groupId.length < 32) {
            return JSON.stringify({
                success: false,
                error: "Invalid groupId format"
            });
        }

        var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
        var activityId = generateActivityId();
        
        // Sanitize and validate xpEarned
        var xpEarned = parseInt(data.xpEarned, 10);
        if (isNaN(xpEarned) || xpEarned < 0) xpEarned = 0;
        if (xpEarned > 10000) xpEarned = 10000; // Cap to prevent abuse
        
        var activity = {
            id: activityId,
            group_id: groupId,
            user_id: ctx.userId,
            action: action,
            details: data.details || {},
            xp_earned: xpEarned,
            timestamp: new Date().toISOString()
        };

        try {
            nk.storageWrite([{
                collection: "group_activity",
                key: activityId,
                userId: SYSTEM_USER_ID,
                value: activity,
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            logger.error("[Groups] Failed to write activity: " + err.message);
            return JSON.stringify({
                success: false,
                error: "Failed to log activity"
            });
        }

        // If XP was earned, update group XP
        if (xpEarned > 0) {
            try {
                var groups = nk.groupsGetId([groupId]);
                if (groups && groups.length > 0) {
                    var group = groups[0];
                    var metadata = {};
                    try {
                        metadata = JSON.parse(group.metadata || "{}");
                    } catch (_) {
                        metadata = {};
                    }
                    
                    // Safe XP calculation
                    var currentXP = parseInt(metadata.xp, 10);
                    if (isNaN(currentXP) || currentXP < 0) currentXP = 0;
                    
                    metadata.xp = currentXP + xpEarned;
                    metadata.level = Math.floor(metadata.xp / 100) + 1;
                    
                    nk.groupUpdate(
                        groupId,
                        ctx.userId,
                        group.name,
                        group.description,
                        group.avatarUrl,
                        group.langTag,
                        JSON.stringify(metadata),
                        group.open,
                        group.maxCount
                    );
                }
            } catch (err) {
                logger.warn("[Groups] Failed to update group XP: " + err.message);
            }
        }

        logger.info("[Groups] Logged activity for group: " + data.groupId + " action: " + data.action);

        return JSON.stringify({
            success: true,
            activityId: activityId,
            timestamp: activity.timestamp
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcLogGroupActivity: " + err.message);
        return JSON.stringify({
            success: false,
            error: "An unexpected error occurred"
        });
    }
}

function generateActivityId() {
    var d = new Date().getTime();
    return 'act_xxxxxxxx'.replace(/[x]/g, function(c) {
        var r = Math.random() * 16 | 0;
        d = Math.floor(d / 16);
        return r.toString(16);
    }) + '_' + d.toString(36);
}

/**
 * InitModule — registers the two RPCs that have no legacy_runtime counterpart.
 * postbuild.js renames this to __ModuleInit_N and emits the calls verbatim
 * into its generated InitModule wrapper, so Nakama's AST walker sees them.
 */
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("get_group_details", rpcGetGroupDetails);
    initializer.registerRpc("log_group_activity", rpcLogGroupActivity);
}
