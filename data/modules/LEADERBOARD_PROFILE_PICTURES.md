# Leaderboard Profile Pictures System

**Version:** 1.0.0  
**Date:** 2026-01-10  
**Author:** IntelliVerse-X

---

## 📋 Overview

This system automatically adds profile pictures (`profilePicture`) to ALL leaderboard responses in Nakama. Game clients (Quiz-Verse, Cricket VR Mob, etc.) receive profile pictures without any code changes.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PROFILE PICTURE FLOW                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐        ┌────────────────────┐                         │
│  │ UserManagement   │        │      Nakama        │                         │
│  │    Service       │        │      Server        │                         │
│  │                  │        │                    │                         │
│  │ GET /api/user/   │◄───────│ sync_profile_from_ │                         │
│  │     auth/me      │  HTTP  │ user_management    │                         │
│  │                  │        │                    │                         │
│  │ profilePicture ──┼───────►│ user.avatarUrl     │                         │
│  └──────────────────┘        │ user.metadata      │                         │
│                              │                    │                         │
│                              ├────────────────────┤                         │
│                              │                    │                         │
│  ┌──────────────────┐        │  Leaderboard RPC   │                         │
│  │   Game Client    │◄───────│                    │                         │
│  │   (Any Game)     │        │ {                  │                         │
│  │                  │        │   rank: 1,         │                         │
│  │  Display:        │        │   userId: "xxx",   │                         │
│  │  - Username      │        │   displayName: "", │                         │
│  │  - Score         │        │   profilePicture:  │ ◄── NEW FIELD           │
│  │  - Profile Pic ◄─┼────────│     "https://..."  │                         │
│  └──────────────────┘        │   score: 1000      │                         │
│                              │ }                  │                         │
│                              └────────────────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 Module Files

| Module | Purpose |
|--------|---------|
| `profile_sync.js` | Sync profiles from UserManagement API to Nakama |
| `leaderboard_utils.js` | Shared utilities for profile enrichment |
| `platform_leaderboard.js` | **Generic leaderboard for ALL games** |
| `cricket/cricket_predictions.js` | Cricket predictions leaderboard |
| `cricket/cricket_trivia.js` | Cricket trivia leaderboard |
| `cricket_worldcup/index.js` | World Cup leaderboard |
| `cricket_worldcup/predictions.js` | World Cup predictions leaderboard |
| `cricket_worldcup/engagement.js` | World Cup engagement leaderboards |

---

## 🎮 Supported Leaderboards

### Generic Platform Leaderboard (ANY Game)

Use these RPCs for **any game** with automatic profile picture enrichment:

| RPC | Description |
|-----|-------------|
| `get_platform_leaderboard` | Get leaderboard with profile pictures |
| `get_platform_leaderboard_multi` | Get multiple timeframes at once |
| `submit_platform_score` | Submit score to all timeframes |
| `get_user_leaderboard_stats` | Get user's stats across timeframes |
| `get_leaderboard_around_user` | Get records around user |

### Timeframes Supported

| Timeframe | Reset Schedule | Use Case |
|-----------|---------------|----------|
| `daily` | Every day at midnight UTC | Daily competitions |
| `weekly` | Every Monday at midnight UTC | Weekly challenges |
| `monthly` | First of month at midnight UTC | Monthly rankings |
| `alltime` | Never resets | Overall rankings |

---

## 🔧 RPC Reference

### 1. Get Platform Leaderboard

```json
// Request
{
    "gameId": "quiz",           // Required: Your game ID
    "timeframe": "daily",       // Required: daily | weekly | monthly | alltime
    "type": "score",            // Optional: leaderboard type
    "limit": 100,               // Optional: max records
    "cursor": null              // Optional: pagination
}

// Response
{
    "success": true,
    "leaderboardId": "quiz_daily_score",
    "gameId": "quiz",
    "timeframe": "daily",
    "records": [
        {
            "rank": 1,
            "userId": "abc-123",
            "username": "player1",
            "displayName": "John Doe",
            "score": 1500,
            "profilePicture": "https://s3.amazonaws.com/..."  // ← THE KEY FIELD
        }
    ],
    "userRecord": {...},
    "nextCursor": "...",
    "prevCursor": null
}
```

### 2. Get Multiple Timeframes

```json
// Request
{
    "gameId": "quiz",
    "timeframes": ["daily", "weekly", "alltime"],
    "limit": 10
}

// Response
{
    "success": true,
    "gameId": "quiz",
    "leaderboards": {
        "daily": {
            "records": [...],    // All have profilePicture
            "userRecord": {...}
        },
        "weekly": {...},
        "alltime": {...}
    }
}
```

### 3. Submit Score

```json
// Request
{
    "gameId": "quiz",
    "score": 1500,
    "timeframes": ["daily", "weekly", "monthly", "alltime"]
}

// Response
{
    "success": true,
    "results": {
        "daily": { "rank": 5, "score": 1500 },
        "weekly": { "rank": 12, "score": 1500 },
        ...
    }
}
```

---

## 👤 Profile Sync RPCs

### Sync Profile from UserManagement

