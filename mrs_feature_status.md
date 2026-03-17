# QuizVerse MRS — Complete Feature Status Matrix

> **Audited**: 2026-03-17 · Client: `quiz-verse/Assets/` · Backend: `nakama/data/modules/`

## Legend

| Icon | Meaning |
|------|---------|
| ✅ | **Done** — Script exists + Backend RPC registered + Wired |
| 🟡 | **Partial** — Script exists but missing backend or not fully wired |
| ❌ | **Not Started** — Script does not exist |
| 🔵 | **Backend Only** — Module file exists, RPC not registered |
| ⬜ | **Future Phase** — Not expected to exist yet |

---

## Part A — Foundation & Architecture (Phase 0)

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 1 | **ProgressionEventRouter** (fan-out hub) | [ProgressionEventRouter.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Core/ProgressionEventRouter.cs) | ✅ Exists | N/A (orchestrator) | N/A | 0 ✅ |
| 2 | **Phase 0 Dedup — Badge authority** | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) (kept) · [AchievementManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Retention/AchievementManager.cs) (legacy) | 🟡 Both exist | `badges/badges.js` | 🔵 Module exists | 0 🟡 |
| 3 | **Phase 0 Dedup — XP authority** | [XPManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Progression/XPManager.cs) (cache) · `IVXProgressionSystem` not found | 🟡 XPManager only | Hiro (SDK) | 🟡 | 0 🟡 |
| 4 | **Phase 0 Dedup — Leaderboard authority** | `QVNLeaderboard.cs` (kept) · [LeaderboardManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/GameModes/LeaderboardManager.cs) (legacy) | 🟡 Both exist | [leaderboard.js](file:///C:/Office/Backend/nakama/data/modules/leaderboard.js) | ✅ | 0 🟡 |
| 5 | **Phase 0 Dedup — Daily Rewards** | [IVXDailyRewardsManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_IntelliVerseXSDK/Monetization/IVXDailyRewardsManager.cs) (SDK, kept) | ✅ Exists | [daily_rewards.js](file:///C:/Office/Backend/nakama/data/modules/daily_rewards/daily_rewards.js) | ✅ | 0 ✅ |

---

## Part B — Core Engagement (Phase 1A–2)

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 6 | **90s Onboarding** | `OnboardingManager.cs` / flow | 🟡 Partial | `onboarding/onboarding.js` | ✅ Module exists | 1A |
| 7 | **Streak System** | [StreakShieldManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Retention/StreakShieldManager.cs) | ✅ Exists | PlayerPrefs + Nakama sync | 🟡 | 1A |
| 8 | **Streak Dashboard UI** | [StreakDashboardScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Retention/StreakDashboardScreen.cs) | ✅ Exists | — | — | 1A |
| 9 | **Quizzy 7 Emotional States** | [AutoCurioManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Characters/AutoCurioManager.cs) | ✅ Exists | — (client-only) | N/A | 1A |
| 10 | **XP & Level Progression** | [XPManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Progression/XPManager.cs) (read cache) | ✅ Exists | Hiro SDK (server) | 🟡 | 1A |
| 11 | **Category Mastery** | [MasteryManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Progression/MasteryManager.cs) | ✅ Exists | `progression/mastery_system.js` | ✅ Module | 1A |
| 12 | **Feature Unlocks** | [ProgressiveUnlockManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Progression/ProgressiveUnlockManager.cs) | ✅ Exists | `progression/progressive_unlocks.js` | ✅ Module | 1A |
| 13 | **Badge System (56 badges)** | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) | ✅ Exists | `badges/badges.js` | 🔵 Module | 1A |
| 14 | **Wallet / Economy** | [IVXWalletManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_IntelliVerseXSDK/Backend/IVXWalletManager.cs) (SDK) | ✅ Exists | Hiro economy | ✅ | 1A |
| 15 | **Smart Review (SM-2)** | [SmartReviewManager.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/SmartReview/SmartReviewManager.cs) | ✅ Exists | `smart_review` RPCs | ❌ Not registered | 2 |
| 16 | **4 Review Modes** | SmartReview UI (Flash/Quiz/Audio/RapidFire) | 🟡 Partial | Same as above | ❌ | 2 |

---

## Part C — Badge System

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 17 | **22 Tiered Badges** | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) | ✅ Definitions | [badges.js](file:///C:/Office/Backend/nakama/data/modules/badges/badges.js) configs | 🟡 | 1A |
| 18 | **22 Achievement Badges** | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) | ✅ Definitions | Same | 🟡 | 1A |
| 19 | **10 Legendary Badges** (7+3) | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) | 🟡 7 exist, 3 Phase 6 | Same | 🟡 | 1A+6 |
| 20 | **5 Seasonal Badges** | [BadgeService.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Badges/BadgeService.cs) | 🟡 Definitions | Same | 🟡 | 4 |

