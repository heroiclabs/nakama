# Satori Event Taxonomy — QuizVerse

**Phase 5 (2026-05) — canonical event reference**
**Owner:** Backend / Analytics
**Source of truth:** `data/modules/satori_direct/satori_direct.js::SD_EVENT_ALLOWLIST`

This is the canonical list of events that flow from Nakama into the Satori
cloud dashboard. Every event listed here is on the allowlist; events NOT in
this list are still written to `analytics_events` for the in-house dashboard
but are filtered out at the `sdEventsPublish` boundary so they never burn
Satori quota.

> **Don't add new events to this doc by hand.** When you add an event to
> `SD_EVENT_ALLOWLIST` in `satori_direct.js`, also add it to
> `SEG_TAXONOMY_EVENTS` in `analytics_segments/analytics_segments.js` so the
> register-taxonomy RPC warms it up in Satori. Then refresh this doc from
> the two arrays. Drift between the two is OK — Satori auto-registers any
> name on first ingest, so an out-of-date doc is the worst-case fallout.

## How taxonomy registration works

Satori auto-registers event names on first ingest, but the Console UI is
much friendlier when each name has a definition that already exists. To
prime that:

```bash
# After every deploy that adds new canonical events:
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_register_taxonomy" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\"}"
```

The RPC fires one `taxonomy_warmup=true` event per name to a system
identity (`00000000-0000-0000-0000-000000000001`). It's idempotent —
running it 100 times is fine.

The dashboard auto-tick (`segAutoRunIfNeeded`) does NOT call
`rpcSatoriRegisterTaxonomy` — that's intentional, since taxonomy doesn't
change on every login. Run it manually after taxonomy edits or wire it
into your CI deploy step.

## Canonical events (40)

Categories below mirror the structure in `SD_EVENT_ALLOWLIST`. Each row
documents what the live-ops team can target on the Satori side.

### Lifecycle (5)

| Event              | When fired | Key metadata                        |
|--------------------|------------|-------------------------------------|
| `session_start`    | Per app foreground | `platform`, `country`, `app_version` |
| `session_end`      | Per app background | `duration_seconds`                  |
| `app_open`         | Cold app start | `platform`, `install_source`        |
| `app_launched`     | Legacy alias of `app_open` | (same)                  |
| `first_open`       | First-ever app launch per install | + identity property bag |

### Auth (2)

| `registration_completed` | After successful sign-up                         |
| `login_success`          | After successful sign-in                         |

### Onboarding (4)

| `onboarding_started`     | Onboarding flow entered                          |
| `onboarding_complete`    | Onboarding flow finished                         |
| `onboarding_completed`   | Canonical alias of `onboarding_complete`         |
| `onboarding_abandoned`   | Onboarding flow dropped out                      |

### Quiz core (4)

| `quiz_started`           | Quiz session begins. `quiz_mode`, `quiz_id`, `category` |
| `quiz_completed`         | Quiz session finished. `correct_count`, `total_questions`, `duration_seconds` |
| `quiz_abandoned`         | Quiz session left mid-way. `last_question_index`         |
| `answer_submitted`       | Per question. `is_correct`, `time_taken_seconds`         |

### Monetization (12)

| `purchase_started`       | IAP flow opened. `product_id`, `entry_point`, `paywall_id` |
| `purchase_completed`     | IAP succeeded. `+ price_local`, `currency`, `transaction_id`, `is_first_purchase` |
| `purchase_failed`        | IAP cancelled / errored. `+ failure_reason`                |
| `iap_impression`         | Storefront product viewed (legacy)                          |
| `iap_failed`             | Legacy alias of `purchase_failed`                           |
| `ad_shown`               | Ad rendered. `ad_network`, `ad_type`, `placement`           |
| `ad_completed`           | Rewarded ad finished. `+ ad_network`                        |
| `ad_revenue`             | ILRD revenue arrived. `revenue_usd`, `ad_network`           |
| `paywall_shown`          | Paywall rendered. `paywall_id`, `entry_point`               |
| `paywall_converted`      | Paywall → purchase. `paywall_id`, `product_id`              |
| `paywall_dismissed`      | Paywall closed without converting. `paywall_id`             |
| `premium_conversion`     | Subscription / premium tier upgrade. `tier`                 |
| `store_opened`           | In-game store opened. `store_id`                            |

### Retention beats (4)

| `retention_day_1`        | Day-1 return milestone (fired once per install) |
| `retention_day_7`        | Day-7 return milestone                          |
| `retention_day_30`       | Day-30 return milestone                         |
| `user_returned`          | Any return after >24h gap (per session)         |

