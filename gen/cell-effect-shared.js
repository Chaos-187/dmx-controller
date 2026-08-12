/**
 * Shared helpers for pixel tape + multi-cell matrix effect cue generation.
 */

const { stableRoll, walkBeats } = require('./helpers');

const LEGACY_PATTERN_TO_EFFECT = {
  fill_sweep: 'chase', chase_slow: 'chase', chase: 'chase', chase_fast: 'chase', chase_accel: 'chase',
  alternate: 'scanner', alternate_fast: 'scanner',
  color_wave: 'color_wave', breathe: 'pulse', sparkle_field: 'sparkle',
  scatter: 'sparkle', scatter_strobe: 'cell_strobe', all_flash: 'pulse',
  gradient_sweep: 'gradient', ripple: 'ripple', blocks: 'segments',
  dual_chase: 'chase', comet: 'comet', snake: 'comet', segments: 'segments',
  build_reveal: 'buildup', center_pulse: 'pulse', checker: 'checker',
  split_wipe: 'chase', mirror: 'ripple', row_alternate: 'matrix_alternate',
  col_alternate: 'matrix_alternate', plasma: 'plasma', matrix_rain: 'rain',
  row_fill: 'fill_rows', diagonal_sweep: 'diagonal',
};

const MULTICELL_EFFECT_TYPES = new Set([
  'chase', 'comet', 'scanner', 'buildup', 'sparkle', 'color_wave', 'fire', 'pulse',
  'segments', 'ripple', 'cell_strobe', 'gradient',
  'checker', 'matrix_alternate', 'diagonal', 'plasma', 'rain', 'fill_rows',
]);

const EFFECT_COLORS = {
  chase: '#00897b', comet: '#e65100', scanner: '#00838f', sparkle: '#fdd835',
  color_wave: '#7b1fa2', fire: '#bf360c', buildup: '#2e7d32', pulse: '#1e88e5',
  segments: '#5e35b1', ripple: '#0277bd', cell_strobe: '#f44336', gradient: '#6a1b9a',
  checker: '#455a64', matrix_alternate: '#00838f', diagonal: '#ff6f00', plasma: '#7b1fa2',
  rain: '#0288d1', fill_rows: '#388e3c',
};

const CASCADE_SECTIONS = new Set(['chorus', 'drop', 'buildup']);

const STRIP_EFFECT_TYPES = new Set([
  'chase', 'comet', 'scanner', 'sparkle', 'color_wave', 'ripple', 'segments', 'gradient', 'buildup', 'cell_strobe',
  'checker', 'matrix_alternate', 'diagonal', 'plasma', 'rain', 'fill_rows',
]);

/** Effect types that flash cells or strobe channels — excluded when noStrobes is set. */
const STROBE_LIKE_EFFECT_TYPES = new Set(['cell_strobe']);

function filterNoStrobeEffects(types, noStrobes) {
  if (!noStrobes) return types;
  return types.filter(t => !STROBE_LIKE_EFFECT_TYPES.has(normalizeEffectType(t)));
}

/** Average track energy (0–1) over a phrase — for dimmer/brighter base levels. */
function getPhraseEnergyMult(startMs, endMs, energyLevels) {
  if (!energyLevels?.length) return 1;
  const inRange = energyLevels.filter(e => e.time_ms >= startMs && e.time_ms < endMs);
  if (!inRange.length) return 1;
  const avg = inRange.reduce((s, e) => s + (e.energy || 0), 0) / inRange.length;
  return 0.35 + Math.min(1, avg) * 0.65;
}

/** Pick horizontal vs vertical sweep for matrix fixtures. */
function pickMatrixAxis(effect, rows, phraseStart, phraseIndex) {
  if (rows <= 1) return 'horizontal';
  const verticalTypes = new Set([
    'chase', 'comet', 'scanner', 'gradient', 'color_wave', 'segments', 'buildup',
    'fill_rows', 'rain', 'matrix_alternate', 'diagonal',
  ]);
  if (!verticalTypes.has(effect.type)) return 'horizontal';
  if (phraseIndex != null && phraseIndex % 2 === 1) return 'vertical';
  const roll = stableRoll(`mc-axis-${phraseStart}-${effect.type}`);
  return roll < 0.55 ? 'vertical' : 'horizontal';
}

function scaleEffectSpeed(params, type) {
  const speedKeys = ['speed', 'offset_speed'];
  for (const key of speedKeys) {
    if (params[key] != null) params[key] = params[key] * 0.6;
  }
  if (type === 'scanner' && params.speed != null) params.speed *= 0.85;
  return params;
}

function normalizeEffectType(name) {
  return LEGACY_PATTERN_TO_EFFECT[name] || name;
}

function mergeCellPatternDefaults(existing, defaults) {
  const merged = { ...defaults, ...existing };
  for (const section of new Set([...Object.keys(defaults), ...Object.keys(existing || {})])) {
    const base = (defaults[section] || []).map(normalizeEffectType);
    const cur = ((existing && existing[section]) || []).map(normalizeEffectType);
    merged[section] = [...new Set([...base, ...cur])];
  }
  return merged;
}

