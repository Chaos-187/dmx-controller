/**
 * Effects Engine
 *
 * All DMX effect computation logic — color effects, moving head effects,
 * and multicell effects. Extracted from server.js for maintainability.
 *
 * Exports:
 *   - computeEffectValue(effect, channelType, progress, baseValues, params, channelCtx)
 *   - isFixtureCompatibleWithEffect(effect, fix)
 *   - MOVING_HEAD_EFFECT_TYPES, MULTICELL_EFFECT_TYPES, COLOR_EFFECT_TYPES
 *   - COLOR_CHANNELS, PAN_TILT
 *   - hslToRgb(h, s, l)
 *   - pseudoRandom(seed)
 */

// ─── Deterministic pseudo-random ────────────────────────────────────────────

function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ─── HSL to RGB ─────────────────────────────────────────────────────────────

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

// ─── Effect Type Sets ───────────────────────────────────────────────────────

const MOVING_HEAD_EFFECT_TYPES = new Set(['pan_sweep','tilt_sweep','circle','figure_eight','random_move','fan','nod']);
const MULTICELL_EFFECT_TYPES   = new Set(['chase','comet','scanner','buildup','segments','ripple','cell_strobe','gradient']);
const COLOR_EFFECT_TYPES       = new Set(['pulse','rainbow','strobe','color_fade','sparkle','color_wave','fire']);
const RIG_EFFECT_TYPES         = new Set(['rig_chase','rig_color_wave','rig_sweep','rig_alternate','rig_converge','rig_rainbow']);
const PAN_TILT = new Set(['pan','tilt']);
const COLOR_CHANNELS = new Set(['red','green','blue','white','dimmer','amber','uv','color_wheel']);

// ─── Fixture Compatibility ──────────────────────────────────────────────────

/**
 * Check whether a fixture is compatible with an effect's fixture_target.
 * Returns false if the fixture should be skipped entirely.
 */
function isFixtureCompatibleWithEffect(effect, fix) {
  const target = effect.fixture_target || 'all';
  if (target === 'all') return true;
  if (target === 'moving_head') {
    return fix.channels.some(ch => ch.type === 'pan' || ch.type === 'tilt');
  }
  if (target === 'moving_head_wash') {
    return fix.channels.some(ch => ch.type === 'pan' || ch.type === 'tilt') &&
           fix.channels.some(ch => ch.type === 'red' || ch.type === 'green' || ch.type === 'blue');
  }
  if (target === 'moving_head_spot') {
    return fix.channels.some(ch => ch.type === 'pan' || ch.type === 'tilt') &&
           fix.channels.some(ch => ch.type === 'color_wheel');
  }
  if (target === 'multicell') {
    return (fix.cell_count || 0) > 0;
  }
  if (target === 'color') {
    return fix.channels.some(ch => COLOR_CHANNELS.has(ch.type));
  }
  if (target === 'rig') {
    return fix.channels.some(ch => COLOR_CHANNELS.has(ch.type));
  }
  return true;
}

// ─── Effect Value Computation ───────────────────────────────────────────────

/**
 * Compute the value for a channel from an effect definition.
 * @param {Object} effect       - Effect row from DB (with type, effect_data)
 * @param {string} channelType  - Channel type ('red','green','blue','dimmer', etc.)
 * @param {number} progress     - 0-1 normalised progress through the cue (or raw elapsed seconds)
 * @param {Object} baseValues   - Base channel values from the cue
 * @param {Object} params       - Per-cue effect_params overrides
 * @param {Object} [channelCtx] - { channel_number, total_channels, home_pan, home_tilt, cell, cell_count, ... }
 * @returns {number|null}       - Channel value 0-255, or null if this effect doesn't control this channel
 */
