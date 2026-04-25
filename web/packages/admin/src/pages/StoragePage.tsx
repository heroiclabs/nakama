import { useState, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Database,
  Search,
  RefreshCw,
  Loader2,
  X,
  Copy,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Save,
  Pencil,
  FolderOpen,
  FileJson,
  User,
  Hash,
  Shield,
} from "lucide-react";
import { serverKeyAuth, nakama, type StorageObject } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ── Constants ─────────────────────────────────────────────────────── */

const PAGE_SIZE = 20;

const COMMON_COLLECTIONS = [
  "hiro_configs",
  "satori_configs",
  "hiro_inventory",
  "hiro_economy",
  "hiro_achievements",
  "hiro_progression",
  "hiro_energy",
  "hiro_stats",
  "hiro_streaks",
  "hiro_challenges",
  "hiro_incentives",
  "hiro_tutorials",
  "hiro_unlockables",
  "hiro_event_leaderboards",
  "hiro_store",
  "hiro_auctions",
];

/* ── Queries / Mutations ──────────────────────────────────────────── */

function useStorageObjects(
  collection: string,
  userId: string,
  cursor: string,
) {
  return useQuery({
    queryKey: ["nakama", "storage", collection, userId, cursor],
    queryFn: () =>
      nakama.listStorageObjects(collection, {
        ...serverKeyAuth(),
        limit: PAGE_SIZE,
        cursor: cursor || undefined,
        userId: userId || undefined,
      }) as Promise<{ objects?: StorageObject[]; cursor?: string }>,
    enabled: collection.length > 0,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });
}

function useWriteStorage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: {
      collection: string;
      key: string;
      value: unknown;
      userId?: string;
      version?: string;
    }) =>
      nakama.writeStorageObject(args.collection, args.key, args.value, {
        ...serverKeyAuth(),
        userId: args.userId,
        version: args.version,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["nakama", "storage"] }),
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

