# IVX Multiplayer Kernel — server-side

> Plan: `~/.cursor/plans/reframe_0b7c9794.plan.md` Pillars 2 + 8.

Game-agnostic, engine-agnostic match infrastructure on Nakama. Game
plugins (`nakama/data/modules/src/games/<game>/`) supply only their own
generators / scoring / payloads; the kernel handles connection,
presence, idempotency, clock authority, sequence-gap recovery, error
fan-out, match-result persistence, and AnalyticsAlerts wiring.

## Layout

```
multiplayer-kernel/
├── README.md
├── types.ts            # wire shapes (mirror schemas/multiplayer/*.proto)
├── error.ts            # canonical Error builders + send helper
├── clock.ts            # server clock authority + ClockSync emission
├── idempotency.ts      # client_opcode_uuid dedup ring (60 s window)
├── presence.ts         # presence + reconnect grace + flapping
├── code-registry.ts    # opcode-range overlap detection at boot
├── match-result.ts     # MatchResultEnvelope persistence + analytics
├── match-handler.ts    # nkruntime.MatchHandler factory wrapping IMatchTemplate
├── index.ts            # registration + RPCs (mp_create_match, etc.)
└── templates/
    └── sync-turn-match.ts   # P1 first template (turn_start/input/resolved)
```

## Mounting

Edit `data/modules/src/main.ts`:

```ts
try {
  MpKernelModule.register(initializer, logger);
  logger.info("[MpKernel] mounted");
} catch (err: any) {
  logger.error("[MpKernel] failed to mount: " + (err && err.message ? err.message : String(err)));
}
```

## RPCs exposed

| RPC ID                     | Caller                                       |
|----------------------------|----------------------------------------------|
| `mp_create_match`          | Any client adapter via `IIVXMultiplayer.createMatch` |
| `mp_read_match_result`     | Admin tooling, the SLO board, replay scrubber |
| `mp_list_templates`        | SDK adapter codegen + admin dashboard        |

`mp_create_match` payload (JSON):

```json
{
  "template_id": "sync-turn-v1",
  "game_id":     "quizverse",
  "region":      "us-east-1",
  "template_init": {
    "min_players": 2,
    "max_players": 5,
    "default_input_window_ms": 15000,
    "max_match_duration_ms": 1800000,
    "reconnect_grace_ms": 60000,
    "generator_id": "quizverse:classic"
  }
}
```

## Adding a new template

1. Define opcodes in a new `schemas/multiplayer/templates/<name>.proto`.
2. Pick a free reserved range (see `envelope.proto`).
3. Add `templates/<name>-match.ts` implementing `MpKernel.IMatchTemplate<TS>`.
4. In `index.ts` `register()`, call `MpKernelMatch.registerTemplate(...)`
   and `MpKernelModule.registerTemplateId("<name>-v1")`.
5. Re-run codegen so adapters get the new wire types.
6. Add a row to the conformance suite if you introduce new failure modes.

## Adding a game plugin

For sync-turn games, register a generator:

```ts
namespace QuizverseGame {
  export function bootstrap(_logger: nkruntime.Logger): void {
    MpKernelSyncTurn.registerGenerator({
      generatorId: "quizverse:classic",
      initBlob: function (init) { /* load quiz pack from storage */ return {/* … */}; },
      nextTurn: function (ctx) { /* emit next question */ return null /* or … */; },
      scoreSubmission: function (sub, correct, responseMs, base) { /* compute */ return base; },
      buildResolvedPayload: function (correct, verdicts, responseMs) { return { … }; }
    });
  }
}
```

Then wire `QuizverseGame.bootstrap(logger)` in `main.ts` after
`MpKernelModule.register(...)`.

## What the kernel guarantees (Pillar 8 invariants)

- Schema-version negotiation (Hello vs server min).
- Idempotent opcode tags (60 s rolling, per-(match, sender)).
- Reconnect grace per-template; flapping → soft-ban (FLAPPING).
- Server clock authority; client wall-clock skew > 30 s rejected.
- Sequence-gap > 32 → SEQ_GAP error + state-resync hook.
- Out-of-order tolerance (silent drop within window).
- Match-state hard-cap → STATE_OVERFLOW + force end + result persisted.
- Duration hard-cap → DURATION_EXCEEDED + force end + result persisted.
- Quorum lost → match end with `MatchEnded.Reason.QUORUM_LOST`.
- Per-template rate-limits (template responsibility; helpers in `error.ts`).
- All errors uniform via `MpKernelError.send(...)` (single audit shape).

## Conformance

`tools/conformance/conformance-suite.yaml` defines the 12 invariants
every adapter must satisfy. The kernel's matchHandler enforces each one;
the conformance harness exercises them via synthetic clients (P13).
