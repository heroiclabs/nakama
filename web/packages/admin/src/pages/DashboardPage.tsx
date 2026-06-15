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

function hourLabel(ms: number) {
  const d = new Date(ms);
  return `${d.getHours()}:00`;
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

function GameMetricsTab({
  summary,
  summaryLoading,
  hiroStatus,
  satoriStatus,
}: {
  summary?: DashboardSummary;
  summaryLoading: boolean;
  hiroStatus: ReturnType<typeof useHiroStatus>;
  satoriStatus: ReturnType<typeof useSatoriStatus>;
}) {
  const timeline = (summary?.timeline ?? []).map((t) => ({
    label: hourLabel(t.hourMs),
    count: t.count,
  }));
  const topEvents = summary?.topEvents ?? [];

  return (
    <div className="space-y-6">
      {/* Events over time */}
      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">Events · last 24 hours</h3>
        {summaryLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={timeline} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="evGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(263 70% 60%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(263 70% 60%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(217 10% 64%)" }} interval={3} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(217 10% 64%)" }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "hsl(222 47% 11%)",
                  border: "1px solid hsl(215 28% 17%)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="hsl(263 70% 60%)"
                strokeWidth={2}
                fill="url(#evGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

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

// ─── Page ────────────────────────────────────────────────────────────

export function DashboardPage() {
  const [tab, setTab] = useState<"status" | "metrics">("status");
  const health = useHealth();
  const summary = useSummary();
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
          hiroStatus={hiroStatus}
          satoriStatus={satoriStatus}
        />
      )}
    </div>
  );
}
