# Game-Specific RPC Quick Reference

## Understanding Game Identification

### For NEW Games (Custom Games from External Registry)
Use the game UUID from the external API:
```json
{
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
// OR
{
  "gameUUID": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
```

### For LEGACY Games (Built-in Games)
Use the hard-coded game name:
```json
{
  "gameID": "quizverse"  // or "lasttolive"
}
```

## Required RPCs by Game Type

### QuizVerse-Specific RPCs

#### Player Management
```javascript
// Update profile
RPC: quizverse_update_user_profile
Payload: { "gameID": "quizverse", "displayName": "Player1", "level": 5, "xp": 1000 }

// Save player data
RPC: quizverse_save_player_data
Payload: { "gameID": "quizverse", "key": "progress", "value": {...} }

// Load player data
RPC: quizverse_load_player_data
Payload: { "gameID": "quizverse", "key": "progress" }
```

#### Quiz-Specific
```javascript
// Get quiz categories
RPC: quizverse_get_quiz_categories
Payload: { "gameID": "quizverse" }

// Submit quiz score with validation
RPC: quizverse_submit_score
Payload: {
  "gameID": "quizverse",
  "score": 850,
  "answersCount": 10,
  "completionTime": 120
}

// Get quiz leaderboard
RPC: quizverse_get_leaderboard
Payload: { "gameID": "quizverse", "limit": 10 }
```

#### Economy
```javascript
// Grant currency
RPC: quizverse_grant_currency
Payload: { "gameID": "quizverse", "amount": 100 }

// Spend currency
RPC: quizverse_spend_currency
Payload: { "gameID": "quizverse", "amount": 50 }

// Validate purchase
RPC: quizverse_validate_purchase
Payload: { "gameID": "quizverse", "itemId": "hint_pack", "price": 25 }
```

#### Inventory
```javascript
// Grant item
RPC: quizverse_grant_item
Payload: { "gameID": "quizverse", "itemId": "power_up_2x", "quantity": 5 }

// Consume item
RPC: quizverse_consume_item
Payload: { "gameID": "quizverse", "itemId": "hint", "quantity": 1 }

// List inventory
RPC: quizverse_list_inventory
Payload: { "gameID": "quizverse" }
```

---

### LastToLive-Specific RPCs

#### Player Management
```javascript
// Update profile
RPC: lasttolive_update_user_profile
Payload: { "gameID": "lasttolive", "displayName": "Survivor1", "level": 15, "xp": 5000 }

// Save player data
RPC: lasttolive_save_player_data
Payload: { "gameID": "lasttolive", "key": "loadout", "value": {...} }

// Load player data
RPC: lasttolive_load_player_data
Payload: { "gameID": "lasttolive", "key": "loadout" }
```

#### Survival-Specific
```javascript
// Get weapon stats
RPC: lasttolive_get_weapon_stats
Payload: { "gameID": "lasttolive" }

// Submit survival score with metrics
RPC: lasttolive_submit_score
Payload: {
  "gameID": "lasttolive",
  "kills": 10,
  "timeSurvivedSec": 600,
  "damageTaken": 250,
  "damageDealt": 1500,
  "reviveCount": 2
}
// Score calculated as: (timeSurvivedSec * 10) + (kills * 500) - (damageTaken * 0.1)

// Get survivor leaderboard
RPC: lasttolive_get_leaderboard
Payload: { "gameID": "lasttolive", "limit": 10 }
```

#### Economy
```javascript
// Grant currency
RPC: lasttolive_grant_currency
Payload: { "gameID": "lasttolive", "amount": 500 }

// Spend currency
RPC: lasttolive_spend_currency
Payload: { "gameID": "lasttolive", "amount": 200 }

// Validate purchase
RPC: lasttolive_validate_purchase
Payload: { "gameID": "lasttolive", "itemId": "weapon_upgrade", "price": 150 }
```

#### Inventory
```javascript
// Grant item (weapons, armor, consumables)
RPC: lasttolive_grant_item
Payload: { "gameID": "lasttolive", "itemId": "medkit", "quantity": 3 }

// Consume item
RPC: lasttolive_consume_item
Payload: { "gameID": "lasttolive", "itemId": "medkit", "quantity": 1 }

// List inventory
RPC: lasttolive_list_inventory
Payload: { "gameID": "lasttolive" }
```

---

### Custom Game RPCs (Any New Game)

For new games from the external registry, use the same RPC names with your game UUID:

```javascript
// Use QuizVerse-style RPCs for any game
RPC: quizverse_update_user_profile
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",  // Your game UUID
  "displayName": "Player1"
}

// All QuizVerse RPCs work with custom games:
// - quizverse_update_user_profile
// - quizverse_grant_currency
// - quizverse_spend_currency
// - quizverse_grant_item
// - quizverse_consume_item
// - quizverse_list_inventory
// - quizverse_save_player_data
// - quizverse_load_player_data
// - quizverse_claim_daily_reward
// - quizverse_find_friends
// - quizverse_guild_create
// - quizverse_guild_join
// - quizverse_guild_leave
// - quizverse_log_event
// - quizverse_track_session_start
// - quizverse_track_session_end
```

