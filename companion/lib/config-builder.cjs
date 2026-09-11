/**
 * Build Bitfocus Companion .companionconfig JSON from MIDI mappings (or static fallback).
 */

const crypto = require('crypto');
const { PAGE_NAMES, COLORS_PRIMARY, COLORS_EXTENDED, EFFECT_PAGES } = require('./show-layout.cjs');

/** Effect types per show page — mirrors APC default layout grouping. */
const PAGE_EFFECT_TYPES = {
  'Color FX': new Set(['pulse', 'rainbow', 'strobe', 'color_fade', 'sparkle', 'color_wave', 'fire']),
  'Cell FX': new Set(['chase', 'comet', 'scanner', 'buildup', 'segments', 'ripple', 'cell_strobe', 'gradient']),
  'Mover FX': new Set(['pan_sweep', 'tilt_sweep', 'circle', 'figure_eight', 'random_move', 'fan', 'nod']),
  'Rig FX': new Set([
    'rig_chase', 'rig_color_wave', 'rig_sweep', 'rig_alternate', 'rig_converge',
    'rig_rainbow', 'rig_depth_chase', 'rig_depth_wave', 'rig_round_robin',
  ]),
  'Mirror FX': new Set([
    'mirror_glow', 'mirror_soft_shift', 'mirror_slow_spin', 'mirror_glitter',
    'mirror_spin_cw', 'mirror_spin_ccw', 'mirror_spin_fast_cw', 'mirror_spin_fast_ccw',
    'mirror_motor_cw', 'mirror_motor_ccw', 'mirror_motor_slow',
    'mirror_motor_fast_cw', 'mirror_motor_fast_ccw', 'mirror_motor_party',
  ]),
};

const INSTANCE_ID = 'dmx-controller-connection';
/** Must match `label` in instances — used in button text expressions. */
const CONNECTION_LABEL = 'DMX_Controller';
/** Companion 4.3 export schema (matches companionBuild 4.3.x). */
const CONFIG_VERSION = 12;

function uid() {
  return crypto.randomBytes(12).toString('base64url').slice(0, 21);
}

function mkOption(value) {
  return { isExpression: false, value };
}

function wrapOptions(options) {
  const wrapped = {};
  for (const [key, val] of Object.entries(options)) {
    wrapped[key] = mkOption(val);
  }
  return wrapped;
}

