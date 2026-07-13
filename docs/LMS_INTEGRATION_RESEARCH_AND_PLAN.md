# LMS Integration — Research & Plan: Canvas + Moodle Pull/Push with a Seamless Student Quiz Frontend

**Version:** 1.2.0 | **Date:** 2026-07-12 | **Status:** Research complete (Firecrawl-verified), plan proposed (no code written yet). v1.2.0 adds §13 Standards Compliance Charter (LTI 1.3 / LTI Advantage + QTI) with 1EdTech-spec-verified citations.

> **Verification note:** All external claims below were verified in two passes on 2026-07-12: (1) live fetches of the official documentation pages (Instructure developer portal, moodledev.io, docs.moodle.org, moodle.org/plugins, Moodle core source on GitHub `main`), and (2) an independent **Firecrawl re-verification pass** (`api.firecrawl.dev/v2/scrape`, key pulled from SSM `/codebuild/AI` → `FIRECRAWL_API_KEY`) that re-scraped the ten load-bearing sources and phrase-checked the critical claims — results in §12.1. Claims that could not be confirmed on a live official page remain explicitly marked **UNVERIFIED**.

---

## 0. Executive Summary

**Goal:** A student (or their teacher) connects QuizVerse to their school's Canvas or Moodle. Quizzes **pull** from the LMS into our detailed quiz frontend; results **push** back into the LMS gradebook. The student experience must be seamless: click a link inside the LMS → land in our quiz app already authenticated → take the quiz → grade appears in the LMS automatically.

**Recommendation (both LMSs converge on the same answer):**

1. **Become an LTI 1.3 / LTI Advantage Tool.** This is the only path that delivers the seamless flow on both platforms. Canvas and Moodle both fully support the three Advantage services we need: **OIDC launch** (zero-login student auth), **Deep Linking 2.0** (teacher picks a QuizVerse quiz, a graded assignment/line item is created in the LMS), and **Assignment & Grade Services (AGS)** (we POST the score; it appears in the gradebook with no teacher token and no student action).
2. **Use each LMS's content APIs for the pull side.** Canvas: REST Quizzes/Quiz-Questions APIs + QTI export via Content Exports API. Moodle: Moodle XML export (UI-driven) + optional local plugin for API-driven export, plus `mod_quiz_*` web services for metadata and even native-attempt driving.
3. **Split the implementation across our two tiers.** The LTI tool endpoints (OIDC, JWKS, deep-linking UI) live in the **web frontend** (quizverse.world Next.js tier — it can verify RS256 JWTs; the Goja runtime cannot). Nakama gains a new `lms-bridge` module for identity mapping, imported-pack storage, result capture, and **outbound AGS score posts** (Goja *can* sign RS256 client assertions via `nk.jwtGenerate`).
4. **Ship in three tiers of increasing integration depth:** (A) LTI launch + AGS grade-back (seamless MVP), (B) content pull (Canvas API / QTI / Moodle XML import into `quizverse_packs`), (C) student-owned token mode for self-directed learners whose schools haven't installed the tool.

**Two time-sensitive findings (verified July 2026):**

- **Canvas Free-for-Teacher is permanently discontinued** (May 2026 security incident). There is no free hosted Canvas testbed anymore — we must run open-source Canvas locally in Docker for development. (Source: instructure.com/incident_update + live banner on canvas.instructure.com doc pages.)
- **The Moodle Plugins Directory goes read-only on 14 July 2026** (two days from this writing) ahead of the Moodle Marketplace migration. Any plugin ZIP we may depend on (`qformat_canvas`, `local_questions_importer_ws`, `local_qbankremotemanager`) should be mirrored **immediately**. (Source: live banner on moodle.org/plugins.)

---

## 1. Scope & Definitions

| Term | Meaning here |
|---|---|
| **Pull** | Import quiz/assessment content and course/assignment context from the LMS into QuizVerse |
| **Push** | Send student results/grades from QuizVerse back into the LMS gradebook |
| **Seamless** | Student never types a second password, never copies a token, never leaves a broken iframe; grade sync needs no manual step |
| **LTI 1.3 / Advantage** | 1EdTech standard: OIDC-based launch + AGS (grades) + NRPS (roster) + Deep Linking (content picking) |
| **QTI** | IMS Question & Test Interoperability XML format (Canvas classic exports QTI 1.2-flavored packages) |
| **Moodle XML** | Moodle's native question exchange format — the only Moodle format that carries full fidelity + embedded images |

Games/products in scope: QuizVerse quiz engine (packs, server-graded attempts), TutorX/learner-toolbelt progress surfaces later.

---

## 2. Current State of Our Platform (codebase audit)

A full sweep of this repo found **zero existing LMS surface** — no Moodle, Canvas, LTI, QTI, SCORM, xAPI, OneRoster, Common Cartridge, Google Classroom, Clever, or ClassLink code or docs anywhere.

### 2.1 What exists and is reusable

| Asset | Where | Why it matters |
|---|---|---|
| Quiz data model `IQuestion` / `IPack` | `data/modules/src/games/quizverse/types.ts` (~L98–115) | Target shape for imported LMS questions: `{question_id, text, options[], correct_index, image_url?, difficulty?, explanation?}` — maps 1:1 onto multiple-choice QTI/Moodle XML items |
| Pack storage | `quizverse_packs` collection, `pack-store.ts` | System-owned, public-read — imported LMS quizzes become packs |
| Server-side grading | `quiz_submit_result_v2` (`migration.ts` ~L323–417) | Grades `{question_id, selected_index, latency_ms}[]` against a persisted per-user pack (`qv_question_pack`) — the correct authoritative scoring seam for grade passback |
| Anonymous web participant pattern | `blog_embed.ts` (`qv_blog_embeds`, device ledger, claim flow) | Closest analog to an LMS-iframe student who has no Nakama account yet |
| Webview JWT SSO | `webview_token_issue` (`migration.ts`) | Existing short-lived HMAC-JWT handoff to microsites (tutorx/live/exam-coach hosts) — same pattern extends to the LTI-launched quiz player |
| Service-token auth model | `QV_RESEARCH_SERVICE_TOKEN`, `SEEDQ_SERVICE_TOKEN` etc. | Established pattern for the web tier calling privileged Nakama RPCs |
| School directory | `lt_school_*` RPCs (`lt_schools.ts`) | School identity only — **no classes, rosters, teachers, or assignments exist** |
| Outbound HTTP + HMAC | `nk.httpRequest`, `shared/http-client.ts` (`signedPost`) | The vehicle for Canvas REST / Moodle WS / AGS calls |
| RS256 signing | `nk.jwtGenerate('HS256'|'RS256', key, claims)` in nakama-common | Goja **can** sign LTI AGS client assertions. **It cannot verify RS256 JWTs** — incoming LTI launches must be validated in the web tier |

### 2.2 Where the student frontend lives

This repo is the Nakama backend + an admin/player web shell (`web/packages/admin`, `web/packages/player` — no quiz-taking pages). The actual student quiz UX lives in **separate web deployments** on `quizverse.world` subdomains (tutorx., live., web., words.) plus the Unity app. The LTI tool endpoints and the LMS quiz player UI will live in that web tier.

### 2.3 Gaps (all must be built)

