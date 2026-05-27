---
name: nakama-ts-build
description: Build, compile, and manage the TypeScript→JS pipeline for Nakama server modules.
version: "1.0"
---

## When to Use
Keywords: `build`, `compile`, `typescript`, `tsc`, `tsconfig`, `postbuild`, `npm run build`, `index.js`, `src`, `module`, `import`, `types`, `nakama-common`, `es5`, `outFile`

## Build Pipeline Overview

```
data/modules/src/**/*.ts
     ↓  tsc (target: es5, outFile: ./build/index.js)
data/modules/build/index.js
     ↓  node postbuild.js  (merge + Goja RPC compatibility transform)
data/modules/index.js       ← FINAL bundle loaded by Nakama
```

## Build Commands

All commands run from `data/modules/` directory:

```powershell
# Standard build (compile + postbuild merge)
cd data/modules
npm run build

# Watch mode (tsc only — auto-recompiles on .ts changes)
npm run build:watch
# After watch completes a cycle, still need: node postbuild.js manually
# OR: docker compose restart nakama

# Install/update dependencies
npm install

# Update nakama-common types to latest
npm install "https://github.com/heroiclabs/nakama-common"
```

## tsconfig.json — Key Settings

```json
{
  "compilerOptions": {
    "target": "es5",          // MANDATORY — Goja VM only supports ES5
    "outFile": "./build/index.js",  // Single-file output (no module bundler needed)
    "strict": true,
    "strictNullChecks": false,  // Relaxed for easier Nakama interop
    "noImplicitAny": false,
    "typeRoots": ["./node_modules"],
    "lib": ["es2015"]
  },
  "files": ["./node_modules/nakama-common/index.d.ts"],
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "build", "src/**/__tests__/**"]
}
```

**Never change `target`** — Goja VM only supports ES5. Using `es2016+` causes silent runtime failures.
**Never add `"module"`** — conflicts with `outFile`. Remove it if you see it.

## Module Directory Structure

```
data/modules/
├── src/                    ← TypeScript source (author here ONLY)
│   └── <domain>/
│       └── <domain>.ts     ← one file per domain
├── <domain>/               ← optional plain JS modules (auto-merged by postbuild)
│   └── <domain>.js
├── build/                  ← tsc output (gitignored, never hand-edit)
│   └── index.js
├── index.js                ← FINAL bundle (postbuild output, commit this)
├── postbuild.js            ← merge + RPC compatibility transformer
├── tsconfig.json
├── package.json
└── node_modules/           ← gitignored
```

**40+ domain modules exist:**
`analytics`, `badges`, `characters`, `daily_missions`, `daily_rewards`, `event_pipeline`,
`friends`, `groups`, `leagues`, `leaderboard`, `notifications`, `onboarding`, `player`,
`progression`, `quizverse_depth`, `quizverse_quiz_generate`, `quizverse_seen`,
`realtime_tick`, `retention`, `tournaments`, `wallet`, `satori_direct`, `ai_player`, ...

## Adding a New TypeScript Module

```typescript
// 1. Create: data/modules/src/<domain>/<domain>.ts

const logger_prefix = '[<domain>]';

// Declare RPC stubs in global scope (required by postbuild)
function rpcMyFeatureGet(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  payload: string
): string {
  if (!payload) throw new Error(JSON.stringify({ code: 3, message: 'payload required' }));
  const req = JSON.parse(payload);
  // ... logic
  return JSON.stringify({ result: 'ok' });
}

// 2. Register in InitModule
// postbuild.js will find this and generate the global __rpc_* wrapper
// Just make sure InitModule is declared at module level:
function InitModule(
  ctx: nkruntime.Context,
  logger: nkruntime.Logger,
  nk: nkruntime.Nakama,
  initializer: nkruntime.Initializer
): Error | void {
  initializer.registerRpc('quizverse_my_feature_get', rpcMyFeatureGet);
  logger.info('%s registered', logger_prefix);
}
```

## Nakama Runtime Restrictions (from Official Docs)

| Restriction | Detail |
|-------------|--------|
| ES5 only | Target `es5`. No arrow functions in `registerRpc` args, no `const`/`let` in output |
| No global state | goja VM pool — each call gets a fresh context snapshot |
| No Node APIs | No `require('fs')`, `require('crypto')`, `require('http')` |
| No browser APIs | No `fetch`, `localStorage`, `window` |
| Single-threaded | No `Promise.all`, no `setTimeout`/`setInterval` |
| Sandboxed | No filesystem, no OS, no subprocess |
| No default exports | All functions must be globally declared (not `module.exports`) |

## postbuild.js — What It Does & Gotchas

**postbuild scans ALL `.js` files** in `data/modules/` (recursively, excluding `node_modules/`, `build/`, `src/`).
It merges them into `index.js` in this order:
1. `build/index.js` (compiled TypeScript)
2. `legacy_runtime.js` (if present)
3. All other `.js` domain modules

**postbuild SKIPS files that:**
- Start with a shebang (`#!/`)
- `require()` Node built-ins (http, fs, path, crypto, etc.)

**If your new JS module gets skipped:** check for Node require calls and remove them.

## Upgrading nakama-common

```powershell
# 1. Find current Nakama binary version (in Dockerfile):
#    FROM registry.heroiclabs.com/heroiclabs/nakama:3.35.0
#    → binary version = 3.35.0

# 2. Check compatibility matrix:
#    https://heroiclabs.com/docs/nakama/getting-started/release-notes/#compatibility-matrix

# 3. Install correct nakama-common version (github tag):
cd data/modules
npm install "https://github.com/heroiclabs/nakama-common#v1.44.0"

# 4. Rebuild
npm run build
```

## Common Build Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `TypeError: Object has no member 'xxx'` | nakama-common version mismatch | Check compatibility matrix |
| `Cannot find name 'nkruntime'` | types not found | `npm install` then verify `typeRoots` in tsconfig |
| `'module' option cannot be combined with 'outFile'` | `module` set in tsconfig | Remove `"module"` from compilerOptions |
| RPC shows as 1018 count but new RPC missing | postbuild skipped your file | Check for Node require calls in your JS |
| `goja: SyntaxError` at runtime | ES6+ syntax in output | Ensure `target: "es5"` in tsconfig |
| `postbuild.js: isNakamaCompatible SKIP` | Node built-in detected | Remove Node require; use Nakama `nk.*` APIs instead |

## Context Files (load only if needed)
- Build config: `data/modules/tsconfig.json`
- Build scripts: `data/modules/package.json`
- Merge logic: `data/modules/postbuild.js`
- Types: `data/modules/node_modules/nakama-common/index.d.ts` (grep only)
