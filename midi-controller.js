/**
 * MIDI Controller Module — Akai APC Mini mk2 Integration
 *
 * Connects to an Akai APC Mini mk2 (or compatible MIDI controller) and maps
 * buttons and faders to DMX actions (blackout, color, effects, scenes,
 * strobe, dimmer, etc.).
 *
 * Follows the same dependency-injection pattern as os2l.js.
 *
 * APC Mini mk2 MIDI Map:
 *   Notes 0x00-0x3F (0-63)   : 8×8 pad matrix (RGB LEDs)
 *   Notes 0x64-0x6B (100-107): bottom track buttons (single-color LEDs)
 *   Notes 0x70-0x77 (112-119): right scene-launch buttons
 *   Note 0x7A (122)          : Shift button
 *   CC 48-56                 : Faders 1-9 (0-127)
 *
 * LED feedback:
 *   Pad matrix (notes 0-63): Note On velocity = color palette index (0-127)
 *     See VELOCITY_COLORS for the full 128-color palette.
 *     For full RGB control, use SysEx: F0 47 7F 4F 24 ... F7
 *   Track/Scene buttons: Note On channel determines color:
 *     Ch 0 = off, Ch 1-6 = colors (single-color LEDs)
 *
 * Usage:
 *   const midiController = require('./midi-controller');
 *   midiController.init({ db, broadcast, state, ... });
 *   midiController.start();
 */

let JZZ;
try {
  JZZ = require('jzz');
} catch (e) {
  console.warn('[MIDI] jzz module not available — MIDI controller disabled');
}

// ─── APC Mini mk2 LED Color Constants (Velocity Palette) ────────────────────
// The mk2 pad LEDs use velocity 0-127 as an index into a fixed color palette.
// These are the most useful color indices from the palette.

const LED = {
  OFF:            0,   // #000000 — black/off
  DIM_GRAY:       1,   // #1E1E1E
  GRAY:           2,   // #7F7F7F
  WHITE:          3,   // #FFFFFF
  LIGHT_RED:      4,   // #FF4C4C
  RED:            5,   // #FF0000
  DARK_RED:       6,   // #590000
  ORANGE:         8,   // #FFBD6C
  BRIGHT_ORANGE:  9,   // #FF5400
  DARK_ORANGE:   10,   // #591D00
  LIGHT_YELLOW:  12,   // #FFFF4C
  YELLOW:        13,   // #FFFF00
  DARK_YELLOW:   14,   // #595900
  LIME:          16,   // #88FF4C
  BRIGHT_GREEN:  17,   // #54FF00
  DARK_GREEN:    18,   // #1D5900
  GREEN:         21,   // #00FF00
  SPRING_GREEN:  25,   // #00FF19
  CYAN:          33,   // #00FF99
  LIGHT_BLUE:    36,   // #4CC3FF
  SKY_BLUE:      37,   // #00A9FF
  BLUE:          45,   // #0000FF
  DARK_BLUE:     43,   // #000819
  PURPLE:        48,   // #874CFF
  BRIGHT_PURPLE: 49,   // #5400FF
  MAGENTA:       53,   // #FF00FF
  PINK:          56,   // #FF4C87
  HOT_PINK:      57,   // #FF0054
  ROSE:          58,   // #59001D
  WARM_WHITE:    60,   // #FF1500
};

// Full velocity-to-RGB color palette (0-127) from the APC mini mk2 docs
const VELOCITY_COLORS = [
  '#000000', '#1E1E1E', '#7F7F7F', '#FFFFFF',  //  0- 3
  '#FF4C4C', '#FF0000', '#590000', '#190000',  //  4- 7
  '#FFBD6C', '#FF5400', '#591D00', '#271B00',  //  8-11
  '#FFFF4C', '#FFFF00', '#595900', '#191900',  // 12-15
  '#88FF4C', '#54FF00', '#1D5900', '#142B00',  // 16-19
  '#4CFF4C', '#00FF00', '#005900', '#001900',  // 20-23
  '#4CFF5E', '#00FF19', '#00590D', '#001902',  // 24-27
  '#4CFF88', '#00FF55', '#00591D', '#001912',  // 28-31
  '#4CFFB7', '#00FF99', '#005935', '#001912',  // 32-35
  '#4CC3FF', '#00A9FF', '#004152', '#001019',  // 36-39
  '#4C88FF', '#0055FF', '#001D59', '#000819',  // 40-43
  '#4C4CFF', '#0000FF', '#000059', '#000019',  // 44-47
  '#874CFF', '#5400FF', '#190059', '#0F0030',  // 48-51
  '#FF4CFF', '#FF00FF', '#590059', '#190019',  // 52-55
  '#FF4C87', '#FF0054', '#59001D', '#190013',  // 56-59
  '#FF1500', '#993500', '#795100', '#436400',  // 60-63
  '#033900', '#005735', '#001D52', '#000F60',  // 64-67
  '#0F0030', '#3A0018', '#7A0000', '#3E4100',  // 68-71
  '#003A00', '#005432', '#001C3E', '#180046',  // 72-75
  '#3A001C', '#290000', '#0F2B00', '#003100',  // 76-79
  '#00310F', '#001931', '#0D0031', '#310017',  // 80-83
  '#4CFF4C', '#00FF00', '#004C00', '#001200',  // 84-87
  '#4CFFCC', '#00FF66', '#004C19', '#001204',  // 88-91
  '#006459', '#002819', '#3F0064', '#280046',  // 92-95
  '#643F00', '#4C2800', '#191900', '#640000',  // 96-99
  '#4C0000', '#003200', '#001900', '#001932',  //100-103
  '#000064', '#004C4C', '#4C004C', '#190064',  //104-107
  '#4C0032', '#640019', '#321900', '#193200',  //108-111
  '#003219', '#001964', '#320064', '#640032',  //112-115
  '#640000', '#640032', '#640064', '#320064',  //116-119
  '#006464', '#003232', '#326400', '#643200',  //120-123
  '#644C00', '#644C32', '#644C64', '#4C4C64',  //124-127
];

// ─── APC Mini mk2 Layout Constants ──────────────────────────────────────────

const GRID_NOTES       = { min: 0x00, max: 0x3F };   // 8×8 pad matrix (0-63)
const BOTTOM_ROW_NOTES = { min: 0x64, max: 0x6B };   // 8 track buttons (100-107)
const RIGHT_COL_NOTES  = { min: 0x70, max: 0x77 };   // 8 scene-launch buttons (112-119)
const SHIFT_NOTE       = 0x7A;                        // Shift button (122)
const FADER_CC         = { min: 48, max: 56 };        // 9 faders

