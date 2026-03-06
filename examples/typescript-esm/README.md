# Nakama TypeScript ES Modules Example

This directory contains a **TypeScript configuration** for building Nakama JavaScript modules with ES2020 module syntax.

## Quick Start

### 1. Install Dependencies

```bash
cd examples/typescript-esm
npm install
```

This installs:
- `typescript` - TypeScript compiler
- `@heroiclabs/nakama-runtime` - Type definitions for Nakama runtime

### 2. Write TypeScript Code

Create your modules in the `src/` directory using TypeScript:

```typescript
// src/index.ts
import { nkruntime, InitModule as InitModuleFn } from '@heroiclabs/nakama-runtime';

const InitModule: InitModuleFn = function(ctx, logger, nk, initializer) {
    logger.info('TypeScript ES Modules loaded successfully!');
};

export default InitModule;
```

### 3. Build

```bash
npm run build
```

This compiles TypeScript to JavaScript in the `build/` directory.

### 4. Deploy

Use the compiled `build/` directory with Nakama:

```yaml
# docker-compose.yml
services:
  nakama:
    volumes:
      - ./examples/typescript-esm/build:/nakama/data/modules
```

## Configuration Files

### `tsconfig.json`

**Critical Settings:**

```json
{
  "compilerOptions": {
    "target": "ES2020",        // Modern JavaScript
    "module": "ES2020",        // ES modules (NOT CommonJS!)
    "outDir": "./build",       // Compiled JS output
    "rootDir": "./src",        // TypeScript source
    "strict": true             // Type safety
  }
}
```

**Why ES2020?**
- Nakama's JavaScript runtime requires ES modules
- CommonJS (`"module": "CommonJS"`) will NOT work
- ES2020 provides modern features like optional chaining, nullish coalescing

### `package.json`

**Important Settings:**

```json
{
  "type": "module",           // Treat .js as ES modules
  "scripts": {
    "build": "tsc",           // Compile TypeScript
    "watch": "tsc --watch"    // Auto-recompile on changes
  }
}
```

## Development Workflow

### Watch Mode (Recommended)

```bash
# Terminal 1: Watch and auto-compile TypeScript
npm run watch

# Terminal 2: Run Nakama
docker-compose up
```

When you save a `.ts` file, it automatically recompiles to `.js`.

### One-Time Build

```bash
npm run build
docker-compose up
```

### Type Checking Only

```bash
npm run check
```

Checks types without emitting files.

### Clean Build

```bash
npm run clean
npm run build
```

## Directory Structure

```
typescript-esm/
├── src/                     # TypeScript source files
│   ├── index.ts            # Main entry point
│   ├── wallet/
│   │   └── wallet.ts
│   └── utils/
│       └── helper.ts
├── build/                   # Compiled JavaScript (gitignored)
│   ├── index.js
│   ├── wallet/
│   └── utils/
├── node_modules/           # Dependencies (gitignored)
├── package.json            # NPM configuration
├── tsconfig.json           # TypeScript configuration
└── README.md               # This file
```

## Type-Safe Development

### Using Nakama Types

```typescript
import {
    nkruntime,
    Context,
    Logger,
    RpcFunction,
    Initializer
} from '@heroiclabs/nakama-runtime';

// Type-safe RPC function
export const myRpc: RpcFunction = function(
    ctx: Context,
    logger: Logger,
    nk: nkruntime.Nakama,
    payload: string
): string {
    // TypeScript knows the types!
    const userId: string = ctx.userId;
    logger.info('User ID: ' + userId);
    
    return JSON.stringify({ success: true });
};
```

### Type-Safe Payloads

```typescript
interface MyRpcPayload {
    gameId: string;
    score: number;
    metadata?: Record<string, any>;
}

export const myRpc: RpcFunction = function(ctx, logger, nk, payload) {
    const data: MyRpcPayload = JSON.parse(payload);
    
    // TypeScript ensures these properties exist
    logger.info('GameID: ' + data.gameId);
    logger.info('Score: ' + data.score);
    
    return JSON.stringify({ success: true });
};
```

### Type-Safe Storage

