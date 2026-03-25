/* EV Charger PWA v2 — OAuth2 HA + Profil utilisateur */
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
  chart_monthly: null,
  theme: localStorage.getItem('ev_theme') || 'dark',
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt  = (n, d=2)  => n != null ? Number(n).toFixed(d) : '—';
const fmtEur = n => n != null ? Number(n).toFixed(2) + ' €' : '—';

function fmtDuration(start, end) {
  if (!start) return '—';
  const diff = Math.abs(new Date(end || Date.now()) - new Date(start));
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', {day:'2-digit', month:'short'})
    + ' ' + d.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'});
}
function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
}
function nameToColor(name) {
  const colors = ['#00d4ff','#00ff88','#ffaa00','#bd93f9','#ff79c6','#50fa7b','#8be9fd'];
  let h = 0;
  for (let i = 0; i < (name||'').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  return colors[Math.abs(h) % colors.length];
}

function showToast(msg, type='success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function api(path, options={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {'Content-Type': 'application/json', ...(options.headers||{})},
    ...options
  });
  if (res.status === 401) { showLoginScreen(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(() => ({detail: 'Erreur réseau'}));
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

function startLogin() {
  window.location.href = '/auth/login';
}

async function logout() {
  toggleUserMenu();
  await fetch('/auth/logout', {method:'POST', credentials:'include'});
  state.user = null;
  showLoginScreen();
  showToast('Déconnecté');
}

async function checkAuth() {
  try {
    const res = await fetch('/auth/check', {credentials:'include'});
    const data = await res.json();
    if (data.authenticated) {
      state.user = data;
      return true;
    }
  } catch(e) { /* offline */ }
  return false;
}

// ─── User badge ───────────────────────────────────────────────────────────────
function renderUserBadge(user) {
  if (!user) return;
  const name = user.display_name || user.user_name || 'User';
  const initials = getInitials(name);
  const color = nameToColor(name);

  // Header badge
  const av = $('user-avatar');
  av.textContent = initials;
  av.style.background = color + '22';
  av.style.color = color;
  av.style.border = `1px solid ${color}44`;
  $('user-name').textContent = name.split(' ')[0];

  // Profile page
  const avBig = $('profile-avatar-big');
  if (avBig) {
    avBig.textContent = initials;
    avBig.style.background = color + '22';
    avBig.style.color = color;
    avBig.style.border = `2px solid ${color}66`;
  }
  const pname = $('profile-name');
  if (pname) pname.textContent = name;
  const prole = $('profile-role');
  if (prole) prole.textContent = 'Home Assistant · ' + (user.user_name || '');

  // Stats profil (Option C)
  const ps = $('profile-stats');
  if (ps && (user.total_sessions !== undefined)) {
    ps.innerHTML = `
      <div class="profile-stat"><div class="profile-stat-val">${user.total_sessions}</div><div class="profile-stat-lbl">Sessions</div></div>
      <div class="profile-stat"><div class="profile-stat-val">${fmt(user.total_kwh,1)}</div><div class="profile-stat-lbl">kWh total</div></div>
      <div class="profile-stat"><div class="profile-stat-val">${fmt(user.total_cost,2)}€</div><div class="profile-stat-lbl">Coût total</div></div>
    `;
  }
}

function toggleUserMenu() {
  $('user-menu').classList.toggle('open');
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ev_theme', theme);
  const icon = $('theme-icon');
  if (theme === 'light') {
    icon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  } else {
    icon.innerHTML = '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>';
  }
  // Sauvegarder en base si connecté
  if (state.user) {
    fetch('/api/theme', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({theme})}).catch(()=>{});
  }
}
function toggleTheme() {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
}

// ─── Polling ──────────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const data = await api('/api/status');
    if (!data) return;
    state.status = data;
    $('conn-banner').classList.remove('show');
    renderHome(data);
    const power = data.power?.value ?? 0;
    state.power_history.push({t: Date.now(), v: power});
    if (state.power_history.length > 60) state.power_history.shift();
    renderPowerChart();
  } catch(e) {
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
  const mode   = data.tarif?.mode || 'HP';
  const tarif  = data.tarif?.value ?? 0;
  const badge  = $('tarif-badge');
  badge.textContent = `${mode} · ${fmt(tarif,4)}€`;
  badge.className   = `tarif-badge ${mode.toLowerCase()}`;

  // Countdown HC
  const mins = data.tarif?.minutes_until_hc;
  const cdEl = $('hc-countdown');
  if (mode === 'HP' && mins != null && mins < 120) {
    cdEl.style.display = 'flex';
    const h = Math.floor(mins/60), m = mins%60;
    const label = h > 0 ? `${h}h${String(m).padStart(2,'0')} avant HC` : `${m} min avant HC`;
    $('hc-countdown-text').textContent = `HC dans ${label} — pensez à brancher !`;
  } else { cdEl.style.display = 'none'; }

  const power = data.power?.value ?? 0;
  $('power-val').textContent = power >= 1000 ? fmt(power/1000,2) : fmt(power,0);
  $('power-unit').textContent = power >= 1000 ? 'kW' : 'W';

  const isOn = data.switch?.state === 'on';
  const btn = $('switch-btn');
  btn.className = `switch-btn ${isOn ? 'on' : 'off'}`;
  $('switch-label').textContent = isOn ? 'EN CHARGE' : 'ARRÊTÉ';
  $('power-card').className = `power-card ${isOn ? 'charging' : ''}`;

  // Session live
  const session = data.session_active;
  const liveDiv = $('session-live');
  if (session && isOn) {
    liveDiv.style.display = 'block';
    const kwh  = data.session_kwh ?? 0;
    const cost = kwh * tarif;
    $('live-kwh').textContent   = fmt(kwh, 3);
    $('live-cost').textContent  = fmtEur(cost);
    $('live-duration').textContent = fmtDuration(session.start_time, null);
    $('live-tarif').textContent = `${mode} · ${fmt(tarif,4)}€`;
    $('live-mode').textContent  = mode;
    $('live-mode').className    = `session-mode ${mode}`;
    // Mini stats
    $('live-kwh-mini').textContent  = fmt(kwh,3);
    $('live-cost-mini').textContent = fmtEur(cost);
    $('live-duration-mini').textContent = fmtDuration(session.start_time, null);
  } else {
    liveDiv.style.display = 'none';
    $('live-kwh-mini').textContent = '—';
    $('live-cost-mini').textContent = '—';
    $('live-duration-mini').textContent = '—';
  }

  // Heure
  $('header-time') && ($('header-time').textContent = new Date().toLocaleTimeString('fr-FR'));
}