// SysEx header for APC mini mk2 RGB pad control
const SYSEX_HEADER     = [0xF0, 0x47, 0x7F, 0x4F, 0x24];
const SYSEX_END        = 0xF7;

// LED behavior modes — the mk2 uses the MIDI channel to control LED behavior.
// Sending a Note On on different channels produces different visual effects.
const LED_BEHAVIOR = {
  STATIC:          0,   // Ch  0: solid color (100%)
  PULSING_1_4:     1,   // Ch  1: pulsing quarter speed
  PULSING_1_2:     2,   // Ch  2: pulsing half speed
  PULSING:         3,   // Ch  3: pulsing normal speed
  PULSING_2X:      4,   // Ch  4: pulsing double speed
  BLINKING_1_4:    5,   // Ch  5: blinking quarter speed
  BLINKING_1_2:    6,   // Ch  6: blinking half speed
  BLINKING:        7,   // Ch  7: blinking normal speed
  BLINKING_2X:     8,   // Ch  8: blinking double speed
  BLINKING_4X:     9,   // Ch  9: blinking quadruple speed
};

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
let applyInvert;

// ─── State ──────────────────────────────────────────────────────────────────

let midiInput = null;
let midiOutput = null;
let midiEngine = null;
let connected = false;
let shiftHeld = false;
let currentDeviceName = '';

// Active toggle states for buttons
const activeToggles = new Set();   // set of mapping IDs currently "on"

// Running effects started by MIDI (slot → { timer, effectId, fixtureIds })
const midiRunningEffects = {};

// ─── Initialise ─────────────────────────────────────────────────────────────

/**
 * Inject dependencies from the main server (same pattern as os2l.js).
 * @param {object} deps
 */
function init(deps) {
  db             = deps.db;
  broadcast      = deps.broadcast;
  state          = deps.state;
  artnetServer   = deps.artnetServer;
  dmxUsbServer   = deps.dmxUsbServer;
  touchOverrides = deps.touchOverrides;
  runningQaEffects = deps.runningQaEffects;
  getDmxOutputEnabled      = deps.getDmxOutputEnabled;
  getEffectSlot            = deps.getEffectSlot;
  stopRunningEffect        = deps.stopRunningEffect;
  activateScene            = deps.activateScene;
  deactivateScene          = deps.deactivateScene;
  buildChannelCtx          = deps.buildChannelCtx;
  computeEffectValue       = deps.computeEffectValue;
  isFixtureCompatibleWithEffect = deps.isFixtureCompatibleWithEffect;
  applyMasterDimmer        = deps.applyMasterDimmer;
  applyInvert              = deps.applyInvert;
}

// ─── Device Discovery ───────────────────────────────────────────────────────

/**
 * List available MIDI input/output ports.
 * @returns {{ inputs: string[], outputs: string[] }}
 */
function listPorts() {
  if (!JZZ) return { inputs: [], outputs: [] };
  try {
    const info = JZZ().info();
    return {
      inputs:  (info.inputs  || []).map(p => p.name),
      outputs: (info.outputs || []).map(p => p.name),
    };
  } catch (e) {
    console.error('[MIDI] Error listing ports:', e.message);
    return { inputs: [], outputs: [] };
  }
}

// ─── Connection ─────────────────────────────────────────────────────────────

/**
 * Open the MIDI device. Tries to find an APC Mini by name, or uses the
 * device name stored in config.
 */
async function start() {
  if (!JZZ) {
    console.warn('[MIDI] jzz not available — skipping MIDI init');
    return;
  }

  const enabled = db.getConfig('midi_enabled');
  if (enabled === '0') {
    console.log('[MIDI] MIDI controller disabled in config');
    return;
  }

  const configDevice = db.getConfig('midi_device_name') || '';

  try {
    midiEngine = JZZ({ sysex: true });
    await midiEngine;

    const info = midiEngine.info();
    const inputPorts  = (info.inputs  || []).map(p => p.name);
    const outputPorts = (info.outputs || []).map(p => p.name);

    console.log(`[MIDI] Available inputs:  ${inputPorts.join(', ') || '(none)'}`);
    console.log(`[MIDI] Available outputs: ${outputPorts.join(', ') || '(none)'}`);

    // Find the best matching port
    let inputName  = null;
    let outputName = null;

    // Priority 1: exact config match
    if (configDevice) {
      inputName  = inputPorts.find(n => n === configDevice);
      outputName = outputPorts.find(n => n === configDevice);
    }

    // Priority 2: look for APC Mini by name
    if (!inputName) {
      inputName  = inputPorts.find(n => /apc\s*mini/i.test(n));
      outputName = outputPorts.find(n => /apc\s*mini/i.test(n));
    }

    if (!inputName) {
      console.log('[MIDI] No APC Mini found — MIDI controller not connected');
      broadcast({ type: 'midi_status', connected: false, device: null, availablePorts: inputPorts });
      return;
    }

    midiInput = midiEngine.openMidiIn(inputName);
    if (outputName) {
      midiOutput = midiEngine.openMidiOut(outputName);
    }

    connected = true;
    currentDeviceName = inputName;
    db.setConfig('midi_device_name', inputName);

    console.log(`[MIDI] Connected to "${inputName}"`);
    broadcast({ type: 'midi_status', connected: true, device: inputName });

    // Set up message handlers
    midiInput.connect(handleMidiMessage);

    // Initialise LED state from current mappings
    refreshAllLeds();

  } catch (e) {
    console.error('[MIDI] Failed to start:', e.message);
    connected = false;
    broadcast({ type: 'midi_status', connected: false, error: e.message });
  }
}

/**
 * Disconnect the MIDI device.
 */
function stop() {
  try {
    if (midiInput) {
      midiInput.disconnect(handleMidiMessage);
      midiInput.close();
    }
    if (midiOutput) midiOutput.close();
    if (midiEngine) midiEngine.close();
  } catch (e) {
    // Ignore close errors
  }
  midiInput = null;
  midiOutput = null;
  midiEngine = null;
  connected = false;
  currentDeviceName = '';
  console.log('[MIDI] Disconnected');
  broadcast({ type: 'midi_status', connected: false, device: null });
}

/**
 * Reconnect (e.g. after config change).
 */
async function reconnect() {
  stop();
  await start();
}

