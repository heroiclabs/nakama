FROM alpine:3.7

MAINTAINER Heroic Labs <support@heroiclabs.com>

ARG version

LABEL version=$version
LABEL variant=nakama
LABEL description="Distributed server for social and realtime games and apps."

RUN mkdir -p /nakama/data/modules && \
  apk --no-cache add ca-certificates curl iproute2

WORKDIR /nakama/
COPY ./nakama ./nakama
EXPOSE 7349 7350 7351

# set entry point to nakama so that it can be invoked from the `docker run nakama`
ENTRYPOINT ["./nakama"]

# curl fails on non-200 HTTP status code
HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:7350/ || exit 1
