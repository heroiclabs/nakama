import { callRpc, type RpcOptions } from "../client";

/** QuizVerse default — matches web/analytics-dashboard/index.html QV_GAME_ID. */
export const QUIZVERSE_GAME_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";

export interface AnalyticsLiveToday {
  total?: number;
  by_name?: Record<string, number>;
  last_event_at?: number;
}

export interface AnalyticsDashboardMeta {
  generated_at?: string;
  read_path?: string;
  rollup_hits?: number;
  live_fallbacks?: number;
}

export interface AnalyticsDashboardResult {
  success?: boolean;
  error?: string;
  dau: number;
  wau: number;
  mau: number;
  wau_estimated?: boolean;
  mau_estimated?: boolean;
  dau_mau_ratio?: number;
  new_users_today?: number;
  events_today?: number;
  live_today?: AnalyticsLiveToday | null;
  _meta?: AnalyticsDashboardMeta;
}

export interface AnalyticsDashboardParams {
  days?: number;
  gameId?: string;
  game_id?: string;
}

function unwrapAnalyticsDashboard(value: unknown): AnalyticsDashboardResult {
  if (
    value &&
    typeof value === "object" &&
    "success" in value &&
    (value as { success?: boolean }).success === false &&
    "error" in value
  ) {
    throw new Error(String((value as { error?: unknown }).error ?? "analytics_dashboard failed"));
  }
  const row = value as AnalyticsDashboardResult;
  return {
    ...row,
    dau: row.dau ?? 0,
    wau: row.wau ?? 0,
    mau: row.mau ?? 0,
  };
}

/** Same RPC as https://nakama.intelli-verse-x.ai/analytics.html Overview KPIs. */
export function getAnalyticsDashboard(
  params: AnalyticsDashboardParams,
  opts: RpcOptions,
): Promise<AnalyticsDashboardResult> {
  const body: AnalyticsDashboardParams = {
    days: params.days ?? 30,
  };
  const gameId = params.gameId ?? params.game_id;
  if (gameId) {
    body.gameId = gameId;
  }
  return callRpc<AnalyticsDashboardParams, AnalyticsDashboardResult>(
    "analytics_dashboard",
    body,
    opts,
  ).then(unwrapAnalyticsDashboard);
}

export function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatAnalyticsEventTime(unixSec?: number): string {
  if (!unixSec || unixSec <= 0) return "—";
  const ms = unixSec > 1e12 ? unixSec : unixSec * 1000;
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ms).toLocaleString();
}
