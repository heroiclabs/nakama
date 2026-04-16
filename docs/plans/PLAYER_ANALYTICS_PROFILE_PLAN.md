# Player Analytics Profile System - Implementation Plan

**Version:** 1.0.0  
**Date:** 2026-04-16  
**Status:** PENDING APPROVAL  
**Author:** AI Assistant  

---

## 1. Executive Summary

Build a **Player 360 Analytics Profile** system that:
- Stores comprehensive player data with **gameId** filtering
- Supports **multiple games** (QuizVerse, LastToLive, future games)
- Provides both **global aggregate** and **per-game breakdown** in a single profile
- Enables **50%+ conversion improvement** through personalized insights

---

## 2. Scope

### 2.1 In Scope

| Item | Description |
|------|-------------|
| Collection Mismatch Fix | Replace `quizverse_analytics` with standard `analytics_events` |
| Player Analytics Profile | New collection `player_analytics_profile` |
| Multi-Game Support | All data tagged with `gameId` for filtering |
| Real-Time Updates | Profile updates on every event |
| New RPCs | CRUD operations for player profiles |

### 2.2 Out of Scope (Unless Requested)

- Unity client changes (existing IVXAnalyticsManager will work)
- Dashboard UI changes
- Machine learning predictions
- External analytics integrations (Firebase, Amplitude)

---

## 3. Architecture

### 3.1 Storage Collections

```
┌─────────────────────────────────────────────────────────────────┐
│  COLLECTION: analytics_events                                   │
│  Purpose: Raw event storage (replaces quizverse_analytics)      │
│  Key Format: {gameId}_{eventName}_{timestamp}_{userId}          │
│  UserId: SYSTEM_USER (for global queries)                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COLLECTION: player_analytics_profile                           │
│  Purpose: Aggregated player profile with per-game breakdown     │
│  Key Format: profile                                            │
│  UserId: {actual_user_id} (for per-user queries)                │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Data Flow

```
Unity Client
    │
    ▼
quizverse_log_event (RPC)
    │
    ├──► 1. Store raw event in "analytics_events" (gameId tagged)
    │
    └──► 2. Update "player_analytics_profile" (both global + per-game)
```

---

## 4. Player Analytics Profile Schema

```javascript
{
  // ═══ IDENTITY ═══
  "userId": "uuid",
  "createdAt": "2026-04-16T00:00:00Z",
  "updatedAt": "2026-04-16T12:00:00Z",
  
  // ═══ GLOBAL AGGREGATE (All Games Combined) ═══
  "global": {
    "totalSessions": 150,
    "totalPlaytimeMinutes": 3200,
    "totalRevenue": 49.99,
    "firstSeenAt": "2025-01-01T00:00:00Z",
    "lastSeenAt": "2026-04-16T12:00:00Z",
    "gamesPlayed": ["quizverse", "lasttolive"],
    "engagementTier": "dolphin",  // whale | dolphin | minnow | dormant | churned
    "overallChurnRisk": 25
  },
  
  // ═══ PER-GAME BREAKDOWN ═══
  "games": {
    "quizverse": {
      "gameId": "126bf539-xxxx-xxxx-xxxx",
      "gameName": "quizverse",
      
      // Engagement
      "engagement": {
        "totalSessions": 100,
        "totalPlaytimeMinutes": 2500,
        "avgSessionDurationSeconds": 1500,
        "sessionsThisWeek": 5,
        "daysActiveLast7": 4,
        "daysActiveLast30": 18,
        "currentStreak": 3,
        "longestStreak": 15,
        "lastSessionAt": "2026-04-16T12:00:00Z",
        "churnRiskScore": 20
      },
      
      // Quiz Performance (QuizVerse specific)
      "quiz": {
        "totalQuizzesCompleted": 250,
        "totalQuestionsAnswered": 5000,
        "overallAccuracy": 0.72,
        "avgResponseTimeMs": 4500,
        "bestCategory": "science",
        "weakestCategory": "history",
        "difficultyPreference": "medium",
        "favoriteMode": "quick_play",
        "skillTier": "intermediate",
        "categoriesMastery": {
          "science": 85,
          "sports": 70,
          "history": 45,
          "entertainment": 60
        }
      },
      
      // Monetization
      "monetization": {
        "ltv": 29.99,
        "totalIapSpend": 24.99,
        "totalAdRevenue": 5.00,
        "purchaseCount": 3,
        "lastPurchaseAt": "2026-03-15T00:00:00Z",
        "daysSincePurchase": 32,
        "purchaseFrequency": "occasional",
        "adEngagementRate": 0.85,
        "paywallImpressions": 20,
        "paywallConversions": 2,
        "willingnessToPayScore": 65
      },
      
      // Behavior
      "behavior": {
        "preferredPlayHours": [14, 15, 20, 21],
        "preferredPlayDays": ["saturday", "sunday"],
        "avgQuestionsPerSession": 50,
        "abandonmentRate": 0.05,
        "hintUsageRate": 0.15,
        "socialEngagement": "occasional_mp",
        "featureUsage": {
          "daily_challenge": 45,
          "multiplayer": 20,
          "tournaments": 5
        }
      },
      
      // Preferences
      "preferences": {
        "favoriteCategories": ["science", "sports"],
        "avoidedCategories": ["history"],
        "difficultySweetSpot": 0.65
      },
      
      // Conversion Signals
      "conversion": {
        "daysToFirstPurchase": 14,
        "iapOffersShown": 25,
        "iapOffersConverted": 2,
        "bestConvertingOfferType": "starter_pack",
        "priceSensitivity": "medium",
        "optimalOfferTiming": "after_win"
      }
    },
    
    "lasttolive": {
      "gameId": "xxx-xxx-xxx",
      "gameName": "lasttolive",
      // ... same structure, different game-specific fields
      "engagement": { ... },
      "monetization": { ... },
      "behavior": { ... },
      // Game-specific: weapons, survival stats, etc.
      "survival": {
        "totalGamesPlayed": 50,
        "totalKills": 500,
        "avgSurvivalTimeSeconds": 300,
        "favoriteWeapon": "assault_rifle"
      }
    }
  },
  
  // ═══ COMPUTED SEGMENTS (Global) ═══
  "segments": [
    "high_value",
    "quiz_master",
    "weekend_warrior",
    "ad_engaged"
  ],
  
  // ═══ RECOMMENDATIONS (Per-Game) ═══
  "recommendations": {
    "quizverse": {
      "bestOffer": {
        "type": "discount",
        "productId": "gems_pack_medium",
        "discount": 20
      },
      "bestEngagementAction": "show_daily_challenge",
      "churnPreventionAction": null,
      "upsellOpportunity": true
    }
  }
}
```

---

## 5. New Nakama RPCs

### 5.1 RPC List

| RPC Name | Method | Description |
|----------|--------|-------------|
| `analytics_get_player_profile` | GET | Get full player profile (supports gameId filter) |
| `analytics_update_player_profile` | POST | Manual profile update (admin) |
| `analytics_get_players_by_segment` | GET | Get players in a segment |
| `analytics_get_churn_risk_players` | GET | Get players at risk of churning |
| `analytics_compute_insights` | POST | Trigger insight computation |

### 5.2 RPC: analytics_get_player_profile

**Request:**
```json
{
  "userId": "optional - defaults to caller",
  "gameId": "optional - filter by game, null = all games"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    // Full profile or filtered by gameId
  }
}
```

---

## 6. Collection Mismatch Fix (Task #1)

### 6.1 Current Problem

| Component | Writes To | Dashboard Reads From |
|-----------|-----------|---------------------|
| `quizverse_log_event` | `quizverse_analytics` | `analytics_events` ❌ |
| `quizverse_track_session_start` | `quizverse_sessions` | `analytics_sessions` ❌ |

### 6.2 Fix: Replace Game-Specific with Standard

**Files to Modify:**
- `c:\Office\Backend\nakama\data\modules\index.js` (lines 45560-45650)

**Changes:**

```javascript
// BEFORE (current code):
function quizverseLogEvent(context, logger, nk, payload) {
    var collection = getCollection(data.gameID, "analytics");  // = "quizverse_analytics"
    // ...
}

