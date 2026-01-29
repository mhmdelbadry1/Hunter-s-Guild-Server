# API Service Dockerfile
FROM node:20-alpine

# Install dependencies for Docker API
RUN apk add --no-cache \
    docker-cli \
    curl \
    && rm -rf /var/cache/apk/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 nodeuser && \
    adduser -u 1001 -G nodeuser -D nodeuser && \
    chown -R nodeuser:nodeuser /app

# Don't switch user - need docker socket access
# USER nodeuser

# Expose API port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost:3001/api/health || exit 1

# Start the server
CMD ["node", "server.js"]
