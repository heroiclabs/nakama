# Player RPC Documentation

This document provides detailed information about the standard player-oriented RPCs available in this Nakama deployment.

## Table of Contents

1. [Overview](#overview)
2. [Wallet RPCs](#wallet-rpcs)
3. [Leaderboard RPCs](#leaderboard-rpcs)
4. [RPC Mapping Guide](#rpc-mapping-guide)
5. [Integration Examples](#integration-examples)
6. [Error Handling](#error-handling)

---

## Overview

This Nakama deployment provides standardized RPCs for common player operations. These RPCs are designed to be easy to use and follow consistent naming conventions.

### Standard RPC Naming

All player RPCs follow this pattern:
- **Wallet Operations**: `create_player_wallet`, `update_wallet_balance`, `get_wallet_balance`
- **Leaderboard Operations**: `submit_leaderboard_score`, `get_leaderboard`

### Authentication

All RPCs require authentication via Nakama session token. Make sure to authenticate the player before calling any RPC:

```csharp
// Unity Example
var client = new Client("http", "localhost", 7350, "defaultkey");
var session = await client.AuthenticateDeviceAsync(
    SystemInfo.deviceUniqueIdentifier, null, true);
```

---

## Wallet RPCs

### 1. `create_player_wallet`

Creates both game-specific and global wallets for a player.

**Purpose**: Initialize a player's wallet system when they first join a game.

**Request Payload**:
```json
{
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid",
  "username": "PlayerName"  // Optional
}
```

**Response**:
```json
{
  "success": true,
  "wallet_id": "game-wallet-uuid",
  "global_wallet_id": "global-wallet-uuid",
  "game_wallet": {
    "wallet_id": "game-wallet-uuid",
    "device_id": "unique-device-identifier",
    "game_id": "your-game-uuid",
    "balance": 0,
    "currency": "coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "global_wallet": {
    "wallet_id": "global-wallet-uuid",
    "device_id": "unique-device-identifier",
    "game_id": "global",
    "balance": 0,
    "currency": "global_coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:00:00Z"
  },
  "message": "Player wallet created successfully"
}
```

**Unity Example**:
```csharp
var payload = new {
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "your-game-uuid",
    username = "PlayerName"
};
var result = await client.RpcAsync(session, "create_player_wallet", JsonUtility.ToJson(payload));
var response = JsonUtility.FromJson<WalletResponse>(result.Payload);
```

**Error Responses**:
- `device_id and game_id are required` - Missing required parameters
- `Failed to create/sync user identity` - Identity creation failed
- `Failed to create/get wallets` - Wallet creation failed

---

### 2. `update_wallet_balance`

Updates a player's wallet balance (game or global wallet).

**Purpose**: Update wallet balance when player earns or spends currency.

**Request Payload**:
```json
{
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid",
  "balance": 1500,
  "wallet_type": "game"  // "game" or "global", defaults to "game"
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
  },
  "wallet_type": "game",
  "message": "Wallet balance updated successfully"
}
```

**Unity Example**:
```csharp
// Update game wallet
var payload = new {
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "your-game-uuid",
    balance = 1500,
    wallet_type = "game"
};
var result = await client.RpcAsync(session, "update_wallet_balance", JsonUtility.ToJson(payload));

// Update global wallet
var globalPayload = new {
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "your-game-uuid",
    balance = 3000,
    wallet_type = "global"
};
var globalResult = await client.RpcAsync(session, "update_wallet_balance", JsonUtility.ToJson(globalPayload));
```

**Error Responses**:
- `device_id and game_id are required` - Missing required parameters
- `balance is required` - Missing balance parameter
- `balance must be a non-negative number` - Invalid balance value
- `Failed to update wallet` - Update operation failed

---

### 3. `get_wallet_balance`

Retrieves both game-specific and global wallet balances for a player.

**Purpose**: Get current wallet balances to display in UI or check if player can afford purchases.

**Request Payload**:
```json
{
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid"
}
```

**Response**:
```json
{
  "success": true,
  "game_wallet": {
    "wallet_id": "game-wallet-uuid",
    "device_id": "unique-device-identifier",
    "game_id": "your-game-uuid",
    "balance": 1500,
    "currency": "coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:05:00Z"
  },
  "global_wallet": {
    "wallet_id": "global-wallet-uuid",
    "device_id": "unique-device-identifier",
    "game_id": "global",
    "balance": 3000,
    "currency": "global_coins",
    "created_at": "2024-01-01T00:00:00Z",
    "updated_at": "2024-01-01T00:05:00Z"
  },
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid"
}
```

**Unity Example**:
```csharp
var payload = new {
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "your-game-uuid"
};
var result = await client.RpcAsync(session, "get_wallet_balance", JsonUtility.ToJson(payload));
var response = JsonUtility.FromJson<WalletBalanceResponse>(result.Payload);

Debug.Log($"Game Balance: {response.game_wallet.balance}");
Debug.Log($"Global Balance: {response.global_wallet.balance}");
```

**Error Responses**:
- `device_id and game_id are required` - Missing required parameters
- `Failed to get wallet` - Retrieval operation failed

---

## Leaderboard RPCs

### 4. `submit_leaderboard_score`

Submits a score to all time-period leaderboards for a game.

**Purpose**: Submit player score and automatically sync to all leaderboard types (main, daily, weekly, monthly, all-time, global, friends).

**Request Payload**:
```json
{
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid",
  "score": 1500,
  "metadata": {
    "level": 5,
    "time": 120,
    "accuracy": 0.95
  }
}
```

**Response**:
```json
{
  "success": true,
  "leaderboards_updated": [
    "leaderboard_your-game-uuid",
    "leaderboard_your-game-uuid_daily",
    "leaderboard_your-game-uuid_weekly",
    "leaderboard_your-game-uuid_monthly",
    "leaderboard_your-game-uuid_alltime",
    "leaderboard_global",
    "leaderboard_global_daily",
    "leaderboard_friends_your-game-uuid"
  ],
  "score": 1500,
  "wallet_updated": true,
  "message": "Score submitted successfully to all leaderboards"
}
```

**Unity Example**:
```csharp
var payload = new {
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "your-game-uuid",
    score = 1500,
    metadata = new {
        level = 5,
        time = 120,
        accuracy = 0.95f
    }
};
var result = await client.RpcAsync(session, "submit_leaderboard_score", JsonUtility.ToJson(payload));
var response = JsonUtility.FromJson<LeaderboardSubmitResponse>(result.Payload);

Debug.Log($"Score submitted to {response.leaderboards_updated.Length} leaderboards");
```

**Features**:
- Automatically submits to multiple leaderboard types
- Updates game wallet balance to match score
- Syncs to both game-specific and global leaderboards
- Includes friend leaderboards if player has friends

**Error Responses**:
- `device_id and game_id are required` - Missing required parameters
- `score is required` - Missing score parameter
- `score must be a number` - Invalid score value
- `Failed to submit score` - Submission operation failed

---

### 5. `get_leaderboard`

Retrieves leaderboard records for a specific game and time period.

**Purpose**: Display leaderboard rankings to players.

**Request Payload**:
```json
{
  "game_id": "your-game-uuid",
  "period": "daily",  // "daily", "weekly", "monthly", "alltime", or empty for main
  "limit": 10,        // Optional: 1-100, default 10
  "cursor": ""        // Optional: for pagination
}
```

**Response**:
```json
{
  "success": true,
  "leaderboard_id": "leaderboard_your-game-uuid_daily",
  "records": [
    {
      "rank": 1,
      "user_id": "user-uuid-1",
      "username": "TopPlayer",
      "score": 2500,
      "subscore": 0,
      "metadata": {
        "level": 10,
        "time": 90
      }
    },
    {
      "rank": 2,
      "user_id": "user-uuid-2",
      "username": "Player2",
      "score": 2000,
      "subscore": 0,
      "metadata": {
        "level": 8,
        "time": 120
      }
    }
  ],
  "next_cursor": "next-page-cursor",
  "prev_cursor": "prev-page-cursor",
  "period": "daily",
  "game_id": "your-game-uuid"
}
```

**Unity Example**:
```csharp
// Get daily leaderboard
var payload = new {
    game_id = "your-game-uuid",
    period = "daily",
    limit = 10
};
var result = await client.RpcAsync(session, "get_leaderboard", JsonUtility.ToJson(payload));
var response = JsonUtility.FromJson<LeaderboardResponse>(result.Payload);

foreach (var record in response.records) {
    Debug.Log($"#{record.rank}: {record.username} - {record.score}");
}

// Get all-time leaderboard
var alltimePayload = new {
    game_id = "your-game-uuid",
    period = "alltime",
    limit = 100
};
var alltimeResult = await client.RpcAsync(session, "get_leaderboard", JsonUtility.ToJson(alltimePayload));
```

**Supported Periods**:
- `` (empty) - Main leaderboard
- `daily` - Resets daily at UTC midnight
- `weekly` - Resets weekly on Mondays
- `monthly` - Resets monthly on the 1st
- `alltime` - Never resets

**Pagination**:
Use the `next_cursor` from the response to get the next page:
```csharp
var nextPagePayload = new {
    game_id = "your-game-uuid",
    period = "daily",
    limit = 10,
    cursor = response.next_cursor
};
```

**Error Responses**:
- `game_id is required` - Missing game_id parameter
- `limit must be between 1 and 100` - Invalid limit value
- `Failed to get leaderboard` - Retrieval operation failed

---

## RPC Mapping Guide

If you're familiar with the existing RPCs in this deployment, here's how the standard player RPCs map to them:

| Standard RPC | Internal RPC(s) Used | Notes |
|--------------|---------------------|-------|
| `create_player_wallet` | `create_or_sync_user` + `create_or_get_wallet` | Combines identity and wallet creation |
| `update_wallet_balance` | `wallet_update_game_wallet` or `wallet_update_global` | Delegates based on wallet_type parameter |
| `get_wallet_balance` | `create_or_get_wallet` | Returns both wallet types |
| `submit_leaderboard_score` | `submit_score_and_sync` | Syncs to all leaderboard types |
| `get_leaderboard` | `get_time_period_leaderboard` | Supports all time periods |

### Alternative RPCs

You can also use these alternative RPCs if you prefer:

**Wallet Alternatives**:
- `wallet_get_all` - Similar to `get_wallet_balance`
- `wallet_update_game_wallet` - Direct game wallet update
- `wallet_update_global` - Direct global wallet update
- `wallet_transfer_between_game_wallets` - Transfer between game wallets

**Leaderboard Alternatives**:
- `submit_score_to_time_periods` - Submit to time-period leaderboards
- `submit_score_sync` - Sync to game and global leaderboards
- `submit_score_with_aggregate` - Submit with Power Rank calculation
- `submit_score_with_friends_sync` - Submit to friend leaderboards
- `get_friend_leaderboard` - Get friend-only rankings

See the main [README.md](../README.md) for a complete list of all available RPCs.

---

## Integration Examples

### Complete Player Flow

Here's a complete example of integrating a new player into your game:

```csharp
using Nakama;
using UnityEngine;
using System.Threading.Tasks;

public class NakamaManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private string gameId = "your-game-uuid";
    
    async Task Start()
    {
        // 1. Initialize Nakama client
        client = new Client("http", "localhost", 7350, "defaultkey");
        
        // 2. Authenticate player
        var deviceId = SystemInfo.deviceUniqueIdentifier;
        session = await client.AuthenticateDeviceAsync(deviceId, null, true);
        
        Debug.Log("Authenticated!");
        
        // 3. Create player wallet
        await CreatePlayerWallet();
        
        // 4. Get wallet balance
        await GetWalletBalance();
        
        // 5. Submit a score
        await SubmitScore(1500);
        
        // 6. View leaderboard
        await ViewLeaderboard();
    }
    
    async Task CreatePlayerWallet()
    {
        var payload = new {
            device_id = SystemInfo.deviceUniqueIdentifier,
            game_id = gameId,
            username = "Player_" + Random.Range(1000, 9999)
        };
        
        var result = await client.RpcAsync(session, "create_player_wallet", 
            JsonUtility.ToJson(payload));
        
        Debug.Log($"Wallet created: {result.Payload}");
    }
    
    async Task GetWalletBalance()
    {
        var payload = new {
            device_id = SystemInfo.deviceUniqueIdentifier,
            game_id = gameId
        };
        
        var result = await client.RpcAsync(session, "get_wallet_balance", 
            JsonUtility.ToJson(payload));
        
        Debug.Log($"Wallet balance: {result.Payload}");
    }
    
    async Task SubmitScore(int score)
    {
        var payload = new {
            device_id = SystemInfo.deviceUniqueIdentifier,
            game_id = gameId,
            score = score,
            metadata = new {
                level = 1,
                time = 120
            }
        };
        
        var result = await client.RpcAsync(session, "submit_leaderboard_score", 
            JsonUtility.ToJson(payload));
        
        Debug.Log($"Score submitted: {result.Payload}");
    }
    
    async Task ViewLeaderboard()
    {
        var payload = new {
            game_id = gameId,
            period = "daily",
            limit = 10
        };
        
        var result = await client.RpcAsync(session, "get_leaderboard", 
            JsonUtility.ToJson(payload));
        
        Debug.Log($"Leaderboard: {result.Payload}");
    }
    
    // Update wallet when player earns currency
    public async Task AddCoins(int amount)
    {
        // Get current balance
        var getPayload = new {
            device_id = SystemInfo.deviceUniqueIdentifier,
            game_id = gameId
        };
        var result = await client.RpcAsync(session, "get_wallet_balance", 
            JsonUtility.ToJson(getPayload));
        
        // Parse current balance (you'll need to implement proper JSON parsing)
        // var current = ParseBalance(result.Payload);
        var newBalance = 0; // current + amount;
        
        // Update balance
        var updatePayload = new {
            device_id = SystemInfo.deviceUniqueIdentifier,
            game_id = gameId,
            balance = newBalance,
            wallet_type = "game"
        };
        await client.RpcAsync(session, "update_wallet_balance", 
            JsonUtility.ToJson(updatePayload));
    }
}
```

### Leaderboard UI Example

```csharp
using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;

public class LeaderboardUI : MonoBehaviour
{
    public GameObject leaderboardEntryPrefab;
    public Transform leaderboardContainer;
    public Dropdown periodDropdown;
    
    private NakamaManager nakamaManager;
    
    void Start()
    {
        nakamaManager = FindObjectOfType<NakamaManager>();
        periodDropdown.onValueChanged.AddListener(OnPeriodChanged);
        RefreshLeaderboard("daily");
    }
    
    async void RefreshLeaderboard(string period)
    {
        // Clear existing entries
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }
        
        // Get leaderboard data
        var payload = new {
            game_id = nakamaManager.gameId,
            period = period,
            limit = 50
        };
        
        var result = await nakamaManager.client.RpcAsync(
            nakamaManager.session, 
            "get_leaderboard", 
            JsonUtility.ToJson(payload)
        );
        
        // Parse and display (implement proper JSON parsing)
        // var leaderboard = ParseLeaderboard(result.Payload);
        // foreach (var record in leaderboard.records) {
        //     var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
        //     entry.GetComponent<LeaderboardEntry>().SetData(record);
        // }
    }
    
    void OnPeriodChanged(int index)
    {
        string[] periods = { "daily", "weekly", "monthly", "alltime" };
        RefreshLeaderboard(periods[index]);
    }
}
```

---

## Error Handling

All RPCs return a consistent error format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

### Common Error Patterns

**Missing Parameters**:
```json
{
  "success": false,
  "error": "device_id and game_id are required"
}
```

**Invalid Values**:
```json
{
  "success": false,
  "error": "balance must be a non-negative number"
}
```

**Operation Failed**:
```json
{
  "success": false,
  "error": "Failed to update wallet: Database connection error"
}
```

### Best Practices for Error Handling

```csharp
try
{
    var result = await client.RpcAsync(session, "get_wallet_balance", payload);
    
    // Parse response
    var response = JsonUtility.FromJson<WalletBalanceResponse>(result.Payload);
    
    if (!response.success)
    {
        Debug.LogError($"RPC Error: {response.error}");
        // Show error to user
        ShowErrorDialog(response.error);
        return;
    }
    
    // Success - use the data
    UpdateWalletUI(response.game_wallet.balance);
}
catch (ApiResponseException ex)
{
    Debug.LogError($"Nakama API Error: {ex.Message}");
    // Handle network errors, authentication errors, etc.
    ShowErrorDialog("Connection error. Please try again.");
}
catch (Exception ex)
{
    Debug.LogError($"Unexpected error: {ex.Message}");
    ShowErrorDialog("An unexpected error occurred.");
}
```

### Error Recovery Strategies

1. **Network Errors**: Retry with exponential backoff
2. **Missing Parameters**: Validate inputs before calling RPC
3. **Invalid Values**: Add client-side validation
4. **Authentication Errors**: Re-authenticate and retry
5. **Database Errors**: Show user-friendly message and log for investigation

---

## Additional Resources

- [Main README](../README.md) - Complete platform documentation
- [Unity Developer Guide](../UNITY_DEVELOPER_COMPLETE_GUIDE.md) - Comprehensive Unity integration
- [Sample Game Integration](../SAMPLE_GAME_COMPLETE_INTEGRATION.md) - End-to-end example
- [Nakama Official Docs](https://heroiclabs.com/docs) - Core Nakama features

---

## Support

For issues or questions:
1. Check this documentation
2. Review the example code in the repository
3. Check existing GitHub issues
4. Open a new issue with details about your problem

---

**Last Updated**: 2024-01-01  
**Version**: 1.0.0
