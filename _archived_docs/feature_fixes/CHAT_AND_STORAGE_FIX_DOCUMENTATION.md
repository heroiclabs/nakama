# Chat Implementation and Storage Fix Documentation

## Summary

This update addresses the issues mentioned in the problem statement:
1. ✅ **Implemented Group Chat, Direct Chat, and Chat Room functionality**
2. ✅ **Fixed User ID population in storage (quizverse, identity, wallet collections)**
3. ✅ **Ensured leaderboard auto-creation and proper metadata storage**

## Changes Made

### 1. Storage User ID Fix

**Problem**: All storage operations in the `quizverse` collection were using a system userId (`00000000-0000-0000-0000-000000000000`) instead of the actual authenticated user's ID, making data not properly scoped to individual users.

**Solution**: 
- Updated `identity.js` to accept and use actual userId
- Updated `wallet.js` to accept and use actual userId  
- Updated all RPC calls in `index.js` to pass `ctx.userId`
- Added backward compatibility with automatic migration from system userId to user-scoped storage

**Files Modified**:
- `/home/runner/work/nakama/nakama/data/modules/identity.js`
- `/home/runner/work/nakama/nakama/data/modules/wallet.js`
- `/home/runner/work/nakama/nakama/data/modules/index.js`

**Key Functions Updated**:
```javascript
// Before
function getOrCreateIdentity(nk, logger, deviceId, gameId, username)
function getOrCreateGameWallet(nk, logger, deviceId, gameId, walletId)
function getOrCreateGlobalWallet(nk, logger, deviceId, globalWalletId)
function updateGameWalletBalance(nk, logger, deviceId, gameId, newBalance)

// After
function getOrCreateIdentity(nk, logger, deviceId, gameId, username, userId)
function getOrCreateGameWallet(nk, logger, deviceId, gameId, walletId, userId)
function getOrCreateGlobalWallet(nk, logger, deviceId, globalWalletId, userId)
function updateGameWalletBalance(nk, logger, deviceId, gameId, newBalance, userId)
```

**Migration Logic**: 
- When reading storage, first tries with actual userId
- If not found, tries with system userId (backward compatibility)
- If found with system userId, automatically migrates to user-scoped storage
- Old system userId records are deleted after successful migration

### 2. Chat Implementation

**Problem**: No dedicated chat functionality existed for group chat, direct chat, or chat rooms.

**Solution**: Implemented comprehensive chat system with 7 new RPCs.

**New File**:
- `/home/runner/work/nakama/nakama/data/modules/chat.js`

**RPCs Added**:

#### 1. `send_group_chat_message`
Send a message in a group/clan chat.

**Request**:
```json
{
  "group_id": "group-uuid",
  "message": "Hello team!",
  "metadata": {}
}
```

**Response**:
```json
{
  "success": true,
  "message_id": "msg:group-uuid:1234567890:user-id",
  "group_id": "group-uuid",
  "timestamp": "2025-11-16T07:00:00.000Z"
}
```

#### 2. `send_direct_message`
Send a 1-on-1 direct message to another user.

**Request**:
```json
{
  "to_user_id": "recipient-user-id",
  "message": "Hi there!",
  "metadata": {}
}
```

**Response**:
```json
{
  "success": true,
  "message_id": "msg:conversation-id:1234567890:sender-id",
  "conversation_id": "user1-id:user2-id",
  "timestamp": "2025-11-16T07:00:00.000Z"
}
```

**Features**:
- Automatic notification sent to recipient
- Conversation ID is deterministic (smaller userId first for consistency)
- Messages stored with read/unread status

#### 3. `send_chat_room_message`
Send a message in a public chat room.

**Request**:
```json
{
  "room_id": "general-chat",
  "message": "Welcome everyone!",
  "metadata": {}
}
```

**Response**:
```json
{
  "success": true,
  "message_id": "msg:general-chat:1234567890:user-id",
  "room_id": "general-chat",
  "timestamp": "2025-11-16T07:00:00.000Z"
}
```

#### 4. `get_group_chat_history`
Retrieve chat history for a group.

**Request**:
```json
{
  "group_id": "group-uuid",
  "limit": 50
}
```

**Response**:
```json
{
  "success": true,
  "group_id": "group-uuid",
  "messages": [
    {
      "message_id": "msg:group-uuid:1234567890:user-id",
      "group_id": "group-uuid",
      "user_id": "user-id",
      "username": "player123",
      "message": "Hello team!",
      "metadata": {},
      "created_at": "2025-11-16T07:00:00.000Z",
      "updated_at": "2025-11-16T07:00:00.000Z"
    }
  ],
  "total": 25
}
```

#### 5. `get_direct_message_history`
Retrieve direct message history between two users.

**Request**:
```json
{
  "other_user_id": "other-user-id",
  "limit": 50
}
```

**Response**:
```json
{
  "success": true,
  "conversation_id": "user1-id:user2-id",
  "messages": [
    {
      "message_id": "msg:conversation-id:1234567890:sender-id",
      "conversation_id": "user1-id:user2-id",
      "from_user_id": "sender-id",
      "from_username": "sender",
      "to_user_id": "recipient-id",
      "message": "Hi there!",
      "metadata": {},
      "read": false,
      "created_at": "2025-11-16T07:00:00.000Z",
      "updated_at": "2025-11-16T07:00:00.000Z"
    }
  ],
  "total": 10
}
```

#### 6. `get_chat_room_history`
Retrieve chat room message history.

**Request**:
```json
{
  "room_id": "general-chat",
  "limit": 50
}
```

