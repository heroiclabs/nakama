---
name: nakama-modules
description: Navigate the 40+ module system, add domains, read index.js, and manage cross-module dependencies.
version: "1.0"
---

## When to Use
Keywords: `module`, `domain`, `new module`, `cross-game`, `multigame`, `SDK aliases`, `index.js`, `src`, `postbuild`, `legacy_runtime`, `domain folder`, `platform RPC`

## Module Map (40+ Domains)

```
data/modules/
├── src/                      ← TypeScript source root
│   └── <domain>/<domain>.ts  ← one TS file per domain
│
├── ── GAME CONTENT ──────────────────────────────────────────
├── quizverse_depth/          ← QuizVerse question depth tracking
├── quizverse_news_quiz/      ← QuizVerse news quiz feature
├── quizverse_quiz_generate/  ← AI quiz generation
├── quizverse_seen/           ← seen-question deduplication (qv_seen collection)
├── quiz_results/             ← quiz attempt storage
├── lasttolive_depth/         ← LastToLive depth tracking
├── cricket/ + cricket_manager/ + cricket_worldcup/  ← Cricket game domain
│
├── ── PROGRESSION & SOCIAL ──────────────────────────────────
├── achievements/             ← achievement unlock + storage
├── badges/                   ← badge award system
├── characters/               ← character unlock/equip
├── daily_missions/           ← mission tracking
├── daily_rewards/            ← daily login reward
├── friend_quests/            ← friend-based quests
├── friend_streaks/           ← streak tracking with friends
├── friends/                  ← friend list, add/remove
├── groups/                   ← group/guild management
├── leagues/                  ← competitive league system
├── progression/              ← XP, level, prestige
├── retention/                ← re-engagement events
├── tournaments/              ← tournament brackets
├── visual_path/              ← visual progression path
├── fortune_wheel/            ← spin-the-wheel rewards
│
├── ── ECONOMY & MONETIZATION ────────────────────────────────
├── wallet/                   ← wallet.js (coin/gem balances)
├── offer_engine/             ← dynamic offers
├── rewarded_ads/             ← rewarded ad callback
├── ivx_quest/                ← IVX quest economy bridge
├── player_gifts/             ← gift system
│
├── ── ANALYTICS & AI ────────────────────────────────────────
├── analytics/                ← event logging
├── analytics_metrics/        ← Go plugin (native Prometheus counters)
├── external_analytics/       ← external analytics pipeline
├── external_pollers/         ← scheduled polling (S3, etc.)
├── ai_player/                ← AI-powered player features
├── copilot/                  ← AI copilot features
├── event_pipeline/           ← real-time event processing
├── realtime_tick/            ← server-tick heartbeat
├── game_metrics/             ← per-game metric aggregation
│
├── ── PLATFORM & INFRASTRUCTURE ─────────────────────────────
├── player/                   ← player profile management
├── notifications/            ← push notifications
├── onboarding/               ← new user onboarding flow
├── matchmaking/              ← matchmaker configuration
├── multiplayer_account_lock/ ← prevent duplicate multiplayer sessions
├── cross_game/               ← cross-game progression sharing
├── social_v2/                ← social features v2
├── smart_review/             ← review prompt logic
├── push_notifications/       ← FCM/APNS push
├── chatbox/                  ← in-game chat
├── chat_moderation/          ← auto-moderation
├── personalization/          ← personalized content
├── live_ops/                 ← live-ops events calendar
├── manifest/                 ← game manifest (characters, badges)
├── infrastructure/           ← health checks, config RPCs
├── avatar_replication/       ← avatar sync cross-game
│
├── ── SATORI & EXTERNAL ─────────────────────────────────────
├── satori_compat/            ← Satori compatibility layer
├── satori_direct/            ← direct Satori HTTP client
├── s3_assets/                ← S3 presigned URL generation
│
├── ── ROOT LEVEL JS ─────────────────────────────────────────
├── identity.js               ← auth identity (plain JS)
├── leaderboard.js            ← leaderboard logic
├── leaderboards_timeperiod.js ← time-period leaderboard resets
├── leaderboard_utils.js      ← shared leaderboard helpers
├── wallet.js                 ← wallet operations
├── multigame_rpcs.js         ← multi-game RPC dispatcher
├── player_rpcs.js            ← player profile RPCs
├── sdk_aliases.js            ← game-prefixed RPC aliases
├── profile_sync.js           ← profile sync between games
├── legacy_runtime.js         ← old TS-compiled bundle (gradual migration)
├── postbuild.js              ← build merge tool
└── index.js                  ← FINAL output (auto-generated)
```

## Adding a New Domain Module

```
Step 1: Create data/modules/src/<domain>/<domain>.ts
Step 2: Implement InitModule + RPC functions (see nakama-rpc skill)
Step 3: cd data/modules && npm run build
Step 4: Verify new RPCs appear in index.js: grep "<domain>" data/modules/index.js
Step 5: docker compose restart nakama
Step 6: Test via curl or Nakama console API Explorer
```

## Cross-Module Communication

**RULE: Modules cannot import each other.** Goja VM has no module system.
All code compiles to a single `index.js`. Share logic via:
1. **Global helper functions** (declare in a shared utility TS file included in tsc)
2. **Nakama storage** (read/write shared state)
3. **Wallet operations** (for currency changes)
4. **Duplicate small utilities** (acceptable for small helpers)

```typescript
// WRONG — module imports don't exist at runtime:
// import { getPlayerLevel } from '../progression/progression';

// RIGHT — declare shared helpers in src/shared/helpers.ts (included by tsc):
function getPlayerLevel(nk: nkruntime.Nakama, userId: string): number {
  const reads = [{ collection: 'progression', key: 'level', userId }];
  const objs = nk.storageRead(reads);
  return objs.length > 0 ? JSON.parse(objs[0].value).level : 1;
}
```

## SDK Aliases (Multi-Game RPC Routing)

`sdk_aliases.js` registers `quizverse_*` and `lasttolive_*` prefixed aliases:
```javascript
// sdk_aliases.js registers:
// quizverse_get_leaderboard → calls shared get_leaderboard with gameId=quizverse
// lasttolive_get_leaderboard → calls shared get_leaderboard with gameId=lasttolive
```

When adding a new shared RPC, also add game-specific aliases in `sdk_aliases.js` or `multigame_rpcs.js`.

## Reading index.js Safely

`index.js` is 10,383+ lines. Never read it whole. Use targeted greps:

```powershell
# Find all RPCs for a domain
rg "registerRpc.*quizverse" data/modules/index.js

# Find a specific function
rg "function rpcQuizverseGetLeaderboard" data/modules/index.js

# Count total RPCs
rg "initializer\.registerRpc" data/modules/index.js | Measure-Object -Line
```

## Context Files (load only if needed)
- Module list: `data/modules/` (run `ls` to see all domains)
- RPC reference: `docs/COMPLETE_RPC_REFERENCE.md` (grep only)
- Multi-game routing: `data/modules/multigame_rpcs.js`
- SDK aliases: `data/modules/sdk_aliases.js`
