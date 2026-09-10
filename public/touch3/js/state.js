/* Thaluxis Touch 3 — shared state.
   This UI is a thin remote control: all lighting decisions happen on the
   server. State here only mirrors server state for rendering. */
'use strict';

const S = {
  fixtures: [],
  groups: [],
  scenes: [],
  effects: [],
  touchActions: [],
  moverPresets: [],
  favorites: [],

  fixtureEnabled: {},   // fixtureId → bool (mirrors server disabledFixtures)
  groupDimmer: {},      // groupId → 0-255
  masterDim: 255,
  effectSpeed: 1.0,

  outputEnabled: false,
  blackoutActive: false,

  selectedColor: null,  // index into COLORS (toggle mode latch)
  colorIntensity: 255,
  colorHoldMode: true,
  selectedGroup: null,  // group id or null = all fixtures

  activeSceneId: null,
  activeEffectSlots: {},   // slot → effectId
  activePanel: 'effects',   // actions | colors | scenes | effects | favorites
  fxTab: 'multicell',       // active effect category tab
  fxPaletteMode: 'hsl',    // 'hsl' | 'palette'
  fxPalettePreset: 'hsl',
  fxPaletteColors: ['#e94560', '#f39c12', '#27ae60', '#2980b9'],
  actionActiveStates: {},  // touch-action id → bool
  selectedMovers: new Set(), // empty = all movers
  favEditMode: false,
  favPickerTab: 'colors',

  ws: null,
};

const COLORS = [
  { name: 'Red',     hex: '#ff3b30', r: 255, g: 0,   b: 0   },
  { name: 'Green',   hex: '#30d158', r: 0,   g: 255, b: 0   },
  { name: 'Blue',    hex: '#0a84ff', r: 0,   g: 0,   b: 255 },
  { name: 'White',   hex: '#ffffff', r: 255, g: 255, b: 255 },
  { name: 'Amber',   hex: '#ff9f0a', r: 255, g: 160, b: 0   },
  { name: 'UV',      hex: '#bf5af2', r: 120, g: 0,   b: 255 },
  { name: 'Yellow',  hex: '#ffd60a', r: 255, g: 235, b: 0   },
  { name: 'Magenta', hex: '#ff375f', r: 255, g: 0,   b: 150 },
  { name: 'Cyan',    hex: '#64d2ff', r: 0,   g: 220, b: 255 },
  { name: 'Pink',    hex: '#ff6482', r: 255, g: 120, b: 180 },
  { name: 'Lime',    hex: '#a8ff00', r: 180, g: 255, b: 0   },
  { name: 'Orange',  hex: '#ff6723', r: 255, g: 100, b: 0   },
];

const EFFECT_CATEGORY_MAP = {
  pulse: 'color', rainbow: 'color', strobe: 'color', color_fade: 'color', sparkle: 'color', color_wave: 'color', fire: 'color',
  pan_sweep: 'motion', tilt_sweep: 'motion', circle: 'motion', figure_eight: 'motion', random_move: 'motion', fan: 'motion', nod: 'motion',
  chase: 'multicell', comet: 'multicell', scanner: 'multicell', buildup: 'multicell', segments: 'multicell', ripple: 'multicell', cell_strobe: 'multicell', gradient: 'multicell',
  checker: 'multicell', matrix_alternate: 'multicell', diagonal: 'multicell', plasma: 'multicell', rain: 'multicell', fill_rows: 'multicell',
  rig_chase: 'rig', rig_color_wave: 'rig', rig_sweep: 'rig', rig_alternate: 'rig', rig_converge: 'rig', rig_rainbow: 'rig',
  rig_depth_chase: 'rig', rig_depth_wave: 'rig', rig_round_robin: 'rig',
  sound_pulse: 'sound', sound_strobe: 'sound', sound_chase: 'sound', sound_wave: 'sound', sound_flash: 'sound', sound_vu: 'sound',
  mirror_glow: 'mirror', mirror_soft_shift: 'mirror', mirror_slow_spin: 'mirror', mirror_glitter: 'mirror',
  mirror_spin_cw: 'mirror', mirror_spin_ccw: 'mirror',
  mirror_spin_fast_cw: 'mirror', mirror_spin_fast_ccw: 'mirror',
};