// ─── LED Control ────────────────────────────────────────────────────────────

/**
 * Check if a note is a pad (RGB LED) vs a button (single-color LED).
 * Pads are 0x00-0x3F, buttons are 0x64+ (track/scene).
 */
function isPadNote(note) {
  return note >= GRID_NOTES.min && note <= GRID_NOTES.max;
}

/**
 * Set a single LED on the APC Mini mk2.
 * For pads (notes 0-63): velocity = color palette index (0-127).
 * For buttons (notes 100+): uses Note On with velocity 127 on appropriate channel.
 * The MIDI channel controls LED behavior (0=static, 1-4=pulsing, 5-9=blinking).
 * @param {number} note - MIDI note number
 * @param {number} color - velocity/color palette index (0-127)
 * @param {number} [behavior=0] - LED behavior mode (MIDI channel 0-9)
 */
function setLed(note, color, behavior) {
  if (!midiOutput) return;
  try {
    const ch = (behavior || 0) & 0x0F;
    midiOutput.send([0x90 | ch, note, color & 0x7F]);
  } catch (e) { /* ignore */ }
}

/**
 * Set a pad LED to a specific RGB color using SysEx.
 * Only works for pad matrix notes 0x00-0x3F.
 * @param {number} pad - Pad number (0-63)
 * @param {number} r - Red 0-255
 * @param {number} g - Green 0-255
 * @param {number} b - Blue 0-255
 */
function setLedRGB(pad, r, g, b) {
  if (!midiOutput) return;
  if (pad < 0 || pad > 63) return;
  try {
    // Convert 8-bit color to two 7-bit MIDI bytes (MSB, LSB)
    const rMSB = (r >> 1) & 0x7F;
    const rLSB = (r & 0x01) ? 0x7F : 0x00;
    const gMSB = (g >> 1) & 0x7F;
    const gLSB = (g & 0x01) ? 0x7F : 0x00;
    const bMSB = (b >> 1) & 0x7F;
    const bLSB = (b & 0x01) ? 0x7F : 0x00;

    // Data bytes: start_pad, end_pad, R_MSB, R_LSB, G_MSB, G_LSB, B_MSB, B_LSB
    const dataBytes = [pad, pad, rMSB, rLSB, gMSB, gLSB, bMSB, bLSB];
    const totalDataBytes = dataBytes.length;
    const totalMSB = (totalDataBytes >> 7) & 0x7F;
    const totalLSB = totalDataBytes & 0x7F;

    const sysex = [...SYSEX_HEADER, totalMSB, totalLSB, ...dataBytes, SYSEX_END];
    midiOutput.send(sysex);
  } catch (e) { /* ignore */ }
}

/**
 * Set multiple pad LEDs to RGB colors in a single SysEx message.
 * @param {number} startPad - First pad (0-63)
 * @param {number} endPad - Last pad (0-63)
 * @param {Array<{r:number, g:number, b:number}>} colors - Array of RGB objects
 */
function setLedRGBRange(startPad, endPad, colors) {
  if (!midiOutput) return;
  if (startPad < 0 || endPad > 63 || startPad > endPad) return;
  try {
    const dataBytes = [startPad, endPad];
    for (const c of colors) {
      dataBytes.push((c.r >> 1) & 0x7F, (c.r & 0x01) ? 0x7F : 0x00);
      dataBytes.push((c.g >> 1) & 0x7F, (c.g & 0x01) ? 0x7F : 0x00);
      dataBytes.push((c.b >> 1) & 0x7F, (c.b & 0x01) ? 0x7F : 0x00);
    }
    const totalDataBytes = dataBytes.length;
    const totalMSB = (totalDataBytes >> 7) & 0x7F;
    const totalLSB = totalDataBytes & 0x7F;

    const sysex = [...SYSEX_HEADER, totalMSB, totalLSB, ...dataBytes, SYSEX_END];
    midiOutput.send(sysex);
  } catch (e) { /* ignore */ }
}

/**
 * Clear all LEDs on the APC Mini mk2.
 */
function clearAllLeds() {
  if (!midiOutput) return;
  // Clear pad matrix (0-63)
  for (let n = 0; n <= 63; n++) {
    setLed(n, LED.OFF);
  }
  // Clear track buttons (100-107)
  for (let n = 0x64; n <= 0x6B; n++) {
    setLed(n, LED.OFF);
  }
  // Clear scene buttons (112-119)
  for (let n = 0x70; n <= 0x77; n++) {
    setLed(n, LED.OFF);
  }
}

/**
 * Refresh all LEDs based on current mapping state.
 */
function refreshAllLeds() {
  if (!midiOutput) return;
  clearAllLeds();

  const mappings = db.getMidiMappings();
  for (const m of mappings) {
    if (!m.enabled) continue;
    const isActive = activeToggles.has(m.id);
    const color = isActive ? (m.led_active_color || LED.GREEN) : (m.led_color || LED.YELLOW);
    const behavior = isActive ? (m.led_active_behavior || 0) : (m.led_behavior || 0);
    if (m.midi_type === 'note') {
      setLed(m.midi_number, color, behavior);
    }
  }
}

// ─── MIDI Message Handler ───────────────────────────────────────────────────

function handleMidiMessage(msg) {
  if (!msg || msg.length < 2) return;

  const status  = msg[0] & 0xF0;
  const channel = msg[0] & 0x0F;
  const data1   = msg[1];         // note number or CC number
  const data2   = msg.length > 2 ? msg[2] : 0; // velocity or CC value

  // Note On (0x90) with velocity > 0, or Note Off (0x80 or velocity 0)
  if (status === 0x90 || status === 0x80) {
    const isNoteOn = status === 0x90 && data2 > 0;
    handleNoteMessage(data1, isNoteOn, data2);
  }
  // Control Change (0xB0) — faders
  else if (status === 0xB0) {
    handleCCMessage(data1, data2);
  }

  // Broadcast raw MIDI for the log / debug
  broadcast({
    type: 'midi_message',
    status: status.toString(16),
    channel,
    data1,
    data2,
    note: (status === 0x90 || status === 0x80) ? data1 : undefined,
    cc: status === 0xB0 ? data1 : undefined,
    value: data2,
    ts: Date.now(),
  });
}

// ─── Note Handler ───────────────────────────────────────────────────────────

