# Build stage for Go plugin
FROM heroiclabs/nakama-pluginbuilder:3.24.2 AS builder

WORKDIR /backend

# Copy Go module files and source
COPY data/modules/go.mod .
COPY data/modules/*.go .

# Download dependencies and build
RUN go mod tidy
RUN go build -buildmode=plugin -trimpath -o ./elderwood.so .

# Final Nakama image
FROM heroiclabs/nakama:3.24.2

# Copy runtime modules (Lua, JS, TS)
COPY data /nakama/data

# Copy the compiled Go plugin (this will be overridden by volume mount, so we also need build-plugin.sh)
COPY --from=builder /backend/elderwood.so /nakama/data/modules/
