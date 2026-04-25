import { useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Gamepad2,
  Search,
  RefreshCw,
  Loader2,
  X,
  Copy,
  CheckCircle2,
  Users,
  ChevronDown,
  ChevronRight,
  Zap,
  Server,
  Tag,
  Clock,
  AlertTriangle,
  Radio,
  Wifi,
  Hash,
  Activity,
} from "lucide-react";
import { serverKeyAuth, nakama } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Types ────────────────────────────────────────────────────────── */

interface MatchPresence {
  user_id: string;
  session_id: string;
  username: string;
  node: string;
  status?: string;
}

interface Match {
  match_id: string;
  authoritative: boolean;
  label?: string;
  size: number;
  handler_name?: string;
  tick_rate?: number;
  presences?: MatchPresence[];
}

interface MatchList {
  matches?: Match[];
}

/* ── Hooks ─────────────────────────────────────────────────────────── */

const PAGE_SIZE = 50;

function useMatches(label: string) {
  return useQuery<MatchList>({
    queryKey: ["nakama", "matches", label],
    queryFn: () =>
      nakama.listMatches({
        ...serverKeyAuth(),
        limit: PAGE_SIZE,
        label: label || undefined,
      }),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function tryParseLabel(label?: string): Record<string, unknown> | null {
  if (!label) return null;
  try {
    return JSON.parse(label);
  } catch {
    return null;
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

/* ── Presence Row ──────────────────────────────────────────────────── */

function PresenceRow({ p }: { p: MatchPresence }) {
  const { copied, copy } = useCopyToClipboard();

  return (
    <div className="flex items-center justify-between rounded-md border border-border/60 bg-background/50 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10">
          <Wifi className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-medium">{p.username || "anonymous"}</p>
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono">{p.user_id.slice(0, 8)}…</span>
            <span className="text-border">·</span>
            <span>{p.node}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => copy(p.user_id, `uid-${p.user_id}`)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Copy user ID"
        >
          {copied === `uid-${p.user_id}` ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={() => copy(p.session_id, `sid-${p.session_id}`)}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Copy session ID"
        >
          {copied === `sid-${p.session_id}` ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          ) : (
            <Hash className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

/* ── Match Card ────────────────────────────────────────────────────── */

function MatchCard({
  match,
  isExpanded,
  onToggle,
}: {
  match: Match;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { copied, copy } = useCopyToClipboard();
  const parsedLabel = useMemo(
    () => tryParseLabel(match.label),
    [match.label],
  );

  return (
    <div className="rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 p-4 text-left"
      >
        <div className="min-w-0 flex-1 space-y-2">
          {/* Match ID line */}
          <div className="flex flex-wrap items-center gap-2">
            <Gamepad2 className="h-4 w-4 shrink-0 text-primary" />
            <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {match.match_id}
            </code>
            <button
              onClick={(e) => {
                e.stopPropagation();
                copy(match.match_id, match.match_id);
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              title="Copy match ID"
            >
              {copied === match.match_id ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>

          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <Radio className="h-2.5 w-2.5" />
              Live
            </span>
            {match.authoritative && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                <Server className="h-2.5 w-2.5" />
                Authoritative
              </span>
            )}
            {!match.authoritative && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Relayed
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">
              <Users className="h-2.5 w-2.5" />
              {match.size} player{match.size !== 1 ? "s" : ""}
            </span>
            {match.tick_rate != null && match.tick_rate > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                <Zap className="h-2.5 w-2.5" />
                {match.tick_rate} tick/s
              </span>
            )}
          </div>

          {/* Handler + label summary */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {match.handler_name && (
              <span className="inline-flex items-center gap-1">
                <Activity className="h-3 w-3" />
                {match.handler_name}
              </span>
            )}
            {match.label && !parsedLabel && (
              <span className="inline-flex items-center gap-1 truncate">
                <Tag className="h-3 w-3 shrink-0" />
                <span className="truncate">{match.label}</span>
              </span>
            )}
            {parsedLabel && (
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" />
                JSON label ({Object.keys(parsedLabel).length} fields)
              </span>
            )}
          </div>
        </div>

        {/* Expand chevron */}
        <div className="mt-1 shrink-0 text-muted-foreground">
          {isExpanded ? (
            <ChevronDown className="h-5 w-5" />
          ) : (
            <ChevronRight className="h-5 w-5" />
          )}
        </div>
      </button>

      {/* Expanded Detail */}
      {isExpanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Metadata grid */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetaItem
              icon={<Gamepad2 className="h-4 w-4" />}
              label="Match ID"
              value={match.match_id}
              mono
            />
            <MetaItem
              icon={<Server className="h-4 w-4" />}
              label="Type"
              value={match.authoritative ? "Authoritative" : "Relayed"}
            />
            <MetaItem
              icon={<Users className="h-4 w-4" />}
              label="Players"
              value={String(match.size)}
            />
            <MetaItem
              icon={<Zap className="h-4 w-4" />}
              label="Tick Rate"
              value={
                match.tick_rate != null && match.tick_rate > 0
                  ? `${match.tick_rate}/s`
                  : "N/A"
              }
            />
            {match.handler_name && (
              <MetaItem
                icon={<Activity className="h-4 w-4" />}
                label="Handler"
                value={match.handler_name}
              />
            )}
          </div>

          {/* Label */}
          {match.label && (
            <div>
              <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Tag className="h-3.5 w-3.5" />
                Label
              </h4>
              {parsedLabel ? (
                <pre className="max-h-60 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs text-foreground">
                  {JSON.stringify(parsedLabel, null, 2)}
                </pre>
              ) : (
                <div className="rounded-md border border-border bg-muted/50 p-3">
                  <p className="font-mono text-xs text-foreground break-all">
                    {match.label}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Presences */}
          <div>
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Presences ({match.presences?.length ?? 0})
            </h4>
            {match.presences && match.presences.length > 0 ? (
              <div className="space-y-1.5">
                {match.presences.map((p) => (
                  <PresenceRow key={p.session_id} p={p} />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No presences reported
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Meta Item ─────────────────────────────────────────────────────── */

function MetaItem({
  icon,
  label,
  value,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-background/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={cn(
          "mt-0.5 truncate text-sm font-medium",
          mono && "font-mono text-xs",
        )}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

/* ── Empty / Error States ─────────────────────────────────────────── */

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {hasFilter ? (
        <>
          <Search className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No matches found for this label
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different label filter or clear the search.
          </p>
        </>
      ) : (
        <>
          <Gamepad2 className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No active matches
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Matches will appear here when players start games.
          </p>
        </>
      )}
    </div>
  );
}

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
        Failed to load matches
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

/* ── Summary Stats ─────────────────────────────────────────────────── */

function SummaryStats({ matches }: { matches: Match[] }) {
  const totalPlayers = matches.reduce((s, m) => s + m.size, 0);
  const authCount = matches.filter((m) => m.authoritative).length;
  const relayedCount = matches.length - authCount;

  const stats = [
    {
      label: "Active Matches",
      value: String(matches.length),
      icon: <Gamepad2 className="h-4 w-4" />,
      color: "text-primary",
    },
    {
      label: "Total Players",
      value: String(totalPlayers),
      icon: <Users className="h-4 w-4" />,
      color: "text-emerald-600 dark:text-emerald-400",
    },
    {
      label: "Authoritative",
      value: String(authCount),
      icon: <Server className="h-4 w-4" />,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      label: "Relayed",
      value: String(relayedCount),
      icon: <Radio className="h-4 w-4" />,
      color: "text-muted-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-center gap-2">
            <div className={cn("shrink-0", s.color)}>{s.icon}</div>
            <span className="text-xs font-medium text-muted-foreground">
              {s.label}
            </span>
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight">{s.value}</p>
        </div>
      ))}
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export function MatchesPage() {
  const [labelFilter, setLabelFilter] = useState("");
  const [appliedLabel, setAppliedLabel] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const matches = useMatches(appliedLabel);

  const matchList = useMemo(
    () => (matches.data?.matches ?? []) as Match[],
    [matches.data],
  );

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setAppliedLabel(labelFilter.trim());
    setExpanded(new Set());
  }

  function toggleExpand(matchId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(matchId)) {
        next.delete(matchId);
      } else {
        next.add(matchId);
      }
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(matchList.map((m) => m.match_id)));
  }

  function collapseAll() {
    setExpanded(new Set());
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Gamepad2 className="h-6 w-6 text-primary" />
            Match Inspector
          </h2>
          <p className="text-muted-foreground">
            View active matches, player presences, and match metadata.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Auto-refreshing
          </div>
          {matches.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => matches.refetch()}
            disabled={matches.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                matches.isFetching && "animate-spin",
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary stats */}
      {!matches.isLoading && !matches.isError && matchList.length > 0 && (
        <SummaryStats matches={matchList} />
      )}

      {/* Search bar */}
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          placeholder="Filter by match label (e.g. game mode, map name)..."
          className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-20 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        {labelFilter && (
          <button
            type="button"
            onClick={() => {
              setLabelFilter("");
              setAppliedLabel("");
              setExpanded(new Set());
            }}
            className="absolute right-14 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="submit"
          className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Filter
        </button>
      </form>

      {/* Content */}
      {matches.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : matches.isError ? (
        <ErrorState
          message={
            matches.error instanceof Error
              ? matches.error.message
              : "Unknown error"
          }
          onRetry={() => matches.refetch()}
        />
      ) : matchList.length === 0 ? (
        <EmptyState hasFilter={appliedLabel.length > 0} />
      ) : (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {matchList.length} active match
              {matchList.length !== 1 ? "es" : ""}
              {appliedLabel && (
                <span>
                  {" "}
                  matching{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono">
                    {appliedLabel}
                  </code>
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={expandAll}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Expand all
              </button>
              <span className="text-border">·</span>
              <button
                onClick={collapseAll}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Collapse all
              </button>
            </div>
          </div>

          {/* Match list */}
          <div className="space-y-3">
            {matchList.map((m) => (
              <MatchCard
                key={m.match_id}
                match={m}
                isExpanded={expanded.has(m.match_id)}
                onToggle={() => toggleExpand(m.match_id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export { MatchesPage as default };

export default MatchesPage;
