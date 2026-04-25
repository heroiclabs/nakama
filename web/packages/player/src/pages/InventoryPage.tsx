import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import type { InventoryItem, InventoryListResponse } from "@nakama/shared";
import {
  Package,
  Layers,
  Loader2,
  Search,
  X,
  Minus,
  ChevronRight,
  Boxes,
  Sparkles,
  Sword,
  Shield,
  Gem,
  Zap,
  Star,
  Flame,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function normalizeItems(data: InventoryListResponse): InventoryItem[] {
  if (!data?.items) return [];
  return Object.entries(data.items).map(([key, item]) => ({
    ...item,
    id: item.id || key,
  }));
}

function categorize(items: InventoryItem[]): Map<string, InventoryItem[]> {
  const cats = new Map<string, InventoryItem[]>();
  for (const item of items) {
    const cat = item.category || "General";
    const arr = cats.get(cat) ?? [];
    arr.push(item);
    cats.set(cat, arr);
  }
  return cats;
}

function categoryIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("weapon") || n.includes("sword") || n.includes("attack"))
    return <Sword className="h-4 w-4" />;
  if (n.includes("armor") || n.includes("shield") || n.includes("defen"))
    return <Shield className="h-4 w-4" />;
  if (n.includes("gem") || n.includes("jewel") || n.includes("rare"))
    return <Gem className="h-4 w-4" />;
  if (n.includes("boost") || n.includes("power") || n.includes("buff"))
    return <Zap className="h-4 w-4" />;
  if (n.includes("consum") || n.includes("potion") || n.includes("food"))
    return <Flame className="h-4 w-4" />;
  if (n.includes("collect") || n.includes("trophy") || n.includes("special"))
    return <Sparkles className="h-4 w-4" />;
  return <Boxes className="h-4 w-4" />;
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Item Card                                                          */
/* ------------------------------------------------------------------ */

