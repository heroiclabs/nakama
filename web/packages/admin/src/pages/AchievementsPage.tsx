import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Award,
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
  EyeOff,
  Target,
  Users,
  Gift,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Zap,
  CheckCircle2,
  Ban,
  Shield,
  Star,
  Trophy,
  Crown,
  Gem,
  Medal,
  UserPlus,
  Hash,
} from "lucide-react";
import { serverKeyAuth, hiro, satori, type Audience } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface AchievementReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

interface AchievementDef {
  id: string;
  name: string;
  description?: string;
  category?: string;
  max_count: number;
  reward?: AchievementReward;
  rewards?: AchievementReward[];
  precondition_ids?: string[];
  disabled?: boolean;
  audiences?: string[];
  sort_order?: number;
  auto_claim?: boolean;
  auto_reset?: boolean;
  reset_time_sec?: number;
  icon?: string;
  badge_rarity?: string;
  hidden?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AchievementsConfig {
  achievements?: Record<string, AchievementDef>;
  [key: string]: unknown;
}

type AchievementStatus = "enabled" | "disabled" | "all";

const CATEGORIES = [
  "progression",
  "combat",
  "social",
  "collection",
  "exploration",
  "competitive",
  "event",
  "mastery",
  "milestone",
  "secret",
  "custom",
] as const;

const RARITIES = [
  { value: "common", label: "Common", color: "text-zinc-400" },
  { value: "uncommon", label: "Uncommon", color: "text-emerald-400" },
  { value: "rare", label: "Rare", color: "text-sky-400" },
  { value: "epic", label: "Epic", color: "text-purple-400" },
  { value: "legendary", label: "Legendary", color: "text-amber-400" },
] as const;

const ICONS = [
  "trophy", "star", "shield", "crown", "gem", "medal", "award", "target",
  "zap", "sparkles", "sword", "flame", "heart", "bolt", "globe",
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusColor(disabled?: boolean) {
  return disabled ? "text-amber-400" : "text-emerald-400";
}

function statusBg(disabled?: boolean) {
  return disabled
    ? "bg-amber-500/10 border-amber-500/20"
    : "bg-emerald-500/10 border-emerald-500/20";
}

function StatusIcon({ disabled }: { disabled?: boolean }) {
  return disabled
    ? <Ban className="h-3.5 w-3.5 text-amber-400" />
    : <Zap className="h-3.5 w-3.5 text-emerald-400" />;
}

function formatReward(r?: AchievementReward): string[] {
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

function flattenAchievements(config: AchievementsConfig): AchievementDef[] {
  if (!config?.achievements) return [];
  return Object.entries(config.achievements).map(([key, val]) => ({
    ...val,
    id: val.id || key,
  }));
}

function rebuildConfig(base: AchievementsConfig, achievements: AchievementDef[]): AchievementsConfig {
  const map: Record<string, AchievementDef> = {};
  for (const a of achievements) map[a.id] = a;
  return { ...base, achievements: map };
}

function parseSafe<T>(json: string, fallback: T): T {
  try { return JSON.parse(json); } catch { return fallback; }
}

function rarityColor(rarity?: string) {
  return RARITIES.find((r) => r.value === rarity)?.color ?? "text-zinc-400";
}

function rarityLabel(rarity?: string) {
  return RARITIES.find((r) => r.value === rarity)?.label ?? "Common";
}

function IconPreview({ icon }: { icon?: string }) {
  const cls = "h-5 w-5";
  switch (icon) {
    case "trophy": return <Trophy className={cls} />;
    case "star": return <Star className={cls} />;
    case "shield": return <Shield className={cls} />;
    case "crown": return <Crown className={cls} />;
    case "gem": return <Gem className={cls} />;
    case "medal": return <Medal className={cls} />;
    case "award": return <Award className={cls} />;
    case "target": return <Target className={cls} />;
    case "zap": return <Zap className={cls} />;
    case "sparkles": return <Sparkles className={cls} />;
    default: return <Award className={cls} />;
  }
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useAchievementsConfig() {
  return useQuery({
    queryKey: ["hiro", "config", "achievements"],
    queryFn: () => hiro.getHiroConfig("achievements", serverKeyAuth()),
    staleTime: 30_000,
  });
}

function useSaveAchievementsConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      hiro.setHiroConfig("achievements", config, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiro", "config", "achievements"] }),
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
/*  Achievement Form                                                   */
/* ------------------------------------------------------------------ */

interface AchievementFormProps {
  initial?: AchievementDef;
  audiences: Audience[];
  onSubmit: (achievement: AchievementDef) => void;
  onCancel: () => void;
  isPending: boolean;
  existingIds: string[];
}

function AchievementForm({
  initial,
  audiences,
  onSubmit,
  onCancel,
  isPending,
  existingIds,
}: AchievementFormProps) {
  const isEdit = !!initial;
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "progression");
  const [maxCount, setMaxCount] = useState(initial?.max_count?.toString() ?? "1");
  const [rewardJson, setRewardJson] = useState(
    initial?.reward
      ? JSON.stringify(initial.reward, null, 2)
      : '{\n  "currencies": { "coins": 100 },\n  "xp": 50\n}',
  );
  const [preconditionIds, setPreconditionIds] = useState(
    initial?.precondition_ids?.join(", ") ?? "",
  );
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(
    initial?.audiences ?? [],
  );
  const [sortOrder, setSortOrder] = useState(initial?.sort_order?.toString() ?? "0");
  const [autoClaim, setAutoClaim] = useState(initial?.auto_claim ?? false);
  const [autoReset, setAutoReset] = useState(initial?.auto_reset ?? false);
  const [icon, setIcon] = useState(initial?.icon ?? "trophy");
  const [badgeRarity, setBadgeRarity] = useState(initial?.badge_rarity ?? "common");
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  const [metadataJson, setMetadataJson] = useState(
    initial?.metadata ? JSON.stringify(initial.metadata, null, 2) : "{}",
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAudiences, setShowAudiences] = useState(
    (initial?.audiences?.length ?? 0) > 0,
  );

  const idError = useMemo(() => {
    if (!id) return "ID is required";
    if (!/^[a-z0-9_-]+$/.test(id)) return "Only lowercase, numbers, hyphens, underscores";
    if (!isEdit && existingIds.includes(id)) return "ID already exists";
    return null;
  }, [id, isEdit, existingIds]);

  const rewardError = useMemo(() => {
    try { JSON.parse(rewardJson); return null; } catch { return "Invalid JSON"; }
  }, [rewardJson]);

  const metaError = useMemo(() => {
    try { JSON.parse(metadataJson); return null; } catch { return "Invalid JSON"; }
  }, [metadataJson]);

  const canSubmit = !idError && !rewardError && !metaError && name.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    const reward = parseSafe<AchievementReward>(rewardJson, {});
    const metadata = parseSafe<Record<string, unknown>>(metadataJson, {});
    const preconditions = preconditionIds
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const def: AchievementDef = {
      ...(initial ?? {}),
      id,
      name: name.trim(),
      description: description.trim() || undefined,
      category,
      max_count: Math.max(1, parseInt(maxCount, 10) || 1),
      reward,
      precondition_ids: preconditions.length ? preconditions : undefined,
      disabled,
      audiences: selectedAudiences.length ? selectedAudiences : undefined,
      sort_order: parseInt(sortOrder, 10) || 0,
      auto_claim: autoClaim || undefined,
      auto_reset: autoReset || undefined,
      icon,
      badge_rarity: badgeRarity,
      hidden: hidden || undefined,
      metadata: Object.keys(metadata).length ? metadata : undefined,
    };
    onSubmit(def);
  }

  const input =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
  const label = "block text-xs font-medium text-muted-foreground mb-1";
  const section =
    "rounded-lg border border-border bg-card/50 p-4 space-y-4";

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-6 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          {isEdit ? "Edit Achievement" : "New Achievement"}
        </h3>
        <button onClick={onCancel} className="rounded-md p-1 hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Basic Info */}
      <div className={section}>
        <p className="text-sm font-medium text-foreground">Basic Info</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={label}>ID *</label>
            <input
              className={cn(input, idError && id && "border-red-500")}
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/\s/g, "_"))}
              placeholder="first_blood"
              disabled={isEdit}
            />
            {idError && id && (
              <p className="text-xs text-red-400 mt-1">{idError}</p>
            )}
          </div>
          <div>
            <label className={label}>Name *</label>
            <input
              className={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="First Blood"
            />
          </div>
        </div>
        <div>
          <label className={label}>Description</label>
          <textarea
            className={cn(input, "min-h-[60px] resize-y")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Win your first match."
            rows={2}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={label}>Category</label>
            <select
              className={input}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Target Count</label>
            <input
              type="number"
              min={1}
              className={input}
              value={maxCount}
              onChange={(e) => setMaxCount(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Progress needed to complete
            </p>
          </div>
          <div>
            <label className={label}>Sort Order</label>
            <input
              type="number"
              className={input}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Display Rules */}
      <div className={section}>
        <p className="text-sm font-medium text-foreground">Display Rules</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={label}>Icon</label>
            <div className="flex gap-2">
              <select
                className={cn(input, "flex-1")}
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
              >
                {ICONS.map((i) => (
                  <option key={i} value={i}>
                    {i.charAt(0).toUpperCase() + i.slice(1)}
                  </option>
                ))}
              </select>
              <div className="flex items-center justify-center w-10 h-10 rounded-md border border-border bg-muted/50">
                <IconPreview icon={icon} />
              </div>
            </div>
          </div>
          <div>
            <label className={label}>Badge Rarity</label>
            <select
              className={input}
              value={badgeRarity}
              onChange={(e) => setBadgeRarity(e.target.value)}
            >
              {RARITIES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <p className={cn("text-xs mt-1", rarityColor(badgeRarity))}>
              {rarityLabel(badgeRarity)} badge
            </p>
          </div>
          <div className="flex flex-col gap-2 pt-5">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={hidden}
                onChange={() => setHidden(!hidden)}
                className="rounded border-border"
              />
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
              Hidden until earned
            </label>
          </div>
        </div>
      </div>

      {/* Reward */}
      <div className={section}>
        <p className="text-sm font-medium text-foreground">Reward (JSON)</p>
        <textarea
          className={cn(
            input,
            "min-h-[100px] font-mono text-xs resize-y",
            rewardError && "border-red-500",
          )}
          value={rewardJson}
          onChange={(e) => setRewardJson(e.target.value)}
          rows={5}
        />
        {rewardError && (
          <p className="text-xs text-red-400">{rewardError}</p>
        )}
        {!rewardError && (
          <div className="flex flex-wrap gap-1.5">
            {formatReward(parseSafe(rewardJson, {})).map((part, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
              >
                <Gift className="h-3 w-3" />
                {part}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Behaviour */}
      <div className={section}>
        <p className="text-sm font-medium text-foreground">Behaviour</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={disabled}
                onChange={() => setDisabled(!disabled)}
                className="rounded border-border"
              />
              <Ban className="h-3.5 w-3.5 text-muted-foreground" />
              Disabled
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoClaim}
                onChange={() => setAutoClaim(!autoClaim)}
                className="rounded border-border"
              />
              <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />
              Auto-claim on completion
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={autoReset}
                onChange={() => setAutoReset(!autoReset)}
                className="rounded border-border"
              />
              <RefreshCw className="h-3.5 w-3.5 text-muted-foreground" />
              Auto-reset (repeatable)
            </label>
          </div>
          <div>
            <label className={label}>Precondition IDs</label>
            <input
              className={input}
              value={preconditionIds}
              onChange={(e) => setPreconditionIds(e.target.value)}
              placeholder="ach_1, ach_2"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Comma-separated achievement IDs required first
            </p>
          </div>
        </div>
      </div>

      {/* Audience Targeting */}
      <div className={section}>
        <button
          type="button"
          onClick={() => setShowAudiences(!showAudiences)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
        >
          <Users className="h-4 w-4" />
          Audience Targeting
          {showAudiences ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          {selectedAudiences.length > 0 && (
            <span className="ml-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
              {selectedAudiences.length}
            </span>
          )}
        </button>
        {showAudiences && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2">
            {audiences.length === 0 ? (
              <p className="text-xs text-muted-foreground col-span-full">
                No audiences configured in Satori.
              </p>
            ) : (
              audiences.map((a) => (
                <label
                  key={a.id}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer transition-colors",
                    selectedAudiences.includes(a.id)
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-muted-foreground",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={selectedAudiences.includes(a.id)}
                    onChange={() => {
                      setSelectedAudiences((prev) =>
                        prev.includes(a.id)
                          ? prev.filter((x) => x !== a.id)
                          : [...prev, a.id],
                      );
                    }}
                    className="rounded border-border"
                  />
                  {a.name || a.id}
                </label>
              ))
            )}
          </div>
        )}
      </div>

      {/* Advanced / Metadata */}
      <div className={section}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-2 text-sm font-medium text-foreground hover:text-primary transition-colors"
        >
          Advanced / Metadata
          {showAdvanced ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
        {showAdvanced && (
          <div>
            <label className={label}>Metadata (JSON)</label>
            <textarea
              className={cn(
                input,
                "min-h-[80px] font-mono text-xs resize-y",
                metaError && "border-red-500",
              )}
              value={metadataJson}
              onChange={(e) => setMetadataJson(e.target.value)}
              rows={4}
            />
            {metaError && (
              <p className="text-xs text-red-400">{metaError}</p>
            )}
          </div>
        )}
      </div>

      {/* Preview */}
      <div className="rounded-lg border border-dashed border-border p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">
          Preview
        </p>
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl border-2",
              disabled ? "border-zinc-600 bg-zinc-800/50 text-zinc-500" : "",
              !disabled && badgeRarity === "common" && "border-zinc-500 bg-zinc-800/50 text-zinc-400",
              !disabled && badgeRarity === "uncommon" && "border-emerald-500 bg-emerald-900/30 text-emerald-400",
              !disabled && badgeRarity === "rare" && "border-sky-500 bg-sky-900/30 text-sky-400",
              !disabled && badgeRarity === "epic" && "border-purple-500 bg-purple-900/30 text-purple-400",
              !disabled && badgeRarity === "legendary" && "border-amber-500 bg-amber-900/30 text-amber-400",
            )}
          >
            <IconPreview icon={icon} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm truncate">
                {name || "Untitled"}
              </span>
              {hidden && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  HIDDEN
                </span>
              )}
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium",
                  rarityColor(badgeRarity),
                )}
              >
                {rarityLabel(badgeRarity)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {description || "No description"}
            </p>
            <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Target className="h-3 w-3" />
                0 / {maxCount || 1}
              </span>
              <span className="capitalize">{category}</span>
              {autoClaim && (
                <span className="text-primary">auto-claim</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          onClick={onCancel}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit || isPending}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium transition-colors",
            canSubmit && !isPending
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-muted text-muted-foreground cursor-not-allowed",
          )}
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : isEdit ? (
            "Save Changes"
          ) : (
            "Create Achievement"
          )}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function AchievementsPage() {
  const { data: rawConfig, isLoading, error, refetch } = useAchievementsConfig();
  const saveMutation = useSaveAchievementsConfig();
  const { data: audiences = [] } = useAudiences();

  const config = (rawConfig ?? {}) as AchievementsConfig;
  const achievements = useMemo(() => flattenAchievements(config), [config]);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<AchievementStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [rarityFilter, setRarityFilter] = useState("");
  const [editing, setEditing] = useState<AchievementDef | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    let list = achievements;
    if (statusFilter === "enabled") list = list.filter((a) => !a.disabled);
    if (statusFilter === "disabled") list = list.filter((a) => a.disabled);
    if (categoryFilter) list = list.filter((a) => a.category === categoryFilter);
    if (rarityFilter) list = list.filter((a) => a.badge_rarity === rarityFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          a.id.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.description ?? "").toLowerCase().includes(q),
      );
    }
    return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [achievements, statusFilter, categoryFilter, rarityFilter, search]);

  const existingIds = useMemo(() => achievements.map((a) => a.id), [achievements]);

  const counts = useMemo(() => {
    const enabled = achievements.filter((a) => !a.disabled).length;
    const disabled = achievements.length - enabled;
    return { total: achievements.length, enabled, disabled };
  }, [achievements]);

  const saveAchievement = useCallback(
    (def: AchievementDef) => {
      const updated = [...achievements.filter((a) => a.id !== def.id), def];
      saveMutation.mutate(rebuildConfig(config, updated) as Record<string, unknown>, {
        onSuccess: () => {
          setEditing(null);
          setCreating(false);
        },
      });
    },
    [achievements, config, saveMutation],
  );

  const deleteAchievement = useCallback(
    (id: string) => {
      const updated = achievements.filter((a) => a.id !== id);
      saveMutation.mutate(rebuildConfig(config, updated) as Record<string, unknown>, {
        onSuccess: () => setDeleteConfirm(null),
      });
    },
    [achievements, config, saveMutation],
  );

  const toggleAchievement = useCallback(
    (id: string) => {
      const updated = achievements.map((a) =>
        a.id === id ? { ...a, disabled: !a.disabled } : a,
      );
      saveMutation.mutate(rebuildConfig(config, updated) as Record<string, unknown>);
    },
    [achievements, config, saveMutation],
  );

  const duplicateAchievement = useCallback(
    (a: AchievementDef) => {
      let newId = `${a.id}_copy`;
      let n = 1;
      while (existingIds.includes(newId)) {
        newId = `${a.id}_copy_${n++}`;
      }
      setEditing(null);
      setCreating(false);
      setTimeout(() => {
        setEditing({ ...a, id: newId, name: `${a.name} (Copy)` });
        setCreating(true);
      }, 0);
    },
    [existingIds],
  );

  /* Loading / Error states */
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <AlertTriangle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Failed to load achievements config.
        </p>
        <button
          onClick={() => refetch()}
          className="rounded-md border border-border px-4 py-2 text-sm hover:bg-muted"
        >
          Retry
        </button>
      </div>
    );
  }

  /* If form is open */
  if (editing || creating) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Achievements</h2>
          <p className="text-muted-foreground">
            Define and manage achievement badges.
          </p>
        </div>
        <AchievementForm
          initial={editing ?? undefined}
          audiences={audiences}
          onSubmit={saveAchievement}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
          isPending={saveMutation.isPending}
          existingIds={creating ? existingIds : []}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Achievements</h2>
          <p className="text-muted-foreground">
            Define and manage achievement badges.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            className="rounded-md border border-border p-2 hover:bg-muted transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Achievement
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total", value: counts.total, icon: Award, color: "text-foreground" },
          { label: "Enabled", value: counts.enabled, icon: Zap, color: "text-emerald-400" },
          { label: "Disabled", value: counts.disabled, icon: Ban, color: "text-amber-400" },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card p-4 flex items-center gap-3"
          >
            <s.icon className={cn("h-5 w-5", s.color)} />
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-border bg-background pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Search achievements..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as AchievementStatus)}
          >
            <option value="all">All Status</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "rounded-md border px-3 py-2 text-sm transition-colors",
              showFilters
                ? "border-primary bg-primary/10 text-primary"
                : "border-border hover:bg-muted",
            )}
          >
            <Filter className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card/50 p-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Category
            </label>
            <select
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">
              Rarity
            </label>
            <select
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs"
              value={rarityFilter}
              onChange={(e) => setRarityFilter(e.target.value)}
            >
              <option value="">All</option>
              {RARITIES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          {(categoryFilter || rarityFilter) && (
            <button
              onClick={() => {
                setCategoryFilter("");
                setRarityFilter("");
              }}
              className="self-end rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              Clear Filters
            </button>
          )}
        </div>
      )}

      {/* Save indicator */}
      {saveMutation.isPending && (
        <div className="flex items-center gap-2 rounded-md bg-primary/10 border border-primary/20 px-3 py-2 text-sm text-primary">
          <Loader2 className="h-4 w-4 animate-spin" />
          Saving…
        </div>
      )}

      {/* Achievement List */}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <Award className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <p className="text-sm text-muted-foreground">
            {achievements.length === 0
              ? "No achievements configured yet."
              : "No achievements match your filters."}
          </p>
          {achievements.length === 0 && (
            <button
              onClick={() => setCreating(true)}
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Create First Achievement
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((a) => {
            const rewards = formatReward(a.reward);
            const isExpanded = expandedId === a.id;
            const isDeleting = deleteConfirm === a.id;

            return (
              <div
                key={a.id}
                className={cn(
                  "rounded-lg border bg-card transition-colors",
                  statusBg(a.disabled),
                )}
              >
                {/* Card Header */}
                <div className="flex items-center gap-4 p-4">
                  {/* Badge Icon */}
                  <div
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2",
                      a.disabled && "border-zinc-600 bg-zinc-800/50 text-zinc-500",
                      !a.disabled && a.badge_rarity === "common" && "border-zinc-500 bg-zinc-800/50 text-zinc-400",
                      !a.disabled && a.badge_rarity === "uncommon" && "border-emerald-500 bg-emerald-900/30 text-emerald-400",
                      !a.disabled && a.badge_rarity === "rare" && "border-sky-500 bg-sky-900/30 text-sky-400",
                      !a.disabled && a.badge_rarity === "epic" && "border-purple-500 bg-purple-900/30 text-purple-400",
                      !a.disabled && a.badge_rarity === "legendary" && "border-amber-500 bg-amber-900/30 text-amber-400",
                      !a.disabled && !a.badge_rarity && "border-zinc-500 bg-zinc-800/50 text-zinc-400",
                    )}
                  >
                    <IconPreview icon={a.icon} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm truncate">
                        {a.name}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          statusBg(a.disabled),
                          statusColor(a.disabled),
                        )}
                      >
                        <StatusIcon disabled={a.disabled} />
                        {a.disabled ? "Disabled" : "Enabled"}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          rarityColor(a.badge_rarity),
                        )}
                      >
                        {rarityLabel(a.badge_rarity)}
                      </span>
                      {a.hidden && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground flex items-center gap-0.5">
                          <EyeOff className="h-2.5 w-2.5" />
                          Hidden
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                      {a.description || "No description"}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="font-mono">{a.id}</span>
                      <span className="capitalize">{a.category || "—"}</span>
                      <span className="flex items-center gap-1">
                        <Target className="h-3 w-3" />
                        {a.max_count}
                      </span>
                      {rewards.length > 0 && (
                        <span className="flex items-center gap-1 text-primary">
                          <Gift className="h-3 w-3" />
                          {rewards.join(", ")}
                        </span>
                      )}
                      {a.auto_claim && (
                        <span className="text-primary">auto-claim</span>
                      )}
                      {a.audiences && a.audiences.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {a.audiences.length}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() =>
                        setExpandedId(isExpanded ? null : a.id)
                      }
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title="Details"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleAchievement(a.id)}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title={a.disabled ? "Enable" : "Disable"}
                    >
                      {a.disabled ? (
                        <Eye className="h-4 w-4 text-emerald-400" />
                      ) : (
                        <EyeOff className="h-4 w-4 text-amber-400" />
                      )}
                    </button>
                    <button
                      onClick={() => duplicateAchievement(a)}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title="Duplicate"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        setEditing(a);
                        setCreating(false);
                      }}
                      className="rounded-md p-1.5 hover:bg-muted transition-colors"
                      title="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {isDeleting ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteAchievement(a.id)}
                          className="rounded-md p-1.5 bg-red-500/20 text-red-400 hover:bg-red-500/30"
                          title="Confirm Delete"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="rounded-md p-1.5 hover:bg-muted"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(a.id)}
                        className="rounded-md p-1.5 hover:bg-muted text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExpanded && (
                  <div className="border-t border-border px-4 py-3 bg-muted/30 space-y-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">Target Count</p>
                        <p className="font-medium">{a.max_count}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Category</p>
                        <p className="font-medium capitalize">
                          {a.category || "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Sort Order</p>
                        <p className="font-medium">{a.sort_order ?? 0}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Rarity</p>
                        <p className={cn("font-medium", rarityColor(a.badge_rarity))}>
                          {rarityLabel(a.badge_rarity)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Auto-claim</p>
                        <p className="font-medium">
                          {a.auto_claim ? "Yes" : "No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Auto-reset</p>
                        <p className="font-medium">
                          {a.auto_reset ? "Yes" : "No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Hidden</p>
                        <p className="font-medium">
                          {a.hidden ? "Yes" : "No"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Icon</p>
                        <p className="font-medium capitalize">
                          {a.icon || "award"}
                        </p>
                      </div>
                    </div>

                    {/* Preconditions */}
                    {a.precondition_ids && a.precondition_ids.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Preconditions
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {a.precondition_ids.map((pid) => (
                            <span
                              key={pid}
                              className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-mono"
                            >
                              <Hash className="h-3 w-3" />
                              {pid}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Rewards */}
                    {rewards.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Rewards
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {rewards.map((r, i) => (
                            <span
                              key={i}
                              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
                            >
                              <Gift className="h-3 w-3" />
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Audiences */}
                    {a.audiences && a.audiences.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Audiences
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {a.audiences.map((aid) => {
                            const aud = audiences.find((x) => x.id === aid);
                            return (
                              <span
                                key={aid}
                                className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 px-2 py-0.5 text-xs text-sky-400"
                              >
                                <Users className="h-3 w-3" />
                                {aud?.name || aid}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Metadata */}
                    {a.metadata && Object.keys(a.metadata).length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Metadata
                        </p>
                        <pre className="rounded-md bg-muted p-2 text-xs font-mono overflow-auto max-h-32">
                          {JSON.stringify(a.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


export default AchievementsPage;
