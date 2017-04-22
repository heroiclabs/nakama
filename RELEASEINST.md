## Release Instructions

The current release infrastructure is built into the project's [Makefile](https://github.com/heroiclabs/nakama/blob/master/Makefile). You'll need both `curl` and [`jq`](https://stedolan.github.io/jq/) installed to upload releases onto GitHub.

To communicate with the GitHub releases API you'll need a [personal access token](https://help.github.com/articles/creating-an-access-token-for-command-line-use/). It's recommended you name it "Nakama Release Uploads" and store it in a file called `.GITHUB_TOKEN`.

### New releases

To generate a new release with cross-compiled builds for all supported target architectures run `make release`. You can find the build output in `"build/release/${version}/nakama-${platform}-${arch}"`.

```
build/release/${version}/
├── nakama-darwin-amd64
│   ├── CHANGELOG.md
│   ├── LICENSE
│   ├── README.md
│   └── nakama
├── nakama-${version}-darwin-amd64.tar.gz
...etc
```

### Upload a release

A release can only be uploaded with the correct personal access token permissions on GitHub and write permissions on the repository.

To upload a release run `make relupload TOKEN= TAG=` where `TOKEN` is your personal access token and `TAG` is the tag which has already been created on GitHub.

```
make relupload TOKEN="0aaa00119084689a7721a40951aa54a354aaa000" TAG="v0.10.0"
```

__Note__ This will upload all platforms/arch to a draft release on GitHub.

### Full release workflow

The development team use these steps to build and upload a release.

1. Update the `CHANGELOG.md`.

   Make sure to add the relevant `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security` sections as suggested by [keep a changelog](http://keepachangelog.com).

2. Update version in `Makefile` and commit. i.e. `VERSION := 0.10.0-dev` should become `VERSION := 0.10.0`.

   ```
   git add Makefile CHANGELOG.md
   git commit -m "Nakama 0.10.0 release."
   ```

3. Tag the release.

   __Note__ In source control good semver suggests a `"v"` prefix on a version. It helps group release tags.

   ```
   git tag -a v0.10.0 -m "v0.10.0"
   git push origin v0.10.0
   ```

4. Upload the release.

   ```
   make relupload TOKEN="gh personal access token" TAG="v0.10.0"
   ```

5. Login and access the [new draft release](https://github.com/heroiclabs/nakama/releases) on GitHub. Repeat the changelog in the release description. Then publish the release.

6. Create Docker image and push to Docker Hub. 

  ```
  docker login
  make docker dockerpush
  ```

7. Add new `## [Unreleased]` section to start of `CHANGELOG.md`. Increment and add suffix `"-dev"` to version in `Makefile` and commit. i.e. `VERSION := 0.10.0` should now become `VERSION := 0.11.0-dev`.

   ```
   git add Makefile CHANGELOG.md
   git commit -m "Set new development version."
   git push origin master
   ```

### Package Managers

#### Homebrew

The [Homebrew](http://brew.sh/) package manager for macOS is supported by our releases. The script is maintained in the repository at `"install/local/nakama.rb"`. This file is updated after a new release as needed.

#### Chocolatey

The [Chocolatey](https://chocolatey.org) package manager for Windows is supported by our releases. The scripts are maintained in the repository at "`install/local/chocolatey/`". These files are updated after a new release as needed.
