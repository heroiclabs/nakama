import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Globe2, Loader2, Mail, Search, Users } from "lucide-react";
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

const GROWTH_SECTIONS: {
  id: GrowthSnapshotSource;
  label: string;
  icon: typeof Search;
}[] = [
  { id: "gsc", label: "SEO · GSC", icon: Search },
  { id: "ga4", label: "Web · GA4", icon: Globe2 },
  { id: "newsletter", label: "Newsletter", icon: Mail },
  { id: "users", label: "Platform · Users", icon: Users },
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

function fmtFixed(n: number | null | undefined, digits = 1): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

function GscPanel({ snapshot }: { snapshot: GscSnapshot }) {
  const summary = snapshot.summary ?? ({} as GscSnapshot["summary"]);
  const queries = snapshot.queries ?? [];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Clicks" value={quizverse.formatCompactNumber(summary.totalClicks)} hint="28d" />
        <StatTile label="Impressions" value={quizverse.formatCompactNumber(summary.totalImpressions)} />
        <StatTile label="Avg CTR" value={quizverse.formatPct(summary.avgCtr)} />
        <StatTile label="Avg position" value={fmtFixed(summary.avgPosition)} hint="lower is better" />
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
            {queries.slice(0, 25).map((row) => (
              <tr key={row.query} className="border-b border-border/60">
                <td className="max-w-xs truncate px-4 py-2 font-medium">{row.query}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatCompactNumber(row.clicks)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{quizverse.formatPct(row.ctr)}</td>
                <td className="px-4 py-2 text-right tabular-nums">#{fmtFixed(row.position)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Ga4Panel({ snapshot }: { snapshot: Ga4Snapshot }) {
  const summary = snapshot.summary ?? ({} as Ga4Snapshot["summary"]);
  const installFunnel = snapshot.installFunnel ?? [];
  const topPages = snapshot.topPages ?? [];
  const maxUsers = installFunnel[0]?.users ?? 1;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Sessions" value={quizverse.formatCompactNumber(summary.totalSessions)} />
        <StatTile label="Users" value={quizverse.formatCompactNumber(summary.totalUsers)} />
        <StatTile label="New users" value={quizverse.formatCompactNumber(summary.newUsers)} />
        <StatTile label="Bounce rate" value={quizverse.formatPct(summary.bounceRate)} />
      </div>
      {installFunnel.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h4 className="text-sm font-semibold">Install funnel</h4>
          {installFunnel.map((step, i) => (
            <div key={step.label} className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{step.label}</span>
                <span>
                  {quizverse.formatCompactNumber(step.users)} · {fmtFixed(step.completionRate)}%
                </span>
              </div>
              <div className="h-5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-violet-500/80")}
                  style={{ width: `${((step.users ?? 0) / maxUsers) * 100}%` }}
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
            {topPages.slice(0, 15).map((row) => (
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
  const publication = snapshot.publication ?? ({} as BeehiivSnapshot["publication"]);
  const recentPosts = snapshot.recentPosts ?? [];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile label="Subscribers" value={quizverse.formatCompactNumber(publication.subscriberCount)} />
        <StatTile label="Total ever" value={quizverse.formatCompactNumber(publication.totalSubscriptions)} />
        <StatTile label="Avg open" value={quizverse.formatPct(publication.avgOpenRate)} />
        <StatTile label="Avg click" value={quizverse.formatPct(publication.avgClickRate)} />
      </div>
      {publication.name && (
        <p className="text-sm text-muted-foreground">Publication: {publication.name}</p>
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
            {recentPosts.map((row) => (
              <tr key={row.id} className="border-b border-border/60">
                <td className="max-w-xs truncate px-4 py-2 font-medium">{row.subject}</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">
                  {quizverse.formatBeehiivPublishDate(row.publishDate)}
                </td>
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
  const updatedLabel = snapshot.updatedAt
    ? new Date(snapshot.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Platform identity registry (Cognito)</p>
        <p className="mt-1 leading-relaxed">
          Counts unique QuizVerse sign-in identities from Admin Management — registered accounts plus
          guest profiles. This is <strong className="font-medium text-foreground">not</strong> Nakama game
          account rows and <strong className="font-medium text-foreground">not</strong> daily active players.
          For DAU, WAU, and MAU, use the Status tab above.
        </p>
        {updatedLabel && (
          <p className="mt-2 text-xs">Snapshot · {updatedLabel} · via WF-40</p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Platform total"
          value={quizverse.formatCompactNumber(snapshot.totalUsers)}
          hint="registered + guests"
        />
        <StatTile
          label="Registered"
          value={quizverse.formatCompactNumber(snapshot.registeredUsers)}
          hint="Cognito sign-in"
        />
        <StatTile
          label="Guests"
          value={quizverse.formatCompactNumber(snapshot.guestUsers)}
          hint="anonymous profiles"
        />
        <StatTile
          label="Conversion"
          value={quizverse.formatPct(snapshot.conversionRate)}
          hint="registered ÷ platform total"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Signups today"
          value={quizverse.formatCompactNumber(snapshot.signupsToday)}
          hint="new registered"
        />
        <StatTile label="WTD signups" value={quizverse.formatCompactNumber(snapshot.signupsWtd)} hint="week to date" />
        <StatTile label="MTD signups" value={quizverse.formatCompactNumber(snapshot.signupsMtd)} hint="month to date" />
        <StatTile
          label="7d conv rate"
          value={quizverse.formatPct(snapshot.conversionRate7d)}
          hint="new users who registered"
        />
      </div>
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">Registered vs guest · platform total</p>
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

function GrowthSourceSection({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: GrowthSnapshotSource;
  label: string;
  icon: typeof Search;
  children: (snapshot: NonNullable<ReturnType<typeof useGrowth>["data"]>["snapshot"]) => ReactNode;
}) {
  const q = useGrowth(id);

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{label}</h3>
      </div>
      {q.isLoading ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-border bg-card">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : q.isError || (!q.data?.ok && !q.data?.snapshot) ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          {q.data?.error ?? "Snapshot unavailable. Check n8n workflow credentials and Nakama env vars."}
        </div>
      ) : q.data.snapshot ? (
        children(q.data.snapshot)
      ) : (
        <p className="text-sm text-muted-foreground">No data for this source yet.</p>
      )}
    </section>
  );
}

export function GrowthTelemetryPanel() {
  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        Growth and marketing snapshots via n8n (WF-32 GSC, WF-41 GA4, WF-33 Beehiiv, WF-40 Users).
      </p>

      {GROWTH_SECTIONS.map((section) => (
        <GrowthSourceSection key={section.id} id={section.id} label={section.label} icon={section.icon}>
          {(snapshot) => {
            if (section.id === "gsc") return <GscPanel snapshot={snapshot as GscSnapshot} />;
            if (section.id === "ga4") return <Ga4Panel snapshot={snapshot as Ga4Snapshot} />;
            if (section.id === "newsletter") return <NewsletterPanel snapshot={snapshot as BeehiivSnapshot} />;
            return <UsersPanel snapshot={snapshot as UsersSnapshot} />;
          }}
        </GrowthSourceSection>
      ))}
    </div>
  );
}
