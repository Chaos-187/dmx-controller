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

const { applyIntensity, rgbToHex, getFixtureIntensity, stableRoll, lerpColor } = require('./helpers');
const { sectionStyles, defaultStyle, getSectionPalettes } = require('./palettes');

const CELL_PATTERN_MAP = {
  intro:     ['fill_sweep', 'color_wave', 'breathe', 'sparkle_field'],
  verse:     ['chase_slow', 'alternate', 'color_wave', 'fill_sweep', 'chase', 'sparkle_field', 'checker', 'split_wipe'],
  chorus:    ['chase', 'alternate', 'scatter', 'all_flash', 'split_wipe', 'sparkle_field'],
  bridge:    ['color_wave', 'alternate', 'chase_slow', 'center_pulse', 'checker'],
  breakdown: ['fill_sweep', 'breathe', 'center_pulse'],
  buildup:   ['build_reveal', 'chase_accel', 'split_wipe'],
  drop:      ['chase_fast', 'scatter_strobe', 'alternate_fast', 'all_flash', 'sparkle_field'],
  outro:     ['fill_sweep', 'color_wave', 'breathe', 'center_pulse'],
};

/** Expanded pattern pool for fixtures with many cells (e.g. Atomic Strobe 48ch). */
const LARGE_CELL_PATTERN_MAP = {
  intro:     ['gradient_sweep', 'ripple', 'blocks', 'breathe', 'fill_sweep', 'center_pulse', 'sparkle_field'],
  verse:     ['segments', 'comet', 'dual_chase', 'gradient_sweep', 'blocks', 'snake', 'color_wave', 'checker', 'mirror', 'split_wipe', 'sparkle_field'],
  chorus:    ['dual_chase', 'comet', 'segments', 'ripple', 'scatter', 'snake', 'all_flash', 'mirror', 'split_wipe', 'sparkle_field'],
  bridge:    ['gradient_sweep', 'blocks', 'ripple', 'color_wave', 'comet', 'center_pulse', 'checker'],
  breakdown: ['ripple', 'breathe', 'gradient_sweep', 'blocks', 'center_pulse', 'sparkle_field'],
  buildup:   ['build_reveal', 'comet', 'segments', 'chase_accel', 'ripple', 'split_wipe', 'mirror'],
  drop:      ['dual_chase', 'snake', 'scatter_strobe', 'segments', 'ripple', 'all_flash', 'mirror', 'split_wipe', 'sparkle_field'],
  outro:     ['gradient_sweep', 'fill_sweep', 'breathe', 'ripple', 'center_pulse'],
};

const LARGE_CELL_THRESHOLD = 16;

function isLargeCellCount(cellCount) {
  return cellCount >= LARGE_CELL_THRESHOLD;
}

function getPatternPool(label, cellCount, ctx) {
  const section = label || 'verse';
  const base = ctx.activeCellPatterns || CELL_PATTERN_MAP;
  const baseList = base[section] || base.verse || CELL_PATTERN_MAP.verse;

  if (!isLargeCellCount(cellCount)) return baseList;

  const largeList = LARGE_CELL_PATTERN_MAP[section] || LARGE_CELL_PATTERN_MAP.verse;
  // Always merge large-cell patterns in — saved generator config must not block them.
  return [...new Set([...largeList, ...baseList])];
}

/** Lit window width for chase-style patterns — avoids 1-cell steps on 48-pixel fixtures. */
function chaseWindowSize(cellCount) {
  if (!isLargeCellCount(cellCount)) return 1;
  return Math.max(2, Math.min(8, Math.round(cellCount / 8)));
}

function chaseStepCount(cellCount, windowSize) {
  if (!isLargeCellCount(cellCount)) return cellCount;
  const stride = Math.max(1, Math.floor(windowSize / 2));
  return Math.max(8, Math.ceil((cellCount - windowSize) / stride) + 1);
}

function pickPattern(patterns, recent, seedKey) {
  let pattern = patterns[0];
  for (let tries = 0; tries < 8; tries++) {
    const roll = stableRoll(`${seedKey}-${tries}`);
    pattern = patterns[Math.floor(roll * patterns.length)];
    if (!recent.includes(pattern) || patterns.length <= recent.length) break;
  }
  return pattern;
}

function subPhraseBarsFor(cellCount) {
  if (cellCount >= 32) return 4;
  if (cellCount >= LARGE_CELL_THRESHOLD) return 6;
  return 8;
}

