#!/bin/bash

set -evxu

TAG=$(git describe --tags --abbrev=0) # Get release version.
VERSION=${TAG#v} # Remove 'v' from TAG.
COMMIT=$(git rev-parse --short "$TAG" 2>/dev/null) # Get release commit short hash

# docker context create builder
# docker buildx create --use builder

# NOTE
# On arm Macs Rosetta must be disabled in Docker.

docker buildx build . --platform linux/amd64,linux/arm64 --file ./Dockerfile --build-arg COMMIT="$COMMIT" --build-arg VERSION="$VERSION" -t heroiclabs/nakama:"$VERSION" -t heroiclabs/nakama:latest #--push
# docker buildx build . --platform linux/amd64,linux/arm64 --file ./Dockerfile --build-arg COMMIT="$COMMIT" --build-arg VERSION="$VERSION" -t heroiclabs/nakama:"$VERSION" -t heroiclabs/nakama:latest -o type=image,name=nakamamultiarch
