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
# Stage 2: Compile TypeScript modules (if any)
# =========================
FROM node:18-alpine AS modules
WORKDIR /build

# Copy your Nakama runtime modules
COPY data/modules ./modules

WORKDIR /build/modules

# Install TypeScript (optional, only if you have .ts files other than index.js)
RUN npm install -g typescript

# Compile TypeScript files to JavaScript (skip index.js)
RUN if ls *.ts 1> /dev/null 2>&1; then \
        echo "Compiling TypeScript modules..." && \
        tsc --target ES2015 --module commonjs --skipLibCheck true *.ts 2>&1 || true; \
    fi && \
    echo "Module preparation complete"

# =========================
# Stage 3: Final Nakama runtime image
# =========================
FROM alpine:3.19

RUN apk add --no-cache ca-certificates

# Nakama directory structure
RUN mkdir -p /nakama/config /nakama/data/modules /nakama/logs

# Copy Nakama binary
COPY --from=builder /go/src/github.com/heroiclabs/nakama/nakama /nakama/nakama

# Copy ALL module files (.js, .ts, .lua)
COPY --from=modules /build/modules /nakama/data/modules

WORKDIR /nakama

RUN addgroup -S nakama && adduser -S nakama -G nakama && chown -R nakama:nakama /nakama

USER nakama

EXPOSE 7349 7350 7351

ENTRYPOINT ["/nakama/nakama"]
CMD ["--name", "nakama", "--config", "/nakama/config/config.yaml", "--logger.level", "info"]
