/* EV Charger PWA v3.2 — Init bulletproof + diagnostic */
'use strict';

// ─── Diagnostic panel ─────────────────────────────────────────────────────────
const DEV = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const diagEl = document.getElementById('diag');
function log(msg, type='inf') {
  console.log(`[EV] ${msg}`);
  if (!diagEl) return;
  diagEl.classList.add('show');
  const d = document.createElement('div');
  d.className = `diag-${type}`;
  d.textContent = `${new Date().toLocaleTimeString()} ${msg}`;
  diagEl.appendChild(d);
  diagEl.scrollTop = diagEl.scrollHeight;
  // Masquer après 10s en prod
  if (!DEV) setTimeout(() => diagEl.classList.remove('show'), 10000);
}

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null, status: null, sessions: [], stats: {},
  power_history: [], poll_interval: null,
  chart_power: null, chart_monthly: null,
  theme: localStorage.getItem('ev_theme') || 'dark',
};

// ─── Utils ────────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const fmt    = (n, d=2) => n != null ? Number(n).toFixed(d) : '—';
const fmtEur = n        => n != null ? Number(n).toFixed(2) + ' €' : '—';

function fmtDuration(start, end) {
  if (!start) return '—';
  const diff = Math.abs(new Date(end || Date.now()) - new Date(start));
  const h = Math.floor(diff / 3600000), m = Math.floor((diff % 3600000) / 60000);
  return h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR',{day:'2-digit',month:'short'})
    + ' ' + d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
}
function getInitials(name) {
  return (name||'?').split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
}
function nameToColor(name) {
  const colors = ['#00d4ff','#00ff88','#ffaa00','#bd93f9','#ff79c6','#8be9fd'];
  let h = 0;
  for (let i=0; i<(name||'').length; i++) h = (h*31+name.charCodeAt(i))&0xffffffff;
  return colors[Math.abs(h)%colors.length];
}
function showToast(msg, type='success') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg; t.className = `toast ${type} show`;
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function api(path, options={}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: {'Content-Type':'application/json', ...(options.headers||{})},
    ...options
  });
  if (res.status === 401) { log('401 → login', 'err'); showLoginScreen(); return null; }
  if (!res.ok) {
    const err = await res.json().catch(()=>({detail:`HTTP ${res.status}`}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
function showLoginScreen() {
  log('→ écran login');
  const ls = $('login-screen'), app = $('app'), nav = $('bottom-nav');
  if (ls)  ls.style.display  = 'flex';
  if (app) app.style.display = 'none';
  if (nav) nav.style.display = 'none';
  if (state.poll_interval) { clearInterval(state.poll_interval); state.poll_interval = null; }
}

function showApp() {
  log('→ affichage app');
  const ls = $('login-screen'), app = $('app'), nav = $('bottom-nav');
  if (ls)  ls.style.display  = 'none';
  if (app) app.style.display = 'block';
  if (nav) nav.style.display = 'flex';
}

function startLogin() {
  log('→ redirect /auth/login');
  window.location.href = '/auth/login';
}
window.startLogin = startLogin;

async function logout() {
  toggleUserMenu();
  await fetch('/auth/logout', {method:'POST', credentials:'include'}).catch(()=>{});
  state.user = null;
  showLoginScreen();
  showToast('Déconnecté');
}
window.logout = logout;

async function checkAuth() {
  try {
    log('checkAuth...');
    const res = await fetch('/auth/check', {credentials:'include'});
    const data = await res.json();
    log(`auth: ${data.authenticated ? '✓ ' + data.display_name : '✗'}`,
        data.authenticated ? 'ok' : 'inf');
    if (data.authenticated) { state.user = data; return true; }
  } catch(e) { log('checkAuth error: ' + e.message, 'err'); }
  return false;
}

// ─── Theme ────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ev_theme', theme);
  if (state.user) {
    fetch('/api/theme', {method:'POST', credentials:'include',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({theme})}).catch(()=>{});
  }
}
function toggleTheme() { applyTheme(state.theme === 'dark' ? 'light' : 'dark'); }
window.toggleTheme = toggleTheme;

// ─── User badge ───────────────────────────────────────────────────────────────
function renderUserBadge(user) {
  if (!user) return;
  const name = user.display_name || user.user_name || 'User';
  const initials = getInitials(name);
  const color = nameToColor(name);

  const av = $('user-avatar');
  if (av) { av.textContent = initials; av.style.cssText = `background:${color}22;color:${color};border:1px solid ${color}44`; }
  const un = $('user-name');
  if (un) un.textContent = name.split(' ')[0];

  const avBig = $('profile-avatar-big');
  if (avBig) { avBig.textContent = initials; avBig.style.cssText = `background:${color}22;color:${color};border:2px solid ${color}66`; }
  const pn = $('profile-name');  if (pn) pn.textContent = name;
  const pr = $('profile-role');  if (pr) pr.textContent = `Home Assistant · ${user.user_name || ''}`;

  const ps = $('profile-stats');
  if (ps && user.total_sessions !== undefined) {
    ps.innerHTML = `
      <div class="profile-stat"><div class="profile-stat-val">${user.total_sessions}</div><div class="profile-stat-lbl">Sessions</div></div>
      <div class="profile-stat"><div class="profile-stat-val">${fmt(user.total_kwh,1)}</div><div class="profile-stat-lbl">kWh total</div></div>
      <div class="profile-stat"><div class="profile-stat-val">${fmt(user.total_cost,2)}€</div><div class="profile-stat-lbl">Coût total</div></div>`;
  }
}

function toggleUserMenu() {
  const m = $('user-menu');
  if (m) m.classList.toggle('open');
}
window.toggleUserMenu = toggleUserMenu;

// ─── Polling ──────────────────────────────────────────────────────────────────
async function fetchStatus() {
  try {
    const data = await api('/api/status');
    if (!data) return;
    state.status = data;
    $('conn-banner')?.classList.remove('show');
    renderHome(data);
    state.power_history.push({t:Date.now(), v:data.power?.value ?? 0});
    if (state.power_history.length > 60) state.power_history.shift();
    renderPowerChart();
  } catch(e) {
    $('conn-banner')?.classList.add('show');
  }
}
function startPolling() {
  fetchStatus();
  if (state.poll_interval) clearInterval(state.poll_interval);
  state.poll_interval = setInterval(fetchStatus, 5000);
}

// ─── Home render ──────────────────────────────────────────────────────────────
function renderHome(data) {
  const mode  = data.tarif?.mode  || 'HP';
  const tarif = data.tarif?.value ?? 0;
  const badge = $('tarif-badge');
  if (badge) { badge.textContent = `${mode} · ${fmt(tarif,4)}€`; badge.className = `tarif-badge ${mode.toLowerCase()}`; }

  const mins = data.tarif?.minutes_until_hc;
  const cdEl = $('hc-countdown');
  if (cdEl) {
    if (mode === 'HP' && mins != null && mins < 120) {
      cdEl.style.display = 'flex';
      const h = Math.floor(mins/60), m = mins%60;
      const lbl = h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}min`;
      const ct = $('hc-countdown-text');
      if (ct) ct.textContent = `HC dans ${lbl} — pensez à brancher !`;
    } else { cdEl.style.display = 'none'; }
  }

  const power = data.power?.value ?? 0;
  const pv = $('power-val'), pu = $('power-unit');
  if (pv) pv.textContent = power >= 1000 ? fmt(power/1000,2) : fmt(power,0);
  if (pu) pu.textContent = power >= 1000 ? 'kW' : 'W';

  const isOn = data.switch?.state === 'on';
  const btn = $('switch-btn');
  if (btn) { btn.className = `switch-btn ${isOn ? 'on' : 'off'}`; }
  const sl = $('switch-label');
  if (sl) sl.textContent = isOn ? 'EN CHARGE' : 'ARRÊTÉ';
  const pc = $('power-card');
  if (pc) pc.className = `power-card ${isOn ? 'charging' : ''}`;

  const session  = data.session_active;
  const liveDiv  = $('session-live');
  if (liveDiv) {
    if (session && isOn) {
      liveDiv.style.display = 'block';
      const kwh  = data.session_kwh ?? 0;
      const cost = kwh * tarif;
      const el = id => $(id);
      if (el('live-kwh'))      el('live-kwh').textContent      = fmt(kwh,3);
      if (el('live-cost'))     el('live-cost').textContent     = fmtEur(cost);
      if (el('live-duration')) el('live-duration').textContent = fmtDuration(session.start_time, null);
      if (el('live-tarif'))    el('live-tarif').textContent    = `${mode} · ${fmt(tarif,4)}€`;
      if (el('live-mode'))     { el('live-mode').textContent = mode; el('live-mode').className = `session-mode ${mode}`; }
      if (el('live-kwh-mini')) el('live-kwh-mini').textContent  = fmt(kwh,3);
      if (el('live-cost-mini'))el('live-cost-mini').textContent = fmtEur(cost);
      if (el('live-duration-mini')) el('live-duration-mini').textContent = fmtDuration(session.start_time, null);
    } else { liveDiv.style.display = 'none'; }
  }
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function renderPowerChart() {
  const canvas = $('powerChart');
  if (!canvas || typeof Chart === 'undefined') return;
  const labels = state.power_history.map(p => new Date(p.t).toLocaleTimeString('fr-FR'));
  const values = state.power_history.map(p => p.v);
  if (state.chart_power) {
    state.chart_power.data.labels = labels;
    state.chart_power.data.datasets[0].data = values;
    state.chart_power.update('none');
    return;
  }
  state.chart_power = new Chart(canvas.getContext('2d'), {
    type:'line', data:{labels, datasets:[{data:values, borderColor:'#00d4ff',
      backgroundColor:'rgba(0,212,255,0.07)', borderWidth:2, fill:true,
      tension:0.4, pointRadius:0}]},
    options:{responsive:true, maintainAspectRatio:false, animation:false, resizeDelay:0,
      plugins:{legend:{display:false}},
      scales:{x:{display:false}, y:{beginAtZero:true, grid:{color:'rgba(30,45,74,0.6)'},
        ticks:{color:'#4a5878', font:{size:10}}}}}
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
    type:'bar',
    data:{labels, datasets:[
      {label:'kWh', data:kwh, backgroundColor:'rgba(0,212,255,0.6)', borderColor:'#00d4ff', borderWidth:1, borderRadius:4, yAxisID:'y'},
      {label:'€', data:costs, backgroundColor:'rgba(0,255,136,0.4)', borderColor:'#00ff88', borderWidth:1, borderRadius:4, type:'line', yAxisID:'y2', tension:0.4, pointRadius:3}
    ]},
    options:{responsive:true, maintainAspectRatio:false, animation:false, resizeDelay:0,
      plugins:{legend:{display:true, labels:{color:'#8899bb', font:{size:11}, boxWidth:12, padding:16}}},
      scales:{
        x:{grid:{display:false}, ticks:{color:'#4a5878', font:{size:10}}},
        y:{beginAtZero:true, grid:{color:'rgba(30,45,74,0.6)'}, ticks:{color:'#4a5878', font:{size:10}}},
        y2:{position:'right', beginAtZero:true, grid:{display:false}, ticks:{color:'#4a5878', font:{size:10}}}
      }}
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
async function loadSessions() {
  try {
    const data = await api('/api/sessions');
    if (!data) return;
    state.sessions = data.sessions; state.stats = data.stats;
    renderSessions();
    const monthly = await api('/api/stats/monthly');
    if (monthly) renderMonthlyChart(monthly.monthly);
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

function renderSessions() {
  const st = $('stat-total'), sk = $('stat-kwh'), sc = $('stat-cost');
  if (st) st.textContent = state.stats.total_sessions ?? 0;
  if (sk) sk.textContent = fmt(state.stats.total_kwh, 1);
  if (sc) sc.textContent = fmt(state.stats.total_cost, 2) + '€';
  const list = $('session-list');
  if (!list) return;
  if (!state.sessions.length) {
    list.innerHTML = '<div class="empty"><div class="empty-icon">⚡</div><div class="empty-text">Aucune session</div></div>';
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
    const mode = state.status.tarif?.mode || 'HP';
    const tarif = state.status.tarif?.value ?? 0;
    if (!confirm(`Démarrer une session ?\nTarif: ${mode} · ${fmt(tarif,4)} €/kWh`)) return;
  } else {
    if (!confirm('Arrêter la charge et clôturer la session ?')) return;
  }
  const btn = $('switch-btn');
  if (btn) btn.className = 'switch-btn loading';
  try {
    const res = await api(isOn ? '/api/switch/off' : '/api/switch/on', {method:'POST'});
    if (!res) return;
    showToast(isOn ? '⛔ Charge arrêtée' : `✅ Charge démarrée (${res.tarif_mode})`);
    await fetchStatus();
  } catch(e) {
    showToast('Erreur: ' + e.message, 'error');
    if (btn) btn.className = `switch-btn ${state.status?.switch?.state === 'on' ? 'on' : 'off'}`;
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  if (!state.user) return;
  renderUserBadge(state.user);
  try {
    const me = await api('/api/me');
    if (!me) return;
    const ih = $('input-hp'), ic = $('input-hc'), is = $('input-hc-start'), ie = $('input-hc-end');
    if (ih) ih.value = me.tarif_hp;
    if (ic) ic.value = me.tarif_hc;
    if (is) is.value = me.hc_start;
    if (ie) ie.value = me.hc_end;
  } catch { /* ignore */ }
}

async function saveSettings() {
  const hp = parseFloat($('input-hp')?.value);
  const hc = parseFloat($('input-hc')?.value);
  const hs = $('input-hc-start')?.value?.trim();
  const he = $('input-hc-end')?.value?.trim();
  if (isNaN(hp) || isNaN(hc)) { showToast('Tarifs invalides', 'error'); return; }
  try {
    await api('/api/tarifs', {method:'POST', body:JSON.stringify({tarif_hp:hp,tarif_hc:hc,hc_start:hs,hc_end:he})});
    showToast('✅ Tarifs sauvegardés');
    sessionStorage.setItem('ev_goto', 'home');
    setTimeout(() => window.location.reload(), 600);
  } catch(e) { showToast('Erreur: ' + e.message, 'error'); }
}

async function exportCSV() {
  toggleUserMenu();
  const a = document.createElement('a');
  a.href = '/api/export/csv'; a.download = 'sessions_ev.csv'; a.click();
}
window.exportCSV = exportCSV;

async function requestNotifications() {
  if (!('Notification' in window)) { showToast('Non supporté', 'error'); return; }
  const perm = await Notification.requestPermission();
  showToast(perm === 'granted' ? '✅ Notifications activées' : 'Refusé', perm === 'granted' ? 'success' : 'error');
  if (perm === 'granted') { const b = $('btn-notif'); if (b) b.textContent = 'Activées ✓'; }
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

document.addEventListener('click', e => {
  const menu = $('user-menu'), badge = document.querySelector('.user-badge');
  if (menu?.classList.contains('open') && !menu.contains(e.target) && !badge?.contains(e.target))
    menu.classList.remove('open');
});

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  log('init() démarré');

  // 1. Thème immédiat — évite le flash blanc
  applyTheme(state.theme);

  // 2. Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', {scope:'/'})
      .then(() => log('SW enregistré', 'ok'))
      .catch(e => log('SW erreur: ' + e, 'err'));
  }

  // 3. Vérifier auth AVANT d'attacher les listeners (éléments cachés)
  let isAuth = false;
  try {
    isAuth = await checkAuth();
  } catch(e) {
    log('checkAuth exception: ' + e.message, 'err');
  }

  if (!isAuth) {
    showLoginScreen();
    log('→ login screen affiché', 'ok');
    return;
  }

  // 4. Afficher l'app — les éléments sont maintenant visibles
  showApp();

  // 5. Attacher les listeners APRÈS showApp
  document.querySelectorAll('[data-page]').forEach(btn => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });
  const switchBtn = $('switch-btn');
  if (switchBtn) switchBtn.addEventListener('click', toggleSwitch);
  else log('switch-btn introuvable !', 'err');
  const saveBtn = $('btn-save');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);

  // 6. Profil & navigation
  renderUserBadge(state.user);
  const goto = sessionStorage.getItem('ev_goto');
  if (goto) { sessionStorage.removeItem('ev_goto'); showPage(goto); }
  else { showPage('home'); }

  // 7. Polling
  startPolling();
  log('✅ app prête', 'ok');
}

// Lancer init — afficher l'erreur si ça plante
document.addEventListener('DOMContentLoaded', () => {
  init().catch(e => {
    log('FATAL: ' + e.message, 'err');
    console.error(e);
    showLoginScreen(); // Dernier recours
  });
});