/** Beat interval for per-cell pattern updates — coarser on large fixtures to limit cue count. */
function patternTickMs(p) {
  const { beatMs, barMs, cellCount } = p;
  if (!isLargeCellCount(cellCount)) return beatMs;
  return Math.max(beatMs * 2, Math.round(barMs / 4));
}

/** Merge new default patterns into saved generator config without dropping custom entries. */
function mergeCellPatternDefaults(existing, defaults) {
  const merged = { ...defaults, ...existing };
  for (const section of new Set([...Object.keys(defaults), ...Object.keys(existing || {})])) {
    const base = defaults[section] || [];
    const cur = (existing && existing[section]) || [];
    merged[section] = [...new Set([...base, ...cur])];
  }
  return merged;
}

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
    track: 'color',
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
  const windowSize = chaseWindowSize(cellCount);
  const steps = chaseStepCount(cellCount, windowSize);
  const stepDur = cycleDur / steps;
  const stride = isLargeCellCount(cellCount) ? Math.max(1, Math.floor(windowSize / 2)) : 1;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.2));
  const offColor = applyIntensity(pal[1], baseIntensity * 0.15);

  let t = secStartMs;
  let direction = 1;
  while (t < secEndMs) {
    for (let step = 0; step < steps; step++) {
      const head = direction > 0 ? step * stride : (steps - 1 - step) * stride;
      for (let w = 0; w < windowSize; w++) {
        const cellIdx = head + w;
        if (cellIdx < 0 || cellIdx >= cellCount) continue;
        const cell = cellIdx + 1;
        const cueStart = t + step * stepDur;
        if (cueStart >= secEndMs) break;
        const dur = Math.min(stepDur, secEndMs - cueStart);
        cellCue(cues, p, cell, cueStart, dur, onColor, offColor, 'solid', 'chase');
      }
    }
    t += cycleDur;
    if (rand() > 0.6) direction *= -1;
  }
}

function cellPatternChaseAccel(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const dimColor = applyIntensity(pal[1], baseIntensity * 0.1);
  const windowSize = chaseWindowSize(cellCount);

  const startCycleDur = barMs;
  const endCycleDur = beatMs * 0.5;

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = Math.min(1, (t - secStartMs) / secDurMs);
    const cycleDur = startCycleDur + (endCycleDur - startCycleDur) * (progress * progress);
    const steps = chaseStepCount(cellCount, windowSize);
    const stepDur = cycleDur / steps;
    const stride = isLargeCellCount(cellCount) ? Math.max(1, Math.floor(windowSize / 2)) : 1;
    const intensity = Math.min(1, baseIntensity * (0.5 + progress * 0.8));
    const c = applyIntensity(pal[0], intensity);

    for (let step = 0; step < steps; step++) {
      const head = step * stride;
      for (let w = 0; w < windowSize; w++) {
        const cellIdx = head + w;
        if (cellIdx >= cellCount) continue;
        const cell = cellIdx + 1;
        const cueStart = t + step * stepDur;
        if (cueStart >= secEndMs) break;
        const dur = Math.min(stepDur, secEndMs - cueStart);
        cellCue(cues, p, cell, cueStart, dur, c, dimColor, 'solid', 'build');
      }
    }
    t += cycleDur;
  }
}

function cellPatternAlternate(cues, p, speed) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const swapInterval = speed === 'fast' ? beatMs : beatMs * 2;
  const blockSize = isLargeCellCount(cellCount) ? Math.max(2, Math.round(cellCount / 12)) : 1;

  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[1], baseIntensity);

  let t = secStartMs;
  let swapState = false;
  while (t < secEndMs) {
    const dur = Math.min(swapInterval, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const blockIdx = Math.floor((cell - 1) / blockSize);
      const isOdd = blockIdx % 2 === 0;
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
    const maxFlashes = isLargeCellCount(cellCount)
      ? Math.min(12, Math.max(4, Math.floor(cellCount / 6)))
      : Math.min(3, cellCount);
    const numFlashes = Math.floor(rand() * maxFlashes) + 1;
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
          track: 'color',
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
          track: 'color',
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

// ─── Large-cell patterns (16+ segments) ─────────────────────────────────────

function cellPatternRipple(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const cycleDur = barMs * 2;
  const width = Math.max(2, Math.round(cellCount / 12));
  const center = (cellCount - 1) / 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], baseIntensity);
  const offColor = applyIntensity(pal[1], baseIntensity * 0.08);

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = ((t - secStartMs) % cycleDur) / cycleDur;
    const waveFront = progress * (center + 2);
    for (let cell = 1; cell <= cellCount; cell++) {
      const dist = Math.abs((cell - 1) - center);
      const lit = Math.abs(dist - waveFront) <= width;
      const dur = Math.min(beatMs, secEndMs - t);
      if (dur <= 0) continue;
      cellCue(cues, p, cell, t, dur, lit ? onColor : offColor, null, 'solid', 'ripple');
    }
    t += beatMs;
  }
}

