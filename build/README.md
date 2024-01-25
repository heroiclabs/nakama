Release Instructions
===

These instructions guide the release process for new official Nakama server builds.

## Steps

To build releases for a variety of platforms we use the excellent [xgo](https://github.com/techknowlogick/xgo) project. You will need Docker engine installed. These steps should be followed from the project root folder.

These steps are one off to install the required build utilities.

1. Install the xgo Docker image.

   ```bash
   docker pull techknowlogick/xgo:latest
   ```

2. Install the command line helper tool. Ensure "$GOPATH/bin" is on your system path to access the executable.

   ```bash
   go install src.techknowlogick.com/xgo@latest
   ```

These steps are run for each new release.

1. Update the CHANGELOG.

2. Add the CHANGELOG file and tag a commit.

   __Note__: In source control good semver suggests a "v" prefix on a version. It helps group release tags.

   ```bash
   git add CHANGELOG.md
   git commit -m "Nakama 2.1.0 release."
   git tag -a v2.1.0 -m "v2.1.0"
   git push origin v2.1.0 master
   ```

3. Execute the cross-compiled build helper.

   ```bash
   xgo --targets=darwin/arm64,darwin/amd64,linux/amd64,linux/arm64,windows/amd64 --trimpath --ldflags "-s -w -X main.version=2.1.0 -X main.commitID=$(git rev-parse --short HEAD 2>/dev/null)" github.com/heroiclabs/nakama
   ```

   This will build binaries for all target platforms supported officially by Heroic Labs.

4. Package up each release as a compressed bundle.

   ```bash
   tar -czf "nakama-<os>-<arch>.tar.gz" nakama README.md LICENSE CHANGELOG.md
   ```

5. Create a new draft release on GitHub and publish it with the compressed bundles.

## Build Nakama Image

To build releases for a variety of platforms we [docker buildx](https://github.com/docker/buildx?tab=readme-ov-file) which is supported by default for Docker engine on Windows and MacOS, otherwise for Linux the plugin must be [setup manually](https://github.com/docker/buildx?tab=readme-ov-file#linux-packages).

These steps are one off to install the required build utilities.

1. Setup the docker buildx environment

   ```bash
   docker context create container
   docker buildx create --use container
   ```

2. If you are running a fork of the repo you will need to update the docker build argument to point to your https remote:

   ```bash
   # build/multiarch_build
   # build/multiarch_build_dsym
   --build-arg repo=https://github.com/$USERNAME/nakama.git
   ```

3. For one off single builds you can use the default docker build engine with:

   ```bash
   docker build "$PWD" \
     --build-arg repo="https://github.com/heroiclabs/nakama.git"
     --build-arg commit="$(git rev-parse --short HEAD)" \
     --build-arg version="$(git tag -l --sort=-creatordate | head -n 1)" \
     -t heroiclabs/nakama:${"$(git tag -l --sort=-creatordate | head -n 1)":1}
   ```

4. With everything setup all you need to do is run the script:

   ```bash
   cd build
   ./multiarch_build
   ```

## Build Nakama Image (dSYM)

With the release generated we can also create an official container image which includes debug symbols.

1. Ensure you have the docker buildx environment setup from above
2. Run the multiarch dsym script:

   ```bash
   cd build
   ./multiarch_build_dsym
   ```

## Build Plugin Builder Image

With the official release image generated we can create a container image to help with Go runtime development.

1. Ensure you have the docker buildx environment setup from above
2. Run the multiarch script:

   ```bash
   cd build
   ./multiarch_pluginbuilder
   ```
