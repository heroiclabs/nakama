import { useId, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type {
  OnboardingFunnelAnalyticsResult,
  OnboardingWelcomeThemeAB,
  OnboardingEventSignals,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const CHART_TOOLTIP = {
  background: "hsl(222 47% 11%)",
  border: "1px solid hsl(215 28% 17%)",
  borderRadius: 8,
  fontSize: 12,
};

const CHART_AXIS = { fontSize: 11, fill: "hsl(217 10% 64%)" };

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

const CHART_ANIMATION = {
  isAnimationActive: true,
  animationDuration: 1400,
  animationEasing: "ease-out" as const,
};

function AnimatedAreaChart({
  data,
  dataKey = "value",
  labelKey = "label",
  colorHsl = "263 70% 60%",
  height = 240,
  valueLabel = "Users",
}: {
  data: Array<Record<string, string | number>>;
  dataKey?: string;
  labelKey?: string;
  colorHsl?: string;
  height?: number;
  valueLabel?: string;
}) {
  const gradId = useId().replace(/:/g, "");

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`hsl(${colorHsl})`} stopOpacity={0.5} />
            <stop offset="100%" stopColor={`hsl(${colorHsl})`} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
        <XAxis
          dataKey={labelKey}
          tick={CHART_AXIS}
          interval="preserveStartEnd"
          minTickGap={24}
        />
        <YAxis tick={CHART_AXIS} allowDecimals={false} />
        <Tooltip
          contentStyle={CHART_TOOLTIP}
          formatter={(value: number) => [fmt(value), valueLabel]}
        />
        <Area
          type="monotone"
          dataKey={dataKey}
          stroke={`hsl(${colorHsl})`}
          strokeWidth={2}
          fill={`url(#${gradId})`}
          {...CHART_ANIMATION}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Section({
  title,
  description,
  children,
  defaultOpen = true,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
        {open ? <ChevronUp className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      </button>
      {open && <div className="border-t border-border px-5 pb-5 pt-4">{children}</div>}
    </div>
  );
}

function KpiCard({ label, value, hint, accent }: { label: string; value: string; hint: string; accent?: "positive" | "cyan" }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 text-xl font-bold tabular-nums",
        accent === "positive" && "text-emerald-500",
        accent === "cyan" && "text-cyan-400",
      )}>{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function SignalCard({ label, value, pct, sub }: { label: string; value: number; pct?: number | null; sub?: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums">{fmt(value)}</p>
      {pct != null && <p className="text-[11px] text-muted-foreground">{pct}%</p>}
      {sub && <p className="mt-1 text-[10px] text-muted-foreground/80">{sub}</p>}
    </div>
  );
}

function ThemeCard({
  emoji,
  label,
  variant,
  color,
}: {
  emoji: string;
  label: string;
  variant: OnboardingWelcomeThemeAB["v1"];
  color: string;
}) {
  const bars = [
    { label: "Completed", pct: variant.completionRatePct, value: variant.completed },
    { label: "Paywall reached", pct: variant.paywallReachPct, value: variant.paywallSeen },
    { label: "Subscribed", pct: variant.subscribeRatePct, value: variant.subscribed },
  ];
  return (
    <div className="flex-1 min-w-[220px] rounded-xl border border-border bg-muted/20 p-4">
      <p className="text-sm font-medium">{emoji} {label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums" style={{ color }}>{fmt(variant.users)}</p>
      <p className="mb-3 text-[11px] text-muted-foreground">users on this theme</p>
      <div className="space-y-2.5">
        {bars.map((b) => (
          <div key={b.label}>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{b.label}</span>
              <span><strong>{fmt(b.value)}</strong> <span style={{ color }}>{b.pct}%</span></span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(b.pct, 100)}%`, background: color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EventSignalsPanel({ signals }: { signals?: OnboardingEventSignals }) {
  if (!signals) return <p className="text-sm text-muted-foreground">No event signal data yet.</p>;
  const f = signals.funnel || {};
  const h = signals.handoff || {};
  const q = signals.quality || {};
  const r = signals.retention || {};
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Funnel completion</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <SignalCard label="Started sign-up" value={f.registerStart || 0} pct={f.registerStartPct} sub="ob_register_start" />
          <SignalCard label="Onboarding complete" value={f.obComplete || 0} pct={f.obCompletePct} sub="ob_complete" />
          <SignalCard label="App opened after OB" value={f.appLaunchSuccess || 0} pct={f.appLaunchSuccessPct} sub="ob_app_launch_success" />
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Unity handoff</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <SignalCard label="Welcome → app" value={h.welcomeReturnToApp || 0} pct={h.welcomeReturnPct} sub="ob_welcome_return_to_app" />
          <SignalCard label="Sign-in handoff" value={h.signinHandoffNative || 0} pct={h.signinHandoffPct} sub="ob_signin_handoff_native" />
          <SignalCard label="Total returned" value={h.returnedToAppTotal || 0} pct={h.returnedToAppPct} sub="excluded from drop-offs" />
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Quality signals</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <SignalCard label="Pathway confirmed" value={q.pathwayConfirmed || 0} pct={q.pathwayConfirmedPct} />
          <SignalCard label="Name set" value={q.nameSet || 0} pct={q.nameSetPct} />
          <SignalCard label="Quiz 1st answer" value={q.quizFirstAnswer || 0} pct={q.quizFirstAnswerPct} />
          <SignalCard label="Median 1st answer" value={q.medianQuizFirstAnswerSec || 0} sub={`${q.medianQuizFirstAnswerSec || 0} sec`} />
          <SignalCard label="Review prompt" value={q.reviewPromptShown || 0} pct={q.reviewPromptShownPct} />
          <SignalCard label="Plan viewed" value={q.planViewed || 0} pct={q.planViewedPct} />
        </div>
      </div>
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retention hooks</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <SignalCard label="Day 1 return" value={r.d1Return || 0} pct={r.d1ReturnPct} />
          <SignalCard label="Day 7 return" value={r.d7Return || 0} pct={r.d7ReturnPct} />
          <SignalCard label="Welcome bonus" value={r.welcomeBonusClaimed || 0} pct={r.welcomeBonusClaimedPct} />
          <SignalCard label="Streak shield" value={r.streakShieldActivated || 0} pct={r.streakShieldActivatedPct} />
        </div>
      </div>
    </div>
  );
}

export function OnboardingReportDashboard({ data }: { data: OnboardingFunnelAnalyticsResult }) {
  const summary = data.summary;
  const paywall = data.paywall;

  const screenChartData = useMemo(
    () => data.screenFunnel.map((s) => ({
      label: s.label || s.screen,
      value: s.users,
      pct: s.pctOfStart,
      fill: s.topDropRank === 1 ? "hsl(0 72% 51%)" : s.topDropRank === 2 ? "hsl(25 95% 53%)" : s.topDropRank === 3 ? "hsl(45 93% 47%)" : "hsl(263 70% 60%)",
    })),
    [data.screenFunnel],
  );

  const paywallFunnelData = useMemo(
    () => [
      { label: "Started", value: summary.started },
      { label: "Paywall", value: paywall.seen },
      { label: "Subscribed", value: paywall.subscribed },
      { label: "Trial", value: paywall.trialStarts },
      { label: "Completed", value: summary.completed },
    ],
    [summary.started, summary.completed, paywall.seen, paywall.subscribed, paywall.trialStarts],
  );

  const dropoffChartData = useMemo(
    () => data.dropoffHotspots.slice(0, 10).map((h) => ({
      name: h.label || h.screen,
      users: h.users,
      pct: h.pctOfIncomplete,
    })),
    [data.dropoffHotspots],
  );

  const pathwayChartData = useMemo(
    () => (data.pathways || []).map((p) => ({
      name: p.label || p.pathway,
      users: p.users,
      completed: p.completed,
      completionPct: p.completionRatePct,
    })),
    [data.pathways],
  );

  const paywallAbData = paywall.abBreakdown ? [
    { variant: "Hard", seen: paywall.abBreakdown.hard.seen, converted: paywall.abBreakdown.hard.converted, rate: paywall.abBreakdown.hard.conversionRatePct },
    { variant: "Soft", seen: paywall.abBreakdown.soft.seen, converted: paywall.abBreakdown.soft.converted, rate: paywall.abBreakdown.soft.conversionRatePct },
  ] : [];

  const themeAb = data.welcomeThemeAB;
  const totalThemed = (themeAb?.v1.users || 0) + (themeAb?.lavender.users || 0);

  return (
    <div className="space-y-4">
      {data.truncated && (
        <p className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Results may be truncated — try a shorter date range.
        </p>
      )}

      {/* KPI row — matches analytics.html funnel KPIs */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard label="Started" value={fmt(summary.started)} hint="users in range" />
        <KpiCard label="Completed" value={fmt(summary.completed)} hint="reached the app" accent="positive" />
        <KpiCard label="Returned to app" value={fmt(summary.returnedToApp)} hint={`${summary.returnedToAppPct}% · existing users`} accent="cyan" />
        <KpiCard label="Completion rate" value={`${summary.completionRatePct}%`} hint="started → finished" />
        <KpiCard label="Median time" value={`${summary.medianDurationMin} min`} hint="in funnel" />
        <KpiCard label="Paywall seen" value={fmt(paywall.seen)} hint={`${paywall.seenPctOfStart}% of started`} />
        <KpiCard label="Paid" value={fmt(paywall.subscribed)} hint={`${paywall.subscribeRatePct}% of paywall`} accent="positive" />
        <KpiCard label="Trial starts" value={fmt(paywall.trialStarts)} hint={`${paywall.trialRatePct}% of paywall`} />
        <KpiCard label="Dismissed" value={fmt(paywall.dismissed)} hint={`${paywall.dismissRatePct}% of paywall`} />
        <KpiCard label="Skipped" value={fmt(paywall.skipped)} hint={`${paywall.skipRatePct}% · Maybe later`} />
        <KpiCard label="Drop-off" value={fmt(paywall.dropOff)} hint="saw paywall, went silent" />
        {paywall.closingOfferSeen != null && (
          <KpiCard
            label="Closing offer"
            value={fmt(paywall.closingOfferClaimed)}
            hint={`${fmt(paywall.closingOfferSeen)} seen · ${paywall.closingOfferClaimRatePct}% claimed`}
          />
        )}
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">Onboarding funnel overview</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Users at each screen — smooth curve shows drop-off through the flow.
          </p>
        </div>
        {screenChartData.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No onboarding events in this period.</p>
        ) : (
          <AnimatedAreaChart
            data={screenChartData}
            colorHsl="263 70% 60%"
            height={260}
            valueLabel="Users"
          />
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Conversion funnel"
          description="Started → paywall → subscribe/trial → completed."
          defaultOpen={false}
        >
          <AnimatedAreaChart
            data={paywallFunnelData}
            colorHsl="142 71% 45%"
            height={220}
            valueLabel="Users"
          />
        </Section>

        <Section
          title="Screen funnel — step by step"
          description="Same data as overview; top 3 drop screens highlighted below."
          defaultOpen={false}
        >
          {screenChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No onboarding events in this period.</p>
          ) : (
            <>
              <AnimatedAreaChart
                data={screenChartData}
                colorHsl="217 91% 60%"
                height={220}
                valueLabel="Users"
              />
              <div className="mt-4 space-y-2">
                {screenChartData.map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-xs">
                    <span className="truncate pr-2 text-muted-foreground">{row.label}</span>
                    <span className="shrink-0 tabular-nums">
                      <strong>{fmt(row.value)}</strong>
                      <span className="ml-2 text-muted-foreground">{row.pct}%</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Drop-off hotspots"
          description="Screens where users abandoned onboarding. Returned-to-app users are excluded."
          defaultOpen={false}
        >
          {dropoffChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No drop-off data yet.</p>
          ) : (
            <>
              {summary.returnedToApp > 0 && (
                <p className="mb-3 flex items-center gap-1.5 text-xs text-cyan-400">
                  <ArrowDownRight className="h-3.5 w-3.5" />
                  {fmt(summary.returnedToApp)} users ({summary.returnedToAppPct}%) returned to Unity — excluded.
                </p>
              )}
              <ResponsiveContainer width="100%" height={Math.max(180, dropoffChartData.length * 34)}>
                <BarChart data={dropoffChartData} layout="vertical" margin={{ left: 4, right: 16 }}>
                  <XAxis type="number" hide allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={CHART_AXIS} />
                  <Tooltip contentStyle={CHART_TOOLTIP} formatter={(v: number) => [fmt(v), "Stuck users"]} />
                  <Bar dataKey="users" fill="hsl(0 72% 51%)" radius={[0, 4, 4, 0]} {...CHART_ANIMATION} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </Section>

        <Section title="Pathway breakdown" description="Completion by Scholar / Warrior / Explorer / Creator." defaultOpen={false}>
          {pathwayChartData.length === 0 && !(data.prePathway && data.prePathway.users > 0) ? (
            <p className="text-sm text-muted-foreground">No pathway data.</p>
          ) : (
            <>
              {pathwayChartData.length > 0 && (
                <ResponsiveContainer width="100%" height={Math.max(180, pathwayChartData.length * 40)}>
                  <BarChart data={pathwayChartData} margin={{ left: 0, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
                    <XAxis dataKey="name" tick={CHART_AXIS} />
                    <YAxis tick={CHART_AXIS} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="users" name="Users" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} {...CHART_ANIMATION} />
                    <Bar dataKey="completed" name="Completed" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} {...CHART_ANIMATION} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {data.prePathway && data.prePathway.users > 0 && (
                <p className="mt-3 text-xs text-muted-foreground">
                  <strong>{fmt(data.prePathway.users)}</strong> users ({data.prePathway.pctOfStart}% of started) left before choosing a pathway.
                </p>
              )}
            </>
          )}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Paywall A/B — hard vs soft" description="Variant from userSnapshot.paywallVariant. Conversion = subscribe + trial." defaultOpen={false}>
          {paywallAbData.length === 0 || (paywallAbData[0].seen === 0 && paywallAbData[1].seen === 0) ? (
            <p className="text-sm text-muted-foreground">No paywall A/B data yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={paywallAbData} margin={{ top: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" vertical={false} />
                <XAxis dataKey="variant" tick={CHART_AXIS} />
                <YAxis tick={CHART_AXIS} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="seen" name="Paywall seen" fill="hsl(263 70% 60%)" radius={[4, 4, 0, 0]} {...CHART_ANIMATION} />
                <Bar dataKey="converted" name="Converted" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} {...CHART_ANIMATION} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Welcome theme A/B" description="v1 (dark) vs lavender — from ob_welcome_seen / welcome_theme." defaultOpen={false}>
          {!themeAb || (themeAb.v1.users === 0 && themeAb.lavender.users === 0) ? (
            <p className="text-sm text-muted-foreground">No welcome theme A/B data yet.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <ThemeCard emoji="🌑" label="v1 — dark indigo" variant={themeAb.v1} color="#818cf8" />
                <ThemeCard emoji="💜" label="Lavender" variant={themeAb.lavender} color="#a78bfa" />
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Traffic: v1 {totalThemed > 0 ? Math.round((themeAb.v1.users / totalThemed) * 1000) / 10 : 0}% · lavender {totalThemed > 0 ? Math.round((themeAb.lavender.users / totalThemed) * 1000) / 10 : 0}%
                {themeAb.unknown > 0 ? ` · ${fmt(themeAb.unknown)} unknown theme` : ""}
              </p>
            </>
          )}
        </Section>
      </div>

      <Section title="Event signals" description="Unique users who fired each ob_* event in the selected range." defaultOpen={false}>
        <EventSignalsPanel signals={data.eventSignals} />
      </Section>

      <p className="text-[11px] text-muted-foreground">
        RPC: <code className="rounded bg-muted px-1">onboarding_funnel_analytics</code>
        {" · "}Storage: <code className="rounded bg-muted px-1">qv_onboarding_events</code>
        {summary.identityLinksTotal != null ? ` · ${fmt(summary.identityLinksTotal)} identity links · ${fmt(summary.identityMergesApplied)} merges` : ""}
      </p>
    </div>
  );
}
