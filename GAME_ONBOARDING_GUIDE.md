# Game Onboarding Guide for Nakama

## Overview

This guide explains how to onboard a new game to the Nakama backend platform. It covers the complete process from game registration to RPC integration.

## Terminology

**Important**: Understanding the difference between these terms is critical:

- **gameId / gameUUID**: The unique identifier (UUID format) from the external game registry API (e.g., `33b245c8-a23f-4f9c-a06e-189885cc22a1`)
- **gameTitle**: The human-readable game name from the external API (e.g., "QuizVerse", "Last To Live", "Test")
- **gameID** (legacy): Hard-coded game names for built-in games only ("quizverse", "lasttolive") - used for backward compatibility

### External Game Registry API

Games are registered in the external IntelliVerse platform API:
```
GET https://gaming.intelli-verse-x.ai/api/games/games/all
```

Example response:
```json
{
  "status": true,
  "message": "All games list retrieved successfully",
  "data": [
    {
      "id": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
      "gameTitle": "Test",
      "gameDescription": "Test description",
      "logoUrl": "https://...",
      "videoUrl": "https://...",
      "coverPhotos": ["https://..."],
      "zipFileUrl": "https://...",
      "status": "draft",
      "createdAt": "2025-11-14T12:08:09.772Z",
      "updatedAt": "2025-11-14T12:08:09.772Z",
      "gameCategories": ["Adventure", "Action"],
      "userId": "69f640e8-180a-4908-a484-926688fc0498",
      "userName": "support_yaq4q0"
    }
  ]
}
```

## Onboarding Process

### Step 1: Sync Game Metadata

Run the leaderboard creation RPC which automatically syncs game metadata from the external API:

```javascript
// RPC: create_time_period_leaderboards
// No payload required - automatically fetches from external API
```

This RPC performs the following:
1. Authenticates with IntelliVerse API using OAuth2
2. Fetches all games from the external registry
3. Stores game metadata in Nakama storage (`game_registry` collection)
4. Creates time-period leaderboards (daily, weekly, monthly, alltime) for each game
5. Creates global ecosystem leaderboards

**Storage Structure**:
```javascript
Collection: "game_registry"
Key: "all_games"
Value: {
  games: [
    {
      gameId: "UUID",              // From external API 'id' field
      gameTitle: "Game Name",      // From external API 'gameTitle' field
      gameDescription: "...",
      logoUrl: "...",
      status: "active",
      categories: ["Category1"],
      createdAt: "ISO8601",
      updatedAt: "ISO8601"
    }
  ],
  lastUpdated: "ISO8601",
  totalGames: 5
}
```

### Step 2: Verify Game Registration

Use the game registry RPCs to verify your game is registered:

```javascript
// Get all games
RPC: get_game_registry
Payload: {}
Response: {
  success: true,
  games: [...],
  totalGames: 5,
  lastUpdated: "2025-11-16T..."
}

// Get specific game
RPC: get_game_by_id
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
Response: {
  success: true,
  game: {
    gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
    gameTitle: "Test",
    ...
  }
}
```

### Step 3: Verify Leaderboards

Check that leaderboards were created for your game:

```javascript
RPC: get_time_period_leaderboard
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "period": "daily"  // or "weekly", "monthly", "alltime"
}
```

## Core RPCs Required for Each Game

### 1. Player Identity & Wallet Management

**Multi-game RPCs** support both legacy games (gameID) and new games (gameUUID):

```javascript
// Works for both legacy ("quizverse", "lasttolive") and new games (UUID)
RPC: quizverse_update_user_profile  // Or use game-specific equivalent
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",  // Use gameUUID for new games
  "displayName": "PlayerName",
  "avatar": "url",
  "level": 10,
  "xp": 1500
}

// Alternative for new games using gameUUID field
Payload: {
  "gameUUID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "displayName": "PlayerName"
}
```

### 2. Wallet Operations

