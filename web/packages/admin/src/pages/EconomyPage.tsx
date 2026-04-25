import { useState, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  serverKeyAuth,
  nakama,
  hiro,
  callRpc,
} from "@nakama/shared";
import type {
  NakamaUser,
  ConsoleAccount,
  WalletBalance,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  Wallet,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  ChevronDown,
  ChevronUp,
  DollarSign,
  Coins,
  Package,
  ShoppingCart,
  FileText,
  ArrowUpDown,
  Plus,
  Minus,
  Send,
  Copy,
  Check,
  Eye,
  Gem,
  TrendingUp,
  BarChart3,
  Clock,
  User,
  Shield,
  Hash,
  Settings,
  Download,
  Trash2,
  History,
} from "lucide-react";

const REFETCH_MS = 30_000;

type Tab = "overview" | "wallets" | "store" | "transactions" | "audit";

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  detail: string;
  status: "success" | "error";
}

interface StoreItem {
  id: string;
  name?: string;
  description?: string;
  cost?: Record<string, number>;
  reward?: Record<string, unknown>;
  category?: string;
  available?: boolean;
  [key: string]: unknown;
}

interface CurrencyDef {
  id: string;
  name?: string;
  max?: number;
  [key: string]: unknown;
}

interface EconomyConfig {
  currencies?: Record<string, CurrencyDef>;
  store_items?: Record<string, StoreItem>;
  donations?: Record<string, unknown>;
  [key: string]: unknown;
}

interface StoreConfig {
  items?: Record<string, StoreItem>;
  sections?: Record<string, { items?: Record<string, StoreItem>; [k: string]: unknown }>;
  [key: string]: unknown;
}

function parseWallet(raw: string | undefined): WalletBalance {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as WalletBalance;
  } catch {
    return {};
  }
}

function fmtCurrency(v: number | undefined): string {
  if (v === undefined || v === null) return "0";
  return v.toLocaleString();
}

function fmtDate(d: string): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ─── data hooks ─── */

function useAccountList() {
  return useQuery({
    queryKey: ["economy", "accounts"],
    queryFn: () =>
      nakama.listAccounts(undefined, 100, serverKeyAuth()) as Promise<{
        users: ConsoleAccount[];
        total_count?: number;
      }>,
    refetchInterval: REFETCH_MS,
    staleTime: 10_000,
  });
}

function useAccountById(userId: string | null) {
  return useQuery({
    queryKey: ["economy", "account", userId],
    queryFn: () => nakama.getAccountById(userId!, serverKeyAuth()),
    enabled: !!userId,
  });
}

function useEconomyConfig() {
  return useQuery({
    queryKey: ["economy", "config"],
    queryFn: () =>
      hiro.getHiroConfig("economy", serverKeyAuth()) as Promise<EconomyConfig>,
    staleTime: 30_000,
  });
}

function useStoreConfig() {
  return useQuery({
    queryKey: ["economy", "storeConfig"],
    queryFn: () =>
      hiro.getHiroConfig("store", serverKeyAuth()) as Promise<StoreConfig>,
    staleTime: 30_000,
  });
}

function useStoreItems() {
  return useQuery({
    queryKey: ["economy", "storeItems"],
    queryFn: () =>
      hiro.listStore(serverKeyAuth()) as Promise<{
        items?: StoreItem[];
        [k: string]: unknown;
      }>,
    staleTime: 30_000,
  });
}

function useIapRecords(userId: string | null) {
  return useQuery({
    queryKey: ["economy", "iap", userId],
    queryFn: () =>
      nakama.listStorageObjects("iap_receipts", userId!, undefined, 100, serverKeyAuth()),
    enabled: !!userId,
  });
}

function usePurchaseHistory(userId: string | null) {
  return useQuery({
    queryKey: ["economy", "purchases", userId],
    queryFn: () =>
      nakama.listStorageObjects("purchase_history", userId!, undefined, 100, serverKeyAuth()),
    enabled: !!userId,
  });
}

