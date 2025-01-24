#!/bin/bash

set -evxu

TAG=$(git describe --tags --abbrev=0) # Get release version.
VERSION=${TAG#v} # Remove 'v' from TAG.
COMMIT=$(git rev-parse --short HEAD 2>/dev/null) # Get HEAD commit short hash

# NOTES to run locally.
# On arm Macs Rosetta must be disabled in Docker Desktop - in settings under Virtual Machine Options check 'Docker VMM'.
# It's required to create a docker context for the multi-arch builds
# > docker context create builder
# > docker buildx create --use builder

docker buildx build .. --platform linux/amd64,linux/arm64 --file ./Dockerfile --build-arg COMMIT="$COMMIT" --build-arg VERSION="$VERSION" -t heroiclabs/nakama:"$VERSION" -t heroiclabs/nakama:latest --push
docker buildx build .. --platform linux/amd64,linux/arm64 --file ./Dockerfile.dsym --build-arg COMMIT="$COMMIT" --build-arg VERSION="$VERSION" -t heroiclabs/nakama-dsym:"$VERSION" -t heroiclabs/nakama-dsym:latest --push
docker buildx build .. --platform linux/amd64,linux/arm64 --file ./pluginbuilder/Dockerfile --build-arg COMMIT="$COMMIT" --build-arg VERSION="$VERSION" -t heroiclabs/nakama-pluginbuilder:"$VERSION" -t heroiclabs/nakama-pluginbuilder:latest --push
