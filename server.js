/**
 * DMX Controller Server
 * 
 * - Advertises as an OS2L service via Bonjour/mDNS
 * - Accepts TCP connections from VirtualDJ
 * - Sends trigger subscriptions to get deck data
 * - Pushes real-time state to web clients via WebSocket
 * - Serves the web UI
 */

// ─── pkg native-addon resolver ──────────────────────────────────────────────
// When running as a packaged exe, native .node addons live next to the
// executable but the 'bindings' / 'node-gyp-build' helpers look inside the
// read-only snapshot.  Intercept failed .node resolves and redirect to the
// exe directory so every native module loads transparently.
if (process.pkg) {
  const path = require('path');
  const fs   = require('fs');
  const Module = require('module');
  const EXE_DIR = path.dirname(process.execPath);
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    try {
      return origResolve.call(this, request, parent, isMain, options);
    } catch (e) {
      // Only intercept .node files that pkg refused to serve from the snapshot
      if (request.endsWith('.node') && /not included|not find|qualified_path/i.test(e.message)) {
        const local = path.join(EXE_DIR, path.basename(request));
        if (fs.existsSync(local)) return local;
      }
      throw e;
    }
  };
}
// ─────────────────────────────────────────────────────────────────────────────

const http = require('http');
const path = require('path');
const fs = require('fs');
const express = require('express');
const { WebSocketServer } = require('ws');
const Bonjour = require('bonjour-service').Bonjour;
const mdns = require('multicast-dns');
const db = require('./db');
const ArtNetServer = require('./artnet-server');
const DmxUsbServer = require('./dmx-usb-server');
const audioAnalyzer = require('./audio-analyzer');
const os2l = require('./os2l');
const fixtureLibrary = require('./fixture-library');
const { WebUSB } = require('usb');

// ─── Configuration ──────────────────────────────────────────────────────────

const OS2L_PORT = 8787;
const WEB_PORT = 3000;
const SERVICE_NAME = 'DMX-Controller';
const MDNS_HOSTNAME_DEFAULT = 'dmxcontrol';

// ─── State ──────────────────────────────────────────────────────────────────

const state = {
  decks: {},
  crossfader: 0,
  connected: false,
  vdjAddress: null,
};

for (let d = 1; d <= 4; d++) {
  state.decks[d] = {
    filepath: '',
    filename: '',
    soundswitch_id: '',
    genre: '',
    level: 0,
    time: 0,
    beatpos: 0,
    firstbeat: 0,
    bpm: 0,
    play: 0,
    loop: 0,
    get_loop: 0,
    loop_roll: 0,
  };
}

// ─── WebSocket Broadcast ────────────────────────────────────────────────────

let wsClients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.readyState === 1) { // OPEN
      ws.send(msg);
    }
  }
}

// ─── Console Log Interception (broadcast to WebSocket clients) ────────────

const _origLog = console.log;
const _origWarn = console.warn;
const _origError = console.error;

function _broadcastLog(level, args) {
  const message = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  // Avoid broadcasting state/throttle noise
  broadcast({ type: 'server_log', level, message, ts: Date.now() });
}

console.log = function (...args) {
  _origLog.apply(console, args);
  _broadcastLog('info', args);
};
console.warn = function (...args) {
  _origWarn.apply(console, args);
  _broadcastLog('warn', args);
};
console.error = function (...args) {
  _origError.apply(console, args);
  _broadcastLog('error', args);
};

// Throttled state broadcast (send full state at ~30fps max)
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast({ type: 'state', state });
  }, 33); // ~30fps
}

// ─── OS2L Message Handler (subscribed triggers) ────────────────────────────
// This callback is invoked by os2l.js when a "subscribed" event arrives.
// It stays here because it's tightly coupled with the sequencer subsystem.