### Multiplayer milestones (3)

| `mp_game_started`            | MP match begins. `match_id`, `mode`, `players`        |
| `mp_game_completed`          | MP match ends. `+ outcome`, `score`                   |
| `milestone_first_multiplayer`| First-ever MP match per install                       |

### Errors (2)

| `error_logged`               | App-level error caught. `error_category`, `severity`   |
| `auth_failure`               | Auth flow failed. `failure_reason`, `provider`         |

### Backfill marker (1)

| `dau_synthetic`              | Synthesised by `analytics_backfill.js` for cold-start days with no real events. Never emitted by the client. |

### Phase 5 segment triggers (2)

| `winback_eligible`           | Fired by `satori_segments_winback` for users matching `last_active>7d AND lt_quiz_plays>=5`. Cooldown 7d. |
| `preiap_nudge_eligible`      | Fired by `satori_segments_preiap` for users matching `paywall_shown>=1 AND iap_count===0`. Cooldown 3d. |

## Phase 5 segments

### Win-back

**Rule:** A user is win-back-eligible when their `last_active_utc` is more
than 7 days ago AND they have ≥ 5 lifetime quiz plays. The 5-quiz threshold
filters out installers-who-never-engaged (you can't win them back, they
never started). 7 days is the standard mobile-game win-back window.

**Trigger event:** `winback_eligible` (allowlisted, slimmed metadata
includes `days_inactive`, `lt_quiz_plays`, `lt_revenue_usd`, `fav_mode`,
`country`, `platform`).

**Identity property:** `winback_segment = "true"` set on the user.

**Cooldown:** 7 days. If a user is *still* eligible after a week, the
event re-fires. If they come back in the meantime, they fall out of the
audience naturally (their `last_active_utc` updates → rule no longer
matches).

**Live-ops setup in Satori:**
1. Console → Audiences → New
2. Rule: "fired `winback_eligible` event in the last 8 days"
3. Add a Live Event scheduled for that audience — usually a push notification with a mode-personalised subject line ("Quiz Lord, your reign is slipping!") and a deep link straight into the user's `fav_mode`.
4. Track conversion via the user's next `app_open` or `quiz_started`.

### Pre-IAP nudge

**Rule:** A user is pre-IAP-eligible when they've seen the paywall at
least once (`money.paywall_shown_count >= 1`) AND haven't completed any
purchase (`money.iap_count === 0`). These are the "show interest, don't
convert" users — by far the highest-leverage segment for paywall
optimisation.

**Trigger event:** `preiap_nudge_eligible` (slimmed metadata includes
`paywall_shown_count`, `paywall_dismissed_count`, `iap_started_count`,
`iap_failed_count`, `hours_since_last_paywall`, `lt_quiz_plays`,
`country`, `platform`).

**Identity property:** `preiap_segment = "true"`.

**Cooldown:** 3 days. Faster than win-back because pre-IAP intent decays
quickly — if the offer doesn't land within ~72 hours of the paywall view,
the user has usually moved on.

**Live-ops setup in Satori:**
1. Console → Audiences → New
2. Rule: "fired `preiap_nudge_eligible` in last 4 days"
3. Live Event: discount offer (typically 30–50% on the same product
   bundle the user saw on the paywall — the `paywall_id` metadata makes
   this easy to thread).
4. Track conversion via `purchase_completed.is_first_purchase=true`.

## Operator runbook

### After a deploy that adds new canonical events

```bash
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_register_taxonomy" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\"}"
```

### Refresh segments manually (full sweep)

```bash
# Win-back only (paged — call repeatedly with the returned next_cursor):
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_segments_winback" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\",\"max_pages\":20}"

# Pre-IAP only:
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_segments_preiap" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\",\"max_pages\":20}"

# Both, single tick:
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_segments_run" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\",\"max_pages\":20}"
```

### Inspect the last run

```bash
curl -sX POST "$NAKAMA_URL/v2/rpc/satori_segments_status" \
  -H "Content-Type: application/json" \
  -d "{\"dashboard_secret\":\"$DASHBOARD_SECRET\"}"
```

### Auto-tick

Every successful `admin_login` calls `segAutoRunIfNeeded` which runs both
segments over 2 GPA pages, throttled to once per 5 minutes per Nakama
process. So just opening the dashboard a few times a day already keeps
the segments warm without any cron — manual `satori_segments_run` only
needed if you've got > ~1k active users and want a full sweep faster.
