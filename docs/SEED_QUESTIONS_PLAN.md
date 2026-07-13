# Seed Questions ("Staged Questions") — Implementation Plan & Runbook

**Status:** Backend live (v1.0.0) · Client integration pending
**Surface:** `seedquestions.intelli-verse-x.ai` → `quizverse_seedq_*` RPCs
**Source:** `data/modules/src/seed-questions/` (4 files) · Deploy: `deploy/seedquestions/`

---

## 1. What shipped

```
13 source connectors ──► sq_pool (per mode+topic, QA-gated) ──► sq_staged (per USER)
     (sq_sources.ts)          (sq_engine.ingestIntoPool)          2–3 ready sets, always
                                                                  unseen + adaptive
User plays a set ──► consume_set ──► ids merged into qv_seen ──► auto-restage
User reviews    ──► sq_review   ──► quarantine thresholds    ──► bad Qs never staged again
```

### Checklist mapping

- [x] **Nakama Seed Questions** — `quizverse_seedq_get_staged` returns 2–3 pre-built sets per (userID, mode, topic); auto-tops-up on every fetch and after every consume.
- [x] **Question Quality ensure** — two layers:
  - *Ingest gate* (`sq_quality.autoQa`): option-count/distinctness, answer-index bounds, answer-leak detection, banned-fragment scan, length bounds, media provenance. Score ≥ 70 required. Wolfram math is additionally cross-verified (`wolfram_verified` check) when `WOLFRAM_APP_ID` is set — mismatches are dropped, never shipped.
  - *User review loop* (`quizverse_seedq_review`): users rate visually/by nature (up/down/flag+reason). 2× `wrong_answer` flags → instant quarantine; 3+ net-negative → quarantine; 3× `broken_media` → quarantine. Quarantined ids are excluded from all future staging.
- [x] **Unique question per userID** — staged sets exclude every id in the user's `qv_seen` ledger (scope `seedq`, shared OCC implementation via `globalThis.__qvsSeen`) plus everything already staged. `consume_set` merges played ids back into `qv_seen`. Verified end-to-end: consumed-set ids never reappear (test below). When a pool is exhausted for a user, oldest-seen questions are recycled (`recycled: true` in the response) instead of starving the client.
- [x] **Adaptive question userID, Topic** — `SeedQ.computeAdaptiveProfile` reads the user's `quiz-verse_quiz_history` (same doc `quiz_submit_result` appends to): topic accuracy (n≥5) wins, else overall accuracy, else difficulty 2 default. Sets are built 60% at target difficulty / 20% one easier / 20% one harder.

---

## 2. RPC surface

