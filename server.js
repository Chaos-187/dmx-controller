/**
 * DMX Controller Server
 * 
 * - Advertises as an OS2L service via Bonjour/mDNS
 * - Accepts TCP connections from VirtualDJ
 * - Sends trigger subscriptions to get deck data
 * - Pushes real-time state to web clients via WebSocket
 * - Serves the web UI
 */

const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const Bonjour = require('bonjour-service').Bonjour;
const db = require('./db');
const ArtNetServer = require('./artnet-server');
const DmxUsbServer = require('./dmx-usb-server');
const { WebUSB } = require('usb');

// ─── Configuration ──────────────────────────────────────────────────────────

const OS2L_PORT = 8787;
const WEB_PORT = 3000;
const SERVICE_NAME = 'DMX-Controller';

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  decks: {},
  crossfader: 0,
  connected: false,
  vdjAddress: null,
};

for (let d = 1; d <= 4; d++) {
  state.decks[d] = {
    filepath: '',
    filename: '',
    soundswitch_id: '',
    genre: '',
    level: 0,
    time: 0,
    beatpos: 0,
    firstbeat: 0,
    bpm: 0,
    play: 0,
    loop: 0,
    get_loop: 0,
    loop_roll: 0,
  };
}

// ─── VDJ Subscription Builder ───────────────────────────────────────────────

let activeVdjSocket = null; // Track current VDJ TCP socket for re-subscribing

function buildSubscriptionMessage() {
  const subs = db.getEnabledSubscriptions();
  const triggers = subs.map(s => s.trigger);
  const freq = db.getConfig('subscription_frequency') || '25';
  return JSON.stringify({ evt: 'subscribe', trigger: triggers, frequency: freq });
}

function sendSubscription() {
  if (!activeVdjSocket || activeVdjSocket.destroyed) return;
  const msg = buildSubscriptionMessage();
  activeVdjSocket.write(msg);
  console.log(`[OS2L] Subscription sent (${msg.length} bytes, ${JSON.parse(msg).trigger.length} triggers)`);
}

// ─── Trigger Parser ─────────────────────────────────────────────────────────

function parseTrigger(trigger) {
  const m = trigger.match(/^deck (\d+) (.+)$/);
  if (!m) return { deck: null, key: trigger };

  const deck = parseInt(m[1]);
  const param = m[2];

  if (param.startsWith("get_text '%SOUNDSWITCH_ID'")) return { deck, key: 'soundswitch_id' };
  if (param === 'get_filepath') return { deck, key: 'filepath' };
  if (param === 'get_genre') return { deck, key: 'genre' };
  if (param === 'level') return { deck, key: 'level' };
  if (param === 'get_time elapsed absolute') return { deck, key: 'time' };
  if (param === 'get_beatpos') return { deck, key: 'beatpos' };
  if (param === 'get_firstbeat') return { deck, key: 'firstbeat' };
  if (param === 'get_bpm') return { deck, key: 'bpm' };
  if (param === 'play') return { deck, key: 'play' };
  if (param === 'loop') return { deck, key: 'loop' };
  if (param === 'get_loop') return { deck, key: 'get_loop' };
  if (param.includes('loop_roll')) return { deck, key: 'loop_roll' };

  return { deck, key: param };
}

// ─── WebSocket Broadcast ────────────────────────────────────────────────────

let wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  }
}

// Throttled state broadcast (send full state at ~30fps max)
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast({ type: 'state', state });
  }, 33); // ~30fps
}

// ─── OS2L Message Handler ───────────────────────────────────────────────────

function handleMessage(data) {
  // Broadcast every raw OS2L message for the event log
  broadcast({ type: 'log', ts: Date.now(), raw: data });

  const evt = data.evt;

  if (evt === 'subscribed') {
    const trigger = data.trigger;
    const value = data.value;

    if (!trigger) return;

    const { deck, key } = parseTrigger(trigger);

    if (key === 'crossfader') {
      state.crossfader = value;
      scheduleBroadcast();
      return;
    }

    if (deck === null || !state.decks[deck]) return;

    // Normalize "on"/"off" string values to 1/0 for play, loop, etc.
    if (typeof value === 'string') {
      if (value === 'on')  state.decks[deck][key] = 1;
      else if (value === 'off') state.decks[deck][key] = 0;
      else state.decks[deck][key] = value;
    } else {
      state.decks[deck][key] = value;
    }

    // Extract filename from filepath
    if (key === 'filepath' && typeof value === 'string' && value) {
      const parts = value.replace(/\\\\/g, '\\').split('\\');
      state.decks[deck].filename = parts[parts.length - 1] || value;
    }

    scheduleBroadcast();
  } else if (evt === 'beat') {
    broadcast({ type: 'beat', data });
  } else if (evt === 'btn') {
    broadcast({ type: 'btn', data });
  } else if (evt === 'cmd') {
    broadcast({ type: 'cmd', data });
  } else {
    broadcast({ type: 'event', evt, data });
  }
}