/* ─── reusable components ─── */

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs font-medium">
        <Icon className={cn("h-3.5 w-3.5", accent)} />
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TabBtn({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted-foreground hover:text-foreground transition-colors"
      title="Copy"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function WalletBadge({ currency, amount }: { currency: string; amount: number }) {
  const icon =
    currency === "gems" ? (
      <Gem className="h-3 w-3 text-purple-400" />
    ) : currency === "coins" ? (
      <Coins className="h-3 w-3 text-yellow-500" />
    ) : (
      <DollarSign className="h-3 w-3 text-green-500" />
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
      {icon}
      {fmtCurrency(amount)} {currency}
    </span>
  );
}

/* ─── tab: overview ─── */

function OverviewTab({
  accounts,
  economyConfig,
  storeConfig,
}: {
  accounts: ConsoleAccount[];
  economyConfig: EconomyConfig | undefined;
  storeConfig: StoreConfig | undefined;
}) {
  const wallets = useMemo(
    () => accounts.map((a) => ({ user: a.user, wallet: parseWallet(a.wallet) })),
    [accounts],
  );

  const allCurrencies = useMemo(() => {
    const currencies = new Set<string>();
    for (const w of wallets) {
      for (const k of Object.keys(w.wallet)) currencies.add(k);
    }
    return Array.from(currencies);
  }, [wallets]);

  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const c of allCurrencies) t[c] = 0;
    for (const w of wallets) {
      for (const c of allCurrencies) {
        t[c] += w.wallet[c] ?? 0;
      }
    }
    return t;
  }, [wallets, allCurrencies]);

  const topHolders = useMemo(() => {
    const scored = wallets.map((w) => ({
      ...w,
      totalValue: Object.values(w.wallet).reduce((s, v) => s + (v ?? 0), 0),
    }));
    return scored.sort((a, b) => b.totalValue - a.totalValue).slice(0, 10);
  }, [wallets]);

  const configCurrencies = economyConfig?.currencies
    ? Object.entries(economyConfig.currencies)
    : [];

  const storeItemCount = storeConfig?.items
    ? Object.keys(storeConfig.items).length
    : storeConfig?.sections
      ? Object.values(storeConfig.sections).reduce(
          (n, s) => n + (s.items ? Object.keys(s.items).length : 0),
          0,
        )
      : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Wallets Sampled"
          value={wallets.length}
          icon={Wallet}
          sub="active accounts"
          accent="text-blue-500"
        />
        <StatCard
          label="Currencies Tracked"
          value={allCurrencies.length}
          icon={Coins}
          sub={allCurrencies.join(", ") || "none"}
          accent="text-yellow-500"
        />
        <StatCard
          label="Store Items"
          value={storeItemCount}
          icon={ShoppingCart}
          sub="in config"
          accent="text-green-500"
        />
        <StatCard
          label="Config Currencies"
          value={configCurrencies.length}
          icon={Settings}
          sub="defined in economy"
          accent="text-purple-500"
        />
      </div>

      {allCurrencies.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Currency Circulation
          </div>
          <div className="divide-y divide-border">
            {allCurrencies.map((c) => {
              const avg = wallets.length ? Math.round(totals[c] / wallets.length) : 0;
              const max = wallets.reduce((m, w) => Math.max(m, w.wallet[c] ?? 0), 0);
              return (
                <div key={c} className="grid grid-cols-4 gap-4 px-4 py-3 text-sm">
                  <div className="font-medium capitalize">{c}</div>
                  <div className="text-muted-foreground">
                    Total: <span className="text-foreground font-medium">{fmtCurrency(totals[c])}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Avg: <span className="text-foreground font-medium">{fmtCurrency(avg)}</span>
                  </div>
                  <div className="text-muted-foreground">
                    Max: <span className="text-foreground font-medium">{fmtCurrency(max)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {topHolders.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            Top 10 Wallet Holders
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Player</th>
                  {allCurrencies.map((c) => (
                    <th key={c} className="px-4 py-2 font-medium capitalize">{c}</th>
                  ))}
                  <th className="px-4 py-2 font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {topHolders.map((h, i) => (
                  <tr key={h.user.id} className="hover:bg-muted/50">
                    <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">
                        {h.user.display_name || h.user.username || "—"}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono">{h.user.id?.slice(0, 8)}…</div>
                    </td>
                    {allCurrencies.map((c) => (
                      <td key={c} className="px-4 py-2 font-medium">{fmtCurrency(h.wallet[c])}</td>
                    ))}
                    <td className="px-4 py-2 font-bold">{fmtCurrency(h.totalValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {configCurrencies.length > 0 && (
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            Currency Definitions (Economy Config)
          </div>
          <div className="divide-y divide-border">
            {configCurrencies.map(([k, v]) => (
              <div key={k} className="flex items-center gap-4 px-4 py-3 text-sm">
                <span className="font-medium capitalize">{v.name ?? k}</span>
                <span className="text-muted-foreground font-mono text-xs">{k}</span>
                {v.max && (
                  <span className="text-xs text-muted-foreground">
                    max: {fmtCurrency(v.max)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── tab: wallets ─── */

function WalletsTab({
  accounts,
  addAudit,
}: {
  accounts: ConsoleAccount[];
  addAudit: (e: Omit<AuditEntry, "id" | "timestamp">) => void;
}) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grantCurrency, setGrantCurrency] = useState("coins");
  const [grantAmount, setGrantAmount] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const detailQ = useAccountById(selectedId);

  const grantMut = useMutation({
    mutationFn: async ({
      userId,
      currency,
      amount,
    }: {
      userId: string;
      currency: string;
      amount: number;
    }) => {
      return hiro.hiroRpc(
        "economy",
        "grant",
        { currencies: { [currency]: amount }, user_id: userId },
        serverKeyAuth(),
      );
    },
    onSuccess: (_d, vars) => {
      addAudit({
        action: "grant_currency",
        target: vars.userId,
        detail: `+${vars.amount} ${vars.currency}`,
        status: "success",
      });
      qc.invalidateQueries({ queryKey: ["economy"] });
    },
    onError: (_e, vars) => {
      addAudit({
        action: "grant_currency",
        target: vars.userId,
        detail: `Failed: +${vars.amount} ${vars.currency}`,
        status: "error",
      });
    },
  });

  const deductMut = useMutation({
    mutationFn: async ({
      userId,
      currency,
      amount,
    }: {
      userId: string;
      currency: string;
      amount: number;
    }) => {
      return hiro.hiroRpc(
        "economy",
        "grant",
        { currencies: { [currency]: -amount }, user_id: userId },
        serverKeyAuth(),
      );
    },
    onSuccess: (_d, vars) => {
      addAudit({
        action: "deduct_currency",
        target: vars.userId,
        detail: `−${vars.amount} ${vars.currency}`,
        status: "success",
      });
      qc.invalidateQueries({ queryKey: ["economy"] });
    },
    onError: (_e, vars) => {
      addAudit({
        action: "deduct_currency",
        target: vars.userId,
        detail: `Failed: −${vars.amount} ${vars.currency}`,
        status: "error",
      });
    },
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return accounts;
    const q = search.toLowerCase();
    return accounts.filter(
      (a) =>
        a.user.id?.toLowerCase().includes(q) ||
        a.user.username?.toLowerCase().includes(q) ||
        a.user.display_name?.toLowerCase().includes(q),
    );
  }, [accounts, search]);

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const selectedWallet = detailQ.data ? parseWallet(detailQ.data.wallet) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by username, display name, or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* player list */}
        <div className="lg:col-span-2 rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            Player Wallets ({filtered.length})
          </div>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
            {filtered.length === 0 && (
              <div className="px-4 py-12 text-center text-muted-foreground text-sm">
                No players found
              </div>
            )}
            {filtered.map((acct) => {
              const w = parseWallet(acct.wallet);
              const currencies = Object.entries(w).filter(([, v]) => v !== undefined);
              const isExpanded = expanded.has(acct.user.id);
              const isSelected = selectedId === acct.user.id;
              return (
                <div
                  key={acct.user.id}
                  className={cn(
                    "px-4 py-3 cursor-pointer transition-colors",
                    isSelected ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-muted/50",
                  )}
                  onClick={() => setSelectedId(acct.user.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">
                        {acct.user.display_name || acct.user.username || "—"}
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="font-mono">{acct.user.id?.slice(0, 12)}…</span>
                        <CopyButton text={acct.user.id} />
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleExpand(acct.user.id);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {currencies.length === 0 && (
                      <span className="text-xs text-muted-foreground italic">Empty wallet</span>
                    )}
                    {currencies.map(([k, v]) => (
                      <WalletBadge key={k} currency={k} amount={v!} />
                    ))}
                  </div>
                  {isExpanded && (
                    <div className="mt-2 rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(w, null, 2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* selected player detail + grant */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            Wallet Actions
          </div>
          {!selectedId && (
            <div className="px-4 py-12 text-center text-muted-foreground text-sm">
              Select a player to inspect and manage their wallet
            </div>
          )}
          {selectedId && detailQ.isLoading && (
            <div className="flex items-center justify-center px-4 py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {selectedId && selectedWallet && (
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs text-muted-foreground font-medium mb-1">Player</div>
                <div className="font-medium text-sm">
                  {detailQ.data?.user.display_name || detailQ.data?.user.username || "—"}
                </div>
                <div className="text-xs text-muted-foreground font-mono">{selectedId}</div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground font-medium mb-2">Balances</div>
                <div className="space-y-1">
                  {Object.entries(selectedWallet)
                    .filter(([, v]) => v !== undefined)
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between text-sm">
                        <span className="capitalize">{k}</span>
                        <span className="font-bold">{fmtCurrency(v)}</span>
                      </div>
                    ))}
                  {Object.keys(selectedWallet).length === 0 && (
                    <div className="text-xs text-muted-foreground italic">No currencies</div>
                  )}
                </div>
              </div>

              <hr className="border-border" />

              <div>
                <div className="text-xs text-muted-foreground font-medium mb-2">
                  Grant / Deduct Currency
                </div>
                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Currency name (e.g. coins)"
                    value={grantCurrency}
                    onChange={(e) => setGrantCurrency(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <input
                    type="number"
                    placeholder="Amount"
                    value={grantAmount}
                    onChange={(e) => setGrantAmount(e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  />
                  <div className="flex gap-2">
                    <button
                      disabled={!grantAmount || grantMut.isPending || deductMut.isPending}
                      onClick={() => {
                        const amt = parseInt(grantAmount, 10);
                        if (!amt || amt <= 0) return;
                        grantMut.mutate({
                          userId: selectedId,
                          currency: grantCurrency,
                          amount: amt,
                        });
                        setGrantAmount("");
                      }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium",
                        "bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {grantMut.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      Grant
                    </button>
                    <button
                      disabled={!grantAmount || grantMut.isPending || deductMut.isPending}
                      onClick={() => {
                        const amt = parseInt(grantAmount, 10);
                        if (!amt || amt <= 0) return;
                        deductMut.mutate({
                          userId: selectedId,
                          currency: grantCurrency,
                          amount: amt,
                        });
                        setGrantAmount("");
                      }}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium",
                        "bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed",
                      )}
                    >
                      {deductMut.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Minus className="h-3.5 w-3.5" />
                      )}
                      Deduct
                    </button>
                  </div>
                  {(grantMut.isSuccess || deductMut.isSuccess) && (
                    <div className="rounded bg-green-500/10 px-2 py-1 text-xs text-green-600">
                      Operation completed
                    </div>
                  )}
                  {(grantMut.isError || deductMut.isError) && (
                    <div className="rounded bg-red-500/10 px-2 py-1 text-xs text-red-600">
                      {(grantMut.error || deductMut.error)?.message ?? "Operation failed"}
                    </div>
                  )}
                </div>
              </div>

              <hr className="border-border" />

              <div>
                <div className="text-xs text-muted-foreground font-medium mb-2">Raw Wallet JSON</div>
                <div className="rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                  {JSON.stringify(selectedWallet, null, 2)}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── tab: store ─── */

function StoreTab({
  storeConfig,
  storeItems,
}: {
  storeConfig: StoreConfig | undefined;
  storeItems: { items?: StoreItem[]; [k: string]: unknown } | undefined;
}) {
  const [search, setSearch] = useState("");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const configItems = useMemo(() => {
    const items: StoreItem[] = [];
    if (storeConfig?.items) {
      for (const [id, item] of Object.entries(storeConfig.items)) {
        items.push({ ...item, id });
      }
    }
    if (storeConfig?.sections) {
      for (const [sectionId, section] of Object.entries(storeConfig.sections)) {
        if (section.items) {
          for (const [id, item] of Object.entries(section.items)) {
            items.push({ ...item, id, category: sectionId });
          }
        }
      }
    }
    return items;
  }, [storeConfig]);

  const runtimeItems = storeItems?.items ?? [];

  const allItems = configItems.length > 0 ? configItems : runtimeItems;

  const filtered = useMemo(() => {
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter(
      (i) =>
        i.id?.toLowerCase().includes(q) ||
        i.name?.toLowerCase().includes(q) ||
        i.category?.toLowerCase().includes(q),
    );
  }, [allItems, search]);

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search store items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground text-sm">
          {allItems.length === 0
            ? "No store items configured. Add items to the Hiro store config."
            : "No items match your search."}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
            Store Items ({filtered.length})
          </div>
          <div className="divide-y divide-border">
            {filtered.map((item) => {
              const isExpanded = expandedItem === item.id;
              const costEntries = item.cost ? Object.entries(item.cost) : [];
              return (
                <div key={item.id} className="px-4 py-3">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setExpandedItem(isExpanded ? null : item.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="font-medium text-sm">{item.name ?? item.id}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.category && <span className="mr-2">{item.category}</span>}
                          <span className="font-mono">{item.id}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {costEntries.map(([c, v]) => (
                        <WalletBadge key={c} currency={c} amount={v} />
                      ))}
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="mt-2 rounded bg-muted/50 p-3 text-xs font-mono whitespace-pre-wrap break-all">
                      {JSON.stringify(item, null, 2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── tab: transactions ─── */

function TransactionsTab({ accounts }: { accounts: ConsoleAccount[] }) {
  const [userId, setUserId] = useState("");
  const [txTab, setTxTab] = useState<"iap" | "purchases">("iap");

  const resolvedUserId = useMemo(() => {
    if (!userId.trim()) return null;
    const match = accounts.find(
      (a) =>
        a.user.id === userId.trim() ||
        a.user.username?.toLowerCase() === userId.trim().toLowerCase(),
    );
    return match?.user.id ?? userId.trim();
  }, [userId, accounts]);

  const iap = useIapRecords(txTab === "iap" ? resolvedUserId : null);
  const purchases = usePurchaseHistory(txTab === "purchases" ? resolvedUserId : null);

  const activeQ = txTab === "iap" ? iap : purchases;
  const records = (activeQ.data as { objects?: Array<{ collection: string; key: string; value: string; version: string; user_id: string; create_time: string; update_time: string }> })?.objects ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Enter player ID or username to view transactions…"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded-md border border-input bg-background pl-9 pr-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setTxTab("iap")}
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium",
              txTab === "iap" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            IAP Receipts
          </button>
          <button
            onClick={() => setTxTab("purchases")}
            className={cn(
              "px-3 py-2 rounded-md text-sm font-medium",
              txTab === "purchases"
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground",
            )}
          >
            Purchases
          </button>
        </div>
      </div>

      {!resolvedUserId && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground text-sm">
          Enter a player ID or username to view their transaction history
        </div>
      )}

      {resolvedUserId && activeQ.isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {resolvedUserId && activeQ.isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          Failed to load transactions. The collection may not exist yet.
        </div>
      )}

      {resolvedUserId && !activeQ.isLoading && !activeQ.isError && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {txTab === "iap" ? "IAP Receipts" : "Purchase History"} ({records.length})
          </div>
          {records.length === 0 ? (
            <div className="px-4 py-12 text-center text-muted-foreground text-sm">
              No {txTab === "iap" ? "IAP receipts" : "purchase records"} found for this player
            </div>
          ) : (
            <div className="divide-y divide-border">
              {records.map((r) => {
                let parsed: Record<string, unknown> = {};
                try {
                  parsed = JSON.parse(r.value);
                } catch {
                  /* noop */
                }
                return (
                  <div key={r.key} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm font-mono">{r.key}</div>
                        <div className="text-xs text-muted-foreground">{fmtDate(r.create_time)}</div>
                      </div>
                      <CopyButton text={r.value} />
                    </div>
                    <div className="mt-1 rounded bg-muted/50 p-2 text-xs font-mono whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                      {JSON.stringify(parsed, null, 2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── tab: audit ─── */

function AuditTab({ entries }: { entries: AuditEntry[] }) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    [entries],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="border-b border-border px-4 py-3 font-medium text-sm flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          Economy Operations Audit Log ({sorted.length})
        </div>
        {sorted.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground text-sm">
            No operations recorded yet. Actions performed in the Wallets tab will appear here.
          </div>
        ) : (
          <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
            {sorted.map((e) => (
              <div key={e.id} className="flex items-start gap-3 px-4 py-3">
                <div
                  className={cn(
                    "mt-0.5 h-2 w-2 rounded-full shrink-0",
                    e.status === "success" ? "bg-green-500" : "bg-red-500",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{e.action}</span>
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      e.status === "success"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-red-500/10 text-red-600",
                    )}>
                      {e.status}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Target: <span className="font-mono">{e.target.slice(0, 16)}…</span>
                    <span className="mx-1">·</span>
                    {e.detail}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{fmtDate(e.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-xs text-muted-foreground">
          <Shield className="inline h-3.5 w-3.5 mr-1" />
          This audit log is maintained client-side during your session. For a persistent audit trail,
          integrate server-side logging via Nakama storage objects or an external analytics pipeline.
        </div>
      </div>
    </div>
  );
}

/* ─── main page ─── */

export function EconomyPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);

  const accountsQ = useAccountList();
  const economyConfigQ = useEconomyConfig();
  const storeConfigQ = useStoreConfig();
  const storeItemsQ = useStoreItems();
  const qc = useQueryClient();

  const accounts = (accountsQ.data?.users ?? []) as ConsoleAccount[];

  const addAudit = useCallback(
    (e: Omit<AuditEntry, "id" | "timestamp">) => {
      setAuditLog((prev) => [
        { ...e, id: genId(), timestamp: new Date().toISOString() },
        ...prev,
      ]);
    },
    [],
  );

  const isLoading =
    accountsQ.isLoading ||
    economyConfigQ.isLoading ||
    storeConfigQ.isLoading;

  const isError = accountsQ.isError;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["economy"] });
  };

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Economy</h2>
          <p className="text-muted-foreground">
            Wallet management, store config, IAP validation &amp; audit trail
          </p>
        </div>
        <button
          onClick={refresh}
          className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium hover:bg-muted/80 transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", isLoading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1">
        <TabBtn active={tab === "overview"} label="Overview" icon={BarChart3} onClick={() => setTab("overview")} />
        <TabBtn active={tab === "wallets"} label="Wallets" icon={Wallet} onClick={() => setTab("wallets")} />
        <TabBtn active={tab === "store"} label="Store" icon={ShoppingCart} onClick={() => setTab("store")} />
        <TabBtn active={tab === "transactions"} label="Transactions" icon={FileText} onClick={() => setTab("transactions")} />
        <TabBtn
          active={tab === "audit"}
          label={`Audit${auditLog.length > 0 ? ` (${auditLog.length})` : ""}`}
          icon={Shield}
          onClick={() => setTab("audit")}
        />
      </div>

      {/* loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Loading economy data…</span>
        </div>
      )}

      {/* error */}
      {isError && !isLoading && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950 dark:text-red-400">
          <AlertTriangle className="inline h-4 w-4 mr-1" />
          Failed to load economy data. Check your Nakama connection and server key.
        </div>
      )}

      {/* content */}
      {!isLoading && !isError && (
        <>
          {tab === "overview" && (
            <OverviewTab
              accounts={accounts}
              economyConfig={economyConfigQ.data}
              storeConfig={storeConfigQ.data}
            />
          )}
          {tab === "wallets" && <WalletsTab accounts={accounts} addAudit={addAudit} />}
          {tab === "store" && (
            <StoreTab storeConfig={storeConfigQ.data} storeItems={storeItemsQ.data as { items?: StoreItem[] } | undefined} />
          )}
          {tab === "transactions" && <TransactionsTab accounts={accounts} />}
          {tab === "audit" && <AuditTab entries={auditLog} />}
        </>
      )}
    </div>
  );
}

export { EconomyPage as default };

export default EconomyPage;
