# CodeBuild cutover — `intelliverse-nakama-build`

> Owner: SRE / Platform.
> Run only **after** `nakama#master` contains `Dockerfile.production` and `buildspec.yml`,
> and after `intelli-verse-kube-infra` has the pinned-digest `nakama/deployment.yaml` merged.
> Estimated downtime: **0**. The cutover only changes how the *next* build behaves.

---

## What this changes (and why)

The live CodeBuild project (`intelliverse-nakama-build`) currently:

1. Uses an **inline buildspec** stored in the project itself, so changes are invisible
   to code review and impossible to roll back via `git revert`.
2. Builds and pushes only the mutable `:latest` tag, then runs `kubectl rollout
   restart` — which is exactly what re-introduced the Go-plugin ABI mismatch and
   put `intelliverse-nakama` into `CrashLoopBackOff` on 2026-04-15.
3. Has **plaintext Docker Hub credentials** (`DOCKER_USERNAME` / `DOCKER_PASSWORD`)
   baked into the project as `PLAINTEXT` env vars. The `buildspec.yml` we're
   cutting over to does not use them (we push to ECR, not Docker Hub), but the
   *same password* is reused as `ADMIN_PASSWORD` in
   `intelli-verse-kube-infra/intelli-verse-mcp/secret.yaml`, so removing them
   from the project does **not** make the system safe. See
   [Credential rotation (REQUIRED)](#credential-rotation-required--p0-blocks-the-apply-step)
   below — full inventory in
   `docs/bugs/2026-04-17-credential-leaks-kube-infra-codebuild.md`.
4. Has `privilegedMode: false`, which means `docker build` cannot actually run
   inside the container. The legacy build apparently relied on a workaround we
   should not perpetuate.

After this cutover:

1. Buildspec is read from `buildspec.yml` at the repo root → fully reviewable in
   PRs, fully revertable in git.
2. Every build produces an **immutable** ECR tag of the form
   `3.0.0-<git-sha7>-build<N>`, and the deployment is rolled forward via
   `kubectl set image` using the **ECR-resolved SHA256 digest**. `:latest` is still
   pushed for backwards compat but is never what the live deployment points at.
3. Docker Hub creds are removed.
4. `privilegedMode: true` so Docker actually works.
5. Local Docker layer cache is enabled, cutting build time materially.

No IAM or EKS permissions need to change — see
[Pre-flight](#pre-flight-already-satisfied) below.

---

## Pre-flight (already satisfied)

| Requirement | How to verify | Status |
|---|---|---|
| `codebuild-role` can push to ECR | `aws iam list-attached-role-policies --role-name codebuild-role` shows `AdministratorAccess` | ✅ |
| `codebuild-role` can call `eks:DescribeCluster` | same — `AdministratorAccess` covers it | ✅ |
| `codebuild-role` can `kubectl set image` / `rollout status` on the deployment | `aws eks list-associated-access-policies --cluster-name ai-cart-auto-cluster --principal-arn arn:aws:iam::970547373533:role/codebuild-role` shows `AmazonEKSClusterAdminPolicy` (cluster scope) | ✅ |
| EKS cluster auth mode supports access entries | `aws eks describe-cluster --name ai-cart-auto-cluster --query cluster.accessConfig` → `authenticationMode: API` | ✅ |
| Source repo & branch are correct | `aws codepipeline get-pipeline --name intelliverse-nakama` → source = `intelli-verse-x/nakama` `master` | ✅ |

> Both `AdministratorAccess` and `AmazonEKSClusterAdminPolicy` are wider than
> strictly needed. Tightening them is a separate ticket — see
> [Follow-ups](#follow-ups).

---

## The cutover

### 1. Confirm the prereq commits are on `master`

```bash
cd ~/dev/nakama
git fetch origin master
git log --oneline origin/master | head -5
# Expect to see commits adding Dockerfile.production and buildspec.yml.
test -f Dockerfile.production && test -f buildspec.yml && echo OK
```

### 2. Apply the project update

```bash
cd ~/dev/nakama
aws codebuild update-project \
  --cli-input-json file://ops/codebuild/intelliverse-nakama-build.update.json \
  --region us-east-1
```

`update-project` is idempotent — re-running it with the same JSON is a no-op.

### 3. Sanity-check the project

```bash
aws codebuild batch-get-projects \
  --names intelliverse-nakama-build \
  --region us-east-1 \
  --query 'projects[0].{src:source.type,buildspec:source.buildspec,priv:environment.privilegedMode,env:environment.environmentVariables[*].name,role:serviceRole}'
```

Expect:

* `src: "CODEPIPELINE"`
* `buildspec: ""` (empty → CodeBuild reads `buildspec.yml` from source)
* `priv: true`
* `env` contains `EKS_CLUSTER_NAME`, `K8S_NAMESPACE`, `K8S_DEPLOYMENT`,
  `K8S_CONTAINER`, `ECR_REPOSITORY`, `AWS_ACCOUNT_ID`, `AWS_DEFAULT_REGION`
* `env` does **not** contain `DOCKER_USERNAME` / `DOCKER_PASSWORD`
* `role: "arn:aws:iam::970547373533:role/codebuild-role"`

### 4. Trigger a build through the pipeline

```bash
aws codepipeline start-pipeline-execution \
  --name intelliverse-nakama --region us-east-1
```

Watch it:

```bash
aws codepipeline get-pipeline-state --name intelliverse-nakama \
  --region us-east-1 \
  --query 'stageStates[*].{stage:stageName,status:latestExecution.status}'
```

### 5. Verify the live deployment is now on the immutable digest

```bash
kubectl get deploy intelliverse-nakama -n aicart \
  -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}'
# Expected:
#   970547373533.dkr.ecr.us-east-1.amazonaws.com/intelliverse-nakama@sha256:<digest>
# NOT ending in :latest.
```

```bash
kubectl rollout status deploy/intelliverse-nakama -n aicart --timeout=2m
kubectl get pods -n aicart -l app=intelliverse-nakama -o wide
```

---

## Rollback

If the new buildspec misbehaves:

1. Revert the CodeBuild project to its previous inline buildspec by re-applying
   the snapshot captured at `ops/codebuild/intelliverse-nakama-build.snapshot.PRE-CUTOVER.json`.

   > That snapshot has been **sanitized** — the `DOCKER_USERNAME` /
   > `DOCKER_PASSWORD` values were replaced with `***REDACTED-SEE-CUTOVER.md***`
   > before commit (those creds are leaked anyway and must be rotated, not
   > restored — see [Credential rotation (REQUIRED)](#credential-rotation-required)).
   > If you genuinely need to roll back to the *exact* prior state, restore
   > everything from the snapshot **except** those two env vars; they should
   > stay deleted.

   The snapshot is the project definition as returned by `batch-get-projects`,
   so converting it back into an `update-project` payload is a `jq` away:

   ```bash
   jq '.projects[0]
        | del(.arn, .created, .lastModified, .badge, .webhook, .projectVisibility,
              .resourceAccessRole, .publicProjectAlias)' \
       ops/codebuild/intelliverse-nakama-build.snapshot.PRE-CUTOVER.json \
       > /tmp/rollback-payload.json

   aws codebuild update-project \
     --cli-input-json file:///tmp/rollback-payload.json \
     --region us-east-1
   ```

2. To roll the *deployment* back independently of CodeBuild, point it at the
   last-known-good immutable digest documented in `intelli-verse-kube-infra/nakama/deployment.yaml`:

   ```bash
   kubectl set image deploy/intelliverse-nakama \
     intelliverse-nakama=970547373533.dkr.ecr.us-east-1.amazonaws.com/intelliverse-nakama@sha256:d2928ce4c2c7b4eaf4153b377bd09b6ddc4bea5eeb4d3ed9eb427076d8cdb5a5 \
     -n aicart
   kubectl rollout status deploy/intelliverse-nakama -n aicart --timeout=2m
   ```

---

## Credential rotation (REQUIRED — P0, blocks the apply step)

> Full inventory and rationale: see
> [`docs/bugs/2026-04-17-credential-leaks-kube-infra-codebuild.md`](../../docs/bugs/2026-04-17-credential-leaks-kube-infra-codebuild.md).
> Routing of that ticket: see [`docs/bugs/ROUTING.md`](../../docs/bugs/ROUTING.md).

The pre-cutover snapshot of this CodeBuild project surfaced plaintext Docker
Hub credentials. Following that discovery, a wider sweep of `intelli-verse-kube-infra`
surfaced **four more** plaintext credentials in committed Kubernetes Secret
manifests. One of them is **the same password** as the Docker Hub one, used as
the MCP service `ADMIN_PASSWORD`. That password reuse is what escalates this
from "tidy up a stale CI env var" to **P0 / blocks the cutover apply step**.

The CodeBuild snapshot file (`ops/codebuild/intelliverse-nakama-build.snapshot.PRE-CUTOVER.json`)
has been sanitized at the file level — both Docker Hub values were replaced
with `***REDACTED-SEE-CUTOVER.md***` before commit so the rollback artefact
itself doesn't add a second copy of the leak. **The credentials themselves are
still leaked** and must be treated as public for the entire exposure window.

### Inventory (must rotate ALL of these, not just the Docker Hub one)

| # | Secret | Source of leak | Rotation system |
|---|---|---|---|
| 1 | Docker Hub password + username | CodeBuild project env vars (live, pre-cutover) | Docker Hub account settings |
| 2 | `ADMIN_PASSWORD` (**byte-for-byte identical to #1** — password reuse) | `intelli-verse-kube-infra/intelli-verse-mcp/secret.yaml` (in git history) | Cognito + Parameter Store `/codebuild/intelliverse-mcp` |
| 3 | `OAUTH_CLIENT_SECRET` for Cognito client `54clc0uaqvr1944qvkas63o0rb` | `intelli-verse-kube-infra/intelli-verse-mcp/secret.yaml` (in git history) | Cognito user pool → app client → secret rotate |
| 4 | `USER_PASSWORD` (test user) | `intelli-verse-kube-infra/intelli-verse-mcp/secret.yaml` (in git history) | Rotate or delete the test user |
| 5 | Nakama Postgres password | `intelli-verse-kube-infra/nakama/nakama-secret.yaml` (in git history) | DB user password rotate + restart `intelliverse-nakama` |
| 6 | Google Maps API key | `intelli-verse-kube-infra/nakama/nakama-secret.yaml` (in git history) | Google Cloud Console → rotate + restrict by referrer + API surface |

### Required order of operations

1. **Rotate every credential in the inventory above** — *before* running
   `aws codebuild update-project` in [step 2 of the cutover](#2-apply-the-project-update).
   The cutover apply only removes the Docker Hub env vars from CodeBuild; it
   does **nothing** to mitigate the wider leak. Specifically:
   * Rotate Docker Hub password and audit recent push/pull activity.
   * Rotate `ADMIN_PASSWORD` in Cognito **and** in Parameter Store
     `/codebuild/intelliverse-mcp`. Force log-out of any active admin sessions.
   * Rotate the Cognito app-client secret and redistribute via Parameter Store.
   * Rotate or delete the test user (`USER_EMAIL` / `USER_PASSWORD`).
   * Rotate the Nakama Postgres password in the DB and Parameter Store, then
     restart `intelliverse-nakama` so the init container picks it up.
   * Rotate the Google Maps API key and restrict it.
2. **Confirm the kube-infra Parameter-Store wiring is real.** `intelli-verse-mcp/secret.yaml`
   carries a header comment claiming the values are loaded from Parameter
   Store and that the in-repo file is just a "fallback/reference". Verify the
   running deployment actually consumes Parameter Store (init container?
   `valueFrom: secretKeyRef`?) and not the in-repo plaintext. If it really
   does load from Parameter Store, the in-repo manifest should be reduced to
   a placeholder template in the kube-infra repo's own follow-up PR.
3. **Do not restore the redacted values into the snapshot file under any
   circumstance** — not even for "exact-state" rollbacks. The
   [Rollback](#rollback) procedure above already accounts for this.
4. **Add commit-time secret scanning** to `intelli-verse-kube-infra`
   (`gitleaks` or `trufflehog` pre-commit + GitHub push protection) so the
   next leak gets blocked at `git push`, not three months later in a CI
   audit.

### What this cutover PR does *not* do

* It does not rotate any credential. That requires humans with access to
  Cognito, the Postgres instance, GCP, and Docker Hub.
* It does not modify any file in `intelli-verse-kube-infra` other than
  `nakama/deployment.yaml`. The `*-secret.yaml` cleanup is a separate
  workstream, owned by the kube-infra repo and the Platform/SecOps DRI named
  in the bug ticket.
* It does not rewrite git history on `intelli-verse-kube-infra`. That's a
  decision for the DRI on the bug ticket, not this PR.

---

## Follow-ups (not blocking this cutover)

* Replace `AdministratorAccess` on `codebuild-role` with a least-privilege policy
  scoped to `ecr:Get*/Batch*/UploadLayerPart/PutImage/CompleteLayerUpload/InitiateLayerUpload`,
  `eks:DescribeCluster`, and the specific S3/CloudWatch logging the project uses.
* Replace `AmazonEKSClusterAdminPolicy` with a Kubernetes `Role` in `aicart`
  granting only `get,patch` on `deployments/intelliverse-nakama` and `get` on
  `pods` — bound via an EKS access entry scoped to that namespace.
