## Copyright 2018 The Nakama Authors
##
## Licensed under the Apache License, Version 2.0 (the "License");
## you may not use this file except in compliance with the License.
## You may obtain a copy of the License at
##
## http:##www.apache.org/licenses/LICENSE-2.0
##
## Unless required by applicable law or agreed to in writing, software
## distributed under the License is distributed on an "AS IS" BASIS,
## WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
## See the License for the specific language governing permissions and
## limitations under the License.

# docker build "$PWD" --file ./Dockerfile.pluginbuilder --build-arg commit="$(git rev-parse --short HEAD)" --build-arg version=v2.1.1 -t heroiclabs/nakama-pluginbuilder:2.1.1
# docker build "$PWD" --file ./Dockerfile.pluginbuilder --build-arg commit="$(git rev-parse --short HEAD)" --build-arg version="v2.1.1-$(git rev-parse --short HEAD)" -t heroiclabs/nakama-prerelease:"2.1.1-$(git rev-parse --short HEAD)"

FROM golang:1.12.6-alpine3.9 as builder

MAINTAINER Heroic Labs <support@heroiclabs.com>

ARG commit
ARG version

LABEL version=$version
LABEL variant=nakama-pluginbuilder
LABEL description="A support container to build Go code for Nakama server's runtime."

ENV GOOS linux
ENV GOARCH amd64
ENV CGO_ENABLED 1

RUN apk --no-cache add ca-certificates gcc musl-dev git && \
    git config --global advice.detachedHead false && \
    git clone --quiet --no-checkout https://github.com/heroiclabs/nakama.git /go/src/github.com/heroiclabs/nakama

WORKDIR /go/src/github.com/heroiclabs/nakama
RUN git checkout --quiet "$commit"

WORKDIR /go/src/tempbuild/

ENTRYPOINT ["go"]
