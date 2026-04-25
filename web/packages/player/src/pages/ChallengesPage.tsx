import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, nakama, useRpcOptions } from "@nakama/shared";
import type {
  Challenge,
  ChallengeListResponse,
  ChallengeReward,
  Tournament,
  TournamentList,
  TournamentRecordList,
  LeaderboardRecord,
} from "@nakama/shared";
import { useState } from "react";
import {
  Check,
  ChevronRight,
  Clock,
  Coins,
  Crown,
  Flame,
  Gem,
  Gift,
  Loader2,
  Medal,
  Shield,
  Swords,
  Target,
  Timer,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                   */
/* ------------------------------------------------------------------ */

type Tab = "active" | "pve" | "pvp" | "tournaments" | "completed";

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: "active", label: "Active", icon: <Flame className="h-3.5 w-3.5" /> },
  { key: "pve", label: "PvE", icon: <Shield className="h-3.5 w-3.5" /> },
  { key: "pvp", label: "PvP", icon: <Swords className="h-3.5 w-3.5" /> },
  { key: "tournaments", label: "Tournaments", icon: <Crown className="h-3.5 w-3.5" /> },
  { key: "completed", label: "Completed", icon: <Check className="h-3.5 w-3.5" /> },
];

type ChallengeCategory = "pve" | "pvp" | "competitive";

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

