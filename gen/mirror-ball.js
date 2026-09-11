/**
 * Mirror ball / disco ball fixtures (e.g. Kam Strato) — calm colours and motion.
 * Avoids par-style strobes, rig FX, and built-in macro channels.
 */

const { generateSectionBased } = require('./section-generator');
const { generateBarBased } = require('./bar-generator');
const { stableRoll } = require('./helpers');
const { getSectionPalettes } = require('./palettes');

/** Softer section timing than standard pars — longer holds, no strobes. */
const MIRROR_SECTION_STYLES = {
  intro:     { intensity: [0.30, 0.50], beatColorChange: false, strobeChance: 0, cuePerBars: 8, beatColorBars: 8 },
  verse:     { intensity: [0.40, 0.60], beatColorChange: true,  strobeChance: 0, cuePerBars: 4, beatColorBars: 4 },
  chorus:    { intensity: [0.50, 0.70], beatColorChange: true,  strobeChance: 0, cuePerBars: 2, beatColorBars: 2 },
  bridge:    { intensity: [0.35, 0.55], beatColorChange: true,  strobeChance: 0, cuePerBars: 4, beatColorBars: 4 },
  breakdown: { intensity: [0.25, 0.40], beatColorChange: false, strobeChance: 0, cuePerBars: 8, beatColorBars: 8 },
  buildup:   { intensity: [0.35, 0.65], beatColorChange: true,  strobeChance: 0, cuePerBars: 2, beatColorBars: 2, rampIntensity: true },
  drop:      { intensity: [0.55, 0.75], beatColorChange: true,  strobeChance: 0, cuePerBars: 2, beatColorBars: 2 },
  outro:     { intensity: [0.35, 0.15], beatColorChange: false, strobeChance: 0, cuePerBars: 8, beatColorBars: 8, fadeOut: true },
};

const DEFAULT_MIRROR_EFFECT_TYPES = {
  intro:     ['mirror_glow', 'mirror_soft_shift'],
  verse:     ['mirror_glow', 'mirror_soft_shift'],
  chorus:    ['mirror_soft_shift', 'mirror_glitter'],
  bridge:    ['mirror_glow', 'mirror_soft_shift'],
  breakdown: ['mirror_glow'],
  buildup:   ['mirror_soft_shift'],
  drop:      ['mirror_glitter', 'mirror_soft_shift'],
  outro:     ['mirror_glow'],
};

/** Motor-only types — rotation without touching dimmer/RGB (pairs with color cues). */
const MIRROR_MOTOR_EFFECT_TYPES = new Set([
  'mirror_motor_cw', 'mirror_motor_ccw', 'mirror_motor_slow',
  'mirror_motor_fast_cw', 'mirror_motor_fast_ccw', 'mirror_motor_party',
]);

const MOTOR_TYPES_BY_SECTION = {
  intro:     ['mirror_motor_slow'],
  verse:     ['mirror_motor_cw', 'mirror_motor_ccw'],
  chorus:    ['mirror_motor_party', 'mirror_motor_fast_cw', 'mirror_motor_cw'],
  bridge:    ['mirror_motor_cw', 'mirror_motor_slow'],
  breakdown: ['mirror_motor_slow'],
  buildup:   ['mirror_motor_cw', 'mirror_motor_party'],
  drop:      ['mirror_motor_party', 'mirror_motor_fast_cw', 'mirror_motor_fast_ccw'],
  outro:     ['mirror_motor_slow'],
};

/** Sections that always get a full-length motor cue when effects exist in DB. */
const MOTOR_SECTION_ALWAYS = new Set(['chorus', 'drop', 'buildup']);

const MOTOR_SECTION_CHANCE = {
  intro: 0.35, verse: 0.55, chorus: 1, bridge: 0.45,
  breakdown: 0.4, buildup: 1, drop: 1, outro: 0.35,
};

const MIRROR_EFFECT_CHANCE = {
  intro: 0.06, verse: 0.10, chorus: 0.18, bridge: 0.08,
  breakdown: 0.05, buildup: 0.12, drop: 0.15, outro: 0.05,
};

const EFFECT_COLORS = {
  mirror_glow: '#5c6bc0',
  mirror_soft_shift: '#7986cb',
  mirror_slow_spin: '#455a64',
  mirror_spin_cw: '#546e7a',
  mirror_spin_ccw: '#546e7a',
  mirror_spin_fast_cw: '#37474f',
  mirror_spin_fast_ccw: '#37474f',
  mirror_motor_cw: '#607d8b',
  mirror_motor_ccw: '#607d8b',
  mirror_motor_slow: '#78909c',
  mirror_motor_fast_cw: '#455a64',
  mirror_motor_fast_ccw: '#455a64',
  mirror_motor_party: '#ff6f00',
  mirror_glitter: '#b39ddb',
};

