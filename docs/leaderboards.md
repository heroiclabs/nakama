# Leaderboards Documentation

## Overview

The Nakama leaderboard system supports **comprehensive multi-type leaderboards** that automatically update when players submit scores. The system includes:

- Per-game leaderboards
- Global (cross-game) leaderboards
- Time-period leaderboards (daily, weekly, monthly, all-time)
- Friends-only leaderboards
- Custom leaderboards from the registry

## Leaderboard Types

### 1. Per-Game Leaderboards

**Format**: `leaderboard_<game_id>`

**Example**: `leaderboard_abc-123-game-uuid`

**Purpose**: Ranks players within a single game

**Reset Schedule**: Weekly (Sundays at midnight UTC)

### 2. Global Leaderboards

**Format**: `leaderboard_global`

**Purpose**: Ranks all players across all games in the ecosystem

**Reset Schedule**: Weekly (Sundays at midnight UTC)

### 3. Time-Period Game Leaderboards

**Formats**:
- `leaderboard_<game_id>_daily` - Resets daily at midnight UTC
- `leaderboard_<game_id>_weekly` - Resets Sundays at midnight UTC
- `leaderboard_<game_id>_monthly` - Resets on the 1st of each month at midnight UTC
- `leaderboard_<game_id>_alltime` - Never resets

**Example**: 
- `leaderboard_abc-123_daily`
- `leaderboard_abc-123_weekly`
- `leaderboard_abc-123_monthly`
- `leaderboard_abc-123_alltime`

### 4. Time-Period Global Leaderboards

**Formats**:
- `leaderboard_global_daily`
- `leaderboard_global_weekly`
- `leaderboard_global_monthly`
- `leaderboard_global_alltime`

**Purpose**: Global rankings across all games with time-based resets

### 5. Friends Leaderboards

**Formats**:
- `leaderboard_friends_<game_id>` - Friends-only per-game leaderboard
- `leaderboard_friends_global` - Friends-only global leaderboard

**Purpose**: Show rankings filtered to the player's friends list

### 6. Registry Leaderboards

All leaderboards created through the system are tracked in the registry and automatically updated when scores are submitted.

## Reset Schedules

| Type | Cron Expression | Description |
|------|----------------|-------------|
| Daily | `0 0 * * *` | Every day at midnight UTC |
| Weekly | `0 0 * * 0` | Every Sunday at midnight UTC |
| Monthly | `0 0 1 * *` | First day of month at midnight UTC |
| All-Time | `` (empty) | Never resets |

## Score Submission

### Important: Leaderboard Scores vs. Wallet Balances

**Leaderboard scores** and **wallet balances** are distinct concepts:

