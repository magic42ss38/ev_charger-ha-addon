#!/usr/bin/with-contenv bashio

bashio::log.info "Démarrage EV Charger PWA v2.0..."

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
export OAUTH_REDIRECT_URI=$(bashio::config 'oauth_redirect_uri')
export OAUTH_CLIENT_ID="ev-charger-pwa"
export SESSION_SECRET=$(cat /data/session_secret 2>/dev/null || (python3 -c "import secrets; print(secrets.token_hex(32))" | tee /data/session_secret))

bashio::log.info "OAuth2 redirect: ${OAUTH_REDIRECT_URI}"
bashio::log.info "Switch: ${SWITCH_ENTITY} | HP: ${TARIF_HP}€ | HC: ${TARIF_HC}€"

cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8765 --workers 1
