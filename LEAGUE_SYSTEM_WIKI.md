# League System Wiki

## Overview

The **League System** is a weekly competitive ranking feature for QuizVerse. Players earn points by completing quizzes, are placed in tier-based brackets, and are promoted or demoted each week based on performance. The system is implemented in `data/modules/leagues/leagues.js` and registered via 4 Nakama RPCs.

---

## Tiers

There are 6 tiers in ascending order:

| # | Tier | XP Multiplier | Promotion Threshold | Demotion Threshold |
|---|------|---------------|--------------------|--------------------|
| 1 | Bronze | 1.0x | 500 pts | — |
| 2 | Silver | 1.1x | 1,000 pts | 300 pts |
| 3 | Gold | 1.2x | 1,500 pts | 600 pts |
| 4 | Platinum | 1.3x | 2,500 pts | 1,000 pts |
| 5 | Diamond | 1.5x | 4,000 pts | 1,800 pts |
| 6 | Elite | 2.0x | — | 3,000 pts |

All new players start in **Bronze**.

---

## Season Cycle

- **Duration:** One week (Monday 00:01 UTC → next Monday 00:01 UTC)
- **Week ID format:** `YYYY-WWW` (e.g. `2026-W24`)
- At the start of each new week, points, quiz counts, accuracy stats, and the `lastSubmissionId` are automatically reset.
- Season rotation happens lazily on the next RPC call (not via a scheduled cron).

---

## Promotion & Demotion Rules

End-of-season processing (`league_process_season`) evaluates every player in every tier:

- **Top 20%** of eligible players in a tier → **promoted** one tier (unless already Elite)
- **Bottom 20%** of eligible players in a tier → **demoted** one tier (unless already Bronze)
- **Remaining 60%** → stay in current tier
- At minimum 1 player is always considered for promotion/demotion per tier

### Eligibility for Promotion
A player **must** have completed **at least 3 quizzes** in the current season to be eligible for promotion. Ineligible players are marked `disqualified` (they stay in tier but cannot promote).

### Tie-Breaking (descending priority)
1. Total points
2. Perfect rounds (`perfectRounds`)
3. Average accuracy (`totalAccuracy / accuracyCount`)

---

## Anti-Sandbagging System

The system actively detects and penalizes players who try to game the league by submitting low-effort answers.

| Rule | Threshold | Penalty |
|------|-----------|---------|
| Point cap per quiz | Max 500 pts per submission | Excess points removed |
| Accuracy floor | < 20% accuracy | Points halved |
| Consecutive low accuracy | 3+ consecutive submissions < 30% | 75% point penalty + `sandbaggingFlag` incremented |
| Sandbagger demotion | Any `sandbaggingFlags > 0` | Auto-demoted at season end; cannot promote |
| Inactivity demotion | 0 quizzes played in week | Auto-demoted one tier at season end |

### Consistency Bonus
Players who demonstrate sustained quality play earn a **+10% bonus multiplier** applied on top of tier multiplier:
- Must have played **5+ quizzes** this week
- Must have **70%+ average accuracy**
- Must have **0 sandbagging flags**

---

## Storage

| Field | Type | Description |
|-------|------|-------------|
| `userId` | string | Nakama user ID |
| `gameId` | string | Game identifier (default: `"quizverse"`) |
| `tier` | string | Current tier name |
| `points` | number | Points accumulated this week |
| `quizzesThisWeek` | number | Quizzes completed this week |
| `perfectRounds` | number | Perfect-score rounds this week |
| `totalAccuracy` | number | Sum of accuracy percentages (0–100 scale) |
| `accuracyCount` | number | Count of accuracy submissions (used for average) |
| `season` | string | Current week ID (e.g. `"2026-W24"`) |
| `seasonJoinedAt` | ISO timestamp | When the player joined this season |
| `qualifiesForPromotion` | boolean | True if 3+ quizzes played |
| `sandbaggingFlags` | number | Accumulated sandbag detections |
| `consecutiveLowAccuracy` | number | Running count of low-accuracy submissions |
| `consistencyBonus` | boolean | Whether consistency bonus is active |
| `lastSubmissionId` | string | Idempotency key for last point submission |
| `lastSubmissionAt` | ISO timestamp | Timestamp of last submission |
| `createdAt` | ISO timestamp | Record creation time |
| `updatedAt` | ISO timestamp | Last modification time |

**Storage collection:** `league_state`
**Storage key format:** `{userId}_{gameId}`
**Permissions:** Read = 1 (public readable), Write = 0 (server only)

---

## RPCs

### `league_get_state`

Returns the current league state for the authenticated player. Initializes state if the player is new. Auto-rotates to the new season if the stored week ID is stale.

**Payload (optional):**
```json
{ "gameId": "quizverse" }
```

