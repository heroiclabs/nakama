# Architecture Review (Current State)

Date: January 31, 2026

## 1) What is already strong and industry-worthy

### Core server platform
- Uses Nakama’s battle-tested Go server for auth, realtime, storage, leaderboards, and social systems.
- Proper separation between transport (HTTP/gRPC/WebSocket) and business logic.
- Standard schema and migrations are aligned with Nakama’s production patterns.

Key references:
- API server: [server/api.go](server/api.go#L1)
- RPC handler: [server/api_rpc.go](server/api_rpc.go#L1)
- Base schema: [migrate/sql/20180103142001_initial_schema.sql](migrate/sql/20180103142001_initial_schema.sql#L1)

### Multi-game focus
- Consistent use of gameId/gameUUID patterns across RPCs.
- Game registry synchronization from external API.
- Time-period leaderboards by game.

### Feature breadth
- Wallets, social, leaderboards, daily rewards, daily missions, quiz results, push notifications.
- This breadth makes it a strong platform foundation for multiple games.

## 2) What is fragile or tightly coupled

### Monolithic runtime module
- The main JS runtime logic is consolidated into one massive file:
  [data/modules/index.js](data/modules/index.js#L1)
- This creates tight coupling, low clarity, and high regression risk.
- Limits testability and makes onboarding difficult.

### Weak modular boundaries
- Cross-cutting concerns (logging, validation, storage access) are duplicated and interleaved.
- There is no clear “domain ownership” in code. Example: wallets, inventory, and progression logic are mixed.

### Configuration coupling
- Logic assumes certain environment variables or external APIs are always present.
- External game registry is invoked during startup without backoff strategy.

### Mixed naming conventions
- RPC naming is inconsistent: some use `rpc_` prefixes and some are verb-based.
- Makes client integration error-prone over time.

## 3) What is missing for real production use

### Observability
- No explicit tracing correlation in runtime code.
- Metrics are present in Nakama core, but runtime-level metrics are not standardized.

### Environment separation
- No clear module-level separation of dev/staging/prod configs.
- Feature flags and rollout strategies are not clearly modeled.

### Data modeling discipline
- Storage objects are flexible JSON; without a strong schema contract, drift can occur.
- No strict versioning strategy for payloads and storage models.

### Resilience and retries
- External API calls (game registry, push providers) lack clear retry/backoff policy.
- Error handling is sometimes generic and non-actionable.

## 4) Where technical debt will appear

1) Growth in the monolithic JS file will slow changes and increase bug risk.
2) Lack of runtime tests will lead to fragile behavior under load.
3) Schema evolution without a storage versioning strategy will cause data migration pain.
4) Inconsistent RPC naming will cause client-side integration drift across Unity/Unreal/Web.

## 5) Summary

The current architecture is functional and feature-rich, but it is at risk of becoming unmaintainable as more games and engineers are added. The core Nakama platform is solid, but the game-specific runtime layer needs modularization, domain ownership, and better operational discipline to scale.