---

## Universal RPCs (All Games)

### Time-Period Leaderboards
```javascript
// Create leaderboards for all games (run once during setup)
RPC: create_time_period_leaderboards
Payload: {}

// Submit score to all time periods (daily, weekly, monthly, alltime)
RPC: submit_score_to_time_periods
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1",  // Any game UUID
  "score": 1500,
  "subscore": 0,
  "metadata": { "level": 5 }
}

// Get time-period leaderboard
RPC: get_time_period_leaderboard
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "period": "weekly",  // "daily", "weekly", "monthly", "alltime"
  "limit": 10
}

// Get global leaderboard (all games combined)
RPC: get_time_period_leaderboard
Payload: {
  "scope": "global",
  "period": "weekly",
  "limit": 10
}
```

### Game Registry
```javascript
// Get all registered games
RPC: get_game_registry
Payload: {}

// Get specific game metadata
RPC: get_game_by_id
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
```

---

## Common Patterns

### Daily Rewards Flow
```javascript
// 1. Claim daily reward
RPC: quizverse_claim_daily_reward  // or lasttolive_claim_daily_reward
Payload: { "gameID": "your-game-id" }

Response: {
  "success": true,
  "data": {
    "rewardAmount": 150,
    "streak": 5,
    "nextReward": 160
  }
}

// 2. Grant the reward to wallet
RPC: quizverse_grant_currency
Payload: { "gameID": "your-game-id", "amount": 150 }
```

### Item Purchase Flow
```javascript
// 1. Validate purchase
RPC: quizverse_validate_purchase
Payload: { "gameID": "your-game-id", "itemId": "sword", "price": 100 }

Response: {
  "success": true,
  "data": { "canPurchase": true, "balance": 500 }
}

// 2. Spend currency
RPC: quizverse_spend_currency
Payload: { "gameID": "your-game-id", "amount": 100 }

// 3. Grant item
RPC: quizverse_grant_item
Payload: { "gameID": "your-game-id", "itemId": "sword", "quantity": 1 }
```

### Session Tracking Flow
```javascript
// On game start
RPC: quizverse_track_session_start
Payload: {
  "gameID": "your-game-id",
  "deviceInfo": { "platform": "iOS", "version": "1.0" }
}

Response: {
  "success": true,
  "data": { "sessionKey": "session_userId_timestamp" }
}

// On game end
RPC: quizverse_track_session_end
Payload: {
  "gameID": "your-game-id",
  "sessionKey": "session_userId_timestamp",
  "duration": 3600
}
```

---

## Storage Organization by Game

### QuizVerse Storage
```
quizverse_profiles
quizverse_wallets
quizverse_inventory
quizverse_player_data
quizverse_daily_rewards
quizverse_analytics
quizverse_categories
quizverse_config
```

### LastToLive Storage
```
lasttolive_profiles
lasttolive_wallets
lasttolive_inventory
lasttolive_player_data
lasttolive_daily_rewards
lasttolive_analytics
lasttolive_weapon_stats
lasttolive_config
```

### Custom Game Storage
```
<gameUUID>_profiles
<gameUUID>_wallets
<gameUUID>_inventory
<gameUUID>_player_data
<gameUUID>_daily_rewards
<gameUUID>_analytics
<gameUUID>_config
```

### Shared Storage
```
game_registry              - All games metadata
game_wallets               - All game wallets
leaderboards_registry      - All leaderboards metadata
```

---

## Anti-Cheat Validations

### QuizVerse
- Max score per answer: 100 points
- Min time per question: 1 second
- Score cannot exceed: answersCount × 100

### LastToLive
- Max kills per minute: 10
- Max damage dealt per second: 1000
- Negative scores set to 0

---

## Testing Checklist

### For QuizVerse Games
- [ ] Create player profile
- [ ] Submit quiz score with validation
- [ ] Grant and spend currency
- [ ] Manage inventory items
- [ ] Claim daily rewards
- [ ] Get quiz categories
- [ ] View leaderboard

### For LastToLive Games
- [ ] Create player profile
- [ ] Submit survival score with metrics
- [ ] Grant and spend currency
- [ ] Manage weapon/armor inventory
- [ ] Claim daily rewards
- [ ] Get weapon stats
- [ ] View survivor leaderboard

### For Any Custom Game
- [ ] Verify game in registry
- [ ] Create player profile
- [ ] Submit score to time-period leaderboards
- [ ] Manage economy (currency + items)
- [ ] Implement daily rewards
- [ ] Track sessions
- [ ] Log analytics events
- [ ] Test guild system
- [ ] Verify data in Nakama Admin Console
