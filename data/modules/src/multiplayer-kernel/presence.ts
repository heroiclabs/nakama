// Presence tracking + reconnect grace + flapping detection (Pillar 8).

namespace MpKernelPresence {
  export interface ISeat {
    user_id: string;
    session_id: string;
    is_agent: boolean;
    is_host: boolean;
    joined_unix_ms: number;
    last_seen_unix_ms: number;
    // Reconnect bookkeeping.
    disconnected_at_unix_ms: number; // 0 = currently connected.
    reconnect_count_in_window: number;
    reconnect_count_window_start_unix_ms: number;
    // Per-sender state.
    last_seq_in_from_client: number;
    last_seq_out_to_client: number;
    idem_ring: MpKernelIdempotency.IPerSenderRing;
    // Display info from PlayerJoined metadata.
    display_name?: string;
    presence_metadata?: any;
  }

  export interface IPresenceTable {
    seats: { [user_id: string]: ISeat };
    reconnect_grace_ms: number;
    flap_threshold: number;        // Reconnects in flap_window_ms before soft-ban.
    flap_window_ms: number;
    flap_ban_seconds: number;
  }

  export var DEFAULT_GRACE_MS    = 60 * 1000;
  export var DEFAULT_FLAP_LIMIT  = 5;
  export var DEFAULT_FLAP_WINDOW = 60 * 1000;
  export var DEFAULT_FLAP_BAN_SEC= 30;

  export function init(graceMs: number): IPresenceTable {
    return {
      seats: {},
      reconnect_grace_ms: graceMs > 0 ? graceMs : DEFAULT_GRACE_MS,
      flap_threshold: DEFAULT_FLAP_LIMIT,
      flap_window_ms: DEFAULT_FLAP_WINDOW,
      flap_ban_seconds: DEFAULT_FLAP_BAN_SEC
    };
  }

  // Returns the seat (creating if first-time, restoring if within grace).
  // `flapped` flag tells the caller to issue a PlayerKicked.FLAPPING.
  export function recordJoin(
    table: IPresenceTable,
    p: nkruntime.Presence,
    nowUnixMs: number
  ): { seat: ISeat; flapped: boolean; resumed: boolean } {
    var existing = table.seats[p.userId];
    if (existing) {
      // Reconnect path. Detect flapping: too many disconnect→reconnect
      // cycles in the window are soft-banned.
      var winStart = existing.reconnect_count_window_start_unix_ms;
      if (winStart === 0 || (nowUnixMs - winStart) > table.flap_window_ms) {
        existing.reconnect_count_window_start_unix_ms = nowUnixMs;
        existing.reconnect_count_in_window = 1;
      } else {
        existing.reconnect_count_in_window++;
      }
      var flapped = existing.reconnect_count_in_window > table.flap_threshold;
      existing.session_id = p.sessionId;
      existing.last_seen_unix_ms = nowUnixMs;
      existing.disconnected_at_unix_ms = 0;
      return { seat: existing, flapped: flapped, resumed: true };
    }
    var seat: ISeat = {
      user_id: p.userId,
      session_id: p.sessionId,
      is_agent: p.userId.indexOf("agt_") === 0,
      is_host: false,
      joined_unix_ms: nowUnixMs,
      last_seen_unix_ms: nowUnixMs,
      disconnected_at_unix_ms: 0,
      reconnect_count_in_window: 0,
      reconnect_count_window_start_unix_ms: 0,
      last_seq_in_from_client: 0,
      last_seq_out_to_client: 0,
      idem_ring: MpKernelIdempotency.newRing()
    };
    table.seats[p.userId] = seat;
    return { seat: seat, flapped: false, resumed: false };
  }

  // Marks seat disconnected, but keeps state for grace_ms in case of resume.
  export function recordLeave(
    table: IPresenceTable,
    p: nkruntime.Presence,
    nowUnixMs: number
  ): ISeat | null {
    var seat = table.seats[p.userId];
    if (!seat) return null;
    seat.disconnected_at_unix_ms = nowUnixMs;
    return seat;
  }

  // Sweep grace expirations. Caller broadcasts PlayerLeft(TIMEOUT) for
  // each evicted seat.
  export function evictExpired(
    table: IPresenceTable,
    nowUnixMs: number
  ): ISeat[] {
    var evicted: ISeat[] = [];
    for (var k in table.seats) {
      if (!table.seats.hasOwnProperty(k)) continue;
      var s = table.seats[k];
      if (s.disconnected_at_unix_ms === 0) continue;
      if ((nowUnixMs - s.disconnected_at_unix_ms) > table.reconnect_grace_ms) {
        evicted.push(s);
        delete table.seats[k];
      }
    }
    return evicted;
  }

  export function activeCount(table: IPresenceTable): number {
    var n = 0;
    for (var k in table.seats) {
      if (!table.seats.hasOwnProperty(k)) continue;
      if (table.seats[k].disconnected_at_unix_ms === 0) n++;
    }
    return n;
  }

  export function totalCount(table: IPresenceTable): number {
    var n = 0;
    for (var k in table.seats) {
      if (table.seats.hasOwnProperty(k)) n++;
    }
    return n;
  }

  export function reconnectGraceRemainingMs(seat: ISeat, table: IPresenceTable, nowUnixMs: number): number {
    if (seat.disconnected_at_unix_ms === 0) return table.reconnect_grace_ms;
    var elapsed = nowUnixMs - seat.disconnected_at_unix_ms;
    var remain = table.reconnect_grace_ms - elapsed;
    return remain > 0 ? remain : 0;
  }
}
