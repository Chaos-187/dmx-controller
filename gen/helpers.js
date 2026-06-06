/**
 * Sequence Generator — Shared Helpers
 *
 * Color manipulation, beat snapping, seeded random, and shared constants.
 */

const CUE_COLORS = [
  '#e53935', '#43a047', '#1e88e5', '#ff8f00',
  '#7b1fa2', '#00acc1', '#fdd835', '#d81b60',
  '#6d4c41', '#00897b', '#5e35b1', '#f4511e',
];

function applyIntensity(color, level) {
  return {
    r: Math.round(color.r * level),
    g: Math.round(color.g * level),
    b: Math.round(color.b * level),
  };
}

function lerpColor(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Parse a hex color string to {r, g, b} */
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  return {
    r: parseInt(hex.substring(0, 2), 16) || 0,
    g: parseInt(hex.substring(2, 4), 16) || 0,
    b: parseInt(hex.substring(4, 6), 16) || 0,
  };
}

/**
 * Find the nearest color wheel entry for a given {r, g, b} color.
 * Uses Euclidean distance in RGB space.
 */
function findNearestWheelColor(color, wheelMap) {
  if (!wheelMap || wheelMap.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const entry of wheelMap) {
    const c = hexToRgb(entry.color_hex);
    const dist = (color.r - c.r) ** 2 + (color.g - c.g) ** 2 + (color.b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

/**
 * Find a split/half-color position between two adjacent wheel colors.
 * Many color wheel fixtures have half-positions between gel slots.
 * The DMX value sits at the boundary between two adjacent color ranges.
 * @param {Object} color1 - {r,g,b} first color to match
 * @param {Object} color2 - {r,g,b} second color to match
 * @param {Array} wheelMap - color wheel entries sorted by dmx_start
 * @returns {{ dmx: number, color_hex: string, label: string }|null}
 */
function findSplitWheelPosition(color1, color2, wheelMap) {
  if (!wheelMap || wheelMap.length < 2) return null;

  const w1 = findNearestWheelColor(color1, wheelMap);
  const w2 = findNearestWheelColor(color2, wheelMap);
  if (!w1 || !w2 || w1 === w2) return null;

  // Find the two entries in the sorted map
  const idx1 = wheelMap.indexOf(w1);
  const idx2 = wheelMap.indexOf(w2);

  // Only produce splits for adjacent colors on the wheel
  if (Math.abs(idx1 - idx2) !== 1) return null;

  // Split position: DMX value between the end of one color and start of the next
  const lower = idx1 < idx2 ? w1 : w2;
  const upper = idx1 < idx2 ? w2 : w1;
  const splitDmx = Math.round((lower.dmx_end + upper.dmx_start) / 2);

  // Blend the display colors for the UI
  const c1 = hexToRgb(lower.color_hex);
  const c2 = hexToRgb(upper.color_hex);
  const blended = rgbToHex(
    Math.round((c1.r + c2.r) / 2),
    Math.round((c1.g + c2.g) / 2),
    Math.round((c1.b + c2.b) / 2)
  );

  return {
    dmx: splitDmx,
    color_hex: blended,
    label: `${lower.label || '?'}/${upper.label || '?'}`,
  };
}

/**
 * Snap a time value to the nearest actual beat in the fluid beat array.
 * Uses binary search for efficiency.
 */
function snapToBeat(timeMs, beats) {
  if (!beats || beats.length === 0) return timeMs;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < timeMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return beats[0];
  if (lo >= beats.length) return beats[beats.length - 1];
  const distPrev = Math.abs(timeMs - beats[lo - 1]);
  const distNext = Math.abs(timeMs - beats[lo]);
  return distPrev <= distNext ? beats[lo - 1] : beats[lo];
}

/**
 * Snap a time value to the nearest bar boundary (every 4th beat).
 * @param {number} timeMs
 * @param {number[]} beats – sorted beat timestamps
 * @param {number} [downbeatIdx=0] – index into beats[] of the first musical downbeat
 */
function snapToBar(timeMs, beats, downbeatIdx = 0) {
  if (!beats || beats.length < 4) return snapToBeat(timeMs, beats);
  let bestDist = Infinity, bestTime = timeMs;
  // Step from the downbeat index so bar boundaries land on actual downbeats
  // Also walk backwards from downbeatIdx for any pre-phase bars
  const start = downbeatIdx % 4;
  for (let i = start; i < beats.length; i += 4) {
    const dist = Math.abs(beats[i] - timeMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestTime = beats[i];
    } else if (beats[i] > timeMs + bestDist) {
      break;
    }
  }
  return bestTime;
}

/**
 * Find the index of the first musical downbeat in the beats array.
 * Pre-beats (before firstBeatMs) shift the array so beats[0] isn't always
 * beat 1.  This returns the index to start 4-beat bar stepping from.
 * @param {number[]} beats
 * @param {number} firstBeatMs
 * @returns {number}
 */
function computeDownbeatPhase(beats, firstBeatMs) {
  if (!beats || beats.length === 0 || firstBeatMs <= 0) return 0;
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < Math.min(beats.length, 32); i++) {
    const dist = Math.abs(beats[i] - firstBeatMs);
    if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    if (beats[i] > firstBeatMs + bestDist) break;
  }
  return bestIdx % 4;
}

/**
 * Find the beat index closest to a given timestamp.
 * @param {number} timeMs
 * @param {number[]} beats
 * @returns {number} index into beats[]
 */
function beatIndexAt(timeMs, beats) {
  if (!beats || beats.length === 0) return 0;
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < timeMs) lo = mid + 1;
    else hi = mid;
  }
  if (lo === 0) return 0;
  if (lo >= beats.length) return beats.length - 1;
  return Math.abs(timeMs - beats[lo - 1]) <= Math.abs(timeMs - beats[lo]) ? lo - 1 : lo;
}

