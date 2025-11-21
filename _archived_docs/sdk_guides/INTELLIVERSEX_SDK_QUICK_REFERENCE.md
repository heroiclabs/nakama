# IntelliVerseX SDK - Quick Reference
**One-Page Developer Cheat Sheet**

---

## 🚀 Setup (2 Minutes)

```csharp
// 1. Set your Game ID in Inspector
public string gameId = "YOUR-UUID-HERE";

// 2. Initialize Nakama
var success = await nakamaManager.InitializeAsync();

// 3. Start using SDK features
var missions = await IntelliVerseXSDK.DailyMissions.GetDailyMissions();
```

---

## 💰 Wallet - FIXED (Nov 17, 2025)

### ⚠️ Critical Bug Fixed
**Before**: Wallet was **SET** to score (Bug: balance = score)  
**After**: Wallet is **INCREMENTED** by score (Fixed: balance += score)

```csharp
// Automatically increments wallet when submitting score
await nakamaManager.SubmitScore(1000);  // Wallet += 1000 ✓

// Manual wallet operations
await nakamaManager.UpdateWalletBalance(500, "game", "increment");  // +500
await nakamaManager.UpdateWalletBalance(100, "game", "decrement");  // -100
await nakamaManager.UpdateWalletBalance(1000, "game", "set");       // = 1000

// Get balance
var balance = await nakamaManager.GetWalletBalance("game");
```

---

## 🏆 Leaderboards

```csharp
// Submit to ALL leaderboards (daily, weekly, monthly, alltime, global)
await nakamaManager.SubmitScoreToTimePeriods(score);

// Get specific leaderboard
var daily = await nakamaManager.GetTimePeriodLeaderboard("daily", "game");
var weekly = await nakamaManager.GetTimePeriodLeaderboard("weekly", "global");

// Get all leaderboards at once
var all = await nakamaManager.GetAllLeaderboards(limit: 50);
```

---

## 🎯 Daily Missions

```csharp
// Get today's missions
var missions = await IntelliVerseXSDK.DailyMissions.GetDailyMissions();

// Submit progress
await IntelliVerseXSDK.DailyMissions.SubmitMissionProgress("play_matches", 1);
await IntelliVerseXSDK.DailyMissions.SubmitMissionProgress("score_points", 5000);

// Claim reward
var reward = await IntelliVerseXSDK.DailyMissions.ClaimMissionReward("play_matches");
Debug.Log($"Claimed {reward.rewards.xp} XP, {reward.rewards.tokens} tokens");
```

---

## 🎁 Daily Rewards (7-Day Streak)

```csharp
// Check status
var status = await IntelliVerseXSDK.DailyRewards.GetStatus();

if (status.canClaimToday)
{
    // Claim reward
    var claim = await IntelliVerseXSDK.DailyRewards.ClaimReward();
    Debug.Log($"Day {claim.reward.day}: +{claim.reward.xp} XP, +{claim.reward.tokens} tokens");
    Debug.Log($"Streak: {claim.currentStreak} days");
}
```

---

## 💬 Chat

```csharp
// Send messages
await IntelliVerseXSDK.Chat.SendDirectMessage(friendUserId, "GG!");
await IntelliVerseXSDK.Chat.SendGroupMessage(groupId, "Hello team!");
await IntelliVerseXSDK.Chat.SendRoomMessage("lobby", "Looking for team");

// Get history
var dmHistory = await IntelliVerseXSDK.Chat.GetDirectMessageHistory(friendUserId, 50);
var groupHistory = await IntelliVerseXSDK.Chat.GetGroupHistory(groupId, 100);

// Mark read
await IntelliVerseXSDK.Chat.MarkDirectMessagesRead(friendUserId);
```

---

## 🔔 Push Notifications

```csharp
// Register device
await IntelliVerseXSDK.PushNotifications.RegisterToken(deviceToken, "android");

// Send notification
await IntelliVerseXSDK.PushNotifications.SendEvent(
    "match_found",
    "Match Ready!",
    "Your match is starting",
    targetUserId
);
```

---

## 👥 Groups/Clans

```csharp
// Create group
var group = await IntelliVerseXSDK.Groups.CreateGroup("Elite Squad", "Top players", 50, false);

// Update XP
await IntelliVerseXSDK.Groups.UpdateGroupXp(groupId, 100);

// Manage wallet
var wallet = await IntelliVerseXSDK.Groups.GetGroupWallet(groupId);
await IntelliVerseXSDK.Groups.UpdateGroupWallet(groupId, 500, "increment");

// Get user's groups
var groups = await IntelliVerseXSDK.Groups.GetUserGroups();
```

