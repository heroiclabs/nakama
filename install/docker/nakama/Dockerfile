FROM ubuntu:xenial

MAINTAINER Heroic Labs <support@heroiclabs.com>

ARG version

LABEL version=$version
LABEL variant=nakama
LABEL description="Distributed server for social and realtime games and apps."

RUN mkdir -p /nakama/data/log/ \
  && touch /nakama/data/log/nakama.log
WORKDIR /nakama/

# forward logs to docker log collector
# docker logs are JSON by default
RUN ln -sf /dev/stdout data/log/nakama.log \
  && apt-get update \
  && apt-get install -y curl ca-certificates \
  && apt-get autoclean \
  && rm -rf /var/lib/apt/lists/* \
  && echo "Fetching https://github.com/heroiclabs/nakama/releases/download/v$version/nakama-$version-linux-amd64.tar.gz ..." \
  && curl -sL https://github.com/heroiclabs/nakama/releases/download/v$version/nakama-$version-linux-amd64.tar.gz | tar xz

EXPOSE 7350 7351

# set entry point to nakama so that it can be invoked from the `docker run nakama`
ENTRYPOINT ["/nakama/nakama"]

# curl fails on non-200 HTTP status code
HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:7350/ || exit 1
