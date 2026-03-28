/* EV Charger PWA v3 — PropalC : OAuth2 HA + Sessions + Stats hebdo + Rôle HA */

// ═══════════════════════════════════════════════════════════════════════════════
// PWA INSTALL — gestion du prompt d'installation natif + iOS
// ═══════════════════════════════════════════════════════════════════════════════
let _deferredInstallPrompt = null;

// Capture du prompt Android/Chrome
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'flex';
});

// L'app est installée → cacher le bouton
window.addEventListener('appinstalled', () => {
  _deferredInstallPrompt = null;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'none';
});

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) && !window.MSStream;
}

function isInStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function installPWA() {
  if (_deferredInstallPrompt) {
    // Android / Chrome Desktop
    _deferredInstallPrompt.prompt();
    _deferredInstallPrompt.userChoice.then((result) => {
      if (result.outcome === 'accepted') {
        _deferredInstallPrompt = null;
        const btn = document.getElementById('install-btn');
        if (btn) btn.style.display = 'none';
      }
    });
  } else if (isIOS()) {
    // iOS → afficher les instructions
    const modal = document.getElementById('ios-install-modal');
    if (modal) modal.style.display = 'flex';
  }
}

function closeIOSModal() {
  const modal = document.getElementById('ios-install-modal');
  if (modal) modal.style.display = 'none';
}

// Sur iOS, si pas encore installée, afficher le bouton install
document.addEventListener('DOMContentLoaded', () => {
  if (isIOS() && !isInStandaloneMode()) {
    const btn = document.getElementById('install-btn');
    if (btn) btn.style.display = 'flex';
  }
});

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  status: null,
  sessions: [],
  stats: {},
  power_history: [],
  poll_interval: null,
  chart_power: null,
  chart_weekly: null,
  chart_monthly: null,
  themeChoice: localStorage.getItem('ev_theme') || 'system', // 'dark'|'light'|'system'
  currentMonth: null, // 'YYYY-MM' pour la page stats
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt    = (n, d = 2)  => n != null ? Number(n).toFixed(d) : '—';
const fmtEur = n => n != null ? Number(n).toFixed(2) + ' €' : '—';

function fmtDuration(start, end) {
  if (!start) return '—';
  const diff = Math.abs(new Date(end || Date.now()) - new Date(start));
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
    + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fmtMonth(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-');
  const d = new Date(+y, +m - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}
function monthOffset(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nowMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}
function nameToColor(name) {
  const colors = ['#00d4ff', '#00ff88', '#ffaa00', '#bd93f9', '#ff79c6', '#50fa7b', '#8be9fd'];
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

const ROLE_LABELS = {
  owner: { label: 'Propriétaire', icon: '👑', cls: 'role-owner' },
  admin: { label: 'Administrateur', icon: '🛡', cls: 'role-admin' },
  user:  { label: 'Utilisateur',    icon: '👤', cls: 'role-user'  },
};

function showToast(msg, type = 'success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  if (res.status === 401) { showLoginScreen(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erreur réseau' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth / Login ─────────────────────────────────────────────────────────────
function showLoginScreen() {
  $('login-screen').style.display = 'flex';
  $('app').style.display = 'none';
  $('bottom-nav').style.display = 'none';
  if (state.poll_interval) { clearInterval(state.poll_interval); state.poll_interval = null; }
}

function showApp() {
  $('login-screen').style.display = 'none';
  $('app').style.display = 'block';
  $('bottom-nav').style.display = 'flex';
}

async function doLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-submit-btn');
  const errDiv = document.getElementById('login-error');
  const name = (document.getElementById('login-name')?.value || '').trim();
  const pwd  = document.getElementById('login-password').value;
  if (btn) { btn.disabled = true; btn.style.opacity = '0.7'; }
  if (errDiv) errDiv.style.display = 'none';
  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pwd, display_name: name })
    });
    if (res.ok) {
      const data = await res.json();
      // Mettre à jour l'état utilisateur directement (pas besoin de re-vérifier l'auth)
      state.user = { display_name: data.display_name || name, ha_role: 'admin' };
      showApp();
      // Charger les préférences supplémentaires depuis /api/me
      try {
        const me = await api('/api/me');
        if (me?.theme) applyTheme(me.theme);
        if (me?.ha_role) state.user.ha_role = me.ha_role;
        Object.assign(state.user, me);
      } catch { /* ignore */ }
      renderUserBadge(state.user);
      state.currentMonth = nowMonth();
      showPage('home');
      startPolling();
    } else {
      if (errDiv) errDiv.style.display = 'block';
      const pwdInput = document.getElementById('login-password');
      if (pwdInput) { pwdInput.value = ''; pwdInput.focus(); }
    }
  } catch (err) {
    if (errDiv) { errDiv.style.display = 'block'; errDiv.textContent = 'Erreur de connexion'; }
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  }
}

