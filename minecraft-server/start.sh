#!/bin/bash
set -e

echo "Starting Minecraft Server (${SERVER_TYPE} ${MC_VERSION})..."

# Auto-accept EULA
echo "eula=true" > eula.txt

# Download and run server based on type
case "${SERVER_TYPE}" in
  vanilla)
    wget -O server.jar "https://launcher.mojang.com/v1/objects/$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest.json | jq -r ".versions[] | select(.id==\"${MC_VERSION}\") | .url" | xargs curl -s | jq -r '.downloads.server.url' | sed 's/.*\///')/server.jar" || echo "Download failed"
    java -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    ;;
  paper)
    BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds" | jq -r '.builds[-1].build')
    wget -O server.jar "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds/${BUILD}/downloads/paper-${MC_VERSION}-${BUILD}.jar"
    java -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    ;;
  forge)
    echo "Forge server setup - requires manual installation"
    echo "Place forge installer JAR and run: java -jar forge-installer.jar --installServer"
    # Keep container running
    tail -f /dev/null
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
