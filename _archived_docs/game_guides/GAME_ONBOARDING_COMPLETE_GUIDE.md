# Complete Game Onboarding Guide - New & Existing Games

**Last Updated**: November 16, 2025  
**Version**: 2.0.0

## Table of Contents

1. [Introduction](#introduction)
2. [Before You Start](#before-you-start)
3. [New Game Integration (Full Guide)](#new-game-integration)
4. [Existing Game Migration](#existing-game-migration)
5. [Step-by-Step Implementation](#step-by-step-implementation)
6. [Testing Your Integration](#testing-your-integration)
7. [Production Checklist](#production-checklist)
8. [Common Issues & Solutions](#common-issues--solutions)

---

## Introduction

This guide walks you through integrating a game (new or existing) with the Nakama multi-game backend platform. Whether you're building a new game from scratch or migrating an existing one, this document provides everything you need.

### What You'll Achieve

By the end of this guide, your game will have:
- ✅ User authentication & identity management
- ✅ Wallet system (game currency + global currency)
- ✅ Multi-period leaderboards (daily, weekly, monthly, all-time, global)
- ✅ Daily rewards with streak tracking
- ✅ Daily missions system
- ✅ Friends & social features
- ✅ Cloud save/load functionality
- ✅ Analytics tracking
- ✅ Push notifications
- ✅ Groups/guilds (optional)
- ✅ Chat/messaging (optional)

---

## Before You Start

### Prerequisites

#### 1. Development Environment
- **Unity**: 2020.3 LTS or newer
- **C# Knowledge**: Basic async/await understanding
- **Nakama Unity SDK**: Install from Package Manager

#### 2. Credentials & Configuration

You need the following information:

| Item | Example | Where to Get It |
|------|---------|----------------|
| **Game ID (UUID)** | `126bf539-dae2-4bcf-964d-316c0fa1f92b` | Register your game with platform admin |
| **Nakama Server URL** | `nakama-rest.intelli-verse-x.ai` | Provided by platform admin |
| **Server Port** | `443` (HTTPS) or `7350` (HTTP) | Provided by platform admin |
| **Server Key** | `defaultkey` | Provided by platform admin |
| **Scheme** | `https` or `http` | Use `https` for production |

#### 3. Install Nakama Unity SDK

**Method 1: Unity Package Manager**
```
1. Open Window > Package Manager
2. Click + > Add package from git URL
3. Enter: https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama
4. Click Add
```

**Method 2: Download Release**
```
1. Visit: https://github.com/heroiclabs/nakama-unity/releases
2. Download latest .unitypackage
3. Import into your project
```

#### 4. Install JSON.NET (Newtonsoft)

```
1. Window > Package Manager
2. Search for "Json.NET"
3. Install "Newtonsoft Json" package
```

---

## New Game Integration

### Phase 1: Basic Setup (30 minutes)

#### Step 1: Create NakamaManager Script

Create `Assets/Scripts/Backend/NakamaManager.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using Nakama;
using Newtonsoft.Json;

namespace YourGame.Backend
{
    /// <summary>
    /// Main manager for all Nakama backend operations
    /// Handles authentication, RPCs, and connection management
    /// </summary>
    public class NakamaManager : MonoBehaviour
    {
        #region Configuration
        
        [Header("Nakama Server Configuration")]
        [SerializeField] private string scheme = "https";
        [SerializeField] private string host = "nakama-rest.intelli-verse-x.ai";
        [SerializeField] private int port = 443;
        [SerializeField] private string serverKey = "defaultkey";
        
        [Header("Game Configuration")]
        [SerializeField] private string gameId = "YOUR-GAME-UUID-HERE";
        [SerializeField] private string gameName = "YourGameName";
        
        #endregion
        
        #region Private Fields
        
        private IClient _client;
        private ISession _session;
        private ISocket _socket;
        private bool _isInitialized = false;
        
        // Session storage keys
        private const string PREF_AUTH_TOKEN = "nakama_auth_token";
        private const string PREF_REFRESH_TOKEN = "nakama_refresh_token";
        
        #endregion
        
        #region Public Properties
        
        public static NakamaManager Instance { get; private set; }
        
        public IClient Client => _client;
        public ISession Session => _session;
        public ISocket Socket => _socket;
        public bool IsInitialized => _isInitialized;
        public string GameId => gameId;
        
        #endregion
        
        #region Unity Lifecycle
        
        private void Awake()
        {
            // Singleton pattern
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
                return;
            }
        }
        
        private async void Start()
        {
            await InitializeAsync();
        }
        
        private void OnApplicationQuit()
        {
            Cleanup();
        }
        
        #endregion
        
        #region Initialization
        
        /// <summary>
        /// Initialize Nakama client and authenticate user
        /// </summary>
        public async Task<bool> InitializeAsync()
        {
            if (_isInitialized)
            {
                Debug.Log("[Nakama] Already initialized");
                return true;
            }
            
            try
            {
                Debug.Log($"[Nakama] Initializing for game: {gameName} ({gameId})");
                
                // Step 1: Create client
                _client = new Client(scheme, host, port, serverKey, UnityWebRequestAdapter.Instance);
                Debug.Log("[Nakama] ✓ Client created");
                
                // Step 2: Authenticate
                bool authenticated = await AuthenticateAsync();
                if (!authenticated)
                {
                    Debug.LogError("[Nakama] Authentication failed");
                    return false;
                }
                
                // Step 3: Sync user identity
                bool synced = await SyncUserIdentity();
                if (!synced)
                {
                    Debug.LogError("[Nakama] User identity sync failed");
                    return false;
                }
                
                // Step 4: Connect socket for realtime features (optional)
                await ConnectSocketAsync();
                
                _isInitialized = true;
                Debug.Log("[Nakama] ✓ Initialization complete!");
                
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Nakama] Initialization failed: {ex.Message}");
                return false;
            }
        }
        
        #endregion
        
        #region Authentication
        
        /// <summary>
        /// Authenticate user with device ID
        /// Attempts to restore session from PlayerPrefs first
        /// </summary>
        private async Task<bool> AuthenticateAsync()
        {
            try
            {
                // Try to restore existing session
                string authToken = PlayerPrefs.GetString(PREF_AUTH_TOKEN, "");
                
                if (!string.IsNullOrEmpty(authToken))
                {
                    var restoredSession = Session.Restore(authToken);
                    
                    if (restoredSession != null && !restoredSession.IsExpired)
                    {
                        _session = restoredSession;
                        Debug.Log("[Nakama] ✓ Session restored");
                        return true;
                    }
                    
                    Debug.Log("[Nakama] Session expired, re-authenticating...");
                }
                
                // New authentication
                string deviceId = SystemInfo.deviceUniqueIdentifier;
                string username = PlayerPrefs.GetString("player_username", $"Player_{deviceId.Substring(0, 8)}");
                
                Debug.Log($"[Nakama] Authenticating device: {deviceId}");
                
                _session = await _client.AuthenticateDeviceAsync(deviceId, username, create: true);
                
                // Save session
                PlayerPrefs.SetString(PREF_AUTH_TOKEN, _session.AuthToken);
                PlayerPrefs.SetString(PREF_REFRESH_TOKEN, _session.RefreshToken);
                PlayerPrefs.Save();
                
                Debug.Log($"[Nakama] ✓ Authenticated! User ID: {_session.UserId}");
                return true;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Nakama] Authentication error: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Sync user identity with backend (creates wallets, links to game)
        /// </summary>
        private async Task<bool> SyncUserIdentity()
        {
            try
            {
                Debug.Log("[Nakama] Syncing user identity...");
                
                var payload = new
                {
                    username = _session.Username,
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = gameId
                };
                
                var result = await _client.RpcAsync(_session, "create_or_sync_user",
                    JsonConvert.SerializeObject(payload));
                
                var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
                
                if (response["success"].ToString() == "True")
                {
                    Debug.Log($"[Nakama] ✓ Identity synced");
                    Debug.Log($"[Nakama]   Username: {response["username"]}");
                    Debug.Log($"[Nakama]   Wallet ID: {response["wallet_id"]}");
                    Debug.Log($"[Nakama]   Global Wallet ID: {response["global_wallet_id"]}");
                    return true;
                }
                
                Debug.LogError($"[Nakama] Identity sync failed: {response["error"]}");
                return false;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Nakama] Identity sync error: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Connect socket for realtime features
        /// </summary>
        private async Task ConnectSocketAsync()
        {
            try
            {
                _socket = _client.NewSocket();
                await _socket.ConnectAsync(_session, appearOnline: true);
                Debug.Log("[Nakama] ✓ Socket connected");
            }
            catch (Exception ex)
            {
                Debug.LogWarning($"[Nakama] Socket connection failed: {ex.Message}");
                // Socket is optional, don't fail initialization
            }
        }
        
        #endregion
        
        #region Session Management
        
        /// <summary>
        /// Ensure session is valid, refresh if needed
        /// </summary>
        public async Task<bool> EnsureSessionValid()
        {
            if (_session == null || _session.IsExpired)
            {
                Debug.Log("[Nakama] Session invalid, re-authenticating...");
                return await AuthenticateAsync();
            }
            
            return true;
        }
        
        #endregion
        
        #region Cleanup
        
        private void Cleanup()
        {
            if (_socket != null && _socket.IsConnected)
            {
                _socket.CloseAsync();
            }
        }
        
        #endregion
    }
}
```

#### Step 2: Configure Your Game Settings

1. Create empty GameObject in your first scene: `BackendManager`
2. Add `NakamaManager` component
3. Set configuration:
   - **Game ID**: Your assigned UUID
   - **Game Name**: Your game's name
   - **Host**: Server URL (no http://)
   - **Port**: 443 for HTTPS, 7350 for HTTP
   - **Scheme**: "https" for production
   - **Server Key**: Provided key

#### Step 3: Test Basic Connection

Create a test button in your UI:

```csharp
using UnityEngine;
using UnityEngine.UI;
using YourGame.Backend;

public class BackendTest : MonoBehaviour
{
    [SerializeField] private Button testButton;
    [SerializeField] private Text statusText;
    
    private void Start()
    {
        testButton.onClick.AddListener(TestConnection);
    }
    
    private async void TestConnection()
    {
        statusText.text = "Connecting...";
        
        if (NakamaManager.Instance.IsInitialized)
        {
            statusText.text = "✓ Connected!\n" +
                            $"User ID: {NakamaManager.Instance.Session.UserId}";
        }
        else
        {
            statusText.text = "✗ Connection failed";
        }
    }
}
```

**Test**: Run the game, click the button. You should see "✓ Connected!" and your user ID.

---

### Phase 2: Wallet Integration (20 minutes)

#### Step 1: Create Wallet Manager

Create `Assets/Scripts/Backend/WalletManager.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json;

namespace YourGame.Backend
{
    /// <summary>
    /// Manages player wallets (game currency + global currency)
    /// </summary>
    public class WalletManager : MonoBehaviour
    {
        public static WalletManager Instance { get; private set; }
        
        // Wallet balances
        private long _gameBalance = 0;
        private long _globalBalance = 0;
        
        // Events
        public event Action<long> OnGameBalanceChanged;
        public event Action<long> OnGlobalBalanceChanged;
        
        public long GameBalance => _gameBalance;
        public long GlobalBalance => _globalBalance;
        
        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }
        
        /// <summary>
        /// Load current wallet balances from server
        /// </summary>
        public async Task<bool> LoadWallets()
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return false;
                
                var payload = new
                {
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "create_or_get_wallet",
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<WalletResponse>(result.Payload);
                
                if (response.success)
                {
                    _gameBalance = response.game_wallet.balance;
                    _globalBalance = response.global_wallet.balance;
                    
                    OnGameBalanceChanged?.Invoke(_gameBalance);
                    OnGlobalBalanceChanged?.Invoke(_globalBalance);
                    
                    Debug.Log($"[Wallet] Loaded - Game: {_gameBalance}, Global: {_globalBalance}");
                    return true;
                }
                
                return false;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Wallet] Load failed: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Add currency to game wallet
        /// </summary>
        public async Task<bool> AddCurrency(long amount)
        {
            long newBalance = _gameBalance + amount;
            return await UpdateGameWallet(newBalance);
        }
        
        /// <summary>
        /// Spend currency from game wallet
        /// </summary>
        public async Task<bool> SpendCurrency(long amount)
        {
            if (_gameBalance < amount)
            {
                Debug.LogWarning("[Wallet] Insufficient balance");
                return false;
            }
            
            long newBalance = _gameBalance - amount;
            return await UpdateGameWallet(newBalance);
        }
        
        /// <summary>
        /// Update game wallet to specific balance
        /// </summary>
        private async Task<bool> UpdateGameWallet(long newBalance)
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return false;
                
                var payload = new
                {
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId,
                    balance = newBalance
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "wallet_update_game_wallet",
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<Dictionary<string, object>>(result.Payload);
                
                if (response["success"].ToString() == "True")
                {
                    _gameBalance = newBalance;
                    OnGameBalanceChanged?.Invoke(_gameBalance);
                    Debug.Log($"[Wallet] Updated to: {_gameBalance}");
                    return true;
                }
                
                return false;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Wallet] Update failed: {ex.Message}");
                return false;
            }
        }
    }
    
    // Response models
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
        public string device_id;
        public string game_id;
        public long balance;
        public string currency;
        public string created_at;
        public string updated_at;
    }
    
    [Serializable]
    public class GlobalWallet
    {
        public string wallet_id;
        public string device_id;
        public string game_id;
        public long balance;
        public string currency;
        public string created_at;
        public string updated_at;
    }
}
```

#### Step 2: Create Wallet UI

Create `Assets/Scripts/UI/WalletUI.cs`:

```csharp
using UnityEngine;
using UnityEngine.UI;
using YourGame.Backend;

public class WalletUI : MonoBehaviour
{
    [SerializeField] private Text gameBalanceText;
    [SerializeField] private Text globalBalanceText;
    
    [Header("Test Buttons")]
    [SerializeField] private Button add100Button;
    [SerializeField] private Button spend50Button;
    [SerializeField] private Button refreshButton;
    
    private async void Start()
    {
        // Subscribe to balance changes
        WalletManager.Instance.OnGameBalanceChanged += UpdateGameBalanceUI;
        WalletManager.Instance.OnGlobalBalanceChanged += UpdateGlobalBalanceUI;
        
        // Setup button listeners
        add100Button.onClick.AddListener(async () => await WalletManager.Instance.AddCurrency(100));
        spend50Button.onClick.AddListener(async () => await WalletManager.Instance.SpendCurrency(50));
        refreshButton.onClick.AddListener(async () => await WalletManager.Instance.LoadWallets());
        
        // Load initial balances
        await WalletManager.Instance.LoadWallets();
    }
    
    private void UpdateGameBalanceUI(long balance)
    {
        gameBalanceText.text = $"Coins: {balance}";
    }
    
    private void UpdateGlobalBalanceUI(long balance)
    {
        globalBalanceText.text = $"Global: {balance}";
    }
    
    private void OnDestroy()
    {
        WalletManager.Instance.OnGameBalanceChanged -= UpdateGameBalanceUI;
        WalletManager.Instance.OnGlobalBalanceChanged -= UpdateGlobalBalanceUI;
    }
}
```

**Test**: 
1. Add WalletManager to BackendManager GameObject
2. Create UI with Text elements and Buttons
3. Assign references in WalletUI
4. Run game, test adding/spending currency

---

### Phase 3: Leaderboard Integration (30 minutes)

#### Step 1: Create Leaderboard Manager

Create `Assets/Scripts/Backend/LeaderboardManager.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json;

namespace YourGame.Backend
{
    /// <summary>
    /// Manages leaderboard submissions and retrieval
    /// Supports: daily, weekly, monthly, all-time, global
    /// </summary>
    public class LeaderboardManager : MonoBehaviour
    {
        public static LeaderboardManager Instance { get; private set; }
        
        // Events
        public event Action<AllLeaderboardsData> OnLeaderboardsLoaded;
        public event Action<int> OnScoreSubmitted;
        
        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }
        
        /// <summary>
        /// Submit score to all leaderboards
        /// </summary>
        public async Task<bool> SubmitScore(int score, Dictionary<string, string> metadata = null)
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return false;
                
                var payload = new
                {
                    username = NakamaManager.Instance.Session.Username,
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId,
                    score = score,
                    subscore = 0,
                    metadata = metadata ?? new Dictionary<string, string>()
                };
                
                Debug.Log($"[Leaderboard] Submitting score: {score}");
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "submit_score_and_sync",
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<ScoreSubmissionResponse>(result.Payload);
                
                if (response.success)
                {
                    Debug.Log($"[Leaderboard] ✓ Score submitted!");
                    foreach (var res in response.results)
                    {
                        Debug.Log($"[Leaderboard]   {res.period}: Rank #{res.new_rank}");
                    }
                    
                    OnScoreSubmitted?.Invoke(score);
                    return true;
                }
                
                return false;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Leaderboard] Submit failed: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Get all leaderboard data
        /// </summary>
        public async Task<AllLeaderboardsData> GetAllLeaderboards(int limit = 10)
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return null;
                
                var payload = new
                {
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId,
                    limit = limit
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "get_all_leaderboards",
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<AllLeaderboardsData>(result.Payload);
                
                if (response.success)
                {
                    OnLeaderboardsLoaded?.Invoke(response);
                    return response;
                }
                
                return null;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[Leaderboard] Load failed: {ex.Message}");
                return null;
            }
        }
    }
    
    // Response Models
    [Serializable]
    public class ScoreSubmissionResponse
    {
        public bool success;
        public List<LeaderboardResult> results;
        public WalletSyncInfo wallet_sync;
    }
    
    [Serializable]
    public class LeaderboardResult
    {
        public string leaderboard_id;
        public string scope;
        public string period;
        public int new_rank;
        public int score;
    }
    
    [Serializable]
    public class WalletSyncInfo
    {
        public bool success;
        public long new_balance;
    }
    
    [Serializable]
    public class AllLeaderboardsData
    {
        public bool success;
        public LeaderboardData daily;
        public LeaderboardData weekly;
        public LeaderboardData monthly;
        public LeaderboardData alltime;
        public LeaderboardData global_alltime;
        public PlayerRanks player_ranks;
    }
    
    [Serializable]
    public class LeaderboardData
    {
        public string leaderboard_id;
        public List<LeaderboardRecord> records;
    }
    
    [Serializable]
    public class LeaderboardRecord
    {
        public int rank;
        public string owner_id;
        public string username;
        public long score;
        public long subscore;
        public int num_score;
    }
    
    [Serializable]
    public class PlayerRanks
    {
        public int? daily_rank;
        public int? weekly_rank;
        public int? monthly_rank;
        public int? alltime_rank;
        public int? global_rank;
    }
}
```

#### Step 2: Create Leaderboard UI

Create `Assets/Scripts/UI/LeaderboardUI.cs`:

```csharp
using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;
using YourGame.Backend;

public class LeaderboardUI : MonoBehaviour
{
    [Header("Tab Buttons")]
    [SerializeField] private Button dailyTab;
    [SerializeField] private Button weeklyTab;
    [SerializeField] private Button monthlyTab;
    [SerializeField] private Button alltimeTab;
    
    [Header("Display")]
    [SerializeField] private Transform recordsContainer;
    [SerializeField] private GameObject recordPrefab;
    [SerializeField] private Text playerRankText;
    
    [Header("Test")]
    [SerializeField] private Button submitScoreButton;
    [SerializeField] private InputField scoreInput;
    
    private AllLeaderboardsData _currentData;
    private string _currentPeriod = "daily";
    
    private void Start()
    {
        // Tab listeners
        dailyTab.onClick.AddListener(() => ShowPeriod("daily"));
        weeklyTab.onClick.AddListener(() => ShowPeriod("weekly"));
        monthlyTab.onClick.AddListener(() => ShowPeriod("monthly"));
        alltimeTab.onClick.AddListener(() => ShowPeriod("alltime"));
        
        // Test submit
        submitScoreButton.onClick.AddListener(TestSubmitScore);
        
        // Subscribe to events
        LeaderboardManager.Instance.OnLeaderboardsLoaded += OnDataLoaded;
        LeaderboardManager.Instance.OnScoreSubmitted += OnScoreSubmitted;
        
        // Initial load
        LoadLeaderboards();
    }
    
    private async void LoadLeaderboards()
    {
        await LeaderboardManager.Instance.GetAllLeaderboards(10);
    }
    
    private void OnDataLoaded(AllLeaderboardsData data)
    {
        _currentData = data;
        ShowPeriod(_currentPeriod);
        UpdatePlayerRank();
    }
    
    private void ShowPeriod(string period)
    {
        _currentPeriod = period;
        
        if (_currentData == null) return;
        
        // Clear existing
        foreach (Transform child in recordsContainer)
        {
            Destroy(child.gameObject);
        }
        
        // Get data for period
        LeaderboardData data = period switch
        {
            "daily" => _currentData.daily,
            "weekly" => _currentData.weekly,
            "monthly" => _currentData.monthly,
            "alltime" => _currentData.alltime,
            _ => _currentData.daily
        };
        
        if (data == null || data.records == null) return;
        
        // Display records
        foreach (var record in data.records)
        {
            var go = Instantiate(recordPrefab, recordsContainer);
            var entry = go.GetComponent<LeaderboardEntry>();
            entry.SetData(record);
        }
    }
    
    private void UpdatePlayerRank()
    {
        if (_currentData?.player_ranks == null) return;
        
        var ranks = _currentData.player_ranks;
        playerRankText.text = $"Your Ranks:\n" +
                              $"Daily: #{ranks.daily_rank ?? 999}\n" +
                              $"Weekly: #{ranks.weekly_rank ?? 999}\n" +
                              $"Monthly: #{ranks.monthly_rank ?? 999}\n" +
                              $"All-Time: #{ranks.alltime_rank ?? 999}";
    }
    
    private async void TestSubmitScore()
    {
        int score = int.Parse(scoreInput.text);
        await LeaderboardManager.Instance.SubmitScore(score);
    }
    
    private void OnScoreSubmitted(int score)
    {
        // Reload leaderboards after submission
        LoadLeaderboards();
    }
    
    private void OnDestroy()
    {
        LeaderboardManager.Instance.OnLeaderboardsLoaded -= OnDataLoaded;
        LeaderboardManager.Instance.OnScoreSubmitted -= OnScoreSubmitted;
    }
}

// Simple entry display
public class LeaderboardEntry : MonoBehaviour
{
    [SerializeField] private Text rankText;
    [SerializeField] private Text usernameText;
    [SerializeField] private Text scoreText;
    
    public void SetData(LeaderboardRecord record)
    {
        rankText.text = $"#{record.rank}";
        usernameText.text = record.username;
        scoreText.text = record.score.ToString();
    }
}
```

**Test**:
1. Add LeaderboardManager to BackendManager
2. Create leaderboard UI with tabs and record list
3. Create LeaderboardEntry prefab with rank/username/score texts
4. Run game, submit scores, view rankings

---

### Phase 4: Daily Rewards (15 minutes)

#### Step 1: Create Daily Rewards Manager

Create `Assets/Scripts/Backend/DailyRewardsManager.cs`:

```csharp
using System;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json;

namespace YourGame.Backend
{
    public class DailyRewardsManager : MonoBehaviour
    {
        public static DailyRewardsManager Instance { get; private set; }
        
        public event Action<DailyRewardData> OnRewardClaimed;
        public event Action<DailyRewardStatus> OnStatusChecked;
        
        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }
        
        /// <summary>
        /// Check if daily reward is available
        /// </summary>
        public async Task<DailyRewardStatus> CheckStatus()
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return null;
                
                var payload = new
                {
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "daily_reward_status",
                    JsonConvert.SerializeObject(payload)
                );
                
                var status = JsonConvert.DeserializeObject<DailyRewardStatus>(result.Payload);
                OnStatusChecked?.Invoke(status);
                return status;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[DailyReward] Status check failed: {ex.Message}");
                return null;
            }
        }
        
        /// <summary>
        /// Claim daily reward
        /// </summary>
        public async Task<DailyRewardData> ClaimReward()
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return null;
                
                var payload = new
                {
                    device_id = SystemInfo.deviceUniqueIdentifier,
                    game_id = NakamaManager.Instance.GameId
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "daily_reward_claim",
                    JsonConvert.SerializeObject(payload)
                );
                
                var reward = JsonConvert.DeserializeObject<DailyRewardData>(result.Payload);
                
                if (reward.success)
                {
                    Debug.Log($"[DailyReward] Claimed {reward.reward.amount} coins! Streak: {reward.streak.current}");
                    OnRewardClaimed?.Invoke(reward);
                }
                
                return reward;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[DailyReward] Claim failed: {ex.Message}");
                return null;
            }
        }
    }
    
    [Serializable]
    public class DailyRewardStatus
    {
        public bool success;
        public bool available;
        public int streak;
        public int next_reward;
        public float hours_until_next;
    }
    
    [Serializable]
    public class DailyRewardData
    {
        public bool success;
        public RewardInfo reward;
        public StreakInfo streak;
    }
    
    [Serializable]
    public class RewardInfo
    {
        public int amount;
        public string currency;
        public int streak_day;
        public int next_reward;
    }
    
    [Serializable]
    public class StreakInfo
    {
        public int current;
        public int best;
        public string last_claim_date;
    }
}
```

**Test**: Create UI button to claim daily reward, display streak info.

---

### Phase 5: Cloud Save/Load (10 minutes)

```csharp
using System;
using System.Threading.Tasks;
using UnityEngine;
using Newtonsoft.Json;

namespace YourGame.Backend
{
    public class CloudSaveManager : MonoBehaviour
    {
        public static CloudSaveManager Instance { get; private set; }
        
        private void Awake()
        {
            if (Instance == null)
            {
                Instance = this;
                DontDestroyOnLoad(gameObject);
            }
            else
            {
                Destroy(gameObject);
            }
        }
        
        /// <summary>
        /// Save data to cloud
        /// </summary>
        public async Task<bool> SaveData<T>(string key, T data)
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return false;
                
                var payload = new
                {
                    gameID = NakamaManager.Instance.GameId,
                    key = key,
                    value = data
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "quizverse_save_player_data", // or lasttolive_save_player_data
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<SaveDataResponse>(result.Payload);
                Debug.Log($"[CloudSave] Saved '{key}': {response.success}");
                return response.success;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CloudSave] Save failed: {ex.Message}");
                return false;
            }
        }
        
        /// <summary>
        /// Load data from cloud
        /// </summary>
        public async Task<T> LoadData<T>(string key)
        {
            try
            {
                if (!await NakamaManager.Instance.EnsureSessionValid())
                    return default;
                
                var payload = new
                {
                    gameID = NakamaManager.Instance.GameId,
                    key = key
                };
                
                var result = await NakamaManager.Instance.Client.RpcAsync(
                    NakamaManager.Instance.Session,
                    "quizverse_load_player_data", // or lasttolive_load_player_data
                    JsonConvert.SerializeObject(payload)
                );
                
                var response = JsonConvert.DeserializeObject<LoadDataResponse>(result.Payload);
                
                if (response.success)
                {
                    return JsonConvert.DeserializeObject<T>(response.data.value.ToString());
                }
                
                return default;
            }
            catch (Exception ex)
            {
                Debug.LogError($"[CloudSave] Load failed: {ex.Message}");
                return default;
            }
        }
    }
    
    [Serializable]
    public class SaveDataResponse
    {
        public bool success;
        public SaveDataInfo data;
    }
    
    [Serializable]
    public class SaveDataInfo
    {
        public string key;
        public bool saved;
    }
    
    [Serializable]
    public class LoadDataResponse
    {
        public bool success;
        public LoadDataInfo data;
    }
    
    [Serializable]
    public class LoadDataInfo
    {
        public string key;
        public object value;
        public string updatedAt;
    }
}
```

**Usage Example**:
```csharp
// Save player progress
await CloudSaveManager.Instance.SaveData("player_progress", new {
    level = 5,
    xp = 3500,
    unlocked_items = new[] { "item1", "item2" }
});

// Load player progress
var progress = await CloudSaveManager.Instance.LoadData<PlayerProgress>("player_progress");
```

---

## Existing Game Migration

### Assessment Checklist

Before migrating, assess your current game:

- [ ] Current authentication method?
- [ ] Existing save system?
- [ ] Current leaderboard implementation?
- [ ] Virtual currency system?
- [ ] Daily rewards?
- [ ] Analytics tracking?

### Migration Strategy

#### Option 1: Gradual Migration (Recommended)

1. **Phase 1**: Add Nakama alongside existing systems
2. **Phase 2**: Migrate authentication
3. **Phase 3**: Migrate save data
4. **Phase 4**: Migrate leaderboards
5. **Phase 5**: Migrate economy
6. **Phase 6**: Deprecate old systems

#### Option 2: Complete Overhaul

Replace all backend systems at once (risky, requires thorough testing).

### Data Migration Script

```csharp
using System;
using System.Threading.Tasks;
using UnityEngine;
using YourGame.Backend;

public class DataMigration : MonoBehaviour
{
    [SerializeField] private bool enableMigration = false;
    
    private async void Start()
    {
        if (!enableMigration) return;
        
        Debug.Log("[Migration] Starting data migration...");
        
        // Step 1: Migrate user profile
        await MigrateUserProfile();
        
        // Step 2: Migrate wallet balance
        await MigrateWalletBalance();
        
        // Step 3: Migrate player data
        await MigratePlayerData();
        
        // Step 4: Migrate leaderboard scores
        await MigrateLeaderboardScores();
        
        Debug.Log("[Migration] Complete!");
    }
    
    private async Task MigrateUserProfile()
    {
        // Get old profile from PlayerPrefs or old save system
        string oldUsername = PlayerPrefs.GetString("old_username", "MigratedPlayer");
        int oldLevel = PlayerPrefs.GetInt("old_level", 1);
        int oldXP = PlayerPrefs.GetInt("old_xp", 0);
        
        // Create/update profile in Nakama
        var payload = new
        {
            gameID = NakamaManager.Instance.GameId,
            displayName = oldUsername,
            level = oldLevel,
            xp = oldXP
        };
        
        await NakamaManager.Instance.Client.RpcAsync(
            NakamaManager.Instance.Session,
            "quizverse_update_user_profile",
            Newtonsoft.Json.JsonConvert.SerializeObject(payload)
        );
        
        Debug.Log("[Migration] ✓ Profile migrated");
    }
    
    private async Task MigrateWalletBalance()
    {
        // Get old currency balance
        int oldCoins = PlayerPrefs.GetInt("old_coins", 0);
        
        // Set in Nakama wallet
        await WalletManager.Instance.AddCurrency(oldCoins);
        
        Debug.Log($"[Migration] ✓ Migrated {oldCoins} coins");
    }
    
    private async Task MigratePlayerData()
    {
        // Example: Migrate settings
        var settings = new
        {
            soundVolume = PlayerPrefs.GetFloat("sound_volume", 0.8f),
            musicVolume = PlayerPrefs.GetFloat("music_volume", 0.6f),
            difficulty = PlayerPrefs.GetString("difficulty", "normal")
        };
        
        await CloudSaveManager.Instance.SaveData("settings", settings);
        
        Debug.Log("[Migration] ✓ Player data migrated");
    }
    
    private async Task MigrateLeaderboardScores()
    {
        // Get old high score
        int oldHighScore = PlayerPrefs.GetInt("high_score", 0);
        
        if (oldHighScore > 0)
        {
            await LeaderboardManager.Instance.SubmitScore(oldHighScore);
            Debug.Log($"[Migration] ✓ Migrated score: {oldHighScore}");
        }
    }
}
```

---

## Testing Your Integration

### Unit Testing

Create test scenes for each feature:

1. **Authentication Test**: Verify login works
2. **Wallet Test**: Add/spend currency
3. **Leaderboard Test**: Submit scores, view rankings
4. **Daily Rewards Test**: Claim rewards, check streaks
5. **Cloud Save Test**: Save/load data

### Integration Testing

Test complete user flows:

**New User Flow**:
1. Launch game
2. Auto-authenticate
3. Create identity
4. Claim daily reward
5. Play game
6. Submit score
7. View leaderboard
8. Close game
9. Relaunch (should restore session)

**Returning User Flow**:
1. Launch game
2. Restore session
3. Load wallets
4. Check daily reward status
5. Load player data
6. Continue playing

### Load Testing

Test with multiple accounts:
```csharp
// Create test accounts
for (int i = 0; i < 100; i++)
{
    string deviceId = $"test_device_{i}";
    // Authenticate and submit random scores
}
```

---

## Production Checklist

Before launching:

### Security
- [ ] Change `serverKey` from `defaultkey` to production key
- [ ] Use HTTPS (`scheme = "https"`)
- [ ] Validate all user inputs
- [ ] Implement rate limiting for RPCs
- [ ] Add anti-cheat measures for leaderboards

### Performance
- [ ] Cache leaderboard data (don't reload every frame)
- [ ] Batch RPC calls where possible
- [ ] Handle network errors gracefully
- [ ] Implement retry logic with exponential backoff
- [ ] Use async/await properly (don't block main thread)

### User Experience
- [ ] Show loading indicators during backend calls
- [ ] Display error messages to users
- [ ] Handle offline mode gracefully
- [ ] Implement session refresh before expiry
- [ ] Add confirmation dialogs for important actions

### Analytics
- [ ] Track all critical events
- [ ] Monitor RPC success/failure rates
- [ ] Log authentication issues
- [ ] Track daily active users
- [ ] Monitor wallet transactions

### Documentation
- [ ] Document your gameID
- [ ] Document custom RPC usage
- [ ] Create troubleshooting guide
- [ ] Document data models
- [ ] Create admin tools documentation

---

## Common Issues & Solutions

### Issue: "Session Expired" Error

**Cause**: Session tokens expire after 24 hours

**Solution**:
```csharp
public async Task<bool> EnsureSessionValid()
{
    if (_session == null || _session.IsExpired)
    {
        // Check if we have refresh token
        string refreshToken = PlayerPrefs.GetString(PREF_REFRESH_TOKEN, "");
        
        if (!string.IsNullOrEmpty(refreshToken))
        {
            // Try to refresh
            _session = await _client.SessionRefreshAsync(_session);
            SaveSession(_session);
            return true;
        }
        
        // Re-authenticate
        return await AuthenticateAsync();
    }
    
    return true;
}
```

### Issue: "Wallet Not Found" Error

**Cause**: User identity not synced before wallet operations

**Solution**: Always call `create_or_sync_user` during initialization before any wallet RPCs.

### Issue: Scores Not Appearing on Leaderboard

**Cause**: 
1. Wrong gameID
2. Score submitted to wrong leaderboard
3. Time period leaderboards reset

**Solution**:
```csharp
// Verify gameID is correct
Debug.Log($"GameID: {NakamaManager.Instance.GameId}");

// Check which leaderboards were updated
var response = await SubmitScore(score);
foreach (var result in response.results)
{
    Debug.Log($"Updated: {result.leaderboard_id}, Rank: {result.new_rank}");
}
```

### Issue: Daily Reward Already Claimed

**Cause**: User trying to claim twice in same day

**Solution**: Always check status before showing claim button:
```csharp
var status = await DailyRewardsManager.Instance.CheckStatus();
claimButton.interactable = status.available;
```

### Issue: Cloud Save Data Not Loading

**Cause**:
1. Wrong RPC name (quizverse vs lasttolive)
2. Data never saved
3. Wrong key used

**Solution**:
```csharp
// Use correct RPC for your game
string rpcName = NakamaManager.Instance.GameId.Contains("quiz") 
    ? "quizverse_load_player_data" 
    : "lasttolive_load_player_data";

// Log the key being used
Debug.Log($"Loading data with key: {key}");

// Handle null/default returns
var data = await CloudSaveManager.Instance.LoadData<MyData>(key);
if (data == null)
{
    Debug.LogWarning($"No data found for key: {key}, using defaults");
    data = GetDefaultData();
}
```

---

## Next Steps

1. **Review SDK Enhancements**: See `SDK_ENHANCEMENTS.md` for advanced wrapper classes
2. **Explore All RPCs**: See `COMPLETE_RPC_REFERENCE.md` for full RPC documentation
3. **Join Community**: Get help from other developers
4. **Share Feedback**: Help improve the platform

---

**Need Help?**
- Check documentation: `/nakama/docs/`
- Review example integrations
- Open GitHub issue with details

**Happy Building! 🚀**