async function logout() {
  toggleUserMenu();
  await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
  state.user = null;
  showLoginScreen();
  showToast('Déconnecté');
}

async function checkAuth() {
  try {
    const res  = await fetch('/auth/check', { credentials: 'include' });
    const data = await res.json();
    if (data.authenticated) {
      state.user = data;
      return true;
    }
  } catch (e) { /* offline */ }
  return false;
}

// ─── User badge ───────────────────────────────────────────────────────────────
function renderUserBadge(user) {
  if (!user) return;
  const name     = user.display_name || user.user_name || 'User';
  const initials = getInitials(name);
  const color    = nameToColor(name);
  const role     = user.ha_role || 'user';
  const roleInfo = ROLE_LABELS[role] || ROLE_LABELS.user;

  // Badge header (avatar + prénom + rôle)
  const av = $('user-avatar');
  av.textContent = initials;
  av.style.background = color + '22';
  av.style.color = color;
  av.style.border = `1.5px solid ${color}55`;
  $('user-name').textContent = name.split(' ')[0];
  const roleLabel = $('user-role-label');
  if (roleLabel) {
    roleLabel.textContent = roleInfo.icon + ' ' + role;
    roleLabel.className = `user-role-label ${roleInfo.cls}`;
  }

  // Dropdown menu
  const menuAv = $('user-menu-avatar');
  if (menuAv) {
    menuAv.textContent = initials;
    menuAv.style.background = color + '22';
    menuAv.style.color = color;
    menuAv.style.border = `1.5px solid ${color}55`;
  }
  const menuName = $('user-menu-name');
  if (menuName) menuName.textContent = name;
  const menuRole = $('user-menu-role');
  if (menuRole) {
    menuRole.textContent = roleInfo.icon + ' ' + roleInfo.label;
    menuRole.className = `user-menu-role ${roleInfo.cls}`;
  }

  // Page profil (Settings)
  const avBig = $('profile-avatar-big');
  if (avBig) {
    avBig.textContent = initials;
    avBig.style.background = color + '22';
    avBig.style.color = color;
    avBig.style.border = `2px solid ${color}66`;
  }
  const pName = $('profile-name');
  if (pName) pName.textContent = name;
  const pSub = $('profile-username');
  if (pSub) pSub.textContent = user.user_name ? '@' + user.user_name : '';
  const roleBadge = $('profile-role-badge');
  if (roleBadge) {
    roleBadge.textContent = roleInfo.icon + ' ' + roleInfo.label;
    roleBadge.className = `role-badge ${roleInfo.cls}`;
  }
}

function toggleUserMenu() {
  $('user-menu').classList.toggle('open');
}

// ─── Theme ────────────────────────────────────────────────────────────────────
/**
 * themeChoice : 'dark' | 'light' | 'system'
 * Applique le thème visuel réel en tenant compte du système si 'system'.
 */
