import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nakama, satori, useRpcOptions } from "@nakama/shared";
import type { Notification, NotificationList, SatoriMessage } from "@nakama/shared";
import {
  Inbox,
  Bell,
  Gift,
  Users,
  Settings2,
  Loader2,
  Trash2,
  CheckCheck,
  Clock,
  ChevronDown,
  AlertCircle,
  Sparkles,
  ShieldCheck,
  MessageSquare,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  constants                                                          */
/* ------------------------------------------------------------------ */

type TabKey = "all" | "system" | "rewards" | "social" | "custom";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "all", label: "All", icon: <Inbox className="h-3.5 w-3.5" /> },
  { key: "system", label: "System", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
  { key: "rewards", label: "Rewards", icon: <Gift className="h-3.5 w-3.5" /> },
  { key: "social", label: "Social", icon: <Users className="h-3.5 w-3.5" /> },
  { key: "custom", label: "Custom", icon: <Settings2 className="h-3.5 w-3.5" /> },
];

const CODE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: "System", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  [-1]: { label: "Internal", color: "bg-slate-500/10 text-slate-600 dark:text-slate-400" },
  [-2]: { label: "Group Join", color: "bg-violet-500/10 text-violet-600 dark:text-violet-400" },
  [-3]: { label: "Friend Req", color: "bg-pink-500/10 text-pink-600 dark:text-pink-400" },
  [-4]: { label: "Friend Accept", color: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  [-5]: { label: "Ban", color: "bg-red-500/10 text-red-600 dark:text-red-400" },
};

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function codeInfo(code: number): { label: string; color: string } {
  if (CODE_LABELS[code]) return CODE_LABELS[code];
  if (code > 0) return { label: `Custom (${code})`, color: "bg-amber-500/10 text-amber-600 dark:text-amber-400" };
  return { label: `Code ${code}`, color: "bg-muted text-muted-foreground" };
}

function categorize(n: Notification): TabKey {
  if (n.code === -3 || n.code === -4 || n.code === -2) return "social";
  if (n.code <= 0) return "system";

  const ct = n.content;
  if (
    ct &&
    (ct.reward || ct.rewards || ct.coins || ct.gems || ct.xp || ct.items || ct.currency)
  )
    return "rewards";

  if (n.code > 0) return "custom";
  return "system";
}

