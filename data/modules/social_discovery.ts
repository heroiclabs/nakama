// LNBQSHA Product Layer — Social Discovery
// Friends-of-friends, presence, and activity feed

import { nkruntime } from "nakama-runtime";

interface UserPresence {
  userId: string;
  username: string;
  status: "online" | "offline" | "playing";
  currentActivity?: string;
  lastSeen: number;
}

interface Activity {
  id: string;
  userId: string;
  username: string;
  type: "started_game" | "finished_game" | "achievement" | "level_up" | "joined_party";
  metadata: any;
  timestamp: number;
}

// ============================================================
// INIT
// ============================================================

export function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
  logger.info("LNBQSHA Product Layer — Social Discovery Module initialized");
}

// ============================================================
// RPC: Get friends-of-friends
// ============================================================

export const rpcGetFriendsOfFriends: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const limit = 50;
  const data = JSON.parse(payload || "{}");
  const cursor = data.cursor || "";

  const result = nk.friendsOfFriendsList(userId, limit, cursor);
  return JSON.stringify(result);
};

// ============================================================
// RPC: Get user presence (online status)
// ============================================================

export const rpcGetPresence: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const data = JSON.parse(payload || "{}");
  const targetUserIds: string[] = data.userIds || [];

  if (targetUserIds.length === 0) {
    return JSON.stringify({ presences: [] });
  }

  const presences = nk.statusGet(targetUserIds);
  const result: UserPresence[] = presences.map((p: any) => ({
    userId: p.userId,
    username: p.username,
    status: p.status || "offline",
    currentActivity: p.currentActivity || "",
    lastSeen: p.lastSeen || 0
  }));

  return JSON.stringify({ presences: result });
};

// ============================================================
// RPC: Follow a user
// ============================================================

export const rpcFollowUser: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const data = JSON.parse(payload);
  const targetUserId = data.userId;
  if (!targetUserId) {
    throw new Error("targetUserId required");
  }

  // Add as friend (Nakama native)
  nk.friendAdd(userId, targetUserId);

  // Store follow activity
  storeActivity(nk, userId, targetUserId, "follow", { userId: targetUserId });

  return JSON.stringify({ success: true });
};

// ============================================================
// RPC: Unfollow a user
// ============================================================

export const rpcUnfollowUser: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const data = JSON.parse(payload);
  const targetUserId = data.userId;
  if (!targetUserId) {
    throw new Error("targetUserId required");
  }

  // Remove as friend
  nk.friendRemove(userId, targetUserId);

  return JSON.stringify({ success: true });
};

// ============================================================
// RPC: Get friends list (extended)
// ============================================================

export const rpcGetFriends: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const limit = 100;
  const cursor = "";

  const result = nk.friendsList(userId, limit, cursor);
  return JSON.stringify(result);
};

// ============================================================
// RPC: Get activity feed
// ============================================================

export const rpcGetActivityFeed: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const limit = 50;
  const data = JSON.parse(payload || "{}");
  const cursor = data.cursor || "";

  const activities = getActivities(nk, userId, limit, cursor);
  return JSON.stringify({
    activities,
    cursor: activities.length > 0 ? String(Date.now()) : ""
  });
};

// ============================================================
// RPC: Record activity (called from game)
// ============================================================

export const rpcRecordActivity: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const data = JSON.parse(payload);
  const type: string = data.type;
  const metadata: any = data.metadata || {};

  if (!type) {
    throw new Error("type required");
  }

  // Get user info
  const user = nk.usersGetId([userId])[0];
  const username = user?.username || "unknown";

  storeActivity(nk, userId, userId, type, metadata);

  // Also notify followers (TODO: implement push/notification)
  logger.debug("Activity recorded", { userId, type });

  return JSON.stringify({ success: true });
};

// ============================================================
// HELPERS
// ============================================================

function storeActivity(
  nk: nkruntime.Nakama,
  userId: string,
  targetUserId: string,
  type: string,
  metadata: any
): void {
  const collection = "activity_feed";
  const key = `${userId}:${Date.now()}`;

  const activity: Activity = {
    id: key,
    userId: targetUserId,
    username: "",
    type: type as any,
    metadata,
    timestamp: Date.now()
  };

  try {
    // Get user info
    const user = nk.usersGetId([targetUserId])[0];
    if (user) {
      activity.username = user.username;
    }
  } catch (e) {
    // User not found
  }

  nk.storageWrite([{
    collection,
    key,
    userId: userId, // Owner is the user who recorded the activity
    value: activity,
    permissionRead: 2, // Public
    permissionWrite: 1 // Owner only
  }]);
}

function getActivities(
  nk: nkruntime.Nakama,
  userId: string,
  limit: number,
  cursor: string
): Activity[] {
  const collection = "activity_feed";

  try {
    // Get friends list
    const friends = nk.friendsList(userId, 100, "");
    const friendIds = friends.map((f: any) => f.userId);

    // Include self
    friendIds.push(userId);

    // Query activities from friends
    const results: Activity[] = [];
    
    // For each friend, get their recent activities
    // Note: In production, this should use a proper index
    // This is a simplified version
    for (const friendId of friendIds) {
      try {
        const storage = nk.storageRead([{
          collection,
          key: "", // We need a better way to list
          userId: friendId
        }]);
        // TODO: Implement proper listing with cursor
        // This is a placeholder
      } catch (e) {
        // No activities
      }
    }

    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);
    return results.slice(0, limit);
  } catch (e) {
    return [];
  }
    }
