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

// ─── Optional per-effect color palettes (effect_data / cue effect_params) ───
// color_mode: 'hsl' (default) | 'palette'
// color_palette: ['#rrggbb', ...] or [{r,g,b}, ...] — at least 2 stops to blend

function normalizePaletteEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'string') {
    let m = entry.trim().replace(/^#/, '');
    if (m.length === 3) m = m.split('').map(c => c + c).join('');
    if (m.length === 6) {
      return {
        r: parseInt(m.slice(0, 2), 16),
        g: parseInt(m.slice(2, 4), 16),
        b: parseInt(m.slice(4, 6), 16),
      };
    }
    return null;
  }
  if (typeof entry === 'object' && entry.r != null) {
    return { r: +entry.r, g: +entry.g, b: +entry.b };
  }
  return null;
}

function getEffectPaletteRgb(data, params) {
  const raw = params.color_palette != null ? params.color_palette : data.color_palette;
  if (!raw || !Array.isArray(raw) || raw.length < 2) return null;
  const out = raw.map(normalizePaletteEntry).filter(Boolean);
  return out.length >= 2 ? out : null;
}

function usePaletteColors(data, params) {
  const mode = params.color_mode != null ? params.color_mode : data.color_mode;
  if (mode !== 'palette') return false;
  return getEffectPaletteRgb(data, params) != null;
}

function useHslColors(data, params) {
  const mode = params.color_mode != null ? params.color_mode : data.color_mode;
  return mode === 'hsl';
}

/** Palette stops or full HSL spectrum (Touch3 / live "Rainbow" preset). */
function useSpectrumColors(data, params) {
  return usePaletteColors(data, params) || useHslColors(data, params);
}

/** phase in [0,1): linear blend along palette stops (wraps last → first). */
function rgbAtPalettePhase(phase, palette) {
  const n = palette.length;
  if (n === 0) return [255, 255, 255];
  if (n === 1) {
    const c = palette[0];
    return [c.r, c.g, c.b];
  }
  const p = ((phase % 1) + 1) % 1;
  const pos = p * n;
  const i = Math.floor(pos) % n;
  const frac = pos - Math.floor(pos);
  const a = palette[i];
  const b = palette[(i + 1) % n];
  return [
    Math.round(a.r + (b.r - a.r) * frac),
    Math.round(a.g + (b.g - a.g) * frac),
    Math.round(a.b + (b.b - a.b) * frac),
  ];
}

// ─── Effect Type Sets ───────────────────────────────────────────────────────

const MOVING_HEAD_EFFECT_TYPES = new Set(['pan_sweep','tilt_sweep','circle','figure_eight','random_move','fan','nod']);
const MULTICELL_EFFECT_TYPES   = new Set([
  'chase','comet','scanner','buildup','segments','ripple','cell_strobe','gradient',
  'checker','matrix_alternate','diagonal','plasma','rain','fill_rows',
]);
const COLOR_EFFECT_TYPES       = new Set(['pulse','rainbow','strobe','color_fade','sparkle','color_wave','fire']);
const RIG_EFFECT_TYPES         = new Set(['rig_chase','rig_color_wave','rig_sweep','rig_alternate','rig_converge','rig_rainbow','rig_depth_chase','rig_depth_wave','rig_round_robin']);
const SOUND_EFFECT_TYPES       = new Set(['sound_pulse','sound_strobe','sound_chase','sound_wave','sound_flash','sound_vu','sound_vu_tb','sound_vu_lr']);
const PAN_TILT = new Set(['pan','tilt']);
const COLOR_CHANNELS = new Set(['red','green','blue','white','dimmer','amber','uv','color_wheel']);

/** Intensity-based rig spatial output; uses live palette on RGB when color_mode is palette. */
function rigSpatialColorOutput(channelType, brightness, baseValues, data, params, colorPhase) {
  return multicellColorOutput(channelType, brightness, baseValues, data, params, colorPhase);
}

/** Intensity-based multicell output; uses live palette on RGB when color_mode is palette. */
function multicellColorOutput(channelType, brightness, baseValues, data, params, colorPhase) {
  const b = Math.max(0, Math.min(1, brightness));
  if (b <= 0) return 0;
  if (channelType === 'dimmer') return Math.round(255 * b);
  if (!COLOR_CHANNELS.has(channelType)) return null;

  const phase = colorPhase != null ? ((colorPhase % 1) + 1) % 1 : 0;
  const palette = getEffectPaletteRgb(data, params);
  if (usePaletteColors(data, params) && palette) {
    if (channelType === 'red' || channelType === 'green' || channelType === 'blue') {
      const [r, g, bl] = rgbAtPalettePhase(phase, palette);
      if (channelType === 'red') return Math.round(r * b);
      if (channelType === 'green') return Math.round(g * b);
      if (channelType === 'blue') return Math.round(bl * b);
    }
    if (channelType === 'white') return Math.round(255 * b);
  } else if (useHslColors(data, params)) {
    if (channelType === 'red' || channelType === 'green' || channelType === 'blue') {
      const [r, g, bl] = hslToRgb(phase, 1, 0.5);
      if (channelType === 'red') return Math.round(r * b);
      if (channelType === 'green') return Math.round(g * b);
      if (channelType === 'blue') return Math.round(bl * b);
    }
    if (channelType === 'white') return 0;
  }

  const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
  return val * b;
}

function multicellMasterOutput(channelType, baseValues, data, params) {
  if (!COLOR_CHANNELS.has(channelType)) return null;
  return multicellColorOutput(channelType, 1, baseValues, data, params, 0);
}

/** Fixture-wide control channels — not per-cell RGB/white segments. */
const GLOBAL_MASTER_CHANNEL_TYPES = new Set([
  'dimmer', 'strobe', 'speed', 'macro', 'other', 'reset',
  'pan', 'pan_fine', 'tilt', 'tilt_fine',
  'gobo', 'gobo_rotation', 'color_wheel', 'focus', 'zoom', 'prism',
  'smoke', 'atmosphere',
]);

