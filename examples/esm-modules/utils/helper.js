// utils/helper.js - Shared utility functions
// ✅ This is the CORRECT ESM version

/**
 * Format currency value for display
 * @param {number} value - Currency value
 * @returns {string} Formatted currency string
 */
export function formatCurrency(value) {
    if (typeof value !== 'number') {
        return '0';
    }
    return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Get current ISO 8601 timestamp
 * @returns {string} ISO timestamp
 */
export function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Validate score is within acceptable range
 * @param {number} score - Score to validate
 * @returns {boolean} True if valid
 */
export function validateScore(score) {
    return typeof score === 'number' && score >= 0 && score <= 1000000;
}

/**
 * Validate amount is positive number
 * @param {number} amount - Amount to validate
 * @returns {boolean} True if valid
 */
export function validateAmount(amount) {
    return typeof amount === 'number' && amount >= 0;
}

/**
 * Calculate rewards based on score
 * @param {number} score - Player score
 * @returns {object} Reward object with xp, xut, and bonus
 */
export function calculateRewards(score) {
    if (!validateScore(score)) {
        return { xp: 0, xut: 0, bonus: 0 };
    }
    
    const baseXP = Math.floor(score / 10);
    const baseXUT = Math.floor(score / 100);
    
    // Bonus for high scores
    let bonus = 0;
    if (score >= 100000) {
        bonus = 5000;
    } else if (score >= 50000) {
        bonus = 2000;
    } else if (score >= 10000) {
        bonus = 1000;
    }
    
    return {
        xp: baseXP,
        xut: baseXUT,
        bonus: bonus
    };
}

/**
 * Generate a random ID
 * @param {number} length - Length of ID
 * @returns {string} Random ID
 */
export function generateId(length) {
    length = length || 16;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/**
 * Sleep/delay for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after delay
 */
export function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

/**
 * Safe JSON parse with fallback
 * @param {string} jsonString - JSON string to parse
 * @param {*} fallback - Fallback value if parse fails
 * @returns {*} Parsed object or fallback
 */
export function safeJsonParse(jsonString, fallback) {
    try {
        return JSON.parse(jsonString);
    } catch (err) {
        return fallback !== undefined ? fallback : {};
    }
}

/**
 * Clamp value between min and max
 * @param {number} value - Value to clamp
 * @param {number} min - Minimum value
 * @param {number} max - Maximum value
 * @returns {number} Clamped value
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Note: This file demonstrates exporting utility functions
// using ES module syntax.
// 
// Key points:
// 1. ✅ Export each function individually with 'export function'
// 2. ✅ Functions can be imported selectively by other modules
// 3. ✅ Pure functions with no side effects
// 4. ✅ Clear JSDoc comments for documentation
// 5. ✅ No dependencies on other modules (can be used anywhere)
