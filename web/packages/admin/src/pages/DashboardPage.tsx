import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Activity,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Users,
  FlaskConical,
  CalendarClock,
  MessageSquare,
  Globe2,
  Server,
  Cpu,
  Gamepad2,
  Puzzle,
  Sparkles,
  TrendingUp,
  DollarSign,
  AlertCircle,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  serverKeyAuth,
  nakama,
  satori,
  analytics,
  callRpc,
  HIRO_SYSTEMS,
  SATORI_SYSTEMS,
  type AnalyticsDashboardResult,
  type DashboardSummary,
  type GameMetricsResult,
  type GameMetricsDay,
  type GameMetricsMonth,
  type SegmentsExploreResult,
  type SegmentBucket,
  type EventErrorsResult,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import { WorldMap } from "@/components/WorldMap";
import { countryName, flagEmoji } from "@/lib/iso-countries";
import { useAdminStore } from "@/stores/admin-store";
import {
  useDashboardLayoutStore,
  type ActiveUsersWidgetId,
  type LiveopsCardId,
  type StatusSectionId,
  type TopLocationId,
} from "@/stores/dashboard-layout-store";
import {
  DashboardLayoutToolbar,
  SortableGrid,
  SortableVerticalList,
  useStatusLayoutEditMode,
} from "@/components/dashboard/SortableDashboard";
import { ProductTelemetryPanel } from "@/components/product-telemetry/ProductTelemetryPanel";

const REFETCH_MS = 15_000;

type DashboardTab = "status" | "metrics" | "telemetry";

function parseDashboardTab(value: string | null): DashboardTab {
  if (value === "metrics") return "metrics";
  if (value === "telemetry") return "telemetry";
  return "status";
}


function isHealthyStatus(status?: string) {
  const normalized = String(status ?? "").toLowerCase();
  return normalized === "ok" || normalized === "healthy";
}

function useHealth() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => nakama.getHealthcheck(serverKeyAuth()),
    refetchInterval: REFETCH_MS,
    retry: 1,
  });
}

function useSummary(appId: string) {
  return useQuery<DashboardSummary>({
    queryKey: ["admin", "dashboard-summary", appId],
    queryFn: () => satori.getDashboardSummary(serverKeyAuth(), appId || undefined),
    refetchInterval: REFETCH_MS,
    retry: 1,
  });
}

