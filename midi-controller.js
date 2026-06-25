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
let isAnySequencePlaying;
let getEffectSlot;
let stopRunningEffect;
let activateScene;
let deactivateScene;
let buildChannelCtx;
let computeEffectValue;
let isFixtureCompatibleWithEffect;
let applyMasterDimmer;
let applyInvert;
let pauseAllSequences;
let getFixtureChannelMapCached;
let getFixtureChannelMapByIdMap;

// ─── State ──────────────────────────────────────────────────────────────────

let midiInput = null;
let midiOutput = null;
let midiEngine = null;
let connected = false;
let shiftHeld = false;
let currentDeviceName = '';

// Active toggle states for buttons
const activeToggles = new Set();   // set of mapping IDs currently "on"

// ─── Page System ────────────────────────────────────────────────────────────
// Scene buttons (0x70-0x74) switch between grid pages.
// Each page shows a different set of 8×8 grid mappings.
// Bottom row, faders, and scene buttons themselves are always visible (page 0).

const PAGE_COUNT = 5;
const PAGE_NAMES = ['Colors', 'Color FX', 'Cell FX', 'Mover FX', 'Rig FX'];
const PAGE_SCENE_NOTES = [0x70, 0x71, 0x72, 0x73, 0x74]; // Scene buttons 1-5
const STOP_ALL_NOTE = 0x77;  // Scene button 8 stays as Stop All
const PAGE_SCENE_COLORS = [
  { idle: LED.DARK_RED,    active: LED.RED },          // Page 1: Colors
  { idle: LED.DARK_ORANGE, active: LED.BRIGHT_ORANGE }, // Page 2: Color Effects
  { idle: LED.DARK_GREEN,  active: LED.GREEN },         // Page 3: Cell Effects
  { idle: LED.DARK_BLUE,   active: LED.BLUE },          // Page 4: Mover Effects
  { idle: LED.PURPLE,      active: LED.MAGENTA },       // Page 5: Rig Effects
];

let currentPage = 1; // Active page (1-based, matches DB page column)

// Cached MIDI mappings (avoid DB query on every MIDI event)
let _cachedMidiMappings = null;
function getCachedMidiMappings() {
  if (!_cachedMidiMappings) _cachedMidiMappings = db.getEnabledMidiMappings();
  return _cachedMidiMappings;
}
function invalidateMidiMappingCache() { _cachedMidiMappings = null; }

// Running effects started by MIDI (slot → { timer, effectId, fixtureIds })
const midiRunningEffects = {};

// Active color override state (set when a color toggle is ON, cleared when OFF)
// { red, green, blue, white, group_id } — allows re-applying when master dimmer changes
let activeColorOverride = null;

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
  isAnySequencePlaying     = deps.isAnySequencePlaying || (() => false);
  getEffectSlot            = deps.getEffectSlot;
  stopRunningEffect        = deps.stopRunningEffect;
  activateScene            = deps.activateScene;
  deactivateScene          = deps.deactivateScene;
  buildChannelCtx          = deps.buildChannelCtx;
  computeEffectValue       = deps.computeEffectValue;
  isFixtureCompatibleWithEffect = deps.isFixtureCompatibleWithEffect;
  applyMasterDimmer        = deps.applyMasterDimmer;
  applyInvert              = deps.applyInvert;
  pauseAllSequences        = deps.pauseAllSequences;
  getFixtureChannelMapCached = deps.getFixtureChannelMapCached;
  getFixtureChannelMapByIdMap = deps.getFixtureChannelMapByIdMap;
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
 * Refresh all LEDs based on current mapping state and active page.
 */
function refreshAllLeds() {
  if (midiOutput) {
    clearAllLeds();
  }

  const mappings = db.getMidiMappings();
  for (const m of mappings) {
    if (!m.enabled) continue;
    const mPage = m.page || 0;
    // Grid notes (0-63): only show if mapping is on the current page or page 0 (global)
    if (m.midi_type === 'note' && m.midi_number >= GRID_NOTES.min && m.midi_number <= GRID_NOTES.max) {
      if (mPage !== 0 && mPage !== currentPage) continue;
    }
    // Scene buttons (0x70-0x74) are managed by the page system — skip normal mapping LEDs
    if (m.midi_type === 'note' && m.midi_number >= 0x70 && m.midi_number <= 0x74) continue;
    const isActive = activeToggles.has(m.id);
    const color = isActive ? (m.led_active_color || LED.GREEN) : (m.led_color || LED.YELLOW);
    const behavior = isActive ? (m.led_active_behavior || 0) : (m.led_behavior || 0);
    if (m.midi_type === 'note') {
      setLed(m.midi_number, color, behavior);
    }
  }

  // Light up scene buttons for page navigation
  refreshPageLeds();

  // Broadcast LED state to web clients
  broadcastLedState();
}

/**
 * Update scene button LEDs to reflect the active page.
 */
function refreshPageLeds() {
  if (!midiOutput) return;
  for (let i = 0; i < PAGE_COUNT; i++) {
    const note = PAGE_SCENE_NOTES[i];
    const pageNum = i + 1;
    if (pageNum === currentPage) {
      setLed(note, PAGE_SCENE_COLORS[i].active, LED_BEHAVIOR.STATIC);
    } else {
      // Check if this page has any active toggles — pulse if so
      const hasActive = hasActiveTogglesOnPage(pageNum);
      setLed(note, PAGE_SCENE_COLORS[i].idle, hasActive ? LED_BEHAVIOR.PULSING : LED_BEHAVIOR.STATIC);
    }
  }
}

/**
 * Check if any toggle is active on a given page.
 */
function hasActiveTogglesOnPage(pageNum) {
  if (activeToggles.size === 0) return false;
  const mappings = getCachedMidiMappings();
  for (const m of mappings) {
    if ((m.page || 0) === pageNum && activeToggles.has(m.id)) return true;
  }
  return false;
}

/**
 * Switch to a different page. Updates grid LEDs.
 */
function switchPage(pageNum) {
  if (pageNum < 1 || pageNum > PAGE_COUNT) return;
  if (pageNum === currentPage) return;
  currentPage = pageNum;
  console.log(`[MIDI] Switched to page ${pageNum}: ${PAGE_NAMES[pageNum - 1]}`);
  refreshAllLeds();
  broadcast({ type: 'midi_page', page: currentPage, name: PAGE_NAMES[currentPage - 1] });
}

/**
 * Compute the full LED state for the virtual MIDI layout.
 * Returns an object with grid (0-63), track (0x64-0x6B), scene (0x70-0x77) states
 * and metadata like current page, page names, mappings info.
 */
