# Time-Period Leaderboards - Complete Guide

## Overview

The Nakama backend provides comprehensive time-period leaderboard support for all games. Each game automatically gets **four different leaderboards** based on time periods:

- **Daily Leaderboard**: Resets every day at midnight UTC
- **Weekly Leaderboard**: Resets every Sunday at midnight UTC
- **Monthly Leaderboard**: Resets on the 1st of each month at midnight UTC
- **All-Time Leaderboard**: Never resets (permanent rankings)

Additionally, there are **global leaderboards** that aggregate scores across all games in the ecosystem.

---

## Leaderboard Architecture

### Naming Convention

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

### Reset Schedules (Cron Format)

| Period | Cron Schedule | Description |
|--------|---------------|-------------|
| Daily | `0 0 * * *` | Every day at midnight UTC |
| Weekly | `0 0 * * 0` | Every Sunday at midnight UTC |
| Monthly | `0 0 1 * *` | First day of month at midnight UTC |
| All-Time | (none) | Never resets |

### Leaderboard Configuration

All leaderboards use the following configuration:

- **Sort Order**: Descending (highest scores first)
- **Operator**: Best (keeps the best score per user)
- **Authoritative**: Server-side only (clients cannot write directly)

---

## Setup & Configuration

### 1. One-Time Leaderboard Creation

**Important**: This should be run once by an administrator, not by each game client.

#### RPC: `create_time_period_leaderboards`

**Request:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "summary": {
    "totalCreated": 28,
    "totalSkipped": 0,
    "totalErrors": 0,
    "gamesProcessed": 6
  },
  "global": {
    "created": [
      {
        "leaderboardId": "leaderboard_global_daily",
        "period": "daily",
        "scope": "global",
        "resetSchedule": "0 0 * * *"
      },
      {
        "leaderboardId": "leaderboard_global_weekly",
        "period": "weekly",
        "scope": "global",
        "resetSchedule": "0 0 * * 0"
      },
      {
        "leaderboardId": "leaderboard_global_monthly",
        "period": "monthly",
        "scope": "global",
        "resetSchedule": "0 0 1 * *"
      },
      {
        "leaderboardId": "leaderboard_global_alltime",
        "period": "alltime",
        "scope": "global",
        "resetSchedule": ""
      }
    ],
    "skipped": [],
    "errors": []
  },
  "games": [
    {
      "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
      "created": [
        {
          "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_daily",
          "period": "daily",
          "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
          "resetSchedule": "0 0 * * *"
        }
        // ... more periods
      ],
      "skipped": [],
      "errors": []
    }
    // ... more games
  ],
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
using Nakama;
using System.Threading.Tasks;
using UnityEngine;

public class LeaderboardSetup : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    // Call this once during initial setup (admin function)
    public async Task CreateAllLeaderboards()
    {
        try
        {
            var result = await client.RpcAsync(
                session, 
                "create_time_period_leaderboards", 
                "{}"
            );
            
            var response = JsonUtility.FromJson<LeaderboardCreationResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"✓ Created {response.summary.totalCreated} leaderboards");
                Debug.Log($"✓ Skipped {response.summary.totalSkipped} existing leaderboards");
                Debug.Log($"✓ Processed {response.summary.gamesProcessed} games");
                
                if (response.summary.totalErrors > 0)
                {
                    Debug.LogWarning($"⚠ {response.summary.totalErrors} errors occurred");
                }
            }
            else
            {
                Debug.LogError($"✗ Failed: {response.error}");
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"RPC failed: {ex.Message}");
        }
    }
}

[System.Serializable]
public class LeaderboardCreationResponse
{
    public bool success;
    public LeaderboardSummary summary;
    public GlobalLeaderboards global;
    public GameLeaderboards[] games;
    public string error;
    public string timestamp;
}

[System.Serializable]
public class LeaderboardSummary
{
    public int totalCreated;
    public int totalSkipped;
    public int totalErrors;
    public int gamesProcessed;
}

