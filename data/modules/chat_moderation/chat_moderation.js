// chat_moderation.js - Chat Moderation Pipeline
// Storage collection: chat_reports, chat_filter_config
// RPCs: chat_filter_message (public), chat_report_message (public),
//       chat_moderation_review (admin-gated), chat_moderation_stats (admin-gated)
//
// Helpers checkProfanity / filterMessage are also reused by chatbox.js via
// the postbuild global hoist.
//
// SECURITY NOTE (audit 2026-05-19, P0-2 + P0-3):
//   Prior to this module having an InitModule the admin RPCs were dead code,
//   which masked the fact that they had NO auth check. Now that we register
//   them, requireAdmin() bounces non-admins. Admin identities are sourced
//   from the env-supplied ADMIN_USER_IDS (comma-separated UUID list, set in
//   docker-compose / EKS secrets / .env via --runtime.env).

// ============================================================================
// ADMIN AUTH GATE
// ============================================================================

function modIsAdmin(ctx) {
    if (!ctx || !ctx.userId) return false;
    var raw = (ctx.env && ctx.env.ADMIN_USER_IDS) || "";
    if (!raw) return false;
    var ids = raw.split(",");
    for (var i = 0; i < ids.length; i++) {
        if ((ids[i] || "").trim() === ctx.userId) return true;
    }
    return false;
}

function modRequireAdmin(ctx) {
    if (modIsAdmin(ctx)) return null;
    return JSON.stringify({ success: false, error: "admin_required" });
}

// QVBF_91: matching is whole-word now (see checkProfanity/filterMessage), so
// compounds and inflections that substring matching used to catch must be
// listed explicitly or they would pass unfiltered.
var PROFANITY_WORDS = [
    "fuck", "fucking", "fucker", "fuckers", "fucked", "fucks",
    "shit", "shitty", "shits",
    "ass", "asses", "asshole", "assholes", "dumbass", "jackass",
    "bitch", "bitches", "bitchy",
    "dick", "dicks", "dickhead",
    "cunt", "cunts",
    "damn", "bastard", "bastards",
    "nigger", "niggers", "nigga", "niggas",
    "faggot", "faggots",
    "retard", "retarded", "retards",
    "whore", "whores", "slut", "sluts", "slutty",
    "kill yourself", "kys", "die",
    "rape", "rapes", "raped", "rapist"
];

var SPAM_PATTERNS = [
    /(.)\1{5,}/,
    /https?:\/\/[^\s]+/,
    /\b(free|cheap|buy now|click here|subscribe)\b/i
];

var MODERATION_CONFIG = {
    max_reports_before_auto_mute: 5,
    report_cooldown_seconds: 60,
    auto_filter_enabled: true,
    max_message_length: 1000
};

/**
 * Check a message against the profanity word list.
 * Returns { flagged: bool, matched_words: string[], severity: string }
 */
function checkProfanity(text) {
    var lower = text.toLowerCase();
    var matched = [];

    for (var i = 0; i < PROFANITY_WORDS.length; i++) {
        // QVBF_91: whole-word match — substring matching censored normal
        // words ("assist" → "***ist", "studied" flagged via "die").
        var escaped = PROFANITY_WORDS[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp('\\b' + escaped + '\\b').test(lower)) {
            matched.push(PROFANITY_WORDS[i]);
        }
    }

    var severity = 'clean';
    if (matched.length > 0) severity = 'mild';
    if (matched.length >= 3) severity = 'severe';

    for (var j = 0; j < matched.length; j++) {
        var w = matched[j];
        if (w.indexOf('nigg') === 0 || w.indexOf('faggot') === 0 || w.indexOf('rap') === 0 || w === 'kill yourself' || w === 'kys') {
            severity = 'severe';
            break;
        }
    }

    return { flagged: matched.length > 0, matched_words: matched, severity: severity };
}

/**
 * Check a message for spam patterns.
 */
function checkSpam(text) {
    var flags = [];
    for (var i = 0; i < SPAM_PATTERNS.length; i++) {
        if (SPAM_PATTERNS[i].test(text)) {
            flags.push('spam_pattern_' + i);
        }
    }
    if (text.length > MODERATION_CONFIG.max_message_length) {
        flags.push('message_too_long');
    }
    return { flagged: flags.length > 0, flags: flags };
}

/**
 * Filter a message by replacing profanity with asterisks.
 * Returns the filtered text.
 */
