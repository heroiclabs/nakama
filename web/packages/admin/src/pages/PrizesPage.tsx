import { useMemo, useState } from "react";
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
  Trophy,
  User,
  Check,
  X,
  Ban,
  PackageCheck,
} from "lucide-react";
import {
  serverKeyAuth,
  quizverse,
  type PrizeFulfillment,
  type FulfillmentStatus,
  type SettlePrizeFulfillmentInput,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

type StatusFilter = FulfillmentStatus | "all";

const STATUS_TABS: { id: StatusFilter; label: string }[] = [
  { id: "pending", label: "Pending" },
  { id: "fulfilled", label: "Fulfilled" },
  { id: "failed", label: "Failed" },
  { id: "all", label: "All" },
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
      return { cls: "bg-amber-500/10 border-amber-500/20 text-amber-400", icon: <Clock className="h-3.5 w-3.5" /> };
    case "fulfilled":
      return { cls: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400", icon: <CheckCircle2 className="h-3.5 w-3.5" /> };
    case "failed":
      return { cls: "bg-red-500/10 border-red-500/20 text-red-400", icon: <Ban className="h-3.5 w-3.5" /> };
  }
}

function prizeLabel(f: PrizeFulfillment): string {
  const gc = f.giftCard;
  if (!gc) return "—";
  const parts: string[] = [];
  if (gc.prize) parts.push(gc.prize);
  else if (gc.brand) parts.push(gc.brand);
  if (gc.value) parts.push(`${gc.currency || "USD"} ${gc.value}`);
  return parts.join(" · ") || "Gift card";
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

/* ------------------------------------------------------------------ */
/*  Approve panel                                                      */
/* ------------------------------------------------------------------ */

interface ApprovePanelProps {
  fulfillment: PrizeFulfillment;
  onSubmit: (input: SettlePrizeFulfillmentInput) => void;
  onCancel: () => void;
  isPending: boolean;
}

function ApprovePanel({ fulfillment, onSubmit, onCancel, isPending }: ApprovePanelProps) {
  const [provider, setProvider] = useState("reloadly");
  const [orderId, setOrderId] = useState("");
  const [deliveredTo, setDeliveredTo] = useState(fulfillment.email ?? "");
  const [cardLast4, setCardLast4] = useState("");
  const [codeDelivered, setCodeDelivered] = useState(true);

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <PackageCheck className="h-4 w-4 text-emerald-400" />
        Approve & mark voucher delivered
      </h4>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Provider</label>
          <input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="reloadly"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Order ID</label>
          <input
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            placeholder="provider order reference"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Delivered to (email)</label>
          <input
            value={deliveredTo}
            onChange={(e) => setDeliveredTo(e.target.value)}
            placeholder="player@email.com"
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Card last 4 (optional)</label>
          <input
            value={cardLast4}
            onChange={(e) => setCardLast4(e.target.value)}
            placeholder="1234"
            maxLength={4}
            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          checked={codeDelivered}
          onChange={(e) => setCodeDelivered(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Code already delivered to the player
      </label>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() =>
            onSubmit({
              eventId: fulfillment.eventId,
              userId: fulfillment.userId,
              status: "fulfilled",
              provider: provider.trim() || "reloadly",
              orderId: orderId.trim() || undefined,
              deliveredTo: deliveredTo.trim() || undefined,
              cardLast4: cardLast4.trim() || undefined,
              codeDelivered,
            })
          }
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600/90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Confirm Approve
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
/*  Row                                                                */
/* ------------------------------------------------------------------ */

interface RowProps {
  f: PrizeFulfillment;
  isApproving: boolean;
  isSettling: boolean;
  onToggleApprove: () => void;
  onSubmitApprove: (input: SettlePrizeFulfillmentInput) => void;
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
  const badge = statusBadge(f.status);

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize", badge.cls)}>
              {badge.icon}
              {f.status}
            </span>
            <h4 className="truncate text-sm font-semibold text-foreground">
              {f.eventTitle || f.eventId}
            </h4>
            {f.rank > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                <Trophy className="h-3 w-3" />
                Rank {f.rank}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 text-foreground">
              <Gift className="h-3 w-3 text-amber-400" />
              {prizeLabel(f)}
            </span>
            <span className="inline-flex items-center gap-1">
              <User className="h-3 w-3" />
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{f.userId}</code>
            </span>
            {f.email && (
              <span className="inline-flex items-center gap-1">
                <Mail className="h-3 w-3" />
                {f.email}
              </span>
            )}
            {f.region && (
              <span className="inline-flex items-center gap-1">
                <Globe2 className="h-3 w-3" />
                {f.region}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              queued {formatTs(f.queuedAt)}
            </span>
          </div>

          {f.status === "fulfilled" && f.voucher && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-emerald-400">
              <span>via {f.voucher.provider || "—"}</span>
              {f.voucher.orderId && <span>order {f.voucher.orderId}</span>}
              {f.voucher.deliveredTo && <span>→ {f.voucher.deliveredTo}</span>}
              <span>settled {formatTs(f.settledAt)}</span>
            </div>
          )}
          {f.status === "failed" && f.error && (
            <p className="text-xs text-red-400">Reason: {f.error}</p>
          )}
        </div>

        {f.status === "pending" && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={onToggleApprove}
              disabled={isSettling}
              title="Approve"
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600/90 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" />
              Approve
            </button>
            <button
              onClick={onReject}
              disabled={isSettling}
              title="Reject"
              className="inline-flex items-center gap-1.5 rounded-md border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/10 disabled:opacity-50"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>

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
  const [approvingKey, setApprovingKey] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);

  const { data: fulfillments = [], isLoading, isError, error, refetch } = useFulfillments(status);
  const settle = useSettle();

  const filtered = useMemo(() => {
    let list = fulfillments;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (f) =>
          f.eventTitle?.toLowerCase().includes(q) ||
          f.eventId?.toLowerCase().includes(q) ||
          f.userId?.toLowerCase().includes(q) ||
          f.email?.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => (b.queuedAt || 0) - (a.queuedAt || 0));
  }, [fulfillments, search]);

  const counts = useMemo(() => {
    const c = { pending: 0, fulfilled: 0, failed: 0 };
    for (const f of fulfillments) {
      if (f.status in c) c[f.status as keyof typeof c]++;
    }
    return c;
  }, [fulfillments]);

  function handleSubmitApprove(input: SettlePrizeFulfillmentInput) {
    setSettlingKey(`${input.eventId}:${input.userId}`);
    settle.mutate(input, {
      onSettled: () => setSettlingKey(null),
      onSuccess: () => setApprovingKey(null),
    });
  }

  function handleReject(f: PrizeFulfillment) {
    const reason = window.prompt(
      `Reject prize for "${f.eventTitle || f.eventId}" (player ${f.userId})?\nEnter a reason:`,
      "Could not fulfill — invalid details",
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
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Gift className="h-6 w-6 text-primary" />
            Live Event Prizes
          </h2>
          <p className="text-sm text-muted-foreground">
            Review and approve gift-card vouchers won in live events.
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

      {/* Status tabs */}
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

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by event, player ID, or email..."
          className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load fulfillments: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading prize queue…
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Gift className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">
            {fulfillments.length === 0 ? "No prizes in this queue" : "No prizes match your search"}
          </p>
          <p className="mt-1 text-xs">
            Gift-card wins from live events appear here for approval.
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Filter className="h-3.5 w-3.5" />
          {filtered.length} {filtered.length === 1 ? "prize" : "prizes"}
        </div>
      )}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
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
      )}
    </div>
  );
}

export default PrizesPage;
