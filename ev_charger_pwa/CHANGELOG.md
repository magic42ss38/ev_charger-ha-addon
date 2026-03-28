# Changelog — EV Charger PWA

## [3.2.10] — 2026-03-28
### Corrigé
- 🔄 **Auto-création de session** — Si le switch est activé depuis HA (pas via la PWA) ou si la session était perdue, `/api/status` crée maintenant automatiquement une session en base → kWh, coût et durée s'affichent correctement
- 🔌 **Switch entity toujours visible** — Ajout d'un fallback : si `loadSettings()` échoue (erreur 401 ou réseau), l'entité switch est récupérée depuis le polling `/api/status` (toutes les 5s) via `data.switch.entity_id`
- 🛡️ **Protection null dans loadSettings()** — La fonction ne plante plus silencieusement si `/api/config` renvoie `null` (401 temporaire au chargement)
- 💶 **Coût session depuis serveur** — Le coût affiché utilise `session_cost` calculé côté serveur plutôt qu'une recalcul JS potentiellement incohérent
- 🔢 **Cache SW v5** — Nouveau nom `ev-charger-v5` pour forcer le rechargement du SW après mise à jour

## [3.2.9] — 2026-03-26
### Corrigé
- 🛡️ **Défauts robustes** — `SWITCH_ENTITY`, `POWER_SENSOR`, `ENERGY_SENSOR` ont un fallback Python (`"" or "valeur_défaut"`) même si `/data/options.json` retourne une valeur vide
- ⚡ **Fallback kWh via puissance** — Si `energy_start=NULL` (sensor indisponible au démarrage), le kWh est estimé via `puissance (W) × durée (h)` lors de l'arrêt
- 🔌 **Switch dynamique** — L'entité switch est maintenant chargée dynamiquement depuis `/api/config` (plus hardcodée)
- 🖥️ **Protection null cfg** — loadSettings() null-safe si /api/config échoue

## [3.2.8] — 2026-03-25
### Corrigé
- 🔄 **Cache SW v4** — Changement du nom de cache `ev-charger-v3` → `ev-charger-v4` pour forcer le rechargement complet du Service Worker
- 🔓 **`/api/config` sans auth** — Endpoint rendu public (suppression de `Depends(get_session)`)
- 🏷️ **Version footer dynamique** — Lue depuis `/api/config` (plus jamais "v3.0" figé)

## [3.2.7] — 2026-03-24
### Corrigé
- 🖥️ **Entités hardcodées dans réglages** — Les noms d'entités HA étaient écrits en dur dans le HTML. Désormais chargés depuis `/api/config`
- 💶 **Coût session côté serveur** — Ajout de `session_cost` dans `/api/status` calculé avec les tarifs user
- ↩️ **Bouton Annuler dans réglages** — Retour sans sauvegarde

## [3.2.6] — 2026-03-23
### Corrigé
- 📋 **Defaults config.yaml** — Noms d'entités corrects dans les valeurs par défaut
- 📱 **manifest.json PWA** — Icônes séparées "any" et "maskable" (requis Chrome)
- 🔍 **Logs démarrage** — Affichage des sensors chargés au démarrage

## [3.2.5] — 2026-03-22
### Ajouté
- 📲 **Bouton installation PWA** — Détection iOS/Android avec instructions spécifiques
- 🔢 **Cache SW v3** — Forçage de la version cache Service Worker

## [3.2.4] — 2026-03-21
### Corrigé
- 🗄️ **Migration DB** — Ajout colonnes `user_id` et `notes` dans `sessions` (upgrade depuis v2)

## [3.2.3] — 2026-03-20
### Corrigé
- 🔄 **Boucle auth** — Le SW ne cache plus `/auth/check` ni les requêtes POST
- 🔗 **Endpoint HA** — Correction vers `/api/auth/current_user`

## [3.2.2] — 2026-03-19
### Corrigé
- 🔑 **OAuth client_id** — Utilise l'URL publique PWA complète
- 🌐 **trusted_proxies** — Ajout du sous-réseau `192.168.1.0/24`
- 🗑️ **`base_url` supprimé** — Option dépréciée retirée

## [2.0] — Version initiale
### Fonctionnalités de base
- Badge utilisateur avec initiales et rôle HA
- Thème clair/sombre avec préférence système
- Page statistiques mensuelles avec graphe kWh par semaine
- Export CSV des sessions
- Widget "prochaine HC dans X minutes"
