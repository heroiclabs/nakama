# Proposed Clean, Generic, Scalable Architecture

Date: January 31, 2026

## 1) Goals

- Modular, domain-driven runtime.
- Engine-agnostic API contracts.
- Clear ownership of auth, profile, economy, progression, matchmaking, social.
- Production-ready observability and scaling.

## 2) Proposed folder structure

Suggested runtime module layout:

```
/data/modules
  /core
    registry.js           # RPC registration only
    config.js             # config loader + environment guardrails
    logger.js             # structured logging helper
    errors.js             # standardized error factory
    validation.js         # payload validators
    permissions.js        # storage permission helpers
    storage.js            # storage helpers + versioning
    metrics.js            # runtime metrics helpers
  /domains
    /identity
      identity.rpc.js
      identity.storage.js
      identity.schema.js
    /profiles
      profiles.rpc.js
      profiles.storage.js
      profiles.schema.js
    /economy
      wallet.rpc.js
      wallet.ledger.js
      wallet.schema.js
    /inventory
      inventory.rpc.js
      inventory.storage.js
      inventory.schema.js
    /progression
      progression.rpc.js
      progression.storage.js
      progression.schema.js
    /leaderboards
      leaderboards.rpc.js
      leaderboards.jobs.js
      leaderboards.schema.js
    /social
      friends.rpc.js
      groups.rpc.js
      social.schema.js
    /matchmaking
      matchmaking.rpc.js
      matchmaking.match.js
      matchmaking.schema.js
    /notifications
      notifications.rpc.js
      push.providers.js
      notifications.schema.js
    /analytics
      analytics.rpc.js
      analytics.schema.js
  /legacy
    legacy.rpc.js          # compatibility wrappers
```

## 3) Naming conventions

- RPC names: verb_noun_v1 format (example: `wallet_get_balances_v1`).
- Storage keys: `<domain>:<entity>:<id>` style keys.
- Collections: plural nouns by domain (example: `wallets`, `inventories`).

## 4) Clean architecture boundaries

- Transport layer: Nakama API + runtime registration only.
- Application layer: domain RPCs and workflows.
- Domain layer: schemas, domain rules, invariants.
- Infrastructure: external APIs, caching, storage.

## 5) Example module structure (identity)

- identity.rpc.js: RPC entrypoints.
- identity.storage.js: data persistence.
- identity.schema.js: payload and storage schema.

RPCs should be thin coordinators:
- Validate → authorize → call domain service → persist → return.

## 6) Engine-agnostic facade

Introduce an API contract that is stable and independent of Unity or Unreal SDK specifics:

- Request and response JSON schemas.
- Stable error codes.
- Explicit versioning.

## 7) Why this is better

- Modules are isolated by domain.
- New engineers can onboard quickly.
- You can test modules in isolation.
- Easier to scale with more games and teams.

## 8) Migration plan

1) Build module registry while keeping old RPC names.
2) Move functions into domain files and re-export into registry.
3) Add `legacy` wrappers for old payloads.
4) Deprecate old RPCs gradually.
