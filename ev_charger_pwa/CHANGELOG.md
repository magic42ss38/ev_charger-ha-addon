# Changelog — EV Charger PWA

## [3.2.13] — 2026-03-28
### Ajouté
- 📁 Fichiers racine complets : `README.md`, `repository.json`, `configuration_NGINX.conf`, `configuration_yaml.conf`
- 🔢 Cache Service Worker `ev-charger-v7`

## [3.2.12] — 2026-03-28
### Corrigé
- 🧭 **Navigation cassée** : `.bottom-nav` masqué par le contenu de la page (z-index: 10 ajouté)
- 📊 **kWh/Coût live = 0** : fallback `puissance × durée` quand le capteur énergie n'a pas encore bougé

## [3.2.11] — 2026-03-28
### Corrigé
- 🔌 **Coût final = 0** : snapshot puissance pris **avant** coupure du switch
- 🔄 **Auto-session** : création automatique si switch ON sans session en DB

## [3.2.10] — 2026-03-28
### Corrigé
- 🔄 Auto-création de session si switch ON sans session en DB
- ⚙️ Switch entity `—` dans réglages : null-guard + fallback depuis /api/status

## [3.2.9] — 2026-03-27
### Corrigé
- Valeurs par défaut robustes pour les entités
- Switch chargé dynamiquement depuis `/api/config`
- Fallback kWh si `energy_start = NULL`

## [3.2.8] — 2026-03-26
### Corrigé
- Cache Service Worker `ev-charger-v4`
- `/api/config` sans authentification requise
