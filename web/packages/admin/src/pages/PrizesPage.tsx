import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
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
  Coins,
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
type PrizeTypeFilter = "gift_cards" | "coins" | "all";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "fulfilled", label: "Sent" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
];

const RANK_OPTIONS: { value: number | "all"; label: string; short: string }[] = [
  { value: "all", label: "All ranks", short: "Rank" },
  { value: 1, label: "1st place only", short: "1st place" },
  { value: 2, label: "2nd place only", short: "2nd place" },
  { value: 3, label: "3rd place only", short: "3rd place" },
  { value: 4, label: "4th place", short: "4th place" },
  { value: 5, label: "5th place", short: "5th place" },
];

const EMAIL_OPTIONS: { value: EmailFilter; label: string; short: string }[] = [
  { value: "all", label: "All", short: "Email" },
  { value: "has", label: "Has email", short: "Has email" },
  { value: "missing", label: "Missing email", short: "No email" },
];

const SORT_OPTIONS: { value: SortOrder; label: string; short: string }[] = [
  { value: "newest", label: "Latest first", short: "Newest" },
  { value: "oldest", label: "Oldest first", short: "Oldest" },
];

const PRIZE_TYPE_OPTIONS: { value: PrizeTypeFilter; label: string; short: string }[] = [
  { value: "gift_cards", label: "Gift cards only", short: "Gift cards" },
  { value: "coins", label: "Coins (XUT) only", short: "Coins" },
  { value: "all", label: "All prize types", short: "All types" },
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

function isXutFulfillment(f: PrizeFulfillment): boolean {
  if (f.source === "auto_winner_xut") return true;
  return (f.giftCard?.prize || "").toUpperCase().includes("XUT");
}

function statusBadge(f: PrizeFulfillment) {
  const xut = isXutFulfillment(f);
  switch (f.status) {
    case "pending":
      return {
        cls: "bg-amber-500/15 border-amber-500/30 text-amber-300",
        label: "Waiting to send",
        icon: <Clock className="h-3.5 w-3.5" />,
      };
    case "fulfilled":
      return xut
        ? {
            cls: "bg-sky-500/15 border-sky-500/30 text-sky-300",
            label: "Coins credited",
            icon: <Coins className="h-3.5 w-3.5" />,
          }
        : {
            cls: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
            label: "Gift card sent",
            icon: <CheckCircle2 className="h-3.5 w-3.5" />,
          };
    case "failed":
      return {
        cls: "bg-red-500/15 border-red-500/30 text-red-300",
        label: xut ? "Coin credit failed" : "Could not send",
        icon: <Ban className="h-3.5 w-3.5" />,
      };
  }
}

function prizeTypeBadge(f: PrizeFulfillment) {
  if (isXutFulfillment(f)) {
    return {
      cls: "bg-sky-500/10 border-sky-500/25 text-sky-300",
      label: "Coins (auto)",
      icon: <Coins className="h-3 w-3" />,
    };
  }
  return {
    cls: "bg-amber-500/10 border-amber-500/25 text-amber-300",
    label: "Gift card",
    icon: <Gift className="h-3 w-3" />,
  };
}

function timelineLine(f: PrizeFulfillment): { label: string; ts?: number } {
  const sortTs = f.sortAt || f.queuedAt;
  const actionTs = f.settledAt || sortTs;
  const xut = isXutFulfillment(f);

  if (f.status === "pending") {
    return { label: "In queue since", ts: sortTs };
  }
  if (f.status === "failed") {
    return { label: "Failed on", ts: actionTs };
  }
  if (f.status === "fulfilled") {
    return xut
      ? { label: "Coins auto-credited on", ts: sortTs }
      : { label: "Gift card sent on", ts: actionTs };
  }
  return { label: "Recorded on", ts: sortTs };
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

/* ------------------------------------------------------------------ */
/*  Filter controls                                                    */
/* ------------------------------------------------------------------ */

const pillSelectCls =
  "h-9 w-full cursor-pointer appearance-none rounded-full border border-border/50 bg-muted/30 py-0 pl-3.5 pr-8 text-sm text-foreground outline-none transition-colors hover:bg-muted/50 focus:border-primary/40 focus:ring-2 focus:ring-primary/20";

function FilterPill({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="relative min-w-[7.5rem]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        className={pillSelectCls}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
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
  const badge = statusBadge(f);
  const typeBadge = prizeTypeBadge(f);
  const timeline = timelineLine(f);
  const rank = rankDisplay(f.rank);
  const hasEmail = Boolean(f.email?.trim());
  const needsApproval = f.status === "pending" && !isXutFulfillment(f);

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
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                typeBadge.cls,
              )}
            >
              {typeBadge.icon}
              {typeBadge.label}
            </span>
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Event name</p>
          <h3 className="mt-0.5 text-base font-bold leading-snug text-foreground sm:text-lg">
            {f.eventTitle || "Untitled event"}
          </h3>
        </div>

        {needsApproval && (
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

      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
        <Calendar className="h-3.5 w-3.5 shrink-0" />
        <span>
          {timeline.label}{" "}
          <span className="text-foreground/80">{formatTs(timeline.ts)}</span>
        </span>
        {f.emailPatchedAt ? (
          <span className="text-muted-foreground/80">
            · Email updated {formatTs(f.emailPatchedAt)}
          </span>
        ) : null}
      </p>

      {f.status === "fulfilled" && !isXutFulfillment(f) && f.voucher && (
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
  const [rankFilter, setRankFilter] = useState<number | "all">("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [prizeTypeFilter, setPrizeTypeFilter] = useState<PrizeTypeFilter>("gift_cards");
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);

  const { data: fulfillmentData, isLoading, isError, error, refetch } = useFulfillments(status);
  const fulfillments = fulfillmentData?.fulfillments ?? [];
  const listTotal = fulfillmentData?.total;
  const settle = useSettle();
  const autoFulfill = useAutoFulfill();

  const filtered = useMemo(() => {
    let list = fulfillments;

    if (prizeTypeFilter === "gift_cards") {
      list = list.filter((f) => !isXutFulfillment(f));
    } else if (prizeTypeFilter === "coins") {
      list = list.filter((f) => isXutFulfillment(f));
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
  }, [fulfillments, prizeTypeFilter, rankFilter, emailFilter, search, sortOrder]);

  const activeFilterCount = [
    prizeTypeFilter !== "gift_cards",
    rankFilter !== "all",
    emailFilter !== "all",
    sortOrder !== "newest",
    search.trim().length > 0,
  ].filter(Boolean).length;

  function clearFilters() {
    setPrizeTypeFilter("gift_cards");
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
            {status === tab.id && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
          </button>
        ))}
      </div>

      {/* Search + filters — compact inline toolbar */}
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search event, prize, or email…"
              className="h-10 w-full rounded-full border border-border/40 bg-muted/30 py-0 pl-10 pr-4 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition-colors hover:bg-muted/40 focus:border-primary/40 focus:bg-muted/40 focus:ring-2 focus:ring-primary/15"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterPill
              ariaLabel="Prize type"
              value={prizeTypeFilter}
              onChange={(v) => setPrizeTypeFilter(v as PrizeTypeFilter)}
              options={PRIZE_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterPill
              ariaLabel="Winner rank"
              value={rankFilter === "all" ? "all" : String(rankFilter)}
              onChange={(v) => setRankFilter(v === "all" ? "all" : Number(v))}
              options={RANK_OPTIONS.map((o) => ({ value: String(o.value), label: o.label }))}
            />
            <FilterPill
              ariaLabel="Email"
              value={emailFilter}
              onChange={(v) => setEmailFilter(v as EmailFilter)}
              options={EMAIL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
            <FilterPill
              ariaLabel="Sort order"
              value={sortOrder}
              onChange={(v) => setSortOrder(v as SortOrder)}
              options={SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {prizeTypeFilter !== "gift_cards" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/25 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                {PRIZE_TYPE_OPTIONS.find((o) => o.value === prizeTypeFilter)?.short}
                <button
                  type="button"
                  onClick={() => setPrizeTypeFilter("gift_cards")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear prize type filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {search.trim() && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/25 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                Search: {search.trim().length > 24 ? `${search.trim().slice(0, 24)}…` : search.trim()}
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {rankFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/25 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                {RANK_OPTIONS.find((o) => o.value === rankFilter)?.short}
                <button
                  type="button"
                  onClick={() => setRankFilter("all")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear rank filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {emailFilter !== "all" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/25 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                {EMAIL_OPTIONS.find((o) => o.value === emailFilter)?.short}
                <button
                  type="button"
                  onClick={() => setEmailFilter("all")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear email filter"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            {sortOrder !== "newest" && (
              <span className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/25 py-0.5 pl-2.5 pr-1 text-xs text-foreground">
                {SORT_OPTIONS.find((o) => o.value === sortOrder)?.short}
                <button
                  type="button"
                  onClick={() => setSortOrder("newest")}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear sort"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </button>
          </div>
        )}
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
            {typeof listTotal === "number" && listTotal > fulfillments.length ? (
              <span className="text-muted-foreground/80">
                {" "}
                (loaded {fulfillments.length} of {listTotal} in this tab — contact dev for pagination)
              </span>
            ) : null}
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
