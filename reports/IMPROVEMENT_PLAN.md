# Detailed Improvement Plan

Date: January 31, 2026

This is a staged plan to refactor the runtime and improve production readiness without breaking existing clients.

## Phase 0 — Stabilize and Document (1–2 weeks)

Goals: Improve clarity without changing behavior.

- Create domain docs for wallets, leaderboards, identity, matchmaking, social.
- Add consistent RPC naming conventions and document mapping for legacy RPCs.
- Add storage schema documentation per collection.
- Add runtime coding standards (error handling, logging, validation, metrics).

Deliverables:
- Documentation update.
- RPC registry index.
- Storage registry index.

## Phase 1 — Modularize Runtime (2–4 weeks)

Goals: Break monolith into domain modules without behavior change.

- Split [data/modules/index.js](data/modules/index.js#L1) into domain modules:
  - identity/
  - economy/
  - leaderboards/
  - progression/
  - social/
  - notifications/
  - matchmaking/
  - analytics/
- Replace direct calls with shared utilities (validation, storage, errors).
- Introduce a single module registry file to register all RPCs.

Deliverables:
- Modular file structure.
- Shared utilities package.
- Clear domain ownership per module.

## Phase 2 — Define Contracts + Versioning (2–3 weeks)

Goals: Prevent schema drift and client breakage.

- Define RPC request/response schema contracts.
- Introduce versioned payloads: `v1`, `v2` or `schemaVersion` per object.
- Add storage migrations for breaking changes.
- Add compatibility shims for legacy payloads.

Deliverables:
- JSON schema specs.
- Storage versioning strategy.
- Backward compatibility rules.

## Phase 3 — Observability and Resilience (2–4 weeks)

Goals: Production-grade monitoring and error handling.

- Standardized runtime logging with correlation IDs.
- Metrics per RPC (latency, error rate, storage ops).
- External API retries with exponential backoff.
- Add circuit breaker patterns for external services.

Deliverables:
- Observability baseline.
- Retry and error handling guidelines.

## Phase 4 — Performance and Scale (2–4 weeks)

Goals: Reduce DB load and optimize runtime.

- Introduce caching for hot reads (profiles, wallets, leaderboards).
- Batch storage calls where possible.
- Add rate limiting per user + per game.
- Introduce background jobs for heavy analytics.

Deliverables:
- Caching layer.
- Performance playbook.

## Phase 5 — Multi-Engine SDK Alignment (ongoing)

Goals: Keep Unity/Unreal/Web consistent.

- Create engine-agnostic RPC facade layer in backend.
- Provide SDK wrappers for Unity and Unreal.
- Enforce consistent payload shapes across engines.

Deliverables:
- Unified API contract.
- SDK client wrappers.
