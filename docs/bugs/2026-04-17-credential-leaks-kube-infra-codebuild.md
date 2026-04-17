# BUG: Plaintext credential leaks across CodeBuild + kube-infra repo

**Filed:** 2026-04-17
**Severity:** P0 (active credential exposure; password reuse across systems)
**Owner:** Platform / SecOps (cross-cutting; needs a single owning DRI)
**Affects:** AWS CodeBuild project `intelliverse-nakama-build`, GitHub repo `intelli-verse-kube-infra` (and its full git history), any system trusting the leaked credentials.

---

## Discovery context

Found while preparing the CodeBuild cutover described in
`ops/codebuild/CUTOVER.md` of the `nakama` repo. The pre-cutover snapshot of
the CodeBuild project (`ops/codebuild/intelliverse-nakama-build.snapshot.PRE-CUTOVER.json`)
surfaced two `PLAINTEXT` env vars holding Docker Hub credentials, which then
prompted a wider plaintext-secret sweep of the `intelli-verse-kube-infra` repo.
That sweep surfaced four additional plaintext secrets, one of which **reuses
the same password as the Docker Hub credential**.

Snapshot file has been sanitized at the file level (values replaced with
`***REDACTED-SEE-CUTOVER.md***`) so commit-time scanners don't trip on it.
The secrets themselves are still considered live and exposed.

---

## Inventory of leaked credentials

> **Note on values below.** The literal credential values are intentionally
> NOT reproduced in this ticket. They are recoverable from the source
> locations listed in the "Location" column (which the rotating DRI must
> have access to in order to rotate them). Adding more committed copies of
> the literals into the `nakama` repo would just expand the eventual
> post-rotation cleanup surface for no marginal forensic value.

| # | Secret (description) | Location (source of truth for the literal value) | Repo | Status in repo today |
|---|---|---|---|---|
| 1 | Docker Hub username + password | CodeBuild project `intelliverse-nakama-build` env vars (live, pre-cutover) | n/a (AWS console state) | Snapshot sanitized in `nakama/ops/codebuild/intelliverse-nakama-build.snapshot.PRE-CUTOVER.json`; live CodeBuild project still has them until cutover apply. |
| 2 | MCP `ADMIN_PASSWORD` — **same value as #1** (password reuse) | `intelli-verse-mcp/secret.yaml:14` | `intelli-verse-kube-infra` | Plaintext in working tree AND git history (committed 2026-01-12). |
| 3 | Cognito app-client `OAUTH_CLIENT_SECRET` for client `54clc0uaqvr1944qvkas63o0rb` | `intelli-verse-mcp/secret.yaml:16` | `intelli-verse-kube-infra` | Plaintext in working tree AND git history. |
| 4 | Test user `USER_PASSWORD` (account email also leaked alongside it) | `intelli-verse-mcp/secret.yaml` (`USER_EMAIL` + `USER_PASSWORD` keys) | `intelli-verse-kube-infra` | Plaintext in working tree AND git history. Account identifier deliberately not duplicated here. |
| 5 | Nakama Postgres `DB_PASSWORD` | `nakama/nakama-secret.yaml:43` | `intelli-verse-kube-infra` | Plaintext in working tree AND git history. |
| 6 | `GOOGLE_MAPS_API_KEY` | `nakama/nakama-secret.yaml:53` | `intelli-verse-kube-infra` | Plaintext in working tree AND git history. |

`intelli-verse-mcp/secret.yaml` carries a top-of-file comment claiming the
manifest is just a "fallback/reference" and the real values live in Parameter
Store. The values are nevertheless committed in plaintext, so the comment is
either misleading or describes a future state that was never enforced. Either
way, the credentials must be treated as compromised.

---

## Why this is P0, not P3

* **Password reuse across trust boundaries.** The Docker Hub password and the
  MCP service `ADMIN_PASSWORD` are byte-for-byte identical. Anyone who read
  either source (CodeBuild env vars, kube-infra git history) now has the admin
  password to the MCP service. There is no plausible "they're not used
  anywhere we ship" defense — at least one of them clearly is shipped.
