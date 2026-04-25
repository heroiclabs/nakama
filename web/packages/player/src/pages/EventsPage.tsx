import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { satori, useRpcOptions, type LiveEvent } from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  Calendar,
  Clock,
  Trophy,
  Flame,
  Gift,
  ChevronRight,
  Zap,
  Star,
} from "lucide-react";
import { usePersonalization } from "../hooks/use-personalization";
import { HeroBanner } from "../components/PersonalizationWidgets";

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

function timeUntilStart(epochSec?: number): string {
  if (!epochSec) return "";
  const diff = epochSec * 1000 - Date.now();
  if (diff <= 0) return "Started";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `Starts in ${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `Starts in ${h}h ${m}m` : `Starts in ${m}m`;
}

type EventStatus = "live" | "upcoming" | "completed";

function getEventStatus(event: LiveEvent): EventStatus {
  const now = Date.now() / 1000;
  if (event.start_time_sec && event.start_time_sec > now) return "upcoming";
  if (event.end_time_sec && event.end_time_sec < now) return "completed";
  return "live";
}

function parseRewardLabels(json?: string): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map((r: Record<string, unknown>) => {
        if (typeof r === "string") return r;
        if (r.name) return String(r.name);
        if (r.id) return String(r.id);
        return JSON.stringify(r);
      });
    }
    if (parsed.currencies) {
      return Object.entries(parsed.currencies).map(
        ([k, v]) => `${(v as number).toLocaleString()} ${k}`,
      );
    }
    return [];
  } catch {
    return [];
  }
}

const TABS: { key: EventStatus; label: string; icon: ReactNode }[] = [
  { key: "live", label: "Live", icon: <Flame className="h-4 w-4" /> },
  {
    key: "upcoming",
    label: "Upcoming",
    icon: <Calendar className="h-4 w-4" />,
  },
  {
    key: "completed",
    label: "Completed",
    icon: <Trophy className="h-4 w-4" />,
  },
];

/* ---- Status badge ---- */

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

/* ---- Event card ---- */

function EventCard({ event }: { event: LiveEvent }) {
  const status = getEventStatus(event);
  const rewards = parseRewardLabels(event.rewards_json);

  return (
    <Link
      to={`/events/${event.id}`}
      className={cn(
        "group flex flex-col rounded-xl border bg-card transition-all hover:shadow-md",
        status === "live" &&
          "border-emerald-500/30 hover:border-emerald-500/50",
        status === "upcoming" && "border-blue-500/20 hover:border-blue-500/40",
        status === "completed" && "opacity-75 hover:opacity-100",
      )}
    >
      <div
        className={cn(
          "h-1.5 w-full rounded-t-xl",
          status === "live" &&
            "bg-gradient-to-r from-emerald-500 to-teal-500",
          status === "upcoming" &&
            "bg-gradient-to-r from-blue-500 to-indigo-500",
          status === "completed" &&
            "bg-gradient-to-r from-muted-foreground/30 to-muted-foreground/10",
        )}
      />

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-3 flex items-center justify-between">
          <StatusBadge status={status} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {status === "live" && timeUntil(event.end_time_sec)}
            {status === "upcoming" && timeUntilStart(event.start_time_sec)}
            {status === "completed" && "Ended"}
          </span>
        </div>

        <h3 className="mb-1 text-base font-semibold leading-tight transition-colors group-hover:text-primary">
          {event.name}
        </h3>

        {event.description && (
          <p className="mb-3 line-clamp-2 text-sm text-muted-foreground">
            {event.description}
          </p>
        )}

        <div className="flex-1" />

        {rewards.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {rewards.slice(0, 3).map((r, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                <Gift className="h-3 w-3" />
                {r}
              </span>
            ))}
            {rewards.length > 3 && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                +{rewards.length - 3} more
              </span>
            )}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status === "live" && (
              <>
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Join now</span>
              </>
            )}
            {status === "upcoming" && (
              <>
                <Star className="h-3.5 w-3.5 text-blue-400" />
                <span>Preview</span>
              </>
            )}
            {status === "completed" && (
              <>
                <Trophy className="h-3.5 w-3.5 text-amber-400" />
                <span>View results</span>
              </>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

/* ---- Page ---- */

export function EventsPage() {
  const rpc = useRpcOptions();
  const [activeTab, setActiveTab] = useState<EventStatus>("live");
  const p = usePersonalization();

  const { data, isLoading, error } = useQuery<{ events: LiveEvent[] }>({
    queryKey: ["satori", "live-events"],
    queryFn: () => satori.listLiveEvents(rpc),
    staleTime: 30_000,
  });

  const events = data?.events ?? [];
  const categorized: Record<EventStatus, LiveEvent[]> = {
    live: [],
    upcoming: [],
    completed: [],
  };
  for (const ev of events) {
    categorized[getEventStatus(ev)].push(ev);
  }

  categorized.live.sort(
    (a, b) => (a.end_time_sec ?? 0) - (b.end_time_sec ?? 0),
  );
  categorized.upcoming.sort(
    (a, b) => (a.start_time_sec ?? 0) - (b.start_time_sec ?? 0),
  );
  categorized.completed.sort(
    (a, b) => (b.end_time_sec ?? 0) - (a.end_time_sec ?? 0),
  );

  const filteredEvents = categorized[activeTab];
  const counts = {
    live: categorized.live.length,
    upcoming: categorized.upcoming.length,
    completed: categorized.completed.length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Events</h2>
        <p className="text-muted-foreground">
          Live events, competitions, and limited-time challenges.
        </p>
      </div>

      {p.heroBanner && <HeroBanner banner={p.heroBanner} />}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15">
            <Flame className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Live Now</div>
            <div className="text-lg font-semibold">{counts.live}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-500/15">
            <Calendar className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Upcoming</div>
            <div className="text-lg font-semibold">{counts.upcoming}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border bg-card p-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-500/15">
            <Trophy className="h-4 w-4 text-amber-400" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Completed</div>
            <div className="text-lg font-semibold">{counts.completed}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition",
              activeTab === tab.key
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
            {counts[tab.key] > 0 && (
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                  activeTab === tab.key
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {counts[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
          Failed to load events.
        </div>
      )}

      {!isLoading && !error && filteredEvents.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          {activeTab === "live" && "No live events right now. Check back soon!"}
          {activeTab === "upcoming" && "No upcoming events scheduled."}
          {activeTab === "completed" && "No completed events yet."}
        </div>
      )}

      {!isLoading && !error && filteredEvents.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((ev) => (
            <EventCard key={ev.id} event={ev} />
          ))}
        </div>
      )}
    </div>
  );
}

export { EventsPage as default };

export default EventsPage;
