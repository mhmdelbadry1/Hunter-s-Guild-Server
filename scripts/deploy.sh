#!/bin/bash
# Hunter's Guild Minecraft Server - Deployment Script
# Run this on your VPS to set up the server

set -e

echo "=========================================="
echo "  Hunter's Guild - Deployment Script"
echo "=========================================="

# Check for Docker
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing..."
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    echo "Docker installed. Please log out and back in, then run this script again."
    exit 0
fi

# Check for Docker Compose
if ! docker compose version &> /dev/null; then
    echo "Docker Compose not found. Please install Docker Compose v2."
    exit 1
fi

# Create .env if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env from template..."
    cp .env.example .env
    
    # Generate secure secrets
    JWT_SECRET=$(openssl rand -base64 32)
    SESSION_SECRET=$(openssl rand -base64 32)
    
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
    sed -i "s/SESSION_SECRET=.*/SESSION_SECRET=$SESSION_SECRET/" .env
    
    echo ""
    echo "✅ Created .env file with secure secrets"
    echo "⚠️  Please edit .env to set:"
    echo "   - DOMAIN (your domain name)"
    echo "   - ADMIN_EMAIL (login email)"
    echo "   - ADMIN_PASS (login password)"
    echo "   - MC_VERSION (Minecraft version)"
    echo "   - SERVER_TYPE (vanilla, paper, forge, fabric)"
    echo ""
    echo "Then run this script again."
    exit 0
fi

# Validate required env vars
source .env
if [ -z "$ADMIN_EMAIL" ] || [ "$ADMIN_EMAIL" == "admin@example.com" ]; then
    echo "❌ Please set ADMIN_EMAIL in .env"
    exit 1
fi
if [ -z "$ADMIN_PASS" ] || [ "$ADMIN_PASS" == "changeme" ]; then
    echo "❌ Please set ADMIN_PASS in .env"
    exit 1
fi

echo "Configuration validated ✅"
echo ""

# Build and start
echo "Building containers..."
docker compose build

echo ""
echo "Starting services..."
docker compose up -d

echo ""
echo "=========================================="
echo "  Deployment Complete! 🎉"
echo "=========================================="
echo ""
echo "Services:"
docker compose ps
echo ""

if [ -n "$DOMAIN" ]; then
    echo "🌍 Panel URL: https://$DOMAIN"
else
    echo "🌍 Panel URL: http://localhost (or your server IP)"
fi
echo "🎮 Minecraft Server: Your server IP:${SERVER_PORT:-25565}"
echo ""
echo "Commands:"
echo "  View logs:     docker compose logs -f"
echo "  Stop all:      docker compose down"
echo "  Restart:       docker compose restart"
echo ""
