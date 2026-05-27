---
name: nakama-economy
description: Wallet, storage, leaderboards, IAP validation, and game economy patterns in Nakama.
version: "1.0"
---

## When to Use
Keywords: `wallet`, `coins`, `gems`, `currency`, `storage`, `leaderboard`, `IAP`, `purchase`, `validate`, `reward`, `daily`, `tournament`, `storage collection`, `economy`

## Economy Architecture

```
Nakama Economy
├── Virtual Wallet    → server-authoritative balances (coins, gems, etc.)
├── Storage Engine    → JSON collections per user (inventory, progress, seen-questions)
├── Leaderboards      → ranked scores, resets, seasons
└── IAP Validation    → Google Play / Apple App Store receipt validation
```

## Virtual Wallet

**RULE: All wallet mutations are server-authoritative. Never trust client amounts.**

```typescript
// Credit wallet (e.g. grant reward)
nk.walletUpdate(
  ctx.userId,
  { coins: 100, gems: 0 },   // delta — positive = credit, negative = debit
  { source: 'daily_reward', date: new Date().toISOString() },  // metadata
  true   // update_ledger: true records history
);

// Deduct wallet (e.g. purchase)
const balances = nk.walletUpdate(ctx.userId, { coins: -50 }, null, false);
// Throws if balance would go negative (insufficient funds)

// Read current balance
const accounts = nk.usersGetId([ctx.userId]);
const wallet = JSON.parse(accounts[0].wallet); // { coins: 150, gems: 5 }

// Batch update multiple users
nk.walletsUpdate([
  { userId: user1, changeset: { coins: 100 }, metadata: null },
  { userId: user2, changeset: { coins: 50 },  metadata: null }
], true);
```

## Storage Engine

```typescript
// Write to storage
nk.storageWrite([{
  collection: 'player_data',
  key: 'settings',
  userId: ctx.userId,
  value: JSON.stringify({ theme: 'dark', lang: 'en' }),
  permissionRead: 1,   // 0=no-read, 1=owner-read, 2=public-read
  permissionWrite: 1,  // 0=no-write, 1=owner-write
  version: ''          // optimistic locking — empty = overwrite always
}]);

// Read from storage
const objects = nk.storageRead([{
  collection: 'player_data',
  key: 'settings',
  userId: ctx.userId
}]);
const settings = objects.length > 0 ? JSON.parse(objects[0].value) : {};

// Delete from storage
nk.storageDelete([{
  collection: 'player_data',
  key: 'settings',
  userId: ctx.userId
}]);

// List all keys in a collection for a user
const list = nk.storageList(ctx.userId, 'player_data', 100, '');
```

## QuizVerse-Specific Storage Keys

| Collection | Key Pattern | Content |
|------------|-------------|---------|
| `qv_seen` | `{scope}_{topic_slug}` | Set of seen question IDs |
| `player_data` | `settings` | User preferences |
| `quiz_results` | `{quizId}` | Quiz attempt results |
| `system` | `admin_ids` | Admin user whitelist |

## Leaderboards

```typescript
// Write a score
nk.leaderboardRecordWrite(
  'quizverse_weekly',   // leaderboard ID
  ctx.userId,           // owner
  ctx.username,         // display name
  1500,                 // score
  0,                    // subscore
  JSON.stringify({ mode: 'daily', streak: 5 }),  // metadata
  nkruntime.Operator.SET  // SET | BEST | INCR | DECR
);

// List top scores
const records = nk.leaderboardRecordsList(
  'quizverse_weekly',
  [],          // owner IDs to include (empty = global)
  null,        // cursor
  100,         // limit
  null         // expiry override
);

// Delete a record
nk.leaderboardRecordDelete('quizverse_weekly', ctx.userId);
```

**Leaderboard reset hooks** (registered in InitModule):
```typescript
initializer.registerLeaderboardReset(function(ctx, logger, nk, leaderboard, reset) {
  if (leaderboard.id === 'quizverse_weekly') {
    // Distribute rewards to top-N players before reset
    const records = nk.leaderboardRecordsList(leaderboard.id, [], null, 10, null);
    records.records.forEach((rec, i) => {
      const reward = [500, 250, 100][i] || 50;
      nk.walletUpdate(rec.ownerId, { coins: reward }, { reason: 'weekly_top' }, true);
    });
  }
});
```

## IAP Validation (Server-Authoritative)

```typescript
let rpcValidateIAP: nkruntime.RpcFunction = function(ctx, logger, nk, payload) {
  const iap = JSON.parse(payload);

  let validateResponse: nkruntime.ValidatePurchaseResponse;
  switch (iap.store) {
    case 'GooglePlay':
      validateResponse = nk.purchaseValidateGoogle(ctx.userId, iap.payload);
      break;
    case 'AppleAppStore':
      validateResponse = nk.purchaseValidateApple(ctx.userId, iap.payload);
      break;
    default:
      throw new Error(JSON.stringify({ code: 3, message: 'unknown store: ' + iap.store }));
  }

  validateResponse.validatedPurchases.forEach(p => {
    switch (p.productId) {
      case 'gems_pack_small':  nk.walletUpdate(ctx.userId, { gems: 100 }, null, true); break;
      case 'gems_pack_large':  nk.walletUpdate(ctx.userId, { gems: 1000 }, null, true); break;
      case 'no_ads':
        nk.storageWrite([{
          collection: 'player_data', key: 'no_ads',
          userId: ctx.userId, value: JSON.stringify({ active: true }),
          permissionRead: 1, permissionWrite: 0, version: ''
        }]);
        break;
    }
  });

  return JSON.stringify({ success: true, purchased: validateResponse.validatedPurchases.length });
};
```

**IAP config required in docker-compose.yml:**
```
# Google Play
GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS=...
# Apple App Store
APPLE_KEY_ID + APPLE_ISSUER_ID + APPLE_PRIVATE_KEY + APPLE_QUIZVERSE_BUNDLE_ID
```

## Daily Rewards

```typescript
// Pattern used in data/modules/daily_rewards/
function claimDailyReward(ctx, logger, nk, payload) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const reads = [{ collection: 'daily_rewards', key: 'last_claim', userId: ctx.userId }];
  const objs = nk.storageRead(reads);
  const lastClaim = objs.length > 0 ? JSON.parse(objs[0].value).date : '';

  if (lastClaim === today) {
    throw new Error(JSON.stringify({ code: 9, message: 'already claimed today' }));
  }

  // Grant reward
  nk.walletUpdate(ctx.userId, { coins: 50 }, { reason: 'daily_reward' }, true);

  // Record claim
  nk.storageWrite([{
    collection: 'daily_rewards', key: 'last_claim',
    userId: ctx.userId, value: JSON.stringify({ date: today }),
    permissionRead: 1, permissionWrite: 1, version: ''
  }]);

  return JSON.stringify({ success: true, coins: 50 });
}
```

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `insufficient funds` on walletUpdate | balance would go negative | Check balance first or catch error |
| Storage version conflict | optimistic locking with stale version | Use empty version `''` to overwrite, or fetch+update |
| `IAP validation failed` | missing Apple/Google credentials | Add credentials to docker-compose.yml env vars |
| Leaderboard reset not firing | leaderboard not configured with reset schedule | Check Nakama console Leaderboard config |

## Context Files (load only if needed)
- Wallet module: `data/modules/wallet.js`
- Daily rewards: `data/modules/daily_rewards/`
- Economy guide: `docs/wallets.md`
- Leaderboards: `docs/leaderboards.md`
- IAP config: `docker-compose.yml` (env vars section)
