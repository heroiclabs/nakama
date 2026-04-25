import { type ReactNode } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { satori, hiro, useRpcOptions, type LiveEvent } from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Clock,
  Trophy,
  Gift,
  Users,
  Flame,
  Medal,
  Target,
  Calendar,
} from "lucide-react";

/* ---- helpers ---- */

function timeUntil(epochSec?: number): string {
  if (!epochSec) return "";
  const diff = epochSec * 1000 - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDate(epochSec?: number): string {
  if (!epochSec) return "—";
  return new Date(epochSec * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type EventStatus = "live" | "upcoming" | "completed";

function getEventStatus(event: LiveEvent): EventStatus {
  const now = Date.now() / 1000;
  if (event.start_time_sec && event.start_time_sec > now) return "upcoming";
  if (event.end_time_sec && event.end_time_sec < now) return "completed";
  return "live";
}

interface RewardRow {
  label: string;
  value: string;
}

function parseRewards(json?: string): RewardRow[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    const rows: RewardRow[] = [];

    const extract = (obj: Record<string, unknown>) => {
      if (obj.currencies) {
        for (const [k, v] of Object.entries(
          obj.currencies as Record<string, number>,
        ))
          rows.push({ label: k, value: (v as number).toLocaleString() });
      }
      if (obj.items) {
        for (const it of obj.items as Array<{
          id?: string;
          count?: number;
        }>)
          rows.push({
            label: it.id ?? "Item",
            value: `×${it.count ?? 1}`,
          });
      }
      if (obj.xp) rows.push({ label: "XP", value: String(obj.xp) });
    };

    if (Array.isArray(parsed)) {
      for (const r of parsed) {
        if (typeof r === "string") rows.push({ label: "Reward", value: r });
        else extract(r);
      }
    } else {
      extract(parsed);
    }
    return rows;
  } catch {
    return [];
  }
}

/* ---- leaderboard types ---- */

interface LeaderboardRecord {
  owner_id: string;
  username?: string;
  score: number;
  rank: number;
}

/* ---- sub-components ---- */

function BackLink() {
  return (
    <Link
      to="/events"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Events
    </Link>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const styles: Record<EventStatus, string> = {
    live: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    upcoming: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    completed: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<EventStatus, string> = {
    live: "Live Now",
    upcoming: "Upcoming",
    completed: "Ended",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        styles[status],
      )}
    >
      {status === "live" && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
      )}
      {labels[status]}
    </span>
  );
}

function InfoCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      {icon}
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

function LeaderboardRow({
  record,
  index,
}: {
  record: LeaderboardRecord;
  index: number;
}) {
  const medalColors = ["text-amber-400", "text-gray-400", "text-orange-400"];
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2.5 transition",
        index < 3 ? "bg-primary/5" : "hover:bg-muted/50",
      )}
    >
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
          index < 3
            ? "bg-primary/15 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {index < 3 ? (
          <Medal className={cn("h-4 w-4", medalColors[index])} />
        ) : (
          record.rank || index + 1
        )}
      </div>
      <div className="flex-1 truncate text-sm font-medium">
        {record.username || record.owner_id.slice(0, 8)}
      </div>
      <div className="text-sm font-semibold tabular-nums">
        {record.score.toLocaleString()}
      </div>
    </div>
  );
}

