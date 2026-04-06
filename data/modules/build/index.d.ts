declare function LegacyInitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
declare function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
declare namespace FantasyLeague {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FantasyScoring {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FantasyTeam {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FantasyTransfer {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FantasyTypes {
    var COLLECTION: string;
    var Keys: {
        TEAM: string;
        SEASON_STATE: string;
        SCORING_CONFIG: string;
        PLAYER_CATALOG: string;
        TRANSFER_WINDOW: string;
        MATCH_POINTS: string;
        LEAGUE_META: string;
    };
    var LEADERBOARD_SEASON: string;
    var LEADERBOARD_MATCH_PREFIX: string;
    var LEADERBOARD_LEAGUE_PREFIX: string;
    interface PlayerCredit {
        playerId: string;
        name: string;
        teamId: string;
        role: "batsman" | "bowler" | "all-rounder" | "wicket-keeper";
        creditValue: number;
        isOverseas: boolean;
    }
    interface PlayerCatalog {
        seasonId: string;
        leagueId: string;
        updatedAt: string;
        players: {
            [playerId: string]: PlayerCredit;
        };
    }
    interface FantasySquadPlayer {
        playerId: string;
        creditValue: number;
        teamId: string;
        role: "batsman" | "bowler" | "all-rounder" | "wicket-keeper";
        isCaptain: boolean;
        isViceCaptain: boolean;
    }
    interface FantasyTeam {
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
    interface TransferRecord {
        matchday: number;
        transferredIn: string;
        transferredOut: string;
        creditDelta: number;
        boosterUsed: string | null;
        timestamp: string;
    }
    interface SeasonState {
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
    interface TransferWindow {
        seasonId: string;
        matchday: number;
        opensAt: string;
        closesAt: string;
        isOpen: boolean;
    }
    interface ScoringConfig {
        seasonId: string;
        batting: BattingScoringRules;
        bowling: BowlingScoringRules;
        fielding: FieldingScoringRules;
        bonuses: BonusScoringRules;
        penalties: PenaltyScoringRules;
        captainMultiplier: number;
        viceCaptainMultiplier: number;
    }
    interface BattingScoringRules {
        perRun: number;
        boundaryBonus: number;
        sixBonus: number;
        halfCenturyBonus: number;
        centuryBonus: number;
        duckPenalty: number;
    }
    interface BowlingScoringRules {
        perWicket: number;
        bonusBowled: number;
        bonusLbw: number;
        threeWicketBonus: number;
        fourWicketBonus: number;
        fiveWicketBonus: number;
        maidenOverBonus: number;
    }
    interface FieldingScoringRules {
        perCatch: number;
        perStumping: number;
        perRunOut: number;
        perRunOutAssist: number;
    }
    interface BonusScoringRules {
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
    interface PenaltyScoringRules {
        perExtraPenaltyTransfer: number;
    }
    interface BallEvent {
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
        extras: {
            type?: string;
            runs: number;
        };
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
    interface PlayerMatchStats {
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
    interface MatchPoints {
        userId: string;
        fixtureId: string;
        matchday: number;
        playerPoints: {
            [playerId: string]: number;
        };
        captainPoints: number;
        viceCaptainPoints: number;
        totalPoints: number;
        calculatedAt: string;
    }
    interface LeagueMeta {
        groupId: string;
        leagueName: string;
        creatorId: string;
        seasonId: string;
        leaderboardId: string;
        maxMembers: number;
        inviteCode: string;
        createdAt: string;
    }
    interface CreateTeamPayload {
        seasonId: string;
        leagueId: string;
        teamName: string;
        players: {
            playerId: string;
            isCaptain: boolean;
            isViceCaptain: boolean;
        }[];
    }
    interface TransferPayload {
        seasonId: string;
        matchday: number;
        transfersIn: string[];
        transfersOut: string[];
        boosterId?: string;
    }
    interface ProcessBallEventsPayload {
        fixtureId: string;
        matchday: number;
        events: BallEvent[];
    }
    interface CreateLeaguePayload {
        leagueName: string;
        seasonId: string;
        maxMembers?: number;
    }
    interface JoinLeaguePayload {
        inviteCode: string;
    }
    interface LeagueLeaderboardPayload {
        groupId: string;
        limit?: number;
    }
    function defaultScoringConfig(seasonId: string): ScoringConfig;
}
declare namespace HiroAchievements {
    function getConfig(nk: nkruntime.Nakama): Hiro.AchievementsConfig;
    function addProgress(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, achievementId: string, amount: number, gameId?: string): Hiro.UserAchievementProgress | null;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace HiroAuctions {
    function getConfig(nk: nkruntime.Nakama): Hiro.AuctionsConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace AdminConsole {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroBase {
    export type IAPStoreType = "apple" | "google" | "facebook" | "fake";
    interface IAPValidationRequest {
        receipt: string;
        storeType: IAPStoreType;
        productId: string;
        price?: number;
        currency?: string;
    }
    interface IAPValidationResult {
        valid: boolean;
        productId: string;
        transactionId?: string;
        storeType: IAPStoreType;
        error?: string;
    }
    export function validateReceipt(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, request: IAPValidationRequest): IAPValidationResult;
    export function generateDefaultUsername(nk: nkruntime.Nakama): string;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace HiroChallenges {
    function getConfig(nk: nkruntime.Nakama): Hiro.ChallengesConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEconomy {
    function getConfig(nk: nkruntime.Nakama): Hiro.EconomyConfig;
    function rpcDonationRequest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcDonationGive(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcDonationClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcRewardedVideoComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEnergy {
    function getConfig(nk: nkruntime.Nakama): Hiro.EnergyConfig;
    function addEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): void;
    function spendEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): boolean;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEventLeaderboards {
    function getConfig(nk: nkruntime.Nakama): Hiro.EventLeaderboardConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroIncentives {
    function getConfig(nk: nkruntime.Nakama): Hiro.IncentivesConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroInventory {
    function getConfig(nk: nkruntime.Nakama): Hiro.InventoryConfig;
    function grantItem(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, itemId: string, count: number, stringProps?: {
        [key: string]: string;
    }, numericProps?: {
        [key: string]: number;
    }, gameId?: string): Hiro.InventoryItem;
    function consumeItem(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, itemId: string, count: number, gameId?: string): boolean;
    function hasItem(nk: nkruntime.Nakama, userId: string, itemId: string, count: number, gameId?: string): boolean;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroLeaderboards {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroMailbox {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroPersonalizers {
    function personalize<T>(nk: nkruntime.Nakama, userId: string, system: string, baseConfig: T, gameId?: string): T;
    function personalizeConfig<T>(nk: nkruntime.Nakama, userId: string, system: string, loader: () => T, gameId?: string): T;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroProgression {
    function getConfig(nk: nkruntime.Nakama): Hiro.ProgressionConfig;
    function getUserProgression(nk: nkruntime.Nakama, userId: string, gameId?: string): Hiro.UserProgression;
    function addXp(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, amount: number, gameId?: string): Hiro.UserProgression;
    function getXpToNextLevel(nk: nkruntime.Nakama, userId: string, gameId?: string): {
        current: number;
        required: number;
        remaining: number;
    };
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroRewardBucket {
    function addProgress(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, bucketId: string, amount: number, gameId?: string): void;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace HiroStats {
    function getConfig(nk: nkruntime.Nakama): Hiro.StatsConfig;
    function updateStat(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, statId: string, value: number, gameId?: string): number;
    function getStat(nk: nkruntime.Nakama, userId: string, statId: string, gameId?: string): number;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroStore {
    function getConfig(nk: nkruntime.Nakama): Hiro.StoreConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroStreaks {
    function getConfig(nk: nkruntime.Nakama): Hiro.StreaksConfig;
    function updateStreak(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, streakId: string, gameId?: string): Hiro.UserStreakState;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroTeams {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroTutorials {
    function getConfig(nk: nkruntime.Nakama): Hiro.TutorialsConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroUnlockables {
    function getConfig(nk: nkruntime.Nakama): Hiro.UnlockablesConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyAnalyticsRetention {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyAnalytics {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyChat {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyCoupons {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyDailyRewards {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyFriends {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyGameEntry {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyGameRegistry {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyGiftCards {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyGroups {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyLeaderboards {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyMissions {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyMultiGame {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyPlayer {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyPush {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyQuestsEconomyBridge {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyQuiz {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyWallet {
    function rpcGetUserWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcLinkWalletToGame(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGetWalletRegistry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletGetAll(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletUpdateGlobal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletUpdateGameWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletTransferBetweenGameWallets(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletGetBalances(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletConvertPreview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletConvertToGlobal(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcWalletConversionRate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGlobalToGameConvert(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGlobalWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGlobalWalletEarn(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGlobalWalletSpend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGlobalWalletHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcCreatePlayerWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcUpdateWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGetWalletBalance(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcCreateOrGetWallet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcCalculateScoreReward(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcUpdateGameRewardConfig(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriAudiences {
    function isInAudience(nk: nkruntime.Nakama, userId: string, audienceId: string): boolean;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriDataLake {
    function exportBatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, events: any[]): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriEventCapture {
    function captureEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void;
    function captureEvents(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, events: Satori.CapturedEvent[]): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriExperiments {
    function getVariant(nk: nkruntime.Nakama, userId: string, experimentId: string): Satori.ExperimentVariant | null;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriFeatureFlags {
    function getFlag(nk: nkruntime.Nakama, userId: string, flagName: string, defaultValue?: string): Satori.Flag;
    function getAllFlags(nk: nkruntime.Nakama, userId: string): Satori.Flag[];
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriIdentities {
    function onEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void;
    function getProperty(nk: nkruntime.Nakama, userId: string, key: string): string | null;
    function getAllProperties(nk: nkruntime.Nakama, userId: string): Satori.IdentityProperties;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriLiveEvents {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriMessages {
    function deliverMessage(nk: nkruntime.Nakama, userId: string, messageDef: Satori.MessageDefinition): void;
    function deliverToAudience(nk: nkruntime.Nakama, logger: nkruntime.Logger, messageDef: Satori.MessageDefinition, audienceId: string): number;
    function processScheduledMessages(nk: nkruntime.Nakama, logger: nkruntime.Logger): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriMetrics {
    function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, metadata: {
        [key: string]: string;
    }): void;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace SatoriTaxonomy {
    interface ValidationResult {
        valid: boolean;
        errors: string[];
        warnings: string[];
    }
    function validateEvent(nk: nkruntime.Nakama, event: Satori.CapturedEvent): ValidationResult;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriWebhooks {
    function dispatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventName: string, payload: any): void;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace ConfigLoader {
    function loadConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T;
    function loadSatoriConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T;
    function saveConfig(nk: nkruntime.Nakama, configKey: string, data: any): void;
    function saveSatoriConfig(nk: nkruntime.Nakama, configKey: string, data: any): void;
    function invalidateCache(configKey?: string): void;
}
declare namespace Constants {
    const SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000000";
    const DEFAULT_GAME_ID = "default";
    function gameKey(gameId: string | undefined, key: string): string;
    const HIRO_CONFIGS_COLLECTION = "hiro_configs";
    const HIRO_ACHIEVEMENTS_COLLECTION = "hiro_achievements";
    const HIRO_INVENTORY_COLLECTION = "hiro_inventory";
    const HIRO_PROGRESSION_COLLECTION = "hiro_progression";
    const HIRO_ENERGY_COLLECTION = "hiro_energy";
    const HIRO_STATS_COLLECTION = "hiro_stats";
    const HIRO_STREAKS_COLLECTION = "hiro_streaks";
    const HIRO_TUTORIALS_COLLECTION = "hiro_tutorials";
    const HIRO_UNLOCKABLES_COLLECTION = "hiro_unlockables";
    const HIRO_MAILBOX_COLLECTION = "hiro_mailbox";
    const HIRO_CHALLENGES_COLLECTION = "hiro_challenges";
    const HIRO_AUCTIONS_COLLECTION = "hiro_auctions";
    const SATORI_CONFIGS_COLLECTION = "satori_configs";
    const SATORI_EVENTS_COLLECTION = "satori_events";
    const SATORI_IDENTITY_COLLECTION = "satori_identity_props";
    const SATORI_ASSIGNMENTS_COLLECTION = "satori_assignments";
    const SATORI_MESSAGES_COLLECTION = "satori_messages";
    const SATORI_METRICS_COLLECTION = "satori_metrics";
    const FANTASY_COLLECTION = "fantasy_cricket";
    const FANTASY_SEASON_LEADERBOARD = "fantasy_season";
    const FANTASY_MATCH_LB_PREFIX = "fantasy_match_";
    const FANTASY_LEAGUE_LB_PREFIX = "fantasy_league_";
    const WALLETS_COLLECTION = "wallets";
    const LEADERBOARDS_REGISTRY_COLLECTION = "leaderboards_registry";
    const DAILY_REWARDS_COLLECTION = "daily_rewards";
    const MISSIONS_COLLECTION = "missions";
    const QUIZ_RESULTS_COLLECTION = "quiz_results";
    const GAME_REGISTRY_COLLECTION = "game_registry";
    const ANALYTICS_COLLECTION = "analytics_error_events";
    const PLAYER_METADATA_COLLECTION = "player_metadata";
    const PUSH_TOKENS_COLLECTION = "push_tokens";
}
declare namespace EventBus {
    type EventHandler = (nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, data: any) => void;
    export function on(eventName: string, handler: EventHandler): void;
    export function emit(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, eventName: string, data: any): void;
    export var Events: {
        CURRENCY_SPENT: string;
        CURRENCY_EARNED: string;
        ITEM_GRANTED: string;
        ITEM_CONSUMED: string;
        ACHIEVEMENT_PROGRESS: string;
        ACHIEVEMENT_COMPLETED: string;
        ACHIEVEMENT_CLAIMED: string;
        LEVEL_UP: string;
        XP_EARNED: string;
        ENERGY_SPENT: string;
        ENERGY_REFILLED: string;
        STAT_UPDATED: string;
        STREAK_UPDATED: string;
        STREAK_BROKEN: string;
        STORE_PURCHASE: string;
        SCORE_SUBMITTED: string;
        CHALLENGE_COMPLETED: string;
        REWARD_GRANTED: string;
        GAME_STARTED: string;
        GAME_COMPLETED: string;
        SESSION_START: string;
        SESSION_END: string;
    };
    export {};
}
declare namespace HttpClient {
    interface HttpResponse {
        code: number;
        body: string;
        headers: any;
    }
    function get(nk: nkruntime.Nakama, url: string, headers?: {
        [key: string]: string;
    }): HttpResponse;
    function post(nk: nkruntime.Nakama, url: string, body: string, headers?: {
        [key: string]: string;
    }): HttpResponse;
    function postJson(nk: nkruntime.Nakama, url: string, data: any, headers?: {
        [key: string]: string;
    }): any;
    function signedPost(nk: nkruntime.Nakama, url: string, data: any, secret: string, additionalHeaders?: {
        [key: string]: string;
    }): any;
}
declare namespace RewardEngine {
    function resolveReward(nk: nkruntime.Nakama, reward: Hiro.Reward): Hiro.ResolvedReward;
    function grantReward(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, resolved: Hiro.ResolvedReward): void;
    function grantToMailbox(nk: nkruntime.Nakama, userId: string, subject: string, reward: Hiro.Reward, expiresAt?: number): void;
}
declare namespace RpcHelpers {
    function validatePayload(payload: any, fields: string[]): {
        valid: boolean;
        missing: string[];
    };
    function safeJsonParse(payload: string): {
        success: boolean;
        data: any;
        error: string | null;
    };
    function successResponse(data: any): string;
    function errorResponse(message: string, code?: number): string;
    function parseRpcPayload(payload: string): any;
    function logRpcError(nk: nkruntime.Nakama, logger: nkruntime.Logger, rpcName: string, errorMessage: string, userId?: string, gameId?: string): void;
    function requireUserId(ctx: nkruntime.Context): string;
    function requireAdmin(ctx: nkruntime.Context, nk: nkruntime.Nakama): void;
}
declare namespace Storage {
    function readJson<T>(nk: nkruntime.Nakama, collection: string, key: string, userId: string): T | null;
    function writeJson(nk: nkruntime.Nakama, collection: string, key: string, userId: string, value: any, permissionRead?: nkruntime.ReadPermissionValues, permissionWrite?: nkruntime.WritePermissionValues): void;
    function writeSystemJson(nk: nkruntime.Nakama, collection: string, key: string, value: any): void;
    function readSystemJson<T>(nk: nkruntime.Nakama, collection: string, key: string): T | null;
    function deleteRecord(nk: nkruntime.Nakama, collection: string, key: string, userId: string): void;
    function readMultiple(nk: nkruntime.Nakama, reads: nkruntime.StorageReadRequest[]): nkruntime.StorageObject[];
    function writeMultiple(nk: nkruntime.Nakama, writes: nkruntime.StorageWriteRequest[]): void;
    function listUserRecords(nk: nkruntime.Nakama, collection: string, userId: string, limit?: number, cursor?: string): {
        records: nkruntime.StorageObject[];
        cursor: string;
    };
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace WalletHelpers {
    interface GameWallet {
        userId: string;
        gameId: string;
        currencies: {
            game: number;
            tokens: number;
            xp: number;
            [key: string]: number;
        };
        items: {
            [key: string]: number;
        };
    }
    function getGameWallet(nk: nkruntime.Nakama, userId: string, gameId: string): GameWallet;
    function saveGameWallet(nk: nkruntime.Nakama, wallet: GameWallet): void;
    function addCurrency(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, currencyId: string, amount: number): GameWallet;
    function spendCurrency(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, currencyId: string, amount: number): GameWallet;
    function hasCurrency(nk: nkruntime.Nakama, userId: string, gameId: string, currencyId: string, amount: number): boolean;
}
declare namespace Hiro {
    interface CurrencyAmount {
        [currencyId: string]: number;
    }
    interface ItemAmount {
        [itemId: string]: {
            min: number;
            max?: number;
        };
    }
    interface RewardModifier {
        id: string;
        operator: "add" | "multiply";
        value: number;
        durationSec: number;
        expiresAt?: number;
    }
    interface RewardGrant {
        currencies?: CurrencyAmount;
        items?: ItemAmount;
        energies?: {
            [energyId: string]: number;
        };
        energyModifiers?: RewardModifier[];
        rewardModifiers?: RewardModifier[];
    }
    interface Reward {
        guaranteed?: RewardGrant;
        weighted?: WeightedReward[];
        maxRolls?: number;
        maxRepeatRolls?: number;
    }
    interface WeightedReward extends RewardGrant {
        weight: number;
    }
    interface ResolvedReward {
        currencies: CurrencyAmount;
        items: {
            [itemId: string]: number;
        };
        energies: {
            [energyId: string]: number;
        };
        modifiers: RewardModifier[];
    }
    interface EconomyConfig {
        currencies: {
            [id: string]: CurrencyConfig;
        };
        donations: {
            [id: string]: DonationConfig;
        };
        storeItems: {
            [id: string]: StoreItemConfig;
        };
    }
    interface CurrencyConfig {
        name: string;
        initialAmount?: number;
        maxAmount?: number;
    }
    interface DonationConfig {
        name: string;
        description?: string;
        cost: {
            currencies: CurrencyAmount;
        };
        count: number;
        durationSec: number;
        maxCount: number;
        reward: Reward;
        senderReward?: Reward;
        userContributionMaxCount?: number;
        additionalProperties?: {
            [key: string]: string;
        };
    }
    interface StoreItemConfig {
        name: string;
        description?: string;
        category?: string;
        cost: {
            currencies?: CurrencyAmount;
        };
        reward: Reward;
        availableAt?: number;
        expiresAt?: number;
        maxPurchases?: number;
        additionalProperties?: {
            [key: string]: string;
        };
    }
    interface InventoryConfig {
        items: {
            [id: string]: InventoryItemConfig;
        };
    }
    interface InventoryItemConfig {
        name: string;
        description?: string;
        category?: string;
        maxCount?: number;
        stackable: boolean;
        consumable: boolean;
        durableSec?: number;
        additionalProperties?: {
            [key: string]: string;
        };
    }
    interface InventoryItem {
        id: string;
        count: number;
        properties?: {
            [key: string]: string;
        };
        stringProperties?: {
            [key: string]: string;
        };
        numericProperties?: {
            [key: string]: number;
        };
        acquiredAt: number;
        expiresAt?: number;
    }
    interface UserInventory {
        items: {
            [id: string]: InventoryItem;
        };
    }
    interface AchievementsConfig {
        achievements: {
            [id: string]: AchievementConfig;
        };
    }
    interface AchievementConfig {
        name: string;
        description?: string;
        category?: string;
        count: number;
        maxCount?: number;
        resetSchedule?: string;
        autoClaimReward: boolean;
        preconditionIds?: string[];
        reward?: Reward;
        subAchievements?: {
            [id: string]: SubAchievementConfig;
        };
        additionalProperties?: {
            [key: string]: string;
        };
    }
    interface SubAchievementConfig {
        name: string;
        count: number;
        reward?: Reward;
    }
    interface UserAchievementProgress {
        id: string;
        count: number;
        completedAt?: number;
        claimedAt?: number;
        resetAt?: number;
        subAchievements?: {
            [id: string]: {
                count: number;
                completedAt?: number;
                claimedAt?: number;
            };
        };
    }
    interface UserAchievements {
        achievements: {
            [id: string]: UserAchievementProgress;
        };
    }
    interface ProgressionConfig {
        levels: ProgressionLevelConfig[];
        maxLevel: number;
        prestigeLevels?: ProgressionLevelConfig[];
    }
    interface ProgressionLevelConfig {
        level: number;
        xpRequired: number;
        reward?: Reward;
    }
    interface UserProgression {
        xp: number;
        level: number;
        prestigeLevel?: number;
        totalXpEarned: number;
    }
    interface EnergyConfig {
        energies: {
            [id: string]: EnergyTypeConfig;
        };
    }
    interface EnergyTypeConfig {
        name: string;
        maxEnergy: number;
        startCount: number;
        regenTimeSec: number;
        maxOverfill?: number;
    }
    interface EnergyState {
        current: number;
        maxEnergy: number;
        regenTimeSec: number;
        lastRegenAt: number;
        modifiers?: RewardModifier[];
    }
    interface UserEnergy {
        energies: {
            [id: string]: EnergyState;
        };
    }
    interface StatsConfig {
        stats: {
            [id: string]: StatConfig;
        };
    }
    interface StatConfig {
        name: string;
        isPublic: boolean;
        defaultValue?: number;
        maxValue?: number;
        aggregation?: "sum" | "max" | "min" | "latest";
    }
    interface UserStats {
        stats: {
            [id: string]: number;
        };
    }
    interface StreaksConfig {
        streaks: {
            [id: string]: StreakConfig;
        };
    }
    interface StreakConfig {
        name: string;
        resetIntervalSec: number;
        gracePeriodSec?: number;
        milestones: {
            [count: string]: Reward;
        };
    }
    interface UserStreakState {
        count: number;
        lastUpdateAt: number;
        claimedMilestones: string[];
    }
    interface UserStreaks {
        streaks: {
            [id: string]: UserStreakState;
        };
    }
    interface EventLeaderboardConfig {
        events: {
            [id: string]: EventLeaderboardEventConfig;
        };
    }
    interface EventLeaderboardEventConfig {
        name: string;
        description?: string;
        durationSec: number;
        schedule?: string;
        cohortSize?: number;
        operator: "best" | "set" | "incr" | "decr";
        sortOrder: "asc" | "desc";
        tiers: EventLeaderboardTier[];
    }
    interface EventLeaderboardTier {
        name: string;
        rankMin: number;
        rankMax: number;
        reward: Reward;
    }
    interface StoreConfig {
        sections: {
            [id: string]: StoreSectionConfig;
        };
    }
    interface StoreSectionConfig {
        name: string;
        items: {
            [id: string]: StoreOfferConfig;
        };
    }
    interface StoreOfferConfig {
        name: string;
        description?: string;
        cost: {
            currencies?: CurrencyAmount;
            iapProductId?: string;
        };
        reward: Reward;
        availableAt?: number;
        expiresAt?: number;
        maxPurchases?: number;
        personalizer?: string;
        additionalProperties?: {
            [key: string]: string;
        };
    }
    interface ChallengesConfig {
        challenges: {
            [id: string]: ChallengeConfig;
        };
    }
    interface ChallengeConfig {
        name: string;
        description?: string;
        maxParticipants: number;
        durationSec: number;
        entryCost?: {
            currencies: CurrencyAmount;
        };
        reward: Reward;
        scoreOperator: "best" | "set" | "incr";
        sortOrder: "asc" | "desc";
    }
    interface TeamsConfig {
        maxMembers: number;
        achievements?: AchievementsConfig;
        stats?: StatsConfig;
    }
    interface TutorialsConfig {
        tutorials: {
            [id: string]: TutorialConfig;
        };
    }
    interface TutorialConfig {
        name: string;
        steps: TutorialStepConfig[];
        reward?: Reward;
    }
    interface TutorialStepConfig {
        id: string;
        name: string;
        reward?: Reward;
    }
    interface UserTutorials {
        tutorials: {
            [id: string]: {
                step: number;
                completedAt?: number;
            };
        };
    }
    interface UnlockablesConfig {
        unlockables: {
            [id: string]: UnlockableConfig;
        };
    }
    interface UnlockableConfig {
        name: string;
        description?: string;
        waitTimeSec: number;
        maxSlots: number;
        slotCost?: {
            currencies: CurrencyAmount;
        };
        reward?: Reward;
    }
    interface AuctionsConfig {
        categories: string[];
        listingFeePct: number;
        durationSec: number;
        maxActiveListings: number;
    }
    interface IncentivesConfig {
        referralReward?: Reward;
        referrerReward?: Reward;
        returnBonusDays?: number;
        returnBonus?: Reward;
    }
    interface MailboxMessage {
        id: string;
        subject: string;
        body?: string;
        reward?: Reward;
        createdAt: number;
        expiresAt?: number;
        claimedAt?: number;
        readAt?: number;
    }
    interface UserMailbox {
        messages: MailboxMessage[];
    }
    interface SystemConfigs {
        economy?: EconomyConfig;
        inventory?: InventoryConfig;
        achievements?: AchievementsConfig;
        progression?: ProgressionConfig;
        energy?: EnergyConfig;
        stats?: StatsConfig;
        streaks?: StreaksConfig;
        eventLeaderboards?: EventLeaderboardConfig;
        store?: StoreConfig;
        challenges?: ChallengesConfig;
        teams?: TeamsConfig;
        tutorials?: TutorialsConfig;
        unlockables?: UnlockablesConfig;
        auctions?: AuctionsConfig;
        incentives?: IncentivesConfig;
    }
}
declare namespace Satori {
    interface CapturedEvent {
        name: string;
        timestamp: number;
        metadata?: {
            [key: string]: string;
        };
    }
    interface IdentityProperties {
        defaultProperties: {
            [key: string]: string;
        };
        customProperties: {
            [key: string]: string;
        };
        computedProperties: {
            [key: string]: string;
        };
    }
    type FilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "not_contains" | "exists" | "not_exists" | "in" | "not_in" | "matches";
    type FilterCombinator = "and" | "or";
    interface AudienceFilter {
        property: string;
        operator: FilterOperator;
        value: string;
    }
    interface AudienceRule {
        combinator: FilterCombinator;
        filters: AudienceFilter[];
        rules?: AudienceRule[];
    }
    interface AudienceDefinition {
        id: string;
        name: string;
        description?: string;
        rule: AudienceRule;
        includeIds?: string[];
        excludeIds?: string[];
        samplePct?: number;
        createdAt: number;
        updatedAt: number;
    }
    interface FlagDefinition {
        name: string;
        value: string;
        description?: string;
        conditionsByAudience?: {
            [audienceId: string]: string;
        };
        enabled: boolean;
        createdAt: number;
        updatedAt: number;
    }
    interface FlagsConfig {
        flags: {
            [id: string]: FlagDefinition;
        };
    }
    interface Flag {
        name: string;
        value: string;
    }
    type ExperimentStatus = "draft" | "running" | "completed" | "archived";
    interface ExperimentVariant {
        id: string;
        name: string;
        config: {
            [key: string]: string;
        };
        weight: number;
    }
    interface ExperimentDefinition {
        id: string;
        name: string;
        description?: string;
        status: ExperimentStatus;
        audienceId?: string;
        variants: ExperimentVariant[];
        goalMetric?: string;
        startAt?: number;
        endAt?: number;
        createdAt: number;
        updatedAt: number;
    }
    interface ExperimentAssignment {
        experimentId: string;
        variantId: string;
        assignedAt: number;
        locked?: boolean;
    }
    interface UserExperiments {
        assignments: {
            [experimentId: string]: ExperimentAssignment;
        };
    }
    type LiveEventStatus = "upcoming" | "active" | "ended";
    interface LiveEventDefinition {
        id: string;
        name: string;
        description?: string;
        audienceId?: string;
        startAt: number;
        endAt: number;
        recurrenceCron?: string;
        reward?: Hiro.Reward;
        config?: {
            [key: string]: string;
        };
        createdAt: number;
        updatedAt: number;
    }
    interface LiveEventRun {
        eventId: string;
        runId: string;
        startAt: number;
        endAt: number;
        status: LiveEventStatus;
    }
    interface UserLiveEventState {
        eventId: string;
        joinedAt?: number;
        claimedAt?: number;
    }
    interface MessageDefinition {
        id: string;
        title: string;
        body?: string;
        imageUrl?: string;
        metadata?: {
            [key: string]: string;
        };
        reward?: Hiro.Reward;
        audienceId?: string;
        scheduleAt?: number;
        expiresAt?: number;
        createdAt: number;
    }
    interface UserMessage {
        id: string;
        messageDefId: string;
        title: string;
        body?: string;
        imageUrl?: string;
        metadata?: {
            [key: string]: string;
        };
        reward?: Hiro.Reward;
        createdAt: number;
        expiresAt?: number;
        readAt?: number;
        consumedAt?: number;
    }
    interface UserMessages {
        messages: UserMessage[];
    }
    type MetricAggregation = "count" | "sum" | "avg" | "min" | "max" | "unique";
    interface MetricDefinition {
        id: string;
        name: string;
        eventName: string;
        metadataField?: string;
        aggregation: MetricAggregation;
        windowSec?: number;
    }
    interface MetricResult {
        metricId: string;
        value: number;
        computedAt: number;
    }
    interface SystemConfigs {
        audiences?: {
            [id: string]: AudienceDefinition;
        };
        flags?: FlagsConfig;
        experiments?: {
            [id: string]: ExperimentDefinition;
        };
        liveEvents?: {
            [id: string]: LiveEventDefinition;
        };
        messages?: {
            [id: string]: MessageDefinition;
        };
        metrics?: {
            [id: string]: MetricDefinition;
        };
    }
}