/**
 * Walk N beats forward from a starting time using the actual beats array.
 * Returns the beat timestamp, avoiding accumulation drift.
 * @param {number} startMs - starting timestamp
 * @param {number} nBeats  - number of beats to advance (can be fractional: 4 = 1 bar, 2 = half bar)
 * @param {number[]} beats
 * @param {number} beatMs  - fallback beat duration if beats array is exhausted
 * @returns {number}
 */
function walkBeats(startMs, nBeats, beats, beatMs) {
  if (!beats || beats.length === 0) return startMs + nBeats * beatMs;
  const startIdx = beatIndexAt(startMs, beats);
  const whole = Math.floor(nBeats);
  const frac = nBeats - whole;
  const targetIdx = startIdx + whole;
  if (targetIdx >= beats.length) {
    // Past end of beats array — extrapolate from last beat
    const overshoot = targetIdx - beats.length + 1;
    return beats[beats.length - 1] + (overshoot + frac) * beatMs;
  }
  const baseTime = beats[targetIdx];
  if (frac > 0 && targetIdx + 1 < beats.length) {
    return baseTime + (beats[targetIdx + 1] - baseTime) * frac;
  }
  return baseTime + frac * beatMs;
}

/** Seeded pseudo-random for deterministic results per track */
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/**
 * Stable 0–1 roll from a string key — same key always yields the same value.
 * Use for decisions that must match across all fixtures in a section (cue type,
 * effect pick, strobe gate, etc.).
 */
function stableRoll(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  return ((h * 2654435761) >>> 0) / 4294967296;
}

/**
 * Get per-fixture intensity multiplier based on fixture role and section label.
 * Returns a 0–1 scalar that should multiply the section intensity.
 * @param {number} fixtureId
 * @param {string} sectionLabel - 'intro','verse','chorus', etc.
 * @param {Object} ctx - generation context with fixtureRoleMap and activeFixtureIntensity
 * @returns {number} intensity multiplier (default 1.0)
 */
