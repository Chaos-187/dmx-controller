/**
 * Thaluxis Satellite
 *
 * Lightweight node for the VirtualDJ laptop. Connects to VirtualDJ via OS2L,
 * analyzes tracks locally, and syncs metadata + analysis to the Thaluxis Hub.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');
const Bonjour = require('bonjour-service').Bonjour;

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(__dirname, 'config.json');

process.env.DMX_DB_PATH = path.join(DATA_DIR, 'satellite.db');

const db = require(path.join(ROOT, 'db'));
const os2l = require(path.join(ROOT, 'os2l'));
const audioAnalyzer = require(path.join(ROOT, 'audio-analyzer'));
const vdjParser = require(path.join(ROOT, 'vdj-parser'));
const HubClient = require('./lib/hub-client');
const { HubRegistry, normalizeUrl } = require('./lib/hub-registry');
const brand = require(path.join(ROOT, 'thaluxis-brand'));
const crypto = require('crypto');
const os = require('os');

const DEVICE_ID_PATH = path.join(DATA_DIR, 'device.json');
const HUBS_PATH = path.join(DATA_DIR, 'hubs.json');

// ─── Config ─────────────────────────────────────────────────────────────────

function loadConfig() {
  let file = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } catch (e) {
      console.warn(`[Satellite] Invalid config.json: ${e.message}`);
    }
  }

  return {
    satellite_name: process.env.DMX_SATELLITE_NAME || file.satellite_name || `${brand.SATELLITE_DEFAULT_NAME} (${os.hostname()})`,
    web_port: parseInt(process.env.DMX_SATELLITE_WEB_PORT || file.web_port || '8788', 10),
    os2l_port: parseInt(process.env.DMX_SATELLITE_OS2L_PORT || file.os2l_port || '8787', 10),
    auto_analyze: file.auto_analyze !== false,
    vdj_db_path: process.env.DMX_VDJ_DB_PATH || file.vdj_db_path || '',
    ping_interval_ms: parseInt(file.ping_interval_ms || '10000', 10),
    pair_interval_ms: parseInt(file.pair_interval_ms || '3000', 10),
    // Legacy — migrated into hubs.json on first run
    hub_url: process.env.DMX_HUB_URL || file.hub_url || '',
    satellite_token: process.env.DMX_SATELLITE_TOKEN || file.satellite_token || '',
  };
}

function loadOrCreateDeviceId() {
  if (fs.existsSync(DEVICE_ID_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DEVICE_ID_PATH, 'utf8'));
      if (data.device_id) return data.device_id;
    } catch { /* regenerate */ }
  }
  const device_id = crypto.randomUUID();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DEVICE_ID_PATH, JSON.stringify({ device_id }, null, 2));
  return device_id;
}

function saveConfigFile() {
  const legacy = hubRegistry.getLegacyConfigFields();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    hub_url: legacy.hub_url,
    satellite_token: legacy.satellite_token,
    satellite_name: config.satellite_name,
    web_port: config.web_port,
    os2l_port: config.os2l_port,
    auto_analyze: config.auto_analyze,
    vdj_db_path: config.vdj_db_path,
    ping_interval_ms: config.ping_interval_ms,
    pair_interval_ms: config.pair_interval_ms,
  }, null, 2));
}

function getActiveHubEntry() {
  return hubRegistry.getActive();
}

function rebuildHubClient() {
  const active = getActiveHubEntry();
  hub = new HubClient({
    baseUrl: active?.hub_url || '',
    token: active?.token || '',
    name: config.satellite_name,
    deviceId: config.device_id,
  });
}

function applyEnvHubOverrides() {
  const envUrl = process.env.DMX_HUB_URL;
  const envToken = process.env.DMX_SATELLITE_TOKEN;
  if (!envUrl && !envToken) return;

  let active = getActiveHubEntry();
  if (!active && envUrl) {
    active = hubRegistry.add({ hub_url: envUrl, name: 'Environment hub' });
    hubRegistry.setActive(active.id);
  }
  if (!active) return;

  if (envUrl) hubRegistry.update(active.id, { hub_url: envUrl });
  if (envToken) hubRegistry.setPairStatus(active.id, 'approved', envToken);
  rebuildHubClient();
  saveConfigFile();
}

