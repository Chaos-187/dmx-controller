/**
 * OS2L Module — TCP Server, Subscription Manager & Button Action Handler
 *
 * Manages the OS2L TCP connection with VirtualDJ, handles subscription
 * messages, and executes button-map actions (blackout, color, effects,
 * scenes, strobe, dimmer, etc.).
 *
 * Usage:
 *   const os2l = require('./os2l');
 *   os2l.init({ db, broadcast, state, ... });
 *   os2l.startServer(port);
 */

const net = require('net');
const { mapShutterStrobeValue } = require('./effects-engine');

// ─── Injected Dependencies ──────────────────────────────────────────────────

let db;
let broadcast;
let state;
let artnetServer;
let dmxUsbServer;
let touchOverrides;
let runningQaEffects;

// Functions injected from server.js
let getDmxOutputEnabled;
let getEffectSlot;
let stopRunningEffect;
let activateScene;
let deactivateScene;
let buildChannelCtx;
let computeEffectValue;
let isFixtureCompatibleWithEffect;
let applyMasterDimmer;
let applyTouchDimmerChain;
let applyInvert;
let isAnySequencePlaying;
let setBlackoutHold;

// Message handler callback (provided by server.js for trigger processing)
let onMessage;
let onButton;
let eventLogModule = null;

const triggerParseCache = new Map();
const OS2L_NOISY_TRIGGER = /get_time elapsed|beatpos|\blevel\b|get_beat|get_loop/i;

// ─── State ──────────────────────────────────────────────────────────────────

let activeVdjSocket = null;
const activeToggles = new Set();
let os2lServer = null;

// ─── Initialise ─────────────────────────────────────────────────────────────

/**
 * Inject dependencies from the main server.
 * @param {object} deps
 */
function init(deps) {
  db = deps.db;
  broadcast = deps.broadcast;
  state = deps.state;
  artnetServer = deps.artnetServer;
  dmxUsbServer = deps.dmxUsbServer;
  touchOverrides = deps.touchOverrides;
  runningQaEffects = deps.runningQaEffects;
  getDmxOutputEnabled = deps.getDmxOutputEnabled;
  getEffectSlot = deps.getEffectSlot;
  stopRunningEffect = deps.stopRunningEffect;
  activateScene = deps.activateScene;
  deactivateScene = deps.deactivateScene;
  buildChannelCtx = deps.buildChannelCtx;
  computeEffectValue = deps.computeEffectValue;
  isFixtureCompatibleWithEffect = deps.isFixtureCompatibleWithEffect;
  applyMasterDimmer = deps.applyMasterDimmer;
  applyTouchDimmerChain = deps.applyTouchDimmerChain || ((v, fix, chType) => {
    const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
    if (fixHasDimmer) {
      if (chType === 'dimmer') return applyMasterDimmer(v, chType);
      return v;
    }
    return applyMasterDimmer(v, chType);
  });
  applyInvert = deps.applyInvert;
  isAnySequencePlaying = deps.isAnySequencePlaying || (() => false);
  setBlackoutHold = deps.setBlackoutHold || null;
  onMessage = deps.onMessage;
  onButton = deps.onButton || null;
}

// ─── VDJ Subscription Builder ───────────────────────────────────────────────

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

/** Normalize OS2L toggle values (play, loop, etc.) to 0 or 1 when possible. */
function normalizeSubscribedValue(key, value) {
  const k = String(key || '');
  const isToggle =
    k === 'play' ||
    k === 'loop' ||
    k === 'get_loop' ||
    k.includes('loop_roll');
  if (!isToggle) {
    if (typeof value === 'string') {
      if (value === 'on') return 1;
      if (value === 'off') return 0;
    }
    return value;
  }
  if (value === true || value === 1 || value === '1' || value === 'on' || value === 'ON') return 1;
  if (value === false || value === 0 || value === '0' || value === 'off' || value === 'OFF') return 0;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'true' || v === 'yes') return 1;
    if (v === 'false' || v === 'no') return 0;
  }
  return value;
}

/** Pull complete JSON objects from a TCP buffer (newline-delimited or back-to-back `{...}{...}`). */
function drainJsonObjects(buffer) {
  const objects = [];
  let rest = buffer;
  while (rest.length) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.length) break;
    if (rest[0] !== '{') {
      const nl = rest.search(/\r?\n/);
      if (nl === -1) break;
      rest = rest.slice(nl + (rest[nl] === '\r' ? 2 : 1));
      continue;
    }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') {
        inStr = true;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    const slice = rest.slice(0, end);
    try {
      objects.push(JSON.parse(slice));
    } catch {
      /* skip malformed chunk */
    }
    rest = rest.slice(end);
  }
  return { objects, rest };
}

