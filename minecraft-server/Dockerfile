# Minecraft Server Docker Image
# Supports: Vanilla, Paper, Forge, Fabric

FROM eclipse-temurin:21-jre-alpine

# Install dependencies
RUN apk add --no-cache \
    bash \
    curl \
    wget \
    jq \
    netcat-openbsd \
    unzip \
    && rm -rf /var/cache/apk/*

# Create minecraft user
RUN addgroup -g 1000 minecraft && \
    adduser -u 1000 -G minecraft -h /server -D minecraft

# Set working directory
WORKDIR /server

# Copy startup script
COPY --chmod=755 start.sh /start.sh
COPY --chmod=755 backup.sh /backup.sh

# Environment variables with defaults
ENV MC_VERSION="1.21.8" \
    SERVER_TYPE="forge" \
    FORGE_VERSION="" \
    FABRIC_LOADER_VERSION="" \
    MEMORY="4G" \
    EULA="FALSE" \
    TZ="UTC"

# JVM optimization flags
ENV JVM_FLAGS="-XX:+UseG1GC \
    -XX:+ParallelRefProcEnabled \
    -XX:MaxGCPauseMillis=200 \
    -XX:+UnlockExperimentalVMOptions \
    -XX:+DisableExplicitGC \
    -XX:+AlwaysPreTouch \
    -XX:G1NewSizePercent=30 \
    -XX:G1MaxNewSizePercent=40 \
    -XX:G1HeapRegionSize=8M \
    -XX:G1ReservePercent=20 \
    -XX:G1HeapWastePercent=5 \
    -XX:G1MixedGCCountTarget=4 \
    -XX:InitiatingHeapOccupancyPercent=15 \
    -XX:G1MixedGCLiveThresholdPercent=90 \
    -XX:G1RSetUpdatingPauseTimePercent=5 \
    -XX:SurvivorRatio=32 \
    -XX:+PerfDisableSharedMem \
    -XX:MaxTenuringThreshold=1 \
    -Dusing.aikars.flags=https://mcflags.emc.gs \
    -Daikars.new.flags=true"

# Expose Minecraft port
EXPOSE 25565

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
    CMD nc -z localhost 25565 || exit 1

# Volume for persistent data
VOLUME ["/server/world", "/server/mods", "/server/config"]

# Set ownership
RUN chown -R minecraft:minecraft /server

# Note: Running as root because Docker volumes need write access
# In production, use proper volume permissions or init container

# Entry point
ENTRYPOINT ["/start.sh"]
