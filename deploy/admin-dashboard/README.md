# Nakama Admin Analytics Dashboard — EKS deployment

Static-host the standalone analytics dashboard (`web/analytics-dashboard/index.html`)
behind the existing `nakama-rest.intelli-verse-x.ai` ALB, served at the
`/admin-dashboard/` path.

This is the short-term hosting strategy from
`Docs/analytics/ANALYTICS-AUDIT-2026-04-22.md` §11.7: keep the dashboard on the
same origin as the Nakama REST API so we avoid CORS, dedicated DNS, and a
separate TLS cert until we promote it to a long-term home (S3+CloudFront or
similar).

## Layout

| File                | Purpose                                                                              |
|---------------------|--------------------------------------------------------------------------------------|
| `deployment.yaml`   | Nginx (`nginxinc/nginx-unprivileged:1.27-alpine`) Deployment, 2 replicas             |
| `service.yaml`      | ClusterIP Service `nakama-admin-dashboard:80 -> :8080`                               |
| `nginx.conf`        | Server block: serves `/admin-dashboard/`, `/healthz`, forces relative redirects      |
| `kustomization.yaml`| Bundles `index.html` + `nginx.conf` into ConfigMaps with content-hash suffixes       |
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

The script:

1. Runs `kubectl kustomize --load-restrictor LoadRestrictionsNone .` (we need
   `LoadRestrictionsNone` because `index.html` lives outside this folder).
2. Pipes to `kubectl apply --server-side --force-conflicts -f -` (server-side
   apply avoids the 256 KB `last-applied-configuration` annotation limit that
   would otherwise reject the inlined HTML).
3. Waits for the Deployment rollout to converge.
4. Patches the existing `intelliverse-user-frontend` Ingress in `aicart` with
   the JSON Patch in `ingress-patch.yaml` (idempotent — script verifies the
   target host index and skips the patch if the rule already exists).
5. Port-forwards the new Service and curls `/healthz` + `/admin-dashboard/`
   from inside the cluster as a smoke test.

## How updates roll out

`configMapGenerator` appends a content hash to each ConfigMap name. Any change
to `web/analytics-dashboard/index.html` or `nginx.conf` produces new ConfigMap
names, kustomize rewrites the Deployment's volume references, and the Pods do
a normal rolling update. No manual `kubectl rollout restart` needed.

## Verifying production

```bash
# Should be HTTP 200 and serve index.html
curl -sSI https://nakama-rest.intelli-verse-x.ai/admin-dashboard/

# Should 301 → https://nakama-rest.intelli-verse-x.ai/admin-dashboard/
# (preserving https + host; absolute_redirect off in nginx.conf)
curl -sSI https://nakama-rest.intelli-verse-x.ai/admin-dashboard
```

## Long-term

Audit doc §11.7 recommends moving to S3 + CloudFront once we want CDN edge
caching, atomic immutable releases, and a less coupled blast radius. The
ConfigMap-based approach here is intentionally low-overhead so we can ship
today; treat it as the temporary path, not the final home.
