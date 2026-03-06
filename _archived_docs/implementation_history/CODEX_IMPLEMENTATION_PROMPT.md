# CODEX/COPILOT PROMPT FOR NAKAMA SERVER GAP IMPLEMENTATION

## 🎯 OBJECTIVE
Implement the remaining features for a production-ready multi-game Nakama backend platform that supports game-specific isolation via gameID. Fill all identified server gaps with production-quality code following established patterns.

---

## 📋 CONTEXT

### Platform Architecture
- **Server**: Nakama 3.x with JavaScript V8 runtime
- **Language**: JavaScript (ES5 compatible, no ES6 modules)
- **Multi-Game System**: UUID-based gameID isolation
- **Storage Pattern**: Collections namespaced by gameID (e.g., `{gameID}_profiles`)
- **RPC Pattern**: All functions prefixed with game name or generic

### Current Status
✅ **Production Ready**: Authentication, Wallet System, Leaderboards, Daily Rewards, Cloud Save
⚠️ **Partially Complete**: Daily Missions (needs enhancement)
❌ **Missing**: Achievements, Matchmaking, Tournaments, Seasons/Battle Pass, Events, Infrastructure improvements

---

## 🔨 IMPLEMENTATION TASKS

### Task 1: Achievement System
**Files to Complete**:
- `/nakama/data/modules/achievements/achievements.js` (template provided)
- `/nakama/data/modules/achievements/achievement_definitions.js` (create)
- `/nakama/data/modules/achievements/achievement_templates.js` (create)

**Requirements**:
1. Implement all RPC functions defined in `achievements.js`
2. Add achievement templates for common game achievements:
   - Kill/defeat enemies (incremental)
   - Win matches (incremental)
   - Collect items (incremental)
   - Complete levels (simple)
   - Secret achievements (hidden)
3. Create achievement definition templates for QuizVerse and LastToLive games
4. Implement reward granting system that integrates with existing wallet system
5. Add achievement progress tracking with proper storage isolation per gameID
6. Support for achievement tiers (bronze, silver, gold, platinum)

**Example Achievements for QuizVerse**:
```javascript
{
  achievement_id: "quizmaster_100",
  title: "Quiz Master",
  description: "Answer 100 questions correctly",
  type: "incremental",
  target: 100,
  rarity: "epic",
  rewards: { coins: 1000, xp: 500 }
}
```

**RPCs to Implement**:
- `achievements_get_all` ✓ (template provided)
- `achievements_update_progress` ✓ (template provided)
- `achievements_create_definition` ✓ (template provided)
- `achievements_bulk_create` ✓ (template provided)
- `achievements_get_by_category` (new)
- `achievements_get_player_stats` (new)

---

### Task 2: Matchmaking System
**Files to Complete**:
- `/nakama/data/modules/matchmaking/matchmaking.js` (template provided)
- `/nakama/data/modules/matchmaking/skill_rating.js` (create)
- `/nakama/data/modules/matchmaking/party_system.js` (create)

**Requirements**:
1. Implement ELO/MMR rating system with skill-based matching
2. Support multiple queue types per game (solo, duo, squad)
3. Implement party/squad system for group matchmaking
4. Add matchmaking ticket management with status tracking
5. Implement match history storage and analytics
6. Support custom matchmaking properties per game
7. Add skill range expansion over time (widen search after 30s, 60s, etc.)

**ELO System**:
```javascript
// Calculate new rating after match
function calculateNewRating(currentRating, opponentRating, won) {
  var K = 32; // K-factor
  var expectedScore = 1 / (1 + Math.pow(10, (opponentRating - currentRating) / 400));
  var actualScore = won ? 1 : 0;
  return currentRating + K * (actualScore - expectedScore);
}
```

