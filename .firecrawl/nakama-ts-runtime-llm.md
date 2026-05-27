\# TypeScript Runtime

\*\*URL:\*\* https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/
\*\*Summary:\*\* Learn how to configure and develop your project using JavaScript for your game backend custom logic.
\*\*Keywords:\*\* nakama typescript setup, server setup typescript, nakama docker, nakama typescript docker setup, setup
\*\*Categories:\*\* nakama, typescript-runtime, server-framework

\-\-\-

\# TypeScript Runtime

Nakama embeds a JavaScript Virtual Machine (VM) which can be used to load and run custom logic specific to your game project. This is in addition to \[Go\](../go-runtime/) and \[Lua\](../lua-runtime/) as supported programming languages to write your server code.

It's useful to implement game code you would not want to run on the client, or trust the client to provide unchecked inputs on. You can think of this Nakama feature as similar to Lambda or Cloud Functions in other systems. A good use case is if you wanted to grant the user a \[reward each day that they play the game\](../../guides/concepts/daily-rewards/).

TypeScript is a superset of the JavaScript language. It allows you to write your code with types which helps to reduce bugs and unexpected runtime behavior. Nakama's support for JavaScript has been built to directly consider the use of TypeScript for your code and is the recommended way to develop your JavaScript code.

You can learn more about how to write your JavaScript code in TypeScript in the \[official documentation\](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html).

{{< youtube "FXguREV6Zf8" >}}

{{< note "important" "Keep in mind" >}}
The video tutorial above and written guide below offer different variations of how to setup your project. You can choose to follow one or the other, but \*\*not\*\* a combination of both.
{{< /note >}}

\## Prerequisites

You will need to have these tools installed to work with TypeScript for your project:

\- Node v14 (active LTS) or greater.
\- Basic UNIX tools or knowledge on the Windows equivalents.

The TypeScript compiler and other dependencies will be fetched with NPM.

\## Restrictions

Before you start writing your server runtime code in TypeScript, there are some restrictions and considerations you should be aware of:

\### Registering functions