function isGlobalMasterChannel(type) {
  return GLOBAL_MASTER_CHANNEL_TYPES.has(type);
}

/** Resolve rows×cols for matrix multicell effects (supports unified multi-fixture width). */
function resolveMatrixLayout(params, data, channelCtx, linearCellCount) {
  let rows = params.cell_rows || data.cell_rows || channelCtx.cell_rows || 1;
  let cols = params.cell_cols || data.cell_cols || channelCtx.cell_cols || linearCellCount;
  if (rows > 1 && cols > 0 && rows * cols !== linearCellCount) {
    cols = Math.max(1, Math.round(linearCellCount / rows));
  }
  return { rows, cols };
}

/** Map linear cell index to axis position for matrix-aware sweeps. */
function getMatrixAxisPosition(cellIndex, layout, axis) {
  const { rows, cols } = layout;
  if (rows <= 1 || cols <= 0) {
    return { pos: cellIndex, extent: Math.max(1, rows * cols || cellIndex + 1), row: 0, col: cellIndex };
  }
  const row = Math.floor(cellIndex / cols);
  const col = cellIndex % cols;
  const ax = axis || 'horizontal';
  if (ax === 'vertical') return { pos: row, extent: rows, row, col };
  return { pos: col, extent: cols, row, col };
}

/** Row/col for a linear cell index (falls back to 1×N strip). */
function resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx) {
  const layout = resolveMatrixLayout(params, data, channelCtx, cellCount);
  if (layout.rows <= 1) {
    return { row: 0, col: cellIndex, layout };
  }
  return {
    row: Math.floor(cellIndex / layout.cols),
    col: cellIndex % layout.cols,
    layout,
  };
}

