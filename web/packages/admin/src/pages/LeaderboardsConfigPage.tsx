import { useState, useMemo, useCallback } from "react";
import { useScopedGameId } from "@/hooks/useScopedGame";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Trophy,
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
  ChevronDown,
  ChevronUp,
  Swords,
  Timer,
  Crown,
  Medal,
  Hash,
  ArrowUpDown,
  ListOrdered,
  BarChart3,
  Clock,
  CalendarDays,
  Gamepad2,
  Send,
  Database,
} from "lucide-react";
import {
  serverKeyAuth,
  hiro,
  nakama,
  satori,
  type Audience,
  type Leaderboard,
  type Tournament,
  type LeaderboardRecord,
  type LeaderboardRecordList,
  type TournamentList,
  type TournamentRecordList,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const GLOBAL_CONFIG_SCOPE = "global";

function rpcGameId(scope: string) {
  const trimmed = scope.trim();
  return trimmed && trimmed !== GLOBAL_CONFIG_SCOPE ? trimmed : undefined;
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EventLbReward {
  currencies?: Record<string, number>;
  items?: Array<{ id: string; count: number }>;
  energies?: Record<string, number>;
  xp?: number;
}

interface EventLbTier {
  rank_min: number;
  rank_max: number;
  reward: EventLbReward;
}

interface EventLbDef {
  id: string;
  name: string;
  description?: string;
  category?: string;
  sort_order?: number;
  operator?: string;
  reset_schedule?: string;
  authoritative?: boolean;
  max_size?: number;
  max_num_score?: number;
  start_time_sec?: number;
  end_time_sec?: number;
  duration_sec?: number;
  rewards?: EventLbReward[];
  tiers?: EventLbTier[];
  audiences?: string[];
  disabled?: boolean;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface EventLbConfig {
  event_leaderboards?: Record<string, EventLbDef>;
  [key: string]: unknown;
}

type TabId = "event-leaderboards" | "tournaments" | "records";

const TABS: { id: TabId; label: string; icon: typeof Trophy }[] = [
  { id: "event-leaderboards", label: "Event Leaderboards", icon: BarChart3 },
  { id: "tournaments", label: "Tournaments", icon: Swords },
  { id: "records", label: "Records Browser", icon: Database },
];

const OPERATORS = [
  { value: "best", label: "Best" },
  { value: "set", label: "Set" },
  { value: "incr", label: "Increment" },
  { value: "decr", label: "Decrement" },
];

const SORT_ORDERS = [
  { value: 0, label: "Descending (highest first)" },
  { value: 1, label: "Ascending (lowest first)" },
];

const COMMON_SCHEDULES = [
  { value: "", label: "Never (permanent)" },
  { value: "0 0 * * 1", label: "Weekly (Monday midnight)" },
  { value: "0 0 1 * *", label: "Monthly (1st midnight)" },
  { value: "0 0 * * *", label: "Daily (midnight)" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function genId() {
  return `lb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function fmtTime(ts?: string | number) {
  if (!ts) return "—";
  const d = typeof ts === "number" ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDuration(sec?: number) {
  if (!sec) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${Math.round(sec / 3600)}h`;
  return `${Math.round(sec / 86400)}d`;
}

function rewardSummary(r?: EventLbReward): string {
  if (!r) return "—";
  const parts: string[] = [];
  if (r.currencies) {
    for (const [k, v] of Object.entries(r.currencies)) parts.push(`${v} ${k}`);
  }
  if (r.items) {
    for (const i of r.items) parts.push(`${i.count}× ${i.id}`);
  }
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts.length ? parts.join(", ") : "—";
}

const auth = () => serverKeyAuth();

/* ------------------------------------------------------------------ */
/*  Event Leaderboard Form                                             */
/* ------------------------------------------------------------------ */

function EventLbForm({
  initial,
  audiences,
  onSave,
  onCancel,
  saving,
}: {
  initial?: EventLbDef;
  audiences: Audience[];
  onSave: (def: EventLbDef) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<EventLbDef>(
    initial ?? {
      id: genId(),
      name: "",
      description: "",
      category: "",
      sort_order: 0,
      operator: "best",
      reset_schedule: "",
      authoritative: true,
      max_size: 100,
      max_num_score: 1,
      disabled: false,
      audiences: [],
      tiers: [],
    },
  );

  const [tierDraft, setTierDraft] = useState({ rank_min: 1, rank_max: 1, coins: 0 });
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = useCallback(
    <K extends keyof EventLbDef>(k: K, v: EventLbDef[K]) =>
      setForm((p) => ({ ...p, [k]: v })),
    [],
  );

  const addTier = () => {
    const reward: EventLbReward = { currencies: { coins: tierDraft.coins } };
    set("tiers", [
      ...(form.tiers ?? []),
      { rank_min: tierDraft.rank_min, rank_max: tierDraft.rank_max, reward },
    ]);
    setTierDraft({ rank_min: (form.tiers?.length ?? 0) + 2, rank_max: (form.tiers?.length ?? 0) + 5, coins: 0 });
  };

  const removeTier = (i: number) => {
    set("tiers", (form.tiers ?? []).filter((_, idx) => idx !== i));
  };

  const toggleAudience = (id: string) => {
    const cur = form.audiences ?? [];
    set("audiences", cur.includes(id) ? cur.filter((a) => a !== id) : [...cur, id]);
  };

  return (
    <div className="space-y-5 rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {initial ? "Edit Event Leaderboard" : "New Event Leaderboard"}
        </h3>
        <button onClick={onCancel} className="rounded p-1 hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* core fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">ID</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.id}
            onChange={(e) => set("id", e.target.value)}
            disabled={!!initial}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name *</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Weekly High Score"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Description</label>
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            rows={2}
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.category ?? ""}
            onChange={(e) => set("category", e.target.value)}
            placeholder="competitive"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Operator</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.operator ?? "best"}
            onChange={(e) => set("operator", e.target.value)}
          >
            {OPERATORS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Sort Order</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.sort_order ?? 0}
            onChange={(e) => set("sort_order", Number(e.target.value))}
          >
            {SORT_ORDERS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Reset Schedule</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.reset_schedule ?? ""}
            onChange={(e) => set("reset_schedule", e.target.value)}
          >
            {COMMON_SCHEDULES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        Advanced Settings
      </button>

      {showAdvanced && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Size</label>
            <input
              type="number"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.max_size ?? 100}
              onChange={(e) => set("max_size", Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Max Submissions</label>
            <input
              type="number"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.max_num_score ?? 1}
              onChange={(e) => set("max_num_score", Number(e.target.value))}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Duration (sec)</label>
            <input
              type="number"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.duration_sec ?? 0}
              onChange={(e) => set("duration_sec", Number(e.target.value))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.authoritative ?? true}
              onChange={(e) => set("authoritative", e.target.checked)}
              className="rounded"
            />
            Authoritative (server-validated)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.disabled ?? false}
              onChange={(e) => set("disabled", e.target.checked)}
              className="rounded"
            />
            Disabled
          </label>
        </div>
      )}

      {/* reward tiers */}
      <div>
        <h4 className="mb-2 text-sm font-medium">Reward Tiers</h4>
        {(form.tiers ?? []).length > 0 && (
          <div className="mb-3 space-y-1">
            {form.tiers!.map((t, i) => (
              <div key={i} className="flex items-center gap-2 rounded bg-muted/50 px-3 py-1.5 text-sm">
                <Medal className="h-3.5 w-3.5 text-amber-500" />
                <span>Rank {t.rank_min}–{t.rank_max}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-muted-foreground">{rewardSummary(t.reward)}</span>
                <button onClick={() => removeTier(i)} className="ml-auto rounded p-0.5 hover:bg-destructive/20">
                  <X className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">Min Rank</label>
            <input
              type="number"
              min={1}
              className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={tierDraft.rank_min}
              onChange={(e) => setTierDraft((p) => ({ ...p, rank_min: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">Max Rank</label>
            <input
              type="number"
              min={1}
              className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={tierDraft.rank_max}
              onChange={(e) => setTierDraft((p) => ({ ...p, rank_max: Number(e.target.value) }))}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">Coins</label>
            <input
              type="number"
              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={tierDraft.coins}
              onChange={(e) => setTierDraft((p) => ({ ...p, coins: Number(e.target.value) }))}
            />
          </div>
          <button
            onClick={addTier}
            className="rounded-md bg-primary/10 px-3 py-1 text-sm font-medium text-primary hover:bg-primary/20"
          >
            <Plus className="mr-1 inline h-3 w-3" /> Add Tier
          </button>
        </div>
      </div>

      {/* audiences */}
      {audiences.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-medium">Audience Targeting</h4>
          <div className="flex flex-wrap gap-2">
            {audiences.map((a) => {
              const selected = (form.audiences ?? []).includes(a.id);
              return (
                <button
                  key={a.id}
                  onClick={() => toggleAudience(a.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    selected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80",
                  )}
                >
                  {a.name || a.id}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* actions */}
      <div className="flex items-center gap-2 border-t border-border pt-4">
        <button
          disabled={!form.name.trim() || saving}
          onClick={() => onSave(form)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {initial ? "Update" : "Create"}
        </button>
        <button onClick={onCancel} className="rounded-md px-4 py-2 text-sm text-muted-foreground hover:bg-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Leaderboards Tab                                             */
/* ------------------------------------------------------------------ */

function EventLeaderboardsTab() {
  const qc = useQueryClient();
  const gameScope = useScopedGameId() ?? GLOBAL_CONFIG_SCOPE;
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<EventLbDef | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "disabled">("all");

  const configQ = useQuery({
    queryKey: ["hiro-config", "event_leaderboards", gameScope],
    queryFn: () => hiro.getHiroConfig("event_leaderboards", auth(), rpcGameId(gameScope)) as Promise<EventLbConfig>,
  });

  const audienceQ = useQuery({
    queryKey: ["satori-audiences", gameScope],
    queryFn: () => satori.listAudiences(auth(), rpcGameId(gameScope)) as Promise<{ audiences: Audience[] }>,
  });

  const audiences = audienceQ.data?.audiences ?? [];

  const saveMut = useMutation({
    mutationFn: async (cfg: EventLbConfig) => {
      await hiro.setHiroConfig("event_leaderboards", cfg, auth(), rpcGameId(gameScope));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiro-config", "event_leaderboards", gameScope] }),
  });

  const lbs = useMemo(() => {
    const map = configQ.data?.event_leaderboards ?? {};
    let arr = Object.values(map);

    if (statusFilter === "enabled") arr = arr.filter((lb) => !lb.disabled);
    if (statusFilter === "disabled") arr = arr.filter((lb) => lb.disabled);

    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(
        (lb) =>
          lb.id.toLowerCase().includes(q) ||
          lb.name.toLowerCase().includes(q) ||
          (lb.category ?? "").toLowerCase().includes(q),
      );
    }

    return arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }, [configQ.data, search, statusFilter]);

  const handleSave = (def: EventLbDef) => {
    const prev = configQ.data ?? {};
    const map = { ...(prev.event_leaderboards ?? {}) };
    map[def.id] = def;
    saveMut.mutate({ ...prev, event_leaderboards: map }, {
      onSuccess: () => { setEditing(null); setCreating(false); },
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm(`Delete event leaderboard "${id}"?`)) return;
    const prev = configQ.data ?? {};
    const map = { ...(prev.event_leaderboards ?? {}) };
    delete map[id];
    saveMut.mutate({ ...prev, event_leaderboards: map });
  };

  const handleDuplicate = (def: EventLbDef) => {
    const newDef = { ...def, id: genId(), name: `${def.name} (copy)` };
    const prev = configQ.data ?? {};
    const map = { ...(prev.event_leaderboards ?? {}), [newDef.id]: newDef };
    saveMut.mutate({ ...prev, event_leaderboards: map });
  };

  const handleToggle = (def: EventLbDef) => {
    const updated = { ...def, disabled: !def.disabled };
    const prev = configQ.data ?? {};
    const map = { ...(prev.event_leaderboards ?? {}), [updated.id]: updated };
    saveMut.mutate({ ...prev, event_leaderboards: map });
  };

  if (configQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (configQ.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" />
        Failed to load event leaderboards config
        <button onClick={() => configQ.refetch()} className="ml-auto underline">Retry</button>
      </div>
    );
  }

  if (creating || editing) {
    return (
      <EventLbForm
        initial={editing ?? undefined}
        audiences={audiences}
        onSave={handleSave}
        onCancel={() => { setEditing(null); setCreating(false); }}
        saving={saveMut.isPending}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Search by id, name, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="all">All</option>
          <option value="enabled">Enabled</option>
          <option value="disabled">Disabled</option>
        </select>
        <button
          onClick={() => configQ.refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", configQ.isFetching && "animate-spin")} /> Refresh
        </button>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" /> New Leaderboard
        </button>
      </div>

      {/* table */}
      {lbs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          {search || statusFilter !== "all"
            ? "No event leaderboards match your filters"
            : "No event leaderboards configured yet. Click \"New Leaderboard\" to create one."}
        </div>
      ) : (
        <div className="overflow-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium">Leaderboard</th>
                <th className="px-4 py-2.5 font-medium">Operator</th>
                <th className="px-4 py-2.5 font-medium">Reset</th>
                <th className="px-4 py-2.5 font-medium">Tiers</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lbs.map((lb) => (
                <tr key={lb.id} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <div className="font-medium">{lb.name}</div>
                    <div className="text-xs text-muted-foreground">{lb.id}</div>
                    {lb.category && (
                      <span className="mt-0.5 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        {lb.category}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-600">
                      {lb.operator ?? "best"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {lb.reset_schedule || "Never"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {(lb.tiers ?? []).length > 0 ? `${lb.tiers!.length} tier(s)` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(lb)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        lb.disabled
                          ? "bg-zinc-500/10 text-zinc-500"
                          : "bg-emerald-500/10 text-emerald-600",
                      )}
                    >
                      {lb.disabled ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {lb.disabled ? "Disabled" : "Active"}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditing(lb)} className="rounded p-1.5 hover:bg-muted" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDuplicate(lb)} className="rounded p-1.5 hover:bg-muted" title="Duplicate">
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(lb.id)}
                        className="rounded p-1.5 hover:bg-destructive/10"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tournaments Tab                                                    */
/* ------------------------------------------------------------------ */

function TournamentsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const tournamentsQ = useQuery({
    queryKey: ["nakama-tournaments"],
    queryFn: () => nakama.listTournaments({ ...auth(), limit: 100 }),
  });

  const tournaments = useMemo(() => {
    const list = tournamentsQ.data?.tournaments ?? [];
    if (!search) return list;
    const q = search.toLowerCase();
    return list.filter(
      (t) =>
        t.id.toLowerCase().includes(q) ||
        (t.title ?? "").toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [tournamentsQ.data, search]);

  if (tournamentsQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (tournamentsQ.isError) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" />
        Failed to load tournaments
        <button onClick={() => tournamentsQ.refetch()} className="ml-auto underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            className="w-full rounded-md border border-input bg-background py-2 pl-9 pr-3 text-sm"
            placeholder="Search tournaments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          onClick={() => tournamentsQ.refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", tournamentsQ.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        Tournaments are created server-side. This view browses existing tournaments and their records.
      </p>

      {tournaments.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          {search ? "No tournaments match your search" : "No tournaments found on the server"}
        </div>
      ) : (
        <div className="space-y-2">
          {tournaments.map((t) => (
            <TournamentCard
              key={t.id}
              tournament={t}
              expanded={expandedId === t.id}
              onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TournamentCard({
  tournament: t,
  expanded,
  onToggle,
}: {
  tournament: Tournament;
  expanded: boolean;
  onToggle: () => void;
}) {
  const recordsQ = useQuery({
    queryKey: ["tournament-records", t.id],
    queryFn: () => nakama.listTournamentRecords(t.id, { ...auth(), limit: 20 }),
    enabled: expanded,
  });

  const now = Date.now() / 1000;
  const isActive =
    (!t.start_active || t.start_active <= now) && (!t.end_active || t.end_active > now);

  return (
    <div className="rounded-lg border border-border">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg",
          isActive ? "bg-amber-500/10" : "bg-zinc-500/10",
        )}>
          <Swords className={cn("h-4.5 w-4.5", isActive ? "text-amber-500" : "text-zinc-400")} />
        </div>
        <div className="flex-1">
          <div className="font-medium">{t.title || t.id}</div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Hash className="h-3 w-3" /> {t.id}</span>
            {t.size != null && (
              <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {t.size} players</span>
            )}
            {t.end_time && (
              <span className="flex items-center gap-1"><Timer className="h-3 w-3" /> Ends {fmtTime(t.end_time)}</span>
            )}
          </div>
        </div>
        <span className={cn(
          "rounded-full px-2 py-0.5 text-xs font-medium",
          isActive ? "bg-emerald-500/10 text-emerald-600" : "bg-zinc-500/10 text-zinc-500",
        )}>
          {isActive ? "Active" : "Inactive"}
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {/* tournament details */}
          <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Stat label="Operator" value={t.operator ?? "best"} />
            <Stat label="Sort" value={t.sort_order === 1 ? "Ascending" : "Descending"} />
            <Stat label="Max Size" value={String(t.max_size ?? "—")} />
            <Stat label="Duration" value={fmtDuration(t.duration)} />
            <Stat label="Category" value={String(t.category ?? "—")} />
            <Stat label="Can Enter" value={t.can_enter ? "Yes" : "No"} />
            <Stat label="Created" value={fmtTime(t.create_time)} />
            <Stat label="Authoritative" value={t.authoritative ? "Yes" : "No"} />
          </div>

          {/* records */}
          <h4 className="mb-2 flex items-center gap-1 text-sm font-medium">
            <ListOrdered className="h-3.5 w-3.5" /> Top Records
          </h4>
          {recordsQ.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : (recordsQ.data?.records ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No records yet</p>
          ) : (
            <RecordsTable records={recordsQ.data!.records!} />
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Records Browser Tab                                                */
/* ------------------------------------------------------------------ */

function RecordsBrowserTab() {
  const [entityType, setEntityType] = useState<"leaderboard" | "tournament">("leaderboard");
  const [entityId, setEntityId] = useState("");
  const [activeId, setActiveId] = useState("");

  const [writeOpen, setWriteOpen] = useState(false);
  const [writeScore, setWriteScore] = useState(0);
  const [writeSubscore, setWriteSubscore] = useState(0);

  const recordsQ = useQuery({
    queryKey: ["records-browser", entityType, activeId],
    queryFn: () => {
      if (entityType === "leaderboard") {
        return nakama.listLeaderboardRecords(activeId, { ...auth(), limit: 50 });
      }
      return nakama.listTournamentRecords(activeId, { ...auth(), limit: 50 });
    },
    enabled: !!activeId,
  });

  const writeMut = useMutation({
    mutationFn: async () => {
      const body = { score: writeScore, subscore: writeSubscore || undefined };
      if (entityType === "leaderboard") {
        return nakama.writeLeaderboardRecord(activeId, body, auth());
      }
      return nakama.writeTournamentRecord(activeId, body, auth());
    },
    onSuccess: () => {
      recordsQ.refetch();
      setWriteOpen(false);
      setWriteScore(0);
      setWriteSubscore(0);
    },
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      if (entityType === "leaderboard") {
        return nakama.deleteLeaderboardRecord(activeId, auth());
      }
    },
    onSuccess: () => recordsQ.refetch(),
  });

  const handleLoad = () => {
    if (entityId.trim()) setActiveId(entityId.trim());
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Browse records for any leaderboard or tournament by ID. You can write test scores or delete your own record.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Type</label>
          <select
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value as "leaderboard" | "tournament");
              setActiveId("");
            }}
          >
            <option value="leaderboard">Leaderboard</option>
            <option value="tournament">Tournament</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            {entityType === "leaderboard" ? "Leaderboard ID" : "Tournament ID"}
          </label>
          <input
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder={entityType === "leaderboard" ? "e.g. global_score" : "e.g. weekly_tournament"}
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLoad()}
          />
        </div>
        <button
          onClick={handleLoad}
          disabled={!entityId.trim()}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" /> Load
        </button>
      </div>

      {activeId && (
        <>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium">
              Records for <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{activeId}</code>
            </h4>
            <button
              onClick={() => recordsQ.refetch()}
              className="rounded p-1 hover:bg-muted"
              title="Refresh"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", recordsQ.isFetching && "animate-spin")} />
            </button>
            <button
              onClick={() => setWriteOpen(!writeOpen)}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs hover:bg-muted"
            >
              <Send className="h-3 w-3" /> Write Score
            </button>
            {entityType === "leaderboard" && (
              <button
                onClick={() => {
                  if (confirm("Delete your own record from this leaderboard?")) deleteMut.mutate();
                }}
                disabled={deleteMut.isPending}
                className="inline-flex items-center gap-1 rounded-md border border-destructive/30 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" /> Delete My Record
              </button>
            )}
          </div>

          {writeOpen && (
            <div className="flex items-end gap-3 rounded-lg border border-border bg-muted/30 p-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Score</label>
                <input
                  type="number"
                  className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={writeScore}
                  onChange={(e) => setWriteScore(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Subscore</label>
                <input
                  type="number"
                  className="w-28 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={writeSubscore}
                  onChange={(e) => setWriteSubscore(Number(e.target.value))}
                />
              </div>
              <button
                onClick={() => writeMut.mutate()}
                disabled={writeMut.isPending}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {writeMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Submit
              </button>
              <button
                onClick={() => setWriteOpen(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          )}

          {recordsQ.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : recordsQ.isError ? (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" />
              Failed to load records. Check that the ID exists.
            </div>
          ) : (recordsQ.data?.records ?? []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No records found
            </div>
          ) : (
            <RecordsTable records={recordsQ.data!.records!} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared Records Table                                               */
/* ------------------------------------------------------------------ */

function RecordsTable({ records }: { records: LeaderboardRecord[] }) {
  return (
    <div className="overflow-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left">
            <th className="px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Player</th>
            <th className="px-3 py-2 font-medium text-right">Score</th>
            <th className="px-3 py-2 font-medium text-right">Subscore</th>
            <th className="px-3 py-2 font-medium text-right">Submissions</th>
            <th className="px-3 py-2 font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={r.owner_id + i} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-3 py-2">
                {r.rank <= 3 ? (
                  <span className={cn(
                    "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                    r.rank === 1 && "bg-amber-500/20 text-amber-600",
                    r.rank === 2 && "bg-slate-400/20 text-slate-600",
                    r.rank === 3 && "bg-orange-500/20 text-orange-600",
                  )}>
                    {r.rank}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{r.rank}</span>
                )}
              </td>
              <td className="px-3 py-2">
                <div className="font-medium">{r.username || "—"}</div>
                <div className="text-[10px] text-muted-foreground">{r.owner_id}</div>
              </td>
              <td className="px-3 py-2 text-right font-mono">{r.score.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                {r.subscore ? r.subscore.toLocaleString() : "—"}
              </td>
              <td className="px-3 py-2 text-right text-muted-foreground">{r.num_score}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{fmtTime(r.update_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export function LeaderboardsConfigPage() {
  const [activeTab, setActiveTab] = useState<TabId>("event-leaderboards");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Leaderboard &amp; Tournament Admin</h2>
        <p className="text-muted-foreground">
          Manage event leaderboards, browse tournaments, and inspect records.
        </p>
      </div>

      {/* tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* tab panels */}
      {activeTab === "event-leaderboards" && <EventLeaderboardsTab />}
      {activeTab === "tournaments" && <TournamentsTab />}
      {activeTab === "records" && <RecordsBrowserTab />}
    </div>
  );
}


export default LeaderboardsConfigPage;
