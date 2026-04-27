// QuizVerse — game-specific opcode + type definitions.
//
// Mirrors `schemas/multiplayer/games/quizverse.proto` (reserved range
// 0xC100-0xC1FF). If you change wire layout here, also update:
//   - schemas/multiplayer/games/quizverse.proto
//   - Assets/_QuizVerse/Scripts/MultiPlayer/Kernel/QvOpcode.cs
//   - SDKs/javascript/packages/multiplayer/src/games/quizverse/* (when the
//     JS plugin lands).

namespace QuizVerseGame {
  export var Op = {
    QUESTION_PROMPT:    0xC100,
    ANSWER:             0xC101,
    REVEAL:             0xC102,
    LEADERBOARD:        0xC103,
    LIFELINE_USE:       0xC104,
    LIFELINE_RESULT:    0xC105,
    AI_HOST_LINE:       0xC106,
    VOICE_TOGGLE:       0xC107,
    BOOST_APPLIED:      0xC108,
    REMATCH_REQUEST:    0xC109,
    REMATCH_ACCEPT:     0xC10A,
    // Friend-Battle team layer.
    TEAM_JOIN:          0xC10B,
    TEAM_STATE:         0xC10C,
    TEAM_SCORE_DELTA:   0xC10D,
    BATTLE_CONFIG:      0xC10E,
    TEAMS_READY:        0xC10F
  };

  // Battle modes — mirror Trivia.Friends.BattleMode.
  export var BattleMode = {
    UNSPECIFIED: 0,
    ONE_VS_ONE:  1,
    TWO_VS_TWO:  2,
    THREE_VS_THREE: 3,
    FOUR_VS_FOUR:   4,
    FIVE_VS_FIVE:   5
  };

  // Battle teams.
  export var BattleTeam = {
    NONE: 0,
    ONE:  1,
    TWO:  2
  };

  export interface ITeamMember {
    user_id: string;
    display_name: string;
    team: number;
  }

  export interface ITeamState {
    members: ITeamMember[];
    team1_name: string;
    team2_name: string;
    team1_score: number;
    team2_score: number;
    teams_ready: boolean;
    team_size: number;
  }

  export interface IBattleConfig {
    mode: number;             // BattleMode.*
    team1_name: string;
    team2_name: string;
    timeout_seconds: number;
    room_code: string;
    challenger_id: string;
    challenger_name: string;
    topics: string[];
  }

  export function teamSizeForMode(mode: number): number {
    switch (mode) {
      case BattleMode.ONE_VS_ONE:    return 1;
      case BattleMode.TWO_VS_TWO:    return 2;
      case BattleMode.THREE_VS_THREE:return 3;
      case BattleMode.FOUR_VS_FOUR:  return 4;
      case BattleMode.FIVE_VS_FIVE:  return 5;
      default: return 1;
    }
  }

  export function maxPlayersForMode(mode: number): number {
    return teamSizeForMode(mode) * 2;
  }

  export var Mode = {
    CLASSIC:        "quizverse:classic",
    FRIEND_BATTLE:  "quizverse:friend_battle",
    LINK_AND_PLAY:  "quizverse:link_and_play"
  };

  // Per-pack question shape. Authored offline (Hiro CMS / S3) and synced
  // into the `quizverse_packs` storage collection.
  export interface IQuestion {
    question_id: string;
    text:        string;
    options:     string[];
    correct_index: number;
    image_url?:  string;
    audio_url?:  string;
    category?:   string;
    difficulty?: number;
    explanation?:string;
  }

  export interface IPack {
    pack_id: string;
    questions: IQuestion[];
    locale?: string;
    revision?: number;
  }

  // Template-init parameters every QV match accepts. Persisted on the
  // match label for matchmaker filters.
  export interface IInit {
    mode: string;            // QuizVerseGame.Mode.*.
    pack_id: string;         // Storage key in `quizverse_packs`.
    questions_total: number; // Number of turns.
    per_question_ms: number; // Input window per question.
    room_code?: string;      // Friend / Link-and-Play code.
    ai_host_persona?: string;// "" disables AI host.
    enable_voice?: boolean;
    // Friend-Battle only. If `mode === Mode.FRIEND_BATTLE` the generator
    // will run team-aware logic; otherwise this is ignored.
    battle?: IBattleConfig;
  }

  export var DefaultInit: IInit = {
    mode: Mode.CLASSIC,
    pack_id: "default",
    questions_total: 10,
    per_question_ms: 15000,
    room_code: "",
    ai_host_persona: "",
    enable_voice: false
  };

  // Tiny in-memory seed bank so a brand new install can run smoke tests
  // before any production pack has been uploaded. Production packs live
  // in the `quizverse_packs` storage collection.
  export var SEED_PACK: IPack = {
    pack_id: "default",
    locale: "en",
    revision: 1,
    questions: [
      {
        question_id: "seed-001",
        text: "Which planet is known as the Red Planet?",
        options: ["Venus", "Mars", "Jupiter", "Saturn"],
        correct_index: 1,
        category: "science"
      },
      {
        question_id: "seed-002",
        text: "What is 2 + 2 * 2?",
        options: ["4", "6", "8", "2"],
        correct_index: 1,
        category: "math"
      },
      {
        question_id: "seed-003",
        text: "Who wrote 'Romeo and Juliet'?",
        options: ["Dickens", "Twain", "Shakespeare", "Austen"],
        correct_index: 2,
        category: "literature"
      }
    ]
  };
}
