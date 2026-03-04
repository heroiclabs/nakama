# Game Backend Best Practices (Unity-Friendly)

Date: January 31, 2026

## 1) Think server-authoritative

Unity instinct: “Let the client calculate and send results.”
Backend reality: the client is untrusted.

Rule: The server calculates final rewards, scores, inventory, and progression.

## 2) Use idempotency

Players will retry requests. Your backend should tolerate it:
- If a purchase or reward RPC is called twice, it should not double grant.

## 3) Separate read vs write paths

Reads:
- Cache where possible.
- Allow eventual consistency if UX allows.

Writes:
- Keep them small and validated.
- Use transactions where required.

## 4) Use explicit error codes

Clients should act on structured errors:
- AUTH_REQUIRED
- INVALID_PAYLOAD
- RATE_LIMITED
- INTERNAL_ERROR

## 5) Keep contracts stable

- Version RPCs when changing payload shape.
- Avoid breaking changes without a migration period.

## 6) Prefer server-side orchestration

Unity should request “Give me daily rewards status” rather than compute it.

## 7) Avoid overloading storage

- Use time-limited leaderboards instead of storing every score forever.
- Use analytics events for long-term insights, not storage.

## 8) Observability is not optional

If you cannot observe it, you cannot scale it.

## 9) Rate limit at the edge

Rate limit spammy endpoints:
- chat
- friend requests
- matchmaking

## 10) Keep business logic modular

Avoid a single massive script. Modular runtime code reduces risk and improves onboarding.
