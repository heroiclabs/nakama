# Production-Readiness Requirements (Game Backend Focus)

Date: January 31, 2026

## 1) Data model ownership

Define clear domain ownership:

- Auth: identity service (session + external IDP)
- Player profiles: profile service
- Economy: wallet + ledger service
- Inventory: inventory service
- Progression: XP, levels, achievements
- Matchmaking: matchmaker + match state
- Social: friends, groups, chat

Each domain should own its collections and schemas.

## 2) Schema discipline

- Every storage object has `schemaVersion`.
- All RPCs return a consistent envelope: `{ success, data, error, errorCode, traceId }`.
- Migrations are explicit and versioned.

Base DB schema for context:
- [migrate/sql/20180103142001_initial_schema.sql](migrate/sql/20180103142001_initial_schema.sql#L1)

## 3) Stateless, scalable logic

- Do not store mutable state in memory for core gameplay.
- Use storage for authoritative state.
- Use cache for hot reads only.

## 4) Observability

- Structured logs with correlation IDs (per request).
- Metrics per RPC: latency, error rate, DB calls, cache hit rate.
- Tracing for multi-step workflows.

## 5) Error handling and retries

- Use typed error codes.
- Retry external APIs with exponential backoff + circuit breaker.
- Fail fast on invalid payloads.

## 6) Config and environment separation

- Separate configs for dev/staging/prod.
- Avoid runtime logic that depends on environment-specific hardcoded values.
- Use environment variables + config files with validation.

## 7) Security

- Validate all inputs.
- Never trust client-side computed values (currency, rewards, rank, inventory).
- Ensure storage permissions are correct.

## 8) Performance

- Batch storage reads/writes.
- Keep payloads small and avoid large lists.
- Cache frequently accessed data.
- Use time-windowed leaderboards instead of unbounded ones.

## 9) Safe migrations and versioning

- Migrations should be backward compatible where possible.
- Introduce new versions before removing old versions.
- Keep a migration playbook.
