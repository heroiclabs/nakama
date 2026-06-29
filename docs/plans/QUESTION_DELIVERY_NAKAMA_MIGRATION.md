# Question Delivery — Two-RPC Architecture + Personalization Intelligence Layer

**Status:** Planned — awaiting implementation  
**Date:** 2026-06-26  
**Review:** Gap analysis + world-class addendum appended 2026-06-26  
**Rev 2:** Identity & Context Resolution layer added 2026-06-29 (game_id, country_code, user_id security boundary)  
**Rev 3:** `quizverse_get_review` RPC added 2026-06-29 (Review & Learn — wrong-answer cards, lazy load, no new storage)  
**Rev 4:** Unity Pure Renderer principle locked in 2026-06-29 — all format conversion, normalization, shuffling, and provider logic moved exclusively to Nakama; `ExternalQuizApiService.cs` deleted  
**Rev 5:** World-class audit 2026-06-29 — 10 gaps found and fixed: `quizverse_get_config` RPC added, quality gate, pack limit, multi-select fix, explanation generation, phantom-read guard, rate limit management, admin stats, lang fallback, AI schema validation

---

## Goal

Replace the current fragmented question system with exactly **four RPCs**:

| RPC | When Unity calls it | Why it's needed |
|---|---|---|
| `quizverse_get_config` | Once on app open | Topic list, feature flags, enabled game modes — **zero client update needed to add topics** |
| `quizverse_get_questions` | Before each quiz | Get a set of questions for any game mode |
| `quizverse_submit_result` | After each quiz | Submit answers, get score + rewards |
| `quizverse_get_review` | On "Review & Learn" tap | Fetch wrong-answer review cards |

Everything else — provider selection, API keys, caching, normalization, format conversion, option shuffling, quality validation, scoring, KB recording, XP, wallet, leaderboard — happens **inside Nakama**. Unity knows nothing about it.

---

## RPC 0 — `quizverse_get_config`

### Why this RPC exists (GAP-C1)

Without this RPC, **Unity hardcodes the topic list**. Adding "kpop" or "bollywood" to Nakama next month requires shipping a Unity client update through the App Store. This breaks the zero-client-update promise.

`quizverse_get_config` makes the server the single source of truth for everything Unity needs to render the quiz UI. Unity calls it once on app open and caches the result for the session.

### Storage

```
Collection : qv_config
Key        : "global"
Owner      : system (public read, admin write only)
```

Admin edits the config doc via Nakama console → Unity reflects changes on next app open. No APK/IPA release.

### Response

```json
{
  "ok": true,
  "topics": [
    { "id": "anime",   "label": "Anime",    "icon_url": "https://s3.../anime.png",   "has_media": true,  "enabled": true,  "is_new": false, "badge": null },
    { "id": "pokemon", "label": "Pokémon",  "icon_url": "https://s3.../pokemon.png", "has_media": true,  "enabled": true,  "is_new": false, "badge": null },
    { "id": "news",    "label": "News",     "icon_url": "https://s3.../news.png",    "has_media": false, "enabled": true,  "is_new": false, "badge": null },
    { "id": "kpop",    "label": "K-Pop",    "icon_url": "https://s3.../kpop.png",    "has_media": true,  "enabled": true,  "is_new": true,  "badge": "NEW" }
  ],
  "max_count": 20,
  "features": {
    "review_and_learn": true,
    "daily_quiz": true,
    "weekly_quiz": true,
    "personalized_mode": false
  },
  "supported_langs": {
    "anime": ["en"],
    "news":  ["en", "es", "fr", "de"],
    "ai":    ["en", "hi", "es", "fr", "de", "ja", "ko"]
  },
  "client_min_version": "2.1.0"
}
```

| Field | What Unity does with it |
|---|---|
| `topics[]` | Renders the topic picker dynamically — no hardcoded topic list in Unity |
| `topics[].enabled` | Hides disabled topics without any code change |
| `topics[].is_new` / `badge` | Shows "NEW" badge on topic icon |
| `topics[].icon_url` | Loads topic icon from S3 — no icon assets bundled in Unity |
| `features.*` | Shows/hides UI buttons (Daily Quiz, Review & Learn, etc.) |
| `supported_langs` | Shows language selector only for topics that have translated content |
| `client_min_version` | Forces update prompt if client is too old |

### What Nakama does

```
1. resolveContext() → userId, gameId
2. Read qv_config/global from storage
3. If not found → return built-in defaults (server never breaks on missing config)
4. Return config JSON
```

No per-user logic. Identical response for all users (personalization is in `get_questions`).

---

## Unity Is a Pure Renderer — Non-Negotiable Principle

**Unity receives exactly one question shape. Always. From every provider. No exceptions.**

Unity's only responsibilities:

| Unity does | Unity never does |
|---|---|
| Calls three RPCs | Parses provider-specific JSON |
| Displays `question_text` | Converts question formats |
| Renders `options[]` as buttons | Shuffles or reorders options |
| Shows `media.url` in an image/audio player | Stores or uses API keys |
| Sends `selected_option_ids[]` on answer | Makes HTTP calls to external APIs |
| Shows `score`, `xp_earned`, `coins_earned` | Knows about Jikan / PokeAPI / S3 / NASA |
| Renders `review_items[]` as swipe cards | Re-maps correct answers after any conversion |
| Reads `personalization` block for UI hints | Implements any business logic |

**If any of the right column items exist in a Unity `.cs` file, that is a bug. Delete it.**

---

---

## What Gets Removed

These existing RPCs are **replaced** by the three above and will be deprecated:

| Old RPC | Replaced by |
|---|---|
| `quizverse_quiz_generate` | `quizverse_get_questions` (topic = s3 / daily / weekly) |
| `quizverse_fetch_news_quiz` | `quizverse_get_questions` (topic = news) |
| `quizverse_fetch_external_quiz` | `quizverse_get_questions` (topic = anime / pokemon / etc.) |
| `quizverse_request_questions` | `quizverse_get_questions` (superset) |
| `quiz_submit_result` (legacy) | `quizverse_submit_result` |
| `quiz_submit_result_v2` | `quizverse_submit_result` |

These **stay and are called internally** by Nakama — Unity does NOT call them directly:

| Internal / stays | Called by | Purpose |
|---|---|---|
| `quizverse_seen_merge` | `quizverse_submit_result` | Mark questions seen after a round |
| `quizverse_seen_purge` | `quizverse_get_questions` | Purge stale seen entries before filtering |
| `quiz_get_stats` | Unity (profile screen) | User quiz stats — untouched |
| `quiz_get_history` | Unity (history screen) | Quiz history — untouched |
| `qv_kb_user_dump` / `qv_kb_user_summary` / `qv_kb_user_kind` | Unity (KB screen) | Knowledge graph — untouched |
| `analytics_log_event` | Unity (analytics) | Event logging — untouched |

**Unity-side code that is deleted entirely (not just deprecated):**

| File / Class | Why deleted |
|---|---|
| `ExternalQuizApiService.cs` | Made all direct HTTP calls to Jikan, PokeAPI, NASA, TMDB etc. — this is now 100% Nakama's job |
| Any provider response model classes | Unity never parses provider JSON again |
| Any option shuffling / scrambling helpers | Shuffling happens at cache-write time on the server |
| Any question format converters | One format comes out of Nakama — no conversion needed |
| Any hardcoded API keys or base URL constants | All credentials live in Nakama `.env` only |

These **stay and are called by Unity** for debug / profile info only:

| RPC | Purpose |
|---|---|
| `quizverse_seen_stats` | Show "you've seen X questions across all topics" on profile |
| `quizverse_seen_reset` | Admin / debug: wipe a user's seen ledger |

---

## Full Flow

