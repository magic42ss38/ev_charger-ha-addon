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

## [3.2.16] - 2026-03-28

### Fixed
- **Puissance / capteurs HA invisibles** : le token OAuth HA expire après 30 minutes. Ajout d'un refresh automatique du token via `refresh_token` stocké en DB. Les entités HA sont maintenant accessibles en permanence même après longue inactivité.
- **Sessions disparaissent entre appareils** : les sessions étaient filtrées strictement par `user_id`. Désormais, les utilisateurs avec le rôle `owner` ou `admin` voient **toutes les sessions** (tous utilisateurs confondus) dans l'historique, les stats et l'export CSV.
- Les actions delete/notes sur sessions sont également accessibles à l'admin sur toutes les sessions.

### Technical
- Nouvelle fonction `get_valid_ha_token(session)` : priorité au token long-lived `HA_TOKEN`, sinon refresh automatique du token OAuth si expiré ou expirant dans < 5 minutes.
- Service Worker cache bumped to `ev-charger-v10`.

## [3.2.15] — 2026-03-28
### Corrigé
- 🧭 **Navigation PC (fix radical)** :
  - z-index `.bottom-nav` : 10 → **9999** (garanti au-dessus de toute couche)
  - `showPage()` : utilisation de `style.display` direct (bypass CSS) en complément de classList
  - `scrollTo(0,0)` au changement de page pour rendre le changement visible
  - CSS `.page { display: none !important }` / `.page.active { display: block !important }` pour forcer la priorité
- 🔄 Service Worker cache bumped to `ev-charger-v9`
