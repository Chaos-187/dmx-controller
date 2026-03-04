// ═══════════════════════════════════════════════════════════════
//  Config Page — Standalone JavaScript
//  Extracted from index.html for the dedicated config page
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
//  Utility Functions
// ═══════════════════════════════════════════════════════════════
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function showError(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  if (msg) setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}

/** Show a subtle loading shimmer inside a tbody or container */
function showLoading(el, cols) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  if (el.tagName === 'TBODY') {
    const c = cols || el.closest('table')?.querySelector('thead tr')?.children.length || 3;
    el.innerHTML = `<tr><td colspan="${c}" class="loading-cell"><div class="loading-shimmer"></div></td></tr>`;
  } else {
    el.innerHTML = '<div class="loading-cell"><div class="loading-shimmer"></div></div>';
  }
}

/** Show an empty-state message inside a tbody or container */
function showEmpty(el, msg, cols) {
  if (typeof el === 'string') el = document.getElementById(el);
  if (!el) return;
  if (el.tagName === 'TBODY') {
    const c = cols || el.closest('table')?.querySelector('thead tr')?.children.length || 3;
    el.innerHTML = `<tr><td colspan="${c}" style="text-align:center;padding:24px;color:var(--text-dim);font-size:12px">${msg}</td></tr>`;
  } else {
    el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-dim);font-size:12px">${msg}</div>`;
  }
}

// ═══════════════════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════════════════
const CHANNEL_TYPES = [
  'dimmer','red','green','blue','white','amber','uv',
  'pan','pan_fine','tilt','tilt_fine',
  'speed','strobe','gobo','gobo_rotation','color_wheel',
  'prism','focus','zoom','frost','macro','other'
];
const CATEGORY_LABELS = {
  par:'Par Can', moving_head:'Moving Head', moving_head_wash:'Moving Head Wash', moving_head_spot:'Moving Head Spot',
  strobe:'Strobe', laser:'Laser',
  fog:'Fog/Haze', dimmer:'Dimmer', led_bar:'LED Bar', multi_cell:'Multi-Cell', effect:'Effect', other:'Other'
};

// ═══════════════════════════════════════════════════════════════
//  Authentication
// ═══════════════════════════════════════════════════════════════
let _authToken = sessionStorage.getItem('authToken') || null;
let _authEnabled = false;
let _authChecked = false;

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (_authToken) h['Authorization'] = 'Bearer ' + _authToken;
  return h;
}

/** Fetch wrapper that injects the auth token */
async function authFetch(url, opts = {}) {
  opts.headers = { ...authHeaders(), ...(opts.headers || {}) };
  const res = await fetch(url, opts);
  if (res.status === 401) {
    // Session expired — prompt re-login
    _authToken = null;
    sessionStorage.removeItem('authToken');
    showLoginModal();
    throw new Error('Authentication required');
  }
  return res;
}

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/status', { headers: authHeaders() });
    const data = await res.json();
    _authEnabled = data.enabled;
    _authChecked = true;
    if (data.enabled && !data.authenticated) {
      _authToken = null;
      sessionStorage.removeItem('authToken');
    }
    return data;
  } catch {
    _authChecked = true;
    return { enabled: false, authenticated: false };
  }
}

function showLoginModal(onSuccess) {
  const overlay = document.getElementById('loginOverlay');
  const errEl = document.getElementById('loginError');
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  errEl.textContent = '';
  userEl.value = '';
  passEl.value = '';
  overlay.classList.add('open');
  overlay._onSuccess = onSuccess || null;
  setTimeout(() => userEl.focus(), 50);
}

function hideLoginModal() {
  document.getElementById('loginOverlay').classList.remove('open');
}

document.getElementById('loginSubmitBtn').addEventListener('click', doLogin);
document.getElementById('loginPassword').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLogin();
});
document.getElementById('loginCancelBtn').addEventListener('click', () => {
  hideLoginModal();
  // Navigate back to main page instead of switching tabs
  window.location.href = 'index.html';
});

async function doLogin() {
  const userEl = document.getElementById('loginUsername');
  const passEl = document.getElementById('loginPassword');
  const errEl = document.getElementById('loginError');
  const btn = document.getElementById('loginSubmitBtn');
  errEl.textContent = '';
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: userEl.value.trim(), password: passEl.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Login failed';
      return;
    }
    _authToken = data.token;
    sessionStorage.setItem('authToken', data.token);
    hideLoginModal();
    const cb = document.getElementById('loginOverlay')._onSuccess;
    if (cb) cb();
  } catch (e) {
    errEl.textContent = 'Connection error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Log In';
  }
}

async function doLogout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() });
  } catch {}
  _authToken = null;
  sessionStorage.removeItem('authToken');
}

/**
 * Gate function: checks auth before allowing config access.
 * Returns true if access is allowed, false if login modal was shown.
 */
async function ensureConfigAuth(onSuccess) {
  if (!_authEnabled) return true;
  if (_authToken) {
    // Verify token is still valid
    const status = await checkAuthStatus();
    if (status.authenticated) return true;
  }
  showLoginModal(onSuccess);
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  WebSocket
// ═══════════════════════════════════════════════════════════════
let ws;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    console.log('[WS] Connected');
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    if (dot) dot.classList.add('connected');
    if (txt) txt.textContent = 'Connected';
  };

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'stem_progress') {
      const fill = document.getElementById('stemProgressFill');
      const lbl = document.getElementById('stemProgressLabel');
      if (fill) fill.style.width = msg.progress + '%';
      if (lbl) lbl.textContent = `Separating stems... ${msg.progress}%`;
    }
    else if (msg.type === 'stem_complete') {
      const btn = document.getElementById('btnSeparateTrackStems');
      if (btn) { btn.textContent = '🎵 Separate Stems'; btn.disabled = false; }
      const bar = document.getElementById('stemProgressBar');
      if (bar) bar.style.display = 'none';
      const methods = { demucs: 'Demucs (ML)', spectral: 'Spectral (FFmpeg)' };
      const result = document.getElementById('dbTrackActionResult');
      if (result) result.innerHTML =
        `<span style="color:var(--green)">✅ Stems separated via ${methods[msg.method] || msg.method}</span>`;
    }
    else if (msg.type === 'stem_error') {
      const btn = document.getElementById('btnSeparateTrackStems');
      if (btn) { btn.textContent = '🎵 Separate Stems'; btn.disabled = false; }
      const bar = document.getElementById('stemProgressBar');
      if (bar) bar.style.display = 'none';
      const result = document.getElementById('dbTrackActionResult');
      if (result) result.innerHTML =
        `<span style="color:var(--danger)">Stem separation failed: ${esc(msg.error)}</span>`;
    }
    else if (msg.type === 'midi_led_state') {
      if (typeof renderLiveMidiState === 'function') renderLiveMidiState(msg);
    }
    else if (msg.type === 'midi_status') {
      if (typeof updateMidiStatus === 'function') updateMidiStatus(msg);
      if (typeof fetchAndRenderMidiState === 'function') fetchAndRenderMidiState();
    }
    else if (msg.type === 'midi_mappings_changed' || msg.type === 'midi_mapping_created') {
      if (typeof loadMidiMappings === 'function') loadMidiMappings();
      if (typeof fetchAndRenderMidiState === 'function') fetchAndRenderMidiState();
    }
    else if (msg.type === 'os2l_button_map_created') {
      if (typeof loadButtonMaps === 'function') loadButtonMaps();
    }
    else if (msg.type === 'server_log') {
      logEvent({ evtType: 'server', raw: { level: msg.level, message: msg.message }, ts: msg.ts });
    }
    else if (msg.type === 'log') {
      logEvent({ evtType: msg.raw?.evt || 'event', raw: msg.raw, ts: msg.ts });
    }
  };

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusText');
    if (dot) dot.classList.remove('connected');
    if (txt) txt.textContent = 'Disconnected';
    setTimeout(connect, 2000);
  };
}

// ═══════════════════════════════════════════════════════════════
//  Event Log
// ═══════════════════════════════════════════════════════════════
const eventLogEl = document.getElementById('eventLog');
const logEntriesEl = document.getElementById('logEntries');
const logCountEl = document.getElementById('logCount');
const ppOverlay = document.getElementById('ppOverlay');
const ppContent = document.getElementById('ppContent');
const logAutoScrollEl = document.getElementById('logAutoScroll');
const logCaptureToggle = document.getElementById('logCaptureToggle');
let logCapturing = true;
let logFilter = 'all';
let logTotal = 0;
const MAX_LOG = 2000;

logCaptureToggle.addEventListener('change', () => {
  logCapturing = logCaptureToggle.checked;
});

document.getElementById('btnClearLog').addEventListener('click', () => {
  logEntriesEl.innerHTML = '';
  logTotal = 0;
  logCountEl.textContent = '0 events';
});

// Filter buttons
eventLogEl.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    eventLogEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    logFilter = btn.dataset.filter;
    // Show/hide entries based on filter
    logEntriesEl.querySelectorAll('.log-entry').forEach(entry => {
      if (logFilter === 'all' || entry.dataset.evtType === logFilter) {
        entry.style.display = '';
      } else {
        entry.style.display = 'none';
      }
    });
  });
});

// Pretty-print on double-click
ppOverlay.addEventListener('click', (e) => { if (e.target === ppOverlay) ppOverlay.classList.remove('open'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ppOverlay.classList.remove('open'); });

function logEvent(info) {
  if (!logCapturing) return;
  const { evtType, raw, ts } = info;
  logTotal++;
  logCountEl.textContent = `${logTotal} events`;

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.dataset.evtType = evtType;

  const time = ts ? new Date(ts) : new Date();
  const timeStr = time.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(time.getMilliseconds()).padStart(3, '0');

  // Build summary text based on event type
  let summary = '';
  if (evtType === 'subscribed' && raw) {
    summary = `${raw.trigger || ''} = ${JSON.stringify(raw.value ?? '')}`;
  } else if (evtType === 'beat' && raw) {
    summary = `pos=${raw.pos ?? ''} strength=${raw.strength ?? ''} bpm=${raw.bpm ?? ''}`;
  } else if (evtType === 'server' && raw) {
    const lvl = raw.level === 'error' ? '❌' : raw.level === 'warn' ? '⚠️' : 'ℹ️';
    summary = `${lvl} ${raw.message || ''}`;
  } else if (evtType === 'connection') {
    summary = raw?.connected ? `VDJ connected: ${raw.address || ''}` : 'VDJ disconnected';
  } else {
    summary = JSON.stringify(raw || info).substring(0, 200);
  }

  entry.innerHTML = `<span class="log-time">${timeStr}</span><span class="log-type ${evtType}">${evtType}</span><span class="log-data">${esc(summary)}</span>`;

  // Store raw data for pretty-print
  entry._rawData = raw || info;

  entry.addEventListener('dblclick', () => {
    ppContent.textContent = JSON.stringify(entry._rawData, null, 2);
    ppOverlay.classList.add('open');
  });

  // Apply current filter
  if (logFilter !== 'all' && evtType !== logFilter) {
    entry.style.display = 'none';
  }

  logEntriesEl.appendChild(entry);

  // Trim old entries
  while (logEntriesEl.children.length > MAX_LOG) logEntriesEl.removeChild(logEntriesEl.firstChild);

  // Auto-scroll
  if (logAutoScrollEl.checked) {
    eventLogEl.scrollTop = eventLogEl.scrollHeight;
  }
}

// ═══════════════════════════════════════════════════════════════
//  DMX Dependencies (for strobe test / mover positioning)
// ═══════════════════════════════════════════════════════════════
let qaChannelMap = [];
let strobeDefaultSpeed = 200;

function getFilteredChannelMap() { return qaChannelMap; }

function getStrobeTargets(value) {
  const filtered = getFilteredChannelMap();
  const targets = [];
  for (const fix of filtered) {
    for (const ch of fix.channels) {
      if (ch.type === 'strobe') { targets.push({ universe: fix.universe, address: ch.dmx_address, val: value }); continue; }
      if (ch.ranges) {
        const strobeRange = ch.ranges.find(r => r.type === 'strobe');
        if (strobeRange) {
          const mapped = value === 0 ? 0 : Math.round(strobeRange.min + (value / 255) * (strobeRange.max - strobeRange.min));
          targets.push({ universe: fix.universe, address: ch.dmx_address, val: mapped });
        }
      }
    }
  }
  return targets;
}

function sendStrobeValue(value) {
  const targets = getStrobeTargets(value);
  const byUniverse = {};
  for (const t of targets) {
    if (!byUniverse[t.universe]) byUniverse[t.universe] = [];
    byUniverse[t.universe].push({ ch: t.address, val: t.val });
  }
  for (const [u, channels] of Object.entries(byUniverse)) {
    fetch('/api/dmx/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ universe: +u, channels }),
    });
  }
}

// ═══════════════════════════════════════════════════════════════
//  Config — Sub-tab Switching
// ═══════════════════════════════════════════════════════════════
document.querySelectorAll('.config-sidebar-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.config-sidebar-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.config-sub-page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('cfgpage-' + btn.dataset.cfgtab).classList.add('active');
    loadActiveTabData();
  });
});

document.querySelectorAll('.device-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.device-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.device-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('devtab-' + btn.dataset.devtab).classList.add('active');
    if (btn.dataset.devtab === 'usb') loadUsbDevices();
    if (btn.dataset.devtab === 'artnet') loadArtnetNodes();
    if (btn.dataset.devtab === 'network') loadNetworkConfig();
  });
});

const _seqGenTabs = new Set(['colors','genres','movement','intensity','effects','templates']);
document.querySelectorAll('.seq-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.seq-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.seq-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('seqtab-' + btn.dataset.seqtab).classList.add('active');
    if (_seqGenTabs.has(btn.dataset.seqtab)) loadGeneratorConfig();
  });
});

document.getElementById('cfgpage-sequencer').addEventListener('click', async (e) => {
  if (e.target.classList.contains('btn-save-gen')) {
    document.getElementById('btnSaveGenConfig').click();
    const canonical = document.getElementById('btnSaveGenConfig');
    const mirror = () => { e.target.textContent = canonical.textContent; e.target.style.borderColor = canonical.style.borderColor; e.target.style.color = canonical.style.color; };
    const obs = new MutationObserver(mirror);
    obs.observe(canonical, { childList: true, attributes: true, attributeFilter: ['style'] });
    setTimeout(() => obs.disconnect(), 3000);
  }
  if (e.target.classList.contains('btn-reset-gen')) {
    document.getElementById('btnResetGenConfig').click();
    const canonical = document.getElementById('btnResetGenConfig');
    const mirror = () => { e.target.textContent = canonical.textContent; e.target.style.borderColor = canonical.style.borderColor; e.target.style.color = canonical.style.color; };
    const obs = new MutationObserver(mirror);
    obs.observe(canonical, { childList: true, attributes: true, attributeFilter: ['style'] });
    setTimeout(() => obs.disconnect(), 3000);
  }
});

// ═══════════════════════════════════════════════════════════════
//  Config — Load All Settings
// ═══════════════════════════════════════════════════════════════
async function loadConfigPage() {
  try {
    const config = await fetch('/api/config').then(r => r.json());
    document.getElementById('cfgArtnetRefreshRate').value = config.artnet_refresh_rate || 44;
    document.getElementById('cfgOs2lPort').value = config.os2l_port || 8787;
    document.getElementById('cfgOs2lServiceName').value = config.os2l_service_name || 'DMX-Controller';
    document.getElementById('cfgWebPort').value = config.web_port || 80;
    document.getElementById('cfgFrequency').value = config.subscription_frequency || 25;
    document.getElementById('cfgVdjDbPath').value = config.vdj_db_path || '';
    document.getElementById('cfgVdjFolder').value = config.vdj_folder || '';
    document.getElementById('cfgVdjAutoMeta').checked = config.vdj_auto_meta === '1';
    document.getElementById('cfgVdjDecks').value = config.vdj_deck_count || '4';
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  // Always load the active tab's data regardless of config fetch success
  loadActiveTabData();
}

/** Load data for whatever sidebar tab + sub-tab is currently active */
function loadActiveTabData() {
  const activeBtn = document.querySelector('.config-sidebar-btn.active');
  if (!activeBtn) return;
  const tab = activeBtn.dataset.cfgtab;
  const loaders = {
    devices: () => {
      const dt = document.querySelector('.device-tab-btn.active');
      if (!dt || dt.dataset.devtab === 'usb') loadUsbDevices();
      if (dt && dt.dataset.devtab === 'artnet') loadArtnetNodes();
      if (dt && dt.dataset.devtab === 'network') loadNetworkConfig();
    },
    os2l:            () => { loadSubscriptions(); loadButtonMaps(); },
    lighting:        () => loadLightingConfig(),
    movers:          () => loadMoverConfig(),
    sequencer:       () => { loadSequencerConfig(); const st = document.querySelector('.seq-tab-btn.active'); if (st && _seqGenTabs.has(st.dataset.seqtab)) loadGeneratorConfig(); },
    effects:         () => loadEffectsConfig(),
    'touch-actions':  () => loadTouchActionsConfig(),
    database:        () => loadDatabaseConfig(),
    'app-settings':   () => loadAppSettings(),
    'fixture-library': () => loadTypes(),
    about:           () => loadAboutInfo(),
    midi:            () => { loadMidiStatus(); loadMidiMappings(); },
  };
  if (loaders[tab]) loaders[tab]();
}

// ═══════════════════════════════════════════════════════════════
//  USB Devices — CRUD + Connect/Disconnect
// ═══════════════════════════════════════════════════════════════
async function loadUsbDevices() {
  const tbody = document.getElementById('usbDevicesBody');
  showLoading(tbody);
  try {
    const devices = await fetch('/api/usb-devices').then(r => r.json());
    document.getElementById('usbDeviceCount').textContent = `${devices.length} device(s)`;
    tbody.innerHTML = '';
    if (devices.length === 0) { showEmpty(tbody, 'No USB devices configured. Click "+ Add USB Device" or "Scan Hardware" to get started.'); return; }
    for (const d of devices) {
    const tr = document.createElement('tr');
    if (!d.enabled) tr.style.opacity = '0.4';
    const identifier = d.serial_number || d.description || '—';
    const vidPid = (d.source === 'usb' && d.vid && d.pid) ? ` (${d.vid}:${d.pid})` : '';
    tr.innerHTML = `
      <td><input type="checkbox" class="usb-dev-toggle" data-id="${d.id}" ${d.enabled ? 'checked' : ''} style="accent-color:var(--accent);width:16px;height:16px;cursor:pointer"></td>
      <td>${esc(d.label || '—')}</td>
      <td><span class="sub-cat ${d.source === 'ftdi' ? 'transport' : 'soundswitch'}">${d.source === 'ftdi' ? 'FTDI' : 'USB'}</span></td>
      <td style="font-family:monospace;font-size:11px">${esc(identifier)}${esc(vidPid)}</td>
      <td>${d.local_universe}</td>
      <td>${d.auto_connect ? '✓' : '—'}</td>
      <td>${d.connected
        ? '<span style="color:var(--green)">● Connected</span>'
        : '<span style="color:var(--text-dim)">○ Offline</span>'}</td>
      <td>
        ${d.connected
          ? `<button class="btn btn-danger btn-sm" onclick="disconnectUsbDevice(${d.id})">Disconnect</button>`
          : `<button class="btn btn-primary btn-sm" onclick="connectUsbDevice(${d.id})" ${!d.enabled ? 'disabled' : ''}>Connect</button>`}
        <button class="btn btn-secondary btn-sm" onclick="editUsbDevice(${d.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteUsbDevice(${d.id})">Del</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.usb-dev-toggle').forEach(cb => {
    cb.addEventListener('change', async () => {
      await fetch(`/api/usb-devices/${cb.dataset.id}/toggle`, { method: 'POST' });
      loadUsbDevices();
    });
  });
  } catch (e) {
    console.error('Failed to load USB devices:', e);
    showEmpty(tbody, 'Failed to load USB devices. Check the server connection.');
  }
}

window.connectUsbDevice = async function(id) {
  try {
    const res = await fetch(`/api/usb-devices/${id}/connect`, { method: 'POST' });
    const data = await res.json();
    if (data.error) alert('Connect failed: ' + data.error);
  } catch (e) {
    alert('Connect error: ' + e.message);
  }
  loadUsbDevices();
};

window.disconnectUsbDevice = async function(id) {
  await fetch(`/api/usb-devices/${id}/disconnect`, { method: 'POST' });
  loadUsbDevices();
};

window.deleteUsbDevice = async function(id) {
  if (!confirm('Delete this USB device?')) return;
  await fetch(`/api/usb-devices/${id}`, { method: 'DELETE' });
  loadUsbDevices();
};

function openUsbDeviceModal(device) {
  document.getElementById('usbDeviceModalTitle').textContent = device ? 'Edit USB Device' : 'Add USB Device';
  document.getElementById('usbDeviceEditId').value = device ? device.id : '';
  document.getElementById('usbDevLabel').value = device ? device.label : '';
  document.getElementById('usbDevSource').value = device ? device.source : 'ftdi';
  document.getElementById('usbDevSerial').value = device ? (device.serial_number || '') : '';
  document.getElementById('usbDevDescription').value = device ? (device.description || '') : '';
  document.getElementById('usbDevVid').value = device ? (device.vid || '') : '';
  document.getElementById('usbDevPid').value = device ? (device.pid || '') : '';
  document.getElementById('usbDevUniverse').value = device ? device.local_universe : 1;
  document.getElementById('usbDevRefreshRate').value = device ? device.refresh_rate : 40;
  document.getElementById('usbDevAutoConnect').checked = device ? !!device.auto_connect : true;
  toggleVidPidRow();
  document.getElementById('usbDeviceModal').classList.add('open');
}

function closeUsbDeviceModal() { document.getElementById('usbDeviceModal').classList.remove('open'); }

function toggleVidPidRow() {
  const show = document.getElementById('usbDevSource').value === 'usb';
  document.getElementById('usbDevVidPidRow').style.display = show ? '' : 'none';
}
document.getElementById('usbDevSource').addEventListener('change', toggleVidPidRow);

window.editUsbDevice = async function(id) {
  const device = await fetch(`/api/usb-devices/${id}`).then(r => r.json());
  openUsbDeviceModal(device);
};

document.getElementById('btnAddUsbDevice').addEventListener('click', () => openUsbDeviceModal(null));

document.getElementById('btnSaveUsbDevice').addEventListener('click', async () => {
  const id = document.getElementById('usbDeviceEditId').value;
  const body = {
    label: document.getElementById('usbDevLabel').value,
    source: document.getElementById('usbDevSource').value,
    serial_number: document.getElementById('usbDevSerial').value,
    description: document.getElementById('usbDevDescription').value,
    vid: document.getElementById('usbDevVid').value,
    pid: document.getElementById('usbDevPid').value,
    local_universe: parseInt(document.getElementById('usbDevUniverse').value) || 1,
    refresh_rate: parseInt(document.getElementById('usbDevRefreshRate').value) || 40,
    auto_connect: document.getElementById('usbDevAutoConnect').checked ? 1 : 0,
  };
  try {
    const url = id ? `/api/usb-devices/${id}` : '/api/usb-devices';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (data.error) { alert(data.error); return; }
    closeUsbDeviceModal();
    loadUsbDevices();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
});

// ═══════════════════════════════════════════════════════════════
//  USB Scan
// ═══════════════════════════════════════════════════════════════
document.getElementById('btnScanUsb').addEventListener('click', async () => {
  const btn = document.getElementById('btnScanUsb');
  btn.innerHTML = '&#8987; Scanning...'; btn.disabled = true;
  try {
    const result = await fetch('/api/serial-ports').then(r => r.json());
    const ftdi = result.ftdi || [];
    const usb  = result.usb  || [];
    const dmxUsb = usb.filter(d => d.isDmxRelated);
    const tbody = document.getElementById('usbScanBody');
    tbody.innerHTML = '';
    const section = document.getElementById('usbScanResults');
    section.style.display = 'block';
    const total = ftdi.length + dmxUsb.length;
    document.getElementById('usbScanSummary').innerHTML = total === 0
      ? '<span style="color:var(--amber)">No DMX-capable USB devices found. Is your adapter plugged in?</span>'
      : `Found ${total} device(s). Click <strong>+ Add</strong> to save a device for use.`;
    for (const d of ftdi) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="sub-cat transport">FTDI</span></td>
        <td>${esc(d.description || '—')}</td>
        <td style="font-family:monospace;font-size:11px">${esc(d.serial_number || '—')}</td>
        <td>—</td>
        <td><button class="btn btn-primary btn-sm" onclick='addScannedDevice(${JSON.stringify({ source:"ftdi", label:d.description||"FTDI Device", serial_number:d.serial_number||"", description:d.description||"" })})'>+ Add</button></td>`;
      tbody.appendChild(tr);
    }
    for (const d of dmxUsb) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><span class="sub-cat soundswitch">USB</span></td>
        <td>${esc(d.product || d.manufacturer || '—')}</td>
        <td style="font-family:monospace;font-size:11px">${esc(d.serial_number || '—')}</td>
        <td style="font-family:monospace;font-size:11px">${esc(d.vid)}:${esc(d.pid)}</td>
        <td><button class="btn btn-primary btn-sm" onclick='addScannedDevice(${JSON.stringify({ source:"usb", label:d.product||"USB DMX Device", serial_number:d.serial_number||"", vid:d.vid, pid:d.pid })})'>+ Add</button></td>`;
      tbody.appendChild(tr);
    }
  } catch (e) {
    document.getElementById('usbScanResults').style.display = 'block';
    document.getElementById('usbScanSummary').innerHTML = `<span style="color:var(--danger)">Scan failed: ${e.message}</span>`;
  }
  setTimeout(() => { btn.innerHTML = '&#128269; Scan Hardware'; btn.disabled = false; }, 1000);
});

window.addScannedDevice = function(preset) {
  openUsbDeviceModal({ id: null, label: preset.label, source: preset.source,
    serial_number: preset.serial_number || '', description: preset.description || '',
    vid: preset.vid || '', pid: preset.pid || '',
    local_universe: 1, refresh_rate: 40, auto_connect: 1 });
};

// ═══════════════════════════════════════════════════════════════
//  Sequencer Config
// ═══════════════════════════════════════════════════════════════
async function loadSequencerConfig() {
  const config = await fetch('/api/config').then(r => r.json());
  document.getElementById('cfgSeqAutoLoad').checked = config.seq_auto_load === '1';
  document.getElementById('cfgSeqAutoPlay').checked = config.seq_auto_play === '1';
  document.getElementById('cfgSeqAutoUnload').checked = config.seq_auto_unload === '1';
  document.getElementById('cfgSeqAutoGenerate').checked = config.seq_auto_generate === '1';
  document.getElementById('cfgSeqNoStrobes').checked = config.seq_no_strobes === '1';
  document.getElementById('cfgSeqNoStems').checked = config.seq_no_stems === '1';
  document.getElementById('cfgSeqCrossfaderGating').checked = config.seq_crossfader_gating === '1';
  document.getElementById('cfgSeqCrossfaderMode').value = config.seq_crossfader_mode || 'gate';
  document.getElementById('cfgSeqDeckFaderDimmer').checked = config.seq_deck_fader_dimmer === '1';
  document.getElementById('cfgSeqEndAction').value = config.seq_end_action || 'none';
  const seqs = await fetch('/api/sequences').then(r => r.json());
  const linked = seqs.filter(s => s.track_id);
  const tbody = document.getElementById('linkedSeqBody');
  tbody.innerHTML = '';
  for (const s of linked) {
    const dur = s.duration_ms > 0 ? (s.duration_ms / 1000).toFixed(1) + 's' : '—';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(s.name)}</td>
      <td>${esc(s.track_title || '—')}</td>
      <td>${esc(s.track_author || '—')}</td>
      <td style="font-size:11px;color:var(--text-dim);max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.track_filepath || '')}">${esc(s.track_filepath || '—')}</td>
      <td>${dur}</td>
      <td>${s.cue_count || 0}</td>`;
    tbody.appendChild(tr);
  }
  document.getElementById('linkedSeqCount').textContent = `${linked.length} sequence(s) linked to tracks`;
}

document.getElementById('btnSaveSeqConfig').addEventListener('click', () => {
  saveConfigBatch([
    ['seq_auto_load', document.getElementById('cfgSeqAutoLoad').checked ? '1' : '0'],
    ['seq_auto_play', document.getElementById('cfgSeqAutoPlay').checked ? '1' : '0'],
    ['seq_auto_unload', document.getElementById('cfgSeqAutoUnload').checked ? '1' : '0'],
    ['seq_auto_generate', document.getElementById('cfgSeqAutoGenerate').checked ? '1' : '0'],
    ['seq_no_strobes', document.getElementById('cfgSeqNoStrobes').checked ? '1' : '0'],
    ['seq_no_stems', document.getElementById('cfgSeqNoStems').checked ? '1' : '0'],
    ['seq_crossfader_gating', document.getElementById('cfgSeqCrossfaderGating').checked ? '1' : '0'],
    ['seq_crossfader_mode', document.getElementById('cfgSeqCrossfaderMode').value],
    ['seq_deck_fader_dimmer', document.getElementById('cfgSeqDeckFaderDimmer').checked ? '1' : '0'],
    ['seq_end_action', document.getElementById('cfgSeqEndAction').value],
  ], 'btnSaveSeqConfig');
});

// ═══════════════════════════════════════════════════════════════
//  Generator Config
// ═══════════════════════════════════════════════════════════════
let genConfig = {};
const GEN_SECS = ['intro','verse','chorus','bridge','breakdown','buildup','drop','outro'];
const GEN_REG_FX = ['pulse','rainbow','strobe','color_fade','chase','comet','scanner','buildup','sparkle','color_wave','fire'];
const GEN_CELL_FX = ['chase','comet','scanner','buildup','segments','ripple','cell_strobe','gradient','sparkle','color_wave','fire'];
const GEN_CELL_PATS = ['fill_sweep','color_wave','breathe','chase_slow','alternate','chase','scatter','all_flash','build_reveal','chase_accel','chase_fast','scatter_strobe','alternate_fast'];
const GEN_RAW = {};
let genActivePal = null;

function _r2h(c){return '#'+[c.r||0,c.g||0,c.b||0].map(v=>Math.max(0,Math.min(255,v)).toString(16).padStart(2,'0')).join('');}
function _h2r(h){const m=h.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);return m?{r:parseInt(m[1],16),g:parseInt(m[2],16),b:parseInt(m[3],16)}:{r:0,g:0,b:0};}

