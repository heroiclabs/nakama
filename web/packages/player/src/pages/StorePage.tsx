import { useQuery } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import type {
  StoreListResponse,
  StoreItem,
  StoreSection,
} from "@nakama/shared";
import { useNavigate } from "react-router-dom";
import {
  Coins,
  Gem,
  Clock,
  ShoppingBag,
  Sparkles,
  Tag,
  Loader2,
  Package,
  Zap,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersonalization } from "../hooks/use-personalization";
import { PersonalizedOffersBanner } from "../components/PersonalizationWidgets";

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

function primaryCost(item: StoreItem): { amount: number; currency: string } | null {
  if (!item.cost?.currencies) return null;
  const entries = Object.entries(item.cost.currencies);
  if (entries.length === 0) return null;
  const [currency, amount] = entries[0];
  return { currency, amount };
}

function currencyIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("gem") || n.includes("diamond") || n.includes("premium"))
    return <Gem className="h-4 w-4 text-purple-400" />;
  if (n.includes("energy") || n.includes("stamina"))
    return <Zap className="h-4 w-4 text-yellow-400" />;
  return <Coins className="h-4 w-4 text-amber-400" />;
}

function rewardSummary(item: StoreItem): string[] {
  const parts: string[] = [];
  if (item.reward?.currencies) {
    for (const [k, v] of Object.entries(item.reward.currencies)) {
      parts.push(`${v.toLocaleString()} ${k}`);
    }
  }
  if (item.reward?.items) {
    for (const i of item.reward.items) {
      parts.push(`${i.count}× ${i.id}`);
    }
  }
  if (item.reward?.energies) {
    for (const [k, v] of Object.entries(item.reward.energies)) {
      parts.push(`${v} ${k}`);
    }
  }
  return parts;
}

function sectionIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("feature") || n.includes("spotlight"))
    return <Sparkles className="h-5 w-5" />;
  if (n.includes("bundle") || n.includes("pack"))
    return <Package className="h-5 w-5" />;
  if (n.includes("boost") || n.includes("power"))
    return <Zap className="h-5 w-5" />;
  if (n.includes("deal") || n.includes("offer") || n.includes("sale"))
    return <Tag className="h-5 w-5" />;
  return <ShoppingBag className="h-5 w-5" />;
}

/* ------------------------------------------------------------------ */
/*  normalize Hiro store responses                                     */
/* ------------------------------------------------------------------ */

function normalizeSections(data: StoreListResponse): StoreSection[] {
  const raw = data.store ?? data;
  const secs: StoreSection[] = [];

  if (raw.sections) {
    for (const [key, sec] of Object.entries(raw.sections)) {
      secs.push({ section: sec.section || key, items: sec.items ?? [] });
    }
  }

  if (raw.items && raw.items.length > 0) {
    const grouped = new Map<string, StoreItem[]>();
    for (const item of raw.items) {
      const cat = item.category ?? "General";
      const arr = grouped.get(cat) ?? [];
      arr.push(item);
      grouped.set(cat, arr);
    }
    for (const [cat, items] of grouped) {
      if (!secs.some((s) => s.section === cat)) {
        secs.push({ section: cat, items });
      }
    }
  }

  if (secs.length === 0 && raw.items) {
    secs.push({ section: "Store", items: raw.items });
  }

  return secs;
}

/* ------------------------------------------------------------------ */
/*  Item Card                                                          */
/* ------------------------------------------------------------------ */

