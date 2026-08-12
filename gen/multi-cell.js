/**
 * Multi-Cell Matrix Effect Generation
 *
 * For fixtures with a 2D cell layout (rows × cols) or large segmented panels
 * (e.g. Atomic Strobe). Emits effect cues; paired fixtures of the same type
 * can run as one unified virtual strip.
 */

const { getSectionPalettes } = require('./palettes');
const { getFixtureIntensity, stableRoll } = require('./helpers');
const {
  buildMultiCellEffectIndex,
  pickEffect,
  paramsForFixture,
  mergeCellPatternDefaults,
  LEGACY_PATTERN_TO_EFFECT,
  normalizeEffectType,
  EFFECT_COLORS,
  STRIP_EFFECT_TYPES,
  shouldUseUnifiedStrip,
  buildMatrixFixtureGroups,
  isMatrixFixture,
  filterNoStrobeEffects,
  getPhraseEnergyMult,
  barAlignedPhrases,
} = require('./cell-effect-shared');

const LARGE_CELL_THRESHOLD = 16;
const CELL_PATTERN_MAP = {
  intro:     ['chase', 'color_wave', 'ripple', 'sparkle', 'checker', 'plasma'],
  verse:     ['chase', 'comet', 'scanner', 'color_wave', 'sparkle', 'segments', 'ripple', 'diagonal', 'matrix_alternate'],
  chorus:    ['chase', 'comet', 'scanner', 'sparkle', 'ripple', 'segments', 'gradient', 'plasma', 'rain', 'checker'],
  bridge:    ['color_wave', 'scanner', 'chase', 'ripple', 'segments', 'matrix_alternate', 'fill_rows'],
  breakdown: ['color_wave', 'ripple', 'sparkle', 'segments', 'plasma', 'checker'],
  buildup:   ['buildup', 'chase', 'comet', 'scanner', 'ripple', 'segments', 'fill_rows', 'diagonal'],
  drop:      ['chase', 'cell_strobe', 'comet', 'scanner', 'sparkle', 'ripple', 'segments', 'rain', 'matrix_alternate'],
  outro:     ['chase', 'color_wave', 'ripple', 'gradient', 'plasma', 'fill_rows'],
};

/** Effect types for large matrix fixtures (16+ cells). */
const LARGE_CELL_PATTERN_MAP = {
  intro:     ['gradient', 'ripple', 'segments', 'chase', 'checker', 'plasma'],
  verse:     ['segments', 'comet', 'chase', 'gradient', 'ripple', 'sparkle', 'scanner', 'diagonal', 'matrix_alternate', 'rain'],
  chorus:    ['chase', 'comet', 'segments', 'ripple', 'gradient', 'sparkle', 'cell_strobe', 'plasma', 'checker', 'rain'],
  bridge:    ['gradient', 'ripple', 'segments', 'color_wave', 'comet', 'matrix_alternate', 'fill_rows'],
  breakdown: ['ripple', 'gradient', 'segments', 'sparkle', 'plasma', 'checker'],
  buildup:   ['buildup', 'comet', 'segments', 'chase', 'ripple', 'fill_rows', 'diagonal'],
  drop:      ['chase', 'cell_strobe', 'segments', 'ripple', 'comet', 'sparkle', 'rain', 'matrix_alternate', 'plasma'],
  outro:     ['gradient', 'chase', 'ripple', 'fill_rows', 'plasma'],
};

function isLargeCellCount(cellCount) {
  return cellCount >= LARGE_CELL_THRESHOLD;
}

function getEffectPool(label, cellCount, ctx, stripMode) {
  const section = label || 'verse';
  const raw = ctx.activeCellPatterns || CELL_PATTERN_MAP;
  let baseList = (raw[section] || raw.verse || CELL_PATTERN_MAP.verse).map(normalizeEffectType);
  if (!isLargeCellCount(cellCount)) {
    if (stripMode) baseList = baseList.filter(t => STRIP_EFFECT_TYPES.has(t));
  } else {
    const largeList = (LARGE_CELL_PATTERN_MAP[section] || LARGE_CELL_PATTERN_MAP.verse).map(normalizeEffectType);
    baseList = [...new Set([...largeList, ...baseList])];
    if (stripMode) baseList = baseList.filter(t => STRIP_EFFECT_TYPES.has(t));
  }
  return filterNoStrobeEffects(baseList.length ? baseList : ['chase', 'ripple', 'segments'], ctx.noStrobes);
}

function phrasesForSection(label, secStartMs, secEndMs, ctx) {
  return barAlignedPhrases(secStartMs, secEndMs, label, ctx);
}

function generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx) {
  const effects = ctx.effects;
  const matrixFixtures = multiCellFixtures.filter(isMatrixFixture);
  if (!effects?.length || !matrixFixtures.length || !sections.length) return;

  const { barMs, paletteKey, preset, snapBeat } = ctx;
  const effectsByType = buildMultiCellEffectIndex(effects);
  if (!Object.keys(effectsByType).length) return;

  const fixtureGroups = buildMatrixFixtureGroups(matrixFixtures);

  let laneCounter = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0) + 1;
  const groupLanes = {};
  for (const typeName of Object.keys(fixtureGroups)) {
    groupLanes[typeName] = laneCounter++;
  }

  const recentByGroup = {};
  const lastTypeByGroup = {};

  for (const [typeName, group] of Object.entries(fixtureGroups)) {
    const sorted = [...group].sort((a, b) => (a.rig_order || 0) - (b.rig_order || 0) || (a.rig_x || 0.5) - (b.rig_x || 0.5));
    const stripTotal = sorted.reduce((s, f) => s + (f.cell_count || 0), 0);
    const maxCellCount = Math.max(...sorted.map(f => f.cell_count || 0));
    const recent = recentByGroup[typeName] || (recentByGroup[typeName] = []);
    let lastType = lastTypeByGroup[typeName] || null;

    for (const section of sections) {
      const label = section.label || 'verse';
      const secStartMs = snapBeat(Math.round(section.start_ms));
      const secEndMs = Math.round(section.end_ms);
      if (secEndMs - secStartMs < barMs) continue;

      const stripMode = sorted.length > 1 || shouldUseUnifiedStrip(sorted, label, secStartMs, false);
      const palettes = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const effectTypes = getEffectPool(label, maxCellCount, ctx, stripMode || (sorted[0].cell_rows || 1) > 1);
      const phrases = phrasesForSection(label, secStartMs, secEndMs, ctx);

      for (let pi = 0; pi < phrases.length; pi++) {
        const phrase = phrases[pi];
        const phraseStart = phrase.start_ms;
        const phraseDur = phrase.duration_ms;
        if (phraseDur < barMs) continue;

        let effect = null;
        for (let tries = 0; tries < 12; tries++) {
          const pick = pickEffect(effectsByType, effectTypes, `mc-eff-${typeName}-${label}-${phraseStart}-${pi}-${tries}`);
          if (pick && pick.type !== lastType && !recent.includes(pick.type)) { effect = pick; break; }
          if (pick && tries === 11) effect = pick;
        }
        if (!effect) effect = pickEffect(effectsByType, effectTypes, `mc-eff-${typeName}-${label}-${phraseStart}-${pi}`);
        if (!effect) continue;

        lastType = effect.type;
        lastTypeByGroup[typeName] = effect.type;
        recent.push(effect.type);
        if (recent.length > 4) recent.shift();

        const palIdx = Math.floor(stableRoll(`mc-pal-${typeName}-${phraseStart}`) * palettes.length);
        const pair = palettes[palIdx % palettes.length];
        const start = Array.isArray(pair) ? pair[0] : pair;
        const baseIntensity = Math.min(1, (preset.intensityMult || 1) * getFixtureIntensity(sorted[0].id, label, ctx));
        const energyMult = getPhraseEnergyMult(phraseStart, phraseStart + phraseDur, ctx.energyLevels);
        const intensity = baseIntensity * energyMult;
        const baseColor = {
          r: Math.round((start?.r ?? 255) * intensity),
          g: Math.round((start?.g ?? 255) * intensity),
          b: Math.round((start?.b ?? 255) * intensity),
        };

        const stripLabel = stripMode && sorted.length > 1 ? `⇶ ${effect.name}` : effect.name;

        for (let fi = 0; fi < sorted.length; fi++) {
          const fix = sorted[fi];
          cues.push({
            lane: groupLanes[typeName],
            start_ms: phraseStart,
            duration_ms: phraseDur,
            cue_type: 'effect',
            fixture_id: fix.id,
            track: 'fx',
            effect_id: effect.id,
            effect_params: {
              ...paramsForFixture(effect, fix, fi, sorted, { phraseStart, phraseIndex: pi }),
              beat_ms: ctx.beatMs,
              ...(ctx.noStrobes ? { no_strobes: true } : {}),
            },
            channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
            color: EFFECT_COLORS[effect.type] || '#607d8b',
            label: stripLabel,
          });
        }
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

module.exports = {
  CELL_PATTERN_MAP,
  LARGE_CELL_PATTERN_MAP,
  mergeCellPatternDefaults,
  generateMultiCellPatterns,
  LEGACY_PATTERN_TO_EFFECT,
  normalizeEffectType,
};