function useGameMetrics(days: number, appId: string) {
  return useQuery<GameMetricsResult>({
    queryKey: ["admin", "game-metrics", days, appId],
    queryFn: () => satori.getGameMetrics({ days, game_id: appId || undefined }, serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useSegmentsExplore(days: number, event: string, appId: string) {
  return useQuery<SegmentsExploreResult>({
    queryKey: ["admin", "segments-explore", days, event, appId],
    queryFn: () =>
      satori.getSegmentsExplore(
        { days, event: event || undefined, game_id: appId || undefined },
        serverKeyAuth(),
      ),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useEventErrors() {
  return useQuery<EventErrorsResult>({
    queryKey: ["admin", "event-errors"],
    queryFn: () => satori.getEventErrors(serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
}

const METRICS_TAB_LINK = "/dashboard?tab=metrics";

function analyticsGameScope(appId: string): string {
  return appId || "all";
}

function useAnalyticsOverview(appId: string) {
  const gameId = analyticsGameScope(appId);
  return useQuery<AnalyticsDashboardResult>({
    queryKey: ["admin", "analytics-dashboard", gameId],
    queryFn: () =>
      analytics.getAnalyticsDashboard({ days: 30, gameId }, serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function analyticsErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object") {
      const msg = (body as { error?: string }).error;
      if (msg) return msg;
    }
  }
  return err instanceof Error ? err.message : "Failed to load analytics dashboard";
}

function useHiroStatus() {
  return useQuery({
    queryKey: ["admin", "hiro-status"],
    queryFn: async () => {
      const results: Record<string, "ok" | "error"> = {};
      const opts = serverKeyAuth();
      await Promise.allSettled(
        HIRO_SYSTEMS.map(async (sys) => {
          try {
            await callRpc("admin_config_get", { system: sys }, opts);
            results[sys] = "ok";
          } catch {
            results[sys] = "error";
          }
        }),
      );
      return results;
    },
    refetchInterval: 60_000,
    retry: 0,
  });
}

function useSatoriStatus() {
  return useQuery({
    queryKey: ["admin", "satori-status"],
    queryFn: async () => {
      const results: Record<string, "ok" | "error"> = {};
      const opts = serverKeyAuth();
      await Promise.allSettled(
        SATORI_SYSTEMS.map(async (sys) => {
          try {
            await callRpc("satori_config_get", { system: sys }, opts);
            results[sys] = "ok";
          } catch {
            results[sys] = "error";
          }
        }),
      );
      return results;
    },
    refetchInterval: 60_000,
    retry: 0,
  });
}

// ─── Small building blocks ───────────────────────────────────────────

function CountCard({
  label,
  value,
  accent,
  icon: Icon,
  to,
  loading,
}: {
  label: string;
  value: number | string;
  accent: string;
  icon: React.ElementType;
  to?: string;
  loading?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => to && navigate(to)}
      className={cn(
        "group flex h-full w-full flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all",
        to && "hover:border-primary/40 hover:shadow-md",
      )}
    >
      <div className={cn("rounded-lg p-2", accent)}>
        <Icon className="h-4 w-4" />
      </div>
      {loading ? (
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      ) : (
        <p className="text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      )}
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
    </button>
  );
}

function activeWindowsForCard(
  summary: DashboardSummary | undefined,
  window: "5m" | "1h" | "24h",
): { onboarding: number; inApp: number; total: number } {
  const split = summary?.activeUsers;
  if (split) {
    const key = window === "5m" ? "active5m" : window === "1h" ? "active1h" : "active24h";
    const onboarding = split.onboarding[key];
    const inApp = split.inApp[key];
    return {
      onboarding,
      inApp,
      total: onboarding + inApp,
    };
  }
  const fallback =
    window === "5m"
      ? summary?.activeUsers5m ?? 0
      : window === "1h"
        ? summary?.activeUsers1h ?? 0
        : summary?.activeUsers24h ?? 0;
  return { onboarding: 0, inApp: fallback, total: fallback };
}

function ActiveUsers5mCard({ summary, loading }: { summary?: DashboardSummary; loading: boolean }) {
  const w = activeWindowsForCard(summary, "5m");
  return (
    <ActiveUsersSplitCard
      title="Active users · last 5 minutes"
      onboarding={w.onboarding}
      inApp={w.inApp}
      total={w.total}
      loading={loading}
      highlight
    />
  );
}

function ActiveUsers1hCard({ summary, loading }: { summary?: DashboardSummary; loading: boolean }) {
  const w = activeWindowsForCard(summary, "1h");
  return (
    <ActiveUsersSplitCard
      title="Active users · last hour"
      onboarding={w.onboarding}
      inApp={w.inApp}
      total={w.total}
      loading={loading}
    />
  );
}

function ActiveUsers24hCard({ summary, loading }: { summary?: DashboardSummary; loading: boolean }) {
  const w = activeWindowsForCard(summary, "24h");
  return (
    <ActiveUsersSplitCard
      title="Active users · last 24h"
      onboarding={w.onboarding}
      inApp={w.inApp}
      total={w.total}
      loading={loading}
      footer={`${summary?.eventsLast24h ?? 0} game events captured today`}
    />
  );
}

function ActiveUsersSplitCard({
  title,
  onboarding,
  inApp,
  total,
  loading,
  highlight,
  footer,
}: {
  title: string;
  onboarding: number;
  inApp: number;
  total: number;
  loading: boolean;
  highlight?: boolean;
  footer?: string;
}) {
  return (
    <div
      className={cn(
        "relative h-full w-full overflow-hidden rounded-xl border bg-card p-4",
        highlight ? "border-primary/30 bg-gradient-to-br from-primary/10 to-card" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Activity className={cn("h-4 w-4", highlight && "text-primary")} />
        {title}
      </div>
      {loading ? (
        <Loader2 className={cn("mt-3 h-7 w-7 animate-spin", highlight ? "text-primary" : "text-muted-foreground")} />
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Globe2 className="h-3.5 w-3.5" />
              Onboarding web
            </span>
            <span className={cn("text-xl font-bold tabular-nums", highlight && "text-primary")}>
              {onboarding}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Gamepad2 className="h-3.5 w-3.5" />
              In-app game
            </span>
            <span className="text-xl font-bold tabular-nums">{inApp}</span>
          </div>
          <div className="border-t border-border/60 pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground/90">Total active</span>
              <span className={cn("text-2xl font-bold tabular-nums tracking-tight", highlight && "text-primary")}>
                {total}
              </span>
            </div>
          </div>
        </div>
      )}
      {footer && <p className="mt-1.5 text-xs text-muted-foreground">{footer}</p>}
      {highlight && (
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
      )}
    </div>
  );
}

function TopList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: { label: string; flag?: string; value: number }[];
  empty: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0);
  return (
    <div className="h-full w-full rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="space-y-2.5">
          {rows.map((r) => (
            <div key={r.label} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {r.flag && <span className="text-base leading-none">{r.flag}</span>}
                  <span className="font-medium">{r.label}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">{r.value}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${max > 0 ? (r.value / max) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusPill({ name, status }: { name: string; status: "ok" | "error" | "loading" }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors",
        status === "ok" && "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400",
        status === "error" && "border-destructive/30 bg-destructive/5 text-destructive",
        status === "loading" && "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {status === "ok" && <CheckCircle2 className="h-3.5 w-3.5" />}
      {status === "error" && <XCircle className="h-3.5 w-3.5" />}
      {status === "loading" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      <span className="capitalize">{name.replace(/_/g, " ")}</span>
    </div>
  );
}

// ─── Analytics freshness (Nakama pipeline) ───────────────────────────

function AnalyticsFreshnessFooter({ data }: { data?: AnalyticsDashboardResult }) {
  if (!data) return null;
  const generated = data._meta?.generated_at;
  const lastEvent = data.live_today?.last_event_at;
  return (
    <p className="text-xs text-muted-foreground">
      Nakama analytics · RPC{" "}
      <code className="rounded bg-muted px-1 py-0.5 text-[10px]">analytics_dashboard</code>
      {generated && <> · generated {new Date(generated).toLocaleString()}</>}
      {lastEvent != null && lastEvent > 0 && (
        <> · last event {analytics.formatAnalyticsEventTime(lastEvent)}</>
      )}
      {(data.wau_estimated || data.mau_estimated) && (
        <span className="ml-2 text-amber-600 dark:text-amber-400">
          · WAU/MAU may be estimated until daily rollups complete
        </span>
      )}
    </p>
  );
}

// ─── Tabs content ────────────────────────────────────────────────────

function StatusTab({
  summary,
  summaryLoading,
  analyticsOverview,
  analyticsLoading,
  analyticsError,
}: {
  summary?: DashboardSummary;
  summaryLoading: boolean;
  analyticsOverview?: AnalyticsDashboardResult;
  analyticsLoading: boolean;
  analyticsError?: string | null;
}) {
  const editMode = useStatusLayoutEditMode();
  const sectionOrder = useDashboardLayoutStore((s) => s.statusSectionOrder);
  const setSectionOrder = useDashboardLayoutStore((s) => s.setStatusSectionOrder);
  const activeUsersOrder = useDashboardLayoutStore((s) => s.activeUsersOrder);
  const crmCardsOrder = useDashboardLayoutStore((s) => s.crmCardsOrder);
  const setCrmCardsOrder = useDashboardLayoutStore((s) => s.setCrmCardsOrder);
  const liveopsCardsOrder = useDashboardLayoutStore((s) => s.liveopsCardsOrder);
  const setLiveopsCardsOrder = useDashboardLayoutStore((s) => s.setLiveopsCardsOrder);
  const topLocationsOrder = useDashboardLayoutStore((s) => s.topLocationsOrder);

  const countryRows = (summary?.topCountries ?? []).map((c) => ({
    label: countryName(c.country),
    flag: flagEmoji(c.country),
    value: c.users,
  }));
  const cityRows = (summary?.topCities ?? []).map((c) => ({
    label: c.city,
    value: c.users,
  }));

  const showAnalyticsError = Boolean(analyticsError && !analyticsLoading);

  const visibleSections = sectionOrder.filter((id) => {
    if (id === "liveops-counts") return false;
    if (id === "analytics-error") return showAnalyticsError;
    return true;
  });

  const eventsToday =
    analyticsOverview?.live_today?.total ??
    summary?.eventsToday ??
    summary?.eventsLast24h ??
    0;
  const players24h = summary?.activeUsers?.total?.active24h ?? analyticsOverview?.dau ?? 0;

  const activeUserCards: Record<ActiveUsersWidgetId, ReactNode> = {
    "active-users-5m": <ActiveUsers5mCard summary={summary} loading={summaryLoading} />,
    "active-users-1h": <ActiveUsers1hCard summary={summary} loading={summaryLoading} />,
    "active-users-24h": <ActiveUsers24hCard summary={summary} loading={summaryLoading} />,
  };

  const gameMetricsCards: Record<string, ReactNode> = {
    "game-dau": (
      <CountCard
        label="DAU · today"
        value={analyticsLoading ? "—" : analytics.formatCompactNumber(analyticsOverview?.dau ?? 0)}
        accent="bg-violet-500/10 text-violet-500"
        icon={Users}
        to={METRICS_TAB_LINK}
        loading={analyticsLoading}
      />
    ),
    "game-wau": (
      <CountCard
        label="WAU · 7d rolling"
        value={analyticsLoading ? "—" : analytics.formatCompactNumber(analyticsOverview?.wau ?? 0)}
        accent="bg-sky-500/10 text-sky-500"
        icon={TrendingUp}
        to={METRICS_TAB_LINK}
        loading={analyticsLoading}
      />
    ),
    "game-mau": (
      <CountCard
        label="MAU · 30d rolling"
        value={analyticsLoading ? "—" : analytics.formatCompactNumber(analyticsOverview?.mau ?? 0)}
        accent="bg-emerald-500/10 text-emerald-500"
        icon={Activity}
        to={METRICS_TAB_LINK}
        loading={analyticsLoading}
      />
    ),
    "game-events-today": (
      <CountCard
        label="Events · today"
        value={analyticsLoading ? "—" : analytics.formatCompactNumber(eventsToday)}
        accent="bg-amber-500/10 text-amber-500"
        icon={Activity}
        to={METRICS_TAB_LINK}
        loading={analyticsLoading}
      />
    ),
    "game-players-24h": (
      <CountCard
        label="Active players · 24h"
        value={
          analyticsLoading && summaryLoading
            ? "—"
            : analytics.formatCompactNumber(players24h)
        }
        accent="bg-cyan-500/10 text-cyan-500"
        icon={Users}
        to={METRICS_TAB_LINK}
        loading={analyticsLoading || summaryLoading}
      />
    ),
  };

  const liveopsCards: Record<LiveopsCardId, ReactNode> = {
    "exp-ongoing": (
      <CountCard
        label="Ongoing experiments"
        value={summary?.experiments.ongoing ?? 0}
        accent="bg-violet-500/10 text-violet-500"
        icon={FlaskConical}
        to="/experiments"
        loading={summaryLoading}
      />
    ),
    "live-events-ongoing": (
      <CountCard
        label="Ongoing live events"
        value={summary?.liveEvents.ongoing ?? 0}
        accent="bg-blue-500/10 text-blue-500"
        icon={CalendarClock}
        to="/events"
        loading={summaryLoading}
      />
    ),
    "exp-scheduled": (
      <CountCard
        label="Scheduled experiments"
        value={summary?.experiments.scheduled ?? 0}
        accent="bg-amber-500/10 text-amber-500"
        icon={FlaskConical}
        to="/experiments"
        loading={summaryLoading}
      />
    ),
    "live-events-scheduled": (
      <CountCard
        label="Scheduled live events"
        value={summary?.liveEvents.scheduled ?? 0}
        accent="bg-cyan-500/10 text-cyan-500"
        icon={CalendarClock}
        to="/events"
        loading={summaryLoading}
      />
    ),
    "messages-scheduled": (
      <CountCard
        label="Scheduled messages"
        value={summary?.messages.scheduled ?? 0}
        accent="bg-emerald-500/10 text-emerald-500"
        icon={MessageSquare}
        to="/messages"
        loading={summaryLoading}
      />
    ),
  };

  const topLocationPanels: Record<TopLocationId, ReactNode> = {
    "top-countries": <TopList title="Top countries" rows={countryRows} empty="No data available" />,
    "top-cities": <TopList title="Top cities" rows={cityRows} empty="No data available" />,
  };

  const sections: Record<StatusSectionId, ReactNode | null> = {
    "active-users": (
      <div className="grid gap-4 sm:grid-cols-3">
        {activeUsersOrder.map((id) => (
          <div key={id} className="min-w-0 w-full">
            {activeUserCards[id]}
          </div>
        ))}
      </div>
    ),
    "analytics-error": (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">Game metrics unavailable</p>
          <p className="mt-1 text-xs opacity-90">{analyticsError}</p>
        </div>
      </div>
    ),
    "product-telemetry": (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-violet-500" />
            <h3 className="text-sm font-semibold">Game metrics · Nakama analytics</h3>
          </div>
          <span className="text-xs text-muted-foreground">same source as analytics.html</span>
        </div>
        <SortableGrid
          contextId="status-crm-cards"
          items={crmCardsOrder}
          onReorder={setCrmCardsOrder}
          editMode={editMode}
          className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5"
          renderItem={(id) => gameMetricsCards[id]}
        />
        <SortableGrid
          contextId="status-liveops-cards"
          items={liveopsCardsOrder}
          onReorder={setLiveopsCardsOrder}
          editMode={editMode}
          className="grid gap-4 grid-cols-2 lg:grid-cols-5"
          renderItem={(id) => liveopsCards[id]}
        />
        <AnalyticsFreshnessFooter data={analyticsOverview} />
      </div>
    ),
    "liveops-counts": null,
    "world-map": (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Globe2 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Active users by location · last 24h</h3>
        </div>
        <div className="relative">
          <WorldMap data={summary?.topCountries ?? []} height={380} />
          {!summaryLoading && !summary?.geoAvailable && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg border border-border bg-background/80 px-4 py-2 text-sm text-muted-foreground backdrop-blur">
                No geographic data yet — geo is stamped on new events as they arrive.
              </div>
            </div>
          )}
        </div>
      </div>
    ),
    "top-locations": (
      <div className="grid gap-4 md:grid-cols-2">
        {topLocationsOrder.map((id) => (
          <div key={id} className="min-w-0 w-full">
            {topLocationPanels[id]}
          </div>
        ))}
      </div>
    ),
  };

  const handleSectionReorder = (nextVisible: StatusSectionId[]) => {
    const visibleSet = new Set(visibleSections);
    let visibleIndex = 0;
    const merged = sectionOrder.map((id) =>
      visibleSet.has(id) ? nextVisible[visibleIndex++]! : id,
    );
    setSectionOrder(merged);
  };

  return (
    <div className="space-y-6">
      <SortableVerticalList
        contextId="status-sections"
        items={visibleSections}
        onReorder={handleSectionReorder}
        editMode={editMode}
        className="space-y-6"
        renderItem={(id) => sections[id] ?? null}
      />
    </div>
  );
}

function dayLabel(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

const CHART_COLORS = {
  dau: "263 70% 60%",
  installs: "330 81% 60%",
  sessions: "199 89% 55%",
  revenue: "142 71% 45%",
  arpau: "38 92% 55%",
} as const;

function fmtDuration(sec: number) {
  if (!sec || sec <= 0) return "0s";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function MetricAreaCard({
  title,
  subtitle,
  icon: Icon,
  points,
  gradKey,
  colorHsl,
  money,
  duration,
  loading,
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  points: { label: string; value: number }[];
  gradKey: string;
  colorHsl: string;
  money?: boolean;
  duration?: boolean;
  loading: boolean;
}) {
  const data = points;
  const last = data.length ? data[data.length - 1].value : 0;
  const gradId = `g_${gradKey}`;
  const fmt = (v: number) => (money ? `$${v.toFixed(2)}` : duration ? fmtDuration(v) : `${v}`);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: `hsl(${colorHsl} / 0.12)`, color: `hsl(${colorHsl})` }}
          >
            <Icon className="h-4 w-4" />
          </span>
          <div>
            <h3 className="text-sm font-semibold leading-tight">{title}</h3>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <span className="text-lg font-bold tabular-nums" style={{ color: `hsl(${colorHsl})` }}>
          {money ? `$${last.toFixed(2)}` : duration ? fmtDuration(last) : last}
        </span>
      </div>
      {loading ? (
        <div className="flex h-[150px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={150}>
          <AreaChart data={data} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={`hsl(${colorHsl})`} stopOpacity={0.45} />
                <stop offset="100%" stopColor={`hsl(${colorHsl})`} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }}
              interval="preserveStartEnd"
              minTickGap={20}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }}
              allowDecimals={money}
              width={44}
              tickFormatter={(v) => (money ? `$${v}` : `${v}`)}
            />
            <Tooltip
              formatter={(v: number) => [fmt(v), title]}
              contentStyle={{
                background: "hsl(222 47% 11%)",
                border: "1px solid hsl(215 28% 17%)",
                borderRadius: 8,
                fontSize: 12,
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={`hsl(${colorHsl})`}
              strokeWidth={2}
              fill={`url(#${gradId})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function DailyMetricCard({
  series,
  dataKey,
  ...rest
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  series: GameMetricsDay[];
  dataKey: keyof GameMetricsDay;
  colorHsl: string;
  money?: boolean;
  duration?: boolean;
  loading: boolean;
}) {
  const points = series.map((s) => ({ label: dayLabel(s.date), value: Number(s[dataKey]) || 0 }));
  return <MetricAreaCard {...rest} points={points} gradKey={String(dataKey)} />;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  const idx = (parseInt(m, 10) || 1) - 1;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[idx] ?? ym} ${y?.slice(2) ?? ""}`.trim();
}

function MonthlyMetricCard({
  monthly,
  dataKey,
  ...rest
}: {
  title: string;
  subtitle: string;
  icon: React.ElementType;
  monthly: GameMetricsMonth[];
  dataKey: keyof GameMetricsMonth;
  colorHsl: string;
  money?: boolean;
  duration?: boolean;
  loading: boolean;
}) {
  const points = monthly.map((m) => ({ label: monthLabel(m.month), value: Number(m[dataKey]) || 0 }));
  return <MetricAreaCard {...rest} points={points} gradKey={`m_${String(dataKey)}`} />;
}

function BreakdownCard({
  title,
  icon: Icon,
  buckets,
  colorHsl,
  loading,
}: {
  title: string;
  icon: React.ElementType;
  buckets: SegmentBucket[];
  colorHsl: string;
  loading: boolean;
}) {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  const max = buckets.reduce((m, b) => Math.max(m, b.count), 0) || 1;
  const rows = buckets.slice(0, 8);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ background: `hsl(${colorHsl} / 0.12)`, color: `hsl(${colorHsl})` }}
        >
          <Icon className="h-4 w-4" />
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {buckets.length} value{buckets.length === 1 ? "" : "s"}
        </span>
      </div>
      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No data captured</p>
      ) : (
        <div className="space-y-2">
          {rows.map((b) => {
            const pct = total > 0 ? (b.count / total) * 100 : 0;
            return (
              <div key={b.value} className="space-y-1">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium" title={b.value}>{b.value}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {b.count.toLocaleString()} · {pct.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${(b.count / max) * 100}%`, background: `hsl(${colorHsl})` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExploreSegmentsPanel({
  segments,
  loading,
  eventFilter,
}: {
  segments?: SegmentsExploreResult;
  loading: boolean;
  eventFilter: string;
}) {
  const trend = (segments?.series ?? []).map((p) => ({
    label: dayLabel(p.date),
    value: p.value,
  }));
  const trendTitle = eventFilter ? `"${eventFilter}" volume` : "Total event volume";

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Activity className="h-4 w-4" />
            </span>
            <div>
              <h3 className="text-sm font-semibold leading-tight">{trendTitle}</h3>
              <p className="text-xs text-muted-foreground">
                Events per day{eventFilter ? "" : " across all event types"} · filterable above
              </p>
            </div>
          </div>
          <span className="text-lg font-bold tabular-nums text-primary">
            {(segments?.totalEvents ?? 0).toLocaleString()}
          </span>
        </div>
        {loading ? (
          <div className="flex h-[150px] items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={trend} margin={{ top: 10, right: 6, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="g_explore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(263 70% 60%)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="hsl(263 70% 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }} width={44} allowDecimals={false} />
              <Tooltip
                formatter={(v: number) => [v.toLocaleString(), trendTitle]}
                contentStyle={{ background: "hsl(222 47% 11%)", border: "1px solid hsl(215 28% 17%)", borderRadius: 8, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="value" stroke="hsl(263 70% 60%)" strokeWidth={2} fill="url(#g_explore)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <BreakdownCard title="App Version" icon={Puzzle} buckets={segments?.appVersions ?? []} colorHsl="330 81% 60%" loading={loading} />
        <BreakdownCard title="Platform" icon={Cpu} buckets={segments?.platforms ?? []} colorHsl="199 89% 55%" loading={loading} />
        <BreakdownCard title="Country" icon={Globe2} buckets={segments?.countries ?? []} colorHsl="142 71% 45%" loading={loading} />
        <BreakdownCard title="Top Events" icon={Activity} buckets={segments?.events ?? []} colorHsl="38 92% 55%" loading={loading} />
      </div>
    </div>
  );
}

function relTime(ms: number) {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function EventErrorsPanel({
  errors,
  loading,
}: {
  errors?: EventErrorsResult;
  loading: boolean;
}) {
  const rows = errors?.errors ?? [];
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <AlertCircle className="h-4 w-4 text-amber-500" />
        <h3 className="text-sm font-semibold">Event errors</h3>
        {errors && errors.totalRejected > 0 && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
            {errors.totalRejected} rejected
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Events rejected by the taxonomy validator at ingestion time.
      </p>
      {loading ? (
        <div className="flex h-24 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3 text-sm text-green-700 dark:text-green-400">
          <CheckCircle2 className="h-4 w-4" />
          No rejected events — every captured event passed taxonomy validation.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((e) => (
            <div key={`${e.name}|${e.code}`} className="flex items-center justify-between gap-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
                <span className="truncate font-mono text-sm">{e.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {e.count > 1 && (
                  <span className="tabular-nums text-xs text-muted-foreground">×{e.count}</span>
                )}
                <span className="rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {e.code}
                </span>
                <span className="w-16 text-right text-xs text-muted-foreground">
                  {relTime(e.lastSeenMs)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GameMetricsTab({
  summary,
  summaryLoading,
  metrics,
  metricsLoading,
  errors,
  errorsLoading,
  hiroStatus,
  satoriStatus,
  days,
  onDaysChange,
  segments,
  segmentsLoading,
  eventFilter,
  onEventFilterChange,
}: {
  summary?: DashboardSummary;
  summaryLoading: boolean;
  metrics?: GameMetricsResult;
  metricsLoading: boolean;
  errors?: EventErrorsResult;
  errorsLoading: boolean;
  hiroStatus: ReturnType<typeof useHiroStatus>;
  satoriStatus: ReturnType<typeof useSatoriStatus>;
  days: number;
  onDaysChange: (d: number) => void;
  segments?: SegmentsExploreResult;
  segmentsLoading: boolean;
  eventFilter: string;
  onEventFilterChange: (e: string) => void;
}) {
  const series = metrics?.series ?? [];
  const topEvents = summary?.topEvents ?? [];
  const totals = metrics?.totals;

  return (
    <div className="space-y-6">
      {/* Filter bar — mirrors Satori Cloud "Game Metrics" controls.
          Date Range + Event are live filters; Version/Platform/Country are
          surfaced as exact breakdown panels in the Explore section below,
          sourced from analytics_live_daily's by_* aggregates. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Date Range</span>
          <select
            value={days}
            onChange={(e) => onDaysChange(Number(e.target.value))}
            className="bg-transparent text-sm font-medium text-foreground outline-none"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-sm">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Event</span>
          <select
            value={eventFilter}
            onChange={(e) => onEventFilterChange(e.target.value)}
            className="max-w-[180px] bg-transparent text-sm font-medium text-foreground outline-none"
          >
            <option value="">All events</option>
            {(segments?.events ?? []).map((ev) => (
              <option key={ev.value} value={ev.value}>
                {ev.value} ({ev.count.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Explore / Segments — filter by AppID × version × platform × country × event */}
      <ExploreSegmentsPanel
        segments={segments}
        loading={segmentsLoading}
        eventFilter={eventFilter}
      />

      {/* Daily trend charts — mirrors Satori Cloud "Game Metrics" */}
      <div className="grid gap-4 md:grid-cols-2">
        <DailyMetricCard
          title="Daily Active Users"
          subtitle="Unique users active each day"
          icon={Users}
          series={series}
          dataKey="dau"
          colorHsl={CHART_COLORS.dau}
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily Installs"
          subtitle="New users acquired each day"
          icon={TrendingUp}
          series={series}
          dataKey="installs"
          colorHsl={CHART_COLORS.installs}
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily Sessions"
          subtitle="session_start events per day"
          icon={Activity}
          series={series}
          dataKey="sessions"
          colorHsl={CHART_COLORS.sessions}
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily Revenue"
          subtitle="Sum of purchase revenue per day"
          icon={DollarSign}
          series={series}
          dataKey="revenue"
          colorHsl={CHART_COLORS.revenue}
          money
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily ARPAU"
          subtitle="Avg revenue per active user"
          icon={TrendingUp}
          series={series}
          dataKey="arpau"
          colorHsl={CHART_COLORS.arpau}
          money
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily Avg. Session Duration"
          subtitle="Average session length per session"
          icon={Activity}
          series={series}
          dataKey="sessionDuration"
          colorHsl={CHART_COLORS.sessions}
          duration
          loading={metricsLoading}
        />
        <DailyMetricCard
          title="Daily Avg. Playtime"
          subtitle="Average playtime per active user"
          icon={Activity}
          series={series}
          dataKey="playtime"
          colorHsl={CHART_COLORS.dau}
          duration
          loading={metricsLoading}
        />
      </div>

      {totals && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryStat label={`Avg DAU · ${metrics?.days ?? 0}d`} value={totals.avgDau} />
          <SummaryStat label={`Installs · ${metrics?.days ?? 0}d`} value={totals.installs} />
          <SummaryStat label={`Sessions · ${metrics?.days ?? 0}d`} value={totals.sessions} />
          <SummaryStat label={`Revenue · ${metrics?.days ?? 0}d`} value={`$${totals.revenue.toFixed(2)}`} />
        </div>
      )}

      {/* Retention + RoAS rollups — mirrors Satori Cloud "Game Metrics" cards */}
      {totals && (
        <div className="grid gap-4 md:grid-cols-2">
          <StatGroupCard
            title="Retention"
            subtitle="Player engagement stats over the window"
            stats={[
              { label: "Avg Session Count", value: totals.avgSessionCount.toFixed(3) },
              { label: "Avg Playtime", value: fmtDuration(totals.avgPlaytime) },
              { label: "Avg Session Duration", value: fmtDuration(totals.avgSessionDuration) },
            ]}
          />
          <StatGroupCard
            title="RoAS"
            subtitle="Revenue and return-on-ad-spend"
            stats={[
              { label: "Avg CPI", value: `$${totals.cpi.toFixed(2)}` },
              { label: "Avg LTV", value: `$${totals.ltv.toFixed(2)}` },
              { label: "RoAS", value: `${(totals.roas * 100).toFixed(0)}%` },
            ]}
          />
        </div>
      )}

      {/* Monthly trend charts — mirrors Satori Cloud "Monthly *" charts */}
      {metrics?.monthly && metrics.monthly.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 pt-2">
            <CalendarClock className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Monthly</h3>
            <span className="text-xs text-muted-foreground">
              · trailing {metrics.monthly.length} month{metrics.monthly.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <MonthlyMetricCard
              title="Monthly Active Users"
              subtitle="Unique users active each month"
              icon={Users}
              monthly={metrics.monthly}
              dataKey="activeUsers"
              colorHsl={CHART_COLORS.dau}
              loading={metricsLoading}
            />
            <MonthlyMetricCard
              title="Monthly Revenue"
              subtitle="Total revenue across all purchases"
              icon={DollarSign}
              monthly={metrics.monthly}
              dataKey="revenue"
              colorHsl={CHART_COLORS.revenue}
              money
              loading={metricsLoading}
            />
            <MonthlyMetricCard
              title="Monthly ARPAU"
              subtitle="Avg revenue per active user"
              icon={TrendingUp}
              monthly={metrics.monthly}
              dataKey="arpau"
              colorHsl={CHART_COLORS.arpau}
              money
              loading={metricsLoading}
            />
            <MonthlyMetricCard
              title="Monthly Session Count"
              subtitle="Total amount of session starts"
              icon={Activity}
              monthly={metrics.monthly}
              dataKey="sessions"
              colorHsl={CHART_COLORS.sessions}
              loading={metricsLoading}
            />
            <MonthlyMetricCard
              title="Monthly Avg. Session Duration"
              subtitle="Average session length per session"
              icon={Activity}
              monthly={metrics.monthly}
              dataKey="sessionDuration"
              colorHsl={CHART_COLORS.sessions}
              duration
              loading={metricsLoading}
            />
            <MonthlyMetricCard
              title="Monthly Avg. Playtime"
              subtitle="Average playtime per active user"
              icon={Activity}
              monthly={metrics.monthly}
              dataKey="playtime"
              colorHsl={CHART_COLORS.dau}
              duration
              loading={metricsLoading}
            />
          </div>
        </div>
      )}

      {/* Event errors */}
      <EventErrorsPanel errors={errors} loading={errorsLoading} />

      {/* Top events */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Top events · last 24h</h3>
        {summaryLoading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : topEvents.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No events captured yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(160, topEvents.length * 34)}>
            <BarChart data={topEvents} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 11, fill: "hsl(217 10% 64%)" }}
              />
              <Tooltip
                cursor={{ fill: "hsl(215 28% 17%)" }}
                contentStyle={{
                  background: "hsl(222 47% 11%)",
                  border: "1px solid hsl(215 28% 17%)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {topEvents.map((_, i) => (
                  <Cell key={i} fill="hsl(263 70% 60%)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Systems health */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Puzzle className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Hiro meta-game systems</h3>
            <span className="text-xs text-muted-foreground">({HIRO_SYSTEMS.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {HIRO_SYSTEMS.map((sys) => (
              <StatusPill
                key={sys}
                name={sys}
                status={hiroStatus.isLoading ? "loading" : (hiroStatus.data?.[sys] ?? "error")}
              />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Satori LiveOps systems</h3>
            <span className="text-xs text-muted-foreground">({SATORI_SYSTEMS.length})</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {SATORI_SYSTEMS.map((sys) => (
              <StatusPill
                key={sys}
                name={sys}
                status={satoriStatus.isLoading ? "loading" : (satoriStatus.data?.[sys] ?? "error")}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function StatGroupCard({
  title,
  subtitle,
  stats,
}: {
  title: string;
  subtitle: string;
  stats: { label: string; value: string }[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-4 text-xs text-muted-foreground">{subtitle}</p>
      <div className="grid grid-cols-3 gap-3">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-bold tabular-nums tracking-tight">{s.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseDashboardTab(searchParams.get("tab"));
  const [metricsDays, setMetricsDays] = useState(14);
  const [eventFilter, setEventFilter] = useState("");
  const queryClient = useQueryClient();
  const selectedAppId = useAdminStore((s) => s.selectedAppId);
  const { data: appList } = useQuery({
    queryKey: ["admin", "apps", "selector"],
    queryFn: () => satori.getGameRegistry(serverKeyAuth()),
    select: (d) => d.games ?? [],
    retry: 1,
    staleTime: 60_000,
  });
  const activeAppName = selectedAppId
    ? (appList?.find((a) => a.id === selectedAppId)?.title ?? `${selectedAppId.slice(0, 8)}…`)
    : "All Apps (combined)";
  const health = useHealth();
  const summary = useSummary(selectedAppId);
  const gameMetrics = useGameMetrics(metricsDays, selectedAppId);
  const segments = useSegmentsExplore(metricsDays, eventFilter, selectedAppId);
  const eventErrors = useEventErrors();
  const analyticsOverview = useAnalyticsOverview(selectedAppId);
  const hiroStatus = useHiroStatus();
  const satoriStatus = useSatoriStatus();

  const isOnline =
    health.isSuccess && (isHealthyStatus(health.data?.status) || health.data?.status === undefined);

  function setTab(next: DashboardTab) {
    if (next === "status") {
      setSearchParams({}, { replace: true });
      return;
    }
    setSearchParams({ tab: next }, { replace: true });
  }

  const tabSubtitle =
    tab === "status"
      ? "Live audience, geography, and LiveOps overview."
      : tab === "metrics"
        ? "Installs, sessions, revenue, and segment breakdowns."
        : "Funnels, retention, and growth snapshots (CRM slices when n8n is available).";

  return (
    <div className="space-y-6">
      {/* Header + tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
              <Gamepad2 className="h-3 w-3" />
              {activeAppName}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{tabSubtitle}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "status" && <DashboardLayoutToolbar />}
          <button
            onClick={() => {
              health.refetch();
              summary.refetch();
              analyticsOverview.refetch();
              gameMetrics.refetch();
              eventErrors.refetch();
              hiroStatus.refetch();
              satoriStatus.refetch();
              if (tab === "telemetry") {
                queryClient.invalidateQueries({ queryKey: ["admin", "product-metrics"] });
                queryClient.invalidateQueries({ queryKey: ["admin", "growth-snapshot"] });
              }
            }}
            disabled={summary.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", summary.isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Server health strip */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm",
          health.isLoading && "border-border bg-muted/50",
          health.isError && "border-destructive/50 bg-destructive/5",
          isOnline && "border-green-500/40 bg-green-500/5",
          !health.isLoading && !health.isError && !isOnline && "border-yellow-500/50 bg-yellow-500/5",
        )}
      >
        {health.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : health.isError ? (
          <XCircle className="h-4 w-4 text-destructive" />
        ) : isOnline ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
        )}
        <span className="font-medium">
          {health.isLoading
            ? "Checking server…"
            : health.isError
              ? "Server unreachable"
              : isOnline
                ? "Server healthy"
                : `Server: ${health.data?.status ?? "unknown"}`}
        </span>
        {health.data && (
          <span className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Server className="h-3 w-3" /> {health.data.session_count ?? 0} sessions
            </span>
            <span className="flex items-center gap-1">
              <Cpu className="h-3 w-3" /> {health.data.goroutine_count ?? 0} goroutines
            </span>
          </span>
        )}
        {summary.data && (
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Gamepad2 className="h-3 w-3" />
            {summary.data.ringBufferSize} buffered events
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex items-center gap-1 border-b border-border">
        {([
          ["status", "Status"],
          ["metrics", "Game Metrics"],
          ["telemetry", "Product Telemetry"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "relative px-4 py-2 text-sm font-medium transition-colors",
              tab === key ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {tab === key && (
              <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      {tab === "status" ? (
        <StatusTab
          summary={summary.data}
          summaryLoading={summary.isLoading}
          analyticsOverview={analyticsOverview.data}
          analyticsLoading={analyticsOverview.isLoading}
          analyticsError={
            analyticsOverview.isError
              ? analyticsErrorMessage(analyticsOverview.error)
              : null
          }
        />
      ) : tab === "metrics" ? (
        <GameMetricsTab
          summary={summary.data}
          summaryLoading={summary.isLoading}
          metrics={gameMetrics.data}
          metricsLoading={gameMetrics.isLoading}
          errors={eventErrors.data}
          errorsLoading={eventErrors.isLoading}
          hiroStatus={hiroStatus}
          satoriStatus={satoriStatus}
          days={metricsDays}
          onDaysChange={setMetricsDays}
          segments={segments.data}
          segmentsLoading={segments.isLoading}
          eventFilter={eventFilter}
          onEventFilterChange={setEventFilter}
        />
      ) : (
        <ProductTelemetryPanel embedded />
      )}
    </div>
  );
}
