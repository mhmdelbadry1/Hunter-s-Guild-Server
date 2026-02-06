#!/bin/bash
# SevTech: Ages Deployment Script
# Run this on your AWS server to automatically download and deploy SevTech

set -e

echo "=========================================="
echo "  SevTech: Ages - Automated Deployment"
echo "=========================================="
echo ""

# Configuration
SEVTECH_VERSION="3.2.3"
MC_VERSION="1.12.2"
FORGE_VERSION="14.23.5.2859"
TEMP_DIR="/tmp/sevtech-deploy-$$"
SERVER_DIR="$HOME/Minecraft"
BACKUP_DIR="$HOME/minecraft-backups"

echo "📋 Configuration:"
echo "   SevTech Version: $SEVTECH_VERSION"
echo "   Minecraft: $MC_VERSION"
echo "   Forge: $FORGE_VERSION"
echo ""

# Step 1: Backup Docker volumes
echo "🔄 Step 1/7: Backing up Docker volumes..."
mkdir -p "$BACKUP_DIR"
BACKUP_NAME="backup-before-sevtech-$(date +%Y%m%d-%H%M%S)"

# Backup world volume
echo "   Backing up world data..."
docker run --rm \
  -v minecraft_minecraft-world:/data \
  -v "$BACKUP_DIR":/backup \
  ubuntu:22.04 \
  tar czf "/backup/${BACKUP_NAME}-world.tar.gz" -C /data . 2>/dev/null || echo "   (no world data)"

# Backup mods volume
echo "   Backing up mods..."
docker run --rm \
  -v minecraft_minecraft-mods:/data \
  -v "$BACKUP_DIR":/backup \
  ubuntu:22.04 \
  tar czf "/backup/${BACKUP_NAME}-mods.tar.gz" -C /data . 2>/dev/null || echo "   (no mods)"

# Backup config volume
echo "   Backing up configs..."
docker run --rm \
  -v minecraft_minecraft-config:/data \
  -v "$BACKUP_DIR":/backup \
  ubuntu:22.04 \
  tar czf "/backup/${BACKUP_NAME}-config.tar.gz" -C /data . 2>/dev/null || echo "   (no config)"

# Backup .env
cd "$SERVER_DIR"
if [ -f .env ]; then
    cp .env "$BACKUP_DIR/${BACKUP_NAME}.env"
fi

echo "✅ Backups saved to: $BACKUP_DIR"
echo ""

# Step 2: Download SevTech
echo "🔄 Step 2/7: Downloading SevTech: Ages $SEVTECH_VERSION..."
echo "   Size: ~500MB, using AWS bandwidth..."
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

if curl -L --fail --progress-bar -o sevtech-server.zip \
  "https://mediafilez.forgecdn.net/files/3570/46/SevTech_Ages_Server_3.2.3.zip"; then
    FILE_SIZE=$(stat -c%s sevtech-server.zip 2>/dev/null)
    if [ "$FILE_SIZE" -lt 100000 ]; then
        echo "❌ Download failed (file too small)"
        rm -f sevtech-server.zip
        echo ""
        echo "Manual download needed:"
        echo "  1. Download: https://www.curseforge.com/minecraft/modpacks/sevtech-ages/files/5193990"
        echo "  2. Upload: scp -i myprivatekey.pem SevTech*.zip ubuntu@13.60.37.55:$TEMP_DIR/sevtech-server.zip"
        echo "  3. Continue: $0 --skip-download"
        exit 1
    fi
    echo "✅ Downloaded $(du -h sevtech-server.zip | cut -f1)"
else
    echo "❌ Download failed"
    echo "Manual alternative: scp -i myprivatekey.pem SevTech*.zip ubuntu@13.60.37.55:$TEMP_DIR/sevtech-server.zip"
    exit 1
fi
echo ""

# Step 3: Extract files
echo "🔄 Step 3/7: Extracting SevTech files..."
if ! command -v unzip &> /dev/null; then
    sudo apt-get update -qq && sudo apt-get install -y unzip >/dev/null 2>&1
fi

if unzip -q sevtech-server.zip -d sevtech-extracted 2>/dev/null; then
    echo "✅ Extraction complete"
else
    echo "❌ Extraction failed"
    exit 1
fi
echo ""

# Step 4: Stop containers
echo "🔄 Step 4/7: Stopping Docker containers..."
cd "$SERVER_DIR"
docker compose down
echo "✅ Containers stopped"
echo ""

# Step 5: Clear Docker volumes
echo "🔄 Step 5/7: Clearing old mods and configs from Docker volumes..."
# Clear mods volume
docker run --rm -v minecraft_minecraft-mods:/data ubuntu:22.04 sh -c "rm -rf /data/*" 2>/dev/null || true
# Clear config volume  
docker run --rm -v minecraft_minecraft-config:/data ubuntu:22.04 sh -c "rm -rf /data/*" 2>/dev/null || true
# Clear world volume (fresh start)
docker run --rm -v minecraft_minecraft-world:/data ubuntu:22.04 sh -c "rm -rf /data/*" 2>/dev/null || true

