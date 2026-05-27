---
name: nakama-auth
description: Authentication flows, session tokens, custom auth, AWS Cognito, and before-hooks in Nakama.
version: "1.0"
---

## When to Use
Keywords: `auth`, `authenticate`, `login`, `token`, `session`, `JWT`, `Cognito`, `device`, `custom`, `identity`, `refresh`, `UNAUTHENTICATED`, `401`, `403`

## Auth Flows Supported

| Method | Nakama RPC | Use Case |
|--------|-----------|----------|
| Device | `authenticateDevice` | Anonymous / guest login with device ID |
| Custom | `authenticateCustom` | AWS Cognito JWT, external identity provider |
| Email | `authenticateEmail` | Email + password |
| Social (Apple, Google, Facebook) | `authenticateApple`, etc. | OAuth2 social login |

**This project uses:** Device auth (guest) + Custom auth (AWS Cognito JWT)

## Custom Auth Flow (AWS Cognito)

```
Client                  Nakama                    AWS Cognito
  │                        │                          │
  ├─ authenticateCustom ──►│                          │
  │  {id: cognitoJWT}      │                          │
  │                        ├─ before hook validates ──►│
  │                        │   JWT signature           │
  │                        │◄─ valid / invalid ────────┤
  │                        │                          │
  │◄─ session token ───────┤  (if valid)              │
  │   (Nakama JWT)         │                          │
```

## Before Hook — Validating Custom Auth

```typescript
// In data/modules/src/identity/identity.ts

function validateCognitoJWT(token: string, nk: nkruntime.Nakama, ctx: nkruntime.Context): void {
  // Decode JWT header+payload (base64url)
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error(JSON.stringify({ code: 3, message: 'invalid JWT format' }));
  }
  // Verify with Nakama's HTTP utility
  const cognitoRegion = ctx.env['AWS_REGION'] || 'us-east-1';
  const cognitoPoolId = ctx.env['COGNITO_USER_POOL_ID'];
  const jwksUrl = `https://cognito-idp.${cognitoRegion}.amazonaws.com/${cognitoPoolId}/.well-known/jwks.json`;

  // Use nk.httpRequest for external validation
  const resp = nk.httpRequest(jwksUrl, 'GET', {}, '');
  if (resp.code !== 200) {
    throw new Error(JSON.stringify({ code: 2, message: 'failed to fetch JWKS' }));
  }
  // ... signature verification logic
}

const beforeAuthenticateCustom: nkruntime.BeforeHookFunction<nkruntime.AuthenticateCustomRequest> =
  (ctx, logger, nk, data) => {
    // data.account.id is the custom ID (e.g. Cognito sub or JWT)
    try {
      validateCognitoJWT(data.account.id, nk, ctx);
    } catch (e) {
      logger.warn('custom auth rejected: %s', e.message);
      throw e;
    }
    return data;
  };

function InitModule(ctx, logger, nk, initializer) {
  initializer.registerBeforeAuthenticateCustom(beforeAuthenticateCustom);
}
```

## Session Token Management

```typescript
// Session expiry configured in docker-compose.yml entrypoint:
// --session.token_expiry_sec 43200  (12 hours)

// Unity client refreshes before expiry via AuthTokenManager:
// Assets/_QuizVerse/Scripts/Backend/Auth/AuthTokenManager.cs
```

**Auth error codes:**
- `16 = UNAUTHENTICATED` — missing or expired session
- `7 = PERMISSION_DENIED` — authenticated but not authorized

## Identity Module

The project has a dedicated `data/modules/identity.js` (plain JS, not TS):
- Handles user profile creation/sync on first auth
- Links device IDs, social accounts, Cognito sub
- Manages username uniqueness

```
data/modules/
├── identity.js         ← plain JS identity module (merged by postbuild)
└── src/identity/       ← if TypeScript identity logic exists
```

## Checking Auth in RPCs

```typescript
function rpcProtectedAction(ctx, logger, nk, payload) {
  // Guard: reject unauthenticated server-to-server calls to user RPCs
  if (!ctx.userId || ctx.userId === '') {
    throw new Error(JSON.stringify({ code: 16, message: 'authentication required' }));
  }

  // Guard: check user role / admin flag (example using storage)
  const reads = [{ collection: 'system', key: 'admin_ids', userId: '' }];
  const objs = nk.storageRead(reads);
  const adminIds: string[] = objs.length > 0 ? JSON.parse(objs[0].value).ids : [];
  if (!adminIds.includes(ctx.userId)) {
    throw new Error(JSON.stringify({ code: 7, message: 'admin only' }));
  }
}
```

## Device Auth (Guest / Anonymous)

```typescript
// Unity SDK call (read-only — Assets/_IntelliVerseXSDK/):
// client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier)
// → Nakama auto-creates user if not exists
// → returns session with userId + sessionToken

// No server-side hook needed unless you want to intercept first-time setup
const afterAuthenticateDevice: nkruntime.AfterHookFunction<...> =
  (ctx, logger, nk, out, data) => {
    // out.created === true if this is a new account
    if (out.created) {
      // Grant welcome coins, create default profile, etc.
      nk.walletUpdate(ctx.userId, { coins: 100 }, null, true);
      logger.info('New user %s created, granted welcome coins', ctx.userId);
    }
  };
```

## Multi-Game Identity (SDK Aliases)

This project uses `sdk_aliases` module to route RPCs by `gameId`:
- Each game (quizverse, lasttolive) gets its own RPC namespace (`quizverse_*`, `lasttolive_*`)
- `multigame_rpcs.js` handles shared platform RPCs
- `DEFAULT_GAME_ID` env var sets active game context

## Common Auth Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `UNAUTHENTICATED (16)` | Token expired | Client must refresh; check `token_expiry_sec` |
| `invalid custom ID` | Cognito JWT malformed | Validate JWT format before sending |
| `account banned` | User flag set | Check `users` table `disable_time` field |
| `ctx.userId empty` | Server-to-server call | Add userId guard at top of RPC |

## Context Files (load only if needed)
- Identity module: `data/modules/identity.js`
- Auth SDK: `Assets/_IntelliVerseXSDK/` (read-only, Unity side)
- Docs: `docs/identity.md`
