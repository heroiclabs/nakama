# Building Nakama JavaScript Modules with TypeScript

This guide shows how to use TypeScript to build ES2020 modules for Nakama's JavaScript runtime.

---

## Why Use TypeScript?

**Benefits:**
- ✅ Type safety and compile-time error checking
- ✅ Better IDE autocomplete and IntelliSense
- ✅ Automatic ES module output configuration
- ✅ Access to `@heroiclabs/nakama-runtime` type definitions
- ✅ Easier refactoring and maintenance

---

## Project Setup

### 1. Initialize Node.js Project

```bash
cd /nakama/data/modules
npm init -y
```

### 2. Install TypeScript and Nakama Types

```bash
npm install --save-dev typescript @heroiclabs/nakama-runtime
```

### 3. Create `tsconfig.json`

Create this file in `/nakama/data/modules/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "lib": ["ES2020"],
    "moduleResolution": "node",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": false,
    "removeComments": true,
    "noEmitOnError": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": [
    "src/**/*"
  ],
  "exclude": [
    "node_modules",
    "build",
    "**/*.spec.ts"
  ]
}
```

**Key Settings Explained:**

| Setting | Value | Why |
|---------|-------|-----|
| `target` | `ES2020` | Output modern JavaScript compatible with Nakama's runtime |
| `module` | `ES2020` | Generate ES modules (import/export), not CommonJS |
| `lib` | `["ES2020"]` | Use ES2020 standard library features |
| `outDir` | `./build` | Output compiled `.js` files here |
| `rootDir` | `./src` | Source TypeScript files location |
| `strict` | `true` | Enable all strict type checking |
| `removeComments` | `true` | Smaller output files |

### 4. Update `package.json`

Add these scripts to your `package.json`:

```json
{
  "name": "nakama-modules",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "clean": "rm -rf build",
    "prebuild": "npm run clean"
  },
  "devDependencies": {
    "@heroiclabs/nakama-runtime": "^1.0.0",
    "typescript": "^5.3.0"
  }
}
```

**Important:** `"type": "module"` tells Node.js to treat `.js` files as ES modules.

---

## Project Structure

```
/nakama/data/modules/
├── src/                          # TypeScript source files
│   ├── index.ts                 # Main entry point
│   ├── wallet/
│   │   ├── wallet.ts
│   │   └── wallet_utils.ts
│   ├── leaderboards/
│   │   └── leaderboards.ts
│   └── utils/
│       ├── helper.ts
│       └── constants.ts
├── build/                        # Compiled JavaScript (gitignored)
│   ├── index.js
│   ├── wallet/
│   └── ...
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Node.js project file
└── .gitignore                   # Ignore node_modules, build/
```

---

## TypeScript Examples

### 1. Main Entry Point: `src/index.ts`

```typescript
// src/index.ts - Main entry point with Nakama type definitions

import {
    nkruntime,
    InitModule as InitModuleFn,
    Initializer,
    Context,
    Logger
} from '@heroiclabs/nakama-runtime';

import { rpcWalletGetAll, rpcWalletUpdate } from './wallet/wallet';
import { rpcLeaderboardSubmit } from './leaderboards/leaderboards';

/**
 * Main initialization function called by Nakama on startup
 */
const InitModule: InitModuleFn = function (
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    initializer: Initializer
): void {
    logger.info('========================================');
    logger.info('JavaScript Runtime Initialization Started');
    logger.info('========================================');

    try {
        // Register Wallet RPCs
        initializer.registerRpc('wallet_get_all', rpcWalletGetAll);
        logger.info('[Wallet] Registered RPC: wallet_get_all');

        initializer.registerRpc('wallet_update', rpcWalletUpdate);
        logger.info('[Wallet] Registered RPC: wallet_update');

        // Register Leaderboard RPCs
        initializer.registerRpc('leaderboard_submit', rpcLeaderboardSubmit);
        logger.info('[Leaderboards] Registered RPC: leaderboard_submit');

        logger.info('========================================');
        logger.info('Successfully registered 3 RPC functions');
        logger.info('========================================');
    } catch (err) {
        logger.error('Failed to initialize modules: ' + (err as Error).message);
        throw err;
    }
};

export default InitModule;
```

