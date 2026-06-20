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

// ----------------------------------------------------------------------------
// QuizVerse group-creation economy
// ----------------------------------------------------------------------------
// Creating a group costs coins (the same single-currency "coins" wallet used by
// the rest of QuizVerse — see chatbox.js / badges.js). The charge MUST happen
// server-side: the Unity client previously called Nakama's built-in CreateGroup
// directly, which let a player create unlimited groups for free and never
// persisted the chosen badge or privacy policy. create_quizverse_group fixes
// all three.
var QV_GROUP_CURRENCY_KEY = "coins";
var QV_GROUP_CREATE_COST = 500;

// Privacy policies. Nakama groups only model open (true) vs closed (false), so
// "private" and "invite_only" both map to open=false and are distinguished by
// metadata.joinPolicy. The client UI offers three states.
var QV_GROUP_JOIN_POLICY = {
    OPEN: "open",                // anyone can join instantly (Nakama open=true)
    PRIVATE: "private",          // request to join, owner/admin approves (open=false)
    INVITE_ONLY: "invite_only"   // join only via explicit invite (open=false)
};

function qvNormalizeJoinPolicy(raw) {
    var p = (raw === undefined || raw === null) ? "" : String(raw).toLowerCase().trim();
    if (p === QV_GROUP_JOIN_POLICY.OPEN) return QV_GROUP_JOIN_POLICY.OPEN;
    if (p === QV_GROUP_JOIN_POLICY.PRIVATE) return QV_GROUP_JOIN_POLICY.PRIVATE;
    if (p === QV_GROUP_JOIN_POLICY.INVITE_ONLY) return QV_GROUP_JOIN_POLICY.INVITE_ONLY;
    // Back-compat: accept a raw boolean `open` style value.
    if (p === "true") return QV_GROUP_JOIN_POLICY.OPEN;
    if (p === "false") return QV_GROUP_JOIN_POLICY.PRIVATE;
    return QV_GROUP_JOIN_POLICY.OPEN; // default: open
}

function qvGetCoinBalance(nk, userId) {
    try {
        var account = nk.accountGetId(userId);
        if (account && account.wallet) {
            // account.wallet may be a JSON string or an object depending on the
            // Nakama runtime version — handle both.
            var w = typeof account.wallet === "string" ? JSON.parse(account.wallet) : account.wallet;
            var bal = parseInt(w[QV_GROUP_CURRENCY_KEY], 10);
            return isNaN(bal) ? 0 : bal;
        }
    } catch (e) { /* treat as zero balance */ }
    return 0;
}

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
                ctx.userId,     // 1. userId
                name,           // 2. name
                ctx.userId,     // 3. creatorId
                langTag,        // 4. lang
                description,    // 5. description
                avatarUrl,      // 6. avatarURL
                open,           // 7. open
                metadata,       // 8. metadata (pass directly as a plain JS object, not stringified)
                maxCount        // 9. maxCount
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
 * RPC: create_quizverse_group
 * Create a QuizVerse group/clan, charging the creator the group-creation coin
 * cost and persisting the chosen badge + privacy (join) policy in metadata.
 *
 * This replaces the client calling Nakama's built-in CreateGroup directly,
 * which (a) charged nothing, (b) dropped the selected badge, and (c) could only
 * express open vs closed — losing the invite-only state.
 *
 * Flow (charge is atomic + refunded on failure):
 *   1. Validate name / badge / privacy.
 *   2. Check coin balance >= QV_GROUP_CREATE_COST.
 *   3. Deduct coins (nk.walletUpdate throws if it would go negative).
 *   4. Create the group with metadata.joinPolicy + metadata.badge.
 *   5. On create failure AFTER a successful charge, refund the coins.
 *   6. Initialise the group's shared wallet.
 */
