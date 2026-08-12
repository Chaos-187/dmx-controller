/**
 * Pixel tape generation — long 1D LED strips (pixel_tape / led_bar).
 * Always treats matching fixtures as one continuous strip when several are present.
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
  filterNoStrobeEffects,
  getPhraseEnergyMult,
  barAlignedPhrases,
} = require('./cell-effect-shared');

/** Linear strip effect types per section (Config → gen_cell_patterns applies to tape too). */
const TAPE_EFFECT_MAP = {
  intro:     ['chase', 'color_wave', 'pulse', 'gradient', 'ripple'],
  verse:     ['chase', 'comet', 'scanner', 'color_wave', 'sparkle', 'gradient', 'ripple'],
  chorus:    ['chase', 'comet', 'scanner', 'sparkle', 'gradient', 'ripple', 'segments'],
  bridge:    ['color_wave', 'chase', 'ripple', 'gradient', 'scanner'],
  breakdown: ['pulse', 'color_wave', 'ripple', 'sparkle'],
  buildup:   ['buildup', 'chase', 'comet', 'scanner', 'gradient'],
  drop:      ['chase', 'cell_strobe', 'comet', 'scanner', 'sparkle', 'ripple'],
  outro:     ['chase', 'color_wave', 'pulse', 'gradient', 'ripple'],
};

const LARGE_TAPE_THRESHOLD = 24;

function getTapeEffectPool(label, pixelCount, ctx) {
  const section = label || 'verse';
  const raw = ctx.activeCellPatterns || TAPE_EFFECT_MAP;
  let list = (raw[section] || raw.verse || TAPE_EFFECT_MAP.verse).map(normalizeEffectType);
  if (pixelCount >= LARGE_TAPE_THRESHOLD) {
    list = [...new Set([...list, 'gradient', 'segments', 'ripple', 'comet'])];
  }
  return filterNoStrobeEffects(list, ctx.noStrobes);
}

function phrasesForTape(label, secStartMs, secEndMs, ctx) {
  return barAlignedPhrases(secStartMs, secEndMs, label, ctx);
}

/**
 * Generate effect cues for pixel tape fixtures.
 */
function generatePixelTapePatterns(cues, tapeFixtures, sections, ctx) {
  const effects = ctx.effects;
  if (!effects?.length || !tapeFixtures.length || !sections.length) return;

  const { barMs, paletteKey, preset, snapBeat } = ctx;
  const effectsByType = buildMultiCellEffectIndex(effects);
  if (!Object.keys(effectsByType).length) return;

  const fixtureGroups = {};
  for (const fix of tapeFixtures) {
    if ((fix.cell_count || 0) < 2) continue;
    if (fix.category !== 'pixel_tape' && fix.category !== 'led_bar') continue;
    const key = fix.type_name || `tape_${fix.id}`;
    if (!fixtureGroups[key]) fixtureGroups[key] = [];
    fixtureGroups[key].push(fix);
  }

  let laneCounter = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0) + 1;
  const groupLanes = {};
  for (const typeName of Object.keys(fixtureGroups)) {
    groupLanes[typeName] = laneCounter++;
  }

  const recentByGroup = {};
  const lastTypeByGroup = {};

  for (const [typeName, group] of Object.entries(fixtureGroups)) {
    const sorted = [...group].sort((a, b) => (a.rig_order || 0) - (b.rig_order || 0) || (a.rig_x || 0.5) - (b.rig_x || 0.5));
    const maxPixels = Math.max(...sorted.map(f => f.cell_count || 0));
    const recent = recentByGroup[typeName] || (recentByGroup[typeName] = []);
    let lastType = lastTypeByGroup[typeName] || null;

    for (const section of sections) {
      const label = section.label || 'verse';
      const secStartMs = snapBeat(Math.round(section.start_ms));
      const secEndMs = Math.round(section.end_ms);
      if (secEndMs - secStartMs < barMs) continue;

      const effectTypes = getTapeEffectPool(label, maxPixels, ctx);
      const phrases = phrasesForTape(label, secStartMs, secEndMs, ctx);

      for (let pi = 0; pi < phrases.length; pi++) {
        const phrase = phrases[pi];
        const phraseStart = phrase.start_ms;
        const phraseDur = phrase.duration_ms;
        if (phraseDur < barMs) continue;

        let effect = null;
        for (let tries = 0; tries < 12; tries++) {
          const pick = pickEffect(effectsByType, effectTypes, `tape-eff-${typeName}-${label}-${phraseStart}-${pi}-${tries}`);
          if (pick && pick.type !== lastType && !recent.includes(pick.type)) { effect = pick; break; }
          if (pick && tries === 11) effect = pick;
        }
        if (!effect) effect = pickEffect(effectsByType, effectTypes, `tape-eff-${typeName}-${label}-${phraseStart}-${pi}`);
        if (!effect) continue;

        lastType = effect.type;
        lastTypeByGroup[typeName] = effect.type;
        recent.push(effect.type);
        if (recent.length > 4) recent.shift();

        const palettes = getSectionPalettes(paletteKey, label, ctx.activePalettes);
        const palIdx = Math.floor(stableRoll(`tape-pal-${typeName}-${phraseStart}`) * palettes.length);
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

        const stripLabel = sorted.length > 1 ? `⇶ ${effect.name}` : effect.name;

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
              ...paramsForFixture(effect, fix, fi, sorted, { alwaysStrip: true, phraseStart, phraseIndex: pi }),
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
  TAPE_EFFECT_MAP,
  generatePixelTapePatterns,
  mergeCellPatternDefaults,
  LEGACY_PATTERN_TO_EFFECT,
  normalizeEffectType,
};