```
┌──────────────────────────────────────────────────────────────┐
│  Unity                                                       │
│                                                              │
│  1. quizverse_get_questions                                  │
│     { topic, count, lang, question_type, has_media,          │
│       game_id, country_code }                                │
│     ← user_id is NOT sent; derived from ctx.userId (JWT)    │
│                                                              │
│  2. Display questions                                        │
│     (no knowledge of provider / API / S3 / AI / seen state) │
│                                                              │
│  3. quizverse_submit_result                                  │
│     { question_pack_id, answers[], game_id, country_code }   │
│                                                              │
│  4. Show score, XP earned, coins, rank                       │
│     If wrong_count > 0 → show "Review & Learn" button        │
│                                                              │
│  5. [on button tap] quizverse_get_review                     │
│     { question_pack_id, game_id, filter: "wrong_only" }      │
│     ← lazy: only called if user taps the button             │
│                                                              │
│  6. Show ReviewLearnScreen                                   │
│     (swipeable cards: your answer ❌ → correct answer ✅)    │
└──────────────────────────────────────────────────────────────┘
              │                          │
              ▼                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Nakama — Context Resolution (both RPCs, step 0)             │
│                                                              │
│  userId      ← ctx.userId (from JWT — never trust client)    │
│  gameId      ← validate req.game_id ∈ ALLOWED_GAME_IDS;      │
│                 fallback: env DEFAULT_GAME_ID                │
│  countryCode ← trust hierarchy:                              │
│                 1. player_profile.country (stored, onboarding)│
│                 2. req.country_code (client hint, ISO 3166-1) │
│                 3. IP-geo lookup (headers / MaxMind)          │
│                 4. "US" (hard default)                        │
└──────────────────────────────────────────────────────────────┘
              │                          │
              ▼                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Nakama — CACHE LAYER (runs once per topic per TTL)          │
│  Triggered on: cache miss, server startup, cron refresh      │
│                                                              │
│  1. Fetch raw data from provider:                            │
│       anime    → Jikan API            (refresh every 24h)    │
│       pokemon  → PokeAPI              (refresh every 72h)    │
│       space    → NASA APOD            (refresh every 6h)     │
│       news     → GNews → Currents → MediaStack → NewsAPI     │
│       movies   → TMDB                 (refresh every 2h)     │
│       music    → Last.fm / Deezer     (refresh every 2h)     │
│       opentdb  → OpenTDB              (refresh every 1h)     │
│       daily/weekly/s3/flags → S3      (on publish)           │
│       ai       → Claude → OpenAI      (never cached)         │
│                                                              │
│  2. Normalize every provider response → ONE shared contract  │
│       { id, question_text, options[{id,text}],              │
│         correct_option_ids, has_media, media, explanation }  │
│       Options shuffled A/B/C/D — correct_id set at this     │
│       point, NEVER changed again.                            │
│                                                              │
│  3. Quality gate — reject question if ANY of:               │
│       question_text empty or < 10 chars                      │
│       options[] < 2 entries                                  │
│       correct_option_ids empty or not in options[].id        │
│       two options have identical text (after trim/lowercase) │
│       HTML entities in text → htmlDecode() first            │
│       question_text is a duplicate of another in the pool    │
│                                                              │
│  4. Explanation enrichment — if explanation is empty:        │
│       anime   → "From series {name}, aired {year}."         │
│       pokemon → "Type: {type}. Generation: {gen}."          │
│       flags   → "Capital: {capital}. Region: {region}."     │
│       other   → Claude 1-sentence fact (runs ONCE at cache) │
│                                                              │
│  5. Rate limit: stagger topic refreshes (1 per 2s).         │
│     On 429 → exponential backoff. On failure → keep stale.  │
│                                                              │
│  6. Store validated + enriched pool in qv_cache_{topic}     │
│     (50 questions max per document, paginate if needed)      │
│  ──────────────────────────────────────────────────────────  │
│  Done once. Shared by all users. Zero per-request cost.      │
└──────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────┐
│  Nakama — get_questions  (per player request)                │
│                                                              │
│  1. Auth + validate (topic, count ≤ 20, lang)               │
│  2. Rate limit: max 5 get_questions calls per user/minute    │
│  3. Pack limit: count active packs for userId; if >= 3 →    │
│     delete oldest active pack before creating new one        │
│  4. Check lang vs supported_langs for topic; if unsupported  │
│     → fallback to "en", set response.lang_actual = "en"     │
│  5. Read qv_cache_{topic}   ← already normalized, no parse  │
│  6. Read qv_seen ledger     → build seenIdSet               │
│  7. Read qv_inflight_{userId} → build inFlightSet (phantom  │
│     read guard — IDs from packs not yet submitted)           │
│  8. Filter: remove (seenIdSet ∪ inFlightSet) → unseen pool  │
│     If pool < count needed  → backfill oldest-seen (>90d)    │
│  9. Pick N questions from unseen pool                        │
│  10. Write qv_inflight_{userId} entry (30-min TTL)          │
│  11. Persist question pack  → qv_question_packs (grading)   │
│  12. Return questions to Unity                              │
│  ──────────────────────────────────────────────────────────  │
│  NOTE: NO normalization, NO format conversion, NO shuffle    │
│        at this step. Only read → filter → pick → return.    │
│        Seen ledger NOT updated here (only on submit).        │
└──────────────────────────────────────────────────────────────┘
              │                          │
              ▼                          ▼
┌──────────────────────────────────────────────────────────────┐
│  Nakama — submit_result                                      │
│                                                              │
│  1. Auth check                                               │
│  2. Load question pack from storage (by pack_id + userId)    │
│  3. Guard: reject duplicate submit (pack_already_submitted)  │
│  4. Grade each answer against server-stored correct_ids      │
│     → client cannot tamper with correctness                  │
│  5. Compute score + time bonus                               │
│  6. Update seen ledger via __qvsSeen.merge()                 │
│     → writes answered question IDs with ISO-8601 timestamp   │
│     → OCC-safe (3-retry on version conflict)                 │
│     → caps ledger at 10,000 IDs per topic (drops oldest)    │
│  7. Update XP + wallet (hiro_progression_add_xp)            │
│  8. Submit to leaderboard (submit_leaderboard_score)         │
│  9. Write topic performance to KB (qv_kb collections)        │
│ 10. Log analytics event (analytics_log_event)               │
│ 11. Return graded result + rewards + rank to Unity           │
└──────────────────────────────────────────────────────────────┘
```

---

## RPC 1 — `quizverse_get_questions`

### Request

```json
{
  "topic": "anime",
  "count": 10,
  "lang": "en",
  "question_type": "single_select",
  "has_media": true,
  "media_type": "image",
  "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "country_code": "US"
}
```

