# Seed Questions × Aahaa — Verifier Loop

Continuous, repeatable verification that every SeedQ/Aahaa deliverable works against a live Nakama backend. Each run mints **fresh device-auth personas** so the suite never depends on prior DB state.

## Artifacts

| Artifact | Purpose |
|----------|---------|
| [`scripts/verify_deliverables.mjs`](../scripts/verify_deliverables.mjs) | CLI runner — 12 checks, writes evidence JSON, `--loop` mode |
| [`web/seedquestions/verify-latest.json`](../web/seedquestions/verify-latest.json) | Last run evidence (timestamp, host, per-check PASS/FAIL + detail) |
| [`web/seedquestions/verify.html`](../web/seedquestions/verify.html) | Browser scoreboard — run button, 60 s loop toggle, loads `verify-latest.json` |
| [`deploy/seedquestions/verify-cronjob.yaml`](../deploy/seedquestions/verify-cronjob.yaml) | K8s CronJob `seedq-verify-loop` — every 30 min vs in-cluster Nakama |

## How to run

### One-shot (local dev)

```bash
# Nakama must be up: docker compose up -d
node scripts/verify_deliverables.mjs
```

Exit **0** when all 12 checks PASS; **1** otherwise. Evidence is written to `web/seedquestions/verify-latest.json`.

### Loop mode

```bash
node scripts/verify_deliverables.mjs --loop 300   # re-run every 300 s until Ctrl-C
```

### Overrides

| Flag / env | Default | Use |
|------------|---------|-----|
| `--host` / `NAKAMA_HOST` | `http://localhost:7350` | Nakama HTTP API base |
| `--http-key` / `HTTP_KEY` | `defaulthttpkey` | Admin RPCs (validator, sources, pool_stats) |
| `--client-key` / `CLIENT_KEY` | `defaultkey` | Device auth for user RPCs |
| `--out` / `VERIFY_OUT` | `web/seedquestions/verify-latest.json` | Evidence path; `--out none` to skip |
| `--no-color` | (TTY only) | Plain log output |

### Browser scoreboard

```bash
cd web/seedquestions && python3 -m http.server 8099
# open http://localhost:8099/verify.html
```

Click **Run verification** for a live in-browser suite (checks 2–12 hit Nakama directly; check 1 mirrors the last server-side `verify-latest.json`). Toggle **Loop: on (60s)** for continuous runs.

### Production CronJob

```bash
kubectl -n aicart create configmap seedq-verify-script \
  --from-file=verify_deliverables.mjs=scripts/verify_deliverables.mjs \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -f deploy/seedquestions/verify-cronjob.yaml
```

Job name: **`seedq-verify-loop`**. Schedule: **`*/30 * * * *`**. Target: `http://intelliverse-nakama.aicart.svc.cluster.local:7350`.

## Check → deliverable map (12 checks, 17 RPC ids)

| # | Check | Deliverable | RPCs / surface exercised |
|---|-------|-------------|--------------------------|
| 1 | RPC registration ×17 | **RPC Surface** | All 17 `registerRpc` ids present in `data/modules/index.js` |
| 2 | Fresh persona staging | **SeedQ Adaptive** | `quizverse_seedq_get_staged` — 3×6 sets, `adaptive.basis === "default"` |
| 3 | Adaptive difficulty hi>lo | **SeedQ Adaptive** | `quiz_submit_result` × history → high-acc target **>** low-acc target |
| 4 | Pre-staged depth 2–3 | **D1 No-repeat** | Sets 2–3 exist before set 1 is consumed |
| 5 | Staged id uniqueness ×18 | **D1 No-repeat** | 18 staged ids across 3 sets, all distinct |
| 6 | Consume → restage no-overlap | **D1 No-repeat** | `quizverse_seedq_consume_set` → restage has **zero** overlap with consumed ids |
| 7 | No-repeat chokepoint ×2 | **D1 No-repeat** | `quizverse_request_questions` back-to-back — disjoint ids + `repeat_policy` arithmetic |
| 8 | Quality approved + honesty | **SeedQ Quality** | Every served question `quality.status === "approved"`; `repeat_policy` + `suppress_rating_prompt` |
| 9 | Media wsrv.nl + provenance | **SeedQ Media** | `ImageGuess` / `space` — `media_url` via wsrv.nl + `media_provenance` |
| 10 | Aahaa feed + fact pack | **D2 Fact-pack · D3 Aahaa** | `quizverse_aahaa_get`, `quizverse_aahaa_fact_pack`, `quizverse_aahaa_react` |
| 11 | Validator no-hallucination | **D4 Validator** | `quizverse_aahaa_validate` — fabricated text **fails**, faithful rephrase **passes** |
| 12 | Sources ×13 + pool stats | **Sources** | `quizverse_seedq_sources` (13 connectors) + `quizverse_seedq_pool_stats` |

### The 17 RPC ids (check 1)

```
quizverse_seedq_get_staged      quizverse_seedq_consume_set     quizverse_seedq_review
quizverse_seedq_focus_tracks    quizverse_seedq_sources         quizverse_seedq_ingest
quizverse_seedq_ingest_tick     quizverse_seedq_pool_stats      quizverse_seedq_asset_job
quizverse_seedq_provenance
quizverse_aahaa_get             quizverse_aahaa_react           quizverse_aahaa_fact_pack
quizverse_aahaa_profile_set     quizverse_aahaa_generate_all    quizverse_aahaa_validate
quizverse_aahaa_catalog
```

## Interpreting failures

| Symptom | Likely cause |
|---------|----------------|
| Check 1 FAIL | Module not built / RPCs missing from bundle — `cd data/modules && npm run build` |
| Check 2–6 FAIL | SeedQ staging engine or math pool empty — run ingest tick or check `quizverse_seedq_pool_stats` |
| Check 7 FAIL | `qv_seen` ledger / `quizverse_request_questions` dedup regression |
| Check 8 FAIL | Quality gate rejecting questions — inspect `quality.status` on staged payload |
| Check 9 FAIL | ImageGuess/space pool empty or media URL builder broken |
| Check 10–11 FAIL | Aahaa engine / fact pack / validator regression |
| Check 12 FAIL | Sources registry count ≠ 13 or pool_stats unreachable |

## Related docs

- Interactive showcase: [`web/seedquestions/index.html`](../web/seedquestions/index.html)
- Top-5 real-user Aahaa feeds: [`docs/AAHAA_TOP5_REAL_USERS.md`](AAHAA_TOP5_REAL_USERS.md)
