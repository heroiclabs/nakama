// badge_seed_definitions.js - Seed data for Legendary + Seasonal badges
// Run once via admin RPC or directly call badges_bulk_create
// Spec: MRS §12 Legendary (3 Phase-6 remaining) + §13 Seasonal (5)

/**
 * Call this as a Nakama RPC: badges_bulk_create
 * Payload: { game_id: "quizverse", badges: [...] }
 */

var LEGENDARY_AND_SEASONAL_BADGES = {
    game_id: "quizverse",
    badges: [
        // ─── 3 REMAINING LEGENDARY BADGES (Phase 6) ───────────────────────
        {
            badge_id: "legend_topic_master",
            title: "Topic Master",
            description: "Master all 4 core topics with 90%+ accuracy in each",
            icon_url: "badges/legendary/topic_master.png",
            category: "special",
            rarity: "legendary",
            type: "tiered",
            target: 4,
            hidden: true,
            points: 500,
            order: 100,
            rewards: { coins: 1000, xp: 500, collectables: ["frame_golden_brain"] },
            unlock_criteria: { event: "topic_mastery", threshold: 4 }
        },
        {
            badge_id: "legend_cross_topic",
            title: "Cross-Topic Champion",
            description: "Win 50 quizzes across at least 3 different topics",
            icon_url: "badges/legendary/cross_topic.png",
            category: "quiz",
            rarity: "legendary",
            type: "achievement",
            target: 50,
            hidden: false,
            points: 400,
            order: 101,
            rewards: { coins: 750, xp: 400, collectables: ["title_champion"] },
            unlock_criteria: { event: "quiz_complete", min_topics: 3 }
        },
        {
            badge_id: "legend_polymath",
            title: "Polymath",
            description: "Answer 1000 questions correctly across Health, Love, Career & General",
            icon_url: "badges/legendary/polymath.png",
            category: "quiz",
            rarity: "legendary",
            type: "achievement",
            target: 1000,
            hidden: false,
            points: 600,
            order: 102,
            rewards: { coins: 1500, xp: 750, collectables: ["border_rainbow", "title_polymath"] },
            unlock_criteria: { event: "correct_answer", all_topics: true }
        },

        // ─── 5 SEASONAL BADGES ─────────────────────────────────────────────
        {
            badge_id: "seasonal_spring",
            title: "Spring Bloom",
            description: "Complete 10 quizzes during Spring season (Mar-May)",
            icon_url: "badges/seasonal/spring.png",
            category: "seasonal",
            rarity: "epic",
            type: "seasonal",
            target: 10,
            hidden: false,
            points: 200,
            order: 200,
            rewards: { coins: 300, xp: 150 },
            unlock_criteria: { event: "quiz_complete", season: "spring" }
        },
        {
            badge_id: "seasonal_summer",
            title: "Summer Heat",
            description: "Win 5 multiplayer matches during Summer (Jun-Aug)",
            icon_url: "badges/seasonal/summer.png",
            category: "seasonal",
            rarity: "epic",
            type: "seasonal",
            target: 5,
            hidden: false,
            points: 200,
            order: 201,
            rewards: { coins: 300, xp: 150 },
            unlock_criteria: { event: "match_win", season: "summer" }
        },
        {
            badge_id: "seasonal_monsoon",
            title: "Monsoon Scholar",
            description: "Complete 15 Smart Review sessions during Monsoon (Jul-Sep)",
            icon_url: "badges/seasonal/monsoon.png",
            category: "seasonal",
            rarity: "epic",
            type: "seasonal",
            target: 15,
            hidden: false,
            points: 250,
            order: 202,
            rewards: { coins: 400, xp: 200 },
            unlock_criteria: { event: "review_session", season: "monsoon" }
        },
        {
            badge_id: "seasonal_autumn",
            title: "Autumn Harvest",
            description: "Maintain a 14-day streak during Autumn (Oct-Nov)",
            icon_url: "badges/seasonal/autumn.png",
            category: "seasonal",
            rarity: "legendary",
            type: "seasonal",
            target: 14,
            hidden: false,
            points: 300,
            order: 203,
            rewards: { coins: 500, xp: 250 },
            unlock_criteria: { event: "daily_login_streak", season: "autumn" }
        },
        {
            badge_id: "seasonal_winter",
            title: "Winter Warrior",
            description: "Achieve 3 perfect quiz scores during Winter (Dec-Feb)",
            icon_url: "badges/seasonal/winter.png",
            category: "seasonal",
            rarity: "legendary",
            type: "seasonal",
            target: 3,
            hidden: false,
            points: 300,
            order: 204,
            rewards: { coins: 500, xp: 250, collectables: ["frame_snowflake"] },
            unlock_criteria: { event: "perfect_quiz", season: "winter" }
        }
    ]
};

// To seed: call badges_bulk_create RPC with the above payload
// Example: nk.rpc("badges_bulk_create", JSON.stringify(LEGENDARY_AND_SEASONAL_BADGES))
