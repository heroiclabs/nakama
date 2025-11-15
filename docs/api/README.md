# Nakama API Reference

## RPC Functions

### 1. create_or_sync_user

Creates a new user identity or retrieves an existing one for the specified device and game.

**Endpoint**: `create_or_sync_user`

**Method**: RPC

**Authentication**: Required

#### Request

```json
{
  "username": "string",
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Parameters**:
- `username` (required): Player's display name
- `device_id` (required): Unique device identifier
- `game_id` (required): UUID of the game

#### Response (Success - New User)

```json
{
  "success": true,
  "created": true,
  "username": "PlayerName",
  "device_id": "unique-device-identifier",
  "game_id": "game-uuid",
  "wallet_id": "generated-wallet-uuid",
  "global_wallet_id": "global:device-identifier"
}
```

#### Response (Success - Existing User)

```json
{
  "success": true,
  "created": false,
  "username": "PlayerName",
  "device_id": "unique-device-identifier",
  "game_id": "game-uuid",
  "wallet_id": "existing-wallet-uuid",
  "global_wallet_id": "global:device-identifier"
}
```

#### Response (Error)

```json
{
  "success": false,
  "error": "Missing required fields: username, device_id, game_id"
}
```

**Status Codes**:
- 200: Success
- 400: Invalid request payload
- 500: Server error

---

### 2. create_or_get_wallet

Retrieves or creates both per-game and global wallets for a user.

**Endpoint**: `create_or_get_wallet`

**Method**: RPC

**Authentication**: Required

#### Request

```json
{
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Parameters**:
- `device_id` (required): Unique device identifier
- `game_id` (required): UUID of the game

#### Response (Success)

```json
{
  "success": true,
  "game_wallet": {
    "wallet_id": "per-game-wallet-uuid",
    "balance": 1000,
    "currency": "coins",
    "game_id": "game-uuid"
  },
  "global_wallet": {
    "wallet_id": "global:device-identifier",
    "balance": 500,
    "currency": "global_coins"
  }
}
```

#### Response (Error - Identity Not Found)

```json
{
  "success": false,
  "error": "Identity not found. Please call create_or_sync_user first."
}
```

#### Response (Error - Missing Fields)

```json
{
  "success": false,
  "error": "Missing required fields: device_id, game_id"
}
```

**Prerequisites**: User identity must exist (call `create_or_sync_user` first)

---

### 3. submit_score_and_sync

Submits a score to all relevant leaderboards and updates the game wallet balance.

**Endpoint**: `submit_score_and_sync`

**Method**: RPC

**Authentication**: Required

#### Request

```json
{
  "score": 1500,
  "device_id": "string",
  "game_id": "string (UUID)"
}
```

**Parameters**:
- `score` (required): Score value (integer)
- `device_id` (required): Unique device identifier
- `game_id` (required): UUID of the game

#### Response (Success)

```json
{
  "success": true,
  "score": 1500,
  "wallet_balance": 1500,
  "leaderboards_updated": [
    "leaderboard_game-uuid",
    "leaderboard_game-uuid_daily",
    "leaderboard_game-uuid_weekly",
    "leaderboard_game-uuid_monthly",
    "leaderboard_game-uuid_alltime",
    "leaderboard_global",
    "leaderboard_global_daily",
    "leaderboard_global_weekly",
    "leaderboard_global_monthly",
    "leaderboard_global_alltime",
    "leaderboard_friends_game-uuid",
    "leaderboard_friends_global"
  ],
  "game_id": "game-uuid"
}
```

**Response Fields**:
- `score`: The submitted score
- `wallet_balance`: Updated game wallet balance (equals the score)
- `leaderboards_updated`: Array of leaderboard IDs that were updated
- `game_id`: The game UUID

#### Response (Error - Invalid Score)

```json
{
  "success": false,
  "error": "Score must be a valid number"
}
```

#### Response (Error - Identity Not Found)

```json
{
  "success": false,
  "error": "Identity not found. Please call create_or_sync_user first."
}
```

**Side Effects**:
- Updates all relevant leaderboards
- Sets game wallet balance to the score value
- Does NOT modify global wallet

---

## Storage Schema

### Identity Storage

**Collection**: `quizverse`

**Key Pattern**: `identity:<device_id>:<game_id>`

**Example**: `identity:abc123:game-uuid-1`

**Value Structure**:
```json
{
  "username": "PlayerName",
  "device_id": "abc123",
  "game_id": "game-uuid-1",
  "wallet_id": "wallet-uuid-1",
  "global_wallet_id": "global:abc123",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Permissions**:
- Read: 1 (public read)
- Write: 0 (server only)

---

### Game Wallet Storage

**Collection**: `quizverse`

**Key Pattern**: `wallet:<device_id>:<game_id>`

**Example**: `wallet:abc123:game-uuid-1`

**Value Structure**:
```json
{
  "wallet_id": "wallet-uuid-1",
  "device_id": "abc123",
  "game_id": "game-uuid-1",
  "balance": 1000,
  "currency": "coins",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Permissions**:
- Read: 1 (public read)
- Write: 0 (server only)

---

### Global Wallet Storage

**Collection**: `quizverse`

**Key Pattern**: `wallet:<device_id>:global`

**Example**: `wallet:abc123:global`

**Value Structure**:
```json
{
  "wallet_id": "global:abc123",
  "device_id": "abc123",
  "game_id": "global",
  "balance": 500,
  "currency": "global_coins",
  "created_at": "2024-01-01T00:00:00Z",
  "updated_at": "2024-01-01T00:00:00Z"
}
```

**Permissions**:
- Read: 1 (public read)
- Write: 0 (server only)

---

## Leaderboard IDs

### Per-Game Leaderboards

| Pattern | Description | Reset Schedule | Example |
|---------|-------------|----------------|---------|
| `leaderboard_<game_id>` | Main game leaderboard | Weekly (Sundays 00:00 UTC) | `leaderboard_abc-123` |
| `leaderboard_<game_id>_daily` | Daily rankings | Daily (00:00 UTC) | `leaderboard_abc-123_daily` |
| `leaderboard_<game_id>_weekly` | Weekly rankings | Sundays (00:00 UTC) | `leaderboard_abc-123_weekly` |
| `leaderboard_<game_id>_monthly` | Monthly rankings | 1st of month (00:00 UTC) | `leaderboard_abc-123_monthly` |
| `leaderboard_<game_id>_alltime` | All-time rankings | Never | `leaderboard_abc-123_alltime` |

### Global Leaderboards

| Pattern | Description | Reset Schedule |
|---------|-------------|----------------|
| `leaderboard_global` | Main global leaderboard | Weekly (Sundays 00:00 UTC) |
| `leaderboard_global_daily` | Global daily rankings | Daily (00:00 UTC) |
| `leaderboard_global_weekly` | Global weekly rankings | Sundays (00:00 UTC) |
| `leaderboard_global_monthly` | Global monthly rankings | 1st of month (00:00 UTC) |
| `leaderboard_global_alltime` | Global all-time rankings | Never |

### Friends Leaderboards

| Pattern | Description |
|---------|-------------|
| `leaderboard_friends_<game_id>` | Per-game friends leaderboard |
| `leaderboard_friends_global` | Global friends leaderboard |

---

## Unity SDK Integration

### Initialize Client

```csharp
using Nakama;

var client = new Client("http", "localhost", 7350, "defaultkey");
```

### Authenticate

```csharp
var deviceId = SystemInfo.deviceUniqueIdentifier;
var session = await client.AuthenticateDeviceAsync(deviceId);
```

### Call RPCs

```csharp
// Create/Sync User
var payload = new Dictionary<string, string>
{
    { "username", "PlayerName" },
    { "device_id", deviceId },
    { "game_id", "your-game-uuid" }
};
var json = JsonUtility.ToJson(payload);
var result = await client.RpcAsync(session, "create_or_sync_user", json);

// Get Wallets
var walletPayload = new Dictionary<string, string>
{
    { "device_id", deviceId },
    { "game_id", "your-game-uuid" }
};
var walletJson = JsonUtility.ToJson(walletPayload);
var walletResult = await client.RpcAsync(session, "create_or_get_wallet", walletJson);

// Submit Score
var scorePayload = new Dictionary<string, object>
{
    { "score", 1500 },
    { "device_id", deviceId },
    { "game_id", "your-game-uuid" }
};
var scoreJson = JsonUtility.ToJson(scorePayload);
var scoreResult = await client.RpcAsync(session, "submit_score_and_sync", scoreJson);
```

### Read Leaderboards

```csharp
var leaderboardId = $"leaderboard_{gameId}";
var records = await client.ListLeaderboardRecordsAsync(session, leaderboardId, null, 100);

foreach (var record in records.Records)
{
    Debug.Log($"{record.Rank}. {record.Username}: {record.Score}");
}
```

---

## Error Handling

### Common Errors

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Missing required fields: ..." | Required field not provided | Include all required fields in request |
| "Invalid JSON payload" | Malformed JSON | Check JSON formatting |
| "Identity not found. Please call create_or_sync_user first." | Identity doesn't exist | Call `create_or_sync_user` before other RPCs |
| "Score must be a valid number" | Score is not a number or NaN | Ensure score is a valid integer |
| "Authentication required" | No active session | Authenticate before making RPC calls |

### Error Response Format

All errors follow this format:

```json
{
  "success": false,
  "error": "Error message description"
}
```

---

## Rate Limiting

Currently, there are no enforced rate limits on these RPCs. However, best practices recommend:

- **Score Submission**: Once per game session
- **Wallet Fetching**: Maximum once per minute
- **Leaderboard Fetching**: Maximum once per 30 seconds

Implement client-side throttling to prevent excessive server load.

---

## Best Practices

### 1. Always Check Success Flag

```csharp
var response = JsonUtility.FromJson<Response>(result.Payload);
if (response.success)
{
    // Process successful response
}
else
{
    Debug.LogError($"RPC failed: {response.error}");
}
```

### 2. Handle Exceptions

```csharp
try
{
    var result = await client.RpcAsync(session, "create_or_sync_user", json);
}
catch (Exception ex)
{
    Debug.LogError($"RPC exception: {ex.Message}");
}
```

### 3. Cache Data

Don't fetch data repeatedly. Cache leaderboards and wallets locally and refresh only when needed.

### 4. Validate Input

Always validate user input before sending to the server to reduce unnecessary RPC calls.

---

## Versioning

**Current Version**: 1.0.0

**Compatibility**: Nakama 3.x with JavaScript runtime

**Breaking Changes**: None

---

## See Also

- [Identity System Documentation](../identity.md)
- [Wallet System Documentation](../wallets.md)
- [Leaderboard Documentation](../leaderboards.md)
- [Unity Quick Start Guide](../unity/Unity-Quick-Start.md)
- [Sample Game Tutorial](../sample-game/README.md)
