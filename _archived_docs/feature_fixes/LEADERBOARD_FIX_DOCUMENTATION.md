# Leaderboard Update Issue - Fix Documentation

## Problem Summary

The leaderboard system was failing to update scores because leaderboards were not being automatically created when the `submit_score_and_sync` RPC was called. This led to silent failures where scores could not be written to non-existent leaderboards.

## Root Causes

1. **Missing Auto-Creation Logic**: The `writeToAllLeaderboards` function attempted to write to multiple leaderboards (game-specific, time-period, global, and friends leaderboards) but did not ensure these leaderboards existed before writing.

2. **Silent Failures**: When a leaderboard didn't exist, the write operation would fail with a warning but wouldn't create the leaderboard, resulting in incomplete score submissions.

3. **API Endpoint Confusion**: Users were attempting to:
   - POST to `/v2/console/leaderboards` (which doesn't exist - console API doesn't support creating leaderboards)
   - POST to `/v2/leaderboard/{id}/record` (incorrect - should be `/v2/leaderboard/{id}`)

## Solution Implemented

### Code Changes

Added a new helper function `ensureLeaderboardExists()` that:
- Attempts to create a leaderboard if it doesn't exist
- Handles the case where the leaderboard already exists gracefully
- Uses proper configuration (authoritative, sort order, operator, reset schedule)

Updated `writeToAllLeaderboards()` to:
- Call `ensureLeaderboardExists()` before each leaderboard write operation
- Auto-create the following leaderboards on-demand:
  - `leaderboard_{gameId}` - Main game leaderboard
  - `leaderboard_{gameId}_daily` - Daily game leaderboard (resets daily at midnight UTC)
  - `leaderboard_{gameId}_weekly` - Weekly game leaderboard (resets Sunday at midnight UTC)
  - `leaderboard_{gameId}_monthly` - Monthly game leaderboard (resets 1st of month at midnight UTC)
  - `leaderboard_{gameId}_alltime` - All-time game leaderboard (no reset)
  - `leaderboard_global` - Global all-time leaderboard
  - `leaderboard_global_daily` - Global daily leaderboard
  - `leaderboard_global_weekly` - Global weekly leaderboard
  - `leaderboard_global_monthly` - Global monthly leaderboard
  - `leaderboard_global_alltime` - Global all-time leaderboard
  - `leaderboard_friends_{gameId}` - Friends leaderboard for specific game
  - `leaderboard_friends_global` - Global friends leaderboard

### Leaderboard Configuration

All leaderboards are created with:
- **Authoritative**: `true` (server-controlled, clients cannot write directly)
- **Sort Order**: `desc` (descending - highest scores first)
- **Operator**: `best` (keeps the best score per user)
- **Reset Schedule**: Time-period specific (daily, weekly, monthly) or none for all-time

## How to Use

### Submit Score via RPC (Recommended)

Use the `submit_score_and_sync` RPC endpoint:

```bash
curl -X POST "https://nakama-rest.intelli-verse-x.ai/v2/rpc/submit_score_and_sync" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "player123",
    "device_id": "device-uuid-here",
    "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
    "score": 100,
    "subscore": 0,
    "metadata": {}
  }'
```

This will:
1. Verify the user identity
2. Auto-create any missing leaderboards
3. Submit the score to ALL relevant leaderboards
4. Update the game wallet balance
5. Return success/failure status

### Submit Score Directly to Leaderboard (Alternative)

If you want to submit to a specific leaderboard using the native API:

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

**Note**: The correct endpoint is `/v2/leaderboard/{leaderboard_id}` NOT `/v2/leaderboard/{leaderboard_id}/record`

### View Leaderboards in Console

The console API supports viewing leaderboards:

```bash
# List all leaderboards
curl -X GET "https://nakama-rest.intelli-verse-x.ai/v2/console/leaderboard" \
  -H "Authorization: Bearer CONSOLE_ADMIN_TOKEN"

# Get specific leaderboard
curl -X GET "https://nakama-rest.intelli-verse-x.ai/v2/console/leaderboard/leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b" \
  -H "Authorization: Bearer CONSOLE_ADMIN_TOKEN"

# List records from a leaderboard
curl -X GET "https://nakama-rest.intelli-verse-x.ai/v2/console/leaderboard/leaderboard_126bf539-dae2-4bcf-964d-316c0fa1f92b/records" \
  -H "Authorization: Bearer CONSOLE_ADMIN_TOKEN"
```

## Important Notes

1. **Console API Limitations**: The Nakama console API does **NOT** support creating or updating leaderboards via REST endpoints. Leaderboards must be created through:
   - Runtime modules (JavaScript/Lua/Go)
   - Auto-creation when submitting scores (as implemented in this fix)

2. **Authentication**: 
   - Use `CONSOLE_ADMIN_TOKEN` for console API endpoints
   - Use player session tokens for regular API endpoints

3. **Leaderboard IDs**: The leaderboard ID format is important:
   - Game-specific: `leaderboard_{gameId}[_{period}]`
   - Global: `leaderboard_global[_{period}]`
   - Friends: `leaderboard_friends_{gameId}` or `leaderboard_friends_global`

4. **First Score Submission**: When a player submits their first score for a game, the system will automatically create all necessary leaderboards (main, daily, weekly, monthly, all-time, global variants, and friends variants).

## Testing the Fix

1. **Submit a score** using the `submit_score_and_sync` RPC
2. **Check the server logs** to see leaderboards being created and scores being written
3. **Verify in console** that the leaderboards now appear in the admin dashboard
4. **Query leaderboards** using the `get_all_leaderboards` RPC to see all scores

## Files Modified

- `/home/runner/work/nakama/nakama/data/modules/index.js`
  - Added `ensureLeaderboardExists()` helper function
  - Updated `writeToAllLeaderboards()` to auto-create leaderboards

## Breaking Changes

None. This is a backward-compatible enhancement that adds auto-creation functionality without changing existing behavior.
