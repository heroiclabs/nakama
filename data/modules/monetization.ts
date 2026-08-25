// LNBQSHA Product Layer — Monetization
// Cosmetics store, premium tournament entry, revenue sharing

import { nkruntime } from "nakama-runtime";

interface CosmeticsItem {
  id: string;
  name: string;
  description: string;
  type: "skin" | "emote" | "avatar" | "trail" | "effect";
  price: number;
  currency: "soft" | "premium";
  imageUrl: string;
  rarity: "common" | "uncommon" | "rare" | "legendary";
}

interface InventoryItem {
  itemId: string;
  equipped: boolean;
  unlockedAt: number;
}

interface TournamentEntry {
  tournamentId: string;
  userId: string;
  entryFee: number;
  currency: "soft" | "premium";
  enteredAt: number;
  score: number;
  rank: number;
  prize: number;
  paidOut: boolean;
}

// ============================================================
// DATA — Cosmetics Catalog
// ============================================================

const COSMETICS_CATALOG: CosmeticsItem[] = [
  {
    id: "skin_neon",
    name: "Neon Skin",
    description: "Glow in the dark with neon style",
    type: "skin",
    price: 500,
    currency: "soft",
    imageUrl: "/cosmetics/neon.png",
    rarity: "rare"
  },
  {
    id: "skin_gold",
    name: "Golden Skin",
    description: "Shine like gold",
    type: "skin",
    price: 1000,
    currency: "premium",
    imageUrl: "/cosmetics/gold.png",
    rarity: "legendary"
  },
  {
    id: "emote_dance",
    name: "Dance Emote",
    description: "Show off your moves",
    type: "emote",
    price: 200,
    currency: "soft",
    imageUrl: "/cosmetics/dance.png",
    rarity: "common"
  },
  {
    id: "avatar_crown",
    name: "Crown Avatar",
    description: "Wear the crown of victory",
    type: "avatar",
    price: 750,
    currency: "premium",
    imageUrl: "/cosmetics/crown.png",
    rarity: "rare"
  },
  {
    id: "trail_stars",
    name: "Star Trail",
    description: "Leave a trail of stars behind you",
    type: "trail",
    price: 300,
    currency: "soft",
    imageUrl: "/cosmetics/stars.png",
    rarity: "uncommon"
  }
];

// ============================================================
// INIT
// ============================================================

export function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
  logger.info("LNBQSHA Product Layer — Monetization Module initialized");
}

// ============================================================
// HELPERS
// ============================================================

function getInventory(nk: nkruntime.Nakama, userId: string): InventoryItem[] {
  const collection = "inventory";
  const key = "cosmetics";

  try {
    const result = nk.storageRead([{ collection, key, userId }]);
    if (result && result.length > 0 && result[0].value) {
      return result[0].value as InventoryItem[];
    }
  } catch (e) {
    // Not found
  }

  return [];
}

function saveInventory(nk: nkruntime.Nakama, userId: string, inventory: InventoryItem[]): void {
  const collection = "inventory";
  const key = "cosmetics";

  nk.storageWrite([{
    collection,
    key,
    userId,
    value: inventory,
    permissionRead: 2,
    permissionWrite: 1
  }]);
}

function hasItem(inventory: InventoryItem[], itemId: string): boolean {
  return inventory.some(item => item.itemId === itemId);
}

function getTournamentEntries(nk: nkruntime.Nakama, userId: string): TournamentEntry[] {
  const collection = "tournament_entries";
  const key = "data";

  try {
    const result = nk.storageRead([{ collection, key, userId }]);
    if (result && result.length > 0 && result[0].value) {
      return result[0].value as TournamentEntry[];
    }
  } catch (e) {
    // Not found
  }

  return [];
}

function saveTournamentEntries(nk: nkruntime.Nakama, userId: string, entries: TournamentEntry[]): void {
  const collection = "tournament_entries";
  const key = "data";

  nk.storageWrite([{
    collection,
    key,
    userId,
    value: entries,
    permissionRead: 1,
    permissionWrite: 1
  }]);
}

// ============================================================
// RPC: Get cosmetics catalog
// ============================================================

export const rpcGetCosmeticsCatalog: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const inventory = getInventory(nk, userId);
  const ownedIds = inventory.map(item => item.itemId);

  const catalog = COSMETICS_CATALOG.map(item => ({
    ...item,
    owned: ownedIds.includes(item.id)
  }));

  return JSON.stringify({ catalog });
};

// ============================================================
// RPC: Purchase cosmetics item
// ============================================================

