import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  Loader2,
  RefreshCw,
  User,
  Wallet,
  Package,
  Database,
  ShieldBan,
  ShieldCheck,
  Trash2,
  Send,
  Copy,
  CheckCircle2,
  XCircle,
  ChevronRight,
  ArrowLeft,
  Clock,
  Globe,
  Smartphone,
  Mail,
  AlertTriangle,
  Coins,
  Plus,
} from "lucide-react";
import {
  serverKeyAuth,
  nakama,
  callRpc,
  type NakamaUser,
  type ConsoleAccount,
  type StorageObject,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Tab = "overview" | "wallet" | "inventory" | "storage" | "actions";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: User },
  { id: "wallet", label: "Wallet", icon: Wallet },
  { id: "inventory", label: "Inventory", icon: Package },
  { id: "storage", label: "Storage", icon: Database },
  { id: "actions", label: "Actions", icon: ShieldBan },
];

// ─── Search Hook ──────────────────────────────────────────────────────
// When there's no query we list the most recent accounts so the inspector
// shows real players immediately instead of an empty prompt.
function usePlayerSearch(query: string) {
  return useQuery({
    queryKey: ["admin", "player-search", query],
    queryFn: async () => {
      const opts = serverKeyAuth();
      const trimmed = query.trim();
      if (!trimmed) {
        const res = await nakama.listAccounts({ ...opts, limit: 25 });
        return res.users ?? [];
      }
      if (UUID_RE.test(trimmed)) {
        try {
          const acct = await nakama.getAccountById(trimmed, opts);
          return [acct.user];
        } catch {
          return [];
        }
      }
      const res = await nakama.listAccounts({
        ...opts,
        filter: trimmed,
        limit: 20,
      });
      return res.users ?? [];
    },
    staleTime: 30_000,
  });
}

// ─── Account Detail Hook ──────────────────────────────────────────────
function useAccountDetail(userId: string | null) {
  return useQuery({
    queryKey: ["admin", "player-detail", userId],
    queryFn: () => nakama.getAccountById(userId!, serverKeyAuth()),
    enabled: !!userId,
    staleTime: 10_000,
  });
}

// ─── Inventory Hook (Hiro) ────────────────────────────────────────────
// Reads the target player's inventory via the admin profile inspector.
// hiro_inventory_list is player-scoped (needs the caller's own user id), so it
// cannot be used by the admin console to inspect an arbitrary player.
function usePlayerInventory(userId: string | null) {
  return useQuery({
    queryKey: ["admin", "player-inventory", userId],
    queryFn: async () => {
      const profile = await nakama.inspectPlayer(userId!, serverKeyAuth());
      return (profile.inventory ?? {}) as Record<string, unknown>;
    },
    enabled: !!userId,
    staleTime: 15_000,
    retry: 1,
  });
}

// ─── Storage Hook ─────────────────────────────────────────────────────
function usePlayerStorage(
  userId: string | null,
  collection: string,
  cursor?: string,
) {
  return useQuery({
    queryKey: ["admin", "player-storage", userId, collection, cursor],
    queryFn: () =>
      nakama.listStorageObjects(collection, {
        ...serverKeyAuth(),
        userId: userId!,
        limit: 20,
        cursor,
      }) as Promise<{ objects?: StorageObject[]; cursor?: string }>,
    enabled: !!userId && collection.length > 0,
    staleTime: 15_000,
  });
}

// ─── Clipboard Helper ─────────────────────────────────────────────────
function useCopyToClipboard() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, label?: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label ?? text);
    setTimeout(() => setCopied(null), 2000);
  }, []);
  return { copied, copy };
}

// ─── Format Helpers ───────────────────────────────────────────────────
function formatDate(iso: string) {
  if (!iso || iso === "1970-01-01T00:00:00Z") return "Never";
  return new Date(iso).toLocaleString();
}

function unwrapUser(row: NakamaUser | { user?: NakamaUser }): NakamaUser {
  return ("user" in row && row.user ? row.user : row) as NakamaUser;
}

