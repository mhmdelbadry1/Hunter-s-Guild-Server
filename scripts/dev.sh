#!/bin/bash
# Quick Start Script for Development

echo "Starting Hunter's Guild in development mode..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "Creating .env from template..."
    cp .env.example .env
    echo "✅ Created .env - using default dev settings"
fi

# Start with dev compose
docker compose -f docker-compose.dev.yml up --build
