# Aahaa (Wow Moments) Engine — Backend Reference & Client Wiring

**Module:** `data/modules/src/aahaa/` · **RPC prefix:** `quizverse_aahaa_*`
**Companion:** `docs/SEED_QUESTIONS_PLAN.md` (Deliverable 1 integration lives there)
**Implements:** QuizVerse Hyper-Personalization deliverables —
D1 Repetition Fatigue Intervention · D2 Knowledge Base Triad (KB-1 slice) ·
D3 Catalog of Wow Moments · D4 Deducible Insights / No-Hallucination Contract.

---

## 1 · What ships in Nakama

| File | Responsibility |
|---|---|
| `aahaa_facts.ts` | **Fact Pack builder (KB-1).** Deterministic aggregation of `quiz-verse_quiz_history`, `quiz_user_stats_<gameId>`, `quiz_results/stats`, `user_streaks`, `user_model`, `sq_staged`, `aahaa_profile`, `nk.friendsList`, `nk.accountGetId`. Every fact group carries a `lineage` entry (source collection + derivation) → powers the Growth Dashboard "tap-to-trace". |
| `aahaa_catalog.ts` | **Wow catalog (tiers S–E).** Each entry declares wow_id, tier, surface, copy template, CTA, loop event, mechanic, priority class, cooldown, `data_sources[]`, and a deterministic `eval(facts, profile)` — no LLM anywhere in the trigger path. |
| `aahaa_engine.ts` | **Generation + ranking + caps.** Per-user feed generation, trust > engagement > monetisation ranking, per-wow cooldowns, session/day/week caps, 90-day mutes, frustration block, CTR kill switch, milestone bookkeeping, `notePoolExhausted` (D1 hook), `generateAll` batch with resumable cursor. |
| `aahaa_validator.ts` | **No-Hallucination validator.** Numeric-claim traceability against the fact pack, emotion-attribution rejection, deterministic-future rejection, word cap, Fortune-Teller mode (hedging phrase required, sensitive-inference + high-stakes-advice terms rejected). Returns a safe fallback template on failure. |
| `aahaa_rpcs.ts` | RPC surface + registration (see §2). |

### Storage collections

| Collection | Owner | Contents |
|---|---|---|
| `aahaa_profile` | user | onboarding facts (exam goal/date, birthday + set-time, play time, interests), per-wow `fired_ms`, mutes, milestone ledger, rating-suppression state |
| `aahaa_feed` | user | latest ranked feed + `rating_prompt_suppressed` + `generated_ms` |
| `aahaa_stats` | system | per-wow shown/clicked/dismissed counters (CTR kill switch input) |
| `aahaa_batch` | system | generate-all paging cursor (`runs`, `users_done_total`, per-collection cursors) |

### Implemented catalog (22 wows; extend in `aahaa_catalog.ts`)

- **S:** `thousand_questions` · `year_in_quizverse` · `you_did_it_exam_passed` · `birthday_quiz`
- **A:** `lock_it_in` · `weakness_targeted` · `warming_up` · `goal_progress` · `improvement_surge`
- **B:** `weekly_recap` · `return_after_long_gap` · `month_summary` · `comeback_kid`
- **C:** `speed_pr` · `mode_specialist` · `renaissance_learner` · `aifortuneteller_lucky_mode`
- **D:** `first_friend_added` · `network_growing`
- **E:** `pool_exhausted` · `frustration_softpause` · `morning_greeting`

Server-enforced operational rules (§8 of the catalog doc): max 3 wows/session,
1 fullscreen/day, 5/week, per-wow cooldowns, 90-day mute via `react(muted)`,
auto-pause when CTR < 5% over a rolling window, no celebratory wow within
30 min of a frustration signal.

---

## 2 · RPC surface (the one API for every platform)

All RPCs are plain JSON over Nakama's standard RPC transport — the same
endpoints serve Unity (iOS/Android/Desktop via `IClient.RpcAsync`), the web
frontend (`POST /v2/rpc/<id>` with a bearer session), and server-side callers
(`?http_key=` or `service_token`).

### User RPCs (session auth)

