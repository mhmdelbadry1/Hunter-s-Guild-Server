#!/bin/sh
# duckdns.sh - Containerized DuckDNS Updater

echo "Starting DuckDNS Auto-Updater for domain: ${DUCKDNS_DOMAIN}"

while true; do
    TIME=$(date "+%Y-%m-%d %H:%M:%S")
    
    # Try multiple IP detection services
    CURRENT_IP="Unknown"
    for service in "https://icanhazip.com" "http://icanhazip.com" "http://checkip.amazonaws.com" "http://ifconfig.me/ip"; do
        DETECTED=$(curl -s --max-time 10 "$service" 2>/dev/null | tr -d '[:space:]')
        if [ -n "$DETECTED" ] && ! echo "$DETECTED" | grep -q "html"; then
            CURRENT_IP=$DETECTED
            break
        fi
    done
    
    echo "[${TIME}] IP Detection: ${CURRENT_IP}"
    
    # Send update to DuckDNS
    # If detection failed, we still send the update without &ip= so DuckDNS uses the request's source IP
    URL="https://www.duckdns.org/update?domains=${DUCKDNS_DOMAIN}&token=${DUCKDNS_TOKEN}"
    if [ "$CURRENT_IP" != "Unknown" ]; then
        URL="${URL}&ip=${CURRENT_IP}"
    fi

    RESPONSE=$(curl -k -s --max-time 20 "$URL")
    
    if [ "$RESPONSE" = "OK" ]; then
        echo "[${TIME}] DuckDNS Update: SUCCESS"
    else
        echo "[${TIME}] DuckDNS Update: FAILED (Response: ${RESPONSE})"
    fi
    
    # Wait for 5 minutes (300 seconds)
    sleep 300
done