function parseWhiteTubeIndex(channelCtx) {
  const name = channelCtx.channel_name || '';
  const m = name.match(/white\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/** Whether a cell-targeted cue should drive this channel. */
function shouldApplyCellCue(cueCell, ch) {
  if (cueCell == null) return true;
  if (ch.cell != null) return ch.cell === cueCell;
  return isGlobalMasterChannel(ch.type);
}

/** Independent segments on a multicell fixture (e.g. white pixels not in the cell grid). */
function isAuxiliaryMulticellChannel(ch, fix) {
  return (fix.cell_count || 0) > 0 && ch.cell == null && !isGlobalMasterChannel(ch.type);
}

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
  if (target === 'sound') {
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
  // Sound-reactive effects only affect color/intensity channels
  if (SOUND_EFFECT_TYPES.has(type) && !COLOR_CHANNELS.has(channelType)) return null;

  // Helper: resolve channels-per-cell (legacy heuristic)
  const getCpp = () => params.channels_per_cell || data.channels_per_cell || 3;
  const noStrobes = !!(params.no_strobes || data.no_strobes);

  /** Master/aux strobe channels — hold base value when strobes are disabled. */
  function masterStrobeValue() {
    return baseValues[channelType] !== undefined ? baseValues[channelType] : 0;
  }

  /**
   * Resolve cell index (0-based) and total cell count.
   * Uses explicit cell metadata when available (from multi-cell fixtures),
   * otherwise falls back to the channels_per_cell stride heuristic.
   * Master channels (cell=null) on multi-cell fixtures are flagged as isMaster.
   */
  function resolveCellInfo() {
    let cellIndex;
    let cellCount;
    let isMaster;
    let excluded;

    if (channelCtx.cell_count > 0 && channelCtx.cell) {
      cellIndex = channelCtx.cell - 1;
      cellCount = channelCtx.cell_count;
      isMaster = false;
      excluded = false;
    } else if (channelCtx.cell_count > 0 && !channelCtx.cell) {
      const chType = channelCtx.channel_type;
      // White strobe tubes map to horizontal zones across the matrix width
      if (chType === 'white') {
        if (noStrobes) {
          return { cellIndex: -1, cellCount: channelCtx.cell_count, isMaster: false, excluded: true };
        }
        const whiteNum = parseWhiteTubeIndex(channelCtx);
        const layout = resolveMatrixLayout(params, data, channelCtx, channelCtx.cell_count);
        const tubeCount = params.white_tube_count || data.white_tube_count || 8;
        const fixCount = params.strip_fixture_count || data.strip_fixture_count || 1;
        const fixIdx = params.strip_fixture_index ?? data.strip_fixture_index ?? 0;
        const colsPerFix = Math.max(1, Math.floor(layout.cols / fixCount));
        const localCol = whiteNum != null
          ? Math.min(colsPerFix - 1, Math.floor(((whiteNum - 1) / tubeCount) * colsPerFix))
          : 0;
        cellIndex = fixIdx * colsPerFix + localCol;
        cellCount = layout.cols;
        isMaster = false;
        excluded = false;
      } else if (chType && !isGlobalMasterChannel(chType)) {
        return { cellIndex: -1, cellCount: channelCtx.cell_count, isMaster: false, excluded: true };
      } else {
        cellIndex = 0;
        cellCount = channelCtx.cell_count;
        isMaster = true;
        excluded = false;
      }
    } else {
      const cpp = getCpp();
      cellIndex = Math.floor((channelCtx.channel_number - 1) / cpp);
      cellCount = Math.max(1, Math.floor(channelCtx.total_channels / cpp));
      isMaster = false;
      excluded = false;
    }

    // Unified strip: multiple fixtures of the same type treated as one matrix row
    const stripTotal = params.strip_cell_total || data.strip_cell_total;
    const stripOffset = params.strip_cell_offset ?? data.strip_cell_offset;
    if (!isMaster && !excluded && stripTotal > 0 && stripOffset != null) {
      cellIndex = stripOffset + cellIndex;
      cellCount = stripTotal;
    }

    return { cellIndex, cellCount, isMaster, excluded };
  }

  /** Matrix-aware position for multicell sweep effects. */
  function getSweepPosition(cellIndex, cellCount) {
    const layout = resolveMatrixLayout(params, data, channelCtx, cellCount);
    const axis = params.matrix_axis || data.matrix_axis || 'horizontal';
    return getMatrixAxisPosition(cellIndex, layout, axis);
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
      const cycles = params.cycles || data.cycles || 1;
      const palette = getEffectPaletteRgb(data, params);
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase((progress * cycles) % 1, palette);
      } else {
        const hue = (progress * 360 * cycles) % 360;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
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
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) {
        if (channelType === 'strobe') return masterStrobeValue();
        return multicellMasterOutput(channelType, baseValues, data, params);
      }
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 3;
      const tail  = params.tail  || data.tail  || 0;
      const dir   = params.direction || data.direction || 'left';
      const halfW = width / 2;
      const cycle = (progress * speed) % 1;
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      const colorPhase = (cellPhase + cycle) % 1;
      const out = (br) => multicellColorOutput(channelType, br, baseValues, data, params, colorPhase);

      const bright = (dist) => {
        if (dist <= halfW) return 1;
        if (tail > 0 && dist <= halfW + tail) return 1 - (dist - halfW) / tail;
        return 0;
      };

      if (dir === 'center') {
        const mid = (extent - 1) / 2;
        const spread = cycle * mid;
        return out(bright(Math.min(Math.abs(pos - (mid - spread)), Math.abs(pos - (mid + spread)))));
      }
      if (dir === 'outside') {
        const mid = (extent - 1) / 2;
        const spread = (1 - cycle) * mid;
        return out(bright(Math.min(Math.abs(pos - (mid - spread)), Math.abs(pos - (mid + spread)))));
      }
      if (dir === 'bounce') {
        const headPos = cycle < 0.5
          ? cycle * 2 * (extent - 1)
          : (1 - cycle) * 2 * (extent - 1);
        return out(bright(Math.abs(pos - headPos)));
      }
      const headPos = dir === 'right' ? (1 - cycle) * extent : cycle * extent;
      let dist = Math.abs(pos - headPos);
      dist = Math.min(dist, extent - dist);
      return out(bright(dist));
    }

    case 'comet': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) {
        if (channelType === 'strobe') return masterStrobeValue();
        return multicellMasterOutput(channelType, baseValues, data, params);
      }
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const speed = params.speed || data.speed || 1;
      const tail  = params.tail  || data.tail  || 10;
      const dir   = params.direction || data.direction || 'left';
      const cycle = (progress * speed) % 1;
      const headPos = dir === 'right' ? (1 - cycle) * extent : cycle * extent;
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      const colorPhase = (cellPhase + cycle) % 1;
      const out = (br) => multicellColorOutput(channelType, br, baseValues, data, params, colorPhase);

      let behind;
      if (dir === 'right') {
        behind = pos - headPos;
        if (behind < 0) behind += extent;
      } else {
        behind = headPos - pos;
        if (behind < 0) behind += extent;
      }
      if (behind <= 1) return out(1);
      if (behind <= tail + 1) return out(1 - (behind - 1) / tail);
      return 0;
    }

    case 'scanner': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 1;
      const tail  = params.tail  || data.tail  || 5;
      const halfW = width / 2;

      const cycle = (progress * speed) % 1;
      const headPos = cycle < 0.5
        ? cycle * 2 * (extent - 1)
        : (1 - cycle) * 2 * (extent - 1);
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      const colorPhase = (cellPhase + headPos / Math.max(1, extent - 1)) % 1;
      const out = (br) => multicellColorOutput(channelType, br, baseValues, data, params, colorPhase);

      const dist = Math.abs(pos - headPos);
      if (dist <= halfW) return out(1);
      if (tail > 0 && dist <= halfW + tail) return out(1 - (dist - halfW) / tail);
      return 0;
    }

    case 'sparkle': {
      const { cellIndex, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const density  = params.density    || data.density    || 0.1;
      const fadeSpd  = params.fade_speed || data.fade_speed || 6;

      const t = progress * fadeSpd;
      const phase = pseudoRandom(cellIndex * 137);
      const t2 = t + phase * 10;
      const slot = Math.floor(t2);
      const frac = t2 - slot;
      const on = pseudoRandom(cellIndex * 9973 + slot) < density;
      const colorPhase = pseudoRandom(cellIndex * 313);
      return multicellColorOutput(channelType, on ? (1 - frac) : 0, baseValues, data, params, colorPhase);
    }

    case 'color_wave': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const wavelength = params.wavelength || data.wavelength || Math.max(4, Math.round(extent / 3));
      const speed = params.speed || data.speed || 1;
      const phase = ((pos / wavelength + progress * speed) % 1 + 1) % 1;

      if (params.live_color_override) {
        const br = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
        return multicellColorOutput(channelType, br, baseValues, data, { ...params, color_mode: 'base' }, 0);
      }

      const palette = getEffectPaletteRgb(data, params);
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(phase, palette);
      } else {
        const hue = (phase * 360) % 360;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    case 'fire': {
      const { cellIndex, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return COLOR_CHANNELS.has(channelType) ? (baseValues[channelType] !== undefined ? baseValues[channelType] : 255) : null;
      const intensity = params.intensity || data.intensity || 0.8;
      const cooling   = params.cooling   || data.cooling   || 0.3;
      const palette = getEffectPaletteRgb(data, params);

      const t = progress * 20;
      const flicker  = pseudoRandom(cellIndex * 137 + Math.floor(t * 3));
      const flicker2 = pseudoRandom(cellIndex * 251 + Math.floor(t * 7));
      const heat = Math.max(0, Math.min(1, intensity * (0.5 + 0.5 * flicker) - cooling * flicker2));

      if (usePaletteColors(data, params) && palette) {
        const [pr, pg, pb] = rgbAtPalettePhase(heat, palette);
        const s = heat;
        if (channelType === 'red') return Math.round(pr * s);
        if (channelType === 'green') return Math.round(pg * s);
        if (channelType === 'blue') return Math.round(pb * s);
        if (channelType === 'white') return 0;
        if (channelType === 'dimmer') return Math.round(255 * s);
        return null;
      }

      if (channelType === 'red')    return 255 * heat;
      if (channelType === 'green')  return Math.round(100 * heat * flicker);
      if (channelType === 'blue')   return Math.round(10 * heat * flicker2);
      if (channelType === 'white')  return 0;
      if (channelType === 'dimmer') return 255 * heat;
      return null;
    }

    case 'buildup': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const dir = params.direction || data.direction || 'left';
      const litCells = Math.round(progress * extent);
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      const out = (on) => multicellColorOutput(channelType, on ? 1 : 0, baseValues, data, params, cellPhase);

      if (dir === 'center') {
        const mid = (extent - 1) / 2;
        return out(Math.abs(pos - mid) <= litCells / 2);
      }
      if (dir === 'right') return out(pos >= extent - litCells);
      return out(pos < litCells);
    }

    case 'segments': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const segSize = params.segment_size || data.segment_size || 2;
      const speed = params.offset_speed || data.offset_speed || 1;
      const offset = Math.floor(progress * speed * extent);
      const segPos = (pos + offset) % (segSize * 2);
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      return multicellColorOutput(channelType, segPos < segSize ? 1 : 0, baseValues, data, params, cellPhase);
    }

    case 'ripple': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const layout = resolveMatrixLayout(params, data, channelCtx, cellCount);
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 3;
      const decay = params.decay || data.decay || 0.7;

      let dist;
      let cellPhase;
      if (layout.rows > 1 && layout.cols > 1) {
        const row = Math.floor(cellIndex / layout.cols);
        const col = cellIndex % layout.cols;
        const centerR = (layout.rows - 1) / 2;
        const centerC = (layout.cols - 1) / 2;
        dist = Math.sqrt((row - centerR) ** 2 + (col - centerC) ** 2);
        cellPhase = dist / Math.max(1, Math.sqrt(centerR ** 2 + centerC ** 2));
      } else {
        const center = (cellCount - 1) / 2;
        dist = Math.abs(cellIndex - center);
        cellPhase = cellCount > 1 ? dist / (cellCount - 1) : 0;
      }
      const waveFront = progress * speed * (layout.rows > 1 ? Math.max(layout.rows, layout.cols) : cellCount);
      const delta = Math.abs(dist - waveFront);
      if (delta < width) {
        const intensity = (1 - delta / width) * Math.pow(decay, Math.floor(waveFront / Math.max(1, cellCount)));
        return multicellColorOutput(channelType, Math.max(0, intensity), baseValues, data, params, cellPhase);
      }
      return 0;
    }

    case 'cell_strobe': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) {
        if (channelType === 'strobe') return masterStrobeValue();
        return multicellMasterOutput(channelType, baseValues, data, params);
      }
      if (noStrobes) {
        const cellPhase = cellCount > 1 ? cellIndex / (cellCount - 1) : 0;
        return multicellColorOutput(channelType, 1, baseValues, data, params, cellPhase);
      }
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const freq = params.frequency || data.frequency || 8;
      const pattern = params.pattern || data.pattern || 'sequential';

      const beat = Math.floor(progress * freq);
      let activePos;
      if (pattern === 'random') {
        activePos = Math.floor(pseudoRandom(beat * 997) * extent);
      } else {
        activePos = beat % extent;
      }
      const cellPhase = extent > 1 ? pos / (extent - 1) : 0;
      return multicellColorOutput(channelType, pos === activePos ? 1 : 0, baseValues, data, params, cellPhase);
    }

    case 'checker': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const blockSize = params.block_size || data.block_size || 2;
      const speed = params.speed || data.speed || 1;
      const phase = Math.floor(progress * speed * 2) % 2;
      const cellPhase = layout.rows * layout.cols > 1
        ? (row * layout.cols + col) / (layout.rows * layout.cols - 1)
        : 0;
      const on = (Math.floor(row / blockSize) + Math.floor(col / blockSize) + phase) % 2 === 0;
      return multicellColorOutput(channelType, on ? 1 : 0, baseValues, data, params, cellPhase);
    }

    case 'matrix_alternate': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const axis = params.axis || data.axis || 'rows';
      const speed = params.speed || data.speed || 1;
      const phase = Math.floor(progress * speed * 2) % 2;
      const cellPhase = layout.rows * layout.cols > 1
        ? (row * layout.cols + col) / (layout.rows * layout.cols - 1)
        : 0;
      let on;
      if (axis === 'cols') on = (col % 2) === phase;
      else if (axis === 'both') on = ((row + col) % 2) === phase;
      else on = (row % 2) === phase;
      return multicellColorOutput(channelType, on ? 1 : 0, baseValues, data, params, cellPhase);
    }

    case 'diagonal': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 2;
      const dir = params.direction || data.direction || 'down_right';
      const dist = dir === 'down_left' ? (row + (layout.cols - 1 - col)) : (row + col);
      const maxDist = Math.max(1, layout.rows + layout.cols - 2);
      const waveFront = (progress * speed * (maxDist + 1)) % (maxDist + 1);
      const delta = Math.abs(dist - waveFront);
      const cellPhase = dist / maxDist;
      const br = delta < width ? 1 - delta / width : 0;
      return multicellColorOutput(channelType, br, baseValues, data, params, cellPhase);
    }

    case 'plasma': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const speed = params.speed || data.speed || 1;
      const scale = params.scale || data.scale || 0.85;
      const t = progress * speed * Math.PI * 2;
      const v = Math.sin(row * scale + t)
        + Math.sin(col * scale * 1.1 - t * 0.7)
        + Math.sin((row + col) * scale * 0.5 + t * 1.3);
      const cellPhase = ((v + 3) / 6 + progress * 0.05) % 1;
      const br = Math.max(0, Math.min(1, (v + 3) / 6));
      return multicellColorOutput(channelType, br, baseValues, data, params, cellPhase);
    }

    case 'rain': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const speed = params.speed || data.speed || 1;
      const tail = params.tail || data.tail || 2;
      const density = params.density || data.density || 0.45;
      const colSeed = col * 9973 + (params.strip_cell_offset || 0);
      if (pseudoRandom(colSeed + 2) >= density) return 0;
      const dropSpeed = 0.4 + pseudoRandom(colSeed) * 0.6;
      const headRow = (progress * speed * (layout.rows + tail) * dropSpeed + pseudoRandom(colSeed + 1) * layout.rows)
        % (layout.rows + tail);
      const behind = headRow - row;
      const cellPhase = col / Math.max(1, layout.cols - 1);
      if (behind >= 0 && behind <= tail) {
        return multicellColorOutput(channelType, 1 - behind / (tail + 1), baseValues, data, params, cellPhase);
      }
      return 0;
    }

    case 'fill_rows': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { row, col, layout } = resolveMatrixRowCol(cellIndex, cellCount, params, data, channelCtx);
      const speed = params.speed || data.speed || 1;
      const dir = params.direction || data.direction || 'down';
      const cycle = (progress * speed) % 1;
      const litRows = Math.max(1, Math.ceil(cycle * layout.rows));
      const cellPhase = layout.cols > 1 ? col / (layout.cols - 1) : 0;
      let on;
      if (dir === 'up') on = row >= layout.rows - litRows;
      else on = row < litRows;
      return multicellColorOutput(channelType, on ? 1 : 0, baseValues, data, params, cellPhase);
    }

    case 'gradient': {
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;
      if (isMaster) return multicellMasterOutput(channelType, baseValues, data, params);
      const { pos, extent } = getSweepPosition(cellIndex, cellCount);
      const speed = params.speed || data.speed || 1;
      if (!['red', 'green', 'blue', 'white'].includes(channelType)) {
        if (channelType === 'dimmer') return 255;
        return null;
      }

      const gradPos = ((extent > 1 ? pos / (extent - 1) : 0) + progress * speed) % 1;

      if (params.live_color_override) {
        const br = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(gradPos * Math.PI * 2));
        return multicellColorOutput(channelType, br, baseValues, data, { ...params, color_mode: 'base' }, 0);
      }

      const palette = getEffectPaletteRgb(data, params);
      if (usePaletteColors(data, params) && palette) {
        const [r, g, b] = rgbAtPalettePhase(gradPos, palette);
        if (channelType === 'red') return r;
        if (channelType === 'green') return g;
        if (channelType === 'blue') return b;
        return null;
      }
      if (useHslColors(data, params)) {
        const [r, g, b] = hslToRgb(gradPos, 1, 0.5);
        if (channelType === 'red') return r;
        if (channelType === 'green') return g;
        if (channelType === 'blue') return b;
        return null;
      }

      const colors = data.colors || ['#ff0000', '#0000ff'];
      const segmentCount = colors.length - 1;
      const segPos = gradPos * segmentCount;
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
      if (channelType === 'white') return Math.round((r + g + b) / 3);
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
      else if (dir === 'top_bottom') headPos = cycle;
      else if (dir === 'bottom_top') headPos = 1 - cycle;
      else headPos = cycle;

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      const pos = useY ? (channelCtx._rigPositionY ?? 0.5) : rigPos;
      const halfW = width / 2;
      const dist = Math.abs(pos - headPos);

      let brightness = 0;
      if (dist <= halfW) brightness = 1;
      else if (tail > 0 && dist <= halfW + tail) brightness = 1 - (dist - halfW) / tail;

      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, brightness, baseValues, data, params, pos);
        if (out !== null) return out;
      }

      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      if (dist <= halfW) return val;
      if (tail > 0 && dist <= halfW + tail) return val * (1 - (dist - halfW) / tail);
      return 0;
    }

    // ── Rig Color Wave: hue shift offset by fixture position ───────────
    case 'rig_color_wave': {
      const speed = params.speed || data.speed || 1;
      const wavelength = params.wavelength || data.wavelength || 1.0;
      const dir = params.direction || data.direction || 'left_right';
      const palette = getEffectPaletteRgb(data, params);

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      let pos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      if (dir === 'right_left' || dir === 'bottom_top') pos = 1 - pos;

      const phase = ((pos / wavelength + progress * speed) % 1 + 1) % 1;
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(phase, palette);
      } else {
        const hue = (phase * 360) % 360;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
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
      const smooth = intensity > 0 ? (Math.cos((1 - intensity) * Math.PI) + 1) / 2 : 0;

      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, smooth, baseValues, data, params, rigPos);
        if (out !== null) return out;
      }

      if (channelType === 'dimmer') return Math.round(255 * smooth);
      return Math.round(val * smooth);
    }

    // ── Rig Alternate: even/odd split based on rig order ───────────────
    case 'rig_alternate': {
      const speed = params.speed || data.speed || 1;
      const rigOrder = channelCtx._rigOrder ?? 0;
      const fixtureCount = channelCtx._rigFixtureCount || 1;
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const cycle = (progress * speed) % 1;
      const isEven = (rigOrder % 2) === 0;
      const phase = cycle < 0.5;
      const active = isEven ? phase : !phase;
      const brightness = active ? 1 : 0;
      const colorPhase = fixtureCount > 1 ? rigOrder / (fixtureCount - 1) : 0;

      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, brightness, baseValues, data, params, colorPhase);
        if (out !== null) return out;
      }

      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      return active ? val : 0;
    }

    // ── Rig Converge/Diverge: sweep from edges to center or vice versa ─
    case 'rig_converge': {
      const speed = params.speed || data.speed || 1;
      const width = params.width || data.width || 0.2;
      const mode = params.mode || data.mode || 'converge';
      const dir = params.direction || data.direction || 'left_right';

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      const rigPos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      const val = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const cycle = (progress * speed) % 1;
      const distFromCenter = Math.abs(rigPos - 0.5);

      let sweepEdge;
      if (mode === 'diverge') sweepEdge = cycle * 0.5;
      else sweepEdge = 0.5 - cycle * 0.5;

      const dist = Math.abs(distFromCenter - sweepEdge);
      let brightness = 0;
      if (dist <= width / 2) brightness = 1;
      else if (dist <= width) brightness = 1 - (dist - width / 2) / (width / 2);

      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, brightness, baseValues, data, params, rigPos);
        if (out !== null) return out;
      }

      if (dist <= width / 2) return val;
      if (dist <= width) return val * (1 - (dist - width / 2) / (width / 2));
      return 0;
    }

    // ── Rig Rainbow: rainbow gradient spread across the entire rig ─────
    case 'rig_rainbow': {
      const speed = params.speed || data.speed || 0.5;
      const spread = params.spread || data.spread || 1.0;
      const dir = params.direction || data.direction || 'left_right';
      const palette = getEffectPaletteRgb(data, params);

      const useY = (dir === 'top_bottom' || dir === 'bottom_top');
      let pos = useY ? (channelCtx._rigPositionY ?? 0.5) : (channelCtx._rigPosition ?? 0.5);
      if (dir === 'right_left' || dir === 'bottom_top') pos = 1 - pos;

      const phase = ((pos * spread + progress * speed) % 1 + 1) % 1;
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(phase, palette);
      } else {
        const hue = (phase * 360) % 360;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    // ── Rig Depth Chase: chase sweeps front-to-back using rig_y (depth) ─
    case 'rig_depth_chase': {
      const speed  = params.speed || data.speed || 1;
      const width  = params.width || data.width || 0.3;
      const tail   = params.tail  || data.tail  || 0.2;
      const dir    = params.direction || data.direction || 'front_back';
      const val    = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;
      const depth  = channelCtx._rigPositionY ?? 0.5;

      const cycle = (progress * speed) % 1;
      let headPos;
      if      (dir === 'back_front') headPos = 1 - cycle;
      else if (dir === 'bounce')     headPos = cycle < 0.5 ? cycle * 2 : (1 - cycle) * 2;
      else                            headPos = cycle;

      const halfW = width / 2;
      const dist  = Math.abs(depth - headPos);
      let brightness = 0;
      if (dist <= halfW) brightness = 1;
      else if (tail > 0 && dist <= halfW + tail) brightness = 1 - (dist - halfW) / tail;

      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, brightness, baseValues, data, params, depth);
        if (out !== null) return out;
      }

      if (channelType === 'dimmer') return baseValues[channelType] ?? 255;
      if (dist <= halfW) return val;
      if (tail > 0 && dist <= halfW + tail) return val * (1 - (dist - halfW) / tail);
      return 0;
    }

    // ── Rig Depth Wave: color/intensity wave rolling front-to-back ──────
    case 'rig_depth_wave': {
      const speed      = params.speed      || data.speed      || 1;
      const wavelength = params.wavelength || data.wavelength || 1.0;
      const dir        = params.direction  || data.direction  || 'front_back';
      const palette = getEffectPaletteRgb(data, params);
      let depth = channelCtx._rigPositionY ?? 0.5;
      if (dir === 'back_front') depth = 1 - depth;

      const phase = ((depth / wavelength + progress * speed) % 1 + 1) % 1;
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(phase, palette);
      } else {
        const hue = (phase * 360) % 360;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
      if (channelType === 'red')    return r;
      if (channelType === 'green')  return g;
      if (channelType === 'blue')   return b;
      if (channelType === 'dimmer') return 255;
      return null;
    }

    // ── Rig Round Robin: fixtures light one-by-one in rig-order sequence ─
    case 'rig_round_robin': {
      const speed  = params.speed  || data.speed  || 1;
      const window = params.window || data.window || 1;
      const tail   = params.tail   || data.tail   || 0;
      const dir    = params.direction || data.direction || 'forward';
      const val    = baseValues[channelType] !== undefined ? baseValues[channelType] : 255;

      const N         = channelCtx._rigFixtureCount || 1;
      let headPos;
      if (dir === 'ping_pong') {
        const raw = (progress * speed * N * 2) % (N * 2);
        headPos = raw < N ? raw : N * 2 - raw;
      } else {
        headPos = (progress * speed * N) % N;
        if (dir === 'reverse') headPos = (N - headPos) % N;
      }

      const orderToUse = dir === 'reverse' ? (N - 1 - (channelCtx._rigOrder ?? 0)) : (channelCtx._rigOrder ?? 0);
      let dist = Math.abs(orderToUse - headPos);
      if (dist > N / 2) dist = N - dist;

      const halfW = window / 2;
      let brightness = 0;
      if (dist <= halfW) brightness = 1;
      else if (tail > 0 && dist <= halfW + tail) brightness = 1 - (dist - halfW) / tail;

      const colorPhase = N > 1 ? orderToUse / (N - 1) : 0;
      if (useSpectrumColors(data, params)) {
        const out = rigSpatialColorOutput(channelType, brightness, baseValues, data, params, colorPhase);
        if (out !== null) return out;
      }

      if (channelType === 'dimmer') {
        if (dist <= halfW) return 255;
        if (tail > 0 && dist <= halfW + tail) return Math.round(255 * (1 - (dist - halfW) / tail));
        return 0;
      }
      if (dist <= halfW) return val;
      if (tail > 0 && dist <= halfW + tail) return Math.round(val * (1 - (dist - halfW) / tail));
      return 0;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  Sound-Reactive Effects
    //  params.audio = { bass, mid, treble, energy, beat }  (all 0–1)
    // ═══════════════════════════════════════════════════════════════════════

    // ── Sound Pulse: brightness follows bass energy ──────────────────────
    case 'sound_pulse': {
      const audio = params.audio || {};
      const band = params.band || data.band || 'bass';
      const sensitivity = params.sensitivity || data.sensitivity || 1.0;
      const level = Math.min(1, (audio[band] || 0) * sensitivity);
      // Smooth envelope: square root for punchier response
      const envelope = Math.sqrt(level);
      if (channelType === 'dimmer') return Math.round(envelope * 255);
      if (channelType === 'red') return Math.round((baseValues.red ?? 255) * envelope);
      if (channelType === 'green') return Math.round((baseValues.green ?? 255) * envelope);
      if (channelType === 'blue') return Math.round((baseValues.blue ?? 255) * envelope);
      if (channelType === 'white') return Math.round((baseValues.white ?? 0) * envelope);
      return null;
    }

    // ── Sound Strobe: strobes when energy exceeds threshold ──────────────
    case 'sound_strobe': {
      const audio = params.audio || {};
      const band = params.band || data.band || 'energy';
      const threshold = params.threshold || data.threshold || 0.6;
      const level = audio[band] || 0;
      const on = level >= threshold;
      if (channelType === 'dimmer') return on ? 255 : 0;
      if (channelType === 'red') return on ? (baseValues.red ?? 255) : 0;
      if (channelType === 'green') return on ? (baseValues.green ?? 255) : 0;
      if (channelType === 'blue') return on ? (baseValues.blue ?? 255) : 0;
      if (channelType === 'white') return on ? (baseValues.white ?? 0) : 0;
      return null;
    }

    // ── Sound Chase: chase position driven by bass energy ────────────────
    case 'sound_chase': {
      const audio = params.audio || {};
      const band = params.band || data.band || 'bass';
      const width = params.width || data.width || 0.3;
      const level = audio[band] || 0;
      const fixtureCount = channelCtx._rigFixtureCount || channelCtx._fixtureCount || 1;
      const pos = channelCtx._rigPosition ?? (channelCtx._fixtureOrdinal || 0) / Math.max(1, fixtureCount - 1);
      // Chase head position sweeps based on accumulated progress, speed modulated by energy
      const speed = params.speed || data.speed || 1.0;
      const headPos = (progress * speed) % 1;
      // Distance from chase head
      let dist = Math.abs(pos - headPos);
      if (dist > 0.5) dist = 1 - dist; // wrap around
      const brightness = Math.max(0, 1 - dist / width) * Math.sqrt(level);
      if (channelType === 'dimmer') return Math.round(brightness * 255);
      if (channelType === 'red') return Math.round((baseValues.red ?? 255) * brightness);
      if (channelType === 'green') return Math.round((baseValues.green ?? 255) * brightness);
      if (channelType === 'blue') return Math.round((baseValues.blue ?? 255) * brightness);
      if (channelType === 'white') return Math.round((baseValues.white ?? 0) * brightness);
      return null;
    }

    // ── Sound Wave: color wave speed modulated by energy ─────────────────
    case 'sound_wave': {
      const audio = params.audio || {};
      const sensitivity = params.sensitivity || data.sensitivity || 1.5;
      const energy = Math.min(1, (audio.energy || 0) * sensitivity);
      const fixtureCount = channelCtx._rigFixtureCount || channelCtx._fixtureCount || 1;
      const pos = channelCtx._rigPosition ?? (channelCtx._fixtureOrdinal || 0) / Math.max(1, fixtureCount - 1);
      const speed = params.speed || data.speed || 0.5;
      const palette = getEffectPaletteRgb(data, params);
      const wavelength = 1.0 - (energy * 0.6);
      const phase = ((pos / Math.max(0.1, wavelength) + progress * speed) % 1 + 1) % 1;
      const sat = 0.8 + energy * 0.2;
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(phase, palette);
      } else {
        const hue = (phase * 360) % 360;
        [r, g, b] = hslToRgb(hue / 360, sat, 0.3 + energy * 0.2);
      }
      if (channelType === 'red') return r;
      if (channelType === 'green') return g;
      if (channelType === 'blue') return b;
      if (channelType === 'dimmer') return Math.round(128 + energy * 127);
      return null;
    }

    // ── Sound Flash: full-brightness flash on beat, fast decay ───────────
    case 'sound_flash': {
      const audio = params.audio || {};
      const beat = audio.beat || 0; // 1 = on beat, decays toward 0
      const decay = params.decay || data.decay || 0.85;
      // Beat is a raw 0-1 value — high on onset, decays
      const brightness = Math.pow(beat, 1 - decay);
      if (channelType === 'dimmer') return Math.round(brightness * 255);
      if (channelType === 'red') return Math.round((baseValues.red ?? 255) * brightness);
      if (channelType === 'green') return Math.round((baseValues.green ?? 255) * brightness);
      if (channelType === 'blue') return Math.round((baseValues.blue ?? 255) * brightness);
      if (channelType === 'white') return Math.round((baseValues.white ?? 0) * brightness);
      return null;
    }

    // ── Sound VU: bar-graph VU meter driven by audio energy ──────────────
    // Each cell (or rig fixture) represents a threshold on the bar.
    // A cell lights up if the audio energy is above its threshold position,
    // producing a proper rising/falling VU bar.  Color: green → yellow → red.
    case 'sound_vu': {
      const audio = params.audio || {};
      const { cellIndex, cellCount, isMaster, excluded } = resolveCellInfo();
      if (excluded) return null;

      // Master channel of a multicell fixture: use overall energy for dimmer
      if (isMaster) {
        if (channelType === 'dimmer') return Math.round(Math.sqrt(audio.energy || 0) * 255);
        return null;
      }

      // pos: 0 = bottom of bar (easiest to light), 1 = top (hardest)
      let pos, count;
      if (cellCount > 1) {
        // Multicell fixture — cells form the whole bar themselves
        pos   = cellIndex / Math.max(1, cellCount - 1);
        count = cellCount;
      } else {
        // Single-cell fixtures — rig position forms the bar
        const fixtureCount = channelCtx._rigFixtureCount || channelCtx._fixtureCount || 1;
        pos   = channelCtx._rigPosition ?? (channelCtx._fixtureOrdinal || 0) / Math.max(1, fixtureCount - 1);
        count = fixtureCount;
      }

      // Audio energy (0–1) drives the bar height.
      // Apply sqrt to give better visual ballistics at low levels.
      const energy = Math.sqrt(audio.energy || 0);

      // Hard on/off segment: lit if bar height exceeds this cell's threshold
      if (energy < pos) return 0;

      const palette = getEffectPaletteRgb(data, params);
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(1 - pos, palette);
      } else {
        const hue = (1 - pos) * 120;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }

      // Top lit cell gets a brightness boost so the leading edge is bright
      const cellThreshold = 1 / Math.max(1, count - 1);
      const isTop = (energy - pos) < cellThreshold;
      const bright = isTop ? 1.0 : 0.75;

      if (channelType === 'red')    return Math.round(r * bright);
      if (channelType === 'green')  return Math.round(g * bright);
      if (channelType === 'blue')   return Math.round(b * bright);
      if (channelType === 'dimmer') return Math.round(bright * 255);
      if (channelType === 'white')  return 0;
      return null;
    }

    // ── Rig VU Top→Bottom: bar fills downward from the top of the rig ────
    // Uses _rigPositionY: 0 = top, 1 = bottom.
    // Fixtures at the top light first; bar grows downward as energy rises.
    case 'sound_vu_tb': {
      const audio  = params.audio || {};
      const energy = Math.sqrt(audio.energy || 0);
      const fixtureCount = channelCtx._rigFixtureCount || channelCtx._fixtureCount || 1;
      // pos: 0 = top of rig, 1 = bottom
      const pos = channelCtx._rigPositionY ?? (channelCtx._fixtureOrdinal || 0) / Math.max(1, fixtureCount - 1);
      // A fixture lights when energy exceeds (1 - pos), i.e. top fixtures
      // light first (threshold near 1) and lower fixtures need more energy.
      const threshold = 1 - pos;
      if (energy < threshold) return 0;
      const palette = getEffectPaletteRgb(data, params);
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(pos, palette);
      } else {
        const hue = pos * 120;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
      const cellThreshold = 1 / Math.max(1, fixtureCount - 1);
      const isEdge = (energy - threshold) < cellThreshold;
      const bright = isEdge ? 1.0 : 0.75;
      if (channelType === 'red')    return Math.round(r * bright);
      if (channelType === 'green')  return Math.round(g * bright);
      if (channelType === 'blue')   return Math.round(b * bright);
      if (channelType === 'dimmer') return Math.round(bright * 255);
      if (channelType === 'white')  return 0;
      return null;
    }

    // ── Rig VU Left→Right: bar fills from left to right across the rig ───
    // Uses _rigPosition (X axis): 0 = left edge, 1 = right edge.
    // Fixtures on the left light first; bar grows rightward as energy rises.
    case 'sound_vu_lr': {
      const audio  = params.audio || {};
      const energy = Math.sqrt(audio.energy || 0);
      const fixtureCount = channelCtx._rigFixtureCount || channelCtx._fixtureCount || 1;
      // pos: 0 = left, 1 = right
      const pos = channelCtx._rigPosition ?? (channelCtx._fixtureOrdinal || 0) / Math.max(1, fixtureCount - 1);
      // Fixture lights when energy exceeds its position threshold
      if (energy < pos) return 0;
      const palette = getEffectPaletteRgb(data, params);
      let r; let g; let b;
      if (usePaletteColors(data, params) && palette) {
        [r, g, b] = rgbAtPalettePhase(1 - pos, palette);
      } else {
        const hue = (1 - pos) * 120;
        [r, g, b] = hslToRgb(hue / 360, 1, 0.5);
      }
      const cellThreshold = 1 / Math.max(1, fixtureCount - 1);
      const isEdge = (energy - pos) < cellThreshold;
      const bright = isEdge ? 1.0 : 0.75;
      if (channelType === 'red')    return Math.round(r * bright);
      if (channelType === 'green')  return Math.round(g * bright);
      if (channelType === 'blue')   return Math.round(b * bright);
      if (channelType === 'dimmer') return Math.round(bright * 255);
      if (channelType === 'white')  return 0;
      return null;
    }

    // ── Default: pass through base value ───────────────────────────────
    default:
      return baseValues[channelType] !== undefined ? baseValues[channelType] : null;
  }
}

