/**
 * Sequence Generator — Orchestrator
 *
 * Generates DMX light sequences from track analysis data.
 * Creates beat-synced cues with color changes, strobes, effects,
 * and section-appropriate lighting styles.
 *
 * Supports selectable color palettes and genre-based behaviour presets.
 *
 * This file is a thin orchestrator that delegates to sub-modules in ./gen/.
 */

// ─── Sub-module imports ─────────────────────────────────────────────────────

const {
  colorPalettes, PALETTE_KEYS, ALL_PALETTE_OPTIONS,
  genrePalettes, genrePresets, genreAliases,
  resolveGenrePreset, resolveGenrePresetWith,
  sectionStyles, defaultStyle, getSectionPalettes,
} = require('./gen/palettes');

const { seededRandom, snapToBeat, snapToBar, computeDownbeatPhase } = require('./gen/helpers');

const { generateSectionBased, resolveMultiCellConflicts } = require('./gen/section-generator');
const { generateBarBased }         = require('./gen/bar-generator');
const { generateColorWheelCues }   = require('./gen/color-wheel');
const { MOVEMENT_STYLES, DEFAULT_MOVEMENT, SPEED_DMX, generateMoverMovement } = require('./gen/mover-movement');
const { SECTION_EFFECT_TYPES, generateEffectCues } = require('./gen/effects');
const { CELL_PATTERN_MAP, generateMultiCellPatterns } = require('./gen/multi-cell');
const { buildGroupMap } = require('./gen/group-coordination');

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
/**
 * Remove individual color and per-fixture FX cues whose start falls inside
 * a rig-wide effect window.  The rig effect drives all fixtures, so stacking
 * individual cues on top just creates visual clutter.
 */
/**
 * Remove color cues that overlap per-fixture FX windows.  Color + effect on
 * the same fixture at once looks chaotic; let the effect own that moment.
 */
function suppressColorDuringFixtureEffects(cues) {
  const fxByFixture = new Map();
  for (const c of cues) {
    if (c.track !== 'fx' || !c.fixture_id) continue;
    if (!fxByFixture.has(c.fixture_id)) fxByFixture.set(c.fixture_id, []);
    fxByFixture.get(c.fixture_id).push({
      start: c.start_ms,
      end: c.start_ms + c.duration_ms,
    });
  }
  if (fxByFixture.size === 0) return;

  function overlapsFx(fixtureId, startMs, endMs) {
    const intervals = fxByFixture.get(fixtureId);
    if (!intervals) return false;
    for (const iv of intervals) {
      if (startMs < iv.end && endMs > iv.start) return true;
    }
    return false;
  }

  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.track !== 'color' || !c.fixture_id) continue;
    const endMs = c.start_ms + c.duration_ms;
    if (overlapsFx(c.fixture_id, c.start_ms, endMs)) {
      cues.splice(i, 1);
    }
  }
}

function suppressCuesDuringRigEffects(cues) {
  // Collect rig effect intervals
  const rigIntervals = [];
  for (const c of cues) {
    if (c.track === 'fx-rig') {
      rigIntervals.push({ start: c.start_ms, end: c.start_ms + c.duration_ms });
    }
  }
  if (rigIntervals.length === 0) return;

  function insideRig(startMs) {
    for (const iv of rigIntervals) {
      if (startMs >= iv.start && startMs < iv.end) return true;
    }
    return false;
  }

  // Walk backwards so splice doesn't shift indices
  for (let i = cues.length - 1; i >= 0; i--) {
    const c = cues[i];
    if (c.track === 'fx-rig') continue;
    if (c.fixture_id === 0) continue;
    if (!insideRig(c.start_ms)) continue;

    if (c.track === 'fx' || c.track === 'color') {
      cues.splice(i, 1);
    }
  }
}

/**
 * Generate a sequence of cues for a track.
 *
 * @param {Object} opts
 * @param {Object} opts.track       - Track record from DB
 * @param {Array}  opts.fixtures    - Fixture channel map from DB
 * @param {Object} [opts.analysis]  - Track analysis (with sections, beats, energy_levels)
 * @param {string} [opts.palette]   - Color palette key (default: auto from genre or 'vibrant')
 * @param {string} [opts.genre]     - Genre preset key (default: auto-detect from track.genre)
 * @param {Array}  [opts.effects]   - Effects library from DB (used for effect-based cues)
 * @returns {Object} { cues, bpm, durationMs, palette, genrePreset }
 */
