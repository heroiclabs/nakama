#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Elderwood Nakama - Deployment Script  ${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please copy .env.example to .env and configure it:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    exit 1
fi

# Load environment variables
source .env

# Validate required variables
if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "CHANGE_ME_STRONG_PASSWORD_HERE" ]; then
    echo -e "${RED}Error: Please set a strong POSTGRES_PASSWORD in .env${NC}"
    exit 1
fi

if [ -z "$ADMIN_PASSWORD" ] || [ "$ADMIN_PASSWORD" = "CHANGE_ME_STRONG_PASSWORD_HERE" ]; then
    echo -e "${RED}Error: Please set a strong ADMIN_PASSWORD in .env${NC}"
    exit 1
fi

if [ -z "$DOMAIN" ] || [ "$DOMAIN" = "elderwood.example.com" ]; then
    echo -e "${RED}Error: Please set your DOMAIN in .env${NC}"
    exit 1
fi

# Create required directories
echo -e "${YELLOW}Creating directories...${NC}"
mkdir -p certbot/conf certbot/www

# Function to get SSL certificate
get_ssl_cert() {
    echo -e "${YELLOW}Obtaining SSL certificate for $DOMAIN...${NC}"

    # Create temporary nginx config for HTTP challenge
    cat > nginx/conf.d/temp.conf << 'EOF'
server {
    listen 80;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOF

    # Start nginx temporarily
    docker compose -f docker-compose.prod.yml up -d nginx
    sleep 5

    # Get certificate
    docker compose -f docker-compose.prod.yml run --rm certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email $EMAIL \
        --agree-tos \
        --no-eff-email \
        -d $DOMAIN \
        -d api.$DOMAIN \
        -d admin.$DOMAIN \
        -d console.$DOMAIN

    # Remove temp config
    rm nginx/conf.d/temp.conf

    # Stop nginx
    docker compose -f docker-compose.prod.yml down
}

# Check if SSL certificate exists
if [ ! -d "certbot/conf/live/$DOMAIN" ]; then
    echo -e "${YELLOW}SSL certificate not found.${NC}"
    read -p "Do you want to obtain an SSL certificate? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        get_ssl_cert
    else
        echo -e "${RED}SSL certificate is required for production deployment.${NC}"
        exit 1
    fi
fi

# Update nginx config with actual domain
echo -e "${YELLOW}Updating nginx configuration...${NC}"
sed -i "s/elderwood.example.com/$DOMAIN/g" nginx/conf.d/default.conf

# Build Go plugin first (needed because volume mount overrides container files)
echo -e "${YELLOW}Building Go plugin...${NC}"
if [ -f "./build-plugin.sh" ]; then
    chmod +x ./build-plugin.sh
    ./build-plugin.sh
else
    echo -e "${RED}Warning: build-plugin.sh not found. Go RPCs may not work.${NC}"
fi

# Build and start services
echo -e "${YELLOW}Building and starting services...${NC}"
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d

# Wait for services to be healthy
echo -e "${YELLOW}Waiting for services to start...${NC}"
sleep 10

# Check service status
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!                  ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Services:"
docker compose -f docker-compose.prod.yml ps
echo ""
echo -e "${GREEN}URLs:${NC}"
echo -e "  Game API:      https://api.$DOMAIN"
echo -e "  Admin Panel:   https://admin.$DOMAIN"
echo -e "  Nakama Console: https://console.$DOMAIN"
echo ""
echo -e "${YELLOW}Default admin credentials:${NC}"
echo -e "  Username: $ADMIN_USER"
echo -e "  Password: (from .env)"
echo ""
echo -e "${RED}IMPORTANT: Restrict access to console.$DOMAIN with IP whitelist!${NC}"
