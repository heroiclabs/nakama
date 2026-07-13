# PR Sign-Off Request — LMS (Canvas/Moodle) Integration + Related Pending Work

**Prepared:** 2026-07-12 18:08 CDT
**Repos covered:** `dev/nakama` (backend, HEAD `088a0d74`, 2026-07-08) and `dev/Quizverse-web-frontend` (HEAD `0961dcb1`, 2026-07-12)
**Plan of record:** `docs/LMS_INTEGRATION_RESEARCH_AND_PLAN.md`
**Status:** Nothing is committed yet. This packet inventories all uncommitted work, groups it into independently mergeable PRs, and requests code-owner sign-off per group.

> ⚠️ **`web/lms-tool/` is IN FLIGHT** — another agent is actively writing it as of the timestamp above. Its file list and test-evidence claims are a snapshot; re-inventory before cutting PR-2.

---

## 🚨 BLOCKER BEFORE ANY MERGE — `.env` is tracked in git and modified

The repo's `.env` is **historically tracked in git** (`git ls-files` confirms it) and the working tree has a modified `.env` (+7 lines adding `LMS_BRIDGE_SERVICE_TOKEN`, `LTI_TOOL_PRIVATE_KEY_B64`, `LTI_TOOL_KID` — **values intentionally not reproduced here**).

**Required before any PR in this packet is opened:**

1. `git rm --cached .env` (removes from the index, keeps the local file).
2. Add `.env` to `.gitignore` (it is currently **not** ignored — `git check-ignore .env` matches nothing).
3. Commit those two changes as their own tiny PR ("stop tracking .env").
4. **`.env` must never be part of any PR in this packet or any future PR.** Every diff below that mentions env vars refers to *variable names only*; values live exclusively in the local `.env`.
5. Because `.env` has been tracked historically, treat every secret it has ever contained as exposed to anyone with repo access: **rotate them** (and consider history scrubbing with `git filter-repo`/BFG if the repo is ever made more widely visible).

Also note: `.lms-dev/` contains **private keys** (`.lms-dev/keys/lti_tool_private.pem`) and local LMS admin credentials. It is correctly gitignored (see PR group C) and must stay local.

---

## PR Grouping Overview

| # | PR Group | Repo | Files | Merge order / deps | Status |
|---|----------|------|-------|--------------------|--------|
| 0 | Stop tracking `.env` (blocker) | nakama | `.gitignore` (one line) + `git rm --cached .env` | **First, before everything** | Ready |
| A | lms-bridge Nakama module + runtime env plumbing | nakama | 4 source files + regenerated bundle | After PR-0; independent otherwise | Ready |
| B | LTI 1.3 tool web service (`web/lms-tool/`) | nakama | 23 files | After PR-A (calls its RPCs; degrades to mock without it) | **In flight — snapshot 2026-07-12 18:08 CDT** |
| C | LMS local dev kit (`.lms-dev/`) | nakama | n/a | **NOT a PR — gitignored, stays local** | Local only |
| D | LMS docs + marketing landing page | nakama | 2 files | Independent | Ready |
| E | `/standards` marketing page | frontend | 4 files | Independent | Ready |
| F | Unrelated pre-existing / parallel dirty files | both | ~40 files | **NOT part of this sign-off — separate triage** | Triage |

---

## PR-0 — Stop tracking `.env` (security blocker)

**Purpose:** Remove `.env` from version control permanently so no secret values can enter any future diff.

**Changes:**
| File | Description |
|---|---|
| `.gitignore` | Add `.env` entry (currently absent). |
| `.env` | `git rm --cached .env` — untrack, keep local file. **Do not commit its contents.** |

**Risk:** None at runtime (docker-compose reads the local file). Rollback: re-add the file path (never the historical content).

**Sign-off:**
- [ ] Code reviewed
- [ ] Security reviewed (secret rotation plan confirmed)
- [ ] Approved to merge
- Reviewer: ______________ Date: ______________

---

## PR-A — `lms-bridge`: Nakama-side LTI 1.3 module (platform registry, launch, grading, AGS grade push, pack import)

