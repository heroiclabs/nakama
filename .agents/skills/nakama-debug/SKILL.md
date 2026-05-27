---
name: nakama-debug
description: Debug runtime errors, crashes, log inspection, and RPC testing in Nakama.
version: "1.0"
---

## When to Use
Keywords: `error`, `crash`, `logs`, `debug`, `console`, `test RPC`, `500`, `not found`, `undefined`, `exception`, `goja`, `panic`, `broken`, `not working`

## Log Inspection

```powershell
# Stream all nakama logs
docker compose logs -f nakama

# Last 200 lines
docker compose logs --tail 200 nakama

# Filter for errors only
docker compose logs nakama 2>&1 | Select-String -Pattern "ERROR|panic|fatal"

# Filter for a specific RPC
docker compose logs nakama 2>&1 | Select-String -Pattern "quizverse_my_rpc"

# Search for goja (JS runtime) errors
docker compose logs nakama 2>&1 | Select-String -Pattern "goja|SyntaxError|TypeError"
```

## Log Levels

```
INFO    → normal operation, startup, RPC calls
WARN    → non-fatal issues (bad input, deprecated usage)
ERROR   → failures that affect users
DEBUG   → verbose (disabled in prod; enabled in dev via --logger.level DEBUG)
```

**Your code:** use `logger.info()`, `logger.warn()`, `logger.error()`. Not `console.log()`.

## Nakama Console — Test RPCs Live

URL: `http://localhost:7351`
Default: `admin` / `password`

1. Go to **API Explorer** → **Runtime Functions**
2. Select your RPC from the dropdown
3. Enter user ID + payload JSON
4. Execute and inspect response

Alternatively, test via HTTP:
```powershell
# Test RPC via HTTP API (no auth — server-to-server style):
$body = '{"userId":"test-user-id"}'
Invoke-RestMethod -Uri "http://localhost:7350/v2/rpc/quizverse_my_rpc" `
  -Method POST -Body $body -ContentType "application/json" `
  -Headers @{ Authorization = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("defaultkey:")) }
```

## Common Runtime Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `RPC function not found: quizverse_x` | postbuild didn't detect the registerRpc | Ensure direct `initializer.registerRpc(...)` call inside InitModule body |
| `goja: TypeError: Object has no member 'xxx'` | Using nakama-common API not in this version | Check compatibility matrix; verify nakama-common version |
| `goja: SyntaxError: ...` | ES6+ syntax compiled into output | Check tsconfig `target: "es5"`; avoid arrow functions in registerRpc args |
| `cannot unmarshal...` | JSON payload mismatch | Log `payload` at top of RPC; validate schema |
| `ctx.env['KEY'] undefined` | env var not in RUNTIME_ENV_KEYS | Add to docker-compose.yml entrypoint RUNTIME_ENV_KEYS list |
| `plugin was built with a different version` | .so ABI mismatch | `docker compose build --no-cache nakama` |
| Module changes not reflected | index.js stale | `npm run build` then `docker compose restart nakama` |
| `storage: not found` | reading a key that doesn't exist | Always check `objs.length > 0` before parsing |
| `wallet: insufficient funds` | deduct > balance | Read balance first; return error to client |
| `database: unique constraint` | username/email collision | Handle duplicate error in auth hooks |

## Debugging a Specific RPC

```typescript
function rpcMyRpc(ctx, logger, nk, payload) {
  // Step 1: Log entry
  logger.info('[myRpc] called by %s payload=%s', ctx.userId, payload);

  // Step 2: Validate and parse
  if (!payload || payload.trim() === '') {
    logger.warn('[myRpc] empty payload');
    throw new Error(JSON.stringify({ code: 3, message: 'payload required' }));
  }

  let req: any;
  try {
    req = JSON.parse(payload);
  } catch (e) {
    logger.error('[myRpc] JSON parse failed: %s', e.message);
    throw new Error(JSON.stringify({ code: 3, message: 'invalid JSON' }));
  }

  // Step 3: Log key operations
  logger.info('[myRpc] processing for userId=%s req=%j', ctx.userId, req);

  // Step 4: Try/catch external calls
  try {
    const result = nk.storageRead([{ collection: 'x', key: 'y', userId: ctx.userId }]);
    logger.info('[myRpc] storage result count=%d', result.length);
    return JSON.stringify({ ok: true });
  } catch (e) {
    logger.error('[myRpc] storage read failed: %s', e.message);
    throw new Error(JSON.stringify({ code: 2, message: 'internal error' }));
  }
}
```

## Checking Build Output

```powershell
# Verify your RPC is in the final bundle
rg "registerRpc.*my_rpc_name" data/modules/index.js

# Check the global stub exists
rg "__rpc_my_rpc_name" data/modules/index.js

# Count all RPCs
rg "initializer\.registerRpc" data/modules/index.js | Measure-Object -Line

# Verify no Node.js require calls slipped through
rg "require\(" data/modules/index.js | rg -v "//|nakama" | Select-Object -First 10
```

## Stack Restart Checklist

```
1. npm run build           (in data/modules/) — rebuilds TypeScript
2. docker compose restart nakama  — reloads JS modules
3. docker compose logs -f nakama  — watch for startup errors
4. Test via API Explorer at :7351
```

## Context Files (load only if needed)
- Server logs: `docker compose logs nakama`
- Final bundle: `data/modules/index.js` (grep only)
- Console: `http://localhost:7351`