[System.Serializable]
public class GlobalLeaderboards
{
    public LeaderboardInfo[] created;
    public LeaderboardInfo[] skipped;
    public LeaderboardError[] errors;
}

[System.Serializable]
public class GameLeaderboards
{
    public string gameId;
    public LeaderboardInfo[] created;
    public LeaderboardInfo[] skipped;
    public LeaderboardError[] errors;
}

[System.Serializable]
public class LeaderboardInfo
{
    public string leaderboardId;
    public string period;
    public string gameId;
    public string scope;
    public string resetSchedule;
}

[System.Serializable]
public class LeaderboardError
{
    public string leaderboardId;
    public string period;
    public string gameId;
    public string scope;
    public string error;
}
```

---

## Submitting Scores

### RPC: `submit_score_to_time_periods`

Submits a score to **all time-period leaderboards** for a game in a single call. This includes:
- Game-specific leaderboards (daily, weekly, monthly, all-time)
- Global leaderboards (daily, weekly, monthly, all-time)

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "score": 1000,
  "subscore": 0,
  "metadata": {
    "level": 5,
    "difficulty": "hard",
    "completionTime": 120
  }
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "score": 1000,
  "userId": "user-uuid",
  "results": [
    {
      "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_daily",
      "period": "daily",
      "scope": "game",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_weekly",
      "period": "weekly",
      "scope": "game",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_monthly",
      "period": "monthly",
      "scope": "game",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_alltime",
      "period": "alltime",
      "scope": "game",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_global_daily",
      "period": "daily",
      "scope": "global",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_global_weekly",
      "period": "weekly",
      "scope": "global",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_global_monthly",
      "period": "monthly",
      "scope": "global",
      "success": true
    },
    {
      "leaderboardId": "leaderboard_global_alltime",
      "period": "alltime",
      "scope": "global",
      "success": true
    }
  ],
  "errors": [],
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public class ScoreSubmitter : MonoBehaviour
{
    [SerializeField] private string gameId = "YOUR-GAME-UUID";
    
    private IClient client;
    private ISession session;
    
    public async Task<bool> SubmitScore(
        long score, 
        int subscore = 0, 
        ScoreMetadata metadata = null)
    {
        try
        {
            var payload = new ScoreSubmission
            {
                gameId = gameId,
                score = score,
                subscore = subscore,
                metadata = metadata ?? new ScoreMetadata()
            };
            
            var result = await client.RpcAsync(
                session, 
                "submit_score_to_time_periods", 
                JsonUtility.ToJson(payload)
            );
            
            var response = JsonUtility.FromJson<ScoreSubmissionResponse>(result.Payload);
            
            if (response.success)
            {
                Debug.Log($"✓ Score {score} submitted successfully");
                Debug.Log($"✓ Submitted to {response.results.Length} leaderboards");
                
                // Check for any errors
                if (response.errors != null && response.errors.Length > 0)
                {
                    Debug.LogWarning($"⚠ {response.errors.Length} leaderboards failed:");
                    foreach (var error in response.errors)
                    {
                        Debug.LogWarning($"  - {error.leaderboardId}: {error.error}");
                    }
                }
                
                return true;
            }
            else
            {
                Debug.LogError($"✗ Score submission failed: {response.error}");
                return false;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"RPC failed: {ex.Message}");
            return false;
        }
    }
    
    // Convenience methods
    public async void OnLevelComplete(int level, long score, float time)
    {
        var metadata = new ScoreMetadata
        {
            level = level,
            completionTime = (int)time,
            difficulty = GetCurrentDifficulty()
        };
        
        await SubmitScore(score, 0, metadata);
    }
    
    public async void OnMatchComplete(long finalScore)
    {
        await SubmitScore(finalScore);
    }
    
    private string GetCurrentDifficulty()
    {
        // Your game's difficulty logic
        return "normal";
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
    public int completionTime;
}

[System.Serializable]
public class ScoreSubmissionResponse
{
    public bool success;
    public string gameId;
    public long score;
    public string userId;
    public LeaderboardResult[] results;
    public LeaderboardSubmissionError[] errors;
    public string error;
    public string timestamp;
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
public class LeaderboardSubmissionError
{
    public string leaderboardId;
    public string period;
    public string scope;
    public string error;
}
```

