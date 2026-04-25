import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ShoppingBag,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  X,
  Check,
  AlertTriangle,
  Filter,
  Trash2,
  Copy,
  Eye,
  Tag,
  Users,
  Clock,
  Coins,
  Gift,
  Sparkles,
  MapPin,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { serverKeyAuth, hiro, satori, type Audience } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CurrencyCost {
  [currencyId: string]: number;
}

interface RewardItem {
  type: string;
  id?: string;
  amount?: number;
  [key: string]: unknown;
}

interface StoreOffer {
  id: string;
  name: string;
  description?: string;
  category?: string;
  cost?: { currencies?: CurrencyCost };
  reward?: { items?: RewardItem[]; currencies?: CurrencyCost };
  start_time_sec?: number;
  end_time_sec?: number;
  disabled?: boolean;
  purchase_limit?: number;
  audiences?: string[];
  placement?: string;
  sort_order?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface StoreConfig {
  items?: Record<string, StoreOffer>;
  [key: string]: unknown;
}

type OfferStatus = "active" | "upcoming" | "expired" | "disabled" | "all";

const PLACEMENTS = [
  "store_homepage",
  "post_match",
  "event_screen",
  "comeback",
  "battle_pass",
  "daily_rewards",
  "featured",
  "custom",
] as const;

const CATEGORIES = [
  "bundles",
  "currencies",
  "cosmetics",
  "boosts",
  "passes",
  "event_packs",
  "starter",
  "vip",
  "custom",
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function deriveStatus(offer: StoreOffer): Exclude<OfferStatus, "all"> {
  if (offer.disabled) return "disabled";
  const now = Math.floor(Date.now() / 1000);
  const start = offer.start_time_sec ?? 0;
  const end = offer.end_time_sec ?? 0;
  if (end > 0 && now > end) return "expired";
  if (start > 0 && now < start) return "upcoming";
  return "active";
}

function statusColor(s: Exclude<OfferStatus, "all">) {
  switch (s) {
    case "active": return "text-emerald-400";
    case "upcoming": return "text-sky-400";
    case "expired": return "text-zinc-500";
    case "disabled": return "text-amber-400";
  }
}

function statusBg(s: Exclude<OfferStatus, "all">) {
  switch (s) {
    case "active": return "bg-emerald-500/10 border-emerald-500/20";
    case "upcoming": return "bg-sky-500/10 border-sky-500/20";
    case "expired": return "bg-zinc-500/10 border-zinc-500/20";
    case "disabled": return "bg-amber-500/10 border-amber-500/20";
  }
}

function formatTs(sec?: number) {
  if (!sec) return "—";
  return new Date(sec * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function toDatetimeLocal(sec?: number) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(val: string) {
  if (!val) return undefined;
  return Math.floor(new Date(val).getTime() / 1000);
}

function formatCost(cost?: StoreOffer["cost"]): string {
  if (!cost?.currencies) return "Free";
  const entries = Object.entries(cost.currencies);
  if (entries.length === 0) return "Free";
  return entries.map(([k, v]) => `${v} ${k}`).join(", ");
}

function formatRewards(reward?: StoreOffer["reward"]): string[] {
  const parts: string[] = [];
  if (reward?.currencies) {
    for (const [k, v] of Object.entries(reward.currencies)) {
      parts.push(`${v} ${k}`);
    }
  }
  if (reward?.items) {
    for (const item of reward.items) {
      parts.push(item.amount ? `${item.amount}x ${item.id ?? item.type}` : (item.id ?? item.type));
    }
  }
  return parts;
}

function flattenOffers(config: StoreConfig): StoreOffer[] {
  if (!config?.items) return [];
  return Object.entries(config.items).map(([key, val]) => ({
    ...val,
    id: val.id || key,
  }));
}

function rebuildConfig(baseConfig: StoreConfig, offers: StoreOffer[]): StoreConfig {
  const items: Record<string, StoreOffer> = {};
  for (const offer of offers) {
    items[offer.id] = offer;
  }
  return { ...baseConfig, items };
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useStoreConfig() {
  return useQuery({
    queryKey: ["hiro", "config", "store"],
    queryFn: () => hiro.getHiroConfig("store", serverKeyAuth()),
    staleTime: 30_000,
  });
}

function useSaveStoreConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      hiro.setHiroConfig("store", config, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiro", "config", "store"] }),
  });
}

function useAudiences() {
  return useQuery({
    queryKey: ["satori", "audiences"],
    queryFn: () => satori.listAudiences(serverKeyAuth()),
    select: (data: { audiences?: Audience[] }) => data?.audiences ?? [],
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Offer Form                                                         */
/* ------------------------------------------------------------------ */

interface OfferFormProps {
  initial?: StoreOffer;
  audiences: Audience[];
  onSubmit: (offer: StoreOffer) => void;
  onCancel: () => void;
  isPending: boolean;
  existingIds: string[];
}

function OfferForm({ initial, audiences, onSubmit, onCancel, isPending, existingIds }: OfferFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [placement, setPlacement] = useState(initial?.placement ?? "");
  const [costJson, setCostJson] = useState(
    initial?.cost ? JSON.stringify(initial.cost, null, 2) : '{\n  "currencies": {\n    "coins": 100\n  }\n}',
  );
  const [rewardJson, setRewardJson] = useState(
    initial?.reward ? JSON.stringify(initial.reward, null, 2) : '{\n  "items": [\n    { "type": "item", "id": "sword_01", "amount": 1 }\n  ],\n  "currencies": {\n    "gems": 10\n  }\n}',
  );
  const [startTime, setStartTime] = useState(toDatetimeLocal(initial?.start_time_sec));
  const [endTime, setEndTime] = useState(toDatetimeLocal(initial?.end_time_sec));
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [purchaseLimit, setPurchaseLimit] = useState(initial?.purchase_limit?.toString() ?? "");
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(initial?.audiences ?? []);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order?.toString() ?? "0");
  const [showPreview, setShowPreview] = useState(false);
  const [costError, setCostError] = useState("");
  const [rewardError, setRewardError] = useState("");

  const idConflict = !initial && existingIds.includes(id.trim());

  function parseSafe<T>(json: string, setErr: (e: string) => void): T | null {
    try {
      setErr("");
      return JSON.parse(json);
    } catch (e) {
      setErr((e as Error).message);
      return null;
    }
  }

  const previewOffer = useMemo((): StoreOffer | null => {
    const cost = parseSafe<StoreOffer["cost"]>(costJson, setCostError);
    const reward = parseSafe<StoreOffer["reward"]>(rewardJson, setRewardError);
    if (cost === null || reward === null) return null;
    return {
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      category: category || undefined,
      placement: placement || undefined,
      cost: cost ?? undefined,
      reward: reward ?? undefined,
      start_time_sec: fromDatetimeLocal(startTime),
      end_time_sec: fromDatetimeLocal(endTime),
      disabled,
      purchase_limit: purchaseLimit ? parseInt(purchaseLimit, 10) : undefined,
      audiences: selectedAudiences.length > 0 ? selectedAudiences : undefined,
      sort_order: sortOrder ? parseInt(sortOrder, 10) : undefined,
    };
  }, [id, name, description, category, placement, costJson, rewardJson, startTime, endTime, disabled, purchaseLimit, selectedAudiences, sortOrder]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim() || idConflict) return;
    if (!previewOffer) return;
    onSubmit(previewOffer);
  };

  const toggleAudience = (aid: string) => {
    setSelectedAudiences((prev) =>
      prev.includes(aid) ? prev.filter((a) => a !== aid) : [...prev, aid],
    );
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {initial ? "Edit Offer" : "Create Offer"}
        </h3>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" />
          {showPreview ? "Hide Preview" : "Show Preview"}
        </button>
      </div>

      {/* Preview card */}
      {showPreview && previewOffer && (
        <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-medium text-primary">Live Preview</p>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Gift className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{previewOffer.name || "Untitled"}</p>
              {previewOffer.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{previewOffer.description}</p>
              )}
              <div className="mt-1 flex flex-wrap gap-2 text-xs">
                <span className="text-amber-400 font-medium">{formatCost(previewOffer.cost)}</span>
                {formatRewards(previewOffer.reward).map((r, i) => (
                  <span key={i} className="text-emerald-400">{r}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Offer ID *</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!initial}
            placeholder="summer_bundle_01"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
              idConflict ? "border-destructive" : "border-border",
            )}
          />
          {idConflict && (
            <p className="text-xs text-destructive">An offer with this ID already exists.</p>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Display Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Summer Mega Bundle"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Get amazing items at a discounted price..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">None</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Placement</label>
          <select
            value={placement}
            onChange={(e) => setPlacement(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">None</option>
            {PLACEMENTS.map((p) => (
              <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Sort Order</label>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Cost (JSON)</label>
          <textarea
            value={costJson}
            onChange={(e) => setCostJson(e.target.value)}
            rows={4}
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none",
              costError ? "border-destructive" : "border-border",
            )}
          />
          {costError && <p className="text-xs text-destructive">Invalid JSON: {costError}</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Rewards (JSON)</label>
          <textarea
            value={rewardJson}
            onChange={(e) => setRewardJson(e.target.value)}
            rows={4}
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none",
              rewardError ? "border-destructive" : "border-border",
            )}
          />
          {rewardError && <p className="text-xs text-destructive">Invalid JSON: {rewardError}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Start Time</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">End Time</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Purchase Limit</label>
          <input
            type="number"
            min="0"
            value={purchaseLimit}
            onChange={(e) => setPurchaseLimit(e.target.value)}
            placeholder="Unlimited"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <div className="flex items-center gap-2 pt-1.5">
            <button
              type="button"
              onClick={() => setDisabled(!disabled)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                !disabled ? "bg-emerald-500" : "bg-zinc-600",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                  !disabled ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <span className="text-sm text-muted-foreground">
              {disabled ? "Disabled" : "Enabled"}
            </span>
          </div>
        </div>
      </div>

      {/* Audience targeting */}
      {audiences.length > 0 && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Users className="h-3 w-3" />
            Audience Targeting
          </label>
          <div className="flex flex-wrap gap-2">
            {audiences.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAudience(a.id)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                  selectedAudiences.includes(a.id)
                    ? "border-violet-500/40 bg-violet-500/20 text-violet-300"
                    : "border-border text-muted-foreground hover:border-violet-500/20 hover:text-violet-400",
                )}
              >
                {a.name || a.id}
                {a.member_count != null && (
                  <span className="ml-1 opacity-60">({a.member_count})</span>
                )}
              </button>
            ))}
          </div>
          {selectedAudiences.length === 0 && (
            <p className="text-xs text-muted-foreground">No targeting — visible to all players.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending || !id.trim() || !name.trim() || idConflict || !!costError || !!rewardError}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? "Update Offer" : "Create Offer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Offer Row                                                          */
/* ------------------------------------------------------------------ */

interface OfferRowProps {
  offer: StoreOffer;
  onEdit: (o: StoreOffer) => void;
  onDuplicate: (o: StoreOffer) => void;
  onDelete: (o: StoreOffer) => void;
  onToggle: (o: StoreOffer) => void;
  isDeleting: boolean;
}

function OfferRow({ offer, onEdit, onDuplicate, onDelete, onToggle, isDeleting }: OfferRowProps) {
  const status = deriveStatus(offer);
  const rewards = formatRewards(offer.reward);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                statusBg(status), statusColor(status),
              )}
            >
              {status}
            </span>
            <h4 className="text-sm font-semibold text-foreground truncate">{offer.name}</h4>
            <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {offer.id}
            </code>
          </div>

          {offer.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{offer.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Coins className="h-3 w-3 text-amber-400" />
              <span className="font-medium text-amber-400">{formatCost(offer.cost)}</span>
            </span>
            {rewards.length > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Gift className="h-3 w-3" />
                {rewards.length} reward{rewards.length !== 1 ? "s" : ""}
              </span>
            )}
            {offer.category && (
              <span className="inline-flex items-center gap-1">
                <Tag className="h-3 w-3" />
                {offer.category.replace(/_/g, " ")}
              </span>
            )}
            {offer.placement && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {offer.placement.replace(/_/g, " ")}
              </span>
            )}
            {offer.purchase_limit != null && (
              <span>limit: {offer.purchase_limit}</span>
            )}
          </div>

          {(offer.start_time_sec || offer.end_time_sec) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatTs(offer.start_time_sec)}</span>
              <span>→</span>
              <span>{formatTs(offer.end_time_sec)}</span>
            </div>
          )}

          {offer.audiences && offer.audiences.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-violet-400">
              <Users className="h-3 w-3" />
              {offer.audiences.join(", ")}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            title="Details"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onToggle(offer)}
            title={offer.disabled ? "Enable" : "Disable"}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              !offer.disabled
                ? "text-emerald-400 hover:bg-emerald-500/10"
                : "text-zinc-500 hover:bg-zinc-500/10",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDuplicate(offer)}
            title="Duplicate"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => onEdit(offer)}
            title="Edit"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(offer)}
            disabled={isDeleting}
            title="Delete"
            className="rounded-md p-1.5 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Cost</p>
              <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-32">
                {JSON.stringify(offer.cost ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Rewards</p>
              <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-32">
                {JSON.stringify(offer.reward ?? {}, null, 2)}
              </pre>
            </div>
          </div>
          {offer.metadata && Object.keys(offer.metadata).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Metadata</p>
              <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-24">
                {JSON.stringify(offer.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function OffersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OfferStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<StoreOffer | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StoreOffer | null>(null);

  const { data: rawConfig, isLoading, isError, error, refetch } = useStoreConfig();
  const save = useSaveStoreConfig();
  const { data: audiences = [] } = useAudiences();

  const storeConfig = (rawConfig ?? {}) as StoreConfig;
  const offers = useMemo(() => flattenOffers(storeConfig), [storeConfig]);

  const filtered = useMemo(() => {
    let list = offers;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q) ||
          o.description?.toLowerCase().includes(q) ||
          o.category?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((o) => deriveStatus(o) === statusFilter);
    }
    if (categoryFilter) {
      list = list.filter((o) => o.category === categoryFilter);
    }
    return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [offers, search, statusFilter, categoryFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, expired: 0, disabled: 0, all: offers.length };
    for (const o of offers) c[deriveStatus(o)]++;
    return c;
  }, [offers]);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const o of offers) if (o.category) set.add(o.category);
    return Array.from(set).sort();
  }, [offers]);

  const handleSubmit = useCallback(
    (offer: StoreOffer) => {
      const updated = [...offers.filter((o) => o.id !== offer.id), offer];
      const newConfig = rebuildConfig(storeConfig, updated);
      save.mutate(newConfig, {
        onSuccess: () => {
          setShowForm(false);
          setEditing(null);
        },
      });
    },
    [offers, storeConfig, save],
  );

  const handleDelete = useCallback(
    (offer: StoreOffer) => {
      setDeletingId(offer.id);
      const updated = offers.filter((o) => o.id !== offer.id);
      const newConfig = rebuildConfig(storeConfig, updated);
      save.mutate(newConfig, {
        onSettled: () => {
          setDeletingId(null);
          setConfirmDelete(null);
        },
      });
    },
    [offers, storeConfig, save],
  );

  const handleToggle = useCallback(
    (offer: StoreOffer) => {
      const toggled = { ...offer, disabled: !offer.disabled };
      const updated = offers.map((o) => (o.id === offer.id ? toggled : o));
      const newConfig = rebuildConfig(storeConfig, updated);
      save.mutate(newConfig);
    },
    [offers, storeConfig, save],
  );

  const handleDuplicate = useCallback(
    (offer: StoreOffer) => {
      const newId = `${offer.id}_copy_${Date.now().toString(36)}`;
      setEditing({
        ...offer,
        id: newId,
        name: `${offer.name} (Copy)`,
      });
      setShowForm(false);
    },
    [],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <ShoppingBag className="h-6 w-6 text-primary" />
            Offer Management
          </h2>
          <p className="text-sm text-muted-foreground">
            Create and manage store offers with pricing, rewards, placement, and audience targeting.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Offer
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["all", "active", "upcoming", "expired", "disabled"] as OfferStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              statusFilter === s
                ? "border-primary/40 bg-primary/5"
                : "border-border hover:border-border/80",
            )}
          >
            <p className="text-lg font-bold text-foreground">{counts[s]}</p>
            <p className="text-xs capitalize text-muted-foreground">{s} offers</p>
          </button>
        ))}
      </div>

