import { callRpc, type RpcOptions } from "../client";

function unwrapData<T>(value: unknown): T {
  if (value && typeof value === "object" && "success" in value) {
    const envelope = value as { success: boolean; data?: T; error?: string };
    if (envelope.success === false) {
      throw new Error(envelope.error ?? "RPC request failed");
    }
    if ("data" in envelope) {
      return envelope.data as T;
    }
  }
  return value as T;
}

export interface OnboardingScreenFunnelStep {
  screen: string;
  label: string;
  users: number;
  pctOfStart: number;
  avgDwellSec: number;
  exits: number;
  dropCount: number;
  topDropRank?: number;
}

export interface OnboardingDropoffHotspot {
  screen: string;
  label: string;
  users: number;
  pctOfIncomplete: number;
}

export interface OnboardingFunnelSummary {
  totalUsers: number;
  started: number;
  completed: number;
  completionRatePct: number;
  returnedToApp: number;
  returnedToAppPct: number;
  trueDropCount: number;
  medianDurationMin: number;
  identityLinksTotal?: number;
  identityMergesApplied?: number;
  linkedUsersInFunnel?: number;
}

export interface OnboardingPaywallStats {
  seen: number;
  seenPctOfStart: number;
  subscribed: number;
  trialStarts: number;
  dismissed: number;
  skipped: number;
  dropOff: number;
  closingOfferSeen?: number;
  closingOfferClaimed?: number;
  closingOfferClaimRatePct?: number;
  subscribeRatePct: number;
  trialRatePct: number;
  skipRatePct: number;
  dismissRatePct: number;
  abBreakdown?: {
    hard: { seen: number; converted: number; conversionRatePct: number };
    soft: { seen: number; converted: number; conversionRatePct: number };
  };
}

export interface OnboardingWelcomeThemeVariant {
  users: number;
  completed: number;
  completionRatePct: number;
  paywallSeen: number;
  paywallReachPct: number;
  subscribed: number;
  subscribeRatePct: number;
}

export interface OnboardingWelcomeThemeAB {
  v1: OnboardingWelcomeThemeVariant;
  lavender: OnboardingWelcomeThemeVariant;
  unknown: number;
}

export interface OnboardingEventSignalGroup {
  registerStart?: number;
  registerStartPct?: number;
  obComplete?: number;
  obCompletePct?: number;
  appLaunchSuccess?: number;
  appLaunchSuccessPct?: number;
  welcomeReturnToApp?: number;
  welcomeReturnPct?: number;
  signinHandoffNative?: number;
  signinHandoffPct?: number;
  returnedToAppTotal?: number;
  returnedToAppPct?: number;
  pathwayConfirmed?: number;
  pathwayConfirmedPct?: number;
  nameSet?: number;
  nameSetPct?: number;
  quizFirstAnswer?: number;
  quizFirstAnswerPct?: number;
  medianQuizFirstAnswerSec?: number;
  reviewPromptShown?: number;
  reviewPromptShownPct?: number;
  newsletterSkip?: number;
  newsletterSkipPct?: number;
  planViewed?: number;
  planViewedPct?: number;
  d1Return?: number;
  d1ReturnPct?: number;
  d7Return?: number;
  d7ReturnPct?: number;
  welcomeBonusClaimed?: number;
  welcomeBonusClaimedPct?: number;
  streakShieldActivated?: number;
  streakShieldActivatedPct?: number;
}

export interface OnboardingEventSignals {
  funnel?: OnboardingEventSignalGroup;
  handoff?: OnboardingEventSignalGroup;
  quality?: OnboardingEventSignalGroup;
  retention?: OnboardingEventSignalGroup;
}

export interface OnboardingPathwayRow {
  pathway: string;
  label: string;
  users: number;
  completed: number;
  completionRatePct: number;
}

export interface OnboardingPrePathway {
  users: number;
  completed: number;
  completionRatePct: number;
  pctOfStart: number;
}

export interface OnboardingUserRow {
  nakamaUserId: string;
  guestId: string;
  pathway: string;
  country: string;
  platform: string;
  lastScreen: string;
  lastScreenLabel: string;
  status: string;
  completed: boolean;
  subscribed: boolean;
  paywallSeen: boolean;
  paywallSubscribe: boolean;
  paywallTrialStart: boolean;
  paywallDismiss: boolean;
  paywallSkip: boolean;
  eventCount: number;
  lastTs: number;
  durationMs: number;
  welcomeTheme?: string;
}

export interface OnboardingFunnelAnalyticsParams {
  days?: number;
  since_ms?: number;
  until_ms?: number;
  pathway?: string;
  platform?: string;
  status?: string;
  welcome_theme?: string;
  user_limit?: number;
  game_id?: string;
}

export interface OnboardingFunnelAnalyticsResult {
  sinceMs: number;
  untilMs: number;
  days: number;
  pathway: string | null;
  platform: string | null;
  status: string | null;
  welcomeTheme: string | null;
  truncated: boolean;
  summary: OnboardingFunnelSummary;
  paywall: OnboardingPaywallStats;
  screenFunnel: OnboardingScreenFunnelStep[];
  dropoffHotspots: OnboardingDropoffHotspot[];
  welcomeThemeAB?: OnboardingWelcomeThemeAB;
  eventSignals?: OnboardingEventSignals;
  pathways?: OnboardingPathwayRow[];
  prePathway?: OnboardingPrePathway | null;
  users?: OnboardingUserRow[];
  usersTotal?: number;
}

/** Same RPC as analytics.html → Funnel → Web Onboarding (Live). */
export function getOnboardingFunnelAnalytics(
  params: OnboardingFunnelAnalyticsParams,
  opts: RpcOptions,
): Promise<OnboardingFunnelAnalyticsResult> {
  return callRpc<OnboardingFunnelAnalyticsParams, unknown>(
    "onboarding_funnel_analytics",
    params,
    opts,
  ).then((value) => unwrapData<OnboardingFunnelAnalyticsResult>(value));
}
