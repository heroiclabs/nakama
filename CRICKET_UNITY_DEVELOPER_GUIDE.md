# Cricket VR - Unity Developer Guide

> Complete RPC reference and integration guide for the Cricket VR mobile client.  
> Production Nakama: `nakama-rest.intelli-verse-x.ai`  
> Production AI API: `ai.intelli-verse-x.ai`

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Live Match Lifecycle](#2-live-match-lifecycle)
3. [Fantasy Team RPCs](#3-fantasy-team-rpcs)
4. [Fantasy League RPCs](#4-fantasy-league-rpcs)
5. [Fantasy Scoring RPCs](#5-fantasy-scoring-rpcs)
6. [Fantasy Transfers](#6-fantasy-transfers)
7. [Live Events (Satori)](#7-live-events-satori)
8. [Reward Buckets (Hiro)](#8-reward-buckets-hiro)
9. [Cricket Director](#9-cricket-director)
10. [Cricket Auction](#10-cricket-auction)
11. [Push Notifications](#11-push-notifications)
12. [S3 Data Endpoints](#12-s3-data-endpoints)
13. [Client Integration Flow](#13-client-integration-flow)

---

## 1. Authentication

All RPCs use Nakama authentication. Client-facing RPCs require a valid session token.

```csharp
var client = new Nakama.Client("defaultkey", "nakama-rest.intelli-verse-x.ai", 443, "https");
var session = await client.AuthenticateDeviceAsync("<device-id>");
```

**Auth patterns used by RPCs:**
- **requireUserId** — Must have authenticated session (`ctx.userId`)
- **resolveUserId** — Uses `ctx.userId` if present, falls back to `payload.userId` (server-to-server)
- **No user check** — Accessible via HTTP key (server-to-server only)
- **requireAdmin** — Admin-only, not callable from Unity client

---

## 2. Live Match Lifecycle

The automated flow when an IPL match is played:

```
┌──────────────────────────────────────────────────────────────────────┐
│  30 MIN BEFORE MATCH (n8n Scheduler)                                │
│  → POST /publish/match-starting/:fixtureId                         │
│  → Creates Satori Live Event (admin_live_event_schedule)            │
│  → Sends "Match Starting" push alert                                │
│  → Fetches Playing XI                                               │
├──────────────────────────────────────────────────────────────────────┤
│  MATCH LIVE (n8n Live Workflow, every 10 min)                       │
│  → POST /publish/live                                               │
│  → Ball-by-ball events → S3                                         │
│  → Ball events → fantasy_scoring_process (Nakama)                   │
│  → Live fantasy points per player updated in real-time              │
├──────────────────────────────────────────────────────────────────────┤
│  MATCH ENDS (n8n MatchEnd Workflow)                                 │
│  → POST /publish/match-ended/:fixtureId?seasonId=ipl-2026&matchday=N│
│  → fantasy_scoring_finalize → end-of-match bonuses + leaderboards   │
│  → "Match Ended" push alert                                        │
│  → Live event reward becomes claimable                              │
└──────────────────────────────────────────────────────────────────────┘
```

**Unity Client Responsibilities:**

1. Poll `satori_live_events_list` to discover active match events
2. Call `satori_live_events_join` when player opens a live match
3. Poll `fantasy_scoring_live` for real-time fantasy point updates
4. Read S3 `current/index.json` for ball-by-ball commentary
5. Call `satori_live_events_claim` after match ends to collect reward
6. Call `fantasy_scoring_get_points` for final per-player breakdown

---

## 3. Fantasy Team RPCs

### `fantasy_team_create`

Create or replace a 15-player squad for a season.

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |
| `leagueId` | string | Yes |
| `teamName` | string | Yes |
| `players` | array | Yes |

Each player in `players[]`:

| Field | Type | Required |
|-------|------|----------|
| `playerId` | string | Yes |
| `isCaptain` | boolean | Yes |
| `isViceCaptain` | boolean | Yes |

**Validation:** Exactly 1 captain, 1 vice-captain, all distinct, squad size = 15, credit limit enforced.

```csharp
var payload = new {
    seasonId = "ipl-2026",
    leagueId = "ipl-official",
    teamName = "My XI",
    players = new[] {
        new { playerId = "virat-kohli", isCaptain = true, isViceCaptain = false },
        new { playerId = "jasprit-bumrah", isCaptain = false, isViceCaptain = true },
        // ... 13 more players
    }
};
var result = await client.RpcAsync(session, "fantasy_team_create", JsonConvert.SerializeObject(payload));
```

**Response:** `{ "success": true, "data": <FantasyTeam> }`

---

### `fantasy_team_get`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |

**Auth:** resolveUserId  
**Response:** `{ "success": true, "data": <FantasyTeam> }`

---

### `fantasy_team_update_captain`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |
| `captainId` | string | Yes |
| `viceCaptainId` | string | Yes |

**Auth:** resolveUserId

---

## 4. Fantasy League RPCs

### `fantasy_league_create`

| Field | Type | Required |
|-------|------|----------|
| `leagueName` | string | Yes |
| `seasonId` | string | Yes |
| `maxMembers` | number | No (default: 20, range 2–100) |

**Auth:** resolveUserId  
**Response:** `{ groupId, leagueName, inviteCode, leaderboardId, maxMembers }`

---

### `fantasy_league_join`

| Field | Type | Required |
|-------|------|----------|
| `inviteCode` | string | Yes |

**Auth:** resolveUserId  
**Response:** `{ groupId, leagueName, seasonId, leaderboardId }`

---

### `fantasy_league_leave`

| Field | Type | Required |
|-------|------|----------|
| `groupId` | string | Yes |

**Auth:** resolveUserId (creator cannot leave)

---

### `fantasy_league_leaderboard`

| Field | Type | Required |
|-------|------|----------|
| `groupId` | string | Yes |
| `limit` | number | No (default: 50) |

**Auth:** None required  
**Response:** `{ groupId, leagueName, seasonId, memberCount, records: [{ userId, score, rank }] }`

---

### `fantasy_league_my_leagues`

**Auth:** resolveUserId  
**Response:** `{ leagues: [{ groupId, leagueName, seasonId, inviteCode, memberCount, isCreator }] }`

---

### `fantasy_league_info`

| Field | Type | Required |
|-------|------|----------|
| `groupId` | string | Yes |

**Response:** `{ groupId, leagueName, creatorId, seasonId, leaderboardId, maxMembers, inviteCode, memberCount, createdAt }`

---

### `fantasy_league_list`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | No |
| `limit` | number | No (default: 100) |

**Response:** `{ leagues: [...], count }`

---

## 5. Fantasy Scoring RPCs

### `fantasy_scoring_live`

Get real-time fantasy stats during a live match.

| Field | Type | Required |
|-------|------|----------|
| `fixtureId` | string | Yes |

**Auth:** None  
**Response:** `{ fixtureId, players: { [playerId]: PlayerMatchStats } }`

`PlayerMatchStats` includes: `runs`, `balls`, `fours`, `sixes`, `strikeRate`, `wickets`, `economy`, `maidens`, `catches`, `runOuts`, `stumpings`, `fantasyPoints`.

---

### `fantasy_scoring_get_points`

Get the caller's final match points breakdown.

| Field | Type | Required |
|-------|------|----------|
| `fixtureId` | string | Yes |

**Auth:** requireUserId  
**Response:** `{ fixtureId, totalPoints, playerBreakdown, rank }`

---

### `fantasy_scoring_process` (Server-only)

Ingest ball events from Intelliverse-X-AI. Not called from Unity.

---

### `fantasy_scoring_finalize` (Server-only)

End-of-match bonus calculation. Not called from Unity.

---

## 6. Fantasy Transfers

### `fantasy_transfer`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |
| `matchday` | number | Yes |
| `transfersIn` | string[] | Yes |
| `transfersOut` | string[] | Yes (same length as transfersIn) |
| `boosterId` | string | No |

**Auth:** requireUserId  
**Response:** `{ team, transfersMade, freeTransfersUsed, extraTransfers, penaltyPoints, boosterConsumed, freeTransfersRemaining }`

---

### `fantasy_transfer_window`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |
| `matchday` | number | Yes |

**Response:** `TransferWindow { isOpen, opensAt, closesAt, matchday, freeTransfers }`

---

### `fantasy_transfer_history`

| Field | Type | Required |
|-------|------|----------|
| `seasonId` | string | Yes |

**Auth:** requireUserId  
**Response:** `{ totalTransfers, freeTransfersRemaining, penaltyPointsAccrued, boostersUsed, history }`

---

## 7. Live Events (Satori)

### `satori_live_events_list`

List all active/upcoming live events for the current user.

| Field | Type | Required |
|-------|------|----------|
| `names` | string[] | No (filter by event name) |

**Auth:** requireUserId

**Response:**
```json
{
  "events": [
    {
      "id": "ipl-live-fixture-123",
      "name": "IPL Match fixture-123",
      "description": "Live event for fixture fixture-123",
      "category": "cricket",
      "startAt": 1712620800,
      "endAt": 1712635200,
      "status": "active",
      "config": {
        "fixtureId": "fixture-123",
        "type": "ipl_match",
        "prizePool": "10,000 Coins + IPL Match Badge",
        "topPrize": "5,000 Coins",
        "participationReward": "100 Coins",
        "fantasyRequired": "true"
      },
      "joined": false,
      "claimed": false,
      "hasReward": true,
      "requiresJoin": true
    }
  ]
}
```

**Unity Usage:** Read `config.prizePool`, `config.topPrize` to display prize info in UI. Check `config.fantasyRequired` to prompt fantasy team creation before joining.

---

### `satori_live_events_join`

| Field | Type | Required |
|-------|------|----------|
| `eventId` | string | Yes |

**Auth:** requireUserId  
**Prerequisite:** Event must be `active` (not upcoming/ended)  
**Response:** `{ success: true }`

---

### `satori_live_events_claim`

| Field | Type | Required |
|-------|------|----------|
| `eventId` | string | Yes |
| `gameId` | string | No (default: "default") |

**Auth:** requireUserId  
**Prerequisite:** Must have joined (if `requiresJoin`), not already claimed  
**Response:** `{ reward: { currencies: { coins: 100 }, items: {}, energies: {} } }` or `{ reward: null }`

---

## 8. Reward Buckets (Hiro)

### `hiro_reward_bucket_get`

| Field | Type | Required |
|-------|------|----------|
| `gameId` | string | No |

**Auth:** requireUserId  
**Response:** Buckets with tier progress (reward contents hidden until unlock)

---

### `hiro_reward_bucket_progress`

| Field | Type | Required |
|-------|------|----------|
| `bucketId` | string | Yes |
| `amount` | number | Yes |
| `gameId` | string | No |

**Auth:** requireUserId

---

### `hiro_reward_bucket_unlock`

| Field | Type | Required |
|-------|------|----------|
| `bucketId` | string | Yes |
| `tierIndex` | number | Yes |
| `gameId` | string | No |

**Auth:** requireUserId  
**Response:** `{ reward: <ResolvedReward>, state: <UserBucketState> }`

---

## 9. Cricket Director

VR cricket gameplay session management.

### `cricket_director_start_session`

| Field | Type | Required |
|-------|------|----------|
| `gameMode` | string | Yes |
| `fixtureId` | string | Yes |
| `battingTeamId` | string | No |
| `bowlingTeamId` | string | No |
| `soundManifestVersion` | string | No |
| `difficultyLevel` | string | No |
| `aiPersonality` | string | No |

**Auth:** requireUserId  
**Response:** `{ resumed, message, session: DirectorSessionState }`

---

### `cricket_director_save_session`

| Field | Type | Required |
|-------|------|----------|
| `matchContext` | object | No (partial merge) |
| `directorState` | object | No (partial merge) |
| `checkpointLabel` | string | No |
| `playTimeDelta` | number | No |

**Auth:** requireUserId

---

### `cricket_director_end_session`

| Field | Type | Required |
|-------|------|----------|
| `reason` | string | No (default: "player_ended") |
| `matchContext` | object | No |
| `playTimeDelta` | number | No |

**Auth:** requireUserId  
**Response:** `{ ended, sessionId, finalScore, totalPlayTimeSec }`

---

### `cricket_director_get_session`

**Auth:** requireUserId  
**Response:** `{ hasActiveSession, session }`

---

### `cricket_director_list_history`

| Field | Type | Required |
|-------|------|----------|
| `limit` | number | No (default: 20) |
| `cursor` | string | No |

**Auth:** requireUserId  
**Response:** `{ sessions: DirectorHistoryEntry[], cursor, total }`

---

## 10. Cricket Auction

IPL auction room management (typically driven by server/admin).

### `cricket_auction_create_room`

| Field | Type | Required |
|-------|------|----------|
| `leagueId` | string | Yes |
| `seasonId` | string | Yes |
| `teams` | string[] | Yes |

**Response:** `{ roomKey, status, teams }`

---

### `cricket_auction_get_room`

| Field | Type | Required |
|-------|------|----------|
| `leagueId` | string | Yes |
| `seasonId` | string | Yes |

**Response:** Full `AuctionRoomState`

---

### `cricket_auction_place_bid`

| Field | Type | Required |
|-------|------|----------|
| `leagueId` | string | Yes |
| `seasonId` | string | Yes |
| `teamId` | string | Yes |
| `amount` | number | Yes |

**Auth:** requireUserId  
**Response:** `{ accepted, currentBid, budgetRemaining }`

---

### `cricket_auction_next_player`

| Field | Type | Required |
|-------|------|----------|
| `leagueId` | string | Yes |
| `seasonId` | string | Yes |
| `nextPlayer` | object | No (null = complete auction) |

`nextPlayer`: `{ playerId, playerName?, basePrice?, category?, role?, nationality? }`

---

### `cricket_auction_get_events`

| Field | Type | Required |
|-------|------|----------|
| `leagueId` | string | Yes |
| `seasonId` | string | Yes |
| `limit` | number | No (default: 50) |
| `cursor` | string | No |

**Response:** `{ events: AuctionEventRecord[], cursor, total }`

---

## 11. Push Notifications

### `push_send_event` (Server-only)

Sends Nakama notification to a specific user. Called by Intelliverse-X-AI when match starts/ends.

Unity receives these via `client.ReceivedNotification += (notification) => { ... };`

**Notification fields to handle:**

| Subject | Content Fields | When |
|---------|---------------|------|
| `Match Starting` | `type: "match_starting"`, `fixtureId` | 30 min before match |
| `Match Ended` | `type: "match_ended"`, `fixtureId`, `seasonId`, `matchday` | Match finishes |

---

## 12. S3 Data Endpoints

Static and live cricket data is published to S3 by Intelliverse-X-AI:

| Path | Content |
|------|---------|
| `cricket/current/index.json` | Current release manifest |
| `cricket/current/fixtures.json` | Season fixtures |
| `cricket/current/players_index.json` | Player catalog with credits |
| `cricket/current/ball_events_{fixtureId}.json` | Ball-by-ball events |
| `cricket/current/live_state_{fixtureId}.json` | Live match state |
| `cricket/current/playing_xi_{fixtureId}.json` | Playing XI |
| `cricket/current/auction_pool.json` | Auction player pool |
| `cricket/current/auction_rules.json` | Auction rules |

**Base URL:** `https://intelli-verse-x-media.s3.us-east-1.amazonaws.com/`

---

## 13. Client Integration Flow

### Pre-Match Setup

```
1. Load player catalog from S3 (players_index.json)
2. Call fantasy_transfer_window to check if transfers are open
3. Call fantasy_team_create or fantasy_transfer to set up squad
4. Call fantasy_league_create or fantasy_league_join for mini-leagues
```

### During Live Match

```
1. Poll satori_live_events_list → find event with config.type = "ipl_match"
2. Call satori_live_events_join with the event ID
3. Read config.prizePool, config.topPrize to display prize info
4. Poll S3 ball_events_{fixtureId}.json for commentary
5. Poll fantasy_scoring_live for real-time fantasy points
6. Listen for Nakama notifications (push alerts)
```

### Post-Match

```
1. Call fantasy_scoring_get_points for final player breakdown
2. Call satori_live_events_claim to collect match reward
3. Call fantasy_league_leaderboard to see league standings
4. Call hiro_reward_bucket_get to check tier progress
```

### VR Gameplay

```
1. Call cricket_director_start_session to begin VR match
2. Periodically call cricket_director_save_session
3. Call cricket_director_end_session when done
4. Check cricket_director_list_history for past sessions
```

---

## Response Envelope

All Nakama RPCs return a JSON string in this format:

```json
{
  "success": true,
  "data": { ... }
}
```

Or on error:

```json
{
  "success": false,
  "error": "Human-readable error message",
  "code": 0
}
```

Parse the `payload` field from the Nakama RPC response, then parse the inner JSON string.

```csharp
var rpcResult = await client.RpcAsync(session, "fantasy_team_get", 
    JsonConvert.SerializeObject(new { seasonId = "ipl-2026" }));
var response = JsonConvert.DeserializeObject<RpcResponse>(rpcResult.Payload);
if (response.Success) {
    var team = response.Data; // FantasyTeam object
}
```
