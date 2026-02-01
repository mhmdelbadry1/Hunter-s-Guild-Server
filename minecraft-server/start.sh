#!/bin/bash
set -e

echo "Starting Minecraft Server (${SERVER_TYPE} ${MC_VERSION})..."

# Auto-accept EULA
echo "eula=true" > eula.txt

# Download and run server based on type
case "${SERVER_TYPE}" in
  vanilla)
    echo "Fetching Vanilla ${MC_VERSION}..."
    DOWNLOAD_URL=$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest_v2.json | jq -r ".versions[] | select(.id==\"${MC_VERSION}\") | .url" | xargs curl -s | jq -r '.downloads.server.url')
    if [ "$DOWNLOAD_URL" != "null" ]; then
        wget -O server.jar "$DOWNLOAD_URL"
        java -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    else
        echo "Error: Could not find download URL for version ${MC_VERSION}"
        exit 1
    fi
    ;;
  paper)
    echo "Fetching Paper ${MC_VERSION}..."
    BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds" | jq -r '.builds[-1].build')
    wget -O server.jar "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds/${BUILD}/downloads/paper-${MC_VERSION}-${BUILD}.jar"
    java -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    ;;
  forge)
    echo "Fetching Forge ${MC_VERSION} (Build: ${FORGE_VERSION})..."
    # Forge download URL structure
    FORGE_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/forge-${MC_VERSION}-${FORGE_VERSION}-installer.jar"
    
    if [ ! -f "libraries/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/forge-${MC_VERSION}-${FORGE_VERSION}-server.jar" ] && [ ! -f "run.sh" ]; then
        echo "Installing Forge... this may take a few minutes."
        wget -O forge-installer.jar "$FORGE_URL"
        java -jar forge-installer.jar --installServer
        rm forge-installer.jar
    fi

    echo "Starting Forge server..."
    if [ -f "run.sh" ]; then
        # Modern Forge (1.17+) uses run.sh
        echo "Applying memory settings: -Xms${MEMORY} -Xmx${MEMORY}"
        # We overwrite user_jvm_args.txt to ensure our memory settings are used
        # This file is automatically read by the Forge run.sh script
        echo "-Xms${MEMORY} -Xmx${MEMORY}" > user_jvm_args.txt
        
        chmod +x run.sh
        ./run.sh nogui
    else
        # Older Forge uses the universal jar
        FORGE_JAR=$(ls forge-*-universal.jar 2>/dev/null | head -n 1)
        if [ -n "$FORGE_JAR" ]; then
            java -Xms${MEMORY} -Xmx${MEMORY} -jar "$FORGE_JAR" nogui
        else
            echo "Error: Forge server jar not found"
            exit 1
        fi
    fi
    ;;
  fabric)
    wget -O fabric-installer.jar "https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer-latest.jar"
    java -jar fabric-installer.jar server -mcversion ${MC_VERSION} -loader ${FABRIC_LOADER_VERSION:-latest}
    java -Xms${MEMORY} -Xmx${MEMORY} -jar fabric-server-launch.jar nogui
    ;;
  *)
    echo "Unknown server type: ${SERVER_TYPE}"
    exit 1
    ;;
esac
