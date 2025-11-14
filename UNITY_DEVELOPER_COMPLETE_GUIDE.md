# Complete Unity Developer Guide for Nakama Multi-Game Backend

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Quick Start](#quick-start)
4. [Authentication Flow](#authentication-flow)
5. [Feature Overview](#feature-overview)
6. [Leaderboards (Daily, Weekly, Monthly, All-Time)](#leaderboards)
7. [Daily Rewards System](#daily-rewards-system)
8. [Daily Missions System](#daily-missions-system)
9. [Wallet System](#wallet-system)
10. [Analytics System](#analytics-system)
11. [Friends & Social System](#friends--social-system)
12. [Push Notifications (AWS SNS/Pinpoint)](#push-notifications)
13. [Complete Integration Examples](#complete-integration-examples)
14. [Troubleshooting](#troubleshooting)
15. [API Reference](#api-reference)

---

## Introduction

This guide provides everything a Unity game developer needs to integrate their game with the Nakama multi-game backend system. The system supports multiple games through unique `gameId` identifiers, providing isolated yet interconnected gameplay experiences.

### What You'll Learn

- How to authenticate users with AWS Cognito and Nakama
- How to use time-based leaderboards (daily, weekly, monthly, all-time)
- How to implement daily rewards and missions
- How to manage wallets and virtual currency
- How to track analytics
- How to implement social features
- How to integrate push notifications (iOS, Android, Web, Windows)

### What You Need

- **Game ID**: A UUID that uniquely identifies your game (provided when you register your game)
- **Nakama Server URL**: Your Nakama server endpoint
- **Server Key**: Authentication key for your Nakama server

---

## Prerequisites

### 1. Install Nakama Unity SDK

```bash
# Using Unity Package Manager - Add package from git URL:
https://github.com/heroiclabs/nakama-unity.git?path=/Packages/Nakama
```

Or download from: https://github.com/heroiclabs/nakama-unity/releases

### 2. Obtain Your Game ID

Your game ID is a UUID that looks like this:
```
7d4322ae-cd95-4cd9-b003-4ffad2dc31b4
```

Contact your system administrator to register your game and obtain your Game ID.

### 3. Server Configuration

You'll need the following information:
- **Server Host**: e.g., `nakama.yourdomain.com` or `127.0.0.1`
- **Server Port**: Usually `7350`
- **Server Key**: Usually `defaultkey` (production keys will differ)
- **Use SSL**: `true` for production, `false` for local development

---

## Quick Start

### Basic Setup

```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;

public class GameBackendManager : MonoBehaviour
{
    // Configuration
    [Header("Nakama Configuration")]
    [SerializeField] private string serverHost = "127.0.0.1";
    [SerializeField] private int serverPort = 7350;
    [SerializeField] private string serverKey = "defaultkey";
    [SerializeField] private bool useSSL = false;
    
    [Header("Game Configuration")]
    [SerializeField] private string gameId = "YOUR-GAME-UUID-HERE";
    
    // Nakama instances
    private IClient client;
    private ISession session;
    private ISocket socket;
    
    void Start()
    {
        InitializeNakama();
    }
    
    async void InitializeNakama()
    {
        // Create client
        string scheme = useSSL ? "https" : "http";
        client = new Client(scheme, serverHost, serverPort, serverKey);
        
        Debug.Log("[Nakama] Client created");
        
        // Authenticate
        await Authenticate();
        
        // Initialize features
        await InitializeGameFeatures();
    }
    
    async Task Authenticate()
    {
        try
        {
            // Authenticate with device ID (creates account if doesn't exist)
            session = await client.AuthenticateDeviceAsync(
                SystemInfo.deviceUniqueIdentifier,
                null, // username (optional)
                true  // create account if doesn't exist
            );
            
            Debug.Log($"[Nakama] Authenticated! User ID: {session.UserId}");
            
            // Optional: Connect socket for realtime features
            socket = client.NewSocket();
            await socket.ConnectAsync(session, true);
            Debug.Log("[Nakama] Socket connected");
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"[Nakama] Authentication failed: {ex.Message}");
        }
    }
    
    async Task InitializeGameFeatures()
    {
        // Check daily rewards
        await CheckDailyReward();
        
        // Load daily missions
        await LoadDailyMissions();
        
        // Initialize leaderboards
        await InitializeLeaderboards();
        
        // Log session start
        await LogAnalyticsEvent("session_start");
    }
    
    async Task CheckDailyReward()
    {
        // Implementation in Daily Rewards section
    }
    
    async Task LoadDailyMissions()
    {
        // Implementation in Daily Missions section
    }
    
    async Task InitializeLeaderboards()
    {
        // Implementation in Leaderboards section
    }
    
    async Task LogAnalyticsEvent(string eventName)
    {
        // Implementation in Analytics section
    }
    
    void OnApplicationQuit()
    {
        // Clean up
        _ = LogAnalyticsEvent("session_end");
        socket?.CloseAsync();
    }
}
```

---

## Authentication Flow

### Understanding the Authentication Process

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  1. AWS Cognito Authentication (Optional)               │
│     ↓                                                   │
│  2. Get Cognito JWT Token                               │
│     ↓                                                   │
│  3. Authenticate with Nakama (Device/Custom/Cognito)    │
│     ↓                                                   │
│  4. Receive Nakama Session Token                        │
│     ↓                                                   │
│  5. Link Wallet to Game (Optional)                      │
│     ↓                                                   │
│  6. Initialize Game Features                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Device Authentication (Simplest)

```csharp
public async Task<ISession> AuthenticateWithDevice()
{
    try
    {
        var session = await client.AuthenticateDeviceAsync(
            SystemInfo.deviceUniqueIdentifier,
            null,
            true // create if doesn't exist
        );
        
        Debug.Log($"Authenticated with device: {session.UserId}");
        return session;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Device authentication failed: {ex.Message}");
        throw;
    }
}
```

### Custom Authentication (Username/Password)

```csharp
public async Task<ISession> AuthenticateWithEmail(string email, string password)
{
    try
    {
        var session = await client.AuthenticateEmailAsync(
            email,
            password,
            null, // username (optional)
            true  // create if doesn't exist
        );
        
        Debug.Log($"Authenticated with email: {session.UserId}");
        return session;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Email authentication failed: {ex.Message}");
        throw;
    }
}
```

### AWS Cognito Integration

```csharp
public async Task<ISession> AuthenticateWithCognito(string cognitoJwtToken)
{
    try
    {
        // Step 1: Link Cognito user to Nakama wallet
        var walletPayload = new Dictionary<string, string>
        {
            { "token", cognitoJwtToken }
        };
        
        var walletResult = await client.RpcAsync(
            session, 
            "get_user_wallet", 
            JsonUtility.ToJson(walletPayload)
        );
        
        var walletResponse = JsonUtility.FromJson<WalletResponse>(walletResult.Payload);
        
        if (walletResponse.success)
        {
            Debug.Log($"Wallet ID: {walletResponse.walletId}");
            
            // Step 2: Link wallet to this game
            var linkPayload = new Dictionary<string, string>
            {
                { "gameId", gameId },
                { "token", cognitoJwtToken }
            };
            
            var linkResult = await client.RpcAsync(
                session, 
                "link_wallet_to_game", 
                JsonUtility.ToJson(linkPayload)
            );
            
            Debug.Log("Wallet linked to game successfully");
        }
        
        return session;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Cognito authentication failed: {ex.Message}");
        throw;
    }
}

[System.Serializable]
public class WalletResponse
{
    public bool success;
    public string walletId;
    public string userId;
    public string[] gamesLinked;
    public string error;
}
```

### Session Persistence

```csharp
public async Task SaveSession(ISession session)
{
    PlayerPrefs.SetString("nakama_auth_token", session.AuthToken);
    PlayerPrefs.SetString("nakama_refresh_token", session.RefreshToken);
    PlayerPrefs.Save();
    Debug.Log("Session saved");
}

public async Task<ISession> RestoreSession()
{
    var authToken = PlayerPrefs.GetString("nakama_auth_token", "");
    var refreshToken = PlayerPrefs.GetString("nakama_refresh_token", "");
    
    if (string.IsNullOrEmpty(authToken))
    {
        Debug.Log("No saved session found");
        return null;
    }
    
    var session = Session.Restore(authToken, refreshToken);
    
    // Check if expired and refresh if needed
    if (session.IsExpired)
    {
        try
        {
            session = await client.SessionRefreshAsync(session);
            await SaveSession(session);
            Debug.Log("Session refreshed");
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Session refresh failed: {ex.Message}");
            return null;
        }
    }
    
    Debug.Log("Session restored successfully");
    return session;
}
```

---

## Feature Overview

The Nakama multi-game backend provides the following features:

| Feature | Description | RPC Count |
|---------|-------------|-----------|
| **Leaderboards** | Daily, Weekly, Monthly, All-Time leaderboards | 3 |
| **Daily Rewards** | Login rewards with streak tracking | 2 |
| **Daily Missions** | Daily objectives with rewards | 3 |
| **Wallet System** | Global and per-game virtual currency | 4 |
| **Analytics** | Event tracking and metrics | 1 |
| **Friends & Social** | Friend management and challenges | 6 |
| **Total** | | **19 RPCs** |

Plus additional copilot RPCs for wallet mapping and advanced social features.

---

## Leaderboards

### Overview

The system provides **four time-period leaderboards** for each game:

1. **Daily Leaderboard**: Resets every day at midnight UTC (`0 0 * * *`)
2. **Weekly Leaderboard**: Resets every Sunday at midnight UTC (`0 0 * * 0`)
3. **Monthly Leaderboard**: Resets on the 1st of each month at midnight UTC (`0 0 1 * *`)
4. **All-Time Leaderboard**: Never resets - permanent rankings

Each game also has access to **global leaderboards** that aggregate scores across all games.

### Leaderboard Naming Convention

**Per-Game Leaderboards:**
```
leaderboard_{gameId}_daily
leaderboard_{gameId}_weekly
leaderboard_{gameId}_monthly
leaderboard_{gameId}_alltime
```

**Global Leaderboards:**
```
leaderboard_global_daily
leaderboard_global_weekly
leaderboard_global_monthly
leaderboard_global_alltime
```

### Step 1: Create Time-Period Leaderboards (One-Time Setup)

```csharp
/// <summary>
/// Create all time-period leaderboards for all games.
/// This should be called once by an administrator, not by each game client.
/// </summary>
public async Task<bool> CreateAllTimePeriodLeaderboards()
{
    try
    {
        var result = await client.RpcAsync(
            session, 
            "create_time_period_leaderboards", 
            "{}" // No payload needed
        );
        
        var response = JsonUtility.FromJson<LeaderboardCreationResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Leaderboards Created: {response.summary.totalCreated}");
            Debug.Log($"Leaderboards Skipped: {response.summary.totalSkipped}");
            Debug.Log($"Games Processed: {response.summary.gamesProcessed}");
            return true;
        }
        else
        {
            Debug.LogError($"Failed to create leaderboards: {response.error}");
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
public class LeaderboardCreationResponse
{
    public bool success;
    public LeaderboardSummary summary;
    public string error;
}

[System.Serializable]
public class LeaderboardSummary
{
    public int totalCreated;
    public int totalSkipped;
    public int totalErrors;
    public int gamesProcessed;
}
```

### Step 2: Submit Score to Time-Period Leaderboards

```csharp
/// <summary>
/// Submit a score to all time-period leaderboards for this game
/// </summary>
public async Task<bool> SubmitScore(long score, int subscore = 0)
{
    try
    {
        var payload = new ScoreSubmission
        {
            gameId = gameId,
            score = score,
            subscore = subscore,
            metadata = new ScoreMetadata
            {
                level = currentLevel,
                difficulty = currentDifficulty
            }
        };
        
        var result = await client.RpcAsync(
            session, 
            "submit_score_to_time_periods", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<ScoreSubmissionResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Score {score} submitted successfully");
            Debug.Log($"Submitted to {response.results.Length} leaderboards");
            
            // Check for errors
            if (response.errors != null && response.errors.Length > 0)
            {
                Debug.LogWarning($"{response.errors.Length} leaderboards failed");
            }
            
            return true;
        }
        else
        {
            Debug.LogError($"Score submission failed: {response.error}");
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
public class ScoreSubmission
{
    public string gameId;
    public long score;
    public int subscore;
    public ScoreMetadata metadata;
}

[System.Serializable]
public class ScoreMetadata
{
    public int level;
    public string difficulty;
}

[System.Serializable]
public class ScoreSubmissionResponse
{
    public bool success;
    public string gameId;
    public long score;
    public LeaderboardResult[] results;
    public LeaderboardError[] errors;
    public string error;
}

[System.Serializable]
public class LeaderboardResult
{
    public string leaderboardId;
    public string period;
    public string scope;
    public bool success;
}

[System.Serializable]
public class LeaderboardError
{
    public string leaderboardId;
    public string period;
    public string scope;
    public string error;
}
```

### Step 3: Get Leaderboard Rankings

```csharp
/// <summary>
/// Get leaderboard rankings for a specific time period
/// </summary>
public async Task<LeaderboardData> GetLeaderboard(
    string period,          // "daily", "weekly", "monthly", or "alltime"
    bool isGlobal = false,  // true for global, false for game-specific
    int limit = 10,
    string cursor = "")
{
    try
    {
        var payload = new LeaderboardRequest
        {
            gameId = isGlobal ? null : gameId,
            scope = isGlobal ? "global" : "game",
            period = period,
            limit = limit,
            cursor = cursor
        };
        
        var result = await client.RpcAsync(
            session, 
            "get_time_period_leaderboard", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<LeaderboardDataResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Retrieved {response.records.Length} leaderboard records");
            return new LeaderboardData
            {
                Records = response.records,
                NextCursor = response.nextCursor,
                PrevCursor = response.prevCursor
            };
        }
        else
        {
            Debug.LogError($"Failed to get leaderboard: {response.error}");
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
public class LeaderboardRequest
{
    public string gameId;
    public string scope;
    public string period;
    public int limit;
    public string cursor;
}

[System.Serializable]
public class LeaderboardDataResponse
{
    public bool success;
    public string leaderboardId;
    public string period;
    public LeaderboardRecord[] records;
    public string nextCursor;
    public string prevCursor;
    public string error;
}

[System.Serializable]
public class LeaderboardRecord
{
    public string leaderboard_id;
    public string owner_id;
    public string username;
    public long score;
    public int subscore;
    public int num_score;
    public string metadata;
    public string create_time;
    public string update_time;
    public string expiry_time;
    public long rank;
    public long max_num_score;
}

public class LeaderboardData
{
    public LeaderboardRecord[] Records;
    public string NextCursor;
    public string PrevCursor;
}
```

### Complete Leaderboard UI Example

```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;

public class LeaderboardUI : MonoBehaviour
{
    [Header("UI References")]
    [SerializeField] private Transform leaderboardContainer;
    [SerializeField] private GameObject leaderboardEntryPrefab;
    [SerializeField] private Button dailyButton;
    [SerializeField] private Button weeklyButton;
    [SerializeField] private Button monthlyButton;
    [SerializeField] private Button alltimeButton;
    [SerializeField] private Button globalToggle;
    [SerializeField] private Text titleText;
    
    private GameBackendManager backendManager;
    private string currentPeriod = "weekly";
    private bool showGlobal = false;
    
    void Start()
    {
        backendManager = FindObjectOfType<GameBackendManager>();
        
        // Setup buttons
        dailyButton.onClick.AddListener(() => LoadLeaderboard("daily"));
        weeklyButton.onClick.AddListener(() => LoadLeaderboard("weekly"));
        monthlyButton.onClick.AddListener(() => LoadLeaderboard("monthly"));
        alltimeButton.onClick.AddListener(() => LoadLeaderboard("alltime"));
        globalToggle.onClick.AddListener(ToggleGlobalLeaderboard);
        
        // Load initial leaderboard
        LoadLeaderboard(currentPeriod);
    }
    
    async void LoadLeaderboard(string period)
    {
        currentPeriod = period;
        
        // Update title
        string scope = showGlobal ? "Global" : "Game";
        titleText.text = $"{scope} {period.ToUpper()} Leaderboard";
        
        // Clear existing entries
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }
        
        // Load data
        var data = await backendManager.GetLeaderboard(period, showGlobal, 50);
        
        if (data != null && data.Records != null)
        {
            // Display entries
            foreach (var record in data.Records)
            {
                var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
                var entryUI = entry.GetComponent<LeaderboardEntryUI>();
                entryUI.SetData(record.rank, record.username, record.score);
            }
        }
    }
    
    void ToggleGlobalLeaderboard()
    {
        showGlobal = !showGlobal;
        LoadLeaderboard(currentPeriod);
    }
}

public class LeaderboardEntryUI : MonoBehaviour
{
    [SerializeField] private Text rankText;
    [SerializeField] private Text usernameText;
    [SerializeField] private Text scoreText;
    
    public void SetData(long rank, string username, long score)
    {
        rankText.text = $"#{rank}";
        usernameText.text = username;
        scoreText.text = score.ToString("N0");
    }
}
```

---

## Daily Rewards System

### Overview

The Daily Rewards system provides login rewards with streak tracking. Users can claim one reward per day, and consecutive logins build up a streak.

### Features

- Daily login rewards (claim once per 24 hours)
- Streak tracking (consecutive days)
- Customizable rewards per game
- Automatic streak reset after missed days

### Check Daily Reward Status

```csharp
public async Task<DailyRewardStatus> CheckDailyRewardStatus()
{
    try
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, 
            "daily_rewards_get_status", 
            JsonUtility.ToJson(payload)
        );
        
        var status = JsonUtility.FromJson<DailyRewardStatus>(result.Payload);
        
        if (status.success)
        {
            Debug.Log($"Current Streak: {status.currentStreak}");
            Debug.Log($"Can Claim Today: {status.canClaimToday}");
            
            if (status.nextReward != null)
            {
                Debug.Log($"Next Reward: {status.nextReward.xp} XP, {status.nextReward.tokens} Tokens");
            }
        }
        
        return status;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get daily reward status: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class DailyRewardStatus
{
    public bool success;
    public string userId;
    public string gameId;
    public int currentStreak;
    public int totalClaims;
    public long lastClaimTimestamp;
    public bool canClaimToday;
    public string claimReason;
    public DailyReward nextReward;
    public string error;
}

[System.Serializable]
public class DailyReward
{
    public int day;
    public int xp;
    public int tokens;
    public string description;
}
```

### Claim Daily Reward

```csharp
public async Task<DailyRewardClaim> ClaimDailyReward()
{
    try
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, 
            "daily_rewards_claim", 
            JsonUtility.ToJson(payload)
        );
        
        var claim = JsonUtility.FromJson<DailyRewardClaim>(result.Payload);
        
        if (claim.success)
        {
            Debug.Log($"Claimed Daily Reward!");
            Debug.Log($"New Streak: {claim.currentStreak}");
            Debug.Log($"Reward: {claim.reward.xp} XP, {claim.reward.tokens} Tokens");
            
            // Update UI or grant rewards to player
            GrantRewardsToPlayer(claim.reward);
        }
        else
        {
            Debug.LogWarning($"Cannot claim reward: {claim.error}");
        }
        
        return claim;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to claim daily reward: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class DailyRewardClaim
{
    public bool success;
    public string userId;
    public string gameId;
    public int currentStreak;
    public int totalClaims;
    public DailyReward reward;
    public string claimedAt;
    public string error;
}

void GrantRewardsToPlayer(DailyReward reward)
{
    // Implement your reward granting logic
    // Example: Update player XP and tokens
    PlayerData.instance.AddXP(reward.xp);
    PlayerData.instance.AddTokens(reward.tokens);
    
    // Show reward popup
    ShowRewardPopup(reward);
}
```

### Daily Reward UI Example

```csharp
public class DailyRewardUI : MonoBehaviour
{
    [SerializeField] private GameObject rewardPanel;
    [SerializeField] private Text streakText;
    [SerializeField] private Text rewardText;
    [SerializeField] private Button claimButton;
    
    private GameBackendManager backendManager;
    private DailyRewardStatus currentStatus;
    
    void Start()
    {
        backendManager = FindObjectOfType<GameBackendManager>();
        claimButton.onClick.AddListener(OnClaimClicked);
        
        // Check status when UI opens
        CheckRewardStatus();
    }
    
    async void CheckRewardStatus()
    {
        currentStatus = await backendManager.CheckDailyRewardStatus();
        
        if (currentStatus != null && currentStatus.success)
        {
            UpdateUI();
        }
    }
    
    void UpdateUI()
    {
        streakText.text = $"Streak: {currentStatus.currentStreak} days";
        
        if (currentStatus.canClaimToday && currentStatus.nextReward != null)
        {
            rewardText.text = $"Claim: {currentStatus.nextReward.xp} XP + {currentStatus.nextReward.tokens} Tokens";
            claimButton.interactable = true;
        }
        else
        {
            rewardText.text = "Come back tomorrow!";
            claimButton.interactable = false;
        }
    }
    
    async void OnClaimClicked()
    {
        var claim = await backendManager.ClaimDailyReward();
        
        if (claim != null && claim.success)
        {
            // Show success animation
            ShowClaimAnimation(claim.reward);
            
            // Refresh status
            await Task.Delay(2000);
            CheckRewardStatus();
        }
    }
    
    void ShowClaimAnimation(DailyReward reward)
    {
        // Implement your animation
        Debug.Log($"✨ Claimed {reward.xp} XP and {reward.tokens} Tokens!");
    }
}
```

---

## Daily Missions System

### Overview

The Daily Missions system provides daily objectives that players can complete for rewards. Missions reset daily at midnight UTC.

### Features

- Configurable daily missions per game
- Progress tracking
- Reward claiming system
- Automatic daily reset

### Get Daily Missions

```csharp
public async Task<DailyMissionsData> GetDailyMissions()
{
    try
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, 
            "get_daily_missions", 
            JsonUtility.ToJson(payload)
        );
        
        var data = JsonUtility.FromJson<DailyMissionsData>(result.Payload);
        
        if (data.success)
        {
            Debug.Log($"Loaded {data.missions.Length} missions");
            
            foreach (var mission in data.missions)
            {
                Debug.Log($"Mission: {mission.name} ({mission.currentValue}/{mission.targetValue})");
            }
        }
        
        return data;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get daily missions: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class DailyMissionsData
{
    public bool success;
    public string userId;
    public string gameId;
    public long resetDate;
    public Mission[] missions;
    public string error;
}

[System.Serializable]
public class Mission
{
    public string id;
    public string name;
    public string description;
    public string objective;
    public int currentValue;
    public int targetValue;
    public bool completed;
    public bool claimed;
    public MissionRewards rewards;
}

[System.Serializable]
public class MissionRewards
{
    public int xp;
    public int tokens;
}
```

### Submit Mission Progress

```csharp
public async Task<MissionProgressResponse> SubmitMissionProgress(
    string missionId, 
    int value)
{
    try
    {
        var payload = new MissionProgressPayload
        {
            gameId = gameId,
            missionId = missionId,
            value = value
        };
        
        var result = await client.RpcAsync(
            session, 
            "submit_mission_progress", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<MissionProgressResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Mission progress updated: {response.currentValue}/{response.targetValue}");
            
            if (response.completed)
            {
                Debug.Log("Mission completed! Ready to claim reward.");
            }
        }
        
        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to submit mission progress: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class MissionProgressPayload
{
    public string gameId;
    public string missionId;
    public int value;
}

[System.Serializable]
public class MissionProgressResponse
{
    public bool success;
    public string userId;
    public string gameId;
    public string missionId;
    public int currentValue;
    public int targetValue;
    public bool completed;
    public bool claimed;
    public string error;
}

// Example usage: Track match completions
public async void OnMatchCompleted()
{
    await SubmitMissionProgress("play_matches", 1);
}

// Example usage: Track score milestones
public async void OnScoreReached(int score)
{
    if (score >= 1000)
    {
        await SubmitMissionProgress("reach_1000_score", 1);
    }
}
```

### Claim Mission Reward

```csharp
public async Task<MissionRewardClaimResponse> ClaimMissionReward(string missionId)
{
    try
    {
        var payload = new MissionRewardClaimPayload
        {
            gameId = gameId,
            missionId = missionId
        };
        
        var result = await client.RpcAsync(
            session, 
            "claim_mission_reward", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<MissionRewardClaimResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Mission reward claimed!");
            Debug.Log($"Received: {response.rewards.xp} XP, {response.rewards.tokens} Tokens");
            
            GrantRewards(response.rewards);
        }
        
        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to claim mission reward: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class MissionRewardClaimPayload
{
    public string gameId;
    public string missionId;
}

[System.Serializable]
public class MissionRewardClaimResponse
{
    public bool success;
    public string userId;
    public string gameId;
    public string missionId;
    public MissionRewards rewards;
    public string claimedAt;
    public string error;
}

void GrantRewards(MissionRewards rewards)
{
    PlayerData.instance.AddXP(rewards.xp);
    PlayerData.instance.AddTokens(rewards.tokens);
}
```

### Daily Missions UI Example

```csharp
public class DailyMissionsUI : MonoBehaviour
{
    [SerializeField] private Transform missionsContainer;
    [SerializeField] private GameObject missionEntryPrefab;
    
    private GameBackendManager backendManager;
    private DailyMissionsData currentMissions;
    
    void Start()
    {
        backendManager = FindObjectOfType<GameBackendManager>();
        LoadMissions();
    }
    
    async void LoadMissions()
    {
        currentMissions = await backendManager.GetDailyMissions();
        
        if (currentMissions != null && currentMissions.success)
        {
            DisplayMissions();
        }
    }
    
    void DisplayMissions()
    {
        // Clear existing
        foreach (Transform child in missionsContainer)
        {
            Destroy(child.gameObject);
        }
        
        // Create mission entries
        foreach (var mission in currentMissions.missions)
        {
            var entry = Instantiate(missionEntryPrefab, missionsContainer);
            var entryUI = entry.GetComponent<MissionEntryUI>();
            entryUI.SetMission(mission, this);
        }
    }
    
    public async void OnClaimReward(string missionId)
    {
        var result = await backendManager.ClaimMissionReward(missionId);
        
        if (result != null && result.success)
        {
            // Refresh missions
            LoadMissions();
        }
    }
}

public class MissionEntryUI : MonoBehaviour
{
    [SerializeField] private Text nameText;
    [SerializeField] private Text descriptionText;
    [SerializeField] private Text progressText;
    [SerializeField] private Button claimButton;
    [SerializeField] private Image progressBar;
    
    private Mission mission;
    private DailyMissionsUI parentUI;
    
    public void SetMission(Mission mission, DailyMissionsUI parent)
    {
        this.mission = mission;
        this.parentUI = parent;
        
        nameText.text = mission.name;
        descriptionText.text = mission.description;
        progressText.text = $"{mission.currentValue}/{mission.targetValue}";
        
        float progress = (float)mission.currentValue / mission.targetValue;
        progressBar.fillAmount = progress;
        
        // Setup claim button
        if (mission.completed && !mission.claimed)
        {
            claimButton.interactable = true;
            claimButton.onClick.AddListener(() => parentUI.OnClaimReward(mission.id));
        }
        else
        {
            claimButton.interactable = false;
        }
    }
}
```

---

## Wallet System

### Overview

The wallet system provides:
- **Global Wallet**: Shared across all games (XUT, XP)
- **Per-Game Wallets**: Isolated currencies per game

### Get All Wallets

```csharp
public async Task<UserWallets> GetAllWallets()
{
    try
    {
        var result = await client.RpcAsync(session, "wallet_get_all", "{}");
        var wallets = JsonUtility.FromJson<UserWallets>(result.Payload);
        
        if (wallets.success)
        {
            Debug.Log($"Global XUT: {wallets.globalWallet.currencies.xut}");
            Debug.Log($"Global XP: {wallets.globalWallet.currencies.xp}");
            Debug.Log($"Game Wallets: {wallets.gameWallets.Length}");
        }
        
        return wallets;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get wallets: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class UserWallets
{
    public bool success;
    public string userId;
    public GlobalWallet globalWallet;
    public GameWallet[] gameWallets;
}

[System.Serializable]
public class GlobalWallet
{
    public string userId;
    public GlobalCurrencies currencies;
    public string createdAt;
}

[System.Serializable]
public class GlobalCurrencies
{
    public int xut;
    public int xp;
}

[System.Serializable]
public class GameWallet
{
    public string userId;
    public string gameId;
    public GameCurrencies currencies;
    public string createdAt;
}

[System.Serializable]
public class GameCurrencies
{
    public int tokens;
    public int xp;
}
```

### Update Game Wallet

```csharp
public async Task<bool> UpdateGameWallet(string currency, int amount, string operation)
{
    try
    {
        var payload = new WalletUpdatePayload
        {
            gameId = gameId,
            currency = currency,
            amount = amount,
            operation = operation // "add" or "subtract"
        };
        
        var result = await client.RpcAsync(
            session, 
            "wallet_update_game_wallet", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<WalletUpdateResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Wallet updated! New balance: {response.newBalance}");
            return true;
        }
        else
        {
            Debug.LogError($"Wallet update failed: {response.error}");
            return false;
        }
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to update wallet: {ex.Message}");
        return false;
    }
}

[System.Serializable]
public class WalletUpdatePayload
{
    public string gameId;
    public string currency;
    public int amount;
    public string operation;
}

[System.Serializable]
public class WalletUpdateResponse
{
    public bool success;
    public string userId;
    public string gameId;
    public string currency;
    public int newBalance;
    public string error;
}

// Usage examples
public async void AddTokensToPlayer(int tokens)
{
    await UpdateGameWallet("tokens", tokens, "add");
}

public async void SpendTokens(int tokens)
{
    await UpdateGameWallet("tokens", tokens, "subtract");
}
```

---

## Analytics System

### Log Analytics Events

```csharp
public async Task LogAnalyticsEvent(
    string eventName, 
    Dictionary<string, object> eventData = null)
{
    try
    {
        var payload = new AnalyticsEventPayload
        {
            gameId = gameId,
            eventName = eventName,
            eventData = eventData
        };
        
        await client.RpcAsync(
            session, 
            "analytics_log_event", 
            JsonUtility.ToJson(payload)
        );
        
        Debug.Log($"Analytics event logged: {eventName}");
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to log analytics: {ex.Message}");
    }
}

[System.Serializable]
public class AnalyticsEventPayload
{
    public string gameId;
    public string eventName;
    public Dictionary<string, object> eventData;
}

// Usage examples
void Start()
{
    _ = LogAnalyticsEvent("session_start");
}

void OnApplicationQuit()
{
    _ = LogAnalyticsEvent("session_end");
}

void OnLevelComplete(int level, int score, float time)
{
    var data = new Dictionary<string, object>
    {
        { "level", level },
        { "score", score },
        { "time", time }
    };
    
    _ = LogAnalyticsEvent("level_complete", data);
}

void OnPurchase(string itemId, int price)
{
    var data = new Dictionary<string, object>
    {
        { "itemId", itemId },
        { "price", price },
        { "currency", "tokens" }
    };
    
    _ = LogAnalyticsEvent("purchase", data);
}
```

---

## Friends & Social System

### Block/Unblock Users

```csharp
public async Task<bool> BlockUser(string targetUserId)
{
    try
    {
        var payload = new { targetUserId = targetUserId };
        var result = await client.RpcAsync(
            session, 
            "friends_block", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<BlockResponse>(result.Payload);
        return response.success;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to block user: {ex.Message}");
        return false;
    }
}

public async Task<bool> UnblockUser(string targetUserId)
{
    try
    {
        var payload = new { targetUserId = targetUserId };
        var result = await client.RpcAsync(
            session, 
            "friends_unblock", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<BlockResponse>(result.Payload);
        return response.success;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to unblock user: {ex.Message}");
        return false;
    }
}

[System.Serializable]
public class BlockResponse
{
    public bool success;
    public string error;
}
```

### Get Friends List

```csharp
public async Task<Friend[]> GetFriendsList(int limit = 100)
{
    try
    {
        var payload = new { limit = limit };
        var result = await client.RpcAsync(
            session, 
            "friends_list", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<FriendsListResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Loaded {response.count} friends");
            return response.friends;
        }
        
        return new Friend[0];
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to get friends list: {ex.Message}");
        return new Friend[0];
    }
}

[System.Serializable]
public class FriendsListResponse
{
    public bool success;
    public Friend[] friends;
    public int count;
}

[System.Serializable]
public class Friend
{
    public string userId;
    public string username;
    public string displayName;
    public bool online;
    public int state;
}
```

### Challenge Friend

```csharp
public async Task<string> ChallengeFriend(
    string friendUserId, 
    Dictionary<string, object> challengeData)
{
    try
    {
        var payload = new ChallengeFriendPayload
        {
            friendUserId = friendUserId,
            gameId = gameId,
            challengeData = challengeData
        };
        
        var result = await client.RpcAsync(
            session, 
            "friends_challenge_user", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<ChallengeResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Challenge sent! ID: {response.challengeId}");
            return response.challengeId;
        }
        
        return null;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to challenge friend: {ex.Message}");
        return null;
    }
}

[System.Serializable]
public class ChallengeFriendPayload
{
    public string friendUserId;
    public string gameId;
    public Dictionary<string, object> challengeData;
}

[System.Serializable]
public class ChallengeResponse
{
    public bool success;
    public string challengeId;
    public string error;
}
```

---

## Push Notifications

### Overview

The push notification system integrates with **AWS SNS (Simple Notification Service)** and **AWS Pinpoint** to deliver cross-platform push notifications for iOS, Android, Web (PWA), and Windows.

**Key Architecture Points:**
- ✅ Unity does **NOT** use AWS SDK
- ✅ Unity only sends raw device tokens to Nakama
- ✅ Nakama forwards to AWS Lambda via Function URL
- ✅ Lambda creates SNS endpoints and manages Pinpoint analytics
- ✅ All platforms supported: APNS (iOS), FCM (Android/Web), WNS (Windows)

### Architecture Flow

```
Unity Client → Get Push Token from OS → Nakama RPC
              ↓
Nakama → Lambda Function URL (HTTP POST)
              ↓
Lambda → SNS CreatePlatformEndpoint → Pinpoint Registration
              ↓
Lambda returns SNS Endpoint ARN
              ↓
Nakama stores ARN for future push sends
```

### Step 1: Obtain Device Token (Platform-Specific)

#### iOS (APNS)

```csharp
using UnityEngine;
using UnityEngine.iOS;
#if UNITY_IOS
using Unity.Notifications.iOS;
#endif

public class iOSPushManager : MonoBehaviour
{
    void Start()
    {
        #if UNITY_IOS
        StartCoroutine(RequestAuthorization());
        #endif
    }

    IEnumerator RequestAuthorization()
    {
        #if UNITY_IOS
        var authorizationOption = AuthorizationOption.Alert | AuthorizationOption.Badge | AuthorizationOption.Sound;
        
        using (var req = new AuthorizationRequest(authorizationOption, true))
        {
            while (!req.IsFinished)
            {
                yield return null;
            }

            if (req.Granted && req.DeviceToken != "")
            {
                string deviceToken = req.DeviceToken;
                Debug.Log($"iOS Device Token: {deviceToken}");
                
                // Register with Nakama
                await RegisterPushToken("ios", deviceToken);
            }
            else
            {
                Debug.LogWarning("Push notification authorization denied");
            }
        }
        #endif
    }

    async Task RegisterPushToken(string platform, string token)
    {
        // Implementation below
    }
}
```

#### Android (FCM)

```csharp
using Firebase.Messaging;
using UnityEngine;

public class AndroidPushManager : MonoBehaviour
{
    void Start()
    {
        #if UNITY_ANDROID
        Firebase.FirebaseApp.CheckAndFixDependenciesAsync().ContinueWith(task =>
        {
            if (task.Result == Firebase.DependencyStatus.Available)
            {
                InitializeFirebaseMessaging();
            }
            else
            {
                Debug.LogError("Could not resolve Firebase dependencies: " + task.Result);
            }
        });
        #endif
    }

    void InitializeFirebaseMessaging()
    {
        #if UNITY_ANDROID
        Firebase.Messaging.FirebaseMessaging.TokenReceived += OnTokenReceived;
        Firebase.Messaging.FirebaseMessaging.MessageReceived += OnMessageReceived;
        #endif
    }

    void OnTokenReceived(object sender, Firebase.Messaging.TokenReceivedEventArgs token)
    {
        Debug.Log($"Android FCM Token: {token.Token}");
        
        // Register with Nakama
        _ = RegisterPushToken("android", token.Token);
    }

    void OnMessageReceived(object sender, Firebase.Messaging.MessageReceivedEventArgs e)
    {
        Debug.Log($"Push notification received: {e.Message.Notification.Title}");
        
        // Handle notification data
        if (e.Message.Data != null && e.Message.Data.Count > 0)
        {
            HandlePushData(e.Message.Data);
        }
    }

    async Task RegisterPushToken(string platform, string token)
    {
        // Implementation below
    }

    void HandlePushData(IDictionary<string, string> data)
    {
        if (data.ContainsKey("eventType"))
        {
            string eventType = data["eventType"];
            Debug.Log($"Push event type: {eventType}");
            
            switch (eventType)
            {
                case "daily_reward_available":
                    UIManager.Instance.ShowDailyRewardNotification();
                    break;
                case "friend_online":
                    UIManager.Instance.ShowFriendOnlineNotification(data["friendUserId"]);
                    break;
                case "challenge_invite":
                    UIManager.Instance.ShowChallengeInvite(data["challengeId"]);
                    break;
            }
        }
    }
}
```

#### WebGL / PWA (FCM)

```csharp
using UnityEngine;
using System.Runtime.InteropServices;

public class WebPushManager : MonoBehaviour
{
    #if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")]
    private static extern void RequestPushPermission();
    
    [DllImport("__Internal")]
    private static extern string GetFCMToken();
    #endif

    public void InitializeWebPush()
    {
        #if UNITY_WEBGL && !UNITY_EDITOR
        RequestPushPermission();
        StartCoroutine(WaitForToken());
        #endif
    }

    IEnumerator WaitForToken()
    {
        yield return new WaitForSeconds(2f);
        
        #if UNITY_WEBGL && !UNITY_EDITOR
        string token = GetFCMToken();
        if (!string.IsNullOrEmpty(token))
        {
            Debug.Log($"Web FCM Token: {token}");
            _ = RegisterPushToken("web", token);
        }
        #endif
    }

    async Task RegisterPushToken(string platform, string token)
    {
        // Implementation below
    }
}
```

### Step 2: Register Token with Nakama

**Universal method for all platforms:**

```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;

public class PushNotificationManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private string gameId = "YOUR-GAME-UUID";

    /// <summary>
    /// Register device push token with Nakama
    /// Nakama forwards to Lambda which creates SNS endpoint
    /// </summary>
    public async Task<bool> RegisterPushToken(string platform, string deviceToken)
    {
        if (client == null || session == null)
        {
            Debug.LogError("Nakama client not initialized");
            return false;
        }

        try
        {
            var payload = new PushTokenPayload
            {
                gameId = gameId,
                platform = platform, // "ios", "android", "web", or "windows"
                token = deviceToken
            };

            var result = await client.RpcAsync(
                session,
                "push_register_token",
                JsonUtility.ToJson(payload)
            );

            var response = JsonUtility.FromJson<PushTokenResponse>(result.Payload);

            if (response.success)
            {
                Debug.Log($"✓ Push token registered successfully");
                Debug.Log($"Platform: {response.platform}");
                Debug.Log($"Endpoint ARN: {response.endpointArn}");
                
                // Save registration status locally
                PlayerPrefs.SetString($"push_registered_{platform}", "true");
                PlayerPrefs.SetString($"push_token_{platform}", deviceToken);
                PlayerPrefs.Save();
                
                return true;
            }
            else
            {
                Debug.LogError($"Failed to register push token: {response.error}");
                return false;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Push token registration failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Get all registered push endpoints for this user
    /// </summary>
    public async Task<PushEndpoint[]> GetRegisteredEndpoints()
    {
        try
        {
            var payload = new { gameId = gameId };
            
            var result = await client.RpcAsync(
                session,
                "push_get_endpoints",
                JsonUtility.ToJson(payload)
            );

            var response = JsonUtility.FromJson<PushEndpointsResponse>(result.Payload);

            if (response.success)
            {
                Debug.Log($"✓ Found {response.count} registered endpoints");
                return response.endpoints;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Failed to get endpoints: {ex.Message}");
        }

        return new PushEndpoint[0];
    }
}

[System.Serializable]
public class PushTokenPayload
{
    public string gameId;
    public string platform;
    public string token;
}

[System.Serializable]
public class PushTokenResponse
{
    public bool success;
    public string userId;
    public string gameId;
    public string platform;
    public string endpointArn;
    public string registeredAt;
    public string error;
}

[System.Serializable]
public class PushEndpointsResponse
{
    public bool success;
    public string userId;
    public string gameId;
    public PushEndpoint[] endpoints;
    public int count;
}

[System.Serializable]
public class PushEndpoint
{
    public string userId;
    public string gameId;
    public string platform;
    public string endpointArn;
    public string createdAt;
    public string updatedAt;
}
```

### Step 3: Server-Side Push Triggers (Optional)

While most push notifications are triggered server-side automatically (e.g., daily rewards, friend online), you can also trigger custom push events:

```csharp
/// <summary>
/// Trigger a push notification to a specific user
/// This is typically called server-side, but shown here for reference
/// </summary>
public async Task<bool> SendPushNotification(
    string targetUserId,
    string eventType,
    string title,
    string body,
    Dictionary<string, object> customData = null)
{
    try
    {
        var payload = new PushEventPayload
        {
            targetUserId = targetUserId,
            gameId = gameId,
            eventType = eventType,
            title = title,
            body = body,
            data = customData ?? new Dictionary<string, object>()
        };

        var result = await client.RpcAsync(
            session,
            "push_send_event",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<PushEventResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"✓ Push notification sent to {response.sentCount} devices");
            return true;
        }
        else
        {
            Debug.LogWarning($"Push send failed: {response.error}");
            return false;
        }
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"Failed to send push: {ex.Message}");
        return false;
    }
}

[System.Serializable]
public class PushEventPayload
{
    public string targetUserId;
    public string gameId;
    public string eventType;
    public string title;
    public string body;
    public Dictionary<string, object> data;
}

[System.Serializable]
public class PushEventResponse
{
    public bool success;
    public string targetUserId;
    public string gameId;
    public string eventType;
    public int sentCount;
    public int totalEndpoints;
    public PushError[] errors;
}

[System.Serializable]
public class PushError
{
    public string platform;
    public string error;
}
```

### Complete Push Notification Manager Example

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

public class CompletePushManager : MonoBehaviour
{
    [Header("References")]
    [SerializeField] private NakamaBackend nakamaBackend;
    
    private string gameId = "YOUR-GAME-UUID";

    void Start()
    {
        InitializePushNotifications();
    }

    async void InitializePushNotifications()
    {
        // Wait for Nakama to be ready
        while (!nakamaBackend.IsConnected)
        {
            await Task.Delay(100);
        }

        // Platform-specific token retrieval
        #if UNITY_IOS
        await InitializeIOSPush();
        #elif UNITY_ANDROID
        await InitializeAndroidPush();
        #elif UNITY_WEBGL
        InitializeWebPush();
        #elif UNITY_STANDALONE_WIN
        await InitializeWindowsPush();
        #endif
    }

    #if UNITY_IOS
    async Task InitializeIOSPush()
    {
        // iOS-specific initialization (see iOS example above)
        Debug.Log("Initializing iOS push notifications...");
    }
    #endif

    #if UNITY_ANDROID
    async Task InitializeAndroidPush()
    {
        // Android-specific initialization (see Android example above)
        Debug.Log("Initializing Android push notifications...");
    }
    #endif

    #if UNITY_WEBGL
    void InitializeWebPush()
    {
        // Web-specific initialization (see Web example above)
        Debug.Log("Initializing Web push notifications...");
    }
    #endif

    /// <summary>
    /// Called when user enables push notifications in settings
    /// </summary>
    public async void OnPushNotificationsEnabled()
    {
        Debug.Log("User enabled push notifications");
        // Re-register token if needed
    }

    /// <summary>
    /// Called when user disables push notifications in settings
    /// </summary>
    public async void OnPushNotificationsDisabled()
    {
        Debug.Log("User disabled push notifications");
        // Optionally remove endpoints or mark as disabled
    }
}
```

### Push Notification Best Practices

1. **Request Permission at the Right Time**
   - Don't request on app launch
   - Request after user completes tutorial or first match
   - Explain the value proposition first

2. **Handle Token Refreshes**
   - FCM tokens can refresh
   - Re-register when `OnTokenReceived` is called

3. **Test on Real Devices**
   - Push notifications don't work in Unity Editor
   - Test on actual iOS/Android devices

4. **Handle Deep Links**
   - Include deep link data in push payload
   - Navigate user to relevant screen when tapped

5. **Respect User Preferences**
   - Allow users to disable specific notification types
   - Store preferences server-side

### Automatic Push Event Triggers

The following events automatically trigger push notifications (server-side):

| Event | Trigger Condition | Title Example | Body Example |
|-------|------------------|---------------|--------------|
| `daily_reward_available` | 24h since last claim | "Daily Reward Ready!" | "Claim your day 3 bonus now!" |
| `mission_completed` | Mission objectives met | "Mission Complete!" | "You've earned 100 XP + 50 tokens" |
| `streak_warning` | 47h since last claim | "Streak Expiring Soon!" | "Claim reward to keep your 5-day streak" |
| `friend_online` | Friend connects | "Friend Online" | "John is now online" |
| `challenge_invite` | Friend sends challenge | "Challenge Received!" | "Sarah challenged you to a duel" |
| `match_ready` | Matchmaking complete | "Match Found!" | "Your 2v2 match is ready" |
| `wallet_reward` | Currency granted | "Reward Received!" | "You got 500 tokens" |
| `new_content` | New season/quiz pack | "New Content!" | "Season 2 is now live" |

---

## Complete Integration Examples

### Example 1: Complete Game Manager

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

public class CompleteGameManager : MonoBehaviour
{
    [Header("Configuration")]
    [SerializeField] private string gameId = "YOUR-GAME-UUID";
    [SerializeField] private string serverHost = "127.0.0.1";
    [SerializeField] private int serverPort = 7350;
    [SerializeField] private string serverKey = "defaultkey";
    
    private IClient client;
    private ISession session;
    
    async void Start()
    {
        await InitializeBackend();
    }
    
    async Task InitializeBackend()
    {
        // Step 1: Create client
        client = new Client("http", serverHost, serverPort, serverKey);
        Debug.Log("✓ Nakama client created");
        
        // Step 2: Authenticate
        session = await AuthenticateWithDevice();
        Debug.Log($"✓ Authenticated as {session.UserId}");
        
        // Step 3: Check daily reward
        var rewardStatus = await CheckDailyReward();
        if (rewardStatus != null && rewardStatus.canClaimToday)
        {
            var claim = await ClaimDailyReward();
            Debug.Log($"✓ Claimed daily reward: {claim.reward.tokens} tokens");
        }
        
        // Step 4: Load daily missions
        var missions = await GetDailyMissions();
        Debug.Log($"✓ Loaded {missions.missions.Length} missions");
        
        // Step 5: Load wallets
        var wallets = await GetAllWallets();
        Debug.Log($"✓ Wallet loaded - Tokens: {wallets.gameWallets[0].currencies.tokens}");
        
        // Step 6: Log session start
        await LogAnalyticsEvent("session_start");
        Debug.Log("✓ Analytics initialized");
        
        Debug.Log("=== Backend initialization complete ===");
    }
    
    async Task<ISession> AuthenticateWithDevice()
    {
        return await client.AuthenticateDeviceAsync(
            SystemInfo.deviceUniqueIdentifier, null, true);
    }
    
    async Task<DailyRewardStatus> CheckDailyReward()
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, "daily_rewards_get_status", JsonUtility.ToJson(payload));
        return JsonUtility.FromJson<DailyRewardStatus>(result.Payload);
    }
    
    async Task<DailyRewardClaim> ClaimDailyReward()
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, "daily_rewards_claim", JsonUtility.ToJson(payload));
        return JsonUtility.FromJson<DailyRewardClaim>(result.Payload);
    }
    
    async Task<DailyMissionsData> GetDailyMissions()
    {
        var payload = new { gameId = gameId };
        var result = await client.RpcAsync(
            session, "get_daily_missions", JsonUtility.ToJson(payload));
        return JsonUtility.FromJson<DailyMissionsData>(result.Payload);
    }
    
    async Task<UserWallets> GetAllWallets()
    {
        var result = await client.RpcAsync(session, "wallet_get_all", "{}");
        return JsonUtility.FromJson<UserWallets>(result.Payload);
    }
    
    async Task LogAnalyticsEvent(string eventName)
    {
        var payload = new { gameId = gameId, eventName = eventName };
        await client.RpcAsync(
            session, "analytics_log_event", JsonUtility.ToJson(payload));
    }
    
    void OnApplicationQuit()
    {
        _ = LogAnalyticsEvent("session_end");
    }
}
```

---

## Troubleshooting

### Common Issues

#### 1. Authentication Failed

**Error**: `401 Unauthorized`

**Solution**:
- Check server key is correct
- Verify server URL and port
- Ensure account creation is enabled (`create=true`)

#### 2. RPC Not Found

**Error**: `404 Not Found - RPC not registered`

**Solution**:
- Verify RPC name spelling
- Check Nakama server logs for RPC registration
- Ensure JavaScript runtime is enabled

#### 3. Invalid Game ID

**Error**: `Invalid gameId format`

**Solution**:
- Ensure gameId is a valid UUID
- Check for typos or extra spaces
- Verify your game is registered in the system

#### 4. Session Expired

**Error**: `401 Token expired`

**Solution**:
```csharp
if (session.IsExpired)
{
    session = await client.SessionRefreshAsync(session);
    await SaveSession(session);
}
```

#### 5. Leaderboard Not Found

**Error**: `Leaderboard does not exist`

**Solution**:
- Run `create_time_period_leaderboards` RPC first
- Check leaderboard ID format
- Verify game is registered

---

## API Reference

### All Available RPCs

| Category | RPC Name | Description |
|----------|----------|-------------|
| **Leaderboards** | `create_time_period_leaderboards` | Create all time-period leaderboards |
| | `submit_score_to_time_periods` | Submit score to all time periods |
| | `get_time_period_leaderboard` | Get leaderboard for specific period |
| **Daily Rewards** | `daily_rewards_get_status` | Check daily reward status |
| | `daily_rewards_claim` | Claim today's reward |
| **Daily Missions** | `get_daily_missions` | Get all missions with progress |
| | `submit_mission_progress` | Update mission progress |
| | `claim_mission_reward` | Claim completed mission reward |
| **Wallet** | `wallet_get_all` | Get all wallets |
| | `wallet_update_global` | Update global wallet |
| | `wallet_update_game_wallet` | Update game wallet |
| | `wallet_transfer_between_game_wallets` | Transfer between wallets |
| **Analytics** | `analytics_log_event` | Log analytics event |
| **Friends** | `friends_block` | Block a user |
| | `friends_unblock` | Unblock a user |
| | `friends_remove` | Remove friend |
| | `friends_list` | Get friends list |
| | `friends_challenge_user` | Challenge friend |
| | `friends_spectate` | Spectate friend's match |
| **Push Notifications** | `push_register_token` | Register device push token |
| | `push_send_event` | Send push notification event |
| | `push_get_endpoints` | Get user's registered endpoints |
| **Wallet Mapping** | `get_user_wallet` | Get/create user wallet (Cognito) |
| | `link_wallet_to_game` | Link wallet to game |
| | `get_wallet_registry` | Get all wallets (admin) |

### Leaderboard Time Periods

| Period | Reset Schedule (Cron) | Description |
|--------|----------------------|-------------|
| `daily` | `0 0 * * *` | Resets every day at midnight UTC |
| `weekly` | `0 0 * * 0` | Resets every Sunday at midnight UTC |
| `monthly` | `0 0 1 * *` | Resets on 1st of month at midnight UTC |
| `alltime` | (no reset) | Never resets - permanent rankings |

### Storage Collections

| Collection | Purpose | Key Format |
|------------|---------|------------|
| `daily_streaks` | Daily reward streaks | `user_daily_streak_{userId}_{gameId}` |
| `daily_missions` | Mission progress | `mission_progress_{userId}_{gameId}` |
| `wallets` | Wallet data | `wallet_{userId}_{gameId}` |
| `transaction_logs` | Transaction history | `transaction_log_{userId}_{timestamp}` |
| `analytics_events` | Event logs | `event_{userId}_{gameId}_{timestamp}` |
| `leaderboards_registry` | Leaderboard metadata | `time_period_leaderboards` |
| `push_endpoints` | Push notification endpoints | `push_endpoint_{userId}_{gameId}_{platform}` |
| `push_notification_logs` | Push notification history | `push_log_{userId}_{timestamp}` |

---

## Support & Resources

### Official Documentation

- [Nakama Docs](https://heroiclabs.com/docs)
- [Unity SDK Documentation](https://heroiclabs.com/docs/nakama/client-libraries/unity/)
- [Nakama Forum](https://forum.heroiclabs.com)

### Example Projects

- Unity Sample Project: `/samples/unity/`
- API Test Scripts: `/tests/api/`

### Getting Help

1. Check this documentation first
2. Review Nakama logs: `docker-compose logs nakama`
3. Test RPCs with cURL before integrating
4. Contact technical support with:
   - Game ID
   - Error logs
   - Code snippet
   - Expected vs actual behavior

---

**Last Updated**: 2025-11-13  
**Version**: 2.0  
**Module Location**: `/data/modules/`