function cellPatternSegments(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const segSize = Math.max(2, Math.min(8, Math.round(cellCount / 8)));
  const steps = Math.max(4, Math.ceil(cellCount / Math.max(1, Math.floor(segSize / 2))));
  const stepDur = beatMs * 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], baseIntensity);
  const offColor = applyIntensity(pal[1], baseIntensity * 0.06);

  let t = secStartMs;
  let offset = 0;
  while (t < secEndMs) {
    for (let cell = 1; cell <= cellCount; cell++) {
      const idx = cell - 1;
      const segIdx = Math.floor((idx + offset) / segSize);
      const lit = segIdx % 2 === 0;
      const dur = Math.min(stepDur, secEndMs - t);
      if (dur <= 0) continue;
      cellCue(cues, p, cell, t, dur, lit ? onColor : offColor, null, 'solid', 'seg');
    }
    t += stepDur;
    offset = (offset + Math.max(1, Math.floor(segSize / 2))) % segSize;
  }
}

function cellPatternComet(cues, p, tailCells) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const headSize = chaseWindowSize(cellCount);
  const tail = tailCells != null ? tailCells : Math.max(headSize, Math.min(16, Math.round(cellCount / 4)));
  const steps = chaseStepCount(cellCount, headSize);
  const cycleDur = barMs * 2;
  const stepDur = cycleDur / steps;
  const stride = Math.max(1, Math.floor(headSize / 2));
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const headColor = applyIntensity(pal[0], baseIntensity);
  const offColor = applyIntensity(pal[1], baseIntensity * 0.04);

  let t = secStartMs;
  let direction = 1;
  while (t < secEndMs) {
    for (let step = 0; step < steps; step++) {
      const head = direction > 0 ? step * stride : (steps - 1 - step) * stride;
      for (let cell = 1; cell <= cellCount; cell++) {
        const idx = cell - 1;
        let behind = direction > 0 ? head - idx : idx - head;
        if (behind < 0) behind = -1;
        let color = offColor;
        if (behind >= 0 && behind < headSize) color = headColor;
        else if (behind >= headSize && behind < headSize + tail) {
          const fade = 1 - (behind - headSize) / tail;
          color = applyIntensity(pal[0], baseIntensity * fade * 0.6);
        }
        const cueStart = t + step * stepDur;
        if (cueStart >= secEndMs) break;
        const dur = Math.min(stepDur, secEndMs - cueStart);
        cellCue(cues, p, cell, cueStart, dur, color, null, 'solid', 'comet');
      }
    }
    t += cycleDur;
    if (rand() > 0.5) direction *= -1;
  }
}

function cellPatternDualChase(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const windowSize = chaseWindowSize(cellCount);
  const steps = chaseStepCount(cellCount, windowSize);
  const cycleDur = barMs * 2;
  const stepDur = cycleDur / steps;
  const stride = Math.max(1, Math.floor(windowSize / 2));
  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[0], baseIntensity);
  const offColor = applyIntensity(pal1[1], baseIntensity * 0.05);

  let t = secStartMs;
  while (t < secEndMs) {
    for (let step = 0; step < steps; step++) {
      const headA = step * stride;
      const headB = cellCount - windowSize - step * stride;
      for (let cell = 1; cell <= cellCount; cell++) {
        const idx = cell - 1;
        const inA = idx >= headA && idx < headA + windowSize;
        const inB = idx >= headB && idx < headB + windowSize;
        const color = inA ? colorA : inB ? colorB : offColor;
        const cueStart = t + step * stepDur;
        if (cueStart >= secEndMs) break;
        const dur = Math.min(stepDur, secEndMs - cueStart);
        cellCue(cues, p, cell, cueStart, dur, color, null, 'solid', 'dual');
      }
    }
    t += cycleDur;
  }
}

function cellPatternGradientSweep(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const c1 = pal[0];
  const c2 = pal[1] || pal[0];
  const cycleDur = barMs * 4;

  let t = secStartMs;
  while (t < secEndMs) {
    const phase = ((t - secStartMs) % cycleDur) / cycleDur;
    for (let cell = 1; cell <= cellCount; cell++) {
      const pos = (((cell - 1) / Math.max(1, cellCount - 1)) + phase) % 1;
      const color = applyIntensity(lerpColor(c1, c2, pos), baseIntensity);
      const dur = Math.min(beatMs, secEndMs - t);
      if (dur <= 0) continue;
      cellCue(cues, p, cell, t, dur, color, null, 'solid', 'grad');
    }
    t += beatMs;
  }
}

