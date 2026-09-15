/**
 * Sound-reactive BPM live looks (sequencer sound FX + plugin-native spectrum/chase).
 */

const { computeEffectValue, hslToRgb } = require('../../effects-engine');

const COLOR_TYPES = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv', 'dimmer']);

const CUSTOM_SOUND_LOOKS = ['spectrum', 'kick_chase', 'mid_treble_alternate', 'sub_flash'];

/** Sequencer sound effect types — progress is BPM-scaled when provided. */
const SOUND_ENGINE_SPECS = {
  sound_flash: {
    type: 'sound_flash',
    label: 'Beat flash',
    params: { decay: 0.82 },
    needsProgress: false,
  },
  sound_pulse_bass: {
    type: 'sound_pulse',
    label: 'Bass pulse',
    params: { band: 'bass', sensitivity: 1.15 },
    needsProgress: false,
  },
  sound_pulse_energy: {
    type: 'sound_pulse',
    label: 'Energy pulse',
    params: { band: 'energy', sensitivity: 1.0 },
    needsProgress: false,
  },
  sound_pulse_treble: {
    type: 'sound_pulse',
    label: 'Treble pulse',
    params: { band: 'treble', sensitivity: 1.2 },
    needsProgress: false,
  },
  sound_strobe: {
    type: 'sound_strobe',
    label: 'Energy strobe',
    params: { band: 'energy', threshold: 0.55 },
    needsProgress: false,
  },
  sound_strobe_bass: {
    type: 'sound_strobe',
    label: 'Bass strobe',
    params: { band: 'bass', threshold: 0.5 },
    needsProgress: false,
  },
  sound_chase: {
    type: 'sound_chase',
    label: 'Bass chase (BPM)',
    params: { band: 'bass', width: 0.22, speed: 1 },
    needsProgress: true,
  },
  sound_wave: {
    type: 'sound_wave',
    label: 'Energy color wave (BPM)',
    params: { speed: 0.65, sensitivity: 1.4 },
    needsProgress: true,
  },
  sound_vu: {
    type: 'sound_vu',
    label: 'VU meter (rig height)',
    params: {},
    needsProgress: false,
  },
  sound_vu_lr: {
    type: 'sound_vu_lr',
    label: 'VU meter (left → right)',
    params: {},
    needsProgress: false,
  },
  sound_vu_tb: {
    type: 'sound_vu_tb',
    label: 'VU meter (top → bottom)',
    params: {},
    needsProgress: false,
  },
};

const SOUND_ENGINE_LOOKS = Object.keys(SOUND_ENGINE_SPECS);

const AUTO_ROTATE_MODES = [
  'sound_flash',
  'sound_pulse_bass',
  'sound_chase',
  'sound_wave',
  'spectrum',
  'kick_chase',
  'sound_vu_lr',
  'mid_treble_alternate',
];

const LOOKS = [...SOUND_ENGINE_LOOKS, ...CUSTOM_SOUND_LOOKS, 'auto_rotate'];

function sortedColorFixtures(fixtures) {
  return fixtures
    .filter((f) => f.channels.some((ch) => COLOR_TYPES.has(ch.type)))
    .sort((a, b) => {
      if (a.universe !== b.universe) return a.universe - b.universe;
      const addrA = Math.min(...a.channels.map((c) => c.dmx_address));
      const addrB = Math.min(...b.channels.map((c) => c.dmx_address));
      return addrA - addrB || a.id - b.id;
    });
}

function levelsToAudio(levels) {
  if (!levels) {
    return { bass: 0, mid: 0, treble: 0, energy: 0, beat: 0, sub_bass: 0 };
  }
  return {
    bass: levels.bass ?? 0,
    mid: levels.mid ?? 0,
    treble: levels.treble ?? 0,
    energy: levels.energy ?? 0,
    beat: levels.beat ?? 0,
    sub_bass: levels.sub_bass ?? levels.bass ?? 0,
  };
}

function buildCellContext(fixture, index, list) {
  const n = Math.max(1, list.length);
  return {
    channel_number: index + 1,
    channel_type: 'red',
    total_channels: n,
    cell_count: n,
    cell: index + 1,
    _rigPosition: fixture.rig_x ?? (n > 1 ? index / (n - 1) : 0.5),
    _rigPositionY: fixture.rig_y ?? (n > 1 ? index / (n - 1) : 0.5),
    _rigPositionZ: fixture.rig_z ?? 0.5,
    _rigOrder: fixture.rig_order ?? index,
    _rigFixtureCount: n,
    _fixtureOrdinal: index,
    _fixtureCount: n,
  };
}

function rgbFromHue(hueDeg, sat, light) {
  return hslToRgb((hueDeg % 360) / 360, sat, light);
}

function applyIntensity(r, g, b, dim, intensity) {
  return {
    r: Math.round(r * intensity),
    g: Math.round(g * intensity),
    b: Math.round(b * intensity),
    dim: Math.round(dim * intensity),
  };
}

