/**
 * Stem Separator — optional demucs / ffmpeg-filter integration
 *
 * Provides stem separation for audio tracks to improve sequence generation.
 * Supports two modes:
 *
 *   1. **Demucs** (high quality) — requires Python + demucs installed
 *      Separates into vocals / drums / bass / other using ML
 *
 *   2. **FFmpeg spectral** (zero-dependency fallback) — frequency-band isolation
 *      Uses bandpass filters to isolate bass / mid / highs for per-band energy
 *      Not true source separation but useful for energy profiling
 *
 * The output is per-stem energy timeseries (same 50ms resolution as main analysis)
 * which is stored alongside the track analysis and consumed by the sequence generator
 * for more musically-aware light cue decisions.
 */

const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── Paths ──────────────────────────────────────────────────────────────────

const PROJECT_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

let _cachedDevice = null; // 'cuda' or 'cpu', detected once

function getDemucsPath() {
  const local = path.join(PROJECT_DIR, process.platform === 'win32' ? 'demucs.exe' : 'demucs');
  if (fs.existsSync(local)) return local;
  return 'demucs'; // fall back to PATH
}

function getFfmpegPath() {
  const local = path.join(PROJECT_DIR, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

/**
 * Detect whether CUDA is available via PyTorch.
 * Caches the result so we only probe once per process lifetime.
 */
async function _detectDevice(mode) {
  const pyCmd = mode === 'python3' ? 'python3' : 'python';
  const cmd = mode === 'binary' ? pyCmd : pyCmd; // always use python for torch check
  try {
    const result = await _tryCommand(cmd, ['-c', 'import torch; print("cuda" if torch.cuda.is_available() else "cpu")']);
    const device = (result.output || '').trim();
    if (device === 'cuda') return 'cuda';
  } catch (_) { /* fall through */ }
  return 'cpu';
}

// ─── Availability Checks ────────────────────────────────────────────────────

/**
 * Check if demucs is available (either local binary or via python -m demucs).
 * @returns {Promise<{available: boolean, mode: 'binary'|'python'|null, version: string|null}>}
 */
async function checkDemucs() {
  // Try local / PATH binary first
  const binResult = await _tryCommand(getDemucsPath(), ['--help']);
  if (binResult.ok) {
    const ver = _parseDemucsVersion(binResult.output);
    return { available: true, mode: 'binary', version: ver };
  }

  // Try python -m demucs
  const pyResult = await _tryCommand('python', ['-m', 'demucs', '--help']);
  if (pyResult.ok) {
    const ver = _parseDemucsVersion(pyResult.output);
    return { available: true, mode: 'python', version: ver };
  }

  // Try python3
  const py3Result = await _tryCommand('python3', ['-m', 'demucs', '--help']);
  if (py3Result.ok) {
    const ver = _parseDemucsVersion(py3Result.output);
    return { available: true, mode: 'python3', version: ver };
  }

  return { available: false, mode: null, version: null };
}

function _tryCommand(cmd, args) {
  return new Promise(resolve => {
    let output = '';
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    proc.stdout.on('data', d => { output += d; });
    proc.stderr.on('data', d => { output += d; });
    proc.on('error', () => resolve({ ok: false, output: '' }));
    proc.on('close', code => resolve({ ok: code === 0 || output.length > 100, output }));
  });
}

function _parseDemucsVersion(output) {
  const m = output.match(/demucs[^\d]*(\d+\.\d+[\.\d]*)/i);
  return m ? m[1] : null;
}

// ─── Demucs Stem Separation ─────────────────────────────────────────────────

/**
 * Separate a track into stems using demucs.
 *
 * Runs demucs as a subprocess, writes stems to a temp directory,
 * then analyzes each stem's energy using FFmpeg's PCM decode pipeline.
 *
 * @param {string} filePath      – path to audio file
 * @param {object} opts
 * @param {string} opts.mode     – 'binary' | 'python' | 'python3'
 * @param {string} [opts.model]  – demucs model (default: 'htdemucs')
 * @param {function} [opts.onProgress] – progress callback (0-100)
 * @returns {Promise<object>}    – { stems: { vocals, drums, bass, other }, method: 'demucs' }
 */
async function separateWithDemucs(filePath, opts = {}) {
  const mode  = opts.mode || 'binary';
  const model = opts.model || 'htdemucs';

  // Create temp output directory
  const tmpDir = path.join(PROJECT_DIR, '.stem-cache');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  const baseName = path.parse(filePath).name;

  // Auto-detect CUDA availability for GPU acceleration
  if (!_cachedDevice) {
    _cachedDevice = await _detectDevice(mode);
    console.log(`[STEMS] Using device: ${_cachedDevice}`);
  }

  // Build demucs command
  let cmd, args;
  if (mode === 'binary') {
    cmd = getDemucsPath();
    args = ['-n', model, '--device', _cachedDevice, '--two-stems', 'vocals', '-o', tmpDir, filePath];
  } else {
    cmd = mode === 'python3' ? 'python3' : 'python';
    args = ['-m', 'demucs', '-n', model, '--device', _cachedDevice, '-o', tmpDir, filePath];
  }

  // Run demucs
  await new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    proc.stderr.on('data', d => {
      stderr += d.toString();
      // Demucs prints progress as percentage to stderr
      const pctMatch = stderr.match(/(\d+)%/g);
      if (pctMatch && opts.onProgress) {
        const last = parseInt(pctMatch[pctMatch.length - 1]);
        opts.onProgress(Math.min(50, Math.round(last * 0.5))); // 0-50% for separation
      }
    });
    proc.on('error', err => reject(new Error(`demucs not found: ${err.message}`)));
    proc.on('close', code => {
      if (code !== 0) return reject(new Error(`demucs exited with code ${code}: ${stderr.slice(-500)}`));
      resolve();
    });
  });

  // Find output stems — demucs writes to <output>/<model>/<trackname>/{vocals,drums,bass,other}.wav
  const stemDir = path.join(tmpDir, model, baseName);
  const stemNames = ['vocals', 'drums', 'bass', 'other'];
  const stemFiles = {};

  for (const name of stemNames) {
    const wavPath = path.join(stemDir, `${name}.wav`);
    if (fs.existsSync(wavPath)) {
      stemFiles[name] = wavPath;
    }
  }

  // If --two-stems was used, we get vocals + no_vocals
  if (!stemFiles.vocals) {
    const altVocals = path.join(stemDir, 'vocals.wav');
    const altNoVocals = path.join(stemDir, 'no_vocals.wav');
    if (fs.existsSync(altVocals)) stemFiles.vocals = altVocals;
    if (fs.existsSync(altNoVocals)) stemFiles.other = altNoVocals;
  }

  if (Object.keys(stemFiles).length === 0) {
    throw new Error(`No stem files found in ${stemDir}`);
  }

  // Analyze each stem's energy
  const stemEnergy = {};
  const stemCount = Object.keys(stemFiles).length;
  let stemIdx = 0;
  for (const [name, wavPath] of Object.entries(stemFiles)) {
    stemEnergy[name] = await analyzeStemEnergy(wavPath);
    stemIdx++;
    if (opts.onProgress) {
      opts.onProgress(50 + Math.round((stemIdx / stemCount) * 50)); // 50-100%
    }
  }

  // Clean up stem WAV files (large, not needed after energy extraction)
  _cleanupDir(stemDir);

  return { stems: stemEnergy, method: 'demucs' };
}