**RPCs to Implement**:
- `matchmaking_find_match` ✓ (template provided)
- `matchmaking_cancel` ✓ (template provided)
- `matchmaking_get_status` ✓ (template provided)
- `matchmaking_create_party` ✓ (template provided)
- `matchmaking_join_party` ✓ (template provided)
- `matchmaking_leave_party` (new)
- `matchmaking_get_queue_stats` (new)
- `matchmaking_update_skill_rating` (new)
- `matchmaking_get_match_history` (new)

---

### Task 3: Tournament System
**Files to Complete**:
- `/nakama/data/modules/tournaments/tournaments.js` (template provided)
- `/nakama/data/modules/tournaments/tournament_brackets.js` (create)
- `/nakama/data/modules/tournaments/tournament_prizes.js` (create)

**Requirements**:
1. Support both leaderboard and bracket tournament formats
2. Implement automatic bracket generation for bracket tournaments
3. Add entry fee system with wallet integration
4. Implement prize distribution system
5. Support recurring tournaments (daily, weekly, monthly)
6. Add tournament state machine (upcoming -> registration -> active -> ended -> rewards_distributed)
7. Implement automatic tournament lifecycle management

**Tournament Formats**:
- **Leaderboard**: Players compete for highest score over duration
- **Bracket**: Single/double elimination brackets
- **Swiss**: Round-robin style (advanced)

**RPCs to Implement**:
- `tournament_create` ✓ (template provided)
- `tournament_join` ✓ (template provided)
- `tournament_list_active` ✓ (template provided)
- `tournament_submit_score` ✓ (template provided)
- `tournament_get_leaderboard` ✓ (template provided)
- `tournament_claim_rewards` ✓ (template provided)
- `tournament_leave` (new)
- `tournament_get_bracket` (new)
- `tournament_get_my_tournaments` (new)
- `tournament_get_past_results` (new)

---

### Task 4: Season/Battle Pass System
**Files to Create**:
- `/nakama/data/modules/seasons/seasons.js`
- `/nakama/data/modules/seasons/season_rewards.js`
- `/nakama/data/modules/seasons/season_xp.js`

**Requirements**:
1. Implement seasonal progression system with XP tracking
2. Support free and premium reward tracks
3. Add tier-based rewards (level 1-100)
4. Implement XP sources (match completion, achievements, daily quests)
5. Support season-specific missions and challenges
6. Add season reset functionality
7. Implement retroactive reward claiming for premium purchases

**Season Structure**:
```javascript
{
  season_id: "season_1_quizverse",
  game_id: "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  title: "Season 1: Knowledge Warriors",
  start_time: "2025-01-01T00:00:00Z",
  end_time: "2025-03-31T23:59:59Z",
  max_tier: 100,
  free_rewards: {
    1: { coins: 100 },
    5: { coins: 250, items: ["common_badge"] },
    10: { coins: 500, items: ["rare_skin"] }
  },
  premium_rewards: {
    1: { coins: 200, items: ["premium_badge"] },
    5: { coins: 500, items: ["epic_skin"] },
    10: { coins: 1000, items: ["legendary_skin"] }
  }
}
```

**RPCs to Implement**:
- `season_get_active`
- `season_get_player_progress`
- `season_grant_xp`
- `season_claim_tier_rewards`
- `season_purchase_premium`
- `season_get_all_rewards`
- `season_create` (Admin)

---

### Task 5: Events System
**Files to Create**:
- `/nakama/data/modules/events/events.js`
- `/nakama/data/modules/events/event_missions.js`
- `/nakama/data/modules/events/event_rewards.js`

**Requirements**:
1. Support time-limited events with custom rules
2. Implement event-specific missions and challenges
3. Add event leaderboards with special rewards
4. Support multiple concurrent events
5. Implement event progression tracking
6. Add event notifications and announcements
7. Support recurring events (weekend events, holiday events)

**Event Types**:
- **Double XP**: Multiplier events
- **Limited Time Challenges**: Special missions
- **Community Goals**: Server-wide objectives
- **Special Tournaments**: Event-specific competitions

