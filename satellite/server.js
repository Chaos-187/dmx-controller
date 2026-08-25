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
const brand = require(path.join(ROOT, 'thaluxis-brand'));
const crypto = require('crypto');
const os = require('os');

const DEVICE_ID_PATH = path.join(DATA_DIR, 'device.json');

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
    hub_url: process.env.DMX_HUB_URL || file.hub_url || '',
    satellite_token: process.env.DMX_SATELLITE_TOKEN || file.satellite_token || '',
    satellite_name: process.env.DMX_SATELLITE_NAME || file.satellite_name || `${brand.SATELLITE_DEFAULT_NAME} (${os.hostname()})`,
    web_port: parseInt(process.env.DMX_SATELLITE_WEB_PORT || file.web_port || '8788', 10),
    os2l_port: parseInt(process.env.DMX_SATELLITE_OS2L_PORT || file.os2l_port || '8787', 10),
    auto_analyze: file.auto_analyze !== false,
    vdj_db_path: process.env.DMX_VDJ_DB_PATH || file.vdj_db_path || '',
    ping_interval_ms: parseInt(file.ping_interval_ms || '10000', 10),
    pair_interval_ms: parseInt(file.pair_interval_ms || '3000', 10),
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
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({
    hub_url: config.hub_url,
    satellite_token: config.satellite_token,
    satellite_name: config.satellite_name,
    web_port: config.web_port,
    os2l_port: config.os2l_port,
    auto_analyze: config.auto_analyze,
    vdj_db_path: config.vdj_db_path,
    ping_interval_ms: config.ping_interval_ms,
    pair_interval_ms: config.pair_interval_ms,
  }, null, 2));
}

function rebuildHubClient() {
  hub = new HubClient({
    baseUrl: config.hub_url,
    token: config.satellite_token,
    name: config.satellite_name,
    deviceId: config.device_id,
  });
}

let config = loadConfig();
config.device_id = loadOrCreateDeviceId();
let hub;
rebuildHubClient();

const pairState = {
  status: config.satellite_token ? 'approved' : 'unpaired',
  last_request_at: null,
  message: '',
};

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
        console.log(`[Satellite] Pushed analysis to hub for track ${hubTrackId}`);
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
  if (!config.hub_url) return;
  if (!config.satellite_token && pairState.status !== 'approved') return;

  const res = await hub.syncTrack(localTrack);
  if (!res.ok) {
    state.hub_connected = false;
    state.hub_last_error = res.data?.error || 'Sync failed';
    console.warn(`[Satellite] Hub track sync failed: ${state.hub_last_error}`);
    return;
  }

  state.hub_connected = true;
  state.hub_last_error = null;
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
  if (config.satellite_token || pairState.status === 'approved') {
    hub.forwardOs2l(data).then((res) => {
      if (res.ok) state.stats.os2l_forwarded++;
      else state.hub_last_error = res.data?.error;
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
  res.json({
    role: 'thaluxis_satellite',
    product: brand.SATELLITE_DEFAULT_NAME,
    name: config.satellite_name,
    device_id: config.device_id,
    hub_url: config.hub_url,
    hub_connected: hub.connected,
    hub_last_error: state.hub_last_error || hub.lastError,
    pair_status: pairState.status,
    pair_message: pairState.message,
    vdj_connected: state.connected,
    auto_analyze: config.auto_analyze,
    stats: state.stats,
    decks: state.decks,
    analysis_version: audioAnalyzer.ANALYSIS_VERSION,
  });
});

app.get('/api/config', (req, res) => {
  res.json({
    ...config,
    satellite_token: config.satellite_token ? '••••••••' : '',
  });
});

app.put('/api/config', (req, res) => {
  const next = { ...config, ...req.body };
  if (req.body.satellite_token === '••••••••' || req.body.satellite_token === '') {
    next.satellite_token = config.satellite_token;
  }
  config = next;
  saveConfigFile();
  rebuildHubClient();

  res.json({ ok: true });
});

app.post('/api/hub/ping', async (req, res) => {
  const result = await hub.ping();
  state.hub_connected = result.ok;
  state.hub_last_error = result.ok ? null : result.data?.error;
  res.json({ ok: result.ok, hub: result.data, error: state.hub_last_error });
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
  if (!config.hub_url) return res.status(400).json({ error: 'Hub URL not configured' });

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

async function discoverHubUrl() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (url) => {
      if (resolved) return;
      resolved = true;
      resolve(url || null);
    };

    try {
      const b = new Bonjour();
      const browser = b.find({ type: 'dmx-hub' }, (service) => {
        const nets = service.addresses || [];
        const ip = nets.find(a => a.includes('.') && !a.startsWith('127.')) || nets[0] || service.host;
        const port = service.port || 80;
        if (ip) {
          b.destroy();
          finish(`http://${ip}${port !== 80 ? ':' + port : ''}`);
        }
      });
      setTimeout(() => { try { b.destroy(); } catch { /* ignore */ } finish(null); }, 4000);
    } catch {
      finish(null);
    }
  });
}

