// ===========================================================================
//  Top-level (global-scope) match handlers for notif_scheduler_v1
// ---------------------------------------------------------------------------
//  Nakama's Goja runtime extracts match handler functions by walking the AST
//  of InitModule's body and looking for `initializer.registerMatch(name, obj)`
//  call expressions. For each handler property, the walker requires the
//  *value* to be an Identifier referring to a function declared at the
//  script's TOP LEVEL (so it lives on r.GlobalObject() and passes
//  checkFnScope at server/runtime_javascript_init.go @ 1899).
//
//  Function declarations inside a TypeScript `namespace { ... }` IIFE are
//  scoped to that IIFE and never reach the global object — they're
//  inaccessible to checkFnScope. Inline function expressions inside the
//  object literal are rejected outright by the walker (errInlinedFunction
//  at server/runtime_javascript_init.go @ 1877).
//
//  We satisfy both rules by declaring 7 thin top-level wrappers in this file
//  (this file is concatenated at global scope by postbuild.js's module
//  discovery loop) that delegate to the implementations exported from
//  `src/legacy/notification_scheduler.ts`. postbuild.js section 5b then
//  injects a direct registerMatch call into the generated InitModule
//  wrapper, referencing these wrappers by name.
//
//  Filename prefix `zz_` is intentional: discoverModuleFiles in postbuild.js
//  walks directories in `readdirSync` order, so the alphabetic suffix
//  guarantees this file is appended AFTER every other module — which keeps
//  `LegacyNotifScheduler` (declared in build/index.js's TS bundle, appended
//  even later) accessible at call time but is also defensible against
//  re-orderings.
// ===========================================================================

function notifSchedulerMatchInit(ctx, logger, nk, params) {
  return LegacyNotifScheduler.matchInitImpl(ctx, logger, nk, params);
}

function notifSchedulerMatchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  return LegacyNotifScheduler.matchJoinAttemptImpl(ctx, logger, nk, dispatcher, tick, state, presence, metadata);
}

function notifSchedulerMatchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  return LegacyNotifScheduler.matchJoinImpl(ctx, logger, nk, dispatcher, tick, state, presences);
}

function notifSchedulerMatchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  return LegacyNotifScheduler.matchLeaveImpl(ctx, logger, nk, dispatcher, tick, state, presences);
}

function notifSchedulerMatchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  return LegacyNotifScheduler.matchLoopImpl(ctx, logger, nk, dispatcher, tick, state, messages);
}

function notifSchedulerMatchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return LegacyNotifScheduler.matchSignalImpl(ctx, logger, nk, dispatcher, tick, state, data);
}

function notifSchedulerMatchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return LegacyNotifScheduler.matchTerminateImpl(ctx, logger, nk, dispatcher, tick, state, graceSeconds);
}
