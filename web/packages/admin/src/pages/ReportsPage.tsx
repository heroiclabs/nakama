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
  Route,
  AlertTriangle,
  Users,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  onboarding,
  type SavedReport,
  type OnboardingFunnelAnalyticsParams,
} from "@nakama/shared";
import { useScopedGameId, useActiveApp } from "@/hooks/useScopedGame";
import { OnboardingReportDashboard } from "@/components/onboarding/OnboardingReportDashboard";
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

/* ── Params / filters ─────────────────────────────────────────────── */

export interface OnboardingReportParams {
  days: number;
  pathway?: string;
  platform?: string;
  status?: string;
  welcome_theme?: string;
  user_limit?: number;
}

const DAY_OPTIONS = [7, 14, 30, 60, 90] as const;

const PATHWAY_OPTIONS = [
  { value: "", label: "All pathways" },
  { value: "warrior", label: "Warrior" },
  { value: "scholar", label: "Scholar" },
  { value: "explorer", label: "Explorer" },
  { value: "creator", label: "Creator" },
];

const PLATFORM_OPTIONS = [
  { value: "", label: "All platforms" },
  { value: "unity_webview", label: "Unity WebView" },
  { value: "ios_web", label: "iOS web" },
  { value: "android_web", label: "Android web" },
  { value: "desktop_web", label: "Desktop web" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "completed", label: "Onboarding done" },
  { value: "returned_to_app", label: "Returned to app" },
  { value: "dropped", label: "Dropped" },
  { value: "at_paywall", label: "At paywall" },
  { value: "subscribed", label: "Subscribed" },
  { value: "pre_register", label: "Guest (no account)" },
];

const THEME_OPTIONS = [
  { value: "", label: "All themes" },
  { value: "v1", label: "v1 (dark)" },
  { value: "lavender", label: "Lavender" },
];

function paramsToRpcPayload(params: OnboardingReportParams, gameId?: string): OnboardingFunnelAnalyticsParams {
  const body: OnboardingFunnelAnalyticsParams = {
    days: params.days || 30,
    user_limit: params.user_limit ?? 500,
  };
  if (params.pathway) body.pathway = params.pathway;
  if (params.platform) body.platform = params.platform;
  if (params.status) body.status = params.status;
  if (params.welcome_theme) body.welcome_theme = params.welcome_theme;
  if (gameId) body.game_id = gameId;
  return body;
}

function paramsFromSaved(raw: Record<string, unknown>): OnboardingReportParams {
  return {
    days: Number(raw.days) || 30,
    pathway: raw.pathway ? String(raw.pathway) : "",
    platform: raw.platform ? String(raw.platform) : "",
    status: raw.status ? String(raw.status) : "",
    welcome_theme: raw.welcome_theme ? String(raw.welcome_theme) : "",
    user_limit: raw.user_limit ? Number(raw.user_limit) : 500,
  };
}

function filterSummary(params: OnboardingReportParams): string {
  const parts = [`${params.days}d`];
  if (params.pathway) parts.push(params.pathway);
  if (params.platform) parts.push(params.platform);
  if (params.status) parts.push(params.status);
  if (params.welcome_theme) parts.push(params.welcome_theme);
  return parts.join(" · ");
}

function isLegacyReport(report: SavedReport): boolean {
  return report.type !== "onboarding";
}

/* ── Filter fields ────────────────────────────────────────────────── */

