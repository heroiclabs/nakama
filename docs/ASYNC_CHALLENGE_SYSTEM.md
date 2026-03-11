# 🎮 Async Challenge System - Complete Documentation

> **Version:** 2.0.0 | **Updated:** 2026-03-11 | **Status:** Production-Ready

---

## 📋 Overview

The Async Challenge System enables asynchronous multiplayer quiz battles between players. Players can create challenges, share codes with friends, and complete quizzes at their own pace. The system supports all quiz modes and includes rewards, statistics tracking, and leaderboards.

---

## 🚀 Features

### Core Features
- **Create Challenges** - Start a quiz challenge with any quiz mode
- **Share Codes** - 6-character codes for easy sharing
- **Join Challenges** - Join via share code or deep link
- **Submit Results** - Server-authoritative result submission
- **Poll Updates** - Real-time status polling

### Advanced Features (v2.0)
- **Statistics Tracking** - Win/loss ratios, streaks, games played
- **Rewards System** - Coins and XP for wins/participation
- **Streak Bonuses** - Extra rewards for consecutive wins
- **Rematch System** - Quick rematch after completion
- **Leaderboards** - Global rankings by wins, win rate, or streaks
- **Opponent Indexing** - Fast lookups for opponent challenges

---

## 📊 RPC Endpoints

### Core RPCs

| RPC Name | Description | Auth Required |
|----------|-------------|---------------|
| `async_challenge_create` | Create new challenge | ✅ |
| `async_challenge_join` | Join via share code | ✅ |
| `async_challenge_get` | Get challenge details | ✅ |
| `async_challenge_submit` | Submit quiz results | ✅ |
| `async_challenge_list` | List user's challenges | ✅ |
| `async_challenge_cancel` | Cancel a challenge | ✅ |

### New v2.0 RPCs

| RPC Name | Description | Auth Required |
|----------|-------------|---------------|
| `async_challenge_stats` | Get player statistics | ✅ |
| `async_challenge_rematch` | Create rematch from completed challenge | ✅ |
| `async_challenge_leaderboard` | Get global leaderboard | ✅ |

---

## 📦 Data Models

### Challenge Status
```javascript
ASYNC_STATUS_WAITING = 0;        // Waiting for opponent
ASYNC_STATUS_OPPONENT_JOINED = 1; // Opponent joined, quiz pending
ASYNC_STATUS_BOTH_COMPLETED = 2;  // Both completed, results ready
ASYNC_STATUS_EXPIRED = 3;         // Challenge expired
ASYNC_STATUS_CANCELLED = 4;       // Challenge cancelled
```

### Session Storage Structure
```javascript
{
    sessionId: "uuid",
    shareCode: "ABC123",
    quizModeType: 0,
    quizModeName: "Quiz",
    quizConfig: {},
    creatorId: "user-uuid",
    creatorName: "Player1",
    opponentId: "user-uuid",
    opponentName: "Player2",
    status: 0,
    createdAt: timestamp,
    expiresAt: timestamp,
    // Creator results
    creatorCompleted: false,
    creatorScore: 0,
    creatorCorrectAnswers: 0,
    creatorTotalQuestions: 0,
    creatorTimeTaken: 0,
    // Opponent results
    opponentCompleted: false,
    opponentScore: 0,
    ...
}
```

### Player Statistics
```javascript
{
    userId: "uuid",
    displayName: "Player",
    totalChallenges: 50,
    totalWins: 30,
    totalLosses: 15,
    totalDraws: 5,
    currentWinStreak: 3,
    bestWinStreak: 10,
    totalCoinsWon: 1500,
    totalXpEarned: 3000,
    winRate: 60,  // percentage
    gamesPlayed: 50
}
```

---

## 💰 Rewards System

### Win Rewards
- **Base Coins:** 50 coins
- **Streak Bonus:** +10 coins per streak level (max 5 levels = +50)
- **XP:** 100 XP

### Participation Rewards
- **Coins:** 10 coins for losing
- **XP:** 25 XP

### Draw Rewards
- **Coins:** 15 coins (1.5x participation)
- **XP:** 25 XP

---

## 🔧 Configuration

### Constants
```javascript
ASYNC_CHALLENGE_EXPIRY_HOURS = 168;     // 7 days
ASYNC_CHALLENGE_MAX_PER_USER = 10;      // Max active challenges
ASYNC_CHALLENGE_WIN_COINS = 50;         // Base win reward
ASYNC_CHALLENGE_PARTICIPATION_COINS = 10; // Participation reward
ASYNC_CHALLENGE_WIN_XP = 100;
ASYNC_CHALLENGE_PARTICIPATION_XP = 25;
```

---

