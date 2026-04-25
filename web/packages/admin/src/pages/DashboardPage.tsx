import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Server,
  Gamepad2,
  Users,
  Cpu,
  RefreshCw,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Puzzle,
  Sparkles,
  Flag,
  CalendarClock,
  FlaskConical,
  Shield,
  Database,
  BarChart3,
} from "lucide-react";
import {
  serverKeyAuth,
  nakama,
  HIRO_SYSTEMS,
  SATORI_SYSTEMS,
  callRpc,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const REFETCH_MS = 15_000;

// ─── Health Query ────────────────────────────────────────────────────
function useHealth() {
  return useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => nakama.getHealthcheck(serverKeyAuth()),
    refetchInterval: REFETCH_MS,
    retry: 1,
  });
}

// ─── Active Matches Query ────────────────────────────────────────────
function useMatches() {
  return useQuery({
    queryKey: ["admin", "matches"],
    queryFn: () =>
      nakama.listMatches({ ...serverKeyAuth(), limit: 100 }) as Promise<{
        matches?: { match_id: string; size: number; label?: string }[];
      }>,
    refetchInterval: REFETCH_MS,
    retry: 1,
  });
}

// ─── Hiro Systems Status ─────────────────────────────────────────────
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

// ─── Satori Systems Status ───────────────────────────────────────────
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

// ─── Stat Card ───────────────────────────────────────────────────────
function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  loading,
  error,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Loader2 className="mt-2 h-6 w-6 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="mt-1 text-2xl font-bold text-destructive">&mdash;</p>
          ) : (
            <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">
              {value}
            </p>
          )}
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className="rounded-md bg-primary/10 p-2.5">
          <Icon className="h-5 w-5 text-primary" />
        </div>
      </div>
    </div>
  );
}

// ─── System Status Pill ──────────────────────────────────────────────
function StatusPill({
  name,
  status,
}: {
  name: string;
  status: "ok" | "error" | "loading";
}) {
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
      {status === "loading" && (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      <span className="capitalize">{name.replace(/_/g, " ")}</span>
    </div>
  );
}

// ─── Quick Action Card ───────────────────────────────────────────────
function QuickAction({
  label,
  description,
  icon: Icon,
  to,
}: {
  label: string;
  description: string;
  icon: React.ElementType;
  to: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(to)}
      className="group flex items-center gap-4 rounded-lg border border-border bg-card p-4 text-left transition-all hover:border-primary/40 hover:shadow-md"
    >
      <div className="rounded-md bg-primary/10 p-2.5">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </button>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────
export function DashboardPage() {
  const health = useHealth();
  const matches = useMatches();
  const hiroStatus = useHiroStatus();
  const satoriStatus = useSatoriStatus();

  const isOnline = health.data?.status === "OK" || health.data?.status === "ok";
  const matchList = matches.data?.matches ?? [];
  const totalPlayers = matchList.reduce((sum, m) => sum + (m.size ?? 0), 0);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Server health, active sessions, and system overview.
          </p>
        </div>
        <button
          onClick={() => {
            health.refetch();
            matches.refetch();
            hiroStatus.refetch();
            satoriStatus.refetch();
          }}
          disabled={health.isFetching}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw
            className={cn("h-4 w-4", health.isFetching && "animate-spin")}
          />
          Refresh
        </button>
      </div>

      {/* Server Health Banner */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4",
          health.isLoading && "border-border bg-muted/50",
          health.isError && "border-destructive/50 bg-destructive/5",
          isOnline && "border-green-500/50 bg-green-500/5",
          !health.isLoading && !health.isError && !isOnline && "border-yellow-500/50 bg-yellow-500/5",
        )}
      >
        {health.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : health.isError ? (
          <XCircle className="h-5 w-5 text-destructive" />
        ) : isOnline ? (
          <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold">
            {health.isLoading
              ? "Checking server status..."
              : health.isError
                ? "Server unreachable"
                : isOnline
                  ? "Server is healthy"
                  : `Server status: ${health.data?.status ?? "unknown"}`}
          </p>
          {health.data && (
            <p className="text-xs text-muted-foreground">
              Node: {health.data.node ?? "—"}
            </p>
          )}
        </div>
        {health.dataUpdatedAt > 0 && (
          <p className="text-xs text-muted-foreground">
            Updated {new Date(health.dataUpdatedAt).toLocaleTimeString()}
          </p>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Server Status"
          value={isOnline ? "Online" : health.isError ? "Offline" : "—"}
          icon={Server}
          subtitle={health.data?.node}
          loading={health.isLoading}
          error={health.isError}
        />
        <StatCard
          title="Active Sessions"
          value={health.data?.session_count ?? "—"}
          icon={Users}
          subtitle="Connected players"
          loading={health.isLoading}
          error={health.isError}
        />
        <StatCard
          title="Goroutines"
          value={health.data?.goroutine_count ?? "—"}
          icon={Cpu}
          subtitle="Server concurrency"
          loading={health.isLoading}
          error={health.isError}
        />
        <StatCard
          title="Active Matches"
          value={matchList.length}
          icon={Gamepad2}
          subtitle={`${totalPlayers} players in matches`}
          loading={matches.isLoading}
          error={matches.isError}
        />
      </div>

      {/* Active Matches Preview */}
      {matchList.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Active Matches</h3>
            <button
              onClick={() => {/* navigate to matches page */}}
              className="text-xs text-primary hover:underline"
            >
              View all
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Match ID
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Label
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                    Players
                  </th>
                </tr>
              </thead>
              <tbody>
                {matchList.slice(0, 5).map((m) => (
                  <tr
                    key={m.match_id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {m.match_id.slice(0, 18)}...
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {m.label || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {m.size}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hiro Systems Status */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            Hiro Meta-game Systems
          </h3>
          <span className="text-xs text-muted-foreground">
            ({HIRO_SYSTEMS.length} subsystems)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {HIRO_SYSTEMS.map((sys) => (
            <StatusPill
              key={sys}
              name={sys}
              status={
                hiroStatus.isLoading
                  ? "loading"
                  : (hiroStatus.data?.[sys] ?? "error")
              }
            />
          ))}
        </div>
      </div>

      {/* Satori Systems Status */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            Satori LiveOps Systems
          </h3>
          <span className="text-xs text-muted-foreground">
            ({SATORI_SYSTEMS.length} subsystems)
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {SATORI_SYSTEMS.map((sys) => (
            <StatusPill
              key={sys}
              name={sys}
              status={
                satoriStatus.isLoading
                  ? "loading"
                  : (satoriStatus.data?.[sys] ?? "error")
              }
            />
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Quick Actions</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <QuickAction
            label="Feature Flags"
            description="Toggle flags and rollout percentages"
            icon={Flag}
            to="/flags"
          />
          <QuickAction
            label="Live Events"
            description="Create and manage live events"
            icon={CalendarClock}
            to="/events"
          />
          <QuickAction
            label="Experiments"
            description="A/B tests and variant analysis"
            icon={FlaskConical}
            to="/experiments"
          />
          <QuickAction
            label="Account Management"
            description="Ban, unban, and manage players"
            icon={Shield}
            to="/accounts"
          />
          <QuickAction
            label="Storage Browser"
            description="Browse and edit storage objects"
            icon={Database}
            to="/storage"
          />
          <QuickAction
            label="Analytics"
            description="Metrics, data lake, and cohort analysis"
            icon={BarChart3}
            to="/analytics"
          />
        </div>
      </div>
    </div>
  );
}
