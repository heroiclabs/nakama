import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  Pencil,
  X,
  Check,
  Clock,
  AlertTriangle,
  Filter,
  Play,
  Pause,
  Trophy,
  Users,
  Zap,
  CalendarClock,
  Timer,
  CheckCircle2,
  Ban,
  Gamepad2,
  Eye,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Gift,
  DollarSign,
  Globe2,
  Brain,
  Target,
  Award,
  ExternalLink,
  XCircle,
  Sparkles,
} from "lucide-react";
import { serverKeyAuth, satori, quizverse, type LiveEvent, type CreatorEvent, type CreatorEventStats as CEvtStats, type LeaderboardEntry } from "@nakama/shared";
import { cn } from "@/lib/utils";

type EventStatus = "active" | "upcoming" | "ended" | "all";
type TabId = "satori" | "creator";
const GLOBAL_CONFIG_SCOPE = "global";

// Game IDs configuration
const GAMES = [
  { id: "global", name: "Global", icon: "🌐" },
  { id: "126bf539-dae2-4bcf-964d-316c0fa1f92b", name: "QuizVerse", icon: "🧠" },
  { id: "f6f7fe36-03de-43b8-8b5d-1a1892da4eed", name: "Last To Live", icon: "🎮" },
  { id: "cricketvr", name: "Cricket VR", icon: "🏏" },
] as const;

// Tab configuration
const TABS: { id: TabId; label: string; icon: typeof CalendarDays }[] = [
  { id: "satori", label: "Platform Events", icon: CalendarDays },
  { id: "creator", label: "Creator Events", icon: Sparkles },
];

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

function deriveStatus(ev: LiveEvent): Exclude<EventStatus, "all"> {
  const now = Math.floor(Date.now() / 1000);
  const start = ev.start_time_sec ?? 0;
  const end = ev.end_time_sec ?? 0;
  if (end > 0 && now > end) return "ended";
  if (start > 0 && now < start) return "upcoming";
  return "active";
}

function statusColor(s: Exclude<EventStatus, "all">) {
  switch (s) {
    case "active":
      return "text-emerald-400";
    case "upcoming":
      return "text-sky-400";
    case "ended":
      return "text-zinc-500";
  }
}

function statusBg(s: Exclude<EventStatus, "all">) {
  switch (s) {
    case "active":
      return "bg-emerald-500/10 border-emerald-500/20";
    case "upcoming":
      return "bg-sky-500/10 border-sky-500/20";
    case "ended":
      return "bg-zinc-500/10 border-zinc-500/20";
  }
}

function StatusIcon({ status }: { status: Exclude<EventStatus, "all"> }) {
  switch (status) {
    case "active":
      return <Zap className="h-3.5 w-3.5 text-emerald-400" />;
    case "upcoming":
      return <CalendarClock className="h-3.5 w-3.5 text-sky-400" />;
    case "ended":
      return <CheckCircle2 className="h-3.5 w-3.5 text-zinc-500" />;
  }
}

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

function relativeTime(sec: number) {
  const diff = sec - Math.floor(Date.now() / 1000);
  if (diff <= 0) return "now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

function parseRewards(json?: string): { type: string; amount: number }[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Hooks                                                              */
/* ------------------------------------------------------------------ */

function useEvents(gameScope: string) {
  return useQuery({
    queryKey: ["satori", "live_events", gameScope],
    queryFn: () => satori.listLiveEvents(serverKeyAuth(), rpcGameId(gameScope)),
    select: (data) => data?.events ?? [],
    staleTime: 30_000,
  });
}

function useScheduleEvent(gameScope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (
      ev: Parameters<typeof satori.scheduleLiveEvent>[0],
    ) => satori.scheduleLiveEvent({ ...ev, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["satori", "live_events", gameScope] }),
  });
}

/* ------------------------------------------------------------------ */
/*  Creator Event Hooks                                                */
/* ------------------------------------------------------------------ */