// ─── Charts ───────────────────────────────────────────────────────────────────
const CHART_COLORS = { cyan:'#00d4ff', green:'#00ff88', amber:'#ffaa00', grid:'rgba(30,45,74,0.6)' };

function renderPowerChart() {
  const canvas = $('powerChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = state.power_history.map(p =>
    new Date(p.t).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',second:'2-digit'}));
  const values = state.power_history.map(p => p.v);

  if (state.chart_power) {
    state.chart_power.data.labels = labels;
    state.chart_power.data.datasets[0].data = values;
    state.chart_power.update('none');
    return;
  }
  state.chart_power = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [{
      data: values, borderColor: CHART_COLORS.cyan,
      backgroundColor: 'rgba(0,212,255,0.07)', borderWidth: 2,
      fill: true, tension: 0.4, pointRadius: 0, pointHoverRadius: 4
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 0,
      plugins: { legend:{display:false}, tooltip:{backgroundColor:'#1a2340',titleColor:'#8899bb',bodyColor:'#e8eef8',borderColor:'#1e2d4a',borderWidth:1}},
      scales: {
        x:{display:false, grid:{display:false}},
        y:{beginAtZero:true, grid:{color:CHART_COLORS.grid}, ticks:{color:'#4a5878', font:{family:'JetBrains Mono, monospace', size:10}}}
      }
    }
  });
}

