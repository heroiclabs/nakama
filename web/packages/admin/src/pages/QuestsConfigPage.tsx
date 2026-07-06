import { useState, useMemo, useCallback } from "react";
import { useScopedGameId } from "@/hooks/useScopedGame";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Swords,
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
  Target,
  Users,
  Clock,
  Gift,
  Timer,
  ChevronDown,
  ChevronUp,
  Repeat,
  Link2,
  Sparkles,
  Zap,
  CalendarClock,
  CheckCircle2,
  Ban,
} from "lucide-react";
import {
  serverKeyAuth,
  hiro,
  satori,
  questEngine,
  type Audience,
  type QuestEngineQuest,
  type QuestEngineStep,
  type QuestEngineConfig,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const GLOBAL_CONFIG_SCOPE = "global";
// Quest Engine stores config under a concrete gameId; events with no gameId
// resolve to "default" (see quest_engine.ts resolveGameId).
const QUEST_ENGINE_DEFAULT_GAME = "default";

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface QuestReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

interface QuestDef {
  id: string;
  name: string;
  description?: string;
  category?: string;
  max_count: number;
  reward?: QuestReward;
  rewards?: QuestReward[];
  start_time_sec?: number;
  end_time_sec?: number;
  reset_time_sec?: number;
  precondition_ids?: string[];
  disabled?: boolean;
  audiences?: string[];
  sort_order?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ChallengesConfig {
  challenges?: Record<string, QuestDef>;
  [key: string]: unknown;
}

type QuestStatus = "active" | "upcoming" | "expired" | "disabled" | "all";

const CATEGORIES = [
  "daily",
  "weekly",
  "seasonal",
  "event",
  "tutorial",
  "premium",
  "competitive",
  "social",
  "custom",
] as const;

const OBJECTIVE_TYPES = [
  "matches_played",
  "matches_won",
  "score_reached",
  "kills",
  "items_collected",
  "friends_invited",
  "currency_earned",
  "currency_spent",
  "events_joined",
  "streaks_maintained",
  "custom",
] as const;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function deriveStatus(q: QuestDef): Exclude<QuestStatus, "all"> {
  if (q.disabled) return "disabled";
  const now = Math.floor(Date.now() / 1000);
  const start = q.start_time_sec ?? 0;
  const end = q.end_time_sec ?? 0;
  if (end > 0 && now > end) return "expired";
  if (start > 0 && now < start) return "upcoming";
  return "active";
}

function statusColor(s: Exclude<QuestStatus, "all">) {
  switch (s) {
    case "active": return "text-emerald-400";
    case "upcoming": return "text-sky-400";
    case "expired": return "text-zinc-500";
    case "disabled": return "text-amber-400";
  }
}

function statusBg(s: Exclude<QuestStatus, "all">) {
  switch (s) {
    case "active": return "bg-emerald-500/10 border-emerald-500/20";
    case "upcoming": return "bg-sky-500/10 border-sky-500/20";
    case "expired": return "bg-zinc-500/10 border-zinc-500/20";
    case "disabled": return "bg-amber-500/10 border-amber-500/20";
  }
}

function StatusIcon({ status }: { status: Exclude<QuestStatus, "all"> }) {
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

function formatReward(r?: QuestReward): string[] {
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

function flattenQuests(config: ChallengesConfig): QuestDef[] {
  if (!config?.challenges) return [];
  return Object.entries(config.challenges).map(([key, val]) => ({
    ...val,
    id: val.id || key,
  }));
}

function rebuildConfig(base: ChallengesConfig, quests: QuestDef[]): ChallengesConfig {
  const challenges: Record<string, QuestDef> = {};
  for (const q of quests) challenges[q.id] = q;
  return { ...base, challenges };
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useChallengesConfig(gameScope: string) {
  return useQuery({
    queryKey: ["hiro", "config", "challenges", gameScope],
    queryFn: () => hiro.getHiroConfig("challenges", serverKeyAuth(), rpcGameId(gameScope)),
    staleTime: 30_000,
  });
}

function useSaveChallengesConfig(gameScope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      hiro.setHiroConfig("challenges", config, serverKeyAuth(), rpcGameId(gameScope)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiro", "config", "challenges", gameScope] }),
  });
}

function useAudiences(gameScope: string) {
  return useQuery({
    queryKey: ["satori", "audiences", gameScope],
    queryFn: () => satori.listAudiences(serverKeyAuth(), rpcGameId(gameScope)),
    select: (data: { audiences?: Audience[] }) => data?.audiences ?? [],
    staleTime: 60_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Quest Form                                                         */
/* ------------------------------------------------------------------ */

interface QuestFormProps {
  initial?: QuestDef;
  audiences: Audience[];
  onSubmit: (quest: QuestDef) => void;
  onCancel: () => void;
  isPending: boolean;
  existingIds: string[];
}

function QuestForm({ initial, audiences, onSubmit, onCancel, isPending, existingIds }: QuestFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "daily");
  const [maxCount, setMaxCount] = useState(initial?.max_count?.toString() ?? "1");
  const [objectiveType, setObjectiveType] = useState<string>(
    (initial?.metadata?.objective_type as string) ?? "matches_played",
  );
  const [linkedMode, setLinkedMode] = useState<string>(
    (initial?.metadata?.linked_mode as string) ?? "",
  );
  const [rewardJson, setRewardJson] = useState(
    initial?.reward
      ? JSON.stringify(initial.reward, null, 2)
      : '{\n  "currencies": { "coins": 100 },\n  "xp": 25\n}',
  );
  const [startTime, setStartTime] = useState(toDatetimeLocal(initial?.start_time_sec));
  const [endTime, setEndTime] = useState(toDatetimeLocal(initial?.end_time_sec));
  const [resetTimeSec, setResetTimeSec] = useState(initial?.reset_time_sec?.toString() ?? "");
  const [preconditions, setPreconditions] = useState(initial?.precondition_ids?.join(", ") ?? "");
  const [disabled, setDisabled] = useState(initial?.disabled ?? false);
  const [selectedAudiences, setSelectedAudiences] = useState<string[]>(initial?.audiences ?? []);
  const [sortOrder, setSortOrder] = useState(initial?.sort_order?.toString() ?? "0");
  const [showPreview, setShowPreview] = useState(false);
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

  const previewQuest = useMemo((): QuestDef | null => {
    const reward = parseSafe<QuestReward>(rewardJson, setRewardError);
    if (reward === null) return null;
    const mc = parseInt(maxCount, 10);
    if (isNaN(mc) || mc < 1) return null;

    const meta: Record<string, unknown> = { ...(initial?.metadata ?? {}) };
    if (objectiveType) meta.objective_type = objectiveType;
    if (linkedMode.trim()) meta.linked_mode = linkedMode.trim();

    const preconds = preconditions
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    return {
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      category: category || undefined,
      max_count: mc,
      reward: reward ?? undefined,
      start_time_sec: fromDatetimeLocal(startTime),
      end_time_sec: fromDatetimeLocal(endTime),
      reset_time_sec: resetTimeSec ? parseInt(resetTimeSec, 10) : undefined,
      precondition_ids: preconds.length > 0 ? preconds : undefined,
      disabled,
      audiences: selectedAudiences.length > 0 ? selectedAudiences : undefined,
      sort_order: sortOrder ? parseInt(sortOrder, 10) : undefined,
      metadata: Object.keys(meta).length > 0 ? meta : undefined,
    };
  }, [id, name, description, category, maxCount, objectiveType, linkedMode, rewardJson, startTime, endTime, resetTimeSec, preconditions, disabled, selectedAudiences, sortOrder, initial?.metadata]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim() || idConflict || !previewQuest) return;
    onSubmit(previewQuest);
  };

  const toggleAudience = (aid: string) => {
    setSelectedAudiences((prev) =>
      prev.includes(aid) ? prev.filter((a) => a !== aid) : [...prev, aid],
    );
  };

  const rewardParts = previewQuest ? formatReward(previewQuest.reward) : [];

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          {initial ? "Edit Quest" : "Create Quest"}
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

      {/* Quest card preview */}
      {showPreview && previewQuest && (
        <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4 space-y-2">
          <p className="text-xs font-medium text-primary">Quest Card Preview</p>
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Target className="h-6 w-6 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{previewQuest.name || "Untitled"}</p>
                {previewQuest.category && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground capitalize">
                    {previewQuest.category}
                  </span>
                )}
              </div>
              {previewQuest.description && (
                <p className="text-xs text-muted-foreground line-clamp-1">{previewQuest.description}</p>
              )}
              <div className="mt-1.5 flex items-center gap-3">
                <div className="flex-1">
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-primary/60" style={{ width: "0%" }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    0 / {previewQuest.max_count} {objectiveType.replace(/_/g, " ")}
                  </p>
                </div>
                {rewardParts.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {rewardParts.map((r, i) => (
                      <span key={i} className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                        {r}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Row 1: ID + Name */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Quest ID *</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!initial}
            placeholder="daily_win_3_matches"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
              idConflict ? "border-destructive" : "border-border",
            )}
          />
          {idConflict && <p className="text-xs text-destructive">A quest with this ID already exists.</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Display Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Win 3 Matches"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Win 3 matches in any game mode to claim your reward."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* Row 2: Category + Objective Type + Target Count */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Objective Type</label>
          <select
            value={objectiveType}
            onChange={(e) => setObjectiveType(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {OBJECTIVE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Target Count *</label>
          <input
            type="number"
            min="1"
            value={maxCount}
            onChange={(e) => setMaxCount(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Linked Mode */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Link2 className="h-3 w-3" />
          Linked Game Mode
        </label>
        <input
          value={linkedMode}
          onChange={(e) => setLinkedMode(e.target.value)}
          placeholder="ranked, quick_match, event_mode (optional)"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-[11px] text-muted-foreground">
          If set, only progress from this game mode counts. Leave empty for any mode.
        </p>
      </div>

      {/* Rewards JSON */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Gift className="h-3 w-3" />
          Reward (JSON)
        </label>
        <textarea
          value={rewardJson}
          onChange={(e) => setRewardJson(e.target.value)}
          rows={5}
          className={cn(
            "w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none",
            rewardError ? "border-destructive" : "border-border",
          )}
        />
        {rewardError && <p className="text-xs text-destructive">Invalid JSON: {rewardError}</p>}
      </div>

      {/* Time Windows */}
      <div className="grid gap-4 sm:grid-cols-3">
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
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Repeat className="h-3 w-3" />
            Reset Period (sec)
          </label>
          <input
            type="number"
            min="0"
            value={resetTimeSec}
            onChange={(e) => setResetTimeSec(e.target.value)}
            placeholder="86400 = daily, 604800 = weekly"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Preconditions + Sort + Status */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Precondition Quest IDs</label>
          <input
            value={preconditions}
            onChange={(e) => setPreconditions(e.target.value)}
            placeholder="quest_tutorial_1, quest_intro"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
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

      {/* Submit */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending || !id.trim() || !name.trim() || idConflict || !!rewardError}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? "Update Quest" : "Create Quest"}
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
/*  Quest Row                                                          */
/* ------------------------------------------------------------------ */

interface QuestRowProps {
  quest: QuestDef;
  onEdit: (q: QuestDef) => void;
  onDuplicate: (q: QuestDef) => void;
  onDelete: (q: QuestDef) => void;
  onToggle: (q: QuestDef) => void;
  isDeleting: boolean;
}

function QuestRow({ quest, onEdit, onDuplicate, onDelete, onToggle, isDeleting }: QuestRowProps) {
  const status = deriveStatus(quest);
  const rewards = formatReward(quest.reward);
  const [expanded, setExpanded] = useState(false);
  const objType = (quest.metadata?.objective_type as string) ?? "objective";
  const linkedMode = quest.metadata?.linked_mode as string | undefined;
  const resetLabel = quest.reset_time_sec
    ? quest.reset_time_sec === 86400
      ? "Resets daily"
      : quest.reset_time_sec === 604800
        ? "Resets weekly"
        : `Resets every ${Math.round(quest.reset_time_sec / 3600)}h`
    : null;

  return (
    <div className="group rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Header row */}
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
            {quest.category && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
                {quest.category}
              </span>
            )}
            <h4 className="text-sm font-semibold text-foreground truncate">{quest.name}</h4>
            <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {quest.id}
            </code>
          </div>

          {quest.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{quest.description}</p>
          )}

          {/* Objective + Meta */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Target className="h-3 w-3 text-primary" />
              <span className="font-medium text-foreground">{quest.max_count}</span>
              {" "}
              {objType.replace(/_/g, " ")}
            </span>
            {linkedMode && (
              <span className="inline-flex items-center gap-1 text-sky-400">
                <Link2 className="h-3 w-3" />
                {linkedMode.replace(/_/g, " ")}
              </span>
            )}
            {resetLabel && (
              <span className="inline-flex items-center gap-1 text-violet-400">
                <Repeat className="h-3 w-3" />
                {resetLabel}
              </span>
            )}
            {rewards.length > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Gift className="h-3 w-3" />
                {rewards.join(", ")}
              </span>
            )}
          </div>

          {/* Timing */}
          {(quest.start_time_sec || quest.end_time_sec) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>{formatTs(quest.start_time_sec)}</span>
              <span>→</span>
              <span>{formatTs(quest.end_time_sec)}</span>
            </div>
          )}

          {/* Audiences + Preconditions */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {quest.audiences && quest.audiences.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-400">
                <Users className="h-3 w-3" />
                {quest.audiences.join(", ")}
              </span>
            )}
            {quest.precondition_ids && quest.precondition_ids.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                <Timer className="h-3 w-3" />
                requires: {quest.precondition_ids.join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            title="Details"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            onClick={() => onToggle(quest)}
            title={quest.disabled ? "Enable" : "Disable"}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              !quest.disabled
                ? "text-emerald-400 hover:bg-emerald-500/10"
                : "text-zinc-500 hover:bg-zinc-500/10",
            )}
          >
            <Sparkles className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDuplicate(quest)}
            title="Duplicate"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => onEdit(quest)}
            title="Edit"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(quest)}
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
              <p className="text-xs font-medium text-muted-foreground mb-1">Reward</p>
              <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-32">
                {JSON.stringify(quest.reward ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Metadata</p>
              <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-32">
                {JSON.stringify(quest.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
          {quest.precondition_ids && quest.precondition_ids.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Preconditions</p>
              <div className="flex flex-wrap gap-1.5">
                {quest.precondition_ids.map((pid) => (
                  <code key={pid} className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono text-foreground">
                    {pid}
                  </code>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hiro Challenges panel (legacy challenges config)                   */
/* ------------------------------------------------------------------ */

function HiroChallengesPanel() {
  const gameScope = useScopedGameId() ?? GLOBAL_CONFIG_SCOPE;
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<QuestStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuestDef | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuestDef | null>(null);

  const { data: rawConfig, isLoading, isError, error, refetch } = useChallengesConfig(gameScope);
  const save = useSaveChallengesConfig(gameScope);
  const { data: audiences = [] } = useAudiences(gameScope);

  const challengesConfig = (rawConfig ?? {}) as ChallengesConfig;
  const quests = useMemo(() => flattenQuests(challengesConfig), [challengesConfig]);

  const filtered = useMemo(() => {
    let list = quests;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (quest) =>
          quest.name.toLowerCase().includes(q) ||
          quest.id.toLowerCase().includes(q) ||
          quest.description?.toLowerCase().includes(q) ||
          quest.category?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((q) => deriveStatus(q) === statusFilter);
    }
    if (categoryFilter) {
      list = list.filter((q) => q.category === categoryFilter);
    }
    return list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [quests, search, statusFilter, categoryFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, expired: 0, disabled: 0, all: quests.length };
    for (const q of quests) c[deriveStatus(q)]++;
    return c;
  }, [quests]);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const q of quests) if (q.category) set.add(q.category);
    return Array.from(set).sort();
  }, [quests]);

  const handleSubmit = useCallback(
    (quest: QuestDef) => {
      const updated = [...quests.filter((q) => q.id !== quest.id), quest];
      const newConfig = rebuildConfig(challengesConfig, updated);
      save.mutate(newConfig, {
        onSuccess: () => {
          setShowForm(false);
          setEditing(null);
        },
      });
    },
    [quests, challengesConfig, save],
  );

  const handleDelete = useCallback(
    (quest: QuestDef) => {
      setDeletingId(quest.id);
      const updated = quests.filter((q) => q.id !== quest.id);
      const newConfig = rebuildConfig(challengesConfig, updated);
      save.mutate(newConfig, {
        onSettled: () => {
          setDeletingId(null);
          setConfirmDelete(null);
        },
      });
    },
    [quests, challengesConfig, save],
  );

  const handleToggle = useCallback(
    (quest: QuestDef) => {
      const toggled = { ...quest, disabled: !quest.disabled };
      const updated = quests.map((q) => (q.id === quest.id ? toggled : q));
      const newConfig = rebuildConfig(challengesConfig, updated);
      save.mutate(newConfig);
    },
    [quests, challengesConfig, save],
  );

  const handleDuplicate = useCallback(
    (quest: QuestDef) => {
      const newId = `${quest.id}_copy_${Date.now().toString(36)}`;
      setEditing({
        ...quest,
        id: newId,
        name: `${quest.name} (Copy)`,
      });
      setShowForm(false);
    },
    [],
  );

  return (
    <div className="space-y-6">
      {/* Panel actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Legacy Hiro challenges config (<code className="rounded bg-muted px-1 py-0.5 text-xs">hiro_configs/challenges</code>).
          Not read by the in-game Quest Engine — use the Game Quests tab for quests that appear in apps.
        </p>
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
            Create Quest
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {(["all", "active", "upcoming", "expired", "disabled"] as QuestStatus[]).map((s) => (
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
            <p className="text-xs capitalize text-muted-foreground">{s} quests</p>
          </button>
        ))}
      </div>

      {/* Form */}
      {(showForm || editing) && (
        <QuestForm
          initial={editing && !showForm ? editing : undefined}
          audiences={audiences}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={save.isPending}
          existingIds={quests.map((q) => q.id)}
        />
      )}

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quests by name, ID, or description..."
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
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
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
              Delete quest "{confirmDelete.name}"?
            </p>
            <p className="text-xs text-muted-foreground">
              This will remove the quest from the challenges config. This action cannot be undone.
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
          Failed to load challenges config: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading quest configuration…
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Swords className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">
            {quests.length === 0
              ? "No quests configured yet"
              : "No quests match your search"}
          </p>
          <p className="mt-1 text-xs">
            {quests.length === 0
              ? 'Click "Create Quest" to add your first quest or mission.'
              : "Try adjusting your search or filter."}
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((quest) => (
            <QuestRow
              key={quest.id}
              quest={quest}
              onEdit={(q) => {
                setEditing(q);
                setShowForm(false);
              }}
              onDuplicate={handleDuplicate}
              onDelete={(q) => setConfirmDelete(q)}
              onToggle={handleToggle}
              isDeleting={deletingId === quest.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quest Engine panel (in-game quests: qv_quest_config)               */
/* ------------------------------------------------------------------ */

const ENGINE_CATEGORIES = [
  "daily",
  "weekly",
  "monthly",
  "friend",
  "onboarding",
  "social",
  "event",
  "achievement",
  "custom",
] as const;

function useQuestEngineConfig(engineGameId: string) {
  return useQuery({
    queryKey: ["questEngine", "config", engineGameId],
    queryFn: () => questEngine.getQuestEngineConfig(engineGameId, serverKeyAuth()),
    staleTime: 30_000,
  });
}

function useSaveQuestEngineConfig(engineGameId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: QuestEngineConfig) =>
      questEngine.saveQuestEngineConfig(engineGameId, config, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["questEngine", "config", engineGameId] }),
  });
}

function formatEngineReward(q: QuestEngineQuest): string[] {
  const parts: string[] = [];
  const g = q.reward?.guaranteed;
  if (g?.currencies) {
    for (const [k, v] of Object.entries(g.currencies)) parts.push(`${v} ${k}`);
  }
  if (g?.items) {
    for (const [k, v] of Object.entries(g.items)) parts.push(`${v}x ${k}`);
  }
  if (g?.energies) {
    for (const [k, v] of Object.entries(g.energies)) parts.push(`${v} ${k} energy`);
  }
  return parts;
}

function engineResetLabel(sec?: number): string | null {
  if (!sec) return null;
  if (sec === 86400) return "Resets daily";
  if (sec === 604800) return "Resets weekly";
  return `Resets every ${Math.round(sec / 3600)}h`;
}

interface EngineStepDraft {
  id: string;
  description: string;
  eventType: string;
  requiredCount: string;
}

interface EngineQuestFormProps {
  initial?: QuestEngineQuest;
  onSubmit: (quest: QuestEngineQuest) => void;
  onCancel: () => void;
  isPending: boolean;
  existingIds: string[];
  knownEventTypes: string[];
}

function EngineQuestForm({ initial, onSubmit, onCancel, isPending, existingIds, knownEventTypes }: EngineQuestFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "daily");
  const [repeatable, setRepeatable] = useState(initial?.repeatable ?? true);
  const [resetIntervalSec, setResetIntervalSec] = useState(
    initial?.resetIntervalSec != null ? String(initial.resetIntervalSec) : "",
  );
  const [expiresAt, setExpiresAt] = useState(toDatetimeLocal(initial?.expiresAt));
  const [prereqs, setPrereqs] = useState(initial?.prerequisiteIds?.join(", ") ?? "");
  const [steps, setSteps] = useState<EngineStepDraft[]>(
    initial?.steps?.length
      ? initial.steps.map((s) => ({
          id: s.id,
          description: s.description ?? "",
          eventType: s.eventType,
          requiredCount: String(s.requiredCount ?? 1),
        }))
      : [{ id: "s1", description: "", eventType: "", requiredCount: "1" }],
  );
  const [currenciesJson, setCurrenciesJson] = useState(
    initial?.reward?.guaranteed?.currencies
      ? JSON.stringify(initial.reward.guaranteed.currencies, null, 2)
      : '{\n  "coins": 50\n}',
  );
  const [currenciesError, setCurrenciesError] = useState("");

  const idConflict = !initial && existingIds.includes(id.trim());

  const updateStep = (idx: number, patch: Partial<EngineStepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };
  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { id: `s${prev.length + 1}`, description: "", eventType: "", requiredCount: "1" },
    ]);
  };
  const removeStep = (idx: number) => {
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  };

  const builtQuest = useMemo((): QuestEngineQuest | null => {
    let currencies: Record<string, number>;
    try {
      currencies = JSON.parse(currenciesJson) as Record<string, number>;
      setCurrenciesError("");
    } catch (e) {
      setCurrenciesError((e as Error).message);
      return null;
    }
    const builtSteps: QuestEngineStep[] = [];
    for (const s of steps) {
      const rc = parseInt(s.requiredCount, 10);
      if (!s.eventType.trim() || isNaN(rc) || rc < 1) return null;
      builtSteps.push({
        id: s.id.trim() || `s${builtSteps.length + 1}`,
        description: s.description.trim() || s.eventType.trim(),
        eventType: s.eventType.trim(),
        requiredCount: rc,
      });
    }
    if (builtSteps.length === 0) return null;
    const prereqList = prereqs.split(",").map((p) => p.trim()).filter(Boolean);
    return {
      ...(initial ?? {}),
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      category: category || undefined,
      steps: builtSteps,
      reward: { guaranteed: { currencies } },
      repeatable,
      resetIntervalSec: resetIntervalSec ? parseInt(resetIntervalSec, 10) : undefined,
      expiresAt: fromDatetimeLocal(expiresAt),
      prerequisiteIds: prereqList.length > 0 ? prereqList : undefined,
    };
  }, [initial, id, name, description, category, steps, currenciesJson, repeatable, resetIntervalSec, expiresAt, prereqs]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim() || idConflict || !builtQuest) return;
    onSubmit(builtQuest);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">
        {initial ? "Edit Game Quest" : "Create Game Quest"}
      </h3>

      {/* ID + Name */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Quest ID *</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!initial}
            placeholder="qv_daily_win2"
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50",
              idConflict ? "border-destructive" : "border-border",
            )}
          />
          {idConflict && <p className="text-xs text-destructive">A quest with this ID already exists.</p>}
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Display Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Win 2 Quizzes"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="Win 2 quiz rounds today."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      {/* Category + repeat + reset */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Category</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ENGINE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
          <p className="text-[11px] text-muted-foreground">
            daily / weekly / monthly reset on calendar boundaries automatically.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Repeatable</label>
          <div className="flex items-center gap-2 pt-1.5">
            <button
              type="button"
              onClick={() => setRepeatable(!repeatable)}
              className={cn(
                "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
                repeatable ? "bg-emerald-500" : "bg-zinc-600",
              )}
            >
              <span
                className={cn(
                  "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                  repeatable ? "translate-x-4" : "translate-x-0.5",
                )}
              />
            </button>
            <span className="text-sm text-muted-foreground">
              {repeatable ? "Repeats after reset" : "One-time"}
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
            <Repeat className="h-3 w-3" />
            Custom Reset (sec)
          </label>
          <input
            type="number"
            min="0"
            value={resetIntervalSec}
            onChange={(e) => setResetIntervalSec(e.target.value)}
            placeholder="604800 = weekly (optional)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Target className="h-3 w-3" />
          Steps — progressed by analytics events *
        </label>
        {steps.map((s, idx) => (
          <div key={idx} className="grid gap-2 sm:grid-cols-[1fr_5rem_1fr_2rem] items-start">
            <div>
              <input
                value={s.eventType}
                onChange={(e) => updateStep(idx, { eventType: e.target.value })}
                placeholder="event type e.g. quiz_win"
                list="qe-known-events"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
            </div>
            <input
              type="number"
              min="1"
              value={s.requiredCount}
              onChange={(e) => updateStep(idx, { requiredCount: e.target.value })}
              title="Required count"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              value={s.description}
              onChange={(e) => updateStep(idx, { description: e.target.value })}
              placeholder="Step description (optional)"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="button"
              onClick={() => removeStep(idx)}
              disabled={steps.length === 1}
              title="Remove step"
              className="mt-1.5 rounded-md p-1.5 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        <datalist id="qe-known-events">
          {knownEventTypes.map((ev) => (
            <option key={ev} value={ev} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={addStep}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add step
        </button>
      </div>

      {/* Reward currencies */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Gift className="h-3 w-3" />
          Reward Currencies (JSON) — granted automatically on completion
        </label>
        <textarea
          value={currenciesJson}
          onChange={(e) => setCurrenciesJson(e.target.value)}
          rows={4}
          className={cn(
            "w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none",
            currenciesError ? "border-destructive" : "border-border",
          )}
        />
        {currenciesError && <p className="text-xs text-destructive">Invalid JSON: {currenciesError}</p>}
      </div>

      {/* Expiry + prerequisites */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Expires At</label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Prerequisite Quest IDs</label>
          <input
            value={prereqs}
            onChange={(e) => setPrereqs(e.target.value)}
            placeholder="qv_onboarding_guild, qv_daily_play"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending || !id.trim() || !name.trim() || idConflict || !builtQuest}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? "Update Quest" : "Create Quest"}
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

interface EngineQuestRowProps {
  quest: QuestEngineQuest;
  onEdit: (q: QuestEngineQuest) => void;
  onDuplicate: (q: QuestEngineQuest) => void;
  onDelete: (q: QuestEngineQuest) => void;
  isDeleting: boolean;
}

function EngineQuestRow({ quest, onEdit, onDuplicate, onDelete, isDeleting }: EngineQuestRowProps) {
  const [expanded, setExpanded] = useState(false);
  const rewards = formatEngineReward(quest);
  const resetLabel = engineResetLabel(quest.resetIntervalSec);
  const expired = quest.expiresAt ? Math.floor(Date.now() / 1000) > quest.expiresAt : false;

  return (
    <div className="group rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                expired ? statusBg("expired") : statusBg("active"),
                expired ? statusColor("expired") : statusColor("active"),
              )}
            >
              <StatusIcon status={expired ? "expired" : "active"} />
              {expired ? "expired" : "active"}
            </span>
            {quest.category && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground capitalize">
                {quest.category}
              </span>
            )}
            {quest.repeatable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-400">
                <Repeat className="h-3 w-3" />
                repeatable
              </span>
            )}
            <h4 className="text-sm font-semibold text-foreground truncate">{quest.name}</h4>
            <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {quest.id}
            </code>
          </div>

          {quest.description && (
            <p className="text-xs text-muted-foreground line-clamp-1">{quest.description}</p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {quest.steps?.map((s) => (
              <span key={s.id} className="inline-flex items-center gap-1">
                <Zap className="h-3 w-3 text-sky-400" />
                <code className="font-mono text-sky-400">{s.eventType}</code>
                <span className="font-medium text-foreground">×{s.requiredCount}</span>
              </span>
            ))}
            {resetLabel && (
              <span className="inline-flex items-center gap-1 text-violet-400">
                <Repeat className="h-3 w-3" />
                {resetLabel}
              </span>
            )}
            {rewards.length > 0 && (
              <span className="inline-flex items-center gap-1 text-emerald-400">
                <Gift className="h-3 w-3" />
                {rewards.join(", ")}
              </span>
            )}
          </div>

          {quest.prerequisiteIds && quest.prerequisiteIds.length > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
              <Timer className="h-3 w-3" />
              requires: {quest.prerequisiteIds.join(", ")}
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
            onClick={() => onDuplicate(quest)}
            title="Duplicate"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            onClick={() => onEdit(quest)}
            title="Edit"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(quest)}
            disabled={isDeleting}
            title="Delete"
            className="rounded-md p-1.5 text-destructive/70 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-muted-foreground mb-1">Full Definition</p>
          <pre className="rounded bg-muted p-2 text-xs font-mono text-foreground overflow-auto max-h-48">
            {JSON.stringify(quest, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function QuestEnginePanel() {
  const gameScope = useScopedGameId() ?? GLOBAL_CONFIG_SCOPE;
  const engineGameId = rpcGameId(gameScope) ?? QUEST_ENGINE_DEFAULT_GAME;
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<QuestEngineQuest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<QuestEngineQuest | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkJson, setBulkJson] = useState("");
  const [bulkError, setBulkError] = useState("");

  const { data: config, isLoading, isError, error, refetch } = useQuestEngineConfig(engineGameId);
  const save = useSaveQuestEngineConfig(engineGameId);

  const quests = useMemo(() => {
    if (!config?.quests) return [];
    return Object.entries(config.quests).map(([key, val]) => ({ ...val, id: val.id || key }));
  }, [config]);

  const knownEventTypes = useMemo(() => {
    const set = new Set<string>();
    for (const q of quests) for (const s of q.steps ?? []) if (s.eventType) set.add(s.eventType);
    return Array.from(set).sort();
  }, [quests]);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const q of quests) if (q.category) set.add(q.category);
    return Array.from(set).sort();
  }, [quests]);

  const filtered = useMemo(() => {
    let list = quests;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (quest) =>
          quest.name.toLowerCase().includes(q) ||
          quest.id.toLowerCase().includes(q) ||
          quest.description?.toLowerCase().includes(q) ||
          quest.steps?.some((s) => s.eventType.toLowerCase().includes(q)),
      );
    }
    if (categoryFilter) list = list.filter((q) => q.category === categoryFilter);
    return list;
  }, [quests, search, categoryFilter]);

  const persist = useCallback(
    (updated: QuestEngineQuest[], onDone?: () => void) => {
      const map: Record<string, QuestEngineQuest> = {};
      for (const q of updated) map[q.id] = q;
      save.mutate({ quests: map }, { onSettled: onDone });
    },
    [save],
  );

  const handleSubmit = useCallback(
    (quest: QuestEngineQuest) => {
      persist([...quests.filter((q) => q.id !== quest.id), quest], () => {
        setShowForm(false);
        setEditing(null);
      });
    },
    [quests, persist],
  );

  const handleDelete = useCallback(
    (quest: QuestEngineQuest) => {
      setDeletingId(quest.id);
      persist(quests.filter((q) => q.id !== quest.id), () => {
        setDeletingId(null);
        setConfirmDelete(null);
      });
    },
    [quests, persist],
  );

  const handleDuplicate = useCallback((quest: QuestEngineQuest) => {
    setEditing({
      ...quest,
      id: `${quest.id}_copy_${Date.now().toString(36)}`,
      name: `${quest.name} (Copy)`,
    });
    setShowForm(false);
  }, []);

  const openBulkEditor = useCallback(() => {
    const map: Record<string, QuestEngineQuest> = {};
    for (const q of quests) map[q.id] = q;
    setBulkJson(JSON.stringify(map, null, 2));
    setBulkError("");
    setShowBulk(true);
    setShowForm(false);
    setEditing(null);
  }, [quests]);

  const handleBulkSave = useCallback(() => {
    let parsed: Record<string, QuestEngineQuest>;
    try {
      parsed = JSON.parse(bulkJson) as Record<string, QuestEngineQuest>;
    } catch (e) {
      setBulkError(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setBulkError("Top level must be an object keyed by quest id: { \"quest_id\": { ... } }");
      return;
    }
    for (const [key, q] of Object.entries(parsed)) {
      if (!q || typeof q !== "object") { setBulkError(`"${key}" must be a quest object.`); return; }
      q.id = q.id || key;
      if (!q.name) { setBulkError(`"${key}" is missing a name.`); return; }
      if (!Array.isArray(q.steps) || q.steps.length === 0) { setBulkError(`"${key}" needs at least one step.`); return; }
      for (const s of q.steps) {
        if (!s.eventType) { setBulkError(`"${key}" has a step without an eventType.`); return; }
        if (!s.requiredCount || s.requiredCount < 1) { setBulkError(`"${key}" has a step without a valid requiredCount.`); return; }
        s.id = s.id || "s1";
        s.description = s.description || s.eventType;
      }
    }
    setBulkError("");
    save.mutate({ quests: parsed }, {
      onSuccess: () => setShowBulk(false),
      onError: (e) => setBulkError((e as Error).message),
    });
  }, [bulkJson, save]);

  return (
    <div className="space-y-6">
      {/* Panel header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Served to games via <code className="rounded bg-muted px-1 py-0.5 text-xs">quest_engine_get</code>.
          Steps progress automatically from analytics events; rewards auto-grant on completion.
          {" "}Scope: <code className="rounded bg-muted px-1 py-0.5 text-xs">{engineGameId}</code>
        </p>
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
            onClick={openBulkEditor}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            <Copy className="h-3.5 w-3.5" />
            Bulk JSON
          </button>
          <button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
              setShowBulk(false);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Quest
          </button>
        </div>
      </div>

      {/* Bulk JSON editor */}
      {showBulk && (
        <div className="space-y-3 rounded-lg border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Bulk Edit — Full Quest Config (JSON)</h3>
            <p className="text-xs text-muted-foreground">
              Saving replaces the <em>entire</em> config for scope{" "}
              <code className="rounded bg-muted px-1 py-0.5">{engineGameId}</code>. Apps see changes on their next fetch.
            </p>
          </div>
          <textarea
            value={bulkJson}
            onChange={(e) => setBulkJson(e.target.value)}
            rows={22}
            spellCheck={false}
            className={cn(
              "w-full rounded-md border bg-background px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y",
              bulkError ? "border-destructive" : "border-border",
            )}
          />
          {bulkError && <p className="text-xs text-destructive">{bulkError}</p>}
          <div className="flex items-center gap-2">
            <button
              onClick={handleBulkSave}
              disabled={save.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {save.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Save All Quests
            </button>
            <button
              onClick={() => setShowBulk(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Form */}
      {(showForm || editing) && (
        <EngineQuestForm
          initial={editing && !showForm ? editing : undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={save.isPending}
          existingIds={quests.map((q) => q.id)}
          knownEventTypes={knownEventTypes}
        />
      )}

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quests by name, ID, or event type..."
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
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
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
              Delete quest "{confirmDelete.name}"?
            </p>
            <p className="text-xs text-muted-foreground">
              Players will no longer see this quest. Existing progress state is kept but orphaned.
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
          Failed to load quest engine config: {(error as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading quest engine configuration…
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Swords className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">
            {quests.length === 0 ? "No game quests configured yet" : "No quests match your search"}
          </p>
          <p className="mt-1 text-xs">
            {quests.length === 0
              ? 'Click "Create Quest" to add the first quest players will see in-game.'
              : "Try adjusting your search or filter."}
          </p>
        </div>
      )}

      {/* List */}
      {!isLoading && filtered.length > 0 && (
        <div className="space-y-3">
          {filtered.map((quest) => (
            <EngineQuestRow
              key={quest.id}
              quest={quest}
              onEdit={(q) => {
                setEditing(q);
                setShowForm(false);
              }}
              onDuplicate={handleDuplicate}
              onDelete={(q) => setConfirmDelete(q)}
              isDeleting={deletingId === quest.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function QuestsConfigPage() {
  const [engine, setEngine] = useState<"quest-engine" | "hiro">("quest-engine");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Swords className="h-6 w-6 text-primary" />
          Quest Configuration
        </h2>
        <p className="text-sm text-muted-foreground">
          Design and manage quests with event-driven steps, rewards, and automatic grants.
        </p>
      </div>

      {/* Engine tabs */}
      <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        <button
          onClick={() => setEngine("quest-engine")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            engine === "quest-engine"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Game Quests (Quest Engine)
        </button>
        <button
          onClick={() => setEngine("hiro")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            engine === "hiro"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Hiro Challenges (legacy)
        </button>
      </div>

      {engine === "quest-engine" ? <QuestEnginePanel /> : <HiroChallengesPanel />}
    </div>
  );
}


export default QuestsConfigPage;