function generateSequence(opts) {
  const { track, fixtures, analysis, effects, moverPresets } = opts;
  const bpm = track.bpm || 128;
  const durationMs = (track.song_length || 180) * 1000;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  // First beat offset: align cue timing to actual musical bars
  const firstBeatMs = (track.beatgrid_pos || 0) * 1000;

  // ── Load generator config (DB overrides → hardcoded fallback) ───────
  const gc = opts.generatorConfig || {};
  const activePalettes       = gc.gen_color_palettes    || colorPalettes;
  const activeGenrePresets    = gc.gen_genre_presets     || genrePresets;
  const activeGenreAliases   = gc.gen_genre_aliases     || genreAliases;
  const activeSectionStyles  = gc.gen_section_styles    || sectionStyles;
  const activeMovementStyles = gc.gen_movement_styles   || MOVEMENT_STYLES;
  const activeSpeedDmx       = gc.gen_speed_dmx         || SPEED_DMX;
  const activeSectionEffects = gc.gen_section_effects   || SECTION_EFFECT_TYPES;
  const activeCellPatterns   = gc.gen_cell_patterns     || CELL_PATTERN_MAP;
  const activeFixtureIntensity = gc.gen_fixture_intensity || null;

  // Resolve genre preset using active config
  const genreKey = opts.genre || resolveGenrePresetWith(track.genre, activeGenrePresets, activeGenreAliases);
  const preset = activeGenrePresets[genreKey] || activeGenrePresets.default || genrePresets.default;

  // ── BPM-adaptive factor ─────────────────────────────────────────────
  const bpmFactor = Math.max(0, Math.min(1, (bpm - 90) / 60));

  // Strobe suppression from config
  const noStrobes = !!opts.noStrobes;

  // Resolve color palette
  const activePaletteKeys = Object.keys(activePalettes);
  let paletteKey = opts.palette || preset.preferredPalette || 'vibrant';
  const rand = seededRandom(track.id * 7919 + Math.round(bpm * 100));
  if (paletteKey === 'random') {
    paletteKey = activePaletteKeys[Math.floor(rand() * activePaletteKeys.length)];
  }

  // Parse analysis data
  let sections = [];
  let beats = [];
  let energyLevels = [];
  let stemEnergy = null;
  if (analysis) {
    try { sections = JSON.parse(analysis.sections || '[]'); } catch (e) { sections = []; }
    try { beats = JSON.parse(analysis.beats || '[]'); } catch (e) { beats = []; }
    try { energyLevels = JSON.parse(analysis.energy_levels || '[]'); } catch (e) { energyLevels = []; }
    try { stemEnergy = analysis.stem_energy ? JSON.parse(analysis.stem_energy) : null; } catch (e) { stemEnergy = null; }
  }

  // Exclude fixtures marked as "exclude from sequence"
  const activeFixtures = fixtures.filter(fix => !fix.exclude_from_sequence);

  // Filter to RGB fixtures
  const rgbFixtures = activeFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'red') &&
    fix.channels.some(ch => ch.type === 'green') &&
    fix.channels.some(ch => ch.type === 'blue')
  );

  // Color-wheel-only fixtures
  const rgbIds = new Set(rgbFixtures.map(f => f.id));
  const colorWheelFixtures = activeFixtures.filter(fix =>
    !rgbIds.has(fix.id) &&
    fix.channels.some(ch => ch.type === 'color_wheel') &&
    fix.color_wheel_map && fix.color_wheel_map.length > 0
  );

  if (rgbFixtures.length === 0 && colorWheelFixtures.length === 0) {
    return { cues: [], bpm, durationMs, palette: paletteKey, genrePreset: genreKey };
  }

  // Classify fixtures: movers (pan+tilt), LED bars (many cells), regular pars
  const allMovers = activeFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  const movers = rgbFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  const moverIds = new Set(movers.map(m => m.id));
  const allMoverIds = new Set(allMovers.map(m => m.id));
  const nonMoverFixtures = rgbFixtures.filter(fix => !moverIds.has(fix.id));

  const ledBars = nonMoverFixtures.filter(fix => {
    if (fix.category === 'led_bar' || fix.category === 'multi_cell') return true;
    const rgbCount = fix.channels.filter(ch => ch.type === 'red' || ch.type === 'green' || ch.type === 'blue').length;
    return rgbCount >= 6;
  });
  const ledBarIds = new Set(ledBars.map(b => b.id));

  const multiCellFixtures = nonMoverFixtures.filter(fix => fix.cell_count > 0);
  const regularFixtures = nonMoverFixtures.filter(fix => !ledBarIds.has(fix.id));

  // ── Build fixture role map for per-fixture intensity curves ──────────
  const fixtureRoleMap = new Map();
  for (const f of movers) fixtureRoleMap.set(f.id, 'mover');
  for (const f of ledBars) {
    fixtureRoleMap.set(f.id, f.category === 'multi_cell' ? 'multi_cell' : 'led_bar');
  }
  for (const f of colorWheelFixtures) fixtureRoleMap.set(f.id, 'color_wheel');
  for (const f of regularFixtures) {
    if (!fixtureRoleMap.has(f.id)) fixtureRoleMap.set(f.id, 'par');
  }
  // Multi-cell fixtures that aren't already tagged
  for (const f of multiCellFixtures) {
    if (!fixtureRoleMap.has(f.id)) {
      fixtureRoleMap.set(f.id, f.category === 'multi_cell' ? 'multi_cell' : 'led_bar');
    }
  }

  const cues = [];
  const downbeatPhase = computeDownbeatPhase(beats, firstBeatMs);
  const snapBeat = (t) => snapToBeat(t, beats);
  const snapBar  = (t) => snapToBar(t, beats, downbeatPhase);

  // ── Build fixture-group map for coordinated generation ──────────────
  const groupMap = buildGroupMap(activeFixtures);

  const ctx = {
    bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, firstBeatMs, snapBeat, snapBar, beats,
    activePalettes, activeSectionStyles, activeMovementStyles, activeSpeedDmx,
    activeSectionEffects, activeCellPatterns, activeFixtureIntensity, fixtureRoleMap,
    stemEnergy, groupMap,
  };

  // Multi-cell fixtures get dedicated per-cell patterns, so exclude them
  // from the main section/bar generator to avoid master cues competing.
  const colorFixtures = (multiCellFixtures.length > 0 && sections.length > 0)
    ? rgbFixtures.filter(f => f.cell_count <= 0 && !moverIds.has(f.id))
    : rgbFixtures.filter(f => !moverIds.has(f.id));

  if (sections.length > 0) {
    generateSectionBased(cues, colorFixtures, sections, beats, energyLevels, ctx);
    if (movers.length > 0) {
      generateSectionBased(cues, movers, sections, beats, energyLevels, ctx, { colorOnly: true });
    }
  } else {
    generateBarBased(cues, colorFixtures, ctx);
    if (movers.length > 0) {
      generateBarBased(cues, movers, ctx);
    }
  }

  // ── Multi-cell pattern generation ─────────────────────────────────────
  if (multiCellFixtures.length > 0 && sections.length > 0) {
    generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx);
  }

  // ── Mover movement generation (all movers — RGB and color-wheel) ────
  if (allMovers.length > 0) {
    generateMoverMovement(cues, allMovers, sections, beats, ctx, moverPresets || []);
  }

  // ── Color-wheel cue generation ────────────────────────────────────────
  if (colorWheelFixtures.length > 0) {
    generateColorWheelCues(cues, colorWheelFixtures, sections, beats, energyLevels, ctx);
  }

  // ── Effects generation (non-movers only) ──────────────────────────────
  const multiCellIds = new Set(multiCellFixtures.map(f => f.id));
  const effectLedBars = ledBars.filter(f => !multiCellIds.has(f.id));
  const effectRegulars = regularFixtures.filter(f => !multiCellIds.has(f.id));
  if (effects && effects.length > 0 && (effectRegulars.length > 0 || effectLedBars.length > 0)) {
    generateEffectCues(cues, effectRegulars, effectLedBars, effects, sections, ctx);
  }

  // ── Resolve master ↔ cell cue conflicts ─────────────────────────────
  if (multiCellFixtures.length > 0) {
    resolveMultiCellConflicts(cues, multiCellFixtures);
  }

  // ── Suppress competing cue layers ─────────────────────────────────────
  // Per-fixture FX owns its window; rig-wide FX owns the whole rig.
  suppressColorDuringFixtureEffects(cues);
  suppressCuesDuringRigEffects(cues);

  return { cues, bpm, durationMs, palette: paletteKey, genrePreset: genreKey };
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  generateSequence,
  colorPalettes,
  genrePalettes,
  genrePresets,
  genreAliases,
  resolveGenrePreset,
  PALETTE_KEYS,
  ALL_PALETTE_OPTIONS,
};
