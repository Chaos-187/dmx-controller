/**
 * Multi-Cell Pattern Generation
 *
 * Creates per-cell cues with the `cell` property set on multi-cell fixtures.
 * Different song sections get different patterns. Drop sections are tuned
 * to be fast, high-contrast, and energetic.
 *
 * When multiple fixtures of the same type exist, high-energy sections
 * cascade patterns across all fixtures as one large virtual fixture.
 */

const { applyIntensity, rgbToHex, getFixtureIntensity } = require('./helpers');
const { sectionStyles, defaultStyle, getSectionPalettes } = require('./palettes');

const CELL_PATTERN_MAP = {
  intro:     ['fill_sweep', 'color_wave', 'breathe'],
  verse:     ['chase_slow', 'alternate', 'color_wave', 'fill_sweep', 'chase'],
  chorus:    ['chase', 'alternate', 'scatter', 'all_flash'],
  bridge:    ['color_wave', 'alternate', 'chase_slow'],
  breakdown: ['fill_sweep', 'breathe'],
  buildup:   ['build_reveal', 'chase_accel'],
  drop:      ['chase_fast', 'scatter_strobe', 'alternate_fast', 'all_flash'],
  outro:     ['fill_sweep', 'color_wave', 'breathe'],
};

// ─── Helper: resolve virtual cell to actual fixture + cell ──────────────────

function _resolveCell(p, cell) {
  if (p.virtualCells) {
    const idx = cell - 1;
    if (idx < 0 || idx >= p.virtualCells.length) return null;
    const vc = p.virtualCells[idx];
    return { fix: vc.fix, cell: vc.cell };
  }
  return { fix: p.fix, cell };
}

/**
 * Helper: create a per-cell cue.
 * Supports virtual cells for cross-fixture cascade.
 */
function cellCue(cues, p, cell, startMs, durMs, startColor, endColor, cueType, label) {
  const resolved = _resolveCell(p, cell);
  if (!resolved) return;

  const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
  if (p.hasDimmer) {
    startVals.dimmer = 255;
  }
  // For solid cues, don't store end values — no transition needed.
  // For transitions, derive end values from endColor.
  let endVals = null;
  const t = cueType || 'solid';
  if (t === 'static' && endColor) {
    endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };
    if (p.hasDimmer) endVals.dimmer = 255;
  }
  // Don't set white on normal color cues — it washes out the color;
  // white is only added for strobe hits.
  cues.push({
    lane: p.lane,
    start_ms: Math.round(startMs),
    duration_ms: Math.round(Math.max(10, durMs)),
    cue_type: cueType || 'solid',
    fixture_id: resolved.fix.id,
    cell: resolved.cell,
    channel_values: startVals,
    end_channel_values: endVals,
    color: rgbToHex(startColor.r, startColor.g, startColor.b),
    label: label || '',
  });
}

// ─── Pattern Functions ──────────────────────────────────────────────────────

function cellPatternChase(cues, p, speed) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const cycleDur = speed === 'fast' ? beatMs
    : speed === 'medium' ? beatMs * 2
    : barMs;
  const cellDur = cycleDur / cellCount;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.2));
  const offColor = applyIntensity(pal[1], baseIntensity * 0.15);

  let t = secStartMs;
  let direction = 1;
  while (t < secEndMs) {
    for (let step = 0; step < cellCount; step++) {
      const cellIdx = direction > 0 ? step : (cellCount - 1 - step);
      const cell = cellIdx + 1;
      const cueStart = t + step * cellDur;
      if (cueStart >= secEndMs) break;
      const dur = Math.min(cellDur, secEndMs - cueStart);
      cellCue(cues, p, cell, cueStart, dur, onColor, offColor, 'solid', 'chase');
    }
    t += cycleDur;
    if (rand() > 0.6) direction *= -1;
  }
}

function cellPatternChaseAccel(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.3));
  const dimColor = applyIntensity(pal[1], baseIntensity * 0.1);

  const startCycleDur = barMs;
  const endCycleDur = beatMs * 0.5;

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = Math.min(1, (t - secStartMs) / secDurMs);
    const cycleDur = startCycleDur + (endCycleDur - startCycleDur) * (progress * progress);
    const cellDur = cycleDur / cellCount;
    const intensity = Math.min(1, baseIntensity * (0.5 + progress * 0.8));
    const c = applyIntensity(pal[0], intensity);

    for (let step = 0; step < cellCount; step++) {
      const cell = step + 1;
      const cueStart = t + step * cellDur;
      if (cueStart >= secEndMs) break;
      const dur = Math.min(cellDur, secEndMs - cueStart);
      cellCue(cues, p, cell, cueStart, dur, c, dimColor, 'solid', 'build');
    }
    t += cycleDur;
  }
}

