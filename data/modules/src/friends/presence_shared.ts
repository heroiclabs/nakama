// presence_shared.ts — canonical presence read helper for the friends domain.
//
// B-004 fix (2026-07-06): `loadOnlineMap` was copy-pasted (semantically
// identical, whitespace-only drift) across THREE namespaces:
//   - IntelliverseFriendsList  (friends_list.ts)
//   - IntelliverseFriends      (find_friends.ts)
//   - IntelliverseNearbyPlayers(find_nearby_players.ts)
// Any future presence-format change would have had to be applied three
// times. This file is now the single source of truth; each namespace keeps
// a one-line local wrapper delegating here so call sites stay unchanged.
//
// See docs/plans/WORLD_CLASS_SOCIAL_FRIENDS_GROUPS_ARCHITECTURE.md §8.2:
// the 5-minute window is the CURRENT contract. When Presence v2 ships
// (per-game keys + 150s window) only THIS file changes.

namespace FriendsPresenceShared {

  var PRESENCE_COLLECTION = "player_presence";
  var PRESENCE_KEY        = "status";
  var ONLINE_THRESHOLD_MS = 5 * 60 * 1000; // last_seen within 5 min ⇒ online

  /**
   * Batch-read presence rows for the given users and collapse each into a
   * boolean online flag. One nk.storageRead call regardless of list size.
   * Presence is optional context — any read failure returns an empty map
   * and must never fail the calling RPC.
   */
  export function loadOnlineMap(nk: nkruntime.Nakama, userIds: string[]): { [id: string]: boolean } {
    var map: { [id: string]: boolean } = {};
    if (!userIds || userIds.length === 0) return map;

    var reads: nkruntime.StorageReadRequest[] = [];
    for (var i = 0; i < userIds.length; i++) {
      reads.push({
        collection: PRESENCE_COLLECTION,
        key:        PRESENCE_KEY,
        userId:     userIds[i]
      });
    }

    var rows: nkruntime.StorageObject[] | null = null;
    try {
      rows = nk.storageRead(reads);
    } catch (e: any) {
      return map;
    }
    if (!rows) return map;

    var nowMs = Date.now();
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      if (!row || !row.value) continue;

      var v: any = row.value;
      var online = false;
      if (v.online === true) {
        var lastSeenMs = 0;
        if (typeof v.lastSeenMs === "number")        lastSeenMs = v.lastSeenMs;
        else if (typeof v.last_seen_ms === "number") lastSeenMs = v.last_seen_ms;
        else if (typeof v.lastSeen === "string") {
          var t = Date.parse(v.lastSeen);
          if (!isNaN(t)) lastSeenMs = t;
        }
        if (lastSeenMs === 0 || (nowMs - lastSeenMs) <= ONLINE_THRESHOLD_MS) {
          online = true;
        }
      }
      map[row.userId] = online;
    }
    return map;
  }
}