### 2. Wallet Module: `src/wallet/wallet.ts`

```typescript
// src/wallet/wallet.ts - Wallet system with TypeScript types

import { nkruntime, RpcFunction, Context, Logger } from '@heroiclabs/nakama-runtime';
import { formatCurrency, getCurrentTimestamp } from '../utils/helper';
import { WALLET_COLLECTION } from '../utils/constants';

/**
 * Wallet data structure
 */
interface Wallet {
    userId: string;
    currencies: {
        xut: number;
        xp: number;
    };
    createdAt: string;
    updatedAt?: string;
}

/**
 * RPC request payload for wallet update
 */
interface WalletUpdatePayload {
    xut?: number;
    xp?: number;
}

/**
 * RPC: Get all wallets for a user
 */
export const rpcWalletGetAll: RpcFunction = function (
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    payload: string
): string {
    const userId = ctx.userId;

    try {
        // Read wallet from storage
        const records = nk.storageRead([
            {
                collection: WALLET_COLLECTION,
                key: 'user_wallet',
                userId: userId
            }
        ]);

        if (records && records.length > 0) {
            const wallet = records[0].value as Wallet;
            return JSON.stringify({
                success: true,
                wallet: wallet
            });
        }

        // Return empty wallet if not found
        const emptyWallet: Wallet = {
            userId: userId,
            currencies: { xut: 0, xp: 0 },
            createdAt: getCurrentTimestamp()
        };

        return JSON.stringify({
            success: true,
            wallet: emptyWallet
        });
    } catch (err) {
        logger.error('Failed to get wallet: ' + (err as Error).message);
        return JSON.stringify({
            success: false,
            error: (err as Error).message
        });
    }
};

/**
 * RPC: Update wallet currencies
 */
export const rpcWalletUpdate: RpcFunction = function (
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    payload: string
): string {
    const userId = ctx.userId;
    const data: WalletUpdatePayload = JSON.parse(payload);

    try {
        const wallet: Wallet = {
            userId: userId,
            currencies: {
                xut: data.xut || 0,
                xp: data.xp || 0
            },
            createdAt: getCurrentTimestamp(),
            updatedAt: getCurrentTimestamp()
        };

        nk.storageWrite([
            {
                collection: WALLET_COLLECTION,
                key: 'user_wallet',
                userId: userId,
                value: wallet,
                permissionRead: 1,
                permissionWrite: 0
            }
        ]);

        logger.info('Wallet updated for user: ' + userId);

        return JSON.stringify({
            success: true,
            wallet: wallet
        });
    } catch (err) {
        logger.error('Failed to update wallet: ' + (err as Error).message);
        return JSON.stringify({
            success: false,
            error: (err as Error).message
        });
    }
};
```

### 3. Utility Module: `src/utils/helper.ts`

```typescript
// src/utils/helper.ts - Shared utility functions

/**
 * Format currency value for display
 */
export function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

/**
 * Get current ISO timestamp
 */
export function getCurrentTimestamp(): string {
    return new Date().toISOString();
}

/**
 * Validate score is within acceptable range
 */
export function validateScore(score: number): boolean {
    return typeof score === 'number' && score >= 0 && score <= 1000000;
}

/**
 * Reward calculation result
 */
export interface Rewards {
    xp: number;
    xut: number;
    bonus: number;
}

/**
 * Calculate reward based on score
 */
export function calculateRewards(score: number): Rewards {
    const baseXP = Math.floor(score / 10);
    const baseXUT = Math.floor(score / 100);

    return {
        xp: baseXP,
        xut: baseXUT,
        bonus: score > 10000 ? 1000 : 0
    };
}
```

### 4. Constants: `src/utils/constants.ts`

```typescript
// src/utils/constants.ts - Shared constants

export const WALLET_COLLECTION = 'wallets';
export const LEADERBOARD_COLLECTION = 'leaderboards';
export const MISSION_COLLECTION = 'missions';

export const CURRENCIES = {
    XUT: 'xut',
    XP: 'xp',
    TOKENS: 'tokens'
} as const;

export const LEADERBOARD_PERIODS = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly',
    ALL_TIME: 'all_time'
} as const;

// Type-safe currency keys
export type Currency = typeof CURRENCIES[keyof typeof CURRENCIES];

// Type-safe leaderboard periods
export type LeaderboardPeriod = typeof LEADERBOARD_PERIODS[keyof typeof LEADERBOARD_PERIODS];
```