function cellPatternAlternate(cues, p, speed) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const swapInterval = speed === 'fast' ? beatMs : beatMs * 2;

  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[1], baseIntensity);

  let t = secStartMs;
  let swapState = false;
  while (t < secEndMs) {
    const dur = Math.min(swapInterval, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const isOdd = cell % 2 === 1;
      const useA = isOdd ? !swapState : swapState;
      cellCue(cues, p, cell, t, dur, useA ? colorA : colorB, null, 'solid', 'alt');
    }
    t += swapInterval;
    swapState = !swapState;
  }
}

function cellPatternColorWave(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, rand } = p;

  const waveDur = barMs * 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color1 = applyIntensity(pal[0], baseIntensity);
  const color2 = applyIntensity(pal[1], baseIntensity);

  let t = secStartMs;
  while (t < secEndMs) {
    for (let cell = 1; cell <= cellCount; cell++) {
      const offset = (cell - 1) / cellCount;
      const cellStart = t + offset * waveDur * 0.5;
      const dur = Math.min(waveDur, secEndMs - cellStart);
      if (cellStart >= secEndMs || dur <= 0) continue;
      cellCue(cues, p, cell, cellStart, dur, color1, color2, 'static', 'wave');
    }
    t += waveDur;
  }
}

function cellPatternScatter(cues, p, strobeMode) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand, noStrobes } = p;

  const flashInterval = strobeMode ? beatMs * 0.5 : beatMs;
  const flashDur = strobeMode ? beatMs * 0.25 : beatMs * 0.5;
  const intensity = strobeMode ? 1.0 : baseIntensity;

  let t = secStartMs;
  while (t < secEndMs) {
    const numFlashes = Math.floor(rand() * Math.min(3, cellCount)) + 1;
    const pal = palettes[Math.floor(rand() * palettes.length)];
    const color = applyIntensity(pal[0], intensity);

    for (let f = 0; f < numFlashes; f++) {
      const cell = Math.floor(rand() * cellCount) + 1;
      const dur = Math.min(flashDur, secEndMs - t);
      if (dur <= 0) break;

      if (strobeMode && !noStrobes) {
        const resolved = _resolveCell(p, cell);
        if (!resolved) continue;
        const strobeVals = { red: color.r, green: color.g, blue: color.b, strobe_hz: 15 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        if (p.hasWhite) strobeVals.white = 200;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(dur),
          cue_type: 'strobe', fixture_id: resolved.fix.id, cell: resolved.cell,
          channel_values: strobeVals, end_channel_values: {},
          color: '#ffffff', label: 'scatter',
        });
      } else {
        const dimColor = { r: 0, g: 0, b: 0 };
        cellCue(cues, p, cell, t, dur, color, dimColor, 'solid', 'scatter');
      }
    }
    t += flashInterval + rand() * flashInterval * 0.5;
  }
}

function cellPatternFillSweep(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, rand } = p;

  const sweepDur = Math.min(barMs * 4, secDurMs * 0.6);
  const holdDur = secDurMs - sweepDur;
  const cellDelay = sweepDur / cellCount;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color = applyIntensity(pal[0], baseIntensity * 0.8);
  const dimColor = applyIntensity(pal[0], baseIntensity * 0.1);

  for (let cell = 1; cell <= cellCount; cell++) {
    const onTime = secStartMs + (cell - 1) * cellDelay;

    const fadeInDur = Math.min(cellDelay * 1.5, secEndMs - onTime);
    if (fadeInDur > 0 && onTime < secEndMs) {
      cellCue(cues, p, cell, onTime, fadeInDur, dimColor, color, 'static', 'sweep');
    }

    const holdStart = secStartMs + sweepDur;
    if (holdStart < secEndMs && holdDur > 0) {
      cellCue(cues, p, cell, holdStart, Math.min(holdDur, secEndMs - holdStart), color, null, 'solid', 'hold');
    }
  }
}