function rpcCreateQuizverseGroup(ctx, logger, nk, payload) {
    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: "Authentication required" });
        }

        logger.info("[socialzone-group] 🔍 QVBF_111/126 - CreateQuizverseGroup RPC called | userID=" + ctx.userId + " | payload=" + payload + " | timestamp=" + Date.now());

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            logger.error("[socialzone-group] ❌ QVBF_111/126 - Invalid JSON payload | userID=" + ctx.userId + " | error=" + err.message);
            return JSON.stringify({ success: false, error: "Invalid JSON payload" });
        }

        // --- Validate inputs -------------------------------------------------
        var name = (data.name === undefined || data.name === null) ? "" : String(data.name).trim();
        if (name.length === 0) {
            logger.error("[socialzone-group] ❌ QVBF_111/126 - Missing group name | userID=" + ctx.userId);
            return JSON.stringify({ success: false, error: "Missing required field: name" });
        }
        if (name.length > 64) {
            logger.error("[socialzone-group] ❌ QVBF_111/126 - Group name too long | userID=" + ctx.userId + " | nameLength=" + name.length);
            return JSON.stringify({ success: false, error: "Group name too long (max 64 characters)" });
        }

        var gameId = data.gameId || "quizverse";
        var description = data.description ? String(data.description).substring(0, 512) : "";
        var avatarUrl = data.avatarUrl || "";
        var langTag = data.langTag || "en";
        var badge = data.badge ? String(data.badge).substring(0, 64) : "";
        var maxCount = parseInt(data.maxCount, 10);
        if (isNaN(maxCount) || maxCount <= 0) maxCount = 100;
        if (maxCount > 100) maxCount = 100;

        var joinPolicy = qvNormalizeJoinPolicy(data.privacy !== undefined ? data.privacy : data.joinPolicy);
        // Nakama "open" means anyone joins instantly. Only the OPEN policy maps
        // to that; private & invite-only are closed groups gated by metadata.
        var nakamaOpen = (joinPolicy === QV_GROUP_JOIN_POLICY.OPEN);

        logger.debug("[socialzone-group] 📋 QVBF_111/126 - Parsed request | userID=" + ctx.userId + " | name=" + name + " | badge=" + badge + " | maxMembers=" + maxCount + " | joinPolicy=" + joinPolicy + " | nakamaOpen=" + nakamaOpen);

        // --- Charge coins (balance check + atomic deduct) --------------------
        var balanceBefore = qvGetCoinBalanceFromStorage(nk, ctx.userId, gameId);
        if (balanceBefore < QV_GROUP_CREATE_COST) {
            return JSON.stringify({
                success: false,
                error: "insufficient_coins",
                required: QV_GROUP_CREATE_COST,
                balance: balanceBefore
            });
        }

        var charged = qvDeductCoinBalanceFromStorage(nk, ctx.userId, gameId, QV_GROUP_CREATE_COST);
        if (!charged) {
            logger.warn("[Groups] Coin charge failed for group create by " + ctx.userId);
            return JSON.stringify({
                success: false,
                error: "insufficient_coins",
                required: QV_GROUP_CREATE_COST,
                balance: qvGetCoinBalanceFromStorage(nk, ctx.userId, gameId)
            });
        }

        // --- Build metadata + create the group -------------------------------
        var metadata = createGroupMetadata(gameId, data.groupType || "guild", data.customData);
        metadata.badge = badge;
        metadata.joinPolicy = joinPolicy;

        var group;
        try {
            group = nk.groupCreate(
                ctx.userId,     // 1. userId
                name,           // 2. name
                ctx.userId,     // 3. creatorId (associated superadmin)
                langTag,        // 4. lang
                description,    // 5. description
                avatarUrl,      // 6. avatarURL
                nakamaOpen,     // 7. open
                metadata,       // 8. metadata (pass directly as a plain JS object, not stringified)
                maxCount        // 9. maxCount
            );
        } catch (err) {
            // Refund the coins we already deducted — the player must not be
            // charged for a group that was never created.
            if (charged) {
                try {
                    qvRefundCoinBalanceFromStorage(nk, ctx.userId, gameId, QV_GROUP_CREATE_COST);
                } catch (refundErr) {
                    logger.error("[Groups] CRITICAL: failed to refund " + QV_GROUP_CREATE_COST +
                        " coins to " + ctx.userId + " after group create failure: " +
                        (refundErr && refundErr.message ? refundErr.message : String(refundErr)));
                }
            }
            logger.error("[Groups] Failed to create group: " + (err && err.message ? err.message : String(err)));
            return JSON.stringify({
                success: false,
                error: "Failed to create group: " + (err && err.message ? err.message : String(err))
            });
        }

        // --- Initialise the group's shared wallet ----------------------------
        try {
            var walletKey = "group_wallet_" + group.id;
            nk.storageWrite([{
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: {
                    groupId: group.id,
                    gameId: gameId,
                    currencies: { tokens: 0, xp: 0 },
                    createdAt: new Date().toISOString()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        } catch (err) {
            // Non-fatal: wallet is lazily created on first read too.
            logger.warn("[Groups] Failed to create group wallet: " + err.message);
        }

        var balanceAfter = qvGetCoinBalanceFromStorage(nk, ctx.userId, gameId);
        logger.info("[Groups] Created QuizVerse group " + group.id + " for " + ctx.userId +
            " (cost " + QV_GROUP_CREATE_COST + ", policy " + joinPolicy + ")");

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
                metadata: metadata,
                badge: badge,
                joinPolicy: joinPolicy
            },
            coinsSpent: QV_GROUP_CREATE_COST,
            walletBalance: balanceAfter,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[Groups] Unexpected error in rpcCreateQuizverseGroup: " +
            (err && err.message ? err.message : String(err)));
        return JSON.stringify({ success: false, error: "An unexpected error occurred" });
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
        var walletVersion = records[0].version || "";
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

        // Update wallet with optimistic concurrency control: pass the version we
        // read so a concurrent wallet update (two admins, or a quest payout
        // racing a manual edit) cannot silently clobber each other. If the
        // version no longer matches, the write throws and we report a retryable
        // conflict instead of losing currency.
        try {
            var walletWrite = {
                collection: "group_wallets",
                key: walletKey,
                userId: "00000000-0000-0000-0000-000000000000",
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            };
            if (walletVersion) walletWrite.version = walletVersion;
            nk.storageWrite([walletWrite]);
        } catch (err) {
            logger.warn("[Groups] Group wallet write conflict for " + groupId + ": " +
                (err && err.message ? err.message : String(err)));
            return JSON.stringify({
                success: false,
                error: "Wallet update conflict, please retry",
                retryable: true
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

        logger.info("[socialzone-group] 🔍 QVBF_111/126 - GetUserGroups RPC called | userID=" + ctx.userId + " | payload=" + payload + " | timestamp=" + Date.now());

        var data;
        try {
            data = JSON.parse(payload || "{}");
        } catch (err) {
            logger.error("[socialzone-group] ❌ QVBF_111/126 - GetUserGroups invalid JSON | userID=" + ctx.userId + " | error=" + err.message);
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
            logger.info("[socialzone-group] 📡 QVBF_111/126 - userGroupsList returned | userID=" + ctx.userId + " | rawCount=" + (userGroups && userGroups.userGroups ? userGroups.userGroups.length : 0));
        } catch (err) {
            logger.error("[socialzone-group] ❌ QVBF_111/126 - userGroupsList failed | userID=" + ctx.userId + " | error=" + err.message);
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
                    logger.debug("[socialzone-group] 🔍 QVBF_111/126 - Filtering out group (wrong gameId) | groupID=" + group.id + " | groupGameId=" + metadata.gameId + " | filterGameId=" + gameId);
                    continue;
                }

                logger.debug("[socialzone-group] 📋 QVBF_111/126 - Group[" + i + "] | groupID=" + group.id + " | name=" + group.name + " | state=" + ug.state + " | edgeCount=" + group.edgeCount);

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

        logger.info("[socialzone-group] ✅ QVBF_111/126 - GetUserGroups returning | userID=" + ctx.userId + " | count=" + groups.length + " | gameIdFilter=" + gameId + " | timestamp=" + Date.now());

        return JSON.stringify({
            success: true,
            userId: ctx.userId,
            gameId: gameId,
            groups: groups,
            count: groups.length,
            timestamp: new Date().toISOString()
        });

    } catch (err) {
        logger.error("[socialzone-group] ❌ QVBF_111/126 - Unexpected error in rpcGetUserGroups | userID=" + ctx.userId + " | error=" + err.message);
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

// ----------------------------------------------------------------------------
// Membership / authorization helpers
// ----------------------------------------------------------------------------

/**
 * Resolve the acting user's role in a group from the server side.
 *
 * Returns an object: { isMember, role, isAdmin, isOwner, joinRequestPending }.
 * `role` is the Nakama group edge state (0 owner / 1 admin / 2 member / 3 join
 * request) or null when the user has no edge to the group at all.
 *
 * A pending join request (state 3) is NOT treated as membership.
 *
 * Never throws — on any lookup failure it returns the "not a member" shape so
 * callers fail closed (deny) rather than open.
 */
function getUserGroupRole(nk, logger, userId, groupId) {
    var result = {
        isMember: false,
        role: null,
        isAdmin: false,
        isOwner: false,
        joinRequestPending: false
    };
    if (!userId || !groupId) return result;

    try {
        var userGroups = nk.userGroupsList(userId);
        if (userGroups && userGroups.userGroups) {
            for (var i = 0; i < userGroups.userGroups.length; i++) {
                var ug = userGroups.userGroups[i];
                if (ug && ug.group && ug.group.id === groupId) {
                    result.role = ug.state;
                    if (ug.state === 3) {
                        result.joinRequestPending = true;
                    } else {
                        result.isMember = true;
                        result.isOwner = (ug.state === GROUP_ROLES.OWNER);
                        result.isAdmin = (ug.state === GROUP_ROLES.OWNER || ug.state === GROUP_ROLES.ADMIN);
                    }
                    break;
                }
            }
        }
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn("[Groups] getUserGroupRole failed for " + userId + "/" + groupId +
                ": " + (err && err.message ? err.message : String(err)));
        }
    }
    return result;
}

/**
 * Per-group activity collection name. Storing each group's activity in its own
 * collection means rpcGetGroupDetails reads only THAT group's records
 * (storageList scoped to the collection) instead of scanning every group's
 * activity globally and filtering in memory — the previous O(all groups)
 * behaviour that could push a busy group's recent rows past the scan limit.
 */
function groupActivityCollection(groupId) {
    return "group_activity_" + groupId;
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
                    // First pass: collect raw member rows so we can batch a single
                    // usersGetId for their player metadata (real level) instead of
                    // one account read per member.
                    var rawMembers = [];
                    var memberIds = [];
                    for (var j = 0; j < groupMembers.groupUsers.length; j++) {
                        var gu = groupMembers.groupUsers[j];
                        if (!gu || !gu.user) continue;

                        var rawId = gu.user.id || "";
                        rawMembers.push({
                            userId: rawId,
                            username: gu.user.username || ("user_" + j),
                            displayName: gu.user.displayName || gu.user.username || ("user_" + j),
                            avatarUrl: gu.user.avatarUrl || "",
                            role: typeof gu.state === "number" ? gu.state : GROUP_ROLES.MEMBER,
                            online: gu.user.online === true,
                            joinedAt: gu.user.createTime || null,
                            metadata: gu.user.metadata || null
                        });
                        if (rawId) memberIds.push(rawId);
                    }

                    // Batch-resolve player level from account metadata. groupUsersList
                    // sometimes omits metadata, so a single usersGetId fills the gap.
                    // Level is the only real per-player stat QuizVerse tracks; wins /
                    // trophies do not exist per player, so they are intentionally
                    // NOT returned (the client renders a level-only chip).
                    var levelById = {};
                    if (memberIds.length > 0) {
                        try {
                            var memberUsers = nk.usersGetId(memberIds);
                            if (memberUsers) {
                                for (var mu = 0; mu < memberUsers.length; mu++) {
                                    var u = memberUsers[mu];
                                    if (!u || !u.userId) continue;
                                    var lvl = 1;
                                    try {
                                        var md = u.metadata
                                            ? (typeof u.metadata === "string" ? JSON.parse(u.metadata) : u.metadata)
                                            : {};
                                        lvl = Math.max(1, parseInt(md.level, 10) || 1);
                                    } catch (_) { lvl = 1; }
                                    levelById[u.userId] = lvl;
                                }
                            }
                        } catch (err) {
                            logger.warn("[Groups] usersGetId for member levels failed: " + err.message);
                        }
                    }

                    for (var r = 0; r < rawMembers.length; r++) {
                        var rm = rawMembers[r];
                        var memberLevel = levelById[rm.userId];
                        if (memberLevel === undefined) {
                            // Fall back to inline metadata from groupUsersList if present.
                            memberLevel = 1;
                            try {
                                var inlineMd = rm.metadata
                                    ? (typeof rm.metadata === "string" ? JSON.parse(rm.metadata) : rm.metadata)
                                    : {};
                                memberLevel = Math.max(1, parseInt(inlineMd.level, 10) || 1);
                            } catch (_) { memberLevel = 1; }
                        }

                        members.push({
                            userId: rm.userId,
                            username: rm.username,
                            displayName: rm.displayName,
                            avatarUrl: rm.avatarUrl,
                            role: rm.role,
                            roleName: getRoleName(rm.role),
                            online: rm.online,
                            joinedAt: rm.joinedAt,
                            level: memberLevel
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

                // Primary: read ONLY this group's activity collection (scoped —
                // no global scan across every group's records).
                var allActivity = [];
                try {
                    var scopedRecords = nk.storageList(SYSTEM_USER_ID, groupActivityCollection(groupId), activityLimit, "");
                    if (scopedRecords && scopedRecords.objects) {
                        allActivity = scopedRecords.objects;
                    } else if (scopedRecords && Array.isArray(scopedRecords)) {
                        allActivity = scopedRecords;
                    }
                } catch (scopeErr) {
                    logger.warn("[Groups] Scoped activity read failed: " + scopeErr.message);
                }

                // Backward-compat: if the per-group collection is empty (e.g. only
                // legacy records written before the per-group split exist), fall
                // back to the old global collection and filter by group_id.
                if (allActivity.length === 0) {
                    try {
                        var legacyRecords = nk.storageList(SYSTEM_USER_ID, "group_activity", activityLimit, "");
                        var legacyAll = [];
                        if (legacyRecords && legacyRecords.objects) {
                            legacyAll = legacyRecords.objects;
                        } else if (legacyRecords && Array.isArray(legacyRecords)) {
                            legacyAll = legacyRecords;
                        }
                        for (var lg = 0; lg < legacyAll.length; lg++) {
                            var lgVal = legacyAll[lg] && (legacyAll[lg].value || legacyAll[lg]);
                            if (lgVal && lgVal.group_id === groupId) {
                                allActivity.push(legacyAll[lg]);
                            }
                        }
                    } catch (legacyErr) {
                        logger.warn("[Groups] Legacy activity read failed: " + legacyErr.message);
                    }
                }

                for (var k = 0; k < allActivity.length; k++) {
                    var actRecord = allActivity[k];
                    if (!actRecord) continue;

                    var act = actRecord.value || actRecord;
                    // Defensive: per-group collection should only contain this
                    // group's rows, but guard anyway.
                    if (!act || (act.group_id && act.group_id !== groupId)) continue;

                    activity.push({
                        user_id: act.user_id || "",
                        action: act.action || "unknown",
                        details: act.details || {},
                        timestamp: act.timestamp || new Date().toISOString(),
                        group_id: act.group_id || groupId
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

        // AUTHORIZATION: only members of the group may log activity for it.
        // Without this check any authenticated user could spam another group's
        // activity feed and (via the XP path below) inflate its level/XP using
        // the system-context groupUpdate. Fail closed.
        var actorRole = getUserGroupRole(nk, logger, ctx.userId, groupId);
        if (!actorRole.isMember) {
            return JSON.stringify({
                success: false,
                error: "Only group members can log activity"
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
                collection: groupActivityCollection(groupId),
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

// ============================================================================
// Group membership cross-device sync notifications
// ----------------------------------------------------------------------------
// Nakama's built-in JoinGroup / LeaveGroup RPCs change membership on the server
// but only the *device that performed the action* finds out (the Unity client
// fires GroupsNakamaService.OnGroupJoined/OnGroupLeft locally). A second device
// signed into the SAME account never learns its "My Groups" list changed until
// the next manual refresh / OnEnable.
//
// To close that gap we register registerAfterJoinGroup / registerAfterLeaveGroup
// hooks (see src/main.ts) that send the acting user a *self-notification*. Every
// socket the user has open — including their other devices — receives it in
// real time via the standard notification stream, and the client refreshes its
// group list.
//
// Numeric code range for group notifications: 500-599 (friends own 1-499,
// satori live events 1001, hermes 1101, push default 7001 — all avoided).
// ============================================================================

var GROUP_NOTIF_CODE = {
    GROUP_JOINED: 500, // user (this account) joined a group — refresh My Groups
    GROUP_LEFT:   501  // user (this account) left a group — refresh My Groups
};

var GROUP_NOTIF_SUBJECT = {
    GROUP_JOINED: 'group_joined',
    GROUP_LEFT:   'group_left'
};

var GROUP_NOTIF_TITLE = {
    GROUP_JOINED: 'Group Joined',
    GROUP_LEFT:   'Group Left'
};

/**
 * Send a single group membership sync notification to a user.
 * Self-targeted (sender === recipient) so it fans out to all of that user's
 * open sockets / devices. Non-persistent: this is a live sync signal, not an
 * inbox item, so it must never accumulate in the notification list.
 *
 * Never throws — a notification failure must not roll back the membership
 * change that already succeeded on the server.
 *
 * @param {nkruntime.Nakama} nk
 * @param {nkruntime.Logger} logger
 * @param {string} subjectKey  one of GROUP_NOTIF_SUBJECT keys ("GROUP_JOINED" | "GROUP_LEFT")
 * @param {string} userId      recipient (== acting user)
 * @param {string} groupId
 * @param {object} extra        optional extra fields merged into content
 */
function sendGroupSyncNotification(nk, logger, subjectKey, userId, groupId, extra) {
    try {
        logger.info("[socialzone-group] 📡 QVBF_111/126 - sendGroupSyncNotification called | subjectKey=" + subjectKey + " | userID=" + userId + " | groupID=" + groupId);
        
        if (!GROUP_NOTIF_SUBJECT.hasOwnProperty(subjectKey)) {
            logger.warn("[socialzone-group] ⚠️ QVBF_111/126 - Invalid subject key | subjectKey=" + subjectKey);
            return false;
        }
        if (!userId || !groupId) {
            logger.warn("[socialzone-group] ⚠️ QVBF_111/126 - Missing userId or groupId | userID=" + userId + " | groupID=" + groupId);
            return false;
        }

        var subject = GROUP_NOTIF_SUBJECT[subjectKey];
        var code    = GROUP_NOTIF_CODE[subjectKey];
        var title   = GROUP_NOTIF_TITLE[subjectKey];

        var content = {
            type:    subject,
            title:   title,
            code:    code,
            groupId: groupId
        };
        if (extra) {
            for (var k in extra) {
                if (Object.prototype.hasOwnProperty.call(extra, k)) {
                    content[k] = extra[k];
                }
            }
        }

        logger.debug("[socialzone-group] 📋 QVBF_111/126 - Notification content | code=" + code + " | subject=" + subject + " | title=" + title);

        nk.notificationsSend([{
            userId:     userId,
            subject:    subject,
            content:    content,
            code:       code,
            // Self-notification: the recipient IS the sender. Fans out to every
            // socket the account has open (their other devices).
            sender:     userId,
            // Non-persistent: pure live-sync signal, not an inbox row.
            persistent: false
        }]);

        logger.info("[socialzone-group] ✅ QVBF_111/126 - Notification sent successfully | code=" + code + " | userID=" + userId + " | groupID=" + groupId);
        return true;
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[socialzone-group] ❌ QVBF_111/126 - sendGroupSyncNotification failed | subjectKey=' + subjectKey + ' | userID=' +
                userId + ' | groupID=' + groupId + ' | error=' + (err && err.message ? err.message : String(err)));
        }
        return false;
    }
}

// ----------------------------------------------------------------------------
// Custom Storage Wallet Helpers (QuizVerse Economy Sync)
// ----------------------------------------------------------------------------
function qvResolveGameId(gameId) {
    if (gameId === "quizverse" || gameId === "QuizVerse" || gameId === "quiz-verse") {
        return "126bf539-dae2-4bcf-964d-316c0fa1f92b";
    }
    return gameId;
}

function qvGetCoinBalanceFromStorage(nk, userId, gameId) {
    var resolvedGameId = qvResolveGameId(gameId);
    var key = "wallet_" + userId + "_" + resolvedGameId;
    try {
        var records = nk.storageRead([{
            collection: "wallets",
            key: key,
            userId: userId
        }]);
        if (records && records.length > 0 && records[0].value) {
            var wallet = records[0].value;
            var bal = parseInt(wallet.currencies.game || wallet.currencies.tokens, 10);
            return isNaN(bal) ? 0 : bal;
        }
    } catch (e) { /* treat as zero balance */ }
    return 0;
}

function qvDeductCoinBalanceFromStorage(nk, userId, gameId, amount) {
    var resolvedGameId = qvResolveGameId(gameId);
    var key = "wallet_" + userId + "_" + resolvedGameId;
    try {
        var records = nk.storageRead([{
            collection: "wallets",
            key: key,
            userId: userId
        }]);
        
        var wallet;
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        } else {
            // Auto-create wallet structure if missing
            wallet = {
                userId: userId,
                gameId: resolvedGameId,
                currencies: { game: 0, tokens: 0, xp: 0 },
                createdAt: new Date().toISOString()
            };
        }
        
        var current = parseInt(wallet.currencies.game || wallet.currencies.tokens || 0, 10);
        if (current < amount) {
            return false;
        }
        
        wallet.currencies.game = current - amount;
        wallet.currencies.tokens = wallet.currencies.game;
        wallet.updatedAt = new Date().toISOString();
        
        nk.storageWrite([{
            collection: "wallets",
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) {
        return false;
    }
}

function qvRefundCoinBalanceFromStorage(nk, userId, gameId, amount) {
    var resolvedGameId = qvResolveGameId(gameId);
    var key = "wallet_" + userId + "_" + resolvedGameId;
    try {
        var records = nk.storageRead([{
            collection: "wallets",
            key: key,
            userId: userId
        }]);
        
        var wallet;
        if (records && records.length > 0 && records[0].value) {
            wallet = records[0].value;
        } else {
            wallet = {
                userId: userId,
                gameId: resolvedGameId,
                currencies: { game: 0, tokens: 0, xp: 0 },
                createdAt: new Date().toISOString()
            };
        }
        
        var current = parseInt(wallet.currencies.game || wallet.currencies.tokens || 0, 10);
        wallet.currencies.game = current + amount;
        wallet.currencies.tokens = wallet.currencies.game;
        wallet.updatedAt = new Date().toISOString();
        
        nk.storageWrite([{
            collection: "wallets",
            key: key,
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * After-hook for Nakama's built-in JoinGroup RPC.
 * Registered from src/main.ts via initializer.registerAfterJoinGroup(...).
 * Fires only after a successful join, so we can unconditionally notify.
 *
 * Signature matches nkruntime.AfterHookFunction<void, JoinGroupRequest>:
 *   (ctx, logger, nk, data, request)
 * `request.groupId` is the joined group; `ctx.userId` is the acting account.
 */
function groupAfterJoinHook(ctx, logger, nk, data, request) {
    try {
        var userId  = ctx && ctx.userId;
        var groupId = request && request.groupId;
        
        logger.info("[socialzone-group] ✅ QVBF_111/126 - User joined group | userID=" + userId + " | groupID=" + groupId + " | timestamp=" + Date.now());
        
        if (!userId || !groupId) {
            logger.warn("[socialzone-group] ⚠️ QVBF_111/126 - Join hook missing data | userID=" + userId + " | groupID=" + groupId);
            return;
        }

        // Get group info for context
        try {
            var groups = nk.groupsGetId([groupId]);
            if (groups && groups.length > 0) {
                var group = groups[0];
                logger.info("[socialzone-group] 📋 QVBF_111/126 - Group info after join | groupID=" + groupId + " | name=" + group.name + " | memberCount=" + group.edgeCount + " | maxCount=" + group.maxCount);
            }
        } catch (err) {
            logger.warn("[socialzone-group] ⚠️ QVBF_111/126 - Failed to get group info after join | groupID=" + groupId + " | error=" + err.message);
        }

        logger.info("[socialzone-group] 📡 QVBF_111/126 - Sending sync notification | userID=" + userId + " | groupID=" + groupId);
        sendGroupSyncNotification(nk, logger, 'GROUP_JOINED', userId, groupId);
        logger.info("[socialzone-group] ✅ QVBF_111/126 - Sync notification sent | userID=" + userId + " | groupID=" + groupId);
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[socialzone-group] ❌ QVBF_111/126 - groupAfterJoinHook failed | error=' +
                (err && err.message ? err.message : String(err)));
        }
    }
}

/**
 * After-hook for Nakama's built-in LeaveGroup RPC.
 * Registered from src/main.ts via initializer.registerAfterLeaveGroup(...).
 *
 * Signature matches nkruntime.AfterHookFunction<void, LeaveGroupRequest>.
 */
function groupAfterLeaveHook(ctx, logger, nk, data, request) {
    try {
        var userId  = ctx && ctx.userId;
        var groupId = request && request.groupId;
        
        logger.info("[socialzone-group] ✅ QVBF_111/126 - User left group | userID=" + userId + " | groupID=" + groupId + " | timestamp=" + Date.now());
        
        if (!userId || !groupId) {
            logger.warn("[socialzone-group] ⚠️ QVBF_111/126 - Leave hook missing data | userID=" + userId + " | groupID=" + groupId);
            return;
        }
        
        logger.info("[socialzone-group] 📡 QVBF_111/126 - Sending leave sync notification | userID=" + userId + " | groupID=" + groupId);
        sendGroupSyncNotification(nk, logger, 'GROUP_LEFT', userId, groupId);
        logger.info("[socialzone-group] ✅ QVBF_111/126 - Leave sync notification sent | userID=" + userId + " | groupID=" + groupId);
    } catch (err) {
        if (logger && logger.warn) {
            logger.warn('[socialzone-group] ❌ QVBF_111/126 - groupAfterLeaveHook failed | error=' +
                (err && err.message ? err.message : String(err)));
        }
    }
}

/**
 * InitModule — registers the two RPCs that have no legacy_runtime counterpart.
 * postbuild.js renames this to __ModuleInit_N and emits the calls verbatim
 * into its generated InitModule wrapper, so Nakama's AST walker sees them.
 *
 * NOTE: the registerAfterJoinGroup / registerAfterLeaveGroup hooks for the
 * membership sync notifications are NOT registered here — postbuild renames
 * this function to __ModuleInit_N and never calls it, and its AST bridge only
 * forwards registerRpc / registerMatch calls. The hooks are therefore wired up
 * in src/main.ts (the TS __OriginalInitModule, which IS executed) pointing at
 * the global groupAfterJoinHook / groupAfterLeaveHook functions above.
 */
function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("get_group_details", rpcGetGroupDetails);
    initializer.registerRpc("log_group_activity", rpcLogGroupActivity);
    initializer.registerRpc("create_quizverse_group", rpcCreateQuizverseGroup);
}
