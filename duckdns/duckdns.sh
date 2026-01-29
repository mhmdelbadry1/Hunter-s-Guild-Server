#!/bin/sh
# duckdns.sh - Containerized DuckDNS Updater

echo "Starting DuckDNS Auto-Updater for domain: ${DUCKDNS_DOMAIN}"

while true; do
    TIME=$(date "+%Y-%m-%d %H:%M:%S")
    
    # Get current public IP (optional detection)
    CURRENT_IP=$(curl -s --max-time 10 https://icanhazip.com || echo "Unknown")
    
    echo "[${TIME}] IP Detection: ${CURRENT_IP}"
    
    # Send update to DuckDNS
    RESPONSE=$(curl -s --max-time 20 "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}")
    
    if [ "$RESPONSE" = "OK" ]; then
        echo "[${TIME}] DuckDNS Update: SUCCESS"
    else
        echo "[${TIME}] DuckDNS Update: FAILED (Response: ${RESPONSE})"
    fi
    
    # Wait for 15 minutes (900 seconds)
    sleep 900
done