async function loadGeneratorConfig() {
  try { genConfig = await fetch('/api/generator-config').then(r => r.json()); } catch(e) { console.warn('gen config load failed',e); genConfig = {}; }
  renderGeneratorConfig();
  loadTemplates();
}

function renderGeneratorConfig() {
  const sd = genConfig.gen_speed_dmx || {slow:200,medium:140,fast:40};
  document.getElementById('genSpeedSlow').value = sd.slow||200;
  document.getElementById('genSpeedMedium').value = sd.medium||140;
  document.getElementById('genSpeedFast').value = sd.fast||40;
  if(!GEN_RAW['genColorPalettesEditor']) renderPaletteEditor();
  if(!GEN_RAW['genSectionStylesEditor']) renderSectionStylesEditor();
  if(!GEN_RAW['genGenrePresetsEditor']) renderGenrePresetsEditor();
  if(!GEN_RAW['genMovementStylesEditor']) renderMovementStylesEditor();
  if(!GEN_RAW['genGenreAliasesEditor']) renderGenreAliasesEditor();
  if(!GEN_RAW['genSectionEffectsEditor']) renderSectionEffectsEditor();
  if(!GEN_RAW['genCellPatternsEditor']) renderCellPatternsEditor();
  if(!GEN_RAW['genFixtureIntensityEditor']) renderFixtureIntensityEditor();
}

// ─── Raw JSON Toggle ───
document.querySelectorAll('.gen-json-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const eid = btn.dataset.editor, key = btn.dataset.key;
    const editor = document.getElementById(eid);
    const raw = document.getElementById(eid.replace('Editor','Raw'));
    if (GEN_RAW[eid]) {
      try { genConfig[key] = JSON.parse(raw.value); } catch(e) { alert('Invalid JSON — fix before switching back.'); return; }
      editor.style.display = ''; raw.style.display = 'none';
      btn.classList.remove('active'); GEN_RAW[eid] = false;
      renderGeneratorConfig();
    } else {
      raw.value = JSON.stringify(genConfig[key], null, 2);
      editor.style.display = 'none'; raw.style.display = '';
      btn.classList.add('active'); GEN_RAW[eid] = true;
    }
  });
});

// ─── Color Palettes Editor ───
function renderPaletteEditor() {
  const c = document.getElementById('genColorPalettesEditor');
  const pals = genConfig.gen_color_palettes || {};
  const keys = Object.keys(pals);
  if (!genActivePal || !pals[genActivePal]) genActivePal = keys[0] || null;
  let h = '<div class="gen-tabs">';
  for (const k of keys) h += `<button class="gen-tab${k===genActivePal?' active':''}" data-gp="${k}">${esc(pals[k].label||k)}</button>`;
  h += '<button class="gen-tab" id="genAddPalBtn" style="color:var(--green)" title="Add new palette">+</button></div>';
  if (genActivePal && pals[genActivePal]) {
    const pal = pals[genActivePal];
    h += '<div class="gen-pal-actions"><label style="font-size:10px;color:var(--text-dim)">Label:</label><input type="text" id="genPalLabel" value="'+esc(pal.label||genActivePal)+'">';
    h += '<button class="btn btn-sm" id="genDelPalBtn" style="font-size:10px;color:var(--danger);border:1px solid var(--danger);padding:2px 8px" title="Delete palette">Delete</button>';
    h += '<button class="btn btn-sm" id="genDupPalBtn" style="font-size:10px;padding:2px 8px" title="Duplicate palette">Duplicate</button></div>';
    h += '<div class="gen-section-rows">';
    for (const sec of GEN_SECS) {
      const pairs = pal[sec] || [];
      h += '<div class="gen-section-row"><span class="gen-section-label">'+sec+'</span><div class="gen-swatch-pairs">';
      for (let i = 0; i < pairs.length; i++) {
        const [c1,c2] = pairs[i];
        h += '<div class="gen-swatch-pair">';
        h += '<div class="gen-swatch" style="background:'+_r2h(c1)+'"><input type="color" value="'+_r2h(c1)+'" data-s="'+sec+'" data-i="'+i+'" data-c="0"></div>';
        h += '<div class="gen-swatch" style="background:'+_r2h(c2)+'"><input type="color" value="'+_r2h(c2)+'" data-s="'+sec+'" data-i="'+i+'" data-c="1"></div>';
        h += '<button class="gen-pair-rm" data-s="'+sec+'" data-i="'+i+'" title="Remove">&times;</button></div>';
      }
      h += '<button class="gen-pair-add" data-s="'+sec+'" title="Add pair">+</button></div></div>';
    }
    h += '</div>';
  }
  c.innerHTML = h;
  c.querySelectorAll('.gen-tab[data-gp]').forEach(b => b.onclick = () => { genActivePal = b.dataset.gp; renderPaletteEditor(); });
  c.querySelectorAll('input[type=color]').forEach(inp => inp.addEventListener('input', e => {
    const {s,i,c:ci} = e.target.dataset;
    pals[genActivePal][s][+i][+ci] = _h2r(e.target.value);
    e.target.parentElement.style.background = e.target.value;
  }));
  c.querySelectorAll('.gen-pair-rm').forEach(b => b.onclick = () => {
    pals[genActivePal][b.dataset.s].splice(+b.dataset.i, 1); renderPaletteEditor();
  });
  c.querySelectorAll('.gen-pair-add').forEach(b => b.onclick = () => {
    if (!pals[genActivePal][b.dataset.s]) pals[genActivePal][b.dataset.s] = [];
    pals[genActivePal][b.dataset.s].push([{r:255,g:0,b:100},{r:0,g:100,b:255}]); renderPaletteEditor();
  });
  const lblInp = document.getElementById('genPalLabel');
  if (lblInp) lblInp.onchange = () => { pals[genActivePal].label = lblInp.value; renderPaletteEditor(); };
  document.getElementById('genAddPalBtn')?.addEventListener('click', () => {
    const nm = prompt('Palette key name (e.g. "mytheme"):');
    if (!nm||!nm.trim()) return;
    const k = nm.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_');
    if (pals[k]) { alert('Already exists'); return; }
    pals[k] = {label:nm.trim()};
    for (const s of GEN_SECS) pals[k][s] = [[{r:255,g:0,b:100},{r:0,g:100,b:255}]];
    genActivePal = k; renderPaletteEditor();
  });
  document.getElementById('genDelPalBtn')?.addEventListener('click', () => {
    if (keys.length <= 1) { alert('Cannot delete the last palette.'); return; }
    if (!confirm('Delete palette "'+genActivePal+'"?')) return;
    delete pals[genActivePal]; genActivePal = null; renderPaletteEditor();
  });
  document.getElementById('genDupPalBtn')?.addEventListener('click', () => {
    const nm = prompt('Name for copy:', genActivePal+'_copy');
    if (!nm||!nm.trim()) return;
    const k = nm.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_');
    if (pals[k]) { alert('Already exists'); return; }
    pals[k] = JSON.parse(JSON.stringify(pals[genActivePal]));
    pals[k].label = nm.trim();
    genActivePal = k; renderPaletteEditor();
  });
}

// ─── Section Styles Editor ───
function renderSectionStylesEditor() {
  const c = document.getElementById('genSectionStylesEditor');
  const styles = genConfig.gen_section_styles || {};
  let h = '<div style="overflow-x:auto"><table class="gen-table"><thead><tr>';
  h += '<th>Section</th><th>Intensity Min</th><th>Intensity Max</th><th>Beat Color</th><th>Beat Bars</th><th>Strobe %</th><th>Strobe Dur</th><th>Cues/Bars</th><th>Flags</th>';
  h += '</tr></thead><tbody>';
  for (const sec of GEN_SECS) {
    const s = styles[sec] || {};
    const intMin = (s.intensity||[0.5,0.8])[0], intMax = (s.intensity||[0.5,0.8])[1];
    h += '<tr><td class="gen-row-label">'+sec+'</td>';
    h += '<td><input type="number" step="0.05" min="0" max="1" value="'+intMin+'" data-s="'+sec+'" data-f="intMin"></td>';
    h += '<td><input type="number" step="0.05" min="0" max="1" value="'+intMax+'" data-s="'+sec+'" data-f="intMax"></td>';
    h += '<td><input type="checkbox" data-s="'+sec+'" data-f="beatColorChange"'+(s.beatColorChange?' checked':'')+'></td>';
    h += '<td><input type="number" step="0.5" min="0.25" max="8" value="'+(s.beatColorBars||'')+'" data-s="'+sec+'" data-f="beatColorBars" style="width:48px" placeholder="—"></td>';
    h += '<td><input type="range" min="0" max="1" step="0.05" value="'+(s.strobeChance||0)+'" data-s="'+sec+'" data-f="strobeChance"><span class="gen-range-val">'+Math.round((s.strobeChance||0)*100)+'%</span></td>';
    h += '<td><input type="number" step="0.25" min="0" max="4" value="'+(s.strobeDurationBeats||'')+'" data-s="'+sec+'" data-f="strobeDurationBeats" style="width:48px" placeholder="—"></td>';
    h += '<td><input type="number" step="0.5" min="0.25" max="16" value="'+(s.cuePerBars||2)+'" data-s="'+sec+'" data-f="cuePerBars" style="width:48px"></td>';
    h += '<td style="font-size:10px">';
    const flags = [['rampIntensity','Ramp'],['buildEnergy','Build'],['dropEnergy','Drop'],['fadeOut','Fade']];
    for (const [fk,fl] of flags) {
      h += '<label style="display:inline-flex;align-items:center;gap:2px;margin-right:6px;cursor:pointer"><input type="checkbox" data-s="'+sec+'" data-f="'+fk+'"'+(s[fk]?' checked':'')+' style="width:12px;height:12px">'+fl+'</label>';
    }
    h += '</td></tr>';
  }
  h += '</tbody></table></div>';
  c.innerHTML = h;
  c.querySelectorAll('input').forEach(inp => inp.addEventListener('change', () => {
    const sec = inp.dataset.s, f = inp.dataset.f;
    if (!styles[sec]) styles[sec] = {};
    if (f === 'intMin') { if(!styles[sec].intensity) styles[sec].intensity=[0.5,0.8]; styles[sec].intensity[0] = parseFloat(inp.value)||0; }
    else if (f === 'intMax') { if(!styles[sec].intensity) styles[sec].intensity=[0.5,0.8]; styles[sec].intensity[1] = parseFloat(inp.value)||0; }
    else if (inp.type === 'checkbox') styles[sec][f] = inp.checked;
    else if (inp.type === 'range') { styles[sec][f] = parseFloat(inp.value)||0; inp.nextElementSibling.textContent = Math.round(inp.value*100)+'%'; }
    else { const v = parseFloat(inp.value); if (!isNaN(v) && v > 0) styles[sec][f] = v; else delete styles[sec][f]; }
  }));
  c.querySelectorAll('input[type=range]').forEach(inp => inp.addEventListener('input', () => {
    inp.nextElementSibling.textContent = Math.round(inp.value*100)+'%';
  }));
}

// ─── Genre Presets Editor ───
function renderGenrePresetsEditor() {
  const c = document.getElementById('genGenrePresetsEditor');
  const presets = genConfig.gen_genre_presets || {};
  const palKeys = Object.keys(genConfig.gen_color_palettes || {});
  let h = '<div style="overflow-x:auto"><table class="gen-table"><thead><tr>';
  h += '<th>Genre</th><th>Intensity</th><th>Strobes</th><th>Cue Dens.</th><th>Beat Color</th><th>Rig Wide</th><th>Flash</th><th>Accent</th><th>Palette</th>';
  h += '</tr></thead><tbody>';
  for (const [key, p] of Object.entries(presets)) {
    h += '<tr><td class="gen-row-label" title="'+key+'">'+(p.label||key)+'</td>';
    const sliders = [['intensityMult',0,2],['strobeMult',0,3],['cueDensityMult',0,2],['beatColorMult',0,4],['rigWideMult',0,2]];
    for (const [fk,mn,mx] of sliders) {
      const v = p[fk]!=null?p[fk]:1;
      h += '<td><input type="range" min="'+mn+'" max="'+mx+'" step="0.05" value="'+v+'" data-g="'+key+'" data-f="'+fk+'"><span class="gen-range-val">'+v.toFixed(1)+'</span></td>';
    }
    h += '<td><input type="checkbox" data-g="'+key+'" data-f="flashOnSection"'+(p.flashOnSection?' checked':'')+'></td>';
    h += '<td><input type="checkbox" data-g="'+key+'" data-f="accentPulses"'+(p.accentPulses?' checked':'')+'></td>';
    h += '<td><select data-g="'+key+'" data-f="preferredPalette"><option value="">(auto)</option>';
    for (const pk of palKeys) h += '<option value="'+pk+'"'+(p.preferredPalette===pk?' selected':'')+'>'+pk+'</option>';
    h += '</select></td></tr>';
  }
  h += '</tbody></table></div>';
  c.innerHTML = h;
  c.querySelectorAll('input[type=range]').forEach(inp => {
    const upd = () => { inp.nextElementSibling.textContent = parseFloat(inp.value).toFixed(1); };
    inp.addEventListener('input', upd);
    inp.addEventListener('change', () => { presets[inp.dataset.g][inp.dataset.f] = parseFloat(inp.value); });
  });
  c.querySelectorAll('input[type=checkbox]').forEach(inp => inp.addEventListener('change', () => { presets[inp.dataset.g][inp.dataset.f] = inp.checked; }));
  c.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => { presets[sel.dataset.g][sel.dataset.f] = sel.value||null; }));
}

// ─── Movement Styles Editor ───
function renderMovementStylesEditor() {
  const c = document.getElementById('genMovementStylesEditor');
  const mv = genConfig.gen_movement_styles || {};
  let h = '<table class="gen-table"><thead><tr><th>Section</th><th>Bars/Move</th><th>Range</th><th>Speed</th></tr></thead><tbody>';
  for (const sec of GEN_SECS) {
    const s = mv[sec] || {};
    h += '<tr><td class="gen-row-label">'+sec+'</td>';
    h += '<td><input type="number" step="0.5" min="0.25" max="16" value="'+(s.barsPerMove||2)+'" data-s="'+sec+'" data-f="barsPerMove"></td>';
    h += '<td><input type="range" min="0" max="1" step="0.05" value="'+(s.range||0.5)+'" data-s="'+sec+'" data-f="range"><span class="gen-range-val">'+(s.range||0.5).toFixed(1)+'</span></td>';
    h += '<td><select data-s="'+sec+'" data-f="speed"><option value="slow"'+(s.speed==='slow'?' selected':'')+'>Slow</option><option value="medium"'+(s.speed==='medium'?' selected':'')+'>Medium</option><option value="fast"'+(s.speed==='fast'?' selected':'')+'>Fast</option></select></td>';
    h += '</tr>';
  }
  h += '</tbody></table>';
  c.innerHTML = h;
  c.querySelectorAll('input[type=number]').forEach(inp => inp.addEventListener('change', () => {
    if(!mv[inp.dataset.s]) mv[inp.dataset.s]={};
    mv[inp.dataset.s][inp.dataset.f] = parseFloat(inp.value)||1;
  }));
  c.querySelectorAll('input[type=range]').forEach(inp => {
    inp.addEventListener('input', () => { inp.nextElementSibling.textContent = parseFloat(inp.value).toFixed(1); });
    inp.addEventListener('change', () => { if(!mv[inp.dataset.s]) mv[inp.dataset.s]={}; mv[inp.dataset.s][inp.dataset.f] = parseFloat(inp.value); });
  });
  c.querySelectorAll('select').forEach(sel => sel.addEventListener('change', () => { if(!mv[sel.dataset.s]) mv[sel.dataset.s]={}; mv[sel.dataset.s][sel.dataset.f] = sel.value; }));
}

