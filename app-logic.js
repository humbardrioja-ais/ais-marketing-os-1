/**
 * AIS Marketing OS — App Logic v4
 * Pure vanilla JS. No frameworks. No build step.
 * Matches index.html v4 structure.
 */

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const CONFIG = {
  SCRIPT_URL:    localStorage.getItem('ais_script_url') || 'https://script.google.com/macros/s/AKfycbyEo1uEwr8cASUvW-jyKpL39QXraT0lgWPl1JtwFmIPHg2hFF5OnFYqyWjH66FunJho/exec',
  SYNC_INTERVAL: 30_000,
  LS_KEY:        'ais_data',
  LS_QUEUE:      'ais_queue',
  CAMPUSES:      ['MTT','TK','CA','TAK','SR'],
  PRIORITIES:    ['low','medium','high','critical'],
  TASK_STATUSES: ['todo','in_progress','in_review','done','blocked'],
  LEAVE_TYPES:   ['annual','sick','emergency','maternity','unpaid','other'],
  PLATFORMS:     ['facebook','instagram','tiktok','youtube','linkedin'],
};

// ─── STATE ────────────────────────────────────────────────────────────────────
const DB = {
  Tasks: [], Subtasks: [], Task_Comments: [], Campaigns: [],
  Leave_Requests: [], Missions: [], Comp_Days: [], Events: [],
  Shoots: [], Media_Assets: [], Content: [], Meetings: [],
  Meeting_Actions: [], Departments: [], Members: [], Enrollment: [], Social_Metrics: []
};

let currentView      = 'dashboard';
let currentDashView  = 'team';
let calDate          = new Date();
let calFilters       = { leave: true, mission: true, dayoff: true };
let taskFilterStatus = 'all';
let taskFilterDept   = '';
let campaignFilter   = 'all';
let peopleFilter     = 'all';
let mediaPoolTab     = 'shoots';
let mediaPoolFilter  = 'all';
let drawerEntity     = null;
let drawerItem       = null;
let confirmCb        = null;
let isSyncing        = false;
let pendingQueue     = [];
const expandedTasks  = new Set();
const expandedMonths = new Set();

// ─── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // Restore localStorage immediately for instant render
  loadFromLS();

  // Service worker
  if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));

  // Online/offline
  window.addEventListener('online',  () => { hideBanner(); flushQueue(); toast('Back online — syncing…', 'info'); });
  window.addEventListener('offline', () => showBanner());
  if (!navigator.onLine) showBanner();

  // Restore settings URL
  const savedUrl = localStorage.getItem('ais_script_url');
  if (savedUrl) {
    CONFIG.SCRIPT_URL = savedUrl;
    const urlEl = document.getElementById('settings-url');
    if (urlEl) urlEl.value = savedUrl;
  }

  // Restore theme
  const savedTheme = localStorage.getItem('ais_theme');
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;

  // Restore accent colour
  const savedAccent = localStorage.getItem('ais_accent');
  if (savedAccent) setAccent(savedAccent, null, true);

  // Mobile menu button
  if (window.innerWidth <= 768) {
    const mb = document.getElementById('menu-btn');
    if (mb) mb.style.display = 'flex';
  }

  // Restore offline queue
  pendingQueue = JSON.parse(localStorage.getItem(CONFIG.LS_QUEUE) || '[]');

  // Dashboard date
  const dateEl = document.getElementById('dash-date');
  if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en', { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  // Initial sync then auto-sync
  fetchFromSheets();
  setInterval(fetchFromSheets, CONFIG.SYNC_INTERVAL);

  // Hash routing
  const hash = window.location.hash.slice(1);
  if (hash && document.getElementById('view-' + hash)) nav(hash);
  else nav('dashboard');
});

