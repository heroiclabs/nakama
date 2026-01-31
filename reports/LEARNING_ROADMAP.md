# Learning Roadmap (Unity Developer → Backend/Game Infrastructure Engineer)

Date: January 31, 2026

## Phase 1 — Backend fundamentals (2–4 weeks)

- HTTP/gRPC basics, stateless servers
- Authentication and session management
- Database fundamentals (SQL, indexes, migrations)
- JSON data modeling and schema versioning

Practice task:
- Build a small RPC that reads/writes to storage and returns a response.

## Phase 2 — Game backend patterns (4–6 weeks)

- Authoritative server design
- Matchmaking patterns
- Leaderboards and seasonal resets
- Economy and wallet ledger design

Practice task:
- Implement a wallet ledger with idempotent transactions.

## Phase 3 — Distributed systems and scaling (6–10 weeks)

- Caching strategies
- Rate limiting and throttling
- Observability (logs, metrics, tracing)
- Resilience and retries

Practice task:
- Add metrics + structured logging for a critical RPC.

## Phase 4 — Clean architecture and DDD (6–10 weeks)

- Domain-driven design
- Separating application vs infrastructure concerns
- Designing stable API contracts

Practice task:
- Refactor one domain into a clean module with schemas and tests.

## Phase 5 — Production readiness (ongoing)

- Staging/production separation
- Disaster recovery and backups
- Monitoring and alerting

Practice task:
- Create a release checklist and production runbook.

## Recommended mindset shifts

- You are building a system that must be correct under adversarial input.
- You are building for scale and long-term maintenance, not just feature shipping.
- The server is the game’s source of truth; clients are view layers.
