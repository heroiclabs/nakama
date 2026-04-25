import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  FlaskConical,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  X,
  Check,
  AlertTriangle,
  Filter,
  Users,
  Clock,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Copy,
  CheckCircle2,
  BarChart3,
  Percent,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  type Experiment,
  type ExperimentVariant,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

type FilterMode = "all" | "enabled" | "disabled";

/* ── Queries / Mutations ──────────────────────────────────────────── */

function useExperiments() {
  return useQuery({
    queryKey: ["satori", "experiments"],
    queryFn: () => satori.getAllExperiments(serverKeyAuth()),
    select: (d: { experiments?: Experiment[] }) => d.experiments ?? [],
    staleTime: 30_000,
  });
}

function useSetupExperiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof satori.setupExperiment>[0]) =>
      satori.setupExperiment(params, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["satori", "experiments"] }),
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

function totalWeight(variants: ExperimentVariant[]) {
  return variants.reduce((s, v) => s + v.weight, 0);
}

const VARIANT_COLORS = [
  "bg-blue-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-orange-500",
  "bg-pink-500",
];

function variantColor(idx: number) {
  return VARIANT_COLORS[idx % VARIANT_COLORS.length];
}

/* ── Variant Editor ───────────────────────────────────────────────── */

interface VariantEditorProps {
  variants: ExperimentVariant[];
  onChange: (v: ExperimentVariant[]) => void;
}

