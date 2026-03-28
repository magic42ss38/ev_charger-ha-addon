"""
EV Charger PWA - FastAPI Backend v3.2.3
PropalC : OAuth2 HA + Session FastAPI étendue
- Rôle HA (propriétaire / admin / utilisateur)
- Stats hebdomadaires (kWh par semaine d'un mois)
- Export CSV amélioré
- Préférences thème par utilisateur
"""
import os, json, asyncio, logging, secrets, hashlib
from datetime import datetime, time, timedelta
from typing import Optional
from contextlib import asynccontextmanager

import httpx
import aiosqlite
from fastapi import FastAPI, HTTPException, Depends, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse, PlainTextResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
# ── Lecture options depuis /data/options.json (HA addon) avec fallback os.getenv ──
def _load_options() -> dict:
    """Lit /data/options.json si disponible, sinon retourne {}."""
    try:
        import json as _json
        with open("/data/options.json", "r") as _f:
            return _json.load(_f)
    except Exception:
        return {}

_OPT = _load_options()

def _opt(key_json: str, key_env: str, default: str = "") -> str:
    """Priorité : options.json → env var → default."""
    v = _OPT.get(key_json)
    if v is not None and str(v).strip():
        return str(v).strip()
    return os.getenv(key_env, "").strip() or default

HA_URL        = _opt("ha_url",        "HA_URL",        "http://homeassistant:8123")
HA_TOKEN      = _opt("ha_token",      "HA_TOKEN",      "")
SWITCH_ENTITY = _opt("switch_entity", "SWITCH_ENTITY", "switch.prise_voiture")
POWER_SENSOR  = _opt("power_sensor",  "POWER_SENSOR",  "sensor.prise_voiture_puissance_2")
ENERGY_SENSOR = _opt("energy_sensor", "ENERGY_SENSOR", "sensor.prise_voiture_energy")
TARIF_HP      = float(_opt("tarif_hp",   "TARIF_HP",   "0.2516"))
TARIF_HC      = float(_opt("tarif_hc",   "TARIF_HC",   "0.1654"))
HC_START      = _opt("hc_start",      "HC_START",      "22:00")
HC_END        = _opt("hc_end",        "HC_END",        "06:00")
NOTIFICATION_THRESHOLD = float(_opt("notification_threshold_kw", "NOTIFICATION_THRESHOLD", "0.1"))
DB_PATH       = "/data/sessions.db"

# Auth mot de passe simple
APP_PASSWORD       = _opt("app_password",  "APP_PASSWORD",  "changeme")
ADMIN_NAME         = _opt("admin_name",    "ADMIN_NAME",    "Admin")
SESSION_SECRET     = os.getenv("SESSION_SECRET", secrets.token_hex(32))
SESSION_DURATION_H = 24

