import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Editor, { loader, type OnMount, type Monaco } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import type { editor } from "monaco-editor";
import {
  serverKeyAuth,
  hiro,
  HIRO_SYSTEMS,
  type HiroSystem,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import { useAdminStore } from "@/stores/admin-store";
import {
  Save,
  RotateCcw,
  Download,
  Upload,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileJson2,
  ChevronRight,
  Search,
  X,
} from "lucide-react";

loader.config({ monaco });

const SYSTEM_LABELS: Record<HiroSystem, string> = {
  economy: "Economy",
  inventory: "Inventory",
  achievements: "Achievements",
  progression: "Progression",
  energy: "Energy",
  stats: "Stats",
  streaks: "Streaks",
  event_leaderboards: "Event Leaderboards",
  store: "Store",
  challenges: "Challenges",
  tutorials: "Tutorials",
  unlockables: "Unlockables",
  auctions: "Auctions",
  incentives: "Incentives",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validateHiroConfig(system: HiroSystem, value: unknown): string | null {
  if (!isRecord(value)) return "Config must be a JSON object.";

  if (system === "challenges") {
    const challenges = value.challenges ?? value;
    if (!isRecord(challenges) && !Array.isArray(challenges)) {
      return "Challenges config must be an object or contain a `challenges` object/array.";
    }
    const entries = Array.isArray(challenges) ? challenges : Object.values(challenges);
    const invalid = entries.find((entry) => !isRecord(entry) || !entry.id);
    if (entries.length > 0 && invalid) return "Each challenge must be an object with an `id`.";
  }

  if (system === "incentives") {
    const knownKeys = ["returnBonus", "referralReward", "dailyBonus", "rewards", "campaigns"];
    const hasKnownKey = knownKeys.some((key) => value[key] !== undefined);
    if (Object.keys(value).length > 0 && !hasKnownKey) {
      return "Incentives should include a known key such as `returnBonus`, `referralReward`, `dailyBonus`, `rewards`, or `campaigns`.";
    }
  }

  return null;
}

function useHiroConfig(system: HiroSystem) {
  return useQuery({
    queryKey: ["admin", "hiro-config", system],
    queryFn: () => hiro.getHiroConfig(system, serverKeyAuth()),
    staleTime: 30_000,
    retry: 1,
  });
}

function useSaveHiroConfig(system: HiroSystem) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      hiro.setHiroConfig(system, config, serverKeyAuth()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "hiro-config", system] });
    },
  });
}

