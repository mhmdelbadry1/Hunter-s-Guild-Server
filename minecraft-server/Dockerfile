FROM eclipse-temurin:21-jre-jammy

# Install required tools
RUN apt-get update && \
    apt-get install -y wget curl jq netcat-traditional && \
    rm -rf /var/lib/apt/lists/*

# Create server directory
WORKDIR /server

# Copy scripts
COPY start.sh /start.sh
COPY backup.sh /backup.sh
RUN chmod +x /start.sh /backup.sh

# Expose Minecraft port
EXPOSE 25565

# Start server
CMD ["/start.sh"]
