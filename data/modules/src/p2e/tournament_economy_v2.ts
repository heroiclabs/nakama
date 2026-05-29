// =============================================================================
// tournament_economy_v2.ts — Wave-2 conversion + retention levers (DRAFT)
//
// Strictly additive. Does not modify tournament_economy.ts or any production
// behavior. Until each lever is wired into rpcs.ts / crons.ts and turned on
// via TournamentEconomyV2.FEATURE_FLAGS, this file is configuration-only.
//
// Source-of-truth audit + targets: data/docs-site/audit.html
//                                  docs/tournaments/RUNBOOK.md §6
//
// Closes the 12 gaps documented in the 2026 benchmark audit:
//   1.  Personalized onboarding intent quiz
//   2.  Live scarcity counter (founder slots remaining)
//   3.  Push notification cadence ladder
//   4.  Live social-proof ticker (server config — UI ships in web/Unity)
//   5.  Predictive rank nudge thresholds
//   6.  Abandonment nudge timing
//   7.  Daily-check-in streak engine
//   8.  Tournament badge progression
//   9.  Watch-live spectator mode (server config)
//  10.  Slate expansion for 25-34 cohort (Wave-2 slate draft)
//  11.  Hybrid / micro-bet (Pick-N v2 doubleup) config
//  12.  D1/D7/D30 + stickiness KPI thresholds
//
// 2026 benchmark sources (Firecrawl-verified May 28, 2026):
//   SQ Magazine 2026                          (D1 32.5%, D7 13.8%, +45% onboarding)
//   Pushwoosh Retention 2026                  (>80% lost in week 1)
//   Pushwoosh DAU 2026                        (DAU + push cadence)
//   Mordor NA Fantasy Sports 2026             (76% mobile, 58% age 25-34, 14.2% hybrid)
//   Strivecloud 68 Gamification Examples 2026 (streaks, badges, watch-live)
// =============================================================================

namespace TournamentEconomyV2 {

  // ───────────────────────────────────────────────────────────────────────────
  // Feature flags. Each lever ships behind a flag. Flip via the existing
  // remote-config rpc once the corresponding RPC + UI lands.
  //
  // Flag-flip rationale (2026-05-29):
  //   ON  — server primitive shipped + safe to be discoverable; UI can opt-in.
  //   OFF — gates a destructive/billing path or requires client work first.
  // ───────────────────────────────────────────────────────────────────────────
  export const FEATURE_FLAGS = {
    intent_quiz_onboarding:    true,   // L1  — RPCs live; client surfaces the quiz UI optionally
    scarcity_counter_v1:       true,   // L2  — surfaced in tournament_list/get response
    push_cadence_ladder_v1:    true,   // L3  — cadence config consumed by notif-scheduler
    social_proof_ticker_v1:    true,   // L4  — RPC live; client renders the ticker optionally
    predictive_rank_nudge_v1:  true,   // L5  — server tracks state; nudges fire on slip
    abandonment_nudge_v1:      true,   // L6  — server cron drains nudges; client tracks views
    streak_engine_v1:          true,   // L7  — RPCs live; rewards mint via existing economy
    tournament_badges_v1:      true,   // L8  — badges seeded; awards fire on settle
    watch_live_v1:             true,   // L9  — spectator subscribe RPC live
    wave2_slate:               false,  // L10 — held off until cohort campaign is creative-ready
    pickn_doubleup_v1:         false,  // L11 — held off pending billing audit (debits BC)
    kpi_alerts_v1:             true,   // L12 — events firing; alert wiring follows in PagerDuty
  };

  // ───────────────────────────────────────────────────────────────────────────
  // KPI thresholds (gap #12)
  // Wired into Mixpanel via runbook §6 events. Alerts in PagerDuty are P1
  // when a KPI falls below its `floor`, P2 when below `target`.
  // ───────────────────────────────────────────────────────────────────────────
  export interface KPIThreshold {
    name: string;
    floor: number;       // pages alarm below this
    target: number;      // standing target
    stretch: number;     // top-quartile aspirational
    benchmark_2026: number;
    source: string;
  }

