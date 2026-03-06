/**
 * Tournament System for Multi-Game Platform
 * Supports scheduled tournaments with brackets and prizes
 * 
 * Collections:
 * - tournaments: Stores tournament definitions (system-owned)
 * - tournament_entries: Stores player registrations
 */

const TOURNAMENT_COLLECTION = "tournaments";
const TOURNAMENT_ENTRIES_COLLECTION = "tournament_entries";

/**
 * RPC: tournament_create (Admin only)
 * Create a new tournament
 */
var rpcTournamentCreate = function(ctx, logger, nk, payload) {
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
            format: data.format || "leaderboard",
            game_id: gameId
        };
        
        nk.leaderboardCreate(
            tournamentId,
            false,
            "desc",
            "reset",
            JSON.stringify(metadata)
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
};

/**
 * RPC: tournament_join
 * Join a tournament
 */
var rpcTournamentJoin = function(ctx, logger, nk, payload) {
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
};

/**
 * RPC: tournament_list_active
 * Get all active tournaments for a game
 */
var rpcTournamentListActive = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.game_id) {
            throw Error("game_id is required");
        }
        
        var gameId = data.game_id;
        
        // List all tournaments
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
};

/**
 * RPC: tournament_submit_score
 * Submit score to tournament
 */
var rpcTournamentSubmitScore = function(ctx, logger, nk, payload) {
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
};

/**
 * RPC: tournament_get_leaderboard
 * Get tournament leaderboard
 */
var rpcTournamentGetLeaderboard = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.tournament_id) {
            throw Error("tournament_id is required");
        }
        
        var tournamentId = data.tournament_id;
        var limit = data.limit || 100;
        
        // Get leaderboard records
        var leaderboard = nk.leaderboardRecordsList(tournamentId, null, limit);
        
        var records = [];
        
        if (leaderboard && leaderboard.records) {
            for (var i = 0; i < leaderboard.records.length; i++) {
                var record = leaderboard.records[i];
                records.push({
                    rank: record.rank,
                    user_id: record.ownerId,
                    username: record.username || "Player",
                    score: record.score,
                    metadata: record.metadata
                });
            }
        }
        
        return JSON.stringify({
            success: true,
            tournament_id: tournamentId,
            leaderboard: records,
            total_entries: records.length
        });
        
    } catch (err) {
        logger.error("[Tournament] Get leaderboard error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};

/**
 * RPC: tournament_claim_rewards (Called after tournament ends)
 * Distribute rewards to winners
 */
var rpcTournamentClaimRewards = function(ctx, logger, nk, payload) {
    try {
        var data = JSON.parse(payload || '{}');
        
        if (!data.tournament_id) {
            throw Error("tournament_id is required");
        }
        
        var userId = ctx.userId;
        var tournamentId = data.tournament_id;
        
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
        
        // Check if tournament has ended
        var now = new Date();
        var endTime = new Date(tournament.end_time);
        
        if (now < endTime) {
            throw Error("Tournament has not ended yet");
        }
        
        // Get user's rank
        var leaderboard = nk.leaderboardRecordsList(tournamentId, [userId], 1);
        
        if (!leaderboard || !leaderboard.records || leaderboard.records.length === 0) {
            throw Error("No tournament entry found for user");
        }
        
        var rank = leaderboard.records[0].rank;
        
        // Check if user has rewards
        var rewards = tournament.prize_pool[rank];
        
        if (!rewards) {
            return JSON.stringify({
                success: true,
                rank: rank,
                rewards: null,
                message: "No rewards for this rank"
            });
        }
        
        // Check if already claimed
        var claimKey = "claim_" + userId + "_" + tournamentId;
        
        try {
            var claimRecords = nk.storageRead([{
                collection: "tournament_claims",
                key: claimKey,
                userId: userId
            }]);
            
            if (claimRecords && claimRecords.length > 0 && claimRecords[0].value) {
                throw Error("Rewards already claimed");
            }
        } catch (err) {
            // Not claimed yet, continue
        }
        
        // Grant rewards
        if (rewards.coins && rewards.coins > 0) {
            var walletKey = "wallet_" + userId + "_" + tournament.game_id;
            var wallet = { balance: 0 };
            
            try {
                var walletRecords = nk.storageRead([{
                    collection: tournament.game_id + "_wallets",
                    key: walletKey,
                    userId: userId
                }]);
                
                if (walletRecords && walletRecords.length > 0 && walletRecords[0].value) {
                    wallet = walletRecords[0].value;
                }
            } catch (err) {
                logger.debug("[Tournament] Creating new wallet");
            }
            
            wallet.balance = (wallet.balance || 0) + rewards.coins;
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
        
        // Mark as claimed
        nk.storageWrite([{
            collection: "tournament_claims",
            key: claimKey,
            userId: userId,
            value: {
                tournament_id: tournamentId,
                rank: rank,
                rewards: rewards,
                claimed_at: new Date().toISOString()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info("[Tournament] Rewards claimed by user " + userId + " for rank " + rank);
        
        return JSON.stringify({
            success: true,
            rank: rank,
            rewards: rewards,
            message: "Rewards claimed successfully"
        });
        
    } catch (err) {
        logger.error("[Tournament] Claim rewards error: " + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
};