Due to the manner of the JavaScript function registration mapping to Go, all functions passed to the \`nkruntime.Initializer\` must be declared in the global scope rather than referenced from a variable.

\`\`\` typescript
// This is NOT valid

var YourRpcFunction = rpc("YourRpcFunction", function() {
 // ...
});

// This is valid

function YourRpcFunction() {return rpc("YourRpcFunction", function() {
 // ...
}); }
\`\`\`

\### Compatibility

The JavaScript runtime is powered by the \[goja VM\](https://github.com/dop251/goja) which currently supports the JavaScript ES5 spec. The JavaScript runtime has access to the standard library functions included in the ES5 spec.

There is no support for libraries that require Node, web/browser APIs, or native support (e.g. via Node).

You cannot call TypeScript functions from the Go runtime, or Go functions from the TypeScript runtime.

\### Global state

The JavaScript runtime code is executed in instanced contexts (VM pool). You cannot use global variables as a way to store state in memory or communicate with other JS processes or function calls.

\### Single threaded

The use of multi-threaded processing is not supported in the JavaScript runtime.

\### Sandboxing

The JavaScript runtime code is fully sandboxed and cannot access the filesystem, input/output devices, or spawn OS threads or processes.

This allows the server to guarantee that JS modules cannot cause fatal errors - the runtime code cannot trigger unexpected client disconnects or affect the main server process.

\## Initialize the project

These steps will set up a workspace to write all your project code to be run by the server.

Define the folder name that will be the workspace for the project. In this case we'll use "ts-project".

\`\`\`bash
mkdir -p ts-project/{src,build}
cd ts-project
\`\`\`

Use NPM to set up the Node dependencies in the project. Install the TypeScript compiler.

\`\`\`bash
npm init -y
npm install --save-dev typescript
\`\`\`

Use the TypeScript compiler installed to the project to set up the compiler options.

\`\`\`bash
npx tsc --init
\`\`\`

You'll now have a "tsconfig.json" file which describes the available options that are run on the TypeScript compiler. Once you've trimmed the commented out entries your file will look something like this:

\`\`\`json
{
 "compilerOptions": {
 "target": "es2016",
 "module": "commonjs",
 "esModuleInterop": true,
 "forceConsistentCasingInFileNames": true,
 "strict": true,
 "skipLibCheck": true
 }
}
\`\`\`

Your "tsconfig.json" may have defaulted to targeting a later version than ES5. Currently we don't support versions past ES5 so make sure that you are targeting the correct version. The other change we need to make is to remove the "module" line as we are going to be setting our own "outFile", and these two are not compatible.

With those changes made, your file should now look like this:

\`\`\`json
{
 "compilerOptions": {
 "target": "es5",
 "esModuleInterop": true,
 "forceConsistentCasingInFileNames": true,
 "strict": true,
 "skipLibCheck": true
 }
}
\`\`\`

Add this configuration option to the \`"compilerOptions"\` block:

\`\`\`json
"outFile": "./build/index.js",
\`\`\`

{{< note "important" >}}
See \[TypeScript Bundling with Rollup\](../typescript-runtime/#bundling-with-rollup) for an example not relying on the TypeScript complier, enabling you to bundle other node modules with your TypeScript code for Nakama.
{{< / note >}}

Add the Nakama runtime types as a dependency to the project and configure the compiler to find the types.

\`\`\` shell
npm i 'https://github.com/heroiclabs/nakama-common'
\`\`\`

Add this configuration option to the \`"compilerOptions"\` block of the "tsconfig.json" file:

\`\`\` json
"typeRoots": \[\
 "./node\_modules"\
\],
\`\`\`

This completes the setup and your project should look similar to this layout:

\`\`\` shell
.
├── build
├── node\_modules
│ ├── nakama-runtime
│ └── typescript
├── package-lock.json
├── package.json
├── src
└── tsconfig.json
\`\`\`

\## Develop code

We'll write some simple code and compile it to JavaScript so it can be run by your server.

All code must start execution from a function that the game backend looks for in the global scope at startup. This function must be called \`"InitModule"\` and is how you register RPCs, before/after hooks, and other event functions managed by the server.

The code below is a simple Hello World example which uses the \`"Logger"\` to write a message. Name the source file "main.ts" inside the "src" folder. You can write it in your favorite editor or IDE.

\`\`\` typescript
let InitModule: nkruntime.InitModule =
 function(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
 logger.info("Hello World!");
}
\`\`\`

We can now add the file to the compiler options and run the TypeScript compiler.

\`\`\` json
{
 "files": \[\
 "./src/main.ts"\
 \],
 "compilerOptions": {
 // ... etc
 }
}
\`\`\`

To compile the codebase:

\`\`\` shell
npx tsc
\`\`\`

\## Running the project

\### With Docker

The easiest way to run your server locally is with Docker.

To do this, create a file called \`Dockerfile\`.

\`\`\`dockerfile
FROM node:alpine AS node-builder

WORKDIR /backend

COPY package\*.json .
RUN npm install

COPY tsconfig.json .
COPY src/\*.ts src/
RUN npx tsc

FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

COPY --from=node-builder /backend/build/\*.js /nakama/data/modules/build/
COPY local.yml /nakama/data/
\`\`\`

Next create a \`docker-compose.yml\` file. For more information see the \[Install Nakama with Docker Compose\](../../getting-started/install/docker/) documentation.

\`\`\`yaml
version: '3'
services:
 postgres:
 command: postgres -c shared\_preload\_libraries=pg\_stat\_statements -c pg\_stat\_statements.track=all
 environment:
 \- POSTGRES\_DB=nakama
 \- POSTGRES\_PASSWORD=localdb
 expose:
 \- "8080"
 \- "5432"
 image: postgres:12.2-alpine
 ports:
 \- "5432:5432"
 \- "8080:8080"
 volumes:
 \- data:/var/lib/postgresql/data

 nakama:
 build: .
 depends\_on:
 \- postgres
 entrypoint:
 \- "/bin/sh"
 \- "-ecx"
 \- >
 /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&
 exec /nakama/nakama --config /nakama/data/local.yml --database.address postgres:localdb@postgres:5432/nakama
 expose:
 \- "7349"
 \- "7350"
 \- "7351"
 healthcheck:
 test: \["CMD", "/nakama/nakama", "healthcheck"\]
 interval: 10s
 timeout: 5s
 retries: 5
 links:
 \- "postgres:db"
 ports:
 \- "7349:7349"
 \- "7350:7350"
 \- "7351:7351"
 restart: unless-stopped

volumes:
 data:
\`\`\`

You will also need to create a configuration for nakama called \`local.yml\`. The \`runtime.js\_entrypoint\` setting indicates to nakama to read the built javascript code.

\`\`\`yaml
console:
 max\_message\_size\_bytes: 409600
logger:
 level: "DEBUG"
runtime:
 js\_entrypoint: "build/index.js"
session:
 token\_expiry\_sec: 7200 # 2 hours
socket:
 max\_message\_size\_bytes: 4096 # reserved buffer
 max\_request\_size\_bytes: 131072
\`\`\`

Now run the server with the command:

\`\`\`bash
docker compose up
\`\`\`

\### Without Docker

Install a Nakama binary stack for \[Linux\](../../getting-started/install/linux/), \[Windows\](../../getting-started/install/windows/), or \[macOS\](../../getting-started/install/macos/). When this is complete you can run the server and have it load your code:

\`\`\` shell
nakama --logger.level DEBUG --runtime.js\_entrypoint "build/index.js"
\`\`\`

Remember you need to build the \`build/index.js\` file by running \`npx tsc\` from the Terminal before you can execute the above command.

\### Confirming the server is running

The server logs will show this output or similar which shows that the code we wrote above was loaded and executed at startup.

\`\`\` json
{"level":"info","ts":"...","msg":"Hello World!","caller":"server/runtime\_javascript\_logger.go:54"}
\`\`\`

\## Bundling with Rollup

The setup above relies solely on the TypeScript compiler. This helps to keep the toolchain and workflow simple, but limits your ability to bundle your TypeScript code with additional node modules.

\[Rollup\](https://rollupjs.org/guide/en/) is one of the options available to bundle node modules that don't depend on the Node.js runtime to run within Nakama.

\### Configuring Rollup

When configuring your TypeScript project to use Rollup there are a few additional steps and alterations you will need to make to your project if you have followed the steps above.

The first thing you will need to do is install some additional dependencies that will allow you to run Rollup to build your server runtime code. These include \[Babel\](https://babeljs.io/), \[Rollup\](https://rollupjs.org/), several of their respective plugins/presets and \`tslib\`.

To do this, run the following command in the Terminal, which will install the dependencies and add them to your \`package.json\` file as development dependencies:

\`\`\`bash
npm i -D @babel/core @babel/plugin-external-helpers @babel/preset-env @rollup/plugin-babel @rollup/plugin-commonjs @rollup/plugin-json @rollup/plugin-node-resolve @rollup/plugin-typescript rollup tslib
\`\`\`

With Rollup installed as a dev dependency of your project, you now need to modify the \`build\` script in \`package.json\` to run the \`rollup -c\` command instead of the \`tsc\` command. You should also add a \`type-check\` script that will allow you to verify your TypeScript compiles without actually emitting a build file.

\*\*package.json\*\*

\`\`\`json
{
 ...
 "scripts": {
 "build": "rollup -c",
 "type-check": "tsc --noEmit"
 },
 ...
}
\`\`\`

Next, you must add the following \`rollup.config.js\` file to your project.

\*\*rollup.config.js\*\*

\`\`\`javascript
import resolve from '@rollup/plugin-node-resolve';
import commonJS from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import babel from '@rollup/plugin-babel';
import typescript from '@rollup/plugin-typescript';
import pkg from './package.json';

const extensions = \['.mjs', '.js', '.ts', '.json'\];

export default {
 input: './src/main.ts',
 external: \['nakama-runtime'\],
 plugins: \[\
 // Allows node\_modules resolution\
 resolve({ extensions }),\
\
 // Compile TypeScript\
 typescript(),\
\
 json(),\
\
 // Resolve CommonJS modules\
 commonJS({ extensions }),\
\
 // Transpile to ES5\
 babel({\
 extensions,\
 babelHelpers: 'bundled',\
 }),\
 \],
 output: {
 file: 'build/index.js',
 },
};
\`\`\`

Followed by adding a \`babel.config.json\` file to your project.

\*\*babel.config.json\*\*

\`\`\`json
{
 "presets": \[\
 "@babel/env"\
 \],
 "plugins": \[\]
}
\`\`\`

There are also changes to the \`tsconfig.json\` file that must be made. Using Rollup simplifies the build process and means you no longer have to manually update the \`tsconfig.json\` file every time you add a new \`\*.ts\` file to your project. Replace the contents of your existing \`tsconfig.json\` file with the example below.

\*\*tsconfig.json\*\*

\`\`\`json
{
 "compilerOptions": {
 "noImplicitReturns": true,
 "moduleResolution": "node",
 "esModuleInterop": true,
 "noUnusedLocals": true,
 "removeComments": true,
 "target": "es5",
 "module": "ESNext",
 "strict": false,
 },
 "files": \[\
 "./node\_modules/nakama-runtime/index.d.ts",\
 \],
 "include": \[\
 "src/\*\*/\*",\
 \],
 "exclude": \[\
 "node\_modules",\
 "build"\
 \]
}
\`\`\`

Next, you need to include a line at the bottom of your \`main.ts\` file that references the \`InitModule\` function. This is to ensure that Rollup does not omit it from the build.

\*\*main.ts\*\*

\`\`\`typescript
function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
 logger.info('TypeScript module loaded.');
}

// Reference InitModule to avoid it getting removed on build
!InitModule && InitModule.bind(null);
\`\`\`

Finally, you need to make a slight alteration to your \`Dockerfile\` to ensure you copy across the \`rollup.config.js\` and \`babel.config.json\` files. You must also change the \`RUN\` command to run your updated build command rather than using the TypeScript compiler directly. Replace the contents of your \`Dockerfile\` with the example below.

\*\*Dockerfile\*\*

\`\`\`dockerfile
FROM node:alpine AS node-builder

WORKDIR /backend

COPY package\*.json .
RUN npm install

COPY . .
RUN npm run build

FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

COPY --from=node-builder /backend/build/\*.js /nakama/data/modules/build/
COPY local.yml /nakama/data/
\`\`\`

\### Building your module locally

Ensure you have all dependencies installed:

\`\`\`bash
npm i
\`\`\`

Perform a type check to ensure your TypeScript will compile successfully:

\`\`\`bash
npm run type-check
\`\`\`

Build your project:

\`\`\`bash
npm run build
\`\`\`

\### Running your module with Docker

To run Nakama with your custom server runtime code, run:

\`\`\`bash
docker compose up
\`\`\`

If you have made changes to your module and want to re-run it, you can run:

\`\`\`bash
docker compose up --build nakama
\`\`\`

This will ensure the image is rebuilt with your latest changes.

\## Error handling

JavaScript uses exceptions to handle errors. When an error occurs, an exception is thrown. To handle an exception thrown by a custom function or one provided by the runtime, you must wrap the code in a \`try catch\` block.

\`\`\`typescript
function throws(): void {
 throw Error("I'm an exception");
}

try {
 throws();
} catch(error) {
 // Handle error.
 logger.error('Caught exception: %s', error.message);
}
\`\`\`

Unhandled exceptions in JavaScript are caught and logged by the runtime except if they are not handled during initialization (when the runtime invokes the \`InitModule\` function at startup), these will halt the server and should be handled accordingly.

\`\`\`typescript
// Error handling example for catching errors with InitModule.
function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {
 try {
 initializer.registerRpc(rpcIdRewards, rpcReward);
 } catch(error) {
 logger.error('An error has occurred: %s', error.message);
 }

 try {
 initializer.registerRpc(rpcIdFindMatch, rpcFindMatch);
 } catch(error) {
 logger.error('An error has occurred: %s', error.message);
 }

 try {
 initializer.registerMatch(moduleName, {
 matchInit,
 matchJoinAttempt,
 matchJoin,
 matchLeave,
 matchLoop,
 matchTerminate,
 matchSignal,
 });
 } catch(error) {
 logger.error('An error has occurred: %s', error.message);
 }

 logger.info('JavaScript logic loaded.');
}
\`\`\`

We recommend you use this pattern and wrap all runtime API calls for error handling and inspection.

\`\`\`typescript
try {
 // Will throw an exception because this function expects a valid user ID.
 nk.accountsGetId(\[ 'invalid\_id' \]);
} catch(error) {
 logger.error('An error has occurred: %s', error.message);
}
\`\`\`

\## Returning errors to the client

When writing your own custom runtime code, you should ensure that any errors that occur when processing a request are passed back to the client appropriately. This means that the error returned to the client should contain a clear and informative error message and an appropriate HTTP status code.

Internally the Nakama runtime uses gRPC error codes and converts them to the appropriate HTTP status codes when returning the error to the client.

You can define the gRPC error codes as constants in your Typescript module as shown below:

\`\`\`typescript
const enum GRPCErrorCode (
 OK = 0
 CANCELED = 1
 UNKNOWN = 2
 INVALID\_ARGUMENT = 3
 DEADLINE\_EXCEEDED = 4
 NOT\_FOUND = 5
 ALREADY\_EXISTS = 6
 PERMISSION\_DENIED = 7
 RESOURCE\_EXHAUSTED = 8
 FAILED\_PRECONDITION = 9
 ABORTED = 10
 OUT\_OF\_RANGE = 11
 UNIMPLEMENTED = 12
 INTERNAL = 13
 UNAVAILABLE = 14
 DATA\_LOSS = 15
 UNAUTHENTICATED = 16
)
\`\`\`

The Nakama TypeScript runtime defines the error codes in the \`nkruntime.Codes\` enum. You can use these to define your own custom \`nkruntime.Error\` objects. The following are some examples of errors you might define in your module.

\`\`\` typescript
const errBadInput: nkruntime.Error = {
 message: 'input contained invalid data',
 code: nkruntime.Codes.INVALID\_ARGUMENT
};

const errGuildAlreadyExists: nkruntime.Error = {
 message: 'guild name is in use',
 code: nkruntime.Codes.ALREADY\_EXISTS
};
\`\`\`

Below is an example of how you would return appropriate errors both in an \[RPC\](../introduction/#rpc-functions) call and in a \[Before Hook\](../introduction/hooks/#before-hooks).

\`\`\` typescript
const createGuildRpc: nkruntime.RpcFunction = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string \| void => {
 // ... check if a guild already exists and set value of \`alreadyExists\` accordingly
 const alreadyExists = true;

 if (alreadyExists) {
 throw errGuildAlreadyExists;
 }

 return JSON.stringify({ success: true });
};

const beforeAuthenticateCustom: nkruntime.BeforeHookFunction = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: nkruntime.AuthenticateCustomRequest): void \| nkruntime.AuthenticateCustomRequest => {
 const pattern = new RegExp('^cid-(\[0-9\]{6})$');

 if (!pattern.test(data.account.id)) {
 throw errBadInput;
 }

 return data;
}
\`\`\`

\## Upgrading

\### Identifying your current version

When looking to upgrade your Nakama server you should begin by identifying the current version you are using. You can do this either by looking at your \`Dockerfile\` and the version tagged at the end of the image name (e.g. \`heroiclabs/nakama:3.22.0\`) or by looking at your \`package.json\` (or \`package-lock.json\` if using the latest at the time of installation, which will give the exact commit hash) for the \`version\` of \`nakama-runtime\` (also known as Nakama Common). With the latter, once you have identified your current \`nakama-runtime\` version you can consult the \[compatibility matrix\](../../getting-started/release-notes/#compatibility-matrix) to identify the version of the Nakama binary you are using.

\### Identifying changes

With the current Nakama version established, you should look at the \[Server-Runtime Release Notes\](../../getting-started/release-notes/#nakama) to see what changes have been made since the version you are currently on. This will help you identify any breaking changes or changes which may affect the custom server runtime code you have written.

\### Installing the latest version

Once you are sure which version of Nakama you want to upgrade to, you should update the version of \`nakama-runtime\` in your project. By consulting the \[compatibility matrix\](../../getting-started/release-notes/#compatibility-matrix) again you can identify which version of the \`nakama-runtime\` package you should install.

You can then install it as follows (where \`\` is a github tag such as \`v1.23.0\`):

\`\`\`bash
npm i https://github.com/heroiclabs/nakama-common#
\`\`\`

\### Upgrading the Nakama binary

With the version of the \`nakama-runtime\` package upgraded, you must then upgrade the version of the Nakama binary your server is using.

If you are using the binary directly, you can download the appropriate version directly from the \[Nakama GitHub releases\](https://github.com/heroiclabs/nakama/releases) page.

If you are instead using Docker, you must update your \`Dockerfile\` by specifying the correct version in the final \`FROM\` statement:

\`\`\`dockerfile
FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0
\`\`\`

\### Common issues

\*\*TypeError: Object has no member\*\*

If you receive the above error message, chances are you are using a Nakama function that is not available in the version of Nakama that your server is running. This could happen if you install a later version of \`nakama-runtime\` package in your TypeScript project than is compatible with the version of the Nakama binary you are using. Check the \[compatibility matrix\](../../getting-started/release-notes/#compatibility-matrix) to ensure you are using compatible versions of Nakama and Nakama Common (\`nakama-runtime\`).

\## Sandboxing and restrictions

The TypeScript server runtime is provided as a sandboxed JavaScript VM via the \[Goja\](https://github.com/dop251/goja) Go package. All TypeScript/JavaScript server runtime code that executes on the server has access only to the specific functionality exposed to it via Nakama.

There are several key restrictions to be aware of when developing your server runtime code using TypeScript:

\- All code must compile down to ES5 compliant JavaScript
\- Your code cannot interact with the OS in any way, including the file system
\- You cannot use any module that relies on NodeJS functionality (e.g. \`crypto\`, \`fs\`, etc.) as your code is not running in a Node environment

For specific compatibility issues present within \`Goja\` see the \[Goja known incompatibilities and caveats\](https://github.com/dop251/goja#known-incompatibilities-and-caveats).

\### Global state

The TypeScript runtime cannot use global variables as a way to store state in memory.

\### Logger

The JavaScript logger is a wrapper around the server logger. In the examples you've seen formatting "verbs" (e.g. "%s") in the output strings followed by the arguments that will replace them.

To better log and inspect the underlying Go structs used by the JavaScript VM you can use verbs such as "%#v". The full reference can be found \[here\](https://golang.org/pkg/fmt/).

\## Next steps

Have a look at the \[Nakama project template\](https://github.com/heroiclabs/nakama-project-template) which covers the following Nakama features:

\- \[Authoritative multiplayer match handler\](../../concepts/multiplayer/authoritative/)
\- \[In-App Notifications\](../../concepts/notifications/)
\- \[Storage\](../../concepts/storage/collections/)
\- \[RPCs\](../introduction/#functionality)
\- \[User Wallets\](../../concepts/user-accounts/#virtual-wallet)