#!/usr/bin/with-contenv bashio

bashio::log.info "Démarrage EV Charger PWA..."

# Lire la config depuis options.json
export HA_TOKEN=$(bashio::config 'ha_token')
export HA_URL=$(bashio::config 'ha_url')
export SWITCH_ENTITY=$(bashio::config 'switch_entity')
export POWER_SENSOR=$(bashio::config 'power_sensor')
export ENERGY_SENSOR=$(bashio::config 'energy_sensor')
export TARIF_HP=$(bashio::config 'tarif_hp')
export TARIF_HC=$(bashio::config 'tarif_hc')
export HC_START=$(bashio::config 'hc_start')
export HC_END=$(bashio::config 'hc_end')
export NOTIFICATION_THRESHOLD=$(bashio::config 'notification_threshold_kw')

bashio::log.info "Config chargée. Switch: ${SWITCH_ENTITY}"
bashio::log.info "Tarifs HP: ${TARIF_HP}€ / HC: ${TARIF_HC}€"

cd /app
exec /app/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8765 --workers 1