function buildMultiCellEffectIndex(effects) {
  const byType = {};
  for (const eff of effects) {
    if (!MULTICELL_EFFECT_TYPES.has(eff.type)) continue;
    const target = eff.fixture_target || 'all';
    if (target !== 'multicell' && target !== 'all' && target !== 'color') continue;
    if (!byType[eff.type]) byType[eff.type] = [];
    byType[eff.type].push(eff);
  }
  return byType;
}

function pickEffect(effectsByType, desiredTypes, rollKey) {
  const candidates = [];
  for (const t of desiredTypes) {
    const type = normalizeEffectType(t);
    if (effectsByType[type]) candidates.push(...effectsByType[type]);
  }
  if (!candidates.length) return null;
  const r = stableRoll(rollKey);
  return candidates[Math.floor(r * candidates.length)];
}

function paramsForStripSize(effect, stripTotal) {
  const type = effect.type;
  const base = { ...(effect.effect_data || {}) };
  let params;
  if (stripTotal >= 64) {
    if (type === 'chase') params = { ...base, width: 8, tail: 6, speed: 0.5 };
    else if (type === 'comet') params = { ...base, tail: 16, speed: 0.55 };
    else if (type === 'segments') params = { ...base, segment_size: 6, offset_speed: 0.8 };
    else if (type === 'ripple') params = { ...base, width: 8, speed: 0.55 };
    else params = base;
  } else if (stripTotal >= 32) {
    if (type === 'chase') params = { ...base, width: 6, tail: 4, speed: 0.45 };
    else if (type === 'comet') params = { ...base, tail: 12, speed: 0.5 };
    else if (type === 'segments') params = { ...base, segment_size: 4, offset_speed: 0.7 };
    else if (type === 'ripple') params = { ...base, width: 6, speed: 0.5 };
    else params = base;
  } else if (stripTotal >= 16) {
    if (type === 'chase') params = { ...base, width: 4, tail: 3, speed: 0.4 };
    else if (type === 'comet') params = { ...base, tail: 10, speed: 0.45 };
    else if (type === 'segments') params = { ...base, segment_size: 3, offset_speed: 0.6 };
    else if (type === 'ripple') params = { ...base, width: 5, speed: 0.45 };
    else params = base;
  } else {
    if (type === 'chase') params = { ...base, width: 3, tail: 2, speed: 0.35 };
    else if (type === 'comet') params = { ...base, tail: 8, speed: 0.4 };
    else if (type === 'scanner') params = { ...base, speed: 0.6 };
    else params = base;
  }
  if (type === 'sparkle') {
    params = {
      ...params,
      density: Math.min(params.density ?? 0.1, 0.08),
      fade_speed: Math.min(params.fade_speed ?? 6, 2.5),
    };
  } else if (type === 'cell_strobe') {
    params = { ...params, frequency: Math.min(params.frequency ?? 8, 2.5) };
  } else if (type === 'gradient') {
    params = { ...params, speed: params.speed ?? 0.8 };
  } else if (type === 'checker') {
    params = { ...params, block_size: params.block_size ?? 2, speed: params.speed ?? 1 };
  } else if (type === 'matrix_alternate') {
    params = { ...params, speed: params.speed ?? 1 };
  } else if (type === 'diagonal') {
    params = { ...params, width: params.width ?? 3, speed: params.speed ?? 1 };
  } else if (type === 'plasma') {
    params = { ...params, scale: params.scale ?? 0.85, speed: params.speed ?? 0.8 };
  } else if (type === 'rain') {
    params = {
      ...params,
      tail: params.tail ?? 3,
      density: Math.min(params.density ?? 0.45, 0.35),
      speed: params.speed ?? 1,
    };
  } else if (type === 'fill_rows') {
    params = { ...params, speed: params.speed ?? 0.8 };
  }
  return scaleEffectSpeed(params, type);
}

function paramsForFixture(effect, fix, groupIndex, sortedGroup, opts = {}) {
  const stripTotal = sortedGroup.reduce((s, f) => s + (f.cell_count || 0), 0);
  let stripOffset = 0;
  for (let i = 0; i < groupIndex; i++) stripOffset += sortedGroup[i].cell_count || 0;

  const unify = opts.alwaysStrip || sortedGroup.length > 1;
  const rows = fix.cell_rows || 1;
  let cols = fix.cell_cols || fix.cell_count || 1;
  if (unify && sortedGroup.length > 1 && rows > 1) {
    cols = cols * sortedGroup.length;
  }

  const sizing = unify ? stripTotal : (fix.cell_count || stripTotal);
  const params = paramsForStripSize(effect, sizing);
  params.cell_rows = rows;
  params.cell_cols = unify && sortedGroup.length > 1 && rows > 1 ? cols : (fix.cell_cols || fix.cell_count || 1);
  if (rows > 1) {
    params.matrix_axis = pickMatrixAxis(effect, rows, opts.phraseStart, opts.phraseIndex);
  }

  if (unify) {
    params.strip_cell_offset = stripOffset;
    params.strip_cell_total = stripTotal;
    params.strip_fixture_index = groupIndex;
    params.strip_fixture_count = sortedGroup.length;
    if (effect.type === 'chase') {
      const roll = stableRoll(`mc-dir-${fix.id}-${effect.id}-${opts.phraseStart || 0}`);
      if (params.matrix_axis === 'vertical') {
        if (roll < 0.5) params.direction = 'bounce';
        else params.direction = 'left';
      } else if (roll < 0.3) params.direction = 'bounce';
      else if (roll < 0.5) params.direction = 'right';
      else params.direction = 'left';
    }
    if (effect.type === 'comet' && stableRoll(`mc-comet-${fix.id}`) > 0.5) {
      params.direction = 'right';
    }
  } else if (rows > 1 && effect.type === 'chase') {
    params.direction = params.direction || 'left';
  }

  return params;
}