**Response:**
```json
{
  "success": true,
  "isNew": false,
  "userId": "...",
  "gameId": "quizverse",
  "tier": "gold",
  "tierIndex": 2,
  "points": 850,
  "quizzesThisWeek": 4,
  "perfectRounds": 1,
  "averageAccuracy": 74,
  "season": "2026-W24",
  "seasonEndsAt": "2026-06-15T00:01:00.000Z",
  "minQuizzesRequired": 3,
  "qualifiesForPromotion": true,
  "promotionThreshold": 1500,
  "demotionThreshold": 600,
  "xpMultiplier": 1.2,
  "canPromote": true,
  "canDemote": true,
  "timestamp": "..."
}
```

---

### `league_submit_points`

Awards points to the player for completing a quiz. Applies tier multiplier, anti-sandbagging penalties, and idempotency checking.

**Payload:**
```json
{
  "gameId": "quizverse",
  "points": 200,
  "accuracy": 0.85,
  "isPerfect": false,
  "source": "quiz_complete",
  "submissionId": "unique-uuid-per-quiz"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `points` | Yes | Raw points from quiz (max 10,000 input, capped at 500 effective) |
| `accuracy` | No | Float 0.0–1.0 representing quiz accuracy |
| `isPerfect` | No | Boolean; increments `perfectRounds` counter |
| `submissionId` | No | Idempotency key; duplicate submissions are silently ignored |
| `source` | No | Source label (default: `"quiz_complete"`) |

**Response:**
```json
{
  "success": true,
  "duplicate": false,
  "pointsAwarded": 240,
  "pointsRaw": 200,
  "totalPoints": 1090,
  "tier": "gold",
  "quizzesThisWeek": 5,
  "qualifiesForPromotion": true,
  "nearPromotion": true,
  "nearDemotion": false,
  "consistencyBonus": true,
  "sandbaggingFlags": 0,
  "xpMultiplier": 1.2,
  "timestamp": "..."
}
```

**Point Calculation Pipeline:**
1. Input `points` capped at `MAX_POINTS_PER_QUIZ` (500)
2. Multiplied by `tierConfig.xpMultiplier`
3. If `accuracy < 0.20`: points halved
4. If `consecutiveLowAccuracy >= 3`: points multiplied by 0.25

---

### `league_get_leaderboard`

Returns the leaderboard for the requesting player's current tier. Includes the player's own rank and percentile.

**Payload (optional):**
```json
{ "gameId": "quizverse", "limit": 50 }
```

- `limit` defaults to 50, max 100

**Response:**
```json
{
  "success": true,
  "tier": "gold",
  "season": "2026-W24",
  "seasonEndsAt": "2026-06-15T00:01:00.000Z",
  "totalPlayers": 312,
  "records": [
    {
      "rank": 1,
      "userId": "...",
      "username": "TopPlayer",
      "avatarUrl": "...",
      "points": 3800,
      "perfectRounds": 7,
      "quizzesThisWeek": 14,
      "averageAccuracy": 91
    }
  ],
  "userRecord": {
    "rank": 22,
    "points": 850,
    "perfectRounds": 1,
    "quizzesThisWeek": 4,
    "averageAccuracy": 74,
    "percentile": 93
  },
  "timestamp": "..."
}
```

---

### `league_process_season`

**Server/cron-only RPC.** Processes end-of-season promotion and demotion for all players across all tiers. Should be called once per week on Monday at 00:01 UTC.

**Auth guard:** Rejects calls from regular users unless the payload contains:
```json
{ "adminKey": "quizverse_season_cron_2026" }
```

**Payload:**
```json
{ "gameId": "quizverse" }
```

**Response:**
```json
{
  "success": true,
  "season": "2026-W24",
  "stats": {
    "promoted": 42,
    "demoted": 38,
    "stayed": 180,
    "disqualified": 27,
    "errors": 0
  },
  "timestamp": "..."
}
```

**Processing logic per tier (in order):**
1. List all players in the tier from storage (paginated, 100 at a time)
2. Filter by `gameId`
3. Sort by points → perfectRounds → averageAccuracy
4. Apply sandbagging demotions first
5. Apply inactivity demotions
6. Apply top-20% promotions (eligible players only)
7. Apply bottom-20% demotions
8. Reset all stats for the new season
9. Send Nakama notifications for promotions/demotions

---

## Registration

The RPCs are registered in `main.ts`:

```typescript
logger.info("[Fantasy] Registering League RPCs...");
FantasyLeague.register(initializer);
```

The `FantasyLeague.register()` call registers all four RPCs:
- `league_get_state`
- `league_submit_points`
- `league_get_leaderboard`
- `league_process_season`

---

## Error Handling

All RPCs return a consistent error envelope:

```json
{ "success": false, "error": "Human-readable error message" }
```

Common errors:
- `"User not authenticated"` — RPC called without a valid session
- `"Invalid JSON payload"` — Malformed request body
- `"Invalid points value"` — Points missing or negative
- `"Points exceed maximum allowed"` — Raw points > 10,000
- `"Unauthorized: server-only RPC"` — Client tried to call `league_process_season`
