import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  Globe2,
  Check,
  X,
  Ban,
  PackageCheck,
  ChevronDown,
  ChevronRight,
  Calendar,
} from "lucide-react";
import {
  serverKeyAuth,
  quizverse,
  NakamaRpcError,
  type PrizeFulfillment,
  type FulfillmentStatus,
  type SettlePrizeFulfillmentInput,
  type AutoFulfillPrizeInput,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

type StatusFilter = FulfillmentStatus | "all";
type EmailFilter = "all" | "has" | "missing";
type SortOrder = "newest" | "oldest";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "fulfilled", label: "Sent" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const RANK_OPTIONS: { value: number | "all"; label: string }[] = [
  { value: "all", label: "All ranks" },
  { value: 1, label: "1st place only" },
  { value: 2, label: "2nd place only" },
  { value: 3, label: "3rd place only" },
  { value: 4, label: "4th place" },
  { value: 5, label: "5th place" },
];

function formatTs(sec?: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: FulfillmentStatus) {
  switch (status) {
    case "pending":
      return {
        cls: "bg-amber-500/15 border-amber-500/30 text-amber-300",
        label: "Waiting to send",
        icon: <Clock className="h-3.5 w-3.5" />,
      };
    case "fulfilled":
      return {
        cls: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
        label: "Gift card sent",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      };
    case "failed":
      return {
        cls: "bg-red-500/15 border-red-500/30 text-red-300",
        label: "Could not send",
        icon: <Ban className="h-3.5 w-3.5" />,
      };
  }
}

function prizeLabel(f: PrizeFulfillment): string {
  const gc = f.giftCard;
  if (!gc) return "Gift card";
  if (gc.prize) return gc.prize;
  const brand = gc.brand ? String(gc.brand) : "Gift card";
  const value = gc.value ? `${gc.currency || "USD"} ${gc.value}` : "";
  return value ? `${brand} · ${value}` : brand;
}

function rankDisplay(rank: number): { medal: string; label: string } {
  if (rank === 1) return { medal: "🥇", label: "1st place" };
  if (rank === 2) return { medal: "🥈", label: "2nd place" };
  if (rank === 3) return { medal: "🥉", label: "3rd place" };
  if (rank > 0) return { medal: "🏅", label: `${rank}th place` };
  return { medal: "—", label: "No rank" };
}

function regionDisplay(region?: string): string {
  const r = (region || "").trim().toLowerCase();
  if (!r) return "—";
  const map: Record<string, string> = {
    usa: "United States",
    us: "United States",
    global: "Global",
    india: "India",
    uk: "United Kingdom",
    eu: "Europe",
  };
  return map[r] || r.toUpperCase();
}

function shortId(id: string): string {
  if (!id || id.length <= 12) return id;
  return `${id.slice(0, 8)}…`;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useFulfillments(status: StatusFilter) {
  return useQuery({
    queryKey: ["quizverse", "prize_fulfillments", status],
    queryFn: () =>
      quizverse.listPrizeFulfillments(
        serverKeyAuth(),
        status === "all" ? undefined : status,
        200,
      ),
    select: (data) => data?.fulfillments ?? [],
    staleTime: 15_000,
  });
}

function useSettle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SettlePrizeFulfillmentInput) =>
      quizverse.settlePrizeFulfillment(input, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["quizverse", "prize_fulfillments"] }),
  });
}

