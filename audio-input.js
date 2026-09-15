/**
 * Audio Input Capture
 *
 * Real-time audio capture from a system audio interface via ffmpeg.
 * Computes frequency band energy levels for sound-reactive DMX effects.
 *
 * Exports:
 *   capture            — singleton AudioInputCapture instance
 *   listAudioDevices() — Promise<[{ name, format }]>
 *   getPlatformFormat()— 'dshow' | 'pulse' | 'avfoundation'
 */

const { spawn }      = require('child_process');
const path           = require('path');
const fs             = require('fs');
const EventEmitter   = require('events');

// ─── Constants ────────────────────────────────────────────────────────────────

const SAMPLE_RATE       = 48000;   // Hz — native rate for most pro/ASIO interfaces (no resampling)
const FRAME_SAMPLES     = 128;     // ~2.7 ms per analysis frame at 48000 Hz (~375 fps internally)
const FRAME_BYTES       = FRAME_SAMPLES * 2;  // s16le = 2 bytes/sample

const LEVEL_SMOOTH      = 0.10;    // 0 = instant, 1 = frozen — fast display response (band meters)
const ENERGY_ATTACK     = 0.24;    // UI energy bar: quick rise
const ENERGY_DECAY      = 0.91;    // UI energy bar: slower fall (easier to read peaks)
const DMX_ATTACK        = 0.30;    // fast rise  — α=0.30 → ~4 ms time-constant (snappy VU attack)
const DMX_DECAY         = 0.82;    // slow fall  — α=0.82 → ~27 ms time-constant (natural bar drop)
const BEAT_MIN_GAP_MS   = 150;     // minimum ms between detected beats
const BEAT_DECAY_MS     = 80;      // beat indicator fade time
const BROADCAST_MS      = 10;      // level emit interval (~100 fps to UI/effects)

const BPM_MIN           = 60;
const BPM_MAX           = 200;
const BPM_HISTORY_SIZE  = 10;      // inter-beat intervals kept for median
const BPM_RECENT_WINDOW = 7;       // median uses the newest N intervals
const BPM_SMOOTH        = 0.17;    // internal tempo smoothing per beat (lower = steadier)
const BPM_SMOOTH_FAST   = 0.34;    // when a genuine tempo shift is detected
const BPM_DISPLAY_SMOOTH = 0.88;   // extra smoothing on BPM sent to UI / API
const BPM_JUMP_RATIO    = 0.085;   // % change vs estimate before fast tracking
const BPM_INTERVAL_TOL  = 0.12;    // keep intervals within this fraction of anchor when shifting
const BPM_SHIFT_MIN_IV  = 6;       // only prune history once tempo is partially locked
const BPM_OUTLIER_RATIO = 0.13;    // reject intervals when locked (missed/double beat)
const BPM_IDLE_SOFT_MS  = 4500;    // gap → drop lock confidence, keep last BPM
const BPM_IDLE_HARD_MS  = 14000;   // gap → full tempo reset
const BPM_MIN_INTERVALS = 3;       // intervals before full median lock
const BPM_CONF_SMOOTH   = 0.78;    // display confidence smoothing

/** Half/double companions for DJ vs catalog counting (e.g. ~174 live vs ~65 Beatport). */
/** Pick octave variant closest to current estimate (avoids 87 ↔ 174 flipping). */
function normalizeBeatInterval(ms, anchorBpm) {
  if (ms < BEAT_MIN_GAP_MS) return null;
  const candidates = [];
  for (const mul of [0.25, 0.5, 1, 2, 4]) {
    const iv = ms * mul;
    if (iv < BEAT_MIN_GAP_MS) continue;
    const bpm = 60000 / iv;
    if (bpm >= BPM_MIN && bpm <= BPM_MAX) candidates.push({ iv, bpm });
  }
  if (!candidates.length) return null;
  if (anchorBpm != null && Number.isFinite(anchorBpm)) {
    candidates.sort((a, b) => Math.abs(a.bpm - anchorBpm) - Math.abs(b.bpm - anchorBpm));
    return candidates[0].iv;
  }
  // No anchor yet: prefer slow–mid tempos when doubling/halving is ambiguous.
  const slowBand = candidates.filter((c) => c.bpm >= BPM_MIN && c.bpm <= 105);
  if (slowBand.length) {
    slowBand.sort((a, b) => Math.abs(a.bpm - 88) - Math.abs(b.bpm - 88));
    return slowBand[0].iv;
  }
  candidates.sort((a, b) => Math.abs(a.bpm - 100) - Math.abs(b.bpm - 100));
  return candidates[0].iv;
}

