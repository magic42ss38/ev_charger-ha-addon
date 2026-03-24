"""
EV Charger PWA - FastAPI Backend v2.0
OAuth2 HA + Sessions HP/HC + Profils utilisateurs
"""
import os, json, asyncio, logging, secrets, hashlib
from datetime import datetime, time, timedelta
from typing import Optional
from contextlib import asynccontextmanager

import httpx
import aiosqlite
from fastapi import FastAPI, HTTPException, Depends, Header, Request, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ─── Config ───────────────────────────────────────────────────────────────────
HA_URL        = os.getenv("HA_URL", "http://homeassistant:8123")
HA_TOKEN      = os.getenv("HA_TOKEN", "")          # token de service interne
SWITCH_ENTITY = os.getenv("SWITCH_ENTITY", "switch.prise_voiture")
POWER_SENSOR  = os.getenv("POWER_SENSOR",  "sensor.puissance_voiture2")
ENERGY_SENSOR = os.getenv("ENERGY_SENSOR", "sensor.energy_voiture")
TARIF_HP      = float(os.getenv("TARIF_HP", "0.2516"))
TARIF_HC      = float(os.getenv("TARIF_HC", "0.1654"))
HC_START      = os.getenv("HC_START", "22:00")
HC_END        = os.getenv("HC_END",   "06:00")
NOTIFICATION_THRESHOLD = float(os.getenv("NOTIFICATION_THRESHOLD", "0.1"))
DB_PATH       = "/data/sessions.db"

# OAuth2 HA
OAUTH_CLIENT_ID     = os.getenv("OAUTH_CLIENT_ID", "ev-charger-pwa")
OAUTH_REDIRECT_URI  = os.getenv("OAUTH_REDIRECT_URI", "https://pwa.domotique-nicof73.ovh/auth/callback")
SESSION_SECRET      = os.getenv("SESSION_SECRET", secrets.token_hex(32))
SESSION_DURATION_H  = 24

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
                ha_access_token TEXT,
                ha_refresh_token TEXT,
                ha_token_expires TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                last_seen TEXT
            )""")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_prefs (
                user_id TEXT PRIMARY KEY,
                tarif_hp REAL,
                tarif_hc REAL,
                hc_start TEXT,
                hc_end TEXT,
                theme TEXT DEFAULT 'dark',
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
    logger.info("DB v2 initialisée")

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

async def close_active_session(user_id: str = None, token: str = None):
    energy_end = await get_energy_value(token)
    async with aiosqlite.connect(DB_PATH) as db:
        q = "SELECT id,energy_start,tarif_mode FROM sessions WHERE status='active'"
        params = []
        if user_id:
            q += " AND user_id=?"
            params.append(user_id)
        q += " ORDER BY id DESC LIMIT 1"
        async with db.execute(q, params) as cur:
            row = await cur.fetchone()
        if row:
            sid, e_start, t_mode = row
            kwh = cost = None
            if e_start is not None and energy_end is not None:
                kwh = max(0, energy_end - e_start)
                tv = TARIF_HC if t_mode == "HC" else TARIF_HP
                cost = round(kwh * tv, 4)
            await db.execute("""UPDATE sessions SET end_time=?,energy_end=?,
                energy_kwh=?,cost=?,status='completed' WHERE id=?""",
                (datetime.now().isoformat(), energy_end, kwh, cost, sid))
            await db.commit()

# ─── OAuth2 HA ────────────────────────────────────────────────────────────────
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
    # Vérifier expiration
    created = datetime.fromisoformat(row["created_at"])
    if datetime.now() - created > timedelta(hours=SESSION_DURATION_H):
        raise HTTPException(status_code=401, detail="Session expirée")
    # Mettre à jour last_seen
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

# ─── Lifespan ─────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="EV Charger API v2", lifespan=lifespan)

# Middleware pour les headers proxy (NPM + Cloudflare)
from starlette.middleware.base import BaseHTTPMiddleware
class ProxyHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        # Reconstruire le scheme depuis X-Forwarded-Proto
        proto = request.headers.get("x-forwarded-proto")
        if proto:
            request.scope["scheme"] = proto
        return await call_next(request)
app.add_middleware(ProxyHeadersMiddleware)
# Origins autorisées — ajouter ici si domaine change
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
    theme: str

class SessionNote(BaseModel):
    notes: str

class PushSubscription(BaseModel):
    subscription: dict

# ═══════════════════════════════════════════════════════════════════════════════
# AUTH ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/auth/login")
async def auth_login(request: Request):
    """Initie le flow OAuth2 vers HA."""
    state = secrets.token_urlsafe(16)
    # Stocker le state dans un cookie temporaire
    params = (
        f"response_type=code"
        f"&client_id={OAUTH_CLIENT_ID}"
        f"&redirect_uri={OAUTH_REDIRECT_URI}"
        f"&state={state}"
    )
    url = f"{HA_URL}/auth/authorize?{params}"
    response = RedirectResponse(url)
    is_secure = request.headers.get("x-forwarded-proto", "http") == "https"
    response.set_cookie("oauth_state", state, max_age=300, httponly=True, samesite="lax", secure=is_secure)
    return response

@app.get("/auth/callback")
async def auth_callback(code: str, state: str, request: Request):
    """Callback OAuth2 — échange le code contre un token HA."""
    # Vérifier le state
    stored_state = request.cookies.get("oauth_state")
    if stored_state and stored_state != state:
        raise HTTPException(status_code=400, detail="State OAuth invalide")

    # Échanger le code contre un token
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{HA_URL}/auth/token", data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": OAUTH_CLIENT_ID,
                "redirect_uri": OAUTH_REDIRECT_URI,
            }, headers={"Content-Type": "application/x-www-form-urlencoded"})
            r.raise_for_status()
            token_data = r.json()
    except Exception as e:
        logger.error(f"OAuth token exchange error: {e}")
        raise HTTPException(status_code=400, detail=f"Erreur OAuth: {e}")

    ha_access_token  = token_data.get("access_token")
    ha_refresh_token = token_data.get("refresh_token")
    expires_in       = token_data.get("expires_in", 1800)
    ha_token_expires = (datetime.now() + timedelta(seconds=expires_in)).isoformat()

    # Récupérer le profil utilisateur HA
    try:
        profile = await ha_get("config/auth/current_user", ha_access_token)
        user_id   = profile.get("id", "unknown")
        user_name = profile.get("username", "user")
        user_display = profile.get("name") or user_name
    except Exception:
        user_id = hashlib.md5(ha_access_token.encode()).hexdigest()[:8]
        user_name = "user"
        user_display = "Utilisateur"

    # Créer la session
    session_token = secrets.token_urlsafe(32)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR REPLACE INTO user_sessions
            (token, user_id, user_name, user_display_name,
             ha_access_token, ha_refresh_token, ha_token_expires, created_at, last_seen)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (session_token, user_id, user_name, user_display,
             ha_access_token, ha_refresh_token, ha_token_expires,
             datetime.now().isoformat(), datetime.now().isoformat()))
        await db.commit()

    logger.info(f"Utilisateur connecté: {user_display} ({user_id})")

    response = RedirectResponse(url="/")
    # secure=True seulement si la requête arrive en HTTPS (via Cloudflare/NPM)
    is_secure = request.headers.get("x-forwarded-proto", "http") == "https"
    response.set_cookie("ev_session", session_token,
        max_age=SESSION_DURATION_H * 3600,
        httponly=True, samesite="lax", secure=is_secure)
    response.delete_cookie("oauth_state")
    return response

@app.post("/auth/logout")
async def auth_logout(session=Depends(get_session)):
    """Déconnexion — supprime la session."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM user_sessions WHERE token=?", (session["token"],))
        await db.commit()
    response = JSONResponse({"success": True})
    response.delete_cookie("ev_session")
    return response