// ─── LOCAL STORAGE ────────────────────────────────────────────────────────────
function saveToLS() {
  try { localStorage.setItem(CONFIG.LS_KEY, JSON.stringify(DB)); } catch(e) {}
}
function loadFromLS() {
  try {
    const raw = localStorage.getItem(CONFIG.LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    Object.keys(DB).forEach(k => { if (d[k]) DB[k] = d[k]; });
  } catch(e) {}
}
function saveQueue() {
  localStorage.setItem(CONFIG.LS_QUEUE, JSON.stringify(pendingQueue));
}

// ─── SYNC — FETCH ─────────────────────────────────────────────────────────────
async function fetchFromSheets() {
  if (!CONFIG.SCRIPT_URL || isSyncing) return;
  isSyncing = true;
  try {
    const res  = await fetch(CONFIG.SCRIPT_URL + '?t=' + Date.now());
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    Object.keys(DB).forEach(k => { if (json.data[k]) DB[k] = json.data[k]; });
    saveToLS();
    renderAll();
    updateSyncTime();
  } catch(e) {
    console.warn('Sync failed:', e.message);
  } finally {
    isSyncing = false;
  }
}

function manualSync() {
  toast('Syncing…', 'info');
  fetchFromSheets().then(() => toast('Sync complete ✓', 'success'));
}

function updateSyncTime() {
  const el = document.getElementById('last-synced');
  if (el) el.textContent = new Date().toLocaleTimeString();
}

// ─── SYNC — PUSH ──────────────────────────────────────────────────────────────
async function pushToSheets(payload) {
  if (!CONFIG.SCRIPT_URL) return true;
  if (!navigator.onLine) { enqueue(payload); return false; }
  try {
    const res  = await fetch(CONFIG.SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    return true;
  } catch(e) {
    enqueue(payload);
    toast('Queued — will sync when online', 'warn');
    return false;
  }
}

function enqueue(payload) {
  pendingQueue.push({ ...payload, _ts: Date.now() });
  saveQueue();
}

async function flushQueue() {
  if (!CONFIG.SCRIPT_URL || !pendingQueue.length) return;
  const batch = [...pendingQueue];
  pendingQueue = [];
  saveQueue();
  for (const op of batch) {
    try { await pushToSheets(op); } catch(e) { pendingQueue.push(op); }
  }
  if (pendingQueue.length) { saveQueue(); toast(`${pendingQueue.length} ops still pending`, 'warn'); }
  else toast('Queue flushed ✓', 'success');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function dbAppend(sheet, data) {
  data.id         = data.id         || genId();
  data.created_at = data.created_at || new Date().toISOString();
  DB[sheet].unshift(data);
  saveToLS();
  renderAll();
  await pushToSheets({ action: 'append', sheet, data });
  return data;
}

async function dbUpdate(sheet, id, patch) {
  const idx = DB[sheet].findIndex(r => r.id === id);
  if (idx < 0) return;
  DB[sheet][idx] = { ...DB[sheet][idx], ...patch };
  saveToLS();
  renderAll();
  await pushToSheets({ action: 'update', sheet, id, data: DB[sheet][idx] });
}

async function dbDelete(sheet, id) {
  DB[sheet] = DB[sheet].filter(r => r.id !== id);
  saveToLS();
  renderAll();
  await pushToSheets({ action: 'delete', sheet, id });
}

// ─── ROUTER ───────────────────────────────────────────────────────────────────
const VIEW_TITLES = {
  dashboard:'Dashboard', planner:'Planner', marketing:'Marketing',
  people:'People', intel:'Intel', admin:'Admin',
};

function nav(view) {
  currentView = view;

  // Switch view panels
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + view)?.classList.add('active');

  // Sidebar active state
  document.querySelectorAll('.sb-item[data-view]').forEach(n =>
    n.classList.toggle('active', n.dataset.view === view));

  // Mobile nav active state
  document.querySelectorAll('.mob-item[data-view]').forEach(n =>
    n.classList.toggle('active', n.dataset.view === view));

  // Topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = VIEW_TITLES[view] || view;

  // Hash
  window.location.hash = view;

  // Render
  renderView(view);

  // Close mobile sidebar if open
  if (window.innerWidth <= 768)
    document.getElementById('sidebar')?.classList.remove('open');
}

function renderView(v) {
  switch(v) {
    case 'dashboard':  renderDashboard(); break;
    case 'planner':    renderPlanner();   break;
    case 'marketing':  renderMarketing(); break;
    case 'people':     renderPeople();    break;
    case 'intel':      renderIntel();     break;
    case 'admin':      renderAdmin();     break;
  }
}

function renderAll() { renderView(currentView); }

// ─── TAB SWITCHERS ────────────────────────────────────────────────────────────
function setPlannerTab(tab, el) {
  // Tab buttons
  ['stab-calendar','stab-tasks','stab-media-cal'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  el.classList.add('active');

  // Content panels
  ['sc-calendar','sc-tasks','sc-media-cal'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById('sc-' + tab)?.classList.add('active');

  // Render relevant section
  if (tab === 'calendar')  renderCalendar();
  if (tab === 'tasks')     renderTasks();
  if (tab === 'media-cal') renderMediaCal();
}

function setMktTab(tab, el) {
  ['stab-campaigns','stab-media','stab-social','stab-enrollment','stab-events'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  el.classList.add('active');

  ['sm-campaigns','sm-media','sm-social','sm-enrollment','sm-events'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById('sm-' + tab)?.classList.add('active');

  if (tab === 'campaigns')  renderCampaigns();
  if (tab === 'media')      renderMedia();
  if (tab === 'social')     renderSocial();
  if (tab === 'enrollment') renderEnrollment();
  if (tab === 'events')     renderEvents();
}

function setIntelTab(tab, el) {
  ['stab-meetings','stab-ai','stab-monthly'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  el.classList.add('active');

  ['si-meetings','si-ai','si-monthly'].forEach(id => {
    document.getElementById(id)?.classList.remove('active');
  });
  document.getElementById('si-' + tab)?.classList.add('active');

  if (tab === 'meetings') renderMeetings();
  if (tab === 'ai')       renderAIActions();
  if (tab === 'monthly')  renderMonthlyReview();
}

// ─── FILTER HELPERS ───────────────────────────────────────────────────────────
function setTF(status, el) {
  taskFilterStatus = status;
  document.querySelectorAll('[data-tf]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  renderTasks();
}

function setCF(status, el) {
  campaignFilter = status;
  document.querySelectorAll('[data-cf]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  renderCampaigns();
}

function setPF(filter, el) {
  peopleFilter = filter;
  document.querySelectorAll('[data-pf]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  renderPeople();
}

function setDashView(view, el) {
  currentDashView = view;
  document.getElementById('vteam').className = view === 'team'
    ? 'btn btn-sm btn-primary'
    : 'btn btn-sm';
  document.getElementById('vmy').className = view === 'my'
    ? 'btn btn-sm btn-primary'
    : 'btn btn-sm';
  document.getElementById('vteam').style.background = view === 'team' ? '' : 'transparent';
  document.getElementById('vmy').style.background   = view === 'my'   ? '' : 'transparent';
  document.getElementById('vteam').style.color = view === 'team' ? '' : 'var(--cs)';
  document.getElementById('vmy').style.color   = view === 'my'   ? '' : 'var(--cs)';
  renderDashboard();
}

function toggleCalFilter(type, el) {
  calFilters[type] = !calFilters[type];
  el.classList.toggle('on', calFilters[type]);
  renderCalendar();
}

function setPoolTab(tab, el) {
  mediaPoolTab = tab;
  document.querySelectorAll('[data-pt]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('media-shoots-wrap').style.display = tab === 'shoots' ? '' : 'none';
  document.getElementById('media-pool-wrap').style.display   = tab === 'pool'   ? '' : 'none';
  renderMedia();
}

function setPoolFilter(filter, el) {
  mediaPoolFilter = filter;
  document.querySelectorAll('[data-pw]').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  renderMedia();
}

function filterTasks()      { renderTasks(); }
function filterCampaigns()  { renderCampaigns(); }
function filterPeople()     { renderPeople(); }
function filterSocial()     { renderSocial(); }
function filterEnrollment() { renderEnrollment(); }
function filterEvents()     { renderEvents(); }

// ─── UTILS ────────────────────────────────────────────────────────────────────
function pill(status) {
  const s = (status || '').toLowerCase().replace(/[ _]/g, '');
  const map = {
    inprogress: 'ip', in_progress: 'ip',
    inreview: 'ir',   in_review:  'ir',
  };
  const cls = map[s] || s;
  const labels = {
    todo:'To Do', ip:'In Progress', ir:'In Review', done:'Done', blocked:'Blocked',
    active:'Active', draft:'Draft', completed:'Completed', paused:'Paused',
    low:'Low', medium:'Medium', high:'High', critical:'Critical',
    approved:'Approved', pending:'Pending', rejected:'Rejected', cancelled:'Cancelled',
    annual:'Annual', sick:'Sick', emergency:'Emergency', maternity:'Maternity', unpaid:'Unpaid',
    leave:'Leave', mission:'Mission', dayoff:'Day Off',
    scheduled:'Scheduled', wrapped:'Wrapped',
  };
  return `<span class="pill p-${cls}">${labels[cls] || status}</span>`;
}

function av(name, size='') {
  const initials = (name || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const bg = stringToColor(name);
  return `<span class="av${size ? ' av-'+size : ''}" style="background:${bg}">${initials}</span>`;
}

function stringToColor(str) {
  let h = 0;
  for (const c of (str || '')) h = ((h << 5) - h) + c.charCodeAt(0);
  return `hsl(${Math.abs(h) % 360},55%,48%)`;
}

function fmtDate(d, opts) {
  if (!d) return '—';
  try {
    return new Date(d + (String(d).length === 10 ? 'T00:00:00' : ''))
      .toLocaleDateString('en', opts || { month:'short', day:'numeric' });
  } catch(e) { return d; }
}

function daysUntil(d) {
  if (!d) return null;
  const today = new Date(); today.setHours(0,0,0,0);
  return Math.ceil((new Date(d + 'T00:00:00') - today) / 86400000);
}

function deptColor(slug) {
  const d = DB.Departments.find(d => d.slug === slug || d.name === slug);
  return d?.color || '#64748B';
}

function deptName(slug) {
  const d = DB.Departments.find(d => d.slug === slug);
  return d?.name || slug || '—';
}

function truncate(s, n = 40) {
  return (s || '').length > n ? (s || '').slice(0, n) + '…' : s || '—';
}

function isOverdue(due) {
  if (!due) return false;
  return new Date(due + 'T00:00:00') < new Date(new Date().toDateString());
}

function delBtn(sheet, id) {
  return `<button class="btn btn-sm btn-outline" style="color:var(--red);border-color:var(--red);flex-shrink:0" onclick="event.stopPropagation();confirmDelete('${sheet}','${id}')">🗑</button>`;
}

function statusColor(s) {
  return { todo:'#64748B', in_progress:'#3B82F6', in_review:'#F59E0B', done:'#22C55E', blocked:'#EF4444' }[s] || '#64748B';
}

function emptyState(msg) {
  return `<div style="padding:48px;text-align:center;color:var(--ct);font-size:13px">${msg}</div>`;
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function renderDashboard() {
  // KPIs
  const activeTasks     = DB.Tasks.filter(t => t.status !== 'done' && t.status !== 'blocked').length;
  const doneTasks       = DB.Tasks.filter(t => t.status === 'done').length;
  const activeCampaigns = DB.Campaigns.filter(c => c.status === 'active').length;
  const pendingPeople   = [...DB.Leave_Requests, ...DB.Missions, ...DB.Comp_Days].filter(r => r.status === 'pending').length;
  const upcomingEvents  = DB.Events.filter(e => { const d = daysUntil(e.date); return d !== null && d >= 0 && d <= 14; }).length;
  const overdueTasks    = DB.Tasks.filter(t => t.status !== 'done' && isOverdue(t.due_date)).length;
  const totalTasks      = DB.Tasks.length;
  const pct             = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const kpiEl = document.getElementById('dash-kpis');
  if (kpiEl) kpiEl.innerHTML = [
    { icon:'📋', label:'Open Tasks',       val:activeTasks,       sub: overdueTasks ? `⚠️ ${overdueTasks} overdue` : `${pct}% complete`,   color:'#3B82F6' },
    { icon:'🚀', label:'Active Campaigns', val:activeCampaigns,   sub:`of ${DB.Campaigns.length} total`,                                    color:'#A855F7' },
    { icon:'🕐', label:'Pending Requests', val:pendingPeople,     sub:'leave / missions / comp',                                            color:'#F59E0B' },
    { icon:'📅', label:'Upcoming Events',  val:upcomingEvents,    sub:'next 14 days',                                                       color:'#22C55E' },
    { icon:'👥', label:'Team Members',     val:DB.Members.length, sub:'registered',                                                         color:'#EC4899' },
    { icon:'💬', label:'Meetings Logged',  val:DB.Meetings.length,sub:`${DB.Meeting_Actions.filter(a=>!a.pushed||a.pushed==='false').length} pending actions`, color:'#64748B' },
  ].map(k => `
    <div class="kpi" style="border-top:3px solid ${k.color}">
      <div class="kpi-icon">${k.icon}</div>
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-val" style="color:${k.color}">${k.val}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');

  // Open tasks
  const priorityOrder = { critical:0, high:1, medium:2, low:3 };
  const tasks = DB.Tasks
    .filter(t => t.status !== 'done')
    .sort((a,b) => (priorityOrder[a.priority]||2)-(priorityOrder[b.priority]||2) || (a.due_date||'9').localeCompare(b.due_date||'9'))
    .slice(0, 6);

  const dashTasks = document.getElementById('dash-tasks');
  if (dashTasks) dashTasks.innerHTML = tasks.length
    ? tasks.map(t => {
        const sub = DB.Subtasks.filter(s => s.task_id === t.id);
        const done = sub.filter(s => s.done === 'true' || s.done === true).length;
        return `
          <div class="task-row" onclick="nav('planner')">
            <div class="tcheck ${t.status==='done'?'done':''}"></div>
            <div class="tdept" style="background:${deptColor(t.department)}"></div>
            <div class="ttitle ${t.status==='done'?'done':''}" style="flex:1">${truncate(t.title,44)}</div>
            <div class="tmeta">
              ${sub.length ? `<span class="tsub-badge">${done}/${sub.length}</span>` : ''}
              ${t.due_date ? `<span class="tdue ${isOverdue(t.due_date)?'over':''}">${fmtDate(t.due_date)}</span>` : ''}
              ${pill(t.priority)}
            </div>
          </div>`;
      }).join('')
    : '<div style="color:var(--ct);font-size:13px;padding:24px 0;text-align:center">🎉 All tasks complete!</div>';

  // Upcoming events
  const events = DB.Events.filter(e => daysUntil(e.date) >= 0)
    .sort((a,b) => (a.date||'').localeCompare(b.date||'')).slice(0, 4);
  const dashEvents = document.getElementById('dash-events');
  if (dashEvents) dashEvents.innerHTML = events.length
    ? events.map(e => {
        const d   = daysUntil(e.date);
        const tag = d === 0
          ? '<span style="font-size:9px;font-weight:700;color:var(--red);background:var(--red-soft);padding:1px 6px;border-radius:6px">TODAY</span>'
          : d === 1
          ? '<span style="font-size:9px;color:var(--amber);font-weight:700">Tomorrow</span>'
          : `<span style="font-size:9px;color:var(--ct)">in ${d}d</span>`;
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-s)">
            <div style="text-align:center;min-width:36px">
              <div style="font-size:18px;font-weight:800;color:var(--accent);line-height:1">${new Date(e.date+'T00:00:00').getDate()}</div>
              <div style="font-size:9px;color:var(--ct);text-transform:uppercase">${fmtDate(e.date,{month:'short'})}</div>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600">${truncate(e.title,35)}</div>
              <div style="font-size:11px;color:var(--ct)">${e.campus||''} ${e.time||''}</div>
            </div>
            ${tag}
          </div>`;
      }).join('')
    : '<div style="color:var(--ct);font-size:13px;padding:16px 0;text-align:center">No upcoming events</div>';

  // Active campaigns
  const camps = DB.Campaigns.filter(c => c.status === 'active').slice(0, 4);
  const dashCamps = document.getElementById('dash-campaigns');
  if (dashCamps) dashCamps.innerHTML = camps.length
    ? camps.map(c => {
        const dEnd = daysUntil(c.end_date);
        const endTag = dEnd !== null
          ? (dEnd < 0 ? '<span style="font-size:9px;color:var(--red)">Ended</span>'
          : dEnd === 0 ? '<span style="font-size:9px;color:var(--red)">Ends today</span>'
          : `<span style="font-size:9px;color:var(--ct)">ends in ${dEnd}d</span>`)
          : '';
        return `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-s)">
            <div style="width:10px;height:10px;border-radius:50%;background:${deptColor(c.department)};flex-shrink:0"></div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:600">${truncate(c.title,35)}</div>
              <div style="font-size:11px;color:var(--ct)">${deptName(c.department)}</div>
            </div>
            ${endTag}
          </div>`;
      }).join('')
    : '<div style="color:var(--ct);font-size:13px;padding:16px 0;text-align:center">No active campaigns</div>';
}

// ─── PLANNER ──────────────────────────────────────────────────────────────────
function renderPlanner() {
  // Render whichever tab is currently active
  const calTab  = document.getElementById('sc-calendar');
  const taskTab = document.getElementById('sc-tasks');
  const medTab  = document.getElementById('sc-media-cal');
  if (calTab?.classList.contains('active'))  renderCalendar();
  if (taskTab?.classList.contains('active')) renderTasks();
  if (medTab?.classList.contains('active'))  renderMediaCal();
}

// ─── CALENDAR ─────────────────────────────────────────────────────────────────
function renderCalendar() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const titleEl = document.getElementById('cal-title');
  if (titleEl) titleEl.textContent = calDate.toLocaleDateString('en', { month:'long', year:'numeric' });

  const firstDay    = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon start
  const today       = new Date();

  // Build event list respecting filters
  const allEvents = [
    ...DB.Events.map(e => ({ ...e, _type:'event', _color:'#64748B' })),
    ...DB.Tasks.filter(t => t.due_date).map(t => ({ id:t.id, title:t.title, date:t.due_date, _type:'task', _color:'#3B82F6' })),
    ...DB.Shoots.map(s => ({ ...s, _type:'shoot', _color:'#EC4899' })),
    ...(calFilters.leave    ? DB.Leave_Requests.map(r => ({...r, date:r.start_date, _type:'leave',   _color:'#22C55E', title:(r.member_name||'?')+' - Leave' })) : []),
    ...(calFilters.mission  ? DB.Missions.map(r => ({...r, date:r.mission_date,     _type:'mission', _color:'#F59E0B', title:(r.member_name||'?')+' - '+r.title })) : []),
    ...(calFilters.dayoff   ? DB.Comp_Days.map(r => ({...r, date:r.comp_date,       _type:'dayoff',  _color:'#3B82F6', title:(r.member_name||'?')+' - Day Off' })) : []),
  ];

  let html = '';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => {
    html += `<div class="cal-lbl">${d}</div>`;
  });

  for (let i = 0; i < startOffset; i++) html += '<div class="cal-cell other"></div>';

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr  = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday  = new Date(y, m, day).toDateString() === today.toDateString();
    const dayEvs   = allEvents.filter(e => e.date === dateStr);

    html += `<div class="cal-cell ${isToday?'today':''}" onclick="showCalDay('${dateStr}')">
      <span class="cal-d">${day}</span>
      ${dayEvs.slice(0,3).map(e =>
        `<div class="cal-ev" style="background:${e._color}22;border-left-color:${e._color};color:${e._color}">${truncate(e.title,18)}</div>`
      ).join('')}
      ${dayEvs.length > 3 ? `<div class="cal-more">+${dayEvs.length-3} more</div>` : ''}
    </div>`;
  }

  const gridEl = document.getElementById('cal-grid');
  if (gridEl) gridEl.innerHTML = html;
}

function calPrev()  { calDate.setMonth(calDate.getMonth()-1); renderCalendar(); }
function calNext()  { calDate.setMonth(calDate.getMonth()+1); renderCalendar(); }
function calToday() { calDate = new Date(); renderCalendar(); }

function showCalDay(dateStr) {
  const items = [
    ...DB.Events.filter(e=>e.date===dateStr).map(e=>({...e,_color:'#64748B',_type:'Event'})),
    ...DB.Tasks.filter(t=>t.due_date===dateStr).map(t=>({...t,_color:'#3B82F6',_type:'Task'})),
    ...DB.Shoots.filter(s=>s.date===dateStr).map(s=>({...s,_color:'#EC4899',_type:'Shoot'})),
    ...DB.Leave_Requests.filter(r=>r.start_date===dateStr).map(r=>({...r,_color:'#22C55E',_type:'Leave',title:(r.member_name||'?')+' - Leave'})),
    ...DB.Missions.filter(r=>r.mission_date===dateStr).map(r=>({...r,_color:'#F59E0B',_type:'Mission'})),
  ];
  const detail = document.getElementById('cal-day-detail');
  if (!detail) return;
  if (!items.length) { detail.style.display='none'; return; }
  detail.style.display='block';
  detail.innerHTML = `<div class="card">
    <div class="card-hd"><span class="card-title">📅 ${fmtDate(dateStr,{weekday:'long',month:'long',day:'numeric'})}</span></div>
    <div class="card-body">
      ${items.map(e=>`
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-s)">
          <div style="width:8px;height:8px;border-radius:50%;background:${e._color};flex-shrink:0"></div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${e.title}</div>
            <div style="font-size:11px;color:var(--ct)">${e._type} · ${e.time||e.campus||e.assignee_name||''}</div>
          </div>
        </div>`).join('')}
    </div>
  </div>`;
}

// ─── TASKS ────────────────────────────────────────────────────────────────────
function renderTasks() {
  // Dept dropdown
  const deptSel = document.getElementById('task-dept');
  if (deptSel && DB.Departments.length) {
    deptSel.innerHTML = '<option value="">All Departments</option>' +
      DB.Departments.map(d => `<option value="${d.slug}" ${taskFilterDept===d.slug?'selected':''}>${d.name}</option>`).join('');
  }

  const search = (document.getElementById('task-search')?.value || '').toLowerCase();
  const tasks  = DB.Tasks.filter(t => {
    if (taskFilterStatus !== 'all' && t.status !== taskFilterStatus) return false;
    if (taskFilterDept   && t.department !== taskFilterDept)          return false;
    if (search && !t.title.toLowerCase().includes(search) && !(t.assignee_name||'').toLowerCase().includes(search)) return false;
    return true;
  });

  const open  = DB.Tasks.filter(t => t.status !== 'done').length;
  const total = DB.Tasks.length;
  const subEl = document.getElementById('tasks-sub');
  if (subEl) subEl.textContent = `${open} open · ${total} total`;

  // Badge
  const badge = document.getElementById('badge-tasks');
  if (badge) { badge.textContent = open; badge.style.display = open ? 'inline' : 'none'; }

  const listEl = document.getElementById('tasks-list');
  if (!listEl) return;

  if (taskFilterStatus !== 'all') {
    listEl.innerHTML = tasks.length ? tasks.map(taskRowHTML).join('') : emptyState('No tasks found');
    return;
  }

  const order  = ['todo','in_progress','in_review','blocked','done'];
  const labels = { todo:'To Do', in_progress:'In Progress', in_review:'In Review', blocked:'Blocked', done:'Done' };
  const groups = {};
  order.forEach(s => { groups[s] = []; });
  tasks.forEach(t => { const s = t.status||'todo'; (groups[s] = groups[s]||[]).push(t); });

  listEl.innerHTML = order.map(s => {
    if (!groups[s].length) return '';
    return `<div class="task-section-hd">
      <span style="color:${statusColor(s)}">${labels[s]}</span>
      <span class="tcount">${groups[s].length}</span>
    </div>` + groups[s].map(taskRowHTML).join('');
  }).join('') || emptyState('No tasks found');
}

function taskRowHTML(t) {
  const sub     = DB.Subtasks.filter(s => s.task_id === t.id);
  const subDone = sub.filter(s => s.done==='true'||s.done===true).length;
  const isExp   = expandedTasks.has(t.id);
  const due     = t.due_date ? daysUntil(t.due_date) : null;
  const dueHTML = due === null ? ''
    : due === 0  ? '<span class="tdue over">Today</span>'
    : due < 0    ? `<span class="tdue over">${Math.abs(due)}d over</span>`
    : `<span class="tdue">${fmtDate(t.due_date)}</span>`;
  const hasMtg = t.meeting_id || t.meeting_source;

  const chevPts = isExp ? '18 15 12 9 6 15' : '6 9 12 15 18 9';
  const expandBtn = `<div class="texpand" onclick="event.stopPropagation();toggleTaskExpand('${t.id}')">
    <svg viewBox="0 0 24 24"><polyline points="${chevPts}"/></svg>
  </div>`;

  const subSection = isExp ? subtaskSectionHTML(t.id, sub) : '';

  return `<div class="task-item ${isExp?'expanded':''}">
    <div class="task-row" onclick="openEdit('Tasks','${t.id}')">
      ${expandBtn}
      <div class="tcheck ${t.status==='done'?'done':''}" onclick="event.stopPropagation();toggleTaskDone('${t.id}')">
        ${t.status==='done'?'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" style="width:8px;height:8px"><polyline points="20 6 9 17 4 12"/></svg>':''}
      </div>
      <div class="tdept" style="background:${deptColor(t.department)}"></div>
      <div style="flex:1;min-width:0">
        <div class="ttitle ${t.status==='done'?'done':''}">${t.title}</div>
        ${hasMtg ? `<div class="tmtg-badge">📋 ${truncate(t.meeting_source||'Meeting',25)}</div>` : ''}
      </div>
      <div class="tmeta">
        ${sub.length ? `<span class="tsub-badge">${subDone}/${sub.length}${isExp?'':' sub'}</span>` : ''}
        ${dueHTML}
        ${t.assignee_name ? av(t.assignee_name,'sm') : ''}
        ${pill(t.priority)}
        ${delBtn('Tasks', t.id)}
      </div>
    </div>
    ${subSection}
  </div>`;
}

// ─── SUBTASK INLINE SECTION ──────────────────────────────────────────────────
function subtaskSectionHTML(taskId, subtasks) {
  const rows = subtasks.map(s => {
    const done = s.done === 'true' || s.done === true;
    return `<div class="sub-row">
      <div class="sub-ck ${done?'chk-done':''}" onclick="event.stopPropagation();toggleSubtaskDone('${s.id}','${taskId}')">
        ${done ? '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" style="width:7px;height:7px"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </div>
      <span class="sub-ttl ${done?'done':''}" title="${esc(s.title)}">${esc(s.title)}</span>
      ${s.assignee_name ? `<span class="sub-who">${esc(s.assignee_name.split(' ')[0])}</span>` : ''}
      ${s.due_date ? `<span class="sub-due">${fmtDate(s.due_date)}</span>` : ''}
      <button class="sub-del" onclick="event.stopPropagation();deleteSubtask('${s.id}','${taskId}')">×</button>
    </div>`;
  }).join('');

  return `<div class="subtask-sec" onclick="event.stopPropagation()">
    ${rows}
    <div class="sub-row sub-add">
      <div class="sub-ck add-ck"></div>
      <input class="sub-inp" id="sub-inp-${taskId}" placeholder="+ Add subtask…"
        onkeydown="if(event.key==='Enter')addSubtaskInline('${taskId}',this)"
        onclick="event.stopPropagation()"/>
    </div>
  </div>`;
}

function toggleTaskExpand(id) {
  if (expandedTasks.has(id)) expandedTasks.delete(id);
  else expandedTasks.add(id);
  renderTasks();
}

async function addSubtaskInline(taskId, inputEl) {
  const title = (inputEl.value || '').trim();
  if (!title) return;
  const pos = DB.Subtasks.filter(s => s.task_id === taskId).length;
  await dbAppend('Subtasks', { task_id: taskId, title, done: 'false', position: String(pos) });
  // dbAppend → renderAll → keeps task expanded (expandedTasks persists)
}

async function toggleSubtaskDone(subId, taskId) {
  const s = DB.Subtasks.find(x => x.id === subId);
  if (!s) return;
  const isDone = s.done === 'true' || s.done === true;
  await dbUpdate('Subtasks', subId, { done: isDone ? 'false' : 'true' });
}

async function deleteSubtask(subId, taskId) {
  await dbDelete('Subtasks', subId);
}

async function toggleTaskDone(id) {
  const t = DB.Tasks.find(r => r.id === id);
  if (!t) return;
  const next = t.status === 'done' ? 'todo' : 'done';
  await dbUpdate('Tasks', id, { status: next });
  toast(next === 'done' ? '✓ Task completed' : 'Task reopened', 'success');
}

// ─── MEDIA CALENDAR ───────────────────────────────────────────────────────────
function renderMediaCal() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  const daysInMonth = new Date(y, m+1, 0).getDate();
  const firstDay    = new Date(y, m, 1).getDay();
  const startOffset = (firstDay + 6) % 7;

  let html = '<div class="cal-grid" style="margin-top:12px">';
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d => { html += `<div class="cal-lbl">${d}</div>`; });
  for (let i=0; i<startOffset; i++) html += '<div class="cal-cell other"></div>';
  const today = new Date();
  for (let day=1; day<=daysInMonth; day++) {
    const dateStr = `${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isToday = new Date(y,m,day).toDateString()===today.toDateString();
    const shoots  = DB.Shoots.filter(s=>s.date===dateStr);
    html += `<div class="cal-cell ${isToday?'today':''}">
      <span class="cal-d">${day}</span>
      ${shoots.map(s=>`<div class="cal-ev" style="background:#EC489920;border-left-color:#EC4899;color:#EC4899">🎬 ${truncate(s.title,14)}</div>`).join('')}
    </div>`;
  }
  html += '</div>';
  const el = document.getElementById('media-cal-grid');
  if (el) el.innerHTML = html;
}

// ─── MARKETING ────────────────────────────────────────────────────────────────
function renderMarketing() {
  const campTab = document.getElementById('sm-campaigns');
  const medTab  = document.getElementById('sm-media');
  const socTab  = document.getElementById('sm-social');
  const enTab   = document.getElementById('sm-enrollment');
  const evTab   = document.getElementById('sm-events');
  if (campTab?.classList.contains('active')) renderCampaigns();
  if (medTab?.classList.contains('active'))  renderMedia();
  if (socTab?.classList.contains('active'))  renderSocial();
  if (enTab?.classList.contains('active'))   renderEnrollment();
  if (evTab?.classList.contains('active'))   renderEvents();
}

// ─── CAMPAIGNS ────────────────────────────────────────────────────────────────
function renderCampaigns() {
  const search = (document.getElementById('camp-search')?.value || '').toLowerCase();
  const camps  = DB.Campaigns.filter(c => {
    if (campaignFilter !== 'all' && c.status !== campaignFilter) return false;
    if (search && !c.title.toLowerCase().includes(search)) return false;
    return true;
  });

  const subEl = document.getElementById('camps-sub');
  if (subEl) subEl.textContent = `${DB.Campaigns.filter(c=>c.status==='active').length} active · ${DB.Campaigns.length} total`;

  const listEl = document.getElementById('camps-list');
  if (!listEl) return;
  listEl.innerHTML = camps.length
    ? camps.map(c => `
      <div class="camp-card" onclick="openEdit('Campaigns','${c.id}')">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          ${pill(c.status)}
          ${delBtn('Campaigns', c.id)}
        </div>
        <div class="camp-name">${c.title}</div>
        <div class="camp-dept">${deptName(c.department)} · ${c.campus||'All Campuses'}</div>
        ${c.description ? `<div style="font-size:12px;color:var(--cs);margin:6px 0">${truncate(c.description,80)}</div>` : ''}
        <div class="camp-dates">
          📅 ${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}
          ${c.budget ? `<span style="margin-left:auto;font-weight:700;color:var(--accent)">$${Number(c.budget).toLocaleString()}</span>` : ''}
        </div>
      </div>`).join('')
    : emptyState('No campaigns found');
}

// ─── MEDIA ────────────────────────────────────────────────────────────────────
function renderMedia() {
  // Shoots
  const shootsEl = document.getElementById('shoots-body');
  if (shootsEl) shootsEl.innerHTML = DB.Shoots.length
    ? DB.Shoots.map(s => `<tr onclick="openEdit('Shoots','${s.id}')">
        <td style="font-weight:600">${s.title}</td>
        <td>${fmtDate(s.date)}</td>
        <td>${s.campus||'—'}</td>
        <td>${s.director||'—'}</td>
        <td>${pill(s.status||'scheduled')}</td>
        <td>${delBtn('Shoots',s.id)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="t-empty">No shoots scheduled</td></tr>';

  // Pool
  const poolEl = document.getElementById('pool-body');
  if (poolEl) {
    const assets = DB.Media_Assets.filter(a => {
      if (a.status==='posted'||a.status==='archived') return false;
      if (mediaPoolFilter !== 'all' && a.status !== mediaPoolFilter) return false;
      return true;
    });
    poolEl.innerHTML = assets.length
      ? assets.map(a => {
          const days = a.created_at ? Math.floor((Date.now()-new Date(a.created_at))/86400000) : 0;
          const ageStyle = days>14 ? 'color:var(--red)' : days>7 ? 'color:var(--amber)' : '';
          return `<tr onclick="openEdit('Media_Assets','${a.id}')">
            <td style="font-weight:600">${a.title}</td>
            <td>${a.type||'—'}</td>
            <td>${a.campus||'—'}</td>
            <td>${a.platform||'—'}</td>
            <td>${pill(a.status)}</td>
            <td style="${ageStyle}">${days}d</td>
            <td>${delBtn('Media_Assets',a.id)}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="7" class="t-empty">Content pool is empty</td></tr>';
  }
}

// ─── SOCIAL ───────────────────────────────────────────────────────────────────
const PLAT_ICONS = { facebook:'📘', instagram:'📸', tiktok:'🎵', youtube:'▶️', linkedin:'💼' };

function renderSocial() {
  const platform = document.getElementById('soc-plat')?.value || '';
  const period   = document.getElementById('soc-period')?.value || '';
  const metrics  = DB.Social_Metrics.filter(m => {
    if (platform && m.platform !== platform) return false;
    if (period   && m.period_type !== period) return false;
    return true;
  }).sort((a,b) => (b.period_start||'').localeCompare(a.period_start||''));

  // Summary cards
  const summaryEl = document.getElementById('soc-summary');
  if (summaryEl) {
    summaryEl.innerHTML = ['facebook','instagram','tiktok','youtube'].map(p => {
      const latest = DB.Social_Metrics
        .filter(m=>m.platform===p)
        .sort((a,b)=>(b.period_start||'').localeCompare(a.period_start||''))[0];
      return `<div class="soc-card">
        <div style="font-size:20px;margin-bottom:4px">${PLAT_ICONS[p]||'📊'}</div>
        <div class="kpi-label" style="text-transform:capitalize">${p}</div>
        <div class="soc-reach">${latest ? Number(latest.reach||0).toLocaleString() : '—'}</div>
        <div class="soc-sub">${latest ? `${latest.engagement_rate||0}% eng · +${Number(latest.followers_gained||0).toLocaleString()} flw` : 'No data'}</div>
      </div>`;
    }).join('');
  }

  const bodyEl = document.getElementById('soc-body');
  if (bodyEl) bodyEl.innerHTML = metrics.length
    ? metrics.map(m => `<tr onclick="openEdit('Social_Metrics','${m.id}')">
        <td><span style="font-weight:700">${PLAT_ICONS[m.platform]||'📊'} ${m.platform}</span></td>
        <td style="font-size:11px">${fmtDate(m.period_start)} – ${fmtDate(m.period_end)}</td>
        <td style="font-weight:600">${Number(m.reach||0).toLocaleString()}</td>
        <td>${Number(m.impressions||0).toLocaleString()}</td>
        <td>${m.engagement_rate||0}%</td>
        <td style="color:var(--green)">+${Number(m.followers_gained||0).toLocaleString()}</td>
        <td>${m.posts_count||0}</td>
        <td>${delBtn('Social_Metrics',m.id)}</td>
      </tr>`).join('')
    : '<tr><td colspan="8" class="t-empty">No metrics yet — add your first entry above</td></tr>';
}

// ─── ENROLLMENT ───────────────────────────────────────────────────────────────
function renderEnrollment() {
  const campus = document.getElementById('en-campus')?.value || '';
  const year   = document.getElementById('en-year')?.value   || '';

  // Populate years
  const yearSel = document.getElementById('en-year');
  if (yearSel && yearSel.options.length <= 1) {
    const years = [...new Set(DB.Enrollment.map(e=>e.year))].sort().reverse();
    years.forEach(y => yearSel.appendChild(Object.assign(document.createElement('option'),{value:y,textContent:y})));
  }

  const rows = DB.Enrollment.filter(e => {
    if (campus && e.campus !== campus) return false;
    if (year   && String(e.year) !== year) return false;
    return true;
  }).sort((a,b) => `${b.year}${String(b.month).padStart(2,'0')}`.localeCompare(`${a.year}${String(a.month).padStart(2,'0')}`));

  const bodyEl = document.getElementById('en-body');
  if (bodyEl) bodyEl.innerHTML = rows.length
    ? rows.map(e => {
        const conv = e.leads ? ((e.enrolled/e.leads)*100).toFixed(1)+'%' : e.conversion_rate||'—';
        return `<tr onclick="openEdit('Enrollment','${e.id}')">
          <td>${e.campus}</td>
          <td>${new Date(2000,(e.month||1)-1).toLocaleString('en',{month:'short'})}</td>
          <td>${e.year}</td>
          <td style="font-weight:700">${e.leads||0}</td>
          <td style="font-weight:700;color:var(--green)">${e.enrolled||0}</td>
          <td>${conv}</td>
          <td style="font-size:11px;color:var(--ct)">${truncate(e.notes||'',40)}</td>
          <td>${delBtn('Enrollment',e.id)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="8" class="t-empty">No enrollment data</td></tr>';
}

// ─── EVENTS ───────────────────────────────────────────────────────────────────
function renderEvents() {
  const campus = document.getElementById('ev-campus')?.value || '';
  const events = DB.Events.filter(e => {
    if (campus && e.campus !== campus) return false;
    return true;
  }).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const bodyEl = document.getElementById('ev-body');
  if (bodyEl) bodyEl.innerHTML = events.length
    ? events.map(e => `<tr onclick="openEdit('Events','${e.id}')">
        <td style="font-weight:600">${e.title}</td>
        <td>${fmtDate(e.date)}</td>
        <td>${e.time||'—'}</td>
        <td>${e.campus||'—'}</td>
        <td>${pill(e.status||'upcoming')}</td>
        <td>${delBtn('Events',e.id)}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="t-empty">No events found</td></tr>';
}

// ─── PEOPLE ───────────────────────────────────────────────────────────────────
function renderPeople() {
  const search = (document.getElementById('ppl-search')?.value || '').toLowerCase();
  const leave   = DB.Leave_Requests.map(d => ({ kind:'leave',   data:d }));
  const mission = DB.Missions.map(d => {
    const comp = DB.Comp_Days.find(c => c.mission_id === d.id);
    return { kind:'mission', data:d, comp };
  });
  const dayoff  = DB.Comp_Days.filter(c => !c.mission_id).map(d => ({ kind:'dayoff', data:d }));

  const rows = [...leave, ...mission, ...dayoff]
    .sort((a,b) => (b.data.created_at||'').localeCompare(a.data.created_at||''))
    .filter(r => {
      if (peopleFilter==='leave'   && r.kind!=='leave')   return false;
      if (peopleFilter==='mission' && r.kind!=='mission') return false;
      if (peopleFilter==='dayoff'  && r.kind!=='dayoff')  return false;
      if (peopleFilter==='approved'&& r.data.status!=='approved') return false;
      if (search && !(r.data.member_name||'').toLowerCase().includes(search)) return false;
      return true;
    });

  const bodyEl = document.getElementById('ppl-body');
  if (!bodyEl) return;
  bodyEl.innerHTML = rows.length
    ? rows.map(r => {
        const d  = r.data;
        const isL = r.kind==='leave', isD = r.kind==='dayoff', isM = r.kind==='mission';
        const dateStr = isL
          ? `${fmtDate(d.start_date)} – ${fmtDate(d.end_date)} <span style="color:var(--ct)">·${d.days_count||1}d</span>`
          : isD ? fmtDate(d.comp_date||d.created_at)
          : fmtDate(d.mission_date, {weekday:'short',month:'short',day:'numeric'});
        const details = isL
          ? pill(d.leave_type)
          : isD ? '<span style="font-size:12px;font-weight:600">Day Off (Comp)</span>'
          : `<span style="font-size:12px;font-weight:600">${truncate(d.title,30)}</span>`;
        const compCell = (!isL && !isD && d.status==='approved' && r.comp)
          ? compExpiryHTML(r.comp)
          : isD ? `<span style="font-size:11px;color:var(--ct)">${d.expires_at?'Exp: '+fmtDate(d.expires_at):'—'}</span>`
          : '<span style="color:var(--ct)">—</span>';
        const sheet = isL ? 'Leave_Requests' : isD ? 'Comp_Days' : 'Missions';

        return `<tr onclick="openEdit('${sheet}','${d.id}')">
          <td>${isL ? '<span class="pill p-leave">🌿 Leave</span>' : isD ? '<span class="pill p-dayoff">🌙 Day Off</span>' : '<span class="pill p-mission">⚡ Mission</span>'}</td>
          <td><div style="display:flex;align-items:center;gap:8px">${av(d.member_name)}<span>${d.member_name||'—'}</span></div></td>
          <td>${details}</td>
          <td style="font-size:12px;white-space:nowrap">${dateStr}</td>
          <td>${pill(d.status||'pending')}</td>
          <td>${compCell}</td>
          <td>${delBtn(sheet,d.id)}</td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="7" class="t-empty">No records found</td></tr>';
}

function compExpiryHTML(comp) {
  if (comp.comp_date) return '<span class="pill p-approved">✓ Scheduled</span>';
  if (comp.status==='expired') return '<span class="pill p-rejected">Expired</span>';
  if (!comp.expires_at) return '<span style="color:var(--ct)">—</span>';
  const d = daysUntil(comp.expires_at);
  const color = d<=7 ? '#EF4444' : d<=21 ? '#F59E0B' : '#22C55E';
  return `<span class="pill" style="background:${color}22;color:${color}">${d<=0?'Expired!':d+'d left'}</span>`;
}

// ─── INTEL ────────────────────────────────────────────────────────────────────
function renderIntel() {
  const mtgTab = document.getElementById('si-meetings');
  const aiTab  = document.getElementById('si-ai');
  const moTab  = document.getElementById('si-monthly');
  if (mtgTab?.classList.contains('active')) renderMeetings();
  if (aiTab?.classList.contains('active'))  renderAIActions();
  if (moTab?.classList.contains('active'))  renderMonthlyReview();
}

// ─── MEETINGS ─────────────────────────────────────────────────────────────────
function renderMeetings() {
  const meetings = [...DB.Meetings].sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const listEl   = document.getElementById('mtg-list');
  if (!listEl) return;

  listEl.innerHTML = meetings.length
    ? meetings.map(m => {
        const total  = DB.Meeting_Actions.filter(a=>a.meeting_id===m.id).length;
        const pushed = DB.Meeting_Actions.filter(a=>a.meeting_id===m.id&&(a.pushed==='true'||a.pushed===true)).length;
        return `
          <div class="mtg-row" id="mtg-row-${m.id}" onclick="showMeeting('${m.id}')">
            <div style="font-size:13px;font-weight:700;margin-bottom:2px">${m.title}</div>
            <div style="font-size:11px;color:var(--ct);display:flex;align-items:center;gap:6px">
              ${fmtDate(m.date,{month:'short',day:'numeric',year:'numeric'})}
              ${total ? `<span style="background:var(--bg-input);padding:1px 5px;border-radius:8px">${pushed}/${total} tasks</span>` : ''}
            </div>
          </div>`;
      }).join('')
    : '<div style="padding:16px;color:var(--ct);font-size:13px">No meetings logged</div>';
}

function showMeeting(id) {
  const m = DB.Meetings.find(x => x.id === id);
  if (!m) return;
  const actions    = DB.Meeting_Actions.filter(a => a.meeting_id === id);
  const pushed     = actions.filter(a => a.pushed==='true'||a.pushed===true);
  const unpushed   = actions.filter(a => !a.pushed || a.pushed==='false');
  const linkedTasks = DB.Tasks.filter(t => t.meeting_id === id);

  // Highlight in sidebar
  document.querySelectorAll('#mtg-list .mtg-row').forEach(el => el.classList.remove('sel'));
  document.getElementById('mtg-row-'+id)?.classList.add('sel');

  const detailEl = document.getElementById('mtg-detail');
  if (!detailEl) return;
  detailEl.innerHTML = `
    <div style="padding:24px">
      <div style="font-size:20px;font-weight:800;margin-bottom:4px">${m.title}</div>
      <div style="font-size:12px;color:var(--ct);margin-bottom:20px">
        ${fmtDate(m.date,{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
        ${m.attendees ? ' · ' + m.attendees : ''}
      </div>

      ${m.summary ? `
        <div style="margin-bottom:20px">
          <div style="font-size:11px;font-weight:700;color:var(--ct);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Summary</div>
          <div style="background:var(--bg-input);padding:14px;border-radius:10px;font-size:13px;line-height:1.7;color:var(--cs)">${m.summary}</div>
        </div>` : ''}

      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <div style="font-size:13px;font-weight:700">
          Action Items
          <span style="font-size:11px;color:var(--ct);font-weight:400">${pushed.length}/${actions.length} pushed</span>
        </div>
        ${unpushed.length > 1 ? `<button class="btn btn-sm btn-primary" onclick="pushAllActionItems('${id}')">Push All (${unpushed.length}) →</button>` : ''}
      </div>

      ${actions.length
        ? actions.map(a => {
            const isPushed = a.pushed==='true'||a.pushed===true;
            return `<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border-s)">
              <div style="margin-top:2px;width:16px;height:16px;border-radius:50%;border:2px solid ${isPushed?'var(--green)':'var(--border-d)'};background:${isPushed?'var(--green)':'transparent'};flex-shrink:0;display:flex;align-items:center;justify-content:center">
                ${isPushed?'<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" style="width:9px;height:9px"><polyline points="20 6 9 17 4 12"/></svg>':''}
              </div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;${isPushed?'text-decoration:line-through;color:var(--ct)':''}">${a.title}</div>
                <div style="font-size:11px;color:var(--ct);margin-top:2px">${a.assignee_name||'Unassigned'}${a.due_date?' · Due '+fmtDate(a.due_date):''}</div>
              </div>
              ${isPushed
                ? '<span class="pill p-done" style="flex-shrink:0">✓ In Tasks</span>'
                : `<button class="btn btn-sm btn-primary" style="flex-shrink:0" onclick="pushActionItem('${a.id}','${id}')">Push →</button>`}
            </div>`;
          }).join('')
        : '<div style="color:var(--ct);font-size:13px;padding:20px 0;text-align:center">No action items yet</div>'}

      ${linkedTasks.length ? `
        <div style="margin-top:24px">
          <div style="font-size:11px;font-weight:700;color:var(--ct);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Tasks From This Meeting (${linkedTasks.length})</div>
          ${linkedTasks.map(t=>`
            <div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border-s)">
              <div style="width:8px;height:8px;border-radius:50%;background:${t.status==='done'?'var(--green)':'var(--accent)'};flex-shrink:0"></div>
              <div style="flex:1;font-size:13px;${t.status==='done'?'text-decoration:line-through;color:var(--ct)':''}">${t.title}</div>
              ${pill(t.status)}
            </div>`).join('')}
        </div>` : ''}

      <div style="margin-top:20px;display:flex;gap:8px">
        <button class="btn btn-outline btn-sm" onclick="openEdit('Meetings','${id}')">✏️ Edit</button>
        ${delBtn('Meetings', id)}
      </div>
    </div>`;
}

async function pushAllActionItems(meetingId) {
  const unpushed = DB.Meeting_Actions.filter(a => a.meeting_id===meetingId && (!a.pushed||a.pushed==='false'));
  if (!unpushed.length) return toast('All items already pushed', 'info');
  toast(`Pushing ${unpushed.length} items…`, 'info');
  for (const a of unpushed) await pushActionItem(a.id, meetingId, true);
  toast(`${unpushed.length} tasks created ✓`, 'success');
  showMeeting(meetingId);
}

async function pushActionItem(actionId, meetingId, silent=false) {
  const a = DB.Meeting_Actions.find(x => x.id === actionId);
  if (!a || a.pushed==='true' || a.pushed===true) return;
  const m = DB.Meetings.find(x => x.id === meetingId);
  const task = await dbAppend('Tasks', {
    title: a.title, assignee_name: a.assignee_name||'', due_date: a.due_date||'',
    status: 'todo', priority: 'medium', meeting_id: meetingId,
    meeting_source: m?.title||'', department: 'social', tags: 'meeting-action',
  });
  await dbUpdate('Meeting_Actions', actionId, { pushed: 'true', task_id: task.id });
  if (!silent) { toast('Task created ✓', 'success'); showMeeting(meetingId); }
}

// ─── AI ACTIONS ───────────────────────────────────────────────────────────────
function renderAIActions() {
  const el = document.getElementById('ai-actions-list');
  if (!el) return;
  const unpushed = DB.Meeting_Actions.filter(a => !a.pushed || a.pushed==='false');
  if (!unpushed.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--ct);padding:40px 20px;font-size:13px">🎉 All action items have been pushed to tasks.</div>';
    return;
  }
  el.innerHTML = unpushed.map(a => {
    const m = DB.Meetings.find(x => x.id === a.meeting_id);
    return `<div style="display:flex;align-items:flex-start;gap:12px;padding:12px;background:var(--bg-card);border:1px solid var(--border-s);border-radius:10px;margin-bottom:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;margin-bottom:4px">${a.title}</div>
        <div style="font-size:11px;color:var(--ct)">
          ${a.assignee_name||'Unassigned'} ${a.due_date?'· Due '+fmtDate(a.due_date):''}
          ${m ? `<span style="margin-left:8px;color:var(--accent)">from: ${m.title}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-primary" onclick="pushActionItem('${a.id}','${a.meeting_id}')">Push →</button>
    </div>`;
  }).join('');
}

// ─── MONTHLY REVIEW ───────────────────────────────────────────────────────────
function renderMonthlyReview() {
  const el = document.getElementById('si-monthly-content');
  if (!el) return;

  // Group meetings by YYYY-MM
  const grouped = {};
  DB.Meetings.forEach(m => {
    const ym = (m.date || '').slice(0, 7);
    if (!ym) return;
    if (!grouped[ym]) grouped[ym] = [];
    grouped[ym].push(m);
  });

  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  if (!months.length) {
    el.innerHTML = '<div style="text-align:center;color:var(--ct);padding:40px 20px;font-size:13px">No meetings logged yet.</div>';
    return;
  }

  el.innerHTML = months.map(ym => {
    const mtgs    = grouped[ym];
    const actions = DB.Meeting_Actions.filter(a => mtgs.some(m => m.id === a.meeting_id));
    const pushed  = actions.filter(a => a.pushed === 'true' || a.pushed === true);
    const done    = DB.Tasks.filter(t => mtgs.some(m => m.id === t.meeting_id) && t.status === 'done').length;
    const isOpen  = expandedMonths.has(ym);
    const [y, mo] = ym.split('-');
    const label   = new Date(+y, +mo - 1).toLocaleString('en', { month: 'long', year: 'numeric' });
    const allPushed = actions.length && pushed.length === actions.length;

    return `<div class="month-group">
      <div class="month-hd" onclick="toggleMonthExpand('${ym}')">
        <span class="month-chev">${isOpen ? '▼' : '▶'}</span>
        <span class="month-label">${label}</span>
        <div class="month-stats">
          <span>${mtgs.length} meeting${mtgs.length !== 1 ? 's' : ''}</span>
          <span>${actions.length} action item${actions.length !== 1 ? 's' : ''}</span>
          <span style="color:${allPushed ? 'var(--green)' : 'var(--ct)'}">${pushed.length}/${actions.length} pushed</span>
          ${done ? `<span style="color:var(--green)">✓ ${done} tasks done</span>` : ''}
        </div>
      </div>
      ${isOpen ? `<div class="month-mtgs">
        ${mtgs.sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(m => {
          const macts   = DB.Meeting_Actions.filter(a => a.meeting_id === m.id);
          const mpushed = macts.filter(a => a.pushed === 'true' || a.pushed === true);
          const allDone = macts.length && mpushed.length === macts.length;
          return `<div class="month-mtg-row" onclick="goToMeeting('${m.id}')">
            <span class="month-mtg-icon">📋</span>
            <span class="month-mtg-title">${esc(m.title)}</span>
            <span class="month-mtg-date">${fmtDate(m.date, { month: 'short', day: 'numeric' })}</span>
            <span class="month-mtg-badge ${allDone ? 'all-pushed' : ''}">${mpushed.length}/${macts.length} tasks</span>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>`;
  }).join('');
}

function toggleMonthExpand(ym) {
  if (expandedMonths.has(ym)) expandedMonths.delete(ym);
  else expandedMonths.add(ym);
  renderMonthlyReview();
}

function goToMeeting(id) {
  // Switch to Meetings tab then show the selected meeting
  const stab = document.getElementById('stab-meetings');
  if (stab) setIntelTab('meetings', stab);
  setTimeout(() => showMeeting(id), 30);
}

// ─── TASK COMMENTS ────────────────────────────────────────────────────────────
function renderTaskCommentsHTML(taskId) {
  const comments = (DB.Task_Comments || [])
    .filter(c => c.task_id === taskId)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  if (!comments.length) return '<div style="color:var(--ct);font-size:12px;padding:6px 0 4px">No comments yet.</div>';
  return comments.map(c => `
    <div style="display:flex;gap:8px;margin-bottom:10px">
      ${av(c.author_name || '?', 'sm')}
      <div style="flex:1">
        <div style="font-size:11px;font-weight:600;margin-bottom:2px">${esc(c.author_name || 'Unknown')}
          <span style="font-weight:400;color:var(--ct);margin-left:6px">${c.created_at ? fmtDate(c.created_at.slice(0,10)) : ''}</span>
        </div>
        <div style="font-size:12px;color:var(--cs);line-height:1.5">${esc(c.body)}</div>
      </div>
    </div>`).join('');
}

async function addTaskComment(taskId) {
  const input = document.getElementById('new-comment-input');
  const body  = input?.value?.trim();
  if (!body) return;
  await dbAppend('Task_Comments', {
    task_id:     taskId,
    author_name: DB.Members[0]?.full_name || 'Me',
    body,
    created_at:  new Date().toISOString(),
  });
  const cl = document.getElementById('task-comments-list');
  if (cl) cl.innerHTML = renderTaskCommentsHTML(taskId);
  if (input) input.value = '';
}

// ─── ADMIN ────────────────────────────────────────────────────────────────────
function renderAdmin() {
  // Departments
  const deptsEl = document.getElementById('admin-depts');
  if (deptsEl) deptsEl.innerHTML = DB.Departments.length
    ? [...DB.Departments].sort((a,b)=>(a.position||0)-(b.position||0)).map(d => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px">
          <span style="width:12px;height:12px;border-radius:50%;background:${d.color};flex-shrink:0;display:inline-block"></span>
          <span style="font-size:13px;font-weight:600;flex:1">${d.name}</span>
          <span style="font-size:10px;color:var(--ct)">${d.slug}</span>
          <button class="btn btn-sm btn-outline" onclick="openEdit('Departments','${d.id}')">Edit</button>
          ${delBtn('Departments', d.id)}
        </div>`).join('')
    : '<div style="color:var(--ct);padding:16px;font-size:13px">No departments yet</div>';

  // Members
  const membersEl = document.getElementById('admin-members');
  if (membersEl) membersEl.innerHTML = DB.Members.length
    ? DB.Members.map(m => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px">
          ${av(m.full_name)}
          <div style="flex:1">
            <div style="font-size:13px;font-weight:600">${m.full_name}</div>
            <div style="font-size:11px;color:var(--ct)">${m.role||''} · ${m.department||''}</div>
          </div>
          <button class="btn btn-sm btn-outline" onclick="openEdit('Members','${m.id}')">Edit</button>
          ${delBtn('Members', m.id)}
        </div>`).join('')
    : '<div style="color:var(--ct);padding:16px;font-size:13px">No members yet</div>';

  // Settings URL
  const urlEl = document.getElementById('settings-url');
  if (urlEl && CONFIG.SCRIPT_URL) urlEl.value = CONFIG.SCRIPT_URL;
}

function saveSettings() {
  const url = document.getElementById('settings-url')?.value?.trim();
  if (!url) return toast('Enter the Apps Script URL', 'error');
  CONFIG.SCRIPT_URL = url;
  localStorage.setItem('ais_script_url', url);
  toast('Settings saved. Testing connection…', 'info');
  fetchFromSheets()
    .then(() => toast('Connection successful ✓', 'success'))
    .catch(() => toast('Connection failed', 'error'));
}

// ─── DRAWER ───────────────────────────────────────────────────────────────────
const FORMS = {
  Tasks: (item={}) => `
    <div class="fg"><label class="fl">Title *</label><input class="fi" name="title" value="${esc(item.title)}" placeholder="Task title…"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
        ${CONFIG.TASK_STATUSES.map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Priority</label><select class="fs" name="priority">
        ${CONFIG.PRIORITIES.map(p=>`<option value="${p}" ${item.priority===p?'selected':''}>${p}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Department</label><select class="fs" name="department">
        <option value="">— Select —</option>
        ${DB.Departments.map(d=>`<option value="${d.slug}" ${item.department===d.slug?'selected':''}>${d.name}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">All</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Assignee</label><select class="fs" name="assignee_name">
        <option value="">— Unassigned —</option>
        ${DB.Members.map(m=>`<option value="${m.full_name}" ${item.assignee_name===m.full_name?'selected':''}>${m.full_name}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Due Date</label><input class="fi" type="date" name="due_date" value="${item.due_date||''}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Recurrence</label><select class="fs" name="recurrence">
        ${['none','daily','weekly','monthly'].map(r=>`<option value="${r}" ${(item.recurrence||'none')===r?'selected':''}>${r.charAt(0).toUpperCase()+r.slice(1)}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Est. Hours</label><input class="fi" type="number" step="0.5" min="0" name="estimated_hours" value="${item.estimated_hours||''}" placeholder="e.g. 2.5"/></div>
    </div>
    <div class="fg"><label class="fl">Description</label><textarea class="fta" name="description">${esc(item.description)}</textarea></div>
    <div class="fg"><label class="fl">Tags</label><input class="fi" name="tags" value="${esc(item.tags)}" placeholder="design, urgent…"/></div>
    ${item.id ? `
    <div style="margin-top:16px;border-top:1px solid var(--border-s);padding-top:14px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--ct);margin-bottom:10px">Comments</div>
      <div id="task-comments-list">${renderTaskCommentsHTML(item.id)}</div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <input class="fi" id="new-comment-input" placeholder="Add a comment…" style="flex:1"
          onkeydown="if(event.key==='Enter')addTaskComment('${item.id}')"/>
        <button class="btn btn-sm btn-primary" onclick="addTaskComment('${item.id}')">Post</button>
      </div>
    </div>` : ''}`,

  Campaigns: (item={}) => `
    <div class="fg"><label class="fl">Campaign Name *</label><input class="fi" name="title" value="${esc(item.title)}" placeholder="Campaign name…"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
        ${['draft','active','completed','paused'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">All Campuses</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Department</label><select class="fs" name="department">
      <option value="">— Select —</option>
      ${DB.Departments.map(d=>`<option value="${d.slug}" ${item.department===d.slug?'selected':''}>${d.name}</option>`).join('')}
    </select></div>
    <div class="fr">
      <div class="fg"><label class="fl">Start Date</label><input class="fi" type="date" name="start_date" value="${item.start_date||''}"/></div>
      <div class="fg"><label class="fl">End Date</label><input class="fi" type="date" name="end_date" value="${item.end_date||''}"/></div>
    </div>
    <div class="fg"><label class="fl">Budget (USD)</label><input class="fi" type="number" name="budget" value="${item.budget||''}"/></div>
    <div class="fg"><label class="fl">Description</label><textarea class="fta" name="description">${esc(item.description)}</textarea></div>`,

  Leave_Requests: (item={}) => `
    <div class="fr">
      <div class="fg"><label class="fl">Member *</label><select class="fs" name="member_name">
        <option value="">— Select —</option>
        ${DB.Members.map(m=>`<option value="${m.full_name}" ${item.member_name===m.full_name?'selected':''}>${m.full_name}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Department</label><select class="fs" name="department">
        <option value="">—</option>
        ${DB.Departments.map(d=>`<option value="${d.slug}" ${item.department===d.slug?'selected':''}>${d.name}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Leave Type</label><select class="fs" name="leave_type">
      ${CONFIG.LEAVE_TYPES.map(t=>`<option value="${t}" ${item.leave_type===t?'selected':''}>${t}</option>`).join('')}
    </select></div>
    <div class="fr">
      <div class="fg"><label class="fl">Start Date *</label><input class="fi" type="date" name="start_date" value="${item.start_date||''}"/></div>
      <div class="fg"><label class="fl">End Date *</label><input class="fi" type="date" name="end_date" value="${item.end_date||''}"/></div>
    </div>
    <div class="fg"><label class="fl">Days Count</label><input class="fi" type="number" name="days_count" value="${item.days_count||1}" min="0.5" step="0.5"/></div>
    <div class="fg"><label class="fl">Reason</label><textarea class="fta" name="reason" rows="2">${esc(item.reason)}</textarea></div>
    <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
      ${['pending','approved','rejected','cancelled'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
    </select></div>`,

  Missions: (item={}) => `
    <div class="fr">
      <div class="fg"><label class="fl">Member *</label><select class="fs" name="member_name">
        <option value="">— Select —</option>
        ${DB.Members.map(m=>`<option value="${m.full_name}" ${item.member_name===m.full_name?'selected':''}>${m.full_name}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Department</label><select class="fs" name="department">
        <option value="">—</option>
        ${DB.Departments.map(d=>`<option value="${d.slug}" ${item.department===d.slug?'selected':''}>${d.name}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Mission Title *</label><input class="fi" name="title" value="${esc(item.title)}" placeholder="e.g. Open Day Coverage"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Date *</label><input class="fi" type="date" name="mission_date" value="${item.mission_date||''}"/></div>
      <div class="fg"><label class="fl">Location</label><input class="fi" name="location" value="${esc(item.location)}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Start Time</label><input class="fi" type="time" name="start_time" value="${item.start_time||''}"/></div>
      <div class="fg"><label class="fl">End Time</label><input class="fi" type="time" name="end_time" value="${item.end_time||''}"/></div>
    </div>
    <div class="fg"><label class="fl">Description</label><textarea class="fta" name="description" rows="2">${esc(item.description)}</textarea></div>
    <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
      ${['pending','approved','rejected'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
    </select></div>`,

  Comp_Days: (item={}) => `
    <div class="fr">
      <div class="fg"><label class="fl">Member *</label><select class="fs" name="member_name">
        <option value="">— Select —</option>
        ${DB.Members.map(m=>`<option value="${m.full_name}" ${item.member_name===m.full_name?'selected':''}>${m.full_name}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
        ${['pending','approved','scheduled','expired'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Comp Date (day off)</label><input class="fi" type="date" name="comp_date" value="${item.comp_date||''}"/></div>
      <div class="fg"><label class="fl">Expires At</label><input class="fi" type="date" name="expires_at" value="${item.expires_at||''}"/></div>
    </div>
    <div class="fg"><label class="fl">Notes</label><textarea class="fta" name="reason" rows="2">${esc(item.reason)}</textarea></div>`,

  Events: (item={}) => `
    <div class="fg"><label class="fl">Event Title *</label><input class="fi" name="title" value="${esc(item.title)}"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Date *</label><input class="fi" type="date" name="date" value="${item.date||''}"/></div>
      <div class="fg"><label class="fl">Time</label><input class="fi" type="time" name="time" value="${item.time||''}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">All</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
        ${['upcoming','ongoing','completed','cancelled'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Location</label><input class="fi" name="location" value="${esc(item.location)}"/></div>
    <div class="fg"><label class="fl">Description</label><textarea class="fta" name="description" rows="2">${esc(item.description)}</textarea></div>`,

  Shoots: (item={}) => `
    <div class="fg"><label class="fl">Shoot Title *</label><input class="fi" name="title" value="${esc(item.title)}"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Date *</label><input class="fi" type="date" name="date" value="${item.date||''}"/></div>
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">—</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Start Time</label><input class="fi" type="time" name="start_time" value="${item.start_time||''}"/></div>
      <div class="fg"><label class="fl">End Time</label><input class="fi" type="time" name="end_time" value="${item.end_time||''}"/></div>
    </div>
    <div class="fg"><label class="fl">Director</label><select class="fs" name="director">
      <option value="">— Select —</option>
      ${DB.Members.map(m=>`<option value="${m.full_name}" ${item.director===m.full_name?'selected':''}>${m.full_name}</option>`).join('')}
    </select></div>
    <div class="fg"><label class="fl">Location</label><input class="fi" name="location" value="${esc(item.location)}"/></div>
    <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
      ${['scheduled','in_progress','wrapped','cancelled'].map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${s}</option>`).join('')}
    </select></div>
    <div class="fg"><label class="fl">Notes</label><textarea class="fta" name="notes" rows="2">${esc(item.notes)}</textarea></div>`,

  Media_Assets: (item={}) => `
    <div class="fg"><label class="fl">Title *</label><input class="fi" name="title" value="${esc(item.title)}"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Type</label><select class="fs" name="type">
        ${['video','photo','reel','broll','story','graphic'].map(t=>`<option ${item.type===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Platform</label><select class="fs" name="platform">
        <option value="">—</option>${CONFIG.PLATFORMS.map(p=>`<option ${item.platform===p?'selected':''}>${p}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">—</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Status</label><select class="fs" name="status">
        ${['raw','editing','ready','posted','archived'].map(s=>`<option ${item.status===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Tags</label><input class="fi" name="tags" value="${esc(item.tags)}"/></div>`,

  Social_Metrics: (item={}) => `
    <div class="fr">
      <div class="fg"><label class="fl">Platform *</label><select class="fs" name="platform">
        ${CONFIG.PLATFORMS.map(p=>`<option ${item.platform===p?'selected':''}>${p}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Period Type</label><select class="fs" name="period_type">
        ${['monthly','quarterly','weekly'].map(t=>`<option ${item.period_type===t?'selected':''}>${t}</option>`).join('')}
      </select></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Period Start</label><input class="fi" type="date" name="period_start" value="${item.period_start||''}"/></div>
      <div class="fg"><label class="fl">Period End</label><input class="fi" type="date" name="period_end" value="${item.period_end||''}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Reach</label><input class="fi" type="number" name="reach" value="${item.reach||0}"/></div>
      <div class="fg"><label class="fl">Impressions</label><input class="fi" type="number" name="impressions" value="${item.impressions||0}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Engagement %</label><input class="fi" type="number" step="0.01" name="engagement_rate" value="${item.engagement_rate||0}"/></div>
      <div class="fg"><label class="fl">Followers Gained</label><input class="fi" type="number" name="followers_gained" value="${item.followers_gained||0}"/></div>
    </div>
    <div class="fr">
      <div class="fg"><label class="fl">Posts Count</label><input class="fi" type="number" name="posts_count" value="${item.posts_count||0}"/></div>
      <div class="fg"><label class="fl">Total Followers</label><input class="fi" type="number" name="total_followers" value="${item.total_followers||0}"/></div>
    </div>`,

  Enrollment: (item={}) => `
    <div class="fr">
      <div class="fg"><label class="fl">Campus *</label><select class="fs" name="campus">
        ${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
      <div class="fg"><label class="fl">Month</label><select class="fs" name="month">
        ${Array.from({length:12},(_,i)=>`<option value="${i+1}" ${item.month==i+1?'selected':''}>${new Date(2000,i).toLocaleString('en',{month:'long'})}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Year</label><input class="fi" type="number" name="year" value="${item.year||new Date().getFullYear()}"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Leads</label><input class="fi" type="number" name="leads" value="${item.leads||0}"/></div>
      <div class="fg"><label class="fl">Enrolled</label><input class="fi" type="number" name="enrolled" value="${item.enrolled||0}"/></div>
    </div>
    <div class="fg"><label class="fl">Notes</label><textarea class="fta" name="notes" rows="2">${esc(item.notes)}</textarea></div>`,

  Meetings: (item={}) => `
    <div class="fg"><label class="fl">Meeting Title *</label><input class="fi" name="title" value="${esc(item.title)}"/></div>
    <div class="fg"><label class="fl">Date</label><input class="fi" type="date" name="date" value="${item.date||''}"/></div>
    <div class="fg"><label class="fl">Attendees</label><input class="fi" name="attendees" value="${esc(item.attendees)}" placeholder="Names, comma separated"/></div>
    <div class="fg"><label class="fl">Summary</label><textarea class="fta" name="summary" rows="3">${esc(item.summary)}</textarea></div>
    <div class="fg"><label class="fl">Transcript / Notes</label><textarea class="fta" name="transcript" rows="5" placeholder="Paste raw transcript…">${esc(item.transcript)}</textarea></div>`,

  Departments: (item={}) => `
    <div class="fg"><label class="fl">Name *</label><input class="fi" name="name" value="${esc(item.name)}"/></div>
    <div class="fg"><label class="fl">Slug *</label><input class="fi" name="slug" value="${esc(item.slug)}" placeholder="e.g. social-media"/></div>
    <div class="fg"><label class="fl">Color</label><input class="fi" type="color" name="color" value="${item.color||'#3B82F6'}" style="height:40px;padding:4px"/></div>
    <div class="fg"><label class="fl">Position</label><input class="fi" type="number" name="position" value="${item.position||1}"/></div>`,

  Members: (item={}) => `
    <div class="fg"><label class="fl">Full Name *</label><input class="fi" name="full_name" value="${esc(item.full_name)}"/></div>
    <div class="fg"><label class="fl">Email</label><input class="fi" type="email" name="email" value="${esc(item.email)}"/></div>
    <div class="fr">
      <div class="fg"><label class="fl">Role</label><input class="fi" name="role" value="${esc(item.role)}" placeholder="e.g. Marketing Director"/></div>
      <div class="fg"><label class="fl">Campus</label><select class="fs" name="campus">
        <option value="">—</option>${CONFIG.CAMPUSES.map(c=>`<option ${item.campus===c?'selected':''}>${c}</option>`).join('')}
      </select></div>
    </div>
    <div class="fg"><label class="fl">Department</label><select class="fs" name="department">
      <option value="">—</option>
      ${DB.Departments.map(d=>`<option value="${d.slug}" ${item.department===d.slug?'selected':''}>${d.name}</option>`).join('')}
    </select></div>`,
};

// Safe HTML escape for form values
function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

// openAdd(entity?) — smart context-aware open
function openAdd(entity) {
  let sheet = entity;
  if (!sheet) {
    // Context-based default
    const map = {
      dashboard:'Tasks', planner:'Tasks', marketing:'Campaigns',
      people:'Leave_Requests', intel:'Meetings', admin:'Departments',
    };
    sheet = map[currentView] || 'Tasks';
  }
  if (!FORMS[sheet]) { toast(`No form for ${sheet}`, 'warn'); return; }
  drawerEntity = sheet;
  drawerItem   = null;
  const labels = { Leave_Requests:'Leave Request', Comp_Days:'Day Off', Social_Metrics:'Social Metrics', Media_Assets:'Media Asset' };
  document.getElementById('dr-title').textContent = `Add ${labels[sheet] || sheet.replace(/_/g,' ')}`;
  document.getElementById('dr-body').innerHTML    = FORMS[sheet]();
  openDrawer();
}

function openEdit(sheet, id) {
  const item = DB[sheet]?.find(r => r.id === id);
  if (!item) return;
  drawerEntity = sheet;
  drawerItem   = item;
  const labels = { Leave_Requests:'Leave Request', Comp_Days:'Day Off', Social_Metrics:'Social Metrics', Media_Assets:'Media Asset' };
  document.getElementById('dr-title').textContent = `Edit ${labels[sheet] || sheet.replace(/_/g,' ')}`;
  document.getElementById('dr-body').innerHTML    = (FORMS[sheet]||(() => ''))(item);
  openDrawer();
}

// Legacy alias
function openEditDrawer(sheet, id) { openEdit(sheet, id); }

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('dr-ov').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('dr-ov').classList.remove('open');
  drawerEntity = null;
  drawerItem   = null;
}

async function saveDrawer() {
  if (!drawerEntity) return;
  const form = document.getElementById('dr-body');
  const data = {};
  form.querySelectorAll('[name]').forEach(el => { data[el.name] = el.value; });

  // Validation
  const required = {
    Tasks:['title'], Campaigns:['title'],
    Leave_Requests:['member_name','start_date','end_date'],
    Missions:['member_name','title','mission_date'],
    Events:['title','date'], Departments:['name','slug'], Members:['full_name'],
  };
  for (const field of (required[drawerEntity]||[])) {
    if (!data[field]?.trim()) { toast(`${field.replace(/_/g,' ')} is required`, 'error'); return; }
  }

  const btn = document.getElementById('dr-save');
  if (btn) { btn.textContent='Saving…'; btn.disabled=true; }

  try {
    if (drawerItem) {
      await dbUpdate(drawerEntity, drawerItem.id, data);
      toast('Updated ✓', 'success');
    } else {
      await dbAppend(drawerEntity, data);
      toast('Saved ✓', 'success');
    }
    closeDrawer();
    renderView(currentView);
  } catch(e) {
    toast('Error: ' + e.message, 'error');
  } finally {
    if (btn) { btn.textContent='Save'; btn.disabled=false; }
  }
}

// ─── DELETE CONFIRM ───────────────────────────────────────────────────────────
function confirmDelete(sheet, id) {
  const item = DB[sheet]?.find(r => r.id === id);
  const label = item?.title || item?.full_name || item?.member_name || id;
  document.getElementById('conf-msg').textContent = `Delete "${truncate(label,40)}"? This cannot be undone.`;
  document.getElementById('conf-ov').classList.add('open');
  confirmCb = async (yes) => {
    if (!yes) return;
    await dbDelete(sheet, id);
    closeDrawer();
    toast('Deleted', 'success');
  };
}

function confResolve(yes) {
  document.getElementById('conf-ov').classList.remove('open');
  if (confirmCb) { confirmCb(yes); confirmCb = null; }
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type='info') {
  const el = document.createElement('div');
  el.className = `toast t-${type}`;
  el.textContent = msg;
  document.getElementById('toast-box').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3000);
}

// ─── THEME ────────────────────────────────────────────────────────────────────
function toggleTheme() {
  const html  = document.documentElement;
  const theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  html.dataset.theme = theme;
  localStorage.setItem('ais_theme', theme);
}

// ─── ACCENT COLOUR ────────────────────────────────────────────────────────────
function setAccent(hex, btn, silent=false) {
  document.documentElement.style.setProperty('--accent', hex);
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  document.documentElement.style.setProperty('--accent-soft', `rgba(${r},${g},${b},.15)`);
  localStorage.setItem('ais_accent', hex);
  // Highlight swatch
  document.querySelectorAll('.accent-sw').forEach(s => s.classList.remove('sel'));
  if (btn?.classList?.contains('accent-sw')) btn.classList.add('sel');
  if (!silent) toast('Colour updated ✓', 'success');
}

// ─── SIDEBAR ──────────────────────────────────────────────────────────────────
function toggleSidebar() {
  const sb = document.getElementById('sidebar');
  if (window.innerWidth <= 768) {
    sb.classList.toggle('open');
  } else {
    sb.classList.toggle('collapsed');
    // Flip collapse icon
    const icon = document.getElementById('collapse-icon');
    if (icon) {
      const isCollapsed = sb.classList.contains('collapsed');
      icon.innerHTML = isCollapsed
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>';
    }
  }
}

// ─── OFFLINE BANNER ───────────────────────────────────────────────────────────
function showBanner() { document.getElementById('off-bar')?.classList.add('show'); }
function hideBanner() { document.getElementById('off-bar')?.classList.remove('show'); }

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function onSearch(val) {
  if (currentView === 'planner') {
    const el = document.getElementById('task-search');
    if (el) { el.value = val; filterTasks(); }
  }
  if (currentView === 'marketing') {
    const el = document.getElementById('camp-search');
    if (el) { el.value = val; filterCampaigns(); }
  }
  if (currentView === 'people') {
    const el = document.getElementById('ppl-search');
    if (el) { el.value = val; filterPeople(); }
  }
}

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
function exportCSV() {
  const sheetMap = {
    dashboard:'Tasks', planner:'Tasks', marketing:'Campaigns',
    people:'Leave_Requests', intel:'Meetings', admin:'Members',
  };
  const sheet = sheetMap[currentView];
  if (!sheet || !DB[sheet]?.length) { toast('Nothing to export', 'warn'); return; }
  const rows = DB[sheet];
  const keys = Object.keys(rows[0]);
  const csv  = [keys.join(','), ...rows.map(r => keys.map(k => JSON.stringify(r[k]||'')).join(','))].join('\n');
  const a    = Object.assign(document.createElement('a'), {
    href: 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv),
    download: `${sheet}_${new Date().toISOString().slice(0,10)}.csv`,
  });
  a.click();
  toast('Exported ✓', 'success');
}

// ─── IMPORT CSV ───────────────────────────────────────────────────────────────
function importCSV(input) {
  const file = input.files[0];
  if (!file) return;
  const sheetMap = { planner:'Tasks', marketing:'Campaigns', people:'Leave_Requests' };
  const sheet    = sheetMap[currentView];
  if (!sheet) { toast('Import not supported here', 'warn'); return; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const lines   = e.target.result.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.replace(/"/g,'').trim());
      const rows    = lines.slice(1).map(line => {
        const vals = line.match(/(".*?"|[^,]+)/g) || [];
        return Object.fromEntries(headers.map((h,i) => [h, (vals[i]||'').replace(/"/g,'').trim()]));
      });
      let count = 0;
      for (const row of rows) {
        if (!row.id) row.id = genId();
        await dbAppend(sheet, row);
        count++;
      }
      toast(`Imported ${count} records ✓`, 'success');
    } catch(err) {
      toast('Import failed: ' + err.message, 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}
