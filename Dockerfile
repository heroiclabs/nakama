# =========================
# Stage 1: Build Nakama binary
# =========================
FROM golang:1.25-alpine AS builder

ENV GO111MODULE=on \
    CGO_ENABLED=0

RUN apk add --no-cache git make

WORKDIR /go/src/github.com/heroiclabs/nakama
COPY . .
RUN go build -trimpath -mod=vendor -ldflags "-s -w" -o nakama .


# =========================
# Stage 2: Compile TypeScript modules
# =========================
FROM node:18-alpine AS modules

WORKDIR /build

# Copy your Nakama runtime modules
COPY data/modules ./data/modules

# Install TypeScript and compile to JS
RUN npm install -g typescript && \
    mkdir -p ./data/modules/build && \
    cd ./data/modules && \
    if ls *.ts 1> /dev/null 2>&1; then \
        if [ -f tsconfig.json ]; then \
            tsc; \
        else \
            tsc --outDir ./build --target ES2015 --module commonjs --moduleResolution node *.ts; \
        fi \
    else \
        mkdir -p ./build; \
    fi


# =========================
# Stage 3: Final Nakama runtime image
# =========================
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

# Nakama directory structure
RUN mkdir -p /nakama/config /nakama/data /nakama/logs /nakama/data/modules /nakama/data/modules/lua

# Copy Nakama binary
COPY --from=builder /go/src/github.com/heroiclabs/nakama/nakama /nakama/nakama

# Copy compiled JS modules from build stage
COPY --from=modules /build/data/modules/build /nakama/data/modules

# Copy Lua modules from source
COPY data/modules/lua /nakama/data/modules/lua

# Copy config
COPY config.yaml /nakama/config/config.yaml

RUN addgroup -S nakama && adduser -S nakama -G nakama && chown -R nakama:nakama /nakama
USER nakama
WORKDIR /nakama

EXPOSE 7349 7350 7351

ENTRYPOINT ["/nakama/nakama"]
CMD ["--name", "nakama", "--config", "/nakama/config/config.yaml", "--logger.level", "info"]