- No LTI tool (no OIDC endpoints, JWKS, deep-linking picker)
- No QTI / Moodle XML / Canvas-API import pipeline
- No LMS identity mapping (LTI `sub` ↔ Nakama user)
- No outbound grade sync (AGS or REST)
- No class/assignment model (LTI context/resource-link gives us this for free — we persist it, we don't invent our own roster system)

---

## 3. Canvas LMS Research (verified July 2026)

Primary portal: https://developerdocs.instructure.com/services/canvas (GitBook; the old `canvas.instructure.com/doc/api` pages auto-redirect after **July 1, 2026**).

### 3.1 Auth options

(Verified: https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth.md)

1. **OAuth2 developer keys** — issued **per root account by institution admins** (or globally by Instructure). Authorization-code flow; tokens expire in 1 hour; refresh tokens required. Scope format `url:<verb>|<path>`.
2. **Manual personal access tokens** — any user (including students) can self-generate from Profile → Approved Integrations. **But**: *"Applications in use by multiple users MUST use OAuth to obtain tokens"* — distributing manual-token instructions to users violates the Canvas API Policy.
3. **LTI developer keys** — hold the LTI 1.3 tool config; the tool gets service tokens via OAuth2 `client_credentials` + RS256 JWT client assertion.

### 3.2 Quiz content APIs (pull)

**Classic Quizzes** (verified: `.../resources/quizzes.md`, `.../resources/quiz_questions.md`):

| Action | Endpoint |
|---|---|
| List quizzes | `GET /api/v1/courses/:course_id/quizzes` |
| Get quiz | `GET /api/v1/courses/:course_id/quizzes/:id` |
| List questions **with answers** | `GET /api/v1/courses/:course_id/quizzes/:quiz_id/questions` |
| Create quiz / questions (push content) | `POST` on the same paths |

Question payloads carry `question_type` (12 types), `question_text`, `points_possible`, `answers[]` with `answer_weight` (100 = correct). Reading answers requires **teacher/designer-level permission** — a student token cannot pull the answer key (see §3.6).

**New Quizzes** (verified: `.../resources/new_quizzes.md`, `.../resources/new_quiz_items.md`) — publicly documented, different base path:

| Action | Endpoint |
|---|---|
| List | `GET /api/quiz/v1/courses/:course_id/quizzes` |
| Get / Update / Delete | keyed by **assignment_id**, `PATCH`/`DELETE` |
| Items CRUD | `.../quizzes/:assignment_id/items[/:item_id]` |

Verified limitation: *"Only +QuestionItem+ types can be created"* via the Items API (no stimulus/bank items). **No public API for New Quizzes student attempts** — attempt-level data only via Canvas Data 2 / DAP (`new_quizzes` namespace, live since March 16, 2026).

**Timeline:** New Quizzes **Native Canvas Integration is enforced for all institutions on 2026-08-15** (verified: Instructure enforcement list, updated Jul 3, 2026). No global Classic Quizzes kill date exists; institutions run their own migrations. Plan: support both — Classic APIs near-term, New Quizzes as the strategic target.

### 3.3 Grade push (REST)

(Verified: `.../resources/submissions.md`)

- Teacher/grader token: `PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id` with `submission[posted_grade]` (points/percent/letter/pass-fail). Requires manage-grades permission.
- Bulk: `POST .../submissions/update_grades` (async).
- Student self-submission: `POST .../submissions` (types incl. `online_url`, `basic_lti_launch`) — a student **cannot** set a grade.
- **Preferred: LTI AGS** (below) — no human token needed at all.

### 3.4 LTI 1.3 / Advantage (the seamless path)

(Verified: `.../file.lti_dev_key_config.md`, `.../file.lti_launch_overview.md`, `.../file.content_item.md`, `.../resources/line_items.md`, `.../resources/score.md`, `.../resources/names_and_role.md`)

- **Registration:** LTI Developer Key created by an account admin — manual, pasted JSON, hosted JSON URL, or **Dynamic Registration**. Key JSON: `oidc_initiation_url`, `target_link_uri`, `scopes[]`, `public_jwk[_url]`, `custom_fields` (supports `$Canvas.user.id` etc.), placements with `LtiResourceLinkRequest` / `LtiDeepLinkingRequest`.
- **OIDC launch:** Canvas → our `oidc_initiation_url` (`iss` = `https://canvas.instructure.com` for hosted prod) → we redirect to `https://sso.canvaslms.com/api/lti/authorize_redirect` → Canvas returns signed `id_token` to our `redirect_uri` → we validate against JWKS at `https://sso.canvaslms.com/api/lti/security/jwks`. Cookie-less Safari handled via the LTI Platform Storage postMessage spec (`lti_storage_target`). **Note the new `sso.canvaslms.com` domain — required for new tools.**
- **Deep Linking:** teacher picks a quiz in our tool; returned `ltiResourceLink` may include `lineItem` — verified quote: *"If a returned content item has the `lineItem` property, then it is used to create a new assignment."* One step = graded Canvas assignment bound to our quiz.
- **AGS:** `POST /api/lti/courses/:course_id/line_items/:line_item_id/scores` with scope `https://purl.imsglobal.org/spec/lti-ags/scope/score`. Payload: `userId`, `scoreGiven`, `scoreMaximum`, `timestamp`, `activityProgress`, `gradingProgress` (must be `FullyGraded`/`PendingManual` for the grade to post). Canvas extension claim can attach a submission URL/text. Verified quote: *"External tools can return scores for assignments without the need of students ever accessing the tool."* Result service (read-back): `GET /api/lti/courses/:course_id/line_items/:line_item_id/results[/:id]` — Firecrawl-verified at `.../resources/result.md` (previously UNVERIFIED due to a fetch timeout).
- **NRPS:** `GET /api/lti/courses/:course_id/names_and_roles` (roster + emails subject to tool `privacy_level`).
- **LTI 1.1:** deprecated (*"New tools should be written for the LTI 1.3 spec"*); 1EdTech ended support in 2022; institutions are actively decommissioning it. Do not build on it.

### 3.5 Content export/import formats

(Verified: `.../resources/content_exports.md`, `.../resources/content_migrations.md`)

- **Export via API:** `POST /api/v1/courses/:course_id/content_exports` with `export_type=qti` (*"Export quizzes from a course in the QTI format"*) or `common_cartridge`; selective via `select[quizzes][]`; poll `progress_url`, download `attachment.url`. Canvas classic QTI is **1.2-flavored**; Canvas imports QTI 1.2 and 2.1.
- **Import via API:** `POST /api/v1/courses/:course_id/content_migrations` with `migration_type=qti_converter` (also `common_cartridge_importer`, `moodle_converter`!) — `qti_converter` and `moodle_converter` re-confirmed by the Firecrawl pass on the live docs page. **UNVERIFIED:** `settings[import_quizzes_next]=true` (QTI → New Quizzes via API) — confirmed **absent** from the current docs page in both verification passes; the UI checkbox path is confirmed; verify the API param against the target instance before relying on it.
- The `moodle_converter` migration type means Canvas can ingest Moodle backups — useful one-way arbitrage for content conversion in dev.

### 3.6 Student-token reality check

A student **can** self-generate a personal token and: list own courses, see published quizzes/assignments, take classic quizzes via the Quiz Submission Questions API (`POST /api/v1/quiz_submissions/:quiz_submission_id/questions` with `validation_token`), and make submissions. A student **cannot**: read quiz questions with answer keys, post grades, create developer keys, or use AGS/NRPS. And multi-user manual-token collection violates the API policy. **Conclusion: a purely student-driven Canvas integration is limited to "mirror my assignments/todo list & deep-link me back into Canvas"; real quiz pull/push requires the LTI tool or teacher/admin OAuth.**

### 3.7 Operational constraints

- **Throttling:** cost-based leaky bucket, `X-Request-Cost` / `X-Rate-Limit-Remaining` headers, 429 on breach; per-token quotas; parallel requests incur a pre-flight penalty — keep AGS calls sequential.
- **User-Agent header enforced since 2026-06-20** — API calls without one fail.
- **Free-for-Teacher permanently discontinued** (May 2026). Dev/testing = open-source Canvas in Docker (full Site Admin + developer keys), partner-institution test instance, or the replacement product Instructure says is *"launching this fall"* (feature set UNVERIFIED).

---

## 4. Moodle Research (verified July 2026)

### 4.1 Web services architecture

(Verified: https://moodledev.io/docs/apis/subsystems/external, docs.moodle.org/500/en/Using_web_services, token.php source for 5.1.5)

- REST endpoint: `https://site/webservice/rest/server.php?wstoken=…&wsfunction=…&moodlewsrestformat=json` (+ `/webservice/upload.php` for files).
- Enabling requires admin: enable web services → enable REST protocol → create an external service with an explicit function list → issue tokens (per-token **IP restriction** and **Valid until** expiry supported).
- Two token paths: **admin-created service tokens** (function-scoped — the pattern for our server integration) and **user self-service** via `/login/token.php?username=…&password=…&service=moodle_mobile_app` (requires the mobile service enabled + `moodle/webservice:createtoken`; **fails for SSO/SAML/OIDC users** who have no local password).

### 4.2 Quiz web services (verified against Moodle core `main` source — `mod/quiz/db/services.php`)

All in the official mobile service → callable with a **student's own token**, enforcing the student's own capabilities:

| Function | Purpose | Capability |
|---|---|---|
| `mod_quiz_get_quizzes_by_courses` | List visible quizzes | `mod/quiz:view` |
| `mod_quiz_get_quiz_access_information` | Access rules/state | `mod/quiz:view` |
| `mod_quiz_start_attempt` | Start attempt | `mod/quiz:attempt` |
| `mod_quiz_get_attempt_data` | Attempt page data (rendered HTML) | `mod/quiz:attempt` |
| `mod_quiz_save_attempt` / `process_attempt` | Autosave / submit+finish | `mod/quiz:attempt` |
| `mod_quiz_get_attempt_review` | Post-attempt review | `mod/quiz:reviewmyattempts` |
| `mod_quiz_get_user_best_grade` | Best grade | `mod/quiz:view` |
| `mod_quiz_get_user_quiz_attempts` | Attempt list (replaces deprecated `get_user_attempts`) | `mod/quiz:view` |

**The hard wall (verified):** the complete `core_question_*` external function set (`update_flag`, `get_random_question_summaries`, `move_questions`, `search_shared_banks`) contains **no function that exports question stems + options + correct answers**. Attempt web services return *student-visible rendered HTML only* (*"All the information returned by the WS will be data that the user can see in the web interface"*). Full question export is UI-only (qformat export) or requires a local plugin.

### 4.3 Question import/export formats

(Verified: docs.moodle.org Import/Export questions pages, moodle.org/plugins — fetched live)

- Export formats: **Moodle XML** (recommended; only format carrying images), GIFT, Aiken, XHTML. Import: Moodle XML, GIFT, Aiken, and plugin formats.
- **`qformat_canvas`** (fetched live): imports Canvas classic XML into Moodle. *"Latest release: 12 years"*, 78 sites — effectively abandoned. Treat Canvas→Moodle conversion as something **our pipeline does** (Canvas QTI → our internal model → Moodle XML), not something to delegate to this plugin. Its existence is still a useful signal: Canvas classic quiz XML has long been treated as an interchange source.
- **No core web service imports questions.** Third-party local plugins exist (verified on plugins directory): `local_questions_importer_ws` (Moodle 4.5+, `…_import_xml(courseid, draftitemid)`) and `local_qbankremotemanager` (4.1+, `…_upload_questions` / `…_upload_quiz`). Both are candidates to mirror before the directory freeze, or we ship our own minimal `local_quizverse` plugin later.
- **⚠️ Plugins Directory becomes read-only 2026-07-14** (Moodle Marketplace migration) — mirror any ZIPs now.

### 4.4 Grade push

(Verified against Moodle core `main` `lib/db/services.php` + release notes)

- `core_grades_update_grades` **exists and is not deprecated** (writes a grade item; teacher/manager token).
- `core_grades_get_grades` is **removed** from current core — read grades via `gradereport_user_get_grade_items` (3.2+, mobile service; student can read own) or `mod_quiz_get_user_best_grade`.
- Native-quiz grades are computed from attempts — don't overwrite them with WS pushes; external scores belong in **an LTI line item** (cleanest), a manual grade item, or an assignment.
- **Preferred: LTI AGS.** Verified quote (LTI External tools doc): *"Accept grades from the tool — if this is checked, the connecting site will send back grades to Moodle's gradebook."*

### 4.5 Moodle as LTI 1.3 Platform (the seamless path)

(Verified: moodledev.io release notes 3.7/3.10/4.3, moodle.com LTI Advantage certification announcement, docs.moodle.org LTI pages, live Moodle `.well-known` platform config)

- LTI 1.3 landed in **Moodle 3.7**; Moodle was among the first **LTI Advantage certified** platforms (AGS + Deep Linking + NRPS). **Dynamic Registration since 3.10** — admin pastes our registration URL under *Manage tools* → "Add LTI Advantage" → **Activate**. All currently supported versions (4.5 LTS → 5.2) have full Advantage platform support.
- Verified platform scopes in a live Moodle `.well-known` config: AGS `lineitem`, `lineitem.readonly`, `result.readonly`, `score`; NRPS `contextmembership.readonly`; messages `LtiResourceLink`, `LtiDeepLinkingRequest`.
- Student experience, official quote: *"students can access them without leaving their Moodle course or having to log in to a different system… teachers can also have grades sent back into Moodle."*
- **Friction (verified, Moodle 4.3+):** if Deep Linking is enabled on a tool registration, content selection becomes mandatory when adding the activity; Moodle staff's documented workaround is registering the tool twice (with and without deep linking). Dynamic registration is **site-level admin-only**.

### 4.6 Version landscape 2026

4.5 = current LTS (security support to Oct 2027); 5.2 = current stable; **5.3 LTS due Oct 2026**. Moodle 5.0 brought shared question banks + removed old deprecated external functions; **Moodle 5.1 moved the webroot to `/public`** (integration URLs unchanged, but expect misconfigured-host support tickets). No core WS rate limiting exists (**UNVERIFIED/absent** in docs) — be a polite sequential client.

---

## 5. Architecture Decision

### 5.1 Why LTI-first

| Requirement | LTI 1.3 | Teacher OAuth/API token | Student token |
|---|---|---|---|
| Student clicks link in LMS → lands authenticated | ✅ OIDC launch (both LMSs) | ❌ needs separate login | ❌ needs token copy (violates Canvas policy) |
| Grade appears in LMS automatically | ✅ AGS, no human token | ⚠️ Canvas only, teacher token liability | ❌ impossible |
| Teacher installs per course without IT | ⚠️ needs one admin action per site (dev key / activation) | ⚠️ admin must issue dev key (Canvas) / tokens (Moodle) | ✅ but capability-crippled |
| Pull question content w/ answer keys | ❌ not LTI's job | ✅ Canvas API; Moodle via XML/plugin | ❌ both LMSs block answer keys for students |
| Works identically on Canvas & Moodle | ✅ same spec, same code | ❌ two totally different APIs | ❌ two different, weak paths |

LTI gives us auth + placement + grade-back with **one implementation for both platforms**. Content pull remains per-LMS (Canvas REST/QTI vs Moodle XML/plugin), and a student-token mode survives as a self-serve companion tier, not the core.

### 5.2 Component placement (respecting the Goja constraints)

```
┌──────────── LMS (Canvas / Moodle) ────────────┐
│ Assignment / External-tool activity            │
└──────┬────────────────────────────▲────────────┘
       │ 1. OIDC launch (id_token)  │ 5. AGS score POST (RS256 client assertion)
       ▼                            │
┌──────────────── Web tier (quizverse.world, Node/Next.js) ────────────────┐
│ NEW lti/* routes: /lti/login /lti/launch /lti/jwks /lti/deep-link        │
│ - verifies RS256 id_token against platform JWKS  (Goja CANNOT do this)   │
│ - deep-linking picker UI (teacher chooses a QuizVerse pack)              │
│ - LMS Quiz Player (the "detailed frontend quiz", §6)                     │
└──────┬───────────────────────────────────────────────▲──────────────────┘
       │ 2. service-token RPC: lms_launch_session       │ 4. attempt result
       ▼                                                │
┌──────────────── Nakama (this repo, new src/lms-bridge/ module) ──────────┐
│ - lms_launch_session: map iss+deployment+sub → Nakama user (custom auth) │
│ - lms_link storage: platform registrations, deployments, resource links, │
│   line-item URLs, user mappings                                          │
│ - reuses quizverse pack fetch + quiz_submit_result_v2 grading            │
│ - lms_grade_push: nk.jwtGenerate('RS256') client assertion →             │
│   token endpoint → AGS /scores POST (Goja CAN sign)  + retry queue       │
│ - content importers: canvas_pull (REST/QTI), moodle XML ingest → IPack   │
└───────────────────────────────────────────────────────────────────────────┘
```

Key constraint recap: `nk.jwtGenerate('RS256', key, claims)` exists (flat claims only — sufficient for `iss/sub/aud/iat/exp/jti` client assertions), but there is **no JWT verify** in the Goja runtime, so launch validation lives in the web tier; the web tier then calls Nakama with the established service-token pattern (like `QV_RESEARCH_SERVICE_TOKEN`).

---

## 6. The Detailed Student Quiz Frontend (LMS Quiz Player)

A dedicated, LMS-embeddable quiz experience in the web tier (new surface, e.g. `lms.quizverse.world` or `quizverse.world/lms/*`). Design constraints that differ from our game surfaces: it renders inside an **iframe** (Canvas default; Moodle optional new-window), must survive **cookie-less Safari** (LTI Platform Storage postMessage), and must feel like coursework, not a casino.

### 6.1 Student flow (happy path)

1. **Launch** — student clicks the assignment in Canvas/Moodle. OIDC dance completes invisibly (<1s). We mint a Nakama session via `lms_launch_session` (custom-auth id = hash of `iss|deployment_id|sub`). No signup screen. Ever.
2. **Pre-quiz screen** — quiz title, question count, points possible (from the line item), attempts allowed, due date (from launch claims), "Start quiz" CTA. If the student already attempted: show best score + review entry.
3. **Question player** — one question per screen: stem (rich text + image/audio), options as large tap targets, progress bar `Q i/n`, optional per-question timer, flag-for-review, previous/next nav (configurable linear mode). Autosaves each answer to the attempt record (survives refresh/iframe reload — critical inside LMSs).
4. **Review & submit** — answer grid (answered/flagged/blank), submit confirmation.
5. **Results screen** — score, per-question breakdown with explanations (`IQuestion.explanation`), weak-topic summary (hooks into learner-toolbelt later), and a **grade-sync status chip**: "Synced to Canvas ✓ / Syncing… / Will retry". The grade posts via AGS server-side regardless of whether the student stays on the page.
6. **Return** — "Back to course" deep link (launch `return_url` claim).

### 6.2 Teacher flow

- **Deep-linking picker** (`LtiDeepLinkingRequest`): browse/search QuizVerse packs (or import one from the LMS first, §7), preview questions, set points, return the content item **with a `lineItem`** so the LMS creates the graded assignment in one step.
- **Post-launch teacher view** (role from launch claims): per-student status/scores for that resource link, manual "re-sync grade" button, link to import/export.

### 6.3 Frontend engineering notes

- State machine: `launching → ready → in_attempt → review → submitted → synced|sync_failed`.
- Persist attempt state server-side keyed by `resource_link_id + user`; the iframe can be reloaded at any time.
- Handle third-party-cookie blockage: keep session in launch-scoped token (URL fragment/postMessage storage), not cookies.
- Accessibility: keyboard-navigable options, ARIA live regions for timer, WCAG AA — schools require it.
- Theming: neutral "classroom" theme; hide game-economy chrome (coins/streaks) in LMS context by default (configurable — rewards can still accrue silently to a linked QuizVerse account).
- Question-type coverage v1: multiple choice, true/false, multiple answers (maps to `IQuestion` with a small extension for multi-select); v2: matching, numerical, short answer (needs `IQuestion` schema extension — see §7.3).

---

## 7. Content Pull/Push Pipelines

### 7.1 Canvas pull

- **Tier B1 (API, per-course teacher/admin OAuth or admin-issued key):** `GET /quizzes` → `GET /quizzes/:id/questions` (answers included) → normalize to `IPack` → `quizverse_packs`. Works for Classic Quizzes today.
- **Tier B2 (file-based, works for any Canvas):** teacher exports QTI (UI or our tool calls `POST /content_exports?export_type=qti`), uploads/points us at the `.zip`; our **QTI 1.2 parser** converts `<item>`/`<response_lid>`/`<respcondition>` to `IQuestion`. This same parser handles Common Cartridge quiz payloads.
- **New Quizzes:** read shell via `/api/quiz/v1/...`; items API is create-oriented and attempt data is DAP-only — rely on QTI export for content until Instructure expands the API (watch post-2026-08-15 native integration).

### 7.2 Moodle pull

- **Tier B2 (file-based, default):** teacher exports **Moodle XML** from the question bank/quiz UI and uploads it to us; we parse `<question type="multichoice">` etc. (base64-embedded images → S3 via existing upload path).
- **Tier B3 (plugin, premium/managed schools):** ship/mirror a `local_` plugin exposing export/import functions; admin installs it; then pull is fully API-driven.
- **Metadata always available via WS token:** `core_course_get_contents`, `mod_quiz_get_quizzes_by_courses` for listing/linking even without content export.

### 7.3 Push content into the LMS (reverse direction)

- **Canvas:** generate QTI 1.2 from `IPack` → `POST /content_migrations (qti_converter)`, or create natively via Classic quiz/question POSTs; New Quizzes via Items API (`QuestionItem` only).
- **Moodle:** generate **Moodle XML** from `IPack` → teacher imports via UI (core has no WS import) or via the local plugin (B3).
- This also replaces the abandoned `qformat_canvas` use case: we become the Canvas↔Moodle quiz bridge (Canvas QTI in → Moodle XML out, and vice versa).

### 7.4 Internal canonical model

Extend `IQuestion` minimally: `question_type` (default `multiple_choice`), `correct_indices?: number[]` (multi-answer), `points?: number`, `feedback_correct?/feedback_incorrect?`, and per-pack `lms_source` provenance `{platform: 'canvas'|'moodle', course_id, quiz_id, exported_at, format}`. Grading stays server-side in `quiz_submit_result_v2` semantics.

---

## 8. Backend Plan (Nakama, this repo)

New module `data/modules/src/lms-bridge/` (ES5-safe namespace, string-literal `registerRpc` ids, registered from `main.ts` — per nakama-rpc/postbuild rules).

### 8.1 Storage collections (all `permissionRead/Write = 0`, SYSTEM-owned unless noted)

| Collection | Key | Contents |
|---|---|---|
| `lms_platforms` | `<platform_id>` | issuer, client_id, auth/token/JWKS URLs, deployment ids, kind: canvas\|moodle |
| `lms_resource_links` | `<platform>:<deployment>:<resource_link_id>` | pack_id, line_item URL, scoreMaximum, course context |
| `lms_user_links` | `<platform>:<sub>` | nakama user_id, roles, name/email (per privacy level) |
| `lms_grade_queue` | `grade_<unix>_<rand>` | pending AGS posts (retry with backoff; dead-letter after N) |
| `lms_import_jobs` | `imp_<unix>_<rand>` | pull-pipeline job status/provenance |

### 8.2 RPCs (service-token gated from the web tier; admin-gated for ops)

| RPC | Purpose |
|---|---|
| `lms_platform_upsert` / `lms_platform_list` | Admin: register a Canvas/Moodle platform (from dynamic registration or manual config) |
| `lms_launch_session` | Web tier posts validated launch claims → find-or-create Nakama user (`authenticateCustom` on hashed `iss|deployment|sub`), persist resource-link + line-item, return session + pack binding |
| `lms_deeplink_bind` | Bind chosen pack → resource link (+ scoreMaximum) at deep-link time |
| `lms_attempt_complete` | Wraps `quiz_submit_result_v2` grading; writes grade-queue row `{scoreGiven, scoreMaximum, userId(LTI sub), lineItemUrl}` |
| `lms_grade_push` | Worker (invoked by scheduler/web cron): `nk.jwtGenerate('RS256', LTI_TOOL_PRIVATE_KEY, {iss,sub,aud,iat,exp,jti})` → `client_credentials` at platform token URL → `POST <lineItem>/scores`; sequential, honors 429/`X-Rate-Limit-Remaining` |
| `lms_import_canvas_course` | Canvas REST pull → `IPack` → `quizverse_packs` |
| `lms_import_qti` / `lms_import_moodlexml` | File-based import (web tier pre-parses XML → JSON; Goja stays out of XML parsing) |
| `lms_export_pack` | `IPack` → QTI 1.2 / Moodle XML payload for download or Canvas content-migration POST |
| `lms_link_status` | Student/teacher UI: sync status per resource link |

### 8.3 New env vars (must be added to `RUNTIME_ENV_KEYS` in docker-compose entrypoint — rule #6)

`LMS_BRIDGE_SERVICE_TOKEN`, `LTI_TOOL_PRIVATE_KEY` (RS256 PEM), `LTI_TOOL_KID`, `CANVAS_DEFAULT_BASE_URL` (dev), `MOODLE_DEFAULT_BASE_URL` (dev). The public JWK is served by the web tier at `/lti/jwks`.

### 8.4 Build discipline

Standard zero-defect loop applies: edit `src/lms-bridge/*.ts` → `npm run build` → `rg "registerRpc.*lms_" data/modules/index.js` → `docker compose restart nakama` → watch logs → test via Console API Explorer. `index.js` is never hand-edited.

---

## 9. Web-Tier Plan (quizverse.world repo — outside this repo)

1. **LTI tool endpoints:** `/lti/login` (OIDC init, per-platform issuer routing), `/lti/launch` (state+nonce check, JWKS verify — cache platform keys, handle `sso.canvaslms.com` for Canvas), `/lti/jwks` (our public keys), `/lti/deep-link` (picker UI + signed `DeepLinkingResponse` JWT). Use a maintained LTI library (e.g. ltijs or 1EdTech reference) rather than hand-rolling.
2. **LMS Quiz Player** per §6 (iframe-safe, cookie-less-safe).
3. **Registration UX:** Dynamic Registration endpoint (Moodle admin pastes one URL; Canvas admins use JSON-URL config), plus a printable manual-config sheet per LMS.
4. **File import UI:** upload QTI zip / Moodle XML → parse to JSON server-side (Node XML libs) → call `lms_import_*` RPCs.

---

## 10. Phased Delivery Plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **P0 — Dev environments (1 wk)** | Local open-source Canvas (Docker) — FFT is gone; local Moodle 4.5 LTS + 5.2 (Docker, Bitnami/moodlehq images); mirror Moodle plugin ZIPs **before 2026-07-14**; generate LTI keypair | Both LMSs running locally; admin access; keypair in secrets |
| **P1 — LTI launch MVP (2–3 wks)** | Web-tier OIDC/launch/JWKS; `lms_platform_*`, `lms_launch_session`; minimal player rendering an existing `quizverse_packs` pack; manual tool registration on both local LMSs. **Owns charter items LTI-01…LTI-09, LTI-15, LTI-16 (§13.1)** incl. negative-path (known-bad payload) launch tests | Student clicks activity in Canvas AND Moodle → plays a pack with zero login; all P1 charter items pass positive + negative tests |
| **P2 — Grade-back (1–2 wks)** | `lms_attempt_complete` + `lms_grade_queue` + `lms_grade_push` (RS256 client-credentials + AGS scores, retries, 429 handling, sequential posting); results-screen sync chip. **Owns charter items LTI-10…LTI-12 (§13.1)**: JWT client assertion, strictly-increasing score timestamps, `FullyGraded` semantics, minimal scopes | Submitted attempt → grade visible in Canvas & Moodle gradebooks with no human action |
| **P3 — Deep Linking + teacher UX (2 wks)** | Picker UI, `DeepLinkingResponse` with `lineItem`, `lms_deeplink_bind`; Moodle double-registration caveat documented; teacher status view (NRPS optional). **Owns charter items LTI-13, LTI-14 (§13.1)**: signed DL response JWT, NRPS privacy minimization | Teacher creates a graded LMS assignment bound to a chosen QuizVerse pack in one flow |
| **P4 — Content pull (2–3 wks)** | QTI 1.2 parser + Moodle XML parser (web tier) + `lms_import_*` RPCs; Canvas REST course pull (teacher OAuth); provenance on packs; **fidelity diff report per §13.2 (mandatory)** | Canvas classic quiz and Moodle quiz each round-trip into a playable pack with images; every import produces a teacher-visible fidelity report |
| **P5 — Content push + bridge (2 wks)** | `lms_export_pack` → QTI/Moodle XML; Canvas `content_migrations` push; "Canvas ↔ Moodle converter" as a standalone marketing surface | Pack exported and imported into both LMSs; conversion works both directions |
| **P6 — Student self-serve tier (2 wks)** | Moodle mobile-token connect (list quizzes, best grades, deep links, native-attempt driving via `mod_quiz_*`); Canvas student-token mirror (todo list + deep links only — API-policy compliant via OAuth, not manual tokens) | Student without an installed tool still gets a useful connected dashboard |
| **P7 — Hardening & certification (ongoing)** | **1EdTech membership + LTI Advantage Complete certification on build.1edtech.org; TrustEd Apps vetting; QTI cert go/no-go (§13.3)**; key-rotation runbook (LTI-09, §13.4.7); Canvas User-Agent + throttling compliance; New Quizzes native-integration watch (post 2026-08-15); privacy review (FERPA/COPPA — reuse research.ts consent patterns; NRPS data minimization) | 1EdTech membership active; **LTI Advantage Complete certification achieved**; TrustEd Apps vetting submitted; QTI certification decision documented; security review passed |

Rough total to full pull/push GA: **10–13 weeks** of focused work across backend + web tier.

---

## 11. Risks & Gotchas Register

1. **No JWT verification in Goja** — launch validation must stay in the web tier; never shortcut this into Nakama.
2. **Canvas dev-key friction:** every institution's admin must enable our key (or Instructure issues a global inherited key — pursue via partner program). Bake "email your Canvas admin" into onboarding.
3. **No free hosted Canvas testbed** (FFT discontinued); budget for maintaining local OSS Canvas and watch the fall-2026 replacement product.
4. **New Quizzes churn:** native integration enforced 2026-08-15; items API is create-only `QuestionItem`; no attempts API (DAP only); `settings[import_quizzes_next]` UNVERIFIED. Keep Classic-first, re-verify quarterly.
5. **Moodle question export wall:** no core WS exposes answer keys — the file-based XML flow must be first-class UX, not a fallback afterthought.
6. **Moodle plugins directory freeze (2026-07-14):** mirror `qformat_canvas`, `local_questions_importer_ws`, `local_qbankremotemanager` ZIPs immediately; expect future distribution via Moodle Marketplace.
7. **Moodle deep-linking quirk (4.3+):** deep-linking-enabled tools force content selection — plan the documented double-registration workaround.
8. **`/login/token.php` breaks on SSO schools** — student self-serve tier degrades there; LTI path is unaffected (by design).
9. **QTI fidelity loss:** Canvas QTI 1.2 quirks (question banks with random selection are not exported); scope v1 to the question types in §6.3 and validate imports with a diff report shown to the teacher.
10. **AGS discipline:** scores post only with `gradingProgress=FullyGraded|PendingManual`; stale timestamps rejected (400); non-enrolled user → 422; course concluded → 422; keep posts sequential per token (Canvas pre-flight penalty).
11. **Canvas User-Agent enforcement (since 2026-06-20)** — set a stable UA string in `HttpClient`.
12. **Privacy/compliance:** LTI gives us names/emails per privacy level — minimize, encrypt at rest, honor FERPA; reuse the COPPA/parental-consent gating already built in `research.ts` for under-13 contexts.
13. **Goja ES5 + module rules:** no XML parsing in Nakama (web tier pre-parses), no global state, string-literal RPC ids, env keys added to `RUNTIME_ENV_KEYS` — all covered in §8.

---

## 12. Source & Verification Log

**Method:** live fetches during this session (2026-07-12), plus a second-pass Firecrawl re-verification (§12.1).

### 12.1 Firecrawl re-verification pass (2026-07-12)

Key: SSM `/codebuild/AI` → `FIRECRAWL_API_KEY` (also present in `/codebuild/content-factory`). Endpoint: `POST https://api.firecrawl.dev/v2/scrape`. Ten load-bearing sources re-scraped and phrase-checked:

| # | Claim | Source | Result |
|---|---|---|---|
| 1 | AGS Score endpoint + `gradingProgress` semantics | developerdocs…/resources/score.md | ✅ confirmed |
| 2 | AGS **Result** endpoint path | developerdocs…/resources/result.md | ✅ confirmed `GET …/line_items/:line_item_id/results[/:id]` — **upgraded from UNVERIFIED** |
| 3 | Content export `export_type=qti` | developerdocs…/resources/content_exports.md | ✅ confirmed |
| 4 | `qti_converter` / `moodle_converter` migration types; `import_quizzes_next` absent | developerdocs…/resources/content_migrations.md | ✅ types confirmed; `import_quizzes_next` confirmed absent (stays UNVERIFIED as an API param) |
| 5 | New Quizzes native integration enforced 2026-08-15; User-Agent enforcement | community.instructure.com KB 664261 | ✅ confirmed |
| 6 | Free-for-Teacher permanently discontinued | instructure.com/incident_update | ✅ confirmed |
| 7 | Moodle LTI grade-back quote | docs.moodle.org/500/en/LTI_External_tools | ⚠️ **blocked by captcha** for the scraper — claim rests on the first-pass search-index copy of the official page |
| 8 | Moodle REST endpoint `/webservice/rest/server.php` + `wstoken` + `/webservice/upload.php` | moodledev.io plugins-directory API page | ✅ confirmed (moodledev.io/docs page scraped clean but states the endpoint elsewhere; confirmed on the plugincontribution/pluginsdirectory/api page) |
| 9 | `mod_quiz_start_attempt` / `process_attempt` / `get_user_quiz_attempts` in core | raw.githubusercontent.com moodle/moodle main `mod/quiz/db/services.php` | ✅ confirmed (full function list re-extracted) |
| 10 | Plugins directory read-only 2026-07-14; `qformat_canvas` last release 12 years | moodle.org/plugins/qformat_canvas | ✅ confirmed |

Net effect: one item upgraded from UNVERIFIED (AGS Result path), one item confirmed-absent (`import_quizzes_next`), one source unreachable to scrapers (docs.moodle.org captcha) with no change to its claim.

**User-provided links, all fetched:**
- https://www.wooclap.com/en/blog/canvas-vs-moodle/ — market context; confirms LTI is the integration lingua franca for third-party tools on both platforms (Wooclap itself integrates via LTI + a Moodle plugin wrapper).
- https://moodle.org/plugins/qformat_canvas — fetched live; 12-year-old Canvas-XML→Moodle importer; also carries the Plugins-Directory read-only banner (2026-07-14).
- https://developerdocs.instructure.com/services/canvas — fetched (initial timeout, retried successfully); portal structure verified via its llms.txt/sitemap.

**Canvas (all fetched live):** OAuth (`oauth2/file.oauth.md`, `file.oauth_endpoints.md`, `file.developer_keys.md`), Quizzes/Quiz Questions/New Quizzes/New Quiz Items/Submissions/Line Items/Score/Names-and-Role resources pages, LTI dev-key config + launch overview + content_item + assignment_tools pages, Content Exports/Migrations, Throttling, Instructure enforcement list (Jul 3 2026), instructure.com/incident_update (FFT discontinuation).

**Moodle (fetched live or via search-index copies of official pages, noted in-line):** moodledev.io external-services + security pages, releases index + 3.7/3.10/4.3/5.0/5.1 notes, docs.moodle.org Using_web_services / Import_questions / Export_questions / Moodle_XML / LTI External tools / LTI Moodle-to-Moodle / Publish_as_LTI_tool / Moodle_app_FAQ, Moodle core `main` source (`mod/quiz/db/services.php`, `lib/db/services.php`, `login/token.php`), moodle.org plugin pages, moodle.com LTI Advantage certification announcement.

**Explicitly UNVERIFIED (do not build on without instance-level confirmation):**
- Canvas `settings[import_quizzes_next]` content-migration param (confirmed absent from current docs in both passes)
- Any global Instructure LTI 1.1 shutdown date (only institution-level dates found)
- Student-token access to Canvas `/quizzes/:id/questions` (docs silent; assume no)
- Moodle `enablemobilewebservice` default-on for fresh 2026 installs; `tool_mobile/launch.php` as a supported third-party SSO-token pattern
- Feature set of the fall-2026 Canvas Free-for-Teacher replacement
- Whether Moodle MDL-84036 is the exact issue that removed `core_grades_get_grades` (removal itself verified by absence from source)

---

## 13. Standards Compliance Charter (LTI 1.3 / LTI Advantage + QTI)

**Added in v1.2.0 (2026-07-12).** This charter makes our standards obligations explicit, testable, and phase-owned. Every requirement below was verified against the live 1EdTech (formerly IMS Global) specification pages on 2026-07-12:

| Spec | URL fetched | Status |
|---|---|---|
| LTI Core 1.3 (Final) | https://www.imsglobal.org/spec/lti/v1p3/ | ✅ fetched live |
| 1EdTech Security Framework 1.0 (Final) | https://www.imsglobal.org/spec/security/v1p0/ | ✅ fetched live |
| Assignment & Grade Services 2.0 (Final) | https://www.imsglobal.org/spec/lti-ags/v2p0/ | ✅ fetched live |
| Deep Linking 2.0 (Final) | https://www.imsglobal.org/spec/lti-dl/v2p0/ | ✅ fetched live |
| Names & Role Provisioning Services 2.0 (Final) | https://www.imsglobal.org/spec/lti-nrps/v2p0/ | ✅ fetched live |
| LTI OIDC Login with Client-Side postMessages (Platform Storage flow) | https://www.imsglobal.org/spec/lti-cs-oidc/v0p1 | ✅ fetched live |
| LTI Advantage Conformance Certification Guide | https://www.imsglobal.org/spec/lti/v1p3/cert/ | ✅ fetched live |
| 1EdTech LTI standard hub (cert suite links) | https://www.1edtech.org/standards/lti | ✅ fetched live |
| QTI 3.0 Best Practices & Implementation Guide | https://www.imsglobal.org/spec/qti/v3p0/impl | ✅ fetched live |
| 1EdTech QTI standard hub (versions + certification) | https://www.1edtech.org/standards/qti | ✅ fetched live |
| TrustEd Apps Program | https://www.1edtech.org/program/trustedapps | ✅ fetched live |

Note: `https://www.imsglobal.org/spec/qtiv3p0/` returns **404** — the canonical public QTI 3.0 pages are the impl-guide URL and the 1EdTech QTI hub above; the full QTI 3.0 information-model page appears to be member-gated (**UNVERIFIED** whether a public canonical spec page exists at another URL).

### 13.1 LTI 1.3 / LTI Advantage conformance checklist

Legend for "Lives in": **WEB** = quizverse.world web tier (§9 — the LTI tool endpoints; Goja cannot verify RS256, per §5.2), **NK** = Nakama `lms-bridge` module (§8). Phase = owning phase in §10.

| ID | Requirement (normative language from the spec) | Spec § | Lives in | Phase |
|---|---|---|---|---|
| LTI-01 | **OIDC third-party-initiated login**: implement the login initiation endpoint; auth request MUST use `scope=openid`, `response_type=id_token`, `response_mode=form_post`, `prompt=none`; `login_hint`/`lti_message_hint` passed back unaltered | SEC §5.1.1; LTI §4.1 | WEB `/lti/login` | P1 |
| LTI-02 | **state binding (CSRF)**: "The tool sets the CSRF token and binds it to a `state` parameter"; verify returned `state` matches the value attached to the browser session before honoring the launch | SEC §5.1.1, §5.1.3, §7.3.1 | WEB `/lti/launch` | P1 |
| LTI-03 | **nonce validation**: `nonce` REQUIRED in the auth request; "The ID Token MUST contain a `nonce` Claim. The Tool SHOULD verify that it has not yet received this nonce value (within a Tool-defined time window)" — we implement a replay cache (nonce store, TTL ≥ token lifetime) | SEC §5.1.1, §5.1.3 | WEB (nonce cache; may persist via NK storage) | P1 |
| LTI-04 | **id_token signature verification against platform JWKS**: fetch platform Key Set URL, select key by `kid`, verify signature; "Where systems use RSA Keys, they MUST use SHA-256 (RS256) as a minimum"; cache keys, re-fetch on unknown `kid` (platform rotation, SEC §6.4) | SEC §5.1.3, §5.4, §6.1–6.4 | WEB `/lti/launch` (Goja **cannot** verify — §5.2) | P1 |
| LTI-05 | **Exact security claim validation**: `iss` matches registered platform; `aud` contains our `client_id`; if multiple audiences, verify `azp` present and equal to our `client_id`; reject expired `exp`; bound `iat` window; `sub` ≤ 255 ASCII chars | SEC §5.1.3 | WEB, against `lms_platforms` registry (NK §8.1) | P1 |
| LTI-06 | **LTI message claim validation**: `message_type` = `LtiResourceLinkRequest` (or `LtiDeepLinkingRequest`); `version` = `"1.3.0"`; `deployment_id` present, ≤255 chars, and matched against the registered deployments for the issuer; `target_link_uri` MUST equal the value from the login initiation and the tool "should rely on this claim rather than the initial `target_link_uri` to do the final redirection, since the login initiation request is unsigned"; `resource_link.id` required | LTI §5.3.1–5.3.5 | WEB validate → NK `lms_launch_session` persists | P1 |
| LTI-07 | **Forward compatibility**: "receivers of messages MUST ignore any claims in messages they do not understand" — never fail a launch on unknown claims | LTI §4.3 | WEB | P1 |
| LTI-08 | **HTTPS everywhere**: "LTI v1.3 requires the use of HTTPS (using TLS) for both messages and services… implementers MUST use HTTPS for all URLs to resources included in messages and services" | LTI §3.5 | WEB + NK outbound (`nk.httpRequest` targets) | P1 |
| LTI-09 | **Tool JWKS publication + key rotation**: expose our public keys as a JWK Set at a stable URL; rotation MUST add the new key under a new `kid` and SHOULD preserve the previous public key for overlap; per-integration key pairs recommended ("A system SHOULD NOT use a single key pair… for more than one system") | SEC §6.2–6.4, §7.2 | WEB `/lti/jwks` serves; private key held as NK env `LTI_TOOL_PRIVATE_KEY` + `LTI_TOOL_KID` (§8.3) | P1 build; rotation cadence P7 |
| LTI-10 | **Service auth — OAuth2 `client_credentials` + JWT client assertion**: token request with `grant_type=client_credentials`, `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`, RS256-signed assertion (`iss`=`sub`=client_id, `aud`=token URL, `iat/exp/jti`); request minimal scopes only | SEC §4.1.1 | NK `lms_grade_push` via `nk.jwtGenerate('RS256', …)` (§8.2 — Goja **can** sign) | P2 |
| LTI-11 | **AGS score publish semantics**: `userId` MUST be present; `timestamp` MUST be present, ISO 8601 sub-second with TZ, and **strictly increasing** per (line item, user) — "The platform MUST NOT update a result if the last timestamp on record is later than the incoming score update"; `activityProgress` and `gradingProgress` MUST use the spec vocabularies; final grades sent with `gradingProgress=FullyGraded` ("A tool platform MAY ignore scores that are not FullyGraded") | AGS §3.4, §4.7 | NK `lms_attempt_complete` + `lms_grade_queue` + `lms_grade_push` (§8.1–8.2) | P2 |
| LTI-12 | **AGS scope minimization**: request only `…/scope/score` for grade-back; add `…/scope/lineitem` only where deep-linking-created line items require management; honor per-message `lineitem`/`lineitems` endpoint claims rather than assuming stable URLs | AGS §3.1–3.2 | NK stores per-resource-link line-item URL (§8.1); WEB requests scopes at registration | P2 (score) / P3 (lineitem) |
| LTI-13 | **Deep Linking response JWT signing**: "senders of the deep linking messages MUST wrap the payload in a JSON Web Token"; response is `message_type=LtiDeepLinkingResponse` returned as an auto-submitted form POST with the `JWT` parameter to the platform's `deep_link_return_url`; include `lineItem` on returned `ltiResourceLink` items to create the graded assignment (§3.4 Canvas behavior) | DL §3, §4.5; SEC §5.2 | WEB `/lti/deep-link` signs with our private key; NK `lms_deeplink_bind` persists | P3 |
| LTI-14 | **NRPS privacy minimization**: minimum member data is `user_id` + `roles`; "a Tool should never rely on additional member attributes to be present" — we request `contextmembership.readonly` only for the teacher status view, never bulk-store names/emails beyond the platform's `privacy_level`, and degrade gracefully when PII is withheld | NRPS §2.2, §3.6.1.2 | WEB teacher view; NK `lms_user_links` stores only per-privacy-level fields (§8.1) | P3 (optional service) |
| LTI-15 | **LTI Platform Storage for cookie-less browsers**: when `lti_storage_target` is present on the login initiation, store `state`/`nonce` via `lti.put_data` postMessage to the platform frame and retrieve via `lti.get_data` at launch; validate `message_id` and that the event `origin` equals the OIDC auth URI origin | LTI-CS-OIDC v0p1 §2–3 | WEB player shell (§6.3 cookie-less handling; Canvas `lti_storage_target` §3.4) | P1 |
| LTI-16 | **Anonymous launch handling**: absence of `sub` = anonymous launch; must not error — degrade to ungraded preview mode (no AGS post possible) | LTI §5.3.6.1 | WEB + NK `lms_launch_session` | P1 |

**Certification-driven extras** (from the Conformance Certification Guide, Tool testing §6): the suite fires **known-bad payloads** (wrong signature, missing claims, stale `exp`, wrong `aud`…) that our launch endpoint must *reject*, plus valid teacher/student launches with and without PII that must *succeed*. Our P1 test harness must therefore include negative-path launch tests from day one, not just happy paths.

### 13.2 QTI conformance strategy

**Context (verified):** QTI 3.0 is the current 1EdTech spec — "QTI 3.0 enables assessment materials to be exchanged digitally among a wide variety of products" and "may require use of related standards, including the 1EdTech Content Packaging 1.0 specification" (QTI 3.0 BPIG). Canvas classic exports **QTI 1.2-flavored** packages and imports QTI 1.2 **and 2.1** (§3.5, verified on the Canvas content-migrations docs). Moodle's native interchange is Moodle XML, not QTI (§4.3).

**Versions we read (import):**

| Format | Priority | Why |
|---|---|---|
| QTI 1.2 (Canvas-flavored) | **P4 — must have** | What Canvas classic actually exports (§3.5, §7.1) |
| QTI 2.1 | P4 stretch / P5 | Canvas accepts it on import; other tools emit it; parser shares the item model |
| QTI 3.0 | Post-GA (watch item) | Current 1EdTech spec; required for QTI *certification*; adoption in Canvas/Moodle exports is still absent — do not build reads before a real producer exists |
| Moodle XML | **P4 — must have** | Moodle's only full-fidelity format (§4.3) — kept in the same canonical pipeline |

**Versions we write (export):** QTI 1.2 (targets Canvas `qti_converter` import, §7.3) and Moodle XML. QTI 3.0 authoring/export becomes a P7+ certification target, not a GA blocker.

**Packaging:** exports ship as an IMS Content Packaging zip (`imsmanifest.xml` + item/assessment XML + media files), which is also the payload format inside Common Cartridge — our QTI parser must resolve items via the manifest, never by filename convention. Canvas whole-course exports arrive as Common Cartridge (`export_type=common_cartridge`, §3.5); the same manifest-first parser handles both.

**Metadata preservation requirements (round-trip contract):** every import/export MUST preserve, when the source provides them:

| Field | QTI carrier | Moodle XML carrier |
|---|---|---|
| Quiz/assessment title | `<assessment title>` | `<quiz>` category / activity name |
| Question title + stem (rich text) | `<item title>` / `<presentation><material><mattext>` (1.2); `<qti-assessment-item title>` / `<qti-item-body>` (3.0) | `<question><name>` / `<questiontext format="html">` |
| Points | `<qtimetadatafield>` weight / outcome `MAXSCORE` | `<defaultgrade>` |
| Question type | `question_type` metadata (Canvas) / interaction element | `type=` attribute (`multichoice`, `truefalse`, …) |
| Correct answer(s) | `<respcondition>`/`<setvar>` (1.2); `<qti-response-declaration><qti-correct-response>` (3.0) | `<answer fraction="100">` |
| Feedback (correct/incorrect/per-answer) | `<itemfeedback>` | `<feedback>` per `<answer>` + `<correctfeedback>`/`<incorrectfeedback>` |
| Images/media | package resources referenced from manifest | base64 `<file>` elements inline |
| Shuffle/option order | `shuffle` attribute | `<shuffleanswers>` |

**Canonical model mapping (extends the §7.4 `IQuestion` extension):**

| `IQuestion` field | QTI 1.2 element | QTI 3.0 element | Moodle XML element |
|---|---|---|---|
| `question_id` | `<item ident>` | `<qti-assessment-item identifier>` | `<question>` name/id + provenance |
| `text` | `<presentation><material><mattext texttype="text/html">` | `<qti-item-body>` | `<questiontext><text>` (CDATA html) |
| `options[]` | `<response_lid><render_choice><response_label>` | `<qti-choice-interaction><qti-simple-choice>` | `<answer>` list |
| `correct_index` / `correct_indices[]` | `<respcondition>` → `<varequal>` idents | `<qti-correct-response><qti-value>` | `<answer fraction="100">` (fraction split for multi) |
| `question_type` | Canvas `question_type` metadata field | interaction element type | `type=` attribute |
| `points` | `MAXSCORE` outcome / Canvas points metadata | `qti-outcome-declaration` max | `<defaultgrade>` |
| `feedback_correct` / `feedback_incorrect` | `<itemfeedback ident>` | `<qti-modal-feedback>` | `<correctfeedback>` / `<incorrectfeedback>` |
| `image_url` | manifest resource + `<matimage>` | `<img>` in item body + package resource | base64 `<file>` → uploaded to S3 (§7.2) |
| `explanation` | general `<itemfeedback>` | `qti-modal-feedback` (shown on review) | `<generalfeedback>` |

XML parsing/generation happens **in the web tier only** (Node XML libs); Nakama receives pre-parsed JSON via `lms_import_*` and returns JSON that the web tier serializes for `lms_export_pack` (§8.2 — Goja stays out of XML, rule recap §11.13).

**Fidelity/diff-report requirement (hard requirement, not nice-to-have):** every import MUST produce a machine-readable fidelity report shown to the teacher before the pack goes live: per-question status (`imported | imported_with_loss | skipped`), the specific fields dropped (e.g. unsupported question type, lost per-answer feedback, stripped media), and totals. This is the §11.9 mitigation made contractual: no silent lossy imports, ever. The report is stored on the `lms_import_jobs` row (§8.1) for audit.

### 13.3 1EdTech certification path

**LTI Advantage certification (verified in the Conformance Certification Guide + 1EdTech LTI hub):**

- **Membership is a prerequisite:** "Conformance Certification is an IMS member benefit. You MUST … be a member of IMS Global as a Learning Tools/Content Alliance, Affiliate, or Contributing Member in order to test your product." → Budget a 1EdTech membership (Alliance tier minimum) before P7 testing can even start.
- **What the suite tests (Tools):** LTI Core launches — including rejection of *known-bad payloads* — valid teacher/student launches with and without PII, plus per-service tests for Deep Linking, NRPS, and AGS; certification is submitted per product from the suite.
- **Tiers:** completing Core + 1–2 services = **LTI Advantage Certified** (tools only); Core + all three services = **LTI Advantage Complete**. **Our target: LTI Advantage Complete** (we implement AGS, Deep Linking, and NRPS anyway).
- **Tooling:** legacy suite at `ltiadvantagevalidator.imsglobal.org`; new **Diagnostic & Certification Suite at `build.1edtech.org`** (verified on the 1EdTech LTI hub) — use the new suite for P7.
- **TrustEd Apps (verified):** 1EdTech's app-vetting program (pledge → product vetting/certification → listing in the TrustEd Apps Management Suite used by districts for procurement). LTI Advantage certification is the technical half; completing the TrustEd Apps privacy vetting (+ the security/accessibility/AI self-assessment rubrics) is what gets us into district procurement pipelines. Fold the DPSA (Data Privacy & Security Agreement) template into our school onboarding paperwork.
- **QTI certification (verified on the 1EdTech QTI hub):** application certifications exist for **Authoring / Import / Export / Import-and-Export / Delivery** (yearly renewal) plus one-time content-package certifications. QTI certification tests against **QTI 3.0** — so this is a post-GA goal gated on our QTI 3.0 read/write work (§13.2), pursued after LTI Advantage Complete. **UNVERIFIED:** exact certification fees and the current QTI cert checklist contents (member-gated pages).

**Certification exit criteria (now bound to P7 in §10):** (1) 1EdTech membership active; (2) LTI Advantage **Complete** certification achieved on the build.1edtech.org suite; (3) TrustEd Apps vetting submitted; (4) QTI Import/Export certification assessed and scheduled (go/no-go documented) once QTI 3.0 support lands.

### 13.4 Non-negotiables

1. **Never LTI 1.1** — deprecated, 1EdTech support ended 2022 (§3.4). No Basic Outcomes, no OAuth 1.0a signing, ever.
2. **Never unsigned or symmetrically-signed LTI JWTs** — RS256 minimum for id_tokens, Deep Linking responses, and client assertions (SEC §5.4/§7.3.2); never `alg=none`, never HS* for LTI messages.
3. **Never skip state/nonce validation** — including in the cookie-less postMessage flow; a launch that can't prove state+nonce is a failed launch.
4. **Never trust the login-initiation `target_link_uri`** — only the signed id_token claim (LTI §5.3.4).
5. **Never store platform personal data beyond the granted `privacy_level`** — NRPS minimum is `user_id`+`roles`; names/emails only when granted, encrypted at rest, purged on unlink (§11.12).
6. **HTTPS everywhere** — every message, service call, and embedded resource URL (LTI §3.5).
7. **Key rotation cadence:** tool keypair rotated at least **annually** and immediately on suspicion of compromise; rotation always via new `kid` with the old public key retained in the JWKS for a ≥30-day overlap (SEC §6.4); private key lives only in secrets (`LTI_TOOL_PRIVATE_KEY`), never in the repo or client.
8. **Grades post only via AGS with truthful semantics** — `FullyGraded` only when grading is actually final; timestamps strictly increasing; no grade writes through scraped teacher credentials.
9. **No silent lossy imports** — every QTI/Moodle XML import ships with its fidelity diff report (§13.2).
10. **Deployment allowlist** — every launch validated against registered `iss` + `deployment_id` pairs; unknown deployments are rejected, not auto-provisioned (except through the explicit Dynamic Registration flow).

---

## 14. Public Marketing Site (deployed 2026-07-12)

A static "QuizVerse LMS Bridge" landing page pitching the Canvas/Moodle pull-push integration is live:

| Item | Value |
|---|---|
| **URL** | https://lms.quizverse.world (HTTPS, HTTP redirects) |
| Source | `web/lms-landing/index.html` (this repo; single self-contained file, zero deps) |
| S3 bucket | `lms.quizverse.world` (us-east-1, static website hosting, public-read policy, index+error → `index.html`) |
| S3 website endpoint | `http://lms.quizverse.world.s3-website-us-east-1.amazonaws.com` (origin only) |
| CloudFront | `E16SMQBSK7USUR` → `d17vfwoicfhx91.cloudfront.net`, alias `lms.quizverse.world`, redirect-to-https, compress, CachingOptimized policy |
| TLS cert | Existing ACM `quizverse.world` cert `c2b20042-…7814a440` (same one used by `tutor.quizverse.world`) |
| DNS | Route53 zone `quizverse.world` (`Z07562523B3TD6EXI0N6A`): `lms.quizverse.world` A-alias → CloudFront |
| Deploy command | `aws s3 cp web/lms-landing/index.html s3://lms.quizverse.world/index.html --content-type "text/html; charset=utf-8" --cache-control "public, max-age=300"` then (optional) CloudFront invalidation `/index.html` |

Content: hero (LTI 1.3 seamless pitch), 3-step how-it-works with SVG flow diagram, Canvas/Moodle pull-push capability matrix, standards badges (LTI Advantage, QTI 1.2, Moodle XML, Dynamic Registration), teacher/student/admin value props, FAQ, and a pilot-signup CTA. The signup form falls back to `mailto:hello@quizverse.world`; set `window.QV_WAITLIST_URL` (config.js) to point it at a web-tier proxy for `quizverse_research_waitlist_join` once available — do **not** embed server keys in the static site.
