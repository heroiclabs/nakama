// ===========================================================================
//  Top-level (global-scope) realtime hook wrappers for ChannelMessageSend
// ---------------------------------------------------------------------------
//  WHY THIS FILE EXISTS
//
//  Nakama's Goja runtime extracts rt-hook functions by walking the AST of
//  InitModule's body for `initializer.registerRtBefore/After(name, fn)`
//  calls (getRtHookFnIdentifier @ server/runtime_javascript_init.go:1407).
//  Two rules:
//    (1) the call must be a direct statement in InitModule's body (or in a
//        try block within it) — calls nested inside helper functions like
//        LegacyChat.register() are invisible to the walker, and
//    (2) the function argument must be an Identifier that resolves on the
//        global object (checkFnScope @ runtime_javascript_init.go:1899) —
//        functions inside TS `namespace { ... }` IIFEs don't qualify.
//
//  The previous registration in LegacyChat.register() violated both rules,
//  so since it shipped (#293) every boot logged:
//    "[Legacy] Failed to register legacy RPCs: js realtime registerRtBefore
//     hook function key could not be extracted: not found"
//  and — because that throw escaped to main.ts's shared try/catch — it also
//  aborted the quests-economy bridge, multi-game, storage, analytics
//  retention, gift cards and coupons registrations that follow LegacyChat.
//
//  postbuild.js emits the registerRtBefore/After calls into its generated
//  InitModule wrapper (section 5b-bis), pointing at these global wrappers,
//  which delegate to the exported LegacyChat implementations. Same pattern
//  as zz_mp_kernel_handlers.js / zz_notif_scheduler_handlers.js.
//
//  The `zz_` prefix keeps this file last in postbuild's sorted module merge
//  order; delegation is lazy (at hook invocation time), so LegacyChat is
//  always defined by then.
// ===========================================================================

/**
 * Before-hook for realtime ChannelMessageSend. Forces persist=true (durable
 * history / offline delivery / unread counts) and applies chat hygiene
 * (length cap + rate limit). Throwing rejects the send.
 */
function rtBeforeChannelMessageSendHook(ctx, logger, nk, envelope) {
  if (typeof LegacyChat !== "undefined" && LegacyChat.beforeChannelMessageSend) {
    return LegacyChat.beforeChannelMessageSend(ctx, logger, nk, envelope);
  }
  return envelope;
}

/**
 * After-hook for realtime ChannelMessageSend. Sends push notifications /
 * offline queueing after the message lands.
 */
function rtAfterChannelMessageSendHook(ctx, logger, nk, output, input) {
  if (typeof LegacyChat !== "undefined" && LegacyChat.afterChannelMessageSend) {
    LegacyChat.afterChannelMessageSend(ctx, logger, nk, output, input);
  }
}
