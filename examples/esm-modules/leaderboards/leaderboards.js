// leaderboards/leaderboards.js - Leaderboard system with ESM exports
// ✅ This is the CORRECT ESM version

// Import utilities
import { validateScore, calculateRewards } from '../utils/helper.js';
import { LEADERBOARD_COLLECTION } from '../utils/constants.js';

/**
 * RPC: Submit score to leaderboard
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { score: number, gameId: string }
 * @returns {string} JSON response
 */
export function rpcLeaderboardSubmit(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const username = ctx.username;
    
    logger.info('[Leaderboards] Submit score request from user: ' + userId);
    
    try {
        // Parse input
        const data = JSON.parse(payload);
        const score = data.score;
        const gameId = data.gameId;
        
        // Validate required fields
        if (!gameId) {
            return JSON.stringify({
                success: false,
                error: 'gameId is required'
            });
        }
        
        if (score === undefined || score === null) {
            return JSON.stringify({
                success: false,
                error: 'score is required'
            });
        }
        
        // Validate score range
        if (!validateScore(score)) {
            return JSON.stringify({
                success: false,
                error: 'Invalid score value (must be 0-1000000)'
            });
        }
        
        const leaderboardId = 'leaderboard_' + gameId;
        
        logger.info('[Leaderboards] Submitting score ' + score + ' to leaderboard: ' + leaderboardId);
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            username || null,
            score,
            0, // subscore
            {
                timestamp: new Date().toISOString(),
                gameId: gameId
            }
        );
        
        // Calculate rewards
        const rewards = calculateRewards(score);
        
        logger.info('[Leaderboards] Score submitted successfully. Rewards: XP=' + rewards.xp + ', XUT=' + rewards.xut);
        
        return JSON.stringify({
            success: true,
            score: score,
            leaderboardId: leaderboardId,
            rewards: rewards
        });
    } catch (err) {
        logger.error('[Leaderboards] Failed to submit score: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

/**
 * RPC: Get leaderboard records
 * 
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON: { gameId: string, limit?: number }
 * @returns {string} JSON response
 */
export function rpcGetLeaderboard(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    logger.info('[Leaderboards] Get leaderboard request from user: ' + userId);
    
    try {
        // Parse input
        const data = JSON.parse(payload);
        const gameId = data.gameId;
        const limit = data.limit || 10;
        
        // Validate required fields
        if (!gameId) {
            return JSON.stringify({
                success: false,
                error: 'gameId is required'
            });
        }
        
        const leaderboardId = 'leaderboard_' + gameId;
        
        logger.info('[Leaderboards] Fetching top ' + limit + ' records from: ' + leaderboardId);
        
        // Get top records
        const records = nk.leaderboardRecordsList(
            leaderboardId,
            null, // ownerIds (null = all users)
            limit,
            null, // cursor
            null  // overrideExpiry
        );
        
        // Format response
        const formattedRecords = records.records.map(function(record, index) {
            return {
                rank: index + 1,
                userId: record.ownerId,
                username: record.username || 'Anonymous',
                score: record.score,
                subscore: record.subscore,
                metadata: record.metadata
            };
        });
        
        logger.info('[Leaderboards] Retrieved ' + formattedRecords.length + ' records');
        
        return JSON.stringify({
            success: true,
            leaderboardId: leaderboardId,
            records: formattedRecords,
            totalRecords: formattedRecords.length
        });
    } catch (err) {
        logger.error('[Leaderboards] Failed to get leaderboard: ' + err.message);
        return JSON.stringify({
            success: false,
            error: err.message
        });
    }
}

// Note: This file demonstrates exporting multiple RPC functions
// from a single module using ES module syntax.
// 
// Key points:
// 1. ✅ Each RPC function is exported individually
// 2. ✅ Import shared utilities from other modules
// 3. ✅ Include .js extension in all import paths
// 4. ✅ Use arrow functions or regular functions (both work)
// 5. ✅ Comprehensive error handling and validation
