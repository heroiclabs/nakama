# Copilot Wallet Mapping Module

## Overview

The Copilot Wallet Mapping module provides a **one-to-one, permanent mapping** between AWS Cognito users and global wallets shared across all IntelliVerse X games. Each Cognito user's `sub` (UUID) serves as the unique wallet ID reference.

## Architecture

### Single Source of Truth
- Each Cognito user corresponds to **exactly one wallet**
- Wallet ID = Cognito `sub` claim from JWT token
- Mapping stored in Nakama storage under `wallet_registry` collection

### Global Wallet System
- Shared wallet accessible from all IntelliVerse X games
- Games retrieve wallets via Cognito-authenticated JWT
- No duplicate wallets - registry ensures uniqueness

## File Structure

```
copilot/
├── index.js                      # Module initialization and RPC registration
├── cognito_wallet_mapper.js      # Core RPC implementations
├── wallet_registry.js            # CRUD operations for wallet storage
├── wallet_utils.js               # JWT decoding and validation utilities
└── test_wallet_mapping.js        # Automated test suite
```

## Registered RPCs

### 1. `get_user_wallet`

Retrieves or creates a wallet for a Cognito user.
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
  "token": "<cognito_jwt>"
  "gameId": "test_game",
  "score": 4200
}
```

**Response:**
```json
{
  "success": true,
  "walletId": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "active",
  "gamesLinked": ["game1", "game2"],
  "createdAt": "2025-11-12T15:30:00Z"
}
```

**Behavior:**
- Decodes Cognito JWT and extracts `sub` and `email`
- Queries wallet registry by `walletId = sub`
- Creates new wallet if not found
- Returns wallet information

### 2. `link_wallet_to_game`

Links a wallet to a specific game context.

**Request:**
```json
{
  "token": "<cognito_jwt>",
  "gameId": "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
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
  "walletId": "550e8400-e29b-41d4-a716-446655440000",
  "gameId": "fc3db911-42e8-4f95-96d1-41c3e7b9812d",
  "gamesLinked": ["game1", "game2", "fc3db911-42e8-4f95-96d1-41c3e7b9812d"],
  "message": "Game successfully linked to wallet"
}
```

**Behavior:**
- Ensures wallet exists for the user
- Adds game to `gamesLinked` array (if not already present)
- Updates wallet record in storage

### 3. `get_wallet_registry`

Returns all wallets in the registry (admin function).
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
  "limit": 100
  "leaderboardId": "leaderboard_test_game",
  "limit": 10
}
```

**Response:**
```json
{
  "success": true,
  "wallets": [
    {
      "walletId": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "550e8400-e29b-41d4-a716-446655440000",
      "username": "user@example.com",
      "createdAt": "2025-11-12T15:30:00Z",
      "gamesLinked": ["game1", "game2"],
      "status": "active"
    }
  ],
  "count": 1
}
```

## Wallet Storage Schema

Wallets are stored in Nakama storage with the following structure:

```json
{
  "walletId": "uuid-from-cognito",
  "userId": "uuid-from-cognito",
  "username": "player@example.com",
  "createdAt": "2025-11-12T15:30:00Z",
  "gamesLinked": ["game1", "game2", "game3"],
  "status": "active"
}
```

**Storage Details:**
- **Collection:** `wallet_registry`
- **Key:** User's Cognito `sub` (UUID)
- **User ID:** System user (`00000000-0000-0000-0000-000000000000`)
- **Permissions:** Public read (1), No public write (0)

## Usage Example

### Game Client Integration

1. **User authenticates via Cognito** and obtains JWT token
2. **Client sends request** to Nakama:

```javascript
// Using Nakama JavaScript client
const payload = {
  token: "<cognito_jwt>",
  gameId: "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
};

// Get or create wallet
const walletResponse = await client.rpc(
  session,
  "get_user_wallet",
  JSON.stringify(payload)
);

console.log("Wallet ID:", walletResponse.walletId);

// Link wallet to current game
const linkResponse = await client.rpc(
  session,
  "link_wallet_to_game",
  JSON.stringify(payload)
);

console.log("Games linked:", linkResponse.gamesLinked);
```

### Using Nakama Context (Alternative)

If the user is already authenticated with Nakama, the RPCs can use `ctx.userId` instead of requiring a JWT token:

```javascript
// No token needed if user is authenticated with Nakama
const payload = {
  gameId: "fc3db911-42e8-4f95-96d1-41c3e7b9812d"
};

const response = await client.rpc(
  session,
  "get_user_wallet",
  JSON.stringify(payload)
);
```

## Security Features

### JWT Validation
- Validates JWT structure (header.payload.signature)
- Extracts and validates required claims (`sub`, `email`)
- Error handling for invalid tokens

### Storage Security
- Wallets stored with system user ID for centralized management
- Public read permissions allow games to query wallets
- No public write permissions prevent unauthorized modifications
- One-wallet-per-user invariant enforced

### Audit Logging
- All wallet operations logged with context
- Creates audit trail for wallet creation and game linkage
- Error logging for debugging and security monitoring

## Testing

Run automated tests:

```bash
cd /home/runner/work/nakama/nakama/data/modules/copilot
node test_wallet_mapping.js
```

**Test Coverage:**
- Mock Cognito token generation
- JWT decoding and validation
- Wallet creation for new users
- Wallet reuse on re-login
- Multiple game linkage
- One-to-one mapping validation
- Error handling for invalid tokens

## Integration with IntelliVerse X

The central wallet enables:
- **Cross-game tokens and rewards** - Shared currency across all games
- **Unified inventory & NFTs** - Items accessible in multiple games
- **Global player profile** - Single identity across ecosystem
- **Blockchain sync layer** - Future-ready for token integration

## Module Initialization

The module is automatically initialized when Nakama starts via the main `index.js`:

```javascript
// Main index.js loads copilot module
var CopilotModule = require('./copilot/index.js').CopilotModule;

function InitModule(ctx, logger, nk, initializer) {
    // Initialize Copilot Wallet Mapping Module
    CopilotModule.init(ctx, logger, nk, initializer);
    // ... rest of initialization
}
```

The module registers all RPCs and logs successful initialization.

## Error Handling

All RPCs return standardized error responses:

```json
{
  "success": false,
  "error": "Error message description",
  "operation": "operation_name"
}
```

Common error scenarios:
- Invalid JWT format
- Missing required fields
- Storage operation failures
- Missing authentication context

## Future Enhancements

- JWT signature verification with Cognito public keys
- Wallet balance tracking
- Transaction history
- Integration with blockchain wallets
- Multi-signature support for high-value operations
- Rate limiting and abuse prevention

## Support

For issues or questions about the wallet mapping system, refer to:
- Nakama documentation: https://heroiclabs.com/docs
- IntelliVerse X API documentation
- Module source code in `/data/modules/copilot/`
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
