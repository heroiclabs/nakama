// notification_inbox.js - Notification Inbox System for QuizVerse v3.0
// RPCs: list_notification_inbox, mark_notifications_read
// Nakama is the source of truth for all notification state.

/**
 * Notification Inbox — Production-Ready
 *
 * Bridges Nakama built-in notifications (from nk.notificationSend across all modules)
 * with custom scheduled/inbox entries stored in "notification_inbox" collection.
 *
 * Storage: collection="notification_inbox", key="{notificationId}"
 *
 * Nakama built-in notifications come from:
 *   - social_v2.js (friend invites, friend challenges)
 *   - quizverse_depth.js (duel results)
 *   - player_gifts.js (gifts sent/claimed)
 *   - friends.js (friend challenges)
 *   - chat.js (chat notifications)
 *   - copilot/social_features.js (friend requests/accepts)
 */

// ─── CONSTANTS ──────────────────────────────────────────────────────────────

var INBOX_COLLECTION = 'notification_inbox';
var MAX_INBOX_LIMIT = 100;

// Map Nakama built-in notification codes to event types
// These codes are used by nk.notificationSend across the codebase
var NOTIFICATION_CODE_MAP = {
    1: 'friend_request',
    2: 'friend_accept',
    3: 'duel_result',
    4: 'challenge_received',
    5: 'match_found',
    100: 'gift_received',
    101: 'gift_claimed',
    // Default for unknown codes
    0: 'system'
};

// ─── HELPERS ────────────────────────────────────────────────────────────────

function inboxErrorResponse(msg) {
    return JSON.stringify({ success: false, error: msg });
}

function inboxParsePayload(payload) {
    if (!payload || payload === '') return {};
    try {
        return JSON.parse(payload);
    } catch (err) {
        return null;
    }
}

/**
 * Convert a Nakama built-in notification to the unified ServerNotificationEntry format
 * that the Unity client expects.
 *
 * Nakama built-in notification shape:
 *   { id, subject, content (object), code (int), senderId, createTime (RFC3339 string) }
 */
function mapBuiltinNotification(n) {
    var code = n.code || 0;
    var eventType = NOTIFICATION_CODE_MAP[code] || 'system';
    var content = n.content || {};

    // Extract data fields from content (Nakama stores content as an object)
    var data = {};
    for (var key in content) {
        if (content.hasOwnProperty(key)) {
            data[key] = String(content[key]);
        }
    }

    // Determine title/body from Nakama fields
    var title = n.subject || 'Notification';
    var body = content.message || content.body || '';

    // If content has a type field, use it as the event_type (more specific)
    if (content.type) {
        eventType = content.type;
    }

    // Parse createTime — Nakama returns RFC3339 string (e.g. "2024-01-15T10:30:00Z")
    var sentAtMs = Date.now();
    if (n.createTime) {
        try {
            sentAtMs = new Date(n.createTime).getTime();
            if (isNaN(sentAtMs)) sentAtMs = Date.now();
        } catch (e) {
            sentAtMs = Date.now();
        }
    }

    return {
        notification_id: n.id || ('builtin_' + Date.now() + '_' + Math.random()),
        title: title,
        body: body,
        event_type: eventType,
        data: data,
        template_id: '',
        priority: code <= 5 ? (10 - code) : 5,   // Lower codes = higher priority
        channel: 'in_app',
        is_read: false,    // Nakama built-ins are unread until deleted
        sent_at: sentAtMs,
        created_at: sentAtMs,
        source: 'nakama_builtin'
    };
}

/**
 * Convert a custom inbox storage entry to the ServerNotificationEntry format.
 */
function mapCustomInboxEntry(record) {
    var v = record.value || {};
    return {
        notification_id: v.notification_id || record.key,
        title: v.title || 'Notification',
        body: v.body || '',
        event_type: v.event_type || 'general',
        data: v.data || {},
        template_id: v.template_id || '',
        priority: v.priority || 5,
        channel: v.channel || 'both',
        is_read: v.is_read || false,
        sent_at: v.sent_at || v.created_at || Date.now(),
        created_at: v.created_at || Date.now(),
        source: 'custom'
    };
}

/**
 * Read custom inbox entries from notification_inbox collection.
 * nk.storageList returns { objects: [...], cursor: "..." }
 */
function readCustomInbox(nk, logger, userId, limit) {
    var entries = [];
    try {
        var result = nk.storageList(userId, INBOX_COLLECTION, limit, '');
        if (result && result.objects && result.objects.length > 0) {
            for (var i = 0; i < result.objects.length; i++) {
                entries.push(mapCustomInboxEntry(result.objects[i]));
            }
        }
    } catch (err) {
        logger.warn('[NotifInbox] Failed to read custom inbox: ' + err.message);
    }
    return entries;
}

