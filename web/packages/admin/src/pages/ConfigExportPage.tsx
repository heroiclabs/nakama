import { useState, useCallback, useRef, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Download,
  Upload,
  FileJson,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Package,
  Layers,
  Sparkles,
  Flag,
  Clock,
  Server,
  Shield,
  ChevronDown,
  ChevronRight,
  Trash2,
  Copy,
  Eye,
  FileUp,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import {
  serverKeyAuth,
  hiro,
  satori,
  HIRO_SYSTEMS,
  SATORI_SYSTEMS,
} from "@nakama/shared";
import type { HiroSystem, SatoriSystem } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Types ──────────────────────────────────────────────────────────── */

interface ConfigBundle {
  meta: {
    version: number;
    exported_at: string;
    source: string;
  };
  hiro: Partial<Record<string, Record<string, unknown>>>;
  satori: Partial<Record<string, Record<string, unknown>>>;
}

type SystemResult = {
  system: string;
  status: "ok" | "error" | "pending" | "skipped";
  error?: string;
};

type ImportPreview = {
  hiro: { system: string; hasData: boolean; keys: number }[];
  satori: { system: string; hasData: boolean; keys: number }[];
  meta: ConfigBundle["meta"];
};

/* ── Constants ──────────────────────────────────────────────────────── */

const BUNDLE_VERSION = 1;

/* ── Helpers ─────────────────────────────────────────────────────────── */

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function validateBundle(data: unknown): data is ConfigBundle {
  if (!data || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (!obj.meta || typeof obj.meta !== "object") return false;
  const meta = obj.meta as Record<string, unknown>;
  if (typeof meta.version !== "number") return false;
  if (typeof meta.exported_at !== "string") return false;
  if (!obj.hiro || typeof obj.hiro !== "object") return false;
  if (!obj.satori || typeof obj.satori !== "object") return false;
  return true;
}

function countKeys(obj: unknown): number {
  if (!obj || typeof obj !== "object") return 0;
  return Object.keys(obj).length;
}

/* ── Export Hook ─────────────────────────────────────────────────────── */

function useExportBundle() {
  const [results, setResults] = useState<SystemResult[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");

  const mutation = useMutation({
    mutationFn: async () => {
      setPhase("running");
      const opts = serverKeyAuth();
      const bundle: ConfigBundle = {
        meta: {
          version: BUNDLE_VERSION,
          exported_at: new Date().toISOString(),
          source: window.location.origin,
        },
        hiro: {},
        satori: {},
      };

      const allResults: SystemResult[] = [];

      const initResults = [
        ...HIRO_SYSTEMS.map((s) => ({
          system: `hiro/${s}`,
          status: "pending" as const,
        })),
        ...SATORI_SYSTEMS.map((s) => ({
          system: `satori/${s}`,
          status: "pending" as const,
        })),
      ];
      setResults(initResults);

      await Promise.allSettled(
        HIRO_SYSTEMS.map(async (sys) => {
          try {
            const config = await hiro.getHiroConfig(sys as HiroSystem, opts);
            bundle.hiro[sys] = config;
            const r: SystemResult = { system: `hiro/${sys}`, status: "ok" };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) =>
                p.system === `hiro/${sys}` ? r : p,
              ),
            );
          } catch (err) {
            const r: SystemResult = {
              system: `hiro/${sys}`,
              status: "error",
              error: err instanceof Error ? err.message : "Unknown error",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) =>
                p.system === `hiro/${sys}` ? r : p,
              ),
            );
          }
        }),
      );

      await Promise.allSettled(
        SATORI_SYSTEMS.map(async (sys) => {
          try {
            const config = await satori.getSatoriConfig(
              sys as SatoriSystem,
              opts,
            );
            bundle.satori[sys] = config;
            const r: SystemResult = { system: `satori/${sys}`, status: "ok" };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) =>
                p.system === `satori/${sys}` ? r : p,
              ),
            );
          } catch (err) {
            const r: SystemResult = {
              system: `satori/${sys}`,
              status: "error",
              error: err instanceof Error ? err.message : "Unknown error",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) =>
                p.system === `satori/${sys}` ? r : p,
              ),
            );
          }
        }),
      );

      setPhase("done");
      return bundle;
    },
  });

  const reset = useCallback(() => {
    setResults([]);
    setPhase("idle");
    mutation.reset();
  }, [mutation]);

  return { ...mutation, results, phase, reset };
}

/* ── Import Hook ─────────────────────────────────────────────────────── */

