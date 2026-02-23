/**
 * Audio Waveform Analyzer  (v4 — fluid beat grid)
 *
 * Uses ffmpeg to decode audio files to raw PCM, then computes:
 *   - Waveform peaks with per-band (bass / mid / treble) energy
 *   - True RMS energy levels over time (per-band)
 *   - Fluid beat positions detected from bass onsets, guided by BPM
 *   - Structural sections using beat-derived variable-width bars
 *
 * Looks for a local ffmpeg.exe in the project directory first, then falls back
 * to system PATH.  No ffprobe dependency — metadata is parsed from ffmpeg stderr.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Default Constants (overridable via opts.config) ────────────────────────

const ANALYSIS_VERSION = 11;
const DEFAULTS = {
  TARGET_PEAKS:         2000,     // waveform overview points (up from 1000)
  ENERGY_SEGMENT_MS:    50,       // energy computed every N ms  (was 100)
  DECODE_SAMPLE_RATE:   22050,    // downsample for analysis (mono)
  SECTION_MIN_BARS:     4,        // minimum section length in bars
  SECTION_WINDOW_BARS:  4,        // energy smoothing window in bars
  SECTION_SENSITIVITY:  1.2,      // novelty threshold multiplier (mean + X*std)
  NORMALIZE_PERCENTILE: 99,       // percentile for peak normalisation (avoids spike squash)
};
const BYTES_PER_SAMPLE = 2;       // 16-bit signed LE

// ─── Simple IIR filter helpers for 3-band frequency split ───────────────────

/**
 * First-order low-pass coefficient  α = dt / (RC + dt)
 * where RC = 1 / (2π · cutoff), dt = 1 / sampleRate
 */
function lpCoeff(cutoffHz, sampleRate) {
  const rc = 1.0 / (2.0 * Math.PI * cutoffHz);
  const dt = 1.0 / sampleRate;
  return dt / (rc + dt);
}

/**
 * Create a simple first-order IIR state object
 */
function iirState() { return { prev: 0, prevIn: 0 }; }

/**
 * Low-pass filter: y[n] = α·x[n] + (1-α)·y[n-1]
 */
function lpFilter(sample, alpha, state) {
  const out = alpha * sample + (1 - alpha) * state.prev;
  state.prev = out;
  return out;
}

/**
 * High-pass filter: y[n] = (1-α)·(y[n-1] + x[n] − x[n-1])
 */
function hpFilter(sample, alpha, state) {
  const out = (1 - alpha) * (state.prev + sample - state.prevIn);
  state.prevIn = sample;
  state.prev = out;
  return out;
}

// ─── Resolve ffmpeg path ────────────────────────────────────────────────────

// In pkg mode, __dirname points to the read-only snapshot; use the exe directory instead
const PROJECT_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

/**
 * Return the path to ffmpeg — prefer a local copy in the project directory.
 */