// ─── Genre Aliases Editor ───
function renderGenreAliasesEditor() {
  const c = document.getElementById('genGenreAliasesEditor');
  const aliases = genConfig.gen_genre_aliases || {};
  const presetKeys = Object.keys(genConfig.gen_genre_presets || {});
  const entries = Object.entries(aliases).sort((a,b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  let h = '<div class="gen-alias-grid">';
  h += '<span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Genre String</span><span></span><span style="font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.5px">Maps To</span><span></span>';
  for (const [alias, preset] of entries) {
    h += '<input type="text" value="'+esc(alias)+'" data-orig="'+esc(alias)+'" class="ga-key">';
    h += '<span style="color:var(--text-dim)">→</span>';
    h += '<select class="ga-val" data-alias="'+esc(alias)+'">';
    for (const pk of presetKeys) h += '<option value="'+pk+'"'+(preset===pk?' selected':'')+'>'+pk+'</option>';
    h += '</select>';
    h += '<button class="gen-pair-rm ga-del" data-alias="'+esc(alias)+'" title="Remove">&times;</button>';
  }
  h += '</div>';
  h += '<button class="btn btn-sm" id="genAddAliasBtn" style="margin-top:6px;font-size:10px;padding:2px 10px">+ Add Alias</button>';
  c.innerHTML = h;
  c.querySelectorAll('.ga-key').forEach(inp => inp.addEventListener('change', () => {
    const orig = inp.dataset.orig, nk = inp.value.trim().toLowerCase();
    if (!nk || (nk !== orig && aliases[nk])) { inp.value = orig; return; }
    const val = aliases[orig]; delete aliases[orig]; aliases[nk] = val;
    inp.dataset.orig = nk;
  }));
  c.querySelectorAll('.ga-val').forEach(sel => sel.addEventListener('change', () => { aliases[sel.dataset.alias] = sel.value; }));
  c.querySelectorAll('.ga-del').forEach(btn => btn.onclick = () => { delete aliases[btn.dataset.alias]; renderGenreAliasesEditor(); });
  document.getElementById('genAddAliasBtn')?.addEventListener('click', () => {
    const nm = prompt('Genre string to map:');
    if (!nm||!nm.trim()) return;
    const k = nm.trim().toLowerCase();
    if (aliases[k]) { alert('Already exists'); return; }
    aliases[k] = Object.keys(genConfig.gen_genre_presets||{})[0] || 'default';
    renderGenreAliasesEditor();
  });
}

// ─── Section Effects Editor ───
function renderSectionEffectsEditor() {
  const c = document.getElementById('genSectionEffectsEditor');
  const fx = genConfig.gen_section_effects || {};
  let h = '';
  for (const sec of GEN_SECS) {
    const s = fx[sec] || {regular:[],cellAware:[]};
    h += '<div class="gen-effects-sec"><span class="gen-section-label">'+sec+'</span>';
    h += '<div><span class="gen-effects-grp-label">Regular</span><div class="gen-effects-grp">';
    for (const e of GEN_REG_FX) {
      const on = (s.regular||[]).includes(e);
      h += '<span class="gen-chip'+(on?' active':'')+'" data-s="'+sec+'" data-g="regular" data-e="'+e+'">'+e.replace(/_/g,' ')+'</span>';
    }
    h += '</div><span class="gen-effects-grp-label">Cell-Aware</span><div class="gen-effects-grp">';
    for (const e of GEN_CELL_FX) {
      const on = (s.cellAware||[]).includes(e);
      h += '<span class="gen-chip'+(on?' active':'')+'" data-s="'+sec+'" data-g="cellAware" data-e="'+e+'">'+e.replace(/_/g,' ')+'</span>';
    }
    h += '</div></div></div>';
  }
  c.innerHTML = h;
  c.querySelectorAll('.gen-chip').forEach(chip => chip.onclick = () => {
    const {s:sec,g:grp,e:eff} = chip.dataset;
    if(!fx[sec]) fx[sec]={regular:[],cellAware:[]};
    if(!fx[sec][grp]) fx[sec][grp]=[];
    const arr = fx[sec][grp], idx = arr.indexOf(eff);
    if (idx >= 0) { arr.splice(idx,1); chip.classList.remove('active'); }
    else { arr.push(eff); chip.classList.add('active'); }
  });
}

// ─── Cell Patterns Editor ───
function renderCellPatternsEditor() {
  const c = document.getElementById('genCellPatternsEditor');
  const pats = genConfig.gen_cell_patterns || {};
  let h = '';
  for (const sec of GEN_SECS) {
    const arr = pats[sec] || [];
    h += '<div class="gen-effects-sec"><span class="gen-section-label">'+sec+'</span><div class="gen-effects-grp">';
    for (const p of GEN_CELL_PATS) {
      const on = arr.includes(p);
      h += '<span class="gen-chip'+(on?' active':'')+'" data-s="'+sec+'" data-p="'+p+'">'+p.replace(/_/g,' ')+'</span>';
    }
    h += '</div></div>';
  }
  c.innerHTML = h;
  c.querySelectorAll('.gen-chip').forEach(chip => chip.onclick = () => {
    const {s:sec,p:pat} = chip.dataset;
    if(!pats[sec]) pats[sec]=[];
    const idx = pats[sec].indexOf(pat);
    if (idx >= 0) { pats[sec].splice(idx,1); chip.classList.remove('active'); }
    else { pats[sec].push(pat); chip.classList.add('active'); }
  });
}

// ─── Fixture Intensity Editor ───
const _FI_ROLES = ['par','mover','led_bar','color_wheel'];
const _FI_ROLE_LABELS = { par: 'Pars', mover: 'Movers', led_bar: 'LED Bars', color_wheel: 'Color Wheel' };
const _FI_SECTIONS = ['intro','verse','chorus','bridge','breakdown','buildup','drop','outro'];
const _FI_SEC_COLORS = { intro:'#78909c', verse:'#42a5f5', chorus:'#ef5350', bridge:'#ab47bc', breakdown:'#26a69a', buildup:'#ffa726', drop:'#e53935', outro:'#78909c' };

function renderFixtureIntensityEditor() {
  const fi = genConfig.gen_fixture_intensity || {};
  const c = document.getElementById('genFixtureIntensityEditor');
  const sc = document.getElementById('fixtureIntensitySliders');
  if (!c || !sc) return;
  let h = '';
  for (const role of _FI_ROLES) {
    const curve = fi[role] || {};
    h += '<div style="margin-bottom:10px"><strong style="color:var(--accent)">'+_FI_ROLE_LABELS[role]+'</strong>';
    h += '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:4px">';
    for (const sec of _FI_SECTIONS) {
      const val = (curve[sec] !== undefined ? curve[sec] : 1.0);
      h += '<span style="font-size:11px;color:var(--text-dim)">'+sec+': <b style="color:'+(_FI_SEC_COLORS[sec]||'var(--text)')+'">'+val.toFixed(2)+'</b></span>';
    }
    h += '</div></div>';
  }
  c.innerHTML = h;
  let sh = '<div style="display:grid;grid-template-columns:100px repeat('+_FI_SECTIONS.length+',1fr);gap:4px 8px;font-size:11px;align-items:center">';
  sh += '<div></div>';
  for (const sec of _FI_SECTIONS) {
    sh += '<div style="text-align:center;font-weight:600;color:'+(_FI_SEC_COLORS[sec]||'var(--text)')+'">'+sec.slice(0,5)+'</div>';
  }
  for (const role of _FI_ROLES) {
    if (!fi[role]) fi[role] = {};
    sh += '<div style="font-weight:600;color:var(--accent)">'+_FI_ROLE_LABELS[role]+'</div>';
    for (const sec of _FI_SECTIONS) {
      const val = fi[role][sec] !== undefined ? fi[role][sec] : 1.0;
      const pct = Math.round(val * 100);
      sh += '<div style="display:flex;flex-direction:column;align-items:center">';
      sh += '<input type="range" min="0" max="100" value="'+pct+'" data-fi-role="'+role+'" data-fi-sec="'+sec+'" style="width:100%;accent-color:'+(_FI_SEC_COLORS[sec]||'var(--accent)')+'">';
      sh += '<span class="fi-val" data-fi-role="'+role+'" data-fi-sec="'+sec+'" style="font-size:10px;color:var(--text-dim)">'+pct+'%</span>';
      sh += '</div>';
    }
  }
  sh += '</div>';
  sc.innerHTML = sh;
  sc.querySelectorAll('input[type=range]').forEach(slider => {
    slider.addEventListener('input', () => {
      const role = slider.dataset.fiRole, sec = slider.dataset.fiSec;
      const val = parseInt(slider.value) / 100;
      if (!genConfig.gen_fixture_intensity) genConfig.gen_fixture_intensity = {};
      if (!genConfig.gen_fixture_intensity[role]) genConfig.gen_fixture_intensity[role] = {};
      genConfig.gen_fixture_intensity[role][sec] = parseFloat(val.toFixed(2));
      const lbl = sc.querySelector('span.fi-val[data-fi-role="'+role+'"][data-fi-sec="'+sec+'"]');
      if (lbl) lbl.textContent = slider.value + '%';
    });
  });
}

// ─── Save Generator Config ───
document.getElementById('btnSaveGenConfig').addEventListener('click', async () => {
  const btn = document.getElementById('btnSaveGenConfig'), orig = btn.textContent;
  try {
    const speedDmx = {
      slow: parseInt(document.getElementById('genSpeedSlow').value)||200,
      medium: parseInt(document.getElementById('genSpeedMedium').value)||140,
      fast: parseInt(document.getElementById('genSpeedFast').value)||40,
    };
    const keys = ['gen_speed_dmx','gen_color_palettes','gen_section_styles','gen_genre_presets','gen_movement_styles','gen_genre_aliases','gen_section_effects','gen_cell_patterns','gen_fixture_intensity'];
    const rawFields = {
      genColorPalettesEditor:'gen_color_palettes', genSectionStylesEditor:'gen_section_styles',
      genGenrePresetsEditor:'gen_genre_presets', genMovementStylesEditor:'gen_movement_styles',
      genGenreAliasesEditor:'gen_genre_aliases', genSectionEffectsEditor:'gen_section_effects',
      genCellPatternsEditor:'gen_cell_patterns',
      genFixtureIntensityEditor:'gen_fixture_intensity'
    };
    for (const [eid, cfgKey] of Object.entries(rawFields)) {
      if (GEN_RAW[eid]) {
        const rawEl = document.getElementById(eid.replace('Editor','Raw'));
        try { genConfig[cfgKey] = JSON.parse(rawEl.value); } catch(e) {
          btn.textContent = 'Invalid JSON: '+cfgKey; btn.style.borderColor='var(--danger)'; btn.style.color='var(--danger)';
          setTimeout(()=>{btn.textContent=orig;btn.style.borderColor='';btn.style.color='';},2500); return;
        }
      }
    }
    genConfig.gen_speed_dmx = speedDmx;
    await Promise.all(keys.map(k =>
      fetch('/api/generator-config/'+k, {method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({value:genConfig[k]})})
    ));
    btn.textContent='Saved!'; btn.style.borderColor='var(--green)'; btn.style.color='var(--green)';
  } catch(e) {
    btn.textContent='Error!'; btn.style.borderColor='var(--danger)'; btn.style.color='var(--danger)';
  }
  setTimeout(()=>{btn.textContent=orig;btn.style.borderColor='';btn.style.color='';},1500);
});

// ─── Reset Generator Config ───
document.getElementById('btnResetGenConfig').addEventListener('click', async () => {
  if (!confirm('Reset all generator settings to factory defaults? This cannot be undone.')) return;
  const btn = document.getElementById('btnResetGenConfig'), orig = btn.textContent;
  try {
    genConfig = await fetch('/api/generator-config/reset',{method:'POST'}).then(r=>r.json());
    for (const k of Object.keys(GEN_RAW)) { GEN_RAW[k]=false; document.getElementById(k)&&(document.getElementById(k).style.display=''); const rawEl=document.getElementById(k.replace('Editor','Raw')); if(rawEl) rawEl.style.display='none'; }
    document.querySelectorAll('.gen-json-toggle').forEach(b=>b.classList.remove('active'));
    renderGeneratorConfig();
    btn.textContent='Reset!'; btn.style.borderColor='var(--green)'; btn.style.color='var(--green)';
  } catch(e) {
    btn.textContent='Error!'; btn.style.borderColor='var(--danger)'; btn.style.color='var(--danger)';
  }
  setTimeout(()=>{btn.textContent=orig;btn.style.borderColor='';btn.style.color='';},1500);
});

// ═══════════════════════════════════════════════════════════════
//  Sequence Templates
// ═══════════════════════════════════════════════════════════════
let seqTemplates = [];
let editingTplId = null;

async function loadTemplates() {
  try { seqTemplates = await fetch('/api/sequence-templates').then(r=>r.json()); } catch(e) { seqTemplates = []; }
  renderTemplatesList();
}

function renderTemplatesList() {
  const list = document.getElementById('tplList');
  document.getElementById('tplCount').textContent = seqTemplates.length + ' template(s)';
  if (seqTemplates.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px">No templates yet. Click "+ New Template" to create one.</div>';
    return;
  }
  let h = '<table class="subs-table"><thead><tr><th>Name</th><th>Palette</th><th>Genre</th><th>Strobes</th><th>Config</th><th>Actions</th></tr></thead><tbody>';
  for (const t of seqTemplates) {
    h += '<tr>';
    h += '<td>'+(t.is_default?'<span style="color:var(--accent)">&#9733;</span> ':'')+esc(t.name)+'</td>';
    h += '<td>'+esc(t.palette||'random')+'</td>';
    h += '<td>'+esc(t.genre||'auto')+'</td>';
    h += '<td>'+(t.no_strobes?'Off':'On')+'</td>';
    h += '<td style="font-size:10px;color:var(--text-dim)">'+(t.generator_config?'Snapshot':'Global')+'</td>';
    h += '<td>';
    h += '<button class="btn btn-sm" onclick="editTemplate('+t.id+')" title="Edit">&#9998;</button> ';
    h += '<button class="btn btn-sm" onclick="setDefaultTemplate('+t.id+')" title="Set as default" style="'+(t.is_default?'color:var(--accent)':'')+'">&#9733;</button> ';
    h += '<button class="btn btn-sm" onclick="deleteTemplate('+t.id+')" title="Delete" style="color:var(--danger)">&#10006;</button>';
    h += '</td></tr>';
  }
  h += '</tbody></table>';
  list.innerHTML = h;
}

function openTplModal(tpl) {
  editingTplId = tpl ? tpl.id : null;
  document.getElementById('tplModalTitle').textContent = tpl ? 'Edit Template' : 'New Template';
  document.getElementById('tplName').value = tpl ? tpl.name : '';
  document.getElementById('tplNoStrobes').checked = tpl ? !!tpl.no_strobes : false;
  document.getElementById('tplSnapConfig').checked = !!tpl?.generator_config;
  const palSel = document.getElementById('tplPalette');
  palSel.innerHTML = '<option value="random">Random</option>';
  for (const k of Object.keys(genConfig.gen_color_palettes||{})) {
    const lbl = (genConfig.gen_color_palettes[k]||{}).label || k;
    palSel.innerHTML += '<option value="'+k+'"'+(tpl&&tpl.palette===k?' selected':'')+'>'+esc(lbl)+'</option>';
  }
  if (tpl) palSel.value = tpl.palette || 'random';
  const genSel = document.getElementById('tplGenre');
  genSel.innerHTML = '<option value="auto">Auto-detect</option>';
  for (const [k,v] of Object.entries(genConfig.gen_genre_presets||{})) {
    genSel.innerHTML += '<option value="'+k+'"'+(tpl&&tpl.genre===k?' selected':'')+'>'+esc(v.label||k)+'</option>';
  }
  if (tpl) genSel.value = tpl.genre || 'auto';
  document.getElementById('tplModal').classList.add('open');
}

document.getElementById('btnAddTemplate').addEventListener('click', () => openTplModal(null));

document.getElementById('tplSaveBtn').addEventListener('click', async () => {
  const name = document.getElementById('tplName').value.trim();
  if (!name) { alert('Name is required'); return; }
  const body = {
    name,
    palette: document.getElementById('tplPalette').value,
    genre: document.getElementById('tplGenre').value,
    no_strobes: document.getElementById('tplNoStrobes').checked,
    generator_config: document.getElementById('tplSnapConfig').checked ? genConfig : null,
  };
  const url = editingTplId ? '/api/sequence-templates/'+editingTplId : '/api/sequence-templates';
  const method = editingTplId ? 'PUT' : 'POST';
  await fetch(url, { method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
  document.getElementById('tplModal').classList.remove('open');
  loadTemplates();
});

window.editTemplate = async (id) => { const t = seqTemplates.find(x=>x.id===id); if(t) openTplModal(t); };
window.deleteTemplate = async (id) => { if(!confirm('Delete this template?')) return; await fetch('/api/sequence-templates/'+id,{method:'DELETE'}); loadTemplates(); };
window.setDefaultTemplate = async (id) => { await fetch('/api/sequence-templates/'+id+'/set-default',{method:'POST',headers:{'Content-Type':'application/json'}}); loadTemplates(); };

// ═══════════════════════════════════════════════════════════════
//  Effects Library
// ═══════════════════════════════════════════════════════════════
let cfgEffects = [];
let cfgEditingEffectId = null;

async function loadEffectsConfig() {
  cfgEffects = await fetch('/api/effects').then(r => r.json());
  renderCfgEffectsList();
}

function renderCfgEffectsList() {
  const list = document.getElementById('cfgEffectsList');
  document.getElementById('cfgEffectsCount').textContent = `${cfgEffects.length} effect(s)`;
  if (cfgEffects.length === 0) {
    list.innerHTML = '<div style="color:var(--text-dim);font-size:12px;padding:8px">No effects yet. Click "+ New Effect" to create one.</div>';
    return;
  }
  const TARGET_BADGE = { all: '', color: '\u{1F3A8}', moving_head: '\u{1F526}', moving_head_wash: '\u{1F526}', moving_head_spot: '\u{1F526}', multicell: '\u2593' };
  let html = '<table class="subs-table"><thead><tr><th>Type</th><th>Name</th><th>Target</th><th>Duration</th><th>Actions</th></tr></thead><tbody>';
  for (const eff of cfgEffects) {
    const badge = TARGET_BADGE[eff.fixture_target] || '';
    html += `<tr>` +
      `<td><span class="eff-type ${eff.type}" style="font-size:10px;padding:2px 6px;border-radius:4px;background:var(--panel-border)">${eff.type.replace(/_/g, ' ')}</span></td>` +
      `<td>${esc(eff.name)}</td>` +
      `<td>${badge} ${(eff.fixture_target || 'all').replace(/_/g, ' ')}</td>` +
      `<td>${eff.duration_beats} beats</td>` +
      `<td>` +
      `<button class="btn btn-sm" onclick="cfgEditEffect(${eff.id})" title="Edit">&#9998;</button> ` +
      `<button class="btn btn-sm" onclick="cfgDeleteEffect(${eff.id})" title="Delete" style="color:var(--danger)">&#10006;</button>` +
      `</td></tr>`;
  }
  html += '</tbody></table>';
  list.innerHTML = html;
}

function cfgOpenEffectModal(eff) {
  cfgEditingEffectId = eff ? eff.id : null;
  document.getElementById('effectModalTitle').textContent = eff ? 'Edit Effect' : 'New Effect';
  document.getElementById('effName').value = eff ? eff.name : '';
  document.getElementById('effType').value = eff ? eff.type : 'pulse';
  document.getElementById('effCategory').value = eff ? (eff.category || 'color') : 'color';
  document.getElementById('effFixtureTarget').value = eff ? (eff.fixture_target || 'all') : 'all';
  document.getElementById('effDurBeats').value = eff ? eff.duration_beats : 4;
  cfgRenderEffectParams(eff ? eff.type : 'pulse', eff ? eff.effect_data : {});
  document.getElementById('effectModal').classList.add('open');
}

function cfgRenderEffectParams(type, data) {
  const area = document.getElementById('effParamsArea');
  let html = '';
  const cellRow = (d) => `<div class="form-group"><label>Channels per Cell</label>` +
    `<input type="number" id="effParamCpp" value="${d.channels_per_cell || 3}" min="1" max="20" step="1"></div>`;

  if (type === 'pulse') {
    html = `<div class="form-group"><label>Frequency (cycles per duration)</label><input type="number" id="effParamFreq" value="${data.frequency || 1}" min="0.1" step="0.1"></div>`;
  } else if (type === 'rainbow') {
    html = `<div class="form-group"><label>Hue Cycles</label><input type="number" id="effParamCycles" value="${data.cycles || 1}" min="0.25" step="0.25"></div>`;
  } else if (type === 'strobe') {
    html = `<div class="form-group"><label>Strobe Frequency (Hz)</label><input type="number" id="effParamFreq" value="${data.frequency || 10}" min="1" max="50" step="1"></div>`;
  } else if (type === 'color_fade') {
    const sc = data.start_color || { red: 255, green: 0, blue: 0 };
    const ec = data.end_color || { red: 0, green: 0, blue: 255 };
    const startHex = '#' + [sc.red, sc.green, sc.blue].map(v => (v||0).toString(16).padStart(2,'0')).join('');
    const endHex = '#' + [ec.red, ec.green, ec.blue].map(v => (v||0).toString(16).padStart(2,'0')).join('');
    html = `<div class="form-row"><div class="form-group"><label>Start Color</label><input type="color" id="effParamStartColor" value="${startHex}"></div>` +
      `<div class="form-group"><label>End Color</label><input type="color" id="effParamEndColor" value="${endHex}"></div></div>`;
  } else if (type === 'chase') {
    html = `<div class="form-row"><div class="form-group"><label>Direction</label><select id="effParamDir">` +
      `<option value="left" ${data.direction==='left'?'selected':''}>Left \u2192 Right</option><option value="right" ${data.direction==='right'?'selected':''}>Right \u2192 Left</option>` +
      `<option value="bounce" ${data.direction==='bounce'?'selected':''}>Bounce</option><option value="center" ${data.direction==='center'?'selected':''}>Center Out</option>` +
      `<option value="outside" ${data.direction==='outside'?'selected':''}>Outside In</option></select></div>` +
      `<div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Width (cells)</label><input type="number" id="effParamWidth" value="${data.width||3}" min="1" max="50" step="1"></div>` +
      `<div class="form-group"><label>Tail (cells)</label><input type="number" id="effParamTail" value="${data.tail||0}" min="0" max="50" step="1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'comet') {
    html = `<div class="form-row"><div class="form-group"><label>Direction</label><select id="effParamDir">` +
      `<option value="left" ${data.direction==='left'?'selected':''}>Left \u2192 Right</option><option value="right" ${data.direction==='right'?'selected':''}>Right \u2192 Left</option>` +
      `</select></div><div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Tail Length (cells)</label><input type="number" id="effParamTail" value="${data.tail||10}" min="1" max="50" step="1"></div>${cellRow(data)}</div>`;
  } else if (type === 'scanner') {
    html = `<div class="form-row"><div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Width (cells)</label><input type="number" id="effParamWidth" value="${data.width||1}" min="1" max="50" step="1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Tail (cells)</label><input type="number" id="effParamTail" value="${data.tail||5}" min="0" max="50" step="1"></div>${cellRow(data)}</div>`;
  } else if (type === 'sparkle') {
    html = `<div class="form-row"><div class="form-group"><label>Density (0-1)</label><input type="number" id="effParamDensity" value="${data.density||0.1}" min="0.01" max="1" step="0.01"></div>` +
      `<div class="form-group"><label>Fade Speed</label><input type="number" id="effParamFadeSpd" value="${data.fade_speed||6}" min="1" max="20" step="1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'color_wave') {
    html = `<div class="form-row"><div class="form-group"><label>Wavelength (cells)</label><input type="number" id="effParamWavelength" value="${data.wavelength||20}" min="2" max="200" step="1"></div>` +
      `<div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'fire') {
    html = `<div class="form-row"><div class="form-group"><label>Intensity (0-1)</label><input type="number" id="effParamIntensity" value="${data.intensity||0.8}" min="0.1" max="1" step="0.05"></div>` +
      `<div class="form-group"><label>Cooling (0-1)</label><input type="number" id="effParamCooling" value="${data.cooling||0.3}" min="0" max="1" step="0.05"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'buildup') {
    html = `<div class="form-row"><div class="form-group"><label>Direction</label><select id="effParamDir">` +
      `<option value="left" ${data.direction==='left'?'selected':''}>Left \u2192 Right</option><option value="right" ${data.direction==='right'?'selected':''}>Right \u2192 Left</option>` +
      `<option value="center" ${data.direction==='center'?'selected':''}>Center Out</option></select></div>${cellRow(data)}</div>`;
  } else if (type === 'pan_sweep' || type === 'tilt_sweep') {
    html = `<div class="form-row"><div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Range (0-1)</label><input type="number" id="effParamRange" value="${data.range||1}" min="0.05" max="1" step="0.05"></div></div>`;
  } else if (type === 'circle' || type === 'figure_eight') {
    html = `<div class="form-row"><div class="form-group"><label>Speed (cycles)</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="20" step="0.1"></div>` +
      `<div class="form-group"><label>Size (0-1)</label><input type="number" id="effParamSize" value="${data.size||0.5}" min="0.05" max="1" step="0.05"></div></div>`;
  } else if (type === 'random_move') {
    html = `<div class="form-row"><div class="form-group"><label>Speed</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Range (0-1)</label><input type="number" id="effParamRange" value="${data.range||0.5}" min="0.05" max="1" step="0.05"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Smoothing (0-1)</label><input type="number" id="effParamSmoothing" value="${data.smoothing||0.3}" min="0" max="1" step="0.05"></div></div>`;
  } else if (type === 'fan') {
    html = `<div class="form-row"><div class="form-group"><label>Speed</label><input type="number" id="effParamSpeed" value="${data.speed||0.5}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Spread (0-1)</label><input type="number" id="effParamSpread" value="${data.spread||1}" min="0.1" max="1" step="0.05"></div></div>`;
  } else if (type === 'nod') {
    html = `<div class="form-row"><div class="form-group"><label>Axis</label><select id="effParamAxis">` +
      `<option value="tilt" ${(data.axis||'tilt')==='tilt'?'selected':''}>Tilt (Nod)</option><option value="pan" ${data.axis==='pan'?'selected':''}>Pan (Shake)</option></select></div>` +
      `<div class="form-group"><label>Speed</label><input type="number" id="effParamSpeed" value="${data.speed||2}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Range (0-1)</label><input type="number" id="effParamRange" value="${data.range||0.3}" min="0.05" max="1" step="0.05"></div></div>`;
  } else if (type === 'segments') {
    html = `<div class="form-row"><div class="form-group"><label>Segment Size (cells)</label><input type="number" id="effParamSegSize" value="${data.segment_size||2}" min="1" max="20" step="1"></div>` +
      `<div class="form-group"><label>Offset Speed</label><input type="number" id="effParamSpeed" value="${data.offset_speed||1}" min="0.1" max="20" step="0.1"></div></div>` +
      `<div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'ripple') {
    html = `<div class="form-row"><div class="form-group"><label>Speed</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div>` +
      `<div class="form-group"><label>Width (cells)</label><input type="number" id="effParamWidth" value="${data.width||3}" min="1" max="20" step="1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Decay (0-1)</label><input type="number" id="effParamDecay" value="${data.decay||0.7}" min="0.1" max="1" step="0.05"></div>${cellRow(data)}</div>`;
  } else if (type === 'cell_strobe') {
    html = `<div class="form-row"><div class="form-group"><label>Frequency (Hz)</label><input type="number" id="effParamFreq" value="${data.frequency||8}" min="1" max="30" step="1"></div>` +
      `<div class="form-group"><label>Pattern</label><select id="effParamPattern"><option value="sequential" ${(data.pattern||'sequential')==='sequential'?'selected':''}>Sequential</option>` +
      `<option value="random" ${data.pattern==='random'?'selected':''}>Random</option></select></div></div><div class="form-row">${cellRow(data)}</div>`;
  } else if (type === 'gradient') {
    const colors = data.colors || ['#ff0000', '#0000ff'];
    html = `<div class="form-row"><div class="form-group"><label>Speed</label><input type="number" id="effParamSpeed" value="${data.speed||1}" min="0.1" max="10" step="0.1"></div></div>` +
      `<div class="form-row"><div class="form-group"><label>Color 1</label><input type="color" id="effParamGradC1" value="${colors[0]||'#ff0000'}"></div>` +
      `<div class="form-group"><label>Color 2</label><input type="color" id="effParamGradC2" value="${colors[1]||'#0000ff'}"></div>` +
      `<div class="form-group"><label>Color 3 (opt)</label><input type="color" id="effParamGradC3" value="${colors[2]||'#000000'}"></div></div>` +
      `<div class="form-row"><div class="form-group"><label><input type="checkbox" id="effParamGradC3On" ${colors.length>=3?'checked':''}> Use 3rd color</label></div>${cellRow(data)}</div>`;
  }
  area.innerHTML = html;
}

function cfgGetEffectDataFromForm(type) {
  if (type === 'pulse') return { frequency: +(document.getElementById('effParamFreq')?.value || 1) };
  if (type === 'rainbow') return { cycles: +(document.getElementById('effParamCycles')?.value || 1) };
  if (type === 'strobe') return { frequency: +(document.getElementById('effParamFreq')?.value || 10) };
  if (type === 'color_fade') {
    const hexToRgb = (h) => ({ red: parseInt(h.slice(1,3),16), green: parseInt(h.slice(3,5),16), blue: parseInt(h.slice(5,7),16) });
    return { start_color: hexToRgb(document.getElementById('effParamStartColor')?.value || '#ff0000'), end_color: hexToRgb(document.getElementById('effParamEndColor')?.value || '#0000ff') };
  }
  if (type === 'chase') return { direction: document.getElementById('effParamDir')?.value || 'left', speed: +(document.getElementById('effParamSpeed')?.value || 1), width: +(document.getElementById('effParamWidth')?.value || 3), tail: +(document.getElementById('effParamTail')?.value || 0), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'comet') return { direction: document.getElementById('effParamDir')?.value || 'left', speed: +(document.getElementById('effParamSpeed')?.value || 1), tail: +(document.getElementById('effParamTail')?.value || 10), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'scanner') return { speed: +(document.getElementById('effParamSpeed')?.value || 1), width: +(document.getElementById('effParamWidth')?.value || 1), tail: +(document.getElementById('effParamTail')?.value || 5), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'sparkle') return { density: +(document.getElementById('effParamDensity')?.value || 0.1), fade_speed: +(document.getElementById('effParamFadeSpd')?.value || 6), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'color_wave') return { wavelength: +(document.getElementById('effParamWavelength')?.value || 20), speed: +(document.getElementById('effParamSpeed')?.value || 1), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'fire') return { intensity: +(document.getElementById('effParamIntensity')?.value || 0.8), cooling: +(document.getElementById('effParamCooling')?.value || 0.3), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'buildup') return { direction: document.getElementById('effParamDir')?.value || 'left', channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'pan_sweep' || type === 'tilt_sweep') return { speed: +(document.getElementById('effParamSpeed')?.value || 1), range: +(document.getElementById('effParamRange')?.value || 1) };
  if (type === 'circle' || type === 'figure_eight') return { speed: +(document.getElementById('effParamSpeed')?.value || 1), size: +(document.getElementById('effParamSize')?.value || 0.5) };
  if (type === 'random_move') return { speed: +(document.getElementById('effParamSpeed')?.value || 1), range: +(document.getElementById('effParamRange')?.value || 0.5), smoothing: +(document.getElementById('effParamSmoothing')?.value || 0.3) };
  if (type === 'fan') return { speed: +(document.getElementById('effParamSpeed')?.value || 0.5), spread: +(document.getElementById('effParamSpread')?.value || 1) };
  if (type === 'nod') return { axis: document.getElementById('effParamAxis')?.value || 'tilt', speed: +(document.getElementById('effParamSpeed')?.value || 2), range: +(document.getElementById('effParamRange')?.value || 0.3) };
  if (type === 'segments') return { segment_size: +(document.getElementById('effParamSegSize')?.value || 2), offset_speed: +(document.getElementById('effParamSpeed')?.value || 1), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'ripple') return { speed: +(document.getElementById('effParamSpeed')?.value || 1), width: +(document.getElementById('effParamWidth')?.value || 3), decay: +(document.getElementById('effParamDecay')?.value || 0.7), channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'cell_strobe') return { frequency: +(document.getElementById('effParamFreq')?.value || 8), pattern: document.getElementById('effParamPattern')?.value || 'sequential', channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  if (type === 'gradient') {
    const colors = [document.getElementById('effParamGradC1')?.value || '#ff0000', document.getElementById('effParamGradC2')?.value || '#0000ff'];
    if (document.getElementById('effParamGradC3On')?.checked) colors.push(document.getElementById('effParamGradC3')?.value || '#00ff00');
    return { speed: +(document.getElementById('effParamSpeed')?.value || 1), colors, channels_per_cell: +(document.getElementById('effParamCpp')?.value || 3) };
  }
  return {};
}

async function cfgSaveEffect() {
  const name = document.getElementById('effName').value.trim();
  if (!name) { alert('Name is required'); return; }
  const type = document.getElementById('effType').value;
  const category = document.getElementById('effCategory').value;
  const fixture_target = document.getElementById('effFixtureTarget').value;
  const duration_beats = +(document.getElementById('effDurBeats').value || 4);
  const effect_data = cfgGetEffectDataFromForm(type);
  const body = { name, type, category, fixture_target, effect_data, duration_beats };
  if (cfgEditingEffectId) {
    const res = await fetch(`/api/effects/${cfgEditingEffectId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    const idx = cfgEffects.findIndex(e => e.id === cfgEditingEffectId);
    if (idx >= 0) cfgEffects[idx] = result;
  } else {
    const res = await fetch('/api/effects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await res.json();
    cfgEffects.push(result);
  }
  document.getElementById('effectModal').classList.remove('open');
  renderCfgEffectsList();
}

window.cfgEditEffect = (id) => { const eff = cfgEffects.find(e => e.id === id); if (eff) cfgOpenEffectModal(eff); };
window.cfgDeleteEffect = async (id) => { if (!confirm('Delete this effect?')) return; await fetch(`/api/effects/${id}`, { method: 'DELETE' }); cfgEffects = cfgEffects.filter(e => e.id !== id); renderCfgEffectsList(); };

document.getElementById('cfgAddEffectBtn').addEventListener('click', () => cfgOpenEffectModal(null));
document.getElementById('effSaveBtn').addEventListener('click', cfgSaveEffect);
document.getElementById('effType').addEventListener('change', (e) => {
  cfgRenderEffectParams(e.target.value, {});
  const movingTypes = ['pan_sweep','tilt_sweep','circle','figure_eight','random_move','fan','nod'];
  const multicellOnlyTypes = ['segments','ripple','cell_strobe','gradient'];
  const colorTypes = ['pulse','rainbow','strobe','color_fade','sparkle','color_wave','fire'];
  const sel = document.getElementById('effFixtureTarget');
  if (movingTypes.includes(e.target.value)) sel.value = 'moving_head';
  else if (multicellOnlyTypes.includes(e.target.value)) sel.value = 'multicell';
  else if (colorTypes.includes(e.target.value)) sel.value = 'color';
  else sel.value = 'all';
});

// ═══════════════════════════════════════════════════════════════
//  Database
// ═══════════════════════════════════════════════════════════════
async function loadDatabaseConfig() {
  try {
    const stats = await fetch('/api/db/stats').then(r => r.json());
    document.getElementById('dbStatTracks').textContent = stats.tracks || 0;
    document.getElementById('dbStatAnalyses').textContent = stats.analyses || 0;
    document.getElementById('dbStatSequences').textContent = stats.sequences || 0;
    document.getElementById('dbStatCues').textContent = stats.cues || 0;
    document.getElementById('dbStatFixtures').textContent = stats.fixtures || 0;
    document.getElementById('dbStatEffects').textContent = stats.effects || 0;
    document.getElementById('dbTrackSearch').value = '';
    document.getElementById('dbTrackSelectedId').value = '';
    document.getElementById('dbTrackResults').style.display = 'none';
    document.getElementById('btnDeleteTrackAnalysis').disabled = true;
    document.getElementById('btnDeleteTrackSequence').disabled = true;
  } catch(e) { console.error('Failed to load database config', e); }
}

let _dbTrackSearchTimer = null;
document.getElementById('dbTrackSearch').addEventListener('input', function() {
  clearTimeout(_dbTrackSearchTimer);
  document.getElementById('dbTrackSelectedId').value = '';
  document.getElementById('btnDeleteTrackAnalysis').disabled = true;
  document.getElementById('btnDeleteTrackSequence').disabled = true;
  document.getElementById('btnSeparateTrackStems').disabled = true;
  document.getElementById('dbTrackActionResult').textContent = '';
  const q = this.value.trim();
  if (q.length < 2) { document.getElementById('dbTrackResults').style.display = 'none'; return; }
  _dbTrackSearchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/tracks?search=${encodeURIComponent(q)}&limit=20`);
      const data = await res.json();
      const tracks = Array.isArray(data) ? data : (data.tracks || []);
      const wrap = document.getElementById('dbTrackResults');
      if (tracks.length === 0) {
        wrap.innerHTML = '<div style="padding:8px 12px;font-size:12px;color:var(--text-dim)">No tracks found</div>';
      } else {
        wrap.innerHTML = tracks.map(t =>
          `<div class="db-track-result" data-id="${t.id}" style="padding:6px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)" onmouseenter="this.style.background='rgba(255,255,255,.06)'" onmouseleave="this.style.background=''">`
          + `<strong>${esc(t.title || t.filename || 'Untitled')}</strong> <span style="color:var(--text-dim)">\u2014 ${esc(t.author || 'Unknown')}</span></div>`
        ).join('');
      }
      wrap.style.display = 'block';
    } catch(e) { console.error(e); }
  }, 250);
});

document.getElementById('dbTrackResults').addEventListener('click', function(e) {
  const item = e.target.closest('.db-track-result');
  if (!item) return;
  document.getElementById('dbTrackSelectedId').value = item.dataset.id;
  document.getElementById('dbTrackSearch').value = item.textContent.trim();
  this.style.display = 'none';
  document.getElementById('btnDeleteTrackAnalysis').disabled = false;
  document.getElementById('btnDeleteTrackSequence').disabled = false;
  document.getElementById('btnSeparateTrackStems').disabled = false;
});

document.addEventListener('click', function(e) {
  if (!e.target.closest('#dbTrackSearch') && !e.target.closest('#dbTrackResults')) {
    document.getElementById('dbTrackResults').style.display = 'none';
  }
});

document.getElementById('btnDeleteTrackAnalysis').addEventListener('click', async () => {
  const trackId = document.getElementById('dbTrackSelectedId').value;
  if (!trackId) return;
  const trackLabel = document.getElementById('dbTrackSearch').value;
  if (!confirm(`Delete analysis data for "${trackLabel}"?`)) return;
  try {
    await fetch(`/api/tracks/${trackId}/analysis`, { method: 'DELETE' });
    document.getElementById('dbTrackActionResult').innerHTML = '<span style="color:var(--green)">Analysis deleted.</span>';
    loadDatabaseConfig();
  } catch(e) {
    document.getElementById('dbTrackActionResult').innerHTML = '<span style="color:var(--danger)">Failed to delete analysis.</span>';
  }
});

document.getElementById('btnSeparateTrackStems').addEventListener('click', async () => {
  const trackId = document.getElementById('dbTrackSelectedId').value;
  if (!trackId) return;
  const btn = document.getElementById('btnSeparateTrackStems');
  btn.disabled = true;
  btn.textContent = '\u23F3 Separating...';
  document.getElementById('stemProgressBar').style.display = 'block';
  document.getElementById('stemProgressFill').style.width = '0%';
  document.getElementById('stemProgressLabel').textContent = 'Starting stem separation...';
  document.getElementById('dbTrackActionResult').textContent = '';
  try {
    const res = await fetch(`/api/tracks/${trackId}/separate-stems`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'auto' }),
    });
    const data = await res.json();
    if (!res.ok) {
      document.getElementById('dbTrackActionResult').innerHTML = `<span style="color:var(--danger)">${esc(data.error || 'Failed')}</span>`;
      btn.textContent = '\u{1F3B5} Separate Stems';
      btn.disabled = false;
      document.getElementById('stemProgressBar').style.display = 'none';
    }
  } catch(e) {
    document.getElementById('dbTrackActionResult').innerHTML = `<span style="color:var(--danger)">Error: ${esc(e.message)}</span>`;
    btn.textContent = '\u{1F3B5} Separate Stems';
    btn.disabled = false;
    document.getElementById('stemProgressBar').style.display = 'none';
  }
});