---

## Retrieving Leaderboards

### RPC: `get_time_period_leaderboard`

Retrieves leaderboard records for a specific time period and scope (game or global).

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "period": "weekly",
  "limit": 10,
  "cursor": ""
}
```

Or for global leaderboards:
```json
{
  "scope": "global",
  "period": "monthly",
  "limit": 50,
  "cursor": ""
}
```

**Request Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `gameId` | string | No* | Game UUID (required unless scope is "global") |
| `scope` | string | No | "game" or "global" (defaults to "game") |
| `period` | string | Yes | "daily", "weekly", "monthly", or "alltime" |
| `limit` | number | No | Number of records to return (default: 10, max: 100) |
| `cursor` | string | No | Pagination cursor from previous response |
| `ownerIds` | string[] | No | Filter by specific user IDs |

**Response:**
```json
{
  "success": true,
  "leaderboardId": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_weekly",
  "period": "weekly",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "scope": "game",
  "records": [
    {
      "leaderboard_id": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_weekly",
      "owner_id": "user-uuid-1",
      "username": "player1",
      "score": 5000,
      "subscore": 0,
      "num_score": 1,
      "metadata": "{\"level\":10,\"difficulty\":\"hard\"}",
      "create_time": "2025-11-10T12:00:00Z",
      "update_time": "2025-11-13T18:30:00Z",
      "expiry_time": "2025-11-17T00:00:00Z",
      "rank": 1,
      "max_num_score": 1
    },
    {
      "leaderboard_id": "leaderboard_7d4322ae-cd95-4cd9-b003-4ffad2dc31b4_weekly",
      "owner_id": "user-uuid-2",
      "username": "player2",
      "score": 4500,
      "subscore": 0,
      "num_score": 1,
      "metadata": "{}",
      "create_time": "2025-11-11T08:00:00Z",
      "update_time": "2025-11-13T20:15:00Z",
      "expiry_time": "2025-11-17T00:00:00Z",
      "rank": 2,
      "max_num_score": 1
    }
  ],
  "ownerRecords": [],
  "prevCursor": "",
  "nextCursor": "eyJzY29yZSI6NDUwMCwicmFuayI6Mn0=",
  "rankCount": 150
}
```

**Unity Example:**
```csharp
public class LeaderboardViewer : MonoBehaviour
{
    [SerializeField] private string gameId = "YOUR-GAME-UUID";
    
    private IClient client;
    private ISession session;
    
