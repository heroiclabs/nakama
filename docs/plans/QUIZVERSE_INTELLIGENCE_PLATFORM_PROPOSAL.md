# QuizVerse — Intelligence Platform Proposal
### Backend Architecture · Player Engagement · Retention Systems

**Prepared by:** Engineering Team  
**Date:** June 26, 2026  
**Version:** 1.0  
**Confidential**

---

## Executive Summary

QuizVerse today delivers questions to players. QuizVerse tomorrow will *learn* every player and compound that knowledge into an experience that gets better with every single session they play.

This document proposes the **QuizVerse Intelligence Platform** — a complete overhaul of the question delivery and player engagement backend, built on two clean API contracts and a layered personalization engine that mirrors the retention architecture of the world's most addictive learning apps: Duolingo, Spotify, and Netflix.

The system is designed around one principle:

> **Every session a player completes makes the next session more valuable to them.**

That compounding effect is what converts casual players into daily active users, and daily active users into long-term retained customers.

---

## Table of Contents

1. [The Problem with Today's Architecture](#1-the-problem)
2. [The Solution — Two Clean API Contracts](#2-the-solution)
3. [The Personalization Intelligence Layer](#3-personalization-layer)
4. [Player Engagement Systems](#4-engagement-systems)
5. [Player Retention Systems](#5-retention-systems)
6. [Security & Infrastructure Hardening](#6-security--infrastructure)
7. [Feature Availability Matrix](#7-feature-matrix)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Expected Outcomes](#9-expected-outcomes)

---

## 1. The Problem

### Where We Are Today

The current architecture has the game client (Unity) calling **15+ external APIs directly** — anime databases, news services, NASA, movie databases, food APIs, and more. API keys are embedded in the game client code. No server-side caching, no normalization, no fallback strategy.

```
CURRENT STATE (Broken)
─────────────────────

Player Device
     │
     ├──► Jikan (anime)         — API key in app binary
     ├──► NASA API              — API key in app binary
     ├──► TMDB (movies)         — API key in app binary
     ├──► GNews, NewsAPI        — API key in app binary
     ├──► PokeAPI, Dog CEO      — Direct, unprotected
     └──► (12 more providers)   — All direct, all exposed
```

### The Impact

| Problem | Business Risk |
|---|---|
| API keys in Unity binary | Keys extractable in 60 seconds by any player with a decompiler |
| No server-side caching | Every player fetch hits the provider; rate limits hit faster |
| No personalization | Player 1 and Player 10,000 get the identical experience |
| No deduplication | Players see the same questions repeatedly — major churn driver |
| No adaptive difficulty | Beginners quit; experts get bored; both churn |
| No session intelligence | The server knows nothing about what the player wants |

---

## 2. The Solution — Two Clean API Contracts

The entire question delivery system is consolidated into exactly **two server-side API calls**. The game client becomes a pure presentation layer. All intelligence, all API keys, all business logic lives on the server.

```
TARGET STATE (Proposed)
───────────────────────

Player Device
     │
     ├──► quizverse_get_questions    ←── One call to get questions
     │
     └──► quizverse_submit_result    ←── One call to submit answers


Nakama Backend (Server)
     │
     ├── Validates and routes the request
     ├── Selects the right provider(s) for the topic
     ├── Applies personalization and deduplication
     ├── Normalizes all responses to one clean format
     ├── Stores the pack server-side for tamper-proof grading
     └── Grades answers, awards XP/coins, updates all player data
```

### What Unity Calls — and Nothing Else

**Get Questions**
```
Request:
  topic         → "anime" | "pokemon" | "news" | "movies" | ... (20 topics)
  count         → 1–20 questions
  language      → "en" | "hi" | "es" | ...
  question_type → single-select | multiple-select | true/false
  has_media     → true (image/audio/video questions) | false (text only)
  mode          → "normal" | "personalized"

Response:
  A normalized set of questions — identical format regardless of source.
  Every question has: text, options, media (if any), difficulty, explanation.
  The client never knows which provider, API, or source served the question.
```

**Submit Result**
```
Request:
  question_pack_id  → references the server-stored pack
  answers[]         → what the player selected + time taken per question

Response:
  Graded results       → server-computed, client cannot manipulate
  Score + accuracy     → correct/total, accuracy %, time bonus
  Rewards              → XP earned, coins earned, badges, streak update
  Leaderboard rank     → where they stand right now
  Personalization data → what to play next, mastery progress, review reminders
```

### What This Means for the Client

Unity goes from ~6,700 lines of API integration code (the current `ExternalQuizApiService.cs`) to a thin network layer. No API keys. No raw JSON parsing. No fallback logic. No seen-question management. All of that moves to the server permanently.

---

## 3. The Personalization Intelligence Layer

This is the core differentiator. It is built entirely inside the backend and requires no changes to the existing API contract from the client's perspective. Every feature described in this section is invisible to the player — they just experience a game that inexplicably feels "right" for them.

---

### 3.1 Player DNA

Every player accumulates a persistent profile — their **Player DNA** — that grows more accurate with every session they complete.

```
Player DNA (example — player with 47 sessions)
───────────────────────────────────────────────

Topic Affinity (how much they love each topic)
  anime     ████████░░  87%   ← strong preference
  pokemon   ██████░░░░  65%
  countries ████░░░░░░  41%
  news      █░░░░░░░░░  12%   ← avoids this

Topic Mastery (how well they know each topic)
  anime     ███████░░░  72%   ← knowledgeable
  pokemon   █████░░░░░  58%

Behavioral Profile
  Peak play hours:      7pm–9pm
  Avg session length:   8.3 questions
  Preferred format:     Single-select with images
  Sessions per week:    5.2
  Favourite media:      Image (91% engagement), Audio (34%)
```

**How it is built:** No machine learning infrastructure required. The DNA is computed using a weighted exponential moving average (EMA) — recent sessions have 3× more influence than old ones. It updates after every submitted session, requires no external ML service, and runs entirely inside the Nakama backend.

**Storage cost:** ~2 KB per player. Negligible at any scale.

---

### 3.2 Adaptive Difficulty — The Elo System

Each player has a **skill rating per topic** (like a chess Elo score). Each question has a **difficulty rating**. The server matches the two.

```
How it works:
─────────────
Player Elo (anime):    1,420   → intermediate-advanced
Question pool range:   1,220 – 1,620   (±200 from player Elo)

After the session:
  Got hard question right  → player Elo rises (+18)
  Got easy question wrong  → player Elo drops (−12)
  Question difficulty also updates based on aggregate player performance

Result: Every player is always in their "zone of proximal development"
        — challenged enough to feel engaged, not so hard they quit.
```

This single system directly addresses the two most common quiz game churn reasons: **boredom** (too easy) and **frustration** (too hard).

---

### 3.3 The Mix Algorithm — Server-Curated Sessions

When a player requests a "personalized" session, the server composes it using the Mix Algorithm. The player just sees a quiz. The server is running a curriculum.

```
Session Budget: 10 questions
─────────────────────────────────────────────────────────

Slot 1–2   REVIEW          Wrong-answer reviews due today
           (creates daily return obligation)

Slot 3–7   CONFIDENCE      Top affinity topic, near current Elo
           (builds momentum, feels good, drives completion)

Slot 8–9   GROWTH          Weak area, slightly above current Elo
           (actual skill development, "Aha!" moment)

Slot 10    DISCOVERY       Random topic outside their top 5
           (prevents content fatigue, expands topic graph)
─────────────────────────────────────────────────────────
Net effect: Player feels smart, learns something, and encounters
            something new — in every single session.
```

---

### 3.4 Spaced Repetition Queue (SRQ)

This is the most powerful retention mechanism in the system, borrowed from the science behind Anki and Duolingo.

**The problem it solves:** When a player gets a question wrong, it disappears for 90 days like any other question. They never revisit it. They never improve. The app becomes a source of repeated failure with no feedback loop.

**What we do instead:**

```
Wrong answer detected in submit_result
          │
          ▼
Question added to player's Spaced Repetition Queue
          │
          ▼
Review scheduled at:  1 day → 3 days → 7 days → 14 days → 30 days
          │
          ▼
On next session, the FIRST 1–3 slots are always SRQ reviews
          │
          ▼
Player gets it right on review  → interval multiplies, eventually retired
Player gets it wrong again      → interval resets to 1 day
```

**Why this creates retention:** The "3 reviews due today" badge creates a daily return obligation. Players feel accountable to their review queue. This is the same mechanic that makes Duolingo's daily active user numbers exceptional. It works because it leverages commitment and consistency — once people start a streak of completing reviews, they don't want to break it.

---

## 4. Player Engagement Systems

These systems drive **in-session engagement** — they make each session feel rewarding, surprising, and satisfying.

---

### 4.1 Variable Reward Engine

Fixed rewards (correct answer = always +10 XP) produce diminishing returns quickly. Variable rewards, where the outcome is uncertain, produce dramatically higher engagement — this is the same principle behind slot machines, loot boxes, and streaks.

All reward outcomes are **server-controlled and server-decided**. The client renders whatever the server sends. No client-side exploit is possible.

```
Reward Event              Probability    Trigger
──────────────────────────────────────────────────────────────
Standard XP + coins       Always         Correct answers
Lucky Quiz! (2× XP)       5%             Random draw per session
Hot Streak Bonus (+50%)   Active         7+ day active streak
Topic Mastery Unlock      Threshold      First time >80% on 20+ questions
Discovery Bonus           First play     +100 coins for trying a new topic
Comeback Bonus (2× coins) Conditional    Returning after 3+ day absence
Perfect Round (3× coins)  100% session   Rare — reinforces excellence
──────────────────────────────────────────────────────────────
All probabilities and thresholds are tunable via server config.
No deployment required to adjust the reward economy.
```

---

### 4.2 Question Quality Auto-Curation

Every question in the pool accumulates live statistics from real player behavior. Questions that are too easy, too hard, poorly worded, or causing session abandonment are automatically flagged and removed from the pool.

```
Question quality stats tracked per question:
  attempts      → total times served
  accuracy      → % of players who got it right
  avg_time_ms   → how long players spend on it
  abandon_rate  → % of sessions where this was the last question before quit

Auto-retirement thresholds:
  accuracy > 98%  on 100+ attempts  → too easy, retire
  accuracy < 10%  AND fast answers  → likely poorly worded, flag
  abandon_rate > 30%                → causes rage-quits, flag
```

**Result:** The question pool self-improves over time. The more players play, the better the content gets.

---

### 4.3 Personalization Signal in Every Session Response

After every submitted session, the server returns a personalization block that Unity uses to drive the home screen, push notifications, and the result screen — without any additional API calls.

```json
"personalization": {
  "next_suggested_topic":   "ghibli",
  "next_suggested_reason":  "discovery",
  "review_due_count":       3,
  "mastery_delta": {
    "anime": { "before": 0.68, "after": 0.72 }
  },
  "streak_at_risk":         false,
  "engagement_message":     "You're on fire! 87% accuracy today."
}
```

| Signal | Where Unity uses it |
|---|---|
| `next_suggested_topic` | Highlighted topic on home screen — drives next session |
| `review_due_count` | Badge number on the Review button — creates urgency |
| `mastery_delta` | Animates the mastery bar on the result screen |
| `streak_at_risk` | Triggers a push notification the next morning |
| `engagement_message` | Dynamic headline on the result screen |

---

### 4.4 Cold Start Protocol — First-Impression Excellence

New players have no history. A pure personalization system would have nothing to work with. Cold start solves this with a structured first-3-session experience.

```
Session 1  → topic: Anime     5 easy questions, single-select, image-heavy
Session 2  → topic: Pokémon   7 easy questions, single-select, image-heavy
Session 3  → topic: Movies    10 mixed questions, varied difficulty

After Session 3:
  → Player DNA bootstraps from the 3-session knowledge base
  → Personalization engine activates
  → Player is already invested: 22 questions answered, streak established
```

Topics chosen for cold start (anime, pokemon, movies) are selected for universal recognizability, high image engagement, and moderate difficulty curves that maximize first-session completion rates.

---

## 5. Player Retention Systems

These systems drive players **back to the app** after they leave. They operate between sessions, not during them.

---

### 5.1 The Compounding Preference Loop

The central retention architecture. Unlike apps where the experience stays static, QuizVerse gets measurably better for each individual player with every session they complete.

```
┌─────────────────────────────────────────────────────────┐
│           THE COMPOUNDING PREFERENCE LOOP               │
│                                                         │
│  Session 1                                              │
│    Player plays anime                                   │
│    DNA: anime affinity = 0.60 (first signal)           │
│    SRQ: 2 wrong answers scheduled for tomorrow          │
│                                                         │
│  Session 2  (next day)                                  │
│    Player opens app → sees "2 reviews due"              │
│    Completes reviews (commitment + consistency)         │
│    Plays more anime: DNA affinity → 0.71               │
│    Discovers: server suggests Ghibli (adjacent topic)  │
│                                                         │
│  Session 10  (two weeks later)                          │
│    Player DNA: anime 0.87, pokemon 0.65, ghibli 0.52   │
│    Sessions mix: 5 anime + 2 pokemon + 2 reviews + 1 ✨ │
│    Each session is tailored. Nothing feels generic.     │
│                                                         │
│  Session 47  (three months later)                       │
│    Player has a 34-day streak                           │
│    Has mastered anime (72% mastery bar filled)         │
│    Has a review queue of 18 questions                   │
│    The app is now irreplaceable to them                 │
└─────────────────────────────────────────────────────────┘
```

---

### 5.2 Streak Architecture

Streaks are the most documented retention driver in mobile gaming. The system implements streak mechanics at the server level — they cannot be manipulated by the client.

```
Streak features:
  Daily streak tracking          → server-authoritative, tamper-proof
  Streak at-risk detection       → triggers next-morning push notification
  Comeback bonus (3+ days gap)   → re-engagement reward removes friction
  Hot streak multiplier (7+ days) → +50% XP reinforces the behaviour
  Streak milestone badges        → 7, 30, 100, 365 day achievements
```

**Why streaks work for retention:** Loss aversion. A player with a 14-day streak is far more likely to open the app today than a player with no streak — not because they want to earn something, but because they don't want to lose what they already have. This asymmetry in motivation is the most reliable retention lever in consumer apps.

---

### 5.3 Review Queue as a Return Driver

The Spaced Repetition Queue creates a personalized daily to-do list inside the app. Players with a review queue pending have an obligation — a reason to return that is specific to them and not available to anyone else.

```
Review queue notification strategy:
  Trigger:   review_due_count > 0 AND last_session > 20 hours ago
  Channel:   Push notification (scheduled server-side)
  Message:   "You have 3 questions to review. Don't let them expire!"
  Result:    Opens the app directly into a review session
             (highest-intent re-engagement possible)
```

---

### 5.4 Topic Mastery as Long-Term Retention

Each topic has a visible mastery bar (0–100%). Players can see their expertise growing over time. This creates a long-term goal that survives any single session.

```
Mastery bars create:
  Progress visibility   → players can see they're getting better
  Collection mechanics  → 20 topics to master creates a meta-game
  Bragging rights       → "I'm 87% mastered in Anime"
  Intrinsic motivation  → mastery is its own reward (Self-Determination Theory)
```

When a player crosses a mastery threshold (e.g., 50%, 75%, 100%), the server triggers a milestone reward and sends a push notification. These are natural re-engagement points even for lapsed players.

---

### 5.5 Predictive Session Pre-warming

A background server process runs every hour and pre-loads questions for every player active in the last 7 days.

```
Without pre-warming:
  Player opens app → server fetches from provider → normalizes → responds
  Latency: 800ms – 2,000ms on a cold provider call
  Risk:    Provider is down → session fails → player quits

With pre-warming:
  Every hour → server pre-loads questions for user's top 3 topics
  Player opens app → questions are already ready → responds instantly
  Latency: < 50ms (storage read)
  Risk:    Provider down → pre-warmed questions still available
```

Fast first load is the single most impactful UX improvement for retention. Studies across mobile apps consistently show that a 1-second improvement in first interaction time correlates with measurable improvements in session completion rates.

---

### 5.6 Re-engagement Windows

The DNA tracks `last_played_at` and `session_frequency_days`. When a player goes silent beyond their normal pattern, the server knows before any push notification system would.

```
Comeback detection:
  Player's avg frequency: every 1.2 days
  Gap detected:           > 3 days since last session
  
Server response:
  → Doubles coin reward for next session (comeback bonus)
  → Pre-warms an extra-easy session to lower re-entry friction
  → Sends "We miss you" push with a specific topic highlight
  
Result:
  Player returns to an easy, rewarding session
  Streak restarts cleanly with a bonus
  Re-engagement friction is minimized
```

---

## 6. Security & Infrastructure Hardening

### 6.1 API Key Security

**Current state:** API keys for NASA, TMDB, GNews, NewsAPI, and 11 other providers are embedded in the Unity game client binary. Any player with a decompiler can extract them in minutes.

**Proposed state:** All API keys move to the Nakama server environment. The Unity client has zero knowledge of any external provider. This is a non-negotiable security baseline.

### 6.2 Server-Authoritative Grading

**Current state:** The client submits answers and the server trusts the result.

**Proposed state:** 
1. The server stores the full question pack (including correct answers) when questions are served.
2. When the client submits answers, the server grades them against the stored pack.
3. The client cannot manipulate scores, XP, coins, or leaderboard positions.
4. Duplicate submits are rejected — one pack ID can only be submitted once.

### 6.3 Circuit Breaker — Provider Failure Resilience

If an external provider (e.g., the anime API) goes down, the current system returns an error to the player. The proposed system has a three-tier fallback:

```
Provider fails
     │
     ├── Tier 1: Serve from last valid cache (regardless of TTL)
     ├── Tier 2: Generate equivalent questions via AI (Claude/GPT)
     └── Tier 3: Serve from OpenTDB (general trivia) with same category
```

Players never see provider failures. The experience degrades gracefully and invisibly.

### 6.4 Rate Limiting

All RPCs are rate-limited per authenticated user at the server. A player cannot spam requests to exploit rewards or farm XP. Limits are configurable without deployment.

---

## 7. Feature Availability Matrix

### Features Usable From Day 1 (Phase 1–2 Complete)

| Feature | Engagement Impact | Retention Impact |
|---|---|---|
| Server-side question delivery (20 topics) | High — more content variety | Medium |
| Normalized question format (image, audio, video) | High — richer media experience | Medium |
| Server-side grading (tamper-proof) | Low (player-facing) | High (platform integrity) |
| 90-day seen-question deduplication | Medium — no repetition | High — content feels fresh |
| XP, coins, leaderboard on submit | High — immediate reward | High — competitive hook |
| Knowledge Base recording | Low (player-facing) | High — enables personalization |
| All API keys secured server-side | None (invisible) | High — platform trust |
| Pack expiry + storage cleanup | None (invisible) | Medium — reliability |

### Features Available After Phase 0–2 (Personalization Layer)

| Feature | Engagement Impact | Retention Impact |
|---|---|---|
| Player DNA (affinity + mastery + Elo) | — | High — enables everything below |
| Adaptive Elo difficulty matching | **Very High** — optimal challenge | **Very High** — prevents boredom/frustration |
| Mix Algorithm (personalized sessions) | **Very High** — every session feels tailored | **Very High** — content never feels generic |
| Spaced Repetition Queue (SRQ) | High — accountability per session | **Very High** — daily return obligation |
| Variable Reward Engine | **Very High** — surprise + delight | High — unpredictable = more checking |
| Cold Start Protocol | High — strong first impression | High — early investment = retention |
| Personalization block in response | High — Unity drives next action | High — reduces friction to next session |
| Mastery bars (topic progress) | High — visible growth | **Very High** — long-term goal |
| Streak architecture (server-side) | High — in-session motivation | **Very High** — loss aversion |
| Pre-warm cron (<50ms first load) | **Very High** — instant feel | High — low friction re-entry |
| Question quality auto-curation | Medium — better questions | Medium — prevents bad-question churn |
| Circuit breaker (provider fallback) | Medium — no dead sessions | High — reliability = trust |
| A/B experiment layer | None (player-facing) | High — enables data-driven tuning |
| Re-engagement detection + comeback bonus | Low | **Very High** — lapsed player recovery |

### Retention Impact Summary

| Retention Driver | Mechanism | Analogous to |
|---|---|---|
| SRQ review queue | Daily return obligation | Duolingo lessons due |
| Streak loss aversion | Fear of losing progress | Snapchat streaks |
| Mastery progression | Long-term visible goal | Duolingo course completion |
| Variable rewards | Unpredictable delight | Slot machine dopamine loop |
| Personalized sessions | "This app knows me" | Netflix home screen |
| Comeback bonus | Removes re-entry friction | Any app re-engagement offer |
| Pre-warm (<50ms) | Instant gratification | TikTok scroll speed |
| Adaptive difficulty | Always optimally challenged | Games difficulty scaling |

---

## 8. Implementation Roadmap

```
PHASE 0 — Foundations (1 day, runs in parallel)
  ├── Player DNA helper module
  ├── Spaced Repetition Queue helpers
  ├── Circuit breaker helpers
  └── Reward + Experiment config in environment

PHASE 1 — New question delivery RPC (3 days)
  ├── 20-topic external provider module
  ├── quizverse_get_questions (unified handler)
  ├── Deduplication + seen ledger integration
  ├── SRQ injection into session slots
  └── Pre-warm queue check (first-load speed)

PHASE 2 — New result submission RPC (2 days)
  ├── quizverse_submit_result (unified handler)
  ├── Server-side grading (tamper-proof)
  ├── XP + wallet + leaderboard updates
  ├── DNA update (affinity, Elo, session stats)
  ├── SRQ update (wrong answers scheduled)
  ├── Variable reward draws
  └── Personalization block in response

PHASE 3 — Unity client refactor (2 days)
  ├── QuizDeliveryService: call new get_questions
  ├── QuizSubmissionService: call new submit_result
  ├── Home screen: render next_suggested_topic
  ├── Result screen: render mastery_delta animation
  ├── Review button: render review_due_count badge
  └── Remove ExternalQuizApiService (all API calls deleted)

PHASE 4 — Background intelligence (1 day)
  ├── Hourly pre-warm cron
  ├── Daily pack cleanup cron
  └── Question quality rollup cron

PHASE 5 — Cleanup + verification (1 day)
  ├── Confirm zero external API URLs in Unity code
  ├── Confirm zero API keys in Unity binary
  └── Full regression on all game modes
──────────────────────────────────────────────────────────
  Total: ~10 working days
```

---

## 9. Expected Outcomes

### Immediate (Phase 1–3 Complete)

| Metric | Expected Change |
|---|---|
| First-session load time | 800–2,000ms → <50ms (pre-warm) |
| Question repetition rate | Eliminated within 90-day window |
| API key exposure risk | Eliminated (server-side) |
| Content variety per session | 20 normalized topics vs. current |
| Score manipulation possibility | Eliminated (server grading) |

### Medium-Term (Personalization Layer Active, 30 days post-launch)

| Metric | Expected Direction | Rationale |
|---|---|---|
| D1 Retention (Day 1 → Day 2) | ↑ | SRQ creates first review obligation immediately |
| D7 Retention | ↑ | Streak established + review queue built up |
| D30 Retention | ↑ | DNA-driven sessions feel personal; mastery bars drive long-term |
| Avg session length | ↑ | Optimal difficulty = less frustration quit |
| Sessions per user per week | ↑ | Review queue = daily return reason |
| Player churn from repeated questions | ↓ | SRQ + 90-day deduplication |
| Player churn from wrong difficulty | ↓ | Elo-matched questions |

### Long-Term (3+ Months, DNA Fully Matured)

Players with a mature DNA (30+ sessions) experience a game that is genuinely personalized to their knowledge, preferences, and schedule. At this point, switching costs are high — the player's history, mastery progress, review queue, and streak represent real accumulated value that exists only in QuizVerse. This is **platform lock-in through genuine value creation**, not artificial barriers.

---

## Appendix — Technical Storage Summary

| Data Store | Purpose | Size per User |
|---|---|---|
| `qv_seen` | Seen question ledger (dedup) | ~50 KB max |
| `qv_question_packs` | Session packs for server grading | ~5 KB, 24h TTL |
| `qv_player_dna` | Topic affinity, Elo, behavior profile | ~2 KB |
| `qv_srq` | Spaced repetition review queue | ~5 KB |
| `qv_readyqueue` | Pre-warmed questions (by topic) | ~10 KB |
| `qv_question_elo` (shared) | Per-question quality stats | ~0.5 KB/question |
| `qv_circuit_breakers` (shared) | Provider health state | ~0.5 KB total |

All storage is within Nakama's CockroachDB layer. No external ML service, no Redis, no message queue. The entire intelligence platform runs on the existing infrastructure stack.

---

*End of Document*

**QuizVerse Intelligence Platform Proposal v1.0**  
*Engineering Team — June 2026*
