# Changelog — EV Charger PWA

## [3.2.8] — 2026-03-25
### Corrigé
- 🔄 **Cache SW purgé** — Nouveau nom de cache `ev-charger-v4` (force le rechargement complet des fichiers JS/HTML en cache depuis v3.2.5)
- 🔓 **`/api/config` sans auth** — L'endpoint ne nécessite plus de session pour retourner les entités configurées (évite les échecs silencieux en page Réglages)
- 📊 **Logs `energy_start`** — Avertissement explicite si le sensor énergie retourne `unavailable` au démarrage d'une session (cause du kWh = 0)
- 🏷️ **Version footer dynamique** — La version affichée en bas de page est maintenant lue depuis le serveur (`/api/config`), plus de v3.0 affiché

## [3.2.7] — 2026-03-25
### Corrigé
- 🔌 **Entités dynamiques** — La page Réglages affiche maintenant les vraies entités configurées (via `/api/config`) au lieu de noms hardcodés
- 💰 **Coût calculé côté serveur** — `session_cost` calculé en backend et retourné dans `/api/status`
- ↩️ **Bouton Annuler** — Page Réglages : retour à l'accueil sans sauvegarde obligatoire

## [3.2.6] — 2026-03-25
### Corrigé
- 🔌 **Défauts sensors corrigés** dans `config.yaml` (`sensor.prise_voiture_puissance_2` et `sensor.prise_voiture_energy`)
- 📱 **Manifest PWA** — Icons séparées par purpose (`any` et `maskable`) pour déclencher `beforeinstallprompt`
- 📋 **Logs démarrage** — Affichage du nom des sensors au lancement de l'addon

## [3.2.5] — 2026-03-25
### Ajouté
- 📱 Bouton d'installation PWA dans le header (Android : prompt natif / iOS : guide étapes)
- 🔄 Nouveau cache SW `ev-charger-v3` → purge automatique de l'ancien cache v2

## [3.2.4] — 2026-03-25
### Corrigé
- 🐛 Fix crash 500 `/api/status` → migration DB `ALTER TABLE sessions ADD COLUMN user_id` et `notes`

## [3.2.3] — 2026-03-25
### Corrigé
- 🔐 Fix boucle auth infinie → SW ne cache plus `/auth/check`
- ✅ Fix endpoint HA → `/api/auth/current_user`

## [3.2.2] — 2026-03-25
### Corrigé
- 🔑 Fix OAuth client_id → URL complète `https://pwa.domotique-nicof73.ovh`
- 🌐 Ajout `192.168.1.0/24` dans `trusted_proxies`

## [2.0] — Version initiale
- Auth OAuth2 HA, stockage sessions SQLite, contrôle switch voiture
