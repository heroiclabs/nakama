# QuizVerse LMS Tool (`web/lms-tool/`)

LTI 1.3 / LTI Advantage **Tool** web service for the LMS integration plan
(`docs/LMS_INTEGRATION_RESEARCH_AND_PLAN.md` §5/§6/§7/§9/§13). Workstream C deliverable.

- **LTI endpoints** (via [ltijs](https://cvmcosta.me/ltijs/)): OIDC login, launch, JWKS, Dynamic Registration
- **Student quiz player** (server-rendered + vanilla JS, iframe-safe, no cookies needed in dev mode)
- **Teacher deep-linking picker** with Moodle XML / Canvas QTI upload + fidelity report
- **Converters**: Moodle XML ⇄ canonical questions, Canvas QTI 1.2 zip ⇄ canonical questions
- **Image-safe interchange**: manifest/base64 extraction, verified media types, 5 MiB/file and 20 MiB/package limits, controlled local storage
- **Canvas teacher OAuth**: PKCE connection, course QTI pull, encrypted token storage, `content_migrations` QTI push
- **Standalone bridge**: public `/converter` surface for Canvas QTI ↔ Moodle XML conversion
- **Nakama lms-bridge client** for Workstream B's RPC contract (live, with local-mock fallback)
- **AGS grade-back**: tool-side `Grade.submitScore` (primary for E2E), Nakama `lms_grade_push` (production path)

## Run

```bash
cd web/lms-tool
npm install
npm start            # boots on :8090
npm test             # converter unit tests (node:test)
node scripts/simulate-launch.js   # full launch E2E without any LMS (needs the tool running)
npm run mock-nakama  # optional standalone RPC stub on :7360 (NAKAMA_BASE_URL=http://localhost:7360)
```

Requires Node 20+. State lives in `web/lms-tool/data/` (ltijs sqlite DB + local pack mirror) — delete it for a clean slate.

### Configuration (all optional; defaults suit local dev)

| Env var | Default | Meaning |
|---|---|---|
| `LMS_TOOL_PORT` | `8090` | HTTP port |
| `LMS_TOOL_URL` | `http://localhost:8090` | Public base URL (used in registration + deep-link items) |
| `NAKAMA_BASE_URL` | `http://localhost:7350` | Nakama HTTP API |
| `NAKAMA_HTTP_KEY` | `defaulthttpkey` | Nakama runtime http key (repo compose passes no override → server default) |
| `LMS_BRIDGE_SERVICE_TOKEN` | read from repo `.env` | Service token required by every lms-bridge RPC |
| `LMS_TOOL_DEV_MODE` | `false` | ltijs devMode. Set `true` for local plain-http iframe dev only |
| `LMS_TOOL_AUTO_ACTIVATE` | `false` | Dynamic registration auto-activates platforms. Set `true` for local Moodle convenience |
| `MOODLE_URL` | `http://localhost:8081` | Workstream A's local Moodle (used for admin-page hints only) |
| `LMS_TOOL_MEDIA` | `data/media` | Controlled extracted-media directory |
| `CANVAS_BASE_URL` | unset | Institution Canvas origin; HTTPS required except localhost |
| `CANVAS_OAUTH_CLIENT_ID` | unset | Teacher OAuth developer-key client id |
| `CANVAS_OAUTH_CLIENT_SECRET` | unset | Teacher OAuth developer-key secret |
| `CANVAS_OAUTH_REDIRECT_URI` | `<tool>/api/canvas/oauth/callback` | Exact developer-key redirect URI |
| `CANVAS_TOKEN_ENCRYPTION_KEY` | unset | 32+ character key used for AES-256-GCM token storage |

The repo root `.env` is loaded first, then `web/lms-tool/.env` overrides.

## Endpoints

| Route | What |
|---|---|
| `POST/GET /lti/login` | OIDC third-party-initiated login (ltijs) |
| `POST /lti/launch` | Launch handler — validates id_token, renders the quiz player (or picker for deep-link requests) |
| `GET /lti/keys` | JWKS — **ltijs-managed** platform-specific keys (these sign our LTI messages) |
| `GET/POST /lti/register` | Dynamic Registration endpoint (paste into Moodle) |
| `GET /lti/tool-jwks` | JWKS of the **canonical** keypair (`.lms-dev/keys/`) — for Nakama's `lms_grade_push` |
| `GET /admin/register` | Registration helper page (URLs + manual platform form) |
| `POST /admin/register-platform` | Registers a platform in ltijs **and** Nakama (`lms_platform_upsert`) |
| `GET /` , `GET /health` | Index / health+integration status |
| `POST /api/attempt/submit` | (ltik-authed) grade attempt → AGS push → sync status |
| `POST /api/deeplink/respond` | (ltik-authed) deep-linking response form (`ltiResourceLink` + `lineItem`) |
| `POST /api/import` | (ltik-authed) upload Moodle XML / QTI zip → convert → `lms_import_pack` + fidelity report |
| `GET /api/export/:packId.xml` / `.zip` | (ltik-authed) canonical pack → Moodle XML / QTI 1.2 zip |
| `GET /converter` | Standalone Canvas ↔ Moodle converter |
| `POST /api/converter/convert` | Public converter API; always returns fidelity + provenance |
| `GET /api/canvas/oauth/start` | (teacher LTI launch) start Canvas OAuth with PKCE |
| `GET /api/canvas/courses` | List connected teacher's active courses |
| `POST /api/canvas/courses/:courseId/pull` | Export each classic quiz as QTI and import as packs |
| `POST /api/canvas/courses/:courseId/push/:packId` | Push generated QTI via Canvas `content_migrations` |

## Registering with the local Moodle (Workstream A: http://localhost:8081)

**Dynamic registration (preferred, one URL):**

1. Make sure this tool is running (`npm start`) and reachable from Moodle. If Moodle runs in
   Docker, `localhost:8090` inside the container is **not** this machine — register with
   `LMS_TOOL_URL=http://host.docker.internal:8090 npm start` so all advertised URLs match.
2. Moodle admin → *Site administration → Plugins → Activity modules → External tool → Manage tools*.
3. Paste `http://localhost:8090/lti/register` (or the `host.docker.internal` variant) into **Tool URL** → **Add LTI Advantage**.
4. Click **Activate** on the new tool card (production requires manual activation; for local dev set `LMS_TOOL_AUTO_ACTIVATE=true`).
5. After registration, mirror the deployment into Nakama's allowlist: the tool syncs the platform
   automatically, but **deployment IDs only become known at first launch/registration** — if
   `lms_launch_session` returns `deployment not registered`, add the deployment id via
   `lms_platform_upsert` (payload `{platform_id, issuer, client_id, token_url, kind, deployment_ids:["<id>"]}`)
   or re-submit the `/admin/register` form with the Deployment IDs field filled.
6. In a course: *Add an activity or resource → External tool* → pick the tool → **Select content**
   opens the QuizVerse picker (deep linking) → choose/import a pack, set max points, **Add to course**.
7. Launch as a student → take the quiz → grade appears in Moodle's gradebook
   (*Grades* in the course; pushed via AGS with `gradingProgress=FullyGraded`).

Note the verified Moodle 4.3+ quirk (plan §4.5): with deep linking enabled, content selection is
mandatory when adding the activity. If a plain-launch registration is also wanted, register the
tool a second time without deep linking.

**Manual registration** (if dynamic reg is unavailable): use `/admin/register` — Moodle endpoints are
`/mod/lti/auth.php` (auth), `/mod/lti/token.php` (token), `/mod/lti/certs.php` (JWKS); Moodle shows the
client id on the tool's configuration details after you create the tool by hand.

## Nakama contract status (verified live 2026-07-12)

All Workstream B RPCs are **live** and this tool integrates against them (`?http_key=defaulthttpkey&unwrap`,
envelope `{success,data|error,code}`, `service_token` from repo `.env`):

| RPC | Used by | Status |
|---|---|---|
| `lms_platform_list` | issuer → `platform_id` resolution (cached 60s) | live ✅ |
| `lms_platform_upsert` | `/admin/register-platform`, dynamic-reg sync | live ✅ |
| `lms_launch_session` | every resource-link launch | live ✅ (enforces platform+deployment allowlist) |
| `lms_deeplink_bind` | lazy bind at first launch of a deep-linked item | live ✅ |
| `lms_attempt_complete` | submit → server-side grading + grade queue | live ✅ |
| `lms_link_status` | sync-status queries | live ✅ |
| `lms_grade_push` | backup trigger when tool-side AGS fails | live ✅ (needs key registration, see below) |
| `lms_import_pack` | picker upload + demo-pack seed at boot | live ✅ |

**Fallback behavior:** if Nakama is down or an RPC 404s, the client falls back to
`mock-nakama/handlers.js` (in-process) and marks the RPC `mocked` on `/` and `/health`
("integration-pending"). A launch rejected by the allowlist degrades to local grading
(`grading_source: "local_fallback"` in the submit response) instead of breaking the student.

## Keypair situation (read this before wiring grade-push E2E)

- **Canonical keypair** (`.lms-dev/keys/lti_tool_private.pem`, kid `qv-lti-2026-07`, Workstream A)
  is loaded by this tool and served at **`/lti/tool-jwks`**. If it were missing at boot, a
  temporary pair is generated at `web/lms-tool/.keys/` and flagged in `/health` (`key_source`).
- **ltijs generates its own RSA keypair per platform registration** (stored encrypted in its
  sqlite DB) and has **no key-injection API**. `/lti/keys` therefore serves ltijs-managed keys,
  and those are what sign this tool's deep-linking responses and AGS client assertions.
- **Consequence for grade push:** the E2E grade-back path is **tool-side AGS via ltijs**
  (`Grade.submitScore`) — verified working in `scripts/simulate-launch.js`. Nakama's
  `lms_grade_push` signs with the **canonical** key, so it can only succeed against a platform
  registration whose tool JWKS is `/lti/tool-jwks` (canonical), not `/lti/keys` (ltijs).
  For production per plan §8, either register the platform against `/lti/tool-jwks` and bypass
  ltijs's service auth, or keep tool-side push. The tool already records every sync outcome to
  Nakama via `lms_link_status`, and triggers `lms_grade_push` as a backup when tool-side push fails.

## Converters (`src/converters/`)

Canonical shape: `{question_id, text, options[], correct_index, explanation?}`.

| Direction | Function | Notes |
|---|---|---|
| Moodle XML → canonical | `parseMoodleXml(xml)` | `multichoice` single-answer; rich text/metadata retained; valid base64 images extracted and preserved |
| QTI 1.2 zip → canonical | `parseQtiZip(buffer)` | manifest-required resource resolution; media retained; `respcondition`/`setvar SCORE=100` → correct index |
| canonical → Moodle XML | `generateMoodleXml(pack)` | round-trips through `parseMoodleXml` |
| canonical → QTI 1.2 zip | `generateQtiZip(pack)` | `imsmanifest.xml` + assessment XML; round-trips through `parseQtiZip` |

Every import produces and stores a **fidelity report** (plan §13.2: no silent lossy imports) —
`{report_id,generated_at,source,imported,imported_with_loss,skipped,items[{name,status,notes,fields_dropped}],global_notes}` —
surfaced to the teacher and returned by import/converter APIs. Packs also retain source provenance
(`platform`, format, course/quiz IDs when known, source URL/hash, export/import timestamps).

Tests: `npm test` includes format parsing, image-preserving cross-format round trips, path/type/size
security checks, provenance/fidelity validation, encrypted OAuth token storage, and Canvas REST
protocol tests. Set `LMS_REAL_FIXTURE_DIR=/path/to/.lms-dev/fixtures` to require the externally
captured Moodle/Canvas fixtures instead of skipping them.

## File map

```
web/lms-tool/
├── package.json              # deps: ltijs, ltijs-sequelize, sqlite3, express, fast-xml-parser, adm-zip, multer
├── src/
│   ├── server.js             # ltijs setup, LTI handlers, APIs, admin routes, boot
│   ├── config.js             # env, routes, canonical-key loading (+temp fallback)
│   ├── nakama-client.js      # lms-bridge RPC client (live + mock fallback + envelope unwrap)
│   ├── pack-store.js         # local pack mirror (data/packs.json) + demo pack
│   ├── converters/           # canonical.js, moodle-xml.js, qti.js, index.js
│   └── pages/                # layout.js, player.js, picker.js, admin.js, index.js
├── mock-nakama/              # handlers.js (in-process stub) + server.js (standalone :7360)
├── scripts/simulate-launch.js# fake-platform E2E: OIDC → launch → submit → AGS assert (9 checks)
└── test/                     # converters.test.js + fixtures (moodle_sample.xml, QTI zip builder)
```