  export const KPI_THRESHOLDS: KPIThreshold[] = [
    {
      name: "d1_retention",
      floor: 0.25, target: 0.30, stretch: 0.38,
      benchmark_2026: 0.325,
      source: "SQ Magazine 2026 — Mobile Games Statistics",
    },
    {
      name: "d7_retention",
      floor: 0.10, target: 0.12, stretch: 0.16,
      benchmark_2026: 0.138,
      source: "SQ Magazine 2026 — Mobile Games Statistics",
    },
    {
      name: "d30_retention",
      floor: 0.03, target: 0.04, stretch: 0.06,
      benchmark_2026: 0.05,
      source: "Pushwoosh Retention Benchmarks 2026",
    },
    {
      name: "stickiness_dau_mau",
      floor: 0.22, target: 0.28, stretch: 0.35,
      benchmark_2026: 0.32,
      source: "SQ Magazine 2026 — Mobile Games Statistics",
    },
    {
      name: "view_list_to_enter_success_funnel",
      floor: 0.28, target: 0.35, stretch: 0.50,
      benchmark_2026: 0.35,
      source: "Internal §2.3 commitment + DFS funnel norms",
    },
    {
      name: "preenroll_to_first_entry",
      floor: 0.30, target: 0.40, stretch: 0.55,
      benchmark_2026: 0.40,
      source: "Mordor NA Fantasy Sports 2026 (DFS funnel norms)",
    },
    {
      name: "push_optin_d0",
      floor: 0.50, target: 0.60, stretch: 0.75,
      benchmark_2026: 0.60,
      source: "Pushwoosh DAU 2026",
    },
    {
      name: "streak_3day_share_of_wau",
      floor: 0.15, target: 0.22, stretch: 0.35,
      benchmark_2026: 0.22,
      source: "Strivecloud Gamification 2026",
    },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Personalized onboarding intent quiz (gap #1)
  // 3 questions, answered on first sign-in, persisted on the user object.
  // Routes the user to a tailored "your first tournament" recommendation.
  // ───────────────────────────────────────────────────────────────────────────
  export interface IntentQuestion {
    id: string;
    prompt: string;
    options: { id: string; label: string; topic_tags: string[] }[];
  }

  export const INTENT_QUIZ: IntentQuestion[] = [
    {
      id: "favorite_topic",
      prompt: "Which topic do you crush at?",
      options: [
        { id: "movies",  label: "Movies & TV",   topic_tags: ["movies", "pop_culture_2010s"] },
        { id: "music",   label: "Music history", topic_tags: ["music_history"] },
        { id: "sports",  label: "Sports",        topic_tags: ["sports_general", "cricket"] },
        { id: "science", label: "Science & GK",  topic_tags: ["science_gk", "general_knowledge"] },
        { id: "exam",    label: "Exam prep",     topic_tags: ["exam_jee", "exam_neet", "exam_gmat", "exam_ap"] },
      ],
    },
    {
      id: "time_budget",
      prompt: "How long do you usually play in one sitting?",
      options: [
        { id: "fast",   label: "5 minutes — quick rounds",  topic_tags: ["pickn_5"] },
        { id: "medium", label: "15 minutes — daily quiz",   topic_tags: ["classic_daily"] },
        { id: "long",   label: "30+ minutes — weekly run",  topic_tags: ["classic_weekly", "elim_week"] },
      ],
    },
    {
      id: "prize_comfort",
      prompt: "What entry fee feels comfortable?",
      options: [
        { id: "free",  label: "Start free — show me AMOE",   topic_tags: ["amoe_first"] },
        { id: "small", label: "50 BC ($0.15) is fine",       topic_tags: ["entry_fee_le_100"] },
        { id: "mid",   label: "Up to 250 BC ($0.75)",        topic_tags: ["entry_fee_le_300"] },
        { id: "high",  label: "I'll go for the big pot",     topic_tags: ["entry_fee_ge_500"] },
      ],
    },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Scarcity counter (gap #2)
  // Server returns the number of founder slots left for each tournament.
  // Computed as PRE_ENROLL_FOUNDER_CAP - count(pre_enrollments where
  // founder_eligible == true). Re-cached every 5s.
  // ───────────────────────────────────────────────────────────────────────────
  export const SCARCITY_REFRESH_SECONDS = 5;
  export const SCARCITY_LOW_THRESHOLD   = 100;   // UI shows red glow below this
  export const SCARCITY_VERY_LOW_THRESHOLD = 25; // UI shows urgent pulse below this

  // ───────────────────────────────────────────────────────────────────────────
  // Push notification cadence ladder (gap #3)
  // Triggered by the User Backend notif-scheduler. Each entry is a row.
  // ───────────────────────────────────────────────────────────────────────────
  export interface PushCadenceEntry {
    code: string;                // unique ID for analytics dedup
    trigger: string;             // how it's fired
    template: string;            // copy template, supports {{ slug }} / {{ pot }} / {{ rank }}
    cap_per_user_per_day: number;
    cap_per_slug_total: number;
    quiet_hours_local: [number, number]; // 24h local-time window where suppressed
  }

  export const PUSH_CADENCE_LADDER: PushCadenceEntry[] = [
    {
      code: "d0_welcome",
      trigger: "user.signed_in_first_time",
      template: "Welcome to QuizVerse Tournaments — claim your 250 BC welcome pack",
      cap_per_user_per_day: 1, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "d1_streak_risk",
      trigger: "streak.day1_at_risk",
      template: "Your founder streak is 1 day. Don't lose it.",
      cap_per_user_per_day: 1, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "d2_fresh_open",
      trigger: "tournament.opened",
      template: "{{ slug }} just opened — first entry on us with code DAY2",
      cap_per_user_per_day: 1, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "d3_free_pickn",
      trigger: "scheduler.day3_after_signup",
      template: "Try Pick-5 today — entry is on the house",
      cap_per_user_per_day: 1, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "h24_abandonment",
      trigger: "tournament.viewed_no_entry_24h",
      template: "Spot still open in {{ slug }} — pot now {{ pot }} BC",
      cap_per_user_per_day: 2, cap_per_slug_total: 1,
      quiet_hours_local: [23, 7],
    },
    {
      code: "predictive_rank",
      trigger: "leaderboard.rank_slipped_5plus",
      template: "You're {{ rank }}. +250 BC if you climb to {{ target }} in the next hour",
      cap_per_user_per_day: 2, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "d7_winback",
      trigger: "user.inactive_7d",
      template: "We saved a free entry for your comeback round",
      cap_per_user_per_day: 1, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
    {
      code: "settlement_won",
      trigger: "tournament.settled_user_won",
      template: "You finished {{ rank }} in {{ slug }} — {{ bc }} BC just hit your wallet",
      cap_per_user_per_day: 5, cap_per_slug_total: 1,
      quiet_hours_local: [22, 8],
    },
  ];

  export const PUSH_GLOBAL_CAP_PER_24H = 4;
  export const PUSH_HARD_STOP_AFTER_IGNORED = 2;     // hard-stop after N ignored in 72h

  // ───────────────────────────────────────────────────────────────────────────
  // Social-proof live ticker (gap #4)
  // Server already emits 1001:entry on every paid entry; this just sets the
  // UI sliding-window size + minimum interval between ticker visual updates.
  // ───────────────────────────────────────────────────────────────────────────
  export const SOCIAL_PROOF_TICKER = {
    visible_window_seconds: 90,
    min_visual_refresh_ms: 1500,
    show_handle_redaction_below_count: 3,   // "5 players entered" instead of names below 3 entries
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Predictive rank nudge (gap #5)
  // Looks at the live leaderboard during play; if a paid entrant's rank slips
  // 5+ positions in a 30m sliding window AND the gap to the next prize tier is
  // crossable, fire a `predictive_rank` push.
  // ───────────────────────────────────────────────────────────────────────────
  export const PREDICTIVE_NUDGE = {
    rank_slip_threshold: 5,
    sliding_window_minutes: 30,
    bonus_bc_per_target_climb: 250,
    max_bonus_bc_per_window: 750,
    cooldown_minutes_per_user_slug: 60,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Abandonment nudge (gap #6)
  // User opened a detail page but did not enter within `delay_hours`. Wires
  // into the existing notif-scheduler dedup (one push per slug-user).
  // ───────────────────────────────────────────────────────────────────────────
  export const ABANDONMENT_NUDGE = {
    delay_hours: 24,
    max_per_user_per_week: 3,
    expire_if_tournament_closes_within_hours: 6,  // skip nudge if closes too soon
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Daily check-in streak engine (gap #7)
  // Streak counts unique calendar days where the user entered ≥1 tournament
  // (or completed a Learning Series video, for AMOE-only users). Reset at
  // local 04:00 of the user's timezone after a missed day.
  // ───────────────────────────────────────────────────────────────────────────
  export interface StreakReward {
    on_day: number;            // 1, 3, 7, 14, 30, ...
    reward_bc: number;
    badge_slug?: string;
    free_pickn_entry?: boolean;
  }

  export const STREAK_REWARDS: StreakReward[] = [
    { on_day: 1,  reward_bc: 25,                           badge_slug: "streak_starter" },
    { on_day: 3,  reward_bc: 100,                          badge_slug: "streak_3day" },
    { on_day: 7,  reward_bc: 250, free_pickn_entry: true,  badge_slug: "streak_7day" },
    { on_day: 14, reward_bc: 500, free_pickn_entry: true,  badge_slug: "streak_2week" },
    { on_day: 30, reward_bc: 1500, free_pickn_entry: true, badge_slug: "streak_30day" },
    { on_day: 90, reward_bc: 5000, free_pickn_entry: true, badge_slug: "streak_diehard" },
  ];

  export const STREAK_GRACE_DAYS = 1;          // 1 free skip per 14-day window
  export const STREAK_RESET_LOCAL_HOUR = 4;    // 04:00 user's local TZ

  // ───────────────────────────────────────────────────────────────────────────
  // Tournament badge progression (gap #8)
  // Plugs into the existing 207-badge pipeline (manifest at
  // agent-assets/games/quiz-verse/game_developer_manifest_fixed.json).
  // ───────────────────────────────────────────────────────────────────────────
  export interface TournamentBadge {
    slug: string;
    name: string;
    description: string;
    award_rule: string;            // human-readable; server logic in award_rules.ts
  }

  export const TOURNAMENT_BADGES: TournamentBadge[] = [
    { slug: "founders_class_2026", name: "Founders Class of 2026",
      description: "Among the first 1,000 to pre-enroll.",
      award_rule: "pre_enroll_position <= 1000 AND first_pre_enroll_date < 2026-07-01" },
    { slug: "first_tournament",    name: "First Tournament",
      description: "Entered your first paid tournament.",
      award_rule: "lifetime_paid_entries == 1" },
    { slug: "ten_weeks_unbroken",  name: "10 Weeks Unbroken",
      description: "Entered ≥1 tournament every week for 10 weeks.",
      award_rule: "consecutive_weeks_with_entry >= 10" },
    { slug: "top_one_percent",     name: "Top 1% Finisher",
      description: "Finished in the top 1% of any tournament.",
      award_rule: "rank / total_entrants <= 0.01" },
    { slug: "pickn_perfect",       name: "Pick-N Perfect",
      description: "Hit 5/5 in a Pick-N tournament.",
      award_rule: "tournament.format == 'pick_n' AND grade == '5/5'" },
    { slug: "elim_survivor",       name: "Survivor",
      description: "Won an Elimination tournament outright.",
      award_rule: "tournament.format == 'elimination' AND rank == 1" },
    { slug: "amoe_grad",           name: "AMOE Graduate",
      description: "Earned an entry through the Learning Series.",
      award_rule: "amoe_entries_used >= 1" },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Watch-live spectator mode (gap #9)
  // Allows non-entrants to subscribe to a tournament's leaderboard stream.
  // Throttled to half the entrant refresh rate to keep server cost flat.
  // ───────────────────────────────────────────────────────────────────────────
  export const WATCH_LIVE = {
    spectator_lb_refresh_seconds: 10,
    spectator_max_concurrent_per_pod: 5000,
    cta_join_next_round_after_minutes: 5, // show "join next round" CTA after 5 min spectating
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Wave-2 slate draft (gap #10) — three new tournaments targeted at
  // 25-34 cohort (58.10% of NA fantasy users per Mordor 2026).
  //
  // Shape mirrors TournamentEconomy.TournamentConfig but kept here as a draft
  // until merged into LAUNCH_SLATE in a follow-up PR.
  // ───────────────────────────────────────────────────────────────────────────
  export interface Wave2Tournament {
    slug: string;
    name: string;
    description: string;
    topic_tag: string;
    entry_fee_bc: number;
    pot_seed_bc: number;
    cohort_target: "25_34" | "18_24" | "35_plus";
    rationale: string;
  }

  export const WAVE_2_SLATE_DRAFT: Wave2Tournament[] = [
    {
      slug: "movie-trivia-royale",
      name: "Movie Trivia Royale",
      description: "Weekly classic — every era, every genre, every awards-night fact.",
      topic_tag: "movies",
      entry_fee_bc: 100,
      pot_seed_bc: 18000,
      cohort_target: "25_34",
      rationale: "Largest fantasy cohort 25-34 (58.10%); pop-culture hooks for casual wallet refill.",
    },
    {
      slug: "music-history-royale",
      name: "Music History Royale",
      description: "Weekly classic — Beatles to Bad Bunny.",
      topic_tag: "music_history",
      entry_fee_bc: 100,
      pot_seed_bc: 18000,
      cohort_target: "25_34",
      rationale: "Music nostalgia mid-30s skew; complements movies as a sister weekly.",
    },
    {
      slug: "pop-culture-2010s",
      name: "Pop Culture 2010s",
      description: "Weekly classic — viral moments, memes, breakout shows.",
      topic_tag: "pop_culture_2010s",
      entry_fee_bc: 100,
      pot_seed_bc: 15000,
      cohort_target: "25_34",
      rationale: "2010s nostalgia indexes hardest with the 25-34 cohort entering peak earning years.",
    },
  ];

  // ───────────────────────────────────────────────────────────────────────────
  // Hybrid / micro-bet — Pick-N v2 doubleup (gap #11)
  // Mid-tournament live multiplier on remaining picks. Hybrid is the fastest-
  // growing DFS sub-segment at 14.2% CAGR (Mordor 2026).
  // ───────────────────────────────────────────────────────────────────────────
  export interface PickNDoubleupConfig {
    available_window_pct: [number, number]; // % of tournament window during which doubleup is offered
    cost_bc: number;                        // additional BC to lock in 2x
    multiplier: number;                     // 2x grade at settlement
    max_per_user_per_tournament: number;
    eligible_after_picks: number;           // user must have made ≥ N initial picks
  }

  export const PICKN_DOUBLEUP_DEFAULT: PickNDoubleupConfig = {
    available_window_pct: [0.30, 0.70],
    cost_bc: 100,
    multiplier: 2.0,
    max_per_user_per_tournament: 1,
    eligible_after_picks: 3,
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────
  export function thresholdByName(name: string): KPIThreshold | null {
    for (var i = 0; i < KPI_THRESHOLDS.length; i++) {
      if (KPI_THRESHOLDS[i].name === name) return KPI_THRESHOLDS[i];
    }
    return null;
  }

  export function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS): boolean {
    return !!FEATURE_FLAGS[flag];
  }

  export function nextStreakReward(currentDay: number): StreakReward | null {
    for (var i = 0; i < STREAK_REWARDS.length; i++) {
      if (STREAK_REWARDS[i].on_day > currentDay) return STREAK_REWARDS[i];
    }
    return null;
  }

  export function pushTemplateForCode(code: string): PushCadenceEntry | null {
    for (var i = 0; i < PUSH_CADENCE_LADDER.length; i++) {
      if (PUSH_CADENCE_LADDER[i].code === code) return PUSH_CADENCE_LADDER[i];
    }
    return null;
  }
}
