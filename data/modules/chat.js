// chat.js - Group Chat, Direct Chat, and Chat Room implementation
// Compatible with Nakama JavaScript runtime (no ES modules)

/**
 * Send a message in a group chat
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} groupId - Group/clan ID
 * @param {string} userId - Sender user ID
 * @param {string} username - Sender username
 * @param {string} message - Message content
 * @param {object} metadata - Optional metadata
 * @returns {object} Message object
 */
function sendGroupChatMessage(nk, logger, groupId, userId, username, message, metadata) {
    var collection = "group_chat";
    var key = "msg:" + groupId + ":" + Date.now() + ":" + userId;
    
    logger.info("[CHAT] Sending group message to " + groupId);
    
    var messageData = {
        message_id: key,
        group_id: groupId,
        user_id: userId,
        username: username,
        message: message,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    try {
        // Store message with userId for proper scoping
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: messageData,
            permissionRead: 2, // Public read - anyone in group can read
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[CHAT] Group message stored: " + key);
        
        // Also use Nakama's built-in channel system for real-time delivery
        try {
            var channelId = "group:" + groupId;
            var content = {
                type: "group_chat",
                message: message,
                username: username,
                user_id: userId,
                timestamp: new Date().toISOString()
            };
            
            // Send to channel (Nakama built-in)
            nk.channelMessageSend(channelId, JSON.stringify(content), userId, username);
            logger.info("[CHAT] Message sent to channel: " + channelId);
        } catch (channelErr) {
            logger.warn("[CHAT] Failed to send to channel: " + channelErr.message);
        }
        
        return messageData;
    } catch (err) {
        logger.error("[CHAT] Failed to store group message: " + err.message);
        throw err;
    }
}

/**
 * Send a direct message to another user
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} fromUserId - Sender user ID
 * @param {string} fromUsername - Sender username
 * @param {string} toUserId - Recipient user ID
 * @param {string} message - Message content
 * @param {object} metadata - Optional metadata
 * @returns {object} Message object
 */
function sendDirectMessage(nk, logger, fromUserId, fromUsername, toUserId, message, metadata) {
    var collection = "direct_chat";
    // Create a deterministic conversation ID (smaller userId first for consistency)
    var conversationId = fromUserId < toUserId ? 
        fromUserId + ":" + toUserId : 
        toUserId + ":" + fromUserId;
    var key = "msg:" + conversationId + ":" + Date.now() + ":" + fromUserId;
    
    logger.info("[CHAT] Sending direct message from " + fromUserId + " to " + toUserId);
    
    var messageData = {
        message_id: key,
        conversation_id: conversationId,
        from_user_id: fromUserId,
        from_username: fromUsername,
        to_user_id: toUserId,
        message: message,
        metadata: metadata || {},
        read: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    try {
        // Store message with sender's userId
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: fromUserId,
            value: messageData,
            permissionRead: 2, // Public read - both users can read
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[CHAT] Direct message stored: " + key);
        
        // Send notification to recipient
        try {
            var notificationContent = {
                type: "direct_message",
                from_user_id: fromUserId,
                from_username: fromUsername,
                message: message,
                conversation_id: conversationId
            };
            
            nk.notificationSend(
                toUserId,
                "New Direct Message",
                notificationContent,
                100, // code for direct message
                fromUserId,
                true
            );
            logger.info("[CHAT] Notification sent to " + toUserId);
        } catch (notifErr) {
            logger.warn("[CHAT] Failed to send notification: " + notifErr.message);
        }
        
        return messageData;
    } catch (err) {
        logger.error("[CHAT] Failed to store direct message: " + err.message);
        throw err;
    }
}

/**
 * Send a message in a public chat room
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} roomId - Chat room ID
 * @param {string} userId - Sender user ID
 * @param {string} username - Sender username
 * @param {string} message - Message content
 * @param {object} metadata - Optional metadata
 * @returns {object} Message object
 */
function sendChatRoomMessage(nk, logger, roomId, userId, username, message, metadata) {
    var collection = "chat_room";
    var key = "msg:" + roomId + ":" + Date.now() + ":" + userId;
    
    logger.info("[CHAT] Sending room message to " + roomId);
    
    var messageData = {
        message_id: key,
        room_id: roomId,
        user_id: userId,
        username: username,
        message: message,
        metadata: metadata || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    try {
        // Store message with userId for proper scoping
        nk.storageWrite([{
            collection: collection,
            key: key,
            userId: userId,
            value: messageData,
            permissionRead: 2, // Public read
            permissionWrite: 0,
            version: "*"
        }]);
        
        logger.info("[CHAT] Room message stored: " + key);
        
        // Also use Nakama's built-in channel system for real-time delivery
        try {
            var channelId = "room:" + roomId;
            var content = {
                type: "chat_room",
                message: message,
                username: username,
                user_id: userId,
                room_id: roomId,
                timestamp: new Date().toISOString()
            };
            
            // Send to channel (Nakama built-in)
            nk.channelMessageSend(channelId, JSON.stringify(content), userId, username);
            logger.info("[CHAT] Message sent to room channel: " + channelId);
        } catch (channelErr) {
            logger.warn("[CHAT] Failed to send to room channel: " + channelErr.message);
        }
        
        return messageData;
    } catch (err) {
        logger.error("[CHAT] Failed to store room message: " + err.message);
        throw err;
    }
}

/**
 * Get chat history for a group
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} groupId - Group ID
 * @param {number} limit - Maximum number of messages to return
 * @returns {array} Array of message objects
 */
function getGroupChatHistory(nk, logger, groupId, limit) {
    var collection = "group_chat";
    limit = limit || 50;
    
    logger.info("[CHAT] Retrieving group chat history for " + groupId);
    
    try {
        // List all messages in the group_chat collection
        // Filter by group_id in the results
        var records = nk.storageList(null, collection, limit, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.group_id === groupId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending (most recent first)
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info("[CHAT] Retrieved " + messages.length + " group messages");
        return messages.slice(0, limit);
    } catch (err) {
        logger.error("[CHAT] Failed to retrieve group chat history: " + err.message);
        return [];
    }
}

/**
 * Get direct message history between two users
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId1 - First user ID
 * @param {string} userId2 - Second user ID
 * @param {number} limit - Maximum number of messages to return
 * @returns {array} Array of message objects
 */
function getDirectMessageHistory(nk, logger, userId1, userId2, limit) {
    var collection = "direct_chat";
    limit = limit || 50;
    
    // Create conversation ID (consistent ordering)
    var conversationId = userId1 < userId2 ? 
        userId1 + ":" + userId2 : 
        userId2 + ":" + userId1;
    
    logger.info("[CHAT] Retrieving direct message history for " + conversationId);
    
    try {
        // List messages for both users
        var records = nk.storageList(null, collection, limit * 2, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.conversation_id === conversationId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending (most recent first)
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info("[CHAT] Retrieved " + messages.length + " direct messages");
        return messages.slice(0, limit);
    } catch (err) {
        logger.error("[CHAT] Failed to retrieve direct message history: " + err.message);
        return [];
    }
}

/**
 * Get chat room message history
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} roomId - Chat room ID
 * @param {number} limit - Maximum number of messages to return
 * @returns {array} Array of message objects
 */
function getChatRoomHistory(nk, logger, roomId, limit) {
    var collection = "chat_room";
    limit = limit || 50;
    
    logger.info("[CHAT] Retrieving chat room history for " + roomId);
    
    try {
        var records = nk.storageList(null, collection, limit, null);
        
        var messages = [];
        if (records && records.objects) {
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && record.value.room_id === roomId) {
                    messages.push(record.value);
                }
            }
        }
        
        // Sort by created_at descending (most recent first)
        messages.sort(function(a, b) {
            return new Date(b.created_at) - new Date(a.created_at);
        });
        
        logger.info("[CHAT] Retrieved " + messages.length + " room messages");
        return messages.slice(0, limit);
    } catch (err) {
        logger.error("[CHAT] Failed to retrieve chat room history: " + err.message);
        return [];
    }
}

/**
 * Mark direct messages as read
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger instance
 * @param {string} userId - User ID marking messages as read
 * @param {string} conversationId - Conversation ID
 * @returns {number} Number of messages marked as read
 */
function markDirectMessagesAsRead(nk, logger, userId, conversationId) {
    var collection = "direct_chat";
    
    logger.info("[CHAT] Marking messages as read for user " + userId + " in conversation " + conversationId);
    
    try {
        var records = nk.storageList(null, collection, 100, null);
        var updatedCount = 0;
        
        if (records && records.objects) {
            var toUpdate = [];
            
            for (var i = 0; i < records.objects.length; i++) {
                var record = records.objects[i];
                if (record.value && 
                    record.value.conversation_id === conversationId &&
                    record.value.to_user_id === userId &&
                    !record.value.read) {
                    
                    record.value.read = true;
                    record.value.read_at = new Date().toISOString();
                    
                    toUpdate.push({
                        collection: collection,
                        key: record.key,
                        userId: record.userId,
                        value: record.value,
                        permissionRead: 2,
                        permissionWrite: 0,
                        version: "*"
                    });
                }
            }
            
            if (toUpdate.length > 0) {
                nk.storageWrite(toUpdate);
                updatedCount = toUpdate.length;
                logger.info("[CHAT] Marked " + updatedCount + " messages as read");
            }
        }
        
        return updatedCount;
    } catch (err) {
        logger.error("[CHAT] Failed to mark messages as read: " + err.message);
        return 0;
    }
}