### 5. Leaderboards: `src/leaderboards/leaderboards.ts`

```typescript
// src/leaderboards/leaderboards.ts - Leaderboard system

import { nkruntime, RpcFunction, Context, Logger } from '@heroiclabs/nakama-runtime';
import { validateScore, calculateRewards, Rewards } from '../utils/helper';
import { LEADERBOARD_COLLECTION } from '../utils/constants';

/**
 * Leaderboard submission payload
 */
interface LeaderboardSubmitPayload {
    score: number;
    gameId: string;
}

/**
 * RPC: Submit score to leaderboard
 */
export const rpcLeaderboardSubmit: RpcFunction = function (
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    payload: string
): string {
    const userId = ctx.userId;
    const data: LeaderboardSubmitPayload = JSON.parse(payload);
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
            0, // subscore
            { timestamp: new Date().toISOString() }
        );

        // Calculate and award rewards
        const rewards: Rewards = calculateRewards(score);

        logger.info('Score submitted: ' + score + ' for user: ' + userId);

        return JSON.stringify({
            success: true,
            score: score,
            rewards: rewards
        });
    } catch (err) {
        logger.error('Failed to submit score: ' + (err as Error).message);
        return JSON.stringify({
            success: false,
            error: (err as Error).message
        });
    }
};
```

---

## Building Your Modules

### Build Once

```bash
npm run build
```

**Output:**
```
/nakama/data/modules/build/
├── index.js
├── index.d.ts
├── wallet/
│   ├── wallet.js
│   ├── wallet.d.ts
│   └── ...
└── ...
```

### Watch Mode (Auto-rebuild on file changes)

```bash
npm run watch
```

This will automatically recompile when you save TypeScript files.

### Clean Build Directory

```bash
npm run clean
```

---

## Docker Integration

### Update `docker-compose.yml`

Mount the **compiled** JavaScript files, not the TypeScript source:

```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.22.0
    volumes:
      # Mount the compiled JS modules
      - ./data/modules/build:/nakama/data/modules
    environment:
      - "NAKAMA_DATABASE_ADDRESS=root@cockroachdb:26257"
    ports:
      - "7350:7350"
      - "7351:7351"
```

**Important:** 
- ✅ Mount `./data/modules/build` (compiled JS)
- ❌ Don't mount `./data/modules/src` (TypeScript source)

### Development Workflow

```bash
# Terminal 1: Watch and auto-compile TypeScript
cd /nakama/data/modules
npm run watch

# Terminal 2: Run Nakama with Docker
cd /nakama
docker-compose up
```

When you save a `.ts` file, it automatically compiles to `.js`, and Nakama picks up the changes on next restart.

---

## `.gitignore` Configuration

Add this to `/nakama/data/modules/.gitignore`:

```gitignore
# Node.js
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Build output
build/
dist/
*.js
*.js.map
*.d.ts

# Keep TypeScript source
!src/**/*.ts

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db
```

**Only commit:**
- ✅ `src/` directory (TypeScript source)
- ✅ `package.json`
- ✅ `tsconfig.json`
- ✅ `.gitignore`

**Don't commit:**
- ❌ `node_modules/`
- ❌ `build/` directory
- ❌ Compiled `.js` files

---

## Type Definitions Reference

### Nakama Runtime Types

The `@heroiclabs/nakama-runtime` package provides these types:

```typescript
import {
    // Main initialization
    InitModule,
    Context,
    Logger,
    Initializer,

    // RPC function type
    RpcFunction,

    // Runtime API
    nkruntime,

    // Match functions
    MatchFunction,
    MatchInitFunction,
    MatchJoinAttemptFunction,
    MatchLeaveFunction,
    MatchLoopFunction,
    MatchSignalFunction,
    MatchTerminateFunction,

    // Other types
    Presence,
    Match,
    Notification,
    StorageObject,
    // ... and more
} from '@heroiclabs/nakama-runtime';
```

### Common Type Usage

