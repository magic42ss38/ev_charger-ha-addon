# Changelog — EV Charger PWA

## [3.2.7] — 2026-03-25
### Corrigé
- 🔌 **Entités dynamiques** — La page Réglages affiche maintenant les vraies entités configurées (via `/api/config`) au lieu de noms hardcodés
- 💰 **Coût session live** — `session_cost` calculé côté serveur à chaque polling et exposé dans `/api/status`
- ⬅️ **Bouton Annuler** — Ajout d'un bouton Annuler dans la page Réglages pour revenir sans sauvegarder
- 🔌 **Nouveau endpoint** `/api/config` — expose les entités et la version pour l'UI

## [3.2.6] — 2026-03-25
### Corrigé
- 🔌 **Entités HA** — `config.yaml` mis à jour avec les bons noms par défaut (`sensor.prise_voiture_puissance_2`, `sensor.prise_voiture_energy`)
- 📱 **PWA installable** — `manifest.json` corrigé : icônes séparées par `purpose` (`any` et `maskable`)
- 📋 **Log de démarrage** — affiche les sensors chargés pour validation

## [3.2.5] — 2026-03-25
### Ajouté
- 📱 Bouton d'installation PWA dans le header (Android : prompt natif / iOS : guide illustré)
- 🔄 Nouveau cache SW `ev-charger-v3` → purge automatique de l'ancien cache v2

## [3.2.4] — 2026-03-25
### Corrigé
- 🐛 Crash 500 `/api/status` → migration DB colonnes `user_id` et `notes` (idempotente)

## [3.2.3] — 2026-03-24
### Corrigé
- 🔐 Boucle auth infinie → SW ne cache plus `/auth/check`
- 🚫 SW erreur POST → requêtes POST exclues du cache
- ✅ Endpoint HA corrigé → `/api/auth/current_user`

## [3.2.2] — 2026-03-24
### Corrigé
- 🔑 OAuth `client_id` → URL complète `https://pwa.domotique-nicof73.ovh`
- 🌐 Ajout `192.168.1.0/24` dans `trusted_proxies`

## [2.0.0] — 2026-03-01
### Initial
- Auth OAuth2 HA, sessions SQLite, contrôle switch
