import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Users,
  Search,
  RefreshCw,
  Loader2,
  X,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Filter,
  Hash,
  FileJson,
  ChevronDown,
  ChevronRight,
  Calculator,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  type Audience,
  type AudienceEstimate,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const GLOBAL_CONFIG_SCOPE = "global";

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

/* ── Queries ──────────────────────────────────────────────────────── */

function useAudiences(gameScope: string) {
  return useQuery({
    queryKey: ["satori", "audiences", gameScope],
    queryFn: () => satori.listAudiences(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d: { audiences?: Audience[] }) => d.audiences ?? [],
    staleTime: 30_000,
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

function formatNumber(n?: number) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

/* ── JSON Viewer ──────────────────────────────────────────────────── */

function JsonBlock({ data, label }: { data?: Record<string, unknown>; label: string }) {
  const [open, setOpen] = useState(false);
  if (!data || Object.keys(data).length === 0) return null;

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        <FileJson className="h-3 w-3" />
        {label}
      </button>
      {open && (
        <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ── Audience Card ────────────────────────────────────────────────── */

interface AudienceCardProps {
  audience: Audience;
  gameScope: string;
}

function AudienceCard({ audience: aud, gameScope }: AudienceCardProps) {
  const { copied, copy } = useCopyToClipboard();
  const estimate = useMutation({
    mutationFn: () =>
      satori.estimateAudience(
        { audienceId: aud.id, game_id: rpcGameId(gameScope) },
        serverKeyAuth(),
      ),
  });
  const est: AudienceEstimate | undefined = estimate.data;

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="space-y-2.5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">
            {aud.name || aud.id}
          </span>
          <div className="flex items-center gap-1">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {aud.id}
            </code>
            <button
              onClick={() => copy(aud.id, aud.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Copy ID"
            >
              {copied === aud.id ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Description */}
        {aud.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {aud.description}
          </p>
        )}

        {/* Size estimate */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => estimate.mutate()}
            disabled={estimate.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {estimate.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Calculator className="h-3 w-3" />
            )}
            {est ? "Re-estimate" : "Estimate size"}
          </button>
          {est && (
            <>
              <span className="text-xs font-semibold tabular-nums">
                ≈ {formatNumber(est.estimatedSize)} users
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                ({(est.matchRate * 100).toFixed(1)}% of{" "}
                {formatNumber(est.scannedIdentities)} scanned identities)
              </span>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(est.matchRate * 100, 100)}%` }}
                />
              </div>
              {est.truncated && (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-500">
                  <AlertTriangle className="h-3 w-3" />
                  partial scan
                </span>
              )}
            </>
          )}
          {estimate.isError && (
            <span className="text-xs text-destructive">
              {estimate.error instanceof Error
                ? estimate.error.message
                : "Estimate failed"}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {aud.member_count != null && (
            <span className="inline-flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {formatNumber(aud.member_count)} member
              {aud.member_count !== 1 && "s"}
            </span>
          )}
          {aud.created_at && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {formatDate(aud.created_at)}
            </span>
          )}
          {aud.updated_at && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Updated {formatDate(aud.updated_at)}
            </span>
          )}
        </div>

        {/* Expandable JSON blocks */}
        <JsonBlock data={aud.rules} label="Rules" />
        <JsonBlock data={aud.conditions} label="Conditions" />
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
            No audiences match your search
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different search term.
          </p>
        </>
      ) : (
        <>
          <Users className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No audiences configured
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Audiences are defined via Satori configuration. Use the Satori
            Config Editor to create segments.
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
        Failed to load audiences
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

export function AudiencesPage() {
  const [gameScope, setGameScope] = useState(GLOBAL_CONFIG_SCOPE);
  const audiences = useAudiences(gameScope);
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = audiences.data ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(q) ||
          a.name?.toLowerCase().includes(q) ||
          a.description?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [audiences.data, search]);

  const total = audiences.data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Users className="h-6 w-6 text-primary" />
            Audiences
          </h2>
          <p className="text-muted-foreground">
            View and manage player segments defined in Satori.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Game ID
            <input
              value={gameScope}
              onChange={(e) => setGameScope(e.target.value || GLOBAL_CONFIG_SCOPE)}
              placeholder="global or quizverse"
              className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          {audiences.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => audiences.refetch()}
            disabled={audiences.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                audiences.isFetching && "animate-spin",
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Search */}
      {total > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or ID..."
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
      {audiences.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : audiences.isError ? (
        <ErrorState
          message={
            audiences.error instanceof Error
              ? audiences.error.message
              : "Unknown error"
          }
          onRetry={() => audiences.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState filtered={search.trim().length > 0} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <Filter className="mr-1 inline h-3 w-3" />
            Showing {filtered.length} of {total} audience
            {total !== 1 && "s"}
          </p>
          {filtered.map((aud) => (
            <AudienceCard key={aud.id} audience={aud} gameScope={gameScope} />
          ))}
        </div>
      )}
    </div>
  );
}


export default AudiencesPage;
