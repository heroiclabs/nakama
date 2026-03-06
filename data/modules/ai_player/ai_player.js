// ai_player.js - Player-Facing AI Features powered by LLM
// Supports: Claude (Anthropic), OpenAI (GPT), xAI (Grok)
// RPCs: ai_coach_advice, ai_match_recap, ai_player_journey, ai_rival_taunt,
//       ai_trivia_generate, ai_daily_briefing, ai_group_hype

// ============================================================================
// LLM CLIENT INFRASTRUCTURE
// ============================================================================

var LLM_PROVIDERS = {
    claude: {
        url: 'https://api.anthropic.com/v1/messages',
        model: 'claude-sonnet-4-20250514',
        envKey: 'ANTHROPIC_API_KEY'
    },
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        envKey: 'OPENAI_API_KEY'
    },
    xai: {
        url: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-3-mini',
        envKey: 'XAI_API_KEY'
    }
};

function getActiveProvider(ctx) {
    var preferred = (ctx.env && ctx.env['LLM_PROVIDER']) || 'claude';
    var provider = LLM_PROVIDERS[preferred];
    if (!provider) provider = LLM_PROVIDERS.claude;

    var apiKey = ctx.env ? ctx.env[provider.envKey] : null;
    if (!apiKey) {
        for (var name in LLM_PROVIDERS) {
            var p = LLM_PROVIDERS[name];
            var k = ctx.env ? ctx.env[p.envKey] : null;
            if (k) return { name: name, config: p, apiKey: k };
        }
        return null;
    }
    return { name: preferred, config: provider, apiKey: apiKey };
}

function callLLM(nk, logger, ctx, systemPrompt, userMessage, maxTokens) {
    var provider = getActiveProvider(ctx);
    if (!provider) {
        return { success: false, error: 'No LLM API key configured. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or XAI_API_KEY.' };
    }

    maxTokens = maxTokens || 500;

    try {
        var response;
        if (provider.name === 'claude') {
            response = nk.httpRequest(provider.config.url, 'post', {
                'Content-Type': 'application/json',
                'x-api-key': provider.apiKey,
                'anthropic-version': '2023-06-01'
            }, JSON.stringify({
                model: provider.config.model,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userMessage }]
            }));
        } else {
            response = nk.httpRequest(provider.config.url, 'post', {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + provider.apiKey
            }, JSON.stringify({
                model: provider.config.model,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ]
            }));
        }

        if (response.code !== 200) {
            logger.error('[AI] LLM API returned ' + response.code + ': ' + response.body);
            return { success: false, error: 'LLM API error: ' + response.code };
        }

        var parsed = JSON.parse(response.body);
        var text = '';

        if (provider.name === 'claude') {
            text = parsed.content && parsed.content[0] ? parsed.content[0].text : '';
        } else {
            text = parsed.choices && parsed.choices[0] ? parsed.choices[0].message.content : '';
        }

        return { success: true, text: text, provider: provider.name, model: provider.config.model };

    } catch (err) {
        logger.error('[AI] LLM call failed: ' + err.message);
        return { success: false, error: 'LLM call failed: ' + err.message };
    }
}

// ============================================================================
// DATA GATHERING HELPERS
// ============================================================================