      {/* Form */}
      {(showForm || editing) && (
        <OfferForm
          initial={editing && !showForm ? editing : undefined}
          audiences={audiences}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={save.isPending}
          existingIds={offers.map((o) => o.id)}
        />
      )}

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search offers by name, ID, or description..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        {existingCategories.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">All categories</option>
              {existingCategories.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Delete offer "{confirmDelete.name}"?
            </p>
            <p className="text-xs text-muted-foreground">
              This will remove the offer from the store config. This action cannot be undone.
            </p>
          </div>
          <button
            onClick={() => handleDelete(confirmDelete)}
            disabled={save.isPending}
            className="inline-flex items-center gap-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(null)}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load store config: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading store configuration…
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <ShoppingBag className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">
            {offers.length === 0
              ? "No offers configured yet"
              : "No offers match your search"}
          </p>
          <p className="mt-1 text-xs">
            {offers.length === 0
              ? 'Click "Create Offer" to add your first store offer.'
              : "Try adjusting your search or filter."}
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((offer) => (
            <OfferRow
              key={offer.id}
              offer={offer}
              onEdit={(o) => {
                setEditing(o);
                setShowForm(false);
              }}
              onDuplicate={handleDuplicate}
              onDelete={(o) => setConfirmDelete(o)}
              onToggle={handleToggle}
              isDeleting={deletingId === offer.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { OffersPage as default };

export default OffersPage;
