# docker build . --file ./build/plugin.Dockerfile --build-arg src=sample_go_module

FROM golang:1.11-alpine3.7 as builder

ARG src

WORKDIR /go/src/$src
COPY $src /go/src/$src

RUN apk --no-cache add ca-certificates gcc musl-dev git && \
  go get -u github.com/heroiclabs/nakama && \
  GOOS=linux go build -buildmode=plugin . && \
  mkdir -p /go/build && \
  mv "/go/src/$src/$src.so" /go/build/
