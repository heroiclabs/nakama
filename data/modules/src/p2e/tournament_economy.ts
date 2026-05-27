// =============================================================================
// tournament_economy.ts — Single Source of Truth for QuizVerse Tournaments
//
// Plan refs:
//   §1   Core decisions      — 15% rake, BC fixed value, geo-variable display
//   §1A  Topic shortlist     — 11 launch tracks (8 generic + 3 new formats)
//   §1B  Launch slate        — public Jul 1 2026, pre-enroll from May 27
//   §1F  Pre-enrollment      — FOUNDER cap=1000, 2x first-win multiplier
//   §1H  Multi-format engine — classic | elimination | pick_n discriminator
//   §1I  Wire spec           — config consumed by all tournament RPCs
//
// EVERY tournament parameter (entry fee, rake, splits, format, schedule,
// payouts, AMOE rules, geo blocks) flows from this file. Change here = change
// everywhere. Do not duplicate any of these values in client code.
// =============================================================================

namespace TournamentEconomy {

  // ── Global constants ───────────────────────────────────────────────────────

  // House cut on every pot (rake_pct of pot goes to QuizVerse, rest to payouts).
  export const HOUSE_RAKE_PCT = 0.15;

  // Brain Coin "fiat anchor" — used for geo-display only. BC value is constant
  // globally; we just *show* the local fiat equivalent based on user country.
  export const BC_PER_USD_USA = 333.333;  // 1 USD ≈ 333 BC (so 1500 BC = $4.50, matches existing payout sku)

  // Pre-enrollment / launch (§1F)
  export const PRE_ENROLL_FOUNDER_CAP = 1000;
  export const FOUNDER_FIRST_WIN_MULTIPLIER = 2.0;
  export const HOUSE_PRE_ENROLL_SUBSIDY_USD = 5000;     // cap on house pot top-up during pre-enroll
  export const HOUSE_PRE_ENROLL_SUBSIDY_BC_PER_ENROLLEE = 5;  // +5 BC subsidy per 10 enrollments (avg)

  // Referral
  export const REFERRAL_TOP_1_USD = 500;
  export const REFERRAL_TOP_2_3_USD = 250;
  export const REFERRAL_TOP_4_10_USD = 100;
  export const REFERRAL_TOP_11_100_USD = 25;

  // Public open time (§1B). 2026-07-01 00:00 ET = 04:00 UTC.
  export const PUBLIC_OPEN_TIME_ISO = "2026-07-01T04:00:00Z";

  // Pre-enroll opens immediately on first deploy of this module.
  // Tournaments seeded below get `status: PRE_ENROLL` until cron flips them.

  // ── Geo compliance (§3 Phase 0 Compliance lock) ────────────────────────────
  // Two-stage geo gate:
  //   ENTRY_BLOCK_US_STATES   — block paid entry (skill-game prohibitions)
  //   REDEMPTION_BLOCK_US_STATES — block BC→Tremendous redemption (dual-currency)
  export const ENTRY_BLOCK_US_STATES = ["WA", "AZ", "CT", "NJ", "NY", "VA"];
  export const REDEMPTION_BLOCK_US_STATES = ["CA", "NY", "VA"];

  // Countries we serve in Tier-1 launch
  export const TIER1_COUNTRIES = ["US", "CA", "GB", "AU", "NZ", "IE"];

  // 18+ gate (§3)
  export const MIN_AGE = 18;

  // Anti-cheat baseline (§3)
  export const ANTICHEAT_LATENCY_FLOOR_MS = 300;
  export const ANTICHEAT_DAILY_SUBMIT_CEILING = 200;

  // ── Status enum ────────────────────────────────────────────────────────────
  export type TournamentStatus =
    | "DRAFT"        // not yet visible
    | "PRE_ENROLL"   // visible, bookable, no BC charged
    | "OPEN"         // public registration, BC charged on enter
    | "ACTIVE"       // play window
    | "SETTLING"     // computing payouts
    | "SETTLED"      // payouts complete
    | "ARCHIVED";

  // ── Format discriminator (§1H) ─────────────────────────────────────────────
  export type TournamentFormat = "classic" | "elimination" | "pick_n";

  // Per-format ui variant ID; web/Unity dispatch to the right hero component.
  export type FormatUiVariant = "classic-pot" | "elim-survivors" | "pick-n-slip";