function gatherPlayerContext(nk, logger, userId, gameId) {
    var context = { userId: userId, gameId: gameId };

    try {
        var accounts = nk.accountGetId(userId);
        if (accounts) {
            context.username = accounts.user.username || 'Player';
            context.displayName = accounts.user.displayName || context.username;
            context.createTime = accounts.user.createTime;
        }
    } catch (e) { context.username = 'Player'; }

    try {
        var wallet = nk.walletLedgerList(userId, 10);
        if (wallet && wallet.items) {
            context.recentTransactions = wallet.items.length;
        }
    } catch (e) { /* no wallet data */ }

    try {
        var streakKey = gameId + '_user_daily_streak_' + userId;
        var streakRecords = nk.storageRead([{ collection: 'daily_streaks', key: streakKey, userId: userId }]);
        if (streakRecords && streakRecords.length > 0) {
            context.streak = streakRecords[0].value;
        }
    } catch (e) { /* no streak */ }

    try {
        var altKey = 'user_daily_streak_' + userId + '_' + gameId;
        if (!context.streak) {
            var altRecords = nk.storageRead([{ collection: 'daily_streaks', key: altKey, userId: userId }]);
            if (altRecords && altRecords.length > 0) context.streak = altRecords[0].value;
        }
    } catch (e) { /* no streak */ }

    try {
        var quizRecords = nk.storageList(userId, 'quiz_results', 10, '');
        var items = quizRecords;
        if (typeof quizRecords === 'object' && quizRecords.objects) items = quizRecords.objects;
        if (items && items.length > 0) {
            var scores = [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].value) scores.push(items[i].value);
            }
            context.recentQuizzes = scores;
        }
    } catch (e) { /* no quiz data */ }

    try {
        var achieveRecords = nk.storageList(userId, 'achievements', 10, '');
        var aItems = achieveRecords;
        if (typeof achieveRecords === 'object' && achieveRecords.objects) aItems = achieveRecords.objects;
        if (aItems && aItems.length > 0) {
            context.achievements = [];
            for (var a = 0; a < aItems.length; a++) {
                if (aItems[a].value && aItems[a].value.name) {
                    context.achievements.push(aItems[a].value.name);
                }
            }
        }
    } catch (e) { /* no achievements */ }

    try {
        var metaRecords = nk.storageRead([{
            collection: 'player_metadata',
            key: 'user_identity',
            userId: userId
        }]);
        if (metaRecords && metaRecords.length > 0 && metaRecords[0].value) {
            var meta = metaRecords[0].value;
            context.totalSessions = meta.totalSessions || 0;
            context.level = meta.level || 1;
            context.favoriteCategory = meta.favoriteCategory || null;
        }
    } catch (e) { /* no metadata */ }

    return context;
}

function gatherRivalContext(nk, logger, userId, rivalId) {
    var context = { userId: userId, rivalId: rivalId };

    try {
        var userAccount = nk.accountGetId(userId);
        context.username = userAccount.user.username || 'Player';
    } catch (e) { context.username = 'Player'; }

    try {
        var rivalAccount = nk.accountGetId(rivalId);
        context.rivalUsername = rivalAccount.user.username || 'Rival';
    } catch (e) { context.rivalUsername = 'Rival'; }

    return context;
}

// ============================================================================
// RPC: ai_coach_advice
// ============================================================================