# ─── DB ───────────────────────────────────────────────────────────────────────
async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                start_time TEXT NOT NULL,
                end_time TEXT,
                energy_start REAL,
                energy_end REAL,
                energy_kwh REAL,
                cost REAL,
                tarif_mode TEXT,
                status TEXT DEFAULT 'active',
                notes TEXT
            )""")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                user_name TEXT,
                user_display_name TEXT,
                ha_role TEXT DEFAULT 'user',
                ha_access_token TEXT,
                ha_refresh_token TEXT,
                ha_token_expires TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_seen TEXT
            )""")
        # Migration : ajouter la colonne ha_role si elle n'existe pas encore
        try:
            await db.execute("ALTER TABLE user_sessions ADD COLUMN ha_role TEXT DEFAULT 'user'")
        except Exception:
            pass
        # Migration : ajouter user_id à sessions si absente (upgrade depuis v2)
        try:
            await db.execute("ALTER TABLE sessions ADD COLUMN user_id TEXT")
        except Exception:
            pass
        # Migration : ajouter notes à sessions si absente
        try:
            await db.execute("ALTER TABLE sessions ADD COLUMN notes TEXT")
        except Exception:
            pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_id TEXT PRIMARY KEY,
                tarif_hp REAL,
                tarif_hc REAL,
                hc_start TEXT,
                hc_end TEXT,
                theme TEXT DEFAULT 'system',
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )""")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT
            )""")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                subscription TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )""")
        await db.commit()
    logger.info("DB v3 initialisée")

# ─── Helpers ──────────────────────────────────────────────────────────────────
def is_heure_creuse(dt=None, hc_start=HC_START, hc_end=HC_END):
    dt = dt or datetime.now()
    t = dt.time()
    try:
        h_s = time(*map(int, hc_start.split(":")))
        h_e = time(*map(int, hc_end.split(":")))
    except Exception:
        return False
    return (t >= h_s or t < h_e) if h_s > h_e else (h_s <= t < h_e)

def get_tarif(user_tarif_hp=None, user_tarif_hc=None, hc_start=None, hc_end=None):
    hp = user_tarif_hp or TARIF_HP
    hc = user_tarif_hc or TARIF_HC
    hs = hc_start or HC_START
    he = hc_end or HC_END
    is_hc = is_heure_creuse(hc_start=hs, hc_end=he)
    return (hc, "HC") if is_hc else (hp, "HP")

def minutes_until_hc(hc_start=HC_START):
    now = datetime.now()
    t = now.time()
    try:
        h_s = time(*map(int, hc_start.split(":")))
    except Exception:
        return None
    target = now.replace(hour=h_s.hour, minute=h_s.minute, second=0, microsecond=0)
    if t >= h_s:
        target += timedelta(days=1)
    return int((target - now).total_seconds() / 60)

async def ha_get(path: str, token: str = None):
    t = token or HA_TOKEN
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{HA_URL}/api/{path}",
            headers={"Authorization": f"Bearer {t}"})
        r.raise_for_status()
        return r.json()

async def ha_post(path: str, payload: dict, token: str = None):
    t = token or HA_TOKEN
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{HA_URL}/api/{path}",
            headers={"Authorization": f"Bearer {t}", "Content-Type": "application/json"},
            json=payload)
        r.raise_for_status()
        return r.json()

async def get_entity_state(entity_id: str, token: str = None):
    try:
        return await ha_get(f"states/{entity_id}", token)
    except Exception as e:
        logger.error(f"État {entity_id}: {e}")
        return {"state": "unavailable", "attributes": {}}

async def get_energy_value(token: str = None):
    s = await get_entity_state(ENERGY_SENSOR, token)
    try:
        return float(s["state"])
    except (ValueError, KeyError):
        return None

async def close_active_session(user_id: str = None, token: str = None, last_power_w: float = None):
    energy_end = await get_energy_value(token)
    async with aiosqlite.connect(DB_PATH) as db:
        q = "SELECT id,energy_start,tarif_mode,start_time FROM sessions WHERE status='active'"
        params = []
        if user_id:
            q += " AND user_id=?"
            params.append(user_id)
        q += " ORDER BY id DESC LIMIT 1"
        async with db.execute(q, params) as cur:
            row = await cur.fetchone()
        if row:
            sid, e_start, t_mode, start_time = row
            kwh = cost = None
            tv = TARIF_HC if t_mode == "HC" else TARIF_HP

            # Calcul durée (utile pour fallback)
            try:
                from datetime import datetime as _dt
                t_start = _dt.fromisoformat(start_time)
                duration_h = (datetime.now() - t_start).total_seconds() / 3600
            except Exception:
                duration_h = 0

            if e_start is not None and energy_end is not None:
                kwh = max(0, energy_end - e_start)
                cost = round(kwh * tv, 4)
                # Si le capteur énergie n'a pas bougé (mise à jour lente) ET on a la puissance
                # → utiliser le fallback puissance × durée si plus grand
                if kwh == 0 and last_power_w and last_power_w > 0 and duration_h > 0:
                    kwh_est = round(last_power_w / 1000 * duration_h, 4)
                    cost_est = round(kwh_est * tv, 4)
                    logger.warning(f"energy_end=energy_start ({e_start} kWh, capteur lent?): fallback puissance {last_power_w}W × {duration_h:.3f}h = {kwh_est} kWh")
                    kwh = kwh_est
                    cost = cost_est

            if kwh is None or kwh == 0:
                # Fallback: energy_start=NULL ou kWh=0 → estimer via puissance × durée
                pwr_w = last_power_w  # passée depuis switch_off (avant coupure)
                if pwr_w is None:
                    try:
                        pwr = await get_entity_state(POWER_SENSOR)
                        pwr_w = float(pwr.get("state", 0)) if pwr else 0
                    except Exception:
                        pwr_w = 0
                if pwr_w and pwr_w > 0 and duration_h > 0:
                    kwh = round(pwr_w / 1000 * duration_h, 4)
                    cost = round(kwh * tv, 4)
                    reason = "energy_start=NULL" if e_start is None else "kWh=0 (capteur lent)"
                    logger.warning(f"{reason}: kWh estimé via puissance ({pwr_w}W × {duration_h:.3f}h = {kwh} kWh)")
            await db.execute("""UPDATE sessions SET end_time=?,energy_end=?,
                energy_kwh=?,cost=?,status='completed' WHERE id=?""",
                (datetime.now().isoformat(), energy_end, kwh, cost, sid))
            await db.commit()

# ─── OAuth2 Session ───────────────────────────────────────────────────────────
async def get_session(request: Request):
    token = request.cookies.get("ev_session")
    if not token:
        raise HTTPException(status_code=401, detail="Non authentifié")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM user_sessions WHERE token=?", (token,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="Session invalide")
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now() - created > timedelta(hours=SESSION_DURATION_H):
        raise HTTPException(status_code=401, detail="Session expirée")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE user_sessions SET last_seen=? WHERE token=?",
            (datetime.now().isoformat(), token))
        await db.commit()
    return dict(row)

async def get_user_prefs(user_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM user_prefs WHERE user_id=?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else {}


async def get_valid_ha_token(session: dict) -> str:
    """Retourne le token HA long-lived configuré dans l'addon."""
    return HA_TOKEN

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="EV Charger API v3", lifespan=lifespan)

