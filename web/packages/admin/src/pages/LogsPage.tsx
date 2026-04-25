import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Server,
  Activity,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Cpu,
  Users,
  Trash2,
  ChevronDown,
  ChevronRight,
  Pause,
  Play,
  Terminal,
  Layers,
  Sparkles,
  Flag,
  Shield,
  Wifi,
  WifiOff,
  ArrowDownCircle,
  BarChart3,
  Database,
} from "lucide-react";
import {
  serverKeyAuth,
  nakama,
  callRpc,
  HIRO_SYSTEMS,
  SATORI_SYSTEMS,
} from "@nakama/shared";
import type { HealthStatus } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────────────────── */

interface HealthSnapshot {
  timestamp: number;
  data: HealthStatus;
  latencyMs: number;
}

interface ActivityEntry {
  id: string;
  timestamp: number;
  type: "health" | "hiro" | "satori" | "info" | "error";
  message: string;
  detail?: string;
}

type SystemStatus = Record<string, "ok" | "error">;

/* ── Constants ────────────────────────────────────────────────────────── */

const HEALTH_INTERVAL = 10_000;
const SYSTEMS_INTERVAL = 60_000;
const MAX_HISTORY = 60;
const MAX_LOG_ENTRIES = 200;

/* ── Hooks ────────────────────────────────────────────────────────────── */

function useHealthWithLatency(enabled: boolean) {
  const [history, setHistory] = useState<HealthSnapshot[]>([]);

  const query = useQuery<HealthStatus>({
    queryKey: ["admin", "health-diag"],
    queryFn: async () => {
      const start = performance.now();
      const result = await nakama.getHealthcheck(serverKeyAuth());
      const latencyMs = Math.round(performance.now() - start);
      setHistory((prev) => {
        const next = [
          ...prev,
          { timestamp: Date.now(), data: result, latencyMs },
        ];
        return next.slice(-MAX_HISTORY);
      });
      return result;
    },
    refetchInterval: enabled ? HEALTH_INTERVAL : false,
    retry: 1,
  });

  return { ...query, history };
}

