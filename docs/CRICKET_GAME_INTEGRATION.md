# Cricket Game Integration Guide

> Complete guide for integrating a Cricket game with the Nakama backend.
> Cricket uses the **generic multi-game RPC framework** — no cricket-specific RPCs exist. All features are accessed by passing your cricket `game_id` (UUID) to the shared RPCs.

---

## Table of Contents

1. [Current Status](#1-current-status)
2. [Getting Your Game ID](#2-getting-your-game-id)
3. [Ready-to-Use RPCs for Cricket](#3-ready-to-use-rpcs-for-cricket)
4. [Integration Walkthrough](#4-integration-walkthrough)
5. [What Works Out of the Box vs. What Needs Config](#5-what-works-out-of-the-box-vs-what-needs-config)
6. [Cricket-Specific Recommendations](#6-cricket-specific-recommendations)
7. [Proof-Check: Testing Each RPC](#7-proof-check-testing-each-rpc)
8. [Known Limitations](#8-known-limitations)
9. [What's NOT Available for Cricket (Yet)](#9-whats-not-available-for-cricket-yet)

---

## 1. Current Status

| Item | Status |
|------|--------|
| Cricket game_id in registry | **Not yet registered** — needs to be added to IntelliVerse and synced |
| Cricket-specific RPCs | **None** — QuizVerse and LastToLive have game-specific RPCs; Cricket does not |
| Generic RPCs (work with any game_id) | **135+ RPCs ready** — identity, wallet, leaderboards, rewards, social, analytics, etc. |
| Reward config | **Uses default config** (10% of score → coins, no cap) until a cricket-specific config is added |
| Leaderboards | **Auto-created** once game is registered and `create_time_period_leaderboards` runs |
| Storage collections | **Auto-namespaced** — storage is `{gameId}_wallets`, `{gameId}_profiles`, etc. |

### What This Means

Cricket works TODAY with all generic RPCs. You pass your cricket UUID as `game_id`/`gameId` and get:
- Player identity and wallets
- Leaderboards (daily/weekly/monthly/all-time)
- Daily rewards, missions, weekly goals, season pass, monthly milestones
- Social features (friends, challenges, rivalries, groups, chat)
- Live ops (flash events, mystery boxes, happy hour)
- Analytics (session tracking, engagement scoring)
- Event pipeline (single-call progression fan-out)
- Personalization (AI-tailored missions)

What Cricket does NOT get (until game-specific RPCs are built):
- QuizVerse-style depth RPCs (knowledge map, streak quiz, adaptive difficulty, etc.)
- LastToLive-style depth RPCs (weapon mastery, nemesis, bounties, etc.)
- Game-specific RPC names (no `cricket_*` prefix RPCs)

---

## 2. Getting Your Game ID

### Option A: Register in IntelliVerse (Production)

1. Add Cricket to the IntelliVerse platform → get a UUID
2. Call `sync_game_registry` RPC to pull it into Nakama
3. Your cricket `game_id` is now available via `get_game_registry`

### Option B: Use Any Valid UUID (Development)

For development, you can use any valid UUID as your game_id. The system auto-creates storage collections and uses the default reward config.

```
Example cricket game_id for development:
"c1234567-cric-ket0-game-000000000001"
```

### Option C: Add to Reward Config (Recommended)

To get tuned rewards, add a cricket entry to `GAME_REWARD_CONFIGS` in `data/modules/index.js` (around line 8673):

```javascript
"YOUR_CRICKET_UUID": {
    game_name: "Cricket",
    score_to_coins_multiplier: 0.05,    // 5% of score = coins
    min_score_for_reward: 10,           // Need 10+ runs to earn
    max_reward_per_match: 500,          // Cap per match
    currency: "coins",
    bonus_thresholds: [
        { score: 50, bonus: 10, type: "half_century" },
        { score: 100, bonus: 50, type: "century" },
        { score: 200, bonus: 100, type: "double_century" }
    ],
    streak_multipliers: {
        3: 1.1,    // 10% bonus for 3-match winning streak
        5: 1.25,   // 25% for 5 wins
        10: 1.5    // 50% for 10 wins
    }
}
```

---

## 3. Ready-to-Use RPCs for Cricket

Organized by feature. All RPCs take your cricket `game_id` as a parameter.

### 3.1 Identity & Profile (6 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `create_or_sync_user` | `{device_id, game_id, username}` | Create/sync player identity. Idempotent. Call on every launch. | Works with any UUID |
| `create_player_wallet` | `{device_id, game_id}` | Create global + per-game wallet. Idempotent. | Works with any UUID |
| `get_player_metadata` | `{user_id?}` | Get player metadata | Auth-based, game-agnostic |
| `rpc_update_player_metadata` | `{meta: {...}}` | Update custom metadata | Auth-based, game-agnostic |
| `rpc_change_username` | `{new_username}` | Change display name | Auth-based, game-agnostic |
| `get_player_portfolio` | `{game_id}` | Player portfolio summary | Works with any UUID |

### 3.2 Wallet & Economy (8 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `wallet_get_all` | `{gameId}` | Get global + per-game wallet balances | Works with any gameId |
| `wallet_get_balances` | `{gameId}` | Quick balance check | Works with any gameId |
| `wallet_update_global` | `{gameId, balance}` | Update global wallet | Works with any gameId |
| `wallet_update_game_wallet` | `{gameId, balance}` | Update game-specific wallet | Works with any gameId |
| `wallet_transfer_between_game_wallets` | `{gameId, source_game_id, target_game_id, amount}` | Transfer between games | Works with any UUIDs |
| `game_entry_validate` | `{game_id, user_id}` | Can player afford to enter? | Works with any UUID |
| `game_entry_complete` | `{game_id, user_id}` | Deduct entry cost | Works with any UUID |
| `calculate_score_reward` | `{game_id, score}` | Preview reward for a cricket score | Uses default config if not added to GAME_REWARD_CONFIGS |

### 3.3 Leaderboards (6 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `submit_score_and_sync` | `{device_id, game_id, score}` | Submit score + sync all leaderboards | Works with any UUID |
| `get_all_leaderboards` | `{game_id}` | Get all leaderboard types for cricket | Works with any UUID |
| `get_friend_leaderboard` | `{gameId, limit}` | Friends-only leaderboard | Works with any gameId |
| `get_time_period_leaderboard` | `{game_id, period, limit}` | Daily/weekly/monthly/all-time | Works after `create_time_period_leaderboards` |
| `submit_score_to_time_periods` | `{game_id, score, period}` | Submit to specific period | Works with any UUID |
| `global_leaderboard_composite` | `{limit}` | Cross-game combined ranking | Works across all games |

> **Note:** Call `create_time_period_leaderboards` once (admin) to create leaderboards for all games in the registry. For development, leaderboards are auto-created on first score submission for the basic leaderboard.

### 3.4 Daily Rewards (2 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `daily_rewards_get_status` | `{gameId}` | Get streak status and next reward | Works with any gameId |
| `daily_rewards_claim` | `{gameId}` | Claim today's daily reward → **coins granted to wallet** | Works with any gameId |

### 3.5 Daily Missions (3 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `get_daily_missions` | `{gameId}` | Get today's 3 missions with progress | Works with any gameId |
| `submit_mission_progress` | `{gameId, missionId, value}` | Update mission progress | Works with any gameId |
| `claim_mission_reward` | `{gameId, missionId}` | Claim completed mission reward → **coins granted** | Works with any gameId |

### 3.6 Weekly Goals (4 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `weekly_goals_get_status` | `{game_id}` | Weekly goals progress | Works with any UUID |
| `weekly_goals_update_progress` | `{game_id, goal_id, value}` | Update goal progress | Works with any UUID |
| `weekly_goals_claim_reward` | `{game_id, goal_id}` | Claim goal reward → **coins/gems granted** | Works with any UUID |
| `weekly_goals_claim_bonus` | `{game_id}` | Claim weekly completion bonus → **coins/gems granted** | Works with any UUID |

### 3.7 Season Pass (5 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `season_pass_get_status` | `{game_id}` | Level, XP, claimed rewards | Works with any UUID |
| `season_pass_add_xp` | `{game_id, xp}` | Add season pass XP | Works with any UUID |
| `season_pass_complete_quest` | `{game_id, quest_id, quest_type}` | Complete a quest | Works with any UUID |
| `season_pass_claim_reward` | `{game_id, level, track}` | Claim reward → **coins/gems granted** | Works with any UUID |
| `season_pass_purchase_premium` | `{game_id}` | Unlock premium track | Works with any UUID |

### 3.8 Monthly Milestones (4 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `monthly_milestones_get_status` | `{game_id}` | Monthly milestone progress | Works with any UUID |
| `monthly_milestones_update_progress` | `{game_id, milestone_id, value}` | Update milestone | Works with any UUID |
| `monthly_milestones_claim_reward` | `{game_id, milestone_id}` | Claim reward → **coins/gems granted** | Works with any UUID |
| `monthly_milestones_claim_legendary` | `{game_id}` | Claim legendary (5000 coins + 500 gems) | Works with any UUID |

### 3.9 Achievements (4 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `achievements_get_all` | `{game_id}` | All achievements with progress | Works with any UUID |
| `achievements_update_progress` | `{game_id, achievement_id, progress}` | Update progress | Works with any UUID |
| `achievements_create_definition` | `{game_id, ...}` | Create achievement (admin) | Works with any UUID |
| `achievements_bulk_create` | `{game_id, achievements}` | Bulk create (admin) | Works with any UUID |

### 3.10 Progression & Unlocks (7 RPCs)

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `progressive_get_state` | `{game_id}` | Feature unlock tree | Works with any UUID |
| `progressive_claim_unlock` | `{game_id, unlock_id}` | Unlock a feature | Works with any UUID |
| `progressive_check_feature` | `{game_id, feature_id}` | Is feature unlocked? | Works with any UUID |
| `progressive_update_progress` | `{game_id, progress}` | Update unlock progress | Works with any UUID |
| `progression_get_state` | `{game_id}` | Mastery/prestige level | Works with any UUID |
| `progression_add_mastery_xp` | `{game_id, xp}` | Add mastery XP | Works with any UUID |
| `progression_claim_prestige` | `{game_id}` | Claim prestige tier | Works with any UUID |

### 3.11 Event Pipeline (2 RPCs) — The Most Important

| RPC | Payload | What it does | Verified |
|-----|---------|--------------|----------|
| `player_event_submit` | `{game_id, event_type, event_data}` | **Mega-RPC** — one call updates achievements, season pass, weekly goals, missions, mastery, analytics | Works with any UUID |
| `rewards_pending` | `{game_id}` | Aggregate unclaimed rewards across all systems | Works with any UUID |

**Cricket event types to use:**

| event_type | event_data example | When to call |
|------------|-------------------|--------------|
| `"match_complete"` | `{score: 87, wickets: 3, overs: 20, result: "won"}` | After every cricket match |
| `"login"` | `{}` | On each session start |
| `"purchase"` | `{item_id: "cricket_bat_premium", amount: 500}` | After any purchase |
| `"friend_added"` | `{friend_id: "..."}` | When adding a friend |
| `"multiplayer_win"` | `{opponent_id: "...", score_diff: 45}` | After winning multiplayer |

### 3.12 Social (18 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `friends_list` | `{game_id}` | List friends |
| `send_friend_invite` | `{target_user_id, game_id}` | Send friend request |
| `accept_friend_invite` | `{invite_id, game_id}` | Accept request |
| `decline_friend_invite` | `{invite_id, game_id}` | Decline request |
| `friends_challenge_user` | `{target_user_id, game_id}` | Challenge a friend |
| `friends_block` | `{target_user_id}` | Block user |
| `friends_remove` | `{target_user_id}` | Remove friend |
| `challenge_accept` | `{challenge_id}` | Accept challenge |
| `challenge_decline` | `{challenge_id}` | Decline challenge |
| `challenge_list` | `{game_id, status}` | List challenges |
| `get_rivalry` | `{target_user_id, game_id}` | Head-to-head record |
| `friend_score_alert` | `{game_id}` | Friends who beat your score |
| `team_quiz_create` | `{game_id, team_name, max_members}` | Create team session (works for any team mode) |
| `team_quiz_join` | `{join_code}` | Join team session |
| `daily_duo_create` | `{game_id, partner_user_id}` | Paired daily challenge |
| `daily_duo_status` | `{duo_id}` | Check duo status |
| `group_quest_create` | `{group_id, quest_name, target_type, target_value, duration_hours}` | Group quest |
| `group_quest_progress` | `{group_id, quest_id, increment}` | Update group quest |

### 3.13 Groups & Chat (12 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `create_game_group` | `{game_id, name, description}` | Create cricket clan/team |
| `get_user_groups` | `{game_id}` | List my groups |
| `update_group_xp` | `{group_id, game_id, xp_delta}` | Add group XP |
| `get_group_wallet` | `{group_id, game_id}` | Group treasury |
| `update_group_wallet` | `{group_id, game_id, amount, reason}` | Contribute to group |
| `group_activity_feed` | `{group_id, limit}` | Group activity feed |
| `send_group_chat_message` | `{group_id, message}` | Group chat |
| `get_group_chat_history` | `{group_id, limit}` | Chat history |
| `send_direct_message` | `{to_user_id, message}` | Direct message |
| `get_direct_message_history` | `{other_user_id, limit}` | DM history |
| `send_chat_room_message` | `{room_id, message}` | Public room chat |
| `get_chat_room_history` | `{room_id, limit}` | Room history |

### 3.14 Live Ops (9 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `flash_event_list_active` | `{game_id}` | Active events (Double XP Weekend, etc.) |
| `flash_event_create` | `{game_id, event_name, event_type, multiplier, duration_minutes}` | Create event (admin) |
| `happy_hour_status` | `{game_id}` | Is happy hour active? |
| `daily_spotlight` | `{game_id}` | Today's featured content |
| `mystery_box_grant` | `{user_id, game_id, box_type, source}` | Grant mystery box (admin/event) |
| `mystery_box_open` | `{game_id, box_id}` | Open box → random reward |
| `streak_milestone_celebrate` | `{game_id, streak_count}` | Milestone rewards (7/14/30/50/100/365 days) |
| `comeback_surprise` | `{game_id, days_away}` | Welcome-back package |
| `lucky_draw_enter` | `{game_id}` | Daily lottery entry |

### 3.15 Personalization (2 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `get_personalized_missions` | `{game_id}` | AI-tailored missions (comfort/stretch/social/discovery) |
| `get_smart_recommendations` | `{game_id}` | "What should I play next?" with reasons |

### 3.16 Matchmaking & Tournaments (11 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `matchmaking_find_match` | `{game_id, mode}` | Find cricket match |
| `matchmaking_cancel` | `{ticket_id}` | Cancel search |
| `matchmaking_get_status` | `{ticket_id}` | Check match status |
| `matchmaking_create_party` | `{game_id, mode}` | Create party |
| `matchmaking_join_party` | `{party_id}` | Join party |
| `tournament_create` | `{game_id, title, start_time, end_time}` | Create tournament (admin) |
| `tournament_join` | `{tournament_id}` | Join tournament |
| `tournament_list_active` | `{game_id}` | List active tournaments |
| `tournament_submit_score` | `{tournament_id, score}` | Submit score |
| `tournament_get_leaderboard` | `{tournament_id, limit}` | Tournament standings |
| `tournament_claim_rewards` | `{tournament_id}` | Claim prizes |

### 3.17 Onboarding & Retention (22 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `onboarding_get_state` | `{game_id}` | Onboarding progress |
| `onboarding_update_state` | `{game_id, state}` | Update state |
| `onboarding_complete_step` | `{game_id, step_id}` | Mark step done |
| `onboarding_set_interests` | `{game_id, interests}` | Set interests |
| `onboarding_claim_welcome_bonus` | `{game_id}` | Welcome bonus |
| `onboarding_first_quiz_complete` | `{game_id}` | First game complete (works for any game type) |
| `onboarding_track_session` | `{game_id}` | Track session |
| `onboarding_get_retention_data` | `{game_id}` | Retention data |
| `retention_grant_streak_shield` | `{game_id}` | Grant streak protection |
| `retention_get_streak_shield` | `{game_id}` | Check streak shield |
| `retention_use_streak_shield` | `{game_id}` | Use streak shield |
| `retention_get_recommendations` | `{game_id}` | Retention recommendations |
| `winback_check_status` | `{game_id}` | Returning player detection |
| `winback_claim_rewards` | `{game_id}` | Welcome-back rewards |
| `winback_record_session` | `{game_id}` | Record session for comeback tracking |
| `collections_get_status` | `{game_id}` | Collectibles |
| `collections_unlock_item` | `{game_id, item_id}` | Unlock item |
| `rewarded_ad_request_token` | `{game_id}` | Start ad reward |
| `rewarded_ad_claim` | `{game_id, token}` | Claim ad reward |
| `rewarded_ad_validate_score_multiplier` | `{game_id, multiplier}` | Validate multiplier |
| `rewarded_ad_get_status` | `{game_id}` | Ad reward status |
| `analytics_log_event` | `{gameId, eventName, eventData}` | Log any analytics event |

### 3.18 Cross-Game (5 RPCs)

| RPC | Payload | What it does |
|-----|---------|--------------|
| `cross_game_bonus` | `{device_id, source_game_id, target_game_id, event_type}` | Earn in cricket, get bonus in another game |
| `cross_game_profile` | `{device_id}` | Unified profile across games |
| `cross_game_challenge` | `{device_id, target_user_id, game_ids}` | Multi-game challenge |
| `game_discovery_reward` | `{device_id, game_id}` | First-time cricket bonus (100 coins + 25 gems) |
| `global_leaderboard_composite` | `{limit}` | Combined ranking across games |

### 3.19 Analytics (9 RPCs) — For Developer/MCP Use

| RPC | Payload | What it does |
|-----|---------|--------------|
| `analytics_dashboard` | `{game_id}` | DAU/WAU/MAU, trends |
| `analytics_retention_cohort` | `{game_id, cohort_date}` | D1-D30 retention |
| `analytics_engagement_score` | `{user_id, game_id}` | Player engagement 0-100 |
| `analytics_session_stats` | `{game_id, days}` | Session durations |
| `analytics_funnel` | `{game_id}` | Conversion funnel |
| `analytics_economy_health` | `{game_id}` | Economy balance |
| `analytics_error_log` | `{game_id}` | Error tracking |
| `analytics_feature_adoption` | `{game_id}` | Feature usage |
| `analytics_log_error` | `{rpc_name, error_message}` | Log error |

---

## 4. Integration Walkthrough

### Step 1: First Launch

```
Client                              Server
──────                              ──────
AuthenticateDevice(device_id) ─────→ session token
                                    
create_or_sync_user ──────────────→ {userId, username}
  {device_id, game_id, username}

create_player_wallet ─────────────→ {wallets: {global, cricket}}
  {device_id, game_id}

onboarding_get_state ─────────────→ {onboardingComplete: false}
  {game_id}

analytics_log_event ──────────────→ {success}
  {gameId, eventName: "session_start"}
```

### Step 2: Home Screen (Parallel Calls)

```
┌─ daily_rewards_get_status ──→ {streak: 3, canClaim: true}
├─ get_daily_missions ────────→ {missions: [{...}, {...}, {...}]}
├─ weekly_goals_get_status ───→ {goals: [...], allCompleted: false}
├─ rewards_pending ───────────→ {unclaimed: [{source: "daily", ...}]}
├─ flash_event_list_active ───→ {events: [{name: "IPL Fever", ...}]}
└─ get_personalized_missions ─→ {missions: [comfort, stretch, social, discovery]}
```

### Step 3: After a Cricket Match

```
player_event_submit ──────────→ {
  {game_id,                       fan_out_results: {
   event_type: "match_complete",    achievements: {updated: true},
   event_data: {                    season_pass: {xp_added: 87},
     score: 87,                     weekly_goals: {updated: [...]},
     wickets: 3,                    daily_missions: {updated: [...]},
     overs: 20,                     mastery: {xp_added: 87}
     result: "won"                },
   }}                             rewards_earned: [{...}]
                                }
```

### Step 4: Claiming Rewards

```
daily_rewards_claim ──────────→ {reward: {tokens: 50}, walletGranted: {coins: 50}}
claim_mission_reward ─────────→ {rewards: {tokens: 100}, walletGranted: {coins: 100}}
weekly_goals_claim_reward ────→ {reward: {coins: 200, gems: 20}, walletGranted: {coins: 200, gems: 20}}
```

### Step 5: App Close

```
analytics_log_event ──────────→ {success}  // session_end, computes duration
winback_record_session ───────→ {success}  // keeps last-session timestamp fresh
```

---

## 5. What Works Out of the Box vs. What Needs Config

### Works Immediately (No Setup)

| Feature | Notes |
|---------|-------|
| Identity & wallets | Auto-created on first call |
| Basic leaderboard | Auto-created on first score submission |
| Daily rewards | Generic reward tiers work for any game |
| Daily missions | Generic mission types |
| Weekly goals | Generic goal types |
| Season pass | Generic XP/levels |
| Monthly milestones | Generic milestones |
| Achievements | Need definitions created via `achievements_create_definition` |
| Social (friends, challenges, groups, chat) | All game-agnostic |
| Live ops | Flash events, mystery boxes, etc. — need to be created via admin RPCs |
| Analytics | All tracking starts on first event |
| Event pipeline | Fan-out works immediately |
| Matchmaking | Works with any game_id |

### Needs One-Time Setup

| Feature | What to do |
|---------|-----------|
| Time-period leaderboards | Register game in IntelliVerse → `sync_game_registry` → `create_time_period_leaderboards` |
| Custom reward config | Add cricket entry to `GAME_REWARD_CONFIGS` in index.js |
| Achievement definitions | Call `achievements_bulk_create` with cricket-specific achievements |
| Tournament schedule | Call `tournament_create` to set up tournaments |
| Flash events | Call `flash_event_create` to create events |
| Onboarding steps | Configure step IDs meaningful to cricket |

### Not Available for Cricket

| Feature | Why |
|---------|-----|
| `quizverse_*` RPCs | QuizVerse-specific, hardcoded to accept `gameID: "quizverse"` only |
| `lasttolive_*` RPCs | LastToLive-specific, hardcoded to accept `gameID: "lasttolive"` only |
| Knowledge map, streak quiz, adaptive difficulty | QuizVerse depth module — quiz-specific |
| Weapon mastery, nemesis, bounties, loadouts | LastToLive depth module — survival-specific |
| Compatibility quiz | Valentine's Day feature for QuizVerse |

---

## 6. Cricket-Specific Recommendations

### Achievement Ideas for Cricket

```javascript
// Call achievements_bulk_create with:
{
    "game_id": "YOUR_CRICKET_UUID",
    "achievements": [
        {"id": "first_match", "name": "First Over", "description": "Play your first match", "target": 1},
        {"id": "half_century", "name": "Half Century", "description": "Score 50 runs in a match", "target": 1},
        {"id": "century", "name": "Centurion", "description": "Score 100 runs in a match", "target": 1},
        {"id": "double_century", "name": "Double Centurion", "description": "Score 200 runs", "target": 1},
        {"id": "hat_trick", "name": "Hat Trick Hero", "description": "Take 3 wickets in a row", "target": 1},
        {"id": "five_wickets", "name": "Fifer", "description": "Take 5 wickets in an innings", "target": 1},
        {"id": "win_streak_5", "name": "Winning Streak", "description": "Win 5 matches in a row", "target": 5},
        {"id": "win_streak_10", "name": "Unbeatable", "description": "Win 10 matches in a row", "target": 10},
        {"id": "matches_50", "name": "Seasoned Player", "description": "Play 50 matches", "target": 50},
        {"id": "matches_100", "name": "Veteran", "description": "Play 100 matches", "target": 100},
        {"id": "social_5_friends", "name": "Cricket Club", "description": "Add 5 friends", "target": 5},
        {"id": "tournament_winner", "name": "Champion", "description": "Win a tournament", "target": 1}
    ]
}
```

### Event Pipeline Usage

After every cricket match, call `player_event_submit` with cricket-relevant data:

```javascript
// After a cricket match
{
    "game_id": "YOUR_CRICKET_UUID",
    "event_type": "match_complete",
    "event_data": {
        "score": 87,            // Runs scored
        "wickets": 3,           // Wickets taken
        "overs": 20,            // Overs played
        "result": "won",        // won/lost/draw
        "match_type": "t20",    // t20/odi/test
        "boundaries": 8,        // Fours hit
        "sixes": 4,             // Sixes hit
        "catches": 2,           // Catches taken
        "run_rate": 8.5,        // Run rate
        "opponent_id": "..."    // For multiplayer
    }
}
```

### Group/Clan Ideas for Cricket

```javascript
// Create a cricket team/clan
{
    "game_id": "YOUR_CRICKET_UUID",
    "name": "Mumbai Indians Fan Club",
    "description": "Cricket fans unite!"
}

// Create a group quest during IPL season
{
    "group_id": "...",
    "quest_name": "IPL Fever - Score 10000 runs as a team",
    "target_type": "total_runs",
    "target_value": 10000,
    "duration_hours": 168  // 1 week
}
```

### Live Ops Ideas for Cricket

```javascript
// IPL Flash Event
{
    "game_id": "YOUR_CRICKET_UUID",
    "event_name": "IPL Double XP Weekend",
    "event_type": "double_xp",
    "multiplier": 2.0,
    "duration_minutes": 2880,  // 48 hours
    "description": "Celebrate IPL with double XP on all matches!"
}

// World Cup Happy Hour
{
    "game_id": "YOUR_CRICKET_UUID",
    "event_name": "World Cup Happy Hour",
    "event_type": "happy_hour",
    "multiplier": 1.5,
    "duration_minutes": 120
}
```

---

## 7. Proof-Check: Testing Each RPC

Use this checklist to verify each RPC works with your cricket game_id.

### Test via cURL (HTTP Key Auth)

```bash
# Replace GAME_ID with your cricket UUID
GAME_ID="c1234567-cric-ket0-game-000000000001"
HOST="http://localhost:7350"
KEY="defaulthttpkey"

# 1. Create identity
curl -s "$HOST/v2/rpc/create_or_sync_user?http_key=$KEY" \
  -d '{"device_id":"test-cricket-device-001","game_id":"'$GAME_ID'","username":"CricketFan1"}'

# 2. Create wallet
curl -s "$HOST/v2/rpc/create_player_wallet?http_key=$KEY" \
  -d '{"device_id":"test-cricket-device-001","game_id":"'$GAME_ID'"}'

# 3. Submit a score
curl -s "$HOST/v2/rpc/submit_score_and_sync?http_key=$KEY" \
  -d '{"device_id":"test-cricket-device-001","game_id":"'$GAME_ID'","score":87}'

# 4. Get leaderboard
curl -s "$HOST/v2/rpc/get_all_leaderboards?http_key=$KEY" \
  -d '{"game_id":"'$GAME_ID'"}'

# 5. Event pipeline
curl -s "$HOST/v2/rpc/player_event_submit?http_key=$KEY" \
  -d '{"game_id":"'$GAME_ID'","event_type":"match_complete","event_data":{"score":87,"wickets":3}}'

# 6. Check pending rewards
curl -s "$HOST/v2/rpc/rewards_pending?http_key=$KEY" \
  -d '{"game_id":"'$GAME_ID'"}'
```

### Test via MCP (Developer Flow)

If the MCP server is connected, you can test with natural language:

- *"Create a test cricket player and submit a score of 150"*
- *"What's the cricket leaderboard look like?"*
- *"Run a game health report for cricket"*
- *"Check economy health for the cricket game"*

### Verification Checklist

| # | Test | RPC | Expected | Pass? |
|---|------|-----|----------|-------|
| 1 | Create player | `create_or_sync_user` | `{success: true, userId: "..."}` | |
| 2 | Create wallet | `create_player_wallet` | `{success: true, wallets: {...}}` | |
| 3 | Get wallet | `wallet_get_all` | `{success: true, ...}` | |
| 4 | Submit score | `submit_score_and_sync` | `{success: true, ...}` | |
| 5 | Get leaderboard | `get_all_leaderboards` | `{success: true, ...}` | |
| 6 | Daily reward status | `daily_rewards_get_status` | `{success: true, streak: ...}` | |
| 7 | Claim daily reward | `daily_rewards_claim` | `{success: true, walletGranted: {...}}` | |
| 8 | Get missions | `get_daily_missions` | `{success: true, missions: [...]}` | |
| 9 | Event pipeline | `player_event_submit` | `{success: true, fan_out_results: {...}}` | |
| 10 | Pending rewards | `rewards_pending` | `{unclaimed: [...]}` | |
| 11 | Weekly goals | `weekly_goals_get_status` | `{success: true, goals: {...}}` | |
| 12 | Season pass | `season_pass_get_status` | `{success: true, ...}` | |
| 13 | Achievements | `achievements_get_all` | `{success: true, ...}` | |
| 14 | Flash events | `flash_event_list_active` | `{success: true, events: [...]}` | |
| 15 | Matchmaking | `matchmaking_find_match` | `{success: true, ticket_id: ...}` | |
| 16 | Friends list | `friends_list` | `{success: true, friends: [...]}` | |
| 17 | Create group | `create_game_group` | `{success: true, group_id: ...}` | |
| 18 | Analytics dashboard | `analytics_dashboard` | `{success: true, dau: ...}` | |
| 19 | Engagement score | `analytics_engagement_score` | `{success: true, engagement_score: ...}` | |
| 20 | Smart recommendations | `get_smart_recommendations` | `{success: true, recommendations: [...]}` | |

---

## 8. Known Limitations

### Payload Field Name Inconsistency

| Older RPCs (copilot era) | Newer RPCs | Notes |
|--------------------------|-----------|-------|
| `gameId` (camelCase) | `game_id` (snake_case) | Both work for their respective RPCs |
| `userId` | `user_id` | Same — check individual RPC docs |
| `gameID` | `game_id` | `gameID` only for quizverse/lasttolive legacy RPCs |

### The `quizverse_*` / `lasttolive_*` Lock

The legacy multi-game RPCs (`quizverse_update_user_profile`, `quizverse_grant_currency`, etc.) use a `parseAndValidateGamePayload` that **only accepts** `gameID: "quizverse"` or `gameID: "lasttolive"`. These RPCs are NOT usable for cricket.

However, the newer version in `multigame_rpcs.js` accepts any valid UUID via `gameUUID`. If the server is updated to use the newer parser, these would work for cricket too.

### Default Reward Config

Without a cricket-specific entry in `GAME_REWARD_CONFIGS`, the default config applies:
- 10% of score → coins (no cap)
- No bonus thresholds
- No streak multipliers

This is fine for development but should be tuned for production.

---

## 9. What's NOT Available for Cricket (Yet)

These are features that would need **new cricket-specific RPCs** to be built:

| Feature | QuizVerse Equivalent | Cricket Version (To Build) |
|---------|---------------------|---------------------------|
| Knowledge map | `quizverse_knowledge_map` | Batting/bowling/fielding skill breakdown |
| Adaptive difficulty | `quizverse_adaptive_difficulty` | Match difficulty based on skill |
| Streak mode | `quizverse_streak_quiz` | Batting streak (consecutive boundaries) |
| Daily puzzle | `quizverse_daily_puzzle` | Daily cricket challenge |
| Study mode | `quizverse_study_mode` | Practice nets |
| Category war | `quizverse_category_war` | Country vs country competition |
| Weapon mastery | `lasttolive_weapon_mastery` | Batting/bowling shot mastery |
| Nemesis | `lasttolive_nemesis_get` | Rival bowler/batsman tracking |
| Highlight reel | `lasttolive_highlight_reel` | Best innings, best bowling figures |
| Bounties | `lasttolive_bounty_create` | Bounties on rival players |
| Loadouts | `lasttolive_loadout_save` | Team/batting order presets |

These would follow the same pattern — create `data/modules/cricket_depth/cricket_depth.js` with `cricket_*` RPCs and wire into index.js.

---

## Total RPC Count for Cricket

| Category | Available RPCs | Status |
|----------|---------------|--------|
| Identity & Profile | 6 | Ready |
| Wallet & Economy | 8 | Ready |
| Leaderboards | 6 | Ready (needs leaderboard creation) |
| Daily Rewards | 2 | Ready |
| Daily Missions | 3 | Ready |
| Weekly Goals | 4 | Ready |
| Season Pass | 5 | Ready |
| Monthly Milestones | 4 | Ready |
| Achievements | 4 | Ready (needs definitions) |
| Progression & Unlocks | 7 | Ready |
| Event Pipeline | 2 | Ready |
| Social | 18 | Ready |
| Groups & Chat | 12 | Ready |
| Live Ops | 9 | Ready |
| Personalization | 2 | Ready |
| Matchmaking & Tournaments | 11 | Ready |
| Onboarding & Retention | 22 | Ready |
| Cross-Game | 5 | Ready |
| Analytics | 9 | Ready |
| **Total available for Cricket** | **~139** | **All generic RPCs** |
| Cricket-specific depth (not built) | 0 | Future |
| QuizVerse-only (not usable) | ~40 | Locked to QuizVerse |
| LastToLive-only (not usable) | ~40 | Locked to LastToLive |
