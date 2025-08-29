## Copyright 2018 The Nakama Authors
##
## Licensed under the Apache License, Version 2.0 (the "License");
## you may not use this file except in compliance with the License.
## You may obtain a copy of the License at
##
## http://www.apache.org/licenses/LICENSE-2.0
##
## Unless required by applicable law or agreed to in writing, software
## distributed under the License is distributed on an "AS IS" BASIS,
## WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
## See the License for the specific language governing permissions and
## limitations under the License.

# docker build . --build-arg commit="$(git rev-parse --short HEAD)" --build-arg version=v2.1.1 -t heroiclabs/nakama:2.1.1
# docker build . --build-arg commit="$(git rev-parse --short HEAD)" --build-arg version="$(git rev-parse --short HEAD)" -t heroiclabs/nakama-prerelease:"$(git rev-parse --short HEAD)"

FROM golang:1.25.0-bookworm AS builder

ARG COMMIT
ARG VERSION
ARG TARGETOS
ARG TARGETARCH

ENV GOOS=$TARGETOS
ENV GOARCH=$TARGETARCH
ENV CGO_ENABLED=1
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && \
    apt-get -y upgrade && \
    apt-get install -y --no-install-recommends ca-certificates gcc libc6-dev

WORKDIR /go/build/nakama
COPY . .
RUN go build -o /go/build-out/nakama -trimpath -mod=vendor -gcflags "-trimpath $PWD" -asmflags "-trimpath $PWD" -ldflags "-s -w -X main.version=$VERSION -X main.commitID=$COMMIT"

FROM debian:bookworm-slim

ARG VERSION

LABEL maintainer="Heroic Labs"
LABEL contact="support@heroiclabs.com"
LABEL version=$VERSION
LABEL variant=nakama
LABEL description="Distributed server for social and realtime games and apps."

ENV DEBIAN_FRONTEND=noninteractive

RUN mkdir -p /nakama/data/modules && \
    apt-get update && \
    apt-get -y upgrade && \
    apt-get install -y --no-install-recommends ca-certificates tzdata iproute2 tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /nakama/
COPY --from=builder "/go/build-out/nakama" /nakama/
EXPOSE 7349 7350 7351

ENTRYPOINT ["tini", "--", "/nakama/nakama"]

HEALTHCHECK --interval=30s --timeout=10s \
  CMD /nakama/nakama healthcheck || exit 1
