# 2026-07-07 — Event Leaderboards: admin config → game runtime wiring

**Commit:** `ff8c6763` · **Pipeline:** `intelliverse-nakama` (Succeeded)

## Problem

The admin console page **Leaderboards Config → Event Leaderboards** saved configs
that the game runtime could never serve:

1. **Schema mismatch** — the page writes `{ event_leaderboards: { id: def } }`
   (snake_case: `rank_min`, `start_time_sec`, …), but the runtime RPCs
   (`hiro_event_lb_list/submit/claim/get`) only read `{ events: { id: def } }`
   (camelCase, `Hiro.EventLeaderboardConfig`).
2. **Dead activation pipeline** — the runtime only surfaced events listed in the
   `hiro_configs/active_event_lbs` system doc, and **no code anywhere wrote that
   doc**. Even a correctly-shaped config would list zero events.
3. **No leaderboard provisioning** — nothing created the backing Nakama
   leaderboard, so submits/rankings would 404.

Net effect: any event leaderboard created in the admin console was invisible to
game clients, and the feature was dormant end-to-end.

## Fix (`data/modules/src/hiro/event-leaderboards/event-leaderboards.ts`)

- **Normalize both schemas** into one event map. Admin-console defs
  (`event_leaderboards`) win on id collision over legacy runtime defs (`events`).
  Admin tier rewards (`{currencies, items[], energies, xp}`) are folded into
  `Hiro.Reward` (`xp` → `currencies.xp`).
- **Config-driven activation** — event status (`upcoming | active | ended`) is
  computed from each def's `start_time_sec` / `end_time_sec` (or
  `start + duration_sec`). No separate activation doc needed.
- **Auto-provision leaderboards** — `event_lb_<canonicalGameId>_<eventId>` is
  created on demand (submit / rankings) via `nk.leaderboardCreate` with the
  def's operator + sort order.
- Game-scoping preserved: config loads via `ConfigLoader.loadConfigForGame`,
  leaderboard ids use the canonical game id.

## Prod verification (all green)

| Step | Result |
|---|---|
| Create `qa_weekly_quiz` via `admin_config_set` (QuizVerse UUID) | saved to `quizverse:event_leaderboards` |
| `hiro_event_lb_list` as game client (`game_id: quizverse`) | `[qa_weekly_quiz, active, event_lb_quizverse_qa_weekly_quiz]` |
| `hiro_event_lb_submit` score 420 | success, leaderboard auto-created |
| `hiro_event_lb_get` | rank 1, score 420, callerRank correct |
| `hiro_event_lb_claim` (tier rank 1–3 → 100 coins + 50 xp) | `{rank: 1, reward: {coins: 100, xp: 50}}` granted |
| Isolation: `hiro_event_lb_list` with `game_id: cricketvr` | `[]` (no leak) |
| Cleanup | test config deleted, QuizVerse back to inherited state |

## Notes

- Legacy bare doc still holds a third shape (`{version, leaderboards: {ipl_fantasy_*}}`);
  these are static leaderboard defs, not timed events, and are intentionally ignored.
- This ship also carried `61d5a59b` (SPA auto-end sweep row-owner fix) which was
  pending locally.