function renderMonthlyChart(monthly) {
  const canvas = $('monthlyChart');
  if (!canvas || typeof Chart === 'undefined' || !monthly?.length) return;
  const sorted = [...monthly].reverse();
  const labels = sorted.map(m => m.month);
  const kwh    = sorted.map(m => parseFloat(m.kwh  || 0).toFixed(2));
  const costs  = sorted.map(m => parseFloat(m.cost || 0).toFixed(2));

  if (state.chart_monthly) {
    state.chart_monthly.data.labels = labels;
    state.chart_monthly.data.datasets[0].data = kwh;
    state.chart_monthly.data.datasets[1].data = costs;
    state.chart_monthly.update('none');
    return;
  }
  state.chart_monthly = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels, datasets: [
      {label:'kWh', data: kwh, backgroundColor:'rgba(0,212,255,0.6)', borderColor:CHART_COLORS.cyan, borderWidth:1, borderRadius:4, yAxisID:'y'},
      {label:'€',   data: costs, backgroundColor:'rgba(0,255,136,0.4)', borderColor:CHART_COLORS.green, borderWidth:1, borderRadius:4, type:'line', yAxisID:'y2', tension:0.4, pointRadius:3}
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 0,
      plugins:{legend:{display:true, labels:{color:'#8899bb', font:{size:11}, boxWidth:12, padding:16}}},
      scales: {
        x:{grid:{display:false}, ticks:{color:'#4a5878', font:{size:10}}},
        y:{beginAtZero:true, grid:{color:CHART_COLORS.grid}, ticks:{color:'#4a5878', font:{size:10}}, title:{display:true,text:'kWh',color:'#4a5878',font:{size:10}}},
        y2:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{color:'#4a5878', font:{size:10}}, title:{display:true,text:'€',color:'#4a5878',font:{size:10}}}
      }
    }
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    if (!data) return;
    state.sessions = data.sessions;
    state.stats = data.stats;
    renderSessions();
    // Stats mensuelles
    const monthly = await api('/api/stats/monthly');
    if (monthly) renderMonthlyChart(monthly.monthly);
  } catch(e) { showToast('Erreur sessions: ' + e.message, 'error'); }
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
          <button class="session-delete" onclick="deleteSession(${s.id},event)">×</button>
        </div>
      </div>
      <div class="session-item-body">
        <span class="session-kwh">⚡ ${fmt(s.energy_kwh,3)} kWh</span>
        <span class="session-cost">💶 ${fmtEur(s.cost)}</span>
        <span style="color:var(--text-3)">⏱ ${fmtDuration(s.start_time, s.end_time)}</span>
      </div>
    </div>`).join('');
}

async function deleteSession(id, event) {
  event.stopPropagation();
  if (!confirm('Supprimer cette session ?')) return;
  try {
    await api(`/api/sessions/${id}`, {method:'DELETE'});
    showToast('Session supprimée');
    loadSessions();
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}
window.deleteSession = deleteSession;

// ─── Switch ───────────────────────────────────────────────────────────────────
async function toggleSwitch() {
  if (!state.status) return;
  const isOn = state.status.switch?.state === 'on';
  if (!isOn) {
    const mode  = state.status.tarif?.mode || 'HP';
    const tarif = state.status.tarif?.value ?? 0;
    if (!confirm(`Démarrer une session ?\nTarif: ${mode} · ${fmt(tarif,4)} €/kWh`)) return;
  } else {
    if (!confirm('Arrêter la charge et clôturer la session ?')) return;
  }
  $('switch-btn').className = 'switch-btn loading';
  try {
    const res = await api(isOn ? '/api/switch/off' : '/api/switch/on', {method:'POST'});
    if (!res) return;
    showToast(isOn ? '⛔ Charge arrêtée' : `✅ Charge démarrée (${res.tarif_mode})`);
    await fetchStatus();
  } catch(e) {
    showToast('Erreur: ' + e.message, 'error');
    const s = state.status?.switch?.state;
    $('switch-btn').className = `switch-btn ${s === 'on' ? 'on' : 'off'}`;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  if (!state.user) return;
  renderUserBadge(state.user);
  try {
    const me = await api('/api/me');
    if (!me) return;
    $('input-hp').value      = me.tarif_hp;
    $('input-hc').value      = me.tarif_hc;
    $('input-hc-start').value = me.hc_start;
    $('input-hc-end').value   = me.hc_end;
  } catch { /* ignore */ }
}

async function saveSettings() {
  const hp  = parseFloat($('input-hp').value);
  const hc  = parseFloat($('input-hc').value);
  const hcs = $('input-hc-start').value.trim();
  const hce = $('input-hc-end').value.trim();
  if (isNaN(hp) || isNaN(hc)) { showToast('Tarifs invalides', 'error'); return; }
  try {
    await api('/api/tarifs', {method:'POST', body: JSON.stringify({tarif_hp:hp, tarif_hc:hc, hc_start:hcs, hc_end:hce})});
    showToast('✅ Tarifs sauvegardés');
    sessionStorage.setItem('ev_goto', 'home');
    setTimeout(() => window.location.reload(), 600);
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
async function exportCSV() {
  toggleUserMenu();
  const a = document.createElement('a');
  a.href = '/api/export/csv';
  a.download = 'sessions_ev.csv';
  a.click();
}
window.exportCSV = exportCSV;

// ─── Notifications ────────────────────────────────────────────────────────────
async function requestNotifications() {
  if (!('Notification' in window)) { showToast('Non supporté', 'error'); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    showToast('✅ Notifications activées');
    $('btn-notif').textContent = 'Notifications activées ✓';
  } else { showToast('Notifications refusées', 'error'); }
}
window.requestNotifications = requestNotifications;

// ─── Navigation ───────────────────────────────────────────────────────────────
function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.bottom-btn').forEach(b => b.classList.remove('active'));
  const page = $(`page-${name}`);
  if (page) page.classList.add('active');
  const btn = document.querySelector(`[data-page="${name}"]`);
  if (btn) btn.classList.add('active');
  if (name === 'history') loadSessions();
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
  try {
    // Thème en premier — évite le flash blanc
    applyTheme(state.theme);

    // Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', {scope:'/'}).catch(()=>{});
    }

    // Navigation bottom bar (toujours présente dans le DOM)
    document.querySelectorAll('[data-page]').forEach(btn => {
      btn.addEventListener('click', () => showPage(btn.dataset.page));
    });

    // Vérifier auth AVANT de toucher aux éléments de #app (qui est hidden)
    const isAuth = await checkAuth();
    if (!isAuth) {
      showLoginScreen();
      return;
    }

    // Afficher l'app — les éléments de #app sont maintenant dans le DOM visible
    showApp();

    // Attacher les listeners APRÈS showApp (éléments accessibles)
    const switchBtn = $('switch-btn');
    if (switchBtn) switchBtn.addEventListener('click', toggleSwitch);
    const saveBtn = $('btn-save');
    if (saveBtn) saveBtn.addEventListener('click', saveSettings);

    renderUserBadge(state.user);

    // Goto post-reload
    const goto = sessionStorage.getItem('ev_goto');
    if (goto) { sessionStorage.removeItem('ev_goto'); showPage(goto); }
    else { showPage('home'); }

    startPolling();

  } catch(e) {
    // Erreur JS → afficher login plutôt que page blanche
    console.error('Init error:', e);
    showLoginScreen();
  }
}

document.addEventListener('DOMContentLoaded', init);