// AFTER (fixed code):
function quizverseLogEvent(context, logger, nk, payload) {
    var collection = "analytics_events";  // Standard collection
    var key = data.gameID + "_" + data.eventName + "_" + Date.now() + "_" + userId;
    // ...
}
```

**Same fix for:**
- `quizverseTrackSessionStart` → write to `analytics_sessions`
- `quizverseTrackSessionEnd` → write to `analytics_sessions`

### 6.3 Key Format Change

**Before:** `event_{userId}_{timestamp}`  
**After:** `{gameId}_{eventName}_{timestamp}_{userId}`

This allows filtering events by gameId in queries.

---

## 7. Implementation Phases

### Phase 1: Collection Mismatch Fix (✅ COMPLETED - 2026-04-16)
- [x] Update `quizverseLogEvent` to write to `analytics_events`
- [x] Update `quizverseTrackSessionStart` to write to `analytics_sessions`
- [x] Update `quizverseTrackSessionEnd` to write to `analytics_sessions`
- [x] Add backward compatibility for old sessions

### Phase 2: Player Analytics Profile (✅ COMPLETED - 2026-04-16)
- [x] Create profile schema (player_analytics_profile collection)
- [x] Implement `analytics_get_player_profile` RPC with gameId filtering
- [x] Implement `analytics_update_player_profile` RPC (admin)
- [x] Implement `analytics_get_players_by_segment` RPC
- [x] Update event handlers to also update profiles (batch mode - every 10 events)
- [x] Add force save on session end

### Phase 2.5: Unity Client Fixes (✅ COMPLETED - 2026-04-16)
- [x] Fix sessionKey bug (Unity now uses server-returned key)
- [x] Add `RpcWithRetryAndResponse` for parsing RPC responses
- [x] Add `GetPlayerAnalyticsProfile()` convenience method

### Phase 3: Dashboard gameId Filtering (Approved - Pending)
- [ ] Update dashboard RPCs to support gameId filter parameter
- [ ] Update analytics_extended.js RPCs

### Phase 4: Advanced Features (Future)
- [ ] Segment computation
- [ ] Recommendations engine
- [ ] Churn prediction
- [ ] A/B test integration

---

## 8. Questions for Approval

Before I proceed, please confirm:

| # | Question | Your Answer |
|---|----------|-------------|
| 1 | Is the schema structure above acceptable? | |
| 2 | Should LastToLive have different game-specific fields (survival stats)? | |
| 3 | Should I update the dashboard RPCs to support gameId filtering? | |
| 4 | Do you want me to start with Phase 1 (collection fix) immediately? | |
| 5 | Any fields to add/remove from the profile? | |

---

## 9. Approval

- [ ] **APPROVED** - Proceed with implementation
- [ ] **CHANGES REQUESTED** - See comments below

**Comments:**
_______________________

**Approved By:** _______________________  
**Date:** _______________________

---

*This plan will be updated based on feedback.*
