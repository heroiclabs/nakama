// IVX Multiplayer Kernel — server-side interest management.
//
// Spatial hashing + subscription sets for any template that needs to
// fan out updates to a subset of peers based on proximity / cell. The
// Go AvatarReplicationMatch ships its own native AOI; this module is
// for TS templates (e.g. MixedRealityAnchorMatch, PersistentParty
// when scaled to large rooms).
//
// Design:
//
//   * Cell size is per-match. Default 8 m (XR rooms) or 32 m (party
//     stages); pick at template init time.
//   * Each presence reports its position via update(matchId, userId, x, y, z).
//     Stale entries are GC'd after `idleMs` (default 5 s).
//   * subscribers(matchId, userId) returns the list of user_ids whose
//     cell is within the per-match neighbour radius (3x3x3 cube).
//
// Memory:
//
//   * Per-match map: `cell -> set<user_id>`.
//   * Per-user-in-match: `cellId, x, y, z, ts`.
//
// Limits:
//
//   * 64 cell buckets (each 8 m cube) ≈ 512 m³ visible per user.
//     Covers the largest practical XR room. Beyond that, use Photon
//     Voice rooms / sharded matches instead.

namespace MpKernelInterest {

  export interface IMatchCfg {
    cellMeters: number;     // cube side
    neighbourRadius: number;// in cells; 1 → 3x3x3 = 27 cells
    idleMs: number;         // GC threshold
  }

  export var DEFAULT_CFG: IMatchCfg = {
    cellMeters:      8.0,
    neighbourRadius: 1,
    idleMs:          5_000
  };

  interface IUserState {
    cell:  string; // "x,y,z" cell coordinates
    x:     number;
    y:     number;
    z:     number;
    ts:    number;
  }

  interface IMatchState {
    cfg:     IMatchCfg;
    users:   { [userId: string]: IUserState };
    bycell:  { [cell: string]: { [userId: string]: boolean } };
  }

  var matches: { [matchId: string]: IMatchState } = {};

  export function configure(matchId: string, cfg: Partial<IMatchCfg>): void {
    var m = matches[matchId];
    if (!m) {
      matches[matchId] = {
        cfg: (Object as any).assign({}, DEFAULT_CFG, cfg || {}),
        users: {},
        bycell: {}
      };
    } else {
      m.cfg = (Object as any).assign({}, m.cfg, cfg || {});
    }
  }

  export function getConfig(matchId: string): IMatchCfg {
    var m = matches[matchId];
    if (!m) return DEFAULT_CFG;
    return m.cfg;
  }

  function ensure(matchId: string): IMatchState {
    var m = matches[matchId];
    if (!m) {
      matches[matchId] = {
        cfg:    (Object as any).assign({}, DEFAULT_CFG),
        users:  {},
        bycell: {}
      };
      m = matches[matchId];
    }
    return m;
  }

  function cellOf(cellMeters: number, x: number, y: number, z: number): string {
    var cx = Math.floor(x / cellMeters);
    var cy = Math.floor(y / cellMeters);
    var cz = Math.floor(z / cellMeters);
    return cx + "," + cy + "," + cz;
  }

  /**
   * Update a user's position. Returns the user's neighbour set so
   * callers can decide to re-broadcast their join/state to new
   * neighbours.
   */
  export function update(matchId: string, userId: string, x: number, y: number, z: number, nowMs?: number): string[] {
    var m = ensure(matchId);
    var ts = (typeof nowMs === "number") ? nowMs : Date.now();
    var newCell = cellOf(m.cfg.cellMeters, x, y, z);
    var prev = m.users[userId];
    if (prev && prev.cell !== newCell) {
      var pb = m.bycell[prev.cell];
      if (pb) {
        delete pb[userId];
        if (Object.keys(pb).length === 0) delete m.bycell[prev.cell];
      }
    }
    m.users[userId] = { cell: newCell, x: x, y: y, z: z, ts: ts };
    if (!m.bycell[newCell]) m.bycell[newCell] = {};
    m.bycell[newCell][userId] = true;
    return subscribers(matchId, userId);
  }

  export function remove(matchId: string, userId: string): void {
    var m = matches[matchId];
    if (!m) return;
    var u = m.users[userId];
    if (!u) return;
    var b = m.bycell[u.cell];
    if (b) {
      delete b[userId];
      if (Object.keys(b).length === 0) delete m.bycell[u.cell];
    }
    delete m.users[userId];
  }

  export function getPosition(matchId: string, userId: string): { x: number; y: number; z: number } | null {
    var m = matches[matchId];
    if (!m) return null;
    var u = m.users[userId];
    if (!u) return null;
    return { x: u.x, y: u.y, z: u.z };
  }

  /**
   * Return the user_ids whose cell is within `neighbourRadius` cells
   * of `userId`. Includes `userId` itself in the result for symmetry
   * (callers usually drop the self-id).
   */
  export function subscribers(matchId: string, userId: string): string[] {
    var m = matches[matchId];
    if (!m) return [];
    var u = m.users[userId];
    if (!u) return [];
    var r = m.cfg.neighbourRadius;
    var parts = u.cell.split(",");
    var cx = parseInt(parts[0], 10);
    var cy = parseInt(parts[1], 10);
    var cz = parseInt(parts[2], 10);
    var seen: { [id: string]: boolean } = {};
    var out: string[] = [];
    for (var dx = -r; dx <= r; dx++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dz = -r; dz <= r; dz++) {
          var key = (cx + dx) + "," + (cy + dy) + "," + (cz + dz);
          var bag = m.bycell[key];
          if (!bag) continue;
          for (var id in bag) {
            if (!seen[id]) { seen[id] = true; out.push(id); }
          }
        }
      }
    }
    return out;
  }

  /**
   * GC stale entries (presence dropped without remove()).
   */
  export function reap(matchId: string, nowMs?: number): number {
    var m = matches[matchId];
    if (!m) return 0;
    var ts = (typeof nowMs === "number") ? nowMs : Date.now();
    var dropped = 0;
    for (var id in m.users) {
      var u = m.users[id];
      if (ts - u.ts > m.cfg.idleMs) {
        var b = m.bycell[u.cell];
        if (b) {
          delete b[id];
          if (Object.keys(b).length === 0) delete m.bycell[u.cell];
        }
        delete m.users[id];
        dropped++;
      }
    }
    return dropped;
  }

  export function cleanupMatch(matchId: string): void {
    delete matches[matchId];
  }

  export function size(matchId: string): { users: number; cells: number } {
    var m = matches[matchId];
    if (!m) return { users: 0, cells: 0 };
    return {
      users: Object.keys(m.users).length,
      cells: Object.keys(m.bycell).length
    };
  }

  // Mount hook — kernel attaches one global RPC for inspection.
  export function register(initializer: nkruntime.Initializer, logger: nkruntime.Logger): void {
    initializer.registerRpc("mp_interest_size", function (_ctx, _logger, _nk, payload) {
      var req: any = {};
      try { req = JSON.parse(payload || "{}"); } catch (_e) {}
      if (!req.match_id) throw "match_id required";
      return JSON.stringify(size(req.match_id));
    });
    logger.info("[Interest] kernel interest-mgmt registered (default cell=%dm, radius=%d)",
      DEFAULT_CFG.cellMeters, DEFAULT_CFG.neighbourRadius);
  }
}