function parseWallet(raw: string): Record<string, number> {
  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

// ─── Search Results Table ─────────────────────────────────────────────
function SearchResults({
  users,
  loading,
  onSelect,
}: {
  users: NakamaUser[];
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        No players found. Search by username or user ID.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Username
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Display Name
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              User ID
            </th>
            <th className="px-4 py-2.5 text-center font-medium text-muted-foreground">
              Online
            </th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
              Created
            </th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {users.map((row) => {
            const u = unwrapUser(row);
            const uid = u.user_id ?? u.id ?? "";
            return (
              <tr
                key={uid}
                onClick={() => uid && onSelect(uid)}
                className="cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-accent/50"
              >
                <td className="px-4 py-2.5 font-medium">{u.username}</td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {u.display_name || "—"}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {uid ? `${uid.slice(0, 18)}...` : "—"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={cn(
                      "inline-block h-2 w-2 rounded-full",
                      u.online ? "bg-green-500" : "bg-muted-foreground/30",
                    )}
                  />
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {formatDate(u.create_time ?? "")}
                </td>
                <td className="px-4 py-2.5">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Overview Tab ─────────────────────────────────────────────────────
function OverviewTab({ account }: { account: ConsoleAccount }) {
  const { copy, copied } = useCopyToClipboard();
  const isBanned =
    !!account.disable_time && account.disable_time !== "1970-01-01T00:00:00Z";

  return (
    <div className="space-y-6">
      {isBanned && (
        <div className="flex items-center gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <ShieldBan className="h-5 w-5 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive">
              Account Banned
            </p>
            <p className="text-xs text-muted-foreground">
              Disabled at {formatDate(account.disable_time)}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <InfoCard
          icon={User}
          label="Username"
          value={account.user.username}
          onCopy={() => copy(account.user.username, "username")}
          copied={copied === "username"}
        />
        <InfoCard
          icon={User}
          label="Display Name"
          value={account.user.display_name || "—"}
        />
        <InfoCard
          icon={Mail}
          label="Email"
          value={account.email || "—"}
          onCopy={account.email ? () => copy(account.email, "email") : undefined}
          copied={copied === "email"}
        />
        <InfoCard
          icon={Globe}
          label="Location"
          value={
            [account.user.location, account.user.timezone]
              .filter(Boolean)
              .join(" / ") || "—"
          }
        />
        <InfoCard
          icon={Clock}
          label="Created"
          value={formatDate(account.user.create_time)}
        />
        <InfoCard
          icon={Clock}
          label="Last Updated"
          value={formatDate(account.user.update_time)}
        />
        <InfoCard
          icon={Smartphone}
          label="Devices"
          value={
            account.devices?.length
              ? account.devices.map((d) => d.id).join(", ")
              : "None"
          }
        />
        <InfoCard
          icon={Globe}
          label="Language"
          value={account.user.lang_tag || "—"}
        />
      </div>

      {account.user.metadata &&
        Object.keys(account.user.metadata).length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-semibold">Metadata</h4>
            <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-muted/50 p-4 font-mono text-xs">
              {JSON.stringify(account.user.metadata, null, 2)}
            </pre>
          </div>
        )}
    </div>
  );
}

function InfoCard({
  icon: Icon,
  label,
  value,
  onCopy,
  copied,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
      <div className="rounded-md bg-primary/10 p-2">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-sm font-medium">{value}</p>
      </div>
      {onCopy && (
        <button
          onClick={onCopy}
          className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {copied ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  );
}

// ─── Wallet Tab ───────────────────────────────────────────────────────
function WalletTab({ account }: { account: ConsoleAccount }) {
  const wallet = useMemo(() => parseWallet(account.wallet), [account.wallet]);
  const qc = useQueryClient();

  const [grantCurrency, setGrantCurrency] = useState("");
  const [grantAmount, setGrantAmount] = useState("");

  const grantMutation = useMutation({
    mutationFn: () =>
      callRpc(
        "admin_wallet_grant",
        {
          user_id: account.user.user_id,
          currencies: { [grantCurrency]: Number(grantAmount) },
        },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["admin", "player-detail", account.user.user_id],
      });
      setGrantCurrency("");
      setGrantAmount("");
    },
  });

  const entries = Object.entries(wallet);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                Currency
              </th>
              <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={2}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  Wallet is empty
                </td>
              </tr>
            ) : (
              entries.map(([currency, amount]) => (
                <tr
                  key={currency}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2.5 font-medium capitalize">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-primary" />
                      {currency}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                    {Number(amount).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Grant Currency</h4>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Currency
            </label>
            <input
              type="text"
              placeholder="coins"
              value={grantCurrency}
              onChange={(e) => setGrantCurrency(e.target.value)}
              className="h-9 w-40 rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Amount
            </label>
            <input
              type="number"
              placeholder="100"
              value={grantAmount}
              onChange={(e) => setGrantAmount(e.target.value)}
              className="h-9 w-32 rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={() => grantMutation.mutate()}
            disabled={
              !grantCurrency.trim() ||
              !grantAmount ||
              Number(grantAmount) === 0 ||
              grantMutation.isPending
            }
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {grantMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            Grant
          </button>
        </div>
        {grantMutation.isError && (
          <p className="text-xs text-destructive">
            Grant failed — ensure{" "}
            <code className="rounded bg-muted px-1">admin_wallet_grant</code>{" "}
            RPC exists on the server.
          </p>
        )}
        {grantMutation.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Currency granted successfully.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Raw Wallet JSON</h4>
        <pre className="max-h-40 overflow-auto rounded-lg border border-border bg-muted/50 p-4 font-mono text-xs">
          {JSON.stringify(wallet, null, 2)}
        </pre>
      </div>
    </div>
  );
}

// ─── Inventory Tab ────────────────────────────────────────────────────
function InventoryTab({ userId }: { userId: string }) {
  const inventory = usePlayerInventory(userId);
  const qc = useQueryClient();

  const [grantItemId, setGrantItemId] = useState("");
  const [grantQty, setGrantQty] = useState("1");

  const grantMutation = useMutation({
    mutationFn: () =>
      callRpc(
        "admin_inventory_grant",
        { user_id: userId, id: grantItemId, count: Number(grantQty) },
        serverKeyAuth(),
      ),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["admin", "player-inventory", userId],
      });
      setGrantItemId("");
      setGrantQty("1");
    },
  });

  const items = useMemo(() => {
    if (!inventory.data) return [];
    const data = inventory.data as Record<string, unknown>;
    if (Array.isArray(data)) return data;
    if (data.items && Array.isArray(data.items)) return data.items;
    return Object.entries(data).map(([key, val]) => ({
      id: key,
      ...(typeof val === "object" && val !== null ? val : { value: val }),
    }));
  }, [inventory.data]);

  return (
    <div className="space-y-6">
      {inventory.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : inventory.isError ? (
        <div className="rounded-lg border border-dashed border-destructive/50 p-8 text-center text-sm text-muted-foreground">
          <p>
            Failed to load inventory — ensure{" "}
            <code className="rounded bg-muted px-1">admin_player_inspect</code>{" "}
            is registered.
          </p>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          Inventory is empty
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Item
                </th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground">
                  Count
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">
                  Details
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: Record<string, unknown>, idx: number) => (
                <tr
                  key={String(item.id ?? idx)}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-2.5 font-mono text-xs">
                    {String(item.id ?? item.item_id ?? "—")}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {String(item.count ?? item.quantity ?? "—")}
                  </td>
                  <td className="max-w-xs truncate px-4 py-2.5 text-xs text-muted-foreground">
                    {JSON.stringify(item).slice(0, 80)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Grant Item</h4>
        <div className="flex items-end gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Item ID
            </label>
            <input
              type="text"
              placeholder="sword_01"
              value={grantItemId}
              onChange={(e) => setGrantItemId(e.target.value)}
              className="h-9 w-48 rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Quantity
            </label>
            <input
              type="number"
              min={1}
              value={grantQty}
              onChange={(e) => setGrantQty(e.target.value)}
              className="h-9 w-24 rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
            />
          </div>
          <button
            onClick={() => grantMutation.mutate()}
            disabled={
              !grantItemId.trim() ||
              Number(grantQty) < 1 ||
              grantMutation.isPending
            }
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {grantMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Grant
          </button>
        </div>
        {grantMutation.isError && (
          <p className="text-xs text-destructive">
            Grant failed — ensure{" "}
            <code className="rounded bg-muted px-1">
              admin_inventory_grant
            </code>{" "}
            RPC exists on the server.
          </p>
        )}
        {grantMutation.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Item granted successfully.
          </p>
        )}
      </div>

      {inventory.data && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">Raw Inventory Data</h4>
          <pre className="max-h-60 overflow-auto rounded-lg border border-border bg-muted/50 p-4 font-mono text-xs">
            {JSON.stringify(inventory.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Storage Tab ──────────────────────────────────────────────────────
function StorageTab({ userId }: { userId: string }) {
  const [collection, setCollection] = useState("hiro_inventory");
  const [cursor, setCursor] = useState<string | undefined>();
  const storage = usePlayerStorage(userId, collection, cursor);

  const objects = (storage.data?.objects ?? []) as StorageObject[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Collection
          </label>
          <input
            type="text"
            value={collection}
            onChange={(e) => {
              setCollection(e.target.value);
              setCursor(undefined);
            }}
            className="h-9 w-64 rounded-md border border-border bg-card px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <div className="flex gap-1 pt-5">
          {[
            "hiro_inventory",
            "hiro_progression",
            "hiro_stats",
            "hiro_economy",
          ].map((c) => (
            <button
              key={c}
              onClick={() => {
                setCollection(c);
                setCursor(undefined);
              }}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                collection === c
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {c.replace("hiro_", "")}
            </button>
          ))}
        </div>
      </div>

      {storage.isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : storage.isError ? (
        <div className="rounded-lg border border-dashed border-destructive/50 p-8 text-center text-sm text-muted-foreground">
          Failed to load storage objects.
        </div>
      ) : objects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          No objects in <code className="rounded bg-muted px-1">{collection}</code>
        </div>
      ) : (
        <div className="space-y-3">
          {objects.map((obj) => (
            <details
              key={`${obj.collection}/${obj.key}`}
              className="group rounded-lg border border-border"
            >
              <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/50">
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
                <span className="font-mono text-xs font-medium">
                  {obj.key}
                </span>
                <span className="text-xs text-muted-foreground">
                  v{obj.version?.slice(0, 8)}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {formatDate(obj.update_time)}
                </span>
              </summary>
              <div className="border-t border-border p-4">
                <pre className="max-h-60 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs">
                  {JSON.stringify(obj.value, null, 2)}
                </pre>
              </div>
            </details>
          ))}
        </div>
      )}

      {storage.data?.cursor && (
        <div className="flex justify-center">
          <button
            onClick={() => setCursor(storage.data?.cursor)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Actions Tab ──────────────────────────────────────────────────────
function ActionsTab({ account }: { account: ConsoleAccount }) {
  const qc = useQueryClient();
  const userId = account.user.user_id;
  const isBanned =
    !!account.disable_time && account.disable_time !== "1970-01-01T00:00:00Z";

  const [confirmDelete, setConfirmDelete] = useState(false);

  const banMutation = useMutation({
    mutationFn: () => nakama.banUser(userId, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "player-detail", userId],
      }),
  });

  const unbanMutation = useMutation({
    mutationFn: () => nakama.unbanUser(userId, serverKeyAuth()),
    onSuccess: () =>
      qc.invalidateQueries({
        queryKey: ["admin", "player-detail", userId],
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => nakama.deleteAccount(userId, serverKeyAuth()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Account Actions</h4>

        <div className="grid gap-3 sm:grid-cols-2">
          {isBanned ? (
            <ActionCard
              icon={ShieldCheck}
              label="Unban Account"
              description="Restore this player's access to the game."
              variant="success"
              loading={unbanMutation.isPending}
              onClick={() => unbanMutation.mutate()}
            />
          ) : (
            <ActionCard
              icon={ShieldBan}
              label="Ban Account"
              description="Immediately disconnect and prevent this player from authenticating."
              variant="warning"
              loading={banMutation.isPending}
              onClick={() => banMutation.mutate()}
            />
          )}

          {!confirmDelete ? (
            <ActionCard
              icon={Trash2}
              label="Delete Account"
              description="Permanently remove this account and all associated data."
              variant="destructive"
              onClick={() => setConfirmDelete(true)}
            />
          ) : (
            <div className="flex flex-col gap-2 rounded-lg border border-destructive/50 bg-destructive/5 p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <p className="text-sm font-semibold text-destructive">
                  Confirm Deletion
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                This action is irreversible. All player data will be lost.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                  className="inline-flex h-8 items-center gap-2 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleteMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Yes, delete forever
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {(banMutation.isError || unbanMutation.isError) && (
          <p className="text-xs text-destructive">Action failed. Check server logs.</p>
        )}
        {(banMutation.isSuccess || unbanMutation.isSuccess) && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Account status updated.
          </p>
        )}
        {deleteMutation.isSuccess && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Account deleted. Use back arrow to return to search.
          </p>
        )}
        {deleteMutation.isError && (
          <p className="text-xs text-destructive">Delete failed. Check server logs.</p>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Player IDs</h4>
        <IdRow label="User ID" value={userId} />
        {account.custom_id && (
          <IdRow label="Custom ID" value={account.custom_id} />
        )}
        {account.email && <IdRow label="Email" value={account.email} />}
      </div>
    </div>
  );
}

function ActionCard({
  icon: Icon,
  label,
  description,
  variant,
  loading,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  description: string;
  variant: "warning" | "destructive" | "success";
  loading?: boolean;
  onClick: () => void;
}) {
  const colors = {
    warning:
      "border-yellow-500/30 hover:border-yellow-500/50 hover:bg-yellow-500/5",
    destructive:
      "border-destructive/30 hover:border-destructive/50 hover:bg-destructive/5",
    success:
      "border-green-500/30 hover:border-green-500/50 hover:bg-green-500/5",
  };
  const iconColors = {
    warning: "text-yellow-600 dark:text-yellow-400",
    destructive: "text-destructive",
    success: "text-green-600 dark:text-green-400",
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-4 text-left transition-all disabled:opacity-50",
        colors[variant],
      )}
    >
      {loading ? (
        <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-muted-foreground" />
      ) : (
        <Icon className={cn("mt-0.5 h-5 w-5", iconColors[variant])} />
      )}
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function IdRow({ label, value }: { label: string; value: string }) {
  const { copy, copied } = useCopyToClipboard();
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <code className="flex-1 truncate font-mono text-xs">{value}</code>
      <button
        onClick={() => copy(value, label)}
        className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {copied === label ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────
function PlayerDetail({
  userId,
  onBack,
}: {
  userId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const detail = useAccountDetail(userId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {detail.data && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
              {(
                detail.data.user.display_name ||
                detail.data.user.username ||
                "?"
              )
                .charAt(0)
                .toUpperCase()}
            </div>
            <div>
              <h3 className="text-lg font-bold">
                {detail.data.user.display_name || detail.data.user.username}
              </h3>
              <p className="font-mono text-xs text-muted-foreground">
                {userId}
              </p>
            </div>
            {detail.data.user.online && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
                Online
              </span>
            )}
          </div>
        )}

        {detail.isFetching && (
          <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              tab === id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {detail.isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : detail.isError ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <XCircle className="h-8 w-8 text-destructive" />
          <p className="text-sm text-muted-foreground">
            Failed to load player. They may have been deleted.
          </p>
        </div>
      ) : detail.data ? (
        <>
          {tab === "overview" && <OverviewTab account={detail.data} />}
          {tab === "wallet" && <WalletTab account={detail.data} />}
          {tab === "inventory" && <InventoryTab userId={userId} />}
          {tab === "storage" && <StorageTab userId={userId} />}
          {tab === "actions" && <ActionsTab account={detail.data} />}
        </>
      ) : null}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────
export function PlayersPage() {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const search = usePlayerSearch(searchTerm);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchTerm(query);
    setSelectedUserId(null);
  };

  if (selectedUserId) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Player Inspector
          </h2>
          <p className="text-muted-foreground">
            Search and inspect player profiles.
          </p>
        </div>
        <PlayerDetail
          userId={selectedUserId}
          onBack={() => setSelectedUserId(null)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Player Inspector
          </h2>
          <p className="text-muted-foreground">
            Search and inspect player profiles.
          </p>
        </div>
        {search.isFetching && (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username or user ID (UUID)..."
            className="h-10 w-full rounded-md border border-border bg-card pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary/20"
          />
        </div>
        <button
          type="submit"
          disabled={!query.trim()}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <Search className="h-4 w-4" />
          Search
        </button>
        {searchTerm && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setSearchTerm("");
            }}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            Clear
          </button>
        )}
      </form>

      <p className="text-xs text-muted-foreground/70">
        {searchTerm
          ? `Results for "${searchTerm}"`
          : "Showing recent players — search by username or UUID to filter."}
      </p>
      <SearchResults
        users={search.data ?? []}
        loading={search.isLoading}
        onSelect={setSelectedUserId}
      />
    </div>
  );
}


export default PlayersPage;