// ─── OS2L TCP Server ────────────────────────────────────────────────────────

const os2lServer = net.createServer((socket) => {
  const addr = `${socket.remoteAddress}:${socket.remotePort}`;
  console.log(`[OS2L] VirtualDJ connected from ${addr}`);

  state.connected = true;
  state.vdjAddress = addr;
  activeVdjSocket = socket;
  broadcast({ type: 'connection', connected: true, address: addr });

  // Send subscription from database
  sendSubscription();

  let buffer = '';

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf-8');

    // Process newline-delimited JSON
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.substring(0, idx).trim();
      buffer = buffer.substring(idx + 1);
      if (line) {
        try {
          handleMessage(JSON.parse(line));
        } catch (e) {
          // Try parsing as standalone JSON
        }
      }
    }

    // Try parsing remaining buffer as complete JSON
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer.trim());
        handleMessage(parsed);
        buffer = '';
      } catch (e) {
        // Incomplete, wait for more data
      }
    }
  });

  socket.on('close', () => {
    console.log(`[OS2L] VirtualDJ disconnected: ${addr}`);
    state.connected = false;
    state.vdjAddress = null;
    if (activeVdjSocket === socket) activeVdjSocket = null;
    broadcast({ type: 'connection', connected: false });
  });

  socket.on('error', (err) => {
    console.error(`[OS2L] Socket error: ${err.message}`);
  });
});

// ─── Express Web Server ─────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Fixture Type API ───────────────────────────────────────────────────────

app.get('/api/fixture-types', (req, res) => {
  res.json(db.getFixtureTypes());
});

