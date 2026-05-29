# UI Conversion-Lever Spec — Tournament Wave-2

**Owner:** Tournaments squad · Web + Unity
**Last updated:** 2026-05-28
**Status:** SPEC — no UI code shipped yet
**Linked configs:** [`data/modules/src/p2e/tournament_economy_v2.ts`](../../data/modules/src/p2e/tournament_economy_v2.ts)
**Linked docs:** [`docs/tournaments/RUNBOOK.md` §6](./RUNBOOK.md#6--conversion--retention-kpis-firecrawl-verified-2026-benchmarks)
**Linked audit:** [`tournaments-docs.intelli-verse-x.ai/audit.html`](https://tournaments-docs.intelli-verse-x.ai/audit.html)

---

## Why this exists

The 2026 benchmark audit ([audit.html](https://tournaments-docs.intelli-verse-x.ai/audit.html))
identified **12 gaps** between the shipping plan and best-in-class
DFS / mobile-game patterns. The server-side foundations for all 12 are
now drafted in `tournament_economy_v2.ts`. **This document specifies the
six levers that need UI implementation** — three on web and three on Unity
(plus three that ship on both surfaces).

Each lever ships independently. Each is wired to a feature flag in
`TournamentEconomyV2.FEATURE_FLAGS` so it can be turned on per-cohort.

---

## Lever index

| # | Lever | Web | Unity | Server | Flag |
|---|---|---|---|---|---|
| L1 | Personalized onboarding intent quiz | ✅ | ✅ | new RPC `tournament_intent_quiz_save` | `intent_quiz_onboarding` |
| L2 | Live scarcity counter | ✅ | ✅ | extend `tournament_list` payload | `scarcity_counter_v1` |
| L3 | Live social-proof ticker | ✅ | ✅ | re-use existing `1001:entry` stream | `social_proof_ticker_v1` |
| L4 | Predictive rank nudge (mid-window toast) | ✅ | ✅ | server emits `1004:predictive` | `predictive_rank_nudge_v1` |
| L5 | Watch-live spectator mode | ✅ | ✅ | new RPC `tournament_watch_subscribe` | `watch_live_v1` |
| L6 | Streak counter + reward popups | ✅ | ✅ | new RPC `tournament_streak_status` | `streak_engine_v1` |

> Push notifications (gap #3) and abandonment nudges (gap #6) are
> implemented in the User Backend `notif-scheduler` and don't need a
> dedicated client UI beyond the existing OS-level push handler.

---

## L1 — Personalized onboarding intent quiz

**Problem.** Generic welcome flow loses ~45% of D7 retention vs personalized
flows ([SQ Magazine 2026](https://sqmagazine.co.uk/mobile-games-statistics/)).

**Hook.** Right after first sign-in, before the user lands on the
tournament list, present 3 questions from `INTENT_QUIZ` in
`tournament_economy_v2.ts`.

### Web (Next.js)

* New route: `/tournaments/welcome` — full-screen 3-step wizard.
* Fetch question set:
  ```ts
  const quiz = await callRpc('tournament_intent_quiz_questions');
  ```
* On submit, POST answers:
  ```ts
  await callRpc('tournament_intent_quiz_save', {
    favorite_topic: 'movies',
    time_budget: 'fast',
    prize_comfort: 'small',
  });
  ```
* On success, route to `/tournaments?recommended=<topic_tag>` —
  the list page must filter to the recommended topic_tag at the top with a
  "Recommended for you" pill.
* **Skip allowed.** "Skip for now" link routes to `/tournaments` directly.
* **Telemetry:** fire Mixpanel `tournament_onboarding_intent_quiz`
  (props per RUNBOOK §6.2).

### Unity

* `Trivia.Onboarding.V2.OnboardingManagerV2.OnOnboardingCompleted`
  already exists. Add a new screen `IntentQuizScreen` between sign-in
  and the main lobby.
* Same RPCs as web. Persisted answers go to user metadata
  `intent_quiz_v1`.

### Acceptance

* D0 onboarding completion ≥ 60% (RUNBOOK §6.4 alarm).
* Recommended-tournament tap-through ≥ 35% from the welcome flow.

---

## L2 — Live scarcity counter

**Problem.** Founder-cap is enforced server-side but invisible. We're
leaving urgency lift on the table.

**Hook.** Tournament card shows "**N founder spots left**" pill. Pulses
red below 100 and shows a stronger urgent state below 25 (thresholds in
`tournament_economy_v2.ts`).

### Server change

Extend `tournament_list` response payload:
```ts
{
  slug: 'gk-royale-daily',
  ...,
  scarcity: {
    founder_slots_total: 1000,
    founder_slots_remaining: 153,    // computed live
    cache_seconds: 5,                // tells client when to refetch
  }
}
```

### Web

* Add `<ScarcityPill remaining={n} threshold={100} />` to
  `web/components/tournaments/TournamentCard.tsx`.
* Pill copy:
  * `> 100`: muted text, "153 founder spots left".
  * `≤ 100`: red badge, "Only 87 founder spots left".
  * `≤ 25`: red badge with pulse animation, "Almost full — 12 spots left".
* Refetch list every `cache_seconds` while the lobby is in foreground.

### Unity

* Add a small TextMeshProUGUI element to the existing tournament-card
  prefab, under `Assets/_QuizVerse/Prefabs/Tournaments/TournamentCard.prefab`.
* Use `DOTween` for the pulse animation (matches existing animation skill).

### Acceptance

* Tap-through on cards with scarcity pill ≥ 1.4× cards without (A/B).
* No layout shift on cards with no scarcity data (graceful fallback).

---

## L3 — Live social-proof ticker

**Problem.** The server already emits `1001:entry` events on every paid
entry, but no UI surface exposes them. We're throwing away a
high-conversion proof point.

**Hook.** Tournament detail page shows a sliding ticker:
> "@bob just entered · pot now 5,050 BC · 3s ago"
> "@kate just entered · pot now 5,100 BC · 8s ago"

### Server change

None — `1001:entry` already exists. Just confirm the payload includes
`{ user_handle, pot_after_bc, occurred_at }`.

### Web

* Subscribe to the existing realtime channel on the detail page mount:
  ```ts
  socket.onmatchdata = (data) => { /* update local ticker */ };
  ```
* Component: `<SocialProofTicker entries={recent} window={90} />`.
* Behavior:
  * Show last `visible_window_seconds` (default 90) of entries.
  * Below `show_handle_redaction_below_count` (default 3) entries in
    window, render aggregate "5 players entered" instead of individual
    handles to avoid sparse-feeling UI.
  * Min visual refresh interval `min_visual_refresh_ms` (default 1500ms)
    to prevent flickering.
* **Telemetry:** `tournament_social_proof_impression` on every render
  with ≥ 1 entry.

### Unity

* Reuse `Assets/_QuizVerse/Scripts/UI/Common/MarqueeText.cs` if it
  exists; otherwise add a new component using the ScrollRect pattern.
* Same socket subscription as web (Nakama C# SDK).

### Acceptance

* Detail-page → enter funnel ≥ 1.2× without ticker (A/B).
* No memory growth over 1h spectating (browser + Unity profiler).

---

## L4 — Predictive rank nudge (mid-window toast)

**Problem.** Mid-tournament, players who slip in rank silently churn.

**Hook.** When a paid entrant's rank slips ≥ 5 positions in a 30m sliding
window AND there's a crossable prize tier above them, server emits a new
realtime event `1004:predictive`. Client renders a non-blocking toast:

> **You're 23rd. +250 BC if you climb to 20th in the next hour.**
> *Open Quiz Pack →*

### Server change

* New cron `tournament_predictive_nudge_tick` (every 60s during a
  tournament's ACTIVE window).
* Reads thresholds from `TournamentEconomyV2.PREDICTIVE_NUDGE`.
* Emits `1004:predictive` on the user's session.
* Bonus BC is escrowed; settled at end-of-window if user actually hits
  the target rank.

### Web

* Toast component `<PredictiveRankToast {...payload} />` lives in the
  global toaster, only renders if user is on a tournament-related route.
* CTA opens the pack player.
* Auto-dismiss after 60s if no interaction.

### Unity

* Use the existing toast system in `Trivia.UI.Toaster` (or
  `DoozyUI` if that's the live system).
* Same dismiss behavior.

### Acceptance

* CTR on toast ≥ 8%.
* Of those who CTR, ≥ 25% improve their rank into the target tier.
* No more than 1 toast per user per slug per 60-min cooldown.

---

## L5 — Watch-live spectator mode

**Problem.** Non-entrants leave the app mid-window because there's
nothing to do. We lose engagement minutes that compound into D7
retention.

**Hook.** Twitch-style spectator: any logged-in user can watch a live
tournament's leaderboard and a live ticker, even if they didn't enter.
After 5 minutes spectating, surface a "Join the next round" CTA.

### Server change

* New RPC `tournament_watch_subscribe` — subscribes the user to the
  spectator stream (refresh half as often as entrants, per
  `WATCH_LIVE.spectator_lb_refresh_seconds = 10`).
* Cap concurrent spectators per pod to `spectator_max_concurrent_per_pod`
  (default 5000); if exceeded, return graceful "watching not available
  right now" UX.

### Web

* New route `/tournaments/[slug]/watch` — read-only leaderboard +
  ticker + ambient progress UI.
* Persistent CTA banner: "Want to compete? Next round opens in
  HH:MM — [Reserve my spot]"
* **Telemetry:** `tournament_watch_live_open` on entry,
  `tournament_watch_to_enter` if user converts.

### Unity

* New scene additive `Tournaments_WatchLive` or a screen
  `Screen_TournamentWatchLive` under existing `Screen_Canvas/Quizzes/`.
* Must respect MainQuiz scene budget (39 root GameObjects).
* No background audio (passive consumption screen).

### Acceptance

* ≥ 12% of WAU opens watch-live at least once a week.
* Watch → enter conversion ≥ 8%.

---

## L6 — Streak counter + reward popups

**Problem.** No daily hook between tournaments → D1 retention sits
below the 32.5% mobile-game baseline.

**Hook.** Persistent streak counter in the lobby header. Reward popup on
streak milestone days (1 / 3 / 7 / 14 / 30 / 90).

### Server change

* New RPC `tournament_streak_status` — returns
  `{ current_day, days_until_next_reward, next_reward_bc, longest_streak, grace_days_remaining }`.
* Daily cron `tournament_streak_tick` (00:01 UTC) — increments or
  resets, applies grace-day logic (`STREAK_GRACE_DAYS = 1`).

### Web

* Component `<StreakCounter />` in the lobby header (between brand and
  wallet).
* Tap streak → bottom sheet with `STREAK_REWARDS` ladder, current day
  highlighted.
* Reward popup `<StreakRewardModal day={n} reward={r} />` on milestone
  unlocks.
* **Telemetry:** `tournament_streak_check_in` on every tick,
  `tournament_streak_break` on resets.

### Unity

* Reuse `Trivia.Onboarding.V2`'s popup framework for the milestone
  modal.
* Streak counter goes in the existing top-bar HUD.

### Acceptance

* Streak ≥ 3-day share of WAU ≥ 22% (RUNBOOK §6.1 target).
* Streak break per user < 0.6/week (RUNBOOK §6.4 alarm).

---

## Cross-cutting requirements

### Feature-flag wiring

Every lever is hidden until its flag in `FEATURE_FLAGS` is `true`. The
flag is read on every list/detail render — no app restart required.

### Analytics events

Every lever fires the events listed in RUNBOOK §6.2. **Do not ship a
lever without its events** — alarms in §6.4 depend on them.

### Performance budgets

| Surface | Cold add per lever | Steady-state RAM | Notes |
|---|---|---|---|
| Web (Next.js) | ≤ 30KB gzipped per lever | n/a | Lazy-load `WatchLive` route |
| Unity (mobile) | ≤ 2 MB IL2CPP per lever | ≤ 4 MB | No allocations in `Update()` |

### Rollout sequencing

Per audit Wave plan:

1. **Week 1** — Server-side: streak engine, push ladder, KPI events,
   scarcity API. Zero UI risk.
2. **Week 2** — Web UI: L1 onboarding, L2 scarcity, L3 ticker,
   abandonment nudge.
3. **Week 3** — Unity UI: L4 predictive toast, L5 watch-live, L6
   streak.
4. **Week 4** — Wave-2 slate (`WAVE_2_SLATE_DRAFT`) + Pick-N v2 doubleup
   (`PICKN_DOUBLEUP_DEFAULT`).

A/B exposure for each lever is 50/50 within the user's cohort for the
first 14 days, then full ramp if KPI floor hit.

---

## Sources cited

| # | Source | Used for |
|---|---|---|
| 1 | [SQ Magazine — Mobile Games Statistics 2026](https://sqmagazine.co.uk/mobile-games-statistics/) | D1 32.5%, +45% personalized onboarding lift |
| 2 | [Pushwoosh — Increase user retention 2026](https://www.pushwoosh.com/blog/increase-user-retention-rate/) | ">80% lost in week 1", streak rationale |
| 3 | [Pushwoosh — Increase DAU 2026](https://www.pushwoosh.com/blog/increase-daily-active-users/) | DAU + push cadence |
| 4 | [Mordor Intelligence — NA Fantasy Sports 2026](https://www.mordorintelligence.com/industry-reports/north-america-fantasy-sports-market) | 76% mobile, 58% age 25-34, 14.2% hybrid CAGR |
| 5 | [Strivecloud — 68 Gamification Examples 2026](https://www.strivecloud.io/blog/app-engagement-examples) | Streaks, badges, watch-live, scarcity |