function VariantEditor({ variants, onChange }: VariantEditorProps) {
  const total = totalWeight(variants);

  function update(idx: number, patch: Partial<ExperimentVariant>) {
    const next = variants.map((v, i) => (i === idx ? { ...v, ...patch } : v));
    onChange(next);
  }

  function remove(idx: number) {
    onChange(variants.filter((_, i) => i !== idx));
  }

  function add() {
    onChange([...variants, { name: "", weight: 50, data: {} }]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">
          Variants
        </label>
        <span
          className={cn(
            "text-xs font-mono",
            total === 100 ? "text-emerald-500" : "text-amber-500",
          )}
        >
          {total}% total
        </span>
      </div>

      {/* Weight distribution bar */}
      {variants.length > 0 && (
        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          {variants.map((v, i) => (
            <div
              key={i}
              className={cn("transition-all", variantColor(i))}
              style={{ width: total > 0 ? `${(v.weight / total) * 100}%` : "0%" }}
            />
          ))}
        </div>
      )}

      {variants.map((v, i) => (
        <div
          key={i}
          className="flex items-start gap-2 rounded-md border border-border bg-background p-3"
        >
          <div
            className={cn("mt-2.5 h-3 w-3 shrink-0 rounded-full", variantColor(i))}
          />
          <div className="flex-1 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                value={v.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="e.g. control"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={v.weight}
                  onChange={(e) =>
                    update(i, { weight: Math.max(0, Number(e.target.value)) })
                  }
                  className="w-20 rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
            </div>
            <textarea
              value={v.data ? JSON.stringify(v.data, null, 2) : ""}
              onChange={(e) => {
                try {
                  update(i, { data: JSON.parse(e.target.value) });
                } catch {
                  /* let them keep typing */
                }
              }}
              placeholder='{"key": "value"}'
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            className="mt-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Plus className="h-3 w-3" />
        Add Variant
      </button>
    </div>
  );
}

/* ── Create / Edit Form ───────────────────────────────────────────── */

interface ExperimentFormProps {
  initial?: Experiment;
  onSubmit: (params: Parameters<typeof satori.setupExperiment>[0]) => void;
  onCancel: () => void;
  isPending: boolean;
}

function ExperimentForm({
  initial,
  onSubmit,
  onCancel,
  isPending,
}: ExperimentFormProps) {
  const isEdit = !!initial;
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [audiences, setAudiences] = useState(
    initial?.audiences?.join(", ") ?? "",
  );
  const [variants, setVariants] = useState<ExperimentVariant[]>(
    initial?.variants?.length
      ? initial.variants
      : [
          { name: "control", weight: 50, data: {} },
          { name: "variant_a", weight: 50, data: {} },
        ],
  );

  const total = totalWeight(variants);
  const validVariants =
    variants.length >= 2 && variants.every((v) => v.name.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim() || !validVariants) return;

    const audArr = audiences
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);

    onSubmit({
      id: id.trim(),
      name: name.trim(),
      variants_json: JSON.stringify(variants),
      enabled,
      audiences_json: audArr.length > 0 ? JSON.stringify(audArr) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">
            {isEdit ? "Edit Experiment" : "Create Experiment"}
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Experiment ID *
              </label>
              <input
                required
                disabled={isEdit}
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="e.g. shop_layout_test"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Display Name *
              </label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shop Layout Test"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this experiment testing?"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 resize-none"
            />
          </div>

          <VariantEditor variants={variants} onChange={setVariants} />

          {total !== 100 && variants.length >= 2 && (
            <p className="flex items-center gap-1.5 text-xs text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" />
              Variant weights should sum to 100% (currently {total}%)
            </p>
          )}

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
            disabled={
              !id.trim() || !name.trim() || !validVariants || isPending
            }
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {isEdit ? "Save Changes" : "Create Experiment"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Experiment Card ──────────────────────────────────────────────── */

interface ExperimentCardProps {
  experiment: Experiment;
  onEdit: (exp: Experiment) => void;
  onToggle: (exp: Experiment) => void;
  isToggling: boolean;
}

function ExperimentCard({
  experiment: exp,
  onEdit,
  onToggle,
  isToggling,
}: ExperimentCardProps) {
  const { copied, copy } = useCopyToClipboard();
  const total = totalWeight(exp.variants ?? []);

  return (
    <div
      className={cn(
        "group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80",
        !exp.enabled && "opacity-70",
      )}
    >
      <div className="flex items-start gap-4">
        {/* Toggle */}
        <button
          onClick={() => onToggle(exp)}
          disabled={isToggling}
          className="mt-0.5 shrink-0 transition-colors"
          title={exp.enabled ? "Disable experiment" : "Enable experiment"}
        >
          {isToggling ? (
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
          ) : exp.enabled ? (
            <ToggleRight className="h-7 w-7 text-emerald-500" />
          ) : (
            <ToggleLeft className="h-7 w-7 text-muted-foreground" />
          )}
        </button>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-2.5">
          {/* Header */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{exp.name}</span>
            <div className="flex items-center gap-1">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {exp.id}
              </code>
              <button
                onClick={() => copy(exp.id, exp.id)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Copy ID"
              >
                {copied === exp.id ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
                )}
              </button>
            </div>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                exp.enabled
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {exp.enabled ? "running" : "paused"}
            </span>
          </div>

          {/* Description */}
          {exp.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {exp.description}
            </p>
          )}

          {/* Variant distribution bar */}
          {exp.variants && exp.variants.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex h-2.5 overflow-hidden rounded-full bg-muted">
                {exp.variants.map((v, i) => (
                  <div
                    key={i}
                    className={cn("transition-all", variantColor(i))}
                    style={{
                      width: total > 0 ? `${(v.weight / total) * 100}%` : "0%",
                    }}
                    title={`${v.name}: ${v.weight}%`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {exp.variants.map((v, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    <span
                      className={cn(
                        "inline-block h-2 w-2 rounded-full",
                        variantColor(i),
                      )}
                    />
                    <span className="font-medium text-foreground/80">
                      {v.name || "unnamed"}
                    </span>
                    <span className="tabular-nums">{v.weight}%</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <BarChart3 className="h-3 w-3" />
              {exp.variants?.length ?? 0} variant
              {(exp.variants?.length ?? 0) !== 1 ? "s" : ""}
            </span>
            {exp.audiences && exp.audiences.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users className="h-3 w-3" />
                {exp.audiences.join(", ")}
              </span>
            )}
            {exp.updated_at && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(exp.updated_at)}
              </span>
            )}
          </div>
        </div>

        {/* Edit */}
        <button
          onClick={() => onEdit(exp)}
          className="shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100"
          title="Edit experiment"
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
            No experiments match your search
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different search term or clear your filters.
          </p>
        </>
      ) : (
        <>
          <FlaskConical className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No experiments configured
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Create your first A/B test to optimise player experiences.
          </p>
        </>
      )}
    </div>
  );
}

/* ── Error State ───────────────────────────────────────────────────── */

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
      <p className="mt-3 text-sm font-medium text-destructive">
        Failed to load experiments
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

/* ── Main Page ─────────────────────────────────────────────────────── */

export function ExperimentsPage() {
  const experiments = useExperiments();
  const setup = useSetupExperiment();

  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Experiment | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = experiments.data ?? [];
    if (filterMode === "enabled") list = list.filter((e) => e.enabled);
    if (filterMode === "disabled") list = list.filter((e) => !e.enabled);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          e.description?.toLowerCase().includes(q) ||
          e.audiences?.some((a) => a.toLowerCase().includes(q)) ||
          e.variants?.some((v) => v.name.toLowerCase().includes(q)),
      );
    }
    return list;
  }, [experiments.data, search, filterMode]);

  const counts = useMemo(() => {
    const all = experiments.data ?? [];
    return {
      total: all.length,
      enabled: all.filter((e) => e.enabled).length,
      disabled: all.filter((e) => !e.enabled).length,
    };
  }, [experiments.data]);

  const handleToggle = useCallback(
    (exp: Experiment) => {
      if (!window.confirm(`${exp.enabled ? "Disable" : "Enable"} experiment "${exp.id}" in production?`)) {
        return;
      }
      setTogglingId(exp.id);
      setup.mutate(
        {
          id: exp.id,
          name: exp.name,
          variants_json: JSON.stringify(exp.variants ?? []),
          enabled: !exp.enabled,
        },
        { onSettled: () => setTogglingId(null) },
      );
    },
    [setup],
  );

  const handleFormSubmit = useCallback(
    (params: Parameters<typeof satori.setupExperiment>[0]) => {
      if (!window.confirm(`Save experiment "${params.id}" in production?`)) {
        return;
      }
      setup.mutate(params, {
        onSuccess: () => {
          setShowForm(false);
          setEditing(null);
        },
      });
    },
    [setup],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <FlaskConical className="h-6 w-6 text-primary" />
            Experiments
          </h2>
          <p className="text-muted-foreground">
            Run A/B tests and manage experiment variants with audience targeting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {experiments.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => experiments.refetch()}
            disabled={experiments.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                experiments.isFetching && "animate-spin",
              )}
            />
            Refresh
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            New Experiment
          </button>
        </div>
      </div>

      {/* Stats bar */}
      {experiments.data && experiments.data.length > 0 && (
        <div className="flex gap-3">
          <StatPill
            label="Total"
            count={counts.total}
            active={filterMode === "all"}
            onClick={() => setFilterMode("all")}
          />
          <StatPill
            label="Running"
            count={counts.enabled}
            active={filterMode === "enabled"}
            onClick={() => setFilterMode("enabled")}
            color="emerald"
          />
          <StatPill
            label="Paused"
            count={counts.disabled}
            active={filterMode === "disabled"}
            onClick={() => setFilterMode("disabled")}
            color="zinc"
          />
        </div>
      )}

      {/* Search */}
      {experiments.data && experiments.data.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, ID, variant, or audience..."
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
      {experiments.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : experiments.isError ? (
        <ErrorState
          message={
            experiments.error instanceof Error
              ? experiments.error.message
              : "Unknown error"
          }
          onRetry={() => experiments.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          filtered={search.trim().length > 0 || filterMode !== "all"}
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <Filter className="mr-1 inline h-3 w-3" />
            Showing {filtered.length} of {counts.total} experiment
            {counts.total !== 1 && "s"}
          </p>
          {filtered.map((exp) => (
            <ExperimentCard
              key={exp.id}
              experiment={exp}
              onEdit={(e) => {
                setEditing(e);
                setShowForm(true);
              }}
              onToggle={handleToggle}
              isToggling={togglingId === exp.id}
            />
          ))}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <ExperimentForm
          initial={editing ?? undefined}
          onSubmit={handleFormSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={setup.isPending}
        />
      )}
    </div>
  );
}


export default ExperimentsPage;
