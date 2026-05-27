// ai_player.js - Player-Facing AI Features powered by LLM
// Supports: Claude (Anthropic), OpenAI (GPT), xAI (Grok), Qwen3 (local vLLM)
// RPCs: ai_coach_advice, ai_match_recap, ai_player_journey, ai_rival_taunt,
//       ai_trivia_generate, ai_daily_briefing, ai_group_hype

// ============================================================================
// ⚠️  HARDCODED LLM KEYS — TEMPORARY, REMOVE BEFORE OPEN-SOURCING
// ============================================================================
// Why these exist:
//   The EKS deployment in `aicart/intelliverse-nakama` had no `OPENAI_API_KEY`
//   set in its env, so every chat RPC was returning canned replies on iOS
//   builds. Until we wire the K8s Secret properly, these constants act as a
//   last-resort fallback — `getActiveProvider()` first checks `ctx.env` and
//   only uses the hardcoded value if the env var is missing or empty.
//
// How to enable / disable:
//   • Paste your OpenAI key into `HARDCODED_OPENAI_KEY` below. Same for the
//     other two providers if you have keys.
//   • Leave a constant as the empty string '' to disable that provider's
//     hardcoded fallback (env var is still consulted first either way).
//
// SECURITY (read before committing):
//   • These strings end up in the Docker image and in this repo's git history.
//   • Anyone with read access to this repo or to the ECR image can extract
//     them. That includes every developer, CI runner, and anything that ever
//     pulls the image.
//   • This is acceptable as a temporary unblock for iOS playtest — NOT for a
//     public production server. Rotate the key the moment a proper K8s
//     Secret is wired up, and delete these constants.
// ============================================================================

var HARDCODED_OPENAI_KEY    = ''; // ← paste sk-proj-... here
var HARDCODED_ANTHROPIC_KEY = ''; // ← paste sk-ant-...  here (optional)
var HARDCODED_XAI_KEY       = ''; // ← paste xai-...     here (optional)

// ============================================================================
// LLM CLIENT INFRASTRUCTURE
// ============================================================================

var QWEN3_DEFAULT_BASE_URL = 'http://vllm-coder-pro.content-factory.svc.cluster.local:8000';
var QWEN3_DEFAULT_MODEL    = 'Qwen/Qwen3-7B-Instruct';

var LLM_PROVIDERS = {
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o-mini',
        envKey: 'OPENAI_API_KEY',
        hardcoded: function () { return HARDCODED_OPENAI_KEY; }
    },
    claude: {
        url: 'https://api.anthropic.com/v1/messages',
        model: 'claude-sonnet-4-20250514',
        envKey: 'ANTHROPIC_API_KEY',
        hardcoded: function () { return HARDCODED_ANTHROPIC_KEY; }
    },
    xai: {
        url: 'https://api.x.ai/v1/chat/completions',
        model: 'grok-3-mini',
        envKey: 'XAI_API_KEY',
        hardcoded: function () { return HARDCODED_XAI_KEY; }
    },
    qwen3: {
        // URL and model resolved at call-time via ctx.env so operators can
        // swap without a redeploy; fall back to cluster-local vLLM defaults.
        url: null,
        model: null,
        envKey: null,
        hardcoded: function () { return ''; }
    }
};

// Explicit fallback order so behaviour does not depend on object-iteration
// order. If the preferred provider has neither env-var nor hardcoded key, we
// walk this list and pick the first provider that does.
var LLM_PROVIDER_FALLBACK_ORDER = ['qwen3', 'openai', 'claude', 'xai'];

// Resolves a provider's key from ctx.env first, then the hardcoded constant.
// Returns null if both are missing/empty.
// qwen3 is keyless — this returns a sentinel so it can be selected without a key.
function resolveProviderKey(ctx, providerName, provider) {
    if (providerName === 'qwen3') return 'no-key-required';
    var envKey = ctx && ctx.env ? ctx.env[provider.envKey] : null;
    if (envKey) return envKey;
    var hard = provider.hardcoded ? provider.hardcoded() : '';
    if (hard) return hard;
    return null;
}