let config = loadConfig();
config.device_id = loadOrCreateDeviceId();

let hubRegistry = new HubRegistry({
  dataPath: HUBS_PATH,
  legacyConfig: { hub_url: config.hub_url, satellite_token: config.satellite_token },
});
applyEnvHubOverrides();

let hub;
rebuildHubClient();

const pairMessages = new Map(); // hub id → message

const hubConnection = {
  activeWasConnected: false,
  lastDiscoveryAt: 0,
  pendingSyncs: new Map(), // filepath → { localTrack, filePath, deckNum }
};

const RECONNECT_SCAN_MS = 15000;

function isNetworkError(message) {
  return /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ECONNRESET|EPIPE|socket hang up|timed out/i.test(message || '');
}

function queuePendingSync(localTrack, filePath, deckNum) {
  if (!filePath) return;
  hubConnection.pendingSyncs.set(filePath, { localTrack, filePath, deckNum });
}

async function flushPendingSyncs() {
  const pending = [...hubConnection.pendingSyncs.values()];
  hubConnection.pendingSyncs.clear();

  for (const item of pending) {
    await syncTrackToHub(item.localTrack, item.filePath, item.deckNum);
  }

  for (let deck = 1; deck <= 4; deck++) {
    const deckState = state.decks[deck];
    if (!deckState?.filepath) continue;
    const localTrack = db.getTrackByPath(deckState.filepath);
    if (localTrack) await syncTrackToHub(localTrack, deckState.filepath, deck);
  }
}

async function tryRediscoverActiveHub() {
  const active = getActiveHubEntry();
  if (!active) return false;

  const now = Date.now();
  if (now - hubConnection.lastDiscoveryAt < RECONNECT_SCAN_MS) return false;
  hubConnection.lastDiscoveryAt = now;

  console.log(`[Satellite] Hub unreachable at ${active.hub_url} — scanning LAN…`);
  const found = await discoverHubs();
  if (!found.length) {
    console.log('[Satellite] No hubs found on LAN — will retry');
    return false;
  }

  for (const item of found) {
    const client = new HubClient({
      baseUrl: item.hub_url,
      token: active.token,
      name: config.satellite_name,
      deviceId: config.device_id,
    });
    const res = await client.ping();
    if (!res.ok) continue;

    const known = hubRegistry.findByUrl(item.hub_url);
    if (known && known.id !== active.id) continue;

    if (item.hub_url !== active.hub_url) {
      console.log(`[Satellite] Hub found at ${item.hub_url} (was ${active.hub_url})`);
      hubRegistry.update(active.id, { hub_url: item.hub_url, name: item.name || active.name });
      rebuildHubClient();
      saveConfigFile();
    }
    return true;
  }

  console.log('[Satellite] Discovered hub(s) on LAN but none responded — will retry');
  return false;
}

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  decks: {},
  connected: false,
  vdjAddress: null,
  hub_connected: false,
  hub_last_error: null,
  stats: {
    tracks_synced: 0,
    analyses_pushed: 0,
    os2l_forwarded: 0,
    analyze_errors: 0,
  },
};

for (let d = 1; d <= 4; d++) {
  state.decks[d] = {
    filepath: '', filename: '', genre: '', bpm: 0, beatpos: 0,
    firstbeat: 0, time: 0, play: 0, loop: 0, track_id: null,
  };
}

const analysisInProgress = new Set();
const hubTrackIds = new Map(); // local filepath → hub track_id
const wsClients = new Set();