function shouldUseUnifiedStrip(group, label, phraseStart, alwaysStrip) {
  if (group.length < 2) return false;
  if (alwaysStrip) return true;
  if (CASCADE_SECTIONS.has(label)) return true;
  return true;
}

/**
 * Group matrix fixtures for effect generation.
 * Prefer an explicit fixture group when 2+ units share the same type and cell count
 * (e.g. both Atomix in MULTICELLS); otherwise fall back to fixture type name.
 */
function buildMatrixFixtureGroups(matrixFixtures) {
  const eligible = matrixFixtures.filter((f) => (f.cell_count || 0) >= 2);
  const assigned = new Set();
  const groups = {};

  // Explicit fixture-group strips (same type + cell count within one group)
  const byGroupId = new Map();
  for (const fix of eligible) {
    for (const gid of fix.group_ids || []) {
      if (!byGroupId.has(gid)) byGroupId.set(gid, []);
      byGroupId.get(gid).push(fix);
    }
  }
  for (const [gid, members] of byGroupId) {
    const buckets = new Map();
    for (const f of members) {
      const k = `${f.type_name}|${f.cell_count}`;
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(f);
    }
    for (const [k, list] of buckets) {
      if (list.length < 2) continue;
      const key = `group_${gid}_${k}`;
      groups[key] = list;
      list.forEach((f) => assigned.add(f.id));
    }
  }

  for (const fix of eligible) {
    if (assigned.has(fix.id)) continue;
    const key = fix.type_name || `matrix_${fix.id}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(fix);
  }

  return groups;
}

/**
 * Split a section into bar-aligned phrases for multicell/tape effect cues.
 * High-energy sections use shorter phrases (more variety); others use 8-bar blocks.
 */
function barAlignedPhrases(secStartMs, secEndMs, label, ctx) {
  const { barMs, beatMs, beats, snapBar, snapBeat } = ctx;
  const isHigh = label === 'chorus' || label === 'drop' || label === 'buildup';
  const barsPerPhrase = isHigh ? 4 : 4;
  const minPhraseMs = barMs * 2;

  let t = snapBar(Math.round(secStartMs));
  if (t < secStartMs) t = snapBeat(Math.round(secStartMs));
  if (t > secStartMs + beatMs) t = Math.round(secStartMs);

  const phrases = [];
  while (t < secEndMs - minPhraseMs) {
    const end = Math.min(Math.round(walkBeats(t, barsPerPhrase * 4, beats, beatMs)), secEndMs);
    const dur = end - t;
    if (dur >= minPhraseMs) phrases.push({ start_ms: t, duration_ms: dur });
    if (end <= t) break;
    t = end;
  }

  if (!phrases.length && secEndMs - t >= barMs) {
    phrases.push({ start_ms: t, duration_ms: secEndMs - t });
  } else if (phrases.length) {
    const last = phrases[phrases.length - 1];
    const lastEnd = last.start_ms + last.duration_ms;
    if (lastEnd < secEndMs - beatMs) {
      last.duration_ms = secEndMs - last.start_ms;
    }
  }
  return phrases;
}

function isMatrixFixture(fix) {
  if (fix.category !== 'multi_cell') return false;
  const rows = fix.cell_rows || 1;
  const cols = fix.cell_cols || 0;
  if (rows > 1 || cols > 1) return true;
  return (fix.cell_count || 0) >= 2;
}

module.exports = {
  LEGACY_PATTERN_TO_EFFECT,
  MULTICELL_EFFECT_TYPES,
  EFFECT_COLORS,
  CASCADE_SECTIONS,
  STRIP_EFFECT_TYPES,
  STROBE_LIKE_EFFECT_TYPES,
  filterNoStrobeEffects,
  getPhraseEnergyMult,
  pickMatrixAxis,
  normalizeEffectType,
  mergeCellPatternDefaults,
  buildMultiCellEffectIndex,
  pickEffect,
  paramsForStripSize,
  paramsForFixture,
  shouldUseUnifiedStrip,
  buildMatrixFixtureGroups,
  isMatrixFixture,
  barAlignedPhrases,
};
