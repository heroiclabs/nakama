import { quizverse, type ModeShare } from "@nakama/shared";

export function ModeMixChart({ modes }: { modes: ModeShare[] }) {
  if (modes.length === 0) {
    return <p className="text-sm text-muted-foreground">No mode mix data yet.</p>;
  }

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
          <div className="h-4 overflow-hidden rounded-full bg-muted">
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
