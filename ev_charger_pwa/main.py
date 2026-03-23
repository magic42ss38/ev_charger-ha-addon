"""
EV Charger PWA - FastAPI Backend
Gestion des sessions de recharge avec calcul HP/HC
"""
import os
import json
import asyncio
import logging
from datetime import datetime, time
from typing import Optional
from contextlib import asynccontextmanager

import httpx
import aiosqlite
from fastapi import FastAPI, HTTPException, Depends, Header, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
HA_TOKEN = os.getenv("HA_TOKEN", "")
HA_URL = os.getenv("HA_URL", "http://homeassistant:8123")
SWITCH_ENTITY = os.getenv("SWITCH_ENTITY", "switch.prise_voiture")
POWER_SENSOR = os.getenv("POWER_SENSOR", "sensor.puissance_voiture2")
ENERGY_SENSOR = os.getenv("ENERGY_SENSOR", "sensor.energy_voiture")
TARIF_HP = float(os.getenv("TARIF_HP", "0.2516"))
TARIF_HC = float(os.getenv("TARIF_HC", "0.1654"))
HC_START = os.getenv("HC_START", "22:00")
HC_END = os.getenv("HC_END", "06:00")
NOTIFICATION_THRESHOLD = float(os.getenv("NOTIFICATION_THRESHOLD", "0.1"))
DB_PATH = "/data/sessions.db"

# ─── DB Init ──────────────────────────────────────────────────────────────────
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                energy_start REAL,
                energy_end REAL,
                energy_kwh REAL,
                cost REAL,
                tarif_mode TEXT,
                status TEXT DEFAULT 'active',
                notes TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                subscription TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()
    logger.info("DB initialisée")

# ─── Helpers ──────────────────────────────────────────────────────────────────
def is_heure_creuse(dt: datetime = None) -> bool:
    """Détermine si l'heure actuelle est en HC."""
    if dt is None:
        dt = datetime.now()
    t = dt.time()
    try:
        h_start = time(*map(int, HC_START.split(":")))
        h_end = time(*map(int, HC_END.split(":")))
    except Exception:
        return False
    if h_start > h_end:  # HC sur minuit (ex: 22h → 6h)
        return t >= h_start or t < h_end
    return h_start <= t < h_end

def get_tarif(dt: datetime = None) -> tuple[float, str]:
    """Retourne (tarif, mode)."""
    hc = is_heure_creuse(dt)
    return (TARIF_HC, "HC") if hc else (TARIF_HP, "HP")

async def ha_get(path: str):
    """GET vers l'API Home Assistant."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(
            f"{HA_URL}/api/{path}",
            headers={"Authorization": f"Bearer {HA_TOKEN}"}
        )
        r.raise_for_status()
        return r.json()

async def ha_post(path: str, payload: dict):
    """POST vers l'API Home Assistant."""
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(
            f"{HA_URL}/api/{path}",
            headers={"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"},
            json=payload
        )
        r.raise_for_status()
        return r.json()

async def get_entity_state(entity_id: str) -> dict:
    try:
        return await ha_get(f"states/{entity_id}")
    except Exception as e:
        logger.error(f"Erreur état {entity_id}: {e}")
        return {"state": "unavailable", "attributes": {}}

async def get_energy_value() -> Optional[float]:
    state = await get_entity_state(ENERGY_SENSOR)
    try:
        return float(state["state"])
    except (ValueError, KeyError):
        return None

async def close_active_session():
    """Ferme toute session active."""
    energy_end = await get_energy_value()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, energy_start, tarif_mode FROM sessions WHERE status='active' ORDER BY id DESC LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()
        if row:
            sid, energy_start, tarif_mode = row
            end_time = datetime.now().isoformat()
            kwh = None
            cost = None
            if energy_start is not None and energy_end is not None:
                kwh = max(0, energy_end - energy_start)
                tarif_val = TARIF_HC if tarif_mode == "HC" else TARIF_HP
                cost = round(kwh * tarif_val, 4)
            await db.execute("""
                UPDATE sessions SET
                    end_time=?, energy_end=?, energy_kwh=?, cost=?, status='completed'
                WHERE id=?
            """, (end_time, energy_end, kwh, cost, sid))
            await db.commit()
            logger.info(f"Session {sid} fermée: {kwh} kWh, {cost}€")

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