function broadcast(msg) {
  const raw = JSON.stringify(msg);
  for (const ws of wsClients) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

function noop() {}

// ─── Analysis helpers ───────────────────────────────────────────────────────

function getAnalysisConfig() {
  return {
    TARGET_PEAKS: parseInt(db.getConfig('analysis_target_peaks') || '2000', 10),
    DECODE_SAMPLE_RATE: parseInt(db.getConfig('analysis_sample_rate') || '22050', 10),
    SECTION_SENSITIVITY: parseFloat(db.getConfig('analysis_section_sensitivity') || '1.2'),
    NORMALIZE_PERCENTILE: parseInt(db.getConfig('analysis_normalize_pct') || '99', 10),
  };
}

function getAnchorPoints(track) {
  try {
    const pois = JSON.parse(track.poi_json || '[]');
    return pois
      .filter(p => p.type === 'beatgrid' && p.pos)
      .map(p => ({
        pos_ms: parseFloat(p.pos) * 1000,
        bpm: p.bpm > 0 ? parseFloat(p.bpm) : undefined,
      }))
      .filter(p => !isNaN(p.pos_ms))
      .sort((a, b) => a.pos_ms - b.pos_ms);
  } catch {
    return [];
  }
}

function trackFromDeck(deckNum) {
  const deck = state.decks[deckNum];
  if (!deck?.filepath) return null;
  return db.getTrackByPath(deck.filepath);
}

function ensureLocalTrack(filepath, deckNum) {
  let track = db.getTrackByPath(filepath);
  if (track) return track;

  const deck = state.decks[deckNum] || {};
  const parts = filepath.replace(/\\\\/g, '\\').split('\\');
  const filename = parts[parts.length - 1] || filepath;
  const stub = {
    filepath,
    filename,
    file_size: 0,
    flag: 0,
    author: '',
    title: filename.replace(/\.[^.]+$/, ''),
    remix: '',
    genre: deck.genre || '',
    album: '',
    year: '',
    tag_flag: 0,
    song_length: 0,
    bitrate: 0,
    last_modified: 0,
    first_seen: 0,
    cover: '',
    bpm: deck.bpm || 0,
    key: '',
    volume: 0,
    audio_sig: '',
    beatgrid_pos: 0,
    automix_point: 0,
    poi_json: '[]',
    netsearch: '',
    source_type: 'local',
  };

  db.importTracks([stub]);
  return db.getTrackByPath(filepath);
}

async function analyzeAndPush(localTrack, filePath, deckNum) {
  if (!config.auto_analyze || !localTrack) return;
  if (analysisInProgress.has(localTrack.id)) return;

  const resolvedPath = filePath || localTrack.filepath;
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    console.warn(`[Satellite] Audio not found for analysis: ${resolvedPath}`);
    return;
  }

  analysisInProgress.add(localTrack.id);
  broadcast({ type: 'analysis_started', track_id: localTrack.id, filepath: resolvedPath });

  try {
    const ffmpegOk = await audioAnalyzer.checkFfmpeg();
    if (!ffmpegOk) throw new Error('ffmpeg not found');

    const deck = state.decks[deckNum] || {};
    let beatgridPos = localTrack.beatgrid_pos || 0;
    if (!beatgridPos && deck.firstbeat > 0) {
      beatgridPos = deck.firstbeat > 60 ? deck.firstbeat / 1000 : deck.firstbeat;
    }

    console.log(`[Satellite] Analyzing "${localTrack.title || localTrack.filename}"...`);
    const result = await audioAnalyzer.analyzeTrack(resolvedPath, {
      bpm: localTrack.bpm || deck.bpm || 0,
      beatgridPos,
      anchorPoints: getAnchorPoints(localTrack),
      config: getAnalysisConfig(),
    });

    db.upsertTrackAnalysis(localTrack.id, result);

    const hubTrackId = hubTrackIds.get(resolvedPath) || hubTrackIds.get(localTrack.filepath);
    if (hubTrackId) {
      const push = await hub.pushAnalysis(hubTrackId, result);
      if (push.ok) {
        state.stats.analyses_pushed++;
        const seqNote = push.data?.sequence_generated
          ? `, sequence generated (${push.data.cue_count || '?'} cues)`
          : (push.data?.has_sequence ? ', sequence already on hub' : '');
        console.log(`[Satellite] Pushed analysis to hub for track ${hubTrackId}${seqNote}`);
      } else {
        state.stats.analyze_errors++;
        console.warn(`[Satellite] Hub analysis push failed: ${push.data?.error}`);
      }
    }

    broadcast({
      type: 'analysis_complete',
      track_id: localTrack.id,
      peak_count: result.peak_count,
      section_count: (result.sections || []).length,
    });
  } catch (e) {
    state.stats.analyze_errors++;
    console.error(`[Satellite] Analysis failed: ${e.message}`);
    broadcast({ type: 'analysis_error', track_id: localTrack.id, error: e.message });
  } finally {
    analysisInProgress.delete(localTrack.id);
  }
}

