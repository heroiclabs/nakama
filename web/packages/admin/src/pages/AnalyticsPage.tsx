import { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  callRpc,
  satori,
  nakama,
  serverKeyAuth,
  useRpcOptions,
} from "@nakama/shared";
import type { RpcOptions, NakamaUser } from "@nakama/shared";
import { cn } from "@/lib/utils";
import { useIframeAuth } from "@/lib/useIframeAuth";
import { useActiveApp } from "@/hooks/useScopedGame";
import {
  BarChart3,
  Activity,
  Bell,
  Users,
  Database,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Webhook,
  Calendar,
  TrendingUp,
  Server,
  Hash,
  CheckCircle,
  XCircle,
  Info,
  LayoutDashboard,
  ExternalLink,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Local interfaces                                                   */
/* ------------------------------------------------------------------ */

interface MetricEntry {
  name: string;
  value: number | string;
  labels?: Record<string, string>;
}

interface MetricAlert {
  metric_id: string;
  name: string;
  threshold: number;
  operator: "gt" | "lt" | "gte" | "lte";
}

interface TaxonomySchema {
  name: string;
  description?: string;
  category?: string;
  required_metadata?: string[];
  metadata_types?: Record<string, string>;
  deprecated?: boolean;
}

interface DataLakeTarget {
  id: string;
  type: string;
  enabled: boolean;
  config?: Record<string, unknown>;
  event_filters?: string[];
}

interface DataLakeConfig {
  enabled: boolean;
  retention_days?: number;
  targets?: DataLakeTarget[];
}

interface WebhookEntry {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  secret?: string;
}

interface CohortBucket {
  label: string;
  count: number;
  users: NakamaUser[];
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

const TABS = [
  { key: "overview", label: "Overview", icon: BarChart3 },
  { key: "dashboard", label: "Live Dashboard", icon: LayoutDashboard },
  { key: "metrics", label: "Metrics & Alerts", icon: Bell },
  { key: "cohorts", label: "Cohort Analysis", icon: Users },
  { key: "intelligence", label: "Game Intelligence", icon: TrendingUp },
  { key: "datalake", label: "Data Lake / Webhooks", icon: Database },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/**
 * URL of the standalone analytics dashboard (web/analytics-dashboard/index.html).
 * Points directly to the production analytics dashboard.
 */
const STANDALONE_DASHBOARD_URL = "https://nakama.intelli-verse-x.ai/analytics.html";

/* ------------------------------------------------------------------ */
/*  Utility                                                            */
/* ------------------------------------------------------------------ */

function fmtAge(seconds?: number | null): string {
  if (seconds === null || seconds === undefined) return "No events";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

const OP_LABELS: Record<string, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
};

/* ------------------------------------------------------------------ */
/*  Reusable UI                                                        */
/* ------------------------------------------------------------------ */

function StatCard({
  title,
  value,
  icon: Icon,
  subtitle,
  loading,
  error,
  trend,
}: {
  title: string;
  value: string | number;
  icon: React.ElementType;
  subtitle?: string;
  loading?: boolean;
  error?: boolean;
  trend?: "up" | "down" | "neutral";
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
            <div className="mt-1 flex items-center gap-2">
              <p className="text-2xl font-bold tabular-nums tracking-tight">
                {value}
              </p>
              {trend === "up" && (
                <ArrowUpRight className="h-4 w-4 text-green-500" />
              )}
              {trend === "down" && (
                <ArrowDownRight className="h-4 w-4 text-red-500" />
              )}
            </div>
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

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  message,
}: {
  icon: React.ElementType;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border p-12 text-center">
      <Icon className="mb-3 h-10 w-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function Badge({
  children,
  variant = "default",
}: {
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "destructive" | "outline";
}) {
  const cls: Record<string, string> = {
    default: "bg-primary/10 text-primary",
    success: "bg-green-500/10 text-green-600",
    warning: "bg-amber-500/10 text-amber-600",
    destructive: "bg-red-500/10 text-red-600",
    outline: "border border-border text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        cls[variant],
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Data hooks                                                         */
/* ------------------------------------------------------------------ */

function useServerAuth(): RpcOptions {
  return serverKeyAuth();
}

function useMetrics() {
  const opts = useServerAuth();
  return useQuery({
    queryKey: ["analytics", "metrics"],
    queryFn: () =>
      satori.getMetrics(opts) as Promise<{
        metrics?: MetricEntry[];
        raw?: string;
      }>,
    refetchInterval: 60_000,
  });
}

function useAccounts(limit: number) {
  const opts = useServerAuth();
  return useQuery({
    queryKey: ["analytics", "accounts", limit],
    queryFn: () => nakama.listAccounts({ ...opts, limit }),
  });
}

/** Unwrap the { success, data } envelope that all backend RPCs return. */
function unwrapRpc<T>(raw: unknown): T {
  const r = raw as any;
  if (r && typeof r === "object" && "success" in r) {
    if (r.success === false) throw new Error(r.error ?? "RPC failed");
    if ("data" in r) return r.data as T;
  }
  return raw as T;
}

function useTaxonomy() {
  const opts = useServerAuth();
  return useQuery({
    queryKey: ["analytics", "taxonomy"],
    queryFn: () =>
      callRpc("satori_taxonomy_schemas", {}, opts).then(
        (v) => unwrapRpc<{ schemas?: Record<string, unknown>; enforceStrict?: boolean; categories?: string[] }>(v),
      ),
    retry: false,
  });
}

function useDataLakeConfig() {
  const opts = useServerAuth();
  return useQuery({
    queryKey: ["analytics", "datalake"],
    queryFn: () =>
      callRpc("satori_datalake_config", {}, opts).then(
        (v) => unwrapRpc<{ enabledGlobally?: boolean; retentionDays?: number; targets?: any[] }>(v),
      ),
    retry: false,
  });
}

function useWebhooks() {
  const opts = useServerAuth();
  return useQuery({
    queryKey: ["analytics", "webhooks"],
    queryFn: () =>
      callRpc("satori_webhooks_list", {}, opts).then(
        (v) => unwrapRpc<{ webhooks?: WebhookEntry[] }>(v),
      ),
    retry: false,
  });
}

function useCreateAlert() {
  const qc = useQueryClient();
  const opts = useServerAuth();
  return useMutation({
    mutationFn: (alert: MetricAlert) => satori.setMetricAlert(alert, opts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analytics"] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Overview tab                                                       */
/* ------------------------------------------------------------------ */

const SIDEBAR_SHORTCUTS = [
  {
    label: "Funnels & Retention",
    description: "Step-through funnels, D1/D7/D30 retention",
    icon: TrendingUp,
    href: "/funnels",
  },
  {
    label: "Event Debugger",
    description: "Live event tail, per-user event history",
    icon: Activity,
    href: "/event-debugger",
  },
  {
    label: "Reports",
    description: "Saved funnel & retention reports",
    icon: BarChart3,
    href: "/reports",
  },
  {
    label: "Metrics",
    description: "Game KPIs, DAU series, custom metrics",
    icon: Bell,
    href: "/metrics",
  },
] as const;

function OverviewTab({ onTabChange }: { onTabChange: (tab: TabKey) => void }) {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Info callout — point to Dashboard for live metrics */}
      <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm text-muted-foreground">
          Live metrics (DAU, active users, experiments, live events) are on the{" "}
          <button
            onClick={() => navigate("/dashboard")}
            className="font-medium text-primary hover:underline"
          >
            Dashboard
          </button>
          . This page is for deep-dive analytics tools.
        </p>
      </div>

      {/* Row 1 — dedicated sidebar analytics pages */}
      <SectionHeading
        title="Analytics Tools"
        description="Jump directly to dedicated analytics pages"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SIDEBAR_SHORTCUTS.map((s) => (
          <button
            key={s.href}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            onClick={() => navigate(s.href)}
          >
            <s.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-medium">{s.label}</p>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </div>
          </button>
        ))}
      </div>

      {/* Row 2 — advanced tabs within this page */}
      <SectionHeading
        title="Advanced Analytics"
        description="Deeper analytics available on this page"
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TABS.filter((t) => t.key !== "overview").map((t) => (
          <button
            key={t.key}
            className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            onClick={() => onTabChange(t.key)}
          >
            <t.icon className="h-5 w-5 text-primary" />
            <p className="text-sm font-medium">{t.label}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Player Events tab                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Metrics & Alerts tab                                               */
/* ------------------------------------------------------------------ */

function MetricsTab() {
  const metrics = useMetrics();
  const createAlert = useCreateAlert();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("");
  const [alertForm, setAlertForm] = useState<MetricAlert>({
    metric_id: "",
    name: "",
    threshold: 0,
    operator: "gt",
  });

  const parsedMetrics = useMemo<MetricEntry[]>(() => {
    if (metrics.data?.metrics) return metrics.data.metrics;
    if (metrics.data?.raw) {
      return metrics.data.raw
        .split("\n")
        .filter((l) => l && !l.startsWith("#"))
        .map((line) => {
          const parts = line.split(/\s+/);
          return {
            name: parts[0] ?? line,
            value: parts[1] ? Number(parts[1]) : line,
          };
        });
    }
    return [];
  }, [metrics.data]);

  const filtered = useMemo(() => {
    if (!filter) return parsedMetrics;
    const q = filter.toLowerCase();
    return parsedMetrics.filter((m) => m.name.toLowerCase().includes(q));
  }, [parsedMetrics, filter]);

  const [confirmCreate, setConfirmCreate] = useState(false);

  const handleCreateAlert = () => {
    if (!alertForm.metric_id || !alertForm.name) return;
    setConfirmCreate(true);
  };

  const doCreateAlert = () => {
    setConfirmCreate(false);
    createAlert.mutate(alertForm, {
      onSuccess: () => {
        setShowForm(false);
        setAlertForm({ metric_id: "", name: "", threshold: 0, operator: "gt" });
      },
    });
  };

  return (
    <div className="space-y-6">
      {confirmCreate && (
        <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
            <div className="mb-4 flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-sm">Create metric alert <strong>"{alertForm.name}"</strong> in production?</p>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmCreate(false)} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-accent">Cancel</button>
              <button onClick={doCreateAlert} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">Create Alert</button>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          title="Satori Metrics"
          description="Real-time metrics from the Satori analytics pipeline"
        />
        <button
          onClick={() => setShowForm(!showForm)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Alert
        </button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold">Create Metric Alert</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Alert Name
              </label>
              <input
                value={alertForm.name}
                onChange={(e) =>
                  setAlertForm((p) => ({ ...p, name: e.target.value }))
                }
                placeholder="High session count"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Metric ID
              </label>
              <input
                value={alertForm.metric_id}
                onChange={(e) =>
                  setAlertForm((p) => ({ ...p, metric_id: e.target.value }))
                }
                placeholder="nakama_session_count"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Operator
              </label>
              <select
                value={alertForm.operator}
                onChange={(e) =>
                  setAlertForm((p) => ({
                    ...p,
                    operator: e.target.value as MetricAlert["operator"],
                  }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="gt">&gt; (greater than)</option>
                <option value="lt">&lt; (less than)</option>
                <option value="gte">≥ (greater or equal)</option>
                <option value="lte">≤ (less or equal)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Threshold
              </label>
              <input
                type="number"
                value={alertForm.threshold}
                onChange={(e) =>
                  setAlertForm((p) => ({
                    ...p,
                    threshold: Number(e.target.value),
                  }))
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
            >
              Cancel
            </button>
            <button
              onClick={handleCreateAlert}
              disabled={
                !alertForm.metric_id ||
                !alertForm.name ||
                createAlert.isPending
              }
              className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createAlert.isPending && (
                <Loader2 className="h-3 w-3 animate-spin" />
              )}
              Create Alert
            </button>
          </div>
          {createAlert.isError && (
            <ErrorBanner message="Failed to create alert" />
          )}
          {createAlert.isSuccess && (
            <p className="text-xs text-green-600">Alert created successfully</p>
          )}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter metrics…"
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {metrics.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {metrics.isError && (
        <ErrorBanner message="Failed to load metrics from Satori" />
      )}

      {!metrics.isLoading && !metrics.isError && filtered.length === 0 && (
        <EmptyState
          icon={BarChart3}
          message={
            parsedMetrics.length
              ? "No metrics match the current filter"
              : "No metrics available"
          }
        />
      )}

      {filtered.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            These are <strong className="text-foreground">Nakama system metrics</strong> (Prometheus — go_*, nakama_*).
            For game Satori metrics (DAU, events, revenue) see the <strong className="text-foreground">Metrics</strong> page in the sidebar.
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="p-3 text-left font-medium text-muted-foreground">
                  Metric
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Value
                </th>
                <th className="p-3 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.slice(0, 200).map((m, i) => (
                <tr key={i} className="hover:bg-accent/30">
                  <td className="p-3 font-mono text-xs">{m.name}</td>
                  <td className="p-3 text-right tabular-nums">
                    {typeof m.value === "number"
                      ? m.value.toLocaleString()
                      : m.value}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => {
                        setAlertForm((p) => ({
                          ...p,
                          metric_id: m.name,
                          name: `Alert: ${m.name}`,
                        }));
                        setShowForm(true);
                      }}
                      className="text-xs text-primary hover:underline"
                    >
                      + alert
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 200 && (
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Showing 200 of {filtered.length} metrics
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cohort Analysis tab                                                */
/* ------------------------------------------------------------------ */

function CohortsTab() {
  const accounts = useAccounts(100);
  const [view, setView] = useState<"signup" | "activity">("signup");

  const signupCohorts = useMemo<CohortBucket[]>(() => {
    if (!accounts.data?.users) return [];
    const map = new Map<string, NakamaUser[]>();
    for (const u of accounts.data.users) {
      const d = new Date(u.create_time);
      const label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const arr = map.get(label) ?? [];
      arr.push(u);
      map.set(label, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, users]) => ({ label, count: users.length, users }));
  }, [accounts.data]);

  const activityCohorts = useMemo<CohortBucket[]>(() => {
    if (!accounts.data?.users) return [];
    const now = Date.now();
    const buckets: { label: string; max: number }[] = [
      { label: "Today", max: 86_400_000 },
      { label: "Last 7 days", max: 7 * 86_400_000 },
      { label: "Last 30 days", max: 30 * 86_400_000 },
      { label: "Last 90 days", max: 90 * 86_400_000 },
      { label: "90+ days ago", max: Infinity },
    ];
    const result: CohortBucket[] = buckets.map((b) => ({
      label: b.label,
      count: 0,
      users: [],
    }));
    for (const u of accounts.data.users) {
      const diff = now - new Date(u.update_time).getTime();
      for (let i = 0; i < buckets.length; i++) {
        if (diff < buckets[i].max) {
          result[i].count++;
          result[i].users.push(u);
          break;
        }
      }
    }
    return result;
  }, [accounts.data]);

  const cohorts = view === "signup" ? signupCohorts : activityCohorts;
  const maxCount = Math.max(...cohorts.map((c) => c.count), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          title="Cohort Analysis"
          description="Analyze player registration and activity patterns"
        />
        <div className="flex gap-1 rounded-md border border-border bg-background p-0.5">
          <button
            onClick={() => setView("signup")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              view === "signup"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            By Signup Date
          </button>
          <button
            onClick={() => setView("activity")}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              view === "activity"
                ? "bg-primary text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            By Activity
          </button>
        </div>
      </div>

      {accounts.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {accounts.isError && (
        <ErrorBanner message="Failed to load account data" />
      )}

      {!accounts.isLoading && !accounts.isError && cohorts.length === 0 && (
        <EmptyState icon={Users} message="No user data available for analysis" />
      )}

      {cohorts.length > 0 && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              title="Total Sampled Users"
              value={accounts.data?.users?.length ?? 0}
              icon={Users}
              subtitle="From account listing"
            />
            <StatCard
              title="Cohorts"
              value={cohorts.length}
              icon={Calendar}
              subtitle={view === "signup" ? "By month" : "By activity recency"}
            />
            <StatCard
              title="Largest Cohort"
              value={Math.max(...cohorts.map((c) => c.count))}
              icon={TrendingUp}
              subtitle={
                cohorts.reduce((a, b) => (b.count > a.count ? b : a)).label
              }
            />
          </div>

          <div className="space-y-2">
            {cohorts.map((c) => (
              <div
                key={c.label}
                className="flex items-center gap-4 rounded-lg border border-border bg-card p-3"
              >
                <div className="w-36 shrink-0">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.count} user{c.count !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="flex-1">
                  <div className="h-6 w-full rounded-full bg-muted/50">
                    <div
                      className="h-6 rounded-full bg-primary/70 transition-all"
                      style={{
                        width: `${Math.max((c.count / maxCount) * 100, 2)}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="w-16 text-right">
                  <span className="text-sm font-semibold tabular-nums">
                    {((c.count / (accounts.data?.users?.length || 1)) * 100).toFixed(
                      1,
                    )}
                    %
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg border border-border bg-muted/10 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4" />
              <span>
                Cohort data is based on a sample of up to 100 accounts from the
                Nakama console API. For full population analytics, export data
                via the Data Lake tab.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Data Lake / Webhooks tab                                           */
/* ------------------------------------------------------------------ */

function DataLakeTab() {
  const taxonomy = useTaxonomy();
  const datalake = useDataLakeConfig();
  const webhooks = useWebhooks();
  const [taxFilter, setTaxFilter] = useState("");

  // Backend returns schemas as { event_name: schema } object (camelCase).
  // Convert to a flat array with the snake_case fields the table expects.
  const schemas = useMemo<TaxonomySchema[]>(() => {
    const raw = taxonomy.data?.schemas;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as TaxonomySchema[];
    return Object.entries(raw).map(([name, s]: [string, any]) => ({
      name,
      description: s.description,
      category: s.category,
      required_metadata: s.requiredMetadata ?? s.required_metadata ?? [],
      metadata_types: s.metadataTypes ?? s.metadata_types,
      deprecated: s.deprecated ?? false,
    }));
  }, [taxonomy.data]);

  const filteredSchemas = useMemo(() => {
    if (!taxFilter) return schemas;
    const q = taxFilter.toLowerCase();
    return schemas.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q),
    );
  }, [schemas, taxFilter]);

  // Normalize camelCase backend fields to the UI shape.
  const dlRaw = datalake.data;
  const dlConfig = dlRaw
    ? {
        enabled: (dlRaw as any).enabledGlobally ?? false,
        retention_days: (dlRaw as any).retentionDays as number | undefined,
        targets: ((dlRaw.targets ?? []) as any[]).map((t: any) => ({
          id: t.id,
          type: t.type,
          enabled: t.enabled,
          config: t.config,
          event_filters: t.eventFilters ?? t.event_filters,
        })) as DataLakeTarget[],
      }
    : undefined;
  const whList = webhooks.data?.webhooks ?? [];

  const allFailed =
    taxonomy.isError && datalake.isError && webhooks.isError;

  return (
    <div className="space-y-8">
      {allFailed && (
        <div className="rounded-lg border border-border bg-muted/10 p-6 text-center">
          <Database className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">
            Data Lake / Webhooks Not Available
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            These features require server-side Satori RPCs (taxonomy, datalake,
            webhooks) which are not registered on this Nakama instance.
            Configure them via the Hiro/Satori server modules.
          </p>
        </div>
      )}

      {/* Event Taxonomy */}
      <div className="space-y-4">
        <SectionHeading
          title="Event Taxonomy"
          description="Defined event schemas for validation and categorization"
        />
        {taxonomy.isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {taxonomy.isError && !allFailed && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 p-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Taxonomy RPC not available on this server
          </div>
        )}
        {!taxonomy.isLoading && !taxonomy.isError && schemas.length === 0 && (
          <EmptyState icon={Hash} message="No event schemas defined yet" />
        )}
        {schemas.length > 0 && (
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={taxFilter}
                onChange={(e) => setTaxFilter(e.target.value)}
                placeholder="Filter schemas…"
                className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="p-3 text-left font-medium text-muted-foreground">
                      Event
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">
                      Category
                    </th>
                    <th className="p-3 text-left font-medium text-muted-foreground">
                      Required Fields
                    </th>
                    <th className="p-3 text-center font-medium text-muted-foreground">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredSchemas.map((s) => (
                    <tr key={s.name} className="hover:bg-accent/30">
                      <td className="p-3 font-mono text-xs">{s.name}</td>
                      <td className="p-3">
                        {s.category && <Badge>{s.category}</Badge>}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {s.required_metadata?.join(", ") || "—"}
                      </td>
                      <td className="p-3 text-center">
                        {s.deprecated ? (
                          <Badge variant="warning">Deprecated</Badge>
                        ) : (
                          <Badge variant="success">Active</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Data Lake Config */}
      <div className="space-y-4">
        <SectionHeading
          title="Data Lake Configuration"
          description="Export pipeline settings for analytics data"
        />
        {datalake.isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {datalake.isError && !allFailed && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 p-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Data Lake RPC not available on this server
          </div>
        )}
        {dlConfig && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                {dlConfig.enabled ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <div>
                  <p className="text-sm font-medium">Export</p>
                  <p className="text-xs text-muted-foreground">
                    {dlConfig.enabled ? "Enabled" : "Disabled"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Retention</p>
                  <p className="text-xs text-muted-foreground">
                    {dlConfig.retention_days
                      ? `${dlConfig.retention_days} days`
                      : "Default"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
                <Database className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Targets</p>
                  <p className="text-xs text-muted-foreground">
                    {dlConfig.targets?.length ?? 0} configured
                  </p>
                </div>
              </div>
            </div>

            {dlConfig.targets && dlConfig.targets.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="p-3 text-left font-medium text-muted-foreground">
                        ID
                      </th>
                      <th className="p-3 text-left font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="p-3 text-center font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="p-3 text-left font-medium text-muted-foreground">
                        Filters
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dlConfig.targets.map((t) => (
                      <tr key={t.id} className="hover:bg-accent/30">
                        <td className="p-3 font-mono text-xs">{t.id}</td>
                        <td className="p-3">
                          <Badge>{t.type}</Badge>
                        </td>
                        <td className="p-3 text-center">
                          {t.enabled ? (
                            <Badge variant="success">On</Badge>
                          ) : (
                            <Badge variant="destructive">Off</Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {t.event_filters?.join(", ") || "All events"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Webhooks */}
      <div className="space-y-4">
        <SectionHeading
          title="Outbound Webhooks"
          description="Event-driven webhooks for external integrations"
        />
        {webhooks.isLoading && (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {webhooks.isError && !allFailed && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/10 p-3 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            Webhooks RPC not available on this server
          </div>
        )}
        {!webhooks.isLoading && !webhooks.isError && whList.length === 0 && (
          <EmptyState
            icon={Webhook}
            message="No outbound webhooks configured"
          />
        )}
        {whList.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    ID
                  </th>
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    URL
                  </th>
                  <th className="p-3 text-left font-medium text-muted-foreground">
                    Events
                  </th>
                  <th className="p-3 text-center font-medium text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {whList.map((wh) => (
                  <tr key={wh.id} className="hover:bg-accent/30">
                    <td className="p-3 font-mono text-xs">{wh.id}</td>
                    <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">
                      {wh.url}
                    </td>
                    <td className="p-3 text-xs">
                      {wh.events.slice(0, 3).join(", ")}
                      {wh.events.length > 3 && ` +${wh.events.length - 3}`}
                    </td>
                    <td className="p-3 text-center">
                      {wh.enabled ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Disabled</Badge>
                      )}
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

/** Derive a clean RPC slug from any string (UUID → sanitized slug). */
function toRpcSlug(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function GameIntelligenceTab() {
  // Resolve the selected app → use its slug, not its UUID.
  const { app } = useActiveApp();

  // Derive the canonical slug: prefer app.slug, then sanitize app.title, then "quizverse".
  const defaultSlug = app
    ? toRpcSlug(app.slug ?? app.title)
    : "quizverse";

  const [gameSlug, setGameSlug] = useState(defaultSlug);
  useEffect(() => {
    setGameSlug(defaultSlug);
  }, [defaultSlug]);

  // Build the RPC name: <slug>_game_intelligence_report
  const intelligenceRpc = `${gameSlug || "quizverse"}_game_intelligence_report`;

  const report = useQuery({
    queryKey: ["analytics", "game-intelligence", gameSlug],
    queryFn: () =>
      callRpc(
        intelligenceRpc,
        { game_id: gameSlug || "quizverse", hours: 24, days: 7, sample_players: 25 },
        serverKeyAuth(),
      ),
    retry: 1,
  });

  const reportData = report.data as
    | {
        executive_summary?: {
          health_score?: number;
          status?: "healthy" | "warning" | "critical";
          headline?: string;
        };
        top_wins?: string[];
        top_problems?: string[];
        segment_insights?: string[];
        action_list?: Array<{
          impact?: string;
          effort?: string;
          owner?: string;
          action?: string;
          evidence?: string;
        }>;
        liveops_impact?: Record<string, number | boolean>;
        key_metrics?: {
          rpc?: {
            calls?: number;
            failed?: number;
            success_rate?: number;
            avg_ms?: number;
            p90_ms?: number;
          };
          storage_samples?: Record<string, number>;
        };
        analytics_diagnostics?: {
          expected_game_id?: string;
          sampled_events?: number;
          matching_expected_game_id?: number;
          source_game_ids?: Record<string, number>;
          last_event_at?: string | null;
          last_event_age_seconds?: number | null;
          last_event_game_id?: string;
          status?: "fresh" | "stale" | "old" | "empty";
        };
        risks?: string[];
      }
    | undefined;

  const text = useMemo(() => {
    if (!report.data) return "";
    return typeof report.data === "string"
      ? report.data
      : JSON.stringify(report.data, null, 2);
  }, [report.data]);

  const sourceGameIds = reportData?.analytics_diagnostics?.source_game_ids ?? {};
  const sourceGameIdSummary = Object.entries(sourceGameIds)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([gameId, count]) => `${gameId}: ${count}`)
    .join(", ");
  const freshnessStatus = reportData?.analytics_diagnostics?.status;

  return (
    <div className="space-y-4">
      <SectionHeading
        title="Game Intelligence"
        description="Unified operator report for what is working, what is broken, and which LiveOps actions to run next."
      />

      <label className="flex max-w-xs items-center gap-2 text-xs text-muted-foreground">
        Game slug
        <input
          value={gameSlug}
          onChange={(e) => setGameSlug(toRpcSlug(e.target.value))}
          className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          placeholder="quizverse"
        />
      </label>

      {reportData?.executive_summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <StatCard
            title="Health Score"
            value={reportData.executive_summary.health_score ?? "—"}
            icon={TrendingUp}
            subtitle={reportData.executive_summary.status ?? "unknown"}
            trend={
              (reportData.executive_summary.health_score ?? 0) >= 70
                ? "up"
                : "down"
            }
          />
          <StatCard
            title="RPC Calls"
            value={reportData.key_metrics?.rpc?.calls ?? 0}
            icon={Server}
            subtitle={`${reportData.key_metrics?.rpc?.failed ?? 0} failed`}
          />
          <StatCard
            title="Success Rate"
            value={`${Math.round((reportData.key_metrics?.rpc?.success_rate ?? 0) * 100)}%`}
            icon={CheckCircle}
            subtitle={`p90 ${reportData.key_metrics?.rpc?.p90_ms ?? 0}ms`}
          />
          <StatCard
            title="LiveOps Objects"
            value={Object.values(reportData.liveops_impact ?? {}).filter(Boolean).length}
            icon={Calendar}
            subtitle="configured surfaces"
          />
          <StatCard
            title="Last Analytics Event"
            value={fmtAge(reportData.analytics_diagnostics?.last_event_age_seconds)}
            icon={Clock}
            subtitle={reportData.analytics_diagnostics?.last_event_game_id ?? "unknown game"}
            trend={freshnessStatus === "fresh" ? "up" : "down"}
          />
          <StatCard
            title="Source Game IDs"
            value={Object.keys(sourceGameIds).length}
            icon={Hash}
            subtitle={sourceGameIdSummary || "none sampled"}
          />
        </div>
      )}

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Pulls the <code className="rounded bg-muted px-1 font-mono text-xs">{intelligenceRpc}</code> operator endpoint through
            the authenticated admin proxy.
          </p>
          <button
            onClick={() => report.refetch()}
            disabled={report.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", report.isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>

        {report.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Generating report…
          </div>
        )}

        {report.isError && (
          <div className="rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm text-yellow-700 dark:text-yellow-300">
            RPC <code className="rounded bg-yellow-500/20 px-1 font-mono text-xs">{intelligenceRpc}</code> is not registered.
            Make sure the Nakama module for <strong>{gameSlug || "quizverse"}</strong> exports a <code className="font-mono text-xs">{intelligenceRpc}</code> handler.
            Also verify the game slug in the field above matches the registered RPC prefix.
          </div>
        )}

        {reportData?.executive_summary?.headline && (
          <div className="mb-4 rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-1 flex items-center gap-2">
              <Badge
                variant={
                  reportData.executive_summary.status === "healthy"
                    ? "success"
                    : reportData.executive_summary.status === "critical"
                      ? "destructive"
                      : "warning"
                }
              >
                {reportData.executive_summary.status}
              </Badge>
              <span className="text-sm font-medium">Headline</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {reportData.executive_summary.headline}
            </p>
          </div>
        )}

        {reportData?.analytics_diagnostics && freshnessStatus !== "fresh" && (
          <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Analytics data freshness needs attention
            </div>
            <p>
              Last sampled event:{" "}
              {reportData.analytics_diagnostics.last_event_at ?? "none"}.
              Expected game ID: {reportData.analytics_diagnostics.expected_game_id ?? "unknown"}.
              Source game IDs: {sourceGameIdSummary || "none sampled"}.
            </p>
          </div>
        )}

        {reportData && (
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <InsightList title="Top Wins" items={reportData.top_wins ?? []} variant="success" />
            <InsightList title="Top Problems" items={reportData.top_problems ?? []} variant="destructive" />
            <InsightList title="Segment Insights" items={reportData.segment_insights ?? []} variant="default" />
            <InsightList title="Risks" items={reportData.risks ?? []} variant="warning" />
          </div>
        )}

        {reportData?.action_list && reportData.action_list.length > 0 && (
          <div className="mb-4 space-y-2">
            <h4 className="text-sm font-semibold">Ranked Actions</h4>
            {reportData.action_list.slice(0, 5).map((action, index) => (
              <div key={`${action.action}-${index}`} className="rounded-md border border-border p-3">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge variant={action.impact === "high" ? "destructive" : "warning"}>
                    {action.impact ?? "impact"}
                  </Badge>
                  <Badge variant="outline">{action.effort ?? "effort"}</Badge>
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    {action.owner ?? "owner"}
                  </span>
                </div>
                <p className="text-sm font-medium">{action.action}</p>
                {action.evidence && (
                  <p className="mt-1 text-xs text-muted-foreground">{action.evidence}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {text && (
          <pre className="max-h-[40vh] overflow-auto rounded-md bg-muted/50 p-4 text-xs">
            {text}
          </pre>
        )}
      </div>
    </div>
  );
}

function InsightList({
  title,
  items,
  variant,
}: {
  title: string;
  items: string[];
  variant: "default" | "success" | "warning" | "destructive";
}) {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant={variant}>{title}</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No entries reported.</p>
      ) : (
        <ul className="space-y-1 text-sm text-muted-foreground">
          {items.slice(0, 5).map((item) => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>("overview");
  const qc = useQueryClient();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Analytics</h2>
          <p className="text-muted-foreground">
            Metrics, data lake, and cohort analysis
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ["analytics"] })}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-accent"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-tab={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab onTabChange={setTab} />}
      {tab === "dashboard" && <StandaloneDashboardTab />}

      {tab === "metrics" && <MetricsTab />}
      {tab === "cohorts" && <CohortsTab />}
      {tab === "intelligence" && <GameIntelligenceTab />}
      {tab === "datalake" && <DataLakeTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Standalone Dashboard tab — embeds the canonical analytics.html.    */
/* ------------------------------------------------------------------ */

function StandaloneDashboardTab() {
  const { iframeRef, handleIframeLoad } = useIframeAuth({
    targetUrl: STANDALONE_DASHBOARD_URL,
    enabled: true,
    onError: (error) => {
      console.warn("Iframe auth failed, iframe will show login screen:", error);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <LayoutDashboard className="h-4 w-4" />
          <span>
            Embedded standalone dashboard ({STANDALONE_DASHBOARD_URL})
          </span>
        </div>
        <a
          href={STANDALONE_DASHBOARD_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open in new tab
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-background">
        <iframe
          ref={iframeRef}
          title="Standalone Analytics Dashboard"
          src={STANDALONE_DASHBOARD_URL}
          className="h-[calc(100vh-260px)] w-full border-0"
          loading="lazy"
          onLoad={handleIframeLoad}
        />
      </div>
    </div>
  );
}

export default AnalyticsPage;