// ─── FFmpeg Spectral Filter Fallback ────────────────────────────────────────

/**
 * Isolate frequency bands using FFmpeg audio filters as a lightweight
 * stem separation alternative. Not true source separation, but provides
 * useful per-band energy profiles without any ML dependencies.
 *
 * Produces 4 pseudo-stems:
 *   - bass:   < 200 Hz    (kick, bass guitar, sub)
 *   - drums:  200-4000 Hz with high transients (approximates percussive content)
 *   - vocals: 300-4000 Hz (vocal fundamental + harmonics range)
 *   - other:  > 4000 Hz   (cymbals, synth highs, air)
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {function} [opts.onProgress]
 * @returns {Promise<object>} – { stems: { vocals, drums, bass, other }, method: 'spectral' }
 */
async function separateWithSpectral(filePath, opts = {}) {
  const bands = {
    bass:   { filter: 'lowpass=f=200',                              label: 'bass' },
    vocals: { filter: 'highpass=f=300,lowpass=f=4000',              label: 'vocals' },
    drums:  { filter: 'highpass=f=200,lowpass=f=4000,acompressor=threshold=0.05:ratio=3', label: 'drums' },
    other:  { filter: 'highpass=f=4000',                            label: 'other' },
  };

  const stemEnergy = {};
  const bandNames = Object.keys(bands);
  let idx = 0;

  for (const [name, cfg] of Object.entries(bands)) {
    stemEnergy[name] = await analyzeStemEnergyWithFilter(filePath, cfg.filter);
    idx++;
    if (opts.onProgress) {
      opts.onProgress(Math.round((idx / bandNames.length) * 100));
    }
  }

  return { stems: stemEnergy, method: 'spectral' };
}