  // ── Pot split (classic format) ─────────────────────────────────────────────
  // Top-1 = 40%, Top-2 = 20%, Top-3 = 10%, Top-4-10 = 5% each (35% total),
  // Top-11-100 = adjusted to fill remaining. Sum (post-rake) = 1.0.
  export const CLASSIC_POT_SPLIT_TOP_N: { rank: number; share: number }[] = [
    { rank: 1, share: 0.40 },
    { rank: 2, share: 0.20 },
    { rank: 3, share: 0.10 },
    { rank: 4, share: 0.05 },
    { rank: 5, share: 0.05 },
    { rank: 6, share: 0.05 },
    { rank: 7, share: 0.05 },
    { rank: 8, share: 0.05 },
    { rank: 9, share: 0.025 },
    { rank: 10, share: 0.025 },
    // Remaining 0% in the top-10 view; ranks 11-100 share the remainder when
    // pot is large enough via spreadRemainder() in tournament_settle.
  ];

  // ── Elimination format defaults (§1H N1) ───────────────────────────────────
  export interface EliminationSchedule {
    cut_times_utc: string[];        // ISO timestamps for each daily cut
    cut_pct: number;                // 0.50 = bottom-50% eliminated each cut
    survivor_split: "equal" | "weighted_by_score";
    final_survivor_bonus_bc: number; // bonus to #1 of survivors (bragging-rights)
  }

  // ── Pick-N format config (§1H N2) ──────────────────────────────────────────
  export interface PickNConfig {
    n: number;                          // number of picks user must make
    multipliers: { [grade: string]: number };  // "5/5": 10, "4/5": 5, "3/5": 2
    max_pick_window_hours: number;      // 24h before close, no more picks
    house_backstop_usd_per_day: number; // max house contribution if pot drained
  }

  // ── AMOE per-format (§1H) ──────────────────────────────────────────────────
  export interface AmoeRule {
    learning_series_required_videos: number;   // 6/6 = AMOE unlock
    free_entries_per_tournament: number;
    no_lose_refund_finish_pct?: number;        // top-50% gets refund (classic)
    no_lose_survive_round?: number;            // survive past day-N to refund (elim)
    no_lose_pick_threshold?: string;            // "3/5" minimum to refund (pick-n)
  }

  // ── Full per-tournament config ─────────────────────────────────────────────
  export interface TournamentConfig {
    slug: string;
    name: string;
    description: string;
    topic_tag: string;                 // maps to topic_catalog.ts
    format: TournamentFormat;
    format_ui_variant: FormatUiVariant;

    // Schedule
    pre_enroll_start_iso: string;      // when PRE_ENROLL begins
    open_start_iso: string;            // when OPEN (registration + play) starts
    end_iso: string;                   // when play ends → SETTLING

    // Economy
    entry_fee_bc: number;
    rake_pct: number;                  // typically 0.15
    pot_seed_bc: number;               // house seeds the pot to prime engagement

    // Format-specific (only one is populated based on `format`)
    pot_split_top_n?: { rank: number; share: number }[];
    elimination_schedule?: EliminationSchedule;
    pick_n_config?: PickNConfig;

    // Eligibility
    countries_allowed: string[] | "ALL";
    min_age: number;
    amoe: AmoeRule;

    // Visibility / marketing
    hero_image_url?: string;
    sponsor?: string;
    badge_emoji?: string;
  }

  // ── Default AMOE rules (one per format) ────────────────────────────────────
  export const AMOE_CLASSIC: AmoeRule = {
    learning_series_required_videos: 6,
    free_entries_per_tournament: 1,
    no_lose_refund_finish_pct: 0.50,
  };
  export const AMOE_ELIMINATION: AmoeRule = {
    learning_series_required_videos: 6,
    free_entries_per_tournament: 1,
    no_lose_survive_round: 3,
  };
  export const AMOE_PICK_N: AmoeRule = {
    learning_series_required_videos: 6,
    free_entries_per_tournament: 1,
    no_lose_pick_threshold: "3/5",
  };

  // ── LAUNCH SLATE (§1B Wave 1) ──────────────────────────────────────────────
  // 11 tournaments seeded on day-1 of pre-enrollment (May 27, 2026).
  // All flip from PRE_ENROLL → OPEN on Wed Jul 1, 2026 04:00 UTC (00:00 ET).
  const PRE_ENROLL_OPEN_ISO = "2026-05-27T00:00:00Z";
  const WAVE_1_OPEN_ISO = PUBLIC_OPEN_TIME_ISO;
  const WAVE_1_WEEK_END_ISO = "2026-07-06T03:59:59Z";  // Jul 6 23:59 ET

