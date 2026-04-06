// ============================================================================
// FANTASY CRICKET — Shared Types
// ============================================================================

namespace FantasyTypes {

  // ---- Storage Collection & Key Constants ----

  export var COLLECTION = "fantasy_cricket";

  export var Keys = {
    TEAM: "team",                   // per-user squad
    SEASON_STATE: "season_state",   // per-user season metadata (transfers, boosters)
    SCORING_CONFIG: "scoring_config", // system-level scoring rules
    PLAYER_CATALOG: "player_catalog", // system-level credit values
    TRANSFER_WINDOW: "transfer_window", // system-level window state
    MATCH_POINTS: "match_points",   // per-user per-match points
    LEAGUE_META: "league_meta",     // per-group metadata
  };

  export var LEADERBOARD_SEASON = "fantasy_season";
  export var LEADERBOARD_MATCH_PREFIX = "fantasy_match_";
  export var LEADERBOARD_LEAGUE_PREFIX = "fantasy_league_";

  // ---- Player Catalog (credit values published from NestJS) ----

  export interface PlayerCredit {
    playerId: string;
    name: string;
    teamId: string;
    role: "batsman" | "bowler" | "all-rounder" | "wicket-keeper";
    creditValue: number; // e.g., 8.5, 9.0, 10.0
    isOverseas: boolean;
  }

  export interface PlayerCatalog {
    seasonId: string;
    leagueId: string;
    updatedAt: string;
    players: { [playerId: string]: PlayerCredit };
  }

  // ---- Fantasy Team ----

  export interface FantasySquadPlayer {
    playerId: string;
    creditValue: number;
    teamId: string;
    role: "batsman" | "bowler" | "all-rounder" | "wicket-keeper";
    isCaptain: boolean;
    isViceCaptain: boolean;
  }

  export interface FantasyTeam {
    userId: string;
    seasonId: string;
    leagueId: string;
    teamName: string;
    players: FantasySquadPlayer[];
    totalCredits: number;
    captainId: string;
    viceCaptainId: string;
    createdAt: string;
    updatedAt: string;
  }

  // ---- Season State (per-user, tracks transfers & boosters) ----

  export interface TransferRecord {
    matchday: number;
    transferredIn: string;
    transferredOut: string;
    creditDelta: number;
    boosterUsed: string | null;
    timestamp: string;
  }

  export interface SeasonState {
    userId: string;
    seasonId: string;
    freeTransfersRemaining: number;
    maxFreeTransfers: number;
    totalTransfersMade: number;
    penaltyPointsAccrued: number;
    boostersUsed: string[];
    transferHistory: TransferRecord[];
    updatedAt: string;
  }

  // ---- Transfer Window ----

  export interface TransferWindow {
    seasonId: string;
    matchday: number;
    opensAt: string;
    closesAt: string;
    isOpen: boolean;
  }

  // ---- Scoring Config ----

  export interface ScoringConfig {
    seasonId: string;
    batting: BattingScoringRules;
    bowling: BowlingScoringRules;
    fielding: FieldingScoringRules;
    bonuses: BonusScoringRules;
    penalties: PenaltyScoringRules;
    captainMultiplier: number;
    viceCaptainMultiplier: number;
  }

  export interface BattingScoringRules {
    perRun: number;
    boundaryBonus: number;
    sixBonus: number;
    halfCenturyBonus: number;
    centuryBonus: number;
    duckPenalty: number;
  }

  export interface BowlingScoringRules {
    perWicket: number;
    bonusBowled: number;
    bonusLbw: number;
    threeWicketBonus: number;
    fourWicketBonus: number;
    fiveWicketBonus: number;
    maidenOverBonus: number;
  }

  export interface FieldingScoringRules {
    perCatch: number;
    perStumping: number;
    perRunOut: number;
    perRunOutAssist: number;
  }

  export interface BonusScoringRules {
    strikeRateAbove170: number;
    strikeRateAbove150: number;
    strikeRateAbove130: number;
    strikeRateBelow60: number;
    strikeRateBelow50: number;
    economyBelow5: number;
    economyBelow6: number;
    economyBelow7: number;
    economyAbove10: number;
    economyAbove11: number;
    economyAbove12: number;
    minimumBallsForSR: number;
    minimumOversForER: number;
  }