function ItemCard({
  item,
  onClick,
}: {
  item: InventoryItem;
  onClick: () => void;
}) {
  const isStackable = item.stackable !== false;
  const isConsumable = item.consumable === true;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card text-left transition-all",
        "border-border hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 cursor-pointer",
      )}
    >
      {item.count > 1 && isStackable && (
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full bg-primary/90 px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
          <Layers className="h-3 w-3" />
          ×{item.count}
        </div>
      )}

      {isConsumable && (
        <div className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
          <Flame className="h-3 w-3" />
          Usable
        </div>
      )}

      <div className="relative flex h-28 items-center justify-center bg-gradient-to-br from-primary/5 to-primary/10">
        {item.string_properties?.image_url ? (
          <img
            src={item.string_properties.image_url}
            alt={item.name ?? item.id}
            className="h-full w-full object-cover"
          />
        ) : (
          <Package className="h-10 w-10 text-primary/30 transition-transform group-hover:scale-110" />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-sm font-semibold leading-tight line-clamp-1">
          {item.name ?? item.id}
        </h3>

        {item.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.description}
          </p>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {categoryIcon(item.category ?? "")}
            {item.category ?? "General"}
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail Drawer                                                      */
/* ------------------------------------------------------------------ */

function ItemDetailDrawer({
  item,
  onClose,
  onConsume,
  isConsuming,
}: {
  item: InventoryItem;
  onClose: () => void;
  onConsume: (count: number) => void;
  isConsuming: boolean;
}) {
  const [consumeCount, setConsumeCount] = useState(1);
  const isConsumable = item.consumable === true;

  const numProps = item.numeric_properties
    ? Object.entries(item.numeric_properties)
    : [];
  const strProps = item.string_properties
    ? Object.entries(item.string_properties).filter(
        ([k]) => k !== "image_url",
      )
    : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col overflow-y-auto bg-background border-l border-border shadow-2xl animate-in slide-in-from-right-full duration-200">
        {/* header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-5 py-4">
          <h3 className="text-lg font-bold truncate">
            {item.name ?? item.id}
          </h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 p-5">
          {/* image */}
          <div className="flex h-48 items-center justify-center rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-border">
            {item.string_properties?.image_url ? (
              <img
                src={item.string_properties.image_url}
                alt={item.name ?? item.id}
                className="h-full w-full rounded-xl object-cover"
              />
            ) : (
              <Package className="h-16 w-16 text-primary/20" />
            )}
          </div>

          {/* meta badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              {categoryIcon(item.category ?? "")}
              {item.category ?? "General"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium">
              <Layers className="h-3.5 w-3.5" />
              Qty: {item.count}
              {item.max_count ? ` / ${item.max_count}` : ""}
            </span>
            {item.stackable !== false && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                <Boxes className="h-3.5 w-3.5" />
                Stackable
              </span>
            )}
            {isConsumable && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <Flame className="h-3.5 w-3.5" />
                Consumable
              </span>
            )}
          </div>

          {/* description */}
          {item.description && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Description
              </h4>
              <p className="text-sm leading-relaxed">{item.description}</p>
            </div>
          )}

          {/* properties */}
          {(numProps.length > 0 || strProps.length > 0) && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Properties
              </h4>
              <div className="space-y-1.5">
                {numProps.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground capitalize">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium tabular-nums">
                      {v.toLocaleString()}
                    </span>
                  </div>
                ))}
                {strProps.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm"
                  >
                    <span className="text-muted-foreground capitalize">
                      {k.replace(/_/g, " ")}
                    </span>
                    <span className="font-medium truncate max-w-[200px]">
                      {v}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* timestamps */}
          {(item.create_time || item.update_time) && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Timeline
              </h4>
              <div className="space-y-1.5 text-sm text-muted-foreground">
                {item.create_time && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    Acquired: {fmtTime(item.create_time)}
                  </div>
                )}
                {item.update_time && (
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5" />
                    Updated: {fmtTime(item.update_time)}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* consume action */}
          {isConsumable && item.count > 0 && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h4 className="text-sm font-semibold">Use Item</h4>
              <div className="flex items-center gap-3">
                <button
                  onClick={() =>
                    setConsumeCount(Math.max(1, consumeCount - 1))
                  }
                  className="rounded-lg border border-border bg-background p-1.5 hover:bg-muted transition-colors"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-[3ch] text-center font-bold tabular-nums">
                  {consumeCount}
                </span>
                <button
                  onClick={() =>
                    setConsumeCount(
                      Math.min(item.count, consumeCount + 1),
                    )
                  }
                  className="rounded-lg border border-border bg-background p-1.5 hover:bg-muted transition-colors"
                >
                  <span className="block h-4 w-4 leading-4 text-center text-sm font-bold">
                    +
                  </span>
                </button>
                <button
                  disabled={isConsuming}
                  onClick={() => onConsume(consumeCount)}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isConsuming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Flame className="h-4 w-4" />
                  )}
                  {isConsuming ? "Using…" : "Use"}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                You have {item.count} available.
              </p>
            </div>
          )}
        </div>
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
      <div className="h-28 bg-muted" />
      <div className="space-y-2 p-3">
        <div className="h-4 w-3/4 rounded bg-muted" />
        <div className="h-3 w-1/2 rounded bg-muted" />
        <div className="h-3 w-2/5 rounded bg-muted" />
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <div className="h-7 w-40 rounded bg-muted animate-pulse" />
        <div className="h-4 w-64 rounded bg-muted animate-pulse" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-24 rounded-full bg-muted animate-pulse"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ filtered }: { filtered?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground">
      <Package className="h-12 w-12 opacity-40" />
      <p className="text-sm font-medium">
        {filtered
          ? "No items match your search."
          : "Your inventory is empty."}
      </p>
      <p className="text-xs">
        {filtered
          ? "Try a different search or category."
          : "Play games and complete quests to earn items!"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function InventoryPage() {
  const rpcOpts = useRpcOptions();
  const queryClient = useQueryClient();

  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, error } = useQuery<InventoryListResponse>({
    queryKey: ["hiro", "inventory"],
    queryFn: () => hiro.listInventory(rpcOpts),
    staleTime: 30_000,
  });

  const consumeMutation = useMutation({
    mutationFn: ({
      itemId,
      instanceId,
      count,
    }: {
      itemId: string;
      instanceId: string;
      count: number;
    }) => hiro.consumeInventoryItem(itemId, instanceId, count, rpcOpts),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hiro", "inventory"] });
      setSelectedItem(null);
    },
  });

  const allItems = useMemo(() => (data ? normalizeItems(data) : []), [data]);
  const categories = useMemo(() => categorize(allItems), [allItems]);
  const categoryNames = useMemo(
    () => ["All", ...Array.from(categories.keys()).sort()],
    [categories],
  );

  const filteredItems = useMemo(() => {
    let items =
      activeCategory === "All"
        ? allItems
        : (categories.get(activeCategory) ?? []);

    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          (i.name ?? i.id).toLowerCase().includes(q) ||
          (i.description ?? "").toLowerCase().includes(q),
      );
    }

    return items;
  }, [allItems, categories, activeCategory, search]);

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inventory</h2>
          <p className="text-muted-foreground">
            Your items and collections.
          </p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          <p className="font-medium">Failed to load inventory</p>
          <p className="mt-1 text-xs opacity-70">
            {(error as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Inventory</h2>
        <p className="text-muted-foreground">
          Your items and collections.{" "}
          {allItems.length > 0 && (
            <span className="text-foreground font-medium">
              {allItems.length} item{allItems.length !== 1 ? "s" : ""} ·{" "}
              {allItems.reduce((s, i) => s + i.count, 0)} total
            </span>
          )}
        </p>
      </div>

      {/* toolbar: search + category pills */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {categoryNames.map((cat) => {
            const isActive = cat === activeCategory;
            const count =
              cat === "All"
                ? allItems.length
                : (categories.get(cat)?.length ?? 0);

            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {cat !== "All" && categoryIcon(cat)}
                {cat}
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isActive ? "opacity-80" : "opacity-60",
                  )}
                >
                  ({count})
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search items…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-muted"
            >
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* grid */}
      {filteredItems.length === 0 ? (
        <EmptyState filtered={search !== "" || activeCategory !== "All"} />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {filteredItems.map((item) => (
            <ItemCard
              key={item.instance_id ?? item.id}
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          ))}
        </div>
      )}

      {/* detail drawer */}
      {selectedItem && (
        <ItemDetailDrawer
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          isConsuming={consumeMutation.isPending}
          onConsume={(count) =>
            consumeMutation.mutate({
              itemId: selectedItem.id,
              instanceId: selectedItem.instance_id ?? selectedItem.id,
              count,
            })
          }
        />
      )}
    </div>
  );
}

export { InventoryPage as default };

export default InventoryPage;