from starlette.middleware.base import BaseHTTPMiddleware
class ProxyHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            request.scope["scheme"] = proto
        return await call_next(request)
app.add_middleware(ProxyHeadersMiddleware)

ALLOWED_ORIGINS = [
    "https://pwa.domotique-nicof73.ovh",
    "https://ha.domotique-nicof73.ovh",
    "http://localhost:8765",
    "http://127.0.0.1:8765",
    "http://192.168.1.102:8765",
]
app.add_middleware(CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Set-Cookie"],
)

# ─── Models ───────────────────────────────────────────────────────────────────
class TarifConfig(BaseModel):
    tarif_hp: float
    tarif_hc: float
    hc_start: str
    hc_end: str

class ThemeUpdate(BaseModel):
    theme: str  # 'dark' | 'light' | 'system'

class SessionNote(BaseModel):
    notes: str

class PushSubscription(BaseModel):
    subscription: dict

# ═══════════════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    """Évite le 403 de StaticFiles quand favicon.ico est absent."""
    favicon_path = "/app/pwa/favicon.ico"
    if os.path.exists(favicon_path):
        from fastapi.responses import FileResponse
        return FileResponse(favicon_path)
    from fastapi.responses import Response
    return Response(status_code=204)

class LoginRequest(BaseModel):
    password: str
    display_name: str = ""

@app.post("/auth/login")
async def auth_login(body: LoginRequest, request: Request):
    """Authentification par mot de passe configuré dans l\'addon."""
    if body.password != APP_PASSWORD:
        raise HTTPException(status_code=401, detail="Mot de passe incorrect")

    display = body.display_name.strip() or ADMIN_NAME
    user_id = hashlib.md5(display.lower().encode()).hexdigest()[:8]

    session_token = secrets.token_urlsafe(32)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR REPLACE INTO user_sessions
            (token, user_id, user_name, user_display_name, ha_role,
             ha_access_token, ha_refresh_token, ha_token_expires, created_at, last_seen)
            VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (session_token, user_id, display, display, "admin",
             "", "", "",
             datetime.now().isoformat(), datetime.now().isoformat()))
        await db.commit()

    logger.info(f"Connexion: {display} ({user_id})")

    response = JSONResponse({"success": True, "display_name": display})
    is_secure = request.headers.get("x-forwarded-proto", "http") == "https"
    response.set_cookie("ev_session", session_token,
        max_age=SESSION_DURATION_H * 3600,
        httponly=True, samesite="lax", secure=is_secure)
    return response

