# Multi-Game RPC Guide: QuizVerse & LastToLive

This guide describes the game-specific RPCs available for QuizVerse and LastToLive games.

## Overview

All RPCs follow these principles:

1. **Pure JavaScript** (No TypeScript)
2. **Game-specific naming**: `${gameID}_${action}` (e.g., `quizverse_submit_score`)
3. **Namespaced storage**: Each game uses separate collections (`quizverse_inventory`, `lasttolive_inventory`)
4. **Unified response format**: All RPCs return `{ success: true, data: {...} }` or `{ success: false, error: "..." }`
5. **gameID validation**: All RPCs validate that `gameID` is either `"quizverse"` or `"lasttolive"`

## Available RPCs

### Authentication & Profile

#### `quizverse_update_user_profile` / `lasttolive_update_user_profile`

Update user profile information.

**Payload:**
```json
{
  "gameID": "quizverse",
  "displayName": "PlayerName",
  "avatar": "avatar_url",
  "level": 10,
  "xp": 5000,
  "metadata": {}
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "displayName": "PlayerName",
    "avatar": "avatar_url",
    "level": 10,
    "xp": 5000,
    "metadata": {},
    "createdAt": "2023-11-16T10:00:00Z",
    "updatedAt": "2023-11-16T10:30:00Z"
  }
}
```

### Wallet Operations

#### `quizverse_grant_currency` / `lasttolive_grant_currency`

Grant currency to user wallet.

**Payload:**
```json
{
  "gameID": "quizverse",
  "amount": 100
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 1100,
    "amount": 100
  }
}
```

#### `quizverse_spend_currency` / `lasttolive_spend_currency`

Spend currency from user wallet.

**Payload:**
```json
{
  "gameID": "quizverse",
  "amount": 50
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 1050,
    "amount": 50
  }
}
```

**Error Response (Insufficient Balance):**
```json
{
  "success": false,
  "error": "Insufficient balance"
}
```

#### `quizverse_validate_purchase` / `lasttolive_validate_purchase`

Validate if user can purchase an item.

**Payload:**
```json
{
  "gameID": "quizverse",
  "itemId": "powerup_001",
  "price": 200
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "canPurchase": true,
    "itemId": "powerup_001",
    "price": 200,
    "balance": 1050
  }
}
```

### Inventory Operations

#### `quizverse_list_inventory` / `lasttolive_list_inventory`

List all items in user inventory.

**Payload:**
```json
{
  "gameID": "quizverse"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "itemId": "powerup_001",
        "quantity": 5,
        "metadata": {},
        "createdAt": "2023-11-16T10:00:00Z",
        "updatedAt": "2023-11-16T10:30:00Z"
      }
    ]
  }
}
```

#### `quizverse_grant_item` / `lasttolive_grant_item`

Grant an item to user inventory.

**Payload:**
```json
{
  "gameID": "quizverse",
  "itemId": "powerup_001",
  "quantity": 3,
  "metadata": { "source": "quest_reward" }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "itemId": "powerup_001",
    "quantity": 3
  }
}
```

#### `quizverse_consume_item` / `lasttolive_consume_item`

Consume an item from user inventory.

**Payload:**
```json
{
  "gameID": "quizverse",
  "itemId": "powerup_001",
  "quantity": 1
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "itemId": "powerup_001",
    "quantity": 1
  }
}
```

### Leaderboards

#### `quizverse_submit_score`

Submit a score with quiz-specific validation.

**Payload:**
```json
{
  "gameID": "quizverse",
  "score": 850,
  "answersCount": 10,
  "completionTime": 120
}
```

**Anti-Cheat Validations:**
- Score cannot exceed `answersCount * 100`
- Completion time must be at least `answersCount * 1` second

**Response:**
```json
{
  "success": true,
  "data": {
    "score": 850,
    "leaderboardId": "quizverse_weekly"
  }
}
```

#### `lasttolive_submit_score`

Submit a score with survival game validation.

**Payload:**
```json
{
  "gameID": "lasttolive",
  "kills": 5,
  "timeSurvivedSec": 600,
  "damageTaken": 250.5,
  "damageDealt": 1500.0,
  "reviveCount": 2
}
```

**Score Formula:**
```
score = (timeSurvivedSec * 10) + (kills * 500) - (damageTaken * 0.1)
```

**Anti-Cheat Validations:**
- Kills cannot exceed `10 * (timeSurvivedSec / 60)`
- Damage dealt cannot exceed `1000 * timeSurvivedSec`