function resolveTheme(choice) {
  if (choice === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return choice;
}

function applyTheme(choice) {
  state.themeChoice = choice;
  localStorage.setItem('ev_theme', choice);
  const resolved = resolveTheme(choice);
  document.documentElement.setAttribute('data-theme', resolved);
  updateThemeIcon(choice);
  updateThemeSelector(choice);
}

function updateThemeIcon(choice) {
  const sun  = $('theme-icon-sun');
  const moon = $('theme-icon-moon');
  const auto = $('theme-icon-auto');
  if (!sun || !moon || !auto) return; // DOM pas encore prêt (appelé trop tôt)
  sun.style.display  = choice === 'light'  ? 'block' : 'none';
  moon.style.display = choice === 'dark'   ? 'block' : 'none';
  auto.style.display = choice === 'system' ? 'block' : 'none';
}

function updateThemeSelector(choice) {
  document.querySelectorAll('.theme-opt').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.themeVal === choice);
  });
}

function toggleTheme() {
  // Cycle : system → dark → light → system
  const cycle = { system: 'dark', dark: 'light', light: 'system' };
  const next  = cycle[state.themeChoice] || 'dark';
  setThemeChoice(next);
}

function setThemeChoice(choice) {
  applyTheme(choice);
  if (state.user) {
    fetch('/api/theme', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: choice })
    }).catch(() => {});
  }
}
window.setThemeChoice = setThemeChoice;

// Écouter les changements système
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.themeChoice === 'system') applyTheme('system');
});

// ─── Polling ──────────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const data = await api('/api/status');
    if (!data) return;
    state.status = data;
    $('conn-banner').classList.remove('show');
    renderHome(data);
    const power = data.power?.value ?? 0;
    state.power_history.push({ t: Date.now(), v: power });
    if (state.power_history.length > 60) state.power_history.shift();
    renderPowerChart();
  } catch (e) {
    $('conn-banner').classList.add('show');
  }
}

function startPolling() {
  fetchStatus();
  if (state.poll_interval) clearInterval(state.poll_interval);
  state.poll_interval = setInterval(fetchStatus, 5000);
}

// ─── Home render ──────────────────────────────────────────────────────────────
function renderHome(data) {
  const mode  = data.tarif?.mode || 'HP';
  const tarif = data.tarif?.value ?? 0;
  const badge = $('tarif-badge');
  badge.textContent = `${mode} · ${fmt(tarif, 4)}€`;
  badge.className   = `tarif-badge ${mode.toLowerCase()}`;

  // Widget HC countdown
  const mins = data.tarif?.minutes_until_hc;
  const cdEl = $('hc-countdown');
  if (mode === 'HP' && mins != null && mins < 120) {
    cdEl.style.display = 'flex';
    const h = Math.floor(mins / 60), m = mins % 60;
    const label = h > 0
      ? `${h}h${String(m).padStart(2, '0')}`
      : `${m} min`;
    $('hc-countdown-text').textContent = `⏳ HC dans ${label} — pensez à brancher !`;
  } else if (mode === 'HC') {
    cdEl.style.display = 'flex';
    cdEl.classList.add('active-hc');
    $('hc-countdown-text').textContent = '✅ Heures creuses actives — tarif réduit';
  } else {
    cdEl.style.display = 'none';
    cdEl.classList.remove('active-hc');
  }

  const power = data.power?.value ?? 0;
  $('power-val').textContent = power >= 1000 ? fmt(power / 1000, 2) : fmt(power, 0);
  $('power-unit').textContent = power >= 1000 ? 'kW' : 'W';

  const isOn = data.switch?.state === 'on';
  const btn  = $('switch-btn');
  btn.className = `switch-btn ${isOn ? 'on' : 'off'}`;
  $('switch-label').textContent = isOn ? 'EN CHARGE' : 'ARRÊTÉ';
  $('power-card').className = `power-card ${isOn ? 'charging' : ''}`;

  // Fallback : afficher switch entity depuis status si loadSettings a échoué
  const swEl = $('display-switch-entity');
  if (swEl && data.switch?.entity_id && swEl.textContent === '—') {
    swEl.textContent = data.switch.entity_id;
  }

  // Session live
  const session = data.session_active;
  const liveDiv = $('session-live');
  if (session && isOn) {
    liveDiv.style.display = 'block';
    const kwh  = data.session_kwh ?? 0;
    const cost = data.session_cost ?? (kwh * tarif);
    $('live-kwh').textContent      = fmt(kwh, 3);
    $('live-cost').textContent     = fmtEur(cost);
    $('live-duration').textContent = fmtDuration(session.start_time, null);
    $('live-tarif').textContent    = `${mode} · ${fmt(tarif, 4)}€`;
    $('live-mode').textContent     = mode;
    $('live-mode').className       = `session-mode ${mode}`;
    $('live-kwh-mini').textContent  = fmt(kwh, 3);
    $('live-cost-mini').textContent = fmtEur(cost);
    $('live-duration-mini').textContent = fmtDuration(session.start_time, null);
  } else {
    liveDiv.style.display = 'none';
    $('live-kwh-mini').textContent = '—';
    $('live-cost-mini').textContent = '—';
    $('live-duration-mini').textContent = '—';
  }
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function chartColors() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  return {
    cyan:    '#00d4ff',
    green:   '#00ff88',
    amber:   '#ffaa00',
    grid:    light ? 'rgba(0,0,0,0.08)' : 'rgba(30,45,74,0.6)',
    tick:    light ? '#3a5080' : '#4a5878',
    tooltip: {
      bg:    light ? '#ffffff' : '#1a2340',
      title: light ? '#3a5080' : '#8899bb',
      body:  light ? '#0d1a35' : '#e8eef8',
      border:light ? '#c8d4ec' : '#1e2d4a',
    }
  };
}

