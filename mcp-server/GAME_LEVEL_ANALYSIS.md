# Game-Level Analysis: New RPCs and MCP Tools for Wow Factor

## Executive Summary

After deep analysis of every game system (QuizVerse, LastToLive, and all shared
retention/progression/social systems), there are **5 structural problems** that
prevent a wow-factor player experience:

1. **Rewards are phantom** — 6 of 7 reward systems return rewards but never grant them server-side
2. **Systems are islands** — quiz completion doesn't update achievements, season pass, mastery, or weekly goals
3. **Social is one-directional** — challenges have no accept/decline, no rivalry tracking, no "beat friend" notifications
4. **No AI-driven personalization** — every player gets the same missions, same rewards, same experience
5. **No emergent events** — no surprise moments, no dynamic live ops, no "something special is happening right now"

Below: the new RPCs and MCP tools that fix each, organized by wow-factor impact.

---

## CATEGORY 1: The Event Pipeline (fixes the "islands" problem)

### Problem
When a player completes a quiz, NOTHING ELSE HAPPENS. No achievement progress,
no season pass XP, no weekly goal update, no mastery XP, no milestone progress.
The client must manually call 6+ separate RPCs. Most don't.

### New RPC: `player_event_submit`

A single "fat event" RPC that fans out to every relevant system:

```
Request: {
  device_id, game_id, event_type, event_data
}

event_type examples:
  "quiz_complete"    → { score, category, time_ms, correct_answers, total_questions }
  "match_complete"   → { kills, survived_sec, damage, placement }
  "login"            → {}
  "purchase"         → { item_id, amount }
  "friend_added"     → { friend_id }
  "multiplayer_win"  → { opponent_count, score }

Server-side fan-out:
  1. achievements_update_progress (all matching achievements)
  2. season_pass_add_xp (calculated from event)
  3. weekly_goals_update_progress (matching goals)
  4. monthly_milestones_update_progress (matching milestones)
  5. mastery_add_xp (category XP from quiz)
  6. progressive_update_progress (feature unlock progress)
  7. daily_missions_update_progress (matching missions)
  8. collections auto-unlock check
  9. analytics_log_event (always)

Response: {
  rewards_earned: [...],     // all rewards from all systems
  achievements_unlocked: [], // newly completed
  level_ups: [],             // season pass, mastery, etc.
  collections_unlocked: [],  // new cosmetics
  streak_updated: true,
  next_milestone: {...}
}
```

### New MCP Tool: `trigger_player_event`

```
Purpose: Trigger a player event as if the player just completed an action.
         The AI agent can use this for live ops, testing, or compensating
         players who missed rewards due to bugs.

Params: device_id, game_id, event_type, event_data, reason
```

### New MCP Tool: `simulate_player_event`

```
Purpose: Dry-run a player event WITHOUT applying changes.
         Shows what rewards, achievements, level-ups WOULD happen.
         Use for testing event configurations or previewing impact.

Params: device_id, game_id, event_type, event_data
Returns: { would_earn: [...], would_unlock: [...], would_level_up: [...] }
```

### Impact
This is the #1 wow-factor change. Players suddenly feel every action matters — a
single quiz completion triggers a cascade of progress bars, unlock animations, and
reward popups across multiple systems simultaneously.

---

## CATEGORY 2: AI-Powered Personalization

### Problem
Every player gets the same 3 daily missions, same daily rewards, same season pass
quests. No adaptation to play style, skill level, or engagement pattern.

### New RPC: `get_personalized_missions`

```
Request: { device_id, game_id }

Server logic:
  1. Read player history (quiz_results, session data, achievements, categories played)
  2. Identify: preferred categories, skill level, play frequency, social activity
  3. Generate 3-5 missions tailored to the player:
     - A "comfort" mission (in their best category, easy to complete)
     - A "stretch" mission (slightly harder, new category)
     - A "social" mission (play with friends, join a group, send a challenge)
     - A "discovery" mission (try a feature they haven't used)
  4. Difficulty scales with skill level

Response: {
  missions: [
    { id, title, description, objective, target, reward, difficulty, expires_at }
  ],
  personalization_reason: "Based on your Science mastery and 5-day streak"
}
```

### New RPC: `get_smart_recommendations`

