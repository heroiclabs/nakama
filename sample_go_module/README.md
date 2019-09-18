# Nakama Go Runtime

The game server includes support to develop native code in Go with the [plugin](https://golang.org/pkg/plugin/) package from the Go stdlib. It's used to enable compiled shared objects to be loaded by the game server at startup.

The Go runtime support can be used to develop authoritative multiplayer match handlers, RPC functions, hook into messages processed by the server, and extend the server with any other custom logic. It offers the same capabilities as the [Lua runtime](https://heroiclabs.com/docs/runtime-code-basics/) support but has the advantage that any package from the Go ecosystem can be used.

For more information and a discussion of the pros/cons with the Go runtime have a look at the [docs](https://heroiclabs.com/docs).

## Minimal example

Here's the smallest example of a Go module written with the server runtime.

```
package main

import (
  "context"
  "database/sql"

  "github.com/heroiclabs/nakama-common/runtime"
)

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
  logger.Info("module loaded")
  return nil
}
```

## Setup a project

To setup your own project to build modules for the game server you can follow these steps.

1. Download and install the Go toolchain. It's recommended you follow the [official instructions](https://golang.org/doc/install).

2. Setup your GOPATH environment variable. Most use `$HOME/go` as the `$GOPATH`.

   You can temporarily setup the environment variable with `export` but for it to persist you should add it to your shell environment.

   ```
   export GOPATH=$HOME/go
   ```

3. Use "go get" to download the server locally.

   ```
   go get -d github.com/heroiclabs/nakama
   ```

4. Build the game server from source if you want.

   ```
   cd $GOPATH/src/github.com/heroiclabs/nakama
   env CGO_ENABLED=1 go build -trimpath
   ```

5. Setup a folder for your own server code.

   ```
   mkdir -p $GOPATH/src/some_project
   cd $GOPATH/src/some_project
   go get -u "github.com/heroiclabs/nakama-common"
   ```

6. You'll need to copy the main server dependencies into your project.

   ```
   # Add some Go code. See an example above.
   go build --buildmode=plugin -trimpath -o ./modules/some_project.so
   ```

   __NOTE__: It is not possible to build plugins on Windows with the native compiler toolchain but they can be cross-compiled and run with Docker. See more details below.

7. Start the game server to load your plugin code. (Also make sure you run the database).

   ```
   $GOPATH/src/github.com/heroiclabs/nakama/nakama --runtime.path $GOPATH/src/plugin_project/modules
   ```
   
   __TIP__: You don't have to build and run Nakama from source. You can also download a prebuilt binary for your platform.

## Build process

In a regular development cycle you will often recompile your code and rerun the server.

1. Develop and compile your code.

   ```
   go build --buildmode=plugin -trimpath
   ```
   
2. Use "--runtime.path" when you start the server to load modules at startup.

For more information on how the server loads modules have a look at [these](https://heroiclabs.com/docs/runtime-code-basics/#load-modules) docs. For general instructions on how to run the server give [these](https://heroiclabs.com/docs/install-start-server/#start-nakama) docs a read.

__HINT__: Due to a problem noted in this [issue](https://github.com/jaegertracing/jaeger/issues/422#issuecomment-360954600) it's necessary for the plugin to have the exact same vendored dependencies as the server binary for the final builds to be binary compatible. This should be resolved in the Go 1.12 release.

### Docker builds

It's often easiest to run the game server with Docker Compose. It will start the game server and database server together in the right sequence and wraps the process up into a single command. You'll need the Docker engine installed to use it.

For Windows development and environments where you want to use our official Docker images to run your containers we provide a container image to help you build your code.

1. Use the Docker plugin helper container to compile your project. In PowerShell:

   ```
   cd $GOPATH/src/plugin_project # Your project folder. See instructions above.
   docker run --rm -v "${PWD}:/tempbuild" -w "/tempbuild" heroiclabs/nakama-pluginbuilder:2.7.0 build --buildmode=plugin -trimpath -o ./modules/plugin_project.so
   ```
   
   In the command above we bind-mount your current folder into the container and use the Go toolchain inside it to run the build. The output artifacts are written back into your host filesystem.

2. Use our official Docker Compose [file](https://heroiclabs.com/docs/install-docker-quickstart/#using-docker-compose) to run all containers together and load in your custom module.

   ```
   docker-compose -f ./docker-compose.yml up
   ```

   By default the server will be started and look in a folder relative to the current dir called "./modules" to load code.

   __TIP__: Use the same version of your plugin builder image as used in the Docker Compose file for the server version. i.e. "heroiclabs/nakama:2.3.1" <> "heroiclabs/nakama-pluginbuilder:2.3.1"

## Bigger Example

Have a look in this folder for more examples on how to create and use various parts of the game server Go runtime support.

https://github.com/heroiclabs/nakama/tree/master/sample_go_module
