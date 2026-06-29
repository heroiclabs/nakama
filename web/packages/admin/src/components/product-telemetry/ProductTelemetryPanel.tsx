import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Loader2,
  Megaphone,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  serverKeyAuth,
  quizverse,
  type ProductMetricsSlice,
  type OverviewSlice,
  type ModeShare,
  type TimeseriesSlice,
  type FunnelStep,
  type RetentionCell,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import { GrowthTelemetryPanel } from "@/pages/product-telemetry/GrowthTelemetryPanel";
import { FunnelChart, RetentionHeatmap, ModeMixChart } from "@/pages/product-telemetry/TelemetryCharts";

const SLICES: { id: ProductMetricsSlice; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "timeseries", label: "Timeseries" },
  { id: "funnel", label: "Funnel" },
  { id: "retention", label: "Retention" },
  { id: "mode-mix", label: "Mode mix" },
  { id: "sponsors", label: "Sponsors" },
  { id: "experiments", label: "Experiments" },
];

function useProductMetrics<S extends ProductMetricsSlice>(
  slice: S,
  days?: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ["admin", "product-metrics", slice, days],
    queryFn: () =>
      quizverse.fetchProductMetricsSlice(slice, serverKeyAuth(), { days }),
    refetchInterval: 60_000,
    retry: 1,
    enabled,
  });
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-3xl font-bold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function OverviewPanel({ data }: { data: OverviewSlice }) {
  const stale = quizverse.isRollupStale(data.last_rollup_at);
  return (
    <div className="space-y-6">
      {stale && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          CRM rollup may be stale — last rollup {quizverse.formatRelative(data.last_rollup_at)}
        </div>
      )}
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4 text-primary" />
          Audience
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <StatTile label="DAU · today" value={quizverse.formatCompactNumber(data.dau)} />
          <StatTile label="WAU · 7d rolling" value={quizverse.formatCompactNumber(data.wau)} />
          <StatTile label="MAU · 30d rolling" value={quizverse.formatCompactNumber(data.mau)} />
        </div>
      </section>
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-amber-500" />
          Last 24 hours
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Events" value={quizverse.formatCompactNumber(data.events_24h)} />
          <StatTile label="Players" value={quizverse.formatCompactNumber(data.players_24h)} />
        </div>
      </section>
      <section>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Megaphone className="h-4 w-4 text-violet-500" />
          Sponsors · 30d
        </h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatTile label="Impressions" value={quizverse.formatCompactNumber(data.sponsor_imp_30d)} />
          <StatTile label="Clicks" value={quizverse.formatCompactNumber(data.sponsor_clicks_30d)} />
        </div>
      </section>
      {data.top_modes.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold">Top modes · 30d</h3>
          <ModeMixChart modes={data.top_modes} />
        </section>
      )}
      <p className="text-xs text-muted-foreground">
        Last event {quizverse.formatRelative(data.last_event_at)} · Last rollup{" "}
        {quizverse.formatRelative(data.last_rollup_at)}
      </p>
    </div>
  );
}

