Hiro
===

> The server interface for the Hiro game framework.

[Hiro](https://heroiclabs.com/hiro/) is a client and server framework built on top of [Nakama server](https://heroiclabs.com/nakama/) to rapidly build high performance, flexible, and composable gameplay systems like Achievements, Energies, Event Leaderboards, and much more.

The code is divided into a Go package of interfaces and a client package for one of these supported languages and game engines:

- A C# DLL which is packaged with utilities (such as UnityPurchasing, Unity Mobile Notifications, etc) for Unity Engine,
- An Unreal plugin, as well as CPP support for other engines,
- TypeScript-based JavaScript package for web games,
- And a Godot asset written in GDScript.

This repository maintains the public interfaces which make it easy to use the library from inside a Nakama game server project to extend and build additional gameplay systems. You can explore the features with an [API client](https://www.usebruno.com/) when you import the "hiro-openapi.yml" collection.

To learn more about Hiro and integrate it into your game project, have a look at these resources:

- [heroiclabs.com/hiro](https://heroiclabs.com/hiro/)
- [heroiclabs.com/docs/hiro](https://heroiclabs.com/docs/hiro/)

Reach out to [Heroic Labs](mailto:sales@heroiclabs.com) for more information about how to license Hiro as a developer or as part of a game studio.

### Setup

1. Set up the Go toolchain.
2. Set up your [Nakama project with Go](https://heroiclabs.com/docs/nakama/server-framework/go-runtime/#initialize-the-project).
3. Add Hiro to your project as a dependency:

   ```shell
   go get "github.com/heroiclabs/hiro@latest"
   ```

4. Sign up to the [Heroic Cloud](https://cloud.heroiclabs.com) and contact us to obtain licenses to Hiro.
5. Download and unzip the package. Add "hiro.bin" to your codebase.
6. Follow the [usage](#usage) instructions for how to get started.

### Usage

The game framework initializes and returns the configured gameplay systems with `Init`: 

```go
package main

import (
	"context"
	"database/sql"
	"github.com/heroiclabs/hiro"
	"github.com/heroiclabs/nakama-common/runtime"
)

func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	systems, err := hiro.Init(ctx, logger, nk, initializer, "hiro.bin", "LicenseKey",
		hiro.WithEconomySystem("economy.json", true),
		hiro.WithEnergySystem("energy.json", true),
		hiro.WithInventorySystem("inventory.json", true))
	if err != nil {
		return err
	}

	// systems.GetEnergySystem().Get(...)
	// ...

	return nil
}
```

For examples on how to write data definitions for the gameplay systems have a look at the [documentation](https://heroiclabs.com/docs/hiro/).

### License

This codebase is licensed under the [Apache-2 License](https://github.com/heroiclabs/hiro/blob/master/LICENSE).
