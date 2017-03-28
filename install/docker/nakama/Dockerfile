FROM ubuntu:xenial

MAINTAINER Heroic Labs <support@heroiclabs.com>

RUN mkdir -p /nakama
RUN mkdir -p /nakama/data/log/
RUN touch /nakama/data/log/nakama.log
WORKDIR /nakama/

# forward logs to docker log collector
# docker logs are JSON by default
RUN ln -sf /dev/stdout data/log/nakama.log

RUN apt-get update; apt-get install -y curl

RUN curl -sL https://github.com/heroiclabs/nakama/releases/download/v0.12.1/nakama-0.12.1-linux-amd64.tar.gz | tar xz

EXPOSE 7350 7351

# set entry point to nakama so that it can be invoked from the `docker run nakama`
ENTRYPOINT ["/nakama/nakama"]

# curl fails on non-200 HTTP status code
HEALTHCHECK --interval=5m --timeout=3s \
  CMD curl -f http://localhost:7351/v0/health/ || exit 1
