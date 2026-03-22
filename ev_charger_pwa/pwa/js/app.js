/* EV Charger PWA - Application principale */
'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
const API_BASE = '';  // même origine
let HA_TOKEN = localStorage.getItem('ev_ha_token') || '';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  status: null,
  sessions: [],
  stats: {},
  power_history: [],        // { t: timestamp, v: watts }
  poll_interval: null,
  chart_instance: null,
  current_page: 'home',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt = (n, d=2) => n != null ? Number(n).toFixed(d) : '—';
const fmtEur = n => n != null ? Number(n).toFixed(2) + ' €' : '—';

function fmtDuration(start, end) {
  if (!start) return '—';
  const s = new Date(end || Date.now());
  const e = new Date(start);
  const diff = Math.abs(s - e);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h${m.toString().padStart(2,'0')}` : `${m}min`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' });
}

function showToast(msg, type='success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${HA_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erreur réseau' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth check ───────────────────────────────────────────────────────────────
async function checkAuth() {
  if (!HA_TOKEN) {
    showPage('settings');
    showToast('Configurez votre token HA pour commencer', 'error');
    return false;
  }
  try {
    await api('/api/status');
    return true;
  } catch {
    showPage('settings');
    showToast('Token invalide ou serveur inaccessible', 'error');
    return false;
  }
}

// ─── Polling ──────────────────────────────────────────────────────────────────
async function fetchStatus() {
  if (!HA_TOKEN) return;
  try {
    const data = await api('/api/status');
    state.status = data;
    $('conn-banner').classList.remove('show');
    renderHome(data);
    // Historique puissance
    const power = data.power?.value ?? 0;
    state.power_history.push({ t: Date.now(), v: power });
    if (state.power_history.length > 60) state.power_history.shift();
    renderChart();
  } catch (e) {
    $('conn-banner').classList.add('show');
    console.warn('Poll error:', e);
  }
}

function startPolling() {
  fetchStatus();
  if (state.poll_interval) clearInterval(state.poll_interval);
  state.poll_interval = setInterval(fetchStatus, 5000);
}

// ─── Home render ──────────────────────────────────────────────────────────────
function renderHome(data) {
  // Tarif badge
  const mode = data.tarif?.mode || 'HP';
  const tarif = data.tarif?.value ?? 0;
  const badge = $('tarif-badge');
  badge.textContent = `${mode} · ${fmt(tarif, 4)} €/kWh`;
  badge.className = `tarif-badge ${mode.toLowerCase()}`;

  // Puissance
  const power = data.power?.value ?? 0;
  $('power-val').textContent = power >= 1000
    ? fmt(power / 1000, 2)
    : fmt(power, 0);
  $('power-unit').textContent = power >= 1000 ? 'kW' : 'W';

  // Switch
  const isOn = data.switch?.state === 'on';
  const btn = $('switch-btn');
  btn.className = `switch-btn ${isOn ? 'on' : 'off'}`;
  $('switch-label').textContent = isOn ? 'EN CHARGE' : 'ARRÊTÉ';

  // Power card charging state
  $('power-card').className = `power-card ${isOn ? 'charging' : ''}`;

  // Session active
  const session = data.session_active;
  const liveDiv = $('session-live');
  if (session && isOn) {
    liveDiv.style.display = 'block';
    $('live-kwh').textContent = fmt(data.session_kwh, 3);
    const tarif_mode = session.tarif_mode;
    const tarif_val = tarif_mode === 'HC'
      ? (data.tarif?.value ?? TARIF_HC)
      : (data.tarif?.value ?? TARIF_HP);
    const cost = (data.session_kwh ?? 0) * tarif_val;
    $('live-cost').textContent = fmtEur(cost);
    $('live-duration').textContent = fmtDuration(session.start_time, null);
    $('live-mode').textContent = tarif_mode;
    $('live-mode').className = `session-mode ${tarif_mode}`;
  } else {
    liveDiv.style.display = 'none';
  }

  // Heure courante
  $('header-time').textContent = new Date().toLocaleTimeString('fr-FR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
}

// ─── Chart puissance ──────────────────────────────────────────────────────────
function renderChart() {
  const canvas = $('powerChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const labels = state.power_history.map(p =>
    new Date(p.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
  const values = state.power_history.map(p => p.v);

  if (state.chart_instance) {
    state.chart_instance.data.labels = labels;
    state.chart_instance.data.datasets[0].data = values;
    state.chart_instance.update('none');
    return;
  }

  if (typeof Chart === 'undefined') return;

  state.chart_instance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Puissance (W)',
        data: values,
        borderColor: '#00d4ff',
        backgroundColor: 'rgba(0,212,255,0.08)',
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 4,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: {
        backgroundColor: '#1a2340',
        titleColor: '#8899bb',
        bodyColor: '#e8eef8',
        borderColor: '#1e2d4a',
        borderWidth: 1,
      }},
      scales: {
        x: {
          display: false,
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          grid: { color: 'rgba(30,45,74,0.8)' },
          ticks: { color: '#4a5878', font: { family: 'JetBrains Mono', size: 10 } }
        }
      }
    }
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    state.sessions = data.sessions;
    state.stats = data.stats;
    renderSessions();
  } catch (e) {
    showToast('Erreur chargement sessions: ' + e.message, 'error');
  }
}

function renderSessions() {
  // Stats bar
  $('stat-total').textContent = state.stats.total_sessions ?? 0;
  $('stat-kwh').textContent = fmt(state.stats.total_kwh, 1);
  $('stat-cost').textContent = fmt(state.stats.total_cost, 2) + '€';

  const list = $('session-list');
  const completed = state.sessions.filter(s => s.status === 'completed');

  if (completed.length === 0) {
    list.innerHTML = `<div class="empty">
      <div class="empty-icon">⚡</div>
      <div class="empty-text">Aucune session enregistrée</div>
    </div>`;
    return;
  }

  list.innerHTML = completed.map(s => `
    <div class="session-item" data-id="${s.id}">
      <div class="session-item-header">
        <div class="session-date">${fmtDate(s.start_time)}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="session-mode ${s.tarif_mode}">${s.tarif_mode}</span>
          <button class="session-delete" onclick="deleteSession(${s.id},event)">×</button>
        </div>
      </div>
      <div class="session-item-body">
        <span class="session-kwh">⚡ ${fmt(s.energy_kwh, 3)} kWh</span>
        <span class="session-cost">💶 ${fmtEur(s.cost)}</span>
        <span class="session-duration">⏱ ${fmtDuration(s.start_time, s.end_time)}</span>
      </div>
    </div>
  `).join('');
}

async function deleteSession(id, event) {
  event.stopPropagation();
  if (!confirm('Supprimer cette session ?')) return;
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    showToast('Session supprimée');
    loadSessions();
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
  }
}
window.deleteSession = deleteSession;

// ─── Switch control ───────────────────────────────────────────────────────────
async function toggleSwitch() {
  if (!state.status) return;
  const isOn = state.status.switch?.state === 'on';
  const btn = $('switch-btn');

  if (!isOn) {
    const mode = state.status.tarif?.mode || 'HP';
    const tarif = state.status.tarif?.value ?? 0;
    if (!confirm(`Démarrer une session de recharge ?\nTarif actuel: ${mode} · ${fmt(tarif,4)} €/kWh`)) return;
  } else {
    if (!confirm('Arrêter la charge et clôturer la session ?')) return;
  }

  btn.className = 'switch-btn loading';
  try {
    const endpoint = isOn ? '/api/switch/off' : '/api/switch/on';
    const res = await api(endpoint, { method: 'POST' });
    showToast(isOn ? '⛔ Charge arrêtée' : `✅ Charge démarrée (${res.tarif_mode})`);
    await fetchStatus();
  } catch (e) {
    showToast('Erreur: ' + e.message, 'error');
    btn.className = `switch-btn ${isOn ? 'on' : 'off'}`;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  $('input-token').value = HA_TOKEN;
  if (!HA_TOKEN) return;
  try {
    const tarifs = await api('/api/tarifs');
    $('input-hp').value = tarifs.tarif_hp;
    $('input-hc').value = tarifs.tarif_hc;
    $('input-hc-start').value = tarifs.hc_start;
    $('input-hc-end').value = tarifs.hc_end;
  } catch { /* ignore si pas encore auth */ }
}

async function saveSettings() {
  const token = $('input-token').value.trim();
  const hp = parseFloat($('input-hp').value);
  const hc = parseFloat($('input-hc').value);
  const hc_start = $('input-hc-start').value.trim();
  const hc_end = $('input-hc-end').value.trim();

  if (!token) { showToast('Token requis', 'error'); return; }
  if (isNaN(hp) || isNaN(hc)) { showToast('Tarifs invalides', 'error'); return; }

  HA_TOKEN = token;
  localStorage.setItem('ev_ha_token', token);

  // Envoyer le token au SW
  if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SET_TOKEN', token });
  }

  try {
    await api('/api/tarifs', {
      method: 'POST',
      body: JSON.stringify({ tarif_hp: hp, tarif_hc: hc, hc_start, hc_end })
    });
    showToast('✅ Configuration sauvegardée');
    startPolling();
    setTimeout(() => showPage('home'), 800);
  } catch (e) {
    showToast('Erreur sauvegarde: ' + e.message, 'error');
  }
}

// ─── Push notifications ───────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = ''; // Optionnel — laisser vide pour utiliser les notifs HA

async function requestNotifications() {
  if (!('Notification' in window)) {
    showToast('Notifications non supportées', 'error');
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('✅ Notifications activées');
    $('btn-notif').textContent = 'Notifications activées ✓';
  } else {
    showToast('Notifications refusées', 'error');
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bottom-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  const page = $(`page-${name}`);
  if (page) page.classList.add('active');

  const btn = document.querySelector(`[data-page="${name}"]`);
  if (btn) btn.classList.add('active');

  state.current_page = name;

  if (name === 'history') loadSessions();
  if (name === 'settings') loadSettings();
}

// ─── Heure en direct ──────────────────────────────────────────────────────────
setInterval(() => {
  if ($('header-time') && !state.status) {
    $('header-time').textContent = new Date().toLocaleTimeString('fr-FR');
  }
}, 1000);

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Register SW
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/pwa/sw.js', { scope: '/pwa/' });
      console.log('SW registered:', reg.scope);
    } catch (e) {
      console.warn('SW registration failed:', e);
    }
  }

  // Navigation
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  // Switch button
  $('switch-btn').addEventListener('click', toggleSwitch);

  // Settings form
  $('btn-save').addEventListener('click', saveSettings);
  $('btn-notif').addEventListener('click', requestNotifications);

  // Auth & start
  if (HA_TOKEN) {
    showPage('home');
    startPolling();
  } else {
    showPage('settings');
  }

  // URL action param
  const params = new URLSearchParams(location.search);
  if (params.get('action') === 'start' && HA_TOKEN) {
    setTimeout(toggleSwitch, 1000);
  }
}

document.addEventListener('DOMContentLoaded', init);
