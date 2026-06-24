import {
  quizverse,
  type FunnelStep,
  type RetentionCell,
  type ModeShare,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const KEY_DAYS = [0, 1, 7, 14, 30] as const;

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(...steps.map((s) => s.unique_players), 1);
  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      {steps.map((step, i) => {
        const pct = (step.unique_players / max) * 100;
        const prev = i > 0 ? steps[i - 1].unique_players : step.unique_players;
        const drop = prev > 0 ? ((step.unique_players / prev) * 100).toFixed(0) : "—";
        return (
          <div key={step.step_no} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span className="font-medium">{step.step}</span>
              <span className="tabular-nums text-muted-foreground">
                {quizverse.formatCompactNumber(step.unique_players)}
                {i > 0 && <span className="ml-2 text-xs">({drop}% of prev)</span>}
              </span>
            </div>
            <div className="h-6 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RetentionHeatmap({ cells }: { cells: RetentionCell[] }) {
  const cohorts = new Map<string, Map<number, number>>();
  for (const row of cells) {
    const c = cohorts.get(row.cohort_d) ?? new Map<number, number>();
    c.set(row.day_n, row.retained);
    cohorts.set(row.cohort_d, c);
  }
  const cohortDates = [...cohorts.keys()].sort().reverse().slice(0, 30);

  if (cohortDates.length === 0) {
    return <p className="text-sm text-muted-foreground">No cohort data yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground">
            <th className="px-3 py-2 text-left font-medium">Cohort</th>
            <th className="px-3 py-2 text-right font-medium">D0</th>
            {KEY_DAYS.slice(1).map((d) => (
              <th key={d} className="px-3 py-2 text-right font-medium">D{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohortDates.map((cohort_d) => {
            const c = cohorts.get(cohort_d);
            const d0 = c?.get(0) ?? 0;
            return (
              <tr key={cohort_d} className="border-b border-border/60">
                <td className="px-3 py-2 font-mono">{cohort_d.slice(0, 10)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d0}</td>
                {KEY_DAYS.slice(1).map((d) => {
                  const v = c?.get(d) ?? 0;
                  const pct = d0 > 0 ? (100 * v) / d0 : 0;
                  const heat =
                    pct >= 30
                      ? "bg-emerald-500/30 text-emerald-900 dark:text-emerald-100"
                      : pct >= 15
                        ? "bg-emerald-500/15"
                        : pct >= 5
                          ? "bg-amber-500/10"
                          : pct > 0
                            ? "bg-rose-500/10"
                            : "";
                  return (
                    <td key={d} className={cn("px-3 py-2 text-right tabular-nums", heat)}>
                      {d0 > 0 ? `${pct.toFixed(0)}%` : "—"}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ModeMixChart({ modes }: { modes: ModeShare[] }) {
  const max = Math.max(...modes.map((m) => m.sessions), 1);
  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      {modes.map((row) => (
        <div key={row.mode} className="space-y-1">
          <div className="flex justify-between text-sm">
            <span className="font-medium capitalize">{row.mode.replace(/_/g, " ")}</span>
            <span className="tabular-nums text-muted-foreground">
              {quizverse.formatCompactNumber(row.sessions)} · {quizverse.formatPct(row.pct)}
            </span>
          </div>
          <div className="h-4 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500/80"
              style={{ width: `${(row.sessions / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
