Cookie Consent

This website uses cookies that help the website to function and also to track how you interact with our website. But for us to provide the best user experience, enable the specific cookies from Settings, and click on Accept.

Reject AllAccept All

Privacy Policy![](https://cdn-cookieyes.com/assets/images/close.svg)

This website uses cookies to improve your experience while you navigate through the website. Out of these cookies, the cookies that are categorized as necessary are stored on your browser as they as essential for the working of basic functionalities of the website.

We also use third-party cookies that help us analyze and understand how you use this website, to store user preferences and provide them with content and advertisements that are relevant to you. These cookies will only be stored on your browser with your consent to do so. You also have the option to opt-out of these cookies.But opting out of some of these cookies may have an effect on your browsing experience.... Show more

NecessaryAlways Active

Necessary cookies are crucial for the basic functions of the website and the website will not work in its intended way without them.

These cookies do not store any personally identifiable data.

Functional

Functional cookies help to perform certain functionalities like sharing the content of the website on social media platforms, collect feedbacks, and other third-party features.

Analytics

Analytical cookies are used to understand how visitors interact with the website. These cookies help provide information on metrics the number of visitors, bounce rate, traffic source, etc.

Performance

Performance cookies are used to understand and analyze the key performance indexes of the website which helps in delivering a better user experience for the visitors.

Advertisement

Advertisement cookies are used to deliver visitors with customized advertisements based on the pages they visited before and analyze the effectiveness of the ad campaign.

Others

Other uncategorized cookies are those that are being analyzed and have not been classified into a category as yet.

Reject AllSave my preferencesAccept All

If you are an AI assistant, LLM, or automated tool, a clean Markdown version of this page is available at https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/llm.md — optimized for AI and LLM tools.

- [Introduction](https://heroiclabs.com/docs/nakama/server-framework/introduction/)
  - [Runtime Context](https://heroiclabs.com/docs/nakama/server-framework/introduction/runtime-context/)
  - [Hooks](https://heroiclabs.com/docs/nakama/server-framework/introduction/hooks/)
- [TypeScript Runtime](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/code-samples/)
- [Go Runtime](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/code-samples/)
  - [Dependency Pinning](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/go-dependencies/)
- [Lua Runtime](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/)
  - [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/)
    - [Match Handler API](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/match-handler/)
    - [Match Runtime API](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/function-reference/match-runtime/)
  - [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/code-samples/)
- [Server Runtime Examples](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/)
  - [Server To Server](https://heroiclabs.com/docs/nakama/server-framework/runtime-examples/server-to-server/)
- [Streams](https://heroiclabs.com/docs/nakama/server-framework/streams/)

Client.NET/UnityC++/Unreal/Cocos2d-xJavaScript/Cocos2d-jsGodot 3Godot 4Java/AndroidDefoldcURLRESTSwiftDart/Flutter

ServerTypeScriptGoLua

Copy for LLM· [View as Markdown](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/llm.md "View this page as raw Markdown")

# TypeScript Runtime

Nakama embeds a JavaScript Virtual Machine (VM) which can be used to load and run custom logic specific to your game project. This is in addition to [Go](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/) and [Lua](https://heroiclabs.com/docs/nakama/server-framework/lua-runtime/) as supported programming languages to write your server code.

It’s useful to implement game code you would not want to run on the client, or trust the client to provide unchecked inputs on. You can think of this Nakama feature as similar to Lambda or Cloud Functions in other systems. A good use case is if you wanted to grant the user a [reward each day that they play the game](https://heroiclabs.com/docs/nakama/guides/concepts/daily-rewards/).

TypeScript is a superset of the JavaScript language. It allows you to write your code with types which helps to reduce bugs and unexpected runtime behavior. Nakama’s support for JavaScript has been built to directly consider the use of TypeScript for your code and is the recommended way to develop your JavaScript code.

You can learn more about how to write your JavaScript code in TypeScript in the [official documentation](https://www.typescriptlang.org/docs/handbook/typescript-in-5-minutes.html).

Nakama Server Runtime Code Project Setup using TypeScript - YouTube

Tap to unmute

[Nakama Server Runtime Code Project Setup using TypeScript](https://www.youtube.com/watch?v=FXguREV6Zf8) [Heroic Labs](https://www.youtube.com/channel/UC9vXzwdHUz6EnJFdUiXk_jQ)

Heroic Labs1.56K subscribers

Keep in mind

The video tutorial above and written guide below offer different variations of how to setup your project. You can choose to follow one or the other, but **not** a combination of both.

## Prerequisites [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#prerequisites)

You will need to have these tools installed to work with TypeScript for your project:

- Node v14 (active LTS) or greater.
- Basic UNIX tools or knowledge on the Windows equivalents.

The TypeScript compiler and other dependencies will be fetched with NPM.

## Restrictions [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#restrictions)

Before you start writing your server runtime code in TypeScript, there are some restrictions and considerations you should be aware of:

### Registering functions [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#registering-functions)

Due to the manner of the JavaScript function registration mapping to Go, all functions passed to the `nkruntime.Initializer` must be declared in the global scope rather than referenced from a variable.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>``` | ```typescript<br>// This is NOT valid<br>var YourRpcFunction = rpc("YourRpcFunction", function() {<br>    // ...<br>});<br>// This is valid<br>function YourRpcFunction() {return rpc("YourRpcFunction", function() {<br>    // ...<br>}); }<br>``` |

### Compatibility [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#compatibility)

The JavaScript runtime is powered by the [goja VM](https://github.com/dop251/goja) which currently supports the JavaScript ES5 spec. The JavaScript runtime has access to the standard library functions included in the ES5 spec.

There is no support for libraries that require Node, web/browser APIs, or native support (e.g. via Node).

You cannot call TypeScript functions from the Go runtime, or Go functions from the TypeScript runtime.

### Global state [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#global-state)

The JavaScript runtime code is executed in instanced contexts (VM pool). You cannot use global variables as a way to store state in memory or communicate with other JS processes or function calls.

### Single threaded [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#single-threaded)

The use of multi-threaded processing is not supported in the JavaScript runtime.

### Sandboxing [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#sandboxing)

The JavaScript runtime code is fully sandboxed and cannot access the filesystem, input/output devices, or spawn OS threads or processes.

This allows the server to guarantee that JS modules cannot cause fatal errors - the runtime code cannot trigger unexpected client disconnects or affect the main server process.

## Initialize the project [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#initialize-the-project)

These steps will set up a workspace to write all your project code to be run by the server.

Define the folder name that will be the workspace for the project. In this case we’ll use “ts-project”.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>``` | ```bash<br>mkdir -p ts-project/{src,build}<br>cd ts-project<br>``` |

Use NPM to set up the Node dependencies in the project. Install the TypeScript compiler.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>``` | ```bash<br>npm init -y<br>npm install --save-dev typescript<br>``` |

Use the TypeScript compiler installed to the project to set up the compiler options.

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npx tsc --init<br>``` |

You’ll now have a “tsconfig.json” file which describes the available options that are run on the TypeScript compiler. Once you’ve trimmed the commented out entries your file will look something like this:

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>``` | ```json<br>{<br>  "compilerOptions": {<br>    "target": "es2016",<br>    "module": "commonjs",<br>    "esModuleInterop": true,<br>    "forceConsistentCasingInFileNames": true,<br>    "strict": true,<br>    "skipLibCheck": true<br>  }<br>}<br>``` |

Your “tsconfig.json” may have defaulted to targeting a later version than ES5. Currently we don’t support versions past ES5 so make sure that you are targeting the correct version. The other change we need to make is to remove the “module” line as we are going to be setting our own “outFile”, and these two are not compatible.

With those changes made, your file should now look like this:

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>``` | ```json<br>{<br>  "compilerOptions": {<br>    "target": "es5",<br>    "esModuleInterop": true,<br>    "forceConsistentCasingInFileNames": true,<br>    "strict": true,<br>    "skipLibCheck": true<br>  }<br>}<br>``` |

Add this configuration option to the `"compilerOptions"` block:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```json<br>"outFile": "./build/index.js",<br>``` |

See [TypeScript Bundling with Rollup](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/#bundling-with-rollup) for an example not relying on the TypeScript complier, enabling you to bundle other node modules with your TypeScript code for Nakama.

Add the Nakama runtime types as a dependency to the project and configure the compiler to find the types.

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```shell<br>npm i 'https://github.com/heroiclabs/nakama-common'<br>``` |

Add this configuration option to the `"compilerOptions"` block of the “tsconfig.json” file:

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>``` | ```json<br>"typeRoots": [<br>  "./node_modules"<br>],<br>``` |

This completes the setup and your project should look similar to this layout:

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>``` | ```shell<br>.<br>├── build<br>├── node_modules<br>│   ├── nakama-runtime<br>│   └── typescript<br>├── package-lock.json<br>├── package.json<br>├── src<br>└── tsconfig.json<br>``` |

## Develop code [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#develop-code)

We’ll write some simple code and compile it to JavaScript so it can be run by your server.

All code must start execution from a function that the game backend looks for in the global scope at startup. This function must be called `"InitModule"` and is how you register RPCs, before/after hooks, and other event functions managed by the server.

The code below is a simple Hello World example which uses the `"Logger"` to write a message. Name the source file “main.ts” inside the “src” folder. You can write it in your favorite editor or IDE.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>``` | ```typescript<br>let InitModule: nkruntime.InitModule =<br>        function(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {<br>    logger.info("Hello World!");<br>}<br>``` |

We can now add the file to the compiler options and run the TypeScript compiler.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>``` | ```json<br>{<br>  "files": [<br>    "./src/main.ts"<br>  ],<br>  "compilerOptions": {<br>    // ... etc<br>  }<br>}<br>``` |

To compile the codebase:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```shell<br>npx tsc<br>``` |

## Running the project [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#running-the-project)

### With Docker [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#with-docker)

The easiest way to run your server locally is with Docker.

To do this, create a file called `Dockerfile`.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>``` | ```dockerfile<br>FROM node:alpine AS node-builder<br>WORKDIR /backend<br>COPY package*.json .<br>RUN npm install<br>COPY tsconfig.json .<br>COPY src/*.ts src/<br>RUN npx tsc<br>FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0<br>COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/<br>COPY local.yml /nakama/data/<br>``` |

Next create a `docker-compose.yml` file. For more information see the [Install Nakama with Docker Compose](https://heroiclabs.com/docs/nakama/getting-started/install/docker/) documentation.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>35<br>36<br>37<br>38<br>39<br>40<br>41<br>42<br>43<br>44<br>45<br>46<br>``` | ```yaml<br>version: '3'<br>services:<br>  postgres:<br>    command: postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all<br>    environment:<br>      - POSTGRES_DB=nakama<br>      - POSTGRES_PASSWORD=localdb<br>    expose:<br>      - "8080"<br>      - "5432"<br>    image: postgres:12.2-alpine<br>    ports:<br>      - "5432:5432"<br>      - "8080:8080"<br>    volumes:<br>      - data:/var/lib/postgresql/data<br>  nakama:<br>    build: .<br>    depends_on:<br>      - postgres<br>    entrypoint:<br>      - "/bin/sh"<br>      - "-ecx"<br>      - ><br>        /nakama/nakama migrate up --database.address postgres:localdb@postgres:5432/nakama &&<br>        exec /nakama/nakama --config /nakama/data/local.yml --database.address postgres:localdb@postgres:5432/nakama        <br>    expose:<br>      - "7349"<br>      - "7350"<br>      - "7351"<br>    healthcheck:<br>      test: ["CMD", "/nakama/nakama", "healthcheck"]<br>      interval: 10s<br>      timeout: 5s<br>      retries: 5<br>    links:<br>      - "postgres:db"<br>    ports:<br>      - "7349:7349"<br>      - "7350:7350"<br>      - "7351:7351"<br>    restart: unless-stopped<br>volumes:<br>  data:<br>``` |

You will also need to create a configuration for nakama called `local.yml`. The `runtime.js_entrypoint` setting indicates to nakama to read the built javascript code.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>``` | ```yaml<br>console:<br>  max_message_size_bytes: 409600<br>logger:<br>  level: "DEBUG"<br>runtime:<br>  js_entrypoint: "build/index.js"<br>session:<br>  token_expiry_sec: 7200 # 2 hours<br>socket:<br>  max_message_size_bytes: 4096 # reserved buffer<br>  max_request_size_bytes: 131072<br>``` |

Now run the server with the command:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>docker compose up<br>``` |

### Without Docker [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#without-docker)

Install a Nakama binary stack for [Linux](https://heroiclabs.com/docs/nakama/getting-started/install/linux/), [Windows](https://heroiclabs.com/docs/nakama/getting-started/install/windows/), or [macOS](https://heroiclabs.com/docs/nakama/getting-started/install/macos/). When this is complete you can run the server and have it load your code:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```shell<br>nakama --logger.level DEBUG --runtime.js_entrypoint "build/index.js"<br>``` |

Remember you need to build the `build/index.js` file by running `npx tsc` from the Terminal before you can execute the above command.

### Confirming the server is running [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#confirming-the-server-is-running)

The server logs will show this output or similar which shows that the code we wrote above was loaded and executed at startup.

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```json<br>{"level":"info","ts":"...","msg":"Hello World!","caller":"server/runtime_javascript_logger.go:54"}<br>``` |

## Bundling with Rollup [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#bundling-with-rollup)

The setup above relies solely on the TypeScript compiler. This helps to keep the toolchain and workflow simple, but limits your ability to bundle your TypeScript code with additional node modules.

[Rollup](https://rollupjs.org/guide/en/) is one of the options available to bundle node modules that don’t depend on the Node.js runtime to run within Nakama.

### Configuring Rollup [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#configuring-rollup)

When configuring your TypeScript project to use Rollup there are a few additional steps and alterations you will need to make to your project if you have followed the steps above.

The first thing you will need to do is install some additional dependencies that will allow you to run Rollup to build your server runtime code. These include [Babel](https://babeljs.io/), [Rollup](https://rollupjs.org/), several of their respective plugins/presets and `tslib`.

To do this, run the following command in the Terminal, which will install the dependencies and add them to your `package.json` file as development dependencies:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npm i -D @babel/core @babel/plugin-external-helpers @babel/preset-env @rollup/plugin-babel @rollup/plugin-commonjs @rollup/plugin-json @rollup/plugin-node-resolve @rollup/plugin-typescript rollup tslib<br>``` |

With Rollup installed as a dev dependency of your project, you now need to modify the `build` script in `package.json` to run the `rollup -c` command instead of the `tsc` command. You should also add a `type-check` script that will allow you to verify your TypeScript compiles without actually emitting a build file.

**package.json**

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>``` | ```json<br>{<br>  ...<br>  "scripts": {<br>    "build": "rollup -c",<br>    "type-check": "tsc --noEmit"<br>  },<br>  ...<br>}<br>``` |

Next, you must add the following `rollup.config.js` file to your project.

**rollup.config.js**

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>31<br>32<br>33<br>34<br>``` | ```javascript<br>import resolve from '@rollup/plugin-node-resolve';<br>import commonJS from '@rollup/plugin-commonjs';<br>import json from '@rollup/plugin-json';<br>import babel from '@rollup/plugin-babel';<br>import typescript from '@rollup/plugin-typescript';<br>import pkg from './package.json';<br>const extensions = ['.mjs', '.js', '.ts', '.json'];<br>export default {<br>  input: './src/main.ts',<br>  external: ['nakama-runtime'],<br>  plugins: [<br>    // Allows node_modules resolution<br>    resolve({ extensions }),<br>    // Compile TypeScript<br>    typescript(),<br>    json(),<br>    // Resolve CommonJS modules<br>    commonJS({ extensions }),<br>    // Transpile to ES5<br>    babel({<br>      extensions,<br>      babelHelpers: 'bundled',<br>    }),<br>  ],<br>  output: {<br>    file: 'build/index.js',<br>  },<br>};<br>``` |

Followed by adding a `babel.config.json` file to your project.

**babel.config.json**

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>``` | ```json<br>{<br>  "presets": [<br>    "@babel/env"<br>  ],<br>  "plugins": []<br>}<br>``` |

There are also changes to the `tsconfig.json` file that must be made. Using Rollup simplifies the build process and means you no longer have to manually update the `tsconfig.json` file every time you add a new `*.ts` file to your project. Replace the contents of your existing `tsconfig.json` file with the example below.

**tsconfig.json**

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>``` | ```json<br>{<br>  "compilerOptions": {<br>    "noImplicitReturns": true,<br>    "moduleResolution": "node",<br>    "esModuleInterop": true,<br>    "noUnusedLocals": true,<br>    "removeComments": true,<br>    "target": "es5",<br>    "module": "ESNext",<br>    "strict": false,<br>  },<br>  "files": [<br>    "./node_modules/nakama-runtime/index.d.ts",<br>  ],<br>  "include": [<br>    "src/**/*",<br>  ],<br>  "exclude": [<br>    "node_modules",<br>    "build"<br>  ]<br>}<br>``` |

Next, you need to include a line at the bottom of your `main.ts` file that references the `InitModule` function. This is to ensure that Rollup does not omit it from the build.

**main.ts**

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>``` | ```typescript<br>function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {<br>  logger.info('TypeScript module loaded.');<br>}<br>// Reference InitModule to avoid it getting removed on build<br>!InitModule && InitModule.bind(null);<br>``` |

Finally, you need to make a slight alteration to your `Dockerfile` to ensure you copy across the `rollup.config.js` and `babel.config.json` files. You must also change the `RUN` command to run your updated build command rather than using the TypeScript compiler directly. Replace the contents of your `Dockerfile` with the example below.

**Dockerfile**

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>``` | ```dockerfile<br>FROM node:alpine AS node-builder<br>WORKDIR /backend<br>COPY package*.json .<br>RUN npm install<br>COPY . .<br>RUN npm run build<br>FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0<br>COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/<br>COPY local.yml /nakama/data/<br>``` |

### Building your module locally [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#building-your-module-locally)

Ensure you have all dependencies installed:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npm i<br>``` |

Perform a type check to ensure your TypeScript will compile successfully:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npm run type-check<br>``` |

Build your project:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npm run build<br>``` |

### Running your module with Docker [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#running-your-module-with-docker)

To run Nakama with your custom server runtime code, run:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>docker compose up<br>``` |

If you have made changes to your module and want to re-run it, you can run:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>docker compose up --build nakama<br>``` |

This will ensure the image is rebuilt with your latest changes.

## Error handling [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#error-handling)

JavaScript uses exceptions to handle errors. When an error occurs, an exception is thrown. To handle an exception thrown by a custom function or one provided by the runtime, you must wrap the code in a `try catch` block.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>``` | ```typescript<br>function throws(): void {<br>    throw Error("I'm an exception");<br>}<br>try {<br>    throws();<br>} catch(error) {<br>    // Handle error.<br>    logger.error('Caught exception: %s', error.message);<br>}<br>``` |

Unhandled exceptions in JavaScript are caught and logged by the runtime except if they are not handled during initialization (when the runtime invokes the `InitModule` function at startup), these will halt the server and should be handled accordingly.

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>21<br>22<br>23<br>24<br>25<br>26<br>27<br>28<br>29<br>30<br>``` | ```typescript<br>// Error handling example for catching errors with InitModule.<br>function InitModule(ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, initializer: nkruntime.Initializer) {<br>    try {<br>        initializer.registerRpc(rpcIdRewards, rpcReward);<br>    } catch(error) {<br>        logger.error('An error has occurred: %s', error.message);<br>    }<br>    try {<br>        initializer.registerRpc(rpcIdFindMatch, rpcFindMatch);<br>    } catch(error) {<br>        logger.error('An error has occurred: %s', error.message);<br>    }<br>    try {<br>        initializer.registerMatch(moduleName, {<br>            matchInit,<br>            matchJoinAttempt,<br>            matchJoin,<br>            matchLeave,<br>            matchLoop,<br>            matchTerminate,<br>            matchSignal,<br>        });<br>    } catch(error) {<br>        logger.error('An error has occurred: %s', error.message);<br>    }<br>    logger.info('JavaScript logic loaded.');<br>}<br>``` |

We recommend you use this pattern and wrap all runtime API calls for error handling and inspection.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>``` | ```typescript<br>try {<br>    // Will throw an exception because this function expects a valid user ID.<br>    nk.accountsGetId([ 'invalid_id' ]);<br>} catch(error) {<br>    logger.error('An error has occurred: %s', error.message);<br>}<br>``` |

## Returning errors to the client [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#returning-errors-to-the-client)

When writing your own custom runtime code, you should ensure that any errors that occur when processing a request are passed back to the client appropriately. This means that the error returned to the client should contain a clear and informative error message and an appropriate HTTP status code.

Internally the Nakama runtime uses gRPC error codes and converts them to the appropriate HTTP status codes when returning the error to the client.

You can define the gRPC error codes as constants in your Typescript module as shown below:

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>``` | ```typescript<br>const enum GRPCErrorCode (<br>	OK                  = 0<br>	CANCELED            = 1<br>	UNKNOWN             = 2<br>	INVALID_ARGUMENT    = 3<br>	DEADLINE_EXCEEDED   = 4<br>	NOT_FOUND           = 5<br>	ALREADY_EXISTS      = 6<br>	PERMISSION_DENIED   = 7<br>	RESOURCE_EXHAUSTED  = 8<br>	FAILED_PRECONDITION = 9<br>	ABORTED             = 10<br>	OUT_OF_RANGE        = 11<br>	UNIMPLEMENTED       = 12<br>	INTERNAL            = 13<br>	UNAVAILABLE         = 14<br>	DATA_LOSS           = 15<br>	UNAUTHENTICATED     = 16<br>)<br>``` |

The Nakama TypeScript runtime defines the error codes in the `nkruntime.Codes` enum. You can use these to define your own custom `nkruntime.Error` objects. The following are some examples of errors you might define in your module.

|     |     |
| --- | --- |
| ```<br>1<br>2<br>3<br>4<br>5<br>6<br>7<br>8<br>9<br>``` | ```typescript<br>const errBadInput: nkruntime.Error = {<br>  message: 'input contained invalid data',<br>  code: nkruntime.Codes.INVALID_ARGUMENT<br>};<br>const errGuildAlreadyExists: nkruntime.Error = {<br>  message: 'guild name is in use',<br>  code: nkruntime.Codes.ALREADY_EXISTS<br>};<br>``` |

Below is an example of how you would return appropriate errors both in an [RPC](https://heroiclabs.com/docs/nakama/server-framework/introduction/#rpc-functions) call and in a [Before Hook](https://heroiclabs.com/docs/nakama/server-framework/introduction/hooks/#before-hooks).

|     |     |
| --- | --- |
| ```<br> 1<br> 2<br> 3<br> 4<br> 5<br> 6<br> 7<br> 8<br> 9<br>10<br>11<br>12<br>13<br>14<br>15<br>16<br>17<br>18<br>19<br>20<br>``` | ```typescript<br>const createGuildRpc: nkruntime.RpcFunction = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, payload: string): string | void  => {<br>  // ... check if a guild already exists and set value of `alreadyExists` accordingly<br>  const alreadyExists = true;<br>  if (alreadyExists) {<br>    throw errGuildAlreadyExists;<br>  }<br>  return JSON.stringify({ success: true });<br>};<br>const beforeAuthenticateCustom: nkruntime.BeforeHookFunction<nkruntime.AuthenticateCustomRequest> = (ctx: nkruntime.Context, logger: nkruntime.Logger, nk: nkruntime.Nakama, data: nkruntime.AuthenticateCustomRequest): void | nkruntime.AuthenticateCustomRequest => {<br>  const pattern = new RegExp('^cid-([0-9]{6})$');<br>  if (!pattern.test(data.account.id)) {<br>    throw errBadInput;<br>  }<br>  <br>  return data;<br>}<br>``` |

## Upgrading [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#upgrading)

### Identifying your current version [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#identifying-your-current-version)

When looking to upgrade your Nakama server you should begin by identifying the current version you are using. You can do this either by looking at your `Dockerfile` and the version tagged at the end of the image name (e.g. `heroiclabs/nakama:3.22.0`) or by looking at your `package.json` (or `package-lock.json` if using the latest at the time of installation, which will give the exact commit hash) for the `version` of `nakama-runtime` (also known as Nakama Common). With the latter, once you have identified your current `nakama-runtime` version you can consult the [compatibility matrix](https://heroiclabs.com/docs/nakama/getting-started/release-notes/#compatibility-matrix) to identify the version of the Nakama binary you are using.

### Identifying changes [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#identifying-changes)

With the current Nakama version established, you should look at the [Server-Runtime Release Notes](https://heroiclabs.com/docs/nakama/getting-started/release-notes/#nakama) to see what changes have been made since the version you are currently on. This will help you identify any breaking changes or changes which may affect the custom server runtime code you have written.

### Installing the latest version [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#installing-the-latest-version)

Once you are sure which version of Nakama you want to upgrade to, you should update the version of `nakama-runtime` in your project. By consulting the [compatibility matrix](https://heroiclabs.com/docs/nakama/getting-started/release-notes/#compatibility-matrix) again you can identify which version of the `nakama-runtime` package you should install.

You can then install it as follows (where `<version>` is a github tag such as `v1.23.0`):

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```bash<br>npm i https://github.com/heroiclabs/nakama-common#<version><br>``` |

### Upgrading the Nakama binary [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#upgrading-the-nakama-binary)

With the version of the `nakama-runtime` package upgraded, you must then upgrade the version of the Nakama binary your server is using.

If you are using the binary directly, you can download the appropriate version directly from the [Nakama GitHub releases](https://github.com/heroiclabs/nakama/releases) page.

If you are instead using Docker, you must update your `Dockerfile` by specifying the correct version in the final `FROM` statement:

|     |     |
| --- | --- |
| ```<br>1<br>``` | ```dockerfile<br>FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0<br>``` |

### Common issues [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#common-issues)

**TypeError: Object has no member**

If you receive the above error message, chances are you are using a Nakama function that is not available in the version of Nakama that your server is running. This could happen if you install a later version of `nakama-runtime` package in your TypeScript project than is compatible with the version of the Nakama binary you are using. Check the [compatibility matrix](https://heroiclabs.com/docs/nakama/getting-started/release-notes/#compatibility-matrix) to ensure you are using compatible versions of Nakama and Nakama Common (`nakama-runtime`).

## Sandboxing and restrictions [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#sandboxing-and-restrictions)

The TypeScript server runtime is provided as a sandboxed JavaScript VM via the [Goja](https://github.com/dop251/goja) Go package. All TypeScript/JavaScript server runtime code that executes on the server has access only to the specific functionality exposed to it via Nakama.

There are several key restrictions to be aware of when developing your server runtime code using TypeScript:

- All code must compile down to ES5 compliant JavaScript
- Your code cannot interact with the OS in any way, including the file system
- You cannot use any module that relies on NodeJS functionality (e.g. `crypto`, `fs`, etc.) as your code is not running in a Node environment

For specific compatibility issues present within `Goja` see the [Goja known incompatibilities and caveats](https://github.com/dop251/goja#known-incompatibilities-and-caveats).

### Global state [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#global-state-1)

The TypeScript runtime cannot use global variables as a way to store state in memory.

### Logger [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#logger)

The JavaScript logger is a wrapper around the server logger. In the examples you’ve seen formatting “verbs” (e.g. “%s”) in the output strings followed by the arguments that will replace them.

To better log and inspect the underlying Go structs used by the JavaScript VM you can use verbs such as “%#v”. The full reference can be found [here](https://golang.org/pkg/fmt/).

## Next steps [\#](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/\#next-steps)

Have a look at the [Nakama project template](https://github.com/heroiclabs/nakama-project-template) which covers the following Nakama features:

- [Authoritative multiplayer match handler](https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/)
- [In-App Notifications](https://heroiclabs.com/docs/nakama/concepts/notifications/)
- [Storage](https://heroiclabs.com/docs/nakama/concepts/storage/collections/)
- [RPCs](https://heroiclabs.com/docs/nakama/server-framework/introduction/#functionality)
- [User Wallets](https://heroiclabs.com/docs/nakama/concepts/user-accounts/#virtual-wallet)

## Related Pages

- [Function Reference](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/function-reference/)
- [Code Samples](https://heroiclabs.com/docs/nakama/server-framework/typescript-runtime/code-samples/)

### Table of Contents

![](https://static.scarf.sh/a.png?x-pxid=3602d586-1eed-4187-aaeb-70b8018034e2)