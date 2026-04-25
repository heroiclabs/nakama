import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { nakama, useRpcOptions, useAuthStore } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface ReferralProfile {
  code: string;
  referred_by: string | null;
  referred_users: string[];
  rewards_claimed: number[];
  total_rewards_earned: number;
}

interface ReferredUser {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  joined_at: string;
}

const REWARD_MILESTONES = [
  { count: 1, reward: 100, label: "First Friend" },
  { count: 3, reward: 300, label: "Social Starter" },
  { count: 5, reward: 500, label: "Popular Player" },
  { count: 10, reward: 1000, label: "Community Builder" },
  { count: 25, reward: 2500, label: "Influencer" },
  { count: 50, reward: 5000, label: "Ambassador" },
];

function generateReferralCode(userId: string): string {
  return "REF-" + userId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      onClick={copy}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        copied
          ? "bg-green-500/20 text-green-400"
          : "bg-primary/20 text-primary hover:bg-primary/30",
      )}
    >
      {copied ? (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          Copied!
        </>
      ) : (
        <>
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

function ReferralCodeCard({
  code,
  shareLink,
}: {
  code: string;
  shareLink: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Your Referral Code</h3>
        <p className="text-sm text-muted-foreground">
          Share this code with friends to earn rewards together.
        </p>
      </div>

      <div className="flex items-center gap-3 rounded-md bg-muted/50 p-4">
        <span className="flex-1 font-mono text-2xl font-bold tracking-wider text-primary">
          {code}
        </span>
        <CopyButton text={code} label="Copy Code" />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Share Link
        </p>
        <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3">
          <span className="flex-1 truncate text-sm text-muted-foreground">
            {shareLink}
          </span>
          <CopyButton text={shareLink} label="Copy Link" />
        </div>
      </div>
    </div>
  );
}

function ApplyCodeForm({
  hasApplied,
  onApply,
  isApplying,
}: {
  hasApplied: boolean;
  onApply: (code: string) => void;
  isApplying: boolean;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setError("Please enter a referral code.");
      return;
    }
    if (!trimmed.startsWith("REF-") || trimmed.length < 8) {
      setError("Invalid referral code format.");
      return;
    }
    setError("");
    onApply(trimmed);
  };

  if (hasApplied) {
    return (
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20">
            <svg className="h-5 w-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h3 className="font-semibold">Referral Code Applied</h3>
            <p className="text-sm text-muted-foreground">
              You&apos;ve already used a referral code. Thank you!
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-3">
      <div>
        <h3 className="text-lg font-semibold">Have a Referral Code?</h3>
        <p className="text-sm text-muted-foreground">
          Enter a friend&apos;s code to join their referral network.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <input
            type="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setError("");
            }}
            placeholder="REF-XXXXXXXX"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <button
          type="submit"
          disabled={isApplying}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isApplying ? "Applying…" : "Apply"}
        </button>
      </form>
    </div>
  );
}

function StatsCards({ profile }: { profile: ReferralProfile }) {
  const nextMilestone = REWARD_MILESTONES.find(
    (m) => m.count > profile.referred_users.length,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Total Referrals</p>
        <p className="mt-1 text-3xl font-bold">{profile.referred_users.length}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Rewards Earned</p>
        <p className="mt-1 text-3xl font-bold text-primary">
          {profile.total_rewards_earned.toLocaleString()}
        </p>
        <p className="text-xs text-muted-foreground">coins</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">Next Milestone</p>
        {nextMilestone ? (
          <>
            <p className="mt-1 text-xl font-bold">
              {nextMilestone.count - profile.referred_users.length} more
            </p>
            <p className="text-xs text-muted-foreground">
              for {nextMilestone.reward} coins ({nextMilestone.label})
            </p>
          </>
        ) : (
          <p className="mt-1 text-xl font-bold text-green-400">All earned!</p>
        )}
      </div>
    </div>
  );
}