* **Git history can't be cleaned by the cutover apply.** Even after we strip
  the values from CodeBuild and from the working-tree manifests, anyone with
  read access to `intelli-verse-kube-infra` can `git log -p` and recover them.
  Rotation is the only reliable remediation.
* **Long exposure window.** `secret.yaml` was committed 2026-01-12 and has
  been in the repo for over three months. Assume the values are public.

---

## Required actions, in order

1. **Rotate every credential listed above.** Treat the rotation as if the
   values were posted publicly on the day they were committed. Per-credential
   notes:
   * Docker Hub: rotate password on the account, then audit Docker Hub for
     unauthorized image pushes/pulls during the exposure window.
   * `ADMIN_PASSWORD` (MCP): rotate in Cognito / wherever it's checked AND in
     Parameter Store `/codebuild/intelliverse-mcp`. Force log out of any
     active admin sessions.
   * `OAUTH_CLIENT_SECRET`: rotate the OAuth app client secret (Cognito user
     pool `4cfc66oqg13c39a4uv3ma7s723` per other env vars in this repo)
     and redistribute to consumers via Parameter Store.
   * `USER_PASSWORD`: rotate the test user password; if the account is no
     longer needed, delete it.
   * Nakama Postgres password: rotate the DB user password, update
     Parameter Store, restart `intelliverse-nakama` deploy.
   * Google Maps API key: rotate the key in Google Cloud Console; restrict
     it by HTTP referrer + API surface while you're there.

2. **Confirm Parameter Store wiring is actually live.** `secret.yaml`'s
   header comment claims an init container fetches from
   `/codebuild/intelliverse-mcp`. Verify that's actually the load-bearing
   path in the running deployment; if so, the in-repo `secret.yaml` should
   become a placeholder template (no real values) or be deleted entirely.
   If it's NOT actually wired up, the rotation in step 1 must include
   updating the in-cluster Secret directly.

3. **Decide on git-history cleanup.** Two options:
   * **Recommended:** consider the values rotated and gone, leave the
     history alone, and just update the working tree to placeholders going
     forward. History becomes a forensic artifact, not a live exposure.
   * **Alternative:** rewrite history (`git filter-repo` or BFG) on
     `intelli-verse-kube-infra` to scrub the secrets. This requires a
     coordinated force-push, breaks every outstanding fork/clone/PR, and
     does NOT help anyone who already cloned the repo. Only worth doing if
     compliance specifically requires it.
   * **Not acceptable:** leaving the values in history *without* rotating.

4. **Stop committing plaintext secrets to `intelli-verse-kube-infra`.**
   Recommended controls:
   * Pre-commit hook: `gitleaks` or `trufflehog` on staged files.
   * Repo-side push protection: GitHub secret scanning + push protection
     (free for public repos, available on Enterprise for private).
   * Convention: every `*-secret.yaml` in this repo should reference
     Parameter Store / Secrets Manager via `valueFrom: secretKeyRef` or be
     entirely committed as templates with placeholder values.

---

## What's already done in this PR

* CodeBuild pre-cutover snapshot has its `DOCKER_USERNAME` /
  `DOCKER_PASSWORD` values redacted at the file level before commit.
* `ops/codebuild/intelliverse-nakama-build.update.json` (the file used by
  `aws codebuild update-project`) does NOT include the Docker Hub env
  vars, so the cutover apply removes them from the live project.
* `ops/codebuild/CUTOVER.md` has a top-level "Credential rotation
  (REQUIRED)" section calling out the leak and pointing at this ticket.

## What's explicitly NOT done in this PR

* Working-tree edits to `intelli-verse-kube-infra/intelli-verse-mcp/secret.yaml`
  or `intelli-verse-kube-infra/nakama/nakama-secret.yaml`. Those manifests
  are owned by the kube-infra repo, the values are already in its git
  history, and changing them in this PR would be both out of scope and
  ineffective without rotation. They need their own PR + their own
  rotation workstream.
* Any actual credential rotation. That has to be done by humans with
  access to Cognito, the Postgres instance, GCP, and Docker Hub.
* Any git-history rewrite.

---

## Suggested labels (for whichever tracker this lands in)

`security`, `secrets`, `incident`, `kube-infra`, `codebuild`, `P0`
