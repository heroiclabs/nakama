# Nakama Go Runtime

The game server includes support to develop native code in Go with the [plugin](https://golang.org/pkg/plugin/) package from the Go stdlib. It's used to enable compiled shared objects to be loaded by the game server at startup.

The Go runtime support can be used to develop authoritative multiplayer match handlers, RPC functions, hook into messages processed by the server, and extend the server with any other custom logic. It offers the same capabilities as the [Lua runtime](https://heroiclabs.com/docs/runtime-code-basics/) support but has the advantage that any package from the Go ecosystem can be used.

For more information and a discussion of the pros/cons with the Go runtime have a look at the [docs](https://heroiclabs.com/docs).

## Minimal example

Here's the smallest example of a Go module written with the server runtime.

```go
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

2. Setup a folder for your own plugin code.

    ```bash
    mkdir -p "$HOME/plugin_code"
    cd "$HOME/plugin_code"
    ```

3. Initialize the Go module for your plugin and add the nakama-common dependency.

    ```bash
    go mod init "plugin_code"
    go get -u "github.com/heroiclabs/nakama-common@v1.23.0"
    ```

   ⚠️ __NOTE__: If you're working on Nakama's master branch drop the `@v1.23.0` from the above snippet.

   ⚠️ __NOTE__: The official Nakama v3.12.+ expects nakama-common v1.23.0 in order to run. If you use v1.22.0, older, or drop the version reference, you might get a `plugin was built with a different version of package` error while starting up the Nakama server.

4. Develop your plugin code (you can use the [minimal example](#minimal-example) as a starting point) and save it within your plugin project directory with the `.go` extension.

## Build & load process

In a regular development cycle you will often recompile your plugin code and rerun the server.

1. Develop and compile your code.

    ```bash
    go build -buildmode=plugin -trimpath -o ./plugin_code.so
    ```

2. Use `--runtime.path` flag when you start the Nakama server binary to load your built plugin. (Note: Also make sure you run the database).

    ```bash
    ./nakama --runtime.path "$HOME/plugin_code"
    ```

   __TIP__: You can either build and run Nakama from source or you can download a prebuilt binary for your platform [here](https://github.com/heroiclabs/nakama/releases).

For more information on how the server loads modules have a look at [these](https://heroiclabs.com/docs/runtime-code-basics/#load-modules) docs. For general instructions on how to run the server give [these](https://heroiclabs.com/docs/install-start-server/#start-nakama) docs a read.

### Docker builds

It's often easiest to run the game server with Docker Compose. It will start the game server and database server together in the right sequence and wraps the process up into a single command. You'll need the Docker engine installed to use it.

For Windows development and environments where you want to use our official Docker images to run your containers we provide a container image to help you build your code.

1. Use the Docker plugin helper container to compile your project (works for bash/PowerShell):

    ```bash
    cd "$HOME/plugin_code" # Your project folder. See instructions above.
    docker run --rm -w "/builder" -v "${PWD}:/builder" heroiclabs/nakama-pluginbuilder:3.12.0 build -buildmode=plugin -trimpath -o ./modules/plugin_code.so
    ```

   In the command above we bind-mount your current folder into the container and use the Go toolchain inside it to run the build. The output artifacts are written back into your host filesystem.

2. Use our official Docker Compose [file](https://heroiclabs.com/docs/nakama/getting-started/install/docker/#running-nakama) to run all containers together and load in your custom module.

    __NOTE:__ You should copy the `.so` files generated in step 1. to the `/modules` folder of your Nakama source files and then run the command below from the Nakama root directory.

    ```bash
    docker-compose up
    ```

   By default the server will be started and look in a folder relative to the current dir called "./modules" to load the plugins.

   __TIP__: Use the same version of your plugin builder image as used in the Docker Compose file for the server version. i.e. "heroiclabs/nakama:2.3.1" <> "heroiclabs/nakama-pluginbuilder:2.3.1",  etc.

## Bigger Example

Have a look in this repo for more example code on how to create and use various parts of the game server Go runtime support. The project implements a fully authoritative example of tic-tac-toe in Go, Lua and TS.

https://github.com/heroiclabs/nakama-project-template
