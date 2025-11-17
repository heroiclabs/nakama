# Complete Nakama RPC Reference by GameID

**Last Updated**: November 16, 2025  
**Version**: 2.0.0

## Table of Contents

1. [Introduction](#introduction)
2. [GameID System](#gameid-system)
3. [Core Identity & Wallet RPCs](#core-identity--wallet-rpcs)
4. [Game-Specific RPCs](#game-specific-rpcs)
5. [Leaderboard RPCs](#leaderboard-rpcs)
6. [Social & Friends RPCs](#social--friends-rpcs)
7. [Chat & Messaging RPCs](#chat--messaging-rpcs)
8. [Groups & Guilds RPCs](#groups--guilds-rpcs)
9. [Daily Systems RPCs](#daily-systems-rpcs)
10. [Analytics RPCs](#analytics-rpcs)
11. [Push Notifications RPCs](#push-notifications-rpcs)
12. [Complete RPC List](#complete-rpc-list)

---

## Introduction

This document provides a complete reference for all RPCs available in the Nakama multi-game backend system. Each RPC is documented with:

- **Purpose**: What the RPC does
- **Required Parameters**: What you must provide
- **Optional Parameters**: Additional configuration options
- **Response Format**: What the RPC returns
- **Code Examples**: Unity C# implementation
- **GameID Usage**: How the RPC uses gameID for multi-game support

---

## GameID System

### Understanding GameID

Every game in the platform has a unique identifier called `gameID`. This is a UUID that isolates game data while allowing cross-game features.

**Format**: UUID v4 (e.g., `126bf539-dae2-4bcf-964d-316c0fa1f92b`)

### Built-in Game IDs

- **QuizVerse**: Uses gameID in all RPCs
- **LastToLive**: Uses gameID in all RPCs
- **Custom Games**: Register to get your unique gameID

### GameID vs Game UUID

- **Legacy gameID**: For built-in games ("quizverse", "lasttolive") - backward compatible
- **gameUUID**: For new custom games - UUID format
- **Implementation**: Both parameters supported, normalized internally

### How GameID Affects Data Isolation

```javascript
// Storage collections are namespaced by gameID
Collection: "{gameID}_profiles"
Collection: "{gameID}_wallets"
Collection: "{gameID}_player_data"

// Leaderboards are namespaced by gameID
Leaderboard: "leaderboard_{gameID}_daily"
Leaderboard: "leaderboard_{gameID}_weekly"
```

---

## Core Identity & Wallet RPCs

### 1. `create_or_sync_user`

**Purpose**: Creates or synchronizes user identity across the platform. This is the foundation RPC that must be called first.

**Required Parameters**:
```json
{
  "username": "string",
  "device_id": "string", 
  "game_id": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "created": false,
  "username": "Player123",
  "wallet_id": "550e8400-e29b-41d4-a716-446655440000",
  "global_wallet_id": "550e8400-e29b-41d4-a716-446655440001",
  "message": "User synced successfully"
}
```

**Unity Example**:
```csharp
public async Task<bool> CreateOrSyncUser(string username, string gameId)
{
    var payload = new
    {
        username = username,
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "create_or_sync_user", 
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

**GameID Usage**:
- Links user to specific game
- Creates game-specific wallet
- Stores identity in `identity_registry` collection
- Key: `{device_id}_{game_id}`

---

### 2. `create_or_get_wallet`

**Purpose**: Retrieves or creates both game-specific and global wallets for a user.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "game_wallet": {
    "wallet_id": "uuid",
    "device_id": "device-id",
    "game_id": "game-uuid",
    "balance": 1000,
    "currency": "coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "global_wallet": {
    "wallet_id": "uuid",
    "device_id": "device-id", 
    "game_id": "global",
    "balance": 5000,
    "currency": "global_coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

**Unity Example**:
```csharp
public async Task<(long gameBalance, long globalBalance)> GetWallets(string gameId)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "create_or_get_wallet",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<WalletResponse>(result.Payload);
    return (response.game_wallet.balance, response.global_wallet.balance);
}
```

**GameID Usage**:
- Game wallet: Isolated per gameID
- Global wallet: Shared across all games
- Storage key: `wallet_{user_id}_{game_id}` and `wallet_{user_id}_global`

---

### 3. `wallet_update_game_wallet`

**Purpose**: Updates game-specific wallet balance.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)",
  "balance": number
}
```

**Response**:
```json
{
  "success": true,
  "wallet": {
    "balance": 1500,
    "currency": "coins",
    "updated_at": "2024-01-01T00:00:00Z"
  }
}
```

**Unity Example**:
```csharp
public async Task<bool> UpdateGameWallet(string gameId, long newBalance)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        balance = newBalance
    };
    
    var result = await client.RpcAsync(session, "wallet_update_game_wallet",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

**GameID Usage**:
- Only affects wallet for specified gameID
- Other game wallets remain unchanged
- Global wallet unaffected

---

### 4. `wallet_update_global`

**Purpose**: Updates global wallet balance (shared across all games).

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)", 
  "balance": number
}
```

**Response**: Same as `wallet_update_game_wallet`

**GameID Usage**:
- gameID required for authentication
- Updates global wallet (not game-specific)
- Changes affect all games for this user

---

### 5. `wallet_transfer_between_game_wallets`

**Purpose**: Transfer currency between two different game wallets.

**Required Parameters**:
```json
{
  "device_id": "string",
  "from_game_id": "string (UUID)",
  "to_game_id": "string (UUID)",
  "amount": number
}
```

**Response**:
```json
{
  "success": true,
  "from_wallet": {
    "game_id": "game-uuid-1",
    "new_balance": 500
  },
  "to_wallet": {
    "game_id": "game-uuid-2",
    "new_balance": 1500
  },
  "transferred": 1000
}
```

**Unity Example**:
```csharp
public async Task<bool> TransferBetweenGames(string fromGameId, string toGameId, long amount)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        from_game_id = fromGameId,
        to_game_id = toGameId,
        amount = amount
    };
    
    var result = await client.RpcAsync(session, "wallet_transfer_between_game_wallets",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

**GameID Usage**:
- Enables cross-game currency transfers
- Deducts from source game wallet
- Adds to destination game wallet
- Both games must belong to same user

---

## Game-Specific RPCs

All game-specific RPCs follow the naming convention: `{gameid}_{action}`

### QuizVerse RPCs

#### 1. `quizverse_update_user_profile`

**Purpose**: Update player profile for QuizVerse.

**Required Parameters**:
```json
{
  "gameID": "quizverse" OR "game-uuid"
}
```

**Optional Parameters**:
```json
{
  "displayName": "string",
  "avatar": "string (URL)",
  "level": number,
  "xp": number,
  "metadata": object
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "displayName": "ProQuizzer",
    "avatar": "avatar_url",
    "level": 15,
    "xp": 3500,
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Unity Example**:
```csharp
public async Task<bool> UpdateProfile(string displayName, int level, int xp)
{
    var payload = new
    {
        gameID = gameId, // Your QuizVerse game UUID
        displayName = displayName,
        level = level,
        xp = xp
    };
    
    var result = await client.RpcAsync(session, "quizverse_update_user_profile",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

**GameID Usage**:
- Stores profile in `{gameID}_profiles` collection
- Key: `profile_{user_id}`
- Isolated per game

---

#### 2. `quizverse_grant_currency`

**Purpose**: Grant currency to player wallet.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "amount": number (positive integer)
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "balance": 1500,
    "amount": 500
  }
}
```

**Unity Example**:
```csharp
public async Task<long> GrantCurrency(int amount)
{
    var payload = new
    {
        gameID = gameId,
        amount = amount
    };
    
    var result = await client.RpcAsync(session, "quizverse_grant_currency",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<GrantCurrencyResponse>(result.Payload);
    return response.data.balance;
}
```

**GameID Usage**:
- Updates wallet in `{gameID}_wallets` collection
- Only affects this game's wallet

---

#### 3. `quizverse_spend_currency`

**Purpose**: Deduct currency from player wallet.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "amount": number (positive integer)
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "balance": 1000,
    "amount": 500
  }
}
```

**Error Response**:
```json
{
  "success": false,
  "error": "Insufficient balance"
}
```

**Unity Example**:
```csharp
public async Task<bool> SpendCurrency(int amount)
{
    try
    {
        var payload = new
        {
            gameID = gameId,
            amount = amount
        };
        
        var result = await client.RpcAsync(session, "quizverse_spend_currency",
            JsonConvert.SerializeObject(payload));
        
        var response = JsonConvert.DeserializeObject<SpendCurrencyResponse>(result.Payload);
        return response.success;
    }
    catch (Exception ex)
    {
        Debug.LogError($"Failed to spend currency: {ex.Message}");
        return false;
    }
}
```

**GameID Usage**:
- Checks balance in `{gameID}_wallets`
- Validates sufficient funds
- Only affects this game's wallet

---

#### 4. `quizverse_grant_item`

**Purpose**: Add item to player inventory.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "itemId": "string",
  "quantity": number
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "itemId": "powerup_double_points",
    "quantity": 5
  }
}
```

**Unity Example**:
```csharp
public async Task<bool> GrantItem(string itemId, int quantity)
{
    var payload = new
    {
        gameID = gameId,
        itemId = itemId,
        quantity = quantity
    };
    
    var result = await client.RpcAsync(session, "quizverse_grant_item",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<GrantItemResponse>(result.Payload);
    return response.success;
}
```

**GameID Usage**:
- Stores in `{gameID}_inventory` collection
- Key: `inventory_{user_id}`
- Items isolated per game

---

#### 5. `quizverse_consume_item`

**Purpose**: Remove/use item from player inventory.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "itemId": "string",
  "quantity": number
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "itemId": "powerup_double_points",
    "remainingQuantity": 3
  }
}
```

**Unity Example**:
```csharp
public async Task<int> ConsumeItem(string itemId, int quantity)
{
    var payload = new
    {
        gameID = gameId,
        itemId = itemId,
        quantity = quantity
    };
    
    var result = await client.RpcAsync(session, "quizverse_consume_item",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<ConsumeItemResponse>(result.Payload);
    return response.data.remainingQuantity;
}
```

**GameID Usage**:
- Updates `{gameID}_inventory`
- Validates item existence
- Only affects this game's inventory

---

#### 6. `quizverse_list_inventory`

**Purpose**: Get all items in player inventory.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "itemId": "powerup_double_points",
        "quantity": 5
      },
      {
        "itemId": "hint_50_50",
        "quantity": 3
      }
    ]
  }
}
```

**Unity Example**:
```csharp
public async Task<List<InventoryItem>> GetInventory()
{
    var payload = new { gameID = gameId };
    
    var result = await client.RpcAsync(session, "quizverse_list_inventory",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<InventoryResponse>(result.Payload);
    return response.data.items;
}
```

---

#### 7. `quizverse_save_player_data`

**Purpose**: Save custom player data to cloud storage.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "key": "string",
  "value": any
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "key": "player_settings",
    "saved": true
  }
}
```

**Unity Example**:
```csharp
public async Task<bool> SavePlayerData(string key, object value)
{
    var payload = new
    {
        gameID = gameId,
        key = key,
        value = value
    };
    
    var result = await client.RpcAsync(session, "quizverse_save_player_data",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<SaveDataResponse>(result.Payload);
    return response.success;
}

// Usage
await SavePlayerData("settings", new {
    soundVolume = 0.8f,
    musicVolume = 0.6f,
    difficulty = "hard"
});
```

**GameID Usage**:
- Stores in `{gameID}_player_data` collection
- Key: `{provided_key}`
- Fully isolated per game

---

#### 8. `quizverse_load_player_data`

**Purpose**: Load custom player data from cloud storage.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "key": "string"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "key": "player_settings",
    "value": {
      "soundVolume": 0.8,
      "musicVolume": 0.6,
      "difficulty": "hard"
    },
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

**Unity Example**:
```csharp
public async Task<T> LoadPlayerData<T>(string key)
{
    var payload = new
    {
        gameID = gameId,
        key = key
    };
    
    var result = await client.RpcAsync(session, "quizverse_load_player_data",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<LoadDataResponse>(result.Payload);
    return JsonConvert.DeserializeObject<T>(response.data.value.ToString());
}

// Usage
var settings = await LoadPlayerData<PlayerSettings>("settings");
```

---

### LastToLive RPCs

All LastToLive RPCs follow the same pattern as QuizVerse with `lasttolive_` prefix:

- `lasttolive_update_user_profile`
- `lasttolive_grant_currency`
- `lasttolive_spend_currency`
- `lasttolive_grant_item`
- `lasttolive_consume_item`
- `lasttolive_list_inventory`
- `lasttolive_save_player_data`
- `lasttolive_load_player_data`

**Usage**: Same as QuizVerse, just replace `quizverse_` with `lasttolive_` and use your LastToLive gameID.

---

## Leaderboard RPCs

### 1. `submit_score_and_sync`

**Purpose**: Submit score to ALL time-period leaderboards + sync wallet.

**Required Parameters**:
```json
{
  "username": "string",
  "device_id": "string",
  "game_id": "string (UUID)",
  "score": number
}
```

**Optional Parameters**:
```json
{
  "subscore": number,
  "metadata": object
}
```

**Response**:
```json
{
  "success": true,
  "results": [
    {
      "leaderboard_id": "leaderboard_game-uuid_daily",
      "scope": "game",
      "period": "daily",
      "new_rank": 5,
      "score": 1500
    },
    {
      "leaderboard_id": "leaderboard_game-uuid_weekly",
      "scope": "game",
      "period": "weekly",
      "new_rank": 12,
      "score": 1500
    }
  ],
  "wallet_sync": {
    "success": true,
    "new_balance": 1500
  }
}
```

**Unity Example**:
```csharp
public async Task<List<LeaderboardResult>> SubmitScore(int score, Dictionary<string, string> metadata = null)
{
    var payload = new
    {
        username = playerUsername,
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        score = score,
        subscore = 0,
        metadata = metadata
    };
    
    var result = await client.RpcAsync(session, "submit_score_and_sync",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<ScoreSubmissionResponse>(result.Payload);
    return response.results;
}
```

**GameID Usage**:
- Submits to: `leaderboard_{gameID}_daily`, `_weekly`, `_monthly`, `_alltime`
- Also submits to global leaderboards
- Syncs wallet in `{gameID}_wallets`

---

### 2. `get_all_leaderboards`

**Purpose**: Fetch ALL leaderboards (daily, weekly, monthly, alltime, global) in one call.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Optional Parameters**:
```json
{
  "limit": number (default: 50, max: 100)
}
```

**Response**:
```json
{
  "success": true,
  "daily": {
    "leaderboard_id": "leaderboard_game-uuid_daily",
    "records": [
      {
        "rank": 1,
        "owner_id": "user-uuid",
        "username": "TopPlayer",
        "score": 2500,
        "subscore": 0,
        "num_score": 1
      }
    ]
  },
  "weekly": { /* same structure */ },
  "monthly": { /* same structure */ },
  "alltime": { /* same structure */ },
  "global_alltime": { /* same structure */ },
  "player_ranks": {
    "daily_rank": 5,
    "weekly_rank": 12,
    "monthly_rank": 45,
    "alltime_rank": 234,
    "global_rank": 1567
  }
}
```

**Unity Example**:
```csharp
public async Task<AllLeaderboardsData> GetAllLeaderboards(int limit = 50)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        limit = limit
    };
    
    var result = await client.RpcAsync(session, "get_all_leaderboards",
        JsonConvert.SerializeObject(payload));
    
    return JsonConvert.DeserializeObject<AllLeaderboardsData>(result.Payload);
}

// Usage
var leaderboards = await GetAllLeaderboards(10);
Debug.Log($"Daily Top Player: {leaderboards.daily.records[0].username}");
Debug.Log($"My Daily Rank: {leaderboards.player_ranks.daily_rank}");
```

**GameID Usage**:
- Fetches from all `leaderboard_{gameID}_{period}` leaderboards
- Returns player rank across all periods
- Includes global cross-game leaderboard

---

### 3. Game-Specific Leaderboard RPCs

#### `quizverse_submit_score`

**Purpose**: Submit score specifically for QuizVerse leaderboards.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)",
  "score": number
}
```

**Optional Parameters**:
```json
{
  "subscore": number,
  "metadata": object
}
```

**Unity Example**:
```csharp
public async Task<bool> SubmitQuizScore(int score)
{
    var payload = new
    {
        gameID = gameId,
        score = score,
        metadata = new
        {
            questionsAnswered = 10,
            correctAnswers = 8,
            timeTaken = 120
        }
    };
    
    var result = await client.RpcAsync(session, "quizverse_submit_score",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

#### `quizverse_get_leaderboard`

**Purpose**: Get QuizVerse leaderboard rankings.

**Required Parameters**:
```json
{
  "gameID": "string (UUID)"
}
```

**Optional Parameters**:
```json
{
  "limit": number (1-100)
}
```

**Unity Example**:
```csharp
public async Task<List<LeaderboardRecord>> GetQuizLeaderboard(int limit = 10)
{
    var payload = new
    {
        gameID = gameId,
        limit = limit
    };
    
    var result = await client.RpcAsync(session, "quizverse_get_leaderboard",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<LeaderboardResponse>(result.Payload);
    return response.data.records;
}
```

---

## Daily Systems RPCs

### 1. `daily_reward_claim`

**Purpose**: Claim daily login reward with streak tracking.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "reward": {
    "amount": 150,
    "currency": "coins",
    "streak_day": 3,
    "next_reward": 160
  },
  "streak": {
    "current": 3,
    "best": 7,
    "last_claim_date": "2024-01-15"
  }
}
```

**Unity Example**:
```csharp
public async Task<DailyRewardData> ClaimDailyReward()
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "daily_reward_claim",
        JsonConvert.SerializeObject(payload));
    
    return JsonConvert.DeserializeObject<DailyRewardData>(result.Payload);
}
```

**GameID Usage**:
- Stores in `{gameID}_daily_rewards` collection
- Streak tracked per game
- Rewards isolated per gameID

---

### 2. `daily_reward_status`

**Purpose**: Check if daily reward is available without claiming.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "available": true,
  "streak": 3,
  "next_reward": 160,
  "hours_until_next": 12.5
}
```

**Unity Example**:
```csharp
public async Task<bool> IsDailyRewardAvailable()
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "daily_reward_status",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<DailyRewardStatusResponse>(result.Payload);
    return response.available;
}
```

---

### 3. `daily_missions_get`

**Purpose**: Get all daily missions for the current day.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Response**:
```json
{
  "success": true,
  "missions": [
    {
      "mission_id": "play_5_games",
      "title": "Play 5 Games",
      "description": "Complete 5 quiz games today",
      "progress": 2,
      "target": 5,
      "reward": 100,
      "completed": false
    },
    {
      "mission_id": "score_1000",
      "title": "Score 1000 Points",
      "description": "Reach a score of 1000 in any game",
      "progress": 750,
      "target": 1000,
      "reward": 150,
      "completed": false
    }
  ],
  "refresh_time": "2024-01-16T00:00:00Z"
}
```

**Unity Example**:
```csharp
public async Task<List<DailyMission>> GetDailyMissions()
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "daily_missions_get",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<DailyMissionsResponse>(result.Payload);
    return response.missions;
}
```

**GameID Usage**:
- Missions stored in `{gameID}_daily_missions`
- Progress tracked per game
- Rewards added to game wallet

---

### 4. `daily_missions_update_progress`

**Purpose**: Update progress for a specific mission.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)",
  "mission_id": "string",
  "progress": number
}
```

**Response**:
```json
{
  "success": true,
  "mission": {
    "mission_id": "play_5_games",
    "progress": 3,
    "target": 5,
    "completed": false,
    "auto_claimed": false
  }
}
```

**Unity Example**:
```csharp
public async Task<bool> UpdateMissionProgress(string missionId, int progress)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        mission_id = missionId,
        progress = progress
    };
    
    var result = await client.RpcAsync(session, "daily_missions_update_progress",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<MissionUpdateResponse>(result.Payload);
    return response.success;
}
```

---

### 5. `daily_missions_claim`

**Purpose**: Claim reward for completed mission.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)",
  "mission_id": "string"
}
```

**Response**:
```json
{
  "success": true,
  "mission": {
    "mission_id": "play_5_games",
    "completed": true,
    "claimed": true,
    "reward": 100
  },
  "wallet_updated": true,
  "new_balance": 1650
}
```

**Unity Example**:
```csharp
public async Task<long> ClaimMissionReward(string missionId)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        mission_id = missionId
    };
    
    var result = await client.RpcAsync(session, "daily_missions_claim",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<MissionClaimResponse>(result.Payload);
    return response.new_balance;
}
```

---

## Social & Friends RPCs

### 1. `friends_add`

**Purpose**: Send friend request to another player.

**Unity Example**:
```csharp
// Use native Nakama SDK
await client.AddFriendsAsync(session, new[] { friendUserId });
```

---

### 2. `friends_list`

**Purpose**: Get list of all friends.

**Required Parameters**:
```json
{
  "limit": number (optional, default: 100)
}
```

**Unity Example**:
```csharp
public async Task<List<Friend>> GetFriendsList()
{
    var payload = new { limit = 100 };
    
    var result = await client.RpcAsync(session, "friends_list",
        JsonConvert.SerializeObject(payload));
    
    return JsonConvert.DeserializeObject<FriendsListResponse>(result.Payload).friends;
}
```

---

### 3. `friends_challenge_user`

**Purpose**: Send game challenge to friend.

**Required Parameters**:
```json
{
  "friend_user_id": "string (UUID)",
  "game_id": "string (UUID)",
  "challenge_type": "string"
}
```

**Optional Parameters**:
```json
{
  "metadata": object
}
```

**Unity Example**:
```csharp
public async Task<bool> ChallengeFriend(string friendUserId, string challengeType)
{
    var payload = new
    {
        friend_user_id = friendUserId,
        game_id = gameId,
        challenge_type = challengeType,
        metadata = new
        {
            myScore = 1500,
            message = "Can you beat this?"
        }
    };
    
    var result = await client.RpcAsync(session, "friends_challenge_user",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

**GameID Usage**:
- Challenge stored with gameID
- Notifications sent via push system
- Challenge data isolated per game

---

## Chat & Messaging RPCs

### 1. `send_direct_message`

**Purpose**: Send direct message to another player.

**Required Parameters**:
```json
{
  "recipient_user_id": "string (UUID)",
  "message": "string"
}
```

**Unity Example**:
```csharp
public async Task<bool> SendDirectMessage(string recipientId, string message)
{
    var payload = new
    {
        recipient_user_id = recipientId,
        message = message
    };
    
    var result = await client.RpcAsync(session, "send_direct_message",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
    return response["success"].ToString() == "True";
}
```

---

### 2. `get_direct_message_history`

**Purpose**: Get message history with another player.

**Required Parameters**:
```json
{
  "other_user_id": "string (UUID)"
}
```

**Optional Parameters**:
```json
{
  "limit": number (default: 50)
}
```

**Unity Example**:
```csharp
public async Task<List<ChatMessage>> GetMessageHistory(string otherUserId, int limit = 50)
{
    var payload = new
    {
        other_user_id = otherUserId,
        limit = limit
    };
    
    var result = await client.RpcAsync(session, "get_direct_message_history",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<MessageHistoryResponse>(result.Payload);
    return response.messages;
}
```

---

## Groups & Guilds RPCs

### 1. `create_game_group`

**Purpose**: Create a guild/clan for a specific game.

**Required Parameters**:
```json
{
  "game_id": "string (UUID)",
  "group_name": "string",
  "description": "string"
}
```

**Unity Example**:
```csharp
public async Task<string> CreateGuild(string guildName, string description)
{
    var payload = new
    {
        game_id = gameId,
        group_name = guildName,
        description = description
    };
    
    var result = await client.RpcAsync(session, "create_game_group",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<CreateGroupResponse>(result.Payload);
    return response.group_id;
}
```

**GameID Usage**:
- Group scoped to gameID
- Metadata includes game_id
- Group wallet separate per game

---

### 2. `update_group_xp`

**Purpose**: Add XP to group/guild.

**Required Parameters**:
```json
{
  "group_id": "string (UUID)",
  "xp_amount": number
}
```

**Unity Example**:
```csharp
public async Task<long> AddGroupXP(string groupId, int xpAmount)
{
    var payload = new
    {
        group_id = groupId,
        xp_amount = xpAmount
    };
    
    var result = await client.RpcAsync(session, "update_group_xp",
        JsonConvert.SerializeObject(payload));
    
    var response = JsonConvert.DeserializeObject<GroupXPResponse>(result.Payload);
    return response.new_xp;
}
```

---

## Analytics RPCs

### 1. `analytics_log_event`

**Purpose**: Log custom analytics event.

**Required Parameters**:
```json
{
  "device_id": "string",
  "game_id": "string (UUID)",
  "event_name": "string"
}
```

**Optional Parameters**:
```json
{
  "properties": object
}
```

**Unity Example**:
```csharp
public async Task LogEvent(string eventName, Dictionary<string, object> properties = null)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        game_id = gameId,
        event_name = eventName,
        properties = properties ?? new Dictionary<string, object>()
    };
    
    var result = await client.RpcAsync(session, "analytics_log_event",
        JsonConvert.SerializeObject(payload));
}

// Usage
await LogEvent("level_complete", new Dictionary<string, object>
{
    { "level", 5 },
    { "score", 1500 },
    { "time_seconds", 120 }
});
```

**GameID Usage**:
- Events stored in `{gameID}_analytics` collection
- Segmented by game for analysis
- Includes timestamp and user info

---

## Push Notifications RPCs

### 1. `push_register_token`

**Purpose**: Register device for push notifications.

**Required Parameters**:
```json
{
  "device_id": "string",
  "platform": "ios" | "android" | "web" | "windows",
  "token": "string"
}
```

**Unity Example**:
```csharp
public async Task RegisterPushToken(string platform, string token)
{
    var payload = new
    {
        device_id = SystemInfo.deviceUniqueIdentifier,
        platform = platform,
        token = token
    };
    
    var result = await client.RpcAsync(session, "push_register_token",
        JsonConvert.SerializeObject(payload));
}
```

---

### 2. `push_send_event`

**Purpose**: Send push notification to user.

**Required Parameters**:
```json
{
  "user_id": "string (UUID)",
  "title": "string",
  "body": "string"
}
```

**Optional Parameters**:
```json
{
  "data": object,
  "game_id": "string (UUID)"
}
```

**Unity Example**:
```csharp
public async Task SendPushNotification(string userId, string title, string body)
{
    var payload = new
    {
        user_id = userId,
        title = title,
        body = body,
        game_id = gameId
    };
    
    var result = await client.RpcAsync(session, "push_send_event",
        JsonConvert.SerializeObject(payload));
}
```

**GameID Usage**:
- Notifications can be game-specific
- Deep linking includes gameID
- User can filter by game

---

## Complete RPC List

### Core System RPCs (71 total)

#### Identity & Wallet (9)
1. `create_or_sync_user`
2. `create_or_get_wallet`
3. `wallet_get_all`
4. `wallet_update_global`
5. `wallet_update_game_wallet`
6. `wallet_transfer_between_game_wallets`
7. `create_player_wallet` (simplified)
8. `update_wallet_balance` (simplified)
9. `get_wallet_balance` (simplified)

#### Leaderboards (5)
10. `submit_score_and_sync`
11. `get_all_leaderboards`
12. `submit_leaderboard_score` (simplified)
13. `get_leaderboard` (simplified)
14. `get_time_period_leaderboard`

#### Daily Systems (5)
15. `daily_reward_claim`
16. `daily_reward_status`
17. `daily_missions_get`
18. `daily_missions_update_progress`
19. `daily_missions_claim`

#### Friends & Social (6)
20. `friends_block`
21. `friends_unblock`
22. `friends_remove`
23. `friends_list`
24. `friends_challenge_user`
25. `friends_spectate`

#### Chat & Messaging (7)
26. `send_group_chat_message`
27. `send_direct_message`
28. `send_chat_room_message`
29. `get_group_chat_history`
30. `get_direct_message_history`
31. `get_chat_room_history`
32. `mark_direct_messages_read`

#### Groups & Guilds (5)
33. `create_game_group`
34. `update_group_xp`
35. `get_group_wallet`
36. `update_group_wallet`
37. `get_user_groups`

#### Push Notifications (3)
38. `push_register_token`
39. `push_send_event`
40. `push_get_endpoints`

#### Analytics (1)
41. `analytics_log_event`

### Game-Specific RPCs (60 total)

#### QuizVerse (30)
42-71. All QuizVerse RPCs (profile, currency, inventory, leaderboards, etc.)

#### LastToLive (30)
72-101. All LastToLive RPCs (same structure as QuizVerse)

---

## Next Steps

1. See [GAME_ONBOARDING_GUIDE.md](./GAME_ONBOARDING_GUIDE.md) for step-by-step integration
2. See [SDK_ENHANCEMENTS.md](./SDK_ENHANCEMENTS.md) for Unity SDK wrapper classes
3. See [UNITY_DEVELOPER_COMPLETE_GUIDE.md](./UNITY_DEVELOPER_COMPLETE_GUIDE.md) for full examples

---

**Questions or Issues?**
- Check existing documentation
- Review code examples
- Open GitHub issue with details
