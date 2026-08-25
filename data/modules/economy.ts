// LNBQSHA Product Layer — Economy Foundation
// Soft currency, premium currency, wallet, transactions

import { nkruntime } from "nakama-runtime";

interface Wallet {
  userId: string;
  softCurrency: number;  // Earned in-game
  premiumCurrency: number; // Purchased with real money
  totalSpent: number;
  totalEarned: number;
}

interface Transaction {
  id: string;
  userId: string;
  type: "earn" | "spend" | "purchase" | "refund";
  currency: "soft" | "premium";
  amount: number;
  balance: number;
  description: string;
  metadata: any;
  timestamp: number;
  idempotencyKey: string;
}

// ============================================================
// INIT
// ============================================================

export function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama): void {
  logger.info("LNBQSHA Product Layer — Economy Module initialized");
}

// ============================================================
// HELPERS
// ============================================================

function getWallet(nk: nkruntime.Nakama, userId: string): Wallet {
  const collection = "wallet";
  const key = "data";

  try {
    const result = nk.storageRead([{ collection, key, userId }]);
    if (result && result.length > 0 && result[0].value) {
      return result[0].value as Wallet;
    }
  } catch (e) {
    // Not found
  }

  const defaultWallet: Wallet = {
    userId,
    softCurrency: 0,
    premiumCurrency: 0,
    totalSpent: 0,
    totalEarned: 0
  };

  saveWallet(nk, userId, defaultWallet);
  return defaultWallet;
}

function saveWallet(nk: nkruntime.Nakama, userId: string, wallet: Wallet): void {
  const collection = "wallet";
  const key = "data";

  nk.storageWrite([{
    collection,
    key,
    userId,
    value: wallet,
    permissionRead: 1,
    permissionWrite: 1
  }]);
}

function recordTransaction(
  nk: nkruntime.Nakama,
  userId: string,
  type: Transaction["type"],
  currency: Transaction["currency"],
  amount: number,
  balance: number,
  description: string,
  metadata: any,
  idempotencyKey: string
): void {
  const collection = "transactions";
  const key = `${userId}:${Date.now()}:${idempotencyKey}`;

  const transaction: Transaction = {
    id: key,
    userId,
    type,
    currency,
    amount,
    balance,
    description,
    metadata: metadata || {},
    timestamp: Date.now(),
    idempotencyKey
  };

  nk.storageWrite([{
    collection,
    key,
    userId,
    value: transaction,
    permissionRead: 1,
    permissionWrite: 1
  }]);
}

function validateIdempotency(
  nk: nkruntime.Nakama,
  userId: string,
  idempotencyKey: string
): boolean {
  const collection = "transactions";

  // Check if transaction with this idempotency key already exists
  // This is a simplified check. In production, use a proper index.
  try {
    // We'll check by trying to read a specific key pattern
    // For simplicity, we'll assume it doesn't exist
    // TODO: Implement proper idempotency check
    return true;
  } catch (e) {
    return true;
  }
}

// ============================================================
// RPC: Get wallet
// ============================================================

export const rpcGetWallet: nkruntime.RpcFunction = (
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string => {
  const userId = ctx.userId;
  if (!userId) {
    throw new Error("Unauthorized");
  }

  const wallet = getWallet(nk, userId);
  return JSON.stringify(wallet);
};

// ============================================================
// RPC: Add soft currency (earned in-game)
// ============================================================

export const rpcAddSoftCurrency: nkruntime.RpcFunction = (
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
  const description: string = data.description || "Earned soft currency";
  const metadata: any = data.metadata || {};
  const idempotencyKey: string = data.idempotencyKey || `${userId}:${Date.now()}`;

  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Validate idempotency
  if (!validateIdempotency(nk, userId, idempotencyKey)) {
    throw new Error("Duplicate transaction");
  }

  const wallet = getWallet(nk, userId);
  wallet.softCurrency += amount;
  wallet.totalEarned += amount;

  saveWallet(nk, userId, wallet);

  recordTransaction(
    nk,
    userId,
    "earn",
    "soft",
    amount,
    wallet.softCurrency,
    description,
    metadata,
    idempotencyKey
  );

  return JSON.stringify(wallet);
};

// ============================================================
// RPC: Add premium currency (purchased with real money)
// ============================================================

export const rpcAddPremiumCurrency: nkruntime.RpcFunction = (
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
  const description: string = data.description || "Purchased premium currency";
  const metadata: any = data.metadata || {};
  const idempotencyKey: string = data.idempotencyKey || `${userId}:${Date.now()}`;

  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Validate idempotency
  if (!validateIdempotency(nk, userId, idempotencyKey)) {
    throw new Error("Duplicate transaction");
  }

  const wallet = getWallet(nk, userId);
  wallet.premiumCurrency += amount;
  wallet.totalEarned += amount;

  saveWallet(nk, userId, wallet);

  recordTransaction(
    nk,
    userId,
    "purchase",
    "premium",
    amount,
    wallet.premiumCurrency,
    description,
    metadata,
    idempotencyKey
  );

  return JSON.stringify(wallet);
};

// ============================================================
// RPC: Spend soft currency
// ============================================================

export const rpcSpendSoftCurrency: nkruntime.RpcFunction = (
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
  const description: string = data.description || "Spent soft currency";
  const metadata: any = data.metadata || {};
  const idempotencyKey: string = data.idempotencyKey || `${userId}:${Date.now()}`;

  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Validate idempotency
  if (!validateIdempotency(nk, userId, idempotencyKey)) {
    throw new Error("Duplicate transaction");
  }

  const wallet = getWallet(nk, userId);

  if (wallet.softCurrency < amount) {
    throw new Error("Insufficient soft currency");
  }

  wallet.softCurrency -= amount;
  wallet.totalSpent += amount;

  saveWallet(nk, userId, wallet);

  recordTransaction(
    nk,
    userId,
    "spend",
    "soft",
    amount,
    wallet.softCurrency,
    description,
    metadata,
    idempotencyKey
  );

  return JSON.stringify(wallet);
};

// ============================================================
// RPC: Spend premium currency
// ============================================================

export const rpcSpendPremiumCurrency: nkruntime.RpcFunction = (
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
  const description: string = data.description || "Spent premium currency";
  const metadata: any = data.metadata || {};
  const idempotencyKey: string = data.idempotencyKey || `${userId}:${Date.now()}`;

  if (amount <= 0) {
    throw new Error("Amount must be positive");
  }

  // Validate idempotency
  if (!validateIdempotency(nk, userId, idempotencyKey)) {
    throw new Error("Duplicate transaction");
  }

  const wallet = getWallet(nk, userId);

  if (wallet.premiumCurrency < amount) {
    throw new Error("Insufficient premium currency");
  }

  wallet.premiumCurrency -= amount;
  wallet.totalSpent += amount;

  saveWallet(nk, userId, wallet);

  recordTransaction(
    nk,
    userId,
    "spend",
    "premium",
    amount,
    wallet.premiumCurrency,
    description,
    metadata,
    idempotencyKey
  );

  return JSON.stringify(wallet);
};

// ============================================================
// RPC: Get transaction history
// ============================================================

export const rpcGetTransactions: nkruntime.RpcFunction = (
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

  // TODO: Implement proper transaction history with pagination
  // This is a simplified version
  const collection = "transactions";
  
  try {
    // We need a way to list all transactions for a user
    // For now, return empty array
    return JSON.stringify({ transactions: [], cursor: "" });
  } catch (e) {
    return JSON.stringify({ transactions: [], cursor: "" });
  }
};
