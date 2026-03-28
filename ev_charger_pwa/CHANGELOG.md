# Changelog — EV Charger PWA

## [3.2.14] — 2026-03-28
### Corrigé
- 🧭 **Navigation PC** : ajout `onclick="showPage(...)"` inline sur chaque bouton nav + attribut `defer` sur app.js (double fallback navigation)
- 🖱️ CSS `.bottom-btn` : `pointer-events: auto` + `touch-action: manipulation` explicites

## [3.2.13] — 2026-03-28
### Ajouté
- Fichiers racine complets : README.md, repository.json, configuration_NGINX.conf, configuration_yaml.conf
- Cache SW `ev-charger-v7`

## [3.2.12] — 2026-03-28
### Corrigé
- Navigation cassée : z-index: 10 sur .bottom-nav
- kWh/Coût live = 0 : fallback puissance × durée

## [3.2.11] — 2026-03-28
### Corrigé
- Coût final = 0 : snapshot puissance avant coupure switch
- Auto-session si switch ON sans session en DB

## [3.2.10] — 2026-03-28
### Corrigé
- Auto-création de session si switch ON sans session en DB
- Switch entity — dans réglages : null-guard + fallback

## [3.2.9] — 2026-03-27
### Corrigé
- Valeurs par défaut robustes pour les entités
- Switch chargé dynamiquement depuis /api/config
- Fallback kWh si energy_start = NULL
