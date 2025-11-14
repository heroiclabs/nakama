# Copilot Module - Advanced Leaderboards & Social Features

## Overview

The Copilot module extends Nakama with advanced leaderboard and social features for multi-game ecosystems:

- **Leaderboard Synchronization**: Automatic sync between per-game and global leaderboards
- **Aggregate Scoring**: Calculate "Global Power Rank" across all games
- **Friend Leaderboards**: Dedicated leaderboards for friends-only competition
- **Social Features**: Friend invites, notifications, and social graph management
- **Wallet Mapping**: AWS Cognito integration for cross-game wallets

## 📚 Documentation

- **[Unity Integration Guide](./UNITY_INTEGRATION_GUIDE.md)** - Complete Unity C# implementation guide with examples
- **[Security Summary](./SECURITY_SUMMARY.md)** - Security features and considerations

## 📁 File Structure

```
copilot/
├── index.js                      # Module initialization and RPC registration
├── utils.js                      # Shared helper functions
│
├── leaderboard_sync.js          # Score synchronization RPCs
├── leaderboard_aggregate.js     # Aggregate scoring RPCs
├── leaderboard_friends.js       # Friend leaderboard RPCs
├── social_features.js           # Social graph and notifications
│
├── cognito_wallet_mapper.js     # Wallet mapping RPCs
├── wallet_registry.js           # Wallet storage operations
├── wallet_utils.js              # JWT utilities
│
└── UNITY_INTEGRATION_GUIDE.md   # Unity developer documentation
```

---

## 🚀 Quick Start

### For Unity Developers

See the **[Unity Integration Guide](./UNITY_INTEGRATION_GUIDE.md)** for complete implementation examples.

### Basic Usage

```javascript
// Client-side (Unity, JavaScript, etc.)
const payload = {
  gameId: "your-game-uuid",
  score: 4200
};

// Submit score with automatic sync
const response = await client.rpc(session, "submit_score_sync", JSON.stringify(payload));
```

---

## 📡 RPC Endpoints

### Leaderboard RPCs

| RPC | Description | Auth Required |
|-----|-------------|---------------|
| `submit_score_sync` | Submit score to game & global leaderboards | ✅ |
| `submit_score_with_aggregate` | Submit score with aggregate calculation | ✅ |
| `create_all_leaderboards_with_friends` | Create friend leaderboards | ✅ |
| `submit_score_with_friends_sync` | Submit to regular & friend leaderboards | ✅ |
| `get_friend_leaderboard` | Get leaderboard filtered by friends | ✅ |

### Social RPCs

| RPC | Description | Auth Required |
|-----|-------------|---------------|
| `send_friend_invite` | Send friend invite with notification | ✅ |
| `accept_friend_invite` | Accept pending friend invite | ✅ |
| `decline_friend_invite` | Decline pending friend invite | ✅ |
| `get_notifications` | Get user notifications | ✅ |

### Wallet RPCs

| RPC | Description | Auth Required |
|-----|-------------|---------------|
| `get_user_wallet` | Get or create user wallet | ✅ |
| `link_wallet_to_game` | Link wallet to specific game | ✅ |
| `get_wallet_registry` | Get all wallets (admin) | ✅ |

---

## 🎯 Key Features

### 1. Score Synchronization

Submit a score once, automatically sync to both per-game and global leaderboards.

**Request:**
```json
{
  "gameId": "abc-123",
  "score": 4200
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "abc-123",
  "score": 4200,
  "userId": "user-uuid",
  "submittedAt": "2025-11-14T01:00:00.000Z"
}
```

### 2. Aggregate Power Rank

Calculate user's total score across all games for a "Global Power Rank".

**Request:**
```json
{
  "gameId": "abc-123",
  "score": 4200
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "abc-123",
  "individualScore": 4200,
  "aggregateScore": 12500,
  "leaderboardsProcessed": 3
}
```

### 3. Friend Leaderboards

Compete with friends on dedicated leaderboards.

