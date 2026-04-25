# Nakama Admin Dashboard — EKS deployment

Serve the React admin console and its server-side admin proxy behind the
existing `nakama-rest.intelli-verse-x.ai` ALB at `/admin-dashboard/`.

The proxy is required for production: the browser sends only the admin bearer
token, while `NAKAMA_HTTP_KEY` and optional Nakama console credentials stay in
Kubernetes secrets and are injected server-side.

## Layout

| File                | Purpose                                                                              |
|---------------------|--------------------------------------------------------------------------------------|
| `deployment.yaml`   | Node static/proxy Deployment, 2 replicas                                            |
| `service.yaml`      | ClusterIP Service `nakama-admin-dashboard:80 -> :8080`                               |
| `kustomization.yaml`| Bundles the Deployment and Service                                                   |
| `ingress-patch.yaml`| RFC 6902 JSON Patch: appends the `/admin-dashboard` rule to the existing Ingress     |
| `apply.sh`          | One-shot deployer: kustomize apply + ingress patch + cluster-side smoke test         |

## Deploy

```bash
# Make sure your kube-context points at the EKS prod cluster
kubectl config current-context
# expected: arn:aws:eks:us-east-1:<acct>:cluster/ai-cart-auto-cluster

cd deploy/admin-dashboard
./apply.sh
```

Before running this script, build and push the admin image from
`web/packages/admin` after `pnpm --filter @nakama/admin build`.

The script:

1. Runs `kubectl kustomize .`.
2. Pipes to `kubectl apply --server-side --force-conflicts -f -`.
3. Waits for the Deployment rollout to converge.
4. Patches the existing `intelliverse-user-frontend` Ingress in `aicart` with
   the JSON Patch in `ingress-patch.yaml` (idempotent — script verifies the
   target host index and skips the patch if the rule already exists).
5. Port-forwards the new Service and curls `/healthz` + `/admin-dashboard/`
   from inside the cluster as a smoke test.

## Verifying production

```bash
# Should be HTTP 200 and serve the login-gated React app
curl -sSI https://nakama-rest.intelli-verse-x.ai/admin-dashboard/

# Should 301 → https://nakama-rest.intelli-verse-x.ai/admin-dashboard/
curl -sSI https://nakama-rest.intelli-verse-x.ai/admin-dashboard
```
