# QuizVerse Tournaments — Operations Runbook

**Owner:** Tournaments squad
**Last updated:** 2026-05-28

This runbook covers everything between code-complete (today) and public
launch (Jul 1). Use it in sequence — each section produces an artifact
the next section depends on.

---

## §1 — Ghost run (Jun 24 → Jun 26)

**Goal:** end-to-end shakedown with 50 internal testers. No real money.

### 1.1 Pre-flight (Jun 23 EOD)

| Check | How | Pass criterion |
|---|---|---|
| Nakama TS build clean | `cd data/modules && npm run build` | `Build complete`, RPC count ≥ 1000 |
| `tournament_list` returns slate | `curl -sS .../v2/rpc/tournament_list?http_key=...` | 11 tournaments incl. `ghost_run_*` slugs |
| Content pre-gen cron has 4× headroom | Grafana panel `tournaments / pregeneration backlog` | Backlog ≤ 25% of capacity |
| BC ledger smoke | `tournament_admin_create` → `tournament_enter` → check `bc_wallet` debit | Balance delta = `entry_fee_bc` |
| Realtime push works | Watch WS `tournament:{slug}` in browser devtools | `1001` event within ≤ 5s of an entry |

### 1.2 During the run

* **Day 1 (Jun 24):** open `ghost_classic_daily`. Watch dashboard for
  pot-update cadence (target ≤ 8s end-to-end), entry success rate
  (target ≥ 99%), and CSAT in #ghost-testers Slack channel.
* **Day 2 (Jun 25):** open `ghost_elimination_sprint`. Verify the 5
  scheduled cuts fire on the wall-clock (`tournament_eliminate_round`
  cron); each elimination should generate a 1003 notification per
  affected user within 10s of the cut.
* **Day 3 (Jun 26):** open `ghost_pick_5`. Validate pick-lock at the
  scheduled `pick_lock_iso` (no submissions accepted after); 24h after
  lock, `tournament_settle` runs and payouts hit wallets.

### 1.3 Exit criteria

* All three formats settled with **0** ledger drift (sum of payouts +
  rake == pot).
* Certificates rendered for top-10 in each (check S3 keys exist).
* No P0/P1 incidents open. P2 bugs OK but logged in `BUGS.md`.

---

## §2 — Load test (Jun 27, 14:00 UTC)

**Goal:** confirm we can handle the launch-day fan-out (~25k pre-enrolled).

### 2.1 Targets

| Endpoint | Target RPS | Notes |
|---|---|---|
| `tournament_submit_pack_result` | **1,000** | Critical hot path; rate-limited 60/min/user, but we expect bursts on overlapping ends |
| `tournament_enter` | 200 | Idempotency key dedup must hold |
| `tournament_caller_status` | 500 | Polled by web detail page |
| `tournament_leaderboard_*` (any) | 800 combined | Hits Nakama leaderboard cache |
| `tournament_pre_enroll` | 100 | Rate-limited 20/min/user |
| Content-factory pregen cron | 4× normal rate | Stress S3 + worker queues |

### 2.2 Procedure

* k6 script in `tools/loadtest/tournaments-launch.js` (TBD — write
  before Jun 27). Run from a c6i.4xlarge in the same region.
* Soak for 30 min; watch p99 < 1.2s, error rate < 0.5%.

### 2.3 KPI instrumentation

Wire the following Mixpanel events on first launch-day deploy (already
fired by the web client, listed here for the Mixpanel review checklist):

| Event | When |
|---|---|
| `tournament_view_list` | First render of `/tournaments` |
| `tournament_view_detail` | First render of `/tournaments/[slug]` |
| `tournament_enter_attempt` | Confirm button tap |
| `tournament_enter_success` | Server returned `ok:true` |
| `tournament_submit_score` | `tournament_submit_pack_result` returned 200 |
| `tournament_settled` | First post-settled view of a tournament |
| `tournament_certificate_view` | `/certificate/[id]` first render |
| `tournament_referral_attributed` | Server attribution succeeded |

KPIs to alarm on (Grafana):

* Entry funnel: `view_list → view_detail → enter_attempt → enter_success`
  conversion ≥ 35% (view_list → enter_success).
* p99 latency on `tournament_submit_pack_result` < 1.2s.
* Referral leaderboard cron lag < 60s.

---

## §3 — Public launch (Wed Jul 1, 10:00 UTC)

**Wave 1 slate:** GK Royale Daily, Brain Bowl, Movie Buff, Survivor
Week, Pick-5 Daily, AP 2027 Prep.

### 3.1 T-24h checklist

* [ ] `tournament_list` returns Wave-1 slugs with `status="OPEN"` (or
      scheduled cron will flip them at 10:00 UTC).
* [ ] Push notification opt-ins ≥ 18,000 (75% of 25k pre-enrolled).
* [ ] Referral leaderboard frozen for cash prize settlement.
* [ ] Lambda `tournament_certificate` deployed + smoke-tested.
* [ ] Bracket service responding on EKS (curl `/healthz`).
* [ ] Status page + #incidents Slack channel are clear.