```
Request: { device_id, game_id }

Response: {
  next_best_action: "challenge_friend",   // what to do right now
  reason: "Your friend Alex just beat your Science score by 50 points",
  recommendations: [
    { type: "category", value: "History", reason: "You haven't tried History — 2x XP bonus active" },
    { type: "friend", user_id: "...", reason: "Similar skill level, both online now" },
    { type: "group", group_id: "...", reason: "Active Science enthusiasts group, 23 members" },
    { type: "tournament", id: "...", reason: "Starts in 2 hours, matches your skill range" },
    { type: "achievement", id: "...", reason: "3 more quizzes to unlock 'Science Wizard'" }
  ]
}
```

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `get_player_insights` | Deep profile: play patterns, strengths, churn risk, social connections, spending habits |
| `generate_personalized_missions` | Create custom missions for a player or segment |
| `get_smart_recommendations` | AI-driven next-best-action for a specific player |
| `set_player_difficulty` | Adjust mission/reward difficulty for a player |

### Impact
Players feel the game "knows" them. Missions feel handcrafted rather than generic.
The stretch missions push them into new content. The social missions drive viral loops.

---

## CATEGORY 3: Social Momentum (the "your friend just..." system)

### Problem
Social features are one-directional. Challenges have no accept/decline flow.
No one knows when a friend beats their score. Groups have no activity. No rivalry.

### New RPCs for QuizVerse

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `quizverse_challenge_accept` | Accept a friend challenge, create a head-to-head match | Completes the challenge loop |
| `quizverse_challenge_decline` | Decline with optional message | Social politeness |
| `quizverse_list_challenges` | See pending incoming/outgoing challenges | Engagement surface |
| `quizverse_get_rivalry` | Get head-to-head record with a friend: wins, losses, categories, streaks | "You've beaten Alex 7 times in Science!" |
| `quizverse_friend_score_alert` | Check if any friend recently beat your scores | Drives immediate re-engagement |
| `quizverse_team_quiz_create` | Create a team quiz where 2-4 friends answer together | Group play moment |
| `quizverse_daily_duo` | Paired daily challenge with a friend — both must complete for bonus | Accountability partner |

### New RPCs for LastToLive

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `lasttolive_squad_create` | Create a squad for team survival mode | Social play |
| `lasttolive_nemesis_get` | Get your "nemesis" — the player who killed you most / you killed most | Emergent narrative |
| `lasttolive_highlight_reel` | Get a player's best moments: longest survival, most kills in one match, biggest comeback | Shareable content |
| `lasttolive_revenge_match` | Challenge the player who last eliminated you | Emotional engagement |
| `lasttolive_weapon_mastery` | Track kills/damage per weapon, unlock mastery tiers | Depth of progression |

### New RPCs for Groups

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `group_challenge` | Challenge another group to a collective competition | Group vs group |
| `group_quest_create` | Create a group quest (e.g. "group members complete 100 quizzes this week") | Collective goals |
| `group_quest_progress` | Update group quest from individual events | Shared progress |
| `group_activity_feed` | Stream of group member activity (scores, achievements, challenges) | Living community |
| `group_leaderboard` | Intra-group rankings | Friendly competition |
| `group_war_start` | Multi-day war between groups with score accumulation | Guild war system |

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `find_rivalry_pairs` | Discover players with close scores who should be matched/challenged |
| `spark_social_moment` | Trigger a social event (challenge, notification) between two players the AI identifies as a good match |
| `group_health_check` | Analyze a group's activity, identify inactive members, suggest engagement actions |
| `viral_loop_trigger` | Send "your friend joined!" or "your friend beat your score!" notifications to drive re-engagement |
| `create_team_event` | Set up a team-based event for a group or set of friends |

### Impact
The game becomes a living social space. Players check back because "Alex challenged me"
or "my group is in a war." Rivalry tracking creates emergent narratives that players
talk about outside the game.

---

## CATEGORY 4: Dynamic Live Ops (surprise and delight)

### Problem
Nothing unexpected ever happens. No flash events, no surprise bonuses, no "limited
time only" moments. The game is predictable.

### New RPCs

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `flash_event_create` | Create a time-limited event (2-hour double XP, surprise tournament, bonus category) | Urgency and excitement |
| `flash_event_list_active` | List currently active flash events | FOMO driver |
| `mystery_box_grant` | Grant a mystery box with weighted random rewards | Gacha dopamine |
| `mystery_box_open` | Open a mystery box, reveal contents with rarity | Unboxing moment |
| `daily_spotlight` | Featured content that changes every day (featured category, featured player, featured group) | Fresh content daily |
| `streak_milestone_celebrate` | Triggered at streak milestones (7, 30, 100 days) with special rewards and shareable badge | Achievement moments |
| `comeback_surprise` | When a churned player returns, trigger a dramatic welcome-back sequence | Emotional reconnection |
| `lucky_draw_enter` | Enter a daily lucky draw (1 winner per day gets a major prize) | Lottery excitement |
| `happy_hour_status` | Check if happy hour is active (random 1-hour window with 3x rewards) | Unpredictability |

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `create_flash_event` | Spin up a surprise event targeting specific segments |
| `grant_mystery_box` | Give mystery boxes to players (individually or in bulk) |
| `set_happy_hour` | Activate/deactivate happy hour with custom multiplier |
| `create_daily_spotlight` | Set today's featured category, player, or group |
| `schedule_streak_celebration` | Set up milestone celebrations for streak thresholds |
| `run_lucky_draw` | Execute a lucky draw across eligible players |
| `get_live_ops_calendar` | View all scheduled and active events |