function handleOs2lSubscribed(data) {
    const trigger = data.trigger;
    const value = data.value;

    if (!trigger) return;

    const { deck, key } = os2l.parseTrigger(trigger);

    // Debug: log filepath events to confirm deck 2 is receiving data
    if (key === 'filepath') {
      if (db.getConfig('debug_logging') === '1') console.log(`[OS2L-DEBUG] Deck ${deck} filepath = "${value}"`);
    }

    if (key === 'crossfader') {
      state.crossfader = value;
      scheduleBroadcast();
      return;
    }

    if (deck === null || !state.decks[deck]) return;

    // Normalize "on"/"off" string values to 1/0 for play, loop, etc.
    if (typeof value === 'string') {
      if (value === 'on')  state.decks[deck][key] = 1;
      else if (value === 'off') state.decks[deck][key] = 0;
      else state.decks[deck][key] = value;
    } else {
      state.decks[deck][key] = value;
    }

    // Update track beatgrid_pos from live firstbeat if the track exists and has no beatgrid
    if (key === 'firstbeat' && typeof value === 'number' && value > 0) {
      const fbSecs = value > 60 ? value / 1000 : value; // normalise ms → s
      const fbPath = state.decks[deck].filepath;
      if (fbPath) {
        const fbTrack = db.getTrackByPath(fbPath);
        if (fbTrack && (!fbTrack.beatgrid_pos || fbTrack.beatgrid_pos === 0)) {
          db.updateTrackBeatgridPos(fbTrack.id, fbSecs);
        }
      }
    }

    // Extract filename from filepath
    if (key === 'filepath' && typeof value === 'string' && value) {
      const parts = value.replace(/\\\\/g, '\\').split('\\');
      state.decks[deck].filename = parts[parts.length - 1] || value;

      // ─── Sequencer auto-load / auto-play / auto-generate ─────
      const seqAutoLoad = db.getConfig('seq_auto_load') === '1';
      const seqAutoUnload = db.getConfig('seq_auto_unload') === '1';
      const seqAutoGenerate = db.getConfig('seq_auto_generate') === '1';
      if (db.getConfig('debug_logging') === '1') console.log(`[OS2L-DEBUG] Deck ${deck} auto-load=${seqAutoLoad} auto-unload=${seqAutoUnload} auto-gen=${seqAutoGenerate}`);
      if (seqAutoLoad || seqAutoUnload || seqAutoGenerate) {
        const track = db.getTrackByPath(value);
        let seq = track ? db.getSequenceByTrackId(track.id) : null;
        if (db.getConfig('debug_logging') === '1') console.log(`[OS2L-DEBUG] Deck ${deck} track=${track ? track.id : 'null'} seq=${seq ? seq.id : 'null'}`);

        // Auto-generate sequence if none exists and feature is enabled
        if (!seq && track && seqAutoGenerate) {
          (async () => {
            try {
              console.log(`[SEQ] Auto-generating sequence for track ${track.id} ("${track.title || track.filename}")...`);
              const fixtures = db.getFixtureChannelMap();
              let analysis = db.getTrackAnalysis(track.id);

              // Auto-analyze if needed (use live firstbeat as fallback)
              // Use the OS2L filepath (value) for file access since the DB may have a stale drive letter
              const actualFilePath = value;
              const fileExists = actualFilePath ? require('fs').existsSync(actualFilePath) : false;
              if (!analysis && actualFilePath && fileExists) {
                try {
                  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
                  if (ffmpegOk) {
                    const liveFirstbeatForAnalysis = state.decks[deck] && state.decks[deck].firstbeat;
                    let analysisBeatgridPos = track.beatgrid_pos || 0;
                    if (!analysisBeatgridPos && liveFirstbeatForAnalysis > 0) {
                      analysisBeatgridPos = liveFirstbeatForAnalysis > 60 ? liveFirstbeatForAnalysis / 1000 : liveFirstbeatForAnalysis;
                    }
                    console.log(`[SEQ] Auto-analyzing "${track.title || track.filename}" before sequence generation...`);
                    const result = await audioAnalyzer.analyzeTrack(actualFilePath, {
                      bpm: track.bpm || 0,
                      beatgridPos: analysisBeatgridPos,
                      config: getAnalysisConfig(),
                    });
                    db.upsertTrackAnalysis(track.id, result);
                    analysis = db.getTrackAnalysis(track.id);
                    broadcast({ type: 'analysis_complete', track_id: track.id });
                  }
                } catch (ae) {
                  console.warn(`[SEQ] Auto-analysis failed for auto-gen: ${ae.message}`);
                }
              }

              // Use live firstbeat from OS2L as fallback for beatgridPos
              const liveFirstbeat = state.decks[deck] && state.decks[deck].firstbeat;
              let fbPos = track.beatgrid_pos || 0;
              if (!fbPos && liveFirstbeat > 0) {
                fbPos = liveFirstbeat > 60 ? liveFirstbeat / 1000 : liveFirstbeat;
              }
              const genResult = sequenceGenerator.generateSequence({
                track: { ...track, beatgrid_pos: fbPos }, fixtures, analysis,
                effects: db.getEffects(),
                moverPresets: db.getMoverPresets(),
                noStrobes: db.getConfig('seq_no_strobes') === '1',
              });
              const newSeq = db.createSequence({
                name: track.title || track.filename || 'Untitled',
                track_id: track.id,
                bpm: genResult.bpm,
                duration_ms: genResult.durationMs,
              });
              if (genResult.cues.length > 0) db.bulkUpdateCues(newSeq.id, genResult.cues);
              const generatedSeq = db.getSequence(newSeq.id);
              broadcast({ type: 'seq_generated', track_id: track.id, sequence: generatedSeq });
              console.log(`[SEQ] Auto-generated sequence "${generatedSeq.name}" (${genResult.cues.length} cues) for deck ${deck}`);

              // Now auto-load if enabled
              if (seqAutoLoad) {
                // Clear any OS2L button overrides so the new sequence controls all fixtures
                touchOverrides.os2lOverrideFixtures.clear();
                touchOverrides.colorOverrideFixtures.clear();
                touchOverrides.movementOverrideFixtures.clear();
                deactivateScene(); // Stop any scene effect loop from end-action
                stopPlaybackTimer(deck);
                blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
                activeSequences[deck] = { sequence: generatedSeq, lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
                broadcast({ type: 'seq_loaded', deck, sequence: generatedSeq });
                console.log(`[SEQ] Auto-loaded generated sequence on deck ${deck} (duration=${generatedSeq.duration_ms}ms)`);

                // Always start playback after auto-generation. The generation
                // was triggered by a track-load event, so the deck is active.
                // Play state may be stale (VDJ sent play:0 for the old track
                // during async generation). If the deck truly isn't playing,
                // the play sync handler will pause on the next play:0 event.
                activeSequences[deck].playing = true;
                activeSequences[deck].vdjDriven = true;
                startPlaybackTimer(deck);
                broadcast({ type: 'seq_playing', deck, playing: true });
                console.log(`[SEQ] Auto-playing generated sequence on deck ${deck}`);
              }
            } catch (ge) {
              console.error(`[SEQ] Auto-generate failed for track ${track ? track.id : '?'}: ${ge.message}`);
            }
          })();
          // Async block handles load/play after generation completes
          scheduleBroadcast();
          return;
        }

        if (seq && seqAutoLoad) {
          // Auto-load the matched sequence onto this deck
          // Clear any OS2L button overrides so the new sequence controls all fixtures
          touchOverrides.os2lOverrideFixtures.clear();
          touchOverrides.colorOverrideFixtures.clear();
          touchOverrides.movementOverrideFixtures.clear();
          deactivateScene(); // Stop any scene effect loop from end-action
          stopPlaybackTimer(deck);
          blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
          activeSequences[deck] = { sequence: seq, lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
          broadcast({ type: 'seq_loaded', deck, sequence: seq });
          console.log(`[SEQ] Auto-loaded sequence "${seq.name}" on deck ${deck} (duration=${seq.duration_ms}ms)`);

          // Always start playback if the deck is currently playing
          const deckPlayState = state.decks[deck] && state.decks[deck].play;
          const deckIsPlaying = deckPlayState === 1 || deckPlayState === true || deckPlayState === 'on';
          console.log(`[SEQ] Deck ${deck} play state: ${JSON.stringify(deckPlayState)} → deckIsPlaying=${deckIsPlaying}`);
          if (deckIsPlaying) {
            activeSequences[deck].playing = true;
            activeSequences[deck].vdjDriven = true;
            startPlaybackTimer(deck);
            broadcast({ type: 'seq_playing', deck, playing: true });
            console.log(`[SEQ] Auto-playing sequence on deck ${deck}`);
          } else {
            console.log(`[SEQ] Deck ${deck} is not playing — sequence loaded but not started`);
          }
        } else if (seqAutoUnload && activeSequences[deck]) {
          // No matching sequence — unload the current one
          stopPlaybackTimer(deck);
          blackoutDeckFixtures(deck);
          delete activeSequences[deck];
          broadcast({ type: 'seq_unloaded', deck });
          console.log(`[SEQ] Auto-unloaded sequence from deck ${deck} (no match)`);
        }
      }
    }

    // ─── Sync sequence playback with deck play/pause state ─────
    if (key === 'play' && activeSequences[deck]) {
      const deckNowPlaying = state.decks[deck].play;  // already normalized to 1/0
      if (deckNowPlaying && !activeSequences[deck].playing) {
        // Deck started playing — resume the sequence
        deactivateScene(); // Stop any scene effect loop from end-action
        activeSequences[deck].playing = true;
        activeSequences[deck]._endActionApplied = false; // Reset so next end-action can fire
        startPlaybackTimer(deck);
        broadcast({ type: 'seq_playing', deck, playing: true });
        console.log(`[SEQ] Deck ${deck} playing — resuming sequence`);
      } else if (!deckNowPlaying && activeSequences[deck].playing) {
        // Deck stopped — check if this is a natural track end or a manual pause.
        const ds = activeSequences[deck];
        // Update currentTimeMs from standlone timer if active (non-VDJ)
        if (!ds.vdjDriven && playbackTimers[deck] && ds.startOffset != null) {
          ds.currentTimeMs = ds.startOffset + (Date.now() - ds.startWall);
        }
        // VDJ-driven: currentTimeMs is already set by the last time event

        const seqDur = ds.sequence && ds.sequence.duration_ms;
        const nearEnd = seqDur && ds.currentTimeMs >= seqDur - 5000;
        const endAction = _cachedMixerConfig.endAction;
        console.log(`[SEQ] Deck ${deck} stopped. currentTimeMs=${Math.round(ds.currentTimeMs)} seqDur=${seqDur} nearEnd=${nearEnd} endAction=${endAction}`);

        if (nearEnd && endAction && endAction !== 'none') {
          // Natural track end — apply configured end action
          applySequenceEndAction(deck);
        } else {
          // Manual pause — standard blackout
          ds.playing = false;
          stopPlaybackTimer(deck);
          blackoutDeckFixtures(deck);
          broadcast({ type: 'seq_playing', deck, playing: false });
          console.log(`[SEQ] Deck ${deck} paused — pausing sequence`);
        }
      }
    }

    // Drive sequence playback engine on VDJ time updates (VDJ sends time in ms)
    if (key === 'time' && typeof value === 'number') {
      if (activeSequences[deck]) {
        activeSequences[deck].vdjDriven = true;
        activeSequences[deck].currentTimeMs = value;
      }
      processSequenceAtTime(deck, value);
    }

    scheduleBroadcast();
}

// ─── Express Web Server ─────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: '200mb' }));
app.use('/lib', express.static(path.join(__dirname, 'node_modules/waveform-data/dist')));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Fixture Library Import API ──────────────────────────────────────────────

// Preview an OFL fixture library file (returns summary without importing)
app.post('/api/fixture-library/preview', (req, res) => {
  try {
    const summary = fixtureLibrary.summarizeOflLibrary(req.body);
    res.json(summary);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Import fixtures from OFL format into the fixture library
app.post('/api/fixture-library/import', (req, res) => {
  try {
    const { data, selectedFixtures } = req.body;
    const parsed = fixtureLibrary.parseOflLibrary(data);
    const results = { imported: 0, updated: 0, skipped: 0, errors: [...parsed.errors] };

    // If selectedFixtures specified, filter to only those indices
    let toImport = parsed.fixtures;
    if (selectedFixtures && Array.isArray(selectedFixtures)) {
      const selectedSet = new Set(selectedFixtures);
      toImport = parsed.fixtures.filter((_, i) => selectedSet.has(i));
    }

    for (const ft of toImport) {
      try {
        // Check for existing fixture type with same name + manufacturer
        const existing = db.getFixtureTypes().find(
          t => t.name === ft.name && t.manufacturer === ft.manufacturer
        );
        if (existing) {
          db.updateFixtureType(existing.id, ft);
          results.updated++;
        } else {
          db.createFixtureType(ft);
          results.imported++;
        }
      } catch (e) {
        results.errors.push(`"${ft.name}": ${e.message}`);
      }
    }

    results.total = results.imported + results.updated;
    res.json(results);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Fixture Type API ───────────────────────────────────────────────────────

app.get('/api/fixture-types', (req, res) => {
  res.json(db.getFixtureTypes());
});

// Lightweight summaries for dropdowns (no channels data)
app.get('/api/fixture-types/summaries', (req, res) => {
  res.json(db.getFixtureTypeSummaries());
});

// Paginated search for fixture library tab
app.get('/api/fixture-types/search', (req, res) => {
  const search = req.query.q || '';
  const category = req.query.category || '';
  const manufacturer = req.query.manufacturer || '';
  const limit = Math.min(Math.max(+req.query.limit || 50, 1), 200);
  const offset = Math.max(+req.query.offset || 0, 0);
  res.json(db.searchFixtureTypes({ search, category, manufacturer, limit, offset }));
});

app.get('/api/fixture-types/:id', (req, res) => {
  const t = db.getFixtureType(+req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/fixture-types', (req, res) => {
  try {
    const result = db.createFixtureType(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create an LED Bar fixture type with a cell-repeat pattern
app.post('/api/fixture-types/led-bar', (req, res) => {
  try {
    const result = db.createLedBarFixtureType(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create a multi-cell fixture type with optional master channels
app.post('/api/fixture-types/multi-cell', (req, res) => {
  try {
    const result = db.createMultiCellFixtureType(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixture-types/:id', (req, res) => {
  const result = db.updateFixtureType(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/fixture-types/:id', (req, res) => {
  const result = db.deleteFixtureType(+req.params.id);
  if (result.error) return res.status(409).json(result);
  res.json(result);
});

// ─── Fixture API ────────────────────────────────────────────────────────────

app.get('/api/fixtures', (req, res) => {
  res.json(db.getFixtures());
});

app.get('/api/fixtures/:id', (req, res) => {
  const f = db.getFixture(+req.params.id);
  f ? res.json(f) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/fixtures', (req, res) => {
  try {
    const result = db.createFixture(req.body);
    if (result.error) return res.status(400).json(result);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixtures/:id', (req, res) => {
  const result = db.updateFixture(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/fixtures/:id', (req, res) => {
  db.deleteFixture(+req.params.id);
  res.json({ deleted: true });
});

// ─── Universe Map API ───────────────────────────────────────────────────────

app.get('/api/universe/:num', (req, res) => {
  res.json(db.getUniverseMap(+req.params.num));
});

app.get('/api/fixture-channel-map', (req, res) => {
  res.json(db.getFixtureChannelMap());
});

// ─── Fixture Groups API ─────────────────────────────────────────────────────

app.get('/api/groups', (req, res) => {
  res.json(db.getGroups());
});

app.post('/api/groups', (req, res) => {
  const result = db.createGroup(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/groups/:id', (req, res) => {
  const result = db.updateGroup(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/groups/:id', (req, res) => {
  db.deleteGroup(+req.params.id);
  res.json({ deleted: true });
});

app.put('/api/groups/:id/fixtures', (req, res) => {
  const result = db.setGroupFixtures(+req.params.id, req.body.fixture_ids || []);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// ─── Subscriptions API ──────────────────────────────────────────────────────

app.get('/api/subscriptions', (req, res) => {
  res.json(db.getSubscriptions());
});

app.post('/api/subscriptions', (req, res) => {
  const result = db.createSubscription(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/subscriptions/:id', (req, res) => {
  const result = db.updateSubscription(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/subscriptions/:id', (req, res) => {
  db.deleteSubscription(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/subscriptions/:id/toggle', (req, res) => {
  const result = db.toggleSubscription(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/subscriptions/resend', (req, res) => {
  os2l.sendSubscription();
  const subs = db.getEnabledSubscriptions();
  res.json({ sent: true, count: subs.length, connected: os2l.isConnected() });
});

// ─── Mover Presets API ──────────────────────────────────────────────────────

app.get('/api/mover-presets', (req, res) => {
  res.json(db.getMoverPresets());
});

app.get('/api/mover-presets/:id', (req, res) => {
  const p = db.getMoverPreset(+req.params.id);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/mover-presets', (req, res) => {
  const result = db.createMoverPreset(req.body);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.put('/api/mover-presets/:id', (req, res) => {
  const result = db.updateMoverPreset(+req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/mover-presets/:id', (req, res) => {
  db.deleteMoverPreset(+req.params.id);
  res.json({ deleted: true });
});

// ─── Version / About API ────────────────────────────────────────────────────

app.get('/api/version', (req, res) => {
  const pkg = require('./package.json');
  res.json({
    version: pkg.version,
    name: pkg.name,
    description: pkg.description,
    node: process.version,
    platform: process.platform,
    arch: process.arch
  });
});

// ─── Config API ─────────────────────────────────────────────────────────────

// ─── Export / Import API ────────────────────────────────────────────────────

app.get('/api/export', (req, res) => {
  // Export fixture types, fixtures, groups, effects, mover presets, and scenes
  const fixtureTypes = db.getFixtureTypes();
  const fixtures = db.getFixtures().map(f => {
    // Include full fixture info with type reference by name+manufacturer+mode
    const ft = fixtureTypes.find(t => t.id === f.fixture_type_id);
    const mode = ft ? (ft.modes || []).find(m => m.id === f.mode_id) : null;
    return {
      name: f.name,
      fixture_type_name: ft ? ft.name : null,
      fixture_type_manufacturer: ft ? ft.manufacturer : null,
      mode_name: mode ? mode.name : null,
      universe: f.universe,
      address: f.address,
      output_type: f.output_type,
      notes: f.notes,
      invert_pan: f.invert_pan,
      invert_tilt: f.invert_tilt,
      home_pan: f.home_pan,
      home_tilt: f.home_tilt,
    };
  });
  const groups = db.getGroups().map(g => {
    // Resolve fixture IDs to fixture names for portability
    const allFix = db.getFixtures();
    return {
      name: g.name,
      color: g.color,
      fixture_names: g.fixture_ids.map(id => {
        const f = allFix.find(x => x.id === id);
        return f ? f.name : null;
      }).filter(Boolean),
    };
  });
  const effects = db.getEffects().map(e => ({
    name: e.name,
    type: e.type,
    category: e.category,
    fixture_target: e.fixture_target,
    effect_data: e.effect_data,
    duration_beats: e.duration_beats,
  }));
  const moverPresets = db.getMoverPresets().map(p => {
    // Resolve fixture IDs in positions to fixture names for portability
    const allFix = db.getFixtures();
    return {
      name: p.name,
      sort_order: p.sort_order,
      positions: p.positions.map(pos => {
        const f = allFix.find(x => x.id === pos.fixture_id);
        return { ...pos, fixture_name: f ? f.name : null };
      }),
    };
  });
  const scenes = db.getScenes().map(s => {
    const scene = db.getScene(s.id);
    const allFix = db.getFixtures();
    const allGroups = db.getGroups();
    const allEffects = db.getEffects();
    return {
      name: scene.name,
      description: scene.description,
      priority: scene.priority,
      is_default: scene.is_default,
      entries: scene.entries.map(e => {
        const fix = e.fixture_id ? allFix.find(x => x.id === e.fixture_id) : null;
        const grp = e.group_id ? allGroups.find(x => x.id === e.group_id) : null;
        const eff = e.effect_id ? allEffects.find(x => x.id === e.effect_id) : null;
        return {
          fixture_name: fix ? fix.name : null,
          group_name: grp ? grp.name : null,
          channel_values: e.channel_values,
          effect_name: eff ? eff.name : null,
          effect_params: e.effect_params,
          label: e.label,
          sort_order: e.sort_order,
        };
      }),
    };
  });

  const data = {
    _format: 'dmx-controller-export',
    _version: 1,
    _exported: new Date().toISOString(),
    fixture_types: fixtureTypes.map(t => ({
      name: t.name,
      manufacturer: t.manufacturer,
      category: t.category,
      modes: (t.modes || []).map(m => ({
        name: m.name,
        short_name: m.short_name,
        channels: (m.channels || []).map(ch => ({
          channel_number: ch.channel_number,
          name: ch.name,
          type: ch.type,
          default_value: ch.default_value,
          min_value: ch.min_value,
          max_value: ch.max_value,
          ranges: ch.ranges,
          cell: ch.cell,
          invert: ch.invert,
        })),
      })),
    })),
    fixtures,
    groups,
    effects,
    mover_presets: moverPresets,
    scenes,
  };
  res.setHeader('Content-Disposition', `attachment; filename="dmx-export-${Date.now()}.json"`);
  res.json(data);
});

app.post('/api/import', (req, res) => {
  try {
    const data = req.body;
    if (!data || data._format !== 'dmx-controller-export') {
      return res.status(400).json({ error: 'Invalid export file format' });
    }

    const results = { fixture_types: 0, fixtures: 0, groups: 0, effects: 0, mover_presets: 0, scenes: 0, errors: [] };
    const sections = Array.isArray(data._import_sections) ? data._import_sections : null;

    // 1. Import fixture types
    if (data.fixture_types && (!sections || sections.includes('fixture_types'))) {
      for (const ft of data.fixture_types) {
        try {
          const existing = db.getFixtureTypes().find(t => t.name === ft.name && t.manufacturer === ft.manufacturer);
          if (existing) {
            db.updateFixtureType(existing.id, ft);
          } else {
            db.createFixtureType(ft);
          }
          results.fixture_types++;
        } catch (e) { results.errors.push(`Fixture type "${ft.name}": ${e.message}`); }
      }
    }

    // 2. Import fixtures (needs fixture types to be resolved)
    if (data.fixtures && (!sections || sections.includes('fixtures'))) {
      for (const f of data.fixtures) {
        try {
          const ft = db.getFixtureTypes().find(t => t.name === f.fixture_type_name && (!f.fixture_type_manufacturer || t.manufacturer === f.fixture_type_manufacturer));
          if (!ft) { results.errors.push(`Fixture "${f.name}": type "${f.fixture_type_name}" not found`); continue; }
          // Resolve mode by name, fall back to first mode
          let modeId = null;
          if (ft.modes && ft.modes.length > 0) {
            const mode = f.mode_name ? ft.modes.find(m => m.name === f.mode_name) : null;
            modeId = mode ? mode.id : ft.modes[0].id;
          }
          const existing = db.getFixtures().find(x => x.name === f.name);
          if (existing) {
            db.updateFixture(existing.id, { ...f, fixture_type_id: ft.id, mode_id: modeId });
          } else {
            db.createFixture({ ...f, fixture_type_id: ft.id, mode_id: modeId });
          }
          results.fixtures++;
        } catch (e) { results.errors.push(`Fixture "${f.name}": ${e.message}`); }
      }
    }

    // 3. Import groups (needs fixtures to be resolved)
    if (data.groups && (!sections || sections.includes('groups'))) {
      for (const g of data.groups) {
        try {
          const allFix = db.getFixtures();
          const fixtureIds = (g.fixture_names || []).map(n => {
            const f = allFix.find(x => x.name === n);
            return f ? f.id : null;
          }).filter(Boolean);
          const existing = db.getGroups().find(x => x.name === g.name);
          if (existing) {
            db.updateGroup(existing.id, { name: g.name, color: g.color });
            db.setGroupFixtures(existing.id, fixtureIds);
          } else {
            const created = db.createGroup({ name: g.name, color: g.color });
            if (created && !created.error) db.setGroupFixtures(created.id, fixtureIds);
          }
          results.groups++;
        } catch (e) { results.errors.push(`Group "${g.name}": ${e.message}`); }
      }
    }

    // 4. Import effects
    if (data.effects && (!sections || sections.includes('effects'))) {
      for (const eff of data.effects) {
        try {
          const existing = db.getEffects().find(e => e.name === eff.name);
          if (existing) {
            db.updateEffect(existing.id, eff);
          } else {
            db.createEffect(eff);
          }
          results.effects++;
        } catch (e) { results.errors.push(`Effect "${eff.name}": ${e.message}`); }
      }
    }

    // 5. Import mover presets (needs fixtures for position mapping)
    if (data.mover_presets && (!sections || sections.includes('mover_presets'))) {
      for (const mp of data.mover_presets) {
        try {
          const allFix = db.getFixtures();
          const positions = (mp.positions || []).map(pos => {
            if (pos.fixture_name) {
              const f = allFix.find(x => x.name === pos.fixture_name);
              if (f) return { ...pos, fixture_id: f.id };
            }
            return pos;
          });
          const existing = db.getMoverPresets().find(p => p.name === mp.name);
          if (existing) {
            db.updateMoverPreset(existing.id, { name: mp.name, positions });
          } else {
            db.createMoverPreset({ name: mp.name, positions });
          }
          results.mover_presets++;
        } catch (e) { results.errors.push(`Mover preset "${mp.name}": ${e.message}`); }
      }
    }

    // 6. Import scenes (needs fixtures, groups, and effects)
    if (data.scenes && (!sections || sections.includes('scenes'))) {
      for (const sc of data.scenes) {
        try {
          const allFix = db.getFixtures();
          const allGroups = db.getGroups();
          const allEffects = db.getEffects();
          const existing = db.getScenes().find(s => s.name === sc.name);
          let scene;
          if (existing) {
            scene = db.updateScene(existing.id, { name: sc.name, description: sc.description, priority: sc.priority, is_default: sc.is_default });
            // Delete existing entries before re-importing
            const oldEntries = db.getSceneEntries(existing.id);
            for (const oe of oldEntries) db.deleteSceneEntry(oe.id);
          } else {
            scene = db.createScene({ name: sc.name, description: sc.description, priority: sc.priority, is_default: sc.is_default });
          }
          if (scene && !scene.error && sc.entries) {
            for (const entry of sc.entries) {
              const fixId = entry.fixture_name ? (allFix.find(x => x.name === entry.fixture_name) || {}).id : null;
              const grpId = entry.group_name ? (allGroups.find(x => x.name === entry.group_name) || {}).id : null;
              const effId = entry.effect_name ? (allEffects.find(x => x.name === entry.effect_name) || {}).id : null;
              db.createSceneEntry(scene.id, {
                fixture_id: fixId || null,
                group_id: grpId || null,
                channel_values: entry.channel_values,
                effect_id: effId || null,
                effect_params: entry.effect_params,
                label: entry.label,
                sort_order: entry.sort_order,
              });
            }
          }
          results.scenes++;
        } catch (e) { results.errors.push(`Scene "${sc.name}": ${e.message}`); }
      }
    }

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config', (req, res) => {
  res.json(db.getAllConfig());
});

app.put('/api/config/:key', (req, res) => {
  db.setConfig(req.params.key, req.body.value);
  // Refresh cached mixer settings when relevant keys change
  if (req.params.key.startsWith('seq_')) refreshMixerConfig();
  res.json({ key: req.params.key, value: req.body.value });
});

// ─── mDNS Status / Restart API ──────────────────────────────────────────────

app.get('/api/mdns/status', (req, res) => {
  const hostname = getMdnsHostname();
  res.json({
    enabled: db.getConfig('mdns_enabled') !== '0',
    hostname: hostname,
    fqdn: hostname + '.local',
    ip: getLocalIPv4(),
    web_port: WEB_PORT,
    os2l_port: OS2L_PORT,
    responder_active: !!mdnsResponder,
  });
});

app.post('/api/mdns/restart', (req, res) => {
  try {
    // Stop existing responder
    if (mdnsResponder) {
      mdnsResponder.destroy();
      mdnsResponder = null;
    }
    const enabled = db.getConfig('mdns_enabled') !== '0';
    if (enabled) {
      startMdnsResponder();
      const hostname = getMdnsHostname();
      console.log(`[mDNS] Restarted — responding to ${hostname}.local`);
      res.json({ ok: true, hostname: hostname + '.local', ip: getLocalIPv4() });
    } else {
      console.log('[mDNS] Disabled — responder stopped');
      res.json({ ok: true, hostname: null, ip: null });
    }
  } catch(e) {
    console.error('[mDNS] Restart failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Known DMX USB Vendor/Product IDs ───────────────────────────────────────

const KNOWN_DMX_VENDORS = {
  0x0403: 'FTDI',
  0x15e4: 'SoundSwitch / Denon DJ',
  0x04d8: 'Microchip',
  0x10cf: 'Velleman',
  0x16c0: 'Teensy / V-USB',
  0x1209: 'Open-Source Hardware',
  0x0483: 'STMicroelectronics',
};

const KNOWN_DMX_PIDS = {
  '0403:6001': 'FT232R (Enttec Open DMX / DMXKING ultraDMX Micro)',
  '0403:6010': 'FT2232H (Dual)',
  '0403:6014': 'FT232H',
  '0403:6015': 'FT-X Series',
  '15e4:0053': 'SoundSwitch DMX Micro Interface',
  '15e4:0100': 'SoundSwitch DMX Interface',
  '04d8:000a': 'Microchip USB DMX',
  '04d8:fb56': 'DMXking ultraDMX2 PRO',
  '10cf:8062': 'Velleman VMB1USB',
};

/**
 * Scan for USB devices via libusb (WebUSB API).
 * Returns devices not already found by FTDI D2XX scan.
 */
async function scanUsbDevices(ftdiSerials) {
  try {
    const webusb = new WebUSB({ allowAllDevices: true });
    const rawDevices = await webusb.getDevices();
    const results = [];

    for (const d of rawDevices) {
      const vid = d.vendorId;
      const pid = d.productId;
      const vidHex = vid.toString(16).padStart(4, '0');
      const pidHex = pid.toString(16).padStart(4, '0');
      const key = `${vidHex}:${pidHex}`;

      // Skip FTDI devices already found by D2XX (avoid duplicates)
      if (vid === 0x0403 && d.serialNumber && ftdiSerials.has(d.serialNumber)) continue;

      const vendorLabel = KNOWN_DMX_VENDORS[vid] || d.manufacturerName || '';
      const pidLabel = KNOWN_DMX_PIDS[key] || '';
      const isDmxRelated = KNOWN_DMX_VENDORS.hasOwnProperty(vid) || KNOWN_DMX_PIDS.hasOwnProperty(key);

      results.push({
        source: 'usb',
        vid: `0x${vidHex}`,
        pid: `0x${pidHex}`,
        manufacturer: d.manufacturerName || vendorLabel,
        product: d.productName || pidLabel || 'Unknown Device',
        serial_number: d.serialNumber || '',
        vendorLabel,
        pidLabel,
        isDmxRelated,
      });
    }

    return results;
  } catch (e) {
    console.error('[USB] libusb scan failed:', e.message);
    return [];
  }
}

// ─── Device Scan API (FTDI D2XX + libusb) ───────────────────────────────────

app.get('/api/serial-ports', async (req, res) => {
  try {
    // 1. FTDI D2XX scan (via worker)
    const ftdiDevices = await dmxUsbServer.listDevices();
    const taggedFtdi = ftdiDevices.map(d => ({ ...d, source: 'ftdi' }));

    // Collect FTDI serial numbers to de-duplicate
    const ftdiSerials = new Set(ftdiDevices.map(d => d.serial_number).filter(Boolean));

    // 2. libusb scan (direct)
    const usbDevices = await scanUsbDevices(ftdiSerials);

    res.json({ ftdi: taggedFtdi, usb: usbDevices });
  } catch (e) {
    res.json({ ftdi: [], usb: [] });
  }
});

// ─── DMX USB API ────────────────────────────────────────────────────────────

app.get('/api/dmx-usb/status', (req, res) => {
  res.json(dmxUsbServer.getStatus());
});

app.post('/api/dmx-usb/blackout', (req, res) => {
  dmxUsbServer.blackout();
  res.json({ ok: true });
});

// ─── USB Devices CRUD ───────────────────────────────────────────────────────

app.get('/api/usb-devices', (req, res) => {
  const devices = db.getUsbDevices();
  // Augment with live connection status
  const result = devices.map(d => ({
    ...d,
    connected: !!dmxUsbServer.getDeviceStatus(d.id)?.open,
  }));
  res.json(result);
});

app.get('/api/usb-devices/:id', (req, res) => {
  const device = db.getUsbDevice(+req.params.id);
  if (!device) return res.status(404).json({ error: 'Not found' });
  const status = dmxUsbServer.getDeviceStatus(device.id);
  res.json({ ...device, connected: !!status?.open });
});

app.post('/api/usb-devices', (req, res) => {
  try {
    const result = db.createUsbDevice(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/usb-devices/:id', (req, res) => {
  const result = db.updateUsbDevice(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/usb-devices/:id', async (req, res) => {
  // Disconnect if currently open
  await dmxUsbServer.closeDevice(+req.params.id);
  db.deleteUsbDevice(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/usb-devices/:id/toggle', (req, res) => {
  const result = db.toggleUsbDevice(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/usb-devices/:id/connect', async (req, res) => {
  const device = db.getUsbDevice(+req.params.id);
  if (!device) return res.status(404).json({ error: 'Not found' });
  const success = await dmxUsbServer.openDevice(device);
  if (success) {
    res.json({ ok: true, device: dmxUsbServer.getDeviceStatus(device.id) });
  } else {
    res.status(500).json({ error: 'Failed to connect device' });
  }
});

app.post('/api/usb-devices/:id/disconnect', async (req, res) => {
  await dmxUsbServer.closeDevice(+req.params.id);
  res.json({ ok: true });
});

// ─── Art-Net Universes API ──────────────────────────────────────────────────

app.get('/api/artnet-universes', (req, res) => {
  res.json(db.getArtNetUniverses());
});

app.get('/api/artnet-universes/:id', (req, res) => {
  const u = db.getArtNetUniverse(+req.params.id);
  u ? res.json(u) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/artnet-universes', (req, res) => {
  const result = db.createArtNetUniverse(req.body);
  if (result.error) return res.status(400).json(result);
  // Hot-add to running Art-Net worker
  artnetServer.upsertNode(result);
  res.status(201).json(result);
});

app.put('/api/artnet-universes/:id', (req, res) => {
  const result = db.updateArtNetUniverse(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  // Hot-update running worker
  artnetServer.upsertNode(result);
  res.json(result);
});

app.delete('/api/artnet-universes/:id', (req, res) => {
  const existing = db.getArtNetUniverse(+req.params.id);
  if (existing) artnetServer.removeNode(existing.id);
  db.deleteArtNetUniverse(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/artnet-universes/:id/toggle', (req, res) => {
  const result = db.toggleArtNetUniverse(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  artnetServer.upsertNode(result);
  res.json(result);
});

app.post('/api/artnet/blackout', (req, res) => {
  artnetServer.blackout();
  dmxUsbServer.blackout();
  res.json({ ok: true });
});

app.post('/api/artnet/channel', (req, res) => {
  const { localUniverse, channel, value } = req.body;
  artnetServer.setChannel(localUniverse, channel, value);
  res.json({ ok: true });
});

// ─── DMX Output Control API ─────────────────────────────────────────────────

let dmxOutputEnabled = false;

// ─── Touch Override State ────────────────────────────────────────────────────
// Server-side state that the playback engine respects
const touchOverrides = {
  disabledFixtures: new Set(),   // fixture IDs disabled from touch UI
  blackoutHold: false,           // true while blackout is held (OS2L or touch)
  masterDimmer: 255,             // 0-255 master dimmer level (scales all intensity/color output)
  effectSpeed: 1.0,              // master effect speed multiplier (0.1 – 3.0)
  os2lOverrideFixtures: new Set(), // fixture IDs currently controlled by an OS2L button action
  colorOverrideFixtures: new Set(),    // fixture IDs with color overridden from touch UI
  movementOverrideFixtures: new Set(), // fixture IDs with movement overridden from touch UI
};

app.get('/api/dmx/output', (req, res) => {
  res.json({ enabled: dmxOutputEnabled });
});

app.post('/api/dmx/output', (req, res) => {
  dmxOutputEnabled = !!req.body.enabled;
  if (!dmxOutputEnabled) {
    artnetServer.blackout();
    dmxUsbServer.blackout();
  }
  broadcast({ type: 'dmxOutput', enabled: dmxOutputEnabled });
  console.log(`[DMX] Output ${dmxOutputEnabled ? 'ENABLED' : 'DISABLED'}`);
  res.json({ enabled: dmxOutputEnabled });
});

app.post('/api/dmx/channel', (req, res) => {
  const { universe, channel, value } = req.body;
  if (!dmxOutputEnabled) return res.json({ ok: true, outputOff: true });
  artnetServer.setChannel(universe, channel, value);
  dmxUsbServer.setChannel(universe, channel, value);
  res.json({ ok: true });
});

app.post('/api/dmx/channels', (req, res) => {
  const { universe, channels } = req.body;  // channels: [{ch, val}]
  if (!dmxOutputEnabled) return res.json({ ok: true, outputOff: true });
  artnetServer.setChannels(universe, channels);
  dmxUsbServer.setChannels(universe, channels);
  res.json({ ok: true });
});

// ─── Touch Override API ──────────────────────────────────────────────────────

app.get('/api/touch/state', (req, res) => {
  res.json({
    disabledFixtures: [...touchOverrides.disabledFixtures],
    blackoutHold: touchOverrides.blackoutHold,
    masterDimmer: touchOverrides.masterDimmer,
    effectSpeed: touchOverrides.effectSpeed,
  });
});

app.post('/api/touch/fixture-disable', (req, res) => {
  const { fixtureId, disabled } = req.body;
  if (disabled) {
    touchOverrides.disabledFixtures.add(fixtureId);
    // Immediately zero out this fixture's channels
    const allFixtures = db.getFixtureChannelMap();
    const fixMap = allFixtures.find(f => f.id === fixtureId);
    if (fixMap && dmxOutputEnabled) {
      const channels = fixMap.channels.map(ch => ({ ch: ch.dmx_address, val: 0 }));
      artnetServer.setChannels(fixMap.universe, channels);
      dmxUsbServer.setChannels(fixMap.universe, channels);
    }
  } else {
    touchOverrides.disabledFixtures.delete(fixtureId);
  }
  broadcast({ type: 'touchFixtureDisable', fixtureId, disabled: !!disabled });
  console.log(`[TOUCH] Fixture ${fixtureId} ${disabled ? 'DISABLED' : 'ENABLED'}`);
  res.json({ ok: true, disabledFixtures: [...touchOverrides.disabledFixtures] });
});

app.post('/api/touch/blackout-hold', (req, res) => {
  const { active } = req.body;
  touchOverrides.blackoutHold = !!active;
  if (active) {
    artnetServer.blackout();
    dmxUsbServer.blackout();
  }
  broadcast({ type: 'touchBlackoutHold', active: !!active });
  console.log(`[TOUCH] Blackout hold ${active ? 'ON' : 'OFF'}`);
  res.json({ ok: true, blackoutHold: !!active });
});

app.post('/api/touch/master-dimmer', (req, res) => {
  const val = Math.max(0, Math.min(255, Math.round(+req.body.value || 0)));
  touchOverrides.masterDimmer = val;
  broadcast({ type: 'masterDimmer', value: val });
  res.json({ ok: true, masterDimmer: val });
});

app.post('/api/touch/effect-speed', (req, res) => {
  const val = Math.max(0.1, Math.min(3.0, parseFloat(req.body.value) || 1.0));
  touchOverrides.effectSpeed = val;
  broadcast({ type: 'effectSpeed', value: val });
  console.log(`[TOUCH] Effect speed = ${val.toFixed(2)}x`);
  res.json({ ok: true, effectSpeed: val });
});

app.post('/api/touch/color-override', (req, res) => {
  const { fixtureIds, active } = req.body;
  if (!Array.isArray(fixtureIds)) return res.status(400).json({ error: 'fixtureIds required' });
  for (const id of fixtureIds) {
    if (active) touchOverrides.colorOverrideFixtures.add(id);
    else touchOverrides.colorOverrideFixtures.delete(id);
  }
  console.log(`[TOUCH] Color override ${active ? 'ON' : 'OFF'} for ${fixtureIds.length} fixtures (total active: ${touchOverrides.colorOverrideFixtures.size})`);
  res.json({ ok: true });
});

app.post('/api/touch/movement-override', (req, res) => {
  const { fixtureIds, active } = req.body;
  if (!Array.isArray(fixtureIds)) return res.status(400).json({ error: 'fixtureIds required' });
  for (const id of fixtureIds) {
    if (active) touchOverrides.movementOverrideFixtures.add(id);
    else touchOverrides.movementOverrideFixtures.delete(id);
  }
  console.log(`[TOUCH] Movement override ${active ? 'ON' : 'OFF'} for ${fixtureIds.length} fixtures (total active: ${touchOverrides.movementOverrideFixtures.size})`);
  res.json({ ok: true });
});

// ─── OS2L Button Maps API (delegated to os2l module) ────────────────────────

os2l.registerRoutes(app);

// ─── Tracks API ─────────────────────────────────────────────────────────────

const vdjParser = require('./vdj-parser');

app.get('/api/tracks', (req, res) => {
  const result = db.getTracks({
    search:     req.query.search,
    genre:      req.query.genre,
    sourceType: req.query.sourceType,
    minBpm:     req.query.minBpm,
    maxBpm:     req.query.maxBpm,
    key:        req.query.key,
    limit:      req.query.limit,
    offset:     req.query.offset,
  });
  res.json(result);
});

app.get('/api/tracks/stats', (req, res) => {
  res.json(db.getTrackStats());
});

app.get('/api/tracks/genres', (req, res) => {
  res.json(db.getTrackGenres());
});

app.get('/api/tracks/:id', (req, res) => {
  const t = db.getTrack(+req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/tracks/import', (req, res) => {
  try {
    // Use configured path or try auto-detect
    let xmlPath = db.getConfig('vdj_db_path');
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (!xmlPath) return res.status(400).json({ error: 'VDJ database path not configured and auto-detect failed' });

    const tracks = vdjParser.parseVdjDatabase(xmlPath);
    const result = db.importTracks(tracks);
    console.log(`[VDJ] Imported ${result.total} tracks from ${xmlPath}`);
    res.json({ ...result, path: xmlPath });
  } catch (e) {
    console.error(`[VDJ] Import error: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/tracks', (req, res) => {
  db.clearTracks();
  res.json({ cleared: true });
});

// Stream audio file for browser playback (supports Range requests)
app.get('/api/tracks/:id/audio', (req, res) => {
  const track = db.getTrack(+req.params.id);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const filePath = track.filepath;
  if (!filePath || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Audio file not found on disk' });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
  };
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const readStream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });
    readStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// ─── Track Analysis API ─────────────────────────────────────────────────────

// Check if ffmpeg is available
app.get('/api/analysis/status', async (req, res) => {
  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
  res.json({ ffmpeg_available: ffmpegOk, analysis_version: audioAnalyzer.ANALYSIS_VERSION });
});

// Get analysis for a track
app.get('/api/tracks/:id/analysis', (req, res) => {
  const analysis = db.getTrackAnalysis(+req.params.id);
  if (!analysis) return res.status(404).json({ error: 'No analysis found' });
  // Parse JSON fields
  analysis.waveform_peaks = JSON.parse(analysis.waveform_peaks || '[]');
  analysis.energy_levels = JSON.parse(analysis.energy_levels || '[]');
  analysis.beats = JSON.parse(analysis.beats || '[]');
  analysis.sections = JSON.parse(analysis.sections || '[]');
  res.json(analysis);
});

// Build analysis config object from persisted settings
function getAnalysisConfig() {
  const cfg = {};
  const tp = db.getConfig('analysis_target_peaks');
  if (tp) cfg.TARGET_PEAKS = parseInt(tp, 10) || undefined;
  const sr = db.getConfig('analysis_sample_rate');
  if (sr) cfg.DECODE_SAMPLE_RATE = parseInt(sr, 10) || undefined;
  const ss = db.getConfig('analysis_section_sensitivity');
  if (ss) cfg.SECTION_SENSITIVITY = parseFloat(ss) || undefined;
  const np = db.getConfig('analysis_normalize_pct');
  if (np) cfg.NORMALIZE_PERCENTILE = parseInt(np, 10) || undefined;
  return cfg;
}

// Trigger analysis for a track
const analysisInProgress = new Map(); // trackId -> true

app.post('/api/tracks/:id/analyze', async (req, res) => {
  const trackId = +req.params.id;
  const track = db.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  if (analysisInProgress.has(trackId)) {
    return res.status(409).json({ error: 'Analysis already in progress for this track' });
  }

  // Check ffmpeg
  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
  if (!ffmpegOk) {
    return res.status(500).json({ error: 'ffmpeg not found. Install ffmpeg and ensure it is in PATH.' });
  }

  // Check file exists
  const filePath = track.filepath;
  if (!filePath || !require('fs').existsSync(filePath)) {
    return res.status(400).json({ error: 'Audio file not found on disk', filepath: filePath });
  }

  analysisInProgress.set(trackId, true);

  // Return immediately, analyze in background
  res.json({ status: 'started', track_id: trackId });

  try {
    console.log(`[Analysis] Starting analysis for track ${trackId}: ${track.title || track.filename}`);
    const result = await audioAnalyzer.analyzeTrack(filePath, {
      bpm: track.bpm || 0,
      beatgridPos: track.beatgrid_pos || 0,
      config: getAnalysisConfig(),
    });
    db.upsertTrackAnalysis(trackId, result);
    console.log(`[Analysis] Completed track ${trackId}: ${result.peak_count} peaks, ${result.energy_levels.length} energy segments, ${result.beats.length} beats, ${(result.sections || []).length} sections`);

    // Notify WebSocket clients
    broadcast({ type: 'analysis_complete', track_id: trackId });
  } catch (e) {
    console.error(`[Analysis] Error for track ${trackId}: ${e.message}`);
    broadcast({ type: 'analysis_error', track_id: trackId, error: e.message });
  } finally {
    analysisInProgress.delete(trackId);
  }
});

// Batch analyze multiple tracks
app.post('/api/tracks/analyze-batch', async (req, res) => {
  const { track_ids } = req.body;
  if (!Array.isArray(track_ids) || track_ids.length === 0) {
    return res.status(400).json({ error: 'track_ids array required' });
  }

  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
  if (!ffmpegOk) {
    return res.status(500).json({ error: 'ffmpeg not found. Install ffmpeg and ensure it is in PATH.' });
  }

  // Return immediately, process in background
  res.json({ status: 'started', count: track_ids.length });

  const CONCURRENCY = 4;
  const analysisCfg = getAnalysisConfig();
  let completed = 0;
  let failed = 0;

  // Filter out invalid/in-progress tracks upfront
  const workItems = [];
  for (const trackId of track_ids) {
    if (analysisInProgress.has(trackId)) { failed++; continue; }
    const track = db.getTrack(trackId);
    if (!track || !track.filepath || !require('fs').existsSync(track.filepath)) { failed++; continue; }
    workItems.push({ trackId, track });
  }

  // Process in parallel batches
  for (let i = 0; i < workItems.length; i += CONCURRENCY) {
    const batch = workItems.slice(i, i + CONCURRENCY);

    // Mark all in-progress
    for (const item of batch) analysisInProgress.set(item.trackId, true);

    const results = await Promise.allSettled(batch.map(async (item) => {
      const result = await audioAnalyzer.analyzeTrack(item.track.filepath, {
        bpm: item.track.bpm || 0,
        beatgridPos: item.track.beatgrid_pos || 0,
        config: analysisCfg,
      });
      return { trackId: item.trackId, result };
    }));

    // Process results (DB writes are fast and serial)
    for (let j = 0; j < results.length; j++) {
      const trackId = batch[j].trackId;
      analysisInProgress.delete(trackId);
      if (results[j].status === 'fulfilled') {
        db.upsertTrackAnalysis(trackId, results[j].value.result);
        completed++;
        broadcast({ type: 'analysis_complete', track_id: trackId, progress: { completed, failed, total: track_ids.length } });
      } else {
        failed++;
        console.error(`[Analysis] Batch error for track ${trackId}: ${results[j].reason?.message || results[j].reason}`);
      }
    }
  }

  console.log(`[Analysis] Batch complete: ${completed} succeeded, ${failed} failed out of ${track_ids.length}`);
  broadcast({ type: 'analysis_batch_complete', completed, failed, total: track_ids.length });
});

// Delete analysis for a track
app.delete('/api/tracks/:id/analysis', (req, res) => {
  db.deleteTrackAnalysis(+req.params.id);
  res.json({ deleted: true });
});

// ─── Effects API ────────────────────────────────────────────────────────────

app.get('/api/effects', (req, res) => {
  res.json(db.getEffects());
});

app.get('/api/effects/:id', (req, res) => {
  const e = db.getEffect(+req.params.id);
  e ? res.json(e) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/effects', (req, res) => {
  const result = db.createEffect(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/effects/:id', (req, res) => {
  const result = db.updateEffect(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/effects/:id', (req, res) => {
  db.deleteEffect(+req.params.id);
  res.json({ deleted: true });
});

// ─── Quick Action Effects Runner ────────────────────────────────────────────
// Supports concurrent effects in different categories (color, motion, multicell).
// Each category slot can run one effect at a time; starting a new effect in the
// same category replaces the previous one without affecting other categories.

const runningQaEffects = {}; // { color: { timer, effectId, fixtureIds }, motion: ..., multicell: ... }

/**
 * Determine which slot category an effect belongs to.
 */
function getEffectSlot(effectType) {
  if (MOVING_HEAD_EFFECT_TYPES.has(effectType)) return 'motion';
  if (MULTICELL_EFFECT_TYPES.has(effectType)) return 'multicell';
  return 'color';
}

/**
 * Stop a specific effect slot, or all slots if no slot specified.
 * @param {string} [slot] - 'color', 'motion', or 'multicell'. Omit to stop all.
 * @param {boolean} [skipBlackout] - If true, don't send cleanup values (for seamless switching).
 */
function stopRunningEffect(slot, skipBlackout) {
  const slotsToStop = slot ? [slot] : Object.keys(runningQaEffects);

  for (const s of slotsToStop) {
    const running = runningQaEffects[s];
    if (!running) continue;

    clearInterval(running.timer);

    if (!skipBlackout) {
      const fixMap = db.getFixtureChannelMap();
      const channelUpdates = {};
      for (const fixtureId of running.fixtureIds) {
        const fix = fixMap.find(f => f.id === fixtureId);
        if (!fix) continue;
        for (const ch of fix.channels) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          if (s === 'motion') {
            // Motion slot: only reset pan/tilt to home
            if (ch.type === 'pan') channelUpdates[fix.universe][ch.dmx_address] = fix.home_pan ?? 128;
            else if (ch.type === 'tilt') channelUpdates[fix.universe][ch.dmx_address] = fix.home_tilt ?? 128;
          } else {
            // Color/multicell slot: zero out color & dimmer channels
            if (COLOR_CHANNELS.has(ch.type)) {
              channelUpdates[fix.universe][ch.dmx_address] = 0;
            }
          }
        }
      }
      for (const [u, chMap] of Object.entries(channelUpdates)) {
        const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
        if (channels.length > 0) {
          artnetServer.setChannels(+u, channels);
          dmxUsbServer.setChannels(+u, channels);
        }
      }
    }

    delete runningQaEffects[s];
  }
}

app.post('/api/effects/run', (req, res) => {
  const { effectId, fixtureIds } = req.body;

  const effect = db.getEffect(effectId);
  if (!effect) return res.status(404).json({ error: 'Effect not found' });
  if (!fixtureIds || fixtureIds.length === 0) return res.status(400).json({ error: 'No fixtures specified' });

  const slot = getEffectSlot(effect.type);
  // Only stop the same slot — other categories keep running
  stopRunningEffect(slot, true); // skip blackout for seamless switching

  const startTime = Date.now();
  const fixMap = db.getFixtureChannelMap();

  const timer = setInterval(() => {
    if (!dmxOutputEnabled) return;

    const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;
    const channelUpdates = {};

    for (let fi = 0; fi < fixtureIds.length; fi++) {
      const fixtureId = fixtureIds[fi];
      const fix = fixMap.find(f => f.id === fixtureId);
      if (!fix) continue;
      if (!isFixtureCompatibleWithEffect(effect, fix)) continue;

      for (const ch of fix.channels) {
        let progress;
        if (effect.type === 'color_fade') {
          progress = (elapsed % 4) / 4;
        } else {
          progress = elapsed;
        }

        const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };
        const channelCtx = buildChannelCtx(ch, fix);
        channelCtx._fixtureOrdinal = fi;
        channelCtx._fixtureCount = fixtureIds.length;
        let value = computeEffectValue(effect, ch.type, progress, baseValues, {}, channelCtx);

        if (value !== null && value !== undefined) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          let finalVal = Math.max(0, Math.min(255, Math.round(value)));
          // Master dimmer: only scale dimmer channel on fixtures that have one,
          // otherwise scale RGB directly (avoids double-dipping via hw dimmer)
          const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
          if (fixHasDimmer) {
            if (ch.type === 'dimmer') finalVal = applyMasterDimmer(finalVal, ch.type);
          } else {
            finalVal = applyMasterDimmer(finalVal, ch.type);
          }
          channelUpdates[fix.universe][ch.dmx_address] = applyInvert(finalVal, ch);
        }
      }
    }

    for (const [u, chMap] of Object.entries(channelUpdates)) {
      const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
      if (channels.length > 0) {
        artnetServer.setChannels(+u, channels);
        dmxUsbServer.setChannels(+u, channels);
      }
    }
  }, 25);

  runningQaEffects[slot] = { timer, effectId, fixtureIds };
  console.log(`[QA] Started ${slot} effect "${effect.name}" (type=${effect.type}) on ${fixtureIds.length} fixture(s): [${fixtureIds.join(',')}]`);
  const activeSlots = Object.keys(runningQaEffects);
  if (activeSlots.length > 1) console.log(`[QA]   Concurrent slots active: ${activeSlots.join(', ')}`);
  res.json({ ok: true, slot });
});

app.post('/api/effects/stop', (req, res) => {
  const { slot } = req.body || {};
  const slotsActive = Object.keys(runningQaEffects);
  if (slotsActive.length > 0) {
    console.log(`[QA] Stopping ${slot || 'all'} effect(s) (active: ${slotsActive.join(', ')})`);
  }
  stopRunningEffect(slot || undefined);
  res.json({ ok: true });
});

// ─── Static Scenes API ──────────────────────────────────────────────────────

app.get('/api/scenes', (req, res) => {
  res.json(db.getScenes());
});

// Literal paths MUST come before parameterized :id routes
app.get('/api/scenes/default', (req, res) => {
  const s = db.getDefaultScene();
  s ? res.json(s) : res.status(404).json({ error: 'No default scene' });
});

app.get('/api/scenes/active', (req, res) => {
  res.json({ activeSceneId: activeStaticScene ? activeStaticScene.id : null });
});

app.get('/api/scenes/generate-options', (req, res) => {
  res.json({
    styles: [
      { key: 'warm', label: 'Warm Ambience' },
      { key: 'cool', label: 'Cool / Blue' },
      { key: 'party', label: 'Party Colours' },
      { key: 'elegant', label: 'Elegant / Purple & Gold' },
      { key: 'nature', label: 'Nature / Green & Amber' },
      { key: 'sunset', label: 'Sunset Gradient' },
      { key: 'ocean', label: 'Ocean Blues' },
      { key: 'fire', label: 'Fire / Red & Orange' },
      { key: 'pastel', label: 'Pastel Soft' },
      { key: 'white', label: 'Clean White' },
      { key: 'rainbow', label: 'Rainbow Spread' },
      { key: 'random', label: 'Random' },
    ],
  });
});

app.post('/api/scenes/generate', (req, res) => {
  const { name, style, color_palette, include_effects } = req.body || {};
  const fixtures = db.getFixtureChannelMap();
  const groups = db.getGroups();
  const effects = include_effects ? db.getEffects() : [];

  if (!fixtures.length) return res.status(400).json({ error: 'No fixtures configured' });

  const scene = generateStaticScene({
    name: name || 'Generated Scene',
    style: style || 'warm',
    colorPalette: color_palette,
    fixtures, groups, effects,
  });

  const created = db.createScene({ name: scene.name, description: scene.description });
  if (scene.entries.length > 0) {
    db.bulkUpdateSceneEntries(created.id, scene.entries);
  }
  res.status(201).json(db.getScene(created.id));
});

app.post('/api/scenes/deactivate', (req, res) => {
  deactivateScene();
  res.json({ ok: true });
});

app.get('/api/scenes/:id', (req, res) => {
  const s = db.getScene(+req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/scenes', (req, res) => {
  const result = db.createScene(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/scenes/:id', (req, res) => {
  const result = db.updateScene(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  // If this is the active scene, reload it
  if (activeStaticScene && activeStaticScene.id === +req.params.id) {
    activateScene(+req.params.id);
  }
  res.json(result);
});

app.delete('/api/scenes/:id', (req, res) => {
  // If deleting active scene, deactivate first
  if (activeStaticScene && activeStaticScene.id === +req.params.id) {
    deactivateScene();
  }
  db.deleteScene(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/scenes/:id/default', (req, res) => {
  const result = db.setDefaultScene(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/scenes/:id/activate', (req, res) => {
  const scene = activateScene(+req.params.id);
  if (!scene) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true, scene });
});

// Scene entries
app.get('/api/scenes/:id/entries', (req, res) => {
  res.json(db.getSceneEntries(+req.params.id));
});

app.post('/api/scenes/:id/entries', (req, res) => {
  const result = db.createSceneEntry(+req.params.id, req.body);
  if (result.error) return res.status(400).json(result);
  // Reload active scene if modified
  if (activeStaticScene && activeStaticScene.id === +req.params.id) {
    activateScene(+req.params.id);
  }
  res.status(201).json(result);
});

app.put('/api/scene-entries/:id', (req, res) => {
  const result = db.updateSceneEntry(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  // Reload active scene if entry belongs to it
  const entry = db.getSceneEntry(+req.params.id);
  if (entry && activeStaticScene && activeStaticScene.id === entry.scene_id) {
    activateScene(entry.scene_id);
  }
  res.json(result);
});

app.delete('/api/scene-entries/:id', (req, res) => {
  const entry = db.getSceneEntry(+req.params.id);
  db.deleteSceneEntry(+req.params.id);
  if (entry && activeStaticScene && activeStaticScene.id === entry.scene_id) {
    activateScene(entry.scene_id);
  }
  res.json({ deleted: true });
});

app.put('/api/scenes/:id/entries/bulk', (req, res) => {
  const entries = req.body.entries || [];
  const result = db.bulkUpdateSceneEntries(+req.params.id, entries);
  if (activeStaticScene && activeStaticScene.id === +req.params.id) {
    activateScene(+req.params.id);
  }
  res.json(result);
});

// ─── Touch Actions API ─────────────────────────────────────────────────────

app.get('/api/touch-actions', (req, res) => {
  res.json(db.getTouchActions());
});

// Literal path MUST come before parameterized :id route
app.put('/api/touch-actions/bulk', (req, res) => {
  const result = db.bulkUpdateTouchActions(req.body.actions || []);
  res.json(result);
});

app.get('/api/touch-actions/:id', (req, res) => {
  const a = db.getTouchAction(+req.params.id);
  a ? res.json(a) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/touch-actions', (req, res) => {
  const result = db.createTouchAction(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/touch-actions/:id', (req, res) => {
  const result = db.updateTouchAction(+req.params.id, req.body);
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/touch-actions/:id', (req, res) => {
  db.deleteTouchAction(+req.params.id);
  res.json({ deleted: true });
});

app.post('/api/touch-actions/auto-populate', (req, res) => {
  const COLORS = [
    { name:'Red',     hex:'#ff3b30', r:255, g:0,   b:0   },
    { name:'Green',   hex:'#30d158', r:0,   g:255, b:0   },
    { name:'Blue',    hex:'#0a84ff', r:0,   g:0,   b:255 },
    { name:'White',   hex:'#ffffff', r:255, g:255, b:255 },
    { name:'Amber',   hex:'#ff9f0a', r:255, g:160, b:0   },
    { name:'UV',      hex:'#bf5af2', r:120, g:0,   b:255 },
    { name:'Yellow',  hex:'#ffd60a', r:255, g:235, b:0   },
    { name:'Magenta', hex:'#ff375f', r:255, g:0,   b:150 },
    { name:'Cyan',    hex:'#64d2ff', r:0,   g:220, b:255 },
    { name:'Pink',    hex:'#ff6482', r:255, g:120, b:180 },
    { name:'Lime',    hex:'#a8ff00', r:180, g:255, b:0   },
    { name:'Orange',  hex:'#ff6723', r:255, g:100, b:0   },
  ];

  const QUICK_ACTIONS = [
    { label:'Full White', icon:'\u2600\uFE0E', action:'fullWhite', color:'#ffffff', text:'#000000' },
    { label:'Dim Warm',   icon:'\uD83D\uDD6F\uFE0E', action:'dimWarm',   color:'#b47832', text:'#ffffff' },
    { label:'UV Mode',    icon:'\uD83D\uDD2E', action:'uvMode',    color:'#7b2ff2', text:'#ffffff' },
    { label:'All Off',    icon:'\u26D4',       action:'allOff',    color:'#333333', text:'#ffffff' },
  ];

  const EFFECTS = [
    { label:'Strobe',   icon:'\u26A1', type:'strobe',   color:'#ffcc00', text:'#000000' },
    { label:'Smoke',    icon:'\u2601\uFE0E', type:'smoke',    color:'#556677', text:'#ffffff' },
    { label:'Haze',     icon:'\u2601\uFE0E', type:'haze',     color:'#445566', text:'#ffffff' },
    { label:'Blackout', icon:'\u26AB',       type:'blackout', color:'#cc0000', text:'#ffffff' },
  ];

  const clearFirst = req.body.clear !== false;
  try {
    // Optionally clear existing actions
    if (clearFirst) {
      const existing = db.getTouchActions();
      for (const a of existing) db.deleteTouchAction(a.id);
    }

    const cols = 6;
    let row = 0, col = 0;
    const created = [];

    function nextPos() {
      const pos = { row, col };
      col++;
      if (col >= cols) { col = 0; row++; }
      return pos;
    }
    function startNewRow() { if (col > 0) { col = 0; row++; } }

    // Colors
    for (const c of COLORS) {
      const pos = nextPos();
      created.push(db.createTouchAction({
        label: c.name, icon: '', action_type: 'color',
        action_data: { red: c.r, green: c.g, blue: c.b, white: 0 },
        color: c.hex, text_color: c.name === 'White' || c.name === 'Yellow' || c.name === 'Lime' ? '#000000' : '#ffffff',
        grid_row: pos.row, grid_col: pos.col, grid_w: 1, grid_h: 1,
        sort_order: created.length, enabled: true,
      }));
    }

    // Quick actions
    startNewRow();
    for (const qa of QUICK_ACTIONS) {
      const pos = nextPos();
      created.push(db.createTouchAction({
        label: qa.label, icon: qa.icon, action_type: 'quick_action',
        action_data: { action: qa.action },
        color: qa.color, text_color: qa.text,
        grid_row: pos.row, grid_col: pos.col, grid_w: 1, grid_h: 1,
        sort_order: created.length, enabled: true,
      }));
    }

    // Effects
    startNewRow();
    for (const fx of EFFECTS) {
      const pos = nextPos();
      created.push(db.createTouchAction({
        label: fx.label, icon: fx.icon, action_type: fx.type,
        action_data: {},
        color: fx.color, text_color: fx.text,
        grid_row: pos.row, grid_col: pos.col, grid_w: 1, grid_h: 1,
        sort_order: created.length, enabled: true,
      }));
    }

    // Scenes
    const scenes = db.getScenes();
    if (scenes.length) {
      startNewRow();
      for (const s of scenes) {
        const pos = nextPos();
        created.push(db.createTouchAction({
          label: s.name, icon: '\uD83C\uDFA8', action_type: 'scene',
          action_data: { scene_id: s.id },
          color: '#1a6b3c', text_color: '#ffffff',
          grid_row: pos.row, grid_col: pos.col, grid_w: 1, grid_h: 1,
          sort_order: created.length, enabled: true,
        }));
      }
    }

    // Mover presets
    const presets = db.getMoverPresets();
    if (presets.length) {
      startNewRow();
      for (let i = 0; i < presets.length; i++) {
        const p = presets[i];
        const pos = nextPos();
        created.push(db.createTouchAction({
          label: p.name, icon: '\uD83D\uDCA1', action_type: 'mover_preset',
          action_data: { preset_index: i },
          color: '#1a3b6b', text_color: '#ffffff',
          grid_row: pos.row, grid_col: pos.col, grid_w: 1, grid_h: 1,
          sort_order: created.length, enabled: true,
        }));
      }
    }

    res.json({ created: created.length, actions: db.getTouchActions() });
  } catch (e) {
    console.error('Auto-populate error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ─── Sequences API ──────────────────────────────────────────────────────────

// ─── Database Stats & Bulk Delete ───────────────────────────────────────────

app.get('/api/db/stats', (req, res) => {
  res.json(db.getDbStats());
});

app.delete('/api/db/analysis', (req, res) => {
  const result = db.deleteAllAnalysis();
  console.log(`[DB] Deleted all analysis data (${result.deleted} rows)`);
  res.json(result);
});

app.delete('/api/db/sequences', (req, res) => {
  const result = db.deleteAllSequences();
  console.log(`[DB] Deleted all sequences (${result.deleted} sequences)`);
  res.json(result);
});

// ─── Sequence CRUD ──────────────────────────────────────────────────────────

app.get('/api/sequences', (req, res) => {
  res.json(db.getSequences());
});

// Literal path routes MUST come before parameterized :id routes
app.get('/api/sequences/by-track/:trackId', (req, res) => {
  const s = db.getSequenceByTrackId(+req.params.trackId);
  s ? res.json(s) : res.status(404).json({ error: 'No sequence for this track' });
});

// Expose palette/genre options for the UI (must be before :id route)
const sequenceGenerator = require('./sequence-generator');
app.get('/api/sequences/generate-options', (req, res) => {
  const palettes = sequenceGenerator.PALETTE_KEYS.map(k => ({
    key: k, label: sequenceGenerator.colorPalettes[k].label,
  }));
  palettes.push({ key: 'random', label: 'Random' });
  const genres = Object.entries(sequenceGenerator.genrePresets).map(([k, v]) => ({
    key: k, label: v.label,
  }));
  res.json({ palettes, genres });
});

app.get('/api/sequences/:id', (req, res) => {
  const s = db.getSequence(+req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/sequences', (req, res) => {
  const result = db.createSequence(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/sequences/:id', (req, res) => {
  const result = db.updateSequence(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

app.delete('/api/sequences/:id', (req, res) => {
  db.deleteSequence(+req.params.id);
  res.json({ deleted: true });
});

// ─── Sequence Cues API ──────────────────────────────────────────────────────

app.get('/api/sequences/:id/cues', (req, res) => {
  res.json(db.getSequenceCues(+req.params.id));
});

app.post('/api/sequences/:id/cues', (req, res) => {
  const result = db.createCue(+req.params.id, req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

app.put('/api/cues/:id', (req, res) => {
  const result = db.updateCue(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/cues/:id', (req, res) => {
  db.deleteCue(+req.params.id);
  res.json({ deleted: true });
});

app.put('/api/sequences/:id/cues/bulk', (req, res) => {
  const cues = req.body.cues || [];
  const result = db.bulkUpdateCues(+req.params.id, cues);
  res.json(result);
});

// ─── Auto-Generate Sequence ─────────────────────────────────────────────────

app.post('/api/sequences/generate/:trackId', async (req, res) => {
  const track = db.getTrack(+req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Check if sequence already exists for this track
  const existing = db.getSequenceByTrackId(track.id);
  if (existing && !req.body.overwrite) {
    return res.status(409).json({ error: 'Sequence already exists', sequence_id: existing.id });
  }
  if (existing) {
    db.deleteSequence(existing.id);
  }

  const fixtures = db.getFixtureChannelMap();
  let analysis = db.getTrackAnalysis(track.id);

  // Auto-analyze if no analysis exists
  if (!analysis && track.filepath && require('fs').existsSync(track.filepath)) {
    try {
      const ffmpegOk = await audioAnalyzer.checkFfmpeg();
      if (ffmpegOk) {
        console.log(`[Generate] Auto-analyzing track ${track.id} before sequence generation...`);
        const result = await audioAnalyzer.analyzeTrack(track.filepath, {
          bpm: track.bpm || 0,
          beatgridPos: track.beatgrid_pos || 0,
          config: getAnalysisConfig(),
        });
        db.upsertTrackAnalysis(track.id, result);
        analysis = db.getTrackAnalysis(track.id);
        broadcast({ type: 'analysis_complete', track_id: track.id });
        console.log(`[Generate] Auto-analysis complete for track ${track.id}`);
      }
    } catch (e) {
      console.warn(`[Generate] Auto-analysis failed for track ${track.id}: ${e.message}`);
    }
  }

  const { palette: palKey, genre: genKey } = req.body || {};
  const { cues, bpm, durationMs, palette, genrePreset } = sequenceGenerator.generateSequence({
    track,
    fixtures,
    analysis,
    palette: palKey || undefined,
    genre: genKey || undefined,
    effects: db.getEffects(),
    moverPresets: db.getMoverPresets(),
    noStrobes: db.getConfig('seq_no_strobes') === '1',
  });

  // Create sequence
  const seq = db.createSequence({
    name: track.title || track.filename || 'Untitled',
    track_id: track.id,
    bpm: bpm,
    duration_ms: durationMs,
  });

  // Bulk insert generated cues
  if (cues.length > 0) {
    db.bulkUpdateCues(seq.id, cues);
  }

  const result = db.getSequence(seq.id);
  result.palette = palette;
  result.genrePreset = genrePreset;
  res.json(result);
});

// Bulk generate sequences for multiple tracks
app.post('/api/sequences/generate-batch', async (req, res) => {
  const { track_ids, palette, genre, overwrite } = req.body || {};
  if (!Array.isArray(track_ids) || track_ids.length === 0) {
    return res.status(400).json({ error: 'track_ids array required' });
  }

  // Return immediately, process in background
  res.json({ status: 'started', count: track_ids.length });

  const fixtures = db.getFixtureChannelMap();
  const allEffects = db.getEffects();
  const analysisCfg = getAnalysisConfig();
  let completed = 0, failed = 0, skipped = 0;

  // ── Parallel worker pool ──────────────────────────────────────────────
  // Analysis is IO-heavy (ffmpeg subprocess), so we can run several at once.
  // Sequence generation + DB writes are fast and serialized via SQLite anyway.
  const CONCURRENCY = 4;

  // Phase 1: Run analysis in parallel batches (this is the slow part)
  const analysisCache = new Map(); // trackId → analysis object or null

  // Filter to only tracks that need work
  const workItems = [];
  for (const trackId of track_ids) {
    const track = db.getTrack(trackId);
    if (!track) { failed++; continue; }
    const existing = db.getSequenceByTrackId(track.id);
    if (existing && !overwrite) { skipped++; continue; }
    workItems.push({ trackId, track, existingSeq: existing });
  }

  // Parallel analysis with concurrency limit
  async function analyzeOne(item) {
    let analysis = db.getTrackAnalysis(item.track.id);
    if (!analysis && item.track.filepath && require('fs').existsSync(item.track.filepath)) {
      try {
        const ffmpegOk = await audioAnalyzer.checkFfmpeg();
        if (ffmpegOk) {
          const result = await audioAnalyzer.analyzeTrack(item.track.filepath, {
            bpm: item.track.bpm || 0, beatgridPos: item.track.beatgrid_pos || 0,
            config: analysisCfg,
          });
          db.upsertTrackAnalysis(item.track.id, result);
          analysis = db.getTrackAnalysis(item.track.id);
          broadcast({ type: 'analysis_complete', track_id: item.track.id });
        }
      } catch (e) {
        console.warn(`[BulkGen] Auto-analysis failed for track ${item.trackId}: ${e.message}`);
      }
    }
    return { item, analysis };
  }

  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < workItems.length; i += CONCURRENCY) {
    const batch = workItems.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(item => analyzeOne(item)));

    // Phase 2: Generate sequences from analysis results (fast, serial)
    for (const { item, analysis } of results) {
      try {
        if (item.existingSeq) db.deleteSequence(item.existingSeq.id);

        const { cues, bpm, durationMs } = sequenceGenerator.generateSequence({
          track: item.track, fixtures, analysis,
          palette: palette || undefined,
          genre: genre || undefined,
          effects: allEffects,
          moverPresets: db.getMoverPresets(),
          noStrobes: db.getConfig('seq_no_strobes') === '1',
        });

        const seq = db.createSequence({
          name: item.track.title || item.track.filename || 'Untitled',
          track_id: item.track.id, bpm, duration_ms: durationMs,
        });
        if (cues.length > 0) db.bulkUpdateCues(seq.id, cues);

        completed++;
        broadcast({ type: 'seq_batch_progress', completed, failed, skipped, total: track_ids.length, track_id: item.trackId });
      } catch (e) {
        failed++;
        console.error(`[BulkGen] Error for track ${item.trackId}: ${e.message}`);
      }
    }
  }

  console.log(`[BulkGen] Complete: ${completed} generated, ${skipped} skipped, ${failed} failed out of ${track_ids.length}`);
  broadcast({ type: 'seq_batch_complete', completed, failed, skipped, total: track_ids.length });
});

// ─── Static Scene Engine ────────────────────────────────────────────────────

let activeStaticScene = null;    // The currently active scene object (with entries)
let sceneEffectTimer = null;     // Interval for processing scene effects

/**
 * Activate a static scene — sends static channel values and starts
 * effect processing for any entries that have effects assigned.
 */
function activateScene(sceneId) {
  deactivateScene(); // clean up previous

  const scene = db.getScene(sceneId);
  if (!scene) return null;

  activeStaticScene = scene;
  console.log(`[SCENE] Activated scene "${scene.name}" (${scene.entries.length} entries)`);

  // Send initial static values
  applySceneStaticValues(scene);

  // If any entries have effects, start the effect tick loop
  const hasEffects = scene.entries.some(e => e.effect_id);
  if (hasEffects) {
    const startTime = Date.now();
    sceneEffectTimer = setInterval(() => {
      if (!dmxOutputEnabled || !activeStaticScene) return;
      if (touchOverrides.blackoutHold) return;
      processSceneEffects(activeStaticScene, startTime);
    }, 25); // ~40 Hz
    console.log(`[SCENE] Started effect loop for scene "${scene.name}"`);
  }

  broadcast({ type: 'scene_activated', sceneId: scene.id, sceneName: scene.name });
  return scene;
}

/**
 * Deactivate the current scene — zero out all affected fixtures.
 */
function deactivateScene() {
  if (sceneEffectTimer) {
    clearInterval(sceneEffectTimer);
    sceneEffectTimer = null;
  }
  if (activeStaticScene) {
    // Blackout all fixtures used by the scene
    blackoutSceneFixtures(activeStaticScene);
    console.log(`[SCENE] Deactivated scene "${activeStaticScene.name}"`);
    activeStaticScene = null;
    broadcast({ type: 'scene_deactivated' });
  }
}

/**
 * Send static channel values for all entries that don't have effects.
 */
function applySceneStaticValues(scene) {
  if (!dmxOutputEnabled) return;
  const fixMap = db.getFixtureChannelMap();
  const channelUpdates = {};

  for (const entry of scene.entries) {
    if (entry.effect_id) continue; // effects are handled in the tick loop
    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (const fid of fixtureIds) {
      if (touchOverrides.disabledFixtures.has(fid)) continue;
      const fix = fixMap.find(f => f.id === fid);
      if (!fix) continue;
      applyChannelValues(fix, entry.channel_values, channelUpdates);
    }
  }

  sendChannelUpdates(channelUpdates);
}

/**
 * Process effect entries each tick.
 */
function processSceneEffects(scene, startTime) {
  const fixMap = db.getFixtureChannelMap();
  const channelUpdates = {};
  const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;

  for (const entry of scene.entries) {
    if (!entry.effect_id) continue;
    const effect = db.getEffect(entry.effect_id);
    if (!effect) continue;

    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (let fi = 0; fi < fixtureIds.length; fi++) {
      const fid = fixtureIds[fi];
      if (touchOverrides.disabledFixtures.has(fid)) continue;
      const fix = fixMap.find(f => f.id === fid);
      if (!fix) continue;
      // Skip fixtures that aren't compatible with this effect's target
      if (!isFixtureCompatibleWithEffect(effect, fix)) continue;

      for (const ch of fix.channels) {
        let progress;
        if (effect.type === 'color_fade') {
          progress = (elapsed % 4) / 4;
        } else {
          progress = elapsed;
        }

        const baseValues = { dimmer: 255, ...(entry.channel_values || { red: 255, green: 255, blue: 255, white: 255 }) };
        const channelCtx = buildChannelCtx(ch, fix);
        channelCtx._fixtureOrdinal = fi;
        channelCtx._fixtureCount = fixtureIds.length;
        let value = computeEffectValue(effect, ch.type, progress, baseValues, entry.effect_params || {}, channelCtx);

        // If the effect doesn't control this channel (e.g. motion effect → color channels),
        // fall back to the base value so colours/dimmer still get sent.
        if (value === null || value === undefined) {
          value = baseValues[ch.type] !== undefined ? baseValues[ch.type] : null;
        }

        if (value !== null && value !== undefined) {
          const u = fix.universe;
          if (!channelUpdates[u]) channelUpdates[u] = {};
          let finalVal = Math.max(0, Math.min(255, Math.round(value)));
          // Master dimmer: only scale dimmer channel on fixtures that have one
          const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
          if (fixHasDimmer) {
            if (ch.type === 'dimmer') finalVal = applyMasterDimmer(finalVal, ch.type);
          } else {
            finalVal = applyMasterDimmer(finalVal, ch.type);
          }
          channelUpdates[u][ch.dmx_address] = applyInvert(finalVal, ch);
        }
      }
    }
  }

  sendChannelUpdates(channelUpdates);
}

/**
 * Resolve which fixture IDs an entry applies to (by fixture_id, group_id, or all).
 */
function resolveEntryFixtures(entry, fixMap) {
  if (entry.fixture_id) return [entry.fixture_id];
  if (entry.group_id) {
    const group = db.getGroup(entry.group_id);
    return group ? group.fixture_ids : [];
  }
  // If neither fixture nor group, apply to all fixtures
  return fixMap.map(f => f.id);
}

/**
 * Apply channel_values to a fixture's channels in the update map.
 */
function applyChannelValues(fix, channelValues, channelUpdates) {
  const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');
  for (const ch of fix.channels) {
    const val = channelValues[ch.type];
    if (val !== undefined && val !== null) {
      const u = fix.universe;
      if (!channelUpdates[u]) channelUpdates[u] = {};
      let mapped = mapValueToRange(Math.max(0, Math.min(255, Math.round(val))), ch, ch.type);
      // Master dimmer: only scale dimmer channel on fixtures that have one
      if (fixHasDimmer) {
        if (ch.type === 'dimmer') mapped = applyMasterDimmer(mapped, ch.type);
      } else {
        mapped = applyMasterDimmer(mapped, ch.type);
      }
      channelUpdates[u][ch.dmx_address] = applyInvert(mapped, ch);
    }
  }
}

/**
 * Send accumulated channel updates to both output backends.
 */
function sendChannelUpdates(channelUpdates) {
  for (const [u, chMap] of Object.entries(channelUpdates)) {
    const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
    if (channels.length > 0) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }
}

/**
 * Blackout all fixtures used by a scene.
 */
function blackoutSceneFixtures(scene) {
  if (!dmxOutputEnabled) return;
  const fixMap = db.getFixtureChannelMap();
  const channelUpdates = {};

  for (const entry of scene.entries) {
    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (const fid of fixtureIds) {
      const fix = fixMap.find(f => f.id === fid);
      if (!fix) continue;
      const u = fix.universe;
      if (!channelUpdates[u]) channelUpdates[u] = {};
      for (const ch of fix.channels) {
        // Send pan/tilt to home position, everything else to 0
        let resetVal = 0;
        if (ch.type === 'pan') resetVal = fix.home_pan ?? 128;
        else if (ch.type === 'tilt') resetVal = fix.home_tilt ?? 128;
        channelUpdates[u][ch.dmx_address] = resetVal;
      }
    }
  }

  sendChannelUpdates(channelUpdates);
}

// ─── Static Scene Generator ─────────────────────────────────────────────────

const SCENE_PALETTES = {
  warm:     { label: 'Warm Ambience',   colors: [{red:255,green:147,blue:41},{red:255,green:100,blue:20},{red:255,green:180,blue:80}] },
  cool:     { label: 'Cool / Blue',     colors: [{red:0,green:100,blue:255},{red:0,green:180,blue:220},{red:50,green:50,blue:200}] },
  party:    { label: 'Party Colours',   colors: [{red:255,green:0,blue:128},{red:0,green:255,blue:128},{red:128,green:0,blue:255},{red:255,green:255,blue:0}] },
  elegant:  { label: 'Elegant',         colors: [{red:120,green:0,blue:200},{red:200,green:150,blue:50},{red:180,green:0,blue:180}] },
  nature:   { label: 'Nature',          colors: [{red:34,green:139,blue:34},{red:255,green:165,blue:0},{red:0,green:200,blue:80}] },
  sunset:   { label: 'Sunset Gradient', colors: [{red:255,green:60,blue:0},{red:255,green:120,blue:50},{red:200,green:0,blue:100},{red:255,green:200,blue:0}] },
  ocean:    { label: 'Ocean Blues',     colors: [{red:0,green:60,blue:200},{red:0,green:130,blue:180},{red:0,green:200,blue:200}] },
  fire:     { label: 'Fire',            colors: [{red:255,green:0,blue:0},{red:255,green:80,blue:0},{red:255,green:160,blue:0}] },
  pastel:   { label: 'Pastel Soft',     colors: [{red:255,green:182,blue:193},{red:176,green:224,blue:230},{red:221,green:160,blue:221}] },
  white:    { label: 'Clean White',     colors: [{red:255,green:255,blue:255,white:255}] },
  rainbow:  { label: 'Rainbow Spread',  colors: [{red:255,green:0,blue:0},{red:255,green:127,blue:0},{red:255,green:255,blue:0},{red:0,green:255,blue:0},{red:0,green:0,blue:255},{red:139,green:0,blue:255}] },
};

function generateStaticScene({ name, style, colorPalette, fixtures, groups, effects }) {
  let palette;
  if (style === 'random' || !SCENE_PALETTES[style]) {
    const keys = Object.keys(SCENE_PALETTES);
    palette = SCENE_PALETTES[keys[Math.floor(Math.random() * keys.length)]];
  } else {
    palette = SCENE_PALETTES[style];
  }

  const colors = colorPalette || palette.colors;
  const entries = [];
  let sortOrder = 0;

  // Separate fixtures by category
  const colorFixtures = fixtures.filter(f =>
    f.channels.some(ch => ['red', 'green', 'blue', 'white'].includes(ch.type))
  );
  const moverFixtures = fixtures.filter(f => f.category === 'moving_head');
  const dimmerOnlyFixtures = fixtures.filter(f =>
    f.channels.every(ch => !['red', 'green', 'blue', 'white'].includes(ch.type)) &&
    f.channels.some(ch => ch.type === 'dimmer')
  );

  // Assign colors to colour fixtures in round-robin
  for (let i = 0; i < colorFixtures.length; i++) {
    const fix = colorFixtures[i];
    const color = colors[i % colors.length];
    const cv = { ...color };
    // Add dimmer if fixture has one
    if (fix.channels.some(ch => ch.type === 'dimmer')) {
      cv.dimmer = 255;
    }
    entries.push({
      fixture_id: fix.id,
      channel_values: cv,
      label: `${fix.name} — ${palette.label}`,
      sort_order: sortOrder++,
    });
  }

  // Give movers a static position + color
  for (let i = 0; i < moverFixtures.length; i++) {
    const fix = moverFixtures[i];
    const color = colors[i % colors.length];
    const cv = {
      ...color,
      dimmer: 255,
      pan: 128,
      tilt: 128 + Math.round((i - moverFixtures.length / 2) * 20),
    };
    entries.push({
      fixture_id: fix.id,
      channel_values: cv,
      label: `${fix.name} — position`,
      sort_order: sortOrder++,
    });
  }

  // Dimmer-only fixtures at a warm level
  for (const fix of dimmerOnlyFixtures) {
    entries.push({
      fixture_id: fix.id,
      channel_values: { dimmer: 180 },
      label: `${fix.name} — ambient`,
      sort_order: sortOrder++,
    });
  }

  // Optionally add a slow effect to some fixtures
  if (effects.length > 0 && colorFixtures.length > 2) {
    // Find a pulse or color_wave effect
    const gentleEffect = effects.find(e => e.type === 'pulse') ||
                          effects.find(e => e.type === 'color_wave') ||
                          effects.find(e => e.type === 'color_fade');
    if (gentleEffect) {
      // Apply effect to about half the colour fixtures
      const effectFixtures = colorFixtures.slice(0, Math.ceil(colorFixtures.length / 2));
      for (let i = 0; i < effectFixtures.length; i++) {
        const fix = effectFixtures[i];
        const color = colors[i % colors.length];
        // Update the existing entry to add an effect instead of creating duplicate
        const existing = entries.find(e => e.fixture_id === fix.id);
        if (existing) {
          existing.effect_id = gentleEffect.id;
          existing.effect_params = { frequency: 0.3, speed: 0.5 };
        }
      }
    }
  }

  return {
    name,
    description: `Auto-generated ${palette.label} scene with ${entries.length} fixtures`,
    entries,
  };
}

// Check if any sequence is currently playing — used to decide scene activation
function isAnySequencePlaying() {
  for (const [, ds] of Object.entries(activeSequences)) {
    if (ds && ds.playing) return true;
  }
  return false;
}

// ─── Sequence Playback Engine ───────────────────────────────────────────────

const activeSequences = {};  // { deckNum: { sequence, lastTimeMs, playing, ... } }
const playbackTimers = {};   // { deckNum: intervalId }

// Cached mixer integration settings (refreshed on config save / startup)
let _cachedMixerConfig = { crossfaderGating: false, deckFaderDimmer: false, endAction: 'none' };
function refreshMixerConfig() {
  _cachedMixerConfig.crossfaderGating = db.getConfig('seq_crossfader_gating') === '1';
  _cachedMixerConfig.deckFaderDimmer = db.getConfig('seq_deck_fader_dimmer') === '1';
  _cachedMixerConfig.endAction = db.getConfig('seq_end_action') || 'none'; // none | blackout | scene
}
// Refresh on startup after DB is ready
try { refreshMixerConfig(); } catch(e) { /* DB not ready yet at require-time */ }

// Start a standalone playback timer for a deck (runs when VDJ isn't driving time)
function startPlaybackTimer(deck) {
  stopPlaybackTimer(deck);
  const deckSeq = activeSequences[deck];
  if (!deckSeq) return;

  deckSeq.startWall = Date.now();
  deckSeq.startOffset = deckSeq.currentTimeMs || 0;

  const TICK_MS = 25; // ~40 Hz
  playbackTimers[deck] = setInterval(() => {
    const ds = activeSequences[deck];
    if (!ds || !ds.playing) { stopPlaybackTimer(deck); return; }

    // If VDJ is actively sending time for this deck, skip internal timer
    if (ds.vdjDriven) return;

    const elapsedMs = Date.now() - ds.startWall;
    ds.currentTimeMs = ds.startOffset + elapsedMs;

    // Check if sequence has ended
    if (ds.sequence && ds.sequence.duration_ms && ds.currentTimeMs >= ds.sequence.duration_ms) {
      applySequenceEndAction(deck);
      return;
    }

    processSequenceAtTime(deck, ds.currentTimeMs);

    // Broadcast playhead position to frontend
    broadcast({ type: 'seq_time', deck, timeMs: ds.currentTimeMs });
  }, TICK_MS);

  console.log(`[SEQ] Started standalone playback timer for deck ${deck}`);
}

function stopPlaybackTimer(deck) {
  if (playbackTimers[deck]) {
    clearInterval(playbackTimers[deck]);
    delete playbackTimers[deck];
    console.log(`[SEQ] Stopped playback timer for deck ${deck}`);
  }
}

/**
 * Apply the configured action when a sequence reaches the end of the track.
 * Options: 'none' (keep last values), 'blackout' (zero all), 'scene' (activate default scene).
 */
function applySequenceEndAction(deck) {
  const ds = activeSequences[deck];
  if (!ds) return;
  // Prevent repeated triggers
  if (ds._endActionApplied) return;
  ds._endActionApplied = true;

  ds.playing = false;
  stopPlaybackTimer(deck);
  broadcast({ type: 'seq_playing', deck, playing: false });

  const action = _cachedMixerConfig.endAction;
  if (action === 'blackout') {
    blackoutDeckFixtures(deck);
    console.log(`[SEQ] Sequence ended on deck ${deck} — blackout`);
  } else if (action === 'scene') {
    // Blackout first, then activate the default scene
    blackoutDeckFixtures(deck);
    const defaultScene = db.getDefaultScene();
    if (defaultScene) {
      activateScene(defaultScene.id);
      console.log(`[SEQ] Sequence ended on deck ${deck} — activated default scene "${defaultScene.name}"`);
    } else {
      console.log(`[SEQ] Sequence ended on deck ${deck} — no default scene set, staying dark`);
    }
  } else {
    console.log(`[SEQ] Sequence ended on deck ${deck} — no action`);
  }
}

/**
 * Set all channels used by the deck's active sequence fixtures to 0.
 */
function blackoutDeckFixtures(deck) {
  if (!dmxOutputEnabled) return;
  const deckSeq = activeSequences[deck];
  if (!deckSeq || !deckSeq.sequence) return;

  const cues = deckSeq.sequence.cues || [];
  const fixtureIds = [...new Set(cues.map(c => c.fixture_id).filter(Boolean))];
  const allFixtures = db.getFixtureChannelMap();
  const channelUpdates = {};

  for (const fid of fixtureIds) {
    const fixMap = allFixtures.find(f => f.id === fid);
    if (!fixMap) continue;
    const u = fixMap.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    for (const ch of fixMap.channels) {
      channelUpdates[u][ch.dmx_address] = 0;
    }
  }

  for (const [u, chMap] of Object.entries(channelUpdates)) {
    const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
    if (channels.length > 0) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }
  console.log(`[SEQ] Blackout deck ${deck} fixtures (${fixtureIds.length} fixtures)`);
}

// Handle sequence playback commands from WebSocket
function handleSequenceCommand(ws, msg) {
  const { action, deck, sequenceId } = msg;

  switch (action) {
    case 'load': {
      const seq = db.getSequence(sequenceId);
      if (!seq) return ws.send(JSON.stringify({ type: 'seq_error', error: 'Sequence not found' }));
      // Clear any OS2L button overrides so the sequence controls all fixtures
      touchOverrides.os2lOverrideFixtures.clear();
      deactivateScene(); // Stop any scene effect loop from end-action
      stopPlaybackTimer(deck);
      blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
      activeSequences[deck] = { sequence: seq, lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
      broadcast({ type: 'seq_loaded', deck, sequence: seq });
      console.log(`[SEQ] Loaded sequence "${seq.name}" on deck ${deck}`);
      break;
    }
    case 'unload':
      stopPlaybackTimer(deck);
      blackoutDeckFixtures(deck);
      delete activeSequences[deck];
      broadcast({ type: 'seq_unloaded', deck });
      console.log(`[SEQ] Unloaded sequence from deck ${deck}`);
      break;
    case 'play':
      if (activeSequences[deck]) {
        activeSequences[deck].playing = true;
        startPlaybackTimer(deck);
        broadcast({ type: 'seq_playing', deck, playing: true });
      }
      break;
    case 'pause':
      if (activeSequences[deck]) {
        activeSequences[deck].playing = false;
        // Save current position so resume continues from here
        if (playbackTimers[deck]) {
          const ds = activeSequences[deck];
          ds.currentTimeMs = ds.startOffset + (Date.now() - ds.startWall);
        }
        stopPlaybackTimer(deck);
        blackoutDeckFixtures(deck);
        broadcast({ type: 'seq_playing', deck, playing: false });
      }
      break;
    case 'seek': {
      const seekMs = Math.max(0, msg.timeMs || 0);
      if (activeSequences[deck]) {
        activeSequences[deck].currentTimeMs = seekMs;
        activeSequences[deck]._endActionApplied = false; // allow end action to fire again
        if (activeSequences[deck].playing) {
          // Reset the wall-clock reference so the timer continues from the new position
          activeSequences[deck].startWall = Date.now();
          activeSequences[deck].startOffset = seekMs;
        }
        processSequenceAtTime(deck, seekMs);
        broadcast({ type: 'seq_time', deck, timeMs: seekMs });
      }
      break;
    }
  }
}

/**
 * Map a logical 0-255 value to the appropriate DMX sub-range for a channel.
 * For channels with ranges defined (e.g. dimmer 8-134, strobe 135-239),
 * this scales the logical value into the matching range.
 * @param {number} value - Logical value 0-255
 * @param {Object} channel - Channel object with optional ranges array
 * @param {string} rangeType - The range type to map into ('dimmer', 'strobe', etc.)
 * @returns {number} The mapped DMX value
 */
function mapValueToRange(value, channel, rangeType) {
  if (!channel.ranges || channel.ranges.length === 0) return value;
  const range = channel.ranges.find(r => r.type === rangeType);
  if (!range) return value;
  // Map 0-255 logical value to range.min..range.max
  return Math.round(range.min + (value / 255) * (range.max - range.min));
}

/** Apply channel invert flag (flips 0-255 → 255-0). */
function applyInvert(value, channel) {
  return channel.invert ? 255 - value : value;
}

/** Scale a value by the master dimmer level. Only applied to intensity/color channels. */
const DIMMABLE_CHANNELS = new Set(['dimmer','red','green','blue','white','amber','uv']);
function applyMasterDimmer(value, channelType) {
  if (!DIMMABLE_CHANNELS.has(channelType)) return value;
  const md = touchOverrides.masterDimmer;
  if (md >= 255) return value;
  return Math.round(value * md / 255);
}

/**
 * Called on each time update to drive the sequence engine.
 * Finds active cues at the current position and sends DMX values.
 * @param {number} deckNum - Deck number
 * @param {number} timeMs - Current playback position in milliseconds
 */
/**
 * Build a channel context object for effect computation.
 * Includes explicit cell metadata when available so effects can
 * correctly resolve cell index and count rather than guessing via stride.
 */
function buildChannelCtx(ch, fix) {
  const ctx = {
    channel_number: ch.channel_number,
    total_channels: fix.channels.length,
    home_pan: fix.home_pan ?? 128,
    home_tilt: fix.home_tilt ?? 128,
  };
  if (fix.cell_count > 0) {
    ctx.cell_count = fix.cell_count;
    ctx.cell = ch.cell || null;
    // Compute index of this channel within its cell (0-based)
    if (ch.cell) {
      const cellChannels = fix.channels.filter(c => c.cell === ch.cell);
      ctx.cell_channel_index = cellChannels.indexOf(ch);
      if (ctx.cell_channel_index === -1) {
        ctx.cell_channel_index = cellChannels.findIndex(c => c.channel_number === ch.channel_number);
      }
    }
  }
  return ctx;
}

function processSequenceAtTime(deckNum, timeMs) {
  const deckSeq = activeSequences[deckNum];
  if (!deckSeq || !deckSeq.playing || !deckSeq.sequence) return;

  const seq = deckSeq.sequence;
  const cues = seq.cues || [];

  // ── Sequence end detection (VDJ-driven playback) ──
  if (seq.duration_ms && timeMs >= seq.duration_ms && !deckSeq._endActionApplied) {
    applySequenceEndAction(deckNum);
    return;
  }

  if (!dmxOutputEnabled) return;

  // ── Touch blackout hold: suppress all playback output ──
  if (touchOverrides.blackoutHold) return;

  // ── Crossfader gating: suppress output for the deck the crossfader is away from ──
  if (_cachedMixerConfig.crossfaderGating) {
    const cf = parseFloat(state.crossfader) || 0;  // 0 = full deck 1, 1 = full deck 2
    // Deck 1 active when cf <= 0.5, Deck 2 active when cf >= 0.55, dead zone 0.5–0.55
    const gated = (deckNum === 1 && cf > 0.5) || (deckNum === 2 && cf < 0.55);
    if (gated) {
      // Only blackout once when transitioning to gated state
      if (!deckSeq._gated) {
        deckSeq._gated = true;
        blackoutDeckFixtures(deckNum);
      }
      return;
    }
    // Deck just became active again
    if (deckSeq._gated) deckSeq._gated = false;
    // Decks 3-4: no crossfader gating, always play if active
  }

  // ── Deck fader dimmer: scale output by deck volume fader ──
  const deckLevel = _cachedMixerConfig.deckFaderDimmer
    ? Math.max(0, Math.min(1, parseFloat(state.decks[deckNum]?.level) || 0))
    : 1;

  // Find all active cues at this time position
  const channelUpdates = {}; // { universe: { channel: value } }

  // Sort active cues so master cues (cell=null) are processed first,
  // then cell-specific cues overwrite. This ensures cell cues always
  // take priority over master cues on the same fixture.
  const activeCues = [];
  for (const cue of cues) {
    if (timeMs < cue.start_ms || timeMs >= cue.start_ms + cue.duration_ms) continue;
    activeCues.push(cue);
  }
  activeCues.sort((a, b) => (a.cell ? 1 : 0) - (b.cell ? 1 : 0));

  for (const cue of activeCues) {

    // This cue is active
    const fixtureId = cue.fixture_id;
    if (!fixtureId) continue;

    // Skip fixtures disabled from the touch interface
    if (touchOverrides.disabledFixtures.has(fixtureId)) continue;

    // Skip fixtures currently overridden by an OS2L button action
    if (touchOverrides.os2lOverrideFixtures.has(fixtureId)) continue;

    // Check if this fixture has touch color/movement overrides active
    const hasColorOverride = touchOverrides.colorOverrideFixtures.has(fixtureId);
    const hasMovementOverride = touchOverrides.movementOverrideFixtures.has(fixtureId);

    // Find the fixture in fixture channel map (cache this?)
    const fixMap = db.getFixtureChannelMap().find(f => f.id === fixtureId);
    if (!fixMap) continue;

    const progress = (timeMs - cue.start_ms) / cue.duration_ms; // 0..1

    const channelVals = cue.channel_values || {};
    const endVals = cue.end_channel_values;

    for (const ch of fixMap.channels) {
      // Cell filtering: if cue targets a specific cell, only apply to that cell's channels
      if (cue.cell != null && ch.cell != null && ch.cell !== cue.cell) continue;
      // If cue targets a cell but channel has no cell assignment (master channel), still apply
      // Skip channels that are overridden by touch UI
      if (hasColorOverride && COLOR_CHANNELS.has(ch.type)) continue;
      if (hasMovementOverride && PAN_TILT.has(ch.type)) continue;

      let value = null;
      let skipRangeMap = false; // true when value is already mapped to a specific range

      if (cue.cue_type === 'static' || cue.cue_type === 'fade') {
        // All cues support start→end transitions; if no end values, hold start
        const startVal = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
        if (startVal === null) { value = null; }
        else if (endVals && endVals[ch.type] !== undefined) {
          const endVal = endVals[ch.type];
          value = Math.round(startVal + (endVal - startVal) * progress);
        } else {
          value = startVal;
        }
      } else if (cue.cue_type === 'strobe') {
        const strobeHz = channelVals.strobe_hz || 10;
        // Check if this channel has a hardware strobe range
        const strobeRange = ch.ranges ? ch.ranges.find(r => r.type === 'strobe') : null;

        if (strobeRange) {
          // Hardware strobe: map strobe speed into the strobe range
          const strobeSpeed = Math.min(255, Math.round((strobeHz / 20) * 255));
          value = Math.round(strobeRange.min + (strobeSpeed / 255) * (strobeRange.max - strobeRange.min));
          skipRangeMap = true; // already mapped to strobe range
        } else {
          // Check if the fixture has hardware strobe on another channel
          const fixtureHasHwStrobe = fixMap.channels.some(c =>
            c.ranges && c.ranges.some(r => r.type === 'strobe')
          );

          if (fixtureHasHwStrobe && ['red', 'green', 'blue', 'white', 'dimmer'].includes(ch.type)) {
            // Fixture handles strobe in hardware; send steady on value (range-mapped below)
            value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : 255;
          } else if (['red', 'green', 'blue', 'white', 'dimmer'].includes(ch.type)) {
            // Software strobe: toggle between on/off at strobe frequency
            const period = 1000 / strobeHz;
            const phase = ((timeMs - cue.start_ms) % period) / period;
            const onVal = channelVals[ch.type] !== undefined ? channelVals[ch.type] : 255;
            value = phase < 0.5 ? onVal : 0;
          } else {
            value = null;
          }
        }
      } else if (cue.cue_type === 'chase') {
        // Chase: cycle through fixtures in the group
        // For now, simple on/off based on beat position
        value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
      } else if (cue.cue_type === 'effect' && cue.effect_id) {
        const effect = db.getEffect(cue.effect_id);
        if (effect && isFixtureCompatibleWithEffect(effect, fixMap)) {
          const channelCtx = buildChannelCtx(ch, fixMap);
          value = computeEffectValue(effect, ch.type, progress * touchOverrides.effectSpeed, channelVals, cue.effect_params || {}, channelCtx);
          // If the effect doesn't control this channel (e.g. motion effect → color channels),
          // fall back to the cue's base channel value so colours/dimmer still get sent.
          if (value === null || value === undefined) {
            value = channelVals[ch.type] !== undefined ? channelVals[ch.type]
                  : (ch.type === 'dimmer' ? 255 : null);
          }
        }
      } else if (cue.cue_type === 'movement' && channelVals.mover_preset_id) {
        // Movement preset: cycle through saved positions over the cue duration
        const preset = db.getMoverPreset(channelVals.mover_preset_id);
        if (preset && preset.positions && preset.positions.length > 0) {
          // Find position for this specific fixture
          const fixPositions = preset.positions.filter(p => p.fixture_id === fixtureId);
          if (fixPositions.length > 0) {
            // Cycle through the fixture's positions over the cue duration
            const totalSteps = fixPositions.length;
            const stepProgress = (progress * totalSteps) % totalSteps;
            const stepIdx = Math.floor(stepProgress);
            const stepFrac = stepProgress - stepIdx;
            const curr = fixPositions[stepIdx % totalSteps];
            const next = fixPositions[(stepIdx + 1) % totalSteps];
            // Smooth interpolation between positions
            if (ch.type === 'pan' && curr.pan !== undefined) {
              value = Math.round(curr.pan + (next.pan - curr.pan) * stepFrac);
            } else if (ch.type === 'tilt' && curr.tilt !== undefined) {
              value = Math.round(curr.tilt + (next.tilt - curr.tilt) * stepFrac);
            } else if (ch.type === 'speed') {
              value = curr.speed !== undefined ? curr.speed : null;
            } else {
              // For non-movement channels (dimmer, color), pass through base values
              value = channelVals[ch.type] !== undefined ? channelVals[ch.type]
                    : (ch.type === 'dimmer' ? 255 : null);
            }
          }
        }
      }

      if (value !== null && value !== undefined) {
        const universe = fixMap.universe;
        if (!channelUpdates[universe]) channelUpdates[universe] = {};
        let finalValue = Math.max(0, Math.min(255, Math.round(value)));
        // Scale by deck fader level (acts as master dimmer for this deck's sequence)
        // Only apply to intensity/color channels — NOT pan/tilt/speed/gobo etc.
        if (deckLevel < 1 && DIMMABLE_CHANNELS.has(ch.type)) {
          finalValue = Math.round(finalValue * deckLevel);
        }
        // Scale by master dimmer — for fixtures WITH a dimmer channel, only apply
        // to the dimmer itself (the fixture hardware multiplies dimmer × RGB, so
        // scaling RGB as well would double-dip). For RGB-only fixtures, apply to
        // the colour channels directly since there's no other way to dim.
        const fixHasDimmer = fixMap.channels.some(c => c.type === 'dimmer');
        if (fixHasDimmer) {
          if (ch.type === 'dimmer') {
            finalValue = applyMasterDimmer(finalValue, ch.type);
          }
          // RGB/white/amber/uv: do NOT scale — dimmer carries the master dim
        } else {
          finalValue = applyMasterDimmer(finalValue, ch.type);
        }
        // Map through channel sub-ranges (e.g. dimmer 0-255 → DMX 8-134)
        if (!skipRangeMap) {
          finalValue = mapValueToRange(finalValue, ch, ch.type);
        }
        channelUpdates[universe][ch.dmx_address] = applyInvert(Math.max(0, Math.min(255, finalValue)), ch);
      }
    }
  }

  // Send all channel updates
  for (const [u, chMap] of Object.entries(channelUpdates)) {
    const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
    if (channels.length > 0) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }

  deckSeq.lastTimeMs = timeMs;
}

/**
 * Deterministic pseudo-random for sparkle / fire effects.
 */
const {
  pseudoRandom, hslToRgb, computeEffectValue, isFixtureCompatibleWithEffect,
  MOVING_HEAD_EFFECT_TYPES, MULTICELL_EFFECT_TYPES, COLOR_EFFECT_TYPES,
  PAN_TILT, COLOR_CHANNELS,
} = require('./effects-engine');

const httpServer = http.createServer(app);

// ─── WebSocket Server ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws) => {
  console.log('[WS] Browser client connected');
  wsClients.add(ws);

  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', state }));

  // Send active sequence state
  for (const [deck, seqState] of Object.entries(activeSequences)) {
    if (seqState.sequence) {
      ws.send(JSON.stringify({ type: 'seq_loaded', deck: +deck, sequence: seqState.sequence }));
      if (seqState.playing) {
        ws.send(JSON.stringify({ type: 'seq_playing', deck: +deck, playing: true }));
      }
    }
  }

  ws.on('message', (rawMsg) => {
    try {
      const msg = JSON.parse(rawMsg.toString());
      if (msg.type === 'sequence') {
        handleSequenceCommand(ws, msg);
      }
    } catch (e) { /* ignore invalid JSON */ }
  });

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('[WS] Browser client disconnected');
  });
});

// ─── Bonjour/mDNS Registration ─────────────────────────────────────────────

function getLocalIPv4() {
  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return '127.0.0.1';
}

function registerBonjour() {
  try {
    const bonjour = new Bonjour();
    // Advertise OS2L service for VirtualDJ discovery
    bonjour.publish({
      name: SERVICE_NAME,
      type: 'os2l',
      protocol: 'tcp',
      port: OS2L_PORT,
      txt: { txtvers: '1' },
    });
    console.log(`[mDNS] Registered "${SERVICE_NAME}" as _os2l._tcp on port ${OS2L_PORT}`);

    // Advertise HTTP service
    bonjour.publish({
      name: SERVICE_NAME,
      type: 'http',
      protocol: 'tcp',
      port: WEB_PORT,
      txt: { path: '/' },
    });
    console.log(`[mDNS] Registered "${SERVICE_NAME}" as _http._tcp on port ${WEB_PORT}`);

    return bonjour;
  } catch (err) {
    console.error(`[mDNS] Failed to register Bonjour: ${err.message}`);
    return null;
  }
}

function getMdnsHostname() {
  return (db.getConfig('mdns_hostname') || MDNS_HOSTNAME_DEFAULT).replace(/\.local$/i, '').trim() || MDNS_HOSTNAME_DEFAULT;
}

// Custom mDNS responder for <hostname>.local
let mdnsResponder = null;
function startMdnsResponder() {
  const enabled = db.getConfig('mdns_enabled') !== '0';
  if (!enabled) {
    console.log('[mDNS] Disabled by config');
    return;
  }
  try {
    const ip = getLocalIPv4();
    const fqdn = getMdnsHostname() + '.local';
    mdnsResponder = mdns({ reuseAddr: true });
    mdnsResponder.on('query', (query) => {
      for (const q of query.questions) {
        if (q.name === fqdn && q.type === 'A') {
          mdnsResponder.respond({
            answers: [{
              name: fqdn,
              type: 'A',
              ttl: 120,
              data: ip
            }]
          });
        }
      }
    });
    mdnsResponder.on('error', (err) => {
      console.error(`[mDNS] Responder error: ${err.message}`);
    });
    console.log(`[mDNS] Responding to ${fqdn} → ${ip}`);
  } catch (err) {
    console.error(`[mDNS] Failed to start responder: ${err.message}`);
  }
}

// ─── Start Everything ───────────────────────────────────────────────────────

// Initialise database
db.init();

// Refresh cached mixer config now that DB is ready
// (the inline call at declaration time fires before db.init() and silently fails)
refreshMixerConfig();

// Apply "DMX output on startup" setting
(function applyStartupDmxSetting() {
  const val = db.getConfig('dmx_output_on_startup');
  if (val === '1' || val === 'true') {
    dmxOutputEnabled = true;
    console.log('[DMX] Output auto-enabled on startup (app setting)');
  }
})();

// Start Art-Net output server (worker thread)
const artnetServer = new ArtNetServer();
const artnetNodes = db.getArtNetUniverses();
const artnetRate = parseInt(db.getConfig('artnet_refresh_rate') || '44', 10);
artnetServer.start(artnetNodes, artnetRate);

// Start DMX USB output server (multi-device manager)
const dmxUsbServer = new DmxUsbServer();

// Initialise OS2L module with all dependencies
os2l.init({
  db,
  broadcast,
  state,
  artnetServer,
  dmxUsbServer,
  touchOverrides,
  runningQaEffects,
  getDmxOutputEnabled: () => dmxOutputEnabled,
  getEffectSlot,
  stopRunningEffect,
  activateScene,
  deactivateScene,
  buildChannelCtx,
  computeEffectValue,
  isFixtureCompatibleWithEffect,
  applyMasterDimmer,
  applyInvert,
  onMessage: handleOs2lSubscribed,
});

// Auto-connect enabled USB devices
(async function autoConnectUsbDevices() {
  const devices = db.getEnabledUsbDevices();
  if (!devices.length) {
    console.log('[DMX-USB] No enabled USB devices to auto-connect');
    return;
  }
  for (const device of devices) {
    if (!device.auto_connect) continue;
    try {
      console.log(`[DMX-USB] Auto-connecting "${device.label}" → universe ${device.local_universe}...`);
      const ok = await dmxUsbServer.openDevice(device);
      if (!ok) console.warn(`[DMX-USB] Failed to auto-connect "${device.label}"`);
    } catch (e) {
      console.error(`[DMX-USB] Error auto-connecting "${device.label}": ${e.message}`);
    }
  }
})();

// Auto-import VDJ database if configured
(function loadVdjDatabase() {
  try {
    let xmlPath = db.getConfig('vdj_db_path');
    if (!xmlPath) xmlPath = vdjParser.findVdjDatabase();
    if (xmlPath) {
      console.log(`[VDJ] Loading database from ${xmlPath}...`);
      const tracks = vdjParser.parseVdjDatabase(xmlPath);
      const result = db.importTracks(tracks);
      console.log(`[VDJ] Imported ${result.total} tracks (${result.inserted} new, ${result.updated} updated)`);
    } else {
      console.log('[VDJ] No database path configured — skip track import');
    }
  } catch (e) {
    console.error(`[VDJ] Failed to load database: ${e.message}`);
  }
})();

os2l.startServer(OS2L_PORT);

httpServer.listen(WEB_PORT, () => {
  console.log(`[HTTP] Web UI at http://localhost:${WEB_PORT}`);
});

const bonjour = registerBonjour();
startMdnsResponder();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  artnetServer.shutdown();
  await dmxUsbServer.shutdownAll();
  if (mdnsResponder) mdnsResponder.destroy();
  if (bonjour) bonjour.destroy();
  const os2lSrv = os2l.getServer();
  if (os2lSrv) os2lSrv.close();
  httpServer.close();
  process.exit(0);
});

console.log(`
╔══════════════════════════════════════════════╗
║          DMX Controller v1.0                 ║
║                                              ║
║  OS2L:  port ${OS2L_PORT}                            ║
║  Web:   http://localhost:${WEB_PORT}                ║
║  mDNS:  http://${getMdnsHostname()}.local:${WEB_PORT}         ║
║                                              ║
║  Waiting for VirtualDJ connection...         ║
╚══════════════════════════════════════════════╝
`);
