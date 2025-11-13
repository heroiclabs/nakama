# Copilot Leaderboard System

A modular, extensible leaderboard and social feature system for Nakama, implementing advanced scoring, friend-based leaderboards, and social graph features.

## 📁 File Structure

```
copilot/
├── index.js                    # Main entry point - registers all RPCs
├── utils.js                    # Shared helper functions
├── leaderboard_sync.js         # Base score synchronization
├── leaderboard_aggregate.js    # Aggregate scoring across games
├── leaderboard_friends.js      # Friend-specific leaderboards
├── social_features.js          # Social graph and notifications
└── test_rpcs.sh               # Shell script for testing
```

## 🔧 Installation

The copilot modules are automatically loaded when Nakama starts. The parent `index.js` imports and initializes all copilot modules.

## 📡 RPC Endpoints

### 1. submit_score_sync

Synchronizes score between per-game and global leaderboards.

**Endpoint:** `submit_score_sync`

**Request:**
```json
{
  "gameId": "test_game",
  "score": 4200
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "test_game",
  "score": 4200,
  "userId": "user-uuid",
  "submittedAt": "2025-11-12T06:00:00.000Z"
}
```

### 2. submit_score_with_aggregate

Aggregates player scores across all game leaderboards to compute Global Power Rank.

**Endpoint:** `submit_score_with_aggregate`

**Request:**
```json
{
  "gameId": "test_game",
  "score": 4200
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "test_game",
  "individualScore": 4200,
  "aggregateScore": 12500,
  "leaderboardsProcessed": 3
}
```

### 3. create_all_leaderboards_with_friends

Creates parallel friend leaderboards for all games in the registry.

**Endpoint:** `create_all_leaderboards_with_friends`

