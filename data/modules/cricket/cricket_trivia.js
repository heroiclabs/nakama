/**
 * Cricket Trivia Module
 * 
 * Handles AI-powered trivia generation and scoring for Cricket VR Mob:
 * - Generate trivia questions using AI APIs
 * - Score trivia responses
 * - Submit scores to leaderboards
 * - Track trivia history
 * 
 * Integrates with IntelliVerse-X AI APIs:
 * - ai-prompts for question generation
 * - ai-enhancement for content enhancement
 * 
 * Game ID: 78244246-1e9e-4e0f-a8a2-7447d5b0284e
 */

const CRICKET_GAME_ID = "78244246-1e9e-4e0f-a8a2-7447d5b0284e";

// AI API Configuration (would be environment variables in production)
const AI_API_BASE = "https://api.intelliversex.com";
const AI_API_ENDPOINTS = {
    GENERATE_QUIZ: "/ai-prompts/cricket/quiz",
    GENERATE_TRIVIA: "/ai-prompts/cricket/trivia",
    ENHANCE_QUESTION: "/ai-enhancement/improve",
    CREATE_FROM_URL: "/ai-notes/create-from-url"
};

// Collections
const COLLECTIONS = {
    TRIVIA_SESSIONS: "cricket_trivia_sessions",
    TRIVIA_QUESTIONS: "cricket_trivia_questions",
    TRIVIA_HISTORY: "cricket_trivia_history",
    AI_GENERATED: "cricket_ai_generated"
};

// Leaderboard
const LEADERBOARDS = {
    DAILY_TRIVIA: "cricket_daily_trivia",
    ALL_TIME: "cricket_all_time_master"
};

// Scoring configuration
const SCORING = {
    CORRECT_ANSWER: 100,
    SPEED_BONUS_MAX: 50,
    STREAK_MULTIPLIER: 0.1,
    DIFFICULTY_MULTIPLIER: {
        easy: 1.0,
        medium: 1.5,
        hard: 2.0,
        expert: 3.0
    }
};

// Question categories for cricket
const QUESTION_CATEGORIES = {
    GENERAL: "general_cricket",
    WORLD_CUP: "world_cup",
    IPL: "ipl",
    PLAYERS: "players",
    RECORDS: "records",
    RULES: "rules",
    HISTORY: "history",
    TEAMS: "teams",
    VENUES: "venues",
    HEAD_TO_HEAD: "head_to_head"
};

/**
 * RPC: Start a trivia session
 * 
 * Payload: {
 *   matchId: string (optional - for match-specific trivia),
 *   category: string,
 *   difficulty: string,
 *   questionCount: number
 * }
 */
