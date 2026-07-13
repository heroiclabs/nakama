# QuizVerse Game ↔ SeedQ/Aahaa Integration Gaps

**Branch reviewed:** `quiz-verse-prod` (`intelliverse-x-games-platform-2`)  
**Backend:** nakama PR #304 + security hardening PR  
**Date:** 2026-07-13

## What the game uses TODAY (wired)

| Step | Unity service | Nakama RPC | Storage |
|------|---------------|------------|---------|
| App open warmup | `QuizQuestionWarmupCoordinator` | `quizverse_warm_topic` | ready queue |
| Fetch questions | `QuizDeliveryService` | `quizverse_get_questions` | pack + `qv_seen` |
| Seen ledger | `QuizDeliveryService` / `QuizSubmissionService` | `quizverse_seen_*` | `qv_seen` |
| Submit quiz | `QuizSubmissionService` | `quizverse_submit_result` | history + rewards |
| Home personalization | `IVXPerModePersonalizationService` | `personalization_get` | bundle |
| Post-quiz brain popup | `BrainPromptCoordinator` | `quizverse_brain_prompt_*` | prompts |

## What PR #304 adds (backend only — NOT in Unity yet)

| Engine | RPCs | Purpose |
|--------|------|---------|
| **SeedQ** | `quizverse_seedq_get_staged`, `_consume_set`, `_review` | Pre-staged question sets per (user, mode, topic) |
| **Aahaa** | `quizverse_aahaa_get`, `_react`, `_profile_set` | Personalized wow-moment feed |

## Integration gaps to close (orchestrator / Unity PR)

### Gap 1 — SeedQ not called from game
**Today:** `QuizDeliveryService.GetQuestionsAsync` → `quizverse_get_questions`  
**Target:** Optionally call `quizverse_seedq_get_staged` first; if `sets.length > 0`, play from staged set; on complete call `quizverse_seedq_consume_set`.

**Files to change:**
- `Assets/_QuizVerse/Scripts/Services/QuizDeliveryService.cs` — add `GetStagedSetsAsync(mode, topic)`
- `TrueFalseMode.cs`, `SpeedQuizMode.cs`, etc. — branch on staged vs legacy path

### Gap 2 — Aahaa RPCs not called
**Today:** `IVXTodayForYouFeed` sorts cards with `kind == "aahaa"` from `personalization_get` only  
**Target:** After quiz submit OR home open, call `quizverse_aahaa_get?generate=true`; render feed items; on tap call `quizverse_aahaa_react`.

**Files to change:**
- New `AahaaFeedService.cs` (or extend `IVXPerModePersonalizationService`)
- `HomeScreen.cs` — fetch + show wow modal
- `QuizSubmissionService.cs` — `generate:true` after submit

### Gap 3 — Pool exhaustion wow intercept
**Today:** Rating prompt logic in client  
**Target:** Read `suppress_rating_prompt` from `quizverse_seedq_get_staged` or submit response; show `wow.e.pool_exhausted` from Aahaa feed instead of App Store rating.

### Gap 4 — Dual seen ledgers
**Today:** `quizverse_seen_*` (quiz modes) vs `quizverse_kb_register_seen_questions` (AI Host only)  
**Target:** Unify on `qv_seen` via submit + seedq consume (PR #304 backstop in `quiz_submit_result` helps).

### Gap 5 — Legacy modes without pipeline submit
**Today:** ImageGuess, MediaQuiz, BrainSprint use `get_questions` but legacy `QuizResultData` submit — no server personalization  
**Target:** Migrate to `BeginPipelineSession` + `quizverse_submit_result` or at minimum flush seen IDs.

## Recommended merge order

1. **Security hardening PR** (this branch) — merge before #304
2. **nakama #304** — SeedQ + Aahaa engines
3. **Unity integration PR** — wire `seedq_get_staged` + `aahaa_get` (can be parallel with orchestrator)
4. **nakama #305** — crawl-media hardening (optional, independent)

## Security notes (addressed in hardening PR)

- Admin RPCs: `http_key` only (`ctx.userId` must be empty); `service_token` never accepted from user sessions
- SSRF: `checkProvenance` blocks private/metadata URLs
- Resource limits: `generateAll` 30s cap, `ingestTick` 25s budget, HTTP body 1 MiB max
- Queue flood: per-user 5 min cooldown on priority replenishment