function handleNoteMessage(note, isOn, velocity) {
  // Shift button tracking
  if (note === SHIFT_NOTE) {
    shiftHeld = isOn;
    broadcast({ type: 'midi_shift', held: shiftHeld });
    return;
  }

  // Determine region (mk2 note ranges)
  let region;
  if (note >= GRID_NOTES.min && note <= GRID_NOTES.max) {
    region = 'grid';
  } else if (note >= BOTTOM_ROW_NOTES.min && note <= BOTTOM_ROW_NOTES.max) {
    region = 'bottom';
  } else if (note >= RIGHT_COL_NOTES.min && note <= RIGHT_COL_NOTES.max) {
    region = 'right';
  } else {
    return;
  }

  // Find matching mapping
  const mappings = db.getEnabledMidiMappings();
  let matched = false;

  for (const mapping of mappings) {
    if (mapping.midi_type !== 'note') continue;
    if (mapping.midi_number !== note) continue;

    matched = true;
    executeMidiAction(mapping, isOn);
  }

  // Auto-create disabled placeholder for unmapped buttons (like OS2L does)
  if (!matched && isOn) {
    const allMappings = db.getMidiMappings();
    const exists = allMappings.some(m => m.midi_type === 'note' && m.midi_number === note);
    if (!exists) {
      const row = Math.floor(note / 8);
      const col = note % 8;
      let label;
      if (region === 'grid') label = `Grid ${row + 1}:${col + 1}`;
      else if (region === 'bottom') label = `Track ${note - BOTTOM_ROW_NOTES.min + 1}`;
      else if (region === 'right') label = `Scene ${note - RIGHT_COL_NOTES.min + 1}`;
      else label = `Note ${note}`;

      const newMapping = db.createMidiMapping({
        name: label,
        midi_type: 'note',
        midi_number: note,
        midi_channel: 0,
        action_type: 'none',
        action_data: '{}',
        toggle_mode: 'momentary',
        led_color: LED.OFF,
        led_active_color: LED.GREEN,
        enabled: 0,
      });
      if (newMapping && !newMapping.error) {
        console.log(`[MIDI] Auto-created placeholder mapping "${label}" (note ${note}, disabled)`);
        broadcast({ type: 'midi_mapping_created', mapping: newMapping });
      }
    }
  }

  // Flash the button on press if no mapping (visual feedback)
  if (!matched && isOn) {
    setLed(note, LED.RED);
    setTimeout(() => setLed(note, LED.OFF), 200);
  }
}

// ─── CC Handler (Faders) ────────────────────────────────────────────────────

function handleCCMessage(cc, value) {
  if (cc < FADER_CC.min || cc > FADER_CC.max) return;

  const faderIndex = cc - FADER_CC.min; // 0-8

  // Find matching mapping
  const mappings = db.getEnabledMidiMappings();
  let matched = false;

  for (const mapping of mappings) {
    if (mapping.midi_type !== 'cc') continue;
    if (mapping.midi_number !== cc) continue;

    matched = true;
    executeFaderAction(mapping, value);
  }

  // Default fader behaviour when not mapped:
  // Fader 9 (CC 56, index 8) → Master Dimmer
  // Fader 8 (CC 55, index 7) → Effect Speed
  if (!matched) {
    if (faderIndex === 8) {
      // Master dimmer: scale 0-127 → 0-255
      const dimVal = Math.round((value / 127) * 255);
      touchOverrides.masterDimmer = dimVal;
      broadcast({ type: 'masterDimmer', value: dimVal });
    } else if (faderIndex === 7) {
      // Effect speed: scale 0-127 → 0.1-3.0
      const speed = 0.1 + (value / 127) * 2.9;
      touchOverrides.effectSpeed = Math.round(speed * 100) / 100;
      broadcast({ type: 'effectSpeed', value: touchOverrides.effectSpeed });
    }
  }

  broadcast({ type: 'midi_fader', fader: faderIndex, value, cc });
}

// ─── Action Execution ───────────────────────────────────────────────────────

/**
 * Execute a mapped action for a button press/release.
 */
