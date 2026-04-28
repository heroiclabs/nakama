import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare,
  Search,
  Plus,
  RefreshCw,
  Loader2,
  X,
  Copy,
  CheckCircle2,
  Users,
  Clock,
  AlertTriangle,
  Filter,
  Send,
  Calendar,
  Gift,
  FileJson,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { serverKeyAuth, satori, type SatoriMessage, type Audience } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Queries / Mutations ──────────────────────────────────────────── */

function useMessages(gameScope: string) {
  return useQuery({
    queryKey: ["satori", "messages", gameScope],
    queryFn: () => satori.listMessages(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d: { messages?: SatoriMessage[] }) => d.messages ?? [],
    staleTime: 30_000,
  });
}

function useAudiences(gameScope: string) {
  return useQuery({
    queryKey: ["satori", "audiences", gameScope],
    queryFn: () => satori.listAudiences(serverKeyAuth(), rpcGameId(gameScope)),
    select: (d: { audiences?: Audience[] }) => d.audiences ?? [],
    staleTime: 60_000,
  });
}

function useBroadcast(gameScope: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (params: Parameters<typeof satori.broadcastMessage>[0]) =>
      satori.broadcastMessage({ ...params, game_id: rpcGameId(gameScope) }, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["satori", "messages", gameScope] }),
  });
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function formatDate(iso?: string) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatTimestamp(ts?: number) {
  if (!ts) return null;
  try {
    const d = new Date(ts * 1000);
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return String(ts);
  }
}

function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  scheduled: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400",
  sent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
};

type FilterMode = "all" | "draft" | "scheduled" | "sent" | "failed";
const GLOBAL_CONFIG_SCOPE = "global";

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

/* ── Message Card ─────────────────────────────────────────────────── */

function MessageCard({ msg }: { msg: SatoriMessage }) {
  const { copied, copy } = useCopyToClipboard();
  const [showRewards, setShowRewards] = useState(false);

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="space-y-2.5">
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquare className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{msg.title}</span>
          {msg.status && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                statusColors[msg.status] ?? statusColors.draft,
              )}
            >
              {msg.status}
            </span>
          )}
          <div className="flex items-center gap-1">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {msg.id}
            </code>
            <button
              onClick={() => copy(msg.id, msg.id)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Copy ID"
            >
              {copied === msg.id ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              )}
            </button>
          </div>
        </div>

        {/* Body */}
        {msg.body && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {msg.body}
          </p>
        )}

        {/* Meta */}
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {msg.audience_id && (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />
              {msg.audience_id}
            </span>
          )}
          {msg.schedule_at != null && (
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              Scheduled {formatTimestamp(msg.schedule_at)}
            </span>
          )}
          {msg.created_at && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Created {formatDate(msg.created_at)}
            </span>
          )}
        </div>

        {/* Rewards JSON toggle */}
        {msg.rewards_json && (
          <div>
            <button
              type="button"
              onClick={() => setShowRewards(!showRewards)}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showRewards ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <Gift className="h-3 w-3" />
              Rewards
            </button>
            {showRewards && (
              <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border bg-muted/50 p-2 font-mono text-[11px] text-muted-foreground">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(msg.rewards_json), null, 2);
                  } catch {
                    return msg.rewards_json;
                  }
                })()}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Broadcast Form ───────────────────────────────────────────────── */