## 📱 Unity Integration

### Using AsyncChallengeManager

```csharp
// Create a challenge
var session = await AsyncChallengeManager.Instance.CreateChallengeAsync(
    QuizModeType.Classic,
    "Classic Quiz",
    new Dictionary<string, object> { ["difficulty"] = "medium" }
);

// Join a challenge
var session = await AsyncChallengeManager.Instance.JoinChallengeAsync("ABC123");

// Submit results
await AsyncChallengeManager.Instance.SubmitResultsAsync(
    score: 850,
    correctAnswers: 8,
    totalQuestions: 10,
    timeTaken: 45.5f
);

// Get stats
var stats = await AsyncChallengeManager.Instance.GetMyStatsAsync();

// Create rematch
var newSession = await AsyncChallengeManager.Instance.CreateRematchFromCurrentAsync();

// Get leaderboard
var leaderboard = await AsyncChallengeManager.Instance.GetLeaderboardAsync(
    limit: 20,
    sortBy: "wins"
);
```

### Events
```csharp
AsyncChallengeManager.Instance.OnChallengeCreated += OnChallengeCreated;
AsyncChallengeManager.Instance.OnChallengeJoined += OnChallengeJoined;
AsyncChallengeManager.Instance.OnResultsSubmitted += OnResultsSubmitted;
AsyncChallengeManager.Instance.OnChallengeCompleted += OnChallengeCompleted;
AsyncChallengeManager.Instance.OnOpponentJoined += OnOpponentJoined;
AsyncChallengeManager.Instance.OnOpponentCompleted += OnOpponentCompleted;
AsyncChallengeManager.Instance.OnChallengeCancelled += OnChallengeCancelled;
AsyncChallengeManager.Instance.OnStatsRetrieved += OnStatsRetrieved;
AsyncChallengeManager.Instance.OnRematchCreated += OnRematchCreated;
AsyncChallengeManager.Instance.OnLeaderboardRetrieved += OnLeaderboardRetrieved;
```

---

## 🔗 Deep Link Support

### URL Formats
```
# Custom Scheme
quizverse://challenge/join/ABC123

# Universal Link (iOS)
https://quizverse.app/challenge/join/ABC123

# Android App Link
https://play.quizverse.app/challenge/join/ABC123
```

### Handling Deep Links
```csharp
var session = await AsyncChallengeManager.Instance.HandleDeepLinkAsync(url);
```

---

## 🔔 Notifications

The system automatically sends push notifications for:
- Challenge received (when targeted)
- Opponent joined
- Opponent completed quiz
- Challenge cancelled
- Rematch requested

Notification code: `101`

---

## 📈 Leaderboard Sorting

| Sort By | Description |
|---------|-------------|
| `wins` | Total wins (default) |
| `winRate` | Win percentage |
| `streak` | Best win streak |

Players need minimum 3 completed games to appear on leaderboard.

---

## 🛡️ Error Codes

| Code | Description |
|------|-------------|
| `AUTH_REQUIRED` | User not authenticated |
| `MAX_CHALLENGES` | Maximum active challenges reached |
| `ALREADY_SUBMITTED` | Results already submitted |

---

## 📝 API Examples

### Create Challenge
```json
// Request
{
    "quizModeType": 0,
    "quizModeName": "Classic Quiz",
    "quizConfig": {
        "difficulty": "medium",
        "category": "science"
    },
    "playerDisplayName": "John"
}

// Response
{
    "success": true,
    "message": "Challenge created successfully",
    "data": {
        "sessionId": "uuid",
        "shareCode": "ABC123",
        ...
    }
}
```

### Get Statistics
```json
// Request
{
    "targetUserId": "optional-user-id"
}

// Response
{
    "success": true,
    "data": {
        "totalWins": 30,
        "totalLosses": 15,
        "currentWinStreak": 3,
        "winRate": 60
    }
}
```

### Create Rematch
```json
// Request
{
    "sessionId": "completed-session-uuid"
}

// Response
{
    "success": true,
    "message": "Rematch challenge created",
    "data": {
        "sessionId": "new-uuid",
        "shareCode": "XYZ789",
        "isRematch": true,
        "originalSessionId": "completed-session-uuid"
    }
}
```

---

## 🚀 Production Checklist

- [x] All 9 RPCs registered and tested
- [x] Statistics tracking implemented
- [x] Rewards system (coins + XP)
- [x] Streak bonuses
- [x] Leaderboard system
- [x] Rematch functionality
- [x] Opponent indexing for fast lookups
- [x] Push notifications
- [x] Error handling with codes
- [x] Unity client integration
- [x] Deep link support

---

*Documentation updated: 2026-03-11*