**Request:**
```json
{
  "leaderboardId": "leaderboard_abc-123",
  "limit": 50
}
```

**Response:**
```json
{
  "success": true,
  "leaderboardId": "leaderboard_abc-123",
  "records": [
    {
      "ownerId": "user-uuid",
      "username": "player1",
      "score": 5000,
      "rank": 1
    }
  ],
  "totalFriends": 10
}
```

### 4. Social Features

Send friend invites with automatic notifications.

**Send Invite:**
```json
{
  "targetUserId": "friend-uuid",
  "message": "Let's be friends!"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "invite-uuid",
  "targetUserId": "friend-uuid",
  "status": "sent"
}
```

---

## 💾 Data Storage

### Collections

1. **leaderboards_registry**
   - Stores all created leaderboard records
   - Used for discovering game leaderboards

2. **friend_invites**
   - Stores friend invite data
   - Tracks invite states: pending, accepted, declined

3. **wallet_registry**
   - Stores Cognito ↔ Wallet mappings
   - One-to-one mapping per user

### Leaderboard Naming Conventions

- **Per-game**: `leaderboard_{gameId}`
- **Global**: `leaderboard_global`
- **Friends per-game**: `leaderboard_friends_{gameId}`
- **Friends global**: `leaderboard_friends_global`

---

## 🔧 Installation & Setup

The copilot module is automatically loaded when Nakama starts via the main `index.js`:

```javascript
// Main index.js loads copilot module
var copilot = require("./copilot/index");
copilot.initializeCopilotModules(ctx, logger, nk, initializer);
```

### Initialization Log

```
========================================
Initializing Copilot Leaderboard Modules
========================================
✓ Registered RPC: submit_score_sync
✓ Registered RPC: submit_score_with_aggregate
✓ Registered RPC: create_all_leaderboards_with_friends
✓ Registered RPC: submit_score_with_friends_sync
✓ Registered RPC: get_friend_leaderboard
✓ Registered RPC: send_friend_invite
✓ Registered RPC: accept_friend_invite
✓ Registered RPC: decline_friend_invite
✓ Registered RPC: get_notifications
========================================
Copilot Leaderboard Modules Loaded Successfully
========================================
```

---

## 🧪 Testing

### Using curl

```bash
# Submit score
curl -X POST "http://127.0.0.1:7350/v2/rpc/submit_score_sync" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"test-game","score":4200}'

# Get friend leaderboard
curl -X POST "http://127.0.0.1:7350/v2/rpc/get_friend_leaderboard" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"leaderboardId":"leaderboard_test-game","limit":50}'

# Send friend invite
curl -X POST "http://127.0.0.1:7350/v2/rpc/send_friend_invite" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"targetUserId":"friend-uuid","message":"Lets play!"}'
```

### Test Script

```bash
cd data/modules/copilot
./test_rpcs.sh "<your_bearer_token>"
```

---

## 🏗️ Architecture

### Module Responsibilities

#### utils.js
- Shared helper functions
- Payload validation
- Error handling
- Logging utilities

#### leaderboard_sync.js
- Base score synchronization
- Writes to per-game and global leaderboards
- Metadata tracking

#### leaderboard_aggregate.js
- Queries all game leaderboards for user
- Calculates aggregate score
- Updates global Power Rank

#### leaderboard_friends.js
- Creates friend-specific leaderboards
- Filters by user's friend list
- Parallel writes to regular and friend boards

#### social_features.js
- Friend invite management
- Notification system
- Uses Nakama's built-in friend API

#### cognito_wallet_mapper.js
- AWS Cognito integration
- JWT token validation
- Wallet creation and linking

---

## 🔐 Security Features

### Authentication
- All RPCs require valid Nakama session
- JWT token validation for Cognito integration
- User context isolation

### Input Validation
- Required field validation
- Type checking
- Safe JSON parsing

### Error Handling
- Try/catch around all Nakama API calls
- Generic error messages (no info disclosure)
- Comprehensive logging

### Storage Security
- Read/write permissions enforced
- System user for registry storage
- One-to-one wallet mapping invariant

