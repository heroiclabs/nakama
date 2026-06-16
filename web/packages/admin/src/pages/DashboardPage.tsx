import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
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
  HIRO_SYSTEMS,
  SATORI_SYSTEMS,
  callRpc,
  type DashboardSummary,
  type GameMetricsResult,
  type GameMetricsDay,
  type GameMetricsMonth,
  type EventErrorsResult,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import { WorldMap } from "@/components/WorldMap";
import { countryName, flagEmoji } from "@/lib/iso-countries";

const REFETCH_MS = 15_000;

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

function useSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ["admin", "dashboard-summary"],
    queryFn: () => satori.getDashboardSummary(serverKeyAuth()),
    refetchInterval: REFETCH_MS,
    retry: 1,
  });
}

function useGameMetrics(days: number) {
  return useQuery<GameMetricsResult>({
    queryKey: ["admin", "game-metrics", days],
    queryFn: () => satori.getGameMetrics({ days }, serverKeyAuth()),
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
        "group flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-all",
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

function ActiveUsersHero({ summary, loading }: { summary?: DashboardSummary; loading: boolean }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="relative overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 to-card p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Activity className="h-4 w-4 text-primary" />
          Active users · last 5 minutes
        </div>
        {loading ? (
          <Loader2 className="mt-3 h-9 w-9 animate-spin text-primary" />
        ) : (
          <p className="mt-2 text-5xl font-bold tabular-nums tracking-tight text-primary">
            {summary?.activeUsers5m ?? 0}
          </p>
        )}
        <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-primary/10 blur-2xl" />
      </div>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Users className="h-4 w-4" />
          Active users · last hour
        </div>
        <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
          {loading ? "—" : (summary?.activeUsers1h ?? 0)}
        </p>
      </div>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <TrendingUp className="h-4 w-4" />
          Active users · last 24h
        </div>
        <p className="mt-2 text-4xl font-bold tabular-nums tracking-tight">
          {loading ? "—" : (summary?.activeUsers24h ?? 0)}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {summary?.eventsLast24h ?? 0} events captured
        </p>
      </div>
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
    <div className="rounded-xl border border-border bg-card p-5">
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

// ─── Tabs content ────────────────────────────────────────────────────

function StatusTab({ summary, summaryLoading }: { summary?: DashboardSummary; summaryLoading: boolean }) {
  const countryRows = (summary?.topCountries ?? []).map((c) => ({
    label: countryName(c.country),
    flag: flagEmoji(c.country),
    value: c.users,
  }));
  const cityRows = (summary?.topCities ?? []).map((c) => ({
    label: c.city,
    value: c.users,
  }));

  return (
    <div className="space-y-6">
      <ActiveUsersHero summary={summary} loading={summaryLoading} />

      {/* Count cards — mirrors Satori's overview strip */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        <CountCard
          label="Ongoing experiments"
          value={summary?.experiments.ongoing ?? 0}
          accent="bg-violet-500/10 text-violet-500"
          icon={FlaskConical}
          to="/experiments"
          loading={summaryLoading}
        />
        <CountCard
          label="Ongoing live events"
          value={summary?.liveEvents.ongoing ?? 0}
          accent="bg-blue-500/10 text-blue-500"
          icon={CalendarClock}
          to="/events"
          loading={summaryLoading}
        />
        <CountCard
          label="Scheduled experiments"
          value={summary?.experiments.scheduled ?? 0}
          accent="bg-amber-500/10 text-amber-500"
          icon={FlaskConical}
          to="/experiments"
          loading={summaryLoading}
        />
        <CountCard
          label="Scheduled live events"
          value={summary?.liveEvents.scheduled ?? 0}
          accent="bg-cyan-500/10 text-cyan-500"
          icon={CalendarClock}
          to="/events"
          loading={summaryLoading}
        />
        <CountCard
          label="Scheduled messages"
          value={summary?.messages.scheduled ?? 0}
          accent="bg-emerald-500/10 text-emerald-500"
          icon={MessageSquare}
          to="/messages"
          loading={summaryLoading}
        />
      </div>

      {/* World map */}
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

      {/* Top countries / cities */}
      <div className="grid gap-4 md:grid-cols-2">
        <TopList title="Top countries" rows={countryRows} empty="No data available" />
        <TopList title="Top cities" rows={cityRows} empty="No data available" />
      </div>
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
}) {
  const series = metrics?.series ?? [];
  const topEvents = summary?.topEvents ?? [];
  const totals = metrics?.totals;

  return (
    <div className="space-y-6">
      {/* Filter bar — mirrors Satori Cloud "Game Metrics" controls.
          Only Date Range is data-backed today; the others need
          per-dimension daily aggregates the analytics pipeline does
          not yet store, so they are shown disabled for transparency. */}
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
        {["Country", "Platform", "Game Version", "Activity"].map((f) => (
          <span
            key={f}
            title="Needs per-dimension analytics aggregates — not yet available in the data pipeline"
            className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-border bg-muted/30 px-3 py-1.5 text-sm text-muted-foreground opacity-60"
          >
            + {f}
          </span>
        ))}
      </div>

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
  const [tab, setTab] = useState<"status" | "metrics">("status");
  const [metricsDays, setMetricsDays] = useState(14);
  const health = useHealth();
  const summary = useSummary();
  const gameMetrics = useGameMetrics(metricsDays);
  const eventErrors = useEventErrors();
  const hiroStatus = useHiroStatus();
  const satoriStatus = useSatoriStatus();

  const isOnline =
    health.isSuccess && (isHealthyStatus(health.data?.status) || health.data?.status === undefined);

  return (
    <div className="space-y-6">
      {/* Header + tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-sm text-muted-foreground">
            Live audience, geography, and LiveOps overview.
          </p>
        </div>
        <button
          onClick={() => {
            health.refetch();
            summary.refetch();
            gameMetrics.refetch();
            eventErrors.refetch();
            hiroStatus.refetch();
            satoriStatus.refetch();
          }}
          disabled={summary.isFetching}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", summary.isFetching && "animate-spin")} />
          Refresh
        </button>
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
        <StatusTab summary={summary.data} summaryLoading={summary.isLoading} />
      ) : (
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
        />
      )}
    </div>
  );
}
