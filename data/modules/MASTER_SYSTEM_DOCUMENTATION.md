# Nakama Multi-Game Backend System - Complete Documentation

## Overview

This comprehensive JavaScript backend system for Nakama 3.x provides a complete multi-game platform with support for:

- **Daily Rewards & Streaks** - Per-game daily login rewards with streak tracking
- **Daily Missions** - Configurable daily objectives with progress tracking
- **Enhanced Wallet System** - Global + per-game wallets with multi-currency support
- **Analytics** - Event tracking, DAU, session analytics
- **Enhanced Friends** - Block, challenge, spectate, and friend management
- **UUID-based Multi-Game Support** - All systems support multiple games via UUID gameId

## Architecture

### Multi-Game Support (gameId = UUID)

All systems accept gameId as a UUID string parameter:

```json
{ "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4" }
```

Storage keys incorporate UUID gameId to isolate data per game:

```
user_daily_streak_${userId}_${gameIdUUID}
wallet_${userId}_${gameIdUUID}
mission_progress_${userId}_${gameIdUUID}
analytics_session_${userId}_${gameIdUUID}
```

### Module Structure

```
data/modules/
├── copilot/
│   ├── utils.js                    # Shared utilities (EXTENDED)
│   ├── wallet_utils.js             # JWT utilities
│   ├── wallet_registry.js          # Wallet registry
│   ├── cognito_wallet_mapper.js    # Cognito integration
│   ├── leaderboard_*.js            # Leaderboard modules
│   └── social_features.js          # Social features
├── daily_rewards/
│   └── daily_rewards.js            # Daily rewards system (NEW)
├── daily_missions/
│   └── daily_missions.js           # Daily missions system (NEW)
├── wallet/
│   └── wallet.js                   # Enhanced wallet system (NEW)
├── analytics/
│   └── analytics.js                # Analytics system (NEW)
├── friends/
│   └── friends.js                  # Enhanced friends system (NEW)
└── index.js                        # Main entry point (UPDATED)
```

## RPC Endpoints

### Daily Rewards System

#### 1. `daily_rewards_get_status`

Get current daily reward status for a user in a specific game.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "currentStreak": 3,
  "totalClaims": 15,
  "lastClaimTimestamp": 1699776000,
  "canClaimToday": true,
  "claimReason": "eligible",
  "nextReward": {
    "day": 4,
    "xp": 250,
    "tokens": 25,
    "description": "Day 4 Reward"
  },
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
using Nakama;
using System.Threading.Tasks;

