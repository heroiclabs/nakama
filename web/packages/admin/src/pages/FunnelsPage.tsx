import { useState } from "react";
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

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

function pct(v: number | null | undefined) {
  if (v === null || v === undefined) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

/* ── Satori Cloud mirror kill-switch ──────────────────────────────── */

function CloudMirrorCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["satori", "direct-status"],
    queryFn: () => satori.getSatoriDirectStatus(serverKeyAuth()),
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) =>
      satori.toggleSatoriDirect(enabled, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["satori", "direct-status"] }),
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
          if (
            !window.confirm(
              next
                ? "Re-enable event mirroring to Satori Cloud?"
                : "STOP sending events to the paid Satori Cloud instance? Satori-side dashboards will go stale.",
            )
          )
            return;
          toggle.mutate(next);
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
  const max = Math.max(result.entered, 1);
  return (
    <div className="space-y-2">
      {result.steps.map((s, i) => (
        <div key={`${s.name}-${i}`} className="space-y-0.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono font-medium">
              {i + 1}. {s.name}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {s.users.toLocaleString()} users · {pct(s.conversionFromStart)} of start
              {i > 0 && (
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
              style={{ width: `${Math.max((s.users / max) * 100, 2)}%` }}
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

function FunnelSection({ gameScope }: { gameScope: string }) {
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

  const appendStep = (name: string) => {
    setStepsInput((prev) => {
      const steps = prev.split(",").map((s) => s.trim()).filter(Boolean);
      if (steps.includes(name)) return prev;
      return [...steps, name].join(", ");
    });
  };

  const compute = useMutation({
    mutationFn: (params: Parameters<typeof satori.computeFunnel>[0]) =>
      satori.computeFunnel({ ...params, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
  });

  const save = useMutation({
    mutationFn: () => {
      const steps = stepsInput.split(",").map((s) => s.trim()).filter(Boolean);
      const id = saveName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return satori.saveFunnel(
        { id, name: saveName.trim(), steps, game_id: rpcGameId(gameScope) },
        serverKeyAuth(),
      );
    },
    onSuccess: () => {
      setSaveName("");
      qc.invalidateQueries({ queryKey: ["satori", "funnels", gameScope] });
    },
  });

  const del = useMutation({
    mutationFn: (id: string) =>
      satori.deleteFunnel({ id, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["satori", "funnels", gameScope] }),
  });

  const runAdhoc = () => {
    const steps = stepsInput.split(",").map((s) => s.trim()).filter(Boolean);
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
                onClick={() => window.confirm(`Delete funnel "${f.name}"?`) && del.mutate(f.id)}
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
                Click to add a real logged event ({sinceDays}d volume):
              </p>
              <div className="flex flex-wrap gap-1.5">
                {catalog.data!.slice(0, 24).map((ev) => (
                  <button
                    key={ev.name}
                    type="button"
                    onClick={() => appendStep(ev.name)}
                    title={`${ev.count.toLocaleString()} events`}
                    className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    {ev.name}
                    <span className="text-[9px] opacity-60">{ev.count.toLocaleString()}</span>
                  </button>
                ))}
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
                    <th className="py-1.5 pr-4 font-medium">Cohort (first active)</th>
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
  const [gameScope, setGameScope] = useState(GLOBAL_CONFIG_SCOPE);

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
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Game ID
          <input
            value={gameScope}
            onChange={(e) => setGameScope(e.target.value || GLOBAL_CONFIG_SCOPE)}
            placeholder="global or quizverse"
            className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
          />
        </label>
      </div>

      <CloudMirrorCard />
      <FunnelSection gameScope={gameScope} />
      <RetentionSection gameScope={gameScope} />
    </div>
  );
}

export default FunnelsPage;
