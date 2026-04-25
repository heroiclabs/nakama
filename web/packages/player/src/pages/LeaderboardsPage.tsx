import { useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  nakama,
  hiro,
  useRpcOptions,
  useAuthStore,
  type LeaderboardRecord,
  type LeaderboardRecordList,
  type Tournament,
  type TournamentList,
  type TournamentRecordList,
  type FriendList,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  Globe,
  Users,
  Flame,
  Trophy,
  Search,
  Loader2,
  AlertCircle,
  Crown,
  Medal,
  ChevronLeft,
  Clock,
  Swords,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Types & constants                                                  */
/* ------------------------------------------------------------------ */

type TabKey = "global" | "friends" | "event" | "tournament";

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: "global", label: "Global", icon: <Globe className="h-4 w-4" /> },
  { key: "friends", label: "Friends", icon: <Users className="h-4 w-4" /> },
  { key: "event", label: "Event", icon: <Flame className="h-4 w-4" /> },
  {
    key: "tournament",
    label: "Tournament",
    icon: <Trophy className="h-4 w-4" />,
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Crown className="h-5 w-5 text-yellow-500" />;
  if (rank === 2) return <Medal className="h-5 w-5 text-gray-400" />;
  if (rank === 3) return <Medal className="h-5 w-5 text-amber-700" />;
  return (
    <span className="text-sm font-mono text-muted-foreground">#{rank}</span>
  );
}

function fmtScore(n: number) {
  return n.toLocaleString();
}

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/*  Shared records table                                               */
/* ------------------------------------------------------------------ */

