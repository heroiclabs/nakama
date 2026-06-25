import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  serverKeyAuth,
  quizverse,
  type GrowthSnapshotSource,
  type GscSnapshot,
  type Ga4Snapshot,
  type BeehiivSnapshot,
  type UsersSnapshot,
} from "@nakama/shared";
import { cn } from "@/lib/utils";

const GROWTH_TABS: { id: GrowthSnapshotSource; label: string }[] = [
  { id: "gsc", label: "SEO · GSC" },
  { id: "ga4", label: "Web · GA4" },
  { id: "newsletter", label: "Newsletter" },
  { id: "users", label: "Users" },
];

function useGrowth(source: GrowthSnapshotSource) {
  return useQuery({
    queryKey: ["admin", "growth-snapshot", source],
    queryFn: () => quizverse.fetchGrowthSnapshot(source, serverKeyAuth()),
    refetchInterval: 300_000,
    retry: 1,
  });
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function GscPanel({ snapshot }: { snapshot: GscSnapshot }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Clicks" value={quizverse.formatCompactNumber(snapshot.summary.totalClicks)} hint="28d" />
        <StatTile label="Impressions" value={quizverse.formatCompactNumber(snapshot.summary.totalImpressions)} />
        <StatTile label="Avg CTR" value={quizverse.formatPct(snapshot.summary.avgCtr)} />
        <StatTile label="Avg position" value={snapshot.summary.avgPosition.toFixed(1)} hint="lower is better" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">Query</th>
              <th className="px-4 py-2 text-right">Clicks</th>
              <th className="px-4 py-2 text-right">CTR</th>
              <th className="px-4 py-2 text-right">Position</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.queries.slice(0, 25).map((row) => (
              <tr key={row.query} className="border-b border-border/60">
                <td className="max-w-xs truncate px-4 py-2 font-medium">{row.query}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatCompactNumber(row.clicks)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatPct(row.ctr)}</td>
                <td className="px-4 py-2 text-right tabular-nums">#{row.position.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Ga4Panel({ snapshot }: { snapshot: Ga4Snapshot }) {
  const maxUsers = snapshot.installFunnel[0]?.users ?? 1;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Sessions" value={quizverse.formatCompactNumber(snapshot.summary.totalSessions)} />
        <StatTile label="Users" value={quizverse.formatCompactNumber(snapshot.summary.totalUsers)} />
        <StatTile label="New users" value={quizverse.formatCompactNumber(snapshot.summary.newUsers)} />
        <StatTile label="Bounce rate" value={quizverse.formatPct(snapshot.summary.bounceRate)} />
      </div>
      {snapshot.installFunnel.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold">Install funnel</h4>
          {snapshot.installFunnel.map((step, i) => (
            <div key={step.label} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{step.label}</span>
                <span>{quizverse.formatCompactNumber(step.users)} · {step.completionRate.toFixed(1)}%</span>
              </div>
              <div className="h-5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-violet-500/80")}
                  style={{ width: `${(step.users / maxUsers) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">Page</th>
              <th className="px-4 py-2 text-right">Sessions</th>
              <th className="px-4 py-2 text-right">Views</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.topPages.slice(0, 15).map((row) => (
              <tr key={row.path} className="border-b border-border/60">
                <td className="max-w-xs truncate px-4 py-2 font-mono text-xs">{row.path}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatCompactNumber(row.sessions)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatCompactNumber(row.screenPageViews)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewsletterPanel({ snapshot }: { snapshot: BeehiivSnapshot }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Subscribers" value={quizverse.formatCompactNumber(snapshot.publication.subscriberCount)} />
        <StatTile label="Total ever" value={quizverse.formatCompactNumber(snapshot.publication.totalSubscriptions)} />
        <StatTile label="Avg open" value={quizverse.formatPct(snapshot.publication.avgOpenRate)} />
        <StatTile label="Avg click" value={quizverse.formatPct(snapshot.publication.avgClickRate)} />
      </div>
      {snapshot.publication.name && (
        <p className="text-sm text-muted-foreground">Publication: {snapshot.publication.name}</p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
              <th className="px-4 py-2">Subject</th>
              <th className="px-4 py-2">Sent</th>
              <th className="px-4 py-2 text-right">Recipients</th>
              <th className="px-4 py-2 text-right">Open</th>
              <th className="px-4 py-2 text-right">Click</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.recentPosts.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="max-w-xs truncate px-4 py-2 font-medium">{row.subject}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{quizverse.formatBeehiivPublishDate(row.publishDate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatCompactNumber(row.totalRecipients)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatPct(row.openRate)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatPct(row.clickRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersPanel({ snapshot }: { snapshot: UsersSnapshot }) {
  const regPct = snapshot.totalUsers > 0 ? (snapshot.registeredUsers / snapshot.totalUsers) * 100 : 0;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Total users" value={quizverse.formatCompactNumber(snapshot.totalUsers)} />
        <StatTile label="Registered" value={quizverse.formatCompactNumber(snapshot.registeredUsers)} />
        <StatTile label="Guests" value={quizverse.formatCompactNumber(snapshot.guestUsers)} />
        <StatTile label="Conversion" value={quizverse.formatPct(snapshot.conversionRate)} />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Signups today" value={quizverse.formatCompactNumber(snapshot.signupsToday)} />
        <StatTile label="WTD" value={quizverse.formatCompactNumber(snapshot.signupsWtd)} />
        <StatTile label="MTD" value={quizverse.formatCompactNumber(snapshot.signupsMtd)} />
        <StatTile label="7d conv rate" value={quizverse.formatPct(snapshot.conversionRate7d)} />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Registered vs guest</p>
        <div className="flex h-4 overflow-hidden rounded-full bg-muted">
          <div className="bg-emerald-500/80" style={{ width: `${regPct}%` }} />
          <div className="bg-sky-500/60" style={{ width: `${100 - regPct}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Registered {regPct.toFixed(1)}% · Guests {(100 - regPct).toFixed(1)}%
        </p>
      </div>
    </div>
  );
}

export function GrowthTelemetryPanel() {
  const [tab, setTab] = useState<GrowthSnapshotSource>("gsc");
  const q = useGrowth(tab);

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Growth & marketing snapshots via n8n (WF-32 GSC, WF-41 GA4, WF-33 Beehiiv, WF-40 Users).
      </p>
      <div className="flex flex-wrap gap-2 border-b border-border pb-2">
        {GROWTH_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : q.isError || (!q.data?.ok && !q.data?.snapshot) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm text-amber-700 dark:text-amber-300">
          {q.data?.error ?? "Growth snapshot unavailable. Check n8n workflow credentials and Nakama env vars."}
        </div>
      ) : tab === "gsc" && q.data.snapshot ? (
        <GscPanel snapshot={q.data.snapshot as GscSnapshot} />
      ) : tab === "ga4" && q.data.snapshot ? (
        <Ga4Panel snapshot={q.data.snapshot as Ga4Snapshot} />
      ) : tab === "newsletter" && q.data.snapshot ? (
        <NewsletterPanel snapshot={q.data.snapshot as BeehiivSnapshot} />
      ) : tab === "users" && q.data.snapshot ? (
        <UsersPanel snapshot={q.data.snapshot as UsersSnapshot} />
      ) : (
        <p className="text-sm text-muted-foreground">No data for this source yet.</p>
      )}
    </div>
  );
}