@app.post("/auth/logout")
async def auth_logout(session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM user_sessions WHERE token=?", (session["token"],))
        await db.commit()
    response = JSONResponse({"success": True})
    response.delete_cookie("ev_session")
    return response

@app.get("/auth/check")
async def auth_check(request: Request):
    token = request.cookies.get("ev_session")
    if not token:
        return {"authenticated": False}
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_id,user_name,user_display_name,ha_role,created_at FROM user_sessions WHERE token=?",
            (token,)
        ) as cur:
            row = await cur.fetchone()
    if not row:
        return {"authenticated": False}
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now() - created > timedelta(hours=SESSION_DURATION_H):
        return {"authenticated": False}
    return {
        "authenticated": True,
        "user_id":      row["user_id"],
        "user_name":    row["user_name"],
        "display_name": row["user_display_name"],
        "ha_role":      row["ha_role"] or "user",
    }

# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES (authentifiées)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/me")
async def get_me(session=Depends(get_session)):
    prefs = await get_user_prefs(session["user_id"])
    return {
        "user_id":      session["user_id"],
        "user_name":    session["user_name"],
        "display_name": session["user_display_name"],
        "ha_role":      session.get("ha_role", "user"),
        "theme":        prefs.get("theme", "system"),
        "tarif_hp":     prefs.get("tarif_hp") or TARIF_HP,
        "tarif_hc":     prefs.get("tarif_hc") or TARIF_HC,
        "hc_start":     prefs.get("hc_start") or HC_START,
        "hc_end":       prefs.get("hc_end")   or HC_END,
    }


@app.get("/api/config")
async def get_config():
    """Retourne la configuration publique (entités, etc.) pour l'UI."""
    return {
        "power_sensor":  POWER_SENSOR,
        "energy_sensor": ENERGY_SENSOR,
        "switch_entity": SWITCH_ENTITY,
        "pwa_version":   "3.2.17"
    }

