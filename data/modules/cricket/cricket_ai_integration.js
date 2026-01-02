/**
 * Cricket AI Integration Module
 * 
 * Integrates with IntelliVerse-X AI APIs for dynamic content:
 * - ai-notes: Quiz generation from cricket content
 * - ai-prompts: Trivia question generation
 * - ai-studio: Content processing and analysis
 * - ai-enhancement: Content improvement
 * 
 * Features:
 * - Generate trivia from YouTube cricket videos
 * - Create match-specific questions using AI
 * - Generate debate topics for cricket discussions
 * - Enhance question quality with AI
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// AI API Configuration
const AI_CONFIG = {
    baseUrl: "https://api.intelliversex.com",
    endpoints: {
        createNote: "/ai-notes/notes/create-from-url",
        generateQuiz: "/ai-notes/notes/{noteId}/generate-quiz",
        generateTrivia: "/ai-prompts/trivia/generate",
        enhanceContent: "/ai-enhancement/improve",
        analyzeContent: "/ai-studio/analyze"
    },
    // These would be environment variables in production
    apiKey: "INTELLIVERSEX_API_KEY"
};

// Collections
const COLLECTIONS = {
    AI_NOTES: "cricket_ai_notes",
    AI_QUIZZES: "cricket_ai_quizzes",
    AI_REQUESTS: "cricket_ai_requests",
    AI_CACHE: "cricket_ai_cache"
};

// Supported link types for cricket content
const LINK_TYPES = {
    YOUTUBE: "youtube",
    IPL_OFFICIAL: "ipl_official",
    ICC_OFFICIAL: "icc_official",
    CRICINFO: "cricinfo",
    CRICBUZZ: "cricbuzz",
    TWITTER: "twitter",
    REDDIT: "reddit",
    ARTICLE: "article"
};

// Cricket-specific prompt templates
const PROMPT_TEMPLATES = {
    MATCH_TRIVIA: `Generate {count} trivia questions about the cricket match between {team1} and {team2}.
Focus on:
- Player statistics and records
- Historical head-to-head data
- Venue information
- Key moments and turning points
- Team strategies

Format: JSON array with question, options (4), correctIndex, explanation, difficulty, category`,

    VIDEO_QUIZ: `Based on this cricket video content: {content}
Generate {count} engaging trivia questions.
Include questions about:
- Specific moments and timestamps
- Player performances
- Commentary insights
- Match statistics

Format: JSON array with question, options (4), correctIndex, explanation, timestamp (if applicable)`,

    PLAYER_TRIVIA: `Generate {count} trivia questions about {playerName}.
Include:
- Career statistics
- Notable achievements
- Records held
- Team history
- Playing style

Format: JSON array with question, options (4), correctIndex, explanation, difficulty`,

    TOURNAMENT_TRIVIA: `Generate {count} trivia questions about {tournamentName}.
Cover:
- Tournament history
- Previous winners
- Records and statistics
- Memorable moments
- Format and rules

Format: JSON array with question, options (4), correctIndex, explanation`
};

/**
 * RPC: Create AI note from cricket URL
 * 
 * Payload: {
 *   url: string,
 *   linkType: string,
 *   title: string (optional)
 * }
 */
