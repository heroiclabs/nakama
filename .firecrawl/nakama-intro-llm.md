\# Introduction

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/server-framework/introduction/
\*\*Summary:\*\* Nakama includes a fast embedded code runtime for writing custom logic as JavaScript bundles, Go plugins, and Lua modules. Learn the basics of using the server runtime features.
\*\*Keywords:\*\* rpc, registerrpc, rpcasync, ctx
\*\*Categories:\*\* nakama, introduction, server-framework

\-\-\-

\# Introduction

Nakama includes a fast embedded code runtime enabling you to write custom logic as a \[JavaScript\](https://developer.mozilla.org/en-US/docs/Web/javascript) bundle, \[Go plugins\](https://golang.org/pkg/plugin/), and \[Lua modules\](https://www.lua.org/manual/5.1/manual.html).

The runtime framework is essential to writing server-side logic for your games or apps. Use it to write code you would not want to run on client devices or the browser. The code you deploy with the server can be used immediately by clients, allowing you to change behavior on the fly and add new features faster.
This code can be used to run authoritative logic or perform validation checks as well as integrate with other services over HTTPS.

Use server-side code when you want to set rules around various features, like how many \[friends\](../../concepts/friends/) a user may have or how many \[groups\](../../concepts/groups/) they can join.

{{< note important >}}
We do not recommend modifying Nakama source-code and rebuilding from source to add new features or customize behavior. The recommended approach is using the embedded runtime.
{{< / note >}}

This page will cover the key concepts and functionality available in the Nakama runtime framework.

\## Loading modules

{{< note "important" "Tip" >}}
Heroic Labs recommends use of the JavaScript VM.
{{< / note >}}

By default the server will scan all files within the \`data/modules\` folder relative to the server file or the folder specified in the YAML \[configuration\](../../getting-started/configuration/#runtime) at startup. You can also specify the modules folder via a command flag when you start the server.

Files with the \`.lua\`, \`.so\`, and \`.js\` extensions found in the runtime path folder will be loaded and evaluated as part of the startup sequence. Each of the runtimes has access to the Nakama API to operate on messages from clients as well as execute logic on demand.

The different supported languages are loaded with a precedence order of Go -> Lua -> JavaScript. This ensures deterministic behavior if match handlers or RPC functions/hooks are registered in multiple runtimes, providing the flexibility to leverage the different runtimes as best suited and have them work seamlessly together. For example, you can define an RPC function in the JavaScript runtime to create a match with a set of match handlers written in Go.

\### JavaScript runtime

The JavaScript runtime expects an \`index.js\` file. To change the name of the relative file path where the code will be loaded within the runtime path you can set it in the server YML or as a command flag.

\`\`\`sh
nakama --runtime.js\_entrypoint "some/path/index.js"
\`\`\`

This path must be relative to the default or set \[runtime path\](../../getting-started/configuration/#runtime.path).

\### Go runtime

The Go runtime looks for a Go plugin \`.so\` shared object file.

To learn how you can generate this file with your custom Go runtime code follow see \[building the Go shared object\](../go-runtime/#build-the-go-shared-object).

\### Lua runtime

The Lua runtime will interpret and load any \`.lua\` files, including those in a subdirectory. These can be referenced as modules with relative paths.

Each Lua file represents a module and all code in each module will be run and can be used to register functions.

\## Database handler

The runtime includes a database object that can be used to access the underlying game database. This enables you to include custom SQL queries as part of your game design and logic.

{{< note error >}}
Note that using custom SQL should be avoided wherever possible in favor of using the \[built-in features\](../../concepts/) of Nakama. You should also avoid the creation of custom tables. If your game design requires either of these options, please \[contact Heroic Labs\](mailto:support@heroiclabs.com) before proceeding.
{{< / note >}}

The database handler has a limit on the number of available connections to the database. This can lead to slowed response time for your users along with other errors. To avoid such issues you must ensure that your custom SQL queries properly release the connection once finished with the relevant row(s).

If using \`db.QueryContext()\` or \`db.Query()\`, you must call \`row.Close()\` after you are finished with the database rows data.

If using \`db.QueryRow()\` or \`db.QueryRowContext()\`, you must call either \`row.Scan\` or \`row.Close()\` after you are finished with the database rows data.

\## Logger

A logger instance included in the server runtime enables you to write and access log messages in your server code using the following severities: \`ERROR\`, \`WARN\`, \`INFO\`, and \`DEBUG\`.

{{< note info >}}
Please note that \`INFO\` and \`DEBUG\` levels are disabled in production environments due to the verbosity of their outputs. They are still available in \`Dev\` environments.
{{< / note >}}

See an example for the \[TypeScript\](../typescript-runtime/#develop-code), \[Go\](../go-runtime/#develop-code), and \[Lua\](../lua-runtime/#develop-code) runtime.

\## Nakama module

The Nakama module is included in the code runtime built into the server. This module provides access to a range of functions for implementing custom logic and behavior.

See the function reference for your preferred language to learn about the available functions:

\\* \[TypeScript Function Reference\](../typescript-runtime/function-reference/)
\\* \[Go Function Reference\](../go-runtime/function-reference/)
\\* \[Lua Function Reference\](../lua-runtime/function-reference/)

\## Functionality

\### RPC functions

Remote Procedure Calls (RPCs) let you call functions registered in your runtime code to operate on messages received from clients or execute custom logic on demand.

These functions are exposed via RESTful HTTP endpoints, the realtime socket APIs, and gRPC. They can be invoked using any of these means directly, or through our client SDKs.

1\. Create the RPC logic:

{{< code type="server" >}}
\`\`\`go
func AuthoritativeWriteRPC(ctx context.Context, logger runtime.Logger, db \*sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
 userID, \_ := ctx.Value(runtime.RUNTIME\_CTX\_USER\_ID).(string)

 data := map\[string\]interface{}{
 "achievementPoints": 100,
 "unlockedAchievements": \[\]string{"max-level", "defeat-boss-2", "equip-rare-gear"},
 }

 bytes, err := json.Marshal(data)
 if err != nil {
 return "", runtime.NewError("error marshaling data", 13)
 }

 write := &runtime.StorageWrite{
 Collection: "Unlocks",
 Key: "Achievements",
 UserID: userID,
 Value: string(bytes),
 PermissionRead: 1, // Only the server and owner can read
 PermissionWrite: 0, // Only the server can write
 }

 \_, err = nk.StorageWrite(ctx, \[\]\*runtime.StorageWrite{write})
 if err != nil {
 return "", runtime.NewError("error saving data", 13)
 }

 return "", nil
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
let authoritativeWriteRpc : nkruntime.RpcFunction = function (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string) : string \| void {
 const data = {
 achievementPoints: 100,
 unlockedAchievements: \['max-level', 'defeat-boss-2', 'equip-rare-gear'\]
 };

 const write : StorageWriteRequest = {
 collection: 'Unlocks',
 key: 'Achievements',
 userId: ctx.userId,
 value: data,
 permissionRead: 1, // Only the server and owner can read
 permissionWrite: 0 // Only the server can write
 };

 nk.storageWrite(\[write\]);

 return "";
};
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`lua
local authoritative\_write\_rpc = function(context, payload)
 local data = {
 \["achievementPoints"\] = 100,
 \["unlockedAchievements"\] = { "max-level", "defeat-boss-2", "equip-rare-gear" }
 }

 local write = {
 collection = "Unlocks",
 key = "Achievements",
 user\_id = context.user\_id,
 value = data,
 permission\_read = 1,
 permission\_write = 0
 }

 nk.storage\_write({ write })

 return ""
end
\`\`\`
{{< / code >}}

2\. Register your new RPC:

{{< code type="server" >}}
\`\`\`go
if err = initializer.RegisterRpc("authoritative\_write\_rpc", AuthoritativeWriteRPC); err != nil {
 logger.Error("Unable to register: %v", err)
 return err
}
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`typescript
initializer.registerRpc('authoritative\_write\_rpc', authoritativeWriteRpc);
\`\`\`
{{< / code >}}

{{< code type="server" >}}
\`\`\`lua
nk.register\_rpc(authoritative\_write\_rpc, "authoritative\_write\_rpc")
\`\`\`
{{< / code >}}

3\. The registered RPC Function can be invoked with any HTTP client of your choice. Your new endpoint will look like this:

\`\`\`curl
http://127.0.0.1:7350/v2/rpc/authoritative\_write\_rpc
\`\`\`

\### Hooks

You can register functions in your runtime code to be called when certain events occur. Learn more about \[Hooks\](./hooks/) and their uses.

\### Server to server

You can \[check if the context has a user ID\](./runtime-context/#RUNTIME\_CTX\_USER\_ID) to see if an RPC function is a client or server-to-server call. Server to server calls will never have a user ID. If you want to scope functions to never be accessible from the client just return an error if you find a user ID in the context.

See the \[server runtime examples\](../runtime-examples/#server-to-server).

\### Run once

The runtime environment allows you to run code that must only be executed only once. This is useful if you have custom SQL queries that you need to perform or to register with third party services.

See the implementation examples for \[TypeScript\](../typescript-runtime/code-samples/#database-handler), \[Go\](../go-runtime/code-samples/#database-handler), or \[Lua\](../lua-runtime/code-samples/#database-handler) for an example.

\## Restrictions

See the \[TypeScript\](../typescript-runtime/#restrictions), \[Go\](../go-runtime/#restrictions), and \[Lua\](../lua-runtime/#restrictions) pages for runtime specific restrictions.

\### Background jobs

To avoid "dead work" - done when the user is not present - and the unnecessary server load, background jobs should be avoided in favor of an \[event\](../../concepts/events/) driven route. In this approach, the client makes an \[RPC\](#rpc-functions) call when the user returns, and in that called function any updates required by your game logic and use case are performed.

Where a scheduled background job would needlessly perform these updates across the entire user base, regardless of a user's inactivity, this approach ensures that work is only performed for users still active in the game.

Use of background jobs can cause further problems as any job would be limited to one Nakama instance, requiring either duplication across all instances or a non-homogenous workload across instances.