<p align="center">
  <a href="https://heroiclabs.com" target="_blank" rel="noopener">
    <img src="./.github/nakama.png" alt="Nakama - Distributed server for social and realtime games and apps" />
  </a>
</p>

<p align="center">
  <a href="https://heroiclabs.com/docs/nakama/getting-started/install/"><img src="https://img.shields.io/github/release/heroiclabs/nakama.svg?colorA=18181B&colorB=825df2" alt="Version"></a>
  <a href="https://hub.docker.com/r/heroiclabs/nakama"><img src="https://img.shields.io/docker/pulls/heroiclabs/nakama?colorA=18181B&colorB=825df2&label=downloads" alt="Downloads"></a>
  <a href="https://github.com/heroiclabs/nakama/blob/master/LICENSE"><img src="https://img.shields.io/github/license/heroiclabs/nakama.svg?colorA=18181B&colorB=825df2" alt="License"></a>
  <a href="https://forum.heroiclabs.com"><img src="https://img.shields.io/badge/Nakama%20Forum-18181B?logo=discourse" alt="Nakama Forum"></a>
  <a href="https://heroiclabs.com/docs"><img src="https://img.shields.io/badge/Nakama%20Docs-18181B?logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzU3IiBoZWlnaHQ9IjU3OSIgdmlld0JveD0iMCAwIDM1NyA1NzkiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTI3Ljc1NyAzMzYuNDQ2QzExNC4yMjUgMzM2Ljc0MyAxMDcuNzA1IDMxOS45MDYgMTAzLjk1MiAzMDguNzE0QzEwNy4yMTIgMzA4LjgxMyAxMTAuNDcxIDMwOS4wMTEgMTEzLjYzMiAzMDkuMzA4QzEyMC44NDMgMzEwLjEwMSAxMjguMDU0IDMxMi4xODEgMTMyLjY5NiAzMTguMjIyQzEzOS4xMTcgMzI2LjQ0MyAxMzMuODgyIDMzNi4zNDcgMTI3Ljg1NiAzMzYuNDQ2TTIyOS43OTYgMzM2LjQ0NkMyNDMuMzI4IDMzNi43NDMgMjQ5Ljg0OCAzMTkuOTA2IDI1My42MDEgMzA4LjcxNEMyNTAuMzQxIDMwOC44MTMgMjQ3LjA4MiAzMDkuMDExIDI0My45MjEgMzA5LjMwOEMyMzYuNzEgMzEwLjEwMSAyMjkuNDk5IDMxMi4xODEgMjI0Ljg1NyAzMTguMjIyQzIxOC40MzYgMzI2LjQ0MyAyMjMuNjcxIDMzNi4zNDcgMjI5LjY5NyAzMzYuNDQ2SDIyOS43OTZaTTE3OC4xMzQgNTMzLjQ0MUwxNzguNzI3IDUzNC4xMzRMMTc5LjQxOSA1MzMuNDQxQzE5NC42MyA1MTMuMDM4IDE5Ny42OTMgNDc0LjExNCAxNzguNzI3IDQ1NS41OTRDMTYwLjA1OCA0NzUuMjA0IDE2Mi41MjcgNTEyLjU0MyAxNzguMTM0IDUzMy40NDFaTTE3Ny45MzcgMC41OTQyNTJMMTc4LjcyNyAwTDE3OS41MTcgMC41OTQyNTJDMTk4Ljk3NyAxNC4xNjMgMjEzLjIwMSAyOC4zMjYgMjI3LjEyOSA0Ny44MzczQzI3MS44NzUgMTEwLjIzNCAzMDAuOTE2IDIxMC41NjMgMjkxLjczIDI4NC45NDRDMzEyLjk2NyAyOTQuMTU1IDMyOS41NjIgMzA5LjQwNyAzNDAuNzI0IDMyOC4yMjVDMzU4LjcwMSAzNTguNjMxIDM2Ni4wMTEgNDIwLjAzNyAzNDAuMzI5IDQ1MS45MjlDMzA3LjgzMSA0MzQuMDAyIDI2MC44MTIgNDE5Ljc0IDIxNC4xODkgNDMyLjkxM0wyMDQuODA1IDQzNi45NzRDMjI5Ljc5NiA0NzAuNTQ5IDIyOS45OTMgNTE1LjUxNCAyMDcuMDc3IDU0OS4wODlDMTk3LjI5NyA1NjMuNDUgMTg5Ljk4OCA1NjcuODA4IDE3OC40MzEgNTc5QzE2Ni42NzYgNTY4LjcgMTU4Ljg3MyA1NjIuMzYxIDE0OS43ODUgNTQ5LjA4OUMxMjYuOTY3IDUxNS41MTQgMTI3LjA2NiA0NzAuNTQ5IDE1Mi4wNTcgNDM2Ljk3NEwxNDIuNzcyIDQzMi45MTNDOTYuMTQ4NCA0MTkuNzQgNDkuMTI5OCA0MzQuMDAyIDE2LjYzMTcgNDUxLjkyOUMtOC45NTE4OCA0MjAuMDM3IC0xLjc0MTA1IDM1OC42MzEgMTYuMjM2NiAzMjguMjI1QzI3LjM5ODYgMzA5LjMwOCA0NC4wOTIxIDI5NC4wNTYgNjUuMjMwNyAyODQuOTQ0QzU2LjA0NDMgMjEwLjU2MyA4NS4wODUyIDExMC4yMzQgMTI5LjgzMiA0Ny44MzczQzE0My44NTggMjguMzI2IDE1Ny45ODQgMTQuMTYzIDE3Ny40NDMgMC41OTQyNTJIMTc3LjkzN1pNMzIyLjg0NSA0MDkuMjQyQzMyNy4wOTIgMzg3LjA1NiAzMjMuNzM0IDM2My4zODUgMzEyLjg2OCAzNDQuOTY0QzMwNi4xNTEgMzMzLjY3MyAyOTYuNjY5IDMyNC4zNjMgMjg0LjcxNiAzMTcuOTI1QzI4MS41NTUgMzI3LjgyOSAyNzcuNTA2IDMzNi44NDIgMjcyLjQ2OCAzNDQuODY1QzI1Ny4zNTUgMzY5LjEzIDIyMy41NzMgMzc4LjQ0IDIwMi4zMzUgMzU3LjY0MUMxNzIuOTk4IDMyOC44MiAxOTQuNTMyIDI3NC4wNDkgMjUzLjEwNyAyNzUuOTMxTDI2MC4xMjEgMjc2LjYyNUMyNjcuNTI5IDIwMi4zNDMgMjMzLjU0OSA5Mi40MDYzIDE3OC42MjggNDIuMjkxQzEyMy43MDggOTIuNTA1MyA4OS44MjY1IDIwMi4zNDMgOTcuMTM2MiAyNzYuNjI1TDEwNC4xNDkgMjc1LjkzMUMxNjIuNzI1IDI3NC4wNDkgMTg0LjM1NyAzMjguNzIxIDE1NC45MjIgMzU3LjY0MUMxMzMuNzgzIDM3OC40NCA5OS45MDE5IDM2OS4xMyA4NC43ODg4IDM0NC44NjVDNzkuNzUxMiAzMzYuODQyIDc1LjcwMTIgMzI3LjczIDcyLjU0MDMgMzE3LjkyNUM2MC41ODgxIDMyNC4zNjMgNTEuMTA1NCAzMzMuNzcyIDQ0LjM4ODUgMzQ0Ljk2NEMzMy41MjI4IDM2My4zODUgMzAuMTY0NCAzODcuMDU2IDM0LjQxMTggNDA5LjI0MkM4Ni4yNzA1IDM5MC4yMjYgMTI4LjM1IDM5MC43MjEgMTc4LjUzIDQxMi4zMTJDMjI4LjgwOCAzOTAuNjIyIDI3MC43ODkgMzkwLjIyNiAzMjIuNjQ3IDQwOS4yNDJIMzIyLjg0NVoiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=" alt="Nakama Documentation"></a>