---

## Part D — Characters, Competition & Social (Phase 1B–3)

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 21 | **12 Characters** | [CharacterManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Characters/CharacterManager.cs) | ✅ Exists | [characters/characters.js](file:///C:/Office/Backend/nakama/data/modules/characters/characters.js) (16 chars) | ✅ Registered | 1A–5 |
| 22 | **Character Select Screen** | [CharacterSelectScreen.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/UI/Screens/CharacterSelectScreen.cs) | ✅ Exists | Same | ✅ | 1A |
| 23 | **Character on Home Screen** | [HomeScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/UI/Screens/HomeScreen.cs) (mascot) | ✅ Wired | Same | ✅ | 1A |
| 24 | **Character on Profile** | [ProfileScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/UI/Screens/ProfileScreen.cs) | ✅ Wired | Same | ✅ | 1A |
| 25 | **Character Unlock Bridge** | [CharacterUnlockBridge.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Characters/CharacterUnlockBridge.cs) | ✅ In scene | Same | ✅ | 1A |
| 26 | **6-Tier League System** | [LeagueManager.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Competition/LeagueManager.cs) | ✅ Exists | [leagues/leagues.js](file:///C:/Office/Backend/nakama/data/modules/leagues/leagues.js) (4 RPCs) | ✅ Registered | 1B |
| 27 | **League Screen UI** | [LeagueScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Competition/LeagueScreen.cs) | ✅ Exists | Same | ✅ | 1B |
| 28 | **League Point Submission** | `ProgressionEventRouter.FanOut_LeagueManager` | ✅ Wired | `league_submit_points` | ✅ | 1B |
| 29 | **Anti-Sandbagging** | [LeagueManager.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Competition/LeagueManager.cs) | 🟡 Client side | [leagues.js](file:///C:/Office/Backend/nakama/data/modules/leagues/leagues.js) (highest_tier) | 🟡 Server partial | 1B |
| 30 | **Streak Wager (Day 10+)** | — | ❌ Not found | — | ❌ | 1B |
| 31 | **Friend System** | [QVNFriendsManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Friends/Nakama/QVNFriendsManager.cs) | ✅ Exists | `friends/friends.js` | ✅ Module | 3 |
| 32 | **Friends Screen** | [FriendsScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/UI/Screens/FriendsScreen.cs) | ✅ Exists | Same | ✅ | 3 |
| 33 | **Friend Streaks** | [FriendStreakManager.cs](file:///c:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Social/FriendStreakManager.cs) | ✅ Exists | `friend_streak` RPCs | ❌ Not registered | 3 |
| 34 | **4 Friend Quests** | — | ❌ Not started | — | ❌ | 3 |
| 35 | **Nudge System** | — | ❌ Not found | — | ❌ | 3 |
| 36 | **Notification Gate** | [NotificationGateService.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Services/NotificationGateService.cs) | ✅ Exists | `notifications/notification_gate.js` | 🔵 Module | 1A |
| 37 | **Cosmetics (Frames/Titles)** | [CosmeticsManager.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/Cosmetics/CosmeticsManager.cs) · [CosmeticsShopScreen.cs](file:///C:/Office/Unity/intelliverse-x-games-platform-2/games/quiz-verse/Assets/_QuizVerse/Scripts/UI/Screens/CosmeticsShopScreen.cs) | ✅ Exists | — | 🟡 | 1A |

---

## Part E — Topic Identity (Phase 6) ⬜

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 38 | **TopicRankManager** | — | ❌ Not created | `topic_rank_*` RPCs | ❌ Not registered | 6A |
| 39 | **12 Topic Configs** | — | ❌ | `topic_config` storage | ❌ | 6A |
| 40 | **60 Topic Badges** | — | ❌ | — | ❌ | 6B |
| 41 | **3 Cross-Topic Legendaries** | — | ❌ | — | ❌ | 6B |
| 42 | **Topic Leagues** | — | ❌ | — | ❌ | 6C |
| 43 | **Topic Friend Cards** | — | ❌ | `topic_shared_get` | ❌ | 6C |
| 44 | **12 Topic Character Skins** | — | ❌ | — | ❌ | 6D |

---

## Part F — Quest System (Phase 7) ⬜

| # | Feature | Client Script | Status | Backend | Status | Phase |
|---|---------|--------------|--------|---------|--------|-------|
| 45 | **QuestService** | — | ❌ Not created | `quest_*` RPCs | ❌ Not registered | 7A |
| 46 | **QuestBoardManager** | — | ❌ | — | ❌ | 7A |
| 47 | **QuestProgressManager** | — | ❌ | — | ❌ | 7A |
| 48 | **PlatformEventBus** | — | ❌ | — | ❌ | 7A |
| 49 | **QuestRewardService** | — | ❌ | Gift card API + Razorpay | ❌ | 7B |
| 50 | **Play & Earn (12 quests)** | — | ❌ | — | ❌ | 7A |
| 51 | **Share & Earn (8 quests)** | — | ❌ | — | ❌ | 7C |
| 52 | **Watch & Earn (6 quests)** | — | ❌ | — | ❌ | 7C |
| 53 | **Survey & Earn (6 quests)** | — | ❌ | — | ❌ | 7C |
| 54 | **Shop & Earn (9 quests)** | — | ❌ | — | ❌ | 7C |
| 55 | **Travel & Earn (7 quests)** | — | ❌ | — | ❌ | 7C |
| 56 | **Social & Earn (7 quests)** | — | ❌ | — | ❌ | 7C |
| 57 | **Spin/Draw & Earn (7 quests)** | — | ❌ | — | ❌ | 7C |
| 58 | **Partner & Earn (8 quests)** | — | ❌ | — | ❌ | 7D |
| 59 | **PartnerQuestAdapter** | — | ❌ | — | ❌ | 7D |
| 60 | **Anti-Abuse Controls** | — | ❌ | — | ❌ | 7E |

---

## Part G — Backend Modules Status

| # | Backend Module File | RPCs Registered in [index.js](file:///C:/Office/Backend/nakama/data/modules/index.js)? | Status |
|---|---------------------|-------------------------------|--------|
| 1 | [leagues/leagues.js](file:///C:/Office/Backend/nakama/data/modules/leagues/leagues.js) | ✅ 4 RPCs (league_get_state, league_submit_points, league_get_leaderboard, league_process_season) | ✅ |
| 2 | [characters/characters.js](file:///C:/Office/Backend/nakama/data/modules/characters/characters.js) | ✅ 3 RPCs (character_get_state, character_unlock, character_set_active) | ✅ |
| 3 | `badges/badges.js` | 🟡 Module exists | 🔵 Check registration |
| 4 | `notifications/notification_gate.js` | 🟡 Module exists | 🔵 Check registration |
| 5 | `friends/friends.js` | 🟡 Module exists | 🔵 Check registration |
| 6 | `progression/mastery_system.js` | 🟡 Module exists | 🔵 Check registration |
| 7 | `progression/progressive_unlocks.js` | 🟡 Module exists | 🔵 Check registration |
| 8 | `onboarding/onboarding.js` | 🟡 Module exists | 🔵 Check registration |
| 9 | `daily_rewards/daily_rewards.js` | 🟡 Module exists | 🔵 Check registration |
| 10 | Smart Review module | ❌ No [.js](file:///C:/Office/Backend/nakama/data/modules/chat.js) file found | ❌ |
| 11 | Topic Rank module | ❌ No [.js](file:///C:/Office/Backend/nakama/data/modules/chat.js) file found | ❌ |
| 12 | Quest module | ❌ No [.js](file:///C:/Office/Backend/nakama/data/modules/chat.js) file found | ❌ |
| 13 | Friend Streak module | ❌ No [.js](file:///C:/Office/Backend/nakama/data/modules/chat.js) file found | ❌ |

---

## Summary Score

| Phase | Features | ✅ Done | 🟡 Partial | ❌ Not Started |
|-------|----------|---------|-----------|---------------|
| Phase 0 (Consolidation) | 5 | 2 | 3 | 0 |
| Phase 1A (Habit Engine) | 10 | 7 | 3 | 0 |
| Phase 1B (Competition) | 5 | 4 | 1 | 1 (Streak Wager) |
| Phase 2 (Smart Review) | 2 | 0 | 2 | 0 |
| Phase 3 (Social) | 5 | 3 | 0 | 2 |
| Phase 4 (Surprise) | 1 | 0 | 1 | 0 |
| Phase 5 (Ecosystem) | 2 | 2 | 0 | 0 |
| **Phase 6 (Topics)** | **7** | **0** | **0** | **7** |
| **Phase 7 (Quests)** | **16** | **0** | **0** | **16** |
| **TOTAL** | **53** | **18 (34%)** | **10 (19%)** | **26 (49%)** |

> **Current coverage**: ~34% fully done, ~53% live or partial. Phase 6 and Phase 7 (23 features) are entirely not started — these are the future phases per the MRS roadmap.
