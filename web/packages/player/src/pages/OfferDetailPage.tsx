import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import type { StoreListResponse, StoreItem } from "@nakama/shared";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Coins,
  Gem,
  Zap,
  Clock,
  CheckCircle2,
  ShoppingCart,
  Loader2,
  Star,
  Package,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function timeUntil(sec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = sec - now;
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function currencyIcon(name: string, size = "h-5 w-5") {
  const n = name.toLowerCase();
  if (n.includes("gem") || n.includes("diamond") || n.includes("premium"))
    return <Gem className={cn(size, "text-purple-400")} />;
  if (n.includes("energy") || n.includes("stamina"))
    return <Zap className={cn(size, "text-yellow-400")} />;
  return <Coins className={cn(size, "text-amber-400")} />;
}

function findItem(data: StoreListResponse, id: string): StoreItem | null {
  const raw = data.store ?? data;

  if (raw.sections) {
    for (const sec of Object.values(raw.sections)) {
      const found = sec.items?.find((i) => i.id === id);
      if (found) return found;
    }
  }

  if (raw.items) {
    const found = raw.items.find((i) => i.id === id);
    if (found) return found;
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Reward row                                                         */
/* ------------------------------------------------------------------ */

function RewardRow({
  icon,
  label,
  amount,
}: {
  icon: React.ReactNode;
  label: string;
  amount: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background/50 px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
      </div>
      <span className="text-sm font-bold text-primary">{amount}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeletons                                                          */
/* ------------------------------------------------------------------ */

function DetailSkeleton() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
      </div>
      <div className="h-48 rounded-xl bg-muted" />
      <div className="space-y-3">
        <div className="h-5 w-3/4 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
      </div>
      <div className="space-y-2">
        <div className="h-12 w-full rounded bg-muted" />
        <div className="h-12 w-full rounded bg-muted" />
        <div className="h-12 w-full rounded bg-muted" />
      </div>
      <div className="h-12 w-full rounded-xl bg-muted" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function OfferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const rpcOpts = useRpcOptions();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<StoreListResponse>({
    queryKey: ["hiro", "store"],
    queryFn: () => hiro.listStore(rpcOpts),
    staleTime: 60_000,
  });

  const purchase = useMutation({
    mutationFn: () => hiro.purchaseStoreItem(id!, rpcOpts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hiro", "store"] });
      qc.invalidateQueries({ queryKey: ["wallet"] });
    },
  });

  if (isLoading) return <DetailSkeleton />;

  const item = data && id ? findItem(data, id) : null;

  if (isError || !item) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => navigate("/store")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to store
        </button>
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <AlertTriangle className="h-10 w-10 opacity-40" />
          <p className="text-sm font-medium">Item not found</p>
          <p className="text-xs">
            This item may no longer be available.
          </p>
        </div>
      </div>
    );
  }

  const isAvailable = item.available !== false && !item.disabled;
  const hasLimit =
    item.purchase_limit !== undefined && item.purchase_limit > 0;
  const remaining = hasLimit
    ? item.purchase_limit! - (item.purchase_count ?? 0)
    : null;
  const soldOut = remaining !== null && remaining <= 0;
  const canBuy = isAvailable && !soldOut && !purchase.isSuccess;
  const isLimited = !!item.end_time_sec && item.end_time_sec > 0;

  const costEntries = item.cost?.currencies
    ? Object.entries(item.cost.currencies)
    : [];
  const costItems = item.cost?.items ?? [];

  const rewardCurrencies = item.reward?.currencies
    ? Object.entries(item.reward.currencies)
    : [];
  const rewardItems = item.reward?.items ?? [];
  const rewardEnergies = item.reward?.energies
    ? Object.entries(item.reward.energies)
    : [];
  const hasRewards =
    rewardCurrencies.length > 0 ||
    rewardItems.length > 0 ||
    rewardEnergies.length > 0;

  return (
    <div className="mx-auto max-w-lg space-y-6">
      {/* back */}
      <button
        onClick={() => navigate("/store")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to store
      </button>

      {/* hero */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-gradient-to-br from-primary/5 to-primary/15">
        {isLimited && isAvailable && (
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1 rounded-full bg-red-500/90 px-2.5 py-1 text-xs font-bold text-white">
            <Clock className="h-3.5 w-3.5" />
            {timeUntil(item.end_time_sec!)}
          </div>
        )}
        <div className="flex h-52 items-center justify-center">
          {item.metadata?.image_url ? (
            <img
              src={item.metadata.image_url as string}
              alt={item.name ?? item.id}
              className="h-full w-full object-cover"
            />
          ) : (
            <Star className="h-20 w-20 text-primary/20" />
          )}
        </div>
      </div>

      {/* title + description */}
      <div className="space-y-1">
        <h2 className="text-xl font-bold tracking-tight">
          {item.name ?? item.id}
        </h2>
        {item.description && (
          <p className="text-sm text-muted-foreground">{item.description}</p>
        )}
        {item.category && (
          <span className="inline-block mt-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {item.category}
          </span>
        )}
      </div>

      {/* availability badges */}
      <div className="flex flex-wrap gap-2">
        {!isAvailable && (
          <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            <AlertTriangle className="h-3 w-3" />
            {item.unavailable_reason ?? "Unavailable"}
          </span>
        )}
        {soldOut && (
          <span className="flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-400">
            Sold out
          </span>
        )}
        {remaining !== null && remaining > 0 && (
          <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400">
            {remaining} remaining
          </span>
        )}
        {hasLimit && (
          <span className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
            Limit: {item.purchase_limit}
          </span>
        )}
      </div>

      {/* rewards */}
      {hasRewards && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            You Get
          </h3>
          {rewardCurrencies.map(([cur, amt]) => (
            <RewardRow
              key={cur}
              icon={currencyIcon(cur)}
              label={cur}
              amount={`+${amt.toLocaleString()}`}
            />
          ))}
          {rewardItems.map((ri) => (
            <RewardRow
              key={ri.id}
              icon={<Package className="h-5 w-5 text-blue-400" />}
              label={ri.id}
              amount={`×${ri.count}`}
            />
          ))}
          {rewardEnergies.map(([en, amt]) => (
            <RewardRow
              key={en}
              icon={<Zap className="h-5 w-5 text-yellow-400" />}
              label={en}
              amount={`+${amt}`}
            />
          ))}
        </div>
      )}

      {/* cost */}
      {(costEntries.length > 0 || costItems.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Price
          </h3>
          {costEntries.map(([cur, amt]) => (
            <div
              key={cur}
              className="flex items-center gap-2 text-sm font-medium"
            >
              {currencyIcon(cur)} {amt.toLocaleString()} {cur}
            </div>
          ))}
          {costItems.map((ci) => (
            <div
              key={ci.id}
              className="flex items-center gap-2 text-sm font-medium"
            >
              <Package className="h-5 w-5 text-blue-400" />
              {ci.count}× {ci.id}
            </div>
          ))}
        </div>
      )}

      {/* purchase button */}
      {purchase.isSuccess ? (
        <div className="flex items-center justify-center gap-2 rounded-xl bg-green-500/10 border border-green-500/30 py-4 text-green-400 font-semibold">
          <CheckCircle2 className="h-5 w-5" />
          Purchased!
        </div>
      ) : (
        <button
          disabled={!canBuy || purchase.isPending}
          onClick={() => purchase.mutate()}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold transition-all",
            canBuy
              ? "bg-primary text-primary-foreground hover:opacity-90 active:scale-[0.98]"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {purchase.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing…
            </>
          ) : (
            <>
              <ShoppingCart className="h-4 w-4" />
              {costEntries.length > 0
                ? `Buy for ${costEntries.map(([c, a]) => `${a.toLocaleString()} ${c}`).join(" + ")}`
                : "Get for Free"}
            </>
          )}
        </button>
      )}

      {purchase.isError && (
        <p className="text-center text-sm text-destructive">
          {(purchase.error as Error)?.message ?? "Purchase failed. Try again."}
        </p>
      )}
    </div>
  );
}

export { OfferDetailPage as default };

export default OfferDetailPage;