function filterMessage(text) {
    var filtered = text;
    for (var i = 0; i < PROFANITY_WORDS.length; i++) {
        var word = PROFANITY_WORDS[i];
        var replacement = '';
        for (var c = 0; c < word.length; c++) replacement += '*';
        // QVBF_91: \b boundaries so "assist"/"class"/"grape" are never masked.
        var regex = new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi');
        filtered = filtered.replace(regex, replacement);
    }
    return filtered;
}

/**
 * RPC: chat_report_message
 * Report a chat message as inappropriate.
 */
function rpcChatReportMessage(ctx, logger, nk, payload) {
    logger.info('[Moderation] chat_report_message called');

    try {
        if (!ctx.userId) {
            return JSON.stringify({ success: false, error: 'Authentication required' });
        }

        var data = JSON.parse(payload || '{}');

        if (!data.message_id || !data.reason) {
            return JSON.stringify({
                success: false,
                error: 'message_id and reason are required'
            });
        }

        var reporterId = ctx.userId;
        var messageId = data.message_id;
        var reason = data.reason;
        var channelType = data.channel_type || 'unknown';
        var channelId = data.channel_id || '';
        var reportedUserId = data.reported_user_id || '';
        var messageContent = data.message_content || '';
        var additionalInfo = data.additional_info || '';

        // Check reporter hasn't spammed reports (cooldown)
        var recentReports = nk.storageList(reporterId, 'chat_reports_by_reporter', 10, '');
        var allRecent = recentReports;
        if (typeof recentReports === 'object' && recentReports.objects) {
            allRecent = recentReports.objects;
        }
        var nowMs = Date.now();
        if (allRecent && allRecent.length > 0) {
            var lastReport = allRecent[allRecent.length - 1];
            if (lastReport && lastReport.value && lastReport.value.created_at_unix) {
                var elapsed = (nowMs - lastReport.value.created_at_unix) / 1000;
                if (elapsed < MODERATION_CONFIG.report_cooldown_seconds) {
                    return JSON.stringify({
                        success: false,
                        error: 'Report cooldown active. Wait ' + Math.ceil(MODERATION_CONFIG.report_cooldown_seconds - elapsed) + 's.'
                    });
                }
            }
        }

        // Run automated checks on the reported content
        var profanityCheck = messageContent ? checkProfanity(messageContent) : { flagged: false, matched_words: [], severity: 'unknown' };
        var spamCheck = messageContent ? checkSpam(messageContent) : { flagged: false, flags: [] };

        var reportId = 'report_' + reporterId.slice(0, 8) + '_' + nowMs;
        var reportData = {
            report_id: reportId,
            message_id: messageId,
            channel_type: channelType,
            channel_id: channelId,
            reporter_id: reporterId,
            reporter_username: ctx.username || 'Unknown',
            reported_user_id: reportedUserId,
            message_content: messageContent,
            reason: reason,
            additional_info: additionalInfo,
            auto_analysis: {
                profanity: profanityCheck,
                spam: spamCheck
            },
            status: 'pending',
            created_at: new Date().toISOString(),
            created_at_unix: nowMs,
            reviewed_at: null,
            reviewed_by: null,
            action_taken: null
        };

        // Auto-escalate severe content
        if (profanityCheck.severity === 'severe') {
            reportData.status = 'auto_flagged_severe';
        }

        // Write to system-owned reports collection
        nk.storageWrite([{
            collection: 'chat_reports',
            key: reportId,
            userId: '00000000-0000-0000-0000-000000000000',
            value: reportData,
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Track per-reporter (for cooldown / abuse detection)
        nk.storageWrite([{
            collection: 'chat_reports_by_reporter',
            key: reportId,
            userId: reporterId,
            value: { report_id: reportId, created_at_unix: nowMs },
            permissionRead: 1,
            permissionWrite: 0
        }]);

        // Count total reports against the reported user
        if (reportedUserId) {
            var userReportCountKey = 'report_count_' + reportedUserId;
            var existing = null;
            try {
                var countRecords = nk.storageRead([{
                    collection: 'chat_moderation_user_stats',
                    key: userReportCountKey,
                    userId: '00000000-0000-0000-0000-000000000000'
                }]);
                if (countRecords && countRecords.length > 0) {
                    existing = countRecords[0].value;
                }
            } catch (e) { /* first report */ }

            var totalReports = (existing ? existing.total_reports : 0) + 1;
            var autoMuted = existing ? existing.auto_muted : false;

            if (totalReports >= MODERATION_CONFIG.max_reports_before_auto_mute && !autoMuted) {
                autoMuted = true;
                reportData.action_taken = 'auto_muted';
                logger.warn('[Moderation] Auto-muted user ' + reportedUserId + ' after ' + totalReports + ' reports');
            }

            nk.storageWrite([{
                collection: 'chat_moderation_user_stats',
                key: userReportCountKey,
                userId: '00000000-0000-0000-0000-000000000000',
                value: {
                    user_id: reportedUserId,
                    total_reports: totalReports,
                    auto_muted: autoMuted,
                    last_report_at: new Date().toISOString()
                },
                permissionRead: 1,
                permissionWrite: 0
            }]);
        }

        logger.info('[Moderation] Report created: ' + reportId);

        return JSON.stringify({
            success: true,
            report_id: reportId,
            auto_analysis: reportData.auto_analysis,
            status: reportData.status,
            action_taken: reportData.action_taken
        });

    } catch (err) {
        logger.error('[Moderation] chat_report_message error: ' + err.message);
        logRpcError(nk, logger, 'chat_report_message', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: "internal_error" });
    }
}

/**
 * RPC: chat_moderation_review
 * Admin-only: Review pending reports and take action.
 */
function rpcChatModerationReview(ctx, logger, nk, payload) {
    logger.info('[Moderation] chat_moderation_review called');

    // P0-3: admin gate. Without this, any authenticated user could list
    // reports and ban other users.
    var denial = modRequireAdmin(ctx);
    if (denial) return denial;

    try {
        var data = JSON.parse(payload || '{}');
        var action = data.action || 'list';

        if (action === 'list') {
            var limit = parseInt(data.limit, 10) || 50;
            var statusFilter = data.status || 'pending';
            var cursor = data.cursor || '';

            var records = nk.storageList('00000000-0000-0000-0000-000000000000', 'chat_reports', limit, cursor);
            var reports = [];
            var nextCursor = '';

            var allRecords = records;
            if (typeof records === 'object' && records.objects) {
                nextCursor = records.cursor || '';
                allRecords = records.objects;
            }

            for (var i = 0; i < allRecords.length; i++) {
                var r = allRecords[i].value;
                if (r && (statusFilter === 'all' || r.status === statusFilter || r.status === 'auto_flagged_severe')) {
                    reports.push(r);
                }
            }

            return JSON.stringify({
                success: true,
                reports: reports,
                count: reports.length,
                cursor: nextCursor
            });
        }

        if (action === 'resolve') {
            if (!data.report_id || !data.resolution) {
                return JSON.stringify({
                    success: false,
                    error: 'report_id and resolution are required for resolve action'
                });
            }

            var reportRecords = nk.storageRead([{
                collection: 'chat_reports',
                key: data.report_id,
                userId: '00000000-0000-0000-0000-000000000000'
            }]);

            if (!reportRecords || reportRecords.length === 0) {
                return JSON.stringify({ success: false, error: 'Report not found' });
            }

            var report = reportRecords[0].value;
            report.status = 'resolved';
            report.reviewed_at = new Date().toISOString();
            report.reviewed_by = ctx.userId || 'admin';
            report.action_taken = data.resolution;
            report.resolution_notes = data.notes || '';

            nk.storageWrite([{
                collection: 'chat_reports',
                key: data.report_id,
                userId: '00000000-0000-0000-0000-000000000000',
                value: report,
                permissionRead: 1,
                permissionWrite: 0
            }]);

            // Execute action if needed
            if (data.resolution === 'ban' && report.reported_user_id) {
                try {
                    nk.usersBanId([report.reported_user_id]);
                    logger.warn('[Moderation] Banned user: ' + report.reported_user_id);
                } catch (banErr) {
                    logger.error('[Moderation] Ban failed: ' + banErr.message);
                }
            }

            return JSON.stringify({
                success: true,
                report_id: data.report_id,
                new_status: 'resolved',
                action_taken: data.resolution
            });
        }

        return JSON.stringify({ success: false, error: 'Unknown action. Use "list" or "resolve".' });

    } catch (err) {
        logger.error('[Moderation] chat_moderation_review error: ' + err.message);
        logRpcError(nk, logger, 'chat_moderation_review', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: "internal_error" });
    }
}

/**
 * RPC: chat_moderation_stats
 * Returns moderation statistics: total reports, pending, resolved, top reported users, etc.
 */
function rpcChatModerationStats(ctx, logger, nk, payload) {
    logger.info('[Moderation] chat_moderation_stats called');

    // P0-3: admin gate. Stats reveal counts and top-reported users —
    // useful intel for an attacker mapping which users to escalate against.
    var denial = modRequireAdmin(ctx);
    if (denial) return denial;

    try {
        var records = nk.storageList('00000000-0000-0000-0000-000000000000', 'chat_reports', 100, '');
        var allRecords = records;
        if (typeof records === 'object' && records.objects) {
            allRecords = records.objects;
        }

        var stats = {
            total_reports: 0,
            pending: 0,
            auto_flagged_severe: 0,
            resolved: 0,
            by_reason: {},
            by_channel_type: {},
            top_reported_users: {},
            profanity_detections: 0,
            spam_detections: 0
        };

        for (var i = 0; i < allRecords.length; i++) {
            var r = allRecords[i].value;
            if (!r) continue;

            stats.total_reports++;
            if (r.status === 'pending') stats.pending++;
            else if (r.status === 'auto_flagged_severe') stats.auto_flagged_severe++;
            else if (r.status === 'resolved') stats.resolved++;

            if (r.reason) {
                stats.by_reason[r.reason] = (stats.by_reason[r.reason] || 0) + 1;
            }
            if (r.channel_type) {
                stats.by_channel_type[r.channel_type] = (stats.by_channel_type[r.channel_type] || 0) + 1;
            }
            if (r.reported_user_id) {
                stats.top_reported_users[r.reported_user_id] = (stats.top_reported_users[r.reported_user_id] || 0) + 1;
            }
            if (r.auto_analysis) {
                if (r.auto_analysis.profanity && r.auto_analysis.profanity.flagged) stats.profanity_detections++;
                if (r.auto_analysis.spam && r.auto_analysis.spam.flagged) stats.spam_detections++;
            }
        }

        // Sort top reported users
        var sortedUsers = [];
        for (var uid in stats.top_reported_users) {
            sortedUsers.push({ user_id: uid, reports: stats.top_reported_users[uid] });
        }
        sortedUsers.sort(function(a, b) { return b.reports - a.reports; });
        stats.top_reported_users = sortedUsers.slice(0, 10);

        return JSON.stringify({
            success: true,
            stats: stats
        });

    } catch (err) {
        logger.error('[Moderation] chat_moderation_stats error: ' + err.message);
        logRpcError(nk, logger, 'chat_moderation_stats', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: "internal_error" });
    }
}

