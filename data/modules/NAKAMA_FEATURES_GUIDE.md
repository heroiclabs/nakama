# Nakama Features Guide for Unity Developers

## Table of Contents
- [Overview](#overview)
- [Setup](#setup)
- [Available Features](#available-features)
  - [1. Wallet Mapping (Cognito Integration)](#1-wallet-mapping-cognito-integration)
  - [2. Leaderboards](#2-leaderboards)
- [Complete Unity Examples](#complete-unity-examples)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

---

## Overview

This guide provides everything you need to integrate Nakama features into your Unity game. All features are accessible through simple RPC (Remote Procedure Call) functions that you can call from your Unity C# scripts.

**What's Available:**
- ✅ **Wallet Mapping** - Link AWS Cognito users to global wallets
- ✅ **Leaderboards** - Dynamic, persistent game leaderboards
- ✅ **User Management** - Cross-game identity system
- ✅ **Storage** - Persistent game data

---

## Setup

### 1. Install Nakama Unity SDK

Download from: [Nakama Unity SDK](https://github.com/heroiclabs/nakama-unity)

```bash
# Using Unity Package Manager
Add package from git URL: https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama
```

### 2. Initialize Nakama Client

```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;

public class NakamaManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    void Start()
    {
        // Initialize Nakama client
        client = new Client("http", "127.0.0.1", 7350, "defaultkey");
        
        // Authenticate and connect
        AuthenticateAsync();
    }
    
    private async void AuthenticateAsync()
    {
        try
        {
            // Authenticate with device ID (creates account if doesn't exist)
            session = await client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
            Debug.Log($"Authenticated as: {session.UserId}");
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Authentication failed: {ex.Message}");
        }
    }
}
```

---

## Available Features

### 1. Wallet Mapping (Cognito Integration)

The wallet system creates a one-to-one mapping between AWS Cognito users and global wallets shared across all IntelliVerse X games.

#### 1.1 Get User Wallet

Retrieve or create a wallet for the current user.

**RPC Name:** `get_user_wallet`

**Unity C# Example:**

```csharp
public class WalletManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    public async Task<WalletInfo> GetUserWallet(string cognitoToken = null)
    {
        try
        {
            // Prepare payload
            var payload = new Dictionary<string, object>();
            
            // Option 1: Use Cognito JWT token
            if (!string.IsNullOrEmpty(cognitoToken))
            {
                payload["token"] = cognitoToken;
            }
            // Option 2: Use Nakama session (no token needed)
            // If you're already authenticated with Nakama, leave payload empty
            
            // Call RPC
            var result = await client.RpcAsync(session, "get_user_wallet", JsonUtility.ToJson(payload));
            
            // Parse response
            var walletData = JsonUtility.FromJson<WalletResponse>(result.Payload);
            
            if (walletData.success)
            {
                Debug.Log($"Wallet ID: {walletData.walletId}");
                Debug.Log($"Games Linked: {walletData.gamesLinked.Length}");
                return new WalletInfo
                {
                    WalletId = walletData.walletId,
                    UserId = walletData.userId,
                    GamesLinked = walletData.gamesLinked,
                    CreatedAt = walletData.createdAt
                };
            }
            else
            {
                Debug.LogError($"Failed to get wallet: {walletData.error}");
                return null;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"RPC failed: {ex.Message}");
            return null;
        }
    }
}

// Response data structures
[System.Serializable]
public class WalletResponse
{
    public bool success;
    public string walletId;
    public string userId;
    public string status;
    public string[] gamesLinked;
    public string createdAt;
    public string error;
}

public class WalletInfo
{
    public string WalletId;
    public string UserId;
    public string[] GamesLinked;
    public string CreatedAt;
}
```

**Response Example:**
```json
{
  "success": true,
  "walletId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "gamesLinked": ["game1", "game2"],
  "createdAt": "2025-11-12T15:30:00Z"
}
```

---

#### 1.2 Link Wallet to Game

Link the user's wallet to a specific game.

**RPC Name:** `link_wallet_to_game`

**Unity C# Example:**

```csharp
public async Task<bool> LinkWalletToGame(string gameId, string cognitoToken = null)
{
    try
    {
        // Prepare payload
        var payload = new LinkWalletPayload
        {
            gameId = gameId
        };
        
        if (!string.IsNullOrEmpty(cognitoToken))
        {
            payload.token = cognitoToken;
        }
        
        // Call RPC
        var result = await client.RpcAsync(session, "link_wallet_to_game", JsonUtility.ToJson(payload));
        
        // Parse response
        var response = JsonUtility.FromJson<LinkWalletResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Wallet linked to game: {gameId}");
            Debug.Log($"Total games linked: {response.gamesLinked.Length}");
            return true;
        }
        else
        {
            Debug.LogError($"Failed to link wallet: {response.error}");
            return false;
        }
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"RPC failed: {ex.Message}");
        return false;
    }
}

[System.Serializable]
public class LinkWalletPayload
{
    public string token;
    public string gameId;
}

[System.Serializable]
public class LinkWalletResponse
{
    public bool success;
    public string walletId;
    public string gameId;
    public string[] gamesLinked;
    public string message;
    public string error;
}
```

**Example Usage:**
```csharp
// In your game initialization
void Start()
{
    string myGameId = "fc3db911-42e8-4f95-96d1-41c3e7b9812d";
    LinkWalletToGame(myGameId);
}
```

---

#### 1.3 Get Wallet Registry (Admin)

Retrieve all wallets in the system (administrative function).

**RPC Name:** `get_wallet_registry`

**Unity C# Example:**

```csharp
public async Task<WalletInfo[]> GetWalletRegistry(int limit = 100)
{
    try
    {
        var payload = new { limit = limit };
        var result = await client.RpcAsync(session, "get_wallet_registry", JsonUtility.ToJson(payload));
        
        var response = JsonUtility.FromJson<WalletRegistryResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Retrieved {response.count} wallets");
            return response.wallets;
        }
        else
        {
            Debug.LogError($"Failed to get registry: {response.error}");
            return null;
        }
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"RPC failed: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class WalletRegistryResponse
{
    public bool success;
    public WalletInfo[] wallets;
    public int count;
    public string error;
}
```

---

### 2. Leaderboards

Dynamic leaderboard system that creates global and per-game leaderboards automatically.

#### 2.1 Create All Leaderboards

Automatically creates leaderboards for all games in the IntelliVerse ecosystem.

**RPC Name:** `create_all_leaderboards_persistent`

**Unity C# Example:**

```csharp
public class LeaderboardManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    // Call this once during game setup (typically server-side or admin tool)
    public async Task<bool> CreateAllLeaderboards()
    {
        try
        {
            var result = await client.RpcAsync(session, "create_all_leaderboards_persistent", "");
            var response = JsonUtility.FromJson<LeaderboardCreationResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"Created {response.created.Length} new leaderboards");
                Debug.Log($"Skipped {response.skipped.Length} existing leaderboards");
                Debug.Log($"Total games processed: {response.totalProcessed}");
                return true;
            }
            else
            {
                Debug.LogError($"Leaderboard creation failed: {response.error}");
                return false;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"RPC failed: {ex.Message}");
            return false;
        }
    }
}

[System.Serializable]
public class LeaderboardCreationResponse
{
    public bool success;
    public string[] created;
    public string[] skipped;
    public int totalProcessed;
    public int storedRecords;
    public string error;
}
```

#### 2.2 Submit Score to Leaderboard

Submit a player's score to a game-specific leaderboard.

**Unity C# Example:**

```csharp
public async Task<bool> SubmitScore(string gameId, long score)
{
    try
    {
        string leaderboardId = $"leaderboard_{gameId}";
        
        // Submit score to leaderboard
        await client.WriteLeaderboardRecordAsync(session, leaderboardId, score);
        
        Debug.Log($"Score {score} submitted to {leaderboardId}");
        return true;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to submit score: {ex.Message}");
        return false;
    }
}

// Submit to global leaderboard
public async Task<bool> SubmitGlobalScore(long score)
{
    try
    {
        await client.WriteLeaderboardRecordAsync(session, "leaderboard_global", score);
        Debug.Log($"Global score {score} submitted");
        return true;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to submit global score: {ex.Message}");
        return false;
    }
}
```

#### 2.3 Get Leaderboard Rankings

Retrieve top players from a leaderboard.

**Unity C# Example:**

```csharp
public async Task<IApiLeaderboardRecordList> GetTopScores(string gameId, int limit = 10)
{
    try
    {
        string leaderboardId = $"leaderboard_{gameId}";
        
        var records = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, limit);
        
        Debug.Log($"Retrieved {records.Records.Count()} top scores");
        
        foreach (var record in records.Records)
        {
            Debug.Log($"Rank {record.Rank}: {record.Username} - Score: {record.Score}");
        }
        
        return records;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get leaderboard: {ex.Message}");
        return null;
    }
}

// Get records around the current player
public async Task<IApiLeaderboardRecordList> GetScoresAroundPlayer(string gameId, int limit = 10)
{
    try
    {
        string leaderboardId = $"leaderboard_{gameId}";
        
        var records = await client.ListLeaderboardRecordsAroundOwnerAsync(
            session, 
            leaderboardId, 
            session.UserId, 
            limit
        );
        
        return records;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get leaderboard around player: {ex.Message}");
        return null;
    }
}
```

---

## Complete Unity Examples

### Complete Wallet Integration Example

```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private string gameId = "fc3db911-42e8-4f95-96d1-41c3e7b9812d"; // Your game ID
    
    async void Start()
    {
        // Initialize Nakama
        client = new Client("http", "127.0.0.1", 7350, "defaultkey");
        
        // Authenticate
        session = await client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
        Debug.Log("Connected to Nakama");
        
        // Initialize wallet system
        await InitializeWallet();
    }
    
    private async Task InitializeWallet()
    {
        // Step 1: Get or create user wallet
        var walletPayload = new { }; // Empty for Nakama-authenticated users
        var walletResult = await client.RpcAsync(session, "get_user_wallet", JsonUtility.ToJson(walletPayload));
        var wallet = JsonUtility.FromJson<WalletResponse>(walletResult.Payload);
        
        if (wallet.success)
        {
            Debug.Log($"Wallet initialized: {wallet.walletId}");
            
            // Step 2: Link wallet to this game
            var linkPayload = new { gameId = gameId };
            var linkResult = await client.RpcAsync(session, "link_wallet_to_game", JsonUtility.ToJson(linkPayload));
            var linkResponse = JsonUtility.FromJson<LinkWalletResponse>(linkResult.Payload);
            
            if (linkResponse.success)
            {
                Debug.Log($"Wallet linked to game. Total games: {linkResponse.gamesLinked.Length}");
            }
        }
    }
    
    // Example: Submit score when player completes a level
    public async void OnLevelComplete(long score)
    {
        // Submit to game-specific leaderboard
        await client.WriteLeaderboardRecordAsync(session, $"leaderboard_{gameId}", score);
        
        // Also submit to global leaderboard
        await client.WriteLeaderboardRecordAsync(session, "leaderboard_global", score);
        
        Debug.Log($"Score {score} submitted to leaderboards");
    }
}
```

### Complete Leaderboard UI Example

```csharp
using Nakama;
using System.Linq;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;

public class LeaderboardUI : MonoBehaviour
{
    [SerializeField] private Text leaderboardText;
    [SerializeField] private Button refreshButton;
    
    private IClient client;
    private ISession session;
    private string gameId = "fc3db911-42e8-4f95-96d1-41c3e7b9812d";
    
    void Start()
    {
        refreshButton.onClick.AddListener(() => RefreshLeaderboard());
    }
    
    public async void RefreshLeaderboard()
    {
        try
        {
            string leaderboardId = $"leaderboard_{gameId}";
            var records = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, 10);
            
            // Build leaderboard display
            string display = "=== TOP 10 PLAYERS ===\n\n";
            
            foreach (var record in records.Records)
            {
                display += $"{record.Rank}. {record.Username} - {record.Score:N0}\n";
            }
            
            leaderboardText.text = display;
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Failed to refresh leaderboard: {ex.Message}");
            leaderboardText.text = "Failed to load leaderboard";
        }
    }
}
```

---

## Error Handling

All RPC calls can throw exceptions. Always wrap calls in try-catch blocks:

```csharp
public async Task SafeRpcCall()
{
    try
    {
        var result = await client.RpcAsync(session, "get_user_wallet", "{}");
        // Process result
    }
    catch (ApiResponseException ex)
    {
        // Handle specific API errors
        Debug.LogError($"API Error [{ex.StatusCode}]: {ex.Message}");
        
        switch (ex.StatusCode)
        {
            case 401:
                Debug.LogError("Unauthorized - session may have expired");
                // Re-authenticate user
                break;
            case 404:
                Debug.LogError("RPC not found - check RPC name");
                break;
            case 500:
                Debug.LogError("Server error - try again later");
                break;
        }
    }
    catch (System.Exception ex)
    {
        // Handle general errors
        Debug.LogError($"Unexpected error: {ex.Message}");
    }
}
```

**Common Error Responses:**

```json
{
  "success": false,
  "error": "Invalid JWT token format",
  "operation": "get_user_wallet"
}
```

---

## Best Practices

### 1. Connection Management

```csharp
public class NakamaConnection : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private ISocket socket;
    
    public async Task Connect()
    {
        // Create client (reuse for entire game session)
        client = new Client("http", "127.0.0.1", 7350, "defaultkey");
        
        // Authenticate (creates session)
        session = await client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
        
        // Optional: Create socket for realtime features
        socket = client.NewSocket();
        await socket.ConnectAsync(session);
    }
    
    void OnApplicationQuit()
    {
        // Clean up
        socket?.CloseAsync();
    }
}
```

### 2. Session Persistence

Save session tokens to avoid re-authentication:

```csharp
public async Task SaveSession(ISession session)
{
    PlayerPrefs.SetString("nakama.session", session.AuthToken);
    PlayerPrefs.SetString("nakama.refreshToken", session.RefreshToken);
    PlayerPrefs.Save();
}

public async Task<ISession> RestoreSession()
{
    var authToken = PlayerPrefs.GetString("nakama.session");
    var refreshToken = PlayerPrefs.GetString("nakama.refreshToken");
    
    if (string.IsNullOrEmpty(authToken))
        return null;
    
    var session = Session.Restore(authToken, refreshToken);
    
    // Check if session is expired
    if (session.IsExpired)
    {
        // Refresh the session
        session = await client.SessionRefreshAsync(session);
        await SaveSession(session);
    }
    
    return session;
}
```

### 3. Retry Logic

Implement retry for network failures:

```csharp
public async Task<T> RetryRpc<T>(string rpcId, string payload, int maxRetries = 3)
{
    int retries = 0;
    
    while (retries < maxRetries)
    {
        try
        {
            var result = await client.RpcAsync(session, rpcId, payload);
            return JsonUtility.FromJson<T>(result.Payload);
        }
        catch (ApiResponseException ex) when (ex.StatusCode >= 500)
        {
            retries++;
            if (retries >= maxRetries) throw;
            
            await Task.Delay(1000 * retries); // Exponential backoff
        }
    }
    
    throw new System.Exception("Max retries exceeded");
}
```

### 4. Caching

Cache frequently accessed data:

```csharp
public class WalletCache
{
    private WalletInfo cachedWallet;
    private float cacheTime;
    private const float CACHE_DURATION = 300f; // 5 minutes
    
    public async Task<WalletInfo> GetWallet(bool forceRefresh = false)
    {
        if (!forceRefresh && cachedWallet != null && Time.time - cacheTime < CACHE_DURATION)
        {
            return cachedWallet;
        }
        
        // Fetch fresh data
        var result = await client.RpcAsync(session, "get_user_wallet", "{}");
        var response = JsonUtility.FromJson<WalletResponse>(result.Payload);
        
        if (response.success)
        {
            cachedWallet = new WalletInfo
            {
                WalletId = response.walletId,
                UserId = response.userId,
                GamesLinked = response.gamesLinked,
                CreatedAt = response.createdAt
            };
            cacheTime = Time.time;
        }
        
        return cachedWallet;
    }
}
```

---

## Summary

You now have access to all Nakama features for your Unity game:

| Feature | RPC Name | Purpose |
|---------|----------|---------|
| Get User Wallet | `get_user_wallet` | Retrieve or create player wallet |
| Link Wallet to Game | `link_wallet_to_game` | Associate wallet with game |
| Get Wallet Registry | `get_wallet_registry` | Admin: view all wallets |
| Create Leaderboards | `create_all_leaderboards_persistent` | Setup game leaderboards |

**Next Steps:**
1. Install Nakama Unity SDK
2. Copy the example code into your project
3. Replace `127.0.0.1` with your Nakama server address
4. Replace `gameId` with your actual game ID
5. Test each feature individually

**Need Help?**
- [Nakama Documentation](https://heroiclabs.com/docs)
- [Unity SDK Examples](https://github.com/heroiclabs/nakama-unity)
- [Nakama Forum](https://forum.heroiclabs.com)

---

*Last Updated: 2025-11-13*
*Module Location: `/data/modules/index.js`*
