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
  fxTab: 'color',          // active effect category tab
  actionActiveStates: {},  // touch-action id → bool
  selectedMovers: new Set(), // empty = all movers

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
  rig_chase: 'rig', rig_color_wave: 'rig', rig_sweep: 'rig', rig_alternate: 'rig', rig_converge: 'rig', rig_rainbow: 'rig',
  rig_depth_chase: 'rig', rig_depth_wave: 'rig', rig_round_robin: 'rig',
  sound_pulse: 'sound', sound_strobe: 'sound', sound_chase: 'sound', sound_wave: 'sound', sound_flash: 'sound', sound_vu: 'sound',
};

const EFFECT_CATEGORIES = [
  { key: 'color',     label: 'Color',      bg: 'rgba(96,165,250,.16)',  border: 'rgba(96,165,250,.5)'  },
  { key: 'rig',       label: 'Rig',        bg: 'rgba(52,211,153,.14)',  border: 'rgba(52,211,153,.5)'  },
  { key: 'motion',    label: 'Movement',   bg: 'rgba(251,191,36,.14)',  border: 'rgba(251,191,36,.5)'  },
  { key: 'multicell', label: 'Multi-Cell', bg: 'rgba(167,139,250,.16)', border: 'rgba(167,139,250,.5)' },
  { key: 'sound',     label: 'Sound',      bg: 'rgba(251,113,133,.14)', border: 'rgba(251,113,133,.5)' },
];

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
