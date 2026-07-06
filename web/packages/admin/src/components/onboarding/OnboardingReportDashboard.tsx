import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ChevronDown,
  ChevronUp,
  Search,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import type {
  OnboardingFunnelAnalyticsResult,
  OnboardingUserRow,
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

function fmtDurationMs(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return `${min}m ${rem}s`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function fmtRelative(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    completed: "Done",
    returned_to_app: "Returned",
    dropped: "Dropped",
    at_paywall: "At paywall",
    subscribed: "Subscribed",
    pre_register: "Guest",
  };
  return map[status] || status || "—";
}

function statusClass(status: string): string {
  if (status === "completed" || status === "subscribed") return "bg-emerald-500/15 text-emerald-500";
  if (status === "returned_to_app") return "bg-cyan-500/15 text-cyan-400";
  if (status === "at_paywall") return "bg-amber-500/15 text-amber-500";
  if (status === "dropped") return "bg-destructive/15 text-destructive";
  return "bg-muted text-muted-foreground";
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

function UsersTable({ users, usersTotal }: { users: OnboardingUserRow[]; usersTotal?: number }) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<keyof OnboardingUserRow>("lastTs");
  const [sortDir, setSortDir] = useState<-1 | 1>(-1);

  const filtered = useMemo(() => {
    let list = users.slice();
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((u) =>
        (u.nakamaUserId || "").toLowerCase().includes(needle) ||
        (u.guestId || "").toLowerCase().includes(needle) ||
        (u.lastScreenLabel || u.lastScreen || "").toLowerCase().includes(needle),
      );
    }
    list.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * sortDir;
      return String(av || "").localeCompare(String(bv || "")) * sortDir;
    });
    return list;
  }, [users, q, sortKey, sortDir]);

  function toggleSort(key: keyof OnboardingUserRow) {
    if (sortKey === key) setSortDir((d) => (d === -1 ? 1 : -1));
    else { setSortKey(key); setSortDir(-1); }
  }

  const SortBtn = ({ col, label }: { col: keyof OnboardingUserRow; label: string }) => (
    <button type="button" onClick={() => toggleSort(col)} className="inline-flex items-center gap-1 hover:text-foreground">
      {label}
      {sortKey === col && (sortDir === -1 ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {filtered.length} of {users.length} shown{usersTotal != null ? ` · ${usersTotal} total in funnel` : ""}
        </p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search user / screen…"
            className="h-8 w-56 rounded-md border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-border bg-muted/30 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium"><SortBtn col="lastTs" label="Last active" /></th>
              <th className="px-3 py-2 font-medium">Nakama ID</th>
              <th className="px-3 py-2 font-medium">Guest ID</th>
              <th className="px-3 py-2 font-medium">Pathway</th>
              <th className="px-3 py-2 font-medium">Platform</th>
              <th className="px-3 py-2 font-medium">Last screen</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right"><SortBtn col="durationMs" label="Duration" /></th>
              <th className="px-3 py-2 font-medium text-right"><SortBtn col="eventCount" label="Events" /></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No users match.</td></tr>
            ) : filtered.map((u) => (
              <tr key={`${u.nakamaUserId}-${u.guestId}`} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 text-muted-foreground">{fmtRelative(u.lastTs)}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{u.nakamaUserId ? `${u.nakamaUserId.slice(0, 8)}…` : "—"}</td>
                <td className="px-3 py-2 font-mono text-[10px]">{u.guestId ? `${u.guestId.slice(0, 8)}…` : "—"}</td>
                <td className="px-3 py-2 capitalize">{u.pathway || "—"}</td>
                <td className="px-3 py-2">{u.platform || "—"}</td>
                <td className="px-3 py-2">{u.lastScreenLabel || u.lastScreen || "—"}</td>
                <td className="px-3 py-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", statusClass(u.status))}>
                    {statusLabel(u.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtDurationMs(u.durationMs)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(u.eventCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function OnboardingReportDashboard({ data }: { data: OnboardingFunnelAnalyticsResult }) {
  const summary = data.summary;
  const paywall = data.paywall;

  const screenChartData = useMemo(
    () => data.screenFunnel.map((s) => ({
      name: s.label || s.screen,
      users: s.users,
      pct: s.pctOfStart,
      fill: s.topDropRank === 1 ? "hsl(0 72% 51%)" : s.topDropRank === 2 ? "hsl(25 95% 53%)" : s.topDropRank === 3 ? "hsl(45 93% 47%)" : "hsl(263 70% 60%)",
    })),
    [data.screenFunnel],
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

      <Section
        title="Screen funnel — step by step"
        description="Users who reached each onboarding screen (ob_screen_seen). Top 3 drop screens highlighted in red/amber."
      >
        {screenChartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">No onboarding events in this period.</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, screenChartData.length * 36)}>
            <BarChart data={screenChartData} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(215 28% 17%)" horizontal={false} />
              <XAxis type="number" tick={CHART_AXIS} allowDecimals={false} />
              <YAxis type="category" dataKey="name" width={130} tick={CHART_AXIS} />
              <Tooltip
                contentStyle={CHART_TOOLTIP}
                formatter={(value: number, name: string) => [fmt(value), name === "users" ? "Users" : name]}
              />
              <Bar dataKey="users" name="Users" radius={[0, 4, 4, 0]}>
                {screenChartData.map((row, i) => (
                  <Cell key={i} fill={row.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Drop-off hotspots"
          description="Screens where users abandoned onboarding. Returned-to-app users are excluded."
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
                  <Bar dataKey="users" fill="hsl(0 72% 51%)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </Section>

        <Section title="Pathway breakdown" description="Completion by Scholar / Warrior / Explorer / Creator.">
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
                    <Bar dataKey="users" name="Users" fill="hsl(217 91% 60%)" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
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
        <Section title="Paywall A/B — hard vs soft" description="Variant from userSnapshot.paywallVariant. Conversion = subscribe + trial.">
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
                <Bar dataKey="seen" name="Paywall seen" fill="hsl(263 70% 60%)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="converted" name="Converted" fill="hsl(142 71% 45%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Section>

        <Section title="Welcome theme A/B" description="v1 (dark) vs lavender — from ob_welcome_seen / welcome_theme.">
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

      <Section title="Event signals" description="Unique users who fired each ob_* event in the selected range.">
        <EventSignalsPanel signals={data.eventSignals} />
      </Section>

      <Section title="User journeys" description="Per-user funnel status — same table as analytics.html (up to user_limit rows).">
        {!data.users || data.users.length === 0 ? (
          <p className="text-sm text-muted-foreground">No users in this range.</p>
        ) : (
          <UsersTable users={data.users} usersTotal={data.usersTotal} />
        )}
      </Section>

      <p className="text-[11px] text-muted-foreground">
        RPC: <code className="rounded bg-muted px-1">onboarding_funnel_analytics</code>
        {" · "}Storage: <code className="rounded bg-muted px-1">qv_onboarding_events</code>
        {summary.identityLinksTotal != null ? ` · ${fmt(summary.identityLinksTotal)} identity links · ${fmt(summary.identityMergesApplied)} merges` : ""}
      </p>
    </div>
  );
}
