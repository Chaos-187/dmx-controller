/**
 * Audio Waveform Analyzer
 *
 * Uses ffmpeg to decode audio files to raw PCM, then computes:
 *   - Waveform peaks (downsampled overview)
 *   - RMS energy levels over time
 *   - Beat positions derived from BPM + beatgrid
 *   - Structural sections (intro, verse, chorus, bridge, breakdown, outro, etc.)
 *
 * Looks for a local ffmpeg.exe in the project directory first, then falls back
 * to system PATH.  No ffprobe dependency — metadata is parsed from ffmpeg stderr.
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── Constants ──────────────────────────────────────────────────────────────

const ANALYSIS_VERSION = 2;
const TARGET_PEAKS = 1000;          // number of waveform overview points
const ENERGY_SEGMENT_MS = 100;      // energy computed every N ms
const DECODE_SAMPLE_RATE = 22050;   // downsample to this for analysis (mono)
const BYTES_PER_SAMPLE = 2;         // 16-bit signed LE

// Section detection tuning
const SECTION_MIN_BARS = 4;         // minimum section length in bars
const SECTION_WINDOW_BARS = 4;      // energy smoothing window in bars

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
 * Detect structural sections from energy data and beat grid.
 *
 * Algorithm:
 * 1. Compute bar-level average energy (each bar = 4 beats).
 * 2. Smooth the energy curve and compute a novelty function (absolute
 *    difference between consecutive bar energies).
 * 3. Pick peaks in the novelty function as section boundaries.
 * 4. Label each section by comparing its average energy to the track median:
 *    - Very low at start → intro
 *    - Very low at end → outro
 *    - Low followed by high → buildup
 *    - Sudden drop from high → breakdown
 *    - Below median → verse / bridge (alternating)
 *    - Above median → chorus / drop
 *
 * @param {Array} energySegments  – [{time_ms, energy}, ...]
 * @param {Array} beats           – [beatMs, ...]
 * @param {number} durationMs
 * @param {number} bpm
 * @returns {Array} sections – [{start_ms, end_ms, label, color, energy, bars}, ...]
 */
function detectSections(energySegments, beats, durationMs, bpm) {
  if (!energySegments.length || !beats.length || bpm <= 0) return [];

  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;
  const totalBars = Math.floor(durationMs / barMs);
  if (totalBars < SECTION_MIN_BARS * 2) return [];

  // 1. Per-bar average energy
  const barEnergy = [];
  for (let bar = 0; bar < totalBars; bar++) {
    const barStart = bar * barMs;
    const barEnd = barStart + barMs;
    const segsInBar = energySegments.filter(s => s.time_ms >= barStart && s.time_ms < barEnd);
    const avg = segsInBar.length > 0
      ? segsInBar.reduce((sum, s) => sum + s.energy, 0) / segsInBar.length
      : 0;
    barEnergy.push(avg);
  }

  // 2. Smooth with a moving window
  const windowSize = Math.max(1, Math.min(SECTION_WINDOW_BARS, Math.floor(totalBars / 8)));
  const smoothed = [];
  for (let i = 0; i < barEnergy.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowSize); j <= Math.min(barEnergy.length - 1, i + windowSize); j++) {
      sum += barEnergy[j]; count++;
    }
    smoothed.push(sum / count);
  }

  // 3. Novelty function (absolute difference)
  const novelty = [0];
  for (let i = 1; i < smoothed.length; i++) {
    novelty.push(Math.abs(smoothed[i] - smoothed[i - 1]));
  }

  // Median energy for classification
  const sorted = [...smoothed].sort((a, b) => a - b);
  const medianEnergy = sorted[Math.floor(sorted.length / 2)];

  // Novelty threshold (mean + 1.2 * std)
  const novMean = novelty.reduce((s, v) => s + v, 0) / novelty.length;
  const novStd = Math.sqrt(novelty.reduce((s, v) => s + (v - novMean) ** 2, 0) / novelty.length);
  const novThreshold = novMean + 1.2 * novStd;

  // 4. Find section boundaries
  const boundaries = [0];
  let lastBoundary = 0;
  for (let i = 1; i < novelty.length; i++) {
    if (novelty[i] > novThreshold && (i - lastBoundary) >= SECTION_MIN_BARS) {
      boundaries.push(i);
      lastBoundary = i;
    }
  }
  if (boundaries.length < 2) {
    boundaries.length = 0;
    for (let i = 0; i < totalBars; i += 8) boundaries.push(i);
  }

  // 5. Classify each section
  const sections = [];
  let verseCount = 0, chorusCount = 0;

  for (let s = 0; s < boundaries.length; s++) {
    const startBar = boundaries[s];
    const endBar = s + 1 < boundaries.length ? boundaries[s + 1] : totalBars;
    const startMs = Math.round(startBar * barMs);
    const endMs = Math.round(endBar * barMs);

    // Average energy of this section
    let sectionEnergy = 0;
    for (let b = startBar; b < endBar; b++) sectionEnergy += smoothed[b] || 0;
    sectionEnergy /= (endBar - startBar) || 1;

    // Next section energy (for buildup detection)
    let nextSectionEnergy = 0;
    if (s + 1 < boundaries.length) {
      const nextEnd = s + 2 < boundaries.length ? boundaries[s + 2] : totalBars;
      for (let b = boundaries[s + 1]; b < nextEnd; b++) nextSectionEnergy += smoothed[b] || 0;
      nextSectionEnergy /= (nextEnd - boundaries[s + 1]) || 1;
    }

    const ratio = medianEnergy > 0 ? sectionEnergy / medianEnergy : 1;
    const position = startMs / durationMs;

    let label;
    if (position < 0.08 && ratio < 1.1) {
      label = 'intro';
    } else if (position > 0.85 && ratio < 1.1) {
      label = 'outro';
    } else if (ratio < 0.5) {
      label = (nextSectionEnergy > medianEnergy * 1.3) ? 'buildup' : 'breakdown';
    } else if (ratio < 0.9) {
      verseCount++;
      label = verseCount % 3 === 0 ? 'bridge' : 'verse';
    } else if (ratio >= 1.3) {
      chorusCount++;
      label = (chorusCount <= 1 || ratio >= 1.6) ? 'drop' : 'chorus';
    } else {
      chorusCount++;
      label = 'chorus';
    }

    sections.push({
      start_ms: startMs,
      end_ms: Math.min(endMs, durationMs),
      label,
      color: SECTION_COLORS[label] || SECTION_COLORS.unknown,
      energy: parseFloat(sectionEnergy.toFixed(4)),
      bars: endBar - startBar,
    });
  }

  // Post-process: merge tiny adjacent same-label sections
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
 * @param {string} filePath  – absolute path to audio file
 * @param {object} opts
 * @param {number} [opts.bpm]           – BPM (for beat grid & section detection)
 * @param {number} [opts.beatgridPos]   – first beat offset in seconds
 * @param {function} [opts.onProgress]  – callback(percent 0-100)
 * @returns {Promise<object>} analysis result
 */
