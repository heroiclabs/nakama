# 🗺️ Quest Engine — Full Implementation Knowledge Transfer (KT)

**Version:** 1.0.0 | **Date:** 2026-06-01 | **Audience:** Backend / Unity / Mobile Engineers

---

## Table of Contents

1. [What Was Built](#1-what-was-built)
2. [Architecture Overview](#2-architecture-overview)
3. [Nakama Backend](#3-nakama-backend)
4. [Unity Client — QuestEngineManager](#4-unity-client--questenginemanager)
5. [Unity UI — 4 Popup Controllers](#5-unity-ui--4-popup-controllers)
6. [Scene Setup (MainQuiz)](#6-scene-setup-mainguiz)
7. [UXML / USS Asset Locations](#7-uxml--uss-asset-locations)
8. [Full Data Flow Trace](#8-full-data-flow-trace)
9. [Bugs Found & Fixed During Implementation](#9-bugs-found--fixed-during-implementation)
10. [Deleted / Replaced Code](#10-deleted--replaced-code)
11. [Quest Config — Seeding Guide](#11-quest-config--seeding-guide)
12. [RPC Reference](#12-rpc-reference)
13. [Storage Reference](#13-storage-reference)
14. [Wiring Open Buttons (Last Step)](#14-wiring-open-buttons-last-step)
15. [Quick-Start Checklist for New Devs](#15-quick-start-checklist-for-new-devs)

---

## 1. What Was Built

The **Quest Engine** is a unified, server-authoritative quest system that replaces the old scattered quest managers (`WeeklyGoalsManager`, `MonthlyMilestonesManager`, `FriendQuestManager`). It handles every quest type — daily missions, weekly goals, monthly milestones, and social/friend quests — through a single pipeline.

| Layer | What Changed |
|-------|-------------|
| Nakama backend | New module `data/modules/src/quests/quest_engine.ts` — full quest lifecycle RPCs |
| Unity manager | `QuestEngineManager.cs` — single source of truth for all quest state in the client |
| Unity UI | 4 UI Toolkit popup controllers, each backed by a UXML + USS file |
| Scene | 5 new GameObjects wired in `MainQuiz` |

---

## 2. Architecture Overview

```
Player Action (quiz completed, friend challenged, …)
         │
         ▼
ProgressionEventRouter.cs
         │  QuestEngineManager.Instance.RecordEvent("quiz_completed", score)
         ▼
QuestEngineManager.cs ── debounced (400 ms) ──► LoadQuests() ──► OnQuestsLoaded event
         │
         │  RPC: quest_engine_record_event
         ▼
Nakama JS Runtime (Goja ES5)
  └── quest_engine.ts
        ├── resolveGameId()  → gameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b"
        ├── getPlayerQuests() ← nk.storageRead (collection: "qv_quests")
        ├── matchEvent()     ← walks quest steps, increments counters
        ├── checkCompletion() ← marks quest.completedAt when all steps done
        └── nk.storageWrite  → saves updated quest state
         │
         │  RPC response: { success, data: { updatedQuests: N } }
         ▼
QuestEngineManager.cs
  └── OnQuestsUpdated?.Invoke(N)
  └── ScheduleReload() → single LoadQuests() after 400 ms burst window
         │
         ▼
4 UI Popup controllers (subscribe to OnQuestsLoaded / OnQuestsUpdated / OnRewardClaimed)
  └── DailyQuestPopupUI   → RefreshList() → BuildQuestCard() per daily quest
  └── WeeklyGoalsPopupUI  → RefreshList() → BuildQuestCard() per weekly quest
  └── MonthlyMilestonesPopupUI → RefreshList() → BuildMilestoneCard() with step ladder
  └── FriendQuestPopupUI  → RefreshList() → BuildFriendQuestCard() / BuildEmptySocialCard()
```

---

## 3. Nakama Backend

### File Location

```
data/modules/src/quests/quest_engine.ts
```

### Registered RPCs

| RPC ID | Purpose |
|--------|---------|
| `quest_engine_get` | Return all quests for the player (filtered by gameId + userId) |
| `quest_engine_record_event` | Advance matching quest steps; returns count of updated quests |
| `quest_engine_claim_reward` | Mark a completed quest as claimed; idempotent |
| `quest_engine_admin_save_config` | Admin-only: upsert the master quest config (seed data) |
| `quest_engine_admin_get_config` | Admin-only: read the current quest config |

### Storage Collections

| Collection | Key Pattern | Owner | Content |
|-----------|-------------|-------|---------|
| `qv_quest_config` | `{gameId}` | system | Master quest definitions (admin-seeded) |
| `qv_quests` | `{gameId}_{userId}` | user | Per-player live quest state |

### Quest Data Shape (stored per player)

```json
{
  "quests": [
    {
      "id": "daily_quiz_3",
      "name": "Quiz Master",
      "description": "Complete 3 quizzes today",
      "category": "daily",
      "unlocked": true,
      "steps": [
        { "id": "s1", "description": "Complete quizzes", "requiredCount": 3, "count": 1, "completedAt": 0 }
      ],
      "startedAt": 1748764800,
      "completedAt": 0,
      "claimedAt": 0,
      "expiresAt": 1748851200,
      "resetCount": 0
    }
  ]
}
```

### Quest Categories

| Category | Reset Cadence | Notes |
|----------|--------------|-------|
| `daily` | Midnight UTC daily | Reset fires when `now >= nextMidnightUtc(completedAt)` — driven by `completedAt`, not `expiresAt` |
| `weekly` | Monday midnight UTC | Reset fires when `now >= nextMondayMidnightUtc(completedAt)` |
| `monthly` | 1st of month UTC | Reset fires when `now >= nextMonthStartUtc(completedAt)` |
| `friend` | Manual / no reset | Social quests unlocked by friend interactions |
| `onboarding` | Never | One-time tutorial quests |

> **Note:** `expiresAt` is a separate field — it makes a quest fully invisible/skipped after that timestamp. It does **not** trigger a reset. Resets are calendar-based on `completedAt`. If `resetIntervalSec` is set on a quest, it takes priority over the category-based calendar reset.

### How Events Match Quest Steps

Each quest step has an `eventType` field in the config (e.g. `"quiz_completed"`).
`quest_engine_record_event` walks every unlocked, incomplete quest, then every step within it.
If `step.eventType === payload.eventType`, the step is advanced using this rule:

- **Count-based step** (`requiredValue` not set in config): always increments `step.count` by **1**, regardless of `payload.value`.
- **Accumulation step** (`requiredValue` is set in config, e.g. `"earn 500 XP"`): increments `step.count` by `payload.value`.

In both cases `step.count` is capped at `requiredCount` (never over-counts).
When `step.count >= step.requiredCount`, `step.completedAt` is set.
When all steps are done, `quest.completedAt` is set.

### Build & Deploy

```powershell
# Build TypeScript → JS bundle
cd data/modules && npm run build

# Verify RPC registered
Select-String "quest_engine" data/modules/index.js | Select-Object -First 10

# Restart Nakama
docker compose restart nakama

# Confirm no goja errors
docker compose logs nakama --tail=40
```

---

## 4. Unity Client — QuestEngineManager

### File

```
Assets/_QuizVerse/Scripts/Quests/QuestEngineManager.cs
```

### Namespace / Class

```csharp
namespace Trivia.Quests
public class QuestEngineManager : MonoBehaviour   // DontDestroyOnLoad singleton
```

### Constants

```csharp
public const string GameId = "126bf539-dae2-4bcf-964d-316c0fa1f92b";
```

### Public API

```csharp
// Fire once on boot (optional — LoadQuests sets IsInitialized too)
QuestEngineManager.Instance.Initialize();

// Fetch quests from server (de-duped: ignores if already loading)
QuestEngineManager.Instance.LoadQuests();

// Record a player action (fire-and-forget; burst-events are coalesced into 1 reload)
QuestEngineManager.Instance.RecordEvent("quiz_completed", score);
QuestEngineManager.Instance.RecordEvent("friend_challenged");
QuestEngineManager.Instance.RecordEvent("guild_joined");

// Claim a completed quest reward
QuestEngineManager.Instance.ClaimReward(questId, ok => { /* callback */ });

// Query filtered lists
List<QuestData> daily   = QuestEngineManager.Instance.GetDailyQuests();
List<QuestData> weekly  = QuestEngineManager.Instance.GetWeeklyQuests();
List<QuestData> monthly = QuestEngineManager.Instance.GetMonthlyQuests();
List<QuestData> friend  = QuestEngineManager.Instance.GetFriendQuests();

// Badge count (unclaimed completed quests)
int badge = QuestEngineManager.Instance.GetUnclaimedCount();
```

### Events

```csharp
QuestEngineManager.Instance.OnQuestsLoaded  += (List<QuestData> quests) => { };
QuestEngineManager.Instance.OnQuestsUpdated += (int updatedCount) => { };
QuestEngineManager.Instance.OnRewardClaimed += (string questId) => { };
```

### Key Design Decisions

| Decision | Reason |
|----------|--------|
| `async void` with nested try/catch | Unity fire-and-forget pattern; outer catch handles `OperationCanceledException` |
| `_isLoading` guard on `LoadQuests()` | Prevents parallel network loads from RPC bursts |
| 400 ms `DebounceReload()` coroutine | Coalesces 5–6 events fired at quiz-end into a single `LoadQuests()` |
| Proper `[Serializable]` payload structs | `JsonUtility` does NOT serialize anonymous types → `GetPayload`, `ClaimPayload` |
| Optimistic `claimedAt` update on claim | UI flips badge to "Done" immediately; server sync follows via `ScheduleReload()` |
| `OnDestroy` nulls `Instance` | Prevents stale destroyed-object references after scene unload |

---

## 5. Unity UI — 4 Popup Controllers

### File Locations

```
Assets/_QuizVerse/Scripts/Quests/UI/
  ├── DailyQuestPopupUI.cs
  ├── WeeklyGoalsPopupUI.cs       ← also holds shared static card-builders
  ├── MonthlyMilestonesPopupUI.cs
  └── FriendQuestPopupUI.cs
```

### Popup Summary

| Popup | Category | Accent Color | Special Element |
|-------|----------|-------------|-----------------|
| `DailyQuestPopupUI` | `daily` | Gold `#FFD940` | — |
| `WeeklyGoalsPopupUI` | `weekly` | Teal `#1AE6D9` | `resetTimer` label (days to Monday) |
| `MonthlyMilestonesPopupUI` | `monthly` | Amber `#FFB800` | `progressSummary` label + step-ladder dots |
| `FriendQuestPopupUI` | `friend` | Violet `#C74BFF` | Social nudge label + empty CTA card |

### Lifecycle (all 4 popups)

```
Awake()  → singleton guard + create stable delegate refs (_onQuestsLoaded etc.)
OnEnable()  → subscribe to QuestEngineManager events
OnDisable() → unsubscribe (same delegate refs — no leak)
Start()  → BindUI() → query UXML elements → wire close + overlay callbacks
         → Hide(immediate: true)  ← hidden on boot

Show()   → _root.style.display = Flex → DOTween fade+scale-in → LoadQuests()
Hide()   → DOTween fade-out → _root.style.display = None
RefreshList() → QuestEngineManager.Instance.GetXxxQuests() → build cards
```

### Shared Static Helpers (on WeeklyGoalsPopupUI)

```csharp
WeeklyGoalsPopupUI.BuildQuestCard(q, accentColor)   // used by Weekly + Friend
WeeklyGoalsPopupUI.BuildProgressBarBg(parent)
WeeklyGoalsPopupUI.BuildProgressBarFill(bg, pct, color)
WeeklyGoalsPopupUI.BuildEmptyLabel(msg)
DailyQuestPopupUI.StyleClaimButton(btn, bgColor)    // used by all 4
```

### Animation

DOTween is used for all show/hide transitions:
- **Show:** overlay fades to 0.75 opacity (60% of `animDuration`); panel fades in + scales from 0.85→1.0 with `Ease.OutBack`
- **Hide:** both fade to 0; `_root.style.display = None` on tween complete

---

## 6. Scene Setup (MainQuiz)

All objects are live in `Assets/_QuizVerse/Scenes/Production/Scenes/MainQuiz.unity`.

```
MainQuiz scene root
│
├── [QuestEngineManager]                    ← instanceID: -18752
│    └── Trivia.Quests.QuestEngineManager
│
└── [QuestEngine_Popups]                    ← instanceID: -18790
     ├── [Daily Quest Popup]               ← instanceID: -18800
     │    ├── UIDocument
     │    │    ├── panelSettings   → FortuneWheelPanelSettings
     │    │    ├── visualTreeAsset → DailyQuestPopupUI.uxml   ✅
     │    │    └── sortingOrder    → 100
     │    └── DailyQuestPopupUI
     │         └── uiDocument → UIDocument (same GO)          ✅
     │
     ├── [Weekly Goals Popup]              ← instanceID: -18820
     │    ├── UIDocument → WeeklyGoalsPopupUI.uxml             ✅
     │    └── WeeklyGoalsPopupUI
     │
     ├── [Monthly Milestones Popup]        ← instanceID: -18840
     │    ├── UIDocument → MonthlyMilestonesPopupUI.uxml       ✅
     │    └── MonthlyMilestonesPopupUI
     │
     └── [Friend Quest Popup]             ← instanceID: -18860
          ├── UIDocument → FriendQuestPopupUI.uxml             ✅
          └── FriendQuestPopupUI
```

---

## 7. UXML / USS Asset Locations

```
Assets/_QuizVerse/UI/Quests/
  ├── QuestPopup.uss                  ← shared: overlay, panel, header, scroll, empty label
  ├── DailyQuestPopupUI.uxml          ← daily popup shell
  ├── DailyQuestPopupUI.uss           ← deep purple panel, gold title
  ├── WeeklyGoalsPopupUI.uxml         ← weekly shell + resetTimer label
  ├── WeeklyGoalsPopupUI.uss          ← teal panel, cyan title
  ├── MonthlyMilestonesPopupUI.uxml   ← monthly shell + progressSummary label
  ├── MonthlyMilestonesPopupUI.uss    ← dark amber panel, gold title
  ├── FriendQuestPopupUI.uxml         ← friend shell + nudge label
  └── FriendQuestPopupUI.uss          ← deep violet panel, purple title
```

### UXML Structure (all 4 share this shape)

```xml
<ui:UXML>
  <Style src="QuestPopup.uss" />
  <Style src="[Popup]UI.uss" />
  <ui:VisualElement name="overlay" class="quest-overlay">          <!-- dim bg + tap-to-close -->
    <ui:VisualElement name="panel" class="quest-panel">            <!-- centred card -->
      <ui:VisualElement name="header" class="quest-header">
        <ui:Label name="title" class="quest-title" />
        <ui:Button name="closeBtn" class="quest-close-btn" />
      </ui:VisualElement>
      <!-- optional: resetTimer / progressSummary / nudge label -->
      <ui:ScrollView name="scrollView" class="quest-scroll">
        <ui:VisualElement name="questList" class="quest-list" />   <!-- cards injected here -->
      </ui:ScrollView>
    </ui:VisualElement>
  </ui:VisualElement>
</ui:UXML>
```

### Editing in UI Builder

1. In Unity Project window → `Assets/_QuizVerse/UI/Quests/`
2. Double-click any `.uxml` file → **UI Builder** opens
3. Edit layout / sizes / colours → changes auto-save to the `.uxml` / `.uss` files
4. Script queries elements by `name` attribute — **do not rename** `overlay`, `panel`, `header`, `title`, `closeBtn`, `scrollView`, `questList`, `resetTimer`, `progressSummary`, `nudge`

---

## 8. Full Data Flow Trace

### Quiz Completed → Quest Progress → UI Update

```
1. Player finishes a quiz (score = 850)
2. ProgressionEventRouter.FanOut_QuizCompleted()
     → QuestEngineManager.Instance.RecordEvent("quiz_completed", 850)

3. QuestEngineManager.RecordEvent("quiz_completed", 850)
     → await IVXNManager.GetValidSessionAsync()
     → RPC "quest_engine_record_event" payload:
        { "gameId": "126bf...", "eventType": "quiz_completed", "value": 850, "metadata": {} }

4. Nakama quest_engine.ts
     → reads player's quest state from storage
     → finds step { eventType: "quiz_completed", requiredCount: 3 }
     → increments count: 1 → 2
     → saves updated state
     → returns { success: true, data: { updatedQuests: 1 } }

5. QuestEngineManager receives response
     → OnQuestsUpdated?.Invoke(1)
     → ScheduleReload() starts 400ms debounce coroutine

6. [400ms later, after burst coalesces]
     → LoadQuests() → RPC "quest_engine_get"
     → Nakama returns full updated quest list
     → OnQuestsLoaded?.Invoke(CurrentQuests)

7. DailyQuestPopupUI (if open)
     → _onQuestsLoaded fires → RefreshList()
     → BuildQuestCard() re-renders progress bar at 2/3
```

### Player Claims Reward

```
1. Player taps "Claim Reward" button on a completed quest card
2. Button constructor lambda fires (single handler — no double-fire)
     → claimBtn.SetEnabled(false)           ← prevent double-tap
     → QuestEngineManager.Instance.ClaimReward(questId, onComplete)

3. QuestEngineManager.ClaimReward(questId)
     → RPC "quest_engine_claim_reward"
        { "gameId": "126bf...", "questId": "daily_quiz_3" }

4. Nakama validates, sets quest.claimedAt = now, saves
     → returns { success: true }

5. QuestEngineManager
     → Optimistic: q.claimedAt set in CurrentQuests immediately
     → OnRewardClaimed?.Invoke(questId)       ← UI flips badge to "Done"
     → ScheduleReload() → server-authoritative sync after 400ms
     → onComplete(true)

6. If claim failed → claimBtn.SetEnabled(true) (re-enable for retry)
```

---

## 9. Bugs Found & Fixed During Implementation

| # | Severity | Bug | Fix Applied |
|---|----------|-----|-------------|
| 1 | **Critical** | `DailyQuestPopupUI.BuildQuestCard` wired claim button twice (constructor + `clicked +=`) → 2 RPCs per tap | Replaced with single constructor-lambda; `StyleClaimButton()` helper extracted |
| 2 | **Critical** | All 4 popups: `_ => RefreshList()` lambda creates new delegate each time; `OnDisable -=` never actually unsubscribed → **event handler leak** accumulating on every Enable/Disable cycle | Stored delegates as named fields `_onQuestsLoaded`, `_onQuestsUpdated`, `_onRewardClaimed` created once in `Awake()` |
| 3 | **High** | `RecordEvent` called `LoadQuests()` immediately per event → quiz-end fires 5–6 events = 5–6 parallel loads | Added 400 ms `DebounceReload()` coroutine + `_isLoading` in-flight guard |
| 4 | **High** | `JsonUtility.ToJson(new { questId = id })` — anonymous types serialize to `{}` → `ClaimReward` RPC loses `questId` | Replaced with `[Serializable]` structs: `GetPayload`, `ClaimPayload` |
| 5 | **Medium** | `QuestEngineManager.OnDestroy` missing → `Instance` remains a stale destroyed reference | Added `OnDestroy` that nulls `Instance` |
| 6 | **Medium** | `JsonUtility` string escaping absent in metadata → JSON would break on `"` or `\` in values | Added `EscapeJson()` utility applied to all manually-concatenated JSON strings |

---

## 10. Deleted / Replaced Code

The following files were deleted as part of this migration. All their functionality is now in `QuestEngineManager.cs`.

| Deleted File | Replacement |
|-------------|-------------|
| `Scripts/Retention/D7D30/WeeklyGoalsManager.cs` | `QuestEngineManager.GetWeeklyQuests()` |
| `Scripts/Retention/D7D30/MonthlyMilestonesManager.cs` | `QuestEngineManager.GetMonthlyQuests()` |
| `Scripts/Social/FriendQuestManager.cs` | `QuestEngineManager.GetFriendQuests()` |
| `Scripts/Retention/D7D30/UI/WeeklyGoalsUI.cs` | `WeeklyGoalsPopupUI.cs` |
| `Scripts/Retention/D7D30/UI/WeeklyGoalsPrefabUI.cs` | `WeeklyGoalsPopupUI.cs` |

### Files Updated to Remove Old References

| File | Change |
|------|--------|
| `SmartReviewScreen.cs` | Removed `FriendQuestManager.Instance` calls |
| `AniDeeBeeShareManager.cs` | Removed `FriendQuestManager.Instance` calls |
| `GuildManager.cs` | `MonthlyMilestonesManager.OnGuildJoined()` → `QuestEngineManager.RecordEvent("guild_joined")` |
| `ClanManager.cs` | Same as GuildManager |
| `D7D30RetentionBootstrap.cs` | Full refactor: removed all direct manager calls, routes through `QuestEngineManager.RecordEvent()` |
| `ProgressionEventRouter.cs` | All `friendQuestMgr.RecordFriendInteraction()` → `QuestEngineManager.RecordEvent()` |
| `Editor/D7D30RetentionUICreator.cs` | Updated to create `QuestEngineManager` instead of old managers |

---

## 11. Quest Config — Seeding Guide

Quest definitions must be seeded once via the Nakama Console before the system has any quests.

### Endpoint

**POST** `http://localhost:7350/v2/rpc/quest_engine_admin_save_config`

### Minimal Seed Payload

```json
{
  "gameId": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "quests": [
    {
      "id": "daily_quiz_3",
      "name": "Quiz Master",
      "description": "Complete 3 quizzes today",
      "category": "daily",
      "unlocked": true,
      "steps": [
        { "id": "s1", "eventType": "quiz_completed", "description": "Complete quizzes", "requiredCount": 3 }
      ]
    },
    {
      "id": "weekly_score_5000",
      "name": "High Scorer",
      "description": "Score 5000 points this week",
      "category": "weekly",
      "unlocked": true,
      "steps": [
        { "id": "s1", "eventType": "quiz_completed", "description": "Earn score points", "requiredCount": 5000 }
      ]
    },
    {
      "id": "monthly_guild_join",
      "name": "Guild Member",
      "description": "Join a guild this month",
      "category": "monthly",
      "unlocked": true,
      "steps": [
        { "id": "s1", "eventType": "guild_joined", "description": "Join a guild", "requiredCount": 1 }
      ]
    },
    {
      "id": "friend_challenge_1",
      "name": "Social Challenger",
      "description": "Challenge a friend",
      "category": "friend",
      "unlocked": true,
      "steps": [
        { "id": "s1", "eventType": "friend_challenge_sent", "description": "Challenge a friend", "requiredCount": 1 }
      ]
    }
  ]
}
```

### Via Nakama Console (UI)

1. Open `http://localhost:7351` → API Explorer
2. RPC: `quest_engine_admin_save_config`
3. User ID: leave blank (runs as system)
4. Payload: paste the JSON above

---

## 12. RPC Reference

| RPC | Auth Required | Input | Output |
|-----|-------------|-------|--------|
| `quest_engine_get` | Yes | `{ gameId }` | `{ success, data: { quests[] } }` |
| `quest_engine_record_event` | Yes | `{ gameId, eventType, value, metadata }` | `{ success, data: { updatedQuests: N, quests: { [questId]: {...} } } }` |
| `quest_engine_claim_reward` | Yes | `{ gameId, questId }` | `{ success, data: { reward } }` |
| `quest_engine_admin_save_config` | Admin | `{ gameId, quests[] }` | `{ success, data: { saved: true, questCount: N } }` |
| `quest_engine_admin_get_config` | Admin | `{ gameId }` | `{ success, data: { config: { quests: { [questId]: {...} } }, questCount: N } }` |

All RPCs follow the project's standard `RpcHelpers.successResponse` envelope:
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "message" }
```

---

## 13. Storage Reference

| Collection | Key | Value | Permission |
|-----------|-----|-------|------------|
| `qv_quest_config` | `{gameId}` | Master quest definitions JSON | Public read, server-only write |
| `qv_quests` | `{gameId}_{userId}` | Player quest state JSON | Owner read, server-only write |

---

## 14. Wiring Open Buttons (Last Step)

The popups are fully built and hidden. The only remaining step is calling `.Show()` from your existing screen/HUD button handlers:

```csharp
// From Home screen / HUD / any button handler:
DailyQuestPopupUI.Instance?.Show();
WeeklyGoalsPopupUI.Instance?.Show();
MonthlyMilestonesPopupUI.Instance?.Show();
FriendQuestPopupUI.Instance?.Show();
```

All four singletons are alive from scene start — `Instance` is never null after `Awake()`.

---

## 15. Quick-Start Checklist for New Devs

### Backend
- [ ] `cd data/modules && npm run build` — verify quest_engine_* RPCs in `index.js`
- [ ] `docker compose restart nakama` — pick up JS changes
- [ ] `docker compose logs nakama --tail=30` — confirm no goja errors
- [ ] Seed initial quest config via Nakama Console → `quest_engine_admin_save_config`

### Unity
- [ ] Open `MainQuiz` scene → confirm `[QuestEngineManager]` and `[QuestEngine_Popups]` exist in hierarchy
- [ ] Each popup GO: `UIDocument.visualTreeAsset` is set to its matching `.uxml` file
- [ ] Each popup GO: `UIDocument.panelSettings` = `FortuneWheelPanelSettings`, `sortingOrder` = 100
- [ ] Wire `.Show()` calls from your tab bar / HUD buttons
- [ ] Play in Editor → call `DailyQuestPopupUI.Instance.Show()` from console or test button → popup appears
- [ ] Unity console shows `[QuestEngine] Loaded N quests` after authentication

### Event Names Already Wired

These `eventType` strings are already being sent by `ProgressionEventRouter` and other managers:

| Event | Source |
|-------|--------|
| `quiz_completed` | `ProgressionEventRouter.FanOut_QuizCompleted()` |
| `friend_challenge_sent` | `ProgressionEventRouter` |
| `questions_answered` | `ProgressionEventRouter` |
| `guild_joined` | `GuildManager` / `ClanManager` |
| `clan_joined` | `ClanManager` |

---

*For questions about the Nakama backend, see `docs/COMPLETE_RPC_REFERENCE.md`.*
*For Unity scene conventions, see `Assets/_QuizVerse/.agents/BOOTSTRAP.md`.*
