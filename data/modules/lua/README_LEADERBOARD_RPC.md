# Persistent Dynamic Leaderboard Creation for Nakama (Lua)

## Overview

This module provides a Nakama RPC that dynamically creates and manages leaderboards for all onboarded games in the IntelliVerse ecosystem. This is the Lua implementation of the leaderboard RPC, providing the same functionality as the TypeScript version.

## Features

- **OAuth Authentication**: Authenticates with IntelliVerse API using client credentials
- **Dynamic Game Discovery**: Automatically fetches all onboarded games from IntelliVerse
- **Persistent Storage**: Tracks created leaderboards in Nakama storage to avoid duplicates
- **Global & Per-Game Leaderboards**: Creates both ecosystem-wide and game-specific leaderboards
- **Idempotent**: Safe to run multiple times - skips already created leaderboards

## Implementation Details

### File Location
`/data/modules/lua/leaderboard_rpc.lua`

### RPC Endpoint
`create_all_leaderboards_persistent`

### Leaderboard Configuration
- **Sort Order**: Descending (highest scores first)
- **Operator**: Best (keeps best score per user)
- **Reset Schedule**: Weekly (every Sunday at midnight UTC - `0 0 * * 0`)

### Storage Collection
Created leaderboards are tracked in the `leaderboards_registry` collection with key `all_created`.

## Usage

### Deployment

1. Ensure the Lua file is present in `/data/modules/lua/leaderboard_rpc.lua`
2. Restart Nakama server:
   ```bash
   docker-compose restart nakama
   ```

### Calling the RPC

Using curl:
```bash
curl -X POST "http://127.0.0.1:7350/v2/rpc/create_all_leaderboards_persistent" \
  -H "Authorization: Bearer <admin_or_server_token>" \
  -H "Content-Type: application/json"
```

Using Nakama client library (JavaScript):
```javascript
const result = await client.rpc(
  session, 
  "create_all_leaderboards_persistent", 
  ""
);
console.log(result.payload);
```

### Response Format

```json
{
  "success": true,
  "created": ["leaderboard_global", "leaderboard_fc3db911...", "leaderboard_a12b388e..."],
  "skipped": ["leaderboard_126bf539..."],
  "totalProcessed": 7,
  "storedRecords": 8
}
```

**Response Fields:**
- `success`: Boolean indicating if the operation completed
- `created`: Array of newly created leaderboard IDs
- `skipped`: Array of leaderboard IDs that already existed
- `totalProcessed`: Number of games processed from IntelliVerse API
- `storedRecords`: Total number of leaderboard records in storage

### Error Handling

If an error occurs, the response will be:
```json
{
  "success": false,
  "error": "Error description here"
}
```

Common errors:
- `"Token request failed"`: Unable to authenticate with IntelliVerse OAuth
- `"Game fetch failed"`: Unable to retrieve games from IntelliVerse API
- `"Invalid token response JSON"`: OAuth response is malformed
- `"Invalid games JSON format"`: Games API response is malformed

## IntelliVerse API Integration

### OAuth Endpoint
- **URL**: `https://api.intelli-verse-x.ai/api/admin/oauth/token`
- **Method**: POST
- **Credentials**: Client ID and secret (configured in the module)

### Games List Endpoint
- **URL**: `https://gaming.intelli-verse-x.ai/api/games/games/all`
- **Method**: GET
- **Authentication**: Bearer token from OAuth

## Leaderboard Naming Convention

- **Global Leaderboard**: `leaderboard_global`
- **Per-Game Leaderboards**: `leaderboard_{gameId}`

## Data Model

### LeaderboardRecord (Stored in Storage)
```lua
{
  leaderboardId = "string",    -- e.g., "leaderboard_global" or "leaderboard_abc123"
  gameId = "string",           -- Game ID (only for per-game leaderboards, optional)
  scope = "string",            -- "global" or "game"
  createdAt = "string"         -- ISO 8601 timestamp
}
```

### Leaderboard Metadata
Each created leaderboard includes metadata:
- **Global**: `{ scope = "global", desc = "Global Ecosystem Leaderboard" }`
- **Per-Game**: `{ desc = "Leaderboard for {gameTitle}", gameId = "{id}", scope = "game" }`

## Maintenance

### Viewing Created Leaderboards

Query the storage collection to see all tracked leaderboards:
```bash
curl -X POST "http://127.0.0.1:7350/v2/rpc/storage_read" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "collection": "leaderboards_registry",
    "key": "all_created",
    "user_id": "system"
  }'
```

### Re-running the RPC

The RPC is idempotent and can be safely re-run:
- Already created leaderboards will be skipped
- New games will have their leaderboards created
- Storage will be updated with any new leaderboard records

## Lua-Specific Implementation Details

### Error Handling
The Lua implementation uses `pcall()` for error handling instead of try/catch blocks:
```lua
local success, result = pcall(nk.http_request, url, method, headers, body)
if not success then
  -- Handle error
  local error_msg = tostring(result)
end
```

### API Differences from TypeScript
- `nk.http_request()` instead of `nk.httpRequest()`
- `nk.register_rpc()` instead of `initializer.registerRpc()`
- `nk.json_encode()` and `nk.json_decode()` for JSON operations
- `nk.logger_info()`, `nk.logger_warn()`, `nk.logger_error()` for logging
- `nk.storage_read()` and `nk.storage_write()` for storage operations
- Table-based data structures instead of TypeScript interfaces

### Table Operations
Lua uses 1-based indexing and different table operations:
- `#table` to get length
- `table.insert()` to append items
- `ipairs()` to iterate over arrays

## Security Considerations

1. **Credentials**: Client ID and secret are hardcoded per requirements. In production, consider using environment variables.
2. **Storage Permissions**: Registry storage has read permission level 1 (owner read) and write permission 0 (owner write only).
3. **RPC Access**: Ensure proper authentication is configured for the RPC endpoint.

## License

Copyright 2025 The Nakama Authors

Licensed under the Apache License, Version 2.0
