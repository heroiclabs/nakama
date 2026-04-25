import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  UserCog,
  Search,
  RefreshCw,
  Loader2,
  X,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Shield,
  ShieldOff,
  Trash2,
  UserX,
  UserCheck,
  ChevronLeft,
  ChevronRight,
  Wifi,
  WifiOff,
} from "lucide-react";
import { serverKeyAuth, nakama, type NakamaUser } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Queries / Mutations ──────────────────────────────────────────── */

const PAGE_SIZE = 20;

function useAccounts(filter: string, cursor: string) {
  return useQuery({
    queryKey: ["nakama", "accounts", filter, cursor],
    queryFn: () =>
      nakama.listAccounts({
        ...serverKeyAuth(),
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
        filter: filter || undefined,
      }),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

function useBanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => nakama.banUser(userId, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["nakama", "accounts"] }),
  });
}

function useUnbanUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => nakama.unbanUser(userId, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["nakama", "accounts"] }),
  });
}

function useDeleteAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      nakama.deleteAccount(userId, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["nakama", "accounts"] }),
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

function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }, []);
  return { copied, copy };
}

/* ── Confirmation Dialog ──────────────────────────────────────────── */

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  variant: "danger" | "warning";
  isPending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  variant,
  isPending,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3">
          {variant === "danger" ? (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
          ) : (
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-yellow-500/10">
              <Shield className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold">{title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium text-white transition-colors disabled:opacity-50",
              variant === "danger"
                ? "bg-destructive hover:bg-destructive/90"
                : "bg-yellow-600 hover:bg-yellow-600/90",
            )}
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── User Row ─────────────────────────────────────────────────────── */

interface UserRowProps {
  user: NakamaUser;
  onBan: (id: string) => void;
  onUnban: (id: string) => void;
  onDelete: (id: string) => void;
}

