# API Endpoint Corrections

## Issues with the curl commands in the problem statement

### 1. Console Leaderboard Creation Endpoint (DOES NOT EXIST)

**Incorrect attempt:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/console/leaderboards" \
  -H "Authorization: Bearer CONSOLE_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{               
    "id": "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "sort": "desc",
    "operator": "best",
    "reset_schedule": ""
  }'
```

**Why it failed with "Not Found":**
- The endpoint `/v2/console/leaderboards` (with 's') does not exist
- The Nakama console API does **NOT** provide endpoints for creating or updating leaderboards
- Leaderboards can only be created through runtime code (JavaScript/Lua/Go modules)

**What you should do instead:**
- Leaderboards are now **auto-created** when you submit a score via the `submit_score_and_sync` RPC
- Alternatively, create leaderboards programmatically in runtime modules during initialization

**Available console leaderboard endpoints (read-only):**
```bash
# List all leaderboards
GET /v2/console/leaderboard

# Get specific leaderboard details
GET /v2/console/leaderboard/{id}

# List records from a leaderboard
GET /v2/console/leaderboard/{leaderboard_id}/records

# Delete a leaderboard
DELETE /v2/console/leaderboard/{id}

# Delete a specific record
DELETE /v2/console/leaderboard/{id}/owner/{owner_id}
```

---

### 2. Leaderboard Record Submission Endpoint (WRONG PATH)

**Incorrect attempt:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/leaderboard/leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b/record" \
  -H "Authorization: Bearer YOUR_FULL_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "score": 100,
    "subscore": 0,
    "metadata": {}
  }'
```

**Why it failed with "Not Found":**
- The endpoint has an extra `/record` path segment
- The correct path is `/v2/leaderboard/{leaderboard_id}` NOT `/v2/leaderboard/{leaderboard_id}/record`

**Correct endpoint:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/leaderboard/leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "score": "100",
    "subscore": "0",
    "metadata": "{}"
  }'
```

**Note:** The score and subscore should be strings in the JSON payload, not numbers.

---

## Recommended Approach: Use RPC Functions

Instead of using the native leaderboard API directly, use the custom RPC functions that handle everything automatically:

### Submit Score and Sync (Recommended)

This RPC will:
1. Auto-create all necessary leaderboards
2. Submit score to ALL relevant leaderboards (daily, weekly, monthly, all-time, global, friends)
3. Update wallet balance
4. Return comprehensive results

```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/submit_score_and_sync" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "player123",
    "device_id": "your-device-uuid",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "score": 100,
    "subscore": 0,
    "metadata": {}
  }'
```

**Response:**
```json
{
  "success": true,
  "score": 100,
  "wallet_balance": 1000,
  "leaderboards_updated": [
    "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b_daily",
    "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b_weekly",
    "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b_monthly",
    "leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b_alltime",
    "leaderboard_global",
    "leaderboard_global_daily",
    "leaderboard_global_weekly",
    "leaderboard_global_monthly",
    "leaderboard_global_alltime",
    "leaderboard_friends_126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "leaderboard_friends_global"
  ],
  "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b"
}
```

### Get All Leaderboards

Fetch all leaderboards in a single call:

```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/get_all_leaderboards" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "your-device-uuid",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "limit": 50
  }'
```

---

## Authentication Tokens

### Console Admin Token
- Use for console API endpoints (`/v2/console/*`)
- Required for administrative operations
- Example: `CONSOLE_ADMIN_TOKEN` environment variable

### Session Token  
- Use for player-facing API endpoints (`/v2/*`)
- Obtained after authentication
- Example: Token returned from authentication RPC

---

## Summary of Changes Made

✅ **Fixed:** Auto-creation of leaderboards when submitting scores
✅ **Added:** `ensureLeaderboardExists()` helper function
✅ **Updated:** `writeToAllLeaderboards()` to create leaderboards before writing
✅ **Configured:** Proper metadata, sort order, operator, and reset schedules for all leaderboards

**Result:** The `submit_score_and_sync` RPC now works correctly and automatically creates any missing leaderboards before submitting scores.

---

## Testing Your Implementation

1. **Call the RPC to create identity:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/create_or_sync_user" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testplayer",
    "device_id": "test-device-uuid",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b"
  }'
```

2. **Submit a score:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/submit_score_and_sync" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testplayer",
    "device_id": "test-device-uuid",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "score": 100
  }'
```

3. **Verify in console:**
- Go to your Nakama admin dashboard
- Navigate to Leaderboards section
- You should see all the auto-created leaderboards with your score

4. **Fetch leaderboards via RPC:**
```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/get_all_leaderboards" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "test-device-uuid",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "limit": 50
  }'
```
