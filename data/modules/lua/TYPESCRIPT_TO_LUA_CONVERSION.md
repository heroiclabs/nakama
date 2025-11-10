# TypeScript to Lua Conversion Summary

This document outlines the conversion of the leaderboard RPC from TypeScript to Lua for the Nakama runtime.

## Overview

The Lua implementation (`/data/modules/lua/leaderboard_rpc.lua`) is a direct port of the TypeScript implementation (`/data/modules/leaderboard_rpc.ts`) with the same functionality and logic flow.

## Key Differences

### 1. Module Registration

**TypeScript:**
```typescript
let InitModule: nkruntime.InitModule = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
    initializer.registerRpc("create_all_leaderboards_persistent", createAllLeaderboardsPersistent);
    logger.info("Leaderboard RPC registered successfully.");
};
```

**Lua:**
```lua
nk.register_rpc(create_all_leaderboards_persistent, "create_all_leaderboards_persistent")
```

### 2. Function Signature

**TypeScript:**
```typescript
function createAllLeaderboardsPersistent(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string
```

**Lua:**
```lua
local function create_all_leaderboards_persistent(context, payload)
```

Note: In Lua, the logger and nk are globally available via the `nk` module, not passed as parameters.

### 3. Error Handling

**TypeScript:**
```typescript
try {
    tokenResponse = nk.httpRequest(tokenUrl, "post", headers, body);
} catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ success: false, error: `Token request failed: ${errorMsg}` });
}
```

**Lua:**
```lua
local success, token_response = pcall(nk.http_request, token_url, "post", headers, body)
if not success then
    local error_msg = tostring(token_response)
    return nk.json_encode({
        success = false,
        error = string.format("Token request failed: %s", error_msg)
    })
end
```

### 4. HTTP Requests

**TypeScript:**
```typescript
nk.httpRequest(url, method, headers, body)
```

**Lua:**
```lua
nk.http_request(url, method, headers, body)
```

### 5. JSON Operations

**TypeScript:**
```typescript
JSON.parse(response.body)
JSON.stringify(data)
```

**Lua:**
```lua
nk.json_decode(response.body)
nk.json_encode(data)
```

### 6. Logging

**TypeScript:**
```typescript
logger.info("message")
logger.warn("message")
logger.error("message")
```

**Lua:**
```lua
nk.logger_info("message")
nk.logger_warn("message")
nk.logger_error("message")
```

### 7. Storage Operations

**TypeScript:**
```typescript
nk.storageRead([{ collection, key, userId }])
nk.storageWrite([{ collection, key, userId, value, permissionRead, permissionWrite }])
```

**Lua:**
```lua
nk.storage_read({{collection = collection, key = key, user_id = user_id}})
nk.storage_write({{collection = collection, key = key, user_id = user_id, value = value, permission_read = 1, permission_write = 0}})
```

### 8. Data Structures

**TypeScript:**
```typescript
interface LeaderboardRecord {
    leaderboardId: string;
    gameId?: string;
    scope: string;
    createdAt: string;
}

const existingRecords: LeaderboardRecord[] = [];
const existingIds = new Set(existingRecords.map(r => r.leaderboardId));
```

**Lua:**
```lua
-- No interfaces in Lua, just tables
local existing_records = {}
local existing_ids = {}
for _, record in ipairs(existing_records) do
    existing_ids[record.leaderboardId] = true
end
```

### 9. Array Operations

**TypeScript:**
```typescript
created.push(globalId)
games.length
for (const game of games) { ... }
```

**Lua:**
```lua
table.insert(created, global_id)
#games
for _, game in ipairs(games) do ... end
```

### 10. String Formatting

**TypeScript:**
```typescript
`Bearer ${accessToken}`
`leaderboard_${game.id}`
`Leaderboard for ${game.gameTitle || "Untitled Game"}`
```

**Lua:**
```lua
string.format("Bearer %s", access_token)
string.format("leaderboard_%s", game.id)
string.format("Leaderboard for %s", game.gameTitle or "Untitled Game")
```

### 11. Date/Time

**TypeScript:**
```typescript
new Date().toISOString()
```

**Lua:**
```lua
os.date("!%Y-%m-%dT%H:%M:%SZ")
```

## Functional Equivalence

Both implementations:
- Use the same API endpoints
- Create the same leaderboards with identical configuration
- Store the same data structure in storage
- Return the same response format
- Handle errors in equivalent ways
- Support idempotent execution

## Testing

To test the Lua implementation:

1. Deploy the Lua file to Nakama's modules directory
2. Restart Nakama server
3. Call the RPC endpoint: `create_all_leaderboards_persistent`
4. Verify the response matches the expected format
5. Check that leaderboards are created in the database
6. Verify storage records are persisted correctly

## Performance Considerations

The Lua implementation should have similar performance to the TypeScript version:
- Both make the same number of HTTP requests
- Both perform the same storage operations
- Lua may have slightly better performance for simple operations
- TypeScript may have better performance for complex data transformations

## Maintenance

When updating either version, ensure the following are kept in sync:
- API endpoints
- Leaderboard configuration (sort, operator, reset schedule)
- Storage collection name and key
- Response format
- Error messages
- Logging statements