function renderPowerChart() {
  const canvas = $('powerChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const cc     = chartColors();
  const labels = state.power_history.map(p =>
    new Date(p.t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const values = state.power_history.map(p => p.v);

  if (state.chart_power) {
    state.chart_power.data.labels = labels;
    state.chart_power.data.datasets[0].data = values;
    state.chart_power.update('none');
    return;
  }
  state.chart_power = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: values, borderColor: cc.cyan,
        backgroundColor: 'rgba(0,212,255,0.07)', borderWidth: 2,
        fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 0,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltip.bg, titleColor: cc.tooltip.title,
          bodyColor: cc.tooltip.body, borderColor: cc.tooltip.border, borderWidth: 1
        }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: {
          beginAtZero: true, grid: { color: cc.grid },
          ticks: { color: cc.tick, font: { family: 'JetBrains Mono, monospace', size: 10 } }
        }
      }
    }
  });
}

function renderWeeklyChart(weekly) {
  const canvas = $('weeklyChart');
  if (!canvas || typeof Chart === 'undefined' || !weekly?.length) return;
  const cc = chartColors();
  const labels   = weekly.map(w => `S${w.week_num}`);
  const kwhHC    = weekly.map(w => parseFloat(w.kwh_hc || 0).toFixed(3));
  const kwhHP    = weekly.map(w => parseFloat(w.kwh_hp || 0).toFixed(3));

  if (state.chart_weekly) {
    state.chart_weekly.data.labels = labels;
    state.chart_weekly.data.datasets[0].data = kwhHC;
    state.chart_weekly.data.datasets[1].data = kwhHP;
    state.chart_weekly.update();
    return;
  }
  state.chart_weekly = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'HC',
          data: kwhHC,
          backgroundColor: 'rgba(0,255,136,0.55)',
          borderColor: cc.green,
          borderWidth: 1,
          borderRadius: 5,
          stack: 'kwh',
        },
        {
          label: 'HP',
          data: kwhHP,
          backgroundColor: 'rgba(255,170,0,0.55)',
          borderColor: cc.amber,
          borderWidth: 1,
          borderRadius: 5,
          stack: 'kwh',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, resizeDelay: 0,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: cc.tooltip.bg, titleColor: cc.tooltip.title,
          bodyColor: cc.tooltip.body, borderColor: cc.tooltip.border, borderWidth: 1,
          callbacks: {
            label: ctx => `${ctx.dataset.label} : ${ctx.parsed.y} kWh`
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          ticks: { color: cc.tick, font: { size: 11, weight: '600' } }
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: cc.grid },
          ticks: {
            color: cc.tick,
            font: { size: 10 },
            callback: v => v + ' kWh'
          }
        }
      }
    }
  });
}

