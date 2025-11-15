# Unity Quick Start Guide

## Overview

This guide will help you integrate your Unity game with Nakama in under 30 minutes using only your **gameID**.

## Prerequisites

- Unity 2020.3 or later
- Nakama Unity SDK (install via Unity Package Manager or .unitypackage)
- Your game's unique **Game ID** (UUID)

## Installation

### Method 1: Unity Package Manager (Recommended)

1. Open Unity Package Manager (Window > Package Manager)
2. Click '+' > Add package from git URL
3. Enter: `https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama`
4. Click 'Add'

### Method 2: .unitypackage

1. Download the latest Nakama Unity SDK from [GitHub Releases](https://github.com/heroiclabs/nakama-unity/releases)
2. Import into Unity: Assets > Import Package > Custom Package

## Quick Setup (5 Minutes)

### Step 1: Configure Nakama Client

Create a new script called `NakamaConnection.cs`:

```csharp
using Nakama;
using UnityEngine;
using System.Threading.Tasks;

public class NakamaConnection : MonoBehaviour
{
    private const string ServerKey = "defaultkey"; // Change to your server key
    private const string Host = "your-nakama-server.com"; // Change to your server
    private const int Port = 7350;
    private const string GameId = "your-game-uuid"; // YOUR GAME ID HERE
    
    private static NakamaConnection instance;
    public static NakamaConnection Instance => instance;
    
    private IClient client;
    private ISession session;
    
    public IClient Client => client;
    public ISession Session => session;
    public string DeviceId { get; private set; }
    public string CurrentGameId => GameId;
    
    void Awake()
    {
        if (instance == null)
        {
            instance = this;
            DontDestroyOnLoad(gameObject);
        }
        else
        {
            Destroy(gameObject);
        }
    }
    
    async void Start()
    {
        await Initialize();
    }
    
    async Task Initialize()
    {
        // Create client
        client = new Client("http", Host, Port, ServerKey);
        
        // Get or generate device ID
        DeviceId = GetDeviceId();
        
        // Authenticate
        await AuthenticateDevice();
        
        Debug.Log("Nakama initialized successfully!");
    }
    
    string GetDeviceId()
    {
        const string KEY = "nakama_device_id";
        
        if (!PlayerPrefs.HasKey(KEY))
        {
            string newId = System.Guid.NewGuid().ToString();
            PlayerPrefs.SetString(KEY, newId);
            PlayerPrefs.Save();
        }
        
        return PlayerPrefs.GetString(KEY);
    }
    
    async Task AuthenticateDevice()
    {
        try
        {
            session = await client.AuthenticateDeviceAsync(DeviceId);
            Debug.Log($"Authenticated with user ID: {session.UserId}");
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"Authentication failed: {ex.Message}");
        }
    }
}
```

### Step 2: Create or Sync User Identity

Create `PlayerIdentity.cs`:

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class IdentityResponse
{
    public bool success;
    public bool created;
    public string username;
    public string device_id;
    public string game_id;
    public string wallet_id;
    public string global_wallet_id;
}

public class PlayerIdentity : MonoBehaviour
{
    async void Start()
    {
        await CreateOrSyncUser("PlayerName");
    }
    
    public async Task<IdentityResponse> CreateOrSyncUser(string username)
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, string>
        {
            { "username", username },
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "create_or_sync_user", payloadJson);
            
            var response = JsonUtility.FromJson<IdentityResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"User {(response.created ? "created" : "synced")}: {response.username}");
                Debug.Log($"Wallet ID: {response.wallet_id}");
                Debug.Log($"Global Wallet ID: {response.global_wallet_id}");
            }
            
            return response;
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to create/sync user: {ex.Message}");
            return null;
        }
    }
}
```

### Step 3: Submit Scores

Create `ScoreManager.cs`:

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class ScoreSubmissionResponse
{
    public bool success;
    public int score;
    public int wallet_balance;
    public string[] leaderboards_updated;
    public string game_id;
}

public class ScoreManager : MonoBehaviour
{
    public async Task<ScoreSubmissionResponse> SubmitScore(int score)
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, object>
        {
            { "score", score },
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "submit_score_and_sync", payloadJson);
            
            var response = JsonUtility.FromJson<ScoreSubmissionResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"Score {response.score} submitted successfully!");
                Debug.Log($"Updated {response.leaderboards_updated.Length} leaderboards");
                Debug.Log($"New wallet balance: {response.wallet_balance}");
            }
            
            return response;
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to submit score: {ex.Message}");
            return null;
        }
    }
    
    // Example usage
    public async void OnGameEnd(int finalScore)
    {
        await SubmitScore(finalScore);
    }
}
```