function getFixtureIntensity(fixtureId, sectionLabel, ctx) {
  if (!ctx.activeFixtureIntensity || !ctx.fixtureRoleMap) return 1.0;
  const role = ctx.fixtureRoleMap.get(fixtureId) || 'par';
  const roleCurve = ctx.activeFixtureIntensity[role];
  if (!roleCurve) return 1.0;
  return roleCurve[sectionLabel] ?? 1.0;
}

/**
 * Get the average stem energy within a time range.
 * @param {string} stemName - 'vocals', 'drums', 'bass', 'other'
 * @param {number} startMs  - section start time
 * @param {number} endMs    - section end time
 * @param {Object} ctx      - generation context with stemEnergy
 * @returns {number|null}   - average energy (0-1) or null if no stem data
 */
function getStemEnergy(stemName, startMs, endMs, ctx) {
  if (!ctx.stemEnergy || !ctx.stemEnergy.energy || !ctx.stemEnergy.energy[stemName]) return null;
  const segments = ctx.stemEnergy.energy[stemName];
  let sum = 0, count = 0;
  for (const seg of segments) {
    if (seg.time_ms >= startMs && seg.time_ms < endMs) {
      sum += seg.energy;
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

/**
 * Check if vocals are active during a section (>15% of vocal max).
 * Uses the pre-computed vocal_ranges from the stem summary if available,
 * otherwise falls back to per-segment energy check.
 *
 * @param {number} startMs
 * @param {number} endMs
 * @param {Object} ctx
 * @returns {boolean|null} - true/false if stem data available, null otherwise
 */
function hasVocals(startMs, endMs, ctx) {
  if (!ctx.stemEnergy) return null;

  // Check summary vocal_ranges first (efficient, pre-computed)
  const summary = ctx.stemEnergy.summary;
  if (summary && summary.vocal_ranges) {
    const ranges = summary.vocal_ranges;
    const sectionMid = (startMs + endMs) / 2;
    const sectionLen = endMs - startMs;
    // Vocals are "active" if any vocal range overlaps >30% of the section
    let overlapMs = 0;
    for (const r of ranges) {
      const oStart = Math.max(startMs, r.start_ms);
      const oEnd   = Math.min(endMs, r.end_ms);
      if (oEnd > oStart) overlapMs += (oEnd - oStart);
    }
    return overlapMs > sectionLen * 0.3;
  }

  // Fallback: check raw energy
  const vocalEnergy = getStemEnergy('vocals', startMs, endMs, ctx);
  if (vocalEnergy === null) return null;
  const maxVocal = ctx.stemEnergy.summary?.vocals?.max || 0.1;
  return vocalEnergy > maxVocal * 0.15;
}

/**
 * Get the drum onset density for a section (onsets per second).
 * @param {number} startMs
 * @param {number} endMs
 * @param {Object} ctx
 * @returns {number|null}
 */
function getDrumDensity(startMs, endMs, ctx) {
  if (!ctx.stemEnergy || !ctx.stemEnergy.energy || !ctx.stemEnergy.energy.drums) return null;
  const segments = ctx.stemEnergy.energy.drums;
  let onsets = 0;
  const inRange = segments.filter(s => s.time_ms >= startMs && s.time_ms < endMs);
  for (let i = 1; i < inRange.length; i++) {
    if (inRange[i].energy - inRange[i - 1].energy > 0.02) onsets++;
  }
  const durationSec = (endMs - startMs) / 1000;
  return durationSec > 0 ? onsets / durationSec : null;
}

module.exports = {
  CUE_COLORS,
  applyIntensity,
  lerpColor,
  rgbToHex,
  hexToRgb,
  findNearestWheelColor,
  findSplitWheelPosition,
  snapToBeat,
  snapToBar,
  computeDownbeatPhase,
  beatIndexAt,
  walkBeats,
  seededRandom,
  stableRoll,
  getFixtureIntensity,
  getStemEnergy,
  hasVocals,
  getDrumDensity,
};