# ─── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="EV Charger API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Auth ─────────────────────────────────────────────────────────────────────
async def verify_token(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="Token manquant")
    token = authorization.replace("Bearer ", "")
    if token != HA_TOKEN:
        raise HTTPException(status_code=403, detail="Token invalide")
    return token

# ─── Models ───────────────────────────────────────────────────────────────────
class TarifConfig(BaseModel):
    tarif_hp: float
    tarif_hc: float
    hc_start: str
    hc_end: str

class PushSubscription(BaseModel):
    subscription: dict

class SessionNote(BaseModel):
    notes: str

# ─── Routes API ───────────────────────────────────────────────────────────────

@app.get("/api/status")
async def get_status(token: str = Depends(verify_token)):
    """État complet : switch + capteurs + session active + tarif."""
    switch_state = await get_entity_state(SWITCH_ENTITY)
    power_state = await get_entity_state(POWER_SENSOR)
    energy_state = await get_entity_state(ENERGY_SENSOR)

    tarif, mode = get_tarif()
    is_on = switch_state.get("state") == "on"

    # Session active
    active_session = None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE status='active' ORDER BY id DESC LIMIT 1"
        ) as cursor:
            row = await cursor.fetchone()
        if row:
            active_session = dict(row)

    # Puissance
    try:
        power = float(power_state.get("state", 0))
    except (ValueError, TypeError):
        power = 0.0

    # Énergie session en cours
    session_kwh = None
    if active_session and active_session.get("energy_start") is not None:
        try:
            current_energy = float(energy_state.get("state", 0))
            session_kwh = max(0, current_energy - active_session["energy_start"])
        except (ValueError, TypeError):
            pass

    return {
        "switch": {
            "state": switch_state.get("state"),
            "entity_id": SWITCH_ENTITY,
            "friendly_name": switch_state.get("attributes", {}).get("friendly_name", SWITCH_ENTITY)
        },
        "power": {
            "value": power,
            "unit": power_state.get("attributes", {}).get("unit_of_measurement", "W"),
            "entity_id": POWER_SENSOR
        },
        "energy": {
            "value": energy_state.get("state"),
            "unit": energy_state.get("attributes", {}).get("unit_of_measurement", "kWh"),
            "entity_id": ENERGY_SENSOR
        },
        "tarif": {
            "mode": mode,
            "value": tarif,
            "hc_start": HC_START,
            "hc_end": HC_END
        },
        "session_active": active_session,
        "session_kwh": session_kwh,
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/switch/on")
async def switch_on(token: str = Depends(verify_token)):
    """Allume la prise et ouvre une session."""
    # Fermer toute session zombie
    await close_active_session()

    # Allumer
    await ha_post(f"services/switch/turn_on", {"entity_id": SWITCH_ENTITY})

    # Créer session
    energy_start = await get_energy_value()
    tarif, mode = get_tarif()
    now = datetime.now().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("""
            INSERT INTO sessions (start_time, energy_start, tarif_mode, status)
            VALUES (?, ?, ?, 'active')
        """, (now, energy_start, mode))
        session_id = cursor.lastrowid
        await db.commit()

    logger.info(f"Session {session_id} ouverte. Énergie départ: {energy_start} kWh. Tarif: {mode} ({tarif}€)")
    return {"success": True, "session_id": session_id, "tarif_mode": mode, "tarif": tarif}


@app.post("/api/switch/off")
async def switch_off(token: str = Depends(verify_token)):
    """Éteint la prise et clôture la session."""
    await ha_post(f"services/switch/turn_off", {"entity_id": SWITCH_ENTITY})
    await close_active_session()
    return {"success": True}


@app.get("/api/sessions")
async def get_sessions(limit: int = 50, token: str = Depends(verify_token)):
    """Historique des sessions."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions ORDER BY id DESC LIMIT ?", (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
    sessions = [dict(r) for r in rows]

    # Stats globales
    total_kwh = sum(s["energy_kwh"] or 0 for s in sessions if s["status"] == "completed")
    total_cost = sum(s["cost"] or 0 for s in sessions if s["status"] == "completed")
    return {
        "sessions": sessions,
        "stats": {
            "total_sessions": len([s for s in sessions if s["status"] == "completed"]),
            "total_kwh": round(total_kwh, 3),
            "total_cost": round(total_cost, 2)
        }
    }


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int, token: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        await db.commit()
    return {"success": True}


@app.patch("/api/sessions/{session_id}/notes")
async def update_notes(session_id: int, body: SessionNote, token: str = Depends(verify_token)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE sessions SET notes=? WHERE id=?", (body.notes, session_id))
        await db.commit()
    return {"success": True}


@app.get("/api/tarifs")
async def get_tarifs(token: str = Depends(verify_token)):
    return {
        "tarif_hp": TARIF_HP,
        "tarif_hc": TARIF_HC,
        "hc_start": HC_START,
        "hc_end": HC_END,
        "mode_actuel": "HC" if is_heure_creuse() else "HP"
    }


@app.post("/api/tarifs")
async def update_tarifs(config: TarifConfig, token: str = Depends(verify_token)):
    """Met à jour les tarifs en runtime (persisté en DB)."""
    global TARIF_HP, TARIF_HC, HC_START, HC_END
    TARIF_HP = config.tarif_hp
    TARIF_HC = config.tarif_hc
    HC_START = config.hc_start
    HC_END = config.hc_end
    async with aiosqlite.connect(DB_PATH) as db:
        for k, v in [("tarif_hp", str(TARIF_HP)), ("tarif_hc", str(TARIF_HC)),
                     ("hc_start", HC_START), ("hc_end", HC_END)]:
            await db.execute("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)", (k, v))
        await db.commit()
    return {"success": True, "tarif_hp": TARIF_HP, "tarif_hc": TARIF_HC}


@app.post("/api/push/subscribe")
async def push_subscribe(sub: PushSubscription, token: str = Depends(verify_token)):
    sub_str = json.dumps(sub.subscription)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO push_subscriptions (subscription) VALUES (?)", (sub_str,)
        )
        await db.commit()
    return {"success": True}


@app.get("/api/ha/states/{entity_id}")
async def proxy_ha_state(entity_id: str, token: str = Depends(verify_token)):
    """Proxy transparent vers HA pour les états."""
    return await get_entity_state(entity_id)


# ─── Charge session watchdog (notif si fin de charge détectée) ────────────────
async def watchdog():
    """Vérifie toutes les 30s si la puissance est tombée → session terminée."""
    was_charging = False
    while True:
        await asyncio.sleep(30)
        try:
            state = await get_entity_state(SWITCH_ENTITY)
            if state.get("state") != "on":
                was_charging = False
                continue
            power_state = await get_entity_state(POWER_SENSOR)
            power = float(power_state.get("state", 0))
            if was_charging and power < NOTIFICATION_THRESHOLD * 1000:
                logger.info(f"Fin de charge détectée: {power}W < {NOTIFICATION_THRESHOLD*1000}W")
                # Notifier HA (persistent notification)
                await ha_post("services/persistent_notification/create", {
                    "title": "🔋 Charge terminée",
                    "message": f"La voiture est chargée. Puissance actuelle: {power:.0f}W",
                    "notification_id": "ev_charge_done"
                })
                was_charging = False
            elif power >= NOTIFICATION_THRESHOLD * 1000:
                was_charging = True
        except Exception as e:
            logger.debug(f"Watchdog error: {e}")


@app.on_event("startup")
async def start_watchdog():
    asyncio.create_task(watchdog())


# ─── PWA Static files ─────────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="/app/pwa", html=True), name="pwa")

@app.get("/")
async def root():
    return {"status": "ok", "service": "EV Charger API"}

@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}