function executeMidiAction(mapping, isOn) {
  let actionData;
  try {
    actionData = JSON.parse(mapping.action_data || '{}');
  } catch (e) {
    actionData = {};
  }

  const toggleMode = mapping.toggle_mode || 'momentary';
  let activate;

  if (toggleMode === 'toggle') {
    // Toggle: flip on press, ignore release
    if (!isOn) return;
    if (activeToggles.has(mapping.id)) {
      activeToggles.delete(mapping.id);
      activate = false;
    } else {
      activeToggles.add(mapping.id);
      activate = true;
    }
  } else {
    // Momentary: on while pressed, off on release
    activate = isOn;
    if (isOn) activeToggles.add(mapping.id);
    else activeToggles.delete(mapping.id);
  }

  const dmxOutputEnabled = getDmxOutputEnabled();
  const label = activate ? 'ON' : 'OFF';
  console.log(`[MIDI] "${mapping.name}" → ${mapping.action_type} [${label}]`);

  // Update LED
  if (midiOutput && mapping.midi_type === 'note') {
    const ledColor = activate ? (mapping.led_active_color || LED.GREEN) : (mapping.led_color || LED.YELLOW);
    const ledBehavior = activate ? (mapping.led_active_behavior || 0) : (mapping.led_behavior || 0);
    setLed(mapping.midi_number, ledColor, ledBehavior);
  }

  switch (mapping.action_type) {
    case 'none':
      break;

    case 'blackout':
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
      broadcast({ type: 'midi_action', action: 'blackout', mapping: mapping.name, active: activate });
      broadcast({ type: 'touchBlackoutHold', active: activate });
      break;

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
          if (ch.type === 'strobe') {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? strobeSpeed : 0 });
            fixAffected = true;
          } else if (ch.ranges) {
            const strobeRange = ch.ranges.find(r => r.type === 'strobe');
            if (strobeRange) {
              const mapped = activate
                ? Math.round(strobeRange.min + (strobeSpeed / 255) * (strobeRange.max - strobeRange.min))
                : 0;
              channelUpdates[u].push({ ch: ch.dmx_address, val: mapped });
              fixAffected = true;
            }
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
      setOverride(strobeFixtureIds, activate);
      broadcast({ type: 'midi_action', action: 'strobe', mapping: mapping.name, active: activate });
      break;
    }

    case 'color': {
      const { red = 0, green = 0, blue = 0, white = 0, group_id } = actionData;
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      const colorFixtureIds = [];

      for (const fix of channelMap) {
        if (group_id && !(fix.group_ids || []).includes(group_id)) continue;
        colorFixtureIds.push(fix.id);
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          const colorMap = { red, green, blue, white };
          if (colorMap[ch.type] !== undefined) {
            channelUpdates[u].push({ ch: ch.dmx_address, val: activate ? colorMap[ch.type] : 0 });
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
      setOverride(colorFixtureIds, activate);
      broadcast({ type: 'midi_action', action: 'color', mapping: mapping.name, active: activate });
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
            setOverride(fixtureIds, true);
            const startTime = Date.now();
            const fixMap = channelMap;

            const timer = setInterval(() => {
              if (!getDmxOutputEnabled()) return;
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
                    const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
                    if (fixHasDimmer) {
                      if (ch.type === 'dimmer') finalVal = applyMasterDimmer(finalVal, ch.type);
                    } else {
                      finalVal = applyMasterDimmer(finalVal, ch.type);
                    }
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
            midiRunningEffects[slot] = { timer, effectId: effect_id, fixtureIds };
            console.log(`[MIDI] Started effect "${effect.name}" via MIDI mapping`);
          }
        }
      } else {
        // Deactivate: release override for MIDI-started effects
        for (const slot of Object.keys(midiRunningEffects)) {
          const entry = midiRunningEffects[slot];
          if (entry && entry.fixtureIds) setOverride(entry.fixtureIds, false);
          delete midiRunningEffects[slot];
        }
        stopRunningEffect(undefined, false);
      }
      broadcast({ type: 'midi_action', action: 'effect', mapping: mapping.name, active: activate });
      break;
    }

    case 'scene_activate': {
      const { scene_id } = actionData;
      if (activate && scene_id) {
        setOverride(getAffectedFixtureIds(), true);
        activateScene(scene_id);
      } else {
        setOverride(getAffectedFixtureIds(), false);
        deactivateScene();
      }
      broadcast({ type: 'midi_action', action: 'scene_activate', mapping: mapping.name, active: activate });
      break;
    }

    case 'set_channels': {
      const universe = actionData.universe || 1;
      const channels = actionData.channels || [];
      setOverride(getAffectedFixtureIds(), activate);
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
      broadcast({ type: 'midi_action', action: 'set_channels', mapping: mapping.name, active: activate });
      break;
    }

    case 'full_on': {
      const universe = actionData.universe || 1;
      const val = activate ? 255 : 0;
      setOverride(getAffectedFixtureIds(), activate);
      const ch = [];
      for (let i = 1; i <= 512; i++) ch.push({ ch: i, val });
      if (dmxOutputEnabled) {
        artnetServer.setChannels(universe, ch);
        dmxUsbServer.setChannels(universe, ch);
      }
      broadcast({ type: 'midi_action', action: 'full_on', mapping: mapping.name, active: activate });
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
      broadcast({ type: 'midi_action', action: 'master_dimmer', mapping: mapping.name, active: activate });
      break;
    }

    default:
      console.warn(`[MIDI] Unknown action type: ${mapping.action_type}`);
  }
}

/**
 * Execute a fader action (CC message).
 */
