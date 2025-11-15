# Wallet System Documentation

## Overview

The Nakama wallet system provides **dual-wallet architecture**: each player has a **per-game wallet** for game-specific currency and a **global wallet** shared across all games in the ecosystem.

## Wallet Types

### Per-Game Wallet

- **Scope**: Single game
- **Currency**: Game-specific coins/tokens
- **Use Cases**: In-game purchases, score-based rewards, game progression
- **Isolation**: Each game has its own wallet balance

### Global Wallet

- **Scope**: All games in the ecosystem
- **Currency**: Global coins/points
- **Use Cases**: Cross-game rewards, ecosystem-wide progression, premium currency
- **Sharing**: Same balance accessible from all games

## Storage Patterns

### Per-Game Wallet
```
Collection: "quizverse"
Key: "wallet:<device_id>:<game_id>"
```

### Global Wallet
```
Collection: "quizverse"
Key: "wallet:<device_id>:global"
```

## Wallet Object Structure

### Per-Game Wallet
```json
{
  "wallet_id": "unique-wallet-uuid",
  "device_id": "device-identifier",
  "game_id": "game-uuid",
  "balance": 1000,
  "currency": "coins",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### Global Wallet
```json
{
  "wallet_id": "global:device-identifier",
  "device_id": "device-identifier",
  "game_id": "global",
  "balance": 500,
  "currency": "global_coins",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

## RPC: create_or_get_wallet

Retrieves or creates both per-game and global wallets.

### Input
```json
{
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid"
}
```

### Response
```json
{
  "success": true,
  "game_wallet": {
    "wallet_id": "per-game-wallet-uuid",
    "balance": 1000,
    "currency": "coins",
    "game_id": "your-game-uuid"
  },
  "global_wallet": {
    "wallet_id": "global:device-identifier",
    "balance": 500,
    "currency": "global_coins"
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Identity not found. Please call create_or_sync_user first."
}
```

## Unity Implementation

### Wallet Manager Class

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

[Serializable]
public class WalletResponse
{
    public bool success;
    public GameWallet game_wallet;
    public GlobalWallet global_wallet;
}

[Serializable]
public class GameWallet
{
    public string wallet_id;
    public int balance;
    public string currency;
    public string game_id;
}

[Serializable]
public class GlobalWallet
{
    public string wallet_id;
    public int balance;
    public string currency;
}

public class WalletManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private string gameId = "your-game-uuid";
    
    private WalletResponse currentWallets;
    
    public async Task LoadWallets()
    {
        string deviceId = DeviceIdentity.GetDeviceId();
        
        var payload = new Dictionary<string, string>
        {
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        var payloadJson = JsonUtility.ToJson(payload);
        var result = await client.RpcAsync(session, "create_or_get_wallet", payloadJson);
        
        currentWallets = JsonUtility.FromJson<WalletResponse>(result.Payload);
        
        if (currentWallets.success)
        {
            UpdateUI();
        }
    }
    
    private void UpdateUI()
    {
        Debug.Log($"Game Wallet Balance: {currentWallets.game_wallet.balance} {currentWallets.game_wallet.currency}");
        Debug.Log($"Global Wallet Balance: {currentWallets.global_wallet.balance} {currentWallets.global_wallet.currency}");
    }
    
    public int GetGameWalletBalance()
    {
        return currentWallets?.game_wallet?.balance ?? 0;
    }
    
    public int GetGlobalWalletBalance()
    {
        return currentWallets?.global_wallet?.balance ?? 0;
    }
}
```

## Balance Updates

### Automatic Updates from Score Submission

When you submit a score using `submit_score_and_sync`, the game wallet balance is **automatically updated** to match the score:

```csharp
// Submitting a score of 1500
var scorePayload = new Dictionary<string, object>
{
    { "score", 1500 },
    { "device_id", deviceId },
    { "game_id", gameId }
};

var result = await client.RpcAsync(session, "submit_score_and_sync", JsonUtility.ToJson(scorePayload));
// Game wallet balance is now 1500
```

### Manual Wallet Updates

For manual wallet updates (purchases, rewards, etc.), you can extend the system with additional RPCs or use Nakama's built-in wallet system:

```csharp
// Using Nakama's built-in wallet for additional currencies
var changeset = new Dictionary<string, long>
{
    { "gems", 100 },
    { "gold", 500 }
};

await client.UpdateWalletAsync(session, changeset);
```

## Keeping Leaderboard Scores and Wallet Balances Separate

### Important: Score vs. Wallet Balance Independence

**Leaderboard scores** and **wallet balances** serve different purposes and should be managed independently:

| Aspect | Leaderboard Score | Wallet Balance |
|--------|------------------|----------------|
| **Purpose** | Competition ranking | In-game currency |
| **Storage** | Nakama leaderboard system | `quizverse:wallet:*` storage |
| **Updates** | Via `submit_score_and_sync` | Manual management recommended |
| **Visibility** | Public (all players) | Private (per player) |
| **Reset** | Based on leaderboard type | Persistent |

### Current Implementation Behavior

By default, `submit_score_and_sync` does **two things**:
1. ✅ Writes the score to leaderboards (this is the primary purpose)
2. ⚠️ Sets the game wallet balance to match the score (this is a **side effect**)

### How to Manage Them Separately

#### Option 1: Ignore Wallet Balance from Score Submission

If you want wallet balance to be independent from scores:

```csharp
// Submit score (updates leaderboards)
await client.RpcAsync(session, "submit_score_and_sync", 
    JsonUtility.ToJson(new {score, device_id, game_id}));

// Manage wallet separately using Nakama's built-in wallet
var changeset = new Dictionary<string, long>
{
    { "coins", 100 },  // Award coins separately from score
    { "gems", 5 }
};
await client.UpdateWalletAsync(session, changeset);
```

#### Option 2: Use Score for Leaderboard Only

Create a custom RPC that submits scores without modifying wallets (recommended for production):

**Server-side (add to `data/modules/index.js`):**
```javascript
function submitScoreOnly(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var score = parseInt(data.score);
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    // Get identity
    var records = nk.storageRead([{
        collection: "quizverse",
        key: "identity:" + deviceId + ":" + gameId,
        userId: "00000000-0000-0000-0000-000000000000"
    }]);
    
    var identity = records[0].value;
    var userId = ctx.userId || deviceId;
    
    // Write to leaderboards ONLY (no wallet update)
    var leaderboardsUpdated = writeToAllLeaderboards(nk, logger, userId, identity.username, gameId, score);
    
    return JSON.stringify({
        success: true,
        score: score,
        leaderboards_updated: leaderboardsUpdated,
        game_id: gameId
    });
}
```

**Unity client:**
```csharp
// Submit score to leaderboards only
await client.RpcAsync(session, "submit_score_only", 
    JsonUtility.ToJson(new {score, device_id, game_id}));

// Award wallet currency based on game logic
int coinsEarned = CalculateCoinsFromGameplay(); // Your custom logic
await client.UpdateWalletAsync(session, new Dictionary<string, long> {
    { "coins", coinsEarned }
});
```

#### Option 3: Use Different Currency for Wallet

Keep the wallet balance in a different currency than the score:

```csharp
// Leaderboard score: 1500 points
await client.RpcAsync(session, "submit_score_and_sync", 
    JsonUtility.ToJson(new {score = 1500, device_id, game_id}));

// Wallet: 150 coins (different from score)
await client.UpdateWalletAsync(session, new Dictionary<string, long> {
    { "coins", 150 }  // 10% of score as coins
});
```

### Recommended Approach for Production

**Best Practice**: Keep leaderboard scores and wallet balances completely separate:

1. **For Leaderboards**: Use `submit_score_and_sync` or create `submit_score_only`
2. **For Wallets**: Use Nakama's built-in `UpdateWalletAsync` with custom logic
3. **For Rewards**: Calculate rewards based on game events, not just scores

**Example: Complete Separation**

```csharp
public class GameEndHandler : MonoBehaviour
{
    public async Task OnGameEnd(int finalScore, int starsEarned, bool levelComplete)
    {
        // 1. Submit score to leaderboards (competitive ranking)
        await client.RpcAsync(session, "submit_score_and_sync",
            JsonUtility.ToJson(new {
                score = finalScore,
                device_id = deviceId,
                game_id = gameId
            }));
        
        // 2. Award coins based on game logic (NOT score)
        int coinsEarned = 0;
        if (levelComplete) coinsEarned += 50;
        coinsEarned += starsEarned * 10;
        
        await client.UpdateWalletAsync(session, new Dictionary<string, long> {
            { "coins", coinsEarned }
        });
        
        // 3. Update UI separately
        UpdateLeaderboardUI();
        UpdateWalletUI();
    }
}
```

## Balance Sync Logic

### Game Wallet
- **Updated by**: `submit_score_and_sync` (sets to score value) OR manual updates
- **Recommendation**: Use Nakama's built-in wallet system for true currency management
- **Purpose**: Can track score OR be used as independent currency

### Global Wallet
- **Updated by**: Custom logic (not automatically updated by score submissions)
- **Value**: Managed separately from game scores
- **Purpose**: Cross-game currency and rewards

## Use Cases

### Example 1: In-Game Shop

```csharp
public class Shop : MonoBehaviour
{
    public async Task<bool> PurchaseItem(int itemCost)
    {
        WalletManager walletManager = GetComponent<WalletManager>();
        await walletManager.LoadWallets();
        
        int currentBalance = walletManager.GetGameWalletBalance();
        
        if (currentBalance >= itemCost)
        {
            // Deduct from wallet
            int newBalance = currentBalance - itemCost;
            
            // Update via custom RPC or Nakama wallet
            // ... implementation depends on your architecture
            
            return true;
        }
        
        Debug.Log("Insufficient funds!");
        return false;
    }
}
```

### Example 2: Cross-Game Rewards

```csharp
public class CrossGameRewards : MonoBehaviour
{
    public async Task CheckAndClaimRewards()
    {
        WalletManager walletManager = GetComponent<WalletManager>();
        await walletManager.LoadWallets();
        
        int globalBalance = walletManager.GetGlobalWalletBalance();
        
        // Check if player has earned rewards in other games
        if (globalBalance >= 1000)
        {
            Debug.Log("Congratulations! You've earned a cross-game bonus!");
            // Grant special items or bonuses
        }
    }
}
```

## Best Practices

### 1. Cache Wallet Data
Don't fetch wallet data on every frame. Load it once and update only when needed:

```csharp
void Start()
{
    LoadWallets(); // Load once on start
}

async void OnScoreSubmitted()
{
    // Reload after score submission
    await LoadWallets();
}
```

### 2. Show Loading States
Always show a loading indicator when fetching wallet data:

```csharp
public async Task LoadWallets()
{
    loadingIndicator.SetActive(true);
    
    try
    {
        // ... wallet loading code
    }
    finally
    {
        loadingIndicator.SetActive(false);
    }
}
```

### 3. Handle Errors Gracefully
```csharp
try
{
    await walletManager.LoadWallets();
}
catch (Exception ex)
{
    Debug.LogError($"Failed to load wallets: {ex.Message}");
    ShowErrorDialog("Unable to load wallet. Please try again.");
}
```

### 4. Offline Support
Consider caching wallet data locally for offline scenarios:

```csharp
void SaveWalletCache()
{
    PlayerPrefs.SetInt("cached_game_balance", currentWallets.game_wallet.balance);
    PlayerPrefs.SetInt("cached_global_balance", currentWallets.global_wallet.balance);
    PlayerPrefs.Save();
}

int GetCachedGameBalance()
{
    return PlayerPrefs.GetInt("cached_game_balance", 0);
}
```

## Security Considerations

### Server-Side Validation
All wallet modifications should be validated server-side. Never trust client-side balance updates.

### Transaction Logging
Consider implementing transaction logs for auditing:

```json
{
  "transaction_id": "tx-uuid",
  "wallet_id": "wallet-uuid",
  "type": "purchase",
  "amount": -100,
  "previous_balance": 500,
  "new_balance": 400,
  "timestamp": "2024-01-01T00:00:00Z",
  "metadata": {
    "item_id": "sword_001",
    "reason": "item_purchase"
  }
}
```

### Anti-Cheat
- Validate all transactions server-side
- Implement rate limiting on wallet operations
- Monitor for suspicious patterns (e.g., impossible balance increases)
- Use checksums or signatures for wallet state

## Extending the Wallet System

### Adding Custom Currencies

You can extend the wallet system to support multiple currencies per game:

```json
{
  "wallet_id": "wallet-uuid",
  "device_id": "device-id",
  "game_id": "game-uuid",
  "balances": {
    "coins": 1000,
    "gems": 50,
    "tokens": 25
  },
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

### Transaction History

Implement a transaction history system for players to review their wallet activity:

```
Collection: "quizverse"
Key: "wallet_transactions:<device_id>:<game_id>"
```

## Troubleshooting

### "Identity not found" Error
**Problem**: Wallet RPC returns identity not found error.
**Solution**: Always call `create_or_sync_user` before calling `create_or_get_wallet`.

### Balance Not Updating
**Problem**: Wallet balance doesn't reflect recent changes.
**Solution**: Call `create_or_get_wallet` again to fetch the latest balance.

### Negative Balance
**Problem**: Wallet balance becomes negative.
**Solution**: Implement server-side validation to prevent balance from going below zero.

## See Also

- [Identity System](./identity.md)
- [Score Submission](./leaderboards.md)
- [Unity Quick Start](./unity/Unity-Quick-Start.md)
- [API Reference](./api/README.md)