</p>

## Features

* **Users** - Register/login new users via social networks, email, or device ID.
* **Storage** - Store user records, settings, and other objects in collections.
* **Social** - Users can connect with friends, and join groups. Builtin social graph to see how users can be connected.
* **Chat** - 1-on-1, group, and global chat between users. Persist messages for chat history.
* **Multiplayer** - Realtime, or turn-based active and passive multiplayer.
* **Leaderboards** - Dynamic, seasonal, get top members, or members around a user. Have as many as you need.
* **Tournaments** - Invite players to compete together over prizes. Link many together to create leagues.
* **Parties** - Add team play to a game. Users can form a party and communicate with party members.
* **Purchase Validation** - Validate in-app purchases and subscriptions.
* **In-App Notifications** - Send messages and notifications to connected client sockets.
* **Runtime code** - Extend the server with custom logic written in Lua, TypeScript/JavaScript, or native Go code.
* **Matchmaker**, **dashboard**, **metrics**, and [more](https://heroiclabs.com/docs).

Build scalable games and apps with a production ready server used by ambitious game studios and app developers [all around the world](https://heroiclabs.com/customers/). Have a look at the [documentation](https://heroiclabs.com/docs) and join the [developer community](https://forum.heroiclabs.com) for more info.

## Getting Started

The server is simple to setup and run for local development and can be deployed to any cloud provider. See the [deployment notes](#deployment) for recommendations on how to deploy the project for production. Nakama server requires CockroachDB or another Postgres wire-compatible server as it's database.

### Docker

<a href="https://heroiclabs.com/docs/install-docker-quickstart/"><img src="https://upload.wikimedia.org/wikipedia/en/f/f4/Docker_logo.svg" width="170"></a>

The fastest way to run the server and the database is with Docker. Setup Docker and start the daemon.

1. Set up a [docker-compose file](https://heroiclabs.com/docs/nakama/getting-started/install/docker/#running-nakama) and place it in a folder for your project.

2. Run `docker-compose -f ./docker-compose.yml up` to download container images and run the servers.

For more detailed instructions have a look at our [Docker quickstart](https://heroiclabs.com/docs/nakama/getting-started/install/docker) guide.

Nakama Docker images are maintained on [Docker Hub](https://hub.docker.com/r/heroiclabs/nakama/tags) and [prerelease](https://hub.docker.com/r/heroiclabs/nakama-prerelease/tags) images are occasionally published for cutting edge features of the server.

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

When connected you'll see server output which describes all settings the server uses for [configuration](https://heroiclabs.com/docs/nakama/getting-started/configuration).

> {"level":"info","ts":"2018-04-29T10:14:41.249+0100","msg":"Node","name":"nakama","version":"2.0.0+7e18b09","runtime":"go1.10.1","cpu":4} <br/>
> {"level":"info","ts":"2018-04-29T10:14:41.249+0100","msg":"Database connections","dsns":["root@127.0.0.1:26257"]} <br/>
> ...

## Usage

Nakama supports a variety of protocols optimized for various gameplay or app use cases. For request/response it can use GRPC or the HTTP1.1+JSON fallback (REST). For realtime communication you can use WebSockets or rUDP.

For example with the REST API to authenticate a user account with a device identifier.

```shell
curl "127.0.0.1:7350/v2/account/authenticate/device?create=true" \
  --user "defaultkey:" \
  --data '{"id": "someuniqueidentifier"}'
```

Response:

> { <br>
>     "token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE1MjQ5OTU2NDksInVpZCI6Ijk5Y2Q1YzUyLWE5ODgtNGI2NC04YThhLTVmMTM5YTg4MTgxMiIsInVzbiI6InhBb1RxTUVSdFgifQ.-3_rXNYx3Q4jKuS7RkxeMWBzMNAm0vl93QxzRI8p_IY" <br>
> }

There's a number of official [client libraries](https://github.com/heroiclabs) available on GitHub with [documentation](https://heroiclabs.com/docs). The current platform/language support includes: .NET (in C#), Unity engine, JavaScript, Java (with Android), Unreal engine, Godot, Defold, and Swift (with iOS). If you'd like to contribute a client or request one let us know.

## Nakama Console

The server provides a web UI which teams can use to inspect various data stored through the server APIs, view lightweight service metrics, manage player data, update storage objects, restrict access to production with permission profiles, and gain visibility into realtime features like active multiplayer matches. There is no separate installation required as it is embedded as part of the single server binary.

You can navigate to it on your browser on [http://127.0.0.1:7351](http://127.0.0.1:7351).


<details open>
<summary>View Screenshots</summary>
  <img src=".github/dashboard.png" alt="Nakama Console dashboard view" title="Dashboard view">
  <img src=".github/players.png" alt="Nakama Console players view" title="Players view">
  <img src=".github/api-explorer.png" alt="Nakama Console API explorer view" title="API explorer view">
  <img src=".github/storage.png" alt="Nakama Console storage view" title="Storage object view">
  <img src=".github/modules.png" alt="Nakama Console modules view" title="Runtime modules view">
</details>

## Deployment

Nakama can be deployed to any cloud provider such as Google Cloud, Azure, AWS, Digital Ocean, Heroku, or your own private cloud. You should setup and provision separate nodes for Nakama and CockroachDB.

The recommended minimum production infrastructure for CockroachDB is outlined in [these docs](https://www.cockroachlabs.com/docs/stable/recommended-production-settings.html#basic-hardware-recommendations) and Nakama can be run on instance types as small as "g1-small" on Google Cloud although we recommend a minimum of "n1-standard-1" in production. The specific hardware requirements will depend on what features of the server are used. Reach out to us for help and advice on what servers to run.

### Heroic Cloud

You can support development, new features, and maintainance of the server by using the Heroic Labs' [Heroic Cloud](https://heroiclabs.com/heroic-cloud/) for deployment. This service handles the uptime, replication, backups, logs, data upgrades, and all other tasks involved with production server environments.

Have a look at our [Heroic Cloud](https://heroiclabs.com/heroic-cloud/) service for more details.

## Contribute

The development roadmap is managed as GitHub issues and pull requests are welcome. If you're interested to add a feature which is not mentioned on the issue tracker please open one to create a discussion or drop in and discuss it in the [community forum](https://forum.heroiclabs.com).

### Simple Builds

All dependencies required for a build are vendored as part of the Go project. We recommend a modern release of the Go toolchain and do not store the codebase in the old GOPATH.

1. Download the source tree.

   ```shell
   git clone "https://github.com/heroiclabs/nakama" nakama
   cd nakama
   ```

2. Build the project from source.

   ```shell
   go build -trimpath -mod=vendor
   ./nakama --version
   ```

### Full Source Builds

The codebase uses Protocol Buffers, GRPC, GRPC-Gateway, buf, and the OpenAPI spec as part of the project. These dependencies are generated as sources and committed to the repository to simplify builds for contributors.

To build the codebase and generate all sources follow these steps.

1. Install the toolchain.

   ```shell
   go install \
       "google.golang.org/protobuf/cmd/protoc-gen-go" \
       "google.golang.org/grpc/cmd/protoc-gen-go-grpc" \
       "github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-grpc-gateway" \
       "github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-openapiv2"
   ```
2. Install [buf](https://buf.build/docs/cli/installation/).

3. Re-generate the protocol buffers and gateway code.
   ```shell
   # Run the shell script:
   ./buf.sh
   ```

4. Build the codebase.

   ```shell
   go build -trimpath -mod=vendor
   ```

### Testing

In order to run all the unit and integration tests run:

```shell
docker-compose -f ./docker-compose-tests.yml up --build --abort-on-container-exit; docker-compose -f ./docker-compose-tests.yml down -v
```

This will create an isolated environment with Nakama and database instances, run
all the tests, and drop the environment afterwards.

### License

This project is licensed under the [Apache-2 License](https://github.com/heroiclabs/nakama/blob/master/LICENSE).