| RPC | Request | Response (essentials) |
|---|---|---|
| `quizverse_aahaa_get` | `{ generate?: bool }` | `{ feed: [{ wow_id, tier, surface, copy, cta_action_id, loop_event, signal, fullscreen, celebratory }], rating_prompt_suppressed, generated_ms }` |
| `quizverse_aahaa_react` | `{ wow_id, action: shown\|clicked\|dismissed\|converted\|muted, fullscreen? }` | `{ ok }` — `shown` starts the cooldown; `muted` suppresses for 90 d |
| `quizverse_aahaa_fact_pack` | `{}` (or service: `{ service_token, user_id }`) | `{ facts (with lineage per group), constraints }` — Growth Dashboard + LLM prompt injection |
| `quizverse_aahaa_profile_set` | `{ target_exam_id?, exam_date_iso?, preferred_play_time?, interests?, birthday? }` | `{ changed[] }` — onboarding-set facts (birthday carries `birthday_set_ms` anti-fake guard) |

### Admin / service RPCs (`http_key` or `service_token == SEEDQ_SERVICE_TOKEN`)

| RPC | Purpose |
|---|---|
| `quizverse_aahaa_generate_all` | Cron batch: builds a feed for **every userID** (paged, resumable cursor). `{ max_users?, reset_cursor? }` |
| `quizverse_aahaa_validate` | No-Hallucination gate for LLM output: `{ text, surface?, user_id? \| facts? }` → `{ validation: { pass, violations[], numbers_checked, fallback_template } }` |
| `quizverse_aahaa_catalog` | Live-ops: full catalog + rolling CTR per wow_id + batch cursor state |

---

## 3 · Deliverable 1 wiring (repetition fatigue)

Lives in the seed-questions engine; the Aahaa engine is the intercept target.

- `quizverse_seedq_get_staged` / `quizverse_seedq_consume_set` now return:

```json
{
  "repeat_policy": {
    "fresh_count": 8, "review_count": 2,
    "pool_exhausted": false,
    "content_generation_queued": true,
    "next_refresh_eta_seconds": 900
  },
  "suppress_rating_prompt": false
}
```

- Recycled questions carry `recycled: true` — clients must render
  "N new + M Smart Review repeats", never a silent repeat.
- Unseen supply `< LOW_WATERMARK (20)` queues a priority ingest combo that the
  next `quizverse_seedq_ingest_tick` drains first (ContentX-equivalent).
- Full per-user exhaustion → `AahaaEngine.notePoolExhausted` queues
  `wow.e.pool_exhausted` ("You beat the game") **and arms rating-prompt
  suppression** (`rating_prompt_suppressed: true` on the next feed).

**Client rule:** never show the native App Store / Play Store review prompt
when `suppress_rating_prompt` (seedq) or `rating_prompt_suppressed` (aahaa)
is true.

---

## 4 · Unity wiring (iOS · Android · Desktop)

One C# client class covers all three platforms — Nakama's Unity SDK is
platform-agnostic.

```csharp
// AahaaClient.cs — drop into Assets/_QuizVerse/Scripts/Aahaa/
using Nakama; using Newtonsoft.Json;

public class AahaaClient {
    readonly IClient _client; readonly ISession _session;
    public AahaaClient(IClient client, ISession session) { _client = client; _session = session; }

    // Call on home-screen load (cached feed) and with generate=true right
    // after quiz_completed so post-quiz wows reflect the quiz that just ended.
    public async Task<AahaaFeed> GetFeed(bool generate = false) {
        var res = await _client.RpcAsync(_session, "quizverse_aahaa_get",
            JsonConvert.SerializeObject(new { generate }));
        return JsonConvert.DeserializeObject<AahaaFeed>(res.Payload);
    }

    // Close the loop for EVERY render: shown when displayed, clicked on CTA,
    // dismissed on swipe-away, muted from the card's overflow menu.
    public Task React(string wowId, string action, bool fullscreen = false) =>
        _client.RpcAsync(_session, "quizverse_aahaa_react",
            JsonConvert.SerializeObject(new { wow_id = wowId, action, fullscreen }));

    // Growth Dashboard source-of-truth (tap-to-trace lineage included).
    public async Task<string> GetFactPack() =>
        (await _client.RpcAsync(_session, "quizverse_aahaa_fact_pack", "{}")).Payload;

    // Onboarding screens write user-typed facts verbatim.
    public Task SetProfile(object fields) =>
        _client.RpcAsync(_session, "quizverse_aahaa_profile_set", JsonConvert.SerializeObject(fields));
}

public class AahaaFeed {
    public bool ok; public AahaaWow[] feed; public bool rating_prompt_suppressed; public long generated_ms;
}
public class AahaaWow {
    public string wow_id, tier, surface, copy, cta_action_id, loop_event, signal;
    public bool fullscreen, celebratory;
}
```