function useHiroStatus() {
  return useQuery<SystemStatus>({
    queryKey: ["admin", "hiro-diag"],
    queryFn: async () => {
      const results: SystemStatus = {};
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
    refetchInterval: SYSTEMS_INTERVAL,
    retry: 0,
  });
}

function useSatoriStatus() {
  return useQuery<SystemStatus>({
    queryKey: ["admin", "satori-diag"],
    queryFn: async () => {
      const results: SystemStatus = {};
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
    refetchInterval: SYSTEMS_INTERVAL,
    retry: 0,
  });
}

/* ── Activity Log Manager ─────────────────────────────────────────────── */

function useActivityLog() {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const idRef = useRef(0);

  const push = useCallback(
    (type: ActivityEntry["type"], message: string, detail?: string) => {
      setEntries((prev) => {
        const next = [
          {
            id: String(++idRef.current),
            timestamp: Date.now(),
            type,
            message,
            detail,
          },
          ...prev,
        ];
        return next.slice(0, MAX_LOG_ENTRIES);
      });
    },
    [],
  );

  const clear = useCallback(() => setEntries([]), []);

  return { entries, push, clear };
}

/* ── Utility ──────────────────────────────────────────────────────────── */

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTimeFull(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function uptimeStr(history: HealthSnapshot[]) {
  if (history.length < 2) return "—";
  const firstTs = history[0].timestamp;
  const lastTs = history[history.length - 1].timestamp;
  const diffSec = Math.round((lastTs - firstTs) / 1000);
  if (diffSec < 60) return `${diffSec}s`;
  const m = Math.floor(diffSec / 60);
  const s = diffSec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/* ── Metric Card ──────────────────────────────────────────────────────── */

function MetricCard({
  icon,
  label,
  value,
  subtitle,
  loading,
  error,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  subtitle?: string;
  loading?: boolean;
  error?: boolean;
  color?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {loading ? (
            <Loader2 className="mt-1 h-5 w-5 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="mt-0.5 text-xl font-bold text-destructive">&mdash;</p>
          ) : (
            <p className="mt-0.5 text-xl font-bold tabular-nums tracking-tight">
              {value}
            </p>
          )}
          {subtitle && (
            <p className="text-[10px] text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <div className={cn("rounded-md bg-primary/10 p-2", color)}>
          {icon}
        </div>
      </div>
    </div>
  );
}

/* ── Status Pill ──────────────────────────────────────────────────────── */

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
        "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
        status === "ok" &&
          "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400",
        status === "error" &&
          "border-destructive/30 bg-destructive/5 text-destructive",
        status === "loading" &&
          "border-border bg-muted/50 text-muted-foreground",
      )}
    >
      {status === "ok" && <CheckCircle2 className="h-3 w-3" />}
      {status === "error" && <XCircle className="h-3 w-3" />}
      {status === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
      <span className="capitalize">{name.replace(/_/g, " ")}</span>
    </div>
  );
}

/* ── Health Sparkline ─────────────────────────────────────────────────── */

function HealthSparkline({ history }: { history: HealthSnapshot[] }) {
  if (history.length < 2) {
    return (
      <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
        Collecting data points...
      </div>
    );
  }

  const maxLatency = Math.max(...history.map((h) => h.latencyMs), 1);
  const width = 100;
  const height = 40;
  const points = history.map((h, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - (h.latencyMs / maxLatency) * height * 0.85;
    return `${x},${y}`;
  });

  const avgLatency = Math.round(
    history.reduce((s, h) => s + h.latencyMs, 0) / history.length,
  );
  const minLatency = Math.min(...history.map((h) => h.latencyMs));
  const maxLat = Math.max(...history.map((h) => h.latencyMs));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Response latency &middot; {history.length} samples &middot; tracking{" "}
          {uptimeStr(history)}
        </span>
        <span>
          min {minLatency}ms &middot; avg {avgLatency}ms &middot; max {maxLat}ms
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-20 w-full rounded-md border border-border bg-muted/30"
        preserveAspectRatio="none"
      >
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-primary"
          vectorEffect="non-scaling-stroke"
        />
        {history.map((h, i) => {
          const x = (i / (history.length - 1)) * width;
          const y = height - (h.latencyMs / maxLatency) * height * 0.85;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="0.8"
              className="fill-primary"
            />
          );
        })}
      </svg>
    </div>
  );
}

/* ── Session History Chart ────────────────────────────────────────────── */

function SessionChart({ history }: { history: HealthSnapshot[] }) {
  if (history.length < 2) return null;

  const maxSessions = Math.max(...history.map((h) => h.data.session_count), 1);
  const width = 100;
  const height = 32;
  const points = history.map((h, i) => {
    const x = (i / (history.length - 1)) * width;
    const y = height - (h.data.session_count / maxSessions) * height * 0.85;
    return `${x},${y}`;
  });

  const areaPoints = [
    `0,${height}`,
    ...points,
    `${width},${height}`,
  ].join(" ");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Active sessions over time</span>
        <span>
          current:{" "}
          {history.length > 0
            ? history[history.length - 1].data.session_count
            : 0}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-14 w-full rounded-md border border-border bg-muted/30"
        preserveAspectRatio="none"
      >
        <polygon
          points={areaPoints}
          className="fill-emerald-500/10"
        />
        <polyline
          points={points.join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.8"
          className="text-emerald-500"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/* ── Activity Log Entry ───────────────────────────────────────────────── */

const TYPE_COLORS: Record<ActivityEntry["type"], string> = {
  health: "text-emerald-600 dark:text-emerald-400",
  hiro: "text-violet-600 dark:text-violet-400",
  satori: "text-amber-600 dark:text-amber-400",
  info: "text-blue-600 dark:text-blue-400",
  error: "text-destructive",
};

const TYPE_LABELS: Record<ActivityEntry["type"], string> = {
  health: "HEALTH",
  hiro: "HIRO",
  satori: "SATORI",
  info: "INFO",
  error: "ERROR",
};

function LogEntry({ entry }: { entry: ActivityEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        "group flex items-start gap-2 border-b border-border/40 px-3 py-1.5 font-mono text-xs transition-colors hover:bg-muted/30",
        entry.type === "error" && "bg-destructive/5",
      )}
    >
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {fmtTime(entry.timestamp)}
      </span>
      <span
        className={cn(
          "shrink-0 w-14 text-right font-semibold",
          TYPE_COLORS[entry.type],
        )}
      >
        {TYPE_LABELS[entry.type]}
      </span>
      <span className="min-w-0 flex-1 break-all text-foreground">
        {entry.message}
        {entry.detail && (
          <>
            <button
              onClick={() => setExpanded(!expanded)}
              className="ml-1.5 inline-flex items-center text-muted-foreground hover:text-foreground"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
            {expanded && (
              <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/50 p-2 text-[10px] text-muted-foreground">
                {entry.detail}
              </pre>
            )}
          </>
        )}
      </span>
    </div>
  );
}

/* ── Systems Section ──────────────────────────────────────────────────── */

function SystemsPanel({
  title,
  icon,
  systems,
  statusMap,
  loading,
}: {
  title: string;
  icon: React.ReactNode;
  systems: readonly string[];
  statusMap: SystemStatus | undefined;
  loading: boolean;
}) {
  const okCount = statusMap
    ? Object.values(statusMap).filter((s) => s === "ok").length
    : 0;
  const errCount = statusMap
    ? Object.values(statusMap).filter((s) => s === "error").length
    : 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {!loading && statusMap && (
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-green-600 dark:text-green-400">
              {okCount} ok
            </span>
            {errCount > 0 && (
              <span className="text-destructive">{errCount} error</span>
            )}
          </div>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      <div className="flex flex-wrap gap-2 p-4">
        {systems.map((sys) => (
          <StatusPill
            key={sys}
            name={sys}
            status={loading ? "loading" : statusMap?.[sys] ?? "loading"}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────────── */

export function LogsPage() {
  const [polling, setPolling] = useState(true);
  const activityLog = useActivityLog();

  const health = useHealthWithLatency(polling);
  const hiroStatus = useHiroStatus();
  const satoriStatus = useSatoriStatus();

  const prevHealthRef = useRef<string | null>(null);
  useEffect(() => {
    if (!health.data) return;
    const key = `${health.data.status}|${health.data.session_count}|${health.data.goroutine_count}`;
    if (prevHealthRef.current !== key) {
      const latency =
        health.history.length > 0
          ? health.history[health.history.length - 1].latencyMs
          : 0;
      activityLog.push(
        "health",
        `Node ${health.data.node} — status: ${health.data.status}, sessions: ${health.data.session_count}, goroutines: ${health.data.goroutine_count}`,
        `Latency: ${latency}ms`,
      );
      prevHealthRef.current = key;
    }
  }, [health.data, health.history, activityLog]);

  useEffect(() => {
    if (health.isError) {
      activityLog.push(
        "error",
        `Health check failed: ${health.error instanceof Error ? health.error.message : "Unknown error"}`,
      );
    }
  }, [health.isError, health.error, activityLog]);

  const prevHiroRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hiroStatus.data) return;
    const key = JSON.stringify(hiroStatus.data);
    if (prevHiroRef.current !== key) {
      const ok = Object.values(hiroStatus.data).filter((s) => s === "ok").length;
      const err = Object.values(hiroStatus.data).filter(
        (s) => s === "error",
      ).length;
      activityLog.push(
        err > 0 ? "error" : "hiro",
        `Hiro systems check: ${ok} ok, ${err} error`,
        err > 0
          ? `Failed: ${Object.entries(hiroStatus.data)
              .filter(([, s]) => s === "error")
              .map(([k]) => k)
              .join(", ")}`
          : undefined,
      );
      prevHiroRef.current = key;
    }
  }, [hiroStatus.data, activityLog]);

  const prevSatoriRef = useRef<string | null>(null);
  useEffect(() => {
    if (!satoriStatus.data) return;
    const key = JSON.stringify(satoriStatus.data);
    if (prevSatoriRef.current !== key) {
      const ok = Object.values(satoriStatus.data).filter(
        (s) => s === "ok",
      ).length;
      const err = Object.values(satoriStatus.data).filter(
        (s) => s === "error",
      ).length;
      activityLog.push(
        err > 0 ? "error" : "satori",
        `Satori systems check: ${ok} ok, ${err} error`,
        err > 0
          ? `Failed: ${Object.entries(satoriStatus.data)
              .filter(([, s]) => s === "error")
              .map(([k]) => k)
              .join(", ")}`
          : undefined,
      );
      prevSatoriRef.current = key;
    }
  }, [satoriStatus.data, activityLog]);

  useEffect(() => {
    activityLog.push("info", "Runtime diagnostics started");
    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isHealthy = health.data?.status === "ok" || health.data?.status === "200";
  const healthColor = health.isError
    ? "text-destructive"
    : isHealthy
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-amber-600 dark:text-amber-400";

  const currentLatency =
    health.history.length > 0
      ? health.history[health.history.length - 1].latencyMs
      : null;

  const goroutineDelta = useMemo(() => {
    if (health.history.length < 2) return null;
    const prev = health.history[health.history.length - 2].data.goroutine_count;
    const curr = health.history[health.history.length - 1].data.goroutine_count;
    return curr - prev;
  }, [health.history]);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Terminal className="h-6 w-6 text-primary" />
            Runtime Diagnostics
          </h2>
          <p className="text-muted-foreground">
            Server health, system status, and activity monitoring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Connection indicator */}
          <div
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              health.isError
                ? "border-destructive/40 bg-destructive/10 text-destructive"
                : isHealthy
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
            )}
          >
            {health.isError ? (
              <WifiOff className="h-3 w-3" />
            ) : (
              <Wifi className="h-3 w-3" />
            )}
            {health.isError ? "Disconnected" : isHealthy ? "Connected" : "Degraded"}
          </div>

          {/* Polling toggle */}
          <button
            onClick={() => setPolling((p) => !p)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
              polling
                ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {polling ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {polling ? "Pause" : "Resume"}
          </button>

          {/* Manual refresh */}
          <button
            onClick={() => {
              health.refetch();
              hiroStatus.refetch();
              satoriStatus.refetch();
              activityLog.push("info", "Manual refresh triggered");
            }}
            disabled={health.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn("h-4 w-4", health.isFetching && "animate-spin")}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Server Status Banner ────────────────────────────────────────── */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4",
          health.isError
            ? "border-destructive/30 bg-destructive/5"
            : isHealthy
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-amber-500/30 bg-amber-500/5",
        )}
      >
        {health.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : health.isError ? (
          <AlertTriangle className="h-5 w-5 text-destructive" />
        ) : isHealthy ? (
          <CheckCircle2 className={cn("h-5 w-5", healthColor)} />
        ) : (
          <AlertTriangle className={cn("h-5 w-5", healthColor)} />
        )}
        <div className="flex-1">
          <p className={cn("text-sm font-semibold", healthColor)}>
            {health.isLoading
              ? "Checking server health..."
              : health.isError
                ? "Server unreachable"
                : `Server ${health.data?.status === "ok" || health.data?.status === "200" ? "healthy" : health.data?.status ?? "unknown"}`}
          </p>
          <p className="text-xs text-muted-foreground">
            {health.data?.node
              ? `Node: ${health.data.node}`
              : health.isError
                ? "Unable to reach Nakama server"
                : "Initializing..."}
            {currentLatency != null && ` · ${currentLatency}ms`}
            {health.history.length > 0 &&
              ` · Last check: ${fmtTime(health.history[health.history.length - 1].timestamp)}`}
          </p>
        </div>
        {health.isFetching && !health.isLoading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* ── Metrics Grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard
          icon={<Server className="h-4 w-4 text-primary" />}
          label="Server Status"
          value={
            health.isError
              ? "Offline"
              : health.data?.status === "ok" || health.data?.status === "200"
                ? "Online"
                : (health.data?.status ?? "—")
          }
          subtitle={health.data?.node}
          loading={health.isLoading}
          error={health.isError}
        />
        <MetricCard
          icon={<Users className="h-4 w-4 text-emerald-500" />}
          label="Active Sessions"
          value={health.data?.session_count ?? 0}
          subtitle="Connected clients"
          loading={health.isLoading}
          error={health.isError}
          color="bg-emerald-500/10"
        />
        <MetricCard
          icon={<Cpu className="h-4 w-4 text-violet-500" />}
          label="Goroutines"
          value={health.data?.goroutine_count ?? 0}
          subtitle={
            goroutineDelta != null
              ? goroutineDelta > 0
                ? `+${goroutineDelta} since last`
                : goroutineDelta < 0
                  ? `${goroutineDelta} since last`
                  : "Stable"
              : undefined
          }
          loading={health.isLoading}
          error={health.isError}
          color="bg-violet-500/10"
        />
        <MetricCard
          icon={<Activity className="h-4 w-4 text-amber-500" />}
          label="Avg Latency"
          value={
            health.history.length > 0
              ? `${Math.round(health.history.reduce((s, h) => s + h.latencyMs, 0) / health.history.length)}ms`
              : "—"
          }
          subtitle={`${health.history.length} samples`}
          loading={health.isLoading}
          color="bg-amber-500/10"
        />
        <MetricCard
          icon={<Clock className="h-4 w-4 text-blue-500" />}
          label="Monitoring"
          value={uptimeStr(health.history)}
          subtitle={polling ? "Auto-refresh on" : "Paused"}
          loading={false}
          color="bg-blue-500/10"
        />
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <BarChart3 className="h-3.5 w-3.5" />
            Response Latency
          </h3>
          <HealthSparkline history={health.history} />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Session Count
          </h3>
          {health.history.length < 2 ? (
            <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
              Collecting data points...
            </div>
          ) : (
            <SessionChart history={health.history} />
          )}
        </div>
      </div>

      {/* ── Systems Status ──────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SystemsPanel
          title="Hiro Systems"
          icon={<Sparkles className="h-4 w-4 text-violet-500" />}
          systems={HIRO_SYSTEMS}
          statusMap={hiroStatus.data}
          loading={hiroStatus.isLoading}
        />
        <SystemsPanel
          title="Satori Systems"
          icon={<Flag className="h-4 w-4 text-amber-500" />}
          systems={SATORI_SYSTEMS}
          statusMap={satoriStatus.data}
          loading={satoriStatus.isLoading}
        />
      </div>

      {/* ── Activity Log ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Activity Log</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {activityLog.entries.length} entries
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                activityLog.clear();
                activityLog.push("info", "Activity log cleared");
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </button>
            {polling && (
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <ArrowDownCircle className="h-3 w-3" />
                Auto-updating
              </div>
            )}
          </div>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {activityLog.entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              No activity recorded yet.
            </div>
          ) : (
            activityLog.entries.map((entry) => (
              <LogEntry key={entry.id} entry={entry} />
            ))
          )}
        </div>
      </div>

      {/* ── Footer info ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Database className="h-3 w-3" />
            Health poll: {HEALTH_INTERVAL / 1000}s
          </span>
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            Systems poll: {SYSTEMS_INTERVAL / 1000}s
          </span>
          <span className="flex items-center gap-1">
            <Shield className="h-3 w-3" />
            Max history: {MAX_HISTORY} snapshots
          </span>
        </div>
        <span>
          Page loaded: {fmtTimeFull(Date.now())}
        </span>
      </div>
    </div>
  );
}


export default LogsPage;
