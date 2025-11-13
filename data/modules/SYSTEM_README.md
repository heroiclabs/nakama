# Nakama Multi-Game Backend System

## 🎮 Complete Backend Solution for Multi-Game Platform

This implementation provides a **production-ready, comprehensive JavaScript backend system** for Nakama 3.x that supports multiple games with UUID-based identification.

## ✨ What's Included

### Core Systems (16 New RPCs)

1. **Daily Rewards & Streaks** (2 RPCs)
   - Configurable reward tiers per game
   - Automatic streak tracking with 48-hour grace period
   - Per-game reward isolation

2. **Daily Missions** (3 RPCs)
   - Configurable mission objectives per game
   - Progress tracking with completion detection
   - Automatic daily reset on access

3. **Enhanced Wallet System** (4 RPCs)
   - Global wallet (XUT, XP, NFTs)
   - Per-game wallets (tokens, items, consumables, cosmetics)
   - Cross-wallet transfers
   - Complete transaction logging

4. **Analytics** (1 RPC)
   - Event logging per game
   - DAU (Daily Active Users) tracking
   - Session duration tracking
   - Custom event data support

5. **Enhanced Friends** (6 RPCs)
   - Block/unblock users
   - Friend list management
   - Challenge friends to matches
   - Spectate friend matches

## 🚀 Quick Start

### 1. Files Added

```
data/modules/
├── daily_rewards/daily_rewards.js       # NEW
├── daily_missions/daily_missions.js     # NEW
├── wallet/wallet.js                     # NEW
├── analytics/analytics.js               # NEW
├── friends/friends.js                   # NEW
├── copilot/utils.js                     # EXTENDED
├── index.js                             # UPDATED
├── MASTER_SYSTEM_DOCUMENTATION.md       # NEW - Complete documentation
└── QUICK_REFERENCE.md                   # NEW - Quick reference guide
```

### 2. Deploy to Nakama

These modules are automatically loaded when Nakama starts. Simply ensure your `data/modules/` directory contains all the files.

### 3. Unity Integration Example

```csharp
using Nakama;
using UnityEngine;

public class GameManager : MonoBehaviour
{
    private IClient _client;
    private ISession _session;
    private string _gameId = "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4";

    async void Start()
    {
        _client = new Client("http", "localhost", 7350, "defaultkey");
        _session = await _client.AuthenticateDeviceAsync(SystemInfo.deviceUniqueIdentifier);
        
        // Check and claim daily reward
        var rewardStatus = await _client.RpcAsync(_session, "daily_rewards_get_status", 
            JsonUtility.ToJson(new { gameId = _gameId }));
        
        // Get daily missions
        var missions = await _client.RpcAsync(_session, "get_daily_missions", 
            JsonUtility.ToJson(new { gameId = _gameId }));
        
        // Log analytics
        await _client.RpcAsync(_session, "analytics_log_event", 
            JsonUtility.ToJson(new { 
                gameId = _gameId, 
                eventName = "session_start" 
            }));
    }
}
```

## 📚 Documentation

### Complete Guides

- **[MASTER_SYSTEM_DOCUMENTATION.md](MASTER_SYSTEM_DOCUMENTATION.md)** - Complete documentation with Unity SDK examples, request/response formats, and detailed explanations
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick reference guide for developers with common patterns and troubleshooting

### Key Concepts

**Multi-Game Support:**
All systems use `gameId` (UUID format) to isolate data:
```json
{ "gameId": "7d4322ae-cd95-4cd9-b003-4ffad2dc31b4" }
```

**Storage Keys:**
Data is isolated per user and per game:
```
user_daily_streak_{userId}_{gameId}
wallet_{userId}_{gameId}
mission_progress_{userId}_{gameId}
```

**Transaction Logging:**
All wallet operations are logged for audit:
```
transaction_log_{userId}_{timestamp}
```

## 🎯 Features

### Daily Rewards
- ✅ 7-day reward cycle with configurable tiers
- ✅ Streak tracking (resets after 48 hours)
- ✅ Per-game reward configurations
- ✅ Automatic claim validation

### Daily Missions
- ✅ Configurable mission objectives
- ✅ Progress tracking
- ✅ Reward claiming
- ✅ Automatic daily reset

### Wallet System
- ✅ Global wallet (shared across games)
- ✅ Per-game wallets (isolated currencies)
- ✅ Multi-currency support (XUT, XP, tokens, items, NFTs)
- ✅ Cross-wallet transfers
- ✅ Complete transaction history

### Analytics
- ✅ Event logging with custom data
- ✅ DAU tracking
- ✅ Session duration tracking
- ✅ Per-game analytics isolation

### Friends
- ✅ Block/unblock users
- ✅ Friend list management
- ✅ Challenge friends (with notifications)
- ✅ Spectate friend matches
- ✅ Integration with existing social features