/* ---- Page ---- */

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const rpc = useRpcOptions();

  const eventsQuery = useQuery<{ events: LiveEvent[] }>({
    queryKey: ["satori", "live-events"],
    queryFn: () => satori.listLiveEvents(rpc),
    staleTime: 60_000,
  });

  const lbQuery = useQuery<{
    event_leaderboards: Array<{
      id: string;
      records?: LeaderboardRecord[];
    }>;
  }>({
    queryKey: ["hiro", "event-leaderboards"],
    queryFn: () => hiro.listEventLeaderboards(rpc),
    staleTime: 30_000,
  });

  const event = eventsQuery.data?.events?.find((e) => e.id === id);
  const eventLb = lbQuery.data?.event_leaderboards?.find(
    (lb) => lb.id === id,
  );

  if (eventsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  if (eventsQuery.error || !event) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-8 text-center text-sm text-destructive">
          {eventsQuery.error ? "Failed to load event." : "Event not found."}
        </div>
      </div>
    );
  }

  const status = getEventStatus(event);
  const rewards = parseRewards(event.rewards_json);
  const records: LeaderboardRecord[] = eventLb?.records ?? [];

  const elapsed = event.start_time_sec
    ? Math.max(0, Date.now() / 1000 - event.start_time_sec)
    : 0;
  const totalDuration =
    event.start_time_sec && event.end_time_sec
      ? event.end_time_sec - event.start_time_sec
      : 0;
  const progressPct =
    status === "completed"
      ? 100
      : totalDuration > 0
        ? Math.min(100, (elapsed / totalDuration) * 100)
        : 0;

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Hero */}
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border",
          status === "live" && "border-emerald-500/30",
          status === "upcoming" && "border-blue-500/30",
        )}
      >
        <div
          className={cn(
            "absolute inset-0",
            status === "live" &&
              "bg-gradient-to-br from-emerald-500/10 via-teal-500/5 to-transparent",
            status === "upcoming" &&
              "bg-gradient-to-br from-blue-500/10 via-indigo-500/5 to-transparent",
            status === "completed" &&
              "bg-gradient-to-br from-muted-foreground/5 to-transparent",
          )}
        />

        <div className="relative p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <StatusBadge status={status} />
              <h2 className="text-2xl font-bold tracking-tight">
                {event.name}
              </h2>
              {event.description && (
                <p className="max-w-xl text-muted-foreground">
                  {event.description}
                </p>
              )}
            </div>

            {status === "live" && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-4 py-3 text-emerald-400">
                <Flame className="h-5 w-5" />
                <div>
                  <div className="text-xs">Ends in</div>
                  <div className="text-lg font-bold">
                    {timeUntil(event.end_time_sec)}
                  </div>
                </div>
              </div>
            )}

            {status === "upcoming" && (
              <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-4 py-3 text-blue-400">
                <Calendar className="h-5 w-5" />
                <div>
                  <div className="text-xs">Starts in</div>
                  <div className="text-lg font-bold">
                    {timeUntil(event.start_time_sec)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {status === "live" && totalDuration > 0 && (
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>{formatDate(event.start_time_sec)}</span>
                <span>{formatDate(event.end_time_sec)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <InfoCard
          icon={<Calendar className="h-4 w-4 text-blue-400" />}
          label="Start"
          value={formatDate(event.start_time_sec)}
        />
        <InfoCard
          icon={<Clock className="h-4 w-4 text-amber-400" />}
          label="End"
          value={formatDate(event.end_time_sec)}
        />
        <InfoCard
          icon={<Target className="h-4 w-4 text-primary" />}
          label="Status"
          value={
            status === "live"
              ? "Active"
              : status === "upcoming"
                ? "Not Started"
                : "Finished"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Rewards */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Gift className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Rewards</h3>
          </div>
          {rewards.length > 0 ? (
            <div className="divide-y">
              {rewards.map((r, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <span className="text-sm text-muted-foreground">
                    {r.label}
                  </span>
                  <span className="text-sm font-semibold">{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No rewards configured for this event.
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="rounded-xl border bg-card">
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Trophy className="h-4 w-4 text-amber-400" />
            <h3 className="font-semibold">Leaderboard</h3>
            {records.length > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                {records.length} entries
              </span>
            )}
          </div>
          {records.length > 0 ? (
            <div className="max-h-80 space-y-1 overflow-y-auto p-2">
              {records.map((rec, idx) => (
                <LeaderboardRow key={rec.owner_id} record={rec} index={idx} />
              ))}
            </div>
          ) : lbQuery.isLoading ? (
            <div className="flex items-center justify-center p-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No leaderboard data yet.
            </div>
          )}
        </div>
      </div>

      {/* Audiences */}
      {event.audiences && event.audiences.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4 text-muted-foreground" />
            Target Audiences
          </div>
          <div className="flex flex-wrap gap-2">
            {event.audiences.map((aud) => (
              <span
                key={aud}
                className="rounded-full bg-muted px-3 py-1 text-xs font-medium"
              >
                {aud}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export { EventDetailPage as default };

export default EventDetailPage;
