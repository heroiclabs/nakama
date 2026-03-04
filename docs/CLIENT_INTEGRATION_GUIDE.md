# Client Integration Guide

> Complete reference for integrating a game client with the Nakama backend.
> All you need is a **`device_id`** (stable per-device UUID) and a **`game_id`** (your game's UUID from the registry).

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Authentication & Identity](#2-authentication--identity)
3. [Complete RPC Reference by Game Phase](#3-complete-rpc-reference-by-game-phase)
4. [Best Practices](#4-best-practices)
5. [Error Handling](#5-error-handling)
6. [Rate Limiting](#6-rate-limiting)
7. [Capability Matrix](#7-capability-matrix)
8. [Integration Recipes](#8-integration-recipes)
9. [Storage Collections Reference](#9-storage-collections-reference)
10. [MCP Analytics Tools](#10-mcp-analytics-tools-for-developers)

---

## 1. Quick Start

### What You Need

| Item | Example | Where to get it |
|------|---------|-----------------|
| `device_id` | `"a1b2c3d4-e5f6-..."` | `SystemInfo.deviceUniqueIdentifier` (Unity) or generate a GUID and persist it |
| `game_id` | `"550e8400-e29b-..."` | From your IntelliVerse dashboard or `get_game_registry` RPC |
| Nakama host | `localhost` or your server IP | Deployment config |
| Server key | `"defaultkey"` | Nakama server config |

### Minimal Client Setup (Unity C#)

```csharp
// 1. Initialize
var client = new Client("http", "your-server.com", 7350, "defaultkey");

// 2. Get or create device ID
string deviceId = PlayerPrefs.GetString("device_id", "");
if (string.IsNullOrEmpty(deviceId)) {
    deviceId = System.Guid.NewGuid().ToString();
    PlayerPrefs.SetString("device_id", deviceId);
}

// 3. Authenticate
var session = await client.AuthenticateDeviceAsync(deviceId);

// 4. Create or sync identity
var identity = await client.RpcAsync(session, "create_or_sync_user", JsonWriter.ToJson(new {
    device_id = deviceId,
    game_id = "YOUR_GAME_UUID",
    username = "Player_" + deviceId.Substring(0, 6)
}));

// 5. Create wallet
var wallet = await client.RpcAsync(session, "create_player_wallet", JsonWriter.ToJson(new {
    device_id = deviceId,
    game_id = "YOUR_GAME_UUID"
}));

// You're ready to call any RPC!
```

### The Two Auth Patterns

| Pattern | When to use | How |
|---------|-------------|-----|
| **Bearer token** | Game client calls (player context) | `AuthenticateDeviceAsync` → session token |
| **HTTP key** | Server-to-server, admin, MCP tools | `?http_key=defaulthttpkey` query param |

Most RPCs require a Bearer token (authenticated player). Some accept `device_id` in the payload for unauthenticated flows.

---

## 2. Authentication & Identity

### Device-Based Identity Flow

```
┌──────────┐      AuthenticateDevice       ┌──────────┐
│  Client   │ ───────────────────────────── │  Nakama   │
│           │ <── session (JWT token) ───── │  Server   │
│           │                               │           │
│           │  create_or_sync_user          │           │
│           │  {device_id, game_id,         │           │
│           │   username}                   │           │
│           │ ──────────────────────────── │           │
│           │ <── {user_id, username,       │           │
│           │      wallet, profile} ─────── │           │
└──────────┘                               └──────────┘
```

### Identity RPCs

| RPC | Payload | Returns | Purpose |
|-----|---------|---------|---------|
| `create_or_sync_user` | `{device_id, game_id, username}` | `{success, userId, username, isNewUser}` | Primary identity creation. Call on every app launch. Idempotent. |
| `create_player_wallet` | `{device_id, game_id}` | `{success, wallets}` | Creates global + per-game wallet. Call after identity. Idempotent. |
| `rpc_change_username` | `{new_username}` | `{success}` | Change display name. Rate-limited. |
| `get_player_metadata` | `{user_id?}` | `{success, metadata}` | Get player metadata (self if no user_id). |
| `rpc_update_player_metadata` | `{meta: {...}}` | `{success}` | Update custom metadata fields. |
| `check_geo_and_update_profile` | `{latitude, longitude}` | `{success, geo}` | Update location data. |

### Best Practices

- **Always persist `device_id`** — losing it means losing the player's account.
- **Call `create_or_sync_user` on every launch** — it's idempotent and handles reconnection.
- **Call `create_player_wallet` after identity** — ensures wallet exists before any economy calls.
- **Use `device_id` in payloads** for RPCs that need it (multi-game RPCs). Some RPCs resolve the user from `ctx.userId` (Bearer token) instead.

---

## 3. Complete RPC Reference by Game Phase

### Phase 1: App Launch (call in order)

| # | RPC | Payload | Purpose |
|---|-----|---------|---------|
| 1 | `create_or_sync_user` | `{device_id, game_id, username}` | Create/sync identity |
| 2 | `create_player_wallet` | `{device_id, game_id}` | Ensure wallets exist |
| 3 | `onboarding_get_state` | `{game_id}` | Check onboarding progress |
| 4 | `analytics_log_event` | `{gameId, eventName: "session_start"}` | Start session tracking |
| 5 | `winback_check_status` | `{game_id}` | Check if returning player (show welcome back!) |
| 6 | `flash_event_list_active` | `{game_id}` | Check active events (show banners) |
| 7 | `happy_hour_status` | `{game_id}` | Check bonus multipliers |
| 8 | `daily_spotlight` | `{game_id}` | Get featured content |
| 9 | `rewards_pending` | `{game_id}` | Show unclaimed rewards badge |

### Phase 2: Main Menu / Home Screen

| RPC | Payload | Purpose |
|-----|---------|---------|
| `wallet_get_all` | `{gameId}` | Display currency balances |
| `daily_rewards_get_status` | `{gameId}` | Show daily reward streak |
| `get_daily_missions` | `{gameId}` | Show today's missions |
| `weekly_goals_get_status` | `{game_id}` | Show weekly goals progress |
| `season_pass_get_status` | `{game_id}` | Show season pass level/rewards |
| `monthly_milestones_get_status` | `{game_id}` | Show monthly milestones |
| `get_personalized_missions` | `{game_id}` | AI-tailored mission set |
| `get_smart_recommendations` | `{game_id}` | "What should I play next?" |
| `get_notifications` | `{game_id, limit: 20}` | Show notification inbox |
| `friend_score_alert` | `{game_id}` | "Your friend beat your score!" |
| `challenge_list` | `{game_id}` | Pending challenges |

### Phase 3: Claiming Rewards

| RPC | Payload | Purpose |
|-----|---------|---------|
| `daily_rewards_claim` | `{gameId}` | Claim daily streak reward → coins/XP granted to wallet |
| `claim_mission_reward` | `{gameId, missionId}` | Claim completed mission reward → coins/XP granted |
| `weekly_goals_claim_reward` | `{game_id, goal_id}` | Claim individual goal reward → coins/gems granted |
| `weekly_goals_claim_bonus` | `{game_id}` | Claim weekly completion bonus → coins/gems granted |
| `season_pass_claim_reward` | `{game_id, level, track}` | Claim season pass reward → coins/gems granted |
| `monthly_milestones_claim_reward` | `{game_id, milestone_id}` | Claim milestone reward → coins/gems granted |
| `monthly_milestones_claim_legendary` | `{game_id}` | Claim legendary reward (5000 coins, 500 gems) |
| `winback_claim_rewards` | `{game_id}` | Claim comeback rewards → coins/gems granted |
| `mystery_box_open` | `{game_id, box_id}` | Open mystery box → random reward granted |
| `onboarding_claim_welcome_bonus` | `{game_id}` | First-time welcome bonus |
| `tournament_claim_rewards` | `{tournament_id}` | Claim tournament prizes |

> **All claim RPCs now grant rewards to the wallet via `nk.walletUpdate`.** The response includes a `walletGranted` field showing exact amounts credited.

### Phase 4: Gameplay — QuizVerse

| RPC | Payload | Purpose |
|-----|---------|---------|
| `quizverse_knowledge_map` | `{game_id}` | Category strengths/weaknesses visualization |
| `quizverse_adaptive_difficulty` | `{game_id, category, recent_accuracy}` | Get recommended difficulty |
| `quizverse_streak_quiz` | `{game_id, action: "start"}` | Start endless streak mode |
| `quizverse_streak_quiz` | `{game_id, action: "answer", answer_correct: true}` | Record streak answer |
| `quizverse_streak_quiz` | `{game_id, action: "end"}` | End streak, get reward |
| `quizverse_daily_puzzle` | `{game_id, action: "get"}` | Get today's puzzle |
| `quizverse_daily_puzzle` | `{game_id, action: "submit", solve_time_ms: 12500}` | Submit solve time |
| `quizverse_study_mode` | `{game_id, action: "get_weak_areas"}` | Review weak topics |
| `quizverse_category_war` | `{game_id, action: "get_status"}` | View faction war status |
| `quizverse_category_war` | `{game_id, action: "join", category_choice: "Science"}` | Pick a faction |
| `quizverse_knowledge_duel` | `{game_id, action: "create", opponent_id: "..."}` | Challenge someone to a duel |
| `quizverse_trivia_night` | `{game_id, action: "get_upcoming"}` | See scheduled trivia events |
| `quizverse_trivia_night` | `{game_id, action: "register", event_id: "..."}` | Register for event |
| `quiz_submit_result` | `{gameId, score, category, answers}` | Submit quiz result |
| `quiz_get_stats` | `{gameId}` | Get career stats |
| `quiz_get_history` | `{gameId, limit: 20}` | Get past quiz results |

### Phase 5: Gameplay — LastToLive

| RPC | Payload | Purpose |
|-----|---------|---------|
| `lasttolive_weapon_mastery` | `{game_id, action: "get"}` | View weapon mastery tiers |
| `lasttolive_weapon_mastery` | `{game_id, action: "update", weapon_id, kills, damage}` | Record kills/damage |
| `lasttolive_nemesis_get` | `{game_id}` | Who's your nemesis? |
| `lasttolive_highlight_reel` | `{game_id}` | Personal best moments |
| `lasttolive_revenge_match` | `{game_id, target_user_id}` | Challenge your killer |
| `lasttolive_bounty_create` | `{game_id, target_user_id, reward_amount}` | Place bounty (costs coins) |
| `lasttolive_bounty_list` | `{game_id}` | View active bounties |
| `lasttolive_loadout_save` | `{game_id, loadout_name, weapons, attachments}` | Save loadout (max 5) |
| `lasttolive_loadout_list` | `{game_id}` | List saved loadouts |

### Phase 6: After Every Game (Event Pipeline)

Call this after every quiz completion, match end, login, or purchase. It fans out to all progression systems at once.

| RPC | Payload | Purpose |
|-----|---------|---------|
| `player_event_submit` | `{game_id, event_type, event_data}` | **The mega-RPC.** One call updates achievements, season pass, weekly goals, daily missions, mastery, and more. |

**Event types:**

| `event_type` | `event_data` example | What happens |
|--------------|---------------------|--------------|
| `"quiz_complete"` | `{score: 850, category: "Science", time_ms: 30000}` | XP granted, mastery updated, achievements checked, season pass XP, mission progress, analytics logged |
| `"match_complete"` | `{survival_time: 180, kills: 5, placement: 2}` | XP for survival, achievements, season pass, analytics |
| `"login"` | `{}` | Streak updated, analytics logged |
| `"purchase"` | `{item_id: "...", amount: 100}` | Analytics logged, missions updated |
| `"friend_added"` | `{friend_id: "..."}` | Achievements, missions |
| `"multiplayer_win"` | `{opponent_id: "...", score_diff: 200}` | Achievements, rivalry update |

**Response:**

```json
{
    "success": true,
    "event_type": "quiz_complete",
    "fan_out_results": {
        "analytics": "ok",
        "achievements": { "unlocked": ["quiz_master_bronze"] },
        "season_pass": { "xp_added": 85, "new_level": false },
        "weekly_goals": { "updated": ["play_5_quizzes"] },
        "daily_missions": { "updated": ["score_above_800"] },
        "mastery": { "xp_added": 85, "category": "Science" }
    },
    "rewards_earned": [
        { "source": "achievement", "type": "coins", "amount": 100 }
    ]
}
```

> **Best practice:** Replace separate calls to individual progression RPCs with a single `player_event_submit` call. The server handles all fan-out.

### Phase 7: Social & Multiplayer

| RPC | Payload | Purpose |
|-----|---------|---------|
| `friends_list` | `{game_id}` | Get friends list |
| `send_friend_invite` | `{target_user_id, game_id}` | Send friend request |
| `accept_friend_invite` | `{invite_id, game_id}` | Accept request |
| `friends_challenge_user` | `{target_user_id, game_id}` | Send challenge |
| `challenge_accept` | `{challenge_id}` | Accept challenge |
| `challenge_decline` | `{challenge_id}` | Decline challenge |
| `challenge_list` | `{game_id, status}` | List challenges (pending/accepted/completed) |
| `get_rivalry` | `{target_user_id, game_id}` | Head-to-head record |
| `team_quiz_create` | `{game_id, team_name, max_members}` | Create team quiz session |
| `team_quiz_join` | `{join_code}` | Join via code |
| `daily_duo_create` | `{game_id, partner_user_id}` | Create paired daily challenge |
| `daily_duo_status` | `{duo_id}` | Check both players' progress |

### Phase 8: Groups & Community

| RPC | Payload | Purpose |
|-----|---------|---------|
| `create_game_group` | `{game_id, name, description}` | Create clan/guild |
| `get_user_groups` | `{game_id}` | List my groups |
| `update_group_xp` | `{group_id, game_id, xp_delta}` | Add group XP |
| `get_group_wallet` | `{group_id, game_id}` | View group treasury |
| `update_group_wallet` | `{group_id, game_id, amount, reason}` | Contribute to group |
| `group_quest_create` | `{group_id, quest_name, target_type, target_value, duration_hours}` | Start group quest |
| `group_quest_progress` | `{group_id, quest_id, increment}` | Add group quest progress |
| `group_activity_feed` | `{group_id, limit}` | View group activity |
| `send_group_chat_message` | `{group_id, message}` | Chat in group |
| `get_group_chat_history` | `{group_id, limit}` | Read chat history |

### Phase 9: Chat & Messaging

| RPC | Payload | Purpose |
|-----|---------|---------|
| `send_direct_message` | `{to_user_id, message}` | Send DM |
| `get_direct_message_history` | `{other_user_id, limit}` | Read DM history |
| `mark_direct_messages_read` | `{other_user_id}` | Mark as read |
| `send_chat_room_message` | `{room_id, message}` | Send to public room |
| `get_chat_room_history` | `{room_id, limit}` | Read room history |

### Phase 10: Leaderboards & Tournaments

| RPC | Payload | Purpose |
|-----|---------|---------|
| `submit_score_and_sync` | `{device_id, game_id, score}` | Submit & sync all leaderboards |
| `get_all_leaderboards` | `{game_id}` | Get all leaderboard types |
| `get_friend_leaderboard` | `{gameId, limit}` | Friends-only leaderboard |
| `get_time_period_leaderboard` | `{game_id, period, limit}` | Daily/weekly/monthly/all-time |
| `tournament_list_active` | `{game_id}` | List active tournaments |
| `tournament_join` | `{tournament_id}` | Join tournament |
| `tournament_submit_score` | `{tournament_id, score}` | Submit score |
| `tournament_get_leaderboard` | `{tournament_id, limit}` | View tournament standings |
| `tournament_claim_rewards` | `{tournament_id}` | Claim tournament rewards |
| `global_leaderboard_composite` | `{limit}` | Cross-game combined rankings |

### Phase 11: Economy & Purchases

| RPC | Payload | Purpose |
|-----|---------|---------|
| `wallet_get_all` | `{gameId}` | All wallet balances |
| `wallet_get_balances` | `{gameId}` | Quick balance check |
| `game_entry_validate` | `{game_id, user_id}` | Can player afford to enter? |
| `game_entry_complete` | `{game_id, user_id}` | Deduct entry cost |
| `calculate_score_reward` | `{game_id, score}` | Preview reward for a score |
| `rewarded_ad_request_token` | `{game_id}` | Start ad reward flow |
| `rewarded_ad_claim` | `{game_id, token}` | Claim reward after ad |
| `lucky_draw_enter` | `{game_id}` | Enter daily lottery (1/day) |
| `cross_game_bonus` | `{source_game_id, target_game_id, event_type}` | Earn in one game, get bonus in another |
| `game_discovery_reward` | `{game_id}` | First-time play bonus (100 coins + 25 gems) |

### Phase 12: Progression Systems

| RPC | Payload | Purpose |
|-----|---------|---------|
| `achievements_get_all` | `{game_id}` | View all achievements + progress |
| `achievements_update_progress` | `{game_id, achievement_id, progress}` | Manual progress update |
| `progressive_get_state` | `{game_id}` | View feature unlock tree |
| `progressive_claim_unlock` | `{game_id, unlock_id}` | Unlock a feature |
| `progressive_check_feature` | `{game_id, feature_id}` | Is feature X unlocked? |
| `progression_get_state` | `{game_id}` | Mastery/prestige level |
| `progression_add_mastery_xp` | `{game_id, xp}` | Add mastery XP |
| `progression_claim_prestige` | `{game_id}` | Claim prestige tier |
| `collections_get_status` | `{game_id}` | View collections |
| `collections_unlock_item` | `{game_id, item_id}` | Unlock collectible |

### Phase 13: Live Ops & Events

| RPC | Payload | Purpose |
|-----|---------|---------|
| `flash_event_list_active` | `{game_id}` | Active flash events (double XP, bonus coins, etc.) |
| `happy_hour_status` | `{game_id}` | Is happy hour active? What multiplier? |
| `daily_spotlight` | `{game_id}` | Today's featured content |
| `streak_milestone_celebrate` | `{game_id, streak_count}` | Check milestone rewards (7/14/30/50/100/365 days) |
| `comeback_surprise` | `{game_id, days_away}` | Welcome-back rewards for returning players |
| `mystery_box_open` | `{game_id, box_id}` | Open a mystery box |

### Phase 14: Cross-Game

| RPC | Payload | Purpose |
|-----|---------|---------|
| `cross_game_profile` | `{device_id}` | Unified player card across all games |
| `cross_game_bonus` | `{device_id, source_game_id, target_game_id, event_type}` | Play Game A, earn in Game B |
| `cross_game_challenge` | `{device_id, target_user_id, game_ids}` | Multi-game challenge |
| `game_discovery_reward` | `{device_id, game_id}` | First-play bonus for new game |
| `global_leaderboard_composite` | `{limit}` | Combined ranking |

### Phase 15: App Close / Background

| # | RPC | Payload | Purpose |
|---|-----|---------|---------|
| 1 | `analytics_log_event` | `{gameId, eventName: "session_end"}` | End session tracking (computes duration) |
| 2 | `onboarding_track_session` | `{game_id}` | Update session count for retention |
| 3 | `winback_record_session` | `{game_id}` | Update last-session timestamp for comeback detection |

### Phase 16: Analytics (Server/Admin only)

These RPCs are designed for MCP tools and admin dashboards, not game clients:

| RPC | Payload | Purpose |
|-----|---------|---------|
| `analytics_dashboard` | `{game_id}` | DAU/WAU/MAU, session stats, trends |
| `analytics_retention_cohort` | `{game_id, cohort_date}` | D1/D3/D7/D14/D30 retention |
| `analytics_engagement_score` | `{user_id, game_id}` | Per-player engagement (0-100) |
| `analytics_session_stats` | `{game_id, days: 7}` | Duration avg/median/p95, peak hours |
| `analytics_funnel` | `{game_id}` | 9-step conversion funnel |
| `analytics_economy_health` | `{game_id}` | Gini, source/sink, whale detection |
| `analytics_error_log` | `{game_id, days: 7}` | Error rates by RPC |
| `analytics_feature_adoption` | `{game_id}` | Feature usage percentages |

---

## 4. Best Practices

### Startup Sequence

```
App Launch
  ├── AuthenticateDevice(device_id)
  ├── create_or_sync_user
  ├── create_player_wallet
  ├── analytics_log_event("session_start")
  ├── [parallel]
  │   ├── onboarding_get_state
  │   ├── winback_check_status
  │   ├── daily_rewards_get_status
  │   ├── flash_event_list_active
  │   ├── rewards_pending
  │   └── get_personalized_missions
  └── Show Home Screen
```

### After Every Game Action

```
Quiz Complete / Match End
  └── player_event_submit(game_id, event_type, event_data)
      Server handles:
        ├── achievements_update
        ├── season_pass_add_xp
        ├── weekly_goals_update
        ├── daily_missions_update
        ├── mastery_xp
        └── analytics_log
      Returns:
        ├── rewards_earned
        ├── achievements_unlocked
        └── level_ups
```

### Batching

Use `batch_execute` to combine multiple independent reads into one network call:

```json
{
    "operations": [
        { "rpc": "wallet_get_all", "payload": { "gameId": "..." } },
        { "rpc": "daily_rewards_get_status", "payload": { "gameId": "..." } },
        { "rpc": "get_daily_missions", "payload": { "gameId": "..." } }
    ]
}
```

### Session Management

- Call `analytics_log_event` with `session_start` on app open and `session_end` on background/close.
- Call `onboarding_track_session` on every session to update retention metrics.
- Call `winback_record_session` to keep the last-session timestamp fresh.

### Wallet Reads vs. Writes

- Read wallet with `wallet_get_all` or `wallet_get_balances` — cheap, cache on client.
- Never update wallet from the client directly — all grants go through claim RPCs or `player_event_submit`.
- The `walletGranted` field in claim responses tells you exactly what was credited.

### Payload Conventions

- **`gameId`** vs **`game_id`**: Older RPCs (copilot/quiz/daily) use `gameId`. Newer RPCs use `game_id`. Both work for their respective endpoints. Check individual RPC docs.
- **`device_id`**: Required for multi-game RPCs and unauthenticated flows. Optional when Bearer token provides `ctx.userId`.
- **All payloads are JSON strings** sent as the RPC body.

---

## 5. Error Handling

### Response Format

Every RPC returns a JSON string with at minimum:

```json
// Success
{ "success": true, "...": "..." }

// Failure
{ "success": false, "error": "Human-readable error message" }
```

### Common Errors

| Error | Meaning | Action |
|-------|---------|--------|
| `"User not authenticated"` | Missing Bearer token | Re-authenticate |
| `"Missing required fields: ..."` | Payload validation failed | Check required params |
| `"Invalid gameId UUID format"` | `game_id` is not a valid UUID | Verify game_id |
| `"Reward already claimed"` | Duplicate claim attempt | Refresh UI, hide claim button |
| `"Goal not completed yet"` | Trying to claim uncompleted goal | Refresh progress data |
| `"Rate limit exceeded"` | Too many requests | Back off, retry after `retry_after` seconds |
| `"Not eligible for comeback rewards"` | Player doesn't meet winback criteria | Hide winback UI |

### Transport-Level Errors

| HTTP Status | Meaning |
|-------------|---------|
| 401 | Auth token invalid or HTTP key wrong |
| 404 | RPC not found (check name) |
| 500 | Server error (log and retry) |

### Client Pattern

```csharp
try {
    var result = await client.RpcAsync(session, "daily_rewards_claim",
        JsonWriter.ToJson(new { gameId = gameId }));
    var response = JsonParser.FromJson<RpcResponse>(result.Payload);

    if (response.success) {
        // Update UI with response.reward and response.walletGranted
    } else {
        ShowError(response.error);
    }
} catch (ApiResponseException e) {
    if (e.StatusCode == 401) {
        // Re-authenticate
        session = await client.AuthenticateDeviceAsync(deviceId);
    } else {
        ShowError("Network error. Please try again.");
    }
}
```

---

## 6. Rate Limiting

### Presets

| Category | Max Calls | Per | Examples |
|----------|-----------|-----|---------|
| READ | 200 | 60s | get_status, list, get_history |
| STANDARD | 100 | 60s | Most RPCs |
| WRITE | 30 | 60s | submit_score, update_wallet |
| SOCIAL | 50 | 60s | send_message, friend_invite |
| AUTH | 10 | 60s | authenticate, create_user |
| EXPENSIVE | 20 | 60s | batch_execute, analytics queries |

### Rate Limit Response

```json
{
    "success": false,
    "error": "Rate limit exceeded. Try again in 45 seconds.",
    "retry_after": 45
}
```

### Client Guidelines

- Cache read-heavy data (wallet, leaderboards, missions) and refresh at intervals.
- Use `batch_execute` to reduce call count.
- Use `player_event_submit` instead of calling 6+ separate progression RPCs.
- Implement exponential backoff on rate limit errors.

---

## 7. Capability Matrix

Everything you get with just a `game_id`:

| Capability | RPCs | Description |
|------------|------|-------------|
| **Identity & Profile** | 6 | Create account, change username, update metadata, geo-location |
| **Wallet & Economy** | 8 | Global + per-game wallets, balances, transfers, entry costs |
| **Daily Rewards** | 2 | 7-day streak with escalating rewards, auto-granted to wallet |
| **Daily Missions** | 3 | 3 unique missions per day with coin/XP rewards |
| **Weekly Goals** | 4 | Weekly objectives with streak bonus multiplier |
| **Monthly Milestones** | 4 | Monthly progression with legendary reward |
| **Season Pass** | 5 | Free + premium track with 50 levels of rewards |
| **Achievements** | 4 | Unlockable achievements with progress tracking |
| **Progressive Unlocks** | 4 | Feature unlock tree as player advances |
| **Mastery & Prestige** | 3 | Long-term mastery XP and prestige tiers |
| **Collections** | 4 | Unlockable items and cosmetics |
| **Leaderboards** | 6 | Per-game, per-period, friends-only, global composite |
| **Tournaments** | 6 | Scheduled competitions with prize pools |
| **Matchmaking** | 5 | Skill-based matching with party support |
| **Friends** | 6 | Add, remove, block, challenge, spectate |
| **Groups/Clans** | 5 | Create, join, group wallet, group XP |
| **Chat** | 7 | Group chat, DMs, public rooms, read receipts |
| **Social V2** | 12 | Challenges, rivalries, team play, duo mode, group quests |
| **Live Ops** | 9 | Flash events, mystery boxes, happy hour, streak milestones, lucky draw |
| **Personalization** | 2 | AI-tailored missions, smart recommendations |
| **Event Pipeline** | 2 | Single-call progression fan-out + pending rewards |
| **QuizVerse Depth** | 8 | Knowledge map, streak quiz, adaptive difficulty, daily puzzle, category war, duels, study mode, trivia night |
| **LastToLive Depth** | 8 | Weapon mastery, nemesis, highlights, revenge, bounties, loadouts |
| **Cross-Game** | 5 | Cross-game bonuses, unified profile, multi-game challenges |
| **Rewarded Ads** | 4 | Server-validated ad rewards |
| **Onboarding** | 11 | Step tracking, interests, welcome bonus, retention |
| **Retention** | 7 | Streak shields, notifications, first session, recommendations |
| **Win-back** | 4 | Returning player detection and tiered rewards |
| **Compatibility Quiz** | 6 | Multiplayer compatibility quiz sessions |
| **Analytics** | 10 | Event logging, session tracking, full dashboard suite |
| **Push Notifications** | 3 | Token registration, event triggers |
| **Infrastructure** | 6 | Batching, caching, rate limiting |
| **TOTAL** | **~216 RPCs** | |

---

## 8. Integration Recipes

### Recipe: New Player First Session

```
1. AuthenticateDevice(device_id)
2. create_or_sync_user → get userId
3. create_player_wallet → wallets created
4. onboarding_get_state → {onboardingComplete: false, currentStep: "welcome"}
5. analytics_log_event("session_start")
6. [Player completes onboarding steps]
7. onboarding_complete_step(step_id) × N
8. onboarding_set_interests(interests) → personalization seed
9. onboarding_claim_welcome_bonus → 500 coins
10. [Player plays first quiz]
11. quiz_submit_result(score, category, answers)
12. player_event_submit("quiz_complete", {score, category})
     → achievements checked, season pass XP, missions updated
13. onboarding_first_quiz_complete
14. daily_rewards_claim → day 1 reward
15. analytics_log_event("session_end")
```

### Recipe: Returning Player (Day 2+)

```
1. AuthenticateDevice → session
2. create_or_sync_user → existing user
3. analytics_log_event("session_start")
4. [Parallel fetch]
   ├── rewards_pending → unclaimed rewards badge
   ├── daily_rewards_get_status → streak info
   ├── get_daily_missions → today's missions
   ├── flash_event_list_active → event banners
   ├── happy_hour_status → bonus indicator
   └── get_personalized_missions → tailored content
5. [Show home screen with all data]
6. daily_rewards_claim → streak reward
7. [Player plays games, each ends with:]
   └── player_event_submit → cascading progression
8. [Check and claim as needed:]
   ├── claim_mission_reward (if completed)
   ├── weekly_goals_claim_reward (if completed)
   └── season_pass_claim_reward (if new level)
9. analytics_log_event("session_end")
```

### Recipe: Social Engagement Loop

```
1. friends_list → show friends
2. friend_score_alert → "Alex beat your score!"
3. friends_challenge_user(alex_id, game_id) → challenge sent
4. [Alex receives notification]
5. challenge_accept(challenge_id) → game starts
6. [Both play, submit scores via player_event_submit]
7. get_rivalry(alex_id, game_id) → "You: 5 wins, Alex: 3 wins"
```

### Recipe: Group / Clan Play

```
1. create_game_group(game_id, "Night Owls", "Late night quiz crew")
2. [Members join via Nakama group APIs]
3. group_quest_create(group_id, "Weekly Quiz Sprint", "quizzes_completed", 100, 168)
4. [Each member plays and calls:]
   group_quest_progress(group_id, quest_id, 1)
5. group_activity_feed(group_id) → see member contributions
6. send_group_chat_message(group_id, "We're at 87/100! Push!")
```

### Recipe: Live Event Participation

```
1. flash_event_list_active → [{name: "Double XP Weekend", multiplier: 2.0, ...}]
2. happy_hour_status → {active: true, multiplier: 1.5, time_remaining: 3600}
3. [Player plays during event — scores/XP multiplied server-side]
4. quizverse_trivia_night({action: "get_upcoming"})
5. quizverse_trivia_night({action: "register", event_id: "..."})
6. [At event time:]
   quizverse_trivia_night({action: "submit_score", event_id, score})
7. streak_milestone_celebrate({game_id, streak_count: 30})
   → "🎉 30 Day Streak! 1000 coins + 100 gems!"
```

---

## 9. Storage Collections Reference

Key collections the client interacts with (server-managed, read via RPCs):

| Collection | Key Pattern | Purpose |
|------------|-------------|---------|
| `device_user_mappings` | `device_{deviceId}` | Device → user mapping |
| `{gameId}_wallets` | `wallet_{userId}` | Per-game wallet |
| `global_wallets` | `wallet_{userId}` | Cross-game wallet |
| `daily_streaks` | `streak_{userId}_{gameId}` | Daily reward streak |
| `mission_progress` | `missions_{userId}_{gameId}` | Daily mission state |
| `weekly_goals` | `goals_{userId}_{gameId}` | Weekly goals state |
| `season_pass` | `pass_{userId}_{gameId}` | Season pass progress |
| `monthly_milestones` | `milestones_{userId}_{gameId}` | Monthly milestones |
| `analytics_events` | `event_{userId}_{gameId}_{ts}` | Event log |
| `analytics_dau` | `dau_{gameId}_{date}` | Daily active users |
| `analytics_session_summaries` | `session_summary_{userId}_{gameId}_{ts}` | Session durations |
| `analytics_error_events` | `err_{rpc}_{userId}_{ts}` | Error tracking |
| `challenges_v2` | `challenge_{id}` | Challenge state |
| `rivalries` | `rivalry_{userId}_{targetId}` | Head-to-head records |
| `flash_events` | `event_{gameId}_{id}` | Live ops events |
| `mystery_boxes` | `box_{userId}_{id}` | Granted mystery boxes |
| `personalized_missions` | `missions_{userId}_{date}` | AI-generated missions |
| `knowledge_map` | `map_{userId}_{gameId}` | Quiz coverage data |
| `weapon_mastery` | `mastery_{userId}_{gameId}` | Per-weapon progress |
| `bounties` | `bounty_{id}` | Active bounties |
| `loadouts` | `loadout_{userId}_{name}` | Saved weapon loadouts |
| `cross_game_bonuses` | `bonus_{userId}_{gameId}` | Cross-game reward tracking |

---

## 10. MCP Analytics Tools (for Developers)

While building your game, connect to the MCP server to get AI-powered insights. These tools aggregate data from the RPCs above and add benchmarks, flags, and recommendations.

| MCP Tool | What you learn | When to use |
|----------|---------------|-------------|
| `game_health_report` | Overall health score (0-100), DAU/MAU with benchmarks, retention vs industry standards, economy status | Weekly health check during development |
| `player_deep_dive` | Single player's engagement score, churn risk, wallet trends, feature usage | Investigating player reports or testing |
| `retention_analysis` | D1/D3/D7/D14/D30 curves by signup cohort, trend direction | After launching a new feature or event |
| `economy_audit` | Inflation detection, Gini coefficient, whale concentration, source/sink balance | Monthly economy review |
| `experience_quality` | Error rates by RPC, session quality, frustration signals | After each release |
| `growth_opportunities` | Funnel drop-offs, underused features, prioritized recommendations | Sprint planning |

### Example: Asking the LLM for Insights

With the MCP server connected, you can ask natural language questions:

- *"How is QuizVerse performing this week?"* → LLM calls `game_health_report` + `retention_analysis`
- *"Why are players churning on day 3?"* → LLM calls `retention_analysis` + `analytics_funnel`
- *"Is my economy balanced?"* → LLM calls `economy_audit`
- *"What should I build next?"* → LLM calls `growth_opportunities`
- *"Why did Player X stop playing?"* → LLM calls `player_deep_dive`

The LLM receives structured data with benchmarks and flags, enabling it to generate specific, actionable advice rather than generic suggestions.

---

## Appendix: RPC Count Summary

| System | RPCs | Notes |
|--------|------|-------|
| Core Multi-Game | 71 | Identity, wallet, leaderboards, quiz, chat, friends, groups |
| Achievements | 4 | Progress tracking and definitions |
| Matchmaking | 5 | Skill-based with party support |
| Tournaments | 6 | Scheduled competitions |
| Infrastructure | 6 | Batching, caching, rate limiting |
| Onboarding | 11 | Step tracking, interests, retention |
| Retention | 7 | Streak shields, notifications |
| Weekly Goals | 4 | Weekly objectives |
| Season Pass | 5 | Free + premium progression |
| Monthly Milestones | 4 | Monthly long-term goals |
| Collections | 4 | Collectible items |
| Win-back | 4 | Returning player rewards |
| Progressive Unlocks | 4 | Feature unlock tree |
| Progression & Mastery | 3 | XP and prestige |
| Rewarded Ads | 4 | Server-validated ads |
| Compatibility Quiz | 6 | Multiplayer compatibility |
| Event Pipeline | 2 | Mega-RPC + pending rewards |
| Social V2 | 12 | Challenges, rivalry, teams |
| Live Ops | 9 | Flash events, mystery boxes |
| Personalization | 2 | AI-tailored content |
| QuizVerse Depth | 8 | Deep quiz features |
| LastToLive Depth | 8 | Deep survival features |
| Cross-Game | 5 | Multi-game synergy |
| Analytics V2 | 9 | Dashboard, retention, economy |
| **Total** | **~216** | |