function tryParseJson(str: string): { ok: boolean; value?: unknown; error?: string } {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function permissionLabel(perm: number): string {
  switch (perm) {
    case 0:
      return "No Access";
    case 1:
      return "Owner Only";
    case 2:
      return "Public Read";
    default:
      return String(perm);
  }
}

/* ── Collection Picker ─────────────────────────────────────────────── */

function CollectionPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        Collection
      </label>
      <div className="flex flex-wrap gap-1.5">
        {COMMON_COLLECTIONS.map((c) => (
          <button
            key={c}
            onClick={() => {
              onChange(c);
              setShowCustom(false);
            }}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              value === c
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {c.replace(/^(hiro_|satori_)/, "")}
          </button>
        ))}
        <button
          onClick={() => setShowCustom(true)}
          className={cn(
            "rounded-md border border-dashed px-2.5 py-1 text-xs font-medium transition-colors",
            showCustom || (!COMMON_COLLECTIONS.includes(value) && value)
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          Custom…
        </button>
      </div>
      {(showCustom || (!COMMON_COLLECTIONS.includes(value) && value)) && (
        <div className="flex gap-2">
          <input
            type="text"
            value={custom || (!COMMON_COLLECTIONS.includes(value) ? value : "")}
            onChange={(e) => setCustom(e.target.value)}
            placeholder="my_custom_collection"
            className="h-8 flex-1 rounded-md border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          <button
            onClick={() => {
              if (custom.trim()) onChange(custom.trim());
            }}
            disabled={!custom.trim()}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            Load
          </button>
        </div>
      )}
    </div>
  );
}

/* ── JSON Editor Modal ─────────────────────────────────────────────── */

interface EditorModalProps {
  object: StorageObject | null;
  isNew?: boolean;
  isPending: boolean;
  onSave: (args: {
    collection: string;
    key: string;
    value: unknown;
    userId?: string;
    version?: string;
  }) => void;
  onClose: () => void;
}

function EditorModal({
  object,
  isNew,
  isPending,
  onSave,
  onClose,
}: EditorModalProps) {
  const [collection, setCollection] = useState(object?.collection ?? "");
  const [key, setKey] = useState(object?.key ?? "");
  const [userId, setUserId] = useState(object?.user_id ?? "");
  const [jsonText, setJsonText] = useState(
    object ? JSON.stringify(object.value, null, 2) : "{\n  \n}",
  );
  const [parseError, setParseError] = useState<string | null>(null);

  function handleSave() {
    const result = tryParseJson(jsonText);
    if (!result.ok) {
      setParseError(result.error ?? "Invalid JSON");
      return;
    }
    setParseError(null);
    onSave({
      collection: collection || object?.collection || "",
      key: key || object?.key || "",
      value: result.value,
      userId: userId || object?.user_id || undefined,
      version: isNew ? "*" : object?.version,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">
            {isNew ? "Create Storage Object" : "Edit Storage Object"}
          </h3>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* Meta fields */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Collection
              </label>
              <input
                type="text"
                value={collection}
                onChange={(e) => setCollection(e.target.value)}
                disabled={!isNew}
                placeholder="collection_name"
                className="h-8 w-full rounded-md border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Key
              </label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={!isNew}
                placeholder="object_key"
                className="h-8 w-full rounded-md border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                User ID (optional)
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                disabled={!isNew}
                placeholder="00000000-0000-..."
                className="h-8 w-full rounded-md border border-border bg-card px-3 text-sm outline-none placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20 disabled:opacity-60"
              />
            </div>
          </div>

          {/* JSON editor */}
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Value (JSON)
            </label>
            <textarea
              value={jsonText}
              onChange={(e) => {
                setJsonText(e.target.value);
                if (parseError) setParseError(null);
              }}
              spellCheck={false}
              rows={16}
              className={cn(
                "w-full resize-y rounded-md border bg-card p-3 font-mono text-xs leading-relaxed outline-none transition-colors focus:ring-1",
                parseError
                  ? "border-destructive focus:border-destructive focus:ring-destructive/20"
                  : "border-border focus:border-primary focus:ring-primary/20",
              )}
            />
            {parseError && (
              <p className="mt-1 text-xs text-destructive">{parseError}</p>
            )}
          </div>

          {!isNew && object && (
            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Version: {object.version}</span>
              <span>Read: {permissionLabel(object.permission_read)}</span>
              <span>Write: {permissionLabel(object.permission_write)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="h-9 rounded-md border border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || (!isNew && !jsonText.trim())}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            <Save className="h-4 w-4" />
            {isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Storage Object Row ────────────────────────────────────────────── */

interface ObjectRowProps {
  obj: StorageObject;
  onEdit: (obj: StorageObject) => void;
}

function ObjectRow({ obj, onEdit }: ObjectRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  const valuePreview = useMemo(() => {
    const str = JSON.stringify(obj.value);
    return str.length > 120 ? str.slice(0, 120) + "…" : str;
  }, [obj.value]);

  const fullJson = useMemo(
    () => JSON.stringify(obj.value, null, 2),
    [obj.value],
  );

  return (
    <div className="group rounded-lg border border-border bg-card transition-colors hover:border-border/80">
      <div className="flex items-start justify-between gap-3 p-4">
        {/* Left */}
        <div className="min-w-0 flex-1 space-y-2">
          {/* Key + collection */}
          <div className="flex flex-wrap items-center gap-2">
            <FileJson className="h-4 w-4 shrink-0 text-primary" />
            <span className="font-mono text-sm font-semibold">{obj.key}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {obj.collection}
            </span>
          </div>

          {/* User ID */}
          {obj.user_id && obj.user_id !== "00000000-0000-0000-0000-000000000000" && (
            <div className="flex items-center gap-1.5">
              <User className="h-3 w-3 text-muted-foreground" />
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                {obj.user_id}
              </code>
              <button
                onClick={() => copy(obj.user_id, `uid-${obj.key}`)}
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Copy user ID"
              >
                {copied === `uid-${obj.key}` ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                )}
              </button>
            </div>
          )}

          {/* Value preview */}
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-left"
          >
            {expanded ? (
              <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <code className="rounded bg-muted/50 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
              {expanded ? "Hide value" : valuePreview}
            </code>
          </button>

          {expanded && (
            <div className="relative">
              <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted/50 p-3 font-mono text-xs leading-relaxed text-foreground">
                {fullJson}
              </pre>
              <button
                onClick={() => copy(fullJson, `json-${obj.key}`)}
                className="absolute right-2 top-2 rounded border border-border bg-card p-1 text-muted-foreground transition-colors hover:text-foreground"
                title="Copy JSON"
              >
                {copied === `json-${obj.key}` ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          )}

          {/* Meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Hash className="h-3 w-3" />v{obj.version?.slice(0, 8)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Shield className="h-3 w-3" />
              R:{permissionLabel(obj.permission_read)} / W:
              {permissionLabel(obj.permission_write)}
            </span>
            {obj.update_time && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(obj.update_time)}
              </span>
            )}
          </div>
        </div>

        {/* Right */}
        <button
          onClick={() => onEdit(obj)}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Edit object"
        >
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </button>
      </div>
    </div>
  );
}

/* ── Empty / Error States ─────────────────────────────────────────── */

function EmptyState({ hasCollection }: { hasCollection: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-16 text-center">
      {hasCollection ? (
        <>
          <FolderOpen className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            No objects in this collection
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Try a different collection or user ID filter.
          </p>
        </>
      ) : (
        <>
          <Database className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm font-medium text-muted-foreground">
            Select a collection to browse
          </p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Pick a common collection above or enter a custom name.
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
        Failed to load storage objects
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

export function StoragePage() {
  const [collection, setCollection] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [appliedUser, setAppliedUser] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([""]);
  const currentCursor = cursorStack[cursorStack.length - 1];

  const objects = useStorageObjects(collection, appliedUser, currentCursor);
  const writeStorage = useWriteStorage();

  const [editing, setEditing] = useState<StorageObject | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  function handleCollectionChange(c: string) {
    setCollection(c);
    setCursorStack([""]);
  }

  function handleUserSearch(e: React.FormEvent) {
    e.preventDefault();
    setCursorStack([""]);
    setAppliedUser(userFilter.trim());
  }

  function goNext() {
    const nextCursor = objects.data?.cursor;
    if (nextCursor) setCursorStack((s) => [...s, nextCursor]);
  }

  function goPrev() {
    if (cursorStack.length > 1) setCursorStack((s) => s.slice(0, -1));
  }

  function handleSave(args: {
    collection: string;
    key: string;
    value: unknown;
    userId?: string;
    version?: string;
  }) {
    writeStorage.mutate(args, {
      onSuccess: () => {
        setEditing(null);
        setIsCreating(false);
      },
    });
  }

  const items = objects.data?.objects ?? [];
  const hasNextPage = !!objects.data?.cursor;
  const hasPrevPage = cursorStack.length > 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Database className="h-6 w-6 text-primary" />
            Storage Browser
          </h2>
          <p className="text-muted-foreground">
            Browse, inspect, and edit Nakama storage collections.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {objects.isFetching && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <button
            onClick={() => setIsCreating(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <FileJson className="h-4 w-4" />
            New Object
          </button>
          {collection && (
            <button
              onClick={() => objects.refetch()}
              disabled={objects.isFetching}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  objects.isFetching && "animate-spin",
                )}
              />
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Collection picker */}
      <CollectionPicker value={collection} onChange={handleCollectionChange} />

      {/* User ID filter */}
      {collection && (
        <form onSubmit={handleUserSearch} className="relative max-w-lg">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            placeholder="Filter by user ID (optional)…"
            className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-28 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
          {userFilter && (
            <button
              type="button"
              onClick={() => {
                setUserFilter("");
                setAppliedUser("");
                setCursorStack([""]);
              }}
              className="absolute right-20 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="submit"
            className="absolute right-2 top-1/2 h-7 -translate-y-1/2 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Filter User
          </button>
        </form>
      )}

      {/* Content */}
      {!collection ? (
        <EmptyState hasCollection={false} />
      ) : objects.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : objects.isError ? (
        <ErrorState
          message={
            objects.error instanceof Error
              ? objects.error.message
              : "Unknown error"
          }
          onRetry={() => objects.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState hasCollection />
      ) : (
        <>
          {/* Results count */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Database className="h-3.5 w-3.5" />
            <span>
              {items.length} object{items.length !== 1 && "s"} in{" "}
              <span className="font-semibold text-foreground">
                {collection}
              </span>
              {appliedUser && (
                <>
                  {" "}for user{" "}
                  <code className="rounded bg-muted px-1 font-mono text-foreground">
                    {appliedUser}
                  </code>
                </>
              )}
            </span>
          </div>

          {/* Object list */}
          <div className="space-y-3">
            {items.map((obj) => (
              <ObjectRow
                key={`${obj.collection}-${obj.key}-${obj.user_id}`}
                obj={obj}
                onEdit={setEditing}
              />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">
              Page {cursorStack.length}
              {items.length > 0 && ` · ${items.length} results`}
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

      {/* Edit modal */}
      {editing && (
        <EditorModal
          object={editing}
          isPending={writeStorage.isPending}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {/* Create modal */}
      {isCreating && (
        <EditorModal
          object={null}
          isNew
          isPending={writeStorage.isPending}
          onSave={handleSave}
          onClose={() => setIsCreating(false)}
        />
      )}
    </div>
  );
}


export default StoragePage;
