# Nakama ES Modules Examples

This directory contains **complete, working examples** of Nakama JavaScript modules using **ES Module (ESM) syntax**.

## ⚠️ Important

These examples use **ES Modules** (import/export), which is the **ONLY** module system supported by Nakama 3.x JavaScript runtime.

**CommonJS (require/module.exports) DOES NOT WORK** in Nakama's JavaScript runtime.

## Directory Structure

```
esm-modules/
├── index.js                    # Main entry point with InitModule
├── wallet/
│   └── wallet.js              # Wallet RPC functions
├── leaderboards/
│   └── leaderboards.js        # Leaderboard RPC functions
└── utils/
    ├── helper.js              # Utility functions
    └── constants.js           # Shared constants
```

## Files Overview

### `index.js` - Main Entry Point

This is the **required** entry point for Nakama. It must:
- Export a default function named `InitModule`
- Import and register all RPC functions
- Handle initialization errors

**Key Features:**
```javascript
// ✅ Correct ESM import
import { rpcWalletGetAll } from './wallet/wallet.js';

// ✅ Default export
export default function InitModule(ctx, logger, nk, initializer) {
    // Register RPCs
    initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
}
```

### `wallet/wallet.js` - Wallet Module

Demonstrates:
- Multiple named exports
- Importing from utility modules
- Reading/writing Nakama storage
- Error handling
- Input validation

**Exported Functions:**
- `rpcWalletGetAll` - Get user wallet
- `rpcWalletUpdate` - Update wallet currencies

### `leaderboards/leaderboards.js` - Leaderboard Module

Demonstrates:
- Leaderboard record submission
- Leaderboard record retrieval
- Score validation
- Reward calculation

**Exported Functions:**
- `rpcLeaderboardSubmit` - Submit score
- `rpcGetLeaderboard` - Get top scores

### `utils/helper.js` - Utility Functions

Reusable utility functions:
- `formatCurrency` - Format numbers
- `getCurrentTimestamp` - ISO timestamps
- `validateScore` - Input validation
- `calculateRewards` - Reward logic
- `generateId` - Random IDs
- `safeJsonParse` - Safe JSON parsing

### `utils/constants.js` - Shared Constants

Application-wide constants:
- Collection names
- Currency types
- Time constants
- Error messages
- Response codes

## How to Use These Examples

### Option 1: Copy to Your Project

```bash
# Copy entire directory to your Nakama data folder
cp -r examples/esm-modules/* /path/to/nakama/data/modules/
```

### Option 2: Use as Reference

Study these files to understand:
- How to structure ES modules
- How to import/export functions
- How to organize code
- Best practices for Nakama RPCs

### Option 3: Docker Deployment

1. **Copy files:**
   ```bash
   mkdir -p ./data/modules
   cp -r examples/esm-modules/* ./data/modules/
   ```

2. **Create docker-compose.yml:**
   ```yaml
   version: '3'
   services:
     cockroachdb:
       image: cockroachdb/cockroach:latest-v24.1
       command: start-single-node --insecure
       volumes:
         - data:/var/lib/cockroach
       ports:
         - "26257:26257"
     
     nakama:
       image: heroiclabs/nakama:3.22.0
       depends_on:
         - cockroachdb
       volumes:
         - ./data/modules:/nakama/data/modules
       environment:
         - NAKAMA_DATABASE_ADDRESS=root@cockroachdb:26257
       ports:
         - "7350:7350"
         - "7351:7351"
   
   volumes:
     data:
   ```

3. **Start services:**
   ```bash
   docker-compose up
   ```

4. **Check logs:**
   ```bash
   docker-compose logs -f nakama
   ```

   You should see:
   ```
   {"level":"info","msg":"JavaScript Runtime Initialization Started"}
   {"level":"info","msg":"✅ Registered RPC: wallet_get_all"}
   {"level":"info","msg":"✅ Registered RPC: wallet_update"}
   {"level":"info","msg":"✅ Registered RPC: leaderboard_submit"}
   {"level":"info","msg":"✅ Registered RPC: leaderboard_get"}
   {"level":"info","msg":"✅ Successfully registered 4 RPC functions"}
   ```

## Testing the RPCs

### 1. Authenticate

```bash
TOKEN=$(curl -s -X POST http://localhost:7350/v2/account/authenticate/device \
  -H 'Content-Type: application/json' \
  -d '{"id":"test-device-123","create":true}' \
  | jq -r '.token')
```

### 2. Get Wallet

```bash
curl -X POST http://localhost:7350/v2/rpc/wallet_get_all \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json"
```

**Expected Response:**
```json
{
  "success": true,
  "wallet": {
    "userId": "...",
    "currencies": { "xut": 0, "xp": 0 },
    "createdAt": "2024-01-15T10:00:00.000Z"
  }
}
```

### 3. Update Wallet