function OnboardingFilterFields({
  params,
  onChange,
}: {
  params: OnboardingReportParams;
  onChange: (next: OnboardingReportParams) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Date range</span>
        <select
          value={params.days}
          onChange={(e) => onChange({ ...params, days: Number(e.target.value) })}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        >
          {DAY_OPTIONS.map((d) => (
            <option key={d} value={d}>Last {d} days</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Pathway</span>
        <select
          value={params.pathway ?? ""}
          onChange={(e) => onChange({ ...params, pathway: e.target.value })}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        >
          {PATHWAY_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Platform</span>
        <select
          value={params.platform ?? ""}
          onChange={(e) => onChange({ ...params, platform: e.target.value })}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        >
          {PLATFORM_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1.5 block font-medium">Status</span>
        <select
          value={params.status ?? ""}
          onChange={(e) => onChange({ ...params, status: e.target.value })}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="block text-sm sm:col-span-2">
        <span className="mb-1.5 block font-medium">Welcome theme (A/B)</span>
        <select
          value={params.welcome_theme ?? ""}
          onChange={(e) => onChange({ ...params, welcome_theme: e.target.value })}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
        >
          {THEME_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/* ── Live default report ──────────────────────────────────────────── */

function LiveOnboardingReport({ gameId }: { gameId: string | undefined }) {
  const [params, setParams] = useState<OnboardingReportParams>({ days: 30 });
  const live = useQuery({
    queryKey: ["admin", "onboarding-report-live", params, gameId],
    queryFn: () =>
      onboarding.getOnboardingFunnelAnalytics(
        paramsToRpcPayload(params, gameId),
        serverKeyAuth(),
      ),
    retry: 1,
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold">Web onboarding (live)</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Same data as analytics.html Funnel → Web Onboarding (Live). Uses <code className="rounded bg-muted px-1 text-xs">ob_*</code> events from Nakama storage.
          </p>
        </div>
        <button
          onClick={() => live.refetch()}
          disabled={live.isFetching}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", live.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      <OnboardingFilterFields params={params} onChange={setParams} />

      <div className="mt-4">
        {live.isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          </div>
        )}
        {live.isError && (
          <p className="text-sm text-destructive">
            Failed to load onboarding report: {live.error instanceof Error ? live.error.message : "error"}
          </p>
        )}
        {live.data && <OnboardingReportDashboard data={live.data} />}
      </div>
    </section>
  );
}

/* ── Builder ──────────────────────────────────────────────────────── */

function ReportForm({ onClose, onToast, gameId }: { onClose: () => void; onToast: (msg: string, v: ToastVariant) => void; gameId: string | undefined }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [params, setParams] = useState<OnboardingReportParams>({ days: 30 });

  const save = useMutation({
    mutationFn: () =>
      satori.saveReport(
        {
          name: name.trim(),
          type: "onboarding",
          description: description.trim(),
          params: params as unknown as Record<string, unknown>,
          game_id: gameId,
        },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "reports", gameId ?? "global"] });
      onToast("Onboarding report saved", "success");
      onClose();
    },
    onError: () => onToast("Failed to save report", "error"),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Save onboarding report</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Report name</label>
            <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Onboarding — lavender theme, 30d" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Description <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Weekly lavender A/B check" className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary" />
          </div>
          <div className="rounded-md border border-border bg-muted/20 p-3">
            <p className="mb-3 text-xs text-muted-foreground">Filters saved with this report — re-run anytime from the list below.</p>
            <OnboardingFilterFields params={params} onChange={setParams} />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Cancel</button>
          <button type="submit" disabled={!name.trim() || save.isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Save report
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Saved report runner ──────────────────────────────────────────── */

function ReportResult({ report, gameId }: { report: SavedReport; gameId: string | undefined }) {
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const legacy = isLegacyReport(report);

  const run = useQuery({
    queryKey: ["admin", "report-run", report.id, gameId],
    enabled: false,
    retry: 0,
    queryFn: async () => {
      const p = paramsFromSaved(report.params as Record<string, unknown>);
      return onboarding.getOnboardingFunnelAnalytics(
        paramsToRpcPayload(p, gameId),
        serverKeyAuth(),
      );
    },
  });

  if (legacy) {
    return (
      <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        Legacy report type ({report.type}) — no longer supported. Delete and save a new onboarding report.
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="mb-2 text-[11px] text-muted-foreground">{filterSummary(paramsFromSaved(report.params as Record<string, unknown>))}</p>
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
      {run.data && (
        <div className="mt-4">
          <OnboardingReportDashboard data={run.data} />
        </div>
      )}
    </div>
  );
}

function useReports(gameId: string | undefined) {
  return useQuery({
    queryKey: ["admin", "reports", gameId ?? "global"],
    queryFn: () => satori.listReports(serverKeyAuth(), gameId),
    select: (d) => d.reports ?? [],
    retry: 1,
  });
}

/* ── Page ─────────────────────────────────────────────────────────── */

export function ReportsPage() {
  const qc = useQueryClient();
  const gameId = useScopedGameId();
  const { slug, label } = useActiveApp();
  // ob_* onboarding events come from the QuizVerse web funnel only — they are
  // not game-tagged, so the report data only represents QuizVerse.
  const onboardingAvailable = !gameId || slug === "quizverse";
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
  const savedOnboarding = list.filter((r) => !isLegacyReport(r));
  const legacyReports = list.filter(isLegacyReport);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold tracking-tight">Onboarding Reports</h2>
            {gameId && (
              <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                {gameId}
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            Web onboarding funnel from Nakama <code className="rounded bg-muted px-1 text-xs">ob_*</code> events — same source as analytics.html. Save filter presets to re-run later.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => reports.refetch()} disabled={reports.isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", reports.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => setShowForm(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            Save report
          </button>
        </div>
      </div>

      {onboardingAvailable ? (
        <LiveOnboardingReport gameId={gameId} />
      ) : (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Onboarding funnel events (<code className="rounded bg-muted px-1 text-xs">ob_*</code>) are only captured for the
          QuizVerse web onboarding — there is no onboarding data for {label}. Switch to QuizVerse or All Apps to view it.
        </div>
      )}

      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Saved reports</h3>
        {reports.isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-7 w-7 animate-spin text-muted-foreground" /></div>
        ) : savedOnboarding.length === 0 && legacyReports.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center">
            <FileBarChart className="mx-auto h-9 w-9 text-muted-foreground/40" />
            <p className="mt-3 text-sm font-medium text-muted-foreground">No saved onboarding reports yet</p>
            <p className="mt-1 text-xs text-muted-foreground/60">Use filters above, then click Save report to store a preset you can re-run.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {savedOnboarding.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-muted p-2"><Route className="h-4 w-4 text-violet-500" /></div>
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">Onboarding{r.description ? ` · ${r.description}` : ""}</p>
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
            ))}
            {legacyReports.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg bg-muted p-2"><Users className="h-4 w-4 text-amber-500" /></div>
                    <div>
                      <p className="font-semibold">{r.name}</p>
                      <p className="text-xs text-muted-foreground">Legacy · {r.type}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => openConfirm(`Delete legacy report "${r.name}"?`, () => del.mutate(r.id))}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <ReportResult report={r} gameId={gameId} />
              </div>
            ))}
          </div>
        )}
      </section>

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
