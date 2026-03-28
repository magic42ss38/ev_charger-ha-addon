# Changelog — EV Charger PWA

## [3.2.11] — 2026-03-28
### Corrigé
- 🐛 **kWh/Coût = 0 après session** : Cause racine identifiée — la puissance était lue *après* avoir coupé le switch (capteur retourne 0W). Désormais, un snapshot de la puissance est pris **avant** la coupure et utilisé comme fallback
- 🐛 **Capteur énergie trop lent** : Si `energy_end == energy_start` (capteur pas encore mis à jour pour une courte session), le fallback `puissance × durée` est automatiquement utilisé
- 🐛 **Double fallback** : Les deux conditions (energy_start=NULL **et** kWh=0) déclenchent maintenant le calcul par puissance × durée
- 🔄 Cache Service Worker : `ev-charger-v6`

## [3.2.10] — 2026-03-28
### Corrigé
- 🔄 **Auto-création de session** : Si le switch est ON dans HA mais sans session en DB (switch activé hors PWA), `/api/status` crée automatiquement la session
- 🔧 **Switch entity dans réglages** : Protection null-safe sur `cfg` + fallback depuis `/api/status` si le champ reste `—`
- 💰 **Coût calculé côté serveur** : `session_cost` depuis le backend avec les bons tarifs utilisateur
- 🔄 Cache Service Worker : `ev-charger-v5`

## [3.2.9] — 2026-03-27
### Corrigé
- 🔧 Defaults robustes pour les entités (strip + fallback si chaîne vide depuis /data/options.json)
- 🔧 Calcul kWh fallback via puissance × durée si energy_start=NULL
- 🔧 Switch entity chargé dynamiquement depuis /api/config

## [3.2.8] — 2026-03-26
### Corrigé
- 🔄 Cache SW bumped à ev-charger-v4
- 🔓 /api/config sans auth requise
- 📝 Logging étendu pour debugging energy_start

## [3.2.7] — 2026-03-25
### Corrigé
- 🔧 Entités hardcodées dans l'UI settings remplacées par chargement dynamique
- 💰 Calcul coût session côté serveur
- ❌ Bouton annuler fonctionnel

## [3.2.6] — 2026-03-24
### Corrigé
- 🔧 Defaults capteurs corrigés
- 📱 Manifest PWA corrigé
