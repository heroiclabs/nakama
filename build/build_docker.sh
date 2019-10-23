#!/usr/bin/env bash

# Copyright 2018 The Nakama Authors.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

set -o errexit
set -o pipefail

VERSION="$1"
COMMIT="$2"

if [ -z "${VERSION}" ]; then
 echo "Error: no version entered. Exiting."
 exit 1
fi

if [ -z "${COMMIT}" ]; then
 echo "Error: no commit entered. Exiting."
 exit 1
fi

pushd "$(dirname "$0")"
    docker build . --file ./Dockerfile.alpine --no-cache --build-arg commit="${COMMIT}" \
        --build-arg version="v${VERSION}-${COMMIT}" \
        -t heroiclabs/nakama:"${VERSION}-alpine3.10-${COMMIT}"

    docker build . --file ./Dockerfile.debian --no-cache --build-arg commit="${COMMIT}" \
        --build-arg version="v${VERSION}-${COMMIT}" \
        -t heroiclabs/nakama:"${VERSION}-buster-${COMMIT}"
popd

pushd "$(dirname "$0")"/pluginbuilder
    docker build . --file ./Dockerfile.alpine --no-cache --build-arg commit="${COMMIT}" \
        --build-arg version="v${VERSION}-${COMMIT}" \
        -t heroiclabs/nakama-pluginbuilder:"${VERSION}-alpine3.10-${COMMIT}"

    docker build . --file ./Dockerfile.debian --no-cache --build-arg commit="${COMMIT}" \
        --build-arg version="v${VERSION}-${COMMIT}" \
        -t heroiclabs/nakama-pluginbuilder:"${VERSION}-buster-${COMMIT}"
popd