```typescript
// RPC function signature
const myRpc: RpcFunction = function(
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    payload: string
): string {
    // RPC implementation
    return JSON.stringify({ success: true });
};

// Access user ID from context
const userId: string = ctx.userId;

// Log messages
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');

// Use Nakama API
const records: nkruntime.StorageObject[] = nk.storageRead([...]);
```

---

## Testing Compiled Modules

### 1. Check Compiled Output

```bash
cat build/index.js
```

Should show ES module syntax:
```javascript
import { rpcWalletGetAll } from './wallet/wallet.js';
export default function InitModule(ctx, logger, nk, initializer) {
    // ...
}
```

### 2. Validate with Nakama

```bash
docker-compose up
```

Look for these logs:
```
{"level":"info","msg":"JavaScript Runtime Initialization Started"}
{"level":"info","msg":"[Wallet] Registered RPC: wallet_get_all"}
{"level":"info","msg":"Successfully registered 3 RPC functions"}
```

### 3. Test RPC Calls

From Unity or any HTTP client:

```bash
curl -X POST http://localhost:7350/v2/rpc/wallet_get_all \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

---

## Troubleshooting

### Error: "require is not defined"

**Problem:** Still using CommonJS in your TypeScript source.

**Solution:** Check `tsconfig.json` has `"module": "ES2020"`.

### Error: "Cannot find module '@heroiclabs/nakama-runtime'"

**Problem:** Types not installed.

**Solution:**
```bash
npm install --save-dev @heroiclabs/nakama-runtime
```

### Error: Build output is empty

**Problem:** `outDir` or `rootDir` misconfigured.

**Solution:** Verify paths in `tsconfig.json`:
```json
{
  "compilerOptions": {
    "outDir": "./build",
    "rootDir": "./src"
  }
}
```

### Nakama doesn't see changes

**Problem:** Mounting wrong directory in Docker.

**Solution:** Ensure docker-compose mounts `./data/modules/build`, not `./data/modules`.

---

## Complete Build Script Example

Create `scripts/build.sh`:

```bash
#!/bin/bash
set -e

echo "🧹 Cleaning build directory..."
rm -rf build

echo "🔨 Compiling TypeScript..."
npx tsc

echo "✅ Build complete!"
echo "📁 Output: build/"
ls -lh build/
```

Make it executable:
```bash
chmod +x scripts/build.sh
./scripts/build.sh
```

---

## Best Practices

### 1. Type Everything
```typescript
// ✅ Good
export function calculateScore(base: number, multiplier: number): number {
    return base * multiplier;
}

// ❌ Bad
export function calculateScore(base, multiplier) {
    return base * multiplier;
}
```

### 2. Use Interfaces for Payloads
```typescript
interface MyRpcPayload {
    gameId: string;
    score: number;
    metadata?: Record<string, any>;
}

const data: MyRpcPayload = JSON.parse(payload);
```

### 3. Type Guard Functions
```typescript
function isValidPayload(data: any): data is MyRpcPayload {
    return (
        typeof data === 'object' &&
        typeof data.gameId === 'string' &&
        typeof data.score === 'number'
    );
}
```

### 4. Const Assertions for Constants
```typescript
export const GAME_MODES = {
    SOLO: 'solo',
    TEAM: 'team'
} as const;

type GameMode = typeof GAME_MODES[keyof typeof GAME_MODES];
```

---

## Summary

✅ **TypeScript Setup:**
1. Install TypeScript and Nakama types
2. Configure `tsconfig.json` with ES2020 modules
3. Write code in `src/` directory
4. Build to `build/` directory

✅ **Docker Integration:**
1. Mount `./data/modules/build` (not `src`)
2. Use watch mode for development
3. Rebuild before deploying

✅ **Type Safety:**
1. Use Nakama type definitions
2. Create interfaces for payloads
3. Enable strict mode in tsconfig.json

---

## Next Steps

1. Set up your TypeScript project structure
2. Convert existing JS modules to TypeScript
3. Configure build scripts
4. Update Docker volume mounts
5. Test with `npm run build && docker-compose up`

See [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](./NAKAMA_JAVASCRIPT_ESM_GUIDE.md) for pure JavaScript examples.
