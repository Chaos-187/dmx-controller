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
 */
function snapToBar(timeMs, beats) {
  if (!beats || beats.length < 4) return snapToBeat(timeMs, beats);
  let bestDist = Infinity, bestTime = timeMs;
  for (let i = 0; i < beats.length; i += 4) {
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

/** Seeded pseudo-random for deterministic results per track */
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

module.exports = {
  CUE_COLORS,
  applyIntensity,
  lerpColor,
  rgbToHex,
  hexToRgb,
  findNearestWheelColor,
  snapToBeat,
  snapToBar,
  seededRandom,
};