**Grant Currency**:
```javascript
RPC: quizverse_grant_currency
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "amount": 100
}

Storage: 
Collection: "game_wallets"
Key: "wallet:<deviceId>:<gameId>"
```

**Spend Currency**:
```javascript
RPC: quizverse_spend_currency
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "amount": 50
}
```

### 3. Inventory Management

**Grant Item**:
```javascript
RPC: quizverse_grant_item
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "itemId": "sword_legendary",
  "quantity": 1,
  "metadata": {
    "rarity": "legendary",
    "level": 5
  }
}

Storage:
Collection: "<gameId>_inventory"
Key: "inv_<userId>"
```

**Consume Item**:
```javascript
RPC: quizverse_consume_item
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "itemId": "potion_health",
  "quantity": 1
}
```

**List Inventory**:
```javascript
RPC: quizverse_list_inventory
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}
```

### 4. Leaderboard Integration

**Submit Score**:
```javascript
// Time-period leaderboards (recommended)
RPC: submit_score_to_time_periods
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "score": 1500,
  "subscore": 0,
  "metadata": {
    "level": 5,
    "completionTime": 120
  }
}

// This writes to ALL time periods (daily, weekly, monthly, alltime) 
// AND global ecosystem leaderboards
```

**Get Leaderboard**:
```javascript
RPC: get_time_period_leaderboard
Payload: {
  "gameId": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "period": "weekly",
  "limit": 10
}
```

### 5. Player Data Storage

**Save Player Data**:
```javascript
RPC: quizverse_save_player_data
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "key": "player_progress",
  "value": {
    "currentLevel": 10,
    "unlockedLevels": [1,2,3,4,5,6,7,8,9,10],
    "achievements": ["first_win", "speed_demon"]
  }
}

Storage:
Collection: "<gameId>_player_data"
Key: "<key>"
```

**Load Player Data**:
```javascript
RPC: quizverse_load_player_data
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "key": "player_progress"
}
```

### 6. Daily Rewards

**Claim Daily Reward**:
```javascript
RPC: quizverse_claim_daily_reward
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}

Response: {
  "success": true,
  "data": {
    "rewardAmount": 150,
    "streak": 5,
    "nextReward": 160
  }
}

Storage:
Collection: "<gameId>_daily_rewards"
Key: "daily_<userId>"
```

### 7. Social Features

**Find Friends**:
```javascript
RPC: quizverse_find_friends
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "query": "PlayerName",
  "limit": 20
}
```

### 8. Analytics & Telemetry

**Log Event**:
```javascript
RPC: quizverse_log_event
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "eventName": "level_completed",
  "properties": {
    "level": 5,
    "score": 1500,
    "time": 120
  }
}

Storage:
Collection: "<gameId>_analytics"
Key: "event_<userId>_<timestamp>"
```

**Track Sessions**:
```javascript
// Session Start
RPC: quizverse_track_session_start
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "deviceInfo": {
    "platform": "iOS",
    "version": "1.0.0"
  }
}

// Session End
RPC: quizverse_track_session_end
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "sessionKey": "session_<userId>_<timestamp>",
  "duration": 3600
}
```

### 9. Guilds/Clans

**Create Guild**:
```javascript
RPC: quizverse_guild_create
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "name": "Elite Warriors",
  "description": "Top players only",
  "open": true,
  "maxCount": 50
}
```

**Join/Leave Guild**:
```javascript
RPC: quizverse_guild_join
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "guildId": "<group_id>"
}

RPC: quizverse_guild_leave
Payload: {
  "gameID": "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  "guildId": "<group_id>"
}
```

## Storage Collections by Game

All game-specific data is stored in namespaced collections using the gameId:

```
<gameId>_profiles          - Player profiles
<gameId>_wallets           - Per-game wallets
<gameId>_inventory         - Player inventories
<gameId>_player_data       - Custom player data
<gameId>_daily_rewards     - Daily reward state
<gameId>_sessions          - Session tracking
<gameId>_analytics         - Analytics events
<gameId>_catalog           - Item catalog
<gameId>_categories        - Quiz categories (QuizVerse-specific)
<gameId>_weapon_stats      - Weapon stats (LastToLive-specific)
<gameId>_config            - Server configuration

game_wallets               - All game wallets (unified collection)
game_registry              - Game metadata from external API
leaderboards_registry      - Leaderboard metadata
```