document.getElementById('btnDeleteTrackSequence').addEventListener('click', async () => {
  const trackId = document.getElementById('dbTrackSelectedId').value;
  if (!trackId) return;
  const trackLabel = document.getElementById('dbTrackSearch').value;
  if (!confirm(`Delete sequence linked to "${trackLabel}"?`)) return;
  try {
    const seqRes = await fetch(`/api/sequences/by-track/${trackId}`);
    if (!seqRes.ok) {
      document.getElementById('dbTrackActionResult').innerHTML = '<span style="color:var(--text-dim)">No sequence linked to this track.</span>';
      return;
    }
    const seq = await seqRes.json();
    await fetch(`/api/sequences/${seq.id}`, { method: 'DELETE' });
    document.getElementById('dbTrackActionResult').innerHTML = '<span style="color:var(--green)">Sequence deleted.</span>';
    loadDatabaseConfig();
  } catch(e) {
    document.getElementById('dbTrackActionResult').innerHTML = '<span style="color:var(--danger)">Failed to delete sequence.</span>';
  }
});

document.getElementById('btnDeleteAllAnalysis').addEventListener('click', async () => {
  if (!confirm('Delete ALL analysis data? This cannot be undone.')) return;
  if (!confirm('Are you sure? All waveform, beat, and section data will be permanently removed.')) return;
  const btn = document.getElementById('btnDeleteAllAnalysis');
  btn.disabled = true; btn.textContent = 'Deleting\u2026';
  try {
    const res = await fetch('/api/db/analysis', { method: 'DELETE' });
    const data = await res.json();
    btn.textContent = `Deleted ${data.deleted}`;
    btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
    loadDatabaseConfig();
  } catch(e) { btn.textContent = 'Error!'; }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Delete All Analyses'; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
});

document.getElementById('btnDeleteAllSequences').addEventListener('click', async () => {
  if (!confirm('Delete ALL sequences and their cues? This cannot be undone.')) return;
  if (!confirm('Are you sure? Every light sequence will be permanently removed.')) return;
  const btn = document.getElementById('btnDeleteAllSequences');
  btn.disabled = true; btn.textContent = 'Deleting\u2026';
  try {
    const res = await fetch('/api/db/sequences', { method: 'DELETE' });
    const data = await res.json();
    btn.textContent = `Deleted ${data.deleted}`;
    btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
    loadDatabaseConfig();
  } catch(e) { btn.textContent = 'Error!'; }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Delete All Sequences'; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
});

document.getElementById('btnDeleteAllTracks').addEventListener('click', async () => {
  if (!confirm('Delete ALL tracks from the library? This also removes all linked analyses and sequences. This cannot be undone.')) return;
  if (!confirm('FINAL WARNING: This will wipe your entire track library. Continue?')) return;
  const btn = document.getElementById('btnDeleteAllTracks');
  btn.disabled = true; btn.textContent = 'Deleting\u2026';
  try {
    await fetch('/api/db/analysis', { method: 'DELETE' });
    await fetch('/api/db/sequences', { method: 'DELETE' });
    await fetch('/api/tracks', { method: 'DELETE' });
    btn.textContent = 'Done!';
    btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
    loadDatabaseConfig();
  } catch(e) { btn.textContent = 'Error!'; }
  setTimeout(() => { btn.disabled = false; btn.textContent = 'Delete All Tracks'; btn.style.borderColor = ''; btn.style.color = ''; }, 2000);
});

document.getElementById('btnDbBackup').addEventListener('click', async () => {
  const btn = document.getElementById('btnDbBackup');
  const status = document.getElementById('dbBackupStatus');
  btn.disabled = true; btn.textContent = 'Creating backup\u2026';
  status.textContent = '';
  try {
    const res = await fetch('/api/db/backup');
    if (!res.ok) throw new Error('Server error');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const d = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.download = `dmx-controller-backup-${d}.db`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.innerHTML = '<span style="color:var(--green)">Backup downloaded.</span>';
  } catch(e) {
    status.innerHTML = '<span style="color:var(--danger)">Backup failed: ' + (e.message || 'Unknown error') + '</span>';
  }
  btn.disabled = false; btn.textContent = '\uD83D\uDCBE Download Backup';
});

document.getElementById('dbRestoreFile').addEventListener('change', () => {
  document.getElementById('btnDbRestore').disabled = !document.getElementById('dbRestoreFile').files.length;
});

document.getElementById('btnDbRestore').addEventListener('click', async () => {
  const file = document.getElementById('dbRestoreFile').files[0];
  if (!file) return;
  if (!confirm('This will REPLACE the current database with the uploaded file. The server will restart. Continue?')) return;
  if (!confirm('FINAL WARNING: ALL current data will be overwritten. This cannot be undone.')) return;
  const btn = document.getElementById('btnDbRestore');
  const status = document.getElementById('dbRestoreStatus');
  btn.disabled = true; btn.textContent = 'Restoring\u2026';
  status.textContent = '';
  try {
    const buf = await file.arrayBuffer();
    const res = await fetch('/api/db/restore', { method: 'POST', body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Restore failed'); }
    status.innerHTML = '<span style="color:var(--green)">Database restored! Reloading\u2026</span>';
    setTimeout(() => location.reload(), 2000);
  } catch(e) {
    status.innerHTML = '<span style="color:var(--danger)">Restore failed: ' + (e.message || 'Unknown error') + '</span>';
    btn.disabled = false; btn.textContent = 'Restore';
  }
});

// ═══════════════════════════════════════════════════════════════
//  Touch Actions Grid
// ═══════════════════════════════════════════════════════════════
let _touchActionsList = [];
let _taScenes = [];
let _taMoverPresets = [];

async function loadTouchActionsConfig() {
  try {
    const [actions, scenes, presets] = await Promise.all([
      fetch('/api/touch-actions').then(r => r.json()),
      fetch('/api/scenes').then(r => r.json()),
      fetch('/api/mover-presets').then(r => r.json()),
    ]);
    _touchActionsList = actions;
    _taScenes = scenes;
    _taMoverPresets = presets;
    renderTouchActionsTable();
  } catch (e) { console.error('Failed to load touch actions', e); }
}

function renderTouchActionsTable() {
  const tbody = document.getElementById('touchActionsBody');
  document.getElementById('touchActionCount').textContent = _touchActionsList.length + ' action(s)';
  if (!_touchActionsList.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim)">No actions configured. Click "+ Add Action" to create one.</td></tr>';
    return;
  }
  const typeLabels = {
    color: 'Color', quick_action: 'Quick Action', scene: 'Scene',
    mover_preset: 'Mover Preset', strobe: 'Strobe', smoke: 'Smoke',
    haze: 'Haze', blackout: 'Blackout', master_dimmer: 'Master Dimmer',
  };
  tbody.innerHTML = _touchActionsList.map(a => {
    return '<tr>' +
      '<td><span style="display:inline-block;width:16px;height:16px;border-radius:50%;background:' + (a.enabled ? 'var(--green)' : 'var(--text-dim)') + '"></span></td>' +
      '<td>' + esc(a.label) + (a.icon ? ' ' + a.icon : '') + '</td>' +
      '<td>' + (typeLabels[a.action_type] || a.action_type) + '</td>' +
      '<td><span style="display:inline-block;width:24px;height:24px;border-radius:4px;background:' + (a.color || '#333') + ';border:1px solid rgba(255,255,255,.1)"></span></td>' +
      '<td>' + (a.grid_row || 0) + '</td>' +
      '<td>' + (a.grid_col || 0) + '</td>' +
      '<td>' + (a.grid_w || 1) + '</td>' +
      '<td>' + (a.grid_h || 1) + '</td>' +
      '<td>' +
        '<button class="btn btn-secondary btn-xs" onclick="openTouchActionModal(' + a.id + ')">Edit</button> ' +
        '<button class="btn btn-secondary btn-xs" onclick="toggleTouchAction(' + a.id + ',' + (a.enabled ? 0 : 1) + ')">' + (a.enabled ? 'Disable' : 'Enable') + '</button> ' +
        '<button class="btn btn-danger btn-xs" onclick="deleteTouchAction(' + a.id + ')">Delete</button>' +
      '</td></tr>';
  }).join('');
}

document.getElementById('btnAddTouchAction').addEventListener('click', () => openTouchActionModal(null));

document.getElementById('btnAutoPopulate').addEventListener('click', async () => {
  const hasExisting = _touchActionsList.length > 0;
  const msg = hasExisting
    ? 'This will DELETE all existing actions and replace them with auto-generated ones.\n\nContinue?'
    : 'Auto-populate the Actions grid with colors, quick actions, effects, scenes, and mover presets?';
  if (!confirm(msg)) return;
  try {
    const resp = await fetch('/api/touch-actions/auto-populate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    });
    const data = await resp.json();
    if (data.error) { alert('Error: ' + data.error); return; }
    _touchActionsList = data.actions || [];
    renderTouchActionsTable();
  } catch (e) { console.error('Auto-populate failed', e); alert('Auto-populate failed.'); }
});

window.openTouchActionModal = function(id) {
  const modal = document.getElementById('touchActionModal');
  const a = id ? _touchActionsList.find(x => x.id === id) : null;
  document.getElementById('touchActionModalTitle').textContent = a ? 'Edit Action' : 'Add Action';
  document.getElementById('taId').value = a ? a.id : '';
  document.getElementById('taLabel').value = a ? a.label : '';
  document.getElementById('taIcon').value = a ? a.icon : '';
  document.getElementById('taActionType').value = a ? a.action_type : 'color';
  document.getElementById('taBtnColor').value = a ? a.color : '#333333';
  document.getElementById('taTxtColor').value = a ? a.text_color : '#ffffff';
  document.getElementById('taRow').value = a ? (a.grid_row || 0) : 0;
  document.getElementById('taCol').value = a ? (a.grid_col || 0) : 0;
  document.getElementById('taW').value = a ? (a.grid_w || 1) : 1;
  document.getElementById('taH').value = a ? (a.grid_h || 1) : 1;
  document.getElementById('taSortOrder').value = a ? (a.sort_order || 0) : 0;
  const data = a ? a.action_data : {};
  document.getElementById('taColorR').value = data.red || 0;
  document.getElementById('taColorG').value = data.green || 0;
  document.getElementById('taColorB').value = data.blue || 0;
  document.getElementById('taColorW').value = data.white || 0;
  document.getElementById('taQuickAction').value = data.action || 'fullWhite';
  document.getElementById('taDimmerValue').value = data.value !== undefined ? data.value : 255;
  const sceneSel = document.getElementById('taScene');
  sceneSel.innerHTML = _taScenes.map(s => '<option value="' + s.id + '"' + (data.scene_id === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  const moverSel = document.getElementById('taMoverPreset');
  moverSel.innerHTML = _taMoverPresets.map((p, i) => '<option value="' + i + '"' + (data.preset_index === i ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  updateTaFieldVisibility();
  modal.classList.add('open');
};

document.getElementById('taActionType').addEventListener('change', updateTaFieldVisibility);

function updateTaFieldVisibility() {
  const type = document.getElementById('taActionType').value;
  document.getElementById('taColorFields').style.display = type === 'color' ? 'block' : 'none';
  document.getElementById('taQuickActionFields').style.display = type === 'quick_action' ? 'block' : 'none';
  document.getElementById('taSceneFields').style.display = type === 'scene' ? 'block' : 'none';
  document.getElementById('taMoverFields').style.display = type === 'mover_preset' ? 'block' : 'none';
  document.getElementById('taDimmerFields').style.display = type === 'master_dimmer' ? 'block' : 'none';
}

document.getElementById('btnSaveTouchAction').addEventListener('click', async () => {
  const id = document.getElementById('taId').value;
  const type = document.getElementById('taActionType').value;
  let action_data = {};
  switch (type) {
    case 'color':
      action_data = { red: +document.getElementById('taColorR').value, green: +document.getElementById('taColorG').value, blue: +document.getElementById('taColorB').value, white: +document.getElementById('taColorW').value }; break;
    case 'quick_action':
      action_data = { action: document.getElementById('taQuickAction').value }; break;
    case 'scene':
      action_data = { scene_id: +document.getElementById('taScene').value }; break;
    case 'mover_preset':
      action_data = { preset_index: +document.getElementById('taMoverPreset').value }; break;
    case 'master_dimmer':
      action_data = { value: +document.getElementById('taDimmerValue').value }; break;
  }
  const body = {
    label: document.getElementById('taLabel').value, icon: document.getElementById('taIcon').value,
    action_type: type, action_data,
    color: document.getElementById('taBtnColor').value, text_color: document.getElementById('taTxtColor').value,
    grid_row: +document.getElementById('taRow').value, grid_col: +document.getElementById('taCol').value,
    grid_w: +document.getElementById('taW').value, grid_h: +document.getElementById('taH').value,
    sort_order: +document.getElementById('taSortOrder').value, enabled: true,
  };
  try {
    if (id) { await fetch('/api/touch-actions/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); }
    else { await fetch('/api/touch-actions', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) }); }
    document.getElementById('touchActionModal').classList.remove('open');
    loadTouchActionsConfig();
  } catch (e) { console.error('Failed to save touch action', e); }
});

window.toggleTouchAction = async (id, enabled) => {
  await fetch('/api/touch-actions/' + id, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ enabled: !!enabled }) });
  loadTouchActionsConfig();
};

window.deleteTouchAction = async (id) => {
  if (!confirm('Delete this action button?')) return;
  await fetch('/api/touch-actions/' + id, { method: 'DELETE' });
  loadTouchActionsConfig();
};

// ═══════════════════════════════════════════════════════════════
//  Network / mDNS
// ═══════════════════════════════════════════════════════════════
async function loadNetworkConfig() {
  try {
    const [config, status] = await Promise.all([
      fetch('/api/config').then(r => r.json()),
      fetch('/api/mdns/status').then(r => r.json()),
    ]);
    document.getElementById('cfgMdnsEnabled').checked = config.mdns_enabled !== '0';
    document.getElementById('cfgMdnsHostname').value = config.mdns_hostname || 'dmxcontrol';
    updateMdnsStatus(status);
  } catch(e) { console.error('Failed to load network config', e); }
}

function updateMdnsStatus(s) {
  if (s.responder_active && s.enabled) {
    document.getElementById('mdnsStatusBadge').innerHTML = '<span style="color:var(--green)">&#9679; Active</span>';
    document.getElementById('mdnsStatusAddr').innerHTML = `<a href="http://${s.fqdn}:${s.web_port}" style="color:var(--accent)" target="_blank">http://${s.fqdn}:${s.web_port}</a>`;
  } else {
    document.getElementById('mdnsStatusBadge').innerHTML = '<span style="color:var(--text-dim)">&#9679; Inactive</span>';
    document.getElementById('mdnsStatusAddr').textContent = '\u2014';
  }
  document.getElementById('mdnsStatusIP').textContent = s.ip || '\u2014';
  document.getElementById('mdnsStatusWebPort').textContent = s.web_port || '\u2014';
  document.getElementById('mdnsStatusOs2lPort').textContent = s.os2l_port || '\u2014';
}

// ═══════════════════════════════════════════════════════════════
//  About
// ═══════════════════════════════════════════════════════════════
async function loadAboutInfo() {
  try {
    const info = await fetch('/api/version').then(r => r.json());
    document.getElementById('aboutVersion').textContent     = 'Version ' + info.version;
    document.getElementById('aboutVersionValue').textContent = info.version;
    document.getElementById('aboutNodeVersion').textContent  = info.node + ' (' + info.platform + '/' + info.arch + ')';
    document.getElementById('aboutFfmpegVersion').textContent  = info.ffmpeg || '\u2014';
    document.getElementById('aboutFfprobeVersion').textContent = info.ffprobe || '\u2014';
    const tbody = document.getElementById('aboutLicensesBody');
    tbody.innerHTML = '';
    if (info.licenses && info.licenses.length) {
      for (const dep of info.licenses) {
        const tr = document.createElement('tr');
        const nameHtml = dep.homepage
          ? `<a href="${dep.homepage}" target="_blank" rel="noopener" style="color:var(--cyan);text-decoration:none">${dep.name}</a>`
          : dep.name;
        tr.innerHTML = `<td>${nameHtml}</td><td>${dep.version}</td><td>${dep.license}</td><td style="color:var(--text-dim)">${dep.author || '\u2014'}</td>`;
        tbody.appendChild(tr);
      }
    }
  } catch (e) { console.error('Failed to load version info', e); }
}

// ═══════════════════════════════════════════════════════════════
//  App Settings
// ═══════════════════════════════════════════════════════════════
async function loadAppSettings() {
  try {
    const config = await fetch('/api/config').then(r => r.json());
    const chk = document.getElementById('settingDmxOnStartup');
    const lbl = document.getElementById('settingDmxOnStartupLabel');
    const isOn = config.dmx_output_on_startup === '1' || config.dmx_output_on_startup === 'true';
    chk.checked = isOn;
    lbl.textContent = isOn ? 'On' : 'Off';
    const dbgChk = document.getElementById('settingDebugLogging');
    const dbgLbl = document.getElementById('settingDebugLoggingLabel');
    const dbgOn = config.debug_logging === '1';
    dbgChk.checked = dbgOn;
    dbgLbl.textContent = dbgOn ? 'On' : 'Off';
    if (config.analysis_target_peaks)       document.getElementById('settingAnalysisPeaks').value       = config.analysis_target_peaks;
    if (config.analysis_sample_rate)        document.getElementById('settingAnalysisSampleRate').value   = config.analysis_sample_rate;
    if (config.analysis_section_sensitivity) document.getElementById('settingAnalysisSensitivity').value = config.analysis_section_sensitivity;
    if (config.analysis_normalize_pct)      document.getElementById('settingAnalysisNormalize').value    = config.analysis_normalize_pct;
    (async () => {
      try {
        const stemRes = await fetch('/api/stems/status');
        const stemInfo = await stemRes.json();
        const icon = document.getElementById('stemStatusIcon');
        const label = document.getElementById('stemStatusLabel');
        const detail = document.getElementById('stemStatusDetail');
        if (stemInfo.demucs && stemInfo.demucs.available) {
          icon.textContent = '\u2705'; label.textContent = 'Demucs Available';
          detail.textContent = `Mode: ${stemInfo.demucs.mode}${stemInfo.demucs.version ? ' v' + stemInfo.demucs.version : ''} \u2014 high-quality ML-based stem separation`;
        } else if (stemInfo.spectral_fallback) {
          icon.textContent = '\u26A1'; label.textContent = 'Spectral Fallback (FFmpeg)';
          detail.textContent = 'FFmpeg spectral filters available \u2014 frequency-band isolation (no Demucs detected)';
        } else {
          icon.textContent = '\u274C'; label.textContent = 'Not Available';
          detail.textContent = 'Neither Demucs nor FFmpeg detected. Install Demucs or ensure FFmpeg is in PATH.';
        }
      } catch (e) {
        document.getElementById('stemStatusIcon').textContent = '\u26A0\uFE0F';
        document.getElementById('stemStatusLabel').textContent = 'Status Check Failed';
        document.getElementById('stemStatusDetail').textContent = e.message;
      }
    })();
    const authChk = document.getElementById('settingAuthEnabled');
    const authLbl = document.getElementById('settingAuthEnabledLabel');
    const authOn = config.auth_enabled === '1';
    authChk.checked = authOn;
    authLbl.textContent = authOn ? 'On' : 'Off';
    document.getElementById('authCredentialsRow').style.display = authOn ? '' : 'none';
    if (config.auth_username) document.getElementById('settingAuthUsername').value = config.auth_username;
    document.getElementById('settingAuthPassword').value = '';
    document.getElementById('authSaveStatus').textContent = '';
    const touchPinOn = config.touch_pin_enabled === '1';
    const touchPinChk = document.getElementById('settingTouchPinEnabled');
    const touchPinLbl = document.getElementById('settingTouchPinEnabledLabel');
    touchPinChk.checked = touchPinOn;
    touchPinLbl.textContent = touchPinOn ? 'On' : 'Off';
    document.getElementById('touchPinConfigRow').style.display = touchPinOn ? '' : 'none';
    document.getElementById('touchPinTimeoutRow').style.display = touchPinOn ? '' : 'none';
    if (config.touch_pin) document.getElementById('settingTouchPin').value = config.touch_pin;
    document.getElementById('settingTouchPinTimeout').value = config.touch_pin_idle_timeout || '0';
    document.getElementById('touchPinSaveStatus').textContent = '';
  } catch(e) { console.error('Failed to load app settings', e); }
}

document.getElementById('settingDmxOnStartup').addEventListener('change', async function() {
  const val = this.checked ? '1' : '0';
  document.getElementById('settingDmxOnStartupLabel').textContent = this.checked ? 'On' : 'Off';
  try { await fetch('/api/config/dmx_output_on_startup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) }); } catch(e) { console.error('Failed to save setting', e); }
});

document.getElementById('settingDebugLogging').addEventListener('change', async function() {
  const val = this.checked ? '1' : '0';
  document.getElementById('settingDebugLoggingLabel').textContent = this.checked ? 'On' : 'Off';
  try { await fetch('/api/config/debug_logging', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: val }) }); } catch(e) { console.error('Failed to save debug logging setting', e); }
});

['settingAnalysisPeaks', 'settingAnalysisSampleRate', 'settingAnalysisSensitivity', 'settingAnalysisNormalize'].forEach(id => {
  const keyMap = { settingAnalysisPeaks: 'analysis_target_peaks', settingAnalysisSampleRate: 'analysis_sample_rate', settingAnalysisSensitivity: 'analysis_section_sensitivity', settingAnalysisNormalize: 'analysis_normalize_pct' };
  document.getElementById(id).addEventListener('change', async function() {
    try { await fetch(`/api/config/${keyMap[id]}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: this.value }) }); } catch(e) { console.error('Failed to save analysis setting', e); }
  });
});

document.getElementById('settingAuthEnabled').addEventListener('change', async function() {
  const enabled = this.checked;
  const lbl = document.getElementById('settingAuthEnabledLabel');
  const credRow = document.getElementById('authCredentialsRow');
  lbl.textContent = enabled ? 'On' : 'Off';
  credRow.style.display = enabled ? '' : 'none';
  if (!enabled) {
    try {
      await authFetch('/api/auth/setup', { method: 'POST', body: JSON.stringify({ enabled: false }) });
      _authEnabled = false; _authToken = null; sessionStorage.removeItem('authToken');
      document.getElementById('authSaveStatus').innerHTML = '<span style="color:var(--green)">Auth disabled</span>';
    } catch (e) { console.error('Failed to disable auth', e); }
  } else {
    document.getElementById('settingAuthUsername').focus();
    document.getElementById('authSaveStatus').textContent = 'Set username and password, then click Save.';
  }
});

document.getElementById('btnSaveAuthCredentials').addEventListener('click', async function() {
  const username = document.getElementById('settingAuthUsername').value.trim();
  const password = document.getElementById('settingAuthPassword').value;
  const statusEl = document.getElementById('authSaveStatus');
  statusEl.textContent = '';
  if (!username) { statusEl.innerHTML = '<span style="color:var(--accent)">Username is required</span>'; return; }
  if (!password || password.length < 4) { statusEl.innerHTML = '<span style="color:var(--accent)">Password must be at least 4 characters</span>'; return; }
  this.disabled = true; this.textContent = 'Saving...';
  try {
    const res = await fetch('/api/auth/setup', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ enabled: true, username, password }) });
    const data = await res.json();
    if (!res.ok) { statusEl.innerHTML = `<span style="color:var(--accent)">${data.error || 'Save failed'}</span>`; return; }
    if (data.token) { _authToken = data.token; sessionStorage.setItem('authToken', data.token); }
    _authEnabled = true;
    statusEl.innerHTML = '<span style="color:var(--green)">Credentials saved &#10003;</span>';
    document.getElementById('settingAuthPassword').value = '';
  } catch (e) { statusEl.innerHTML = '<span style="color:var(--accent)">Failed to save</span>'; }
  finally { this.disabled = false; this.textContent = 'Save Credentials'; }
});

document.getElementById('settingTouchPinEnabled').addEventListener('change', async function() {
  const enabled = this.checked;
  document.getElementById('settingTouchPinEnabledLabel').textContent = enabled ? 'On' : 'Off';
  document.getElementById('touchPinConfigRow').style.display = enabled ? '' : 'none';
  document.getElementById('touchPinTimeoutRow').style.display = enabled ? '' : 'none';
  try { await authFetch('/api/config/touch_pin_enabled', { method: 'PUT', body: JSON.stringify({ value: enabled ? '1' : '0' }) }); } catch (e) { console.error('Failed to save touch PIN enabled', e); }
});

document.getElementById('btnSaveTouchPin').addEventListener('click', async function() {
  const pin = document.getElementById('settingTouchPin').value.trim();
  const statusEl = document.getElementById('touchPinSaveStatus');
  if (!/^\d{4,6}$/.test(pin)) { statusEl.innerHTML = '<span style="color:var(--accent)">PIN must be 4\u20136 digits</span>'; return; }
  try { await authFetch('/api/config/touch_pin', { method: 'PUT', body: JSON.stringify({ value: pin }) }); statusEl.innerHTML = '<span style="color:var(--green)">Saved &#10003;</span>'; setTimeout(() => { statusEl.textContent = ''; }, 2000); } catch (e) { statusEl.innerHTML = '<span style="color:var(--accent)">Failed to save</span>'; }
});

document.getElementById('btnSaveTouchPinTimeout').addEventListener('click', async function() {
  const timeout = document.getElementById('settingTouchPinTimeout').value;
  try { await authFetch('/api/config/touch_pin_idle_timeout', { method: 'PUT', body: JSON.stringify({ value: String(timeout) }) }); } catch (e) { console.error('Failed to save touch PIN timeout', e); }
});

// ── App Settings Tab Switching ──
document.querySelectorAll('.settings-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.settings-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('settab-' + btn.dataset.settab).classList.add('active');
  });
});

// ── OS2L Tab Switching ──
document.querySelectorAll('.settings-tab-btn[data-os2ltab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab-btn[data-os2ltab]').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.os2l-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('os2ltab-' + btn.dataset.os2ltab).classList.add('active');
  });
});

document.getElementById('btnSaveMdnsConfig').addEventListener('click', async () => {
  const btn = document.getElementById('btnSaveMdnsConfig');
  const origText = btn.textContent;
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const enabled = document.getElementById('cfgMdnsEnabled').checked ? '1' : '0';
    const hostname = document.getElementById('cfgMdnsHostname').value.trim().replace(/\.local$/i, '') || 'dmxcontrol';
    document.getElementById('cfgMdnsHostname').value = hostname;
    await Promise.all([
      fetch('/api/config/mdns_enabled', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: enabled }) }),
      fetch('/api/config/mdns_hostname', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: hostname }) }),
    ]);
    await fetch('/api/mdns/restart', { method: 'POST' });
    const status = await fetch('/api/mdns/status').then(r => r.json());
    updateMdnsStatus(status);
    btn.textContent = 'Saved!'; btn.style.background = 'var(--green)'; btn.style.color = '#000';
    setTimeout(() => { btn.textContent = origText; btn.style.background = ''; btn.style.color = ''; btn.disabled = false; }, 1500);
  } catch(e) {
    btn.textContent = 'Error!'; btn.style.background = 'var(--danger)';
    setTimeout(() => { btn.textContent = origText; btn.style.background = ''; btn.disabled = false; }, 2000);
  }
});

// ═══════════════════════════════════════════════════════════════
//  Save Helpers
// ═══════════════════════════════════════════════════════════════
async function saveConfigBatch(pairs, btnId) {
  const btn = document.getElementById(btnId);
  const origText = btn.textContent;
  try {
    await Promise.all(pairs.map(([key, value]) =>
      fetch(`/api/config/${key}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value: String(value) }) })
    ));
    btn.textContent = 'Saved!'; btn.style.borderColor = 'var(--green)'; btn.style.color = 'var(--green)';
  } catch (e) {
    btn.textContent = 'Error!'; btn.style.borderColor = 'var(--danger)'; btn.style.color = 'var(--danger)';
  }
  setTimeout(() => { btn.textContent = origText; btn.style.borderColor = ''; btn.style.color = ''; }, 1500);
}