function beatMinGapMs(estimateBpm) {
  if (estimateBpm == null || !Number.isFinite(estimateBpm) || estimateBpm <= 0) {
    return BEAT_MIN_GAP_MS;
  }
  // Wider spacing for slow tracks — ignore hi-hat/subdivision onsets between kicks.
  const fromTempo = Math.floor(60000 / (estimateBpm * 2.15));
  return Math.max(BEAT_MIN_GAP_MS, Math.min(520, fromTempo));
}

/** Display-only bounds for half/double readouts (wider than beat-detection BPM range). */
const BPM_ALT_MIN = 30;
const BPM_ALT_MAX = 400;

function bpmAlternates(bpm) {
  if (bpm == null || !Number.isFinite(bpm)) {
    return { bpm_halftime: null, bpm_doubletime: null };
  }
  const half = Math.round(bpm / 2);
  const dbl = Math.round(bpm * 2);
  return {
    bpm_halftime: half >= BPM_ALT_MIN && half <= BPM_ALT_MAX ? half : null,
    bpm_doubletime: dbl >= BPM_ALT_MIN && dbl <= BPM_ALT_MAX ? dbl : null,
  };
}

// ─── ffmpeg Path ──────────────────────────────────────────────────────────────

function getFfmpegPath() {
  const dirs = [
    process.pkg ? path.dirname(process.execPath) : __dirname,
    process.cwd(),
  ];
  for (const dir of dirs) {
    for (const name of ['ffmpeg.exe', 'ffmpeg']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return p;
    }
  }
  return 'ffmpeg'; // fall back to PATH
}

// ─── Platform Detection ───────────────────────────────────────────────────────

function getPlatformFormat() {
  if (process.platform === 'win32')  return 'dshow';
  if (process.platform === 'darwin') return 'avfoundation';
  return 'pulse';
}

// ─── IIR Low-pass Filter ──────────────────────────────────────────────────────
// First-order: y[n] = (1-a)*x[n] + a*y[n-1]  where a = exp(-2π·fc/fs)

class LpFilter {
  constructor(fc) {
    this._a = Math.exp(-2 * Math.PI * fc / SAMPLE_RATE);
    this._y = 0;
  }
  tick(x) {
    this._y = (1 - this._a) * x + this._a * this._y;
    return this._y;
  }
  reset() { this._y = 0; }
}

// ─── Per-frame Band Analysis ──────────────────────────────────────────────────
// Runs four independent LP filters on raw PCM and derives five bands by subtraction.
// Each band's energy is the RMS of the band-limited signal over the frame.

