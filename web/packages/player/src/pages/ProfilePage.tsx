import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { nakama, hiro, useRpcOptions } from "@nakama/shared";
import { useAuthStore } from "@nakama/shared";
import type { ConsoleAccount } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function walletBag(raw?: string): Record<string, number> {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function progressPercent(current: number, target: number) {
  if (target <= 0) return 100;
  return Math.min(100, Math.round((current / target) * 100));
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

export function ProfilePage() {
  const rpcOpts = useRpcOptions();
  const authUser = useAuthStore((s) => s.user);

  const { data: account, isLoading: acctLoading } = useQuery<ConsoleAccount>({
    queryKey: ["nakama", "account"],
    queryFn: () => nakama.getAccount(rpcOpts),
    staleTime: 30_000,
  });

  const { data: statsData } = useQuery({
    queryKey: ["hiro", "stats"],
    queryFn: () => hiro.getStats(rpcOpts),
    staleTime: 60_000,
    retry: false,
  });

  const { data: achievementsData } = useQuery({
    queryKey: ["hiro", "achievements"],
    queryFn: () => hiro.listAchievements(rpcOpts),
    staleTime: 60_000,
    retry: false,
  });

  const { data: progressionData } = useQuery({
    queryKey: ["hiro", "progression"],
    queryFn: () => hiro.getProgression(rpcOpts),
    staleTime: 60_000,
    retry: false,
  });

  const user = account?.user ?? authUser;
  const wallet = useMemo(() => walletBag(account?.wallet), [account?.wallet]);

  const achievements: Array<{
    id: string;
    name: string;
    description: string;
    count: number;
    max_count: number;
    claim_time_sec?: number;
  }> = useMemo(() => {
    const raw = achievementsData as any;
    if (!raw) return [];
    const list =
      raw?.achievements ?? raw?.data ?? (Array.isArray(raw) ? raw : []);
    return list;
  }, [achievementsData]);

  const completedAchievements = achievements.filter(
    (a) => a.claim_time_sec || a.count >= a.max_count,
  );

  const stats: Record<string, unknown> = useMemo(() => {
    const raw = statsData as any;
    if (!raw) return {};
    return raw?.public ?? raw?.stats ?? raw ?? {};
  }, [statsData]);

  const progressions: Array<{
    id: string;
    name: string;
    count: number;
    max_count: number;
  }> = useMemo(() => {
    const raw = progressionData as any;
    if (!raw) return [];
    const map = raw?.progressions ?? raw?.data ?? {};
    if (Array.isArray(map)) return map;
    return Object.entries(map).map(([id, v]: [string, any]) => ({
      id,
      name: v.name ?? id,
      count: v.count ?? 0,
      max_count: v.max_count ?? 0,
    }));
  }, [progressionData]);

  if (acctLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Profile</h2>
          <p className="text-muted-foreground">Your stats and achievements.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Profile</h2>
          <p className="text-muted-foreground">Your stats and achievements.</p>
        </div>
        <Link
          to="/profile/friends"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
        >
          <UsersIcon />
          Friends
        </Link>
      </div>

      {/* ---- Player Card ---- */}
      <div className="rounded-lg border border-border bg-card p-6">
        <div className="flex items-center gap-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {user?.avatar_url ? (
              <img
                src={user.avatar_url}
                alt=""
                className="h-16 w-16 rounded-full object-cover"
              />
            ) : (
              (user?.display_name ?? user?.username ?? "?")[0]?.toUpperCase()
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold">
              {user?.display_name || user?.username || "Unknown Player"}
            </h3>
            <p className="truncate text-sm text-muted-foreground">
              @{user?.username}
            </p>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
              {account?.email && <span>{account.email}</span>}
              <span>Joined {fmtDate(user?.create_time)}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  user?.online
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-zinc-500/10 text-zinc-500",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    user?.online ? "bg-emerald-500" : "bg-zinc-400",
                  )}
                />
                {user?.online ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- Wallet ---- */}
      {Object.keys(wallet).length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Wallet
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(wallet).map(([key, val]) => (
              <div
                key={key}
                className="flex items-center gap-3 rounded-lg border border-border bg-card p-4"
              >
                <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-sm font-bold text-primary">
                  {key[0]?.toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium capitalize">
                    {key.replace(/_/g, " ")}
                  </p>
                  <p className="text-lg font-bold tabular-nums">
                    {typeof val === "number" ? val.toLocaleString() : val}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Stats ---- */}
      {Object.keys(stats).length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Stats
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(stats).map(([key, val]) => (
              <div
                key={key}
                className="rounded-lg border border-border bg-card p-4"
              >
                <p className="text-xs font-medium capitalize text-muted-foreground">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="mt-1 text-lg font-bold tabular-nums">
                  {typeof val === "number" ? val.toLocaleString() : String(val ?? "—")}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ---- Progressions ---- */}
      {progressions.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Progression
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {progressions.map((p) => {
              const pct = progressPercent(p.count, p.max_count);
              return (
                <div
                  key={p.id}
                  className="rounded-lg border border-border bg-card p-4"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{p.name}</p>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {p.count}/{p.max_count}
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ---- Achievements ---- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Achievements
          {achievements.length > 0 && (
            <span className="ml-2 text-xs font-normal normal-case text-muted-foreground">
              {completedAchievements.length}/{achievements.length} completed
            </span>
          )}
        </h3>
        {achievements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No achievements available yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.map((a) => {
              const done = !!(a.claim_time_sec || a.count >= a.max_count);
              const pct = progressPercent(a.count, a.max_count);
              return (
                <div
                  key={a.id}
                  className={cn(
                    "rounded-lg border bg-card p-4 transition-colors",
                    done
                      ? "border-emerald-500/30 bg-emerald-500/5"
                      : "border-border",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-sm",
                        done
                          ? "bg-emerald-500/20 text-emerald-600"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {done ? <CheckIcon /> : <TrophyIcon />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{a.name || a.id}</p>
                      {a.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                          {a.description}
                        </p>
                      )}
                      {!done && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between text-xs tabular-nums text-muted-foreground">
                            <span>
                              {a.count}/{a.max_count}
                            </span>
                            <span>{pct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-primary transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Account Details ---- */}
      <section>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Account Details
        </h3>
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-border">
              <Row label="User ID" value={user?.user_id} mono />
              <Row label="Username" value={user?.username} />
              <Row label="Display Name" value={user?.display_name} />
              <Row label="Email" value={account?.email} />
              <Row label="Language" value={user?.lang_tag} />
              <Row label="Location" value={user?.location} />
              <Row label="Timezone" value={user?.timezone} />
              <Row label="Created" value={fmtDate(user?.create_time)} />
              <Row label="Updated" value={fmtDate(user?.update_time)} />
              {account?.devices && account.devices.length > 0 && (
                <Row
                  label="Linked Devices"
                  value={account.devices.map((d) => d.id).join(", ")}
                  mono
                />
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                    */
/* ------------------------------------------------------------------ */

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string | null;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <tr>
      <td className="whitespace-nowrap px-4 py-2.5 font-medium text-muted-foreground">
        {label}
      </td>
      <td
        className={cn(
          "px-4 py-2.5",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </td>
    </tr>
  );
}

function UsersIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export { ProfilePage as default };

export default ProfilePage;
