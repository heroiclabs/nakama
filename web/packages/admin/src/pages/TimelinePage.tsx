import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarRange,
  RefreshCw,
  Loader2,
  FlaskConical,
  CalendarClock,
  MessageSquare,
  AlertTriangle,
} from "lucide-react";
import { serverKeyAuth, satori, type TimelineActivity } from "@nakama/shared";
import { cn } from "@/lib/utils";

const DAY_MS = 86400000;

function useTimeline(days: number) {
  return useQuery({
    queryKey: ["admin", "timeline", days],
    queryFn: () => satori.getTimeline({ days }, serverKeyAuth()),
    retry: 1,
  });
}

function secToDateStr(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

const ACTIVITY_META: Record<TimelineActivity["type"], { icon: React.ElementType; label: string; color: string }> = {
  experiment: { icon: FlaskConical, label: "Experiments", color: "bg-violet-500" },
  live_event: { icon: CalendarClock, label: "Live Events", color: "bg-blue-500" },
  message: { icon: MessageSquare, label: "Messages", color: "bg-emerald-500" },
};

export function TimelinePage() {
  const [days, setDays] = useState(14);
  const timeline = useTimeline(days);

  const dau = timeline.data?.dau ?? [];
  const maxUsers = dau.reduce((m, d) => Math.max(m, d.users), 0);

  // date string → column index (0-based across the visible range)
  const dayIndex = useMemo(() => {
    const map: Record<string, number> = {};
    dau.forEach((d, i) => { map[d.date] = i; });
    return map;
  }, [dau]);

  const firstDate = dau[0]?.date;
  const lastDate = dau[dau.length - 1]?.date;

  function colSpan(act: TimelineActivity): { start: number; end: number } | null {
    if (!firstDate || !lastDate) return null;
    const startStr = act.startAt ? secToDateStr(act.startAt) : firstDate;
    const endStr = act.endAt ? secToDateStr(act.endAt) : lastDate;
    // Clamp to visible window
    let start = dayIndex[startStr];
    if (start === undefined) start = startStr < firstDate ? 0 : days; // before window → 0, after → off-grid
    let end = dayIndex[endStr];
    if (end === undefined) end = endStr > lastDate ? days - 1 : -1;
    if (start > days - 1 || end < 0) return null;
    start = Math.max(0, Math.min(start, days - 1));
    end = Math.max(0, Math.min(end, days - 1));
    if (end < start) end = start;
    return { start, end };
  }

  const grouped = useMemo(() => {
    const acts = timeline.data?.activities ?? [];
    return {
      experiment: acts.filter((a) => a.type === "experiment"),
      live_event: acts.filter((a) => a.type === "live_event"),
      message: acts.filter((a) => a.type === "message"),
    };
  }, [timeline.data]);

  const gridCols = `170px repeat(${days}, minmax(0, 1fr))`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Timeline</h2>
          <p className="text-muted-foreground">Daily activity and what was live across the range.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
            className="h-9 rounded-md border border-border bg-card px-3 text-sm outline-none focus:border-primary"
          >
            <option value={7}>1 week</option>
            <option value={14}>2 weeks</option>
            <option value={30}>30 days</option>
          </select>
          <button onClick={() => timeline.refetch()} disabled={timeline.isFetching} className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50">
            <RefreshCw className={cn("h-4 w-4", timeline.isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {timeline.data?.truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Scan hit its page cap — older events in this range may be undercounted.
        </div>
      )}

      {timeline.isLoading ? (
        <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card p-4">
          <div className="min-w-[720px] space-y-1">
            {/* Date header */}
            <div className="grid items-end gap-px" style={{ gridTemplateColumns: gridCols }}>
              <div className="px-2 pb-2 text-xs font-medium text-muted-foreground">Metric / Activity</div>
              {dau.map((d) => {
                const dt = new Date(d.date + "T00:00:00Z");
                return (
                  <div key={d.date} className="pb-2 text-center text-[10px] leading-tight text-muted-foreground">
                    <div className="font-medium">{dt.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div>{dt.getUTCDate()}</div>
                  </div>
                );
              })}
            </div>

            {/* DAU track */}
            <div className="grid items-center gap-px rounded-md bg-muted/30 py-2" style={{ gridTemplateColumns: gridCols }}>
              <div className="px-2 text-xs font-semibold">Active users</div>
              {dau.map((d) => (
                <div key={d.date} className="flex flex-col items-center justify-end px-0.5" title={`${d.users} users · ${d.events} events`}>
                  <div
                    className="w-full max-w-[28px] rounded-sm bg-primary/80"
                    style={{ height: `${maxUsers > 0 ? Math.max(2, (d.users / maxUsers) * 44) : 2}px` }}
                  />
                  <span className="mt-1 text-[10px] tabular-nums text-muted-foreground">{d.users || ""}</span>
                </div>
              ))}
            </div>

            {/* Activity rows */}
            {(["experiment", "live_event", "message"] as const).map((type) => {
              const meta = ACTIVITY_META[type];
              const acts = grouped[type];
              return (
                <div key={type} className="pt-2">
                  <div className="mb-1 flex items-center gap-1.5 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <meta.icon className="h-3 w-3" />
                    {meta.label}
                    <span className="text-muted-foreground/60">({acts.length})</span>
                  </div>
                  {acts.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-muted-foreground/50">None in this range</p>
                  ) : (
                    acts.map((act) => {
                      const span = colSpan(act);
                      return (
                        <div key={act.id} className="grid items-center gap-px py-0.5" style={{ gridTemplateColumns: gridCols }}>
                          <div className="truncate px-2 text-xs" title={act.name}>{act.name}</div>
                          {span ? (
                            <div
                              className="relative h-5"
                              style={{ gridColumn: `${span.start + 2} / ${span.end + 3}` }}
                            >
                              <div className={cn("flex h-full items-center rounded px-2 text-[10px] font-medium text-white", meta.color)}>
                                <span className="truncate">{act.name}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="col-span-full px-2 text-[10px] text-muted-foreground/50" style={{ gridColumn: `2 / ${days + 2}` }}>
                              outside range
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {timeline.data && (
        <p className="text-xs text-muted-foreground">
          {timeline.data.dau.reduce((s, d) => s + d.events, 0)} events ·{" "}
          {timeline.data.activities.length} activities · scanned {timeline.data.scannedRecords} records
        </p>
      )}
    </div>
  );
}

export default TimelinePage;