**RPCs to Implement**:
- `event_get_active_events`
- `event_get_player_progress`
- `event_complete_mission`
- `event_claim_rewards`
- `event_get_leaderboard`
- `event_create` (Admin)
- `event_end` (Admin)

---

### Task 6: Infrastructure Improvements

#### 6A: Batch Operations (CRITICAL)
**File**: `/nakama/data/modules/infrastructure/batch_operations.js` (template provided)

**Complete**:
- `rpcBatchExecute` ✓ (template provided)
- `rpcBatchWalletOperations` ✓ (template provided)
- `rpcBatchAchievementProgress` ✓ (template provided)

**Add New**:
- `batch_leaderboard_submissions` - Submit scores to multiple leaderboards
- `batch_read_storage` - Read multiple storage records efficiently
- `batch_write_storage` - Write multiple storage records in transaction

#### 6B: Rate Limiting (CRITICAL)
**File**: `/nakama/data/modules/infrastructure/rate_limiting.js` (template provided)

**Complete**:
- `checkRateLimit` ✓ (template provided)
- `withRateLimit` ✓ (template provided)
- `rpcRateLimitStatus` ✓ (template provided)

**Integration Required**:
Apply rate limiting to all write RPCs:
```javascript
initializer.registerRpc('submit_score', withPresetRateLimit(rpcSubmitScore, 'submit_score', 'WRITE'));
initializer.registerRpc('update_wallet_balance', withPresetRateLimit(rpcUpdateWalletBalance, 'update_wallet_balance', 'WRITE'));
```

#### 6C: Caching Layer (PERFORMANCE)
**File**: `/nakama/data/modules/infrastructure/caching.js` (template provided)

**Complete**:
- `cacheGet`, `cacheSet` ✓ (template provided)
- `rpcCacheStats` ✓ (template provided)
- `rpcCacheClear` ✓ (template provided)

**Integration Required**:
Add caching to frequently-read RPCs:
```javascript
var cachedGetLeaderboard = withCache(
  rpcGetLeaderboard,
  'get_leaderboard',
  CacheConfig.LEADERBOARD,
  CacheKeyGenerators.leaderboardKey
);
```

#### 6D: Metrics & Analytics
**File**: `/nakama/data/modules/infrastructure/metrics.js` (create)

**Requirements**:
1. Track RPC call counts and latency
2. Monitor storage read/write operations
3. Track matchmaking queue times
4. Monitor concurrent users per game
5. Track revenue metrics (IAP, tournament entries)

**RPCs to Implement**:
- `metrics_get_summary`
- `metrics_get_rpc_stats`
- `metrics_get_game_stats`
- `metrics_export` (Admin)

---

## 🏗️ INTEGRATION CHECKLIST

### Step 1: Module Loading
Update `/nakama/data/modules/index.js`:

```javascript
// Add after existing imports
// Load new modules
var achievementsModule = require('achievements/achievements.js');
var matchmakingModule = require('matchmaking/matchmaking.js');
var tournamentsModule = require('tournaments/tournaments.js');
var seasonsModule = require('seasons/seasons.js');
var eventsModule = require('events/events.js');
var batchModule = require('infrastructure/batch_operations.js');
var rateLimitModule = require('infrastructure/rate_limiting.js');
var cacheModule = require('infrastructure/caching.js');
var metricsModule = require('infrastructure/metrics.js');
```

**Note**: Nakama V8 runtime doesn't support ES6 `require`. Use inline code or runtime module loading.

### Step 2: RPC Registration
All new RPCs are registered in `InitModule` function. See template in `index.js`.

### Step 3: Testing Each System
Create test scripts in `/nakama/tests/`:
- `test_achievements.js`
- `test_matchmaking.js`
- `test_tournaments.js`
- `test_seasons.js`
- `test_events.js`
- `test_infrastructure.js`

