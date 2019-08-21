Release Instructions
===

These instructions guide the release process for new official Nakama server builds.

## Steps

To build releases for a variety of platforms we use the excellent [xgo](https://github.com/karalabe/xgo) project. You will need Docker engine installed. These steps should be followed from the project root folder.

These steps are one off to install the required build utilities.

1. Install the xgo Docker image.

   ```
   docker pull karalabe/xgo-latest
   ```

2. Install the command line helper tool. Ensure "$GOPATH/bin" is on your system path to access the executable.

   ```
   env GO111MODULE=off go get -u github.com/karalabe/xgo
   ```

These steps are run for each new release.

1. Update the CHANGELOG.

2. Add the CHANGELOG file and tag a commit.

   __Note__: In source control good semver suggests a "v" prefix on a version. It helps group release tags.

   ```
   git add CHANGELOG
   git commit -m "Nakama 2.1.0 release."
   git tag -a v2.1.0 -m "v2.1.0"
   git push origin v2.1.0 master
   ```

3. Execute the cross-compiled build helper.

   ```
   xgo --targets=darwin/amd64,linux/amd64,linux/arm64,windows/amd64 --ldflags "-s -w -X main.version=2.1.0 -X main.commitID=$(git rev-parse --short HEAD 2>/dev/null)" github.com/heroiclabs/nakama
   ```

   This will build binaries for all target platforms supported officially by Heroic Labs.

4. Package up each release as a compressed bundle.

   ```
   tar -czf "nakama-<os>-<arch>" nakama README.md LICENSE CHANGELOG.md
   ```

5. Create a new draft release on GitHub and publish it with the compressed bundles.

## Build Nakama Image

With the release generated we can create the official container image.

1. Build the container image.

   ```
   cd build
   docker build "$PWD" --file ./Dockerfile --build-arg commit="$(git rev-parse --short HEAD 2>/dev/null)" --build-arg version=2.6.0 -t heroiclabs/nakama:2.6.0
   ```

2. Push the image to the container registry.

   ```
   docker tag <CONTAINERID> heroiclabs/nakama:latest
   docker push heroiclabs/nakama:2.6.0
   docker push heroiclabs/nakama:latest
   ```

## Build Nakama Image for arm64v8

1. Build the container image

   ```
   cd build
   docker build "$PWD" --build-arg commit="$(git rev-parse --short HEAD)" --build-arg version=v2.6.0 -t heroiclabs/nakama:2.6.0-arm64v8 -f Dockerfile-arm64v8
   ```

2. Push the image to the container registry

   ```
   docker tag <CONTAINERID> heroiclabs/nakama:latest-arm64v8
   docker push heroiclabs/nakama:2.6.0-arm64v8
   docker push heroiclabs/nakama:latest-arm64v8
   ```



## Build Plugin Builder Image

With the official release image generated we can create a container image to help with Go runtime development.

1. Build the container image.

   ```
   cd build/pluginbuilder
   docker build "$PWD" --file ./Dockerfile --build-arg commit="$(git rev-parse --short HEAD 2>/dev/null)" --build-arg version=2.1.0 -t heroiclabs/nakama-pluginbuilder:2.1.0
   ```

2. Push the image to the container registry.

   ```
   docker tag <CONTAINERID> heroiclabs/nakama-pluginbuilder:latest
   docker push heroiclabs/nakama-pluginbuilder:2.1.0
   docker push heroiclabs/nakama-pluginbuilder:latest
   ```
