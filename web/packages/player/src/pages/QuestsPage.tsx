import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import type { Challenge, ChallengeListResponse, ChallengeReward } from "@nakama/shared";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  Coins,
  Gem,
  Gift,
  Loader2,
  ScrollText,
  Swords,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

type Tab = "all" | "daily" | "weekly" | "event" | "other";

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "event", label: "Event" },
  { key: "other", label: "Other" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rewardParts(r?: ChallengeReward): string[] {
  if (!r) return [];
  const parts: string[] = [];
  if (r.currencies) {
    for (const [k, v] of Object.entries(r.currencies))
      parts.push(`${v.toLocaleString()} ${k}`);
  }
  if (r.items) {
    for (const item of r.items) parts.push(`${item.count}× ${item.id}`);
  }
  if (r.energies) {
    for (const [k, v] of Object.entries(r.energies))
      parts.push(`${v} ${k}`);
  }
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts;
}

function mergedRewardParts(c: Challenge): string[] {
  if (c.reward) return rewardParts(c.reward);
  if (c.rewards && c.rewards.length > 0) return rewardParts(c.rewards[0]);
  return [];
}

function currencyIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("gem") || n.includes("diamond"))
    return <Gem className="h-3.5 w-3.5 text-violet-400" />;
  if (n.includes("energy") || n.includes("stamina"))
    return <Zap className="h-3.5 w-3.5 text-emerald-400" />;
  if (n.includes("xp"))
    return <Trophy className="h-3.5 w-3.5 text-sky-400" />;
  return <Coins className="h-3.5 w-3.5 text-amber-400" />;
}

