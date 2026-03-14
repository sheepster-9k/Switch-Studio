#!/bin/sh
set -e

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

export HA_TOKEN
export PORT
export INGRESS_ENTRY
export HA_BASE_URL="http://supervisor/core"
export HA_CONFIG_PATH="/homeassistant"
export NODE_ENV=production
export HOST=0.0.0.0

exec node /app/dist/server/index.js
