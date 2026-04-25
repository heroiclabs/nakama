import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Flag,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Pencil,
  X,
  Check,
  Copy,
  CheckCircle2,
  Users,
  Clock,
  AlertTriangle,
  Code2,
  Filter,
} from "lucide-react";
import { serverKeyAuth, satori, type FeatureFlag } from "@nakama/shared";
import { cn } from "@/lib/utils";

type FilterMode = "all" | "enabled" | "disabled";

/* ── Queries / Mutations ──────────────────────────────────────────── */

function useFlags() {
  return useQuery({
    queryKey: ["admin", "flags"],
    queryFn: () => satori.getAllFlags(serverKeyAuth()),
    select: (d) => d.flags ?? [],
    retry: 1,
  });
}

function useToggleFlag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof satori.toggleFlag>[0]) =>
      satori.toggleFlag(params, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "flags"] }),
  });
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

function tryParseValue(val: string): { type: "json" | "text"; display: string } {
  try {
    const parsed = JSON.parse(val);
    return { type: "json", display: JSON.stringify(parsed, null, 2) };
  } catch {
    return { type: "text", display: val };
  }
}

/* ── Create / Edit Dialog ─────────────────────────────────────────── */

interface FlagFormProps {
  initial?: FeatureFlag;
  onSubmit: (params: {
    name: string;
    value?: string;
    enabled?: boolean;
    audiences_json?: string;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}

function FlagForm({ initial, onSubmit, onCancel, isPending }: FlagFormProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [audiences, setAudiences] = useState(
    initial?.audiences?.join(", ") ?? "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params: Parameters<typeof onSubmit>[0] = {
      name: name.trim(),
      enabled,
    };
    if (value.trim()) params.value = value.trim();
    if (audiences.trim()) {
      params.audiences_json = JSON.stringify(
        audiences
          .split(",")
          .map((a: string) => a.trim())
          .filter(Boolean),
      );
    }
    onSubmit(params);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit Flag" : "Create Flag"}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Flag Name
            </label>
            <input
              required
              disabled={isEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. new_shop_layout"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
            {isEdit && (
              <p className="mt-1 text-xs text-muted-foreground">
                Flag names cannot be changed after creation.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">Value</label>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder='e.g. true, "variant_a", or {"key": "val"}'
              rows={3}
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Audiences{" "}
              <span className="font-normal text-muted-foreground">
                (comma-separated)
              </span>
            </label>
            <input
              value={audiences}
              onChange={(e) => setAudiences(e.target.value)}
              placeholder="e.g. whales, new_users, us_region"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setEnabled(!enabled)}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {enabled ? (
                <ToggleRight className="h-8 w-8 text-emerald-500" />
              ) : (
                <ToggleLeft className="h-8 w-8" />
              )}
            </button>
            <span className="text-sm font-medium">
              {enabled ? "Enabled" : "Disabled"}
            </span>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isEdit ? "Save Changes" : "Create Flag"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Flag Row ─────────────────────────────────────────────────────── */

interface FlagRowProps {
  flag: FeatureFlag;
  onToggle: (name: string, enabled: boolean) => void;
  onEdit: (flag: FeatureFlag) => void;
  toggling: boolean;
}

function FlagRow({ flag, onToggle, onEdit, toggling }: FlagRowProps) {
  const { copied, copy } = useCopyToClipboard();
  const { type, display } = tryParseValue(flag.value);
  const [expanded, setExpanded] = useState(false);
  const isLongValue = display.length > 60;

  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80",
        !flag.enabled && "opacity-70",
      )}
    >
      <div className="flex items-start gap-4">
        {/* Toggle */}
        <button
          onClick={() => onToggle(flag.name, !flag.enabled)}
          disabled={toggling}
          className="mt-0.5 shrink-0 transition-colors"
          title={flag.enabled ? "Disable flag" : "Enable flag"}
        >
          {toggling ? (
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          ) : flag.enabled ? (
            <ToggleRight className="h-7 w-7 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-7 w-7 text-muted-foreground" />
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm font-semibold">{flag.name}</span>
            <button
              onClick={() => copy(flag.name, flag.name)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Copy name"
            >
              {copied === flag.name ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              )}
            </button>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                flag.enabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {flag.enabled ? "on" : "off"}
            </span>
            {type === "json" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">
                <Code2 className="h-3 w-3" />
                json
              </span>
            )}
          </div>

          {/* Value */}
          <div className="mt-2">
            {isLongValue && !expanded ? (
              <button
                onClick={() => setExpanded(true)}
                className="w-full text-left"
              >
                <code className="block truncate rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                  {display.slice(0, 60)}...
                </code>
                <span className="mt-1 text-xs text-primary">Show more</span>
              </button>
            ) : isLongValue ? (
              <div>
                <pre className="max-h-40 overflow-auto rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                  {display}
                </pre>
                <button
                  onClick={() => setExpanded(false)}
                  className="mt-1 text-xs text-primary"
                >
                  Show less
                </button>
              </div>
            ) : (
              <code className="rounded bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                {display || <span className="italic">empty</span>}
              </code>
            )}
          </div>

          {/* Meta row */}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {flag.audiences && flag.audiences.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {flag.audiences.join(", ")}
              </span>
            )}
            {flag.updated_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(flag.updated_at)}
              </span>
            )}
          </div>
        </div>

        {/* Edit */}
        <button
          onClick={() => onEdit(flag)}
          className="shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100"
          title="Edit flag"
        >
          <Pencil className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ── Empty State ───────────────────────────────────────────────────── */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {filtered ? (
        <>
          <Search className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No flags match your search
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different search term or clear your filters.
          </p>
        </>
      ) : (
        <>
          <Flag className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No feature flags configured
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create your first flag to control feature rollouts.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Error State ───────────────────────────────────────────────────── */

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
      <p className="mt-3 text-sm font-medium text-destructive">
        Failed to load feature flags
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export function FlagsPage() {
  const flags = useFlags();
  const toggle = useToggleFlag();

  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showForm, setShowForm] = useState(false);
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);
  const [togglingName, setTogglingName] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = flags.data ?? [];
    if (filterMode === "enabled") list = list.filter((f) => f.enabled);
    if (filterMode === "disabled") list = list.filter((f) => !f.enabled);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.value.toLowerCase().includes(q) ||
          f.audiences?.some((a) => a.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [flags.data, search, filterMode]);

  const counts = useMemo(() => {
    const all = flags.data ?? [];
    return {
      total: all.length,
      enabled: all.filter((f) => f.enabled).length,
      disabled: all.filter((f) => !f.enabled).length,
    };
  }, [flags.data]);

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => {
      setTogglingName(name);
      toggle.mutate({ name, enabled }, { onSettled: () => setTogglingName(null) });
    },
    [toggle],
  );

  const handleFormSubmit = useCallback(
    (params: Parameters<typeof satori.toggleFlag>[0]) => {
      toggle.mutate(params, {
        onSuccess: () => {
          setShowForm(false);
          setEditingFlag(null);
        },
      });
    },
    [toggle],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Feature Flags</h2>
          <p className="text-muted-foreground">
            Toggle feature flags and manage rollouts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {flags.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => flags.refetch()}
            disabled={flags.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", flags.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => {
              setEditingFlag(null);
              setShowForm(true);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Flag
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {flags.data && flags.data.length > 0 && (
        <div className="flex gap-3">
          <StatPill
            label="Total"
            count={counts.total}
            active={filterMode === "all"}
            onClick={() => setFilterMode("all")}
          />
          <StatPill
            label="Enabled"
            count={counts.enabled}
            active={filterMode === "enabled"}
            onClick={() => setFilterMode("enabled")}
            color="emerald"
          />
          <StatPill
            label="Disabled"
            count={counts.disabled}
            active={filterMode === "disabled"}
            onClick={() => setFilterMode("disabled")}
            color="zinc"
          />
        </div>
      )}

      {/* Search */}
      {flags.data && flags.data.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by flag name, value, or audience..."
            className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {flags.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : flags.isError ? (
        <ErrorState
          message={
            flags.error instanceof Error
              ? flags.error.message
              : "Unknown error"
          }
          onRetry={() => flags.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          filtered={search.trim().length > 0 || filterMode !== "all"}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <Filter className="mr-1 inline h-3 w-3" />
            Showing {filtered.length} of {counts.total} flag
            {counts.total !== 1 && "s"}
          </p>
          {filtered.map((flag) => (
            <FlagRow
              key={flag.name}
              flag={flag}
              onToggle={handleToggle}
              onEdit={(f) => {
                setEditingFlag(f);
                setShowForm(true);
              }}
              toggling={togglingName === flag.name}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <FlagForm
          initial={editingFlag ?? undefined}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditingFlag(null);
          }}
          isPending={toggle.isPending}
        />
      )}
    </div>
  );
}

/* ── Stat Pill ─────────────────────────────────────────────────────── */

function StatPill({
  label,
  count,
  active,
  onClick,
  color,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  color?: "emerald" | "zinc";
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          color === "emerald"
            ? "bg-emerald-500"
            : color === "zinc"
              ? "bg-zinc-400"
              : "bg-foreground",
        )}
      />
      {label}
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none",
          active ? "bg-primary/20" : "bg-muted",
        )}
      >
        {count}
      </span>
    </button>
  );
}

export { FlagsPage as default };

export default FlagsPage;