function SystemTab({
  system,
  active,
  onClick,
}: {
  system: HiroSystem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <FileJson2 className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{SYSTEM_LABELS[system]}</span>
      {active && <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}

function Toast({
  message,
  variant,
  onDismiss,
}: {
  message: string;
  variant: "success" | "error";
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg animate-in slide-in-from-bottom-4",
        variant === "success" &&
          "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400",
        variant === "error" &&
          "border-destructive/30 bg-destructive/10 text-destructive",
      )}
    >
      {variant === "success" ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      {message}
      <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function HiroConfigPage() {
  const theme = useAdminStore((s) => s.theme);
  const [activeSystem, setActiveSystem] = useState<HiroSystem>("economy");
  const [editorValue, setEditorValue] = useState<string>("");
  const [isDirty, setIsDirty] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    variant: "success" | "error";
  } | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState("");

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const configQuery = useHiroConfig(activeSystem);
  const saveMutation = useSaveHiroConfig(activeSystem);

  const serverConfig = configQuery.data
    ? JSON.stringify(configQuery.data, null, 2)
    : "";

  useEffect(() => {
    if (configQuery.data) {
      const formatted = JSON.stringify(configQuery.data, null, 2);
      setEditorValue(formatted);
      setIsDirty(false);
      setParseError(null);
      setSchemaError(validateHiroConfig(activeSystem, configQuery.data));
    }
  }, [activeSystem, configQuery.data]);

  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
      validate: true,
      allowComments: false,
      trailingCommas: "error",
    });

    editor.addAction({
      id: "save-config",
      label: "Save Config",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => {
        document.getElementById("save-config-btn")?.click();
      },
    });
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      const v = value ?? "";
      setEditorValue(v);
      setIsDirty(v !== serverConfig);

      try {
        const parsed = JSON.parse(v);
        setParseError(null);
        setSchemaError(validateHiroConfig(activeSystem, parsed));
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Invalid JSON");
        setSchemaError(null);
      }
    },
    [activeSystem, serverConfig],
  );

  const handleSave = useCallback(() => {
    if (parseError || schemaError) return;
    if (!window.confirm(`Save ${SYSTEM_LABELS[activeSystem]} config to production?`)) {
      return;
    }
    try {
      const parsed = JSON.parse(editorValue);
      saveMutation.mutate(parsed, {
        onSuccess: () => {
          setIsDirty(false);
          setToast({ message: `${SYSTEM_LABELS[activeSystem]} config saved`, variant: "success" });
        },
        onError: (err) => {
          setToast({
            message: err instanceof Error ? err.message : "Save failed",
            variant: "error",
          });
        },
      });
    } catch {
      setToast({ message: "Cannot save — invalid JSON", variant: "error" });
    }
  }, [editorValue, parseError, schemaError, saveMutation, activeSystem]);

  const handleReset = useCallback(() => {
    setEditorValue(serverConfig);
    setIsDirty(false);
    setParseError(null);
    try {
      setSchemaError(validateHiroConfig(activeSystem, JSON.parse(serverConfig || "{}")));
    } catch {
      setSchemaError(null);
    }
  }, [activeSystem, serverConfig]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(editorValue);
    setToast({ message: "Copied to clipboard", variant: "success" });
  }, [editorValue]);

  const handleExport = useCallback(() => {
    const blob = new Blob([editorValue], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hiro-${activeSystem}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [editorValue, activeSystem]);

  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        try {
          const parsed = JSON.parse(text);
          const formatted = JSON.stringify(parsed, null, 2);
          setEditorValue(formatted);
          setIsDirty(formatted !== serverConfig);
          setParseError(null);
          setSchemaError(validateHiroConfig(activeSystem, parsed));
          editorRef.current?.setValue(formatted);
        } catch {
          setToast({ message: "Imported file is not valid JSON", variant: "error" });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [activeSystem, serverConfig]);

  const handleFormat = useCallback(() => {
    editorRef.current?.getAction("editor.action.formatDocument")?.run();
  }, []);

  const handleSystemChange = useCallback((sys: HiroSystem) => {
    setActiveSystem(sys);
    setIsDirty(false);
    setParseError(null);
    setSchemaError(null);
  }, []);

  const filteredSystems = HIRO_SYSTEMS.filter((sys) =>
    SYSTEM_LABELS[sys].toLowerCase().includes(sidebarFilter.toLowerCase()),
  );

  const monacoTheme =
    theme === "dark"
      ? "vs-dark"
      : theme === "light"
        ? "light"
        : typeof window !== "undefined" &&
            window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "vs-dark"
          : "light";

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Hiro Config Editor
          </h2>
          <p className="text-muted-foreground">
            Edit game system configurations with JSON validation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-600 dark:text-yellow-400">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
              Unsaved changes
            </span>
          )}
          {parseError && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Parse error
            </span>
          )}
          {schemaError && !parseError && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              Schema warning
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Sidebar */}
        <div className="flex w-52 shrink-0 flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-3 py-2.5">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Filter systems..."
                value={sidebarFilter}
                onChange={(e) => setSidebarFilter(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 pl-8 text-xs placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {sidebarFilter && (
                <button
                  onClick={() => setSidebarFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
          <nav className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {filteredSystems.map((sys) => (
              <SystemTab
                key={sys}
                system={sys}
                active={sys === activeSystem}
                onClick={() => handleSystemChange(sys)}
              />
            ))}
            {filteredSystems.length === 0 && (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No matching systems
              </p>
            )}
          </nav>
        </div>

        {/* Editor Area */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card">
          {/* Toolbar */}
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <div className="flex items-center gap-2">
              <FileJson2 className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">
                {SYSTEM_LABELS[activeSystem]}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                {activeSystem}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <ToolbarButton
                icon={Copy}
                label="Copy"
                onClick={handleCopy}
              />
              <ToolbarButton
                icon={Download}
                label="Export"
                onClick={handleExport}
              />
              <ToolbarButton
                icon={Upload}
                label="Import"
                onClick={handleImport}
              />
              <div className="mx-1 h-5 w-px bg-border" />
              <ToolbarButton
                icon={RotateCcw}
                label="Reset"
                onClick={handleReset}
                disabled={!isDirty}
              />
              <button
                id="save-config-btn"
                onClick={handleSave}
                disabled={!isDirty || !!parseError || !!schemaError || saveMutation.isPending}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  isDirty && !parseError && !schemaError
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-muted text-muted-foreground cursor-not-allowed",
                )}
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save
              </button>
            </div>
          </div>

          {/* Monaco */}
          {(schemaError || parseError) && (
            <div className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {parseError ? `JSON parse error: ${parseError}` : `Schema validation: ${schemaError}`}
            </div>
          )}
          <div className="relative flex-1">
            {configQuery.isLoading ? (
              <div className="flex h-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : configQuery.isError ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <AlertTriangle className="h-8 w-8 text-destructive" />
                <div>
                  <p className="text-sm font-semibold text-destructive">
                    Failed to load config
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {configQuery.error instanceof Error
                      ? configQuery.error.message
                      : "Unknown error"}
                  </p>
                </div>
                <button
                  onClick={() => configQuery.refetch()}
                  className="mt-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
                >
                  Retry
                </button>
              </div>
            ) : (
              <Editor
                height="100%"
                language="json"
                theme={monacoTheme}
                value={editorValue}
                onChange={handleEditorChange}
                onMount={handleEditorMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: "on",
                  scrollBeyondLastLine: false,
                  wordWrap: "on",
                  wrappingIndent: "indent",
                  automaticLayout: true,
                  tabSize: 2,
                  formatOnPaste: true,
                  bracketPairColorization: { enabled: true },
                  guides: { bracketPairs: true },
                  padding: { top: 12 },
                  renderValidationDecorations: "on",
                  suggest: { showWords: false },
                }}
                loading={
                  <div className="flex h-full items-center justify-center">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                }
              />
            )}
          </div>

          {/* Status Bar */}
          <div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-3">
              <span>JSON</span>
              <span>UTF-8</span>
              {editorValue && (
                <span>
                  {editorValue.split("\n").length} lines
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span>
                {configQuery.dataUpdatedAt
                  ? `Loaded ${new Date(configQuery.dataUpdatedAt).toLocaleTimeString()}`
                  : ""}
              </span>
              <button
                onClick={handleFormat}
                className="hover:text-foreground"
              >
                Format
              </button>
              <span className="font-medium">
                Ctrl+S to save
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <Toast
          message={toast.message}
          variant={toast.variant}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}


export default HiroConfigPage;