@app.get("/api/status")
async def get_status(session=Depends(get_session)):
    prefs  = await get_user_prefs(session["user_id"])
    ha_tok = await get_valid_ha_token(session)

    switch_state = await get_entity_state(SWITCH_ENTITY, ha_tok)
    power_state  = await get_entity_state(POWER_SENSOR,  ha_tok)
    energy_state = await get_entity_state(ENERGY_SENSOR, ha_tok)

    hp = prefs.get("tarif_hp") or TARIF_HP
    hc = prefs.get("tarif_hc") or TARIF_HC
    hs = prefs.get("hc_start") or HC_START
    he = prefs.get("hc_end")   or HC_END

    tarif_val, mode = get_tarif(hp, hc, hs, he)

    try:
        power = float(power_state.get("state", 0))
    except (ValueError, TypeError):
        power = 0.0

    active_session = None
    session_kwh    = None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE status='active' AND user_id=? ORDER BY id DESC LIMIT 1",
            (session["user_id"],)
        ) as cur:
            row = await cur.fetchone()
        if row:
            active_session = dict(row)
        elif switch_state.get("state") == "on":
            # Auto-créer une session si le switch est ON mais aucune session en DB
            # (cas : switch activé depuis HA, ou session perdue)
            try:
                e_val = float(energy_state.get("state", 0))
                e_start = e_val if e_val > 0 else None
            except (ValueError, TypeError):
                e_start = None
            logger.info(f"Auto-création session (switch=on, pas de session active) energy_start={e_start}")
            await db.execute(
                "INSERT INTO sessions (user_id,start_time,energy_start,tarif_mode,status) VALUES (?,?,?,?,'active')",
                (session["user_id"], datetime.now().isoformat(), e_start, mode)
            )
            await db.commit()
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM sessions WHERE status='active' AND user_id=? ORDER BY id DESC LIMIT 1",
                (session["user_id"],)
            ) as cur:
                row2 = await cur.fetchone()
            if row2:
                active_session = dict(row2)
        if active_session:
            try:
                current_energy = float(energy_state.get("state", 0))
                e_start = active_session.get("energy_start")
                if e_start is not None:
                    session_kwh = max(0, current_energy - e_start)
            except (ValueError, TypeError):
                pass
            # Fallback: si capteur lent (session_kwh=0) ou energy_start=None → puissance × durée
            if (session_kwh is None or session_kwh == 0) and power > 0:
                try:
                    t_start_dt = datetime.fromisoformat(active_session["start_time"])
                    duration_h = (datetime.now() - t_start_dt).total_seconds() / 3600
                    if duration_h > 0:
                        session_kwh = round(power / 1000 * duration_h, 4)
                        logger.debug(f"[status] kWh live estimé via puissance: {power}W × {duration_h:.3f}h = {session_kwh} kWh")
                except Exception as _ex:
                    logger.debug(f"[status] Fallback kWh live échoué: {_ex}")

    mins_hc = minutes_until_hc(hs)

    return {
        "switch":  {"state": switch_state.get("state"), "entity_id": SWITCH_ENTITY},
        "power":   {"value": power, "unit": power_state.get("attributes", {}).get("unit_of_measurement", "W")},
        "energy":  {"value": energy_state.get("state"), "unit": "kWh"},
        "tarif":   {"mode": mode, "value": tarif_val, "hc_start": hs, "hc_end": he,
                    "minutes_until_hc": mins_hc},
        "session_active": active_session,
        "session_kwh":    session_kwh,
        "session_cost":   round(session_kwh * (hc if mode=="HC" else hp), 4) if session_kwh is not None else None,
        "user": {
            "display_name": session["user_display_name"],
            "user_id":      session["user_id"],
            "ha_role":      session.get("ha_role", "user"),
        },
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/switch/on")
async def switch_on(session=Depends(get_session)):
    ha_tok = await get_valid_ha_token(session)
    prefs  = await get_user_prefs(session["user_id"])
    await close_active_session(session["user_id"], ha_tok)
    await ha_post("services/switch/turn_on", {"entity_id": SWITCH_ENTITY}, ha_tok)
    energy_start = await get_energy_value(ha_tok)
    if energy_start is None:
        logger.warning(f"energy_start=None: sensor '{ENERGY_SENSOR}' indisponible ou inconnu. Les kWh de session ne seront pas calculés.")
    else:
        logger.info(f"Session démarrée, energy_start={energy_start} kWh ({ENERGY_SENSOR})")
    hp = prefs.get("tarif_hp") or TARIF_HP
    hc = prefs.get("tarif_hc") or TARIF_HC
    hs = prefs.get("hc_start") or HC_START
    he = prefs.get("hc_end")   or HC_END
    tarif_val, mode = get_tarif(hp, hc, hs, he)
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("""
            INSERT INTO sessions (user_id,start_time,energy_start,tarif_mode,status)
            VALUES (?,?,?,?,'active')""",
            (session["user_id"], datetime.now().isoformat(), energy_start, mode))
        sid = cur.lastrowid
        await db.commit()
    return {"success": True, "session_id": sid, "tarif_mode": mode, "tarif": tarif_val}

@app.post("/api/switch/off")
async def switch_off(session=Depends(get_session)):
    ha_tok = await get_valid_ha_token(session)
    # Lire la puissance AVANT coupure (après coupure le capteur retournera 0W)
    last_power_w = None
    try:
        pwr_state = await get_entity_state(POWER_SENSOR, ha_tok)
        last_power_w = float(pwr_state.get("state", 0))
        logger.info(f"Puissance snapshot avant coupure: {last_power_w}W")
    except Exception as e:
        logger.warning(f"Impossible de lire la puissance avant coupure: {e}")
    await ha_post("services/switch/turn_off", {"entity_id": SWITCH_ENTITY}, ha_tok)
    await close_active_session(session["user_id"], ha_tok, last_power_w=last_power_w)
    return {"success": True}

@app.get("/api/sessions")
async def get_sessions(limit: int = 50, session=Depends(get_session)):
    is_admin = session.get("ha_role", "user") in ("owner", "admin")
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if is_admin:
            async with db.execute(
                "SELECT * FROM sessions WHERE status='completed' ORDER BY id DESC LIMIT ?",
                (limit,)
            ) as cur:
                rows = await cur.fetchall()
        else:
            async with db.execute(
                "SELECT * FROM sessions WHERE user_id=? AND status='completed' ORDER BY id DESC LIMIT ?",
                (session["user_id"], limit)
            ) as cur:
                rows = await cur.fetchall()
    sessions = [dict(r) for r in rows]
    total_kwh  = sum(s["energy_kwh"] or 0 for s in sessions)
    total_cost = sum(s["cost"]       or 0 for s in sessions)
    return {
        "sessions": sessions,
        "stats": {
            "total_sessions": len(sessions),
            "total_kwh":  round(total_kwh,  3),
            "total_cost": round(total_cost, 2),
        },
    }

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        is_admin = session.get("ha_role", "user") in ("owner", "admin")
        if is_admin:
            await db.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        else:
            await db.execute("DELETE FROM sessions WHERE id=? AND user_id=?",
                (session_id, session["user_id"]))
        await db.commit()
    return {"success": True}

@app.patch("/api/sessions/{session_id}/notes")
async def update_notes(session_id: int, body: SessionNote, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        is_admin = session.get("ha_role", "user") in ("owner", "admin")
        if is_admin:
            await db.execute("UPDATE sessions SET notes=? WHERE id=?", (body.notes, session_id))
        else:
            await db.execute("UPDATE sessions SET notes=? WHERE id=? AND user_id=?",
                (body.notes, session_id, session["user_id"]))
        await db.commit()
    return {"success": True}

@app.get("/api/tarifs")
async def get_tarifs(session=Depends(get_session)):
    prefs = await get_user_prefs(session["user_id"])
    hp = prefs.get("tarif_hp") or TARIF_HP
    hc = prefs.get("tarif_hc") or TARIF_HC
    hs = prefs.get("hc_start") or HC_START
    he = prefs.get("hc_end")   or HC_END
    _, mode = get_tarif(hp, hc, hs, he)
    return {"tarif_hp": hp, "tarif_hc": hc, "hc_start": hs, "hc_end": he,
            "mode_actuel": mode, "minutes_until_hc": minutes_until_hc(hs)}

@app.post("/api/tarifs")
async def update_tarifs(config: TarifConfig, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR REPLACE INTO user_prefs
            (user_id, tarif_hp, tarif_hc, hc_start, hc_end, updated_at)
            VALUES (?,?,?,?,?,?)""",
            (session["user_id"], config.tarif_hp, config.tarif_hc,
             config.hc_start, config.hc_end, datetime.now().isoformat()))
        await db.commit()
    return {"success": True}

@app.post("/api/theme")
async def update_theme(body: ThemeUpdate, session=Depends(get_session)):
    if body.theme not in ("dark", "light", "system"):
        raise HTTPException(status_code=400, detail="Thème invalide")
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO user_prefs (user_id, theme) VALUES (?,?)
            ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme, updated_at=?""",
            (session["user_id"], body.theme, datetime.now().isoformat()))
        await db.commit()
    return {"success": True}

@app.post("/api/push/subscribe")
async def push_subscribe(sub: PushSubscription, session=Depends(get_session)):
    sub_str = json.dumps(sub.subscription)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO push_subscriptions (user_id, subscription) VALUES (?,?)",
            (session["user_id"], sub_str))
        await db.commit()
    return {"success": True}

# ─── Stats ────────────────────────────────────────────────────────────────────

@app.get("/api/stats/monthly")
async def get_monthly_stats(session=Depends(get_session)):
    """Stats mensuelles (12 derniers mois)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT strftime('%Y-%m', start_time) as month,
                   SUM(energy_kwh) as kwh,
                   SUM(cost) as cost,
                   COUNT(*) as count
            FROM sessions
            WHERE (status='completed' AND (? OR user_id=?))
            GROUP BY month ORDER BY month DESC LIMIT 12
        """, (session.get("ha_role","user") in ("owner","admin"), session["user_id"])) as cur:
            rows = await cur.fetchall()
    return {"monthly": [dict(r) for r in rows]}