// ═══════════════════════════════════════════════════════════════
//  Art-Net Node Management
// ═══════════════════════════════════════════════════════════════
async function loadArtnetNodes() {
  const tbody = document.getElementById('artnetNodesBody');
  showLoading(tbody);
  try {
    const nodes = await fetch('/api/artnet-universes').then(r => r.json());
    document.getElementById('artnetNodeCount').textContent = `${nodes.length} node(s)`;
    tbody.innerHTML = '';
    if (nodes.length === 0) { showEmpty(tbody, 'No Art-Net nodes configured. Click "+ Add Art-Net Node" to create one.'); return; }
    for (const n of nodes) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="artnet-toggle" data-id="${n.id}" ${n.enabled ? 'checked' : ''}></td>
      <td>${n.local_universe}</td>
      <td>${esc(n.label || '\u2014')}</td>
      <td>${esc(n.ip)}</td>
      <td>${n.port}</td>
      <td>${n.subnet}</td>
      <td>${n.artnet_universe}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editArtnetNode(${n.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteArtnetNode(${n.id})">Del</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.artnet-toggle').forEach(cb => {
    cb.addEventListener('change', async () => { await fetch(`/api/artnet-universes/${cb.dataset.id}/toggle`, { method: 'POST' }); });
  });
  } catch (e) {
    console.error('Failed to load Art-Net nodes:', e);
    showEmpty(tbody, 'Failed to load Art-Net nodes.');
  }
}

function openArtnetNodeModal(node) {
  document.getElementById('artnetNodeEditId').value = node ? node.id : '';
  document.getElementById('artnetNodeModalTitle').textContent = node ? 'Edit Art-Net Node' : 'Add Art-Net Node';
  document.getElementById('anLocalUniverse').value = node ? node.local_universe : 1;
  document.getElementById('anLabel').value = node ? (node.label || '') : '';
  document.getElementById('anIp').value = node ? node.ip : '255.255.255.255';
  document.getElementById('anPort').value = node ? node.port : 6454;
  document.getElementById('anSubnet').value = node ? node.subnet : 0;
  document.getElementById('anArtnetUniverse').value = node ? node.artnet_universe : 0;
  document.getElementById('artnetNodeError').textContent = '';
  document.getElementById('artnetNodeModal').classList.add('open');
}

document.getElementById('btnAddArtnetNode').addEventListener('click', () => openArtnetNodeModal(null));

document.getElementById('btnSaveArtnetNode').addEventListener('click', async () => {
  const editId = document.getElementById('artnetNodeEditId').value;
  const body = {
    local_universe: +document.getElementById('anLocalUniverse').value,
    label: document.getElementById('anLabel').value.trim(),
    ip: document.getElementById('anIp').value.trim(),
    port: +document.getElementById('anPort').value,
    subnet: +document.getElementById('anSubnet').value,
    artnet_universe: +document.getElementById('anArtnetUniverse').value,
  };
  if (!body.ip) return showError('artnetNodeError', 'IP address is required');
  const url = editId ? `/api/artnet-universes/${editId}` : '/api/artnet-universes';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) return showError('artnetNodeError', data.error);
  closeModal('artnetNodeModal');
  loadArtnetNodes();
});

window.editArtnetNode = async (id) => {
  const node = await fetch(`/api/artnet-universes/${id}`).then(r => r.json());
  if (node) openArtnetNodeModal(node);
};
window.deleteArtnetNode = async (id) => {
  if (!confirm('Delete this Art-Net node?')) return;
  await fetch(`/api/artnet-universes/${id}`, { method: 'DELETE' });
  loadArtnetNodes();
};

document.getElementById('btnArtnetBlackout').addEventListener('click', async () => { await fetch('/api/artnet/blackout', { method: 'POST' }); });

document.getElementById('btnSaveArtnetRate').addEventListener('click', () => {
  saveConfigBatch([['artnet_refresh_rate', document.getElementById('cfgArtnetRefreshRate').value]], 'btnSaveArtnetRate');
});

document.getElementById('btnSaveVdj').addEventListener('click', () => {
  saveConfigBatch([
    ['os2l_port', document.getElementById('cfgOs2lPort').value],
    ['os2l_service_name', document.getElementById('cfgOs2lServiceName').value],
    ['web_port', document.getElementById('cfgWebPort').value],
    ['subscription_frequency', document.getElementById('cfgFrequency').value],
    ['vdj_db_path', document.getElementById('cfgVdjDbPath').value],
    ['vdj_folder', document.getElementById('cfgVdjFolder').value],
    ['vdj_auto_meta', document.getElementById('cfgVdjAutoMeta').checked ? '1' : '0'],
    ['vdj_deck_count', document.getElementById('cfgVdjDecks').value],
  ], 'btnSaveVdj');
});

// ═══════════════════════════════════════════════════════════════
//  Subscriptions CRUD
// ═══════════════════════════════════════════════════════════════
const SUB_CATEGORIES = { track: 'Track', transport: 'Transport', mixer: 'Mixer', loop: 'Loop', soundswitch: 'SoundSwitch', custom: 'Custom' };

async function loadSubscriptions() {
  const tbody = document.getElementById('subsTableBody');
  showLoading(tbody);
  try {
    const subs = await fetch('/api/subscriptions').then(r => r.json());
    const enabled = subs.filter(s => s.enabled);
    document.getElementById('subsEnabledCount').textContent = enabled.length;
    document.getElementById('subsTotalCount').textContent = subs.length;
    tbody.innerHTML = '';
    if (subs.length === 0) { showEmpty(tbody, 'No subscriptions configured.'); return; }
  for (const s of subs) {
    const tr = document.createElement('tr');
    if (!s.enabled) tr.className = 'sub-disabled';
    tr.innerHTML = `
      <td><input type="checkbox" class="sub-toggle" data-id="${s.id}" ${s.enabled ? 'checked' : ''}></td>
      <td><span class="sub-cat ${s.category}">${SUB_CATEGORIES[s.category] || s.category}</span></td>
      <td style="font-size:12px">${esc(s.label || '\u2014')}</td>
      <td class="sub-trigger">${esc(s.trigger)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="editSubscription(${s.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSubscription(${s.id})">Del</button>
      </td>`;
    tbody.appendChild(tr);
  }
  } catch (e) {
    console.error('Failed to load subscriptions:', e);
    showEmpty(tbody, 'Failed to load subscriptions.');
  }
  tbody.querySelectorAll('.sub-toggle').forEach(cb => {
    cb.addEventListener('change', async () => { await fetch(`/api/subscriptions/${cb.dataset.id}/toggle`, { method: 'POST' }); loadSubscriptions(); });
  });
}

document.getElementById('btnAddSub').addEventListener('click', () => openSubModal());

async function openSubModal(subId) {
  document.getElementById('subError').textContent = '';
  if (subId) {
    const subs = await fetch('/api/subscriptions').then(r => r.json());
    const s = subs.find(x => x.id === subId);
    if (!s) return;
    document.getElementById('subModalTitle').textContent = 'Edit Subscription';
    document.getElementById('subEditId').value = s.id;
    document.getElementById('subTrigger').value = s.trigger;
    document.getElementById('subLabel').value = s.label || '';
    document.getElementById('subCategory').value = s.category || 'custom';
  } else {
    document.getElementById('subModalTitle').textContent = 'Add Subscription';
    document.getElementById('subEditId').value = '';
    document.getElementById('subTrigger').value = '';
    document.getElementById('subLabel').value = '';
    document.getElementById('subCategory').value = 'custom';
  }
  document.getElementById('subModal').classList.add('open');
}

window.editSubscription = (id) => openSubModal(id);
window.deleteSubscription = async (id) => { if (!confirm('Delete this subscription?')) return; await fetch(`/api/subscriptions/${id}`, { method: 'DELETE' }); loadSubscriptions(); };

document.getElementById('btnSaveSub').addEventListener('click', async () => {
  const editId = document.getElementById('subEditId').value;
  const body = { trigger: document.getElementById('subTrigger').value.trim(), label: document.getElementById('subLabel').value.trim(), category: document.getElementById('subCategory').value };
  if (!body.trigger) return showError('subError', 'Trigger expression is required');
  const url = editId ? `/api/subscriptions/${editId}` : '/api/subscriptions';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) return showError('subError', data.error);
  closeModal('subModal');
  loadSubscriptions();
});

document.getElementById('btnResendSubs').addEventListener('click', async () => {
  const res = await fetch('/api/subscriptions/resend', { method: 'POST' });
  const data = await res.json();
  const btn = document.getElementById('btnResendSubs');
  if (data.connected) { btn.textContent = `Sent ${data.count} triggers!`; }
  else { btn.textContent = 'VDJ not connected'; }
  setTimeout(() => { btn.textContent = 'Re-send to VDJ'; }, 2000);
});

// ═══════════════════════════════════════════════════════════════
//  Lighting Config
// ═══════════════════════════════════════════════════════════════
async function loadLightingConfig() {
  const config = await fetch('/api/config').then(r => r.json());
  const speed = parseInt(config.strobe_speed || '200', 10);
  document.getElementById('cfgStrobeSpeed').value = speed;
  document.getElementById('cfgStrobeSpeedVal').textContent = speed;
  try {
    const map = await fetch('/api/fixture-channel-map').then(r => r.json());
    let dedicated = 0, rangeMapped = 0;
    for (const fix of map) {
      for (const ch of fix.channels) {
        if (ch.type === 'strobe') dedicated++;
        else if (ch.ranges && ch.ranges.find(r => r.type === 'strobe')) rangeMapped++;
      }
    }
    const parts = [];
    if (dedicated) parts.push(`${dedicated} dedicated`);
    if (rangeMapped) parts.push(`${rangeMapped} range-mapped`);
    document.getElementById('cfgStrobeChannelCount').textContent = parts.length
      ? parts.join(', ') + ' strobe channel(s)'
      : 'No strobe channels found \u2014 add fixtures with strobe channels or strobe ranges';
  } catch {
    document.getElementById('cfgStrobeChannelCount').textContent = '\u2014';
  }
}

document.getElementById('cfgStrobeSpeed').addEventListener('input', () => {
  document.getElementById('cfgStrobeSpeedVal').textContent = document.getElementById('cfgStrobeSpeed').value;
});

document.getElementById('cfgStrobeSave').addEventListener('click', () => {
  const val = document.getElementById('cfgStrobeSpeed').value;
  strobeDefaultSpeed = +val;
  saveConfigBatch([['strobe_speed', val]], 'cfgStrobeSave');
});

document.getElementById('cfgStrobeTest').addEventListener('click', () => {
  const val = +document.getElementById('cfgStrobeSpeed').value;
  sendStrobeValue(val);
});

document.getElementById('cfgStrobeOff').addEventListener('click', () => {
  sendStrobeValue(0);
});

// ═══════════════════════════════════════════════════════════════
//  Mover Presets Config
// ═══════════════════════════════════════════════════════════════
let moverPresets = [];
let moverFixtures = [];
let moverPositions = {};
let moverSelectedFixture = null;

async function loadMoverConfig() {
  try { moverPresets = await fetch('/api/mover-presets').then(r => r.json()); } catch { moverPresets = []; }
  try {
    const map = await fetch('/api/fixture-channel-map').then(r => r.json());
    if (!qaChannelMap.length) qaChannelMap = map;
    moverFixtures = map.filter(f =>
      f.channels.some(ch => ch.type === 'pan' || ch.type === 'tilt' || ch.type === 'pan_fine' || ch.type === 'tilt_fine')
    );
  } catch { moverFixtures = []; }
  if (Object.keys(moverPositions).length === 0) {
    for (const f of moverFixtures) moverPositions[f.id] = { pan: 128, tilt: 128 };
  }
  if (!moverSelectedFixture && moverFixtures.length > 0) moverSelectedFixture = moverFixtures[0].id;
  renderMoverFixtureTabs();
  renderMoverPresetList();
  syncXYPadToFixture();
}

function updateXYPad(pan, tilt) {
  pan = Math.max(0, Math.min(255, Math.round(pan)));
  tilt = Math.max(0, Math.min(255, Math.round(tilt)));
  const pctX = (pan / 255) * 100;
  const pctY = (tilt / 255) * 100;
  document.getElementById('xyDot').style.left = pctX + '%';
  document.getElementById('xyDot').style.top = pctY + '%';
  document.getElementById('xyCrossH').style.top = pctY + '%';
  document.getElementById('xyCrossV').style.left = pctX + '%';
  document.getElementById('xyPanVal').textContent = pan;
  document.getElementById('xyTiltVal').textContent = tilt;
  document.getElementById('moverPanInput').value = pan;
  document.getElementById('moverTiltInput').value = tilt;
  if (moverSelectedFixture) {
    moverPositions[moverSelectedFixture] = { pan, tilt };
    sendLiveMoverPosition(moverSelectedFixture, pan, tilt);
    renderMoverFixtureTabs();
  }
}

