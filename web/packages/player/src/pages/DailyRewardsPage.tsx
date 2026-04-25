import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import type { Streak, StreakListResponse, StreakReward } from "@nakama/shared";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Coins,
  Flame,
  Gem,
  Gift,
  Loader2,
  Lock,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function rewardSummary(reward?: StreakReward): string[] {
  if (!reward) return [];
  const parts: string[] = [];
  if (reward.currencies) {
    for (const [k, v] of Object.entries(reward.currencies)) {
      parts.push(`${v.toLocaleString()} ${k}`);
    }
  }
  if (reward.items) {
    for (const item of reward.items) {
      parts.push(`${item.count}x ${item.id}`);
    }
  }
  if (reward.energies) {
    for (const [k, v] of Object.entries(reward.energies)) {
      parts.push(`${v} ${k} energy`);
    }
  }
  return parts;
}

function currencyIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("coin") || lower.includes("gold"))
    return <Coins size={14} className="text-amber-500" />;
  if (lower.includes("gem") || lower.includes("diamond"))
    return <Gem size={14} className="text-violet-400" />;
  if (lower.includes("energy"))
    return <Zap size={14} className="text-emerald-400" />;
  return <Gift size={14} className="text-sky-400" />;
}

function timeUntil(epochSec: number): string {
  const now = Date.now() / 1000;
  const diff = epochSec - now;
  if (diff <= 0) return "Now";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ------------------------------------------------------------------ */
/*  Streak Calendar Day                                               */
/* ------------------------------------------------------------------ */

interface DayProps {
  day: number;
  state: "claimed" | "claimable" | "today" | "future" | "missed";
  reward?: StreakReward;
  isMilestone?: boolean;
}

function DayCell({ day, state, reward, isMilestone }: DayProps) {
  const parts = rewardSummary(reward);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center gap-1 rounded-xl border p-3 transition-all",
        state === "claimed" &&
          "border-emerald-500/30 bg-emerald-950/20 text-emerald-400",
        state === "claimable" &&
          "border-primary/50 bg-primary/10 text-primary ring-2 ring-primary/30",
        state === "today" &&
          "border-amber-500/40 bg-amber-950/20 text-amber-400",
        state === "future" && "border-border/50 bg-card/40 text-muted-foreground",
        state === "missed" &&
          "border-red-500/20 bg-red-950/10 text-red-400/60",
      )}
    >
      {isMilestone && (
        <Sparkles
          size={12}
          className="absolute -right-1 -top-1 text-amber-400"
        />
      )}

      <span className="text-[10px] font-medium uppercase tracking-wider opacity-70">
        Day {day}
      </span>

      <div className="flex h-8 w-8 items-center justify-center rounded-full">
        {state === "claimed" ? (
          <Check size={18} className="text-emerald-400" />
        ) : state === "claimable" ? (
          <Gift size={18} className="animate-pulse text-primary" />
        ) : state === "missed" ? (
          <span className="text-xs">&#10005;</span>
        ) : state === "future" ? (
          <Lock size={14} className="text-muted-foreground/50" />
        ) : (
          <Gift size={16} className="text-amber-400" />
        )}
      </div>

      {parts.length > 0 && (
        <div className="flex flex-wrap justify-center gap-0.5">
          {parts.slice(0, 2).map((p) => (
            <span key={p} className="text-[10px] leading-tight opacity-80">
              {p}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Streak Card                                                       */
/* ------------------------------------------------------------------ */

interface StreakCardProps {
  streak: Streak;
  onClaim: (id: string) => void;
  claiming: boolean;
  justClaimed: string | null;
}

function StreakCard({ streak, onClaim, claiming, justClaimed }: StreakCardProps) {
  const currentDay = streak.count;
  const totalDays = streak.max_count || 7;

  const days = Array.from({ length: Math.min(totalDays, 30) }, (_, i) => {
    const day = i + 1;
    let state: DayProps["state"] = "future";
    if (day < currentDay) state = "claimed";
    else if (day === currentDay && streak.can_claim) state = "claimable";
    else if (day === currentDay) state = "today";
    else if (day < currentDay) state = "missed";

    const tier = streak.rewards?.find((t) => t.tier === day);
    return {
      day,
      state,
      reward: tier?.rewards,
      isMilestone: day % 7 === 0 || day === totalDays,
    };
  });

  const nextReward = streak.next_tier?.rewards;
  const nextParts = rewardSummary(nextReward);

  const wasJustClaimed = justClaimed === streak.id;

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card/60 p-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-xl",
              wasJustClaimed
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-orange-500/20 text-orange-500",
            )}
          >
            <Flame size={22} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">
              {streak.name || streak.id}
            </h3>
            {streak.description && (
              <p className="text-xs text-muted-foreground">
                {streak.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 rounded-full bg-orange-500/10 px-3 py-1">
          <Flame size={14} className="text-orange-500" />
          <span className="text-sm font-bold text-orange-500">
            {streak.count}
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => (
          <DayCell key={d.day} {...d} />
        ))}
      </div>

      {/* Claim bar */}
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3">
        {streak.can_claim ? (
          <>
            <div className="flex-1">
              <p className="text-sm font-medium">
                Day {currentDay} reward ready!
              </p>
              {nextParts.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {nextParts.map((p) => {
                    const name = p.split(" ").slice(1).join(" ");
                    return (
                      <span
                        key={p}
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                      >
                        {currencyIcon(name)}
                        {p}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              disabled={claiming}
              onClick={() => onClaim(streak.id)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all",
                wasJustClaimed
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-primary text-primary-foreground hover:opacity-90",
                claiming && "opacity-50",
              )}
            >
              {claiming ? (
                <Loader2 size={14} className="animate-spin" />
              ) : wasJustClaimed ? (
                <>
                  <Check size={14} />
                  Claimed!
                </>
              ) : (
                <>
                  <Gift size={14} />
                  Claim
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <div className="flex-1">
              <p className="text-sm font-medium text-muted-foreground">
                {streak.reset_time_sec > 0
                  ? `Next reward in ${timeUntil(streak.reset_time_sec)}`
                  : "Come back tomorrow!"}
              </p>
              {nextParts.length > 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  Next: {nextParts.join(", ")}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-muted/50 px-4 py-2 text-sm font-medium text-muted-foreground">
              <CalendarDays size={14} />
            </div>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Progress</span>
          <span>
            {currentDay} / {totalDays} days
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-500 to-amber-400 transition-all duration-500"
            style={{
              width: `${Math.min((currentDay / totalDays) * 100, 100)}%`,
            }}
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Milestone rewards preview                                          */
/* ------------------------------------------------------------------ */

function MilestonePreview({ streak }: { streak: Streak }) {
  const milestones = (streak.rewards ?? []).filter(
    (t) => t.tier % 7 === 0 || t.tier === (streak.max_count || 7),
  );

  if (milestones.length === 0) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card/60 p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-amber-400" />
        <h3 className="text-sm font-semibold">Milestone Rewards</h3>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {milestones.map((m) => {
          const parts = rewardSummary(m.rewards);
          const reached = streak.count >= m.tier;
          return (
            <div
              key={m.tier}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-3 transition-all",
                reached
                  ? "border-emerald-500/30 bg-emerald-950/10"
                  : "border-border/50 bg-background/30",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                  reached
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-muted/50 text-muted-foreground",
                )}
              >
                {m.tier}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium">
                  Day {m.tier} Milestone
                </p>
                {parts.length > 0 && (
                  <p className="truncate text-[10px] text-muted-foreground">
                    {parts.join(" + ")}
                  </p>
                )}
              </div>
              {reached && <Check size={14} className="text-emerald-400" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeletons                                                         */
/* ------------------------------------------------------------------ */

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-6 w-48 animate-pulse rounded bg-muted/50" />
      <div className="h-4 w-64 animate-pulse rounded bg-muted/30" />
      <div className="space-y-4 rounded-2xl border border-border bg-card/60 p-5">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-muted/50" />
          <div className="space-y-1">
            <div className="h-4 w-32 animate-pulse rounded bg-muted/50" />
            <div className="h-3 w-48 animate-pulse rounded bg-muted/30" />
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-xl bg-muted/30"
            />
          ))}
        </div>
        <div className="h-12 animate-pulse rounded-xl bg-muted/30" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                       */
/* ------------------------------------------------------------------ */

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border p-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <CalendarDays size={28} className="text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium text-foreground">No streaks configured</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Streaks will appear here once the game has daily reward tracks set up.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export function DailyRewardsPage() {
  const rpc = useRpcOptions();
  const queryClient = useQueryClient();
  const [justClaimed, setJustClaimed] = useState<string | null>(null);

  const {
    data,
    isLoading,
    error,
  } = useQuery<StreakListResponse>({
    queryKey: ["player", "streaks"],
    queryFn: () => hiro.listStreaks(rpc) as Promise<StreakListResponse>,
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => hiro.claimStreak(id, rpc),
    onSuccess: (_data, id) => {
      setJustClaimed(id);
      queryClient.invalidateQueries({ queryKey: ["player", "streaks"] });
      queryClient.invalidateQueries({ queryKey: ["player", "wallet"] });
      setTimeout(() => setJustClaimed(null), 3000);
    },
  });

  if (isLoading) return <PageSkeleton />;

  const streaks = data?.streaks
    ? Object.values(data.streaks)
    : [];

  const totalStreak = streaks.reduce((sum, s) => sum + s.count, 0);
  const claimable = streaks.filter((s) => s.can_claim).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Daily Rewards</h2>
          <p className="text-muted-foreground">
            Claim your daily streak rewards. Don&apos;t break the chain!
          </p>
        </div>
        {totalStreak > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-orange-500/10 px-4 py-2">
            <Flame size={18} className="text-orange-500" />
            <div className="text-right">
              <p className="text-lg font-bold leading-tight text-orange-500">
                {totalStreak}
              </p>
              <p className="text-[10px] text-orange-500/70">Total Days</p>
            </div>
          </div>
        )}
      </div>

      {/* Claimable banner */}
      {claimable > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Gift size={18} className="text-primary" />
          <span className="flex-1 text-sm font-medium">
            You have{" "}
            <span className="text-primary">
              {claimable} reward{claimable > 1 ? "s" : ""}
            </span>{" "}
            to claim!
          </span>
          <ChevronRight size={16} className="text-primary/50" />
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-950/10 p-4 text-sm text-red-400">
          Failed to load streaks. Please try again later.
        </div>
      )}

      {/* Streaks */}
      {streaks.length === 0 && !isLoading && !error ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          {streaks.map((streak) => (
            <div key={streak.id} className="space-y-4">
              <StreakCard
                streak={streak}
                onClaim={(id) => claimMutation.mutate(id)}
                claiming={
                  claimMutation.isPending &&
                  claimMutation.variables === streak.id
                }
                justClaimed={justClaimed}
              />
              <MilestonePreview streak={streak} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { DailyRewardsPage as default };

export default DailyRewardsPage;
