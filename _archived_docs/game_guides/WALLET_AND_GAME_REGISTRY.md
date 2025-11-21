# Wallet and Game Registry System

## Overview

This document describes the enhanced wallet and game registry system that ensures:
1. **Automatic game metadata sync** at deployment, restart, and daily
2. **Complete game metadata** visible in Nakama admin console
3. **WalletID tracking** based on gameID and gameName
4. **Global walletID** for each user across all games
5. **All leaderboards** properly linked to game metadata

## Automatic Game Registry Sync

### On Deployment/Restart
The game registry automatically syncs from the external IntelliVerse API when Nakama starts:

```javascript
// Triggered automatically in InitModule
// Syncs all games and stores metadata in game_registry collection
```

### Daily Scheduled Sync
Game registry can be configured to sync daily at 2 AM UTC using Nakama's runtime scheduler.

**Cron Expression**: `0 2 * * *`

### Manual Sync
Trigger sync anytime using the RPC:

```javascript
RPC: sync_game_registry
Payload: {}

Response: {
  "success": true,
  "gamesSync": 5,
  "lastUpdated": "2025-11-17T02:39:38.968Z"
}
```

## Wallet System Architecture

### Per-Game Wallets

Each user has a separate wallet for each game they play:

**Collection**: `game_wallets`  
**Key**: `wallet:<deviceId>:<gameId>`

**Structure**:
```javascript
{
  wallet_id: "uuid",
  device_id: "device-id",
  game_id: "33b245c8-a23f-4f9c-a06e-189885cc22a1",  // Game UUID
  game_title: "Test Game",                          // Game name for visibility
  user_id: "nakama-user-id",
  balance: 1000,
  currency: "coins",
  created_at: "2025-11-17T...",
  updated_at: "2025-11-17T..."
}
```

### Global Wallet

Each user has ONE global wallet shared across all games:

**Collection**: `global_wallets`  
**Key**: `wallet:<deviceId>:global`

**Structure**:
```javascript
{
  wallet_id: "global-uuid",
  device_id: "device-id",
  game_id: "global",
  game_title: "Global Ecosystem Wallet",  // Descriptive title
  user_id: "nakama-user-id",
  balance: 5000,
  currency: "global_coins",
  linked_games: [                         // Games this user plays
    {
      gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
      gameTitle: "Test Game"
    },
    {
      gameId: "quizverse",
      gameTitle: "QuizVerse"
    }
  ],
  created_at: "2025-11-17T...",
  updated_at: "2025-11-17T..."
}
```

## Game Metadata in Storage

### Game Registry Collection

**Collection**: `game_registry`  
**Key**: `all_games`

**Structure**:
```javascript
{
  games: [
    {
      gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
      gameTitle: "Test Game",
      gameDescription: "Test description",
      logoUrl: "https://...",
      videoUrl: "https://...",
      coverPhotos: ["https://..."],
      status: "draft",
      categories: ["Adventure", "Action"],
      revenueSources: [],
      adsPlacementTypes: "banner, interstitial",
      userId: "creator-id",
      userName: "support_yaq4q0",
      createdAt: "2025-11-14T12:08:09.772Z",
      updatedAt: "2025-11-14T12:08:09.772Z"
    }
  ],
  lastUpdated: "2025-11-17T02:39:38.968Z",
  totalGames: 5
}
```

### Leaderboard Metadata

All leaderboards include complete game metadata:

```javascript
{
  gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  gameTitle: "Test Game",
  scope: "game",           // or "global"
  timePeriod: "weekly",    // "daily", "weekly", "monthly", "alltime"
  resetSchedule: "0 0 * * 0",
  description: "Weekly Leaderboard for Test Game",
  createdAt: "2025-11-17T..."
}
```

## Nakama Admin Console Visibility

### Game Registry View

Navigate to: **Storage > Collections > game_registry**

You'll see:
- Complete list of all games
- Game UUIDs and titles
- Categories, status, creation dates
- Last sync timestamp

### Per-Game Wallets View

Navigate to: **Storage > Collections > game_wallets**

For each wallet entry:
- `game_id`: The game UUID
- `game_title`: Human-readable game name
- `user_id`: Linked Nakama user
- `balance`: Current coins
- Easy filtering by game

### Global Wallets View

Navigate to: **Storage > Collections > global_wallets**

For each global wallet:
- `game_title`: "Global Ecosystem Wallet"
- `linked_games`: Array of games user plays
- `balance`: Global coins across all games
- `user_id`: Linked Nakama user

### Leaderboards View

Navigate to: **Leaderboards**

Each leaderboard shows:
- Name includes gameId
- Metadata includes gameTitle
- Scope (game/global)
- Time period
- Easy filtering and searching

## How Data Flows

### 1. Game Registration (External API)
```
IntelliVerse Platform API
↓
Game registered with UUID and metadata
```

