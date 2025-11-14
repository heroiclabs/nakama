# Unity Integration Guide - Copilot Leaderboard & Social Features

## Overview

This guide shows Unity developers how to integrate the advanced leaderboard and social features from the Copilot module. These features extend the base Nakama system with:

- **Score Synchronization**: Sync scores across per-game and global leaderboards
- **Aggregate Scoring**: Calculate total "Power Rank" across all games
- **Friend Leaderboards**: Compete with friends on dedicated leaderboards
- **Social Features**: Friend invites, notifications, and social graph

## Prerequisites

1. **Nakama Unity SDK** installed in your project
2. **Game ID** from your system administrator
3. **Authenticated Nakama session** (see main Unity guide)

## Table of Contents

1. [Setup](#setup)
2. [Score Synchronization](#score-synchronization)
3. [Aggregate Scoring](#aggregate-scoring)
4. [Friend Leaderboards](#friend-leaderboards)
5. [Social Features](#social-features)
6. [Complete Example](#complete-example)

---

## Setup

### Unity C# Classes

Create data classes for RPC payloads and responses:

```csharp
using System;
using System.Collections.Generic;
using UnityEngine;

namespace NakamaIntegration.Copilot
{
    [Serializable]
    public class ScoreSubmission
    {
        public string gameId;
        public int score;
        public Dictionary<string, object> metadata;
    }

    [Serializable]
    public class ScoreSyncResponse
    {
        public bool success;
        public string gameId;
        public int score;
        public string userId;
        public string submittedAt;
        public string error;
    }

    [Serializable]
    public class AggregateScoreResponse
    {
        public bool success;
        public string gameId;
        public int individualScore;
        public int aggregateScore;
        public int leaderboardsProcessed;
        public string error;
    }

    [Serializable]
    public class FriendLeaderboardRequest
    {
        public string leaderboardId;
        public int limit = 100;
    }

    [Serializable]
    public class LeaderboardRecord
    {
        public string ownerId;
        public string username;
        public long score;
        public long rank;
        public long numScore;
        public Dictionary<string, object> metadata;
    }

    [Serializable]
    public class FriendLeaderboardResponse
    {
        public bool success;
        public string leaderboardId;
        public LeaderboardRecord[] records;
        public int totalFriends;
        public string error;
    }

    [Serializable]
    public class FriendInviteRequest
    {
        public string targetUserId;
        public string message;
    }

    [Serializable]
    public class FriendInviteResponse
    {
        public bool success;
        public string inviteId;
        public string targetUserId;
        public string status;
        public string error;
    }

    [Serializable]
    public class InviteActionRequest
    {
        public string inviteId;
    }

    [Serializable]
    public class AcceptInviteResponse
    {
        public bool success;
        public string inviteId;
        public string friendUserId;
        public string friendUsername;
        public string error;
    }

    [Serializable]
    public class NotificationsResponse
    {
        public bool success;
        public NakamaNotification[] notifications;
        public int count;
        public string error;
    }

    [Serializable]
    public class NakamaNotification
    {
        public string id;
        public string subject;
        public object content;
        public int code;
        public string senderId;
        public string createTime;
    }
}
```

### Manager Class

Create a manager to handle copilot features:

```csharp
using Nakama;
using System;
using System.Threading.Tasks;
using UnityEngine;
using NakamaIntegration.Copilot;

public class CopilotLeaderboardManager : MonoBehaviour
{
    [Header("Configuration")]
    [SerializeField] private string gameId;

    // Nakama client and session (injected from main manager)
    private IClient client;
    private ISession session;

    public void Initialize(IClient nakamaClient, ISession nakamaSession, string currentGameId)
    {
        client = nakamaClient;
        session = nakamaSession;
        gameId = currentGameId;
        Debug.Log("[CopilotLeaderboard] Initialized");
    }

    // Methods will be added below...
}
```

---

## Score Synchronization

Submit a score that automatically syncs to both the per-game leaderboard and the global leaderboard.

### Method Implementation

```csharp
/// <summary>
/// Submits a score with automatic synchronization to game and global leaderboards
/// </summary>
public async Task<ScoreSyncResponse> SubmitScoreSync(int score)
{
    try
    {
        var payload = new ScoreSubmission
        {
            gameId = gameId,
            score = score
        };

        var result = await client.RpcAsync(
            session,
            "submit_score_sync",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<ScoreSyncResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotLeaderboard] Score {score} synced successfully!");
        }
        else
        {
            Debug.LogError($"[CopilotLeaderboard] Score sync failed: {response.error}");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotLeaderboard] Score sync error: {ex.Message}");
        return new ScoreSyncResponse { success = false, error = ex.Message };
    }
}
```

### Usage Example

```csharp
public class GameManager : MonoBehaviour
{
    [SerializeField] private CopilotLeaderboardManager leaderboardManager;

    public async void OnGameCompleted(int finalScore)
    {
        var response = await leaderboardManager.SubmitScoreSync(finalScore);
        
        if (response.success)
        {
            Debug.Log($"Score submitted: {response.score}");
            Debug.Log($"Submitted at: {response.submittedAt}");
            ShowScoreSubmittedUI(response.score);
        }
        else
        {
            ShowErrorUI("Failed to submit score");
        }
    }
}
```

---

## Aggregate Scoring

Calculate and submit a user's total "Power Rank" across all games in the ecosystem.

### Method Implementation

```csharp
/// <summary>
/// Submits score with aggregate calculation across all games
/// This creates a "Global Power Rank" for the player
/// </summary>
public async Task<AggregateScoreResponse> SubmitScoreWithAggregate(int score)
{
    try
    {
        var payload = new ScoreSubmission
        {
            gameId = gameId,
            score = score
        };

        var result = await client.RpcAsync(
            session,
            "submit_score_with_aggregate",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<AggregateScoreResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotLeaderboard] Individual score: {response.individualScore}");
            Debug.Log($"[CopilotLeaderboard] Aggregate score: {response.aggregateScore}");
            Debug.Log($"[CopilotLeaderboard] Leaderboards processed: {response.leaderboardsProcessed}");
        }
        else
        {
            Debug.LogError($"[CopilotLeaderboard] Aggregate score failed: {response.error}");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotLeaderboard] Aggregate score error: {ex.Message}");
        return new AggregateScoreResponse { success = false, error = ex.Message };
    }
}
```

### Usage Example

```csharp
public async void OnGameCompleted(int finalScore)
{
    var response = await leaderboardManager.SubmitScoreWithAggregate(finalScore);
    
    if (response.success)
    {
        Debug.Log($"Your score in this game: {response.individualScore}");
        Debug.Log($"Your total power rank: {response.aggregateScore}");
        
        ShowPowerRankUI(response.individualScore, response.aggregateScore);
    }
}
```

---

## Friend Leaderboards

### Create Friend Leaderboards

First, create parallel friend leaderboards (typically done once by admin):

```csharp
/// <summary>
/// Creates friend leaderboards for all games (admin function)
/// This should be called once during game setup or by an admin
/// </summary>
public async Task<string> CreateFriendLeaderboards()
{
    try
    {
        var result = await client.RpcAsync(
            session,
            "create_all_leaderboards_with_friends",
            "{}"
        );

        Debug.Log($"[CopilotLeaderboard] Friend leaderboards created: {result.Payload}");
        return result.Payload;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotLeaderboard] Create friend leaderboards error: {ex.Message}");
        return null;
    }
}
```

### Submit Score to Friend Leaderboards

```csharp
/// <summary>
/// Submits score to both regular and friend-specific leaderboards
/// </summary>
public async Task<string> SubmitScoreWithFriendsSync(int score)
{
    try
    {
        var payload = new ScoreSubmission
        {
            gameId = gameId,
            score = score
        };

        var result = await client.RpcAsync(
            session,
            "submit_score_with_friends_sync",
            JsonUtility.ToJson(payload)
        );

        Debug.Log($"[CopilotLeaderboard] Score synced to friend leaderboards");
        return result.Payload;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotLeaderboard] Friend score sync error: {ex.Message}");
        return null;
    }
}
```

### Get Friend Leaderboard

```csharp
/// <summary>
/// Gets leaderboard rankings filtered to user's friends only
/// </summary>
public async Task<FriendLeaderboardResponse> GetFriendLeaderboard(string leaderboardId, int limit = 100)
{
    try
    {
        var payload = new FriendLeaderboardRequest
        {
            leaderboardId = leaderboardId,
            limit = limit
        };

        var result = await client.RpcAsync(
            session,
            "get_friend_leaderboard",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<FriendLeaderboardResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotLeaderboard] Retrieved {response.records.Length} friend records");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotLeaderboard] Get friend leaderboard error: {ex.Message}");
        return new FriendLeaderboardResponse { success = false, error = ex.Message };
    }
}
```

### Display Friend Leaderboard UI

```csharp
public class FriendLeaderboardUI : MonoBehaviour
{
    [SerializeField] private CopilotLeaderboardManager leaderboardManager;
    [SerializeField] private Transform leaderboardContainer;
    [SerializeField] private GameObject leaderboardEntryPrefab;

    public async void ShowFriendLeaderboard()
    {
        // Clear existing entries
        foreach (Transform child in leaderboardContainer)
        {
            Destroy(child.gameObject);
        }

        // Get friend leaderboard data
        string leaderboardId = $"leaderboard_{leaderboardManager.gameId}";
        var response = await leaderboardManager.GetFriendLeaderboard(leaderboardId, 50);

        if (!response.success)
        {
            Debug.LogError("Failed to load friend leaderboard");
            return;
        }

        // Display each entry
        foreach (var record in response.records)
        {
            var entry = Instantiate(leaderboardEntryPrefab, leaderboardContainer);
            var entryScript = entry.GetComponent<LeaderboardEntry>();
            
            entryScript.SetData(
                rank: (int)record.rank,
                username: record.username,
                score: (int)record.score
            );
        }

        Debug.Log($"Showing {response.records.Length} friends on leaderboard");
    }
}
```

---

## Social Features

### Send Friend Invite

```csharp
/// <summary>
/// Sends a friend invite to another user
/// </summary>
public async Task<FriendInviteResponse> SendFriendInvite(string targetUserId, string message = "Let's be friends!")
{
    try
    {
        var payload = new FriendInviteRequest
        {
            targetUserId = targetUserId,
            message = message
        };

        var result = await client.RpcAsync(
            session,
            "send_friend_invite",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<FriendInviteResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotSocial] Friend invite sent: {response.inviteId}");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotSocial] Send friend invite error: {ex.Message}");
        return new FriendInviteResponse { success = false, error = ex.Message };
    }
}
```

### Accept Friend Invite

```csharp
/// <summary>
/// Accepts a friend invite
/// </summary>
public async Task<AcceptInviteResponse> AcceptFriendInvite(string inviteId)
{
    try
    {
        var payload = new InviteActionRequest
        {
            inviteId = inviteId
        };

        var result = await client.RpcAsync(
            session,
            "accept_friend_invite",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<AcceptInviteResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotSocial] Friend added: {response.friendUsername}");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotSocial] Accept friend invite error: {ex.Message}");
        return new AcceptInviteResponse { success = false, error = ex.Message };
    }
}
```

### Decline Friend Invite

```csharp
/// <summary>
/// Declines a friend invite
/// </summary>
public async Task<FriendInviteResponse> DeclineFriendInvite(string inviteId)
{
    try
    {
        var payload = new InviteActionRequest
        {
            inviteId = inviteId
        };

        var result = await client.RpcAsync(
            session,
            "decline_friend_invite",
            JsonUtility.ToJson(payload)
        );

        var response = JsonUtility.FromJson<FriendInviteResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotSocial] Friend invite declined");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotSocial] Decline friend invite error: {ex.Message}");
        return new FriendInviteResponse { success = false, error = ex.Message };
    }
}
```

### Get Notifications

```csharp
/// <summary>
/// Gets notifications for the current user
/// </summary>
public async Task<NotificationsResponse> GetNotifications(int limit = 100)
{
    try
    {
        var payload = $"{{\"limit\":{limit}}}";

        var result = await client.RpcAsync(
            session,
            "get_notifications",
            payload
        );

        var response = JsonUtility.FromJson<NotificationsResponse>(result.Payload);

        if (response.success)
        {
            Debug.Log($"[CopilotSocial] Retrieved {response.count} notifications");
        }

        return response;
    }
    catch (ApiResponseException ex)
    {
        Debug.LogError($"[CopilotSocial] Get notifications error: {ex.Message}");
        return new NotificationsResponse { success = false, error = ex.Message };
    }
}
```

---

## Complete Example

Here's a complete example showing a game with all copilot features integrated:

```csharp
using Nakama;
using UnityEngine;
using UnityEngine.UI;
using System.Threading.Tasks;
using NakamaIntegration.Copilot;

public class CompleteGameExample : MonoBehaviour
{
    [Header("Nakama Configuration")]
    [SerializeField] private string serverHost = "127.0.0.1";
    [SerializeField] private int serverPort = 7350;
    [SerializeField] private string serverKey = "defaultkey";
    [SerializeField] private string gameId = "YOUR-GAME-ID-HERE";

    [Header("UI References")]
    [SerializeField] private Text scoreText;
    [SerializeField] private Text powerRankText;
    [SerializeField] private Button submitScoreButton;
    [SerializeField] private Button viewFriendsLeaderboardButton;
    [SerializeField] private Button viewNotificationsButton;

    private IClient client;
    private ISession session;
    private CopilotLeaderboardManager leaderboardManager;

    private int currentScore = 0;

    async void Start()
    {
        // Initialize Nakama client
        client = new Client("http", serverHost, serverPort, serverKey);
        
        // Authenticate
        session = await AuthenticateAsync();
        
        if (session != null)
        {
            // Initialize copilot manager
            leaderboardManager = gameObject.AddComponent<CopilotLeaderboardManager>();
            leaderboardManager.Initialize(client, session, gameId);

            // Setup UI
            SetupUI();
        }
    }

    private async Task<ISession> AuthenticateAsync()
    {
        try
        {
            var session = await client.AuthenticateDeviceAsync(
                SystemInfo.deviceUniqueIdentifier,
                null,
                true
            );
            
            Debug.Log($"Authenticated: {session.UserId}");
            return session;
        }
        catch (ApiResponseException ex)
        {
            Debug.LogError($"Authentication failed: {ex.Message}");
            return null;
        }
    }

    private void SetupUI()
    {
        submitScoreButton.onClick.AddListener(OnSubmitScore);
        viewFriendsLeaderboardButton.onClick.AddListener(OnViewFriendsLeaderboard);
        viewNotificationsButton.onClick.AddListener(OnViewNotifications);
    }

    // Called when player completes a level
    public void AddScore(int points)
    {
        currentScore += points;
        scoreText.text = $"Score: {currentScore}";
    }

    // Submit score with aggregate calculation
    private async void OnSubmitScore()
    {
        submitScoreButton.interactable = false;

        var response = await leaderboardManager.SubmitScoreWithAggregate(currentScore);

        if (response.success)
        {
            scoreText.text = $"Game Score: {response.individualScore}";
            powerRankText.text = $"Power Rank: {response.aggregateScore}";
            
            Debug.Log($"Submitted! Power Rank based on {response.leaderboardsProcessed} games");
            
            // Also submit to friend leaderboards
            await leaderboardManager.SubmitScoreWithFriendsSync(currentScore);
        }

        submitScoreButton.interactable = true;
    }

    // View friend leaderboard
    private async void OnViewFriendsLeaderboard()
    {
        string leaderboardId = $"leaderboard_{gameId}";
        var response = await leaderboardManager.GetFriendLeaderboard(leaderboardId, 50);

        if (response.success)
        {
            Debug.Log($"Friend Leaderboard ({response.totalFriends} friends):");
            foreach (var record in response.records)
            {
                Debug.Log($"#{record.rank} - {record.username}: {record.score}");
            }

            // Update UI with friend leaderboard
            DisplayFriendLeaderboard(response.records);
        }
    }

    // View notifications
    private async void OnViewNotifications()
    {
        var response = await leaderboardManager.GetNotifications(20);

        if (response.success)
        {
            Debug.Log($"You have {response.count} notifications");
            foreach (var notification in response.notifications)
            {
                Debug.Log($"[{notification.subject}] {notification.content}");
            }

            // Update UI with notifications
            DisplayNotifications(response.notifications);
        }
    }

    // Send friend invite
    public async void SendFriendInvite(string targetUserId)
    {
        var response = await leaderboardManager.SendFriendInvite(
            targetUserId,
            "Let's compete in this game!"
        );

        if (response.success)
        {
            Debug.Log("Friend invite sent!");
        }
    }

    // Accept friend invite from notification
    public async void AcceptInvite(string inviteId)
    {
        var response = await leaderboardManager.AcceptFriendInvite(inviteId);

        if (response.success)
        {
            Debug.Log($"Now friends with: {response.friendUsername}");
            
            // Refresh notifications
            OnViewNotifications();
        }
    }

    // Helper methods for UI (implement as needed)
    private void DisplayFriendLeaderboard(LeaderboardRecord[] records) { /* ... */ }
    private void DisplayNotifications(NakamaNotification[] notifications) { /* ... */ }
}
```

---

## Best Practices

### 1. Error Handling

Always handle errors gracefully:

```csharp
try
{
    var response = await leaderboardManager.SubmitScoreSync(score);
    if (!response.success)
    {
        ShowErrorMessage(response.error);
    }
}
catch (Exception ex)
{
    ShowErrorMessage("Network error. Please try again.");
    Debug.LogError($"Exception: {ex.Message}");
}
```

### 2. Loading States

Show loading indicators during async operations:

```csharp
public async void OnSubmitScore()
{
    loadingIndicator.SetActive(true);
    submitButton.interactable = false;

    try
    {
        await leaderboardManager.SubmitScoreSync(currentScore);
    }
    finally
    {
        loadingIndicator.SetActive(false);
        submitButton.interactable = true;
    }
}
```

### 3. Caching

Cache leaderboard data to reduce API calls:

```csharp
private FriendLeaderboardResponse cachedFriendLeaderboard;
private float lastFetchTime;
private const float CACHE_DURATION = 60f; // seconds

public async Task<FriendLeaderboardResponse> GetFriendLeaderboardCached()
{
    if (cachedFriendLeaderboard != null && 
        Time.time - lastFetchTime < CACHE_DURATION)
    {
        return cachedFriendLeaderboard;
    }

    cachedFriendLeaderboard = await GetFriendLeaderboard(leaderboardId);
    lastFetchTime = Time.time;
    return cachedFriendLeaderboard;
}
```

### 4. Batch Operations

When appropriate, batch multiple operations:

```csharp
public async Task SubmitScoreAndCheckNotifications(int score)
{
    // Start both operations in parallel
    var scoreTask = leaderboardManager.SubmitScoreWithAggregate(score);
    var notifTask = leaderboardManager.GetNotifications(10);

    // Wait for both to complete
    await Task.WhenAll(scoreTask, notifTask);

    var scoreResponse = scoreTask.Result;
    var notifResponse = notifTask.Result;

    // Process results...
}
```

---

## Testing

### Local Testing Setup

1. Start Nakama server locally:
```bash
docker-compose up
```

2. Create test leaderboards (call once):
```csharp
await leaderboardManager.CreateFriendLeaderboards();
```

3. Test score submission:
```csharp
var response = await leaderboardManager.SubmitScoreSync(1000);
Debug.Assert(response.success, "Score submission failed");
```

### Test Checklist

- [ ] Score synchronization to game leaderboard
- [ ] Score synchronization to global leaderboard
- [ ] Aggregate score calculation
- [ ] Friend leaderboard creation
- [ ] Friend leaderboard score submission
- [ ] Friend leaderboard retrieval
- [ ] Send friend invite
- [ ] Accept friend invite
- [ ] Decline friend invite
- [ ] Get notifications
- [ ] Error handling for all operations

---

## Troubleshooting

### Common Issues

**Issue**: "Authentication required" error
- **Solution**: Ensure session is valid and not expired. Refresh if needed.

**Issue**: Friend leaderboard returns empty
- **Solution**: Ensure you have friends added and they have submitted scores.

**Issue**: Aggregate score is 0
- **Solution**: Submit scores to at least one game leaderboard first.

**Issue**: Notifications not appearing
- **Solution**: Check that notification permissions are enabled and sender is valid.

### Debug Logging

Enable verbose logging:

```csharp
// In CopilotLeaderboardManager
private const bool DEBUG_MODE = true;

private void DebugLog(string message)
{
    if (DEBUG_MODE)
    {
        Debug.Log($"[CopilotDebug] {message}");
    }
}
```

---

## API Reference

### Available RPCs

| RPC Name | Purpose | Authentication Required |
|----------|---------|------------------------|
| `submit_score_sync` | Submit score to game & global leaderboards | Yes |
| `submit_score_with_aggregate` | Submit score with aggregate calculation | Yes |
| `create_all_leaderboards_with_friends` | Create friend leaderboards (admin) | Yes |
| `submit_score_with_friends_sync` | Submit to regular & friend leaderboards | Yes |
| `get_friend_leaderboard` | Get leaderboard filtered by friends | Yes |
| `send_friend_invite` | Send friend invite | Yes |
| `accept_friend_invite` | Accept friend invite | Yes |
| `decline_friend_invite` | Decline friend invite | Yes |
| `get_notifications` | Get user notifications | Yes |

### Leaderboard Naming Conventions

- **Per-game leaderboard**: `leaderboard_{gameId}`
- **Global leaderboard**: `leaderboard_global`
- **Per-game friend leaderboard**: `leaderboard_friends_{gameId}`
- **Global friend leaderboard**: `leaderboard_friends_global`

---

## Additional Resources

- [Nakama Unity SDK Documentation](https://heroiclabs.com/docs/unity-client-guide/)
- [Nakama Leaderboards Guide](https://heroiclabs.com/docs/gameplay-leaderboards/)
- [Nakama Social Features](https://heroiclabs.com/docs/social-friends/)
- [Main Unity Developer Guide](../UNITY_DEVELOPER_COMPLETE_GUIDE.md)

---

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review Nakama server logs for errors
3. Consult the main Unity developer documentation
4. Contact your system administrator

---

**Last Updated**: 2025-11-14
**Version**: 1.0
**Compatible with**: Nakama 3.x, Unity 2020.3+
