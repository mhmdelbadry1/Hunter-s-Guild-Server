FROM alpine:latest

# Install curl and certificates for SSL
RUN apk add --no-cache curl ca-certificates

# Create app directory
WORKDIR /app

# Copy script
COPY duckdns.sh .
RUN chmod +x duckdns.sh

# Run the script
CMD ["./duckdns.sh"]
