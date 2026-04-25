import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { nakama, useRpcOptions } from "@nakama/shared";
import type { Friend, FriendList } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Friend state mapping (Nakama REST API)                            */
/*  0 = mutual friend                                                 */
/*  1 = outgoing request (sent by this user)                          */
/*  2 = incoming request (received from another user)                 */
/*  3 = blocked                                                       */
/* ------------------------------------------------------------------ */

type TabKey = "friends" | "incoming" | "outgoing" | "blocked";

const TABS: { key: TabKey; label: string; state: number }[] = [
  { key: "friends", label: "Friends", state: 0 },
  { key: "incoming", label: "Requests", state: 2 },
  { key: "outgoing", label: "Sent", state: 1 },
  { key: "blocked", label: "Blocked", state: 3 },
];

function fmtRelative(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export function FriendsPage() {
  const rpcOpts = useRpcOptions();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("friends");
  const [addInput, setAddInput] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const activeState = TABS.find((t) => t.key === tab)!.state;

  const {
    data: friendsData,
    isLoading,
    isError,
  } = useQuery<FriendList>({
    queryKey: ["nakama", "friends", activeState],
    queryFn: () =>
      nakama.listFriends({ ...rpcOpts, limit: 100, state: activeState }),
    staleTime: 15_000,
  });

  const friends = useMemo(
    () => friendsData?.friends ?? [],
    [friendsData],
  );

  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({ queryKey: ["nakama", "friends"] }),
    [queryClient],
  );

  const addMutation = useMutation({
    mutationFn: (username: string) =>
      nakama.addFriendsByUsername([username], rpcOpts),
    onSuccess: () => {
      invalidate();
      setAddInput("");
      setAddError(null);
    },
    onError: (err: unknown) => {
      setAddError(
        err instanceof Error ? err.message : "Could not send friend request",
      );
    },
  });

  const acceptMutation = useMutation({
    mutationFn: (id: string) => nakama.addFriends([id], rpcOpts),
    onSuccess: invalidate,
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => nakama.deleteFriends([id], rpcOpts),
    onSuccess: invalidate,
  });

  const blockMutation = useMutation({
    mutationFn: (id: string) => nakama.blockFriends([id], rpcOpts),
    onSuccess: invalidate,
  });

  const unblockMutation = useMutation({
    mutationFn: (id: string) => nakama.deleteFriends([id], rpcOpts),
    onSuccess: invalidate,
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const val = addInput.trim();
    if (!val) return;
    setAddError(null);
    addMutation.mutate(val);
  };

  return (
    <div className="space-y-6">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Friends</h2>
          <p className="text-muted-foreground">
            Manage your friends and requests.
          </p>
        </div>
        <Link
          to="/profile"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <ArrowLeftIcon />
          Profile
        </Link>
      </div>

      {/* ---- Add Friend ---- */}
      <form
        onSubmit={handleAdd}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={addInput}
          onChange={(e) => {
            setAddInput(e.target.value);
            setAddError(null);
          }}
          placeholder="Add friend by username..."
          className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none ring-primary/30 transition-shadow focus:ring-2"
        />
        <button
          type="submit"
          disabled={addMutation.isPending || !addInput.trim()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PlusIcon />
          {addMutation.isPending ? "Sending..." : "Add"}
        </button>
      </form>
      {addError && (
        <p className="text-xs text-destructive">{addError}</p>
      )}

      {/* ---- Tabs ---- */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ---- List ---- */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center text-sm text-destructive">
          Failed to load friends. Please try again.
        </div>
      ) : friends.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-2">
          {friends.map((f) => (
            <FriendCard
              key={f.user.user_id}
              friend={f}
              tab={tab}
              onAccept={() => acceptMutation.mutate(f.user.user_id)}
              onRemove={() => removeMutation.mutate(f.user.user_id)}
              onBlock={() => blockMutation.mutate(f.user.user_id)}
              onUnblock={() => unblockMutation.mutate(f.user.user_id)}
              busy={
                acceptMutation.isPending ||
                removeMutation.isPending ||
                blockMutation.isPending ||
                unblockMutation.isPending
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function FriendCard({
  friend,
  tab,
  onAccept,
  onRemove,
  onBlock,
  onUnblock,
  busy,
}: {
  friend: Friend;
  tab: TabKey;
  onAccept: () => void;
  onRemove: () => void;
  onBlock: () => void;
  onUnblock: () => void;
  busy: boolean;
}) {
  const u = friend.user;
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted/30">
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
        {u.avatar_url ? (
          <img
            src={u.avatar_url}
            alt=""
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          (u.display_name ?? u.username ?? "?")[0]?.toUpperCase()
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {u.display_name || u.username}
        </p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>@{u.username}</span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5",
              u.online
                ? "bg-emerald-500/10 text-emerald-600"
                : "bg-zinc-500/10 text-zinc-500",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                u.online ? "bg-emerald-500" : "bg-zinc-400",
              )}
            />
            {u.online ? "Online" : "Offline"}
          </span>
          {friend.update_time && (
            <span>{fmtRelative(friend.update_time)}</span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {tab === "incoming" && (
          <ActionBtn
            label="Accept"
            variant="primary"
            onClick={onAccept}
            disabled={busy}
          />
        )}
        {tab === "blocked" ? (
          <ActionBtn
            label="Unblock"
            variant="default"
            onClick={onUnblock}
            disabled={busy}
          />
        ) : (
          <>
            <ActionBtn
              label="Remove"
              variant="destructive"
              onClick={onRemove}
              disabled={busy}
            />
            {tab !== "blocked" && (
              <ActionBtn
                label="Block"
                variant="ghost"
                onClick={onBlock}
                disabled={busy}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  label,
  variant,
  onClick,
  disabled,
}: {
  label: string;
  variant: "primary" | "destructive" | "default" | "ghost";
  onClick: () => void;
  disabled?: boolean;
}) {
  const base =
    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-40";
  const styles: Record<string, string> = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    destructive:
      "border border-destructive/30 text-destructive hover:bg-destructive/10",
    default: "border border-border hover:bg-muted",
    ghost: "text-muted-foreground hover:text-foreground hover:bg-muted",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(base, styles[variant])}
    >
      {label}
    </button>
  );
}

function EmptyState({ tab }: { tab: TabKey }) {
  const msgs: Record<TabKey, { title: string; desc: string }> = {
    friends: {
      title: "No friends yet",
      desc: "Add friends by username above to get started.",
    },
    incoming: {
      title: "No incoming requests",
      desc: "When someone sends you a friend request, it will appear here.",
    },
    outgoing: {
      title: "No pending requests",
      desc: "Friend requests you send will appear here until accepted.",
    },
    blocked: {
      title: "No blocked users",
      desc: "Users you block will appear here.",
    },
  };
  const m = msgs[tab];
  return (
    <div className="rounded-lg border border-dashed border-border p-10 text-center">
      <p className="text-sm font-medium text-foreground">{m.title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{m.desc}</p>
    </div>
  );
}

/* ---- Icons ---- */

function ArrowLeftIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export { FriendsPage as default };

export default FriendsPage;
