# ⚡ EV Charger PWA — Addon Home Assistant

PWA de gestion de recharge voiture électrique, hébergée directement sur Home Assistant.

---

## Fonctionnalités

- **Contrôle de la prise** `switch.prise_voiture` depuis l'extérieur
- **Puissance en temps réel** avec graphique
- **Sessions de recharge** avec calcul automatique HP/HC
- **Coût estimé** en direct pendant la charge
- **Historique** des sessions avec coût total
- **Notifications push** quand la charge est terminée
- **PWA installable** sur Android / iOS

---

## Architecture

```
Internet
  └─ Cloudflare DNS (ha.domotique-nicof73.ovh)
       └─ NGINX Proxy Manager
            ├─ /        → Home Assistant Core (port 8123)
            └─ /pwa     → FastAPI Addon (port 8765)
                              ├─ Sert la PWA (HTML/CSS/JS)
                              ├─ API REST /api/*
                              └─ SQLite (sessions)
```

---

## Installation

### Étape 1 — Publier le repo sur GitHub

```bash
# Créer un repo GitHub public (ex: ev-charger-ha-addon)
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/TON_USERNAME/ev-charger-ha-addon.git
git push -u origin main
```

### Étape 2 — Ajouter le repo dans Home Assistant

1. Dans HA → **Paramètres** → **Modules complémentaires**
2. Cliquer les **3 points** en haut à droite → **Dépôts**
3. Ajouter : `https://github.com/TON_USERNAME/ev-charger-ha-addon`
4. Rafraîchir la page
5. L'addon **"EV Charger PWA"** apparaît dans le store

### Étape 3 — Configurer l'addon

Dans la config de l'addon (onglet **Configuration**) :

```yaml
ha_token: "eyJ0eXAiOiJKV1Q..."   # Token longue durée (voir ci-dessous)
ha_url: "http://homeassistant:8123"
switch_entity: "switch.prise_voiture"
power_sensor: "sensor.puissance_voiture2"
energy_sensor: "sensor.prise_voiture_energy"
tarif_hp: 0.2516                   # €/kWh HP EDF
tarif_hc: 0.1654                   # €/kWh HC EDF
hc_start: "22:00"                  # Début heures creuses
hc_end: "06:00"                    # Fin heures creuses
notification_threshold_kw: 0.1     # Seuil fin de charge (kW)
```

#### Créer le token Home Assistant

1. HA → **Profil** (icône en bas à gauche)
2. Onglet **Sécurité**
3. Section **Tokens d'accès longue durée** → **Créer un token**
4. Nommer-le "EV Charger PWA"
5. Copier le token (ne s'affiche qu'une fois !)

### Étape 4 — Démarrer l'addon

1. Onglet **Info** → **Démarrer**
2. Vérifier les logs : `Démarrage EV Charger PWA...`
3. Tester localement : `http://IP_RASPI:8765/pwa`

### Étape 5 — Configurer NGINX Proxy Manager

Dans **NGINX Proxy Manager** → ton proxy host `ha.domotique-nicof73.ovh` :

1. Onglet **Advanced** → coller le contenu de `nginx_config.conf`
2. Remplacer `127.0.0.1` par l'IP du Raspberry si NPM est dans Docker
3. Sauvegarder

**Test :** `https://ha.domotique-nicof73.ovh/pwa`

### Étape 6 — Configuration Cloudflare

1. SSL/TLS → Mode **Full (strict)**
2. Cache Rules → Créer une règle :
   - Si URL contient `/api/` → Cache Level: **Bypass**
   - Évite que Cloudflare cache les réponses API

### Étape 7 — Configurer la PWA

1. Ouvrir `https://ha.domotique-nicof73.ovh/pwa`
2. Onglet **Réglages**
3. Coller ton token HA
4. Ajuster les tarifs HP/HC si besoin
5. Sauvegarder

---

## Utilisation

### Démarrer une charge

1. Ouvrir la PWA
2. Vérifier le badge tarifaire en haut (HP ou HC)
3. Appuyer sur le **bouton rond**
4. Confirmer → la session démarre

Le compteur kWh, le coût et la durée s'affichent en temps réel.

### Arrêter une charge

1. Appuyer sur le bouton
2. Confirmer l'arrêt
3. La session est enregistrée automatiquement

### Installer sur le téléphone

**Android :**
- Chrome → Menu (3 points) → "Ajouter à l'écran d'accueil"

**iOS :**
- Safari → Partager → "Sur l'écran d'accueil"

---

## Sensor energy_voiture — Reset quotidien

Ton capteur `sensor.prise_voiture_energy` se remet à zéro quotidiennement.
Le système gère ça correctement :

- À chaque **début de session**, l'énergie de départ est sauvegardée
- Si le capteur repart de 0 en cours de session, la prochaine session
  repart proprement depuis la nouvelle base
- Si tu veux un compteur cumulé, crée un utility_meter dans HA :

```yaml
# configuration.yaml
utility_meter:
  energy_voiture_total:
    source: sensor.prise_voiture_energy
    cycle: monthly
```

---

## Structure du projet

```
ev-charger-ha-addon/
├── config.yaml          # Définition addon HA
├── build.json           # Multi-arch (aarch64, amd64, armv7...)
├── Dockerfile           # Image Python Alpine
├── requirements.txt     # FastAPI, uvicorn, aiosqlite...
├── main.py              # Serveur FastAPI complet
├── repository.json      # Pour le store HA
├── nginx_config.conf    # Config NGINX Proxy Manager
└── rootfs/
    └── usr/bin/
        └── ev_charger.sh  # Script de démarrage
└── pwa/
    ├── index.html       # App principale
    ├── manifest.json    # PWA manifest
    ├── sw.js            # Service Worker
    ├── css/
    │   └── style.css    # Thème dark industriel
    ├── js/
    │   └── app.js       # Logique app
    └── icons/
        ├── icon-192.png
        └── icon-512.png
```

---

## API Reference

| Méthode | Endpoint | Description |
|---------|----------|-------------|
| GET | `/api/status` | État complet (switch, puissance, session) |
| POST | `/api/switch/on` | Allumer + ouvrir session |
| POST | `/api/switch/off` | Éteindre + clôturer session |
| GET | `/api/sessions` | Historique + stats |
| DELETE | `/api/sessions/{id}` | Supprimer session |
| GET | `/api/tarifs` | Tarifs HP/HC actuels |
| POST | `/api/tarifs` | Modifier tarifs |
| POST | `/api/push/subscribe` | Abonnement notifications |

Tous les endpoints requièrent : `Authorization: Bearer <HA_TOKEN>`

---

## Dépannage

**La PWA ne charge pas les données**
→ Vérifier les logs de l'addon
→ Tester `http://IP_RASPI:8765/api/status` en local

**"Token invalide"**
→ Vérifier que le token est bien collé sans espace
→ Le token HA doit être un token longue durée, pas le mot de passe

**Les sessions n'ont pas de kWh**
→ Vérifier que `sensor.prise_voiture_energy` retourne bien une valeur numérique
→ Dans HA : Outils développeur → États → chercher l'entité

**NGINX 502 Bad Gateway**
→ L'addon n'est pas démarré, ou le port 8765 n'est pas accessible
→ Si NPM est en Docker, utiliser l'IP du RPi dans proxy_pass

**Cloudflare cache l'API**
→ Créer une Cache Rule pour bypass sur `/api/*`

---

## Changelog

### v1.0.0
- Version initiale
- Contrôle switch Tuya
- Sessions HP/HC avec calcul coût
- Graphique puissance temps réel
- Historique des sessions
- Notifications push
- PWA installable
