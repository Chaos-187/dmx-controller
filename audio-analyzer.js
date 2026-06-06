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

const ANALYSIS_VERSION = 14;
const DEFAULTS = {
  TARGET_PEAKS:         2000,     // waveform resolution tier from app settings (see peaks/sec calc below)
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
 * 3. Estimate local tempo from onset intervals; detect tempo changes.
 * 4. If tempo varies >3%, build an adaptive grid with per-region BPM.
 *    Otherwise use the global BPM for a uniform grid (guided by anchors).
 * 5. Snap grid beats toward detected onsets with weighted blending.
 * 6. Return actual beat times (not evenly spaced).
 *
 * @param {Array}  energySegments  – [{time_ms, bass, energy, ...}, ...]
 * @param {number} bpm             – reference BPM from metadata
 * @param {number} durationMs      – track duration in ms
 * @param {number} [firstBeatMs=0] – first beat hint from metadata
 * @param {Array}  [anchorPoints]  – [{pos_ms, bpm?}, ...] multi-point beatgrid anchors
 * @returns {number[]} beat times in ms (sorted)
 */
function detectBeats(energySegments, bpm, durationMs, firstBeatMs = 0, anchorPoints = []) {
  if (!energySegments.length || bpm <= 0) return [];

  const expectedBeatMs = 60000 / bpm;

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
    const threshold = localMean + localStd * 1.2;

    if (onsets[i].strength > threshold && onsets[i].strength > 0) {
      const isLocalMax =
        (i === 0 || onsets[i].strength >= onsets[i - 1].strength) &&
        (i === onsets.length - 1 || onsets[i].strength >= onsets[i + 1].strength);
      if (isLocalMax) {
        onsetPeaks.push({ time_ms: onsets[i].time_ms, strength: onsets[i].strength });
      }
    }
  }

  // ── 3. Local tempo estimation from onset intervals ────────────────
  //   Compute inter-onset intervals (IOIs), filter to plausible beat
  //   intervals, then estimate BPM in overlapping windows.  If the
  //   local BPM varies by more than 3% across the track, we have a
  //   tempo-changing song and will use an adaptive grid.
  const minIOI = expectedBeatMs * 0.6;
  const maxIOI = expectedBeatMs * 2.5;

  const iois = []; // { time_ms, interval, impliedBpm }
  for (let i = 1; i < onsetPeaks.length; i++) {
    const dt = onsetPeaks[i].time_ms - onsetPeaks[i - 1].time_ms;
    if (dt >= minIOI && dt <= maxIOI) {
      // Quantize to nearest beat subdivision (1 or 2 beats)
      let iBpm;
      if (dt < expectedBeatMs * 0.8) {
        // Likely half-beat interval: this is 2× BPM
        iBpm = 60000 / (dt * 2);
      } else if (dt > expectedBeatMs * 1.6) {
        // Likely 2-beat interval: this is 0.5× BPM
        iBpm = 60000 / (dt / 2);
      } else {
        iBpm = 60000 / dt;
      }
      iois.push({ time_ms: onsetPeaks[i].time_ms, interval: dt, impliedBpm: iBpm });
    }
  }

  // Sliding window local BPM estimation
  const tempoWindowMs = Math.max(10000, expectedBeatMs * 32); // ~8 bars or 10s
  const tempoStepMs   = tempoWindowMs / 2;
  const localTempos   = []; // { time_ms, bpm }

  for (let t = 0; t < durationMs; t += tempoStepMs) {
    const wStart = t;
    const wEnd   = t + tempoWindowMs;
    const inWindow = iois.filter(x => x.time_ms >= wStart && x.time_ms < wEnd);
    if (inWindow.length >= 3) {
      // Median BPM (robust to outliers)
      const bpms = inWindow.map(x => x.impliedBpm).sort((a, b) => a - b);
      const median = bpms[Math.floor(bpms.length / 2)];
      localTempos.push({ time_ms: t + tempoWindowMs / 2, bpm: median });
    }
  }

  // Determine if tempo varies significantly
  let useAdaptiveGrid = false;
  let tempoRegions = []; // { startMs, endMs, bpm }

  if (anchorPoints && anchorPoints.length >= 2) {
    // Multi-anchor points provided (e.g. from VDJ beatgrid Pois)
    // Infer local BPM between consecutive anchors
    for (let i = 0; i < anchorPoints.length - 1; i++) {
      const ap = anchorPoints[i];
      const bp = anchorPoints[i + 1];
      const dtMs = bp.pos_ms - ap.pos_ms;
      const regionBpm = ap.bpm || bpm;
      const beatsInRegion = Math.round(dtMs / (60000 / regionBpm));
      if (beatsInRegion > 0) {
        const actualBeatMs = dtMs / beatsInRegion;
        tempoRegions.push({
          startMs: ap.pos_ms,
          endMs:   bp.pos_ms,
          bpm:     60000 / actualBeatMs,
        });
      }
    }
    // Extend last region to end of track
    if (tempoRegions.length > 0) {
      tempoRegions[tempoRegions.length - 1].endMs = durationMs;
      useAdaptiveGrid = tempoRegions.some(r => Math.abs(r.bpm - bpm) / bpm > 0.03);
    }
  } else if (localTempos.length >= 3) {
    // Audio-estimated local tempos — check for variance
    const localBpms = localTempos.map(x => x.bpm);
    const bpmMin = Math.min(...localBpms);
    const bpmMax = Math.max(...localBpms);
    const bpmMid = (bpmMax + bpmMin) / 2;
    const variance = (bpmMax - bpmMin) / bpmMid;

    if (variance > 0.03) {
      useAdaptiveGrid = true;
      // Build tempo regions from local estimates
      // Smooth local tempos with 3-point median for stability
      const smoothed = localTempos.map((lt, idx) => {
        const lo = Math.max(0, idx - 1);
        const hi = Math.min(localTempos.length - 1, idx + 1);
        const vals = [];
        for (let k = lo; k <= hi; k++) vals.push(localTempos[k].bpm);
        vals.sort((a, b) => a - b);
        return { time_ms: lt.time_ms, bpm: vals[Math.floor(vals.length / 2)] };
      });

      for (let i = 0; i < smoothed.length; i++) {
        tempoRegions.push({
          startMs: i === 0 ? 0 : smoothed[i].time_ms - tempoStepMs / 2,
          endMs:   i === smoothed.length - 1 ? durationMs : smoothed[i].time_ms + tempoStepMs / 2,
          bpm:     smoothed[i].bpm,
        });
      }
    }
  }

  // ── 4. Build beat grid (adaptive or uniform) ─────────────────────
  const phase = firstBeatMs >= 0 ? firstBeatMs : 0;
  const gridBeats = [];

  if (useAdaptiveGrid && tempoRegions.length > 0) {
    // Adaptive grid: walk through each tempo region
    // Start with pre-beat phase using first region's BPM
    const firstBpm = tempoRegions[0].bpm;
    const firstBeatInterval = 60000 / firstBpm;

    if (phase > firstBeatInterval) {
      let t = phase - firstBeatInterval;
      const preBeats = [];
      while (t >= 0) {
        preBeats.push(t);
        t -= firstBeatInterval;
      }
      preBeats.reverse();
      for (const bt of preBeats) gridBeats.push(bt);
    }

    // Walk forward, switching BPM at region boundaries
    let t = phase;
    while (t < durationMs) {
      gridBeats.push(t);
      // Find which tempo region we're in
      let regionBpm = bpm; // fallback
      for (const r of tempoRegions) {
        if (t >= r.startMs && t < r.endMs) {
          regionBpm = r.bpm;
          break;
        }
      }
      t += 60000 / regionBpm;
    }
  } else {
    // Uniform grid (original behavior)
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
    while (phase + gridBeats.length * expectedBeatMs < durationMs || gridBeats.length === 0) {
      // Re-walk forward properly
      break; // handled below
    }
    // Walk forward through the track
    let gTime = phase;
    while (gTime < durationMs) {
      gridBeats.push(gTime);
      gTime += expectedBeatMs;
    }
  }

  // Dedupe and sort (adaptive grid may have overlap from pre-beats)
  const uniqueGrid = [...new Set(gridBeats.map(b => Math.round(b * 10) / 10))].sort((a, b) => a - b);

  // ── 5. Snap grid toward nearest onset with weighted blending ──────
  const tolerance = expectedBeatMs * 0.15;
  const fluidBeats = [];
  let onsetIdx = 0;

  for (let bi = 0; bi < uniqueGrid.length; bi++) {
    const expected = uniqueGrid[bi];
    // Use local BPM for spacing check
    let localBeatMs = expectedBeatMs;
    if (useAdaptiveGrid) {
      for (const r of tempoRegions) {
        if (expected >= r.startMs && expected < r.endMs) {
          localBeatMs = 60000 / r.bpm;
          break;
        }
      }
    }
    const localTolerance = localBeatMs * 0.15;

    // Advance onset pointer
    while (onsetIdx < onsetPeaks.length && onsetPeaks[onsetIdx].time_ms < expected - localTolerance) {
      onsetIdx++;
    }

    // Find the strongest onset within tolerance
    let bestOnset = null;
    let bestScore = 0;
    for (let oi = Math.max(0, onsetIdx - 1); oi < onsetPeaks.length; oi++) {
      const o = onsetPeaks[oi];
      const dist = Math.abs(o.time_ms - expected);
      if (dist > localTolerance) {
        if (o.time_ms > expected + localTolerance) break;
        continue;
      }
      const proximityWeight = 1 - dist / localTolerance;
      const score = o.strength * proximityWeight;
      if (score > bestScore) {
        bestScore = score;
        bestOnset = o;
      }
    }

    let finalTime;
    if (bestOnset) {
      const dist = Math.abs(bestOnset.time_ms - expected);
      const blendWeight = 0.5 * (1 - dist / localTolerance);
      finalTime = expected + (bestOnset.time_ms - expected) * blendWeight;
    } else {
      finalTime = expected;
    }

    // Enforce minimum spacing: at least 75% of local beat interval
    const prevBeat = fluidBeats.length > 0 ? fluidBeats[fluidBeats.length - 1] : -Infinity;
    if (finalTime - prevBeat >= localBeatMs * 0.75) {
      fluidBeats.push(Math.round(finalTime));
    } else if (expected - prevBeat >= localBeatMs * 0.75) {
      fluidBeats.push(Math.round(expected));
    }
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
  const MAX_SECTION_BARS    = 32;   // force-split any section longer than this
  const MAX_INTRO_BARS     = 16;   // intro/outro can't exceed this many bars
  const MAX_BREAKDOWN_BARS = 12;   // breakdowns are transitional; longer sections are likely verses

  if (!energySegments.length || !beats.length || bpm <= 0) return [];

  // ── Derive fluid bars from actual beat positions ──────────────────────
  // Each bar = 4 consecutive beats.  Bar timing flexes with the audio.
  const bars = beatsToBarBoundaries(beats, durationMs);
  const totalBars = bars.length;
  if (totalBars < SECTION_MIN_BARS * 2) return [];

  // ── Grid phase from beatgrid_pos ──────────────────────────────────────
  //   The DJ's "bar 1" (firstBeatMs) tells us where phrases really start.
  //   Align the 4/8-bar grid to that position so boundaries land on real
  //   musical phrase boundaries, not arbitrary multiples of 4 from bar 0.
  let gridPhase = 0;
  if (firstBeatMs > 0) {
    let closestBar = 0, closestDist = Infinity;
    for (let b = 0; b < totalBars; b++) {
      const dist = Math.abs(bars[b].start_ms - firstBeatMs);
      if (dist < closestDist) { closestDist = dist; closestBar = b; }
    }
    gridPhase = closestBar % 4;  // offset so closestBar is on-grid
  }

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
  // Extended bands (fallback to bass/treble for older analysis data)
  const has5Bands = energySegments[0] && energySegments[0].sub_bass !== undefined;
  const barSubBass  = has5Bands ? barAverages('sub_bass')  : barBass.map(v => v * 0.4);
  const barHiMid    = has5Bands ? barAverages('upper_mid') : barTreble.map(v => v * 0.5);

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
  const smSubBass = smooth(barSubBass, 1);
  const smHiMid   = smooth(barHiMid,   1);

  // ── 2b. Per-bar spectral flux & onset density ─────────────────────────
  //   Spectral flux: average positive frame-to-frame band energy change
  //   Onset density: count of significant energy increases per second
  const barSpFlux = [];
  const barOnsetDens = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bars[bar].start_ms;
    const barEnd   = bars[bar].end_ms;
    const inBar = energySegments.filter(s => s.time_ms >= barStart && s.time_ms < barEnd);
    let flux = 0, onsets = 0;
    for (let fi = 1; fi < inBar.length; fi++) {
      const prev = inBar[fi - 1], curr = inBar[fi];
      flux += Math.max(0, curr.bass - prev.bass)
            + Math.max(0, curr.mid  - prev.mid)
            + Math.max(0, curr.treble - prev.treble);
      // Onset: significant energy increase between frames
      if ((curr.energy - prev.energy) > 0.01) onsets++;
    }
    barSpFlux.push(inBar.length > 1 ? flux / (inBar.length - 1) : 0);
    const barDurMs = barEnd - barStart;
    barOnsetDens.push(barDurMs > 0 ? (onsets / barDurMs) * 1000 : 0);
  }
  const smFlux   = smooth(barSpFlux, 1);
  const smOnsets = smooth(barOnsetDens, 1);

  // ── 3. Multi-scale novelty ────────────────────────────────────────────
  //   a) Short-term: absolute energy difference bar-to-bar
  //   b) Phrase-level (4-bar): compare bar i energy to mean of bars [i-phraseK .. i-1]
  //      vs mean of bars [i .. i+phraseK-1]
  //   c) Long phrase (8-bar): same as (b) but with 8-bar context
  //   d) Spectral: cosine distance of 5-band vectors
  //   e) Spectral flux change: bar-to-bar flux difference

  const phraseK = Math.min(4, Math.floor(totalBars / 4)); // 4-bar context each side
  const phraseL = Math.min(8, Math.floor(totalBars / 4)); // 8-bar context each side

  function meanRange(arr, lo, hi) {
    lo = Math.max(0, lo);
    hi = Math.min(arr.length - 1, hi);
    if (lo > hi) return 0;
    let s = 0;
    for (let i = lo; i <= hi; i++) s += arr[i];
    return s / (hi - lo + 1);
  }

  function cosineDistN(a, b) {
    let dot = 0, magA = 0, magB = 0;
    for (let k = 0; k < a.length; k++) {
      dot  += a[k] * b[k];
      magA += a[k] * a[k];
      magB += b[k] * b[k];
    }
    magA = Math.sqrt(magA) || 1e-9;
    magB = Math.sqrt(magB) || 1e-9;
    return 1 - (dot / (magA * magB));
  }

  // Energy range for normalising magnitude differences
  const eSorted = [...smTotal].sort((a, b) => a - b);
  const eMin = eSorted[Math.floor(eSorted.length * 0.05)] || 0;
  const eMax = eSorted[Math.floor(eSorted.length * 0.95)] || 1;
  const eRange = (eMax - eMin) || 1;

  // Flux range
  const fSorted = [...smFlux].sort((a, b) => a - b);
  const fRange = (fSorted[Math.floor(fSorted.length * 0.95)] - fSorted[Math.floor(fSorted.length * 0.05)]) || 1;

  const novelty = new Float64Array(totalBars);
  for (let i = 1; i < totalBars; i++) {
    // Short-term magnitude change (normalised)
    const shortDiff = Math.abs(smTotal[i] - smTotal[i - 1]) / eRange;

    // 4-bar phrase-level contrast
    const leftMean  = meanRange(smTotal, i - phraseK, i - 1);
    const rightMean = meanRange(smTotal, i, i + phraseK - 1);
    const phraseDiff = Math.abs(rightMean - leftMean) / eRange;

    // 8-bar phrase-level contrast (captures larger structural changes)
    const leftMeanL  = meanRange(smTotal, i - phraseL, i - 1);
    const rightMeanL = meanRange(smTotal, i, i + phraseL - 1);
    const phraseDiffL = Math.abs(rightMeanL - leftMeanL) / eRange;

    // 5-band spectral change (cosine distance)
    const vecPrev = [smSubBass[i-1], smBass[i-1], smMid[i-1], smHiMid[i-1], smTreble[i-1]];
    const vecCurr = [smSubBass[i],   smBass[i],   smMid[i],   smHiMid[i],   smTreble[i]];
    const specDiff = cosineDistN(vecPrev, vecCurr);

    // 4-bar phrase-level spectral contrast
    const lVec = [meanRange(smSubBass, i-phraseK, i-1), meanRange(smBass, i-phraseK, i-1),
                  meanRange(smMid, i-phraseK, i-1), meanRange(smHiMid, i-phraseK, i-1),
                  meanRange(smTreble, i-phraseK, i-1)];
    const rVec = [meanRange(smSubBass, i, i+phraseK-1), meanRange(smBass, i, i+phraseK-1),
                  meanRange(smMid, i, i+phraseK-1), meanRange(smHiMid, i, i+phraseK-1),
                  meanRange(smTreble, i, i+phraseK-1)];
    const phraseSpec = cosineDistN(lVec, rVec);

    // 8-bar phrase-level spectral contrast
    const lVecL = [meanRange(smSubBass, i-phraseL, i-1), meanRange(smBass, i-phraseL, i-1),
                   meanRange(smMid, i-phraseL, i-1), meanRange(smHiMid, i-phraseL, i-1),
                   meanRange(smTreble, i-phraseL, i-1)];
    const rVecL = [meanRange(smSubBass, i, i+phraseL-1), meanRange(smBass, i, i+phraseL-1),
                   meanRange(smMid, i, i+phraseL-1), meanRange(smHiMid, i, i+phraseL-1),
                   meanRange(smTreble, i, i+phraseL-1)];
    const phraseSpecL = cosineDistN(lVecL, rVecL);

    // Spectral flux change (normalised)
    const fluxDiff = Math.abs(smFlux[i] - smFlux[i - 1]) / fRange;

    // Weighted combination: 4-bar phrase is primary, 8-bar supplements
    novelty[i] = shortDiff   * 0.10
               + phraseDiff  * 0.25
               + phraseDiffL * 0.10
               + specDiff    * 0.10
               + phraseSpec  * 0.20
               + phraseSpecL * 0.10
               + fluxDiff    * 0.15;
  }

  // Adaptive threshold
  let novSum = 0, novSq = 0;
  for (let i = 0; i < totalBars; i++) { novSum += novelty[i]; novSq += novelty[i] * novelty[i]; }
  const novMean = novSum / totalBars;
  const novStd  = Math.sqrt(novSq / totalBars - novMean * novMean);
  const novThreshold = novMean + SECTION_SENSITIVITY * novStd;

  // ── 4. Pick boundaries using greedy strongest-first approach ────────
  //   Instead of scanning left-to-right (which misses strong boundaries
  //   near weaker ones that were picked first), collect ALL candidate
  //   peaks above threshold, sort by novelty strength descending, then
  //   greedily add them enforcing minimum spacing.  This ensures the
  //   strongest transitions in the track always become boundaries.

  // 4a. Detect dramatic energy transitions (>30% of range in 1-2 bars)
  //     These get an extra novelty boost so they're always picked.
  //     Also collect "energy cliffs" — mandatory boundaries that are so
  //     dramatic they must become section boundaries regardless of grid.
  // Use RAW (unsmoothed) bar energy for cliff/dramatic detection —
  // smoothing dilutes single-bar jumps so cliffs go undetected.
  const dramaticThreshold = eRange * 0.25;
  const cliffThreshold    = eRange * 0.30; // mandatory boundary
  const energyCliffs = new Set();
  for (let i = 1; i < totalBars; i++) {
    // Raw (unsmoothed) single-bar jump
    const rawDiff = Math.abs(barTotal[i] - barTotal[i - 1]);
    // Smoothed for novelty boost (less aggressive)
    const smDiff = Math.abs(smTotal[i] - smTotal[i - 1]);
    const bestDiff = Math.max(rawDiff, smDiff);
    if (bestDiff > dramaticThreshold) {
      novelty[i] = Math.max(novelty[i], novelty[i] + bestDiff / eRange * 0.5);
    }
    // Energy cliff: raw single-bar change > 30% of range → mandatory boundary
    // Verify it's a STRUCTURAL change by comparing wider context windows
    // (3 bars on each side, EXCLUDING the immediate cliff pair to avoid
    // contamination from transient dips/spikes)
    if (rawDiff > cliffThreshold) {
      const lookBack = Math.max(0, i - 4);  // up to 3 bars before i-1
      const lookAhead = Math.min(totalBars - 1, i + 3);
      let sumBefore = 0, cntBefore = 0;
      for (let j = lookBack; j < i - 1; j++) { sumBefore += barTotal[j]; cntBefore++; }
      let sumAfter = 0, cntAfter = 0;
      for (let j = i + 1; j <= lookAhead; j++) { sumAfter += barTotal[j]; cntAfter++; }
      const widerBefore = cntBefore > 0 ? sumBefore / cntBefore : barTotal[Math.max(0, i - 1)];
      const widerAfter = cntAfter > 0 ? sumAfter / cntAfter : barTotal[i];
      const widerDiff = Math.abs(widerAfter - widerBefore);
      if (widerDiff > cliffThreshold * 0.5) {
        energyCliffs.add(i);
      }
    }
    // Also check 2-bar transitions
    if (i >= 2) {
      const rawDiff2 = Math.abs(barTotal[i] - barTotal[i - 2]);
      const smDiff2  = Math.abs(smTotal[i] - smTotal[i - 2]);
      const bestDiff2 = Math.max(rawDiff2, smDiff2);
      if (bestDiff2 > dramaticThreshold * 1.5) {
        novelty[i] = Math.max(novelty[i], novelty[i] + bestDiff2 / eRange * 0.3);
      }
      // 2-bar cliff: also require structural context change
      if (rawDiff2 > cliffThreshold * 1.3) {
        const lookBack2 = Math.max(0, i - 5);
        const lookAhead2 = Math.min(totalBars - 1, i + 3);
        let sumB2 = 0, cntB2 = 0;
        for (let j = lookBack2; j < i - 2; j++) { sumB2 += barTotal[j]; cntB2++; }
        let sumA2 = 0, cntA2 = 0;
        for (let j = i + 1; j <= lookAhead2; j++) { sumA2 += barTotal[j]; cntA2++; }
        const wb2 = cntB2 > 0 ? sumB2 / cntB2 : barTotal[Math.max(0, i - 2)];
        const wa2 = cntA2 > 0 ? sumA2 / cntA2 : barTotal[i];
        if (Math.abs(wa2 - wb2) > cliffThreshold * 0.6) {
          energyCliffs.add(i);
        }
      }
    }
  }

  // Recompute threshold after boosting
  let novSum2 = 0, novSq2 = 0;
  for (let i = 0; i < totalBars; i++) { novSum2 += novelty[i]; novSq2 += novelty[i] * novelty[i]; }
  const novMean2 = novSum2 / totalBars;
  const novStd2  = Math.sqrt(novSq2 / totalBars - novMean2 * novMean2);
  const novThresholdFinal = novMean2 + SECTION_SENSITIVITY * novStd2;

  // 4b. Collect ALL candidate local maxima above threshold
  const candidates = []; // { bar, novelty }
  for (let i = 1; i < totalBars; i++) {
    if (novelty[i] < novThresholdFinal) continue;
    // Local peak check: must be highest within ±2 bars
    const lo = Math.max(1, i - 2);
    const hi = Math.min(totalBars - 1, i + 2);
    let isLocalMax = true;
    for (let j = lo; j <= hi; j++) {
      if (j !== i && novelty[j] > novelty[i]) { isLocalMax = false; break; }
    }
    if (isLocalMax) {
      candidates.push({ bar: i, nov: novelty[i] });
    }
  }

  // 4c. Sort candidates by novelty strength (strongest first)
  candidates.sort((a, b) => b.nov - a.nov);

  // 4d. Greedily add boundaries, enforcing minimum spacing
  //   Start with energy cliffs as mandatory (unsnapped) boundaries.
  const boundarySet = new Set([0]);
  for (const cliff of energyCliffs) {
    if (cliff > 0 && cliff < totalBars) boundarySet.add(cliff);
  }

  // Phase-aligned snap helpers
  function snapToGrid4(bar) {
    // Snap to nearest bar where (bar - gridPhase) % 4 == 0
    const offset = bar - gridPhase;
    return Math.round(offset / 4) * 4 + gridPhase;
  }
  function snapToGrid8(bar) {
    const offset = bar - gridPhase;
    return Math.round(offset / 8) * 8 + gridPhase;
  }

  for (const cand of candidates) {
    // Check minimum spacing from all existing boundaries
    let tooClose = false;
    for (const existing of boundarySet) {
      if (Math.abs(cand.bar - existing) < SECTION_MIN_BARS) {
        tooClose = true;
        break;
      }
    }
    if (!tooClose) {
      // Don't snap if this bar is an energy cliff (keep exact position)
      if (energyCliffs.has(cand.bar)) {
        boundarySet.add(cand.bar);
        continue;
      }
      // Snap to nearest phrase-aligned grid (respecting beatgrid phase)
      const rel8 = snapToGrid8(cand.bar);
      const rel4 = snapToGrid4(cand.bar);
      let snapped = cand.bar;
      if (Math.abs(rel8 - cand.bar) <= 2 && rel8 > 0 && rel8 < totalBars) {
        snapped = rel8;
      } else if (Math.abs(rel4 - cand.bar) <= 2 && rel4 > 0 && rel4 < totalBars) {
        snapped = rel4;
      }
      // Verify snapped position doesn't conflict
      let snapConflict = false;
      for (const existing of boundarySet) {
        if (existing !== 0 && Math.abs(snapped - existing) < SECTION_MIN_BARS) {
          snapConflict = true;
          break;
        }
      }
      boundarySet.add(snapConflict ? cand.bar : snapped);
    }
  }

  const finalBoundaries = [...boundarySet].sort((a, b) => a - b);

  // Force-split any section longer than MAX_SECTION_BARS
  let changed = true;
  while (changed) {
    changed = false;
    for (let b = 0; b < finalBoundaries.length; b++) {
      const start = finalBoundaries[b];
      const end   = b + 1 < finalBoundaries.length ? finalBoundaries[b + 1] : totalBars;
      if ((end - start) > MAX_SECTION_BARS) {
        // Find highest novelty on phase-aligned 8-bar or 4-bar grid
        let bestBar = -1, bestNov = -1;
        for (let j = start + SECTION_MIN_BARS; j <= end - SECTION_MIN_BARS; j++) {
          if ((j - gridPhase) % 8 === 0 && novelty[j] > bestNov) {
            bestNov = novelty[j]; bestBar = j;
          }
        }
        if (bestBar < 0) {
          for (let j = start + SECTION_MIN_BARS; j <= end - SECTION_MIN_BARS; j++) {
            if ((j - gridPhase) % 4 === 0 && novelty[j] > bestNov) {
              bestNov = novelty[j]; bestBar = j;
            }
          }
        }
        if (bestBar > start && !finalBoundaries.includes(bestBar)) {
          finalBoundaries.push(bestBar);
          finalBoundaries.sort((a, b) => a - b);
          changed = true;
          break;
        }
      }
    }
  }

  // Fallback: 8-bar segments if detection produced nothing
  if (finalBoundaries.length < 2) {
    finalBoundaries.length = 0;
    for (let i = 0; i < totalBars; i += 8) finalBoundaries.push(i);
  }

  // ── 4e. Energy-variance split ──────────────────────────────────────────
  //   Novelty-based detection misses gradual transitions (e.g. 10-bar
  //   ramp from verse into drop).  Scan each section: if it contains bars
  //   from very different energy zones, split at the steepest crossing.
  const varianceSplitThreshold = eRange * 0.35;
  let varChanged = true;
  while (varChanged) {
    varChanged = false;
    for (let b = 0; b < finalBoundaries.length; b++) {
      const start = finalBoundaries[b];
      const end = b + 1 < finalBoundaries.length ? finalBoundaries[b + 1] : totalBars;
      // Allow split if section has at least 3 bars on each side (was MIN_BARS*2=8,
      // now MIN_BARS+2=6 so even 6-bar sections with huge internal variance get split)
      if ((end - start) < SECTION_MIN_BARS + 2) continue;

      // Find min/max energy in this section
      let minE = Infinity, maxE = -Infinity;
      for (let j = start; j < end; j++) {
        if (smTotal[j] < minE) minE = smTotal[j];
        if (smTotal[j] > maxE) maxE = smTotal[j];
      }
      if ((maxE - minE) < varianceSplitThreshold) continue;

      // Find the bar with the steepest energy gradient (biggest rolling
      // difference over a 2-bar window).  Allow splits as close as 2 bars
      // from edges when the gradient is extreme.
      const minEdge = Math.min(SECTION_MIN_BARS, Math.max(2, Math.floor((end - start) / 3)));
      let bestBar = -1, bestGrad = 0;
      for (let j = start + minEdge; j <= end - minEdge; j++) {
        // Use a 2-bar rolling difference for robustness
        const lo = Math.max(start, j - 2);
        const hi = Math.min(end - 1, j + 1);
        const leftE = (smTotal[lo] + smTotal[Math.min(lo + 1, j - 1)]) / 2;
        const rightE = (smTotal[j] + smTotal[hi]) / 2;
        const grad = Math.abs(rightE - leftE);
        if (grad > bestGrad) {
          bestGrad = grad;
          bestBar = j;
        }
      }
      if (bestBar > start && !finalBoundaries.includes(bestBar)) {
        // Snap to phase-aligned 4-bar grid if close
        const snap4 = snapToGrid4(bestBar);
        const useBar = (Math.abs(snap4 - bestBar) <= 2 && snap4 > start && snap4 < end)
          ? snap4 : bestBar;
        if (!finalBoundaries.includes(useBar)) {
          finalBoundaries.push(useBar);
          finalBoundaries.sort((a, b) => a - b);
          varChanged = true;
          break;
        }
      }
    }
  }

  // ── 4f. Merge tiny sections (< 2 bars) into nearest neighbor ─────────
  //   Cliff detection can create very short sections.  Merge them with the
  //   adjacent section that has the most similar energy.
  //   Exception: preserve tiny sections at the very end/start of the track
  //   when they have very different energy (intro/outro patterns).
  {
    let mergeNeeded = true;
    while (mergeNeeded) {
      mergeNeeded = false;
      for (let b = 0; b < finalBoundaries.length; b++) {
        const start = finalBoundaries[b];
        const end = b + 1 < finalBoundaries.length ? finalBoundaries[b + 1] : totalBars;
        if ((end - start) >= 2) continue;
        // Preserve tiny start/end sections if energy differs substantially
        const myE = smTotal[start] || 0;
        if (b === 0 || b === finalBoundaries.length - 1) {
          // Check energy difference from neighbor
          const neighborStart = b === 0
            ? (finalBoundaries.length > 1 ? finalBoundaries[1] : 0)
            : finalBoundaries[b - 1];
          const neighborEnd = b === 0
            ? (finalBoundaries.length > 2 ? finalBoundaries[2] : totalBars)
            : finalBoundaries[b];
          let nSum = 0, nCnt = 0;
          for (let j = neighborStart; j < neighborEnd; j++) { nSum += smTotal[j]; nCnt++; }
          const nAvg = nCnt > 0 ? nSum / nCnt : 0;
          if (Math.abs(myE - nAvg) > eRange * 0.3) continue;  // preserve it
        }
        const prevIdx = b > 0 ? b : -1;
        const nextIdx = b + 1 < finalBoundaries.length ? b + 1 : -1;
        let prevE = Infinity, nextE = Infinity;
        if (prevIdx >= 0) {
          const ps = prevIdx > 0 ? finalBoundaries[prevIdx - 1] : 0;
          const pe = finalBoundaries[prevIdx];
          let sum = 0;
          for (let j = ps; j < pe; j++) sum += smTotal[j];
          prevE = Math.abs(myE - sum / Math.max(1, pe - ps));
        }
        if (nextIdx >= 0 && nextIdx < finalBoundaries.length) {
          const ns = finalBoundaries[nextIdx];
          const ne = nextIdx + 1 < finalBoundaries.length ? finalBoundaries[nextIdx + 1] : totalBars;
          let sum = 0;
          for (let j = ns; j < ne; j++) sum += smTotal[j];
          nextE = Math.abs(myE - sum / Math.max(1, ne - ns));
        }
        if (prevE <= nextE && prevIdx >= 0) {
          finalBoundaries.splice(b, 1);
        } else if (nextIdx >= 0) {
          finalBoundaries.splice(b + 1, 1);
        } else {
          finalBoundaries.splice(b, 1);
        }
        mergeNeeded = true;
        break;
      }
    }
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
    let secSubBass = 0, secHiMid = 0;
    for (let b = startBar; b < endBar; b++) {
      secTotal  += smTotal[b]  || 0;
      secBass   += smBass[b]   || 0;
      secMid    += smMid[b]    || 0;
      secTreble += smTreble[b] || 0;
      secSubBass += smSubBass[b] || 0;
      secHiMid   += smHiMid[b]   || 0;
    }
    secTotal  /= numBars;
    secBass   /= numBars;
    secMid    /= numBars;
    secTreble /= numBars;
    secSubBass /= numBars;
    secHiMid   /= numBars;
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

    // Spectral fingerprint for similarity matching (5-band)
    const fingerprint = [secSubBass, secBass, secMid, secHiMid, secTreble];

    // Per-section onset density and spectral flux (averaged over bars)
    let secOnsetDens = 0, secSpFlux = 0;
    for (let b = startBar; b < endBar; b++) {
      secOnsetDens += smOnsets[b] || 0;
      secSpFlux    += smFlux[b]   || 0;
    }
    secOnsetDens /= numBars;
    secSpFlux    /= numBars;

    // Onset density gradient (linear regression) — detects snare rolls / accelerating hi-hats
    let onsetGradient = 0;
    if (numBars >= 2) {
      const odArr = [];
      for (let b = startBar; b < endBar; b++) odArr.push(smOnsets[b] || 0);
      const n = odArr.length;
      const xM = (n - 1) / 2;
      const yM = odArr.reduce((a, b) => a + b, 0) / n;
      let numer = 0, denom = 0;
      for (let i = 0; i < n; i++) {
        numer += (i - xM) * (odArr[i] - yM);
        denom += (i - xM) * (i - xM);
      }
      onsetGradient = denom > 0 ? numer / denom : 0;
    }

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
      onsetDensity: secOnsetDens, spectralFlux: secSpFlux, onsetGradient,
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
  const maxOnsetDens = Math.max(...sectionFeats.map(f => f.onsetDensity), 1e-9);
  const maxSpFlux = Math.max(...sectionFeats.map(f => f.spectralFlux), 1e-9);

  /**
   * Distance between two sections using 5-band spectral shape,
   * energy level, dynamics, onset density, and spectral flux.
   * Returns a value in roughly 0–1 range.
   */
  function sectionDist(i, j) {
    const fi = sectionFeats[i], fj = sectionFeats[j];
    // 5-band spectral cosine distance — captures timbral fingerprint
    const shapeDist = cosineDistN(fi.fingerprint, fj.fingerprint);
    // Normalized energy difference (0–1)
    const eDist = Math.abs(fi.energy - fj.energy) / energySpan;
    // Dynamics difference (0–1)
    const cvDist = Math.abs(fi.energyCV - fj.energyCV) / maxCV;
    // Onset density difference (rhythmic similarity)
    const odDist = Math.abs(fi.onsetDensity - fj.onsetDensity) / maxOnsetDens;
    // Spectral flux difference (transition activity similarity)
    const sfDist = Math.abs(fi.spectralFlux - fj.spectralFlux) / maxSpFlux;
    // Weighted: shape 30%, energy 30%, dynamics 15%, rhythm 15%, flux 10%
    return shapeDist * 0.30 + eDist * 0.30 + cvDist * 0.15 + odDist * 0.15 + sfDist * 0.10;
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
    //   The top-energy cluster label applies to any mid-cluster that's
    //   energetically close to it (relPos > 0.6).  This prevents the
    //   same drop from being split between "drop" and "chorus".
    const topLabel = clusterProps[0].avgBR > brP75 ? 'drop' : 'chorus';
    if (clusterProps.length >= 3) {
      for (const idx of clusterProps[0].members) {
        sectionLabels[idx] = topLabel;
      }
      for (const idx of clusterProps[clusterProps.length - 1].members) {
        sectionLabels[idx] = 'verse';
      }
      for (let c = 1; c < clusterProps.length - 1; c++) {
        const midEnergy = clusterProps[c].avgEnergy;
        const highEnergy = clusterProps[0].avgEnergy;
        const lowEnergy = clusterProps[clusterProps.length - 1].avgEnergy;
        const relPos = (midEnergy - lowEnergy) / ((highEnergy - lowEnergy) || 1);
        // Mid-clusters close to the top get the same top label
        const label = relPos > 0.6 ? topLabel : 'verse';
        for (const idx of clusterProps[c].members) sectionLabels[idx] = label;
      }
    } else if (clusterProps.length === 2) {
      for (const idx of clusterProps[0].members) {
        sectionLabels[idx] = topLabel;
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

  // ── 7. Position, gradient, and onset-density overrides ──────────────
  //   Intro/outro, buildup, breakdown depend on position and energy context
  //   rather than spectral similarity, so they override cluster labels.
  //   Onset density (rhythmic activity) and onset gradient (accelerating
  //   rhythms like snare rolls) improve buildup/breakdown classification.
  const gradients = sectionFeats.map(f => f.gradient);
  const gradMax = Math.max(...gradients.map(Math.abs), 1e-9);

  // Onset density percentiles for classification
  const onsetDensities = sectionFeats.map(f => f.onsetDensity);
  const sortedOD = [...onsetDensities].sort((a, b) => a - b);
  const odP25 = sortedOD[Math.floor(sortedOD.length * 0.25)] || 0;
  const odP75 = sortedOD[Math.floor(sortedOD.length * 0.75)] || 0;
  const onsetGrads = sectionFeats.map(f => f.onsetGradient);
  const ogMax = Math.max(...onsetGrads.map(Math.abs), 1e-9);

  for (let s = 0; s < numSections; s++) {
    const f = sectionFeats[s];
    const normGrad = f.gradient / gradMax;
    const normOG   = f.onsetGradient / ogMax;

    // Intro: first section if moderate/low energy and short
    if (s === 0 && f.numBars <= MAX_INTRO_BARS && f.energy < p75) {
      sectionLabels[s] = 'intro';
    }
    // Outro: last section if moderate/low energy, fading/stable, and short
    else if (s === numSections - 1 && f.numBars <= MAX_INTRO_BARS &&
             f.energy < p75 && (normGrad < 0.1 || f.energy <= p50)) {
      sectionLabels[s] = 'outro';
    }
    // Buildup: rising energy gradient + rising onset density (snare rolls)
    //   Requires BOTH rising energy gradient AND rising onset density,
    //   plus the next section must be meaningfully higher energy.
    //   Real buildups are short (4-8 bars), not 16+ bar sections.
    else if (normGrad > 0.20 && normOG > 0.15 && f.numBars <= 8 && f.energy < p75 && f.nextEnergy > f.energy * 1.15) {
      sectionLabels[s] = 'buildup';
    }
    // Buildup: strong rising gradient with next section dramatically higher
    else if (normGrad > 0.30 && f.numBars <= 8 && f.energy < p50 && f.nextEnergy > f.energy * 1.30) {
      sectionLabels[s] = 'buildup';
    }
    // Buildup: very low energy leading into dramatically high-energy section
    //   Only trigger when the jump from this section to next is the biggest
    //   transition in the song (prevents verses from being mislabeled)
    else if (f.energy <= p25 && f.nextEnergy > p75 && f.numBars <= 8) {
      sectionLabels[s] = 'buildup';
    }
    // Buildup: strong onset density ramp (snare rolls) with clear energy jump
    else if (normOG > 0.40 && f.nextEnergy > f.energy * 1.20 && s > 0 && s < numSections - 1) {
      sectionLabels[s] = 'buildup';
    }
    // Breakdown: very low energy + sparse rhythm after a high-energy section
    // Must be short — longer low-energy sections after choruses are verses
    else if (f.energy <= p25 && f.prevEnergy > p75 && f.numBars <= MAX_BREAKDOWN_BARS) {
      sectionLabels[s] = 'breakdown';
    }
    // Breakdown: very low energy with falling gradient (not intro/outro)
    else if (f.energy <= p25 && normGrad < -0.15 && f.numBars <= MAX_BREAKDOWN_BARS && s > 0 && s < numSections - 1) {
      sectionLabels[s] = 'breakdown';
    }
    // Breakdown: sparse onset density + low energy mid-track
    else if (f.onsetDensity <= odP25 && f.energy <= p25 && f.numBars <= MAX_BREAKDOWN_BARS && s > 0 && s < numSections - 1
             && (f.prevEnergy > p50 || f.nextEnergy > p50)) {
      sectionLabels[s] = 'breakdown';
    }
  }

  // ── 8. Sequential refinement ──────────────────────────────────────────
  //   After buildup → drop/chorus; after drop/chorus → breakdown if energy dips.
  for (let i = 0; i < numSections; i++) {
    // Buildup followed by high energy → ensure next is drop or chorus
    if (sectionLabels[i] === 'buildup' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      // High energy + heavy bass OR high onset density → drop
      if (nf.energy >= p75 && (nf.bassHigh || nf.onsetDensity >= odP75) && sectionLabels[i + 1] !== 'intro') {
        sectionLabels[i + 1] = 'drop';
      } else if (nf.energy >= p75 && sectionLabels[i + 1] === 'verse') {
        sectionLabels[i + 1] = 'chorus';
      }
    }
    // After drop → dramatic dip = breakdown (only if short — long sections are verses)
    if (sectionLabels[i] === 'drop' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      if (nf.energy <= p25 && nf.numBars <= MAX_BREAKDOWN_BARS && sectionLabels[i + 1] !== 'outro') {
        sectionLabels[i + 1] = 'breakdown';
      }
    }
    // Chorus → dramatic energy dip = breakdown (only if short)
    if (sectionLabels[i] === 'chorus' && i + 1 < numSections) {
      const nf = sectionFeats[i + 1];
      if (nf.energy <= p25 && nf.numBars <= MAX_BREAKDOWN_BARS && nf.energy < sectionFeats[i].energy * 0.5 &&
          sectionLabels[i + 1] !== 'outro' && sectionLabels[i + 1] !== 'buildup') {
        sectionLabels[i + 1] = 'breakdown';
      }
    }
  }

  // ── 9. Bridge detection — spectrally unique verses ────────────────────
  //   A verse that is spectrally distant from the majority of verses is
  //   likely a bridge (different melody/instrumentation, one-off section).
  //   Uses 5-band fingerprints for better timbral differentiation.
  //   Requires BOTH spectral distance AND energy difference to avoid
  //   over-labeling in tracks with varied verses.
  if (numSections >= 6) {
    const verseIdxs = [];
    for (let i = 0; i < numSections; i++) {
      if (sectionLabels[i] === 'verse') verseIdxs.push(i);
    }
    if (verseIdxs.length >= 3) {
      // Compute the centroid fingerprint of all verses (5-band)
      const fpLen = sectionFeats[verseIdxs[0]].fingerprint.length;
      const centroid = new Array(fpLen).fill(0);
      for (const vi of verseIdxs) {
        for (let k = 0; k < fpLen; k++) centroid[k] += sectionFeats[vi].fingerprint[k];
      }
      for (let k = 0; k < fpLen; k++) centroid[k] /= verseIdxs.length;

      const avgVerseEnergy = verseIdxs.reduce((s, v) => s + sectionFeats[v].energy, 0) / verseIdxs.length;

      for (const vi of verseIdxs) {
        const fp = sectionFeats[vi].fingerprint;
        const dist = cosineDistN(centroid, fp);
        const eDiff = Math.abs(sectionFeats[vi].energy - avgVerseEnergy) / eRange;
        // Must be BOTH spectrally distant AND energy-different (not just one)
        // Only label as bridge if it's a clear outlier among verses
        if (dist > 0.18 && eDiff > 0.25) {
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

  // ── 11. Merge same-label neighbours ─────────────────────────────────
  //    Merge adjacent sections with the same label as long as the combined
  //    section doesn't exceed MAX_SECTION_BARS.  This undoes unnecessary
  //    force-splits and reduces section fragmentation.
  if (sections.length === 0) return [];
  const merged = [sections[0]];
  for (let i = 1; i < sections.length; i++) {
    const prev = merged[merged.length - 1];
    const canMerge = sections[i].label === prev.label &&
      (prev.bars + sections[i].bars) <= MAX_SECTION_BARS;
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
    // TARGET_PEAKS from settings (1000–8000) maps to peaks/sec; 2000 → 150/sec (legacy default)
    const peaksPerSec = TARGET_PEAKS * (150 / 2000);
    const dynamicPeaks = Math.max(TARGET_PEAKS, Math.round(durationSec * peaksPerSec));
    const samplesPerPeak = Math.max(1, Math.floor(totalSamples / dynamicPeaks));
    const samplesPerEnergy = Math.max(1, Math.floor((ENERGY_SEGMENT_MS / 1000) * DECODE_SAMPLE_RATE));

    // ─── IIR filter setup for 3-band split ──────────────────────────────
    const bassAlpha   = lpCoeff(200,  DECODE_SAMPLE_RATE);   // bass < 200 Hz
    const midLpAlpha  = lpCoeff(2000, DECODE_SAMPLE_RATE);   // mid  200–2000 Hz
    const midHpAlpha  = lpCoeff(200,  DECODE_SAMPLE_RATE);
    const trebAlpha   = lpCoeff(2000, DECODE_SAMPLE_RATE);   // treble > 2000 Hz
    // Extended bands for richer spectral fingerprinting
    const subBassAlpha = lpCoeff(80,   DECODE_SAMPLE_RATE);  // sub-bass < 80 Hz
    const hiMidLpAlpha = lpCoeff(6000, DECODE_SAMPLE_RATE);  // upper-mid 2000–6000 Hz
    const hiMidHpAlpha = lpCoeff(2000, DECODE_SAMPLE_RATE);

    const bassState   = iirState();
    const midLpState  = iirState();
    const midHpState  = iirState();
    const trebState   = iirState();
    const subBassState = iirState();
    const hiMidLpState = iirState();
    const hiMidHpState = iirState();

    // Accumulators — waveform peaks
    const peaks = [];
    let peakMax = 0, peakRmsAccum = 0, peakSampleCount = 0;
    let peakBassMax = 0, peakMidMax = 0, peakTrebMax = 0;
    let peakSubBassMax = 0, peakHiMidMax = 0;

    // Accumulators — energy segments
    const energySegments = [];
    let energyAccum = 0, energySampleCount = 0;
    let eBassAccum = 0, eMidAccum = 0, eTrebAccum = 0;
    let eSubBassAccum = 0, eHiMidAccum = 0;

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
        const subBass = lpFilter(norm, subBassAlpha, subBassState);
        const hiMidLp = lpFilter(norm, hiMidLpAlpha, hiMidLpState);
        const hiMid   = hpFilter(hiMidLp, hiMidHpAlpha, hiMidHpState);

        const absBass = Math.abs(bass);
        const absMid  = Math.abs(mid);
        const absTreb = Math.abs(treble);
        const absSubBass = Math.abs(subBass);
        const absHiMid   = Math.abs(hiMid);

        // ── Waveform peaks (true RMS + band maxes) ──
        if (absVal > peakMax) peakMax = absVal;
        peakRmsAccum += norm * norm;        // true RMS: sum of squares
        peakSampleCount++;
        if (absBass > peakBassMax)  peakBassMax  = absBass;
        if (absMid  > peakMidMax)   peakMidMax   = absMid;
        if (absTreb > peakTrebMax)  peakTrebMax  = absTreb;
        if (absSubBass > peakSubBassMax) peakSubBassMax = absSubBass;
        if (absHiMid   > peakHiMidMax)   peakHiMidMax   = absHiMid;

        if (peakSampleCount >= samplesPerPeak) {
          peaks.push({
            peak: peakMax,
            rms:  Math.sqrt(peakRmsAccum / peakSampleCount),
            bass: peakBassMax,
            mid:  peakMidMax,
            treble: peakTrebMax,
            sub_bass: peakSubBassMax,
            upper_mid: peakHiMidMax,
          });
          peakMax = 0; peakRmsAccum = 0; peakSampleCount = 0;
          peakBassMax = 0; peakMidMax = 0; peakTrebMax = 0;
          peakSubBassMax = 0; peakHiMidMax = 0;
        }

        // ── Energy levels (per-band RMS) ──
        energyAccum += norm * norm;
        eBassAccum  += bass * bass;
        eMidAccum   += mid * mid;
        eTrebAccum  += treble * treble;
        eSubBassAccum += subBass * subBass;
        eHiMidAccum   += hiMid * hiMid;
        energySampleCount++;

        if (energySampleCount >= samplesPerEnergy) {
          const timeMs = Math.round(((totalSamplesRead - energySampleCount) / DECODE_SAMPLE_RATE) * 1000);
          energySegments.push({
            time_ms: timeMs,
            energy:  parseFloat(Math.sqrt(energyAccum  / energySampleCount).toFixed(4)),
            bass:    parseFloat(Math.sqrt(eBassAccum   / energySampleCount).toFixed(4)),
            mid:     parseFloat(Math.sqrt(eMidAccum    / energySampleCount).toFixed(4)),
            treble:  parseFloat(Math.sqrt(eTrebAccum   / energySampleCount).toFixed(4)),
            sub_bass:  parseFloat(Math.sqrt(eSubBassAccum / energySampleCount).toFixed(4)),
            upper_mid: parseFloat(Math.sqrt(eHiMidAccum   / energySampleCount).toFixed(4)),
          });
          energyAccum = 0; eBassAccum = 0; eMidAccum = 0; eTrebAccum = 0;
          eSubBassAccum = 0; eHiMidAccum = 0;
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
          sub_bass: peakSubBassMax,
          upper_mid: peakHiMidMax,
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
          sub_bass:  parseFloat(Math.sqrt(eSubBassAccum / energySampleCount).toFixed(4)),
          upper_mid: parseFloat(Math.sqrt(eHiMidAccum   / energySampleCount).toFixed(4)),
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
        peak:   parseFloat(Math.min(1, p.peak   / normRef).toFixed(3)),
        rms:    parseFloat(Math.min(1, p.rms    / normRef).toFixed(3)),
        bass:   parseFloat(Math.min(1, p.bass   / normRef).toFixed(3)),
        mid:    parseFloat(Math.min(1, p.mid    / normRef).toFixed(3)),
        treble: parseFloat(Math.min(1, p.treble / normRef).toFixed(3)),
      }));

      // Generate fluid beat grid from audio energy + BPM guide
      const bpm = opts.bpm || 0;
      const firstBeatMs = (opts.beatgridPos || 0) * 1000;
      // Multi-point anchor support: [{pos_ms, bpm?}, ...]
      const anchorPoints = opts.anchorPoints || [];
      const beats = bpm > 0
        ? detectBeats(energySegments, bpm, durationMs, firstBeatMs, anchorPoints)
        : [];

      // Detect structural sections using fluid beats
      const sections = detectSections(energySegments, beats, durationMs, bpm, cfg, firstBeatMs);

      resolve({
        waveform_peaks: waveformPeaks,
        energy_levels: energySegments,
        beats,
        sections,
        sample_rate: DECODE_SAMPLE_RATE,
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
