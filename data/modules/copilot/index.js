// copilot/index.js - Main entry point for copilot leaderboard modules

// Import all modules
var leaderboardSync = require("./leaderboard_sync");
var leaderboardAggregate = require("./leaderboard_aggregate");
var leaderboardFriends = require("./leaderboard_friends");
var socialFeatures = require("./social_features");

/**
 * Initialize copilot modules and register RPCs
 * This function is called from the parent InitModule
 */
function initializeCopilotModules(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('Initializing Copilot Leaderboard Modules');
    logger.info('========================================');

    // Register leaderboard_sync RPCs
    try {
        initializer.registerRpc('submit_score_sync', leaderboardSync.rpcSubmitScoreSync);
        logger.info('✓ Registered RPC: submit_score_sync');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_sync: ' + err.message);
    }

    // Register leaderboard_aggregate RPCs
    try {
        initializer.registerRpc('submit_score_with_aggregate', leaderboardAggregate.rpcSubmitScoreWithAggregate);
        logger.info('✓ Registered RPC: submit_score_with_aggregate');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_with_aggregate: ' + err.message);
    }

    // Register leaderboard_friends RPCs
    try {
        initializer.registerRpc('create_all_leaderboards_with_friends', leaderboardFriends.rpcCreateAllLeaderboardsWithFriends);
        logger.info('✓ Registered RPC: create_all_leaderboards_with_friends');
    } catch (err) {
        logger.error('✗ Failed to register create_all_leaderboards_with_friends: ' + err.message);
    }

    try {
        initializer.registerRpc('submit_score_with_friends_sync', leaderboardFriends.rpcSubmitScoreWithFriendsSync);
        logger.info('✓ Registered RPC: submit_score_with_friends_sync');
    } catch (err) {
        logger.error('✗ Failed to register submit_score_with_friends_sync: ' + err.message);
    }

    try {
        initializer.registerRpc('get_friend_leaderboard', leaderboardFriends.rpcGetFriendLeaderboard);
        logger.info('✓ Registered RPC: get_friend_leaderboard');
    } catch (err) {
        logger.error('✗ Failed to register get_friend_leaderboard: ' + err.message);
    }

    // Register social_features RPCs
    try {
        initializer.registerRpc('send_friend_invite', socialFeatures.rpcSendFriendInvite);
        logger.info('✓ Registered RPC: send_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register send_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('accept_friend_invite', socialFeatures.rpcAcceptFriendInvite);
        logger.info('✓ Registered RPC: accept_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register accept_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('decline_friend_invite', socialFeatures.rpcDeclineFriendInvite);
        logger.info('✓ Registered RPC: decline_friend_invite');
    } catch (err) {
        logger.error('✗ Failed to register decline_friend_invite: ' + err.message);
    }

    try {
        initializer.registerRpc('get_notifications', socialFeatures.rpcGetNotifications);
        logger.info('✓ Registered RPC: get_notifications');
    } catch (err) {
        logger.error('✗ Failed to register get_notifications: ' + err.message);
    }

    logger.info('========================================');
    logger.info('Copilot Leaderboard Modules Loaded Successfully');
    logger.info('========================================');
}

// Export the initialization function
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        initializeCopilotModules: initializeCopilotModules
    };
}