let _liveMoverTimer = null;
function sendLiveMoverPosition(fixtureId, pan, tilt) {
  if (_liveMoverTimer) return;
  _liveMoverTimer = setTimeout(() => { _liveMoverTimer = null; }, 30);
  if (!qaChannelMap.length) return;
  const fix = qaChannelMap.find(f => f.id === fixtureId);
  if (!fix) return;
  const channels = [];
  for (const ch of fix.channels) {
    if (ch.type === 'pan' || ch.type === 'pan_fine') channels.push({ ch: ch.dmx_address, val: pan });
    if (ch.type === 'tilt' || ch.type === 'tilt_fine') channels.push({ ch: ch.dmx_address, val: tilt });
  }
  if (channels.length) {
    fetch('/api/dmx/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universe: fix.universe, channels }) });
  }
}

function syncXYPadToFixture() {
  if (moverSelectedFixture && moverPositions[moverSelectedFixture]) {
    const pos = moverPositions[moverSelectedFixture];
    updateXYPadVisual(pos.pan, pos.tilt);
  } else {
    updateXYPadVisual(128, 128);
  }
}

function updateXYPadVisual(pan, tilt) {
  pan = Math.max(0, Math.min(255, Math.round(pan)));
  tilt = Math.max(0, Math.min(255, Math.round(tilt)));
  const pctX = (pan / 255) * 100;
  const pctY = (tilt / 255) * 100;
  document.getElementById('xyDot').style.left = pctX + '%';
  document.getElementById('xyDot').style.top = pctY + '%';
  document.getElementById('xyCrossH').style.top = pctY + '%';
  document.getElementById('xyCrossV').style.left = pctX + '%';
  document.getElementById('xyPanVal').textContent = pan;
  document.getElementById('xyTiltVal').textContent = tilt;
  document.getElementById('moverPanInput').value = pan;
  document.getElementById('moverTiltInput').value = tilt;
}

function xyPadHandler(e) {
  const pad = document.getElementById('moverXYPad');
  const rect = pad.getBoundingClientRect();
  let clientX, clientY;
  if (e.touches) { clientX = e.touches[0].clientX; clientY = e.touches[0].clientY; }
  else { clientX = e.clientX; clientY = e.clientY; }
  const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  updateXYPad(x * 255, y * 255);
}

(function initXYPad() {
  const pad = document.getElementById('moverXYPad');
  if (!pad) return;
  let dragging = false;
  pad.addEventListener('mousedown', (e) => { dragging = true; xyPadHandler(e); });
  window.addEventListener('mousemove', (e) => { if (dragging) xyPadHandler(e); });
  window.addEventListener('mouseup', () => { dragging = false; });
  pad.addEventListener('touchstart', (e) => { e.preventDefault(); dragging = true; xyPadHandler(e); }, { passive: false });
  window.addEventListener('touchmove', (e) => { if (dragging) { e.preventDefault(); xyPadHandler(e); } }, { passive: false });
  window.addEventListener('touchend', () => { dragging = false; });
})();

document.getElementById('moverPanInput').addEventListener('change', () => {
  const pos = moverPositions[moverSelectedFixture] || { pan: 128, tilt: 128 };
  updateXYPad(+document.getElementById('moverPanInput').value, pos.tilt);
});
document.getElementById('moverTiltInput').addEventListener('change', () => {
  const pos = moverPositions[moverSelectedFixture] || { pan: 128, tilt: 128 };
  updateXYPad(pos.pan, +document.getElementById('moverTiltInput').value);
});

function renderMoverFixtureTabs() {
  const container = document.getElementById('moverFixtureTabs');
  container.innerHTML = '';
  if (moverFixtures.length === 0) {
    container.innerHTML = '<span style="font-size:11px;color:var(--text-dim)">No fixtures with pan/tilt channels found.</span>';
    return;
  }
  for (const fix of moverFixtures) {
    const tab = document.createElement('div');
    const pos = moverPositions[fix.id];
    const hasPos = pos && (pos.pan !== 128 || pos.tilt !== 128);
    tab.className = 'mover-fix-tab' + (moverSelectedFixture === fix.id ? ' active' : '') + (hasPos ? ' has-pos' : '');
    tab.innerHTML = `
      <span class="fix-tab-check">\u2713</span>
      <span class="fix-tab-name">${esc(fix.name)}</span>
      <span class="fix-tab-pos">${pos ? pos.pan + '/' + pos.tilt : '\u2014'}</span>`;
    tab.addEventListener('click', () => {
      moverSelectedFixture = fix.id;
      syncXYPadToFixture();
      renderMoverFixtureTabs();
    });
    container.appendChild(tab);
  }
}

function sendMoverTestPositions(positions) {
  if (!qaChannelMap.length) return;
  const byUniverse = {};
  for (const pos of positions) {
    const fix = qaChannelMap.find(f => f.id === pos.fixture_id);
    if (!fix) continue;
    const u = fix.universe;
    if (!byUniverse[u]) byUniverse[u] = [];
    for (const ch of fix.channels) {
      if (ch.type === 'pan' || ch.type === 'pan_fine') byUniverse[u].push({ ch: ch.dmx_address, val: pos.pan });
      if (ch.type === 'tilt' || ch.type === 'tilt_fine') byUniverse[u].push({ ch: ch.dmx_address, val: pos.tilt });
    }
  }
  for (const [u, channels] of Object.entries(byUniverse)) {
    fetch('/api/dmx/channels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ universe: +u, channels }) });
  }
}

function getPositionsArray() {
  return Object.entries(moverPositions).map(([fid, pos]) => ({ fixture_id: +fid, pan: pos.pan, tilt: pos.tilt }));
}

document.getElementById('btnTestMoverPos').addEventListener('click', () => {
  sendMoverTestPositions(getPositionsArray());
});

document.getElementById('btnSaveMoverPreset').addEventListener('click', async () => {
  const name = document.getElementById('moverPresetName').value.trim();
  if (!name) { alert('Enter a preset name.'); return; }
  const positions = getPositionsArray();
  if (positions.length === 0) { alert('No fixture positions set.'); return; }
  const editId = document.getElementById('moverPresetEditId').value;
  const body = { name, positions };
  if (editId) {
    await fetch(`/api/mover-presets/${editId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } else {
    await fetch('/api/mover-presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  resetMoverForm();
  await loadMoverConfig();
});

document.getElementById('btnCancelMoverEdit').addEventListener('click', () => { resetMoverForm(); });

function resetMoverForm() {
  document.getElementById('moverPresetEditId').value = '';
  document.getElementById('moverPresetName').value = '';
  document.getElementById('btnCancelMoverEdit').style.display = 'none';
  document.getElementById('btnSaveMoverPreset').textContent = 'Save Preset';
  for (const f of moverFixtures) moverPositions[f.id] = { pan: 128, tilt: 128 };
  if (moverFixtures.length > 0) moverSelectedFixture = moverFixtures[0].id;
  syncXYPadToFixture();
  renderMoverFixtureTabs();
}

window.editMoverPreset = function(id) {
  const preset = moverPresets.find(p => p.id === id);
  if (!preset) return;
  document.getElementById('moverPresetEditId').value = preset.id;
  document.getElementById('moverPresetName').value = preset.name;
  document.getElementById('btnSaveMoverPreset').textContent = 'Update Preset';
  document.getElementById('btnCancelMoverEdit').style.display = '';
  for (const f of moverFixtures) moverPositions[f.id] = { pan: 128, tilt: 128 };
  for (const pos of preset.positions) moverPositions[pos.fixture_id] = { pan: pos.pan, tilt: pos.tilt };
  if (moverFixtures.length > 0) moverSelectedFixture = moverFixtures[0].id;
  syncXYPadToFixture();
  renderMoverFixtureTabs();
};

window.deleteMoverPreset = async function(id) {
  const preset = moverPresets.find(p => p.id === id);
  if (preset && preset.is_system) { alert('System presets cannot be deleted.'); return; }
  if (!confirm('Delete this mover preset?')) return;
  const res = await fetch(`/api/mover-presets/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) { alert(data.error); return; }
  await loadMoverConfig();
};

function renderMoverPresetList() {
  const list = document.getElementById('moverPresetList');
  list.innerHTML = '';
  if (moverPresets.length === 0) {
    list.innerHTML = '<span style="font-size:11px;color:var(--text-dim)">No presets saved yet.</span>';
    return;
  }
  for (const p of moverPresets) {
    const card = document.createElement('div');
    card.className = 'mover-preset-card';
    const posCount = p.positions ? p.positions.length : 0;
    const posDetail = (p.positions || []).map(pos => {
      const fix = moverFixtures.find(f => f.id === pos.fixture_id);
      return fix ? `${fix.name}: ${pos.pan}/${pos.tilt}` : `#${pos.fixture_id}: ${pos.pan}/${pos.tilt}`;
    }).join(' \u00B7 ');
    const systemBadge = p.is_system ? '<span style="font-size:9px;background:var(--cyan);color:#000;padding:1px 5px;border-radius:3px;margin-left:6px">SYSTEM</span>' : '';
    const deleteBtn = p.is_system ? '' : `<button class="mp-delete" title="Delete" onclick="deleteMoverPreset(${p.id})">&times;</button>`;
    card.innerHTML = `
      <div class="mover-preset-card-header">
        <span class="mover-preset-card-name">${p.icon ? p.icon + ' ' : ''}${esc(p.name)}${systemBadge}</span>
        <span class="mover-preset-card-actions">
          <button class="mp-edit" title="Edit" onclick="editMoverPreset(${p.id})">\u270E</button>
          ${deleteBtn}
        </span>
      </div>
      <div class="mover-preset-card-meta">
        <span>${posCount} fixture(s)</span>
        <span style="font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px" title="${esc(posDetail)}">${esc(posDetail)}</span>
      </div>`;
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      sendMoverTestPositions(p.positions || []);
      for (const f of moverFixtures) moverPositions[f.id] = { pan: 128, tilt: 128 };
      for (const pos of (p.positions || [])) moverPositions[pos.fixture_id] = { pan: pos.pan, tilt: pos.tilt };
      syncXYPadToFixture();
      renderMoverFixtureTabs();
      list.querySelectorAll('.mover-preset-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    });
    list.appendChild(card);
  }
}

// ═══════════════════════════════════════════════════════════════
//  OS2L Button Mappings CRUD
// ═══════════════════════════════════════════════════════════════
const ACTION_TYPE_LABELS = {
  blackout: 'Blackout', full_on: 'Full On', set_channels: 'Set Channels', scene: 'Scene (JSON)',
  strobe: 'Strobe', color: 'Color', color_preset: 'Color Preset', effect: 'Effect',
  scene_activate: 'Scene', master_dimmer: 'Master Dimmer',
};

const TOGGLE_MODE_LABELS = { fire: 'Fire', toggle: 'Toggle' };

const ACTION_HINTS = {
  blackout: 'No additional data needed \u2014 all channels will be set to 0.',
  full_on: 'No additional data needed \u2014 all channels will be set to 255. Optionally set universe: <code>{"universe":1}</code>',
  set_channels: 'Specify universe and channels:<br><code>{"universe":1,"channels":[{"ch":1,"val":255},{"ch":2,"val":128}]}</code>',
  scene: 'Multi-fixture preset:<br><code>{"fixtures":[{"universe":1,"channels":[{"ch":1,"val":255}]}]}</code>',
  strobe: 'Strobe will be sent to all fixtures with strobe-capable channels using the configured strobe speed.',
  color: 'Set RGBW values to send to all colour fixtures.',
  color_preset: 'Choose a colour preset from the dropdown.',
  effect: 'Select an effect to run on your fixtures.',
  scene_activate: 'Select a static scene to activate.',
  master_dimmer: 'Set the master dimmer level (0-255).',
};

async function loadButtonMaps() {
  const maps = await (await fetch('/api/os2l-button-maps')).json();
  const tbody = document.getElementById('btnMapsTableBody');
  const enabled = maps.filter(m => m.enabled).length;
  document.getElementById('btnMapsEnabledCount').textContent = enabled;
  document.getElementById('btnMapsTotalCount').textContent = maps.length;
  tbody.innerHTML = maps.map(m => {
    const disClass = m.enabled ? '' : ' sub-disabled';
    const actionLabel = ACTION_TYPE_LABELS[m.action_type] || m.action_type;
    const modeLabel = TOGGLE_MODE_LABELS[m.toggle_mode] || m.toggle_mode || 'Fire';
    const modeClass = m.toggle_mode === 'toggle' ? 'soundswitch' : 'custom';
    return `<tr class="${disClass}">
      <td><input type="checkbox" class="sub-toggle" ${m.enabled ? 'checked' : ''} onchange="toggleBtnMap(${m.id})"></td>
      <td>${esc(m.name)}</td>
      <td><span class="sub-cat">${esc(m.os2l_event)}</span></td>
      <td><span class="sub-trigger">${esc(m.os2l_value)}</span></td>
      <td><span class="sub-cat custom">${esc(actionLabel)}</span></td>
      <td><span class="sub-cat ${modeClass}">${esc(modeLabel)}</span></td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="testBtnMap(${m.id})" title="Test this action">&#9654;</button>
        <button class="btn btn-secondary btn-sm" onclick="editBtnMap(${m.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteBtnMap(${m.id}, '${esc(m.name)}')">Del</button>
      </td>
    </tr>`;
  }).join('');
}

function updateActionHint() {
  const type = document.getElementById('bmActionType').value;
  const jsonGroup = document.getElementById('bmChannelsGroup');
  const hint = document.getElementById('bmActionHint');
  document.getElementById('bmColorFields').style.display = 'none';
  document.getElementById('bmColorPresetFields').style.display = 'none';
  document.getElementById('bmEffectFields').style.display = 'none';
  document.getElementById('bmSceneFields').style.display = 'none';
  document.getElementById('bmDimmerFields').style.display = 'none';
  jsonGroup.style.display = 'none';
  if (type === 'color') { document.getElementById('bmColorFields').style.display = ''; updateBmColorPreview(); }
  else if (type === 'color_preset') { document.getElementById('bmColorPresetFields').style.display = ''; }
  else if (type === 'effect') { document.getElementById('bmEffectFields').style.display = ''; }
  else if (type === 'scene_activate') { document.getElementById('bmSceneFields').style.display = ''; }
  else if (type === 'master_dimmer') { document.getElementById('bmDimmerFields').style.display = ''; }
  else if (type === 'set_channels' || type === 'scene') { jsonGroup.style.display = ''; }
  hint.innerHTML = ACTION_HINTS[type] || '';
}

function updateBmColorPreview() {
  const r = document.getElementById('bmColorR').value || 0;
  const g = document.getElementById('bmColorG').value || 0;
  const b = document.getElementById('bmColorB').value || 0;
  document.getElementById('bmColorPreview').style.background = `rgb(${r},${g},${b})`;
}

['bmColorR','bmColorG','bmColorB','bmColorW'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateBmColorPreview);
});

document.getElementById('bmActionType').addEventListener('change', updateActionHint);
document.getElementById('btnAddBtnMap').addEventListener('click', () => openBtnMapModal());

async function openBtnMapModal(mapId) {
  document.getElementById('btnMapEditId').value = mapId || '';
  document.getElementById('btnMapModalTitle').textContent = mapId ? 'Edit Button Mapping' : 'Add Button Mapping';
  document.getElementById('btnMapError').textContent = '';
  try {
    const effects = await (await fetch('/api/effects')).json();
    document.getElementById('bmEffectSelect').innerHTML = effects.map(e => `<option value="${e.id}">${esc(e.name)} (${e.type})</option>`).join('');
  } catch(e) {}
  try {
    const scenes = await (await fetch('/api/scenes')).json();
    document.getElementById('bmSceneSelect').innerHTML = scenes.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  } catch(e) {}
  try {
    const groups = await (await fetch('/api/groups')).json();
    const groupOpts = '<option value="">All Fixtures</option>' + groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    document.getElementById('bmColorGroup').innerHTML = groupOpts;
    document.getElementById('bmColorPresetGroup').innerHTML = groupOpts;
    document.getElementById('bmEffectGroup').innerHTML = groupOpts;
  } catch(e) {}
  if (mapId) {
    const m = await (await fetch(`/api/os2l-button-maps/${mapId}`)).json();
    document.getElementById('bmName').value = m.name;
    document.getElementById('bmOs2lEvent').value = m.os2l_event;
    document.getElementById('bmOs2lValue').value = m.os2l_value;
    document.getElementById('bmActionType').value = m.action_type;
    document.getElementById('bmToggleMode').value = m.toggle_mode || 'fire';
    let ad = {};
    try { ad = JSON.parse(m.action_data || '{}'); } catch(e) {}
    if (m.action_type === 'color' && ad.preset) {
      document.getElementById('bmActionType').value = 'color_preset';
      document.getElementById('bmColorPreset').value = ad.preset;
      if (ad.group_id) document.getElementById('bmColorPresetGroup').value = ad.group_id;
    } else if (m.action_type === 'color') {
      document.getElementById('bmColorR').value = ad.red || 0;
      document.getElementById('bmColorG').value = ad.green || 0;
      document.getElementById('bmColorB').value = ad.blue || 0;
      document.getElementById('bmColorW').value = ad.white || 0;
      if (ad.group_id) document.getElementById('bmColorGroup').value = ad.group_id;
    } else if (m.action_type === 'effect') {
      if (ad.effect_id) document.getElementById('bmEffectSelect').value = ad.effect_id;
      if (ad.group_id) document.getElementById('bmEffectGroup').value = ad.group_id;
    } else if (m.action_type === 'scene_activate') {
      if (ad.scene_id) document.getElementById('bmSceneSelect').value = ad.scene_id;
    } else if (m.action_type === 'master_dimmer') {
      document.getElementById('bmDimmerValue').value = ad.value !== undefined ? ad.value : 255;
    } else {
      document.getElementById('bmActionData').value = m.action_data || '{}';
    }
  } else {
    document.getElementById('bmName').value = '';
    document.getElementById('bmOs2lEvent').value = 'btn';
    document.getElementById('bmOs2lValue').value = '';
    document.getElementById('bmActionType').value = 'color';
    document.getElementById('bmToggleMode').value = 'fire';
    document.getElementById('bmActionData').value = '{}';
    document.getElementById('bmColorR').value = 255;
    document.getElementById('bmColorG').value = 0;
    document.getElementById('bmColorB').value = 0;
    document.getElementById('bmColorW').value = 0;
    document.getElementById('bmDimmerValue').value = 255;
  }
  updateActionHint();
  document.getElementById('btnMapModal').classList.add('open');
}

window.editBtnMap = (id) => openBtnMapModal(id);
window.deleteBtnMap = async (id, name) => { if (!confirm(`Delete button map "${name}"?`)) return; await fetch(`/api/os2l-button-maps/${id}`, { method: 'DELETE' }); loadButtonMaps(); };
window.toggleBtnMap = async (id) => { await fetch(`/api/os2l-button-maps/${id}/toggle`, { method: 'POST' }); loadButtonMaps(); };
window.testBtnMap = async (id) => { const res = await fetch(`/api/os2l-button-maps/test/${id}`, { method: 'POST' }); const data = await res.json(); if (data.ok) console.log(`[OS2L] Tested button map: ${data.tested}`); };

document.getElementById('btnSaveBtnMap').addEventListener('click', async () => {
  const editId = document.getElementById('btnMapEditId').value;
  const name = document.getElementById('bmName').value.trim();
  const os2l_event = document.getElementById('bmOs2lEvent').value;
  const os2l_value = document.getElementById('bmOs2lValue').value.trim();
  const action_type = document.getElementById('bmActionType').value;
  const toggle_mode = document.getElementById('bmToggleMode').value;
  let action_data = '{}';
  if (!name) return showError('btnMapError', 'Name is required');
  if (!os2l_value) return showError('btnMapError', 'OS2L value is required');
  if (action_type === 'color') {
    const r = +document.getElementById('bmColorR').value || 0;
    const g = +document.getElementById('bmColorG').value || 0;
    const b = +document.getElementById('bmColorB').value || 0;
    const w = +document.getElementById('bmColorW').value || 0;
    const gid = document.getElementById('bmColorGroup').value;
    const data = { red: r, green: g, blue: b, white: w };
    if (gid) data.group_id = +gid;
    action_data = JSON.stringify(data);
  } else if (action_type === 'color_preset') {
    const sel = document.getElementById('bmColorPreset');
    const opt = sel.options[sel.selectedIndex];
    const r = +opt.dataset.r, g = +opt.dataset.g, b = +opt.dataset.b, w = +opt.dataset.w;
    const gid = document.getElementById('bmColorPresetGroup').value;
    const data = { preset: sel.value, red: r, green: g, blue: b, white: w };
    if (gid) data.group_id = +gid;
    action_data = JSON.stringify(data);
  } else if (action_type === 'effect') {
    const eid = +document.getElementById('bmEffectSelect').value;
    const gid = document.getElementById('bmEffectGroup').value;
    if (!eid) return showError('btnMapError', 'Please select an effect');
    const data = { effect_id: eid };
    if (gid) data.group_id = +gid;
    action_data = JSON.stringify(data);
  } else if (action_type === 'scene_activate') {
    const sid = +document.getElementById('bmSceneSelect').value;
    if (!sid) return showError('btnMapError', 'Please select a scene');
    action_data = JSON.stringify({ scene_id: sid });
  } else if (action_type === 'master_dimmer') {
    const val = +document.getElementById('bmDimmerValue').value;
    action_data = JSON.stringify({ value: Math.max(0, Math.min(255, val)) });
  } else if (action_type === 'set_channels' || action_type === 'scene') {
    action_data = document.getElementById('bmActionData').value.trim() || '{}';
    try { JSON.parse(action_data); } catch (e) { return showError('btnMapError', 'Action data must be valid JSON'); }
  }
  const save_action_type = action_type === 'color_preset' ? 'color' : action_type;
  const body = { name, os2l_event, os2l_value, action_type: save_action_type, action_data, toggle_mode };
  const url = editId ? `/api/os2l-button-maps/${editId}` : '/api/os2l-button-maps';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) return showError('btnMapError', data.error);
  closeModal('btnMapModal');
  loadButtonMaps();
});

// ═══════════════════════════════════════════════════════════════
//  Export / Import
// ═══════════════════════════════════════════════════════════════
document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    const resp = await fetch('/api/export');
    if (!resp.ok) throw new Error('Export failed');
    const data = await resp.json();
    const selected = [...document.querySelectorAll('.export-cb:checked')].map(cb => cb.value);
    const filtered = { _format: data._format, _version: data._version, _exported: data._exported };
    for (const key of selected) { if (data[key]) filtered[key] = data[key]; }
    const blob = new Blob([JSON.stringify(filtered, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dmx-export-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert('Export failed: ' + e.message); }
});

let importFileData = null;

document.getElementById('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById('importPreview');
  const previewList = document.getElementById('importPreviewList');
  const btnImport = document.getElementById('btnImport');
  const resultDiv = document.getElementById('importResult');
  resultDiv.style.display = 'none';
  if (!file) { preview.style.display = 'none'; btnImport.disabled = true; importFileData = null; return; }
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      if (data._format !== 'dmx-controller-export') { alert('Not a valid DMX Controller export file.'); importFileData = null; preview.style.display = 'none'; btnImport.disabled = true; return; }
      importFileData = data;
      const counts = [];
      const sections = ['fixture_types', 'fixtures', 'groups', 'effects', 'mover_presets', 'scenes'];
      const labels = { fixture_types: 'Fixture Library', fixtures: 'Fixtures', groups: 'Groups', effects: 'Effects', mover_presets: 'Mover Presets', scenes: 'Scenes' };
      for (const s of sections) {
        const cb = preview.querySelector(`.import-cb[value="${s}"]`);
        if (data[s] && data[s].length > 0) {
          counts.push(`${data[s].length} ${labels[s]}`);
          if (cb) { cb.closest('label').style.display = ''; cb.checked = true; }
        } else {
          if (cb) { cb.closest('label').style.display = 'none'; cb.checked = false; }
        }
      }
      previewList.textContent = counts.join(', ') || 'No data found';
      if (data._exported) previewList.textContent += ` (exported ${new Date(data._exported).toLocaleString()})`;
      preview.style.display = '';
      btnImport.disabled = false;
    } catch (err) { alert('Failed to parse file: ' + err.message); importFileData = null; preview.style.display = 'none'; btnImport.disabled = true; }
  };
  reader.readAsText(file);
});

document.getElementById('btnImport').addEventListener('click', async () => {
  if (!importFileData) return;
  const selected = [...document.querySelectorAll('.import-cb:checked')].map(cb => cb.value);
  if (selected.length === 0) { alert('Select at least one section to import.'); return; }
  if (!confirm(`Import ${selected.length} section(s)? Existing items with matching names will be updated.`)) return;
  const resultDiv = document.getElementById('importResult');
  try {
    const payload = { ...importFileData, _import_sections: selected };
    const resp = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Import failed');
    const lines = [];
    if (result.fixture_types) lines.push(`${result.fixture_types} fixture library entries`);
    if (result.fixtures) lines.push(`${result.fixtures} fixtures`);
    if (result.groups) lines.push(`${result.groups} groups`);
    if (result.effects) lines.push(`${result.effects} effects`);
    if (result.mover_presets) lines.push(`${result.mover_presets} mover presets`);
    if (result.scenes) lines.push(`${result.scenes} scenes`);
    resultDiv.style.display = '';
    resultDiv.style.background = 'rgba(0,180,80,.12)';
    resultDiv.style.border = '1px solid rgba(0,180,80,.3)';
    resultDiv.innerHTML = `<strong>&#10003; Import complete:</strong> ${lines.join(', ') || 'No items imported'}`;
    if (result.errors && result.errors.length > 0) {
      resultDiv.innerHTML += `<br><br><strong>Warnings:</strong><br>` + result.errors.map(e => `\u2022 ${e}`).join('<br>');
      resultDiv.style.background = 'rgba(255,180,0,.12)';
      resultDiv.style.border = '1px solid rgba(255,180,0,.3)';
    }
  } catch (e) {
    resultDiv.style.display = '';
    resultDiv.style.background = 'rgba(255,60,60,.12)';
    resultDiv.style.border = '1px solid rgba(255,60,60,.3)';
    resultDiv.innerHTML = `<strong>&#10007; Import failed:</strong> ${e.message}`;
  }
});

// ═══════════════════════════════════════════════════════════════
//  MIDI Controller Management
// ═══════════════════════════════════════════════════════════════
const MIDI_ACTION_LABELS = {
  none: 'None', blackout: 'Blackout', strobe: 'Strobe', full_on: 'Full On',
  color: 'Color', effect: 'Effect', scene_activate: 'Scene',
  master_dimmer: 'Master Dimmer', effect_speed: 'Effect Speed',
  group_dimmer: 'Group Dimmer', channel: 'Channel', set_channels: 'Set Channels',
};

const MIDI_LED_COLORS = {
  0:'Off', 1:'Dim Gray', 2:'Gray', 3:'White', 4:'Light Red', 5:'Red', 6:'Dark Red',
  8:'Orange', 9:'Bright Orange', 12:'Light Yellow', 13:'Yellow', 14:'Dark Yellow',
  16:'Lime', 17:'Bright Green', 18:'Dark Green', 21:'Green', 25:'Spring Green',
  33:'Cyan', 36:'Light Blue', 37:'Sky Blue', 45:'Blue', 43:'Dark Blue',
  48:'Purple', 49:'Bright Purple', 53:'Magenta', 56:'Pink', 57:'Hot Pink',
};

const VELOCITY_COLORS = [
  '#000000','#1E1E1E','#7F7F7F','#FFFFFF','#FF4C4C','#FF0000','#590000','#190000',
  '#FFBD6C','#FF5400','#591D00','#271B00','#FFFF4C','#FFFF00','#595900','#191900',
  '#88FF4C','#54FF00','#1D5900','#142B00','#4CFF4C','#00FF00','#005900','#001900',
  '#4CFF5E','#00FF19','#00590D','#001902','#4CFF88','#00FF55','#00591D','#001912',
  '#4CFFB7','#00FF99','#005935','#001912','#4CC3FF','#00A9FF','#004152','#001019',
  '#4C88FF','#0055FF','#001D59','#000819','#4C4CFF','#0000FF','#000059','#000019',
  '#874CFF','#5400FF','#190059','#0F0030','#FF4CFF','#FF00FF','#590059','#190019',
  '#FF4C87','#FF0054','#59001D','#190013','#FF1500','#993500','#795100','#436400',
  '#033900','#005735','#001D52','#000F60','#0F0030','#3A0018','#7A0000','#3E4100',
  '#003A00','#005432','#001C3E','#180046','#3A001C','#290000','#0F2B00','#003100',
  '#00310F','#001931','#0D0031','#310017','#4CFF4C','#00FF00','#004C00','#001200',
  '#4CFFCC','#00FF66','#004C19','#001204','#006459','#002819','#3F0064','#280046',
  '#643F00','#4C2800','#191900','#640000','#4C0000','#003200','#001900','#001932',
  '#000064','#004C4C','#4C004C','#190064','#4C0032','#640019','#321900','#193200',
  '#003219','#001964','#320064','#640032','#640000','#640032','#640064','#320064',
  '#006464','#003232','#326400','#643200','#644C00','#644C32','#644C64','#4C4C64',
];
function midiLedCssColor(vel) { return VELOCITY_COLORS[vel] || '#333'; }

function midiTextColor(hexBg) {
  if (!hexBg || hexBg.length < 7) return '#fff';
  const r = parseInt(hexBg.slice(1,3), 16);
  const g = parseInt(hexBg.slice(3,5), 16);
  const b = parseInt(hexBg.slice(5,7), 16);
  return (r * 0.299 + g * 0.587 + b * 0.114) > 140 ? '#000' : '#fff';
}