    public async Task<LeaderboardData> GetLeaderboard(
        string period,          // "daily", "weekly", "monthly", "alltime"
        bool isGlobal = false,
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
                Debug.Log($"✓ Retrieved {response.records.Length} records from {response.leaderboardId}");
                Debug.Log($"✓ Total players: {response.rankCount}");
                
                return new LeaderboardData
                {
                    Records = response.records,
                    NextCursor = response.nextCursor,
                    PrevCursor = response.prevCursor,
                    TotalPlayers = response.rankCount
                };
            }
            else
            {
                Debug.LogError($"✗ Failed to get leaderboard: {response.error}");
                return null;
            }
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"RPC failed: {ex.Message}");
            return null;
        }
    }
    
    // Convenience methods
    public async Task<LeaderboardData> GetDailyLeaderboard(bool global = false)
    {
        return await GetLeaderboard("daily", global);
    }
    
    public async Task<LeaderboardData> GetWeeklyLeaderboard(bool global = false)
    {
        return await GetLeaderboard("weekly", global);
    }
    
    public async Task<LeaderboardData> GetMonthlyLeaderboard(bool global = false)
    {
        return await GetLeaderboard("monthly", global);
    }
    
    public async Task<LeaderboardData> GetAllTimeLeaderboard(bool global = false)
    {
        return await GetLeaderboard("alltime", global);
    }
    
    // Get leaderboard around current player
    public async Task<LeaderboardData> GetLeaderboardAroundPlayer(
        string period, 
        bool isGlobal = false)
    {
        // Use ownerIds to filter for current player
        var payload = new LeaderboardRequest
        {
            gameId = isGlobal ? null : gameId,
            scope = isGlobal ? "global" : "game",
            period = period,
            limit = 21, // Get 10 above and 10 below
            ownerIds = new string[] { session.UserId }
        };
        
        var result = await client.RpcAsync(
            session, 
            "get_time_period_leaderboard", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<LeaderboardDataResponse>(result.Payload);
        
        if (response.success && response.ownerRecords != null && response.ownerRecords.Length > 0)
        {
            // Player's record
            var playerRecord = response.ownerRecords[0];
            Debug.Log($"✓ Player rank: {playerRecord.rank}");
            Debug.Log($"✓ Player score: {playerRecord.score}");
        }
        
        return new LeaderboardData
        {
            Records = response.records,
            OwnerRecords = response.ownerRecords,
            NextCursor = response.nextCursor,
            PrevCursor = response.prevCursor,
            TotalPlayers = response.rankCount
        };
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
    public string[] ownerIds;
}

[System.Serializable]
public class LeaderboardDataResponse
{
    public bool success;
    public string leaderboardId;
    public string period;
    public string gameId;
    public string scope;
    public LeaderboardRecord[] records;
    public LeaderboardRecord[] ownerRecords;
    public string prevCursor;
    public string nextCursor;
    public int rankCount;
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
    public int max_num_score;
}

public class LeaderboardData
{
    public LeaderboardRecord[] Records;
    public LeaderboardRecord[] OwnerRecords;
    public string NextCursor;
    public string PrevCursor;
    public int TotalPlayers;
}
```

---

## Complete Leaderboard UI Implementation

### Full Example with UI

```csharp
using Nakama;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;
using UnityEngine.UI;

public class LeaderboardUIManager : MonoBehaviour
{
    [Header("Configuration")]
    [SerializeField] private string gameId = "YOUR-GAME-UUID";
    
    [Header("UI References")]
    [SerializeField] private Transform leaderboardContainer;
    [SerializeField] private GameObject leaderboardEntryPrefab;
    [SerializeField] private Button dailyButton;
    [SerializeField] private Button weeklyButton;
    [SerializeField] private Button monthlyButton;
    [SerializeField] private Button alltimeButton;
    [SerializeField] private Button globalToggle;
    [SerializeField] private Button refreshButton;
    [SerializeField] private Text titleText;
    [SerializeField] private Text playerRankText;
    [SerializeField] private Text playerScoreText;
    [SerializeField] private GameObject loadingIndicator;
    
    private IClient client;
    private ISession session;
    private string currentPeriod = "weekly";
    private bool showGlobal = false;
    
    void Start()
    {
        // Initialize Nakama
        client = new Client("http", "127.0.0.1", 7350, "defaultkey");
        
        // Setup button listeners
        dailyButton.onClick.AddListener(() => LoadLeaderboard("daily"));
        weeklyButton.onClick.AddListener(() => LoadLeaderboard("weekly"));
        monthlyButton.onClick.AddListener(() => LoadLeaderboard("monthly"));
        alltimeButton.onClick.AddListener(() => LoadLeaderboard("alltime"));
        globalToggle.onClick.AddListener(ToggleGlobalLeaderboard);
        refreshButton.onClick.AddListener(() => LoadLeaderboard(currentPeriod));
        
        // Authenticate and load initial leaderboard
        AuthenticateAndLoad();
    }
    
    async void AuthenticateAndLoad()
    {
        try
        {
            session = await client.AuthenticateDeviceAsync(
                SystemInfo.deviceUniqueIdentifier, null, true);
            
            Debug.Log($"Authenticated as {session.UserId}");
            
            // Load initial leaderboard
            await LoadLeaderboard(currentPeriod);
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Authentication failed: {ex.Message}");
        }
    }
    
    async Task LoadLeaderboard(string period)
    {
        currentPeriod = period;
        
        // Update UI
        UpdatePeriodButtons(period);
        UpdateTitle();
        ShowLoading(true);
        
        try
        {
            // Clear existing entries
            ClearLeaderboard();
            
            // Fetch leaderboard data
            var data = await GetLeaderboard(period, showGlobal, 50);
            
            if (data != null)
            {
                // Display entries
                DisplayLeaderboard(data);
                
                // Update player rank info
                UpdatePlayerInfo(data);
            }
        }
        catch (System.Exception ex)
        {
            Debug.LogError($"Failed to load leaderboard: {ex.Message}");
        }
        finally
        {
            ShowLoading(false);
        }
    }
    
    async Task<LeaderboardData> GetLeaderboard(
        string period, 
        bool isGlobal, 
        int limit)
    {
        var payload = new LeaderboardRequest
        {
            gameId = isGlobal ? null : gameId,
            scope = isGlobal ? "global" : "game",
            period = period,
            limit = limit,
            ownerIds = new string[] { session.UserId }
        };
        
        var result = await client.RpcAsync(
            session, 
            "get_time_period_leaderboard", 
            JsonUtility.ToJson(payload)
        );
        
        var response = JsonUtility.FromJson<LeaderboardDataResponse>(result.Payload);
        
        if (response.success)
        {
            return new LeaderboardData
            {
                Records = response.records,
                OwnerRecords = response.ownerRecords,
                NextCursor = response.nextCursor,
                PrevCursor = response.prevCursor,
                TotalPlayers = response.rankCount
            };
        }
        
        return null;
    }
    
    void DisplayLeaderboard(LeaderboardData data)
    {
        if (data.Records == null || data.Records.Length == 0)
        {
            Debug.Log("No leaderboard entries found");
            return;
        }
        
        foreach (var record in data.Records)
        {
            var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
            var entryUI = entry.GetComponent<LeaderboardEntryUI>();
            
            // Check if this is the current player
            bool isPlayer = record.owner_id == session.UserId;
            
            entryUI.SetData(
                record.rank, 
                record.username, 
                record.score, 
                isPlayer
            );
        }
        
        Debug.Log($"Displayed {data.Records.Length} leaderboard entries");
    }
    
    void UpdatePlayerInfo(LeaderboardData data)
    {
        if (data.OwnerRecords != null && data.OwnerRecords.Length > 0)
        {
            var playerRecord = data.OwnerRecords[0];
            playerRankText.text = $"Your Rank: #{playerRecord.rank}";
            playerScoreText.text = $"Your Score: {playerRecord.score:N0}";
        }
        else
        {
            playerRankText.text = "Your Rank: Not Ranked";
            playerScoreText.text = "Your Score: 0";
        }
    }
    
    void ClearLeaderboard()
    {
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }
    }
    
    void UpdateTitle()
    {
        string scope = showGlobal ? "Global" : "Game";
        string period = currentPeriod.ToUpper();
        titleText.text = $"{scope} {period} Leaderboard";
    }
    
    void UpdatePeriodButtons(string activePeriod)
    {
        dailyButton.interactable = activePeriod != "daily";
        weeklyButton.interactable = activePeriod != "weekly";
        monthlyButton.interactable = activePeriod != "monthly";
        alltimeButton.interactable = activePeriod != "alltime";
    }
    
    void ToggleGlobalLeaderboard()
    {
        showGlobal = !showGlobal;
        LoadLeaderboard(currentPeriod);
    }
    
    void ShowLoading(bool show)
    {
        if (loadingIndicator != null)
        {
            loadingIndicator.SetActive(show);
        }
    }
}

