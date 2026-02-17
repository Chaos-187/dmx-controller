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

    // Drive sequence playback engine on VDJ time updates (VDJ sends time in ms)
    if (key === 'time' && typeof value === 'number') {
      if (activeSequences[deck]) {
        activeSequences[deck].vdjDriven = true;
        activeSequences[deck].currentTimeMs = value;
      }
      processSequenceAtTime(deck, value);
    }

    scheduleBroadcast();
  } else if (evt === 'beat') {
    broadcast({ type: 'beat', data });
  } else if (evt === 'btn') {
    broadcast({ type: 'btn', data });
    handleOs2lButtonAction(data);
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

// ─── OS2L Button Action Handler ─────────────────────────────────────────────

// Track active toggle states: Set of map IDs currently "on"
const activeToggles = new Set();

function handleOs2lButtonAction(data) {
  const btnName = data.name || data.button || '';
  const btnState = data.state;  // OS2L state: 1 = on/pressed, 0 = off/released
  const maps = db.getEnabledButtonMaps();

  for (const map of maps) {
    // Match by os2l_event type and value pattern
    const matchValue = map.os2l_value.trim();
    if (!matchValue) continue;

    // Support wildcard (*) or exact match
    let matched = false;
    if (matchValue === '*') {
      matched = true;
    } else if (btnName.toLowerCase() === matchValue.toLowerCase()) {
      matched = true;
    }
    if (!matched) continue;

    const toggleMode = map.toggle_mode || 'fire';

    // Normalise state: "on"/1/"1" → true, "off"/0/"0" → false, undefined → null
    let stateOn = null;
    if (btnState === 'on' || btnState === 1 || btnState === '1') stateOn = true;
    else if (btnState === 'off' || btnState === 0 || btnState === '0') stateOn = false;

    // For toggle mode, use OS2L state to determine on/off
    if (toggleMode === 'toggle') {
      if (stateOn === true) {
        activeToggles.add(map.id);
        executeMapAction(map, true);
      } else if (stateOn === false) {
        activeToggles.delete(map.id);
        executeMapAction(map, false);
      }
      // If state is undefined, treat as a simple toggle flip
      else {
        if (activeToggles.has(map.id)) {
          activeToggles.delete(map.id);
          executeMapAction(map, false);
        } else {
          activeToggles.add(map.id);
          executeMapAction(map, true);
        }
      }
    } else {
      // 'fire' mode — execute on every event regardless of state
      executeMapAction(map, true);
    }
  }
}

function executeMapAction(map, activate) {
  let actionData;
  try {
    actionData = JSON.parse(map.action_data || '{}');
  } catch (e) {
    actionData = {};
  }

  const stateLabel = activate ? 'ON' : 'OFF';
  console.log(`[OS2L] Button map "${map.name}" → ${map.action_type} [${stateLabel}]`);

  switch (map.action_type) {
    case 'blackout':
      if (activate) {
        // Save current DMX state then blackout
        artnetServer.saveBuffers();
        if (dmxUsbServer.isOpen) dmxUsbServer.saveBuffers();
        artnetServer.blackout();
        if (dmxUsbServer.isOpen) dmxUsbServer.blackout();
      } else {
        // Restore pre-blackout DMX state
        artnetServer.restoreBuffers();
        if (dmxUsbServer.isOpen) dmxUsbServer.restoreBuffers();
      }
      broadcast({ type: 'os2l_action', action: 'blackout', map: map.name, active: activate });
      break;

    case 'set_channels': {
      // action_data: { universe: 1, channels: [{ ch: 1, val: 255 }, ...] }
      const universe = actionData.universe || 1;
      const channels = actionData.channels || [];
      if (channels.length && dmxOutputEnabled) {
        if (activate) {
          artnetServer.setChannels(universe, channels);
          if (universe === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(channels);
        } else {
          // Deactivate: set those channels to 0
          const offChannels = channels.map(c => ({ ch: c.ch, val: 0 }));
          artnetServer.setChannels(universe, offChannels);
          if (universe === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(offChannels);
        }
      }
      broadcast({ type: 'os2l_action', action: 'set_channels', map: map.name, active: activate });
      break;
    }

    case 'full_on': {
      const universe = actionData.universe || 1;
      const val = activate ? 255 : 0;
      const ch = [];
      for (let i = 1; i <= 512; i++) ch.push({ ch: i, val });
      if (dmxOutputEnabled) {
        artnetServer.setChannels(universe, ch);
        if (universe === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(ch);
      }
      broadcast({ type: 'os2l_action', action: 'full_on', map: map.name, active: activate });
      break;
    }

    case 'scene': {
      // action_data: { fixtures: [{ universe, channels: [{ ch, val }] }] }
      const fixtures = actionData.fixtures || [];
      for (const f of fixtures) {
        const u = f.universe || 1;
        if (f.channels && f.channels.length && dmxOutputEnabled) {
          if (activate) {
            artnetServer.setChannels(u, f.channels);
            if (u === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(f.channels);
          } else {
            const offChannels = f.channels.map(c => ({ ch: c.ch, val: 0 }));
            artnetServer.setChannels(u, offChannels);
            if (u === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(offChannels);
          }
        }
      }
      broadcast({ type: 'os2l_action', action: 'scene', map: map.name, active: activate });
      break;
    }

    case 'strobe': {
      // Use saved strobe speed config + fixture channel map (range-aware)
      const strobeSpeed = parseInt(db.getConfig('strobe_speed') || '200', 10);
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {}; // { universe: [{ ch, val }] }

      for (const fix of channelMap) {
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          if (ch.type === 'strobe') {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? strobeSpeed : 0 });
          } else if (ch.ranges) {
            const strobeRange = ch.ranges.find(r => r.type === 'strobe');
            if (strobeRange) {
              const mapped = activate
                ? Math.round(strobeRange.min + (strobeSpeed / 255) * (strobeRange.max - strobeRange.min))
                : 0;
              channelUpdates[u].push({ ch: ch.dmx_address, val: mapped });
            }
          }
        }
      }

      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          if (+u === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(channels);
        }
      }
      broadcast({ type: 'os2l_action', action: 'strobe', map: map.name, active: activate });
      break;
    }

    default:
      console.warn(`[OS2L] Unknown action type: ${map.action_type}`);
  }
}

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

// ─── Mover Presets API ──────────────────────────────────────────────────────

app.get('/api/mover-presets', (req, res) => {
  res.json(db.getMoverPresets());
});

app.get('/api/mover-presets/:id', (req, res) => {
  const p = db.getMoverPreset(+req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/mover-presets', (req, res) => {
  const result = db.createMoverPreset(req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.put('/api/mover-presets/:id', (req, res) => {
  const result = db.updateMoverPreset(+req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/mover-presets/:id', (req, res) => {
  db.deleteMoverPreset(+req.params.id);
  res.json({ deleted: true });
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

// ─── OS2L Button Maps API ───────────────────────────────────────────────────

app.get('/api/os2l-button-maps', (req, res) => {
  res.json(db.getButtonMaps());
});

app.get('/api/os2l-button-maps/:id', (req, res) => {
  const m = db.getButtonMap(+req.params.id);
  m ? res.json(m) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/os2l-button-maps', (req, res) => {
  const result = db.createButtonMap(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/os2l-button-maps/:id', (req, res) => {
  const result = db.updateButtonMap(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/os2l-button-maps/:id', (req, res) => {
  db.deleteButtonMap(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/os2l-button-maps/:id/toggle', (req, res) => {
  const result = db.toggleButtonMap(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/os2l-button-maps/test/:id', (req, res) => {
  const map = db.getButtonMap(+req.params.id);
  if (!map) return res.status(404).json({ error: 'Not found' });
  // Test fires with state=1 (activate)
  handleOs2lButtonAction({ name: map.os2l_value, button: map.os2l_value, state: 1 });
  res.json({ ok: true, tested: map.name });
});

// Get active toggle states
app.get('/api/os2l-button-maps/active-toggles', (req, res) => {
  res.json([...activeToggles]);
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

// ─── Effects API ────────────────────────────────────────────────────────────

app.get('/api/effects', (req, res) => {
  res.json(db.getEffects());
});

app.get('/api/effects/:id', (req, res) => {
  const e = db.getEffect(+req.params.id);
  e ? res.json(e) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/effects', (req, res) => {
  const result = db.createEffect(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/effects/:id', (req, res) => {
  const result = db.updateEffect(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/effects/:id', (req, res) => {
  db.deleteEffect(+req.params.id);
  res.json({ deleted: true });
});

// ─── Quick Action Effects Runner ────────────────────────────────────────────

let runningQaEffect = null; // { timer, effectId, fixtureIds }

function stopRunningEffect() {
  if (runningQaEffect) {
    // Send zeros to all affected channels to clean up
    const fixMap = db.getFixtureChannelMap();
    const channelUpdates = {};
    for (const fixtureId of runningQaEffect.fixtureIds) {
      const fix = fixMap.find(f => f.id === fixtureId);
      if (!fix) continue;
      for (const ch of fix.channels) {
        if (['red','green','blue','white','dimmer'].includes(ch.type)) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          channelUpdates[fix.universe][ch.dmx_address] = 0;
        }
      }
    }
    for (const [u, chMap] of Object.entries(channelUpdates)) {
      const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
      if (channels.length > 0) {
        artnetServer.setChannels(+u, channels);
        if (+u === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(channels);
      }
    }
    clearInterval(runningQaEffect.timer);
    runningQaEffect = null;
  }
}

app.post('/api/effects/run', (req, res) => {
  const { effectId, fixtureIds } = req.body;
  stopRunningEffect();

  const effect = db.getEffect(effectId);
  if (!effect) return res.status(404).json({ error: 'Effect not found' });
  if (!fixtureIds || fixtureIds.length === 0) return res.status(400).json({ error: 'No fixtures specified' });

  const startTime = Date.now();
  const fixMap = db.getFixtureChannelMap();

  const timer = setInterval(() => {
    if (!dmxOutputEnabled) return;

    const elapsed = (Date.now() - startTime) / 1000;
    const channelUpdates = {};

    for (const fixtureId of fixtureIds) {
      const fix = fixMap.find(f => f.id === fixtureId);
      if (!fix) continue;

      for (const ch of fix.channels) {
        // For color_fade, cycle every 4 seconds; for others, use raw elapsed
        let progress;
        if (effect.type === 'color_fade') {
          progress = (elapsed % 4) / 4;
        } else {
          progress = elapsed;
        }

        const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };
        const value = computeEffectValue(effect, ch.type, progress, baseValues, {});

        if (value !== null && value !== undefined) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          channelUpdates[fix.universe][ch.dmx_address] = Math.max(0, Math.min(255, Math.round(value)));
        }
      }
    }

    for (const [u, chMap] of Object.entries(channelUpdates)) {
      const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
      if (channels.length > 0) {
        artnetServer.setChannels(+u, channels);
        if (+u === 1 && dmxUsbServer.isOpen) dmxUsbServer.setChannels(channels);
      }
    }
  }, 25); // ~40 Hz

  runningQaEffect = { timer, effectId, fixtureIds };
  console.log(`[QA] Started effect "${effect.name}" on ${fixtureIds.length} fixture(s)`);
  res.json({ ok: true });
});

app.post('/api/effects/stop', (req, res) => {
  if (runningQaEffect) {
    console.log(`[QA] Stopped running effect`);
  }
  stopRunningEffect();
  res.json({ ok: true });
});

// ─── Sequences API ──────────────────────────────────────────────────────────

app.get('/api/sequences', (req, res) => {
  res.json(db.getSequences());
});

app.get('/api/sequences/:id', (req, res) => {
  const s = db.getSequence(+req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});

app.get('/api/sequences/by-track/:trackId', (req, res) => {
  const s = db.getSequenceByTrackId(+req.params.trackId);
  s ? res.json(s) : res.status(404).json({ error: 'No sequence for this track' });
});

app.post('/api/sequences', (req, res) => {
  const result = db.createSequence(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/sequences/:id', (req, res) => {
  const result = db.updateSequence(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/sequences/:id', (req, res) => {
  db.deleteSequence(+req.params.id);
  res.json({ deleted: true });
});

// ─── Sequence Cues API ──────────────────────────────────────────────────────

app.get('/api/sequences/:id/cues', (req, res) => {
  res.json(db.getSequenceCues(+req.params.id));
});

app.post('/api/sequences/:id/cues', (req, res) => {
  const result = db.createCue(+req.params.id, req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/cues/:id', (req, res) => {
  const result = db.updateCue(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/cues/:id', (req, res) => {
  db.deleteCue(+req.params.id);
  res.json({ deleted: true });
});

app.put('/api/sequences/:id/cues/bulk', (req, res) => {
  const cues = req.body.cues || [];
  const result = db.bulkUpdateCues(+req.params.id, cues);
  res.json(result);
});

// ─── Auto-Generate Sequence ─────────────────────────────────────────────────

app.post('/api/sequences/generate/:trackId', (req, res) => {
  const track = db.getTrack(+req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Check if sequence already exists for this track
  const existing = db.getSequenceByTrackId(track.id);
  if (existing && !req.body.overwrite) {
    return res.status(409).json({ error: 'Sequence already exists', sequence_id: existing.id });
  }
  if (existing) {
    db.deleteSequence(existing.id);
  }

  const bpm = track.bpm || 128;
  const durationMs = (track.song_length || 180) * 1000;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  // Create sequence
  const seq = db.createSequence({
    name: track.title || track.filename || 'Untitled',
    track_id: track.id,
    bpm: bpm,
    duration_ms: durationMs,
  });

  // Get fixtures to assign to lanes
  const fixtures = db.getFixtureChannelMap();
  if (fixtures.length === 0) {
    return res.json(seq); // Empty sequence, no fixtures to populate
  }

  // Color palettes for variety
  const palettes = [
    [{ red: 255, green: 0, blue: 0 }, { red: 0, green: 0, blue: 255 }],
    [{ red: 0, green: 255, blue: 0 }, { red: 255, green: 0, blue: 255 }],
    [{ red: 255, green: 128, blue: 0 }, { red: 0, green: 128, blue: 255 }],
    [{ red: 255, green: 0, blue: 128 }, { red: 0, green: 255, blue: 128 }],
    [{ red: 128, green: 0, blue: 255 }, { red: 255, green: 255, blue: 0 }],
    [{ red: 0, green: 255, blue: 255 }, { red: 255, green: 0, blue: 0 }],
  ];

  const cueColors = ['#e53935', '#43a047', '#1e88e5', '#ff8f00', '#7b1fa2', '#00acc1', '#fdd835', '#d81b60'];
  const cues = [];

  // Generate cues: color changes every 4 bars, alternating patterns per fixture
  const totalBars = Math.floor(durationMs / barMs);
  const sectionBars = 4; // change every 4 bars

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const hasRGB = fix.channels.some(ch => ch.type === 'red') &&
                   fix.channels.some(ch => ch.type === 'green') &&
                   fix.channels.some(ch => ch.type === 'blue');
    if (!hasRGB) continue; // skip non-color fixtures for auto-gen

    const lane = fiIdx;

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % palettes.length;
      const colorIdx = (fiIdx + Math.floor(bar / sectionBars)) % 2;
      const palette = palettes[(paletteIdx + fiIdx) % palettes.length];
      const color = palette[colorIdx];
      const startMs = bar * barMs;
      const durMs = Math.min(sectionBars * barMs, durationMs - startMs);

      if (durMs <= 0) break;

      // Static color cue
      cues.push({
        lane,
        start_ms: Math.round(startMs),
        duration_ms: Math.round(durMs),
        cue_type: 'static',
        fixture_id: fix.id,
        channel_values: color,
        color: cueColors[(paletteIdx + fiIdx) % cueColors.length],
        label: `${fix.name}`,
      });
    }
  }

  // Bulk insert
  if (cues.length > 0) {
    db.bulkUpdateCues(seq.id, cues);
  }

  res.json(db.getSequence(seq.id));
});

// ─── Sequence Playback Engine ───────────────────────────────────────────────

const activeSequences = {};  // { deckNum: { sequence, lastTimeMs, playing, ... } }
const playbackTimers = {};   // { deckNum: intervalId }

// Start a standalone playback timer for a deck (runs when VDJ isn't driving time)
function startPlaybackTimer(deck) {
  stopPlaybackTimer(deck);
  const deckSeq = activeSequences[deck];
  if (!deckSeq) return;

  deckSeq.startWall = Date.now();
  deckSeq.startOffset = deckSeq.currentTimeMs || 0;

  const TICK_MS = 25; // ~40 Hz
  playbackTimers[deck] = setInterval(() => {
    const ds = activeSequences[deck];
    if (!ds || !ds.playing) { stopPlaybackTimer(deck); return; }

    // If VDJ is actively sending time for this deck, skip internal timer
    if (ds.vdjDriven) return;

    const elapsedMs = Date.now() - ds.startWall;
    ds.currentTimeMs = ds.startOffset + elapsedMs;

    processSequenceAtTime(deck, ds.currentTimeMs);

    // Broadcast playhead position to frontend
    broadcast({ type: 'seq_time', deck, timeMs: ds.currentTimeMs });
  }, TICK_MS);

  console.log(`[SEQ] Started standalone playback timer for deck ${deck}`);
}

function stopPlaybackTimer(deck) {
  if (playbackTimers[deck]) {
    clearInterval(playbackTimers[deck]);
    delete playbackTimers[deck];
    console.log(`[SEQ] Stopped playback timer for deck ${deck}`);
  }
}

// Handle sequence playback commands from WebSocket
function handleSequenceCommand(ws, msg) {
  const { action, deck, sequenceId } = msg;

  switch (action) {
    case 'load': {
      const seq = db.getSequence(sequenceId);
      if (!seq) return ws.send(JSON.stringify({ type: 'seq_error', error: 'Sequence not found' }));
      stopPlaybackTimer(deck);
      activeSequences[deck] = { sequence: seq, lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
      broadcast({ type: 'seq_loaded', deck, sequence: seq });
      console.log(`[SEQ] Loaded sequence "${seq.name}" on deck ${deck}`);
      break;
    }
    case 'unload':
      stopPlaybackTimer(deck);
      delete activeSequences[deck];
      broadcast({ type: 'seq_unloaded', deck });
      console.log(`[SEQ] Unloaded sequence from deck ${deck}`);
      break;
    case 'play':
      if (activeSequences[deck]) {
        activeSequences[deck].playing = true;
        startPlaybackTimer(deck);
        broadcast({ type: 'seq_playing', deck, playing: true });
      }
      break;
    case 'pause':
      if (activeSequences[deck]) {
        activeSequences[deck].playing = false;
        // Save current position so resume continues from here
        if (playbackTimers[deck]) {
          const ds = activeSequences[deck];
          ds.currentTimeMs = ds.startOffset + (Date.now() - ds.startWall);
        }
        stopPlaybackTimer(deck);
        broadcast({ type: 'seq_playing', deck, playing: false });
      }
      break;
  }
}

/**
 * Called on each time update to drive the sequence engine.
 * Finds active cues at the current position and sends DMX values.
 * @param {number} deckNum - Deck number
 * @param {number} timeMs - Current playback position in milliseconds
 */
function processSequenceAtTime(deckNum, timeMs) {
  const deckSeq = activeSequences[deckNum];
  if (!deckSeq || !deckSeq.playing || !deckSeq.sequence) return;

  const seq = deckSeq.sequence;
  const cues = seq.cues || [];

  if (!dmxOutputEnabled) return;

  // Find all active cues at this time position
  const channelUpdates = {}; // { universe: { channel: value } }

  for (const cue of cues) {
    if (timeMs < cue.start_ms || timeMs >= cue.start_ms + cue.duration_ms) continue;

    // This cue is active
    const fixtureId = cue.fixture_id;
    if (!fixtureId) continue;

    // Find the fixture in fixture channel map (cache this?)
    const fixMap = db.getFixtureChannelMap().find(f => f.id === fixtureId);
    if (!fixMap) continue;

    const progress = (timeMs - cue.start_ms) / cue.duration_ms; // 0..1

    const channelVals = cue.channel_values || {};
    const endVals = cue.end_channel_values;

    for (const ch of fixMap.channels) {
      let value = null;

      if (cue.cue_type === 'static') {
        value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
      } else if (cue.cue_type === 'fade' && endVals) {
        const startVal = channelVals[ch.type] !== undefined ? channelVals[ch.type] : 0;
        const endVal = endVals[ch.type] !== undefined ? endVals[ch.type] : 0;
        value = Math.round(startVal + (endVal - startVal) * progress);
      } else if (cue.cue_type === 'strobe') {
        const strobeHz = channelVals.strobe_hz || 10;
        const period = 1000 / strobeHz;
        const phase = ((timeMs - cue.start_ms) % period) / period;
        value = phase < 0.5 ? 255 : 0;
        // Apply to all color channels
        if (['red', 'green', 'blue', 'white', 'dimmer'].includes(ch.type)) {
          // Use the channel value as the "on" value, strobe between that and 0
          const onVal = channelVals[ch.type] !== undefined ? channelVals[ch.type] : 255;
          value = phase < 0.5 ? onVal : 0;
        } else {
          value = null;
        }
      } else if (cue.cue_type === 'chase') {
        // Chase: cycle through fixtures in the group
        // For now, simple on/off based on beat position
        value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
      } else if (cue.cue_type === 'effect' && cue.effect_id) {
        const effect = db.getEffect(cue.effect_id);
        if (effect) {
          value = computeEffectValue(effect, ch.type, progress, channelVals, cue.effect_params || {});
        }
      }

      if (value !== null && value !== undefined) {
        const universe = fixMap.universe;
        if (!channelUpdates[universe]) channelUpdates[universe] = {};
        channelUpdates[universe][ch.dmx_address] = Math.max(0, Math.min(255, Math.round(value)));
      }
    }
  }

  // Send all channel updates
  for (const [u, chMap] of Object.entries(channelUpdates)) {
    const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
    if (channels.length > 0) {
      artnetServer.setChannels(+u, channels);
      if (+u === 1 && dmxUsbServer.isOpen) {
        dmxUsbServer.setChannels(channels);
      }
    }
  }

  deckSeq.lastTimeMs = timeMs;
}

/**
 * Compute the value for a channel from an effect definition.
 */
function computeEffectValue(effect, channelType, progress, baseValues, params) {
  const data = effect.effect_data || {};
  const type = effect.type;

  switch (type) {
    case 'pulse': {
      // Sine wave pulse
      const freq = params.frequency || data.frequency || 1;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      return val * (0.5 + 0.5 * Math.sin(progress * freq * 2 * Math.PI));
    }
    case 'rainbow': {
      // Cycle through hue
      const hue = (progress * 360 * (params.cycles || data.cycles || 1)) % 360;
      const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      return null;
    }
    case 'strobe': {
      const hz = params.frequency || data.frequency || 10;
      const period = 1 / hz;
      const phase = (progress % period) / period;
      const onVal = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      return phase < 0.5 ? onVal : 0;
    }
    case 'color_fade': {
      // Fade between two colors defined in effect_data
      const startColor = data.start_color || {};
      const endColor = data.end_color || {};
      const startVal = startColor[channelType] !== undefined ? startColor[channelType] : 0;
      const endVal = endColor[channelType] !== undefined ? endColor[channelType] : 0;
      return Math.round(startVal + (endVal - startVal) * progress);
    }
    default:
      return baseValues[channelType] !== undefined ? baseValues[channelType] : null;
  }
}

/**
 * HSL to RGB conversion (h: 0-1, s: 0-1, l: 0-1) → [r, g, b] 0-255
 */
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

const httpServer = http.createServer(app);

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('[WS] Browser client connected');
  wsClients.add(ws);

  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', state }));

  // Send active sequence state
  for (const [deck, seqState] of Object.entries(activeSequences)) {
    if (seqState.sequence) {
      ws.send(JSON.stringify({ type: 'seq_loaded', deck: +deck, sequence: seqState.sequence }));
    }
  }

  ws.on('message', (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());
      if (msg.type === 'sequence') {
        handleSequenceCommand(ws, msg);
      }
    } catch (e) { /* ignore invalid JSON */ }
  });

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
