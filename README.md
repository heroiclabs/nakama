## Nakama

> Distributed server for social and realtime games and apps.

For more information have a look at the [documentation](https://heroiclabs.com/docs/) and for a quick list of build targets run `make help`.

If you encounter any issues with the server you can generate diagnostics for us with `nakama doctor`. Send these to support@heroiclabs.com or [open an issue](https://github.com/heroiclabs/nakama/issues).

### Start server

Have a look at our [documentation](https://heroiclabs.com/docs/start-server/) for a full introduction on how to run Nakama in development and/or production.

To start a server locally and bind it to all network interfaces once it's installed and on your path - `nakama`. The server output will show how it's been configured by default.

```
$> nakama
[I] Nakama starting at=$$now$$
[I] Node name=nakama-97f4 version=$$version$$
[I] Data directory path=$$datadir$$
[I] Dashboard url=http://127.0.0.1:7351
[I] Client port=7350
[I] Startup done
```

### Contribute

To build the codebase you will need to install these dependencies:

* __go__ The Go compiler toolchain.
* __nodejs__ A JavaScript runtime.
* __glide__ A dependency manager for Go projects.
* __protobuf__ A toolchain used to create custom protocols.
* __make__ A rule-based build tool (installed by default on most platforms).

You'll need to setup your Go environment variables like `GOPATH` as usual. You can then install dependent build tools and code:

```
$> git clone https://github.com/heroiclabs/nakama
$> cd nakama
$> make gettools
$> glide install
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
