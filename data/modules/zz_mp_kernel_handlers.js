// ===========================================================================
//  Top-level (global-scope) match handlers for the IVX Multiplayer Kernel
// ---------------------------------------------------------------------------
//  WHY THIS FILE EXISTS
//
//  Nakama's Goja runtime extracts match-handler functions by walking the AST
//  of InitModule's body for `initializer.registerMatch(name, obj)` calls. For
//  each of the seven handler properties the walker requires the *value* to be
//  an Identifier that resolves to a function on the global object (passes
//  checkFnScope at server/runtime_javascript_init.go:1899). It also only sees
//  registerMatch calls that are DIRECT statements in InitModule's body — never
//  calls nested inside helper/namespace functions
//  (getMatchHookFnIdentifier @ runtime_javascript_init.go:1828).
//
//  The kernel previously registered templates via
//  `initializer.registerMatch(template.templateId, makeHandler(template))`
//  buried inside MpKernelMatch.registerTemplate() — a nested call passing a
//  factory-built object literal. The walker can't reach it and can't extract
//  inlined function expressions, so EVERY template failed to mount with
//  "js match handler \"matchInit\" ... global id could not be extracted:
//  not found", and mp_create_match / quizverse_create_match 500'd because
//  nk.matchCreate() had no registered handler to spin up.
//
//  Fix (mirrors the notif_scheduler_v1 pattern, PRs #102–#105):
//   1. Declare thin top-level wrappers here (this file is concatenated at
//      global scope by postbuild.js's module-discovery loop), delegating to
//      the real bodies in MpKernelMatch.*Impl.
//   2. postbuild.js section 5b injects DIRECT registerMatch calls into the
//      generated InitModule wrapper, referencing these wrappers by name.
//
//  matchInit is per-template (the match name IS the templateId, hard-coded in
//  each init wrapper); the other six hooks read the resolved template back off
//  kernel state, so a single shared wrapper each is enough.
//
//  Filename prefix `zz_` keeps this appended late by discoverModuleFiles, but
//  it doesn't matter for correctness: every function here is only CALLED at
//  match runtime, long after all namespace IIFEs (MpKernelMatch, MpKernelModule,
//  the template namespaces, QuizVersePlugin, QuizVerseGame/Generator) have
//  evaluated on the hosting (pooled) VM.
// ===========================================================================

// --- Lazy, idempotent generator bootstrap -----------------------------------
//
// Generators live in per-template registries populated by register()/mount(),
// which only run on the InitModule VM. Match handlers run on pooled VMs that
// never call InitModule, so without this the generator map is empty at
// matchInit → SyncTurn ends the match immediately with "no_generator".
// We register them on first matchInit on each VM, when `nk` is available and
// every namespace has evaluated. Guarded so it runs at most once per VM.
var __mpKernelGeneratorsReady = false;
function mpKernelEnsureGenerators(nk, logger) {
  if (__mpKernelGeneratorsReady) return;
  try { MpKernelModule.registerBuiltinGenerators(); } catch (e) {
    try { logger.warn("[MpKernel] builtin generator bootstrap failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
  }
  try { QuizVersePlugin.registerGenerators(nk); } catch (e) {
    try { logger.warn("[MpKernel] quizverse generator bootstrap failed: " + (e && e.message ? e.message : String(e))); } catch (_) {}
  }
  __mpKernelGeneratorsReady = true;
}

// --- Shared lifecycle hooks (template resolved from kernel state) ------------
function mpKernelMatchJoinAttempt(ctx, logger, nk, dispatcher, tick, state, presence, metadata) {
  return MpKernelMatch.matchJoinAttemptImpl(ctx, logger, nk, dispatcher, tick, state, presence, metadata);
}
function mpKernelMatchJoin(ctx, logger, nk, dispatcher, tick, state, presences) {
  return MpKernelMatch.matchJoinImpl(ctx, logger, nk, dispatcher, tick, state, presences);
}
function mpKernelMatchLeave(ctx, logger, nk, dispatcher, tick, state, presences) {
  return MpKernelMatch.matchLeaveImpl(ctx, logger, nk, dispatcher, tick, state, presences);
}
function mpKernelMatchLoop(ctx, logger, nk, dispatcher, tick, state, messages) {
  return MpKernelMatch.matchLoopImpl(ctx, logger, nk, dispatcher, tick, state, messages);
}
function mpKernelMatchTerminate(ctx, logger, nk, dispatcher, tick, state, graceSeconds) {
  return MpKernelMatch.matchTerminateImpl(ctx, logger, nk, dispatcher, tick, state, graceSeconds);
}
function mpKernelMatchSignal(ctx, logger, nk, dispatcher, tick, state, data) {
  return MpKernelMatch.matchSignalImpl(ctx, logger, nk, dispatcher, tick, state, data);
}

// --- Per-template matchInit wrappers (hard-coded templateId) -----------------
// Each ensures generators are registered on this VM, then delegates to the
// generic kernel init with its literal template id.
function mpSyncTurnMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("sync-turn-v1", ctx, logger, nk, params);
}
function mpAsyncTurnMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("async-turn-v1", ctx, logger, nk, params);
}
function mpLobbyHandoffMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("lobby-handoff-v1", ctx, logger, nk, params);
}
function mpTournamentMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("tournament-v1", ctx, logger, nk, params);
}
function mpLiveEventMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("live-event-v1", ctx, logger, nk, params);
}
function mpPersistentPartyMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("persistent-party-v1", ctx, logger, nk, params);
}
function mpConversationalPartyMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("conversational-party-v1", ctx, logger, nk, params);
}
function mpMrAnchorMatchInit(ctx, logger, nk, params) {
  mpKernelEnsureGenerators(nk, logger);
  return MpKernelMatch.matchInitImpl("mixed-reality-anchor-v1", ctx, logger, nk, params);
}