**Response:**
```json
{
  "success": true,
  "data": {
    "score": 8475,
    "leaderboardId": "lasttolive_survivor_rank",
    "metrics": {
      "kills": 5,
      "timeSurvivedSec": 600,
      "damageTaken": 250.5,
      "damageDealt": 1500.0,
      "reviveCount": 2
    }
  }
}
```

#### `quizverse_get_leaderboard` / `lasttolive_get_leaderboard`

Get leaderboard records.

**Payload:**
```json
{
  "gameID": "quizverse",
  "limit": 10
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "leaderboardId": "quizverse_weekly",
    "records": [
      {
        "ownerId": "user_id_1",
        "username": "player1",
        "score": 1000,
        "subscore": 0,
        "numScore": 1,
        "metadata": {
          "gameID": "quizverse",
          "submittedAt": "2023-11-16T10:00:00Z",
          "answersCount": 10,
          "completionTime": 120
        }
      }
    ]
  }
}
```

### Multiplayer

#### `quizverse_join_or_create_match` / `lasttolive_join_or_create_match`

Join or create a multiplayer match.

**Payload:**
```json
{
  "gameID": "quizverse"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "matchId": "quizverse_match_1234567890",
    "gameID": "quizverse"
  }
}
```

### Daily Rewards

#### `quizverse_claim_daily_reward` / `lasttolive_claim_daily_reward`

Claim daily reward with streak tracking.

**Payload:**
```json
{
  "gameID": "quizverse"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "rewardAmount": 110,
    "streak": 2,
    "nextReward": 120
  }
}
```

**Error Response (Already Claimed):**
```json
{
  "success": false,
  "error": "Daily reward already claimed today"
}
```

### Social

#### `quizverse_find_friends` / `lasttolive_find_friends`

Find friends by username.

**Payload:**
```json
{
  "gameID": "quizverse",
  "query": "player",
  "limit": 20
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "userId": "user_id_1",
        "username": "player1",
        "displayName": "Player One"
      }
    ],
    "query": "player"
  }
}
```

### Player Data

#### `quizverse_save_player_data` / `lasttolive_save_player_data`

Save custom player data.

**Payload:**
```json
{
  "gameID": "quizverse",
  "key": "settings",
  "value": {
    "volume": 0.8,
    "difficulty": "hard"
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "key": "settings",
    "saved": true
  }
}
```

#### `quizverse_load_player_data` / `lasttolive_load_player_data`

Load custom player data.

**Payload:**
```json
{
  "gameID": "quizverse",
  "key": "settings"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "key": "settings",
    "value": {
      "volume": 0.8,
      "difficulty": "hard"
    },
    "updatedAt": "2023-11-16T10:00:00Z"
  }
}
```

## Unity C# Client Wrapper

Here's a complete Unity C# wrapper for calling these RPCs:

```csharp
using System.Threading.Tasks;
using Nakama;
using Newtonsoft.Json;
using UnityEngine;

public class MultiGameRPCClient
{
    private IClient client;
    private ISession session;
    private string currentGameID;

    public MultiGameRPCClient(IClient client, ISession session, string gameID)
    {
        this.client = client;
        this.session = session;
        this.currentGameID = gameID;
    }

    /// <summary>
    /// Generic RPC caller with automatic gameID injection
    /// </summary>
    public async Task<TResponse> CallRPC<TResponse>(string rpcId, object payload)
    {
        // Inject gameID if not present
        var payloadDict = payload as System.Collections.Generic.Dictionary<string, object>;
        if (payloadDict == null)
        {
            payloadDict = new System.Collections.Generic.Dictionary<string, object>();
            foreach (var prop in payload.GetType().GetProperties())
            {
                payloadDict[prop.Name] = prop.GetValue(payload);
            }
        }

        if (!payloadDict.ContainsKey("gameID"))
        {
            payloadDict["gameID"] = currentGameID;
        }

        var json = JsonConvert.SerializeObject(payloadDict);
        var result = await client.RpcAsync(session, rpcId, json);
        return JsonConvert.DeserializeObject<TResponse>(result.Payload);
    }

    // Profile
    public async Task<RPCResponse<ProfileData>> UpdateUserProfile(ProfileData profile)
    {
        return await CallRPC<RPCResponse<ProfileData>>(
            $"{currentGameID}_update_user_profile",
            profile
        );
    }

    // Wallet
    public async Task<RPCResponse<WalletBalance>> GrantCurrency(int amount)
    {
        return await CallRPC<RPCResponse<WalletBalance>>(
            $"{currentGameID}_grant_currency",
            new { amount }
        );
    }

    public async Task<RPCResponse<WalletBalance>> SpendCurrency(int amount)
    {
        return await CallRPC<RPCResponse<WalletBalance>>(
            $"{currentGameID}_spend_currency",
            new { amount }
        );
    }

    // Inventory
    public async Task<RPCResponse<InventoryData>> ListInventory()
    {
        return await CallRPC<RPCResponse<InventoryData>>(
            $"{currentGameID}_list_inventory",
            new { }
        );
    }

    public async Task<RPCResponse<ItemData>> GrantItem(string itemId, int quantity, object metadata = null)
    {
        return await CallRPC<RPCResponse<ItemData>>(
            $"{currentGameID}_grant_item",
            new { itemId, quantity, metadata }
        );
    }

    public async Task<RPCResponse<ItemData>> ConsumeItem(string itemId, int quantity)
    {
        return await CallRPC<RPCResponse<ItemData>>(
            $"{currentGameID}_consume_item",
            new { itemId, quantity }
        );
    }

    // Leaderboard
    public async Task<RPCResponse<ScoreData>> SubmitScore(int score, object extraData = null)
    {
        var payload = new System.Collections.Generic.Dictionary<string, object>
        {
            { "score", score }
        };

        if (extraData != null)
        {
            foreach (var prop in extraData.GetType().GetProperties())
            {
                payload[prop.Name] = prop.GetValue(extraData);
            }
        }

        return await CallRPC<RPCResponse<ScoreData>>(
            $"{currentGameID}_submit_score",
            payload
        );
    }

    public async Task<RPCResponse<LeaderboardData>> GetLeaderboard(int limit = 10)
    {
        return await CallRPC<RPCResponse<LeaderboardData>>(
            $"{currentGameID}_get_leaderboard",
            new { limit }
        );
    }

    // Daily Rewards
    public async Task<RPCResponse<DailyRewardData>> ClaimDailyReward()
    {
        return await CallRPC<RPCResponse<DailyRewardData>>(
            $"{currentGameID}_claim_daily_reward",
            new { }
        );
    }

    // Player Data
    public async Task<RPCResponse<PlayerDataSaved>> SavePlayerData(string key, object value)
    {
        return await CallRPC<RPCResponse<PlayerDataSaved>>(
            $"{currentGameID}_save_player_data",
            new { key, value }
        );
    }

    public async Task<RPCResponse<PlayerDataLoaded>> LoadPlayerData(string key)
    {
        return await CallRPC<RPCResponse<PlayerDataLoaded>>(
            $"{currentGameID}_load_player_data",
            new { key }
        );
    }
}

// Data Models
[System.Serializable]
public class RPCResponse<T>
{
    public bool success;
    public T data;
    public string error;
}

[System.Serializable]
public class ProfileData
{
    public string displayName;
    public string avatar;
    public int level;
    public int xp;
    public object metadata;
    public string createdAt;
    public string updatedAt;
}

[System.Serializable]
public class WalletBalance
{
    public int balance;
    public int amount;
}

[System.Serializable]
public class InventoryData
{
    public InventoryItem[] items;
}

[System.Serializable]
public class InventoryItem
{
    public string itemId;
    public int quantity;
    public object metadata;
    public string createdAt;
    public string updatedAt;
}

[System.Serializable]
public class ItemData
{
    public string itemId;
    public int quantity;
}

[System.Serializable]
public class ScoreData
{
    public int score;
    public string leaderboardId;
    public object metrics;
}

[System.Serializable]
public class LeaderboardData
{
    public string leaderboardId;
    public LeaderboardRecord[] records;
}

[System.Serializable]
public class LeaderboardRecord
{
    public string ownerId;
    public string username;
    public long score;
    public long subscore;
    public int numScore;
    public object metadata;
}

[System.Serializable]
public class DailyRewardData
{
    public int rewardAmount;
    public int streak;
    public int nextReward;
}

[System.Serializable]
public class PlayerDataSaved
{
    public string key;
    public bool saved;
}

[System.Serializable]
public class PlayerDataLoaded
{
    public string key;
    public object value;
    public string updatedAt;
}
```

## Unity Usage Example