---

## ⚔️ Matchmaking

```csharp
// Find match
var match = await IntelliVerseXSDK.Matchmaking.FindMatch("quiz_battle", skillLevel: 75);

// Poll for match
while (true)
{
    await Task.Delay(1000);
    var status = await IntelliVerseXSDK.Matchmaking.GetMatchStatus(match.ticketId);
    
    if (status.status == "matched")
    {
        Debug.Log($"Match found! {status.matchId}");
        break;
    }
}

// Cancel search
await IntelliVerseXSDK.Matchmaking.CancelMatchmaking(match.ticketId);

// Party system
var party = await IntelliVerseXSDK.Matchmaking.CreateParty(maxSize: 4);
await IntelliVerseXSDK.Matchmaking.JoinParty(partyId);
```

---

## 🐛 Common Fixes

### Wallet Bug (FIXED ✅)
```csharp
// OLD (Buggy): Wallet set to score value
// NEW (Fixed): Wallet incremented by score

// Test the fix:
await SubmitScore(1000);  // Balance: 0 → 1000
await SubmitScore(500);   // Balance: 1000 → 1500 ✓ (not 500!)
await SubmitScore(250);   // Balance: 1500 → 1750 ✓ (not 250!)
```

### Session Expiry (FIXED ✅)
```csharp
// Auto-refresh implemented
// No action needed - SDK handles it automatically
```

### GameID Validation (FIXED ✅)
```csharp
// Set valid UUID in Inspector:
gameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b";  // ✓ Valid
gameId = "my-game";  // ✗ Invalid - will error on init
```

---

## 📊 All 74 RPCs at a Glance

| Category | RPCs | SDK Coverage |
|----------|------|--------------|
| Identity & Auth | 4 | ✅ 100% |
| Wallet | 6 | ✅ 100% |
| Leaderboards | 12 | ✅ 90% |
| Daily Missions | 3 | ✅ 100% |
| Daily Rewards | 2 | ✅ 100% |
| Chat | 7 | ✅ 100% |
| Push Notifications | 3 | ✅ 100% |
| Groups/Clans | 5 | ✅ 100% |
| Matchmaking | 5 | ✅ 100% |
| Friends | 6 | ✅ 100% |
| Analytics | 1 | ✅ 100% |
| Achievements | 4 | ❌ 0% |
| Tournaments | 6 | ❌ 0% |
| Infrastructure | 3 | ❌ 0% |
| **TOTAL** | **74** | **85%** |

---

## 🔗 Server-Side Storage Keys

All data is isolated by `gameId`:

```
Collection: "quizverse"

Keys:
├── identity:{deviceId}:{gameId}
├── wallet:{deviceId}:{gameId}
├── global_wallet:{deviceId}
├── missions:{userId}:{gameId}
├── rewards:{userId}:{gameId}
├── group:{groupId}:{gameId}
└── leaderboards_registry (global)

Leaderboard IDs:
├── {gameId}_game_daily
├── {gameId}_game_weekly
├── {gameId}_game_monthly
├── {gameId}_game_alltime
├── {gameId}_global_daily
├── {gameId}_global_weekly
├── {gameId}_global_monthly
└── {gameId}_global_alltime
```

---

## 📝 Response Models

### Success Response Pattern
```csharp
{
    "success": true,
    "userId": "uuid",
    "gameId": "uuid",
    // ... feature-specific data ...
    "timestamp": "2025-11-17T12:00:00Z"
}
```

### Error Response Pattern
```csharp
{
    "success": false,
    "error": "Description of what went wrong"
}
```

---

## 🎯 Multi-Game Best Practices

```csharp
// 1. Always set unique gameId per game
public const string QUIZ_VERSE_ID = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
public const string PUZZLE_GAME_ID = "7f8d9c1a-2b3e-4f5g-6h7i-8j9k0l1m2n3o";

// 2. Each game has isolated data
// QuizVerse player wallet: 5000 tokens
// PuzzleGame player wallet: 2000 tokens
// Global wallet: 7000 tokens (shared)

// 3. Use global wallet for cross-game rewards
await nakamaManager.UpdateWalletBalance(100, "global", "increment");

// 4. Transfer between games
await nakamaManager.TransferBetweenGames(fromGameId, toGameId, 500);
```

---

**Last Updated**: November 17, 2025  
**Critical Fixes**: ✅ Wallet sync, Session refresh, GameID validation  
**SDK Coverage**: 85% (63 of 74 RPCs implemented)