function updateMidiStatus(data) {
  const dot = document.getElementById('midiStatusDot');
  const label = document.getElementById('midiStatusLabel');
  if (!dot) return;
  if (data.connected) {
    dot.style.background = '#0c0';
    label.textContent = `Connected: ${data.device}`;
    label.style.color = 'var(--text)';
    document.getElementById('btnMidiConnect').style.display = 'none';
    document.getElementById('btnMidiDisconnect').style.display = '';
  } else {
    dot.style.background = '#f44';
    label.textContent = data.error ? `Error: ${data.error}` : 'Disconnected';
    label.style.color = 'var(--text-dim)';
    document.getElementById('btnMidiConnect').style.display = '';
    document.getElementById('btnMidiDisconnect').style.display = 'none';
  }
}

async function refreshMidiPorts() {
  try {
    const ports = await (await fetch('/api/midi/ports')).json();
    const sel = document.getElementById('midiDeviceSelect');
    const allPorts = [...new Set([...ports.inputs, ...ports.outputs])];
    sel.innerHTML = allPorts.length
      ? allPorts.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')
      : '<option value="">\u2014 no MIDI devices found \u2014</option>';
  } catch (e) { console.error('[MIDI] Error refreshing ports:', e); }
}

async function loadMidiStatus() {
  try {
    const data = await (await fetch('/api/midi/status')).json();
    updateMidiStatus(data);
    const sel = document.getElementById('midiDeviceSelect');
    const allPorts = [...new Set([...(data.availablePorts?.inputs || []), ...(data.availablePorts?.outputs || [])])];
    sel.innerHTML = allPorts.length
      ? allPorts.map(p => `<option value="${esc(p)}" ${p === data.device ? 'selected' : ''}>${esc(p)}</option>`).join('')
      : '<option value="">\u2014 no MIDI devices found \u2014</option>';
  } catch (e) {}
}

async function loadMidiMappings() {
  try {
    const mappings = await (await fetch('/api/midi/mappings')).json();
    const tbody = document.getElementById('midiMappingsTableBody');
    const enabled = mappings.filter(m => m.enabled).length;
    document.getElementById('midiMappingsEnabledCount').textContent = enabled;
    document.getElementById('midiMappingsTotalCount').textContent = mappings.length;
    tbody.innerHTML = mappings.map(m => {
      const disClass = m.enabled ? '' : ' sub-disabled';
      const actionLabel = MIDI_ACTION_LABELS[m.action_type] || m.action_type;
      const modeLabel = m.toggle_mode === 'toggle' ? 'Toggle' : 'Momentary';
      const modeClass = m.toggle_mode === 'toggle' ? 'soundswitch' : 'custom';
      const ledBehavior = m.led_behavior || 0;
      const ledAnim = ledBehavior >= 5 ? 'animation:blink-led .5s step-end infinite;' : ledBehavior >= 1 ? 'animation:pulse-led 1s ease-in-out infinite;' : '';
      const ledDot = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${midiLedCssColor(m.led_color||0)};border:1px solid #555;${ledAnim}"></span>`;
      return `<tr class="${disClass}">
        <td><input type="checkbox" class="sub-toggle" ${m.enabled ? 'checked' : ''} onchange="toggleMidiMap(${m.id})"></td>
        <td>${esc(m.name)}</td>
        <td><span class="sub-cat">${esc(m.midi_type)}</span></td>
        <td>${m.midi_number}</td>
        <td><span class="sub-cat custom">${esc(actionLabel)}</span></td>
        <td><span class="sub-cat ${modeClass}">${esc(modeLabel)}</span></td>
        <td>${ledDot}</td>
        <td>
          <button class="btn btn-secondary btn-sm" onclick="testMidiMap(${m.id})" title="Test">&#9654;</button>
          <button class="btn btn-secondary btn-sm" onclick="editMidiMap(${m.id})">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteMidiMap(${m.id}, '${esc(m.name)}')">Del</button>
        </td>
      </tr>`;
    }).join('');
    renderApcMiniGrid(mappings);
  } catch (e) { console.error('[MIDI] Error loading mappings:', e); }
}

function renderApcMiniGrid(mappings) {
  const grid = document.getElementById('apcMiniGrid');
  if (!grid) return;
  const noteMap = {};
  for (const m of mappings) { if (m.midi_type === 'note') noteMap[m.midi_number] = m; }
  let html = '';
  for (let row = 7; row >= 0; row--) {
    for (let col = 0; col < 8; col++) {
      const note = row * 8 + col;
      const m = noteMap[note];
      const bg = m ? (m.enabled ? midiLedCssColor(m.led_color || 13) : '#444') : '#222';
      const title = m ? `${m.name} (note ${note})` : `Note ${note}`;
      const label = m ? m.name.substring(0, 5) : '';
      const fg = midiTextColor(bg);
      html += `<div style="background:${bg};border-radius:3px;display:flex;align-items:center;justify-content:center;color:${fg};font-size:8px;cursor:pointer;border:1px solid #444;overflow:hidden;text-overflow:ellipsis" title="${esc(title)}" onclick="editMidiMapByNote(${note})">${esc(label)}</div>`;
    }
    const rightNote = 0x77 - row;
    const rm = noteMap[rightNote];
    const rbg = rm ? (rm.enabled ? midiLedCssColor(rm.led_color || 13) : '#444') : '#333';
    const rtitle = rm ? `${rm.name} (note ${rightNote})` : `Note ${rightNote}`;
    const rlabel = rm ? rm.name.substring(0, 4) : `S${8-row}`;
    const rfg = midiTextColor(rbg);
    html += `<div style="background:${rbg};border-radius:3px;display:flex;align-items:center;justify-content:center;color:${rfg};font-size:8px;cursor:pointer;border:1px solid #555" title="${esc(rtitle)}" onclick="editMidiMapByNote(${rightNote})">${esc(rlabel)}</div>`;
  }
  for (let col = 0; col < 8; col++) {
    const note = 0x64 + col;
    const m = noteMap[note];
    const bg = m ? (m.enabled ? midiLedCssColor(m.led_color || 13) : '#444') : '#333';
    const title = m ? `${m.name} (note ${note})` : `Note ${note}`;
    const label = m ? m.name.substring(0, 5) : `T${col+1}`;
    const tfg = midiTextColor(bg);
    html += `<div style="background:${bg};border-radius:3px;display:flex;align-items:center;justify-content:center;color:${tfg};font-size:8px;cursor:pointer;border:1px solid #555" title="${esc(title)}" onclick="editMidiMapByNote(${note})">${esc(label)}</div>`;
  }
  html += `<div style="background:#555;border-radius:3px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:7px;border:1px solid #666">SHIFT</div>`;
  const ccMap = {};
  for (const m of mappings) { if (m.midi_type === 'cc') ccMap[m.midi_number] = m; }
  for (let i = 0; i < 9; i++) {
    const cc = 48 + i;
    const m = ccMap[cc];
    const faderLabel = i < 8 ? `F${i+1}` : 'MST';
    const bg = m ? (m.enabled ? '#1a6b1a' : '#444') : '#2a2a2a';
    const title = m ? `${m.name} (CC ${cc})` : `Fader ${i+1} (CC ${cc})`;
    const label = m ? m.name.substring(0, 5) : faderLabel;
    html += `<div style="background:${bg};border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:8px;cursor:pointer;border:1px solid #555;gap:2px" title="${esc(title)}" onclick="editMidiMapByCC(${cc})">`;
    html += `<div style="width:4px;height:28px;background:#666;border-radius:2px;position:relative"><div style="width:10px;height:4px;background:#aaa;border-radius:1px;position:absolute;left:-3px;top:${m ? '4' : '12'}px"></div></div>`;
    html += `<div style="font-size:7px;color:#aaa">${esc(label)}</div></div>`;
  }
  grid.innerHTML = html;
}

function updateMmActionFields() {
  const type = document.getElementById('mmActionType').value;
  const midiType = document.getElementById('mmMidiType').value;
  document.getElementById('mmColorFields').style.display = type === 'color' ? '' : 'none';
  document.getElementById('mmEffectFields').style.display = type === 'effect' ? '' : 'none';
  document.getElementById('mmSceneFields').style.display = type === 'scene_activate' ? '' : 'none';
  document.getElementById('mmDimmerFields').style.display = (type === 'master_dimmer' && midiType === 'note') ? '' : 'none';
  document.getElementById('mmGroupDimmerFields').style.display = type === 'group_dimmer' ? '' : 'none';
  document.getElementById('mmChannelFields').style.display = type === 'channel' ? '' : 'none';
  document.getElementById('mmJsonGroup').style.display = type === 'set_channels' ? '' : 'none';
}
document.getElementById('mmActionType').addEventListener('change', updateMmActionFields);
document.getElementById('mmMidiType').addEventListener('change', updateMmMidiTypeActions);

const MM_ACTION_TYPES_NOTE = [
  { value: 'none', label: 'None (placeholder)' },
  { value: 'color', label: 'Color (RGBW)' },
  { value: 'effect', label: 'Run Effect' },
  { value: 'scene_activate', label: 'Activate Scene' },
  { value: 'blackout', label: 'Blackout' },
  { value: 'full_on', label: 'Full On (all channels to 255)' },
  { value: 'strobe', label: 'Strobe' },
  { value: 'master_dimmer', label: 'Master Dimmer (toggle on/off)' },
  { value: 'set_channels', label: 'Set Specific Channels (JSON)' },
];
const MM_ACTION_TYPES_CC = [
  { value: 'none', label: 'None (placeholder)' },
  { value: 'master_dimmer', label: 'Master Dimmer' },
  { value: 'effect_speed', label: 'Effect Speed' },
  { value: 'group_dimmer', label: 'Group Dimmer' },
  { value: 'channel', label: 'Direct Channel' },
];

function updateMmMidiTypeActions() {
  const midiType = document.getElementById('mmMidiType').value;
  const sel = document.getElementById('mmActionType');
  const prevVal = sel.value;
  const opts = midiType === 'cc' ? MM_ACTION_TYPES_CC : MM_ACTION_TYPES_NOTE;
  sel.innerHTML = opts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');
  if (opts.some(o => o.value === prevVal)) sel.value = prevVal;
  const isCC = midiType === 'cc';
  document.getElementById('mmToggleModeGroup').style.display = isCC ? 'none' : '';
  document.getElementById('mmLedGroup').style.display = isCC ? 'none' : '';
  document.getElementById('mmLedBehaviorGroup').style.display = isCC ? 'none' : '';
  updateMmActionFields();
}
updateMmMidiTypeActions();

async function openMidiMapModal(mapId) {
  document.getElementById('midiMapEditId').value = mapId || '';
  document.getElementById('midiMapModalTitle').textContent = mapId ? 'Edit MIDI Mapping' : 'Add MIDI Mapping';
  document.getElementById('midiMapError').textContent = '';
  try {
    const effects = await (await fetch('/api/effects')).json();
    document.getElementById('mmEffectSelect').innerHTML = effects.map(e => `<option value="${e.id}">${esc(e.name)} (${e.type})</option>`).join('');
  } catch(e) {}
  try {
    const scenes = await (await fetch('/api/scenes')).json();
    document.getElementById('mmSceneSelect').innerHTML = scenes.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  } catch(e) {}
  try {
    const groups = await (await fetch('/api/groups')).json();
    const opts = '<option value="">All Fixtures</option>' + groups.map(g => `<option value="${g.id}">${esc(g.name)}</option>`).join('');
    document.getElementById('mmColorGroup').innerHTML = opts;
    document.getElementById('mmEffectGroup').innerHTML = opts;
    document.getElementById('mmGroupDimmerGroup').innerHTML = opts;
  } catch(e) {}
  if (mapId) {
    const m = await (await fetch(`/api/midi/mappings/${mapId}`)).json();
    document.getElementById('mmName').value = m.name;
    document.getElementById('mmMidiType').value = m.midi_type;
    updateMmMidiTypeActions();
    document.getElementById('mmMidiNumber').value = m.midi_number;
    document.getElementById('mmMidiChannel').value = m.midi_channel;
    document.getElementById('mmActionType').value = m.action_type;
    document.getElementById('mmToggleMode').value = m.toggle_mode;
    document.getElementById('mmLedColor').value = m.led_color;
    document.getElementById('mmLedActiveColor').value = m.led_active_color;
    document.getElementById('mmLedBehavior').value = m.led_behavior || 0;
    document.getElementById('mmLedActiveBehavior').value = m.led_active_behavior || 0;
    let ad = {};
    try { ad = JSON.parse(m.action_data || '{}'); } catch(e) {}
    if (m.action_type === 'color') {
      document.getElementById('mmColorR').value = ad.red || 0;
      document.getElementById('mmColorG').value = ad.green || 0;
      document.getElementById('mmColorB').value = ad.blue || 0;
      document.getElementById('mmColorW').value = ad.white || 0;
      if (ad.group_id) document.getElementById('mmColorGroup').value = ad.group_id;
    } else if (m.action_type === 'effect') {
      if (ad.effect_id) document.getElementById('mmEffectSelect').value = ad.effect_id;
      if (ad.group_id) document.getElementById('mmEffectGroup').value = ad.group_id;
    } else if (m.action_type === 'scene_activate') {
      if (ad.scene_id) document.getElementById('mmSceneSelect').value = ad.scene_id;
    } else if (m.action_type === 'master_dimmer') {
      document.getElementById('mmDimmerValue').value = ad.value !== undefined ? ad.value : 255;
    } else if (m.action_type === 'group_dimmer') {
      if (ad.group_id) document.getElementById('mmGroupDimmerGroup').value = ad.group_id;
    } else if (m.action_type === 'channel') {
      document.getElementById('mmChannelUniverse').value = ad.universe || 1;
      document.getElementById('mmChannelNumber').value = ad.channel || 1;
    } else {
      document.getElementById('mmActionData').value = m.action_data || '{}';
    }
  } else {
    document.getElementById('mmName').value = '';
    document.getElementById('mmMidiType').value = 'note';
    updateMmMidiTypeActions();
    document.getElementById('mmMidiNumber').value = '0';
    document.getElementById('mmMidiChannel').value = '0';
    document.getElementById('mmActionType').value = 'color';
    document.getElementById('mmToggleMode').value = 'momentary';
    document.getElementById('mmLedColor').value = '13';
    document.getElementById('mmLedActiveColor').value = '21';
    document.getElementById('mmLedBehavior').value = '0';
    document.getElementById('mmLedActiveBehavior').value = '0';
    document.getElementById('mmColorR').value = 255;
    document.getElementById('mmColorG').value = 0;
    document.getElementById('mmColorB').value = 0;
    document.getElementById('mmColorW').value = 0;
    document.getElementById('mmActionData').value = '{}';
  }
  updateMmActionFields();
  document.getElementById('midiMapModal').classList.add('open');
}

document.getElementById('btnSaveMidiMap').addEventListener('click', async () => {
  const editId = document.getElementById('midiMapEditId').value;
  const name = document.getElementById('mmName').value.trim();
  const midi_type = document.getElementById('mmMidiType').value;
  const midi_number = +document.getElementById('mmMidiNumber').value;
  const midi_channel = +document.getElementById('mmMidiChannel').value;
  const action_type = document.getElementById('mmActionType').value;
  const toggle_mode = document.getElementById('mmToggleMode').value;
  const led_color = +document.getElementById('mmLedColor').value;
  const led_active_color = +document.getElementById('mmLedActiveColor').value;
  const led_behavior = +document.getElementById('mmLedBehavior').value;
  const led_active_behavior = +document.getElementById('mmLedActiveBehavior').value;
  if (!name) return showError('midiMapError', 'Name is required');
  let action_data = '{}';
  if (action_type === 'color') {
    const data = { red: +document.getElementById('mmColorR').value || 0, green: +document.getElementById('mmColorG').value || 0, blue: +document.getElementById('mmColorB').value || 0, white: +document.getElementById('mmColorW').value || 0 };
    const gid = document.getElementById('mmColorGroup').value;
    if (gid) data.group_id = +gid;
    action_data = JSON.stringify(data);
  } else if (action_type === 'effect') {
    const eid = +document.getElementById('mmEffectSelect').value;
    if (!eid) return showError('midiMapError', 'Please select an effect');
    const data = { effect_id: eid };
    const gid = document.getElementById('mmEffectGroup').value;
    if (gid) data.group_id = +gid;
    action_data = JSON.stringify(data);
  } else if (action_type === 'scene_activate') {
    const sid = +document.getElementById('mmSceneSelect').value;
    if (!sid) return showError('midiMapError', 'Please select a scene');
    action_data = JSON.stringify({ scene_id: sid });
  } else if (action_type === 'master_dimmer') {
    action_data = JSON.stringify({ value: Math.max(0, Math.min(255, +document.getElementById('mmDimmerValue').value || 255)) });
  } else if (action_type === 'group_dimmer') {
    const gid = document.getElementById('mmGroupDimmerGroup').value;
    action_data = JSON.stringify(gid ? { group_id: +gid } : {});
  } else if (action_type === 'channel') {
    action_data = JSON.stringify({ universe: +document.getElementById('mmChannelUniverse').value || 1, channel: +document.getElementById('mmChannelNumber').value || 1 });
  } else if (action_type === 'set_channels') {
    action_data = document.getElementById('mmActionData').value.trim() || '{}';
    try { JSON.parse(action_data); } catch (e) { return showError('midiMapError', 'Action data must be valid JSON'); }
  }
  const body = { name, midi_type, midi_number, midi_channel, action_type, action_data, toggle_mode, led_color, led_active_color, led_behavior, led_active_behavior };
  const url = editId ? `/api/midi/mappings/${editId}` : '/api/midi/mappings';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) return showError('midiMapError', data.error);
  closeModal('midiMapModal');
  loadMidiMappings();
});

window.editMidiMap = (id) => openMidiMapModal(id);
window.editMidiMapByNote = (note) => {
  fetch('/api/midi/mappings').then(r => r.json()).then(mappings => {
    const existing = mappings.find(m => m.midi_type === 'note' && m.midi_number === note);
    if (existing) { openMidiMapModal(existing.id); }
    else {
      openMidiMapModal();
      setTimeout(() => {
        document.getElementById('mmMidiType').value = 'note';
        document.getElementById('mmMidiNumber').value = note;
        updateMmMidiTypeActions();
        let autoName = `Note ${note}`;
        if (note >= 0 && note <= 63) autoName = `Grid ${Math.floor(note/8)+1}:${note%8+1}`;
        else if (note >= 64 && note <= 71) autoName = `Bottom ${note-63}`;
        else if (note >= 82 && note <= 89) autoName = `Scene ${note-81}`;
        document.getElementById('mmName').value = autoName;
      }, 50);
    }
  });
};

window.editMidiMapByCC = (cc) => {
  fetch('/api/midi/mappings').then(r => r.json()).then(mappings => {
    const existing = mappings.find(m => m.midi_type === 'cc' && m.midi_number === cc);
    if (existing) { openMidiMapModal(existing.id); }
    else {
      openMidiMapModal();
      setTimeout(() => {
        document.getElementById('mmMidiType').value = 'cc';
        document.getElementById('mmMidiNumber').value = cc;
        updateMmMidiTypeActions();
        const faderIdx = cc - 48;
        document.getElementById('mmName').value = faderIdx === 8 ? 'Master Fader' : `Fader ${faderIdx + 1}`;
        document.getElementById('mmActionType').value = faderIdx === 8 ? 'master_dimmer' : 'group_dimmer';
        updateMmActionFields();
      }, 50);
    }
  });
};

window.deleteMidiMap = async (id, name) => { if (!confirm(`Delete MIDI mapping "${name}"?`)) return; await fetch(`/api/midi/mappings/${id}`, { method: 'DELETE' }); loadMidiMappings(); };
window.toggleMidiMap = async (id) => { await fetch(`/api/midi/mappings/${id}/toggle`, { method: 'POST' }); loadMidiMappings(); };
window.testMidiMap = async (id) => { await fetch(`/api/midi/mappings/test/${id}`, { method: 'POST' }); };

document.getElementById('btnAddMidiMapping').addEventListener('click', () => openMidiMapModal());

document.getElementById('btnMidiConnect').addEventListener('click', async () => {
  const device = document.getElementById('midiDeviceSelect').value;
  const res = await fetch('/api/midi/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device }) });
  const data = await res.json();
  updateMidiStatus(data);
});

document.getElementById('btnMidiDisconnect').addEventListener('click', async () => {
  await fetch('/api/midi/disconnect', { method: 'POST' });
  updateMidiStatus({ connected: false });
});

document.getElementById('btnMidiRefreshPorts').addEventListener('click', refreshMidiPorts);

document.getElementById('btnMidiDefaults').addEventListener('click', async () => {
  if (!confirm('This will replace all existing MIDI mappings with the default APC Mini layout. Continue?')) return;
  await fetch('/api/midi/presets/default', { method: 'POST' });
  loadMidiMappings();
});

document.getElementById('btnMidiLearn').addEventListener('click', async () => {
  const btn = document.getElementById('btnMidiLearn');
  btn.textContent = 'Listening...';
  btn.disabled = true;
  try {
    const res = await fetch('/api/midi/learn', { method: 'POST' });
    const data = await res.json();
    if (data.error) { alert(`MIDI Learn: ${data.error}`); }
    else {
      openMidiMapModal();
      setTimeout(() => {
        document.getElementById('mmMidiType').value = data.type;
        document.getElementById('mmMidiNumber').value = data.number;
        document.getElementById('mmMidiChannel').value = data.channel;
        const note = data.number;
        let autoName = `${data.type === 'cc' ? 'Fader' : 'Pad'} ${note}`;
        if (data.type === 'note') {
          if (note >= 0 && note <= 63) autoName = `Grid ${Math.floor(note/8)+1}:${note%8+1}`;
          else if (note >= 64 && note <= 71) autoName = `Bottom ${note-63}`;
          else if (note >= 82 && note <= 89) autoName = `Scene ${note-81}`;
        } else { if (note >= 48 && note <= 56) autoName = `Fader ${note-47}`; }
        document.getElementById('mmName').value = autoName;
      }, 50);
    }
  } catch (e) { alert('MIDI Learn failed'); }
  finally { btn.textContent = 'MIDI Learn'; btn.disabled = false; }
});

document.querySelectorAll('.config-sidebar-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.cfgtab === 'midi') { loadMidiStatus(); loadMidiMappings(); }
  });
});

// ═══════════════════════════════════════════════════════════════
//  Fixture Library (paginated search + modal editor)
// ═══════════════════════════════════════════════════════════════
let _libraryPage = { types: [], total: 0, page: 1, pageSize: 50, loading: false };

function _libGotoPage(page) { _libraryPage.page = page; loadTypes(); }
window._libGotoPage = _libGotoPage;

async function loadTypes(resetPage) {
  if (_libraryPage.loading) return;
  _libraryPage.loading = true;
  if (resetPage) _libraryPage.page = 1;
  showLoading('typesList');
  const q = (document.getElementById('filterLibraryName').value || '').trim();
  const cat = document.getElementById('filterLibraryCategory').value;
  const mfr = document.getElementById('filterLibraryManufacturer').value;
  const offset = (_libraryPage.page - 1) * _libraryPage.pageSize;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (cat) params.set('category', cat);
  if (mfr) params.set('manufacturer', mfr);
  params.set('limit', _libraryPage.pageSize);
  params.set('offset', offset);
  try {
    const data = await fetch('/api/fixture-types/search?' + params).then(r => r.json());
    _libraryPage.types = data.types;
    _libraryPage.total = data.total;
    if (data.categories) {
      const catSel = document.getElementById('filterLibraryCategory');
      const prevCat = catSel.value;
      catSel.innerHTML = '<option value="">All Categories</option>' + data.categories.map(c => `<option value="${c}">${CATEGORY_LABELS[c]||c}</option>`).join('');
      catSel.value = prevCat;
    }
    if (data.manufacturers) {
      const mfrSel = document.getElementById('filterLibraryManufacturer');
      const prevMfr = mfrSel.value;
      mfrSel.innerHTML = '<option value="">All Manufacturers</option>' + data.manufacturers.map(m => `<option value="${m}">${esc(m)}</option>`).join('');
      mfrSel.value = prevMfr;
    }
    renderLibraryList();
  } catch (e) { console.error('Library search error:', e); }
  finally { _libraryPage.loading = false; }
}

function renderLibraryList() {
  const { types, total, page, pageSize } = _libraryPage;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(page * pageSize, total);
  document.getElementById('libraryCount').textContent = total > 0
    ? `${from}\u2013${to} of ${total}` : '0 fixture types';
  const tbody = document.getElementById('typesList');
  tbody.innerHTML = '';
  for (const t of types) {
    const modes = t.modes || [];
    const modeBadges = modes.length > 0
      ? modes.map(m => `<span class="mode-badge">${esc(m.short_name || m.name)} <span class="mode-ch">${m.channel_count}ch</span></span>`).join('')
      : `<span class="mode-badge">Default <span class="mode-ch">${t.channel_count}ch</span></span>`;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="lib-name" title="${esc(t.name)}">${esc(t.name)}</td>
      <td class="lib-mfr">${esc(t.manufacturer || '\u2014')}</td>
      <td><span class="lib-cat">${CATEGORY_LABELS[t.category] || t.category}</span></td>
      <td><div class="lib-modes">${modeBadges}</div></td>
      <td class="lib-actions">
        <button class="btn btn-secondary btn-sm" onclick="editType(${t.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteType(${t.id},'${esc(t.name).replace(/'/g, "\\'")}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
  }
  const pagBar = document.getElementById('libraryPagination');
  if (totalPages <= 1) { pagBar.innerHTML = ''; return; }
  let html = '<div class="pag-pages">';
  html += `<button class="pag-btn" ${page <= 1 ? 'disabled' : ''} onclick="_libGotoPage(${page - 1})">&lsaquo;</button>`;
  const pages = _buildPageNumbers(page, totalPages);
  for (const p of pages) {
    if (p === '...') html += '<span class="pag-ellipsis">\u2026</span>';
    else html += `<button class="pag-btn${p === page ? ' active' : ''}" onclick="_libGotoPage(${p})">${p}</button>`;
  }
  html += `<button class="pag-btn" ${page >= totalPages ? 'disabled' : ''} onclick="_libGotoPage(${page + 1})">&rsaquo;</button></div>`;
  html += '<div style="display:flex;align-items:center;gap:6px"><span>Show</span><select onchange="_libraryPage.pageSize=+this.value;_libGotoPage(1)">';
  for (const s of [25, 50, 100, 200]) html += `<option value="${s}"${s === pageSize ? ' selected' : ''}>${s}</option>`;
  html += '</select><span>per page</span></div>';
  pagBar.innerHTML = html;
}

