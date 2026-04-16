/**
 * Analytics Extended Module
 * Implements 14 analytics RPCs for the dashboard.
 * 
 * RPCs:
 *   - analytics_session_stats
 *   - analytics_quiz_performance
 *   - analytics_funnel
 *   - analytics_ai_features
 *   - analytics_feature_adoption
 *   - analytics_economy_health
 *   - analytics_monetization_detail
 *   - analytics_platform_breakdown
 *   - analytics_home_heatmap
 *   - analytics_top_players
 *   - analytics_error_log
 */

var SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";

// ─── Helpers ──────────────────────────────────────────────

function extSafeJsonParse(payload) {
    try { return JSON.parse(payload || '{}'); } catch (e) { return {}; }
}

function extIsoDate(value) {
    if (!value) return null;
    var parsed = new Date(value);
    if (isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
}

function extDaysSince(value) {
    var dateStr = extIsoDate(value);
    if (!dateStr) return 999;

    var today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    var then = new Date(dateStr + 'T00:00:00.000Z');
    return Math.floor((today.getTime() - then.getTime()) / 86400000);
}

function extNormalizeEvent(val, key) {
    if (!val) return null;

    if (val.event && !val.eventName) {
        val.eventName = val.event;
    }
    if (!val.eventData) {
        if (val.properties) val.eventData = val.properties;
        else if (val.data) val.eventData = val.data;
    }
    if (!val.properties && val.eventData) {
        val.properties = val.eventData;
    }
    if (!val.gameId && val.gameID) {
        val.gameId = val.gameID;
    }
    if (!val.gameId && key) {
        val.gameId = extractGameIdFromKey(key);
    }
    if (!val.date && val.timestamp) {
        val.date = extIsoDate(val.timestamp);
    }

    return val;
}

function extResolveProfile(profile, gameId) {
    if (!profile) return null;
    if (!gameId) return profile;
    if (!profile.games || !profile.games[gameId]) return null;
    return profile.games[gameId];
}

function extProfileFirstSeen(profile) {
    if (!profile) return null;
    if (profile.firstSeenAt) return profile.firstSeenAt;
    if (profile.global && profile.global.firstSeenAt) return profile.global.firstSeenAt;
    if (profile.createdAt) return profile.createdAt;
    return null;
}

function extProfileLastSeen(profile) {
    if (!profile) return null;
    if (profile.lastSeenAt) return profile.lastSeenAt;
    if (profile.engagement && profile.engagement.lastSessionAt) return profile.engagement.lastSessionAt;
    if (profile.global && profile.global.lastSeenAt) return profile.global.lastSeenAt;
    if (profile.updatedAt) return profile.updatedAt;
    return null;
}

function extProfileTotalSpent(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.totalIapSpend || profile.monetization.ltv || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfileTotalSpent(profile.games[gameId]);
            }
        }
        return total;
    }

    return (profile.global && profile.global.totalRevenue) || 0;
}

function extProfilePurchaseCount(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.purchaseCount || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfilePurchaseCount(profile.games[gameId]);
            }
        }
        return total;
    }

    return 0;
}

function extProfileRewardedAds(profile) {
    if (!profile) return 0;

    if (profile.monetization) {
        return profile.monetization.rewardedAdsWatched || 0;
    }

    if (profile.games) {
        var total = 0;
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId)) {
                total += extProfileRewardedAds(profile.games[gameId]);
            }
        }
        return total;
    }

    return 0;
}

function extProfileAdRemovalPurchased(profile) {
    if (!profile) return false;

    if (profile.monetization) {
        return !!profile.monetization.adRemovalPurchased;
    }

    if (profile.games) {
        for (var gameId in profile.games) {
            if (profile.games.hasOwnProperty(gameId) && extProfileAdRemovalPurchased(profile.games[gameId])) {
                return true;
            }
        }
    }

    return false;
}

function extProfileRecentSessions(profile) {
    if (!profile) return 0;

    if (profile.engagement) {
        return profile.engagement.sessionsThisWeek || profile.engagement.totalSessions || 0;
    }

    if (profile.global) {
        return profile.global.totalSessions || 0;
    }

    return 0;
}

function extProfileStreak(profile) {
    if (!profile) return 0;

    if (profile.engagement) {
        return profile.engagement.currentStreak || 0;
    }

    return 0;
}

function extDaysAgo(days) {
    var d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
}

function extStorageRead(nk, collection, key, userId) {
    try {
        var objs = nk.storageRead([{ collection: collection, key: key, userId: userId || SYSTEM_USER_ID }]);
        if (objs && objs.length > 0) return objs[0].value;
    } catch (e) { /* ignore */ }
    return null;
}

function extStorageList(nk, collection, userId, limit) {
    try {
        var result = nk.storageList(userId || SYSTEM_USER_ID, collection, limit || 100, null);
        if (result && result.objects) return result.objects;
    } catch (e) { /* ignore */ }
    return [];
}

// Collections where events are stored (legacy + new)
var EVENT_COLLECTIONS = ['analytics_events', 'analytics_error_events'];

/**
 * Scan events from storage with optional gameId filtering.
 * @param {object} nk - Nakama runtime
 * @param {object} logger - Logger
 * @param {string} collection - Collection name
 * @param {number} days - Days to look back
 * @param {function} filter - Custom filter function
 * @param {string} gameId - Optional gameId to filter (null = all games)
 */
function extScanEvents(nk, logger, collection, days, filter, gameId) {
    var events = [];
    var cutoffDate = extDaysAgo(days);
    
    // Determine which collections to scan
    var collectionsToScan = (collection === 'analytics_events') ? EVENT_COLLECTIONS : [collection];
    
    for (var c = 0; c < collectionsToScan.length; c++) {
        var currentCollection = collectionsToScan[c];
        
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 20;
            
            do {
                var result = nk.storageList(SYSTEM_USER_ID, currentCollection, 100, cursor);
                if (!result || !result.objects) break;
                
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var val = extNormalizeEvent(obj.value, obj.key);
                    if (!val) continue;
                    
                    // GameId filter (supports both key prefix and value.gameId)
                    if (gameId) {
                        var eventGameId = val.gameId || extractGameIdFromKey(obj.key);
                        if (eventGameId !== gameId) continue;
                    }
                    
                    // Date filter
                    var eventDate = val.date || extIsoDate(val.timestamp) || obj.key.slice(-10);
                    if (eventDate && eventDate < cutoffDate) continue;
                    
                    // Custom filter
                    if (filter && !filter(val, obj)) continue;
                    
                    events.push(val);
                }
                
                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] Scan error (' + currentCollection + '): ' + e.message);
        }
    }
    
    return events;
}

/**
 * Extract gameId from storage key format: {gameId}_{eventName}_{timestamp}_{userId}
 */