function parseTrigger(trigger) {
  const t = String(trigger || '').trim();
  if (triggerParseCache.has(t)) return triggerParseCache.get(t);

  const m = t.match(/^deck (\d+) (.+)$/i);
  if (!m) {
    const miss = { deck: null, key: t };
    triggerParseCache.set(t, miss);
    return miss;
  }

  const deck = parseInt(m[1], 10);
  const param = m[2].trim();

  let key = param;
  if (param.startsWith("get_text '%SOUNDSWITCH_ID'")) key = 'soundswitch_id';
  else if (param === 'get_filepath') key = 'filepath';
  else if (param === 'get_genre') key = 'genre';
  else if (param === 'level') key = 'level';
  else if (param === 'get_time elapsed absolute') key = 'time';
  else if (param === 'get_beatpos') key = 'beatpos';
  else if (param === 'get_firstbeat') key = 'firstbeat';
  else if (param === 'get_bpm') key = 'bpm';
  else if (param === 'play') key = 'play';
  else if (param === 'loop') key = 'loop';
  else if (param === 'get_loop') key = 'get_loop';
  else if (param.includes('loop_roll')) key = 'loop_roll';

  const parsed = { deck, key };
  triggerParseCache.set(t, parsed);
  return parsed;
}

// ─── TCP Server ─────────────────────────────────────────────────────────────

function stopServer() {
  if (!os2lServer) return;
  try {
    os2lServer.close();
  } catch (e) {
    // ignore — may already be closed
  }
  os2lServer = null;
}

/**
 * Create and start the OS2L TCP server.
 * @param {number} port
 * @returns {net.Server}
 */