function useAutoFulfill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AutoFulfillPrizeInput) =>
      quizverse.autoFulfillPrize(input, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["quizverse", "prize_fulfillments"] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Approve panel                                                      */
/* ------------------------------------------------------------------ */

interface ApprovePanelProps {
  fulfillment: PrizeFulfillment;
  onSubmit: (input: AutoFulfillPrizeInput) => void;
  onCancel: () => void;
  isPending: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ApprovePanel({ fulfillment, onSubmit, onCancel, isPending }: ApprovePanelProps) {
  const [provider, setProvider] = useState<"tremendous" | "reloadly">("reloadly");
  const [email, setEmail] = useState(fulfillment.email ?? "");
  const emailValid = EMAIL_RE.test(email.trim());
  const rank = rankDisplay(fulfillment.rank);

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PackageCheck className="h-4 w-4 text-emerald-400" />
        Send {prizeLabel(fulfillment)} to winner
      </h4>
      <p className="text-xs text-muted-foreground">
        {fulfillment.eventTitle || "Event"} · {rank.label} · {regionDisplay(fulfillment.region)}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Gift card provider</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value === "reloadly" ? "reloadly" : "tremendous")}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="reloadly">Reloadly</option>
            <option value="tremendous">Tremendous</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Winner&apos;s email</label>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="winner@email.com"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
              email.trim() && !emailValid ? "border-red-500/50" : "border-border",
            )}
          />
        </div>
      </div>
      {!fulfillment.email && (
        <p className="text-xs font-medium text-amber-400">
          Player did not enter an email — type one below before sending.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          onClick={() =>
            onSubmit({
              eventId: fulfillment.eventId,
              userId: fulfillment.userId,
              email: email.trim(),
              provider,
            })
          }
          disabled={isPending || !emailValid}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Confirm &amp; send
        </button>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Info cell                                                          */
/* ------------------------------------------------------------------ */

function InfoCell({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5", className)}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Row                                                                */
/* ------------------------------------------------------------------ */

interface RowProps {
  f: PrizeFulfillment;
  isApproving: boolean;
  isSettling: boolean;
  onToggleApprove: () => void;
  onSubmitApprove: (input: AutoFulfillPrizeInput) => void;
  onCancelApprove: () => void;
  onReject: () => void;
}

function FulfillmentRow({
  f,
  isApproving,
  isSettling,
  onToggleApprove,
  onSubmitApprove,
  onCancelApprove,
  onReject,
}: RowProps) {
  const [showIds, setShowIds] = useState(false);
  const badge = statusBadge(f.status);
  const rank = rankDisplay(f.rank);
  const hasEmail = Boolean(f.email?.trim());

  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
                badge.cls,
              )}
            >
              {badge.icon}
              {badge.label}
            </span>
          </div>
          <h3 className="text-base font-bold leading-snug text-foreground sm:text-lg">
            {f.eventTitle || "Untitled event"}
          </h3>
        </div>

        {f.status === "pending" && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              onClick={onToggleApprove}
              disabled={isSettling}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              Approve &amp; send
            </button>
            <button
              onClick={onReject}
              disabled={isSettling}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4" />
              Reject
            </button>
          </div>
        )}
      </div>

      {/* Key facts — scannable grid */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <InfoCell label="Winner rank">
          <span className="inline-flex items-center gap-1.5">
            <span className="text-base">{rank.medal}</span>
            {rank.label}
          </span>
        </InfoCell>
        <InfoCell label="Prize">
          <span className="inline-flex items-center gap-1.5">
            <Gift className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span className="truncate">{prizeLabel(f)}</span>
          </span>
        </InfoCell>
        <InfoCell label="Email">
          {hasEmail ? (
            <span className="inline-flex items-center gap-1.5 break-all text-emerald-400">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              {f.email}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              No email yet
            </span>
          )}
        </InfoCell>
        <InfoCell label="Region">
          <span className="inline-flex items-center gap-1.5">
            <Globe2 className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            {regionDisplay(f.region)}
          </span>
        </InfoCell>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5" />
        Queued {formatTs(f.sortAt || f.queuedAt)}
        {f.emailPatchedAt ? (
          <span className="text-muted-foreground/80">· email saved {formatTs(f.emailPatchedAt)}</span>
        ) : null}
      </p>

      {f.status === "fulfilled" && f.voucher && (
        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-300">
          Sent via {f.voucher.provider || "provider"}
          {f.voucher.deliveredTo ? ` → ${f.voucher.deliveredTo}` : ""}
          {f.settledAt ? ` · ${formatTs(f.settledAt)}` : ""}
        </div>
      )}
      {f.status === "failed" && f.error && (
        <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          {f.error}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowIds((v) => !v)}
        className="mt-3 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
      >
        {showIds ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {showIds ? "Hide" : "Show"} technical IDs
      </button>
      {showIds && (
        <div className="mt-2 space-y-1 rounded-md bg-muted/30 px-3 py-2 font-mono text-[10px] text-muted-foreground">
          <p>
            <span className="text-foreground/70">Event ID:</span> {f.eventId}
          </p>
          <p>
            <span className="text-foreground/70">Player ID:</span> {f.userId}
          </p>
        </div>
      )}

      {isApproving && (
        <ApprovePanel
          fulfillment={f}
          onSubmit={onSubmitApprove}
          onCancel={onCancelApprove}
          isPending={isSettling}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function PrizesPage() {
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [search, setSearch] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");
  const [rankFilter, setRankFilter] = useState<number | "all">("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);

  const { data: fulfillments = [], isLoading, isError, error, refetch } = useFulfillments(status);
  const settle = useSettle();
  const autoFulfill = useAutoFulfill();

  const eventOptions = useMemo(() => {
    const map = new Map<string, { title: string; latest: number }>();
    for (const f of fulfillments) {
      if (!f.eventId) continue;
      const latest = f.sortAt || f.queuedAt || 0;
      const existing = map.get(f.eventId);
      const title = f.eventTitle?.trim() || `Event ${shortId(f.eventId)}`;
      if (!existing || latest > existing.latest) {
        map.set(f.eventId, { title, latest });
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1].latest - a[1].latest)
      .map(([id, meta]) => ({ id, title: meta.title, latest: meta.latest }));
  }, [fulfillments]);

  const filtered = useMemo(() => {
    let list = fulfillments;

    if (eventFilter !== "all") {
      list = list.filter((f) => f.eventId === eventFilter);
    }
    if (rankFilter !== "all") {
      list = list.filter((f) => f.rank === rankFilter);
    }
    if (emailFilter === "has") {
      list = list.filter((f) => Boolean(f.email?.trim()));
    } else if (emailFilter === "missing") {
      list = list.filter((f) => !f.email?.trim());
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.eventTitle?.toLowerCase().includes(q) ||
          f.email?.toLowerCase().includes(q) ||
          prizeLabel(f).toLowerCase().includes(q),
      );
    }

    const sorted = [...list].sort(
      (a, b) => (b.sortAt || b.queuedAt || 0) - (a.sortAt || a.queuedAt || 0),
    );
    if (sortOrder === "oldest") sorted.reverse();
    return sorted;
  }, [fulfillments, eventFilter, rankFilter, emailFilter, search, sortOrder]);

  const counts = useMemo(() => {
    const c = { pending: 0, fulfilled: 0, failed: 0 };
    for (const f of fulfillments) {
      if (f.status in c) c[f.status as keyof typeof c]++;
    }
    return c;
  }, [fulfillments]);

  const activeFilterCount = [
    eventFilter !== "all",
    rankFilter !== "all",
    emailFilter !== "all",
    search.trim().length > 0,
  ].filter(Boolean).length;

  function clearFilters() {
    setEventFilter("all");
    setRankFilter("all");
    setEmailFilter("all");
    setSearch("");
    setSortOrder("newest");
  }

  function handleSubmitApprove(input: AutoFulfillPrizeInput) {
    const confirmed = window.confirm(
      `Send a real gift card to ${input.email}?\n\nProvider: ${input.provider ?? "auto"}\nThis uses real money.`,
    );
    if (!confirmed) return;
    setSettlingKey(`${input.eventId}:${input.userId}`);
    autoFulfill.mutate(input, {
      onSettled: () => setSettlingKey(null),
      onSuccess: (res) => {
        setApprovingKey(null);
        if (res?.ok) {
          window.alert(
            `Gift card sent ✅\nDelivered to: ${res.deliveredTo ?? input.email}` +
              (res.warning ? `\n\n⚠️ ${res.warning}` : ""),
          );
        } else {
          window.alert(`Failed: ${res?.error ?? "unknown error"}`);
        }
      },
      onError: (err) => {
        const body = err instanceof NakamaRpcError ? (err.body as { error?: string } | undefined) : undefined;
        window.alert(`Failed: ${body?.error ?? (err as Error)?.message ?? "unknown error"}`);
      },
    });
  }

  function handleReject(f: PrizeFulfillment) {
    const reason = window.prompt(
      `Reject prize for "${f.eventTitle || "this event"}" (${rankDisplay(f.rank).label})?\nReason:`,
      "Could not fulfill",
    );
    if (reason === null) return;
    setSettlingKey(f.key);
    settle.mutate(
      {
        eventId: f.eventId,
        userId: f.userId,
        status: "failed",
        error: reason || "fulfillment failed",
      },
      { onSettled: () => setSettlingKey(null) },
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Gift className="h-6 w-6 text-primary" />
            Live Event Prizes
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Winners waiting for gift cards. Review each row, then approve to send.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setStatus(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              status === tab.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.id !== "all" && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-xs",
                  status === tab.id ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab.id as keyof typeof counts]}
              </span>
            )}
            {status === tab.id && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border bg-card/50 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <Filter className="h-4 w-4 text-primary" />
            Filters
          </p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              Clear all ({activeFilterCount})
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Event</label>
            <select
              value={eventFilter}
              onChange={(e) => setEventFilter(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All events (newest first)</option>
              {eventOptions.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.title}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Winner rank</label>
            <select
              value={rankFilter === "all" ? "all" : String(rankFilter)}
              onChange={(e) => {
                const v = e.target.value;
                setRankFilter(v === "all" ? "all" : Number(v));
              }}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {RANK_OPTIONS.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Email</label>
            <select
              value={emailFilter}
              onChange={(e) => setEmailFilter(e.target.value as EmailFilter)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All</option>
              <option value="has">Has email</option>
              <option value="missing">Missing email</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Sort</label>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="newest">Latest events first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search event name, prize, or email…"
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Gift className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No prizes match your filters</p>
          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="mt-2 text-xs text-primary hover:underline">
              Clear filters
            </button>
          )}
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <>
          <p className="text-sm text-muted-foreground">
            Showing <strong className="text-foreground">{filtered.length}</strong>{" "}
            {filtered.length === 1 ? "winner" : "winners"}
          </p>
          <div className="space-y-4">
            {filtered.map((f) => (
              <FulfillmentRow
                key={f.key}
                f={f}
                isApproving={approvingKey === f.key}
                isSettling={settlingKey === f.key || settlingKey === `${f.eventId}:${f.userId}`}
                onToggleApprove={() => setApprovingKey((k) => (k === f.key ? null : f.key))}
                onSubmitApprove={handleSubmitApprove}
                onCancelApprove={() => setApprovingKey(null)}
                onReject={() => handleReject(f)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default PrizesPage;
