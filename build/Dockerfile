FROM golang:1.24.3-bookworm AS builder

ENV GOOS linux
ENV CGO_ENABLED 1

RUN apt-get update && \
    apt-get -y upgrade && \
    apt-get install -y --no-install-recommends ca-certificates gcc libc6-dev

WORKDIR /go/build/nakama

COPY . .

RUN go build -o /go/build-out/nakama -trimpath -mod=vendor -gcflags "-trimpath $PWD" -asmflags "-trimpath $PWD" -ldflags "-s -w -X main.version=local"

FROM debian:bookworm-slim

MAINTAINER Heroic Labs <support@heroiclabs.com>

ARG version

LABEL version=$version
LABEL variant=nakama
LABEL description="Distributed server for social and realtime games and apps."

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
