import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Gift,
  Plus,
  Trash2,
  Save,
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Coins,
  ShoppingBag,
} from "lucide-react";
import {
  serverKeyAuth,
  quizverse,
  type PrizeCatalog,
  type PrizeCatalogTier,
  type PrizeCatalogRegion,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const FULFILLMENT_OPTIONS = ["reloadly", "tremendous", "nakama", "manual"] as const;
const CURRENCY_OPTIONS = ["INR", "USD", "XUT", "EUR", "GBP"];

const REGION_META: Record<string, { flag: string; defaultCurrency: string }> = {
  india: { flag: "🇮🇳", defaultCurrency: "INR" },
  usa: { flag: "🇺🇸", defaultCurrency: "USD" },
  xut: { flag: "🪙", defaultCurrency: "XUT" },
  global: { flag: "🌍", defaultCurrency: "XUT" },
};

function regionFlag(key: string) {
  return REGION_META[key]?.flag ?? "🌍";
}

function isXutTier(t: PrizeCatalogTier) {
  return t.currency === "XUT" || t.brand === "xut";
}

function emptyTier(rank: string): PrizeCatalogTier {
  return { rank, prize: "", brand: "", value: 0, currency: "INR", fulfillment: "reloadly" };
}

function recalcTotal(tiers: PrizeCatalogTier[]): { totalValue: number; totalCurrency: string } {
  const nonXut = tiers.filter((t) => !isXutTier(t));
  if (nonXut.length === 0) {
    const xutSum = tiers.reduce((s, t) => s + (t.value || 0), 0);
    return { totalValue: xutSum, totalCurrency: "XUT" };
  }
  const currency = nonXut[0].currency;
  const sum = nonXut.reduce((s, t) => s + (t.currency === currency ? t.value || 0 : 0), 0);
  return { totalValue: sum, totalCurrency: currency };
}

/* ─── sub-components ─────────────────────────────────────────────────────── */

interface TierRowProps {
  tier: PrizeCatalogTier;
  index: number;
  onChange: (t: PrizeCatalogTier) => void;
  onRemove: () => void;
}

function TierRow({ tier, onChange, onRemove }: TierRowProps) {
  function field<K extends keyof PrizeCatalogTier>(key: K, val: PrizeCatalogTier[K]) {
    onChange({ ...tier, [key]: val });
  }

  const inputCls =
    "h-8 rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20";

  return (
    <div className="grid grid-cols-[80px_1fr_1fr_80px_72px_100px_32px] items-center gap-2">
      {/* rank */}
      <input
        value={tier.rank}
        onChange={(e) => field("rank", e.target.value)}
        placeholder="1st"
        className={inputCls}
      />
      {/* prize label */}
      <input
        value={tier.prize}
        onChange={(e) => field("prize", e.target.value)}
        placeholder="Flipkart ₹100"
        className={inputCls}
      />
      {/* brand */}
      <input
        value={tier.brand}
        onChange={(e) => field("brand", e.target.value)}
        placeholder="flipkart"
        className={cn(inputCls, "font-mono text-xs")}
      />
      {/* value */}
      <input
        type="number"
        min={0}
        value={tier.value}
        onChange={(e) => field("value", Number(e.target.value))}
        className={cn(inputCls, "text-right")}
      />
      {/* currency */}
      <select
        value={tier.currency}
        onChange={(e) => field("currency", e.target.value)}
        className={cn(inputCls, "cursor-pointer appearance-none")}
      >
        {CURRENCY_OPTIONS.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      {/* fulfillment */}
      <select
        value={tier.fulfillment}
        onChange={(e) =>
          field("fulfillment", e.target.value as PrizeCatalogTier["fulfillment"])
        }
        className={cn(inputCls, "cursor-pointer appearance-none")}
      >
        {FULFILLMENT_OPTIONS.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>
      {/* remove */}
      <button
        type="button"
        onClick={onRemove}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface RegionEditorProps {
  regionKey: string;
  region: PrizeCatalogRegion;
  onChange: (r: PrizeCatalogRegion) => void;
  onRemove: () => void;
}

function RegionEditor({ regionKey, region, onChange, onRemove }: RegionEditorProps) {
  const { totalValue, totalCurrency } = recalcTotal(region.tiers);

  function updateTier(i: number, t: PrizeCatalogTier) {
    const tiers = [...region.tiers];
    tiers[i] = t;
    onChange({ ...region, tiers, ...recalcTotal(tiers) });
  }

  function removeTier(i: number) {
    const tiers = region.tiers.filter((_: PrizeCatalogTier, idx: number) => idx !== i);
    onChange({ ...region, tiers, ...recalcTotal(tiers) });
  }

  function addTier() {
    const rank = `${region.tiers.length + 1}${["st","nd","rd"][region.tiers.length] ?? "th"}`;
    const tiers = [...region.tiers, emptyTier(rank)];
    onChange({ ...region, tiers });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{regionFlag(regionKey)}</span>
          <div>
            <input
              value={region.label}
              onChange={(e) => onChange({ ...region, label: e.target.value })}
              className="bg-transparent text-sm font-semibold text-foreground outline-none focus:underline"
            />
            <p className="text-xs text-muted-foreground">
              key: <code className="font-mono">{regionKey}</code>
              {" · "}Total:{" "}
              <span className="font-medium text-foreground">
                {totalCurrency !== "XUT"
                  ? `${totalCurrency} ${totalValue}`
                  : `${totalValue.toLocaleString()} XUT`}
              </span>
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-muted-foreground hover:text-destructive"
        >
          Remove region
        </button>
      </div>

      <div className="p-4 space-y-2">
        {/* column headers */}
        <div className="grid grid-cols-[80px_1fr_1fr_80px_72px_100px_32px] gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>Rank</span>
          <span>Prize label</span>
          <span>Brand (Reloadly)</span>
          <span className="text-right">Value</span>
          <span>Currency</span>
          <span>Provider</span>
          <span />
        </div>

        {region.tiers.map((t, i) => (
          <TierRow
            key={i}
            tier={t}
            index={i}
            onChange={(updated) => updateTier(i, updated)}
            onRemove={() => removeTier(i)}
          />
        ))}

        <button
          type="button"
          onClick={addTier}
          className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          Add tier
        </button>
      </div>
    </div>
  );
}

/* ─── page ───────────────────────────────────────────────────────────────── */

export function PrizeCatalogPanel({ embedded = false }: { embedded?: boolean }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<PrizeCatalog | null>(null);
  const [saved, setSaved] = useState(false);

  const { data: catalog, isLoading, isError, refetch } = useQuery({
    queryKey: ["quizverse", "prize_catalog"],
    queryFn: () => quizverse.getPrizeCatalog(serverKeyAuth()),
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: (c: PrizeCatalog) =>
      quizverse.setPrizeCatalog(
        { regions: c.regions, coinBonusTiers: c.coinBonusTiers },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["quizverse", "prize_catalog"] });
      setDraft(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
  });

  const working = draft ?? catalog ?? null;

  function updateRegion(key: string, region: PrizeCatalogRegion) {
    if (!working) return;
    setDraft({ ...working, regions: { ...working.regions, [key]: region } });
  }

  function removeRegion(key: string) {
    if (!working) return;
    const regions = { ...working.regions };
    delete regions[key];
    setDraft({ ...working, regions });
  }

  function addRegion() {
    if (!working) return;
    const key = `region_${Date.now()}`;
    setDraft({
      ...working,
      regions: {
        ...working.regions,
        [key]: {
          region: key,
          label: "New Region",
          tiers: [],
          totalValue: 0,
          totalCurrency: "INR",
        },
      },
    });
  }

  function updateCoinBonus(tiers: PrizeCatalogTier[]) {
    if (!working) return;
    setDraft({ ...working, coinBonusTiers: tiers });
  }

  function handleSave() {
    if (!working) return;
    save.mutate(working);
  }

  function handleReset() {
    setDraft(null);
  }

  const isDirty = draft !== null;

  return (
    <div className="space-y-6">
      {/* header / toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          {!embedded && (
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Gift className="h-6 w-6 text-primary" />
              Prize Catalog
            </h2>
          )}
          <p className={cn("text-sm text-muted-foreground", !embedded && "mt-1")}>
            Set gift card tiers per region. Creators see these live when creating events.
          </p>
          {working && (
            <p className="mt-1 text-xs text-muted-foreground">
              Version {working.version}
              {working.updatedAt > 0 && (
                <>
                  {" · "}Last saved{" "}
                  {new Date(working.updatedAt * 1000).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
            Refresh
          </button>
          {isDirty && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || save.isPending}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Save catalog
          </button>
        </div>
      </div>

      {/* feedback */}
      {saved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-400">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Catalog saved — creators will see updated prizes on their next event creation.
        </div>
      )}
      {save.isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {(save.error as Error)?.message ?? "Failed to save catalog"}
        </div>
      )}
      {isError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load catalog
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      )}

      {!isLoading && working && (
        <div className="space-y-6">
          {/* info banner */}
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-300/90">
            <strong className="font-semibold">Brand field</strong> must match the Reloadly product
            name (case-insensitive, substring). E.g. Reloadly shows{" "}
            <code className="font-mono">"Flipkart IN"</code> → use{" "}
            <code className="font-mono">flipkart</code>. Verify in your{" "}
            <a
              href="https://app.reloadly.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-amber-200"
            >
              Reloadly dashboard
            </a>{" "}
            before saving.
          </div>

          {/* regions */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-base font-semibold">
                <ShoppingBag className="h-4 w-4 text-primary" />
                Gift Card Regions
              </h3>
              <button
                type="button"
                onClick={addRegion}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Plus className="h-3.5 w-3.5" />
                Add region
              </button>
            </div>

            {Object.entries(working.regions).map(([key, region]) => (
              <RegionEditor
                key={key}
                regionKey={key}
                region={region}
                onChange={(r) => updateRegion(key, r)}
                onRemove={() => removeRegion(key)}
              />
            ))}
          </div>

          {/* coin bonus tiers */}
          <div className="rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Coins className="h-4 w-4 text-amber-400" />
              <div>
                <p className="text-sm font-semibold">Coin Bonus Tiers (ranks 6–8)</p>
                <p className="text-xs text-muted-foreground">
                  XUT bonus applied to these ranks on all gift-card events
                </p>
              </div>
            </div>
            <div className="p-4 space-y-2">
              <div className="grid grid-cols-[80px_1fr_1fr_80px_72px_100px_32px] gap-2 px-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                <span>Rank</span>
                <span>Prize label</span>
                <span>Brand</span>
                <span className="text-right">Value</span>
                <span>Currency</span>
                <span>Provider</span>
                <span />
              </div>
              {(working.coinBonusTiers ?? []).map((t, i) => (
                <TierRow
                  key={i}
                  tier={t}
                  index={i}
                  onChange={(updated) => {
                    const tiers = [...(working.coinBonusTiers ?? [])];
                    tiers[i] = updated;
                    updateCoinBonus(tiers);
                  }}
                  onRemove={() => {
                    const tiers = (working.coinBonusTiers ?? []).filter((_: PrizeCatalogTier, idx: number) => idx !== i);
                    updateCoinBonus(tiers);
                  }}
                />
              ))}
              <button
                type="button"
                onClick={() =>
                  updateCoinBonus([
                    ...(working.coinBonusTiers ?? []),
                    emptyTier(`${(working.coinBonusTiers ?? []).length + 1}th`),
                  ])
                }
                className="mt-1 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
              >
                <Plus className="h-3.5 w-3.5" />
                Add tier
              </button>
            </div>
          </div>

          {/* save reminder when dirty */}
          {isDirty && (
            <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-sm text-muted-foreground">You have unsaved changes.</p>
              <button
                type="button"
                onClick={handleSave}
                disabled={save.isPending}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {save.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                Save catalog
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Standalone page wrapper (legacy route redirects to /events?tab=prize-catalog). */
export function PrizeCatalogPage() {
  return <PrizeCatalogPanel />;
}

export default PrizeCatalogPage;
