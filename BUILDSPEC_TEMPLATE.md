# Buildspec Template — `intelli-verse-x` services

This repo is the **reference implementation** for AWS CodeBuild → ECR → EKS deploys across `intelli-verse-x` services. Use [`buildspec.template.yml`](./buildspec.template.yml) as the starting point for any new service or when modernizing an existing service's pipeline.

## Why this template exists

In April 2026 we audited the six in-tree buildspecs and found:

| Repo | Fail-fast | Digest-pinned | Notes |
| --- | :---: | :---: | --- |
| `nakama`                          | ✅ | ✅ | Reference (this repo) |
| `intelli-verse-x-MCP`             | ✅ * | ❌ | * after April 2026 hardening PR |
| `content-factory`                 | ✅ * | ❌ | * after [PR #13](https://github.com/intelli-verse-x/content-factory/pull/13) |
| `Intelliverse-X-User-Webfrontend` | ❓ | ❌ | Pending audit |
| `quests-economy`                  | ❓ | ❌ | Pending audit |
| `vibe-kanban-fork`                | ❓ | ❌ | Pending audit |

Only nakama was both **fail-fast** (no `|| echo` / `|| true` patterns in deploy commands; CodeBuild surfaces real failures) and **digest-pinned** (rollouts use `repo@sha256:...`, not a mutable tag).

The MCP and content-factory pipelines previously swallowed `aws eks update-kubeconfig` and `kubectl rollout` failures with `|| echo`, which let CodeBuild report `SUCCEEDED` while production stayed on stale images for weeks. See `intelli-verse-x-MCP/buildspec.yml` and the PR #13 history in `content-factory` for the post-mortem details.

## What the template gives you

1. **`set -euo pipefail`** at the top of every phase block. Any non-zero exit aborts the build; missing env vars abort; broken pipes propagate.
2. **Immutable tags** of the form `${APP_VERSION}-${git-sha7}-build${CODEBUILD_BUILD_NUMBER}`. Every artifact in ECR is forever uniquely addressable.
3. **Digest-pinned rollouts.** After `docker push`, the immutable `sha256` digest is resolved from ECR with `aws ecr describe-images`, and `kubectl set image` uses `${REPOSITORY_URI}@${IMAGE_DIGEST}` — never the tag. This makes the deploy immune to tag races and to anyone re-tagging `:latest` from outside CI.
4. **Post-deploy verification.** The live image and pod state are printed; `image-manifest.json` is captured as a build artifact for audit and rollback.

## How to adopt for a new service

```bash
cp buildspec.template.yml ../<service>/buildspec.yml
cd ../<service>
# Edit the env block to set:
#   K8S_DEPLOYMENT, K8S_CONTAINER, ECR_REPOSITORY, APP_VERSION, DOCKERFILE
# Everything else (region/account/cluster/namespace) stays as-is for the
# aicart cluster.
$EDITOR buildspec.yml
```

In the AWS CodeBuild project settings, do **not** mirror the env vars in the project — they are baked into the file so the buildspec is self-contained and reproducible.

### One-time IAM setup per service

The CodeBuild service role needs:

1. `eks:DescribeCluster` on `arn:aws:eks:${REGION}:${ACCOUNT}:cluster/${CLUSTER_NAME}` (inline policy is fine).
2. An EKS **Access Entry** for the role, associated with `AmazonEKSEditPolicy` scoped to the target namespace (`aicart`).

The MCP repo went through this exercise in April 2026; see its commit history for the exact JSON if you need a reference.

## How to migrate an existing service

```bash
diff buildspec.yml /path/to/nakama/buildspec.template.yml
```

Look specifically for:

- Any `|| echo "..."` or `|| true` after `aws` or `kubectl` commands → **delete them**. They are silent-failure bugs.
- Missing `set -euo pipefail` at the top of `pre_build` / `build` / `post_build` → **add it**.
- `kubectl rollout restart` instead of `kubectl set image deployment/... container=repo@sha256:...` → **switch to digest-pinned set-image**. `rollout restart` keeps using whatever image the deployment already references, which defeats the point of CI.
- Wrong cluster name (`aicart-cluster` is not real — the cluster is `ai-cart-auto-cluster`).

## Maintenance

Changes to the template should land here first, then propagate to consumer repos via copy. There is no automated sync — this is intentional, so each service can pin its build pipeline to a known-good version.

If you add a new section to the template, also add a corresponding row to the table at the top of this file once each consumer has been updated.
