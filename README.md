# ⚡ EV Charger PWA — Home Assistant Addon

Application web progressive (PWA) de gestion de recharge véhicule électrique, déployée comme addon Home Assistant.

---

## 📋 Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Déploiement NGINX](#déploiement-nginx)
- [Configuration Home Assistant](#configuration-home-assistant)
- [Installation PWA sur téléphone](#installation-pwa-sur-téléphone)
- [Entités HA requises](#entités-ha-requises)
- [Dépannage](#dépannage)
- [Changelog](#changelog)

---

## ✨ Fonctionnalités

- 🔐 **Authentification OAuth2** via Home Assistant (SSO natif)
- 👤 **Badge utilisateur** avec initiales colorées et rôle HA (Owner / Admin / User)
- 🌙 **Thème clair/sombre** avec détection automatique des préférences système + toggle manuel
- ⚡ **Contrôle de la prise de recharge** (`switch.prise_voiture`)
- 📊 **Statistiques mensuelles** avec graphe kWh par semaine
- 📥 **Export CSV** des sessions de recharge
- 🕐 **Widget heure creuse** — "prochain créneau HC dans X minutes"
- 📱 **PWA installable** sur Android et iOS
- 🔄 **Fonctionnement offline** via Service Worker

---

## 🏗️ Architecture

```
Internet
   │
   ▼
NGINX (192.168.1.102:443)
   │  proxy_pass
   ▼
Home Assistant Addon (port 8765)
   │
   ├── FastAPI backend (main.py)
   ├── SQLite (sessions.db)
   └── PWA (HTML/CSS/JS + Service Worker)
```

- **Backend** : Python 3.11 / FastAPI / Uvicorn
- **Frontend** : Vanilla JS, CSS custom, Service Worker
- **Auth** : OAuth2 Authorization Code Flow via HA
- **DB** : SQLite pour les sessions de recharge

---

## 📦 Prérequis

| Composant | Version minimale |
|---|---|
| Home Assistant | 2024.1+ |
| NGINX | 1.18+ |
| Certificat SSL | Let's Encrypt recommandé |

---

## 🚀 Installation

### 1. Ajouter le dépôt dans HA

**Paramètres → Modules complémentaires → Boutique → ⋮ → Dépôts**

Ajouter l'URL de ton dépôt GitHub.

### 2. Installer l'addon

Rechercher **"EV Charger PWA"** → **Installer** → attendre la fin du build Docker.

### 3. Configurer l'addon

Onglet **Configuration** de l'addon (voir section [Configuration](#configuration)).

### 4. Démarrer l'addon

Onglet **Info** → **DÉMARRER**  
Activer **"Démarrer au démarrage"** et **"Watchdog"**.

---

## ⚙️ Configuration

Dans l'onglet **Configuration** de l'addon :

```yaml
pwa_url: "https://pwa.domotique-nicof73.ovh"   # URL publique de la PWA (= OAuth client_id)
ha_url: "https://ha.domotique-nicof73.ovh"      # URL publique de Home Assistant
switch_entity: "switch.prise_voiture"           # Entité switch de la prise
power_sensor: "sensor.prise_voiture_puissance_2"  # Sensor puissance (W)
energy_sensor: "sensor.prise_voiture_energy"      # Sensor énergie (kWh)
hp_price: 0.2516                                # Tarif Heures Pleines (€/kWh)
hc_price: 0.1654                                # Tarif Heures Creuses (€/kWh)
```

> ⚠️ **Important** : après tout changement de configuration, **redémarrer l'addon** pour que les nouvelles valeurs soient prises en compte.

---

## 🌐 Déploiement NGINX

Fichier de configuration NGINX pour le reverse proxy :

```nginx
server {
    listen 443 ssl;
    server_name pwa.domotique-nicof73.ovh;

    ssl_certificate     /etc/letsencrypt/live/pwa.domotique-nicof73.ovh/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/pwa.domotique-nicof73.ovh/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:8765;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name pwa.domotique-nicof73.ovh;
    return 301 https://$host$request_uri;
}
```

---

## 🏠 Configuration Home Assistant

Ajouter dans `/config/configuration.yaml` :

```yaml
http:
  use_x_forwarded_for: true
  trusted_proxies:
    - 172.30.0.0/16    # Réseau interne Docker HA
    - 172.16.0.0/12    # Réseau Docker étendu
    - 192.168.1.0/24   # Réseau LAN local
    - 127.0.0.1
    - ::1
  ip_ban_enabled: true
  login_attempts_threshold: 10
```

> ⚠️ **Sans `trusted_proxies`**, HA rejette les requêtes OAuth du proxy NGINX avec une erreur 400/403.

Après modification : **Outils de développement → YAML → Vérifier la configuration → Redémarrer HA**

---

## 📱 Installation PWA sur téléphone

### Android (Chrome)
1. Ouvrir `https://pwa.domotique-nicof73.ovh` dans Chrome
2. Se connecter via HA
3. Appuyer sur le bouton **⬇️** dans le header de l'app
4. Confirmer l'installation dans le prompt du navigateur

### iOS (Safari) — ⚠️ Safari obligatoire
1. Ouvrir `https://pwa.domotique-nicof73.ovh` dans **Safari** (pas Chrome)
2. Se connecter via HA
3. Appuyer sur le bouton **⬇️** dans le header de l'app
4. Suivre le guide affiché :
   - Appuyer sur l'icône **Partager** (carré avec flèche ↑)
   - Sélectionner **"Sur l'écran d'accueil"**
   - Confirmer avec **"Ajouter"**

---

## 🔌 Entités HA requises

| Entité | Type | Unité | Description |
|---|---|---|---|
| `switch.prise_voiture` | switch | — | Contrôle de la prise de recharge |
| `sensor.prise_voiture_puissance_2` | sensor | W | Puissance instantanée |
| `sensor.prise_voiture_energy` | sensor | kWh | Énergie totale consommée |

### Vérifier les entités

**Outils de développement → Modèle** :

```jinja2
Prise : {{ states('switch.prise_voiture') }}
Puissance : {{ states('sensor.prise_voiture_puissance_2') }} W
Énergie : {{ states('sensor.prise_voiture_energy') }} kWh
```

Les trois valeurs doivent être numériques (pas `unknown` ou `unavailable`).

---

## 🛠️ Dépannage

### 403 Forbidden sur ha.domotique-nicof73.ovh

HA a banni ton IP après trop de tentatives échouées.

```bash
# Via Terminal HA — vérifier les IPs bannies
cat /config/ip_bans.yaml

# Vider les bans
echo "" > /config/ip_bans.yaml
```

Puis redémarrer HA.

### Erreur 500 sur /api/status

Migration DB manquante. Vérifier les logs de l'addon :  
→ Si `no such column: user_id` → mettre à jour vers **v3.2.4+**

### Service Worker qui cache les anciennes versions

F12 → **Application → Storage → Clear site data** ✓

### Les sensors affichent `unavailable`

1. Vérifier que l'intégration est bien configurée dans HA
2. Vérifier l'`entity_id` exact dans **Outils de développement → États**
3. Mettre à jour `power_sensor` et `energy_sensor` dans la config de l'addon
4. **Redémarrer l'addon**

---

## 📋 Changelog

Voir le fichier [CHANGELOG.md](ev_charger_pwa/CHANGELOG.md) pour l'historique complet des versions.

**Version actuelle : 3.2.5**

---

## 👤 Auteur

**NicoF73** — Domotique Savoie  
🌐 `ha.domotique-nicof73.ovh`