/**
 * RPC: chat_filter_message
 * Check a message against the word filter before sending.
 * Returns filtered text and flags. Can be called inline by clients before posting.
 */
function rpcChatFilterMessage(ctx, logger, nk, payload) {
    logger.info('[Moderation] chat_filter_message called');

    try {
        var data = JSON.parse(payload || '{}');

        if (!data.message) {
            return JSON.stringify({ success: false, error: 'message is required' });
        }

        var profanityResult = checkProfanity(data.message);
        var spamResult = checkSpam(data.message);
        var filteredText = filterMessage(data.message);

        var allowed = true;
        if (profanityResult.severity === 'severe') allowed = false;
        if (spamResult.flags.length > 2) allowed = false;

        return JSON.stringify({
            success: true,
            original: data.message,
            filtered: filteredText,
            allowed: allowed,
            profanity: profanityResult,
            spam: spamResult
        });

    } catch (err) {
        logger.error('[Moderation] chat_filter_message error: ' + err.message);
        return JSON.stringify({ success: false, error: "internal_error" });
    }
}

// ============================================================================
// MODULE INIT (postbuild AST hook) — P0-2 fix
// ----------------------------------------------------------------------------
// postbuild.js renames this `InitModule` to `__ModuleInit_N` and lifts every
// literal initializer.registerRpc call inside it into the master InitModule.
// Keep registrations as direct literal calls (no helpers, no loops) or the
// AST walker in runtime_javascript_init.go will not see them.
//
// Admin RPCs ARE registered here but are protected by modRequireAdmin().
// Without ADMIN_USER_IDS in the runtime env, they all return admin_required.
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("chat_filter_message",     rpcChatFilterMessage);     // public
    initializer.registerRpc("chat_report_message",     rpcChatReportMessage);     // public (creates a report)
    initializer.registerRpc("chat_moderation_review",  rpcChatModerationReview);  // admin-gated
    initializer.registerRpc("chat_moderation_stats",   rpcChatModerationStats);   // admin-gated
    logger.info("[Moderation] Module InitModule registered: 4 RPCs (2 public, 2 admin-gated)");
}
