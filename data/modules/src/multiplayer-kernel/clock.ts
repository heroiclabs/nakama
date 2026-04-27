// Server clock authority + match-time helpers (Pillar 8: time/state).
//
// The kernel stamps every outbound envelope with `match_time_ms` measured
// from match start. Clients use this to pace timers; client wall-clocks
// are never trusted.

namespace MpKernelClock {
  export interface IMatchClock {
    matchStartUnixMs: number;
    // Per-(match, sender) sequence counter, used by error.ts and
    // template fan-out so all outbound seq numbers are monotonic.
    nextSeq: number;
    // Last server-side broadcast tick wall-clock (for ClockSync cadence).
    lastClockSyncUnixMs: number;
  }

  export function init(): IMatchClock {
    return {
      matchStartUnixMs: Date.now(),
      nextSeq: 1,
      lastClockSyncUnixMs: 0
    };
  }

  export function matchTimeMs(c: IMatchClock): number {
    return Date.now() - c.matchStartUnixMs;
  }

  export function nextSeq(c: IMatchClock): number {
    return c.nextSeq++;
  }

  export function seqProvider(c: IMatchClock): { next: () => number } {
    return { next: function () { return c.nextSeq++; } };
  }

  // Detect extreme client clock skew (Pillar 8 — Time/state errors).
  // Client `wall_clock_unix_ms` from Hello is compared to server now.
  // > 30 s = CLOCK_SKEW_EXTREME.
  export var CLOCK_SKEW_LIMIT_MS = 30 * 1000;
  export function isSkewExtreme(clientUnixMs: number): boolean {
    var diff = Math.abs(Date.now() - clientUnixMs);
    return diff > CLOCK_SKEW_LIMIT_MS;
  }

  // Cadence for ClockSync broadcasts. Every 5 s by default.
  export var CLOCK_SYNC_INTERVAL_MS = 5000;
  export function shouldEmitClockSync(c: IMatchClock): boolean {
    var now = Date.now();
    if (now - c.lastClockSyncUnixMs >= CLOCK_SYNC_INTERVAL_MS) {
      c.lastClockSyncUnixMs = now;
      return true;
    }
    return false;
  }

  export function buildClockSync(c: IMatchClock, clientEchoUnixMs: number): any {
    return {
      server_unix_ms:       Date.now(),
      server_match_time_ms: matchTimeMs(c),
      client_unix_ms_echo:  clientEchoUnixMs
    };
  }
}
