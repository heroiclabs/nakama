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

// Export functions (ES Module syntax)
export {
    rpcCreateGameGroup,
    rpcUpdateGroupXP,
    rpcGetGroupWallet,
    rpcUpdateGroupWallet,
    rpcGetUserGroups,
    GROUP_ROLES
};