### Impact
Players never know what will happen when they open the game. "Is happy hour on?"
"Did I win the lucky draw?" "There's a flash tournament in my best category!"
Unpredictability is the most powerful retention lever in mobile gaming.

---

## CATEGORY 5: Reward System Fix (make rewards real)

### Problem
6 of 7 reward-granting systems are broken — they return rewards but never apply
them. Daily rewards says "you earned 200 tokens" but the wallet never changes.

### New RPCs (fix existing ones)

| System | Current state | Fix |
|--------|--------------|-----|
| `daily_rewards_claim` | Returns `tokens`, `xp`; doesn't grant | Add `nk.walletUpdate` call |
| `claim_mission_reward` | Returns `xp`, `tokens`; doesn't grant | Add wallet update + XP grant |
| `weekly_goals_claim_reward` | Returns `coins`, `gems`; doesn't grant | Add wallet update |
| `weekly_goals_claim_bonus` | Returns bonus reward; doesn't grant | Add wallet update |
| `monthly_milestones_claim_reward` | Returns coins, badges; doesn't grant | Add wallet + collections update |
| `monthly_milestones_claim_legendary` | Returns legendary rewards; doesn't grant | Add wallet + collections |
| `winback_claim_rewards` | Returns comeback bundle; doesn't grant | Add wallet + inventory + collections |
| `season_pass_claim_reward` | Returns level reward; doesn't grant | Add wallet + inventory |

### New RPC: `rewards_pending`

```
Request: { device_id, game_id }

Response: {
  unclaimed: [
    { source: "daily_reward", reward: {...}, claimable: true },
    { source: "daily_mission", id: "m1", reward: {...}, claimable: true },
    { source: "weekly_goal", day: 3, reward: {...}, claimable: true },
    { source: "season_pass", level: 12, reward: {...}, claimable: true },
    { source: "achievement", id: "a1", reward: {...}, claimable: true },
    { source: "streak_milestone", streak: 30, reward: {...}, claimable: true }
  ],
  total_unclaimed_value: { coins: 1500, gems: 50, xp: 800, items: 3 }
}
```

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `check_pending_rewards` | See all unclaimed rewards across all systems for a player |
| `force_grant_rewards` | Admin: grant pending rewards that were missed due to bugs |
| `reward_audit` | Compare what rewards were shown vs actually granted for a player |

### Impact
Rewards actually land. Players see their wallet grow after every claim.
The pending rewards tool creates a "gift pile" effect that draws players back.

---

## CATEGORY 6: Cross-Game Synergy

### Problem
QuizVerse and LastToLive are separate islands. A player's progress in one game
has zero impact on the other. The global wallet exists but isn't leveraged.

### New RPCs

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `cross_game_bonus` | Earn a bonus in Game B for activity in Game A | Cross-pollination |
| `cross_game_profile` | Unified player card showing stats across all games | Identity continuity |
| `cross_game_challenge` | "Beat me at QuizVerse AND LastToLive" composite challenge | Multi-game engagement |
| `global_season_pass` | Season pass that spans all games with unified XP | Meta-progression |
| `game_discovery_reward` | First-time reward for trying a new game in the platform | Discovery incentive |

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `cross_game_analysis` | Compare a player's engagement across games |
| `cross_promote` | Send targeted "try this game" nudges based on play patterns |
| `global_leaderboard_composite` | Combined ranking across all games |

---

## CATEGORY 7: QuizVerse-Specific Wow Features

### New RPCs for deep quiz engagement

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `quizverse_knowledge_map` | Visual map of what the player knows: strong/weak categories, coverage % | "I know 73% of Science!" |
| `quizverse_streak_quiz` | Endless mode: answer correctly to extend streak, one wrong = done | High-tension gameplay |
| `quizverse_adaptive_difficulty` | Questions get harder as you answer correctly, easier when wrong | Flow state optimization |
| `quizverse_daily_puzzle` | One special puzzle per day, unique for everyone, leaderboard for fastest solve | Daily ritual |
| `quizverse_category_war` | Two categories compete: players choose a side, answers score for their category | Faction engagement |
| `quizverse_knowledge_duel` | Real-time head-to-head quiz with live scoring | Competitive thrill |
| `quizverse_study_mode` | Review wrong answers with explanations, track improvement | Learning + retention |
| `quizverse_trivia_night` | Scheduled event (e.g. Friday 8pm): live trivia with thousands of players | Appointment viewing |

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `analyze_quiz_performance` | Deep analysis of a player's quiz history: accuracy by category, improvement trends, time patterns |
| `generate_adaptive_quiz` | Create a quiz tailored to a player's weak areas |
| `schedule_trivia_night` | Set up a scheduled live trivia event |
| `create_category_war` | Launch a category war event |
| `knowledge_gap_report` | For a player or cohort: which categories need more content? |