public class LeaderboardEntryUI : MonoBehaviour
{
    [SerializeField] private Text rankText;
    [SerializeField] private Text usernameText;
    [SerializeField] private Text scoreText;
    [SerializeField] private Image background;
    [SerializeField] private Color normalColor = Color.white;
    [SerializeField] private Color playerColor = Color.yellow;
    
    public void SetData(long rank, string username, long score, bool isPlayer)
    {
        rankText.text = GetRankText(rank);
        usernameText.text = username;
        scoreText.text = score.ToString("N0");
        
        if (background != null)
        {
            background.color = isPlayer ? playerColor : normalColor;
        }
    }
    
    private string GetRankText(long rank)
    {
        // Add medal emojis for top 3
        switch (rank)
        {
            case 1: return "🥇 1";
            case 2: return "🥈 2";
            case 3: return "🥉 3";
            default: return $"#{rank}";
        }
    }
}
```

---

## Best Practices

### 1. Score Submission Timing

```csharp
// ✓ Good: Submit after level/match complete
void OnLevelComplete(long score)
{
    _ = SubmitScore(score);
}

// ✗ Bad: Don't submit partial scores during gameplay
void Update()
{
    // Don't do this!
    _ = SubmitScore(currentScore);
}
```

### 2. Leaderboard Caching

```csharp
public class LeaderboardCache
{
    private Dictionary<string, CachedLeaderboard> cache = new Dictionary<string, CachedLeaderboard>();
    private const float CACHE_DURATION = 60f; // 1 minute
    
