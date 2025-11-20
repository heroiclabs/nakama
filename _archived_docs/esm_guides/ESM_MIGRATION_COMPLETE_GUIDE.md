# Nakama JavaScript Runtime: Complete ESM Migration Guide

## 🚨 Critical Issue: "ReferenceError: require is not defined"

If you're seeing this error:
```
ReferenceError: require is not defined at index.js:5:26(6)
Failed to eval JavaScript modules
Failed initializing JavaScript runtime provider
```

**You are using CommonJS syntax in Nakama's JavaScript runtime, which ONLY supports ES Modules.**

This guide provides everything you need to fix this issue and successfully deploy Nakama with JavaScript modules.

---

## Table of Contents

1. [Why Nakama Doesn't Support CommonJS](#why-nakama-doesnt-support-commonjs)
2. [Quick Fix Guide](#quick-fix-guide)
3. [Complete Documentation](#complete-documentation)
4. [Working Examples](#working-examples)
5. [Step-by-Step Migration](#step-by-step-migration)
6. [Testing Your Modules](#testing-your-modules)
7. [Common Issues and Solutions](#common-issues-and-solutions)

---

## Why Nakama Doesn't Support CommonJS

### The Technical Explanation

**Nakama 3.x uses modern JavaScript engines:**
- **V8** (Google's JavaScript engine - same as Node.js and Chrome)
- **Goja** (Pure Go JavaScript interpreter)

These engines are configured to use **ECMAScript Modules (ESM)**, the official JavaScript module standard.

### What This Means

| Feature | CommonJS (❌ BROKEN) | ES Modules (✅ WORKS) |
|---------|---------------------|----------------------|
| Import | `require('./module.js')` | `import { x } from './module.js'` |
| Export | `module.exports = { }` | `export function x() { }` |
| Default Export | `module.exports = fn` | `export default fn` |
| File Extension | Optional | **Required** (`.js`) |
| Runtime | Node.js specific | ECMAScript standard |

**Bottom Line:** CommonJS (`require`, `module.exports`) is Node.js-specific and doesn't exist in Nakama's JavaScript runtime.

---

## Quick Fix Guide

### Before (CommonJS - BROKEN) ❌

```javascript
// index.js
var WalletUtils = require('./wallet_utils.js');
var Analytics = require('./analytics.js');

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', testRpc);
}

function testRpc(ctx, logger, nk, payload) {
    return WalletUtils.doSomething();
}

module.exports = InitModule;
```

### After (ESM - CORRECT) ✅

```javascript
// index.js
import { doSomething } from './wallet_utils.js';
import { trackEvent } from './analytics.js';

export default function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', testRpc);
}

export function testRpc(ctx, logger, nk, payload) {
    return doSomething();
}
```

### Key Changes

1. ✅ Replace `require()` with `import`
2. ✅ Replace `module.exports` with `export` or `export default`
3. ✅ Always include `.js` extension in import paths
4. ✅ Export `InitModule` as default: `export default function InitModule`

---

## Complete Documentation

This repository includes comprehensive guides for different use cases:

### 📘 [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](./NAKAMA_JAVASCRIPT_ESM_GUIDE.md)

**Complete JavaScript ES Modules guide covering:**
- Why Nakama doesn't support CommonJS (detailed technical explanation)
- ES Module syntax and structure
- Complete working examples with multiple modules
- Import/export patterns
- Migration patterns from CommonJS
- Testing and validation procedures
- Common mistakes to avoid

**Best for:** JavaScript developers converting existing code or starting fresh with JS.

### 📘 [NAKAMA_TYPESCRIPT_ESM_BUILD.md](./NAKAMA_TYPESCRIPT_ESM_BUILD.md)

**TypeScript configuration and build guide covering:**
- TypeScript project setup with ES2020 modules
- Complete `tsconfig.json` configuration
- Type-safe development with `@heroiclabs/nakama-runtime`
- Build scripts and watch mode
- Docker integration
- Type definitions and interfaces
- Development workflow

**Best for:** Developers who want type safety and modern development tools.

### 📘 [NAKAMA_DOCKER_ESM_DEPLOYMENT.md](./NAKAMA_DOCKER_ESM_DEPLOYMENT.md)

**Docker deployment guide covering:**
- Correct `docker-compose.yml` configuration
- Volume mounting for JavaScript modules
- Complete minimal working example
- Database setup (CockroachDB and PostgreSQL)
- Environment configuration
- Expected logs for successful initialization
- Testing RPC endpoints
- Production deployment considerations

**Best for:** DevOps engineers and developers deploying to Docker.

---

## Working Examples

### 📁 [examples/esm-modules/](./examples/esm-modules/)

**Complete, working JavaScript ES module examples:**

```
examples/esm-modules/
├── index.js                    # ✅ Main entry point with InitModule
├── wallet/
│   └── wallet.js              # ✅ Wallet RPC functions
├── leaderboards/
│   └── leaderboards.js        # ✅ Leaderboard RPC functions
└── utils/
    ├── helper.js              # ✅ Utility functions
    └── constants.js           # ✅ Shared constants
```

**Features:**
- Proper ESM import/export syntax
- Multiple module organization
- RPC function examples
- Error handling
- Storage operations
- Leaderboard operations
- Comprehensive README

**How to use:**
```bash
# Copy to your Nakama data directory
cp -r examples/esm-modules/* /path/to/nakama/data/modules/

# Or use with Docker
docker-compose -f examples/docker-compose-esm-example.yml up
```

### 📁 [examples/typescript-esm/](./examples/typescript-esm/)

**TypeScript configuration for building ES modules:**

```
examples/typescript-esm/
├── tsconfig.json              # ✅ TypeScript config (ES2020 modules)
├── package.json               # ✅ NPM scripts and dependencies
├── src/                       # TypeScript source files
└── build/                     # Compiled JavaScript (ES modules)
```

**Features:**
- Proper TypeScript configuration
- ES2020 module output
- Type-safe development
- Build and watch scripts
- Complete README

**How to use:**
```bash
cd examples/typescript-esm
npm install
npm run build  # Compiles to build/

# Mount build/ directory in Docker
docker-compose up
```

---

## Step-by-Step Migration

### Step 1: Understand Your Current Structure

Identify all files using CommonJS:
```bash
# Find all require() usage
grep -r "require(" data/modules/

# Find all module.exports usage
grep -r "module.exports" data/modules/
```

### Step 2: Create Backup

```bash
cp -r data/modules data/modules.backup
```

### Step 3: Convert Main Entry Point

**Before (`data/modules/index.js`):**
```javascript
var Module1 = require('./module1.js');

function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', Module1.rpcTest);
}

module.exports = InitModule;
```

**After (`data/modules/index.js`):**
```javascript
import { rpcTest } from './module1.js';

export default function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('test', rpcTest);
}
```

### Step 4: Convert Each Module

**Before (`data/modules/module1.js`):**
```javascript
var utils = require('./utils.js');

function rpcTest(ctx, logger, nk, payload) {
    return utils.helper();
}

module.exports = {
    rpcTest: rpcTest
};
```

**After (`data/modules/module1.js`):**
```javascript
import { helper } from './utils.js';

export function rpcTest(ctx, logger, nk, payload) {
    return helper();
}
```

### Step 5: Convert Utilities

**Before (`data/modules/utils.js`):**
```javascript
function helper() {
    return "Hello";
}

module.exports = {
    helper: helper
};
```

**After (`data/modules/utils.js`):**
```javascript
export function helper() {
    return "Hello";
}
```

### Step 6: Update docker-compose.yml

Ensure proper volume mounting:
```yaml
services:
  nakama:
    image: heroiclabs/nakama:3.22.0
    volumes:
      # ✅ Mount your modules directory
      - ./data/modules:/nakama/data/modules
    ports:
      - "7350:7350"
      - "7351:7351"
```

### Step 7: Test

```bash
# Start Nakama
docker-compose up

# Check logs for successful initialization
docker-compose logs -f nakama
```

**Expected Success Logs:**
```
{"level":"info","msg":"JavaScript Runtime Initialization Started"}
{"level":"info","msg":"✅ Registered RPC: test"}
{"level":"info","msg":"Initialization Complete"}
{"level":"info","msg":"Startup done"}
```

---

## Testing Your Modules

### 1. Authenticate

```bash
TOKEN=$(curl -s -X POST http://localhost:7350/v2/account/authenticate/device \
  -H 'Content-Type: application/json' \
  -d '{"id":"test-device","create":true}' \
  | jq -r '.token')

echo "Token: $TOKEN"
```

### 2. Call Your RPC

```bash
curl -X POST http://localhost:7350/v2/rpc/YOUR_RPC_NAME \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'
```

### 3. Verify Response

Successful response:
```json
{
  "success": true,
  "data": { }
}
```

Error response:
```json
{
  "success": false,
  "error": "Error message"
}
```

---

## Common Issues and Solutions

### Issue 1: "ReferenceError: require is not defined"

**Cause:** Using CommonJS syntax.

**Solution:** Convert to ESM:
```javascript
// ❌ WRONG
var x = require('./module.js');

// ✅ CORRECT
import { x } from './module.js';
```

### Issue 2: "Cannot find module './module'"

**Cause:** Missing `.js` extension.

**Solution:** Always include extension:
```javascript
// ❌ WRONG
import { x } from './module';

// ✅ CORRECT
import { x } from './module.js';
```

### Issue 3: "InitModule is not a function"

**Cause:** Not exported as default.

**Solution:** Use default export:
```javascript
// ❌ WRONG
export function InitModule() { }

// ✅ CORRECT
export default function InitModule() { }
```

### Issue 4: "Failed to load JavaScript modules"

**Cause:** Modules not mounted correctly in Docker.

**Solution:** Check docker-compose.yml:
```yaml
volumes:
  # ✅ CORRECT
  - ./data/modules:/nakama/data/modules
  
  # ❌ WRONG
  - ./data:/nakama/data
```

### Issue 5: RPC not registered

**Cause:** Function not imported or registered.

**Solution:** Verify both import and registration:
```javascript
// 1. Import the function
import { myRpc } from './my_module.js';

// 2. Register in InitModule
export default function InitModule(ctx, logger, nk, initializer) {
    initializer.registerRpc('my_rpc', myRpc);
}
```

---

## Migration Checklist

Use this checklist to ensure complete migration:

- [ ] Read [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](./NAKAMA_JAVASCRIPT_ESM_GUIDE.md)
- [ ] Review [examples/esm-modules/](./examples/esm-modules/) for reference
- [ ] Backup existing modules: `cp -r data/modules data/modules.backup`
- [ ] Convert `index.js` to use `import`/`export default`
- [ ] Convert all submodules to use `import`/`export`
- [ ] Add `.js` extension to all import paths
- [ ] Remove all `require()` calls
- [ ] Remove all `module.exports` statements
- [ ] Update `docker-compose.yml` volume mounting
- [ ] Test locally: `docker-compose up`
- [ ] Verify logs show successful initialization
- [ ] Test RPC endpoints with curl or Postman
- [ ] Verify responses are correct
- [ ] Update documentation
- [ ] Commit changes to version control

---

## Project Structure Recommendations

### Recommended Structure

```
/nakama/data/modules/
├── index.js                    # Main entry with InitModule
├── wallet/
│   ├── wallet.js              # Wallet RPCs
│   └── wallet_utils.js        # Wallet utilities
├── leaderboards/
│   ├── leaderboards.js        # Leaderboard RPCs
│   └── leaderboard_utils.js   # Leaderboard utilities
├── missions/
│   └── missions.js            # Mission system
├── analytics/
│   └── analytics.js           # Analytics tracking
└── utils/
    ├── constants.js           # Shared constants
    ├── helper.js              # Common utilities
    └── validation.js          # Input validation
```

### Module Organization Principles

1. **Feature-based directories** - Group related RPCs together
2. **Shared utilities** - Common functions in `utils/`
3. **Single responsibility** - Each module has one clear purpose
4. **Clear naming** - Descriptive file and function names
5. **Consistent structure** - Same patterns across modules

---

## TypeScript Development (Optional)

For type-safe development, consider using TypeScript:

### Setup

```bash
mkdir -p src
npm init -y
npm install --save-dev typescript @heroiclabs/nakama-runtime
```

### Configure

Copy `examples/typescript-esm/tsconfig.json` to your project.

### Develop

Write TypeScript in `src/`, build to `build/`:
```bash
npm run build
```

### Deploy

Mount the `build/` directory:
```yaml
volumes:
  - ./build:/nakama/data/modules
```

See [NAKAMA_TYPESCRIPT_ESM_BUILD.md](./NAKAMA_TYPESCRIPT_ESM_BUILD.md) for complete guide.

---

## Summary

### ✅ Do This:
- Use `import` and `export` statements
- Export InitModule as default: `export default function InitModule`
- Include `.js` extension in all imports
- Use relative paths (`./` or `../`)
- Follow the working examples
- Test thoroughly before deploying

### ❌ Don't Do This:
- Use `require()` - it doesn't exist
- Use `module.exports` - it doesn't exist
- Omit `.js` extension in imports
- Use absolute paths without `./` or `../`
- Mix CommonJS and ESM syntax
- Deploy without testing

---

## Additional Resources

### Documentation
- [NAKAMA_JAVASCRIPT_ESM_GUIDE.md](./NAKAMA_JAVASCRIPT_ESM_GUIDE.md) - Complete JavaScript guide
- [NAKAMA_TYPESCRIPT_ESM_BUILD.md](./NAKAMA_TYPESCRIPT_ESM_BUILD.md) - TypeScript guide
- [NAKAMA_DOCKER_ESM_DEPLOYMENT.md](./NAKAMA_DOCKER_ESM_DEPLOYMENT.md) - Docker guide

### Examples
- [examples/esm-modules/](./examples/esm-modules/) - Working JavaScript examples
- [examples/typescript-esm/](./examples/typescript-esm/) - TypeScript configuration

### External Resources
- [Official Nakama Docs](https://heroiclabs.com/docs)
- [ES Modules Specification](https://tc39.es/ecma262/#sec-modules)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

---

## Getting Help

If you're still having issues:

1. **Check the logs** - Look for specific error messages
2. **Review examples** - Compare with working code in `examples/`
3. **Read documentation** - Each guide has troubleshooting sections
4. **Test incrementally** - Start with minimal example, add features gradually
5. **Ask for help** - Nakama forum, Discord, or GitHub issues

---

**Good luck with your migration! 🚀**

Once you've converted your modules to ESM, you'll have a modern, maintainable codebase that works seamlessly with Nakama's JavaScript runtime.
