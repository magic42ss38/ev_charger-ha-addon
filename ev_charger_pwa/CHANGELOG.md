# Changelog — EV Charger PWA

## [3.2.5] — 2026-03-25
### Ajouté
- 📱 Bouton d'installation PWA dans le header
  - Android/Chrome : prompt natif du navigateur
  - iOS/Safari : guide illustré en 3 étapes
  - Masqué automatiquement si l'app est déjà installée
- 🔄 Nouveau cache Service Worker `ev-charger-v3` avec purge automatique de l'ancien cache

### Corrigé
- Version affichée correctement dans les logs au démarrage

---

## [3.2.4] — 2026-03-24
### Corrigé
- 🐛 Crash 500 sur `/api/status` → `sqlite3.OperationalError: no such column: user_id`
  - Ajout migration `ALTER TABLE sessions ADD COLUMN user_id TEXT` (idempotente)
  - Ajout migration `ALTER TABLE sessions ADD COLUMN notes TEXT` (idempotente)
  - La DB existante créée en v2 sans ces colonnes bloquait toute requête authentifiée

---

## [3.2.3] — 2026-03-23
### Corrigé
- 🔐 Boucle d'authentification infinie → le Service Worker ne met plus en cache `/auth/check`
- 🚫 Erreur SW `TypeError: Failed to execute 'put' on 'Cache': Request method 'POST' is unsupported`
  - Les requêtes POST sont désormais exclues du cache
- ✅ Endpoint HA corrigé : `/api/config/auth/current_user` → `/api/auth/current_user`

---

## [3.2.2] — 2026-03-22
### Corrigé
- 🔑 OAuth `client_id` corrigé → utilise l'URL complète `https://pwa.domotique-nicof73.ovh`
  (l'ancienne valeur courte `"ev_charger"` provoquait des erreurs 403 et le ban IP automatique de HA)
- 🗑️ Suppression de `base_url` dans la configuration HA (option dépréciée)
- 🌐 Ajout de `192.168.1.0/24` dans `trusted_proxies` pour les requêtes LAN
- 📝 Mise à jour des chaînes de version dans `config.yaml` et `main.py`

---

## [3.2.1] — 2026-03-21
### Analysé
- 🔍 Review complète du package de déploiement fourni
- 4 bugs de configuration identifiés (corrigés en v3.2.2)

---

## [2.0.0] — version de base
### Fonctionnalités initiales
- Authentification OAuth2 via Home Assistant
- Stockage des sessions en SQLite avec support multi-utilisateurs
- Contrôle du switch `switch.prise_voiture`
- Rôles utilisateurs (Owner / Admin / User) issus de HA
- Badge utilisateur avec initiales colorées
- Thème clair/sombre avec détection des préférences système
- Page statistiques mensuelles (graphe kWh par semaine)
- Export CSV des sessions
- Widget "prochain créneau heure creuse dans X minutes"
- Service Worker pour fonctionnement offline

---

*Projet : EV Charger PWA — Home Assistant Addon*
*Auteur : NicoF73*
