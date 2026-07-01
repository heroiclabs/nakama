import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Loader2, Megaphone, Puzzle, RefreshCw } from "lucide-react";
import {
  serverKeyAuth,
  quizverse,
  type ModeShare,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import { GrowthTelemetryPanel } from "@/pages/product-telemetry/GrowthTelemetryPanel";
import { ModeMixChart } from "@/pages/product-telemetry/TelemetryCharts";

function useModeMix() {
  return useQuery({
    queryKey: ["admin", "product-metrics", "mode-mix"],
    queryFn: () => quizverse.fetchProductMetricsSlice("mode-mix", serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useSponsors() {
  return useQuery({
    queryKey: ["admin", "product-metrics", "sponsors"],
    queryFn: () => quizverse.fetchProductMetricsSlice("sponsors", serverKeyAuth()),
    refetchInterval: 60_000,
    retry: 1,
  });
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

function ModeMixSection() {
  const q = useModeMix();
  if (q.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <p className="text-sm text-destructive">
        Failed to load mode mix. Ensure Nakama has QUIZVERSE_N8N_BASE_URL configured.
      </p>
    );
  }
  return <ModeMixChart modes={(q.data?.data ?? []) as ModeShare[]} />;
}

function SponsorsSection() {
  const q = useSponsors();
  if (q.isLoading) {
    return (
      <div className="flex h-32 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (q.isError) {
    return (
      <p className="text-sm text-destructive">
        Failed to load sponsor metrics. Ensure Nakama has QUIZVERSE_N8N_BASE_URL configured.
      </p>
    );
  }
  const rows = (q.data?.data ?? []) as unknown as Record<string, unknown>[];
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

export interface ProductTelemetryPanelProps {
  /** When true, omits the standalone page header (used inside Dashboard). */
  embedded?: boolean;
}

export function ProductTelemetryPanel({ embedded = false }: ProductTelemetryPanelProps) {
  const queryClient = useQueryClient();
  const [section, setSection] = useState<"product" | "growth">("product");

  const refreshProduct = () => {
    queryClient.invalidateQueries({ queryKey: ["admin", "product-metrics"] });
  };

  return (
    <div className="space-y-6">
      {!embedded && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Product Telemetry</h2>
            <p className="text-sm text-muted-foreground">
              CRM mode mix and sponsor performance — audience and funnels live elsewhere in Admin.
            </p>
          </div>
          <button
            onClick={refreshProduct}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
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
            {key === "product" ? "Product · Nakama" : "Growth · Marketing"}
          </button>
        ))}
      </div>

      {section === "growth" ? (
        <GrowthTelemetryPanel />
      ) : (
        <>
          <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p>
              Moved to avoid duplication: DAU/WAU/MAU on{" "}
              <Link to="/dashboard?tab=status" className="font-medium text-primary hover:underline">
                Status
              </Link>
              , daily engagement on{" "}
              <Link to="/dashboard?tab=metrics" className="font-medium text-primary hover:underline">
                Game Metrics
              </Link>
              , funnels &amp; retention on{" "}
              <Link to="/funnels" className="font-medium text-primary hover:underline">
                Funnels &amp; Retention
              </Link>
              , experiments on{" "}
              <Link to="/experiments" className="font-medium text-primary hover:underline">
                Experiments
              </Link>
              .
            </p>
          </div>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Puzzle className="h-4 w-4 text-violet-500" />
              Mode mix · 30d
            </h3>
            <ModeMixSection />
          </section>

          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Megaphone className="h-4 w-4 text-amber-500" />
              Sponsors · 30d
            </h3>
            <SponsorsSection />
          </section>
        </>
      )}
    </div>
  );
}