Surface routing (matches the catalog's `surface` field):

| `surface` value | Unity host |
|---|---|
| `PersonalizedHomeUI` | home hero / welcome line |
| `EndOfQuizReviewScreen` | post-quiz card |
| `MilestoneCelebrationScreen` | fullscreen celebration (respect `fullscreen`) |
| `MidQuizToast` | in-quiz toast stack (latency-critical, stays native) |
| `AIFortuneTeller` | fortune surface only — never on core learning screens |

Rating-prompt integration: gate `SKStoreReviewController` / Play In-App Review
behind `!feed.rating_prompt_suppressed && !seedqResponse.suppress_rating_prompt`.

Staged questions (same session object):

```csharp
var staged = await _client.RpcAsync(_session, "quizverse_seedq_get_staged",
    "{\"mode\":\"ViralIQ\",\"topic\":\"trending\"}");
// render repeat_policy honestly: "8 new + 2 Smart Review repeats"
// after play: quizverse_seedq_consume_set { mode, topic, set_id }
```

---

## 5 · Web / frontend wiring (Next.js, React Native, anything HTTP)

```ts
// aahaa.ts — works in any JS runtime with fetch
const NAKAMA = "https://<nakama-host>";

async function rpc<T>(session: string, id: string, body: unknown): Promise<T> {
  const r = await fetch(`${NAKAMA}/v2/rpc/${id}?unwrap`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return r.json();
}

export const getAahaaFeed  = (s: string, generate = false) => rpc(s, "quizverse_aahaa_get", { generate });
export const reactToWow    = (s: string, wow_id: string, action: string) => rpc(s, "quizverse_aahaa_react", { wow_id, action });
export const getFactPack   = (s: string) => rpc(s, "quizverse_aahaa_fact_pack", {});   // <GrowthDashboard> + <LineageTooltip>
export const setAahaaProfile = (s: string, fields: object) => rpc(s, "quizverse_aahaa_profile_set", fields);
```

- `<GrowthDashboard>`: render `facts.*` groups; each number's tooltip comes
  from `facts.lineage[group]` (source collection + derivation + sample size).
- LLM narration surfaces (AI Host / Fortune Teller / Tutor): fetch the fact
  pack server-side (`service_token` + `user_id`), inject `facts` +
  `constraints` into the prompt, then POST the model output to
  `quizverse_aahaa_validate` before rendering. On `pass: false`, retry once
  with a stricter prompt, then render `validation.fallback_template`.

Server-to-server (no session):

```bash
curl -X POST "$NAKAMA/v2/rpc/quizverse_aahaa_fact_pack?http_key=$HTTP_KEY&unwrap" \
  -d '{"service_token":"<token>","user_id":"<uid>"}'
```

---

## 6 · Deployment

- **Cron:** `deploy/aahaa/cronjob.yaml` — `quizverse_aahaa_generate_all` every
  15 min × 200 users/run, resumable cursor (≈19k users/day; raise `max_users`
  or frequency to scale). Requires the same `nakama-secret`/`seedq-secrets`
  as the seedq cron.
- **Env:** `SEEDQ_SERVICE_TOKEN` must be in `RUNTIME_ENV_KEYS`
  (docker-compose entrypoint) for service-token auth to work.
- **Local smoke test:**

```bash
curl -sS -X POST "http://localhost:7350/v2/rpc/quizverse_aahaa_generate_all?http_key=defaulthttpkey&unwrap" \
  -d '{"max_users":100}'
curl -sS -X POST "http://localhost:7350/v2/rpc/quizverse_aahaa_catalog?http_key=defaulthttpkey&unwrap" -d '{}'
```

---

## 7 · Verified end-to-end (2026-07-12, local stack)

| Check | Result |
|---|---|
| Feed generation from real quiz history (20 answers, 2 topics) | ✅ `morning_greeting` + `weakness_targeted` (6 Physics misses) + `lock_it_in` (7-streak Biology) with correct variables |
| Fact pack lineage groups | ✅ 10 groups, archetype `Speedrunner` (rule-based), lifetime/recent/topics all traced |
| Reaction loop: `shown` → cooldown, `muted` → suppressed on regen | ✅ both suppressed on next generate; `goal_progress`/`warming_up` backfilled |
| `generate_all` batch across all owners | ✅ 6 users processed, 0 errors, cursor wrap-around confirmed |
| Validator: valid rephrase | ✅ pass |
| Validator: invented number + emotion + deterministic future | ✅ fail with 3 violations + fallback template |
| Validator: Fortune-Teller high-stakes advice, no hedging | ✅ fail with 3 violations |
| D1: pool exhaustion (ViralIQ/trending, 16-question pool) | ✅ `pool_exhausted: true`, `suppress_rating_prompt: true`, priority ingest queued, `wow.e.pool_exhausted` at feed rank 1, recycled set disclosed as `0 fresh / 8 review` with per-question `recycled: true` |

---

## 8 · Deliverables & Integration Matrix (where/when each wow lives in the app)

### 8.1 Strategy deliverables — status

| # | Deliverable | Where it lives in code | How the app uses it | Status |
|---|---|---|---|---|
| **D1** | Repetition-fatigue intercept | `sq_engine.ts` (`repeat_policy`, low-watermark refill) + `aahaa_engine.ts` `notePoolExhausted` → `wow.e.pool_exhausted` | Clients render honest "N new + M Smart Review" copy from `repeat_policy`; on full exhaustion the "You beat the game" intercept replaces the rating prompt (`suppress_rating_prompt`) | ✅ delivered |
| **D2** | Knowledge-base triad / Fact Pack | `aahaa_facts.ts` (`buildFactPack`, lineage per group) + `quizverse_aahaa_fact_pack` | Growth Dashboard tap-to-trace; server-side fact injection into LLM prompts (AI Host / Fortune Teller / Tutor) | ✅ delivered (KB-1 slice) |
| **D3** | Wow catalog (22 moments, tiers S–E) | `aahaa_catalog.ts` + ranking/caps in `aahaa_engine.ts`; live dump via `quizverse_aahaa_catalog` | `quizverse_aahaa_get {generate:true}` after each quiz → clients render the ranked feed on the surfaces in §8.2 | ✅ delivered |
| **D4** | No-hallucination validator | `aahaa_validator.ts` + `quizverse_aahaa_validate` (service RPC) | Any LLM-narrated surface must validate copy before render; fail → `fallback_template` | ✅ delivered |

### 8.2 Integration matrix — every catalog entry

Owner legend: **Unity** = native client render · **Web** = web frontend route ·
**Push** = notification deep-link. `loop_event` is the analytics event to emit
on CTA tap (also send `quizverse_aahaa_react` with `shown`/`clicked`/`dismissed`/`muted` for every card).

| wow_id | App surface(s) | Trigger moment (when in session) | Suggested UI treatment | Loop event | Owner |
|---|---|---|---|---|---|
| `wow.s.thousand_questions` | `web:/me/celebration/[milestone_id]`; Unity WebSurfaceLauncher modal | First feed fetch after lifetime answers cross 100/500/1k/5k/10k — show on next app-open or post-quiz | Fullscreen confetti celebration + shareable badge card | `milestone_share_tapped` | Web (Unity launches) |
| `wow.s.year_in_quizverse` | `web:/me/celebration/[milestone_id]`; Unity WebSurfaceLauncher modal | App-open on/after install-day 30/100/365 | Fullscreen "year in review" scroll card, archetype reveal at the end | `anniversary_share_tapped` | Web (Unity launches) |
| `wow.s.you_did_it_exam_passed` | `web:/me/celebration/…` + AIHost voiceover | First app-open on exam day (through day +3) | Fullscreen supportive card; AI Host speaks the line, captions native | `post_exam_followup_started` | Web + Unity (voice) |
| `wow.s.birthday_quiz` | `web:/me/celebration/birthday` | First app-open of the user's birthday | Fullscreen birthday card + free custom quiz CTA (no energy cost) | `birthday_quiz_started` | Web (Unity launches) |
| `wow.a.lock_it_in` | `web:/me/wow/[wow_id]` post-quiz | Immediately after `quiz_completed` when a 5+ correct topic run ended the session | Post-quiz interstitial card with "Enroll Smart Review" primary button | `smart_review_accepted` | Web (Unity launches) |
| `wow.a.weakness_targeted` | `web:/me/wow/[wow_id]` OR AIHost intro | Post-quiz or session start when a struggling topic is detected | Empathetic card (never red/negative); AI Host variant speaks it as an offer | `weakness_targeted_quiz_started` | Web + Unity (host line) |
| `wow.a.warming_up` | Unity mid-quiz toast | Mid-quiz, the moment the 5th consecutive correct lands | 2-second non-blocking toast, no CTA — never interrupt flow | `wow_moment_clicked` | **Unity only** (latency) |
| `wow.a.goal_progress` | `web:/me` home hero card | Home-screen load while an exam goal is active | Persistent hero card with countdown + accuracy stat + "next 8 quizzes" CTA | `goal_card_clicked` | Web |
| `wow.a.improvement_surge` | `web:/me/wow/[wow_id]` post-quiz | Post-quiz when newest-half accuracy ≥ +10 pts vs prior half | Quiet, understated card ("quietly getting sharper") → Growth Dashboard | `growth_dashboard_opened` | Web |
| `wow.b.weekly_recap` | `web:/me` home hero **+ push** deep-link `/me/wow/[id]` | Weekly (6-day cooldown) once ≥20 answers accumulated | Hero card; push copy = first sentence of the card | `weekly_recap_opened` | Web + Push |
| `wow.b.return_after_long_gap` | `web:/me` home hero | First home-screen load after ≥7 days away | Warm welcome-back hero, "resume {topic}" primary CTA — no guilt framing | `resume_from_last_topic` | Web |
| `wow.b.month_summary` | `web:/me/celebration/month` (small variant) | First feed generation in a new calendar month | Non-fullscreen summary sheet + "set monthly goal" input | `monthly_goal_set` | Web |
| `wow.b.comeback_kid` | `web:/me/reveal` settings reveal card | Browsing the reveal/archetype screen after ≥2 recent comebacks | Identity-affirming reveal card ("resilience is a pattern") | `reveal_screen_opened` | Web |
| `wow.c.speed_pr` | `web:/me/wow/[wow_id]` post-quiz | Post-quiz when recent pace ≤80% of lifetime average | Speedometer visual + share button | `speed_pr_shared` | Web |
| `wow.c.mode_specialist` | `web:/me/reveal` archetype card | Reveal screen when one mode ≥60% share | Archetype badge card + deep-dive pack CTA | `mode_pack_opened` | Web |
| `wow.c.renaissance_learner` | `web:/me/reveal` archetype card | Reveal screen when ≥6 distinct modes played | Archetype badge card + mode-catalog CTA | `mode_catalog_opened` | Web |
| `wow.c.aifortuneteller_lucky_mode` | AIFortuneTeller (Unity native) | ONLY inside the Fortune Teller experience | Card-deck reveal, hedged/entertainment framing (validator-enforced) — never on learning screens | `lucky_mode_quiz_started` | **Unity only** |
| `wow.d.first_friend_added` | `web:/me/friends` friend-card highlight | Friends screen after the first friend is added (fires once ever) | Highlighted friend card + Compatibility-Quiz unlock teaser | `friend_card_opened` | Web |
| `wow.d.network_growing` | `web:/me/friends` banner | Friends screen when count crosses 5/10/25 | Slim banner + "start friend challenge" CTA | `friend_challenge_started` | Web |
| `wow.e.pool_exhausted` | `web:/me/wow/[wow_id]` EndOfQuizReviewScreen intercept | End-of-quiz review when the user exhausted a topic pool ≤7 d ago | Positive intercept card ("you beat the game"); **suppress the store rating prompt** | `recommended_topic_started` | Web (Unity intercepts) |
| `wow.e.frustration_softpause` | Unity mid-quiz toast | Mid-quiz, immediately on the 3rd consecutive wrong | Gentle hint/skip offer; suppress all celebratory wows this session | `softpause_accepted` | **Unity only** (latency) |
| `wow.e.morning_greeting` | `web:/me` welcome line | Every home-screen load (score 40 = lowest rank; ambient) | Replace the generic greeting string — text only, no card chrome | `wow_moment_clicked` | Web |

**Live showcase:** section 5 of `web/seedquestions/index.html`
("Aahaa Catalog — every wow moment we can send") renders this catalog
interactively and highlights which entries are live for a connected persona.