function getFfmpegPath() {
  const local = path.join(PROJECT_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg'; // fall back to PATH
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Check whether ffmpeg is reachable.
 * @returns {Promise<boolean>}
 */
function checkFfmpeg() {
  return new Promise((resolve) => {
    const proc = spawn(getFfmpegPath(), ['-version'], { stdio: 'pipe', windowsHide: true });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Get the ffmpeg version string, or null if unavailable.
 * @returns {Promise<string|null>}
 */
function getFfmpegVersion() {
  return new Promise((resolve) => {
    let out = '';
    const proc = spawn(getFfmpegPath(), ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const m = out.match(/ffmpeg version ([^\s]+)/);
      resolve(m ? m[1] : out.split('\n')[0].trim() || null);
    });
  });
}

/**
 * Get the ffprobe version string, or null if unavailable.
 * @returns {Promise<string|null>}
 */
function getFfprobeVersion() {
  return new Promise((resolve) => {
    const probePath = (() => {
      const local = path.join(PROJECT_DIR, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
      if (fs.existsSync(local)) return local;
      return 'ffprobe';
    })();
    let out = '';
    const proc = spawn(probePath, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    proc.stdout.on('data', d => { out += d; });
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const m = out.match(/ffprobe version ([^\s]+)/);
      resolve(m ? m[1] : out.split('\n')[0].trim() || null);
    });
  });
}

/**
 * Get audio metadata using ffmpeg (no ffprobe dependency).
 * Parses the stderr info lines that ffmpeg prints for the input file.
 *
 * @param {string} filePath
 * @returns {Promise<{sample_rate: number, channels: number, duration: number, codec: string}>}
 */
function probeFile(filePath) {
  return new Promise((resolve, reject) => {
    // ffmpeg -i <file> with no output — prints metadata to stderr then exits
    const proc = spawn(getFfmpegPath(), ['-i', filePath, '-f', 'null', '-'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)));
    proc.on('close', () => {
      // Parse duration: "Duration: HH:MM:SS.ss"
      let duration = 0;
      const durMatch = stderr.match(/Duration:\s+(\d+):(\d+):(\d+)\.(\d+)/);
      if (durMatch) {
        duration = +durMatch[1] * 3600 + +durMatch[2] * 60 + +durMatch[3] + +durMatch[4] / 100;
      }

      // Parse audio stream: "Audio: codec, samplerate Hz, channels"
      let sample_rate = 44100, channels = 2, codec = 'unknown';
      const audioMatch = stderr.match(/Audio:\s+(\w+)[^,]*,\s+(\d+)\s+Hz,\s+(\w+)/);
      if (audioMatch) {
        codec = audioMatch[1];
        sample_rate = parseInt(audioMatch[2]) || 44100;
        const chanStr = audioMatch[3];
        if (chanStr === 'mono') channels = 1;
        else if (chanStr === 'stereo') channels = 2;
        else if (chanStr === '5.1') channels = 6;
        else channels = parseInt(chanStr) || 2;
      }

      if (duration <= 0) {
        return reject(new Error('Cannot determine audio duration from ffmpeg output'));
      }
      resolve({ sample_rate, channels, duration, codec });
    });
  });
}

// ─── Fluid Beat Detection ───────────────────────────────────────────────────

/**
 * Detect actual beat positions from bass energy data, guided by BPM.
 *
 * Instead of a rigid grid (firstBeat + n * beatMs), this finds real onset
 * peaks in the bass energy and snaps/fills using the BPM as a guide.
 * The result is a "fluid" beat grid that flexes with the actual music
 * while staying musically coherent.
 *
 * Algorithm:
 * 1. Compute a bass onset strength function from energy segments.
 * 2. Find local peaks that exceed an adaptive threshold.
 * 3. Use BPM-guided window to assign each peak to the nearest expected
 *    beat position, rejecting duplicates and filling gaps.
 * 4. Return actual beat times (not evenly spaced).
 *
 * @param {Array}  energySegments – [{time_ms, bass, energy, ...}, ...]
 * @param {number} bpm            – reference BPM from metadata
 * @param {number} durationMs     – track duration in ms
 * @param {number} [firstBeatMs=0] – first beat hint from metadata
 * @returns {number[]} beat times in ms (sorted)
 */
function detectBeats(energySegments, bpm, durationMs, firstBeatMs = 0) {
  if (!energySegments.length || bpm <= 0) return [];

  const expectedBeatMs = 60000 / bpm;
  // Tolerance: how far an onset can be from the expected grid beat to attract it.
  // Keep tight (±15%) so beats never drift more than ~70ms at 128 BPM.
  const tolerance = expectedBeatMs * 0.15;

  const segDt = energySegments.length > 1
    ? energySegments[1].time_ms - energySegments[0].time_ms
    : 50;

  // ── 1. Build onset strength from bass energy differences ──────────
  const onsets = [];
  for (let i = 1; i < energySegments.length; i++) {
    const prev = energySegments[i - 1];
    const curr = energySegments[i];
    const bassDiff = (curr.bass || curr.energy) - (prev.bass || prev.energy);
    onsets.push({
      time_ms: curr.time_ms,
      strength: Math.max(0, bassDiff),
    });
  }

  if (onsets.length === 0) return [];

  // ── 2. Adaptive threshold for onset peaks ─────────────────────────
  // Use a running mean + std over a local window (~2 bars).
  // Require onsets to be well above local noise (1.2×std).
  const windowSize = Math.max(4, Math.round((expectedBeatMs * 8) / segDt));

  const onsetPeaks = [];  // { time_ms, strength }
  for (let i = 0; i < onsets.length; i++) {
    const loIdx = Math.max(0, i - windowSize);
    const hiIdx = Math.min(onsets.length - 1, i + windowSize);
    let sum = 0, count = 0;
    for (let j = loIdx; j <= hiIdx; j++) { sum += onsets[j].strength; count++; }
    const localMean = sum / count;

    let sqSum = 0;
    for (let j = loIdx; j <= hiIdx; j++) {
      const d = onsets[j].strength - localMean;
      sqSum += d * d;
    }
    const localStd = Math.sqrt(sqSum / count);
    const threshold = localMean + localStd * 1.2;  // stricter: was 0.8

    if (onsets[i].strength > threshold && onsets[i].strength > 0) {
      const isLocalMax =
        (i === 0 || onsets[i].strength >= onsets[i - 1].strength) &&
        (i === onsets.length - 1 || onsets[i].strength >= onsets[i + 1].strength);
      if (isLocalMax) {
        onsetPeaks.push({ time_ms: onsets[i].time_ms, strength: onsets[i].strength });
      }
    }
  }

  // ── 3. Build guided beat grid, then attract to nearest onset ──────
  // The grid from VDJ's firstBeat + BPM is the ground truth timing.
  // Onsets only nudge beats slightly (blended) instead of hard-snapping.
  const phase = firstBeatMs >= 0 ? firstBeatMs : 0;
  const gridBeats = [];
  let gridTime = phase;

  // Walk backwards from phase to cover any intro before the first beat
  if (phase > expectedBeatMs) {
    let t = phase - expectedBeatMs;
    const preBeats = [];
    while (t >= 0) {
      preBeats.push(t);
      t -= expectedBeatMs;
    }
    preBeats.reverse();
    for (const bt of preBeats) gridBeats.push(bt);
  }

  // Walk forward through the track
  while (gridTime < durationMs) {
    gridBeats.push(gridTime);
    gridTime += expectedBeatMs;
  }

  // Snap each grid beat toward the nearest strong onset within tolerance.
  // Use weighted blending: blend = 0.5 × (1 - dist/tolerance) so nearby
  // onsets pull harder but the grid is never fully abandoned.
  const fluidBeats = [];
  let onsetIdx = 0;

  for (let bi = 0; bi < gridBeats.length; bi++) {
    const expected = gridBeats[bi];

    // Advance onset pointer
    while (onsetIdx < onsetPeaks.length && onsetPeaks[onsetIdx].time_ms < expected - tolerance) {
      onsetIdx++;
    }

    // Find the strongest onset within tolerance (prefer strongest, not closest)
    let bestOnset = null;
    let bestScore = 0;
    for (let oi = Math.max(0, onsetIdx - 1); oi < onsetPeaks.length; oi++) {
      const o = onsetPeaks[oi];
      const dist = Math.abs(o.time_ms - expected);
      if (dist > tolerance) {
        if (o.time_ms > expected + tolerance) break;
        continue;
      }
      // Score: prefer strong onsets that are close to the grid position
      const proximityWeight = 1 - dist / tolerance;  // 1 = exact match, 0 = edge
      const score = o.strength * proximityWeight;
      if (score > bestScore) {
        bestScore = score;
        bestOnset = o;
      }
    }

    let finalTime;
    if (bestOnset) {
      // Blend toward onset: 50% weight, scaled by proximity
      const dist = Math.abs(bestOnset.time_ms - expected);
      const blendWeight = 0.5 * (1 - dist / tolerance);
      finalTime = expected + (bestOnset.time_ms - expected) * blendWeight;
    } else {
      finalTime = expected;
    }

    // Enforce minimum spacing: at least 75% of expected beat interval
    const prevBeat = fluidBeats.length > 0 ? fluidBeats[fluidBeats.length - 1] : -Infinity;
    if (finalTime - prevBeat >= expectedBeatMs * 0.75) {
      fluidBeats.push(Math.round(finalTime));
    } else if (expected - prevBeat >= expectedBeatMs * 0.75) {
      // Onset would bunch up — use pure grid position instead
      fluidBeats.push(Math.round(expected));
    }
    // else: skip entirely (shouldn't happen with a clean grid)
  }

  return fluidBeats;
}

/**
 * Derive bar start times from fluid beats (every 4 beats = 1 bar).
 * Returns array of {start_ms, end_ms} for each bar.
 *
 * @param {number[]} beats – sorted beat times
 * @param {number} durationMs
 * @returns {Array<{start_ms: number, end_ms: number}>}
 */
function beatsToBarBoundaries(beats, durationMs) {
  if (beats.length < 4) return [];
  const bars = [];
  for (let i = 0; i < beats.length; i += 4) {
    const start = beats[i];
    const end = i + 4 < beats.length ? beats[i + 4] : durationMs;
    bars.push({ start_ms: start, end_ms: end });
  }
  return bars;
}

// ─── Section Detection ──────────────────────────────────────────────────────

/**
 * Section color palette — each section type gets a distinctive colour.
 */
const SECTION_COLORS = {
  intro:     '#448aff',
  verse:     '#00e676',
  chorus:    '#e94560',
  bridge:    '#ffea00',
  breakdown: '#00e5ff',
  buildup:   '#ff9100',
  drop:      '#d500f9',
  outro:     '#78909c',
  unknown:   '#555',
};

/**
 * Detect structural sections from multi-band energy data and beat grid.
 *
 * Algorithm  (v3.1 — multi-scale novelty + mandatory splits):
 * 1. Compute per-bar average energy for bass, mid, treble and total.
 * 2. Light smoothing (1-bar half-window) to remove noise but keep contrast.
 * 3. Multi-scale novelty: combine short-term (bar-to-bar), phrase-level
 *    (4-bar lookahead/behind) and spectral (cosine distance) signals.
 * 4. Pick peaks, snap to 4/8-bar grid, enforce max section length of 16 bars
 *    by splitting oversized sections at their strongest sub-boundary.
 * 5. Classify using percentile-based energy zones (p25/p50/p75) + bass ratio
 *    + position + neighbour contrast.
 * 6. Merge only tiny (<4 bar) same-label neighbours — never merge sections
 *    that are individually longer.
 *
 * @param {Array} energySegments  – [{time_ms, energy, bass, mid, treble}, ...]
 * @param {Array} beats           – [beatMs, ...]
 * @param {number} durationMs
 * @param {number} bpm
 * @param {object} [cfg]          – { SECTION_MIN_BARS, SECTION_WINDOW_BARS, SECTION_SENSITIVITY }
 * @param {number} [firstBeatMs=0] – first beat offset in ms (aligns bar grid to musical phrases)
 * @returns {Array} sections – [{start_ms, end_ms, label, color, energy, bars}, ...]
 */
function detectSections(energySegments, beats, durationMs, bpm, cfg = {}, firstBeatMs = 0) {
  const SECTION_MIN_BARS    = cfg.SECTION_MIN_BARS   || DEFAULTS.SECTION_MIN_BARS;
  const SECTION_WINDOW_BARS = cfg.SECTION_WINDOW_BARS || DEFAULTS.SECTION_WINDOW_BARS;
  const SECTION_SENSITIVITY = cfg.SECTION_SENSITIVITY || DEFAULTS.SECTION_SENSITIVITY;
  const MAX_SECTION_BARS    = 16;   // force-split any section longer than this
  const MAX_INTRO_BARS     = 8;    // intro/outro can't exceed this many bars

  if (!energySegments.length || !beats.length || bpm <= 0) return [];

  // ── Derive fluid bars from actual beat positions ──────────────────────
  // Each bar = 4 consecutive beats.  Bar timing flexes with the audio.
  const bars = beatsToBarBoundaries(beats, durationMs);
  const totalBars = bars.length;
  if (totalBars < SECTION_MIN_BARS * 2) return [];

  // ── 1. Per-bar energy averages (using actual bar boundaries) ──────────
  function barAverages(field) {
    const arr = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = bars[bar].start_ms;
      const barEnd   = bars[bar].end_ms;
      const inBar = energySegments.filter(s => s.time_ms >= barStart && s.time_ms < barEnd);
      arr.push(inBar.length > 0
        ? inBar.reduce((sum, s) => sum + (s[field] || s.energy || 0), 0) / inBar.length
        : 0);
    }
    return arr;
  }

  const barTotal = barAverages('energy');
  const hasBands = energySegments[0] && energySegments[0].bass !== undefined;
  const barBass   = hasBands ? barAverages('bass')   : barTotal.map(v => v);
  const barMid    = hasBands ? barAverages('mid')     : barTotal.map(v => v);
  const barTreble = hasBands ? barAverages('treble')  : barTotal.map(v => v);

  // ── 2. Light smoothing (half-window = 1 bar) so we keep contrast ─────
  function smooth(arr, halfW) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - halfW); j <= Math.min(arr.length - 1, i + halfW); j++) {
        sum += arr[j]; n++;
      }
      out.push(sum / n);
    }
    return out;
  }
  const smTotal  = smooth(barTotal,  1);
  const smBass   = smooth(barBass,   1);
  const smMid    = smooth(barMid,    1);
  const smTreble = smooth(barTreble, 1);

  // ── 3. Multi-scale novelty ────────────────────────────────────────────
  //   a) Short-term: absolute energy difference bar-to-bar
  //   b) Phrase-level: compare bar i energy to mean of bars [i-phraseK .. i-1]
  //      vs mean of bars [i .. i+phraseK-1]
  //   c) Spectral: cosine distance of [bass, mid, treble] vectors

  const phraseK = Math.min(4, Math.floor(totalBars / 4)); // 4-bar context each side

  function meanRange(arr, lo, hi) {
    lo = Math.max(0, lo);
    hi = Math.min(arr.length - 1, hi);
    if (lo > hi) return 0;
    let s = 0;
    for (let i = lo; i <= hi; i++) s += arr[i];
    return s / (hi - lo + 1);
  }

  function cosineDist(a, b) {
    const dot  = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const magA = Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]) || 1e-9;
    const magB = Math.sqrt(b[0]*b[0] + b[1]*b[1] + b[2]*b[2]) || 1e-9;
    return 1 - (dot / (magA * magB));
  }

  // Energy range for normalising magnitude differences
  const eSorted = [...smTotal].sort((a, b) => a - b);
  const eMin = eSorted[Math.floor(eSorted.length * 0.05)] || 0;
  const eMax = eSorted[Math.floor(eSorted.length * 0.95)] || 1;
  const eRange = (eMax - eMin) || 1;

  const novelty = new Float64Array(totalBars);
  for (let i = 1; i < totalBars; i++) {
    // Short-term magnitude change (normalised)
    const shortDiff = Math.abs(smTotal[i] - smTotal[i - 1]) / eRange;

    // Phrase-level contrast
    const leftMean  = meanRange(smTotal, i - phraseK, i - 1);
    const rightMean = meanRange(smTotal, i, i + phraseK - 1);
    const phraseDiff = Math.abs(rightMean - leftMean) / eRange;

    // Spectral change
    const vecPrev = [smBass[i-1], smMid[i-1], smTreble[i-1]];
    const vecCurr = [smBass[i],   smMid[i],   smTreble[i]];
    const specDiff = cosineDist(vecPrev, vecCurr);

    // Phrase-level spectral contrast (average band energy left vs right)
    const lBass  = meanRange(smBass,   i - phraseK, i - 1);
    const rBass  = meanRange(smBass,   i, i + phraseK - 1);
    const lMid   = meanRange(smMid,    i - phraseK, i - 1);
    const rMid   = meanRange(smMid,    i, i + phraseK - 1);
    const lTreb  = meanRange(smTreble, i - phraseK, i - 1);
    const rTreb  = meanRange(smTreble, i, i + phraseK - 1);
    const phraseSpec = cosineDist([lBass, lMid, lTreb], [rBass, rMid, rTreb]);

    // Weighted combination
    novelty[i] = shortDiff * 0.15 + phraseDiff * 0.35 + specDiff * 0.15 + phraseSpec * 0.35;
  }

  // Adaptive threshold
  let novSum = 0, novSq = 0;
  for (let i = 0; i < totalBars; i++) { novSum += novelty[i]; novSq += novelty[i] * novelty[i]; }
  const novMean = novSum / totalBars;
  const novStd  = Math.sqrt(novSq / totalBars - novMean * novMean);
  const novThreshold = novMean + SECTION_SENSITIVITY * novStd;

  // ── 4. Pick boundaries & snap to 4-bar grid ──────────────────────────
  const boundaries = [0];
  let lastBoundary = 0;

  for (let i = 1; i < totalBars; i++) {
    if (novelty[i] > novThreshold && (i - lastBoundary) >= SECTION_MIN_BARS) {
      // Local peak check: must be highest within ±1 bar
      if ((i === 1 || novelty[i] >= novelty[i - 1]) &&
          (i === totalBars - 1 || novelty[i] >= novelty[i + 1])) {
        // Snap to nearest 8-bar boundary first (natural phrase length),
        // falling back to 4-bar if 8-bar is too far away
        const nearest8 = Math.round(i / 8) * 8;
        const nearest4 = Math.round(i / 4) * 4;
        let snapped = i;
        if (Math.abs(nearest8 - i) <= 2 && nearest8 > lastBoundary && nearest8 < totalBars) {
          snapped = nearest8;
        } else if (Math.abs(nearest4 - i) <= 2 && nearest4 > lastBoundary && nearest4 < totalBars) {
          snapped = nearest4;
        }
        if (snapped > lastBoundary) {
          boundaries.push(snapped);
          lastBoundary = snapped;
        }
      }
    }
  }

  // Force-split any section longer than MAX_SECTION_BARS
  const splitBoundaries = [boundaries[0]];
  for (let b = 1; b <= boundaries.length; b++) {
    const start = splitBoundaries[splitBoundaries.length - 1];
    const end   = b < boundaries.length ? boundaries[b] : totalBars;
    if ((end - start) > MAX_SECTION_BARS) {
      // Find the highest novelty point inside this oversized section
      // aligned to 4-bar or 8-bar grid
      let bestBar = -1, bestNov = -1;
      for (let j = start + SECTION_MIN_BARS; j <= end - SECTION_MIN_BARS; j++) {
        if (j % 4 === 0 && novelty[j] > bestNov) {
          bestNov = novelty[j];
          bestBar = j;
        }
      }
      if (bestBar > start) {
        splitBoundaries.push(bestBar);
      }
    }
    if (b < boundaries.length) {
      splitBoundaries.push(boundaries[b]);
    }
  }
  // Sort & dedupe after splitting
  const finalBoundaries = [...new Set(splitBoundaries)].sort((a, b) => a - b);

  // Repeat force-split pass until no section exceeds max (handles very long gaps)
  let changed = true;
  while (changed) {
    changed = false;
    for (let b = 0; b < finalBoundaries.length; b++) {
      const start = finalBoundaries[b];
      const end   = b + 1 < finalBoundaries.length ? finalBoundaries[b + 1] : totalBars;
      if ((end - start) > MAX_SECTION_BARS) {
        let bestBar = -1, bestNov = -1;
        for (let j = start + SECTION_MIN_BARS; j <= end - SECTION_MIN_BARS; j++) {
          if (j % 4 === 0 && novelty[j] > bestNov) {
            bestNov = novelty[j];
            bestBar = j;
          }
        }
        if (bestBar > start && !finalBoundaries.includes(bestBar)) {
          finalBoundaries.push(bestBar);
          finalBoundaries.sort((a, b) => a - b);
          changed = true;
          break; // restart scan
        }
      }
    }
  }

  // Fallback: 8-bar segments if detection produced nothing
  if (finalBoundaries.length < 2) {
    finalBoundaries.length = 0;
    for (let i = 0; i < totalBars; i += 8) finalBoundaries.push(i);
  }

  // ── 5. Compute per-section features ────────────────────────────────────
  const p25 = eSorted[Math.floor(eSorted.length * 0.25)];
  const p50 = eSorted[Math.floor(eSorted.length * 0.50)];
  const p75 = eSorted[Math.floor(eSorted.length * 0.75)];
  const p90 = eSorted[Math.floor(eSorted.length * 0.90)];

  // Bass ratio percentiles
  const bassRatios = smBass.map((b, i) => smTotal[i] > 0 ? b / smTotal[i] : 0);
  const sortedBR = [...bassRatios].sort((a, b) => a - b);
  const brP75 = sortedBR[Math.floor(sortedBR.length * 0.75)];

  // Treble ratio for spectral centroid
  const trebleRatios = smTreble.map((t, i) => smTotal[i] > 0 ? t / smTotal[i] : 0);

  // Build section feature objects
  const sectionFeats = [];
  for (let s = 0; s < finalBoundaries.length; s++) {
    const startBar = finalBoundaries[s];
    const endBar   = s + 1 < finalBoundaries.length ? finalBoundaries[s + 1] : totalBars;
    const startMs  = startBar < bars.length ? bars[startBar].start_ms : Math.round(durationMs);
    const endMs    = endBar < bars.length ? bars[endBar].start_ms : Math.round(durationMs);
    const numBars  = (endBar - startBar) || 1;

    // Average energies and spectral bands
    let secTotal = 0, secBass = 0, secMid = 0, secTreble = 0;
    for (let b = startBar; b < endBar; b++) {
      secTotal  += smTotal[b]  || 0;
      secBass   += smBass[b]   || 0;
      secMid    += smMid[b]    || 0;
      secTreble += smTreble[b] || 0;
    }
    secTotal  /= numBars;
    secBass   /= numBars;
    secMid    /= numBars;
    secTreble /= numBars;
    const bassRatio   = secTotal > 0 ? secBass / secTotal : 0;
    const trebleRatio = secTotal > 0 ? secTreble / secTotal : 0;

    // Energy gradient (slope) — linear regression of energy over bars
    let gradient = 0;
    if (numBars >= 2) {
      const barEnergies = [];
      for (let b = startBar; b < endBar; b++) barEnergies.push(smTotal[b] || 0);
      const n = barEnergies.length;
      const xMean = (n - 1) / 2;
      const yMean = barEnergies.reduce((a, b) => a + b, 0) / n;
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        num += (i - xMean) * (barEnergies[i] - yMean);
        den += (i - xMean) * (i - xMean);
      }
      gradient = den > 0 ? num / den : 0;
    }

    // Energy stability (coefficient of variation within section)
    let energyStdDev = 0;
    if (numBars >= 2) {
      let sq = 0;
      for (let b = startBar; b < endBar; b++) {
        const diff = (smTotal[b] || 0) - secTotal;
        sq += diff * diff;
      }
      energyStdDev = Math.sqrt(sq / numBars);
    }
    const energyCV = secTotal > 0 ? energyStdDev / secTotal : 0;

    // Spectral fingerprint for similarity matching
    const fingerprint = [secBass, secMid, secTreble];

    // Neighbour energies
    let nextEnergy = 0, prevEnergy = 0;
    if (s + 1 < finalBoundaries.length) {
      const nEnd = s + 2 < finalBoundaries.length ? finalBoundaries[s + 2] : totalBars;
      for (let b = finalBoundaries[s + 1]; b < nEnd; b++) nextEnergy += smTotal[b] || 0;
      nextEnergy /= (nEnd - finalBoundaries[s + 1]) || 1;
    }
    if (s > 0) {
      const pStart = finalBoundaries[s - 1];
      for (let b = pStart; b < startBar; b++) prevEnergy += smTotal[b] || 0;
      prevEnergy /= (startBar - pStart) || 1;
    }

    sectionFeats.push({
      startBar, endBar, startMs, endMs, numBars,
      energy: secTotal, bassRatio, trebleRatio,
      gradient, energyCV, fingerprint,
      nextEnergy, prevEnergy,
      position: startMs / durationMs,
      endPosition: endMs / durationMs,
      bassHigh: bassRatio > brP75,
    });
  }

  // ── 6. Section classification via spectral clustering ─────────────────
  //   Instead of absolute energy thresholds (which fail when energy is
  //   fairly uniform across the song), group sections by multi-feature
  //   similarity.  Similar-sounding sections cluster together; labels are
  //   assigned by cluster energy rank, position, and structural role.

  const allSectionEnergies = sectionFeats.map(f => f.energy);
  const energyMin = Math.min(...allSectionEnergies);
  const energyMax = Math.max(...allSectionEnergies);
  const energySpan = (energyMax - energyMin) || 1;
  const maxCV = Math.max(...sectionFeats.map(f => f.energyCV), 1e-9);

  /**
   * Distance between two sections using spectral shape (band ratios),
   * energy level, and internal dynamics (coefficient of variation).
   * Returns a value in roughly 0–1 range.
   */
  function sectionDist(i, j) {
    const fi = sectionFeats[i], fj = sectionFeats[j];
    // Spectral shape: Euclidean distance of band-energy ratios.
    // Using ratios (not absolute levels) captures timbral character
    // independent of overall loudness.
    const db = fi.bassRatio - fj.bassRatio;
    const dt = fi.trebleRatio - fj.trebleRatio;
    const iMid = Math.max(0, 1 - fi.bassRatio - fi.trebleRatio);
    const jMid = Math.max(0, 1 - fj.bassRatio - fj.trebleRatio);
    const dm = iMid - jMid;
    const shapeDist = Math.min(1, Math.sqrt(db * db + dm * dm + dt * dt) / 0.5);
    // Normalized energy difference (0–1)
    const eDist = Math.abs(fi.energy - fj.energy) / energySpan;
    // Dynamics difference (0–1)
    const cvDist = Math.abs(fi.energyCV - fj.energyCV) / maxCV;
    // Weighted: shape 40%, energy 40%, dynamics 20%
    return shapeDist * 0.40 + eDist * 0.40 + cvDist * 0.20;
  }

  const numSections = sectionFeats.length;
  const sectionLabels = new Array(numSections).fill('verse');

  if (numSections >= 3) {
    // ── Build pairwise distance matrix ──────────────────────────────────
    const distMx = [];
    for (let i = 0; i < numSections; i++) {
      distMx[i] = new Float64Array(numSections);
    }
    for (let i = 0; i < numSections; i++) {
      for (let j = i + 1; j < numSections; j++) {
        const d = sectionDist(i, j);
        distMx[i][j] = d;
        distMx[j][i] = d;
      }
    }

    // ── Adaptive merge threshold from distance distribution ─────────────
    // Find the largest *relative* gap in sorted pairwise distances.
    // This naturally finds the boundary between "same-type" distances
    // (small, within-cluster) and "different-type" distances (larger,
    // between-cluster), adapting to the song's contrast level.
    const allDists = [];
    for (let i = 0; i < numSections; i++) {
      for (let j = i + 1; j < numSections; j++) allDists.push(distMx[i][j]);
    }
    allDists.sort((a, b) => a - b);

    let mergeThreshold = 0.10; // fallback
    if (allDists.length >= 3) {
      let bestScore = 0;
      for (let i = 1; i < allDists.length; i++) {
        const gap = allDists[i] - allDists[i - 1];
        const relGap = allDists[i] > 0.01 ? gap / allDists[i] : 0;
        if (relGap > bestScore) {
          bestScore = relGap;
          mergeThreshold = (allDists[i - 1] + allDists[i]) / 2;
        }
      }
      mergeThreshold = Math.max(0.03, Math.min(0.30, mergeThreshold));
    }

    // ── Agglomerative clustering (average linkage) ──────────────────────
    // Start with each section in its own cluster; merge closest pair each
    // iteration until distance exceeds the adaptive threshold.
    let clusters = sectionFeats.map((_, i) => [i]);

    function avgLinkage(c1, c2) {
      let sum = 0, count = 0;
      for (const a of c1) {
        for (const b of c2) { sum += distMx[a][b]; count++; }
      }
      return count > 0 ? sum / count : Infinity;
    }

    while (clusters.length > 2) {
      let bestI = -1, bestJ = -1, bestDist = Infinity;
      for (let ci = 0; ci < clusters.length; ci++) {
        for (let cj = ci + 1; cj < clusters.length; cj++) {
          const d = avgLinkage(clusters[ci], clusters[cj]);
          if (d < bestDist) { bestDist = d; bestI = ci; bestJ = cj; }
        }
      }
      if (bestDist > mergeThreshold) break;
      clusters[bestI] = clusters[bestI].concat(clusters[bestJ]);
      clusters.splice(bestJ, 1);
    }

    // ── Compute cluster properties and rank by energy ───────────────────
    const clusterProps = clusters.map(members => ({
      members,
      avgEnergy: members.reduce((s, m) => s + sectionFeats[m].energy, 0) / members.length,
      avgBR: members.reduce((s, m) => s + sectionFeats[m].bassRatio, 0) / members.length,
      count: members.length,
    }));
    clusterProps.sort((a, b) => b.avgEnergy - a.avgEnergy);

    // ── Assign labels to clusters ───────────────────────────────────────
    if (clusterProps.length >= 3) {
      // Highest energy → chorus/drop; Lowest → verse; Middle → bridge if rare
      for (const idx of clusterProps[0].members) {
        sectionLabels[idx] = clusterProps[0].avgBR > brP75 ? 'drop' : 'chorus';
      }
      for (const idx of clusterProps[clusterProps.length - 1].members) {
        sectionLabels[idx] = 'verse';
      }
      for (let c = 1; c < clusterProps.length - 1; c++) {
        const label = clusterProps[c].count <= 2 ? 'bridge' : 'verse';
        for (const idx of clusterProps[c].members) sectionLabels[idx] = label;
      }
    } else if (clusterProps.length === 2) {
      // Two clusters: higher energy = chorus, lower = verse
      for (const idx of clusterProps[0].members) {
        sectionLabels[idx] = clusterProps[0].avgBR > brP75 ? 'drop' : 'chorus';
      }
      for (const idx of clusterProps[1].members) {
        sectionLabels[idx] = 'verse';
      }
    } else {
      // Single cluster — all sections too similar to separate.
      // Split by relative energy within the cluster.
      const midE = (energyMin + energyMax) / 2;
      for (let s = 0; s < numSections; s++) {
        sectionLabels[s] = sectionFeats[s].energy > midE ? 'chorus' : 'verse';
      }
    }

  } else {
    // Fewer than 3 sections — use simple energy percentiles
    for (let s = 0; s < numSections; s++) {
      const f = sectionFeats[s];
      if (f.energy >= p75) sectionLabels[s] = f.bassHigh ? 'drop' : 'chorus';
      else if (f.energy <= p25) sectionLabels[s] = 'verse';
      else sectionLabels[s] = f.energy >= p50 ? 'chorus' : 'verse';
    }
  }

  // ── 7. Position and gradient overrides ────────────────────────────────
  //   Intro/outro, buildup, breakdown depend on position and energy context
  //   rather than spectral similarity, so they override cluster labels.
  const gradients = sectionFeats.map(f => f.gradient);
  const gradMax = Math.max(...gradients.map(Math.abs), 1e-9);

  for (let s = 0; s < numSections; s++) {
    const f = sectionFeats[s];
    const normGrad = f.gradient / gradMax;

    // Intro: first section if moderate/low energy and short
    if (s === 0 && f.numBars <= MAX_INTRO_BARS && f.energy < p75) {
      sectionLabels[s] = 'intro';
    }
    // Outro: last section if moderate/low energy, fading/stable, and short
    else if (s === numSections - 1 && f.numBars <= MAX_INTRO_BARS &&
             f.energy < p75 && (normGrad < 0.1 || f.energy <= p50)) {
      sectionLabels[s] = 'outro';
    }
    // Buildup: rising gradient with next section significantly higher
    else if (normGrad > 0.2 && f.energy < p75 && f.nextEnergy > f.energy * 1.15) {
      sectionLabels[s] = 'buildup';
    }
    // Buildup: low energy leading into high-energy section
    else if (f.energy <= p50 && f.nextEnergy > p75) {
      sectionLabels[s] = 'buildup';
    }
    // Breakdown: very low energy after a high-energy section
    else if (f.energy <= p25 && f.prevEnergy > p75) {
      sectionLabels[s] = 'breakdown';
    }
    // Breakdown: very low energy with falling gradient (not intro/outro)
    else if (f.energy <= p25 && normGrad < -0.1 && s > 0 && s < numSections - 1) {
      sectionLabels[s] = 'breakdown';
    }
  }

  // ── 8. Sequential refinement ──────────────────────────────────────────
  //   After buildup → drop/chorus; after drop/chorus → breakdown if energy dips.
  for (let i = 0; i < numSections; i++) {
    // Buildup followed by high energy → ensure next is drop or chorus
    if (sectionLabels[i] === 'buildup' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      if (nf.energy >= p75 && nf.bassHigh && sectionLabels[i + 1] !== 'intro') {
        sectionLabels[i + 1] = 'drop';
      } else if (nf.energy >= p75 && sectionLabels[i + 1] === 'verse') {
        sectionLabels[i + 1] = 'chorus';
      }
    }
    // After drop → dramatic dip = breakdown
    if (sectionLabels[i] === 'drop' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      if (nf.energy <= p25 && sectionLabels[i + 1] !== 'outro') {
        sectionLabels[i + 1] = 'breakdown';
      }
    }
    // Chorus → dramatic energy dip = breakdown
    if (sectionLabels[i] === 'chorus' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      if (nf.energy <= p25 && nf.energy < sectionFeats[i].energy * 0.5 &&
          sectionLabels[i + 1] !== 'outro' && sectionLabels[i + 1] !== 'buildup') {
        sectionLabels[i + 1] = 'breakdown';
      }
    }
  }

  // ── 9. Bridge detection — spectrally unique verses ────────────────────
  //   A verse that is spectrally distant from the majority of verses is
  //   likely a bridge (different melody/instrumentation, one-off section).
  if (numSections >= 5) {
    const verseIdxs = [];
    for (let i = 0; i < numSections; i++) {
      if (sectionLabels[i] === 'verse') verseIdxs.push(i);
    }
    if (verseIdxs.length >= 2) {
      // Compute the centroid fingerprint of all verses
      const centroid = [0, 0, 0];
      for (const vi of verseIdxs) {
        centroid[0] += sectionFeats[vi].fingerprint[0];
        centroid[1] += sectionFeats[vi].fingerprint[1];
        centroid[2] += sectionFeats[vi].fingerprint[2];
      }
      centroid[0] /= verseIdxs.length;
      centroid[1] /= verseIdxs.length;
      centroid[2] /= verseIdxs.length;

      for (const vi of verseIdxs) {
        const fp = sectionFeats[vi].fingerprint;
        const dist = cosineDist(centroid, fp);
        const eDiff = Math.abs(sectionFeats[vi].energy -
          verseIdxs.reduce((s, v) => s + sectionFeats[v].energy, 0) / verseIdxs.length) / eRange;
        // Spectrally distant from the verse centroid → bridge
        if (dist > 0.10 || eDiff > 0.20) {
          sectionLabels[vi] = 'bridge';
        }
      }
    }
  }

  // ── 10. Build final sections array ────────────────────────────────────
  const sections = [];
  for (let s = 0; s < numSections; s++) {
    const f = sectionFeats[s];
    const label = sectionLabels[s];
    sections.push({
      start_ms: f.startMs,
      end_ms:   Math.min(f.endMs, durationMs),
      label,
      color:  SECTION_COLORS[label] || SECTION_COLORS.unknown,
      energy: parseFloat(f.energy.toFixed(4)),
      bars:   f.numBars,
    });
  }

  // ── 11. Conservative merge: same-label neighbours ─────────────────────
  //    Merge adjacent sections with the same label when both are short
  //    enough that the combined section stays within MAX_SECTION_BARS.
  if (sections.length === 0) return [];
  const merged = [sections[0]];
  for (let i = 1; i < sections.length; i++) {
    const prev = merged[merged.length - 1];
    const canMerge = sections[i].label === prev.label && (
      (prev.bars <= 4 && sections[i].bars <= 4) ||
      (prev.bars <= 8 && sections[i].bars <= 8 && prev.bars + sections[i].bars <= MAX_SECTION_BARS)
    );
    if (canMerge) {
      prev.end_ms = sections[i].end_ms;
      prev.bars  += sections[i].bars;
      prev.energy = (prev.energy + sections[i].energy) / 2;
    } else {
      merged.push(sections[i]);
    }
  }

  // Ensure sections cover the full track duration
  if (merged.length > 0) {
    merged[0].start_ms = 0;
    merged[merged.length - 1].end_ms = Math.round(durationMs);
  }

  return merged;
}