function TimeseriesPanel({ days }: { days: number }) {
  const q = useProductMetrics("timeseries", days);
  const series = q.data?.data as TimeseriesSlice | undefined;
  const chartData =
    series?.dau.map((pt, i) => ({
      d: pt.d,
      dau: pt.v,
      wau: series.wau[i]?.v ?? 0,
      mau: series.mau[i]?.v ?? 0,
    })) ?? [];

  if (q.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-80 rounded-xl border border-border bg-card p-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
          <XAxis dataKey="d" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={48} />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="dau" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="wau" stroke="#8b5cf6" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="mau" stroke="#10b981" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function GenericTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; fmt?: (v: unknown) => string }[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data for this slice yet.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c.key} className="px-4 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              {columns.map((c) => (
                <td key={c.key} className="px-4 py-2 tabular-nums">
                  {c.fmt ? c.fmt(row[c.key]) : String(row[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SliceContent({ slice, days }: { slice: ProductMetricsSlice; days: number }) {
  const q = useProductMetrics(slice, slice === "timeseries" ? days : undefined);

  if (q.isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        Failed to load product telemetry. Ensure Nakama has QUIZVERSE_N8N_BASE_URL and
        QUIZVERSE_ADMIN_API_TOKEN configured.
      </div>
    );
  }

  if (slice === "overview") {
    return <OverviewPanel data={q.data!.data as OverviewSlice} />;
  }

  if (slice === "timeseries") {
    return <TimeseriesPanel days={days} />;
  }

  if (slice === "funnel") {
    return <FunnelChart steps={(q.data?.data ?? []) as FunnelStep[]} />;
  }

  if (slice === "retention") {
    return <RetentionHeatmap cells={(q.data?.data ?? []) as RetentionCell[]} />;
  }

  if (slice === "mode-mix") {
    return <ModeMixChart modes={(q.data?.data ?? []) as ModeShare[]} />;
  }

  const rows = (q.data?.data ?? []) as unknown as Record<string, unknown>[];

  if (slice === "sponsors") {
    return (
      <GenericTable
        rows={rows}
        columns={[
          { key: "sponsor", label: "Sponsor" },
          { key: "region_code", label: "Region" },
          { key: "impressions", label: "Impressions", fmt: (v) => quizverse.formatCompactNumber(Number(v)) },
          { key: "clicks", label: "Clicks", fmt: (v) => quizverse.formatCompactNumber(Number(v)) },
          { key: "ctr_pct", label: "CTR", fmt: (v) => quizverse.formatPct(v as number | null) },
        ]}
      />
    );
  }

  if (slice === "experiments") {
    return (
      <GenericTable
        rows={rows}
        columns={[
          { key: "experiment_id", label: "Experiment" },
          { key: "bucket", label: "Bucket" },
          { key: "players", label: "Players", fmt: (v) => quizverse.formatCompactNumber(Number(v)) },
          { key: "conv_rate_pct", label: "Conv %", fmt: (v) => quizverse.formatPct(v as number | null) },
          { key: "lift_pct", label: "Lift", fmt: (v) => quizverse.formatPct(v as number | null) },
        ]}
      />
    );
  }

  return null;
}

export interface ProductTelemetryPanelProps {
  /** When true, omits the standalone page header (used inside Dashboard). */
  embedded?: boolean;
}

export function ProductTelemetryPanel({ embedded = false }: ProductTelemetryPanelProps) {
  const [section, setSection] = useState<"product" | "growth">("product");
  const [slice, setSlice] = useState<ProductMetricsSlice>("overview");
  const [days, setDays] = useState(30);
  const overview = useProductMetrics("overview");

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Product Telemetry</h2>
            <p className="text-sm text-muted-foreground">
              CRM game metrics + growth snapshots — independent of QuizVerse admin.
            </p>
          </div>
          <button
            onClick={() => overview.refetch()}
            disabled={overview.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", overview.isFetching && "animate-spin")} />
            Refresh
          </button>
        </div>
      )}

      <div className="flex gap-2">
        {(["product", "growth"] as const).map((key) => (
          <button
            key={key}
            onClick={() => setSection(key)}
            className={cn(
              "rounded-lg px-4 py-2 text-sm font-semibold transition-colors",
              section === key
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {key === "product" ? "CRM · Product" : "Growth · Marketing"}
          </button>
        ))}
      </div>

      {section === "growth" ? (
        <GrowthTelemetryPanel />
      ) : (
        <>
          {overview.data?.generated_at && (
            <p className="text-xs text-muted-foreground">
              Generated {overview.data.generated_at}
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <TrendingUp className="h-4 w-4 text-primary" />
                DAU
              </div>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {overview.isLoading
                  ? "—"
                  : quizverse.formatCompactNumber((overview.data?.data as OverviewSlice | undefined)?.dau ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                WAU
              </div>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {overview.isLoading
                  ? "—"
                  : quizverse.formatCompactNumber((overview.data?.data as OverviewSlice | undefined)?.wau ?? 0)}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BarChart3 className="h-4 w-4" />
                MAU
              </div>
              <p className="mt-1 text-3xl font-bold tabular-nums">
                {overview.isLoading
                  ? "—"
                  : quizverse.formatCompactNumber((overview.data?.data as OverviewSlice | undefined)?.mau ?? 0)}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b border-border pb-2">
            {SLICES.map((s) => (
              <button
                key={s.id}
                onClick={() => setSlice(s.id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  slice === s.id
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
            {slice === "timeseries" && (
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="ml-auto rounded-md border border-border bg-card px-2 py-1 text-sm"
              >
                {[14, 30, 60, 90].map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            )}
          </div>

          <SliceContent slice={slice} days={days} />
        </>
      )}
    </div>
  );
}
