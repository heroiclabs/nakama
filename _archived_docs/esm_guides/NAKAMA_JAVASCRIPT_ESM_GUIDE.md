# Nakama JavaScript Runtime: ESM Module Guide

## Why Nakama's JavaScript Runtime Does NOT Support CommonJS

### The Problem
When you see this error:
```
ReferenceError: require is not defined at index.js:5:26(6)
Failed to eval JavaScript modules
Failed initializing JavaScript runtime provider
```

It means you're trying to use CommonJS syntax (`require`, `module.exports`) in Nakama's JavaScript runtime, **which is not supported**.

### Technical Explanation

**Nakama 3.x uses a modern JavaScript engine** that only supports **ES Modules (ESM)**, not CommonJS:

1. **Runtime Engine**: Nakama uses either:
   - **V8** (Google's JavaScript engine - same as Node.js and Chrome)
   - **Goja** (Pure Go JavaScript interpreter for ES5/ES6+)

2. **Module System**: The runtime is configured for **ES2020+ modules**, which means:
   - ✅ `import` and `export` statements (ESM)
   - ❌ `require()` and `module.exports` (CommonJS)
   - ✅ Top-level `await` support
   - ✅ Modern JavaScript features (arrow functions, async/await, destructuring, etc.)

3. **Why Not CommonJS?**
   - CommonJS (`require`) is a **Node.js-specific** module system
   - Nakama's runtime is **not Node.js** - it's an embedded JavaScript engine
   - ES Modules are the **ECMAScript standard** for JavaScript modules
   - ES Modules provide better static analysis, tree-shaking, and performance

### Migration Overview

**Before (CommonJS - BROKEN):**
```javascript
// ❌ This DOES NOT work in Nakama
var SomeModule = require('./some_module.js');

function myRpcFunction(ctx, logger, nk, payload) {
    return SomeModule.doSomething(payload);
}

module.exports = {
    myRpcFunction: myRpcFunction
};
```

**After (ESM - CORRECT):**
```javascript
// ✅ This WORKS in Nakama
import { doSomething } from './some_module.js';

export function myRpcFunction(ctx, logger, nk, payload) {
    return doSomething(payload);
}
```

---

## ES Module Structure for Nakama

### Recommended Project Structure

```
/nakama/data/modules/
├── index.js                    # Main entry point with InitModule
├── my_module.js                # Feature module
├── utils/
│   ├── helper.js              # Utility functions
│   └── constants.js           # Shared constants
├── wallet/
│   ├── wallet.js              # Wallet RPC functions
│   └── wallet_utils.js        # Wallet helpers
└── leaderboards/
    └── leaderboards.js        # Leaderboard RPC functions
```

---

## Complete Example: ESM Modules in Nakama

### 1. Main Entry Point: `index.js`

```javascript
// index.js - Main entry point for Nakama JavaScript runtime
// This file MUST export a default InitModule function

import { rpcWalletGetAll, rpcWalletUpdate } from './wallet/wallet.js';
import { rpcLeaderboardSubmit } from './leaderboards/leaderboards.js';
import { calculateRewards, validateScore } from './utils/helper.js';

/**
 * Main initialization function called by Nakama on startup
 * This is the ONLY required export for Nakama to load your modules
 */
export default function InitModule(ctx, logger, nk, initializer) {
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Started');
    logger.info('========================================');
    
    // Register RPC functions
    try {
        // Wallet RPCs
        initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
        logger.info('[Wallet] Registered RPC: wallet_get_all');
        
        initializer.registerRpc('wallet_update', rpcWalletUpdate);
        logger.info('[Wallet] Registered RPC: wallet_update');
        
        // Leaderboard RPCs
        initializer.registerRpc('leaderboard_submit', rpcLeaderboardSubmit);
        logger.info('[Leaderboards] Registered RPC: leaderboard_submit');
        
        logger.info('========================================');
        logger.info('Successfully registered 3 RPC functions');
        logger.info('========================================');
    } catch (err) {
        logger.error('Failed to initialize modules: ' + err.message);
        throw err;
    }
}
```

**Key Points:**
- ✅ `export default` for InitModule
- ✅ `import` statements for other modules
- ✅ No `require()` or `module.exports`

### 2. Feature Module: `wallet/wallet.js`

```javascript
// wallet/wallet.js - Wallet system with ESM exports

import { formatCurrency, getCurrentTimestamp } from '../utils/helper.js';
import { WALLET_COLLECTION } from '../utils/constants.js';

/**
 * RPC: Get all wallets for a user
 * @param {object} ctx - Nakama context
 * @param {object} logger - Logger instance
 * @param {object} nk - Nakama runtime API
 * @param {string} payload - JSON payload
 * @returns {string} JSON response
 */
export function rpcWalletGetAll(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    
    try {
        // Read wallet from storage
        const records = nk.storageRead([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId
        }]);
        
        if (records && records.length > 0) {
            return JSON.stringify({
                success: true,
                wallet: records[0].value
            });
        }
        
        // Return empty wallet if not found
        return JSON.stringify({
            success: true,
            wallet: {
                currencies: { xut: 0, xp: 0 },
                createdAt: getCurrentTimestamp()
            }
        });
    } catch (err) {
        logger.error('Failed to get wallet: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}

/**
 * RPC: Update wallet currencies
 */
export function rpcWalletUpdate(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const data = JSON.parse(payload);
    
    try {
        // Update wallet logic here
        const wallet = {
            currencies: {
                xut: data.xut || 0,
                xp: data.xp || 0
            },
            updatedAt: getCurrentTimestamp()
        };
        
        nk.storageWrite([{
            collection: WALLET_COLLECTION,
            key: 'user_wallet',
            userId: userId,
            value: wallet,
            permissionRead: 1,
            permissionWrite: 0
        }]);
        
        logger.info('Wallet updated for user: ' + userId);
        
        return JSON.stringify({ success: true, wallet: wallet });
    } catch (err) {
        logger.error('Failed to update wallet: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}
```

**Key Points:**
- ✅ Multiple named exports using `export function`
- ✅ Import utilities from other modules
- ✅ Each RPC function is exported individually

### 3. Utility Module: `utils/helper.js`

```javascript
// utils/helper.js - Shared utility functions

/**
 * Format currency value for display
 * @param {number} value - Currency value
 * @returns {string} Formatted currency
 */
export function formatCurrency(value) {
    return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Get current ISO timestamp
 * @returns {string} ISO 8601 timestamp
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
 * Calculate reward based on score
 * @param {number} score - Player score
 * @returns {object} Reward object
 */
export function calculateRewards(score) {
    const baseXP = Math.floor(score / 10);
    const baseXUT = Math.floor(score / 100);
    
    return {
        xp: baseXP,
        xut: baseXUT,
        bonus: score > 10000 ? 1000 : 0
    };
}
```

**Key Points:**
- ✅ Export individual utility functions
- ✅ Can be imported selectively by other modules
- ✅ Pure functions with no side effects

### 4. Constants Module: `utils/constants.js`

```javascript
// utils/constants.js - Shared constants

export const WALLET_COLLECTION = 'wallets';
export const LEADERBOARD_COLLECTION = 'leaderboards';
export const MISSION_COLLECTION = 'missions';

export const CURRENCIES = {
    XUT: 'xut',
    XP: 'xp',
    TOKENS: 'tokens'
};

export const LEADERBOARD_PERIODS = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    ALL_TIME: 'all_time'
};
```

**Key Points:**
- ✅ Export constants for reuse across modules
- ✅ Provides type safety and consistency

### 5. Another Feature Module: `leaderboards/leaderboards.js`

```javascript
// leaderboards/leaderboards.js - Leaderboard system

import { validateScore, calculateRewards } from '../utils/helper.js';
import { LEADERBOARD_COLLECTION } from '../utils/constants.js';

/**
 * RPC: Submit score to leaderboard
 */
export function rpcLeaderboardSubmit(ctx, logger, nk, payload) {
    const userId = ctx.userId;
    const data = JSON.parse(payload);
    const score = data.score;
    const gameId = data.gameId;
    
    // Validate score
    if (!validateScore(score)) {
        return JSON.stringify({
            success: false,
            error: 'Invalid score value'
        });
    }
    
    try {
        const leaderboardId = 'leaderboard_' + gameId;
        
        // Submit to leaderboard
        nk.leaderboardRecordWrite(
            leaderboardId,
            userId,
            null, // username (optional)
            score,
            0,    // subscore
            { timestamp: new Date().toISOString() }
        );
        
        // Calculate and award rewards
        const rewards = calculateRewards(score);
        
        logger.info('Score submitted: ' + score + ' for user: ' + userId);
        
        return JSON.stringify({
            success: true,
            score: score,
            rewards: rewards
        });
    } catch (err) {
        logger.error('Failed to submit score: ' + err.message);
        return JSON.stringify({ success: false, error: err.message });
    }
}
```

---

## Import Syntax Examples

### Named Imports

```javascript
// Import specific functions
import { functionA, functionB } from './module.js';

// Import with alias
import { functionA as myFunction } from './module.js';

// Import multiple items
import { CONSTANT_A, CONSTANT_B, helperFunc } from './module.js';
```

### Default Import

```javascript
// Import default export
import InitModule from './index.js';
```

### Combined Import

```javascript
// Import both default and named exports
import InitModule, { someHelper } from './index.js';
```

### Import Everything

```javascript
// Import all exports as namespace
import * as WalletUtils from './wallet_utils.js';

// Use as: WalletUtils.functionName()
```

---

## Export Syntax Examples

### Named Exports (Recommended for RPC functions)

```javascript
// Export function declaration
export function myRpcFunction(ctx, logger, nk, payload) {
    // ...
}

// Export const/let/var
export const API_VERSION = '1.0.0';

// Export multiple at once
export { functionA, functionB, CONSTANT_C };
```

### Default Export (Required for InitModule)

```javascript
// Export function as default
export default function InitModule(ctx, logger, nk, initializer) {
    // ...
}

// Or export existing function
function InitModule(ctx, logger, nk, initializer) {
    // ...
}
export default InitModule;
```

### Re-exports

```javascript
// Re-export from another module
export { rpcFunction } from './other_module.js';

// Re-export all
export * from './other_module.js';

// Re-export with rename
export { oldName as newName } from './other_module.js';
```

---

## Common Migration Patterns

### Pattern 1: Simple Function Export

**Before (CommonJS):**
```javascript
function myFunction() {
    return "Hello";
}

module.exports = {
    myFunction: myFunction
};
```

**After (ESM):**
```javascript
export function myFunction() {
    return "Hello";
}
```

### Pattern 2: Object with Multiple Methods

**Before (CommonJS):**
```javascript
var MyModule = {
    methodA: function() { /* ... */ },
    methodB: function() { /* ... */ }
};

module.exports = MyModule;
```

**After (ESM):**
```javascript
export function methodA() { /* ... */ }
export function methodB() { /* ... */ }
```

### Pattern 3: Importing Other Modules

**Before (CommonJS):**
```javascript
var Utils = require('./utils.js');
var Constants = require('./constants.js');

function myFunction() {
    return Utils.helper() + Constants.VALUE;
}
```

**After (ESM):**
```javascript
import { helper } from './utils.js';
import { VALUE } from './constants.js';

export function myFunction() {
    return helper() + VALUE;
}
```

### Pattern 4: Conditional/Dynamic Imports

**Before (CommonJS):**
```javascript
if (condition) {
    var module = require('./module.js');
}
```

**After (ESM):**
```javascript
// Use top-level await (ES2022+)
if (condition) {
    const module = await import('./module.js');
}
```

---

## Important Notes

### 1. File Extensions
- ✅ **Always use `.js` extension** in import paths
- ✅ Example: `import { x } from './module.js'` (not `'./module'`)

### 2. Relative Paths
- ✅ Use `./` or `../` for relative imports
- ✅ Example: `import { x } from './utils/helper.js'`
- ❌ Don't use: `import { x } from 'helper.js'`

### 3. No Dynamic Requires
- ❌ Can't use `require()` at all
- ❌ Can't do: `var moduleName = someCondition ? './a.js' : './b.js'; require(moduleName);`
- ✅ Use static imports or dynamic `import()` with top-level await

### 4. Circular Dependencies
- ESM handles circular dependencies better than CommonJS
- But still try to avoid them for clarity

### 5. Variables vs Functions
```javascript
// These are equivalent
export function myFunc() { }
export const myFunc = () => { };

// But this is different (not hoisted)
export const myFunc = function() { };
```

---

## Testing Your ESM Modules

### Successful Initialization Logs

When your modules load correctly, you should see:
```
{"level":"info","ts":"2024-01-15T10:30:00.123Z","msg":"JavaScript Runtime Initialization Started"}
{"level":"info","ts":"2024-01-15T10:30:00.124Z","msg":"[Wallet] Registered RPC: wallet_get_all"}
{"level":"info","ts":"2024-01-15T10:30:00.125Z","msg":"Successfully registered 3 RPC functions"}
{"level":"info","ts":"2024-01-15T10:30:00.126Z","msg":"Startup done"}
```

### Error Indicators

If you see these, you still have CommonJS code:
```
{"level":"error","ts":"...","msg":"ReferenceError: require is not defined"}
{"level":"error","ts":"...","msg":"Failed to eval JavaScript modules"}
{"level":"error","ts":"...","msg":"Failed initializing JavaScript runtime provider"}
```

---

## Summary

✅ **DO:**
- Use `import` and `export` statements
- Export functions with `export function`
- Use `export default` for InitModule
- Include `.js` extension in import paths
- Use relative paths (`./` or `../`)

❌ **DON'T:**
- Use `require()` - it doesn't exist
- Use `module.exports` - it doesn't exist
- Use `exports.x = ...` - it doesn't exist
- Omit file extensions in imports
- Mix CommonJS and ESM syntax

---

## Next Steps

1. Convert all your `.js` files to ESM syntax
2. Update `index.js` with `export default InitModule`
3. Test locally with Docker
4. Verify RPC registration in logs
5. Test RPC calls from Unity client

See [NAKAMA_TYPESCRIPT_ESM_BUILD.md](./NAKAMA_TYPESCRIPT_ESM_BUILD.md) for TypeScript build configuration.