### 3.2 T-0 (10:00 UTC)

* Cron `tournament_cron_tick` flips slugs `PRE_ENROLL → OPEN`.
* Background job pushes "Tournaments are LIVE" to all opted-in users.
* On-call engineer watches:
  * Pot updates per second (target ≤ 30s drift between actions).
  * Entry success rate (target ≥ 99%).
  * Mixpanel funnel (target view_list → enter_success ≥ 35%).

### 3.3 T+1h

* Settle referral cash prizes:
  `curl -sS .../v2/rpc/tournament_referral_settle_topN \
    -H 'Authorization: Bearer <ops_token>' -d '{}'`
* Verify top-100 referrers received Tremendous emails (sample 10).

### 3.4 T+24h

* First daily tournaments settle. Watch:
  * Settlement runtime < 60s per tournament.
  * `0` ledger drift across all settled tournaments.
  * Certificate Lambda success rate > 99%.

---

## §4 — Per-format ghost acceptance (per §1H)

### 4.1 Elimination Sprint (Survivor Week)

* [ ] 5 cuts fire on schedule (`open_start_iso + Nx24h`).
* [ ] AMOE-entered players are in a separate cut pool from paid (no
      cross-contamination of survivor counts).
* [ ] Share badge image generated for every survivor at each cut.

### 4.2 Pick-N (Pick-5 Daily)

* [ ] Pick lock fires at the wall-clock `pick_lock_iso` ± 5s.
* [ ] Multipliers correctly resolve (5/5 → 3×, 4/5 → 1.5×, etc.).
* [ ] Collusion-cluster detector flags identical pick sets >5 users.
* [ ] Hall-of-fame top-10 visible on the post-window screen.

---

## §5 — §1I acceptance criteria (9 checks)

Run on a fresh device/browser before declaring "ready for public launch".

| # | Check | How |
|---|---|---|
| 1 | Ghost user mints in < 2s | Hit `/tournaments` cold, watch network panel |
| 2 | Merge survives Google sign-up | Pre-enroll as ghost, then sign in with Google, verify pre-enroll persists |
| 3 | Cross-device session continuity | Sign in on phone, see same wallet on web |
| 4 | Idempotency on double-call | Click "Enter" 2× quickly — only one debit |
| 5 | Geo-block US states blocks entry | Set `state=NY`, attempt entry → 403 with `entry_blocked_in_us_state` |
| 6 | Anti-cheat soft-DQ flags impossible scores | POST `tournament_submit_pack_result` with `client_latency_ms=10` → response has `soft_dq=true` |
| 7 | Live LB updates within 10s | Open LB, have a second account enter → row appears |
| 8 | Settlement completes < 1h after `end_iso` | Watch cron logs |
| 9 | All 6 LB variants available on web + Unity | Click through tabs |

---

## §6 — Conversion & Retention KPIs (Firecrawl-verified, 2026 benchmarks)

**Source of truth for engagement targets.** All numbers below are pulled
from the public 2026 mobile-game and DFS benchmark studies cited at the
bottom of this section. Update annually.

### 6.1 KPI commitments

| KPI | Floor target | Stretch | Industry benchmark | Why this number |
|---|---|---|---|---|
| **Day 1 retention** | ≥ 30% | ≥ 38% | mobile games avg = **32.5%** | SQ Magazine 2026 |
| **Day 7 retention** | ≥ 12% | ≥ 16% | mobile games avg = **13.8%** | SQ Magazine 2026 |
| **Day 30 retention** | ≥ 4% | ≥ 6% | most app categories <1%; we beat by 4× | Pushwoosh 2026 |
| **Stickiness (DAU/MAU)** | ≥ 28% | ≥ 35% | APAC + NA avg = **32%** | SQ Magazine 2026 |
| **Onboarding lift (personalized vs generic)** | +30% D7 | +45% D7 | documented +**45%** lift | SQ Magazine 2026 |
| **Pre-enroll → first-entry conversion** | ≥ 40% | ≥ 55% | DFS-class funnel | derived from §2.3 |
| **view_list → enter_success funnel** | ≥ 35% | ≥ 50% | already in §2.3 | already committed |
| **D1 wallet refill rate (post-loss)** | ≥ 18% | ≥ 28% | DFS retention lever | Mordor 2026 |
| **Push-opt-in rate (D0)** | ≥ 60% | ≥ 75% | mobile games avg | Pushwoosh 2026 |
| **Streak users (≥ 3-day) share** | ≥ 22% of WAU | ≥ 35% | gamification benchmark | Strivecloud 2026 |

### 6.2 Mixpanel events to wire (additive on top of §2.3)

These are the events the conversion-and-engagement levers depend on. The
existing 8 events in §2.3 stay; the following 10 are added.