function mergeMirrorSectionStyles(baseStyles) {
  const out = { ...baseStyles };
  for (const [label, style] of Object.entries(MIRROR_SECTION_STYLES)) {
    out[label] = { ...(out[label] || {}), ...style };
  }
  return out;
}

function generateMirrorBallEffectCues(cues, fixtures, sections, ctx) {
  const { effects, barMs, rand, durationMs } = ctx;
  if (!effects?.length || !fixtures.length) return;

  const mirrorTypes = new Set([
    'mirror_glow', 'mirror_soft_shift', 'mirror_slow_spin', 'mirror_glitter',
    'mirror_spin_cw', 'mirror_spin_ccw', 'mirror_spin_fast_cw', 'mirror_spin_fast_ccw',
  ]);
  if (ctx.noMirrorSpin) {
    for (const t of [
      'mirror_slow_spin', 'mirror_spin_cw', 'mirror_spin_ccw',
      'mirror_spin_fast_cw', 'mirror_spin_fast_ccw',
    ]) mirrorTypes.delete(t);
  }
  const byType = {};
  for (const eff of effects) {
    if (eff.fixture_target !== 'mirror_ball' && !mirrorTypes.has(eff.type)) continue;
    if (!mirrorTypes.has(eff.type)) continue;
    if (!byType[eff.type]) byType[eff.type] = [];
    byType[eff.type].push(eff);
  }
  if (Object.keys(byType).length === 0) return;

  const effectTypesBySection = ctx.activeMirrorBallEffects || DEFAULT_MIRROR_EFFECT_TYPES;
  let lane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0) + 1;

  function pickEffect(sectionLabel, rollKey) {
    const types = effectTypesBySection[sectionLabel] || effectTypesBySection.verse || ['mirror_glow'];
    const pool = [];
    for (const t of types) {
      if (byType[t]) pool.push(...byType[t]);
    }
    if (!pool.length) return null;
    const r = rollKey ? stableRoll(rollKey) : rand();
    return pool[Math.floor(r * pool.length)];
  }

  for (const section of sections) {
    const label = section.label || 'verse';
    const chance = MIRROR_EFFECT_CHANCE[label] ?? 0.1;
    if (stableRoll(`mirror-fx-${label}-${section.start_ms}`) > chance) continue;

    const secStart = Math.round(section.start_ms);
    const secEnd = Math.min(Math.round(section.end_ms), Math.round(durationMs));
    const secDur = secEnd - secStart;
    if (secDur < barMs * 2) continue;

    const effect = pickEffect(label, `mirror-pick-${label}-${secStart}`);
    if (!effect) continue;

    const startMs = secStart + Math.round(secDur * 0.15);
    const durMs = Math.min(Math.round(secDur * 0.55), barMs * 16);

    for (const fix of fixtures) {
      const palettes = getSectionPalettes(ctx.paletteKey, label, ctx.activePalettes);
      const flat = palettes.flat();
      const pick = flat[Math.floor(stableRoll(`mirror-color-${fix.id}-${startMs}`) * flat.length)] || { r: 180, g: 180, b: 220 };
      cues.push({
        lane: lane++,
        start_ms: startMs,
        duration_ms: durMs,
        cue_type: 'effect',
        fixture_id: fix.id,
        track: 'fx-mirror',
        effect_id: effect.id,
        effect_params: {},
        channel_values: {
          red: pick.r, green: pick.g, blue: pick.b,
          white: Math.min(255, Math.round((pick.r + pick.g + pick.b) / 3)),
          dimmer: 200,
        },
        color: EFFECT_COLORS[effect.type] || '#7986cb',
        label: effect.name,
      });
    }
  }
}

/**
 * Generate calm colour + optional mirror-ball FX cues.
 */
