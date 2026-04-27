// Idempotent opcode dedup (Pillar 8: Idempotent opcode tags).
//
// Each (match, sender) maintains a rolling 60-second ring buffer of
// `client_opcode_uuid`s seen recently. Duplicate submissions inside the
// window are silently dropped (with a DUPLICATE_OPCODE warn counter
// incremented for diagnostics) so flaky clients can safely retry.

namespace MpKernelIdempotency {
  // Implementation note: the JS runtime is a hot path so we use a flat
  // ring buffer indexed by ring slot, plus a Map for O(1) lookup. The
  // ring caps memory; the Map gives constant-time membership checks.

  export interface IPerSenderRing {
    capacity: number;
    nowSlot: number;
    seen: { [uuid: string]: number }; // uuid → unix ms first-seen.
    order: string[];                  // FIFO for eviction.
  }

  export var DEDUP_WINDOW_MS = 60 * 1000;
  export var DEDUP_CAPACITY  = 256;

  export function newRing(): IPerSenderRing {
    return {
      capacity: DEDUP_CAPACITY,
      nowSlot: 0,
      seen: {},
      order: []
    };
  }

  // Returns true if the uuid is new (process it). Returns false if it's
  // a recent duplicate (drop it).
  export function admit(ring: IPerSenderRing, uuid: string, nowUnixMs: number): boolean {
    if (!uuid || uuid.length === 0) {
      // Empty uuid is acceptable for fire-and-forget opcodes (e.g. heartbeats);
      // those are not deduped here.
      return true;
    }
    var prev = ring.seen[uuid];
    if (prev !== undefined && (nowUnixMs - prev) <= DEDUP_WINDOW_MS) {
      return false;
    }
    ring.seen[uuid] = nowUnixMs;
    ring.order.push(uuid);
    if (ring.order.length > ring.capacity) {
      var evict = ring.order.shift();
      if (evict !== undefined) {
        delete ring.seen[evict];
      }
    }
    return true;
  }

  // Evict expired entries. Cheap O(prefix) — stops at the first non-expired.
  export function gc(ring: IPerSenderRing, nowUnixMs: number): void {
    while (ring.order.length > 0) {
      var oldest = ring.order[0];
      var seen = ring.seen[oldest];
      if (seen === undefined || (nowUnixMs - seen) > DEDUP_WINDOW_MS) {
        ring.order.shift();
        if (oldest !== undefined) delete ring.seen[oldest];
      } else {
        break;
      }
    }
  }
}
