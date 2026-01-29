#!/bin/bash
# Minecraft Server Startup Script
# Dynamically downloads and runs the appropriate server type
# Handles version switching like Aternos - cleans old, downloads new, preserves world

set -e

echo "=========================================="
echo "  Hunter's Guild Minecraft Server"
echo "=========================================="
echo "Version: ${MC_VERSION}"
echo "Type: ${SERVER_TYPE}"
echo "Memory: ${MEMORY}"
echo "=========================================="

# Check EULA acceptance
if [ "${EULA}" != "TRUE" ]; then
    echo "ERROR: You must accept the Minecraft EULA."
    echo "Set EULA=TRUE in your environment."
    exit 1
fi

# Create eula.txt
echo "eula=true" > /server/eula.txt

# Version manifest URL
MANIFEST_URL="https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"

# ========================================
# VERSION CHANGE DETECTION
# ========================================
CURRENT_VERSION="${SERVER_TYPE}-${MC_VERSION}"
VERSION_FILE="/server/.current_version"

version_changed() {
    if [ ! -f "$VERSION_FILE" ]; then
        return 0  # No version file = first run
    fi
    
    local saved_version=$(cat "$VERSION_FILE")
    if [ "$saved_version" != "$CURRENT_VERSION" ]; then
        return 0  # Version changed
    fi
    
    return 1  # Same version
}

