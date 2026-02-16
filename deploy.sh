#!/bin/bash

# Bilibili Discord Bot - Oracle Cloud Deployment Script
# This script automates the deployment process on Oracle Cloud Free Tier

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================"
echo "Bilibili Discord Bot Deployment"
echo -e "======================================${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create a .env file with your Discord token and other configurations."
    echo "You can copy .env.example as a starting point:"
    echo "  cp .env.example .env"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${YELLOW}Docker not found. Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${GREEN}Docker installed successfully!${NC}"
    echo -e "${YELLOW}Please log out and log back in for group changes to take effect.${NC}"
    exit 0
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo -e "${YELLOW}Docker Compose not found. Installing...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/download/v2.24.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}Docker Compose installed successfully!${NC}"
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Stop existing container if running
echo -e "${YELLOW}Stopping existing containers...${NC}"
docker-compose down 2>/dev/null || true

# Remove old images (optional, saves space)
echo -e "${YELLOW}Cleaning up old images...${NC}"
docker image prune -f

# Build and start the bot
echo -e "${GREEN}Building and starting the bot...${NC}"
docker-compose up -d --build

# Wait for container to start
echo -e "${YELLOW}Waiting for container to start...${NC}"
sleep 5

# Check if container is running
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}======================================"
    echo "✓ Bot deployed successfully!"
    echo -e "======================================${NC}"
    echo ""
    echo "Useful commands:"
    echo "  View logs:       docker-compose logs -f"
    echo "  Stop bot:        docker-compose down"
    echo "  Restart bot:     docker-compose restart"
    echo "  View status:     docker-compose ps"
    echo ""
    echo "To view logs now, run:"
    echo "  docker-compose logs -f bilibili-bot"
else
    echo -e "${RED}======================================"
    echo "✗ Deployment failed!"
    echo -e "======================================${NC}"
    echo "Check logs with: docker-compose logs"
    exit 1
fi