### Step 4: Display Leaderboards

Create `LeaderboardDisplay.cs`:

```csharp
using Nakama;
using UnityEngine;
using UnityEngine.UI;
using System.Threading.Tasks;

public class LeaderboardDisplay : MonoBehaviour
{
    [SerializeField] private Transform leaderboardContainer;
    [SerializeField] private GameObject leaderboardEntryPrefab;
    [SerializeField] private Text titleText;
    
    async void Start()
    {
        await ShowGameLeaderboard();
    }
    
    public async Task ShowGameLeaderboard()
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        string leaderboardId = $"leaderboard_{gameId}";
        
        try
        {
            var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, 100);
            
            titleText.text = "Game Leaderboard";
            DisplayRecords(result);
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to load leaderboard: {ex.Message}");
        }
    }
    
    public async Task ShowDailyLeaderboard()
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        string leaderboardId = $"leaderboard_{gameId}_daily";
        
        var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId);
        titleText.text = "Daily Leaderboard";
        DisplayRecords(result);
    }
    
    public async Task ShowGlobalLeaderboard()
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        
        string leaderboardId = "leaderboard_global";
        
        var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId);
        titleText.text = "Global Leaderboard";
        DisplayRecords(result);
    }
    
    void DisplayRecords(IApiLeaderboardRecordList records)
    {
        // Clear existing
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }
        
        // Create entries
        foreach (var record in records.Records)
        {
            var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
            
            // Set rank, username, score (assumes Text components exist)
            entry.transform.Find("Rank").GetComponent<Text>().text = $"#{record.Rank}";
            entry.transform.Find("Username").GetComponent<Text>().text = record.Username;
            entry.transform.Find("Score").GetComponent<Text>().text = record.Score.ToString();
        }
    }
}
```

### Step 5: Manage Wallets

Create `WalletManager.cs`:

```csharp
using Nakama;
using UnityEngine;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;

[Serializable]
public class WalletData
{
    public string wallet_id;
    public int balance;
    public string currency;
    public string game_id;
}

[Serializable]
public class WalletResponse
{
    public bool success;
    public WalletData game_wallet;
    public WalletData global_wallet;
}

public class WalletManager : MonoBehaviour
{
    private WalletResponse currentWallets;
    
    async void Start()
    {
        await LoadWallets();
    }
    
    public async Task<WalletResponse> LoadWallets()
    {
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var deviceId = NakamaConnection.Instance.DeviceId;
        var gameId = NakamaConnection.Instance.CurrentGameId;
        
        var payload = new Dictionary<string, string>
        {
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        try
        {
            var payloadJson = JsonUtility.ToJson(payload);
            var result = await client.RpcAsync(session, "create_or_get_wallet", payloadJson);
            
            currentWallets = JsonUtility.FromJson<WalletResponse>(result.Payload);
            
            if (currentWallets.success)
            {
                Debug.Log($"Game Wallet: {currentWallets.game_wallet.balance} {currentWallets.game_wallet.currency}");
                Debug.Log($"Global Wallet: {currentWallets.global_wallet.balance} {currentWallets.global_wallet.currency}");
            }
            
            return currentWallets;
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to load wallets: {ex.Message}");
            return null;
        }
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

## Complete Integration Flow

### 1. Game Start
```csharp
async void Start()
{
    // 1. Initialize Nakama connection
    await NakamaConnection.Instance.Initialize();
    
    // 2. Create or sync user identity
    var identity = await GetComponent<PlayerIdentity>().CreateOrSyncUser("PlayerName");
    
    // 3. Load wallet data
    var wallets = await GetComponent<WalletManager>().LoadWallets();
    
    // 4. Load leaderboards
    await GetComponent<LeaderboardDisplay>().ShowGameLeaderboard();
}
```

### 2. Game End
```csharp
async void OnGameEnd(int finalScore)
{
    // 1. Submit score (updates leaderboards and wallet)
    var scoreResponse = await GetComponent<ScoreManager>().SubmitScore(finalScore);
    
    // 2. Refresh leaderboard display
    await GetComponent<LeaderboardDisplay>().ShowGameLeaderboard();
    
    // 3. Show updated wallet balance
    await GetComponent<WalletManager>().LoadWallets();
    int newBalance = GetComponent<WalletManager>().GetGameWalletBalance();
    Debug.Log($"Your new balance: {newBalance}");
}
```

## Common Patterns

### Loading State
```csharp
public class LoadingManager : MonoBehaviour
{
    [SerializeField] private GameObject loadingPanel;
    