function analyzeTrack(filePath, opts = {}) {
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

    // Accumulators
    const peaks = [];
    const energySegments = [];

    let peakMax = 0;
    let peakSampleCount = 0;
    let peakAccum = 0;

    let energyAccum = 0;
    let energySampleCount = 0;

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
        const absVal = Math.abs(sample) / 32768;
        totalSamplesRead++;

        // --- Waveform peaks ---
        if (absVal > peakMax) peakMax = absVal;
        peakAccum += absVal;
        peakSampleCount++;

        if (peakSampleCount >= samplesPerPeak) {
          peaks.push({
            peak: peakMax,
            rms: Math.sqrt(peakAccum / peakSampleCount),
          });
          peakMax = 0;
          peakAccum = 0;
          peakSampleCount = 0;
        }

        // --- Energy levels ---
        energyAccum += absVal * absVal;
        energySampleCount++;

        if (energySampleCount >= samplesPerEnergy) {
          const rms = Math.sqrt(energyAccum / energySampleCount);
          const timeMs = Math.round(((totalSamplesRead - energySampleCount) / DECODE_SAMPLE_RATE) * 1000);
          energySegments.push({
            time_ms: timeMs,
            energy: parseFloat(rms.toFixed(4)),
          });
          energyAccum = 0;
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
          rms: Math.sqrt(peakAccum / peakSampleCount),
        });
      }
      // Flush remaining energy bucket
      if (energySampleCount > 0) {
        const rms = Math.sqrt(energyAccum / energySampleCount);
        const timeMs = Math.round(((totalSamplesRead - energySampleCount) / DECODE_SAMPLE_RATE) * 1000);
        energySegments.push({ time_ms: timeMs, energy: parseFloat(rms.toFixed(4)) });
      }

      // Normalize waveform peaks to 0-1 range
      let globalMax = 0;
      for (const p of peaks) {
        if (p.peak > globalMax) globalMax = p.peak;
      }
      const waveformPeaks = peaks.map((p) => ({
        peak: globalMax > 0 ? parseFloat((p.peak / globalMax).toFixed(4)) : 0,
        rms: globalMax > 0 ? parseFloat((p.rms / globalMax).toFixed(4)) : 0,
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

      // Detect structural sections
      const sections = detectSections(energySegments, beats, durationMs, bpm);

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

module.exports = { analyzeTrack, checkFfmpeg, probeFile, detectSections, ANALYSIS_VERSION, SECTION_COLORS };