function rpcAiCoachAdvice(ctx, logger, nk, payload) {
    logger.info('[AI] ai_coach_advice called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var gameId = data.game_id || 'default';
        var topic = data.topic || 'general';

        var context = gatherPlayerContext(nk, logger, ctx.userId, gameId);

        var systemPrompt = 'You are a fun, encouraging game coach inside a mobile game. ' +
            'You have access to the player\'s actual game data. Give short, actionable advice (2-3 sentences max). ' +
            'Be specific to their data. Use a casual, energetic tone with occasional emojis. ' +
            'Never be condescending. If they\'re doing great, hype them up. If struggling, give one concrete tip.';

        var userMsg = 'Player: ' + context.username + '\n' +
            'Game: ' + gameId + '\n' +
            'Topic: ' + topic + '\n' +
            'Current streak: ' + (context.streak ? context.streak.currentStreak + ' days' : 'none yet') + '\n' +
            'Total sessions: ' + (context.totalSessions || 'unknown') + '\n' +
            'Level: ' + (context.level || 1) + '\n' +
            'Recent quizzes: ' + (context.recentQuizzes ? context.recentQuizzes.length + ' played' : 'none') + '\n' +
            'Achievements: ' + (context.achievements ? context.achievements.join(', ') : 'none yet') + '\n' +
            'Favorite category: ' + (context.favoriteCategory || 'not set') + '\n' +
            '\nGive coaching advice for this player.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 300);

        if (!result.success) return JSON.stringify(result);

        nk.storageWrite([{
            collection: 'ai_interactions',
            key: 'coach_' + ctx.userId + '_' + Date.now(),
            userId: ctx.userId,
            value: { type: 'coach', topic: topic, response_length: result.text.length, provider: result.provider, timestamp: new Date().toISOString() },
            permissionRead: 1, permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            advice: result.text,
            topic: topic,
            provider: result.provider,
            player_context: {
                streak: context.streak ? context.streak.currentStreak : 0,
                level: context.level || 1,
                sessions: context.totalSessions || 0
            }
        });

    } catch (err) {
        logger.error('[AI] ai_coach_advice error: ' + err.message);
        logRpcError(nk, logger, 'ai_coach_advice', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_match_recap
// ============================================================================

function rpcAiMatchRecap(ctx, logger, nk, payload) {
    logger.info('[AI] ai_match_recap called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var gameId = data.game_id || 'default';
        var matchData = data.match_data || {};

        var context = gatherPlayerContext(nk, logger, ctx.userId, gameId);

        var systemPrompt = 'You are a sports-style commentator generating exciting post-match recaps for a mobile game. ' +
            'Write like a highlight reel narrator — dramatic, fun, personal. 3-4 sentences max. ' +
            'Reference specific stats from the match. Make the player feel like the main character. ' +
            'Use their name. Add flair.';

        var userMsg = 'Player: ' + context.username + '\n' +
            'Match data: ' + JSON.stringify(matchData) + '\n' +
            'Player streak: ' + (context.streak ? context.streak.currentStreak + ' days' : 'fresh start') + '\n' +
            'Player level: ' + (context.level || 1) + '\n' +
            '\nGenerate an exciting match recap.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 400);

        if (!result.success) return JSON.stringify(result);

        nk.storageWrite([{
            collection: 'ai_interactions',
            key: 'recap_' + ctx.userId + '_' + Date.now(),
            userId: ctx.userId,
            value: { type: 'recap', game_id: gameId, provider: result.provider, timestamp: new Date().toISOString() },
            permissionRead: 1, permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            recap: result.text,
            provider: result.provider,
            match_data: matchData
        });

    } catch (err) {
        logger.error('[AI] ai_match_recap error: ' + err.message);
        logRpcError(nk, logger, 'ai_match_recap', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_player_journey
// ============================================================================

function rpcAiPlayerJourney(ctx, logger, nk, payload) {
    logger.info('[AI] ai_player_journey called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var gameId = data.game_id || 'default';

        var context = gatherPlayerContext(nk, logger, ctx.userId, gameId);

        var systemPrompt = 'You are a master storyteller narrating a player\'s gaming journey as an epic tale. ' +
            'Turn their stats and achievements into a dramatic narrative — like the opening crawl of a movie about THEM. ' +
            'Reference real data (their streak, level, achievements, time played). ' +
            'Make it personal, emotional, and make them feel their journey matters. 4-5 sentences. ' +
            'Write in second person ("You"). End with something forward-looking.';

        var daysSinceJoin = 'unknown';
        if (context.createTime) {
            var joinDate = new Date(context.createTime);
            var now = new Date();
            daysSinceJoin = Math.floor((now - joinDate) / (1000 * 60 * 60 * 24));
        }

        var userMsg = 'Player: ' + context.username + '\n' +
            'Days since joining: ' + daysSinceJoin + '\n' +
            'Current streak: ' + (context.streak ? context.streak.currentStreak + ' days' : '0') + '\n' +
            'Total claims: ' + (context.streak ? context.streak.totalClaims : 0) + '\n' +
            'Level: ' + (context.level || 1) + '\n' +
            'Total sessions: ' + (context.totalSessions || 0) + '\n' +
            'Achievements: ' + (context.achievements ? context.achievements.join(', ') : 'none yet') + '\n' +
            'Recent quizzes: ' + (context.recentQuizzes ? context.recentQuizzes.length : 0) + '\n' +
            'Favorite category: ' + (context.favoriteCategory || 'exploring everything') + '\n' +
            '\nNarrate their epic journey.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 500);

        if (!result.success) return JSON.stringify(result);

        nk.storageWrite([{
            collection: 'ai_interactions',
            key: 'journey_' + ctx.userId + '_' + Date.now(),
            userId: ctx.userId,
            value: { type: 'journey', game_id: gameId, provider: result.provider, timestamp: new Date().toISOString() },
            permissionRead: 1, permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            journey: result.text,
            provider: result.provider,
            stats: {
                days_since_join: daysSinceJoin,
                streak: context.streak ? context.streak.currentStreak : 0,
                level: context.level || 1,
                achievements_count: context.achievements ? context.achievements.length : 0
            }
        });

    } catch (err) {
        logger.error('[AI] ai_player_journey error: ' + err.message);
        logRpcError(nk, logger, 'ai_player_journey', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_rival_taunt
// ============================================================================

function rpcAiRivalTaunt(ctx, logger, nk, payload) {
    logger.info('[AI] ai_rival_taunt called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var rivalId = data.rival_user_id;
        var gameId = data.game_id || 'default';
        var mood = data.mood || 'playful';

        if (!rivalId) return JSON.stringify({ success: false, error: 'rival_user_id is required' });

        var context = gatherRivalContext(nk, logger, ctx.userId, rivalId);

        var systemPrompt = 'You are generating a short, playful trash-talk message between two friends in a mobile game. ' +
            'The mood is: ' + mood + '. Keep it FUN and FRIENDLY — never mean, never offensive. ' +
            'Think friendly sports banter, not bullying. Use the players\' names. ' +
            'One sentence only. Make it shareable and laugh-worthy.';

        var userMsg = 'Sender: ' + context.username + '\n' +
            'Rival: ' + context.rivalUsername + '\n' +
            'Mood: ' + mood + '\n' +
            '\nGenerate a playful taunt from ' + context.username + ' to ' + context.rivalUsername + '.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 150);

        if (!result.success) return JSON.stringify(result);

        return JSON.stringify({
            success: true,
            taunt: result.text,
            from: context.username,
            to: context.rivalUsername,
            mood: mood,
            provider: result.provider
        });

    } catch (err) {
        logger.error('[AI] ai_rival_taunt error: ' + err.message);
        logRpcError(nk, logger, 'ai_rival_taunt', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_trivia_generate
// ============================================================================

function rpcAiTriviaGenerate(ctx, logger, nk, payload) {
    logger.info('[AI] ai_trivia_generate called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var category = data.category || 'general knowledge';
        var difficulty = data.difficulty || 'medium';
        var count = Math.min(parseInt(data.count, 10) || 5, 10);
        var gameId = data.game_id || 'default';

        var context = gatherPlayerContext(nk, logger, ctx.userId, gameId);

        var systemPrompt = 'You are a trivia question generator for a mobile quiz game. ' +
            'Generate EXACTLY ' + count + ' questions in valid JSON array format. ' +
            'Each question must have: question (string), options (array of 4 strings), ' +
            'correct_index (0-3), explanation (1 sentence), fun_fact (1 sentence). ' +
            'Category: ' + category + '. Difficulty: ' + difficulty + '. ' +
            'Make questions interesting, surprising, and educational. Avoid commonly known trivia. ' +
            'Adapt difficulty to the player\'s level if provided. ' +
            'RESPOND WITH ONLY THE JSON ARRAY, NO OTHER TEXT.';

        var userMsg = 'Player level: ' + (context.level || 1) + '\n' +
            'Favorite category: ' + (context.favoriteCategory || category) + '\n' +
            'Category requested: ' + category + '\n' +
            'Difficulty: ' + difficulty + '\n' +
            'Count: ' + count + '\n' +
            '\nGenerate ' + count + ' trivia questions.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 2000);

        if (!result.success) return JSON.stringify(result);

        var questions = [];
        try {
            var text = result.text.trim();
            if (text.indexOf('```') !== -1) {
                text = text.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            }
            questions = JSON.parse(text);
        } catch (parseErr) {
            logger.warn('[AI] Failed to parse trivia JSON: ' + parseErr.message);
            return JSON.stringify({
                success: false,
                error: 'Failed to parse generated questions',
                raw_response: result.text
            });
        }

        nk.storageWrite([{
            collection: 'ai_interactions',
            key: 'trivia_' + ctx.userId + '_' + Date.now(),
            userId: ctx.userId,
            value: { type: 'trivia', category: category, difficulty: difficulty, count: questions.length, provider: result.provider, timestamp: new Date().toISOString() },
            permissionRead: 1, permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            questions: questions,
            category: category,
            difficulty: difficulty,
            count: questions.length,
            provider: result.provider
        });

    } catch (err) {
        logger.error('[AI] ai_trivia_generate error: ' + err.message);
        logRpcError(nk, logger, 'ai_trivia_generate', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_daily_briefing
// ============================================================================

function rpcAiDailyBriefing(ctx, logger, nk, payload) {
    logger.info('[AI] ai_daily_briefing called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var gameId = data.game_id || 'default';

        var context = gatherPlayerContext(nk, logger, ctx.userId, gameId);

        // Check if there's a flash event active
        var flashEvent = null;
        try {
            var eventRecords = nk.storageList('00000000-0000-0000-0000-000000000000', 'flash_events', 5, '');
            var eventItems = eventRecords;
            if (typeof eventRecords === 'object' && eventRecords.objects) eventItems = eventRecords.objects;
            if (eventItems) {
                var now = Date.now();
                for (var e = 0; e < eventItems.length; e++) {
                    var ev = eventItems[e].value;
                    if (ev && ev.end_time && new Date(ev.end_time).getTime() > now) {
                        flashEvent = ev;
                        break;
                    }
                }
            }
        } catch (e) { /* no flash events */ }

        var systemPrompt = 'You are a friendly daily game briefing bot — like a morning news anchor but for a mobile game. ' +
            'Greet the player by name. Tell them: what\'s happening today, their streak status, ' +
            'any active events, and one motivating thing to do today. ' +
            'Keep it SHORT (3-4 sentences), PUNCHY, and make them excited to play. ' +
            'Vary your greeting style. Reference real data.';

        var canClaim = true;
        if (context.streak && context.streak.lastClaimTimestamp) {
            var lastDate = new Date(context.streak.lastClaimTimestamp * 1000);
            var today = new Date();
            lastDate.setHours(0, 0, 0, 0);
            today.setHours(0, 0, 0, 0);
            if (lastDate.getTime() === today.getTime()) canClaim = false;
        }

        var userMsg = 'Player: ' + context.username + '\n' +
            'Time of day: ' + new Date().toLocaleTimeString() + '\n' +
            'Current streak: ' + (context.streak ? context.streak.currentStreak + ' days' : 'none') + '\n' +
            'Can claim daily reward: ' + (canClaim ? 'YES' : 'already claimed today') + '\n' +
            'Level: ' + (context.level || 1) + '\n' +
            'Active flash event: ' + (flashEvent ? flashEvent.name || 'yes' : 'none') + '\n' +
            'Total sessions: ' + (context.totalSessions || 0) + '\n' +
            '\nGenerate their daily game briefing.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 350);

        if (!result.success) return JSON.stringify(result);

        nk.storageWrite([{
            collection: 'ai_interactions',
            key: 'briefing_' + ctx.userId + '_' + Date.now(),
            userId: ctx.userId,
            value: { type: 'daily_briefing', game_id: gameId, provider: result.provider, timestamp: new Date().toISOString() },
            permissionRead: 1, permissionWrite: 0
        }]);

        return JSON.stringify({
            success: true,
            briefing: result.text,
            provider: result.provider,
            today: {
                can_claim_reward: canClaim,
                streak: context.streak ? context.streak.currentStreak : 0,
                flash_event: flashEvent ? flashEvent.name || 'active' : null
            }
        });

    } catch (err) {
        logger.error('[AI] ai_daily_briefing error: ' + err.message);
        logRpcError(nk, logger, 'ai_daily_briefing', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}

// ============================================================================
// RPC: ai_group_hype
// ============================================================================

function rpcAiGroupHype(ctx, logger, nk, payload) {
    logger.info('[AI] ai_group_hype called');
    try {
        if (!ctx.userId) return JSON.stringify({ success: false, error: 'Authentication required' });

        var data = JSON.parse(payload || '{}');
        var groupId = data.group_id;
        var eventType = data.event_type || 'general';
        var eventData = data.event_data || {};

        if (!groupId) return JSON.stringify({ success: false, error: 'group_id is required' });

        var context = gatherPlayerContext(nk, logger, ctx.userId, data.game_id || 'default');

        var systemPrompt = 'You are an AI hype bot in a gaming group chat. Your job is to celebrate group moments — ' +
            'when someone achieves something, when the group hits a milestone, when there\'s a competition. ' +
            'Be SHORT (1-2 sentences), ENERGETIC, use emojis, and make it feel like a party. ' +
            'Reference the player name and the achievement. Never be generic.';

        var userMsg = 'Player: ' + context.username + '\n' +
            'Event: ' + eventType + '\n' +
            'Details: ' + JSON.stringify(eventData) + '\n' +
            '\nGenerate a hype message for the group.';

        var result = callLLM(nk, logger, ctx, systemPrompt, userMsg, 200);

        if (!result.success) return JSON.stringify(result);

        // Post the hype message to the group chat
        try {
            var msgKey = 'msg:' + groupId + ':' + Date.now() + ':ai_bot';
            nk.storageWrite([{
                collection: 'group_chat',
                key: msgKey,
                userId: ctx.userId,
                value: {
                    message_id: msgKey,
                    group_id: groupId,
                    user_id: 'ai_hype_bot',
                    username: 'HypeBot',
                    message: result.text,
                    metadata: { ai_generated: true, event_type: eventType, provider: result.provider },
                    created_at: new Date().toISOString()
                },
                permissionRead: 2,
                permissionWrite: 0
            }]);
        } catch (chatErr) {
            logger.warn('[AI] Failed to post hype message to group: ' + chatErr.message);
        }

        return JSON.stringify({
            success: true,
            hype_message: result.text,
            event_type: eventType,
            group_id: groupId,
            posted_to_chat: true,
            provider: result.provider
        });

    } catch (err) {
        logger.error('[AI] ai_group_hype error: ' + err.message);
        logRpcError(nk, logger, 'ai_group_hype', err.message, ctx.userId, null);
        return JSON.stringify({ success: false, error: err.message });
    }
}
