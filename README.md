[![Gitter](https://img.shields.io/gitter/room/heroiclabs/nakama.svg?style=for-the-badge)](https://gitter.im/heroiclabs/nakama)
[![GitHub release](https://img.shields.io/github/release/heroiclabs/nakama.svg?style=for-the-badge)](https://heroiclabs.com/docs/nakama-download/)
[![license](https://img.shields.io/github/license/heroiclabs/nakama.svg?style=for-the-badge)](#)

## Nakama

> Distributed server for social and realtime games and apps.

### Features

* **Users** - Register/login new users via social networks, email, or device ID.
* **Storage** - Store user records, settings, and other objects in collections.
* **Social** - Users can connect with friends, and join groups. Builtin social graph to see how users can be connected.
* **Chat** - 1-on-1, group, and global chat between users. Persist messages for chat history.
* **Multiplayer** - Realtime, or turn-based active and passive multiplayer.
* **Leaderboards** - Dynamic, seasonal, get top members, or members around a user. Have as many as you need.
* **Runtime code** - Extend the server with custom logic written in Lua.
* **Matchmaker**, **dashboard**, **metrics**, etc, etc.

For more information have a look at the [documentation](https://heroiclabs.com/docs/) and for a quick list of build targets run `make help`.

If you encounter any issues with the server you can generate diagnostics for us with `nakama doctor`. Send these to support@heroiclabs.com or [open an issue](https://github.com/heroiclabs/nakama/issues).

### Start server

Have a look at our [documentation](https://heroiclabs.com/docs/running-nakama/) for a full introduction on how to run Nakama in development and/or production.

To start a server locally and bind it to all network interfaces once it's installed and on your path - run `nakama`. The server output will show how it's been configured by default.

```
$> nakama
{"level":"info","ts":"$$timestamp$$","msg":"Node","name":"nakama-97f4","version":"$$version$$"}
{"level":"info","ts":"$$timestamp$$","msg":"Data directory","path":"$$datadir$$"}
{"level":"info","ts":"$$timestamp$$","msg":"Database connections","dsns":["root@localhost:26257"]}
{"level":"info","ts":"$$timestamp$$","msg":"Evaluating modules","count":0,"modules":[]}
{"level":"info","ts":"$$timestamp$$","msg":"Dashboard","port":7351}
{"level":"info","ts":"$$timestamp$$","msg":"Dashboard","url":"http://127.0.0.1:7351"}
{"level":"info","ts":"$$timestamp$$","msg":"Client","port":7350}
```

### Run Nakama with Docker

Follow the [guide](https://heroiclabs.com/docs/install-docker-quickstart/) to run Nakama (and CockroachDB) in Docker.

<a href="https://heroiclabs.com/docs/install/docker/"><img src="https://upload.wikimedia.org/wikipedia/commons/7/79/Docker_%28container_engine%29_logo.png" width="170"></a>

Nakama Docker images are available on [Docker Hub](http://hub.docker.com/r/heroiclabs/nakama/). If you'd like to publish your own Docker image have a look at our [Docker README](https://github.com/heroiclabs/nakama/blob/master/install/docker/README.md).

#### Deploy Nakama with Docker Cloud

Nakama can be deployed to any cloud with Docker Cloud such as AWS, Google Cloud, Azure, Digital Ocean or your own private cloud. You'll need to setup Docker Cloud and provision separate nodes for Nakama and CockroachDB.

### Production deployments

Nakama server uses cockroachdb as its database server. You're responsible for the [uptime](https://en.wikipedia.org/wiki/Uptime), [replication](https://en.wikipedia.org/wiki/Replication_(computing)), [backups](https://en.wikipedia.org/wiki/Backup), logs, and upgrades of your data.

You also need to update the Nakama server with every new release and configure the server to auto-scale. If you use our Docker releases follow along with the "latest" image tag and check for new releases once a month.

[Using our managed cloud service](https://heroiclabs.com/managed-cloud/) helps save you time, development costs, and eliminates managing your own clusters which is simpler and cheaper as you grow. We recommend our [Managed cloud](https://heroiclabs.com/managed-cloud/) if you're running production games or apps.

### Contribute

To build the codebase you will need to install these dependencies:

* __go__ The Go compiler toolchain.
* __nodejs__ A JavaScript runtime.
* __dep__ A dependency manager for Go projects.
* __protobuf__ A toolchain used to create custom protocols.
* __make__ A rule-based build tool (installed by default on most platforms).

You'll need to setup your Go environment variables like `GOPATH` as usual. You can then install dependent build tools and code:

```
$> git clone https://github.com/heroiclabs/nakama
$> cd nakama
$> make gettools
$> dep ensure
```

To run a Nakama server you'll need to connect it to a database. The system has been specially designed to work with CockroachDB for storage and queries. You can install it on OS X with `brew install cockroach`. For more detailed instructions see their [documentation](https://www.cockroachlabs.com/docs/install-cockroachdb.html).

For development run:

```
$> make dbstart nakama
$> ./build/dev/nakama
```

To develop the admin dashboard:
```
$> cd dashboard; npm run dev
```

__NOTE__: The first time you setup the cockroach database you must initialize the schema with `make dbstart dbsetup`.