function ItemCard({ item, onClick }: { item: StoreItem; onClick: () => void }) {
  const cost = primaryCost(item);
  const rewards = rewardSummary(item);
  const isLimited = !!item.end_time_sec && item.end_time_sec > 0;
  const isAvailable = item.available !== false && !item.disabled;
  const hasLimit =
    item.purchase_limit !== undefined && item.purchase_limit > 0;
  const remaining = hasLimit
    ? item.purchase_limit! - (item.purchase_count ?? 0)
    : null;

  return (
    <button
      onClick={onClick}
      disabled={!isAvailable}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
        isAvailable
          ? "border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 cursor-pointer"
          : "border-border/50 opacity-60 cursor-not-allowed",
      )}
    >
      {isLimited && isAvailable && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-red-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
          <Clock className="h-3 w-3" />
          {timeUntil(item.end_time_sec!)}
        </div>
      )}

      {/* visual area */}
      <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
        {item.metadata?.image_url ? (
          <img
            src={item.metadata.image_url as string}
            alt={item.name ?? item.id}
            className="h-full w-full object-cover"
          />
        ) : (
          <Star className="h-12 w-12 text-primary/30 transition-transform group-hover:scale-110" />
        )}
      </div>

      {/* content */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold leading-tight line-clamp-1">
          {item.name ?? item.id}
        </h3>

        {rewards.length > 0 && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {rewards.join(" · ")}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          {cost ? (
            <span className="flex items-center gap-1 text-sm font-bold">
              {currencyIcon(cost.currency)}
              {cost.amount.toLocaleString()}
            </span>
          ) : (
            <span className="text-xs font-medium text-green-500">Free</span>
          )}

          {remaining !== null && remaining > 0 && (
            <span className="text-[10px] text-muted-foreground">
              {remaining} left
            </span>
          )}
          {remaining !== null && remaining <= 0 && (
            <span className="text-[10px] text-red-400 font-medium">
              Sold out
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Section                                                            */
/* ------------------------------------------------------------------ */

function StoreCategory({
  section,
  onItemClick,
}: {
  section: StoreSection;
  onItemClick: (item: StoreItem) => void;
}) {
  const available = section.items.filter(
    (i) => i.available !== false && !i.disabled,
  );
  const unavailable = section.items.filter(
    (i) => i.available === false || i.disabled,
  );
  const sorted = [...available, ...unavailable];

  if (sorted.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-lg font-bold tracking-tight">
        {sectionIcon(section.section)}
        {section.section}
        <span className="text-xs font-normal text-muted-foreground">
          ({available.length} available)
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {sorted.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            onClick={() => onItemClick(item)}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeletons / Empty                                                  */
/* ------------------------------------------------------------------ */

function CardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card animate-pulse">
      <div className="h-32 bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="h-4 w-1/3 rounded bg-muted" />
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="h-7 w-32 rounded bg-muted animate-pulse" />
        <div className="h-4 w-56 rounded bg-muted animate-pulse" />
      </div>
      <div className="space-y-3">
        <div className="h-6 w-40 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <div className="h-6 w-36 rounded bg-muted animate-pulse" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground">
      <ShoppingBag className="h-12 w-12 opacity-40" />
      <p className="text-sm font-medium">The store is empty right now.</p>
      <p className="text-xs">Check back later for new items and offers!</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function StorePage() {
  const rpcOpts = useRpcOptions();
  const navigate = useNavigate();
  const p = usePersonalization();

  const { data, isLoading, isError, error } = useQuery<StoreListResponse>({
    queryKey: ["hiro", "store"],
    queryFn: () => hiro.listStore(rpcOpts),
    staleTime: 60_000,
  });

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Store</h2>
          <p className="text-muted-foreground">Browse items and offers.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          <p className="font-medium">Failed to load store</p>
          <p className="mt-1 text-xs opacity-70">
            {(error as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  const sections = data ? normalizeSections(data) : [];
  const totalItems = sections.reduce((s, sec) => s + sec.items.length, 0);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Store</h2>
        <p className="text-muted-foreground">
          Browse items and offers.{" "}
          {totalItems > 0 && (
            <span className="text-foreground font-medium">
              {totalItems} item{totalItems !== 1 ? "s" : ""} available
            </span>
          )}
        </p>
      </div>

      <PersonalizedOffersBanner offers={p.targetedOffers} />

      {totalItems === 0 ? (
        <EmptyState />
      ) : (
        sections.map((sec) => (
          <StoreCategory
            key={sec.section}
            section={sec}
            onItemClick={(item) => navigate(`/store/${item.id}`)}
          />
        ))
      )}
    </div>
  );
}

export { StorePage as default };

export default StorePage;