function renderMonthlyChart(monthly) {
  const canvas = $('monthlyChart');
  if (!canvas || typeof Chart === 'undefined' || !monthly?.length) return;
  const cc     = chartColors();
  const sorted = [...monthly].reverse();
  const labels = sorted.map(m => {
    const [y, mo] = m.month.split('-');
    return new Date(+y, +mo - 1, 1).toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
  });
  const kwh   = sorted.map(m => parseFloat(m.kwh  || 0).toFixed(2));
  const costs = sorted.map(m => parseFloat(m.cost || 0).toFixed(2));

  if (state.chart_monthly) {
    state.chart_monthly.data.labels = labels;
    state.chart_monthly.data.datasets[0].data = kwh;
    state.chart_monthly.data.datasets[1].data = costs;
    state.chart_monthly.update('none');
    return;
  }
  state.chart_monthly = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'kWh', data: kwh, backgroundColor: 'rgba(0,212,255,0.55)', borderColor: cc.cyan,  borderWidth: 1, borderRadius: 4, yAxisID: 'y' },
        { label: '€',   data: costs, backgroundColor: 'rgba(0,255,136,0.3)', borderColor: cc.green, borderWidth: 1, borderRadius: 4, type: 'line', yAxisID: 'y2', tension: 0.4, pointRadius: 3, fill: false }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, resizeDelay: 0,
      plugins: {
        legend: { display: true, labels: { color: cc.tick, font: { size: 10 }, boxWidth: 12, padding: 12 } },
        tooltip: {
          backgroundColor: cc.tooltip.bg, titleColor: cc.tooltip.title,
          bodyColor: cc.tooltip.body, borderColor: cc.tooltip.border, borderWidth: 1
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: cc.tick, font: { size: 10 } } },
        y: {
          beginAtZero: true, grid: { color: cc.grid },
          ticks: { color: cc.tick, font: { size: 10 } },
          title: { display: true, text: 'kWh', color: cc.tick, font: { size: 10 } }
        },
        y2: {
          position: 'right', beginAtZero: true, grid: { display: false },
          ticks: { color: cc.tick, font: { size: 10 } },
          title: { display: true, text: '€', color: cc.tick, font: { size: 10 } }
        }
      }
    }
  });
}

// Détruire les charts si le thème change (pour recréer avec les bonnes couleurs)
function destroyCharts() {
  if (state.chart_weekly)  { state.chart_weekly.destroy();  state.chart_weekly  = null; }
  if (state.chart_monthly) { state.chart_monthly.destroy(); state.chart_monthly = null; }
  if (state.chart_power)   { state.chart_power.destroy();   state.chart_power   = null; }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    if (!data) return;
    state.sessions = data.sessions;
    state.stats    = data.stats;
    renderSessions();
  } catch (e) { showToast('Erreur sessions : ' + e.message, 'error'); }
}

function renderSessions() {
  $('stat-total').textContent = state.stats.total_sessions ?? 0;
  $('stat-kwh').textContent   = fmt(state.stats.total_kwh, 1);
  $('stat-cost').textContent  = fmt(state.stats.total_cost, 2) + '€';

  const list = $('session-list');
  if (!state.sessions.length) {
    list.innerHTML = `<div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">Aucune session enregistrée</div></div>`;
    return;
  }
  list.innerHTML = state.sessions.map(s => `
    <div class="session-item">
      <div class="session-item-header">
        <div class="session-date">${fmtDate(s.start_time)}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="session-mode ${s.tarif_mode}">${s.tarif_mode}</span>
          <button class="session-delete" onclick="deleteSession(${s.id},event)" title="Supprimer">×</button>
        </div>
      </div>
      <div class="session-item-body">
        <span class="session-kwh">⚡ ${fmt(s.energy_kwh, 3)} kWh</span>
        <span class="session-cost">💶 ${fmtEur(s.cost)}</span>
        <span style="color:var(--text-3)">⏱ ${fmtDuration(s.start_time, s.end_time)}</span>
      </div>
    </div>`).join('');
}