async function syncTrackToHub(localTrack, filePath, deckNum) {
  const active = getActiveHubEntry();
  if (!active?.hub_url) return;
  if (!active.token && active.pair_status !== 'approved') return;

  const res = await hub.syncTrack(localTrack);
  if (!res.ok) {
    state.hub_connected = false;
    state.hub_last_error = res.data?.error || 'Sync failed';
    hubRegistry.setRuntime(active.id, { connected: false, last_error: state.hub_last_error });
    if (isNetworkError(state.hub_last_error)) {
      queuePendingSync(localTrack, filePath, deckNum);
    }
    console.warn(`[Satellite] Hub track sync failed: ${state.hub_last_error}`);
    return;
  }

  state.hub_connected = true;
  state.hub_last_error = null;
  hubRegistry.setRuntime(active.id, { connected: true, last_error: null, last_seen_at: Date.now() });
  state.stats.tracks_synced++;

  const hubTrackId = res.data.track_id;
  hubTrackIds.set(filePath, hubTrackId);
  hubTrackIds.set(localTrack.filepath, hubTrackId);
  if (state.decks[deckNum]) state.decks[deckNum].track_id = hubTrackId;

  if (res.data.needs_analysis) {
    await analyzeAndPush(localTrack, filePath, deckNum);
  }
}

// ─── OS2L handler ───────────────────────────────────────────────────────────

function handleOs2lSubscribed(data) {
  const active = getActiveHubEntry();
  if (active?.token || active?.pair_status === 'approved') {
    hub.forwardOs2l(data).then((res) => {
      if (res.ok) {
        state.stats.os2l_forwarded++;
        if (!state.hub_connected) {
          state.hub_connected = true;
          state.hub_last_error = null;
        }
      } else {
        state.hub_last_error = res.data?.error;
        if (isNetworkError(state.hub_last_error)) {
          state.hub_connected = false;
        }
      }
    });
  }

  const trigger = data.trigger;
  const value = data.value;
  if (!trigger) return;

  const { deck, key } = os2l.parseTrigger(trigger);
  if (deck === null || !state.decks[deck]) return;

  if (typeof value === 'string') {
    if (value === 'on') state.decks[deck][key] = 1;
    else if (value === 'off') state.decks[deck][key] = 0;
    else state.decks[deck][key] = value;
  } else {
    state.decks[deck][key] = value;
  }

  if (key === 'filepath' && typeof value === 'string' && value) {
    const parts = value.replace(/\\\\/g, '\\').split('\\');
    state.decks[deck].filename = parts[parts.length - 1] || value;

    const localTrack = ensureLocalTrack(value, deck);
    state.decks[deck].track_id = localTrack?.id || null;
    syncTrackToHub(localTrack, value, deck);
  }

  broadcast({ type: 'deck_update', deck, key, value, state: state.decks[deck] });
}

function handleOs2lButton(data) {
  hub.forwardOs2l({ evt: 'btn', ...data });
}