export const rpcPurchaseCosmetic: nkruntime.RpcFunction = (
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
  const itemId: string = data.itemId;

  if (!itemId) {
    throw new Error("itemId required");
  }

  // Find item in catalog
  const item = COSMETICS_CATALOG.find(c => c.id === itemId);
  if (!item) {
    throw new Error("Item not found in catalog");
  }

  // Check if already owned
  const inventory = getInventory(nk, userId);
  if (hasItem(inventory, itemId)) {
    throw new Error("Item already owned");
  }

  // Deduct currency
  const wallet = JSON.parse(
    // We need to call our own RPC — in production use nk.rpc
    // For now, we'll implement the logic directly
    JSON.stringify({ userId })
  );

  // TODO: Actually call the economy RPCs
  // This is a simplified implementation

  // For now, we'll assume the purchase is successful
  // and we'll add the item to inventory

  // Add to inventory
  const newItem: InventoryItem = {
    itemId: item.id,
    equipped: false,
    unlockedAt: Date.now()
  };

  inventory.push(newItem);
  saveInventory(nk, userId, inventory);

  // Record transaction (should call economy module)
  logger.debug("Cosmetic purchased", { userId, itemId });

  return JSON.stringify({
    success: true,
    item,
    inventory
  });
};

// ============================================================
// RPC: Equip cosmetic item
// ============================================================

export const rpcEquipCosmetic: nkruntime.RpcFunction = (
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
  const itemId: string = data.itemId;

  if (!itemId) {
    throw new Error("itemId required");
  }

  const inventory = getInventory(nk, userId);

  // Check if item exists in inventory
  const item = inventory.find(i => i.itemId === itemId);
  if (!item) {
    throw new Error("Item not found in inventory");
  }

  // Unequip all items of same type
  const catalogItem = COSMETICS_CATALOG.find(c => c.id === itemId);
  if (!catalogItem) {
    throw new Error("Item not found in catalog");
  }

  inventory.forEach(i => {
    const c = COSMETICS_CATALOG.find(cat => cat.id === i.itemId);
    if (c && c.type === catalogItem.type) {
      i.equipped = false;
    }
  });

  // Equip the selected item
  item.equipped = true;
  saveInventory(nk, userId, inventory);

  return JSON.stringify({
    success: true,
    equipped: itemId,
    inventory
  });
};

// ============================================================
// RPC: Enter premium tournament
// ============================================================

export const rpcEnterTournament: nkruntime.RpcFunction = (
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
  const tournamentId: string = data.tournamentId;
  const entryFee: number = data.entryFee || 100;

  if (!tournamentId) {
    throw new Error("tournamentId required");
  }

  // Check if already entered
  const entries = getTournamentEntries(nk, userId);
  const existing = entries.find(e => e.tournamentId === tournamentId);
  if (existing) {
    throw new Error("Already entered this tournament");
  }

  // Deduct entry fee (premium currency)
  // TODO: Call economy RPC to deduct premium currency
  // For now, we'll just record the entry

  // Record entry
  const entry: TournamentEntry = {
    tournamentId,
    userId,
    entryFee,
    currency: "premium",
    enteredAt: Date.now(),
    score: 0,
    rank: 0,
    prize: 0,
    paidOut: false
  };

  entries.push(entry);
  saveTournamentEntries(nk, userId, entries);

  // Also record in Nakama's native tournament system
  try {
    nk.tournamentJoin(tournamentId, userId);
  } catch (e) {
    logger.warn("Failed to join Nakama tournament", { tournamentId, userId, error: e });
  }

  return JSON.stringify({
    success: true,
    tournamentId,
    entry
  });
};

// ============================================================
// RPC: Get tournament history
// ============================================================

export const rpcGetTournamentHistory: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const entries = getTournamentEntries(nk, userId);
  return JSON.stringify({ tournaments: entries });
};

// ============================================================
// RPC: Claim tournament prize
// ============================================================

export const rpcClaimTournamentPrize: nkruntime.RpcFunction = (
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
  const tournamentId: string = data.tournamentId;

  if (!tournamentId) {
    throw new Error("tournamentId required");
  }

  const entries = getTournamentEntries(nk, userId);
  const entry = entries.find(e => e.tournamentId === tournamentId);
  if (!entry) {
    throw new Error("Tournament entry not found");
  }

  if (entry.paidOut) {
    throw new Error("Prize already claimed");
  }

  if (entry.prize <= 0) {
    throw new Error("No prize to claim");
  }

  // Award prize (soft currency)
  // TODO: Call economy RPC to add soft currency

  entry.paidOut = true;
  saveTournamentEntries(nk, userId, entries);

  return JSON.stringify({
    success: true,
    prize: entry.prize,
    tournamentId
  });
};
