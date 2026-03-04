/**
 * Matchmaking System for Multi-Game Platform
 * Supports skill-based matching, party queues, and game modes
 * 
 * Collections:
 * - matchmaking_tickets: Stores active matchmaking tickets
 * - matchmaking_history: Stores match history for analytics
 */

const MATCHMAKING_TICKETS_COLLECTION = "matchmaking_tickets";
const MATCHMAKING_HISTORY_COLLECTION = "matchmaking_history";

/**
 * RPC: matchmaking_find_match
 * Create matchmaking ticket and find match
 */
var rpcMatchmakingFindMatch = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id || !data.mode) {
            throw Error("game_id and mode are required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var mode = data.mode;
        var skillLevel = data.skill_level || 1000;
        var partyMembers = data.party_members || [];
        var properties = data.properties || {};
        
        logger.info("[Matchmaking] Finding match for user: " + userId + ", mode: " + mode);
        
        // Calculate skill range (widen over time in production)
        var minSkill = skillLevel - 100;
        var maxSkill = skillLevel + 100;
        
        // Party size
        var partySize = partyMembers.length + 1;
        
        // Create matchmaking query
        var query = "+properties.game_id:" + gameId + " +properties.mode:" + mode;
        
        // Add matchmaking ticket
        var ticket = nk.matchmakerAdd(
            query,
            minSkill,
            maxSkill,
            query,
            {
                skill: skillLevel,
                party_size: partySize
            },
            Object.assign({
                game_id: gameId,
                mode: mode,
                user_id: userId
            }, properties)
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
};

/**
 * RPC: matchmaking_cancel
 * Cancel matchmaking ticket
 */
var rpcMatchmakingCancel = function(ctx, logger, nk, payload) {
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
};

/**
 * RPC: matchmaking_get_status
 * Check matchmaking status
 */
var rpcMatchmakingGetStatus = function(ctx, logger, nk, payload) {
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
};

/**
 * RPC: matchmaking_create_party
 * Create a party for group matchmaking
 */
var rpcMatchmakingCreateParty = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var userId = ctx.userId;
        var gameId = data.game_id;
        var maxMembers = data.max_members || 4;
        
        // Create party (simplified - use Nakama parties in production)
        var partyId = "party_" + userId + "_" + Date.now();
        
        var party = {
            party_id: partyId,
            leader_id: userId,
            game_id: gameId,
            members: [userId],
            max_members: maxMembers,
            created_at: new Date().toISOString(),
            status: "open"
        };
        
        nk.storageWrite([{
            collection: "parties",
            key: partyId,
            userId: userId,
            value: party,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info("[Matchmaking] Party created: " + partyId);
        
        return JSON.stringify({
            success: true,
            party: party
        });
        
    } catch (err) {
        logger.error("[Matchmaking] Create party error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: matchmaking_join_party
 * Join an existing party
 */
var rpcMatchmakingJoinParty = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.party_id) {
            throw Error("party_id is required");
        }
        
        var userId = ctx.userId;
        var partyId = data.party_id;
        
        // Get party
        var records = nk.storageRead([{
            collection: "parties",
            key: partyId,
            userId: null
        }]);
        
        if (!records || records.length === 0 || !records[0].value) {
            throw Error("Party not found");
        }
        
        var party = records[0].value;
        
        // Check if party is full
        if (party.members.length >= party.max_members) {
            throw Error("Party is full");
        }
        
        // Check if already in party
        if (party.members.indexOf(userId) !== -1) {
            throw Error("Already in this party");
        }
        
        // Add member
        party.members.push(userId);
        
        nk.storageWrite([{
            collection: "parties",
            key: partyId,
            userId: party.leader_id,
            value: party,
            permissionRead: 2,
            permissionWrite: 0
        }]);
        
        logger.info("[Matchmaking] User " + userId + " joined party: " + partyId);
        
        return JSON.stringify({
            success: true,
            party: party
        });
        
    } catch (err) {
        logger.error("[Matchmaking] Join party error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};