| Event | Properties | Fired when |
|---|---|---|
| `tournament_onboarding_intent_quiz` | `topic`, `time_budget`, `prize_comfort` | First sign-in completes the 3-question intent quiz |
| `tournament_streak_check_in` | `streak_days`, `bonus_bc` | Daily login that bumps the streak counter |
| `tournament_streak_break` | `streak_days_lost` | Streak counter reset to 0 |
| `tournament_scarcity_view` | `slug`, `slots_remaining` | User sees the live scarcity counter on a tournament card |
| `tournament_social_proof_impression` | `slug`, `entries_in_window` | Live ticker rendered on detail page |
| `tournament_predictive_nudge_shown` | `slug`, `current_rank`, `target_rank`, `bonus_bc` | "+250 BC if you climb to 20th" toast |
| `tournament_abandonment_recovered` | `slug`, `hours_since_view` | User entered a tournament after the H+24 push |
| `tournament_watch_live_open` | `slug`, `entries_in_pot` | Spectator opens watch-live mode |
| `tournament_badge_earned` | `badge_slug`, `tournament_slug` | Tournament-related badge unlocked |
| `tournament_pickn_doubleup` | `slug`, `picks_doubled`, `mid_window_pct` | Pick-N v2 mid-window doubleup tap |

### 6.3 Push notification cadence ladder

Wire on the User Backend `notif-scheduler` (already in production):

| Day | Trigger | Copy template | Cap |
|---|---|---|---|
| D0 | sign-in | "Welcome to QuizVerse Tournaments — claim your 250 BC welcome pack" | 1 |
| D1 | streak risk (no entry yet) | "Your founder streak is 1 day. Don't lose it." | 1/day, max 1 push |
| D2 | fresh tournament open | "<slug> opened — first entry on us with code DAY2" | 1/day |
| D3 | free Pick-N entry | "Try Pick-5 today — entry is on the house" | 1/week |
| H+24 (abandonment) | viewed slug, didn't enter | "Spot still open in <slug> — pot now <pot>" | 1/slug/user |
| Mid-window (predictive) | rank slipped 5+ places | "You're <rank>. +250 BC if you climb to 20th in the next hour" | 1/slug/window |
| D7 | inactive 7d | "We saved a free entry for your comeback round" | 1/week |
| Settlement | won | "You finished <rank> in <slug> — <bc> BC just hit your wallet" | 1/settlement |

**Frequency cap:** ≤ 4 pushes per user per 24h. Hard-stop after 2
ignored pushes in a 72h window (until next user-initiated open).

### 6.4 Alert thresholds

Wire to PagerDuty (P2 unless noted):

* `tournament_onboarding_completion_rate < 60%` (1h window) — investigate copy.
* `D1 retention < 25%` over a 7-day rolling cohort — **P1**, paywall too aggressive.
* `streak_break per user > 0.6/week` — D1 push not landing.
* `push_opt_in_rate < 50%` for D0 — onboarding flow regression.
* `view_list → enter_success conversion < 28%` for 6h — UI regression.

### 6.5 Sources cited

All Firecrawl-scraped May 28, 2026. Re-run quarterly to refresh targets.

| # | Source | Used for |
|---|---|---|
| 1 | [SQ Magazine — Mobile Games Statistics 2026](https://sqmagazine.co.uk/mobile-games-statistics/) | D1 32.5%, D7 13.8%, onboarding +45%, stickiness 32% |
| 2 | [Pushwoosh — Increase user retention 2026](https://www.pushwoosh.com/blog/increase-user-retention-rate/) | Retention curve, ">80% lost in week 1", streak rationale |
| 3 | [Pushwoosh — Increase DAU 2026](https://www.pushwoosh.com/blog/increase-daily-active-users/) | DAU benchmarks, push cadence rationale |
| 4 | [Mordor Intelligence — NA Fantasy Sports Market 2026–2031](https://www.mordorintelligence.com/industry-reports/north-america-fantasy-sports-market) | 76.05% mobile, 60.55% daily/weekly, 60.95% rake, 58.10% age 25-34 |
| 5 | [Strivecloud — 68 gamification examples](https://www.strivecloud.io/blog/app-engagement-examples) | Streaks, badges, watch-live, scarcity patterns |

---

## §7 — Optional content-factory PRs (parallel)

These nice-to-haves unblock late-launch tightening. Not blocking for Jul 1.

| PR | Surface | Why |
|---|---|---|
| `num_cards_override` up to 100 | `/api/v2/quiz_pack` | Long-form weekly tournaments need 75–100q packs |
| `tags` field on `ExamPrepBundleRequest` | `/api/v2/exam_prep_bundle` | Per-tournament topic filtering |
| `viral_lesson_short` cap → 180s | `/api/v2/viral_lesson_short` | Some Learning Series lessons need 2-3 min |
| Optional `webhook_url` | All async endpoints | Lets Nakama avoid polling for task status |
