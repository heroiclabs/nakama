# Multi-Game Backend System - Quick Reference

## Available RPC Endpoints (22 Total)

### Leaderboards (3 RPCs)
- `create_time_period_leaderboards` - Create daily/weekly/monthly/alltime leaderboards
- `submit_score_to_time_periods` - Submit score to all time-period leaderboards
- `get_time_period_leaderboard` - Get leaderboard for specific time period

### Daily Rewards (2 RPCs)
- `daily_rewards_get_status` - Get reward status
- `daily_rewards_claim` - Claim today's reward

### Daily Missions (3 RPCs)
- `get_daily_missions` - List all missions with progress
- `submit_mission_progress` - Update mission progress
- `claim_mission_reward` - Claim completed mission reward

### Wallet System (4 RPCs)
- `wallet_get_all` - Get global + all game wallets
- `wallet_update_global` - Update global wallet currency
- `wallet_update_game_wallet` - Update game wallet currency
- `wallet_transfer_between_game_wallets` - Transfer between wallets

### Analytics (1 RPC)
- `analytics_log_event` - Log analytics event

### Friends (6 RPCs)
- `friends_block` - Block a user
- `friends_unblock` - Unblock a user
- `friends_remove` - Remove a friend
- `friends_list` - Get friends list
- `friends_challenge_user` - Challenge friend to match
- `friends_spectate` - Spectate friend's match

### Wallet Mapping (3 RPCs)
- `get_user_wallet` - Get/create user wallet (Cognito integration)
- `link_wallet_to_game` - Link wallet to game
- `get_wallet_registry` - Get all wallets (admin)

## Quick Unity Integration

```csharp
// Leaderboards - Create time-period leaderboards (one-time setup, admin only)
var create = await client.RpcAsync(session, "create_time_period_leaderboards", "{}");

// Leaderboards - Submit score to all time periods
var submitScore = await client.RpcAsync(session, "submit_score_to_time_periods", 
    JsonUtility.ToJson(new { 
        gameId = "your-game-uuid", 
        score = 1000,
        subscore = 0 
    }));

// Leaderboards - Get leaderboard for a specific period
var leaderboard = await client.RpcAsync(session, "get_time_period_leaderboard", 
    JsonUtility.ToJson(new { 
        gameId = "your-game-uuid",
        period = "weekly", // "daily", "weekly", "monthly", or "alltime"
        limit = 10 
    }));

// Daily Rewards
var status = await client.RpcAsync(session, "daily_rewards_get_status", 
    JsonUtility.ToJson(new { gameId = "your-game-uuid" }));

var claim = await client.RpcAsync(session, "daily_rewards_claim", 
    JsonUtility.ToJson(new { gameId = "your-game-uuid" }));

// Daily Missions
var missions = await client.RpcAsync(session, "get_daily_missions", 
    JsonUtility.ToJson(new { gameId = "your-game-uuid" }));

var progress = await client.RpcAsync(session, "submit_mission_progress", 
    JsonUtility.ToJson(new { 
        gameId = "your-game-uuid", 
        missionId = "play_matches", 
        value = 1 
    }));

// Analytics
await client.RpcAsync(session, "analytics_log_event", 
    JsonUtility.ToJson(new { 
        gameId = "your-game-uuid", 
        eventName = "level_complete",
        eventData = new { level = 5, score = 1000 }
    }));

// Wallet
var wallets = await client.RpcAsync(session, "wallet_get_all", "{}");

var updateWallet = await client.RpcAsync(session, "wallet_update_game_wallet", 
    JsonUtility.ToJson(new { 
        gameId = "your-game-uuid",
        currency = "tokens",
        amount = 100,
        operation = "add"
    }));
```

## Storage Collections Reference

| Collection | Purpose | Key Format |
|------------|---------|------------|
| `daily_streaks` | Daily reward streaks | `user_daily_streak_{userId}_{gameId}` |
| `daily_missions` | Mission progress | `mission_progress_{userId}_{gameId}` |
| `wallets` | Wallet data | `global_wallet_{userId}` or `wallet_{userId}_{gameId}` |
| `transaction_logs` | Transaction history | `transaction_log_{userId}_{timestamp}` |
| `analytics_events` | Event logs | `event_{userId}_{gameId}_{timestamp}` |
| `analytics_dau` | DAU tracking | `dau_{gameId}_{date}` |
| `analytics_sessions` | Active sessions | `analytics_session_{userId}_{gameId}` |
| `user_blocks` | Block relationships | `blocked_{userId}_{targetUserId}` |
| `challenges` | Friend challenges | `challenge_{fromUserId}_{toUserId}_{timestamp}` |

## Common gameId Values

Replace with your actual game UUIDs:

```javascript
const QUIZ_VERSE_GAME_ID = "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4";
const LAST_TO_LIVE_GAME_ID = "8e5433bf-de06-5de0-c114-5fgbe3ed42c5";
```

## Utility Functions (copilot/utils.js)

```javascript
// UUID validation
utils.isValidUUID(gameId)

// Timestamps
utils.getCurrentTimestamp()  // ISO 8601
utils.getUnixTimestamp()     // Unix timestamp in seconds
utils.getStartOfDay()         // Start of today (Unix)

// Time checks
utils.isWithinHours(timestamp1, timestamp2, hours)

// Storage helpers
utils.makeGameStorageKey(prefix, userId, gameId)
utils.makeGlobalStorageKey(prefix, userId)
utils.readStorage(nk, logger, collection, key, userId)
utils.writeStorage(nk, logger, collection, key, userId, value)

// Validation
utils.validatePayload(data, ['requiredField1', 'requiredField2'])
utils.safeJsonParse(jsonString)
```

## Error Responses

All RPCs return standardized error format:

```json
{
  "success": false,
  "error": "Error description"
}
```

## Testing Checklist

- [ ] Replace `your-game-uuid` with actual UUID
- [ ] Authenticate user and get session token
- [ ] Test daily reward status and claim
- [ ] Test daily missions flow (get → submit → claim)
- [ ] Test wallet operations (get → update)
- [ ] Test analytics event logging
- [ ] Verify UUID validation works
- [ ] Check transaction logs are created
- [ ] Verify multi-game isolation (different gameIds)

## Deployment Notes

1. Ensure JavaScript runtime is enabled in Nakama config
2. Place all modules in `data/modules/` directory
3. Verify `index.js` registers all RPCs on startup
4. Check logs for successful RPC registration
5. Test RPCs with valid authentication token

## Performance Considerations

- Daily missions reset automatically when accessed (no cron needed)
- Streak validation happens on each check (no cron needed)
- DAU tracking increments on first event of the day
- Transaction logs are write-only (consider archival strategy)
- Analytics events accumulate (consider periodic cleanup)

## Troubleshooting

**RPC not found:**
- Check Nakama logs for registration errors
- Verify module exports are correct
- Ensure `index.js` imports and registers the RPC

**Invalid gameId error:**
- Verify gameId is valid UUID format
- Check for typos in UUID string
- Ensure no extra spaces or characters

**Authentication required:**
- User must be authenticated to call RPCs
- Pass valid session token in Authorization header
- Check token hasn't expired

**Storage read/write failures:**
- Check Nakama database connection
- Verify storage permissions
- Review Nakama logs for specific errors