    public async Task ExecuteWithLoading(Func<Task> action)
    {
        loadingPanel.SetActive(true);
        try
        {
            await action();
        }
        finally
        {
            loadingPanel.SetActive(false);
        }
    }
}

// Usage
await loadingManager.ExecuteWithLoading(async () =>
{
    await scoreManager.SubmitScore(1000);
});
```

### Error Handling
```csharp
public async Task SafeRpcCall<T>(Func<Task<T>> rpcCall, Action<T> onSuccess, Action<string> onError)
{
    try
    {
        var result = await rpcCall();
        onSuccess?.Invoke(result);
    }
    catch (Exception ex)
    {
        Debug.LogError($"RPC failed: {ex.Message}");
        onError?.Invoke(ex.Message);
    }
}

// Usage
await SafeRpcCall(
    async () => await scoreManager.SubmitScore(1000),
    response => Debug.Log("Success!"),
    error => ShowErrorDialog(error)
);
```

### Caching
```csharp
public class CachedLeaderboardManager : MonoBehaviour
{
    private Dictionary<string, IApiLeaderboardRecordList> cache = new Dictionary<string, IApiLeaderboardRecordList>();
    private Dictionary<string, float> cacheTimestamps = new Dictionary<string, float>();
    private const float CACHE_DURATION = 60f; // seconds
    
    public async Task<IApiLeaderboardRecordList> GetLeaderboard(string leaderboardId, bool forceRefresh = false)
    {
        if (!forceRefresh && cache.ContainsKey(leaderboardId))
        {
            float age = Time.time - cacheTimestamps[leaderboardId];
            if (age < CACHE_DURATION)
            {
                return cache[leaderboardId];
            }
        }
        
        var client = NakamaConnection.Instance.Client;
        var session = NakamaConnection.Instance.Session;
        var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId);
        
        cache[leaderboardId] = result;
        cacheTimestamps[leaderboardId] = Time.time;
        
        return result;
    }
}
```

## Testing

### Test in Unity Editor
```csharp
#if UNITY_EDITOR
[ContextMenu("Test Create User")]
void TestCreateUser()
{
    StartCoroutine(TestCreateUserCoroutine());
}

IEnumerator TestCreateUserCoroutine()
{
    var task = GetComponent<PlayerIdentity>().CreateOrSyncUser("TestPlayer");
    yield return new WaitUntil(() => task.IsCompleted);
    
    if (task.Result != null && task.Result.success)
    {
        Debug.Log("✅ User creation test passed!");
    }
    else
    {
        Debug.LogError("❌ User creation test failed!");
    }
}
#endif
```

## Troubleshooting

### Issue: "Connection refused"
**Solution**: Check server host and port in `NakamaConnection.cs`

### Issue: "Identity not found"
**Solution**: Call `create_or_sync_user` before calling other RPCs

### Issue: "Invalid JSON payload"
**Solution**: Ensure your payload objects are serializable and use `JsonUtility.ToJson()`

### Issue: Leaderboard shows no data
**Solution**: 
1. Ensure leaderboards were created via admin RPCs
2. Submit at least one score
3. Check leaderboard ID matches exactly

## Next Steps

- [Read Full Identity Documentation](../identity.md)
- [Read Full Wallet Documentation](../wallets.md)
- [Read Full Leaderboard Documentation](../leaderboards.md)
- [See Complete Sample Game Tutorial](../sample-game/README.md)
- [Explore API Reference](../api/README.md)

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review the [full documentation](../README.md)
3. Open an issue on GitHub