function startServer(port, host = '0.0.0.0') {
  stopServer();

  os2lServer = net.createServer((socket) => {
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
      const drained = drainJsonObjects(buffer);
      buffer = drained.rest;
      for (const parsed of drained.objects) {
        handleMessage(parsed);
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

  os2lServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[OS2L] Port ${port} already in use — retrying in 1s (stop the other server or free the port)`);
      stopServer();
      setTimeout(() => startServer(port, host), 1000);
      return;
    }
    console.error(`[OS2L] Server error: ${err.message}`);
  });

  os2lServer.listen(port, host, () => {
    const bindLabel = host === '0.0.0.0' ? 'all interfaces' : host;
    console.log(`[OS2L] TCP server listening on ${bindLabel}:${port}`);
  });

  return os2lServer;
}

// ─── Message Dispatch ───────────────────────────────────────────────────────

function handleMessage(data) {
  const evt = data.evt;
  const trigger = data?.trigger;
  const skipLog = evt === 'subscribed' && trigger && OS2L_NOISY_TRIGGER.test(String(trigger));
  if (!skipLog) {
    try {
      if (!eventLogModule) eventLogModule = require('./lib/event-log');
      eventLogModule.addFromOs2l(data);
    } catch {
      /* event log not initialized yet */
    }
  }


  if (evt === 'subscribed') {
    // Delegate trigger processing to the main server's onMessage callback
    if (onMessage) onMessage(data);
  } else if (evt === 'beat') {
    broadcast({ type: 'beat', data });
  } else if (evt === 'btn') {
    broadcast({ type: 'btn', data });
    if (onButton) onButton(data);
    else handleButtonAction(data);
  } else if (evt === 'cmd') {
    broadcast({ type: 'cmd', data });
  } else {
    broadcast({ type: 'event', evt, data });
  }
}

// ─── Button Action Handler ──────────────────────────────────────────────────

function handleButtonAction(data) {
  const btnName = data.name || data.button || '';
  const btnState = data.state;  // OS2L state: 1 = on/pressed, 0 = off/released
  const maps = db.getEnabledButtonMaps();

  let anyMatched = false;

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

    anyMatched = true;
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

  // Auto-create a disabled placeholder for unknown buttons so the user can
  // configure them later from the OS2L Button Maps tab.
  if (!anyMatched && btnName) {
    // Check ALL maps (including disabled) to avoid duplicates
    const allMaps = db.getButtonMaps();
    const alreadyExists = allMaps.some(m => m.os2l_value.trim().toLowerCase() === btnName.toLowerCase());
    if (!alreadyExists) {
      const newMap = db.createButtonMap({
        name: btnName,
        os2l_event: 'btn',
        os2l_value: btnName,
        action_type: 'blackout',
        action_data: '{}',
        toggle_mode: 'fire',
      });
      if (newMap && !newMap.error) {
        // Disable it immediately — it's just a placeholder
        db.toggleButtonMap(newMap.id);
        console.log(`[OS2L] Auto-created placeholder button map "${btnName}" (disabled)`);
        broadcast({ type: 'os2l_button_map_created', map: { ...newMap, enabled: 0 } });
      }
    }
  }
}

// ─── Action Executor ────────────────────────────────────────────────────────

/**
 * Mark fixture IDs as overridden by an OS2L button action (suppresses sequence output)
 * or release them back to sequence control.
 */
function setOs2lOverride(fixtureIds, activate) {
  if (activate) {
    for (const id of fixtureIds) touchOverrides.os2lOverrideFixtures.add(id);
  } else {
    for (const id of fixtureIds) touchOverrides.os2lOverrideFixtures.delete(id);
  }
}

/** Get all fixture IDs from the channel map, optionally filtered by group. */
function getAffectedFixtureIds(groupId) {
  const channelMap = db.getFixtureChannelMap();
  if (groupId) {
    return channelMap.filter(f => (f.group_ids || []).includes(groupId)).map(f => f.id);
  }
  return channelMap.map(f => f.id);
}

function executeMapAction(map, activate) {
  let actionData;
  try {
    actionData = JSON.parse(map.action_data || '{}');
  } catch (e) {
    actionData = {};
  }

  const dmxOutputEnabled = getDmxOutputEnabled();
  const stateLabel = activate ? 'ON' : 'OFF';
  console.log(`[OS2L] Button map "${map.name}" → ${map.action_type} [${stateLabel}]`);

  switch (map.action_type) {
    case 'blackout':
      if (setBlackoutHold) {
        setBlackoutHold(activate);
      } else {
        touchOverrides.blackoutHold = activate;
        if (activate) {
          artnetServer.saveBuffers();
          dmxUsbServer.saveBuffers();
          artnetServer.blackout();
          dmxUsbServer.blackout();
        } else {
          artnetServer.restoreBuffers();
          dmxUsbServer.restoreBuffers();
        }
        broadcast({ type: 'touchBlackoutHold', active: activate });
      }
      broadcast({ type: 'os2l_action', action: 'blackout', map: map.name, active: activate });
      break;

    case 'set_channels': {
      const universe = actionData.universe || 1;
      const channels = actionData.channels || [];
      // Override all fixtures so the sequence doesn't fight these raw channel writes
      setOs2lOverride(getAffectedFixtureIds(), activate);
      if (channels.length && dmxOutputEnabled) {
        if (activate) {
          artnetServer.setChannels(universe, channels);
          dmxUsbServer.setChannels(universe, channels);
        } else {
          const offChannels = channels.map(c => ({ ch: c.ch, val: 0 }));
          artnetServer.setChannels(universe, offChannels);
          dmxUsbServer.setChannels(universe, offChannels);
        }
      }
      broadcast({ type: 'os2l_action', action: 'set_channels', map: map.name, active: activate });
      break;
    }

    case 'full_on': {
      const universe = actionData.universe || 1;
      const val = activate ? 255 : 0;
      // Override all fixtures
      setOs2lOverride(getAffectedFixtureIds(), activate);
      const ch = [];
      for (let i = 1; i <= 512; i++) ch.push({ ch: i, val });
      if (dmxOutputEnabled) {
        artnetServer.setChannels(universe, ch);
        dmxUsbServer.setChannels(universe, ch);
      }
      broadcast({ type: 'os2l_action', action: 'full_on', map: map.name, active: activate });
      break;
    }

    case 'scene': {
      const fixtures = actionData.fixtures || [];
      // Override all fixtures (raw scene targets arbitrary channels)
      setOs2lOverride(getAffectedFixtureIds(), activate);
      for (const f of fixtures) {
        const u = f.universe || 1;
        if (f.channels && f.channels.length && dmxOutputEnabled) {
          if (activate) {
            artnetServer.setChannels(u, f.channels);
            dmxUsbServer.setChannels(u, f.channels);
          } else {
            const offChannels = f.channels.map(c => ({ ch: c.ch, val: 0 }));
            artnetServer.setChannels(u, offChannels);
            dmxUsbServer.setChannels(u, offChannels);
          }
        }
      }
      broadcast({ type: 'os2l_action', action: 'scene', map: map.name, active: activate });
      break;
    }

    case 'strobe': {
      const strobeSpeed = parseInt(db.getConfig('strobe_speed') || '200', 10);
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      const strobeFixtureIds = [];

      for (const fix of channelMap) {
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        let fixAffected = false;
        for (const ch of fix.channels) {
          const hasStrobeRange = ch.ranges && ch.ranges.some(r => r.type === 'strobe' || r.type === 'shutter_open');
          if (ch.type === 'strobe' || hasStrobeRange) {
            const mapped = mapShutterStrobeValue(activate ? strobeSpeed : 0, ch);
            channelUpdates[u].push({ ch: ch.dmx_address, val: mapped });
            fixAffected = true;
          }
        }
        if (fixAffected) strobeFixtureIds.push(fix.id);
      }

      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
      // Override strobe-affected fixtures so sequence doesn't fight
      setOs2lOverride(strobeFixtureIds, activate);
      broadcast({ type: 'os2l_action', action: 'strobe', map: map.name, active: activate });
      break;
    }

    case 'color':
    case 'color_preset': {
      const { red = 0, green = 0, blue = 0, white = 0, group_id } = actionData;
      if (activate) {
        touchOverrides.activeColorOverride = { red, green, blue, white, group_id };
      } else {
        touchOverrides.activeColorOverride = null;
      }
      // During sequence playback, recolor is applied in processSequenceAtTime (multicell patterns keep running).
      if (isAnySequencePlaying?.()) {
        broadcast({ type: 'os2l_action', action: 'color', map: map.name, active: activate });
        break;
      }
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      const colorFixtureIds = [];

      for (const fix of channelMap) {
        if (group_id && !(fix.group_ids || []).includes(group_id)) continue;
        if (touchOverrides?.disabledFixtures?.size) {
          const nid = Number(fix.id);
          if (touchOverrides.disabledFixtures.has(fix.id) || (Number.isFinite(nid) && touchOverrides.disabledFixtures.has(nid))) {
            continue;
          }
        }
        colorFixtureIds.push(fix.id);
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          const colorMap = { red, green, blue, white };
          if (colorMap[ch.type] !== undefined) {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? colorMap[ch.type] : 0 });
          } else if (ch.type === 'color_wheel' && fix.color_wheel_map && fix.color_wheel_map.length) {
            // Find nearest color wheel position for this RGB color
            if (activate) {
              let best = null, bestDist = Infinity;
              for (const entry of fix.color_wheel_map) {
                const hex = entry.color_hex;
                const cr = parseInt(hex.slice(1,3), 16);
                const cg = parseInt(hex.slice(3,5), 16);
                const cb = parseInt(hex.slice(5,7), 16);
                const dist = (cr-red)*(cr-red) + (cg-green)*(cg-green) + (cb-blue)*(cb-blue);
                if (dist < bestDist) { bestDist = dist; best = entry; }
              }
              channelUpdates[u].push({ ch: ch.dmx_address, val: best ? best.dmx_start : 0 });
            } else {
              channelUpdates[u].push({ ch: ch.dmx_address, val: 0 });
            }
          } else if (ch.type === 'dimmer' && activate) {
            channelUpdates[u].push({ ch: ch.dmx_address, val: 255 });
          } else if (ch.type === 'dimmer' && !activate) {
            channelUpdates[u].push({ ch: ch.dmx_address, val: 0 });
          }
        }
      }

      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
      broadcast({ type: 'os2l_action', action: 'color', map: map.name, active: activate });
      break;
    }

    case 'effect': {
      const { effect_id, group_id } = actionData;
      if (activate && effect_id) {
        const effect = db.getEffect(effect_id);
        if (effect) {
          const channelMap = db.getFixtureChannelMap();
          let fixtureIds = channelMap.map(f => f.id);
          if (group_id) {
            fixtureIds = channelMap.filter(f => (f.group_ids || []).includes(group_id)).map(f => f.id);
          }
          if (fixtureIds.length > 0) {
            const slot = getEffectSlot(effect.type);
            stopRunningEffect(slot, true);
            // Override effect-targeted fixtures so sequence doesn't fight
            setOs2lOverride(fixtureIds, true);
            const startTime = Date.now();
            const fixMap = channelMap;

            const timer = setInterval(() => {
              if (!getDmxOutputEnabled()) return;
              if (touchOverrides.blackoutHold || touchOverrides.fullOnHold) return;
              const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;
              const chUpdates = {};
              for (let fi = 0; fi < fixtureIds.length; fi++) {
                const fixtureId = fixtureIds[fi];
                const fix = fixMap.find(f => f.id === fixtureId);
                if (!fix || !isFixtureCompatibleWithEffect(effect, fix)) continue;
                for (const ch of fix.channels) {
                  let progress = effect.type === 'color_fade' ? (elapsed % 4) / 4 : elapsed;
                  const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };
                  const channelCtx = buildChannelCtx(ch, fix);
                  channelCtx._fixtureOrdinal = fi;
                  channelCtx._fixtureCount = fixtureIds.length;
                  channelCtx._rigFixtureCount = fixMap.length;
                  let value = computeEffectValue(effect, ch.type, progress, baseValues, {}, channelCtx);
                  if (value !== null && value !== undefined) {
                    if (!chUpdates[fix.universe]) chUpdates[fix.universe] = {};
                    let finalVal = Math.max(0, Math.min(255, Math.round(value)));
                    finalVal = applyTouchDimmerChain(finalVal, fix, ch.type);
                    chUpdates[fix.universe][ch.dmx_address] = applyInvert(finalVal, ch);
                  }
                }
              }
              for (const [u, chMap] of Object.entries(chUpdates)) {
                const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
                if (channels.length > 0) {
                  artnetServer.setChannels(+u, channels);
                  dmxUsbServer.setChannels(+u, channels);
                }
              }
            }, 25);
            runningQaEffects[slot] = { timer, effectId: effect_id, fixtureIds };
            console.log(`[OS2L] Started effect "${effect.name}" via button map`);
          }
        }
      } else {
        // Deactivate: release override for fixtures in all running effect slots
        for (const slot of Object.keys(runningQaEffects)) {
          const entry = runningQaEffects[slot];
          if (entry && entry.fixtureIds) setOs2lOverride(entry.fixtureIds, false);
        }
        stopRunningEffect(undefined, false);
      }
      broadcast({ type: 'os2l_action', action: 'effect', map: map.name, active: activate });
      break;
    }

    case 'scene_activate': {
      const { scene_id } = actionData;
      if (activate && scene_id) {
        // Override all fixtures — scene controls full rig
        setOs2lOverride(getAffectedFixtureIds(), true);
        activateScene(scene_id);
      } else {
        setOs2lOverride(getAffectedFixtureIds(), false);
        deactivateScene();
      }
      broadcast({ type: 'os2l_action', action: 'scene_activate', map: map.name, active: activate });
      break;
    }

    case 'master_dimmer': {
      const val = actionData.value !== undefined ? actionData.value : 255;
      if (activate) {
        touchOverrides.masterDimmer = val;
      } else {
        touchOverrides.masterDimmer = 255;
      }
      broadcast({ type: 'touchMasterDimmer', value: touchOverrides.masterDimmer });
      broadcast({ type: 'os2l_action', action: 'master_dimmer', map: map.name, active: activate });
      break;
    }

    case 'smoke':
    case 'haze': {
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      const smokeFixtureIds = [];
      for (const fix of channelMap) {
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          if (ch.type === 'smoke') {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? 255 : 0 });
            if (!smokeFixtureIds.includes(fix.id)) smokeFixtureIds.push(fix.id);
          }
        }
      }
      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
      setOs2lOverride(smokeFixtureIds, activate);
      broadcast({ type: 'os2l_action', action: map.action_type, map: map.name, active: activate });
      break;
    }

    case 'fire': {
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      const atmosphereFixtureIds = [];
      for (const fix of channelMap) {
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          if (ch.type === 'atmosphere') {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? 255 : 0 });
            if (!atmosphereFixtureIds.includes(fix.id)) atmosphereFixtureIds.push(fix.id);
          }
        }
      }
      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
      for (const id of atmosphereFixtureIds) {
        if (activate) touchOverrides.atmosphereOverrideFixtures.add(id);
        else touchOverrides.atmosphereOverrideFixtures.delete(id);
      }
      setOs2lOverride(atmosphereFixtureIds, activate);
      broadcast({ type: 'os2l_action', action: map.action_type, map: map.name, active: activate });
      break;
    }

    default:
      console.warn(`[OS2L] Unknown action type: ${map.action_type}`);
  }
}

// ─── API Route Registration ─────────────────────────────────────────────────

/**
 * Register OS2L button-map REST routes on the Express app.
 * @param {express.Application} app
 */
function registerRoutes(app) {
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
    handleButtonAction({ name: map.os2l_value, button: map.os2l_value, state: 1 });
    res.json({ ok: true, tested: map.name });
  });

  app.get('/api/os2l-button-maps/active-toggles', (req, res) => {
    res.json([...activeToggles]);
  });
}

// ─── Public API ─────────────────────────────────────────────────────────────

module.exports = {
  init,
  startServer,
  stopServer,
  sendSubscription,
  parseTrigger,
  normalizeSubscribedValue,
  drainJsonObjects,
  handleButtonAction,
  registerRoutes,
  getActiveToggles: () => [...activeToggles],
  getServer: () => os2lServer,
  isConnected: () => !!activeVdjSocket && !activeVdjSocket.destroyed,
};