function computeEffectValue(effect, channelType, progress, baseValues, params, channelCtx) {
  const data = effect.effect_data || {};
  const type = effect.type;
  channelCtx = channelCtx || { channel_number: 1, total_channels: 1 };

  // ── Channel-type guards ─────────────────────────────────────────────
  // Moving head effects only produce values for pan/tilt channels,
  // but always pass through the dimmer so the light actually turns on.
  if (MOVING_HEAD_EFFECT_TYPES.has(type) && !PAN_TILT.has(channelType)) {
    if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
    return null;
  }
  // Non-mover effects must NEVER write to pan/tilt channels
  if (!MOVING_HEAD_EFFECT_TYPES.has(type) && PAN_TILT.has(channelType)) return null;
  // Color effects must only affect color/intensity channels (not gobo, prism, focus, etc.)
  if (COLOR_EFFECT_TYPES.has(type) && !COLOR_CHANNELS.has(channelType)) return null;
  // Rig-wide effects only affect color/intensity channels
  if (RIG_EFFECT_TYPES.has(type) && !COLOR_CHANNELS.has(channelType)) return null;

  // Helper: resolve channels-per-cell (legacy heuristic)
  const getCpp = () => params.channels_per_cell || data.channels_per_cell || 3;

  /**
   * Resolve cell index (0-based) and total cell count.
   * Uses explicit cell metadata when available (from multi-cell fixtures),
   * otherwise falls back to the channels_per_cell stride heuristic.
   * Master channels (cell=null) on multi-cell fixtures are flagged as isMaster.
   */
  function resolveCellInfo() {
    if (channelCtx.cell_count > 0 && channelCtx.cell) {
      return { cellIndex: channelCtx.cell - 1, cellCount: channelCtx.cell_count, isMaster: false };
    }
    if (channelCtx.cell_count > 0 && !channelCtx.cell) {
      return { cellIndex: 0, cellCount: channelCtx.cell_count, isMaster: true };
    }
    const cpp = getCpp();
    return {
      cellIndex: Math.floor((channelCtx.channel_number - 1) / cpp),
      cellCount: Math.max(1, Math.floor(channelCtx.total_channels / cpp)),
      isMaster: false,
    };
  }

  switch (type) {

    // ══════════════════════════════════════════════════════════════════════
    //  COLOR EFFECTS
    // ══════════════════════════════════════════════════════════════════════

    case 'pulse': {
      // Pulse only color/white channels; pass dimmer through unchanged
      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      const freq = params.frequency || data.frequency || 1;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      return val * (0.5 + 0.5 * Math.sin(progress * freq * 2 * Math.PI));
    }

    case 'rainbow': {
      const hue = (progress * 360 * (params.cycles || data.cycles || 1)) % 360;
      const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      return null;
    }

    case 'strobe': {
      // Strobe only color/white channels; pass dimmer through unchanged
      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      const hz = params.frequency || data.frequency || 10;
      const period = 1 / hz;
      const phase = (progress % period) / period;
      const onVal = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      return phase < 0.5 ? onVal : 0;
    }

    case 'color_fade': {
      // Only fade actual color channels; pass dimmer through unchanged
      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      const startColor = data.start_color || {};
      const endColor = data.end_color || {};
      const startVal = startColor[channelType] !== undefined ? startColor[channelType] : 0;
      const endVal = endColor[channelType] !== undefined ? endColor[channelType] : 0;
      return Math.round(startVal + (endVal - startVal) * progress);
    }

    // ══════════════════════════════════════════════════════════════════════
    //  MULTICELL / CELL-AWARE EFFECTS
    // ══════════════════════════════════════════════════════════════════════

    case 'chase': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 3;
      const tail  = params.tail  || data.tail  || 0;
      const dir   = params.direction || data.direction || 'left';
      const halfW = width / 2;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const cycle = (progress * speed) % 1;

      const bright = (dist) => {
        if (dist <= halfW) return 1;
        if (tail > 0 && dist <= halfW + tail) return 1 - (dist - halfW) / tail;
        return 0;
      };

      if (dir === 'center') {
        const mid = (cellCount - 1) / 2;
        const spread = cycle * mid;
        return val * bright(Math.min(Math.abs(cellIndex - (mid - spread)), Math.abs(cellIndex - (mid + spread))));
      }
      if (dir === 'outside') {
        const mid = (cellCount - 1) / 2;
        const spread = (1 - cycle) * mid;
        return val * bright(Math.min(Math.abs(cellIndex - (mid - spread)), Math.abs(cellIndex - (mid + spread))));
      }
      if (dir === 'bounce') {
        const headPos = cycle < 0.5
          ? cycle * 2 * (cellCount - 1)
          : (1 - cycle) * 2 * (cellCount - 1);
        return val * bright(Math.abs(cellIndex - headPos));
      }
      // left / right — wrapping chase
      const headPos = dir === 'right' ? (1 - cycle) * cellCount : cycle * cellCount;
      let dist = Math.abs(cellIndex - headPos);
      dist = Math.min(dist, cellCount - dist);
      return val * bright(dist);
    }

    case 'comet': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const speed = params.speed || data.speed || 1;
      const tail  = params.tail  || data.tail  || 10;
      const dir   = params.direction || data.direction || 'left';
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const cycle = (progress * speed) % 1;
      const headPos = dir === 'right' ? (1 - cycle) * cellCount : cycle * cellCount;

      let behind;
      if (dir === 'right') {
        behind = cellIndex - headPos;
        if (behind < 0) behind += cellCount;
      } else {
        behind = headPos - cellIndex;
        if (behind < 0) behind += cellCount;
      }
      if (behind <= 1) return val;
      if (behind <= tail + 1) return val * (1 - (behind - 1) / tail);
      return 0;
    }

    case 'scanner': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 1;
      const tail  = params.tail  || data.tail  || 5;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const halfW = width / 2;

      const cycle = (progress * speed) % 1;
      const headPos = cycle < 0.5
        ? cycle * 2 * (cellCount - 1)
        : (1 - cycle) * 2 * (cellCount - 1);

      const dist = Math.abs(cellIndex - headPos);
      if (dist <= halfW) return val;
      if (tail > 0 && dist <= halfW + tail) return val * (1 - (dist - halfW) / tail);
      return 0;
    }

    case 'sparkle': {
      const { cellIndex, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const density  = params.density    || data.density    || 0.1;
      const fadeSpd  = params.fade_speed || data.fade_speed || 6;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const t = progress * fadeSpd;
      const phase = pseudoRandom(cellIndex * 137);
      const t2 = t + phase * 10;
      const slot = Math.floor(t2);
      const frac = t2 - slot;
      const on = pseudoRandom(cellIndex * 9973 + slot) < density;
      return on ? val * (1 - frac) : 0;
    }

    case 'color_wave': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const wavelength = params.wavelength || data.wavelength || 20;
      const speed = params.speed || data.speed || 1;

      const hue = ((cellIndex / wavelength + progress * speed) * 360) % 360;
      const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    case 'fire': {
      const { cellIndex, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const intensity = params.intensity || data.intensity || 0.8;
      const cooling   = params.cooling   || data.cooling   || 0.3;

      const t = progress * 20;
      const flicker  = pseudoRandom(cellIndex * 137 + Math.floor(t * 3));
      const flicker2 = pseudoRandom(cellIndex * 251 + Math.floor(t * 7));
      const heat = Math.max(0, Math.min(1, intensity * (0.5 + 0.5 * flicker) - cooling * flicker2));

      if (channelType === 'red')    return 255 * heat;
      if (channelType === 'green')  return Math.round(100 * heat * flicker);
      if (channelType === 'blue')   return Math.round(10 * heat * flicker2);
      if (channelType === 'white')  return 0;
      if (channelType === 'dimmer') return 255 * heat;
      return null;
    }

    case 'buildup': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const dir = params.direction || data.direction || 'left';
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const litCells = Math.round(progress * cellCount);
      if (dir === 'center') {
        const mid = (cellCount - 1) / 2;
        return Math.abs(cellIndex - mid) <= litCells / 2 ? val : 0;
      }
      if (dir === 'right') return cellIndex >= cellCount - litCells ? val : 0;
      return cellIndex < litCells ? val : 0;
    }

    case 'segments': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const segSize = params.segment_size || data.segment_size || 2;
      const speed = params.offset_speed || data.offset_speed || 1;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const offset = Math.floor(progress * speed * cellCount);
      const pos = (cellIndex + offset) % (segSize * 2);
      return pos < segSize ? val : 0;
    }

    case 'ripple': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 3;
      const decay = params.decay || data.decay || 0.7;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const center = (cellCount - 1) / 2;
      const dist = Math.abs(cellIndex - center);
      const waveFront = progress * speed * cellCount;
      const delta = Math.abs(dist - waveFront);
      if (delta < width) {
        const intensity = (1 - delta / width) * Math.pow(decay, Math.floor(waveFront / cellCount));
        return val * Math.max(0, intensity);
      }
      return 0;
    }

    case 'cell_strobe': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const freq = params.frequency || data.frequency || 8;
      const pattern = params.pattern || data.pattern || 'sequential';
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const beat = Math.floor(progress * freq);
      let activeCell;
      if (pattern === 'random') {
        activeCell = Math.floor(pseudoRandom(beat * 997) * cellCount);
      } else {
        activeCell = beat % cellCount;
      }
      return cellIndex === activeCell ? val : 0;
    }

    case 'gradient': {
      const { cellIndex, cellCount, isMaster } = resolveCellInfo();
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const speed = params.speed || data.speed || 1;
      const colors = data.colors || ['#ff0000', '#0000ff'];
      if (!['red', 'green', 'blue'].includes(channelType)) {
        if (channelType === 'dimmer') return 255;
        return null;
      }

      const pos = ((cellIndex / Math.max(1, cellCount - 1)) + progress * speed) % 1;
      const segmentCount = colors.length - 1;
      const segPos = pos * segmentCount;
      const segIdx = Math.min(Math.floor(segPos), segmentCount - 1);
      const segFrac = segPos - segIdx;

      function hexToRgb(hex) {
        const m = hex.replace('#', '');
        return { r: parseInt(m.slice(0, 2), 16), g: parseInt(m.slice(2, 4), 16), b: parseInt(m.slice(4, 6), 16) };
      }
      const c1 = hexToRgb(colors[segIdx]);
      const c2 = hexToRgb(colors[Math.min(segIdx + 1, colors.length - 1)]);
      const r = Math.round(c1.r + (c2.r - c1.r) * segFrac);
      const g = Math.round(c1.g + (c2.g - c1.g) * segFrac);
      const b = Math.round(c1.b + (c2.b - c1.b) * segFrac);

      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  MOVING HEAD EFFECTS (pan/tilt)
    // ══════════════════════════════════════════════════════════════════════

    // ── Pan Sweep: sweep pan back and forth around home ────────────────
    case 'pan_sweep': {
      const speed = params.speed || data.speed || 1;
      const range = params.range || data.range || 1.0;
      const homePan = channelCtx.home_pan ?? 128;
      const homeTilt = channelCtx.home_tilt ?? 128;
      const amplitude = 127 * range;
      const cycle = (progress * speed) % 1;
      if (channelType === 'pan') return Math.max(0, Math.min(255, homePan + amplitude * Math.sin(cycle * 2 * Math.PI)));
      if (channelType === 'tilt') return homeTilt;
      return null;
    }

    // ── Tilt Sweep: sweep tilt back and forth around home ──────────────
    case 'tilt_sweep': {
      const speed = params.speed || data.speed || 1;
      const range = params.range || data.range || 1.0;
      const homePan = channelCtx.home_pan ?? 128;
      const homeTilt = channelCtx.home_tilt ?? 128;
      const amplitude = 127 * range;
      const cycle = (progress * speed) % 1;
      if (channelType === 'tilt') return Math.max(0, Math.min(255, homeTilt + amplitude * Math.sin(cycle * 2 * Math.PI)));
      if (channelType === 'pan') return homePan;
      return null;
    }

    // ── Circle: circular pan/tilt motion around home ───────────────────
    case 'circle': {
      const speed = params.speed || data.speed || 1;
      const size = params.size || data.size || 0.5;
      const homePan = channelCtx.home_pan ?? 128;
      const homeTilt = channelCtx.home_tilt ?? 128;
      const cycle = (progress * speed) % 1;
      const angle = cycle * 2 * Math.PI;
      const amplitude = 127 * size;
      if (channelType === 'pan') return Math.max(0, Math.min(255, homePan + amplitude * Math.cos(angle)));
      if (channelType === 'tilt') return Math.max(0, Math.min(255, homeTilt + amplitude * Math.sin(angle)));
      return null;
    }

    // ── Figure Eight: lissajous figure-8 around home ───────────────────
    case 'figure_eight': {
      const speed = params.speed || data.speed || 1;
      const size = params.size || data.size || 0.5;
      const homePan = channelCtx.home_pan ?? 128;
      const homeTilt = channelCtx.home_tilt ?? 128;
      const cycle = (progress * speed) % 1;
      const angle = cycle * 2 * Math.PI;
      const amplitude = 127 * size;
      if (channelType === 'pan') return Math.max(0, Math.min(255, homePan + amplitude * Math.sin(angle)));
      if (channelType === 'tilt') return Math.max(0, Math.min(255, homeTilt + amplitude * Math.sin(angle * 2)));
      return null;
    }

    // ── Random Movement: pseudo-random positions around home ───────────
    case 'random_move': {
      const speed = params.speed || data.speed || 1;
      const range = params.range || data.range || 0.5;
      if (channelType !== 'pan' && channelType !== 'tilt') return null;

      const home = channelType === 'pan' ? (channelCtx.home_pan ?? 128) : (channelCtx.home_tilt ?? 128);
      const t = progress * speed * 10;
      const slot = Math.floor(t);
      const frac = t - slot;
      const seed1 = channelType === 'pan' ? 137 : 251;
      const pos1 = pseudoRandom(slot * seed1) * 2 - 1;
      const pos2 = pseudoRandom((slot + 1) * seed1) * 2 - 1;
      const smooth = frac * frac * (3 - 2 * frac); // smoothstep
      const pos = pos1 + (pos2 - pos1) * smooth;
      return Math.max(0, Math.min(255, home + 127 * range * pos));
    }

    // ── Fan: spread movers apart on pan, tilt stays at home ────────────
    case 'fan': {
      const speed = params.speed || data.speed || 0.5;
      const spread = params.spread || data.spread || 1.0;
      if (channelType !== 'pan' && channelType !== 'tilt') return null;

      const homePan = channelCtx.home_pan ?? 128;
      const homeTilt = channelCtx.home_tilt ?? 128;
      const panChannels = (channelCtx._fixtureCount || 1);
      const fixtureOrdinal = (channelCtx._fixtureOrdinal || 0);
      const normalizedIdx = panChannels > 1 ? (fixtureOrdinal / (panChannels - 1) - 0.5) : 0;

      const cycle = (progress * speed) % 1;
      const currentSpread = spread * Math.sin(cycle * Math.PI);
      if (channelType === 'pan') return Math.max(0, Math.min(255, homePan + 127 * normalizedIdx * currentSpread));
      if (channelType === 'tilt') return homeTilt;
      return null;
    }

    // ── Nod/Shake: rapid small oscillation on one axis around home ─────
    case 'nod': {
      const speed = params.speed || data.speed || 2;
      const range = params.range || data.range || 0.3;
      const axis = params.axis || data.axis || 'tilt';
      const home = channelType === 'pan' ? (channelCtx.home_pan ?? 128) : (channelCtx.home_tilt ?? 128);
      if (channelType === axis) return Math.max(0, Math.min(255, home + 127 * range * Math.sin(((progress * speed) % 1) * 2 * Math.PI)));
      if (channelType === 'pan' || channelType === 'tilt') return home;
      return null;
    }

    // ══════════════════════════════════════════════════════════════════════
    //  RIG-WIDE EFFECTS (cross-fixture spatial)
    // ══════════════════════════════════════════════════════════════════════
    //
    // These effects use channelCtx._rigPosition (0-1 normalized X or Y),
    // channelCtx._rigOrder (0-based index), and channelCtx._rigFixtureCount
    // to create spatial effects that sweep/wash across the entire rig.

    // ── Rig Chase: color sweeps across fixtures by rig position ────────
    case 'rig_chase': {
      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 0.3;
      const tail = params.tail || data.tail || 0.2;
      const dir = params.direction || data.direction || 'left_right';

      const rigPos = channelCtx._rigPosition ?? 0.5;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const cycle = (progress * speed) % 1;

      let headPos;
      if (dir === 'right_left') headPos = 1 - cycle;
      else if (dir === 'bounce') headPos = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;
      else if (dir === 'top_bottom') headPos = cycle;  // uses _rigPositionY
      else if (dir === 'bottom_top') headPos = 1 - cycle;
      else headPos = cycle; // left_right

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      const pos = useY ? (channelCtx._rigPositionY ?? 0.5) : rigPos;
      const halfW = width / 2;
      const dist = Math.abs(pos - headPos);

      if (dist <= halfW) return val;
      if (tail > 0 && dist <= halfW + tail) return val * (1 - (dist - halfW) / tail);
      return 0;
    }

    // ── Rig Color Wave: hue shift offset by fixture position ───────────
    case 'rig_color_wave': {
      const speed = params.speed || data.speed || 1;
      const wavelength = params.wavelength || data.wavelength || 1.0;
      const dir = params.direction || data.direction || 'left_right';

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      let pos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      if (dir === 'right_left' || dir === 'bottom_top') pos = 1 - pos;

      const hue = ((pos / wavelength + progress * speed) * 360) % 360;
      const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    // ── Rig Sweep: spotlight/wash that travels across the rig ──────────
    case 'rig_sweep': {
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 0.25;
      const dir = params.direction || data.direction || 'left_right';

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      const rigPos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const cycle = (progress * speed) % 1;
      let sweepPos;
      if (dir === 'right_left' || dir === 'bottom_top') sweepPos = 1 - cycle;
      else if (dir === 'bounce') sweepPos = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;
      else sweepPos = cycle;

      const dist = Math.abs(rigPos - sweepPos);
      const intensity = Math.max(0, 1 - dist / width);
      // Smooth falloff with cosine
      const smooth = intensity > 0 ? (Math.cos((1 - intensity) * Math.PI) + 1) / 2 : 0;
      if (channelType === 'dimmer') return Math.round(255 * smooth);
      return Math.round(val * smooth);
    }

    // ── Rig Alternate: even/odd split based on rig order ───────────────
    case 'rig_alternate': {
      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      const speed = params.speed || data.speed || 1;
      const rigOrder = channelCtx._rigOrder ?? 0;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const cycle = (progress * speed) % 1;
      const isEven = (rigOrder % 2) === 0;
      // First half of cycle: even fixtures on, odd off. Second half: swap.
      const phase = cycle < 0.5;
      const active = isEven ? phase : !phase;
      return active ? val : 0;
    }

    // ── Rig Converge/Diverge: sweep from edges to center or vice versa ─
    case 'rig_converge': {
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 0.2;
      const mode = params.mode || data.mode || 'converge'; // 'converge' or 'diverge'
      const dir = params.direction || data.direction || 'left_right';

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      const rigPos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const cycle = (progress * speed) % 1;
      // Distance from center (0 at center, 0.5 at edges)
      const distFromCenter = Math.abs(rigPos - 0.5);

      let sweepEdge;
      if (mode === 'diverge') {
        // Center to edges
        sweepEdge = cycle * 0.5;
      } else {
        // Edges to center
        sweepEdge = 0.5 - cycle * 0.5;
      }

      const dist = Math.abs(distFromCenter - sweepEdge);
      if (dist <= width / 2) return val;
      if (dist <= width) return val * (1 - (dist - width / 2) / (width / 2));
      return 0;
    }

    // ── Rig Rainbow: rainbow gradient spread across the entire rig ─────
    case 'rig_rainbow': {
      const speed = params.speed || data.speed || 0.5;
      const spread = params.spread || data.spread || 1.0;
      const dir = params.direction || data.direction || 'left_right';

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      let pos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      if (dir === 'right_left' || dir === 'bottom_top') pos = 1 - pos;

      const hue = ((pos * spread + progress * speed) * 360) % 360;
      const [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    // ── Default: pass through base value ───────────────────────────────
    default:
      return baseValues[channelType] !== undefined ? baseValues[channelType] : null;
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  pseudoRandom,
  hslToRgb,
  computeEffectValue,
  isFixtureCompatibleWithEffect,
  MOVING_HEAD_EFFECT_TYPES,
  MULTICELL_EFFECT_TYPES,
  COLOR_EFFECT_TYPES,
  RIG_EFFECT_TYPES,
  PAN_TILT,
  COLOR_CHANNELS,
};