function cellPatternBuildReveal(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const numStages = Math.min(cellCount, Math.max(4, Math.floor(secDurMs / barMs)));
  const stageDur = secDurMs / numStages;

  for (let stage = 0; stage < numStages; stage++) {
    const stageStart = secStartMs + stage * stageDur;
    const dur = Math.min(stageDur, secEndMs - stageStart);
    if (dur <= 0) break;

    const progress = (stage + 1) / numStages;
    const intensity = Math.min(1, baseIntensity * (0.3 + progress * 0.9));
    const color = applyIntensity(pal[0], intensity);

    const activeCells = Math.max(1, Math.ceil(cellCount * progress));

    for (let i = 0; i < activeCells; i++) {
      const cell = i + 1;
      cellCue(cues, p, cell, stageStart, dur, color, null, 'solid', 'build');
    }
  }

  const finalStart = secEndMs - Math.min(beatMs * 2, secDurMs * 0.2);
  if (finalStart > secStartMs) {
    const maxColor = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.4));
    for (let cell = 1; cell <= cellCount; cell++) {
      cellCue(cues, p, cell, finalStart, secEndMs - finalStart, maxColor, null, 'solid', 'peak');
    }
  }
}

function cellPatternAllFlash(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, beatMs, rand, noStrobes } = p;

  const flashDur = beatMs;
  let t = secStartMs;
  let palIdx = 0;

  while (t < secEndMs) {
    const pal = palettes[palIdx % palettes.length];
    const color1 = applyIntensity(pal[0], 1.0);
    const color2 = applyIntensity(pal[1], 1.0);
    const dur = Math.min(flashDur, secEndMs - t);
    if (dur <= 0) break;

    for (let cell = 1; cell <= cellCount; cell++) {
      const useColor = cell % 2 === 0 ? color1 : color2;
      cellCue(cues, p, cell, t, dur, useColor, null, 'solid', 'flash');
    }

    if (!noStrobes && palIdx % 4 === 3) {
      for (let cell = 1; cell <= cellCount; cell++) {
        const resolved = _resolveCell(p, cell);
        if (!resolved) continue;
        const strobeVals = { red: 255, green: 255, blue: 255, strobe_hz: 18 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(Math.min(beatMs * 0.5, dur)),
          cue_type: 'strobe', fixture_id: resolved.fix.id, cell: resolved.cell,
          channel_values: strobeVals, end_channel_values: {},
          color: '#ffffff', label: 'strobe',
        });
      }
    }

    t += flashDur;
    palIdx++;
  }
}

function cellPatternBreathe(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, rand } = p;

  const breatheCycle = barMs * 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const brightColor = applyIntensity(pal[0], baseIntensity * 0.7);
  const dimColor = applyIntensity(pal[0], baseIntensity * 0.1);

  let t = secStartMs;
  while (t < secEndMs) {
    const dur = Math.min(breatheCycle, secEndMs - t);
    if (dur <= 0) break;
    const halfDur = dur / 2;

    for (let cell = 1; cell <= cellCount; cell++) {
      cellCue(cues, p, cell, t, halfDur, dimColor, brightColor, 'static', 'breathe');
      if (t + halfDur < secEndMs) {
        cellCue(cues, p, cell, t + halfDur, Math.min(halfDur, secEndMs - t - halfDur), brightColor, dimColor, 'static', 'breathe');
      }
    }
    t += breatheCycle;
  }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────