## Leaderboard Naming Convention

For each game, the following leaderboards are created:

```
leaderboard_<gameId>_daily      - Daily leaderboard
leaderboard_<gameId>_weekly     - Weekly leaderboard
leaderboard_<gameId>_monthly    - Monthly leaderboard
leaderboard_<gameId>_alltime    - All-time leaderboard

leaderboard_global_daily        - Global ecosystem (all games)
leaderboard_global_weekly
leaderboard_global_monthly
leaderboard_global_alltime
```

## Metadata in Storage Objects

All storage objects should include game identification:

```javascript
{
  gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",  // UUID from registry
  gameTitle: "Test Game",                          // Human-readable name
  // ... other data
  createdAt: "2025-11-16T...",
  updatedAt: "2025-11-16T..."
}
```

Leaderboard metadata example:
```javascript
{
  gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  gameTitle: "Test Game",
  scope: "game",
  timePeriod: "weekly",
  resetSchedule: "0 0 * * 0",
  description: "Weekly Leaderboard for Test Game",
  createdAt: "2025-11-16T..."
}
```

## Nakama Admin Console

After onboarding, you can view game data in the Nakama Admin Console:

1. **Storage Browser**: View collections organized by gameId
2. **Leaderboards**: View all game and global leaderboards with metadata
3. **Users**: View player profiles with game-specific data
4. **Groups**: View guilds/clans filtered by gameId metadata

## Migration from Legacy Games

For existing games using hard-coded gameID ("quizverse", "lasttolive"):

1. These continue to work with the legacy gameID
2. Multi-game RPCs support both `gameID` and `gameUUID` fields
3. New games should use UUID from external registry
4. Storage collections remain namespaced by the identifier used

## Best Practices

1. **Always use gameId (UUID)** from the external registry for new games
2. **Include gameTitle** in metadata for human readability in admin console
3. **Use time-period leaderboards** for automatic reset scheduling
4. **Store game-specific data** in namespaced collections
5. **Log analytics events** for player behavior tracking
6. **Implement session tracking** for engagement metrics
7. **Test with get_game_registry** before integrating

## Complete RPC Checklist for Game Onboarding

### Phase 1: Initial Setup
- [ ] Run `create_time_period_leaderboards` to sync game metadata
- [ ] Verify game in registry with `get_game_registry`
- [ ] Verify leaderboards with `get_time_period_leaderboard`

### Phase 2: Core Integration
- [ ] Implement player profile management (`update_user_profile`)
- [ ] Implement wallet operations (`grant_currency`, `spend_currency`)
- [ ] Implement inventory system (`grant_item`, `consume_item`, `list_inventory`)
- [ ] Implement score submission (`submit_score_to_time_periods`)
- [ ] Implement player data storage (`save_player_data`, `load_player_data`)

### Phase 3: Engagement Features
- [ ] Implement daily rewards (`claim_daily_reward`)
- [ ] Implement social features (`find_friends`)
- [ ] Implement guild system (`guild_create`, `guild_join`, `guild_leave`)

### Phase 4: Analytics
- [ ] Implement event logging (`log_event`)
- [ ] Implement session tracking (`track_session_start`, `track_session_end`)

### Phase 5: Testing
- [ ] Test all RPCs with actual gameId from registry
- [ ] Verify data appears correctly in Nakama Admin Console
- [ ] Test leaderboard submissions and retrieval
- [ ] Verify storage collections are properly namespaced

## Support

For issues or questions:
1. Check game is in registry: `get_game_registry`
2. Verify gameId matches external API
3. Check Nakama logs for RPC errors
4. Review storage collections in Admin Console