clean_old_server() {
    echo "🔄 Version change detected! Cleaning old server files..."
    
    # Remove old server files (but NOT world, mods, config)
    rm -f /server/server.jar
    rm -f /server/*.jar 2>/dev/null || true
    rm -rf /server/libraries 2>/dev/null || true
    rm -f /server/run.sh 2>/dev/null || true
    rm -f /server/run.bat 2>/dev/null || true
    rm -f /server/.server_type 2>/dev/null || true
    rm -f /server/user_jvm_args.txt 2>/dev/null || true
    
    # Keep these:
    # - /server/world/       (world data)
    # - /server/mods/        (mods)
    # - /server/config/      (mod configs)
    # - /server/server.properties (settings)
    
    echo "✅ Old server files cleaned. World and settings preserved."
}

# Check if version changed
if version_changed; then
    if [ -f "$VERSION_FILE" ]; then
        OLD_VERSION=$(cat "$VERSION_FILE")
        echo "📦 Switching from $OLD_VERSION to $CURRENT_VERSION"
    else
        echo "📦 First-time setup: $CURRENT_VERSION"
    fi
    clean_old_server
fi

# ========================================
# VERSION DOWNLOAD FUNCTIONS
# ========================================

get_vanilla_url() {
    local version=$1
    local manifest=$(curl -s "$MANIFEST_URL")
    local version_url=$(echo "$manifest" | jq -r ".versions[] | select(.id == \"$version\") | .url")
    
    if [ -z "$version_url" ] || [ "$version_url" == "null" ]; then
        echo "ERROR: Version $version not found" >&2
        return 1
    fi
    
    local version_data=$(curl -s "$version_url")
    echo "$version_data" | jq -r '.downloads.server.url'
}

download_vanilla() {
    local version=$1
    echo "📥 Downloading Vanilla $version..."
    
    local url=$(get_vanilla_url "$version")
    if [ -z "$url" ]; then
        echo "ERROR: Could not get download URL" >&2
        return 1
    fi
    
    curl -o /server/server.jar -L "$url"
    echo "✅ Vanilla $version downloaded"
}

download_paper() {
    local version=$1
    echo "📥 Downloading Paper for Minecraft $version..."
    
    # Get latest build
    local builds=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/$version/builds")
    local build=$(echo "$builds" | jq -r '.builds[-1].build')
    local download=$(echo "$builds" | jq -r '.builds[-1].downloads.application.name')
    
    if [ -z "$build" ] || [ "$build" == "null" ]; then
        echo "ERROR: No Paper build found for $version" >&2
        return 1
    fi
    
    curl -o /server/server.jar -L \
        "https://api.papermc.io/v2/projects/paper/versions/$version/builds/$build/downloads/$download"
    echo "✅ Paper $version (build $build) downloaded"
}

download_forge() {
    local mc_version=$1
    local forge_version=${FORGE_VERSION:-}
    
    echo "📥 Downloading Forge for Minecraft $mc_version..."
    
    # If no specific forge version, get latest
    if [ -z "$forge_version" ]; then
        local promotions=$(curl -s "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
        forge_version=$(echo "$promotions" | jq -r ".promos[\"${mc_version}-recommended\"] // .promos[\"${mc_version}-latest\"]")
    fi
    
    if [ -z "$forge_version" ] || [ "$forge_version" == "null" ]; then
        echo "ERROR: No Forge version found for Minecraft $mc_version" >&2
        return 1
    fi
    
    local full_version="${mc_version}-${forge_version}"
    local installer_url="https://maven.minecraftforge.net/net/minecraftforge/forge/${full_version}/forge-${full_version}-installer.jar"
    
    echo "📦 Installing Forge $full_version..."
    curl -o /tmp/forge-installer.jar -L "$installer_url"
    
    cd /server
    java -jar /tmp/forge-installer.jar --installServer
    rm /tmp/forge-installer.jar
    
    # Find the run script or jar
    if [ -f "/server/run.sh" ]; then
        chmod +x /server/run.sh
        echo "forge-run" > /server/.server_type
    else
        # For older forge versions
        local forge_jar=$(ls /server/forge-*.jar 2>/dev/null | grep -v installer | head -n 1)
        if [ -n "$forge_jar" ]; then
            ln -sf "$forge_jar" /server/server.jar
            echo "forge-jar" > /server/.server_type
        fi
    fi
    
    echo "✅ Forge $full_version installed"
}

download_fabric() {
    local mc_version=$1
    local loader_version=${FABRIC_LOADER_VERSION:-}
    
    echo "📥 Downloading Fabric for Minecraft $mc_version..."
    
    # Get latest loader version if not specified
    if [ -z "$loader_version" ]; then
        loader_version=$(curl -s "https://meta.fabricmc.net/v2/versions/loader" | jq -r '.[0].version')
    fi
    
    # Get latest installer version
    local installer_version=$(curl -s "https://meta.fabricmc.net/v2/versions/installer" | jq -r '.[0].version')
    
    local download_url="https://meta.fabricmc.net/v2/versions/loader/${mc_version}/${loader_version}/${installer_version}/server/jar"
    
    curl -o /server/server.jar -L "$download_url"
    echo "✅ Fabric loader $loader_version for MC $mc_version downloaded"
}

# ========================================
# MAIN DOWNLOAD LOGIC
# ========================================

download_server() {
    # Check if server already exists for this version
    if [ -f "/server/server.jar" ] && [ -f "$VERSION_FILE" ]; then
        local saved=$(cat "$VERSION_FILE")
        if [ "$saved" == "$CURRENT_VERSION" ]; then
            echo "✅ Server $CURRENT_VERSION already installed"
            return 0
        fi
    fi
    
    echo "🚀 Setting up $CURRENT_VERSION..."
    
    case "${SERVER_TYPE,,}" in
        vanilla)
            download_vanilla "$MC_VERSION"
            ;;
        paper)
            download_paper "$MC_VERSION"
            ;;
        forge)
            download_forge "$MC_VERSION"
            ;;
        fabric)
            download_fabric "$MC_VERSION"
            ;;
        *)
            echo "ERROR: Unknown server type: ${SERVER_TYPE}"
            echo "Valid options: vanilla, paper, forge, fabric"
            exit 1
            ;;
    esac
    
    # Save current version
    echo "$CURRENT_VERSION" > "$VERSION_FILE"
    echo "📝 Version saved: $CURRENT_VERSION"
}

# Download the server
download_server

# ========================================
# START SERVER
# ========================================

echo ""
echo "🎮 Starting Minecraft server..."
echo "=========================================="

if [ -f "/server/.server_type" ] && [ "$(cat /server/.server_type)" == "forge-run" ]; then
    # For modern Forge with run.sh
    exec /server/run.sh
else
    # Standard jar execution
    exec java \
        -Xms${MEMORY} \
        -Xmx${MEMORY} \
        ${JVM_FLAGS} \
        -jar /server/server.jar \
        --nogui
fi