// ─── Core Analysis ──────────────────────────────────────────────────────────

/**
 * Analyze an audio file and return waveform + energy + section data.
 *
 * v3 improvements:
 *   - 3-band frequency split (bass / mid / treble) via IIR filters
 *   - True RMS peak calculation
 *   - Percentile-based normalisation (avoids transient spikes squashing waveform)
 *   - Configurable constants via opts.config
 *
 * @param {string} filePath  – absolute path to audio file
 * @param {object} opts
 * @param {number}  [opts.bpm]           – BPM (for beat grid & section detection)
 * @param {number}  [opts.beatgridPos]   – first beat offset in seconds
 * @param {function}[opts.onProgress]    – callback(percent 0-100)
 * @param {object}  [opts.config]        – override DEFAULTS (TARGET_PEAKS, DECODE_SAMPLE_RATE, etc.)
 * @returns {Promise<object>} analysis result
 */
function analyzeTrack(filePath, opts = {}) {
  const cfg = Object.assign({}, DEFAULTS, opts.config || {});

  return new Promise(async (resolve, reject) => {
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return reject(new Error(`File not found: ${filePath}`));
    }

    // Probe for metadata
    let probe;
    try {
      probe = await probeFile(filePath);
    } catch (e) {
      return reject(e);
    }

    const durationSec = probe.duration;
    if (durationSec <= 0) return reject(new Error('Cannot determine audio duration'));
    const durationMs = Math.round(durationSec * 1000);

    const DECODE_SAMPLE_RATE = cfg.DECODE_SAMPLE_RATE;
    const TARGET_PEAKS       = cfg.TARGET_PEAKS;
    const ENERGY_SEGMENT_MS  = cfg.ENERGY_SEGMENT_MS;

    // Spawn ffmpeg to decode to raw PCM (mono, 16-bit signed LE, downsampled)
    const ffmpegBin = getFfmpegPath();

    const ffArgs = [
      '-i', filePath,
      '-vn',                           // no video
      '-ac', '1',                      // mono
      '-ar', String(DECODE_SAMPLE_RATE),
      '-f', 's16le',                   // signed 16-bit little-endian
      '-acodec', 'pcm_s16le',
      'pipe:1',                        // output to stdout
    ];
    const ffmpeg = spawn(ffmpegBin, ffArgs, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    const totalSamples = Math.ceil(durationSec * DECODE_SAMPLE_RATE);
    const samplesPerPeak = Math.max(1, Math.floor(totalSamples / TARGET_PEAKS));
    const samplesPerEnergy = Math.max(1, Math.floor((ENERGY_SEGMENT_MS / 1000) * DECODE_SAMPLE_RATE));

    // ─── IIR filter setup for 3-band split ──────────────────────────────
    const bassAlpha   = lpCoeff(200,  DECODE_SAMPLE_RATE);   // bass < 200 Hz
    const midLpAlpha  = lpCoeff(2000, DECODE_SAMPLE_RATE);   // mid  200–2000 Hz
    const midHpAlpha  = lpCoeff(200,  DECODE_SAMPLE_RATE);
    const trebAlpha   = lpCoeff(2000, DECODE_SAMPLE_RATE);   // treble > 2000 Hz

    const bassState   = iirState();
    const midLpState  = iirState();
    const midHpState  = iirState();
    const trebState   = iirState();

    // Accumulators — waveform peaks
    const peaks = [];
    let peakMax = 0, peakRmsAccum = 0, peakSampleCount = 0;
    let peakBassMax = 0, peakMidMax = 0, peakTrebMax = 0;

    // Accumulators — energy segments
    const energySegments = [];
    let energyAccum = 0, energySampleCount = 0;
    let eBassAccum = 0, eMidAccum = 0, eTrebAccum = 0;

    let totalSamplesRead = 0;
    let leftover = Buffer.alloc(0);

    ffmpeg.stdout.on('data', (chunk) => {
      // Prepend any leftover byte from last chunk
      let buf = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;
      const usable = buf.length - (buf.length % BYTES_PER_SAMPLE);
      if (buf.length > usable) {
        leftover = buf.subarray(usable);
        buf = buf.subarray(0, usable);
      } else {
        leftover = Buffer.alloc(0);
      }

      for (let i = 0; i < buf.length; i += BYTES_PER_SAMPLE) {
        const sample = buf.readInt16LE(i);
        const norm = sample / 32768;        // normalised −1..1
        const absVal = Math.abs(norm);
        totalSamplesRead++;

        // ── 3-band split ──
        const bass   = lpFilter(norm, bassAlpha, bassState);
        const midLp  = lpFilter(norm, midLpAlpha, midLpState);
        const midHp  = hpFilter(midLp, midHpAlpha, midHpState);
        const mid    = midHp;
        const treble = hpFilter(norm, trebAlpha, trebState);

        const absBass = Math.abs(bass);
        const absMid  = Math.abs(mid);
        const absTreb = Math.abs(treble);

        // ── Waveform peaks (true RMS + band maxes) ──
        if (absVal > peakMax) peakMax = absVal;
        peakRmsAccum += norm * norm;        // true RMS: sum of squares
        peakSampleCount++;
        if (absBass > peakBassMax)  peakBassMax  = absBass;
        if (absMid  > peakMidMax)   peakMidMax   = absMid;
        if (absTreb > peakTrebMax)  peakTrebMax  = absTreb;

        if (peakSampleCount >= samplesPerPeak) {
          peaks.push({
            peak: peakMax,
            rms:  Math.sqrt(peakRmsAccum / peakSampleCount),
            bass: peakBassMax,
            mid:  peakMidMax,
            treble: peakTrebMax,
          });
          peakMax = 0; peakRmsAccum = 0; peakSampleCount = 0;
          peakBassMax = 0; peakMidMax = 0; peakTrebMax = 0;
        }

        // ── Energy levels (per-band RMS) ──
        energyAccum += norm * norm;
        eBassAccum  += bass * bass;
        eMidAccum   += mid * mid;
        eTrebAccum  += treble * treble;
        energySampleCount++;

        if (energySampleCount >= samplesPerEnergy) {
          const timeMs = Math.round(((totalSamplesRead - energySampleCount) / DECODE_SAMPLE_RATE) * 1000);
          energySegments.push({
            time_ms: timeMs,
            energy:  parseFloat(Math.sqrt(energyAccum  / energySampleCount).toFixed(4)),
            bass:    parseFloat(Math.sqrt(eBassAccum   / energySampleCount).toFixed(4)),
            mid:     parseFloat(Math.sqrt(eMidAccum    / energySampleCount).toFixed(4)),
            treble:  parseFloat(Math.sqrt(eTrebAccum   / energySampleCount).toFixed(4)),
          });
          energyAccum = 0; eBassAccum = 0; eMidAccum = 0; eTrebAccum = 0;
          energySampleCount = 0;
        }
      }

      // Progress callback
      if (opts.onProgress && totalSamples > 0) {
        const pct = Math.min(100, Math.round((totalSamplesRead / totalSamples) * 100));
        opts.onProgress(pct);
      }
    });

    ffmpeg.on('error', (err) => {
      reject(new Error(`ffmpeg error: ${err.message}`));
    });

    ffmpeg.stdout.on('end', () => {
      // Flush remaining peak bucket
      if (peakSampleCount > 0) {
        peaks.push({
          peak: peakMax,
          rms:  Math.sqrt(peakRmsAccum / peakSampleCount),
          bass: peakBassMax,
          mid:  peakMidMax,
          treble: peakTrebMax,
        });
      }
      // Flush remaining energy bucket
      if (energySampleCount > 0) {
        const timeMs = Math.round(((totalSamplesRead - energySampleCount) / DECODE_SAMPLE_RATE) * 1000);
        energySegments.push({
          time_ms: timeMs,
          energy:  parseFloat(Math.sqrt(energyAccum  / energySampleCount).toFixed(4)),
          bass:    parseFloat(Math.sqrt(eBassAccum   / energySampleCount).toFixed(4)),
          mid:     parseFloat(Math.sqrt(eMidAccum    / energySampleCount).toFixed(4)),
          treble:  parseFloat(Math.sqrt(eTrebAccum   / energySampleCount).toFixed(4)),
        });
      }

      // ── Percentile-based normalisation ──
      // Use Nth percentile instead of global max to avoid transient spikes
      // squashing the waveform.
      const normPct = Math.max(1, Math.min(100, cfg.NORMALIZE_PERCENTILE));
      const peakVals = peaks.map(p => p.peak).sort((a, b) => a - b);
      const pctIdx = Math.min(peakVals.length - 1, Math.floor(peakVals.length * normPct / 100));
      const normRef = peakVals[pctIdx] || 1;

      const waveformPeaks = peaks.map((p) => ({
        peak:   parseFloat(Math.min(1, p.peak   / normRef).toFixed(4)),
        rms:    parseFloat(Math.min(1, p.rms    / normRef).toFixed(4)),
        bass:   parseFloat(Math.min(1, p.bass   / normRef).toFixed(4)),
        mid:    parseFloat(Math.min(1, p.mid    / normRef).toFixed(4)),
        treble: parseFloat(Math.min(1, p.treble / normRef).toFixed(4)),
      }));

      // Generate fluid beat grid from audio energy + BPM guide
      const bpm = opts.bpm || 0;
      const firstBeatMs = (opts.beatgridPos || 0) * 1000;
      const beats = bpm > 0
        ? detectBeats(energySegments, bpm, durationMs, firstBeatMs)
        : [];

      // Detect structural sections using fluid beats
      const sections = detectSections(energySegments, beats, durationMs, bpm, cfg, firstBeatMs);

      resolve({
        waveform_peaks: waveformPeaks,
        energy_levels: energySegments,
        beats,
        sections,
        sample_rate: probe.sample_rate,
        channels: probe.channels,
        duration_ms: durationMs,
        peak_count: waveformPeaks.length,
        analysis_version: ANALYSIS_VERSION,
      });
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = { analyzeTrack, checkFfmpeg, getFfmpegVersion, getFfprobeVersion, probeFile, detectSections, detectBeats, beatsToBarBoundaries, ANALYSIS_VERSION, SECTION_COLORS, DEFAULTS };
