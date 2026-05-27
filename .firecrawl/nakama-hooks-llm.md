\# Hooks

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/server-framework/introduction/hooks/
\*\*Summary:\*\* Learn the basics of using Before and After hooks via the server runtime.
\*\*Keywords:\*\* rpc, hooks, beforehook, afterhook
\*\*Categories:\*\* nakama, hooks, introduction

\-\-\-

\# Hooks

All runtime code is evaluated at server startup and can be used to register functions called hooks.

You can register \[before hooks\](#before-hooks) to intercept and act on client messages, \[after hooks\](#after-hooks) to call a function after an event has been processed, and custom \[RPC hooks\](#rpc-hooks) which can be called by clients.

There are multiple ways to register a function within the runtime, each of which is used to handle specific behavior between client and server. For example:

{{< code type="server" >}}

\`\`\`lua
\-\- NOTE: Function arguments have been omitted in the example.

\-\- If you are sending requests to the server via the real-time connection, ensure that you use this variant of the function.
nk.register\_rt\_before()
nk.register\_rt\_after()

\-\- Otherwise use this.
nk.register\_req\_after()
nk.register\_req\_before()

\-\- If you'd like to run server code when the matchmaker has matched players together, register your function using the following.
nk.register\_matchmaker\_matched()

\-\- If you'd like to run server code when the leaderboard/tournament resets register your function using the following.
nk.register\_leaderboard\_reset()
nk.register\_tournament\_reset()

\-\- Similarly, you can run server code when the tournament ends.
nk.register\_tournament\_end()

\-\- If you'd like to run server code when the server receives a shutdown signal. The function is only invoked if config grace\_period\_sec > 0.
\-\- It won't be awaited to complete if it takes longer than grace\_period\_sec.
nk.register\_shutdown()
\`\`\`

{{< / code >}}

{{< code type="server" >}}

\`\`\`go
// NOTE: All Go runtime registrations must be made in the module's InitModule function.
// Function arguments have been omitted in the example.

// If you are sending requests to the server via the real-time connection, ensure that you use this variant of the function.
initializer.RegisterBeforeRt()
initializer.RegisterAfterRt()

// Otherwise use the relevant before / after hook, e.g.
initializer.RegisterBeforeAddFriends()
initializer.RegisterAfterAddFriends()
// (...)

// If you'd like to run server code when the matchmaker has matched players together, register your function using the following.
initializer.RegisterMatchmakerMatched()

// If you'd like to run server code when the leaderboard/tournament resets register your function using the following.
initializer.RegisterLeaderboardReset()
initializer.RegisterTournamentReset()

// If you'd like to run server code when the server receives a shutdown signal. The function is only invoked if config grace\_period\_sec > 0.
// It won't be awaited to complete if it takes longer than grace\_period\_sec.
initializer.RegisterShutdown()

// Similarly, you can run server code when the tournament ends.
initializer.RegisterTournamentEnd()
\`\`\`

{{< / code >}}

{{< code type="server" >}}

\`\`\`typescript
// NOTE: All JavaScript runtime registrations must be made in the bundle's InitModule function.
// Function arguments have been omitted in the example.

// If you are sending requests to the server via the real-time connection, ensure that you use this variant of the function.
initializer.registerRtBefore();
initializer.registerRtAfter();

// Otherwise use the relevant before / after hook, e.g.
initializer.registerBeforeAddFriends();
initializer.registerAfterAddFriends();
// (...)

// If you'd like to run server code when the matchmaker has matched players together, register your function using the following.
initializer.registerMatchmakerMatched();

// If you'd like to run server code when the leaderboard/tournament resets register your function using the following.
initializer.registerLeaderboardReset();
initializer.registerTournamentReset();

// Similarly, you can run server code when the tournament ends.
initializer.registerTournamentEnd();

// If you'd like to run server code when the server receives a shutdown signal. The function is only invoked if config grace\_period\_sec > 0.
// It won't be awaited to complete if it takes longer than grace\_period\_sec.
initializer.registerShutdown();
\`\`\`

{{< / code >}}

\## Message names

Provided here is a full list of server messages that can benefit from hooks.

{{< note "important" >}}
If your runtime code is in Go, refer to \[the interface definition\](https://github.com/heroiclabs/nakama/blob/master/server/runtime.go) for a full list of hooks that are available in the runtime package.
{{< / note >}}

Use the following request names for registering your \[Before\](#before-hooks) and \[After\](#after-hooks) hooks:

{{< table name="nakama.server-framework.basics.request-names" >}}

Names are case-insensitive. For more information, see \[\`apigrpc.proto\`\](https://github.com/heroiclabs/nakama/blob/master/apigrpc/apigrpc.proto).

\### Listening for session changes

The \`Authenticate\*\` hooks fire only when a new session is created. To run logic on every token refresh (including for active, returning sessions), register a handler for the \`SessionRefresh\` request:

{{< code type="server" >}}

\`\`\`lua
nk.register\_req\_before(before\_session\_refresh\_fn, "SessionRefresh")
nk.register\_req\_after(after\_session\_refresh\_fn, "SessionRefresh")
\`\`\`

{{< / code >}}

{{< code type="server" >}}

\`\`\`go
initializer.RegisterBeforeSessionRefresh(beforeSessionRefreshFn)
initializer.RegisterAfterSessionRefresh(afterSessionRefreshFn)
\`\`\`

{{< / code >}}

{{< code type="server" >}}

\`\`\`typescript
initializer.registerBeforeSessionRefresh(beforeSessionRefreshFn);
initializer.registerAfterSessionRefresh(afterSessionRefreshFn);
\`\`\`

{{< / code >}}

\### Real-time hooks

For real-time before and after hooks, use the following message names:

{{< table name="nakama.server-framework.basics.message-names" >}}

Names are case-insensitive. For more information, have a look at \[\`realtime.proto\`\](https://github.com/heroiclabs/nakama-common/blob/master/rtapi/realtime.proto).

\## Before hooks

Any function may be registered to intercept a message received from a client and operate on it (or reject it) based on custom logic. This is useful to enforce specific rules on top of the standard features in the server, or to replace what would otherwise be an invalid input.

Input validation does not apply until \*\*after execution of any before hooks\*\*, meaning clients can send larger (or otherwise invalid) inputs than the server would normally allow so long as the before hook replaces the input with a valid one. For example, given \[custom authentication IDs\](/docs/nakama/concepts/authentication/#custom) must be between 6-128 bytes, if your external authentication provider returns a longer ID use a before hook to replace that input with a valid ID.

In Go, each hook will receive the request input as a \`struct\` containing the data that will be processed by the server for that request, if that feature is expected to receive an input. In Lua, the second argument will be the incoming \`payload\` containing data received that will be processed by the server. In JavaScript the \`payload\` is the fourth argument.

You must remember to return the payload at the end of your function in the same structure as you received it.

If you choose to return \`nil\` (Lua) or \`null\|undefined\` (JavaScript) instead of the \`payload\` (or a non-nil \`error\` in Go) the server will halt further processing of that message. This can be used to stop the server from accepting certain messages or disabling/blacklisting certain server features.

An example use case would be to hook into chat messages to apply your own \[profanity filter\](../../../concepts/chat/#filtering-message-content).

\## After hooks

Similar to \[Before hook\](#before-hooks) you can attach a function to operate on a message. The registered function will be called after the message has been processed in the pipeline. The custom code will be executed asynchronously after the response message has been sent to a client.

The second argument is the "outgoing payload" containing the server's response to the request. The third argument contains the "incoming payload" containing the data originally passed to the server for this request.

After hooks cannot change the response payload being sent back to the client and errors do not prevent the response from being sent.

\## RPC hooks

Some logic between client and server is best handled as RPC functions which clients can execute. For this purpose Nakama supports the registration of custom RPC hooks.

The ID of your registered RPC can be used within client code to send an RPC message to execute the function on the server and return the result.

From Go runtime code, the result is returned as \`(string, error)\`. From Lua runtime code, results are always returned as a Lua string (or optionally \`nil\`). From the JavaScript runtime code, results should always be a string, \`null\` or omitted (undefined).