function generateMirrorBallBarEffectCues(cues, fixtures, ctx) {
  const { effects, barMs, durationMs, rand } = ctx;
  if (!effects?.length || !fixtures.length || !barMs) return;

  const mirrorTypes = new Set([
    'mirror_glow', 'mirror_soft_shift', 'mirror_slow_spin', 'mirror_glitter',
    'mirror_spin_cw', 'mirror_spin_ccw', 'mirror_spin_fast_cw', 'mirror_spin_fast_ccw',
  ]);
  const pool = effects.filter((e) => mirrorTypes.has(e.type));
  if (!pool.length) return;

  let lane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0) + 1;
  const totalBars = Math.floor(durationMs / barMs);
  for (let bar = 8; bar < totalBars; bar += 16) {
    if (rand() > 0.35) continue;
    const startMs = Math.round(bar * barMs);
    const durMs = Math.min(Math.round(barMs * 8), Math.round(durationMs - startMs));
    if (durMs < barMs * 2) continue;
    const effect = pool[Math.floor(rand() * pool.length)];
    for (const fix of fixtures) {
      cues.push({
        lane: lane++,
        start_ms: startMs,
        duration_ms: durMs,
        cue_type: 'effect',
        fixture_id: fix.id,
        track: 'fx-mirror',
        effect_id: effect.id,
        effect_params: {},
        channel_values: { red: 180, green: 180, blue: 220, dimmer: 200 },
        color: EFFECT_COLORS[effect.type] || '#7986cb',
        label: effect.name,
      });
    }
  }
}

function generateMirrorBallMotorCues(cues, fixtures, sections, ctx) {
  const { effects, barMs, durationMs } = ctx;
  if (!effects?.length || !fixtures.length || !sections?.length) return;

  const byType = {};
  for (const eff of effects) {
    if (!MIRROR_MOTOR_EFFECT_TYPES.has(eff.type)) continue;
    if (!byType[eff.type]) byType[eff.type] = [];
    byType[eff.type].push(eff);
  }
  if (Object.keys(byType).length === 0) return;

  let lane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0) + 1;

  for (const section of sections) {
    const label = section.label || 'verse';
    const always = MOTOR_SECTION_ALWAYS.has(label);
    const chance = MOTOR_SECTION_CHANCE[label] ?? 0.5;
    if (!always && stableRoll(`mirror-motor-${label}-${section.start_ms}`) > chance) continue;

    const typeList = MOTOR_TYPES_BY_SECTION[label] || MOTOR_TYPES_BY_SECTION.verse;
    const pool = [];
    for (const t of typeList) {
      if (byType[t]) pool.push(...byType[t]);
    }
    if (!pool.length) continue;

    const secStart = Math.round(section.start_ms);
    const secEnd = Math.min(Math.round(section.end_ms), Math.round(durationMs));
    const secDur = secEnd - secStart;
    if (secDur < barMs) continue;

    const pickIdx = Math.floor(stableRoll(`mirror-motor-pick-${label}-${secStart}`) * pool.length);
    const effect = pool[pickIdx];
    const margin = Math.round(Math.min(secDur * 0.05, barMs));
    const startMs = secStart + margin;
    const durMs = Math.max(barMs, secDur - margin * 2);

    for (const fix of fixtures) {
      cues.push({
        lane: lane++,
        start_ms: startMs,
        duration_ms: durMs,
        cue_type: 'effect',
        fixture_id: fix.id,
        track: 'fx-mirror',
        effect_id: effect.id,
        effect_params: {},
        channel_values: {},
        color: EFFECT_COLORS[effect.type] || '#607d8b',
        label: effect.name,
      });
    }
  }
}

function generateMirrorBallCues(cues, fixtures, sections, beats, energyLevels, ctx) {
  if (!fixtures.length) return;

  const mirrorCtx = {
    ...ctx,
    noStrobes: true,
    activeSectionStyles: mergeMirrorSectionStyles(ctx.activeSectionStyles || {}),
    activeMirrorBallEffects: ctx.activeMirrorBallEffects || DEFAULT_MIRROR_EFFECT_TYPES,
    preset: {
      ...(ctx.preset || {}),
      strobeMult: 0,
      flashOnSection: false,
      accentPulses: false,
      intensityMult: Math.min(0.9, (ctx.preset?.intensityMult ?? 1) * 0.85),
    },
  };

  if (sections.length > 0) {
    generateSectionBased(cues, fixtures, sections, beats, energyLevels, mirrorCtx, { colorOnly: true });
    if (!mirrorCtx.noMirrorSpin) generateMirrorBallMotorCues(cues, fixtures, sections, mirrorCtx);
    generateMirrorBallEffectCues(cues, fixtures, sections, mirrorCtx);
  } else {
    generateBarBased(cues, fixtures, mirrorCtx);
    generateMirrorBallBarEffectCues(cues, fixtures, mirrorCtx);
  }
}

module.exports = {
  generateMirrorBallCues,
  MIRROR_SECTION_STYLES,
  DEFAULT_MIRROR_EFFECT_TYPES,
};
