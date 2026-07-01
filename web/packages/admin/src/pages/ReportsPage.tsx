import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FileBarChart,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Check,
  Trash2,
  Play,
  Filter,
  UserCheck,
  Gauge,
  CalendarRange,
  AlertTriangle,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  type SavedReport,
  type ReportType,
  type FunnelResult,
  type RetentionResult,
} from "@nakama/shared";
import { useScopedGameId } from "@/hooks/useScopedGame";
import { cn } from "@/lib/utils";

/* ── Toast ─────────────────────────────────────────────────────────── */

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
    </div>
  );
}

/* ── ConfirmDialog ──────────────────────────────────────────────────── */

function ConfirmDialog({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm">{message}</p>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium text-muted-foreground hover:bg-accent">Cancel</button>
          <button onClick={onConfirm} className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">Delete</button>
        </div>
      </div>
    </div>
  );
}

const TYPE_META: Record<ReportType, { icon: React.ElementType; label: string; color: string }> = {
  funnel: { icon: Filter, label: "Funnel", color: "text-violet-500" },
  retention: { icon: UserCheck, label: "Retention", color: "text-blue-500" },
  metric: { icon: Gauge, label: "Metric", color: "text-emerald-500" },
  timeline: { icon: CalendarRange, label: "Timeline", color: "text-amber-500" },
};

function useReports(gameId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "reports", gameId ?? "global"],
    queryFn: () => satori.listReports(serverKeyAuth(), gameId),
    select: (d) => d.reports ?? [],
    retry: 1,
  });
}

/* ── Builder ──────────────────────────────────────────────────────── */