function rpcCreateAINote(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { url, linkType = LINK_TYPES.ARTICLE, title } = data;

    if (!url) {
        throw new Error("URL is required");
    }

    // Validate URL and detect link type
    const detectedType = detectLinkType(url);
    const finalLinkType = linkType || detectedType;

    // Create note ID
    const noteId = `note_${userId}_${Date.now()}`;

    // For now, simulate AI note creation
    // In production, this would call the actual AI API
    const note = {
        noteId,
        userId,
        url,
        linkType: finalLinkType,
        title: title || generateTitleFromUrl(url),
        status: "processing",
        createdAt: Date.now(),
        content: null,
        summary: null,
        questions: []
    };

    // Store note
    nk.storageWrite([{
        collection: COLLECTIONS.AI_NOTES,
        key: noteId,
        userId: userId,
        value: note,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Log request
    logAIRequest(nk, userId, "create_note", { url, linkType: finalLinkType });

    // Simulate async processing (in production, this would be a job)
    processNoteAsync(nk, logger, noteId, userId, url, finalLinkType);

    logger.info(`User ${userId} created AI note: ${noteId} from ${url}`);

    return JSON.stringify({
        success: true,
        noteId,
        status: "processing",
        message: "Note creation started. Quiz will be available shortly."
    });
}

/**
 * RPC: Generate quiz from AI note
 * 
 * Payload: {
 *   noteId: string,
 *   questionCount: number,
 *   difficulty: string
 * }
 */
function rpcGenerateQuizFromNote(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { noteId, questionCount = 10, difficulty = "medium" } = data;

    if (!noteId) {
        throw new Error("noteId is required");
    }

    // Get note
    const notes = nk.storageRead([{
        collection: COLLECTIONS.AI_NOTES,
        key: noteId,
        userId: userId
    }]);

    if (notes.length === 0) {
        throw new Error("Note not found");
    }

    const note = notes[0].value;

    if (note.status !== "ready") {
        return JSON.stringify({
            success: false,
            status: note.status,
            message: note.status === "processing" ? "Note is still processing" : "Note processing failed"
        });
    }

    // Generate questions based on note content
    const questions = generateQuestionsFromNote(note, questionCount, difficulty);

    // Create quiz record
    const quizId = `quiz_${noteId}_${Date.now()}`;
    const quiz = {
        quizId,
        noteId,
        userId,
        questions,
        questionCount: questions.length,
        difficulty,
        createdAt: Date.now()
    };

    // Store quiz
    nk.storageWrite([{
        collection: COLLECTIONS.AI_QUIZZES,
        key: quizId,
        userId: userId,
        value: quiz,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Update note with quiz reference
    note.latestQuizId = quizId;
    note.totalQuizzes = (note.totalQuizzes || 0) + 1;
    
    nk.storageWrite([{
        collection: COLLECTIONS.AI_NOTES,
        key: noteId,
        userId: userId,
        value: note,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} generated quiz ${quizId} from note ${noteId}`);

    return JSON.stringify({
        success: true,
        quizId,
        questionCount: questions.length,
        questions: questions.map(q => ({
            id: q.id,
            question: q.question,
            options: q.options,
            difficulty: q.difficulty,
            category: q.category
        }))
    });
}

/**
 * RPC: Generate AI trivia for match
 * 
 * Payload: {
 *   matchId: string,
 *   team1: string,
 *   team2: string,
 *   questionCount: number,
 *   categories: string[]
 * }
 */
function rpcGenerateMatchTrivia(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { matchId, team1, team2, questionCount = 10, categories } = data;

    if (!team1 || !team2) {
        throw new Error("team1 and team2 are required");
    }

    // Check cache first
    const cacheKey = `match_trivia_${team1}_${team2}_${questionCount}`;
    const cached = checkCache(nk, cacheKey);
    
    if (cached) {
        return JSON.stringify({
            success: true,
            cached: true,
            questions: cached.questions
        });
    }

    // Generate match-specific questions
    const questions = generateMatchSpecificQuestions(team1, team2, questionCount, categories);

    // Cache the result
    cacheResult(nk, cacheKey, { questions }, 3600000); // 1 hour cache

    // Log request
    logAIRequest(nk, userId, "generate_match_trivia", { matchId, team1, team2, questionCount });

    logger.info(`Generated ${questions.length} AI trivia questions for ${team1} vs ${team2}`);

    return JSON.stringify({
        success: true,
        cached: false,
        questionCount: questions.length,
        questions
    });
}

/**
 * RPC: Generate player trivia
 * 
 * Payload: {
 *   playerName: string,
 *   team: string,
 *   questionCount: number
 * }
 */
function rpcGeneratePlayerTrivia(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { playerName, team, questionCount = 5 } = data;

    if (!playerName) {
        throw new Error("playerName is required");
    }

    // Generate player-specific questions
    const questions = generatePlayerQuestions(playerName, team, questionCount);

    // Log request
    logAIRequest(nk, userId, "generate_player_trivia", { playerName, team, questionCount });

    logger.info(`Generated ${questions.length} AI trivia questions for ${playerName}`);

    return JSON.stringify({
        success: true,
        playerName,
        questionCount: questions.length,
        questions
    });
}

/**
 * RPC: Get user's AI notes
 */
function rpcGetUserNotes(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { limit = 20 } = data;

    const notes = nk.storageList(userId, COLLECTIONS.AI_NOTES, limit, null);

    const result = (notes.objects || []).map(obj => ({
        noteId: obj.key,
        title: obj.value.title,
        url: obj.value.url,
        linkType: obj.value.linkType,
        status: obj.value.status,
        createdAt: obj.value.createdAt,
        totalQuizzes: obj.value.totalQuizzes || 0
    }));

    return JSON.stringify({
        notes: result,
        total: result.length
    });
}

/**
 * RPC: Generate debate topic
 * 
 * Payload: {
 *   topic: string,
 *   context: string
 * }
 */
function rpcGenerateDebateTopic(context, logger, nk, payload) {
    const userId = context.userId;
    
    if (!userId) {
        throw new Error("User must be authenticated");
    }

    let data;
    try {
        data = JSON.parse(payload);
    } catch (e) {
        throw new Error("Invalid JSON payload");
    }

    const { topic, context: topicContext } = data;

    if (!topic) {
        throw new Error("topic is required");
    }

    // Generate debate topic
    const debateTopic = generateDebateTopic(topic, topicContext);

    // Log request
    logAIRequest(nk, userId, "generate_debate", { topic });

    return JSON.stringify({
        success: true,
        debate: debateTopic
    });
}

// Helper functions
function detectLinkType(url) {
    const lowerUrl = url.toLowerCase();
    
    if (lowerUrl.includes("youtube.com") || lowerUrl.includes("youtu.be")) {
        return LINK_TYPES.YOUTUBE;
    }
    if (lowerUrl.includes("iplt20.com")) {
        return LINK_TYPES.IPL_OFFICIAL;
    }
    if (lowerUrl.includes("icc-cricket.com")) {
        return LINK_TYPES.ICC_OFFICIAL;
    }
    if (lowerUrl.includes("espncricinfo.com") || lowerUrl.includes("cricinfo.com")) {
        return LINK_TYPES.CRICINFO;
    }
    if (lowerUrl.includes("cricbuzz.com")) {
        return LINK_TYPES.CRICBUZZ;
    }
    if (lowerUrl.includes("twitter.com") || lowerUrl.includes("x.com")) {
        return LINK_TYPES.TWITTER;
    }
    if (lowerUrl.includes("reddit.com")) {
        return LINK_TYPES.REDDIT;
    }
    
    return LINK_TYPES.ARTICLE;
}

function generateTitleFromUrl(url) {
    try {
        const urlObj = new URL(url);
        const pathParts = urlObj.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
            return pathParts[pathParts.length - 1]
                .replace(/-/g, ' ')
                .replace(/_/g, ' ')
                .split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }
    } catch (e) {
        // ignore
    }
    return "Cricket Content";
}

function processNoteAsync(nk, logger, noteId, userId, url, linkType) {
    // In production, this would be a background job
    // For now, we'll simulate processing
    
    setTimeout(() => {
        try {
            const notes = nk.storageRead([{
                collection: COLLECTIONS.AI_NOTES,
                key: noteId,
                userId: userId
            }]);

            if (notes.length === 0) return;

            const note = notes[0].value;

            // Simulate content extraction based on link type
            note.content = generateMockContent(url, linkType);
            note.summary = `AI-generated summary of cricket content from ${linkType}`;
            note.status = "ready";
            note.processedAt = Date.now();

            nk.storageWrite([{
                collection: COLLECTIONS.AI_NOTES,
                key: noteId,
                userId: userId,
                value: note,
                permissionRead: 1,
                permissionWrite: 0
            }]);

            logger.info(`Note ${noteId} processing complete`);
        } catch (e) {
            logger.error(`Failed to process note ${noteId}: ${e.message}`);
        }
    }, 2000); // 2 second simulated delay
}

function generateMockContent(url, linkType) {
    const contents = {
        [LINK_TYPES.YOUTUBE]: "Cricket video analysis covering match highlights, player performances, and expert commentary.",
        [LINK_TYPES.IPL_OFFICIAL]: "Official IPL content with team statistics, player profiles, and match reports.",
        [LINK_TYPES.ICC_OFFICIAL]: "ICC official content covering international cricket, rankings, and tournament updates.",
        [LINK_TYPES.CRICINFO]: "Comprehensive cricket analysis with ball-by-ball commentary and statistical insights.",
        [LINK_TYPES.CRICBUZZ]: "Live cricket updates, news, and match analysis.",
        [LINK_TYPES.TWITTER]: "Cricket community discussions and real-time reactions.",
        [LINK_TYPES.REDDIT]: "Fan discussions and in-depth cricket analysis.",
        [LINK_TYPES.ARTICLE]: "General cricket news and analysis."
    };
    
    return contents[linkType] || contents[LINK_TYPES.ARTICLE];
}

function generateQuestionsFromNote(note, count, difficulty) {
    const questions = [];
    
    // Generate questions based on link type
    const questionTemplates = getQuestionTemplatesForLinkType(note.linkType);
    
    for (let i = 0; i < count && i < questionTemplates.length; i++) {
        const template = questionTemplates[i];
        questions.push({
            id: `ai_q_${Date.now()}_${i}`,
            question: template.question,
            options: template.options,
            correctIndex: template.correctIndex,
            explanation: template.explanation,
            difficulty,
            category: template.category,
            source: note.url
        });
    }
    
    return questions;
}

function getQuestionTemplatesForLinkType(linkType) {
    // In production, this would use actual AI-generated questions
    // For now, return cricket-specific templates
    return [
        {
            question: "Based on the content, which aspect of cricket was most emphasized?",
            options: ["Batting technique", "Bowling strategy", "Fielding positions", "Match statistics"],
            correctIndex: 3,
            explanation: "The content primarily focused on match statistics and performance data.",
            category: "analysis"
        },
        {
            question: "What key insight can be drawn from this cricket content?",
            options: ["Team selection importance", "Weather impact", "Pitch conditions", "Player fitness"],
            correctIndex: 0,
            explanation: "Team selection was highlighted as a crucial factor.",
            category: "strategy"
        },
        // Add more templates as needed
    ];
}

function generateMatchSpecificQuestions(team1, team2, count, categories) {
    const questions = [];
    
    // Team captains
    questions.push({
        id: `match_q_captain_${team1}`,
        question: `Who is the current captain of ${team1}?`,
        options: getCaptainOptions(team1),
        correctIndex: 0,
        explanation: `The current captain leads ${team1} in international cricket.`,
        difficulty: "easy",
        category: "teams"
    });

    questions.push({
        id: `match_q_captain_${team2}`,
        question: `Who is the current captain of ${team2}?`,
        options: getCaptainOptions(team2),
        correctIndex: 0,
        explanation: `The current captain leads ${team2} in international cricket.`,
        difficulty: "easy",
        category: "teams"
    });

    // Head-to-head
    questions.push({
        id: `match_q_h2h_${team1}_${team2}`,
        question: `Which team has won more T20I matches between ${team1} and ${team2}?`,
        options: [team1, team2, "Equal", "Never played"],
        correctIndex: Math.floor(Math.random() * 2),
        explanation: "Head-to-head records show competitive history between these teams.",
        difficulty: "medium",
        category: "head_to_head"
    });

    // Records
    questions.push({
        id: `match_q_record_1`,
        question: `What is the highest T20I score ever made by ${team1}?`,
        options: ["180-200", "200-220", "220-240", "240+"],
        correctIndex: 1,
        explanation: "Team scoring records vary based on batting conditions.",
        difficulty: "hard",
        category: "records"
    });

    // Fill remaining with general questions
    while (questions.length < count) {
        questions.push(...getGeneralMatchQuestions(team1, team2).slice(0, count - questions.length));
    }

    return questions.slice(0, count);
}

function generatePlayerQuestions(playerName, team, count) {
    return [
        {
            id: `player_q_1_${playerName}`,
            question: `What is ${playerName}'s primary role in the team?`,
            options: ["Batsman", "Bowler", "All-rounder", "Wicket-keeper"],
            correctIndex: 0,
            explanation: `${playerName} is known for their contribution in this role.`,
            difficulty: "easy",
            category: "players"
        },
        {
            id: `player_q_2_${playerName}`,
            question: `In which year did ${playerName} make their international debut?`,
            options: ["2018", "2019", "2020", "2021"],
            correctIndex: 1,
            explanation: `${playerName} began their international career in this year.`,
            difficulty: "medium",
            category: "players"
        }
    ].slice(0, count);
}

function getGeneralMatchQuestions(team1, team2) {
    return [
        {
            id: `general_match_1`,
            question: "What is the maximum number of overs in a T20 match for one team?",
            options: ["15", "18", "20", "25"],
            correctIndex: 2,
            explanation: "T20 stands for Twenty20, meaning 20 overs per side.",
            difficulty: "easy",
            category: "rules"
        },
        {
            id: `general_match_2`,
            question: "What happens in a Super Over?",
            options: [
                "Extra 5 overs for each team",
                "1 over each to break tie",
                "Match declared draw",
                "Coin toss decides winner"
            ],
            correctIndex: 1,
            explanation: "A Super Over is a tiebreaker format using 1 over per team.",
            difficulty: "medium",
            category: "rules"
        }
    ];
}

function generateDebateTopic(topic, context) {
    const debateTopics = {
        "best_batsman": {
            title: "Greatest T20 Batsman of All Time",
            proposition: "Virat Kohli is the greatest T20 batsman",
            opposition: "Other players have better T20 records",
            points: [
                "Consistency across formats",
                "Performance in pressure situations",
                "Strike rate and average comparison",
                "Impact on team success"
            ]
        },
        "best_bowler": {
            title: "Most Impactful T20 Bowler",
            proposition: "Death bowling is more crucial than powerplay bowling",
            opposition: "Powerplay wickets set the tone for the match",
            points: [
                "Economy rate in different phases",
                "Wicket-taking ability",
                "Performance against top batsmen",
                "Pressure handling"
            ]
        },
        default: {
            title: `Cricket Debate: ${topic}`,
            proposition: "One perspective on the topic",
            opposition: "Alternative viewpoint",
            points: [
                "Statistical evidence",
                "Historical context",
                "Current form",
                "Future potential"
            ]
        }
    };

    return debateTopics[topic.toLowerCase().replace(/ /g, '_')] || debateTopics.default;
}

function getCaptainOptions(team) {
    const captains = {
        "India": ["Suryakumar Yadav", "Rohit Sharma", "Hardik Pandya", "KL Rahul"],
        "Australia": ["Mitchell Marsh", "Pat Cummins", "Steve Smith", "David Warner"],
        "England": ["Jos Buttler", "Ben Stokes", "Harry Brook", "Joe Root"],
        "Pakistan": ["Babar Azam", "Shaheen Afridi", "Mohammad Rizwan", "Shadab Khan"],
        "South Africa": ["Aiden Markram", "David Miller", "Quinton de Kock", "Temba Bavuma"],
        "New Zealand": ["Kane Williamson", "Mitchell Santner", "Glenn Phillips", "Tim Southee"]
    };
    return captains[team] || ["Captain A", "Captain B", "Captain C", "Captain D"];
}

function checkCache(nk, cacheKey) {
    try {
        const cached = nk.storageRead([{
            collection: COLLECTIONS.AI_CACHE,
            key: cacheKey,
            userId: null
        }]);
        
        if (cached.length > 0) {
            const data = cached[0].value;
            if (Date.now() - data.cachedAt < data.ttl) {
                return data.data;
            }
        }
    } catch (e) {
        // ignore
    }
    return null;
}

function cacheResult(nk, cacheKey, data, ttl) {
    try {
        nk.storageWrite([{
            collection: COLLECTIONS.AI_CACHE,
            key: cacheKey,
            userId: null,
            value: {
                data,
                cachedAt: Date.now(),
                ttl
            },
            permissionRead: 2,
            permissionWrite: 0
        }]);
    } catch (e) {
        // ignore
    }
}

function logAIRequest(nk, userId, requestType, data) {
    try {
        nk.storageWrite([{
            collection: COLLECTIONS.AI_REQUESTS,
            key: `${requestType}_${Date.now()}`,
            userId: userId,
            value: {
                requestType,
                data,
                timestamp: Date.now()
            },
            permissionRead: 1,
            permissionWrite: 0
        }]);
    } catch (e) {
        // ignore
    }
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket AI Integration Module loaded");

    initializer.registerRpc("cricket_create_ai_note", rpcCreateAINote);
    initializer.registerRpc("cricket_generate_quiz_from_note", rpcGenerateQuizFromNote);
    initializer.registerRpc("cricket_generate_match_trivia", rpcGenerateMatchTrivia);
    initializer.registerRpc("cricket_generate_player_trivia", rpcGeneratePlayerTrivia);
    initializer.registerRpc("cricket_get_user_notes", rpcGetUserNotes);
    initializer.registerRpc("cricket_generate_debate", rpcGenerateDebateTopic);

    logger.info("Cricket AI Integration Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