const EFFECT_CATEGORIES = [
  { key: 'color',     label: 'Color',      bg: 'rgba(96,165,250,.16)',  border: 'rgba(96,165,250,.5)'  },
  { key: 'rig',       label: 'Rig',        bg: 'rgba(52,211,153,.14)',  border: 'rgba(52,211,153,.5)'  },
  { key: 'motion',    label: 'Movement',   bg: 'rgba(251,191,36,.14)',  border: 'rgba(251,191,36,.5)'  },
  { key: 'multicell', label: 'Multi-Cell', bg: 'rgba(167,139,250,.16)', border: 'rgba(167,139,250,.5)' },
  { key: 'sound',     label: 'Sound',      bg: 'rgba(251,113,133,.14)', border: 'rgba(251,113,133,.5)' },
  { key: 'mirror',    label: 'Mirror',     bg: 'rgba(244,114,182,.14)', border: 'rgba(244,114,182,.5)' },
];

const FX_PALETTE_PRESETS = {
  hsl:    { mode: 'hsl', label: 'Rainbow' },
  warm:   { mode: 'palette', label: 'Warm',   colors: ['#ff4d00', '#ff9e00', '#ffd000', '#ff3366'] },
  cool:   { mode: 'palette', label: 'Cool',   colors: ['#0066ff', '#00c6ff', '#5b4fcf', '#48d1cc'] },
  neon:   { mode: 'palette', label: 'Neon',   colors: ['#ff00ff', '#00ffff', '#ffff00', '#ff0066'] },
  ocean:  { mode: 'palette', label: 'Ocean',  colors: ['#001a4d', '#0066cc', '#00a8cc', '#66d9cc'] },
  fire:   { mode: 'palette', label: 'Fire',   colors: ['#1a0000', '#ff3300', '#ff9900', '#ffcc00'] },
  sunset: { mode: 'palette', label: 'Sunset', colors: ['#1a0533', '#ff6b35', '#f7c59f', '#ffcc02'] },
  purple: { mode: 'palette', label: 'Purple', colors: ['#1a0033', '#6600cc', '#cc00ff', '#ff66ff'] },
  gold:   { mode: 'palette', label: 'Gold',   colors: ['#1a1000', '#b8860b', '#ffd700', '#fff8dc'] },
  ice:    { mode: 'palette', label: 'Ice',    colors: ['#001833', '#004466', '#66ccff', '#ffffff'] },
  forest: { mode: 'palette', label: 'Forest', colors: ['#0a1f0a', '#1a661a', '#33cc33', '#a8e063'] },
  party:  { mode: 'palette', label: 'Party',  colors: ['#ff0080', '#8000ff', '#00ff80', '#ff8000'] },
  pastel: { mode: 'palette', label: 'Pastel', colors: ['#ffb3ba', '#ffdfba', '#ffffba', '#baffc9'] },
  vapor:  { mode: 'palette', label: 'Vapor',  colors: ['#7117ea', '#ea17a7', '#17eae8', '#a717ea'] },
  citrus: { mode: 'palette', label: 'Citrus', colors: ['#ff9900', '#ffcc00', '#66ff00', '#00cc66'] },
  crimson:{ mode: 'palette', label: 'Crimson',colors: ['#1a0008', '#660019', '#cc0033', '#ff6666'] },
  custom: { mode: 'palette', label: 'Custom' },
};

