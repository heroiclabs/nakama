import { useState, useRef, useEffect, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type IncentiveListResponse,
  type Incentive,
  type IncentiveTier,
  type IncentiveReward,
  hiro,
  useRpcOptions,
} from "@nakama/shared";
import { cn } from "@/lib/utils";
import {
  Crown,
  Lock,
  Check,
  Gift,
  Clock,
  Zap,
  ChevronLeft,
  ChevronRight,
  Gem,
  Coins,
  Trophy,
  Sparkles,
} from "lucide-react";

/* ---- helpers ---- */

function timeUntil(epochSec?: number): string {
  if (!epochSec) return "";
  const diff = epochSec * 1000 - Date.now();
  if (diff <= 0) return "Ended";
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return `${d}d ${h}h`;
  const m = Math.floor((diff % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function rewardParts(r?: IncentiveReward): string[] {
  if (!r) return [];
  const parts: string[] = [];
  if (r.currencies)
    for (const [k, v] of Object.entries(r.currencies))
      parts.push(`${v.toLocaleString()} ${k}`);
  if (r.items) for (const it of r.items) parts.push(`${it.count}× ${it.id}`);
  if (r.energies)
    for (const [k, v] of Object.entries(r.energies))
      parts.push(`${v} ${k} energy`);
  if (r.xp) parts.push(`${r.xp} XP`);
  return parts;
}

function rewardIcon(r?: IncentiveReward) {
  if (!r) return <Gift className="h-4 w-4" />;
  if (r.items && r.items.length > 0) return <Sparkles className="h-4 w-4" />;
  if (r.currencies) {
    if (Object.keys(r.currencies).includes("gems"))
      return <Gem className="h-4 w-4" />;
    return <Coins className="h-4 w-4" />;
  }
  if (r.xp) return <Zap className="h-4 w-4" />;
  return <Gift className="h-4 w-4" />;
}

function pickBestIncentive(list: Record<string, Incentive>): Incentive | null {
  const all = Object.values(list);
  if (all.length === 0) return null;
  const now = Date.now() / 1000;
  const active = all.filter((i) => !i.end_time_sec || i.end_time_sec > now);
  return active.length > 0 ? active[0] : all[0];
}

/* ---- Tier Card ---- */

interface TierCardProps {
  tier: IncentiveTier;
  isPremiumUser: boolean;
  currentPoints: number;
  isCurrent: boolean;
  onClaim: () => void;
  claiming: boolean;
}

function TierCard({
  tier,
  isPremiumUser,
  currentPoints,
  isCurrent,
  onClaim,
  claiming,
}: TierCardProps) {
  const reached = currentPoints >= tier.points_required;
  const freeClaimable = reached && !tier.free_claimed && !!tier.free_reward;
  const premiumClaimable =
    reached && isPremiumUser && !tier.premium_claimed && !!tier.premium_reward;

  return (
    <div
      className={cn(
        "relative flex min-w-[140px] flex-col items-center rounded-lg border p-3 transition-all",
        isCurrent && "ring-2 ring-primary",
        reached
          ? "border-primary/40 bg-card"
          : "border-border/50 bg-muted/30 opacity-70",
      )}
    >
      <div
        className={cn(
          "mb-2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
          reached
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-muted-foreground",
        )}
      >
        {tier.tier}
      </div>

      {/* Free reward */}
      <div className="mb-1 w-full space-y-1">
        <div className="text-center text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Free
        </div>
        <div
          className={cn(
            "flex flex-col items-center rounded-md border px-2 py-2 text-center text-xs",
            tier.free_claimed
              ? "border-green-500/30 bg-green-500/10 text-green-400"
              : freeClaimable
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-border/50",
          )}
        >
          {tier.free_claimed ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : tier.free_reward ? (
            <>
              <span className="text-foreground">
                {rewardIcon(tier.free_reward)}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight">
                {rewardParts(tier.free_reward).join(", ") || "Reward"}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        {freeClaimable && (
          <button
            onClick={onClaim}
            disabled={claiming}
            className="w-full rounded bg-amber-500 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            Claim
          </button>
        )}
      </div>

      {/* Premium reward */}
      <div className="w-full space-y-1">
        <div className="flex items-center justify-center gap-1 text-center text-[10px] font-medium uppercase tracking-wider text-amber-400">
          <Crown className="h-3 w-3" /> Premium
        </div>
        <div
          className={cn(
            "relative flex flex-col items-center rounded-md border px-2 py-2 text-center text-xs",
            tier.premium_claimed
              ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
              : premiumClaimable
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-border/50",
            !isPremiumUser && !tier.premium_claimed && "opacity-50",
          )}
        >
          {!isPremiumUser && !tier.premium_claimed && (
            <Lock className="absolute -right-1 -top-1 h-3 w-3 text-muted-foreground" />
          )}
          {tier.premium_claimed ? (
            <Check className="h-4 w-4 text-amber-400" />
          ) : tier.premium_reward ? (
            <>
              <span className="text-foreground">
                {rewardIcon(tier.premium_reward)}
              </span>
              <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight">
                {rewardParts(tier.premium_reward).join(", ") || "Reward"}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
        {premiumClaimable && (
          <button
            onClick={onClaim}
            disabled={claiming}
            className="w-full rounded bg-gradient-to-r from-amber-500 to-orange-500 px-2 py-1 text-[10px] font-semibold text-white transition hover:from-amber-600 hover:to-orange-600 disabled:opacity-50"
          >
            Claim
          </button>
        )}
      </div>

      {!reached && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          {tier.points_required.toLocaleString()} pts
        </div>
      )}
    </div>
  );
}

/* ---- Summary Card ---- */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      {icon}
      <div>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold">{value}</div>
      </div>
    </div>
  );
}

/* ---- Page ---- */

export function BattlepassPage() {
  const rpcOpts = useRpcOptions();
  const qc = useQueryClient();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useQuery<IncentiveListResponse>({
    queryKey: ["hiro", "incentives"],
    queryFn: () => hiro.listIncentives(rpcOpts),
    refetchInterval: 60_000,
  });

  const claimMut = useMutation({
    mutationFn: (id: string) => hiro.claimIncentive(id, rpcOpts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hiro", "incentives"] });
      qc.invalidateQueries({ queryKey: ["nakama", "account"] });
    },
  });

  const pass = data?.incentives ? pickBestIncentive(data.incentives) : null;

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: dir === "left" ? -300 : 300,
      behavior: "smooth",
    });
  };

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!pass || scrolled) return;
    const idx = (pass.tiers ?? []).findIndex(
      (t) => t.points_required > pass.current_points,
    );
    const target = idx <= 0 ? 0 : idx - 1;
    const el = scrollRef.current?.children[target] as HTMLElement | undefined;
    el?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
    setScrolled(true);
  }, [pass, scrolled]);

  const sortedTiers = pass
    ? [...(pass.tiers ?? [])].sort((a, b) => a.tier - b.tier)
    : [];

  const maxPts =
    pass && sortedTiers.length > 0
      ? (pass.max_points ??
        Math.max(...sortedTiers.map((t) => t.points_required), 1))
      : 1;

  const progressPct = pass
    ? Math.min(100, (pass.current_points / maxPts) * 100)
    : 0;

  const currentTierIndex = sortedTiers.findIndex(
    (t) => pass && t.points_required > pass.current_points,
  );

  /* ---- Loading ---- */
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="flex items-center justify-center py-24">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  /* ---- Error ---- */
  if (error) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center text-sm text-destructive">
          Failed to load battle pass.
        </div>
      </div>
    );
  }

  /* ---- Empty ---- */
  if (!pass) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          No active battle pass season.
        </div>
      </div>
    );
  }

  const tiersReached = sortedTiers.filter(
    (t) => pass.current_points >= t.points_required,
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {pass.name || "Battle Pass"}
          </h2>
          <p className="text-muted-foreground">
            {pass.description || "Season progress and rewards."}
          </p>
        </div>

        <div className="flex items-center gap-4 text-sm">
          {pass.end_time_sec && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Clock className="h-4 w-4" />
              {timeUntil(pass.end_time_sec)} remaining
            </span>
          )}
          {pass.is_premium ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500/20 to-orange-500/20 px-3 py-1 text-xs font-semibold text-amber-400">
              <Crown className="h-3.5 w-3.5" /> Premium Active
            </span>
          ) : (
            <button className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-1.5 text-xs font-bold text-white shadow-lg transition hover:shadow-amber-500/25">
              <Crown className="h-3.5 w-3.5" /> Upgrade to Premium
            </button>
          )}
        </div>
      </div>

      {/* XP Progress */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="flex items-center gap-1.5 font-medium">
            <Zap className="h-4 w-4 text-primary" />
            Season Progress
          </span>
          <span className="text-muted-foreground">
            <span className="font-semibold text-foreground">
              {pass.current_points.toLocaleString()}
            </span>{" "}
            / {maxPts.toLocaleString()} XP
          </span>
        </div>
        <div className="h-3 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
          <span>
            Tier {currentTierIndex <= 0 ? sortedTiers.length : currentTierIndex}{" "}
            / {sortedTiers.length}
          </span>
          {currentTierIndex > 0 && currentTierIndex < sortedTiers.length && (
            <span>
              Next tier:{" "}
              {(
                sortedTiers[currentTierIndex].points_required -
                pass.current_points
              ).toLocaleString()}{" "}
              XP needed
            </span>
          )}
        </div>
      </div>

      {/* Tier Track */}
      <div className="relative">
        <button
          onClick={() => scroll("left")}
          className="absolute -left-2 top-1/2 z-10 -translate-y-1/2 rounded-full border bg-card p-1.5 shadow-md transition hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => scroll("right")}
          className="absolute -right-2 top-1/2 z-10 -translate-y-1/2 rounded-full border bg-card p-1.5 shadow-md transition hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        <div
          ref={scrollRef}
          className="flex gap-3 overflow-x-auto px-6 py-2 scrollbar-thin"
        >
          {sortedTiers.map((tier, idx) => (
            <TierCard
              key={tier.tier}
              tier={tier}
              isPremiumUser={pass.is_premium}
              currentPoints={pass.current_points}
              isCurrent={
                currentTierIndex <= 0
                  ? idx === sortedTiers.length - 1
                  : idx === currentTierIndex - 1
              }
              onClaim={() => claimMut.mutate(pass.id)}
              claiming={claimMut.isPending}
            />
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          icon={<Gift className="h-5 w-5 text-primary" />}
          label="Free Claimed"
          value={`${sortedTiers.filter((t) => t.free_claimed).length} / ${sortedTiers.length}`}
        />
        <SummaryCard
          icon={<Crown className="h-5 w-5 text-amber-400" />}
          label="Premium Claimed"
          value={`${sortedTiers.filter((t) => t.premium_claimed).length} / ${sortedTiers.length}`}
        />
        <SummaryCard
          icon={<Trophy className="h-5 w-5 text-emerald-400" />}
          label="Tiers Reached"
          value={`${tiersReached} / ${sortedTiers.length}`}
        />
      </div>

      {/* Premium Upsell */}
      {!pass.is_premium && (
        <div className="overflow-hidden rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/5 via-orange-500/5 to-amber-500/5">
          <div className="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-500 shadow-lg">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold">Unlock Premium Rewards</h3>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Get exclusive items, bonus currencies, and special cosmetics on
                every tier. Retroactively claim all reached premium rewards
                instantly.
              </p>
            </div>
            <button className="shrink-0 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-2.5 text-sm font-bold text-white shadow-lg transition hover:shadow-amber-500/25">
              Upgrade Now
            </button>
          </div>
        </div>
      )}

      {claimMut.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-center text-sm text-destructive">
          Claim failed — please try again.
        </div>
      )}
    </div>
  );
}

function Header() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Battle Pass</h2>
      <p className="text-muted-foreground">Season progress and rewards.</p>
    </div>
  );
}

export { BattlepassPage as default };

export default BattlepassPage;