### Step 4: Documentation
Update `/nakama/docs/COMPLETE_RPC_REFERENCE.md` with all new RPCs.

---

## 🔐 SECURITY REQUIREMENTS

1. **Input Validation**: Validate all RPC payloads
2. **Authorization**: Check user permissions for admin RPCs
3. **Rate Limiting**: Apply to all write operations
4. **Anti-Cheat**: Validate scores and progression server-side
5. **GameID Isolation**: Ensure all data is scoped to correct gameID
6. **Sanitization**: Sanitize user-generated content (names, chat)

---

## 📊 PERFORMANCE REQUIREMENTS

1. **RPC Latency**: < 100ms for read operations, < 200ms for writes
2. **Leaderboard Reads**: Support 10,000+ entries efficiently
3. **Concurrent Users**: Support 1000+ CCU per game
4. **Storage Efficiency**: Use batch operations where possible
5. **Caching**: Cache frequently-accessed data (leaderboards, definitions)
6. **Matchmaking**: Queue times < 30 seconds for populated queues

---

## 🧪 TESTING STRATEGY

### Unit Tests
Test each RPC independently:
```javascript
// Example test for achievement unlock
var result = nk.rpcHttp(ctx, 'achievements_update_progress', JSON.stringify({
  game_id: QUIZ_VERSE_GAME_ID,
  achievement_id: 'first_win',
  progress: 1
}));

var data = JSON.parse(result);
assert(data.success === true);
assert(data.achievement.unlocked === true);
```

### Integration Tests
Test feature combinations:
- Achievement unlocks granting currency
- Tournament entry fees deducting from wallet
- Season XP grants from achievements
- Matchmaking with skill-based rating updates

### Load Tests
- 100 concurrent matchmaking requests
- 1000 concurrent leaderboard reads
- 100 achievement unlocks per second
- 50 tournament score submissions per second

---

## 📝 IMPLEMENTATION PRIORITY

### Phase 1 (Week 1): Critical Systems
1. ✅ Achievement System (Core + Templates)
2. ✅ Infrastructure (Batch + Rate Limiting + Caching)
3. ✅ Matchmaking (Basic skill-based)

### Phase 2 (Week 2): Competitive Features
4. ✅ Tournament System (Leaderboard format)
5. ⚠️ Tournament Brackets (Advanced)
6. ⚠️ Matchmaking Parties

### Phase 3 (Week 3): Live Ops
7. ⚠️ Season/Battle Pass System
8. ⚠️ Events System
9. ⚠️ Metrics & Analytics

### Phase 4 (Week 4): Polish & Testing
10. ⚠️ Integration testing
11. ⚠️ Load testing
12. ⚠️ Documentation updates
13. ⚠️ Unity SDK updates

---

## 🎮 GAME-SPECIFIC TEMPLATES

### QuizVerse Achievements
```javascript
var QUIZVERSE_ACHIEVEMENTS = [
  {
    achievement_id: "first_correct_answer",
    title: "Getting Started",
    description: "Answer your first question correctly",
    type: "simple",
    target: 1,
    rarity: "common",
    rewards: { coins: 50, xp: 25 }
  },
  {
    achievement_id: "quiz_streak_10",
    title: "Streak Master",
    description: "Get a 10 question streak",
    type: "incremental",
    target: 10,
    rarity: "rare",
    rewards: { coins: 500, xp: 250 }
  },
  {
    achievement_id: "category_master_science",
    title: "Science Genius",
    description: "Answer 100 science questions correctly",
    type: "incremental",
    target: 100,
    rarity: "epic",
    rewards: { coins: 2000, xp: 1000, badge: "science_badge" }
  }
];
```

