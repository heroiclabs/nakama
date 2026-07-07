import { callRpc, callDashboardApi, type RpcOptions } from "../client";

export interface GiftCardTier {
  rank: string;
  prize: string;
  brand: string;
  value: number;
  currency: string;
  fulfillment?: string;
}

export interface GiftCardPrizes {
  region: string;
  tiers: GiftCardTier[];
  totalValue: number;
  totalCurrency: string;
}

export interface PrizeFunding {
  method: "free" | "coins" | "pool" | "stripe";
  amount?: number;
  currency?: string;
  status?: string;
}

export interface CreatorEvent {
  id: string;
  name: string;
  description?: string;
  start_time_sec?: number;
  end_time_sec?: number;
  rewards_json?: string;
  audiences?: string[];
  enabled: boolean;
  created_at?: string;
  updated_at?: string;

  source?: "quizverse_creator" | "satori_creator_events" | "live_events" | "satori";
  creator_id?: string;
  game_id?: string;
  game_mode?: "best_guess" | "speed_quiz" | "elimination";
  difficulty?: "casual" | "challenge" | "expert";
  category?: string;
  custom_topic?: string;
  participant_count?: number;
  prize_pool?: number;
  entry_fee?: number;
  gift_card_prizes?: GiftCardPrizes | null;
  prize_funding?: PrizeFunding | null;
  visibility?: "public" | "private";
  region?: string;
  timezone?: string;
  duration_minutes?: number;
  clue_count?: number;
  question_count?: number;
  promo_video_url?: string;
  deep_link_url?: string;
  status?: string;
  published_at?: string;
  ended_at?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  score: number;
  subscore?: number;
}

export interface CreatorEventStats {
  event_id: string;
  title: string;
  game_mode?: string;
  status?: string;
  total_participants: number;
  total_answers: number;
  correct_answers: number;
  completion_rate: string;
  accuracy_rate: string;
  prize_pool: number;
  gift_card_prizes?: GiftCardPrizes | null;
  leaderboard: LeaderboardEntry[];
}

export interface CreatorEventDetail extends CreatorEvent {
  storage_user_id?: string;
  storage_version?: string;
  storage_create_time?: string;
  storage_update_time?: string;
  clues?: string[];
  answer?: string;
  questions?: unknown[];
}

function unwrapData<T>(value: unknown): T {
  if (
    value &&
    typeof value === "object" &&
    "success" in value &&
    "data" in value
  ) {
    return (value as { data: T }).data;
  }
  return value as T;
}

export function listCreatorEvents(
  opts: RpcOptions,
  gameId?: string,
  status?: "active" | "upcoming" | "ended" | "all",
): Promise<{ events: CreatorEvent[]; game_id: string }> {
  return callRpc(
    "admin_creator_events_list",
    { game_id: gameId, status },
    opts,
  ).then((value) => unwrapData<{ events: CreatorEvent[]; game_id: string }>(value));
}

export function getCreatorEvent(
  eventId: string,
  opts: RpcOptions,
): Promise<{ event: CreatorEventDetail }> {
  return callRpc("admin_creator_event_get", { event_id: eventId }, opts).then(
    (value) => unwrapData<{ event: CreatorEventDetail }>(value),
  );
}

export function getCreatorEventStats(
  eventId: string,
  opts: RpcOptions,
): Promise<CreatorEventStats> {
  return callRpc(
    "admin_creator_event_stats",
    { event_id: eventId },
    opts,
  ).then((value) => unwrapData<CreatorEventStats>(value));
}

export function endCreatorEvent(
  eventId: string,
  reason: string,
  opts: RpcOptions,
): Promise<{ success: boolean; event_id: string; status: string }> {
  return callRpc(
    "admin_creator_event_end",
    { event_id: eventId, reason },
    opts,
  ).then((value) =>
    unwrapData<{ success: boolean; event_id: string; status: string }>(value),
  );
}

export type EventStatus = "active" | "upcoming" | "ended" | "all";
export type EventGameMode = "best_guess" | "speed_quiz" | "elimination";
export type EventDifficulty = "casual" | "challenge" | "expert";

