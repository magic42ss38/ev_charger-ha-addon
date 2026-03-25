# Changelog — EV Charger PWA

## v3.2.2 (2026-03-25)
### 🔴 Fixes critiques
- **OAUTH_CLIENT_ID** : corrigé — désormais lu depuis l'option `pwa_url` de config.yaml
  (HA OAuth2 exige que client_id soit l'URL publique de l'application, pas un slug)
- **configuration.yaml** : suppression de `base_url` (déprécié depuis HA 2021.7)
- **trusted_proxies** : ajout de `192.168.1.0/24` (réseau LAN, NGINX Proxy Manager)
- **ev_charger.sh** : version log mise à jour v3.0

### 🆕 Nouvelle option config.yaml
- `pwa_url` : URL publique de la PWA (ex: `https://pwa.domotique-nicof73.ovh`)

---

## v3.2.1 (2026-03-24)
### Fixes
- Correction `updateThemeIcon` null-safe (TypeError sur DOM non prêt)
- Meta `mobile-web-app-capable` ajoutée (remplacement de la version dépréciée)
- URL-encoding correct des paramètres OAuth (`urllib.parse.urlencode`)
- Route `GET /favicon.ico` explicite (évite 403 de StaticFiles)

---

## v3.0.0 (2026-03-23)
### Nouvelles fonctionnalités
- Badge utilisateur avec initiales colorées + rôle HA (👑 Propriétaire / 🛡 Admin / 👤 Utilisateur)
- Thème sombre/clair auto (prefers-color-scheme) + toggle manuel
- Page Stats mensuelle avec graphique kWh par semaine (HC/HP)
- Export CSV amélioré (BOM UTF-8, compatible Excel)
- Widget "prochaine heure creuse dans X minutes"
- Auth OAuth2 HA native (zéro mot de passe)

---

## v3.2.3 (2026-03-25)
### 🔴 Fixes critiques (boucle d'authentification)
- **sw.js** : Le Service Worker mettait `/auth/check` en cache → après OAuth, il renvoyait toujours `{authenticated: false}` → boucle infinie `/auth/login`. Fix : `/auth/*` et `/api/*` sont désormais **network-only** (jamais mis en cache)
- **sw.js** : Correction du `TypeError: Cache.put() POST unsupported` — seules les requêtes GET avec status 200 sont désormais mises en cache
- **main.py** : Correction du endpoint HA API : `/api/config/auth/current_user` (404) → `/api/auth/current_user` (correct)
- **sw.js** : Nouveau `CACHE_NAME = 'ev-charger-v2'` pour forcer l'invalidation de l'ancien cache au déploiement
