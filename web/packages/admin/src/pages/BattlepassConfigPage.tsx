import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Crown,
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
  Users,
  Clock,
  Gift,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap,
  CalendarClock,
  CheckCircle2,
  Ban,
  Layers,
  Gem,
  Coins,
  ArrowUp,
  ArrowDown,
  Star,
} from "lucide-react";
import { serverKeyAuth, hiro, satori, type Audience } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface BPReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

interface TierDef {
  tier: number;
  points_required: number;
  free_reward?: BPReward;
  premium_reward?: BPReward;
}

interface SeasonDef {
  id: string;
  name: string;
  description?: string;
  type?: string;
  max_points?: number;
  start_time_sec?: number;
  end_time_sec?: number;
  disabled?: boolean;
  audiences?: string[];
  tiers: TierDef[];
  metadata?: Record<string, unknown>;
}

interface IncentivesConfig {
  incentives?: Record<string, SeasonDef>;
  [key: string]: unknown;
}

type SeasonStatus = "active" | "upcoming" | "expired" | "disabled" | "all";

const XP_SOURCE_PRESETS = [
  "match_complete",
  "match_win",
  "quest_complete",
  "daily_login",
  "event_participation",
  "purchase",
  "friend_invite",
  "streak_bonus",
  "custom",
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function deriveStatus(s: SeasonDef): Exclude<SeasonStatus, "all"> {
  if (s.disabled) return "disabled";
  const now = Math.floor(Date.now() / 1000);
  const start = s.start_time_sec ?? 0;
  const end = s.end_time_sec ?? 0;
  if (end > 0 && now > end) return "expired";
  if (start > 0 && now < start) return "upcoming";
  return "active";
}

function statusColor(s: Exclude<SeasonStatus, "all">) {
  switch (s) {
    case "active": return "text-emerald-400";
    case "upcoming": return "text-sky-400";
    case "expired": return "text-zinc-500";
    case "disabled": return "text-amber-400";
  }
}

function statusBg(s: Exclude<SeasonStatus, "all">) {
  switch (s) {
    case "active": return "bg-emerald-500/10 border-emerald-500/20";
    case "upcoming": return "bg-sky-500/10 border-sky-500/20";
    case "expired": return "bg-zinc-500/10 border-zinc-500/20";
    case "disabled": return "bg-amber-500/10 border-amber-500/20";
  }
}

function StatusIcon({ status }: { status: Exclude<SeasonStatus, "all"> }) {
  switch (status) {
    case "active": return <Zap className="h-3.5 w-3.5 text-emerald-400" />;
    case "upcoming": return <CalendarClock className="h-3.5 w-3.5 text-sky-400" />;
    case "expired": return <CheckCircle2 className="h-3.5 w-3.5 text-zinc-500" />;
    case "disabled": return <Ban className="h-3.5 w-3.5 text-amber-400" />;
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

function formatReward(r?: BPReward): string[] {
  if (!r) return [];
  const parts: string[] = [];
  if (r.currencies) {
    for (const [k, v] of Object.entries(r.currencies)) parts.push(`${v} ${k}`);
  }
  if (r.items) {
    for (const item of r.items) parts.push(`${item.count}x ${item.id}`);
  }
  if (r.energies) {
    for (const [k, v] of Object.entries(r.energies)) parts.push(`${v} ${k} energy`);
  }
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts;
}

function flattenSeasons(config: IncentivesConfig): SeasonDef[] {
  if (!config?.incentives) return [];
  return Object.entries(config.incentives).map(([key, val]) => ({
    ...val,
    id: val.id || key,
    tiers: Array.isArray(val.tiers) ? val.tiers : [],
  }));
}

function rebuildConfig(base: IncentivesConfig, seasons: SeasonDef[]): IncentivesConfig {
  const incentives: Record<string, SeasonDef> = {};
  for (const s of seasons) incentives[s.id] = s;
  return { ...base, incentives };
}

function parseSafe<T>(json: string, setErr: (e: string) => void): T | null {
  try {
    setErr("");
    return JSON.parse(json);
  } catch (e) {
    setErr((e as Error).message);
    return null;
  }
}

function getXpSources(meta?: Record<string, unknown>): Record<string, number> {
  if (!meta?.xp_sources || typeof meta.xp_sources !== "object") return {};
  return meta.xp_sources as Record<string, number>;
}

function getPremiumPrice(meta?: Record<string, unknown>): Record<string, number> {
  if (!meta?.premium_price || typeof meta.premium_price !== "object") return {};
  return meta.premium_price as Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useIncentivesConfig() {
  return useQuery({
    queryKey: ["hiro", "config", "incentives"],
    queryFn: () => hiro.getHiroConfig("incentives", serverKeyAuth()),
    staleTime: 30_000,
  });
}

function useSaveIncentivesConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: IncentivesConfig) =>
      hiro.setHiroConfig("incentives", config, serverKeyAuth()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hiro", "config", "incentives"] });
    },
  });
}

