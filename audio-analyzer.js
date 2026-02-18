/**
 * Audio Waveform Analyzer  (v3 — multi-band, improved sections)
 *
 * Uses ffmpeg to decode audio files to raw PCM, then computes:
 *   - Waveform peaks with per-band (bass / mid / treble) energy
 *   - True RMS energy levels over time (per-band)
 *   - Beat positions derived from BPM + beatgrid
 *   - Structural sections with multi-band novelty detection
 *
 * Looks for a local ffmpeg.exe in the project directory first, then falls back
 * to system PATH.  No ffprobe dependency — metadata is parsed from ffmpeg stderr.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Default Constants (overridable via opts.config) ────────────────────────

const ANALYSIS_VERSION = 3;
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

const PROJECT_DIR = __dirname;

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
 * Algorithm  (v3 — multi-band novelty):
 * 1. Compute per-bar average energy for bass, mid, treble and total.
 * 2. Smooth each band with a moving window.
 * 3. Compute a multi-band novelty function using cosine distance between
 *    consecutive bar energy vectors [bass, mid, treble].
 * 4. Pick peaks above an adaptive threshold as section boundaries
 *    (snapped to 4-bar or 8-bar grid).
 * 5. Label each section using energy ratios + bass content + position.
 *
 * @param {Array} energySegments  – [{time_ms, energy, bass, mid, treble}, ...]
 * @param {Array} beats           – [beatMs, ...]
 * @param {number} durationMs
 * @param {number} bpm
 * @param {object} [cfg]          – { SECTION_MIN_BARS, SECTION_WINDOW_BARS, SECTION_SENSITIVITY }
 * @returns {Array} sections – [{start_ms, end_ms, label, color, energy, bars}, ...]
 */
