// utils/constants.js - Shared constants
// ✅ This is the CORRECT ESM version

/**
 * Storage collection names
 */
export const WALLET_COLLECTION = 'wallets';
export const LEADERBOARD_COLLECTION = 'leaderboards';
export const MISSION_COLLECTION = 'missions';
export const ANALYTICS_COLLECTION = 'analytics';
export const PLAYER_COLLECTION = 'players';

/**
 * Currency types
 */
export const CURRENCIES = {
    XUT: 'xut',
    XP: 'xp',
    TOKENS: 'tokens',
    GEMS: 'gems'
};

/**
 * Leaderboard period types
 */
export const LEADERBOARD_PERIODS = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    ALL_TIME: 'all_time'
};

/**
 * Mission status values
 */
export const MISSION_STATUS = {
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CLAIMED: 'claimed',
    EXPIRED: 'expired'
};

/**
 * Reward types
 */
export const REWARD_TYPES = {
    CURRENCY: 'currency',
    ITEM: 'item',
    XP: 'xp',
    UNLOCK: 'unlock'
};

/**
 * Maximum values
 */
export const MAX_SCORE = 1000000;
export const MAX_WALLET_AMOUNT = 999999999;
export const MAX_LEADERBOARD_RECORDS = 100;

/**
 * Default values
 */
export const DEFAULT_CURRENCY_AMOUNT = 0;
export const DEFAULT_XP = 0;
export const DEFAULT_LEVEL = 1;

/**
 * Time constants (in milliseconds)
 */
export const ONE_SECOND = 1000;
export const ONE_MINUTE = 60 * ONE_SECOND;
export const ONE_HOUR = 60 * ONE_MINUTE;
export const ONE_DAY = 24 * ONE_HOUR;
export const ONE_WEEK = 7 * ONE_DAY;

/**
 * API response codes
 */
export const RESPONSE_CODES = {
    SUCCESS: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_ERROR: 500
};

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
    INVALID_PAYLOAD: 'Invalid payload format',
    MISSING_FIELD: 'Required field is missing',
    INVALID_SCORE: 'Invalid score value',
    INVALID_AMOUNT: 'Invalid amount value',
    USER_NOT_FOUND: 'User not found',
    LEADERBOARD_NOT_FOUND: 'Leaderboard not found',
    WALLET_NOT_FOUND: 'Wallet not found',
    INSUFFICIENT_FUNDS: 'Insufficient funds'
};

// Note: This file demonstrates exporting constants
// using ES module syntax.
// 
// Key points:
// 1. ✅ Export each constant individually with 'export const'
// 2. ✅ Group related constants together
// 3. ✅ Use UPPER_CASE for constant names
// 4. ✅ Constants can be imported selectively
// 5. ✅ Clear organization and documentation