> **Security boundary — `user_id` is intentionally absent from this contract.**  
> The user identity is extracted exclusively from `ctx.userId` (Nakama's JWT session token).  
> Accepting `user_id` from the client would allow Client A to impersonate User B —  
> poisoning the seen ledger, corrupting Elo ratings, and bypassing server-side grading.  
> This is a non-negotiable authentication boundary.

| Field | Type | Required | Default | Rules |
|---|---|---|---|---|
| `topic` | string | yes | — | See topic table below |
| `count` | int | no | 10 | 1–20, clamped server-side |
| `lang` | string | no | `"en"` | ISO 639-1 |
| `question_type` | string | no | `"single_select"` | `single_select` · `multiple_select` · `true_false` |
| `has_media` | bool | no | auto by topic | `true` or `false` |
| `media_type` | string | no | auto by topic | `image` · `audio` · `video` · `null` |
| `game_id` | string (UUID) | no | `env.DEFAULT_GAME_ID` | Must be in `ALLOWED_GAME_IDS`; server rejects unknown values with `invalid_request` |
| `country_code` | string | no | resolved server-side | ISO 3166-1 alpha-2 hint (e.g. `"US"`, `"IN"`, `"JP"`). Used for content filtering, CDN routing, and analytics. Overridden by stored profile country if present. |

**Topics and their providers:**

| Topic | Provider | Media | Cache TTL |
|---|---|---|---|
| `s3` | S3 question bank | none | per-bank URL |
| `daily` | S3 daily quiz | none | until next day |
| `weekly` | S3 weekly quiz | none | until next week |
| `news` | GNews → Currents → MediaStack → NewsAPI | none | 6h |
| `anime` | Jikan (MyAnimeList) | image | 24h |
| `dog` | Dog CEO API | image | 24h |
| `dish` | Foodish / TheMealDB | image | 12h |
| `pokemon` | PokeAPI | image | 72h |
| `sports` | TheSportsDB | image | 2h |
| `space` | NASA APOD | image | 6h |
| `cocktail` | TheCocktailDB | image | 12h |
| `ghibli` | Ghibli API | image | 72h |
| `starwars` | akabab/starwars-api + S3 portraits | image | 72h |
| `disney` | Disney API | image | 24h |
| `countries` | RestCountries (bundled) | image | 7d |
| `flags` | S3 flag catalogue | image | 7d |
| `movies` | TMDB | image | 2h |
| `music` | Last.fm / Deezer preview | audio | 2h |
| `opentdb` | OpenTDB | none | 1h |
| `foodfacts` | OpenFoodFacts | image | 12h |
| `ai` | Claude → OpenAI (fallback) | none | no cache |

### Response

```json
{
  "ok": true,
  "question_pack_id": "pack_abc123def456",
  "questions": [
    {
      "id": "ext_anime_abc123def456",
      "topic": "anime",
      "lang": "en",
      "question_text": "Who is this anime character?",
      "question_type": "single_select",
      "options": [
        { "id": "A", "text": "Naruto" },
        { "id": "B", "text": "Goku" },
        { "id": "C", "text": "Luffy" },
        { "id": "D", "text": "Ichigo" }
      ],
      "correct_option_ids": ["C"],
      "has_media": true,
      "media": {
        "type": "image",
        "url": "https://cdn.example.com/luffy.jpg",
        "thumbnail_url": null,
        "duration_seconds": null,
        "mime_type": "image/jpeg"
      },
      "explanation": "Monkey D. Luffy is the main character of One Piece.",
      "difficulty": "medium"
    },
    {
      "id": "ext_opentdb_xyz789",
      "topic": "opentdb",
      "lang": "en",
      "question_text": "The Great Wall of China is visible from space.",
      "question_type": "true_false",
      "options": [
        { "id": "A", "text": "True" },
        { "id": "B", "text": "False" }
      ],
      "correct_option_ids": ["B"],
      "has_media": false,
      "media": null,
      "explanation": "This is a common myth.",
      "difficulty": "easy"
    }
  ],
  "meta": {
    "topic": "anime",
    "source": "cache",
    "count": 10,
    "cache_age_seconds": 3420
  }
}
```

**Question type rules (enforced server-side):**

| `question_type` | `correct_option_ids` | Options count |
|---|---|---|
| `single_select` | exactly 1 | 4 |
| `multiple_select` | 2 or more | 4–6 |
| `true_false` | exactly 1 (`"A"` or `"B"`) | exactly 2 |

**Media rules:**

| `has_media` | `media` | Unity renders |
|---|---|---|
| `false` | `null` | Text-only question |
| `true` + `type: "image"` | `{ url, mime_type }` | Image above question |
| `true` + `type: "audio"` | `{ url, duration_seconds, mime_type }` | Audio player |
| `true` + `type: "video"` | `{ url, thumbnail_url, duration_seconds, mime_type }` | Video player |

---

## RPC 2 — `quizverse_submit_result`

### Request

```json
{
  "question_pack_id": "pack_abc123def456",
  "answers": [
    {
      "question_id": "ext_anime_abc123def456",
      "selected_option_ids": ["C"],
      "time_taken_ms": 4200
    },
    {
      "question_id": "ext_opentdb_xyz789",
      "selected_option_ids": ["B"],
      "time_taken_ms": 1800
    }
  ],
  "game_mode": "classic",
  "session_id": "optional-session-id",
  "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "country_code": "US"
}
```

> **Security boundary — `user_id` is intentionally absent.**  
> Identity is resolved from `ctx.userId` (JWT). The pack is looked up by `(pack_id, ctx.userId)` — a user cannot grade another user's pack even if they know the pack ID.

| Field | Type | Required | Notes |
|---|---|---|---|
| `question_pack_id` | string | yes | From `get_questions` response — server looks up the pack |
| `answers` | array | yes | One entry per question answered |
| `answers[].question_id` | string | yes | Must match an ID from the pack |
| `answers[].selected_option_ids` | string[] | yes | What the player chose |
| `answers[].time_taken_ms` | int | no | Per-question timing |
| `game_mode` | string | no | For analytics and reward routing |
| `session_id` | string | no | Multiplayer session reference |
| `game_id` | string (UUID) | no | Same validation as `get_questions`; must match `game_id` on the stored pack or `invalid_request` is returned |
| `country_code` | string | no | ISO 3166-1 alpha-2 hint. Used for regional leaderboard routing and analytics segmentation. Same trust hierarchy as `get_questions`. |

### Response

```json
{
  "ok": true,
  "score": {
    "correct": 8,
    "total": 10,
    "accuracy_pct": 80,
    "time_bonus": 150
  },
  "graded_answers": [
    {
      "question_id": "ext_anime_abc123def456",
      "selected_option_ids": ["C"],
      "correct_option_ids": ["C"],
      "is_correct": true,
      "time_taken_ms": 4200
    }
  ],
  "rewards": {
    "xp_earned": 240,
    "coins_earned": 80,
    "new_level": null,
    "streak_updated": true,
    "badges_earned": []
  },
  "leaderboard": {
    "rank": 142,
    "score_submitted": 8
  },
  "kb_recorded": true
}
```

**What Nakama does internally on submit (Unity never sees this):**

```
1.  Load question pack from storage (by question_pack_id + userId)
2.  Grade each answer against server-stored correct_option_ids
3.  Compute score + time bonus
4.  Write graded_answers[] back into the pack document    ← enables get_review later
     pack.graded_answers = [{ question_id, selected_option_ids,
                               correct_option_ids, is_correct, time_taken_ms }]
     pack.submitted = true
5.  Update Hiro progression XP (hiro_progression_add_xp)
6.  Update wallet coins (hiro_economy_spend / wallet_update_game_wallet)
7.  Submit to leaderboard (submit_leaderboard_score)
8.  Record to Knowledge Base (qv_kb collections — topic strength, weak areas)
9.  Log analytics event (analytics_log_event)
10. Update seen-questions ledger (quizverse_seen_merge)
11. Return graded result + rewards to Unity
```

> Step 4 is the only change to the submit flow required by Review & Learn. It adds one field to an already-written storage document — zero extra collections, zero extra RPCs at submit time.

---

## RPC 3 — `quizverse_get_review`

### How the existing popup works (context)

`LearningGamesPopup.cs` (`Popup_Canvas/LearningGamesPopup`) is **already built and fully functional**. It:

- Takes `List<IncorrectAnswer>` via `Show(incorrectAnswers)`
- Offers 4 mini-game modes the player picks from a selection screen:
  - **Letter Scramble** — unscramble letters of the correct answer
  - **Fill in the Blanks** — fill in missing letters with blanks hint
  - **MCQ Trainer** — re-practice the question as multiple choice
  - **Speed Typing** — type the correct answer fast
- Navigates prev/next between all wrong questions (1/N counter)
- Generates all mini-game configs locally from `IncorrectAnswer` data
- Handles its own animation, back-button, UI hide/restore, and analytics

**Nothing about the popup changes.** The only change is the **data source**:

| Before | After |
|---|---|
| `WrongAnswerTracker` (client-side session tracker) | `quizverse_get_review` RPC (server, authoritative) |
| Data is ephemeral — gone if app restarts | Data is stored in pack — survives restarts |
| Tracks only current session | Can be called for any past submitted pack |

### When Unity calls it

After `quizverse_submit_result` returns, the result screen counts `wrong_count` from `graded_answers`. If `wrong_count > 0`, show the "Review & Learn" button. On tap → call `quizverse_get_review` → feed response into `LearningGamesPopup.Show()`.

### Request

```json
{
  "question_pack_id": "pack_abc123def456",
  "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `question_pack_id` | string | yes | Must belong to `ctx.userId` and be already submitted |
| `game_id` | string | no | Same validation as other RPCs; defaults to env `DEFAULT_GAME_ID` |

> `filter` is hardcoded to `"wrong_only"` server-side — this RPC always returns only wrong answers. No need to expose the filter; the popup is Review & Learn, not a full history viewer.

### Response

```json
{
  "ok": true,
  "topic": "anime",
  "summary": {
    "correct": 7,
    "total": 10,
    "wrong_count": 3
  },
  "review_items": [
    {
      "question_id": "ext_anime_abc123def456",
      "question_text": "Who is the captain of the Straw Hat Pirates?",
      "question_type": "single_select",
      "correct_answer_texts": ["Luffy"],
      "player_answer_texts": ["Zoro"],
      "all_options": ["Zoro", "Nami", "Luffy", "Usopp"],
      "image_url": "https://cdn.example.com/luffy.jpg",
      "topic": "anime",
      "difficulty": 1,
      "explanation": "Monkey D. Luffy is the founder and captain of the Straw Hat Pirates.",
      "eligible_game_modes": ["letter_scramble", "fill_in_blanks", "mcq_trainer", "speed_typing"]
    }
  ]
}
```

> **Why these exact fields?** They map 1-to-1 to Unity's existing `IncorrectAnswer` class — no new Unity model needed:
>
> | RPC field | `IncorrectAnswer` field | Notes |
> |---|---|---|
> | `question_text` | `QuestionText` | |
> | `correct_answer_texts[0]` | `CorrectAnswer` | For `single_select` + `true_false`. Join with ", " for `multiple_select`. |
> | `player_answer_texts[0]` | `PlayerAnswer` | |
> | `all_options` | `AllOptions` (string[]) | |
> | `image_url` | `ImageUrl` | |
> | `topic` | `Category` | |
> | `difficulty` | `Difficulty` (0=easy, 1=medium, 2=hard) | |
> | `eligible_game_modes` | Passed to `LearningGamesPopup` to disable incompatible modes | `multiple_select` → no LetterScramble, no FillInBlanks |

### What Nakama does internally

```
1. resolveContext()               → userId, gameId
2. read qv_question_packs         → load pack (written by get_questions, updated by submit_result)
3. guard: pack.submitted == true  → else return pack_not_submitted
4. guard: pack.userId == ctx.userId → else return unauthorized
5. for each graded_answer where is_correct == false:
     find matching question in pack.questions[] by question_id
     resolve correct_answer_texts = correct_option_ids.map(id → options[id].text)  (array, not single string)
     resolve player_answer_texts  = selected_option_ids.map(id → options[id].text)
     build all_options             = question.options[].text  (all texts, original server order)
     extract image_url             = question.media.url  (null if has_media == false)
     map difficulty                = "easy"→0, "medium"→1, "hard"→2
     compute eligible_game_modes:
       if question_type == "multiple_select":
         eligible = ["mcq_trainer", "speed_typing"]   (NOT letter_scramble or fill_in_blanks)
       else:
         eligible = ["letter_scramble", "fill_in_blanks", "mcq_trainer", "speed_typing"]
6. return review_items[]
```

**No new storage collection.** Reads `qv_question_packs` — already written by `get_questions`, already has `graded_answers` from `submit_result`. Zero extra infrastructure.

### Unity — wiring (minimal changes)

```
QuizResultScreen.cs  (modify — small)
  ├── wrong_count = graded_answers.Count(a => !a.is_correct)
  ├── if wrong_count > 0 → show "Review & Learn" button
  └── on button tap:
        StartCoroutine(QuizDeliveryService.GetReview(packId))
          → deserialize GetReviewResponse
          → map review_items[] → List<IncorrectAnswer>
          → LearningGamesPopup.Show(incorrectAnswers)     ← existing API, no changes

// Mapping (one-time, in QuizDeliveryService or a mapper class):
var incorrectAnswers = response.review_items.ConvertAll(item => new IncorrectAnswer {
    QuestionText  = item.question_text,
    CorrectAnswer = item.correct_answer_text,
    PlayerAnswer  = item.player_answer_text,
    AllOptions    = item.all_options,
    ImageUrl      = item.image_url,
    Category      = item.topic,
    Difficulty    = item.difficulty
});
learningGamesPopup.Show(incorrectAnswers);
```

**`LearningGamesPopup.cs` — zero changes needed.** It already handles all 4 game modes, navigation, animation, and cleanup. The popup generates its own `LearningGameConfig` objects locally from `IncorrectAnswer` — that stays client-side (it's pure UI game logic).

### What gets removed from Unity

| Remove | Why |
|---|---|
| `WrongAnswerTracker` reads in result screen | Replaced by `GetReview()` RPC call |
| Any code that feeds `WrongAnswerTracker` during quiz play | Server grades answers; tracker is no longer the source of truth |
| `ShowFromTracker()` call path | Replaced by `Show(mappedIncorrectAnswers)` |

`WrongAnswerTracker` itself can stay if other systems use it — just stop feeding `LearningGamesPopup` from it.

---

## Error Codes

Both RPCs return the same error shape:

```json
{ "ok": false, "error": "rate_limited", "error_detail": "Max 5 packs per minute." }
```

| Code | RPC | Meaning |
|---|---|---|
| `unauthorized` | both | No valid Nakama session |
| `invalid_request` | both | Missing or bad field |
| `unknown_topic` | get | Topic not in allowed list |
| `unsupported_media_type` | get | Topic doesn't support requested media |
| `provider_unavailable` | get | External API down or quota exhausted |
| `provider_timeout` | get | External API too slow |
| `empty_result` | get | Provider returned 0 usable items |
| `rate_limited` | both | Too many requests per user |
| `pack_not_found` | submit, review | `question_pack_id` doesn't exist, expired, or `game_id` mismatch |
| `pack_already_submitted` | submit | Duplicate submit prevented |
| `pack_expired` | submit | Pack older than 24h — session abandoned too long |
| `pack_not_submitted` | review | `get_review` called before `submit_result` — pack not graded yet |
| `invalid_game_id` | all | `game_id` not in `ALLOWED_GAME_IDS` |
| `internal_error` | all | Unexpected server error |

---

## Identity & Context Resolution

*Both RPCs share an identical context resolution step that runs before any business logic. This section defines it precisely so it is implemented once and reused.*

---

### Why `user_id` Is Never a Request Field

Nakama authenticates every RPC call with a session token (JWT). The server extracts a verified `userId` from `ctx.userId`. This value is:

- **Cryptographically signed** — cannot be forged without the server secret.
- **Already present** — no round-trip or extra lookup needed.
- **The only identity that matters** — all storage reads/writes use this value.

Accepting a `user_id` field from the client body would let any authenticated user craft a request with a different player's UUID, silently reading their seen ledger, submitting results against their packs, and corrupting their Elo and knowledge base. This class of vulnerability (Insecure Direct Object Reference, IDOR) is in the OWASP Top 10.

**Rule: `ctx.userId` is the only user identity source in this system. Any `user_id` field in a request body is rejected with `invalid_request`.**

---

### `game_id` Resolution

```
Client sends: req.game_id = "126bf539-dae2-4bcf-964d-316c0fa1f92b"  (optional)

Server resolution:
  1. If req.game_id is absent → use env.DEFAULT_GAME_ID
  2. If req.game_id is present → validate against ALLOWED_GAME_IDS (env var, JSON array)
     - Match found  → use req.game_id
     - No match     → reject with { "ok": false, "error": "invalid_request",
                                    "error_detail": "Unknown game_id." }
```

**What `game_id` drives:**

| Subsystem | How game_id is used |
|---|---|
| Leaderboard | Routes to the correct leaderboard namespace per game |
| Wallet / XP | Credits XP and coins to the correct game's progression |
| Analytics | Tags every `analytics_log_event` call with the originating game |
| Pack storage | Pack key is namespaced: `{game_id}_{pack_id}` → prevents cross-game pack theft |
| `submit_result` guard | Verifies `req.game_id == pack.game_id` before grading; mismatch → `invalid_request` |

**Environment config:**

```yaml
# docker-compose.yml — RUNTIME_ENV_KEYS
DEFAULT_GAME_ID=126bf539-dae2-4bcf-964d-316c0fa1f92b
ALLOWED_GAME_IDS=["126bf539-dae2-4bcf-964d-316c0fa1f92b","<lasttolive-uuid>"]
```

---

### `country_code` Resolution

The client is never the authoritative source of country. It provides a *hint* that is reconciled against more-trusted signals.

```
Trust hierarchy (highest → lowest):

  1. player_profile.country_code   (stored at onboarding / profile update — most trusted)
  2. req.country_code              (client hint, ISO 3166-1 alpha-2, e.g. "US", "IN", "JP")
  3. IP geolocation                (derived from ctx or HTTP headers in Nakama's request context)
  4. "US"                          (hard default — never null, downstream code never needs a null check)

Resolution pseudocode:
  const stored = readPlayerProfile(nk, userId).country_code;
  const resolved = stored
    || (isValidIso3166(req.country_code) ? req.country_code : null)
    || geoLookup(ctx.clientIp)
    || "US";
```

**What `country_code` drives:**

| Subsystem | How country_code is used |
|---|---|
| Content filtering | Some providers return region-locked media URLs; filter these out for affected regions |
| CDN / S3 routing | Questions with S3 media are served from the nearest regional bucket when configured |
| Regional leaderboards | Leaderboard score can be submitted to both global + country-specific boards |
| Analytics segmentation | Every analytics event tagged with `country_code` for geo funnel analysis |
| Regulatory flags | GDPR regions (`EU`, `GB`, etc.) suppress analytics PII fields; COPPA flag for `US` under-13 |
| Language fallback | If `lang` is not available in provider, fallback to the country's dominant language |

**Validation:**

```typescript
const ISO3166_ALPHA2 = /^[A-Z]{2}$/;

function resolveCountryCode(stored: string | null, hint: string | null, ip: string): string {
  if (stored && ISO3166_ALPHA2.test(stored)) return stored;
  if (hint  && ISO3166_ALPHA2.test(hint))   return hint;
  const geo = geoLookup(ip);                               // MaxMind or headers
  if (geo   && ISO3166_ALPHA2.test(geo))    return geo;
  return "US";
}
```

**Invalid country codes are silently demoted** to the next level in the hierarchy. They are never rejected with an error — a bad country hint should not block a user from playing.

---

### Resolved Context Object

After step 0 completes, both RPCs operate on a single resolved context object:

```typescript
interface ResolvedContext {
  userId:      string;   // ctx.userId — verified JWT identity
  gameId:      string;   // validated UUID from req or env default
  countryCode: string;   // ISO 3166-1 alpha-2, never null
  lang:        string;   // ISO 639-1, never null (default: "en")
}
```

Every downstream function (provider fetch, seen ledger read, pack write, analytics event, leaderboard submit) receives this object. No function re-reads the raw request for identity fields.

---

## Seen / Deduplication System

The `qv_seen` system is already built and solid. It is **fully internal** — Unity never calls it directly in the new design. Here is exactly how it works and how the two RPCs use it.

### Storage Layout

```
Collection : qv_seen
Key        : {scope_slug}_{topic_slug}   e.g. "global_anime", "daily_science"
Owner      : per userId
Max size   : 10,000 question IDs per key (oldest dropped when exceeded)
TTL        : no automatic expiry — staleness handled by repeat_after_days logic
```

One storage document per (user, scope, topic). A user who plays anime and pokemon has two separate ledgers. A user who plays the daily quiz and pick-a-topic science has two more.

### What Each ID Entry Contains

```json
{
  "ids": {
    "ext_anime_abc123def456": "2026-06-26T10:30:00Z",
    "ext_anime_xyz789abc012": "2026-04-01T08:15:00Z"
  },
  "version": 2
}
```

Each question ID maps to the ISO-8601 timestamp it was last seen. This lets the staleness check compare `(now - seen_at) > 90 days` to decide if a question can be repeated.

### Repeat Window

**90 days** (was 30, bumped up to reduce repetition).  
A question seen more than 90 days ago is treated as "fresh" again and re-enters the available pool via the backfill path.

### How `quizverse_get_questions` Uses It

```
1. Read ledger → build seenIdSet { questionId: true }   (O(1) lookup)
2. Purge entries older than 90 days from the ledger      (reduces storage bloat)
3. Filter provider pool: keep only IDs not in seenIdSet
4. If unseen pool ≥ count requested → serve from unseen
5. If unseen pool < count needed    → backfill:
     sort seen by oldest timestamp first
     prepend oldest N to fill the gap
     these will be re-marked seen on submit
6. Serve the selected questions
```

**Seen ledger is NOT written here.** A player who starts a quiz but quits before submitting does not have those questions permanently consumed. The ledger is only updated on a successful submit.

### How `quizverse_submit_result` Uses It

```
After grading:
  __qvsSeen.merge(nk, userId, scope, topic, [all answered question IDs])
    → reads ledger with version token (OCC)
    → sets each ID → ISO timestamp of now
    → if ledger > 10,000 entries → drops oldest to stay under cap
    → writes back with version check (3 retries on conflict)
```

### Concurrency Safety (OCC)

Two quiz sessions finishing at the exact same moment cannot corrupt the ledger. The write carries the version token read at the start. If another process wrote first, the version mismatches and the write retries (up to 3 times) with a fresh read. This prevents the "last writer wins and loses the other session's IDs" race condition.

### RPCs Unity Can Still Call (Debug / Profile)

| RPC | When Unity calls it | What it returns |
|---|---|---|
| `quizverse_seen_stats` | Profile screen / settings | Total seen count per topic: `{ "global_anime": 142, "global_news": 38 }` |
| `quizverse_seen_reset` | Settings → "Reset my question history" | Clears one topic ledger so questions feel fresh |
| `quizverse_seen_get` | Debug/admin only | Full ledger for one scope+topic |

### What Unity Does NOT Need to Call

| RPC | Why not needed |
|---|---|
| `quizverse_seen_merge` | `quizverse_submit_result` does this automatically |
| `quizverse_seen_purge` | `quizverse_get_questions` does this automatically |

---

## Knowledge Base Integration

After `quizverse_submit_result`, Nakama writes to the KB:

```
qv_kb collections (per userId):
  qv_u_{userId}_topics     → topic performance (accuracy per topic)
  qv_u_{userId}_questions  → per-question history (seen, correct/wrong)
  qv_u_{userId}_strengths  → strong topic areas
  qv_u_{userId}_weaknesses → weak topic areas
```

Unity reads the KB separately via existing RPCs (not affected by this migration):
- `qv_kb_user_summary` — light summary for Knowledge Graph screen
- `qv_kb_user_dump` — full dump for detailed KB view
- `qv_kb_user_kind` — single-kind drill-down

---

## Implementation Plan

### Phase 0 — Nakama: `quizverse_get_config` RPC + Admin Stats · 1 day

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/get_config.ts` | **Create** — read `qv_config/global` from storage; return topic list, features, supported_langs, client_min_version; fallback to built-in defaults if doc missing |
| 2 | `src/games/quizverse/admin_stats.ts` | **Create** — admin-only RPC; returns cache health per topic, circuit breaker states, active pack counts |
| 3 | `src/games/quizverse/migration.ts` | Register `quizverse_get_config` and `quizverse_admin_stats` RPCs |
| 4 | Nakama Console | Create initial `qv_config/global` document with all 20 topics, enabled=true |

### Phase 1a — Nakama: Cache Layer · 2 days

*Fetch from providers, normalize once, store ready-to-serve pools. This runs on cache miss and on a background cron — never inline on a player request.*

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/question_cache.ts` | **Create** — `refreshCache(topic)`: fetch provider → normalize → **quality gate** (`validateQuestion()`) → explanation enrichment → shuffle options → assign A/B/C/D → write `qv_cache_{topic}` (max 50 per doc, paginate if needed) |
| 2 | `src/games/quizverse/question_cache.ts` | Add `readCache(topic)`: read `qv_cache_{topic}` → return validated + normalized pool |
| 3 | `src/games/quizverse/question_cache.ts` | Add per-topic TTL map; stagger refresh (1 topic per 2s); exponential backoff on 429; keep stale on failure |
| 4 | `src/games/quizverse/quality_gate.ts` | **Create** — `validateQuestion(q)`: check all 6 quality rules; `htmlDecode(text)`: strip HTML entities |
| 5 | `docker-compose.yml` | Add all provider keys to `RUNTIME_ENV_KEYS`: `JIKAN_BASE_URL`, `NASA_API_KEY`, `TMDB_API_KEY`, etc. |
| 6 | `.env` | Move ALL provider API keys out of Unity into here |

### Phase 1b — Nakama: `quizverse_get_questions` RPC · 1 day

*Serve layer — read pre-normalized cache, filter seen, pick N, persist pack. No parsing, no conversion.*

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/get_questions.ts` | **Create** — rate limit check → pack limit (max 3 active) → lang validation → `readCache` → filter (seen ∪ inflight) → pick N → write inflight entry → write pack → return |
| 2 | `src/games/quizverse/get_questions.ts` | Add `lang_actual` to response when `lang` falls back to "en" |
| 3 | `src/games/quizverse/migration.ts` | Wire `quizverse_get_questions` registration |
| 4 | Test: cache hit (<100ms), cache miss (triggers refresh), seen filter, inflight filter, pack limit, rate limit |

### Phase 2 — Nakama: New `quizverse_submit_result` RPC · 2 days

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/submit_result.ts` | **Create** — unified submit handler |
| 2 | `src/games/quizverse/submit_result.ts` | After grading, write `graded_answers[]` + `submitted: true` back into pack doc |
| 3 | `src/games/quizverse/migration.ts` | Wire `quizverse_submit_result` registration |
| 4 | Test scoring, XP, wallet, leaderboard, KB write, graded_answers persistence |

### Phase 2.5 — Nakama: New `quizverse_get_review` RPC · 0.5 days

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/get_review.ts` | **Create** — read pack + graded_answers, hydrate review_items, format learn_card |
| 2 | `src/games/quizverse/migration.ts` | Wire `quizverse_get_review` registration |
| 3 | Test: wrong-only filter, all filter, pack_not_submitted guard, ownership guard |

### Phase 3 — Unity: Delete dead code + wire new RPCs · 2 days

**Deletions first — remove everything that is no longer Unity's job:**

| Step | File | Action |
|---|---|---|
| 1 | `ExternalQuizApiService.cs` | **DELETE entire file** — provider HTTP calls are now server-only |
| 2 | Any `.cs` file | Delete all `using` references to `ExternalQuizApiService` |
| 3 | Any `.cs` file | Delete all provider URL constants (`JIKAN_URL`, `POKEAPI_URL`, `NASA_URL`, etc.) |
| 4 | Any `.cs` file | Delete all API key constants or `PlayerPrefs` reads for API keys |
| 5 | Any `.cs` file | Delete any JSON parsing classes for provider-specific formats (JikanResponse, PokeApiResponse, etc.) |
| 6 | Any `.cs` file | Delete any question format conversion or option remapping logic |
| 7 | Any `.cs` file | Delete any option shuffling / scrambling code |

**Wire new RPCs:**

| Step | File | Action |
|---|---|---|
| 8 | `QuizDeliveryService.cs` | Replace all provider calls with single `NakamaClient.RPC("quizverse_get_questions", payload)` |
| 9 | `QuizDeliveryService.cs` | Add `GetReview(packId, filter)` method → RPC `quizverse_get_review` |
| 10 | `QuizSubmissionService.cs` | Replace submit logic with `NakamaClient.RPC("quizverse_submit_result", payload)` |
| 11 | `QuizResultScreen.cs` | Show "Review & Learn" button when `wrong_count > 0`; on tap → call `GetReview` → map → `LearningGamesPopup.Show(incorrectAnswers)` |
| 12 | `QuizDeliveryService.cs` | Add mapper: `review_items[]` → `List<IncorrectAnswer>` for popup |
| Note | `LearningGamesPopup.cs` | **NO CHANGES** — popup already works; just change the data source from `WrongAnswerTracker` to the RPC response |

**Unity question model — ONE class, used everywhere:**

```csharp
// This is the only question class Unity needs. No provider-specific classes.
[Serializable]
public class QuizQuestion {
    public string id;
    public string topic;
    public string question_text;
    public QuizOption[] options;      // [{ id:"A", text:"..." }, ...]
    public string[] correct_option_ids;
    public bool has_media;
    public QuizMedia media;           // null when has_media=false
    public string explanation;
    public string difficulty;
}

[Serializable]
public class QuizOption {
    public string id;    // "A", "B", "C", "D"
    public string text;
}

[Serializable]
public class QuizMedia {
    public string type;           // "image", "audio", "video"
    public string url;
    public string thumbnail_url;
    public float duration_seconds;
    public string mime_type;
}
```

### Phase 4 — Cleanup · 1 day

| Step | Action |
|---|---|
| | Mark old RPCs deprecated in comments (do not delete until all clients migrated) |
| | `rg "jikan.moe\|pokeapi.co\|api.nasa.gov\|tmdb.org\|disneyapi.dev\|gnews.io\|opentdb.com" Assets/` must return **zero results** |
| | `rg "API_KEY\|ApiKey\|api_key" Assets/` must return **zero results** |
| | `rg "ExternalQuizApiService\|JikanResponse\|PokeApiResponse" Assets/` must return **zero results** |
| | `rg "ShuffleOptions\|ScrambleOptions\|NormalizeQuestion\|ConvertQuestion" Assets/` must return **zero results** |
| | Confirm `QuizQuestion.cs` is the only question model class in the Unity project |

---

## Files Involved

**Nakama (create):**
```
data/modules/src/games/quizverse/get_config.ts         ← topic list, features, lang support (zero-update config)
data/modules/src/games/quizverse/admin_stats.ts        ← admin-only cache health + circuit breaker status
data/modules/src/games/quizverse/question_cache.ts     ← fetch + quality gate + normalize + enrich + store
data/modules/src/games/quizverse/quality_gate.ts       ← validateQuestion(), htmlDecode()
data/modules/src/games/quizverse/get_questions.ts      ← serve: rate limit → pack limit → read cache → filter → pick → pack
data/modules/src/games/quizverse/submit_result.ts      ← grade + rewards + seen update + inflight cleanup
data/modules/src/games/quizverse/get_review.ts         ← review cards + eligible_game_modes from submitted pack
data/modules/src/games/quizverse/context_resolver.ts   ← userId / gameId / countryCode resolution
```

**Nakama (modify):**
```
data/modules/src/games/quizverse/migration.ts   ← register three new RPCs
docker-compose.yml                              ← add all provider API keys to RUNTIME_ENV_KEYS
.env                                            ← add all provider API key values (moved from Unity)
```

**Unity (DELETE — these files are entirely removed):**
```
Assets/_QuizVerse/Scripts/Services/ExternalQuizApiService.cs   ← DELETE
```

**Unity (create):**
```
Assets/_QuizVerse/Scripts/Models/QuizQuestion.cs      ← single question model, replaces all provider-specific classes
```

> `LearningGamesPopup.cs` already exists and is fully built. No new review screen needed.

**Unity (modify — remove dead code, wire new RPCs):**
```
Assets/_QuizVerse/Scripts/Services/QuizDeliveryService.cs   ← replace provider calls with get_questions RPC; add GetReview()
Assets/_QuizVerse/Scripts/Services/QuizSubmissionService.cs ← replace with submit_result RPC
Assets/_QuizVerse/Scripts/UI/QuizResultScreen.cs            ← add "Review & Learn" button logic
```

---

## Done Criteria

**Four-RPC contract**
- [ ] Unity calls only `quizverse_get_config`, `quizverse_get_questions`, `quizverse_submit_result`, and `quizverse_get_review`
- [ ] All 20 topics return the same normalized question shape via `quizverse_get_questions`
- [ ] `has_media: true` questions contain a valid `media.url`
- [ ] `has_media: false` questions have `media: null`

**`quizverse_get_config` — zero client update for content changes**
- [ ] Unity topic picker is rendered 100% from `get_config` response — zero hardcoded topic list in Unity
- [ ] Adding a new topic to `qv_config/global` in Nakama Console appears in Unity on next app open, no APK/IPA release
- [ ] `topics[].enabled: false` hides the topic in Unity immediately
- [ ] `features.review_and_learn: false` hides the "Review & Learn" button without a client update
- [ ] `supported_langs` drives which topics show a language selector
- [ ] `client_min_version` triggers an update prompt when client version is below the minimum

**Quality gate — no garbage questions reach users**
- [ ] Questions with empty `question_text` are rejected at cache-write time
- [ ] Questions where `correct_option_ids` is not in `options[].id` are rejected
- [ ] Duplicate question texts within the same topic pool are deduplicated
- [ ] HTML entities in question text are decoded before storage
- [ ] Every question in `qv_cache_{topic}` has a non-empty `explanation` field
- [ ] `explanation` is generated from structured provider data or Claude when provider returns none

**Storage hygiene and anti-abuse**
- [ ] A user cannot have more than 3 active (non-submitted) packs at any time — oldest is deleted on overflow
- [ ] `qv_inflight_{userId}` prevents the same question appearing in two back-to-back sessions (phantom read guard)
- [ ] `get_questions` is rate-limited to 5 calls per user per minute
- [ ] Cache refresh staggers one topic per 2 seconds — no provider rate limit spikes
- [ ] Cache documents are capped at 50 questions; paginated if more needed

**Observability**
- [ ] `quizverse_admin_stats` returns cache question count, last_refreshed_at, and stale flag per topic
- [ ] `quizverse_admin_stats` returns circuit breaker state per provider
- [ ] `quizverse_admin_stats` returns total active pack count and orphaned pack count

**Review & Learn — multi-select fix**
- [ ] `get_review` returns `correct_answer_texts: string[]` (array) not a single string
- [ ] `eligible_game_modes` excludes `letter_scramble` and `fill_in_blanks` for `multiple_select` questions
- [ ] Unity uses `eligible_game_modes` to disable incompatible game type buttons in `LearningGamesPopup`

**Unity Pure Renderer — nothing from this list may exist in any `.cs` file**
- [ ] `ExternalQuizApiService.cs` is deleted — confirmed gone from the repository
- [ ] Zero provider URLs in Unity (`jikan.moe`, `pokeapi.co`, `api.nasa.gov`, `tmdb.org`, etc.)
- [ ] Zero API key strings or constants in Unity
- [ ] Zero provider-specific model classes (`JikanResponse`, `PokeApiResponse`, `NasaApodResponse`, etc.)
- [ ] Zero question format conversion or normalization logic in Unity
- [ ] Zero option shuffling or correct-answer remapping logic in Unity
- [ ] `QuizQuestion.cs` is the single question model used everywhere in Unity
- [ ] Unity renders `options[]` exactly as received — no reordering client-side

**Identity & Context Resolution**
- [ ] No RPC accepts or acts on a `user_id` request field — identity is exclusively `ctx.userId`
- [ ] `game_id` is validated against `ALLOWED_GAME_IDS` on every call; unknown values return `invalid_request`
- [ ] `game_id` defaults to `env.DEFAULT_GAME_ID` when omitted
- [ ] `country_code` resolution hierarchy works: stored profile → client hint → IP-geo → "US"
- [ ] Invalid ISO 3166-1 country codes in the request are silently demoted (no error returned)
- [ ] Pack keys are namespaced as `{game_id}_{pack_id}` — cross-game pack submission returns `pack_not_found`
- [ ] Player DNA key is namespaced as `{game_id}` — two games produce two isolated DNA documents per user
- [ ] `country_code` is stored in Player DNA and updated when a more-trusted source changes it
- [ ] Every `analytics_log_event` call carries `game_id` and `country_code` from the resolved context
- [ ] Regional leaderboard routing uses `country_code` from the resolved context (not the raw request field)

**Server-side grading**
- [ ] `quizverse_submit_result` grades from the persisted pack (client cannot manipulate answers)
- [ ] XP, coins, leaderboard, and KB are updated on every submit
- [ ] No duplicate submit possible (`pack_already_submitted` guard)

**Seen / deduplication**
- [ ] Questions already answered by a user are not served again within 90 days
- [ ] Seen ledger is written only on submit — not on get (abandoned sessions don't consume questions)
- [ ] Pool exhaustion path works: backfills from oldest-seen when all questions have been seen
- [ ] Ledger cap enforced: no ledger exceeds 10,000 IDs per topic
- [ ] OCC conflict on simultaneous submits resolves without data loss
- [ ] `quizverse_seen_stats` returns correct per-topic seen counts for profile screen
- [ ] `quizverse_seen_reset` clears ledger and next `get_questions` returns fresh questions

**Review & Learn**
- [ ] `submit_result` writes `graded_answers[]` + `submitted: true` back into the pack document
- [ ] `quizverse_get_review` returns `review_items[]` only for `ctx.userId`'s own packs (ownership guard)
- [ ] `pack_not_submitted` is returned when `get_review` is called before `submit_result`
- [ ] `review_items` contains only `is_correct: false` entries — server always filters to wrong-only
- [ ] `correct_answer_text` is the resolved option text string (e.g. `"Luffy"`), not the option ID (`"C"`)
- [ ] `player_answer_text` is the resolved option text string of what the player chose
- [ ] `all_options` is a `string[]` of all 4 option texts in server-stored order
- [ ] `image_url` is the direct media URL (or `null` when `has_media: false`)
- [ ] `difficulty` is an integer: 0=easy, 1=medium, 2=hard
- [ ] Unity maps `review_items[]` → `List<IncorrectAnswer>` and calls `LearningGamesPopup.Show(incorrectAnswers)`
- [ ] `LearningGamesPopup.cs` requires zero code changes — all 4 game modes work with mapped data
- [ ] Unity "Review & Learn" button is visible only when `wrong_count > 0`; hidden (not disabled) at 100%
- [ ] All 4 learning game modes (Letter Scramble, Fill in Blanks, MCQ Trainer, Speed Typing) work with server-sourced data
- [ ] `WrongAnswerTracker` is no longer the data source for `LearningGamesPopup` — RPC response is

**Regression**
- [ ] All existing game modes work without regression
- [ ] Daily and weekly quiz flows unaffected
- [ ] Multiplayer pack flow (`quizverse_mp_request_pack`) still functions

---

---

# Part 2 — Gap Analysis & World-Class Personalization Layer

*This section documents every architectural gap found in Part 1 and defines the "Personalization Intelligence Layer" that transforms QuizVerse from a question delivery system into a compounding preference engine.*

---

## Critical Gaps in the Current Plan

### GAP-1 · Knowledge Base writes but never feeds back into question selection (CRITICAL)

**The KB records topic performance after every submit. `get_questions` never reads it.**

This means every user — whether they've played 1 session or 1,000 — gets the same random slice of the topic pool. The seen ledger only prevents repetition. It does not personalize. The system is anti-personalization by omission: it doesn't know that user A loves anime and has 87% accuracy there, or that user B has answered the same 3 countries questions wrong five times.

**Fix:** `get_questions` must read the Player DNA (see § Player DNA Model below) before selecting questions, and use it to compose the session mix.

---

### GAP-2 · No adaptive difficulty — everyone gets the same questions (CRITICAL)

There is no per-user difficulty model. A beginner and an expert playing "anime" receive questions from the same pool, in the same distribution. The expert is bored; the beginner quits.

The `difficulty` field exists in the response contract but is never used to filter or sort the pool based on user ability. It is decorative.

**Fix:** Implement a lightweight Elo model per user per topic. `get_questions` targets questions within the user's current Elo ± 200 range. `submit_result` updates both the user's topic Elo and each answered question's Elo.

---

### GAP-3 · Seen ledger treats correct and wrong answers identically (HIGH)

A question the user answered correctly and a question they got wrong are both "seen" and both equally suppressed for 90 days. This is wrong. Wrong answers should be scheduled for re-review, not suppressed. Correct answers should be suppressed (spaced repetition at increasing intervals). The current model does the opposite of what learning science demands.

**Fix:** Separate the seen ledger into two tracks:
- `correct` track → standard 90-day suppression (already implemented).
- `wrong` track → scheduled for re-review at 1d → 3d → 7d → 14d → 30d intervals (spaced repetition queue).

---

### GAP-4 · No "session mix" intelligence — topic selection is entirely client-driven (HIGH)

Unity decides the topic. Nakama delivers it. There is no server intelligence about session composition:
- No confidence mix (80% strong topics → builds confidence, 20% weak → challenges growth).
- No spaced repetition slot injection (wrong-answer reviews interleaved into any session).
- No difficulty arc (start easy → ramp up → finish strong).

**Fix:** Add an optional `mode: "personalized"` to the request. When set, Nakama ignores the `topic` field and composes the session using the Player DNA and the Mix Algorithm.

---

### GAP-5 · No pack TTL — packs live forever in storage (HIGH)

`get_questions` persists a question pack for server-side grading. There is no expiry. A user who starts a quiz and never submits creates a permanent orphaned storage object. At scale (1M MAU), this is a storage leak.

**Fix:** Write packs with a `expires_at` field set to `now + 24h`. `submit_result` rejects packs past their expiry with `pack_expired`. A daily cleanup cron purges expired packs.

---

### GAP-6 · No circuit breaker or graceful degradation for provider failures (HIGH)

The provider chain for news has GNews → Currents → MediaStack → NewsAPI. Every other topic has a single provider with no fallback. If Jikan is down, all anime questions fail with `provider_unavailable`. There is no fallback to:
- A cached previous response.
- The AI generator (`topic: "ai"` with a category hint).
- A generic `opentdb` question from the same category.

**Fix:** Per-provider circuit breaker (half-open after 30s). On open circuit, attempt the last valid cached response regardless of TTL age, then AI generation, then hard fail.

---

### GAP-7 · No question quality feedback loop (MEDIUM)

Every question is treated as equal quality forever. There is no mechanism to detect:
- Questions that are too easy (>95% accuracy across all players) → retire or flag.
- Questions that are poorly worded (>80% wrong, low time_taken → guessing) → flag for review.
- Questions that cause rage-quits (last question before an abandoned session) → flag.

**Fix:** Per-question aggregate stats updated on every `submit_result`. Questions crossing quality thresholds are auto-flagged and excluded from the pool.

---

### GAP-8 · No `personalization` signal returned to Unity (MEDIUM)

The `submit_result` response tells Unity the score, XP, and rewards. It does not tell Unity:
- What topic to suggest playing next.
- That the user has 7 wrong-answer reviews due today.
- That they have reached a mastery milestone in "anime".
- That their streak is at risk tomorrow.

Unity must make a second RPC to get this. That's one extra round-trip per session.

**Fix:** Add a `personalization` block to the `submit_result` response (zero extra RPCs, zero extra latency).

---

### GAP-9 · No variable reward architecture (MEDIUM)

All rewards are deterministic: score correctly → receive N XP and M coins. Behavioral psychology shows variable reward schedules (slot machine mechanics) drive dramatically higher engagement than fixed schedules.

**Fix:** Add server-controlled reward multipliers with low but non-zero probabilities. The server decides: the client just renders what it receives. No client-side exploit possible.

---

### GAP-10 · No pre-warming / predictive session preparation (MEDIUM)

Every `get_questions` call is cold: the server must fetch from provider, filter against the seen ledger, and normalize — all inline. For AI generation this can be 3–8 seconds. For external APIs with cache misses it can be 1–2 seconds.

**Fix:** A predictive pre-warm cron runs hourly. For every user active in the last 7 days, it pre-fetches and normalizes questions for their top 3 topics and stores them in a user-specific `qv_readyqueue` collection. When `get_questions` runs, it checks the ready queue first (sub-50ms). The queue is replenished after consumption.

---

### GAP-11 · No experiment / A/B testing layer (LOW)

There is no way to roll out a new topic, a new reward formula, or a new session composition algorithm to a subset of users. All changes are global and immediate.

**Fix:** A lightweight `experiment_cohort` value (0–99, derived from a hash of the userId) stored in the player profile. RPCs check `ctx.env['EXPERIMENT_CONFIG']` (JSON blob in env vars) to branch behavior by cohort. Zero infrastructure overhead.

---

### GAP-12 · No "cold start" strategy for new users (LOW)

A new user has no KB, no seen ledger, no Elo. `get_questions` with `mode: "personalized"` would have nothing to work from. The current plan doesn't define a cold start path.

**Fix:** Cold start is defined as: fewer than 3 sessions played. During cold start, serve a structured onboarding sequence — 3 sessions across 3 different high-engagement topics (anime, pokemon, movies) in `single_select` with `difficulty: easy`. After session 3, Player DNA bootstrapping begins from the KB data collected.

---

## The Personalization Intelligence Layer

This section defines the system that closes all 12 gaps above. It is built entirely inside Nakama. Unity calls the same two RPCs — no contract change is required for the core features. Only the **response** grows richer.

---

### Player DNA Model

**Storage:**
```
Collection : qv_player_dna
Key        : "dna"
Owner      : per userId
```

**Schema:**

```json
{
  "topic_affinity": {
    "anime":    0.87,
    "pokemon":  0.65,
    "news":     0.12,
    "countries": 0.41
  },
  "topic_mastery": {
    "anime":    0.72,
    "pokemon":  0.58
  },
  "topic_elo": {
    "anime":    1420,
    "pokemon":  1280,
    "news":     1050
  },
  "difficulty_sweet_spot": 0.65,
  "avg_session_length": 8.3,
  "session_frequency_days": 1.2,
  "preferred_question_type": "single_select",
  "media_engagement": { "image": 0.91, "audio": 0.34 },
  "peak_hours": [19, 20, 21],
  "total_sessions": 47,
  "cold_start": false,
  "last_played_topic": "anime",
  "last_played_at": "2026-06-25T19:42:00Z",
  "country_code": "JP",
  "game_id": "126bf539-dae2-4bcf-964d-316c0fa1f92b",
  "version": 12
}
```

**New fields added for context resolution:**

| Field | Type | Set by | Purpose |
|---|---|---|---|
| `country_code` | string (ISO 3166-1) | Context resolution step | Authoritative country for this user; updated when a more-trusted source (profile update) provides a new value. Used by Mix Algorithm to surface regionally-relevant content. |
| `game_id` | string (UUID) | Context resolution step | Game context in which this DNA was built. DNA is per-user per-game — a user playing both QuizVerse and LastToLive has two separate DNA documents. |

**How it is built:** `submit_result` updates the DNA on every call using an exponential moving average (EMA) — no ML infrastructure required. EMA is weighted: recent sessions have 3× the influence of old ones. DNA is OCC-safe (same version token pattern as the seen ledger).

**Topic Affinity Score (IAS) formula:**

```
IAS(topic, t) =
  0.35 × play_frequency_normalized(topic)   // how often they choose this topic
+ 0.25 × avg_accuracy(topic)               // how well they do
+ 0.25 × session_completion_rate(topic)    // do they finish or quit
+ 0.15 × recency_boost(topic, t)           // decays if not played recently
```

Affinity is re-computed on every `submit_result` and written back to the DNA.

---

### Spaced Repetition Queue (SRQ)

**Storage:**
```
Collection : qv_srq
Key        : {topic_slug}
Owner      : per userId
```

**Schema:**

```json
{
  "reviews": {
    "ext_anime_abc123": {
      "wrong_count": 3,
      "next_review_at": "2026-06-27T00:00:00Z",
      "interval_days": 7,
      "ease_factor": 1.8
    }
  },
  "version": 5
}
```

**Algorithm:** A simplified FSRS (Free Spaced Repetition Scheduler) — the same family of algorithm that powers Anki, the world's most effective flashcard app:
- First wrong answer → review in 1 day.
- Second wrong → review in 3 days.
- Third wrong → review in 7 days. Cap at 30 days.
- Correct on review → interval multiplies by `ease_factor` (1.2–2.5 range). Retired from SRQ at 30+ days with correct answer.

`get_questions` injects SRQ reviews as the first 1–3 slots of any session (regardless of topic). The player sees a "Review" badge on those questions. This is the core habit loop: every session starts with accountability for past mistakes.

---

### The Mix Algorithm

When `mode: "personalized"` is set (or in the future, as the default), `get_questions` ignores `topic` and calls the Mix Algorithm:

```
Session Budget: count = 10 (default)

Step 1 — SRQ injection (1–3 slots)
  Pull due SRQ items for this user, any topic. Cap at 3.
  
Step 2 — Confidence fill (4–5 slots)
  Topics sorted by affinity score descending.
  Draw from top 1–2 topics. Easy-medium difficulty (user Elo ± 0).
  Purpose: build momentum, feel smart, stay engaged.

Step 3 — Growth fill (2–3 slots)
  Topics sorted by (mastery_gap × affinity). High gap = needs work.
  Draw from weak areas. Medium-hard difficulty (user Elo + 100 to +250).
  Purpose: actual learning, triggers "Aha!" moments.

Step 4 — Discovery slot (1 slot)
  Random topic NOT in user's top 5 affinity.
  Difficulty: easy. Purpose: expose user to new content → fights content fatigue.
  
Total: 10 questions, composed from multiple topics, invisibly to the user.
```

Unity renders a normal question pack. The mix is transparent to the client.

---

### Adaptive Elo System

**Per-question Elo** is stored in a shared collection (not per-user):
```
Collection : qv_question_elo
Key        : {question_id}
Owner      : system (public read)
Value      : { "elo": 1350, "attempts": 2841, "accuracy": 0.61 }
```

**Per-user topic Elo** is stored in the DNA.

**Elo update on submit_result:**

```
K = 32   (standard chess K-factor for provisional players)
K = 16   (after 30 games on this topic — stable rating)

Expected = 1 / (1 + 10^((question_elo - user_elo)/400))
user_elo_new   = user_elo   + K × (actual - Expected)
question_elo_new = question_elo + K × (Expected - actual)

actual = 1 if correct, 0 if wrong
```

`get_questions` filters questions to user_elo ± 200 range. This creates the "zone of proximal development" — optimal challenge where engagement peaks.

---

### Pack TTL & Storage Hygiene

```
Pack expiry  : now + 24 hours (written as expires_at field)
Cleanup cron : analytics_cron — daily at 03:00 UTC
  → scans qv_question_packs where expires_at < now, deletes in batches of 100
Pack reject  : submit_result checks expires_at before grading (returns pack_expired)
```

---

### Variable Reward Engine

`submit_result` draws from a server-controlled reward table. Unity renders whatever the server sends — no client-side logic.

```
Reward event         | Probability | Trigger condition
---------------------|-------------|--------------------------------------------------
Standard reward      | always      | Base XP + coins formula
Lucky multiplier 2×  | 5%          | Random draw, displayed as "Lucky Quiz!"
Hot streak bonus     | streak ≥ 7  | +50% XP while streak active
Topic mastery unlock | threshold   | First time accuracy ≥ 80% over 20+ questions
Discovery reward     | discovery   | First time playing a new topic (+100 coins)
Comeback bonus       | gap ≥ 3d    | User returns after 3+ days absence (2× coins)
Perfect round        | 100% correct | Rare badge + 3× coins for that session
```

All probabilities and thresholds live in `ctx.env['REWARD_CONFIG']` — tunable without deployment.

---

### Personalization Block in `submit_result` Response

Add one new optional block. Unity uses it to drive the home screen and push notifications:

```json
"personalization": {
  "next_suggested_topic": "pokemon",
  "next_suggested_reason": "starter",
  "review_due_count": 3,
  "mastery_delta": { "anime": { "before": 0.68, "after": 0.72 } },
  "streak_at_risk": false,
  "discovery_unlock": null,
  "engagement_message": "You're on fire! 87% accuracy today."
}
```

| Field | What Unity does with it |
|---|---|
| `next_suggested_topic` | Highlighted on the home screen topic picker |
| `review_due_count` | Badge on the "Review" button — creates urgency |
| `mastery_delta` | Animates the topic mastery bar on the result screen |
| `streak_at_risk` | Triggers a "Don't break your streak!" push notification |
| `discovery_unlock` | Shows a "New topic unlocked!" card |
| `engagement_message` | Displayed as a dynamic title on the result screen |

---

### Question Quality Signals

Per-question aggregate stats stored in `qv_question_elo` (extends existing schema):

```json
{
  "elo": 1350,
  "attempts": 2841,
  "accuracy": 0.61,
  "avg_time_ms": 4200,
  "abandon_rate": 0.03,
  "flags": 0,
  "quality_status": "active"
}
```

`submit_result` updates these stats asynchronously (fire-and-forget storage write, non-blocking).

Auto-retirement thresholds (configurable in env):
- `accuracy > 0.98` for 100+ attempts → retire (too easy, everyone gets it right).
- `accuracy < 0.10` for 100+ attempts AND `avg_time_ms < 1500` → flag (likely bad question — random guessing).
- `abandon_rate > 0.30` → flag for review.

Flagged questions are excluded from the provider pool on the next cache warm.

---

### Circuit Breaker Pattern

Each external provider gets a circuit breaker entry in storage:

```
Collection : qv_circuit_breakers
Key        : {provider_name}   e.g. "jikan", "gnews", "nasa"
Owner      : system
Value      : { "state": "closed", "fail_count": 0, "open_until": null }
```

States: `closed` (normal) → `open` (failing, skip for 30s) → `half-open` (test one request).

On provider failure in `get_questions`:
1. Increment `fail_count`.
2. If `fail_count ≥ 3` → set state `open`, set `open_until = now + 30s`.
3. Fallback chain: last-valid-cache → AI generation (topic hint) → `opentdb` (same category) → `provider_unavailable`.

On provider success:
- Reset `fail_count` to 0, state to `closed`.

---

### Predictive Pre-warm Cron

A new cron task added to `analytics_cron` (or a dedicated `qv_personalization_cron`):

**Schedule:** Every hour, offset by 15 minutes from the analytics cron.

**Logic per user** (processed for all users active in last 7 days):

```
1. Read Player DNA → top 3 topics by affinity
2. Read SRQ → any due reviews
3. For each top topic: if qv_readyqueue[topic] is empty or stale:
     → fetch provider, normalize, filter seen, store in qv_readyqueue
4. Store up to 20 pre-warmed questions per topic
```

`get_questions` checks `qv_readyqueue` first. Cache hit → return instantly. Cache miss → normal path. After serving, mark queue entries as consumed and trigger async refill.

**Result:** First-load latency drops from ~800–2000ms (provider fetch) to ~30–80ms (storage read).

---

### Cold Start Protocol

Triggered when `player_dna.total_sessions < 3`:

```
Session 1: topic = "anime",   count = 5, difficulty = "easy",   question_type = "single_select"
Session 2: topic = "pokemon", count = 7, difficulty = "easy",   question_type = "single_select"
Session 3: topic = "movies",  count = 10, difficulty = "medium", question_type = "mixed"
```

After session 3, `cold_start` flips to `false`. DNA bootstrapping uses the 3-session KB data.

Topics for cold start (anime, pokemon, movies) are chosen for:
- Universal recognizability.
- High media engagement (images hook users).
- Moderate accuracy rates across all demographics (not too hard, not trivial).

---

### A/B Experiment Layer

A lightweight cohort system with zero infrastructure cost:

```typescript
// In get_questions / submit_result
const cohort = parseInt(sha256(userId).slice(0, 2), 16) % 100; // 0–99
const experimentConfig = JSON.parse(ctx.env['EXPERIMENT_CONFIG'] || '{}');

// Example config in env var:
// { "mix_algorithm": { "enabled_cohorts": [0, 49], "rollout_pct": 50 } }

const mixEnabled = experimentConfig.mix_algorithm?.enabled_cohorts
  ?.some(start => cohort >= start && cohort < start + 50) ?? false;
```

New features ship to cohort 0–9 (10%) → measure retention/accuracy → expand to 0–49 → 0–99. No infrastructure change. Just update the env var JSON.

---

## Updated RPC Contracts

### `quizverse_get_questions` — Request (updated)

```json
{
  "topic": "anime",
  "count": 10,
  "lang": "en",
  "question_type": "single_select",
  "has_media": true,
  "media_type": "image",
  "mode": "personalized"
}
```

New field: `mode` — `"normal"` (default, as before) or `"personalized"` (uses Player DNA + Mix Algorithm). During cold start, always treated as `"normal"` with structured onboarding content.

### `quizverse_submit_result` — Response (updated)

Adds `personalization` block (see above). All existing fields unchanged.

---

## Updated Implementation Plan

### Phase 0 — Foundations (in parallel with Phase 1, no blocker) · 1 day

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/player_dna.ts` | Create DNA read/write helpers (EMA update, OCC-safe) |
| 2 | `src/games/quizverse/srq.ts` | Create Spaced Repetition Queue helpers |
| 3 | `src/games/quizverse/circuit_breaker.ts` | Create circuit breaker read/write helpers |
| 4 | `src/games/quizverse/context_resolver.ts` | **Create** — `resolveContext(ctx, req)` → `ResolvedContext`; encapsulates all identity + game_id + country_code resolution logic in one reusable function |
| 5 | `docker-compose.yml` | Add `REWARD_CONFIG`, `EXPERIMENT_CONFIG`, `ALLOWED_GAME_IDS` env vars |

**`context_resolver.ts` contract:**

```typescript
interface ResolvedContext {
  userId:      string;
  gameId:      string;
  countryCode: string;   // ISO 3166-1 alpha-2, never null
  lang:        string;   // ISO 639-1, never null
}

function resolveContext(
  nk: Nakama,
  ctx: NakamaContext,
  req: { game_id?: string; country_code?: string; lang?: string }
): ResolvedContext
```

Both `quizverse_get_questions` and `quizverse_submit_result` call `resolveContext` as their first line. No other function re-reads `ctx` or `req` for identity fields.

### Phase 1 — Nakama: `quizverse_get_questions` (unchanged from original) · 3 days

Now also reads `qv_player_dna` and `qv_srq` to inject SRQ reviews and (when `mode=personalized`) apply the Mix Algorithm.

### Phase 2 — Nakama: `quizverse_submit_result` (extended) · 2 days

Now also:
- Updates Player DNA (topic affinity, Elo, session stats).
- Updates SRQ (wrong answers → schedule, correct review → advance interval).
- Updates question quality stats (async).
- Returns `personalization` block.
- Writes pack `expires_at` field.

### Phase 3 — Unity: Switch to new RPCs (unchanged) · 2 days

Unity renders the new `personalization` block fields:
- `review_due_count` → badge on Review button.
- `next_suggested_topic` → highlighted topic on home screen.
- `mastery_delta` → animates mastery bar.
- `streak_at_risk` → triggers push notification scheduling.

### Phase 4 — Pre-warm cron + Cleanup cron · 1 day

| Step | File | Action |
|---|---|---|
| 1 | `src/games/quizverse/prewarm_cron.ts` | Hourly pre-warm job |
| 2 | `src/analytics/analytics_cron.ts` | Add daily pack cleanup + question quality rollup |

### Phase 5 — Cleanup (unchanged) · 1 day

---

## Storage Collections Summary

| Collection | Key | Owner | Purpose | Max Size |
|---|---|---|---|---|
| `qv_seen` | `{scope}_{topic}` | per user | Seen question ledger | 10,000 IDs/key |
| `qv_question_packs` | `{game_id}_{pack_id}` | per user | Question pack (grading); namespaced by game to prevent cross-game pack reuse | 24h TTL |
| `qv_player_dna` | `{game_id}` | per user | Topic affinity, Elo, prefs — one doc per game per user | ~2 KB |
| `qv_srq` | `{topic}` | per user | Spaced repetition queue | ~5 KB |
| `qv_readyqueue` | `{game_id}_{topic}` | per user | Pre-warmed questions, namespaced by game | ~20 items |
| `qv_question_elo` | `{question_id}` | system | Per-question quality stats (shared across games) | 1 doc/question |
| `qv_circuit_breakers` | `{provider}` | system | Provider health state | 20 providers |

**Key namespacing note:** `qv_question_packs` and `qv_player_dna` keys now include `game_id` as a prefix. This allows a single Nakama instance to serve multiple games with fully isolated player progression, packs, and DNA — without collection proliferation. A user playing QuizVerse and LastToLive has separate DNA documents and cannot accidentally submit a LastToLive pack against a QuizVerse leaderboard.

---

## The Addiction Loop (How It All Fits Together)

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         THE COMPOUNDING PREFERENCE ENGINE                 │
│                                                                            │
│  Session N                                                                 │
│  ─────────                                                                 │
│  1. get_questions(mode=personalized)                                       │
│     → reads DNA: top topics = anime(0.87), pokemon(0.65)                  │
│     → injects 2 SRQ reviews (questions wrong last week)                   │
│     → fills 5 anime (confidence), 2 pokemon (growth), 1 discovery         │
│     → serves from pre-warm cache → <50ms latency                          │
│                                                                            │
│  2. Player plays. Time-per-question, quit signals tracked via answers[].   │
│                                                                            │
│  3. submit_result                                                          │
│     → grades answers (server-authoritative)                                │
│     → 5% chance: "Lucky Quiz! 2× XP" (variable reward → dopamine)        │
│     → updates anime Elo: 1420 → 1438 (got harder questions right)         │
│     → advances SRQ: wrong reviews → re-schedule; correct → interval++     │
│     → updates DNA affinity: anime 0.87 → 0.89 (positive reinforcement)    │
│     → returns: next_suggested = "ghibli" (adjacent discovery)             │
│                                                                            │
│  4. Unity shows:                                                           │
│     → "Anime mastery: ████████░░ 72% → 74%"  (mastery bar animates)      │
│     → "3 reviews due tomorrow" (creates return obligation)                 │
│     → "Try Ghibli today?" (discovery hook)                                 │
│                                                                            │
│  Session N+1                                                               │
│  ───────────                                                               │
│  User opens app. 3 SRQ reviews badge → compels them to clear it.          │
│  They play. More data → better DNA → better personalization → more fun.   │
│  The loop compounds. The app gets more valuable with every session.        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Done Criteria (Extended)

**Personalization core**
- [ ] Player DNA is created on first session and updated on every `submit_result`
- [ ] `mode=personalized` returns a mixed session (SRQ + confidence + growth + discovery)
- [ ] Wrong answers appear in SRQ and are served in the next due session
- [ ] Correct SRQ answers advance the interval; retired after 30d interval with correct answer
- [ ] Topic Elo updates on every `submit_result`; questions served within Elo ± 200

**Variable rewards**
- [ ] At least one variable reward type fires in test runs
- [ ] Reward probabilities and thresholds are configurable via env vars without deployment

**Infrastructure**
- [ ] All packs have an `expires_at` field set to +24h
- [ ] Daily cleanup cron removes expired packs
- [ ] Circuit breakers protect all external providers
- [ ] Pre-warm cron runs hourly and fills `qv_readyqueue` for active users
- [ ] `get_questions` latency ≤ 80ms on cache/queue hit, ≤ 2s on cold provider fetch

**Response enrichment**
- [ ] `submit_result` returns `personalization` block on every call
- [ ] Unity renders `review_due_count` badge, `next_suggested_topic` highlight, `mastery_delta` animation

**Quality signals**
- [ ] Question quality stats update asynchronously on every submit
- [ ] Questions crossing retirement thresholds are excluded from future packs