**Purpose:** The server-of-record half of the LMS integration (plan §5/§8): LTI platform allowlist, launch-session mapping (LTI `sub` → Nakama user via custom auth), resource-link↔pack bindings, server-side grading against `quizverse_packs`, a durable AGS grade queue with an RS256 client-credentials score-push worker, and the content-import pipeline with fidelity reports.

**Files:**
| File | Description |
|---|---|
| `data/modules/src/lms-bridge/lms_bridge.ts` (new, 927 lines) | Entire module: 9 `lms_*` RPCs, storage collections (`lms_platforms`, `lms_links`, `lms_attempt_results`, `lms_grade_queue`), service-token gate, AGS push worker. |
| `data/modules/src/main.ts` (partial — **LmsBridge block only**, see entanglement note) | Registers the module inside `InitModule` with try/catch isolation. |
| `docker-compose.yml` (partial — **LMS lines only**) | Adds `LMS_BRIDGE_SERVICE_TOKEN LTI_TOOL_PRIVATE_KEY_B64 LTI_TOOL_KID` to `RUNTIME_ENV_KEYS` + matching `environment:` passthroughs (`${VAR:-}` references only, no values). |
| `.gitignore` (partial — one hunk) | Adds `.lms-dev/` (local keys + LMS stacks stay out of git). |
| `data/modules/index.js`, `data/modules/build/*` | Auto-generated bundle — **regenerate with `npm run build` on the PR branch**, never hand-edit. Current working-tree bundle also contains parallel (non-LMS) work; do not commit it as-is. |

**⚠️ Entanglement note for the person cutting this PR:** the working-tree diffs of `main.ts` and `docker-compose.yml` also carry hunks for *other* parallel initiatives (Seed Questions, Aahaa, Research, AiMirror, TutorX coin gate — see Group F). Stage only the LMS hunks (`git add -p`), then rebuild so the committed bundle contains exactly this PR's modules plus what is already on `main`.

**Representative code — 1) `InitModule` registration (`data/modules/src/main.ts`):**

```ts
  // ---- LMS Bridge (LTI 1.3 — Canvas / Moodle integration) ----
  try {
    logger.info("[LmsBridge] Registering lms_* RPCs (platforms, launch, deeplink bind, attempt grading, AGS grade push, pack import, link status)...");
    LmsBridge.register(initializer);
    logger.info("[LmsBridge] lms_platform_upsert/_list/_delete, lms_launch_session, lms_deeplink_bind, lms_attempt_complete, lms_grade_push, lms_import_pack, lms_link_status registered");
  } catch (err: any) {
    logger.error("[LmsBridge] Failed to register: " + (err && err.message ? err.message : String(err)));
  }
```

with the string-literal `registerRpc` block (required by postbuild.js v2's AST hoisting):

```ts
  export function register(initializer: nkruntime.Initializer): void {
    initializer.registerRpc("lms_platform_upsert", rpcPlatformUpsert);
    initializer.registerRpc("lms_platform_list", rpcPlatformList);
    initializer.registerRpc("lms_platform_delete", rpcPlatformDelete);
    initializer.registerRpc("lms_launch_session", rpcLaunchSession);
    initializer.registerRpc("lms_deeplink_bind", rpcDeeplinkBind);
    initializer.registerRpc("lms_attempt_complete", rpcAttemptComplete);
    initializer.registerRpc("lms_grade_push", rpcGradePush);
    initializer.registerRpc("lms_import_pack", rpcImportPack);
    initializer.registerRpc("lms_link_status", rpcLinkStatus);
```

**2) `RUNTIME_ENV_KEYS` diff (`docker-compose.yml`) — names only, values resolved from local `.env`:**