/* ------------------------------------------------------------------ */
/*  Live-event prize fulfillment (gift-card voucher queue)            */
/* ------------------------------------------------------------------ */

export type FulfillmentStatus = "pending" | "fulfilled" | "failed";

export interface FulfillmentVoucher {
  provider?: string;
  orderId?: string;
  deliveredTo?: string;
  cardLast4?: string;
  codeDelivered?: boolean;
  status?: string;
  settledAt?: number;
}

export interface PrizeFulfillment {
  key: string;
  userId: string;
  eventId: string;
  eventTitle: string;
  rank: number;
  giftCard: GiftCardTier | null;
  status: FulfillmentStatus;
  region: string;
  email: string;
  source: string;
  queuedAt: number;
  settledAt: number;
  voucher: FulfillmentVoucher | null;
  error: string;
}

export interface PrizeFulfillmentsResult {
  fulfillments: PrizeFulfillment[];
  cursor: string;
}

export interface SettlePrizeFulfillmentInput {
  eventId: string;
  userId: string;
  status: "fulfilled" | "failed";
  /** Fulfilled-only voucher metadata */
  provider?: string;
  orderId?: string;
  deliveredTo?: string;
  cardLast4?: string;
  codeDelivered?: boolean;
  /** Failed-only reason */
  error?: string;
}

export function listPrizeFulfillments(
  opts: RpcOptions,
  status?: FulfillmentStatus,
  limit?: number,
  cursor?: string,
  eventId?: string,
): Promise<PrizeFulfillmentsResult> {
  return callRpc(
    "admin_prize_fulfillments_list",
    { status, limit, cursor, eventId: eventId || undefined },
    opts,
  ).then((value) => unwrapData<PrizeFulfillmentsResult>(value));
}

export function settlePrizeFulfillment(
  input: SettlePrizeFulfillmentInput,
  opts: RpcOptions,
): Promise<{ success: boolean; key: string; status: string; settledAt: number }> {
  return callRpc("admin_prize_fulfillment_settle", input, opts).then((value) =>
    unwrapData<{ success: boolean; key: string; status: string; settledAt: number }>(value),
  );
}

/** Auto-fulfillment: mint a REAL gift card, email the code, settle the record. */
export interface AutoFulfillPrizeInput {
  eventId: string;
  userId: string;
  /** Required — recipient address the voucher code/link is emailed to. */
  email: string;
  provider?: "tremendous" | "reloadly";
}

export interface AutoFulfillPrizeResult {
  ok: boolean;
  eventId?: string;
  userId?: string;
  provider?: string;
  product?: { id: string | number; name: string };
  orderId?: string;
  codeIssued?: boolean;
  emailSent?: boolean;
  deliveredTo?: string;
  settled?: boolean;
  warning?: string;
  error?: string;
}

/**
 * One-click auto fulfillment. Routes through the dashboard proxy's
 * `/prize-fulfill` endpoint, which mints a real gift card via
 * Tremendous/Reloadly, emails the code/redemption link to the winner via SES,
 * and settles the Nakama record. The provider secrets + admin key live only on
 * the proxy, never in the browser.
 */
export function autoFulfillPrize(
  input: AutoFulfillPrizeInput,
  opts: RpcOptions,
): Promise<AutoFulfillPrizeResult> {
  return callDashboardApi<AutoFulfillPrizeResult>("/prize-fulfill", input, opts);
}

export {
  fetchProductMetricsSlice,
  formatCompactNumber,
  formatPct,
  type ProductMetricsSlice,
  type ProductMetricsResult,
  type OverviewSlice,
  type FunnelStep,
  type RetentionCell,
  type SponsorRow,
  type ExperimentRow,
  type TimeseriesSlice,
  type TimeseriesPoint,
  type ModeShare,
  type GameMode,
} from "./product-metrics";

export {
  fetchGrowthSnapshot,
  formatRelative,
  formatBeehiivPublishDate,
  isRollupStale,
  type GrowthSnapshotSource,
  type GrowthSnapshotResult,
  type GscSnapshot,
  type Ga4Snapshot,
  type BeehiivSnapshot,
  type UsersSnapshot,
} from "./growth-snapshot";