function useCreatorEvents(gameScope: string) {
  return useQuery({
    queryKey: ["quizverse", "creator_events", gameScope],
    queryFn: () => quizverse.listCreatorEvents(serverKeyAuth(), rpcGameId(gameScope)),
    select: (data) => {
      const all = data?.events ?? [];
      return all.filter((ev: CreatorEvent) => ev.source === "quizverse_creator");
    },
    staleTime: 30_000,
  });
}

function useCreatorEventStats(eventId: string | null) {
  return useQuery({
    queryKey: ["quizverse", "creator_event_stats", eventId],
    queryFn: () => quizverse.getCreatorEventStats(eventId!, serverKeyAuth()),
    enabled: !!eventId,
    staleTime: 30_000,
  });
}

function useEndCreatorEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId }: { eventId: string }) =>
      quizverse.endCreatorEvent(eventId, serverKeyAuth()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["quizverse", "creator_events"] }),
  });
}

function deriveCreatorStatus(ev: CreatorEvent): Exclude<EventStatus, "all"> {
  const status = ev.status?.toLowerCase();
  if (status === "live" || status === "active") return "active";
  if (status === "published" || status === "upcoming") return "upcoming";
  if (status === "ended" || status === "cancelled" || status === "distributed") return "ended";
  const now = Math.floor(Date.now() / 1000);
  const start = ev.start_time_sec ?? 0;
  const end = ev.end_time_sec ?? 0;
  if (end > 0 && now > end) return "ended";
  if (start > 0 && now < start) return "upcoming";
  return "active";
}

/* ------------------------------------------------------------------ */
/*  Event Form                                                         */
/* ------------------------------------------------------------------ */

interface EventFormProps {
  initial?: LiveEvent;
  onSubmit: (ev: Parameters<typeof satori.scheduleLiveEvent>[0]) => void;
  onCancel: () => void;
  isPending: boolean;
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

function EventForm({ initial, onSubmit, onCancel, isPending }: EventFormProps) {
  const [id, setId] = useState(initial?.id ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [startTime, setStartTime] = useState(toDatetimeLocal(initial?.start_time_sec));
  const [endTime, setEndTime] = useState(toDatetimeLocal(initial?.end_time_sec));
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [rewardsJson, setRewardsJson] = useState(initial?.rewards_json ?? "");
  const [audiences, setAudiences] = useState(
    initial?.audiences?.join(", ") ?? "",
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!id.trim() || !name.trim()) return;
    onSubmit({
      id: id.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      start_time_sec: fromDatetimeLocal(startTime),
      end_time_sec: fromDatetimeLocal(endTime),
      enabled,
      rewards_json: rewardsJson.trim() || undefined,
      audiences_json: JSON.stringify(
        audiences
          .split(",")
          .map((a: string) => a.trim())
          .filter(Boolean),
      ),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-lg border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">
        {initial ? "Edit Event" : "Schedule Event"}
      </h3>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Event ID *</label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!initial}
            placeholder="summer_2026_event"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Display Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Summer Championship 2026"
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
          placeholder="Optional event description..."
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
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

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Rewards JSON</label>
        <textarea
          value={rewardsJson}
          onChange={(e) => setRewardsJson(e.target.value)}
          rows={3}
          placeholder='[{"type":"coins","amount":500},{"type":"gems","amount":10}]'
          className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Audience IDs (comma-separated)</label>
        <input
          value={audiences}
          onChange={(e) => setAudiences(e.target.value)}
          placeholder="whales, new_users, competitive"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setEnabled(!enabled)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
            enabled ? "bg-emerald-500" : "bg-zinc-600",
          )}
        >
          <span
            className={cn(
              "pointer-events-none block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
              enabled ? "translate-x-4" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="text-sm text-muted-foreground">
          {enabled ? "Enabled" : "Disabled"}
        </span>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          type="submit"
          disabled={isPending || !id.trim() || !name.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          {initial ? "Update" : "Schedule"}
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
/*  Event Row                                                          */
/* ------------------------------------------------------------------ */

interface EventRowProps {
  event: LiveEvent;
  onEdit: (ev: LiveEvent) => void;
  onToggle: (ev: LiveEvent) => void;
  isToggling: boolean;
}

function EventRow({ event, onEdit, onToggle, isToggling }: EventRowProps) {
  const status = deriveStatus(event);
  const rewards = parseRewards(event.rewards_json);

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                statusBg(status),
                statusColor(status),
              )}
            >
              <StatusIcon status={status} />
              {status}
            </span>
            {!event.enabled && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
                <Ban className="h-3 w-3" />
                Disabled
              </span>
            )}
            <h4 className="text-sm font-semibold text-foreground truncate">
              {event.name}
            </h4>
            <code className="text-xs text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              {event.id}
            </code>
          </div>

          {/* Description */}
          {event.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {event.description}
            </p>
          )}

          {/* Timing */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTs(event.start_time_sec)}
            </span>
            <span>→</span>
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatTs(event.end_time_sec)}
            </span>
            {status === "upcoming" && event.start_time_sec && (
              <span className="text-sky-400">
                starts in {relativeTime(event.start_time_sec)}
              </span>
            )}
            {status === "active" && event.end_time_sec && (
              <span className="text-emerald-400">
                ends in {relativeTime(event.end_time_sec)}
              </span>
            )}
          </div>

