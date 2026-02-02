FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install dependencies
RUN apt-get update && \
    apt-get install -y \
    wget \
    curl \
    jq \
    netcat-traditional \
    openjdk-8-jre-headless \
    openjdk-17-jre-headless \
    openjdk-21-jre-headless \
    && rm -rf /var/lib/apt/lists/*

# Set default JAVA_HOME to Java 21 (latest)
ENV JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
ENV PATH=$JAVA_HOME/bin:$PATH

# Create server directory
WORKDIR /server

# Copy scripts
COPY start.sh /start.sh
COPY backup.sh /backup.sh
RUN chmod +x /start.sh /backup.sh


# Create a default server.properties file if it doesn't exist
RUN touch /server/server.properties && echo "enable-query=true" > /server/server.properties


# Expose Minecraft port
EXPOSE 25565

# Start server
CMD ["/start.sh"]