    public async Task<LeaderboardData> GetLeaderboard(
        string period, 
        bool forceRefresh = false)
    {
        string key = $"{period}_{(showGlobal ? "global" : gameId)}";
        
        if (!forceRefresh && cache.ContainsKey(key))
        {
            var cached = cache[key];
            if (Time.time - cached.timestamp < CACHE_DURATION)
            {
                return cached.data;
            }
        }
        
        // Fetch fresh data
        var data = await FetchLeaderboard(period);
        
        cache[key] = new CachedLeaderboard
        {
            data = data,
            timestamp = Time.time
        };
        
        return data;
    }
}

class CachedLeaderboard
{
    public LeaderboardData data;
    public float timestamp;
}
```

### 3. Error Handling

```csharp
public async Task<bool> SubmitScoreWithRetry(long score, int maxRetries = 3)
{
    int retries = 0;
    
    while (retries < maxRetries)
    {
        try
        {
            return await SubmitScore(score);
        }
        catch (ApiResponseException ex)
        {
            retries++;
            
            if (ex.StatusCode >= 500 && retries < maxRetries)
            {
                // Server error - retry with exponential backoff
                await Task.Delay(1000 * retries);
                Debug.LogWarning($"Retry {retries}/{maxRetries} for score submission");
            }
            else
            {
                Debug.LogError($"Score submission failed: {ex.Message}");
                return false;
            }
        }
    }
    
    return false;
}
```

### 4. Metadata Usage

```csharp
// Store useful context in metadata
var metadata = new ScoreMetadata
{
    level = currentLevel,
    difficulty = difficultyMode,
    completionTime = (int)gameTime,
    character = selectedCharacter,
    mode = gameMode
};

