# Changelog — EV Charger PWA

## [3.2.9] — 2026-03-26
### Corrigé
- 🛡️ **Défauts robustes** — Si `options.json` (HA) contient des entités vides, les bons noms par défaut sont utilisés (`switch.prise_voiture`, `sensor.prise_voiture_puissance_2`, `sensor.prise_voiture_energy`)
- 📊 **Fallback kWh** — Si `energy_start=NULL` au démarrage de session (sensor indispo), le kWh est estimé via `puissance (W) × durée (h)` au lieu d'afficher 0.000
- 🔌 **Switch dynamique** — L'entité switch est maintenant chargée depuis `/api/config` dans la page Réglages (n'était pas dynamique contrairement aux autres entités)
- 🖥️ **Console debug** — La réponse de `/api/config` est loggée en console navigateur (`[config] Réponse API: {...}`) pour faciliter le diagnostic
- ⚡ **Affichage "non configuré"** — Si une entité est vide, affiche `(non configuré)` au lieu de `—`

## [3.2.8] — 2026-03-25
### Corrigé
- 🔄 **Cache Service Worker purgé** — Cache renommé `ev-charger-v4` (était `ev-charger-v3` depuis v3.2.5 → les mises à jour v3.2.6 et v3.2.7 n'étaient pas chargées par le navigateur)
- 🔓 **`/api/config` sans authentification** — L'endpoint était protégé par session, causant des entités `—` si la session expirait
- 🏷️ **Version footer dynamique** — La version en bas de page est maintenant lue depuis le serveur (plus de "v3.0" figé)

## [3.2.7] — 2026-03-25
### Corrigé
- 🔌 **Entités dynamiques en Réglages** — Les noms d'entités sont chargés depuis `/api/config` (n'étaient pas hardcodés en HTML)
- 💰 **Coût calculé côté serveur** — `session_cost` calculé dans `/api/status` avec les tarifs disponibles
- ↩️ **Bouton Annuler** — Ajout d'un bouton "Annuler" dans la page Réglages pour revenir sans sauvegarder

## [3.2.6] — 2026-03-25
### Corrigé
- 🔌 **Défauts sensors corrigés dans `config.yaml`** — Les valeurs par défaut étaient incorrectes (`sensor.prise_voiture_puissance` → `sensor.prise_voiture_puissance_2`)
- 📱 **Manifest PWA** — Icons avec purposes séparés (`any` et `maskable`) requis par Chrome pour l'installation
- 📋 **Logs de démarrage** — Affichage des entités chargées dans les logs de l'addon au démarrage

## [3.2.5] — 2026-03-25
### Ajouté
- 📱 **Bouton d'installation PWA** — Détection iOS/Android avec instructions adaptées
- 🔄 **Cache SW v3** — Version forcée pour purger les anciens caches

## [3.2.4] — 2026-03-25
### Corrigé
- 🐛 **Crash 500 `/api/status`** — Migration automatique de la base SQLite pour ajouter les colonnes `user_id` et `notes` manquantes

## [3.2.3] — 2026-03-25
### Corrigé
- 🔐 **Boucle auth infinie** — Le Service Worker ne cache plus `/auth/check` ni les requêtes POST
- 🌐 **Endpoint HA corrigé** — `/api/auth/current_user` au lieu de `/api/auth/user`

## [3.2.2] — 2026-03-25
### Corrigé
- 🔑 **OAuth client_id** — URL complète `https://pwa.domotique-nicof73.ovh` au lieu du slug
- 🌐 **trusted_proxies** — Ajout du réseau `192.168.1.0/24` pour le proxy NGINX local
- ❌ **`base_url` supprimé** — Option dépréciée dans HA moderne

## [2.0] — Version initiale
### Fonctionnalités
- Authentification OAuth2 via Home Assistant
- Sessions de recharge avec stockage SQLite
- Contrôle du switch prise voiture
- Calcul HP/HC avec tarifs configurables
- Interface PWA multiutilisateur avec rôles HA
