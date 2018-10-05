# docker build . --rm --build-arg version=2.0.4 --build-arg commit=master -t heroiclabs/nakama:2.0.4

FROM golang:1.11.1-alpine3.7 as builder

ARG commit

RUN apk --no-cache add ca-certificates gcc musl-dev git

WORKDIR /go/src/github.com/heroiclabs/
RUN git config --global advice.detachedHead false && \
  git clone -q -n https://github.com/heroiclabs/nakama

WORKDIR /go/src/github.com/heroiclabs/nakama
RUN git checkout -q "$commit" && \
  GOOS=linux GOARCH=amd64 go build && \
  mkdir -p /go/build && \
  mv nakama /go/build

FROM alpine:3.7

MAINTAINER Heroic Labs <support@heroiclabs.com>

ARG version

LABEL version=$version
LABEL variant=nakama
LABEL description="Distributed server for social and realtime games and apps."

RUN mkdir -p /nakama/data/modules && \
  apk --no-cache add ca-certificates curl iproute2 unzip rsync git

WORKDIR /nakama/
COPY --from=builder "/go/build/nakama" /nakama/
EXPOSE 7349 7350 7351

ENTRYPOINT ["./nakama"]

HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:7350/ || exit 1