**Response**:
```json
{
  "success": true,
  "room_id": "general-chat",
  "messages": [
    {
      "message_id": "msg:general-chat:1234567890:user-id",
      "room_id": "general-chat",
      "user_id": "user-id",
      "username": "player123",
      "message": "Welcome everyone!",
      "metadata": {},
      "created_at": "2025-11-16T07:00:00.000Z",
      "updated_at": "2025-11-16T07:00:00.000Z"
    }
  ],
  "total": 100
}
```

#### 7. `mark_direct_messages_read`
Mark direct messages as read.

**Request**:
```json
{
  "conversation_id": "user1-id:user2-id"
}
```

**Response**:
```json
{
  "success": true,
  "conversation_id": "user1-id:user2-id",
  "messages_marked": 5
}
```

**Storage Collections**:
- `group_chat` - Stores group messages with userId scoping
- `direct_chat` - Stores direct messages with userId scoping
- `chat_room` - Stores chat room messages with userId scoping

**Permissions**:
- All messages: `permissionRead: 2` (Public read - relevant users can read)
- All messages: `permissionWrite: 0` (No public write - only via RPCs)

### 3. Leaderboard Improvements

**Problem**: Leaderboards were not being auto-created, causing silent failures.

**Solution**: Added auto-creation logic to ensure leaderboards exist before writing scores.

**Files Modified**:
- `/home/runner/work/nakama/nakama/data/modules/leaderboard.js`

**New Function**:
```javascript
function ensureLeaderboardExists(nk, logger, leaderboardId, resetSchedule, metadata)
```

**Configuration Constants**:
```javascript
var LEADERBOARD_CONFIG = {
    authoritative: true,
    sort: "desc",
    operator: "best"
};

var RESET_SCHEDULES = {
    daily: "0 0 * * *",      // Every day at midnight UTC
    weekly: "0 0 * * 0",     // Every Sunday at midnight UTC
    monthly: "0 0 1 * *",    // 1st of every month at midnight UTC
    alltime: ""              // No reset
};
```

**Leaderboards Auto-Created**:
- `leaderboard_{gameId}` - Main game leaderboard
- `leaderboard_{gameId}_daily` - Daily game leaderboard
- `leaderboard_{gameId}_weekly` - Weekly game leaderboard
- `leaderboard_{gameId}_monthly` - Monthly game leaderboard
- `leaderboard_{gameId}_alltime` - All-time game leaderboard
- `leaderboard_global` - Global leaderboard
- `leaderboard_global_daily` - Global daily leaderboard
- `leaderboard_global_weekly` - Global weekly leaderboard
- `leaderboard_global_monthly` - Global monthly leaderboard
- `leaderboard_global_alltime` - Global all-time leaderboard
- `leaderboard_friends_{gameId}` - Friends game leaderboard
- `leaderboard_friends_global` - Global friends leaderboard

## Testing

### Test Chat Functionality

1. **Send Group Message**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/send_group_chat_message" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": "test-group",
    "message": "Hello team!"
  }'
```

2. **Send Direct Message**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/send_direct_message" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to_user_id": "recipient-user-id",
    "message": "Hi there!"
  }'
```

3. **Get Chat History**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/get_group_chat_history" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "group_id": "test-group",
    "limit": 20
  }'
```

### Test Storage Fix

1. **Create User**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/create_or_sync_user" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testplayer",
    "device_id": "device-123",
    "game_id": "game-456"
  }'
```

2. **Verify Storage** - Check logs to see userId being used instead of system UUID

### Test Leaderboards

1. **Submit Score**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/submit_score_and_sync" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device-123",
    "game_id": "game-456",
    "score": 1500
  }'
```

2. **Get All Leaderboards**:
```bash
curl -X POST "http://localhost:7350/v2/rpc/get_all_leaderboards" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "device-123",
    "game_id": "game-456",
    "limit": 10
  }'
```

## Breaking Changes

**None**. All changes are backward compatible:
- Old storage records are automatically migrated to user-scoped storage
- Leaderboard auto-creation doesn't affect existing leaderboards
- New chat RPCs are additive, don't modify existing functionality

## Migration Notes

### Existing Data Migration

The system automatically migrates existing data:

1. **Identity Records**: When accessed, old system-scoped records are automatically migrated to user-scoped storage
2. **Wallet Records**: Same automatic migration on first access
3. **Old Records**: Deleted after successful migration to prevent duplicates

### No Manual Migration Required

No manual intervention is needed. The migration happens automatically when:
- A user calls `create_or_sync_user`
- A user calls `create_or_get_wallet`
- A score is submitted via `submit_score_and_sync`

## Summary Statistics

**New RPCs**: 7 Chat RPCs
**Modified Functions**: 8 (identity and wallet helpers)
**Modified Files**: 4
**New Files**: 1 (`chat.js`)
**Breaking Changes**: 0
**Backward Compatibility**: 100%

**Total RPCs Now**: 50
- 4 Multi-Game
- 5 Standard Player
- 2 Daily Rewards
- 3 Daily Missions
- 4 Wallet
- 1 Analytics
- 6 Friends
- 3 Time-Period Leaderboards
- 5 Groups/Clans
- 3 Push Notifications
- **7 Chat (NEW)**
- Plus existing Copilot RPCs

## Future Enhancements

Potential future improvements:
1. Chat message editing/deletion
2. Typing indicators for direct messages
3. Read receipts for group messages
4. Message reactions/emojis
5. File/image attachment support
6. Chat moderation tools (mute, kick, ban)
7. Message search functionality
8. Pagination cursors for chat history
