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
8. [Prize Configuration & Gift Giveaways](#8-prize-configuration--gift-giveaways)
9. [Reward Buckets (Hiro)](#9-reward-buckets-hiro)
10. [Cricket Director](#10-cricket-director)
11. [Cricket Auction](#11-cricket-auction)
12. [Push Notifications](#12-push-notifications)
13. [S3 Data Endpoints](#13-s3-data-endpoints)
14. [Client Integration Flow](#14-client-integration-flow)

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

**Auto-Join:** Players who have already created/locked a fantasy team for the
season are **automatically joined** to the live event when it is created.
No manual `satori_live_events_join` call is needed for them. The server calls
`fantasy_auto_join_live_event` which scans the team index and bulk-joins all
team holders.

**Unity Client Responsibilities:**

1. Poll `satori_live_events_list` to discover active match events
2. Check `joined` field — fantasy team holders are pre-joined automatically.
   Players without a fantasy team can still call `satori_live_events_join` manually.
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

**Squad Validation Rules (15 players):**

| Rule | Constraint |
|------|-----------|
| Squad size | Exactly 15 |
| Captain | Exactly 1 |
| Vice-captain | Exactly 1 (different from captain) |
| Credit budget | Total ≤ 100 |
| Max per real team | ≤ 7 from one IPL franchise |
| Max overseas | ≤ 8 in squad |
| Min batsmen | ≥ 3 |
| Min bowlers | ≥ 3 |
| Min all-rounders | ≥ 1 |
| Min wicket-keepers | ≥ 1 |

```csharp
var payload = new {
    seasonId = "ipl-2026",
    leagueId = "ipl-official",
    teamName = "My XI",
    players = new[] {
        new { playerId = "virat-kohli", isCaptain = true, isViceCaptain = false },
        new { playerId = "jasprit-bumrah", isCaptain = false, isViceCaptain = true },
        // ... 13 more players (15 total)
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

### `fantasy_match_xi_select`

Select 11 players from your 15-player squad for a specific match. **Must be done before match deadline.**

| Field | Type | Required |
|-------|------|----------|
| `fixtureId` | string | Yes |
| `seasonId` | string | Yes |
| `playerIds` | string[] | Yes (exactly 11) |
| `captainId` | string | Yes |
| `viceCaptainId` | string | Yes |

**Playing XI Validation Rules (11 players):**

| Rule | Constraint |
|------|-----------|
| XI size | Exactly 11 |
| Source | All must be in your 15-player squad |
| Max overseas | ≤ 4 in XI (IPL rule) |
| Max per real team | ≤ 7 from one franchise |
| Min batsmen | ≥ 3 |
| Min bowlers | ≥ 2 |
| Min all-rounders | ≥ 1 |
| Min wicket-keepers | ≥ 1 |
| Captain | Must be in the XI |
| Vice-captain | Must be in the XI (different from captain) |
| Deadline | Selection rejected after match deadline |

```csharp
var payload = new {
    fixtureId = "ipl-2026-match-15",
    seasonId = "ipl-2026",
    playerIds = new[] {
        "virat-kohli", "jasprit-bumrah", "rohit-sharma",
        "rashid-khan", "pat-cummins", "hardik-pandya",
        "rishabh-pant", "suryakumar-yadav", "yuzvendra-chahal",
        "shubman-gill", "mohammed-siraj"
    },
    captainId = "virat-kohli",
    viceCaptainId = "jasprit-bumrah"
};
var result = await client.RpcAsync(session, "fantasy_match_xi_select", JsonConvert.SerializeObject(payload));
```

**Response:** `{ "success": true, "data": <MatchXI> }`

**Scoring Impact:** When a playing XI is selected, only those 11 players earn fantasy points for that match. Bench players (the 4 not selected) score 0. If no XI is selected, all 15 are scored (backward compatible).

---

### `fantasy_match_xi_get`

Retrieve the playing XI selected for a specific match.

| Field | Type | Required |
|-------|------|----------|
| `fixtureId` | string | Yes |

**Auth:** resolveUserId  
**Response:** `{ "success": true, "data": <MatchXI> }` or error if none selected.

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
        "prizePool": "10,000 Coins + Signed Jersey + Caps + IPL Match Badges",
        "topPrize": "5,000 Coins + Signed IPL Jersey",
        "participationReward": "100 Coins",
        "fantasyRequired": "true"
      },
      "joined": false,
      "claimed": false,
      "hasReward": true,
      "hasGifts": true,
      "prizeTiers": [
        {
          "rank": "1",
          "description": "Winner",
          "reward": {
            "guaranteed": {
              "currencies": { "coins": 5000 },
              "gifts": [
                {
                  "id": "ipl-jersey-fixture-123",
                  "name": "Signed IPL Team Jersey",
                  "description": "Official signed jersey from the winning team",
                  "type": "merch",
                  "value": "INR 4,999",
                  "imageUrl": "https://..."
                }
              ]
            }
          }
        },
        {
          "rank": "2-3",
          "description": "Runners-up",
          "reward": {
            "guaranteed": {
              "currencies": { "coins": 2500 },
              "gifts": [{ "id": "ipl-cap-fixture-123", "name": "IPL Team Cap", "type": "merch", "value": "INR 999" }]
            }
          }
        },
        {
          "rank": "4-10",
          "description": "Top 10",
          "reward": {
            "guaranteed": {
              "currencies": { "coins": 1000 },
              "items": { "ipl-match-badge": { "min": 1 } }
            }
          }
        }
      ],
      "requiresJoin": true
    }
  ]
}
```

**Unity Usage:**
- Read `config.prizePool`, `config.topPrize` to display prize summary in UI.
- Check `hasGifts` to show a gift icon or "Real Prizes" badge.
- Iterate `prizeTiers[]` to render a tiered prize breakdown (rank, description, reward).
- For each gift in a tier's `reward.guaranteed.gifts[]`, display `name`, `imageUrl`, `value`, and `type`.
- Check `config.fantasyRequired` to prompt fantasy team creation before joining.

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
**Response:**
```json
{
  "reward": {
    "currencies": { "coins": 500 },
    "items": {},
    "energies": {},
    "gifts": [
      {
        "id": "ipl-jersey-test",
        "name": "Signed Virat Kohli Jersey",
        "description": "Official signed IPL 2026 jersey",
        "type": "merch",
        "value": "INR 4,999",
        "quantity": 1,
        "terms": "Ships within 15 business days."
      }
    ],
    "modifiers": []
  }
}
```

When `gifts[]` is non-empty, the claim automatically records pending gift fulfillment entries. The Unity client can then query `gift_claims_list` to show the user their pending gifts and track shipment status.

---

## 8. Prize Configuration & Gift Giveaways

Live events support three categories of prizes — all configurable per event:

### Reward Types

| Type | Field | Description |
|------|-------|-------------|
| **Coins** | `currencies` | In-game currency granted instantly to the user's wallet |
| **Items** | `items` | Digital inventory items (badges, skins, boosters) |
| **Gifts** | `gifts` | Physical merchandise, vouchers, or experience prizes |

### Gift Types

| `type` | Use Case | Examples |
|--------|----------|---------|
| `merch` | Physical merchandise | Signed jerseys, caps, cricket bats |
| `voucher` | E-gift cards or discount codes | Amazon/Flipkart gift cards |
| `experience` | Real-world experiences | VIP match tickets, meet-and-greets |
| `digital` | Premium digital content | Exclusive game skins, avatar items |
| `physical` | Generic physical prizes | Trophies, memorabilia |

### Gift Object Schema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique gift identifier |
| `name` | string | Yes | Display name shown to user |
| `description` | string | Yes | Full description |
| `type` | string | Yes | One of: `merch`, `voucher`, `experience`, `digital`, `physical` |
| `imageUrl` | string | No | Prize image URL for UI display |
| `value` | string | No | Human-readable value (e.g. "INR 4,999") |
| `quantity` | number | No | Number of this gift awarded (default: 1) |
| `fulfillmentUrl` | string | No | Link for voucher redemption |
| `terms` | string | No | Terms and conditions text |

### Setting Up Prizes for a Live Event

Prizes are configured when creating/scheduling a live event via `admin_live_event_schedule`:

```json
{
  "id": "ipl-live-match-42",
  "name": "IPL Match 42 - CSK vs MI",
  "description": "Fantasy contest for CSK vs MI",
  "startAt": 1712620800,
  "endAt": 1712635200,
  "reward": {
    "guaranteed": {
      "currencies": { "coins": 100 },
      "gifts": []
    }
  },
  "prizeTiers": [
    {
      "rank": "1",
      "description": "Winner",
      "reward": {
        "guaranteed": {
          "currencies": { "coins": 5000 },
          "gifts": [
            {
              "id": "signed-jersey-match-42",
              "name": "Signed MS Dhoni Jersey",
              "description": "Official CSK jersey signed by MS Dhoni",
              "type": "merch",
              "imageUrl": "https://intelli-verse-x-media.s3.amazonaws.com/prizes/dhoni-jersey.png",
              "value": "INR 9,999",
              "quantity": 1,
              "terms": "Ships within 15 business days. India addresses only."
            }
          ]
        }
      }
    },
    {
      "rank": "2-5",
      "description": "Top 5",
      "reward": {
        "guaranteed": {
          "currencies": { "coins": 2000 },
          "gifts": [
            {
              "id": "amazon-voucher-match-42",
              "name": "Amazon Gift Card INR 1,000",
              "description": "Amazon.in e-gift voucher",
              "type": "voucher",
              "value": "INR 1,000",
              "fulfillmentUrl": "https://www.amazon.in/gp/gift-card"
            }
          ]
        }
      }
    },
    {
      "rank": "6-20",
      "description": "Top 20",
      "reward": {
        "guaranteed": {
          "currencies": { "coins": 500 },
          "items": { "ipl-match-badge": { "min": 1 } }
        }
      }
    }
  ],
  "config": {
    "fixtureId": "match-42",
    "type": "ipl_match",
    "prizePool": "5,000 Coins + Signed Dhoni Jersey + Amazon Vouchers",
    "topPrize": "5,000 Coins + Signed MS Dhoni Jersey",
    "participationReward": "100 Coins",
    "fantasyRequired": "true"
  },
  "requiresJoin": true,
  "category": "cricket"
}
```

**Key points:**
- `reward` (top-level) is the **participation reward** — every joined user gets this on claim
- `prizeTiers[]` define **ranked prizes** — the Unity client displays these; the server uses them for tiered distribution
- `config` contains **display strings** shown in the match lobby UI

### Gift Claims RPCs (Unity Client)

#### `gift_claims_list`

Retrieve the authenticated user's pending and fulfilled gift claims.

**Auth:** requireUserId  
**Payload:** `{}`

**Response:**
```json
{
  "claims": [
    {
      "claimId": "c763c37c-7fa2-466c-aba4-f4c485d20b5c",
      "giftId": "signed-jersey-match-42",
      "name": "Signed MS Dhoni Jersey",
      "description": "Official CSK jersey signed by MS Dhoni",
      "imageUrl": "https://...",
      "type": "merch",
      "value": "INR 9,999",
      "quantity": 1,
      "fulfillmentUrl": "",
      "terms": "Ships within 15 business days.",
      "status": "shipped",
      "claimedAt": 1712635300,
      "fulfilledAt": 0
    }
  ]
}
```

**Gift Claim Statuses:**

| Status | Meaning |
|--------|---------|
| `pending` | Prize won, awaiting admin fulfillment |
| `fulfilled` | Digital prize delivered (voucher sent, code generated) |
| `shipped` | Physical prize dispatched |
| `delivered` | Physical prize confirmed delivered |

**Unity Usage:**
1. After calling `satori_live_events_claim`, check the response `reward.gifts[]` for any gifts
2. Poll `gift_claims_list` to show a "My Prizes" screen with fulfillment status
3. For voucher-type gifts, display `fulfillmentUrl` as a redemption link
4. For merch-type gifts, show shipping status via the `status` field

#### `admin_gift_claim_update` (Admin-only)

Update the fulfillment status of a gift claim.

| Field | Type | Required |
|-------|------|----------|
| `userId` | string | Yes |
| `claimId` | string | Yes |
| `status` | string | Yes (`fulfilled`, `shipped`, or `delivered`) |

---

## 9. Reward Buckets (Hiro)

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

## 10. Cricket Director

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

## 11. Cricket Auction

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

## 12. Push Notifications

### `push_send_event` (Server-only)

Sends Nakama notification to a specific user. Called by Intelliverse-X-AI when match starts/ends.

Unity receives these via `client.ReceivedNotification += (notification) => { ... };`

**Notification fields to handle:**

| Subject | Content Fields | When |
|---------|---------------|------|
| `Match Starting` | `type: "match_starting"`, `fixtureId` | 30 min before match |
| `Match Ended` | `type: "match_ended"`, `fixtureId`, `seasonId`, `matchday` | Match finishes |

---

## 13. S3 Data Endpoints

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

## 14. Client Integration Flow

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
2. Check "joined" field — if true, player was auto-joined (has a fantasy team).
   If false and player wants to participate, call satori_live_events_join.
3. Read config.prizePool, config.topPrize to display prize info
4. Poll S3 ball_events_{fixtureId}.json for commentary
5. Poll fantasy_scoring_live for real-time fantasy points
6. Listen for Nakama notifications (push alerts)
```

### Post-Match

```
1. Call fantasy_scoring_get_points for final player breakdown
2. Call satori_live_events_claim to collect match reward
   → Check response.reward.gifts[] for any physical/voucher prizes
3. Call gift_claims_list to show "My Prizes" with fulfillment status
4. Call fantasy_league_leaderboard to see league standings
5. Call hiro_reward_bucket_get to check tier progress
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
