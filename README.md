![Nakama](.github/logo.png?raw=true "Nakama logo")
======

[![GitHub release](https://img.shields.io/github/release/heroiclabs/nakama.svg)](https://heroiclabs.com/docs/nakama-download/)
[![Forum](https://img.shields.io/badge/forum-online-success.svg)](https://forum.heroiclabs.com)
[![License](https://img.shields.io/github/license/heroiclabs/nakama.svg)](https://github.com/heroiclabs/nakama/blob/master/LICENSE)

> Distributed server for social and realtime games and apps.

## Features

* **Users** - Register/login new users via social networks, email, or device ID.
* **Storage** - Store user records, settings, and other objects in collections.
* **Social** - Users can connect with friends, and join groups. Builtin social graph to see how users can be connected.
* **Chat** - 1-on-1, group, and global chat between users. Persist messages for chat history.
* **Multiplayer** - Realtime, or turn-based active and passive multiplayer.
* **Leaderboards** - Dynamic, seasonal, get top members, or members around a user. Have as many as you need.
* **Tournaments** - Invite players to compete together over prizes. Link many together to create leagues.
* **Runtime code** - Extend the server with custom logic written in Lua or native Go code.
* **Matchmaker**, **dashboard**, **metrics**, and [more](https://heroiclabs.com/docs).

Build scalable games and apps with a production ready server used by ambitious game studios and app developers [all around the world](https://heroiclabs.com). Have a look at the [documentation](https://heroiclabs.com/docs) and join the [developer community](https://forum.heroiclabs.com) for more info.

## Getting Started

The server is simple to setup and run for local development and can be deployed to any cloud provider. See the [deployment notes](#deployment) for recommendations on how to deploy the project for production. Nakama server requires CockroachDB as it's database.

### Docker

<a href="https://heroiclabs.com/docs/install/docker/"><img src="https://upload.wikimedia.org/wikipedia/commons/7/79/Docker_%28container_engine%29_logo.png" width="170"></a>

The fastest way to run the server and the database is with Docker. Setup Docker and start the daemon.

1. Set up a [docker-compose file](https://heroiclabs.com/docs/install-docker-quickstart/#using-docker-compose) and place it in a folder for your project.
2. Run `docker-compose -f ./docker-compose.yml up` to download container images and run the servers.

For more detailed instructions have a look at our [Docker quickstart](https://heroiclabs.com/docs/install-docker-quickstart) guide.

Nakama Docker images are maintained on [Docker Hub](https://hub.docker.com/r/heroiclabs/nakama/tags) and [prerelease](https://hub.docker.com/r/heroiclabs/nakama-prerelease/tags) images are published for cutting edge features of the server.

### Binaries

You can run the servers with native binaries for your platform.

1. Download the server from our [releases](https://github.com/heroiclabs/nakama/releases) page and the [database](https://www.cockroachlabs.com/docs/stable/install-cockroachdb.html).
2. Follow the database [instructions](https://www.cockroachlabs.com/docs/stable/start-a-local-cluster.html#before-you-begin) to start it.
3. Run a migration which will setup or upgrade the database schema:

    ```shell
    nakama migrate up --database.address "root@127.0.0.1:26257"
    ```

4. Start Nakama and connect to the database:

    ```shell
    nakama --database.address "root@127.0.0.1:26257"
    ```

When connected you'll see server output which describes all settings the server uses for [configuration](https://heroiclabs.com/docs/install-configuration).

> {"level":"info","ts":"2018-04-29T10:14:41.249+0100","msg":"Node","name":"nakama","version":"2.0.0+7e18b09","runtime":"go1.10.1","cpu":4} <br/>
> {"level":"info","ts":"2018-04-29T10:14:41.249+0100","msg":"Database connections","dsns":["root@127.0.0.1:26257"]} <br/>
> ...

## Usage

Nakama supports a variety of protocols optimized for various gameplay or app use cases. For request/response it can use GRPC or the HTTP1.1+JSON fallback (REST). For realtime communication you can use WebSockets or rUDP.

For example with the REST API to authenticate a user account with a custom identifier.

```shell
curl "http://127.0.0.1:7350/v2/account/authenticate/custom?create=true&username=allmight" \
  --user "defaultkey:" \
  --data '{"id": "someuniqueidentifier"}'
```

Response:

> { <br>
>     "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE1MjQ5OTU2NDksInVpZCI6Ijk5Y2Q1YzUyLWE5ODgtNGI2NC04YThhLTVmMTM5YTg4MTgxMiIsInVzbiI6InhBb1RxTUVSdFgifQ.-3_rXNYx3Q4jKuS7RkxeMWBzMNAm0vl93QxzRI8p_IY" <br>
> }

There's a number of official [client libraries](https://github.com/heroiclabs) available on GitHub with [documentation](https://heroiclabs.com/docs). The current platform/language support includes: .NET (in C#), Unity engine, JavaScript, Java (with Android), Unreal engine, and Swift (with iOS). If you'd like to contribute a client or request one let us know.

## Developer Console

Nakama has an embedded Web UI that is intended to be used by developers during their project development. You can navigate to it on your browser on [http://127.0.0.1:7351](http://127.0.0.1:7351).

<img src=".github/login.jpg?raw=true" title="Login view" width="125" align="left">
<img src=".github/status.jpg?raw=true" title="Status view" width="125" align="left">
<img src=".github/users.jpg?raw=true" title="Users listing" width="125" align="left">
<img src=".github/user_details.jpg?raw=true" title="User detail view" width="125" align="left">
<img src=".github/storage.jpg?raw=true" title="Storage record view" width="125" align="left">
<img src=".github/config.jpg?raw=true" title="Configuration view" width="125">

## Deployment

Nakama can be deployed to any cloud provider such as Google Cloud, Azure, AWS, Digital Ocean, Heroku, or your own private cloud. You should setup and provision separate nodes for Nakama and CockroachDB.

The recommended minimum production infrastructure for CockroachDB is outlined in [these docs](https://www.cockroachlabs.com/docs/stable/recommended-production-settings.html#basic-hardware-recommendations) and Nakama can be run on instance types as small as "g1-small" on Google Cloud although we recommend a minimum of "n1-standard-1" in production. The specific hardware requirements will depend on what features of the server are used. Reach out to us for help and advice on what servers to run.

### Managed Cloud

You can support development, new features, and maintainance of the server by using the Heroic Labs' [Managed Cloud](https://heroiclabs.com/managed-cloud) for deployment. This service handles the uptime, replication, backups, logs, data upgrades, and all other tasks involved with production server environments.

Have a look at our [Managed Cloud](https://heroiclabs.com/managed-cloud) service for more details.

## Contribute

The development roadmap is managed as GitHub issues and pull requests are welcome. If you're interested to add a feature which is not mentioned on the issue tracker please open one to create a discussion or drop in and discuss it in the [community forum](https://forum.heroiclabs.com).

### Simple Builds

All dependencies required for a build are vendored as part of the Go project. You'll need a recent version of the Go toolchain and must setup the `$GOPATH`.

```shell
git clone https://github.com/heroiclabs/nakama.git $GOPATH/src/github.com/heroiclabs/nakama
cd $GOPATH/src/github.com/heroiclabs/nakama
go build -trimpath
```

### Full Source Builds

The codebase uses Protocol Buffers, GRPC, and the OpenAPI specification as part of the project. These dependencies are generated as sources and committed to the repository to simplify builds for contributors.

To build the codebase and generate all sources use these steps.

1. Install the toolchain.

    ```shell
    go get -u github.com/grpc-ecosystem/grpc-gateway/protoc-gen-grpc-gateway
    go get -u github.com/grpc-ecosystem/grpc-gateway/protoc-gen-swagger
    go get -u github.com/golang/protobuf/protoc-gen-go
    go get -u github.com/gobuffalo/packr/...
    ```

2. If you've made changes to the embedded Developer Console:

    ```shell
    cd console/ui
    yarn run build
    cd ../../
    ```

3. Compile protocol buffers, gateway code, and pack the SQL migration files. Then build the codebase.

    ```shell
    protoc -I/usr/local/include -I. -I$GOPATH/src -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway --go_out=plugins=grpc:. ./api/api.proto
    protoc -I/usr/local/include -I. -I$GOPATH/src -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway/third_party/googleapis -I$GOPATH/src/github.com/grpc-ecosystem/grpc-gateway --grpc-gateway_out=logtostderr=true:. ./api/api.proto
    packr -z
    go build --trimpath
    ```

### License

This project is licensed under the [Apache-2 License](https://github.com/heroiclabs/nakama/blob/master/LICENSE).