function extractGameIdFromKey(key) {
    if (!key) return null;
    var parts = key.split('_');
    // Key format: gameId_eventName_timestamp_userId
    // gameId is typically "quizverse", "cricket", etc.
    if (parts.length >= 4) {
        return parts[0];
    }
    return null;
}

/**
 * Get DAU key for a specific gameId or platform-wide
 */
function getDAUKey(dateStr, gameId) {
    if (gameId) {
        return 'dau_' + gameId + '_' + dateStr;
    }
    return 'dau_platform_' + dateStr;
}

function extCountByField(events, field) {
    var counts = {};
    for (var i = 0; i < events.length; i++) {
        var val = events[i][field] || 'unknown';
        counts[val] = (counts[val] || 0) + 1;
    }
    return counts;
}

function extTopN(counts, n, labelKey, countKey) {
    labelKey = labelKey || 'name';
    countKey = countKey || 'count';
    
    var arr = [];
    for (var k in counts) {
        var item = {};
        item[labelKey] = k;
        item[countKey] = counts[k];
        arr.push(item);
    }
    arr.sort(function(a, b) { return b[countKey] - a[countKey]; });
    return arr.slice(0, n || 10);
}

function extMedian(arr) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function extPercentile(arr, p) {
    if (!arr || arr.length === 0) return 0;
    var sorted = arr.slice().sort(function(a, b) { return a - b; });
    var idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
}

// ─── RPC: analytics_session_stats ─────────────────────────

