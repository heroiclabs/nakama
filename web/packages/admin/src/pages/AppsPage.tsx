import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Check,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Search,
  Trash2,
  Tag,
  Info,
} from "lucide-react";
import { serverKeyAuth, satori, type RegisteredApp } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Queries / Mutations ──────────────────────────────────────────── */

function useApps() {
  return useQuery({
    queryKey: ["admin", "apps"],
    queryFn: () => satori.getGameRegistry(serverKeyAuth()),
    select: (d) => d.games ?? [],
    retry: 1,
  });
}

function useRegisterApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof satori.registerApp>[0]) =>
      satori.registerApp(params, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "apps"] }),
  });
}

function useDeleteApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => satori.deleteApp(id, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin", "apps"] }),
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

/* ── Register Dialog ──────────────────────────────────────────────── */

interface AppFormProps {
  onSubmit: (params: {
    title: string;
    id?: string;
    slug?: string;
    category?: string;
    iconUrl?: string;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
}

function AppForm({ onSubmit, onCancel, isPending }: AppFormProps) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [category, setCategory] = useState("");
  const [iconUrl, setIconUrl] = useState("");
  const [id, setId] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params: Parameters<typeof onSubmit>[0] = { title: title.trim() };
    if (id.trim()) params.id = id.trim();
    if (slug.trim()) params.slug = slug.trim().toLowerCase();
    if (category.trim()) params.category = category.trim();
    if (iconUrl.trim()) params.iconUrl = iconUrl.trim();
    onSubmit(params);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Register App</h3>
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
            <label className="mb-1.5 block text-sm font-medium">App Name</label>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. QuizVerse, TutorX"
              className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Slug{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. tutorx — human-friendly alias"
              className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Category{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. game, learning"
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium">
                Icon URL{" "}
                <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <input
                value={iconUrl}
                onChange={(e) => setIconUrl(e.target.value)}
                placeholder="https://..."
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Existing AppID{" "}
              <span className="font-normal text-muted-foreground">
                (optional — leave blank to auto-generate)
              </span>
            </label>
            <input
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="UUID — only if the app already sends one"
              className="h-10 w-full rounded-md border border-border bg-background px-3 font-mono text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Leave empty and we mint a fresh UUID — that is the AppID your app
              sends as <code className="font-mono">game_id</code> in every
              analytics event.
            </p>
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
            disabled={!title.trim() || isPending}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Register App
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── App Row ──────────────────────────────────────────────────────── */

function AppRow({
  app,
  onDelete,
  deleting,
  highlight,
}: {
  app: RegisteredApp;
  onDelete: (app: RegisteredApp) => void;
  deleting: boolean;
  highlight: boolean;
}) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div
      className={cn(
        "group rounded-lg border bg-card p-4 transition-colors",
        highlight
          ? "border-emerald-500/50 ring-1 ring-emerald-500/30"
          : "border-border hover:border-border/80",
      )}
    >
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-primary/10 text-primary">
          {app.iconUrl ? (
            <img src={app.iconUrl} alt={app.title} className="h-full w-full object-cover" />
          ) : (
            <Boxes className="h-5 w-5" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{app.title}</span>
            {app.slug && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                <Tag className="h-3 w-3" />
                {app.slug}
              </span>
            )}
            {app.category && (
              <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-blue-600 dark:text-blue-400">
                {app.category}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                app.source === "manual"
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {app.source ?? "synced"}
            </span>
          </div>

          {/* AppID */}
          <div className="mt-2 flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              AppID
            </span>
            <code className="rounded bg-muted/50 px-2 py-1 font-mono text-xs text-foreground">
              {app.id}
            </code>
            <button
              onClick={() => copy(app.id, app.id)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Copy AppID"
            >
              {copied === app.id ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {(app.createdAt || app.updatedAt) && (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(app.updatedAt ?? app.createdAt)}
              </span>
            </div>
          )}
        </div>

        <button
          onClick={() => onDelete(app)}
          disabled={deleting}
          className="shrink-0 rounded-md p-2 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
          title="Remove from catalog"
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}

/* ── States ───────────────────────────────────────────────────────── */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {filtered ? (
        <>
          <Search className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No apps match your search
          </p>
        </>
      ) : (
        <>
          <Boxes className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No apps registered yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Register your first app to mint an AppID for analytics.
          </p>
        </>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
      <p className="mt-3 text-sm font-medium text-destructive">Failed to load apps</p>
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

/* ── Onboarding hint ──────────────────────────────────────────────── */

function OnboardingHint() {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="text-xs text-muted-foreground">
          <p className="font-medium text-foreground">How AppID registration works</p>
          <p className="mt-1">
            1. Register an app here → we mint a UUID <em>AppID</em>. 2. Hand that
            AppID to the app team — they stamp it as{" "}
            <code className="font-mono">game_id</code> on every{" "}
            <code className="font-mono">analytics_log_event</code> call. 3. The
            app's events flow into every console surface automatically, filterable
            by that AppID. No deploy required.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────────────────── */

export function AppsPage() {
  const apps = useApps();
  const register = useRegisterApp();
  const remove = useDeleteApp();
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = apps.data ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        a.slug?.toLowerCase().includes(q),
    );
  }, [apps.data, search]);

  const handleSubmit = useCallback(
    (params: Parameters<typeof satori.registerApp>[0]) => {
      register.mutate(params, {
        onSuccess: (res) => {
          setShowForm(false);
          setJustCreatedId(res.game.id);
          setTimeout(() => setJustCreatedId(null), 6000);
        },
        onError: (err) => {
          window.alert(
            err instanceof Error ? err.message : "Failed to register app",
          );
        },
      });
    },
    [register],
  );

  const handleDelete = useCallback(
    (app: RegisteredApp) => {
      if (
        !window.confirm(
          `Remove "${app.title}" from the catalog?\n\nThis only forgets the display metadata — historical analytics keyed on ${app.id} are kept.`,
        )
      ) {
        return;
      }
      setDeletingId(app.id);
      remove.mutate(app.id, { onSettled: () => setDeletingId(null) });
    },
    [remove],
  );

  const total = apps.data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Apps</h2>
          <p className="text-muted-foreground">
            Register apps and manage their analytics AppIDs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {apps.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => apps.refetch()}
            disabled={apps.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", apps.isFetching && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Register App
          </button>
        </div>
      </div>

      <OnboardingHint />

      {/* Search */}
      {total > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, AppID, or slug..."
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
      {apps.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : apps.isError ? (
        <ErrorState
          message={apps.error instanceof Error ? apps.error.message : "Unknown error"}
          onRetry={() => apps.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState filtered={search.trim().length > 0} />
      ) : (
        <div className="space-y-3">
          {filtered.map((app) => (
            <AppRow
              key={app.id}
              app={app}
              onDelete={handleDelete}
              deleting={deletingId === app.id}
              highlight={justCreatedId === app.id}
            />
          ))}
        </div>
      )}

      {showForm && (
        <AppForm
          onSubmit={handleSubmit}
          onCancel={() => setShowForm(false)}
          isPending={register.isPending}
        />
      )}
    </div>
  );
}

export default AppsPage;