public async Task<DailyRewardStatus> GetDailyRewardStatus(IClient client, ISession session, string gameId)
{
    var payload = new Dictionary<string, string>
    {
        { "gameId", gameId }
    };
    
    var result = await client.RpcAsync(session, "daily_rewards_get_status", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<DailyRewardStatus>(result.Payload);
}
```

#### 2. `daily_rewards_claim`

Claim today's daily reward for a specific game.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "currentStreak": 4,
  "totalClaims": 16,
  "reward": {
    "day": 4,
    "xp": 250,
    "tokens": 25,
    "description": "Day 4 Reward"
  },
  "claimedAt": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<DailyRewardClaim> ClaimDailyReward(IClient client, ISession session, string gameId)
{
    var payload = new Dictionary<string, string>
    {
        { "gameId", gameId }
    };
    
    var result = await client.RpcAsync(session, "daily_rewards_claim", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<DailyRewardClaim>(result.Payload);
}
```

### Daily Missions System

#### 3. `get_daily_missions`

Get all daily missions for a specific game with progress.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "resetDate": 1699747200,
  "missions": [
    {
      "id": "login_daily",
      "name": "Daily Login",
      "description": "Log in to the game",
      "objective": "login",
      "currentValue": 1,
      "targetValue": 1,
      "completed": true,
      "claimed": false,
      "rewards": { "xp": 50, "tokens": 5 }
    },
    {
      "id": "play_matches",
      "name": "Play Matches",
      "description": "Complete 3 matches",
      "objective": "matches_played",
      "currentValue": 1,
      "targetValue": 3,
      "completed": false,
      "claimed": false,
      "rewards": { "xp": 100, "tokens": 10 }
    }
  ],
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<DailyMissions> GetDailyMissions(IClient client, ISession session, string gameId)
{
    var payload = new Dictionary<string, string>
    {
        { "gameId", gameId }
    };
    
    var result = await client.RpcAsync(session, "get_daily_missions", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<DailyMissions>(result.Payload);
}
```

#### 4. `submit_mission_progress`

Update progress for a specific mission.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "missionId": "play_matches",
  "value": 1
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "missionId": "play_matches",
  "currentValue": 2,
  "targetValue": 3,
  "completed": false,
  "claimed": false,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<MissionProgress> SubmitMissionProgress(
    IClient client, ISession session, string gameId, string missionId, int value)
{
    var payload = new Dictionary<string, object>
    {
        { "gameId", gameId },
        { "missionId", missionId },
        { "value", value }
    };
    
    var result = await client.RpcAsync(session, "submit_mission_progress", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<MissionProgress>(result.Payload);
}
```

#### 5. `claim_mission_reward`

Claim reward for a completed mission.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "missionId": "login_daily"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "missionId": "login_daily",
  "rewards": { "xp": 50, "tokens": 5 },
  "claimedAt": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<MissionReward> ClaimMissionReward(
    IClient client, ISession session, string gameId, string missionId)
{
    var payload = new Dictionary<string, string>
    {
        { "gameId", gameId },
        { "missionId", missionId }
    };
    
    var result = await client.RpcAsync(session, "claim_mission_reward", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<MissionReward>(result.Payload);
}
```

### Enhanced Wallet System

#### 6. `wallet_get_all`

Get all wallets (global + all game wallets) for the authenticated user.

**Request:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "globalWallet": {
    "userId": "user-uuid",
    "currencies": {
      "xut": 1000,
      "xp": 5000
    },
    "items": {},
    "nfts": [],
    "createdAt": "2025-11-13T22:00:00.000Z"
  },
  "gameWallets": [
    {
      "userId": "user-uuid",
      "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
      "currencies": {
        "tokens": 500,
        "xp": 2000
      },
      "items": {},
      "consumables": {},
      "cosmetics": {},
      "createdAt": "2025-11-13T22:00:00.000Z"
    }
  ],
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<UserWallets> GetAllWallets(IClient client, ISession session)
{
    var result = await client.RpcAsync(session, "wallet_get_all", "{}");
    return JsonParser.FromJson<UserWallets>(result.Payload);
}
```

#### 7. `wallet_update_global`

Update global wallet currency.

**Request:**
```json
{
  "currency": "xut",
  "amount": 100,
  "operation": "add"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "currency": "xut",
  "newBalance": 1100,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<WalletUpdate> UpdateGlobalWallet(
    IClient client, ISession session, string currency, int amount, string operation)
{
    var payload = new Dictionary<string, object>
    {
        { "currency", currency },
        { "amount", amount },
        { "operation", operation } // "add" or "subtract"
    };
    
    var result = await client.RpcAsync(session, "wallet_update_global", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<WalletUpdate>(result.Payload);
}
```

#### 8. `wallet_update_game_wallet`

Update game-specific wallet currency.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "currency": "tokens",
  "amount": 50,
  "operation": "add"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "currency": "tokens",
  "newBalance": 550,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

#### 9. `wallet_transfer_between_game_wallets`

Transfer currency between two game wallets.

**Request:**
```json
{
  "fromGameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "toGameId": "8e5433bf-de06-5de0-c114-5fgbe3ed42c5",
  "currency": "tokens",
  "amount": 100
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "fromGameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "toGameId": "8e5433bf-de06-5de0-c114-5fgbe3ed42c5",
  "currency": "tokens",
  "amount": 100,
  "fromBalance": 450,
  "toBalance": 100,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

### Analytics System

#### 10. `analytics_log_event`

Log an analytics event for tracking.

**Request:**
```json
{
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "eventName": "level_complete",
  "eventData": {
    "level": 5,
    "score": 1000,
    "time": 120
  }
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "eventName": "level_complete",
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task LogAnalyticsEvent(
    IClient client, ISession session, string gameId, string eventName, 
    Dictionary<string, object> eventData = null)
{
    var payload = new Dictionary<string, object>
    {
        { "gameId", gameId },
        { "eventName", eventName }
    };
    
    if (eventData != null)
    {
        payload["eventData"] = eventData;
    }
    
    await client.RpcAsync(session, "analytics_log_event", 
        JsonWriter.ToJson(payload));
}

// Usage examples
await LogAnalyticsEvent(client, session, gameId, "session_start");
await LogAnalyticsEvent(client, session, gameId, "session_end");
await LogAnalyticsEvent(client, session, gameId, "level_complete", 
    new Dictionary<string, object> { 
        { "level", 5 }, 
        { "score", 1000 } 
    });
```

### Enhanced Friends System

#### 11. `friends_block`

Block another user.

**Request:**
```json
{
  "targetUserId": "target-user-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "blockedUserId": "target-user-uuid",
  "blockedAt": "2025-11-13T22:00:00.000Z"
}
```

#### 12. `friends_unblock`

Unblock a previously blocked user.

**Request:**
```json
{
  "targetUserId": "target-user-uuid"
}
```

#### 13. `friends_remove`

Remove a friend.

**Request:**
```json
{
  "friendUserId": "friend-user-uuid"
}
```

#### 14. `friends_list`

Get list of friends.

**Request:**
```json
{
  "limit": 100
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "friends": [
    {
      "userId": "friend-uuid",
      "username": "player1",
      "displayName": "Player One",
      "online": true,
      "state": 0
    }
  ],
  "count": 1,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

**Unity Example:**
```csharp
public async Task<FriendsList> GetFriendsList(IClient client, ISession session, int limit = 100)
{
    var payload = new Dictionary<string, int>
    {
        { "limit", limit }
    };
    
    var result = await client.RpcAsync(session, "friends_list", 
        JsonWriter.ToJson(payload));
    
    return JsonParser.FromJson<FriendsList>(result.Payload);
}
```

#### 15. `friends_challenge_user`

Challenge a friend to a match.

**Request:**
```json
{
  "friendUserId": "friend-user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "challengeData": {
    "mode": "1v1",
    "stakes": 100
  }
}
```

**Response:**
```json
{
  "success": true,
  "challengeId": "challenge_user1_user2_1699776000",
  "fromUserId": "user-uuid",
  "toUserId": "friend-user-uuid",
  "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4",
  "status": "pending",
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

#### 16. `friends_spectate`

Get match ID to spectate a friend's match.

**Request:**
```json
{
  "friendUserId": "friend-user-uuid"
}
```

**Response:**
```json
{
  "success": true,
  "userId": "user-uuid",
  "friendUserId": "friend-user-uuid",
  "matchId": "match-uuid",
  "spectateReady": true,
  "timestamp": "2025-11-13T22:00:00.000Z"
}
```

## Storage Collections

### Collections Used

- **daily_streaks** - Daily reward streak data per user per game
- **daily_missions** - Daily mission progress per user per game
- **wallets** - Global and per-game wallet data
- **transaction_logs** - All wallet transaction history
- **analytics_events** - All logged analytics events
- **analytics_dau** - Daily Active Users tracking
- **analytics_sessions** - Session tracking data
- **analytics_session_summaries** - Completed session summaries
- **user_blocks** - User block relationships
- **challenges** - Friend challenge data

## Configuration

### Customizing Rewards

Edit `data/modules/daily_rewards/daily_rewards.js`:

```javascript
var REWARD_CONFIGS = {
    // Add game-specific rewards
    "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4": [
        { day: 1, xp: 200, tokens: 20, description: "Custom Day 1" },
        { day: 2, xp: 300, tokens: 30, description: "Custom Day 2" },
        // ... up to day 7
    ],
    // Default fallback
    "default": [ /* ... */ ]
};
```

### Customizing Missions

Edit `data/modules/daily_missions/daily_missions.js`:

```javascript
var MISSION_CONFIGS = {
    "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4": [
        {
            id: "custom_mission",
            name: "Custom Mission",
            description: "Complete custom objective",
            objective: "custom_objective",
            targetValue: 10,
            rewards: { xp: 200, tokens: 20 }
        }
    ],
    "default": [ /* ... */ ]
};
```

## Unity Integration Pattern

### Complete Example

```csharp
using Nakama;
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using UnityEngine;

public class NakamaManager : MonoBehaviour
{
    private IClient _client;
    private ISession _session;
    private string _gameId = "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4";

    async void Start()
    {
        // Initialize client
        _client = new Client("http", "localhost", 7350, "defaultkey");
        
        // Authenticate
        _session = await _client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
        Debug.Log("Authenticated: " + _session.UserId);
        
        // Check daily rewards
        await CheckDailyRewards();
        
        // Get daily missions
        await GetMissions();
        
        // Log session start
        await LogEvent("session_start");
    }

    async Task CheckDailyRewards()
    {
        var payload = new { gameId = _gameId };
        var result = await _client.RpcAsync(_session, "daily_rewards_get_status", 
            JsonUtility.ToJson(payload));
        
        Debug.Log("Daily Reward Status: " + result.Payload);
        
        // Parse and check if can claim
        var status = JsonUtility.FromJson<DailyRewardStatus>(result.Payload);
        if (status.canClaimToday)
        {
            await ClaimDailyReward();
        }
    }

    async Task ClaimDailyReward()
    {
        var payload = new { gameId = _gameId };
        var result = await _client.RpcAsync(_session, "daily_rewards_claim", 
            JsonUtility.ToJson(payload));
        
        Debug.Log("Claimed Reward: " + result.Payload);
    }

    async Task GetMissions()
    {
        var payload = new { gameId = _gameId };
        var result = await _client.RpcAsync(_session, "get_daily_missions", 
            JsonUtility.ToJson(payload));
        
        Debug.Log("Daily Missions: " + result.Payload);
    }

    async Task LogEvent(string eventName, Dictionary<string, object> data = null)
    {
        var payload = new Dictionary<string, object>
        {
            { "gameId", _gameId },
            { "eventName", eventName }
        };
        
        if (data != null)
        {
            payload["eventData"] = data;
        }
        
        await _client.RpcAsync(_session, "analytics_log_event", 
            JsonUtility.ToJson(payload));
    }

    void OnApplicationQuit()
    {
        // Log session end
        _ = LogEvent("session_end");
    }
}

[Serializable]
public class DailyRewardStatus
{
    public bool success;
    public string userId;
    public string gameId;
    public int currentStreak;
    public bool canClaimToday;
}
```

## Testing

### Manual Testing with cURL

```bash
# Get daily reward status
curl -X POST "http://127.0.0.1:7350/v2/rpc/daily_rewards_get_status" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"}'

# Claim daily reward
curl -X POST "http://127.0.0.1:7350/v2/rpc/daily_rewards_claim" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"}'

# Get daily missions
curl -X POST "http://127.0.0.1:7350/v2/rpc/get_daily_missions" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"}'

# Submit mission progress
curl -X POST "http://127.0.0.1:7350/v2/rpc/submit_mission_progress" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4","missionId":"play_matches","value":1}'

# Log analytics event
curl -X POST "http://127.0.0.1:7350/v2/rpc/analytics_log_event" \
  -H "Authorization: Bearer <your_token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4","eventName":"level_complete","eventData":{"level":5}}'
```

## Security & Best Practices

### Input Validation
- All gameId parameters validated as UUID format
- Required field validation on all RPCs
- Safe JSON parsing with error handling

### Storage Security
- User-scoped storage (users can only access their own data)
- Transaction logging for audit trails
- Consistent use of storage permissions

### Error Handling
- All errors return standardized JSON format
- Generic error messages to prevent information disclosure
- Comprehensive logging for debugging

## Future Enhancements

Potential additions to the system:

1. **Cron Jobs** - Automated daily resets for missions and streaks
2. **Leaderboards** - Integration with reward/mission systems
3. **Push Notifications** - Remind users of unclaimed rewards
4. **Economy Balancing** - Dynamic reward adjustment
5. **Achievement System** - Long-term objectives beyond daily missions
6. **Seasonal Events** - Time-limited missions and rewards
7. **Cross-Game Rewards** - Unlock rewards in one game by playing another

## Support

For issues or questions:
- Check Nakama logs: `docker-compose logs nakama`
- Review module code in `data/modules/`
- Verify RPC registration in startup logs
- Test with cURL before client integration

## License

This module follows the Nakama server license (Apache-2.0).