See **[Security Summary](./SECURITY_SUMMARY.md)** for detailed security information.

---

## 📊 Metadata

All score submissions include metadata for analytics:

```json
{
  "source": "submit_score_sync",
  "gameId": "abc-123",
  "submittedAt": "2025-11-14T01:00:00.000Z"
}
```

Aggregate submissions include additional fields:

```json
{
  "source": "submit_score_with_aggregate",
  "aggregateScore": 12500,
  "individualScore": 4200,
  "gameId": "abc-123",
  "submittedAt": "2025-11-14T01:00:00.000Z"
}
```

---

## 🐛 Troubleshooting

### Common Issues

**Module Not Loading**
```bash
# Check Nakama logs
docker-compose logs nakama | grep -i copilot
```

**RPC Not Found**
```bash
# List registered RPCs
curl -X GET "http://127.0.0.1:7350/v2/rpc" \
  -H "Authorization: Bearer <token>"
```

**Authentication Errors**
- Ensure session is valid and not expired
- Refresh session if needed

**Empty Friend Leaderboard**
- Ensure friends are added
- Friends must have submitted scores

**Aggregate Score is 0**
- Submit scores to at least one game leaderboard first

---

## 🔄 Backward Compatibility

The copilot module is fully backward compatible:
- Maintains existing leaderboard RPCs
- Uses existing storage collections
- Does not modify existing structures
- Can be disabled without affecting other features

---

## 📝 API Workflow Examples

### Typical Game Flow

```
1. User authenticates with Nakama
   ↓
2. User plays game and achieves score
   ↓
3. Game calls submit_score_with_aggregate
   ↓
4. Server writes to:
   - leaderboard_{gameId}
   - leaderboard_global (with aggregate)
   - leaderboard_friends_{gameId}
   - leaderboard_friends_global
   ↓
5. User views friend leaderboard
   ↓
6. Server queries friends list
   ↓
7. Server returns filtered leaderboard
```

### Social Workflow

```
1. User A sends friend invite to User B
   ↓
2. Server stores invite in storage
   ↓
3. Server sends notification to User B
   ↓
4. User B calls get_notifications
   ↓
5. User B accepts invite
   ↓
6. Server adds friend relationship
   ↓
7. Server sends acceptance notification to User A
   ↓
8. Both users can now see each other on friend leaderboards
```

---

## 📈 Performance Considerations

### Optimization Tips

1. **Cache friend lists**: Avoid repeated friend list queries
2. **Batch operations**: Use parallel async operations when possible
3. **Limit leaderboard queries**: Use pagination and reasonable limits
4. **Cache leaderboard data**: Client-side caching for frequently accessed data

### Scalability

- Storage reads/writes are atomic
- Leaderboard writes use Nakama's optimized engine
- Friend list queries scale with Nakama's social graph
- Notification system uses Nakama's built-in delivery

---

## 🚀 Future Enhancements

Potential future features:
- [ ] Real-time leaderboard updates via WebSocket
- [ ] Seasonal/time-period friend leaderboards
- [ ] Team/clan friend leaderboards
- [ ] Leaderboard webhooks for external integrations
- [ ] Advanced notification filtering
- [ ] Friend recommendation system

---

## 📚 Additional Resources

- [Nakama Documentation](https://heroiclabs.com/docs)
- [Unity SDK Guide](https://heroiclabs.com/docs/unity-client-guide/)
- [Leaderboards Overview](https://heroiclabs.com/docs/gameplay-leaderboards/)
- [Social Features](https://heroiclabs.com/docs/social-friends/)
- [Main System Documentation](../SYSTEM_README.md)

---

## 📞 Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review Nakama server logs
3. Consult the [Unity Integration Guide](./UNITY_INTEGRATION_GUIDE.md)
4. Contact your system administrator

---

**Version**: 1.0.0  
**Last Updated**: 2025-11-14  
**Compatible with**: Nakama 3.x  
**Language**: JavaScript (ES5)
