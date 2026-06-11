import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  serverKeyAuth,
  satori,
  type DebuggerEvent,
  type DebuggerNameStat,
  type EventTailResponse,
  type EventSearchResponse,
  type IdentityInspection,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const TAIL_INTERVAL_MS = 5_000;

type Mode = "tail" | "search";

function formatTime(ms: number) {
  if (!ms) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(ms));
  } catch {
    return String(ms);
  }
}

/* ── Identity drawer ───────────────────────────────────────────────── */

function PropsTable({
  title,
  props,
}: {
  title: string;
  props: Record<string, string>;
}) {
  const keys = Object.keys(props);
  if (keys.length === 0) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{title}</p>
      <div className="overflow-hidden rounded-md border border-border">
        {keys.map((k) => (
          <div
            key={k}
            className="flex items-center gap-2 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0"
          >
            <span className="w-44 shrink-0 truncate font-mono text-muted-foreground">
              {k}
            </span>
            <span className="min-w-0 flex-1 truncate font-mono">{props[k]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function IdentityDrawer({
  userId,
  onClose,
}: {
  userId: string;
  onClose: () => void;
}) {
  const inspection = useQuery({
    queryKey: ["satori", "identity-inspect", userId],
    queryFn: () =>
      satori.inspectIdentity({ user_id: userId }, serverKeyAuth()),
  });
  const data: IdentityInspection | undefined = inspection.data;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-xl flex-col border-l border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Identity</h3>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {userId}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {inspection.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : inspection.isError ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {inspection.error instanceof Error
                ? inspection.error.message
                : "Failed to inspect identity"}
            </p>
          ) : data ? (
            <>
              {/* Account */}
              {data.account ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold">
                    {data.account.displayName || data.account.username || "—"}
                  </span>
                  {data.account.username && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      @{data.account.username}
                    </code>
                  )}
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider",
                      data.account.online
                        ? "bg-emerald-500/10 text-emerald-500"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        data.account.online ? "bg-emerald-500" : "bg-muted-foreground",
                      )}
                    />
                    {data.account.online ? "online" : "offline"}
                  </span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  External / synthetic identity — no Nakama account record.
                </p>
              )}

              {/* Audiences + experiments */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Audiences ({data.audiences.length}/{data.audiencesEvaluated})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {data.audiences.length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">none</span>
                    ) : (
                      data.audiences.map((a) => (
                        <span
                          key={a}
                          className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary"
                        >
                          {a}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                    Experiments ({data.experiments.length})
                  </p>
                  <div className="space-y-1">
                    {data.experiments.length === 0 ? (
                      <span className="text-xs text-muted-foreground/60">none</span>
                    ) : (
                      data.experiments.map((e) => (
                        <div
                          key={`${e.scope}-${e.experimentId}`}
                          className="flex items-center gap-1.5 text-[11px]"
                        >
                          <span className="truncate font-mono">{e.experimentId}</span>
                          <span className="rounded bg-violet-500/10 px-1.5 py-0.5 font-mono text-violet-500">
                            {e.variantId}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Properties */}
              <PropsTable title="Default properties" props={data.properties.defaultProperties} />
              <PropsTable title="Custom properties" props={data.properties.customProperties} />
              <PropsTable title="Computed properties" props={data.properties.computedProperties} />

              {/* Timeline */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  Event timeline (showing {data.timeline.length} of {data.timelineTotal})
                </p>
                {data.timeline.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">
                    No events recorded for this identity.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-md border border-border">
                    {data.timeline.map((ev, i) => (
                      <div
                        key={`${ev.timestampMs}-${i}`}
                        className="flex items-center gap-3 border-b border-border px-2.5 py-1.5 text-xs last:border-b-0"
                      >
                        <span className="w-36 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                          {formatTime(ev.timestampMs)}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono font-medium">
                          {ev.name}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ── Event row ─────────────────────────────────────────────────────── */

function EventRow({
  event,
  onInspect,
}: {
  event: DebuggerEvent;
  onInspect: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const hasMeta = event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm">
        <button
          onClick={() => hasMeta && setOpen((o) => !o)}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-3 text-left",
            hasMeta && "cursor-pointer hover:opacity-80",
          )}
        >
          <span className="w-4 shrink-0 text-muted-foreground">
            {hasMeta ? (
              open ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )
            ) : null}
          </span>
          <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {formatTime(event.timestampMs)}
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
            {event.name}
          </span>
        </button>
        {event.external && (
          <span className="shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-500">
            external
          </span>
        )}
        <button
          onClick={() => event.userId && onInspect(event.userId)}
          disabled={!event.userId}
          className="w-64 shrink-0 truncate text-left font-mono text-[11px] text-muted-foreground transition-colors hover:text-primary hover:underline disabled:no-underline"
          title="Inspect identity"
        >
          {event.userId || "—"}
        </button>
      </div>
      {open && hasMeta && (
        <pre className="mx-10 mb-2 overflow-x-auto rounded-md bg-muted/50 p-3 font-mono text-[11px] text-muted-foreground">
          {JSON.stringify(event.metadata, null, 2)}
        </pre>
      )}
    </div>
  );
}

/* ── Name / taxonomy sidebar ───────────────────────────────────────── */

function NameStats({
  names,
  onFilter,
  activeName,
}: {
  names: DebuggerNameStat[];
  onFilter: (name: string | null) => void;
  activeName: string | null;
}) {
  const qc = useQueryClient();
  const register = useMutation({
    mutationFn: (name: string) =>
      satori.upsertTaxonomySchema(
        { name, description: "Registered from Event Debugger", category: "custom" },
        serverKeyAuth(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["satori", "debugger"] }),
  });

  if (names.length === 0) return null;

  return (
    <div className="space-y-1">
      <p className="px-1 text-xs font-medium text-muted-foreground">
        Event names in view
      </p>
      {names.map((n) => (
        <div
          key={n.name}
          className={cn(
            "flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5",
            activeName === n.name && "border-primary bg-primary/5",
          )}
        >
          <button
            onClick={() => onFilter(activeName === n.name ? null : n.name)}
            className="min-w-0 flex-1 truncate text-left font-mono text-xs hover:text-primary"
            title={`Filter by ${n.name}`}
          >
            {n.name}
          </button>
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-muted-foreground">
            {n.count}
          </span>
          {n.hasSchema ? (
            <CheckCircle2
              className="h-3.5 w-3.5 shrink-0 text-emerald-500"
              aria-label="Schema registered"
            />
          ) : (
            <button
              onClick={() => register.mutate(n.name)}
              disabled={register.isPending}
              className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
              title="No taxonomy schema — click to register"
            >
              {register.isPending && register.variables === n.name ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Register"
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */

export function EventDebuggerPage() {
  const [mode, setMode] = useState<Mode>("tail");
  const [live, setLive] = useState(true);
  const [nameFilter, setNameFilter] = useState<string | null>(null);
  const [nameContains, setNameContains] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [sinceHours, setSinceHours] = useState(24);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      limit: mode === "tail" ? 150 : 300,
      ...(nameFilter ? { name: nameFilter } : {}),
      ...(nameContains.trim() ? { name_contains: nameContains.trim() } : {}),
      ...(userFilter.trim() ? { user_id: userFilter.trim() } : {}),
      ...(mode === "search"
        ? { since_ms: Date.now() - sinceHours * 3600_000 }
        : {}),
    }),
    [mode, nameFilter, nameContains, userFilter, sinceHours],
  );

  const query = useQuery<EventTailResponse | EventSearchResponse>({
    queryKey: ["satori", "debugger", mode, filters],
    queryFn: (): Promise<EventTailResponse | EventSearchResponse> =>
      mode === "tail"
        ? satori.tailEvents(filters, serverKeyAuth())
        : satori.searchEvents(filters, serverKeyAuth()),
    refetchInterval: mode === "tail" && live ? TAIL_INTERVAL_MS : false,
  });

  const events: DebuggerEvent[] = query.data?.events ?? [];
  const names: DebuggerNameStat[] = query.data?.names ?? [];
  const searchMeta: EventSearchResponse | null =
    mode === "search" && query.data && "scannedRecords" in query.data
      ? (query.data as EventSearchResponse)
      : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Activity className="h-6 w-6 text-primary" />
            Event Debugger
          </h2>
          <p className="text-muted-foreground">
            Watch captured Satori events live and register unknown names in the
            taxonomy — no Satori Cloud needed.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {mode === "tail" && (
            <button
              onClick={() => setLive((l) => !l)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors",
                live
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-card text-muted-foreground hover:bg-accent",
              )}
            >
              {live ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {live ? "Live" : "Paused"}
            </button>
          )}
          <button
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", query.isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* Mode tabs + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {(["tail", "search"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "rounded px-3 py-1.5 text-xs font-medium transition-colors",
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "tail" ? "Live Tail" : "Search History"}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={nameContains}
            onChange={(e) => setNameContains(e.target.value)}
            placeholder="Event name contains..."
            className="h-9 w-52 rounded-md border border-border bg-card pl-8 pr-3 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-primary"
          />
        </div>
        <input
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
          placeholder="User / identity ID..."
          className="h-9 w-64 rounded-md border border-border bg-card px-3 font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground/60 focus:border-primary"
        />
        {mode === "search" && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Last
            <select
              value={sinceHours}
              onChange={(e) => setSinceHours(Number(e.target.value))}
              className="h-9 rounded-md border border-border bg-card px-2 text-xs"
            >
              <option value={1}>1 hour</option>
              <option value={6}>6 hours</option>
              <option value={24}>24 hours</option>
              <option value={72}>3 days</option>
              <option value={168}>7 days</option>
            </select>
          </label>
        )}
        {nameFilter && (
          <button
            onClick={() => setNameFilter(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary"
          >
            {nameFilter}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Scan stats for search mode */}
      {searchMeta && (
        <p className="text-xs text-muted-foreground">
          Scanned {searchMeta.scannedRecords.toLocaleString()} records across{" "}
          {searchMeta.scannedPages} pages.
          {searchMeta.truncated && (
            <span className="ml-1 inline-flex items-center gap-1 text-amber-500">
              <AlertTriangle className="h-3 w-3" />
              Results truncated — narrow your filters.
            </span>
          )}
        </p>
      )}

      {/* Content */}
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          {query.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : query.isError ? (
            <div className="p-8 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
              <p className="mt-3 text-sm font-medium text-destructive">
                Failed to load events
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {query.error instanceof Error ? query.error.message : "Unknown error"}
              </p>
            </div>
          ) : events.length === 0 ? (
            <div className="p-16 text-center">
              <Activity className="mx-auto h-10 w-10 text-muted-foreground/40" />
              <p className="mt-3 text-sm font-medium text-muted-foreground">
                No events {mode === "tail" ? "in the live buffer" : "match your search"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                {mode === "tail"
                  ? "Events appear here as clients send them (satori_event RPC)."
                  : "Try a wider time range or fewer filters."}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <span className="w-4" />
                <span className="w-40 shrink-0">Time</span>
                <span className="flex-1">Event</span>
                <span className="w-64 shrink-0">User / Identity</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {events.map((ev, i) => (
                  <EventRow
                    key={`${ev.timestampMs}-${ev.name}-${i}`}
                    event={ev}
                    onInspect={setInspecting}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        <NameStats names={names} onFilter={setNameFilter} activeName={nameFilter} />
      </div>

      {inspecting && (
        <IdentityDrawer userId={inspecting} onClose={() => setInspecting(null)} />
      )}
    </div>
  );
}

export default EventDebuggerPage;
