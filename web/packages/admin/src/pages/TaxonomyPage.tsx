import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Tags,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Check,
  Trash2,
  Pencil,
  ShieldCheck,
  ShieldOff,
  AlertTriangle,
  Search,
} from "lucide-react";
import { serverKeyAuth, satori, type TaxonomySchema } from "@nakama/shared";
import { cn } from "@/lib/utils";

function useSchemas() {
  return useQuery({
    queryKey: ["admin", "taxonomy"],
    queryFn: () => satori.getTaxonomySchemas(serverKeyAuth()),
    retry: 1,
  });
}

interface SchemaFormProps {
  initial?: TaxonomySchema;
  categories: string[];
  onSubmit: (s: {
    name: string;
    description?: string;
    category?: string;
    requiredMetadata?: string[];
    optionalMetadata?: string[];
    deprecated?: boolean;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}

function SchemaForm({ initial, categories, onSubmit, onCancel, isPending }: SchemaFormProps) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? categories[0] ?? "custom");
  const [required, setRequired] = useState((initial?.requiredMetadata ?? []).join(", "));
  const [optional, setOptional] = useState((initial?.optionalMetadata ?? []).join(", "));
  const [deprecated, setDeprecated] = useState(initial?.deprecated ?? false);

  const split = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name: name.trim(),
            description: description.trim(),
            category,
            requiredMetadata: split(required),
            optionalMetadata: split(optional),
            deprecated,
          });
        }}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? "Edit Event Schema" : "New Event Schema"}</h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium">Event name</label>
            <input
              required
              disabled={isEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. quiz_complete"
              className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this event represents"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
            >
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">Required metadata</label>
              <input
                value={required}
                onChange={(e) => setRequired(e.target.value)}
                placeholder="score, quiz_id"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">Optional metadata</label>
              <input
                value={optional}
                onChange={(e) => setOptional(e.target.value)}
                placeholder="duration, source"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={deprecated} onChange={(e) => setDeprecated(e.target.checked)} />
            Mark as deprecated
          </label>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">
            Cancel
          </button>
          <button type="submit" disabled={!name.trim() || isPending} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {isEdit ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function TaxonomyPage() {
  const qc = useQueryClient();
  const schemas = useSchemas();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TaxonomySchema | null>(null);
  const [search, setSearch] = useState("");

  const upsert = useMutation({
    mutationFn: (s: Parameters<typeof satori.upsertTaxonomySchema>[0]) => satori.upsertTaxonomySchema(s, serverKeyAuth()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "taxonomy"] });
      setShowForm(false);
      setEditing(null);
    },
  });
  const del = useMutation({
    mutationFn: (name: string) => satori.deleteTaxonomySchema(name, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "taxonomy"] }),
  });
  const strict = useMutation({
    mutationFn: (enabled: boolean) => satori.setTaxonomyStrictMode(enabled, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "taxonomy"] }),
  });

  const list = useMemo(() => {
    const all = Object.values(schemas.data?.schemas ?? {});
    const q = search.trim().toLowerCase();
    const filtered = q ? all.filter((s) => s.name.toLowerCase().includes(q) || (s.category ?? "").includes(q)) : all;
    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [schemas.data, search]);

  const enforceStrict = schemas.data?.enforceStrict ?? false;
  const categories = schemas.data?.categories ?? ["engagement", "monetization", "progression", "social", "system", "custom"];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Taxonomy</h2>
          <p className="text-muted-foreground">Define and govern your event schemas.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => strict.mutate(!enforceStrict)}
            disabled={strict.isPending}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
              enforceStrict
                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            title="When strict mode is on, events without a registered schema are rejected"
          >
            {strict.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : enforceStrict ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
            Strict mode: {enforceStrict ? "On" : "Off"}
          </button>
          <button onClick={() => schemas.refetch()} disabled={schemas.isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", schemas.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true); }} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4" />
            New Schema
          </button>
        </div>
      </div>

      {enforceStrict && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          Strict mode is ON — events whose name has no registered schema below will be <strong>rejected</strong> at capture.
        </div>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search schemas…"
          className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-4 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
      </div>

      {schemas.isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-16 text-center">
          <Tags className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">No event schemas yet</p>
          <p className="mt-1 text-xs text-muted-foreground/60">Register schemas to validate incoming events.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Event</th>
                <th className="px-4 py-2.5 font-medium">Category</th>
                <th className="px-4 py-2.5 font-medium">Required</th>
                <th className="px-4 py-2.5 font-medium">Optional</th>
                <th className="px-4 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.name} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-mono font-medium">{s.name}</span>
                    {s.deprecated && <span className="ml-2 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] uppercase text-destructive">deprecated</span>}
                    {s.description && <p className="mt-0.5 text-xs text-muted-foreground">{s.description}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{s.category || "custom"}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{(s.requiredMetadata ?? []).join(", ") || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{(s.optionalMetadata ?? []).join(", ") || "—"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditing(s); setShowForm(true); }} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { if (window.confirm(`Delete schema "${s.name}"?`)) del.mutate(s.name); }}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <SchemaForm
          initial={editing ?? undefined}
          categories={categories}
          onSubmit={(s) => upsert.mutate(s)}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          isPending={upsert.isPending}
        />
      )}
    </div>
  );
}

export default TaxonomyPage;
