import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, DollarSign, Loader2, Radio, TrendingUp, Users } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { quizverse, serverKeyAuth, type RevenueCatDashboardResult } from "@nakama/shared";
import { cn } from "@/lib/utils";

const REVENUE_COLOR = "142 71% 45%";

function dayLabel(date: string) {
  const d = new Date(date + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function money(v: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(v);
}

function OverviewCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className="text-2xl font-bold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

export function RevenueCatRevenuePanel({ days = 30 }: { days?: number }) {
  const q = useQuery<RevenueCatDashboardResult>({
    queryKey: ["admin", "revenuecat-dashboard", days],
    queryFn: () => quizverse.fetchRevenueCatDashboard(serverKeyAuth(), days),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  const chartData = (q.data?.daily ?? []).map((row) => ({
    label: dayLabel(row.date),
    revenue: row.revenue,
    transactions: row.transactions,
  }));

  const currency = q.data?.currency ?? "USD";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="h-4 w-4 text-primary" />
            Subscription &amp; IAP Revenue
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Source: RevenueCat (production charts) — not Nakama client analytics
          </p>
        </div>
        {q.data?.dateRange && (
          <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {q.data.dateRange.start} → {q.data.dateRange.end}
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : q.isError ? (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">RevenueCat unavailable</p>
            <p className="mt-1 text-xs opacity-90">
              {(q.error as Error)?.message ??
                "Set REVENUECAT_SECRET_API_KEY on the Nakama pod and redeploy."}
            </p>
          </div>
        </div>
      ) : q.data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <OverviewCard
              label={`Revenue · ${days}d`}
              value={money(q.data.totals.revenue, currency)}
              icon={DollarSign}
            />
            <OverviewCard
              label="MRR (28d window)"
              value={money(q.data.overview.mrr, currency)}
              icon={TrendingUp}
            />
            <OverviewCard
              label="Active subscriptions"
              value={String(q.data.overview.activeSubscriptions)}
              icon={Users}
            />
            <OverviewCard
              label="Active trials"
              value={String(q.data.overview.activeTrials)}
              icon={Radio}
            />
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold">Daily revenue</h4>
                <p className="text-xs text-muted-foreground">
                  Gross revenue per day (RevenueCat chart)
                </p>
              </div>
              <span className="text-lg font-bold tabular-nums" style={{ color: `hsl(${REVENUE_COLOR})` }}>
                {money(q.data.totals.revenue, currency)}
              </span>
            </div>
            {chartData.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No revenue in this window</p>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="rc_revenue_grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={`hsl(${REVENUE_COLOR})`} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={`hsl(${REVENUE_COLOR})`} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }}
                    interval="preserveStartEnd"
                    minTickGap={24}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(217 10% 64%)" }}
                    width={52}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    formatter={(v: number) => [money(v, currency), "Revenue"]}
                    contentStyle={{
                      background: "hsl(222 47% 11%)",
                      border: "1px solid hsl(215 28% 17%)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={`hsl(${REVENUE_COLOR})`}
                    fill="url(#rc_revenue_grad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      ) : null}

      <div
        className={cn(
          "rounded-xl border border-amber-500/30 bg-amber-500/5 p-5",
        )}
      >
        <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          Ad Revenue — integration pending
        </h4>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {q.data?.adRevenue?.message ??
            "Ad revenue is not wired yet. Unity must send Appodeal impression and earnings events to Nakama before this dashboard can show ad revenue."}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Status: <span className="font-medium text-amber-700 dark:text-amber-300">Pending Unity integration</span>
        </p>
      </div>
    </div>
  );
}
