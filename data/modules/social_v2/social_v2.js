// social_v2.js - Social features: challenges, rivalries, teams, duos, group quests
// Compatible with Nakama JavaScript runtime (no ES modules)

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// Notification codes (arbitrary ints, must be > 0)
var NOTIFY_CHALLENGE_ACCEPTED = 100;
var NOTIFY_CHALLENGE_DECLINED = 101;
var NOTIFY_CHALLENGE_RECEIVED = 102;
var NOTIFY_DUO_INVITE = 110;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateUUID() {
    var d = new Date().getTime();
    var d2 = (typeof performance !== 'undefined' && performance.now && (performance.now() * 1000)) || 0;
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16;
        if (d > 0) {
            r = (d + r) % 16 | 0;
            d = Math.floor(d / 16);
        } else {
            r = (d2 + r) % 16 | 0;
            d2 = Math.floor(d2 / 16);
        }
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

function nowISO() {
    return new Date().toISOString();
}

function safeRead(nk, collection, key, userId) {
    try {
        var recs = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
        if (recs && recs.length > 0) return recs[0].value;
    } catch (_) { /* swallow */ }
    return null;
}

function safeWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function generateJoinCode() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var code = "";
    for (var i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ---------------------------------------------------------------------------
// 1. rpcChallengeAccept
// ---------------------------------------------------------------------------

function rpcChallengeAccept(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcChallengeAccept called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.challenge_id) {
            return JSON.stringify({ success: false, error: "challenge_id is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var challenge = safeRead(nk, "challenges", data.challenge_id, SYSTEM_USER_ID);
        if (!challenge) {
            return JSON.stringify({ success: false, error: "Challenge not found" });
        }
        if (challenge.status !== "pending") {
            return JSON.stringify({ success: false, error: "Challenge is not pending" });
        }

        challenge.status = "accepted";
        challenge.accepted_by = userId;
        challenge.accepted_at = nowISO();
        safeWrite(nk, "challenges", data.challenge_id, SYSTEM_USER_ID, challenge);

        try {
            nk.notificationSend(
                challenge.challenger_id,
                "Challenge accepted",
                NOTIFY_CHALLENGE_ACCEPTED,
                { challenge_id: data.challenge_id, accepted_by: userId },
                userId
            );
        } catch (e) {
            logger.warn("[social_v2] notification send failed: " + e.message);
        }

        return JSON.stringify({ success: true, challenge: challenge });
    } catch (err) {
        logger.error("[social_v2] rpcChallengeAccept error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 2. rpcChallengeDecline
// ---------------------------------------------------------------------------

function rpcChallengeDecline(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcChallengeDecline called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.challenge_id) {
            return JSON.stringify({ success: false, error: "challenge_id is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var challenge = safeRead(nk, "challenges", data.challenge_id, SYSTEM_USER_ID);
        if (!challenge) {
            return JSON.stringify({ success: false, error: "Challenge not found" });
        }

        challenge.status = "declined";
        challenge.declined_by = userId;
        challenge.declined_at = nowISO();
        safeWrite(nk, "challenges", data.challenge_id, SYSTEM_USER_ID, challenge);

        try {
            nk.notificationSend(
                challenge.challenger_id,
                "Challenge declined",
                NOTIFY_CHALLENGE_DECLINED,
                { challenge_id: data.challenge_id, declined_by: userId },
                userId
            );
        } catch (e) {
            logger.warn("[social_v2] notification send failed: " + e.message);
        }

        return JSON.stringify({ success: true, challenge: challenge });
    } catch (err) {
        logger.error("[social_v2] rpcChallengeDecline error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 3. rpcChallengeList
// ---------------------------------------------------------------------------

function rpcChallengeList(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcChallengeList called");
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId || SYSTEM_USER_ID;
        var gameId = data.game_id || "";
        var statusFilter = data.status || "";

        var records = [];
        try {
            var result = nk.storageList(userId, "challenges_v2", 100, "");
            if (result && result.length) {
                records = result;
            } else if (result && result.objects) {
                records = result.objects;
            }
        } catch (e) {
            logger.warn("[social_v2] storageList failed: " + e.message);
        }

        var filtered = [];
        for (var i = 0; i < records.length; i++) {
            var val = records[i].value || records[i];
            if (gameId && val.game_id && val.game_id !== gameId) continue;
            if (statusFilter && val.status && val.status !== statusFilter) continue;
            filtered.push(val);
        }

        return JSON.stringify({ success: true, challenges: filtered, count: filtered.length });
    } catch (err) {
        logger.error("[social_v2] rpcChallengeList error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 4. rpcGetRivalry
// ---------------------------------------------------------------------------

function rpcGetRivalry(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcGetRivalry called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.target_user_id) {
            return JSON.stringify({ success: false, error: "target_user_id is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var gameId = data.game_id || "";
        var pairKey = [userId, data.target_user_id].sort().join(":");
        var key = "rivalry:" + gameId + ":" + pairKey;

        var rivalry = safeRead(nk, "rivalries", key, SYSTEM_USER_ID);
        if (!rivalry) {
            return JSON.stringify({
                success: true,
                rivalry: { wins: 0, losses: 0, draws: 0, last_match: null, streak: 0 },
                exists: false
            });
        }

        var perspective = {
            wins: (rivalry.player_a === userId) ? rivalry.a_wins : rivalry.b_wins,
            losses: (rivalry.player_a === userId) ? rivalry.b_wins : rivalry.a_wins,
            draws: rivalry.draws || 0,
            last_match: rivalry.last_match || null,
            streak: rivalry.streak || 0
        };

        return JSON.stringify({ success: true, rivalry: perspective, exists: true });
    } catch (err) {
        logger.error("[social_v2] rpcGetRivalry error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 5. rpcFriendScoreAlert
// ---------------------------------------------------------------------------

function rpcFriendScoreAlert(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcFriendScoreAlert called");
    try {
        var data = JSON.parse(payload || '{}');
        var userId = ctx.userId || SYSTEM_USER_ID;
        var gameId = data.game_id || "";

        var friends = [];
        try {
            var friendsResult = nk.friendsList(userId, 100, 0, "");
            if (friendsResult && friendsResult.friends) {
                friends = friendsResult.friends;
            } else if (friendsResult && friendsResult.length) {
                friends = friendsResult;
            }
        } catch (e) {
            logger.warn("[social_v2] friendsList failed: " + e.message);
            return JSON.stringify({ success: true, alerts: [], message: "Could not retrieve friends" });
        }

        var leaderboardId = "leaderboard_" + gameId;
        var userRecord = null;
        try {
            var ownerRecords = nk.leaderboardRecordsList(leaderboardId, [userId], 1, "", 0);
            if (ownerRecords && ownerRecords.ownerRecords && ownerRecords.ownerRecords.length > 0) {
                userRecord = ownerRecords.ownerRecords[0];
            } else if (ownerRecords && ownerRecords.records && ownerRecords.records.length > 0) {
                userRecord = ownerRecords.records[0];
            }
        } catch (e) {
            logger.warn("[social_v2] leaderboard lookup failed: " + e.message);
        }

        var userScore = userRecord ? (userRecord.score || 0) : 0;
        var alerts = [];

        for (var i = 0; i < friends.length; i++) {
            var friend = friends[i];
            var friendId = friend.user ? friend.user.userId : (friend.userId || friend.id);
            if (!friendId) continue;

            try {
                var friendRecords = nk.leaderboardRecordsList(leaderboardId, [friendId], 1, "", 0);
                var friendRec = null;
                if (friendRecords && friendRecords.ownerRecords && friendRecords.ownerRecords.length > 0) {
                    friendRec = friendRecords.ownerRecords[0];
                } else if (friendRecords && friendRecords.records && friendRecords.records.length > 0) {
                    friendRec = friendRecords.records[0];
                }
                if (friendRec && (friendRec.score || 0) > userScore) {
                    var friendUsername = friend.user ? friend.user.username : (friend.username || "Friend");
                    alerts.push({
                        friend_id: friendId,
                        friend_username: friendUsername,
                        friend_score: friendRec.score,
                        your_score: userScore,
                        difference: friendRec.score - userScore
                    });
                }
            } catch (_) { /* skip friend */ }
        }

        alerts.sort(function (a, b) { return b.difference - a.difference; });

        return JSON.stringify({ success: true, alerts: alerts, count: alerts.length });
    } catch (err) {
        logger.error("[social_v2] rpcFriendScoreAlert error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 6. rpcTeamQuizCreate
// ---------------------------------------------------------------------------

function rpcTeamQuizCreate(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcTeamQuizCreate called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.game_id || !data.team_name) {
            return JSON.stringify({ success: false, error: "game_id and team_name are required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var quizId = generateUUID();
        var joinCode = generateJoinCode();
        var maxMembers = data.max_members || 4;

        var teamQuiz = {
            quiz_id: quizId,
            game_id: data.game_id,
            team_name: data.team_name,
            join_code: joinCode,
            max_members: maxMembers,
            creator_id: userId,
            members: [userId],
            status: "waiting",
            created_at: nowISO()
        };

        safeWrite(nk, "team_quizzes", quizId, SYSTEM_USER_ID, teamQuiz);

        // Also index by join_code for quick lookup
        safeWrite(nk, "team_quiz_codes", joinCode, SYSTEM_USER_ID, { quiz_id: quizId });

        return JSON.stringify({ success: true, quiz_id: quizId, join_code: joinCode, team_quiz: teamQuiz });
    } catch (err) {
        logger.error("[social_v2] rpcTeamQuizCreate error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 7. rpcTeamQuizJoin
// ---------------------------------------------------------------------------

function rpcTeamQuizJoin(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcTeamQuizJoin called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.join_code) {
            return JSON.stringify({ success: false, error: "join_code is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var codeEntry = safeRead(nk, "team_quiz_codes", data.join_code, SYSTEM_USER_ID);
        if (!codeEntry || !codeEntry.quiz_id) {
            return JSON.stringify({ success: false, error: "Invalid join code" });
        }

        var quiz = safeRead(nk, "team_quizzes", codeEntry.quiz_id, SYSTEM_USER_ID);
        if (!quiz) {
            return JSON.stringify({ success: false, error: "Team quiz not found" });
        }
        if (quiz.status !== "waiting") {
            return JSON.stringify({ success: false, error: "Team quiz is no longer accepting members" });
        }
        if (quiz.members.length >= quiz.max_members) {
            return JSON.stringify({ success: false, error: "Team quiz is full" });
        }

        for (var i = 0; i < quiz.members.length; i++) {
            if (quiz.members[i] === userId) {
                return JSON.stringify({ success: false, error: "Already a member of this team quiz" });
            }
        }

        quiz.members.push(userId);
        quiz.updated_at = nowISO();
        safeWrite(nk, "team_quizzes", codeEntry.quiz_id, SYSTEM_USER_ID, quiz);

        return JSON.stringify({ success: true, quiz_id: codeEntry.quiz_id, team_quiz: quiz });
    } catch (err) {
        logger.error("[social_v2] rpcTeamQuizJoin error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 8. rpcDailyDuoCreate
// ---------------------------------------------------------------------------

function rpcDailyDuoCreate(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcDailyDuoCreate called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.game_id || !data.partner_user_id) {
            return JSON.stringify({ success: false, error: "game_id and partner_user_id are required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var duoId = generateUUID();
        var today = nowISO().substring(0, 10);

        var duo = {
            duo_id: duoId,
            game_id: data.game_id,
            creator_id: userId,
            partner_id: data.partner_user_id,
            date: today,
            creator_completed: false,
            partner_completed: false,
            status: "active",
            created_at: nowISO()
        };

        safeWrite(nk, "daily_duos", duoId, SYSTEM_USER_ID, duo);

        try {
            nk.notificationSend(
                data.partner_user_id,
                "You've been invited to a Daily Duo!",
                NOTIFY_DUO_INVITE,
                { duo_id: duoId, game_id: data.game_id, from: userId },
                userId
            );
        } catch (e) {
            logger.warn("[social_v2] duo notification failed: " + e.message);
        }

        return JSON.stringify({ success: true, duo_id: duoId, duo: duo });
    } catch (err) {
        logger.error("[social_v2] rpcDailyDuoCreate error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 9. rpcDailyDuoStatus
// ---------------------------------------------------------------------------

function rpcDailyDuoStatus(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcDailyDuoStatus called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.duo_id) {
            return JSON.stringify({ success: false, error: "duo_id is required" });
        }

        var duo = safeRead(nk, "daily_duos", data.duo_id, SYSTEM_USER_ID);
        if (!duo) {
            return JSON.stringify({ success: false, error: "Daily duo not found" });
        }

        var bothDone = duo.creator_completed && duo.partner_completed;

        return JSON.stringify({
            success: true,
            duo: duo,
            both_completed: bothDone,
            status: bothDone ? "completed" : "in_progress"
        });
    } catch (err) {
        logger.error("[social_v2] rpcDailyDuoStatus error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 10. rpcGroupQuestCreate
// ---------------------------------------------------------------------------

function rpcGroupQuestCreate(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcGroupQuestCreate called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.group_id || !data.quest_name || !data.target_type || !data.target_value) {
            return JSON.stringify({ success: false, error: "group_id, quest_name, target_type, and target_value are required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var questId = generateUUID();
        var durationHours = data.duration_hours || 24;
        var expiresAt = new Date(Date.now() + durationHours * 3600000).toISOString();

        var quest = {
            quest_id: questId,
            group_id: data.group_id,
            quest_name: data.quest_name,
            target_type: data.target_type,
            target_value: Number(data.target_value),
            current_value: 0,
            duration_hours: durationHours,
            expires_at: expiresAt,
            creator_id: userId,
            contributors: {},
            status: "active",
            created_at: nowISO()
        };

        safeWrite(nk, "group_quests", questId, SYSTEM_USER_ID, quest);

        return JSON.stringify({ success: true, quest_id: questId, quest: quest });
    } catch (err) {
        logger.error("[social_v2] rpcGroupQuestCreate error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 11. rpcGroupQuestProgress
// ---------------------------------------------------------------------------

function rpcGroupQuestProgress(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcGroupQuestProgress called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.quest_id) {
            return JSON.stringify({ success: false, error: "quest_id is required" });
        }

        var userId = ctx.userId || SYSTEM_USER_ID;
        var increment = Number(data.increment) || 1;

        var quest = safeRead(nk, "group_quests", data.quest_id, SYSTEM_USER_ID);
        if (!quest) {
            return JSON.stringify({ success: false, error: "Quest not found" });
        }
        if (quest.status !== "active") {
            return JSON.stringify({ success: false, error: "Quest is no longer active" });
        }

        if (new Date(quest.expires_at) < new Date()) {
            quest.status = "expired";
            safeWrite(nk, "group_quests", data.quest_id, SYSTEM_USER_ID, quest);
            return JSON.stringify({ success: false, error: "Quest has expired" });
        }

        quest.current_value += increment;
        quest.contributors[userId] = (quest.contributors[userId] || 0) + increment;
        quest.updated_at = nowISO();

        var justCompleted = false;
        if (quest.current_value >= quest.target_value && quest.status === "active") {
            quest.status = "completed";
            quest.completed_at = nowISO();
            justCompleted = true;
        }

        safeWrite(nk, "group_quests", data.quest_id, SYSTEM_USER_ID, quest);

        // Log activity
        try {
            var activityId = generateUUID();
            safeWrite(nk, "group_activity", activityId, SYSTEM_USER_ID, {
                group_id: quest.group_id,
                user_id: userId,
                action: justCompleted ? "quest_completed" : "quest_progress",
                quest_id: data.quest_id,
                quest_name: quest.quest_name,
                increment: increment,
                new_total: quest.current_value,
                timestamp: nowISO()
            });
        } catch (_) { /* best effort */ }

        return JSON.stringify({
            success: true,
            quest: quest,
            just_completed: justCompleted,
            progress_percent: Math.min(100, Math.floor((quest.current_value / quest.target_value) * 100))
        });
    } catch (err) {
        logger.error("[social_v2] rpcGroupQuestProgress error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ---------------------------------------------------------------------------
// 12. rpcGroupActivityFeed
// ---------------------------------------------------------------------------

function rpcGroupActivityFeed(ctx, logger, nk, payload) {
    logger.info("[social_v2] rpcGroupActivityFeed called");
    try {
        var data = JSON.parse(payload || '{}');
        if (!data.group_id) {
            return JSON.stringify({ success: false, error: "group_id is required" });
        }

        var limit = data.limit || 20;
        if (limit > 100) limit = 100;

        var allRecords = [];
        try {
            var result = nk.storageList(SYSTEM_USER_ID, "group_activity", limit, "");
            if (result && result.objects) {
                allRecords = result.objects;
            } else if (result && result.length) {
                allRecords = result;
            }
        } catch (e) {
            logger.warn("[social_v2] storageList failed: " + e.message);
        }

        var events = [];
        for (var i = 0; i < allRecords.length; i++) {
            var val = allRecords[i].value || allRecords[i];
            if (val.group_id === data.group_id) {
                events.push(val);
            }
        }

        events.sort(function (a, b) {
            return (b.timestamp || "").localeCompare(a.timestamp || "");
        });

        if (events.length > limit) {
            events = events.slice(0, limit);
        }

        return JSON.stringify({ success: true, events: events, count: events.length });
    } catch (err) {
        logger.error("[social_v2] rpcGroupActivityFeed error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}