function executeFaderAction(mapping, value) {
  let actionData;
  try {
    actionData = JSON.parse(mapping.action_data || '{}');
  } catch (e) {
    actionData = {};
  }

  const dmxOutputEnabled = getDmxOutputEnabled();

  switch (mapping.action_type) {
    case 'master_dimmer': {
      // Scale 0-127 → 0-255
      const dimVal = Math.round((value / 127) * 255);
      touchOverrides.masterDimmer = dimVal;
      broadcast({ type: 'masterDimmer', value: dimVal });
      break;
    }

    case 'effect_speed': {
      // Scale 0-127 → 0.1-3.0
      const speed = 0.1 + (value / 127) * 2.9;
      touchOverrides.effectSpeed = Math.round(speed * 100) / 100;
      broadcast({ type: 'effectSpeed', value: touchOverrides.effectSpeed });
      break;
    }

    case 'group_dimmer': {
      const { group_id } = actionData;
      if (!group_id) break;
      const dimVal = Math.round((value / 127) * 255);
      const channelMap = db.getFixtureChannelMap();
      const channelUpdates = {};

      for (const fix of channelMap) {
        if (!(fix.group_ids || []).includes(group_id)) continue;
        const u = fix.universe;
        if (!channelUpdates[u]) channelUpdates[u] = [];
        for (const ch of fix.channels) {
          if (ch.type === 'dimmer') {
            channelUpdates[u].push({ ch: ch.dmx_address, val: dimVal });
          }
        }
      }
      if (dmxOutputEnabled) {
        for (const [u, channels] of Object.entries(channelUpdates)) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
      broadcast({ type: 'midi_fader_action', action: 'group_dimmer', group_id, value: dimVal });
      break;
    }

    case 'channel': {
      // Direct channel control
      const { universe = 1, channel } = actionData;
      if (!channel) break;
      const dmxVal = Math.round((value / 127) * 255);
      if (dmxOutputEnabled) {
        artnetServer.setChannels(universe, [{ ch: channel, val: dmxVal }]);
        dmxUsbServer.setChannels(universe, [{ ch: channel, val: dmxVal }]);
      }
      break;
    }

    default:
      break;
  }
}

// ─── Override Helpers ────────────────────────────────────────────────────────

function setOverride(fixtureIds, activate) {
  if (activate) {
    for (const id of fixtureIds) touchOverrides.os2lOverrideFixtures.add(id);
  } else {
    for (const id of fixtureIds) touchOverrides.os2lOverrideFixtures.delete(id);
  }
}

function getAffectedFixtureIds(groupId) {
  const channelMap = db.getFixtureChannelMap();
  if (groupId) {
    return channelMap.filter(f => (f.group_ids || []).includes(groupId)).map(f => f.id);
  }
  return channelMap.map(f => f.id);
}

// ─── API Route Registration ─────────────────────────────────────────────────

/**
 * Register MIDI controller REST routes on the Express app.
 * @param {express.Application} app
 */
function registerRoutes(app) {

  // ── Status ──────────────────────────────────────────────────────────────
  app.get('/api/midi/status', (req, res) => {
    let ports = { inputs: [], outputs: [] };
    try { ports = listPorts(); } catch (e) { /* ignore */ }
    res.json({
      connected,
      device: currentDeviceName,
      shiftHeld,
      availablePorts: ports,
      enabled: db.getConfig('midi_enabled') !== '0',
    });
  });

  app.post('/api/midi/connect', async (req, res) => {
    const { device } = req.body || {};
    if (device) db.setConfig('midi_device_name', device);
    db.setConfig('midi_enabled', '1');
    await reconnect();
    res.json({ connected, device: currentDeviceName });
  });

  app.post('/api/midi/disconnect', (req, res) => {
    stop();
    res.json({ connected: false });
  });

  app.get('/api/midi/ports', (req, res) => {
    res.json(listPorts());
  });

  // ── Mappings CRUD ───────────────────────────────────────────────────────
  app.get('/api/midi/mappings', (req, res) => {
    res.json(db.getMidiMappings());
  });

  app.get('/api/midi/mappings/:id', (req, res) => {
    const m = db.getMidiMapping(+req.params.id);
    m ? res.json(m) : res.status(404).json({ error: 'Not found' });
  });

  app.post('/api/midi/mappings', (req, res) => {
    const result = db.createMidiMapping(req.body);
    if (result.error) return res.status(400).json(result);
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.status(201).json(result);
  });

  app.put('/api/midi/mappings/:id', (req, res) => {
    const result = db.updateMidiMapping(+req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error) return res.status(400).json(result);
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json(result);
  });

  app.delete('/api/midi/mappings/:id', (req, res) => {
    db.deleteMidiMapping(+req.params.id);
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json({ deleted: true });
  });

  app.post('/api/midi/mappings/:id/toggle', (req, res) => {
    const result = db.toggleMidiMapping(+req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json(result);
  });

  // ── MIDI Learn ──────────────────────────────────────────────────────────
  // Returns the next MIDI message received (for mapping assignment)
  let learnResolve = null;
  let learnTimeout = null;

  app.post('/api/midi/learn', (req, res) => {
    if (!connected) return res.status(400).json({ error: 'MIDI not connected' });

    // Cancel previous learn if any
    if (learnResolve) {
      learnResolve({ error: 'Cancelled' });
      clearTimeout(learnTimeout);
    }

    const promise = new Promise((resolve) => {
      learnResolve = resolve;
      learnTimeout = setTimeout(() => {
        learnResolve = null;
        resolve({ error: 'Timeout' });
      }, 10000); // 10 second timeout
    });

    // Temporarily intercept next message
    const origHandler = handleMidiMessage;
    const learnHandler = (msg) => {
      if (!msg || msg.length < 2) return;
      const status = msg[0] & 0xF0;
      const data1 = msg[1];
      const data2 = msg.length > 2 ? msg[2] : 0;

      // Only capture Note On or CC
      if ((status === 0x90 && data2 > 0) || status === 0xB0) {
        const type = status === 0xB0 ? 'cc' : 'note';
        if (learnResolve) {
          clearTimeout(learnTimeout);
          learnResolve({ type, number: data1, channel: msg[0] & 0x0F, value: data2 });
          learnResolve = null;
        }
        // Restore normal handler
        midiInput.disconnect(learnHandler);
        midiInput.connect(handleMidiMessage);
      }
    };

    midiInput.disconnect(handleMidiMessage);
    midiInput.connect(learnHandler);

    promise.then(result => res.json(result));
  });

  app.post('/api/midi/learn/cancel', (req, res) => {
    if (learnResolve) {
      clearTimeout(learnTimeout);
      learnResolve({ error: 'Cancelled' });
      learnResolve = null;
    }
    res.json({ ok: true });
  });

  // ── Test a mapping ──────────────────────────────────────────────────────
  app.post('/api/midi/mappings/test/:id', (req, res) => {
    const mapping = db.getMidiMapping(+req.params.id);
    if (!mapping) return res.status(404).json({ error: 'Not found' });
    executeMidiAction(mapping, true);
    // Auto-deactivate after 500ms for momentary feel
    setTimeout(() => executeMidiAction(mapping, false), 500);
    res.json({ ok: true, tested: mapping.name });
  });

  // ── LED control ─────────────────────────────────────────────────────────
  app.post('/api/midi/led', (req, res) => {
    const { note, color } = req.body;
    setLed(note, color);
    res.json({ ok: true });
  });

  app.post('/api/midi/leds/clear', (req, res) => {
    clearAllLeds();
    res.json({ ok: true });
  });

  app.post('/api/midi/leds/refresh', (req, res) => {
    refreshAllLeds();
    res.json({ ok: true });
  });

  // ── Preset layouts ────────────────────────────────────────────────────
  app.post('/api/midi/presets/default', async (req, res) => {
    createDefaultMappings();
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json({ ok: true, message: 'Default APC Mini mappings created' });
  });
}

// ─── Default Mapping Presets ────────────────────────────────────────────────

/**
 * Create a sensible default mapping for the APC Mini mk2.
 *
 * Grid layout (8×8 RGB pads, rows 0-7 bottom to top):
 *   Row 7 (notes 56-63): Static colors (Red, Orange, Yellow, Green, Cyan, Blue, Magenta, White)
 *   Row 6 (notes 48-55): Mover effects (circles, pans, tilts, figure-8, fan, nod)
 *   Row 5 (notes 40-47): Rig effects 2 (color waves, converge, rainbow, alternate)
 *   Row 4 (notes 32-39): Rig effects 1 (chases, sweeps)
 *   Row 3 (notes 24-31): Comets, scanners, sparkles, fire
 *   Row 2 (notes 16-23): Pulses & strobes
 *   Row 1 (notes  8-15): Color fades, waves, rainbows
 *   Row 0 (notes  0- 7): Chases
 *
 * Track buttons (100-107): Blackout, Strobe, Full On, (spare)
 * Scene buttons (112-119): Scene activation
 * Faders: Group dimmers, effect speed, master dimmer
 */
function createDefaultMappings() {
  // Clear existing
  const existing = db.getMidiMappings();
  for (const m of existing) db.deleteMidiMapping(m.id);

  const effects = db.getEffects ? db.getEffects() : [];
  const byId = {};
  effects.forEach(e => byId[e.id] = e);

  // Helper: find effect by ID and create a grid mapping
  function mapEffect(note, effectId, color, activeColor, activeBehavior) {
    const e = byId[effectId];
    if (!e) return;
    db.createMidiMapping({
      name: e.name,
      midi_type: 'note', midi_number: note, midi_channel: 0,
      action_type: 'effect',
      action_data: JSON.stringify({ effect_id: effectId }),
      toggle_mode: 'toggle',
      led_color: color, led_active_color: activeColor,
      led_behavior: 0, led_active_behavior: activeBehavior || 0,
      enabled: 1,
    });
  }

  // Helper: create a color pad mapping
  function mapColor(note, name, r, g, b, w, ledIdle, ledActive) {
    db.createMidiMapping({
      name, midi_type: 'note', midi_number: note, midi_channel: 0,
      action_type: 'color',
      action_data: JSON.stringify({ red: r, green: g, blue: b, white: w || 0 }),
      toggle_mode: 'toggle',
      led_color: ledIdle, led_active_color: ledActive,
      led_behavior: 0, led_active_behavior: 0,
      enabled: 1,
    });
  }

  // ── Row 7 (top, notes 56-63): Static colors ──────────────────────────
  mapColor(56, 'Red',       255,   0,   0, 0, LED.DARK_RED,    LED.RED);
  mapColor(57, 'Orange',    255, 128,   0, 0, LED.ORANGE,      LED.BRIGHT_ORANGE);
  mapColor(58, 'Yellow',    255, 255,   0, 0, LED.DARK_YELLOW, LED.YELLOW);
  mapColor(59, 'Green',       0, 255,   0, 0, LED.DARK_GREEN,  LED.GREEN);
  mapColor(60, 'Cyan',        0, 255, 255, 0, LED.CYAN,        LED.CYAN);
  mapColor(61, 'Blue',        0,   0, 255, 0, LED.DARK_BLUE,   LED.BLUE);
  mapColor(62, 'Magenta',   255,   0, 255, 0, LED.MAGENTA,     LED.MAGENTA);
  mapColor(63, 'White',     255, 255, 255, 255, LED.GRAY,      LED.WHITE);

  // ── Row 6 (notes 48-55): Mover effects ───────────────────────────────
  mapEffect(48, 58, LED.SKY_BLUE,    LED.CYAN);       // Circle
  mapEffect(49, 59, LED.SKY_BLUE,    LED.CYAN);       // Fast Circle
  mapEffect(50, 52, LED.LIGHT_BLUE,  LED.SKY_BLUE);   // Pan Sweep
  mapEffect(51, 55, LED.LIGHT_BLUE,  LED.SKY_BLUE);   // Tilt Sweep
  mapEffect(52, 62, LED.PURPLE,      LED.BRIGHT_PURPLE); // Figure Eight
  mapEffect(53, 66, LED.PURPLE,      LED.BRIGHT_PURPLE); // Fan Out
  mapEffect(54, 68, LED.MAGENTA,     LED.PINK);       // Nod
  mapEffect(55, 64, LED.MAGENTA,     LED.PINK);       // Random Movement

  // ── Row 5 (notes 40-47): Rig effects 2 (color waves, converge, rainbow) ──
  mapEffect(40, 85, LED.SPRING_GREEN, LED.GREEN);      // Rig Color Wave L→R
  mapEffect(41, 86, LED.SPRING_GREEN, LED.GREEN);      // Rig Color Wave R→L
  mapEffect(42, 88, LED.SPRING_GREEN, LED.BRIGHT_GREEN); // Rig Fast Wave
  mapEffect(43, 96, LED.CYAN,         LED.BRIGHT_GREEN); // Rig Converge
  mapEffect(44, 97, LED.CYAN,         LED.BRIGHT_GREEN); // Rig Diverge
  mapEffect(45, 94, LED.YELLOW,       LED.BRIGHT_GREEN); // Rig Alternate
  mapEffect(46, 99, LED.ORANGE,       LED.YELLOW);     // Rig Rainbow
  mapEffect(47, 100, LED.ORANGE,      LED.YELLOW);     // Rig Rainbow Fast

  // ── Row 4 (notes 32-39): Rig effects 1 (chases, sweeps) ─────────────
  mapEffect(32, 78, LED.GREEN,    LED.BRIGHT_GREEN);   // Rig Chase L→R
  mapEffect(33, 79, LED.GREEN,    LED.BRIGHT_GREEN);   // Rig Chase R→L
  mapEffect(34, 80, LED.GREEN,    LED.BRIGHT_GREEN);   // Rig Chase Bounce
  mapEffect(35, 83, LED.LIME,     LED.BRIGHT_GREEN);   // Rig Fast Chase
  mapEffect(36, 89, LED.SKY_BLUE, LED.CYAN);           // Rig Sweep L→R
  mapEffect(37, 90, LED.SKY_BLUE, LED.CYAN);           // Rig Sweep R→L
  mapEffect(38, 91, LED.SKY_BLUE, LED.CYAN);           // Rig Sweep Bounce
  mapEffect(39, 84, LED.LIME,     LED.BRIGHT_GREEN);   // Rig Wide Chase

  // ── Row 3 (notes 24-31): Comets, scanners, sparkles, fire ────────────
  mapEffect(24, 24, LED.ORANGE,      LED.BRIGHT_ORANGE); // Comet Left
  mapEffect(25, 25, LED.ORANGE,      LED.BRIGHT_ORANGE); // Comet Right
  mapEffect(26, 26, LED.ORANGE,      LED.BRIGHT_ORANGE); // Fast Comet
  mapEffect(27, 27, LED.PURPLE,      LED.BRIGHT_PURPLE); // Scanner
  mapEffect(28, 30, LED.LIGHT_YELLOW, LED.YELLOW);    // Sparkle
  mapEffect(29, 32, LED.LIGHT_YELLOW, LED.YELLOW);    // Twinkle
  mapEffect(30, 36, LED.RED,         LED.BRIGHT_ORANGE, LED_BEHAVIOR.PULSING); // Fire
  mapEffect(31, 37, LED.RED,         LED.BRIGHT_ORANGE, LED_BEHAVIOR.PULSING_2X); // Intense Fire

  // ── Row 2 (notes 16-23): Pulses & strobes ────────────────────────────
  mapEffect(16,  1, LED.PURPLE,  LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING);     // Slow Pulse
  mapEffect(17,  2, LED.PURPLE,  LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING_2X);  // Fast Pulse
  mapEffect(18,  3, LED.PINK,    LED.HOT_PINK,      LED_BEHAVIOR.PULSING);     // Heartbeat
  mapEffect(19, 43, LED.PURPLE,  LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING_1_2); // Breathing
  mapEffect(20,  7, LED.YELLOW,  LED.WHITE,         LED_BEHAVIOR.BLINKING_1_2);// Slow Strobe
  mapEffect(21,  8, LED.YELLOW,  LED.WHITE,         LED_BEHAVIOR.BLINKING);    // Medium Strobe
  mapEffect(22,  9, LED.YELLOW,  LED.WHITE,         LED_BEHAVIOR.BLINKING_2X); // Fast Strobe
  mapEffect(23, 10, LED.BLUE,    LED.RED,           LED_BEHAVIOR.BLINKING_2X); // Police Strobe

  // ── Row 1 (notes 8-15): Color fades, waves, rainbows ─────────────────
  mapEffect( 8,  4, LED.ORANGE,      LED.YELLOW);     // Rainbow Cycle
  mapEffect( 9,  5, LED.ORANGE,      LED.YELLOW);     // Fast Rainbow
  mapEffect(10,  6, LED.ORANGE,      LED.YELLOW);     // Double Rainbow
  mapEffect(11, 33, LED.SPRING_GREEN, LED.CYAN);      // Rainbow Wave
  mapEffect(12, 11, LED.DARK_RED,    LED.BLUE);       // Red to Blue Fade
  mapEffect(13, 14, LED.ORANGE,      LED.BRIGHT_ORANGE); // Sunset Fade
  mapEffect(14, 48, LED.LIGHT_BLUE,  LED.CYAN);       // Ice Fade
  mapEffect(15, 35, LED.PURPLE,      LED.MAGENTA);    // Slow Color Wave

  // ── Row 0 (bottom, notes 0-7): Chases ────────────────────────────────
  mapEffect( 0, 16, LED.GREEN,  LED.BRIGHT_GREEN);    // Left Chase
  mapEffect( 1, 17, LED.GREEN,  LED.BRIGHT_GREEN);    // Right Chase
  mapEffect( 2, 18, LED.GREEN,  LED.BRIGHT_GREEN);    // Bounce Chase
  mapEffect( 3, 19, LED.CYAN,   LED.BRIGHT_GREEN);    // Center Out Chase
  mapEffect( 4, 20, LED.CYAN,   LED.BRIGHT_GREEN);    // Outside In Chase
  mapEffect( 5, 21, LED.LIME,   LED.BRIGHT_GREEN);    // Fast Chase
  mapEffect( 6, 22, LED.LIME,   LED.BRIGHT_GREEN);    // Wide Chase
  mapEffect( 7, 23, LED.YELLOW, LED.BRIGHT_GREEN);    // Theater Chase

  // ── Track buttons (100-107): Utility functions ────────────────────────
  const trackDefaults = [
    { note: 0x64, name: 'Blackout',  action_type: 'blackout', action_data: '{}', toggle_mode: 'momentary',
      led_color: LED.RED, led_active_color: LED.LIGHT_RED, led_behavior: 0, led_active_behavior: LED_BEHAVIOR.BLINKING_2X },
    { note: 0x65, name: 'Strobe',    action_type: 'strobe',   action_data: '{}', toggle_mode: 'momentary',
      led_color: LED.YELLOW, led_active_color: LED.WHITE, led_behavior: 0, led_active_behavior: LED_BEHAVIOR.BLINKING_4X },
    { note: 0x66, name: 'Full On',   action_type: 'full_on',  action_data: '{}', toggle_mode: 'momentary',
      led_color: LED.GREEN, led_active_color: LED.BRIGHT_GREEN, led_behavior: 0, led_active_behavior: 0 },
    { note: 0x67, name: 'All Off',   action_type: 'color',
      action_data: JSON.stringify({ red: 0, green: 0, blue: 0 }), toggle_mode: 'momentary',
      led_color: LED.DIM_GRAY, led_active_color: LED.RED, led_behavior: 0, led_active_behavior: 0 },
  ];

  for (const d of trackDefaults) {
    db.createMidiMapping({
      name: d.name, midi_type: 'note', midi_number: d.note, midi_channel: 0,
      action_type: d.action_type, action_data: d.action_data, toggle_mode: d.toggle_mode,
      led_color: d.led_color, led_active_color: d.led_active_color,
      led_behavior: d.led_behavior, led_active_behavior: d.led_active_behavior,
      enabled: 1,
    });
  }

  // ── Scene buttons (112-119): Activate scenes ─────────────────────────
  const scenes = db.getScenes ? db.getScenes() : [];
  for (let i = 0; i < Math.min(scenes.length, 8); i++) {
    db.createMidiMapping({
      name: `Scene: ${scenes[i].name}`,
      midi_type: 'note', midi_number: 0x70 + i, midi_channel: 0,
      action_type: 'scene_activate',
      action_data: JSON.stringify({ scene_id: scenes[i].id }),
      toggle_mode: 'toggle',
      led_color: LED.YELLOW, led_active_color: LED.GREEN,
      led_behavior: 0, led_active_behavior: 0,
      enabled: 1,
    });
  }

  // ── Faders ────────────────────────────────────────────────────────────
  // Fader 9 (CC 56): Master Dimmer
  db.createMidiMapping({
    name: 'Master Dimmer', midi_type: 'cc', midi_number: 56, midi_channel: 0,
    action_type: 'master_dimmer', action_data: '{}', toggle_mode: 'momentary',
    led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1,
  });
  // Fader 8 (CC 55): Effect Speed
  db.createMidiMapping({
    name: 'Effect Speed', midi_type: 'cc', midi_number: 55, midi_channel: 0,
    action_type: 'effect_speed', action_data: '{}', toggle_mode: 'momentary',
    led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1,
  });
  // Faders 1-7 (CC 48-54): Group dimmers
  const groups = db.getGroups ? db.getGroups() : [];
  for (let i = 0; i < Math.min(groups.length, 7); i++) {
    db.createMidiMapping({
      name: `Dimmer: ${groups[i].name}`, midi_type: 'cc', midi_number: 48 + i, midi_channel: 0,
      action_type: 'group_dimmer', action_data: JSON.stringify({ group_id: groups[i].id }),
      toggle_mode: 'momentary',
      led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1,
    });
  }

  console.log('[MIDI] Created default APC Mini mappings');
}

// ─── Public API ─────────────────────────────────────────────────────────────

module.exports = {
  init,
  start,
  stop,
  reconnect,
  registerRoutes,
  listPorts,
  isConnected: () => connected,
  getDeviceName: () => currentDeviceName,
  refreshAllLeds,
  clearAllLeds,
  setLed,
  setLedRGB,
  setLedRGBRange,
  LED,
  LED_BEHAVIOR,
  VELOCITY_COLORS,
};