```typescript
interface WalletData {
    userId: string;
    currencies: {
        xut: number;
        xp: number;
    };
    createdAt: string;
}

const records = nk.storageRead([{
    collection: 'wallets',
    key: 'user_wallet',
    userId: userId
}]);

if (records && records.length > 0) {
    const wallet = records[0].value as WalletData;
    // TypeScript knows wallet structure
    logger.info('XUT: ' + wallet.currencies.xut);
}
```

## Common TypeScript Patterns

### Enums

```typescript
enum Currency {
    XUT = 'xut',
    XP = 'xp',
    TOKENS = 'tokens'
}

// Usage
logger.info('Currency: ' + Currency.XUT);
```

### Interfaces for Responses

```typescript
interface ApiResponse {
    success: boolean;
    error?: string;
    data?: any;
}

function createResponse(success: boolean, data?: any): string {
    const response: ApiResponse = { success, data };
    return JSON.stringify(response);
}
```

### Type Guards

```typescript
function isValidPayload(data: any): data is MyRpcPayload {
    return (
        typeof data === 'object' &&
        typeof data.gameId === 'string' &&
        typeof data.score === 'number'
    );
}

const data = JSON.parse(payload);
if (!isValidPayload(data)) {
    return JSON.stringify({ success: false, error: 'Invalid payload' });
}
// TypeScript now knows data is MyRpcPayload
```

## Build Output

### What Gets Generated

From `src/index.ts`:
```typescript
import { rpcTest } from './wallet/wallet.js';

export default function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', rpcTest);
}
```

To `build/index.js`:
```javascript
import { rpcTest } from './wallet/wallet.js';

export default function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', rpcTest);
}
```

**Note:** TypeScript removes type annotations but keeps ES module syntax!

## .gitignore

Add this to your `.gitignore`:

```gitignore
# Node.js
node_modules/
npm-debug.log*

# Build output
build/
dist/
*.js
*.d.ts
*.d.ts.map

# Keep TypeScript source
!src/**/*.ts

# IDE
.vscode/
.idea/
```

## Docker Integration

### docker-compose.yml

```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.22.0
    volumes:
      # Mount compiled JavaScript, NOT TypeScript source
      - ./examples/typescript-esm/build:/nakama/data/modules
    ports:
      - "7350:7350"
      - "7351:7351"
```

**Important:** Mount `build/` (compiled JS), not `src/` (TypeScript source).

## Troubleshooting

### "Cannot find module '@heroiclabs/nakama-runtime'"

**Solution:**
```bash
npm install --save-dev @heroiclabs/nakama-runtime
```

### Build output uses CommonJS

**Problem:** `tsconfig.json` has wrong module setting.

**Solution:** Ensure `"module": "ES2020"` in tsconfig.json.

### Types not working

**Problem:** Missing type definitions.

**Solution:** Install Nakama types:
```bash
npm install --save-dev @heroiclabs/nakama-runtime
```

### Nakama can't find modules

**Problem:** Mounting wrong directory.

**Solution:** Mount `build/`, not `src/`:
```yaml
volumes:
  - ./examples/typescript-esm/build:/nakama/data/modules
```

## Benefits of TypeScript

✅ **Type Safety**
- Catch errors at compile time
- Prevent runtime type errors

✅ **Better IDE Support**
- Autocomplete for Nakama API
- Inline documentation
- Refactoring tools

✅ **Maintainability**
- Self-documenting code
- Easier refactoring
- Better collaboration

✅ **Modern JavaScript**
- Use latest ES features
- Target older runtimes if needed
- Optional features

## Next Steps

1. Install dependencies: `npm install`
2. Create TypeScript files in `src/`
3. Build: `npm run build`
4. Deploy `build/` directory to Nakama
5. Test your RPCs

## Additional Resources

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Nakama Runtime API](https://heroiclabs.com/docs/runtime-code-basics/)
- [NAKAMA_TYPESCRIPT_ESM_BUILD.md](../../NAKAMA_TYPESCRIPT_ESM_BUILD.md)
- [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](../../NAKAMA_JAVASCRIPT_ESM_GUIDE.md)