function rgbBg(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

function dimColor(r, g, b, factor = 0.35) {
  return rgbBg(Math.round(r * factor), Math.round(g * factor), Math.round(b * factor));
}

function mkAction(definitionId, options = {}, connectionId = INSTANCE_ID) {
  const action = {
    type: 'action',
    id: uid(),
    definitionId,
    connectionId,
    options: Object.keys(options).length ? wrapOptions(options) : {},
    upgradeIndex: -1,
  };
  if (connectionId === 'internal') action.children = {};
  return action;
}

function mkSetPage(pageNum) {
  return mkAction('set_page', { page: pageNum, surfaceId: 'self' }, 'internal');
}

function mkButton({ text, bgcolor = 0, color = 0xffffff, textExpression = false, down = [], up = [], feedbacks = [] }) {
  return {
    type: 'button',
    style: {
      text,
      textExpression,
      size: '14',
      png64: null,
      alignment: 'center:center',
      pngalignment: 'center:center',
      color,
      bgcolor,
      show_topbar: false,
      png: null,
      latch: false,
    },
    options: {
      stepProgression: 'auto',
      stepExpression: '',
      rotaryActions: false,
    },
    feedbacks,
    steps: {
      '0': {
        action_sets: { down, up },
        options: { runWhileHeld: [] },
      },
    },
    localVariables: [],
  };
}

function mkFeedback(definitionId, options = {}, style = {}) {
  return {
    id: uid(),
    type: 'feedback',
    definitionId,
    connectionId: INSTANCE_ID,
    options: wrapOptions(options),
    upgradeIndex: -1,
    style,
    isInverted: {
      value: false,
      isExpression: false,
    },
  };
}

function mkPage(name, controls, cols, rows) {
  return {
    id: uid(),
    name,
    controls,
    gridSize: {
      minColumn: 0,
      maxColumn: cols - 1,
      minRow: 0,
      maxRow: rows - 1,
    },
  };
}

function placeControl(controls, row, col, button) {
  if (!controls[row]) controls[row] = {};
  controls[row][String(col)] = button;
}

function fillGrid(controls, cols, rows, items) {
  let i = 0;
  for (let r = 0; r < rows && i < items.length; r++) {
    for (let c = 0; c < cols && i < items.length; c++) {
      if (items[i]) placeControl(controls, r, c, items[i]);
      i++;
    }
  }
}

function mkBlackoutButton() {
  return mkButton({
    text: 'BLACKOUT',
    bgcolor: 0xff3b30,
    color: 0xffffff,
    down: [mkAction('blackout', { mode: 'on' })],
    up: [mkAction('blackout', { mode: 'off' })],
    feedbacks: [mkFeedback('blackout_active', {}, { bgcolor: 0xff0000 })],
  });
}

function mkOutputButton() {
  return mkButton({
    text: `OUTPUT\n$(${CONNECTION_LABEL}:dmx_output_status)`,
    textExpression: true,
    bgcolor: 0xff3b30,
    color: 0xffffff,
    down: [mkAction('dmx_output', { mode: 'toggle' })],
    feedbacks: [mkFeedback('dmx_output_on', {}, { bgcolor: 0x30d158, color: 0x000000 })],
  });
}

/** Bottom row: HOME, STOP FX (or color mode on Colors page), shortcuts, BLACKOUT + OUTPUT. */
function mkHoldActionButton({ text, bgcolor, color = 0xffffff, actionId, extraOpts = {} }) {
  return mkButton({
    text,
    bgcolor,
    color,
    down: [mkAction(actionId, { ...extraOpts, mode: 'on' })],
    up: [mkAction(actionId, { ...extraOpts, mode: 'off' })],
  });
}

function mkMirrorSpinBlockButton() {
  return mkButton({
    text: 'NO\nSPIN',
    bgcolor: 0x546e7a,
    color: 0xffffff,
    down: [mkAction('mirror_spin_block', { mode: 'toggle' })],
    feedbacks: [mkFeedback('mirror_spin_blocked', {}, { bgcolor: 0xff9f0a, color: 0x000000, text: 'NO\nSPIN' })],
  });
}

function mkHomeUtilityButtons() {
  return [
    mkHoldActionButton({ text: 'STROBE', bgcolor: 0xffd60a, color: 0x000000, actionId: 'strobe' }),
    mkHoldActionButton({ text: 'SMOKE', bgcolor: 0x78909c, actionId: 'smoke' }),
    mkHoldActionButton({ text: 'FIRE', bgcolor: 0xbf360c, actionId: 'fire' }),
    mkMirrorSpinBlockButton(),
  ];
}

function mkStopFxButton() {
  return mkButton({
    text: 'STOP\nFX',
    bgcolor: 0x555555,
    color: 0xffffff,
    down: [mkAction('stop_effects', { slot: 'all' })],
  });
}

/** Colors page nav: switch between push/release and tap-toggle for color keys. */
function mkColorModeToggleButton() {
  return mkButton({
    text: 'PUSH',
    textExpression: false,
    bgcolor: 0x48484a,
    color: 0xffffff,
    down: [mkAction('toggle_color_mode', {})],
    feedbacks: [
      mkFeedback('color_push_mode', {}, { bgcolor: 0x30d158, color: 0x000000, text: 'PUSH' }),
      mkFeedback('color_toggle_mode', {}, { bgcolor: 0xff9f0a, color: 0x000000, text: 'TOGGLE' }),
    ],
  });
}

function mkColorButton(c) {
  const { r, g, b, w = 0 } = c;
  const lum = r + g + b;
  const colorOpts = { red: r, green: g, blue: b, white: w };
  return mkButton({
    text: c.name,
    bgcolor: rgbBg(r, g, b),
    color: lum > 380 ? 0x000000 : 0xffffff,
    down: [mkAction('set_color_press', colorOpts)],
    up: [mkAction('release_color', {})],
  });
}

function addNavBar(controls, cols, rows, pageMap, currentPageName) {
  const navRow = rows - 1;
  const maxShortcutCol = cols - 3;
  const homePage = pageMap.Home;
  const onHome = currentPageName === 'Home';

  // Home already lists every page in the content grid — nav is essentials only.
  if (!onHome) {
    placeControl(controls, navRow, 0, mkButton({
      text: 'HOME',
      bgcolor: 0x333333,
      color: 0xffffff,
      down: [mkSetPage(homePage)],
    }));
  }

  placeControl(controls, navRow, 1, currentPageName === 'Colors'
    ? mkColorModeToggleButton()
    : currentPageName === 'Mirror FX'
      ? mkMirrorSpinBlockButton()
      : mkStopFxButton());

  if (!onHome) {
    const shortcuts = [
      { key: 'Fixtures', label: 'Fixtures' },
      { key: 'Scenes', label: 'Scenes' },
      { key: 'Colors', label: 'Colors' },
      { key: 'Color FX', label: 'Color\nFX' },
      { key: 'Cell FX', label: 'Cell\nFX' },
      { key: 'Mover FX', label: 'Mover\nFX' },
      { key: 'Rig FX', label: 'Rig\nFX' },
      { key: 'Mirror FX', label: 'Mirror\nFX' },
    ].filter((p) => p.key !== currentPageName);

    let col = 2;
    for (const p of shortcuts) {
      if (col > maxShortcutCol) break;
      placeControl(controls, navRow, col++, mkButton({
        text: p.label,
        bgcolor: 0x0a84ff,
        color: 0xffffff,
        down: [mkSetPage(pageMap[p.key])],
      }));
    }
  }

  placeControl(controls, navRow, cols - 2, mkBlackoutButton());
  placeControl(controls, navRow, cols - 1, mkOutputButton());
}

function parseActionData(raw) {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

function labelText(name) {
  return name.length > 10 ? name.replace(/\s+/g, '\n') : name;
}

/** Convert one MIDI mapping row into a Companion button (or null). */
function mappingToButton(mapping, effects = []) {
  const data = parseActionData(mapping.action_data);
  const toggle = mapping.toggle_mode === 'toggle';
  const momentary = mapping.toggle_mode === 'momentary';

  switch (mapping.action_type) {
    case 'color': {
      const { red = 0, green = 0, blue = 0, white = 0 } = data;
      const bg = rgbBg(red, green, blue);
      const lum = red + green + blue;
      const colorOpts = { red, green, blue, white };
      return mkButton({
        text: labelText(mapping.name),
        bgcolor: bg,
        color: lum > 380 ? 0x000000 : 0xffffff,
        down: [mkAction('set_color_press', colorOpts)],
        // PUSH/TOGGLE is server-side; Stream Deck always needs press + release.
        up: [mkAction('release_color', {})],
      });
    }
    case 'effect': {
      const effectId = resolveEffectId(mapping.name, effects) || data.effect_id;
      if (!effectId) return null;
      return mkButton({
        text: labelText(mapping.name),
        bgcolor: dimColor(255, 140, 0),
        color: 0xffffff,
        down: [mkAction('run_effect', {
          effect_id: String(effectId),
          effect_name: mapping.name,
          target: 'all',
          group_id: '',
          mode: toggle ? 'toggle' : 'on',
        })],
        up: momentary ? [mkAction('run_effect', {
          effect_id: String(effectId),
          effect_name: mapping.name,
          target: 'all',
          group_id: '',
          mode: 'off',
        })] : [],
      });
    }
    case 'blackout':
      return mkBlackoutButton();
    case 'strobe':
      return mkHoldActionButton({ text: 'STROBE', bgcolor: 0xffd60a, color: 0x000000, actionId: 'strobe' });
    case 'smoke':
      return mkHoldActionButton({ text: 'SMOKE', bgcolor: 0x78909c, actionId: 'smoke' });
    case 'fire':
      return mkHoldActionButton({ text: 'FIRE', bgcolor: 0xbf360c, actionId: 'fire' });
    case 'full_on':
      return mkButton({
        text: 'FULL ON',
        bgcolor: 0xffffff,
        color: 0x000000,
        down: [mkAction('full_on', { mode: 'on' })],
        up: [mkAction('full_on', { mode: 'off' })],
      });
    case 'stop_all_effects':
      return mkStopFxButton();
    default:
      return null;
  }
}

function gridMappingsForPage(midiMappings, pageNum, effects = []) {
  return midiMappings
    .filter((m) => m.enabled && (m.page || 0) === pageNum && m.midi_type === 'note')
    .filter((m) => m.midi_number >= 0 && m.midi_number <= 63)
    .sort((a, b) => b.midi_number - a.midi_number)
    .map((m) => mappingToButton(m, effects))
    .filter(Boolean);
}

function globalMappings(midiMappings) {
  return midiMappings
    .filter((m) => m.enabled && (m.page || 0) === 0 && m.midi_type === 'note')
    .filter((m) => m.midi_number >= 0x64 || m.midi_number === 0x77)
    .sort((a, b) => a.midi_number - b.midi_number);
}

function mkPageShortcut(key, label, pageMap, bgcolor = 0x0a84ff) {
  return mkButton({
    text: label,
    bgcolor,
    color: 0xffffff,
    down: [mkSetPage(pageMap[key])],
  });
}

function buildHomePage(pageMap, midiMappings, effects, cols, rows) {
  const controls = {};
  const contentRows = rows - 1;
  const maxItems = cols * contentRows;

  const pageLinks = [
    mkPageShortcut('Fixtures', 'Fixtures', pageMap, 0x48484a),
    mkPageShortcut('Scenes', 'Scenes', pageMap, 0x5856d6),
    mkPageShortcut('Colors', 'Colors', pageMap, 0x0a84ff),
    mkPageShortcut('Color FX', 'Color\nFX', pageMap, 0x0a84ff),
    mkPageShortcut('Cell FX', 'Cell\nFX', pageMap, 0x0a84ff),
    mkPageShortcut('Mover FX', 'Mover\nFX', pageMap, 0x0a84ff),
    mkPageShortcut('Rig FX', 'Rig\nFX', pageMap, 0x0a84ff),
    mkPageShortcut('Mirror FX', 'Mirror\nFX', pageMap, 0xf06292),
  ];

  const homeUtilities = mkHomeUtilityButtons();
  const skipHomeGlobals = new Set(['strobe', 'smoke', 'fire']);

  const globals = globalMappings(midiMappings)
    .filter((m) => m.action_type !== 'blackout' && m.action_type !== 'stop_all_effects')
    .filter((m) => !skipHomeGlobals.has(m.action_type))
    .map((m) => mappingToButton(m, effects))
    .filter(Boolean);

  const sceneOff = mkButton({
    text: 'SCENE\nOFF',
    bgcolor: 0x444444,
    color: 0xffffff,
    down: [mkAction('deactivate_scene', {})],
  });

  fillGrid(controls, cols, contentRows, [...pageLinks, ...homeUtilities, ...globals, sceneOff].slice(0, maxItems));
  addNavBar(controls, cols, rows, pageMap, 'Home');
  return mkPage('Home', controls, cols, rows);
}

function mkFixtureButton(fixture) {
  return mkButton({
    text: labelText(fixture.name),
    bgcolor: 0x3a3a3c,
    color: 0xffffff,
    down: [mkAction('toggle_fixture', {
      fixture_id: String(fixture.id),
      fixture_name: fixture.name,
      mode: 'toggle',
    })],
    feedbacks: [mkFeedback('fixture_enabled', { fixture_id: String(fixture.id) }, {
      bgcolor: 0x30d158,
      color: 0x000000,
    })],
  });
}

function buildFixturesPage(fixtures, cols, rows, pageMap) {
  const contentRows = rows - 1;
  const maxItems = cols * contentRows;
  const items = (fixtures || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, maxItems)
    .map(mkFixtureButton);
  const controls = {};
  fillGrid(controls, cols, contentRows, items);
  addNavBar(controls, cols, rows, pageMap, 'Fixtures');
  return mkPage('Fixtures', controls, cols, rows);
}

function mkSceneButton(scene) {
  return mkButton({
    text: labelText(scene.name),
    bgcolor: 0x5856d6,
    color: 0xffffff,
    down: [mkAction('activate_scene', {
      scene_id: String(scene.id),
      scene_name: scene.name,
      mode: 'toggle',
    })],
    feedbacks: [mkFeedback('scene_active', { scene_id: String(scene.id) }, {
      bgcolor: 0x30d158,
      color: 0x000000,
    })],
  });
}

function buildScenesPage(scenes, cols, rows, pageMap) {
  const contentRows = rows - 1;
  const maxItems = cols * contentRows;
  const sceneOff = mkButton({
    text: 'SCENE\nOFF',
    bgcolor: 0x444444,
    color: 0xffffff,
    down: [mkAction('deactivate_scene', {})],
  });
  const items = (scenes || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, Math.max(0, maxItems - 1))
    .map(mkSceneButton);
  const controls = {};
  fillGrid(controls, cols, contentRows, [...items, sceneOff]);
  addNavBar(controls, cols, rows, pageMap, 'Scenes');
  return mkPage('Scenes', controls, cols, rows);
}

function colorsForStreamDeck(midiMappings, cols) {
  const fromMidi = (midiMappings || [])
    .filter((m) => m.enabled && (m.page || 0) === 1 && m.action_type === 'color' && m.midi_type === 'note')
    .sort((a, b) => b.midi_number - a.midi_number)
    .map((m) => {
      const d = parseActionData(m.action_data);
      return {
        name: m.name,
        r: d.red ?? 0,
        g: d.green ?? 0,
        b: d.blue ?? 0,
        w: d.white ?? 0,
      };
    });
  if (fromMidi.length > 0) return fromMidi;
  return cols >= 8
    ? [...COLORS_PRIMARY, ...COLORS_EXTENDED]
    : COLORS_PRIMARY;
}

function buildColorsPage(midiMappings, effects, cols, rows, pageMap) {
  const contentRows = rows - 1;
  const maxItems = cols * contentRows;
  // Stream Deck grid != APC 8×8 note order; always build press+release color buttons.
  const items = colorsForStreamDeck(midiMappings, cols).slice(0, maxItems).map(mkColorButton);
  const controls = {};
  fillGrid(controls, cols, contentRows, items);
  addNavBar(controls, cols, rows, pageMap, 'Colors');
  return mkPage('Colors', controls, cols, rows);
}

function buildEffectPage(name, pageNum, midiMappings, effects, cols, rows, pageMap) {
  const contentRows = rows - 1;
  const maxItems = cols * contentRows;
  // Always build from live effects — Stream Deck grid layout != APC 8×8 MIDI note order,
  // and MIDI mappings often carry stale effect IDs after DB re-seed.
  const items = effectsForPage(name, effects).slice(0, maxItems).map(mkEffectButton);
  const controls = {};
  fillGrid(controls, cols, contentRows, items);
  addNavBar(controls, cols, rows, pageMap, name);
  return mkPage(name, controls, cols, rows);
}

function normalizeEffectName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/\u2192/g, '->')
    .replace(/\u2190/g, '<-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function resolveEffectId(name, effects) {
  if (!name) return null;
  const exact = effects.find((e) => e.name === name);
  if (exact) return exact.id;
  const norm = normalizeEffectName(name);
  const normalized = effects.find((e) => normalizeEffectName(e.name) === norm);
  if (normalized) return normalized.id;
  const loose = effects.find((e) => normalizeEffectName(e.name).includes(norm));
  return loose ? loose.id : null;
}

/** Pick effects for a show page, preferring APC order then alphabetical. */
function effectsForPage(pageName, effects) {
  const types = PAGE_EFFECT_TYPES[pageName];
  if (!types) return [];
  const typed = effects.filter((e) => types.has(e.type));
  const byName = new Map(typed.map((e) => [e.name, e]));
  const ordered = [];
  const seen = new Set();
  for (const name of EFFECT_PAGES[pageName] || []) {
    const e = byName.get(name);
    if (e && !seen.has(e.id)) {
      ordered.push(e);
      seen.add(e.id);
    }
  }
  for (const e of typed.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!seen.has(e.id)) ordered.push(e);
  }
  return ordered;
}

