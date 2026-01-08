#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

DOMAIN="elderwood-rp.com"
EMAIL="mehdibuyse@hotmail.com"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  SSL Certificate Setup for $DOMAIN    ${NC}"
echo -e "${GREEN}========================================${NC}"

# Create required directories
mkdir -p certbot/conf certbot/www

# Step 1: Temporarily disable HTTPS config (rename default.conf)
echo -e "${YELLOW}Step 1: Disabling HTTPS config temporarily...${NC}"
if [ -f nginx/conf.d/default.conf ]; then
    mv nginx/conf.d/default.conf nginx/conf.d/default.conf.bak
fi

# Step 2: Stop all services
echo -e "${YELLOW}Step 2: Stopping services...${NC}"
docker compose -f docker-compose.prod.yml down 2>/dev/null || true

# Step 3: Start only nginx with HTTP config
echo -e "${YELLOW}Step 3: Starting nginx with HTTP-only config...${NC}"
docker compose -f docker-compose.prod.yml up -d nginx

# Wait for nginx to start
echo -e "${YELLOW}Waiting for nginx to start...${NC}"
sleep 5

# Test if nginx is serving the challenge path
echo -e "${YELLOW}Testing ACME challenge path...${NC}"
curl -s http://localhost/.well-known/acme-challenge/test || echo "(This is expected to 404)"

# Step 4: Get certificate
echo -e "${YELLOW}Step 4: Obtaining SSL certificate...${NC}"
docker compose -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d $DOMAIN \
    -d api.$DOMAIN \
    -d admin.$DOMAIN \
    -d console.$DOMAIN

# Step 5: Check if certificate was created
if [ -d "certbot/conf/live/$DOMAIN" ]; then
    echo -e "${GREEN}Certificate obtained successfully!${NC}"

    # Step 6: Restore HTTPS config
    echo -e "${YELLOW}Step 5: Restoring HTTPS config...${NC}"
    if [ -f nginx/conf.d/default.conf.bak ]; then
        mv nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
    fi

    # Remove the init-ssl config
    rm -f nginx/conf.d/init-ssl.conf

    # Step 7: Restart all services
    echo -e "${YELLOW}Step 6: Starting all services with HTTPS...${NC}"
    docker compose -f docker-compose.prod.yml down
    docker compose -f docker-compose.prod.yml up -d

    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  SSL Setup Complete!                   ${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "Your services are now available at:"
    echo -e "  ${GREEN}https://admin.$DOMAIN${NC} - Admin Panel"
    echo -e "  ${GREEN}https://api.$DOMAIN${NC} - Game API"
    echo -e "  ${GREEN}https://console.$DOMAIN${NC} - Nakama Console"
else
    echo -e "${RED}Certificate was NOT obtained.${NC}"
    echo -e "${RED}Check the certbot logs above for errors.${NC}"

    # Restore config anyway
    if [ -f nginx/conf.d/default.conf.bak ]; then
        mv nginx/conf.d/default.conf.bak nginx/conf.d/default.conf
    fi

    exit 1
fi
