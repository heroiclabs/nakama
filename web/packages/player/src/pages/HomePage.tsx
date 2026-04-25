import { useQuery } from "@tanstack/react-query";
import {
  hiro,
  satori,
  useAuthStore,
  useRpcOptions,
} from "@nakama/shared";
import type { LiveEvent } from "@nakama/shared";
import {
  CalendarClock,
  Flame,
  Gift,
  Loader2,
  Scroll,
  Shield,
  Swords,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePersonalization } from "../hooks/use-personalization";
import {
  HeroBanner,
  RecommendedActivities,
  PersonalMessages,
} from "../components/PersonalizationWidgets";

/* ---------- tiny section card ---------- */

function Card({
  title,
  icon: Icon,
  accent,
  children,
  className,
}: {
  title: string;
  icon: React.ElementType;
  accent?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        className,
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon size={16} className={accent ?? "text-muted-foreground"} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/* ---------- individual section components ---------- */

function DailyRewardsCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "streaks"],
    queryFn: () => hiro.listStreaks(rpc),
  });

  if (isLoading) return <CardSkeleton title="Daily Rewards" icon={Gift} />;

  const streaks = (data as { streaks?: Record<string, unknown>[] })?.streaks ?? [];
  const currentStreak = streaks.length;

  return (
    <Card title="Daily Rewards" icon={Gift} accent="text-amber-500">
      <p className="text-2xl font-bold tabular-nums">
        {currentStreak}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          day streak
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {currentStreak > 0 ? "Keep it up!" : "Log in daily to earn rewards"}
      </p>
    </Card>
  );
}

function QuestsCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "challenges"],
    queryFn: () => hiro.listChallenges(rpc),
  });

  if (isLoading) return <CardSkeleton title="Active Quests" icon={Scroll} />;

  const challenges =
    (data as { challenges?: Record<string, unknown>[] })?.challenges ?? [];
  const active = challenges.length;

  return (
    <Card title="Active Quests" icon={Scroll} accent="text-emerald-500">
      <p className="text-2xl font-bold tabular-nums">
        {active}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          active
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {active > 0
          ? "Complete quests to earn rewards"
          : "No active quests right now"}
      </p>
    </Card>
  );
}

function LiveEventsCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "live-events"],
    queryFn: () => satori.listLiveEvents(rpc),
  });

  if (isLoading)
    return <CardSkeleton title="Live Events" icon={CalendarClock} />;

  const events: LiveEvent[] = (data as { events?: LiveEvent[] })?.events ?? [];
  const now = Math.floor(Date.now() / 1000);
  const live = events.filter(
    (e) =>
      e.enabled &&
      (e.start_time_sec ?? 0) <= now &&
      (e.end_time_sec ?? Infinity) >= now,
  );

  return (
    <Card title="Live Events" icon={CalendarClock} accent="text-sky-500">
      <p className="text-2xl font-bold tabular-nums">
        {live.length}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          happening now
        </span>
      </p>
      {live.length > 0 && (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {live[0].name}
          {live.length > 1 && ` +${live.length - 1} more`}
        </p>
      )}
    </Card>
  );
}

function ProgressionCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "progression"],
    queryFn: () => hiro.getProgression(rpc),
  });

  if (isLoading)
    return <CardSkeleton title="Battle Pass" icon={Shield} />;

  const prog = data as Record<string, unknown> | undefined;
  const precisions =
    (prog?.progressions as Record<string, unknown> | undefined) ?? {};
  const count = Object.keys(precisions).length;

  return (
    <Card title="Battle Pass" icon={Shield} accent="text-violet-500">
      <p className="text-2xl font-bold tabular-nums">
        {count}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          {count === 1 ? "track" : "tracks"}
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {count > 0 ? "Advance tiers to unlock rewards" : "No active passes"}
      </p>
    </Card>
  );
}

function EnergyCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "energy"],
    queryFn: () => hiro.getEnergy(rpc),
  });

  if (isLoading) return <CardSkeleton title="Energy" icon={Zap} />;

  const energyData = data as Record<string, unknown> | undefined;
  const energies =
    (energyData?.energies as Record<string, { current?: number; max?: number }> | undefined) ??
    {};
  const first = Object.values(energies)[0];
  const current = first?.current ?? 0;
  const max = first?.max ?? 0;
  const pct = max > 0 ? Math.round((current / max) * 100) : 0;

  return (
    <Card title="Energy" icon={Zap} accent="text-yellow-400">
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold tabular-nums">{current}</p>
        <p className="mb-0.5 text-sm text-muted-foreground">/ {max}</p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-yellow-400 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </Card>
  );
}

function IncentivesCard() {
  const rpc = useRpcOptions();
  const { data, isLoading } = useQuery({
    queryKey: ["player", "incentives"],
    queryFn: () => hiro.listIncentives(rpc),
  });

  if (isLoading) return <CardSkeleton title="Incentives" icon={Swords} />;

  const incentiveData = data as Record<string, unknown> | undefined;
  const incentives =
    (incentiveData?.incentives as Record<string, unknown>[] | undefined) ?? [];

  return (
    <Card title="Incentives" icon={Swords} accent="text-rose-500">
      <p className="text-2xl font-bold tabular-nums">
        {incentives.length}
        <span className="ml-1 text-sm font-normal text-muted-foreground">
          available
        </span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {incentives.length > 0
          ? "Check your daily goals and bonuses"
          : "No incentives right now"}
      </p>
    </Card>
  );
}

/* ---------- loading skeleton ---------- */

function CardSkeleton({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.ElementType;
}) {
  return (
    <Card title={title} icon={Icon}>
      <div className="flex items-center gap-2">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading&hellip;</span>
      </div>
    </Card>
  );
}

/* ---------- streak fire row ---------- */

function StreakBar() {
  const rpc = useRpcOptions();
  const { data } = useQuery({
    queryKey: ["player", "streaks"],
    queryFn: () => hiro.listStreaks(rpc),
  });

  const streaks =
    (data as { streaks?: Record<string, unknown>[] })?.streaks ?? [];
  if (streaks.length === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card/60 px-4 py-2">
      <Flame size={18} className="text-orange-500" />
      <span className="text-sm font-medium">
        {streaks.length}-day streak
      </span>
      <span className="text-xs text-muted-foreground">
        &mdash; don&apos;t break it!
      </span>
    </div>
  );
}

/* ---------- main page ---------- */

export function HomePage() {
  const user = useAuthStore((s) => s.user);
  const displayName = user?.display_name || user?.username || "Player";
  const p = usePersonalization();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">
          Welcome back, {displayName}
        </h2>
        <p className="text-muted-foreground">
          Your daily rewards, quests, and events at a glance.
        </p>
      </div>

      {p.heroBanner && <HeroBanner banner={p.heroBanner} />}
      {p.comebackReward && <HeroBanner banner={p.comebackReward} />}

      <PersonalMessages messages={p.personalMessages} />

      <StreakBar />

      <RecommendedActivities items={p.recommendedActivities} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <DailyRewardsCard />
        <QuestsCard />
        <LiveEventsCard />
        <ProgressionCard />
        <EnergyCard />
        <IncentivesCard />
      </div>
    </div>
  );
}