function timeUntil(sec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = sec - now;
  if (diff <= 0) return "Expired";
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function categorize(c: Challenge): Tab {
  const cat = (c.category ?? c.id).toLowerCase();
  if (cat.includes("daily")) return "daily";
  if (cat.includes("weekly") || cat.includes("week")) return "weekly";
  if (cat.includes("event") || cat.includes("season")) return "event";
  if (c.end_time_sec && c.end_time_sec > 0 && c.start_time_sec && c.start_time_sec > 0)
    return "event";
  return "other";
}

function questIcon(c: Challenge) {
  const cat = (c.category ?? c.id).toLowerCase();
  if (cat.includes("daily")) return <Target className="h-5 w-5 text-sky-400" />;
  if (cat.includes("weekly")) return <ScrollText className="h-5 w-5 text-violet-400" />;
  if (cat.includes("event") || cat.includes("season"))
    return <Trophy className="h-5 w-5 text-amber-400" />;
  return <Swords className="h-5 w-5 text-emerald-400" />;
}

/* ------------------------------------------------------------------ */
/*  Quest Card                                                         */
/* ------------------------------------------------------------------ */

interface QuestCardProps {
  quest: Challenge;
  onClaim: () => void;
  claiming: boolean;
  justClaimed: boolean;
  onSelect: () => void;
}

function QuestCard({ quest, onClaim, claiming, justClaimed, onSelect }: QuestCardProps) {
  const pct = quest.max_count > 0
    ? Math.min((quest.current_count / quest.max_count) * 100, 100)
    : 0;
  const isComplete = quest.current_count >= quest.max_count;
  const isClaimed = quest.claim_time_sec > 0;
  const hasTimer = !!quest.end_time_sec && quest.end_time_sec > 0;
  const rewards = mergedRewardParts(quest);

  return (
    <div
      className={cn(
        "group relative flex gap-4 rounded-xl border p-4 transition-all",
        isClaimed
          ? "border-emerald-500/20 bg-emerald-950/5"
          : quest.can_claim
            ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
            : "border-border bg-card/60 hover:border-border/80",
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isClaimed
            ? "bg-emerald-500/10"
            : quest.can_claim
              ? "bg-primary/10"
              : "bg-muted/50",
        )}
      >
        {isClaimed ? (
          <Check className="h-5 w-5 text-emerald-400" />
        ) : (
          questIcon(quest)
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onSelect} className="min-w-0 text-left">
            <h3
              className={cn(
                "text-sm font-semibold leading-tight",
                isClaimed && "text-muted-foreground line-through",
              )}
            >
              {quest.name ?? quest.id}
            </h3>
            {quest.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                {quest.description}
              </p>
            )}
          </button>

          {hasTimer && !isClaimed && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeUntil(quest.end_time_sec!)}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {!isClaimed && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {quest.current_count} / {quest.max_count}
              </span>
              <span>{Math.round(pct)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted/40">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  isComplete
                    ? "bg-gradient-to-r from-emerald-500 to-green-400"
                    : "bg-gradient-to-r from-primary/80 to-primary",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Rewards preview */}
        {rewards.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {rewards.slice(0, 3).map((r) => {
              const name = r.split(" ").slice(1).join(" ");
              return (
                <span
                  key={r}
                  className="flex items-center gap-1 rounded-full bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {currencyIcon(name)}
                  {r}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Action */}
      <div className="flex shrink-0 items-center">
        {isClaimed ? (
          <span className="text-[10px] font-medium text-emerald-400">Done</span>
        ) : quest.can_claim ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClaim();
            }}
            disabled={claiming}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all",
              justClaimed
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-primary text-primary-foreground hover:opacity-90",
              claiming && "opacity-50",
            )}
          >
            {claiming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : justClaimed ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Claimed
              </>
            ) : (
              <>
                <Gift className="h-3.5 w-3.5" />
                Claim
              </>
            )}
          </button>
        ) : (
          <button
            onClick={onSelect}
            className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Detail Drawer                                                      */
/* ------------------------------------------------------------------ */

function QuestDrawer({
  quest,
  onClose,
  onClaim,
  claiming,
  justClaimed,
}: {
  quest: Challenge;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
  justClaimed: boolean;
}) {
  const pct = quest.max_count > 0
    ? Math.min((quest.current_count / quest.max_count) * 100, 100)
    : 0;
  const isClaimed = quest.claim_time_sec > 0;
  const rewards = mergedRewardParts(quest);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />

      <div className="relative z-10 mx-auto w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>

        {/* Icon + Title */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
            {isClaimed ? (
              <Check className="h-6 w-6 text-emerald-400" />
            ) : (
              questIcon(quest)
            )}
          </div>
          <div>
            <h3 className="text-lg font-bold">{quest.name ?? quest.id}</h3>
            {quest.category && (
              <span className="text-xs text-muted-foreground capitalize">
                {quest.category}
              </span>
            )}
          </div>
        </div>

        {/* Description */}
        {quest.description && (
          <p className="mt-4 text-sm text-muted-foreground">
            {quest.description}
          </p>
        )}

        {/* Progress */}
        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>
              {quest.current_count} / {quest.max_count}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted/40">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isClaimed
                  ? "bg-emerald-500"
                  : quest.can_claim
                    ? "bg-gradient-to-r from-emerald-500 to-green-400"
                    : "bg-gradient-to-r from-primary/80 to-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Rewards */}
        {rewards.length > 0 && (
          <div className="mt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rewards
            </h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {rewards.map((r) => {
                const name = r.split(" ").slice(1).join(" ");
                return (
                  <span
                    key={r}
                    className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium"
                  >
                    {currencyIcon(name)}
                    {r}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Timing */}
        {(quest.end_time_sec ?? 0) > 0 && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Expires in {timeUntil(quest.end_time_sec!)}
          </div>
        )}
        {(quest.reset_time_sec ?? 0) > 0 && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Resets in {timeUntil(quest.reset_time_sec!)}
          </div>
        )}

        {/* Claim button */}
        <div className="mt-6">
          {isClaimed ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-400">
              <Check className="h-4 w-4" />
              Completed & Claimed
            </div>
          ) : quest.can_claim ? (
            <button
              onClick={onClaim}
              disabled={claiming}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all",
                justClaimed
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-primary text-primary-foreground hover:opacity-90",
                claiming && "opacity-50",
              )}
            >
              {claiming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : justClaimed ? (
                <>
                  <Check className="h-4 w-4" />
                  Claimed!
                </>
              ) : (
                <>
                  <Gift className="h-4 w-4" />
                  Claim Reward
                </>
              )}
            </button>
          ) : (
            <div className="rounded-lg bg-muted/30 py-2.5 text-center text-sm text-muted-foreground">
              {quest.current_count} / {quest.max_count} completed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton + Empty                                                   */
/* ------------------------------------------------------------------ */

function QuestSkeleton() {
  return (
    <div className="flex gap-4 rounded-xl border border-border bg-card/60 p-4 animate-pulse">
      <div className="h-11 w-11 shrink-0 rounded-xl bg-muted/50" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-40 rounded bg-muted/50" />
        <div className="h-3 w-64 rounded bg-muted/30" />
        <div className="h-1.5 w-full rounded-full bg-muted/30" />
        <div className="flex gap-2">
          <div className="h-5 w-20 rounded-full bg-muted/30" />
          <div className="h-5 w-16 rounded-full bg-muted/30" />
        </div>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <div className="h-7 w-32 animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-56 animate-pulse rounded bg-muted/30" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-16 animate-pulse rounded-lg bg-muted/30" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <QuestSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        <ScrollText className="h-7 w-7 text-muted-foreground" />
      </div>
      <div>
        <p className="font-medium">
          No {tab === "all" ? "" : tab + " "}quests available
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Check back later for new missions and challenges!
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function QuestsPage() {
  const rpc = useRpcOptions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<Challenge | null>(null);
  const [justClaimed, setJustClaimed] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery<ChallengeListResponse>({
    queryKey: ["hiro", "challenges"],
    queryFn: () => hiro.listChallenges(rpc) as Promise<ChallengeListResponse>,
    staleTime: 30_000,
  });

  const claimMutation = useMutation({
    mutationFn: (id: string) => hiro.claimChallenge(id, rpc),
    onSuccess: (_res, id) => {
      setJustClaimed(id);
      queryClient.invalidateQueries({ queryKey: ["hiro", "challenges"] });
      queryClient.invalidateQueries({ queryKey: ["player", "wallet"] });
      setTimeout(() => setJustClaimed(null), 3000);
    },
  });

  if (isLoading) return <PageSkeleton />;

  const all: Challenge[] = data?.challenges
    ? Object.values(data.challenges)
    : [];

  const filtered = tab === "all" ? all : all.filter((c) => categorize(c) === tab);

  const claimableCount = all.filter((c) => c.can_claim).length;
  const completedCount = all.filter((c) => c.claim_time_sec > 0).length;

  const sortedQuests = [...filtered].sort((a, b) => {
    if (a.can_claim && !b.can_claim) return -1;
    if (!a.can_claim && b.can_claim) return 1;
    const aClaimed = a.claim_time_sec > 0;
    const bClaimed = b.claim_time_sec > 0;
    if (aClaimed && !bClaimed) return 1;
    if (!aClaimed && bClaimed) return -1;
    const aPct = a.max_count > 0 ? a.current_count / a.max_count : 0;
    const bPct = b.max_count > 0 ? b.current_count / b.max_count : 0;
    return bPct - aPct;
  });

  const tabCounts: Record<Tab, number> = {
    all: all.length,
    daily: 0,
    weekly: 0,
    event: 0,
    other: 0,
  };
  for (const c of all) {
    tabCounts[categorize(c)]++;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Quests</h2>
          <p className="text-muted-foreground">
            Complete missions to earn rewards.{" "}
            {all.length > 0 && (
              <span className="text-foreground font-medium">
                {completedCount}/{all.length} done
              </span>
            )}
          </p>
        </div>
        {all.length > 0 && (
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2">
            <Target className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-primary">
              {Math.round((completedCount / all.length) * 100)}%
            </span>
          </div>
        )}
      </div>

      {/* Claimable banner */}
      {claimableCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Gift className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-medium">
            <span className="text-primary">{claimableCount}</span> quest
            {claimableCount > 1 ? "s" : ""} ready to claim!
          </span>
          <ChevronRight className="h-4 w-4 text-primary/50" />
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">Failed to load quests</p>
          <p className="mt-1 text-xs opacity-70">
            {(error as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.filter((t) => t.key === "all" || tabCounts[t.key] > 0).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap",
              tab === t.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted/40 text-muted-foreground hover:bg-muted/60",
            )}
          >
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 py-px text-[10px]",
                tab === t.key
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground",
              )}
            >
              {tabCounts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {/* Quest list */}
      {sortedQuests.length === 0 ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-3">
          {sortedQuests.map((q) => (
            <QuestCard
              key={q.id}
              quest={q}
              onClaim={() => claimMutation.mutate(q.id)}
              claiming={claimMutation.isPending && claimMutation.variables === q.id}
              justClaimed={justClaimed === q.id}
              onSelect={() => setSelected(q)}
            />
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {selected && (
        <QuestDrawer
          quest={selected}
          onClose={() => setSelected(null)}
          onClaim={() => claimMutation.mutate(selected.id)}
          claiming={claimMutation.isPending && claimMutation.variables === selected.id}
          justClaimed={justClaimed === selected.id}
        />
      )}
    </div>
  );
}

export { QuestsPage as default };

export default QuestsPage;