// ─── HTTP API ─────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/status', (req, res) => {
  const active = getActiveHubEntry();
  const activePublic = active ? hubRegistry._publicHub(active) : null;
  res.json({
    role: 'thaluxis_satellite',
    product: brand.SATELLITE_DEFAULT_NAME,
    name: config.satellite_name,
    device_id: config.device_id,
    active_hub: activePublic,
    hubs: hubRegistry.getAll(),
    hub_url: active?.hub_url || '',
    hub_connected: state.hub_connected,
    hub_last_error: state.hub_last_error || hub.lastError,
    pair_status: activePublic?.pair_status || 'unpaired',
    pair_message: active ? (pairMessages.get(active.id) || '') : '',
    vdj_connected: state.connected,
    auto_analyze: config.auto_analyze,
    stats: state.stats,
    decks: state.decks,
    analysis_version: audioAnalyzer.ANALYSIS_VERSION,
  });
});

app.get('/api/hubs', (req, res) => {
  res.json({ hubs: hubRegistry.getAll(), active_hub_id: hubRegistry.activeHubId });
});

app.post('/api/hubs', (req, res) => {
  try {
    const { hub_url, name } = req.body || {};
    const hubEntry = hubRegistry.add({ hub_url, name });
    saveConfigFile();
    rebuildHubClient();
    pairHubEntry(hubEntry);
    res.json({ ok: true, hub: hubRegistry._publicHub(hubEntry) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/hubs/discover', async (req, res) => {
  const found = await discoverHubs();
  res.json({ hubs: found });
});

app.put('/api/hubs/:id', (req, res) => {
  try {
    const hubEntry = hubRegistry.update(req.params.id, req.body || {});
    if (hubEntry.id === hubRegistry.activeHubId) {
      rebuildHubClient();
      saveConfigFile();
    }
    res.json({ ok: true, hub: hubRegistry._publicHub(hubEntry) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/hubs/:id', (req, res) => {
  try {
    const wasActive = hubRegistry.activeHubId === req.params.id;
    hubRegistry.remove(req.params.id);
    pairMessages.delete(req.params.id);
    if (wasActive) {
      hubTrackIds.clear();
      rebuildHubClient();
      saveConfigFile();
    }
    res.json({ ok: true, hubs: hubRegistry.getAll() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/hubs/:id/activate', (req, res) => {
  try {
    const hubEntry = hubRegistry.setActive(req.params.id);
    hubTrackIds.clear();
    rebuildHubClient();
    saveConfigFile();
    state.hub_connected = false;
    state.hub_last_error = null;
    pairHubEntry(hubEntry);
    pingHubEntry(hubEntry);
    res.json({ ok: true, hub: hubRegistry._publicHub(hubEntry), hubs: hubRegistry.getAll() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/hubs/:id/ping', async (req, res) => {
  const hubEntry = hubRegistry.getById(req.params.id);
  if (!hubEntry) return res.status(404).json({ error: 'Hub not found' });
  const result = await pingHubEntry(hubEntry);
  res.json({
    ok: result.ok,
    hub: hubRegistry._publicHub(hubEntry),
    error: result.ok ? null : result.data?.error,
  });
});

app.get('/api/config', (req, res) => {
  const legacy = hubRegistry.getLegacyConfigFields();
  res.json({
    ...config,
    hub_url: legacy.hub_url,
    satellite_token: legacy.satellite_token ? '••••••••' : '',
    active_hub_id: hubRegistry.activeHubId,
    hubs: hubRegistry.getAll(),
  });
});

app.put('/api/config', (req, res) => {
  const next = { ...config, ...req.body };
  delete next.hub_url;
  delete next.satellite_token;
  delete next.hubs;
  delete next.active_hub_id;
  config = next;
  saveConfigFile();
  rebuildHubClient();
  res.json({ ok: true });
});

app.post('/api/hub/ping', async (req, res) => {
  const active = getActiveHubEntry();
  if (!active) return res.status(400).json({ error: 'No active hub configured' });
  const result = await pingHubEntry(active);
  state.hub_connected = result.ok;
  state.hub_last_error = result.ok ? null : result.data?.error;
  res.json({ ok: result.ok, hub: hubRegistry._publicHub(active), error: state.hub_last_error });
});

app.post('/api/tracks/import', (req, res) => {
  try {
    let xmlPath = config.vdj_db_path || db.getConfig('vdj_db_path');
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (!xmlPath) return res.status(400).json({ error: 'VDJ database not found' });

    const tracks = vdjParser.parseVdjDatabase(xmlPath);
    const result = db.importTracks(tracks);
    config.vdj_db_path = xmlPath;
    res.json({ ...result, path: xmlPath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/library/sync-to-hub', async (req, res) => {
  const active = getActiveHubEntry();
  if (!active?.hub_url) return res.status(400).json({ error: 'No active hub configured' });

  const limit = Math.min(parseInt(req.body?.limit || '500', 10), 5000);
  const all = db.getTracks({ limit });
  const tracks = all.filter((t) => {
    const an = db.getTrackAnalysis(t.id);
    return !an || (an.analysis_version || 0) < audioAnalyzer.ANALYSIS_VERSION;
  }).slice(0, limit);

  res.json({ status: 'started', count: tracks.length });

  (async () => {
    for (const track of tracks) {
      await syncTrackToHub(track, track.filepath, 0);
    }
    console.log(`[Satellite] Library sync batch complete (${tracks.length} tracks)`);
    broadcast({ type: 'library_sync_complete', count: tracks.length });
  })();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Startup ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

db.init();

os2l.init({
  db,
  broadcast,
  state,
  artnetServer: { setChannels: noop },
  dmxUsbServer: { setChannels: noop },
  touchOverrides: {
    smokeOverrideFixtures: new Set(),
    colorOverrideFixtures: new Set(),
    os2lOverrideFixtures: new Set(),
    movementOverrideFixtures: new Set(),
    atmosphereOverrideFixtures: new Set(),
  },
  runningQaEffects: {},
  getDmxOutputEnabled: () => false,
  getEffectSlot: () => null,
  stopRunningEffect: noop,
  activateScene: noop,
  deactivateScene: noop,
  buildChannelCtx: () => ({}),
  computeEffectValue: () => 0,
  isFixtureCompatibleWithEffect: () => false,
  applyMasterDimmer: (v) => v,
  applyInvert: (v) => v,
  isAnySequencePlaying: () => false,
  onMessage: handleOs2lSubscribed,
  onButton: handleOs2lButton,
});

const httpServer = http.createServer(app);
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: 'status', ...state, hub_connected: hub.connected }));
  ws.on('close', () => wsClients.delete(ws));
});

httpServer.listen(config.web_port, () => {
  console.log(`[Satellite] Status UI at http://localhost:${config.web_port}`);
});

os2l.startServer(config.os2l_port);

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

async function discoverHubs() {
  return new Promise((resolve) => {
    const found = [];
    const seen = new Set();

    const finish = () => {
      resolve(found);
    };

    try {
      const b = new Bonjour();
      const browser = b.find({ type: 'dmx-hub' }, (service) => {
        const nets = service.addresses || [];
        const ip = nets.find(a => a.includes('.') && !a.startsWith('127.')) || nets[0] || service.host;
        const port = service.port || 80;
        if (!ip) return;
        const url = normalizeUrl(`http://${ip}${port !== 80 ? ':' + port : ''}`);
        const key = url.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        found.push({
          hub_url: url,
          name: service.name || service.txt?.name || 'Thaluxis Hub',
          bonjour_name: service.name,
        });
      });
      setTimeout(() => {
        try { b.destroy(); } catch { /* ignore */ }
        finish();
      }, 4000);
    } catch {
      finish();
    }
  });
}

function clientForHubEntry(hubEntry) {
  return new HubClient({
    baseUrl: hubEntry.hub_url,
    token: hubEntry.token || '',
    name: config.satellite_name,
    deviceId: config.device_id,
  });
}

async function pingHubEntry(hubEntry) {
  const client = hubEntry.id === hubRegistry.activeHubId
    ? hub
    : clientForHubEntry(hubEntry);
  const res = await client.ping();
  hubRegistry.setRuntime(hubEntry.id, {
    connected: res.ok,
    last_error: res.ok ? null : (res.data?.error || client.lastError),
    last_seen_at: res.ok ? Date.now() : null,
    hub_product_name: res.data?.name || hubEntry.hub_product_name,
  });
  if (res.ok && res.data?.name) {
    hubRegistry.setHubInfo(hubEntry.id, { hub_product_name: res.data.name });
  }
  if (hubEntry.id === hubRegistry.activeHubId) {
    state.hub_connected = res.ok;
    state.hub_last_error = res.ok ? null : (res.data?.error || client.lastError);
  }
  return res;
}

async function pairHubEntry(hubEntry) {
  if (!hubEntry?.hub_url) return;
  if (hubEntry.token && hubEntry.pair_status === 'approved') {
    pairMessages.set(hubEntry.id, 'Connected to hub');
    return;
  }

  const client = clientForHubEntry(hubEntry);
  const ip = getLocalIp();
  const req = await client.requestPairing({
    deviceId: config.device_id,
    ip,
    webPort: config.web_port,
    os2lPort: config.os2l_port,
  });

  if (req.ok) {
    const status = req.data.status || 'pending';
    hubRegistry.setPairStatus(hubEntry.id, status);
    pairMessages.set(hubEntry.id, status === 'approved'
      ? 'Already approved on hub'
      : 'Waiting for approval on hub (Config → Thaluxis Satellites)');

    if (status === 'approved') {
      const st = await client.pairStatus(config.device_id);
      if (st.ok && st.data.token) {
        hubRegistry.setPairStatus(hubEntry.id, 'approved', st.data.token);
        pairMessages.set(hubEntry.id, 'Approved — connected to hub');
        if (hubEntry.id === hubRegistry.activeHubId) {
          rebuildHubClient();
          saveConfigFile();
          broadcast({ type: 'paired', hub_id: hubEntry.id, hub_url: hubEntry.hub_url });
        }
        console.log(`[Satellite] Paired with hub ${hubEntry.hub_url}`);
        return;
      }
    }
  } else {
    const msg = req.data?.error || 'Pairing request failed';
    if (isNetworkError(msg)) {
      pairMessages.set(hubEntry.id, `Hub offline — retrying (${msg})`);
    } else {
      hubRegistry.setPairStatus(hubEntry.id, 'error');
      pairMessages.set(hubEntry.id, msg);
    }
    return;
  }

  const poll = await client.pairStatus(config.device_id);
  if (poll.ok && poll.data.status === 'approved' && poll.data.token) {
    hubRegistry.setPairStatus(hubEntry.id, 'approved', poll.data.token);
    pairMessages.set(hubEntry.id, 'Approved — connected to hub');
    if (hubEntry.id === hubRegistry.activeHubId) {
      rebuildHubClient();
      saveConfigFile();
      broadcast({ type: 'paired', hub_id: hubEntry.id, hub_url: hubEntry.hub_url });
    }
    console.log(`[Satellite] Paired with hub ${hubEntry.hub_url}`);
    return;
  }

  if (poll.ok && poll.data.status === 'rejected') {
    hubRegistry.setPairStatus(hubEntry.id, 'rejected');
    pairMessages.set(hubEntry.id, 'Connection rejected on hub');
  }
}

async function runPairingLoop() {
  let hubs = hubRegistry.hubs;

  if (hubs.length === 0) {
    const found = await discoverHubs();
    if (found.length) {
      for (const item of found) {
        const existing = hubRegistry.findByUrl(item.hub_url);
        if (!existing) {
          hubRegistry.add({ hub_url: item.hub_url, name: item.name });
          console.log(`[Satellite] Discovered hub at ${item.hub_url}`);
        }
      }
      saveConfigFile();
      rebuildHubClient();
      hubs = hubRegistry.hubs;
    }
  }

  if (hubs.length === 0) {
    setTimeout(runPairingLoop, config.pair_interval_ms);
    return;
  }

  for (const hubEntry of hubs) {
    if (!hubEntry.token || hubEntry.pair_status !== 'approved') {
      await pairHubEntry(hubEntry);
    } else if (!state.hub_connected && hubEntry.id === hubRegistry.activeHubId) {
      await pingHubEntry(hubEntry);
    }
  }

  setTimeout(runPairingLoop, config.pair_interval_ms);
}

try {
  const bonjour = new Bonjour();
  const bonjourName = brand.getSatelliteBonjourName(config.satellite_name);
  bonjour.publish({
    name: bonjourName,
    type: 'os2l',
    protocol: 'tcp',
    port: config.os2l_port,
    txt: { role: 'thaluxis_satellite', txtvers: '1', product: 'Thaluxis Satellite' },
  });
  bonjour.publish({
    name: bonjourName,
    type: 'dmx-satellite',
    protocol: 'tcp',
    port: config.web_port,
    txt: {
      txtvers: '1',
      device_id: config.device_id,
      name: config.satellite_name,
      web_port: String(config.web_port),
      os2l_port: String(config.os2l_port),
      product: 'Thaluxis Satellite',
    },
  });
  console.log(`[Thaluxis Satellite] mDNS: _os2l._tcp :${config.os2l_port}, _dmx-satellite._tcp :${config.web_port}`);
} catch (e) {
  console.warn(`[Thaluxis Satellite] mDNS registration failed: ${e.message}`);
}

async function hubPingLoop() {
  const active = getActiveHubEntry();
  let activeConnected = false;

  for (const hubEntry of hubRegistry.hubs) {
    const res = await pingHubEntry(hubEntry);
    if (hubEntry.id === hubRegistry.activeHubId) activeConnected = res.ok;
  }

  if (active && !activeConnected && isNetworkError(state.hub_last_error || hub.lastError)) {
    const relocated = await tryRediscoverActiveHub();
    if (relocated) {
      const retry = await pingHubEntry(getActiveHubEntry());
      activeConnected = retry.ok;
    }
  }

  if (active) {
    if (activeConnected && !hubConnection.activeWasConnected) {
      console.log(`[Satellite] Hub reconnected: ${active.hub_url}`);
      pairMessages.set(active.id, 'Connected to hub');
      await flushPendingSyncs();
    } else if (!activeConnected && hubConnection.activeWasConnected) {
      console.warn(`[Satellite] Hub offline: ${active.hub_url} (${state.hub_last_error || hub.lastError || 'unreachable'}) — retrying every ${config.ping_interval_ms / 1000}s`);
      pairMessages.set(active.id, `Hub offline — retrying (${state.hub_last_error || 'unreachable'})`);
    } else if (!activeConnected && !hubConnection.activeWasConnected) {
      pairMessages.set(active.id, `Hub offline — retrying (${state.hub_last_error || 'unreachable'})`);
    }
    hubConnection.activeWasConnected = activeConnected;
  }

  broadcast({
    type: 'hub_status',
    connected: state.hub_connected,
    error: state.hub_last_error,
    hubs: hubRegistry.getAll(),
  });
  setTimeout(hubPingLoop, config.ping_interval_ms);
}

runPairingLoop();
hubPingLoop();

// Optional VDJ import on startup
(function importVdjOnStartup() {
  try {
    let xmlPath = config.vdj_db_path;
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (xmlPath) {
      console.log(`[Satellite] Importing VDJ library from ${xmlPath}...`);
      const tracks = vdjParser.parseVdjDatabase(xmlPath);
      const result = db.importTracks(tracks);
      console.log(`[Satellite] VDJ import: ${result.total} tracks (${result.inserted} new)`);
    }
  } catch (e) {
    console.warn(`[Satellite] VDJ import skipped: ${e.message}`);
  }
})();

console.log(`[Satellite] OS2L listening on port ${config.os2l_port}`);
const activeAtStart = getActiveHubEntry();
if (!activeAtStart) {
  console.log('[Satellite] No hubs configured — open the status UI to add venues');
} else {
  console.log(`[Satellite] Active hub: ${activeAtStart.hub_url} (${hubRegistry.hubs.length} saved)`);
}

process.on('SIGINT', () => {
  os2l.stopServer();
  httpServer.close();
  process.exit(0);
});