// ─── Stem Energy Analysis ───────────────────────────────────────────────────

const ENERGY_SEGMENT_MS = 50;
const DECODE_SAMPLE_RATE = 22050;
const BYTES_PER_SAMPLE = 2;

/**
 * Analyze the RMS energy of a WAV file at 50ms resolution.
 * Returns an array of { time_ms, energy } objects.
 *
 * @param {string} wavPath – path to WAV file
 * @returns {Promise<Array<{time_ms: number, energy: number}>>}
 */
function analyzeStemEnergy(wavPath) {
  return _analyzeEnergy(wavPath, null);
}

/**
 * Analyze energy of an audio file after applying an ffmpeg audio filter.
 * Used for spectral fallback mode.
 *
 * @param {string} filePath – path to audio file
 * @param {string} filter   – ffmpeg audio filter string
 * @returns {Promise<Array<{time_ms: number, energy: number}>>}
 */
function analyzeStemEnergyWithFilter(filePath, filter) {
  return _analyzeEnergy(filePath, filter);
}

/**
 * Core energy analysis: decode to PCM via ffmpeg, compute RMS per segment.
 */
function _analyzeEnergy(filePath, filter) {
  return new Promise((resolve, reject) => {
    const ffmpegBin = getFfmpegPath();
    const args = ['-i', filePath, '-vn', '-ac', '1', '-ar', String(DECODE_SAMPLE_RATE)];

    if (filter) {
      args.push('-af', filter);
    }

    args.push('-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1');

    const ffmpeg = spawn(ffmpegBin, args, {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    });

    const samplesPerSegment = Math.max(1, Math.floor((ENERGY_SEGMENT_MS / 1000) * DECODE_SAMPLE_RATE));
    const segments = [];
    let accumulator = 0;
    let sampleCount = 0;
    let totalSamples = 0;
    let leftover = Buffer.alloc(0);

    ffmpeg.stdout.on('data', chunk => {
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
        const norm = sample / 32768;
        accumulator += norm * norm;
        sampleCount++;
        totalSamples++;

        if (sampleCount >= samplesPerSegment) {
          const timeMs = Math.round(((totalSamples - sampleCount) / DECODE_SAMPLE_RATE) * 1000);
          segments.push({
            time_ms: timeMs,
            energy: parseFloat(Math.sqrt(accumulator / sampleCount).toFixed(4)),
          });
          accumulator = 0;
          sampleCount = 0;
        }
      }
    });

    ffmpeg.stdout.on('end', () => {
      // Flush
      if (sampleCount > 0) {
        const timeMs = Math.round(((totalSamples - sampleCount) / DECODE_SAMPLE_RATE) * 1000);
        segments.push({
          time_ms: timeMs,
          energy: parseFloat(Math.sqrt(accumulator / sampleCount).toFixed(4)),
        });
      }
      resolve(segments);
    });

    ffmpeg.on('error', err => reject(new Error(`ffmpeg error: ${err.message}`)));
    ffmpeg.on('close', code => {
      if (code !== 0 && code !== null) {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
  });
}

// ─── High-level API ─────────────────────────────────────────────────────────

/**
 * Separate a track into stems, choosing the best available method.
 * Tries demucs first (if available), falls back to spectral filtering.
 *
 * @param {string} filePath
 * @param {object} [opts]
 * @param {string} [opts.method]     – force method: 'demucs' | 'spectral' | 'auto' (default)
 * @param {string} [opts.model]      – demucs model name
 * @param {function} [opts.onProgress] – progress callback (0-100)
 * @returns {Promise<object>} – { stems: { vocals, drums, bass, other }, method: string }
 */
async function separateStems(filePath, opts = {}) {
  const method = opts.method || 'auto';

  if (method === 'demucs' || method === 'auto') {
    const demucsInfo = await checkDemucs();
    if (demucsInfo.available) {
      return separateWithDemucs(filePath, {
        mode: demucsInfo.mode,
        model: opts.model,
        onProgress: opts.onProgress,
      });
    }
    if (method === 'demucs') {
      throw new Error('Demucs is not available. Install with: pip install demucs');
    }
  }

  // Fallback to spectral
  return separateWithSpectral(filePath, { onProgress: opts.onProgress });
}

/**
 * Compute a stem summary from per-stem energy timeseries.
 * Returns per-stem aggregate stats + vocal activity ranges + drum hit density,
 * useful for the sequence generator without needing full timeseries.
 *
 * @param {object} stems – { vocals: [{time_ms, energy}], drums: [...], bass: [...], other: [...] }
 * @returns {object} summary
 */
function computeStemSummary(stems) {
  const summary = {};

  for (const [name, segments] of Object.entries(stems)) {
    if (!segments || !segments.length) {
      summary[name] = { mean: 0, max: 0, active_pct: 0 };
      continue;
    }

    const energies = segments.map(s => s.energy);
    const mean = energies.reduce((a, b) => a + b, 0) / energies.length;
    const max  = Math.max(...energies);

    // "Active" = energy above 20% of max
    const threshold = max * 0.2;
    const activeCount = energies.filter(e => e > threshold).length;
    const activePct = energies.length > 0 ? activeCount / energies.length : 0;

    summary[name] = {
      mean: parseFloat(mean.toFixed(4)),
      max:  parseFloat(max.toFixed(4)),
      active_pct: parseFloat(activePct.toFixed(3)),
    };
  }

  // ─── Vocal activity ranges (contiguous regions where vocals are active) ──
  if (stems.vocals && stems.vocals.length) {
    const vocalEnergies = stems.vocals.map(s => s.energy);
    const vMax = Math.max(...vocalEnergies);
    const vThreshold = vMax * 0.15;
    const ranges = [];
    let rangeStart = null;

    for (let i = 0; i < stems.vocals.length; i++) {
      const active = vocalEnergies[i] > vThreshold;
      if (active && rangeStart === null) {
        rangeStart = stems.vocals[i].time_ms;
      } else if (!active && rangeStart !== null) {
        const rangeEnd = stems.vocals[i].time_ms;
        // Only keep ranges > 500ms
        if (rangeEnd - rangeStart > 500) {
          ranges.push({ start_ms: rangeStart, end_ms: rangeEnd });
        }
        rangeStart = null;
      }
    }
    // Close final range
    if (rangeStart !== null) {
      const last = stems.vocals[stems.vocals.length - 1].time_ms;
      if (last - rangeStart > 500) {
        ranges.push({ start_ms: rangeStart, end_ms: last });
      }
    }

    summary.vocal_ranges = ranges;
  }

  // ─── Drum hit density (per-second onset count approximation) ──
  if (stems.drums && stems.drums.length > 1) {
    let onsets = 0;
    for (let i = 1; i < stems.drums.length; i++) {
      const diff = stems.drums[i].energy - stems.drums[i - 1].energy;
      if (diff > 0.02) onsets++;
    }
    const durationSec = (stems.drums[stems.drums.length - 1].time_ms - stems.drums[0].time_ms) / 1000;
    summary.drum_onset_density = durationSec > 0
      ? parseFloat((onsets / durationSec).toFixed(2))
      : 0;
  }

  return summary;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function _cleanupDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) return;
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const fp = path.join(dirPath, file);
      if (fs.statSync(fp).isDirectory()) {
        _cleanupDir(fp);
      } else {
        fs.unlinkSync(fp);
      }
    }
    fs.rmdirSync(dirPath);
  } catch (e) {
    console.warn(`[Stems] Cleanup warning: ${e.message}`);
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  checkDemucs,
  separateStems,
  separateWithDemucs,
  separateWithSpectral,
  computeStemSummary,
};