function RecordsTable({
  records,
  currentUserId,
  empty,
}: {
  records: LeaderboardRecord[];
  currentUserId?: string;
  empty?: string;
}) {
  if (!records.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        {empty ?? "No records found"}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/50 text-xs font-medium uppercase text-muted-foreground">
            <th className="w-16 px-4 py-3 text-left">Rank</th>
            <th className="px-4 py-3 text-left">Player</th>
            <th className="px-4 py-3 text-right">Score</th>
            <th className="hidden px-4 py-3 text-right sm:table-cell">
              Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const isMe = r.owner_id === currentUserId;
            return (
              <tr
                key={`${r.owner_id}-${r.leaderboard_id}`}
                className={cn(
                  "border-b border-border last:border-0 transition-colors",
                  isMe ? "bg-primary/5 font-semibold" : "hover:bg-muted/30",
                  r.rank <= 3 && "bg-amber-500/5",
                )}
              >
                <td className="px-4 py-3">
                  <RankBadge rank={r.rank} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
                      {(r.username || "?")[0]}
                    </div>
                    <span className={cn("text-sm", isMe && "text-primary")}>
                      {r.username || r.owner_id.slice(0, 8)}
                      {isMe && (
                        <span className="ml-1.5 text-xs text-primary">
                          (you)
                        </span>
                      )}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {fmtScore(r.score)}
                  {r.subscore > 0 && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      .{r.subscore}
                    </span>
                  )}
                </td>
                <td className="hidden px-4 py-3 text-right text-xs text-muted-foreground sm:table-cell">
                  {r.update_time ? timeAgo(r.update_time) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leaderboard ID input (shared by Global & Friends)                  */
/* ------------------------------------------------------------------ */

function LeaderboardIdInput({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Leaderboard ID…"
        className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        onKeyDown={(e) => e.key === "Enter" && onSubmit()}
      />
      <button
        onClick={onSubmit}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Search className="h-4 w-4" />
        Load
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Global Tab                                                         */
/* ------------------------------------------------------------------ */

function GlobalTab() {
  const rpc = useRpcOptions();
  const user = useAuthStore((s) => s.user);
  const [draft, setDraft] = useState("global");
  const [activeId, setActiveId] = useState("global");

  const { data, isLoading, error } = useQuery<LeaderboardRecordList>({
    queryKey: ["leaderboard", "global", activeId],
    queryFn: () =>
      nakama.listLeaderboardRecords(activeId, { ...rpc, limit: 50 }),
    staleTime: 15_000,
    enabled: !!activeId,
  });

  const submit = () => draft.trim() && setActiveId(draft.trim());

  return (
    <div className="space-y-4">
      <LeaderboardIdInput value={draft} onChange={setDraft} onSubmit={submit} />

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <RecordsTable
          records={data?.records ?? []}
          currentUserId={user?.id}
          empty="No records in this leaderboard yet"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Friends Tab                                                        */
/* ------------------------------------------------------------------ */

function FriendsTab() {
  const rpc = useRpcOptions();
  const user = useAuthStore((s) => s.user);
  const [draft, setDraft] = useState("global");
  const [activeId, setActiveId] = useState("global");

  const { data: friendsData } = useQuery<FriendList>({
    queryKey: ["friends"],
    queryFn: () => nakama.listFriends({ ...rpc, limit: 100, state: 0 }),
    staleTime: 60_000,
  });

  const friendIds = [
    ...(friendsData?.friends?.map((f) => f.user.id) ?? []),
    ...(user?.id ? [user.id] : []),
  ];

  const { data, isLoading, error } = useQuery<LeaderboardRecordList>({
    queryKey: ["leaderboard", "friends", activeId, friendIds],
    queryFn: () =>
      nakama.listLeaderboardRecords(activeId, {
        ...rpc,
        limit: 100,
        ownerIds: friendIds,
      }),
    staleTime: 15_000,
    enabled: !!activeId && friendIds.length > 0,
  });

  const sorted = [...(data?.records ?? [])].sort((a, b) => b.score - a.score);
  sorted.forEach((r, i) => {
    r.rank = i + 1;
  });

  const submit = () => draft.trim() && setActiveId(draft.trim());

  return (
    <div className="space-y-4">
      <LeaderboardIdInput value={draft} onChange={setDraft} onSubmit={submit} />

      {!friendIds.length ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          <Users className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="font-medium">No friends yet</p>
          <p className="mt-1 text-xs">
            Add friends to compare scores on leaderboards.
          </p>
        </div>
      ) : isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : (
        <RecordsTable
          records={sorted}
          currentUserId={user?.id}
          empty="None of your friends are on this leaderboard"
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Event Tab (Hiro event leaderboards)                                */
/* ------------------------------------------------------------------ */

interface HiroEventLeaderboard {
  id: string;
  name?: string;
  description?: string;
  records?: LeaderboardRecord[];
  count?: number;
}

function EventTab() {
  const rpc = useRpcOptions();
  const user = useAuthStore((s) => s.user);

  const { data, isLoading, error } = useQuery<{
    event_leaderboards?: HiroEventLeaderboard[];
  }>({
    queryKey: ["hiro", "event-leaderboards"],
    queryFn: () => hiro.listEventLeaderboards(rpc),
    staleTime: 30_000,
  });

  const leaderboards = data?.event_leaderboards ?? [];

  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;

  if (!leaderboards.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <Flame className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="font-medium">No event leaderboards</p>
        <p className="mt-1 text-xs">
          Event leaderboards appear during live events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {leaderboards.map((lb) => (
        <div key={lb.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <h3 className="text-sm font-semibold">{lb.name || lb.id}</h3>
            {lb.count != null && (
              <span className="text-xs text-muted-foreground">
                ({lb.count} players)
              </span>
            )}
          </div>
          {lb.description && (
            <p className="text-xs text-muted-foreground">{lb.description}</p>
          )}
          <RecordsTable
            records={lb.records ?? []}
            currentUserId={user?.id}
            empty="No records in this event leaderboard"
          />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tournament Tab                                                     */
/* ------------------------------------------------------------------ */

function TournamentTab() {
  const rpc = useRpcOptions();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: tData, isLoading: tLoading } = useQuery<TournamentList>({
    queryKey: ["tournaments"],
    queryFn: () => nakama.listTournaments({ ...rpc, limit: 50 }),
    staleTime: 30_000,
  });

  const {
    data: rData,
    isLoading: rLoading,
    error: rError,
  } = useQuery<TournamentRecordList>({
    queryKey: ["tournament-records", selected],
    queryFn: () =>
      nakama.listTournamentRecords(selected!, { ...rpc, limit: 50 }),
    staleTime: 15_000,
    enabled: !!selected,
  });

  const joinMut = useMutation({
    mutationFn: (id: string) => nakama.joinTournament(id, rpc),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tournaments"] }),
  });

  const tournaments = tData?.tournaments ?? [];

  if (tLoading) return <Spinner />;

  if (!tournaments.length) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
        <Trophy className="mx-auto mb-2 h-8 w-8 opacity-50" />
        <p className="font-medium">No tournaments available</p>
        <p className="mt-1 text-xs">
          Check back later for upcoming tournaments.
        </p>
      </div>
    );
  }

  /* ── Records view ── */
  if (selected) {
    const t = tournaments.find((x) => x.id === selected);
    return (
      <div className="space-y-4">
        <button
          onClick={() => setSelected(null)}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to tournaments
        </button>

        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold">{t?.title || selected}</h3>
            {t?.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t.description}
              </p>
            )}
          </div>
          {t?.end_time && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Ends {new Date(t.end_time).toLocaleDateString()}
            </span>
          )}
        </div>

        {rLoading ? (
          <Spinner />
        ) : rError ? (
          <ErrorBox error={rError} />
        ) : (
          <RecordsTable
            records={rData?.records ?? []}
            currentUserId={user?.id}
            empty="No records in this tournament yet"
          />
        )}
      </div>
    );
  }

  /* ── Tournament list ── */
  return (
    <div className="space-y-3">
      {tournaments.map((t) => {
        const active =
          t.end_time && new Date(t.end_time).getTime() > Date.now();
        return (
          <div
            key={t.id}
            role="button"
            tabIndex={0}
            onClick={() => setSelected(t.id)}
            onKeyDown={(e) => e.key === "Enter" && setSelected(t.id)}
            className="cursor-pointer rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/30"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-lg",
                    active
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  <Swords className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold">
                    {t.title || t.id}
                  </h3>
                  {t.description && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {t.size != null && (
                  <span className="text-xs text-muted-foreground">
                    {t.size} players
                  </span>
                )}
                {t.can_enter && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      joinMut.mutate(t.id);
                    }}
                    disabled={joinMut.isPending}
                    className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                  >
                    Join
                  </button>
                )}
              </div>
            </div>

            {t.end_time && (
              <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {active
                  ? `Ends ${new Date(t.end_time).toLocaleDateString()}`
                  : `Ended ${new Date(t.end_time).toLocaleDateString()}`}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Shared micro-components                                            */
/* ------------------------------------------------------------------ */

function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center">
      <AlertCircle className="mx-auto mb-2 h-8 w-8 text-destructive" />
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : "Something went wrong"}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function LeaderboardsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("global");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Leaderboards</h2>
        <p className="text-muted-foreground">
          Global rankings, friend scores, events, and tournaments.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === "global" && <GlobalTab />}
      {activeTab === "friends" && <FriendsTab />}
      {activeTab === "event" && <EventTab />}
      {activeTab === "tournament" && <TournamentTab />}
    </div>
  );
}

export { LeaderboardsPage as default };

export default LeaderboardsPage;
