declare function LegacyInitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
declare var __TS_OWNED_RPCS: {
    [id: string]: boolean;
} | undefined;
declare function groupAfterJoinHook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: void, request: nkruntime.JoinGroupRequest): void;
declare function groupAfterLeaveHook(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: void, request: nkruntime.LeaveGroupRequest): void;
declare function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer): void;
declare namespace AiPipelines {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvAvatarComparison {
    var COLLECTION: string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvCrashHandler {
    export var LOG_COLLECTION: string;
    export var PATTERN_COLLECTION: string;
    export var STATE_COLLECTION: string;
    export var STATE_KEY_LAST_SUMMARY: string;
    export var MAX_BACKLOG_PER_GAME: number;
    export var SUMMARY_INTERVAL_MS: number;
    export var RAW_RETENTION_MS: number;
    export var MAX_MESSAGE_LEN: number;
    export var MAX_STACK_LEN: number;
    interface PatternRow {
        fingerprint: string;
        count: number;
        severity: string;
        type: string;
        sampleMessage: string;
        firstSeenMs: number;
        lastSeenMs: number;
        appVersions: {
            [v: string]: number;
        };
        osBreakdown: {
            [os: string]: number;
        };
    }
    interface PatternSummary {
        gameId: string;
        builtAtMs: number;
        windowMs: number;
        rawRowsScanned: number;
        patterns: PatternRow[];
    }
    export function maybeRunSummariser(nk: nkruntime.Nakama, logger: nkruntime.Logger): {
        ran: boolean;
        reason?: string;
        perGame?: number;
    };
    /**
     * Public read API used by InsightsAggregator (Phase 2A) to surface
     * top patterns into per-cohort bundles.
     */
    export function readPatternSummary(nk: nkruntime.Nakama, gameId: string): PatternSummary | null;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace QvCrossSell {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace EventEnricher {
    export var SESSION_COLLECTION: string;
    export var GAP_COLLECTION: string;
    export var SESSION_TTL_MS: number;
    export var SESSION_LRU_MAX: number;
    /**
     * Required fields the analyst expects on EVERY event. Anything missing
     * from this set after enrichment lands in the coverage-gap log.
     */
    export var REQUIRED_FIELDS: string[];
    /**
     * Per-event-name enrichment hints. Lets us require quiz_mode on quiz_*
     * events without forcing it on, say, login_success.
     */
    export var EVENT_REQUIRED: {
        [event: string]: string[];
    };
    interface SessionRecord {
        sessionId: string;
        gameId: string;
        userId: string;
        appVersion?: string;
        sdkVersion?: string;
        os?: string;
        osVersion?: string;
        country?: string;
        locale?: string;
        tier?: string;
        deviceModel?: string;
        installSource?: string;
        consentState?: string;
        attStatus?: string;
        cohortLabel?: string;
        cohortDefVersion?: number;
        cohortHoldout?: boolean;
        startedAt: number;
        lastSeenAt: number;
    }
    /**
     * Persist the session context emitted by session_start. Idempotent
     * (writes are keyed by session_id; a re-emitted session_start updates
     * the lastSeenAt timestamp without touching the immutable fields).
     */
    export function upsertSessionIndex(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, rec: Partial<SessionRecord> & {
        sessionId: string;
        gameId: string;
    }): void;
    /**
     * Main entry point. Returns the enriched eventData PLUS the list of
     * fields that were still missing after enrichment (so analytics.js
     * can decide whether to record a coverage gap).
     *
     * Mutates eventData in place. The original analytics.js dimensional
     * back-fill runs BEFORE this; we only fill what's still empty.
     */
    export function enrich(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventName: string, eventData: {
        [k: string]: any;
    }, sessionId: string | undefined, gameId: string): {
        gaps: string[];
    };
    /**
     * Append a coverage-gap row. One row per (event, gap_set) per hour,
     * keyed so re-emissions of the same gap collapse to a single row + a
     * counter rather than spamming the table.
     */
    export function recordCoverageGap(nk: nkruntime.Nakama, logger: nkruntime.Logger, gameId: string, eventName: string, gaps: string[]): void;
    export function maybePostDailyCoverageHealth(nk: nkruntime.Nakama, logger: nkruntime.Logger, webhookUrl: string): void;
    export {};
}
declare namespace InsightsAggregator {
    var EVENTS_COLLECTION: string;
    var SAMPLE_COLLECTION: string;
    var STATE_KEY: string;
    var STATE_COLLECTION: string;
    var DEFAULT_BUCKET_MS: number;
    var MAX_BUCKETS_PER_TICK: number;
    var MIN_TICK_INTERVAL_MS: number;
    var MAX_SAMPLES_PER_BUCKET: number;
    var MAX_EVENTS_PER_BUCKET: number;
    var MAX_BUNDLE_BYTES: number;
    /**
     * Aggregator config — read once from env at module init and passed in
     * so the per-tick path is ctx-free (the wrapped scheduler tick path
     * doesn't have an nkruntime.Context).
     */
    interface AggregatorConfig {
        aiSvcBaseUrl: string;
        insightsSecret: string;
        qvOpsWebhookUrl: string;
        bucketMs?: number;
    }
    /** Init from env — call from AnalyticsAlerts.init / InitModule. */
    function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void;
    function maybeRun(nk: nkruntime.Nakama, logger: nkruntime.Logger): {
        ran: boolean;
        bucketsProcessed: number;
        bundlesEmitted: number;
        reason: string;
    };
    /** Expose the active poster so PendingBundles.drain can replay using
     * the same config (HMAC secret + base URL) without re-reading env. */
    function postBundleNow(nk: nkruntime.Nakama, logger: nkruntime.Logger, bundle: any): boolean;
    /** Expose the qv-ops webhook for ops alerts (e.g. DLQ dead-letters). */
    function getQvOpsWebhookUrl(): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace PendingBundles {
    var COLLECTION: string;
    var DEAD_COLLECTION: string;
    var MAX_ATTEMPTS: number;
    var MAX_DRAIN_PER_TICK: number;
    var BACKOFF_BASE_MS: number;
    function enqueue(nk: nkruntime.Nakama, logger: nkruntime.Logger, bundle: any): void;
    function drain(nk: nkruntime.Nakama, logger: nkruntime.Logger, poster: (bundle: any) => boolean): {
        drained: number;
        deadLetters: number;
    };
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvPersonalization {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvPrivacy {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvProductChangelog {
    var COLLECTION: string;
    var ALLOWED_KINDS: string[];
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace ConvCapture {
    function register(initializer: nkruntime.Initializer): void;
}
/**
 * Cricket Auction — Nakama server module
 *
 * Provides real-time, server-authoritative IPL-style auction rooms.
 * Each room is identified by {leagueId}_{seasonId} and persists in
 * the CRICKET_AUCTION_COLLECTION storage collection.
 *
 * RPCs:
 *   cricket_auction_create_room   — create / reset an auction room
 *   cricket_auction_get_room      — read current room state
 *   cricket_auction_place_bid     — place a server-validated bid
 *   cricket_auction_next_player   — advance to the next nominated player
 *   cricket_auction_get_events    — paginated event log for replay / UI
 */
interface AuctionBid {
    teamId: string;
    amount: number;
    bidderId: string;
    timestamp: string;
}
interface NominatedPlayer {
    playerId: string;
    playerName: string;
    basePrice: number;
    category: string;
    role: string;
    nationality: string;
}
interface AuctionRoomState {
    leagueId: string;
    seasonId: string;
    status: "waiting" | "active" | "paused" | "completed";
    currentPlayer: NominatedPlayer | null;
    currentBid: AuctionBid | null;
    bidHistory: AuctionBid[];
    soldPlayers: Array<{
        playerId: string;
        playerName: string;
        soldToTeamId: string;
        soldPrice: number;
    }>;
    unsoldPlayers: string[];
    teamBudgets: Record<string, {
        remaining: number;
        playersAcquired: number;
        overseasUsed: number;
    }>;
    round: number;
    createdAt: string;
    updatedAt: string;
}
interface AuctionEventRecord {
    eventId: string;
    roomKey: string;
    type: "room_created" | "bid_placed" | "player_sold" | "player_unsold" | "next_player" | "room_completed";
    data: any;
    userId: string;
    timestamp: string;
}
declare const TOTAL_BUDGET = 12000;
declare const MAX_PLAYERS = 25;
declare const MAX_OVERSEAS = 8;
declare function roomKey(leagueId: string, seasonId: string): string;
declare function readRoom(nk: nkruntime.Nakama, key: string): AuctionRoomState | null;
declare function writeRoom(nk: nkruntime.Nakama, key: string, state: AuctionRoomState): void;
declare function appendEvent(nk: nkruntime.Nakama, event: AuctionEventRecord): void;
declare function generateId(): string;
declare function rpcCreateRoom(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcGetRoom(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcPlaceBid(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcNextPlayer(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcGetEvents(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare namespace CricketAuction {
    function register(initializer: nkruntime.Initializer): void;
}
/**
 * Cricket Director — Nakama server module
 *
 * Enforces single-active session per player for the AI Director game mode.
 * Supports save / resume / end flows so players can leave and return
 * to the exact same game state.
 *
 * Storage: CRICKET_DIRECTOR_COLLECTION  (one key per userId)
 *
 * RPCs:
 *   cricket_director_start_session   — start or resume a session
 *   cricket_director_save_session    — checkpoint current state
 *   cricket_director_end_session     — explicitly finish a session
 *   cricket_director_get_session     — read current session (if any)
 *   cricket_director_list_history    — past completed sessions
 */
interface DirectorSessionState {
    sessionId: string;
    userId: string;
    status: "active" | "paused" | "completed" | "abandoned";
    gameMode: string;
    fixtureId: string;
    matchContext: {
        battingTeamId: string;
        bowlingTeamId: string;
        innings: number;
        overs: number;
        balls: number;
        score: number;
        wickets: number;
    };
    directorState: {
        commentaryQueue: string[];
        soundManifestVersion: string;
        difficultyLevel: number;
        aiPersonality: string;
        lastDecisionTimestamp: string;
    };
    checkpoints: Array<{
        timestamp: string;
        label: string;
        stateSnapshot: any;
    }>;
    createdAt: string;
    updatedAt: string;
    completedAt: string | null;
    totalPlayTimeSec: number;
    lastActiveAt: string;
}
interface DirectorHistoryEntry {
    sessionId: string;
    gameMode: string;
    fixtureId: string;
    finalScore: string;
    totalPlayTimeSec: number;
    completedAt: string;
}
declare var HISTORY_COLLECTION: string;
declare var SESSION_TIMEOUT_MS: number;
declare function generateSessionId(): string;
declare function readSession(nk: nkruntime.Nakama, userId: string): DirectorSessionState | null;
declare function writeSession(nk: nkruntime.Nakama, userId: string, session: DirectorSessionState): void;
declare function deleteSession(nk: nkruntime.Nakama, userId: string): void;
declare function archiveSession(nk: nkruntime.Nakama, userId: string, session: DirectorSessionState): void;
declare function isTimedOut(session: DirectorSessionState): boolean;
declare function rpcStartSession(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcSaveSession(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcEndSession(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare function rpcGetSession(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string;
declare function rpcListHistory(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
declare namespace CricketDirector {
    function register(initializer: nkruntime.Initializer): void;
}
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
        MATCH_XI: string;
        SEASON_STATE: string;
        SCORING_CONFIG: string;
        PLAYER_CATALOG: string;
        TRANSFER_WINDOW: string;
        MATCH_POINTS: string;
        LEAGUE_META: string;
        MATCH_DEADLINE: string;
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
    interface MatchXI {
        userId: string;
        fixtureId: string;
        seasonId: string;
        selectedPlayerIds: string[];
        captainId: string;
        viceCaptainId: string;
        lockedAt: string;
    }
    interface MatchDeadline {
        fixtureId: string;
        seasonId: string;
        deadlineAt: number;
        matchStartAt: number;
    }
    interface SelectMatchXIPayload {
        fixtureId: string;
        seasonId: string;
        playerIds: string[];
        captainId: string;
        viceCaptainId: string;
    }
    var SQUAD_SIZE: number;
    var XI_SIZE: number;
    var CREDIT_BUDGET: number;
    var MAX_PER_REAL_TEAM: number;
    var MAX_OVERSEAS_IN_XI: number;
    var MAX_OVERSEAS_IN_SQUAD: number;
    var SQUAD_MIN_ROLES: {
        [role: string]: number;
    };
    var XI_MIN_ROLES: {
        [role: string]: number;
    };
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
declare namespace IntelliverseFriends {
    /**
     * Ensures the Postgres extension and indexes that power tiered+fuzzy
     * search exist. Safe to call on every server boot — every statement
     * uses IF NOT EXISTS.
     *
     * What it creates:
     *   1. The `pg_trgm` extension (Postgres bundled contrib module).
     *   2. A GIN trigram index on `users.username`.
     *   3. A GIN trigram index on `users.display_name`.
     *
     * Failure modes (all degrade gracefully — never crash the runtime):
     *   - CREATE EXTENSION requires a Postgres superuser. If the runtime DB
     *     user lacks that, the extension call fails with permission denied.
     *     We log a one-time WARN and the RPC handler auto-falls-back to
     *     ILIKE-only search (still indexed once the GIN indexes exist).
     *   - If pg_trgm is genuinely absent the GIN-index calls will also fail
     *     because they reference `gin_trgm_ops`. Same degradation path.
     */
    function bootstrapDatabase(nk: nkruntime.Nakama, logger: nkruntime.Logger): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace IntelliverseNearbyPlayers {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace IntelliverseFriendsList {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace IvxPresence {
    function rpcSetPlayerPresence(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcGetCrossGameMessages(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcMarkMessageRead(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FriendsPresenceShared {
    /**
     * Batch-read presence rows for the given users and collapse each into a
     * boolean online flag. One nk.storageRead call regardless of list size.
     * Presence is optional context — any read failure returns an empty map
     * and must never fail the calling RPC.
     */
    function loadOnlineMap(nk: nkruntime.Nakama, userIds: string[]): {
        [id: string]: boolean;
    };
}
declare namespace QvAnalyticsCron {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace BlogEmbed {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvCacheRefreshCron {
    function register(initializer: nkruntime.Initializer): void;
    /**
     * InitModule boot hook: seed video_quiz catalog from the postbuild embed, then
     * force-warm qv_cache_video_quiz. Safe to call on every deploy/restart.
     */
    function bootOnInit(nk: nkruntime.Nakama, logger: nkruntime.Logger, env: {
        [k: string]: string;
    }): void;
}
declare namespace QvContextResolver {
    interface ResolvedContext {
        userId: string;
        username: string;
        gameId: string;
        lang: string;
        countryCode: string;
        mode: string;
    }
    /**
     * resolve() validates authentication and normalises all context fields.
     * Throws UNAUTHENTICATED if ctx.userId is missing.
     *
     * @param nk   — Nakama runtime (used for profile lookup)
     * @param ctx  — RPC context
     * @param req  — parsed JSON request payload (plain object)
     */
    function resolve(nk: nkruntime.Nakama, ctx: nkruntime.Context, req: any): ResolvedContext;
}
declare namespace QuizVerseGenerator {
    function registerNk(nk: nkruntime.Nakama): void;
    function buildAll(): MpKernelSyncTurn.IGenerator[];
}
declare namespace QvGetQuestions {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvGetReview {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuizVerseGrowthSnapshot {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuizVersePlugin {
    var RPC_CREATE_MATCH: string;
    var RPC_LOAD_PACK: string;
    var RPC_LIST_PACKS: string;
    function register(initializer: nkruntime.Initializer): void;
    function registerGenerators(nk: nkruntime.Nakama): void;
}
declare namespace QuizVerseLiveBanner {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuizVerseMigration {
    var RPC_GET_PLAYER_CONTEXT: string;
    var RPC_REQUEST_QUESTIONS: string;
    var RPC_SUBMIT_RESULT_V2: string;
    var RPC_AI_GENERATE: string;
    var RPC_AI_GRADE_SUBJECTIVE: string;
    var RPC_AI_NOTES_CREATE: string;
    var RPC_AI_STT: string;
    var RPC_FETCH_EXTERNAL_QUIZ: string;
    var RPC_MP_REQUEST_PACK: string;
    var RPC_AUTH_SIGNUP: string;
    var RPC_AUTH_LOGIN: string;
    var RPC_AUTH_SOCIAL_LOGIN: string;
    var RPC_AUTH_REFRESH: string;
    var RPC_AUTH_USERINFO: string;
    var RPC_GEO_LOOKUP: string;
    var RPC_TTS_SYNTHESIZE: string;
    var RPC_LICHESS_PUZZLE: string;
    var RPC_XPROMO_GET_APPS: string;
    var RPC_WEBVIEW_TOKEN_ISSUE: string;
    var RPC_ASSET_CATALOG_GET: string;
    var RPC_ANALYTICS_FANOUT: string;
    var RPC_LIVEKIT_TOKEN_MINT: string;
    function register(initializer: nkruntime.Initializer, _nk: nkruntime.Nakama, logger: nkruntime.Logger): void;
}
declare namespace QuizVersePackStore {
    var COLLECTION: string;
    function readPack(nk: nkruntime.Nakama, packId: string): QuizVerseGame.IPack;
    function writePack(nk: nkruntime.Nakama, pack: QuizVerseGame.IPack): void;
}
declare namespace PersonalizedQuests {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace PlayerDNA {
    var COLLECTION: string;
    var KEY: string;
    interface Behavioral {
        peak_hour_utc: number;
        avg_session_questions: number;
        sessions_per_week: number;
        last_played_at: number;
        total_sessions: number;
        cold_start_done: boolean;
        comeback_eligible: boolean;
    }
    interface DNA {
        affinities: {
            [topic: string]: number;
        };
        masteries: {
            [topic: string]: number;
        };
        elos: {
            [topic: string]: number;
        };
        behavioral: Behavioral;
        updated_at: number;
    }
    function load(nk: nkruntime.Nakama, userId: string): DNA;
    function save(nk: nkruntime.Nakama, userId: string, dna: DNA): void;
    function topTopics(dna: DNA, limit: number): string[];
    function weakestTopics(dna: DNA, limit: number): string[];
    function undiscoveredTopics(dna: DNA, allTopics: string[], limit: number): string[];
    function updateAffinity(dna: DNA, topic: string, played: boolean): void;
    function updateMastery(dna: DNA, topic: string, accuracy: number): void;
    function updateElo(dna: DNA, topic: string, accuracy: number, avgDifficulty: number): void;
    function updateBehavioral(dna: DNA, questionCount: number, sessionHourUtc: number): void;
    function coldStartTopic(sessionIndex: number): string;
}
declare namespace QvPrewarmCron {
    function opportunisticTick(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuizVerseProductMetrics {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvQualityGate {
    /**
     * Decode HTML entities in a raw provider string.
     * Handles: named entities (&amp; &eacute; …), decimal (&#160;), hex (&#xA0;).
     * Safe to call on already-clean strings — idempotent, no DOM required.
     */
    function htmlDecode(text: string): string;
    /**
     * Normalize text for deduplication comparison:
     * lowercase → collapse whitespace → trim.
     * Not used for display — only for equality checks.
     */
    function normalizeForDedup(text: string): string;
    /**
     * Dedup key for GATE 6 and buildSeenTextSet.
     * Media questions share template prompts — key on provider_key / media.url instead.
     */
    function questionDedupeKey(q: any): string;
    /**
     * Build a plain-object lookup set from an existing pool of validated questions.
     * Use this for O(1) duplicate detection inside validateQuestion().
     *
     * Start with an empty set for a fresh batch, or seed it with an existing pool
     * when appending to an already-populated cache doc:
     *
     *   var seen = QvQualityGate.buildSeenTextSet(existingPoolQuestions);
     *   // then call validateQuestion(q, seen) for each new candidate
     */
    function buildSeenTextSet(questions: any[]): {
        [key: string]: boolean;
    };
    /**
     * Run all 6 quality gates against a single candidate question.
     *
     * ✦ SIDE EFFECT: q.question_text and q.options[].text are HTML-decoded
     *   in-place before any gate runs. This is intentional — the caller receives
     *   a cleaned question ready for storage without needing a second decode pass.
     *
     * @param q           Raw (provider-normalised) question object.
     * @param seenTextSet Plain-object set returned by buildSeenTextSet().
     *                    Caller is responsible for adding accepted questions to
     *                    the set AFTER this function returns valid=true.
     * @returns           { valid, reject_reason }
     *                    reject_reason is null when valid=true.
     */
    function validateQuestion(q: any, seenTextSet: {
        [key: string]: boolean;
    }): {
        valid: boolean;
        reject_reason: string | null;
    };
    /**
     * Validate an entire array of raw questions in one call.
     * Builds the seen-text set internally (starting empty) so callers don't have
     * to manage it when processing a fresh provider response from scratch.
     *
     * Returns only the questions that passed all 6 gates, plus quality stats
     * suitable for writing into the qv_cache_{topic} quality_gate object.
     *
     * If you are appending to an existing pool, use buildSeenTextSet() +
     * validateQuestion() in a manual loop instead (to seed with existing texts).
     *
     * @param questions   Array of raw normalized question objects.
     * @param logger      Optional Nakama logger for reject-reason debug lines.
     * @param topicTag    Short label used in log lines (e.g. "anime").
     */
    function batchValidate(questions: any[], logger?: nkruntime.Logger, topicTag?: string): {
        passed: any[];
        rejected_count: number;
        total_processed: number;
        top_reject_reason: string | null;
    };
}
declare namespace QvQuestionCache {
    interface NormalizedQuestion {
        id: string;
        topic: string;
        lang: string;
        question_text: string;
        question_type: string;
        options: Array<{
            id: string;
            text: string;
        }>;
        correct_option_ids: string[];
        has_media: boolean;
        media: any;
        explanation: string;
        difficulty: string;
        provider: string;
    }
    /**
     * Idempotent seed: writes qv_catalog_video_quiz/catalog_{lang} + meta when the
     * bundled version differs from storage. Reads globalThis.__QV_VIDEO_QUIZ_CATALOG__
     * injected by postbuild.js at deploy time.
     */
    export function ensureVideoQuizCatalogSeeded(nk: nkruntime.Nakama, logger: nkruntime.Logger): {
        ok: boolean;
        version?: string;
        question_count?: number;
        skipped?: boolean;
        error?: string;
    };
    /**
     * Full cache refresh pipeline for one topic.
     * Steps: circuit-check → fetch → validate+decode → shuffle+assign → enrich → store.
     * Falls back silently (keeps stale cache) on any error; records failure in circuit breaker.
     */
    export function refreshCache(nk: nkruntime.Nakama, logger: nkruntime.Logger, env: {
        [k: string]: string;
    }, topic: string, force?: boolean): {
        ok: boolean;
        topic: string;
        count: number;
        error?: string;
    };
    /**
     * Read the full validated pool for a topic (all pages merged).
     * Returns empty array + expired=true on cache miss.
     * Caller decides whether to trigger refreshCache().
     */
    export function readCache(nk: nkruntime.Nakama, logger: nkruntime.Logger, topic: string): {
        questions: NormalizedQuestion[];
        expired: boolean;
        cached_at_ms: number;
    };
    /**
     * Lightweight freshness check — reads only pool_0 metadata (no questions loaded).
     * Use before readCache to decide whether to trigger a background refresh.
     */
    export function isCacheValid(nk: nkruntime.Nakama, topic: string): boolean;
    /**
     * Refresh ALL cacheable topics one-by-one with a 2 s stagger between each.
     * The stagger prevents simultaneous bursts against external providers.
     * Intended for a Nakama scheduled / cron job — NEVER call from a player RPC.
     * Returns an array of per-topic results (same shape as refreshCache).
     */
    export function refreshAllTopics(nk: nkruntime.Nakama, logger: nkruntime.Logger, env: {
        [k: string]: string;
    }): Array<{
        ok: boolean;
        topic: string;
        count: number;
        error?: string;
    }>;
    export {};
}
declare namespace QvRemoteConfig {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvSRQ {
    /**
     * Schedule questions for spaced review after a quiz session.
     * - wrongIds  → due in WRONG_INTERVAL_MS (3 days)
     * - correctIds → due in CORRECT_INTERVAL_MS (7 days) for reinforcement
     *   If an ID was previously in the queue and is now correct, its interval
     *   doubles (capped at 21 days) to back off scheduling.
     */
    function schedule(nk: nkruntime.Nakama, userId: string, topic: string, wrongIds: string[], correctIds: string[]): void;
    /**
     * Return questions from `pool` whose IDs are due for SRQ review now.
     * Results are sorted by due_at_ms ascending (most overdue first).
     * This list is prepended to the delivered pack so the player reviews
     * weak questions before seeing fresh ones.
     */
    function getDueInPool(nk: nkruntime.Nakama, userId: string, topic: string, pool: any[]): any[];
    /**
     * Remove reviewed question IDs from the SRQ (they are now mastered or
     * explicitly dismissed).  Call after a successful review session.
     */
    function markReviewed(nk: nkruntime.Nakama, userId: string, topic: string, questionIds: string[]): void;
    /**
     * Count the total number of SRQ entries due right now across ALL topics
     * for this user.  Used to populate the `personalization.srq_due_count`
     * field in submit_result responses.  Reads at most 20 topic queues.
     */
    function countDue(nk: nkruntime.Nakama, userId: string): number;
}
declare namespace QvSubmitResult {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuizVerseGame {
    var Op: {
        QUESTION_PROMPT: number;
        ANSWER: number;
        REVEAL: number;
        LEADERBOARD: number;
        LIFELINE_USE: number;
        LIFELINE_RESULT: number;
        AI_HOST_LINE: number;
        VOICE_TOGGLE: number;
        BOOST_APPLIED: number;
        REMATCH_REQUEST: number;
        REMATCH_ACCEPT: number;
        TEAM_JOIN: number;
        TEAM_STATE: number;
        TEAM_SCORE_DELTA: number;
        BATTLE_CONFIG: number;
        TEAMS_READY: number;
    };
    var BattleMode: {
        UNSPECIFIED: number;
        ONE_VS_ONE: number;
        TWO_VS_TWO: number;
        THREE_VS_THREE: number;
        FOUR_VS_FOUR: number;
        FIVE_VS_FIVE: number;
    };
    var BattleTeam: {
        NONE: number;
        ONE: number;
        TWO: number;
    };
    interface ITeamMember {
        user_id: string;
        display_name: string;
        team: number;
    }
    interface ITeamState {
        members: ITeamMember[];
        team1_name: string;
        team2_name: string;
        team1_score: number;
        team2_score: number;
        teams_ready: boolean;
        team_size: number;
    }
    interface IBattleConfig {
        mode: number;
        team1_name: string;
        team2_name: string;
        timeout_seconds: number;
        room_code: string;
        challenger_id: string;
        challenger_name: string;
        topics: string[];
    }
    function teamSizeForMode(mode: number): number;
    function maxPlayersForMode(mode: number): number;
    var Mode: {
        CLASSIC: string;
        FRIEND_BATTLE: string;
        LINK_AND_PLAY: string;
    };
    interface IQuestion {
        question_id: string;
        text: string;
        options: string[];
        correct_index: number;
        image_url?: string;
        audio_url?: string;
        category?: string;
        difficulty?: number;
        explanation?: string;
    }
    interface IPack {
        pack_id: string;
        questions: IQuestion[];
        locale?: string;
        revision?: number;
    }
    interface IInit {
        mode: string;
        pack_id: string;
        questions_total: number;
        per_question_ms: number;
        room_code?: string;
        ai_host_persona?: string;
        enable_voice?: boolean;
        battle?: IBattleConfig;
    }
    var DefaultInit: IInit;
    var SEED_PACK: IPack;
}
declare namespace Hermes {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroAchievements {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.AchievementsConfig;
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
declare namespace BattlePassEngine {
    function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, eventType: string, value: number): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroChallenges {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.ChallengesConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEconomy {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.EconomyConfig;
    function rpcDonationRequest(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcDonationGive(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcDonationClaim(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcRewardedVideoComplete(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcSpend(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEnergy {
    function getConfig(nk: nkruntime.Nakama): Hiro.EnergyConfig;
    function addEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): void;
    function spendEnergy(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, energyId: string, amount: number, gameId?: string): boolean;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroEventLeaderboards {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.EventLeaderboardConfig;
    function eventLeaderboardId(nk: nkruntime.Nakama, gameId: string | undefined, eventId: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroIncentives {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.IncentivesConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroInventory {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.InventoryConfig;
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
declare namespace HiroCreatorEventRewards {
    function createBucketForEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventId: string, prizes: {
        tier: string;
        percentage: number;
        maxWinners: number;
        nftBadgeId?: string;
    }[], prizePool: number): void;
    function getTierReward(nk: nkruntime.Nakama, eventId: string, tierName: string): Hiro.Reward | null;
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
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.StoreConfig;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace HiroStreaks {
    function getConfig(nk: nkruntime.Nakama, gameId?: string): Hiro.StreaksConfig;
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
declare function persistNormalizedEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, ev: any): void;
declare namespace QvEntitlements {
    function grantSubscription(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, productId: string, store: string, expiresAt: string | null): void;
    function grantConsumable(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, productId: string, quantity: number): void;
    function grantOneTime(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, productId: string): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvExplainerVideos {
    /** Called from entitlements rc_sync / grantConsumable. */
    function grantExplainerCredits(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, productId: string, quantity: number): number;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace AccountMerge {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace IdentityResolver {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QvKbUserDump {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LearnerToolbelt {
    var MODULE_VERSION: string;
    interface LearnerStateInputs {
        declared_intent: string | null;
        has_exam_declared: boolean;
        has_school_declared: boolean;
        quiz_count_last_30d: number;
    }
    interface LearnerStateDerived {
        mode: string;
        has_history: boolean;
        copy_namespace: string;
        recommended_tool: string;
        display_name_for_user: string;
    }
    function deriveLearnerMode(inputs: LearnerStateInputs): LearnerStateDerived;
    function shouldShowSoftExamCta(metrics: {
        quizzes_played_last_2w: number;
        daysActive_last_2w: number;
    }, lastNudgeUnix: number | null): boolean;
    function buildLearnerInsightsResponse(args: {
        state: string;
        mode: string;
        locale: string;
    }): any;
    function rpcLearnerStateGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcLearnerInsightsGet(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcLearnerSoftCtaCheck(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LearnerToolbelt {
    var EXAM_CALENDAR_VERSION: string;
    interface ExamCalendarEntry {
        exam_id: string;
        exam_label: string;
        country: string;
        year: number;
        date_iso: string | null;
        date_window_label: string;
        registration_open_iso: string | null;
        registration_close_iso: string | null;
        source_url: string;
    }
    function getCalendarEntries(country: string, year: number): ExamCalendarEntry[];
    function lookupExamUpcoming(examId: string, nowUnix: number): ExamCalendarEntry | null;
}
declare namespace LearnerToolbelt {
    interface GpaCourseInput {
        name?: string;
        grade?: string | number;
        credits?: number;
        is_ap?: boolean;
        is_honors?: boolean;
    }
    interface GpaCourseBreakdown {
        name: string;
        grade_input: string;
        grade_native: number;
        grade_us4: number;
        credits: number;
        weighted_bonus: number;
        quality_points_native: number;
        quality_points_us4: number;
    }
    interface GpaComputeResult {
        ok: boolean;
        system: string;
        system_label: string;
        native_gpa: number;
        native_max: number;
        wes_4_0: number;
        percentile_band: string;
        breakdown: GpaCourseBreakdown[];
        courses_used: number;
        courses_skipped: number;
        warnings: string[];
    }
    function computeGpa(systemId: string, courses: GpaCourseInput[]): GpaComputeResult;
}
declare namespace LearnerToolbelt {
    function i18nRecommendation(locale: string, examId: string, band: string): string;
    function i18nString(locale: string, key: string): string;
}
declare namespace LearnerToolbelt {
    interface ScorePredictRequest {
        exam_id: string;
        locale: string;
        recent_quiz_window_days: number;
    }
    interface ScorePredictBucket {
        scaled_score: number | null;
        percentile: number | null;
        rank: number | null;
        grade: string | null;
        ci_low: number;
        ci_high: number;
    }
    interface ScorePredictResult {
        ok: boolean;
        status: string;
        exam_id: string;
        predictor_tier: string;
        model_version: string;
        quizzes_used: number;
        quizzes_total_in_window: number;
        min_quizzes_for_high_confidence: number;
        accuracy_observed: number;
        posterior_mean: number;
        predicted: ScorePredictBucket;
        recommendation_text: string;
        confidence_pct: number;
        generated_unix: number;
        ttl_seconds: number;
    }
    interface QuizHistoryEntry {
        timestamp: number;
        correctAnswers: number;
        totalQuestions: number;
        category: string;
    }
    function betaPosteriorBounds(correct: number, total: number): {
        mean: number;
        lo90: number;
        hi90: number;
    };
    function filterHistoryForExam(rows: QuizHistoryEntry[], examId: string, windowDays: number, nowUnix: number): {
        matched: QuizHistoryEntry[];
        total: number;
    };
    function accuracyBand(accuracy: number): string;
    function predictFromHistory(req: ScorePredictRequest, history: QuizHistoryEntry[], nowUnix: number): ScorePredictResult;
    function expectedUpliftPerQuiz(examId: string): {
        unit: string;
        value: number;
    };
}
declare namespace LearnerToolbelt {
    interface SchoolRecord {
        school_id: string;
        source: string;
        display_name: string;
        city: string;
        state_region: string;
        country_code: string;
        board: string | null;
        grade_band: string;
        lat: number | null;
        lng: number | null;
        language_of_instruction: string | null;
        institution_type: string;
    }
    var SCHOOL_FIXTURE: SchoolRecord[];
    var COLLEGE_FIXTURE: SchoolRecord[];
    interface SchoolSearchHit {
        school_id: string;
        display_name: string;
        city: string;
        state_region: string;
        country_code: string;
        board: string | null;
        source: string;
        institution_type: string;
        score: number;
    }
    function searchSchools(query: string, countryCode: string, limit: number, institutionType?: string): SchoolSearchHit[];
    function getSchoolById(schoolId: string): SchoolRecord | null;
    function bootstrapSchoolsTable(nk: nkruntime.Nakama, logger: nkruntime.Logger): void;
    function searchSchoolsDB(nk: nkruntime.Nakama, query: string, countryCode: string, limit: number, institutionType?: string): SchoolSearchHit[];
    function mergeHits(primary: SchoolSearchHit[], secondary: SchoolSearchHit[], limit: number): SchoolSearchHit[];
    function getSchoolByIdDB(nk: nkruntime.Nakama, schoolId: string): SchoolRecord | null;
    function getSchoolByIdAny(nk: nkruntime.Nakama, schoolId: string): SchoolRecord | null;
}
declare namespace PerExamConfig {
    type PredictorMethod = 'irt-2pl' | 'concordance' | 'ap-composite' | 'irt-section-adaptive' | 'irt-focus-edition' | 'percentile-4section' | 'raw-to-scaled-120-180' | 'cutoff-band' | 'mbe-mee-mpt-composite' | 'nta-percentile-to-air' | 'marks-vs-rank-curve' | 'section-percentile-to-oa' | 'gate-score-formula' | 'prelims-cutoff-band' | 'marks-to-nlu-rank' | 'nta-percentile-multisubject' | 'written-cutoff-only' | 'tier-1-2-composite' | 'phase-1-2-cutoff' | 'bayes-fallback' | 'uk-boundary';
    type PredictorPhase = 'A' | 'B' | 'C';
    interface ExamSection {
        id: string;
        max: number;
        weight?: number;
    }
    interface ExamPredictorConfig {
        method: PredictorMethod;
        phase: PredictorPhase;
        /** ISO-3166 alpha-2 default country (for diaspora users we still honour
         *  per-call locale + country query params; this is just the *exam* origin). */
        countryDefault: string;
        /** [min, max] inclusive of the published scale. */
        scoreRange: [number, number];
        /** Sections this exam has (e.g. SAT = math+verbal, JEE Main = phy+chem+math).
         *  Empty array is acceptable for composite-only exams. */
        sections: ExamSection[];
        /** Public source URLs cited in plan §3.10 / §12. */
        citations: string[];
        /** ISO date of the last calibration data refresh (optional — populated when
         *  the per-exam algorithm lands in wave 4-5). */
        lastCalibration?: string;
        /** Goal-rank tiers used by the §3.5 context block — e.g. for JEE we surface
         *  ['IIT', 'NIT', 'IIIT', 'private']. */
        goalTiers?: string[];
    }
    var CONFIG: {
        [examId: string]: ExamPredictorConfig;
    };
    /** Returns the supported exam_id list (alphabetical) — used by /tools/score-predictor for the dropdown. */
    function listSupportedExamIds(): string[];
    /** Returns the config for a given exam_id, or null if not in the supported set
     *  (in which case the caller MUST fall through to the Bayes fallback). */
    function lookup(examId: string): ExamPredictorConfig | null;
}
declare namespace LegacyAnalyticsRetention {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyAnalytics {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyChat {
    function flushFailedChatPushes(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void;
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
    function resolveCanonicalGameId(nk: nkruntime.Nakama, raw: string | undefined): string | undefined;
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
declare namespace LegacyMultiGame {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyNotifScheduler {
    var MATCH_NAME: string;
    interface SchedulerState {
        lastDispatchedMinute: {
            [taskName: string]: number;
        };
        lastLog: number;
    }
    function nowMinute(): number;
    var DISPATCH_COLLECTION: string;
    var DISPATCH_KEY: string;
    function readSharedDispatch(nk: nkruntime.Nakama): {
        tasks: {
            [task: string]: number;
        };
        version: string;
    };
    function writeSharedDispatch(nk: nkruntime.Nakama, tasks: {
        [task: string]: number;
    }, version: string): void;
    function sharedDue(tasks: {
        [task: string]: number;
    }, task: string, periodMin: number): boolean;
    function shouldDispatch(state: SchedulerState, task: string, periodMin: number): boolean;
    function tryAcquireDispatchLock(nk: nkruntime.Nakama, taskName: string, periodMin: number): boolean;
    function dispatchSafely(taskName: string, fn: Function, ctx: any, logger: nkruntime.Logger, nk: nkruntime.Nakama): void;
    function matchInitImpl(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, _params: {
        [k: string]: string;
    }): {
        state: SchedulerState;
        tickRate: number;
        label: string;
    };
    function matchJoinAttemptImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presence: nkruntime.Presence, _metadata: {
        [k: string]: any;
    }): {
        state: SchedulerState;
        accept: boolean;
        rejectMessage: string;
    };
    function matchJoinImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presences: nkruntime.Presence[]): {
        state: SchedulerState;
    };
    function matchLeaveImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _presences: nkruntime.Presence[]): {
        state: SchedulerState;
    };
    function matchLoopImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, _messages: nkruntime.MatchMessage[]): {
        state: SchedulerState;
    };
    function matchSignalImpl(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, data: string): {
        state: SchedulerState;
        data: string;
    };
    function matchTerminateImpl(_ctx: nkruntime.Context, logger: nkruntime.Logger, _nk: nkruntime.Nakama, _dispatcher: nkruntime.MatchDispatcher, _tick: number, state: SchedulerState, graceSeconds: number): {
        state: SchedulerState;
    };
    var _spawned: boolean;
    function spawnSchedulerMatch(logger: nkruntime.Logger, nk: nkruntime.Nakama): void;
    function register(_initializer: nkruntime.Initializer): void;
}
declare namespace LegacyPlayer {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace PushAlerts {
    function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void;
    function ensureConfigured(ctx: nkruntime.Context, logger: nkruntime.Logger): void;
    function recordOutcome(nk: nkruntime.Nakama, logger: nkruntime.Logger, source: string, attempted: number, delivered: number, dead: number, codeTally?: {
        [code: string]: number;
    }): void;
    function register(initializer: nkruntime.Initializer): void;
    interface GateReasons {
        quietHours: number;
        alreadySent: number;
        noToken: number;
        sendFailed: number;
    }
    interface CronStats {
        cronName: string;
        dateKey: string;
        topic?: string;
        scanned: number;
        sent: number;
        gated: number;
        noQuiz?: boolean;
        byLocale: {
            [locale: string]: {
                sent: number;
                gated: number;
            };
        };
        gateReasons?: GateReasons;
        dedupedDevices?: number;
    }
    function postCronReport(nk: nkruntime.Nakama, logger: nkruntime.Logger, stats: CronStats): void;
    function cacheWebhookUrl(nk: nkruntime.Nakama): void;
}
declare namespace LegacyPush {
    export function userHasPushTokens(nk: nkruntime.Nakama, userId: string): boolean;
    export function sendLocalizedPushToUser(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string, eventType: string, titleKey: string, bodyKey: string, vars: any, opts?: {
        skipQuietHours?: boolean;
        gameId?: string;
        data?: any;
        skipInAppNotification?: boolean;
        dedupArns?: {
            [arn: string]: boolean;
        };
        dedupStats?: {
            skippedDevices: number;
        };
    }): boolean;
    export function retryChatProviderPush(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string, eventType: string, title: string, body: string, data: {
        [k: string]: any;
    }): boolean;
    function rpcNotifCronDailyQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    export function runPremiumDailyQuizCron(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronWeeklyQuiz(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronIdleWinback(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronStreakWarning(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronMotivation(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronReminders(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcNotifCronReview(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    export var runDailyQuizCron: typeof rpcNotifCronDailyQuiz;
    export var runWeeklyQuizCron: typeof rpcNotifCronWeeklyQuiz;
    export var runIdleWinbackCron: typeof rpcNotifCronIdleWinback;
    export var runStreakWarningCron: typeof rpcNotifCronStreakWarning;
    export var runMotivationCron: typeof rpcNotifCronMotivation;
    export var runRemindersCron: typeof rpcNotifCronReminders;
    export var runReviewCron: typeof rpcNotifCronReview;
    export function flushPendingRegistrations(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace QuestEventBridge {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyQuestsEconomyBridge {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyQuiz {
    function register(initializer: nkruntime.Initializer): void;
}
/**
 * UserMgmt Sync — Best-effort propagation of player profile fields from Nakama
 * to the Intelliverse-X-UserManagement service (NestJS).
 *
 * Direction: Nakama RPC → UserMgmt PUT /api/user/user/profile
 *
 * Auth: Caller's Cognito access token (forwarded from Unity via the RPC payload
 * field `_cognito_jwt`). UserMgmt validates the JWT against Cognito, so Nakama
 * never needs UserMgmt admin credentials for this flow.
 *
 * Loop prevention: requests carry `X-Sync-Origin: nakama-rpc`. UserMgmt's
 * profile-update endpoint does not currently push back to Nakama, so this is
 * defence-in-depth — if a future change adds reverse sync, it can short-circuit
 * on this header.
 *
 * Failure model: best-effort. The Nakama write has already succeeded by the
 * time this is called, so we never throw. Errors are logged and surfaced in
 * the RPC response under `userMgmtSync` so Unity can decide whether to warn.
 *
 * Configuration: production defaults are hardcoded so the feature works
 * immediately after a CodeBuild deploy without any env-var wiring. Env vars
 * are optional overrides — once they're set, they win:
 *   USERMGMT_API_BASE_URL   override the hardcoded BASE_URL_DEFAULT
 *   USERMGMT_SYNC_ENABLED   "false" | "0" to disable; anything else (incl.
 *                           unset) keeps it enabled
 */
declare namespace LegacyUserMgmtSync {
    interface SyncResult {
        enabled: boolean;
        skipped?: string;
        success?: boolean;
        statusCode?: number;
        error?: string;
        errorCode?: string;
        syncedFields?: string[];
    }
    /**
     * Forwards a profile update to UserMgmt. Synchronous, single attempt, ~10s
     * Nakama HTTP timeout. Caller MUST already have committed the Nakama write
     * before invoking this — there is no rollback.
     *
     * @param fields  Source fields (Nakama-shape). Pass only what changed.
     * @param jwt     Cognito access token from Unity (the same token Unity
     *                would use to call UserMgmt directly). Empty string → skip.
     */
    function pushProfile(nk: nkruntime.Nakama, logger: nkruntime.Logger, nakamaUserId: string, jwt: string, fields: {
        [key: string]: any;
    }): SyncResult;
}
declare namespace LegacyWallet {
    /**
     * Server-side credit for another user's global/XUT balance.
     * Mirrors wallet_update_game_wallet with currency "global"/"xut" and operation "add".
     */
    function addGlobalWalletCurrency(nk: nkruntime.Nakama, userId: string, amount: number): {
        success: boolean;
        newBalance: number;
        error?: string;
    };
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
/**
 * library-countdown.ts — Top Learners Library exam-countdown subscriptions.
 *
 * Spec lives in the Quizverse-web-frontend repo at QUIZVERSE_LIBRARY_10X_PLAN.md §4.7.
 * Mirrors the runtime contract in `web/lib/library/exam-countdown.ts`.
 *
 * NOTE on file format:
 *   The repo policy (see .gitignore L745-L746) explicitly blocks
 *   `data/modules/*.lua` files from being committed — the TS source at
 *   `data/modules/src/**` is the only source of truth, and the runtime
 *   loads `data/modules/build/index.js` produced by the TS build.
 *   This file is the canonical home for the 4 RPCs. A reference Lua
 *   transliteration exists at `data/modules/library_countdown.lua` for
 *   ops scripts but is intentionally gitignored.
 *
 * RPCs registered:
 *   library.countdown.subscribe     — { exam_id, exam_date, custom?, channels?[], milestones?[] }
 *   library.countdown.unsubscribe   — { exam_id, exam_date }
 *   library.countdown.list_mine     — returns caller's subscriptions with days_remaining
 *   library.countdown.emit_due      — system-only sweep; emits notifications for
 *                                     milestones whose offset matches today's days-to-exam.
 *
 * Storage: collection "library_countdown_subs", key "<exam_id>:<exam_date>".
 * Owner-read + system-read (perm 2), owner-only write (perm 1).
 *
 * Wiring: add `LibraryCountdownPlugin.register(initializer, nk, logger)` to
 * `src/main.ts` next to QuizVersePlugin.register(...). Not done in this commit
 * to keep the bundle rebuild atomic with the rest of the Library mount.
 */
declare namespace LibraryCountdownPlugin {
    function register(initializer: nkruntime.Initializer, _nk: nkruntime.Nakama, logger: nkruntime.Logger): void;
}
/**
 * n8n-pack-state.ts — pack_complete gate for the v2.4.0 library format-agents.
 *
 * Spec lives in Quizverse-web-frontend `QUIZVERSE_LIBRARY_10X_PLAN.md` §19.6 and
 * the companion `intelli-verse-kube-infra` repo PR (n8n workflows #20-25).
 *
 * Purpose
 * -------
 * Six n8n agents (#20 audio synth, #21 video shorts, #22 live scheduler,
 * #23 sim ingest, #24 widget refresh, #25 pack bundler) produce content
 * for a single exam in parallel. Agent #25 (the bundler) is the GATE —
 * it should only compose the 3 one-time IAP SKUs once #20 + #21 + #23
 * have all completed successfully for that exam.
 *
 * This module tracks per-exam agent completion state and emits an HTTP
 * webhook to agent #25's trigger URL when the gate condition flips true.
 *
 * RPCs registered
 * ---------------
 *   n8n_pack_state_emit       — called by agents #20-24 with { examTag, agent, status }
 *   n8n_pack_state_query      — returns full state for an examTag
 *   n8n_pack_state_list_ready — admin/system — lists exams ready for bundling
 *   n8n_pack_state_reset      — admin — resets state for an examTag
 *                               (used to re-trigger bundling after content edits)
 *
 * Storage
 * -------
 * Collection "n8n_pack_state", key = examTag. System-write, owner=system,
 * readPermission=2 so n8n service-account can poll.
 *
 * Gate transition behaviour
 * -------------------------
 * On every emit, if status === "success" we mark the agent as green.
 * When the green set ⊇ { audio_synth, video_shorts, sim_ingest } and the
 * exam has not previously been bundled, we:
 *   1. Set bundleSignaledAt to now (locks against double-fire)
 *   2. POST to {{N8N_PACK_BUNDLER_WEBHOOK}} with { examTag, audioPackId,
 *      videoShortsPackId, interactiveSimPackId, liveSessionPackId? }
 *
 * Re-bundling is opt-in via `n8n_pack_state_reset`.
 *
 * Wiring
 * ------
 * Uses the same single-arg `register(initializer)` signature as
 * BracketTournaments so the postbuild auto-invokes the module at IIFE
 * scope and populates the __rpc_* globals in pooled Goja VMs.
 */
declare namespace N8nPackStatePlugin {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace MpKernelAgent {
    var Op: {
        AGENT_JOINED: number;
        AGENT_LEFT: number;
        AGENT_THINKING: number;
        AGENT_SPOKE: number;
        AGENT_VISEME_STREAM: number;
        AGENT_REQUEST_TURN: number;
        AGENT_GRANT_TURN: number;
        AGENT_DEGRADED: number;
        AGENT_BUDGET_EXCEEDED: number;
        AGENT_CONTEXT_RESET: number;
        AGENT_TOOL_CALL: number;
        AGENT_TOOL_RESULT: number;
    };
    interface IPersonaConstraints {
        max_response_tokens: number;
        max_responses_per_minute: number;
        max_seconds_speaking_per_minute: number;
        max_concurrent_matches: number;
        allow_proactive_speak: boolean;
        allow_tools: boolean;
        cost_budget_usd_micros_per_match: number;
        locale_allowlist_csv: string;
    }
    interface IAgentPersona {
        persona_id: string;
        display_name: string;
        avatar_url: string;
        voice_id: string;
        llm_provider: string;
        llm_model: string;
        system_prompt_ref: string;
        constraints: IPersonaConstraints;
        version_major: number;
        version_minor: number;
    }
    interface IAgentInstance {
        agent_id: string;
        persona_id: string;
        display_name: string;
        avatar_url: string;
        spawned_by_user: string;
        spawn_reason: string;
        spawned_unix_ms: number;
        match_id: string;
        constraints: IPersonaConstraints;
        cost_used_usd_micros: number;
        speech_seconds_used: number;
        response_count_window: {
            unix_minute: number;
            count: number;
        };
        speak_window: {
            unix_minute: number;
            seconds: number;
        };
        last_speak_unix_ms: number;
        provider_state: "primary" | "fallback" | "silent";
        persona_version_major: number;
        persona_version_minor: number;
    }
    interface ISpeakRequest {
        match_id: string;
        agent_id: string;
        text: string;
        locale?: string;
        is_proactive?: boolean;
        /** Emit visemes only — no transcript. Used for greetings / sound effects. */
        silent_transcript?: boolean;
    }
    interface ISpeakResult {
        accepted: boolean;
        rejected_reason?: string;
        transcript_text?: string;
        cost_usd_micros?: number;
        ttfa_ms?: number;
        moderated?: boolean;
    }
    function registerPersona(p: IAgentPersona): void;
    function listPersonas(): IAgentPersona[];
    function getPersona(id: string): IAgentPersona | null;
    function isAgentId(userId: string): boolean;
    function newAgentId(personaId: string, suffix?: string): string;
    /**
     * Spawn an agent into a match. The kernel injects the agent as a
     * server-managed presence (no real socket); templates see it like any
     * other player. Returns the agent_id (or "" + reason on failure).
     */
    function spawnIntoMatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, matchId: string, personaId: string, opts?: {
        spawned_by_user?: string;
        spawn_reason?: string;
        agent_id?: string;
    }): {
        agent_id: string;
        rejected_reason?: string;
    };
    /**
     * Despawn an agent from a match. Reason gets propagated as AgentLeft.
     */
    function despawnFromMatch(matchId: string, agentId: string, reason: string): void;
    function getAgentsInMatch(matchId: string): IAgentInstance[];
    function getAgent(matchId: string, agentId: string): IAgentInstance | null;
    interface IIVXLLMProvider {
        /** Return the response text for `prompt` and the cost in $-micros. */
        complete(prompt: string, persona: IAgentPersona, locale?: string): {
            text: string;
            cost_usd_micros: number;
            provider: string;
        };
        /** Quick health probe; updates providerHealth map. */
        healthCheck(): boolean;
    }
    interface IIVXTTSProvider {
        /** Return time-to-first-audio in ms and a viseme byte stream. */
        speak(text: string, voiceId: string, locale: string): {
            ttfa_ms: number;
            visemes: number[];
        };
    }
    function setLLMProvider(p: IIVXLLMProvider): void;
    function setTTSProvider(p: IIVXTTSProvider): void;
    /**
     * Dummy fallback provider — returns a fixed string so the kernel can
     * keep agents "alive" even when no real LLM is plugged in. Used by
     * tests + first-boot smoke runs.
     */
    var ECHO_LLM_PROVIDER: IIVXLLMProvider;
    var SILENT_TTS_PROVIDER: IIVXTTSProvider;
    /**
     * The single entry point for "make agent X say Y in match Z".
     */
    function enqueueSpeech(nk: nkruntime.Nakama, logger: nkruntime.Logger, req: ISpeakRequest): ISpeakResult;
    /**
     * Force a context reset on an agent (e.g. moderator action). Templates
     * MAY broadcast OP_AGENT_CONTEXT_RESET when they call this.
     */
    function resetContext(matchId: string, agentId: string, reason: string): boolean;
    /**
     * Per-match cleanup hook. Templates call this from their match
     * teardown path so the agent table doesn't leak across reloads.
     */
    function cleanupMatch(matchId: string): void;
    function probeProviders(): {
        [name: string]: boolean;
    };
    function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace MpKernelClock {
    interface IMatchClock {
        matchStartUnixMs: number;
        nextSeq: number;
        lastClockSyncUnixMs: number;
    }
    function init(): IMatchClock;
    function matchTimeMs(c: IMatchClock): number;
    function nextSeq(c: IMatchClock): number;
    function seqProvider(c: IMatchClock): {
        next: () => number;
    };
    var CLOCK_SKEW_LIMIT_MS: number;
    function isSkewExtreme(clientUnixMs: number): boolean;
    var CLOCK_SYNC_INTERVAL_MS: number;
    function shouldEmitClockSync(c: IMatchClock): boolean;
    function buildClockSync(c: IMatchClock, clientEchoUnixMs: number): any;
}
declare namespace MpKernelCodeRegistry {
    interface IRangeOwner {
        name: string;
        from: number;
        to: number;
        template_id?: string;
    }
    function reserve(owner: IRangeOwner): void;
    function findOwner(op: number): IRangeOwner | null;
    function listAll(): IRangeOwner[];
    function bootstrapKernelRanges(): void;
}
declare namespace MpKernelError {
    function build(code: number, detail?: string, retryAfterMs?: number, minRequiredVersion?: string): MpKernel.IError;
    function send(dispatcher: nkruntime.MatchDispatcher, target: nkruntime.Presence | null, matchId: string, senderUserId: string, seqProvider: {
        next: () => number;
    }, matchTimeMs: number, err: MpKernel.IError): void;
    function badPayload(detail: string): MpKernel.IError;
    function unknownOpcode(op: number): MpKernel.IError;
    function rateLimited(retryAfterMs: number): MpKernel.IError;
    function notAuthorized(detail: string): MpKernel.IError;
    function matchEnded(reason: string): MpKernel.IError;
    function clockSkewExtreme(skewMs: number): MpKernel.IError;
    function schemaTooOld(minRequired: string): MpKernel.IError;
    function flapping(banSeconds: number): MpKernel.IError;
    function persistenceDegraded(detail: string): MpKernel.IError;
}
declare namespace MpKernelIdempotency {
    interface IPerSenderRing {
        capacity: number;
        nowSlot: number;
        seen: {
            [uuid: string]: number;
        };
        order: string[];
    }
    var DEDUP_WINDOW_MS: number;
    var DEDUP_CAPACITY: number;
    function newRing(): IPerSenderRing;
    function admit(ring: IPerSenderRing, uuid: string, nowUnixMs: number): boolean;
    function gc(ring: IPerSenderRing, nowUnixMs: number): void;
}
declare namespace MpKernelModule {
    var TEMPLATE_IDS: {
        SYNC_TURN_V1: string;
        ASYNC_TURN_V1: string;
        REALTIME_TICK_V1: string;
        LOBBY_HANDOFF_V1: string;
        TOURNAMENT_V1: string;
        LIVE_EVENT_V1: string;
        PERSISTENT_PARTY_V1: string;
        AVATAR_REPLICATION_V1: string;
        MR_ANCHOR_V1: string;
        CONVERSATIONAL_PARTY_V1: string;
    };
    interface ICreateMatchRpcRequest {
        template_id: string;
        game_id: string;
        region?: string;
        template_init?: any;
        label?: string;
    }
    interface ICreateMatchRpcResponse {
        match_id: string;
        template_id: string;
        game_id: string;
        region: string;
        server_unix_ms: number;
    }
    function registerTemplateId(id: string): void;
    function rpcCreateMatch(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcReadMatchResult(_ctx: nkruntime.Context, _logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function rpcListTemplates(_ctx: nkruntime.Context, _logger: nkruntime.Logger, _nk: nkruntime.Nakama, _payload: string): string;
    function registerBuiltinGenerators(): void;
    function register(initializer: nkruntime.Initializer): void;
    function mount(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace MpKernelInterest {
    interface IMatchCfg {
        cellMeters: number;
        neighbourRadius: number;
        idleMs: number;
    }
    var DEFAULT_CFG: IMatchCfg;
    function configure(matchId: string, cfg: Partial<IMatchCfg>): void;
    function getConfig(matchId: string): IMatchCfg;
    /**
     * Update a user's position. Returns the user's neighbour set so
     * callers can decide to re-broadcast their join/state to new
     * neighbours.
     */
    function update(matchId: string, userId: string, x: number, y: number, z: number, nowMs?: number): string[];
    function remove(matchId: string, userId: string): void;
    function getPosition(matchId: string, userId: string): {
        x: number;
        y: number;
        z: number;
    } | null;
    /**
     * Return the user_ids whose cell is within `neighbourRadius` cells
     * of `userId`. Includes `userId` itself in the result for symmetry
     * (callers usually drop the self-id).
     */
    function subscribers(matchId: string, userId: string): string[];
    /**
     * GC stale entries (presence dropped without remove()).
     */
    function reap(matchId: string, nowMs?: number): number;
    function cleanupMatch(matchId: string): void;
    function size(matchId: string): {
        users: number;
        cells: number;
    };
    function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace MpKernelMatch {
    var SEQ_GAP_THRESHOLD: number;
    interface IKernelState<TS> {
        template_id: string;
        game_id: string;
        region: string;
        presence: MpKernelPresence.IPresenceTable;
        clock: MpKernelClock.IMatchClock;
        feature_flags: number;
        counters: {
            messages_in: number;
            messages_in_dropped_dupe: number;
            messages_in_dropped_unknown_op: number;
            messages_in_dropped_seq_gap: number;
            flap_kicks: number;
            reconnects_inside_grace: number;
        };
        template_state: TS;
        template: MpKernel.IMatchTemplate<TS>;
        last_resync_seq: number;
    }
    function broadcastKernel<P>(state: IKernelState<any>, dispatcher: nkruntime.MatchDispatcher, matchId: string, op: number, payload: P, targets: nkruntime.Presence[] | null, senderUserId?: string): void;
    function getTemplate(templateId: string): MpKernel.IMatchTemplate<any> | null;
    function matchInitImpl(templateId: string, ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: {
        [key: string]: any;
    }): {
        state: nkruntime.MatchState;
        tickRate: number;
        label: string;
    };
    function matchJoinAttemptImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presence: nkruntime.Presence, metadata: {
        [key: string]: any;
    }): {
        state: nkruntime.MatchState;
        accept: boolean;
        rejectMessage?: string;
    } | null;
    function matchJoinImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): {
        state: nkruntime.MatchState;
    } | null;
    function matchLeaveImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, presences: nkruntime.Presence[]): {
        state: nkruntime.MatchState;
    } | null;
    function matchLoopImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, messages: nkruntime.MatchMessage[]): {
        state: nkruntime.MatchState;
    } | null;
    function matchTerminateImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, graceSeconds: number): {
        state: nkruntime.MatchState;
    } | null;
    function matchSignalImpl(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: nkruntime.MatchState, data: string): {
        state: nkruntime.MatchState;
        data: string;
    } | null;
    function registerTemplate<TS>(template: MpKernel.IMatchTemplate<TS>): void;
}
declare namespace MpKernelMatchResult {
    var COLLECTION: string;
    var DEFAULT_RETENTION_DAYS: number;
    function setRetentionDays(days: number): void;
    function persist(nk: nkruntime.Nakama, logger: nkruntime.Logger, result: MpKernel.IMatchResultEnvelope): {
        ok: boolean;
        error?: string;
    };
    function read(nk: nkruntime.Nakama, matchId: string): MpKernel.IMatchResultEnvelope | null;
    function newOutcome(userId: string, isAgent: boolean): MpKernel.IPlayerOutcome;
}
declare namespace MpKernelModeration {
    var Op: {
        MOD_DECISION: number;
        MOD_WARN: number;
        MOD_MUTE: number;
        MOD_KICK: number;
        MOD_APPEAL_OPENED: number;
        MOD_APPEAL_RESOLVED: number;
    };
    var Surface: {
        UNSPECIFIED: number;
        VOICE: number;
        TEXT_CHAT: number;
        AGENT_TTS: number;
        USERNAME: number;
        AVATAR: number;
    };
    var Action: {
        UNSPECIFIED: number;
        ALLOW: number;
        WARN: number;
        REDACT: number;
        MUTE: number;
        KICK: number;
        BAN: number;
        AGENT_CORRECT: number;
    };
    var Severity: {
        UNSPECIFIED: number;
        LOW: number;
        MEDIUM: number;
        HIGH: number;
        CRITICAL: number;
    };
    interface IModerationParams {
        enable_voice_asr: boolean;
        enable_text: boolean;
        enable_agent_pre_check: boolean;
        voice_window_ms: number;
        max_warnings_before_mute: number;
        classifier_model: string;
        asr_model: string;
        strict_mode: boolean;
        locale_allowlist_csv: string;
    }
    var DEFAULTS: IModerationParams;
    function configure(p: Partial<IModerationParams>): void;
    function getParams(): IModerationParams;
    interface IClassifierResult {
        severity: number;
        categories: string[];
        detail: string;
        redacted_text?: string;
    }
    interface IClassifier {
        /** Classify a single chunk. Synchronous, KEEP IT FAST (≤5 ms). */
        classify(text: string, surface: number, locale: string): IClassifierResult;
        /** Optional descriptive name surfaced into SafetyDecision. */
        modelName(): string;
    }
    interface IActionPolicy {
        /**
         * Map a classifier verdict → action. Per-deployment override; e.g.
         * stricter for kids titles, lighter for esports spectator chat.
         */
        decide(verdict: IClassifierResult, surface: number, prevWarnings: number): {
            action: number;
            detail: string;
            appealable: boolean;
        };
    }
    var BUILTIN_CLASSIFIER: IClassifier;
    var BUILTIN_POLICY: IActionPolicy;
    function setClassifier(c: IClassifier): void;
    function setActionPolicy(p: IActionPolicy): void;
    interface IModRequest {
        match_id: string;
        user_id: string;
        is_agent: boolean;
        surface: number;
        text: string;
        locale?: string;
        region?: string;
    }
    interface IModResult {
        action: number;
        detail: string;
        severity: number;
        categories: string[];
        redacted_text: string;
        decision_id: string;
        appealable: boolean;
        classifier_model: string;
    }
    /**
     * Synchronous moderation entry point. Returns the action + safe text.
     * Templates fan-out the safe text instead of the raw text when
     * action==REDACT|WARN; for MUTE|KICK they call the corresponding
     * presence kick/mute helpers.
     */
    function moderate(nk: nkruntime.Nakama, logger: nkruntime.Logger, req: IModRequest): IModResult;
    /**
     * Convenience: classify + map only. Used by the agent service so it
     * can short-circuit "block" without writing a log entry (the wrapper
     * call in `agents.ts` will rewrite the moderation log with a richer
     * surface=AGENT_TTS payload anyway).
     */
    function quickCheck(text: string, surface: number, locale?: string): {
        action: number;
        detail: string;
        categories: string[];
    };
    /**
     * Per-match cleanup hook.
     */
    function cleanupMatch(matchId: string): void;
    function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace MpKernelPresence {
    interface ISeat {
        user_id: string;
        session_id: string;
        is_agent: boolean;
        is_host: boolean;
        joined_unix_ms: number;
        last_seen_unix_ms: number;
        disconnected_at_unix_ms: number;
        reconnect_count_in_window: number;
        reconnect_count_window_start_unix_ms: number;
        last_seq_in_from_client: number;
        last_seq_out_to_client: number;
        idem_ring: MpKernelIdempotency.IPerSenderRing;
        display_name?: string;
        presence_metadata?: any;
    }
    interface IPresenceTable {
        seats: {
            [user_id: string]: ISeat;
        };
        reconnect_grace_ms: number;
        flap_threshold: number;
        flap_window_ms: number;
        flap_ban_seconds: number;
    }
    var DEFAULT_GRACE_MS: number;
    var DEFAULT_FLAP_LIMIT: number;
    var DEFAULT_FLAP_WINDOW: number;
    var DEFAULT_FLAP_BAN_SEC: number;
    function init(graceMs: number): IPresenceTable;
    function recordJoin(table: IPresenceTable, p: nkruntime.Presence, nowUnixMs: number): {
        seat: ISeat;
        flapped: boolean;
        resumed: boolean;
    };
    function recordLeave(table: IPresenceTable, p: nkruntime.Presence, nowUnixMs: number): ISeat | null;
    function evictExpired(table: IPresenceTable, nowUnixMs: number): ISeat[];
    function activeCount(table: IPresenceTable): number;
    function totalCount(table: IPresenceTable): number;
    function reconnectGraceRemainingMs(seat: ISeat, table: IPresenceTable, nowUnixMs: number): number;
}
declare namespace MpKernelSpatial {
    var Kind: {
        UNSPECIFIED: number;
        KERNEL_WORLD: number;
        CLOUD_ANCHOR: number;
        QR_MARKER: number;
        IMAGE_MARKER: number;
        LOCAL_FLOOR: number;
        PCVR_PSEUDO: number;
    };
    var FALLBACK_CHAIN: number[];
    interface IFrame {
        frame_id: string;
        kind: number;
        provider: string;
        vendor_token: string;
        payload?: string;
        issued_ms: number;
        region: string;
        floor_height_m: number;
        forward_yaw_deg: number;
        relocalize_grace_ms: number;
    }
    interface ICapability {
        supported_frames: number[];
        can_publish_anchor: boolean;
        can_resolve_cloud_anchor: boolean;
        can_print_qr: boolean;
        can_print_image_marker: boolean;
        handedness: string;
        up_axis: string;
        forward_axis: string;
    }
    interface IRoomCapability {
        common_frames: {
            [k: number]: number;
        };
        member_count: number;
    }
    interface IFrameState {
        current: IFrame;
        pending?: IFrame;
        pending_offered_by_user_id?: string;
        pending_started_ms?: number;
        pending_grace_ms?: number;
        acks: {
            [user_id: string]: {
                ok: boolean;
                detail: string;
            };
        };
        capabilities: {
            [user_id: string]: ICapability;
        };
    }
    function buildKernelWorld(matchId: string, region: string): IFrame;
    function buildPcvrPseudo(matchId: string, region: string, floor_m: number, yaw_deg: number): IFrame;
    function negotiateInitialKind(requested: number, capabilities: ICapability[]): number;
    function startOffer(state: IFrameState, offeredBy: string, frame: IFrame, graceMs: number): void;
    function recordAck(state: IFrameState, userId: string, ok: boolean, detail: string): void;
    function offerStatus(state: IFrameState, nowMs: number, minAcks: number): {
        ready: boolean;
        expired: boolean;
        ok_count: number;
        fail_count: number;
    };
    function commitPending(state: IFrameState): IFrame | null;
    function abortPending(state: IFrameState): void;
    function isFrameAcceptable(state: IFrameState, frameId: string, nowMs: number): boolean;
}
declare namespace MpKernel {
    var OP_RANGE: {
        KERNEL: {
            from: number;
            to: number;
        };
        SOCIAL: {
            from: number;
            to: number;
        };
        AGENTS: {
            from: number;
            to: number;
        };
        MODERATION: {
            from: number;
            to: number;
        };
        SYNC_TURN: {
            from: number;
            to: number;
        };
        ASYNC_TURN: {
            from: number;
            to: number;
        };
        REALTIME_TICK: {
            from: number;
            to: number;
        };
        LOBBY_HANDOFF: {
            from: number;
            to: number;
        };
        TOURNAMENT: {
            from: number;
            to: number;
        };
        LIVE_EVENT: {
            from: number;
            to: number;
        };
        PERSISTENT_PARTY: {
            from: number;
            to: number;
        };
        MR_ANCHOR: {
            from: number;
            to: number;
        };
        GAME_DEFINED: {
            from: number;
            to: number;
        };
        XR_POSE: {
            from: number;
            to: number;
        };
    };
    var KernelOp: {
        CLIENT_HELLO: number;
        SERVER_HELLO: number;
        HEARTBEAT: number;
        PLAYER_JOINED: number;
        PLAYER_LEFT: number;
        PLAYER_KICKED: number;
        MATCH_ENDED: number;
        ERROR: number;
        MATCH_RESUME: number;
        MATCH_RESUME_ACK: number;
        LATENCY_WARNING: number;
        TICK_RATE_CHANGED: number;
        VOICE_CAPABILITY_CHANGED: number;
        VOICE_UNAVAILABLE: number;
        VOICE_MODE_CHANGED: number;
        LOW_BANDWIDTH_REQUEST: number;
        NETWORK_CLOCK_PING: number;
        NETWORK_CLOCK_PONG: number;
        WARN_RATE_LIMITED: number;
        WARN_TICK_OVERRUN: number;
        WARN_MATCH_STATE_LARGE: number;
        WARN_AVATAR_FALLBACK: number;
        WARN_DEPRECATED_CLIENT: number;
        WARN_STATE_REBUILT: number;
        CLOCK_SYNC: number;
        LEAVE: number;
        WELCOME: number;
        STATE_RESYNC: number;
        WARN: number;
    };
    var LeaveReason: {
        UNSPECIFIED: number;
        VOLUNTARY: number;
        DISCONNECT: number;
        KICK: number;
        BAN: number;
        TIMEOUT: number;
        FLAPPING: number;
        MATCH_ENDED: number;
    };
    var EndReason: {
        UNSPECIFIED: number;
        COMPLETED: number;
        TIMEOUT: number;
        QUORUM_LOST: number;
        HOST_DISBAND: number;
        KICKED_ALL: number;
        DURATION_EXCEEDED: number;
        KERNEL_INTERNAL: number;
        CANCELLED: number;
    };
    var ErrorCode: {
        UNSPECIFIED: number;
        SCHEMA_TOO_OLD: number;
        SERVER_TOO_OLD: number;
        BAD_PAYLOAD: number;
        SEQ_GAP: number;
        UNKNOWN_OPCODE: number;
        DUPLICATE_OPCODE: number;
        CLOCK_SKEW_EXTREME: number;
        MATCH_STATE_LARGE: number;
        MATCH_FULL: number;
        MATCH_NOT_FOUND: number;
        NOT_A_MEMBER: number;
        RATE_LIMITED: number;
        FLAPPING: number;
        MATCH_ENDED: number;
        SESSION_REPLACED: number;
        PERMISSION_DENIED: number;
        KICKED: number;
        BANNED: number;
        NOT_AUTHORIZED: number;
        BAD_PERSONA: number;
        BUDGET_EXCEEDED: number;
        AGENT_PROVIDER_DOWN: number;
        ANCHOR_INCOMPAT: number;
        ANCHOR_LOST: number;
        VOICE_UNAVAILABLE: number;
        VOICE_PERMISSION_DENIED: number;
        MODERATED: number;
        TIMEOUT: number;
        QUORUM_LOST: number;
        DURATION_EXCEEDED: number;
        STATE_OVERFLOW: number;
        CAPABILITY_UNSUPPORTED: number;
        OVERLOAD: number;
        PERSISTENCE_DEGRADED: number;
        TICK_OVERRUN_DEGRADED: number;
        PROVIDER_UNAVAILABLE: number;
        INTERNAL: number;
    };
    var WarningCode: {
        UNSPECIFIED: number;
        RATE_LIMITED: number;
        TICK_OVERRUN: number;
        MATCH_STATE_LARGE: number;
        AVATAR_FALLBACK: number;
        DEPRECATED_CLIENT: number;
        STATE_REBUILT: number;
        LOW_BANDWIDTH: number;
        AGENT_DEGRADED: number;
        CLOCK_REALIGN: number;
    };
    interface IHeader {
        wire_version: number;
        op: number;
        seq: number;
        match_time_ms: number;
        sender_user_id: string;
        match_id: string;
        client_opcode_uuid: string;
        quantization_profile?: number;
        delta_base_seq?: number;
        feature_flags?: number;
        trace_parent?: string;
    }
    interface IEnvelope<P> {
        h: IHeader;
        p: P;
    }
    interface IError {
        code: number;
        detail?: string;
        retry_after_ms?: number;
        min_required_version?: string;
    }
    interface IMatchInitArgs {
        template_id: string;
        game_id: string;
        region?: string;
        template_init: any;
        creator_user_id?: string;
        flags?: {
            [k: string]: string;
        };
    }
    interface IMatchTemplate<TState> {
        templateId: string;
        opRange: {
            from: number;
            to: number;
        };
        defaultInit: any;
        initState(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, params: IMatchInitArgs): {
            state: TState;
            tickRate: number;
            label: string;
        };
        onJoinAttempt(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: TState, presence: nkruntime.Presence, metadata: {
            [k: string]: string;
        }): {
            state: TState;
            accept: boolean;
            rejectMessage?: string;
        };
        onJoin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: TState, presences: nkruntime.Presence[]): {
            state: TState;
        };
        onLeave(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: TState, presences: nkruntime.Presence[]): {
            state: TState;
        };
        onLoop(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: TState, messages: nkruntime.MatchMessage[]): {
            state: TState;
        } | null;
        onTerminate(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, dispatcher: nkruntime.MatchDispatcher, tick: number, state: TState, graceSeconds: number): {
            state: TState;
        };
        buildResult?(state: TState, reason: string): MpKernel.IMatchResultEnvelope | null;
    }
    interface IPlayerOutcome {
        user_id: string;
        is_agent: boolean;
        placement: number;
        score: number;
        completed: boolean;
        left_early: boolean;
        game_payload?: any;
    }
    interface IMatchResultEnvelope {
        match_id: string;
        template_id: string;
        game_id: string;
        started_unix_ms: number;
        ended_unix_ms: number;
        duration_ms: number;
        outcomes: IPlayerOutcome[];
        game_payload?: any;
        region?: string;
    }
}
declare namespace MpKernelVoice {
    var Provider: {
        UNSPECIFIED: number;
        LIVEKIT: number;
        AGORA: number;
        TWILIO: number;
        DOLBY: number;
        NONE: number;
    };
    var Mode: {
        OFF: number;
        BROADCAST: number;
        SPATIAL: number;
        PTT: number;
    };
    var Codec: {
        UNSPECIFIED: number;
        OPUS: number;
        AAC: number;
    };
    var DEFAULT_TOKEN_TTL_MS: number;
    var DEFAULT_FLOOR_SECONDS: number;
    var DEFAULT_MAX_PUBLISHERS: number;
    var DEFAULT_VAD_BROADCAST_HZ: number;
    interface ISessionToken {
        provider: number;
        token: string;
        room_id: string;
        identity: string;
        url: string;
        expires_at_ms: number;
        can_publish: boolean;
        can_subscribe: boolean;
        spatial: boolean;
        region: string;
        provider_opts?: {
            [k: string]: string;
        };
    }
    interface ICapability {
        can_publish: boolean;
        can_subscribe: boolean;
        can_spatial: boolean;
        codecs: number[];
        max_publishers: number;
        can_change_provider: boolean;
        can_passthrough_external: boolean;
        ptt_supported: boolean;
        broadcast_supported: boolean;
        spatial_supported: boolean;
    }
    function intersectCapabilities(caps: ICapability[]): ICapability;
    function pickInitialMode(req: number, cap: ICapability): number;
    interface IFloorState {
        current_speaker_user_id: string;
        started_ms: number;
        floor_seconds: number;
        queue: {
            user_id: string;
            topic_hint: string;
            queued_ms: number;
        }[];
        queue_cap: number;
    }
    function newFloorState(queueCap: number): IFloorState;
    function requestSpeaker(state: IFloorState, userId: string, topicHint: string, floorSeconds: number, nowMs: number): {
        granted: boolean;
        queued: boolean;
        position: number;
    };
    function releaseSpeaker(state: IFloorState, userId: string, nowMs: number): {
        newSpeaker: string;
    };
    function checkFloorExpiry(state: IFloorState, nowMs: number): {
        expired: boolean;
        user: string;
    };
    interface ITokenMinter {
        name: string;
        mint(args: {
            roomId: string;
            identity: string;
            canPublish: boolean;
            canSubscribe: boolean;
            spatial: boolean;
            ttlMs: number;
            region: string;
        }): {
            token: string;
            url: string;
            opts?: {
                [k: string]: string;
            };
        };
    }
    function mintToken(minter: ITokenMinter | null, matchId: string, userId: string, canPublish: boolean, canSubscribe: boolean, spatial: boolean, region: string, nowMs: number): ISessionToken;
}
declare namespace MpKernelAsyncTurn {
    var Op: {
        TURN_START: number;
        TURN_SUBMIT: number;
        TURN_END: number;
        NOTIFY_OPPONENT: number;
        FORFEIT: number;
        RESIGN: number;
    };
    var DefaultInit: {
        game_id: string;
        move_timeout_ms: number;
        max_match_duration_ms: number;
        generator_id: string;
        starting_actor: string;
        game_label: string;
    };
    interface IAsyncTurnGenerator {
        generatorId: string;
        initState(initParams: any, persisted: any | null): {
            state: any;
            actor: string;
            ended: boolean;
            winner_user_id?: string;
        };
        applyMove(state: any, userId: string, payload: any): {
            state: any;
            actor: string;
            ended: boolean;
            winner_user_id?: string;
            broadcast_payload: any;
        } | null;
        buildResult(state: any, actors: string[], winnerUserId: string, ended: boolean): any;
    }
    function registerGenerator(g: IAsyncTurnGenerator): void;
    interface IState {
        init: any;
        game_id: string;
        actors: string[];
        online: {
            [u: string]: boolean;
        };
        current_actor: string;
        last_move_unix_ms: number;
        state: any;
        generator: IAsyncTurnGenerator | null;
        ended: boolean;
        winner_user_id: string;
        started_unix_ms: number;
        pending_end_reason: string;
        outbound_seq: number;
    }
    var template: MpKernel.IMatchTemplate<IState>;
}
declare namespace MpKernelConvParty {
    var Op: {
        SPEAKER_REQUEST: number;
        SPEAKER_GRANT: number;
        SPEAKER_REVOKE: number;
        MUTE_SELF: number;
        REACTION: number;
        TEXT_CHAT: number;
        TOPIC_SET: number;
        PIN_MESSAGE: number;
        TRANSCRIPT_CHUNK: number;
        VOICE_MODE: number;
        HAND_LOWER: number;
        ROOM_SNAPSHOT: number;
    };
    interface IRecentTranscript {
        speaker_user_id: string;
        is_agent: boolean;
        text: string;
        start_ts_ms: number;
        end_ts_ms: number;
        final: boolean;
        locale: string;
    }
    interface IRoomSettings {
        max_members: number;
        speaker_floor_seconds: number;
        speaker_queue_cap: number;
        reaction_rate_per_sec: number;
        chat_rate_per_sec: number;
        allow_text_chat: boolean;
        allow_agents: boolean;
        max_agents: number;
        moderation_enabled: boolean;
        transcript_enabled: boolean;
        default_voice_mode: string;
        anyone_can_topic: boolean;
        transcript_history: number;
        voice_room_id: string;
        voice_provider: string;
    }
    var DefaultInit: IRoomSettings;
    interface IMember {
        user_id: string;
        is_agent: boolean;
        role: "host" | "moderator" | "speaker" | "listener";
        joined_unix_ms: number;
        last_seen_unix_ms: number;
        online: boolean;
        muted_self: boolean;
        muted_by_kernel: boolean;
        hand_raised: boolean;
        voice_mode: string;
    }
    interface IRateBucket {
        bucket_unix_s: number;
        count: number;
    }
    interface ISpeakerGrant {
        user_id: string;
        granted_unix_ms: number;
        expires_unix_ms: number;
    }
    interface IState {
        init: IRoomSettings;
        members: {
            [u: string]: IMember;
        };
        presences: {
            [u: string]: {
                online: boolean;
                reaction_bucket: IRateBucket;
                chat_bucket: IRateBucket;
            };
        };
        speaker_queue: string[];
        current_grant: ISpeakerGrant | null;
        topic: string;
        pinned_messages: string[];
        transcript_history: IRecentTranscript[];
        started_unix_ms: number;
        last_idle_check_ms: number;
        last_nonzero_presence_unix_ms: number;
        creator_user_id: string;
        pending_end_reason: string;
        outbound_seq: number;
        matchId: string;
    }
    var template: MpKernel.IMatchTemplate<IState>;
}
declare namespace MpKernelLiveEvent {
    export var Op: {
        PHASE_CHANGED: number;
        REACTION: number;
        DROP_AWARDED: number;
        EVENT_PROGRESS: number;
        PARTICIPATION_LOG: number;
        EVENT_CHAT: number;
        EVENT_SIGNAL: number;
        QUEUED: number;
        TIME_TO_START: number;
    };
    export interface IPhaseDef {
        name: string;
        duration_ms: number;
        auto_advance: boolean;
    }
    export var DefaultInit: {
        event_id: string;
        shard_index: number;
        max_attendees: number;
        min_attendees_to_start: number;
        waiting_room_ms: number;
        phase_schedule: IPhaseDef[];
        reactions_per_second: number;
        chat_per_second: number;
        chat_enabled: boolean;
        drop_interval_ms: number;
        drop_payload: any;
        drop_target_strategy: string;
        drop_target_n: number;
        max_match_duration_ms: number;
        host_can_advance: boolean;
        crowd_meter_interval_ms: number;
        persist_attendance: boolean;
    };
    enum Phase {
        WAITING_ROOM = -1,
        LIVE_PHASE_0 = 0,
        DONE = 99
    }
    export interface IAttendee {
        user_id: string;
        is_agent: boolean;
        joined_unix_ms: number;
        left_unix_ms: number;
        reactions: number;
        chat_count: number;
        drops_received: number;
        participation_score: number;
        reaction_bucket_unix_s: number;
        reaction_bucket_count: number;
        chat_bucket_unix_s: number;
        chat_bucket_count: number;
    }
    export interface IState {
        init: any;
        phase_index: Phase;
        phase_started_unix_ms: number;
        waiting_room_until_unix_ms: number;
        started_unix_ms: number;
        attendees: {
            [u: string]: IAttendee;
        };
        creator_user_id: string;
        next_drop_at_unix_ms: number;
        next_crowd_meter_at_unix_ms: number;
        pending_end_reason: string;
        outbound_seq: number;
        peak_attendance: number;
        reaction_total: number;
        chat_total: number;
        drops_total: number;
    }
    export var template: MpKernel.IMatchTemplate<IState>;
    export {};
}
declare namespace MpKernelLobbyHandoff {
    export var Op: {
        READY: number;
        FORM_UP_DONE: number;
        HANDOFF_INFO: number;
        DISBAND: number;
    };
    export var DefaultInit: {
        target_template_id: string;
        target_template_init: any;
        target_game_id: string;
        target_region: string;
        min_players: number;
        max_players: number;
        form_up_timeout_ms: number;
        handoff_grace_ms: number;
        webrtc_signaling_url: string;
        require_all_ready: boolean;
        max_match_duration_ms: number;
    };
    enum Phase {
        FORM_UP = 0,
        HANDOFF = 1,
        DONE = 2,
        DISBANDED = 3
    }
    export interface IPlayer {
        user_id: string;
        is_agent: boolean;
        ready: boolean;
        ready_at_unix_ms: number;
        loadout: any;
    }
    export interface IState {
        init: any;
        phase: Phase;
        players: {
            [u: string]: IPlayer;
        };
        started_unix_ms: number;
        form_up_deadline_unix_ms: number;
        handoff_at_unix_ms: number;
        target_match_id: string;
        pending_end_reason: string;
        outbound_seq: number;
    }
    export var template: MpKernel.IMatchTemplate<IState>;
    export {};
}
declare namespace MpKernelMrAnchor {
    var Op: {
        ANCHOR_OFFER: number;
        ANCHOR_RESOLVED: number;
        ANCHOR_LOST: number;
        RELOCALIZED: number;
        OBJECT_GRAB: number;
        OBJECT_GRAB_REJECTED: number;
        OBJECT_RELEASE: number;
        OBJECT_TRANSFORM: number;
        OBJECT_AUTHORITY: number;
        PARTICIPANT_STATE: number;
        HOST_REOFFER: number;
        DOWNGRADED: number;
    };
    var AnchorProvider: {
        UNSPECIFIED: number;
        META_SHARED: number;
        VISIONOS_SHARED: number;
        ARKIT_COLLAB: number;
        AZURE_SPATIAL: number;
        QR_FALLBACK: number;
        IMAGE_MARKER: number;
        PCVR_FAKE: number;
    };
    interface IAnchorOffer {
        anchor_id: string;
        provider: number;
        provider_anchor_token: string;
        fallback_qr_b64: string;
        fallback_marker_b64: string;
        room_label: string;
        ts_ms: number;
        region: string;
    }
    interface IObject {
        object_id: string;
        holder_user_id: string;
        authority_token: number;
        last_pose_mm: {
            px: number;
            py: number;
            pz: number;
            rot_packed: number;
        };
        last_pub_ms: number;
        grab_priority: number;
        grab_arrived_ms: number;
        frozen: boolean;
    }
    interface IParticipant {
        user_id: string;
        anchor_resolved: boolean;
        anchor_provider: number;
        anchor_resolve_ts_ms: number;
        anchor_attempts: number;
        anchor_failure_detail: string;
        last_position_pub_ms: number;
        downgraded: boolean;
        is_host: boolean;
    }
    interface IInit {
        max_users: number;
        anchor_resolve_timeout_ms: number;
        require_anchor_to_join: boolean;
        allow_qr_fallback: boolean;
        allow_marker_fallback: boolean;
        allow_pcvr_fake_anchor: boolean;
        grab_priority_window_ms: number;
        cell_meters: number;
        aoi_radius: number;
        transform_rate_per_user: number;
        pcvr_fake_anchor_id: string;
    }
    var DefaultInit: IInit;
    interface IState {
        init: IInit;
        started_unix_ms: number;
        host_user_id: string;
        current_offer: IAnchorOffer | null;
        participants: {
            [u: string]: IParticipant;
        };
        objects: {
            [oid: string]: IObject;
        };
        auth_token_seq: number;
        last_grab_window_ms: number;
        pending_grabs: {
            [oid: string]: Array<{
                user_id: string;
                priority: number;
                arrived_ms: number;
            }>;
        };
        transform_buckets: {
            [u: string]: {
                unix_s: number;
                count: number;
            };
        };
        creator_user_id: string;
        outbound_seq: number;
    }
    var template: MpKernel.IMatchTemplate<IState>;
}
declare namespace MpKernelPersistentParty {
    var Op: {
        PARTY_STATE: number;
        INVITE: number;
        INVITE_ACCEPT: number;
        INVITE_DECLINE: number;
        KICK: number;
        PROMOTE: number;
        DEMOTE: number;
        TRANSFER_OWNER: number;
        LEAVE_PARTY: number;
        SETTING_UPDATED: number;
        PARTY_CHAT: number;
        MEMBER_PRESENCE: number;
        READY_FOR_MATCH: number;
        MATCH_QUEUE_INFO: number;
    };
    type Role = "owner" | "officer" | "member";
    interface IMember {
        user_id: string;
        role: Role;
        joined_unix_ms: number;
        last_seen_unix_ms: number;
        online: boolean;
        ready_for_match: boolean;
    }
    interface IPartyDoc {
        party_id: string;
        name: string;
        created_unix_ms: number;
        owner_user_id: string;
        members: {
            [u: string]: IMember;
        };
        settings: {
            visibility: "private" | "friends" | "public";
            auto_kick_idle_ms: number;
            max_members: number;
            game_payload: any;
        };
        invites: {
            [u: string]: {
                invited_by: string;
                at_unix_ms: number;
                expires_unix_ms: number;
            };
        };
        pinned_chat: string[];
    }
    var DefaultInit: {
        party_id: string;
        name: string;
        visibility: string;
        max_members: number;
        auto_kick_idle_ms: number;
        chat_per_second: number;
        chat_enabled: boolean;
        invite_ttl_ms: number;
        idle_terminate_ms: number;
        storage_flush_interval_ms: number;
        max_match_duration_ms: number;
        game_payload: any;
    };
    interface IState {
        init: any;
        party: IPartyDoc;
        presences: {
            [u: string]: {
                online: boolean;
                chat_bucket_unix_s: number;
                chat_bucket_count: number;
            };
        };
        started_unix_ms: number;
        last_storage_flush_unix_ms: number;
        last_nonzero_presence_unix_ms: number;
        creator_user_id: string;
        pending_end_reason: string;
        outbound_seq: number;
    }
    var STORAGE_COLLECTION: string;
    var template: MpKernel.IMatchTemplate<IState>;
}
declare namespace MpKernelSyncTurn {
    export var Op: {
        TURN_START: number;
        TURN_INPUT_OPENED: number;
        TURN_INPUT_CLOSED: number;
        TURN_RESOLVED: number;
        SCORE_UPDATE: number;
        PLAYER_ELIMINATED: number;
        ROUND_STARTED: number;
        ROUND_ENDED: number;
        TURN_INPUT_SUBMIT: number;
        PLAYER_READY: number;
        PLAYER_FORFEIT: number;
    };
    export var DefaultInit: {
        min_players: number;
        max_players: number;
        default_input_window_ms: number;
        max_match_duration_ms: number;
        reconnect_grace_ms: number;
        game_id: string;
        agent_seat_count: number;
        generator_id: string;
    };
    export interface IGenerator {
        generatorId: string;
        initBlob(initParams: any): any;
        nextTurn(state: ITurnGenContext): {
            turn_payload: any;
            result_payload_for_correct: any;
            score_for_correct_full: number;
            score_for_wrong: number;
            score_for_no_submit: number;
            input_window_ms?: number;
            is_final_turn?: boolean;
        } | null;
        scoreSubmission(submission: any, correctPayload: any, responseMs: number, baseReward: number): number;
        buildResolvedPayload(correctPayload: any, verdicts: {
            [u: string]: number;
        }, responseMs: {
            [u: string]: number;
        }): any;
    }
    export interface ITurnGenContext {
        blob: any;
        turn_index: number;
        round_index: number;
        template_init: any;
    }
    export function registerGenerator(g: IGenerator): void;
    enum Phase {
        PRE_GAME = 0,
        TURN_INPUT_OPEN = 1,
        TURN_RESOLVING = 2,
        POST_GAME = 3
    }
    export interface IPlayerStats {
        user_id: string;
        is_agent: boolean;
        score: number;
        correct_count: number;
        wrong_count: number;
        no_submit_count: number;
        forfeited: boolean;
    }
    export interface IState {
        init: any;
        phase: Phase;
        turn_index: number;
        round_index: number;
        input_opens_at_ms: number;
        input_closes_at_ms: number;
        current_turn_payload: any;
        current_correct_payload: any;
        current_base_reward: number;
        current_wrong_penalty: number;
        current_no_submit_penalty: number;
        submissions: {
            [user_id: string]: {
                payload: any;
                response_ms: number;
                recv_match_ms: number;
            };
        };
        ready: {
            [user_id: string]: boolean;
        };
        forfeited: {
            [user_id: string]: boolean;
        };
        stats: {
            [user_id: string]: IPlayerStats;
        };
        match_started_unix_ms: number;
        match_force_end_at_unix_ms: number;
        pending_end_reason: string;
        generator: IGenerator | null;
        generator_blob: any;
        is_final_turn: boolean;
        outbound_seq: number;
    }
    export var template: MpKernel.IMatchTemplate<IState>;
    export {};
}
declare namespace MpKernelTournament {
    export var Op: {
        REGISTER: number;
        REGISTRATION_CLOSED: number;
        BRACKET_UPDATED: number;
        LEG_MATCH_INFO: number;
        LEG_MATCH_RESULT: number;
        TOURNAMENT_RESOLVED: number;
        PLAYER_FORFEIT: number;
        BYE_AWARDED: number;
    };
    export var DefaultInit: {
        tournament_id: string;
        max_players: number;
        min_players: number;
        registration_open_unix_ms: number;
        registration_close_unix_ms: number;
        leg_template_id: string;
        leg_template_init: any;
        leg_target_game_id: string;
        leg_target_region: string;
        leg_timeout_ms: number;
        inter_round_grace_ms: number;
        walkover_on_match_failure: boolean;
        bracket_mode: string;
        bracket_generator_id: string;
        max_match_duration_ms: number;
        allow_agents: boolean;
        allow_byes: boolean;
    };
    export interface IBracketGenerator {
        generatorId: string;
        initBracket(state: IState): IBracket;
        nextRoundLegs(state: IState, bracket: IBracket): ILeg[];
        onLegResolved(bracket: IBracket, leg: ILeg, winnerUserId: string, loserUserId: string): IBracket;
        isComplete(bracket: IBracket): boolean;
        championOf(bracket: IBracket): string;
    }
    export interface ILeg {
        leg_id: string;
        round_index: number;
        player_a: string;
        player_b: string;
        match_id: string;
        started_unix_ms: number;
        ended_unix_ms: number;
        winner_user_id: string;
        loser_user_id: string;
        status: "pending" | "live" | "resolved" | "walkover" | "forfeited";
        failure_reason: string;
    }
    export interface IBracket {
        rounds: ILeg[][];
        winners_path: string[][];
    }
    enum Phase {
        REGISTRATION = 0,
        SEEDING = 1,
        LIVE = 2,
        DONE = 3,
        CANCELLED = 4
    }
    export interface IRegistrant {
        user_id: string;
        is_agent: boolean;
        seed: number;
        eliminated: boolean;
        placement: number;
    }
    export interface IState {
        init: any;
        phase: Phase;
        registrants: {
            [u: string]: IRegistrant;
        };
        registration_close_unix_ms_effective: number;
        started_unix_ms: number;
        bracket: IBracket | null;
        current_round_index: number;
        current_round_started_unix_ms: number;
        bracket_generator: IBracketGenerator | null;
        pending_end_reason: string;
        outbound_seq: number;
        events: Array<{
            at_unix_ms: number;
            kind: string;
            data: any;
        }>;
    }
    export function registerGenerator(g: IBracketGenerator): void;
    export var template: MpKernel.IMatchTemplate<IState>;
    export {};
}
declare namespace MpKernelVoiceProviders {
    function activeMinter(): MpKernelVoice.ITokenMinter | null;
    function setActiveMinter(m: MpKernelVoice.ITokenMinter | null): void;
    function b64url(input: string): string;
    function hexToB64url(hex: string): string;
    function installEnv(env: {
        [k: string]: string;
    }): void;
    function rpcVoiceToken(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer, _logger: nkruntime.Logger): void;
}
declare namespace MpVoiceLiveKit {
    interface IConfig {
        apiKey: string;
        apiSecret: string;
        defaultUrl: string;
        regionalUrls: {
            [region: string]: string;
        };
    }
    function loadConfig(env: {
        [k: string]: string;
    }): IConfig;
    function urlFor(cfg: IConfig, region: string): string;
    function makeMinter(cfg: IConfig, b64url: (s: string) => string, hmacSha256: (key: string, msg: string) => string): MpKernelVoice.ITokenMinter;
}
declare namespace OnboardingAnalytics {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace BrainCoins {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace TournamentEconomy {
    const HOUSE_RAKE_PCT = 0.15;
    const BC_PER_USD_USA = 333.333;
    const PRE_ENROLL_FOUNDER_CAP = 1000;
    const FOUNDER_FIRST_WIN_MULTIPLIER = 2;
    const HOUSE_PRE_ENROLL_SUBSIDY_USD = 5000;
    const HOUSE_PRE_ENROLL_SUBSIDY_BC_PER_ENROLLEE = 5;
    const REFERRAL_TOP_1_USD = 500;
    const REFERRAL_TOP_2_3_USD = 250;
    const REFERRAL_TOP_4_10_USD = 100;
    const REFERRAL_TOP_11_100_USD = 25;
    const PUBLIC_OPEN_TIME_ISO = "2026-07-01T04:00:00Z";
    const ENTRY_BLOCK_US_STATES: string[];
    const REDEMPTION_BLOCK_US_STATES: string[];
    const TIER1_COUNTRIES: string[];
    const MIN_AGE = 18;
    const ANTICHEAT_LATENCY_FLOOR_MS = 300;
    const ANTICHEAT_DAILY_SUBMIT_CEILING = 200;
    type TournamentStatus = "DRAFT" | "PRE_ENROLL" | "OPEN" | "ACTIVE" | "SETTLING" | "SETTLED" | "ARCHIVED";
    type TournamentFormat = "classic" | "elimination" | "pick_n";
    type FormatUiVariant = "classic-pot" | "elim-survivors" | "pick-n-slip";
    const CLASSIC_POT_SPLIT_TOP_N: {
        rank: number;
        share: number;
    }[];
    interface EliminationSchedule {
        cut_times_utc: string[];
        cut_pct: number;
        survivor_split: "equal" | "weighted_by_score";
        final_survivor_bonus_bc: number;
    }
    interface PickNConfig {
        n: number;
        multipliers: {
            [grade: string]: number;
        };
        max_pick_window_hours: number;
        house_backstop_usd_per_day: number;
    }
    interface AmoeRule {
        learning_series_required_videos: number;
        free_entries_per_tournament: number;
        no_lose_refund_finish_pct?: number;
        no_lose_survive_round?: number;
        no_lose_pick_threshold?: string;
    }
    interface TournamentConfig {
        slug: string;
        name: string;
        description: string;
        topic_tag: string;
        format: TournamentFormat;
        format_ui_variant: FormatUiVariant;
        pre_enroll_start_iso: string;
        open_start_iso: string;
        end_iso: string;
        entry_fee_bc: number;
        rake_pct: number;
        pot_seed_bc: number;
        pot_split_top_n?: {
            rank: number;
            share: number;
        }[];
        elimination_schedule?: EliminationSchedule;
        pick_n_config?: PickNConfig;
        countries_allowed: string[] | "ALL";
        min_age: number;
        amoe: AmoeRule;
        hero_image_url?: string;
        sponsor?: string;
        badge_emoji?: string;
    }
    const AMOE_CLASSIC: AmoeRule;
    const AMOE_ELIMINATION: AmoeRule;
    const AMOE_PICK_N: AmoeRule;
    const LAUNCH_SLATE: TournamentConfig[];
    function getBySlug(slug: string): TournamentConfig | null;
    function listAll(): TournamentConfig[];
    function isCountryAllowed(cfg: TournamentConfig, country: string): boolean;
    function isUsStateEntryBlocked(state: string): boolean;
    function isUsStateRedemptionBlocked(state: string): boolean;
    const GEO_DISPLAY_RATES: {
        [country: string]: {
            symbol: string;
            usd_to_local: number;
        };
    };
    function bcToLocalDisplay(bc: number, country: string): {
        symbol: string;
        amount: string;
    };
}
declare namespace TournamentEconomyV2 {
    const FEATURE_FLAGS: {
        intent_quiz_onboarding: boolean;
        scarcity_counter_v1: boolean;
        push_cadence_ladder_v1: boolean;
        social_proof_ticker_v1: boolean;
        predictive_rank_nudge_v1: boolean;
        abandonment_nudge_v1: boolean;
        streak_engine_v1: boolean;
        tournament_badges_v1: boolean;
        watch_live_v1: boolean;
        wave2_slate: boolean;
        pickn_doubleup_v1: boolean;
        kpi_alerts_v1: boolean;
        welcome_pack_v1: boolean;
        daily_quest_v1: boolean;
        referral_2sided_v1: boolean;
        cohort_retention_dash_v1: boolean;
        funnel_metrics_v1: boolean;
    };
    interface KPIThreshold {
        name: string;
        floor: number;
        target: number;
        stretch: number;
        benchmark_2026: number;
        source: string;
    }
    const KPI_THRESHOLDS: KPIThreshold[];
    interface IntentQuestion {
        id: string;
        prompt: string;
        options: {
            id: string;
            label: string;
            topic_tags: string[];
        }[];
    }
    const INTENT_QUIZ: IntentQuestion[];
    const SCARCITY_REFRESH_SECONDS = 5;
    const SCARCITY_LOW_THRESHOLD = 100;
    const SCARCITY_VERY_LOW_THRESHOLD = 25;
    interface PushCadenceEntry {
        code: string;
        trigger: string;
        template: string;
        cap_per_user_per_day: number;
        cap_per_slug_total: number;
        quiet_hours_local: [number, number];
    }
    const PUSH_CADENCE_LADDER: PushCadenceEntry[];
    const PUSH_GLOBAL_CAP_PER_24H = 4;
    const PUSH_HARD_STOP_AFTER_IGNORED = 2;
    const SOCIAL_PROOF_TICKER: {
        visible_window_seconds: number;
        min_visual_refresh_ms: number;
        show_handle_redaction_below_count: number;
    };
    const PREDICTIVE_NUDGE: {
        rank_slip_threshold: number;
        sliding_window_minutes: number;
        bonus_bc_per_target_climb: number;
        max_bonus_bc_per_window: number;
        cooldown_minutes_per_user_slug: number;
    };
    const ABANDONMENT_NUDGE: {
        delay_hours: number;
        max_per_user_per_week: number;
        expire_if_tournament_closes_within_hours: number;
    };
    interface StreakReward {
        on_day: number;
        reward_bc: number;
        badge_slug?: string;
        free_pickn_entry?: boolean;
    }
    const STREAK_REWARDS: StreakReward[];
    const STREAK_GRACE_DAYS = 1;
    const STREAK_RESET_LOCAL_HOUR = 4;
    interface TournamentBadge {
        slug: string;
        name: string;
        description: string;
        award_rule: string;
    }
    const TOURNAMENT_BADGES: TournamentBadge[];
    const WATCH_LIVE: {
        spectator_lb_refresh_seconds: number;
        spectator_max_concurrent_per_pod: number;
        cta_join_next_round_after_minutes: number;
    };
    interface Wave2Tournament {
        slug: string;
        name: string;
        description: string;
        topic_tag: string;
        entry_fee_bc: number;
        pot_seed_bc: number;
        cohort_target: "25_34" | "18_24" | "35_plus";
        rationale: string;
    }
    const WAVE_2_SLATE_DRAFT: Wave2Tournament[];
    interface PickNDoubleupConfig {
        available_window_pct: [number, number];
        cost_bc: number;
        multiplier: number;
        max_per_user_per_tournament: number;
        eligible_after_picks: number;
    }
    const PICKN_DOUBLEUP_DEFAULT: PickNDoubleupConfig;
    function wave2BadgeEmoji(slug: string): string;
    function wave2ToConfig(draft: Wave2Tournament): TournamentEconomy.TournamentConfig;
    /** LAUNCH_SLATE first, then Wave-2 draft rows when wave2_slate flag is on. */
    function resolveConfigBySlug(slug: string): TournamentEconomy.TournamentConfig | null;
    function thresholdByName(name: string): KPIThreshold | null;
    function isFeatureEnabled(flag: keyof typeof FEATURE_FLAGS): boolean;
    const WELCOME_PACK: {
        bc_grant: number;
        free_pickn_entry: boolean;
        expires_after_hours: number;
        badge_slug: string;
    };
    interface DailyQuestDef {
        slug: string;
        title: string;
        description: string;
        target: number;
        metric: string;
        reward_bc: number;
    }
    const DAILY_QUESTS: DailyQuestDef[];
    const DAILY_QUEST_COMPLETION_BONUS: {
        bc: number;
        free_pickn_entry: boolean;
        badge_slug: string;
    };
    const REFERRAL_2SIDED: {
        referrer_bc: number;
        referred_bc: number;
        fire_on: string;
        cap_per_referrer_per_day: number;
        badge_slug_for_referrer_at_5: string;
    };
    const COHORT_RETENTION_WINDOWS: {
        cohort_size_days: number;
        retention_checkpoints_days: number[];
        rolling_window_days: number;
    };
    const FUNNEL_METRICS_WINDOWS_HOURS: number[];
    function nextStreakReward(currentDay: number): StreakReward | null;
    function pushTemplateForCode(code: string): PushCadenceEntry | null;
}
declare namespace WalletGuestSync {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace QuestEventBusBridge {
    function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace QuestEngine {
    interface ProcessEventResult {
        updatedCount: number;
        updatedQuests: {
            [questId: string]: any;
        };
    }
    export function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, eventType: string, value: number, metadata: {
        [k: string]: string;
    }): ProcessEventResult;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace RewardDelivery {
    export interface CatalogEntry {
        id: string;
        title: string;
        message?: string;
        assetUrl?: string;
        ctaLabel?: string;
        deliver?: {
            channel: "email" | "none";
            notificationId?: string;
        };
        icon?: string;
    }
    interface Catalog {
        rewards: {
            [rewardId: string]: CatalogEntry;
        };
    }
    export function loadCatalog(nk: nkruntime.Nakama, gameId: string): Catalog;
    export function deliveryEmail(nk: nkruntime.Nakama, userId: string): string;
    export function onQuestReward(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, questId: string, questName: string, resolved: any): void;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace QvAgent {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace Research {
    var MODULE_VERSION: string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace AnalyticsAlerts {
    interface RpcSample {
        ts: number;
        rpc: string;
        group: string;
        durMs: number;
        ok: boolean;
        err?: string;
        userId?: string;
        userIdHash?: string;
        country?: string;
        tier?: string;
        appVersion?: string;
        os?: string;
        quizMode?: string;
        quizCardType?: string;
        screen?: string;
        sessionId?: string;
        cohortDefVersion?: number;
        cohortLabel?: string;
        requestId?: string;
        tokensIn?: number;
        tokensOut?: number;
        costUsd?: number;
    }
    function init(ctx: nkruntime.Context, logger: nkruntime.Logger): void;
    function groupForRpc(rpcId: string): string;
    interface RpcSampleExt {
        userIdHash?: string;
        country?: string;
        tier?: string;
        appVersion?: string;
        os?: string;
        quizMode?: string;
        quizCardType?: string;
        screen?: string;
        sessionId?: string;
        cohortDefVersion?: number;
        cohortLabel?: string;
        requestId?: string;
        tokensIn?: number;
        tokensOut?: number;
        costUsd?: number;
    }
    function recordSample(nk: nkruntime.Nakama, logger: nkruntime.Logger, rpc: string, durMs: number, ok: boolean, err?: string, userId?: string, ext?: RpcSampleExt): void;
    function getSamplesInWindow(nk: nkruntime.Nakama, startMs: number, endMs: number, maxRecords?: number): RpcSample[];
    function cleanupOldSamples(nk: nkruntime.Nakama, logger: nkruntime.Logger): number;
    function tryAcquireSlotLock(nk: nkruntime.Nakama, slotIso: string): boolean;
    function lastClosedSlotStart(intervalMs: number, nowMs: number): number;
    function percentile(sortedAsc: number[], p: number): number;
    function latencyStats(samples: RpcSample[]): {
        count: number;
        avg: number;
        p50: number;
        p90: number;
        p99: number;
        max: number;
    };
    function postSummaryForSlot(nk: nkruntime.Nakama, logger: nkruntime.Logger, slotStartMs: number): boolean;
    function runSchedulerTick(nk: nkruntime.Nakama, logger: nkruntime.Logger): {
        posted: boolean;
        reason: string;
        slotIso?: string;
    };
    function instrumentInitializer(initializer: nkruntime.Initializer, logger: nkruntime.Logger): nkruntime.Initializer;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriDirectControl {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriAudienceEstimate {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriAudiences {
    function isInAudience(nk: nkruntime.Nakama, userId: string, audienceId: string, gameId?: string): boolean;
    function getDefinition(nk: nkruntime.Nakama, audienceId: string, gameId?: string): Satori.AudienceDefinition | null;
    function matchesWithProps(def: Satori.AudienceDefinition, userId: string, allProps: {
        [key: string]: string;
    }): boolean;
    function getExplicitIncludeIds(nk: nkruntime.Nakama, audienceId: string, gameId?: string): string[];
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriDashboard {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriDataLake {
    function exportBatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, events: any[]): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriEventBusBridge {
    function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void;
}
declare namespace SatoriEventCapture {
    function captureEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void;
    function captureEvents(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, events: Satori.CapturedEvent[]): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriEventDebugger {
    interface DebugEvent {
        userId?: string;
        identityId?: string;
        name: string;
        timestamp: number;
        metadata: {
            [key: string]: any;
        };
        date?: string;
        external?: boolean;
    }
    export function record(nk: nkruntime.Nakama, event: DebugEvent): void;
    export function recordRejection(nk: nkruntime.Nakama, name: string, reason: string, userId?: string): void;
    export function register(initializer: nkruntime.Initializer): void;
    export {};
}
declare namespace SatoriExperimentResults {
    interface AssignmentInfo {
        variantKey: string;
        assignedAtMs: number;
    }
    function collectAssignments(nk: nkruntime.Nakama, experimentId: string, gameId?: string): {
        byUser: {
            [userId: string]: AssignmentInfo;
        };
        truncated: boolean;
        scanned: number;
    };
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriExperiments {
    function getVariant(nk: nkruntime.Nakama, userId: string, experimentId: string, gameId?: string): Satori.ExperimentVariant | null;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriFeatureFlags {
    function getFlag(nk: nkruntime.Nakama, userId: string, flagName: string, defaultValue?: string, gameId?: string): Satori.Flag;
    function getAllFlags(nk: nkruntime.Nakama, userId: string, gameId?: string): Satori.Flag[];
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriFunnels {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriIdentities {
    function onEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, event: Satori.CapturedEvent): void;
    function getProperty(nk: nkruntime.Nakama, userId: string, key: string): string | null;
    function getAllProperties(nk: nkruntime.Nakama, userId: string): Satori.IdentityProperties;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriIdentityInspector {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace LegacyAnalytics {
    interface Day {
        date: string;
        dau: number;
        newUsers: number;
        uniqueUsers: string[];
        events: number;
        sessions: number;
        sessionSeconds: number;
        revenue: number;
        purchases: number;
        byName: {
            [name: string]: number;
        };
        byCountry: {
            [country: string]: number;
        };
        byCity: {
            [city: string]: number;
        };
        byPlatform: {
            [platform: string]: number;
        };
        byAppVersion: {
            [version: string]: number;
        };
        lastEventAt: number;
    }
    function dateStrOf(ms: number): string;
    function readDay(nk: nkruntime.Nakama, dateStr: string, gameId?: string): Day;
    function readRange(nk: nkruntime.Nakama, nowMs: number, days: number, gameId?: string): Day[];
}
declare namespace SatoriCreatorEvents {
    function register(initializer: nkruntime.Initializer): void;
    /**
     * Rank every player in an event from `event_answers` and queue a
     * `prize_fulfillments` record for each gift-card prize-tier winner — WITHOUT
     * waiting for the winner to self-claim. Used by the admin "end event" action
     * and the prize-backfill RPC so operators can fulfill ALL winners, not just
     * the ones who happened to claim.
     *
     * Safety:
     *  - Idempotent: skips any (event,user) that already has a fulfillment record
     *    (incl. ones written by the self-claim flow), so re-runs never duplicate.
     *  - XUT / Nakama-fulfilled tiers are credited here at event end via the global
     *    wallet (same storage path as wallet_update_game_wallet). An audit row is
     *    written to prize_fulfillments with source auto_winner_xut.
     *  - Records are queued as `pending`; an operator still manually approves each
     *    one before any real gift card is minted, so a mis-rank is human-reviewable.
     */
    function computeAndQueueWinners(nk: nkruntime.Nakama, logger: nkruntime.Logger, def: any, eventId: string): {
        ranked: number;
        queued: number;
        skippedExisting: number;
        xutWinners: number;
        xutCredited: number;
        tiersConfigured: boolean;
    };
}
declare namespace SatoriLiveEvents {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriWeeklyChampions {
    /** Monday (UTC) of the week containing `ms` — the weekly leaderboard reset anchor. */
    function weekKeyUtc(ms: number): string;
    function recordPlay(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, username: string, region: string, score: number): void;
    function register(initializer: nkruntime.Initializer): void;
    /**
     * Feed weekly totals / streaks / activity from the SCORE_SUBMITTED event
     * that creator_event_submit already emits — deliberately NOT wired inside
     * the Path B submit RPC so the existing gameplay flow stays untouched.
     *
     * Other modules (hiro leaderboards, legacy multi-game) also emit
     * SCORE_SUBMITTED; the satori_creator_events lookup filters those out.
     */
    function registerEventHandlers(): void;
}
declare namespace SatoriMessages {
    function deliverMessage(nk: nkruntime.Nakama, userId: string, messageDef: Satori.MessageDefinition, gameId?: string): void;
    function deliverToAudience(nk: nkruntime.Nakama, logger: nkruntime.Logger, messageDef: Satori.MessageDefinition, audienceId: string, gameId?: string): number;
    function processScheduledMessages(nk: nkruntime.Nakama, logger: nkruntime.Logger, gameId?: string): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriMetrics {
    function processEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, eventName: string, metadata: {
        [key: string]: string;
    }): void;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace SatoriReports {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriRetention {
    function register(initializer: nkruntime.Initializer): void;
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
declare namespace SatoriTimeline {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriVideoFeed {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SatoriWebhooks {
    function dispatch(nk: nkruntime.Nakama, logger: nkruntime.Logger, eventName: string, payload: any): void;
    function register(initializer: nkruntime.Initializer): void;
    function registerEventHandlers(): void;
}
declare namespace ActiveRolling {
    interface Touch {
        u: string;
        t: number;
    }
    interface Doc {
        touches: Touch[];
        updatedAt: number;
    }
    interface WindowCounts {
        active5m: number;
        active1h: number;
        active24h: number;
    }
    function touch(nk: nkruntime.Nakama, channel: "in_app" | "onboarding", userId: string, gameId?: string, tsMs?: number): void;
    function countWindows(nk: nkruntime.Nakama, channel: "in_app" | "onboarding", gameId?: string, nowMs?: number): WindowCounts;
    function mergeCounts(a: WindowCounts, b: WindowCounts): WindowCounts;
}
declare namespace AdRevenueEvent {
    /**
     * RPC: ad_revenue_record
     *
     * Records a single ILRD ad revenue event, updates daily + lifetime aggregates.
     * Called from AdsAnalyticsBridge.ReportAdRevenueToServer() on the Unity client.
     */
    function rpcRecordAdRevenue(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    /**
     * Register all RPCs in this module.
     *
     * MUST be a single-parameter (`initializer`-only) function whose body
     * contains ONLY `initializer.registerRpc(...)` calls. postbuild rewrites
     * those into `__rpc_ad_revenue_record = rpcRecordAdRevenue` and then
     * AUTO-INVOKES this register() inside the namespace IIFE on EVERY pooled
     * Goja VM (see postbuild.js §3b). A second `logger` parameter (or any
     * non-registerRpc body statement) makes postbuild treat auto-invoke as
     * unsafe and SKIP it — which is exactly what left `__rpc_ad_revenue_record`
     * undefined on every VM except the one that ran InitModule, producing
     * "JavaScript runtime function invalid." for ad_revenue_record on ~96% of
     * calls (the ones that landed on a pooled VM). Do NOT add params or logging
     * here. Init-time logging lives in main.ts instead.
     */
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace ConfigLoader {
    /** True when gameId resolves to the app that owns the legacy bare-key data
     *  (and the other unscopable legacy stores: onboarding rolling actives,
     *  satori_debugger ring). Used by read surfaces to decide whether platform
     *  legacy sources may represent this app. */
    function isLegacyBareKeyOwner(nk: nkruntime.Nakama, gameId: string | undefined): boolean;
    function loadConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T;
    function loadConfigForGame<T>(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, defaultValue: T): T;
    function loadSatoriConfig<T>(nk: nkruntime.Nakama, configKey: string, defaultValue: T): T;
    function loadSatoriConfigForGame<T>(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, defaultValue: T): T;
    function saveConfig(nk: nkruntime.Nakama, configKey: string, data: any): void;
    function saveSatoriConfig(nk: nkruntime.Nakama, configKey: string, data: any): void;
    function saveSatoriConfigForGame(nk: nkruntime.Nakama, configKey: string, gameId: string | undefined, data: any): void;
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
    const CRICKET_AUCTION_COLLECTION = "cricket_auctions";
    const CRICKET_AUCTION_EVENTS_COLLECTION = "cricket_auction_events";
    const CRICKET_DIRECTOR_COLLECTION = "cricket_director_sessions";
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
    const ANALYTICS_COLLECTION = "analytics_events";
    const ANALYTICS_ERRORS_COLLECTION = "analytics_error_events";
    const ADMIN_AUDIT_COLLECTION = "admin_audit_events";
    const PLAYER_METADATA_COLLECTION = "player_metadata";
    const PUSH_TOKENS_COLLECTION = "push_tokens";
    const QV_ONBOARDING_EVENTS_COLLECTION = "qv_onboarding_events";
    const QV_ONBOARDING_IDENTITY_COLLECTION = "qv_onboarding_identity";
    const QV_ONBOARDING_PROFILES_COLLECTION = "qv_onboarding_profiles";
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
        EVENT_CREATED: string;
        EVENT_PUBLISHED: string;
        EVENT_ENDED: string;
        EVENT_CANCELLED: string;
        QUIZ_COMPLETED: string;
        PRIZE_FULFILLMENT_REQUESTED: string;
        QUEST_STEP_COMPLETED: string;
        QUEST_COMPLETED: string;
    };
    export {};
}
declare namespace FortuneWheelAdSpin {
    /**
     * RPC: fortune_wheel_ad_spin (V2)
     *
     * Server-authoritative ad-spin: validates state, picks reward, grants atomically.
     * No tier-gating. All players: max 3 ad spins per 3-day cycle, 3hr gap.
     */
    function rpcFortuneWheelAdSpin(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    /**
     * RPC: fortune_wheel_skip_cooldown
     *
     * Server-authoritative cooldown skip: spend SKIP_COOLDOWN_COST coins to clear the
     * 3-day organic-spin cooldown so the user can spin immediately.
     *
     * Order of operations (fail-safe — never deducts coins on a failed skip):
     *   1. Auth check
     *   2. Validate the user is actually ON cooldown      → not_on_cooldown
     *   3. Validate balance >= cost                       → insufficient_coins
     *   4. Deduct coins atomically (walletUpdate)         → authoritative balance from `previous`
     *   5. Clear the organic cooldown (nextSpinTime=null) — only AFTER the debit succeeds
     *
     * Returns SkipCooldownResponse (see Unity FortuneWheelService.SkipCooldownResponse):
     *   { success, error?, errorCode?, coinsSpent, coinBalance, canSpin, nextSpinTime }
     */
    function rpcFortuneWheelSkipCooldown(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, _payload: string): string;
    /**
     * Register all RPCs in this module.
     *
     * QVBF_218 fix: this MUST take ONLY `(initializer)`. postbuild.js auto-invokes
     * single-arg register() functions at IIFE/module scope, which sets the
     * `__rpc_fortune_wheel_*` globals on EVERY pooled Goja VM. With the previous
     * `(initializer, logger)` signature postbuild skipped auto-invoke, so the
     * globals were only set on the first VM (where InitModule runs) and were
     * `undefined` on the VMs that actually serve traffic — making
     * fortune_wheel_skip_cooldown / fortune_wheel_ad_spin time out with retries.
     * Do NOT add a second parameter here.
     */
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace GeoTier {
    /**
     * Called by rewarded_ads.js to get the user's tier for cap scaling.
     * Returns the tier string (t1/t2/t3). Uses cache, never blocks on API.
     */
    function getUserTier(nk: nkruntime.Nakama, userId: string): string;
    /**
     * Returns the user's cached ISO-3166 alpha-2 country code (e.g. "US",
     * "IN") from the 30-day geo cache, or "" when there is no fresh cache
     * entry. Never blocks on the IP-API HTTP call — callers that need a
     * guaranteed resolution should invoke the `country_tier_get` RPC first
     * (which resolves + caches), then read this. Used by the "People Near
     * You" suggestion RPC to scope candidates to the same country without
     * introducing any new permission or storage surface.
     *
     * Returns "" for the "XX" fallback sentinel too, so callers can treat
     * an unknown geo as "no nearby scoping possible".
     */
    function getUserCountry(nk: nkruntime.Nakama, userId: string): string;
    /**
     * Resolve + cache the user's country in one call (cache-first, then
     * IP-API fallback). Returns the resolved alpha-2 code, or "" when even
     * the IP lookup fails (geo unknown). Unlike getUserCountry this WILL
     * perform the HTTP lookup on a cache miss, so the very first "People
     * Near You" load for a brand-new user still scopes correctly.
     */
    function resolveUserCountry(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, userId: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace JsRuntimeHealth {
    function register(initializer: nkruntime.Initializer): void;
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
declare namespace SharedRateLimit {
    interface RateLimitOpts {
        perUserPerSec?: number;
        perUserPerMin?: number;
        perIpPerMin?: number;
    }
    interface RateLimitDecision {
        allowed: boolean;
        reason?: string;
        retryAfterSec?: number;
    }
    function check(ctx: nkruntime.Context, nk: nkruntime.Nakama, rpcName: string, opts: RateLimitOpts): RateLimitDecision;
    function enforce(ctx: nkruntime.Context, nk: nkruntime.Nakama, rpcName: string, opts: RateLimitOpts): string | null;
}
declare namespace RewardEngine {
    function resolveReward(nk: nkruntime.Nakama, reward: Hiro.Reward): Hiro.ResolvedReward;
    function grantReward(nk: nkruntime.Nakama, logger: nkruntime.Logger, ctx: nkruntime.Context, userId: string, gameId: string, resolved: Hiro.ResolvedReward): void;
    interface GiftClaim {
        claimId: string;
        giftId: string;
        name: string;
        description: string;
        imageUrl: string;
        type: string;
        value: string;
        quantity: number;
        fulfillmentUrl: string;
        terms: string;
        status: "pending" | "fulfilled" | "shipped" | "delivered";
        claimedAt: number;
        fulfilledAt: number;
    }
    function getGiftClaims(nk: nkruntime.Nakama, userId: string): GiftClaim[];
    function updateGiftClaimStatus(nk: nkruntime.Nakama, userId: string, claimId: string, status: "fulfilled" | "shipped" | "delivered"): boolean;
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
    function gameId(data: any): string | undefined;
    function logRpcError(nk: nkruntime.Nakama, logger: nkruntime.Logger, rpcName: string, errorMessage: string, userId?: string, gameId?: string): void;
    function requireUserId(ctx: nkruntime.Context): string;
    /**
     * Higher-order wrapper that converts AUTH_REQUIRED errors thrown by
     * requireUserId() into a clean JSON response. Apply at the
     * `initializer.registerRpc(...)` callsite for every RPC that calls
     * requireUserId(), so anonymous callers get a proper "sign in required"
     * payload instead of a Goja stack trace + HTTP 500.
     *
     * Usage:
     *   initializer.registerRpc("tournament_enter",
     *     RpcHelpers.withCleanAuthError(rpcEnter));
     */
    function withCleanAuthError(handler: (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string): (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) => string;
    function resolveUserId(ctx: nkruntime.Context, payload?: any): string;
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
declare namespace WebAdReward {
    function rpcWebAdReward(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialAppRegistry {
    interface AppEntry {
        appId: string;
        appUuid: string;
        status: string;
        features: {
            [k: string]: boolean;
        };
        limits: {
            [k: string]: number;
        };
        branding: {
            [k: string]: string;
        };
        [k: string]: any;
    }
    /**
     * Resolve an appId to its full registry entry. Storage doc wins over the
     * built-in seed field-by-field; unknown ids fall back to quizverse.
     * One storage read per call (Goja VMs are pooled — no module-level cache,
     * per AGENTS.md rule 4). Callers on hot paths should resolve once per RPC.
     */
    function resolveApp(nk: nkruntime.Nakama, rawAppId: any): AppEntry;
    /** Convenience: is a feature enabled for this app? Missing key = seed default. */
    function featureEnabled(nk: nkruntime.Nakama, appId: any, feature: string): boolean;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace DuoQuests {
    function creditQuizCompletion(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string): void;
    function weeklyPairingTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialEngagementExtras {
    function creditGroupStreaks(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace FanoutQueue {
    interface FanoutItem {
        targetUserId: string;
        eventType: string;
        titleKey: string;
        bodyKey: string;
        vars?: any;
        data?: any;
        inAppSubject?: string;
        inAppContent?: any;
        inAppCode?: number;
    }
    function enqueue(nk: nkruntime.Nakama, logger: nkruntime.Logger, items: FanoutItem[]): number;
    function drain(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, maxRows?: number): any;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialFriendsFeed {
    function writeEvent(nk: nkruntime.Nakama, logger: nkruntime.Logger, authorId: string, authorName: string, gameId: string, eventType: string, eventData: any, cta?: {
        type: string;
        label: string;
        payload: any;
    }): void;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialGroupLimits {
    const MAX_JOINED_GROUPS = 10;
    function registerHooks(initializer: nkruntime.Initializer): void;
}
declare namespace SocialGroupLinks {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialGroupSearch {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialLeagues {
    /** Weekly rollover — promotions/demotions for LAST week's pools. */
    function weeklyLeagueTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialMaintenance {
    function register(initializer: nkruntime.Initializer): void;
    function registerHooks(initializer: nkruntime.Initializer): void;
}
declare namespace SocialOnboardingState {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialPlayerStats {
    /**
     * Record one completed quiz. OCC with one retry — a lost increment under
     * pathological contention shows a friend 1 XP low on a card; acceptable.
     * Never throws.
     */
    function recordQuizCompletion(nk: nkruntime.Nakama, logger: nkruntime.Logger, userId: string, gameId: string, xpEarned: number, score: number): void;
    /**
     * Batch-load stats for many users in ONE storageRead. Returns only rows
     * from the CURRENT ISO week — a friend whose row is from last week simply
     * hasn't played this week, and their card should show zeros, not stale XP.
     */
    function loadStatsMap(nk: nkruntime.Nakama, gameId: string, userIds: string[]): {
        [id: string]: any;
    };
}
declare namespace SocialPresenceV2 {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialPressureSummary {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace SocialReports {
    function register(initializer: nkruntime.Initializer): void;
}
declare var rpcFriendsSendInvite: any;
declare var rpcFriendsAcceptInvite: any;
declare var rpcFriendsDeclineInvite: any;
declare var rpcFriendsCancelInvite: any;
declare var rpcFriendsListPendingInvites: any;
declare var rpcSendFriendChallenge: any;
declare var rpcAcceptFriendChallenge: any;
declare var rpcDeclineFriendChallenge: any;
declare var rpcCancelFriendChallenge: any;
declare var rpcListPendingFriendChallenges: any;
declare var rpcFriendsSpectate: any;
declare var rpcFriendStreakGetState: any;
declare var rpcFriendStreakRecordContribution: any;
declare var rpcFriendStreakSendNudge: any;
declare var rpcFriendStreakGetBrokenLog: any;
declare var rpcFriendStreakRepair: any;
declare var rpcFriendsGetOnlineCount: any;
declare var rpcFriendBattleCreate: any;
declare var rpcFriendInviteWithReward: any;
declare var rpcSendDirectMessage: any;
declare var rpcGetDirectMessageHistory: any;
declare var rpcMarkDirectMessagesRead: any;
declare namespace SocialRpcAliases {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace ScoreSigning {
    /** Mint a token. Returns "" when no secret is configured (fail-open mint). */
    function sign(ctx: nkruntime.Context, nk: nkruntime.Nakama, userId: string, score: number, refId: string): string;
    interface VerifyResult {
        valid: boolean;
        reason: string;
        score: number;
        refId: string;
    }
    /** Verify a token against the expected user + claimed score. */
    function verify(ctx: nkruntime.Context, nk: nkruntime.Nakama, token: any, expectedUserId: string, claimedScore: number): VerifyResult;
}
declare namespace TournamentAntiCheat {
    interface SubmitCheckInput {
        user_id: string;
        answers_count: number;
        duration_ms: number;
        latency_ms: number;
        correct: number;
        total: number;
        honeypot_correct?: number;
        honeypot_total?: number;
    }
    interface CheckResult {
        pass: boolean;
        reasons: string[];
    }
    function check(nk: nkruntime.Nakama, input: SubmitCheckInput): CheckResult;
}
declare namespace BracketClient {
    function createBracketShell(ctx: nkruntime.Context, nk: nkruntime.Nakama, slug: string, name: string, playerCount: number): {
        ok: boolean;
        bracket_id?: string;
        error?: string;
    };
    function seedPlayers(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string, players: {
        user_id: string;
        username: string;
        seed_score: number;
    }[]): {
        ok: boolean;
        error?: string;
    };
    function postMatchResult(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string, matchId: string, winnerUserId: string, scores: any): {
        ok: boolean;
        error?: string;
    };
    function getBracketState(ctx: nkruntime.Context, nk: nkruntime.Nakama, bracketId: string): {
        ok: boolean;
        state?: any;
        error?: string;
    };
}
declare namespace ContentFactoryClient {
    interface CatalogEntry {
        s3_url: string;
        generated_at: number;
        question_count: number;
        content_factory_task_id: string;
        tags: string[];
    }
    interface VideoCatalogEntry {
        s3_url: string;
        duration_s: number;
        generated_at: number;
        content_factory_task_id: string;
    }
    function readPackCatalog(nk: nkruntime.Nakama, slug: string, language: string, weekNum: number): CatalogEntry | null;
    function writePackCatalog(nk: nkruntime.Nakama, slug: string, language: string, weekNum: number, entry: CatalogEntry): void;
    function readVideoCatalog(nk: nkruntime.Nakama, slug: string, videoIndex: number, language: string): VideoCatalogEntry | null;
    function writeVideoCatalog(nk: nkruntime.Nakama, slug: string, videoIndex: number, language: string, entry: VideoCatalogEntry): void;
    interface EnqueuePackArgs {
        concept: string;
        exam_board: string;
        language: string;
        num_cards?: number;
        days_until_exam?: number;
        tags?: string[];
    }
    function enqueuePackGeneration(ctx: nkruntime.Context, nk: nkruntime.Nakama, args: EnqueuePackArgs): {
        ok: boolean;
        task_id?: string;
        error?: string;
    };
    interface EnqueueVideoArgs {
        concept: string;
        language: string;
        target_duration_sec?: number;
        tags?: string[];
    }
    function enqueueVideoGeneration(ctx: nkruntime.Context, nk: nkruntime.Nakama, args: EnqueueVideoArgs): {
        ok: boolean;
        task_id?: string;
        error?: string;
    };
    interface TaskStatus {
        ok: boolean;
        status?: "pending" | "running" | "completed" | "failed";
        result?: any;
        error?: string;
    }
    function getTaskStatus(ctx: nkruntime.Context, nk: nkruntime.Nakama, taskId: string): TaskStatus;
    function extractPackResultUrl(result: any): {
        s3_url: string;
        question_count: number;
    } | null;
    function extractVideoResultUrl(result: any): {
        s3_url: string;
        duration_s: number;
    } | null;
}
declare namespace TournamentCrons {
    function opportunisticTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): boolean;
    function tick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any;
    function pregenerateTick(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, maxJobs: number): any;
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace TournamentLeaderboard {
    function lbId(slug: string): string;
    function tierLbId(slug: string, tier: string): string;
    function ensureLeaderboard(nk: nkruntime.Nakama, slug: string, resetSchedule: string | null, expiry: number): void;
    function recordSubmit(nk: nkruntime.Nakama, slug: string, userId: string, username: string, score: number): void;
    function listTop(nk: nkruntime.Nakama, slug: string, limit: number, cursor: string | null): any;
    function listAroundMe(nk: nkruntime.Nakama, slug: string, userId: string, limit: number): any;
    function listFriends(nk: nkruntime.Nakama, slug: string, userId: string, limit: number): any;
    function listCountry(nk: nkruntime.Nakama, slug: string, country: string, limit: number): any;
    function tierForBalance(lifetimeEarned: number): string;
    function listTierLeague(nk: nkruntime.Nakama, slug: string, tier: string, limit: number): any;
    function recordTierSubmit(nk: nkruntime.Nakama, slug: string, tier: string, userId: string, username: string, score: number): void;
}
declare namespace LearningSeries {
    interface VideoCheck {
        video_index: number;
        correct: number;
        total: number;
        completed_at: number;
        passed: boolean;
    }
    interface ProgressRow {
        topic_tag: string;
        user_id: string;
        checks: VideoCheck[];
        last_updated: number;
        amoe_unlocked: boolean;
    }
    function read(nk: nkruntime.Nakama, userId: string, topicTag: string): ProgressRow | null;
    function recordVideoCheck(nk: nkruntime.Nakama, userId: string, topicTag: string, videoIndex: number, correct: number, total: number): ProgressRow;
    function getProgress(nk: nkruntime.Nakama, userId: string, topicTag: string): ProgressRow;
    function hasUnlockedAmoe(nk: nkruntime.Nakama, userId: string, topicTag: string, requiredVideos: number): boolean;
}
declare namespace TournamentRealtime {
    const CODE_POT_UPDATE = 1001;
    const CODE_LB_UPDATE = 1002;
    const CODE_ELIMINATED = 1003;
    const CODE_SETTLED = 1004;
    const CODE_PREENROLL_SCARCITY = 1005;
    function sendToUsers(nk: nkruntime.Nakama, userIds: string[], code: number, subject: string, content: any, persistent: boolean): void;
    function sendToUser(nk: nkruntime.Nakama, userId: string, code: number, subject: string, content: any, persistent: boolean): void;
    function notifyPotUpdate(nk: nkruntime.Nakama, tournamentSlug: string, newPotBc: number, recentDelta: number, _subscribers?: string[], scorer?: {
        userId: string;
        score?: number;
    }): void;
    function notifyEliminated(nk: nkruntime.Nakama, userId: string, tournamentSlug: string, round: number, finalRank: number): void;
    function notifySettled(nk: nkruntime.Nakama, userId: string, tournamentSlug: string, payoutBc: number, finalRank: number, certId: string | null): void;
    function notifyPreEnrollScarcity(nk: nkruntime.Nakama, tournamentSlug: string, founderSpotsLeft: number, _subscribers?: string[]): void;
    function notifyScoreTick(nk: nkruntime.Nakama, tournamentSlug: string, scorerUserId: string, newTotalScore: number): void;
    function notifyEntered(nk: nkruntime.Nakama, tournamentSlug: string, enteredUserId: string, newPotBc: number, newEntriesCount: number): void;
    function notifyLeaderboardTick(nk: nkruntime.Nakama, tournamentSlug: string, topRows: any[]): void;
}
declare namespace Referrals {
    const LEADERBOARD_ID = "preenroll_referrals";
    function ensureCodeForUser(nk: nkruntime.Nakama, userId: string): string;
    function resolveCodeToOwner(nk: nkruntime.Nakama, code: string): string | null;
    function recordReferral(nk: nkruntime.Nakama, referralCode: string, referredUserId: string, tournamentSlug: string): void;
    function getMySummary(nk: nkruntime.Nakama, userId: string): any;
    function settleTopN(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): any;
}
declare namespace TournamentRpcs {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace TournamentSettlement {
    function settle(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, slug: string): any;
    function eliminateRound(_ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, slug: string, round: number): any;
}
declare namespace TournamentsStorage {
    const COL_META = "tournaments_meta";
    const COL_ENTRY = "tournament_entries";
    const COL_SUBMIT = "tournament_submits";
    const COL_PRE_ENROLL = "tournament_pre_enroll";
    const COL_POT = "tournament_pot";
    const COL_CERTS = "tournament_certs";
    const COL_PICKS = "tournament_picks";
    const COL_ELIMINATIONS = "tournament_eliminations";
    const COL_SUBSCRIBERS = "tournament_subscribers";
    const SUBSCRIBER_TTL_SEC: number;
    interface MetaRow {
        slug: string;
        status: TournamentEconomy.TournamentStatus;
        pot_bc: number;
        entries_count: number;
        pre_enroll_count: number;
        config_snapshot: any;
        updated_at: number;
    }
    function readMeta(nk: nkruntime.Nakama, slug: string): MetaRow | null;
    function writeMeta(nk: nkruntime.Nakama, slug: string, meta: MetaRow): void;
    function listAllMeta(nk: nkruntime.Nakama): MetaRow[];
    function seedFromConfig(nk: nkruntime.Nakama, cfg: TournamentEconomy.TournamentConfig): MetaRow;
    interface EntryRow {
        entry_id: string;
        tournament_slug: string;
        user_id: string;
        paid_via: "balance" | "amoe" | "free_founder";
        bc_charged: number;
        founder_member: boolean;
        enrolled_at: number;
        eliminated_at?: number;
        eliminated_round?: number;
        score: number;
        rank?: number;
        claimed_cert?: boolean;
        cert_id?: string;
    }
    function readEntry(nk: nkruntime.Nakama, slug: string, userId: string): EntryRow | null;
    function writeEntry(nk: nkruntime.Nakama, slug: string, userId: string, entry: EntryRow): void;
    interface PublicEntrySummary {
        user_id: string;
        score: number;
        eliminated_at?: number;
        eliminated_round?: number;
        founder_member: boolean;
    }
    interface SubmitRow {
        idempotency_key: string;
        tournament_slug: string;
        pack_id: string;
        user_id: string;
        answers_count: number;
        score: number;
        correct: number;
        total: number;
        latency_ms: number;
        duration_ms: number;
        submitted_at: number;
        status: "counted" | "soft_dq" | "throttled";
        soft_dq_reasons?: string[];
    }
    function readSubmitIdem(nk: nkruntime.Nakama, userId: string, idempotencyKey: string): SubmitRow | null;
    function writeSubmit(nk: nkruntime.Nakama, userId: string, idempotencyKey: string, row: SubmitRow): void;
    interface PreEnrollRow {
        tournament_slug: string;
        user_id: string;
        enrolled_at: number;
        founder_rank?: number;
        referred_by?: string;
    }
    function readPreEnroll(nk: nkruntime.Nakama, slug: string, userId: string): PreEnrollRow | null;
    function writePreEnroll(nk: nkruntime.Nakama, slug: string, userId: string, row: PreEnrollRow): void;
    function incrementPot(nk: nkruntime.Nakama, slug: string, deltaBc: number): number;
    function incrementPreEnrollCount(nk: nkruntime.Nakama, slug: string): number;
    function addSubscriber(nk: nkruntime.Nakama, slug: string, userId: string): void;
    function listSubscribers(nk: nkruntime.Nakama, slug: string): string[];
}
declare namespace TournamentTopicCatalog {
    interface TopicEntry {
        tag: string;
        exam_board: string;
        concept: string;
        learning_series_prompts: string[];
        rotation?: string[];
        languages_supported: string[];
    }
    function getEntry(tag: string): TopicEntry | null;
    function getRotatedTag(baseTag: string, weekNum: number): string;
    function listAllTags(): string[];
}
declare namespace TournamentLevers {
    const COL_INTENT_QUIZ = "tournament_intent_quiz";
    const COL_STREAKS = "tournament_streaks";
    const COL_DETAIL_VIEWS = "tournament_detail_views";
    const COL_DOUBLEUP = "tournament_doubleup";
    const COL_PREDICTIVE_STATE = "tournament_predictive_state";
    const COL_SPECTATORS = "tournament_spectators";
    const COL_LEVER_ANALYTICS = "tournament_lever_analytics";
    const COL_WELCOME_PACK = "tournament_welcome_pack";
    const COL_DAILY_QUESTS = "tournament_daily_quests";
    const COL_REFERRAL_2SIDED = "tournament_referral_2sided";
    const COL_FUNNEL_COUNTERS = "tournament_funnel_counters";
    interface LeverEvent {
        event: string;
        user_id: string | null;
        properties: {
            [k: string]: any;
        };
        ts: number;
    }
    function logEvent(nk: nkruntime.Nakama, event: string, userId: string | null, properties: any): void;
    interface IntentAnswers {
        favorite_topic: string;
        time_budget: string;
        prize_comfort: string;
        answered_at: number;
        recommended_slug: string;
    }
    function recommendSlug(answers: {
        favorite_topic: string;
        time_budget: string;
        prize_comfort: string;
    }): string;
    function readIntent(nk: nkruntime.Nakama, userId: string): IntentAnswers | null;
    function writeIntent(nk: nkruntime.Nakama, userId: string, answers: IntentAnswers): void;
    interface StreakRow {
        current_days: number;
        last_calendar_day: string;
        grace_days_used: number;
        history: string[];
        longest_ever: number;
    }
    function todayKey(timezoneOffsetMin: number): string;
    function recordCheckin(nk: nkruntime.Nakama, userId: string, timezoneOffsetMin: number): {
        row: StreakRow;
        reward: any | null;
        new_unlock: boolean;
    };
    interface DetailViewRow {
        slug: string;
        user_id: string;
        viewed_at: number;
        nudge_due_at: number;
        nudged: boolean;
        entered: boolean;
    }
    function recordDetailView(nk: nkruntime.Nakama, userId: string, slug: string): DetailViewRow;
    function markEntered(nk: nkruntime.Nakama, userId: string, slug: string): void;
    function processAbandonmentNudges(nk: nkruntime.Nakama, logger: nkruntime.Logger, maxBatch: number): number;
    interface DoubleupRow {
        slug: string;
        user_id: string;
        picks_made_at_lock: number;
        cost_bc: number;
        multiplier: number;
        locked_at: number;
    }
    function readDoubleup(nk: nkruntime.Nakama, userId: string, slug: string): DoubleupRow | null;
    function writeDoubleup(nk: nkruntime.Nakama, userId: string, slug: string, picksMade: number): DoubleupRow;
    function addSpectator(nk: nkruntime.Nakama, slug: string, userId: string): void;
    interface PredictiveState {
        slug: string;
        user_id: string;
        samples: {
            rank: number;
            ts: number;
        }[];
        last_nudge_at: number;
    }
    function pushRankSample(nk: nkruntime.Nakama, userId: string, slug: string, rank: number): {
        should_nudge: boolean;
        target_rank: number;
    };
    interface WelcomePackRow {
        user_id: string;
        granted_bc: number;
        free_pickn_entry_remaining: number;
        claimed_at: number;
        expires_at: number;
    }
    function readWelcomePack(nk: nkruntime.Nakama, userId: string): WelcomePackRow | null;
    function writeWelcomePack(nk: nkruntime.Nakama, userId: string, row: WelcomePackRow): void;
    interface DailyQuestRow {
        calendar_day: string;
        quests: {
            [slug: string]: {
                progress: number;
                completed: boolean;
                reward_paid: boolean;
            };
        };
        bonus_claimed: boolean;
    }
    function dailyQuestKeyFor(timezoneOffsetMin: number): string;
    function readDailyQuests(nk: nkruntime.Nakama, userId: string, timezoneOffsetMin: number): DailyQuestRow;
    function writeDailyQuests(nk: nkruntime.Nakama, userId: string, row: DailyQuestRow, timezoneOffsetMin: number): void;
    function incrementDailyQuest(nk: nkruntime.Nakama, userId: string, metric: string, by: number, timezoneOffsetMin: number): {
        row: DailyQuestRow;
        newly_completed: string[];
        bonus_unlocked: boolean;
    };
    interface Referral2SidedRow {
        referrer_user_id: string;
        referred_user_id: string;
        paid_at: number;
        referrer_bc: number;
        referred_bc: number;
    }
    function recordReferral2Sided(nk: nkruntime.Nakama, referrerUserId: string, referredUserId: string): {
        paid: boolean;
        reason: string;
        row: Referral2SidedRow | null;
    };
    function aggregateCohortRetention(nk: nkruntime.Nakama): any;
    interface FunnelCounters {
        view_list: {
            [windowH: string]: number;
        };
        enter_attempted: {
            [windowH: string]: number;
        };
        enter_success: {
            [windowH: string]: number;
        };
        preenroll: {
            [windowH: string]: number;
        };
        first_entry: {
            [windowH: string]: number;
        };
        last_reset_at: number;
    }
    function incrementFunnel(nk: nkruntime.Nakama, metric: string, windowKey: string): void;
    function readFunnelCounters(nk: nkruntime.Nakama): FunnelCounters;
}
declare namespace TournamentFormatClassic {
    interface ClassicPayoutRow {
        user_id: string;
        rank: number;
        payout_bc: number;
        is_refund: boolean;
        founder_bonus_applied: boolean;
    }
    function computePayouts(cfg: TournamentEconomy.TournamentConfig, potBc: number, rankedEntries: {
        user_id: string;
        score: number;
        founder_member: boolean;
        paid_via: string;
        bc_charged: number;
    }[]): ClassicPayoutRow[];
}
declare namespace TournamentFormatElimination {
    interface ElimPayoutRow {
        user_id: string;
        rank: number;
        payout_bc: number;
        is_refund: boolean;
        is_final_winner: boolean;
        eliminated_round?: number;
    }
    function selectEliminations(cfg: TournamentEconomy.TournamentConfig, currentSurvivors: {
        user_id: string;
        score: number;
        founder_member: boolean;
    }[]): string[];
    function computeFinalPayouts(cfg: TournamentEconomy.TournamentConfig, potBc: number, allEntries: {
        user_id: string;
        score: number;
        founder_member: boolean;
        paid_via: string;
        bc_charged: number;
        eliminated_round?: number;
    }[]): ElimPayoutRow[];
}
declare namespace TournamentFormats {
    interface UnifiedPayoutRow {
        user_id: string;
        rank: number;
        payout_bc: number;
        is_refund: boolean;
        metadata?: any;
    }
    interface SettlementResult {
        format: TournamentEconomy.TournamentFormat;
        rows: UnifiedPayoutRow[];
        pool_drained?: boolean;
        house_backstop_used_bc?: number;
    }
    function settle(cfg: TournamentEconomy.TournamentConfig, potBc: number, entries: any[]): SettlementResult;
}
declare namespace TournamentFormatPickN {
    interface PickNPayoutRow {
        user_id: string;
        rank: number;
        payout_bc: number;
        is_refund: boolean;
        grade: string;
        multiplier_applied: number;
    }
    interface PickResult {
        user_id: string;
        correct: number;
        total: number;
        bc_charged: number;
        founder_member: boolean;
        submitted_at: number;
        paid_via: string;
    }
    function computePayouts(cfg: TournamentEconomy.TournamentConfig, potBc: number, // total pool (post-rake)
    results: PickResult[]): {
        payouts: PickNPayoutRow[];
        pool_drained: boolean;
        house_backstop_used_bc: number;
    };
}
declare namespace TutorXProgress {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace TutorXStudyPlan {
    function register(initializer: nkruntime.Initializer): void;
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
    interface GiftPrize {
        id: string;
        name: string;
        description: string;
        imageUrl?: string;
        type: "physical" | "voucher" | "experience" | "digital" | "merch";
        value?: string;
        quantity?: number;
        fulfillmentUrl?: string;
        terms?: string;
    }
    interface RewardGrant {
        currencies?: CurrencyAmount;
        items?: ItemAmount;
        energies?: {
            [energyId: string]: number;
        };
        gifts?: GiftPrize[];
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
        gifts: GiftPrize[];
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
    interface LiveEventPrizeTier {
        rank: string;
        description: string;
        reward: Hiro.Reward;
    }
    interface LiveEventDefinition {
        id: string;
        name: string;
        description?: string;
        audienceId?: string;
        startAt: number;
        endAt: number;
        recurrenceCron?: string;
        recurrenceIntervalSec?: number;
        reward?: Hiro.Reward;
        prizeTiers?: LiveEventPrizeTier[];
        config?: {
            [key: string]: string;
        };
        sticky?: boolean;
        requiresJoin?: boolean;
        category?: string;
        flagOverrides?: any;
        onJoinMessageId?: string;
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
declare namespace UserModel {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace KbEnrichment {
    function register(initializer: nkruntime.Initializer): void;
}
declare namespace WowMoments {
    function register(initializer: nkruntime.Initializer): void;
}