  export const LAUNCH_SLATE: TournamentConfig[] = [
    // ── Daily Snack (recurring) ──
    {
      slug: "gk-royale-daily",
      name: "GK Royale Daily",
      description: "5 quick questions, every day. Pick up where you left off.",
      topic_tag: "general_knowledge",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: "2026-07-01T23:59:59Z",       // daily reset; cron re-instantiates
      entry_fee_bc: 50,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 5000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "🧠",
    },
    // ── Weekly Sprints (generic) ──
    {
      slug: "brain-bowl-weekly",
      name: "Brain Bowl Weekly",
      description: "Lumosity-style brain workout. Rotating subject each week.",
      topic_tag: "brain_bowl_science",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 250,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 20000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "🧪",
    },
    {
      slug: "movie-buff-weekly",
      name: "Movie Buff Showdown",
      description: "Films, shows, soundtracks — for the true cinephile.",
      topic_tag: "movies_tv",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 250,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 18000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "🎬",
    },
    // ── NEW FORMAT: Elimination Sprint (§1H N1) ──
    {
      slug: "survivor-week-1",
      name: "Survivor Week — Inaugural",
      description: "5 days. Bottom 50% eliminated each midnight. Survivors split the pot.",
      topic_tag: "general_knowledge",
      format: "elimination",
      format_ui_variant: "elim-survivors",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 500,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 50000,
      elimination_schedule: {
        cut_times_utc: [
          "2026-07-02T04:00:00Z",  // Day 1 cut → 7500 survive
          "2026-07-03T04:00:00Z",  // Day 2 cut → 3750 survive
          "2026-07-04T04:00:00Z",  // Day 3 cut → 1875 survive
          "2026-07-05T04:00:00Z",  // Day 4 cut → 938 survive
          "2026-07-06T04:00:00Z",  // Day 5 final cut → 469 survivors split pot
        ],
        cut_pct: 0.50,
        survivor_split: "equal",
        final_survivor_bonus_bc: 200000,  // #1 of survivors gets a bragging-rights bonus
      },
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_ELIMINATION,
      badge_emoji: "⚔️",
    },
    // ── NEW FORMAT: Pick-5 Daily (§1H N2) ──
    {
      slug: "pick-5-daily",
      name: "Pick-5 Daily",
      description: "Pick 5. Get them all right to win 10×. PrizePicks-style for trivia.",
      topic_tag: "mixed_difficulty",
      format: "pick_n",
      format_ui_variant: "pick-n-slip",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: "2026-07-01T23:59:59Z",  // daily; cron re-instantiates
      entry_fee_bc: 100,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 8000,
      pick_n_config: {
        n: 5,
        multipliers: {
          "5/5": 10,
          "4/5": 5,
          "3/5": 2,
          "<3/5": 0,
        },
        max_pick_window_hours: 24,
        house_backstop_usd_per_day: 100,
      },
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_PICK_N,
      badge_emoji: "🎯",
    },
    // ── Exam-Prep (high-LTV, US-focused) ──
    {
      slug: "ap-2027-prep-weekly",
      name: "AP 2027 Prep Sprint",
      description: "Lock in AP material for the 2027 calendar. Aligns with this week's AP score release.",
      topic_tag: "exam_ap_general",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 500,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 25000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: ["US"],
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "📚",
    },
    // ── Wave 2: SAT Aug, ACT Sep (seeded but PRE_ENROLL on day-1) ──
    {
      slug: "sat-aug-cram",
      name: "SAT August Cram",
      description: "Final SAT prep week before the August test date.",
      topic_tag: "exam_sat",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: "2026-08-17T04:00:00Z",
      end_iso: "2026-08-23T03:59:59Z",
      entry_fee_bc: 500,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 30000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: ["US"],
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "✏️",
    },
    {
      slug: "act-sep-sprint",
      name: "ACT September Sprint",
      description: "Final ACT prep week before the September test date.",
      topic_tag: "exam_act",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: "2026-09-07T04:00:00Z",
      end_iso: "2026-09-13T03:59:59Z",
      entry_fee_bc: 500,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 25000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: ["US"],
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "🎓",
    },
    {
      slug: "neet-prep-weekly",
      name: "NEET Prep Weekly (India)",
      description: "Weekly NEET prep — biology, chemistry, physics rotation.",
      topic_tag: "exam_neet",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 250,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 15000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: ["IN"],
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "⚕️",
    },
    {
      slug: "jee-main-weekly",
      name: "JEE Main Weekly (India)",
      description: "JEE Main prep — maths, physics, chemistry rotation.",
      topic_tag: "exam_jee",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 250,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 15000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: ["IN"],
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "🔬",
    },
    {
      slug: "gmat-weekly",
      name: "GMAT Weekly",
      description: "Verbal + quant + data sufficiency for the global GMAT cohort.",
      topic_tag: "exam_gmat",
      format: "classic",
      format_ui_variant: "classic-pot",
      pre_enroll_start_iso: PRE_ENROLL_OPEN_ISO,
      open_start_iso: WAVE_1_OPEN_ISO,
      end_iso: WAVE_1_WEEK_END_ISO,
      entry_fee_bc: 500,
      rake_pct: HOUSE_RAKE_PCT,
      pot_seed_bc: 20000,
      pot_split_top_n: CLASSIC_POT_SPLIT_TOP_N,
      countries_allowed: "ALL",
      min_age: MIN_AGE,
      amoe: AMOE_CLASSIC,
      badge_emoji: "💼",
    },
  ];