app.get('/api/fixture-types/:id', (req, res) => {
  const t = db.getFixtureType(+req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/fixture-types', (req, res) => {
  try {
    const result = db.createFixtureType(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixture-types/:id', (req, res) => {
  const result = db.updateFixtureType(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/fixture-types/:id', (req, res) => {
  const result = db.deleteFixtureType(+req.params.id);
  if (result.error) return res.status(409).json(result);
  res.json(result);
});

// ─── Fixture API ────────────────────────────────────────────────────────────

app.get('/api/fixtures', (req, res) => {
  res.json(db.getFixtures());
});

app.get('/api/fixtures/:id', (req, res) => {
  const f = db.getFixture(+req.params.id);
  f ? res.json(f) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/fixtures', (req, res) => {
  try {
    const result = db.createFixture(req.body);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixtures/:id', (req, res) => {
  const result = db.updateFixture(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/fixtures/:id', (req, res) => {
  db.deleteFixture(+req.params.id);
  res.json({ deleted: true });
});

// ─── Universe Map API ───────────────────────────────────────────────────────

app.get('/api/universe/:num', (req, res) => {
  res.json(db.getUniverseMap(+req.params.num));
});

app.get('/api/fixture-channel-map', (req, res) => {
  res.json(db.getFixtureChannelMap());
});

// ─── Fixture Groups API ─────────────────────────────────────────────────────

app.get('/api/groups', (req, res) => {
  res.json(db.getGroups());
});

app.post('/api/groups', (req, res) => {
  const result = db.createGroup(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/groups/:id', (req, res) => {
  const result = db.updateGroup(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/groups/:id', (req, res) => {
  db.deleteGroup(+req.params.id);
  res.json({ deleted: true });
});

app.put('/api/groups/:id/fixtures', (req, res) => {
  const result = db.setGroupFixtures(+req.params.id, req.body.fixture_ids || []);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ─── Subscriptions API ──────────────────────────────────────────────────────

app.get('/api/subscriptions', (req, res) => {
  res.json(db.getSubscriptions());
});

app.post('/api/subscriptions', (req, res) => {
  const result = db.createSubscription(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/subscriptions/:id', (req, res) => {
  const result = db.updateSubscription(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/subscriptions/:id', (req, res) => {
  db.deleteSubscription(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/subscriptions/:id/toggle', (req, res) => {
  const result = db.toggleSubscription(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/subscriptions/resend', (req, res) => {
  sendSubscription();
  const subs = db.getEnabledSubscriptions();
  res.json({ sent: true, count: subs.length, connected: !!activeVdjSocket && !activeVdjSocket.destroyed });
});

// ─── Config API ─────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json(db.getAllConfig());
});

app.put('/api/config/:key', (req, res) => {
  db.setConfig(req.params.key, req.body.value);
  res.json({ key: req.params.key, value: req.body.value });
});

// ─── Known DMX USB Vendor/Product IDs ───────────────────────────────────────

const KNOWN_DMX_VENDORS = {
  0x0403: 'FTDI',
  0x15e4: 'SoundSwitch / Denon DJ',
  0x04d8: 'Microchip',
  0x10cf: 'Velleman',
  0x16c0: 'Teensy / V-USB',
  0x1209: 'Open-Source Hardware',
  0x0483: 'STMicroelectronics',
};

const KNOWN_DMX_PIDS = {
  '0403:6001': 'FT232R (Enttec Open DMX / DMXKING ultraDMX Micro)',
  '0403:6010': 'FT2232H (Dual)',
  '0403:6014': 'FT232H',
  '0403:6015': 'FT-X Series',
  '15e4:0053': 'SoundSwitch DMX Micro Interface',
  '15e4:0100': 'SoundSwitch DMX Interface',
  '04d8:000a': 'Microchip USB DMX',
  '04d8:fb56': 'DMXking ultraDMX2 PRO',
  '10cf:8062': 'Velleman VMB1USB',
};

/**
 * Scan for USB devices via libusb (WebUSB API).
 * Returns devices not already found by FTDI D2XX scan.
 */
async function scanUsbDevices(ftdiSerials) {
  try {
    const webusb = new WebUSB({ allowAllDevices: true });
    const rawDevices = await webusb.getDevices();
    const results = [];

    for (const d of rawDevices) {
      const vid = d.vendorId;
      const pid = d.productId;
      const vidHex = vid.toString(16).padStart(4, '0');
      const pidHex = pid.toString(16).padStart(4, '0');
      const key = `${vidHex}:${pidHex}`;

      // Skip FTDI devices already found by D2XX (avoid duplicates)
      if (vid === 0x0403 && d.serialNumber && ftdiSerials.has(d.serialNumber)) continue;

      const vendorLabel = KNOWN_DMX_VENDORS[vid] || d.manufacturerName || '';
      const pidLabel = KNOWN_DMX_PIDS[key] || '';
      const isDmxRelated = KNOWN_DMX_VENDORS.hasOwnProperty(vid) || KNOWN_DMX_PIDS.hasOwnProperty(key);

      results.push({
        source: 'usb',
        vid: `0x${vidHex}`,
        pid: `0x${pidHex}`,
        manufacturer: d.manufacturerName || vendorLabel,
        product: d.productName || pidLabel || 'Unknown Device',
        serial_number: d.serialNumber || '',
        vendorLabel,
        pidLabel,
        isDmxRelated,
      });
    }

    return results;
  } catch (e) {
    console.error('[USB] libusb scan failed:', e.message);
    return [];
  }
}

// ─── Device Scan API (FTDI D2XX + libusb) ───────────────────────────────────

app.get('/api/serial-ports', async (req, res) => {
  try {
    // 1. FTDI D2XX scan (via worker)
    const ftdiDevices = await dmxUsbServer.listDevices();
    const taggedFtdi = ftdiDevices.map(d => ({ ...d, source: 'ftdi' }));

    // Collect FTDI serial numbers to de-duplicate
    const ftdiSerials = new Set(ftdiDevices.map(d => d.serial_number).filter(Boolean));

    // 2. libusb scan (direct)
    const usbDevices = await scanUsbDevices(ftdiSerials);

    res.json({ ftdi: taggedFtdi, usb: usbDevices });
  } catch (e) {
    res.json({ ftdi: [], usb: [] });
  }
});

// ─── DMX USB API ────────────────────────────────────────────────────────────

app.get('/api/dmx-usb/status', (req, res) => {
  res.json(dmxUsbServer.getStatus());
});

app.post('/api/dmx-usb/open', async (req, res) => {
  const { serial_number, description, source, vid, pid } = req.body;
  let success = false;
  let identifier;

  if (source === 'usb') {
    // libusb bulk device (e.g. SoundSwitch DMX Micro)
    if (!vid || !pid) return res.status(400).json({ error: 'Provide vid and pid for USB devices' });
    identifier = { source: 'usb', vid, pid, serial_number: serial_number || '' };
    success = await dmxUsbServer.openUsb(identifier);
  } else {
    // FTDI D2XX device
    identifier = serial_number ? { serial_number } : description ? { description } : null;
    if (!identifier) return res.status(400).json({ error: 'Provide serial_number or description' });
    success = await dmxUsbServer.open(identifier);
  }

  if (success) {
    const rate = parseInt(db.getConfig('dmx_refresh_rate') || '40', 10);
    dmxUsbServer.startTx(rate);
    res.json({ ok: true, identifier });
  } else {
    res.status(500).json({ error: 'Failed to open device' });
  }
});

app.post('/api/dmx-usb/close', (req, res) => {
  dmxUsbServer.close();
  res.json({ ok: true });
});

app.post('/api/dmx-usb/blackout', (req, res) => {
  dmxUsbServer.blackout();
  res.json({ ok: true });
});

// ─── Art-Net Universes API ──────────────────────────────────────────────────

app.get('/api/artnet-universes', (req, res) => {
  res.json(db.getArtNetUniverses());
});

app.get('/api/artnet-universes/:id', (req, res) => {
  const u = db.getArtNetUniverse(+req.params.id);
  u ? res.json(u) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/artnet-universes', (req, res) => {
  const result = db.createArtNetUniverse(req.body);
  if (result.error) return res.status(400).json(result);
  // Hot-add to running Art-Net worker
  artnetServer.upsertNode(result);
  res.status(201).json(result);
});

app.put('/api/artnet-universes/:id', (req, res) => {
  const result = db.updateArtNetUniverse(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  // Hot-update running worker
  artnetServer.upsertNode(result);
  res.json(result);
});

app.delete('/api/artnet-universes/:id', (req, res) => {
  const existing = db.getArtNetUniverse(+req.params.id);
  if (existing) artnetServer.removeNode(existing.id);
  db.deleteArtNetUniverse(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/artnet-universes/:id/toggle', (req, res) => {
  const result = db.toggleArtNetUniverse(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  artnetServer.upsertNode(result);
  res.json(result);
});

app.post('/api/artnet/blackout', (req, res) => {
  artnetServer.blackout();
  dmxUsbServer.blackout();
  res.json({ ok: true });
});

app.post('/api/artnet/channel', (req, res) => {
  const { localUniverse, channel, value } = req.body;
  artnetServer.setChannel(localUniverse, channel, value);
  res.json({ ok: true });
});

// ─── DMX Output Control API ─────────────────────────────────────────────────

let dmxOutputEnabled = false;

app.get('/api/dmx/output', (req, res) => {
  res.json({ enabled: dmxOutputEnabled });
});

app.post('/api/dmx/output', (req, res) => {
  dmxOutputEnabled = !!req.body.enabled;
  if (!dmxOutputEnabled) {
    artnetServer.blackout();
    dmxUsbServer.blackout();
  }
  broadcast({ type: 'dmxOutput', enabled: dmxOutputEnabled });
  console.log(`[DMX] Output ${dmxOutputEnabled ? 'ENABLED' : 'DISABLED'}`);
  res.json({ enabled: dmxOutputEnabled });
});

app.post('/api/dmx/channel', (req, res) => {
  const { universe, channel, value } = req.body;
  if (!dmxOutputEnabled) return res.json({ ok: true, outputOff: true });
  artnetServer.setChannel(universe, channel, value);
  // Also send to USB DMX (universe 1 maps to the single USB output)
  if (universe === 1 && dmxUsbServer.isOpen) {
    dmxUsbServer.setChannel(channel, value);
  }
  res.json({ ok: true });
});

app.post('/api/dmx/channels', (req, res) => {
  const { universe, channels } = req.body;  // channels: [{ch, val}]
  if (!dmxOutputEnabled) return res.json({ ok: true, outputOff: true });
  artnetServer.setChannels(universe, channels);
  // Also send to USB DMX (universe 1 maps to the single USB output)
  if (universe === 1 && dmxUsbServer.isOpen) {
    dmxUsbServer.setChannels(channels);
  }
  res.json({ ok: true });
});

// ─── Tracks API ─────────────────────────────────────────────────────────────

const vdjParser = require('./vdj-parser');

app.get('/api/tracks', (req, res) => {
  const result = db.getTracks({
    search:     req.query.search,
    genre:      req.query.genre,
    sourceType: req.query.sourceType,
    minBpm:     req.query.minBpm,
    maxBpm:     req.query.maxBpm,
    key:        req.query.key,
    limit:      req.query.limit,
    offset:     req.query.offset,
  });
  res.json(result);
});

app.get('/api/tracks/stats', (req, res) => {
  res.json(db.getTrackStats());
});

app.get('/api/tracks/genres', (req, res) => {
  res.json(db.getTrackGenres());
});

app.get('/api/tracks/:id', (req, res) => {
  const t = db.getTrack(+req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/tracks/import', (req, res) => {
  try {
    // Use configured path or try auto-detect
    let xmlPath = db.getConfig('vdj_db_path');
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (!xmlPath) return res.status(400).json({ error: 'VDJ database path not configured and auto-detect failed' });

    const tracks = vdjParser.parseVdjDatabase(xmlPath);
    const result = db.importTracks(tracks);
    console.log(`[VDJ] Imported ${result.total} tracks from ${xmlPath}`);
    res.json({ ...result, path: xmlPath });
  } catch (e) {
    console.error(`[VDJ] Import error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracks', (req, res) => {
  db.clearTracks();
  res.json({ cleared: true });
});

const httpServer = http.createServer(app);

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('[WS] Browser client connected');
  wsClients.add(ws);

  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', state }));

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('[WS] Browser client disconnected');
  });
});

// ─── Bonjour/mDNS Registration ─────────────────────────────────────────────

function registerBonjour() {
  try {
    const bonjour = new Bonjour();
    bonjour.publish({
      name: SERVICE_NAME,
      type: 'os2l',
      protocol: 'tcp',
      port: OS2L_PORT,
      txt: { txtvers: '1' },
    });
    console.log(`[mDNS] Registered "${SERVICE_NAME}" as _os2l._tcp on port ${OS2L_PORT}`);
    return bonjour;
  } catch (err) {
    console.error(`[mDNS] Failed to register: ${err.message}`);
    return null;
  }
}

// ─── Start Everything ───────────────────────────────────────────────────────

// Initialise database
db.init();

// Start Art-Net output server (worker thread)
const artnetServer = new ArtNetServer();
const artnetNodes = db.getArtNetUniverses();
const artnetRate = parseInt(db.getConfig('artnet_refresh_rate') || '44', 10);
artnetServer.start(artnetNodes, artnetRate);

// Start DMX USB output server (worker thread)
const dmxUsbServer = new DmxUsbServer();
dmxUsbServer.start();

// Auto-import VDJ database if configured
(function loadVdjDatabase() {
  try {
    let xmlPath = db.getConfig('vdj_db_path');
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (xmlPath) {
      console.log(`[VDJ] Loading database from ${xmlPath}...`);
      const tracks = vdjParser.parseVdjDatabase(xmlPath);
      const result = db.importTracks(tracks);
      console.log(`[VDJ] Imported ${result.total} tracks (${result.inserted} new, ${result.updated} updated)`);
    } else {
      console.log('[VDJ] No database path configured — skip track import');
    }
  } catch (e) {
    console.error(`[VDJ] Failed to load database: ${e.message}`);
  }
})();

os2lServer.listen(OS2L_PORT, '0.0.0.0', () => {
  console.log(`[OS2L] TCP server listening on port ${OS2L_PORT}`);
});

httpServer.listen(WEB_PORT, () => {
  console.log(`[HTTP] Web UI at http://localhost:${WEB_PORT}`);
});

const bonjour = registerBonjour();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  artnetServer.shutdown();
  dmxUsbServer.shutdown();
  if (bonjour) bonjour.destroy();
  os2lServer.close();
  httpServer.close();
  process.exit(0);
});

console.log(`
╔══════════════════════════════════════════════╗
║          DMX Controller v1.0                 ║
║                                              ║
║  OS2L:  port ${OS2L_PORT}                          ║
║  Web:   http://localhost:${WEB_PORT}              ║
║                                              ║
║  Waiting for VirtualDJ connection...         ║
╚══════════════════════════════════════════════╝
`);