function useImportBundle() {
  const [results, setResults] = useState<SystemResult[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");

  const mutation = useMutation({
    mutationFn: async ({
      bundle,
      selectedHiro,
      selectedSatori,
    }: {
      bundle: ConfigBundle;
      selectedHiro: string[];
      selectedSatori: string[];
    }) => {
      setPhase("running");
      const opts = serverKeyAuth();
      const allResults: SystemResult[] = [];

      const initResults = [
        ...selectedHiro.map((s) => ({
          system: `hiro/${s}`,
          status: "pending" as const,
        })),
        ...selectedSatori.map((s) => ({
          system: `satori/${s}`,
          status: "pending" as const,
        })),
      ];
      setResults(initResults);

      await Promise.allSettled(
        selectedHiro.map(async (sys) => {
          const config = bundle.hiro[sys];
          if (!config) {
            const r: SystemResult = {
              system: `hiro/${sys}`,
              status: "skipped",
              error: "No data in bundle",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `hiro/${sys}` ? r : p)),
            );
            return;
          }
          try {
            await hiro.setHiroConfig(sys as HiroSystem, config, opts);
            const r: SystemResult = { system: `hiro/${sys}`, status: "ok" };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `hiro/${sys}` ? r : p)),
            );
          } catch (err) {
            const r: SystemResult = {
              system: `hiro/${sys}`,
              status: "error",
              error: err instanceof Error ? err.message : "Unknown error",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `hiro/${sys}` ? r : p)),
            );
          }
        }),
      );

      await Promise.allSettled(
        selectedSatori.map(async (sys) => {
          const config = bundle.satori[sys];
          if (!config) {
            const r: SystemResult = {
              system: `satori/${sys}`,
              status: "skipped",
              error: "No data in bundle",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `satori/${sys}` ? r : p)),
            );
            return;
          }
          try {
            await satori.setSatoriConfig(sys as SatoriSystem, config, opts);
            const r: SystemResult = { system: `satori/${sys}`, status: "ok" };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `satori/${sys}` ? r : p)),
            );
          } catch (err) {
            const r: SystemResult = {
              system: `satori/${sys}`,
              status: "error",
              error: err instanceof Error ? err.message : "Unknown error",
            };
            allResults.push(r);
            setResults((prev) =>
              prev.map((p) => (p.system === `satori/${sys}` ? r : p)),
            );
          }
        }),
      );

      setPhase("done");
      return {
        ok: allResults.filter((r) => r.status === "ok").length,
        errors: allResults.filter((r) => r.status === "error").length,
        skipped: allResults.filter((r) => r.status === "skipped").length,
      };
    },
  });

  const reset = useCallback(() => {
    setResults([]);
    setPhase("idle");
    mutation.reset();
  }, [mutation]);

  return { ...mutation, results, phase, reset };
}

/* ── Sub-components ──────────────────────────────────────────────────── */

function SystemResultRow({ result }: { result: SystemResult }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
        result.status === "ok" &&
          "border-green-500/30 bg-green-500/5 text-green-700 dark:text-green-400",
        result.status === "error" &&
          "border-destructive/30 bg-destructive/5 text-destructive",
        result.status === "pending" &&
          "border-border bg-muted/50 text-muted-foreground",
        result.status === "skipped" &&
          "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400",
      )}
    >
      {result.status === "ok" && <CheckCircle2 className="h-3 w-3 shrink-0" />}
      {result.status === "error" && <XCircle className="h-3 w-3 shrink-0" />}
      {result.status === "pending" && (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
      )}
      {result.status === "skipped" && (
        <AlertTriangle className="h-3 w-3 shrink-0" />
      )}
      <span className="capitalize">{result.system.replace("/", " / ").replace(/_/g, " ")}</span>
      {result.error && (
        <span className="ml-auto truncate text-[10px] opacity-70">
          {result.error}
        </span>
      )}
    </div>
  );
}

function SystemCheckbox({
  system,
  checked,
  onChange,
  hasData,
  keys,
}: {
  system: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hasData: boolean;
  keys: number;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors",
        checked
          ? "border-primary/30 bg-primary/5 text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent",
        !hasData && "opacity-50",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={!hasData}
        className="h-3.5 w-3.5 rounded border-border accent-primary"
      />
      <span className="capitalize">{system.replace(/_/g, " ")}</span>
      {hasData && (
        <span className="ml-auto text-[10px] text-muted-foreground">
          {keys} keys
        </span>
      )}
      {!hasData && (
        <span className="ml-auto text-[10px] text-muted-foreground/60">
          empty
        </span>
      )}
    </label>
  );
}

