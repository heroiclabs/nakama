import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { hiro, useRpcOptions } from "@nakama/shared";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface EnergyEntry {
  id: string;
  current: number;
  max: number;
  max_overfill: number;
  refill_count: number;
  refill_time_sec: number;
  refill_sec_remaining: number;
  next_refill_at: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseEnergies(raw: unknown): EnergyEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const map = (raw as any).energies ?? raw;
  if (Array.isArray(map)) return map;
  return Object.entries(map).map(([id, v]: [string, any]) => ({
    id,
    current: v.current ?? 0,
    max: v.max ?? 0,
    max_overfill: v.max_overfill ?? v.max ?? 0,
    refill_count: v.refill_count ?? 1,
    refill_time_sec: v.refill_time_sec ?? 0,
    refill_sec_remaining: v.refill_sec_remaining ?? 0,
    next_refill_at: v.next_refill_at ?? 0,
  }));
}

function fmtDuration(totalSec: number): string {
  if (totalSec <= 0) return "Full";
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtRefillRate(count: number, sec: number): string {
  if (sec <= 0 || count <= 0) return "—";
  if (sec < 60) return `+${count} / ${sec}s`;
  if (sec < 3600) return `+${count} / ${Math.round(sec / 60)}m`;
  return `+${count} / ${(sec / 3600).toFixed(1)}h`;
}

function energyPercent(current: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(100, Math.round((current / max) * 100));
}

function barColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500";
  if (pct >= 30) return "bg-amber-500";
  return "bg-red-500";
}

function barBgColor(pct: number): string {
  if (pct >= 70) return "bg-emerald-500/10";
  if (pct >= 30) return "bg-amber-500/10";
  return "bg-red-500/10";
}

/* ------------------------------------------------------------------ */
/*  Countdown hook                                                     */
/* ------------------------------------------------------------------ */

function useCountdown(targetEpochSec: number, isFull: boolean): number {
  const calc = useCallback(() => {
    if (isFull || !targetEpochSec) return 0;
    return Math.max(0, targetEpochSec - Math.floor(Date.now() / 1000));
  }, [targetEpochSec, isFull]);

  const [remaining, setRemaining] = useState(calc);

  useEffect(() => {
    setRemaining(calc());
    if (isFull || !targetEpochSec) return;
    const id = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(id);
  }, [calc, isFull, targetEpochSec]);

  return remaining;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export function EnergyPage() {
  const rpcOpts = useRpcOptions();
  const qc = useQueryClient();

  const {
    data: raw,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["hiro", "energy"],
    queryFn: () => hiro.getEnergy(rpcOpts),
    refetchInterval: 30_000,
  });

  const energies = useMemo(() => parseEnergies(raw), [raw]);

  const spendMut = useMutation({
    mutationFn: (amount: number) => hiro.spendEnergy(amount, rpcOpts),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hiro", "energy"] }),
  });

  /* Loading */
  if (isLoading) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-52 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      </div>
    );
  }

  /* Error */
  if (isError) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">
            Failed to load energy data
            {error instanceof Error ? `: ${error.message}` : "."}
          </p>
          <button
            className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
            onClick={() => qc.invalidateQueries({ queryKey: ["hiro", "energy"] })}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  /* Empty */
  if (energies.length === 0) {
    return (
      <div className="space-y-6">
        <Header />
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
          No energy types configured.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {energies.map((e) => (
          <EnergyCard
            key={e.id}
            energy={e}
            onSpend={(amt) => spendMut.mutate(amt)}
            spending={spendMut.isPending}
          />
        ))}
      </div>

      {spendMut.isError && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          Spend failed
          {spendMut.error instanceof Error ? `: ${spendMut.error.message}` : "."}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Header() {
  return (
    <div>
      <h2 className="text-2xl font-bold tracking-tight">Energy</h2>
      <p className="text-muted-foreground">
        Track your energy reserves, cooldowns, and refills.
      </p>
    </div>
  );
}

function EnergyCard({
  energy,
  onSpend,
  spending,
}: {
  energy: EnergyEntry;
  onSpend: (amount: number) => void;
  spending: boolean;
}) {
  const [spendAmt, setSpendAmt] = useState(1);
  const isFull = energy.current >= energy.max;
  const isOverfilled = energy.current > energy.max;
  const pct = energyPercent(energy.current, energy.max);
  const remaining = useCountdown(energy.next_refill_at, isFull);

  const displayMax = energy.max_overfill > energy.max ? energy.max_overfill : energy.max;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card">
      {/* Top section */}
      <div className="flex-1 p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-10 w-10 items-center justify-center rounded-lg text-lg",
                barBgColor(pct),
              )}
            >
              <BoltIcon className={cn(
                pct >= 70 ? "text-emerald-600" :
                pct >= 30 ? "text-amber-600" : "text-red-600",
              )} />
            </div>
            <div>
              <h3 className="text-sm font-semibold capitalize">
                {energy.id.replace(/_/g, " ")}
              </h3>
              <p className="text-xs text-muted-foreground">
                {fmtRefillRate(energy.refill_count, energy.refill_time_sec)}
              </p>
            </div>
          </div>

          {/* Current / Max badge */}
          <div className="text-right">
            <p className="text-2xl font-bold tabular-nums leading-none">
              {energy.current}
              <span className="text-base font-normal text-muted-foreground">
                /{energy.max}
              </span>
            </p>
            {isOverfilled && (
              <span className="mt-0.5 inline-block text-xs font-medium text-amber-600">
                Overfilled
              </span>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                barColor(pct),
              )}
              style={{ width: `${Math.min(100, (energy.current / displayMax) * 100)}%` }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
            <span>{pct}%</span>
            <span>{displayMax > energy.max ? `Max overfill: ${displayMax}` : ""}</span>
          </div>
        </div>

        {/* Cooldown */}
        {!isFull && energy.refill_time_sec > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-muted/60 px-3 py-2">
            <ClockIcon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Next refill in</span>
            <span className="ml-auto font-mono text-xs font-semibold tabular-nums">
              {fmtDuration(remaining)}
            </span>
          </div>
        )}

        {isFull && energy.refill_time_sec > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-2">
            <CheckCircleIcon className="h-3.5 w-3.5 text-emerald-600" />
            <span className="text-xs font-medium text-emerald-700">Fully charged</span>
          </div>
        )}
      </div>

      {/* Spend section */}
      <div className="border-t border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Spend
          </label>
          <input
            type="number"
            min={1}
            max={energy.current}
            value={spendAmt}
            onChange={(e) => setSpendAmt(Math.max(1, parseInt(e.target.value) || 1))}
            className="h-8 w-16 rounded-md border border-border bg-background px-2 text-center text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            disabled={spending || energy.current <= 0 || spendAmt > energy.current}
            onClick={() => onSpend(spendAmt)}
            className={cn(
              "ml-auto inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors",
              energy.current > 0
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "cursor-not-allowed bg-muted text-muted-foreground",
            )}
          >
            {spending ? (
              <SpinnerIcon className="h-3 w-3 animate-spin" />
            ) : (
              <MinusCircleIcon className="h-3.5 w-3.5" />
            )}
            Use Energy
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Icons                                                              */
/* ------------------------------------------------------------------ */

function BoltIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
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
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
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
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function MinusCircleIcon({ className }: { className?: string }) {
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
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8" />
    </svg>
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

export { EnergyPage as default };

export default EnergyPage;