  // ── Lookup helpers ─────────────────────────────────────────────────────────
  const SLUG_INDEX: { [slug: string]: TournamentConfig } = (function () {
    var m: { [k: string]: TournamentConfig } = {};
    for (var i = 0; i < LAUNCH_SLATE.length; i++) m[LAUNCH_SLATE[i].slug] = LAUNCH_SLATE[i];
    return m;
  })();

  export function getBySlug(slug: string): TournamentConfig | null {
    return SLUG_INDEX[slug] || null;
  }

  export function listAll(): TournamentConfig[] {
    return LAUNCH_SLATE.slice();
  }

  // Country eligibility check (entry-side). Returns true if the country is
  // allowed AND not in the US-state entry-block list (state checked separately).
  export function isCountryAllowed(cfg: TournamentConfig, country: string): boolean {
    if (cfg.countries_allowed === "ALL") return true;
    var list = cfg.countries_allowed as string[];
    for (var i = 0; i < list.length; i++) if (list[i] === country) return true;
    return false;
  }

  // US-state entry-block check
  export function isUsStateEntryBlocked(state: string): boolean {
    for (var i = 0; i < ENTRY_BLOCK_US_STATES.length; i++) {
      if (ENTRY_BLOCK_US_STATES[i] === state) return true;
    }
    return false;
  }

  // US-state redemption-block check (used by brain_coins redeem flow)
  export function isUsStateRedemptionBlocked(state: string): boolean {
    for (var i = 0; i < REDEMPTION_BLOCK_US_STATES.length; i++) {
      if (REDEMPTION_BLOCK_US_STATES[i] === state) return true;
    }
    return false;
  }

  // Geo-display: turn BC into local-fiat estimate. Static table for MVP; later
  // pull live FX. Display-only — never used for ledger math.
  export const GEO_DISPLAY_RATES: { [country: string]: { symbol: string; usd_to_local: number } } = {
    US: { symbol: "$",   usd_to_local: 1.00 },
    CA: { symbol: "C$",  usd_to_local: 1.37 },
    GB: { symbol: "£",   usd_to_local: 0.79 },
    AU: { symbol: "A$",  usd_to_local: 1.52 },
    NZ: { symbol: "NZ$", usd_to_local: 1.65 },
    IE: { symbol: "€",   usd_to_local: 0.92 },
    IN: { symbol: "₹",   usd_to_local: 83.5 },
  };

  export function bcToLocalDisplay(bc: number, country: string): { symbol: string; amount: string } {
    var rate = GEO_DISPLAY_RATES[country] || GEO_DISPLAY_RATES.US;
    var usd = bc / BC_PER_USD_USA;
    var local = usd * rate.usd_to_local;
    var fmt = local >= 100 ? local.toFixed(0) : local.toFixed(2);
    return { symbol: rate.symbol, amount: fmt };
  }
}