await SubmitScore(finalScore, 0, metadata);
```

---

## Storage Collections

### Leaderboard Registry

The system maintains a registry of all created leaderboards in storage:

**Collection**: `leaderboards_registry`  
**Key**: `time_period_leaderboards`  
**Permissions**: Read: 1 (Owner), Write: 0 (Server only)

**Structure**:
```json
{
  "leaderboards": [
    {
      "leaderboardId": "leaderboard_global_daily",
      "period": "daily",
      "scope": "global",
      "resetSchedule": "0 0 * * *"
    },
    {
      "leaderboardId": "leaderboard_{gameId}_weekly",
      "period": "weekly",
      "gameId": "{gameId}",
      "scope": "game",
      "resetSchedule": "0 0 * * 0"
    }
  ],
  "lastUpdated": "2025-11-13T22:00:00.000Z",
  "totalGames": 6
}
```

---

## Testing

### Manual Testing with cURL

```bash
# 1. Create leaderboards (admin only)
curl -X POST "http://127.0.0.1:7350/v2/rpc/create_time_period_leaderboards" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'

# 2. Submit score
curl -X POST "http://127.0.0.1:7350/v2/rpc/submit_score_to_time_periods" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
    "score": 1000,
    "subscore": 0,
    "metadata": {
      "level": 5
    }
  }'

# 3. Get weekly leaderboard
curl -X POST "http://127.0.0.1:7350/v2/rpc/get_time_period_leaderboard" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
    "period": "weekly",
    "limit": 10
  }'

# 4. Get global monthly leaderboard
curl -X POST "http://127.0.0.1:7350/v2/rpc/get_time_period_leaderboard" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "global",
    "period": "monthly",
    "limit": 50
  }'
```

---

## Troubleshooting

### Common Issues

#### 1. Leaderboard Not Found

**Error**: `Failed to fetch leaderboard records: leaderboard not found`

**Solution**:
- Run `create_time_period_leaderboards` RPC first
- Verify the game is registered in the IntelliVerse system
- Check leaderboard ID format

#### 2. Score Not Updating

**Possible Causes**:
- Using "best" operator (only updates if score is better)
- Wrong leaderboard ID
- Network issues

**Solution**:
- Check response for errors
- Verify leaderboard operator is "best"
- Look at server logs

#### 3. Reset Not Happening

**Check**:
- Server timezone is UTC
- Cron schedule is correct
- Server has been running during reset time

---

## Advanced Features

### Pagination

```csharp
public async Task<List<LeaderboardRecord>> GetAllRecords(string period)
{
    var allRecords = new List<LeaderboardRecord>();
    string cursor = "";
    
    do
    {
        var data = await GetLeaderboard(period, false, 100, cursor);
        
        if (data != null && data.Records != null)
        {
            allRecords.AddRange(data.Records);
            cursor = data.NextCursor;
        }
        else
        {
            break;
        }
        
    } while (!string.IsNullOrEmpty(cursor));
    
    return allRecords;
}
```

### Filtering by Specific Users

```csharp
public async Task<LeaderboardData> GetLeaderboardForFriends(
    string period, 
    string[] friendIds)
{
    var payload = new LeaderboardRequest
    {
        gameId = gameId,
        period = period,
        limit = 100,
        ownerIds = friendIds
    };
    
    var result = await client.RpcAsync(
        session, 
        "get_time_period_leaderboard", 
        JsonUtility.ToJson(payload)
    );
    
    var response = JsonUtility.FromJson<LeaderboardDataResponse>(result.Payload);
    
    if (response.success)
    {
        return new LeaderboardData { Records = response.records };
    }
    
    return null;
}
```

---

## Summary

The time-period leaderboard system provides:

✅ **Four Time Periods**: Daily, Weekly, Monthly, All-Time  
✅ **Two Scopes**: Per-Game and Global  
✅ **Automatic Resets**: Based on cron schedules  
✅ **Server-Authoritative**: Prevents cheating  
✅ **Single-Call Submission**: Submit to all leaderboards at once  
✅ **Flexible Retrieval**: Get any period/scope combination  
✅ **Metadata Support**: Store custom data with scores  
✅ **Pagination**: Handle large leaderboards  

For a complete integration example, see `UNITY_DEVELOPER_COMPLETE_GUIDE.md`.

---

**Module Location**: `/data/modules/leaderboards_timeperiod.js`  
**Last Updated**: 2025-11-13  
**Version**: 1.0