function analyzeFrame(frameBuf, filters, gain) {
  const { lp80, lp250, lp2000, lp6000 } = filters;
  const count = Math.floor(frameBuf.length / 2);

  let ssSubBass = 0, ssBass = 0, ssMid = 0, ssUpperMid = 0, ssTreble = 0, ssAll = 0;

  for (let i = 0; i < count; i++) {
    // s16le → normalised float, apply gain, then clamp to ±1
    const raw = frameBuf.readInt16LE(i * 2) / 32768;
    const x   = Math.max(-1, Math.min(1, raw * gain));

    const o80   = lp80.tick(x);
    const o250  = lp250.tick(x);
    const o2000 = lp2000.tick(x);
    const o6000 = lp6000.tick(x);

    // Derive band signals by subtraction
    const bSub    = o80;
    const bBass   = o250   - o80;
    const bMid    = o2000  - o250;
    const bUpper  = o6000  - o2000;
    const bTreble = x      - o6000;

    ssSubBass  += bSub    * bSub;
    ssBass     += bBass   * bBass;
    ssMid      += bMid    * bMid;
    ssUpperMid += bUpper  * bUpper;
    ssTreble   += bTreble * bTreble;
    ssAll      += x       * x;
  }

  const rms = (ss) => Math.min(1, Math.sqrt(ss / count));

  return {
    sub_bass:  rms(ssSubBass),
    bass:      rms(ssBass),
    mid:       rms(ssMid),
    upper_mid: rms(ssUpperMid),
    treble:    rms(ssTreble),
    energy:    rms(ssAll),
  };
}

// ─── Device Listing ───────────────────────────────────────────────────────────

/**
/**
 * List available audio input devices using ffmpeg.
 * Returns an array of { name, format, label? }.
 *
 * Windows strategy:
 *   - dshow  : standard WDM input devices (microphones, line-in)
 *   - openal : superset — includes dshow devices PLUS loopback sources
 *              (Stereo Mix) that dshow hides, and often exposes the WDM
 *              driver of ASIO interfaces.
 *
 * ASIO note: ffmpeg has no native ASIO input format. ASIO interfaces
 * always install a parallel WDM/DirectShow driver and appear in the
 * scan as regular dshow/openal devices (e.g. "Line (Focusrite USB)").
 * If your device does NOT appear, install FlexASIO or route through
 * VoiceMeeter to bridge ASIO → WDM.
 */
async function listAudioDevices() {
  const ffmpeg = getFfmpegPath();
  const fmt    = getPlatformFormat();

  // ── Windows ───────────────────────────────────────────────────────────────
  if (fmt === 'dshow') {
    // Run dshow and openal scans in parallel; merge, preferring openal for
    // any device not already in the dshow list (e.g. Stereo Mix loopback).
    const [dshowDevices, openalDevices] = await Promise.all([
      _listDshow(ffmpeg),
      _listOpenAL(ffmpeg),
    ]);
    const seen = new Set(dshowDevices.map(d => d.name));
    for (const d of openalDevices) {
      // openal prefixes names with "OpenAL Soft on " — strip that
      if (!seen.has(d.name)) {
        dshowDevices.push(d);
        seen.add(d.name);
      }
    }
    return dshowDevices;
  }

  // ── macOS ─────────────────────────────────────────────────────────────────
  if (fmt === 'avfoundation') {
    return _listAvfoundation(ffmpeg);
  }

  // ── Linux ─────────────────────────────────────────────────────────────────
  return _listPulse(ffmpeg);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _runFfmpegList(ffmpeg, args, timeoutMs = 7000) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let out = '';
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => resolve(out));
    proc.on('error', () => resolve(''));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(out); }, timeoutMs);
  });
}

async function _listDshow(ffmpeg) {
  const out = await _runFfmpegList(ffmpeg, [
    '-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
  ]);
  const devices = [];

  // ffmpeg dshow output has two formats depending on version:
  //
  // Modern (per-line markers):
  //   [dshow @ ADDR] "Device Name" (audio)
  //
  // Older (section headers):
  //   [dshow @ ADDR] DirectShow audio devices (some may be faster, using vfwcap)
  //   [dshow @ ADDR]  "Device Name"
  //   [dshow @ ADDR]    Alternative name "..."
  //
  // We handle both by first trying the marker approach, then falling back to headers.

  let usedMarker = false;
  for (const line of out.split('\n')) {
    // Marker format: line ends with  (audio)
    if (/\(audio\)\s*$/.test(line)) {
      const m = line.match(/"([^"]+)"/);
      if (m) { devices.push({ name: m[1], format: 'dshow' }); usedMarker = true; }
    }
  }

  if (!usedMarker) {
    // Header format fallback
    let inAudio = false;
    for (const line of out.split('\n')) {
      if (/DirectShow audio devices/i.test(line))  { inAudio = true;  continue; }
      if (inAudio && /DirectShow video devices/i.test(line)) break;
      if (inAudio && !/Alternative name/i.test(line)) {
        const m = line.match(/"([^"]+)"/);
        if (m) devices.push({ name: m[1], format: 'dshow' });
      }
    }
  }

  return devices;
}

