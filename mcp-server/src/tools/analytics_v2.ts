import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { NakamaConsoleClient, NakamaApiClient } from "../client.js";

async function safeRpc(api: NakamaApiClient, rpc: string, payload: unknown = {}): Promise<any> {
  try {
    return await api.callRpc(rpc, payload);
  } catch (e: any) {
    return { _error: e.message ?? String(e), _rpc: rpc };
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function computeHealthScore(
  dauMauRatio: number,
  d1: number,
  d7: number,
  avgSessionSec: number,
  gini: number,
  sourceSinkRatio: number
): number {
  const engagementScore = clamp(dauMauRatio / 0.3, 0, 1) * 25;
  const d1Score = clamp(d1 / 0.6, 0, 1) * 20;
  const d7Score = clamp(d7 / 0.25, 0, 1) * 20;
  const sessionScore = clamp(avgSessionSec / 900, 0, 1) * 15;
  const giniScore = clamp(1 - gini, 0, 1) * 10;
  const sinkScore = clamp(1 - Math.abs(sourceSinkRatio - 1), 0, 1) * 10;
  return Math.round(engagementScore + d1Score + d7Score + sessionScore + giniScore + sinkScore);
}

export function registerAnalyticsV2Tools(
  server: McpServer,
  console: NakamaConsoleClient,
  api: NakamaApiClient
) {
  // ──────────────────────────────────────────────
  // Tool 1: game_health_report
  // ──────────────────────────────────────────────
  server.tool(
    "game_health_report",
    "Comprehensive game health report with benchmarks. Returns DAU/MAU, retention, economy health, session stats, and flagged issues. Call this first when analyzing a game's overall health.",
    {
      game_id: z.string().describe("Game UUID to analyze"),
    },
    async ({ game_id }) => {
      const [dashboard, retention, economy, sessions] = await Promise.all([
        safeRpc(api, "analytics_dashboard", { game_id }),
        safeRpc(api, "analytics_retention_cohort", { game_id }),
        safeRpc(api, "analytics_economy_health", { game_id }),
        safeRpc(api, "analytics_session_stats", { game_id, days: 7 }),
      ]);

      const dau = dashboard?.dau ?? 0;
      const wau = dashboard?.wau ?? 0;
      const mau = dashboard?.mau ?? 1;
      const dauMauRatio = mau > 0 ? dau / mau : 0;

      const d1 = retention?.d1 ?? 0;
      const d3 = retention?.d3 ?? 0;
      const d7 = retention?.d7 ?? 0;
      const d14 = retention?.d14 ?? 0;
      const d30 = retention?.d30 ?? 0;

      const gini = economy?.gini ?? 0;
      const sourceSinkRatio = economy?.source_sink_ratio ?? 1;
      const totalCoins = economy?.total_coins ?? 0;
      const totalGems = economy?.total_gems ?? 0;

      const avgDuration = sessions?.avg_duration ?? 0;
      const sessionsPerDay = sessions?.sessions_per_day ?? 0;
      const peakHours = sessions?.peak_hours ?? [];

      const flags: string[] = [];
      if (dauMauRatio < 0.15) flags.push("low_engagement_ratio");
      if (d1 < 0.30) flags.push("poor_first_day_retention");
      if (d7 < 0.10) flags.push("critical_d7_retention");
      if (avgDuration < 120) flags.push("very_short_sessions");
      if (gini > 0.6) flags.push("economy_inequality_high");
      if (sourceSinkRatio > 2.0) flags.push("economy_inflating");

      const dau7dChange = dashboard?.dau_7d_change ?? 0;
      if (dau7dChange < -0.10) flags.push("dau_declining");

      const score = computeHealthScore(dauMauRatio, d1, d7, avgDuration, gini, sourceSinkRatio);
      const status: "healthy" | "warning" | "critical" =
        score < 40 ? "critical" : score < 70 ? "warning" : "healthy";

      const report = {
        summary: { status, score },
        metrics: {
          engagement: { dau, wau, mau, dau_mau_ratio: dauMauRatio },
          retention: { d1, d3, d7, d14, d30 },
          economy: { gini, source_sink_ratio: sourceSinkRatio, total_coins: totalCoins, total_gems: totalGems },
          sessions: { avg_duration: avgDuration, sessions_per_day: sessionsPerDay, peak_hours: peakHours },
        },
        benchmarks: {
          dau_mau: { good: 0.20, great: 0.30, yours: dauMauRatio },
          d1_retention: { good: 0.40, great: 0.60, yours: d1 },
          d7_retention: { good: 0.15, great: 0.25, yours: d7 },
          avg_session_minutes: { good: 5, great: 15, yours: avgDuration / 60 },
          gini: { healthy: 0.4, warning: 0.6, yours: gini },
        },
        flags,
        raw_data: { dashboard, retention, economy, sessions },
      };

      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // Tool 2: player_deep_dive
  // ──────────────────────────────────────────────
  server.tool(
    "player_deep_dive",
    "Deep analysis of a single player: engagement score, session patterns, churn risk, economy participation, feature adoption. Use when investigating a specific player's behavior or when a player reports issues.",
    {
      user_id: z.string().describe("Player UUID"),
      game_id: z.string().describe("Game UUID"),
    },
    async ({ user_id, game_id }) => {
      const [engagementData, account, walletLedger] = await Promise.all([
        safeRpc(api, "analytics_engagement_score", { user_id, game_id }),
        console.getAccount(user_id).catch((e: any) => ({ _error: e.message })),
        console.getWalletLedger(user_id, { limit: 100 }).catch((e: any) => ({ _error: e.message })),
      ]);

      const acct = account as any;
      const username = acct?.account?.user?.username ?? acct?.user?.username ?? "unknown";
      const createdAt = acct?.account?.user?.create_time ?? acct?.user?.create_time ?? null;
      const lastOnline = acct?.account?.disable_time ?? acct?.account?.user?.update_time ?? null;

      const score = engagementData?.score ?? 0;
      const riskLevel = engagementData?.risk_level ?? "unknown";
      const breakdown = engagementData?.breakdown ?? {};

      const ledgerItems = (walletLedger as any)?.items ?? [];
      const totalTransactions = ledgerItems.length;
      let currentBalance = 0;
      if (acct?.account?.wallet) {
        try {
          const wallet = typeof acct.account.wallet === "string"
            ? JSON.parse(acct.account.wallet)
            : acct.account.wallet;
          currentBalance = Object.values(wallet).reduce((sum: number, v: any) => sum + (Number(v) || 0), 0);
        } catch { /* wallet parse failed */ }
      }

      const recentTxns = ledgerItems.slice(0, 10);
      const recentTrend = recentTxns.length > 0
        ? recentTxns.reduce((s: number, t: any) => {
            const changeset = t.changeset ? (typeof t.changeset === "string" ? JSON.parse(t.changeset) : t.changeset) : {};
            return s + Object.values(changeset).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
          }, 0) > 0 ? "gaining" : "spending"
        : "no_data";

      const totalSessions = engagementData?.total_sessions ?? 0;
      const avgSessionDuration = engagementData?.avg_session_duration ?? 0;
      const daysActive = engagementData?.days_active ?? 0;

      const flags: string[] = [];
      if (riskLevel === "churning" || riskLevel === "high") flags.push("churning");
      if (currentBalance > 10000) flags.push("whale");

      const now = Date.now();
      if (createdAt) {
        const createdMs = new Date(createdAt).getTime();
        if (now - createdMs < 7 * 24 * 60 * 60 * 1000) flags.push("new_player");
      }
      if (lastOnline) {
        const lastMs = new Date(lastOnline).getTime();
        if (now - lastMs > 3 * 24 * 60 * 60 * 1000) flags.push("inactive_3d");
      }

      const recommendations: string[] = [];
      if (flags.includes("churning")) {
        recommendations.push("Send re-engagement notification with a personalized offer");
        recommendations.push("Offer mystery box or daily login bonus to encourage return");
      }
      if (flags.includes("inactive_3d")) {
        recommendations.push("Trigger winback flow with exclusive time-limited reward");
      }
      if (flags.includes("new_player")) {
        recommendations.push("Ensure onboarding flow is complete — check tutorial progress");
        recommendations.push("Suggest challenge with friends to boost social engagement");
      }
      if (flags.includes("whale")) {
        recommendations.push("Offer VIP perks or exclusive content to maintain spending engagement");
      }
      if (recommendations.length === 0) {
        recommendations.push("Player appears healthy — monitor for engagement changes");
      }

      const result = {
        player: { user_id, username, created_at: createdAt, last_online: lastOnline },
        engagement: { score, risk_level: riskLevel, breakdown },
        wallet: { current_balance: currentBalance, total_transactions: totalTransactions, recent_trend: recentTrend },
        behavior: { total_sessions: totalSessions, avg_session_duration: avgSessionDuration, days_active: daysActive },
        flags,
        recommendations,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // Tool 3: retention_analysis
  // ──────────────────────────────────────────────
  server.tool(
    "retention_analysis",
    "Cohort-based retention analysis. Shows D1 through D30 retention curves for signup cohorts. Use to identify when players are dropping off and whether retention is improving or declining over time.",
    {
      game_id: z.string().describe("Game UUID"),
      cohort_dates: z.array(z.string()).optional().describe("Array of YYYY-MM-DD dates to analyze as cohorts. Defaults to last 7 days."),
    },
    async ({ game_id, cohort_dates }) => {
      const dates = cohort_dates && cohort_dates.length > 0
        ? cohort_dates
        : Array.from({ length: 7 }, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toISOString().slice(0, 10);
          });

      const cohortResults = await Promise.all(
        dates.map((date) => safeRpc(api, "analytics_retention_cohort", { game_id, cohort_date: date }))
      );

      const cohorts = dates.map((date, i) => {
        const r = cohortResults[i];
        return {
          date,
          size: r?.cohort_size ?? r?.size ?? 0,
          d1: r?.d1 ?? 0,
          d3: r?.d3 ?? 0,
          d7: r?.d7 ?? 0,
          d14: r?.d14 ?? 0,
          d30: r?.d30 ?? 0,
        };
      });

      const validCohorts = cohorts.filter((c) => c.size > 0);

      let d1Improving = false;
      let d7Improving = false;
      if (validCohorts.length >= 2) {
        const firstHalf = validCohorts.slice(0, Math.floor(validCohorts.length / 2));
        const secondHalf = validCohorts.slice(Math.floor(validCohorts.length / 2));
        const avgD1First = firstHalf.reduce((s, c) => s + c.d1, 0) / firstHalf.length;
        const avgD1Second = secondHalf.reduce((s, c) => s + c.d1, 0) / secondHalf.length;
        const avgD7First = firstHalf.reduce((s, c) => s + c.d7, 0) / firstHalf.length;
        const avgD7Second = secondHalf.reduce((s, c) => s + c.d7, 0) / secondHalf.length;
        d1Improving = avgD1Second > avgD1First;
        d7Improving = avgD7Second > avgD7First;
      }

      const steps = ["d1", "d3", "d7", "d14", "d30"] as const;
      let worstDropOff = { from_step: "signup", to_step: "d1", drop_pct: 0 };
      if (validCohorts.length > 0) {
        const avg = (key: typeof steps[number]) =>
          validCohorts.reduce((s, c) => s + c[key], 0) / validCohorts.length;

        const avgValues = [1.0, avg("d1"), avg("d3"), avg("d7"), avg("d14"), avg("d30")];
        const stepLabels = ["signup", "d1", "d3", "d7", "d14", "d30"];
        let maxDrop = 0;
        for (let i = 0; i < avgValues.length - 1; i++) {
          const drop = avgValues[i] > 0 ? (avgValues[i] - avgValues[i + 1]) / avgValues[i] : 0;
          if (drop > maxDrop) {
            maxDrop = drop;
            worstDropOff = {
              from_step: stepLabels[i],
              to_step: stepLabels[i + 1],
              drop_pct: Math.round(drop * 10000) / 100,
            };
          }
        }
      }

      const flags: string[] = [];
      const latestCohort = validCohorts[validCohorts.length - 1];
      if (latestCohort) {
        if (latestCohort.d1 < 0.30) flags.push("poor_d1_retention");
        if (latestCohort.d7 < 0.10) flags.push("critical_d7_retention");
        if (latestCohort.d30 < 0.03) flags.push("critical_d30_retention");
      }
      if (!d1Improving) flags.push("d1_not_improving");
      if (!d7Improving) flags.push("d7_not_improving");

      const insights: string[] = [];
      if (worstDropOff.drop_pct > 50) {
        insights.push(`Biggest drop-off is ${worstDropOff.from_step} → ${worstDropOff.to_step} (${worstDropOff.drop_pct}%). Focus retention efforts here.`);
      }
      if (d1Improving) insights.push("D1 retention is trending upward — recent changes may be helping.");
      else insights.push("D1 retention is flat or declining — investigate onboarding and first-session experience.");
      if (d7Improving) insights.push("D7 retention improving — core loop may be strengthening.");
      else insights.push("D7 retention not improving — players may not be finding long-term value.");

      const result = {
        cohorts,
        trends: { d1_improving: d1Improving, d7_improving: d7Improving },
        benchmarks: {
          d1: { good: 0.40, great: 0.60 },
          d7: { good: 0.15, great: 0.25 },
          d30: { good: 0.05, great: 0.10 },
        },
        worst_drop_off: worstDropOff,
        flags,
        insights,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // Tool 4: economy_audit
  // ──────────────────────────────────────────────
  server.tool(
    "economy_audit",
    "Economy health analysis: currency distribution, inflation detection, source/sink balance, whale identification. Use to detect economic imbalances before they impact gameplay.",
    {
      game_id: z.string().describe("Game UUID"),
    },
    async ({ game_id }) => {
      const economy = await safeRpc(api, "analytics_economy_health", { game_id });

      const totalCoins = economy?.total_coins ?? 0;
      const totalGems = economy?.total_gems ?? 0;
      const avgCoins = economy?.avg_coins ?? 0;
      const medianCoins = economy?.median_coins ?? 0;
      const gini = economy?.gini ?? 0;

      const sourcesTotal = economy?.sources_total ?? 0;
      const sinksTotal = economy?.sinks_total ?? Math.max(1, sourcesTotal);
      const ratio = sinksTotal > 0 ? sourcesTotal / sinksTotal : 1;

      const trend: "inflating" | "balanced" | "deflating" =
        ratio > 1.2 ? "inflating" : ratio < 0.8 ? "deflating" : "balanced";

      const whaleCount = economy?.whale_count ?? 0;
      const totalPlayers = economy?.total_players ?? Math.max(1, whaleCount);
      const whalePct = totalPlayers > 0 ? whaleCount / totalPlayers : 0;
      const whaleCoinsHeldPct = economy?.whale_coins_held_pct ?? 0;

      let healthStatus: "healthy" | "inflating" | "deflating" | "concentrated";
      if (gini > 0.6 && whaleCoinsHeldPct > 0.5) healthStatus = "concentrated";
      else if (ratio > 1.5) healthStatus = "inflating";
      else if (ratio < 0.6) healthStatus = "deflating";
      else healthStatus = "healthy";

      const flags: string[] = [];
      if (ratio > 1.5) flags.push("inflation_risk");
      if (gini > 0.6) flags.push("wealth_concentration");
      const totalTxns = economy?.total_transactions ?? (sourcesTotal + sinksTotal);
      if (totalTxns < 100) flags.push("economy_stagnant");

      const recommendations: string[] = [];
      if (flags.includes("inflation_risk")) {
        recommendations.push("Introduce new currency sinks (cosmetic shops, upgrade costs) to absorb excess currency");
        recommendations.push("Review reward payouts — sources significantly exceed sinks");
      }
      if (flags.includes("wealth_concentration")) {
        recommendations.push("Consider catch-up mechanics for newer or low-balance players");
        recommendations.push("Add diminishing returns on high-value currency sources");
      }
      if (flags.includes("economy_stagnant")) {
        recommendations.push("Economy has low transaction volume — add more reasons for players to earn and spend");
      }
      if (recommendations.length === 0) {
        recommendations.push("Economy appears balanced — continue monitoring source/sink ratio");
      }

      const result = {
        health: { status: healthStatus },
        distribution: { total_coins: totalCoins, total_gems: totalGems, avg_coins: avgCoins, median_coins: medianCoins, gini },
        flow: { sources_total: sourcesTotal, sinks_total: sinksTotal, ratio, trend },
        whales: { count: whaleCount, pct_of_population: whalePct, coins_held_pct: whaleCoinsHeldPct },
        benchmarks: {
          gini: { healthy: 0.4, warning: 0.6, yours: gini },
          source_sink: { healthy_range: [0.8, 1.2], yours: ratio },
        },
        flags,
        recommendations,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // Tool 5: experience_quality
  // ──────────────────────────────────────────────
  server.tool(
    "experience_quality",
    "Player experience quality report: error rates, session quality, frustration signals. Use to identify technical issues and bad player experiences that hurt retention.",
    {
      game_id: z.string().describe("Game UUID"),
      days: z.number().optional().describe("Days to look back, default 7"),
    },
    async ({ game_id, days }) => {
      const lookback = days ?? 7;

      const [errorLog, sessions] = await Promise.all([
        safeRpc(api, "analytics_error_log", { game_id, days: lookback }),
        safeRpc(api, "analytics_session_stats", { game_id, days: lookback }),
      ]);

      const totalErrors = errorLog?.total ?? 0;
      const errorsPerDay = lookback > 0 ? totalErrors / lookback : 0;
      const topErrors: Array<{ rpc: string; count: number }> = errorLog?.top_errors ?? [];
      const mostFailingRpc = topErrors.length > 0 ? topErrors[0].rpc : "none";

      const totalRequests = errorLog?.total_requests ?? Math.max(1, totalErrors * 20);
      const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

      const avgDuration = sessions?.avg_duration ?? 0;
      const avgDurationMin = avgDuration / 60;
      const veryShortSessionsPct = sessions?.very_short_sessions_pct ?? 0;
      const abandonmentSignals = sessions?.abandonment_signals ?? 0;

      const errorScore = clamp(1 - errorRate / 0.05, 0, 1) * 40;
      const sessionQualityScore = clamp(avgDurationMin / 10, 0, 1) * 35;
      const shortSessionPenalty = clamp(1 - veryShortSessionsPct, 0, 1) * 25;
      const qualityScore = Math.round(errorScore + sessionQualityScore + shortSessionPenalty);

      const flags: string[] = [];
      if (errorRate > 0.05) flags.push("high_error_rate");
      if (avgDurationMin < 2) flags.push("short_sessions");
      if (topErrors.length > 0) {
        const topErrorCount = topErrors[0]?.count ?? 0;
        if (totalErrors > 0 && topErrorCount / totalErrors > 0.10) {
          flags.push("specific_rpc_failing");
        }
      }

      const recommendations: string[] = [];
      if (flags.includes("high_error_rate")) {
        recommendations.push(`Error rate is ${(errorRate * 100).toFixed(1)}% — investigate and fix top failing RPCs`);
      }
      if (flags.includes("specific_rpc_failing")) {
        recommendations.push(`RPC "${mostFailingRpc}" accounts for a disproportionate share of errors — prioritize fixing it`);
      }
      if (flags.includes("short_sessions")) {
        recommendations.push("Average sessions under 2 minutes — check for early frustration points, loading issues, or unclear value proposition");
      }
      if (veryShortSessionsPct > 0.3) {
        recommendations.push(`${(veryShortSessionsPct * 100).toFixed(0)}% of sessions are very short — possible crash or rage-quit signal`);
      }
      if (recommendations.length === 0) {
        recommendations.push("Experience quality looks good — no critical issues detected");
      }

      const result = {
        quality_score: qualityScore,
        errors: {
          total: totalErrors,
          rate_per_day: Math.round(errorsPerDay * 100) / 100,
          most_failing_rpc: mostFailingRpc,
          top_errors: topErrors.slice(0, 10),
        },
        sessions: {
          avg_duration: avgDuration,
          very_short_sessions_pct: veryShortSessionsPct,
          abandonment_signals: abandonmentSignals,
        },
        benchmarks: {
          error_rate: { good: 0.01, acceptable: 0.05, yours: Math.round(errorRate * 10000) / 10000 },
          session_quality: { good_avg_minutes: 5, yours: Math.round(avgDurationMin * 100) / 100 },
        },
        flags,
        recommendations,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ──────────────────────────────────────────────
  // Tool 6: growth_opportunities
  // ──────────────────────────────────────────────
  server.tool(
    "growth_opportunities",
    "Growth opportunity analysis: underused features, funnel drop-offs, engagement leverage points. Use to identify the highest-impact changes for player acquisition, activation, and retention.",
    {
      game_id: z.string().describe("Game UUID"),
    },
    async ({ game_id }) => {
      const [featureData, funnelData, engagementData] = await Promise.all([
        safeRpc(api, "analytics_feature_adoption", { game_id }),
        safeRpc(api, "analytics_funnel", { game_id }),
        safeRpc(api, "analytics_engagement_score", { game_id }),
      ]);

      const rawSteps: Array<{ name: string; count: number }> = funnelData?.steps ?? [];
      const funnelSteps = rawSteps.map((step, i) => {
        const pct = rawSteps[0]?.count > 0 ? step.count / rawSteps[0].count : 0;
        const prevCount = i > 0 ? rawSteps[i - 1].count : step.count;
        const dropOff = prevCount > 0 ? (prevCount - step.count) / prevCount : 0;
        return {
          name: step.name,
          count: step.count,
          pct: Math.round(pct * 10000) / 100,
          drop_off: Math.round(dropOff * 10000) / 100,
        };
      });

      let worstDropOff = { step: "none", drop_pct: 0 };
      for (const step of funnelSteps) {
        if (step.drop_off > worstDropOff.drop_pct) {
          worstDropOff = { step: step.name, drop_pct: step.drop_off };
        }
      }

      const features: Array<{ name: string; adoption_pct: number; engagement_correlation?: number }> =
        featureData?.features ?? [];

      const sortedByAdoption = [...features].sort((a, b) => b.adoption_pct - a.adoption_pct);
      const mostUsed = sortedByAdoption.slice(0, 5).map((f) => ({ name: f.name, pct: f.adoption_pct }));
      const leastUsed = sortedByAdoption.slice(-5).reverse().map((f) => ({ name: f.name, pct: f.adoption_pct }));

      const untapped = features
        .filter((f) => f.adoption_pct < 0.10 && (f.engagement_correlation ?? 0) > 0.3)
        .map((f) => ({
          name: f.name,
          pct: f.adoption_pct,
          potential_impact: f.engagement_correlation ?? 0,
        }));

      const opportunities: Array<{
        type: "funnel_fix" | "feature_promote" | "engagement_boost";
        description: string;
        impact: "high" | "medium" | "low";
        effort: "low" | "medium" | "high";
        details: string;
      }> = [];

      const onboardingSteps = funnelSteps.filter((s) =>
        s.name.toLowerCase().includes("onboard") ||
        s.name.toLowerCase().includes("tutorial") ||
        s.name.toLowerCase().includes("signup") ||
        s.name.toLowerCase().includes("first")
      );
      if (onboardingSteps.some((s) => s.drop_off > 30)) {
        opportunities.push({
          type: "funnel_fix",
          description: "Simplify onboarding — high drop-off detected at early funnel steps",
          impact: "high",
          effort: "medium",
          details: `Onboarding steps show >${30}% drop-off. Reduce friction, shorten tutorial, or add skip option.`,
        });
      }

      if (worstDropOff.drop_pct > 40) {
        opportunities.push({
          type: "funnel_fix",
          description: `Fix drop-off at "${worstDropOff.step}" funnel step`,
          impact: "high",
          effort: "medium",
          details: `${worstDropOff.drop_pct}% of users drop off at this step. Investigate UX, loading time, or unclear value.`,
        });
      }

      for (const feat of untapped) {
        opportunities.push({
          type: "feature_promote",
          description: `Promote "${feat.name}" — low adoption but high engagement correlation`,
          impact: "medium",
          effort: "low",
          details: `Only ${(feat.pct * 100).toFixed(1)}% adoption but ${(feat.potential_impact * 100).toFixed(0)}% engagement correlation. Surface it more prominently.`,
        });
      }

      const socialFeatures = features.filter((f) =>
        f.name.toLowerCase().includes("social") ||
        f.name.toLowerCase().includes("friend") ||
        f.name.toLowerCase().includes("chat") ||
        f.name.toLowerCase().includes("guild") ||
        f.name.toLowerCase().includes("group")
      );
      const lowSocial = socialFeatures.filter((f) => f.adoption_pct < 0.20);
      if (lowSocial.length > 0) {
        opportunities.push({
          type: "engagement_boost",
          description: "Add social prompts — social features are underused",
          impact: "high",
          effort: "low",
          details: `Social features (${lowSocial.map((f) => f.name).join(", ")}) have <20% adoption. Add contextual prompts to invite friends or join groups.`,
        });
      }

      if (opportunities.length === 0) {
        opportunities.push({
          type: "engagement_boost",
          description: "No critical gaps detected — consider A/B testing engagement experiments",
          impact: "medium",
          effort: "medium",
          details: "Funnel and features look reasonable. Run experiments on push notification timing, reward amounts, or UI changes.",
        });
      }

      const flags: string[] = [];
      if (worstDropOff.drop_pct > 50) flags.push("severe_funnel_drop_off");
      if (untapped.length > 2) flags.push("multiple_untapped_features");
      if (lowSocial.length > 0) flags.push("low_social_adoption");
      if (funnelSteps.length > 0 && funnelSteps[funnelSteps.length - 1].pct < 5) {
        flags.push("very_low_funnel_completion");
      }

      const prioritized = [...opportunities].sort((a, b) => {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        const effortOrder = { low: 3, medium: 2, high: 1 };
        return (impactOrder[b.impact] + effortOrder[b.effort]) - (impactOrder[a.impact] + effortOrder[a.effort]);
      });
      const priorityRecommendation = prioritized[0]?.description ?? "No specific recommendation";

      const result = {
        funnel: { steps: funnelSteps, worst_drop_off: worstDropOff },
        features: { most_used: mostUsed, least_used: leastUsed, untapped },
        opportunities,
        flags,
        priority_recommendation: priorityRecommendation,
      };

      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}