function rpcAnalyticsSessionStats(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var totalSessions = 0;
        var durations = [];
        var hourCounts = {};
        var dailyStats = [];
        
        // Read session summaries from storage (game-specific key if gameId provided)
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var key = gameId 
                ? 'session_stats_' + gameId + '_' + dateStr 
                : 'session_stats_' + dateStr;
            var stats = extStorageRead(nk, 'analytics_sessions', key, SYSTEM_USER_ID);
            
            var daySessions = 0;
            var dayAvgDuration = 0;
            
            if (stats) {
                daySessions = stats.totalSessions || stats.count || 0;
                dayAvgDuration = stats.avgDuration || 0;
                totalSessions += daySessions;
                
                // Add durations for percentile calculation
                if (stats.durations && Array.isArray(stats.durations)) {
                    for (var i = 0; i < stats.durations.length; i++) {
                        durations.push(stats.durations[i]);
                    }
                } else if (dayAvgDuration > 0) {
                    // Estimate durations from average
                    for (var j = 0; j < Math.min(daySessions, 50); j++) {
                        durations.push(dayAvgDuration * (0.5 + Math.random()));
                    }
                }
                
                // Hour distribution
                if (stats.hourDistribution) {
                    for (var h in stats.hourDistribution) {
                        hourCounts[h] = (hourCounts[h] || 0) + stats.hourDistribution[h];
                    }
                }
            }
            
            dailyStats.unshift({
                date: dateStr,
                sessions: daySessions,
                avg_duration: Math.round(dayAvgDuration)
            });
        }
        
        // Calculate metrics
        var avgDuration = durations.length > 0 ? Math.round(durations.reduce(function(a, b) { return a + b; }, 0) / durations.length) : 0;
        var medianDuration = Math.round(extMedian(durations));
        var p95Duration = Math.round(extPercentile(durations, 95));
        var sessionsPerDayAvg = days > 0 ? Math.round(totalSessions / days) : 0;
        
        // Peak hours
        var peakHours = [];
        for (var hour = 0; hour < 24; hour++) {
            peakHours.push({
                hour: hour,
                count: hourCounts[hour.toString()] || hourCounts[hour] || 0
            });
        }
        peakHours.sort(function(a, b) { return b.count - a.count; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            total_sessions: totalSessions,
            avg_duration_seconds: avgDuration,
            median_duration_seconds: medianDuration,
            p95_duration_seconds: p95Duration,
            sessions_per_day_avg: sessionsPerDayAvg,
            peak_hours: peakHours.slice(0, 12),
            daily_breakdown: dailyStats
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] session_stats error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_quiz_performance ──────────────────────

function rpcAnalyticsQuizPerformance(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var quizStarted = 0;
        var quizCompleted = 0;
        var quizAbandoned = 0;
        var hintsUsed = 0;
        var dailyCompleted = 0;
        var totalScore = 0;
        var totalCorrect = 0;
        var totalQuestions = 0;
        var streakSum = 0;
        var streakCount = 0;
        var topicCounts = {};
        var difficultyCounts = {};
        
        // Read quiz stats from storage (game-specific key if gameId provided)
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var key = gameId 
                ? 'quiz_stats_' + gameId + '_' + dateStr 
                : 'quiz_stats_' + dateStr;
            var stats = extStorageRead(nk, 'analytics_quiz', key, SYSTEM_USER_ID);
            
            if (stats) {
                quizStarted += stats.started || 0;
                quizCompleted += stats.completed || 0;
                quizAbandoned += stats.abandoned || 0;
                hintsUsed += stats.hints || 0;
                totalScore += stats.totalScore || 0;
                totalCorrect += stats.correctAnswers || 0;
                totalQuestions += stats.totalQuestions || 0;
                
                if (d === 0) {
                    dailyCompleted = stats.dailyCompleted || stats.completed || 0;
                }
                
                if (stats.avgStreak) {
                    streakSum += stats.avgStreak;
                    streakCount++;
                }
                
                // Topic breakdown
                if (stats.topics) {
                    for (var t in stats.topics) {
                        topicCounts[t] = (topicCounts[t] || 0) + stats.topics[t];
                    }
                }
                
                // Difficulty breakdown
                if (stats.difficulty) {
                    for (var df in stats.difficulty) {
                        difficultyCounts[df] = (difficultyCounts[df] || 0) + stats.difficulty[df];
                    }
                }
            }
        }
        
        // Fallback: scan events collection (with gameId filter)
        if (quizStarted === 0) {
            var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
                return val.eventName && val.eventName.indexOf('quiz') !== -1;
            }, gameId);
            
            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                var evName = ev.eventName || '';
                
                if (evName === 'quiz_started' || evName === 'QuizStarted') quizStarted++;
                if (evName === 'quiz_completed' || evName === 'QuizCompleted') {
                    quizCompleted++;
                    if (ev.eventData) {
                        totalScore += ev.eventData.score || 0;
                        totalCorrect += ev.eventData.correctAnswers || 0;
                        totalQuestions += ev.eventData.totalQuestions || 0;
                        hintsUsed += ev.eventData.hintsUsed || 0;
                        
                        if (ev.eventData.topic) {
                            topicCounts[ev.eventData.topic] = (topicCounts[ev.eventData.topic] || 0) + 1;
                        }
                        if (ev.eventData.difficulty) {
                            difficultyCounts[ev.eventData.difficulty] = (difficultyCounts[ev.eventData.difficulty] || 0) + 1;
                        }
                    }
                }
                if (evName === 'quiz_abandoned' || evName === 'QuizAbandoned') quizAbandoned++;
                if (evName === 'hint_used' || evName === 'HintUsed') hintsUsed++;
                if (evName === 'daily_quiz_completed' || evName === 'DailyQuizCompleted') dailyCompleted++;
            }
        }
        
        // Calculate rates
        var completionRate = quizStarted > 0 ? Math.round((quizCompleted / quizStarted) * 100) : 0;
        var accuracyRate = totalQuestions > 0 ? Math.round((totalCorrect / totalQuestions) * 100) : 0;
        var avgScore = quizCompleted > 0 ? Math.round(totalScore / quizCompleted) : 0;
        var avgStreak = streakCount > 0 ? Math.round(streakSum / streakCount) : 0;
        
        // Convert to arrays
        var topTopics = extTopN(topicCounts, 10, 'topic', 'count');
        var difficultyBreakdown = extTopN(difficultyCounts, 5, 'difficulty', 'count');
        
        return JSON.stringify({
            game_id: gameId || 'all',
            quiz_started: quizStarted,
            quiz_completed: quizCompleted,
            completion_rate_pct: completionRate,
            accuracy_rate_pct: accuracyRate,
            avg_score: avgScore,
            hints_used: hintsUsed,
            daily_completed: dailyCompleted,
            avg_streak: avgStreak,
            quiz_abandoned: quizAbandoned,
            top_topics: topTopics,
            difficulty_breakdown: difficultyBreakdown
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] quiz_performance error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_funnel ────────────────────────────────

function rpcAnalyticsFunnel(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        var funnelType = data.funnel || 'onboarding';
        
        var stepCounts = {};
        var stepOrder = [];
        
        // Define funnel steps by type
        if (funnelType === 'onboarding') {
            stepOrder = ['app_open', 'onboarding_start', 'name_entered', 'avatar_selected', 'tutorial_completed', 'first_quiz_completed'];
        } else if (funnelType === 'quiz') {
            stepOrder = ['quiz_view', 'quiz_started', 'first_answer', 'quiz_completed'];
        } else if (funnelType === 'purchase') {
            stepOrder = ['store_opened', 'product_viewed', 'purchase_started', 'purchase_completed'];
        } else {
            stepOrder = ['step_1', 'step_2', 'step_3', 'step_4'];
        }
        
        // Initialize counts
        for (var i = 0; i < stepOrder.length; i++) {
            stepCounts[stepOrder[i]] = 0;
        }
        
        // Read funnel data (game-specific key if gameId provided)
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var key = gameId 
                ? 'funnel_' + funnelType + '_' + gameId + '_' + dateStr 
                : 'funnel_' + funnelType + '_' + dateStr;
            var stats = extStorageRead(nk, 'analytics_funnel', key, SYSTEM_USER_ID);
            
            if (stats && stats.steps) {
                for (var step in stats.steps) {
                    if (stepCounts.hasOwnProperty(step)) {
                        stepCounts[step] += stats.steps[step];
                    }
                }
            }
        }
        
        // Fallback: scan events (with gameId filter)
        if (stepCounts[stepOrder[0]] === 0) {
            var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);
            
            for (var j = 0; j < events.length; j++) {
                var ev = events[j];
                var evName = (ev.eventName || '').toLowerCase().replace(/([A-Z])/g, '_$1').toLowerCase();
                
                for (var s = 0; s < stepOrder.length; s++) {
                    if (evName.indexOf(stepOrder[s]) !== -1 || evName === stepOrder[s]) {
                        stepCounts[stepOrder[s]]++;
                    }
                }
            }
        }
        
        // Build funnel steps with conversion metrics
        var steps = [];
        var totalFirst = stepCounts[stepOrder[0]] || 1;
        var worstDropOff = { step: '', drop_pct: 0 };
        
        for (var k = 0; k < stepOrder.length; k++) {
            var stepName = stepOrder[k];
            var count = stepCounts[stepName];
            var pctOfTotal = Math.round((count / totalFirst) * 100);
            var previousCount = k > 0 ? stepCounts[stepOrder[k - 1]] : count;
            var pctOfPrevious = previousCount > 0 ? Math.round((count / previousCount) * 100) : 100;
            var dropOffPct = 100 - pctOfPrevious;
            
            steps.push({
                name: stepName.replace(/_/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); }),
                count: count,
                pct_of_total: pctOfTotal,
                pct_of_previous: pctOfPrevious,
                drop_off_pct: dropOffPct
            });
            
            if (dropOffPct > worstDropOff.drop_pct && k > 0) {
                worstDropOff = { step: stepName, drop_pct: dropOffPct };
            }
        }
        
        return JSON.stringify({
            game_id: gameId || 'all',
            steps: steps,
            worst_drop_off: worstDropOff
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] funnel error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_ai_features ───────────────────────────

function rpcAnalyticsAIFeatures(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var totalAIEvents = 0;
        var aiUserSet = {};
        var creditsConsumed = 0;
        var voiceAnswers = 0;
        var featureCounts = {};
        var featureUsers = {};
        
        // Scan AI-related events (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            var evName = (val.eventName || '').toLowerCase();
            return evName.indexOf('ai') !== -1 || evName.indexOf('voice') !== -1 || 
                   evName.indexOf('gemini') !== -1 || evName.indexOf('trivia') !== -1;
        }, gameId);
        
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            totalAIEvents++;
            
            if (ev.userId) {
                aiUserSet[ev.userId] = true;
            }
            
            var evName = ev.eventName || 'ai_event';
            featureCounts[evName] = (featureCounts[evName] || 0) + 1;
            
            if (ev.userId) {
                if (!featureUsers[evName]) featureUsers[evName] = {};
                featureUsers[evName][ev.userId] = true;
            }
            
            if (ev.eventData) {
                creditsConsumed += ev.eventData.credits || ev.eventData.tokensUsed || 0;
                if (evName.indexOf('voice') !== -1) {
                    voiceAnswers++;
                }
            }
        }
        
        var totalAIUsers = Object.keys(aiUserSet).length;
        
        // Read DAU to calculate adoption % (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : (todayDau && todayDau.uniqueUsers) ? todayDau.uniqueUsers : 100;
        var aiAdoptionPct = totalActiveUsers > 0 ? Math.round((totalAIUsers / totalActiveUsers) * 100) : 0;
        
        // Build features array
        var features = [];
        for (var feat in featureCounts) {
            features.push({
                feature: feat,
                events: featureCounts[feat],
                unique_users: featureUsers[feat] ? Object.keys(featureUsers[feat]).length : 0,
                adoption_pct: Math.round(((featureUsers[feat] ? Object.keys(featureUsers[feat]).length : 0) / Math.max(1, totalActiveUsers)) * 100)
            });
        }
        features.sort(function(a, b) { return b.events - a.events; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            total_ai_events: totalAIEvents,
            total_ai_users: totalAIUsers,
            ai_adoption_pct: aiAdoptionPct,
            credits_consumed: creditsConsumed,
            voice_answers: voiceAnswers,
            users_sampled: totalActiveUsers,
            features: features.slice(0, 15)
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] ai_features error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_feature_adoption ──────────────────────

function rpcAnalyticsFeatureAdoption(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        // Define features to track
        var featureDefs = [
            { name: 'Daily Quiz', collection: 'daily_quiz', eventName: 'daily_quiz' },
            { name: 'Multiplayer', collection: 'multiplayer', eventName: 'multiplayer' },
            { name: 'Leaderboard', collection: 'leaderboard', eventName: 'leaderboard' },
            { name: 'Profile Customization', collection: 'profiles', eventName: 'profile' },
            { name: 'Achievements', collection: 'achievements', eventName: 'achievement' },
            { name: 'Friend Quests', collection: 'friend_quests', eventName: 'friend_quest' },
            { name: 'Store', collection: 'store', eventName: 'store' },
            { name: 'Voice Answers', collection: 'voice', eventName: 'voice' },
            { name: 'AI Trivia', collection: 'ai_trivia', eventName: 'ai_trivia' },
            { name: 'Streaks', collection: 'streaks', eventName: 'streak' }
        ];
        
        // Get total active users (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : 100;
        
        var features = [];
        var lowAdoptionFeatures = [];
        
        // Scan events for feature usage (with gameId filter)
        var allEvents = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);
        var featureUserSets = {};
        
        for (var i = 0; i < allEvents.length; i++) {
            var ev = allEvents[i];
            var evName = (ev.eventName || '').toLowerCase();
            
            for (var j = 0; j < featureDefs.length; j++) {
                var feat = featureDefs[j];
                if (evName.indexOf(feat.eventName) !== -1) {
                    if (!featureUserSets[feat.name]) featureUserSets[feat.name] = {};
                    if (ev.userId) featureUserSets[feat.name][ev.userId] = true;
                }
            }
        }
        
        // Build features array
        for (var k = 0; k < featureDefs.length; k++) {
            var f = featureDefs[k];
            var userCount = featureUserSets[f.name] ? Object.keys(featureUserSets[f.name]).length : 0;
            var adoptionPct = Math.round((userCount / Math.max(1, totalActiveUsers)) * 100);
            
            features.push({
                name: f.name,
                users_count: userCount,
                adoption_pct: adoptionPct,
                collection: f.collection
            });
            
            if (adoptionPct < 20 && userCount > 0) {
                lowAdoptionFeatures.push('Boost ' + f.name + ' engagement (' + adoptionPct + '% adoption)');
            }
        }
        
        features.sort(function(a, b) { return b.adoption_pct - a.adoption_pct; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            features: features,
            recommendations: lowAdoptionFeatures.slice(0, 5)
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] feature_adoption error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_economy_health ────────────────────────

function rpcAnalyticsEconomyHealth(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var sampleSize = parseInt(data.sample_size, 10) || 100;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var coinBalances = [];
        var gemBalances = [];
        var sourcesTotal = 0;
        var sinksTotal = 0;
        var whaleCount = 0;
        var whaleThreshold = 10000; // coins
        
        // Read economy stats from storage (game-specific key if gameId provided)
        var economyKey = gameId ? 'economy_stats_' + gameId : 'economy_stats';
        var economyStats = extStorageRead(nk, 'analytics_economy', economyKey, SYSTEM_USER_ID);
        
        if (economyStats) {
            coinBalances = economyStats.coinBalances || [];
            gemBalances = economyStats.gemBalances || [];
            sourcesTotal = economyStats.sources || 0;
            sinksTotal = economyStats.sinks || 0;
        }
        
        // Fallback: scan wallet data (with gameId filter)
        if (coinBalances.length === 0) {
            var walletEvents = extScanEvents(nk, logger, 'analytics_events', 30, function(val) {
                var evName = (val.eventName || '').toLowerCase();
                return evName.indexOf('coin') !== -1 || evName.indexOf('gem') !== -1 || 
                       evName.indexOf('wallet') !== -1 || evName.indexOf('purchase') !== -1;
            }, gameId);
            
            for (var i = 0; i < walletEvents.length; i++) {
                var ev = walletEvents[i];
                var evData = ev.eventData || {};
                
                if (evData.coins !== undefined) {
                    coinBalances.push(Math.abs(evData.coins));
                    if (evData.coins > 0) sourcesTotal += evData.coins;
                    else sinksTotal += Math.abs(evData.coins);
                }
                if (evData.gems !== undefined) {
                    gemBalances.push(Math.abs(evData.gems));
                }
            }
        }
        
        // Calculate metrics
        var totalCoins = coinBalances.reduce(function(a, b) { return a + b; }, 0);
        var totalGems = gemBalances.reduce(function(a, b) { return a + b; }, 0);
        var avgCoins = coinBalances.length > 0 ? Math.round(totalCoins / coinBalances.length) : 0;
        var medianCoins = Math.round(extMedian(coinBalances));
        
        // Count whales
        for (var j = 0; j < coinBalances.length; j++) {
            if (coinBalances[j] > whaleThreshold) whaleCount++;
        }
        
        // Calculate Gini coefficient (inequality measure)
        var gini = 0;
        if (coinBalances.length > 1) {
            var sorted = coinBalances.slice().sort(function(a, b) { return a - b; });
            var n = sorted.length;
            var sumOfDiffs = 0;
            var sumOfBalances = totalCoins;
            
            for (var k = 0; k < n; k++) {
                sumOfDiffs += (2 * (k + 1) - n - 1) * sorted[k];
            }
            
            gini = sumOfBalances > 0 ? Math.round((sumOfDiffs / (n * sumOfBalances)) * 100) / 100 : 0;
        }
        
        var sourceSinkRatio = sinksTotal > 0 ? Math.round((sourcesTotal / sinksTotal) * 100) / 100 : 0;
        
        return JSON.stringify({
            game_id: gameId || 'all',
            gini_coefficient: gini,
            total_coins: totalCoins,
            total_gems: totalGems,
            avg_coins: avgCoins,
            median_coins: medianCoins,
            whale_count: whaleCount,
            sample_size: coinBalances.length,
            source_sink_ratio: {
                ratio: sourceSinkRatio,
                sources_total: sourcesTotal,
                sinks_total: sinksTotal
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] economy_health error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_monetization_detail ───────────────────

function rpcAnalyticsMonetizationDetail(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var adImpressions = 0;
        var adCompleted = 0;
        var adRevenue = 0;
        var iapCompleted = 0;
        var paywallShown = 0;
        var paywallConverted = 0;
        var storeOpens = 0;
        var adTypeCounts = {};
        var dailyAdRevenue = [];
        var productPurchases = {};
        
        // Read monetization stats (game-specific key if gameId provided)
        for (var d = 0; d < days; d++) {
            var dateStr = extDaysAgo(d);
            var key = gameId 
                ? 'monetization_' + gameId + '_' + dateStr 
                : 'monetization_' + dateStr;
            var stats = extStorageRead(nk, 'analytics_monetization', key, SYSTEM_USER_ID);
            
            var dayRevenue = 0;
            
            if (stats) {
                adImpressions += stats.impressions || 0;
                adCompleted += stats.completed || 0;
                dayRevenue = stats.revenue || 0;
                adRevenue += dayRevenue;
                iapCompleted += stats.iap || 0;
                paywallShown += stats.paywallShown || 0;
                paywallConverted += stats.paywallConverted || 0;
                storeOpens += stats.storeOpens || 0;
                
                if (stats.adTypes) {
                    for (var t in stats.adTypes) {
                        adTypeCounts[t] = (adTypeCounts[t] || 0) + stats.adTypes[t];
                    }
                }
                
                if (stats.products) {
                    for (var p in stats.products) {
                        productPurchases[p] = (productPurchases[p] || 0) + stats.products[p];
                    }
                }
            }
            
            dailyAdRevenue.unshift({
                date: dateStr,
                revenue: dayRevenue
            });
        }
        
        // Fallback: scan events (with gameId filter)
        if (adImpressions === 0) {
            var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
                var evName = (val.eventName || '').toLowerCase();
                return evName.indexOf('ad') !== -1 || evName.indexOf('purchase') !== -1 || 
                       evName.indexOf('iap') !== -1 || evName.indexOf('store') !== -1 || 
                       evName.indexOf('paywall') !== -1;
            }, gameId);
            
            for (var i = 0; i < events.length; i++) {
                var ev = events[i];
                var evName = (ev.eventName || '').toLowerCase();
                
                if (evName.indexOf('ad_impression') !== -1 || evName.indexOf('adimpression') !== -1) adImpressions++;
                if (evName.indexOf('ad_completed') !== -1 || evName.indexOf('adcompleted') !== -1 || evName.indexOf('rewarded') !== -1) adCompleted++;
                if (evName.indexOf('iap') !== -1 || evName.indexOf('purchase_completed') !== -1) iapCompleted++;
                if (evName.indexOf('paywall_shown') !== -1 || evName.indexOf('paywallshown') !== -1) paywallShown++;
                if (evName.indexOf('paywall_converted') !== -1) paywallConverted++;
                if (evName.indexOf('store_open') !== -1 || evName.indexOf('storeopened') !== -1) storeOpens++;
                
                if (ev.eventData && ev.eventData.adType) {
                    adTypeCounts[ev.eventData.adType] = (adTypeCounts[ev.eventData.adType] || 0) + 1;
                }
                if (ev.eventData && ev.eventData.revenue) {
                    adRevenue += ev.eventData.revenue;
                }
                if (ev.eventData && ev.eventData.productId) {
                    productPurchases[ev.eventData.productId] = (productPurchases[ev.eventData.productId] || 0) + 1;
                }
            }
        }
        
        var adFillRate = adImpressions > 0 ? Math.round((adCompleted / adImpressions) * 100) : 0;
        var paywallConversionRate = paywallShown > 0 ? Math.round((paywallConverted / paywallShown) * 100) : 0;
        
        return JSON.stringify({
            game_id: gameId || 'all',
            ad_impressions: adImpressions,
            ad_completed: adCompleted,
            ad_fill_rate_pct: adFillRate,
            ad_revenue_total: Math.round(adRevenue * 100) / 100,
            iap_completed: iapCompleted,
            paywall_shown: paywallShown,
            paywall_conversion_rate_pct: paywallConversionRate,
            store_opens: storeOpens,
            ad_types: extTopN(adTypeCounts, 5, 'type', 'count'),
            daily_ad_revenue: dailyAdRevenue,
            top_products: extTopN(productPurchases, 10, 'product_id', 'purchases')
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] monetization_detail error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_platform_breakdown ────────────────────

function rpcAnalyticsPlatformBreakdown(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var platformCounts = {};
        var platformUsers = {};
        var osVersionCounts = {};
        var deviceCounts = {};
        
        // Scan events for platform data (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);
        
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var evData = ev.eventData || {};
            
            var platform = evData.platform || ev.platform || 'unknown';
            platformCounts[platform] = (platformCounts[platform] || 0) + 1;
            
            if (ev.userId) {
                if (!platformUsers[platform]) platformUsers[platform] = {};
                platformUsers[platform][ev.userId] = true;
            }
            
            if (evData.osVersion) {
                osVersionCounts[evData.osVersion] = (osVersionCounts[evData.osVersion] || 0) + 1;
            }
            
            if (evData.deviceModel) {
                deviceCounts[evData.deviceModel] = (deviceCounts[evData.deviceModel] || 0) + 1;
            }
        }
        
        // Also check DAU storage for platform breakdown (game-specific if filtered)
        for (var d = 0; d < Math.min(days, 7); d++) {
            var dateStr = extDaysAgo(d);
            var platforms = ['android', 'ios', 'webgl', 'editor'];
            
            for (var p = 0; p < platforms.length; p++) {
                var key = 'dau_' + platforms[p] + '_' + dateStr;
                var dauRec = extStorageRead(nk, 'analytics_dau', key, SYSTEM_USER_ID);
                
                if (dauRec) {
                    var count = dauRec.count || dauRec.uniqueUsers || (dauRec.users ? dauRec.users.length : 0);
                    platformCounts[platforms[p]] = (platformCounts[platforms[p]] || 0) + count;
                }
            }
        }
        
        // Build platforms array
        var platforms_arr = [];
        for (var plat in platformCounts) {
            platforms_arr.push({
                platform: plat,
                events: platformCounts[plat],
                unique_users: platformUsers[plat] ? Object.keys(platformUsers[plat]).length : 0
            });
        }
        platforms_arr.sort(function(a, b) { return b.events - a.events; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            platforms: platforms_arr,
            os_versions: extTopN(osVersionCounts, 10, 'version', 'count'),
            top_devices: extTopN(deviceCounts, 10, 'model', 'count')
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] platform_breakdown error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_home_heatmap ──────────────────────────

function rpcAnalyticsHomeHeatmap(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var buttonClicks = {};
        var screenViews = {};
        var screenTime = {};
        var screenTimeCounts = {};
        var popupShown = {};
        
        // Scan UI-related events (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            var evName = (val.eventName || '').toLowerCase();
            return evName.indexOf('click') !== -1 || evName.indexOf('view') !== -1 || 
                   evName.indexOf('screen') !== -1 || evName.indexOf('popup') !== -1 ||
                   evName.indexOf('button') !== -1 || evName.indexOf('tap') !== -1;
        }, gameId);
        
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var evName = ev.eventName || '';
            var evData = ev.eventData || {};
            
            // Button clicks
            if (evName.toLowerCase().indexOf('click') !== -1 || evName.toLowerCase().indexOf('tap') !== -1) {
                var button = evData.button || evData.buttonName || evName;
                buttonClicks[button] = (buttonClicks[button] || 0) + 1;
            }
            
            // Screen views
            if (evName.toLowerCase().indexOf('screen') !== -1 || evName.toLowerCase().indexOf('view') !== -1) {
                var screen = evData.screen || evData.screenName || evName;
                screenViews[screen] = (screenViews[screen] || 0) + 1;
                
                if (evData.duration || evData.timeSpent) {
                    if (!screenTime[screen]) screenTime[screen] = 0;
                    if (!screenTimeCounts[screen]) screenTimeCounts[screen] = 0;
                    screenTime[screen] += evData.duration || evData.timeSpent || 0;
                    screenTimeCounts[screen]++;
                }
            }
            
            // Popups
            if (evName.toLowerCase().indexOf('popup') !== -1 || evName.toLowerCase().indexOf('modal') !== -1) {
                var popup = evData.popup || evData.popupName || evName;
                popupShown[popup] = (popupShown[popup] || 0) + 1;
            }
        }
        
        // Calculate average screen time
        var screenTimeAvg = [];
        for (var s in screenTime) {
            screenTimeAvg.push({
                screen: s,
                avg_seconds: screenTimeCounts[s] > 0 ? Math.round(screenTime[s] / screenTimeCounts[s]) : 0
            });
        }
        screenTimeAvg.sort(function(a, b) { return b.avg_seconds - a.avg_seconds; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            buttons: extTopN(buttonClicks, 15, 'button', 'count'),
            top_screens: extTopN(screenViews, 10, 'screen', 'views'),
            screen_time: screenTimeAvg.slice(0, 10),
            top_popups: extTopN(popupShown, 10, 'popup', 'shown')
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] home_heatmap error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_top_players ───────────────────────────

function rpcAnalyticsTopPlayers(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var limit = parseInt(data.limit, 10) || 50;
        var gameId = data.game_id || data.gameId || null; // Filter by specific game
        
        var playerStats = {};
        
        // Scan events and aggregate by user (with optional game filter) - use extScanEvents with gameId
        var events = extScanEvents(nk, logger, 'analytics_events', days, null, gameId);
        
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            var userId = ev.userId;
            if (!userId) continue;
            
            if (!playerStats[userId]) {
                playerStats[userId] = {
                    user_id: userId,
                    display_name: '',
                    total_events: 0,
                    quiz_completed: 0,
                    daily_quizzes: 0,
                    ai_events: 0,
                    sessions: 0,
                    purchases: 0,
                    total_score: 0,
                    last_active: ev.timestamp || '',
                    game_id: ev.gameId || gameId || 'all'
                };
            }
            
            var ps = playerStats[userId];
            ps.total_events++;
            
            var evName = (ev.eventName || '').toLowerCase();
            var evData = ev.eventData || {};
            
            if (evName.indexOf('quiz_completed') !== -1 || evName.indexOf('quizcompleted') !== -1) {
                ps.quiz_completed++;
                ps.total_score += evData.score || 0;
            }
            if (evName.indexOf('daily') !== -1) {
                ps.daily_quizzes++;
            }
            if (evName.indexOf('ai') !== -1 || evName.indexOf('voice') !== -1) {
                ps.ai_events++;
            }
            if (evName.indexOf('session') !== -1) {
                ps.sessions++;
            }
            if (evName.indexOf('purchase') !== -1 || evName.indexOf('iap') !== -1) {
                ps.purchases++;
            }
            
            if (ev.timestamp && ev.timestamp > ps.last_active) {
                ps.last_active = ev.timestamp;
            }
        }
        
        // Try to fetch display names for top players
        var userIds = Object.keys(playerStats).slice(0, limit);
        if (userIds.length > 0) {
            try {
                var users = nk.usersGetId(userIds);
                if (users) {
                    for (var u = 0; u < users.length; u++) {
                        var user = users[u];
                        if (playerStats[user.userId]) {
                            playerStats[user.userId].display_name = user.displayName || user.username || '';
                        }
                    }
                }
            } catch (e) {
                logger.warn('[AnalyticsExtended] Could not fetch user names: ' + e.message);
            }
        }
        
        // Convert to array and sort by total events
        var players = [];
        for (var uid in playerStats) {
            players.push(playerStats[uid]);
        }
        players.sort(function(a, b) { return b.total_events - a.total_events; });
        players = players.slice(0, limit);
        
        // Get DAU for total active users count (game-specific if filtered)
        var dauKey = gameId ? 'dau_' + gameId + '_' + extDaysAgo(0) : 'dau_platform_' + extDaysAgo(0);
        var todayDau = extStorageRead(nk, 'analytics_dau', dauKey, SYSTEM_USER_ID);
        var totalActiveUsers = (todayDau && todayDau.count) ? todayDau.count : Object.keys(playerStats).length;
        
        return JSON.stringify({
            total_active_users: totalActiveUsers,
            users_sampled: Object.keys(playerStats).length,
            days: days,
            game_id: gameId || 'all',
            players: players
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] top_players error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_error_log ─────────────────────────────

function rpcAnalyticsErrorLog(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var days = parseInt(data.days, 10) || 7;
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var totalErrors = 0;
        var errorsByRpc = {};
        
        // Scan error events (with gameId filter)
        var events = extScanEvents(nk, logger, 'analytics_events', days, function(val) {
            var evName = (val.eventName || '').toLowerCase();
            return evName.indexOf('error') !== -1 || evName.indexOf('crash') !== -1 || 
                   evName.indexOf('exception') !== -1 || evName.indexOf('fail') !== -1;
        }, gameId);
        
        for (var i = 0; i < events.length; i++) {
            var ev = events[i];
            totalErrors++;
            
            var rpcName = (ev.eventData && ev.eventData.rpcName) ? ev.eventData.rpcName : 
                          (ev.eventData && ev.eventData.function) ? ev.eventData.function :
                          ev.eventName || 'unknown';
            
            if (!errorsByRpc[rpcName]) {
                errorsByRpc[rpcName] = {
                    rpc_name: rpcName,
                    count: 0,
                    last_occurred: '',
                    sample_error: ''
                };
            }
            
            errorsByRpc[rpcName].count++;
            
            if (ev.timestamp && ev.timestamp > errorsByRpc[rpcName].last_occurred) {
                errorsByRpc[rpcName].last_occurred = ev.timestamp;
            }
            
            if (!errorsByRpc[rpcName].sample_error && ev.eventData && ev.eventData.error) {
                errorsByRpc[rpcName].sample_error = ev.eventData.error.substring(0, 200);
            }
        }
        
        // Also check error logs storage
        var errorLogs = extStorageList(nk, 'error_logs', SYSTEM_USER_ID, 100);
        
        for (var j = 0; j < errorLogs.length; j++) {
            var errObj = errorLogs[j];
            var errVal = errObj.value || {};
            
            totalErrors++;
            var errRpc = errVal.rpc || errVal.function || errObj.key || 'unknown';
            
            if (!errorsByRpc[errRpc]) {
                errorsByRpc[errRpc] = {
                    rpc_name: errRpc,
                    count: 0,
                    last_occurred: '',
                    sample_error: ''
                };
            }
            
            errorsByRpc[errRpc].count++;
            
            if (errVal.timestamp && errVal.timestamp > errorsByRpc[errRpc].last_occurred) {
                errorsByRpc[errRpc].last_occurred = errVal.timestamp;
            }
            
            if (!errorsByRpc[errRpc].sample_error && errVal.message) {
                errorsByRpc[errRpc].sample_error = errVal.message.substring(0, 200);
            }
        }
        
        // Convert to array and find most failing
        var errorsList = [];
        var mostFailing = { name: 'none', count: 0 };
        
        for (var rpc in errorsByRpc) {
            var errInfo = errorsByRpc[rpc];
            errorsList.push(errInfo);
            
            if (errInfo.count > mostFailing.count) {
                mostFailing = { name: rpc, count: errInfo.count };
            }
        }
        
        errorsList.sort(function(a, b) { return b.count - a.count; });
        
        return JSON.stringify({
            game_id: gameId || 'all',
            total_errors: totalErrors,
            most_failing_rpc: mostFailing,
            errors_by_rpc: errorsList.slice(0, 20)
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] error_log error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_player_segments (Phase 4) ─────────────

/**
 * Segment players into categories: whale, power_user, casual, at_risk, churned, new_user
 * Uses player_analytics_profile collection from Phase 2.
 * 
 * Segment Definitions:
 * - whale: totalSpent > $100
 * - power_user: 10+ sessions in last 7 days AND 5+ day login streak
 * - casual: active but not power_user
 * - at_risk: 7-14 days inactive
 * - churned: 14+ days inactive
 * - new_user: first seen within 7 days
 */
function rpcAnalyticsPlayerSegments(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        // Thresholds (configurable)
        var WHALE_THRESHOLD = 100; // $100 total spent
        var POWER_USER_SESSIONS = 10; // 10+ sessions in 7 days
        var POWER_USER_STREAK = 5; // 5+ day streak
        var AT_RISK_DAYS = 7;
        var CHURNED_DAYS = 14;
        var NEW_USER_DAYS = 7;
        
        var now = new Date();
        var segments = {
            whale: 0,
            power_user: 0,
            casual: 0,
            at_risk: 0,
            churned: 0,
            new_user: 0,
            total_profiled: 0
        };
        
        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;
            
            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;
                
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;
                    
                    segments.total_profiled++;

                    var daysSinceActive = extDaysSince(extProfileLastSeen(profile));
                    var daysSinceFirst = extDaysSince(extProfileFirstSeen(profile));

                    var totalSpent = extProfileTotalSpent(profile);
                    var recentSessions = extProfileRecentSessions(profile);
                    var loginStreak = extProfileStreak(profile);
                    
                    // Classify into segments (mutually exclusive priority order)
                    if (daysSinceActive >= CHURNED_DAYS) {
                        segments.churned++;
                    } else if (daysSinceActive >= AT_RISK_DAYS) {
                        segments.at_risk++;
                    } else if (totalSpent >= WHALE_THRESHOLD) {
                        segments.whale++;
                    } else if (recentSessions >= POWER_USER_SESSIONS && loginStreak >= POWER_USER_STREAK) {
                        segments.power_user++;
                    } else if (daysSinceFirst <= NEW_USER_DAYS) {
                        segments.new_user++;
                    } else {
                        segments.casual++;
                    }
                }
                
                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] player_segments scan error: ' + e.message);
        }
        
        // Calculate percentages
        var total = segments.total_profiled || 1;
        
        return JSON.stringify({
            game_id: gameId || 'all',
            segments: {
                whale: { count: segments.whale, pct: Math.round((segments.whale / total) * 100) },
                power_user: { count: segments.power_user, pct: Math.round((segments.power_user / total) * 100) },
                casual: { count: segments.casual, pct: Math.round((segments.casual / total) * 100) },
                at_risk: { count: segments.at_risk, pct: Math.round((segments.at_risk / total) * 100) },
                churned: { count: segments.churned, pct: Math.round((segments.churned / total) * 100) },
                new_user: { count: segments.new_user, pct: Math.round((segments.new_user / total) * 100) }
            },
            total_profiled: segments.total_profiled,
            thresholds: {
                whale_spend: WHALE_THRESHOLD,
                power_user_sessions: POWER_USER_SESSIONS,
                power_user_streak: POWER_USER_STREAK,
                at_risk_days: AT_RISK_DAYS,
                churned_days: CHURNED_DAYS,
                new_user_days: NEW_USER_DAYS
            }
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] player_segments error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_churn_risk (Phase 4) ──────────────────

/**
 * Identify at-risk and churned players.
 * - At Risk: 7-14 days inactive
 * - Churned: 14+ days inactive
 * Uses player_analytics_profile collection.
 */
function rpcAnalyticsChurnRisk(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        // Thresholds
        var AT_RISK_DAYS = 7;
        var CHURNED_DAYS = 14;
        
        var now = new Date();
        var stats = {
            active: 0,          // < 7 days
            at_risk: 0,         // 7-14 days
            churned: 0,         // 14+ days
            total_profiled: 0,
            at_risk_trend: 0,   // Change from previous period
            churn_rate_pct: 0
        };
        
        // Track activity by day for trend analysis
        var inactivityBuckets = {};
        for (var d = 0; d <= 30; d++) {
            inactivityBuckets[d] = 0;
        }
        
        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;
            
            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;
                
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;
                    
                    stats.total_profiled++;

                    var daysSinceActive = extDaysSince(extProfileLastSeen(profile));
                    
                    // Track in buckets
                    if (daysSinceActive <= 30) {
                        inactivityBuckets[daysSinceActive] = (inactivityBuckets[daysSinceActive] || 0) + 1;
                    }
                    
                    // Classify
                    if (daysSinceActive >= CHURNED_DAYS) {
                        stats.churned++;
                    } else if (daysSinceActive >= AT_RISK_DAYS) {
                        stats.at_risk++;
                    } else {
                        stats.active++;
                    }
                }
                
                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] churn_risk scan error: ' + e.message);
        }
        
        // Calculate churn rate
        var total = stats.total_profiled || 1;
        stats.churn_rate_pct = Math.round((stats.churned / total) * 100);
        var atRiskRate = Math.round((stats.at_risk / total) * 100);
        var activeRate = Math.round((stats.active / total) * 100);
        
        // Build inactivity distribution (days 1-30)
        var distribution = [];
        for (var day = 1; day <= 30; day++) {
            distribution.push({
                days_inactive: day,
                count: inactivityBuckets[day] || 0
            });
        }
        
        return JSON.stringify({
            game_id: gameId || 'all',
            summary: {
                active: { count: stats.active, pct: activeRate },
                at_risk: { count: stats.at_risk, pct: atRiskRate },
                churned: { count: stats.churned, pct: stats.churn_rate_pct }
            },
            total_profiled: stats.total_profiled,
            churn_rate_pct: stats.churn_rate_pct,
            at_risk_rate_pct: atRiskRate,
            thresholds: {
                at_risk_days: AT_RISK_DAYS,
                churned_days: CHURNED_DAYS
            },
            inactivity_distribution: distribution.slice(0, 14) // First 14 days
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] churn_risk error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── RPC: analytics_conversion_funnel (Phase 4) ───────────

/**
 * Track conversion rates:
 * - Free → First IAP purchase
 * - Free → Ad removal purchase
 * - Free → Any monetization event (ad watch, IAP)
 * Uses player_analytics_profile collection.
 */
function rpcAnalyticsConversionFunnel(ctx, logger, nk, payload) {
    try {
        var data = extSafeJsonParse(payload);
        var gameId = data.game_id || data.gameId || null; // Optional filter
        
        var stats = {
            total_users: 0,
            free_users: 0,
            any_monetization: 0,     // Watched ad or made purchase
            first_iap: 0,            // Made any IAP
            ad_removal: 0,           // Purchased ad removal
            rewarded_ad_watched: 0,  // Watched at least one rewarded ad
            repeat_purchasers: 0     // More than 1 IAP
        };
        
        // Scan player_analytics_profile collection
        try {
            var cursor = null;
            var iterations = 0;
            var maxIterations = 50;
            
            do {
                var result = nk.storageList(null, 'player_analytics_profile', 100, cursor);
                if (!result || !result.objects) break;
                
                for (var i = 0; i < result.objects.length; i++) {
                    var obj = result.objects[i];
                    var profile = extResolveProfile(obj.value, gameId);
                    if (!profile) continue;
                    
                    stats.total_users++;

                    var totalSpent = extProfileTotalSpent(profile);
                    var purchaseCount = extProfilePurchaseCount(profile);
                    var adRemovalPurchased = extProfileAdRemovalPurchased(profile);
                    var rewardedAdsWatched = extProfileRewardedAds(profile);
                    
                    // Classify
                    var hasMonetized = totalSpent > 0 || rewardedAdsWatched > 0;
                    
                    if (hasMonetized) {
                        stats.any_monetization++;
                    } else {
                        stats.free_users++;
                    }
                    
                    if (totalSpent > 0 || purchaseCount > 0) {
                        stats.first_iap++;
                        
                        if (purchaseCount > 1) {
                            stats.repeat_purchasers++;
                        }
                    }
                    
                    if (adRemovalPurchased) {
                        stats.ad_removal++;
                    }
                    
                    if (rewardedAdsWatched > 0) {
                        stats.rewarded_ad_watched++;
                    }
                }
                
                cursor = result.cursor;
                iterations++;
            } while (cursor && iterations < maxIterations);
        } catch (e) {
            logger.warn('[AnalyticsExtended] conversion_funnel scan error: ' + e.message);
        }
        
        // Calculate conversion rates
        var total = stats.total_users || 1;
        
        var conversionRates = {
            any_monetization: Math.round((stats.any_monetization / total) * 100),
            first_iap: Math.round((stats.first_iap / total) * 100),
            ad_removal: Math.round((stats.ad_removal / total) * 100),
            rewarded_ad: Math.round((stats.rewarded_ad_watched / total) * 100),
            repeat_purchase: stats.first_iap > 0 ? Math.round((stats.repeat_purchasers / stats.first_iap) * 100) : 0
        };
        
        // Build funnel visualization data
        var funnel = [
            { step: 'Total Users', count: stats.total_users, pct: 100 },
            { step: 'Any Monetization', count: stats.any_monetization, pct: conversionRates.any_monetization },
            { step: 'Rewarded Ad Watched', count: stats.rewarded_ad_watched, pct: conversionRates.rewarded_ad },
            { step: 'First IAP', count: stats.first_iap, pct: conversionRates.first_iap },
            { step: 'Ad Removal', count: stats.ad_removal, pct: conversionRates.ad_removal },
            { step: 'Repeat Purchaser', count: stats.repeat_purchasers, pct: Math.round((stats.repeat_purchasers / total) * 100) }
        ];
        
        return JSON.stringify({
            game_id: gameId || 'all',
            total_users: stats.total_users,
            free_users: stats.free_users,
            conversion_rates: conversionRates,
            counts: {
                any_monetization: stats.any_monetization,
                first_iap: stats.first_iap,
                ad_removal: stats.ad_removal,
                rewarded_ad_watched: stats.rewarded_ad_watched,
                repeat_purchasers: stats.repeat_purchasers
            },
            funnel: funnel
        });
    } catch (e) {
        logger.error('[AnalyticsExtended] conversion_funnel error: ' + e.message);
        return JSON.stringify({ error: e.message });
    }
}

// ─── Registration ─────────────────────────────────────────

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc("analytics_session_stats", rpcAnalyticsSessionStats);
    initializer.registerRpc("analytics_quiz_performance", rpcAnalyticsQuizPerformance);
    initializer.registerRpc("analytics_funnel", rpcAnalyticsFunnel);
    initializer.registerRpc("analytics_ai_features", rpcAnalyticsAIFeatures);
    initializer.registerRpc("analytics_feature_adoption", rpcAnalyticsFeatureAdoption);
    initializer.registerRpc("analytics_economy_health", rpcAnalyticsEconomyHealth);
    initializer.registerRpc("analytics_monetization_detail", rpcAnalyticsMonetizationDetail);
    initializer.registerRpc("analytics_platform_breakdown", rpcAnalyticsPlatformBreakdown);
    initializer.registerRpc("analytics_home_heatmap", rpcAnalyticsHomeHeatmap);
    initializer.registerRpc("analytics_top_players", rpcAnalyticsTopPlayers);
    initializer.registerRpc("analytics_error_log", rpcAnalyticsErrorLog);
    // Phase 4: Advanced Analytics
    initializer.registerRpc("analytics_player_segments", rpcAnalyticsPlayerSegments);
    initializer.registerRpc("analytics_churn_risk", rpcAnalyticsChurnRisk);
    initializer.registerRpc("analytics_conversion_funnel", rpcAnalyticsConversionFunnel);
    logger.info("[AnalyticsExtended] Module registered: 14 RPCs");
}