---

## CATEGORY 8: LastToLive-Specific Wow Features

### New RPCs for deep survival engagement

| RPC | What it does | Wow factor |
|-----|-------------|------------|
| `lasttolive_battle_pass` | Game-specific battle pass with weapon skins, kill effects | Aspiration content |
| `lasttolive_loadout_save` | Save/load weapon loadouts | Customization depth |
| `lasttolive_kill_feed` | Get recent server-wide notable kills (longest range, most kills, etc.) | Community spectacle |
| `lasttolive_bounty_create` | Put a bounty on a player — whoever eliminates them gets bonus | Emergent gameplay |
| `lasttolive_zone_event` | Dynamic zone events during matches (supply drops, hazard zones) | Unpredictable matches |
| `lasttolive_clan_war` | Scheduled clan vs clan survival mode | Organized competition |
| `lasttolive_replay_save` | Save match replay data for sharing | Content creation |
| `lasttolive_weapon_unlock` | Unlock weapons through kills/damage milestones, not just purchase | Earned progression |

### New MCP Tools

| Tool | Purpose |
|------|---------|
| `analyze_combat_stats` | Deep analysis of a player's combat performance: K/D, weapon preferences, survival times |
| `create_bounty_event` | AI-driven bounty system targeting active players |
| `schedule_clan_war` | Set up organized clan vs clan events |
| `balance_check` | Analyze weapon stats vs usage data to identify balance issues |

---

## Priority Matrix

| Priority | Category | New RPCs | New MCP Tools | Effort | Wow Factor |
|----------|----------|----------|---------------|--------|------------|
| **P0** | Event Pipeline | 1 (but massive) | 2 | High | Highest — makes everything else work |
| **P0** | Reward Fix | 8 fixes + 1 new | 3 | Medium | Highest — rewards actually work |
| **P1** | Social Momentum | 12 | 5 | High | Very high — social = retention |
| **P1** | Dynamic Live Ops | 9 | 7 | Medium | Very high — unpredictability |
| **P1** | AI Personalization | 2 | 4 | High | Very high — "game knows me" |
| **P2** | QuizVerse-Specific | 8 | 5 | High | High — deep engagement |
| **P2** | LastToLive-Specific | 8 | 4 | High | High — deep engagement |
| **P3** | Cross-Game Synergy | 5 | 3 | Medium | Medium — platform value |

---

## Total New RPCs and MCP Tools

| Type | Count |
|------|-------|
| New RPCs needed | ~54 |
| Existing RPCs to fix | ~8 |
| New MCP tools to build | ~33 |
| **Total new surface area** | **~95** |

---

## What to Build First (Recommended Order)

### Sprint 1: Foundation (1-2 weeks)
1. Fix all 8 reward-granting RPCs to actually grant rewards server-side
2. Build `player_event_submit` — the central event pipeline
3. Build `rewards_pending` — the "gift pile" API
4. Add MCP tools: `trigger_player_event`, `simulate_player_event`, `check_pending_rewards`

### Sprint 2: Social (1-2 weeks)
5. Build challenge accept/decline/list flow for both games
6. Build rivalry tracking (`get_rivalry`, `nemesis_get`)
7. Build friend score alerts
8. Build group quests and group activity feed
9. Add MCP tools: `find_rivalry_pairs`, `spark_social_moment`, `group_health_check`

### Sprint 3: Live Ops (1 week)
10. Build flash events, mystery boxes, happy hour
11. Build streak celebrations
12. Add MCP tools: `create_flash_event`, `grant_mystery_box`, `set_happy_hour`

### Sprint 4: Personalization (1-2 weeks)
13. Build `get_personalized_missions`
14. Build `get_smart_recommendations`
15. Build knowledge map (QuizVerse) and combat stats (LastToLive)
16. Add MCP tools: `get_player_insights`, `generate_personalized_missions`

### Sprint 5: Game-Specific Depth (2 weeks)
17. Build QuizVerse: streak quiz, daily puzzle, trivia night, knowledge duel
18. Build LastToLive: weapon mastery, bounties, loadouts, clan wars
19. Add game-specific MCP tools
