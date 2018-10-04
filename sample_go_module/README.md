# Nakama Go Runtime

Nakama Go Runtime uses the [Go Plugin](https://golang.org/pkg/plugin/) package to run custom server logic. If you've used the existing [Nakama Lua Runtime](https://heroiclabs.com/docs/runtime-code-basics/), then it should be pretty straight forward to use the Go Runtime as the APIs are very similar.

You can find more information about the Nakama Go Runtime on the [website](https://heroiclabs.com/docs/runtime-code-basics/).

## Plugin depedencies

You'll need to ensure that you have `heroiclabs/nakama/rtapi` and `heroiclabs/nakama/runtime` available in your `GOPATH`. You can then begin to implement the neccessary function that Nakama needs to interact with your plugin. Ensure that you have implemented the `InitModule` function as Nakama uses this as the entry point to your plugin.

You can find more information about the Nakama Go Runtime on the [website](https://heroiclabs.com/docs/runtime-code-basics/).

## Build plugin

### Binary

If you are running Nakama as a [binary](https://heroiclabs.com/docs/install-binary/), then you can easily build your plugin and instruct Nakama to load the shared object.

To do so, simply run the following command to build the plugin:

```
go build -buildmode=plugin
```

This will produce a `.so` file (platform dependant) that you'll need to place in the [modules directory](https://heroiclabs.com/docs/runtime-code-basics/#load-modules) of Nakama. You can then [start Nakama](https://heroiclabs.com/docs/install-start-server/#start-nakama) as usual.

### Docker 

If you are running Nakama through the [Docker image](https://heroiclabs.com/docs/install-docker-quickstart/), you'll need to also compile the plugin via the provided docker builder recipe. This is a known limitation in the Go compile toolchain as it cannot cross-compile plugins.

Copy the content of the [`plugin.Dockerfile`](https://github.com/heroiclabs/nakama/blob/master/build/plugin.Dockerfile) onto your system and run the following command:

```
docker build <DockerContext> --file "/absolute/path/to/plugin.Dockerfile" --build-arg src="relative/path/to/<ModuleName>"
```

1. Ensure that you change the `<DockerContext>` folder with the absolute path to your project folder.
2. Ensure that the `<ModuleName>` folder is inside the `<DockerContext>` project folder you referenced above.
3. Ensure that you update the absolute path of the `plugin.Dockerfile`.

For example:

```
docker build "/go/src/github.com/heroiclabs/nakama" --file "/home/plugin.Dockerfile" --build-arg src="sample_go_module"
```

Docker will then compile your plugin. To load the compiled plugin, you'll need to extract the shared object from the docker container:

```
docker run --rm --entrypoint cat <ContainerId> /go/build/<ModuleName>.so > /home/<ModuleName>.so
```

Make sure that you change the `<ContainerId>` with the actual container identifier. You can do this by running

```
docker images
```

The compiled shared object file is on your desktop. You can move the shared object to a folder that you've assigned as your runtime module folder. Have a look at [this](https://heroiclabs.com/docs/install-start-server/#lua-modules) for more info.