### 2. Sync to Nakama (Automatic)
```
Nakama startup / Daily 2AM / Manual RPC call
↓
sync_game_registry RPC
↓
Fetch from external API
↓
Store in game_registry collection
```

### 3. User Plays Game
```
User authenticates
↓
Create/get game wallet (includes gameId + gameTitle)
↓
Create/get global wallet (includes linked games)
↓
Both stored with full metadata
```

### 4. Score Submission
```
submit_score_to_time_periods
↓
Write to game leaderboards (daily, weekly, monthly, alltime)
↓
Write to global leaderboards
↓
All include gameId and gameTitle in metadata
```

### 5. Admin Console View
```
Storage browser shows:
- game_registry: All games with metadata
- game_wallets: Per-game wallets with gameTitle
- global_wallets: Global wallets with linked_games
- Leaderboards: All with game metadata
```

## API Reference

### Game Registry RPCs

#### Get All Games
```javascript
RPC: get_game_registry
Payload: {}

Response: {
  success: true,
  games: [...],
  totalGames: 5,
  lastUpdated: "2025-11-17T..."
}
```

#### Get Specific Game
```javascript
RPC: get_game_by_id
Payload: {
  gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}

Response: {
  success: true,
  game: {
    gameId: "...",
    gameTitle: "...",
    ...
  }
}
```

#### Manual Sync
```javascript
RPC: sync_game_registry
Payload: {}

Response: {
  success: true,
  gamesSync: 5,
  lastUpdated: "2025-11-17T..."
}
```

### Wallet Operations

All wallet operations automatically include game metadata:

```javascript
// Create/get wallet for a game
RPC: create_or_get_wallet
Payload: {
  device_id: "device-123",
  game_id: "33b245c8-a23f-4f9c-a06e-189885cc22a1"
}

// Automatically includes:
// - game_title from registry
// - Links to global wallet
// - Stores in game_wallets collection
```

### Leaderboard Operations

```javascript
// Submit score (includes game metadata)
RPC: submit_score_to_time_periods
Payload: {
  gameId: "33b245c8-a23f-4f9c-a06e-189885cc22a1",
  score: 1500
}

// Creates leaderboard entries with:
// - gameId (UUID)
// - gameTitle (name)
// - timePeriod
// - All metadata for admin visibility
```

## Sync Schedule

### Deployment
✅ Automatic sync when Nakama starts

### Daily
⚙️ Configurable daily sync at 2 AM UTC  
📝 Use cron expression: `0 2 * * *`

### Manual
🔧 Call `sync_game_registry` RPC anytime

## Data Integrity

### Game Metadata
- Source of truth: External IntelliVerse API
- Cached in: `game_registry` collection
- Auto-refresh: Daily (configurable)
- Manual refresh: `sync_game_registry` RPC

### Wallet Linking
- Per-game wallets: One per game per user
- Global wallet: One per user (all games)
- Automatic cross-referencing
- Visible in admin console

### Leaderboard Linking
- All leaderboards include gameId + gameTitle
- Filterable by game in admin console
- Organized by time period
- Global leaderboards aggregate all games

## Migration Notes

### From Legacy System
- Old collection "quizverse" → "game_wallets" (per-game)
- Old global wallets → "global_wallets" (with linked_games)
- Automatic migration on first read
- No data loss

### Adding game_title to Existing Wallets
- On wallet read: Fetches gameTitle from registry
- On wallet create: Includes gameTitle automatically
- Existing wallets updated on next access

## Troubleshooting

### Game Not Showing in Registry
1. Check external API: Is game created?
2. Trigger manual sync: `sync_game_registry`
3. Check logs for API errors
4. Verify OAuth credentials

### Wallet Missing game_title
1. Ensure game registry is synced
2. Access wallet (triggers automatic update)
3. Check game_registry collection exists

### Leaderboard Missing Metadata
1. Recreate leaderboards: `create_time_period_leaderboards`
2. This fetches latest game metadata
3. Includes gameTitle in all new leaderboards

## Best Practices

1. **Sync on Deployment**: Always trigger `sync_game_registry` after deploying new games
2. **Monitor Sync Logs**: Check Nakama logs for sync success/failures
3. **Use Admin Console**: Verify game metadata appears correctly
4. **Test Wallets**: Create test accounts and verify wallet linking
5. **Check Leaderboards**: Confirm gameTitle appears in leaderboard metadata

## Summary

This enhanced system ensures:
- ✅ Game metadata auto-syncs on deployment, restart, and daily
- ✅ All game info visible in Nakama admin console
- ✅ Per-game wallets include gameId AND gameTitle
- ✅ Global wallet tracks all games user plays
- ✅ All leaderboards linked to game metadata
- ✅ Easy filtering and searching in admin console
- ✅ Automatic cross-referencing between systems
