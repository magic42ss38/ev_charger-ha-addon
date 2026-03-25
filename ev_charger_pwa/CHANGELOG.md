# Changelog — EV Charger PWA

## [3.2.6] — 2026-03-25
### Corrigé
- 🔌 **Entités HA** — `config.yaml` mis à jour avec les bons noms par défaut (`sensor.prise_voiture_puissance_2`, `sensor.prise_voiture_energy`)
- 📱 **PWA installable** — `manifest.json` corrigé : icônes déclarées séparément par `purpose` (`any` et `maskable`) pour satisfaire Chrome
- 📋 **Log de démarrage** — affiche désormais les sensors chargés pour validation

## [3.2.5] — 2026-03-25
### Ajouté
- 📱 Bouton d'installation PWA dans le header (Android : prompt natif / iOS : guide étapes illustré)
- 🔄 Nouveau cache SW `ev-charger-v3` → purge automatique de l'ancien cache v2
- 📌 Version affichée dans les logs au démarrage

## [3.2.4] — 2026-03-25
### Corrigé
- 🐛 Crash 500 `/api/status` → migration DB `ALTER TABLE sessions ADD COLUMN user_id` et `notes` (idempotente)
- 🔁 La DB existante sans ces colonnes était bloquante après OAuth

## [3.2.3] — 2026-03-24
### Corrigé
- 🔐 Boucle auth infinie → SW ne cache plus `/auth/check`
- 🚫 SW erreur POST → requêtes POST exclues du cache
- ✅ Endpoint HA corrigé → `/api/config/auth/current_user` → `/api/auth/current_user`

## [3.2.2] — 2026-03-24
### Corrigé
- 🔑 OAuth `client_id` → utilise désormais l'URL complète `https://pwa.domotique-nicof73.ovh` (cause du ban IP en v3.2.1)
- 🗑️ Suppression `base_url` → déprécié dans HA
- 🌐 Ajout `192.168.1.0/24` dans `trusted_proxies`
- 📝 Mise à jour des strings de version

## [3.2.1] — 2026-03-23
### Analysé
- 🔍 Review du package de déploiement → 4 bugs de configuration identifiés

## [2.0.0] — 2026-03-01
### Initial
- Auth OAuth2 HA basique
- Stockage sessions SQLite
- Contrôle `switch.prise_voiture`
- Interface PWA de base
