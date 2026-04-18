# Bug-ticket routing — 2026-04-17 cutover

This file maps every bug ticket created during the 2026-04-17 Nakama
CrashLoopBackOff incident + CI/CD cutover to a destination, an owner, and a
routing-status note. It exists because the user explicitly asked us to
"route the two bug tickets to their owners (or open them as Jira/Linear
issues)" and we need to be honest about what the available MCP surface can
and cannot do today.

---

## What the available MCP can do

* **GitHub issues** via `gh` CLI (run from the shell). We can create issues
  on any repo we have a PAT for.
* **n8n workflows** (`user-n8n-mcp-*`). Could fan out to Slack / Jira /
  Linear / email if a workflow already exists for it. Not surveyed.
* **AWS resources** (CodeBuild, EKS, S3, SSM, etc.) — relevant for
  remediation, not for ticket routing.

## What the available MCP CANNOT do today

* **No Jira MCP.** No tool to create Jira issues, no API token configured.
* **No Linear MCP.** No tool to create Linear issues.
* **No Slack MCP.** No tool to post to a Slack channel directly. (n8n
  workflow could, but none verified.)
* **No PagerDuty MCP.** Even though one of these tickets (credential leak)
  is P0 in severity.

Implication: the markdown bug tickets are *paste-ready* but the human
filing them still has to paste them into the right tracker. We surface
this rather than pretend otherwise.

---

## Tickets

### 1. `2026-04-17-game-registry-empty-match-handler.md`

| Field | Value |
|---|---|
| Severity | P3 |
| Owner | GameRegistry module owner (TS source under `data/modules/src/game-registry/`) |
| Symptom | `[GameRegistry] Failed to setup scheduled sync` on every server boot. Scheduled sync never registers. |
| Root cause | `legacy_runtime.js` (compiled output) calls `nk.matchCreate("", ...)` with an empty module id; matchInit can't be resolved. Source needs to pass a real registered module path or call a different API. |
| Suggested destination | GitHub issue on `intelli-verse-x/nakama` repo, labelled `bug`, `game-registry`, `runtime`. Cross-link the PR that ships `Dockerfile.production` so reviewers see the context. |
| Status | **Filed in repo as markdown.** Not yet posted to a tracker. |

### 2. `2026-04-17-badges-get-all-missing-game-id.md`

| Field | Value |
|---|---|
| Severity | P3 |
| Owner | Whoever owns the `badges_get_all` client call (likely the mobile/web app team — server-side validation is correct, the client is sending an empty payload) |
| Symptom | `[Badges] Get all error: game_id is required` log spam from the badges RPC. |
| Root cause | Client-side: `badges_get_all` is invoked without the required `game_id` query param. Server validation in `data/modules/build/badges.js` is correct (rejects with the message above) — fix is in the calling client. |
| Suggested destination | GitHub issue on the relevant client repo (mobile / web / both). If unclear which client is calling it, file on `intelli-verse-x/nakama` first with the exact log fingerprint and re-route after a triage pass. |
| Status | **Filed in repo as markdown.** Not yet posted to a tracker. |

### 3. `2026-04-17-credential-leaks-kube-infra-codebuild.md`

| Field | Value |
|---|---|
| Severity | **P0** (active credential exposure + password reuse across systems) |
| Owner | Platform / SecOps — needs a single named DRI, not a label. |
| Symptom | Six plaintext credentials exposed: 1 in CodeBuild project state, 5 in `intelli-verse-kube-infra` git history. One password is **reused byte-for-byte** as both a Docker Hub password AND the MCP service `ADMIN_PASSWORD` — see `docs/bugs/2026-04-17-credential-leaks-kube-infra-codebuild.md` for the full inventory (literal values are intentionally not duplicated here). |
| Root cause | (a) CodeBuild project was configured with plaintext env vars instead of Secrets Manager refs. (b) `intelli-verse-kube-infra` has no pre-commit secret scanning and no convention enforcing `valueFrom: secretKeyRef` for `*-secret.yaml` manifests. |
| Required first action | **Rotate every credential in the inventory** before the CodeBuild cutover apply step. The cutover removes the env vars from the project but does nothing to the credentials themselves, which must be assumed public for the entire exposure window. |
| Suggested destination | (a) Open as a security incident in whatever incident tracker the org uses. (b) ALSO open a GitHub issue on `intelli-verse-x/intelli-verse-kube-infra` for the manifest-side cleanup PR. (c) Page on-call if the org's policy treats credential reuse across services as a paging incident. |
| Status | **Filed in repo as markdown.** Not posted to any tracker. **Pre-cutover blocker** for the CodeBuild apply step. |

---

## Routing checklist for the human merging this PR

For each ticket above, do one of:

1. Paste the markdown into Jira / Linear / GitHub Issues for the right
   owning team. The markdown tables and section headers are written to
   render cleanly in any of those.
2. If the org uses GitHub Issues as the tracker, run (from the nakama
   repo, with `gh` CLI authenticated):

   ```bash
   gh issue create \
     --repo intelli-verse-x/nakama \
     --title "BUG: GameRegistry empty match-handler module id" \
     --body-file docs/bugs/2026-04-17-game-registry-empty-match-handler.md \
     --label bug,game-registry,runtime
   ```

   and analogous commands for the other two.
3. For ticket 3 specifically, **do not** wait for the next sprint
   triage. The cutover doc treats credential rotation as a hard
   prerequisite. Either rotate first, then apply the cutover, or
   explicitly defer the cutover.

If/when a Jira or Linear MCP becomes available in this workspace, this
file should be updated to call those tools directly instead of leaving
the routing as a manual paste step.
