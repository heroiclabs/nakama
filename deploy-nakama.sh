#!/bin/bash
# Elderwood Nakama Deployment Script
# Handles the volume mount issue by extracting the compiled .so file

set -e

COMPOSE_FILE="docker-compose.prod.yml"
IMAGE_NAME="elderwood-nakama"
TEMP_CONTAINER="temp-nakama-deploy"

echo "=== Elderwood Nakama Deployment ==="
echo ""

# Step 1: Build the nakama image
echo "[1/5] Building Nakama image..."
docker compose -f $COMPOSE_FILE build --no-cache nakama

# Step 2: Remove any existing temp container
echo "[2/5] Cleaning up temporary containers..."
docker rm -f $TEMP_CONTAINER 2>/dev/null || true

# Step 3: Create temp container and extract .so file
echo "[3/5] Extracting compiled Go plugin..."
docker create --name $TEMP_CONTAINER ${IMAGE_NAME}:latest
docker cp $TEMP_CONTAINER:/nakama/data/modules/elderwood.so ./data/modules/elderwood.so
docker rm $TEMP_CONTAINER

echo "    -> elderwood.so copied to ./data/modules/"

# Step 4: Restart nakama
echo "[4/5] Restarting Nakama..."
docker compose -f $COMPOSE_FILE up -d nakama

# Step 5: Wait and verify
echo "[5/5] Verifying deployment..."
sleep 5

# Check RPC count
RPC_COUNT=$(docker compose -f $COMPOSE_FILE logs nakama 2>&1 | grep -o "[0-9]* RPCs registered" | tail -1)
DISCORD_STATUS=$(docker compose -f $COMPOSE_FILE logs nakama 2>&1 | grep -i "Discord RPCs registered" | tail -1)

echo ""
echo "=== Deployment Complete ==="
echo "RPC Status: $RPC_COUNT"
if [ -n "$DISCORD_STATUS" ]; then
    echo "Discord: OK"
else
    echo "Discord: WARNING - Discord RPCs may not be registered"
fi
echo ""
echo "To view full logs: docker compose -f $COMPOSE_FILE logs nakama"