function _buildPageNumbers(current, total) {
  const delta = 1, pages = [];
  const rangeStart = Math.max(2, current - delta);
  const rangeEnd = Math.min(total - 1, current + delta);
  pages.push(1);
  if (rangeStart > 2) pages.push('...');
  for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
  if (rangeEnd < total - 1) pages.push('...');
  if (total > 1) pages.push(total);
  return pages;
}

let _libSearchTimer = null;
function triggerLibrarySearch() { clearTimeout(_libSearchTimer); _libSearchTimer = setTimeout(() => loadTypes(true), 250); }
document.getElementById('filterLibraryName').addEventListener('input', triggerLibrarySearch);
document.getElementById('filterLibraryCategory').addEventListener('change', () => loadTypes(true));
document.getElementById('filterLibraryManufacturer').addEventListener('change', () => loadTypes(true));

// ─── OFL Import ─────────────────────────────────────────────────────────────
let _oflParsedData = null;
let _oflPreview = null;

document.getElementById('btnImportOFL').addEventListener('click', () => { document.getElementById('oflFileInput').click(); });

document.getElementById('oflFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    _oflParsedData = data;
    const res = await fetch('/api/fixture-library/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: text });
    _oflPreview = await res.json();
    renderOflPanel();
  } catch (err) { alert('Failed to parse OFL file: ' + err.message); }
});

function renderOflPanel() {
  const panel = document.getElementById('oflImportPanel');
  panel.style.display = '';
  document.getElementById('oflImportResults').style.display = 'none';
  const totalModes = _oflPreview.fixtures.reduce((s,f) => s + f.modes.length, 0);
  document.getElementById('oflSummary').textContent = `Found ${_oflPreview.count} fixture(s) with ${totalModes} total mode(s).`;
  const list = document.getElementById('oflFixtureList');
  list.innerHTML = '';
  for (let idx = 0; idx < _oflPreview.fixtures.length; idx++) {
    const fix = _oflPreview.fixtures[idx];
    const modesSummary = fix.modes.map(m => `${m.name} (${m.channelCount}ch)`).join(', ');
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid var(--panel-border);font-size:12px;cursor:pointer';
    row.innerHTML = `
      <input type="checkbox" class="ofl-fixture-check" data-idx="${idx}" checked style="accent-color:var(--accent)">
      <span style="flex:1;color:var(--text);font-weight:500">${esc(fix.name)}</span>
      <span style="color:var(--text-dim)">${esc(fix.manufacturer)}</span>
      <span style="color:var(--text-dim)">${fix.categories.join(', ')}</span>
      <span style="color:var(--cyan);font-size:11px">${esc(modesSummary)}</span>`;
    list.appendChild(row);
  }
  updateOflSelectedCount();
}

function updateOflSelectedCount() {
  const checks = document.querySelectorAll('.ofl-fixture-check');
  const checked = [...checks].filter(c => c.checked).length;
  document.getElementById('oflSelectedCount').textContent = `${checked} of ${checks.length} selected`;
}

document.getElementById('oflImportPanel').addEventListener('change', (e) => { if (e.target.classList.contains('ofl-fixture-check')) updateOflSelectedCount(); });
document.getElementById('btnOflSelectAll').addEventListener('click', () => { document.querySelectorAll('.ofl-fixture-check').forEach(c => c.checked = true); updateOflSelectedCount(); });
document.getElementById('btnOflSelectNone').addEventListener('click', () => { document.querySelectorAll('.ofl-fixture-check').forEach(c => c.checked = false); updateOflSelectedCount(); });
document.getElementById('btnCloseOflPanel').addEventListener('click', () => { document.getElementById('oflImportPanel').style.display = 'none'; _oflParsedData = null; _oflPreview = null; });

document.getElementById('btnOflImportSelected').addEventListener('click', async () => {
  if (!_oflParsedData) return;
  const checks = document.querySelectorAll('.ofl-fixture-check');
  const selected = [...checks].filter(c => c.checked).map(c => +c.dataset.idx);
  if (selected.length === 0) return alert('No fixtures selected');
  const btn = document.getElementById('btnOflImportSelected');
  btn.disabled = true; btn.textContent = 'Importing\u2026';
  try {
    const res = await fetch('/api/fixture-library/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: _oflParsedData, selectedFixtures: selected }) });
    const result = await res.json();
    const resultsEl = document.getElementById('oflImportResults');
    resultsEl.style.display = '';
    if (result.error) {
      resultsEl.innerHTML = `<div style="color:var(--danger)">Error: ${esc(result.error)}</div>`;
    } else {
      let html = `<div style="color:var(--green)">Imported: ${result.imported} | Updated: ${result.updated}</div>`;
      if (result.errors && result.errors.length > 0) {
        html += `<div style="color:var(--warning);margin-top:4px">${result.errors.length} error(s):</div>`;
        html += result.errors.slice(0, 20).map(e => `<div style="color:var(--text-dim);padding-left:12px;font-size:11px">${esc(e)}</div>`).join('');
        if (result.errors.length > 20) html += `<div style="color:var(--text-dim);padding-left:12px">\u2026and ${result.errors.length - 20} more</div>`;
      }
      resultsEl.innerHTML = html;
      loadTypes();
    }
  } catch (err) { alert('Import failed: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Import Selected'; }
});

// ─── Type Modal (create/edit fixture type) ──────────────────────────────────
document.getElementById('btnAddType').addEventListener('click', () => openTypeModal());

let typeChannels = [];
let typeModes = [];
let activeMode = 0;

function saveModeChannels() {
  if (typeModes[activeMode]) typeModes[activeMode].channels = typeChannels.map(ch => ({...ch}));
}

function switchToMode(idx) {
  saveModeChannels();
  activeMode = idx;
  const m = typeModes[activeMode];
  typeChannels = (m.channels || []).map(ch => ({...ch}));
  document.getElementById('tModeName').value = m.name || '';
  document.getElementById('tModeShortName').value = m.short_name || '';
  renderModeTabs();
  renderChannelsEditor();
  updateMultiCellVisibility();
  updateDuplicateHint();
}

function renderModeTabs() {
  const tabs = document.getElementById('modeTabs');
  tabs.innerHTML = '';
  typeModes.forEach((m, i) => {
    const tab = document.createElement('span');
    tab.className = 'mode-tab' + (i === activeMode ? ' active' : '');
    const chCount = m.channels ? m.channels.length : 0;
    tab.innerHTML = `${esc(m.name || 'Mode ' + (i+1))} <span style="color:var(--cyan);font-size:10px">${chCount}ch</span>` +
      (typeModes.length > 1 ? `<span class="mode-tab-remove" data-midx="${i}">&times;</span>` : '');
    tab.addEventListener('click', (e) => { if (e.target.classList.contains('mode-tab-remove')) return; switchToMode(i); });
    tabs.appendChild(tab);
  });
  tabs.querySelectorAll('.mode-tab-remove').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const mi = +btn.dataset.midx;
      if (typeModes.length <= 1) return;
      if (!confirm(`Remove mode "${typeModes[mi].name || 'Mode ' + (mi+1)}"?`)) return;
      typeModes.splice(mi, 1);
      if (activeMode >= typeModes.length) activeMode = typeModes.length - 1;
      switchToMode(activeMode);
    });
  });
  const addBtn = document.createElement('button');
  addBtn.className = 'mode-tab-add'; addBtn.type = 'button'; addBtn.textContent = '+'; addBtn.title = 'Add mode';
  addBtn.addEventListener('click', () => { saveModeChannels(); typeModes.push({ name: '', short_name: '', channels: [] }); switchToMode(typeModes.length - 1); });
  tabs.appendChild(addBtn);
  document.getElementById('chCountLabel').textContent = `(${typeChannels.length} in this mode)`;
}

document.getElementById('tModeName').addEventListener('input', (e) => { if (typeModes[activeMode]) { typeModes[activeMode].name = e.target.value; renderModeTabs(); } });
document.getElementById('tModeShortName').addEventListener('input', (e) => { if (typeModes[activeMode]) typeModes[activeMode].short_name = e.target.value; });

function renderChannelsEditor() {
  const ed = document.getElementById('channelsEditor');
  ed.innerHTML = '';
  typeChannels.forEach((ch, i) => {
    const hasRanges = ch.ranges && ch.ranges.length > 0;
    const wrapper = document.createElement('div');
    wrapper.className = 'ch-item';
    const row = document.createElement('div');
    row.className = 'ch-row';
    const cellVal = ch.cell || '';
    row.innerHTML = `
      <span style="font-size:11px;color:var(--text-dim);width:20px;padding-top:4px">${i+1}</span>
      <div class="ch-main">
        <input class="ch-name" type="text" value="${esc(ch.name)}" placeholder="Channel name" data-idx="${i}" data-field="name">
        <select data-idx="${i}" data-field="type">
          ${CHANNEL_TYPES.map(t => `<option value="${t}" ${t===ch.type?'selected':''}>${t}</option>`).join('')}
        </select>
        <input type="number" value="${ch.default_value||0}" min="0" max="255" data-idx="${i}" data-field="default_value" title="Default value" style="width:55px">
        <input type="number" value="${cellVal}" min="0" max="64" data-idx="${i}" data-field="cell" placeholder="Cell" title="Cell number (0 or empty = master)" style="width:55px">
        <button type="button" class="ch-ranges-toggle ${hasRanges ? 'has-ranges' : ''}" data-idx="${i}" title="Define value ranges for multi-function channels">
          ${hasRanges ? `Ranges (${ch.ranges.length})` : '+ Ranges'}
        </button>
      </div>
      <button class="ch-remove" onclick="removeChannel(${i})">&times;</button>`;
    wrapper.appendChild(row);
    if (hasRanges || ch._rangesOpen) {
      const rangesWrap = document.createElement('div');
      rangesWrap.className = 'ch-ranges-wrap';
      rangesWrap.id = `ch-ranges-${i}`;
      const ranges = ch.ranges || [];
      rangesWrap.innerHTML = `
        <table>
          <thead><tr><th>Min</th><th>Max</th><th>Label</th><th>Type</th><th></th></tr></thead>
          <tbody>
          ${ranges.map((r, ri) => `
            <tr>
              <td><input type="number" class="range-min" value="${r.min}" min="0" max="255" data-chidx="${i}" data-ridx="${ri}" data-rfield="min"></td>
              <td><input type="number" class="range-max" value="${r.max}" min="0" max="255" data-chidx="${i}" data-ridx="${ri}" data-rfield="max"></td>
              <td><input type="text" class="range-label" value="${esc(r.label || '')}" data-chidx="${i}" data-ridx="${ri}" data-rfield="label" placeholder="e.g. Strobe"></td>
              <td><select data-chidx="${i}" data-ridx="${ri}" data-rfield="type">
                ${CHANNEL_TYPES.map(t => `<option value="${t}" ${t===(r.type||ch.type)?'selected':''}>${t}</option>`).join('')}
              </select></td>
              <td><button type="button" class="range-remove" data-chidx="${i}" data-ridx="${ri}">&times;</button></td>
            </tr>
          `).join('')}
          </tbody>
        </table>
        <div class="range-actions">
          <button type="button" class="btn btn-secondary btn-sm range-add" data-chidx="${i}">+ Add</button>
          ${ranges.length > 0 ? `<button type="button" class="btn btn-secondary btn-sm range-add" data-chidx="${i}" data-action="clear" style="color:var(--danger)">Clear</button>` : ''}
        </div>`;
      wrapper.appendChild(rangesWrap);
    }
    ed.appendChild(wrapper);
  });
  ed.querySelectorAll('.ch-main input, .ch-main select').forEach(el => {
    el.addEventListener('change', () => {
      const idx = +el.dataset.idx, field = el.dataset.field;
      if (field === 'default_value') typeChannels[idx][field] = +el.value;
      else if (field === 'cell') typeChannels[idx][field] = el.value ? +el.value : null;
      else typeChannels[idx][field] = el.value;
      if (field === 'type') renderChannelsEditor();
    });
  });
  ed.querySelectorAll('.ch-ranges-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      if (!typeChannels[idx].ranges) typeChannels[idx].ranges = [];
      typeChannels[idx]._rangesOpen = !typeChannels[idx]._rangesOpen;
      if (typeChannels[idx]._rangesOpen && typeChannels[idx].ranges.length === 0) {
        typeChannels[idx].ranges.push({ min: 0, max: 255, label: '', type: typeChannels[idx].type });
      }
      renderChannelsEditor();
    });
  });
  ed.querySelectorAll('.ch-ranges-wrap input, .ch-ranges-wrap select').forEach(el => {
    if (!el.dataset.rfield) return;
    el.addEventListener('change', () => {
      const ci = +el.dataset.chidx, ri = +el.dataset.ridx, field = el.dataset.rfield;
      if (field === 'min' || field === 'max') typeChannels[ci].ranges[ri][field] = +el.value;
      else typeChannels[ci].ranges[ri][field] = el.value;
    });
  });
  ed.querySelectorAll('.range-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = +btn.dataset.chidx, ri = +btn.dataset.ridx;
      typeChannels[ci].ranges.splice(ri, 1);
      if (typeChannels[ci].ranges.length === 0) { typeChannels[ci].ranges = null; typeChannels[ci]._rangesOpen = false; }
      renderChannelsEditor();
    });
  });
  ed.querySelectorAll('.range-add').forEach(btn => {
    btn.addEventListener('click', () => {
      const ci = +btn.dataset.chidx;
      if (btn.dataset.action === 'clear') { typeChannels[ci].ranges = null; typeChannels[ci]._rangesOpen = false; }
      else {
        if (!typeChannels[ci].ranges) typeChannels[ci].ranges = [];
        const lastMax = typeChannels[ci].ranges.length > 0 ? typeChannels[ci].ranges[typeChannels[ci].ranges.length - 1].max + 1 : 0;
        typeChannels[ci].ranges.push({ min: Math.min(lastMax, 255), max: 255, label: '', type: typeChannels[ci].type });
      }
      renderChannelsEditor();
    });
  });
  updateColorWheelVisibility();
}

window.removeChannel = (i) => { typeChannels.splice(i, 1); renderChannelsEditor(); updateDuplicateHint(); saveModeChannels(); renderModeTabs(); };

document.getElementById('btnAddChannel').addEventListener('click', () => {
  const num = typeChannels.length + 1;
  typeChannels.push({ channel_number: num, name: `Channel ${num}`, type: 'dimmer', default_value: 0, min_value: 0, max_value: 255, ranges: null, cell: null });
  renderChannelsEditor(); updateDuplicateHint(); saveModeChannels(); renderModeTabs();
});

function updateMultiCellVisibility() {
  const cat = document.getElementById('tCategory').value;
  document.getElementById('tMultiCellGroup').style.display = (cat === 'multi_cell' || cat === 'led_bar') ? '' : 'none';
}
document.getElementById('tCategory').addEventListener('change', updateMultiCellVisibility);

const MULTI_CELL_PATTERNS = {
  rgb: ['red', 'green', 'blue'], rgbw: ['red', 'green', 'blue', 'white'],
  rgbwa: ['red', 'green', 'blue', 'white', 'amber'], rgbd: ['red', 'green', 'blue', 'dimmer'],
  rgbwd: ['red', 'green', 'blue', 'white', 'dimmer'],
};

document.getElementById('btnBuildMultiCell').addEventListener('click', () => {
  const cellCount = Math.max(1, +document.getElementById('tMultiCellCount').value || 4);
  const patternKey = document.getElementById('tMultiCellPattern').value;
  const pattern = MULTI_CELL_PATTERNS[patternKey] || MULTI_CELL_PATTERNS.rgb;
  const masterChannels = typeChannels.filter(ch => !ch.cell);
  const cellChannels = [];
  for (let cell = 1; cell <= cellCount; cell++) {
    for (const type of pattern) {
      cellChannels.push({ channel_number: 0, name: `Cell ${cell} ${type.charAt(0).toUpperCase() + type.slice(1)}`, type, default_value: 0, min_value: 0, max_value: 255, ranges: null, cell });
    }
  }
  typeChannels = [...masterChannels, ...cellChannels];
  typeChannels.forEach((ch, i) => { ch.channel_number = i + 1; });
  renderChannelsEditor(); updateDuplicateHint(); saveModeChannels(); renderModeTabs();
  const hint = document.getElementById('tMultiCellHint');
  hint.textContent = `Built ${masterChannels.length} master + ${cellChannels.length} cell channels (${cellCount} cells \u00D7 ${pattern.length}ch)`;
  hint.style.color = 'var(--accent)';
});

// ─── Color Wheel Map Editor ─────────────────────────────────────
let cwColors = [];

function updateColorWheelVisibility() {
  const currentHas = typeChannels.some(ch => ch.type === 'color_wheel');
  const othersHave = typeModes.some((m, i) => i !== activeMode && (m.channels || []).some(ch => ch.type === 'color_wheel'));
  document.getElementById('colorWheelGroup').style.display = (currentHas || othersHave) ? '' : 'none';
}

function renderCwEditor() {
  const container = document.getElementById('cwEditorRows');
  container.innerHTML = '';
  cwColors.forEach((c, i) => {
    const row = document.createElement('div');
    row.className = 'cw-row';
    row.innerHTML = `
      <span style="font-size:11px;color:var(--text-dim);width:16px;padding-top:2px">${i+1}</span>
      <input type="number" value="${c.dmx_start}" min="0" max="255" title="DMX start value" data-idx="${i}" data-field="dmx_start">
      <input type="number" value="${c.dmx_end}" min="0" max="255" title="DMX end value" data-idx="${i}" data-field="dmx_end">
      <input type="color" value="${c.color_hex}" data-idx="${i}" data-field="color_hex_picker">
      <input type="text" class="cw-hex" value="${esc(c.color_hex)}" data-idx="${i}" data-field="color_hex" placeholder="#RRGGBB">
      <input type="text" value="${esc(c.label || '')}" data-idx="${i}" data-field="label" placeholder="Color name">
      <button type="button" class="cw-remove" data-idx="${i}">&times;</button>`;
    container.appendChild(row);
  });
  container.querySelectorAll('input').forEach(el => {
    el.addEventListener('change', () => {
      const idx = +el.dataset.idx, field = el.dataset.field;
      if (field === 'dmx_start') cwColors[idx].dmx_start = Math.max(0, Math.min(255, +el.value));
      else if (field === 'dmx_end') cwColors[idx].dmx_end = Math.max(0, Math.min(255, +el.value));
      else if (field === 'color_hex_picker') { cwColors[idx].color_hex = el.value; renderCwEditor(); }
      else if (field === 'color_hex') { const v = el.value.trim(); if (/^#[0-9a-fA-F]{6}$/.test(v)) { cwColors[idx].color_hex = v; renderCwEditor(); } }
      else if (field === 'label') cwColors[idx].label = el.value;
    });
  });
  container.querySelectorAll('.cw-remove').forEach(btn => { btn.addEventListener('click', () => { cwColors.splice(+btn.dataset.idx, 1); renderCwEditor(); }); });
}

document.getElementById('btnAddCwColor').addEventListener('click', () => {
  const lastEnd = cwColors.length > 0 ? cwColors[cwColors.length - 1].dmx_end + 1 : 0;
  cwColors.push({ dmx_start: Math.min(lastEnd, 255), dmx_end: Math.min(lastEnd + 9, 255), color_hex: '#ffffff', label: '' });
  renderCwEditor();
});

async function openTypeModal(typeId) {
  cwColors = [];
  if (typeId) {
    const t = await fetch(`/api/fixture-types/${typeId}`).then(r=>r.json());
    document.getElementById('typeModalTitle').textContent = 'Edit Fixture Type';
    document.getElementById('typeEditId').value = t.id;
    document.getElementById('tName').value = t.name;
    document.getElementById('tManufacturer').value = t.manufacturer || '';
    document.getElementById('tCategory').value = t.category;
    if (t.modes && t.modes.length > 0) {
      typeModes = t.modes.map(m => ({ name: m.name, short_name: m.short_name || '', channels: (m.channels || []).map(c => ({...c})) }));
    } else {
      typeModes = [{ name: 'Default', short_name: '', channels: t.channels ? t.channels.map(c => ({...c})) : [] }];
    }
    try {
      const cwData = await fetch(`/api/fixture-types/${typeId}/color-wheel`).then(r=>r.json());
      if (Array.isArray(cwData)) cwColors = cwData.map(c => ({ dmx_start: c.dmx_start, dmx_end: c.dmx_end, color_hex: c.color_hex, label: c.label || '' }));
    } catch(e) {}
  } else {
    document.getElementById('typeModalTitle').textContent = 'Add Fixture Type';
    document.getElementById('typeEditId').value = '';
    document.getElementById('tName').value = '';
    document.getElementById('tManufacturer').value = '';
    document.getElementById('tCategory').value = 'par';
    typeModes = [{ name: 'Default', short_name: '', channels: [] }];
  }
  activeMode = 0;
  typeChannels = (typeModes[0].channels || []).map(ch => ({...ch}));
  document.getElementById('tModeName').value = typeModes[0].name || '';
  document.getElementById('tModeShortName').value = typeModes[0].short_name || '';
  renderModeTabs(); renderChannelsEditor(); updateMultiCellVisibility(); updateColorWheelVisibility(); renderCwEditor();
  document.getElementById('tDuplicateCount').value = '1';
  document.getElementById('tDuplicateHint').textContent = '';
  updateDuplicateHint();
  document.getElementById('typeError').textContent = '';
  document.getElementById('typeModal').classList.add('open');
}

window.editType = (id) => openTypeModal(id);
window.deleteType = async (id, name) => {
  if (!confirm(`Delete fixture type "${name}"?`)) return;
  const res = await fetch(`/api/fixture-types/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (data.error) return alert(data.error);
  loadTypes();
};

document.getElementById('btnSaveType').addEventListener('click', async () => {
  const editId = document.getElementById('typeEditId').value;
  saveModeChannels();
  const modes = typeModes.map(m => {
    const channels = (m.channels || []).map((ch, i) => {
      const clean = { ...ch, channel_number: i + 1 };
      delete clean._rangesOpen; delete clean.id; delete clean.fixture_type_id; delete clean.mode_id;
      if (clean.ranges && clean.ranges.length === 0) clean.ranges = null;
      return clean;
    });
    return { name: m.name || 'Default', short_name: m.short_name || '', channels };
  });
  const body = { name: document.getElementById('tName').value.trim(), manufacturer: document.getElementById('tManufacturer').value.trim(), category: document.getElementById('tCategory').value, modes };
  if (!body.name) return showError('typeError', 'Name is required');
  if (modes.every(m => m.channels.length === 0)) return showError('typeError', 'Add at least one channel to at least one mode');
  const url = editId ? `/api/fixture-types/${editId}` : '/api/fixture-types';
  const method = editId ? 'PUT' : 'POST';
  const res = await fetch(url, { method, headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const data = await res.json();
  if (data.error) return showError('typeError', data.error);
  const savedId = editId || data.id;
  const hasColorWheel = modes.some(m => m.channels.some(ch => ch.type === 'color_wheel'));
  if (savedId && hasColorWheel && cwColors.length > 0) {
    const sorted = cwColors.map((c, i) => ({ dmx_start: c.dmx_start, dmx_end: c.dmx_end, color_hex: c.color_hex, label: c.label, sort_order: i + 1 }));
    await fetch(`/api/fixture-types/${savedId}/color-wheel`, { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ colors: sorted }) });
  } else if (savedId && !hasColorWheel) {
    await fetch(`/api/fixture-types/${savedId}/color-wheel`, { method: 'DELETE' });
  }
  closeModal('typeModal');
  loadTypes();
});

function updateDuplicateHint() {
  const count = Math.max(1, +document.getElementById('tDuplicateCount').value || 1);
  const base = typeChannels.length;
  const hint = document.getElementById('tDuplicateHint');
  if (base === 0) { hint.textContent = 'Add channels first, then duplicate the pattern.'; hint.style.color = 'var(--text-dim)'; }
  else if (count <= 1) { hint.textContent = `${base} channels \u2014 set repeat > 1 to duplicate.`; hint.style.color = 'var(--text-dim)'; }
  else {
    const total = base * count;
    hint.textContent = `${base} channels \u00D7 ${count} = ${total} total channels`;
    if (total > 512) { hint.style.color = 'var(--danger)'; hint.textContent += ' \u26A0 exceeds 512'; }
    else hint.style.color = 'var(--text-dim)';
  }
}
document.getElementById('tDuplicateCount').addEventListener('input', updateDuplicateHint);

document.getElementById('btnDuplicateChannels').addEventListener('click', () => {
  const count = Math.max(1, +document.getElementById('tDuplicateCount').value || 1);
  if (typeChannels.length === 0) return showError('typeError', 'Add at least one channel first');
  if (count <= 1) return showError('typeError', 'Set repeat to more than 1');
  const cat = document.getElementById('tCategory').value;
  const assignCells = (cat === 'multi_cell' || cat === 'led_bar');
  const pattern = typeChannels.map(ch => ({ name: ch.name, type: ch.type, default_value: ch.default_value, min_value: ch.min_value, max_value: ch.max_value, ranges: ch.ranges || null }));
  typeChannels.forEach((ch, i) => { ch.name = `${pattern[i].name} 1`; if (assignCells) ch.cell = 1; });
  for (let g = 2; g <= count; g++) {
    for (const tpl of pattern) {
      typeChannels.push({ channel_number: 0, name: `${tpl.name} ${g}`, type: tpl.type, default_value: 0, min_value: tpl.min_value || 0, max_value: tpl.max_value || 255, ranges: tpl.ranges ? JSON.parse(JSON.stringify(tpl.ranges)) : null, cell: assignCells ? g : null });
    }
  }
  typeChannels.forEach((ch, i) => { ch.channel_number = i + 1; ch.default_value = i + 1; });
  renderChannelsEditor(); updateDuplicateHint(); saveModeChannels(); renderModeTabs();
  document.getElementById('tDuplicateCount').value = '1';
  document.getElementById('typeError').textContent = '';
});

// ═══════════════════════════════════════════════════════════════
//  Boot
// ═══════════════════════════════════════════════════════════════
checkAuthStatus().then(() => {
  loadConfigPage();
  connect();
}).catch(e => {
  console.error('Boot error:', e);
  // Still try to load the visible tab even if auth check failed
  loadActiveTabData();
  connect();
});
