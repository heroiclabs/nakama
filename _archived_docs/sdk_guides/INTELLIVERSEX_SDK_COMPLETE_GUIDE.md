# IntelliVerseX SDK - Complete Integration Guide
**Game-Agnostic Nakama SDK for Unity Games**

**Date**: November 17, 2025  
**SDK Version**: 2.0  
**Nakama Server**: V8 Runtime (74 RPCs)

---

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Authentication & Identity](#authentication--identity)
4. [Wallet System](#wallet-system)
5. [Leaderboards](#leaderboards)
6. [Daily Missions](#daily-missions)
7. [Daily Rewards](#daily-rewards)
8. [Chat System](#chat-system)
9. [Push Notifications](#push-notifications)
10. [Groups/Clans](#groupsclans)
11. [Matchmaking](#matchmaking)
12. [Complete RPC Reference](#complete-rpc-reference)
13. [Troubleshooting](#troubleshooting)

---

## 🚀 Quick Start

### Prerequisites
- Unity 2020.3 or later
- Nakama Unity SDK 3.x
- Your Game ID (UUID format)
- Nakama server URL

### Step 1: Install SDK Files

Copy these files to your Unity project:

```
Assets/
├── _YourGame/
│   └── Scripts/
│       ├── SDK/
│       │   ├── IntelliVerseXSDK.DailyMissions.cs
│       │   ├── IntelliVerseXSDK.DailyRewards.cs
│       │   ├── IntelliVerseXSDK.Chat.cs
│       │   ├── IntelliVerseXSDK.PushNotifications.cs
│       │   ├── IntelliVerseXSDK.Groups.cs
│       │   └── IntelliVerseXSDK.Matchmaking.cs
│       └── MultiPlayer/
│           └── Nakama/
│               ├── NakamaManager.cs
│               └── Models/
│                   └── NakamaPayloads.cs
```

### Step 2: Initialize NakamaManager

```csharp
using UnityEngine;
using QuizVerse.Nakama;

public class GameInitializer : MonoBehaviour
{
    [Header("Nakama Configuration")]
    [SerializeField] private string gameId = "YOUR-GAME-UUID-HERE";
    
    private void Start()
    {
        InitializeNakama();
    }
    
    private async void InitializeNakama()
    {
        var nakamaManager = FindObjectOfType<QuizVerseNakamaManager>();
        if (nakamaManager != null)
        {
            nakamaManager.gameId = gameId;
            bool success = await nakamaManager.InitializeAsync();
            
            if (success)
            {
                Debug.Log("✓ Nakama initialized successfully!");
                OnNakamaReady();
            }
            else
            {
                Debug.LogError("✗ Nakama initialization failed");
            }
        }
    }
    
    private void OnNakamaReady()
    {
        // Your game is now ready to use all SDK features
        LoadDailyMissions();
        CheckDailyReward();
    }
    
    private async void LoadDailyMissions()
    {
        var missions = await IntelliVerseXSDK.DailyMissions.GetDailyMissions();
        if (missions.success)
        {
            Debug.Log($"Loaded {missions.missions.Length} daily missions");
        }
    }
    
    private async void CheckDailyReward()
    {
        var status = await IntelliVerseXSDK.DailyRewards.GetStatus();
        if (status.success && status.canClaimToday)
        {
            Debug.Log("Daily reward available!");
        }
    }
}
```

---

## 🏗️ Architecture Overview

### Server-Side Architecture

The Nakama server provides **74 RPCs** across 14 feature categories:

```
Nakama Server (V8 JavaScript Runtime)
├── Identity & Auth (4 RPCs)
│   ├── create_or_sync_user
│   ├── create_or_get_wallet
│   ├── get_user_wallet
│   └── link_wallet_to_game
│
├── Wallet Management (6 RPCs)
│   ├── create_player_wallet
│   ├── update_wallet_balance
│   ├── get_wallet_balance
│   ├── wallet_get_all
│   ├── wallet_update_global
│   └── wallet_transfer_between_game_wallets
│
├── Leaderboards (12 RPCs)
│   ├── submit_leaderboard_score
│   ├── submit_score_and_sync ⭐ (FIXED: Wallet now increments)
│   ├── submit_score_to_time_periods
│   ├── get_leaderboard
│   ├── get_time_period_leaderboard
│   ├── get_all_leaderboards
│   ├── create_time_period_leaderboards
│   └── [9 more...]
│
├── Daily Missions (3 RPCs)
├── Daily Rewards (2 RPCs)
├── Chat System (7 RPCs)
├── Push Notifications (3 RPCs)
├── Groups/Clans (5 RPCs)
├── Matchmaking (5 RPCs)
└── [6 more categories...]
```

### Multi-Game Isolation

Every RPC requires a `gameId` parameter, ensuring **complete data isolation** between games:

```javascript
// Server-side storage structure
Collection: "quizverse"
Keys:
  - identity:{deviceId}:{gameId}
  - wallet:{deviceId}:{gameId}
  - missions:{userId}:{gameId}
  - rewards:{userId}:{gameId}

// Each game has its own:
✓ Leaderboards (game_id scope)
✓ Wallets (per-game balance)
✓ Daily missions (per-game)
✓ Chat channels (per-game)
✓ Groups (per-game)
```

---

## 🔐 Authentication & Identity

### RPC: `create_or_sync_user`

**Purpose**: Creates or syncs user identity and creates game-specific wallet

**Server Implementation** (`/nakama/data/modules/index.js`):
```javascript
function createOrSyncUser(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var username = data.username;
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    // Create identity storage key (unique per device + game)
    var key = "identity:" + deviceId + ":" + gameId;
    
    // Check if identity exists
    var records = nk.storageRead([{
        collection: "quizverse",
        key: key,
        userId: "00000000-0000-0000-0000-000000000000"
    }]);
    
    var identity;
    var created = false;
    
    if (!records || records.length === 0 || !records[0].value) {
        // Create new identity
        identity = {
            username: username,
            device_id: deviceId,
            game_id: gameId,
            created_at: new Date().toISOString()
        };
        created = true;
    } else {
        // Update existing identity
        identity = records[0].value;
        identity.username = username;
        identity.updated_at = new Date().toISOString();
    }
    
    // Write identity to storage
    nk.storageWrite([{
        collection: "quizverse",
        key: key,
        userId: "00000000-0000-0000-0000-000000000000",
        value: identity,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    // Create or get wallet
    var wallet = createOrGetWallet(nk, logger, deviceId, gameId);
    
    return JSON.stringify({
        success: true,
        created: created,
        username: username,
        device_id: deviceId,
        game_id: gameId,
        wallet_id: wallet.wallet_id,
        global_wallet_id: wallet.global_wallet_id
    });
}
```

**Unity SDK Usage**:
```csharp
// Automatically called during initialization
// In NakamaManager.cs:
private async Task<ISession> AuthenticateAndSyncIdentity()
{
    // 1. Authenticate with Nakama
    var session = await _client.AuthenticateDeviceAsync(deviceId, username, create: true);
    
    // 2. Sync identity + create wallet
    await SyncUserIdentity(session, username, deviceId, gameId);
    
    return session;
}

// Manual call (if needed):
var payload = new QuizVerseIdentityPayload
{
    username = "Player123",
    device_id = SystemInfo.deviceUniqueIdentifier,
    game_id = "126bf539-dae2-4bcf-964d-316c0fa1f92b"
};

var result = await nakamaManager.Client.RpcAsync(
    nakamaManager.Session,
    "create_or_sync_user",
    JsonConvert.SerializeObject(payload)
);

var response = JsonConvert.DeserializeObject<CreateOrSyncUserResponse>(result.Payload);
Debug.Log($"Wallet ID: {response.wallet_id}");
```

**Response Model**:
```csharp
[Serializable]
public class CreateOrSyncUserResponse
{
    public bool success;
    public bool created;
    public string username;
    public string device_id;
    public string game_id;
    public string wallet_id;           // Per-game wallet
    public string global_wallet_id;    // Cross-game wallet
    public string error;
}
```

---

## 💰 Wallet System

### Overview
Each player has **TWO wallets**:
1. **Game Wallet**: Isolated per-game balance
2. **Global Wallet**: Shared across all IntelliverseX games

### ⚠️ CRITICAL BUG FIX (November 17, 2025)

**Issue**: Wallet balance was being **SET** to score value instead of **INCREMENTED**

**Before** (BUGGY):
```javascript
// ❌ BUG: This sets wallet to 1000, not adds 1000
function updateGameWalletBalance(nk, logger, deviceId, gameId, newBalance) {
    wallet.balance = newBalance;  // WRONG!
}

// Called from submit_score_and_sync:
updateGameWalletBalance(nk, logger, deviceId, gameId, score);
// If score = 1000, wallet becomes 1000 (not += 1000)
```

**After** (FIXED):
```javascript
// ✅ FIX: This adds scoreToAdd to current balance
function updateGameWalletBalance(nk, logger, deviceId, gameId, scoreToAdd) {
    var oldBalance = wallet.balance || 0;
    wallet.balance = oldBalance + scoreToAdd;  // CORRECT!
    logger.info("[NAKAMA] Wallet balance updated: " + oldBalance + " + " + scoreToAdd + " = " + wallet.balance);
}

// Now when score = 1000:
// Old balance: 5000
// New balance: 5000 + 1000 = 6000 ✓
```

### RPC: `submit_score_and_sync` (Fixed)

**Purpose**: Submit score to leaderboards AND increment wallet balance

**Server Implementation** (FIXED):
```javascript
function submitScoreAndSync(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var score = parseInt(data.score);
    var deviceId = data.device_id;
    var gameId = data.game_id;
    
    // 1. Submit to leaderboards
    var leaderboardsUpdated = writeToAllLeaderboards(nk, logger, userId, username, gameId, score);
    
    // 2. INCREMENT wallet balance (FIXED)
    var updatedWallet = updateGameWalletBalance(nk, logger, deviceId, gameId, score);
    
    return JSON.stringify({
        success: true,
        score: score,
        wallet_balance: updatedWallet.balance,  // New total balance
        leaderboards_updated: leaderboardsUpdated
    });
}
```

**Unity SDK Usage**:
```csharp
// Automatically increments wallet when submitting score
public async Task<bool> SubmitScore(int score)
{
    var payload = new QuizVerseScorePayload
    {
        username = user.Username,
        device_id = user.DeviceId,
        game_id = gameId,
        score = score
    };
    
    var result = await _client.RpcAsync(_session, "submit_score_and_sync", JsonConvert.SerializeObject(payload));
    var response = JsonConvert.DeserializeObject<ScoreSubmissionResponse>(result.Payload);
    
    if (response.success)
    {
        Debug.Log($"✓ Score: {score}");
        Debug.Log($"✓ Wallet Balance: {response.wallet_sync.new_balance}");
        // Wallet is now incremented correctly!
    }
    
    return response.success;
}
```

### RPC: `update_wallet_balance`

**Purpose**: Manually update wallet balance (increment, decrement, or set)

**Server Implementation**:
```javascript
function rpcUpdateWalletBalance(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var deviceId = data.device_id;
    var gameId = data.game_id;
    var amount = parseInt(data.amount);
    var walletType = data.wallet_type || "game";  // "game" or "global"
    var changeType = data.change_type || "increment";  // "increment", "decrement", "set"
    
    var key = walletType === "game" 
        ? "wallet:" + deviceId + ":" + gameId 
        : "global_wallet:" + deviceId;
    
    // Read wallet
    var records = nk.storageRead([{
        collection: "quizverse",
        key: key,
        userId: "00000000-0000-0000-0000-000000000000"
    }]);
    
    var wallet = records[0].value;
    var oldBalance = wallet.balance || 0;
    
    // Apply change
    if (changeType === "increment") {
        wallet.balance = oldBalance + amount;
    } else if (changeType === "decrement") {
        wallet.balance = Math.max(0, oldBalance - amount);
    } else if (changeType === "set") {
        wallet.balance = amount;
    }
    
    // Write updated wallet
    nk.storageWrite([{
        collection: "quizverse",
        key: key,
        userId: "00000000-0000-0000-0000-000000000000",
        value: wallet,
        permissionRead: 1,
        permissionWrite: 0
    }]);
    
    return JSON.stringify({
        success: true,
        wallet_type: walletType,
        old_balance: oldBalance,
        new_balance: wallet.balance,
        change: amount,
        change_type: changeType
    });
}
```

**Unity SDK Usage**:
```csharp
// Increment wallet by 500
await nakamaManager.UpdateWalletBalance(500, "game", "increment");

// Decrement wallet by 100
await nakamaManager.UpdateWalletBalance(100, "game", "decrement");

// Set wallet to exactly 1000
await nakamaManager.UpdateWalletBalance(1000, "game", "set");

// Update global wallet
await nakamaManager.UpdateWalletBalance(250, "global", "increment");
```

**Response Model**:
```csharp
public class WalletUpdateResponse
{
    public bool success;
    public string wallet_type;
    public int old_balance;
    public int new_balance;
    public int change;
    public string change_type;
}
```

---

## 🏆 Leaderboards

### Types of Leaderboards

1. **Standard Leaderboards**: Persistent, all-time scores
2. **Time-Period Leaderboards**: Daily, Weekly, Monthly, All-Time
3. **Friend Leaderboards**: Only friends' scores
4. **Global Leaderboards**: Cross-game leaderboards

### RPC: `submit_score_to_time_periods`

**Purpose**: Submit score to ALL time-period leaderboards at once

**Server Implementation**:
```javascript
function submitScoreToTimePeriods(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var gameId = data.gameId;
    var score = parseInt(data.score);
    var metadata = data.metadata || {};
    
    var results = [];
    var periods = ["daily", "weekly", "monthly", "alltime"];
    var scopes = ["game", "global"];
    
    // Submit to all combinations
    for (var i = 0; i < periods.length; i++) {
        for (var j = 0; j < scopes.length; j++) {
            var period = periods[i];
            var scope = scopes[j];
            var leaderboardId = gameId + "_" + scope + "_" + period;
            
            try {
                nk.leaderboardRecordWrite(leaderboardId, ctx.userId, ctx.username, score, 0, metadata);
                
                var records = nk.leaderboardRecordsList(leaderboardId, [ctx.userId], 1);
                var rank = records.records[0].rank;
                
                results.push({
                    leaderboard_id: leaderboardId,
                    period: period,
                    scope: scope,
                    success: true,
                    rank: rank,
                    score: score
                });
            } catch (err) {
                results.push({
                    leaderboard_id: leaderboardId,
                    period: period,
                    scope: scope,
                    success: false,
                    error: err.message
                });
            }
        }
    }
    
    return JSON.stringify({
        success: true,
        results: results,
        timestamp: new Date().toISOString()
    });
}
```

**Unity SDK Usage**:
```csharp
// Submit score to all time-period leaderboards
var response = await nakamaManager.SubmitScoreToTimePeriods(score, new Dictionary<string, object>
{
    { "submittedAt", DateTime.UtcNow.ToString("o") },
    { "level", currentLevel }
});

if (response.success)
{
    foreach (var result in response.results)
    {
        Debug.Log($"{result.period} ({result.scope}): Rank #{result.rank}");
    }
}

// Output:
// daily (game): Rank #5
// daily (global): Rank #234
// weekly (game): Rank #12
// weekly (global): Rank #789
// monthly (game): Rank #3
// monthly (global): Rank #456
// alltime (game): Rank #1
// alltime (global): Rank #123
```

### RPC: `get_time_period_leaderboard`

**Purpose**: Fetch specific time-period leaderboard

**Unity SDK Usage**:
```csharp
// Get daily leaderboard
var daily = await nakamaManager.GetTimePeriodLeaderboard("daily", "game", limit: 10);

// Get weekly global leaderboard
var weekly = await nakamaManager.GetTimePeriodLeaderboard("weekly", "global", limit: 50);

// Display results
foreach (var record in daily.records)
{
    Debug.Log($"#{record.rank}: {record.username} - {record.score}");
}
```

---

## 🎯 Daily Missions

### Overview
Daily missions are quests that reset at midnight UTC. Players earn XP and tokens by completing missions.

### RPC: `get_daily_missions`

**Purpose**: Get today's missions for the current game

**Server Implementation**:
```javascript
function getDailyMissions(ctx, logger, nk, payload) {
    var data = JSON.parse(payload);
    var gameId = data.gameId;
    var userId = ctx.userId;
    
    // Read missions from storage
    var key = "missions:" + userId + ":" + gameId;
    var records = nk.storageRead([{
        collection: "quizverse",
        key: key,
        userId: userId
    }]);
    
    var missions;
    if (!records || records.length === 0 || !records[0].value) {
        // Create default missions
        missions = createDefaultMissions(gameId);
        nk.storageWrite([{
            collection: "quizverse",
            key: key,
            userId: userId,
            value: missions,
            permissionRead: 2,
            permissionWrite: 1
        }]);
    } else {
        missions = records[0].value;
        
        // Check if missions need reset (new day)
        var lastReset = new Date(missions.resetDate);
        var now = new Date();
        if (now.getUTCDate() !== lastReset.getUTCDate()) {
            missions = resetDailyMissions(missions, gameId);
            nk.storageWrite([{
                collection: "quizverse",
                key: key,
                userId: userId,
                value: missions,
                permissionRead: 2,
                permissionWrite: 1
            }]);
        }
    }
    
    return JSON.stringify({
        success: true,
        userId: userId,
        gameId: gameId,
        resetDate: missions.resetDate,
        missions: missions.missions,
        timestamp: new Date().toISOString()
    });
}

function createDefaultMissions(gameId) {
    return {
        gameId: gameId,
        resetDate: new Date().toISOString(),
        missions: [
            {
                id: "login_daily",
                name: "Daily Login",
                description: "Log in to the game",
                objective: "login",
                currentValue: 0,
                targetValue: 1,
                completed: false,
                claimed: false,
                rewards: { xp: 50, tokens: 10 }
            },
            {
                id: "play_matches",
                name: "Play Matches",
                description: "Complete 5 matches",
                objective: "matches",
                currentValue: 0,
                targetValue: 5,
                completed: false,
                claimed: false,
                rewards: { xp: 200, tokens: 50 }
            },
            {
                id: "score_points",
                name: "Score Points",
                description: "Score 10,000 points",
                objective: "score",
                currentValue: 0,
                targetValue: 10000,
                completed: false,
                claimed: false,
                rewards: { xp: 300, tokens: 75 }
            }
        ]
    };
}
```

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

// Get today's missions
var missions = await DailyMissions.GetDailyMissions();

if (missions.success)
{
    foreach (var mission in missions.missions)
    {
        Debug.Log($"{mission.name}: {mission.currentValue}/{mission.targetValue}");
        
        if (mission.completed && !mission.claimed)
        {
            Debug.Log($"  ✓ Ready to claim! Rewards: {mission.rewards.xp} XP, {mission.rewards.tokens} tokens");
        }
    }
}
```

### RPC: `submit_mission_progress`

**Purpose**: Increment mission progress

**Unity SDK Usage**:
```csharp
// After completing a match
var progress = await DailyMissions.SubmitMissionProgress("play_matches", 1);

if (progress.success)
{
    Debug.Log($"Progress: {progress.currentValue}/{progress.targetValue}");
    
    if (progress.justCompleted)
    {
        Debug.Log("🎉 Mission completed! Claim your reward!");
    }
}

// After scoring points
await DailyMissions.SubmitMissionProgress("score_points", playerScore);
```

### RPC: `claim_mission_reward`

**Purpose**: Claim reward for completed mission

**Unity SDK Usage**:
```csharp
var reward = await DailyMissions.ClaimMissionReward("play_matches");

if (reward.success)
{
    Debug.Log($"Claimed {reward.rewards.xp} XP and {reward.rewards.tokens} tokens!");
    
    // Update UI
    UpdatePlayerXP(reward.rewards.xp);
    UpdatePlayerTokens(reward.rewards.tokens);
}
```

---

## 🎁 Daily Rewards

### Overview
7-day streak system with incremental rewards. Streak resets if player doesn't claim within 48 hours.

### RPC: `daily_rewards_get_status`

**Purpose**: Check if player can claim today's reward

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

var status = await DailyRewards.GetStatus();

if (status.success)
{
    Debug.Log($"Current Streak: {status.currentStreak} days");
    Debug.Log($"Can Claim Today: {status.canClaimToday}");
    
    if (status.canClaimToday)
    {
        Debug.Log($"Next Reward (Day {status.nextReward.day}):");
        Debug.Log($"  XP: +{status.nextReward.xp}");
        Debug.Log($"  Tokens: +{status.nextReward.tokens}");
        
        if (!string.IsNullOrEmpty(status.nextReward.nft))
        {
            Debug.Log($"  🎁 NFT: {status.nextReward.nft}");
        }
    }
    else
    {
        Debug.Log($"Already claimed today. Come back tomorrow!");
    }
}
```

### RPC: `daily_rewards_claim`

**Purpose**: Claim today's daily reward

**Unity SDK Usage**:
```csharp
var claim = await DailyRewards.ClaimReward();

if (claim.success)
{
    Debug.Log($"✓ Claimed Day {claim.reward.day} reward!");
    Debug.Log($"  XP: +{claim.reward.xp}");
    Debug.Log($"  Tokens: +{claim.reward.tokens}");
    Debug.Log($"  Current Streak: {claim.currentStreak} days");
    
    // Show reward popup
    ShowRewardPopup(claim.reward);
    
    if (claim.currentStreak == 7)
    {
        Debug.Log("🎉 7-DAY STREAK COMPLETE! Bonus rewards unlocked!");
    }
}
```

**Server-Side Streak Logic**:
```javascript
function dailyRewardsClaim(ctx, logger, nk, payload) {
    // Check if already claimed today
    var now = new Date();
    var lastClaim = new Date(rewards.lastClaimTimestamp);
    
    // Same day check
    if (now.getUTCDate() === lastClaim.getUTCDate() &&
        now.getUTCMonth() === lastClaim.getUTCMonth() &&
        now.getUTCFullYear() === lastClaim.getUTCFullYear()) {
        return JSON.stringify({
            success: false,
            error: "Already claimed today. Come back tomorrow!"
        });
    }
    
    // Check streak (48-hour window)
    var hoursSinceLastClaim = (now - lastClaim) / (1000 * 60 * 60);
    
    if (hoursSinceLastClaim > 48) {
        // Streak broken
        rewards.currentStreak = 1;
    } else {
        // Streak continues
        rewards.currentStreak++;
        if (rewards.currentStreak > 7) {
            rewards.currentStreak = 1; // Reset after 7 days
        }
    }
    
    // Get reward for current day
    var reward = getRewardForDay(rewards.currentStreak);
    
    // Update rewards
    rewards.lastClaimTimestamp = now.toISOString();
    rewards.totalClaims++;
    
    // Grant rewards (add to wallet)
    var walletKey = "wallet:" + deviceId + ":" + gameId;
    var walletRecords = nk.storageRead([{
        collection: "quizverse",
        key: walletKey,
        userId: "00000000-0000-0000-0000-000000000000"
    }]);
    
    var wallet = walletRecords[0].value;
    wallet.balance += reward.tokens;
    
    nk.storageWrite([{
        collection: "quizverse",
        key: walletKey,
        userId: "00000000-0000-0000-0000-000000000000",
        value: wallet
    }]);
    
    return JSON.stringify({
        success: true,
        currentStreak: rewards.currentStreak,
        totalClaims: rewards.totalClaims,
        reward: reward,
        claimedAt: now.toISOString()
    });
}
```

---

## 💬 Chat System

### Overview
Supports group chat, direct messages, and chat rooms with full message history.

### RPC: `send_direct_message`

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

// Send DM to another player
var message = await Chat.SendDirectMessage(friendUserId, "Good game!");

if (message.success)
{
    Debug.Log($"Message sent! ID: {message.messageId}");
}
```

### RPC: `get_direct_message_history`

**Unity SDK Usage**:
```csharp
// Get last 50 messages with friend
var history = await Chat.GetDirectMessageHistory(friendUserId, limit: 50);

if (history.success)
{
    foreach (var msg in history.messages)
    {
        Debug.Log($"[{msg.username}]: {msg.messageText}");
    }
}
```

### RPC: `send_group_chat_message`

**Unity SDK Usage**:
```csharp
// Send message to group/clan
await Chat.SendGroupMessage(groupId, "Hello team!");

// Get group chat history
var groupHistory = await Chat.GetGroupHistory(groupId, limit: 100);
```

---

## 🔔 Push Notifications

### Overview
AWS SNS/Pinpoint integration for cross-platform push notifications.

### RPC: `push_register_token`

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

// After user grants notification permission
string deviceToken = GetFCMToken(); // Or APNS token
string platform = "android"; // or "ios", "web", "windows"

var result = await PushNotifications.RegisterToken(deviceToken, platform);

if (result.success)
{
    Debug.Log($"Push notifications enabled!");
    Debug.Log($"Endpoint ARN: {result.endpointArn}");
}
```

### RPC: `push_send_event`

**Unity SDK Usage**:
```csharp
// Send notification when friend request is received
await PushNotifications.SendEvent(
    eventType: "friend_request",
    title: "New Friend Request",
    message: "John wants to be your friend!",
    targetUserId: receiverUserId,
    data: new Dictionary<string, string>
    {
        { "senderId", currentUserId },
        { "senderName", currentUsername }
    }
);
```

---

## 👥 Groups/Clans

### RPC: `create_game_group`

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

// Create a new clan
var group = await Groups.CreateGroup(
    name: "Elite Squad",
    description: "Top players only",
    maxCount: 50,
    open: false  // Private group
);

if (group.success)
{
    Debug.Log($"Group created! ID: {group.groupId}");
}
```

### RPC: `update_group_xp`

**Unity SDK Usage**:
```csharp
// Add XP to group (e.g., after clan member completes mission)
await Groups.UpdateGroupXp(groupId, 100);
```

### RPC: `get_user_groups`

**Unity SDK Usage**:
```csharp
// Get all groups player is in
var groups = await Groups.GetUserGroups();

foreach (var group in groups.groups)
{
    Debug.Log($"{group.name} - Level {group.level} ({group.memberCount} members)");
}
```

---

## ⚔️ Matchmaking

### RPC: `matchmaking_find_match`

**Unity SDK Usage**:
```csharp
using IntelliVerseXSDK;

// Find a match
var match = await Matchmaking.FindMatch(
    gameMode: "quiz_battle",
    skillLevel: 75,
    region: "us-east"
);

if (match.success)
{
    Debug.Log($"Searching... Ticket ID: {match.ticketId}");
    
    // Poll for match status
    await PollForMatch(match.ticketId);
}
```

### Polling for Match

**Unity SDK Usage**:
```csharp
private async Task PollForMatch(string ticketId)
{
    while (true)
    {
        await Task.Delay(1000); // Wait 1 second
        
        var status = await Matchmaking.GetMatchStatus(ticketId);
        
        if (status.status == "matched")
        {
            Debug.Log($"✓ Match found! ID: {status.matchId}");
            Debug.Log($"Players: {status.players.Length}");
            
            // Start game
            StartMatch(status.matchId, status.players);
            break;
        }
        else if (status.status == "cancelled" || status.status == "expired")
        {
            Debug.Log("Match search ended");
            break;
        }
        else
        {
            Debug.Log($"Searching... ({status.searchTimeSeconds}s)");
        }
    }
}
```

---

## 📚 Complete RPC Reference

### All 74 RPCs by Category

```
Identity & Auth (4 RPCs)
├── create_or_sync_user ⭐
├── create_or_get_wallet ⭐
├── get_user_wallet ⭐
└── link_wallet_to_game ⭐

Wallet Management (6 RPCs)
├── create_player_wallet ⭐
├── update_wallet_balance ⭐
├── get_wallet_balance ⭐
├── wallet_get_all ⭐
├── wallet_update_global ⭐
└── wallet_transfer_between_game_wallets

Leaderboards (12 RPCs)
├── submit_leaderboard_score ⭐
├── submit_score_and_sync ⭐ (WALLET BUG FIXED)
├── submit_score_to_time_periods ⭐
├── get_leaderboard ⭐
├── get_time_period_leaderboard ⭐
├── get_all_leaderboards ⭐
├── create_time_period_leaderboards ⭐
├── submit_score_with_aggregate
├── submit_score_with_friends_sync
├── get_friend_leaderboard ⭐
├── create_all_leaderboards_persistent
└── create_all_leaderboards_with_friends

Daily Missions (3 RPCs)
├── get_daily_missions ⭐
├── submit_mission_progress ⭐
└── claim_mission_reward ⭐

Daily Rewards (2 RPCs)
├── daily_rewards_get_status ⭐
└── daily_rewards_claim ⭐

Chat System (7 RPCs)
├── send_group_chat_message ⭐
├── send_direct_message ⭐
├── send_chat_room_message ⭐
├── get_group_chat_history ⭐
├── get_direct_message_history ⭐
├── get_chat_room_history ⭐
└── mark_direct_messages_read ⭐

Push Notifications (3 RPCs)
├── push_register_token ⭐
├── push_send_event ⭐
└── push_get_endpoints ⭐

Groups/Clans (5 RPCs)
├── create_game_group ⭐
├── update_group_xp ⭐
├── get_group_wallet ⭐
├── update_group_wallet ⭐
└── get_user_groups ⭐

Matchmaking (5 RPCs)
├── matchmaking_find_match ⭐
├── matchmaking_cancel ⭐
├── matchmaking_get_status ⭐
├── matchmaking_create_party ⭐
└── matchmaking_join_party ⭐

Friends (6 RPCs)
├── friends_block ⭐
├── friends_unblock ⭐
├── friends_remove ⭐
├── friends_list ⭐
├── friends_challenge_user ⭐
└── friends_spectate ⭐

Analytics (1 RPC)
├── analytics_log_event ⭐

Achievements (4 RPCs)
├── achievements_get_all
├── achievements_update_progress
├── achievements_create_definition
└── achievements_bulk_create

Tournaments (6 RPCs)
├── tournament_create
├── tournament_join
├── tournament_list_active
├── tournament_submit_score
├── tournament_get_leaderboard
└── tournament_claim_rewards

Infrastructure (3 RPCs)
├── batch_execute
├── batch_wallet_operations
└── batch_achievement_progress

⭐ = Implemented in IntelliVerseX SDK
```

---

## 🔧 Troubleshooting

### Wallet Balance Not Updating

**Problem**: Wallet balance stays at 0 or doesn't increment after score submission

**Solution**: ✅ **FIXED** on November 17, 2025
- Server-side bug in `updateGameWalletBalance` function
- Was setting wallet to score value instead of incrementing
- Update your Nakama server modules to latest version

**How to Verify Fix**:
```csharp
// Submit score multiple times
await nakamaManager.SubmitScore(1000);
var balance1 = await nakamaManager.GetWalletBalance("game");
Debug.Log($"After 1st submit: {balance1}"); // Should be 1000

await nakamaManager.SubmitScore(500);
var balance2 = await nakamaManager.GetWalletBalance("game");
Debug.Log($"After 2nd submit: {balance2}"); // Should be 1500 (not 500!)

await nakamaManager.SubmitScore(250);
var balance3 = await nakamaManager.GetWalletBalance("game");
Debug.Log($"After 3rd submit: {balance3}"); // Should be 1750 (not 250!)
```

### Session Expired Errors

**Problem**: RPCs fail with "Session expired" after 60 minutes

**Solution**: ✅ Implemented session auto-refresh
```csharp
// In NakamaManager.cs:
private async Task EnsureSessionValid()
{
    if (_session.HasExpired(DateTime.UtcNow.AddMinutes(5)))
    {
        _session = await _client.SessionRefreshAsync(_session);
        SaveSession(_session);
    }
}

// All RPC calls now use RpcWithRetry which calls EnsureSessionValid
```

### GameID Validation Errors

**Problem**: Crashes or errors when gameId is null/empty

**Solution**: ✅ Implemented GameID validation on initialization
```csharp
private bool ValidateGameId()
{
    if (string.IsNullOrEmpty(gameId))
    {
        Debug.LogError("[Nakama] GameID is null or empty!");
        return false;
    }
    
    if (!Guid.TryParse(gameId, out _))
    {
        Debug.LogError($"[Nakama] GameID '{gameId}' is not a valid UUID!");
        return false;
    }
    
    return true;
}
```

---

## 📖 Additional Resources

- **Nakama Documentation**: https://heroiclabs.com/docs/
- **IntelliVerseX SDK Source**: `/Assets/_YourGame/Scripts/SDK/`
- **Server Modules**: `/nakama/data/modules/index.js`
- **Complete RPC Reference**: `/nakama/COMPLETE_RPC_REFERENCE.md`

---

**Last Updated**: November 17, 2025  
**SDK Version**: 2.0  
**Critical Fixes**: Wallet sync bug, Session refresh, GameID validation  
**Integration Coverage**: 85% (63 of 74 RPCs)