function getFxPaletteParams() {
  if (S.fxPaletteMode === 'hsl') return { color_mode: 'hsl' };
  const sw = S.fxPaletteColors.filter(Boolean);
  if (sw.length < 2) return { color_mode: 'hsl' };
  return { color_mode: 'palette', color_palette: sw.slice(0, 4) };
}

function usesFxPalette() {
  return true;
}

/** Fixture IDs for live effect run — respects multicell / mover targets. */
function getEffectFixtureIds(effect) {
  const enabled = getEnabledFixtures();
  const slot = effectSlot(effect.type);
  if (slot === 'motion') {
    return getSelectedMovers().map((f) => f.id);
  }
  const mc = enabled.filter((f) => (f.cell_count || 0) > 0);
  if (slot === 'multicell' || effect.fixture_target === 'multicell'
    || (MULTICELL_EFFECT_TYPES.has(effect.type) && mc.length)) {
    if (mc.length) return mc.map((f) => f.id);
  }
  if (effect.fixture_target === 'moving_head' || effect.fixture_target === 'moving_head_wash' || effect.fixture_target === 'moving_head_spot') {
    return getEnabledFixtures(getMoverFixtures()).map((f) => f.id);
  }
  if (slot === 'mirror' || effect.fixture_target === 'mirror_ball') {
    const mirrors = enabled.filter((f) => f.category === 'mirror_ball');
    if (mirrors.length) return mirrors.map((f) => f.id);
  }
  return enabled.map((f) => f.id);
}

const MULTICELL_EFFECT_TYPES = new Set([
  'chase', 'comet', 'scanner', 'buildup', 'segments', 'ripple', 'cell_strobe', 'gradient',
  'checker', 'matrix_alternate', 'diagonal', 'plasma', 'rain', 'fill_rows',
]);

function effectSlot(type) {
  return EFFECT_CATEGORY_MAP[type] || 'color';
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

function getEnabledFixtures(list) {
  return (list || S.fixtures).filter((f) => S.fixtureEnabled[f.id] !== false);
}

function getMoverFixtures() {
  return S.fixtures.filter((f) =>
    f.channels.some((ch) => ch.type === 'pan') && f.channels.some((ch) => ch.type === 'tilt'));
}

function getMirrorBallFixtures() {
  return S.fixtures.filter((f) =>
    f.category === 'mirror_ball' || f.channels.some((ch) => ch.type === 'motor'));
}

function getSelectedMovers() {
  const movers = getEnabledFixtures(getMoverFixtures());
  if (S.selectedMovers.size === 0) return movers;
  return movers.filter((f) => S.selectedMovers.has(f.id));
}

/** Press-and-hold or tap-to-toggle behavior for a button, following holdMode(). */
function bindHoldToggle(el, onFn, offFn, holdMode) {
  let isOn = false;
  let touchActive = false;
  const isHold = typeof holdMode === 'function' ? holdMode : () => !!holdMode;

  function activate(e) {
    if (e && e.cancelable) e.preventDefault();
    if (isHold()) { if (!isOn) { isOn = true; onFn(); } }
    else if (isOn) { isOn = false; offFn(); }
    else { isOn = true; onFn(); }
  }
  function deactivate(e) {
    if (e && e.cancelable) e.preventDefault();
    if (isHold() && isOn) { isOn = false; offFn(); }
  }

  el.addEventListener('touchstart', (e) => { touchActive = true; activate(e); }, { passive: false });
  el.addEventListener('touchend', (e) => { touchActive = false; deactivate(e); }, { passive: false });
  el.addEventListener('touchcancel', (e) => { touchActive = false; deactivate(e); }, { passive: false });
  el.addEventListener('mousedown', (e) => { if (!touchActive) activate(e); });
  el.addEventListener('mouseup', (e) => { if (!touchActive) deactivate(e); });
  el.addEventListener('mouseleave', () => { if (!touchActive && isHold() && isOn) { isOn = false; offFn(); } });

  el._holdReset = () => { if (isOn) { isOn = false; offFn(); } };
}