function detectSections(energySegments, beats, durationMs, bpm, cfg = {}) {
  const SECTION_MIN_BARS   = cfg.SECTION_MIN_BARS   || DEFAULTS.SECTION_MIN_BARS;
  const SECTION_WINDOW_BARS = cfg.SECTION_WINDOW_BARS || DEFAULTS.SECTION_WINDOW_BARS;
  const SECTION_SENSITIVITY = cfg.SECTION_SENSITIVITY || DEFAULTS.SECTION_SENSITIVITY;

  if (!energySegments.length || !beats.length || bpm <= 0) return [];

  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;
  const totalBars = Math.floor(durationMs / barMs);
  if (totalBars < SECTION_MIN_BARS * 2) return [];

  // Helper: per-bar average of a field
  function barAverages(field) {
    const arr = [];
    for (let bar = 0; bar < totalBars; bar++) {
      const barStart = bar * barMs;
      const barEnd = barStart + barMs;
      const inBar = energySegments.filter(s => s.time_ms >= barStart && s.time_ms < barEnd);
      arr.push(inBar.length > 0
        ? inBar.reduce((sum, s) => sum + (s[field] || s.energy || 0), 0) / inBar.length
        : 0);
    }
    return arr;
  }

  // 1. Per-bar energy for each band
  const barTotal = barAverages('energy');
  const hasBands = energySegments[0] && energySegments[0].bass !== undefined;
  const barBass   = hasBands ? barAverages('bass')   : barTotal;
  const barMid    = hasBands ? barAverages('mid')     : barTotal;
  const barTreble = hasBands ? barAverages('treble')  : barTotal;

  // 2. Smooth each band
  const windowSize = Math.max(1, Math.min(SECTION_WINDOW_BARS, Math.floor(totalBars / 8)));
  function smooth(arr) {
    const out = [];
    for (let i = 0; i < arr.length; i++) {
      let sum = 0, n = 0;
      for (let j = Math.max(0, i - windowSize); j <= Math.min(arr.length - 1, i + windowSize); j++) {
        sum += arr[j]; n++;
      }
      out.push(sum / n);
    }
    return out;
  }
  const smTotal  = smooth(barTotal);
  const smBass   = smooth(barBass);
  const smMid    = smooth(barMid);
  const smTreble = smooth(barTreble);

  // 3. Multi-band novelty: cosine distance between consecutive 3-vectors
  function cosineDist(a, b) {
    const dot = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
    const magA = Math.sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]) || 1e-9;
    const magB = Math.sqrt(b[0]*b[0] + b[1]*b[1] + b[2]*b[2]) || 1e-9;
    return 1 - (dot / (magA * magB));
  }

  const novelty = [0];
  for (let i = 1; i < totalBars; i++) {
    const vecPrev = [smBass[i-1], smMid[i-1], smTreble[i-1]];
    const vecCurr = [smBass[i],   smMid[i],   smTreble[i]];
    // Combine cosine distance with magnitude change for robustness
    const cd = cosineDist(vecPrev, vecCurr);
    const magDiff = Math.abs(smTotal[i] - smTotal[i-1]);
    novelty.push(cd + magDiff * 2);
  }

  // Adaptive threshold for novelty peaks
  const novMean = novelty.reduce((s, v) => s + v, 0) / novelty.length;
  const novStd = Math.sqrt(novelty.reduce((s, v) => s + (v - novMean) ** 2, 0) / novelty.length);
  const novThreshold = novMean + SECTION_SENSITIVITY * novStd;

  // 4. Find boundaries (snap to nearest 4-bar grid when close)
  const boundaries = [0];
  let lastBoundary = 0;
  for (let i = 1; i < novelty.length; i++) {
    if (novelty[i] > novThreshold && (i - lastBoundary) >= SECTION_MIN_BARS) {
      // Snap to nearest 4-bar boundary if within 2 bars
      const nearest4 = Math.round(i / 4) * 4;
      const snapped = (Math.abs(nearest4 - i) <= 2 && nearest4 > lastBoundary && nearest4 < totalBars)
        ? nearest4 : i;
      if (snapped > lastBoundary) {
        boundaries.push(snapped);
        lastBoundary = snapped;
      }
    }
  }
  // Fallback: 8-bar segments if detection produced nothing
  if (boundaries.length < 2) {
    boundaries.length = 0;
    for (let i = 0; i < totalBars; i += 8) boundaries.push(i);
  }

  // Median energy for classification
  const sorted = [...smTotal].sort((a, b) => a - b);
  const medianEnergy = sorted[Math.floor(sorted.length / 2)];
  const p75Energy = sorted[Math.floor(sorted.length * 0.75)];

  // Median bass ratio
  const bassRatios = smBass.map((b, i) => smTotal[i] > 0 ? b / smTotal[i] : 0);
  const sortedBR = [...bassRatios].sort((a, b) => a - b);
  const medianBassRatio = sortedBR[Math.floor(sortedBR.length / 2)];

  // 5. Classify each section
  const sections = [];
  let verseCount = 0, chorusCount = 0;

  for (let s = 0; s < boundaries.length; s++) {
    const startBar = boundaries[s];
    const endBar = s + 1 < boundaries.length ? boundaries[s + 1] : totalBars;
    const startMs = Math.round(startBar * barMs);
    const endMs = Math.round(endBar * barMs);

    // Average energies in this section
    let secTotal = 0, secBass = 0;
    for (let b = startBar; b < endBar; b++) {
      secTotal += smTotal[b] || 0;
      secBass  += smBass[b]  || 0;
    }
    const numBars = (endBar - startBar) || 1;
    secTotal /= numBars;
    secBass  /= numBars;
    const secBassRatio = secTotal > 0 ? secBass / secTotal : 0;

    // Next section energy (for buildup detection)
    let nextSectionEnergy = 0;
    if (s + 1 < boundaries.length) {
      const nextEnd = s + 2 < boundaries.length ? boundaries[s + 2] : totalBars;
      for (let b = boundaries[s + 1]; b < nextEnd; b++) nextSectionEnergy += smTotal[b] || 0;
      nextSectionEnergy /= (nextEnd - boundaries[s + 1]) || 1;
    }

    // Prev section energy (for contrast)
    let prevSectionEnergy = 0;
    if (s > 0) {
      const prevStart = boundaries[s - 1];
      for (let b = prevStart; b < startBar; b++) prevSectionEnergy += smTotal[b] || 0;
      prevSectionEnergy /= (startBar - prevStart) || 1;
    }

    const ratio = medianEnergy > 0 ? secTotal / medianEnergy : 1;
    const position = startMs / durationMs;
    const bassHigh = secBassRatio > medianBassRatio * 1.15;

    let label;
    if (position < 0.06 && ratio < 1.1) {
      label = 'intro';
    } else if (position > 0.88 && ratio < 1.1) {
      label = 'outro';
    } else if (ratio < 0.45 && nextSectionEnergy > medianEnergy * 1.2) {
      label = 'buildup';
    } else if (ratio < 0.45 && prevSectionEnergy > medianEnergy * 1.2) {
      label = 'breakdown';
    } else if (ratio < 0.55) {
      label = (nextSectionEnergy > medianEnergy * 1.2) ? 'buildup' : 'breakdown';
    } else if (ratio < 0.85) {
      verseCount++;
      label = verseCount % 3 === 0 ? 'bridge' : 'verse';
    } else if (ratio >= 1.4 && bassHigh) {
      // Heavy bass + high energy → drop
      label = 'drop';
    } else if (ratio >= 1.15) {
      chorusCount++;
      label = (bassHigh && ratio >= 1.5) ? 'drop' : 'chorus';
    } else {
      chorusCount++;
      label = 'chorus';
    }

    sections.push({
      start_ms: startMs,
      end_ms: Math.min(endMs, durationMs),
      label,
      color: SECTION_COLORS[label] || SECTION_COLORS.unknown,
      energy: parseFloat(secTotal.toFixed(4)),
      bars: numBars,
    });
  }

  // Post-process: merge tiny adjacent same-label sections
  if (sections.length === 0) return [];
  const merged = [sections[0]];
  for (let i = 1; i < sections.length; i++) {
    const prev = merged[merged.length - 1];
    if (sections[i].label === prev.label) {
      prev.end_ms = sections[i].end_ms;
      prev.bars += sections[i].bars;
      prev.energy = (prev.energy + sections[i].energy) / 2;
    } else {
      merged.push(sections[i]);
    }
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

      // Generate beat grid from BPM
      const beats = [];
      const bpm = opts.bpm || 0;
      if (bpm > 0) {
        const beatIntervalMs = 60000 / bpm;
        const startOffset = (opts.beatgridPos || 0) * 1000; // beatgridPos is in seconds
        let t = startOffset;
        while (t < durationMs) {
          if (t >= 0) beats.push(Math.round(t));
          t += beatIntervalMs;
        }
      }

      // Detect structural sections (pass multi-band energy)
      const sections = detectSections(energySegments, beats, durationMs, bpm, cfg);

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

module.exports = { analyzeTrack, checkFfmpeg, probeFile, detectSections, ANALYSIS_VERSION, SECTION_COLORS, DEFAULTS };