## 🔧 Configuration

### Customize Rewards

Edit `daily_rewards/daily_rewards.js`:

```javascript
var REWARD_CONFIGS = {
    "your-game-uuid-here": [
        { day: 1, xp: 200, tokens: 20, description: "Day 1" },
        { day: 2, xp: 300, tokens: 30, description: "Day 2" },
        // ... customize for your game
    ]
};
```

### Customize Missions

Edit `daily_missions/daily_missions.js`:

```javascript
var MISSION_CONFIGS = {
    "your-game-uuid-here": [
        {
            id: "custom_mission",
            name: "Custom Mission",
            description: "Complete objective",
            objective: "custom_action",
            targetValue: 10,
            rewards: { xp: 100, tokens: 10 }
        }
    ]
};
```

## 🧪 Testing

### Using cURL

```bash
# Get daily reward status
curl -X POST "http://127.0.0.1:7350/v2/rpc/daily_rewards_get_status" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"}'

# Get daily missions
curl -X POST "http://127.0.0.1:7350/v2/rpc/get_daily_missions" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4"}'

# Log analytics event
curl -X POST "http://127.0.0.1:7350/v2/rpc/analytics_log_event" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"7d4322ae-cd95-4cd9-b003-4ffad2dc31b4","eventName":"level_complete"}'
```

## 📊 RPC Reference

| RPC | Description |
|-----|-------------|
| `daily_rewards_get_status` | Get reward status for today |
| `daily_rewards_claim` | Claim today's reward |
| `get_daily_missions` | Get all missions with progress |
| `submit_mission_progress` | Update mission progress |
| `claim_mission_reward` | Claim completed mission |
| `wallet_get_all` | Get all wallets |
| `wallet_update_global` | Update global wallet |
| `wallet_update_game_wallet` | Update game wallet |
| `wallet_transfer_between_game_wallets` | Transfer between wallets |
| `analytics_log_event` | Log analytics event |
| `friends_block` | Block user |
| `friends_unblock` | Unblock user |
| `friends_remove` | Remove friend |
| `friends_list` | Get friends list |
| `friends_challenge_user` | Challenge friend |
| `friends_spectate` | Spectate friend match |

## 🏗️ Architecture

### Design Principles

1. **UUID-based Multi-Game Support** - All systems use UUID gameId
2. **Pure JavaScript** - No TypeScript, all .js files with JSDoc
3. **Modular Design** - Each system is self-contained
4. **Backward Compatible** - No breaking changes to existing systems
5. **Transaction Logging** - Complete audit trail
6. **Extensible** - Easy to add new games or features

### Storage Collections

- `daily_streaks` - Daily reward streaks
- `daily_missions` - Mission progress
- `wallets` - Wallet data (global + per-game)
- `transaction_logs` - All transactions
- `analytics_events` - Event logs
- `analytics_dau` - DAU tracking
- `analytics_sessions` - Session tracking
- `user_blocks` - Block relationships
- `challenges` - Friend challenges

## 🔐 Security

- ✅ UUID validation on all gameId parameters
- ✅ User authentication required for all RPCs
- ✅ User-scoped storage (users can only access their own data)
- ✅ Safe JSON parsing with error handling
- ✅ Transaction logging for audit trails
- ✅ Standardized error responses (no information leakage)

## 🎓 Examples in Documentation

The complete documentation includes:
- ✅ All 16 RPC request/response formats
- ✅ Unity C# integration examples for each RPC
- ✅ Complete Unity game manager example
- ✅ cURL testing commands
- ✅ Configuration examples
- ✅ Troubleshooting guide

## 📈 Performance

- Daily missions reset automatically on access (no cron needed)
- Streak validation happens on check (no cron needed)
- DAU tracking increments once per day per user
- Efficient storage queries with user/game scoping
- Minimal overhead on Nakama runtime

## 🛠️ Troubleshooting

**RPC not found:**
- Check Nakama logs: `docker-compose logs nakama | grep -i "Registered RPC"`
- Verify modules are in `data/modules/` directory

**Invalid gameId:**
- Ensure gameId is valid UUID format (36 characters with hyphens)
- Check for typos or extra spaces

**Authentication required:**
- User must be authenticated before calling RPCs
- Pass valid session token in Authorization header

## 📄 License

This implementation follows the Nakama server license (Apache-2.0).

## 🤝 Support

For detailed documentation, see:
- [MASTER_SYSTEM_DOCUMENTATION.md](MASTER_SYSTEM_DOCUMENTATION.md) - Complete guide
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Quick reference

## ✅ Production Ready

This system is:
- Built and tested ✅
- Fully documented ✅
- Unity integration examples ✅
- Security best practices ✅
- Performance optimized ✅
- Backward compatible ✅

Deploy and start building your multi-game platform today! 🚀
