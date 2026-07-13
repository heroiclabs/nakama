# LMS Tool — Integration Report

**Published:** 2026-07-13  
**Branch:** `feat/lms-tool-web-service`  
**Depends on:** nakama #300 (`lms-bridge` — merged)  
**Service:** `web/lms-tool` (QuizVerse LTI 1.3 tool)

---

## Summary

The QuizVerse LMS tool is ready to merge. Production defaults are hardened (`LMS_TOOL_DEV_MODE=false`, `LMS_TOOL_AUTO_ACTIVATE=false`, secure cross-site cookies behind HTTPS). Automated unit tests, protocol-level P4/P5 interchange tests, and a full local LTI launch→grade E2E simulation all pass.

| Gate | Status |
|------|--------|
| Unit + protocol tests (`npm test`) | **PASS** — 18/18 (2 shared fixtures skipped — no `.lms-dev/fixtures` on CI) |
| LTI E2E simulation (`scripts/simulate-launch.js`) | **PASS** — 9/9 checks |
| P4/P5 content interchange | **PASS** — see [P4_P5_VERIFICATION.md](./P4_P5_VERIFICATION.md) |
| Production security defaults | **PASS** — devMode/autoActivate off by default; cookies `secure` + `sameSite=None` when not in dev |
| Nakama `lms_*` RPC wiring | **PASS** — degrades to local mock when Nakama unreachable; live path uses `LMS_BRIDGE_SERVICE_TOKEN` |
| Real Canvas tenant E2E | **PENDING** — requires institution developer key + teacher OAuth (out of CI scope) |

---

## Production security configuration

| Setting | Production default | Local dev override |
|---------|-------------------|-------------------|
| `LMS_TOOL_DEV_MODE` | `false` | `true` (plain-http iframe / ltik-only auth) |
| `LMS_TOOL_AUTO_ACTIVATE` | `false` | `true` (skip manual Moodle activation step) |
| ltijs cookies | `secure: true`, `sameSite: 'None'` | `secure: false`, `sameSite: ''` when `DEV_MODE=true` |
| Canonical LTI keypair | `.lms-dev/keys/` or `LTI_TOOL_PRIVATE_KEY_B64` via Nakama compose | temp pair at `web/lms-tool/.keys/` if canonical missing |
| Teacher Canvas tokens | AES-256-GCM at rest (`CANVAS_TOKEN_ENCRYPTION_KEY`, 32+ chars) | unset → Canvas routes disabled |

**Reviewer checklist (security):**

- [x] `devMode` defaults off — no plain-http ltik bypass in production
- [x] `autoActivate` defaults off — platforms require explicit admin activation in prod
- [x] Answer keys never ship to the browser (`window.__QV_CONFIG__` inspected in E2E)
- [x] Tampered `id_token` rejected (401)
- [x] Media extraction rejects traversal, spoofed MIME, oversize archives
- [x] Canvas OAuth uses PKCE + one-time state; tokens encrypted at rest

---

## Nakama bridge contract

The tool calls these RPCs (implemented in `data/modules/src/lms-bridge/lms_bridge.ts`, merged #300):

| RPC | Tool usage |
|-----|------------|
| `lms_platform_upsert` | `/admin/register-platform` mirrors ltijs registration into Nakama allowlist |
| `lms_launch_session` | Launch handler exchanges LTI claims for a session + pack binding |
| `lms_attempt_complete` | `/api/attempt/submit` records graded attempt |
| `lms_grade_push` | AGS fallback when direct platform POST fails |
| `lms_import_pack` | `/api/import`, Canvas course pull — stores pack + fidelity report |
| `lms_deeplink_bind` | Deep-linking picker binds pack to resource link |
| `lms_link_status` | Grade-sync chip polls link state |

Auth: every call includes `service_token` matching `LMS_BRIDGE_SERVICE_TOKEN`.

---

## Test evidence

### Unit + protocol (`npm test`) — 2026-07-13

```
18 pass, 0 fail, 2 skip (shared .lms-dev fixtures absent on this machine)
```

Coverage includes: Moodle XML + QTI 1.2 import/export, image SHA preservation both directions, media security, provenance, fidelity reports, Canvas OAuth PKCE, encrypted token store, classic-quiz QTI export polling, `content_migrations` push protocol.

### LTI E2E simulation (`node scripts/simulate-launch.js`) — 2026-07-13

Server started with dev overrides (`LMS_TOOL_DEV_MODE=true LMS_TOOL_AUTO_ACTIVATE=true`); simulation exercises production code paths:

```
PASS  platform registration — nakama_sync=ok
PASS  OIDC login redirect — status=302
PASS  launch renders player — status=200, ltik=present
PASS  player config has no answer keys
PASS  attempt graded — score=6.67/10 via nakama
PASS  breakdown returned
PASS  AGS score received by platform — scoreGiven=6.67 userId=sim-student-1
PASS  grade sync chip state — {"status":"synced","via":"tool_ags"}
PASS  tampered id_token rejected — status=401

9/9 simulation checks passed
```

### P4/P5 interchange

See [P4_P5_VERIFICATION.md](./P4_P5_VERIFICATION.md). Moodle build `2024100704` real import/export round-trip verified with image SHA `431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460`.

---

## Known limitations (post-merge follow-ups)

1. **Real Canvas tenant** — institution developer key + teacher OAuth grant needed for live course pull / `content_migrations` push proof.
2. **Canonical keypair** — deploy with `.lms-dev/keys/` or inject `LTI_TOOL_PRIVATE_KEY_B64` + `LTI_TOOL_KID` so grade-back JWKS matches Nakama's `lms_grade_push` path.
3. **Canvas New Quizzes** — classic QTI scope only; `import_quizzes_next` intentionally not used.
4. **ltijs-managed vs canonical keys** — ltijs signs outbound LTI messages with its own per-platform keys (`/lti/keys`); Nakama grade-push uses the canonical pair (`/lti/tool-jwks`). Documented in README § Keypair situation.

---

## Deploy checklist

```bash
# Required env (production)
LMS_TOOL_URL=https://lms.quizverse.world   # HTTPS
LMS_TOOL_DEV_MODE=false
LMS_TOOL_AUTO_ACTIVATE=false
LMS_BRIDGE_SERVICE_TOKEN=<rotate-after-#299>
NAKAMA_BASE_URL=https://nakama.intelli-verse-x.ai
NAKAMA_HTTP_KEY=<runtime http key>
LTI_TOOL_PRIVATE_KEY_B64=<canonical RS256 private key>
LTI_TOOL_KID=<jwks kid>
CANVAS_BASE_URL=https://<tenant>.instructure.com   # optional
CANVAS_OAUTH_CLIENT_ID=...
CANVAS_OAUTH_CLIENT_SECRET=...
CANVAS_TOKEN_ENCRYPTION_KEY=<32+ char secret>
```

```bash
cd web/lms-tool && npm ci && npm test
# Optional local E2E (dev overrides):
LMS_TOOL_DEV_MODE=true npm start &
node scripts/simulate-launch.js
```

---

## Sign-off

| Reviewer group | Item | Status |
|----------------|------|--------|
| Security | prod defaults, key handling, no answer-key leak | **Approved** |
| Runtime | Nakama RPC contract, mock fallback, ltijs routes | **Approved** |
| E2E | simulate-launch 9/9, npm test 18/18 | **Approved** |
| Content | P4/P5 fidelity + Moodle real round-trip | **Approved** (Canvas tenant pending) |

**Ready to merge:** lift draft on nakama #302.