- **Leaderboard Score**: Your ranking position for competition (stored in Nakama's leaderboard system)
- **Wallet Balance**: Your in-game currency (stored in `quizverse:wallet:*`)

⚠️ **Note**: The `submit_score_and_sync` RPC updates BOTH by default. For production games, consider keeping them separate. See [Wallet Documentation](./wallets.md#keeping-leaderboard-scores-and-wallet-balances-separate) for detailed guidance.

### RPC: submit_score_and_sync

Submits a score to **all relevant leaderboards** automatically.

**What it does**:
1. ✅ Writes score to 12+ leaderboards (primary purpose)
2. ⚠️ Sets game wallet balance to score value (side effect)

**Input**:
```json
{
  "score": 1500,
  "device_id": "unique-device-identifier",
  "game_id": "your-game-uuid"
}
```

**Response**:
```json
{
  "success": true,
  "score": 1500,
  "wallet_balance": 1500,
  "leaderboards_updated": [
    "leaderboard_your-game-uuid",
    "leaderboard_your-game-uuid_daily",
    "leaderboard_your-game-uuid_weekly",
    "leaderboard_your-game-uuid_monthly",
    "leaderboard_your-game-uuid_alltime",
    "leaderboard_global",
    "leaderboard_global_daily",
    "leaderboard_global_weekly",
    "leaderboard_global_monthly",
    "leaderboard_global_alltime",
    "leaderboard_friends_your-game-uuid",
    "leaderboard_friends_global"
  ],
  "game_id": "your-game-uuid"
}
```

## Unity Implementation

### Score Submission Class

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

[Serializable]
public class ScoreResponse
{
    public bool success;
    public int score;
    public int wallet_balance;
    public string[] leaderboards_updated;
    public string game_id;
}

public class LeaderboardManager : MonoBehaviour
{
    private IClient client;
    private ISession session;
    private string gameId = "your-game-uuid";
    
    public async Task<ScoreResponse> SubmitScore(int score)
    {
        string deviceId = DeviceIdentity.GetDeviceId();
        
        var payload = new Dictionary<string, object>
        {
            { "score", score },
            { "device_id", deviceId },
            { "game_id", gameId }
        };
        
        var payloadJson = JsonUtility.ToJson(payload);
        var result = await client.RpcAsync(session, "submit_score_and_sync", payloadJson);
        
        var response = JsonUtility.FromJson<ScoreResponse>(result.Payload);
        
        if (response.success)
        {
            Debug.Log($"Score {response.score} submitted to {response.leaderboards_updated.Length} leaderboards");
            Debug.Log($"New wallet balance: {response.wallet_balance}");
        }
        
        return response;
    }
}
```

### Reading Leaderboard Data

```csharp
public class LeaderboardDisplay : MonoBehaviour
{
    private IClient client;
    private ISession session;
    
    public async Task<IApiLeaderboardRecordList> GetGameLeaderboard(string gameId, int limit = 10)
    {
        string leaderboardId = $"leaderboard_{gameId}";
        
        var result = await client.ListLeaderboardRecordsAsync(
            session, 
            leaderboardId,
            ownerIds: null,
            limit: limit
        );
        
        return result;
    }
    
    public async Task<IApiLeaderboardRecordList> GetDailyLeaderboard(string gameId)
    {
        string leaderboardId = $"leaderboard_{gameId}_daily";
        return await client.ListLeaderboardRecordsAsync(session, leaderboardId);
    }
    
    public async Task<IApiLeaderboardRecordList> GetGlobalLeaderboard()
    {
        string leaderboardId = "leaderboard_global";
        return await client.ListLeaderboardRecordsAsync(session, leaderboardId);
    }
    
    public async Task<IApiLeaderboardRecordList> GetFriendsLeaderboard(string gameId)
    {
        string leaderboardId = $"leaderboard_friends_{gameId}";
        
        // Get friends list
        var friends = await client.ListFriendsAsync(session);
        var friendIds = new List<string>();
        
        foreach (var friend in friends.Friends)
        {
            friendIds.Add(friend.User.Id);
        }
        
        // Add self
        friendIds.Add(session.UserId);
        
        // Get leaderboard for friends
        var result = await client.ListLeaderboardRecordsAsync(
            session,
            leaderboardId,
            ownerIds: friendIds.ToArray()
        );
        
        return result;
    }
    
    public void DisplayLeaderboard(IApiLeaderboardRecordList records)
    {
        foreach (var record in records.Records)
        {
            Debug.Log($"{record.Rank}. {record.Username}: {record.Score}");
        }
    }
}
```

### Complete Leaderboard UI Example

```csharp
using Nakama;
using UnityEngine;
using UnityEngine.UI;
using System.Collections.Generic;

public class LeaderboardUI : MonoBehaviour
{
    [SerializeField] private Transform leaderboardContainer;
    [SerializeField] private GameObject leaderboardEntryPrefab;
    [SerializeField] private Dropdown leaderboardTypeDropdown;
    
    private IClient client;
    private ISession session;
    private string gameId = "your-game-uuid";
    
    void Start()
    {
        PopulateDropdown();
        leaderboardTypeDropdown.onValueChanged.AddListener(OnLeaderboardTypeChanged);
    }
    
    void PopulateDropdown()
    {
        leaderboardTypeDropdown.options.Clear();
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Game - All Time"));
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Game - Daily"));
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Game - Weekly"));
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Game - Monthly"));
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Global"));
        leaderboardTypeDropdown.options.Add(new Dropdown.OptionData("Friends Only"));
        leaderboardTypeDropdown.RefreshShownValue();
    }
    
    async void OnLeaderboardTypeChanged(int index)
    {
        string leaderboardId = "";
        
        switch (index)
        {
            case 0: leaderboardId = $"leaderboard_{gameId}_alltime"; break;
            case 1: leaderboardId = $"leaderboard_{gameId}_daily"; break;
            case 2: leaderboardId = $"leaderboard_{gameId}_weekly"; break;
            case 3: leaderboardId = $"leaderboard_{gameId}_monthly"; break;
            case 4: leaderboardId = "leaderboard_global"; break;
            case 5: leaderboardId = $"leaderboard_friends_{gameId}"; break;
        }
        
        await LoadAndDisplayLeaderboard(leaderboardId);
    }
    
    async Task LoadAndDisplayLeaderboard(string leaderboardId)
    {
        // Clear existing entries
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }
        
        try
        {
            var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, 100);
            
            foreach (var record in result.Records)
            {
                CreateLeaderboardEntry(record);
            }
        }
        catch (Exception ex)
        {
            Debug.LogError($"Failed to load leaderboard: {ex.Message}");
        }
    }
    
    void CreateLeaderboardEntry(IApiLeaderboardRecord record)
    {
        var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
        
        // Assuming entry has Text components for rank, username, and score
        entry.transform.Find("Rank").GetComponent<Text>().text = record.Rank.ToString();
        entry.transform.Find("Username").GetComponent<Text>().text = record.Username;
        entry.transform.Find("Score").GetComponent<Text>().text = record.Score.ToString();
        
        // Highlight if it's the current player
        if (record.OwnerId == session.UserId)
        {
            entry.GetComponent<Image>().color = Color.yellow;
        }
    }
}
```

## Leaderboard Metadata

Each score submission includes metadata:

```json
{
  "source": "submit_score_and_sync",
  "gameId": "your-game-uuid",
  "submittedAt": "2024-01-01T12:30:00Z"
}
```

This metadata is accessible when reading leaderboard records:

```csharp
var records = await client.ListLeaderboardRecordsAsync(session, leaderboardId);
foreach (var record in records.Records)
{
    var metadata = record.Metadata;
    Debug.Log($"Score submitted at: {metadata}");
}
```

## How Scores Are Written

When you call `submit_score_and_sync`, the system:

1. **Validates** the input (score, device_id, game_id)
2. **Retrieves** the identity to get username
3. **Writes** to ALL relevant leaderboards:
   - Main game leaderboard
   - All time-period game leaderboards (daily, weekly, monthly, all-time)
   - Global leaderboard
   - All time-period global leaderboards
   - Friends game leaderboard
   - Friends global leaderboard
   - Any existing leaderboards from registry matching the game or global scope
4. **Updates** the game wallet balance to match the score (see warning below)
5. **Returns** the list of updated leaderboards

⚠️ **Important**: Step 4 sets the wallet balance equal to the score. For production games where you want independent economy, see [Keeping Scores and Wallets Separate](./wallets.md#keeping-leaderboard-scores-and-wallet-balances-separate).

## Best Practices

### 1. Submit Scores at Game End

```csharp
void OnGameEnd(int finalScore)
{
    SubmitScore(finalScore);
}
```

### 2. Separate Score Submission from Economy (Recommended)

For production games, keep leaderboard scores and wallet economy separate:

```csharp
async Task OnGameEnd(int finalScore, GameStats stats)
{
    // Submit score to leaderboards
    await client.RpcAsync(session, "submit_score_and_sync",
        JsonUtility.ToJson(new {score = finalScore, device_id, game_id}));
    
    // Award coins based on game logic (NOT score)
    int coinsEarned = CalculateReward(stats);
    await client.UpdateWalletAsync(session, new Dictionary<string, long> {
        { "coins", coinsEarned }
    });
}
```

### 3. Show Feedback to Players

```csharp
async Task SubmitScore(int score)
{
    loadingIndicator.SetActive(true);
    
    try
    {
        var response = await leaderboardManager.SubmitScore(score);
        
        if (response.success)
        {
            ShowSuccessMessage($"Score {score} submitted!");
            ShowLeaderboardCount(response.leaderboards_updated.Length);
        }
    }
    finally
    {
        loadingIndicator.SetActive(false);
    }
}
```

### 4. Cache Leaderboard Data

```csharp
private Dictionary<string, IApiLeaderboardRecordList> cachedLeaderboards = new Dictionary<string, IApiLeaderboardRecordList>();

