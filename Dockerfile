FROM golang:1.25-alpine AS builder

ENV GO111MODULE=on \
    CGO_ENABLED=0

RUN apk add --no-cache git make

WORKDIR /go/src/github.com/heroiclabs/nakama
COPY . .
RUN go build -trimpath -mod=vendor -ldflags "-s -w" -o nakama .

FROM node:18-alpine AS modules

WORKDIR /build

Copy your Nakama runtime modules
COPY data/modules ./data/modules

# Install TypeScript and compile to JS
RUN npm install -g typescript && \
    mkdir -p ./data/modules/build && \
    cd ./data/modules && \
    if ls .ts 1> /dev/null 2>&1; then \
        echo "Compiling TypeScript modules..." && \
        if [ -f tsconfig.json ]; then \
            tsc || echo "TypeScript compilation completed with warnings (expected if Nakama types are not defined)"; \
        else \
            tsc --outDir ./build --target ES2015 --module commonjs --moduleResolution node.ts  echo "TypeScript compilation completed with warnings"; \
        fi && \
        test -d ./build  mkdir -p ./build; \
    else \
        mkdir -p ./build; \
    fi

FROM alpine:3.19

RUN apk add --no-cache ca-certificates

# Nakama directory structure
RUN mkdir -p /nakama/config /nakama/data /nakama/logs /nakama/data/modules /nakama/data/modules/lua

# Copy Nakama binary
COPY --from=builder /go/src/github.com/heroiclabs/nakama/nakama /nakama/nakama

Copy compiled JS modules from build stage
COPY --from=modules /build/data/modules/build /nakama/data/modules

# Copy Lua modules from source
COPY data/modules /nakama/data/modules

RUN addgroup -S nakama && adduser -S nakama -G nakama && chown -R nakama:nakama /nakama
USER nakama
WORKDIR /nakama

EXPOSE 7349 7350 7351

ENTRYPOINT ["/nakama/nakama"]
CMD ["--name", "nakama", "--config", "/nakama/config/config.yaml", "--logger.level", "info"]