function ReportForm({ onClose, onToast, gameId }: { onClose: () => void; onToast: (msg: string, v: ToastVariant) => void; gameId: string | undefined }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<ReportType>("funnel");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [windowHours, setWindowHours] = useState("24");
  const [days, setDays] = useState("14");
  const [metricId, setMetricId] = useState("");
  const [validationError, setValidationError] = useState("");

  const save = useMutation({
    mutationFn: () => {
      setValidationError("");
      let params: Record<string, unknown> = {};
      if (type === "funnel") {
        const parsedSteps = steps.split(",").map((s) => s.trim()).filter(Boolean);
        if (parsedSteps.length < 2) {
          setValidationError("Funnel requires at least 2 steps.");
          throw new Error("validation");
        }
        params = { steps: parsedSteps, window_hours: parseInt(windowHours, 10) || 24 };
      } else if (type === "retention" || type === "timeline") {
        params = { days: parseInt(days, 10) || 14 };
      } else if (type === "metric") {
        if (!metricId.trim()) {
          setValidationError("Metric ID is required.");
          throw new Error("validation");
        }
        params = { metricId: metricId.trim() };
      }
      return satori.saveReport({ name: name.trim(), type, description: description.trim(), params, game_id: gameId }, serverKeyAuth());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports", gameId ?? "global"] });
      onToast("Report saved", "success");
      onClose();
    },
    onError: (err) => {
      if ((err as Error).message !== "validation") {
        onToast("Failed to save report", "error");
      }
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">New Report</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Report name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Onboarding funnel — weekly" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Type</label>
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(TYPE_META) as ReportType[]).map((t) => {
                const M = TYPE_META[t];
                return (
                  <button key={t} type="button" onClick={() => setType(t)} className={cn("flex flex-col items-center gap-1 rounded-md border p-2 text-xs", type === t ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-accent")}>
                    <M.icon className="h-4 w-4" />
                    {M.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>

          {/* Type-specific params */}
          {type === "funnel" && (
            <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Steps <span className="font-normal text-muted-foreground">(event names, in order)</span></label>
                <input value={steps} onChange={(e) => setSteps(e.target.value)} placeholder="app_open, quiz_start, quiz_complete" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Window (hours)</label>
                <input value={windowHours} onChange={(e) => setWindowHours(e.target.value)} className="h-10 w-32 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
              </div>
            </div>
          )}
          {(type === "retention" || type === "timeline") && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <label className="mb-1.5 block text-sm font-medium">Days</label>
              <input value={days} onChange={(e) => setDays(e.target.value)} className="h-10 w-32 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
            </div>
          )}
          {type === "metric" && (
            <div className="rounded-md border border-border bg-muted/20 p-3">
              <label className="mb-1.5 block text-sm font-medium">Metric ID</label>
              <input value={metricId} onChange={(e) => setMetricId(e.target.value)} placeholder="dau" className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary" />
            </div>
          )}
        </div>
        {validationError && (
          <p className="mt-3 flex items-center gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {validationError}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
          <button type="submit" disabled={!name.trim() || save.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save Report
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Runner ───────────────────────────────────────────────────────── */

function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function ReportResult({ report, gameId }: { report: SavedReport; gameId: string | undefined }) {
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const run = useQuery({
    queryKey: ["admin", "report-run", report.id, gameId],
    enabled: false,
    retry: 0,
    queryFn: async () => {
      const opts = serverKeyAuth();
      const p = report.params as Record<string, unknown>;
      const scope = gameId ? { game_id: gameId } : {};
      if (report.type === "funnel") {
        return { kind: "funnel" as const, data: await satori.computeFunnel({ steps: p.steps as string[], window_hours: p.window_hours as number, ...scope }, opts) };
      }
      if (report.type === "retention") {
        return { kind: "retention" as const, data: await satori.computeRetention({ days: p.days as number, ...scope }, opts) };
      }
      if (report.type === "metric") {
        return { kind: "metric" as const, data: await satori.getMetricSeries({ metricId: p.metricId as string, ...scope }, opts) };
      }
      return { kind: "timeline" as const, data: await satori.getTimeline({ days: p.days as number, ...scope }, opts) };
    },
  });

  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => { run.refetch(); setLastRunAt(Date.now()); }}
          disabled={run.isFetching}
          className="inline-flex h-8 items-center gap-2 rounded-md bg-primary/10 px-3 text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-50"
        >
          {run.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run report
        </button>
        {lastRunAt && !run.isFetching && (
          <span className="text-[11px] text-muted-foreground">
            Last run {new Date(lastRunAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {run.isError && <p className="mt-2 text-xs text-destructive">Failed: {run.error instanceof Error ? run.error.message : "error"}</p>}

      {run.data?.kind === "funnel" && (() => {
        const r = run.data.data as FunnelResult;
        return (
          <div className="mt-3 space-y-1.5">
            <p className="text-xs text-muted-foreground">{r.entered} entered · {r.completed} completed · <span className="font-semibold text-foreground">{pct(r.overallConversion)}</span> overall</p>
            {r.steps.map((s, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-between text-xs"><span className="font-mono">{s.name}</span><span className="tabular-nums text-muted-foreground">{s.users} · {pct(s.conversionFromStart)}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${(s.conversionFromStart || 0) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        );
      })()}

      {run.data?.kind === "retention" && (() => {
        const r = run.data.data as RetentionResult;
        const avg = (key: "d1Rate" | "d3Rate" | "d7Rate") => {
          const vals = r.cohorts.map((c) => c[key]).filter((v): v is number => v !== null);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        };
        return (
          <div className="mt-3 flex gap-4 text-xs">
            <div><span className="text-muted-foreground">D1</span> <span className="font-semibold">{pct(avg("d1Rate"))}</span></div>
            <div><span className="text-muted-foreground">D3</span> <span className="font-semibold">{pct(avg("d3Rate"))}</span></div>
            <div><span className="text-muted-foreground">D7</span> <span className="font-semibold">{pct(avg("d7Rate"))}</span></div>
            <div className="text-muted-foreground">· {r.totalUsers} users · {r.cohorts.length} cohorts</div>
          </div>
        );
      })()}

      {run.data?.kind === "metric" && (() => {
        const r = run.data.data;
        const latest = r.points[r.points.length - 1];
        return <p className="mt-3 text-sm">Latest: <span className="text-2xl font-bold tabular-nums">{latest ? latest.value : "—"}</span> <span className="text-xs text-muted-foreground">({r.points.length} points)</span></p>;
      })()}

      {run.data?.kind === "timeline" && (() => {
        const r = run.data.data;
        const peak = r.dau.reduce((m, d) => Math.max(m, d.users), 0);
        const total = r.dau.reduce((s, d) => s + d.events, 0);
        return <p className="mt-3 text-xs text-muted-foreground">Peak DAU <span className="font-semibold text-foreground">{peak}</span> · {total} events · {r.activities.length} activities over {r.days} days</p>;
      })()}
    </div>
  );
}

/* ── Page ─────────────────────────────────────────────────────────── */

export function ReportsPage() {
  const qc = useQueryClient();
  const gameId = useScopedGameId();
  const reports = useReports(gameId);
  const [showForm, setShowForm] = useState(false);
  const counterRef = useRef(0);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<{ message: string; onConfirm: () => void } | null>(null);

  function showToast(message: string, variant: ToastVariant = "success") {
    setToast({ id: ++counterRef.current, message, variant });
  }

  function openConfirm(message: string, onConfirm: () => void) {
    setConfirmState({ message, onConfirm });
  }

  const del = useMutation({
    mutationFn: (id: string) => satori.deleteReport(id, serverKeyAuth(), gameId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports", gameId ?? "global"] });
      showToast("Report deleted", "success");
    },
    onError: () => showToast("Failed to delete report", "error"),
  });

  const list = reports.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Reports</h2>
            {gameId && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {gameId}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">Saved funnel, retention, metric, and timeline queries you can re-run.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => reports.refetch()} disabled={reports.isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", reports.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            New Report
          </button>
        </div>
      </div>

      {reports.isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <FileBarChart className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">No saved reports</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Save a funnel, retention, metric, or timeline query to re-run it anytime.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((r) => {
            const M = TYPE_META[r.type];
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-muted p-2"><M.icon className={cn("h-4 w-4", M.color)} /></div>
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">{M.label}{r.description ? ` · ${r.description}` : ""}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => openConfirm(`Delete report "${r.name}"?`, () => del.mutate(r.id))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ReportResult report={r} gameId={gameId} />
              </div>
            );
          })}
        </div>
      )}

      {showForm && <ReportForm onClose={() => setShowForm(false)} onToast={showToast} gameId={gameId} />}

      {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast(null)} />}
      {confirmState && (
        <ConfirmDialog
          message={confirmState.message}
          onConfirm={() => { confirmState.onConfirm(); setConfirmState(null); }}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );
}

export default ReportsPage;