function _dispatchCellPattern(cues, pattern, ctx) {
  switch (pattern) {
    case 'chase_slow':     cellPatternChase(cues, ctx, 'slow'); break;
    case 'chase':          cellPatternChase(cues, ctx, 'medium'); break;
    case 'chase_fast':     cellPatternChase(cues, ctx, 'fast'); break;
    case 'chase_accel':    cellPatternChaseAccel(cues, ctx); break;
    case 'alternate':      cellPatternAlternate(cues, ctx, 'normal'); break;
    case 'alternate_fast': cellPatternAlternate(cues, ctx, 'fast'); break;
    case 'color_wave':     cellPatternColorWave(cues, ctx); break;
    case 'scatter':        cellPatternScatter(cues, ctx, false); break;
    case 'scatter_strobe': cellPatternScatter(cues, ctx, true); break;
    case 'fill_sweep':     cellPatternFillSweep(cues, ctx); break;
    case 'build_reveal':   cellPatternBuildReveal(cues, ctx); break;
    case 'all_flash':      cellPatternAllFlash(cues, ctx); break;
    case 'breathe':        cellPatternBreathe(cues, ctx); break;
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

function generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx) {
  const { barMs, beatMs, rand, paletteKey, preset, snapBeat } = ctx;

  const SUB_PHRASE_BARS = 8;

  // Group multi-cell fixtures by type_name for cross-fixture cascading
  const fixtureGroups = {};
  for (const fix of multiCellFixtures) {
    if ((fix.cell_count || 0) < 2) continue;
    const key = fix.type_name || `unknown_${fix.id}`;
    if (!fixtureGroups[key]) fixtureGroups[key] = [];
    fixtureGroups[key].push(fix);
  }

  const CASCADE_SECTIONS = new Set(['chorus', 'drop', 'buildup']);

  for (const [typeName, group] of Object.entries(fixtureGroups)) {
    const canCascade = group.length > 1;

    for (const section of sections) {
      const label = section.label || 'verse';
      const secStartMs = snapBeat(Math.round(section.start_ms));
      const secEndMs = Math.round(section.end_ms);
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs < barMs) continue;

      const useCascade = canCascade && (
        CASCADE_SECTIONS.has(label) || rand() > 0.5
      );

      const fixtureContexts = [];
      if (useCascade) {
        const virtualCells = [];
        for (const fix of group) {
          for (let c = 1; c <= fix.cell_count; c++) {
            virtualCells.push({ fix, cell: c });
          }
        }
        const refFix = group[0];
        const existingCue = cues.find(c => c.fixture_id === refFix.id);
        fixtureContexts.push({
          fix: refFix,
          lane: existingCue ? existingCue.lane : 0,
          cellCount: virtualCells.length,
          virtualCells,
          hasDimmer: refFix.channels.some(ch => ch.type === 'dimmer'),
          hasWhite: refFix.channels.some(ch => ch.type === 'white'),
        });
      } else {
        for (const fix of group) {
          const existingCue = cues.find(c => c.fixture_id === fix.id);
          fixtureContexts.push({
            fix,
            lane: existingCue ? existingCue.lane : 0,
            cellCount: fix.cell_count,
            hasDimmer: fix.channels.some(ch => ch.type === 'dimmer'),
            hasWhite: fix.channels.some(ch => ch.type === 'white'),
          });
        }
      }

      const activeCPM = ctx.activeCellPatterns || CELL_PATTERN_MAP;
      const patterns = activeCPM[label] || activeCPM.verse || CELL_PATTERN_MAP.verse;
      const allPalettes = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const style = (ctx.activeSectionStyles || sectionStyles)[label] || defaultStyle;
      const baseIntensity = Math.min(1, ((style.intensity[0] + style.intensity[1]) / 2) * preset.intensityMult);

      const subPhraseMs = SUB_PHRASE_BARS * barMs;
      const numSubPhrases = Math.max(1, Math.floor(secDurMs / subPhraseMs));
      const useSubPhrases = numSubPhrases >= 2 && label !== 'buildup';

      for (const fCtx of fixtureContexts) {
        const fixBaseIntensity = Math.min(1, baseIntensity * getFixtureIntensity(fCtx.fix.id, label, ctx));
        if (useSubPhrases) {
          let lastPattern = '';
          for (let sp = 0; sp < numSubPhrases; sp++) {
            const spStart = secStartMs + sp * subPhraseMs;
            const spEnd = sp === numSubPhrases - 1 ? secEndMs : secStartMs + (sp + 1) * subPhraseMs;
            const spDur = spEnd - spStart;
            if (spDur < barMs) continue;

            let pattern;
            for (let tries = 0; tries < 5; tries++) {
              pattern = patterns[Math.floor(rand() * patterns.length)];
              if (pattern !== lastPattern || patterns.length <= 1) break;
            }
            lastPattern = pattern;

            const patPalettes = [allPalettes[sp % allPalettes.length]];
            if (allPalettes.length > 1) patPalettes.push(allPalettes[(sp + 1) % allPalettes.length]);

            const patternCtx = {
              ...fCtx,
              secStartMs: spStart, secEndMs: spEnd, secDurMs: spDur,
              palettes: patPalettes, baseIntensity: fixBaseIntensity, label,
              ...ctx,
            };

            _dispatchCellPattern(cues, pattern, patternCtx);
          }
        } else {
          const pattern = patterns[Math.floor(rand() * patterns.length)];
          const patternCtx = {
            ...fCtx,
            secStartMs, secEndMs, secDurMs,
            palettes: allPalettes, baseIntensity: fixBaseIntensity, label,
            ...ctx,
          };
          _dispatchCellPattern(cues, pattern, patternCtx);
        }
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

module.exports = { CELL_PATTERN_MAP, generateMultiCellPatterns };