@app.get("/auth/check")
async def auth_check(request: Request):
    """Vérifie si l'utilisateur est connecté sans bloquer."""
    token = request.cookies.get("ev_session")
    if not token:
        return {"authenticated": False}
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_id,user_name,user_display_name,created_at FROM user_sessions WHERE token=?",
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
        "user_id": row["user_id"],
        "user_name": row["user_name"],
        "display_name": row["user_display_name"],
    }

# ═══════════════════════════════════════════════════════════════════════════════
# API ROUTES (authentifiées)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/me")
async def get_me(session=Depends(get_session)):
    """Profil utilisateur complet."""
    prefs = await get_user_prefs(session["user_id"])
    return {
        "user_id":      session["user_id"],
        "user_name":    session["user_name"],
        "display_name": session["user_display_name"],
        "theme":        prefs.get("theme", "dark"),
        "tarif_hp":     prefs.get("tarif_hp") or TARIF_HP,
        "tarif_hc":     prefs.get("tarif_hc") or TARIF_HC,
        "hc_start":     prefs.get("hc_start") or HC_START,
        "hc_end":       prefs.get("hc_end")   or HC_END,
    }

@app.get("/api/status")
async def get_status(session=Depends(get_session)):
    prefs = await get_user_prefs(session["user_id"])
    ha_tok = session.get("ha_access_token") or HA_TOKEN

    switch_state = await get_entity_state(SWITCH_ENTITY, ha_tok)
    power_state  = await get_entity_state(POWER_SENSOR,  ha_tok)
    energy_state = await get_entity_state(ENERGY_SENSOR, ha_tok)

    hp = prefs.get("tarif_hp") or TARIF_HP
    hc = prefs.get("tarif_hc") or TARIF_HC
    hs = prefs.get("hc_start") or HC_START
    he = prefs.get("hc_end")   or HC_END

    tarif_val, mode = get_tarif(hp, hc, hs, he)
    is_on = switch_state.get("state") == "on"

    try:
        power = float(power_state.get("state", 0))
    except (ValueError, TypeError):
        power = 0.0

    # Session active pour cet utilisateur
    active_session = None
    session_kwh = None
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE status='active' AND user_id=? ORDER BY id DESC LIMIT 1",
            (session["user_id"],)
        ) as cur:
            row = await cur.fetchone()
        if row:
            active_session = dict(row)
            try:
                current_energy = float(energy_state.get("state", 0))
                if active_session.get("energy_start") is not None:
                    session_kwh = max(0, current_energy - active_session["energy_start"])
            except (ValueError, TypeError):
                pass

    mins_hc = minutes_until_hc(hs)

    return {
        "switch":  {"state": switch_state.get("state"), "entity_id": SWITCH_ENTITY},
        "power":   {"value": power, "unit": power_state.get("attributes", {}).get("unit_of_measurement", "W")},
        "energy":  {"value": energy_state.get("state"), "unit": "kWh"},
        "tarif":   {"mode": mode, "value": tarif_val, "hc_start": hs, "hc_end": he,
                    "minutes_until_hc": mins_hc},
        "session_active": active_session,
        "session_kwh":    session_kwh,
        "user":    {"display_name": session["user_display_name"], "user_id": session["user_id"]},
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/switch/on")
async def switch_on(session=Depends(get_session)):
    ha_tok = session.get("ha_access_token") or HA_TOKEN
    prefs  = await get_user_prefs(session["user_id"])
    await close_active_session(session["user_id"], ha_tok)
    await ha_post("services/switch/turn_on", {"entity_id": SWITCH_ENTITY}, ha_tok)
    energy_start = await get_energy_value(ha_tok)
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
    ha_tok = session.get("ha_access_token") or HA_TOKEN
    await ha_post("services/switch/turn_off", {"entity_id": SWITCH_ENTITY}, ha_tok)
    await close_active_session(session["user_id"], ha_tok)
    return {"success": True}

@app.get("/api/sessions")
async def get_sessions(limit: int = 50, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE user_id=? AND status='completed' ORDER BY id DESC LIMIT ?",
            (session["user_id"], limit)
        ) as cur:
            rows = await cur.fetchall()
    sessions = [dict(r) for r in rows]
    total_kwh  = sum(s["energy_kwh"] or 0 for s in sessions)
    total_cost = sum(s["cost"]       or 0 for s in sessions)

    # Stats hebdo (7 derniers jours)
    weekly = {}
    for s in sessions:
        if not s["start_time"]: continue
        day = s["start_time"][:10]
        if day not in weekly:
            weekly[day] = {"kwh": 0, "cost": 0, "count": 0}
        weekly[day]["kwh"]   += s["energy_kwh"] or 0
        weekly[day]["cost"]  += s["cost"]       or 0
        weekly[day]["count"] += 1

    return {
        "sessions": sessions,
        "stats": {
            "total_sessions": len(sessions),
            "total_kwh":  round(total_kwh,  3),
            "total_cost": round(total_cost, 2),
        },
        "weekly": weekly
    }

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "DELETE FROM sessions WHERE id=? AND user_id=?",
            (session_id, session["user_id"]))
        await db.commit()
    return {"success": True}

