import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  serverKeyAuth,
  nakama,
  hiro,
  satori,
  callRpc,
} from "@nakama/shared";
import type {
  NakamaUser,
  Streak,
  Audience,
  SatoriMessage,
  FeatureFlag,
  LiveEvent,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  UserCheck,
  UserX,
  Flame,
  Gift,
  Send,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Shield,
  TrendingDown,
  TrendingUp,
  Clock,
  Calendar,
  Target,
  Bell,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronUp,
  Search,
  Filter,
  Megaphone,
  ArrowUpRight,
  Zap,
  Eye,
  Users,
  Activity,
  CalendarClock,
  BarChart3,
} from "lucide-react";

const REFETCH_MS = 30_000;
const GLOBAL_CONFIG_SCOPE = "global";

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

type Tab =
  | "overview"
  | "at-risk"
  | "streaks"
  | "campaigns"
  | "flags"
  | "events";

interface PlayerRisk {
  user: NakamaUser;
  days_inactive: number;
  risk_level: "low" | "medium" | "high" | "critical";
  last_seen: string;
  has_streak: boolean;
}

function daysSince(dateStr: string): number {
  if (!dateStr) return 999;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 999;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

function riskLevel(daysInactive: number): PlayerRisk["risk_level"] {
  if (daysInactive <= 2) return "low";
  if (daysInactive <= 7) return "medium";
  if (daysInactive <= 30) return "high";
  return "critical";
}

function riskColor(level: PlayerRisk["risk_level"]) {
  switch (level) {
    case "low":
      return "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/30";
    case "medium":
      return "text-yellow-600 dark:text-yellow-400 bg-yellow-500/10 border-yellow-500/30";
    case "high":
      return "text-orange-600 dark:text-orange-400 bg-orange-500/10 border-orange-500/30";
    case "critical":
      return "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/30";
  }
}

function riskIcon(level: PlayerRisk["risk_level"]) {
  switch (level) {
    case "low":
      return CheckCircle2;
    case "medium":
      return Clock;
    case "high":
      return AlertTriangle;
    case "critical":
      return XCircle;
  }
}

// ─── Data Hooks ──────────────────────────────────────────────────────

function usePlayerList() {
  return useQuery({
    queryKey: ["admin", "retention", "players"],
    queryFn: () => nakama.listAccounts({ ...serverKeyAuth(), limit: 100 }),
    refetchInterval: REFETCH_MS,
  });
}

function useStreaks(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "streaks", gameScope],
    queryFn: () =>
      hiro.getHiroConfig("streaks", serverKeyAuth(), rpcGameId(gameScope)) as Promise<
        Record<string, unknown>
      >,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useIncentives(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "incentives", gameScope],
    queryFn: () =>
      hiro.getHiroConfig("incentives", serverKeyAuth(), rpcGameId(gameScope)) as Promise<
        Record<string, unknown>
      >,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useAudiences(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "audiences", gameScope],
    queryFn: () =>
      satori.listAudiences(serverKeyAuth(), rpcGameId(gameScope)) as Promise<{
        audiences?: Audience[];
      }>,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useMessages(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "messages", gameScope],
    queryFn: () =>
      satori.listMessages(serverKeyAuth(), rpcGameId(gameScope)) as Promise<{
        messages?: SatoriMessage[];
      }>,
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useFlags(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "flags", gameScope],
    queryFn: () => satori.getAllFlags(serverKeyAuth(), rpcGameId(gameScope)),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useLiveEvents(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "retention", "live-events", gameScope],
    queryFn: () => satori.listLiveEvents(serverKeyAuth(), rpcGameId(gameScope)),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useMetrics() {
  return useQuery({
    queryKey: ["admin", "retention", "metrics"],
    queryFn: () => satori.getMetrics(serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
}

// ─── Stat Card ───────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  loading,
  color,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
  loading?: boolean;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          {loading ? (
            <Loader2 className="mt-2 h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <p
              className={cn(
                "mt-1 text-2xl font-bold tabular-nums tracking-tight",
                color,
              )}
            >
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

// ─── Tab Button ──────────────────────────────────────────────────────

function TabBtn({
  label,
  icon: Icon,
  active,
  onClick,
  badge,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground shadow-sm"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold",
            active
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Overview Tab ────────────────────────────────────────────────────

function OverviewTab({
  riskPlayers,
  loading,
  streakConfig,
  incentiveConfig,
  audiences,
  messages,
  flags,
  liveEvents,
}: {
  riskPlayers: PlayerRisk[];
  loading: boolean;
  streakConfig: Record<string, unknown> | undefined;
  incentiveConfig: Record<string, unknown> | undefined;
  audiences: Audience[];
  messages: SatoriMessage[];
  flags: FeatureFlag[];
  liveEvents: LiveEvent[];
}) {
  const criticalCount = riskPlayers.filter(
    (p) => p.risk_level === "critical",
  ).length;
  const highCount = riskPlayers.filter(
    (p) => p.risk_level === "high",
  ).length;
  const mediumCount = riskPlayers.filter(
    (p) => p.risk_level === "medium",
  ).length;
  const lowCount = riskPlayers.filter(
    (p) => p.risk_level === "low",
  ).length;

  const streakCount = streakConfig
    ? Object.keys(streakConfig.streaks ?? streakConfig).length
    : 0;
  const incentiveCount = incentiveConfig
    ? Object.keys(incentiveConfig.incentives ?? incentiveConfig).length
    : 0;
  const retentionFlags = flags.filter(
    (f) =>
      f.name.toLowerCase().includes("retention") ||
      f.name.toLowerCase().includes("winback") ||
      f.name.toLowerCase().includes("comeback") ||
      f.name.toLowerCase().includes("churn"),
  );
  const activeEvents = liveEvents.filter((e) => e.enabled);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Tracked Players"
          value={riskPlayers.length}
          icon={Users}
          subtitle="From account list"
          loading={loading}
        />
        <StatCard
          title="Critical Risk"
          value={criticalCount}
          icon={XCircle}
          subtitle="30+ days inactive"
          loading={loading}
          color={
            criticalCount > 0 ? "text-red-600 dark:text-red-400" : undefined
          }
        />
        <StatCard
          title="High Risk"
          value={highCount}
          icon={AlertTriangle}
          subtitle="8-30 days inactive"
          loading={loading}
          color={
            highCount > 0
              ? "text-orange-600 dark:text-orange-400"
              : undefined
          }
        />
        <StatCard
          title="Healthy (Active)"
          value={lowCount}
          icon={CheckCircle2}
          subtitle="Active in last 2 days"
          loading={loading}
          color="text-green-600 dark:text-green-400"
        />
      </div>

      {/* Risk Distribution */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h3 className="mb-4 text-sm font-semibold">
          Player Risk Distribution
        </h3>
        <div className="flex gap-1 overflow-hidden rounded-full">
          {[
            {
              level: "critical" as const,
              count: criticalCount,
              color: "bg-red-500",
            },
            {
              level: "high" as const,
              count: highCount,
              color: "bg-orange-500",
            },
            {
              level: "medium" as const,
              count: mediumCount,
              color: "bg-yellow-500",
            },
            {
              level: "low" as const,
              count: lowCount,
              color: "bg-green-500",
            },
          ].map((seg) => {
            const pct =
              riskPlayers.length > 0
                ? (seg.count / riskPlayers.length) * 100
                : 0;
            return pct > 0 ? (
              <div
                key={seg.level}
                className={cn("h-3 transition-all", seg.color)}
                style={{ width: `${pct}%` }}
                title={`${seg.level}: ${seg.count} (${pct.toFixed(1)}%)`}
              />
            ) : null;
          })}
          {riskPlayers.length === 0 && (
            <div className="h-3 w-full bg-muted" />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Critical:{" "}
            {criticalCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> High:{" "}
            {highCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />{" "}
            Medium: {mediumCount}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-green-500" /> Low:{" "}
            {lowCount}
          </span>
        </div>
      </div>

      {/* Retention Toolbox */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Flame className="h-4 w-4 text-orange-500" />
            Streak Programs
          </div>
          <p className="text-2xl font-bold tabular-nums">{streakCount}</p>
          <p className="text-xs text-muted-foreground">
            Active streak definitions
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gift className="h-4 w-4 text-purple-500" />
            Incentive Programs
          </div>
          <p className="text-2xl font-bold tabular-nums">{incentiveCount}</p>
          <p className="text-xs text-muted-foreground">
            Battle pass / reward tracks
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Target className="h-4 w-4 text-blue-500" />
            Audiences
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {audiences.length}
          </p>
          <p className="text-xs text-muted-foreground">
            Segment definitions for targeting
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Megaphone className="h-4 w-4 text-cyan-500" />
            Campaigns
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {messages.length}
          </p>
          <p className="text-xs text-muted-foreground">
            Satori broadcast messages
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ToggleRight className="h-4 w-4 text-emerald-500" />
            Retention Flags
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {retentionFlags.length}
          </p>
          <p className="text-xs text-muted-foreground">
            Feature flags for retention
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-rose-500" />
            Active Events
          </div>
          <p className="text-2xl font-bold tabular-nums">
            {activeEvents.length}
          </p>
          <p className="text-xs text-muted-foreground">
            Live events for engagement
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── At-Risk Players Tab ─────────────────────────────────────────────

function AtRiskTab({ riskPlayers }: { riskPlayers: PlayerRisk[] }) {
  const [search, setSearch] = useState("");
  const [filterLevel, setFilterLevel] = useState<
    "all" | PlayerRisk["risk_level"]
  >("all");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const banMutation = useMutation({
    mutationFn: (userId: string) => nakama.banUser(userId, serverKeyAuth()),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["admin", "retention", "players"],
      }),
  });

  const filtered = useMemo(() => {
    let list = riskPlayers;
    if (filterLevel !== "all") {
      list = list.filter((p) => p.risk_level === filterLevel);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.user.username?.toLowerCase().includes(q) ||
          p.user.display_name?.toLowerCase().includes(q) ||
          p.user.user_id.toLowerCase().includes(q),
      );
    }
    list.sort((a, b) =>
      sortDir === "desc"
        ? b.days_inactive - a.days_inactive
        : a.days_inactive - b.days_inactive,
    );
    return list;
  }, [riskPlayers, filterLevel, search, sortDir]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by username or ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-primary"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {(
            ["all", "critical", "high", "medium", "low"] as const
          ).map((level) => (
            <button
              key={level}
              onClick={() => setFilterLevel(level)}
              className={cn(
                "rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
                filterLevel === level
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/50 text-muted-foreground hover:bg-accent",
              )}
            >
              {level}
            </button>
          ))}
        </div>

        <button
          onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          {sortDir === "desc" ? (
            <TrendingDown className="h-3.5 w-3.5" />
          ) : (
            <TrendingUp className="h-3.5 w-3.5" />
          )}
          {sortDir === "desc" ? "Most inactive" : "Least inactive"}
        </button>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">
        {filtered.length} player{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* Player List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          No players match this filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => {
            const Icon = riskIcon(p.risk_level);
            const expanded = expandedId === p.user.user_id;
            return (
              <div
                key={p.user.user_id}
                className="rounded-lg border border-border bg-card transition-shadow hover:shadow-sm"
              >
                <button
                  onClick={() =>
                    setExpandedId(expanded ? null : p.user.user_id)
                  }
                  className="flex w-full items-center gap-4 p-4 text-left"
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border",
                      riskColor(p.risk_level),
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {p.user.display_name || p.user.username || "—"}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {p.user.user_id}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular-nums">
                      {p.days_inactive}d
                    </p>
                    <p className="text-xs text-muted-foreground">inactive</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-semibold capitalize",
                      riskColor(p.risk_level),
                    )}
                  >
                    {p.risk_level}
                  </span>
                  {expanded ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>

                {expanded && (
                  <div className="border-t border-border px-4 py-3 space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Created
                        </p>
                        <p className="font-medium">
                          {p.user.create_time
                            ? new Date(
                                p.user.create_time,
                              ).toLocaleDateString()
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Last Active
                        </p>
                        <p className="font-medium">{p.last_seen || "—"}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Online</p>
                        <p className="font-medium">
                          {p.user.online ? (
                            <span className="text-green-600">Yes</span>
                          ) : (
                            "No"
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Location
                        </p>
                        <p className="font-medium">
                          {p.user.location || "—"}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => {
                          if (
                            confirm(
                              `Ban user ${p.user.username}? They will be disconnected.`,
                            )
                          ) {
                            banMutation.mutate(p.user.user_id);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/20"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        Ban
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Streaks Config Tab ──────────────────────────────────────────────

function StreaksTab({
  streakConfig,
  incentiveConfig,
  loading,
}: {
  streakConfig: Record<string, unknown> | undefined;
  incentiveConfig: Record<string, unknown> | undefined;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const streaks = (streakConfig?.streaks ?? streakConfig ?? {}) as Record<
    string,
    {
      name?: string;
      description?: string;
      count?: number;
      reset_cron?: string;
      rewards?: Array<{
        tier?: number;
        currencies?: Record<string, number>;
      }>;
    }
  >;
  const incentives = (incentiveConfig?.incentives ??
    incentiveConfig ??
    {}) as Record<
    string,
    {
      name?: string;
      description?: string;
      type?: string;
      max_tier?: number;
      start_time_sec?: number;
      end_time_sec?: number;
    }
  >;

  const streakEntries = Object.entries(streaks);
  const incentiveEntries = Object.entries(incentives);

  return (
    <div className="space-y-6">
      {/* Streaks */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          <h3 className="text-sm font-semibold">
            Streak Programs ({streakEntries.length})
          </h3>
        </div>
        {streakEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            No streak programs configured. Define them in Hiro &rarr; Streaks
            config.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {streakEntries.map(([id, def]) => (
              <div
                key={id}
                className="rounded-lg border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold truncate">
                    {def.name || id}
                  </p>
                  <Flame className="h-4 w-4 text-orange-400 shrink-0" />
                </div>
                {def.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {def.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {def.reset_cron && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {def.reset_cron}
                    </span>
                  )}
                  {def.rewards && (
                    <span className="flex items-center gap-1">
                      <Gift className="h-3 w-3" />
                      {def.rewards.length} tier
                      {def.rewards.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs font-mono text-muted-foreground">
                  {id}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Incentives */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Gift className="h-4 w-4 text-purple-500" />
          <h3 className="text-sm font-semibold">
            Incentive / Reward Tracks ({incentiveEntries.length})
          </h3>
        </div>
        {incentiveEntries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            No incentive programs configured. Define them in Hiro &rarr;
            Incentives config.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {incentiveEntries.map(([id, def]) => (
              <div
                key={id}
                className="rounded-lg border border-border bg-card p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold truncate">
                    {def.name || id}
                  </p>
                  <Gift className="h-4 w-4 text-purple-400 shrink-0" />
                </div>
                {def.description && (
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {def.description}
                  </p>
                )}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  {def.type && <span>Type: {def.type}</span>}
                  {def.max_tier != null && (
                    <span>{def.max_tier} tiers</span>
                  )}
                </div>
                <p className="text-xs font-mono text-muted-foreground">
                  {id}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Campaigns Tab ───────────────────────────────────────────────────

function CampaignsTab({
  messages,
  audiences,
  gameScope,
}: {
  messages: SatoriMessage[];
  audiences: Audience[];
  gameScope: string;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const queryClient = useQueryClient();

  const broadcastMutation = useMutation({
    mutationFn: () =>
      satori.broadcastMessage(
        {
          title,
          body: body || undefined,
          audience_id: audienceId || undefined,
          game_id: rpcGameId(gameScope),
        },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "retention", "messages", gameScope],
      });
      setTitle("");
      setBody("");
      setAudienceId("");
    },
  });

  return (
    <div className="space-y-6">
      {/* Compose */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Send className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">New Re-engagement Campaign</h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Come back and claim your rewards!"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Target Audience
            </label>
            <select
              value={audienceId}
              onChange={(e) => setAudienceId(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            >
              <option value="">All players</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="We miss you! Log in now to get bonus rewards..."
            rows={3}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
          />
        </div>
        <button
          onClick={() => broadcastMutation.mutate()}
          disabled={!title.trim() || broadcastMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {broadcastMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send Campaign
        </button>
        {broadcastMutation.isSuccess && (
          <p className="text-xs text-green-600">Campaign sent.</p>
        )}
        {broadcastMutation.isError && (
          <p className="text-xs text-destructive">
            Failed:{" "}
            {(broadcastMutation.error as Error)?.message || "Unknown error"}
          </p>
        )}
      </div>

      {/* Existing Messages */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Existing Campaigns ({messages.length})
        </h3>
        {messages.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground text-sm">
            No campaigns created yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Title
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Audience
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {messages.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-border last:border-0"
                  >
                    <td className="px-4 py-2.5 font-medium">{m.title}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {m.audience_id || "All"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className={cn(
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
                          m.status === "sent" &&
                            "bg-green-500/10 text-green-700 dark:text-green-400",
                          m.status === "scheduled" &&
                            "bg-blue-500/10 text-blue-700 dark:text-blue-400",
                          m.status === "draft" &&
                            "bg-muted text-muted-foreground",
                          m.status === "failed" &&
                            "bg-destructive/10 text-destructive",
                        )}
                      >
                        {m.status || "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {m.created_at
                        ? new Date(m.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Flags Tab ───────────────────────────────────────────────────────

function FlagsTab({ flags, gameScope }: { flags: FeatureFlag[]; gameScope: string }) {
  const queryClient = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: (flag: FeatureFlag) =>
      satori.toggleFlag(
        { name: flag.name, enabled: !flag.enabled, game_id: rpcGameId(gameScope) },
        serverKeyAuth(),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ["admin", "retention", "flags", gameScope],
      }),
  });

  const retentionFlags = flags.filter(
    (f) =>
      f.name.toLowerCase().includes("retention") ||
      f.name.toLowerCase().includes("winback") ||
      f.name.toLowerCase().includes("comeback") ||
      f.name.toLowerCase().includes("churn") ||
      f.name.toLowerCase().includes("streak") ||
      f.name.toLowerCase().includes("reward") ||
      f.name.toLowerCase().includes("bonus"),
  );
  const otherFlags = flags.filter((f) => !retentionFlags.includes(f));

  const FlagRow = ({ flag }: { flag: FeatureFlag }) => (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-4">
      <button
        onClick={() => toggleMutation.mutate(flag)}
        disabled={toggleMutation.isPending}
        className="shrink-0"
      >
        {flag.enabled ? (
          <ToggleRight className="h-6 w-6 text-green-500" />
        ) : (
          <ToggleLeft className="h-6 w-6 text-muted-foreground" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{flag.name}</p>
        {flag.description && (
          <p className="text-xs text-muted-foreground truncate">
            {flag.description}
          </p>
        )}
      </div>
      <code className="hidden text-xs text-muted-foreground sm:block max-w-[200px] truncate">
        {flag.value}
      </code>
      {flag.audiences && flag.audiences.length > 0 && (
        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
          {flag.audiences.length} audience
          {flag.audiences.length !== 1 ? "s" : ""}
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Retention-related flags */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Retention-Related Flags ({retentionFlags.length})
        </h3>
        {retentionFlags.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No retention-related flags detected. Create flags with names
            containing &quot;retention&quot;, &quot;winback&quot;,
            &quot;comeback&quot;, &quot;churn&quot;, &quot;streak&quot;,
            &quot;reward&quot;, or &quot;bonus&quot;.
          </div>
        ) : (
          <div className="space-y-2">
            {retentionFlags.map((f) => (
              <FlagRow key={f.name} flag={f} />
            ))}
          </div>
        )}
      </div>

      {/* All Other Flags */}
      {otherFlags.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            All Other Flags ({otherFlags.length})
          </h3>
          <div className="space-y-2">
            {otherFlags.map((f) => (
              <FlagRow key={f.name} flag={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Events Tab ──────────────────────────────────────────────────────

function EventsTab({ liveEvents, gameScope }: { liveEvents: LiveEvent[]; gameScope: string }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationHours, setDurationHours] = useState(24);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => {
      const now = Math.floor(Date.now() / 1000);
      return satori.scheduleLiveEvent(
        {
          id: `winback_${Date.now()}`,
          name,
          description: description || undefined,
          start_time_sec: now,
          end_time_sec: now + durationHours * 3600,
          enabled: true,
          game_id: rpcGameId(gameScope),
        },
        serverKeyAuth(),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["admin", "retention", "live-events", gameScope],
      });
      setName("");
      setDescription("");
      setDurationHours(24);
    },
  });

  const now = Math.floor(Date.now() / 1000);
  const active = liveEvents.filter(
    (e) =>
      e.enabled &&
      (!e.start_time_sec || e.start_time_sec <= now) &&
      (!e.end_time_sec || e.end_time_sec >= now),
  );
  const upcoming = liveEvents.filter(
    (e) => e.enabled && e.start_time_sec && e.start_time_sec > now,
  );
  const expired = liveEvents.filter(
    (e) => !e.enabled || (e.end_time_sec && e.end_time_sec < now),
  );

  const EventCard = ({
    event,
    status,
  }: {
    event: LiveEvent;
    status: "active" | "upcoming" | "expired";
  }) => (
    <div className="rounded-lg border border-border bg-card p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold truncate">{event.name}</p>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium capitalize",
            status === "active" &&
              "bg-green-500/10 text-green-700 dark:text-green-400",
            status === "upcoming" &&
              "bg-blue-500/10 text-blue-700 dark:text-blue-400",
            status === "expired" && "bg-muted text-muted-foreground",
          )}
        >
          {status}
        </span>
      </div>
      {event.description && (
        <p className="text-xs text-muted-foreground line-clamp-2">
          {event.description}
        </p>
      )}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {event.start_time_sec && (
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {new Date(event.start_time_sec * 1000).toLocaleDateString()}
          </span>
        )}
        {event.end_time_sec && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Ends{" "}
            {new Date(event.end_time_sec * 1000).toLocaleDateString()}
          </span>
        )}
      </div>
      <p className="text-xs font-mono text-muted-foreground">{event.id}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Quick Create */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            Quick Create Winback Event
          </h3>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Event Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Welcome Back Weekend"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Duration (hours)
            </label>
            <input
              type="number"
              value={durationHours}
              onChange={(e) => setDurationHours(Number(e.target.value))}
              min={1}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Double XP for returning players"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!name.trim() || createMutation.isPending}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {createMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CalendarClock className="h-4 w-4" />
          )}
          Create Event
        </button>
        {createMutation.isSuccess && (
          <p className="text-xs text-green-600">Event created.</p>
        )}
        {createMutation.isError && (
          <p className="text-xs text-destructive">
            Failed:{" "}
            {(createMutation.error as Error)?.message || "Unknown error"}
          </p>
        )}
      </div>

      {/* Active */}
      {active.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Active Now ({active.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((e) => (
              <EventCard key={e.id} event={e} status="active" />
            ))}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Upcoming ({upcoming.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map((e) => (
              <EventCard key={e.id} event={e} status="upcoming" />
            ))}
          </div>
        </div>
      )}

      {/* Expired */}
      {expired.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">
            Expired / Disabled ({expired.length})
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {expired.map((e) => (
              <EventCard key={e.id} event={e} status="expired" />
            ))}
          </div>
        </div>
      )}

      {liveEvents.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          No live events configured yet.
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────

export function RetentionPage() {
  const [gameScope, setGameScope] = useState(GLOBAL_CONFIG_SCOPE);
  const [tab, setTab] = useState<Tab>("overview");

  const players = usePlayerList();
  const streakQ = useStreaks(gameScope);
  const incentiveQ = useIncentives(gameScope);
  const audienceQ = useAudiences(gameScope);
  const messageQ = useMessages(gameScope);
  const flagQ = useFlags(gameScope);
  const eventQ = useLiveEvents(gameScope);

  const riskPlayers = useMemo<PlayerRisk[]>(() => {
    const users = players.data?.users ?? [];
    return users.map((u: NakamaUser) => {
      const inactive = daysSince(u.update_time);
      return {
        user: u,
        days_inactive: inactive,
        risk_level: riskLevel(inactive),
        last_seen: u.update_time
          ? new Date(u.update_time).toLocaleDateString()
          : "Never",
        has_streak: false,
      };
    });
  }, [players.data]);

  const criticalCount = riskPlayers.filter(
    (p) => p.risk_level === "critical" || p.risk_level === "high",
  ).length;

  const audiences = (audienceQ.data as { audiences?: Audience[] })?.audiences ?? [];
  const messages = (messageQ.data as { messages?: SatoriMessage[] })?.messages ?? [];
  const flags = flagQ.data?.flags ?? [];
  const liveEvents = eventQ.data?.events ?? [];

  const isLoading =
    players.isLoading ||
    streakQ.isLoading ||
    incentiveQ.isLoading ||
    audienceQ.isLoading;

  const refetchAll = useCallback(() => {
    players.refetch();
    streakQ.refetch();
    incentiveQ.refetch();
    audienceQ.refetch();
    messageQ.refetch();
    flagQ.refetch();
    eventQ.refetch();
  }, [players, streakQ, incentiveQ, audienceQ, messageQ, flagQ, eventQ]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Retention & Winback
          </h2>
          <p className="text-muted-foreground">
            Churn risk analysis, streak health, re-engagement campaigns, and
            winback tooling.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Game ID
            <input
              value={gameScope}
              onChange={(e) => setGameScope(e.target.value || GLOBAL_CONFIG_SCOPE)}
              placeholder="global or quizverse"
              className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          <button
            onClick={refetchAll}
            disabled={isLoading}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-4 w-4", isLoading && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/30 p-1">
        <TabBtn
          label="Overview"
          icon={BarChart3}
          active={tab === "overview"}
          onClick={() => setTab("overview")}
        />
        <TabBtn
          label="At-Risk Players"
          icon={UserX}
          active={tab === "at-risk"}
          onClick={() => setTab("at-risk")}
          badge={criticalCount}
        />
        <TabBtn
          label="Streaks & Incentives"
          icon={Flame}
          active={tab === "streaks"}
          onClick={() => setTab("streaks")}
        />
        <TabBtn
          label="Campaigns"
          icon={Megaphone}
          active={tab === "campaigns"}
          onClick={() => setTab("campaigns")}
        />
        <TabBtn
          label="Flags"
          icon={ToggleRight}
          active={tab === "flags"}
          onClick={() => setTab("flags")}
        />
        <TabBtn
          label="Live Events"
          icon={CalendarClock}
          active={tab === "events"}
          onClick={() => setTab("events")}
        />
      </div>

      {/* Error Banner */}
      {players.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <XCircle className="h-5 w-5 text-destructive shrink-0" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              Failed to load player data
            </p>
            <p className="text-xs text-muted-foreground">
              {(players.error as Error)?.message || "Unknown error"}
            </p>
          </div>
        </div>
      )}

      {/* Tab Content */}
      {tab === "overview" && (
        <OverviewTab
          riskPlayers={riskPlayers}
          loading={isLoading}
          streakConfig={streakQ.data}
          incentiveConfig={incentiveQ.data}
          audiences={audiences}
          messages={messages}
          flags={flags}
          liveEvents={liveEvents}
        />
      )}
      {tab === "at-risk" && <AtRiskTab riskPlayers={riskPlayers} />}
      {tab === "streaks" && (
        <StreaksTab
          streakConfig={streakQ.data}
          incentiveConfig={incentiveQ.data}
          loading={streakQ.isLoading || incentiveQ.isLoading}
        />
      )}
      {tab === "campaigns" && (
        <CampaignsTab messages={messages} audiences={audiences} gameScope={gameScope} />
      )}
      {tab === "flags" && <FlagsTab flags={flags} gameScope={gameScope} />}
      {tab === "events" && <EventsTab liveEvents={liveEvents} gameScope={gameScope} />}
    </div>
  );
}


export default RetentionPage;
