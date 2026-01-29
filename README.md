# Hunter's Guild - Minecraft Server Platform

A self-hosted, Docker-based Minecraft server management platform with dynamic version support.

## 🚀 Quick Start

```bash
# 1. Clone or copy this project
# 2. Configure environment
cp .env.example .env
# Edit .env with your settings

# 3. Start everything
docker compose up -d

# 4. Access the panel
# Local: http://localhost
# Production: https://your-domain.com
```

## 📁 Project Structure

```
├── docker-compose.yml      # Main orchestration
├── docker-compose.dev.yml  # Development mode
├── .env.example            # Configuration template
│
├── api/                    # Backend API service
├── frontend/               # React control panel
├── minecraft-server/       # MC server container
├── caddy/                  # Reverse proxy (auto-SSL)
└── scripts/                # Helper scripts
```

## 🎮 Supported Server Types

| Type | Description |
|------|-------------|
| `vanilla` | Official Mojang server |
| `paper` | High-performance Spigot fork |
| `forge` | Mod loader for Forge mods |
| `fabric` | Lightweight mod loader |

## ⚙️ Configuration

All configuration is done via environment variables in `.env`:

| Variable | Description | Default |
|----------|-------------|---------|
| `MC_VERSION` | Minecraft version | `1.21.8` |
| `SERVER_TYPE` | Server type | `forge` |
| `MC_MEMORY` | RAM allocation | `4G` |
| `DOMAIN` | Your domain (empty for localhost) | - |
| `ADMIN_EMAIL` | Admin login email | - |
| `ADMIN_PASS` | Admin password | - |

## 🔧 Common Operations

```bash
# View logs
docker compose logs -f minecraft

# Stop all services
docker compose down

# Rebuild after changes
docker compose build --no-cache

# Change MC version
# Edit MC_VERSION in .env, then:
docker compose up -d minecraft

# Backup world
docker compose exec minecraft /backup.sh
```

## 🔒 SSL/HTTPS

In production, set `DOMAIN` in `.env` and Caddy will automatically obtain SSL certificates from Let's Encrypt.

## 📦 Volumes

Data is persisted in Docker volumes:
- `minecraft-world`: World save data
- `minecraft-mods`: Installed mods
- `minecraft-config`: Server configuration
- `caddy-data`: SSL certificates

## 🛠️ Development

```bash
# Start in dev mode (hot reload)
docker compose -f docker-compose.dev.yml up

# Frontend only
cd frontend && npm start

# API only
cd api && npm run dev
```

## 📝 License

MIT License - Hunter's Guild © 2025