          {/* Rewards & Audiences */}
          <div className="flex flex-wrap items-center gap-2">
            {rewards.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-400">
                <Trophy className="h-3 w-3" />
                {rewards.length} reward{rewards.length !== 1 ? "s" : ""}
              </span>
            )}
            {event.audiences && event.audiences.length > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-400">
                <Users className="h-3 w-3" />
                {event.audiences.join(", ")}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onToggle(event)}
            disabled={isToggling}
            title={event.enabled ? "Disable event" : "Enable event"}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              event.enabled
                ? "text-emerald-400 hover:bg-emerald-500/10"
                : "text-zinc-500 hover:bg-zinc-500/10",
            )}
          >
            {isToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : event.enabled ? (
              <Play className="h-4 w-4" />
            ) : (
              <Pause className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={() => onEdit(event)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Creator Event Row                                                  */
/* ------------------------------------------------------------------ */

interface CreatorEventRowProps {
  event: CreatorEvent;
  onViewStats: (ev: CreatorEvent) => void;
  onEnd: (ev: CreatorEvent) => void;
  isEnding: boolean;
}

function formatPrizes(prizes?: CreatorEvent["gift_card_prizes"], prizePool?: number): string {
  if (prizePool) return `$${prizePool.toLocaleString()} prize pool`;
  if (!prizes || !prizes.tiers?.length) return "No prizes";
  if (prizes.totalValue) return `$${prizes.totalValue.toLocaleString()} in gift cards`;
  const total = prizes.tiers.reduce(
    (sum: number, t: { value?: number }) => sum + (t.value ?? 0),
    0,
  );
  return `$${total.toLocaleString()} in gift cards`;
}

function gameModeLabel(mode?: string): string {
  switch (mode?.toLowerCase()) {
    case "classic":
      return "Classic";
    case "survival":
      return "Survival";
    case "time_attack":
      return "Time Attack";
    case "tournament":
      return "Tournament";
    default:
      return mode ?? "Unknown";
  }
}

function difficultyColor(difficulty?: string): string {
  switch (difficulty?.toLowerCase()) {
    case "easy":
      return "text-green-400 bg-green-500/10 border-green-500/20";
    case "medium":
      return "text-amber-400 bg-amber-500/10 border-amber-500/20";
    case "hard":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    case "mixed":
      return "text-purple-400 bg-purple-500/10 border-purple-500/20";
    default:
      return "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
  }
}

function CreatorEventRow({ event, onViewStats, onEnd, isEnding }: CreatorEventRowProps) {
  const status = deriveCreatorStatus(event);
  const prizeInfo = formatPrizes(event.gift_card_prizes, event.prize_pool);
  const isLive = status === "active";

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          {/* Header row */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                statusBg(status),
                statusColor(status),
              )}
            >
              <StatusIcon status={status} />
              {status}
            </span>
            {event.game_mode && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                <Gamepad2 className="h-3 w-3" />
                {gameModeLabel(event.game_mode)}
              </span>
            )}
            {event.difficulty && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium capitalize",
                difficultyColor(event.difficulty),
              )}>
                <Target className="h-3 w-3" />
                {event.difficulty}
              </span>
            )}
            <h4 className="text-sm font-semibold text-foreground truncate">
              {event.name}
            </h4>
          </div>

          {/* Creator info */}
          {event.creator_id && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              <span>
                Created by <code className="font-mono bg-muted px-1.5 py-0.5 rounded text-foreground">{event.creator_id}</code>
              </span>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">
              {event.description}
            </p>
          )}

          {/* Timing */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatTs(event.start_time_sec)}
            </span>
            <span>→</span>
            <span className="inline-flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatTs(event.end_time_sec)}
            </span>
            {status === "upcoming" && event.start_time_sec && (
              <span className="text-sky-400">
                starts in {relativeTime(event.start_time_sec)}
              </span>
            )}
            {status === "active" && event.end_time_sec && (
              <span className="text-emerald-400">
                ends in {relativeTime(event.end_time_sec)}
              </span>
            )}
          </div>

          {/* Prizes, Stats & Regions */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1 text-xs text-amber-400">
              <Gift className="h-3 w-3" />
              {prizeInfo}
            </span>
            {event.participant_count !== undefined && (
              <span className="inline-flex items-center gap-1 text-xs text-blue-400">
                <Users className="h-3 w-3" />
                {event.participant_count.toLocaleString()} players
              </span>
            )}
            {event.region && (
              <span className="inline-flex items-center gap-1 text-xs text-violet-400">
                <Globe2 className="h-3 w-3" />
                {event.region}
              </span>
            )}
            {event.question_count !== undefined && (
              <span className="inline-flex items-center gap-1 text-xs text-cyan-400">
                <Brain className="h-3 w-3" />
                {event.question_count} questions
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => onViewStats(event)}
            title="View stats"
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
          {isLive && (
            <button
              onClick={() => onEnd(event)}
              disabled={isEnding}
              title="End event"
              className="rounded-md p-1.5 text-red-400 transition-colors hover:bg-red-500/10"
            >
              {isEnding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Creator Event Stats Panel                                          */
/* ------------------------------------------------------------------ */

interface CreatorEventStatsPanelProps {
  event: CreatorEvent;
  stats: CEvtStats | undefined;
  isLoading: boolean;
  onClose: () => void;
}

function CreatorEventStatsPanel({ event, stats, isLoading, onClose }: CreatorEventStatsPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Event Statistics: {event.name}
        </h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">Participants</div>
            <div className="text-xl font-bold text-foreground">
              {stats.total_participants?.toLocaleString() ?? 0}
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">Accuracy Rate</div>
            <div className="text-xl font-bold text-foreground">
              {stats.accuracy_rate ?? "N/A"}
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">Completion Rate</div>
            <div className="text-xl font-bold text-foreground">
              {stats.completion_rate ?? "N/A"}
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="text-xs text-muted-foreground">Prize Pool</div>
            <div className="text-xl font-bold text-amber-400">
              ${stats.prize_pool?.toLocaleString() ?? 0}
            </div>
          </div>
        </div>
      )}

      {!isLoading && stats?.leaderboard && stats.leaderboard.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">Top Players</h4>
          <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
            {stats.leaderboard.slice(0, 5).map((entry: LeaderboardEntry, idx: number) => (
              <div key={entry.user_id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold",
                    idx === 0 && "bg-amber-500/20 text-amber-400",
                    idx === 1 && "bg-zinc-400/20 text-zinc-300",
                    idx === 2 && "bg-orange-700/20 text-orange-400",
                    idx > 2 && "bg-muted text-muted-foreground",
                  )}>
                    {idx + 1}
                  </span>
                  <span className="text-foreground">{entry.username}</span>
                </div>
                <div className="text-muted-foreground">{entry.score?.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function EventsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("satori");
  const [gameScope, setGameScope] = useState(GLOBAL_CONFIG_SCOPE);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EventStatus>("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LiveEvent | null>(null);

  // Satori events state
  const { data: events = [], isLoading, isError, error, refetch } = useEvents(gameScope);
  const schedule = useScheduleEvent(gameScope);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Creator events state
  const { 
    data: creatorEvents = [], 
    isLoading: creatorLoading, 
    isError: creatorError, 
    error: creatorErrorMsg, 
    refetch: refetchCreator 
  } = useCreatorEvents(gameScope);
  const [viewingStatsEvent, setViewingStatsEvent] = useState<CreatorEvent | null>(null);
  const { data: eventStats, isLoading: statsLoading } = useCreatorEventStats(viewingStatsEvent?.id ?? null);
  const endEvent = useEndCreatorEvent();
  const [endingId, setEndingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = events;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (ev) =>
          ev.name.toLowerCase().includes(q) ||
          ev.id.toLowerCase().includes(q) ||
          ev.description?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((ev) => deriveStatus(ev) === statusFilter);
    }
    return list.sort((a, b) => (b.start_time_sec ?? 0) - (a.start_time_sec ?? 0));
  }, [events, search, statusFilter]);

  const filteredCreator = useMemo(() => {
    let list = creatorEvents;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (ev: CreatorEvent) =>
          ev.name?.toLowerCase().includes(q) ||
          ev.id?.toLowerCase().includes(q) ||
          ev.description?.toLowerCase().includes(q) ||
          ev.creator_id?.toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") {
      list = list.filter((ev: CreatorEvent) => deriveCreatorStatus(ev) === statusFilter);
    }
    return list.sort((a: CreatorEvent, b: CreatorEvent) => (b.start_time_sec ?? 0) - (a.start_time_sec ?? 0));
  }, [creatorEvents, search, statusFilter]);

  const counts = useMemo(() => {
    const c = { active: 0, upcoming: 0, ended: 0, all: events.length };
    for (const ev of events) c[deriveStatus(ev)]++;
    return c;
  }, [events]);

  const creatorCounts = useMemo(() => {
    const c = { active: 0, upcoming: 0, ended: 0, all: creatorEvents.length };
    for (const ev of creatorEvents) c[deriveCreatorStatus(ev)]++;
    return c;
  }, [creatorEvents]);

  const handleSubmit = useCallback(
    (ev: Parameters<typeof satori.scheduleLiveEvent>[0]) => {
      if (!window.confirm(`Schedule or update live event "${ev.id}" in production?`)) {
        return;
      }
      schedule.mutate(ev, {
        onSuccess: () => {
          setShowForm(false);
          setEditing(null);
        },
      });
    },
    [schedule],
  );

  const handleToggle = useCallback(
    (ev: LiveEvent) => {
      if (!window.confirm(`${ev.enabled ? "Disable" : "Enable"} live event "${ev.id}" in production?`)) {
        return;
      }
      setTogglingId(ev.id);
      schedule.mutate(
        { id: ev.id, name: ev.name, enabled: !ev.enabled },
        { onSettled: () => setTogglingId(null) },
      );
    },
    [schedule],
  );

  const handleEndCreatorEvent = useCallback(
    (ev: CreatorEvent) => {
      const reason = window.prompt(`Enter reason for ending "${ev.name}":`, "Admin ended event");
      if (reason === null) return;
      setEndingId(ev.id);
      endEvent.mutate(
        { eventId: ev.id },
        { onSettled: () => setEndingId(null) },
      );
    },
    [endEvent],
  );

  const currentCounts = activeTab === "satori" ? counts : creatorCounts;
  const currentLoading = activeTab === "satori" ? isLoading : creatorLoading;
  const currentError = activeTab === "satori" ? isError : creatorError;
  const currentErrorMsg = activeTab === "satori" ? error : creatorErrorMsg;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <CalendarDays className="h-6 w-6 text-primary" />
            Live Events
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage both platform-scheduled and creator-scheduled events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Game
            <select
              value={gameScope}
              onChange={(e) => setGameScope(e.target.value || GLOBAL_CONFIG_SCOPE)}
              className="w-52 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            >
              {GAMES.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.icon} {game.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => activeTab === "satori" ? refetch() : refetchCreator()}
            disabled={currentLoading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", currentLoading && "animate-spin")} />
            Refresh
          </button>
          {activeTab === "satori" && (
            <button
              onClick={() => {
                setEditing(null);
                setShowForm(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Schedule Event
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
            <span
              className={cn(
                "ml-1 rounded-full px-1.5 py-0.5 text-xs",
                activeTab === tab.id
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {tab.id === "satori" ? events.length : creatorEvents.length}
            </span>
            {activeTab === tab.id && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>

      {/* Form (only for Satori tab) */}
      {activeTab === "satori" && (showForm || editing) && (
        <EventForm
          initial={editing ?? undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setShowForm(false);
            setEditing(null);
          }}
          isPending={schedule.isPending}
        />
      )}

      {/* Search + Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={activeTab === "satori" ? "Search events by name or ID..." : "Search by event name, creator..."}
            className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="h-4 w-4 text-muted-foreground" />
          {(["all", "active", "upcoming", "ended"] as EventStatus[]).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                statusFilter === s
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              {s}{" "}
              <span className="ml-0.5 opacity-60">
                {currentCounts[s]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {currentError && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Failed to load events: {(currentErrorMsg as Error)?.message ?? "Unknown error"}
        </div>
      )}

      {/* Loading */}
      {currentLoading && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading events…
        </div>
      )}

      {/* Creator Events Stats Panel */}
      {activeTab === "creator" && viewingStatsEvent && (
        <CreatorEventStatsPanel
          event={viewingStatsEvent}
          stats={eventStats}
          isLoading={statsLoading}
          onClose={() => setViewingStatsEvent(null)}
        />
      )}

      {/* ====== SATORI TAB CONTENT ====== */}
      {activeTab === "satori" && (
        <>
          {/* Empty */}
          {!isLoading && !isError && filtered.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              <CalendarDays className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">
                {events.length === 0
                  ? "No live events scheduled yet"
                  : "No events match your search"}
              </p>
              <p className="mt-1 text-xs">
                {events.length === 0
                  ? 'Click "Schedule Event" to create your first live event.'
                  : "Try adjusting your search or filter."}
              </p>
            </div>
          )}

          {/* List */}
          {!isLoading && filtered.length > 0 && (
            <div className="space-y-3">
              {filtered.map((ev) => (
                <EventRow
                  key={ev.id}
                  event={ev}
                  onEdit={(e) => {
                    setEditing(e);
                    setShowForm(false);
                  }}
                  onToggle={handleToggle}
                  isToggling={togglingId === ev.id}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ====== CREATOR TAB CONTENT ====== */}
      {activeTab === "creator" && (
        <>
          {/* Empty */}
          {!creatorLoading && !creatorError && filteredCreator.length === 0 && (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              <Sparkles className="mx-auto mb-3 h-10 w-10 opacity-30" />
              <p className="text-sm font-medium">
                {creatorEvents.length === 0
                  ? "No creator events found"
                  : "No events match your search"}
              </p>
              <p className="mt-1 text-xs">
                Creator events are created by users with Creator accounts from the game client.
              </p>
            </div>
          )}

          {/* List */}
          {!creatorLoading && filteredCreator.length > 0 && (
            <div className="space-y-3">
              {filteredCreator.map((ev: CreatorEvent) => (
                <CreatorEventRow
                  key={ev.id}
                  event={ev}
                  onViewStats={setViewingStatsEvent}
                  onEnd={handleEndCreatorEvent}
                  isEnding={endingId === ev.id}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}


export default EventsPage;