function computeEngineSoundLook(lookId, params) {
  const spec = SOUND_ENGINE_SPECS[lookId];
  const { fixtures, effectProgress, intensity, audio } = params;
  const list = sortedColorFixtures(fixtures);
  const out = new Map();
  const effect = { type: spec.type, effect_data: {} };
  const fxParams = { ...(spec.params || {}), audio };
  const progress = spec.needsProgress ? (effectProgress ?? 0) : 0;
  const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };

  for (let i = 0; i < list.length; i++) {
    const fix = list[i];
    const ctx = buildCellContext(fix, i, list);
    let r = 0;
    let g = 0;
    let b = 0;
    let dim = 255;
    let hasRgb = false;

    for (const ch of fix.channels) {
      if (!COLOR_TYPES.has(ch.type)) continue;
      ctx.channel_type = ch.type;
      const val = computeEffectValue(effect, ch.type, progress, baseValues, fxParams, ctx);
      if (val == null) continue;
      const v = Math.max(0, Math.min(255, Math.round(val)));
      if (ch.type === 'red') { r = v; hasRgb = true; }
      else if (ch.type === 'green') { g = v; hasRgb = true; }
      else if (ch.type === 'blue') { b = v; hasRgb = true; }
      else if (ch.type === 'dimmer') dim = v;
      else if (ch.type === 'white' && !fix.channels.some((c) => c.type === 'red')) {
        r = g = b = v;
        hasRgb = true;
      }
    }

    if (!hasRgb) continue;
    out.set(fix.id, applyIntensity(r, g, b, dim, intensity));
  }

  return { fixtureColors: out, effectiveLook: lookId };
}

function computeCustomSoundLook(lookId, params) {
  const { fixtures, effectProgress, intensity, audio } = params;
  const list = sortedColorFixtures(fixtures);
  const out = new Map();
  const bass = Math.sqrt(audio.bass || 0);
  const mid = Math.sqrt(audio.mid || 0);
  const treble = Math.sqrt(audio.treble || 0);
  const energy = Math.sqrt(audio.energy || 0);
  const beat = audio.beat || 0;
  const sub = Math.sqrt(audio.sub_bass || audio.bass || 0);
  const n = list.length || 1;
  const progress = effectProgress ?? 0;

  switch (lookId) {
    case 'spectrum': {
      const bands = [
        { level: sub, hue: 285 },
        { level: bass, hue: 12 },
        { level: mid, hue: 125 },
        { level: treble, hue: 205 },
      ];
      for (let i = 0; i < list.length; i++) {
        const t = n > 1 ? i / (n - 1) : 0;
        const bandF = t * (bands.length - 1);
        const i0 = Math.floor(bandF);
        const i1 = Math.min(bands.length - 1, i0 + 1);
        const mix = bandF - i0;
        const lv = bands[i0].level * (1 - mix) + bands[i1].level * mix;
        const hue = bands[i0].hue * (1 - mix) + bands[i1].hue * mix;
        const [r, g, b] = rgbFromHue(hue, 0.88, 0.22 + lv * 0.52);
        const dim = Math.round((0.08 + lv * 0.72 + beat * 0.35) * 255);
        out.set(list[i].id, applyIntensity(r, g, b, dim, intensity));
      }
      break;
    }
    case 'kick_chase': {
      const head = progress % 1;
      const width = 0.14 + bass * 0.12;
      for (let i = 0; i < list.length; i++) {
        const pos = n > 1 ? i / (n - 1) : 0.5;
        let dist = Math.abs(pos - head);
        if (dist > 0.5) dist = 1 - dist;
        const chase = Math.max(0, 1 - dist / width);
        const bright = Math.min(1, chase * (0.35 + bass * 0.65) + beat * 0.45);
        const hue = 18 + bass * 40 + pos * 50;
        const [r, g, b] = rgbFromHue(hue, 0.92, 0.28 + bright * 0.42);
        const dim = Math.round(bright * 255);
        out.set(list[i].id, applyIntensity(r, g, b, dim, intensity));
      }
      break;
    }
    case 'mid_treble_alternate': {
      for (let i = 0; i < list.length; i++) {
        const even = i % 2 === 0;
        const lv = even ? mid : treble;
        const hue = even ? 130 + mid * 60 : 210 + treble * 50;
        const [r, g, b] = rgbFromHue(hue, 0.85, 0.2 + lv * 0.55);
        const dim = Math.round((0.06 + lv * 0.78 + beat * 0.28) * 255);
        out.set(list[i].id, applyIntensity(r, g, b, dim, intensity));
      }
      break;
    }
    case 'sub_flash': {
      const flash = Math.min(1, sub * 0.85 + beat * 0.95);
      const hue = 300 - sub * 80;
      const [r, g, b] = rgbFromHue(hue, 0.95, 0.25 + flash * 0.45);
      const dim = Math.round(flash * 255);
      for (const f of list) out.set(f.id, applyIntensity(r, g, b, dim, intensity));
      break;
    }
    default:
      break;
  }

  return { fixtureColors: out, effectiveLook: lookId };
}

function computeSoundLook(lookId, params) {
  let mode = lookId;
  if (mode === 'auto_rotate') {
    mode = AUTO_ROTATE_MODES[params.autoLookIndex % AUTO_ROTATE_MODES.length];
  }
  if (SOUND_ENGINE_SPECS[mode]) {
    return computeEngineSoundLook(mode, params);
  }
  if (CUSTOM_SOUND_LOOKS.includes(mode)) {
    return computeCustomSoundLook(mode, params);
  }
  return computeEngineSoundLook('sound_flash', params);
}

function soundLookCatalog() {
  const engine = SOUND_ENGINE_LOOKS.map((id) => ({
    id,
    label: SOUND_ENGINE_SPECS[id].label,
    sound: true,
  }));
  const custom = [
    { id: 'spectrum', label: 'Spectrum (4-band)', sound: true },
    { id: 'kick_chase', label: 'Kick chase (BPM + bass)', sound: true },
    { id: 'mid_treble_alternate', label: 'Mid / treble alternate', sound: true },
    { id: 'sub_flash', label: 'Sub flash', sound: true },
    { id: 'auto_rotate', label: 'Auto rotate sound looks', sound: true },
  ];
  return [...engine, ...custom];
}

module.exports = {
  LOOKS,
  AUTO_ROTATE_MODES,
  levelsToAudio,
  computeSoundLook,
  soundLookCatalog,
  sortedColorFixtures,
};