function BundlePreview({
  bundle,
  onCopy,
}: {
  bundle: ConfigBundle;
  onCopy: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hiroCount = Object.keys(bundle.hiro).length;
  const satoriCount = Object.keys(bundle.satori).length;
  const totalSize = new Blob([JSON.stringify(bundle)]).size;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <FileJson className="h-4 w-4 text-primary" />
          <h4 className="text-sm font-semibold">Bundle Preview</h4>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">
            {hiroCount} Hiro · {satoriCount} Satori ·{" "}
            {(totalSize / 1024).toFixed(1)} KB
          </span>
          <button
            onClick={onCopy}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-3 w-3" />
            Copy
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Eye className="h-3 w-3" />
            {expanded ? "Collapse" : "Inspect"}
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap p-4 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(bundle, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ── Export Section ──────────────────────────────────────────────────── */

function ExportSection() {
  const exportBundle = useExportBundle();
  const [copied, setCopied] = useState(false);

  const handleExport = () => {
    exportBundle.mutate(undefined, {
      onSuccess: (bundle) => {
        const ts = new Date()
          .toISOString()
          .replace(/[:.]/g, "-")
          .slice(0, 19);
        downloadJson(bundle, `nakama-config-${ts}.json`);
      },
    });
  };

  const handleCopy = async () => {
    if (exportBundle.data) {
      await navigator.clipboard.writeText(
        JSON.stringify(exportBundle.data, null, 2),
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const okCount = exportBundle.results.filter(
    (r) => r.status === "ok",
  ).length;
  const errCount = exportBundle.results.filter(
    (r) => r.status === "error",
  ).length;
  const total = HIRO_SYSTEMS.length + SATORI_SYSTEMS.length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-emerald-500" />
            <h3 className="text-sm font-semibold">Export Configuration</h3>
          </div>
          <div className="flex items-center gap-2">
            {exportBundle.phase === "done" && (
              <button
                onClick={exportBundle.reset}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className="h-3 w-3" />
                Reset
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={exportBundle.phase === "running"}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md px-4 text-xs font-medium transition-colors",
                exportBundle.phase === "running"
                  ? "cursor-not-allowed bg-muted text-muted-foreground"
                  : "bg-emerald-600 text-white hover:bg-emerald-700",
              )}
            >
              {exportBundle.phase === "running" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {exportBundle.phase === "running"
                ? "Exporting..."
                : exportBundle.phase === "done"
                  ? "Re-export & Download"
                  : "Export All & Download"}
            </button>
          </div>
        </div>

        <div className="p-4">
          <p className="mb-3 text-xs text-muted-foreground">
            Exports all {HIRO_SYSTEMS.length} Hiro and{" "}
            {SATORI_SYSTEMS.length} Satori system configs as a single JSON
            bundle. Use this to back up your configuration or transfer it to
            another environment.
          </p>

          {exportBundle.phase !== "idle" && (
            <div className="space-y-3">
              {/* Progress */}
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      errCount > 0
                        ? "bg-amber-500"
                        : exportBundle.phase === "done"
                          ? "bg-emerald-500"
                          : "bg-primary",
                    )}
                    style={{
                      width: `${((okCount + errCount) / total) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {okCount + errCount}/{total}
                </span>
              </div>

              {/* Results grid */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {exportBundle.results.map((r) => (
                  <SystemResultRow key={r.system} result={r} />
                ))}
              </div>

              {/* Summary */}
              {exportBundle.phase === "done" && (
                <div
                  className={cn(
                    "flex items-center gap-2 rounded-md border p-3 text-xs",
                    errCount > 0
                      ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {errCount > 0 ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  <span>
                    Exported {okCount} systems successfully.
                    {errCount > 0 && ` ${errCount} failed.`} Bundle downloaded.
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bundle preview after export */}
      {exportBundle.data && (
        <BundlePreview
          bundle={exportBundle.data}
          onCopy={handleCopy}
        />
      )}
      {copied && (
        <p className="text-center text-xs text-emerald-600 dark:text-emerald-400">
          Copied to clipboard
        </p>
      )}
    </div>
  );
}

/* ── Import Section ──────────────────────────────────────────────────── */

function ImportSection() {
  const importBundle = useImportBundle();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bundle, setBundle] = useState<ConfigBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedHiro, setSelectedHiro] = useState<Set<string>>(new Set());
  const [selectedSatori, setSelectedSatori] = useState<Set<string>>(
    new Set(),
  );
  const [confirmOpen, setConfirmOpen] = useState(false);

  const preview = useMemo((): ImportPreview | null => {
    if (!bundle) return null;
    return {
      meta: bundle.meta,
      hiro: HIRO_SYSTEMS.map((sys) => ({
        system: sys,
        hasData: !!bundle.hiro[sys] && countKeys(bundle.hiro[sys]) > 0,
        keys: countKeys(bundle.hiro[sys]),
      })),
      satori: SATORI_SYSTEMS.map((sys) => ({
        system: sys,
        hasData:
          !!bundle.satori[sys] && countKeys(bundle.satori[sys]) > 0,
        keys: countKeys(bundle.satori[sys]),
      })),
    };
  }, [bundle]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setBundle(null);
    importBundle.reset();
    setConfirmOpen(false);

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!validateBundle(data)) {
        setParseError(
          "Invalid bundle format. Expected { meta, hiro, satori } structure.",
        );
        return;
      }
      setBundle(data);

      const hSel = new Set<string>();
      const sSel = new Set<string>();
      for (const sys of HIRO_SYSTEMS) {
        if (data.hiro[sys] && countKeys(data.hiro[sys]) > 0) hSel.add(sys);
      }
      for (const sys of SATORI_SYSTEMS) {
        if (data.satori[sys] && countKeys(data.satori[sys]) > 0) sSel.add(sys);
      }
      setSelectedHiro(hSel);
      setSelectedSatori(sSel);
    } catch {
      setParseError("Failed to parse JSON file. Ensure it is valid JSON.");
    }

    if (fileRef.current) fileRef.current.value = "";
  };

  const handleImport = () => {
    if (!bundle) return;
    setConfirmOpen(false);
    importBundle.mutate({
      bundle,
      selectedHiro: [...selectedHiro],
      selectedSatori: [...selectedSatori],
    });
  };

  const handleClear = () => {
    setBundle(null);
    setParseError(null);
    setSelectedHiro(new Set());
    setSelectedSatori(new Set());
    importBundle.reset();
    setConfirmOpen(false);
  };

  const toggleHiro = (sys: string, v: boolean) =>
    setSelectedHiro((prev) => {
      const next = new Set(prev);
      v ? next.add(sys) : next.delete(sys);
      return next;
    });

  const toggleSatori = (sys: string, v: boolean) =>
    setSelectedSatori((prev) => {
      const next = new Set(prev);
      v ? next.add(sys) : next.delete(sys);
      return next;
    });

  const totalSelected = selectedHiro.size + selectedSatori.size;

  const okCount = importBundle.results.filter(
    (r) => r.status === "ok",
  ).length;
  const errCount = importBundle.results.filter(
    (r) => r.status === "error",
  ).length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Upload className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Import Configuration</h3>
        </div>
        {bundle && (
          <button
            onClick={handleClear}
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          Upload a previously exported JSON bundle to restore or transfer
          configuration. You can select which systems to apply.
        </p>

        {/* File upload zone */}
        {!bundle && (
          <div
            onClick={() => fileRef.current?.click()}
            className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed border-border p-8 transition-colors hover:border-primary/40 hover:bg-accent/30"
          >
            <FileUp className="h-8 w-8 text-muted-foreground/60" />
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">
                Click to select a config bundle
              </p>
              <p className="text-xs text-muted-foreground">
                JSON file exported from this tool
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Parse error */}
        {parseError && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            <XCircle className="h-4 w-4 shrink-0" />
            {parseError}
          </div>
        )}

        {/* Preview */}
        {preview && bundle && importBundle.phase === "idle" && (
          <div className="space-y-4">
            {/* Meta info */}
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Exported: {fmtDate(preview.meta.exported_at)}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Server className="h-3 w-3" />
                Source: {preview.meta.source}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Shield className="h-3 w-3" />
                Version: {preview.meta.version}
              </div>
            </div>

            {/* Hiro systems selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-violet-500" />
                  Hiro Systems
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setSelectedHiro(
                        new Set(
                          preview.hiro
                            .filter((h) => h.hasData)
                            .map((h) => h.system),
                        ),
                      )
                    }
                    className="text-[10px] text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedHiro(new Set())}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {preview.hiro.map((h) => (
                  <SystemCheckbox
                    key={h.system}
                    system={h.system}
                    checked={selectedHiro.has(h.system)}
                    onChange={(v) => toggleHiro(h.system, v)}
                    hasData={h.hasData}
                    keys={h.keys}
                  />
                ))}
              </div>
            </div>

            {/* Satori systems selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Flag className="h-3.5 w-3.5 text-amber-500" />
                  Satori Systems
                </h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() =>
                      setSelectedSatori(
                        new Set(
                          preview.satori
                            .filter((s) => s.hasData)
                            .map((s) => s.system),
                        ),
                      )
                    }
                    className="text-[10px] text-primary hover:underline"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => setSelectedSatori(new Set())}
                    className="text-[10px] text-muted-foreground hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {preview.satori.map((s) => (
                  <SystemCheckbox
                    key={s.system}
                    system={s.system}
                    checked={selectedSatori.has(s.system)}
                    onChange={(v) => toggleSatori(s.system, v)}
                    hasData={s.hasData}
                    keys={s.keys}
                  />
                ))}
              </div>
            </div>

            {/* Import button with confirmation */}
            <div className="space-y-2">
              {!confirmOpen ? (
                <button
                  onClick={() => setConfirmOpen(true)}
                  disabled={totalSelected === 0}
                  className={cn(
                    "inline-flex h-9 w-full items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
                    totalSelected === 0
                      ? "cursor-not-allowed bg-muted text-muted-foreground"
                      : "bg-violet-600 text-white hover:bg-violet-700",
                  )}
                >
                  <Upload className="h-4 w-4" />
                  Import {totalSelected} system{totalSelected !== 1 ? "s" : ""}
                </button>
              ) : (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                        Confirm Import
                      </p>
                      <p className="mt-1 text-xs text-amber-600/80 dark:text-amber-400/70">
                        This will overwrite the current configuration for{" "}
                        <strong>{totalSelected}</strong> system
                        {totalSelected !== 1 ? "s" : ""}. This action cannot
                        be undone. Consider exporting your current config first.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleImport}
                      className="inline-flex h-8 items-center gap-2 rounded-md bg-amber-600 px-4 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                      Yes, import now
                    </button>
                    <button
                      onClick={() => setConfirmOpen(false)}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-4 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Import progress */}
        {importBundle.phase !== "idle" && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    errCount > 0
                      ? "bg-amber-500"
                      : importBundle.phase === "done"
                        ? "bg-emerald-500"
                        : "bg-violet-500",
                  )}
                  style={{
                    width: `${((okCount + errCount + importBundle.results.filter((r) => r.status === "skipped").length) / totalSelected) * 100}%`,
                  }}
                />
              </div>
              <span className="text-xs tabular-nums text-muted-foreground">
                {okCount + errCount + importBundle.results.filter((r) => r.status === "skipped").length}/
                {totalSelected}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {importBundle.results.map((r) => (
                <SystemResultRow key={r.system} result={r} />
              ))}
            </div>

            {importBundle.phase === "done" && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-md border p-3 text-xs",
                  errCount > 0
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                    : "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
                )}
              >
                {errCount > 0 ? (
                  <AlertTriangle className="h-4 w-4" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                <span>
                  Import complete: {okCount} applied
                  {errCount > 0 ? `, ${errCount} failed` : ""}.
                  {importBundle.results.filter((r) => r.status === "skipped")
                    .length > 0 &&
                    ` ${importBundle.results.filter((r) => r.status === "skipped").length} skipped.`}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Info Section ────────────────────────────────────────────────────── */

function InfoSection() {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-blue-500" />
          <h3 className="text-sm font-semibold">Included Systems</h3>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Sparkles className="h-3 w-3 text-violet-500" />
              Hiro ({HIRO_SYSTEMS.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {HIRO_SYSTEMS.map((sys) => (
                <span
                  key={sys}
                  className="rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-0.5 text-[10px] font-medium capitalize text-violet-700 dark:text-violet-400"
                >
                  {sys.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Flag className="h-3 w-3 text-amber-500" />
              Satori ({SATORI_SYSTEMS.length})
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {SATORI_SYSTEMS.map((sys) => (
                <span
                  key={sys}
                  className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-0.5 text-[10px] font-medium capitalize text-amber-700 dark:text-amber-400"
                >
                  {sys.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ──────────────────────────────────────────────────────── */

export function ConfigExportPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Package className="h-6 w-6 text-primary" />
          Config Export / Import
        </h2>
        <p className="text-muted-foreground">
          Back up and restore all Hiro and Satori configuration bundles.
        </p>
      </div>

      {/* Info */}
      <InfoSection />

      {/* Export */}
      <ExportSection />

      {/* Import */}
      <ImportSection />
    </div>
  );
}


export default ConfigExportPage;