function getLedState() {
  const mappings = db ? db.getMidiMappings() : [];

  // Build lookup: note → { color, behavior, name, active }
  const noteState = {};

  for (const m of mappings) {
    if (!m.enabled || m.midi_type !== 'note') continue;
    const mPage = m.page || 0;
    const note = m.midi_number;

    // Grid notes: only include current page or global
    if (note >= GRID_NOTES.min && note <= GRID_NOTES.max) {
      if (mPage !== 0 && mPage !== currentPage) continue;
    }
    // Scene buttons 0x70-0x74 managed by page system
    if (note >= 0x70 && note <= 0x74) continue;

    const isActive = activeToggles.has(m.id);
    const color = isActive ? (m.led_active_color || LED.GREEN) : (m.led_color || LED.YELLOW);
    const behavior = isActive ? (m.led_active_behavior || 0) : (m.led_behavior || 0);

    noteState[note] = {
      color,
      hex: VELOCITY_COLORS[color] || '#000000',
      behavior,
      name: m.name || '',
      active: isActive,
      action: m.action_type || '',
    };
  }

  // Add page scene buttons (0x70-0x74)
  for (let i = 0; i < PAGE_COUNT; i++) {
    const note = PAGE_SCENE_NOTES[i];
    const pageNum = i + 1;
    const isCurrentPage = pageNum === currentPage;
    const hasActive = hasActiveTogglesOnPage(pageNum);
    const color = isCurrentPage ? PAGE_SCENE_COLORS[i].active : PAGE_SCENE_COLORS[i].idle;
    const behavior = isCurrentPage ? LED_BEHAVIOR.STATIC : (hasActive ? LED_BEHAVIOR.PULSING : LED_BEHAVIOR.STATIC);
    noteState[note] = {
      color,
      hex: VELOCITY_COLORS[color] || '#000000',
      behavior,
      name: PAGE_NAMES[i],
      active: isCurrentPage,
      action: 'page',
    };
  }

  return {
    page: currentPage,
    pageName: PAGE_NAMES[currentPage - 1] || '',
    pageCount: PAGE_COUNT,
    pageNames: PAGE_NAMES,
    connected: connected,
    notes: noteState,
    velocityColors: VELOCITY_COLORS,
  };
}

/**
 * Broadcast the LED state to all web clients.
 */