# Clear host-mounted files
rm -rf minecraft-server/libraries/* 2>/dev/null || true
rm -f minecraft-server/*.jar 2>/dev/null || true
rm -f minecraft-server/run.sh 2>/dev/null || true

echo "✅ Old data cleared"
echo ""

# Step 6: Install SevTech to Docker volumes
echo "🔄 Step 6/7: Installing SevTech files to Docker volumes..."

# Copy mods to volume
if [ -d "$TEMP_DIR/sevtech-extracted/mods" ]; then
    docker run --rm \
      -v minecraft_minecraft-mods:/data \
      -v "$TEMP_DIR/sevtech-extracted/mods":/source \
      ubuntu:22.04 \
      sh -c "cp -r /source/* /data/"
    MOD_COUNT=$(docker run --rm -v minecraft_minecraft-mods:/data ubuntu:22.04 sh -c "ls /data | wc -l")
    echo "   ✓ Mods: $MOD_COUNT files"
fi

# Copy configs to volume
if [ -d "$TEMP_DIR/sevtech-extracted/config" ]; then
    docker run --rm \
      -v minecraft_minecraft-config:/data \
      -v "$TEMP_DIR/sevtech-extracted/config":/source \
      ubuntu:22.04 \
      sh -c "cp -r /source/* /data/"
    echo "   ✓ Configs: copied"
fi

# Copy libraries to host (if present)
if [ -d "$TEMP_DIR/sevtech-extracted/libraries" ]; then
    cp -r "$TEMP_DIR"/sevtech-extracted/libraries minecraft-server/
    echo "   ✓ Libraries: copied"
fi

# Copy scripts
for file in "$TEMP_DIR"/sevtech-extracted/*.sh; do
    if [ -f "$file" ]; then
        cp "$file" minecraft-server/
        chmod +x minecraft-server/$(basename "$file")
    fi
done

echo "✅ SevTech installed to Docker volumes"
echo ""

# Step 7: Update configuration
echo "🔄 Step 7/7: Updating configuration..."

if [ -f .env ]; then
    # Backup
    cp .env .env.backup-$(date +%Y%m%d-%H%M%S)
    
    # Update versions
    sed -i "s/^MC_VERSION=.*/MC_VERSION=$MC_VERSION/" .env
    grep -q "^MC_VERSION=" .env || echo "MC_VERSION=$MC_VERSION" >> .env
    
    sed -i "s/^FORGE_VERSION=.*/FORGE_VERSION=$FORGE_VERSION/" .env
    grep -q "^FORGE_VERSION=" .env || echo "FORGE_VERSION=$FORGE_VERSION" >> .env
    
    sed -i "s/^SERVER_TYPE=.*/SERVER_TYPE=forge/" .env
    grep -q "^SERVER_TYPE=" .env || echo "SERVER_TYPE=forge" >> .env
    
    sed -i "s/^MC_MEMORY=.*/MC_MEMORY=6G/" .env
    grep -q "^MC_MEMORY=" .env || echo "MC_MEMORY=6G" >> .env
    
    echo "   ✓ .env: MC $MC_VERSION, Forge $FORGE_VERSION, RAM 6G"
fi

# Update server.properties
if [ -f minecraft-server/server.properties ]; then
    cp minecraft-server/server.properties minecraft-server/server.properties.backup-$(date +%Y%m%d-%H%M%S)
    
    sed -i 's/^view-distance=.*/view-distance=6/' minecraft-server/server.properties
    sed -i 's/^simulation-distance=.*/simulation-distance=6/' minecraft-server/server.properties
    sed -i 's/^motd=.*/motd=SevTech: Ages - Ramadan Vibes/' minecraft-server/server.properties
    
    echo "   ✓ server.properties: view-distance 6"
fi

echo "✅ Configuration updated"
echo ""

# Cleanup
rm -rf "$TEMP_DIR"

# Start server
echo "=========================================="
echo "  🚀 Starting SevTech: Ages Server"
echo "=========================================="
echo ""
docker compose up -d --build

echo "⏳ SevTech starting... (15-20 minutes)"
echo "   Following logs (Ctrl+C to exit, server continues)..."
echo ""
sleep 5

# Monitor logs
docker logs -f minecraft-server 2>&1 | while IFS= read -r line; do
    echo "$line"
    if echo "$line" | grep -qE "Done|Forge.*Loaded|Server.*started"; then
        sleep 2
        echo ""
        echo "=========================================="
        echo "  ✅ SevTech: Ages is Ready!"
        echo "=========================================="
        echo ""
        echo "📊 Server Configuration:"
        echo "   • Modpack: SevTech: Ages $SEVTECH_VERSION"
        echo "   • Minecraft: $MC_VERSION"
        echo "   • Forge: $FORGE_VERSION"
        echo "   • Mods: $MOD_COUNT"
        echo "   • Memory: 6GB"
        echo "   • View Distance: 6 chunks"
        echo ""
        echo "💾 Backups saved to:"
        echo "   $BACKUP_DIR/$BACKUP_NAME-*.tar.gz"
        echo ""
        echo "📝 Next Steps:"
        echo "   1. Dashboard: http://$(curl -s ifconfig.me 2>/dev/null || echo '13.60.37.55')"
        echo "   2. Navigate: Modpack Distribution"
        echo "   3. Generate: Client modpack (.mrpack)"
        echo "   4. Distribute: Share with players"
        echo "   5. Import: Prism Launcher"
        echo ""
        echo "🔧 Commands:"
        echo "   docker logs -f minecraft-server              # View logs"
        echo "   docker exec minecraft-server rcon-cli forge tps   # Check TPS"
        echo "   docker compose restart minecraft              # Restart"
        echo ""
        echo "�� To restore backup if needed:"
        echo "   docker run --rm -v minecraft_minecraft-world:/data -v $BACKUP_DIR:/backup \\"
        echo "     ubuntu:22.04 tar xzf /backup/$BACKUP_NAME-world.tar.gz -C /data"
        echo ""
        pkill -P $$ docker 2>/dev/null
        exit 0
    fi
done
