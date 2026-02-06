#!/bin/bash
set -e

echo "Starting Minecraft Server (${SERVER_TYPE} ${MC_VERSION})..."

# Function to select Java version
select_java_version() {
    # If JAVA_VERSION is manually set, verify it exists
    if [ -n "$JAVA_VERSION" ]; then
        if [ "$JAVA_VERSION" = "8" ]; then
            echo "/usr/lib/jvm/java-8-openjdk-amd64/bin/java"
            return
        elif [ "$JAVA_VERSION" = "17" ]; then
            echo "/usr/lib/jvm/java-17-openjdk-amd64/bin/java"
            return
        elif [ "$JAVA_VERSION" = "21" ]; then
            echo "/usr/lib/jvm/java-21-openjdk-amd64/bin/java"
            return
        fi
    fi

    # Parse MC_VERSION
    local major=$(echo "$MC_VERSION" | cut -d. -f1)
    local minor=$(echo "$MC_VERSION" | cut -d. -f2)

    # Logic for Java selection
    # <= 1.16.5 -> Java 8
    # 1.17 - 1.20.4 -> Java 17
    # >= 1.20.5 -> Java 21
    
    if [ "$minor" -le 16 ]; then
        echo "/usr/lib/jvm/java-8-openjdk-amd64/bin/java"
    elif [ "$minor" -le 20 ] && [ "$MC_VERSION" != "1.20.5" ] && [ "$MC_VERSION" != "1.20.6" ]; then
        # 1.17 to 1.20.4
        echo "/usr/lib/jvm/java-17-openjdk-amd64/bin/java"
    else
        # 1.20.5+ and newer
        echo "/usr/lib/jvm/java-21-openjdk-amd64/bin/java"
    fi
}

# Select Java executable
JAVA_EXEC=$(select_java_version)
echo "Selected Java executable: $JAVA_EXEC"

# Verify Java version
$JAVA_EXEC -version

# Auto-accept EULA
echo "eula=true" > eula.txt

# Download and run server based on type
case "${SERVER_TYPE}" in
  vanilla)
    echo "Fetching Vanilla ${MC_VERSION}..."
    DOWNLOAD_URL=$(curl -s https://launchermeta.mojang.com/mc/game/version_manifest_v2.json | jq -r ".versions[] | select(.id==\"${MC_VERSION}\") | .url" | xargs curl -s | jq -r '.downloads.server.url')
    if [ "$DOWNLOAD_URL" != "null" ]; then
        wget -O server.jar "$DOWNLOAD_URL"
        $JAVA_EXEC -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    else
        echo "Error: Could not find download URL for version ${MC_VERSION}"
        exit 1
    fi
    ;;
  paper)
    echo "Fetching Paper ${MC_VERSION}..."
    BUILD=$(curl -s "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds" | jq -r '.builds[-1].build')
    wget -O server.jar "https://api.papermc.io/v2/projects/paper/versions/${MC_VERSION}/builds/${BUILD}/downloads/paper-${MC_VERSION}-${BUILD}.jar"
    $JAVA_EXEC -Xms${MEMORY} -Xmx${MEMORY} -jar server.jar nogui
    ;;
  forge)
    echo "Fetching Forge ${MC_VERSION} (Build: ${FORGE_VERSION})..."
    # Forge download URL structure
    FORGE_URL="https://maven.minecraftforge.net/net/minecraftforge/forge/${MC_VERSION}-${FORGE_VERSION}/forge-${MC_VERSION}-${FORGE_VERSION}-installer.jar"
    
    # Check if Forge is already installed
    FORGE_JAR="forge-${MC_VERSION}-${FORGE_VERSION}.jar"
    
    if [ ! -f "$FORGE_JAR" ] && [ ! -f "run.sh" ]; then
        echo "Installing Forge... this may take a few minutes."
        wget -O forge-installer.jar "$FORGE_URL"
        $JAVA_EXEC -jar forge-installer.jar --installServer
        rm -f forge-installer.jar
    fi

    echo "Starting Forge server..."
    
    # Modern Forge (1.17+) uses run.sh
    if [ -f "run.sh" ]; then
        echo "Applying memory settings: -Xms${MEMORY} -Xmx${MEMORY}"
        
        JAVA_HOME=$(dirname $(dirname $JAVA_EXEC))
        export JAVA_HOME
        export PATH=$JAVA_HOME/bin:$PATH
        
        echo "-Xms${MEMORY} -Xmx${MEMORY}" > user_jvm_args.txt
        
        chmod +x run.sh
        ./run.sh nogui
        
    # 1.12.2 and older Forge - uses forge-VERSION.jar
    elif [ -f "$FORGE_JAR" ]; then
        echo "Starting with Forge jar: $FORGE_JAR"
        $JAVA_EXEC -Xms${MEMORY} -Xmx${MEMORY} -jar "$FORGE_JAR" nogui
        
    else
        echo "Error: Forge server jar not found"
        echo "Expected: $FORGE_JAR or run.sh"
        echo "Files in directory:"
        ls -la *.jar *.sh 2>/dev/null || echo "No jar/sh files found"
        exit 1
    fi
    ;;
  fabric)
    wget -O fabric-installer.jar "https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer-latest.jar"
    $JAVA_EXEC -jar fabric-installer.jar server -mcversion ${MC_VERSION} -loader ${FABRIC_LOADER_VERSION:-latest}
    $JAVA_EXEC -Xms${MEMORY} -Xmx${MEMORY} -jar fabric-server-launch.jar nogui
    ;;
  *)
    echo "Unknown server type: ${SERVER_TYPE}"
    exit 1
    ;;
esac