let _ledBroadcastTimer = null;
function broadcastLedState() {
  // Debounce — multiple rapid refreshes only send one update
  if (_ledBroadcastTimer) return;
  _ledBroadcastTimer = setTimeout(() => {
    _ledBroadcastTimer = null;
    if (broadcast) {
      broadcast({ type: 'midi_led_state', ...getLedState() });
    }
  }, 50);
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

  // ── Page switching via scene buttons (0x70-0x74) ──
  if (note >= 0x70 && note <= 0x74 && isOn) {
    const pageNum = note - 0x70 + 1;
    switchPage(pageNum);
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

  // Find matching mapping (cached to avoid DB query per note event)
  const mappings = getCachedMidiMappings();
  let matched = false;

  for (const mapping of mappings) {
    if (mapping.midi_type !== 'note') continue;
    if (mapping.midi_number !== note) continue;
    // Grid notes: only match mappings on the current page (or page 0 = global)
    if (region === 'grid') {
      const mPage = mapping.page || 0;
      if (mPage !== 0 && mPage !== currentPage) continue;
    }

    matched = true;
    executeMidiAction(mapping, isOn);
  }

  // Auto-create disabled placeholder for unmapped buttons (like OS2L does)
  if (!matched && isOn) {
    // Don't auto-create placeholders for page scene buttons
    if (note >= 0x70 && note <= 0x74) return;
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
        page: region === 'grid' ? currentPage : 0,
      });
      if (newMapping && !newMapping.error) {
        console.log(`[MIDI] Auto-created placeholder mapping "${label}" (note ${note}, page ${region === 'grid' ? currentPage : 0}, disabled)`);
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

  // Find matching mapping (cached to avoid DB query per CC event)
  const mappings = getCachedMidiMappings();
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

// ─── Color DMX Helper ───────────────────────────────────────────────────────

/**
 * Send a color to all (or group-filtered) fixtures via DMX.
 * Applies the current master dimmer. Returns the list of affected fixture IDs.
 */
function sendColorToDmx(red, green, blue, white, group_id, activate) {
  const channelMap = getFixtureChannelMapCached();
  const channelUpdates = {};
  const colorFixtureIds = [];

  for (const fix of channelMap) {
    if (group_id && !(fix.group_ids || []).includes(group_id)) continue;
    colorFixtureIds.push(fix.id);
    const u = fix.universe;
    if (!channelUpdates[u]) channelUpdates[u] = [];
    const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
    for (const ch of fix.channels) {
      const colorMap = { red, green, blue, white };
      if (colorMap[ch.type] !== undefined) {
        let val = activate ? colorMap[ch.type] : 0;
        if (activate) {
          // Apply master dimmer: if fixture has a dedicated dimmer channel, only dim that;
          // otherwise dim the color channels directly
          if (!fixHasDimmer) val = applyMasterDimmer(val, ch.type);
        }
        channelUpdates[u].push({ ch: ch.dmx_address, val });
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
        channelUpdates[u].push({ ch: ch.dmx_address, val: applyMasterDimmer(255, ch.type) });
      } else if (ch.type === 'dimmer' && !activate) {
        channelUpdates[u].push({ ch: ch.dmx_address, val: 0 });
      }
    }
  }

  const dmxEnabled = getDmxOutputEnabled();
  if (dmxEnabled) {
    for (const [u, channels] of Object.entries(channelUpdates)) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }
  return colorFixtureIds;
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

  // Broadcast updated state to web clients
  broadcastLedState();

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
      const channelMap = getFixtureChannelMapCached();
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
      if (activate) {
        activeColorOverride = { red, green, blue, white, group_id };
        touchOverrides.activeColorOverride = { red, green, blue, white, group_id };
      } else {
        activeColorOverride = null;
        touchOverrides.activeColorOverride = null;
      }
      // When a sequence is playing, color is overlaid each tick — only push DMX when idle
      if (!isAnySequencePlaying()) {
        sendColorToDmx(red, green, blue, white, group_id, activate);
      }
      broadcast({ type: 'midi_action', action: 'color', mapping: mapping.name, active: activate });
      break;
    }

    case 'effect': {
      const { effect_id, group_id } = actionData;
      if (activate && effect_id) {
        const effect = db.getEffect(effect_id);
        if (effect) {
          const channelMap = getFixtureChannelMapCached();
          const fixtureByIdMap = getFixtureChannelMapByIdMap();
          let fixtureIds = channelMap.map(f => f.id);
          if (group_id) {
            fixtureIds = channelMap.filter(f => (f.group_ids || []).includes(group_id)).map(f => f.id);
          }
          if (fixtureIds.length > 0) {
            const slot = getEffectSlot(effect.type);
            stopRunningEffect(slot, true);
            setOverride(fixtureIds, true);
            const startTime = Date.now();

            const timer = setInterval(() => {
              if (!getDmxOutputEnabled()) return;
              const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;
              const chUpdates = {};
              for (let fi = 0; fi < fixtureIds.length; fi++) {
                const fixtureId = fixtureIds[fi];
                const fix = fixtureByIdMap.get(fixtureId);
                if (!fix || !isFixtureCompatibleWithEffect(effect, fix)) continue;
                for (const ch of fix.channels) {
                  let progress = effect.type === 'color_fade' ? (elapsed % 4) / 4 : elapsed;
                  const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };
                  const channelCtx = buildChannelCtx(ch, fix);
                  channelCtx._fixtureOrdinal = fi;
                  channelCtx._fixtureCount = fixtureIds.length;
                  channelCtx._rigFixtureCount = channelMap.length;
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
        // Deactivate: only stop the slot for THIS specific effect
        if (effect_id) {
          const deactivatedEffect = db.getEffect(effect_id);
          if (deactivatedEffect) {
            const slot = getEffectSlot(deactivatedEffect.type);
            const entry = midiRunningEffects[slot];
            if (entry && entry.effectId === effect_id) {
              if (entry.fixtureIds) setOverride(entry.fixtureIds, false);
              delete midiRunningEffects[slot];
              stopRunningEffect(slot, false);
            }
          }
        } else {
          // Fallback: stop all if we don't know which effect
          for (const slot of Object.keys(midiRunningEffects)) {
            const entry = midiRunningEffects[slot];
            if (entry && entry.fixtureIds) setOverride(entry.fixtureIds, false);
            delete midiRunningEffects[slot];
          }
          stopRunningEffect(undefined, false);
        }
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
      setOverride(getAffectedFixtureIds(), activate);
      if (activate) {
        const ch = [];
        for (let i = 1; i <= 512; i++) ch.push({ ch: i, val: 255 });
        if (dmxOutputEnabled) {
          artnetServer.setChannels(universe, ch);
          dmxUsbServer.setChannels(universe, ch);
        }
      } else {
        // Send home positions for pan/tilt, 0 for everything else
        const channelMap = getFixtureChannelMapCached();
        const chUpdates = {};
        for (const fix of channelMap) {
          if (fix.universe !== universe) continue;
          for (const c of fix.channels) {
            if (c.type === 'pan') chUpdates[c.dmx_address] = fix.home_pan ?? 128;
            else if (c.type === 'tilt') chUpdates[c.dmx_address] = fix.home_tilt ?? 128;
            else chUpdates[c.dmx_address] = 0;
          }
        }
        // Fill gaps with 0 for any unclaimed channels
        const ch = [];
        for (let i = 1; i <= 512; i++) ch.push({ ch: i, val: chUpdates[i] ?? 0 });
        if (dmxOutputEnabled) {
          artnetServer.setChannels(universe, ch);
          dmxUsbServer.setChannels(universe, ch);
        }
      }
      broadcast({ type: 'midi_action', action: 'full_on', mapping: mapping.name, active: activate });
      break;
    }

    case 'stop_all_effects': {
      if (activate) {
        // Stop all MIDI-started effects and release their overrides
        for (const slot of Object.keys(midiRunningEffects)) {
          const entry = midiRunningEffects[slot];
          if (entry && entry.fixtureIds) setOverride(entry.fixtureIds, false);
          delete midiRunningEffects[slot];
        }
        // Stop all running QA effects (clears intervals and resets channels)
        stopRunningEffect(undefined, false);
        // Deactivate any active scene (stops scene effect timer too)
        deactivateScene();
        // Clear active color override state
        activeColorOverride = null;
        touchOverrides.activeColorOverride = null;
        // Clear ALL active toggles (effects, colors, strobes, scenes, etc.)
        // and reset their LEDs + release overrides
        const mappings = getCachedMidiMappings();
        for (const m of mappings) {
          if (activeToggles.has(m.id)) {
            activeToggles.delete(m.id);
            if (midiOutput && m.midi_type === 'note') {
              setLed(m.midi_number, m.led_color || LED.YELLOW, m.led_behavior || 0);
            }
          }
        }
        // Pause all active sequences so the sequencer doesn't immediately
        // resume writing DMX values after overrides are cleared
        if (pauseAllSequences) pauseAllSequences();
        // Release all overrides
        setOverride(getAffectedFixtureIds(), false);
        touchOverrides.colorOverrideFixtures.clear();
        touchOverrides.activeColorOverride = null;
        // Zero out all fixtures to ensure nothing stays lit
        const dmxOutputEnabled = getDmxOutputEnabled();
        if (dmxOutputEnabled) {
          const channelMap = db.getFixtureChannelMap();
          const channelUpdates = {};
          for (const fix of channelMap) {
            const u = fix.universe;
            if (!channelUpdates[u]) channelUpdates[u] = {};
            for (const ch of fix.channels) {
              if (['dimmer','red','green','blue','white','amber','uv','strobe'].includes(ch.type)) {
                channelUpdates[u][ch.dmx_address] = 0;
              } else if (ch.type === 'pan') {
                channelUpdates[u][ch.dmx_address] = fix.home_pan ?? 128;
              } else if (ch.type === 'tilt') {
                channelUpdates[u][ch.dmx_address] = fix.home_tilt ?? 128;
              }
            }
          }
          for (const [u, chMap] of Object.entries(channelUpdates)) {
            const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
            if (channels.length > 0) {
              artnetServer.setChannels(+u, channels);
              dmxUsbServer.setChannels(+u, channels);
            }
          }
        }
        console.log('[MIDI] Stopped all effects, scenes, and overrides');
        // Refresh page LEDs since active toggles were cleared
        refreshPageLeds();
      }
      broadcast({ type: 'midi_action', action: 'stop_all_effects', mapping: mapping.name, active: activate });
      break;
    }

    case 'master_dimmer': {
      const val = actionData.value !== undefined ? actionData.value : 255;
      if (activate) {
        touchOverrides.masterDimmer = val;
      } else {
        touchOverrides.masterDimmer = 255;
      }
      broadcast({ type: 'masterDimmer', value: touchOverrides.masterDimmer });
      // Re-apply active color override with new master dimmer
      if (activeColorOverride && dmxOutputEnabled) {
        const { red, green, blue, white, group_id } = activeColorOverride;
        sendColorToDmx(red, green, blue, white, group_id, true);
      }
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
      // Re-apply active color override with new master dimmer
      if (activeColorOverride && dmxOutputEnabled) {
        const { red, green, blue, white, group_id } = activeColorOverride;
        sendColorToDmx(red, green, blue, white, group_id, true);
      }
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
      touchOverrides.groupDimmers[group_id] = dimVal;
      // During sequence playback the engine applies groupDimmers each frame; direct DMX would be overwritten.
      if (dmxOutputEnabled && !isAnySequencePlaying()) {
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
      page: currentPage,
      pageName: PAGE_NAMES[currentPage - 1] || '',
      pageCount: PAGE_COUNT,
      pageNames: PAGE_NAMES,
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
    invalidateMidiMappingCache();
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.status(201).json(result);
  });

  app.put('/api/midi/mappings/:id', (req, res) => {
    const result = db.updateMidiMapping(+req.params.id, req.body);
    if (!result) return res.status(404).json({ error: 'Not found' });
    if (result.error) return res.status(400).json(result);
    invalidateMidiMappingCache();
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json(result);
  });

  app.delete('/api/midi/mappings/:id', (req, res) => {
    db.deleteMidiMapping(+req.params.id);
    invalidateMidiMappingCache();
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json({ deleted: true });
  });

  app.post('/api/midi/mappings/:id/toggle', (req, res) => {
    const result = db.toggleMidiMapping(+req.params.id);
    if (!result) return res.status(404).json({ error: 'Not found' });
    invalidateMidiMappingCache();
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
    invalidateMidiMappingCache();
    refreshAllLeds();
    broadcast({ type: 'midi_mappings_changed' });
    res.json({ ok: true, message: 'Default APC Mini mappings created' });
  });

  // ── Page Navigation ─────────────────────────────────────────────────────
  app.get('/api/midi/page', (req, res) => {
    res.json({ page: currentPage, name: PAGE_NAMES[currentPage - 1] || '', count: PAGE_COUNT, names: PAGE_NAMES });
  });

  app.post('/api/midi/page', (req, res) => {
    const { page } = req.body || {};
    const p = parseInt(page, 10);
    if (!p || p < 1 || p > PAGE_COUNT) return res.status(400).json({ error: `Page must be 1-${PAGE_COUNT}` });
    switchPage(p);
    res.json({ page: currentPage, name: PAGE_NAMES[currentPage - 1] || '' });
  });

  // ── LED State (for virtual MIDI layout) ──────────────────────────────
  app.get('/api/midi/led-state', (req, res) => {
    res.json(getLedState());
  });
}

// ─── Default Mapping Presets ────────────────────────────────────────────────

/**
 * Create a sensible default mapping for the APC Mini mk2 with page support.
 *
 * Pages (selected via scene buttons 1-5 on the right):
 *   Page 1: Colors — static color pads across the full 8×8 grid
 *   Page 2: Color FX — rainbows, fades, pulses, strobes, sparkles, fire
 *   Page 3: Cell FX — chases, comets, scanners, buildups, segments, ripples
 *   Page 4: Mover FX — pan/tilt sweeps, circles, figure 8, fan, nod, random
 *   Page 5: Rig FX — rig-wide chases, sweeps, color waves, converge, rainbow
 *
 * Scene buttons 6-7 (0x75-0x76): Spare (unmapped)
 * Scene button 8 (0x77): Stop All Effects (global)
 *
 * Track buttons (100-107): Blackout, Strobe, Full On, All Off (global, page 0)
 * Faders: Group dimmers, effect speed, master dimmer (global, page 0)
 */
function createDefaultMappings() {
  // Clear existing
  const existing = db.getMidiMappings();
  for (const m of existing) db.deleteMidiMapping(m.id);

  const effects = db.getEffects ? db.getEffects() : [];
  const byId = {};
  effects.forEach(e => byId[e.id] = e);

  // Helper: find effect by ID and create a grid mapping on a specific page
  function mapEffect(note, effectId, color, activeColor, activeBehavior, page) {
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
      page: page || 0,
    });
  }

  // Helper: create a color pad mapping on a specific page
  function mapColor(note, name, r, g, b, w, ledIdle, ledActive, page) {
    db.createMidiMapping({
      name, midi_type: 'note', midi_number: note, midi_channel: 0,
      action_type: 'color',
      action_data: JSON.stringify({ red: r, green: g, blue: b, white: w || 0 }),
      toggle_mode: 'toggle',
      led_color: ledIdle, led_active_color: ledActive,
      led_behavior: 0, led_active_behavior: 0,
      enabled: 1,
      page: page || 0,
    });
  }

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 1: COLORS (full 8×8 grid of static color pads)
  // ════════════════════════════════════════════════════════════════════════
  // Row 7 (notes 56-63): Primary colors
  mapColor(56, 'Red',           255,   0,   0,   0, LED.DARK_RED,    LED.RED,            1);
  mapColor(57, 'Orange',        255, 128,   0,   0, LED.ORANGE,      LED.BRIGHT_ORANGE,  1);
  mapColor(58, 'Yellow',        255, 255,   0,   0, LED.DARK_YELLOW, LED.YELLOW,         1);
  mapColor(59, 'Green',           0, 255,   0,   0, LED.DARK_GREEN,  LED.GREEN,          1);
  mapColor(60, 'Cyan',            0, 255, 255,   0, LED.CYAN,        LED.CYAN,           1);
  mapColor(61, 'Blue',            0,   0, 255,   0, LED.DARK_BLUE,   LED.BLUE,           1);
  mapColor(62, 'Magenta',       255,   0, 255,   0, LED.MAGENTA,     LED.MAGENTA,        1);
  mapColor(63, 'White',         255, 255, 255, 255, LED.GRAY,        LED.WHITE,          1);

  // Row 6 (notes 48-55): Warm/cool tones
  mapColor(48, 'Warm White',    255, 200, 150, 200, LED.WARM_WHITE,  LED.WHITE,          1);
  mapColor(49, 'Amber',         255, 180,   0,   0, LED.ORANGE,      LED.YELLOW,         1);
  mapColor(50, 'Gold',          255, 215,   0,   0, LED.DARK_YELLOW, LED.LIGHT_YELLOW,   1);
  mapColor(51, 'Lime',          128, 255,   0,   0, LED.LIME,        LED.BRIGHT_GREEN,   1);
  mapColor(52, 'Teal',            0, 180, 180,   0, LED.CYAN,        LED.LIGHT_BLUE,     1);
  mapColor(53, 'Sky Blue',        0, 150, 255,   0, LED.SKY_BLUE,    LED.LIGHT_BLUE,     1);
  mapColor(54, 'Indigo',         75,   0, 130,   0, LED.PURPLE,      LED.BRIGHT_PURPLE,  1);
  mapColor(55, 'Pink',          255, 100, 150,   0, LED.PINK,        LED.HOT_PINK,       1);

  // Row 5 (notes 40-47): Deeper/darker shades
  mapColor(40, 'Deep Red',      180,   0,   0,   0, LED.DARK_RED,    LED.LIGHT_RED,      1);
  mapColor(41, 'Burnt Orange',  200,  80,   0,   0, LED.DARK_ORANGE, LED.BRIGHT_ORANGE,  1);
  mapColor(42, 'Olive',         128, 128,   0,   0, LED.DARK_YELLOW, LED.YELLOW,         1);
  mapColor(43, 'Forest',          0, 130,   0,   0, LED.DARK_GREEN,  LED.GREEN,          1);
  mapColor(44, 'Dark Cyan',      0, 130, 130,   0, LED.CYAN,        LED.LIGHT_BLUE,     1);
  mapColor(45, 'Navy',            0,   0, 130,   0, LED.DARK_BLUE,   LED.BLUE,           1);
  mapColor(46, 'Purple',        128,   0, 128,   0, LED.PURPLE,      LED.BRIGHT_PURPLE,  1);
  mapColor(47, 'Rose',          200,   0,  80,   0, LED.ROSE,        LED.HOT_PINK,       1);

  // Row 4 (notes 32-39): Pastel tones
  mapColor(32, 'Pastel Red',    255, 150, 150,   0, LED.LIGHT_RED,   LED.RED,            1);
  mapColor(33, 'Peach',         255, 200, 150,   0, LED.ORANGE,      LED.BRIGHT_ORANGE,  1);
  mapColor(34, 'Cream',         255, 255, 180,   0, LED.LIGHT_YELLOW, LED.YELLOW,        1);
  mapColor(35, 'Mint',          150, 255, 180,   0, LED.SPRING_GREEN, LED.GREEN,         1);
  mapColor(36, 'Aqua',          150, 255, 255,   0, LED.LIGHT_BLUE,  LED.CYAN,           1);
  mapColor(37, 'Lavender',      150, 150, 255,   0, LED.LIGHT_BLUE,  LED.BLUE,           1);
  mapColor(38, 'Lilac',         200, 150, 255,   0, LED.PURPLE,      LED.BRIGHT_PURPLE,  1);
  mapColor(39, 'Blush',         255, 150, 200,   0, LED.PINK,        LED.HOT_PINK,       1);

  // Row 3 (notes 24-31): Stage-friendly combos
  mapColor(24, 'Congo Blue',     40,   0, 100,   0, LED.DARK_BLUE,   LED.PURPLE,         1);
  mapColor(25, 'UV Effect',      80,   0, 200,   0, LED.BRIGHT_PURPLE, LED.MAGENTA,      1);
  mapColor(26, 'Fire Red',      255,  40,   0,   0, LED.RED,         LED.BRIGHT_ORANGE,  1);
  mapColor(27, 'Sunset',        255,  80,  40,   0, LED.ORANGE,      LED.BRIGHT_ORANGE,  1);
  mapColor(28, 'Electric Blue',   0,  80, 255,   0, LED.BLUE,        LED.SKY_BLUE,       1);
  mapColor(29, 'Turquoise',       0, 220, 200,   0, LED.CYAN,        LED.SPRING_GREEN,   1);
  mapColor(30, 'Chartreuse',    180, 255,   0,   0, LED.LIME,        LED.BRIGHT_GREEN,   1);
  mapColor(31, 'Hot Pink',      255,   0, 100,   0, LED.HOT_PINK,    LED.PINK,           1);

  // Row 2 (notes 16-23): Cool whites and dim
  mapColor(16, 'Cool White',    200, 200, 255, 200, LED.LIGHT_BLUE,  LED.WHITE,          1);
  mapColor(17, 'Daylight',      255, 255, 240, 255, LED.GRAY,        LED.WHITE,          1);
  mapColor(18, 'Candle',        255, 150,  50, 100, LED.WARM_WHITE,  LED.YELLOW,         1);
  mapColor(19, 'dim Red',        80,   0,   0,   0, LED.DARK_RED,    LED.RED,            1);
  mapColor(20, 'dim Green',       0,  80,   0,   0, LED.DARK_GREEN,  LED.GREEN,          1);
  mapColor(21, 'dim Blue',        0,   0,  80,   0, LED.DARK_BLUE,   LED.BLUE,           1);
  mapColor(22, 'dim Purple',     60,   0,  80,   0, LED.PURPLE,      LED.BRIGHT_PURPLE,  1);
  mapColor(23, 'dim Cyan',        0,  80,  80,   0, LED.CYAN,        LED.LIGHT_BLUE,     1);

  // Row 1 (notes 8-15): RGB mixes
  mapColor( 8, 'Red+Blue',      200,   0, 200,   0, LED.MAGENTA,     LED.BRIGHT_PURPLE,  1);
  mapColor( 9, 'Red+Green',     200, 200,   0,   0, LED.YELLOW,      LED.LIGHT_YELLOW,   1);
  mapColor(10, 'Blue+Green',      0, 200, 200,   0, LED.CYAN,        LED.LIGHT_BLUE,     1);
  mapColor(11, 'Coral',         255, 120,  80,   0, LED.ORANGE,      LED.BRIGHT_ORANGE,  1);
  mapColor(12, 'Salmon',        250, 128, 114,   0, LED.PINK,        LED.LIGHT_RED,      1);
  mapColor(13, 'Fuchsia',       255,   0, 200,   0, LED.HOT_PINK,    LED.MAGENTA,        1);
  mapColor(14, 'Violet',        140,   0, 255,   0, LED.BRIGHT_PURPLE, LED.MAGENTA,      1);
  mapColor(15, 'Spring',          0, 255, 127,   0, LED.SPRING_GREEN, LED.GREEN,         1);

  // Row 0 (bottom, notes 0-7): Utility colors
  mapColor( 0, 'Off (Black)',     0,   0,   0,   0, LED.DIM_GRAY,    LED.RED,            1);
  mapColor( 1, 'dim Warm',       80,  60,  30,  50, LED.DIM_GRAY,    LED.WARM_WHITE,     1);
  mapColor( 2, 'dim Cool',       40,  50,  80,  50, LED.DIM_GRAY,    LED.LIGHT_BLUE,     1);
  mapColor( 3, 'Full Warm',     255, 200, 100, 255, LED.ORANGE,      LED.WHITE,          1);
  mapColor( 4, 'Full Cool',     200, 220, 255, 255, LED.SKY_BLUE,    LED.WHITE,          1);
  mapColor( 5, 'RGB Red 50%',   128,   0,   0,   0, LED.DARK_RED,    LED.RED,            1);
  mapColor( 6, 'RGB Green 50%',   0, 128,   0,   0, LED.DARK_GREEN,  LED.GREEN,          1);
  mapColor( 7, 'RGB Blue 50%',    0,   0, 128,   0, LED.DARK_BLUE,   LED.BLUE,           1);

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 2: COLOR EFFECTS (rainbows, fades, pulses, strobes)
  // ════════════════════════════════════════════════════════════════════════
  // Row 7: Rainbows
  mapEffect(56,  4, LED.ORANGE,       LED.YELLOW,        0,                          2); // Rainbow Cycle
  mapEffect(57,  5, LED.ORANGE,       LED.YELLOW,        0,                          2); // Fast Rainbow
  mapEffect(58,  6, LED.ORANGE,       LED.YELLOW,        0,                          2); // Double Rainbow
  mapEffect(59, 33, LED.SPRING_GREEN, LED.CYAN,          0,                          2); // Rainbow Wave
  mapEffect(60, 35, LED.PURPLE,       LED.MAGENTA,       0,                          2); // Slow Color Wave
  mapEffect(61, 34, LED.PURPLE,       LED.MAGENTA,       0,                          2); // Fast Color Wave
  mapEffect(62, 42, LED.SPRING_GREEN, LED.CYAN,          0,                          2); // Gentle Wave
  mapEffect(63, 44, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          2); // Deep Wave

  // Row 6: Color Fades
  mapEffect(48, 11, LED.DARK_RED,     LED.BLUE,          0,                          2); // Red→Blue
  mapEffect(49, 12, LED.BLUE,         LED.GREEN,         0,                          2); // Blue→Green
  mapEffect(50, 13, LED.GREEN,        LED.RED,           0,                          2); // Green→Red
  mapEffect(51, 14, LED.ORANGE,       LED.BRIGHT_ORANGE, 0,                          2); // Sunset Fade
  mapEffect(52, 48, LED.LIGHT_BLUE,   LED.CYAN,          0,                          2); // Ice Fade
  mapEffect(53, 15, LED.PINK,         LED.PURPLE,        0,                          2); // Purple Haze
  mapEffect(54, 46, LED.DARK_YELLOW,  LED.YELLOW,        0,                          2); // Warm Fade
  mapEffect(55, 47, LED.SKY_BLUE,     LED.LIGHT_BLUE,    0,                          2); // Cool Fade

  // Row 5: Pulses
  mapEffect(40,  1, LED.PURPLE,       LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING,       2); // Slow Pulse
  mapEffect(41,  2, LED.PURPLE,       LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING_2X,    2); // Fast Pulse
  mapEffect(42,  3, LED.PINK,         LED.HOT_PINK,      LED_BEHAVIOR.PULSING,       2); // Heartbeat
  mapEffect(43, 43, LED.PURPLE,       LED.BRIGHT_PURPLE, LED_BEHAVIOR.PULSING_1_2,   2); // Breathing
  mapEffect(44, 38, LED.ORANGE,       LED.YELLOW,        LED_BEHAVIOR.PULSING,       2); // Warm Pulse
  mapEffect(45, 39, LED.LIGHT_BLUE,   LED.CYAN,          LED_BEHAVIOR.PULSING,       2); // Cool Pulse
  mapEffect(46, 40, LED.MAGENTA,      LED.PINK,          LED_BEHAVIOR.PULSING_2X,    2); // Pink Pulse
  mapEffect(47, 41, LED.GREEN,        LED.BRIGHT_GREEN,  LED_BEHAVIOR.PULSING,       2); // Green Pulse

  // Row 4: Strobes
  mapEffect(32,  7, LED.YELLOW,       LED.WHITE,         LED_BEHAVIOR.BLINKING_1_2,  2); // Slow Strobe
  mapEffect(33,  8, LED.YELLOW,       LED.WHITE,         LED_BEHAVIOR.BLINKING,      2); // Medium Strobe
  mapEffect(34,  9, LED.YELLOW,       LED.WHITE,         LED_BEHAVIOR.BLINKING_2X,   2); // Fast Strobe
  mapEffect(35, 10, LED.BLUE,         LED.RED,           LED_BEHAVIOR.BLINKING_2X,   2); // Police Strobe
  mapEffect(36, 49, LED.RED,          LED.WHITE,         LED_BEHAVIOR.BLINKING_4X,   2); // Mega Strobe
  mapEffect(37, 50, LED.ORANGE,       LED.WHITE,         LED_BEHAVIOR.BLINKING,      2); // Warm Strobe
  mapEffect(38, 51, LED.LIGHT_BLUE,   LED.WHITE,         LED_BEHAVIOR.BLINKING,      2); // Cool Strobe
  mapEffect(39, 45, LED.PURPLE,       LED.WHITE,         LED_BEHAVIOR.BLINKING_2X,   2); // UV Strobe

  // Row 3: Sparkles & Fire
  mapEffect(24, 30, LED.LIGHT_YELLOW, LED.YELLOW,        0,                          2); // Sparkle
  mapEffect(25, 31, LED.LIGHT_YELLOW, LED.WHITE,         0,                          2); // Dense Sparkle
  mapEffect(26, 32, LED.LIGHT_YELLOW, LED.YELLOW,        0,                          2); // Twinkle
  mapEffect(27, 36, LED.RED,          LED.BRIGHT_ORANGE, LED_BEHAVIOR.PULSING,       2); // Fire
  mapEffect(28, 37, LED.RED,          LED.BRIGHT_ORANGE, LED_BEHAVIOR.PULSING_2X,    2); // Intense Fire
  mapEffect(29, 29, LED.ORANGE,       LED.WARM_WHITE,    0,                          2); // Candle Flicker
  mapEffect(30, 28, LED.YELLOW,       LED.WHITE,         0,                          2); // Soft Sparkle
  mapEffect(31, 53, LED.RED,          LED.YELLOW,        LED_BEHAVIOR.PULSING,       2); // Lava

  // Rows 2-0: Spare/additional effects (unmapped by default on page 2)

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 3: CELL / MULTICELL EFFECTS (chases, comets, scanners, etc.)
  // ════════════════════════════════════════════════════════════════════════
  // Row 7: Chases
  mapEffect(56, 16, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Left Chase
  mapEffect(57, 17, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Right Chase
  mapEffect(58, 18, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Bounce Chase
  mapEffect(59, 19, LED.CYAN,         LED.BRIGHT_GREEN,  0,                          3); // Center Out Chase
  mapEffect(60, 20, LED.CYAN,         LED.BRIGHT_GREEN,  0,                          3); // Outside In Chase
  mapEffect(61, 21, LED.LIME,         LED.BRIGHT_GREEN,  0,                          3); // Fast Chase
  mapEffect(62, 22, LED.LIME,         LED.BRIGHT_GREEN,  0,                          3); // Wide Chase
  mapEffect(63, 23, LED.YELLOW,       LED.BRIGHT_GREEN,  0,                          3); // Theater Chase

  // Row 6: Comets
  mapEffect(48, 24, LED.ORANGE,       LED.BRIGHT_ORANGE, 0,                          3); // Comet Left
  mapEffect(49, 25, LED.ORANGE,       LED.BRIGHT_ORANGE, 0,                          3); // Comet Right
  mapEffect(50, 26, LED.ORANGE,       LED.BRIGHT_ORANGE, 0,                          3); // Fast Comet
  mapEffect(51, 27, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          3); // Scanner
  mapEffect(52, 54, LED.ORANGE,       LED.YELLOW,        0,                          3); // Long Comet
  mapEffect(53, 55, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          3); // Wide Scanner
  mapEffect(54, 56, LED.ORANGE,       LED.BRIGHT_ORANGE, 0,                          3); // Dual Comet
  mapEffect(55, 57, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Reverse Scanner

  // Row 5: Buildups & Segments
  mapEffect(40, 69, LED.BLUE,         LED.LIGHT_BLUE,    0,                          3); // Buildup Left
  mapEffect(41, 70, LED.BLUE,         LED.LIGHT_BLUE,    0,                          3); // Buildup Right
  mapEffect(42, 71, LED.BLUE,         LED.CYAN,          0,                          3); // Buildup Center
  mapEffect(43, 72, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Segments 2
  mapEffect(44, 73, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          3); // Segments 3
  mapEffect(45, 74, LED.GREEN,        LED.LIME,          0,                          3); // Fast Segments
  mapEffect(46, 75, LED.YELLOW,       LED.BRIGHT_GREEN,  0,                          3); // Slow Segments
  mapEffect(47, 76, LED.CYAN,         LED.LIGHT_BLUE,    0,                          3); // Ripple

  // Row 4: Ripples & Cell Strobes
  mapEffect(32, 77, LED.CYAN,         LED.LIGHT_BLUE,    0,                          3); // Fast Ripple
  mapEffect(33, 101, LED.YELLOW,      LED.WHITE,         LED_BEHAVIOR.BLINKING,      3); // Cell Strobe Seq
  mapEffect(34, 102, LED.YELLOW,      LED.WHITE,         LED_BEHAVIOR.BLINKING_2X,   3); // Cell Strobe Random
  mapEffect(35, 103, LED.PURPLE,      LED.MAGENTA,       0,                          3); // Gradient
  mapEffect(36, 104, LED.ORANGE,      LED.YELLOW,        0,                          3); // Warm Gradient
  mapEffect(37, 105, LED.LIGHT_BLUE,  LED.CYAN,          0,                          3); // Cool Gradient
  mapEffect(38, 106, LED.SPRING_GREEN, LED.GREEN,        0,                          3); // Nature Gradient
  mapEffect(39, 107, LED.PURPLE,      LED.PINK,          0,                          3); // Sunset Gradient

  // Rows 3-0: Spare on page 3

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 4: MOVER EFFECTS (pan/tilt movements)
  // ════════════════════════════════════════════════════════════════════════
  // Row 7: Circles & Figure 8
  mapEffect(56, 58, LED.SKY_BLUE,     LED.CYAN,          0,                          4); // Circle
  mapEffect(57, 59, LED.SKY_BLUE,     LED.CYAN,          0,                          4); // Fast Circle
  mapEffect(58, 60, LED.SKY_BLUE,     LED.LIGHT_BLUE,    0,                          4); // Small Circle
  mapEffect(59, 61, LED.SKY_BLUE,     LED.LIGHT_BLUE,    0,                          4); // Large Circle
  mapEffect(60, 62, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          4); // Figure Eight
  mapEffect(61, 63, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          4); // Fast Figure 8
  mapEffect(62, 108, LED.PURPLE,      LED.MAGENTA,       0,                          4); // Small Figure 8
  mapEffect(63, 109, LED.PURPLE,      LED.MAGENTA,       0,                          4); // Large Figure 8

  // Row 6: Pan & Tilt Sweeps
  mapEffect(48, 52, LED.LIGHT_BLUE,   LED.SKY_BLUE,      0,                          4); // Pan Sweep
  mapEffect(49, 53, LED.LIGHT_BLUE,   LED.SKY_BLUE,      0,                          4); // Fast Pan Sweep
  mapEffect(50, 54, LED.LIGHT_BLUE,   LED.CYAN,          0,                          4); // Wide Pan Sweep
  mapEffect(51, 55, LED.LIGHT_BLUE,   LED.SKY_BLUE,      0,                          4); // Tilt Sweep
  mapEffect(52, 56, LED.LIGHT_BLUE,   LED.SKY_BLUE,      0,                          4); // Fast Tilt Sweep
  mapEffect(53, 57, LED.LIGHT_BLUE,   LED.CYAN,          0,                          4); // Wide Tilt Sweep
  mapEffect(54, 110, LED.CYAN,        LED.LIGHT_BLUE,    0,                          4); // Diagonal Sweep
  mapEffect(55, 111, LED.CYAN,        LED.LIGHT_BLUE,    0,                          4); // Cross Sweep

  // Row 5: Fan, Nod, Random
  mapEffect(40, 66, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          4); // Fan Out
  mapEffect(41, 67, LED.PURPLE,       LED.BRIGHT_PURPLE, 0,                          4); // Fan In
  mapEffect(42, 68, LED.MAGENTA,      LED.PINK,          0,                          4); // Nod
  mapEffect(43, 112, LED.MAGENTA,     LED.PINK,          0,                          4); // Fast Nod
  mapEffect(44, 113, LED.MAGENTA,     LED.HOT_PINK,      0,                          4); // Pan Nod
  mapEffect(45, 64, LED.MAGENTA,      LED.PINK,          0,                          4); // Random Move
  mapEffect(46, 65, LED.MAGENTA,      LED.PINK,          0,                          4); // Slow Random
  mapEffect(47, 114, LED.YELLOW,      LED.BRIGHT_GREEN,  0,                          4); // Wide Random

  // Rows 4-0: Spare on page 4

  // ════════════════════════════════════════════════════════════════════════
  //  PAGE 5: RIG-WIDE EFFECTS (spatial effects across the whole rig)
  // ════════════════════════════════════════════════════════════════════════
  // Row 7: Rig Chases
  mapEffect(56, 78, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          5); // Rig Chase L→R
  mapEffect(57, 79, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          5); // Rig Chase R→L
  mapEffect(58, 80, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          5); // Rig Chase Bounce
  mapEffect(59, 81, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          5); // Rig Chase T→B
  mapEffect(60, 82, LED.GREEN,        LED.BRIGHT_GREEN,  0,                          5); // Rig Chase B→T
  mapEffect(61, 83, LED.LIME,         LED.BRIGHT_GREEN,  0,                          5); // Rig Fast Chase
  mapEffect(62, 84, LED.LIME,         LED.BRIGHT_GREEN,  0,                          5); // Rig Wide Chase
  mapEffect(63, 115, LED.YELLOW,      LED.BRIGHT_GREEN,  0,                          5); // Rig Narrow Chase

  // Row 6: Rig Sweeps
  mapEffect(48, 89, LED.SKY_BLUE,     LED.CYAN,          0,                          5); // Rig Sweep L→R
  mapEffect(49, 90, LED.SKY_BLUE,     LED.CYAN,          0,                          5); // Rig Sweep R→L
  mapEffect(50, 91, LED.SKY_BLUE,     LED.CYAN,          0,                          5); // Rig Sweep Bounce
  mapEffect(51, 92, LED.SKY_BLUE,     LED.CYAN,          0,                          5); // Rig Sweep T→B
  mapEffect(52, 93, LED.LIGHT_BLUE,   LED.CYAN,          0,                          5); // Rig Sweep B→T
  mapEffect(53, 116, LED.LIGHT_BLUE,  LED.SKY_BLUE,      0,                          5); // Rig Fast Sweep
  mapEffect(54, 117, LED.LIGHT_BLUE,  LED.SKY_BLUE,      0,                          5); // Rig Wide Sweep
  mapEffect(55, 118, LED.CYAN,        LED.LIGHT_BLUE,    0,                          5); // Rig Narrow Sweep

  // Row 5: Rig Color Waves
  mapEffect(40, 85, LED.SPRING_GREEN, LED.GREEN,         0,                          5); // Rig Color Wave L→R
  mapEffect(41, 86, LED.SPRING_GREEN, LED.GREEN,         0,                          5); // Rig Color Wave R→L
  mapEffect(42, 87, LED.SPRING_GREEN, LED.GREEN,         0,                          5); // Rig Color Wave T→B
  mapEffect(43, 88, LED.SPRING_GREEN, LED.BRIGHT_GREEN,  0,                          5); // Rig Fast Wave
  mapEffect(44, 119, LED.CYAN,        LED.SPRING_GREEN,  0,                          5); // Rig Slow Wave
  mapEffect(45, 120, LED.ORANGE,      LED.YELLOW,        0,                          5); // Rig Warm Wave
  mapEffect(46, 121, LED.LIGHT_BLUE,  LED.CYAN,          0,                          5); // Rig Cool Wave
  mapEffect(47, 122, LED.MAGENTA,     LED.PINK,          0,                          5); // Rig Purple Wave

  // Row 4: Rig Converge, Alternate, Rainbow
  mapEffect(32, 96, LED.CYAN,         LED.BRIGHT_GREEN,  0,                          5); // Rig Converge
  mapEffect(33, 97, LED.CYAN,         LED.BRIGHT_GREEN,  0,                          5); // Rig Diverge
  mapEffect(34, 94, LED.YELLOW,       LED.BRIGHT_GREEN,  0,                          5); // Rig Alternate
  mapEffect(35, 95, LED.YELLOW,       LED.BRIGHT_GREEN,  0,                          5); // Rig Fast Alternate
  mapEffect(36, 99, LED.ORANGE,       LED.YELLOW,        0,                          5); // Rig Rainbow
  mapEffect(37, 100, LED.ORANGE,      LED.YELLOW,        0,                          5); // Rig Rainbow Fast
  mapEffect(38, 98, LED.ORANGE,       LED.YELLOW,        0,                          5); // Rig Rainbow Slow
  mapEffect(39, 123, LED.MAGENTA,     LED.BRIGHT_PURPLE, 0,                          5); // Rig Rainbow Wide

  // Rows 3-0: Spare on page 5

  // ════════════════════════════════════════════════════════════════════════
  //  GLOBAL (page 0): Track buttons, faders, Stop All
  // ════════════════════════════════════════════════════════════════════════

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
      enabled: 1, page: 0,
    });
  }

  // Scene button 8 (0x77): Stop All Effects (global)
  db.createMidiMapping({
    name: 'Stop All Effects', midi_type: 'note', midi_number: 0x77, midi_channel: 0,
    action_type: 'stop_all_effects', action_data: '{}', toggle_mode: 'momentary',
    led_color: LED.DARK_RED, led_active_color: LED.RED,
    led_behavior: 0, led_active_behavior: LED_BEHAVIOR.BLINKING_2X,
    enabled: 1, page: 0,
  });

  // Scene buttons 6-7 (0x75-0x76): spare for now

  // ── Faders ────────────────────────────────────────────────────────────
  // Fader 9 (CC 56): Master Dimmer
  db.createMidiMapping({
    name: 'Master Dimmer', midi_type: 'cc', midi_number: 56, midi_channel: 0,
    action_type: 'master_dimmer', action_data: '{}', toggle_mode: 'momentary',
    led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1, page: 0,
  });
  // Fader 8 (CC 55): Effect Speed
  db.createMidiMapping({
    name: 'Effect Speed', midi_type: 'cc', midi_number: 55, midi_channel: 0,
    action_type: 'effect_speed', action_data: '{}', toggle_mode: 'momentary',
    led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1, page: 0,
  });
  // Faders 1-7 (CC 48-54): Group dimmers
  const groups = db.getGroups ? db.getGroups() : [];
  for (let i = 0; i < Math.min(groups.length, 7); i++) {
    db.createMidiMapping({
      name: `Dimmer: ${groups[i].name}`, midi_type: 'cc', midi_number: 48 + i, midi_channel: 0,
      action_type: 'group_dimmer', action_data: JSON.stringify({ group_id: groups[i].id }),
      toggle_mode: 'momentary',
      led_color: 0, led_active_color: 0, led_behavior: 0, led_active_behavior: 0, enabled: 1, page: 0,
    });
  }

  console.log(`[MIDI] Created default APC Mini mappings (${PAGE_COUNT} pages)`);
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
  // Page system
  getCurrentPage: () => currentPage,
  switchPage,
  PAGE_NAMES,
  PAGE_COUNT,
};
