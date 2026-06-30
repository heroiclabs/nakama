import { useState, useEffect, useRef } from "react";
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
  Trash2,
  AlertTriangle,
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
import { useScopedGameId } from "@/hooks/useScopedGame";
import { cn } from "@/lib/utils";

const AGGREGATIONS = ["count", "sum", "avg", "min", "max", "unique"] as const;
const GLOBAL_CONFIG_SCOPE = "global";

function rpcGameId(scope: string) {
  const t = scope.trim();
  return t && t !== GLOBAL_CONFIG_SCOPE ? t : undefined;
}

/* ── Toast ───────────────────────────────────────────────────── */

type ToastVariant = "success" | "error" | "info";
interface ToastState { id: number; message: string; variant: ToastVariant }

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 3500); return () => clearTimeout(t); }, [onDone]);
  const cls = toast.variant === "success"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
    : toast.variant === "error"
    ? "border-destructive/40 bg-destructive/10 text-destructive"
    : "border-primary/40 bg-primary/10 text-primary";
  return (
    <div className={cn("fixed bottom-6 right-6 z-[9999] flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg", cls)}>
      <span>{toast.message}</span>
      <button onClick={onDone} className="ml-1 opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
    </div>
  );
}

/* ── Confirm Dialog ──────────────────────────────────────────── */

interface ConfirmDialogState {
  title: string; description: string; confirmLabel?: string;
  variant?: "default" | "danger"; onConfirm: () => void; onCancel: () => void;
}

function ConfirmDialog({ cfg }: { cfg: ConfirmDialogState }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { btnRef.current?.focus(); }, []);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") cfg.onCancel(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cfg]);
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/60">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-2xl">
        <h4 className="text-base font-semibold">{cfg.title}</h4>
        <p className="mt-1 text-sm text-muted-foreground">{cfg.description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={cfg.onCancel} className="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent">Cancel</button>
          <button ref={btnRef} onClick={cfg.onConfirm}
            className={cn("h-9 rounded-md px-4 text-sm font-medium transition-colors",
              cfg.variant === "danger" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}>
            {cfg.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function useMetricsList(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "metrics", "list", gameScope],
    queryFn: () => satori.queryMetrics(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d) => d.metrics ?? [],
    retry: 1,
  });
}

function useAlerts(gameScope: string) {
  return useQuery({
    queryKey: ["admin", "metrics", "alerts", gameScope],
    queryFn: () => satori.listMetricAlerts(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d) => d.alerts ?? [],
    retry: 1,
  });
}

function useDeleteMetric(gameScope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (metricId: string) =>
      satori.deleteMetric({ id: metricId, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "metrics", "list", gameScope] }),
  });
}

function DefineMetricForm({ onClose, gameScope, onToast }: { onClose: () => void; gameScope: string; onToast: (msg: string, v: ToastVariant) => void }) {
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
          game_id: rpcGameId(gameScope),
        },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "metrics", "list", gameScope] });
      onToast(`Metric "${name.trim()}" defined!`, "success");
      onClose();
    },
    onError: () => onToast("Failed to define metric", "error"),
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

function AlertForm({ metricId, onClose, gameScope, onToast }: { metricId: string; onClose: () => void; gameScope: string; onToast: (msg: string, v: ToastVariant) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState("");
  const [operator, setOperator] = useState<"gt" | "lt" | "gte" | "lte">("gt");

  const setAlert = useMutation({
    mutationFn: () =>
      satori.setMetricAlert(
        { metric_id: metricId, name: name.trim(), threshold: parseFloat(threshold) || 0, operator, game_id: rpcGameId(gameScope) },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "metrics", "alerts", gameScope] });
      onToast("Alert saved!", "success");
      onClose();
    },
    onError: () => onToast("Failed to save alert", "error"),
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

function MetricSeriesChart({ metricId, gameScope }: { metricId: string; gameScope: string }) {
  const series = useQuery({
    queryKey: ["admin", "metrics", "series", metricId, gameScope],
    queryFn: () => satori.getMetricSeries({ metricId, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
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
  const gameScope = useScopedGameId() ?? GLOBAL_CONFIG_SCOPE;
  const metrics = useMetricsList(gameScope);
  const alerts = useAlerts(gameScope);
  const delMetric = useDeleteMetric(gameScope);
  const qc = useQueryClient();

  const [selected, setSelected] = useState<string | null>(null);
  const [showDefine, setShowDefine] = useState(false);
  const [alertFor, setAlertFor] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const toastId = useRef(0);

  function showToast(message: string, variant: ToastVariant = "info") {
    setToast({ id: ++toastId.current, message, variant });
  }

  function openConfirm(cfg: ConfirmDialogState) {
    setConfirmDialog({
      ...cfg,
      onConfirm: () => { setConfirmDialog(null); cfg.onConfirm(); },
      onCancel: () => { setConfirmDialog(null); cfg.onCancel(); },
    });
  }

  const list = metrics.data ?? [];
  const active = selected ?? list[0]?.metricId ?? null;

  function formatValue(v: number) {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v % 1 === 0 ? v.toLocaleString() : v.toFixed(2);
  }

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
              <div key={m.metricId} className="group relative">
                <button
                  onClick={() => setSelected(m.metricId)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border p-3 pr-9 text-left transition-colors",
                    active === m.metricId ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-accent",
                  )}
                >
                  <span className="font-mono text-sm font-medium">{m.metricId}</span>
                  <span className={cn("text-lg font-bold tabular-nums", m.value === 0 ? "text-muted-foreground" : "text-foreground")}>
                    {formatValue(m.value)}
                  </span>
                </button>
                {/* Delete button (only non-legacy metrics) */}
                {!m.metricId.startsWith("legacy_") && (
                  <button
                    onClick={() => openConfirm({
                      title: "Delete Metric?",
                      description: `"${m.metricId}" and all its history will be removed.`,
                      confirmLabel: "Delete",
                      variant: "danger",
                      onConfirm: () => {
                        delMetric.mutate(m.metricId, {
                          onSuccess: () => { showToast(`Metric "${m.metricId}" deleted`, "info"); if (active === m.metricId) setSelected(null); },
                          onError: () => showToast("Failed to delete metric", "error"),
                        });
                      },
                      onCancel: () => {},
                    })}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    title="Delete metric"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Detail */}
          <div className="space-y-4">
            {active && <MetricSeriesChart metricId={active} gameScope={gameScope} />}
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
                          {a.operator === "gt" ? ">" : a.operator === "gte" ? "≥" : a.operator === "lt" ? "<" : "≤"} {a.threshold.toLocaleString()}
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

      {showDefine && <DefineMetricForm onClose={() => setShowDefine(false)} gameScope={gameScope} onToast={showToast} />}
      {alertFor && <AlertForm metricId={alertFor} onClose={() => setAlertFor(null)} gameScope={gameScope} onToast={showToast} />}

      {confirmDialog && <ConfirmDialog cfg={confirmDialog} />}
      {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

export default MetricsPage;