/** Progress value for sequence playback — beat-scaled for motion FX, normalized for fades/buildups. */
function sequenceEffectProgress(effectType, cueStartMs, cueDurationMs, timeMs, effectSpeed, bpm) {
  const clamped = Math.max(0, timeMs - cueStartMs);
  const cueProgress = cueDurationMs > 0 ? clamped / cueDurationMs : 0;
  const speed = effectSpeed || 1;

  if (effectType === 'color_fade' || effectType === 'buildup') {
    return Math.min(1, cueProgress * speed);
  }

  const beatSec = 60 / Math.max(60, Math.min(200, bpm || 128));
  // speed=1 → about one motion cycle per bar (4 beats), not per beat
  const beatsPerCycle = 4;
  return ((clamped / 1000 / beatSec) * speed) / beatsPerCycle;
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  pseudoRandom,
  hslToRgb,
  computeEffectValue,
  sequenceEffectProgress,
  isFixtureCompatibleWithEffect,
  isGlobalMasterChannel,
  shouldApplyCellCue,
  isAuxiliaryMulticellChannel,
  MOVING_HEAD_EFFECT_TYPES,
  MULTICELL_EFFECT_TYPES,
  COLOR_EFFECT_TYPES,
  RIG_EFFECT_TYPES,
  SOUND_EFFECT_TYPES,
  PAN_TILT,
  COLOR_CHANNELS,
  GLOBAL_MASTER_CHANNEL_TYPES,
};
