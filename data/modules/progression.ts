// LNBQSHA Product Layer — Progression System
// Level, XP, Achievements, Daily Rewards

import { nkruntime } from "nakama-runtime";

interface ProgressionData {
  userId: string;
  level: number;
  xp: number;
  xpToNextLevel: number;
  totalXp: number;
  achievements: Achievement[];
  dailyRewards: DailyReward[];
  lastDailyClaim: number;
  streak: number;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  unlocked: boolean;
  unlockedAt?: number;
  progress?: number;
  maxProgress?: number;
}

interface DailyReward {
  day: number;
  claimed: boolean;
  reward: string;
  claimedAt?: number;
}

// XP required per level (exponential curve)
function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.5, level - 1));
}

// ============================================================
// INIT
// ============================================================

export function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
  logger.info("LNBQSHA Product Layer — Progression Module initialized");
}

// ============================================================
// HELPERS
// ============================================================

function getProgression(nk: nkruntime.Nakama, userId: string): ProgressionData {
  const collection = "progression";
  const key = "data";

  try {
    const result = nk.storageRead([{ collection, key, userId }]);
    if (result && result.length > 0 && result[0].value) {
      return result[0].value as ProgressionData;
    }
  } catch (e) {
    // Not found
  }

  // Default progression
  const defaultData: ProgressionData = {
    userId,
    level: 1,
    xp: 0,
    xpToNextLevel: xpForLevel(2),
    totalXp: 0,
    achievements: [],
    dailyRewards: [
      { day: 1, claimed: false, reward: "100 coins" },
      { day: 2, claimed: false, reward: "150 coins" },
      { day: 3, claimed: false, reward: "200 coins + XP boost" },
      { day: 4, claimed: false, reward: "250 coins" },
      { day: 5, claimed: false, reward: "300 coins + rare item" },
      { day: 6, claimed: false, reward: "400 coins" },
      { day: 7, claimed: false, reward: "500 coins + legendary item" },
    ],
    lastDailyClaim: 0,
    streak: 0
  };

  saveProgression(nk, userId, defaultData);
  return defaultData;
}

function saveProgression(nk: nkruntime.Nakama, userId: string, data: ProgressionData): void {
  const collection = "progression";
  const key = "data";

  nk.storageWrite([{
    collection,
    key,
    userId,
    value: data,
    permissionRead: 2,
    permissionWrite: 1
  }]);
}

function addXp(nk: nkruntime.Nakama, userId: string, amount: number): ProgressionData {
  const data = getProgression(nk, userId);
  data.xp += amount;
  data.totalXp += amount;

  // Check for level up
  while (data.xp >= data.xpToNextLevel) {
    data.xp -= data.xpToNextLevel;
    data.level += 1;
    data.xpToNextLevel = xpForLevel(data.level);
    
    // Level up achievement
    const achievement: Achievement = {
      id: `level_${data.level}`,
      name: `Level ${data.level} Achieved!`,
      description: `Reached level ${data.level}`,
      unlocked: true,
      unlockedAt: Date.now()
    };
    data.achievements.push(achievement);

    // Record activity
    try {
      const rpcPayload = JSON.stringify({
        type: "level_up",
        metadata: { level: data.level }
      });
      // Call our own RPC via nk.rpc
      // Note: This is a placeholder, actual implementation would use nk.rpc
    } catch (e) {
      // Ignore
    }
  }

  saveProgression(nk, userId, data);
  return data;
}

// ============================================================
// RPC: Get progression
// ============================================================

export const rpcGetProgression: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const data = getProgression(nk, userId);
  return JSON.stringify(data);
};

// ============================================================
// RPC: Add XP (called from game)
// ============================================================

export const rpcAddXp: nkruntime.RpcFunction = (
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
  const amount: number = data.amount || 0;

  if (amount <= 0) {
    throw new Error("XP amount must be positive");
  }

  const result = addXp(nk, userId, amount);
  return JSON.stringify(result);
};

// ============================================================
// RPC: Unlock achievement
// ============================================================

export const rpcUnlockAchievement: nkruntime.RpcFunction = (
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
  const achievementId: string = data.achievementId;
  const name: string = data.name || achievementId;
  const description: string = data.description || "";

  if (!achievementId) {
    throw new Error("achievementId required");
  }

  const progression = getProgression(nk, userId);

  // Check if already unlocked
  const existing = progression.achievements.find(a => a.id === achievementId);
  if (existing && existing.unlocked) {
    return JSON.stringify(progression);
  }

  const achievement: Achievement = {
    id: achievementId,
    name,
    description,
    unlocked: true,
    unlockedAt: Date.now()
  };

  progression.achievements.push(achievement);
  saveProgression(nk, userId, progression);

  return JSON.stringify(progression);
};

// ============================================================
// RPC: Claim daily reward
// ============================================================

export const rpcClaimDailyReward: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const progression = getProgression(nk, userId);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  // Check if already claimed today
  if (progression.lastDailyClaim >= todayTs) {
    throw new Error("Daily reward already claimed today");
  }

  // Check if streak should reset
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayTs = yesterday.getTime();

  if (progression.lastDailyClaim < yesterdayTs) {
    progression.streak = 0;
  }

  // Calculate which day to claim
  let dayIndex = progression.streak % 7;
  const reward = progression.dailyRewards[dayIndex];
  
  if (!reward) {
    throw new Error("Invalid daily reward");
  }

  if (reward.claimed) {
    throw new Error("Reward already claimed");
  }

  // Claim the reward
  reward.claimed = true;
  reward.claimedAt = Date.now();
  progression.streak += 1;
  progression.lastDailyClaim = todayTs;

  // Give XP bonus for streak
  const xpBonus = progression.streak * 10;
  if (xpBonus > 0) {
    addXp(nk, userId, xpBonus);
  }

  // Reset daily rewards if all claimed
  const allClaimed = progression.dailyRewards.every(r => r.claimed);
  if (allClaimed) {
    progression.dailyRewards.forEach(r => r.claimed = false);
  }

  saveProgression(nk, userId, progression);

  return JSON.stringify({
    reward: reward.reward,
    streak: progression.streak,
    xpBonus,
    progression
  });
};

// ============================================================
// RPC: Get leaderboard (uses Nakama native leaderboard)
// ============================================================

export const rpcGetLeaderboard: nkruntime.RpcFunction = (
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
  const leaderboardId: string = data.leaderboardId || "global_xp";
  const limit: number = data.limit || 100;
  const cursor: string = data.cursor || "";

  const result = nk.leaderboardRecordsList(leaderboardId, userId, limit, cursor);
  return JSON.stringify(result);
};

// ============================================================
// RPC: Submit score to leaderboard
// ============================================================

export const rpcSubmitScore: nkruntime.RpcFunction = (
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
  const leaderboardId: string = data.leaderboardId || "global_xp";
  const score: number = data.score || 0;
  const subscore: number = data.subscore || 0;
  const metadata: any = data.metadata || {};

  if (score <= 0) {
    throw new Error("Score must be positive");
  }

  const result = nk.leaderboardRecordWrite(leaderboardId, userId, score, subscore, metadata);
  return JSON.stringify(result);
};