function rpcStartTriviaSession(context, logger, nk, payload) {
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

    const { 
        matchId, 
        category = QUESTION_CATEGORIES.GENERAL, 
        difficulty = "medium",
        questionCount = 10 
    } = data;

    const sessionId = `trivia_${userId}_${Date.now()}`;
    const now = Date.now();

    // Generate questions
    let questions = [];
    
    if (matchId) {
        // Generate match-specific questions
        questions = generateMatchQuestions(nk, matchId, questionCount, difficulty);
    } else {
        // Generate category questions
        questions = generateCategoryQuestions(nk, category, questionCount, difficulty);
    }

    const session = {
        sessionId,
        userId,
        matchId,
        category,
        difficulty,
        questions: questions.map(q => ({
            ...q,
            answeredCorrectly: null,
            answerTime: null,
            pointsEarned: 0
        })),
        currentIndex: 0,
        score: 0,
        correctCount: 0,
        streak: 0,
        maxStreak: 0,
        startTime: now,
        isComplete: false
    };

    // Store session
    nk.storageWrite([{
        collection: COLLECTIONS.TRIVIA_SESSIONS,
        key: sessionId,
        userId: userId,
        value: session,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} started trivia session: ${sessionId}`);

    // Return first question only
    return JSON.stringify({
        sessionId,
        totalQuestions: questions.length,
        currentQuestion: 1,
        question: sanitizeQuestion(questions[0]),
        category,
        difficulty,
        matchId
    });
}

/**
 * RPC: Submit trivia answer
 * 
 * Payload: {
 *   sessionId: string,
 *   questionIndex: number,
 *   answerIndex: number,
 *   answerTime: number (ms)
 * }
 */
function rpcSubmitTriviaAnswer(context, logger, nk, payload) {
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

    const { sessionId, questionIndex, answerIndex, answerTime } = data;

    if (!sessionId || answerIndex === undefined) {
        throw new Error("sessionId and answerIndex are required");
    }

    // Get session
    const sessions = nk.storageRead([{
        collection: COLLECTIONS.TRIVIA_SESSIONS,
        key: sessionId,
        userId: userId
    }]);

    if (sessions.length === 0) {
        throw new Error("Session not found");
    }

    const session = sessions[0].value;

    if (session.isComplete) {
        throw new Error("Session is already complete");
    }

    const qIndex = questionIndex !== undefined ? questionIndex : session.currentIndex;
    const question = session.questions[qIndex];

    if (!question) {
        throw new Error("Invalid question index");
    }

    if (question.answeredCorrectly !== null) {
        throw new Error("Question already answered");
    }

    // Check answer
    const isCorrect = answerIndex === question.correctIndex;
    
    // Calculate points
    let points = 0;
    if (isCorrect) {
        points = SCORING.CORRECT_ANSWER;
        
        // Speed bonus (max 50 points for answers under 5 seconds)
        const speedBonus = Math.max(0, SCORING.SPEED_BONUS_MAX - Math.floor(answerTime / 100));
        points += speedBonus;
        
        // Difficulty multiplier
        const diffMultiplier = SCORING.DIFFICULTY_MULTIPLIER[session.difficulty] || 1.0;
        points = Math.floor(points * diffMultiplier);
        
        // Streak bonus
        session.streak++;
        const streakBonus = Math.floor(points * session.streak * SCORING.STREAK_MULTIPLIER);
        points += streakBonus;
        
        session.correctCount++;
        session.maxStreak = Math.max(session.maxStreak, session.streak);
    } else {
        session.streak = 0;
    }

    // Update question
    question.answeredCorrectly = isCorrect;
    question.answerTime = answerTime;
    question.pointsEarned = points;
    question.userAnswer = answerIndex;

    session.score += points;
    session.currentIndex++;

    // Check if session is complete
    const isLastQuestion = session.currentIndex >= session.questions.length;
    if (isLastQuestion) {
        session.isComplete = true;
        session.endTime = Date.now();
        session.duration = session.endTime - session.startTime;
        
        // Submit score to leaderboard
        submitTriviaScore(nk, userId, session);
        
        // Track engagement if match-specific
        if (session.matchId) {
            trackTriviaEngagement(nk, userId, session);
        }
        
        // Store in history
        storeTriviaHistory(nk, userId, session);
    }

    // Save session
    nk.storageWrite([{
        collection: COLLECTIONS.TRIVIA_SESSIONS,
        key: sessionId,
        userId: userId,
        value: session,
        permissionRead: 1,
        permissionWrite: 0
    }]);

    // Prepare response
    const response = {
        isCorrect,
        correctIndex: question.correctIndex,
        pointsEarned: points,
        totalScore: session.score,
        streak: session.streak,
        explanation: question.explanation
    };

    if (!isLastQuestion) {
        response.nextQuestion = sanitizeQuestion(session.questions[session.currentIndex]);
        response.currentQuestion = session.currentIndex + 1;
        response.totalQuestions = session.questions.length;
    } else {
        response.sessionComplete = true;
        response.finalScore = session.score;
        response.correctCount = session.correctCount;
        response.totalQuestions = session.questions.length;
        response.maxStreak = session.maxStreak;
        response.duration = session.duration;
        response.accuracy = Math.floor((session.correctCount / session.questions.length) * 100);
    }

    return JSON.stringify(response);
}

/**
 * RPC: Generate AI trivia from URL
 * 
 * Payload: {
 *   url: string,
 *   linkType: string (youtube, article, etc),
 *   questionCount: number
 * }
 */
function rpcGenerateAITrivia(context, logger, nk, payload) {
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

    const { url, linkType = "article", questionCount = 10 } = data;

    if (!url) {
        throw new Error("URL is required");
    }

    // For now, generate mock AI questions based on URL type
    // In production, this would call the actual AI API
    const questions = generateAIQuestionsFromUrl(url, linkType, questionCount);

    // Store generated questions
    const generationId = `ai_${Date.now()}`;
    nk.storageWrite([{
        collection: COLLECTIONS.AI_GENERATED,
        key: generationId,
        userId: userId,
        value: {
            url,
            linkType,
            questions,
            generatedAt: Date.now()
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);

    logger.info(`User ${userId} generated ${questions.length} AI trivia questions from ${url}`);

    return JSON.stringify({
        success: true,
        generationId,
        questionCount: questions.length,
        questions: questions.map(sanitizeQuestion)
    });
}

/**
 * RPC: Get trivia leaderboard
 */
function rpcGetTriviaLeaderboard(context, logger, nk, payload) {
    const userId = context.userId;
    
    let data = {};
    try {
        data = payload ? JSON.parse(payload) : {};
    } catch (e) {
        // ignore
    }

    const { timeframe = "daily", limit = 50 } = data;

    const leaderboardId = timeframe === "daily" ? LEADERBOARDS.DAILY_TRIVIA : LEADERBOARDS.ALL_TIME;

    const records = nk.leaderboardRecordsList(leaderboardId, null, limit, null, 0);
    
    const entries = (records.records || []).map(record => ({
        rank: record.rank,
        userId: record.ownerId,
        username: record.username?.value || "Anonymous",
        score: record.score,
        metadata: record.metadata ? JSON.parse(record.metadata) : null
    }));

    // Get user's rank
    let userRank = null;
    let userScore = 0;
    
    if (userId) {
        const aroundOwner = nk.leaderboardRecordsList(leaderboardId, [userId], 1, null, 0);
        if (aroundOwner.records && aroundOwner.records.length > 0) {
            userRank = aroundOwner.records[0].rank;
            userScore = aroundOwner.records[0].score;
        }
    }

    return JSON.stringify({
        leaderboardId,
        timeframe,
        entries,
        userRank,
        userScore
    });
}

/**
 * RPC: Get trivia history
 */
function rpcGetTriviaHistory(context, logger, nk, payload) {
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

    const history = nk.storageList(userId, COLLECTIONS.TRIVIA_HISTORY, limit, null);

    const sessions = (history.objects || []).map(obj => ({
        sessionId: obj.key,
        ...obj.value
    }));

    // Calculate stats
    const stats = {
        totalSessions: sessions.length,
        totalScore: sessions.reduce((sum, s) => sum + (s.score || 0), 0),
        totalCorrect: sessions.reduce((sum, s) => sum + (s.correctCount || 0), 0),
        totalQuestions: sessions.reduce((sum, s) => sum + (s.totalQuestions || 0), 0),
        averageAccuracy: 0,
        bestScore: 0,
        longestStreak: 0
    };

    if (stats.totalQuestions > 0) {
        stats.averageAccuracy = Math.floor((stats.totalCorrect / stats.totalQuestions) * 100);
    }
    
    for (const session of sessions) {
        stats.bestScore = Math.max(stats.bestScore, session.score || 0);
        stats.longestStreak = Math.max(stats.longestStreak, session.maxStreak || 0);
    }

    return JSON.stringify({
        history: sessions,
        stats
    });
}

// Question generation functions
function generateMatchQuestions(nk, matchId, count, difficulty) {
    // Get match info
    const matchInfo = nk.storageRead([{
        collection: "cricket_schedules",
        key: matchId,
        userId: null
    }]);

    const match = matchInfo.length > 0 ? matchInfo[0].value : null;

    const questions = [];

    if (match) {
        const team1 = match.team1;
        const team2 = match.team2;
        const venue = match.venue;

        // Team 1 captain question
        questions.push({
            id: `q_captain_${team1}`,
            question: `Who is the captain of ${team1}?`,
            options: getCaptainOptions(team1),
            correctIndex: 0,
            category: "teams",
            difficulty,
            points: SCORING.CORRECT_ANSWER,
            explanation: `The current captain leads ${team1} in this tournament.`
        });

        // Team 2 captain question
        questions.push({
            id: `q_captain_${team2}`,
            question: `Who is the captain of ${team2}?`,
            options: getCaptainOptions(team2),
            correctIndex: 0,
            category: "teams",
            difficulty,
            points: SCORING.CORRECT_ANSWER,
            explanation: `The current captain leads ${team2} in this tournament.`
        });

        // Head-to-head question
        questions.push({
            id: `q_h2h_${team1}_${team2}`,
            question: `In T20 internationals, which team has a better head-to-head record between ${team1} and ${team2}?`,
            options: [team1, team2, "Equal records", "Never played in T20I"],
            correctIndex: 0, // Would need real data
            category: "head_to_head",
            difficulty,
            points: SCORING.CORRECT_ANSWER,
            explanation: "Head-to-head records provide insight into historical performance."
        });

        // Venue question
        if (venue) {
            questions.push({
                id: `q_venue_${venue}`,
                question: `What is the approximate seating capacity of ${venue}?`,
                options: ["30,000-40,000", "40,000-50,000", "50,000-60,000", "60,000+"],
                correctIndex: 1, // Would need real data
                category: "venues",
                difficulty,
                points: SCORING.CORRECT_ANSWER,
                explanation: `${venue} is one of the iconic cricket stadiums.`
            });
        }

        // Tournament question
        const tournamentId = match.tournamentId || "WC2026";
        questions.push({
            id: `q_tournament_${tournamentId}`,
            question: tournamentId.includes("IPL") 
                ? "Which team won the most IPL titles?"
                : "Which country has won the most T20 World Cups?",
            options: tournamentId.includes("IPL")
                ? ["Mumbai Indians", "Chennai Super Kings", "Kolkata Knight Riders", "Royal Challengers Bangalore"]
                : ["West Indies", "India", "England", "Australia"],
            correctIndex: 0,
            category: "history",
            difficulty,
            points: SCORING.CORRECT_ANSWER,
            explanation: "Historical knowledge helps predict future performances."
        });
    }

    // Fill remaining with general cricket questions
    while (questions.length < count) {
        questions.push(...getGeneralCricketQuestions(difficulty, count - questions.length));
    }

    // Shuffle and return requested count
    return shuffleArray(questions).slice(0, count);
}

function generateCategoryQuestions(nk, category, count, difficulty) {
    const questions = [];

    switch (category) {
        case QUESTION_CATEGORIES.WORLD_CUP:
            questions.push(...getWorldCupQuestions(difficulty, count));
            break;
        case QUESTION_CATEGORIES.IPL:
            questions.push(...getIPLQuestions(difficulty, count));
            break;
        case QUESTION_CATEGORIES.PLAYERS:
            questions.push(...getPlayerQuestions(difficulty, count));
            break;
        case QUESTION_CATEGORIES.RECORDS:
            questions.push(...getRecordQuestions(difficulty, count));
            break;
        default:
            questions.push(...getGeneralCricketQuestions(difficulty, count));
    }

    return shuffleArray(questions).slice(0, count);
}

function generateAIQuestionsFromUrl(url, linkType, count) {
    // This would call the AI API in production
    // For now, generate contextual questions based on URL patterns
    
    const questions = [];
    
    if (url.includes("youtube")) {
        questions.push({
            id: `ai_yt_${Date.now()}_1`,
            question: "Based on the video, what was the key turning point in the match?",
            options: ["First powerplay wickets", "Middle overs run rate", "Death over boundaries", "Final over drama"],
            correctIndex: 3,
            category: "analysis",
            difficulty: "medium",
            points: 150,
            explanation: "Video analysis helps understand match dynamics.",
            source: url
        });
    }

    // Add more AI-style questions
    for (let i = questions.length; i < count; i++) {
        questions.push({
            id: `ai_gen_${Date.now()}_${i}`,
            question: `Cricket trivia question ${i + 1} from content analysis`,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctIndex: Math.floor(Math.random() * 4),
            category: "ai_generated",
            difficulty: "medium",
            points: 100,
            explanation: "AI-generated based on content analysis.",
            source: url
        });
    }

    return questions;
}

// Question bank functions
function getGeneralCricketQuestions(difficulty, count) {
    const questions = [
        {
            id: "general_1",
            question: "How many players are there in a cricket team on the field?",
            options: ["9", "10", "11", "12"],
            correctIndex: 2,
            category: "rules",
            difficulty: "easy",
            explanation: "Each team has 11 players on the field."
        },
        {
            id: "general_2",
            question: "What is a 'yorker' in cricket?",
            options: ["A ball that bounces twice", "A full-pitched ball at the batsman's feet", "A ball that goes over the batsman's head", "A slow delivery"],
            correctIndex: 1,
            category: "rules",
            difficulty: "easy",
            explanation: "A yorker is aimed at the base of the stumps."
        },
        {
            id: "general_3",
            question: "Which country hosted the first ever Cricket World Cup in 1975?",
            options: ["India", "Australia", "England", "West Indies"],
            correctIndex: 2,
            category: "history",
            difficulty: "medium",
            explanation: "England hosted the first Cricket World Cup in 1975."
        },
        {
            id: "general_4",
            question: "What is the maximum number of overs in a T20 match for one team?",
            options: ["15", "18", "20", "25"],
            correctIndex: 2,
            category: "rules",
            difficulty: "easy",
            explanation: "T20 stands for Twenty20, meaning 20 overs per side."
        },
        {
            id: "general_5",
            question: "Who holds the record for the highest individual score in T20 internationals?",
            options: ["Chris Gayle", "Rohit Sharma", "Aaron Finch", "Hazratullah Zazai"],
            correctIndex: 1,
            category: "records",
            difficulty: "hard",
            explanation: "Rohit Sharma scored 118 runs against Sri Lanka in 2017."
        }
    ];

    return questions.filter(q => {
        if (difficulty === "easy") return q.difficulty === "easy";
        if (difficulty === "hard") return q.difficulty !== "easy";
        return true;
    }).slice(0, count);
}

function getWorldCupQuestions(difficulty, count) {
    const questions = [
        {
            id: "wc_1",
            question: "Which team won the T20 World Cup 2024?",
            options: ["India", "England", "Pakistan", "Australia"],
            correctIndex: 0,
            category: "world_cup",
            difficulty: "easy",
            explanation: "India won their second T20 World Cup in 2024."
        },
        {
            id: "wc_2",
            question: "Who was the Player of the Tournament in T20 World Cup 2024?",
            options: ["Virat Kohli", "Jasprit Bumrah", "Rohit Sharma", "Rashid Khan"],
            correctIndex: 1,
            category: "world_cup",
            difficulty: "medium",
            explanation: "Jasprit Bumrah's exceptional bowling earned him the award."
        },
        {
            id: "wc_3",
            question: "Which countries are co-hosting the T20 World Cup 2026?",
            options: ["India & Sri Lanka", "USA & West Indies", "England & Ireland", "Australia & New Zealand"],
            correctIndex: 0,
            category: "world_cup",
            difficulty: "medium",
            explanation: "India and Sri Lanka will co-host the 2026 edition."
        }
    ];

    return questions.slice(0, count);
}

function getIPLQuestions(difficulty, count) {
    const questions = [
        {
            id: "ipl_1",
            question: "Which team won IPL 2024?",
            options: ["Chennai Super Kings", "Mumbai Indians", "Kolkata Knight Riders", "Sunrisers Hyderabad"],
            correctIndex: 2,
            category: "ipl",
            difficulty: "easy",
            explanation: "KKR won their third IPL title in 2024."
        },
        {
            id: "ipl_2",
            question: "Who is the all-time leading run scorer in IPL history?",
            options: ["Rohit Sharma", "Virat Kohli", "David Warner", "Shikhar Dhawan"],
            correctIndex: 1,
            category: "ipl",
            difficulty: "medium",
            explanation: "Virat Kohli holds the record for most IPL runs."
        },
        {
            id: "ipl_3",
            question: "Which bowler has taken the most wickets in IPL history?",
            options: ["Lasith Malinga", "Amit Mishra", "Yuzvendra Chahal", "Dwayne Bravo"],
            correctIndex: 2,
            category: "ipl",
            difficulty: "hard",
            explanation: "Yuzvendra Chahal holds the purple cap record."
        }
    ];

    return questions.slice(0, count);
}

function getPlayerQuestions(difficulty, count) {
    return [
        {
            id: "player_1",
            question: "Which cricketer is known as the 'God of Cricket'?",
            options: ["Virat Kohli", "Sachin Tendulkar", "Brian Lara", "Ricky Ponting"],
            correctIndex: 1,
            category: "players",
            difficulty: "easy",
            explanation: "Sachin Tendulkar earned this title for his legendary career."
        },
        {
            id: "player_2",
            question: "Who hit the fastest century in T20 international cricket?",
            options: ["David Miller", "Rohit Sharma", "Chris Gayle", "Aaron Finch"],
            correctIndex: 0,
            category: "players",
            difficulty: "hard",
            explanation: "David Miller scored the fastest T20I century in 35 balls."
        }
    ].slice(0, count);
}

function getRecordQuestions(difficulty, count) {
    return [
        {
            id: "record_1",
            question: "What is the highest team score in T20 international cricket?",
            options: ["260/5", "278/3", "263/3", "281/3"],
            correctIndex: 1,
            category: "records",
            difficulty: "hard",
            explanation: "Afghanistan scored 278/3 against Ireland in 2019."
        }
    ].slice(0, count);
}

function getCaptainOptions(team) {
    const captains = {
        "India": ["Suryakumar Yadav", "Rohit Sharma", "Hardik Pandya", "KL Rahul"],
        "Australia": ["Mitchell Marsh", "Pat Cummins", "Steve Smith", "David Warner"],
        "England": ["Jos Buttler", "Ben Stokes", "Harry Brook", "Joe Root"],
        "Pakistan": ["Babar Azam", "Shaheen Afridi", "Mohammad Rizwan", "Shadab Khan"],
        "South Africa": ["Aiden Markram", "David Miller", "Quinton de Kock", "Temba Bavuma"],
        "New Zealand": ["Kane Williamson", "Mitchell Santner", "Glenn Phillips", "Tim Southee"],
        "West Indies": ["Rovman Powell", "Nicholas Pooran", "Shai Hope", "Jason Holder"],
        "Sri Lanka": ["Wanindu Hasaranga", "Charith Asalanka", "Kusal Mendis", "Dasun Shanaka"],
        "CSK": ["Ruturaj Gaikwad", "MS Dhoni", "Ravindra Jadeja", "Devon Conway"],
        "MI": ["Hardik Pandya", "Rohit Sharma", "Suryakumar Yadav", "Ishan Kishan"],
        "RCB": ["Virat Kohli", "Faf du Plessis", "Glenn Maxwell", "Rajat Patidar"],
        "KKR": ["Shreyas Iyer", "Nitish Rana", "Andre Russell", "Sunil Narine"]
    };
    return captains[team] || ["Captain A", "Captain B", "Captain C", "Captain D"];
}

// Helper functions
function sanitizeQuestion(question) {
    // Remove correctIndex from returned question for client
    const { correctIndex, explanation, ...safeQuestion } = question;
    return safeQuestion;
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function submitTriviaScore(nk, userId, session) {
    const metadata = {
        category: session.category,
        difficulty: session.difficulty,
        correctCount: session.correctCount,
        totalQuestions: session.questions.length,
        maxStreak: session.maxStreak,
        accuracy: Math.floor((session.correctCount / session.questions.length) * 100)
    };

    // Submit to daily leaderboard
    nk.leaderboardRecordWrite(LEADERBOARDS.DAILY_TRIVIA, userId, null, session.score, null, JSON.stringify(metadata));
    
    // Submit to all-time leaderboard
    nk.leaderboardRecordWrite(LEADERBOARDS.ALL_TIME, userId, null, session.score, null, JSON.stringify(metadata));
}

function trackTriviaEngagement(nk, userId, session) {
    // Track engagement for match-specific trivia
    const engagementKey = `${userId}_${session.matchId}`;
    
    const existing = nk.storageRead([{
        collection: "cricket_engagement",
        key: engagementKey,
        userId: userId
    }]);
    
    const engagement = existing.length > 0 ? existing[0].value : {
        matchId: session.matchId,
        events: [],
        score: 0,
        completedActions: []
    };
    
    engagement.events.push({
        type: "complete_trivia",
        score: session.score,
        accuracy: Math.floor((session.correctCount / session.questions.length) * 100),
        timestamp: Date.now()
    });
    
    engagement.score += 25;
    if (!engagement.completedActions.includes("complete_trivia")) {
        engagement.completedActions.push("complete_trivia");
    }
    
    nk.storageWrite([{
        collection: "cricket_engagement",
        key: engagementKey,
        userId: userId,
        value: engagement,
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

function storeTriviaHistory(nk, userId, session) {
    nk.storageWrite([{
        collection: COLLECTIONS.TRIVIA_HISTORY,
        key: session.sessionId,
        userId: userId,
        value: {
            category: session.category,
            difficulty: session.difficulty,
            matchId: session.matchId,
            score: session.score,
            correctCount: session.correctCount,
            totalQuestions: session.questions.length,
            maxStreak: session.maxStreak,
            duration: session.duration,
            completedAt: session.endTime
        },
        permissionRead: 1,
        permissionWrite: 0
    }]);
}

// Register RPCs
function InitModule(ctx, logger, nk, initializer) {
    logger.info("Cricket Trivia Module loaded");

    initializer.registerRpc("cricket_start_trivia", rpcStartTriviaSession);
    initializer.registerRpc("cricket_submit_answer", rpcSubmitTriviaAnswer);
    initializer.registerRpc("cricket_generate_ai_trivia", rpcGenerateAITrivia);
    initializer.registerRpc("cricket_get_trivia_leaderboard", rpcGetTriviaLeaderboard);
    initializer.registerRpc("cricket_get_trivia_history", rpcGetTriviaHistory);

    logger.info("Cricket Trivia Module initialized successfully");
}

!InitModule.toString().includes("InitModule") || InitModule;

