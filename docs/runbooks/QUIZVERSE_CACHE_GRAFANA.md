# QuizVerse Question Cache — Grafana / Loki Observability

Nakama emits JSON log lines to stdout (Promtail / Fluent Bit → Loki). Cache pipeline logs use flat `key=value` tokens in `msg`, with a stable `event=` field for alerts and dashboards.

Adjust `{app="nakama"}` / `{container="intelliverse-nakama"}` to match your Loki label set.

## Log catalogue

| `event` | Level | Tag prefix | When |
|---------|-------|------------|------|
| `cache_miss` | warn | `[QvGetQ][GATE:cache_miss]` | Empty pool before inline refresh |
| `cache_refresh` | info | `[QvGetQ][DEBUG:cache_refresh]` | After `refreshCache` on miss |
| `cache_recovered` | info | `[QvGetQ][GATE:cache_recovered]` | Re-read found questions |
| `cache_empty` | warn | `[QvGetQ][GATE:cache_empty]` | Still empty after refresh |
| `cold_start_blocked` | error | `[QvGetQ][COLD_START_BLOCKED]` | Cold-start user blocked |
| `cache_refresh_tick_start` | info | `[QvCacheRefresh][tick_start]` | Cron RPC start |
| `cache_refresh_topic` | info | `[QvCacheRefresh][topic_result]` | Per-topic cron result |
| `cache_refresh_tick_done` | info | `[QvCacheRefresh][tick_done]` | Cron complete |
| `provider_cache_miss` | info | `[QvQCache/…]` | Storage miss in `readCache` |
| `provider_fetch_start` | info | `[QvQCache/…]` | Provider HTTP fetch begins |
| `provider_refresh_done` | info | `[QvQCache/…]` | Refresh stored N questions |
| `provider_refresh_failed` | error | `[QvQCache/…]` | Refresh failed |
| `provider_refresh_gated` | info | `[QvQCache/…]` | Per-topic 30s gate skipped duplicate fetch |
| `circuit_open` | warn | `[QvQCache/…]` | Circuit breaker open for provider |

## LogQL queries

### All question-cache failures (last 1h)

```logql
{app="nakama"} | json | rpc_id="quizverse_get_questions" | msg =~ `event=cache_empty|event=cold_start_blocked`
```

### Cache miss → refresh funnel for a topic

```logql
{app="nakama"} | json | msg =~ `topic=anime` | msg =~ `event=cache_miss|event=cache_refresh|event=cache_recovered|event=cache_empty|event=provider_`
```

### Trace one request end-to-end

Use `trace_id` from the Nakama JSON log line:

```logql
{app="nakama"} | json | trace_id="fecd2a9c-a9f9-47c5-a403-35944bf3f7c6"
```

### Rate of `cache_empty` by topic (5m windows)

```logql
sum by (topic) (
  count_over_time(
    {app="nakama"} | json | msg =~ `event=cache_empty` | regexp `topic=(?P<topic>[a-z0-9_]+)` [5m]
  )
)
```

### Cold-start onboarding blocked

```logql
{app="nakama"} | json | msg =~ `event=cold_start_blocked`
```

### Cron refresh health

```logql
{app="nakama"} | json | msg =~ `event=cache_refresh_tick_done|event=cache_refresh_topic`
```

### Provider / circuit breaker issues

```logql
{app="nakama"} | json | msg =~ `event=provider_refresh_failed|event=circuit_open`
```

### Combined cache pipeline panel (raw logs)

```logql
{app="nakama"} | json | rpc_id="quizverse_get_questions" | msg =~ "QvGetQ|QvQCache|QvCacheRefresh"
```

## Recommended alert rules

| Alert name | LogQL / condition | Severity | Action |
|------------|-------------------|----------|--------|
| `QvColdStartBlocked` | `count_over_time({app="nakama"} \| json \| msg =~ \`event=cold_start_blocked\` [5m]) > 0` | critical | Page on-call; run `quizverse_cache_refresh_tick` `{ "mode": "cold_start" }` |
| `QvCacheEmptySpike` | `sum(count_over_time({app="nakama"} \| json \| msg =~ \`event=cache_empty\` [15m])) > 10` | warning | Check Jikan/circuit; verify bootstrap cron |
| `QvProviderRefreshFailed` | `count_over_time({app="nakama"} \| json \| msg =~ \`event=provider_refresh_failed\` [10m]) > 3` | warning | Inspect provider + `quizverse_admin_stats` circuits |
| `QvCacheRefreshCronFailed` | `cache_refresh_tick_done` with `failed > 0` in msg | warning | Re-run manual topic refresh |

## Suggested dashboard panels

1. **Time series** — `cache_empty` rate by `topic` (LogQL count above)
2. **Time series** — `cache_recovered` vs `cache_miss` (healthy ratio)
3. **Stat** — `cold_start_blocked` count last 24h (should be 0)
4. **Logs panel** — combined pipeline query with `trace_id` click-through
5. **Stat** — last `cache_refresh_tick_done` `succeeded/failed` from cron logs

## Local dev (before Grafana)

```powershell
docker compose logs nakama | Select-String "event=cache_|QvGetQ|QvQCache|QvCacheRefresh"
```

## Ops RPCs

| RPC | Payload | Purpose |
|-----|---------|---------|
| `quizverse_cache_refresh_tick` | `{ "mode": "cold_start" }` | Post-deploy bootstrap (anime, pokemon, movies) |
| `quizverse_cache_refresh_tick` | `{ "mode": "all" }` | Full refresh (6h global gate) |
| `quizverse_cache_refresh_tick` | `{ "mode": "topic", "topic": "anime" }` | Single-topic refresh |

Auth: admin session or server-to-server `http_key` (`RpcHelpers.requireAdmin`).

Prometheus (`:9100`) covers Nakama runtime metrics, not these business events — use Loki for cache pipeline observability.