function BroadcastForm({
  onClose,
  audiences,
  gameScope,
}: {
  onClose: () => void;
  audiences: Audience[];
  gameScope: string;
}) {
  const broadcast = useBroadcast(gameScope);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audienceId, setAudienceId] = useState("");
  const [rewardsJson, setRewardsJson] = useState("");
  const [scheduleAt, setScheduleAt] = useState("");

  const canSend = title.trim().length > 0 && !broadcast.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;

    const params: Parameters<typeof satori.broadcastMessage>[0] = {
      title: title.trim(),
    };
    if (body.trim()) params.body = body.trim();
    if (audienceId) params.audience_id = audienceId;
    if (rewardsJson.trim()) params.rewards_json = rewardsJson.trim();
    if (scheduleAt) {
      params.schedule_at = Math.floor(new Date(scheduleAt).getTime() / 1000);
    }

    const scope = audienceId ? `audience "${audienceId}"` : "all players";
    if (!window.confirm(`${scheduleAt ? "Schedule" : "Create"} message "${title.trim()}" for ${scope} in production?`)) {
      return;
    }

    broadcast.mutate(params, { onSuccess: onClose });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[10vh]">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-xl"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Send className="h-5 w-5 text-primary" />
            Broadcast Message
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Title <span className="text-destructive">*</span>
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Message title"
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* Body */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Message body..."
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* Audience */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Target Audience
            </label>
            <select
              value={audienceId}
              onChange={(e) => setAudienceId(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            >
              <option value="">All players (no filter)</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.id}
                </option>
              ))}
            </select>
          </div>

          {/* Schedule */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Schedule (leave empty to send immediately)
            </label>
            <input
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>

          {/* Rewards JSON */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Rewards JSON (optional)
            </label>
            <textarea
              value={rewardsJson}
              onChange={(e) => setRewardsJson(e.target.value)}
              placeholder='[{"type":"coins","amount":100}]'
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
        </div>

        {/* Error */}
        {broadcast.isError && (
          <div className="mt-3 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            {broadcast.error instanceof Error
              ? broadcast.error.message
              : "Failed to broadcast message"}
          </div>
        )}

        {/* Actions */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {broadcast.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {scheduleAt ? "Schedule" : "Send Now"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Empty / Error States ─────────────────────────────────────────── */

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {filtered ? (
        <>
          <Search className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No messages match your search
          </p>
        </>
      ) : (
        <>
          <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No messages yet
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Broadcast your first message to players.
          </p>
        </>
      )}
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <AlertTriangle className="mx-auto h-8 w-8 text-destructive" />
      <p className="mt-3 text-sm font-medium text-destructive">
        Failed to load messages
      </p>
      <p className="mt-1 text-xs text-muted-foreground">{message}</p>
      <button
        onClick={onRetry}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </div>
  );
}

/* ── Main Page ─────────────────────────────────────────────────────── */

export function MessagesPage() {
  const [gameScope, setGameScope] = useState(GLOBAL_CONFIG_SCOPE);
  const messages = useMessages(gameScope);
  const audiences = useAudiences(gameScope);
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [showForm, setShowForm] = useState(false);

  const filtered = useMemo(() => {
    let list = messages.data ?? [];
    if (filterMode !== "all") {
      list = list.filter((m) => m.status === filterMode);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.id.toLowerCase().includes(q) ||
          m.title.toLowerCase().includes(q) ||
          m.body?.toLowerCase().includes(q) ||
          m.audience_id?.toLowerCase().includes(q),
      );
    }
    return list;
  }, [messages.data, search, filterMode]);

  const total = messages.data?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <MessageSquare className="h-6 w-6 text-primary" />
            Messages
          </h2>
          <p className="text-muted-foreground">
            Broadcast messages and manage campaigns.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Game ID
            <input
              value={gameScope}
              onChange={(e) => setGameScope(e.target.value || GLOBAL_CONFIG_SCOPE)}
              placeholder="global or quizverse"
              className="w-44 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
            />
          </label>
          {messages.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => messages.refetch()}
            disabled={messages.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                messages.isFetching && "animate-spin",
              )}
            />
            Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Broadcast
          </button>
        </div>
      </div>

      {/* Toolbar */}
      {total > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[240px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages..."
              className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Status filter */}
          <div className="flex items-center rounded-md border border-border bg-card">
            {(
              ["all", "draft", "scheduled", "sent", "failed"] as FilterMode[]
            ).map((mode) => (
              <button
                key={mode}
                onClick={() => setFilterMode(mode)}
                className={cn(
                  "h-10 px-3 text-xs font-medium capitalize transition-colors first:rounded-l-md last:rounded-r-md",
                  filterMode === mode
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      {messages.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : messages.isError ? (
        <ErrorState
          message={
            messages.error instanceof Error
              ? messages.error.message
              : "Unknown error"
          }
          onRetry={() => messages.refetch()}
        />
      ) : filtered.length === 0 ? (
        <EmptyState filtered={search.trim().length > 0 || filterMode !== "all"} />
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            <Filter className="mr-1 inline h-3 w-3" />
            Showing {filtered.length} of {total} message
            {total !== 1 && "s"}
          </p>
          {filtered.map((msg) => (
            <MessageCard key={msg.id} msg={msg} />
          ))}
        </div>
      )}

      {/* Broadcast Form Modal */}
      {showForm && (
        <BroadcastForm
          onClose={() => setShowForm(false)}
          audiences={audiences.data ?? []}
          gameScope={gameScope}
        />
      )}
    </div>
  );
}


export default MessagesPage;