function cellPatternBlocks(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, beatMs, rand } = p;
  const blockSize = Math.max(3, Math.min(8, Math.round(cellCount / 10)));
  const swapInterval = beatMs * 2;
  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colors = [
    applyIntensity(pal1[0], baseIntensity),
    applyIntensity(pal2[0], baseIntensity),
    applyIntensity(pal1[1], baseIntensity),
    applyIntensity(pal2[1], baseIntensity),
  ];

  let t = secStartMs;
  let shift = 0;
  while (t < secEndMs) {
    const dur = Math.min(swapInterval, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const blockIdx = Math.floor((cell - 1 + shift) / blockSize);
      const color = colors[blockIdx % colors.length];
      cellCue(cues, p, cell, t, dur, color, null, 'solid', 'block');
    }
    t += swapInterval;
    shift = (shift + Math.max(1, Math.floor(blockSize / 2))) % blockSize;
  }
}

function cellPatternSparkleField(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, rand } = p;
  const tickMs = patternTickMs(p);
  const density = isLargeCellCount(cellCount) ? 0.18 : 0.3;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const sparkColor = applyIntensity(pal[0], baseIntensity);
  const offColor = applyIntensity(pal[1], baseIntensity * 0.04);

  let t = secStartMs;
  while (t < secEndMs) {
    const dur = Math.min(tickMs, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      cellCue(cues, p, cell, t, dur, rand() < density ? sparkColor : offColor, null, 'solid', 'sparkle');
    }
    t += tickMs;
  }
}

function cellPatternCenterPulse(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, rand } = p;
  const tickMs = patternTickMs(p);
  const center = (cellCount - 1) / 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const cycleDur = barMs * 2;

  let t = secStartMs;
  while (t < secEndMs) {
    const phase = ((t - secStartMs) % cycleDur) / cycleDur;
    const pulse = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
    const dur = Math.min(tickMs, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const dist = Math.abs((cell - 1) - center) / Math.max(1, center);
      const level = pulse * (1 - dist * 0.55);
      const color = applyIntensity(pal[0], baseIntensity * Math.max(0.05, level));
      cellCue(cues, p, cell, t, dur, color, null, 'solid', 'pulse');
    }
    t += tickMs;
  }
}

function cellPatternChecker(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, beatMs, rand } = p;
  const blockSize = isLargeCellCount(cellCount) ? Math.max(2, Math.round(cellCount / 12)) : 1;
  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[0], baseIntensity);

  let t = secStartMs;
  let offset = 0;
  while (t < secEndMs) {
    const dur = Math.min(beatMs * 2, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const blockIdx = Math.floor((cell - 1) / blockSize);
      const useA = (blockIdx + offset) % 2 === 0;
      cellCue(cues, p, cell, t, dur, useA ? colorA : colorB, null, 'solid', 'check');
    }
    t += dur;
    offset = (offset + 1) % 2;
  }
}

function cellPatternSplitWipe(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const cycleDur = barMs * 2;
  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[0], baseIntensity);

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = ((t - secStartMs) % cycleDur) / cycleDur;
    const split = progress * cellCount;
    const dur = Math.min(beatMs, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const color = (cell - 1) < split ? colorA : colorB;
      cellCue(cues, p, cell, t, dur, color, null, 'solid', 'wipe');
    }
    t += beatMs;
  }
}

function cellPatternMirror(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;
  const center = (cellCount - 1) / 2;
  const cycleDur = barMs * 2;
  const steps = Math.max(4, Math.ceil(center));
  const stepDur = cycleDur / steps;
  const windowSize = isLargeCellCount(cellCount) ? chaseWindowSize(cellCount) : 1;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], baseIntensity);
  const offColor = applyIntensity(pal[1], baseIntensity * 0.05);

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = ((t - secStartMs) % cycleDur) / cycleDur;
    const spread = progress * center;
    for (let cell = 1; cell <= cellCount; cell++) {
      const dist = Math.abs((cell - 1) - center);
      const lit = Math.abs(dist - spread) < windowSize;
      const cueStart = t;
      if (cueStart >= secEndMs) break;
      const dur = Math.min(stepDur, secEndMs - cueStart);
      cellCue(cues, p, cell, cueStart, dur, lit ? onColor : offColor, null, 'solid', 'mirror');
    }
    t += stepDur;
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
    case 'ripple':         cellPatternRipple(cues, ctx); break;
    case 'segments':       cellPatternSegments(cues, ctx); break;
    case 'comet':          cellPatternComet(cues, ctx); break;
    case 'snake':          cellPatternComet(cues, ctx, Math.max(8, Math.round(ctx.cellCount / 3))); break;
    case 'dual_chase':     cellPatternDualChase(cues, ctx); break;
    case 'gradient_sweep': cellPatternGradientSweep(cues, ctx); break;
    case 'blocks':         cellPatternBlocks(cues, ctx); break;
    case 'sparkle_field':  cellPatternSparkleField(cues, ctx); break;
    case 'center_pulse':   cellPatternCenterPulse(cues, ctx); break;
    case 'checker':        cellPatternChecker(cues, ctx); break;
    case 'split_wipe':     cellPatternSplitWipe(cues, ctx); break;
    case 'mirror':         cellPatternMirror(cues, ctx); break;
  }
}