async function ensureHubUrl() {
  if (config.hub_url) return config.hub_url;
  const found = await discoverHubUrl();
  if (found) {
    config.hub_url = found;
    saveConfigFile();
    rebuildHubClient();
    console.log(`[Satellite] Discovered hub at ${found}`);
    pairState.message = `Discovered hub at ${found}`;
  }
  return config.hub_url;
}

async function runPairingLoop() {
  await ensureHubUrl();

  if (!config.hub_url) {
    pairState.status = 'no_hub';
    pairState.message = 'No hub found on LAN — set hub URL manually';
    setTimeout(runPairingLoop, config.pair_interval_ms);
    return;
  }

  if (config.satellite_token) {
    pairState.status = 'approved';
    pairState.message = 'Connected to hub';
    return;
  }

  const ip = getLocalIp();
  const req = await hub.requestPairing({
    deviceId: config.device_id,
    ip,
    webPort: config.web_port,
    os2lPort: config.os2l_port,
  });

  if (req.ok) {
    pairState.status = req.data.status || 'pending';
    pairState.last_request_at = Date.now();
    pairState.message = req.data.status === 'approved'
      ? 'Already approved on hub'
      : 'Waiting for approval on hub (Config → Thaluxis Satellites)';

    if (req.data.status === 'approved') {
      const st = await hub.pairStatus(config.device_id);
      if (st.ok && st.data.token) {
        config.satellite_token = st.data.token;
        saveConfigFile();
        rebuildHubClient();
        pairState.status = 'approved';
        pairState.message = 'Approved — connected to hub';
        console.log('[Satellite] Paired with hub');
        return;
      }
    }
  } else {
    pairState.status = 'error';
    pairState.message = req.data?.error || 'Pairing request failed';
  }

  const poll = await hub.pairStatus(config.device_id);
  if (poll.ok && poll.data.status === 'approved' && poll.data.token) {
    config.satellite_token = poll.data.token;
    saveConfigFile();
    rebuildHubClient();
    pairState.status = 'approved';
    pairState.message = 'Approved — connected to hub';
    console.log('[Satellite] Paired with hub');
    broadcast({ type: 'paired', hub_url: config.hub_url });
    return;
  }

  if (poll.ok && poll.data.status === 'rejected') {
    pairState.status = 'rejected';
    pairState.message = 'Connection rejected on hub';
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
  if (config.satellite_token && config.hub_url) {
    const res = await hub.ping();
    state.hub_connected = res.ok;
    state.hub_last_error = res.ok ? null : res.data?.error;
    broadcast({ type: 'hub_status', connected: res.ok, error: state.hub_last_error });
  }
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
if (!config.hub_url) {
  console.log('[Satellite] Hub URL not set — open the status UI to configure');
} else {
  console.log(`[Satellite] Hub target: ${config.hub_url}`);
}

process.on('SIGINT', () => {
  os2l.stopServer();
  httpServer.close();
  process.exit(0);
});
