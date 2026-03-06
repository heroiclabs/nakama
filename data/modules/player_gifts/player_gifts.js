// player_gifts.js - Player-to-Player Gifting System
// Storage collection: player_gifts
// RPCs: gift_send, gift_claim, gift_inbox

var GIFT_LIMITS = {
    max_pending_per_sender: 20,
    max_pending_per_recipient: 50,
    max_quantity_per_gift: 1000,
    cooldown_same_pair_seconds: 300,
    allowed_item_types: ["coins", "gems", "xp", "item", "mystery_box"]
};

/**
 * RPC: gift_send
 * Send a gift from the authenticated player to another player.
 * Deducts from sender's wallet/inventory and creates a pending gift entry.
 */
function rpcGiftSend(ctx, logger, nk, payload) {
    logger.info('[Gifting] gift_send called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');

        if (!data.to_user_id || !data.item_type || !data.quantity) {
            return JSON.stringify({
                success: false,
                error: 'to_user_id, item_type, and quantity are required'
            });
        }

        var senderId = ctx.userId;
        var recipientId = data.to_user_id;
        var itemType = data.item_type;
        var itemId = data.item_id || null;
        var quantity = parseInt(data.quantity, 10);
        var message = data.message || '';
        var gameId = data.game_id || 'global';

        if (senderId === recipientId) {
            return JSON.stringify({ success: false, error: 'Cannot send gift to yourself' });
        }

        if (quantity <= 0 || quantity > GIFT_LIMITS.max_quantity_per_gift) {
            return JSON.stringify({
                success: false,
                error: 'Quantity must be between 1 and ' + GIFT_LIMITS.max_quantity_per_gift
            });
        }

        if (GIFT_LIMITS.allowed_item_types.indexOf(itemType) === -1) {
            return JSON.stringify({
                success: false,
                error: 'Invalid item_type. Allowed: ' + GIFT_LIMITS.allowed_item_types.join(', ')
            });
        }

        // Verify recipient exists
        try {
            nk.accountGetId(recipientId);
        } catch (e) {
            return JSON.stringify({ success: false, error: 'Recipient not found' });
        }

        // Check sender hasn't exceeded pending gift limit
        var senderGifts = nk.storageList(senderId, "player_gifts", GIFT_LIMITS.max_pending_per_sender + 1, "");
        var senderPending = 0;
        if (senderGifts && senderGifts.length) {
            for (var i = 0; i < senderGifts.length; i++) {
                if (senderGifts[i].value && senderGifts[i].value.status === 'pending' && senderGifts[i].value.sender_id === senderId) {
                    senderPending++;
                }
            }
        }
        if (senderPending >= GIFT_LIMITS.max_pending_per_sender) {
            return JSON.stringify({ success: false, error: 'Too many pending gifts. Wait for some to be claimed.' });
        }

        // Check cooldown between same sender→recipient
        var nowMs = Date.now();
        if (senderGifts && senderGifts.length) {
            for (var j = 0; j < senderGifts.length; j++) {
                var g = senderGifts[j].value;
                if (g && g.recipient_id === recipientId && g.status === 'pending') {
                    var giftAge = (nowMs - (g.created_at_unix || 0)) / 1000;
                    if (giftAge < GIFT_LIMITS.cooldown_same_pair_seconds) {
                        return JSON.stringify({
                            success: false,
                            error: 'Cooldown active. Wait ' + Math.ceil(GIFT_LIMITS.cooldown_same_pair_seconds - giftAge) + 's before sending another gift to this player.'
                        });
                    }
                }
            }
        }

        // Deduct from sender's wallet for currency types
        if (itemType === 'coins' || itemType === 'gems' || itemType === 'xp') {
            var deduction = {};
            deduction[itemType] = -quantity;
            try {
                var result = nk.walletUpdate(senderId, deduction, {
                    source: 'gift_send',
                    to_user_id: recipientId,
                    game_id: gameId
                }, false);
                // walletUpdate throws if balance would go negative when changeset = false
            } catch (walletErr) {
                return JSON.stringify({
                    success: false,
                    error: 'Insufficient ' + itemType + ' balance to send gift'
                });
            }
        }

        // Create pending gift record (stored under sender's user ID)
        var giftId = 'gift_' + senderId.slice(0, 8) + '_' + recipientId.slice(0, 8) + '_' + nowMs;
        var giftData = {
            gift_id: giftId,
            sender_id: senderId,
            sender_username: ctx.username || 'Unknown',
            recipient_id: recipientId,
            item_type: itemType,
            item_id: itemId,
            quantity: quantity,
            message: message,
            game_id: gameId,
            status: 'pending',
            created_at: new Date().toISOString(),
            created_at_unix: nowMs,
            claimed_at: null
        };

        // Write under sender ownership so sender can see sent gifts
        nk.storageWrite([{
            collection: 'player_gifts',
            key: giftId,
            userId: senderId,
            value: giftData,
            permissionRead: 2,
            permissionWrite: 0
        }]);

        // Also write an inbox copy under system user with recipient lookup key
        var inboxKey = 'inbox_' + recipientId + '_' + nowMs;
        nk.storageWrite([{
            collection: 'player_gifts_inbox',
            key: inboxKey,
            userId: '00000000-0000-0000-0000-000000000000',
            value: giftData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Send notification to recipient
        try {
            nk.notificationSend(recipientId, 'You received a gift!', 100, {
                gift_id: giftId,
                sender_username: ctx.username,
                item_type: itemType,
                quantity: quantity,
                message: message
            }, senderId);
        } catch (notifErr) {
            logger.warn('[Gifting] Notification failed: ' + notifErr.message);
        }

        logger.info('[Gifting] Gift sent: ' + giftId + ' from ' + senderId + ' to ' + recipientId);

        return JSON.stringify({
            success: true,
            gift_id: giftId,
            sender_id: senderId,
            recipient_id: recipientId,
            item_type: itemType,
            item_id: itemId,
            quantity: quantity,
            status: 'pending',
            created_at: giftData.created_at
        });

    } catch (err) {
        logger.error('[Gifting] gift_send error: ' + err.message);
        logRpcError(nk, logger, 'gift_send', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: gift_inbox
 * List pending gifts for the authenticated user (as recipient).
 */
function rpcGiftInbox(ctx, logger, nk, payload) {
    logger.info('[Gifting] gift_inbox called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');
        var limit = parseInt(data.limit, 10) || 50;
        var cursor = data.cursor || '';
        var userId = ctx.userId;

        // Read from system-owned inbox collection filtered to this recipient
        var records = nk.storageList('00000000-0000-0000-0000-000000000000', 'player_gifts_inbox', limit, cursor);
        var gifts = [];
        var nextCursor = '';

        if (records) {
            if (typeof records === 'object' && records.objects) {
                nextCursor = records.cursor || '';
                records = records.objects;
            }
            for (var i = 0; i < records.length; i++) {
                var gift = records[i].value;
                if (gift && gift.recipient_id === userId && gift.status === 'pending') {
                    gifts.push({
                        gift_id: gift.gift_id,
                        sender_id: gift.sender_id,
                        sender_username: gift.sender_username,
                        item_type: gift.item_type,
                        item_id: gift.item_id,
                        quantity: gift.quantity,
                        message: gift.message,
                        game_id: gift.game_id,
                        created_at: gift.created_at,
                        inbox_key: records[i].key
                    });
                }
            }
        }

        return JSON.stringify({
            success: true,
            user_id: userId,
            pending_gifts: gifts,
            count: gifts.length,
            cursor: nextCursor
        });

    } catch (err) {
        logger.error('[Gifting] gift_inbox error: ' + err.message);
        logRpcError(nk, logger, 'gift_inbox', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: gift_claim
 * Claim a pending gift. Grants the item/currency to the recipient's wallet/inventory.
 */
function rpcGiftClaim(ctx, logger, nk, payload) {
    logger.info('[Gifting] gift_claim called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');

        if (!data.gift_id) {
            return JSON.stringify({ success: false, error: 'gift_id is required' });
        }

        var userId = ctx.userId;
        var giftId = data.gift_id;

        // Find the gift in inbox
        var inboxRecords = nk.storageList('00000000-0000-0000-0000-000000000000', 'player_gifts_inbox', 100, '');
        var foundGift = null;
        var foundKey = null;
        var allRecords = inboxRecords;
        if (typeof inboxRecords === 'object' && inboxRecords.objects) {
            allRecords = inboxRecords.objects;
        }

        for (var i = 0; i < allRecords.length; i++) {
            var record = allRecords[i];
            if (record.value && record.value.gift_id === giftId && record.value.recipient_id === userId) {
                foundGift = record.value;
                foundKey = record.key;
                break;
            }
        }

        if (!foundGift) {
            return JSON.stringify({ success: false, error: 'Gift not found or not addressed to you' });
        }

        if (foundGift.status !== 'pending') {
            return JSON.stringify({ success: false, error: 'Gift already claimed' });
        }

        // Grant to recipient wallet for currency types
        var walletGranted = {};
        if (foundGift.item_type === 'coins' || foundGift.item_type === 'gems' || foundGift.item_type === 'xp') {
            walletGranted[foundGift.item_type] = foundGift.quantity;
            try {
                nk.walletUpdate(userId, walletGranted, {
                    source: 'gift_claim',
                    gift_id: giftId,
                    from_user_id: foundGift.sender_id,
                    game_id: foundGift.game_id
                }, true);
            } catch (walletErr) {
                logger.error('[Gifting] Wallet grant failed: ' + walletErr.message);
                return JSON.stringify({ success: false, error: 'Failed to grant gift to wallet' });
            }
        } else if (foundGift.item_type === 'item' || foundGift.item_type === 'mystery_box') {
            // Grant inventory item
            var inventoryKey = foundGift.item_type + '_' + (foundGift.item_id || 'generic') + '_' + Date.now();
            nk.storageWrite([{
                collection: 'player_inventory',
                key: inventoryKey,
                userId: userId,
                value: {
                    item_type: foundGift.item_type,
                    item_id: foundGift.item_id,
                    quantity: foundGift.quantity,
                    source: 'gift',
                    gift_id: giftId,
                    from_user_id: foundGift.sender_id,
                    granted_at: new Date().toISOString()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }

        // Update gift status to claimed in inbox
        foundGift.status = 'claimed';
        foundGift.claimed_at = new Date().toISOString();
        foundGift.claimed_at_unix = Date.now();
        nk.storageWrite([{
            collection: 'player_gifts_inbox',
            key: foundKey,
            userId: '00000000-0000-0000-0000-000000000000',
            value: foundGift,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Update original gift record under sender
        try {
            var senderRecords = nk.storageRead([{
                collection: 'player_gifts',
                key: giftId,
                userId: foundGift.sender_id
            }]);
            if (senderRecords && senderRecords.length > 0) {
                var senderGift = senderRecords[0].value;
                senderGift.status = 'claimed';
                senderGift.claimed_at = foundGift.claimed_at;
                nk.storageWrite([{
                    collection: 'player_gifts',
                    key: giftId,
                    userId: foundGift.sender_id,
                    value: senderGift,
                    permissionRead: 2,
                    permissionWrite: 0
                }]);
            }
        } catch (e) {
            logger.warn('[Gifting] Failed to update sender copy: ' + e.message);
        }

        // Notify sender that gift was claimed
        try {
            nk.notificationSend(foundGift.sender_id, 'Your gift was claimed!', 101, {
                gift_id: giftId,
                claimed_by: ctx.username || userId,
                item_type: foundGift.item_type,
                quantity: foundGift.quantity
            }, userId);
        } catch (notifErr) {
            logger.warn('[Gifting] Claim notification failed: ' + notifErr.message);
        }

        logger.info('[Gifting] Gift claimed: ' + giftId + ' by ' + userId);

        return JSON.stringify({
            success: true,
            gift_id: giftId,
            item_type: foundGift.item_type,
            item_id: foundGift.item_id,
            quantity: foundGift.quantity,
            wallet_granted: walletGranted,
            claimed_at: foundGift.claimed_at
        });

    } catch (err) {
        logger.error('[Gifting] gift_claim error: ' + err.message);
        logRpcError(nk, logger, 'gift_claim', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}
