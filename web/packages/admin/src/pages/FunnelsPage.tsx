import { useState, useEffect, useRef, useMemo } from "react";
import { useScopedGameId } from "@/hooks/useScopedGame";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  Calculator,
  Check,
  Cloud,
  CloudOff,
  Filter,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TrendingDown,
  UserCheck,
  X,
  Info,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  type FunnelDefinition,
  type FunnelResult,
  type RetentionResult,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const GLOBAL_CONFIG_SCOPE = "global";

/* ── Toast ────────────────────────────────────────────────────── */

type ToastVariant = "success" | "error" | "info";
interface ToastState { id: number; message: string; variant: ToastVariant }

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);
  const cls =
    toast.variant === "success"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : toast.variant === "error"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-primary/40 bg-primary/10 text-primary";
  return (
    <div className={cn("fixed bottom-6 right-6 z-[9999] flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg", cls)}>
      <span>{toast.message}</span>
      <button onClick={onDone} className="ml-1 opacity-60 hover:opacity-100">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ── Confirm Dialog ───────────────────────────────────────────── */

interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
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
          <button onClick={cfg.onCancel} className="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent">
            Cancel
          </button>
          <button
            ref={btnRef}
            onClick={cfg.onConfirm}
            className={cn("h-9 rounded-md px-4 text-sm font-medium transition-colors",
              cfg.variant === "danger"
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {cfg.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

function parseFunnelSteps(input: string): string[] {
  return input.split(",").map((s) => s.trim()).filter(Boolean);
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/* ── Satori Cloud mirror kill-switch ──────────────────────────────── */

function CloudMirrorCard({
  onConfirm,
  onToast,
}: {
  onConfirm: (cfg: ConfirmDialogState) => void;
  onToast: (msg: string, v: ToastVariant) => void;
}) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["satori", "direct-status"],
    queryFn: () => satori.getSatoriDirectStatus(serverKeyAuth()),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      satori.toggleSatoriDirect(enabled, serverKeyAuth()),
    onSuccess: (_, enabled) => {
      qc.invalidateQueries({ queryKey: ["satori", "direct-status"] });
      onToast(enabled ? "Event mirror enabled" : "Event mirror stopped", "info");
    },
    onError: () => onToast("Failed to toggle mirror", "error"),
  });

  const enabled = status.data?.enabled ?? true;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3",
        enabled
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border bg-card",
      )}
    >
      {enabled ? (
        <Cloud className="h-5 w-5 shrink-0 text-amber-500" />
      ) : (
        <CloudOff className="h-5 w-5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          Satori Cloud event mirror{" "}
          <span
            className={cn(
              "ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
              enabled
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {status.isLoading ? "…" : enabled ? "sending" : "off"}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          Mirrors all QuizVerse events to the paid satoricloud.io instance.
          Toggle takes effect on all pods within ~60s.
        </p>
      </div>
      <button
        onClick={() => {
          const next = !enabled;
          onConfirm({
            title: next ? "Enable Event Mirror?" : "Stop Event Mirror?",
            description: next
              ? "Re-enable event mirroring to the paid Satori Cloud instance."
              : "STOP sending events to Satori Cloud. Satori-side dashboards will go stale.",
            confirmLabel: next ? "Enable" : "Stop Mirror",
            variant: next ? "default" : "danger",
            onConfirm: () => toggle.mutate(next),
            onCancel: () => {},
          });
        }}
        disabled={toggle.isPending || status.isLoading}
        className={cn(
          "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-xs font-medium transition-colors disabled:opacity-50",
          enabled
            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400",
        )}
      >
        {toggle.isPending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : enabled ? (
          <CloudOff className="h-3.5 w-3.5" />
        ) : (
          <Cloud className="h-3.5 w-3.5" />
        )}
        {enabled ? "Turn off mirror" : "Turn on mirror"}
      </button>
    </div>
  );
}

/* ── Funnel results bars ──────────────────────────────────────────── */

function FunnelBars({ result }: { result: FunnelResult }) {
  const isEventVolume = result.basis === "event_volume";
  const label = isEventVolume ? "events" : "users";
  const max = Math.max(...result.steps.map((s) => s.users), 1);

  return (
    <div className="space-y-2">
      {/* Warning: event_volume basis means conversion >100% is expected */}
      {isEventVolume && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>Event volume mode</strong> — counts total event occurrences per step (not distinct users).
            A single user can contribute to multiple steps, so conversion can exceed 100%.
            To see distinct-user funnels, add an experiment ID to segment.
          </span>
        </div>
      )}
      {result.steps.map((s, i) => (
        <div key={`${s.name}-${i}`} className="space-y-0.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-medium">
              {i + 1}. {s.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {s.users.toLocaleString()} {label} · {pct(s.conversionFromStart)} of start
              {i > 0 && !isEventVolume && (s.conversionFromPrevious ?? 1) < 1 && (
                <span className="ml-2 inline-flex items-center gap-0.5 text-rose-500">
                  <ArrowDownRight className="h-3 w-3" />
                  {pct(1 - (s.conversionFromPrevious ?? 1))} drop
                </span>
              )}
            </span>
          </div>
          <div className="h-5 overflow-hidden rounded bg-muted">
            <div
              className={cn(
                "flex h-full items-center rounded px-2 text-[10px] font-bold text-white",
                i === 0 ? "bg-blue-500" : i === result.steps.length - 1 ? "bg-emerald-500" : "bg-violet-500",
              )}
              style={{ width: `${Math.min(Math.max((s.users / max) * 100, 2), 100)}%` }}
            />
          </div>
        </div>
      ))}
      {result.byVariant && (
        <div className="mt-3 overflow-x-auto">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            By experiment variant (conversion from start)
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-1.5 pr-3 font-medium">Variant</th>
                {result.steps.map((s, i) => (
                  <th key={i} className="py-1.5 pr-3 font-mono font-medium">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.byVariant).map(([variant, rows]) => (
                <tr key={variant} className="border-b border-border/50">
                  <td className="py-1.5 pr-3 font-mono font-semibold">{variant}</td>
                  {rows.map((r, i) => (
                    <td key={i} className="py-1.5 pr-3 tabular-nums">
                      {r.users.toLocaleString()}
                      <span className="ml-1 text-muted-foreground">
                        ({pct(r.conversionFromStart)})
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Funnel section ───────────────────────────────────────────────── */

function FunnelSection({
  gameScope,
  onConfirm,
  onToast,
}: {
  gameScope: string;
  onConfirm: (cfg: ConfirmDialogState) => void;
  onToast: (msg: string, v: ToastVariant) => void;
}) {
  const qc = useQueryClient();
  const funnels = useQuery({
    queryKey: ["satori", "funnels", gameScope],
    queryFn: () => satori.listFunnels(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d) => d.funnels ?? [],
  });

  const [stepsInput, setStepsInput] = useState(
    "session_start, media_question_started, media_question_completed",
  );
  const [sinceDays, setSinceDays] = useState(7);
  const [experimentId, setExperimentId] = useState("");
  const [saveName, setSaveName] = useState("");

  // Real logged event names (from the analytics pipeline) so the builder uses
  // actual events instead of guessed placeholders.
  const catalog = useQuery({
    queryKey: ["satori", "event-catalog", gameScope, sinceDays],
    queryFn: () =>
      satori.getEventCatalog({ days: sinceDays, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    select: (d) => d.events ?? [],
    staleTime: 60_000,
  });

  const toggleStep = (name: string) => {
    setStepsInput((prev) => {
      const steps = parseFunnelSteps(prev);
      if (steps.includes(name)) {
        return steps.filter((s) => s !== name).join(", ");
      }
      return [...steps, name].join(", ");
    });
  };

  const selectedStepOrder = useMemo(() => {
    const order = new Map<string, number>();
    parseFunnelSteps(stepsInput).forEach((name, i) => order.set(name, i + 1));
    return order;
  }, [stepsInput]);

  const compute = useMutation({
    mutationFn: (params: Parameters<typeof satori.computeFunnel>[0]) =>
      satori.computeFunnel({ ...params, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
  });

  const save = useMutation({
    mutationFn: () => {
      const steps = parseFunnelSteps(stepsInput);
      const id = saveName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return satori.saveFunnel(
        { id, name: saveName.trim(), steps, game_id: rpcGameId(gameScope) },
        serverKeyAuth(),
      );
    },
    onSuccess: () => {
      setSaveName("");
      qc.invalidateQueries({ queryKey: ["satori", "funnels", gameScope] });
      onToast("Funnel saved!", "success");
    },
    onError: () => onToast("Failed to save funnel", "error"),
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      satori.deleteFunnel({ id, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["satori", "funnels", gameScope] });
      onToast("Funnel deleted", "info");
    },
    onError: () => onToast("Failed to delete funnel", "error"),
  });

  const runAdhoc = () => {
    const steps = parseFunnelSteps(stepsInput);
    if (steps.length < 2) return;
    compute.mutate({
      steps,
      since_ms: Date.now() - sinceDays * 86400_000,
      ...(experimentId.trim() ? { experiment_id: experimentId.trim() } : {}),
    });
  };

  const runSaved = (f: FunnelDefinition) => {
    setStepsInput(f.steps.join(", "));
    compute.mutate({
      funnelId: f.id,
      since_ms: Date.now() - sinceDays * 86400_000,
      ...(experimentId.trim() ? { experiment_id: experimentId.trim() } : {}),
    });
  };

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <Filter className="h-5 w-5 text-primary" />
        Funnels
      </h3>

      {/* Saved funnels */}
      {(funnels.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2">
          {funnels.data!.map((f) => (
            <span
              key={f.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs"
            >
              <button
                onClick={() => runSaved(f)}
                className="font-medium hover:text-primary"
                title={f.steps.join(" → ")}
              >
                {f.name}
              </button>
              <button
                onClick={() => onConfirm({
                  title: "Delete Funnel?",
                  description: `"${f.name}" will be permanently removed.`,
                  confirmLabel: "Delete",
                  variant: "danger",
                  onConfirm: () => del.mutate(f.id),
                  onCancel: () => {},
                })}
                className="rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Builder */}
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Steps (comma-separated event names, in order)
          </label>
          <input
            value={stepsInput}
            onChange={(e) => setStepsInput(e.target.value)}
            placeholder="session_start, media_question_started, media_question_completed"
            className="h-9 w-full rounded-md border border-border bg-background px-3 font-mono text-xs outline-none focus:border-primary"
          />
          {(catalog.data?.length ?? 0) > 0 && (
            <div className="mt-2">
              <p className="mb-1 text-[11px] text-muted-foreground">
                Click to add or remove a step ({sinceDays}d volume). Selected chips show funnel order.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {catalog.data!.slice(0, 24).map((ev) => {
                  const stepOrder = selectedStepOrder.get(ev.name);
                  const isSelected = stepOrder !== undefined;
                  return (
                    <button
                      key={ev.name}
                      type="button"
                      onClick={() => toggleStep(ev.name)}
                      aria-pressed={isSelected}
                      title={
                        isSelected
                          ? `Step ${stepOrder} — click to remove · ${ev.count.toLocaleString()} events (${sinceDays}d)`
                          : `${ev.count.toLocaleString()} events (${sinceDays}d) — click to add`
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors",
                        isSelected
                          ? "border-primary/70 bg-primary/15 font-medium text-primary shadow-sm hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          : "border-border bg-background text-muted-foreground hover:border-primary hover:text-primary",
                      )}
                    >
                      {isSelected ? (
                        <Check className="h-3 w-3 shrink-0" aria-hidden />
                      ) : null}
                      <span>{ev.name}</span>
                      {isSelected && (
                        <span className="rounded bg-primary/20 px-1 text-[9px] font-semibold tabular-nums">
                          {stepOrder}
                        </span>
                      )}
                      <span className={cn("text-[9px] tabular-nums", isSelected ? "opacity-80" : "opacity-60")}>
                        {ev.count.toLocaleString()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Last
            <select
              value={sinceDays}
              onChange={(e) => setSinceDays(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value={1}>1 day</option>
              <option value={3}>3 days</option>
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <input
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
            placeholder="Segment by experiment ID (optional)"
            className="h-8 w-64 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none placeholder:font-sans focus:border-primary"
          />
          <button
            onClick={runAdhoc}
            disabled={compute.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {compute.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Calculator className="h-3.5 w-3.5" />
            )}
            Compute
          </button>
          <div className="ml-auto flex items-center gap-2">
            <input
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Save as..."
              className="h-8 w-36 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-primary"
            />
            <button
              onClick={() => saveName.trim() && save.mutate()}
              disabled={!saveName.trim() || save.isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {save.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save
            </button>
          </div>
        </div>

        {compute.isError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {compute.error instanceof Error ? compute.error.message : "Compute failed"}
          </p>
        )}

        {compute.data && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {compute.data.entered.toLocaleString()} entered ·{" "}
              {compute.data.completed.toLocaleString()} completed ·{" "}
              <span className="font-semibold text-foreground">
                {pct(compute.data.overallConversion)} overall
              </span>
              {compute.data.truncated && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  partial scan
                </span>
              )}
            </p>
            <FunnelBars result={compute.data} />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Retention section ────────────────────────────────────────────── */

function RetentionSection({ gameScope }: { gameScope: string }) {
  const [days, setDays] = useState(14);
  const [experimentId, setExperimentId] = useState("");

  const compute = useMutation({
    mutationFn: () =>
      satori.computeRetention(
        {
          days,
          ...(experimentId.trim() ? { experiment_id: experimentId.trim() } : {}),
          game_id: rpcGameId(gameScope),
        },
        serverKeyAuth(),
      ),
  });

  const data: RetentionResult | undefined = compute.data;

  return (
    <section className="space-y-4">
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <UserCheck className="h-5 w-5 text-primary" />
        Retention cohorts
      </h3>

      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Window
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value={7}>7 days</option>
              <option value={14}>14 days</option>
              <option value={30}>30 days</option>
            </select>
          </label>
          <input
            value={experimentId}
            onChange={(e) => setExperimentId(e.target.value)}
            placeholder="Segment by experiment ID (optional)"
            className="h-8 w-64 rounded-md border border-border bg-background px-2 font-mono text-xs outline-none placeholder:font-sans focus:border-primary"
          />
          <button
            onClick={() => compute.mutate()}
            disabled={compute.isPending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {compute.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            Compute
          </button>
        </div>

        {compute.isError && (
          <p className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {compute.error instanceof Error ? compute.error.message : "Compute failed"}
          </p>
        )}

        {data && (
          <div className="space-y-4 border-t border-border pt-3">
            {(data.basis === "active_user_rolling" || data.source === "analytics_pipeline") && (
              <div className="flex items-start gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-700 dark:text-blue-300">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>Rolling active-user retention</strong> — each row is users active on that date;
                  D1/D3/D7 = share who were also active 1/3/7 days later. Not new-user install cohorts.
                </span>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {data.totalUsers.toLocaleString()} active users in window ·{" "}
              {data.scannedRecords.toLocaleString()} events scanned
              {data.truncated && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  partial scan — window-relative figures
                </span>
              )}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1.5 pr-4 font-medium">Date (active users)</th>
                    <th className="py-1.5 pr-4 font-medium">Users</th>
                    <th className="py-1.5 pr-4 font-medium">D1</th>
                    <th className="py-1.5 pr-4 font-medium">D3</th>
                    <th className="py-1.5 pr-4 font-medium">D7</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cohorts.map((c) => (
                    <tr key={c.date} className="border-b border-border/50">
                      <td className="py-1.5 pr-4 font-mono">{c.date}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{c.size.toLocaleString()}</td>
                      {[c.d1Rate, c.d3Rate, c.d7Rate].map((rate, i) => (
                        <td key={i} className="py-1.5 pr-4">
                          {rate === null ? (
                            <span className="text-muted-foreground/50">—</span>
                          ) : (
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 font-medium tabular-nums",
                                rate >= 0.4
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : rate >= 0.2
                                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                    : "bg-rose-500/10 text-rose-600 dark:text-rose-400",
                              )}
                            >
                              {pct(rate)}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {data.byVariant && data.byVariant.length > 0 && (
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  By experiment variant
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-left text-muted-foreground">
                        <th className="py-1.5 pr-4 font-medium">Variant</th>
                        <th className="py-1.5 pr-4 font-medium">Users</th>
                        <th className="py-1.5 pr-4 font-medium">D1</th>
                        <th className="py-1.5 pr-4 font-medium">D3</th>
                        <th className="py-1.5 pr-4 font-medium">D7</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byVariant.map((v) => (
                        <tr key={v.variantId} className="border-b border-border/50">
                          <td className="py-1.5 pr-4 font-mono font-semibold">{v.variantId}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{v.size.toLocaleString()}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{pct(v.d1Rate)}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{pct(v.d3Rate)}</td>
                          <td className="py-1.5 pr-4 tabular-nums">{pct(v.d7Rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Main page ────────────────────────────────────────────────────── */

export function FunnelsPage() {
  const gameScope = useScopedGameId() ?? GLOBAL_CONFIG_SCOPE;
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Filter className="h-6 w-6 text-primary" />
            Funnels &amp; Retention
          </h2>
          <p className="text-muted-foreground">
            Conversion funnels and D1/D3/D7 cohorts from captured events —
            optionally segmented by experiment variant.
          </p>
        </div>
      </div>

      <CloudMirrorCard onConfirm={openConfirm} onToast={showToast} />
      <FunnelSection gameScope={gameScope} onConfirm={openConfirm} onToast={showToast} />
      <RetentionSection gameScope={gameScope} />

      {confirmDialog && <ConfirmDialog cfg={confirmDialog} />}
      {toast && <Toast key={toast.id} toast={toast} onDone={() => setToast(null)} />}
    </div>
  );
}

export default FunnelsPage;
