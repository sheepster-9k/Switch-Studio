#!/bin/sh
set -e

cd /app

OPTIONS_FILE="/data/options.json"

if [ -f "$OPTIONS_FILE" ]; then
    HA_TOKEN=$(jq -r '.ha_token // ""' "$OPTIONS_FILE")
    PORT=$(jq -r '.port // 8878' "$OPTIONS_FILE")
else
    HA_TOKEN=""
    PORT=8878
fi

# Get ingress entry path from Supervisor API
INGRESS_ENTRY=$(curl -sf \
    -H "Authorization: Bearer ${SUPERVISOR_TOKEN}" \
    "http://supervisor/addons/self/info" \
    | jq -r '.data.ingress_entry // "/"' 2>/dev/null || echo "/")

# Auto-discover Zigbee2MQTT config for mmWave support
HA_CONFIG_PATH="/homeassistant"
Z2M_CANDIDATES="/homeassistant/zigbee2mqtt/configuration.yaml /share/zigbee2mqtt/data/configuration.yaml"
for candidate in $Z2M_CANDIDATES; do
    if [ -f "$candidate" ]; then
        export Z2M_CONFIG="$candidate"
        break
    fi
done

export HA_TOKEN
export PORT
export INGRESS_ENTRY
export HA_BASE_URL="http://supervisor/core"
export HA_CONFIG_PATH
export NODE_ENV=production
export HOST=0.0.0.0

exec node /app/dist/server/index.js