  export interface PenaltyScoringRules {
    perExtraPenaltyTransfer: number;
  }

  // ---- Ball Event (subset mirroring NestJS BallEvent) ----

  export interface BallEvent {
    eventId: string;
    fixtureId: string;
    inningsNumber: number;
    overNumber: number;
    ballNumber: number;
    batsmanId: string;
    nonStrikerId?: string;
    bowlerId: string;
    outcome: string;
    runs: number;
    batsmanRuns?: number;
    extras: { type?: string; runs: number };
    isBoundary?: boolean;
    isSix?: boolean;
    isWicket: boolean;
    wicket?: {
      dismissedPlayerId: string;
      dismissalType: string;
      fielderId?: string;
      assistFielderId?: string;
    };
  }

  // ---- Player Match Accumulator (used by scoring engine) ----

  export interface PlayerMatchStats {
    playerId: string;
    runsScored: number;
    ballsFaced: number;
    fours: number;
    sixes: number;
    wicketsTaken: number;
    oversBowled: number;
    ballsBowled: number;
    runsConceded: number;
    maidens: number;
    catches: number;
    stumpings: number;
    runOuts: number;
    runOutAssists: number;
    isDismissed: boolean;
    dismissalType: string | null;
    isDuck: boolean;
    fantasyPoints: number;
  }

  // ---- Match Points (per-user result) ----

  export interface MatchPoints {
    userId: string;
    fixtureId: string;
    matchday: number;
    playerPoints: { [playerId: string]: number };
    captainPoints: number;
    viceCaptainPoints: number;
    totalPoints: number;
    calculatedAt: string;
  }

  // ---- Fantasy League (wraps Nakama Group) ----

  export interface LeagueMeta {
    groupId: string;
    leagueName: string;
    creatorId: string;
    seasonId: string;
    leaderboardId: string;
    maxMembers: number;
    inviteCode: string;
    createdAt: string;
  }

  // ---- RPC Payloads ----

  export interface CreateTeamPayload {
    seasonId: string;
    leagueId: string;
    teamName: string;
    players: { playerId: string; isCaptain: boolean; isViceCaptain: boolean }[];
  }

  export interface TransferPayload {
    seasonId: string;
    matchday: number;
    transfersIn: string[];
    transfersOut: string[];
    boosterId?: string;
  }

  export interface ProcessBallEventsPayload {
    fixtureId: string;
    matchday: number;
    events: BallEvent[];
  }

  export interface CreateLeaguePayload {
    leagueName: string;
    seasonId: string;
    maxMembers?: number;
  }

  export interface JoinLeaguePayload {
    inviteCode: string;
  }

  export interface LeagueLeaderboardPayload {
    groupId: string;
    limit?: number;
  }

  // ---- Default Scoring Config ----

  export function defaultScoringConfig(seasonId: string): ScoringConfig {
    return {
      seasonId: seasonId,
      batting: {
        perRun: 1,
        boundaryBonus: 1,
        sixBonus: 2,
        halfCenturyBonus: 8,
        centuryBonus: 16,
        duckPenalty: -2,
      },
      bowling: {
        perWicket: 25,
        bonusBowled: 8,
        bonusLbw: 8,
        threeWicketBonus: 4,
        fourWicketBonus: 8,
        fiveWicketBonus: 16,
        maidenOverBonus: 12,
      },
      fielding: {
        perCatch: 8,
        perStumping: 12,
        perRunOut: 6,
        perRunOutAssist: 4,
      },
      bonuses: {
        strikeRateAbove170: 6,
        strikeRateAbove150: 4,
        strikeRateAbove130: 2,
        strikeRateBelow60: -4,
        strikeRateBelow50: -6,
        economyBelow5: 6,
        economyBelow6: 4,
        economyBelow7: 2,
        economyAbove10: -2,
        economyAbove11: -4,
        economyAbove12: -6,
        minimumBallsForSR: 10,
        minimumOversForER: 2,
      },
      penalties: {
        perExtraPenaltyTransfer: -4,
      },
      captainMultiplier: 2,
      viceCaptainMultiplier: 1.5,
    };
  }
}
