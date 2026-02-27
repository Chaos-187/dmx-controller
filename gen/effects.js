/**
 * Effect Cue Generation (non-movers only)
 *
 * Generates effect-type cues grouped by fixture type_name.
 * Supports per-group cascading, rig-wide spatial effects, and
 * section-aware effect selection.
 */

const { getSectionPalettes } = require('./palettes');

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

  function pickEffect(desiredTypes) {
    const candidates = [];
    for (const t of desiredTypes) {
      if (effectsByType[t]) candidates.push(...effectsByType[t]);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rand() * candidates.length)];
  }

  // ── Group fixtures by type_name ───────────────────────────────────────
  const allNonMovers = [...regularFixtures, ...ledBars];
  const fixtureGroups = {};
  const ledBarIds = new Set(ledBars.map(b => b.id));

  for (const fix of allNonMovers) {
    const key = fix.type_name || `unknown_${fix.id}`;
    if (!fixtureGroups[key]) {
      fixtureGroups[key] = { fixtures: [], isLedBar: ledBarIds.has(fix.id) };
    }
    fixtureGroups[key].fixtures.push(fix);
  }

  const existingMaxLane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0);
  let laneCounter = existingMaxLane + 1;

  const CASCADE_TYPES = new Set(['chase', 'comet', 'scanner', 'sparkle', 'color_wave', 'pulse', 'rainbow', 'buildup', 'strobe', 'wave', 'fade', 'flash']);

  const sectionEffectChance = {
    intro: 0.3, verse: 0.4, chorus: 0.8, bridge: 0.35,
    breakdown: 0.35, buildup: 0.7, drop: 0.95, outro: 0.25,
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
        effect_id: effect.id,
        effect_params: params,
        channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
        color: EFFECT_COLORS[effect.type] || '#607d8b',
        label: effect.name,
      });
    }
  }

  function emitRigWideCues(fixtures, effect, startMs, durationMs, baseColor, lane) {
    const sorted = [...fixtures].sort((a, b) => {
      if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
      return (a.rig_x || 0.5) - (b.rig_x || 0.5);
    });
    for (const fix of sorted) {
      cues.push({
        lane,
        start_ms: startMs,
        duration_ms: Math.round(durationMs),
        cue_type: 'effect',
        fixture_id: fix.id,
        effect_id: effect.id,
        effect_params: {},
        channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
        color: EFFECT_COLORS[effect.type] || '#00bfa5',
        label: `⟷ ${effect.name}`,
      });
    }
  }

  // ── Assign a dedicated lane for rig-wide effects ──────────────────────
  const rigLane = laneCounter++;

  // ── Section-based effect generation ───────────────────────────────────
  if (sections.length > 0) {
    const groupEntries = Object.entries(fixtureGroups);
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    for (const section of sections) {
      const label = section.label || 'verse';
      const sectionStart = Math.round(section.start_ms || (section.start * 1000));
      const sectionEnd = Math.round(section.end_ms || (section.end * 1000));
      const sectionDuration = sectionEnd - sectionStart;
      if (sectionDuration < barMs) continue;

      const activeSE = ctx.activeSectionEffects || SECTION_EFFECT_TYPES;
      const typesMap = activeSE[label] || DEFAULT_EFFECT_TYPES;
      const sectionPalette = getSectionPalettes(paletteKey, label, ctx.activePalettes);

      // ── Rig-wide effects ──────────────────────────────────────────
      const rigWideMult = preset.rigWideMult || 1.0;
      let rigDesired = typesMap.rigWide || DEFAULT_EFFECT_TYPES.rigWide || [];
      if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
        const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
        if (preferred.length > 0) rigDesired = preferred;
      }
      const isHighEnergySec = label === 'chorus' || label === 'drop' || label === 'buildup';
      const rigThreshold = isHighEnergySec && rigWideMult >= 0.8
        ? 0
        : Math.max(0.05, 0.2 / rigWideMult);
      if (rigDesired.length > 0 && allNonMovers.length >= 2 && rand() > rigThreshold) {
        const rigEffect = pickEffect(rigDesired);
        if (rigEffect) {
          const maxBars = isHighEnergySec ? 4 : 8;
          const rigDur = Math.min(sectionDuration, barMs * maxBars);
          const rigEffDur = Math.max(barMs * 2, rigDur);
          let t = sectionStart;
          let segIdx = 0;

          while (t < sectionEnd) {
            const dur = Math.min(rigEffDur, sectionEnd - t);
            if (dur < barMs) break;
            const baseColor = sectionPalette[segIdx % sectionPalette.length];
            emitRigWideCues(allNonMovers, rigEffect, t, dur, baseColor, rigLane);
            t += rigEffDur;
            segIdx++;
          }
        }
      }

      // ── Group effects ─────────────────────────────────────────────
      const chance = (sectionEffectChance[label] || 0.3) * preset.cueDensityMult;
      if (rand() > Math.min(chance, 0.95)) continue;

      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? typesMap.cellAware : typesMap.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        const maxDur = Math.min(sectionDuration, barMs * 8);
        const effectDurationMs = Math.max(barMs * 2, maxDur);
        let t = sectionStart;
        let segIdx = 0;

        while (t < sectionEnd) {
          const dur = Math.min(effectDurationMs, sectionEnd - t);
          if (dur < barMs) break;
          const baseColor = sectionPalette[segIdx % sectionPalette.length];
          emitGroupCues(group, effect, t, dur, baseColor, groupLanes[typeName], useCascade);
          t += effectDurationMs;
          segIdx++;
        }
      }
    }
  } else {
    // ── Bar-based fallback ──────────────────────────────────────────────
    const totalBars = Math.floor(durationMs / barMs);
    const effectEveryBars = Math.max(2, Math.round(4 / preset.cueDensityMult));
    const effectDurationBars = Math.max(2, effectEveryBars);
    const defaultTypes = DEFAULT_EFFECT_TYPES;

    const groupEntries = Object.entries(fixtureGroups);
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    for (let bar = 0; bar < totalBars; bar += effectEveryBars) {
      if (rand() > 0.5 * preset.cueDensityMult) continue;

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

      // Rig-wide effects in bar-based mode
      const rigWideMult = preset.rigWideMult || 1.0;
      const barRigThreshold = Math.max(0.05, 0.25 / rigWideMult);
      if (allNonMovers.length >= 2 && rand() > barRigThreshold) {
        let rigDesired = defaultTypes.rigWide || [];
        if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
          const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
          if (preferred.length > 0) rigDesired = preferred;
        }
        const rigEffect = pickEffect(rigDesired);
        if (rigEffect) {
          emitRigWideCues(allNonMovers, rigEffect, startMs, dur, baseColor, rigLane);
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