@app.get("/api/stats/weekly")
async def get_weekly_stats(month: str = None, session=Depends(get_session)):
    """
    Stats hebdomadaires pour un mois donné.
    Paramètre month : 'YYYY-MM' (défaut = mois courant).
    Retourne les kWh et coûts regroupés par semaine du mois (S1 à S5).
    """
    if not month:
        month = datetime.now().strftime("%Y-%m")
    # Validation format
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError:
        raise HTTPException(status_code=400, detail="Format month invalide (YYYY-MM)")

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        # Semaine du mois = (jour - 1) // 7 + 1  → S1..S5
        async with db.execute("""
            SELECT
                CAST((CAST(strftime('%d', start_time) AS INTEGER) - 1) / 7 + 1 AS INTEGER) as week_num,
                SUM(energy_kwh) as kwh,
                SUM(cost) as cost,
                COUNT(*) as count,
                SUM(CASE WHEN tarif_mode='HC' THEN energy_kwh ELSE 0 END) as kwh_hc,
                SUM(CASE WHEN tarif_mode='HP' THEN energy_kwh ELSE 0 END) as kwh_hp
            FROM sessions
            WHERE (status='completed' AND (? OR user_id=?))
              AND strftime('%Y-%m', start_time) = ?
            GROUP BY week_num ORDER BY week_num
        """, (session.get("ha_role","user") in ("owner","admin"), session["user_id"], month)) as cur:
            rows = await cur.fetchall()

    # S'assurer d'avoir les 4 semaines même si vides
    weeks_map = {r["week_num"]: dict(r) for r in rows}
    result = []
    for w in range(1, 6):
        if w in weeks_map:
            result.append(weeks_map[w])
        else:
            result.append({"week_num": w, "kwh": 0, "cost": 0, "count": 0,
                           "kwh_hc": 0, "kwh_hp": 0})

    # Résumé mensuel
    total_kwh  = sum(r["kwh"]  or 0 for r in result)
    total_cost = sum(r["cost"] or 0 for r in result)
    total_sess = sum(r["count"]    for r in result)

    return {
        "month": month,
        "weekly": result,
        "summary": {
            "total_kwh":      round(total_kwh, 3),
            "total_cost":     round(total_cost, 2),
            "total_sessions": total_sess,
        }
    }

