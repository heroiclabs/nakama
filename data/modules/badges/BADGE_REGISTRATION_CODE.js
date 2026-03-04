// ============================================================================
// BADGE & COLLECTABLE SYSTEM REGISTRATION
// Add this section to your data/modules/index.js InitModule function
// ============================================================================

// === PASTE THIS CODE INTO InitModule() function in index.js ===

    // Register Badge System RPCs
    try {
        logger.info('[Badges] Initializing Badge & Collectable System...');
        
        // Badge RPCs
        initializer.registerRpc('badges_get_all', rpcBadgesGetAll);
        logger.info('[Badges] Registered RPC: badges_get_all');
        
        initializer.registerRpc('badges_update_progress', rpcBadgesUpdateProgress);
        logger.info('[Badges] Registered RPC: badges_update_progress');
        
        initializer.registerRpc('badges_check_event', rpcBadgesCheckEvent);
        logger.info('[Badges] Registered RPC: badges_check_event');
        
        initializer.registerRpc('badges_set_displayed', rpcBadgesSetDisplayed);
        logger.info('[Badges] Registered RPC: badges_set_displayed');
        
        initializer.registerRpc('badges_bulk_create', rpcBadgesBulkCreate);
        logger.info('[Badges] Registered RPC: badges_bulk_create (Admin)');
        
        // Collectable RPCs
        initializer.registerRpc('collectables_get_all', rpcCollectablesGetAll);
        logger.info('[Collectables] Registered RPC: collectables_get_all');
        
        initializer.registerRpc('collectables_grant', rpcCollectablesGrant);
        logger.info('[Collectables] Registered RPC: collectables_grant');
        
        initializer.registerRpc('collectables_equip', rpcCollectablesEquip);
        logger.info('[Collectables] Registered RPC: collectables_equip');
        
        initializer.registerRpc('collectables_bulk_create', rpcCollectablesBulkCreate);
        logger.info('[Collectables] Registered RPC: collectables_bulk_create (Admin)');
        
        logger.info('[Badges] Successfully registered 9 Badge & Collectable RPCs');
    } catch (err) {
        logger.error('[Badges] Failed to initialize: ' + err.message);
    }

// === END OF CODE TO PASTE ===


// ============================================================================
// IMPORTANT: ALSO ADD THE FUNCTION IMPORTS AT THE TOP OF index.js
// 
// Either:
// 1. Copy the badge functions from badges/badges.js into index.js, OR
// 2. Import them using require (if your Nakama setup supports it):
//
//    var badgeModule = require('./badges/badges.js');
//    var rpcBadgesGetAll = badgeModule.rpcBadgesGetAll;
//    var rpcBadgesUpdateProgress = badgeModule.rpcBadgesUpdateProgress;
//    var rpcBadgesCheckEvent = badgeModule.rpcBadgesCheckEvent;
//    var rpcBadgesSetDisplayed = badgeModule.rpcBadgesSetDisplayed;
//    var rpcBadgesBulkCreate = badgeModule.rpcBadgesBulkCreate;
//    var rpcCollectablesGetAll = badgeModule.rpcCollectablesGetAll;
//    var rpcCollectablesGrant = badgeModule.rpcCollectablesGrant;
//    var rpcCollectablesEquip = badgeModule.rpcCollectablesEquip;
//    var rpcCollectablesBulkCreate = badgeModule.rpcCollectablesBulkCreate;
// ============================================================================