```diff
           IVX_AI_SVC_BASE_URL IVX_INSIGHTS_SHARED_SECRET IVX_INSIGHTS_BUCKET_MS
+          LMS_BRIDGE_SERVICE_TOKEN LTI_TOOL_PRIVATE_KEY_B64 LTI_TOOL_KID
...
+      # LMS Bridge (LTI 1.3). LTI_TOOL_PRIVATE_KEY_B64 is the RS256 tool key,
+      # base64 of the PEM on a single line (multiline PEMs break the
+      # --runtime.env flag builder); lms_bridge.ts decodes with nk.base64Decode.
+      - LMS_BRIDGE_SERVICE_TOKEN=${LMS_BRIDGE_SERVICE_TOKEN:-}
+      - LTI_TOOL_PRIVATE_KEY_B64=${LTI_TOOL_PRIVATE_KEY_B64:-}
+      - LTI_TOOL_KID=${LTI_TOOL_KID:-}
```

**3) AGS score push (the load-bearing outbound path, `lms_bridge.ts` ~line 600):** RS256 client-credentials assertion → token endpoint → `POST <line_item>/scores`:

```ts
    var assertion = nk.jwtGenerate("RS256", pem, {
      iss: str(platform.client_id), sub: str(platform.client_id),
      aud: str(platform.token_url), iat: now, exp: now + 300, jti: nk.uuidv4()
    });
    // ... client_credentials token exchange (scope: lti-ags/scope/score) ...
    var scorePayload = JSON.stringify({
      userId: str(row.sub),
      scoreGiven: row.score_given, scoreMaximum: row.score_maximum,
      timestamp: new Date().toISOString(),
      activityProgress: "Completed", gradingProgress: "FullyGraded"
    });
    scoreRes = nk.httpRequest(postUrl, "post", { /* Bearer token */ }, scorePayload, HTTP_TIMEOUT_MS);
```

**Auth model:** every RPC requires `service_token === ctx.env['LMS_BRIDGE_SERVICE_TOKEN']` (constant defined once, compared strictly; empty env ⇒ always deny). Ops RPCs (`lms_platform_*`, `lms_grade_push`) alternatively accept the existing `RpcHelpers.requireAdmin` http_key path.

**Risk assessment:**
- *Runtime impact:* additive only — 9 new RPCs, no existing RPC or hook modified by this group. Registration is wrapped in try/catch, so a failure degrades to a logged error, not a startup crash. No cron/scheduler is registered; the grade queue drains only when `lms_grade_push` is invoked (web cron / manual ops).
- *Blast radius if misconfigured:* with `LMS_BRIDGE_SERVICE_TOKEN` unset, all RPCs return 403 — safe default. With the private key unset, grade push fails with an explicit error while grading/launch still work.
- *Rollback:* revert the commit, `npm run build`, `docker compose restart nakama`. No DB migration; storage collections are additive and inert if the module is removed.

**Test evidence:**
- `rg 'registerRpc\("lms_' data/modules/index.js` → all 9 RPCs present in the generated bundle (verified 2026-07-12 18:08 CDT).
- The LTI tool's README documents an integration matrix, "verified live 2026-07-12": all 8 consumed RPCs live against the running local Nakama, including allowlist enforcement on `lms_launch_session`.
- End-to-end launch→grade exercised via `web/lms-tool/scripts/simulate-launch.js` (see PR-B).
- Reviewer should re-run: `cd data/modules && npm run build`, restart, check `docker compose logs nakama` for `[LmsBridge] ... registered` and zero `goja:` errors.

**Sign-off:**
- [ ] Code reviewed
- [ ] Security reviewed (token gate, RS256 key handling, no secrets in diff)
- [ ] Approved to merge
- Reviewer: ______________ Date: ______________

---

## PR-B — LTI 1.3 Tool web service (`web/lms-tool/`) — **IN FLIGHT, snapshot as of 2026-07-12 18:08 CDT**

> Another agent is actively editing this directory right now. Review the concepts and contract now; re-diff the file list before opening the PR.

**Purpose:** The standalone Node 20 web tier of the integration (plan §5/§6/§7/§9/§13, Workstream C): OIDC login/launch/JWKS/Dynamic Registration via `ltijs`, the student quiz player, the teacher deep-linking picker with Moodle XML / Canvas QTI import + fidelity reports, format converters, and the client for PR-A's RPC contract.