// ─── Main orchestrator ──────────────────────────────────────────────────────

function generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx) {
  const { barMs, beatMs, rand, paletteKey, preset, snapBeat } = ctx;

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
    const maxCellCount = Math.max(...group.map(f => f.cell_count || 0));

    for (const section of sections) {
      const label = section.label || 'verse';
      const secStartMs = snapBeat(Math.round(section.start_ms));
      const secEndMs = Math.round(section.end_ms);
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs < barMs) continue;

      const useCascade = canCascade && (
        CASCADE_SECTIONS.has(label)
        || stableRoll(`mc-cascade-${typeName}-${label}-${secStartMs}`) > 0.5
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
          hasWhite: refFix.channels.some(ch => ch.type === 'white' && ch.cell != null),
        });
      } else {
        for (const fix of group) {
          const existingCue = cues.find(c => c.fixture_id === fix.id);
          fixtureContexts.push({
            fix,
            lane: existingCue ? existingCue.lane : 0,
            cellCount: fix.cell_count,
            hasDimmer: fix.channels.some(ch => ch.type === 'dimmer'),
            hasWhite: fix.channels.some(ch => ch.type === 'white' && ch.cell != null),
          });
        }
      }

      const patterns = getPatternPool(label, maxCellCount, ctx);
      const allPalettes = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const style = (ctx.activeSectionStyles || sectionStyles)[label] || defaultStyle;
      const baseIntensity = Math.min(1, ((style.intensity[0] + style.intensity[1]) / 2) * preset.intensityMult);

      const subPhraseBars = subPhraseBarsFor(maxCellCount);
      const subPhraseMs = subPhraseBars * barMs;
      const numSubPhrases = Math.max(1, Math.floor(secDurMs / subPhraseMs));
      const useSubPhrases = numSubPhrases >= 2 && label !== 'buildup';

      const sectionPatterns = [];
      const recentPatterns = [];
      if (useSubPhrases) {
        for (let sp = 0; sp < numSubPhrases; sp++) {
          const pattern = pickPattern(
            patterns,
            recentPatterns,
            `mc-pat-${typeName}-${label}-${secStartMs}-${sp}`,
          );
          recentPatterns.push(pattern);
          if (recentPatterns.length > 2) recentPatterns.shift();
          const patPalettes = [allPalettes[sp % allPalettes.length]];
          if (allPalettes.length > 1) patPalettes.push(allPalettes[(sp + 1) % allPalettes.length]);
          sectionPatterns.push({ pattern, patPalettes, spStart: secStartMs + sp * subPhraseMs,
            spEnd: sp === numSubPhrases - 1 ? secEndMs : secStartMs + (sp + 1) * subPhraseMs });
        }
      } else {
        sectionPatterns.push({
          pattern: pickPattern(patterns, [], `mc-pat-${typeName}-${label}-${secStartMs}`),
          patPalettes: allPalettes,
          spStart: secStartMs,
          spEnd: secEndMs,
        });
      }

      for (const fCtx of fixtureContexts) {
        const fixBaseIntensity = Math.min(1, baseIntensity * getFixtureIntensity(fCtx.fix.id, label, ctx));
        for (const spPlan of sectionPatterns) {
          const spDur = spPlan.spEnd - spPlan.spStart;
          if (spDur < barMs) continue;
          const patternCtx = {
            ...fCtx,
            secStartMs: spPlan.spStart, secEndMs: spPlan.spEnd, secDurMs: spDur,
            palettes: spPlan.patPalettes, baseIntensity: fixBaseIntensity, label,
            ...ctx,
          };
          _dispatchCellPattern(cues, spPlan.pattern, patternCtx);
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
};