async function _listOpenAL(ffmpeg) {
  const out = await _runFfmpegList(ffmpeg, [
    '-hide_banner', '-list_devices', 'true', '-f', 'openal', '-i', 'dummy',
  ]);
  const devices = [];
  const PREFIX = 'OpenAL Soft on ';
  for (const line of out.split('\n')) {
    // [openal @ ADDR]   OpenAL Soft on Device Name
    const m = line.match(/\]\s+(OpenAL Soft on .+)/);
    if (m) {
      const raw  = m[1].trim();
      const name = raw.startsWith(PREFIX) ? raw.slice(PREFIX.length).trim() : raw;
      devices.push({ name, format: 'openal' });
    }
  }
  return devices;
}

async function _listDshow(ffmpeg) {
  const out = await _runFfmpegList(ffmpeg, [
    '-hide_banner', '-list_devices', 'true', '-f', 'avfoundation', '-i', '""',
  ]);
  const devices = [];
  let inAudio = false;
  for (const line of out.split('\n')) {
    if (/AVFoundation audio devices/i.test(line)) { inAudio = true; continue; }
    if (inAudio && /AVFoundation video devices/i.test(line)) break;
    if (inAudio) {
      const m = line.match(/\[(\d+)\]\s+(.+)/);
      if (m) devices.push({ name: m[2].trim(), id: m[1], format: 'avfoundation' });
    }
  }
  return devices;
}

async function _listPulse(ffmpeg) {
  // Try pactl first (more reliable source listing)
  const pactlOut = await new Promise((resolve) => {
    const proc = spawn('pactl', ['list', 'short', 'sources'], { windowsHide: true });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => resolve(out));
    proc.on('error', () => resolve(''));
    setTimeout(() => { try { proc.kill(); } catch {} resolve(out); }, 5000);
  });

  if (pactlOut.trim()) {
    return pactlOut.split('\n')
      .filter(Boolean)
      .map(line => {
        const parts = line.split('\t');
        return parts[1] ? { name: parts[1].trim(), format: 'pulse' } : null;
      })
      .filter(Boolean);
  }

  // Fallback: ffmpeg pulse list
  const out = await _runFfmpegList(ffmpeg, [
    '-hide_banner', '-f', 'pulse', '-list_devices', 'true', '-i', 'default',
  ]);
  const devices = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*\d+\s+(\S+)/);
    if (m) devices.push({ name: m[1], format: 'pulse' });
  }
  return devices;
}

// ─── AudioInputCapture ────────────────────────────────────────────────────────

const SPECTRUM_BINS = 48;
const SPECTRUM_FFT_SIZE = 128;

const ZERO_LEVELS = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0, beat: 0 };

/** Magnitude bins from a short PCM frame (music-reactive visualizer). */
function computeMagnitudeSpectrum(frameBuf, gain, numBins) {
  const count = Math.min(SPECTRUM_FFT_SIZE, Math.floor(frameBuf.length / 2));
  if (count < 8) return new Array(numBins).fill(0);

  const out = new Array(numBins).fill(0);
  for (let k = 0; k < numBins; k++) {
    const bin = k + 1;
    let re = 0;
    let im = 0;
    for (let t = 0; t < count; t++) {
      const raw = frameBuf.readInt16LE(t * 2) / 32768;
      const x = Math.max(-1, Math.min(1, raw * gain));
      const ang = (2 * Math.PI * bin * t) / count;
      re += x * Math.cos(ang);
      im -= x * Math.sin(ang);
    }
    const mag = Math.sqrt(re * re + im * im) / count;
    // Log-style lift + slight treble emphasis so the full bar row reacts to music.
    const trebleBoost = 0.75 + (k / Math.max(1, numBins - 1)) * 0.55;
    out[k] = Math.min(1, Math.pow(mag * 7 * trebleBoost, 0.72));
  }
  return out;
}