async function deleteSession(id, event) {
  event.stopPropagation();
  if (!confirm('Supprimer cette session ?')) return;
  try {
    await api(`/api/sessions/${id}`, { method: 'DELETE' });
    showToast('Session supprimée');
    loadSessions();
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}
window.deleteSession = deleteSession;

// ─── Stats page ───────────────────────────────────────────────────────────────
async function loadStats() {
  if (!state.currentMonth) state.currentMonth = nowMonth();

  // Mettre à jour l'affichage du mois
  $('month-label').textContent = fmtMonth(state.currentMonth);
  $('month-next-btn').disabled = state.currentMonth >= nowMonth();

  try {
    // Stats hebdo du mois sélectionné
    const weekly = await api(`/api/stats/weekly?month=${state.currentMonth}`);
    if (weekly) {
      $('ms-kwh').textContent      = fmt(weekly.summary?.total_kwh, 1);
      $('ms-cost').textContent     = fmt(weekly.summary?.total_cost, 2) + '€';
      $('ms-sessions').textContent = weekly.summary?.total_sessions ?? 0;
      renderWeeklyChart(weekly.weekly);
    }

    // Tendance 12 mois
    const monthly = await api('/api/stats/monthly');
    if (monthly) renderMonthlyChart(monthly.monthly);

  } catch (e) { showToast('Erreur stats : ' + e.message, 'error'); }
}

function changeMonth(delta) {
  state.currentMonth = monthOffset(state.currentMonth || nowMonth(), delta);
  // Détruire uniquement le chart hebdo pour le recréer avec les nouvelles données
  if (state.chart_weekly) { state.chart_weekly.destroy(); state.chart_weekly = null; }
  loadStats();
}
window.changeMonth = changeMonth;

// ─── Switch ───────────────────────────────────────────────────────────────────
async function toggleSwitch() {
  if (!state.status) return;
  const isOn = state.status.switch?.state === 'on';
  if (!isOn) {
    const mode  = state.status.tarif?.mode || 'HP';
    const tarif = state.status.tarif?.value ?? 0;
    if (!confirm(`Démarrer une session ?\nTarif : ${mode} · ${fmt(tarif, 4)} €/kWh`)) return;
  } else {
    if (!confirm('Arrêter la charge et clôturer la session ?')) return;
  }
  $('switch-btn').className = 'switch-btn loading';
  try {
    const res = await api(isOn ? '/api/switch/off' : '/api/switch/on', { method: 'POST' });
    if (!res) return;
    showToast(isOn ? '⛔ Charge arrêtée' : `✅ Charge démarrée (${res.tarif_mode})`);
    await fetchStatus();
  } catch (e) {
    showToast('Erreur : ' + e.message, 'error');
    const s = state.status?.switch?.state;
    $('switch-btn').className = `switch-btn ${s === 'on' ? 'on' : 'off'}`;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  // Afficher les vraies entités configurées
  try {
    const cfg = await api('/api/config');
    console.log('[config] Réponse API:', cfg);
    if (cfg) {
      const sw = $('display-switch-entity');
      const ps = $('display-power-sensor');
      const es = $('display-energy-sensor');
      if (sw) sw.textContent = cfg.switch_entity || '(non configuré)';
      if (ps) ps.textContent = cfg.power_sensor  || '(non configuré)';
      if (es) es.textContent = cfg.energy_sensor || '(non configuré)';
      const fv = $('footer-version');
      if (fv && cfg.pwa_version) fv.textContent = 'v' + cfg.pwa_version;
    }
  } catch(e) { console.warn('[config] ERREUR:', e); }
  if (!state.user) return;
  renderUserBadge(state.user);
  try {
    const me = await api('/api/me');
    if (!me) return;
    $('input-hp').value       = me.tarif_hp;
    $('input-hc').value       = me.tarif_hc;
    $('input-hc-start').value = me.hc_start;
    $('input-hc-end').value   = me.hc_end;
    // Thème sauvegardé côté serveur
    if (me.theme && me.theme !== state.themeChoice) {
      applyTheme(me.theme);
    }
    // Mettre à jour le rôle
    if (me.ha_role) state.user.ha_role = me.ha_role;
    renderUserBadge(state.user);
  } catch { /* ignore */ }
  updateThemeSelector(state.themeChoice);
}

async function saveSettings() {
  const hp  = parseFloat($('input-hp').value);
  const hc  = parseFloat($('input-hc').value);
  const hcs = $('input-hc-start').value.trim();
  const hce = $('input-hc-end').value.trim();
  if (isNaN(hp) || isNaN(hc)) { showToast('Tarifs invalides', 'error'); return; }
  try {
    await api('/api/tarifs', { method: 'POST', body: JSON.stringify({ tarif_hp: hp, tarif_hc: hc, hc_start: hcs, hc_end: hce }) });
    showToast('✅ Tarifs sauvegardés');
    sessionStorage.setItem('ev_goto', 'home');
    setTimeout(() => window.location.reload(), 600);
  } catch (e) { showToast('Erreur : ' + e.message, 'error'); }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  if ($('user-menu').classList.contains('open')) toggleUserMenu();
  const a = document.createElement('a');
  a.href = '/api/export/csv';
  a.download = 'sessions_ev.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('📥 Export CSV lancé');
}
window.exportCSV = exportCSV;

// ─── Notifications ────────────────────────────────────────────────────────────
async function requestNotifications() {
  if (!('Notification' in window)) { showToast('Non supporté', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('✅ Notifications activées');
    $('btn-notif').textContent = '✓ Notifications activées';
    $('btn-notif').disabled = true;
  } else { showToast('Notifications refusées', 'error'); }
}
window.requestNotifications = requestNotifications;

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name) {
  // Masquer toutes les pages (double méthode : classList + style direct)
  document.querySelectorAll('.page').forEach(p => {
    p.classList.remove('active');
    p.style.display = 'none';
  });
  document.querySelectorAll('.bottom-btn').forEach(b => b.classList.remove('active'));
  // Afficher la page cible
  const page = document.getElementById('page-' + name);
  if (page) { page.classList.add('active'); page.style.display = 'block'; }
  const btn = document.querySelector('[data-page="' + name + '"]');
  if (btn) btn.classList.add('active');
  // Remonter en haut de page
  window.scrollTo(0, 0);
  if (name === 'history') loadSessions();
  if (name === 'stats')   loadStats();
  if (name === 'settings') loadSettings();
}
window.showPage = showPage;

// Fermer le menu user en cliquant ailleurs
document.addEventListener('click', e => {
  const menu  = $('user-menu');
  const badge = document.querySelector('.user-badge');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !badge?.contains(e.target)) {
    menu.classList.remove('open');
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Appliquer thème immédiatement (évite le flash)
  applyTheme(state.themeChoice);

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }

  // Navigation
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  $('switch-btn').addEventListener('click', toggleSwitch);
  $('btn-save').addEventListener('click', saveSettings);

  // Auth
  const isAuth = await checkAuth();
  if (!isAuth) { showLoginScreen(); return; }

  // Mettre à jour le thème depuis les préférences serveur
  try {
    const me = await api('/api/me');
    if (me?.theme) applyTheme(me.theme);
    if (me?.ha_role) state.user.ha_role = me.ha_role;
  } catch { /* ignore */ }

  showApp();
  updateThemeIcon(state.themeChoice); // Re-sync icône thème une fois le DOM visible
  renderUserBadge(state.user);

  // Initialiser le mois courant pour les stats
  state.currentMonth = nowMonth();

  const goto = sessionStorage.getItem('ev_goto');
  if (goto) { sessionStorage.removeItem('ev_goto'); showPage(goto); }
  else { showPage('home'); }

  startPolling();
}

document.addEventListener('DOMContentLoaded', init);