function MilestoneTrack({ profile }: { profile: ReferralProfile }) {
  const count = profile.referred_users.length;

  return (
    <div className="rounded-lg border border-border bg-card p-6 space-y-4">
      <h3 className="text-lg font-semibold">Reward Milestones</h3>
      <div className="space-y-3">
        {REWARD_MILESTONES.map((m) => {
          const reached = count >= m.count;
          const claimed = profile.rewards_claimed.includes(m.count);
          const progress = Math.min(1, count / m.count);

          return (
            <div key={m.count} className="space-y-1.5">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                      reached
                        ? "bg-primary/20 text-primary"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.count}
                  </span>
                  <span className={cn("font-medium", reached && "text-primary")}>
                    {m.label}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    +{m.reward} coins
                  </span>
                  {claimed && (
                    <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                      Claimed
                    </span>
                  )}
                  {reached && !claimed && (
                    <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs font-medium text-yellow-400">
                      Ready
                    </span>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    reached ? "bg-primary" : "bg-primary/40",
                  )}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReferredFriendsList({ users }: { users: ReferredUser[] }) {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-8 text-center text-muted-foreground">
        <svg className="mx-auto mb-3 h-10 w-10 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <p className="font-medium">No referrals yet</p>
        <p className="mt-1 text-sm">
          Share your code with friends to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-6 py-4">
        <h3 className="text-lg font-semibold">Referred Friends</h3>
      </div>
      <div className="divide-y divide-border">
        {users.map((u) => (
          <div key={u.user_id} className="flex items-center gap-3 px-6 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-bold text-primary">
              {(u.display_name || u.username || "?")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {u.display_name || u.username}
              </p>
              {u.username && u.display_name && (
                <p className="text-xs text-muted-foreground truncate">
                  @{u.username}
                </p>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {u.joined_at
                ? new Date(u.joined_at).toLocaleDateString()
                : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                         */
/* ------------------------------------------------------------------ */

export function ReferralPage() {
  const rpcOpts = useRpcOptions();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();

  const userId = user?.user_id ?? "";
  const username = user?.username ?? "";
  const referralCode = useMemo(
    () => (userId ? generateReferralCode(userId) : ""),
    [userId],
  );
  const shareLink = useMemo(
    () =>
      referralCode
        ? `${window.location.origin}/join?ref=${referralCode}`
        : "",
    [referralCode],
  );

  /* ---------- Read referral profile from storage ---------- */
  const profileQuery = useQuery({
    queryKey: ["referral-profile", userId],
    enabled: !!userId,
    queryFn: async (): Promise<ReferralProfile> => {
      const res = await nakama.listStorageObjects("referral_data", {
        ...rpcOpts,
        userId,
        limit: 10,
      });
      const objects = (res as { objects?: { key: string; value: Record<string, unknown> }[] }).objects ?? [];
      const obj = objects.find((o) => o.key === "profile");
      if (obj) return obj.value as unknown as ReferralProfile;

      const fresh: ReferralProfile = {
        code: referralCode,
        referred_by: null,
        referred_users: [],
        rewards_claimed: [],
        total_rewards_earned: 0,
      };
      await nakama.writeStorageObject("referral_data", "profile", fresh, rpcOpts);
      return fresh;
    },
  });

  const profile = profileQuery.data;

  /* ---------- Load referred friends details ---------- */
  const referredUsersQuery = useQuery({
    queryKey: ["referred-users", profile?.referred_users],
    enabled: !!profile && profile.referred_users.length > 0,
    queryFn: async (): Promise<ReferredUser[]> => {
      if (!profile) return [];
      const friendsRes = await nakama.listFriends({ ...rpcOpts, limit: 1000 });
      const friendsMap = new Map<string, { username: string; display_name: string; avatar_url: string }>();
      for (const f of friendsRes.friends ?? []) {
        if (f.user) {
          friendsMap.set(f.user.user_id, {
            username: f.user.username ?? "",
            display_name: f.user.display_name ?? "",
            avatar_url: f.user.avatar_url ?? "",
          });
        }
      }
      return profile.referred_users.map((uid) => {
        const info = friendsMap.get(uid);
        return {
          user_id: uid,
          username: info?.username ?? uid.slice(0, 8),
          display_name: info?.display_name ?? "",
          avatar_url: info?.avatar_url ?? "",
          joined_at: "",
        };
      });
    },
  });

  /* ---------- Apply referral code mutation ---------- */
  const applyMutation = useMutation({
    mutationFn: async (code: string) => {
      if (!profile) throw new Error("Profile not loaded.");
      if (code === referralCode) throw new Error("You cannot use your own code.");
      if (profile.referred_by) throw new Error("Already applied a code.");

      const updated: ReferralProfile = { ...profile, referred_by: code };
      await nakama.writeStorageObject("referral_data", "profile", updated, rpcOpts);
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referral-profile"] });
    },
  });

  /* ---------- Claim milestone reward ---------- */
  const claimMutation = useMutation({
    mutationFn: async (milestoneCount: number) => {
      if (!profile) throw new Error("Profile not loaded.");
      const milestone = REWARD_MILESTONES.find((m) => m.count === milestoneCount);
      if (!milestone) throw new Error("Invalid milestone.");
      if (profile.referred_users.length < milestone.count)
        throw new Error("Not enough referrals.");
      if (profile.rewards_claimed.includes(milestone.count))
        throw new Error("Already claimed.");

      const updated: ReferralProfile = {
        ...profile,
        rewards_claimed: [...profile.rewards_claimed, milestone.count],
        total_rewards_earned:
          profile.total_rewards_earned + milestone.reward,
      };
      await nakama.writeStorageObject("referral_data", "profile", updated, rpcOpts);
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["referral-profile"] });
    },
  });

  /* ---------- Loading / Error states ---------- */
  if (!userId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Please log in to access referrals.
      </div>
    );
  }

  if (profileQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Loading referral data…
      </div>
    );
  }

  if (profileQuery.isError) {
    return (
      <div className="flex h-64 items-center justify-center text-destructive">
        Failed to load referral data. Please try again.
      </div>
    );
  }

  if (!profile) return null;

  /* ---------- Claimable milestones ---------- */
  const claimable = REWARD_MILESTONES.filter(
    (m) =>
      profile.referred_users.length >= m.count &&
      !profile.rewards_claimed.includes(m.count),
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Referral Program
          </h2>
          <p className="text-muted-foreground">
            Invite friends and earn rewards together.
            {username && (
              <span className="ml-1 text-foreground font-medium">
                @{username}
              </span>
            )}
          </p>
        </div>
      </div>

      {/* My Code + Share */}
      <ReferralCodeCard code={referralCode} shareLink={shareLink} />

      {/* Apply Code */}
      <ApplyCodeForm
        hasApplied={!!profile.referred_by}
        onApply={(c) => applyMutation.mutate(c)}
        isApplying={applyMutation.isPending}
      />
      {applyMutation.isError && (
        <p className="text-sm text-destructive">
          {(applyMutation.error as Error).message}
        </p>
      )}
      {applyMutation.isSuccess && (
        <p className="text-sm text-green-400">
          Referral code applied successfully!
        </p>
      )}

      {/* Stats */}
      <StatsCards profile={profile} />

      {/* Claim banner */}
      {claimable.length > 0 && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-3">
          <p className="font-semibold text-yellow-400">
            You have {claimable.length} reward{claimable.length > 1 ? "s" : ""}{" "}
            ready to claim!
          </p>
          <div className="flex flex-wrap gap-2">
            {claimable.map((m) => (
              <button
                key={m.count}
                onClick={() => claimMutation.mutate(m.count)}
                disabled={claimMutation.isPending}
                className="rounded-md bg-yellow-500/20 px-3 py-1.5 text-sm font-medium text-yellow-300 hover:bg-yellow-500/30 disabled:opacity-50"
              >
                Claim {m.label} (+{m.reward} coins)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      <MilestoneTrack profile={profile} />

      {/* Referred Friends */}
      <ReferredFriendsList users={referredUsersQuery.data ?? []} />
    </div>
  );
}

export { ReferralPage as default };

export default ReferralPage;
