import { callRpc, type RpcOptions } from "../client";

export interface RevenueCatOverview {
  mrr: number;
  revenue28d: number;
  activeSubscriptions: number;
  activeTrials: number;
}

export interface RevenueCatDailyPoint {
  date: string;
  revenue: number;
  transactions: number;
}

export interface RevenueCatAdRevenueStatus {
  status: "pending" | "live";
  message: string;
}

export interface RevenueCatDashboardResult {
  source: "revenuecat";
  currency: string;
  projectId: string;
  days: number;
  dateRange: { start: string; end: string };
  overview: RevenueCatOverview;
  daily: RevenueCatDailyPoint[];
  totals: { revenue: number; transactions: number };
  adRevenue: RevenueCatAdRevenueStatus;
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

export function fetchRevenueCatDashboard(
  opts: RpcOptions,
  days = 30,
): Promise<RevenueCatDashboardResult> {
  return callRpc<{ days: number }, RevenueCatDashboardResult>(
    "admin_revenuecat_dashboard",
    { days },
    opts,
  ).then((value) => unwrapData<RevenueCatDashboardResult>(value));
}