/**
 * Write a notification to the custom inbox
 */
function writeInboxEntry(nk, logger, userId, entry) {
    try {
        var notifId = entry.notification_id || ('notif_' + Date.now() + '_' + Math.floor(Math.random() * 10000));
        nk.storageWrite([{
            collection: INBOX_COLLECTION,
            key: notifId,
            userId: userId,
            value: {
                notification_id: notifId,
                title: entry.title || 'Notification',
                body: entry.body || '',
                event_type: entry.event_type || 'general',
                data: entry.data || {},
                template_id: entry.template_id || '',
                priority: entry.priority || 5,
                channel: entry.channel || 'both',
                is_read: false,
                sent_at: entry.sent_at || Date.now(),
                created_at: Date.now()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
        return notifId;
    } catch (err) {
        logger.error('[NotifInbox] Failed to write inbox entry: ' + err.message);
        return null;
    }
}

// ─── RPC: list_notification_inbox ───────────────────────────────────────────

/**
 * Fetch the user's unified notification inbox.
 * Merges Nakama built-in notifications + custom inbox entries.
 *
 * Payload: { limit: 50, include_read: true, event_type: null }
 * Response: { success, notifications[], count, unread_count }
 */
function rpcListNotificationInbox(ctx, logger, nk, payload) {
    if (!ctx.userId) return inboxErrorResponse('User not authenticated');

    var data = inboxParsePayload(payload);
    if (data === null) return inboxErrorResponse('Invalid JSON payload');

    var userId = ctx.userId;
    var limit = Math.min(data.limit || 50, MAX_INBOX_LIMIT);
    var includeRead = data.include_read !== false; // Default true
    var eventTypeFilter = data.event_type || null;

    var allNotifications = [];

    // ── Source 1: Nakama built-in notifications ──
    // nk.notificationsList returns { notifications: [...], cacheableCursor: "..." }
    try {
        var builtinResult = nk.notificationsList(userId, limit, null);
        if (builtinResult && builtinResult.notifications) {
            for (var i = 0; i < builtinResult.notifications.length; i++) {
                var mapped = mapBuiltinNotification(builtinResult.notifications[i]);
                allNotifications.push(mapped);
            }
            logger.debug('[NotifInbox] Loaded ' + builtinResult.notifications.length + ' built-in notifications');
        }
    } catch (err) {
        logger.warn('[NotifInbox] Failed to read built-in notifications: ' + err.message);
    }

    // ── Source 2: Custom inbox entries ──
    var customEntries = readCustomInbox(nk, logger, userId, limit);
    for (var j = 0; j < customEntries.length; j++) {
        allNotifications.push(customEntries[j]);
    }
    logger.debug('[NotifInbox] Loaded ' + customEntries.length + ' custom inbox entries');

    // ── Filter ──
    var filtered = [];
    var unreadCount = 0;

    for (var k = 0; k < allNotifications.length; k++) {
        var n = allNotifications[k];

        // Filter by read status
        if (!includeRead && n.is_read) continue;

        // Filter by event type
        if (eventTypeFilter && n.event_type !== eventTypeFilter) continue;

        filtered.push(n);

        if (!n.is_read) unreadCount++;
    }

    // ── Sort by sent_at descending (newest first) ──
    filtered.sort(function(a, b) {
        return (b.sent_at || 0) - (a.sent_at || 0);
    });

    // ── Trim to limit ──
    if (filtered.length > limit) {
        filtered = filtered.slice(0, limit);
    }

    logger.info('[NotifInbox] User ' + userId + ': ' + filtered.length + ' notifications (' + unreadCount + ' unread)');

    return JSON.stringify({
        success: true,
        notifications: filtered,
        count: filtered.length,
        unread_count: unreadCount
    });
}

// ─── RPC: mark_notifications_read ───────────────────────────────────────────

/**
 * Mark notifications as read.
 *
 * Payload: { notification_ids: ["id1", "id2"], mark_all: false }
 *   OR:    { mark_all: true }
 *
 * Response: { success, marked_count }
 *
 * For Nakama built-in notifications: deletes them (Nakama's canonical "mark read").
 * For custom inbox entries: sets is_read = true in storage.
 */
function rpcMarkNotificationsRead(ctx, logger, nk, payload) {
    if (!ctx.userId) return inboxErrorResponse('User not authenticated');

    var data = inboxParsePayload(payload);
    if (data === null) return inboxErrorResponse('Invalid JSON payload');

    var userId = ctx.userId;
    var markAll = data.mark_all === true;
    var notificationIds = data.notification_ids || [];
    var markedCount = 0;

    if (markAll) {
        // ── Mark ALL: Delete all built-in notifications ──
        try {
            var builtinResult = nk.notificationsList(userId, MAX_INBOX_LIMIT, null);
            if (builtinResult && builtinResult.notifications && builtinResult.notifications.length > 0) {
                var builtinIds = [];
                for (var i = 0; i < builtinResult.notifications.length; i++) {
                    builtinIds.push(builtinResult.notifications[i].id);
                }
                if (builtinIds.length > 0) {
                    nk.notificationsDelete(userId, builtinIds);
                    markedCount += builtinIds.length;
                    logger.info('[NotifInbox] Deleted ' + builtinIds.length + ' built-in notifications for mark-all-read');
                }
            }
        } catch (err) {
            logger.warn('[NotifInbox] Failed to clear built-in notifications: ' + err.message);
        }

        // ── Mark ALL: Update all custom inbox entries ──
        // nk.storageList returns { objects: [...], cursor: "..." }
        try {
            var customResult = nk.storageList(userId, INBOX_COLLECTION, MAX_INBOX_LIMIT, '');
            if (customResult && customResult.objects && customResult.objects.length > 0) {
                var writes = [];
                for (var ci = 0; ci < customResult.objects.length; ci++) {
                    var rec = customResult.objects[ci];
                    var val = rec.value || {};
                    if (!val.is_read) {
                        val.is_read = true;
                        val.read_at = Date.now();
                        writes.push({
                            collection: INBOX_COLLECTION,
                            key: rec.key,
                            userId: userId,
                            value: val,
                            permissionRead: 1,
                            permissionWrite: 0
                        });
                        markedCount++;
                    }
                }
                if (writes.length > 0) {
                    nk.storageWrite(writes);
                    logger.info('[NotifInbox] Marked ' + writes.length + ' custom inbox entries as read');
                }
            }
        } catch (err) {
            logger.warn('[NotifInbox] Failed to mark custom entries as read: ' + err.message);
        }

    } else if (notificationIds.length > 0) {
        // ── Mark specific IDs ──
        var builtinIdsToDelete = [];
        var customKeysToUpdate = [];

        // Separate built-in vs custom (try to read each from custom first)
        for (var ni = 0; ni < notificationIds.length; ni++) {
            var nid = notificationIds[ni];

            // Try to read from custom inbox
            try {
                var customCheck = nk.storageRead([{
                    collection: INBOX_COLLECTION,
                    key: nid,
                    userId: userId
                }]);
                if (customCheck && customCheck.length > 0) {
                    customKeysToUpdate.push({ key: nid, record: customCheck[0] });
                    continue;
                }
            } catch (readErr) {
                // Not in custom inbox — must be a built-in notification
            }

            // Assume it's a built-in notification ID
            builtinIdsToDelete.push(nid);
        }

        // Delete built-in notifications
        if (builtinIdsToDelete.length > 0) {
            try {
                nk.notificationsDelete(userId, builtinIdsToDelete);
                markedCount += builtinIdsToDelete.length;
                logger.info('[NotifInbox] Deleted ' + builtinIdsToDelete.length + ' built-in notifications');
            } catch (err) {
                logger.warn('[NotifInbox] Failed to delete built-in: ' + err.message);
            }
        }

        // Update custom inbox entries
        if (customKeysToUpdate.length > 0) {
            var updateWrites = [];
            for (var ui = 0; ui < customKeysToUpdate.length; ui++) {
                var item = customKeysToUpdate[ui];
                var value = item.record.value || {};
                value.is_read = true;
                value.read_at = Date.now();
                updateWrites.push({
                    collection: INBOX_COLLECTION,
                    key: item.key,
                    userId: userId,
                    value: value,
                    permissionRead: 1,
                    permissionWrite: 0
                });
                markedCount++;
            }
            if (updateWrites.length > 0) {
                try {
                    nk.storageWrite(updateWrites);
                    logger.info('[NotifInbox] Marked ' + updateWrites.length + ' custom entries as read');
                } catch (err) {
                    logger.warn('[NotifInbox] Failed to update custom entries: ' + err.message);
                }
            }
        }
    } else {
        return inboxErrorResponse('No notification_ids provided and mark_all is false');
    }

    return JSON.stringify({
        success: true,
        marked_count: markedCount
    });
}