```json
// Request - Call after login
{
    "authToken": "<cognito_jwt_token>"
}

// Response
{
    "success": true,
    "profilePicture": "https://...",
    "displayName": "John Doe",
    "syncedAt": 1704844800000
}
```

### Direct Profile Picture Update

```json
// Request - Call after profile pic upload
{
    "profilePictureUrl": "https://s3.amazonaws.com/profile/user123.jpg"
}

// Response
{
    "success": true,
    "profilePicture": "https://...",
    "updatedAt": 1704844800000
}
```

---

## 📱 Game Client Integration

### Unity C# Example

```csharp
// After login, sync profile to Nakama
public async void SyncProfileToNakama(string cognitoToken)
{
    var payload = new Dictionary<string, string>
    {
        { "authToken", cognitoToken }
    };
    
    var response = await nakamaClient.RpcAsync(
        session,
        "sync_profile_from_user_management",
        JsonConvert.SerializeObject(payload)
    );
    
    Debug.Log($"Profile synced: {response.Payload}");
}

// Get leaderboard with profile pictures
public async void GetLeaderboard(string gameId, string timeframe)
{
    var payload = new Dictionary<string, object>
    {
        { "gameId", gameId },
        { "timeframe", timeframe },
        { "limit", 50 }
    };
    
    var response = await nakamaClient.RpcAsync(
        session,
        "get_platform_leaderboard",
        JsonConvert.SerializeObject(payload)
    );
    
    var result = JsonConvert.DeserializeObject<LeaderboardResponse>(response.Payload);
    
    foreach (var record in result.records)
    {
        // record.profilePicture contains the URL
        Debug.Log($"{record.rank}. {record.displayName} - {record.score}");
        Debug.Log($"   Profile: {record.profilePicture}");
        
        // Load image with your preferred method
        if (!string.IsNullOrEmpty(record.profilePicture))
        {
            LoadProfilePicture(record.userId, record.profilePicture);
        }
    }
}
```

---

## 🎮 Game ID Examples

| Game | gameId | Example Leaderboard IDs |
|------|--------|------------------------|
| Quiz-Verse | `quiz` | `quiz_daily_score`, `quiz_weekly_score` |
| Cricket VR Mob | `cricket` | `cricket_daily_score`, `cricket_alltime_score` |
| Trivia | `trivia` | `trivia_daily_score`, `trivia_weekly_score` |
| Custom Game | `{your_id}` | `{your_id}_daily_score` |

---

## ✅ Checklist

### Server Setup
- [x] `profile_sync.js` module deployed
- [x] `leaderboard_utils.js` module deployed  
- [x] `platform_leaderboard.js` module deployed
- [x] Cricket modules updated with profile pictures

### Client Integration
- [ ] Call `sync_profile_from_user_management` after login
- [ ] Call `update_profile_picture` after profile pic upload
- [ ] Use `get_platform_leaderboard` or game-specific RPCs
- [ ] Parse `profilePicture` field from response
- [ ] Display profile pictures in leaderboard UI

---

## 🐛 Troubleshooting

### Profile Picture is null

1. **User never synced profile**: Call `sync_profile_from_user_management`
2. **No profile picture in UserManagement**: User needs to upload one
3. **Token expired**: Refresh Cognito token and try again

### Leaderboard Empty

1. **Leaderboard doesn't exist**: Submit a score first
2. **Wrong gameId/timeframe**: Verify parameters

### Slow Response

1. **Too many records**: Use pagination with `limit` and `cursor`
2. **Consider caching**: Profile data is fetched on each request

---

## 📊 Module Coverage Summary

| Module | Profile Pictures | Status |
|--------|-----------------|--------|
| `platform_leaderboard.js` | ✅ All timeframes | Ready |
| `cricket/cricket_predictions.js` | ✅ Tournament & Match | Ready |
| `cricket/cricket_trivia.js` | ✅ Trivia leaderboard | Ready |
| `cricket_worldcup/index.js` | ✅ World Cup leaderboard | Ready |
| `cricket_worldcup/predictions.js` | ✅ Predictions | Ready |
| `cricket_worldcup/engagement.js` | ✅ Daily/Weekly/AllTime | Ready |

---

## 🔄 Data Flow Summary

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│   User Login   │ ──► │  Cognito Auth  │ ──► │ Get JWT Token  │
└────────────────┘     └────────────────┘     └───────┬────────┘
                                                      │
                                                      ▼
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│   Nakama RPC   │ ◄── │  sync_profile  │ ◄── │ Game Client    │
│  Stores in:    │     │  _from_user_   │     │ Calls RPC      │
│  - avatarUrl   │     │  management    │     │                │
│  - metadata    │     └────────────────┘     └────────────────┘
└───────┬────────┘
        │
        ▼
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│  Leaderboard   │ ──► │  Enriches      │ ──► │   Response     │
│     RPC        │     │  Records with  │     │ { records: [   │
│                │     │  profilePicture│     │   {...,        │
│                │     │                │     │   profilePicture}
└────────────────┘     └────────────────┘     │ ]}             │
                                              └────────────────┘
```

---

**All leaderboards now include `profilePicture` for every entry!** 🎉