```csharp
using UnityEngine;
using Nakama;
using System.Threading.Tasks;

public class GameManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private MultiGameRPCClient quizverseClient;
    private MultiGameRPCClient lasttoliveClient;

    async void Start()
    {
        // Initialize Nakama client
        client = new Client("http", "localhost", 7350, "defaultkey");
        
        // Authenticate
        var deviceId = SystemInfo.deviceUniqueIdentifier;
        session = await client.AuthenticateDeviceAsync(deviceId);
        
        // Initialize game clients
        quizverseClient = new MultiGameRPCClient(client, session, "quizverse");
        lasttoliveClient = new MultiGameRPCClient(client, session, "lasttolive");
        
        // Example: Submit QuizVerse score
        await SubmitQuizScore(850, 10, 120);
        
        // Example: Submit LastToLive score
        await SubmitSurvivalScore(5, 600, 250.5f, 1500.0f, 2);
    }

    async Task SubmitQuizScore(int score, int answersCount, int completionTime)
    {
        var result = await quizverseClient.SubmitScore(score, new
        {
            answersCount,
            completionTime
        });

        if (result.success)
        {
            Debug.Log($"Quiz score submitted: {result.data.score}");
        }
        else
        {
            Debug.LogError($"Failed to submit score: {result.error}");
        }
    }

    async Task SubmitSurvivalScore(int kills, int timeSurvivedSec, float damageTaken, float damageDealt, int reviveCount)
    {
        var result = await lasttoliveClient.SubmitScore(0, new
        {
            kills,
            timeSurvivedSec,
            damageTaken,
            damageDealt,
            reviveCount
        });

        if (result.success)
        {
            Debug.Log($"Survival score: {result.data.score}");
        }
        else
        {
            Debug.LogError($"Failed to submit score: {result.error}");
        }
    }

    async Task ManageInventory()
    {
        // Grant item
        var grantResult = await quizverseClient.GrantItem("powerup_001", 5);
        
        if (grantResult.success)
        {
            Debug.Log($"Granted {grantResult.data.quantity}x {grantResult.data.itemId}");
        }

        // List inventory
        var inventory = await quizverseClient.ListInventory();
        
        if (inventory.success)
        {
            foreach (var item in inventory.data.items)
            {
                Debug.Log($"{item.itemId}: {item.quantity}");
            }
        }

        // Consume item
        var consumeResult = await quizverseClient.ConsumeItem("powerup_001", 1);
        
        if (consumeResult.success)
        {
            Debug.Log($"Consumed {consumeResult.data.quantity}x {consumeResult.data.itemId}");
        }
    }

    async Task ManageWallet()
    {
        // Grant currency
        var grantResult = await quizverseClient.GrantCurrency(100);
        
        if (grantResult.success)
        {
            Debug.Log($"New balance: {grantResult.data.balance}");
        }

        // Spend currency
        var spendResult = await quizverseClient.SpendCurrency(50);
        
        if (spendResult.success)
        {
            Debug.Log($"New balance after spending: {spendResult.data.balance}");
        }
        else
        {
            Debug.LogError($"Failed to spend: {spendResult.error}");
        }
    }
}
```

## Storage Collections

Each game uses namespaced storage collections:

### QuizVerse Collections:
- `quizverse_profiles` - User profiles
- `quizverse_wallets` - Currency wallets
- `quizverse_inventory` - Item inventory
- `quizverse_daily_rewards` - Daily reward state
- `quizverse_player_data` - Custom player data

### LastToLive Collections:
- `lasttolive_profiles` - User profiles
- `lasttolive_wallets` - Currency wallets
- `lasttolive_inventory` - Item inventory
- `lasttolive_daily_rewards` - Daily reward state
- `lasttolive_player_data` - Custom player data

## Leaderboard IDs

### QuizVerse:
- `quizverse_weekly` - Weekly leaderboard (resets every Sunday)

### LastToLive:
- `lasttolive_survivor_rank` - Survival rank leaderboard

## Error Handling

All RPCs return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

Common errors:
- `"Unsupported gameID: xyz"` - Invalid gameID provided
- `"Missing required field: fieldName"` - Required field not in payload
- `"Insufficient balance"` - Not enough currency for operation
- `"Wallet not found"` - User has no wallet (call grant_currency first)
- `"Item not found in inventory"` - Item doesn't exist in user's inventory
- `"Invalid score"` - Score validation failed (anti-cheat)

## Best Practices

1. **Always include gameID**: While the Unity wrapper handles this automatically, ensure gameID is always "quizverse" or "lasttolive"
2. **Handle errors gracefully**: Check the `success` field before accessing `data`
3. **Implement anti-cheat on client**: Validate data client-side before submitting to reduce invalid requests
4. **Use metadata**: Store additional context in metadata fields for debugging and analytics
5. **Test both games**: Ensure your client works with both QuizVerse and LastToLive

## Next Steps

- Implement matchmaking for multiplayer matches
- Add achievements system
- Implement battle pass/seasonal progression
- Add clan/guild features
