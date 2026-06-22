import { callRpc, callDashboardApi, type RpcOptions } from "../client";

export type GrowthSnapshotSource = "gsc" | "ga4" | "newsletter" | "users";

export interface GscQueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prevPosition?: number;
  positionDelta?: number;
  clicksDelta?: number;
}

export interface GscPageRow {
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  prevPosition?: number;
  positionDelta?: number;
  clicksDelta?: number;
}

export interface GscSummary {
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
  queryCount: number;
  pageCount: number;
  clicksDelta?: number;
  avgPositionDelta?: number;
  queriesImproved?: number;
  queriesDropped?: number;
}

export interface GscWeeklyPoint {
  week: string;
  clicks: number;
  impressions: number;
  avgPosition: number;
}

export interface GscSnapshot {
  queries: GscQueryRow[];
  pages: GscPageRow[];
  summary: GscSummary;
  dateRange: { start: string; end: string };
  updatedAt: string;
  weeklyTrend?: GscWeeklyPoint[];
}

export interface Ga4TopPage {
  path: string;
  pageTitle?: string;
  sessions: number;
  screenPageViews: number;
  bounceRate?: number;
  avgSessionDuration?: number;
}

export interface Ga4TopEvent {
  eventName: string;
  eventCount: number;
  eventCountDelta?: number;
}

export interface Ga4FunnelStep {
  label: string;
  users: number;
  completionRate: number;
}

export interface Ga4LibraryPage {
  path: string;
  label: string;
  type: "exam-pack" | "audiobook" | "blog" | "other";
  sessions: number;
  avgTimeOnPage?: number;
}

export interface Ga4DailyPoint {
  date: string;
  sessions: number;
  newUsers: number;
}

export interface Ga4Snapshot {
  dateRange: { start: string; end: string };
  updatedAt: string;
  summary: {
    totalSessions: number;
    totalUsers: number;
    newUsers: number;
    avgSessionDuration: number;
    bounceRate: number;
    organicSessions?: number;
    appInstallClicks?: number;
    playSessionsFromWeb?: number;
  };
  topPages: Ga4TopPage[];
  topEvents: Ga4TopEvent[];
  libraryPages: Ga4LibraryPage[];
  installFunnel: Ga4FunnelStep[];
  dailyTrend: Ga4DailyPoint[];
}

export interface BeehiivPostRow {
  id: string;
  subject: string;
  publishDate: number | string | null;
  totalRecipients: number;
  openRate: number | null;
  clickRate: number | null;
}

export interface BeehiivPublication {
  id: string | undefined;
  name: string | undefined;
  subscriberCount: number;
  totalSubscriptions: number;
  avgOpenRate: number | null;
  avgClickRate: number | null;
}

export interface BeehiivSnapshot {
  publication: BeehiivPublication;
  recentPosts: BeehiivPostRow[];
  updatedAt: string;
}

export interface UsersTrendPoint {
  date: string;
  signups: number;
  guests: number;
}

export interface UsersSnapshot {
  totalUsers: number;
  registeredUsers: number;
  guestUsers: number;
  conversionRate: number;
  signupsToday: number;
  signupsWtd: number;
  signupsMtd: number;
  signupsLast7d: number;
  signupsLast30d: number;
  guestsCreatedLast7d: number;
  registeredLast7d: number;
  conversionRate7d: number;
  byLoginType7d: Record<string, number>;
  trend30d: UsersTrendPoint[];
  updatedAt: string;
}

export interface GrowthSnapshotResult<T = unknown> {
  source: GrowthSnapshotSource;
  ok: boolean;
  snapshot: T | null;
  error: string | null;
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

export function fetchGrowthSnapshot<S extends GrowthSnapshotSource>(
  source: S,
  opts: RpcOptions,
): Promise<GrowthSnapshotResult<
  S extends "gsc"
    ? GscSnapshot
    : S extends "ga4"
      ? Ga4Snapshot
      : S extends "newsletter"
        ? BeehiivSnapshot
        : UsersSnapshot
>> {
  if (opts.auth.type === "server-key") {
    return callDashboardApi<GrowthSnapshotResult>(`/quizverse/growth`, { source }, opts).then((value) =>
      unwrapData(value),
    ) as Promise<GrowthSnapshotResult<
      S extends "gsc"
        ? GscSnapshot
        : S extends "ga4"
          ? Ga4Snapshot
          : S extends "newsletter"
            ? BeehiivSnapshot
            : UsersSnapshot
    >>;
  }
  return callRpc<{ source: S }, GrowthSnapshotResult>(
    "quizverse_growth_snapshot",
    { source },
    opts,
  ).then((value) => unwrapData(value)) as Promise<GrowthSnapshotResult<
    S extends "gsc"
      ? GscSnapshot
      : S extends "ga4"
        ? Ga4Snapshot
        : S extends "newsletter"
          ? BeehiivSnapshot
          : UsersSnapshot
  >>;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "never";
  const diff = Math.max(0, Date.now() - d);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function formatBeehiivPublishDate(value: number | string | null): string {
  if (value == null || value === "") return "—";
  let ms: number;
  if (typeof value === "number") {
    ms = value < 1e12 ? value * 1000 : value;
  } else if (/^\d+$/.test(value.trim())) {
    const n = Number(value);
    ms = n < 1e12 ? n * 1000 : n;
  } else {
    ms = Date.parse(value);
  }
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function isRollupStale(lastRollupAt: string | null | undefined, maxMinutes = 15): boolean {
  if (!lastRollupAt) return true;
  const t = new Date(lastRollupAt).getTime();
  if (Number.isNaN(t)) return true;
  return Date.now() - t > maxMinutes * 60 * 1000;
}
