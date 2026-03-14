#!/usr/bin/with-contenv bashio

# Read options from addon config
HA_TOKEN=$(bashio::config 'ha_token')
PORT=$(bashio::config 'port' '8878')
INGRESS_ENTRY=$(bashio::addon.ingress_entry 2>/dev/null || echo "/")

export HA_TOKEN
export PORT
export INGRESS_ENTRY
export HA_BASE_URL="http://supervisor/core"
export HA_CONFIG_PATH="/homeassistant"
export NODE_ENV=production
export HOST=0.0.0.0

exec node /app/dist/server/index.js