class AudioInputCapture extends EventEmitter {
  constructor() {
    super();
    this._proc          = null;
    this._running       = false;
    this._error         = null;
    this._deviceName    = null;
    this._format        = getPlatformFormat();
    this._gain          = 1.0;
    this._buf           = Buffer.alloc(0);
    this._filters       = null;
    this._smooth        = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0 };
    this._smoothDmx     = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0 };
    this._beatTime      = 0;
    this._prevBass      = 0;
    this._prevPulse     = 0;
    this._broadcastTimer = null;
    this._lastBeatForBpm = 0;
    this._beatIntervals  = [];
    this._bpmEstimate    = null;
    this._bpmDisplay     = null;
    this._bpmConfidence  = 0;
    this._bpmConfSmooth  = 0;
    this._spectrumSmooth = new Array(SPECTRUM_BINS).fill(0);
  }

  get running()     { return this._running; }
  get error()       { return this._error; }
  get deviceName()  { return this._deviceName; }
  get format()      { return this._format; }

  /** Current smoothed levels including beat (0–1) and tempo estimate. Fast response — for UI display. */
  getLevels() {
    this._tickBpmIdleReset();
    const beatAge = Date.now() - this._beatTime;
    const beat    = this._running ? Math.max(0, 1 - beatAge / BEAT_DECAY_MS) : 0;
    const bpmOut = this._bpmDisplay != null ? this._bpmDisplay : this._bpmEstimate;
    const alts = bpmAlternates(bpmOut);
    return {
      ...this._smooth,
      beat,
      bpm: bpmOut,
      bpm_confidence: this._bpmConfSmooth,
      spectrum: this._spectrumSmooth.slice(),
      ...alts,
    };
  }

  /** Latest estimated tempo (BPM) from live beat onsets, or null if not enough data. */
  getBpmEstimate() {
    this._tickBpmIdleReset();
    const bpmOut = this._bpmDisplay != null ? this._bpmDisplay : this._bpmEstimate;
    const alts = bpmAlternates(bpmOut);
    return {
      bpm: bpmOut,
      bpm_confidence: this._bpmConfSmooth,
      beat_intervals: this._beatIntervals.length,
      ...alts,
    };
  }

  /** Heavily-smoothed levels for DMX effects — reduces flickering on lights. */
  getDmxLevels() {
    const beatAge = Date.now() - this._beatTime;
    const beat    = this._running ? Math.max(0, 1 - beatAge / BEAT_DECAY_MS) : 0;
    return { ...this._smoothDmx, beat };
  }

  /** Start capturing from the given device. Stops any existing capture first. */
  start(deviceName, format, gain) {
    this.stop();

    this._deviceName = deviceName;
    this._format     = format || getPlatformFormat();
    this._gain       = (typeof gain === 'number' && gain > 0) ? gain : 1.0;
    this._error      = null;
    this._smooth     = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0 };
    this._smoothDmx  = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0 };
    this._prevBass   = 0;
    this._prevPulse  = 0;
    this._resetBpmState();
    this._resetFilters();

    const ffmpeg = getFfmpegPath();

    // Build ffmpeg args for the chosen platform format.
    // dshow loopback: use format 'dshow_loopback' to signal that the device
    // name should NOT be prefixed with 'audio=' — it is already a raw dshow name
    // as returned by list (e.g. "Stereo Mix (Realtek)").
    let args;
    // ── openal ─────────────────────────────────────────────────────────────
    // -i "Device Name"  (no audio= prefix)
    if (this._format === 'openal') {
      args = [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'openal',
        '-buffer_size', '30',          // reduce capture latency to ~30 ms
        '-i', deviceName,
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1',
        'pipe:1',
      ];
    } else if (this._format === 'dshow_loopback' || this._format === 'dshow') {
      args = [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'dshow',
        '-audio_buffer_size', '30',    // reduce dshow capture latency to ~30 ms
        '-i', `audio=${deviceName}`,
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1',
        'pipe:1',
      ];
    } else if (this._format === 'avfoundation') {
      args = [
        '-hide_banner', '-loglevel', 'error',
        '-f', 'avfoundation',
        '-i', `:${deviceName}`,
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1',
        'pipe:1',
      ];
    } else {
      // PulseAudio / ALSA
      args = [
        '-hide_banner', '-loglevel', 'error',
        '-f', this._format,
        '-i', deviceName,
        '-f', 's16le', '-ar', String(SAMPLE_RATE), '-ac', '1',
        'pipe:1',
      ];
    }

    this._proc = spawn(ffmpeg, args, { windowsHide: true });

    this._proc.stdout.on('data', (chunk) => {
      this._buf = Buffer.concat([this._buf, chunk]);
      while (this._buf.length >= FRAME_BYTES) {
        const frame   = this._buf.slice(0, FRAME_BYTES);
        this._buf     = this._buf.slice(FRAME_BYTES);
        this._onFrame(frame);
      }
    });

    this._proc.stderr.on('data', (data) => {
      const txt = data.toString().trim();
      // Filter out routine startup/teardown noise; only capture genuine errors
      if (txt && /error|no such|cannot open|invalid|failed/i.test(txt)) {
        const lines = txt.split('\n').filter(l => !/^\s*(Last message|ffmpeg version)/i.test(l));
        if (lines.length) this._error = lines[lines.length - 1].substring(0, 250);
      }
    });

    this._proc.on('close', (code) => {
      this._running = false;
      this._proc    = null;
      this._stopBroadcast();
      if (code !== 0 && !this._error) this._error = `ffmpeg exited with code ${code}`;
      this.emit('stopped', { error: this._error });
    });

    this._proc.on('error', (err) => {
      this._error   = err.message;
      this._running = false;
      this._proc    = null;
      this._stopBroadcast();
      this.emit('stopped', { error: this._error });
    });

    this._running = true;
    this._startBroadcast();
    this.emit('started', { deviceName, format: this._format });
  }

  /** Stop the active capture (no-op if not running). */
  stop() {
    this._stopBroadcast();
    if (this._proc) {
      try { this._proc.kill('SIGTERM'); } catch {}
      try { this._proc.kill();          } catch {} // Windows fallback
      this._proc = null;
    }
    this._running = false;
    this._buf     = Buffer.alloc(0);
    this._spectrumSmooth.fill(0);
    this._resetBpmState();
    this._resetFilters();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _resetBpmState() {
    this._lastBeatForBpm = 0;
    this._beatIntervals  = [];
    this._bpmEstimate    = null;
    this._bpmDisplay     = null;
    this._bpmConfidence  = 0;
    this._bpmConfSmooth  = 0;
  }

  _touchBpmDisplay() {
    if (this._bpmEstimate == null) {
      this._bpmDisplay = null;
      return;
    }
    if (this._bpmDisplay == null) this._bpmDisplay = this._bpmEstimate;
    else {
      this._bpmDisplay =
        this._bpmDisplay * BPM_DISPLAY_SMOOTH + this._bpmEstimate * (1 - BPM_DISPLAY_SMOOTH);
    }
  }

  _softBpmIdle() {
    this._beatIntervals = [];
    this._lastBeatForBpm = 0;
    this._bpmConfidence = Math.min(this._bpmConfidence, 0.18);
    this._bpmConfSmooth = Math.min(this._bpmConfSmooth, 0.18);
  }

  _tickBpmIdleReset() {
    if (!this._running || !this._beatTime) return;
    const idle = Date.now() - this._beatTime;
    const beatMs = this._bpmEstimate > 0 ? 60000 / this._bpmEstimate : 500;
    const softMs = Math.max(BPM_IDLE_SOFT_MS, beatMs * 5.5);
    const hardMs = Math.max(BPM_IDLE_HARD_MS, beatMs * 14);
    if (idle > hardMs) this._resetBpmState();
    else if (idle > softMs) this._softBpmIdle();
  }

  _noteBeatForBpm(now) {
    if (this._lastBeatForBpm > 0) {
      const normalized = normalizeBeatInterval(now - this._lastBeatForBpm, this._bpmEstimate);
      if (normalized != null) {
        const ivBpm = 60000 / normalized;
        const ref = this._bpmDisplay != null ? this._bpmDisplay : this._bpmEstimate;
        const locked = this._bpmConfSmooth >= 0.42 && ref != null;
        if (!locked || Math.abs(ivBpm - ref) / ref <= BPM_OUTLIER_RATIO) {
          this._beatIntervals.push(normalized);
          if (this._beatIntervals.length > BPM_HISTORY_SIZE) this._beatIntervals.shift();
          this._updateBpmEstimate();
        }
      }
    }
    this._lastBeatForBpm = now;
  }

  _updateBpmEstimate() {
    let intervals = this._beatIntervals;
    const n = intervals.length;
    if (n === 0) {
      this._bpmConfidence = 0;
      return;
    }
    if (n < BPM_MIN_INTERVALS) {
      const rawBpm = 60000 / intervals[n - 1];
      if (this._bpmEstimate == null) this._bpmEstimate = rawBpm;
      else this._bpmEstimate = this._bpmEstimate * 0.75 + rawBpm * 0.25;
      const target = (n / BPM_MIN_INTERVALS) * 0.32;
      this._bpmConfidence = target;
      this._bpmConfSmooth = this._bpmConfSmooth * BPM_CONF_SMOOTH + target * (1 - BPM_CONF_SMOOTH);
      this._touchBpmDisplay();
      return;
    }

    const latestInterval = intervals[n - 1];
    const latestBpm = 60000 / latestInterval;

    // Tempo changed: drop older intervals that belong to the previous BPM.
    let smooth = BPM_SMOOTH;
    if (this._bpmEstimate != null && n >= BPM_SHIFT_MIN_IV && this._bpmConfidence >= 0.3) {
      const shift = Math.abs(latestBpm - this._bpmEstimate) / this._bpmEstimate;
      if (shift > BPM_JUMP_RATIO) {
        smooth = BPM_SMOOTH_FAST;
        intervals = intervals.filter(
          (iv) => Math.abs(iv - latestInterval) / latestInterval <= BPM_INTERVAL_TOL,
        );
        if (intervals.length >= BPM_MIN_INTERVALS) {
          this._beatIntervals = intervals;
        }
      }
    }

    const recentN = Math.min(intervals.length, BPM_RECENT_WINDOW);
    const recent = intervals.slice(-recentN);
    const sorted = [...recent].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const rawBpm = 60000 / median;

    const mean = recent.reduce((a, b) => a + b, 0) / recentN;
    const variance = recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recentN;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const cvScale = rawBpm <= 105 ? 2.05 : 2.5;
    const conf = Math.max(0, Math.min(1, 1 - cv * cvScale));

    if (
      this._bpmEstimate != null &&
      this._bpmEstimate > 112 &&
      rawBpm <= this._bpmEstimate * 0.56 &&
      n >= 4
    ) {
      this._bpmEstimate = this._bpmEstimate * 0.5 + rawBpm * 0.5;
      smooth = BPM_SMOOTH_FAST;
    } else if (this._bpmEstimate == null) this._bpmEstimate = rawBpm;
    else this._bpmEstimate = this._bpmEstimate * (1 - smooth) + rawBpm * smooth;
    this._bpmConfidence = conf;
    this._bpmConfSmooth = this._bpmConfSmooth * BPM_CONF_SMOOTH + conf * (1 - BPM_CONF_SMOOTH);
    this._touchBpmDisplay();
  }

  _resetFilters() {
    this._filters = {
      lp80:   new LpFilter(80),
      lp250:  new LpFilter(250),
      lp2000: new LpFilter(2000),
      lp6000: new LpFilter(6000),
    };
  }

  _onFrame(frameBuf) {
    const raw = analyzeFrame(frameBuf, this._filters, this._gain);

    const specs = computeMagnitudeSpectrum(frameBuf, this._gain, SPECTRUM_BINS);
    for (let i = 0; i < SPECTRUM_BINS; i++) {
      const v = specs[i];
      const prev = this._spectrumSmooth[i];
      const alpha = v > prev ? 0.38 : 0.72;
      this._spectrumSmooth[i] = prev * alpha + v * (1 - alpha);
    }

    // Exponential smoothing — two separate strategies:
    //   _smooth    : single alpha, fast, for the UI meter
    //   _smoothDmx : asymmetric attack/decay — jumps up fast, falls back naturally
    //                prevents flickering while keeping VU bar snappy
    for (const k of Object.keys(raw)) {
      if (k === 'energy') {
        const prev = this._smooth[k];
        const alpha = raw[k] > prev ? ENERGY_ATTACK : ENERGY_DECAY;
        this._smooth[k] = prev * alpha + raw[k] * (1 - alpha);
      } else {
        this._smooth[k] = this._smooth[k] * LEVEL_SMOOTH + raw[k] * (1 - LEVEL_SMOOTH);
      }
      const prev = this._smoothDmx[k];
      const alpha = raw[k] > prev ? DMX_ATTACK : DMX_DECAY;
      this._smoothDmx[k] = prev * alpha + raw[k] * (1 - alpha);
    }

    // Beat detection: bass/sub-bass (+ soft energy) for quiet or slow material
    const pulse = Math.max(raw.bass, raw.sub_bass, raw.energy * 0.38);
    const delta = pulse - this._prevPulse;
    const now   = Date.now();
    const slowHint =
      (this._bpmEstimate != null && this._bpmEstimate > 0 && this._bpmEstimate < 102) ||
      (this._bpmEstimate == null && this._beatTime > 0 && (now - this._beatTime) > 520);
    const levelFloor = Math.max(
      slowHint ? 0.02 : 0.028,
      this._smooth.bass * (slowHint ? 0.3 : 0.42),
      this._smooth.energy * (slowHint ? 0.14 : 0),
    );
    const deltaThr = Math.max(slowHint ? 0.006 : 0.009, this._smooth.bass * (slowHint ? 0.038 : 0.055));
    let minGap = beatMinGapMs(this._bpmEstimate);
    if (this._bpmEstimate == null && this._beatTime > 0) {
      const sinceBeat = now - this._beatTime;
      if (sinceBeat > 520) minGap = Math.max(minGap, Math.floor(sinceBeat * 0.4));
    }
    if (delta > deltaThr && pulse > levelFloor && (now - this._beatTime) > minGap) {
      this._beatTime = now;
      this._noteBeatForBpm(now);
      this.emit('beat', { time: now, bpm: this._bpmEstimate, bpm_confidence: this._bpmConfidence });
    }
    this._prevPulse = pulse;
    this._prevBass  = raw.bass;
  }

  _startBroadcast() {
    this._stopBroadcast();
    this._broadcastTimer = setInterval(() => {
      if (this._running) this.emit('levels', this.getLevels());
    }, BROADCAST_MS);
  }

  _stopBroadcast() {
    if (this._broadcastTimer) {
      clearInterval(this._broadcastTimer);
      this._broadcastTimer = null;
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

const capture = new AudioInputCapture();

module.exports = { capture, listAudioDevices, getPlatformFormat };