### LastToLive Achievements
```javascript
var LASTTOLIVE_ACHIEVEMENTS = [
  {
    achievement_id: "first_kill",
    title: "First Blood",
    description: "Eliminate your first opponent",
    type: "simple",
    target: 1,
    rarity: "common",
    rewards: { coins: 50, xp: 25 }
  },
  {
    achievement_id: "win_100_matches",
    title: "Century Victor",
    description: "Win 100 matches",
    type: "incremental",
    target: 100,
    rarity: "legendary",
    rewards: { coins: 10000, xp: 5000, title: "Century Victor" }
  },
  {
    achievement_id: "solo_squad_wipe",
    title: "One Man Army",
    description: "Eliminate an entire squad solo",
    type: "simple",
    target: 1,
    rarity: "epic",
    hidden: true,
    rewards: { coins: 5000, xp: 2500, badge: "army_badge" }
  }
];
```

---

## 🚀 DEPLOYMENT STEPS

1. **Backup Current Server**:
   ```bash
   cp -r /nakama/data/modules /nakama/data/modules.backup
   ```

2. **Deploy New Modules**:
   - Copy all new `.js` files to `/nakama/data/modules/`
   - Update `index.js` with new registrations

3. **Restart Nakama Server**:
   ```bash
   docker-compose restart nakama
   ```

4. **Verify Deployment**:
   ```bash
   # Check server logs
   docker-compose logs -f nakama | grep "Registered RPC"
   
   # Expected output:
   # [Achievements] Successfully registered 6 Achievement RPCs
   # [Matchmaking] Successfully registered 9 Matchmaking RPCs
   # [Tournament] Successfully registered 10 Tournament RPCs
   # [Seasons] Successfully registered 7 Season RPCs
   # [Events] Successfully registered 7 Event RPCs
   # [Infrastructure] Successfully registered 9 Infrastructure RPCs
   ```

5. **Initialize Game Data**:
   ```bash
   # Create achievement definitions for games
   curl -X POST http://localhost:7350/v2/rpc/achievements_bulk_create \
     -H "Authorization: Bearer $TOKEN" \
     -d @quizverse_achievements.json
   ```

---

## 📚 ADDITIONAL RESOURCES

- **Nakama Docs**: https://heroiclabs.com/docs/nakama/concepts/
- **JavaScript Runtime**: https://heroiclabs.com/docs/nakama/server-framework/javascript-runtime/
- **Storage API**: https://heroiclabs.com/docs/nakama/concepts/storage/
- **Leaderboards API**: https://heroiclabs.com/docs/nakama/concepts/leaderboards/
- **Matchmaker API**: https://heroiclabs.com/docs/nakama/concepts/matches/

---

## ✅ COMPLETION CRITERIA

- [ ] All 48+ new RPCs implemented and tested
- [ ] Achievement definitions created for QuizVerse and LastToLive
- [ ] Matchmaking system handling 100+ concurrent users
- [ ] Tournament system with automatic lifecycle management
- [ ] Season/Battle Pass system with XP and rewards
- [ ] Events system with missions and leaderboards
- [ ] Batch operations reducing API calls by 70%
- [ ] Rate limiting preventing abuse on all write RPCs
- [ ] Caching reducing database load by 50%
- [ ] Metrics tracking all critical operations
- [ ] Integration tests passing at 95%+
- [ ] Load tests meeting performance requirements
- [ ] Documentation complete and accurate
- [ ] Unity SDK updated with new manager classes

---

## 💬 SUCCESS METRICS

After implementation, track:
- **API Response Time**: Should improve by 30-50% with caching
- **Database Load**: Should reduce by 40-60% with batch operations
- **User Engagement**: Achievements should increase session length by 20%+
- **Matchmaking Quality**: 80%+ of matches within 200 ELO difference
- **Tournament Participation**: 30%+ of DAU joining tournaments
- **Season Completion**: 15%+ of users reaching tier 100

---

**END OF CODEX PROMPT**

Copy this entire prompt to Cursor/Copilot/Claude and start with:
"Implement all missing Nakama server features following this specification, starting with Phase 1 systems."