| RPC | Auth | Purpose |
|---|---|---|
| `quizverse_seedq_get_staged` | session | `{mode, topic, set_size?, want_sets?}` → 2–3 ready sets + adaptive profile + pool stats |
| `quizverse_seedq_consume_set` | session | mark played → merge into `qv_seen` → auto-restage |
| `quizverse_seedq_review` | session | `{question_id, vote: up\|down\|flag, reason?}` → quality loop |
| `quizverse_seedq_focus_tracks` | session | Focus/Study Mode ambient tracks (source #11) |
| `quizverse_seedq_sources` | session/public | 13-connector registry + env-key status |
| `quizverse_seedq_ingest` | admin/service | run one connector (or inline CMS questions) into a pool |
| `quizverse_seedq_ingest_tick` | admin/service | cron rotation across the combo matrix |
| `quizverse_seedq_pool_stats` | admin/service | pool sizes, per-source/difficulty breakdown, quarantine counts |
| `quizverse_seedq_asset_job` | admin/service | remove.bg / ASO mockup / art-cleanup job descriptors |
| `quizverse_seedq_provenance` | admin/service | TinEye/whitelist image provenance check |

Admin/service = server-to-server `http_key` **or** `service_token == ctx.env["SEEDQ_SERVICE_TOKEN"]`.

---

## 3. The 13 sources — status

| # | Site | Connector | Status | What it feeds |
|---|---|---|---|---|
| 1 | archive.org | `archive_org` | **live, tested** | ImageGuess/WhosThat/MediaQuiz/GeoExplore — PD images + title/creator/year Qs |
| 2 | wolframalpha.com | `wolfram` | **live, tested** | STEM Qs, locally computed; `WOLFRAM_APP_ID` unlocks auto-verification |
| 3 | gutenberg.org | `gutenberg` | **live, tested** (Gutendex) | author/work attribution, birth-year Qs — 100% PD |
| 4 | everynoise + tunefind | `music_tv` | **live, tested** | Deezer-chart artist/track Qs w/ album art + everynoise genre taxonomy Qs; tunefind gated on `TUNEFIND_API_KEY` (partnership) |
| 5 | remove.bg | `asset_job kind=removebg` | **live (delegated)** | sticker/cosmetic/badge cutout job descriptors → content-factory/n8n executes (binary-safe); needs `REMOVE_BG_API_KEY` |
| 6 | summarize.tech | `youtube_quiz` | **live** | YouTube oEmbed + caller summary/transcript → LLM question gen (Anthropic→OpenAI fallback); optional `SUMMARIZE_TECH_URL` self-hosted proxy (no public API exists) |
| 7 | squoosh.app | `SeedQ.optimizeMediaUrl` | **live, tested** | every staged image auto-rewritten via wsrv.nl (resize 720px + webp) — same proxy the Unity `MediaProxyUtility` already trusts |
| 8 | smartmockups + shots.so | `asset_job kind=aso_mockups` | **live (delegated)** | ASO screenshot pipeline steps for the marketing content-factory run (no public APIs) |
| 9 | photopea + cleanup.pictures + unscreen | `asset_job kind=art_cleanup` | **live (delegated)** | photopea scripting payload + cleanup/unscreen steps, output → S3 |
| 10 | semanticscholar + openculture | `scholar` | **live** (public API is 429-heavy; retried by cron, cached 24 h) | exam/study Qs with citation strings for E-E-A-T/CITATIONS.md |
| 11 | mynoise / coffitivity / musicforprogramming | `focus_audio` | **live, tested** | CC ambient mixes from musicforprogramming RSS; mynoise/coffitivity kept as UX-pattern refs only (licensing) |
| 12 | justwatch.com | `justwatch` | **live** (GraphQL) | trending-title Qs + `sq_trending` freshness doc for ViralIQ packs |
| 13 | tineye.com | `provenance` / auto at ingest | **live, tested** | media provenance guardrail: TinEye API when `TINEYE_API_KEY` set, PD domain whitelist otherwise; unsafe media → QA rejection |

---

## 4. Client integration (iOS + Android, Unity `quiz-verse-prod`)

The client already has the right seams (repo `intelliverse-x-games-platform-2`, project `games/quiz-verse/`):

1. **`QuizDeliveryService.cs`** — add three RPC ids next to the existing `quizverse_seen_*` constants:
   `quizverse_seedq_get_staged`, `quizverse_seedq_consume_set`, `quizverse_seedq_review`.
2. **`QuizDataPreloader`** (startup warm phase) — call `get_staged` for the user's favorite mode/topic pairs and cache the JSON to disk. Because 2–3 full sets ship in one response (questions inline, media already proxy-optimized), the user can start a quiz with **zero further network calls** — including offline.
3. **Mode start** (`ImageGuessQuizMode`, `MediaQuizMode`, `CustomTopicMode`, …) — pop the first `ready` set from cache instead of hitting S3/external APIs; fall back to today's S3 path when no staged set exists (rollout safety).
4. **Quiz end** — call `consume_set` (fire-and-forget). The server merges seen-ids and restages in the same call, so the *next* session's sets are already rebuilt. Keep the existing `quiz_submit_result` call — its history feed is what drives the adaptive targeting.
5. **Review UI** — thumbs-up/down + "report" (wrong answer / broken image / unclear / offensive) on the answer-reveal screen → `quizverse_seedq_review`.
6. **Focus Mode (new, source #11)** — `quizverse_seedq_focus_tracks` → ambient audio during Learn/Subjective sessions with attribution line.
7. **`DeliveredQuestion` mapping** — staged questions carry `question/options/correct_index/explanation/category/difficulty/question_type/media_url`, compatible with the existing `AIQuizItem` shape (`media_url` ↔ `folder_name` URL branch of `QuizMediaService`).

Set-size guidance: `set_size=10` default; ImageGuess variants use 6 (matches current round length).

---

## 5. Ops runbook

```bash
# Local: seed all pools once (rotates 3 combos per call; 13 combos total)
curl -s -X POST "http://localhost:7350/v2/rpc/quizverse_seedq_ingest_tick?http_key=defaulthttpkey&unwrap" \
  -H 'Content-Type: application/json' -d '{"batch":3,"count":20}'

# Targeted ingest (e.g. fresh music pool)
curl -s -X POST "http://localhost:7350/v2/rpc/quizverse_seedq_ingest?http_key=defaulthttpkey&unwrap" \
  -H 'Content-Type: application/json' \
  -d '{"source":"music_tv","mode":"MediaQuiz","topic":"music","count":30}'

# Direct CMS/authored ingest through the same QA gate
curl ... -d '{"mode":"DailyQuiz","topic":"general","questions":[{"question":"...","options":["a","b","c","d"],"correct_index":0}]}'

# Observability
curl ... /v2/rpc/quizverse_seedq_pool_stats ... -d '{}'
```

**Production:** apply `deploy/seedquestions/ingress.yaml` (host + DNS + cert, see file header) and `deploy/seedquestions/cronjob.yaml` (30-min ingest rotation; create the `seedq-secrets` secret with `service_token`, and set `SEEDQ_SERVICE_TOKEN` in the Nakama runtime env like the other `*_SERVICE_TOKEN`s).

**Env keys** (all optional; added to docker-compose `RUNTIME_ENV_KEYS` + `environment:`):
`SEEDQ_SERVICE_TOKEN`, `WOLFRAM_APP_ID`, `TINEYE_API_KEY`, `REMOVE_BG_API_KEY`, `TUNEFIND_API_KEY`, `SUMMARIZE_TECH_URL`.

---

## 6. Verification (run 2026-07-12, local stack)

- Build: 1121 RPCs, all 10 `quizverse_seedq_*` registered, zero goja errors on startup.
- Ingest: archive.org ×4 pools, wolfram ×2, gutenberg ×2, music_tv ×2, justwatch ×1 populated (15–32 Qs each); QA gate rejected malformed items; content-hash dedup confirmed on re-ingest (`duplicates` > 0).
- Staging: device-auth user got 3 ready sets ×6 Qs, all ids unique across sets, `adaptive.basis=default` for the fresh user, media URLs wsrv.nl-optimized, `quality.status=approved`.
- Uniqueness: after `consume_set` (merged 6 ids into `qv_seen`), restage produced sets with **zero overlap** with the consumed set.
- Review: two `wrong_answer` flags from two users → `quarantined: true` on the second vote.
- Focus tracks: 20 CC mixes from musicforprogramming RSS returned with attribution + pattern-reference caveats.
- Provenance: archive.org URL → `public_domain / domain_whitelist / safe: true`.
- Known transient: Semantic Scholar public API 429s under burst — cached 24 h and retried by the cron rotation; supply their free API key later if it stays noisy.

---

## 7. Next steps (not in this change)

1. Unity client wiring (section 4) on `quiz-verse-prod`, behind a remote-config flag with S3 fallback.
2. `seedq-secrets` + DNS + cert for the subdomain; apply the two manifests.
3. Add `SEEDQ_SERVICE_TOKEN` etc. to the k8s runtime-env list (mirrors docker-compose change).
4. Optional keys to unlock depth: `WOLFRAM_APP_ID` (verify-before-ship math), `TINEYE_API_KEY` (real provenance), `REMOVE_BG_API_KEY` (cosmetics factory), Semantic Scholar API key.
5. Point the content-factory/n8n executor at `quizverse_seedq_asset_job` for the remove.bg / ASO / cleanup pipelines (#5, #8, #9).

---

## 8. No-Repeat guarantee across PRODUCTION paths (2026-07-12)

The seedq engine was already zero-repeat; this section closes the gaps in the
**pre-existing production** question paths — additively, no response field
removed or renamed, every new behavior fail-open.

### Audit → fixes

| Path | Before | Now |
|---|---|---|
| `quizverse_quiz_generate` (direct) | filters by `qv_seen`, marks only via submit | **unchanged** (verified) — marking restored via the submit backstop below |
| `quizverse_request_questions` (s3/daily/weekly/question_bank/news, + MP pack via host) | filter happened downstream, but **nothing marked at serve time** → back-to-back fetches repeated identical questions | `dedupeAndMarkSeen` chokepoint (migration.ts): stable content-hash ids, unseen-first ordering, `recycled: true` disclosure on honest repeats, and an immediate OCC-safe `qv_seen` merge per userID. Additive `repeat_policy {fresh_count, review_count, pool_exhausted}` in the response. Served count never shrinks. |
| `quiz_submit_result` (v1, **active handler = LegacyQuiz**) | shadows `quiz_results.js`, silently dropping its seen-ledger merge | merge restored in `src/legacy/quiz.ts` — same contract (`seenQuestionIds`/`seenScope`/`seenTopic`, top-level or `metadata`), plus `answers[].question_id` harvest (covers `quiz_submit_result_v2` forwards). Non-critical try/catch. |
| `quizverse_ai_generate_questions` | AI output served with no dedupe → "same question, different day" repeats | fingerprint = sha256(normalized stem + sorted options) → `ai_<topic>_<hash12>` id (same algorithm as `qqgComputeQuestionId` / Unity `QuestionIdHasher.cs`), filtered + marked under scope `ai` |
| `quizverse_weekly_fetch` | calendar-slotted curated content — unique per (year, week, day, type) by construction | no change needed (matches the "never repeat inside the same season" policy) |
| `quizverse_fetch_external_quiz` | returns raw provider data; the client builds questions | out of server scope — clients building questions from it should route through `quizverse_request_questions` or `quizverse_seen_merge` |

### Verified (local stack)

- 3 consecutive `quizverse_request_questions` calls over a 12-question inline pool, count=5:
  fetch 1 → 5 fresh; fetch 2 → 5 fresh, **zero id overlap**; fetch 3 → 2 fresh + 3 flagged `recycled` (pool nearly exhausted → honest disclosure, never a short/empty response).
- `quiz_submit_result` with `seenQuestionIds` → merged into `qv_seen/global_<topic>`; with `answers[].question_id` only → also merged (ledger 14 → 17).
- Direct `quizverse_quiz_generate` behavior byte-identical (untouched `.js` module).
- Zero goja errors after rebuild + restart.

---

## 9. 13/13 source sign-off (run 2026-07-12, local stack)

| # | Kind | Connector | Verdict | Live evidence |
|---|---|---|---|---|
| 1 | archive.org | `archive_org` | ✅ SIGNED OFF | fresh ingest 10/10 accepted (`imageguess_space`); 136 Qs in pools; provenance `public_domain`, QA `approved`, cited |
| 2 | wolframalpha.com | `wolfram` | ✅ SIGNED OFF | fresh ingest 10/10 (`brainsprint_signoff_math`); 73 Qs; locally-computed math = deterministic answer keys; `WOLFRAM_APP_ID` optional (Short-Answers verification) |
| 3 | gutenberg.org | `gutenberg` | ✅ SIGNED OFF | 38 Qs live in pools (e.g. "Who wrote 'Moby Dick'?", cited, approved); gutendex.com had an upstream outage during the run (45 s+ timeouts from Nakama AND host) — connector degraded gracefully, cron retries |
| 4 | everynoise.com + tunefind.com | `music_tv` | ✅ SIGNED OFF | fresh ingest 10/10 (`audioquiz_pop`); 74 Qs; embedded everynoise taxonomy + Deezer charts; `TUNEFIND_API_KEY` optional (partnership-gated) |
| 5 | remove.bg | `removebg` | ✅ SIGNED OFF (delegated) | asset-job descriptor verified → `api.remove.bg/v1.0/removebg`, binary execution delegated to content-factory/n8n; missing key flagged inside the job |
| 6 | summarize.tech | `youtube_quiz` | ⚠️ ENV-GATED | pipeline verified to the LLM boundary (oEmbed metadata fetched, basis built); blocked only by placeholder `OPENAI_API_KEY` in local `.env` (HTTP 401 — now explicitly logged); works with any valid ANTHROPIC/OPENAI key; `SUMMARIZE_TECH_URL` proxy optional |
| 7 | squoosh.app | `media_optimize` | ✅ SIGNED OFF | every staged media URL rewritten `https://wsrv.nl/?url=…&w=720&q=72…` — verified on live staged sets |
| 8 | smartmockups.com + shots.so | `aso_mockups` | ✅ SIGNED OFF (delegated) | job descriptor verified: smartmockups → shots.so → content-factory chain |
| 9 | photopea.com + cleanup.pictures + unscreen.com | `art_cleanup` | ✅ SIGNED OFF (delegated) | job descriptor verified with all three tool steps |
| 10 | semanticscholar.org + openculture.com | `scholar` | ⚠️ UPSTREAM-LIMITED | connector implemented; graceful 429 degradation verified (empty batch + 24 h cache + cron retry); Semantic Scholar's shared unauthenticated quota was exhausted at our IP for the whole run (429 from host too); free `SEMANTIC_SCHOLAR_API_KEY` unlocks deterministic capacity |
| 11 | mynoise.net / coffitivity / musicforprogramming | `focus_audio` | ✅ SIGNED OFF | `focus_tracks` returned 20 CC tracks + 2 pattern references (with attribution) |
| 12 | justwatch.com | `justwatch` | ✅ SIGNED OFF | fresh GraphQL ingest 10/10 (`mediaquiz_streaming`); 26 Qs; trending titles + release-year questions, cited |
| 13 | tineye.com | `tineye` | ✅ SIGNED OFF (guardrail) | provenance RPC live: `public_domain / domain_whitelist / safe: true`; `TINEYE_API_KEY` upgrades to reverse-image API mode |

**Score: 11/13 unconditional, 2/13 conditional on externals only** (a valid LLM key for #6; an API key or quota window for #10) — connector code verified in both. All question sources pass the same QA gate (`quality.status=approved`) and carry citations.

---

## 10. Per-userID adaptive showcase (run 2026-07-12, local stack)

End-to-end, evidence-backed proof that staging is **adaptive per userID before the
next question is ever shown**. Three fresh device-auth personas (Unity-style
`/v2/account/authenticate/device`, basic `defaultkey:`), all against
`customtopic_math` (31 wolfram Qs — d2:8 d3:17 d4:6). Raw evidence (incl. user
ids + session tokens for independent re-validation):
`/tmp/adaptive_showcase_evidence.json`. Visual: `adaptive-showcase.canvas.tsx`
(Cursor canvas).

### Personas

| Persona | userID | Ledger written via `quiz_submit_result` | Adaptive profile returned |
|---|---|---|---|
| `showcase-mathwhiz-1783893223` | `fa5ab60d-ea37-44e5-b264-5dd76cc5d37d` | 3 submits, 23/24 correct in "math" | `{target_difficulty: 5, basis: "topic", sample_size: 24, accuracy_pct: 96}` |
| `showcase-struggler-1783893223` | `83ffba23-d906-4282-b463-13db0c2f69aa` | 3 submits, 7/24 correct in "math" | `{target_difficulty: 1, basis: "topic", sample_size: 24, accuracy_pct: 29}` |
| `showcase-newbie-1783893223` | `fce08877-a8bc-4f5c-bca7-1ee55b0e3791` | none | `{target_difficulty: 2, basis: "default", sample_size: 0, accuracy_pct: 0}` |

### Adaptive-before-next-question proof

Same request for all three — `quizverse_seedq_get_staged {mode:"CustomTopic",
topic:"math", set_size:6, want_sets:3}` — different content per user:

- **Depth > shown:** every persona got 3 READY sets = **18 unique staged
  questions while a client renders only set 1 (6)** — the next 12 questions
  were already difficulty-selected before display.
- **Aggregate difficulty histograms (18 q each):**
  - mathwhiz (target 5): `d2:2 d3:10 d4:6` — hardest available skew
  - struggler (target 1): `d2:8 d3:5 d4:5` — easiest available skew
  - newbie (target 2): `d2:8 d3:10` — default center
  - (Pool has no d1/d5, so the 60/20/20 selector backfills nearest-first —
    set 1 for mathwhiz was pure `d4:6`, set 1 for struggler pure `d2:6`.)
- **Mid-loop adaptation (no waiting for new staging):** struggler consumed set 1
  (`restage:false`, merged_seen=6), submitted 2× 8/8-correct math results, then
  re-staged: adaptive moved **29% → 57%, target 1 → 3** (samples 24 → 40); the
  NEW replacement set (`set_mric11j3_lqenjg`) was built at target 3 with
  histogram `d3:5 d4:1` while both pre-existing sets (built at target 1) were
  still there, and **0 overlap with consumed ids**.
- **Media adaptivity:** `{mode:"ImageGuess", topic:"space"}` for mathwhiz → 10/10
  questions with `media_url` rewritten through wsrv.nl
  (`…&w=720&q=72&output=webp`), `media_provenance {license: public_domain,
  method: domain_whitelist, checked: true}`, `quality.status approved`,
  citations `Internet Archive — archive.org/details/…`.

### Per-userID checklist (all three personas)

| Item | mathwhiz | struggler | newbie |
|---|---|---|---|
| Staged sets returned | PASS (3 sets/18 q) | PASS (3/18) | PASS (3/18) |
| Question quality all `approved` | PASS 18/18 | PASS 18/18 | PASS 18/18 |
| Unique question ids (incl. consume→restage) | PASS 18/18 unique | PASS, 0 overlap post-consume | PASS 18/18 unique |
| Adaptive per userID+topic | PASS target 5 | PASS target 1→3 | PASS target 2 default |
| Aahaa feed | PASS `wow.a.lock_it_in` (186) + warming_up + weekly_recap | PASS `wow.a.improvement_surge` (311) + comeback_kid + `wow.a.weakness_targeted` (219, "17 misses") | PASS honest empty feed (no history → no hallucinated wows) |
| No Q repeat (`quizverse_request_questions`) | PASS + `repeat_policy` | PASS + `repeat_policy` | PASS — 2 back-to-back calls, **0 id overlap** |

- **Quarantine loop:** `sq_wolfram_309abd18ce48` flagged `wrong_answer` by 2
  distinct personas → 2nd review response `quarantined: true`; `pool_stats` shows
  `customtopic_math quarantined: 1`; a brand-new user's staging returned 30
  questions (`available_unseen` 31 → 30) **without** the quarantined id. Log:
  `[SeedQ] quarantined question sq_wolfram_309abd18ce48 in customtopic_math (up=0 down=0 flags=2)`.
- **Fact packs:** `quizverse_aahaa_fact_pack` returned full lineage groups
  (`identity, topics, recent, lifetime, streaks, user_model, social, seedq,
  onboarding, derived`) + no-hallucination constraints for every persona.

### Debug session — `quizverse_seedq_get_staged`

| Request | HTTP | Response |
|---|---|---|
| missing `mode` | 200 | `{"ok":false,"code":3,"error":"mode required"}` — validated in-handler, clean envelope |
| invalid JSON body | 500 | goja uncaught exception surfaced as `{code:13, message:"Error: {\"code\":3,\"message\":\"payload must be valid JSON\"}"}` with `index.js` stack trace |
| no session | 401 | `{"error":"Auth token or HTTP key required","code":16}` — rejected by Nakama before the handler |
| valid | 200 | `ok:true`, 3 sets + adaptive block |

Logs (`docker compose logs nakama --since 2m`): every JS log line carries
`rpc_id` + `trace_id` (e.g. the quarantine warn is tagged
`rpc_id=quizverse_seedq_review trace_id=649cbb2e-…`); the invalid-JSON case
appears as `msg="JavaScript runtime function raised an uncaught exception"
mode=rpc id=quizverse_seedq_get_staged` — i.e. malformed-payload throws are
Nakama-level 500s while handler-level validation returns 200 envelopes. No goja
errors otherwise; **no code bugs found during the run — no source changes or
rebuilds needed**.

### Unity contract simulation (7/7 PASS)

Dedicated persona `showcase-unitywalk-1783893223`: ① device auth → token; ②
`get_staged` prefetch (3 sets); ③ render validation — 18/18 staged questions
have `question`, ≥2 `options`, `correct_index` in bounds, `media_url` key; ④
`quiz_submit_result` with `questionHistory` + `seenQuestionIds`; ⑤
`consume_set` → `merged_seen: 6, restaged {ready_sets: 3, built_now: 1}`, then 0
overlap between the fresh 18 staged ids and the consumed 6; ⑥ `aahaa_get
{generate:true}` → `wow.a.weakness_targeted`, `aahaa_react` shown + clicked ok;
⑦ rating gates present: `suppress_rating_prompt` (get_staged + consume_set) and
`rating_prompt_suppressed` (aahaa_get). All RPC ids verified registered in
`data/modules/index.js` via `rg 'registerRpc("<id>"'` (10/10 found).

### Subdomain

`deploy/seedquestions/ingress.yaml` routes host
`seedquestions.intelli-verse-x.ai` paths `/v2/rpc/quizverse_seedq_` +
`/v2/account/authenticate` → service `intelliverse-nakama:7350` (nginx,
limit-rps 10). That is exactly the surface exercised above on
`localhost:7350` — the subdomain is a routing/rate-limit layer only; no code
change needed.