**Files (23, snapshot; `node_modules/`, `data/`, `.keys/`, `.env`, `*.sqlite` are locally gitignored by `web/lms-tool/.gitignore`):**
| File | Description |
|---|---|
| `package.json` / `package-lock.json` | Deps: ltijs, ltijs-sequelize, sqlite3, express, fast-xml-parser, adm-zip, multer. Node ≥20. |
| `.gitignore` | Excludes runtime state, generated keys, and the tool-local `.env`. |
| `README.md` | Run/config/registration guide, RPC contract status matrix, keypair architecture note. |
| `src/server.js` | ltijs boot, LTI handlers (login/launch/deep-link), APIs (`/api/attempt/submit`, `/api/deeplink/respond`, `/api/import`, export), admin routes. |
| `src/config.js` | Env + canonical-key loading (falls back to a temp generated pair, flagged in `/health`). |
| `src/nakama-client.js` | lms-bridge RPC client: live Nakama + in-process mock fallback + response-envelope unwrap. |
| `src/pack-store.js` | Local pack mirror (`data/packs.json`) + demo pack seed. |
| `src/converters/{canonical,moodle-xml,qti,index}.js` | Moodle XML ⇄ canonical ⇄ QTI 1.2 zip, with per-item fidelity notes (no silent lossy imports, plan §13.2). |
| `src/pages/{layout,player,picker,admin,index}.js` | Server-rendered UI: student player (iframe-safe), teacher picker, registration helper. |
| `mock-nakama/{handlers,server}.js` | RPC stub — in-process fallback + optional standalone `:7360`. |
| `scripts/simulate-launch.js` | Fake-platform E2E: OIDC → launch → submit → AGS assert (9 checks), no real LMS needed. |
| `test/converters.test.js` + `test/fixtures/*` | 9 `node:test` converter tests (parse, fidelity, negative, both round-trips). |