```bash
curl -X POST http://localhost:7350/v2/rpc/wallet_update \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"xut": 1000, "xp": 500}'
```

**Expected Response:**
```json
{
  "success": true,
  "wallet": {
    "userId": "...",
    "currencies": { "xut": 1000, "xp": 500 },
    "updatedAt": "2024-01-15T10:01:00.000Z"
  },
  "delta": { "xut": 1000, "xp": 500 }
}
```

### 4. Submit Leaderboard Score

```bash
curl -X POST http://localhost:7350/v2/rpc/leaderboard_submit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId": "test-game-123", "score": 15000}'
```

**Expected Response:**
```json
{
  "success": true,
  "score": 15000,
  "leaderboardId": "leaderboard_test-game-123",
  "rewards": { "xp": 1500, "xut": 150, "bonus": 1000 }
}
```

### 5. Get Leaderboard

```bash
curl -X POST http://localhost:7350/v2/rpc/leaderboard_get \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId": "test-game-123", "limit": 10}'
```

**Expected Response:**
```json
{
  "success": true,
  "leaderboardId": "leaderboard_test-game-123",
  "records": [
    {
      "rank": 1,
      "userId": "...",
      "username": "testuser",
      "score": 15000,
      "subscore": 0
    }
  ],
  "totalRecords": 1
}
```

## Key Differences from CommonJS

### ❌ Old Way (CommonJS - BROKEN in Nakama)

```javascript
// DON'T DO THIS
var utils = require('./utils/helper.js');

function myRpc(ctx, logger, nk, payload) {
    return utils.getCurrentTimestamp();
}

module.exports = {
    myRpc: myRpc
};
```

### ✅ New Way (ESM - WORKS in Nakama)

```javascript
// DO THIS
import { getCurrentTimestamp } from './utils/helper.js';

export function myRpc(ctx, logger, nk, payload) {
    return getCurrentTimestamp();
}
```

## Common Mistakes to Avoid

### 1. Missing `.js` Extension

```javascript
// ❌ WRONG
import { x } from './module';

// ✅ CORRECT
import { x } from './module.js';
```

### 2. Using require()

```javascript
// ❌ WRONG
var x = require('./module.js');

// ✅ CORRECT
import { x } from './module.js';
```

### 3. Using module.exports

```javascript
// ❌ WRONG
module.exports = { x: 123 };

// ✅ CORRECT
export const x = 123;
```

### 4. Not exporting InitModule as default

```javascript
// ❌ WRONG
export function InitModule() { }

// ✅ CORRECT
export default function InitModule() { }
```

## Extending These Examples

### Adding a New Module

1. Create a new directory: `mkdir my_feature`
2. Create module file: `my_feature/my_feature.js`
3. Export your RPC functions:
   ```javascript
   export function rpcMyFeature(ctx, logger, nk, payload) {
       // Implementation
   }
   ```
4. Import in `index.js`:
   ```javascript
   import { rpcMyFeature } from './my_feature/my_feature.js';
   ```
5. Register in InitModule:
   ```javascript
   initializer.registerRpc('my_feature', rpcMyFeature);
   ```

### Adding Utilities

Add functions to `utils/helper.js`:
```javascript
export function myUtility(param) {
    // Implementation
}
```

Use in your modules:
```javascript
import { myUtility } from '../utils/helper.js';
```

### Adding Constants

Add to `utils/constants.js`:
```javascript
export const MY_CONSTANT = 'value';
```

Use in your modules:
```javascript
import { MY_CONSTANT } from '../utils/constants.js';
```

## Troubleshooting

### "require is not defined"

**Problem:** You're using CommonJS syntax.

**Solution:** Replace `require()` with `import` and `module.exports` with `export`.

### "Cannot find module"

**Problem:** Import path is incorrect.

**Solution:** 
- Always use `.js` extension
- Use relative paths (`./` or `../`)
- Check file actually exists

### "InitModule is not a function"

**Problem:** InitModule not exported as default.

**Solution:** Use `export default function InitModule`.

### RPC not registered

**Problem:** Function not imported or registered.

**Solution:** 
1. Check import statement
2. Verify `initializer.registerRpc()` call
3. Check function name matches

## Additional Resources

- [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](../../NAKAMA_JAVASCRIPT_ESM_GUIDE.md) - Complete ESM guide
- [NAKAMA_TYPESCRIPT_ESM_BUILD.md](../../NAKAMA_TYPESCRIPT_ESM_BUILD.md) - TypeScript setup
- [NAKAMA_DOCKER_ESM_DEPLOYMENT.md](../../NAKAMA_DOCKER_ESM_DEPLOYMENT.md) - Docker deployment
- [Official Nakama Docs](https://heroiclabs.com/docs) - Nakama documentation

## License

These examples are provided as-is for educational purposes. Feel free to use and modify for your Nakama projects.