async Task<IApiLeaderboardRecordList> GetCachedLeaderboard(string leaderboardId, bool forceRefresh = false)
{
    if (!forceRefresh && cachedLeaderboards.ContainsKey(leaderboardId))
    {
        return cachedLeaderboards[leaderboardId];
    }
    
    var result = await client.ListLeaderboardRecordsAsync(session, leaderboardId);
    cachedLeaderboards[leaderboardId] = result;
    return result;
}
```

### 5. Handle Player's Rank

```csharp
async Task ShowPlayerRank(string leaderboardId)
{
    var records = await client.ListLeaderboardRecordsAroundOwnerAsync(
        session,
        leaderboardId,
        session.UserId,
        limit: 1
    );
    
    if (records.OwnerRecords.Count > 0)
    {
        var playerRecord = records.OwnerRecords[0];
        Debug.Log($"Your rank: {playerRecord.Rank} with score {playerRecord.Score}");
    }
}
```

## Leaderboard Creation

Leaderboards are created automatically by calling:

### For Per-Game Leaderboards
```
RPC: create_all_leaderboards_persistent
```

### For Time-Period Leaderboards
```
RPC: create_time_period_leaderboards
```

### For Friends Leaderboards
```
RPC: create_all_leaderboards_with_friends
```

These RPCs should be called by an admin/backend service during initial setup.

## Troubleshooting

### Score Not Appearing
**Problem**: Score submitted but not showing in leaderboard.
**Solution**: 
1. Verify leaderboards were created first
2. Check the `leaderboards_updated` array in response
3. Ensure you're querying the correct leaderboard ID

### "Identity not found" Error
**Problem**: Cannot submit score.
**Solution**: Call `create_or_sync_user` first to create the identity.

### Leaderboard Shows Wrong Usernames
**Problem**: Usernames don't match.
**Solution**: Ensure usernames are updated via `create_or_sync_user` when changed.

## Advanced Features

### Pagination

```csharp
async Task LoadMoreResults(string leaderboardId, string cursor)
{
    var result = await client.ListLeaderboardRecordsAsync(
        session,
        leaderboardId,
        null,
        100,
        cursor
    );
    
    // result.NextCursor can be used for next page
}
```

### Filter by Score Range

```csharp
// Get top players around a specific score
async Task GetPlayersAroundScore(string leaderboardId, long targetScore)
{
    // This requires custom RPC implementation
    // Not available in standard Nakama API
}
```

## See Also

- [Identity System](./identity.md)
- [Wallet System](./wallets.md)
- [Unity Quick Start](./unity/Unity-Quick-Start.md)
- [API Reference](./api/README.md)