@app.patch("/api/sessions/{session_id}/notes")
async def update_notes(session_id: int, body: SessionNote, session=Depends(get_session)):
    async with aiosqlite.connect(DB_PATH) as db:
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

@app.get("/api/stats/monthly")
async def get_monthly_stats(session=Depends(get_session)):
    """Stats mensuelles pour le graphique."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT strftime('%Y-%m', start_time) as month,
                   SUM(energy_kwh) as kwh,
                   SUM(cost) as cost,
                   COUNT(*) as count
            FROM sessions
            WHERE user_id=? AND status='completed'
            GROUP BY month ORDER BY month DESC LIMIT 12
        """, (session["user_id"],)) as cur:
            rows = await cur.fetchall()
    return {"monthly": [dict(r) for r in rows]}

@app.get("/api/export/csv")
async def export_csv(session=Depends(get_session)):
    """Export CSV des sessions."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM sessions WHERE user_id=? AND status='completed' ORDER BY id DESC",
            (session["user_id"],)
        ) as cur:
            rows = await cur.fetchall()
    lines = ["Date début,Date fin,kWh,Coût (€),Tarif,Durée (min),Notes"]
    for r in rows:
        dur = ""
        if r["start_time"] and r["end_time"]:
            try:
                diff = datetime.fromisoformat(r["end_time"]) - datetime.fromisoformat(r["start_time"])
                dur = str(int(diff.total_seconds() / 60))
            except Exception:
                pass
        lines.append(
            f'{r["start_time"]},{r["end_time"] or ""},'
            f'{r["energy_kwh"] or ""},'
            f'{r["cost"] or ""},'
            f'{r["tarif_mode"] or ""},'
            f'{dur},'
            f'"{r["notes"] or ""}"'
        )
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(
        "\n".join(lines),
        media_type="text/csv",
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

# ─── Static PWA ───────────────────────────────────────────────────────────────
app.mount("/", StaticFiles(directory="/app/pwa", html=True), name="pwa")

@app.get("/health")
async def health():
    return {"status": "healthy", "version": "2.0", "timestamp": datetime.now().isoformat()}