function UserRow({ user, onBan, onUnban, onDelete }: UserRowProps) {
  const { copied, copy } = useCopyToClipboard();
  const uid = user.id ?? user.user?.id ?? "";
  const username = user.username ?? user.user?.username ?? "—";
  const displayName = user.display_name ?? user.user?.display_name ?? "";
  const online = user.online ?? user.user?.online ?? false;
  const createTime = user.create_time ?? user.user?.create_time;
  const updateTime = user.update_time ?? user.user?.update_time;
  const isBanned = user.disable_time != null && user.disable_time !== "";

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-border/80">
      <div className="flex flex-wrap items-start justify-between gap-4">
        {/* Left */}
        <div className="space-y-2">
          {/* Name line */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{username}</span>
            {displayName && displayName !== username && (
              <span className="text-xs text-muted-foreground">
                ({displayName})
              </span>
            )}
            {online ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                <Wifi className="h-2.5 w-2.5" />
                Online
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <WifiOff className="h-2.5 w-2.5" />
                Offline
              </span>
            )}
            {isBanned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive">
                <ShieldOff className="h-2.5 w-2.5" />
                Banned
              </span>
            )}
          </div>

          {/* ID */}
          <div className="flex items-center gap-1">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {uid}
            </code>
            <button
              onClick={() => copy(uid, uid)}
              className="opacity-0 transition-opacity group-hover:opacity-100"
              title="Copy user ID"
            >
              {copied === uid ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
              )}
            </button>
          </div>

          {/* Dates */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {createTime && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Created {formatDate(createTime)}
              </span>
            )}
            {updateTime && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Updated {formatDate(updateTime)}
              </span>
            )}
          </div>
        </div>

        {/* Right actions */}
        <div className="flex shrink-0 items-center gap-1">
          {isBanned ? (
            <button
              onClick={() => onUnban(uid)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-emerald-600 transition-colors hover:bg-emerald-500/10 dark:text-emerald-400"
              title="Unban user"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Unban
            </button>
          ) : (
            <button
              onClick={() => onBan(uid)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-yellow-600 transition-colors hover:bg-yellow-500/10 dark:text-yellow-400"
              title="Ban user"
            >
              <UserX className="h-3.5 w-3.5" />
              Ban
            </button>
          )}
          <button
            onClick={() => onDelete(uid)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            title="Delete account"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Empty / Error States ─────────────────────────────────────────── */

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {hasFilter ? (
        <>
          <Search className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No accounts match your filter
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different search term.
          </p>
        </>
      ) : (
        <>
          <UserCog className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No accounts found
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
        Failed to load accounts
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

export function AccountsPage() {
  const [filter, setFilter] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([""]);
  const currentCursor = cursorStack[cursorStack.length - 1];
  const accounts = useAccounts(appliedFilter, currentCursor);

  const banUser = useBanUser();
  const unbanUser = useUnbanUser();
  const deleteAccount = useDeleteAccount();

  const [confirm, setConfirm] = useState<{
    type: "ban" | "unban" | "delete";
    userId: string;
  } | null>(null);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setCursorStack([""]);
    setAppliedFilter(filter.trim());
  }

  function goNext() {
    const nextCursor = accounts.data?.cursor;
    if (nextCursor) {
      setCursorStack((s) => [...s, nextCursor]);
    }
  }

  function goPrev() {
    if (cursorStack.length > 1) {
      setCursorStack((s) => s.slice(0, -1));
    }
  }

  function handleConfirm() {
    if (!confirm) return;
    const opts = {
      onSuccess: () => setConfirm(null),
    };
    switch (confirm.type) {
      case "ban":
        banUser.mutate(confirm.userId, opts);
        break;
      case "unban":
        unbanUser.mutate(confirm.userId, opts);
        break;
      case "delete":
        deleteAccount.mutate(confirm.userId, opts);
        break;
    }
  }

  const users = accounts.data?.users ?? [];
  const hasNextPage = !!accounts.data?.cursor;
  const hasPrevPage = cursorStack.length > 1;
  const isPending =
    banUser.isPending || unbanUser.isPending || deleteAccount.isPending;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <UserCog className="h-6 w-6 text-primary" />
            Account Management
          </h2>
          <p className="text-muted-foreground">
            Search, ban, unban, and delete player accounts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {accounts.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => accounts.refetch()}
            disabled={accounts.isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                accounts.isFetching && "animate-spin",
              )}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search by username, user ID, or display name..."
          className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-20 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        {filter && (
          <button
            type="button"
            onClick={() => {
              setFilter("");
              setAppliedFilter("");
              setCursorStack([""]);
            }}
            className="absolute right-14 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          type="submit"
          className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Search
        </button>
      </form>

      {/* Content */}
      {accounts.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : accounts.isError ? (
        <ErrorState
          message={
            accounts.error instanceof Error
              ? accounts.error.message
              : "Unknown error"
          }
          onRetry={() => accounts.refetch()}
        />
      ) : users.length === 0 ? (
        <EmptyState hasFilter={appliedFilter.length > 0} />
      ) : (
        <>
          <div className="space-y-3">
            {users.map((u) => (
              <UserRow
                key={u.id ?? u.user?.id}
                user={u}
                onBan={(id) => setConfirm({ type: "ban", userId: id })}
                onUnban={(id) => setConfirm({ type: "unban", userId: id })}
                onDelete={(id) => setConfirm({ type: "delete", userId: id })}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Page {cursorStack.length}
              {users.length > 0 && ` \u00B7 ${users.length} results`}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                disabled={!hasPrevPage}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Previous
              </button>
              <button
                onClick={goNext}
                disabled={!hasNextPage}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                Next
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Confirmation dialogs */}
      {confirm?.type === "ban" && (
        <ConfirmDialog
          title="Ban Account"
          description="This user will be immediately disconnected and unable to authenticate. You can unban them later."
          confirmLabel="Ban User"
          variant="warning"
          isPending={banUser.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === "unban" && (
        <ConfirmDialog
          title="Unban Account"
          description="This user will regain the ability to authenticate and play."
          confirmLabel="Unban User"
          variant="warning"
          isPending={unbanUser.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm?.type === "delete" && (
        <ConfirmDialog
          title="Delete Account"
          description="This action is permanent and cannot be undone. All user data, wallet, inventory, and progress will be lost."
          confirmLabel="Delete Forever"
          variant="danger"
          isPending={deleteAccount.isPending}
          onConfirm={handleConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

export { AccountsPage as default };

export default AccountsPage;
