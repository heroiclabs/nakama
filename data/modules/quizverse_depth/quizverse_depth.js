// quizverse_depth.js - Deep QuizVerse RPCs: Knowledge Maps, Streaks, Adaptive Difficulty, and more
// Nakama V8 JavaScript runtime (No ES Modules)

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function qvdParsePayload(payload, requiredFields) {
    var data = {};
    try {
        data = JSON.parse(payload || "{}");
    } catch (e) {
        throw Error("Invalid JSON payload");
    }
    for (var i = 0; i < requiredFields.length; i++) {
        if (data[requiredFields[i]] === undefined || data[requiredFields[i]] === null) {
            throw Error("Missing required field: " + requiredFields[i]);
        }
    }
    return data;
}

function qvdStorageRead(nk, collection, key, userId) {
    var records = nk.storageRead([{ collection: collection, key: key, userId: userId }]);
    if (records && records.length > 0 && records[0].value) {
        return records[0].value;
    }
    return null;
}

function qvdStorageWrite(nk, collection, key, userId, value) {
    nk.storageWrite([{
        collection: collection,
        key: key,
        userId: userId,
        value: value,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function qvdTodayKey() {
    var now = new Date();
    var y = now.getUTCFullYear();
    var m = ("0" + (now.getUTCMonth() + 1)).slice(-2);
    var d = ("0" + now.getUTCDate()).slice(-2);
    return y + "-" + m + "-" + d;
}

// ============================================================================
// 1. KNOWLEDGE MAP
// ============================================================================

function rpcQuizverseKnowledgeMap(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_quiz_history";

        var history = qvdStorageRead(nk, collection, "history", userId);
        if (!history || !history.entries) {
            return JSON.stringify({
                success: true,
                categories: {},
                overall_coverage_pct: 0,
                strongest: null,
                weakest: null,
                total_quizzes: 0
            });
        }

        var cats = {};
        var totalQuizzes = history.entries.length;

        for (var i = 0; i < history.entries.length; i++) {
            var entry = history.entries[i];
            var cat = entry.category || "general";
            if (!cats[cat]) {
                cats[cat] = { total_questions: 0, correct: 0, total_time_ms: 0 };
            }
            cats[cat].total_questions += 1;
            if (entry.correct) {
                cats[cat].correct += 1;
            }
            cats[cat].total_time_ms += (entry.time_ms || 0);
        }

        var strongest = null;
        var weakest = null;
        var highAcc = -1;
        var lowAcc = 101;
        var catKeys = Object.keys(cats);

        for (var j = 0; j < catKeys.length; j++) {
            var k = catKeys[j];
            var c = cats[k];
            var acc = c.total_questions > 0 ? Math.round((c.correct / c.total_questions) * 100) : 0;
            var avgTime = c.total_questions > 0 ? Math.round(c.total_time_ms / c.total_questions) : 0;

            var level = "weak";
            if (acc >= 90) {
                level = "expert";
            } else if (acc >= 70) {
                level = "strong";
            } else if (acc >= 40) {
                level = "moderate";
            }

            cats[k] = {
                total_questions: c.total_questions,
                correct: c.correct,
                accuracy_pct: acc,
                avg_time_ms: avgTime,
                strength_level: level
            };

            if (acc > highAcc) { highAcc = acc; strongest = k; }
            if (acc < lowAcc) { lowAcc = acc; weakest = k; }
        }

        var knownCategories = catKeys.length;
        var assumedTotal = Math.max(knownCategories, 10);
        var coveragePct = Math.round((knownCategories / assumedTotal) * 100);

        return JSON.stringify({
            success: true,
            categories: cats,
            overall_coverage_pct: coveragePct,
            strongest: strongest,
            weakest: weakest,
            total_quizzes: totalQuizzes
        });

    } catch (err) {
        logger.error("rpcQuizverseKnowledgeMap error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 2. STREAK QUIZ
// ============================================================================

function rpcQuizverseStreakQuiz(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_streak_quizzes";

        var streak = qvdStorageRead(nk, collection, "current", userId) || {
            current_streak: 0,
            best_streak: 0,
            alive: false
        };

        var reward = null;

        if (data.action === "start") {
            streak.current_streak = 0;
            streak.alive = true;

        } else if (data.action === "answer") {
            if (!streak.alive) {
                return JSON.stringify({ success: false, error: "No active streak session" });
            }
            if (data.answer_correct) {
                streak.current_streak += 1;
            } else {
                streak.alive = false;
            }

        } else if (data.action === "end") {
            streak.alive = false;
            if (streak.current_streak > streak.best_streak) {
                streak.best_streak = streak.current_streak;
            }
            var coins = streak.current_streak * 10;
            if (coins > 0) {
                nk.walletUpdate(userId, { coins: coins }, { reason: "streak_reward", streak: streak.current_streak }, true);
                reward = { coins: coins };
            }

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use start, answer, or end" });
        }

        qvdStorageWrite(nk, collection, "current", userId, streak);

        return JSON.stringify({
            success: true,
            current_streak: streak.current_streak,
            best_streak: streak.best_streak,
            alive: streak.alive,
            reward: reward
        });

    } catch (err) {
        logger.error("rpcQuizverseStreakQuiz error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 3. ADAPTIVE DIFFICULTY
// ============================================================================

function rpcQuizverseAdaptiveDifficulty(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "category", "recent_accuracy"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var category = data.category;
        var recentAccuracy = data.recent_accuracy;
        var collection = gameId + "_adaptive_difficulty";

        var record = qvdStorageRead(nk, collection, category, userId) || {
            difficulty: 5,
            history: []
        };

        var currentDiff = record.difficulty;
        var newDiff = currentDiff;

        if (recentAccuracy < 40) {
            newDiff = Math.max(1, currentDiff - 1);
        } else if (recentAccuracy > 70) {
            newDiff = Math.min(10, currentDiff + 1);
        }

        record.difficulty = newDiff;
        record.history.push({ accuracy: recentAccuracy, difficulty: newDiff, timestamp: Date.now() });
        if (record.history.length > 50) {
            record.history = record.history.slice(-50);
        }

        qvdStorageWrite(nk, collection, category, userId, record);

        var playerLevel = "beginner";
        if (newDiff >= 8) {
            playerLevel = "expert";
        } else if (newDiff >= 5) {
            playerLevel = "intermediate";
        }

        return JSON.stringify({
            success: true,
            recommended_difficulty: newDiff,
            category: category,
            player_level: playerLevel
        });

    } catch (err) {
        logger.error("rpcQuizverseAdaptiveDifficulty error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 4. DAILY PUZZLE
// ============================================================================

function rpcQuizverseDailyPuzzle(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var today = qvdTodayKey();
        var collection = gameId + "_daily_puzzles";
        var leaderboardId = gameId + "_daily_puzzle_leaderboard";

        if (data.action === "get") {
            var puzzle = qvdStorageRead(nk, collection, today, userId);
            if (!puzzle) {
                var seed = 0;
                for (var i = 0; i < today.length; i++) {
                    seed += today.charCodeAt(i);
                }
                puzzle = {
                    date: today,
                    seed: seed,
                    puzzle_type: ["word_scramble", "logic", "trivia", "pattern"][seed % 4],
                    difficulty: (seed % 5) + 1,
                    completed: false,
                    created_at: Date.now()
                };
                qvdStorageWrite(nk, collection, today, userId, puzzle);
            }

            return JSON.stringify({
                success: true,
                puzzle: puzzle
            });

        } else if (data.action === "submit") {
            if (!data.solve_time_ms) {
                return JSON.stringify({ success: false, error: "solve_time_ms required for submit" });
            }

            var existing = qvdStorageRead(nk, collection, today, userId);
            if (existing && existing.completed) {
                return JSON.stringify({ success: false, error: "Already submitted today" });
            }

            var solveTime = data.solve_time_ms;
            var score = Math.max(0, 100000 - solveTime);

            try {
                nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", score, 0, { date: today, solve_time_ms: solveTime });
            } catch (lbErr) {
                logger.warn("Leaderboard write failed (may not exist): " + lbErr.message);
            }

            var result = {
                date: today,
                solve_time_ms: solveTime,
                score: score,
                completed: true,
                completed_at: Date.now()
            };
            qvdStorageWrite(nk, collection, today, userId, result);

            return JSON.stringify({
                success: true,
                result: result
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use get or submit" });
        }

    } catch (err) {
        logger.error("rpcQuizverseDailyPuzzle error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 5. CATEGORY WAR
// ============================================================================

function rpcQuizverseCategoryWar(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_category_wars";
        var today = qvdTodayKey();
        var warKey = "war_" + today;

        var war = qvdStorageRead(nk, collection, warKey, "00000000-0000-0000-0000-000000000000");
        if (!war) {
            var seed = 0;
            for (var s = 0; s < today.length; s++) {
                seed += today.charCodeAt(s);
            }
            var allCats = ["science", "history", "geography", "entertainment", "sports", "technology", "art", "literature"];
            var catA = allCats[seed % allCats.length];
            var catB = allCats[(seed + 3) % allCats.length];
            if (catA === catB) { catB = allCats[(seed + 5) % allCats.length]; }

            war = {
                war_id: warKey,
                categories: [catA, catB],
                scores: {},
                players: {},
                created_at: Date.now(),
                expires_at: Date.now() + 86400000
            };
            war.scores[catA] = 0;
            war.scores[catB] = 0;
        }

        if (data.action === "get_status") {
            var mySide = (war.players && war.players[userId]) ? war.players[userId] : null;
            return JSON.stringify({
                success: true,
                war_id: war.war_id,
                categories: war.categories,
                scores: war.scores,
                your_side: mySide,
                time_remaining: Math.max(0, war.expires_at - Date.now())
            });

        } else if (data.action === "join") {
            if (!data.category_choice) {
                return JSON.stringify({ success: false, error: "category_choice required" });
            }
            if (war.categories.indexOf(data.category_choice) === -1) {
                return JSON.stringify({ success: false, error: "Invalid category. Choose one of: " + war.categories.join(", ") });
            }
            if (!war.players) { war.players = {}; }
            war.players[userId] = data.category_choice;

            qvdStorageWrite(nk, collection, warKey, "00000000-0000-0000-0000-000000000000", war);

            return JSON.stringify({
                success: true,
                war_id: war.war_id,
                categories: war.categories,
                scores: war.scores,
                your_side: data.category_choice,
                time_remaining: Math.max(0, war.expires_at - Date.now())
            });

        } else if (data.action === "submit_score") {
            if (!data.score) {
                return JSON.stringify({ success: false, error: "score required" });
            }
            var playerSide = war.players ? war.players[userId] : null;
            if (!playerSide) {
                return JSON.stringify({ success: false, error: "Must join a side first" });
            }
            war.scores[playerSide] = (war.scores[playerSide] || 0) + data.score;

            qvdStorageWrite(nk, collection, warKey, "00000000-0000-0000-0000-000000000000", war);

            return JSON.stringify({
                success: true,
                war_id: war.war_id,
                categories: war.categories,
                scores: war.scores,
                your_side: playerSide,
                time_remaining: Math.max(0, war.expires_at - Date.now())
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use get_status, join, or submit_score" });
        }

    } catch (err) {
        logger.error("rpcQuizverseCategoryWar error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 6. KNOWLEDGE DUEL
// ============================================================================

function rpcQuizverseKnowledgeDuel(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_knowledge_duels";

        if (data.action === "create") {
            if (!data.opponent_id) {
                return JSON.stringify({ success: false, error: "opponent_id required" });
            }
            var duelId = gameId + "_duel_" + userId.substring(0, 8) + "_" + Date.now();
            var duel = {
                duel_id: duelId,
                creator: userId,
                opponent: data.opponent_id,
                status: "pending",
                scores: {},
                created_at: Date.now(),
                expires_at: Date.now() + 3600000
            };
            duel.scores[userId] = null;
            duel.scores[data.opponent_id] = null;

            qvdStorageWrite(nk, collection, duelId, userId, duel);

            try {
                nk.notificationSend(
                    data.opponent_id,
                    "Knowledge Duel Challenge",
                    2,
                    { duel_id: duelId, challenger: userId, challenger_name: ctx.username || "Unknown" },
                    userId
                );
            } catch (notifErr) {
                logger.warn("Could not send duel notification: " + notifErr.message);
            }

            return JSON.stringify({
                success: true,
                duel_id: duelId,
                status: "pending",
                your_score: null,
                opponent_score: null,
                winner: null
            });

        } else if (data.action === "join") {
            if (!data.duel_id) {
                return JSON.stringify({ success: false, error: "duel_id required" });
            }
            var records = nk.storageRead([{ collection: collection, key: data.duel_id, userId: "*" }]);
            var joinDuel = null;
            if (records && records.length > 0) {
                joinDuel = records[0].value;
            }
            if (!joinDuel) {
                return JSON.stringify({ success: false, error: "Duel not found" });
            }
            if (joinDuel.opponent !== userId) {
                return JSON.stringify({ success: false, error: "You are not the invited opponent" });
            }
            joinDuel.status = "active";
            qvdStorageWrite(nk, collection, data.duel_id, joinDuel.creator, joinDuel);

            return JSON.stringify({
                success: true,
                duel_id: joinDuel.duel_id,
                status: "active",
                your_score: null,
                opponent_score: null,
                winner: null
            });

        } else if (data.action === "submit") {
            if (!data.duel_id || data.score === undefined) {
                return JSON.stringify({ success: false, error: "duel_id and score required" });
            }
            var subRecords = nk.storageRead([{ collection: collection, key: data.duel_id, userId: "*" }]);
            var subDuel = null;
            var storageOwner = null;
            if (subRecords && subRecords.length > 0) {
                subDuel = subRecords[0].value;
                storageOwner = subRecords[0].userId;
            }
            if (!subDuel) {
                return JSON.stringify({ success: false, error: "Duel not found" });
            }
            subDuel.scores[userId] = data.score;

            var winner = null;
            if (subDuel.scores[subDuel.creator] !== null && subDuel.scores[subDuel.opponent] !== null) {
                subDuel.status = "completed";
                if (subDuel.scores[subDuel.creator] > subDuel.scores[subDuel.opponent]) {
                    winner = subDuel.creator;
                } else if (subDuel.scores[subDuel.opponent] > subDuel.scores[subDuel.creator]) {
                    winner = subDuel.opponent;
                } else {
                    winner = "draw";
                }
                subDuel.winner = winner;

                var loserId = winner === subDuel.creator ? subDuel.opponent : subDuel.creator;
                if (winner !== "draw") {
                    nk.walletUpdate(winner, { coins: 50 }, { reason: "duel_win", duel_id: subDuel.duel_id }, true);
                    try {
                        nk.notificationSend(loserId, "Duel Result", 3, { duel_id: subDuel.duel_id, result: "lost" }, winner);
                        nk.notificationSend(winner, "Duel Result", 3, { duel_id: subDuel.duel_id, result: "won" }, loserId);
                    } catch (nErr) {
                        logger.warn("Duel result notification failed: " + nErr.message);
                    }
                }
            }

            qvdStorageWrite(nk, collection, data.duel_id, storageOwner || subDuel.creator, subDuel);

            var myScore = subDuel.scores[userId];
            var oppId = userId === subDuel.creator ? subDuel.opponent : subDuel.creator;
            var oppScore = subDuel.scores[oppId];

            return JSON.stringify({
                success: true,
                duel_id: subDuel.duel_id,
                status: subDuel.status,
                your_score: myScore,
                opponent_score: oppScore,
                winner: winner
            });

        } else if (data.action === "result") {
            if (!data.duel_id) {
                return JSON.stringify({ success: false, error: "duel_id required" });
            }
            var resRecords = nk.storageRead([{ collection: collection, key: data.duel_id, userId: "*" }]);
            var resDuel = null;
            if (resRecords && resRecords.length > 0) {
                resDuel = resRecords[0].value;
            }
            if (!resDuel) {
                return JSON.stringify({ success: false, error: "Duel not found" });
            }
            var resOppId = userId === resDuel.creator ? resDuel.opponent : resDuel.creator;

            return JSON.stringify({
                success: true,
                duel_id: resDuel.duel_id,
                status: resDuel.status,
                your_score: resDuel.scores[userId],
                opponent_score: resDuel.scores[resOppId],
                winner: resDuel.winner || null
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use create, join, submit, or result" });
        }

    } catch (err) {
        logger.error("rpcQuizverseKnowledgeDuel error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 7. STUDY MODE
// ============================================================================

function rpcQuizverseStudyMode(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_study_progress";

        var progress = qvdStorageRead(nk, collection, "progress", userId) || {
            wrong_answers: [],
            attempts: {},
            started_at: Date.now()
        };

        if (data.action === "get_weak_areas") {
            var weakMap = {};
            for (var i = 0; i < progress.wrong_answers.length; i++) {
                var wa = progress.wrong_answers[i];
                var cat = wa.category || "general";
                if (!weakMap[cat]) {
                    weakMap[cat] = { wrong_count: 0, questions: [] };
                }
                weakMap[cat].wrong_count += 1;
                weakMap[cat].questions.push(wa.question_id);
            }

            var weakAreas = [];
            var wKeys = Object.keys(weakMap);
            for (var w = 0; w < wKeys.length; w++) {
                weakAreas.push({
                    category: wKeys[w],
                    wrong_count: weakMap[wKeys[w]].wrong_count,
                    question_ids: weakMap[wKeys[w]].questions
                });
            }
            weakAreas.sort(function(a, b) { return b.wrong_count - a.wrong_count; });

            return JSON.stringify({
                success: true,
                weak_areas: weakAreas,
                total_wrong: progress.wrong_answers.length
            });

        } else if (data.action === "record_attempt") {
            if (!data.question_id) {
                return JSON.stringify({ success: false, error: "question_id required" });
            }
            var qid = data.question_id;
            if (!progress.attempts[qid]) {
                progress.attempts[qid] = { total: 0, correct: 0 };
            }
            progress.attempts[qid].total += 1;

            if (data.was_correct) {
                progress.attempts[qid].correct += 1;
                progress.wrong_answers = progress.wrong_answers.filter(function(item) {
                    return item.question_id !== qid;
                });
            } else {
                var alreadyTracked = false;
                for (var a = 0; a < progress.wrong_answers.length; a++) {
                    if (progress.wrong_answers[a].question_id === qid) {
                        alreadyTracked = true;
                        break;
                    }
                }
                if (!alreadyTracked) {
                    progress.wrong_answers.push({
                        question_id: qid,
                        category: data.category || "general",
                        added_at: Date.now()
                    });
                }
            }

            qvdStorageWrite(nk, collection, "progress", userId, progress);

            return JSON.stringify({
                success: true,
                question_id: qid,
                attempts: progress.attempts[qid],
                remaining_weak: progress.wrong_answers.length
            });

        } else if (data.action === "get_improvement") {
            var totalAttempts = 0;
            var totalCorrect = 0;
            var attemptKeys = Object.keys(progress.attempts);
            for (var t = 0; t < attemptKeys.length; t++) {
                var att = progress.attempts[attemptKeys[t]];
                totalAttempts += att.total;
                totalCorrect += att.correct;
            }
            var improvementPct = totalAttempts > 0 ? Math.round((totalCorrect / totalAttempts) * 100) : 0;

            return JSON.stringify({
                success: true,
                total_questions_studied: attemptKeys.length,
                total_attempts: totalAttempts,
                total_correct: totalCorrect,
                accuracy_pct: improvementPct,
                remaining_weak: progress.wrong_answers.length,
                study_duration_ms: Date.now() - (progress.started_at || Date.now())
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use get_weak_areas, record_attempt, or get_improvement" });
        }

    } catch (err) {
        logger.error("rpcQuizverseStudyMode error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// 8. TRIVIA NIGHT
// ============================================================================

function rpcQuizverseTriviaNight(ctx, logger, nk, payload) {
    try {
        var data = qvdParsePayload(payload, ["game_id", "action"]);
        var userId = ctx.userId;
        var gameId = data.game_id;
        var collection = gameId + "_trivia_nights";
        var systemUser = "00000000-0000-0000-0000-000000000000";

        if (data.action === "schedule") {
            var eventId = gameId + "_trivia_" + Date.now();
            var scheduledAt = data.scheduled_at || (Date.now() + 3600000);
            var eventData = {
                event_id: eventId,
                title: data.title || "Trivia Night",
                scheduled_at: scheduledAt,
                status: "upcoming",
                registered_players: [],
                scores: {},
                category: data.category || "mixed",
                created_by: userId,
                created_at: Date.now()
            };

            qvdStorageWrite(nk, collection, eventId, systemUser, eventData);

            return JSON.stringify({
                success: true,
                event_id: eventId,
                scheduled_at: scheduledAt,
                status: "upcoming"
            });

        } else if (data.action === "get_upcoming") {
            var upcoming = qvdStorageRead(nk, collection, "upcoming_index", systemUser) || { events: [] };
            var now = Date.now();
            var active = [];
            for (var i = 0; i < upcoming.events.length; i++) {
                if (upcoming.events[i].scheduled_at > now || upcoming.events[i].status === "active") {
                    active.push(upcoming.events[i]);
                }
            }

            return JSON.stringify({
                success: true,
                events: active
            });

        } else if (data.action === "register") {
            if (!data.event_id) {
                return JSON.stringify({ success: false, error: "event_id required" });
            }
            var regEvent = qvdStorageRead(nk, collection, data.event_id, systemUser);
            if (!regEvent) {
                return JSON.stringify({ success: false, error: "Event not found" });
            }
            if (!regEvent.registered_players) {
                regEvent.registered_players = [];
            }
            var alreadyRegistered = false;
            for (var r = 0; r < regEvent.registered_players.length; r++) {
                if (regEvent.registered_players[r] === userId) {
                    alreadyRegistered = true;
                    break;
                }
            }
            if (!alreadyRegistered) {
                regEvent.registered_players.push(userId);
                qvdStorageWrite(nk, collection, data.event_id, systemUser, regEvent);
            }

            return JSON.stringify({
                success: true,
                event_id: data.event_id,
                registered: true,
                total_registered: regEvent.registered_players.length
            });

        } else if (data.action === "submit_score") {
            if (!data.event_id || data.score === undefined) {
                return JSON.stringify({ success: false, error: "event_id and score required" });
            }
            var scoreEvent = qvdStorageRead(nk, collection, data.event_id, systemUser);
            if (!scoreEvent) {
                return JSON.stringify({ success: false, error: "Event not found" });
            }
            if (!scoreEvent.scores) { scoreEvent.scores = {}; }
            scoreEvent.scores[userId] = data.score;

            qvdStorageWrite(nk, collection, data.event_id, systemUser, scoreEvent);

            var leaderboardId = gameId + "_trivia_" + data.event_id;
            try {
                nk.leaderboardRecordWrite(leaderboardId, userId, ctx.username || "", data.score, 0, { event_id: data.event_id });
            } catch (lbErr) {
                logger.warn("Trivia leaderboard write failed: " + lbErr.message);
            }

            return JSON.stringify({
                success: true,
                event_id: data.event_id,
                your_score: data.score,
                total_participants: Object.keys(scoreEvent.scores).length
            });

        } else {
            return JSON.stringify({ success: false, error: "Invalid action. Use schedule, get_upcoming, register, or submit_score" });
        }

    } catch (err) {
        logger.error("rpcQuizverseTriviaNight error: " + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// REGISTRATION
// ============================================================================

function registerQuizverseDepthRPCs(initializer, logger) {
    logger.info("[QuizverseDepth] Initializing QuizVerse Depth RPCs...");

    if (!globalThis.__registeredRPCs) {
        globalThis.__registeredRPCs = new Set();
    }

    var rpcs = [
        { id: "quizverse_knowledge_map", handler: rpcQuizverseKnowledgeMap },
        { id: "quizverse_streak_quiz", handler: rpcQuizverseStreakQuiz },
        { id: "quizverse_adaptive_difficulty", handler: rpcQuizverseAdaptiveDifficulty },
        { id: "quizverse_daily_puzzle", handler: rpcQuizverseDailyPuzzle },
        { id: "quizverse_category_war", handler: rpcQuizverseCategoryWar },
        { id: "quizverse_knowledge_duel", handler: rpcQuizverseKnowledgeDuel },
        { id: "quizverse_study_mode", handler: rpcQuizverseStudyMode },
        { id: "quizverse_trivia_night", handler: rpcQuizverseTriviaNight }
    ];

    var registered = 0;
    var skipped = 0;

    for (var i = 0; i < rpcs.length; i++) {
        var rpc = rpcs[i];
        if (!globalThis.__registeredRPCs.has(rpc.id)) {
            try {
                initializer.registerRpc(rpc.id, rpc.handler);
                globalThis.__registeredRPCs.add(rpc.id);
                logger.info("[QuizverseDepth] Registered RPC: " + rpc.id);
                registered++;
            } catch (err) {
                logger.error("[QuizverseDepth] Failed to register " + rpc.id + ": " + err.message);
            }
        } else {
            logger.info("[QuizverseDepth] Skipped (already registered): " + rpc.id);
            skipped++;
        }
    }

    logger.info("[QuizverseDepth] Registration complete: " + registered + " registered, " + skipped + " skipped");
}