**Representative contract (from README — the tool's integration matrix against PR-A, verified live 2026-07-12):** `lms_platform_list/_upsert`, `lms_launch_session` (allowlist enforced), `lms_deeplink_bind`, `lms_attempt_complete`, `lms_link_status`, `lms_grade_push`, `lms_import_pack` — all live; on Nakama outage the client degrades to the local mock and surfaces "integration-pending" on `/health`, and a rejected launch degrades to local grading rather than breaking the student.

**Risk assessment:**
- *Runtime impact:* zero on Nakama — separate process on `:8090`, not part of the Goja bundle. Deploy is opt-in.
- *Known review items (security):* `LMS_TOOL_DEV_MODE=true` (ltijs devMode, plain-http iframes) and `autoActivate: true` are **local-dev defaults that must be off in production**; the AGS grade-back dual-path (ltijs-managed keys vs canonical key, README "Keypair situation") needs an explicit production decision per plan §8.
- *Rollback:* stop the service; no shared state with Nakama beyond the RPCs.

**Test evidence (as claimed by the in-flight README; re-run before merge):** `npm test` → 9 converter tests; `node scripts/simulate-launch.js` → 9-check launch/grade E2E; manual E2E against local Moodle 4.5.4 with gradebook write-back via AGS (`gradingProgress=FullyGraded`).

**Sign-off:**
- [ ] Snapshot re-inventoried after the in-flight agent finishes
- [ ] Code reviewed
- [ ] Security reviewed (devMode/autoActivate off for prod, key handling)
- [ ] Approved to merge
- Reviewer: ______________ Date: ______________

---

## Group C — `.lms-dev/` local LMS dev kit — **NOT a PR; stays local**

**Purpose:** Workstream A's local test environments: Moodle 4.5.4 stack (compose + idempotent `provision.php` + question fixtures), a legacy Canvas container for REST/QTI shape testing, saltire emulator config for LTI 1.3 E2E, shared RSA keypair, and format fixtures.

**Why it is not a PR:** `.gitignore` now contains `.lms-dev/` (hunk included in PR-A). The directory holds the **RS256 private key** (`keys/lti_tool_private.pem`), local admin credentials, and Docker volume config — none of it belongs in git. The shareable parts (fixtures) are already mirrored into `web/lms-tool/test/fixtures/`.

**Action for reviewer:** confirm the `.gitignore` hunk lands with PR-A and that `git status` never shows `.lms-dev/` afterwards. If the team wants the *scripts* (compose file, `provision.php`) shared later, extract them into a follow-up PR **without** `keys/`.

**Sign-off:**
- [ ] Confirmed gitignored and excluded from all PRs
- Reviewer: ______________ Date: ______________

---

## PR-D — LMS docs + marketing landing page

**Purpose:** The research/architecture plan of record for the whole integration, plus a static, self-contained marketing landing page for `lms.quizverse.world`.

**Files:**
| File | Description |
|---|---|
| `docs/LMS_INTEGRATION_RESEARCH_AND_PLAN.md` (new) | Full research + phased plan (LTI 1.3/Advantage, AGS, QTI/Moodle XML, workstreams A–C) that PR-A/B implement; §-references appear throughout the code. |
| `web/lms-landing/index.html` (new, 416 lines) | Single-file static landing page ("Connect Canvas & Moodle. Pull quizzes. Push grades."), inline CSS, canonical URL `https://lms.quizverse.world/`, no JS dependencies, no secrets. |

**Risk assessment:** none at runtime — documentation and a static HTML file; nothing imports them. Rollback: revert. Reviewer should sanity-check marketing claims match what PR-A/B actually ship, and that trademark usage (Canvas/Moodle) stays nominative.

**Test evidence:** n/a (static). Landing page renders standalone in a browser.

**Sign-off:**
- [ ] Code reviewed
- [ ] Content/claims reviewed
- [ ] Approved to merge
- Reviewer: ______________ Date: ______________

---

## PR-E — Frontend repo: `/standards` marketing page (`Quizverse-web-frontend`)

**Purpose:** Public explainer page for schools/teachers on the open standards the integration uses (LTI 1.3 + LTI Advantage, QTI), with SEO metadata and sitemap entry.

**Files:**
| File | Description |
|---|---|
| `web/app/standards/page.tsx` (new, 59 lines) | Next.js route: metadata (canonical `/standards`, OG/Twitter), breadcrumb JSON-LD, renders the showcase inside `MarketingShell`. |
| `web/components/StandardsShowcase.tsx` (new, 256 lines) | Reusable showcase component (kept out of the route so other school-facing surfaces can embed it). |
| `web/components/brand/TechMarks.tsx` (modified, +66) | Adds `CanvasMark` and `MoodleMark` SVG badges — explicitly *simplified, non-official* marks with trademark attribution comments. |
| `web/app/sitemap.ts` (modified, +6) | Adds the `/standards` URL (monthly, priority 0.6). |

**Representative code — sitemap entry:**

```diff
+    {
+      url: `${siteUrl}/standards`,
+      lastModified: buildDate,
+      changeFrequency: 'monthly' as const,
+      priority: 0.6,
+    },
```

and the trademark-safe brand marks:

```tsx
/**
 * Canvas LMS wordmark badge — simplified red circle glyph + wordmark text.
 * Not the official Instructure logo; Canvas is a trademark of Instructure, Inc.
 */
export const CanvasMark: React.FC<TechMarkProps> = ({ className, title }) => ( /* svg */ );
```

**Risk assessment:** additive static marketing route; no data fetching, no auth surface. Only shared-file touch is `TechMarks.tsx` (append-only exports) and `sitemap.ts` (one entry). Rollback: revert; the sitemap regenerates. Legal note for reviewer: marks are intentionally non-official with attribution — confirm this meets brand-usage policy.

**Test evidence:** not run in this packet (frontend build/lint should be run in CI on the PR branch: `next build` + route smoke check of `/standards`).

**Sign-off:**
- [ ] Code reviewed
- [ ] Brand/legal reviewed (Canvas/Moodle trademark usage)
- [ ] Approved to merge
- Reviewer: ______________ Date: ______________

---

## Group F — NOT part of this sign-off — needs separate triage

These files are dirty in the working trees but are **not LMS work**. Do not lump them into the PRs above. Classification basis: file mtimes, `git log`, and content inspection.

### F.1 — Parallel same-day initiatives (Seed Questions / Aahaa / Research — own sign-off packet recommended)
Written 2026-07-12 by other agents in the same swarm, per `docs/SEED_QUESTIONS_PLAN.md`, `docs/AAHAA_WOW_ENGINE.md`, `docs/GO_LIVE_SEEDQUESTIONS_AAHAA.md`:

- `data/modules/src/seed-questions/` (5 new files), `data/modules/src/aahaa/` (5 new files), `data/modules/src/research/research.ts`
- `data/modules/src/legacy/quiz.ts` (modified 2026-07-12 16:12 — seedq integration touchpoint)
- `deploy/seedquestions/`, `deploy/aahaa/`, `web/seedquestions/`, the three docs above
- **Shared-file hunks:** the SeedQ/Aahaa/Research registration blocks in `main.ts`, and the `SEEDQ_SERVICE_TOKEN WOLFRAM_APP_ID TINEYE_API_KEY REMOVE_BG_API_KEY TUNEFIND_API_KEY SUMMARIZE_TECH_URL` + `QV_RESEARCH_SERVICE_TOKEN` lines in `docker-compose.yml` (names only; values in local `.env`)

### F.2 — Pre-existing dirt (modified before 2026-07-12; unrelated efforts)
- **TutorX / AI dashboard (late June):** `data/modules/src/tutorx/tutorx_coin_gate.ts` (new), `tutorx_progress.ts`, `data/modules/src/ai-content/ai_mirror.ts` (new) — plus their `main.ts` registration hunks
- **Ads/analytics cleanup (Jun 28):** `shared/ad-revenue-event.ts`, `shared/fortune-wheel-ad-spin.ts`, `shared/web-ad-reward.ts` (register signature change, mirrored in `main.ts`), `analytics/event-enricher.ts`, `legacy/notification_scheduler.ts`
- **Jul 3–11 work:** `satori/analytics-alerts.ts`, `library/n8n-pack-state.ts`, `ai-content/ai_pipelines.ts`, `learner-toolbelt/lt_schools.ts` + `learner_toolbelt.ts` (+ `bootstrapSchoolsTable` hunk in `main.ts`), `legacy/push.ts`, `games/quizverse/blog_embed.ts`, `games/quizverse/migration.ts`, `data/modules/ai_player/ai_player.js`
- **Lambda:** `lambda-functions/send-push/` (`index.js` deleted → `index.mjs` modified)
- **Tooling/SEO (unrelated to any backend PR):** `.agents/skills/{competitive-landscape,competitor-analysis,keyword-clustering,keyword-research,link-prospecting,seo-coach,seo-project-setup}/`, `skills-lock.json`, `data/modules/build-tests/toolbelt-tests.js`
- **Frontend repo:** `web/scripts/generate-exam-explainer.mjs` (modified 2026-07-11; belongs to the Simi explainer effort from commits `0961dcb1`/`80cc8c3b`, not the standards page)

### F.3 — Generated artifacts (never review by hand)
`data/modules/index.js`, `data/modules/build/index.js`, `data/modules/build/index.d.ts` — auto-generated by `npm run build`/postbuild.js. The current working-tree versions contain **all** parallel work merged together; each PR must regenerate them on its own branch rather than committing the current mixture.

### Files not confidently classified
- `data/modules/src/games/quizverse/migration.ts` (+149 lines) and `data/modules/ai_player/ai_player.js` — plausibly related to the seedq/quiz work but not confirmed by content; triage with their authors.

---

## Secret-hygiene attestation for this document

This packet was grepped before delivery: it contains **no secret values** — only environment-variable *names* (`LMS_BRIDGE_SERVICE_TOKEN`, `LTI_TOOL_PRIVATE_KEY_B64`, `LTI_TOOL_KID`, seedq key names) and `${VAR:-}` compose references. The local-dev credentials that exist in `.lms-dev/README.md` were deliberately not reproduced here.