**Request:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "created": ["leaderboard_friends_global", "leaderboard_friends_abc123"],
  "skipped": ["leaderboard_friends_xyz789"],
  "totalProcessed": 5
}
```

### 4. submit_score_with_friends_sync

Submits score to both regular and friend-specific leaderboards.

**Endpoint:** `submit_score_with_friends_sync`

**Request:**
```json
{
  "gameId": "test_game",
  "score": 3500
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "test_game",
  "score": 3500,
  "results": {
    "regular": { "game": true, "global": true },
    "friends": { "game": true, "global": true }
  },
  "submittedAt": "2025-11-12T06:00:00.000Z"
}
```

### 5. get_friend_leaderboard

Retrieves leaderboard filtered by the user's friends.

**Endpoint:** `get_friend_leaderboard`

**Request:**
```json
{
  "leaderboardId": "leaderboard_test_game",
  "limit": 10
}
```

**Response:**
```json
{
  "success": true,
  "leaderboardId": "leaderboard_test_game",
  "records": [
    {
      "ownerId": "user-uuid",
      "username": "player1",
      "score": 5000,
      "rank": 1
    }
  ],
  "totalFriends": 5
}
```

### 6. send_friend_invite

Sends a friend invite to another user with notifications.

**Endpoint:** `send_friend_invite`

**Request:**
```json
{
  "targetUserId": "00000000-0000-0000-0000-000000000001",
  "message": "Let's be friends!"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "user1_user2_1699776000000",
  "targetUserId": "00000000-0000-0000-0000-000000000001",
  "status": "sent"
}
```

### 7. accept_friend_invite

Accepts a friend invite and adds the friend.

**Endpoint:** `accept_friend_invite`

**Request:**
```json
{
  "inviteId": "user1_user2_1699776000000"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "user1_user2_1699776000000",
  "friendUserId": "sender-uuid",
  "friendUsername": "player1"
}
```

### 8. decline_friend_invite

Declines a friend invite.

**Endpoint:** `decline_friend_invite`

**Request:**
```json
{
  "inviteId": "user1_user2_1699776000000"
}
```

**Response:**
```json
{
  "success": true,
  "inviteId": "user1_user2_1699776000000",
  "status": "declined"
}
```

### 9. get_notifications

Retrieves notifications for the authenticated user.

**Endpoint:** `get_notifications`

**Request:**
```json
{
  "limit": 20
}
```

**Response:**
```json
{
  "success": true,
  "notifications": [
    {
      "id": "notification-uuid",
      "subject": "Friend Request",
      "content": { "type": "friend_invite", "fromUsername": "player1" },
      "code": 1,
      "senderId": "sender-uuid",
      "createTime": "2025-11-12T06:00:00.000Z"
    }
  ],
  "count": 1
}
```

## 🧪 Testing

Use the provided test script to test all RPCs:

```bash
cd data/modules/copilot
./test_rpcs.sh "your_bearer_token_here"
```

Or test individual RPCs using curl:

```bash
curl -X POST "http://127.0.0.1:7350/v2/rpc/submit_score_sync" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"gameId":"test_game","score":4200}'
```

## 🔐 Security

- **Authentication Required:** All RPCs require a valid authentication token
- **Input Validation:** All payloads are validated for required fields
- **Error Handling:** Try/catch blocks around all Nakama API calls
- **OWASP Compliance:** Generic error messages to prevent information disclosure
- **Safe Parsing:** JSON parsing uses safe wrappers to prevent crashes

## 🏗️ Architecture

### Module Responsibilities

#### utils.js
Provides shared helper functions:
- `validatePayload(payload, fields)` - Validate required fields
- `readRegistry()` - Read leaderboards registry from storage
- `safeJsonParse(payload)` - Safely parse JSON strings
- `handleError(ctx, err, message)` - Standardized error responses
- `logInfo/logWarn/logError(msg)` - Centralized logging

#### leaderboard_sync.js
- Implements base score synchronization
- Writes to both per-game and global leaderboards
- Includes metadata: `{ source, gameId, submittedAt }`

#### leaderboard_aggregate.js
- Queries all game leaderboards for user's scores
- Calculates aggregate score (sum of all game scores)
- Writes aggregate to global leaderboard
- Returns both individual and aggregate scores

#### leaderboard_friends.js
- Creates friend-specific leaderboards using naming convention `leaderboard_friends_<gameId>`
- Filters leaderboard results by user's friend list using `nk.friendsList()`
- Supports parallel writes to both regular and friend leaderboards

#### social_features.js
- Manages friend invites using Nakama storage
- Sends notifications using `nk.notificationSend()`
- Tracks invite states: `pending`, `accepted`, `declined`
- Uses Nakama's built-in friend system via `nk.friendsAdd()`

## 💾 Data Storage

### Collections Used

1. **leaderboards_registry** (from parent module)
   - Stores all created leaderboard records
   - Used to discover game leaderboards for aggregation

2. **friend_invites**
   - Stores friend invite data
   - Keys: `{fromUserId}_{targetUserId}_{timestamp}`
   - Permissions: Read=1 (owner), Write=0 (owner only)

### Leaderboard Naming Conventions

- **Regular Game:** `leaderboard_<gameId>`
- **Global:** `leaderboard_global`
- **Friends Game:** `leaderboard_friends_<gameId>`
- **Friends Global:** `leaderboard_friends_global`

## 🔄 Backward Compatibility

The copilot modules are fully backward compatible:
- Maintains existing `create_all_leaderboards_persistent` RPC
- Uses existing `leaderboards_registry` collection
- Does not modify existing leaderboard structures
- New modules are isolated and can be disabled without affecting existing functionality

## 📊 Metadata

All score submissions include metadata:

```json
{
  "source": "submit_score_sync",
  "gameId": "abc123",
  "submittedAt": "2025-11-12T06:00:00.000Z"
}
```

Aggregate submissions include additional metadata:

```json
{
  "source": "submit_score_with_aggregate",
  "aggregateScore": 12500,
  "individualScore": 4200,
  "gameId": "abc123",
  "submittedAt": "2025-11-12T06:00:00.000Z"
}
```

## 🐛 Troubleshooting

### Module Not Loading

Check Nakama logs for initialization errors:
```
docker-compose logs nakama | grep -i copilot
```

### RPC Not Found

Ensure the module is loaded:
```
curl -X GET "http://127.0.0.1:7350/v2/rpc" \
  -H "Authorization: Bearer <token>"
```

### Invalid Token Error

Ensure you're using a valid authentication token from Nakama's authentication system.

## 📝 License

Copyright 2025 The Nakama Authors

Licensed under the Apache License, Version 2.0