function mkEffectButton(effect) {
  return mkButton({
    text: labelText(effect.name),
    bgcolor: dimColor(255, 140, 0),
    color: 0xffffff,
    down: [mkAction('run_effect', {
      effect_id: String(effect.id),
      effect_name: effect.name,
      target: 'all',
      group_id: '',
      mode: 'toggle',
    })],
  });
}

function buildCompanionConfig(opts) {
  const layout = opts.layout || 'streamdeck15';
  const cols = layout === 'streamdeck-xl' ? 8 : 5;
  const rows = layout === 'streamdeck-xl' ? 4 : 3;
  const midiMappings = opts.midiMappings || [];
  const effects = opts.effects || [];
  const fixtures = opts.fixtures || [];
  const scenes = opts.scenes || [];

  const pages = {};
  let pageNum = 1;
  const pageMap = {
    Home: pageNum,
    Fixtures: pageNum + 1,
    Scenes: pageNum + 2,
    Colors: pageNum + 3,
    'Color FX': pageNum + 4,
    'Cell FX': pageNum + 5,
    'Mover FX': pageNum + 6,
    'Rig FX': pageNum + 7,
    'Mirror FX': pageNum + 8,
  };

  pages[String(pageNum++)] = buildHomePage(pageMap, midiMappings, effects, cols, rows);
  pages[String(pageNum++)] = buildFixturesPage(fixtures, cols, rows, pageMap);
  pages[String(pageNum++)] = buildScenesPage(scenes, cols, rows, pageMap);
  pages[String(pageNum++)] = buildColorsPage(midiMappings, effects, cols, rows, pageMap);
  for (let i = 0; i < PAGE_NAMES.length; i++) {
    pages[String(pageNum++)] = buildEffectPage(PAGE_NAMES[i], i + 2, midiMappings, effects, cols, rows, pageMap);
  }

  const host = opts.host || '127.0.0.1';
  const port = opts.port || 80;

  return {
    version: CONFIG_VERSION,
    type: 'full',
    pages,
    instances: {
      [INSTANCE_ID]: {
        moduleId: 'dmx-controller',
        label: CONNECTION_LABEL,
        lastUpgradeIndex: -1,
        moduleVersionId: 'dev',
        sortOrder: 0,
        isFirstInit: false,
        config: { host, port },
        enabled: true,
      },
    },
    connectionCollections: [],
  };
}

module.exports = {
  INSTANCE_ID,
  buildCompanionConfig,
  mappingToButton,
  resolveEffectId,
  effectsForPage,
};