function useAudiences() {
  return useQuery<Audience[]>({
    queryKey: ["satori", "audiences"],
    queryFn: () => satori.listAudiences(serverKeyAuth()),
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Tier Editor                                                        */
/* ------------------------------------------------------------------ */

interface TierEditorProps {
  tiers: TierDef[];
  onChange: (tiers: TierDef[]) => void;
}

function TierEditor({ tiers, onChange }: TierEditorProps) {
  const [expandedTier, setExpandedTier] = useState<number | null>(null);
  const [freeErrors, setFreeErrors] = useState<Record<number, string>>({});
  const [premErrors, setPremErrors] = useState<Record<number, string>>({});
  const [freeJsons, setFreeJsons] = useState<Record<number, string>>({});
  const [premJsons, setPremJsons] = useState<Record<number, string>>({});

  const addTier = () => {
    const nextTier = tiers.length > 0 ? Math.max(...tiers.map((t) => t.tier)) + 1 : 1;
    const lastPts = tiers.length > 0 ? tiers[tiers.length - 1].points_required : 0;
    const newTier: TierDef = {
      tier: nextTier,
      points_required: lastPts + 100,
    };
    onChange([...tiers, newTier]);
    setExpandedTier(nextTier);
  };

  const removeTier = (tierNum: number) => {
    onChange(tiers.filter((t) => t.tier !== tierNum));
    setExpandedTier(null);
  };

  const moveTier = (idx: number, dir: -1 | 1) => {
    const arr = [...tiers];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    arr.forEach((t, i) => (t.tier = i + 1));
    onChange(arr);
  };

  const updateTierField = (tierNum: number, field: keyof TierDef, value: unknown) => {
    onChange(tiers.map((t) => (t.tier === tierNum ? { ...t, [field]: value } : t)));
  };

  const updateTierReward = (tierNum: number, field: "free_reward" | "premium_reward", json: string) => {
    const isF = field === "free_reward";
    if (isF) setFreeJsons((p) => ({ ...p, [tierNum]: json }));
    else setPremJsons((p) => ({ ...p, [tierNum]: json }));

    const setErr = isF
      ? (e: string) => setFreeErrors((p) => ({ ...p, [tierNum]: e }))
      : (e: string) => setPremErrors((p) => ({ ...p, [tierNum]: e }));
    const parsed = parseSafe<BPReward>(json || "{}", setErr);
    if (parsed !== null) {
      const hasContent = Object.keys(parsed).length > 0;
      updateTierField(tierNum, field, hasContent ? parsed : undefined);
    }
  };

  const getJson = (tierNum: number, field: "free_reward" | "premium_reward", reward?: BPReward) => {
    const store = field === "free_reward" ? freeJsons : premJsons;
    if (store[tierNum] !== undefined) return store[tierNum];
    return reward ? JSON.stringify(reward, null, 2) : "";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-foreground">
          Tiers <span className="text-muted-foreground font-normal">({tiers.length})</span>
        </p>
        <button
          type="button"
          onClick={addTier}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
        >
          <Plus className="h-3 w-3" /> Add Tier
        </button>
      </div>

      {tiers.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
          No tiers defined. Add tiers to build the reward ladder.
        </p>
      )}

      <div className="space-y-2">
        {tiers.map((tier, idx) => {
          const isExp = expandedTier === tier.tier;
          const freeR = formatReward(tier.free_reward);
          const premR = formatReward(tier.premium_reward);

          return (
            <div key={tier.tier} className="rounded-md border border-border bg-muted/30">
              <div
                className="flex items-center gap-2 px-3 py-2 cursor-pointer"
                onClick={() => setExpandedTier(isExp ? null : tier.tier)}
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-xs font-bold text-primary">
                  {tier.tier}
                </span>
                <span className="text-xs font-medium text-foreground flex-1">
                  {tier.points_required} pts
                  {freeR.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      Free: {freeR.join(", ")}
                    </span>
                  )}
                  {premR.length > 0 && (
                    <span className="ml-2 text-amber-400">
                      Premium: {premR.join(", ")}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-0.5">
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveTier(idx, -1); }}
                    disabled={idx === 0}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); moveTier(idx, 1); }}
                    disabled={idx === tiers.length - 1}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  >
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={(e) => { e.stopPropagation(); removeTier(tier.tier); }}
                    className="rounded p-0.5 text-destructive/70 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {isExp ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              </div>

              {isExp && (
                <div className="border-t border-border p-3 space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">Points Required</label>
                      <input
                        type="number"
                        min={0}
                        value={tier.points_required}
                        onChange={(e) => updateTierField(tier.tier, "points_required", parseInt(e.target.value, 10) || 0)}
                        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      Free Reward <span className="text-muted-foreground/60">(JSON)</span>
                    </label>
                    <textarea
                      rows={3}
                      value={getJson(tier.tier, "free_reward", tier.free_reward)}
                      onChange={(e) => updateTierReward(tier.tier, "free_reward", e.target.value)}
                      placeholder='{"currencies":{"coins":50}}'
                      className={cn(
                        "w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                        freeErrors[tier.tier] ? "border-destructive" : "border-border",
                      )}
                    />
                    {freeErrors[tier.tier] && (
                      <p className="mt-0.5 text-xs text-destructive">{freeErrors[tier.tier]}</p>
                    )}
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-amber-400">
                      <Crown className="mr-1 inline h-3 w-3" />
                      Premium Reward <span className="text-muted-foreground/60">(JSON)</span>
                    </label>
                    <textarea
                      rows={3}
                      value={getJson(tier.tier, "premium_reward", tier.premium_reward)}
                      onChange={(e) => updateTierReward(tier.tier, "premium_reward", e.target.value)}
                      placeholder='{"currencies":{"gems":10},"items":[{"id":"skin_gold","count":1}]}'
                      className={cn(
                        "w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
                        premErrors[tier.tier] ? "border-destructive" : "border-border",
                      )}
                    />
                    {premErrors[tier.tier] && (
                      <p className="mt-0.5 text-xs text-destructive">{premErrors[tier.tier]}</p>
                    )}
                  </div>

                  <div className="flex gap-2 text-xs text-muted-foreground">
                    {freeR.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-emerald-400">
                        <Gift className="h-3 w-3" /> {freeR.join(", ")}
                      </span>
                    )}
                    {premR.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-400">
                        <Crown className="h-3 w-3" /> {premR.join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Season Form                                                        */
/* ------------------------------------------------------------------ */

interface SeasonFormProps {
  initial?: SeasonDef;
  audiences: Audience[];
  onSubmit: (season: SeasonDef) => void;
  onCancel: () => void;
  isPending: boolean;
  existingIds: string[];
}

function SeasonForm({ initial, audiences, onSubmit, onCancel, isPending, existingIds }: SeasonFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState(initial?.type ?? "battle_pass");
  const [maxPoints, setMaxPoints] = useState(initial?.max_points?.toString() ?? "");
  const [startTime, setStartTime] = useState(toDatetimeLocal(initial?.start_time_sec));
  const [endTime, setEndTime] = useState(toDatetimeLocal(initial?.end_time_sec));
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(initial?.audiences ?? []);
  const [tiers, setTiers] = useState<TierDef[]>(initial?.tiers ?? []);
  const [showPreview, setShowPreview] = useState(false);

  const initXpSources = getXpSources(initial?.metadata);
  const [xpSources, setXpSources] = useState<Array<{ key: string; value: number }>>(
    Object.entries(initXpSources).length > 0
      ? Object.entries(initXpSources).map(([key, value]) => ({ key, value }))
      : [{ key: "match_complete", value: 10 }],
  );

  const initPremPrice = getPremiumPrice(initial?.metadata);
  const [premiumPriceJson, setPremiumPriceJson] = useState(
    Object.keys(initPremPrice).length > 0
      ? JSON.stringify(initPremPrice, null, 2)
      : '{\n  "gems": 500\n}',
  );
  const [premPriceError, setPremPriceError] = useState("");

  const [featuredArt, setFeaturedArt] = useState(
    (initial?.metadata?.featured_art as string) ?? "",
  );

  const idConflict = !initial && existingIds.includes(id.trim());
  const hasJsonErrors = tiers.some((t) => {
    if (t.free_reward) {
      try { JSON.stringify(t.free_reward); } catch { return true; }
    }
    if (t.premium_reward) {
      try { JSON.stringify(t.premium_reward); } catch { return true; }
    }
    return false;
  });

  const previewSeason = useMemo((): SeasonDef | null => {
    if (!id.trim() || !name.trim()) return null;

    const meta: Record<string, unknown> = { ...(initial?.metadata ?? {}) };

    const xpMap: Record<string, number> = {};
    for (const src of xpSources) {
      if (src.key.trim()) xpMap[src.key.trim()] = src.value;
    }
    if (Object.keys(xpMap).length > 0) meta.xp_sources = xpMap;
    else delete meta.xp_sources;

    const premPrice = parseSafe<Record<string, number>>(premiumPriceJson, setPremPriceError);
    if (premPrice && Object.keys(premPrice).length > 0) meta.premium_price = premPrice;
    else if (!premPriceError) delete meta.premium_price;

    if (featuredArt.trim()) meta.featured_art = featuredArt.trim();
    else delete meta.featured_art;

    return {
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      type: type || undefined,
      max_points: maxPoints ? parseInt(maxPoints, 10) : undefined,
      start_time_sec: fromDatetimeLocal(startTime),
      end_time_sec: fromDatetimeLocal(endTime),
      disabled,
      audiences: selectedAudiences.length > 0 ? selectedAudiences : undefined,
      tiers,
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
    };
  }, [id, name, description, type, maxPoints, startTime, endTime, disabled, selectedAudiences, tiers, xpSources, premiumPriceJson, featuredArt, initial?.metadata, premPriceError]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!previewSeason || idConflict || !!premPriceError) return;
    onSubmit(previewSeason);
  };

  const toggleAudience = (aid: string) => {
    setSelectedAudiences((prev) =>
      prev.includes(aid) ? prev.filter((a) => a !== aid) : [...prev, aid],
    );
  };

  const addXpSource = () => setXpSources((prev) => [...prev, { key: "", value: 10 }]);
  const removeXpSource = (idx: number) => setXpSources((prev) => prev.filter((_, i) => i !== idx));
  const updateXpSource = (idx: number, field: "key" | "value", val: string | number) => {
    setXpSources((prev) => prev.map((s, i) => (i === idx ? { ...s, [field]: val } : s)));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Crown className="h-5 w-5 text-amber-400" />
          {initial ? "Edit Season" : "Create Season"}
        </h3>
        <button
          type="button"
          onClick={() => setShowPreview(!showPreview)}
          className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
        >
          <Eye className="h-3 w-3" />
          {showPreview ? "Hide" : "Show"} Preview
        </button>
      </div>

      {/* Basic Info */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Season ID <span className="text-destructive">*</span>
          </label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value.replace(/\s/g, "_").toLowerCase())}
            disabled={!!initial}
            placeholder="season_1"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60",
              idConflict ? "border-destructive" : "border-border",
            )}
          />
          {idConflict && <p className="mt-0.5 text-xs text-destructive">ID already exists</p>}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Name <span className="text-destructive">*</span>
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Season 1: Legends Rise"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Climb the tiers, unlock exclusive rewards..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="battle_pass">Battle Pass</option>
            <option value="event_pass">Event Pass</option>
            <option value="season_pass">Season Pass</option>
            <option value="custom">Custom</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Max XP (Total Points)</label>
          <input
            type="number"
            min={0}
            value={maxPoints}
            onChange={(e) => setMaxPoints(e.target.value)}
            placeholder="Auto from tiers"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Featured Art URL</label>
          <input
            value={featuredArt}
            onChange={(e) => setFeaturedArt(e.target.value)}
            placeholder="https://..."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Timing */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Start Time</label>
          <input
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">End Time</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Premium Pricing */}
      <div>
        <label className="mb-1 block text-xs font-medium text-amber-400">
          <Gem className="mr-1 inline h-3 w-3" />
          Premium Upgrade Price <span className="text-muted-foreground/60">(JSON)</span>
        </label>
        <textarea
          rows={2}
          value={premiumPriceJson}
          onChange={(e) => {
            setPremiumPriceJson(e.target.value);
            parseSafe<Record<string, number>>(e.target.value || "{}", setPremPriceError);
          }}
          placeholder='{"gems": 500}'
          className={cn(
            "w-full rounded-md border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring",
            premPriceError ? "border-destructive" : "border-border",
          )}
        />
        {premPriceError && <p className="mt-0.5 text-xs text-destructive">{premPriceError}</p>}
      </div>

      {/* XP Sources */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            <Zap className="mr-1 inline h-3 w-3 text-primary" />
            XP Sources
          </label>
          <button
            type="button"
            onClick={addXpSource}
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {xpSources.map((src, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              value={XP_SOURCE_PRESETS.includes(src.key as typeof XP_SOURCE_PRESETS[number]) ? src.key : "custom"}
              onChange={(e) => {
                const v = e.target.value;
                updateXpSource(idx, "key", v === "custom" ? "" : v);
              }}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {XP_SOURCE_PRESETS.map((p) => (
                <option key={p} value={p}>{p.replace(/_/g, " ")}</option>
              ))}
            </select>
            {!XP_SOURCE_PRESETS.includes(src.key as typeof XP_SOURCE_PRESETS[number]) && (
              <input
                value={src.key}
                onChange={(e) => updateXpSource(idx, "key", e.target.value)}
                placeholder="custom_source"
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            )}
            <input
              type="number"
              min={1}
              value={src.value}
              onChange={(e) => updateXpSource(idx, "value", parseInt(e.target.value, 10) || 0)}
              className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">XP</span>
            <button type="button" onClick={() => removeXpSource(idx)}
              className="rounded p-1 text-destructive/70 hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Tiers */}
      <TierEditor tiers={tiers} onChange={setTiers} />

      {/* Audiences */}
      {audiences.length > 0 && (
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            <Users className="mr-1 inline h-3 w-3" /> Audience Targeting
          </label>
          <div className="flex flex-wrap gap-1.5">
            {audiences.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAudience(a.id)}
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                  selectedAudiences.includes(a.id)
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                {a.name || a.id}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Disabled toggle */}
      <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
        <input
          type="checkbox"
          checked={disabled}
          onChange={(e) => setDisabled(e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Disabled (hidden from players)
      </label>

      {/* Preview */}
      {showPreview && previewSeason && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Config Preview</p>
          <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs font-mono text-foreground">
            {JSON.stringify(previewSeason, null, 2)}
          </pre>
        </div>
      )}

      {/* Submit */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending || !id.trim() || !name.trim() || idConflict || !!premPriceError || hasJsonErrors}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? "Update Season" : "Create Season"}
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
/*  Season Row                                                         */
/* ------------------------------------------------------------------ */

interface SeasonRowProps {
  season: SeasonDef;
  onEdit: (s: SeasonDef) => void;
  onDuplicate: (s: SeasonDef) => void;
  onDelete: (s: SeasonDef) => void;
  onToggle: (s: SeasonDef) => void;
  isDeleting: boolean;
}

function SeasonRow({ season, onEdit, onDuplicate, onDelete, onToggle, isDeleting }: SeasonRowProps) {
  const status = deriveStatus(season);
  const [expanded, setExpanded] = useState(false);
  const xpSources = getXpSources(season.metadata);
  const premPrice = getPremiumPrice(season.metadata);
  const totalFree = season.tiers.filter((t) => t.free_reward).length;
  const totalPrem = season.tiers.filter((t) => t.premium_reward).length;

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
              <StatusIcon status={status} />
              {status}
            </span>
            {season.type && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
                {season.type.replace(/_/g, " ")}
              </span>
            )}
            <h4 className="text-sm font-semibold text-foreground truncate">{season.name}</h4>
            <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {season.id}
            </code>
          </div>

          {season.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{season.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3 w-3 text-primary" />
              <span className="font-medium text-foreground">{season.tiers.length}</span> tiers
            </span>
            {totalFree > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Gift className="h-3 w-3" />
                {totalFree} free rewards
              </span>
            )}
            {totalPrem > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <Crown className="h-3 w-3" />
                {totalPrem} premium rewards
              </span>
            )}
            {season.max_points && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 text-violet-400" />
                {season.max_points} max XP
              </span>
            )}
            {Object.keys(premPrice).length > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-400">
                <Gem className="h-3 w-3" />
                {Object.entries(premPrice).map(([k, v]) => `${v} ${k}`).join(", ")}
              </span>
            )}
          </div>

          {(season.start_time_sec || season.end_time_sec) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatTs(season.start_time_sec)}</span>
              <span>&rarr;</span>
              <span>{formatTs(season.end_time_sec)}</span>
            </div>
          )}

          {season.audiences && season.audiences.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-violet-400">
              <Users className="h-3 w-3" />
              {season.audiences.join(", ")}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => setExpanded(!expanded)} title="Details"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button onClick={() => onToggle(season)} title={season.disabled ? "Enable" : "Disable"}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              !season.disabled
                ? "text-emerald-400 hover:bg-emerald-500/10"
                : "text-zinc-500 hover:bg-zinc-500/10",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button onClick={() => onDuplicate(season)} title="Duplicate"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button onClick={() => onEdit(season)} title="Edit"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button onClick={() => onDelete(season)} disabled={isDeleting} title="Delete"
            className="rounded-md p-1.5 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Tier Ladder</p>
              <div className="space-y-1 max-h-48 overflow-auto">
                {season.tiers.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tiers defined</p>
                ) : (
                  season.tiers.map((t) => (
                    <div key={t.tier} className="flex items-center gap-2 rounded bg-muted px-2 py-1 text-xs">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] font-bold text-primary">
                        {t.tier}
                      </span>
                      <span className="text-foreground font-medium">{t.points_required} pts</span>
                      {t.free_reward && (
                        <span className="text-emerald-400">{formatReward(t.free_reward).join(", ") || "free"}</span>
                      )}
                      {t.premium_reward && (
                        <span className="text-amber-400">{formatReward(t.premium_reward).join(", ") || "premium"}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="space-y-3">
              {Object.keys(xpSources).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">XP Sources</p>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(xpSources).map(([k, v]) => (
                      <span key={k} className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                        {k.replace(/_/g, " ")}: <span className="text-primary">{v} XP</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Raw Config</p>
                <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-32">
                  {JSON.stringify(season, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function BattlepassConfigPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<SeasonStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SeasonDef | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<SeasonDef | null>(null);

  const { data: rawConfig, isLoading, isError, error, refetch } = useIncentivesConfig();
  const save = useSaveIncentivesConfig();
  const { data: audiences = [] } = useAudiences();

  const incentivesConfig = (rawConfig ?? {}) as IncentivesConfig;
  const seasons = useMemo(() => flattenSeasons(incentivesConfig), [incentivesConfig]);

  const filtered = useMemo(() => {
    let list = seasons;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.id.toLowerCase().includes(q) ||
          s.description?.toLowerCase().includes(q) ||
          s.type?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((s) => deriveStatus(s) === statusFilter);
    }
    return list;
  }, [seasons, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, expired: 0, disabled: 0, all: seasons.length };
    for (const s of seasons) c[deriveStatus(s)]++;
    return c;
  }, [seasons]);

  const handleSubmit = useCallback(
    (season: SeasonDef) => {
      const updated = [...seasons.filter((s) => s.id !== season.id), season];
      const newConfig = rebuildConfig(incentivesConfig, updated);
      save.mutate(newConfig, {
        onSuccess: () => {
          setShowForm(false);
          setEditing(null);
        },
      });
    },
    [seasons, incentivesConfig, save],
  );

  const handleDelete = useCallback(
    (season: SeasonDef) => {
      setDeletingId(season.id);
      const updated = seasons.filter((s) => s.id !== season.id);
      const newConfig = rebuildConfig(incentivesConfig, updated);
      save.mutate(newConfig, {
        onSettled: () => {
          setDeletingId(null);
          setConfirmDelete(null);
        },
      });
    },
    [seasons, incentivesConfig, save],
  );

  const handleToggle = useCallback(
    (season: SeasonDef) => {
      const toggled = { ...season, disabled: !season.disabled };
      const updated = seasons.map((s) => (s.id === season.id ? toggled : s));
      const newConfig = rebuildConfig(incentivesConfig, updated);
      save.mutate(newConfig);
    },
    [seasons, incentivesConfig, save],
  );

  const handleDuplicate = useCallback(
    (season: SeasonDef) => {
      const newId = `${season.id}_copy_${Date.now().toString(36)}`;
      setEditing({
        ...season,
        id: newId,
        name: `${season.name} (Copy)`,
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
            <Crown className="h-6 w-6 text-amber-400" />
            Battle Pass Configuration
          </h2>
          <p className="text-sm text-muted-foreground">
            Design seasons, tier ladders, rewards, XP sources, and premium pricing for your battle pass.
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
            Create Season
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["all", "active", "upcoming", "expired", "disabled"] as SeasonStatus[]).map((s) => (
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
            <p className="text-xs capitalize text-muted-foreground">{s} seasons</p>
          </button>
        ))}
      </div>

      {/* Form */}
      {(showForm || editing) && (
        <SeasonForm
          initial={editing && !showForm ? editing : undefined}
          audiences={audiences}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={save.isPending}
          existingIds={seasons.map((s) => s.id)}
        />
      )}

      {/* Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search seasons by name, ID, or type..."
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground">
              Delete season &ldquo;{confirmDelete.name}&rdquo;?
            </p>
            <p className="text-xs text-muted-foreground">
              This will remove the season and all its tiers from the incentives config. This action cannot be undone.
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
          Failed to load incentives config: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading battle pass configuration&hellip;
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Crown className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">
            {seasons.length === 0
              ? "No battle pass seasons configured yet"
              : "No seasons match your search"}
          </p>
          <p className="mt-1 text-xs">
            {seasons.length === 0
              ? "Click \"Create Season\" to build your first battle pass."
              : "Try adjusting your search or filter."}
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((season) => (
            <SeasonRow
              key={season.id}
              season={season}
              onEdit={(s) => {
                setEditing(s);
                setShowForm(false);
              }}
              onDuplicate={handleDuplicate}
              onDelete={(s) => setConfirmDelete(s)}
              onToggle={handleToggle}
              isDeleting={deletingId === season.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}


export default BattlepassConfigPage;
