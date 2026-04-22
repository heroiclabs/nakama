# 2026-04-22 — Merge conflict markers shipped to prod broke the entire Nakama JS runtime

> Status: fixed in repo; rollback in cluster pending operator action.
> Owner: Platform / Backend.
> Severity: P0 — every JS RPC dead in prod for ~7 hours before detection.
> Triggering commit: `cbeacf61` ("Merging" by sid@anideebee.com, 2026-04-22 12:32 IST).
> Triggering CodeBuild build: `intelliverse-nakama-build` build #189
> (`SUCCEEDED` ✗), pushed `${ECR}/intelliverse-nakama:3.0.0-cbeacf6-build189`
> @ `sha256:e776966c…`.

---

## Summary

The merge commit `cbeacf6` left **63 unresolved git conflict markers in
`data/modules/index.js`** and **3 in `data/modules/legacy_runtime.js`**.
CodeBuild #189 still tagged `SUCCEEDED` because:

1. `Dockerfile.production` ran the modules step as `npm run build || true`,
   silently swallowing any failure.
2. There was no `node -c index.js` syntax gate in the prod image (the dev
   `Dockerfile` already had this gate; prod did not).
3. BuildKit hit a cached layer for the `modules` stage (`#14 DONE 0.5s`),
   so `tsc` and `postbuild.js` never re-ran — the broken in-tree
   `data/modules/index.js` shipped verbatim.
4. EKS rolled the new image forward and the pods reported Healthy/Ready
   because the k8s probe is `GET /healthcheck` — Nakama's HTTP liveness,
   which returns 200 even when the JavaScript runtime provider failed to
   compile a single module.

The Nakama logs in EKS at the time confirmed the symptom:

```
ERROR  Could not compile JavaScript module
       module=index.js  error=SyntaxError: index.js: Line 3:1 Unexpected token <<
WARN   Failed to load JavaScript files, server will start without JavaScript runtime modules
INFO   Found runtime modules count=1 modules=[analytics_metrics.so]
INFO   Startup done
```

i.e. the only thing loaded was the in-tree Go plugin. Every one of the
540 JavaScript RPCs (auth, wallet, leaderboards, friends, Hiro, Satori,
fantasy, cricket, …) returned 404 "rpc id not found" for ~7 hours.

The 6-hour Discord summary at 13:07 UTC reported `total_calls=0
total_errors=0 families=0` — the smoking-gun signal that *no JS RPCs
were registered*.

## Recovery (operator action)

Roll the cluster back to the last-known-good image while master is being
fixed. SHA was captured in `ops/codebuild/CUTOVER.md`:

```bash
kubectl set image deploy/intelliverse-nakama \
  intelliverse-nakama=970547373533.dkr.ecr.us-east-1.amazonaws.com/intelliverse-nakama@sha256:d2928ce4c2c7b4eaf4153b377bd09b6ddc4bea5eeb4d3ed9eb427076d8cdb5a5 \
  -n aicart
kubectl rollout status deploy/intelliverse-nakama -n aicart --timeout=2m
```

After this PR lands on master and the pipeline runs, the new build will
land a healthy image and CI will gate-test it before declaring success.

---

## Fixes shipped in this PR (all in this repo)

