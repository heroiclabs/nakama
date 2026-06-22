import { callRpc, type RpcOptions } from "../client";

export type ProductMetricsSlice =
  | "overview"
  | "funnel"
  | "retention"
  | "mode-mix"
  | "sponsors"
  | "experiments"
  | "timeseries";

export type GameMode =
  | "trivia"
  | "chess"
  | "sudoku"
  | "battle_royale"
  | "team_relay"
  | "lightning"
  | "tournament"
  | "pub_quiz"
  | "private"
  | "unknown";

export interface ModeShare {
  mode: GameMode;
  sessions: number;
  pct: number;
}

export interface OverviewSlice {
  dau: number;
  wau: number;
  mau: number;
  events_24h: number;
  players_24h: number;
  top_modes: ModeShare[];
  sponsor_imp_30d: number;
  sponsor_clicks_30d: number;
  last_event_at: string | null;
  last_rollup_at: string | null;
}

export interface FunnelStep {
  step_no: number;
  step: string;
  unique_players: number;
}

export interface RetentionCell {
  cohort_d: string;
  day_n: number;
  retained: number;
}

export interface SponsorRow {
  sponsor_deal_id: string;
  sponsor: string;
  event_slug: string | null;
  region_code: string;
  impressions: number;
  viewable_impressions: number;
  unique_viewers: number;
  clicks: number;
  total_view_ms: number;
  ctr_pct: number | null;
  viewability_pct: number | null;
}

export interface ExperimentRow {
  experiment_id: string;
  bucket: string;
  players: number;
  exposures: number;
  conversions: number;
  value: number;
  conv_rate_pct: number | null;
  lift_pct: number | null;
}

export interface TimeseriesPoint {
  d: string;
  v: number;
}

export interface TimeseriesSlice {
  dau: TimeseriesPoint[];
  wau: TimeseriesPoint[];
  mau: TimeseriesPoint[];
}

type SliceMap = {
  overview: OverviewSlice;
  funnel: FunnelStep[];
  retention: RetentionCell[];
  "mode-mix": ModeShare[];
  sponsors: SponsorRow[];
  experiments: ExperimentRow[];
  timeseries: TimeseriesSlice;
};

export interface ProductMetricsResult<S extends ProductMetricsSlice = ProductMetricsSlice> {
  slice: S;
  generated_at: string | null;
  days: number;
  data: SliceMap[S];
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

export function fetchProductMetricsSlice<S extends ProductMetricsSlice>(
  slice: S,
  opts: RpcOptions,
  params?: { days?: number },
): Promise<ProductMetricsResult<S>> {
  return callRpc<{ slice: S; days?: number }, ProductMetricsResult<S>>(
    "quizverse_product_metrics",
    { slice, days: params?.days },
    opts,
  ).then((value) => unwrapData<ProductMetricsResult<S>>(value));
}

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}
