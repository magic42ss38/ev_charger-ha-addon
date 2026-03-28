#!/usr/bin/with-contenv bashio

bashio::log.info "Démarrage EV Charger PWA v3.2.18..."

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
export APP_PASSWORD=$(bashio::config 'app_password')
export ADMIN_NAME=$(bashio::config 'admin_name')
export SESSION_SECRET=$(cat /data/session_secret 2>/dev/null || (python3 -c "import secrets; print(secrets.token_hex(32))" | tee /data/session_secret))

bashio::log.info "HA public: ${HA_URL}"
bashio::log.info "Switch: ${SWITCH_ENTITY} | HP: ${TARIF_HP}€ | HC: ${TARIF_HC}€"
bashio::log.info "Sensor puissance : ${POWER_SENSOR}"
bashio::log.info "Sensor énergie   : ${ENERGY_SENSOR}"

# Vérification critique : token HA
if [ -z "${HA_TOKEN}" ]; then
    bashio::log.warning "⚠️  HA_TOKEN est VIDE ! Renseignez ha_token dans l'onglet Configuration de l'addon."
    bashio::log.warning "    HA → Profil → Jetons d'accès longue durée → Créer un jeton"
else
    TOKEN_LEN=${#HA_TOKEN}
    bashio::log.info "✅ HA_TOKEN configuré (${TOKEN_LEN} caractères)"
fi

cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8765 --workers 1
