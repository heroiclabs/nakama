# 🚀 Nakama Backend — Bootstrap Context

> **Purpose:** Full project awareness in one read. Load this for deep sessions, cross-domain work, or first-time context.
> **Size budget:** ~5 KB | **Version:** 1.0.0 | **Updated:** 2026-05-27
> **Normal sessions:** Use SKILL_BOOK.md instead (lighter). Only read this when task spans multiple domains.

---

## 🎮 Project Identity

| Key | Value |
|-----|-------|
| **Product** | IntelliVerseX multi-game backend (QuizVerse + LastToLive + Cricket) |
| **Server** | Nakama 3.35.0 (Heroic Labs) — open-source game backend |
| **Runtime** | JavaScript / TypeScript via Goja ES5 VM |
| **Database** | CockroachDB v24.1 (Postgres-compatible dialect) |
| **Auth** | Device auth (guest) + Custom auth (AWS Cognito JWT) |
| **Games** | QuizVerse (`quizverse_*`), LastToLive (`lasttolive_*`), Cricket (`cricket_*`) |
| **Platform** | Shared RPCs via `multigame_rpcs.js` + `sdk_aliases.js` |
| **Default game** | QuizVerse (`DEFAULT_GAME_ID=126bf539-dae2-4bcf-964d-316c0fa1f92b`) |

---

## 🏗️ Architecture

```
Unity Clients (QuizVerse, LastToLive, Cricket)
    │
    ├─ HTTP/WebSocket  → :7350  (API + real-time)
    ├─ gRPC            → :7349
    └─ Console         → :7351

Nakama Server (3.35.0)
    ├─ JS Runtime (Goja ES5)
    │   └─ data/modules/index.js  ← merged bundle (1018+ RPCs, 40+ domains)
    │       built from: data/modules/src/**/*.ts + data/modules/**/*.js
    │       via: npm run build (tsc + postbuild.js v2)
    │
    ├─ Go Plugin (:9100)
    │   └─ analytics_metrics.so  ← native Prometheus counters (ABI=3.35.0)
    │
    └─ CockroachDB v24.1 (:26257)
        └─ all game state, wallets, storage, leaderboards, sessions

External
    ├─ AWS S3          ← quiz content, media assets
    ├─ AWS Cognito     ← JWT identity
    ├─ Anthropic/OpenAI ← AI quiz generation, copilot
    └─ Satori          ← server-side A/B, experiments (satori_direct.js)
```

---

## 📦 Module Domains (40+)

### Game Content
`quizverse_depth`, `quizverse_news_quiz`, `quizverse_quiz_generate`, `quizverse_seen`, `quiz_results`, `lasttolive_depth`, `cricket`, `cricket_manager`, `cricket_worldcup`

### Progression & Social
`achievements`, `badges`, `characters`, `daily_missions`, `daily_rewards`, `friend_quests`, `friend_streaks`, `friends`, `groups`, `leagues`, `progression`, `retention`, `tournaments`, `visual_path`, `fortune_wheel`

### Economy & Monetization
`wallet`, `offer_engine`, `rewarded_ads`, `ivx_quest`, `player_gifts`

### Analytics & AI
`analytics`, `analytics_metrics` (Go plugin), `external_analytics`, `external_pollers`, `ai_player`, `copilot`, `event_pipeline`, `realtime_tick`, `game_metrics`

### Platform & Infrastructure
`player`, `notifications`, `onboarding`, `matchmaking`, `multiplayer_account_lock`, `cross_game`, `social_v2`, `smart_review`, `push_notifications`, `chatbox`, `chat_moderation`, `personalization`, `live_ops`, `manifest`, `infrastructure`, `avatar_replication`

### External Integrations
`satori_compat`, `satori_direct`, `s3_assets`

### Root-Level JS (plain JS, merged by postbuild)
`identity.js`, `leaderboard.js`, `leaderboard_utils.js`, `wallet.js`, `multigame_rpcs.js`, `player_rpcs.js`, `sdk_aliases.js`, `profile_sync.js`, `legacy_runtime.js`

---

## 🔑 Build Pipeline (Critical)

```
STEP 1: Edit  data/modules/src/<domain>/<domain>.ts
STEP 2: Build cd data/modules && npm run build
        → tsc compiles TypeScript to es5 → data/modules/build/index.js
        → postbuild.js v2 scans ALL .js files in data/modules/
        → rewrites registerRpc("id", fn) → __rpc_id = fn  (global stub)
        → generates new InitModule with DIRECT registerRpc calls
        → merges everything → data/modules/index.js
STEP 3: Verify rg "my_rpc_name" data/modules/index.js
STEP 4: Reload docker compose restart nakama
STEP 5: Watch docker compose logs -f nakama  (look for goja: errors)
STEP 6: Test http://localhost:7351  (API Explorer)
```

---

## 💡 postbuild.js v2 — The Most Critical Non-Obvious Rule

Nakama's `getRegisteredFnIdentifier` AST walker **ONLY** finds `registerRpc` calls that are **direct statements** inside `InitModule`'s body. It **CANNOT** follow function calls like `HiroEconomy.register(initializer)`.

postbuild.js solves this by:
1. Scanning all JS files for `registerRpc("id", fn)` patterns
2. Replacing with `__rpc_id = fn` global stubs
3. Generating a new `InitModule` wrapper with direct `initializer.registerRpc("id", __rpc_id)` calls

**Implication:** Your TypeScript `registerRpc` calls are found and wrapped automatically. You NEVER need to manually maintain the global stubs or the generated `InitModule`.

---

## 🔐 Environment Variables

Set in `.env` (gitignored). Forwarded to JS runtime via `--runtime.env KEY=VALUE` in docker-compose entrypoint. Access in JS RPCs as `ctx.env['KEY']`.

**Only vars listed in `RUNTIME_ENV_KEYS` inside the entrypoint block are visible to JS. Others are invisible.**

Key secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `NAKAMA_WEBHOOK_SECRET`, `ADMIN_PASSWORD_HASH`.

---

## 🗺 Documentation Map

| Need | File |
|------|------|
| All RPCs (123+) | `docs/COMPLETE_RPC_REFERENCE.md` |
| Auth/identity | `docs/identity.md` |
| Wallets | `docs/wallets.md` |
| Leaderboards | `docs/leaderboards.md` |
| Unity integration | `UNITY_DEVELOPER_COMPLETE_GUIDE.md` |
| Game onboarding | `GAME_ONBOARDING_GUIDE.md` |
| Full doc index | `DOCS_INDEX.md` |
| Official TS docs (LLM) | `https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/llm.md` |
| Official Docker (LLM) | `https://heroiclabs.com/docs/nakama/getting-started/install/docker/llm.md` |
