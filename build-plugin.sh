#!/bin/bash
set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${YELLOW}Building Go plugin for Nakama...${NC}"

# Build only the builder stage and extract the elderwood.so
docker build --no-cache --target builder -t nakama-builder -f Dockerfile .

# Create a temporary container to copy the file
CONTAINER_ID=$(docker create nakama-builder)

# Copy the elderwood.so from the builder to the host's data/modules directory
docker cp "$CONTAINER_ID:/backend/elderwood.so" ./data/modules/elderwood.so

# Remove the temporary container
docker rm "$CONTAINER_ID"

echo -e "${GREEN}Plugin built and copied to ./data/modules/elderwood.so${NC}"

# Verify the file exists
if [ -f "./data/modules/elderwood.so" ]; then
    echo -e "${GREEN}✓ elderwood.so successfully deployed${NC}"
    ls -la ./data/modules/elderwood.so
else
    echo -e "${RED}✗ Failed to copy elderwood.so${NC}"
    exit 1
fi