function contentPreview(content: Record<string, unknown>): string {
  if (!content || Object.keys(content).length === 0) return "";
  if (typeof content.message === "string") return content.message;
  if (typeof content.text === "string") return content.text;
  if (typeof content.body === "string") return content.body;
  const keys = Object.keys(content);
  if (keys.length <= 3) {
    return keys
      .map((k) => {
        const v = content[k];
        return `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`;
      })
      .join(" · ");
  }
  return `${keys.length} fields`;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function categorizeSatoriMsg(_msg: SatoriMessage): TabKey {
  if (_msg.rewards_json) return "rewards";
  return "system";
}

/* ------------------------------------------------------------------ */
/*  unified inbox item                                                 */
/* ------------------------------------------------------------------ */

interface InboxItem {
  id: string;
  source: "nakama" | "satori";
  subject: string;
  preview: string;
  code?: number;
  category: TabKey;
  time: string;
  raw: Notification | SatoriMessage;
}

function toInboxItem(n: Notification): InboxItem {
  return {
    id: n.id,
    source: "nakama",
    subject: n.subject,
    preview: contentPreview(n.content),
    code: n.code,
    category: categorize(n),
    time: n.create_time,
    raw: n,
  };
}

function satoriToInboxItem(m: SatoriMessage): InboxItem {
  return {
    id: m.id,
    source: "satori",
    subject: m.title,
    preview: m.body ?? "",
    category: categorizeSatoriMsg(m),
    time: m.created_at ?? new Date().toISOString(),
    raw: m,
  };
}

/* ------------------------------------------------------------------ */
/*  notification detail drawer                                         */
/* ------------------------------------------------------------------ */

function DetailDrawer({
  item,
  onClose,
  onDelete,
  isDeleting,
}: {
  item: InboxItem;
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const isNakama = item.source === "nakama";
  const raw = item.raw;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md flex-col overflow-y-auto bg-background border-l border-border shadow-2xl animate-in slide-in-from-right-full duration-200">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 backdrop-blur px-5 py-4">
          <h3 className="text-lg font-bold truncate">{item.subject}</h3>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-muted transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 p-5">
          {/* badges */}
          <div className="flex flex-wrap gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium",
                isNakama
                  ? "bg-primary/10 text-primary"
                  : "bg-violet-500/10 text-violet-600 dark:text-violet-400",
              )}
            >
              {isNakama ? (
                <Bell className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {isNakama ? "Notification" : "Satori Message"}
            </span>
            {item.code !== undefined && (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium",
                  codeInfo(item.code).color,
                )}
              >
                {codeInfo(item.code).label}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              {timeAgo(item.time)}
            </span>
          </div>

          {/* preview / body */}
          {item.preview && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-1">
                Message
              </h4>
              <p className="text-sm leading-relaxed">{item.preview}</p>
            </div>
          )}

          {/* raw content (nakama) */}
          {isNakama && (raw as Notification).content && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Content
              </h4>
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-xs font-mono leading-relaxed">
                {JSON.stringify((raw as Notification).content, null, 2)}
              </pre>
            </div>
          )}

          {/* satori rewards */}
          {!isNakama && (raw as SatoriMessage).rewards_json && (
            <div>
              <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Rewards
              </h4>
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted/50 p-3 text-xs font-mono leading-relaxed">
                {(raw as SatoriMessage).rewards_json}
              </pre>
            </div>
          )}

          {/* metadata */}
          <div>
            <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-2">
              Details
            </h4>
            <div className="space-y-1.5">
              <Row label="ID" value={item.id} />
              <Row label="Source" value={item.source} />
              {isNakama && (
                <>
                  <Row label="Sender" value={(raw as Notification).sender_id || "system"} />
                  <Row label="Persistent" value={(raw as Notification).persistent ? "Yes" : "No"} />
                </>
              )}
              {!isNakama && (raw as SatoriMessage).audience_id && (
                <Row label="Audience" value={(raw as SatoriMessage).audience_id!} />
              )}
              <Row
                label="Received"
                value={new Date(item.time).toLocaleString(undefined, {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              />
            </div>
          </div>

          {/* delete */}
          {isNakama && (
            <button
              disabled={isDeleting}
              onClick={onDelete}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              {isDeleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isDeleting ? "Deleting…" : "Delete Notification"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium truncate max-w-[220px] text-right">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  notification card                                                  */
/* ------------------------------------------------------------------ */

function NotifCard({
  item,
  onOpen,
  onDelete,
  isDeleting,
}: {
  item: InboxItem;
  onOpen: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  const info = item.code !== undefined ? codeInfo(item.code) : null;

  return (
    <div
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border bg-card p-4 transition-all",
        "border-border hover:border-primary/30 hover:shadow-md hover:shadow-primary/5",
      )}
    >
      {/* icon */}
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          item.category === "rewards"
            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
            : item.category === "social"
              ? "bg-pink-500/10 text-pink-600 dark:text-pink-400"
              : item.category === "custom"
                ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                : "bg-primary/10 text-primary",
        )}
      >
        {item.category === "rewards" ? (
          <Gift className="h-5 w-5" />
        ) : item.category === "social" ? (
          <Users className="h-5 w-5" />
        ) : item.category === "custom" ? (
          <MessageSquare className="h-5 w-5" />
        ) : item.source === "satori" ? (
          <Sparkles className="h-5 w-5" />
        ) : (
          <Bell className="h-5 w-5" />
        )}
      </div>

      {/* body */}
      <button
        onClick={onOpen}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold leading-tight line-clamp-1">
            {item.subject}
          </h4>
          {info && (
            <span
              className={cn(
                "shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                info.color,
              )}
            >
              {info.label}
            </span>
          )}
        </div>
        {item.preview && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {item.preview}
          </p>
        )}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground/70 mt-0.5">
          <Clock className="h-3 w-3" />
          {timeAgo(item.time)}
          {item.source === "satori" && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-violet-500">
              <Sparkles className="h-2.5 w-2.5" /> Satori
            </span>
          )}
        </span>
      </button>

      {/* delete button */}
      {item.source === "nakama" && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={isDeleting}
          className="shrink-0 rounded-lg p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 disabled:opacity-50"
          title="Delete notification"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  skeletons / empty                                                  */
/* ------------------------------------------------------------------ */

function CardSkeleton() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4 animate-pulse">
      <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-3/5 rounded bg-muted" />
        <div className="h-3 w-4/5 rounded bg-muted" />
        <div className="h-3 w-1/4 rounded bg-muted" />
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="h-7 w-32 rounded bg-muted animate-pulse" />
        <div className="h-4 w-56 rounded bg-muted animate-pulse" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-20 rounded-full bg-muted animate-pulse" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground">
      <Inbox className="h-12 w-12 opacity-40" />
      <p className="text-sm font-medium">
        {tab === "all"
          ? "Your inbox is empty."
          : `No ${tab} notifications.`}
      </p>
      <p className="text-xs">
        Notifications from gameplay, events, and social interactions will appear here.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  page                                                               */
/* ------------------------------------------------------------------ */

export function InboxPage() {
  const rpcOpts = useRpcOptions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabKey>("all");
  const [selected, setSelected] = useState<InboxItem | null>(null);
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const [showLoadMore, setShowLoadMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  /* ---------- fetch nakama notifications ---------- */

  const {
    data: nakamaData,
    isLoading: nakamaLoading,
    isError: nakamaError,
    error: nakamaErr,
  } = useQuery<NotificationList>({
    queryKey: ["nakama", "notifications"],
    queryFn: () => nakama.listNotifications({ ...rpcOpts, limit: 100 }),
    staleTime: 20_000,
  });

  /* ---------- fetch satori messages (best-effort) ---------- */

  const { data: satoriData } = useQuery<{ messages?: SatoriMessage[] }>({
    queryKey: ["satori", "messages", "inbox"],
    queryFn: () => satori.listMessages(rpcOpts),
    staleTime: 60_000,
    retry: false,
  });

  /* ---------- delete mutation ---------- */

  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => nakama.deleteNotifications(ids, rpcOpts),
    onMutate: (ids) => {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.add(id));
        return next;
      });
    },
    onSettled: (_data, _err, ids) => {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["nakama", "notifications"] });
      if (selected && ids.includes(selected.id)) setSelected(null);
    },
  });

  /* ---------- merge + filter ---------- */

  const allItems = useMemo(() => {
    const nakamaItems = (nakamaData?.notifications ?? []).map(toInboxItem);
    const satoriItems = (satoriData?.messages ?? [])
      .filter((m) => m.status === "sent")
      .map(satoriToInboxItem);
    const merged = [...nakamaItems, ...satoriItems];
    merged.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    return merged;
  }, [nakamaData, satoriData]);

  const filtered = useMemo(
    () => (tab === "all" ? allItems : allItems.filter((i) => i.category === tab)),
    [allItems, tab],
  );

  const tabCounts = useMemo(() => {
    const counts: Record<TabKey, number> = { all: 0, system: 0, rewards: 0, social: 0, custom: 0 };
    for (const item of allItems) {
      counts.all++;
      counts[item.category]++;
    }
    return counts;
  }, [allItems]);

  const handleDelete = useCallback(
    (id: string) => deleteMutation.mutate([id]),
    [deleteMutation],
  );

  /* ---------- render ---------- */

  if (nakamaLoading) return <PageSkeleton />;

  if (nakamaError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Inbox</h2>
          <p className="text-muted-foreground">Messages and notifications.</p>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-60" />
          <p className="font-medium">Failed to load notifications</p>
          <p className="mt-1 text-xs opacity-70">
            {(nakamaErr as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Inbox</h2>
        <p className="text-muted-foreground">
          Messages and notifications.{" "}
          {allItems.length > 0 && (
            <span className="text-foreground font-medium">
              {allItems.length} total
            </span>
          )}
        </p>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const isActive = t.key === tab;
          const count = tabCounts[t.key];
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              {t.icon}
              {t.label}
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

      {/* list */}
      {filtered.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <NotifCard
              key={`${item.source}-${item.id}`}
              item={item}
              onOpen={() => setSelected(item)}
              onDelete={() => handleDelete(item.id)}
              isDeleting={deletingIds.has(item.id)}
            />
          ))}

          {nakamaData?.cacheable_cursor && (
            <div className="pt-2 text-center">
              <button
                onClick={() => {
                  /* load more would fetch with cursor — simplified for MVP */
                }}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {/* detail drawer */}
      {selected && (
        <DetailDrawer
          item={selected}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected.id)}
          isDeleting={deletingIds.has(selected.id)}
        />
      )}
    </div>
  );
}

export { InboxPage as default };

export default InboxPage;
