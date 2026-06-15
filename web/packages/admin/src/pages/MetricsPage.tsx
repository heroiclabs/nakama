import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gauge,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Check,
  BellRing,
  Activity,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { serverKeyAuth, satori } from "@nakama/shared";
import { cn } from "@/lib/utils";

const AGGREGATIONS = ["count", "sum", "avg", "min", "max", "unique"] as const;

function useMetricsList() {
  return useQuery({
    queryKey: ["admin", "metrics", "list"],
    queryFn: () => satori.queryMetrics(serverKeyAuth()),
    select: (d) => d.metrics ?? [],
    retry: 1,
  });
}

function useAlerts() {
  return useQuery({
    queryKey: ["admin", "metrics", "alerts"],
    queryFn: () => satori.listMetricAlerts(serverKeyAuth()),
    select: (d) => d.alerts ?? [],
    retry: 1,
  });
}

function DefineMetricForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [eventName, setEventName] = useState("");
  const [aggregation, setAggregation] = useState<string>("count");
  const [metadataField, setMetadataField] = useState("");
  const [windowSec, setWindowSec] = useState("");

  const define = useMutation({
    mutationFn: () =>
      satori.defineMetric(
        {
          id: id.trim(),
          name: name.trim(),
          eventName: eventName.trim(),
          aggregation,
          metadataField: metadataField.trim() || undefined,
          windowSec: windowSec ? parseInt(windowSec, 10) : undefined,
        },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "metrics"] });
      onClose();
    },
  });

  const needsField = aggregation === "sum" || aggregation === "avg" || aggregation === "min" || aggregation === "max";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => { e.preventDefault(); define.mutate(); }}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Define Metric</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Metric ID</label>
              <input required value={id} onChange={(e) => setId(e.target.value)} placeholder="dau" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Display name</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily Active Users" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Source event</label>
            <input required value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="session_start" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Aggregation</label>
              <select value={aggregation} onChange={(e) => setAggregation(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                {AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Window (sec)</label>
              <input value={windowSec} onChange={(e) => setWindowSec(e.target.value)} placeholder="86400 = daily" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
            </div>
          </div>
          {needsField && (
            <div>
              <label className="mb-1.5 block text-sm font-medium">Metadata field <span className="font-normal text-muted-foreground">(numeric value to {aggregation})</span></label>
              <input value={metadataField} onChange={(e) => setMetadataField(e.target.value)} placeholder="amount" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
            </div>
          )}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
          <button type="submit" disabled={!id.trim() || !name.trim() || !eventName.trim() || define.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {define.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

function AlertForm({ metricId, onClose }: { metricId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [operator, setOperator] = useState<"gt" | "lt" | "gte" | "lte">("gt");

  const setAlert = useMutation({
    mutationFn: () =>
      satori.setMetricAlert(
        { metric_id: metricId, name: name.trim(), threshold: parseFloat(threshold) || 0, operator },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "metrics", "alerts"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form onSubmit={(e) => { e.preventDefault(); setAlert.mutate(); }} className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Alert on <span className="font-mono text-primary">{metricId}</span></h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Alert name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="DAU dropped" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Condition</label>
              <select value={operator} onChange={(e) => setOperator(e.target.value as typeof operator)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary">
                <option value="gt">greater than</option>
                <option value="gte">≥</option>
                <option value="lt">less than</option>
                <option value="lte">≤</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Threshold</label>
              <input required value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="100" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
            </div>
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
          <button type="submit" disabled={!name.trim() || setAlert.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {setAlert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save Alert
          </button>
        </div>
      </form>
    </div>
  );
}

function MetricSeriesChart({ metricId }: { metricId: string }) {
  const series = useQuery({
    queryKey: ["admin", "metrics", "series", metricId],
    queryFn: () => satori.getMetricSeries({ metricId }, serverKeyAuth()),
    retry: 1,
  });

  const points = (series.data?.points ?? []).map((p) => ({
    label: p.bucketSec ? new Date(p.bucketSec * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "all",
    value: p.value,
  }));

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{series.data?.definition?.name ?? metricId}</h3>
        {series.data?.definition && (
          <span className="text-xs text-muted-foreground">
            {series.data.definition.aggregation} of {series.data.definition.eventName}
          </span>
        )}
      </div>
      {series.isLoading ? (
        <div className="flex h-52 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : points.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">No data points yet for this metric.</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={points} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="metricGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(263 70% 60%)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="hsl(263 70% 60%)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(217 10% 64%)" }} />
            <YAxis tick={{ fontSize: 11, fill: "hsl(217 10% 64%)" }} />
            <Tooltip contentStyle={{ background: "hsl(222 47% 11%)", border: "1px solid hsl(215 28% 17%)", borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="value" stroke="hsl(263 70% 60%)" strokeWidth={2} fill="url(#metricGrad)" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

export function MetricsPage() {
  const metrics = useMetricsList();
  const alerts = useAlerts();
  const [selected, setSelected] = useState<string | null>(null);
  const [showDefine, setShowDefine] = useState(false);
  const [alertFor, setAlertFor] = useState<string | null>(null);

  const list = metrics.data ?? [];
  const active = selected ?? list[0]?.metricId ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Metrics</h2>
          <p className="text-muted-foreground">Event-derived metrics, time series, and alerts.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { metrics.refetch(); alerts.refetch(); }} disabled={metrics.isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", metrics.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => setShowDefine(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Define Metric
          </button>
        </div>
      </div>

      {metrics.isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <Gauge className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">No metrics defined</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Define a metric to start tracking event-derived values.</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Metric list */}
          <div className="space-y-2">
            {list.map((m) => (
              <button
                key={m.metricId}
                onClick={() => setSelected(m.metricId)}
                className={cn(
                  "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                  active === m.metricId ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
                )}
              >
                <span className="font-mono text-sm font-medium">{m.metricId}</span>
                <span className="text-lg font-bold tabular-nums">{m.value}</span>
              </button>
            ))}
          </div>

          {/* Detail */}
          <div className="space-y-4">
            {active && <MetricSeriesChart metricId={active} />}
            {active && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BellRing className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold">Alerts</h3>
                  </div>
                  <button onClick={() => setAlertFor(active)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Plus className="h-3 w-3" /> Add alert
                  </button>
                </div>
                {(alerts.data ?? []).filter((a) => a.metricId === active).length === 0 ? (
                  <p className="py-4 text-center text-sm text-muted-foreground">No alerts on this metric.</p>
                ) : (
                  <div className="space-y-2">
                    {(alerts.data ?? []).filter((a) => a.metricId === active).map((a) => (
                      <div key={a.name} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2 text-sm">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {a.operator === "gt" ? ">" : a.operator === "gte" ? "≥" : a.operator === "lt" ? "<" : "≤"} {a.threshold}
                          <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[10px] uppercase", a.enabled ? "bg-emerald-500/10 text-emerald-500" : "bg-muted text-muted-foreground")}>
                            {a.enabled ? "on" : "off"}
                          </span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {showDefine && <DefineMetricForm onClose={() => setShowDefine(false)} />}
      {alertFor && <AlertForm metricId={alertFor} onClose={() => setAlertFor(null)} />}
    </div>
  );
}

export default MetricsPage;