| Tag | What | Where |
|-----|------|-------|
| **CB-1** | Resolved the conflict block in `legacy_runtime.js` (HEAD wins — keeps `quizverseFindFriends` deleted so it doesn't hoist-shadow the real impl in `friends/find_friends.js`). Regenerated `data/modules/index.js` via `node postbuild.js`. | `data/modules/legacy_runtime.js`, `data/modules/index.js` |
| **CB-2** | `.gitattributes` marks `data/modules/index.js` and `build/index.js` `linguist-generated=true` and binds them to a custom merge driver (`scripts/git-merge-regen-index.sh`) that re-runs `postbuild.js` instead of attempting a 77 000-line text merge. Pre-commit hook (`scripts/pre-commit-modules-syntax.sh`) blocks any commit that has `<<<<<<<` markers under `data/modules/` or that produces unparseable JS. Both wired by `scripts/setup-hooks.sh`. | `.gitattributes`, `scripts/git-merge-regen-index.sh`, `scripts/pre-commit-modules-syntax.sh`, `scripts/setup-hooks.sh` |
| **CB-3** | `Dockerfile.production` modules stage now runs `npx tsc && node postbuild.js && node -c index.js` *without* `\|\| true`. A failure in any step now fails the image build. | `Dockerfile.production` |
| **CB-4** | Same stage split into two COPY layers: `package*.json + tsconfig*.json` first (so `npm ci` is cached on dep-only changes), then the rest of `data/modules/`. Layer cache helps speed without ever skipping `tsc + postbuild`. | `Dockerfile.production` |
| **CB-5** | Removed dead `data/runtime/index.js` (Apr-15 stale snapshot, off the runtime path, but confused triage). | `data/runtime/` |
| **CB-6** | `scripts/smoke-test-js-runtime.sh` boots Nakama and asserts: (a) boot logs free of `Could not compile JavaScript module` / `Failed to load JavaScript files`, (b) the new `nakama_js_health` RPC returns `ok:true`, (c) a known production RPC (`wallet_get_all`) is registered (any HTTP code other than 404). Two modes: `image <ref>` (used pre-push in CI) and `cluster <ns> <deploy>` (used post-rollout). | `scripts/smoke-test-js-runtime.sh` |
| **CB-7** | `_tsRpcList` literal in `src/main.ts` deleted. `postbuild.js` now extracts the set of TS-owned RPC IDs straight from the compiled `build/index.js` and emits it as `var __TS_OWNED_RPCS = {...}` ahead of the legacy bridge. The bridge reads the global at runtime. The set cannot drift when a TS RPC is added/renamed. | `data/modules/postbuild.js`, `data/modules/src/main.ts` |
| **EKS-1** | `JsRuntimeHealth.register()` ships `nakama_js_health` — registered as the *first* RPC in `InitModule` so it's available even if every later subsystem trips. The k8s deployment manifest must be updated to call it (see [Deployment manifest diff](#deployment-manifest-diff-required-in-intelli-verse-kube-infra) below). | `data/modules/src/shared/health.ts`, `data/modules/src/main.ts` |
| **EKS-2** | `buildspec.yml` `post_build` captures the previous image, rolls forward, and on smoke-test failure runs `kubectl set image … <previous>` (or falls back to `kubectl rollout undo`). Build is then marked `FAILED` so the pipeline stops at this commit. | `buildspec.yml` |
| **EKS-3** | `buildspec.yml` runs `scripts/smoke-test-js-runtime.sh image …` *before* pushing to ECR, and `… cluster …` *after* `kubectl set image`. Both must pass for the build to succeed. | `buildspec.yml` |
| **EKS-4** | Tracked separately as a follow-up — see [Follow-ups](#follow-ups-not-blocking). | (none in this PR) |

Pre-existing TS error fixed as collateral (`creator-event-live.ts`
passed `1, 0` to `nk.leaderboardCreate(sortOrder, operator)` — replaced
with `nkruntime.SortOrder.DESCENDING, nkruntime.Operator.BEST`). Without
this fix the new `npx tsc` step in `Dockerfile.production` would have
failed the build.

## Deployment manifest diff (required in `intelli-verse-kube-infra`)

EKS-1 needs the deployment manifest to actually call `nakama_js_health`
from the liveness probe. The probe RPC is registered by the JS runtime
itself, so a healthy probe → JS runtime is healthy → game RPCs work.
A failing probe → k8s marks the pod NotReady → traffic stops, and the
auto-rollback in `buildspec.yml` kicks in.

```yaml
# intelli-verse-kube-infra/nakama/deployment.yaml
spec:
  template:
    spec:
      containers:
        - name: intelliverse-nakama
          # ... unchanged ...
          # Was: httpGet /healthcheck (Nakama HTTP liveness, returns 200
          #      even when JS runtime failed to compile — the cbeacf6
          #      outage went undetected because of this).
          # Now: exec curl against nakama_js_health, which only exists if
          #      the JS runtime compiled and InitModule ran successfully.
          livenessProbe:
            exec:
              command:
                - /bin/sh
                - -c
                - >
                  curl -fsS -X POST
                  -H "Content-Type: application/json"
                  -d '{}'
                  "http://127.0.0.1:7350/v2/rpc/nakama_js_health?http_key=${HTTP_KEY}"
                  > /dev/null
            initialDelaySeconds: 30   # Goja init takes ~5-15s on cold start
            periodSeconds: 30
            timeoutSeconds: 5
            failureThreshold: 3
          readinessProbe:
            exec:
              command:
                - /bin/sh
                - -c
                - >
                  curl -fsS -X POST
                  -H "Content-Type: application/json"
                  -d '{}'
                  "http://127.0.0.1:7350/v2/rpc/nakama_js_health?http_key=${HTTP_KEY}"
                  > /dev/null
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 2
          env:
            # Read http_key from the same nakama-secret config.yaml so we
            # don't have to keep two copies in sync. Use a downwardAPI /
            # secretKeyRef so it's not in the manifest plaintext.
            - name: HTTP_KEY
              valueFrom:
                secretKeyRef:
                  name: nakama-secret
                  key: http_key
  # Keep enough revisions that auto-rollback always has a target:
  revisionHistoryLimit: 10
```

Until the kube-infra PR lands, the buildspec deploy gate (`smoke-test
cluster` step) still detects the failure mode and triggers rollback —
so the system is safe even with the old `httpGet /healthcheck` probe.
The probe change is defence-in-depth.

## Follow-ups (not blocking)

* **EKS-4** Replace `AdministratorAccess` on `codebuild-role` with
  least-privilege:
  - ECR: `Get*`, `BatchGet*`, `BatchCheckLayerAvailability`, `PutImage`,
    `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload` on
    `arn:aws:ecr:us-east-1:970547373533:repository/intelliverse-nakama`.
  - EKS: `eks:DescribeCluster` on
    `arn:aws:eks:us-east-1:970547373533:cluster/ai-cart-auto-cluster`
    (read-only kubeconfig fetch).
  - Replace `AmazonEKSClusterAdminPolicy` with an EKS access entry +
    `Role` in `aicart` granting only:
    `get,patch` on `deployments/intelliverse-nakama` (for
    `kubectl set image` and `kubectl rollout undo`),
    `get` on `pods` (for `kubectl rollout status` + the smoke-test pod
    selection),
    `create,get` on `pods/exec` (for the in-pod curl in
    `smoke-test-js-runtime.sh cluster`),
    `get` on `secrets/nakama-secret` (for the http_key fetch).
  Nothing in this PR depends on it; same blast-radius problem the
  `CUTOVER.md` already flagged.

* Fold the dev `Dockerfile`'s `node -c index.js` step (line 92) into a
  shared `scripts/build-modules.sh` so the dev and prod paths can't
  drift again. Currently both paths re-implement the same gate.

* Make the postbuild `__TS_OWNED_RPCS` extraction also dump
  `data/modules/build/ts-rpcs.json` so reviewers can diff the set of
  TS-owned RPCs in PRs without scrolling through a 3 MB merged bundle.