function timeUntilISO(isoStr?: string): string {
  if (!isoStr) return "";
  const ms = new Date(isoStr).getTime() - Date.now();
  if (ms <= 0) return "Ended";
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function classifyChallenge(c: Challenge): ChallengeCategory {
  const cat = (c.category ?? c.id).toLowerCase();
  if (cat.includes("pvp") || cat.includes("versus") || cat.includes("duel"))
    return "pvp";
  if (cat.includes("pve") || cat.includes("solo") || cat.includes("campaign") || cat.includes("boss"))
    return "pve";
  return "competitive";
}

function challengeIcon(c: Challenge) {
  const cat = classifyChallenge(c);
  if (cat === "pvp") return <Swords className="h-5 w-5 text-rose-400" />;
  if (cat === "pve") return <Shield className="h-5 w-5 text-sky-400" />;
  return <Target className="h-5 w-5 text-amber-400" />;
}

function isCompetitiveChallenge(c: Challenge): boolean {
  const cat = (c.category ?? c.id).toLowerCase();
  return (
    cat.includes("pvp") ||
    cat.includes("pve") ||
    cat.includes("challenge") ||
    cat.includes("competitive") ||
    cat.includes("versus") ||
    cat.includes("duel") ||
    cat.includes("boss") ||
    cat.includes("solo") ||
    cat.includes("campaign") ||
    cat.includes("arena") ||
    cat.includes("ranked")
  );
}

/* ------------------------------------------------------------------ */
/*  Challenge Card                                                     */
/* ------------------------------------------------------------------ */

interface ChallengeCardProps {
  challenge: Challenge;
  onClaim: () => void;
  claiming: boolean;
  justClaimed: boolean;
  onSelect: () => void;
}

function ChallengeCard({ challenge, onClaim, claiming, justClaimed, onSelect }: ChallengeCardProps) {
  const pct = challenge.max_count > 0
    ? Math.min((challenge.current_count / challenge.max_count) * 100, 100)
    : 0;
  const isComplete = challenge.current_count >= challenge.max_count;
  const isClaimed = challenge.claim_time_sec > 0;
  const hasTimer = !!challenge.end_time_sec && challenge.end_time_sec > 0;
  const rewards = mergedRewardParts(challenge);
  const category = classifyChallenge(challenge);

  return (
    <div
      className={cn(
        "group relative flex gap-4 rounded-xl border p-4 transition-all",
        isClaimed
          ? "border-emerald-500/20 bg-emerald-950/5"
          : challenge.can_claim
            ? "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
            : "border-border bg-card/60 hover:border-border/80",
      )}
    >
      <div
        className={cn(
          "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
          isClaimed
            ? "bg-emerald-500/10"
            : challenge.can_claim
              ? "bg-primary/10"
              : "bg-muted/50",
        )}
      >
        {isClaimed ? (
          <Check className="h-5 w-5 text-emerald-400" />
        ) : (
          challengeIcon(challenge)
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onSelect} className="min-w-0 text-left">
            <div className="flex items-center gap-2">
              <h3
                className={cn(
                  "text-sm font-semibold leading-tight",
                  isClaimed && "text-muted-foreground line-through",
                )}
              >
                {challenge.name ?? challenge.id}
              </h3>
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider",
                  category === "pvp"
                    ? "bg-rose-500/10 text-rose-400"
                    : category === "pve"
                      ? "bg-sky-500/10 text-sky-400"
                      : "bg-amber-500/10 text-amber-400",
                )}
              >
                {category}
              </span>
            </div>
            {challenge.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                {challenge.description}
              </p>
            )}
          </button>

          {hasTimer && !isClaimed && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeUntil(challenge.end_time_sec!)}
            </span>
          )}
        </div>

        {!isClaimed && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                {challenge.current_count} / {challenge.max_count}
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

      <div className="flex shrink-0 items-center">
        {isClaimed ? (
          <span className="text-[10px] font-medium text-emerald-400">Done</span>
        ) : challenge.can_claim ? (
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
/*  Tournament Card                                                    */
/* ------------------------------------------------------------------ */

interface TournamentCardProps {
  tournament: Tournament;
  onSelect: () => void;
  onJoin: () => void;
  joining: boolean;
}

function TournamentCard({ tournament, onSelect, onJoin, joining }: TournamentCardProps) {
  const endStr = timeUntilISO(tournament.end_time);
  const hasEnded = endStr === "Ended";
  const playerCount = tournament.size ?? 0;
  const maxPlayers = tournament.max_size ?? 0;

  return (
    <div
      className={cn(
        "group flex gap-4 rounded-xl border p-4 transition-all",
        hasEnded
          ? "border-border/50 bg-muted/10 opacity-60"
          : "border-border bg-card/60 hover:border-border/80",
      )}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
        <Crown className="h-5 w-5 text-amber-400" />
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <button onClick={onSelect} className="min-w-0 text-left">
            <h3 className="text-sm font-semibold leading-tight">
              {tournament.title ?? tournament.id}
            </h3>
            {tournament.description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                {tournament.description}
              </p>
            )}
          </button>
          {!hasEnded && tournament.end_time && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              <Timer className="h-3 w-3" />
              {endStr}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {playerCount}{maxPlayers > 0 ? `/${maxPlayers}` : ""} players
          </span>
          {tournament.category !== undefined && (
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              Cat {tournament.category}
            </span>
          )}
          {tournament.operator && (
            <span className="capitalize">{tournament.operator}</span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        {hasEnded ? (
          <button
            onClick={onSelect}
            className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : tournament.can_enter ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onJoin();
            }}
            disabled={joining}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90",
              joining && "opacity-50",
            )}
          >
            {joining ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <>
                <Flame className="h-3.5 w-3.5" />
                Join
              </>
            )}
          </button>
        ) : (
          <span className="rounded-lg bg-muted/30 px-3 py-1.5 text-[10px] font-medium text-muted-foreground">
            Entered
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Challenge Detail Drawer                                            */
/* ------------------------------------------------------------------ */

function ChallengeDrawer({
  challenge,
  onClose,
  onClaim,
  claiming,
  justClaimed,
}: {
  challenge: Challenge;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
  justClaimed: boolean;
}) {
  const pct = challenge.max_count > 0
    ? Math.min((challenge.current_count / challenge.max_count) * 100, 100)
    : 0;
  const isClaimed = challenge.claim_time_sec > 0;
  const rewards = mergedRewardParts(challenge);
  const category = classifyChallenge(challenge);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 mx-auto w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50">
            {isClaimed ? <Check className="h-6 w-6 text-emerald-400" /> : challengeIcon(challenge)}
          </div>
          <div>
            <h3 className="text-lg font-bold">{challenge.name ?? challenge.id}</h3>
            <div className="flex items-center gap-2">
              {challenge.category && (
                <span className="text-xs text-muted-foreground capitalize">{challenge.category}</span>
              )}
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[9px] font-bold uppercase",
                  category === "pvp" ? "bg-rose-500/10 text-rose-400"
                    : category === "pve" ? "bg-sky-500/10 text-sky-400"
                      : "bg-amber-500/10 text-amber-400",
                )}
              >
                {category}
              </span>
            </div>
          </div>
        </div>

        {challenge.description && (
          <p className="mt-4 text-sm text-muted-foreground">{challenge.description}</p>
        )}

        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Progress</span>
            <span>{challenge.current_count} / {challenge.max_count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted/40">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                isClaimed ? "bg-emerald-500"
                  : challenge.can_claim ? "bg-gradient-to-r from-emerald-500 to-green-400"
                    : "bg-gradient-to-r from-primary/80 to-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {rewards.length > 0 && (
          <div className="mt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Rewards</h4>
            <div className="mt-2 flex flex-wrap gap-2">
              {rewards.map((r) => {
                const name = r.split(" ").slice(1).join(" ");
                return (
                  <span key={r} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/20 px-3 py-1.5 text-xs font-medium">
                    {currencyIcon(name)}
                    {r}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {(challenge.end_time_sec ?? 0) > 0 && (
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Expires in {timeUntil(challenge.end_time_sec!)}
          </div>
        )}
        {(challenge.reset_time_sec ?? 0) > 0 && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            Resets in {timeUntil(challenge.reset_time_sec!)}
          </div>
        )}

        <div className="mt-6">
          {isClaimed ? (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-400">
              <Check className="h-4 w-4" />
              Completed & Claimed
            </div>
          ) : challenge.can_claim ? (
            <button
              onClick={onClaim}
              disabled={claiming}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-all",
                justClaimed ? "bg-emerald-500/20 text-emerald-400" : "bg-primary text-primary-foreground hover:opacity-90",
                claiming && "opacity-50",
              )}
            >
              {claiming ? <Loader2 className="h-4 w-4 animate-spin" />
                : justClaimed ? <><Check className="h-4 w-4" /> Claimed!</>
                  : <><Gift className="h-4 w-4" /> Claim Reward</>}
            </button>
          ) : (
            <div className="rounded-lg bg-muted/30 py-2.5 text-center text-sm text-muted-foreground">
              {challenge.current_count} / {challenge.max_count} completed
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tournament Detail Drawer                                           */
/* ------------------------------------------------------------------ */

function TournamentDrawer({
  tournament,
  onClose,
  onJoin,
  joining,
}: {
  tournament: Tournament;
  onClose: () => void;
  onJoin: () => void;
  joining: boolean;
}) {
  const rpc = useRpcOptions();
  const endStr = timeUntilISO(tournament.end_time);
  const hasEnded = endStr === "Ended";

  const { data: recordsData } = useQuery<TournamentRecordList>({
    queryKey: ["tournament-records", tournament.id],
    queryFn: () =>
      nakama.listTournamentRecords(tournament.id, { limit: 10 }, rpc),
    staleTime: 30_000,
  });

  const records: LeaderboardRecord[] = recordsData?.records ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 mx-auto w-full max-w-md rounded-t-2xl border border-border bg-card p-6 shadow-2xl sm:rounded-2xl max-h-[85vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10">
            <Crown className="h-6 w-6 text-amber-400" />
          </div>
          <div>
            <h3 className="text-lg font-bold">{tournament.title ?? tournament.id}</h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Users className="h-3 w-3" />
              {tournament.size ?? 0}{tournament.max_size ? `/${tournament.max_size}` : ""} players
            </div>
          </div>
        </div>

        {tournament.description && (
          <p className="mt-4 text-sm text-muted-foreground">{tournament.description}</p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-3">
          {tournament.end_time && (
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Time Left</p>
              <p className={cn("mt-1 text-sm font-bold", hasEnded ? "text-muted-foreground" : "text-amber-400")}>
                {endStr}
              </p>
            </div>
          )}
          {tournament.operator && (
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Scoring</p>
              <p className="mt-1 text-sm font-bold capitalize">{tournament.operator}</p>
            </div>
          )}
          {tournament.category !== undefined && (
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Category</p>
              <p className="mt-1 text-sm font-bold">{tournament.category}</p>
            </div>
          )}
          {tournament.max_num_score !== undefined && (
            <div className="rounded-lg bg-muted/20 p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Max Scores</p>
              <p className="mt-1 text-sm font-bold">{tournament.max_num_score === 0 ? "Unlimited" : tournament.max_num_score}</p>
            </div>
          )}
        </div>

        {/* Leaderboard preview */}
        {records.length > 0 && (
          <div className="mt-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Leaderboard</h4>
            <div className="mt-2 space-y-1">
              {records.slice(0, 5).map((rec, i) => (
                <div
                  key={rec.owner_id ?? i}
                  className="flex items-center gap-3 rounded-lg bg-muted/10 px-3 py-2 text-xs"
                >
                  <span className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold",
                    i === 0 ? "bg-amber-500/20 text-amber-400"
                      : i === 1 ? "bg-slate-400/20 text-slate-300"
                        : i === 2 ? "bg-orange-500/20 text-orange-400"
                          : "bg-muted/30 text-muted-foreground",
                  )}>
                    {rec.rank ?? i + 1}
                  </span>
                  <span className="flex-1 truncate font-medium">
                    {rec.username ?? rec.owner_id?.slice(0, 8) ?? "Unknown"}
                  </span>
                  <span className="font-bold">{rec.score?.toLocaleString() ?? 0}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-6">
          {hasEnded ? (
            <div className="rounded-lg bg-muted/30 py-2.5 text-center text-sm text-muted-foreground">
              Tournament has ended
            </div>
          ) : tournament.can_enter ? (
            <button
              onClick={onJoin}
              disabled={joining}
              className={cn(
                "flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90",
                joining && "opacity-50",
              )}
            >
              {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Flame className="h-4 w-4" /> Join Tournament</>}
            </button>
          ) : (
            <div className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500/10 py-2.5 text-sm font-medium text-emerald-400">
              <Medal className="h-4 w-4" />
              Already Entered
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

function CardSkeleton() {
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
        <div className="h-7 w-48 animate-pulse rounded bg-muted/50" />
        <div className="h-4 w-72 animate-pulse rounded bg-muted/30" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 w-24 animate-pulse rounded-lg bg-muted/30" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  const messages: Record<Tab, { title: string; desc: string; icon: React.ReactNode }> = {
    active: { title: "No active challenges", desc: "Check back later for new objectives!", icon: <Flame className="h-7 w-7 text-muted-foreground" /> },
    pve: { title: "No PvE challenges", desc: "Solo challenges will appear here.", icon: <Shield className="h-7 w-7 text-muted-foreground" /> },
    pvp: { title: "No PvP challenges", desc: "Competitive challenges will appear here.", icon: <Swords className="h-7 w-7 text-muted-foreground" /> },
    tournaments: { title: "No tournaments", desc: "Timed competitions will appear here.", icon: <Crown className="h-7 w-7 text-muted-foreground" /> },
    completed: { title: "No completed challenges", desc: "Finish challenges to see them here.", icon: <Trophy className="h-7 w-7 text-muted-foreground" /> },
  };
  const m = messages[tab];

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border py-16 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted/50">
        {m.icon}
      </div>
      <div>
        <p className="font-medium">{m.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{m.desc}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function ChallengesPage() {
  const rpc = useRpcOptions();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<Tab>("active");
  const [selectedChallenge, setSelectedChallenge] = useState<Challenge | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [justClaimed, setJustClaimed] = useState<string | null>(null);

  const { data: challengeData, isLoading: challengesLoading, isError: challengesError, error: challengesErr } =
    useQuery<ChallengeListResponse>({
      queryKey: ["hiro", "challenges"],
      queryFn: () => hiro.listChallenges(rpc) as Promise<ChallengeListResponse>,
      staleTime: 30_000,
    });

  const { data: tournamentData, isLoading: tournamentsLoading, isError: tournamentsError, error: tournamentsErr } =
    useQuery<TournamentList>({
      queryKey: ["nakama", "tournaments"],
      queryFn: () => nakama.listTournaments({}, rpc),
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

  const joinMutation = useMutation({
    mutationFn: (id: string) => nakama.joinTournament(id, rpc),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nakama", "tournaments"] });
    },
  });

  const isLoading = challengesLoading || tournamentsLoading;
  if (isLoading) return <PageSkeleton />;

  const allChallenges: Challenge[] = challengeData?.challenges
    ? Object.values(challengeData.challenges).filter(isCompetitiveChallenge)
    : [];

  const tournaments: Tournament[] = tournamentData?.tournaments ?? [];

  const activeChallenges = allChallenges.filter((c) => c.claim_time_sec === 0);
  const completedChallenges = allChallenges.filter((c) => c.claim_time_sec > 0);
  const pveChallenges = allChallenges.filter((c) => classifyChallenge(c) === "pve" && c.claim_time_sec === 0);
  const pvpChallenges = allChallenges.filter((c) => classifyChallenge(c) === "pvp" && c.claim_time_sec === 0);

  const tabCounts: Record<Tab, number> = {
    active: activeChallenges.length,
    pve: pveChallenges.length,
    pvp: pvpChallenges.length,
    tournaments: tournaments.length,
    completed: completedChallenges.length,
  };

  const claimableCount = allChallenges.filter((c) => c.can_claim).length;
  const totalObjectives = allChallenges.length + tournaments.length;

  function sortChallenges(list: Challenge[]): Challenge[] {
    return [...list].sort((a, b) => {
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
  }

  function renderChallenges(list: Challenge[]) {
    const sorted = sortChallenges(list);
    if (sorted.length === 0) return <EmptyState tab={tab} />;
    return (
      <div className="space-y-3">
        {sorted.map((c) => (
          <ChallengeCard
            key={c.id}
            challenge={c}
            onClaim={() => claimMutation.mutate(c.id)}
            claiming={claimMutation.isPending && claimMutation.variables === c.id}
            justClaimed={justClaimed === c.id}
            onSelect={() => setSelectedChallenge(c)}
          />
        ))}
      </div>
    );
  }

  function renderTournaments() {
    if (tournaments.length === 0) return <EmptyState tab="tournaments" />;
    return (
      <div className="space-y-3">
        {tournaments.map((t) => (
          <TournamentCard
            key={t.id}
            tournament={t}
            onSelect={() => setSelectedTournament(t)}
            onJoin={() => joinMutation.mutate(t.id)}
            joining={joinMutation.isPending && joinMutation.variables === t.id}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Challenges</h2>
          <p className="text-muted-foreground">
            PvE & PvP objectives and timed competitions.{" "}
            {totalObjectives > 0 && (
              <span className="text-foreground font-medium">
                {completedChallenges.length}/{allChallenges.length} done
              </span>
            )}
          </p>
        </div>
        {totalObjectives > 0 && (
          <div className="flex items-center gap-3">
            {tournaments.length > 0 && (
              <div className="flex items-center gap-1.5 rounded-xl bg-amber-500/10 px-3 py-2">
                <Crown className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-bold text-amber-400">{tournaments.length}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 rounded-xl bg-primary/10 px-3 py-2">
              <Target className="h-4 w-4 text-primary" />
              <span className="text-sm font-bold text-primary">
                {allChallenges.length > 0
                  ? Math.round((completedChallenges.length / allChallenges.length) * 100)
                  : 0}%
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Claimable banner */}
      {claimableCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Gift className="h-4 w-4 text-primary" />
          <span className="flex-1 text-sm font-medium">
            <span className="text-primary">{claimableCount}</span> challenge
            {claimableCount > 1 ? "s" : ""} ready to claim!
          </span>
          <ChevronRight className="h-4 w-4 text-primary/50" />
        </div>
      )}

      {/* Errors */}
      {(challengesError || tournamentsError) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">Failed to load data</p>
          <p className="mt-1 text-xs opacity-70">
            {(challengesErr as Error)?.message ?? (tournamentsErr as Error)?.message ?? "Unknown error"}
          </p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1.5 overflow-x-auto">
        {TABS.map((t) => (
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
            {t.icon}
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

      {/* Content */}
      {tab === "active" && renderChallenges(activeChallenges)}
      {tab === "pve" && renderChallenges(pveChallenges)}
      {tab === "pvp" && renderChallenges(pvpChallenges)}
      {tab === "tournaments" && renderTournaments()}
      {tab === "completed" && renderChallenges(completedChallenges)}

      {/* Drawers */}
      {selectedChallenge && (
        <ChallengeDrawer
          challenge={selectedChallenge}
          onClose={() => setSelectedChallenge(null)}
          onClaim={() => claimMutation.mutate(selectedChallenge.id)}
          claiming={claimMutation.isPending && claimMutation.variables === selectedChallenge.id}
          justClaimed={justClaimed === selectedChallenge.id}
        />
      )}

      {selectedTournament && (
        <TournamentDrawer
          tournament={selectedTournament}
          onClose={() => setSelectedTournament(null)}
          onJoin={() => joinMutation.mutate(selectedTournament.id)}
          joining={joinMutation.isPending && joinMutation.variables === selectedTournament.id}
        />
      )}
    </div>
  );
}

export { ChallengesPage as default };

export default ChallengesPage;