// Returns the resolved vLLM base URL for qwen3, reading QWEN3_BASE_URL from
// ctx.env when present so operators can override without a redeploy.
function resolveQwen3BaseUrl(ctx) {
    return (ctx && ctx.env && ctx.env['QWEN3_BASE_URL']) || QWEN3_DEFAULT_BASE_URL;
}

function resolveQwen3Model(ctx) {
    return (ctx && ctx.env && ctx.env['QWEN3_MODEL']) || QWEN3_DEFAULT_MODEL;
}

function getActiveProvider(ctx) {
    var preferred = (ctx.env && ctx.env['LLM_PROVIDER']) || 'qwen3';
    var provider = LLM_PROVIDERS[preferred];
    if (!provider) {
        preferred = 'qwen3';
        provider = LLM_PROVIDERS.qwen3;
    }

    var apiKey = resolveProviderKey(ctx, preferred, provider);
    if (apiKey) {
        return { name: preferred, config: provider, apiKey: apiKey };
    }

    // Preferred provider has no key — walk the explicit fallback order.
    for (var i = 0; i < LLM_PROVIDER_FALLBACK_ORDER.length; i++) {
        var name = LLM_PROVIDER_FALLBACK_ORDER[i];
        if (name === preferred) continue; // already checked above
        var p = LLM_PROVIDERS[name];
        var k = resolveProviderKey(ctx, name, p);
        if (k) return { name: name, config: p, apiKey: k };
    }
    return null;
}

function callLLM(nk, logger, ctx, systemPrompt, userMessage, maxTokens) {
    var provider = getActiveProvider(ctx);
    if (!provider) {
        return { success: false, error: 'No LLM provider available. Set LLM_PROVIDER=qwen3 (default) or supply OPENAI_API_KEY / ANTHROPIC_API_KEY / XAI_API_KEY.' };
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
        } else if (provider.name === 'qwen3') {
            var qUrl   = resolveQwen3BaseUrl(ctx) + '/v1/chat/completions';
            var qModel = resolveQwen3Model(ctx);
            response = nk.httpRequest(qUrl, 'post', {
                'Content-Type': 'application/json'
            }, JSON.stringify({
                model: qModel,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ]
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
        var modelUsed = provider.name === 'qwen3' ? resolveQwen3Model(ctx) : provider.config.model;

        if (provider.name === 'claude') {
            text = parsed.content && parsed.content[0] ? parsed.content[0].text : '';
        } else {
            text = parsed.choices && parsed.choices[0] ? parsed.choices[0].message.content : '';
        }

        return { success: true, text: text, provider: provider.name, model: modelUsed };

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
            // P1-15: do NOT return raw_response — it leaks the LLM's
            // internal output (which can contain system-prompt fragments,
            // policy text, or other users' patterns when caching is in
            // play). The raw text is logged server-side for debugging.
            logger.warn('[AI] Failed to parse trivia JSON: ' + parseErr.message +
                        ' | raw_preview=' + String(result.text || '').substring(0, 200));
            return JSON.stringify({
                success: false,
                error: 'Failed to parse generated questions'
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

// ============================================================================
// MODULE INIT (postbuild AST hook)
// ----------------------------------------------------------------------------
// postbuild.js renames this `InitModule` to `__ModuleInit_N` and lifts every
// literal initializer.registerRpc call inside it into the master InitModule.
// Keep registrations as direct literal calls so Nakama's AST walker
// (getRegisteredFnIdentifier in runtime_javascript_init.go) detects them.
// ============================================================================

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('ai_coach_advice',     rpcAiCoachAdvice);
    initializer.registerRpc('ai_match_recap',      rpcAiMatchRecap);
    initializer.registerRpc('ai_player_journey',   rpcAiPlayerJourney);
    initializer.registerRpc('ai_rival_taunt',      rpcAiRivalTaunt);
    initializer.registerRpc('ai_trivia_generate',  rpcAiTriviaGenerate);
    initializer.registerRpc('ai_daily_briefing',   rpcAiDailyBriefing);
    initializer.registerRpc('ai_group_hype',       rpcAiGroupHype);
    logger.info('[AI] Module InitModule registered: 7 RPCs');
}