@app.get("/api/export/csv")
async def export_csv(session=Depends(get_session)):
    """Export CSV complet des sessions avec BOM UTF-8 (compatible Excel)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE (status='completed' AND (? OR user_id=?)) ORDER BY start_time DESC",
            (session.get("ha_role","user") in ("owner","admin"), session["user_id"])
        ) as cur:
            rows = await cur.fetchall()

    lines = ["\ufeffDate début,Date fin,kWh,Coût (€),Tarif,Durée (min),Notes"]
    for r in rows:
        dur = ""
        if r["start_time"] and r["end_time"]:
            try:
                diff = datetime.fromisoformat(r["end_time"]) - datetime.fromisoformat(r["start_time"])
                dur  = str(int(diff.total_seconds() / 60))
            except Exception:
                pass
        kwh  = f'{r["energy_kwh"]:.3f}' if r["energy_kwh"] is not None else ""
        cost = f'{r["cost"]:.4f}'        if r["cost"]       is not None else ""
        lines.append(
            f'{r["start_time"]},{r["end_time"] or ""},'
            f'{kwh},{cost},'
            f'{r["tarif_mode"] or ""},'
            f'{dur},'
            f'"{(r["notes"] or "").replace(chr(34), chr(39))}"'
        )
    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": "attachment; filename=sessions_ev.csv"}
    )

# ─── Watchdog ─────────────────────────────────────────────────────────────────
async def watchdog():
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
                await ha_post("services/persistent_notification/create", {
                    "title": "🔋 Charge terminée",
                    "message": f"Voiture chargée. Puissance: {power:.0f}W",
                    "notification_id": "ev_charge_done"
                })
                was_charging = False
            elif power >= NOTIFICATION_THRESHOLD * 1000:
                was_charging = True
        except Exception as e:
            logger.debug(f"Watchdog: {e}")

@app.on_event("startup")
async def start_watchdog():
    asyncio.create_task(watchdog())

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "3.2.14", "timestamp": datetime.now().isoformat()}

# ─── Static PWA ───────────────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="/app/pwa", html=True), name="pwa")
