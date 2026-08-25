// LNBQSHA Product Layer — User Profile Extension
// Copyright © 2026 LNBQSHA. All rights reserved.

import { nkruntime } from "nakama-runtime";

// Extended user profile data stored in storage
interface UserProfile {
  displayName: string;
  bio: string;
  avatarUrl: string;
  level: number;
  xp: number;
  createdAt: number;
  updatedAt: number;
}

// Initialize module
export function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
  logger.info("LNBQSHA Product Layer — User Profile Module initialized");
}

// RPC: Get user profile
export const rpcGetProfile: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  // Get profile from storage
  const profile = getProfile(nk, userId);
  return JSON.stringify(profile);
};

// RPC: Update user profile
export const rpcUpdateProfile: nkruntime.RpcFunction = (
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
  const profile = getProfile(nk, userId);
  
  // Update fields
  if (data.displayName) profile.displayName = data.displayName;
  if (data.bio !== undefined) profile.bio = data.bio;
  if (data.avatarUrl) profile.avatarUrl = data.avatarUrl;
  
  profile.updatedAt = Date.now();

  // Save to storage
  saveProfile(nk, userId, profile);

  return JSON.stringify(profile);
};

// Helper: Get profile from storage
function getProfile(nk: nkruntime.Nakama, userId: string): UserProfile {
  const collection = "user_profile";
  const key = "profile";

  try {
    const result = nk.storageRead([{ collection, key, userId }]);
    if (result && result.length > 0 && result[0].value) {
      return result[0].value as UserProfile;
    }
  } catch (e) {
    // Profile not found, create default
  }

  // Default profile
  return {
    displayName: "",
    bio: "",
    avatarUrl: "",
    level: 1,
    xp: 0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

// Helper: Save profile to storage
function saveProfile(nk: nkruntime.Nakama, userId: string, profile: UserProfile): void {
  const collection = "user_profile";
  const key = "profile";
  
  nk.storageWrite([
    {
      collection,
      key,
      userId,
      value: profile,
      permissionRead: 2, // Public read
      permissionWrite: 1 // Owner only write
    }
  ]);
    }
