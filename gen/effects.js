/**
 * Effect Cue Generation (non-movers only)
 *
 * Generates effect-type cues grouped by fixture type_name.
 * Supports per-group cascading, rig-wide spatial effects, and
 * section-aware effect selection.
 */

const { getSectionPalettes } = require('./palettes');
const { hasVocals, walkBeats, snapToBeat, stableRoll, isMirrorBallFixture } = require('./helpers');

const SECTION_EFFECT_TYPES = {
  intro:     { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'fire'],                                   rigWide: ['rig_color_wave', 'rig_rainbow'] },
  verse:     { regular: ['pulse', 'color_fade', 'rainbow'], cellAware: ['color_wave', 'sparkle'],                                 rigWide: ['rig_color_wave', 'rig_sweep', 'rig_rainbow'] },
  chorus:    { regular: ['rainbow', 'pulse', 'strobe'],     cellAware: ['chase', 'scanner', 'sparkle'],                           rigWide: ['rig_chase', 'rig_color_wave', 'rig_alternate', 'rig_rainbow'] },
  bridge:    { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'sparkle'],                                 rigWide: ['rig_color_wave', 'rig_sweep'] },
  breakdown: { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'],                                    rigWide: ['rig_color_wave', 'rig_rainbow'] },
  buildup:   { regular: ['pulse', 'strobe'],                cellAware: ['buildup', 'comet', 'chase'],                             rigWide: ['rig_converge', 'rig_chase', 'rig_sweep'] },
  drop:      { regular: ['rainbow', 'strobe', 'pulse'],     cellAware: ['chase', 'scanner', 'sparkle', 'comet', 'buildup'],       rigWide: ['rig_chase', 'rig_alternate', 'rig_sweep', 'rig_color_wave'] },
  outro:     { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'],                                    rigWide: ['rig_color_wave', 'rig_rainbow'] },
};

const DEFAULT_EFFECT_TYPES = {
  regular: ['pulse', 'color_fade', 'rainbow'],
  cellAware: ['chase', 'color_wave', 'sparkle'],
  rigWide: ['rig_color_wave', 'rig_chase', 'rig_rainbow'],
};

/** EFFECT_COLORS matches EFFECT_STYLE in index.html */
const EFFECT_COLORS = {
  pulse:          '#1e88e5',
  rainbow:        '#ff6f00',
  strobe:         '#f44336',
  color_fade:     '#8e24aa',
  chase:          '#00897b',
  comet:          '#e65100',
  scanner:        '#00838f',
  sparkle:        '#fdd835',
  color_wave:     '#7b1fa2',
  fire:           '#bf360c',
  buildup:        '#2e7d32',
  rig_chase:      '#00bfa5',
  rig_color_wave: '#6a1b9a',
  rig_sweep:      '#0277bd',
  rig_alternate:  '#c62828',
  rig_converge:   '#ad1457',
  rig_rainbow:    '#e65100',
};

/**
 * Detect channels_per_cell for LED bar fixtures based on repeating channel patterns.
 * Returns 3 for RGB, 4 for RGBW, etc.
 */
function detectChannelsPerCell(fixture) {
  const channels = fixture.channels;
  if (!channels || channels.length < 3) return 1;

  for (let stride = 3; stride <= 5; stride++) {
    if (channels.length % stride !== 0) continue;
    let repeats = true;
    for (let i = stride; i < channels.length; i++) {
      if (channels[i].type !== channels[i % stride].type) {
        repeats = false;
        break;
      }
    }
    if (repeats) return stride;
  }
  return 3;
}

/**
 * Generate effect cues for non-mover fixtures.
 * Fixtures are grouped by type_name so each type gets a consistent effect.
 * Cascade effects stagger start times across fixtures of the same type.
 */
function generateEffectCues(cues, regularFixtures, ledBars, effects, sections, ctx) {
  const { bpm, durationMs, barMs, rand, paletteKey, preset } = ctx;
  const beatMs = 60000 / bpm;

  // Index effects by type for quick lookup
  const effectsByType = {};
  for (const eff of effects) {
    if (!effectsByType[eff.type]) effectsByType[eff.type] = [];
    effectsByType[eff.type].push(eff);
  }

  function pickEffect(desiredTypes, rollKey) {
    const candidates = [];
    for (const t of desiredTypes) {
      if (effectsByType[t]) candidates.push(...effectsByType[t]);
    }
    if (candidates.length === 0) return null;
    const r = rollKey ? stableRoll(rollKey) : rand();
    return candidates[Math.floor(r * candidates.length)];
  }

  // ── Group fixtures by type_name ───────────────────────────────────────
  const allNonMovers = [...regularFixtures, ...ledBars];
  const fixtureGroups = {};
  const ledBarIds = new Set(ledBars.map(b => b.id));

  for (const fix of allNonMovers) {
    if (isMirrorBallFixture(fix)) continue;
    const key = fix.type_name || `unknown_${fix.id}`;
    if (!fixtureGroups[key]) {
      fixtureGroups[key] = { fixtures: [], isLedBar: ledBarIds.has(fix.id) };
    }
    fixtureGroups[key].fixtures.push(fix);
  }

  const existingMaxLane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0);
  let laneCounter = existingMaxLane + 1;

  const CASCADE_TYPES = new Set(['chase', 'comet', 'scanner', 'sparkle', 'color_wave', 'pulse', 'rainbow', 'buildup', 'strobe', 'wave', 'fade', 'flash']);

  // Lower overall chances — effects should be special moments, not constant
  const sectionEffectChance = {
    intro: 0.10, verse: 0.15, chorus: 0.40, bridge: 0.12,
    breakdown: 0.15, buildup: 0.35, drop: 0.50, outro: 0.08,
  };

  function emitGroupCues(group, effect, startMs, durationMs, baseColor, lane, cascade) {
    const sorted = [...group.fixtures].sort((a, b) => {
      if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
      return (a.rig_x || 0.5) - (b.rig_x || 0.5);
    });
    const fixtureCount = sorted.length;

    let cascadeSpreadMs = 0;
    if (cascade && fixtureCount > 1) {
      const rigXValues = sorted.map(f => f.rig_x ?? 0.5);
      const rawSpan = Math.max(...rigXValues) - Math.min(...rigXValues);

      if (rawSpan > 0.05) {
        cascadeSpreadMs = Math.min(beatMs * 2.0 * rawSpan, durationMs * 0.35);
      } else {
        cascadeSpreadMs = Math.min(beatMs * 1.5, durationMs * 0.35);
      }
    }
    const cascadeStepMs = fixtureCount > 1 ? cascadeSpreadMs / (fixtureCount - 1) : 0;

    for (let i = 0; i < fixtureCount; i++) {
      const fix = sorted[i];
      const offset = Math.round(cascadeStepMs * i);
      const cueStart = startMs + offset;
      const cueDur = durationMs - offset;
      if (cueDur < barMs * 0.5) continue;

      const params = {};
      if (group.isLedBar) {
        const channelsPerCell = detectChannelsPerCell(fix);
        if (channelsPerCell > 1) params.channels_per_cell = channelsPerCell;
      }

      cues.push({
        lane,
        start_ms: cueStart,
        duration_ms: Math.round(cueDur),
        cue_type: 'effect',
        fixture_id: fix.id,
        track: 'fx',
        effect_id: effect.id,
        effect_params: params,
        channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
        color: EFFECT_COLORS[effect.type] || '#607d8b',
        label: effect.name,
      });
    }
  }

  function emitRigWideCue(effect, startMs, durationMs, baseColor, lane) {
    // Single cue with fixture_id 0 — playback engine fans out to all fixtures
    cues.push({
      lane,
      start_ms: startMs,
      duration_ms: Math.round(durationMs),
      cue_type: 'effect',
      fixture_id: 0,
      track: 'fx-rig',
      effect_id: effect.id,
      effect_params: {},
      channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
      color: EFFECT_COLORS[effect.type] || '#00bfa5',
      label: `⟷ ${effect.name}`,
    });
  }

  // ── Assign a dedicated lane for rig-wide effects ──────────────────────
  const rigLane = laneCounter++;

  // Helper: check if a time window overlaps any occupied interval
  function overlapsOccupied(start, end, intervals) {
    for (const iv of intervals) {
      if (start < iv.end && end > iv.start) return true;
    }
    return false;
  }

  // ── Section-based effect generation ───────────────────────────────────
  if (sections.length > 0) {
    const groupEntries = Object.entries(fixtureGroups);
    const hasLedBars = groupEntries.some(([, g]) => g.isLedBar);
    const hasRegulars = groupEntries.some(([, g]) => !g.isLedBar);
    const mixedRig = hasLedBars && hasRegulars;
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    // ── Pass 1: place per-group effects, collecting occupied time ranges ──
    let lastGroupEndMs = -Infinity;
    const groupEffectIntervals = []; // { start, end } of placed group effects

    for (const section of sections) {
      const label = section.label || 'verse';
      const sectionStart = Math.round(section.start_ms || (section.start * 1000));
      const sectionEnd = Math.round(section.end_ms || (section.end * 1000));
      const sectionDuration = sectionEnd - sectionStart;
      if (sectionDuration < barMs) continue;

      // Enforce gap between group effects
      if (sectionStart < lastGroupEndMs + barMs * 2) continue;

      const chance = (sectionEffectChance[label] || 0.12) * preset.cueDensityMult;
      if (rand() > Math.min(chance, 0.60)) continue;

      const activeSE = ctx.activeSectionEffects || SECTION_EFFECT_TYPES;
      const typesMap = activeSE[label] || DEFAULT_EFFECT_TYPES;
      const sectionPalette = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const paletteIdx = Math.floor(stableRoll(`fx-pal-${label}-${sectionStart}`) * sectionPalette.length);
      const baseColor = sectionPalette[paletteIdx];

      const isHighEnergy = label === 'chorus' || label === 'drop' || label === 'buildup';
      const maxBars = isHighEnergy ? 4 : 2;
      const effectDur = Math.min(barMs * maxBars, sectionDuration);

      let effectStart;
      if (isHighEnergy) {
        effectStart = sectionStart;
      } else {
        const offsetBars = Math.floor(stableRoll(`fx-off-${label}-${sectionStart}`) * 2) + 1;
        // Walk actual beats to avoid drift from theoretical barMs
        const rawOffset = walkBeats(sectionStart, offsetBars * 4, ctx.beats, beatMs);
        effectStart = Math.min(snapToBeat(rawOffset, ctx.beats), sectionEnd - effectDur);
        if (effectStart < sectionStart) effectStart = sectionStart;
      }

      // Mixed fixture types → skip per-group FX (rig-wide pass handles unified moments)
      if (mixedRig) continue;

      const vocalsActive = hasVocals(sectionStart, sectionEnd, ctx);
      let desiredTypes = hasLedBars ? typesMap.cellAware : typesMap.regular;
      if (vocalsActive === true) {
        desiredTypes = desiredTypes.filter(t => t !== 'strobe');
      }
      if (ctx.noStrobes) {
        desiredTypes = desiredTypes.filter(t => t !== 'strobe');
      }

      // One effect for the whole section — all fixture groups share the moment
      const effect = pickEffect(desiredTypes, `fx-type-${label}-${sectionStart}`);
      if (!effect) continue;

      for (const [typeName, group] of groupEntries) {
        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        emitGroupCues(group, effect, effectStart, effectDur, baseColor, groupLanes[typeName], useCascade);
      }
      groupEffectIntervals.push({ start: effectStart, end: effectStart + effectDur });
      lastGroupEndMs = effectStart + effectDur;
    }

    // ── Pass 2: place rig-wide effects only where no group effects exist ──
    let lastRigEndMs = -Infinity;

    for (const section of sections) {
      const label = section.label || 'verse';
      const sectionStart = Math.round(section.start_ms || (section.start * 1000));
      const sectionEnd = Math.round(section.end_ms || (section.end * 1000));
      const sectionDuration = sectionEnd - sectionStart;
      if (sectionDuration < barMs) continue;
      if (allNonMovers.length < 2) continue;

      // Only high-energy sections are candidates for rig-wide effects
      const isHighEnergy = label === 'chorus' || label === 'drop' || label === 'buildup';
      if (!isHighEnergy) continue;

      // Enforce gap from last rig-wide effect
      if (sectionStart < lastRigEndMs + barMs * 4) continue;

      // Low chance — rig effects are rare highlights (higher when mixed fixture types)
      const rigWideMult = preset.rigWideMult || 1.0;
      const mixedRig = hasLedBars && hasRegulars;
      const rigChance = (mixedRig ? 0.55 : 0.30) * rigWideMult;
      if (stableRoll(`fx-rig-${label}-${sectionStart}`) > rigChance) continue;

      const maxBars = 4;
      const effectDur = Math.min(barMs * maxBars, sectionDuration);
      const effectStart = sectionStart;

      // Skip if any group effect overlaps this window
      if (overlapsOccupied(effectStart, effectStart + effectDur, groupEffectIntervals)) continue;

      const activeSE = ctx.activeSectionEffects || SECTION_EFFECT_TYPES;
      const typesMap = activeSE[label] || DEFAULT_EFFECT_TYPES;
      let rigDesired = typesMap.rigWide || DEFAULT_EFFECT_TYPES.rigWide || [];
      if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
        const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
        if (preferred.length > 0) rigDesired = preferred;
      }

      const rigEffect = pickEffect(rigDesired);
      if (!rigEffect) continue;

      const sectionPalette = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];
      emitRigWideCue(rigEffect, effectStart, effectDur, baseColor, rigLane);
      lastRigEndMs = effectStart + effectDur;
    }
  } else {
    // ── Bar-based fallback ──────────────────────────────────────────────
    const totalBars = Math.floor(durationMs / barMs);
    const effectEveryBars = Math.max(8, Math.round(12 / preset.cueDensityMult));
    const effectDurationBars = Math.min(4, Math.max(2, Math.round(effectEveryBars * 0.3)));
    const defaultTypes = DEFAULT_EFFECT_TYPES;

    const groupEntries = Object.entries(fixtureGroups);
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    // Pass 1: group effects
    const barGroupIntervals = [];
    for (let bar = 0; bar < totalBars; bar += effectEveryBars) {
      if (rand() > 0.25 * preset.cueDensityMult) continue;

      const startMs = bar * barMs;
      const dur = Math.min(effectDurationBars * barMs, durationMs - startMs);
      if (dur < barMs) break;

      const sectionPalette = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
      const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];

      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? defaultTypes.cellAware : defaultTypes.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        emitGroupCues(group, effect, startMs, dur, baseColor, groupLanes[typeName], useCascade);
      }
      barGroupIntervals.push({ start: startMs, end: startMs + dur });
    }

    // Pass 2: rig-wide only in unoccupied windows
    if (allNonMovers.length >= 2) {
      const rigWideMult = preset.rigWideMult || 1.0;
      for (let bar = 0; bar < totalBars; bar += effectEveryBars * 2) {
        if (rand() > 0.20 * rigWideMult) continue;

        const startMs = bar * barMs;
        const dur = Math.min(effectDurationBars * barMs, durationMs - startMs);
        if (dur < barMs) break;
        if (overlapsOccupied(startMs, startMs + dur, barGroupIntervals)) continue;

        const sectionPalette = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
        const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];

        let rigDesired = defaultTypes.rigWide || [];
        if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
          const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
          if (preferred.length > 0) rigDesired = preferred;
        }
        const rigEffect = pickEffect(rigDesired);
        if (rigEffect) {
          emitRigWideCue(rigEffect, startMs, dur, baseColor, rigLane);
        }
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

module.exports = {
  SECTION_EFFECT_TYPES,
  DEFAULT_EFFECT_TYPES,
  EFFECT_COLORS,
  detectChannelsPerCell,
  generateEffectCues,
};
