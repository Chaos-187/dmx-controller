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
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const Bonjour = require('bonjour-service').Bonjour;
const mdns = require('multicast-dns');
const db = require('./db');
const ArtNetServer = require('./artnet-server');
const DmxUsbServer = require('./dmx-usb-server');
const audioAnalyzer  = require('./audio-analyzer');
const audioInput     = require('./audio-input');
const stemSeparator  = require('./stem-separator');
const os2l = require('./os2l');
const midiController = require('./midi-controller');
const fixtureLibrary = require('./fixture-library');
const { WebUSB } = require('usb');
const {
  pseudoRandom, hslToRgb, computeEffectValue, sequenceEffectProgress, isFixtureCompatibleWithEffect,
  shouldApplyCellCue, isAuxiliaryMulticellChannel,
  MOVING_HEAD_EFFECT_TYPES, MULTICELL_EFFECT_TYPES, COLOR_EFFECT_TYPES,
  RIG_EFFECT_TYPES, SOUND_EFFECT_TYPES,
  PAN_TILT, COLOR_CHANNELS,
} = require('./effects-engine');

// ─── Authentication Helpers ─────────────────────────────────────────────────

const AUTH_ITERATIONS = 100000;
const AUTH_KEYLEN = 64;
const AUTH_DIGEST = 'sha512';

/** Hash a plain-text password with a random salt → { hash, salt } */
function hashPassword(password) {
  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, AUTH_ITERATIONS, AUTH_KEYLEN, AUTH_DIGEST).toString('hex');
  return { hash, salt };
}

/** Verify a plain-text password against stored hash + salt */
function verifyPassword(password, storedHash, storedSalt) {
  const hash = crypto.pbkdf2Sync(password, storedSalt, AUTH_ITERATIONS, AUTH_KEYLEN, AUTH_DIGEST).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

/** In-memory session store: token → { username, created } */
const authSessions = new Map();
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function createSession(username) {
  const token = crypto.randomBytes(32).toString('hex');
  authSessions.set(token, { username, created: Date.now() });
  return token;
}

function validateSession(token) {
  if (!token) return null;
  const session = authSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.created > SESSION_TTL) {
    authSessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  authSessions.delete(token);
}

/** Check if config-screen auth is enabled */
function isAuthEnabled() {
  return db.getConfig('auth_enabled') === '1'
    && db.getConfig('auth_username')
    && db.getConfig('auth_password_hash');
}

/**
 * Express middleware: require a valid session when auth is enabled.
 * Reads token from Authorization header (Bearer) or ?token query.
 */
function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query._token;
  if (validateSession(token)) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

// ─── Configuration ──────────────────────────────────────────────────────────

const OS2L_PORT = 8787;
const WEB_PORT = 80;
const SERVICE_NAME = 'Thaluxis-Hub';
const MDNS_HOSTNAME_DEFAULT = 'thaluxis';
const brand = require('./thaluxis-brand');

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

// Throttled state broadcast (send full state at ~15fps max)
// 15fps is plenty for UI updates and halves the WebSocket traffic vs 30fps
let broadcastTimer = null;
function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcast({ type: 'state', state });
  }, 66); // ~15fps
}

// ─── Now Playing Publisher ──────────────────────────────────────────────────
// Publishes the currently playing track to an external requests system via
// the Now Playing API (see docs/NOW-PLAYING-API.md).

let _lastNowPlayingPayload = null; // track last sent payload to avoid duplicate POSTs

// ─── MusicBrainz Artwork Lookup ─────────────────────────────────────────────
// In-memory cache: "artist|title" → artworkUrl (or null if not found)
const _artworkCache = new Map();
const ARTWORK_CACHE_MAX = 500;
const MB_USER_AGENT = 'DMX-Controller/1.0 (https://github.com/dmx-controller)';

/**
 * Look up album artwork via MusicBrainz + Cover Art Archive.
 * Returns a URL string or null. Results are cached in-memory.
 */
async function lookupArtwork(artist, title) {
  if (!artist || !title) return null;
  const cacheKey = `${artist.toLowerCase()}|${title.toLowerCase()}`;
  if (_artworkCache.has(cacheKey)) return _artworkCache.get(cacheKey);

  try {
    // Search MusicBrainz for the recording
    const query = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`);
    const mbUrl = `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=1`;
    const mbRes = await fetch(mbUrl, {
      headers: { 'User-Agent': MB_USER_AGENT, 'Accept': 'application/json' },
    });
    if (!mbRes.ok) {
      console.warn(`[Artwork] MusicBrainz search returned ${mbRes.status}`);
      _artworkCache.set(cacheKey, null);
      return null;
    }

    const mbData = await mbRes.json();
    const recording = mbData.recordings && mbData.recordings[0];
    if (!recording || !recording.releases || recording.releases.length === 0) {
      _artworkCache.set(cacheKey, null);
      return null;
    }

    // Try each release until we find one with cover art
    for (const release of recording.releases.slice(0, 3)) {
      const mbid = release.id;
      // Cover Art Archive front image (returns 307 redirect to actual image)
      const artUrl = `https://coverartarchive.org/release/${mbid}/front-250`;
      try {
        const artRes = await fetch(artUrl, { method: 'HEAD', redirect: 'follow' });
        if (artRes.ok) {
          const finalUrl = artRes.url || artUrl;
          if (_artworkCache.size >= ARTWORK_CACHE_MAX) {
            // Evict oldest entry
            const firstKey = _artworkCache.keys().next().value;
            _artworkCache.delete(firstKey);
          }
          _artworkCache.set(cacheKey, finalUrl);
          console.log(`[Artwork] Found cover art for "${title}" by "${artist}"`);
          return finalUrl;
        }
      } catch { /* try next release */ }
    }

    _artworkCache.set(cacheKey, null);
    return null;
  } catch (err) {
    console.warn(`[Artwork] Lookup failed: ${err.message}`);
    _artworkCache.set(cacheKey, null);
    return null;
  }
}

function publishNowPlaying(deck) {
  if (db.getConfig('now_playing_enabled') !== '1') return;
  const baseUrl = (db.getConfig('now_playing_base_url') || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  const deckState = state.decks[deck];
  if (!deckState || !deckState.filepath) return;

  const track = db.getTrackByPath(deckState.filepath);
  const title = (track && track.title) || deckState.filename || 'Unknown';
  const artist = (track && track.author) || '';
  const album = (track && track.album) || '';
  const duration = (track && track.song_length) ? Math.round(track.song_length) : undefined;
  // Only use the DB cover field if it looks like a URL (not a local file path)
  const rawCover = (track && track.cover) || '';
  const existingCover = /^https?:\/\//i.test(rawCover) ? rawCover : '';

  const body = { title };
  if (artist) body.artist = artist;
  if (album) body.album = album;
  if (duration) body.duration = duration;

  // Attach event identifier if configured
  const eventId = db.getConfig('now_playing_event_id') || '';
  if (eventId) {
    if (/^\d+$/.test(eventId)) body.eventId = parseInt(eventId, 10);
    else body.eventSlug = eventId;
  }

  // Deduplicate: don't POST the exact same payload twice in a row
  const payloadKey = JSON.stringify(body);
  if (payloadKey === _lastNowPlayingPayload) return;
  _lastNowPlayingPayload = payloadKey;

  const url = `${baseUrl}/api/now-playing`;

  console.log(`[NowPlaying] Preparing: "${title}" by "${artist}" (cover in DB: ${rawCover ? 'yes' : 'no'}, usable URL: ${existingCover ? 'yes' : 'no'})`);

  // If track already has a cover URL, send immediately
  if (existingCover) {
    body.artwork = existingCover;
    _sendNowPlaying(url, body, title, artist);
  } else if (db.getConfig('now_playing_artwork') !== '0') {
    // Look up artwork from MusicBrainz (async), then send
    console.log(`[NowPlaying] Looking up artwork from MusicBrainz for "${title}" by "${artist}"...`);
    lookupArtwork(artist, title).then(artworkUrl => {
      if (artworkUrl) body.artwork = artworkUrl;
      else console.log(`[NowPlaying] No artwork found on MusicBrainz`);
      _sendNowPlaying(url, body, title, artist);
    });
  } else {
    _sendNowPlaying(url, body, title, artist);
  }
}

function _sendNowPlaying(url, body, title, artist) {
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => {
    if (!r.ok) console.warn(`[NowPlaying] POST ${url} returned ${r.status}`);
    else console.log(`[NowPlaying] Published: "${title}" by "${artist}"${body.artwork ? ' (with artwork)' : ''}`);
  }).catch(err => {
    console.warn(`[NowPlaying] Failed to publish: ${err.message}`);
  });
}

function clearNowPlaying() {
  if (db.getConfig('now_playing_enabled') !== '1') return;
  const baseUrl = (db.getConfig('now_playing_base_url') || '').replace(/\/+$/, '');
  if (!baseUrl) return;

  _lastNowPlayingPayload = null;

  let url = `${baseUrl}/api/now-playing`;
  const eventId = db.getConfig('now_playing_event_id') || '';
  if (eventId) {
    const param = /^\d+$/.test(eventId) ? `eventId=${eventId}` : `eventSlug=${encodeURIComponent(eventId)}`;
    url += `?${param}`;
  }

  fetch(url, { method: 'DELETE' }).then(r => {
    if (!r.ok) console.warn(`[NowPlaying] DELETE ${url} returned ${r.status}`);
    else console.log('[NowPlaying] Cleared now-playing');
  }).catch(err => {
    console.warn(`[NowPlaying] Failed to clear: ${err.message}`);
  });
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

      // Resolve track_id for the UI (waveform display, etc.)
      const resolvedTrack = db.getTrackByPath(value);
      state.decks[deck].track_id = resolvedTrack ? resolvedTrack.id : null;

      // ─── Sequencer auto-load / auto-play / auto-generate ─────
      const seqAutoLoad = db.getConfig('seq_auto_load') === '1';
      const seqAutoUnload = db.getConfig('seq_auto_unload') === '1';
      const seqAutoGenerate = db.getConfig('seq_auto_generate') === '1';
      const seqAutoRegenerateStale = db.getConfig('seq_auto_regenerate_stale') === '1';
      if (db.getConfig('debug_logging') === '1') console.log(`[OS2L-DEBUG] Deck ${deck} auto-load=${seqAutoLoad} auto-unload=${seqAutoUnload} auto-gen=${seqAutoGenerate} stale-regen=${seqAutoRegenerateStale}`);
      if (seqAutoLoad || seqAutoUnload || seqAutoGenerate || seqAutoRegenerateStale) {
        const track = db.getTrackByPath(value);
        let seq = track ? db.getSequenceByTrackId(track.id) : null;
        if (db.getConfig('debug_logging') === '1') console.log(`[OS2L-DEBUG] Deck ${deck} track=${track ? track.id : 'null'} seq=${seq ? seq.id : 'null'}`);

        const seqIsStale = seq && db.isSequenceFixtureStale(seq);
        if (seq && seqIsStale && seqAutoRegenerateStale && track) {
          const regenTrackId = track.id;
          const regenDeck = deck;
          const regenFilePath = value;
          (async () => {
            try {
              console.log(`[SEQ] Sequence for track ${regenTrackId} is outdated — regenerating in background...`);
              const liveFirstbeat = state.decks[regenDeck] && state.decks[regenDeck].firstbeat;
              let fbPos = track.beatgrid_pos || 0;
              if (!fbPos && liveFirstbeat > 0) {
                fbPos = liveFirstbeat > 60 ? liveFirstbeat / 1000 : liveFirstbeat;
              }
              const result = await sequenceRoutes.generateSequenceForTrack(track, {
                overwrite: true,
                beatgridPosOverride: fbPos,
                filepathOverride: regenFilePath,
              });
              if (!result.sequence) return;
              const generatedSeq = result.sequence;
              broadcast({
                type: 'seq_generated',
                track_id: regenTrackId,
                sequence: { ...generatedSeq, cues: undefined, cue_count: result.cue_count },
                reason: 'stale_fixtures',
              });
              const deckTrack = state.decks[regenDeck]?.track_id;
              if (deckTrack !== regenTrackId) return;
              if (seqAutoLoad) {
                touchOverrides.os2lOverrideFixtures.clear();
                touchOverrides.colorOverrideFixtures.clear();
                touchOverrides.movementOverrideFixtures.clear();
                touchOverrides.smokeOverrideFixtures.clear();
                touchOverrides.atmosphereOverrideFixtures.clear();
                clearSequenceColorOverride();
                clearSequenceBlockingOverrides();
                deactivateScene();
                stopPlaybackTimer(regenDeck);
                blackoutDeckFixtures(regenDeck);
                activeSequences[regenDeck] = { sequence: generatedSeq, cuesByStart: sortCuesByStart(generatedSeq.cues), lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
                broadcast({ type: 'seq_loaded', deck: regenDeck, sequence: sequenceForClient(generatedSeq) });
                const deckPlayState = state.decks[regenDeck] && state.decks[regenDeck].play;
                const deckIsPlaying = deckPlayState === 1 || deckPlayState === true || deckPlayState === 'on';
                if (deckIsPlaying) {
                  activeSequences[regenDeck].playing = true;
                  activeSequences[regenDeck].vdjDriven = true;
                  startPlaybackTimer(regenDeck);
                  broadcast({ type: 'seq_playing', deck: regenDeck, playing: true });
                }
              }
            } catch (e) {
              console.error(`[SEQ] Stale auto-regenerate failed for track ${regenTrackId}:`, e.message);
            }
          })();
          // Continue — load existing sequence now; hot-swap when background regen completes
        }

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
              const needsAnalysis = !analysis || (analysis.analysis_version || 0) < audioAnalyzer.ANALYSIS_VERSION;
              if (needsAnalysis && actualFilePath && fileExists) {
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
                      anchorPoints: getAnchorPoints(track),
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

              // Auto-separate stems if not already present (unless disabled in config)
              const noStems = db.getConfig('seq_no_stems') === '1';
              if (!noStems && analysis && !analysis.stem_energy && actualFilePath && fileExists) {
                try {
                  console.log(`[SEQ] Auto-separating stems for "${track.title || track.filename}"...`);
                  const stemResult = await stemSeparator.separateStems(actualFilePath, {
                    onProgress: (pct) => broadcast({ type: 'stem_progress', track_id: track.id, progress: pct }),
                  });
                  if (stemResult && stemResult.stems) {
                    const summary = stemSeparator.computeStemSummary(stemResult.stems);
                    db.updateStemEnergy(track.id, { ...stemResult, summary });
                    analysis = db.getTrackAnalysis(track.id);
                    broadcast({ type: 'stem_complete', track_id: track.id });
                    console.log(`[SEQ] Auto-separated stems (${stemResult.method}) for "${track.title || track.filename}"`);
                  }
                } catch (se) {
                  console.warn(`[SEQ] Auto-stem separation failed: ${se.message}`);
                }
              }

              const liveFirstbeat = state.decks[deck] && state.decks[deck].firstbeat;
              let fbPos = track.beatgrid_pos || 0;
              if (!fbPos && liveFirstbeat > 0) {
                fbPos = liveFirstbeat > 60 ? liveFirstbeat / 1000 : liveFirstbeat;
              }

              const result = await sequenceRoutes.generateSequenceForTrack(
                { ...track, beatgrid_pos: fbPos },
                {
                  overwrite: true,
                  filepathOverride: actualFilePath,
                  fixtures,
                  analysis,
                  skipAnalysis: true,
                },
              );
              if (!result.sequence) return;
              const generatedSeq = result.sequence;
              broadcast({
                type: 'seq_generated',
                track_id: track.id,
                sequence: { ...generatedSeq, cues: undefined, cue_count: result.cue_count },
              });
              console.log(`[SEQ] Auto-generated sequence "${generatedSeq.name}" (${result.cue_count} cues) for deck ${deck}`);

              // Now auto-load if enabled
              if (seqAutoLoad) {
                // Clear any OS2L button overrides so the new sequence controls all fixtures
                touchOverrides.os2lOverrideFixtures.clear();
                touchOverrides.colorOverrideFixtures.clear();
                touchOverrides.movementOverrideFixtures.clear();
                touchOverrides.smokeOverrideFixtures.clear();
                touchOverrides.atmosphereOverrideFixtures.clear();
                clearSequenceColorOverride();
                clearSequenceBlockingOverrides();
                deactivateScene(); // Stop any scene effect loop from end-action
                stopPlaybackTimer(deck);
                blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
                activeSequences[deck] = { sequence: generatedSeq, cuesByStart: sortCuesByStart(generatedSeq.cues), lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
                broadcast({ type: 'seq_loaded', deck, sequence: sequenceForClient(generatedSeq) });
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
          seq.cues = db.getSequenceCues(seq.id);
          touchOverrides.os2lOverrideFixtures.clear();
          touchOverrides.colorOverrideFixtures.clear();
          touchOverrides.movementOverrideFixtures.clear();
          touchOverrides.smokeOverrideFixtures.clear();
          touchOverrides.atmosphereOverrideFixtures.clear();
          clearSequenceColorOverride();
          clearSequenceBlockingOverrides();
          deactivateScene(); // Stop any scene effect loop from end-action
          stopPlaybackTimer(deck);
          blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
          activeSequences[deck] = { sequence: seq, cuesByStart: sortCuesByStart(seq.cues), lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
          broadcast({ type: 'seq_loaded', deck, sequence: sequenceForClient(seq) });
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

    // ─── Publish now-playing on track load (filepath change while playing) ────
    if (key === 'filepath' && state.decks[deck].play) {
      publishNowPlaying(deck);
    }

    // ─── Sync sequence playback with deck play/pause state ─────
    if (key === 'play') {
      const deckNowPlaying = state.decks[deck].play;  // already normalized to 1/0
      if (deckNowPlaying) {
        // Deck started playing — publish now-playing
        publishNowPlaying(deck);
      } else {
        // Deck stopped — clear now-playing if no other deck is playing
        const anyPlaying = Object.values(state.decks).some(d => d.play === 1 || d.play === true);
        if (!anyPlaying) clearNowPlaying();
      }
    }
    if (key === 'play' && activeSequences[deck]) {
      const deckNowPlaying = state.decks[deck].play;  // already normalized to 1/0
      if (deckNowPlaying && !activeSequences[deck].playing) {
        // Deck started playing — resume the sequence
        clearSequenceBlockingOverrides();
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

const compression = require('compression');
const app = express();
app.use(compression());
app.use(express.json({ limit: '200mb' }));
app.use('/lib', express.static(path.join(__dirname, 'node_modules/waveform-data/dist')));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth API ───────────────────────────────────────────────────────────────

/** Check auth status — always accessible */
app.get('/api/auth/status', (req, res) => {
  const enabled = isAuthEnabled();
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.query._token;
  const session = validateSession(token);
  res.json({ enabled, authenticated: !!session, username: session?.username || null });
});

/** Log in with username + password → returns session token */
app.post('/api/auth/login', (req, res) => {
  if (!isAuthEnabled()) return res.status(400).json({ error: 'Auth is not enabled' });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const storedUser = db.getConfig('auth_username');
  const storedHash = db.getConfig('auth_password_hash');
  const storedSalt = db.getConfig('auth_password_salt');
  if (!storedUser || !storedHash || !storedSalt) return res.status(500).json({ error: 'Auth not configured' });

  if (username !== storedUser || !verifyPassword(password, storedHash, storedSalt)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = createSession(username);
  res.json({ token, username });
});

/** Log out — destroy session */
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) destroySession(token);
  res.json({ ok: true });
});

/** Set up or update auth credentials (requires existing auth if enabled) */
app.post('/api/auth/setup', (req, res) => {
  // If auth is already enabled, require a valid session to change it
  if (isAuthEnabled()) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!validateSession(token)) {
      return res.status(401).json({ error: 'Authentication required to change credentials' });
    }
  }

  const { enabled, username, password } = req.body || {};

  if (enabled === false || enabled === '0') {
    // Disable auth
    db.setConfig('auth_enabled', '0');
    // Clear all sessions
    authSessions.clear();
    return res.json({ ok: true, enabled: false });
  }

  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const { hash, salt } = hashPassword(password);
  db.setConfig('auth_username', username);
  db.setConfig('auth_password_hash', hash);
  db.setConfig('auth_password_salt', salt);
  db.setConfig('auth_enabled', '1');

  // If caller has no session yet, create one so they stay logged in
  const authHeader = req.headers.authorization || '';
  const existingToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  let token = existingToken;
  if (!validateSession(existingToken)) {
    token = createSession(username);
  }
  res.json({ ok: true, enabled: true, token });
});

// ─── Auth middleware for config-related write routes ────────────────────────
const configProtectedPrefixes = [
  '/api/config',
  '/api/generator-config',
  '/api/mdns',
  '/api/usb-devices',
  '/api/artnet',
  '/api/audio-input',
  '/api/fixture-types',
  '/api/fixture-library',
  '/api/hub',
];
app.use((req, res, next) => {
  if (req.method === 'GET') return next(); // reads are open
  const isConfigPath = configProtectedPrefixes.some(p => req.path.startsWith(p));
  if (!isConfigPath) return next();
  return requireAuth(req, res, next);
});

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
        let fixtureTypeId;
        if (existing) {
          db.updateFixtureType(existing.id, ft);
          fixtureTypeId = existing.id;
          results.updated++;
        } else {
          const created = db.createFixtureType(ft);
          fixtureTypeId = created.id;
          results.imported++;
        }

        // Save color wheel map if the OFL fixture had wheel slot data
        if (fixtureTypeId && ft._colorWheel && ft._colorWheel.length) {
          db.setColorWheelMap(fixtureTypeId, ft._colorWheel);
        }
        // Save gobo wheel map if the OFL fixture had gobo slot data
        if (fixtureTypeId && ft._goboWheel && ft._goboWheel.length) {
          db.setGoboWheelMap(fixtureTypeId, ft._goboWheel);
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
  const channels = req.query.channels ? +req.query.channels : 0;
  const limit = Math.min(Math.max(+req.query.limit || 50, 1), 200);
  const offset = Math.max(+req.query.offset || 0, 0);
  res.json(db.searchFixtureTypes({ search, category, manufacturer, channels, limit, offset }));
});

app.get('/api/fixture-types/:id', (req, res) => {
  const t = db.getFixtureType(+req.params.id);
  t ? res.json(t) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/fixture-types', (req, res) => {
  try {
    const result = db.createFixtureType(req.body);
    invalidateFixtureChannelMapCache();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create an LED Bar fixture type with a cell-repeat pattern
app.post('/api/fixture-types/led-bar', (req, res) => {
  try {
    const result = db.createLedBarFixtureType(req.body);
    invalidateFixtureChannelMapCache();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create a pixel tape fixture type (long 1D strip)
app.post('/api/fixture-types/pixel-tape', (req, res) => {
  try {
    const result = db.createPixelTapeFixtureType(req.body);
    invalidateFixtureChannelMapCache();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Create a multi-cell fixture type with optional master channels
app.post('/api/fixture-types/multi-cell', (req, res) => {
  try {
    const result = db.createMultiCellFixtureType(req.body);
    invalidateFixtureChannelMapCache();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixture-types/:id', (req, res) => {
  const result = db.updateFixtureType(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  invalidateFixtureChannelMapCache();
  res.json(result);
});

app.delete('/api/fixture-types/:id', (req, res) => {
  const result = db.deleteFixtureType(+req.params.id);
  if (result.error) return res.status(409).json(result);
  invalidateFixtureChannelMapCache();
  res.json(result);
});

// ─── Color Wheel Map API ────────────────────────────────────────────────────

app.get('/api/fixture-types/:id/color-wheel', (req, res) => {
  res.json(db.getColorWheelMap(+req.params.id));
});

app.put('/api/fixture-types/:id/color-wheel', (req, res) => {
  try {
    const colors = req.body.colors;
    if (!Array.isArray(colors)) return res.status(400).json({ error: 'colors array required' });
    const result = db.setColorWheelMap(+req.params.id, colors);
    invalidateFixtureChannelMapCache();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/fixture-types/:id/color-wheel', (req, res) => {
  db.deleteColorWheelMap(+req.params.id);
  invalidateFixtureChannelMapCache();
  res.json({ ok: true });
});

app.get('/api/color-wheel-maps', (req, res) => {
  res.json(db.getAllColorWheelMaps());
});

// ─── Gobo Wheel Map API ─────────────────────────────────────────────────────

app.get('/api/fixture-types/:id/gobos', (req, res) => {
  res.json(db.getGoboWheelMap(+req.params.id));
});

app.put('/api/fixture-types/:id/gobos', (req, res) => {
  try {
    const slots = req.body.slots;
    if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots array required' });
    const result = db.setGoboWheelMap(+req.params.id, slots);
    invalidateFixtureChannelMapCache();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/fixture-types/:id/gobos', (req, res) => {
  db.deleteGoboWheelMap(+req.params.id);
  invalidateFixtureChannelMapCache();
  res.json({ ok: true });
});

app.get('/api/gobo-wheel-maps', (req, res) => {
  res.json(db.getAllGoboWheelMaps());
});

// ─── Fixture API ────────────────────────────────────────────────────────────

app.get('/api/fixtures/next-address', (req, res) => {
  const universe = +req.query.universe || 1;
  const channels = +req.query.channels || 1;
  const exclude = req.query.exclude ? +req.query.exclude : null;
  const address = db.getNextAvailableAddress(universe, channels, exclude);
  res.json({ address });
});

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
    invalidateFixtureChannelMapCache();
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/fixtures/batch', (req, res) => {
  try {
    const { quantity, ...baseFixture } = req.body;
    const qty = Math.min(Math.max(+quantity || 1, 1), 64);
    const results = db.createFixtureBatch(baseFixture, qty);
    if (results.error) return res.status(400).json(results);
    invalidateFixtureChannelMapCache();
    res.status(201).json(results);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/fixtures/:id', (req, res) => {
  const result = db.updateFixture(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  invalidateFixtureChannelMapCache();
  res.json(result);
});

app.delete('/api/fixtures/:id', (req, res) => {
  db.deleteFixture(+req.params.id);
  invalidateFixtureChannelMapCache();
  res.json({ deleted: true });
});

// ── Rig Layout API ──────────────────────────────────────────────────────────

app.put('/api/fixtures/rig-layout', (req, res) => {
  const positions = req.body.positions;
  if (!Array.isArray(positions)) return res.status(400).json({ error: 'positions array required' });
  const result = db.updateFixtureRigPositions(positions);
  res.json(result);
});

// ── Rig Elements API ────────────────────────────────────────────────────────

app.get('/api/rig-elements', (req, res) => {
  res.json(db.getRigElements());
});

app.post('/api/rig-elements', (req, res) => {
  try {
    const result = db.createRigElement(req.body);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/rig-elements/bulk', (req, res) => {
  const elements = req.body.elements;
  if (!Array.isArray(elements)) return res.status(400).json({ error: 'elements array required' });
  const result = db.bulkUpdateRigElements(elements);
  res.json(result);
});

app.put('/api/rig-elements/:id', (req, res) => {
  const result = db.updateRigElement(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/rig-elements/:id', (req, res) => {
  db.deleteRigElement(+req.params.id);
  res.json({ deleted: true });
});

// ── Rig Layouts API (save/load named snapshots) ─────────────────────────────

app.get('/api/rig-layouts', (req, res) => {
  res.json(db.getRigLayouts());
});

app.get('/api/rig-layouts/active', (req, res) => {
  res.json(db.getActiveRigLayout());
});

app.get('/api/rig-layouts/:id', (req, res) => {
  const layout = db.getRigLayout(+req.params.id);
  if (!layout) return res.status(404).json({ error: 'Not found' });
  res.json(layout);
});

app.post('/api/rig-layouts', (req, res) => {
  try {
    const result = db.createRigLayout(req.body.name, req.body.data);
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/rig-layouts/:id', (req, res) => {
  const result = db.updateRigLayout(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.post('/api/rig-layouts/:id/load', (req, res) => {
  const result = db.loadRigLayout(+req.params.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

app.delete('/api/rig-layouts/:id', (req, res) => {
  db.deleteRigLayout(+req.params.id);
  res.json({ deleted: true });
});

app.put('/api/rig-layouts/:id/set-active', (req, res) => {
  db.setActiveRigLayout(+req.params.id);
  res.json({ active: true });
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
  invalidateFixtureChannelMapCache();
  res.status(201).json(result);
});

app.put('/api/groups/:id', (req, res) => {
  const result = db.updateGroup(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  invalidateFixtureChannelMapCache();
  res.json(result);
});

app.delete('/api/groups/:id', (req, res) => {
  db.deleteGroup(+req.params.id);
  invalidateFixtureChannelMapCache();
  res.json({ deleted: true });
});

app.put('/api/groups/:id/fixtures', (req, res) => {
  const result = db.setGroupFixtures(+req.params.id, req.body.fixture_ids || []);
  if (result.error) return res.status(400).json(result);
  invalidateFixtureChannelMapCache();
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
  invalidateMoverPresetCache();
  res.json(result);
});

app.put('/api/mover-presets/:id', (req, res) => {
  const result = db.updateMoverPreset(+req.params.id, req.body);
  invalidateMoverPresetCache();
  result ? res.json(result) : res.status(404).json({ error: 'Not found' });
});

app.delete('/api/mover-presets/:id', (req, res) => {
  const result = db.deleteMoverPreset(+req.params.id);
  if (result.error) return res.status(403).json(result);
  invalidateMoverPresetCache();
  res.json(result);
});

// ─── Version / About API ────────────────────────────────────────────────────

app.get('/api/version', async (req, res) => {
  const pkg = require('./package.json');
  const [ffmpegVersion, ffprobeVersion] = await Promise.all([
    audioAnalyzer.getFfmpegVersion(),
    audioAnalyzer.getFfprobeVersion()
  ]);

  // Gather dependency licenses
  const deps = Object.keys(pkg.dependencies || {});
  const licenses = [];
  for (const dep of deps) {
    try {
      const depPkg = require(dep + '/package.json');
      licenses.push({
        name: dep,
        version: depPkg.version || '—',
        license: depPkg.license || 'Unknown',
        author: typeof depPkg.author === 'string' ? depPkg.author : (depPkg.author && depPkg.author.name ? depPkg.author.name : ''),
        homepage: depPkg.homepage || depPkg.repository && (typeof depPkg.repository === 'string' ? depPkg.repository : depPkg.repository.url) || ''
      });
    } catch (_) {
      licenses.push({ name: dep, version: '—', license: 'Unknown', author: '', homepage: '' });
    }
  }

  res.json({
    version: pkg.version,
    name: pkg.name,
    description: pkg.description,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    ffmpeg: ffmpegVersion || 'Not found',
    ffprobe: ffprobeVersion || 'Not found',
    licenses
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

    // Invalidate all hot-path caches after bulk import
    invalidateFixtureChannelMapCache();
    invalidateEffectCache();
    invalidateMoverPresetCache();

    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/config', (req, res) => {
  const config = db.getAllConfig();
  // Never expose password hash/salt to the client
  delete config.auth_password_hash;
  delete config.auth_password_salt;
  res.json(config);
});

app.put('/api/config/:key', (req, res) => {
  // Block direct writes to auth keys — must use /api/auth/setup
  if (req.params.key.startsWith('auth_')) {
    return res.status(403).json({ error: 'Use /api/auth/setup to change auth settings' });
  }
  db.setConfig(req.params.key, req.body.value);
  // Refresh cached mixer settings when relevant keys change
  if (req.params.key.startsWith('seq_')) refreshMixerConfig();
  res.json({ key: req.params.key, value: req.body.value });
});

// ─── Generator Config API ───────────────────────────────────────────────────

app.get('/api/generator-config', (req, res) => {
  try {
    res.json(db.getGeneratorConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/generator-config/:key', (req, res) => {
  try {
    const key = req.params.key;
    if (!key.startsWith('gen_')) return res.status(400).json({ error: 'Key must start with gen_' });
    db.setGeneratorConfigKey(key, req.body.value);
    res.json({ key, value: req.body.value });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/generator-config/reset', (req, res) => {
  try {
    db.resetGeneratorConfig();
    res.json(db.getGeneratorConfig());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
  // Update in-memory config so universe routing is correct without reconnecting
  dmxUsbServer.updateDeviceConfig(+req.params.id, result);
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

// ─── Audio Input API ─────────────────────────────────────────────────────────

/** List audio input devices available on this machine via ffmpeg. */
app.get('/api/audio-input/devices', async (req, res) => {
  try {
    const devices = await audioInput.listAudioDevices();
    res.json({ devices, platform_format: audioInput.getPlatformFormat() });
  } catch (e) {
    res.json({ devices: [], platform_format: audioInput.getPlatformFormat() });
  }
});

/** Get current audio input configuration. */
app.get('/api/audio-input/config', (req, res) => {
  const cfg = db.getAllConfig();
  res.json({
    enabled:     cfg.audio_input_enabled === '1',
    device_name: cfg.audio_input_device  || '',
    format:      cfg.audio_input_format  || audioInput.getPlatformFormat(),
    gain:        parseFloat(cfg.audio_input_gain || '1.0'),
  });
});

/** Save audio input configuration. Restarts capture if enabled. */
app.post('/api/audio-input/config', (req, res) => {
  const { enabled, device_name, format, gain } = req.body;

  db.setConfig('audio_input_enabled', enabled ? '1' : '0');
  if (device_name !== undefined) db.setConfig('audio_input_device', String(device_name));
  if (format      !== undefined) db.setConfig('audio_input_format',  String(format));
  if (gain        !== undefined) db.setConfig('audio_input_gain',    String(parseFloat(gain) || 1.0));

  _applyAudioInputConfig();
  res.json({ ok: true });
});

/** Current capture status and live levels. */
app.get('/api/audio-input/status', (req, res) => {
  res.json({
    running:     audioInput.capture.running,
    device_name: audioInput.capture.deviceName,
    format:      audioInput.capture.format,
    error:       audioInput.capture.error,
    levels:      audioInput.capture.getLevels(),
  });
});

/** Manually start capture (uses saved config). */
app.post('/api/audio-input/start', (req, res) => {
  _applyAudioInputConfig(true);
  res.json({ ok: true, running: audioInput.capture.running });
});

/** Stop capture without changing saved config. */
app.post('/api/audio-input/stop', (req, res) => {
  audioInput.capture.stop();
  res.json({ ok: true });
});

// ── Helper: read config and (re)start or stop capture accordingly ─────────────
function _applyAudioInputConfig(forceStart = false) {
  const cfg         = db.getAllConfig();
  const enabled     = cfg.audio_input_enabled === '1';
  const device_name = cfg.audio_input_device  || '';
  const format      = cfg.audio_input_format  || audioInput.getPlatformFormat();
  const gain        = parseFloat(cfg.audio_input_gain || '1.0');

  if ((enabled || forceStart) && device_name) {
    audioInput.capture.start(device_name, format, gain);
  } else {
    audioInput.capture.stop();
  }
}

// Broadcast live audio levels to all WebSocket clients so the config page
// level meters can update in real-time.
audioInput.capture.on('levels', (levels) => {
  broadcast({ type: 'audio_input_level', levels });
});

audioInput.capture.on('stopped', ({ error }) => {
  broadcast({ type: 'audio_input_status', running: false, error: error || null });
});

audioInput.capture.on('started', ({ deviceName, format }) => {
  broadcast({ type: 'audio_input_status', running: true, device_name: deviceName, format });
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
  /** Per-group submaster 0–255 (MIDI/touch). Missing key = full (255). Multiplied on dimmer channels during playback. */
  groupDimmers: {},
  os2lOverrideFixtures: new Set(), // fixture IDs currently controlled by an OS2L button action
  colorOverrideFixtures: new Set(),    // fixture IDs with color overridden from touch UI
  movementOverrideFixtures: new Set(), // fixture IDs with movement overridden from touch UI
  smokeOverrideFixtures: new Set(),    // fixture IDs with smoke overridden from touch UI
  atmosphereOverrideFixtures: new Set(), // fixture IDs with atmosphere/fire overridden (manual only)
  /** MIDI / OS2L live color — applied as overlay each sequence tick (movement continues). */
  activeColorOverride: null,
  /** True while Full On is held — blocks effect ticks from overwriting DMX. */
  fullOnHold: false,
  /** Stream Deck Colors page: true = push on/release off, false = tap toggle. */
  companionColorPushMode: true,
};

const TOUCH_GROUP_DIMMERS_CONFIG_KEY = 'touch_group_dimmers';

function loadTouchGroupDimmers() {
  try {
    const raw = db.getConfig(TOUCH_GROUP_DIMMERS_CONFIG_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const groupId = +k;
      if (!groupId) continue;
      touchOverrides.groupDimmers[groupId] = Math.max(0, Math.min(255, Math.round(+v || 0)));
    }
    const n = Object.keys(touchOverrides.groupDimmers).length;
    if (n) console.log(`[TOUCH] Restored ${n} persisted group dimmer level(s)`);
  } catch (e) {
    console.warn('[TOUCH] Could not load persisted group dimmers:', e.message);
  }
}

function persistTouchGroupDimmers() {
  try {
    const out = {};
    for (const [k, v] of Object.entries(touchOverrides.groupDimmers)) {
      const groupId = +k;
      if (!groupId) continue;
      out[String(groupId)] = Math.max(0, Math.min(255, Math.round(+v || 0)));
    }
    db.setConfig(TOUCH_GROUP_DIMMERS_CONFIG_KEY, JSON.stringify(out));
  } catch (e) {
    console.warn('[TOUCH] Could not persist group dimmers:', e.message);
  }
}

/** Push one group's dimmer level to fixture dimmer channels (idle / non-sequence). */
function applyGroupDimmerLevelToDmx(groupId, val) {
  if (!dmxOutputEnabled || isAnySequencePlaying()) return;
  const channelUpdates = {};
  for (const fix of getFixtureChannelMapCached()) {
    if (!(fix.group_ids || []).includes(groupId)) continue;
    if (isFixtureDisabled(fix.id)) continue;
    const u = fix.universe;
    if (!channelUpdates[u]) channelUpdates[u] = [];
    for (const ch of fix.channels) {
      if (ch.type === 'dimmer') {
        channelUpdates[u].push({ ch: ch.dmx_address, val: applyTouchDimmerChain(255, fix, 'dimmer') });
      }
    }
  }
  for (const [u, channels] of Object.entries(channelUpdates)) {
    artnetServer.setChannels(+u, channels);
    dmxUsbServer.setChannels(+u, channels);
  }
  // Re-apply live color so RGB-only fixtures pick up the new group level
  const ov = touchOverrides.activeColorOverride;
  if (ov && !isAnySequencePlaying()) {
    midiController.triggerAction('color', {
      red: ov.red || 0, green: ov.green || 0, blue: ov.blue || 0, white: ov.white || 0,
      group_id: ov.group_id,
    }, { mode: 'on', key: 'group-dimmer-refresh' });
  }
}

function applyAllPersistedGroupDimmersToDmx() {
  for (const [gid, val] of Object.entries(touchOverrides.groupDimmers)) {
    applyGroupDimmerLevelToDmx(+gid, val);
  }
}

function normalizeFixtureId(id) {
  const n = Number(id);
  return Number.isFinite(n) ? n : id;
}

function isFixtureDisabled(id) {
  if (id == null) return false;
  const nid = normalizeFixtureId(id);
  return touchOverrides.disabledFixtures.has(nid) || touchOverrides.disabledFixtures.has(id);
}

let _disabledDmxChannelCacheKey = '';
let _disabledDmxChannelSet = null;

function getDisabledDmxChannelSet() {
  const key = [...touchOverrides.disabledFixtures].sort((a, b) => Number(a) - Number(b)).join(',');
  if (_disabledDmxChannelCacheKey === key && _disabledDmxChannelSet) return _disabledDmxChannelSet;
  const set = new Set();
  for (const fix of getFixtureChannelMapCached()) {
    if (!isFixtureDisabled(fix.id)) continue;
    const u = fix.universe || 1;
    for (const ch of fix.channels) set.add(`${u}:${ch.dmx_address}`);
  }
  _disabledDmxChannelCacheKey = key;
  _disabledDmxChannelSet = set;
  return set;
}

function filterDmxChannelsForDisabledFixtures(universe, channels) {
  if (!Array.isArray(channels) || channels.length === 0 || touchOverrides.disabledFixtures.size === 0) {
    return channels || [];
  }
  const disabled = getDisabledDmxChannelSet();
  if (disabled.size === 0) return channels;
  const u = universe || 1;
  return channels.filter(({ ch }) => !disabled.has(`${u}:${ch}`));
}

function clearFixtureOverrideTracking(fixtureId) {
  const fid = normalizeFixtureId(fixtureId);
  touchOverrides.colorOverrideFixtures.delete(fid);
  touchOverrides.colorOverrideFixtures.delete(fixtureId);
  touchOverrides.movementOverrideFixtures.delete(fid);
  touchOverrides.movementOverrideFixtures.delete(fixtureId);
  touchOverrides.smokeOverrideFixtures.delete(fid);
  touchOverrides.smokeOverrideFixtures.delete(fixtureId);
  touchOverrides.atmosphereOverrideFixtures.delete(fid);
  touchOverrides.atmosphereOverrideFixtures.delete(fixtureId);
}

/** Drop full-on hold so sequence playback is not blocked. */
function clearSequenceBlockingOverrides() {
  touchOverrides.fullOnHold = false;
}

/** Clear latched Stream Deck / MIDI color (e.g. on track or sequence load). */
function clearSequenceColorOverride() {
  try {
    midiController.clearCompanionColorOverride();
  } catch (e) {
    touchOverrides.activeColorOverride = null;
    console.warn('[SEQ] Could not clear companion color override:', e.message);
  }
}

function liveColorOverrideAppliesToFixture(fix, ov) {
  if (!ov) return false;
  if (ov.group_id && !(fix.group_ids || []).includes(ov.group_id)) return false;
  return true;
}

/** Recolor multicell effect base values from live Stream Deck / MIDI override (patterns keep running). */
function applyLiveColorOverrideForMulticell(fixMap, effectBaseVals, effectParams) {
  const ov = touchOverrides.activeColorOverride;
  if (!ov || (fixMap.cell_count || 0) <= 0) {
    return { effectBaseVals, effectParams };
  }
  if (!liveColorOverrideAppliesToFixture(fixMap, ov)) {
    return { effectBaseVals, effectParams };
  }

  const base = { ...effectBaseVals };
  if (ov.red != null) base.red = ov.red;
  if (ov.green != null) base.green = ov.green;
  if (ov.blue != null) base.blue = ov.blue;
  if (ov.white != null) base.white = ov.white;
  if (base.dimmer === undefined) base.dimmer = effectBaseVals.dimmer ?? 255;

  return {
    effectBaseVals: base,
    effectParams: { ...effectParams, live_color_override: true, color_mode: 'base' },
  };
}

function sequenceForClient(seq) {
  if (!seq) return null;
  const cueCount = seq.cues?.length ?? seq.cue_count ?? 0;
  const { cues, ...rest } = seq;
  return { ...rest, cue_count: cueCount };
}

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
  const filtered = filterDmxChannelsForDisabledFixtures(universe, [{ ch: channel, val: value }]);
  if (filtered.length === 0) return res.json({ ok: true, skipped: true });
  artnetServer.setChannel(universe, channel, filtered[0].val);
  dmxUsbServer.setChannel(universe, channel, filtered[0].val);
  res.json({ ok: true });
});

app.post('/api/dmx/channels', (req, res) => {
  const { universe, channels } = req.body;  // channels: [{ch, val}]
  if (!dmxOutputEnabled) return res.json({ ok: true, outputOff: true });
  const filtered = filterDmxChannelsForDisabledFixtures(universe, channels);
  if (filtered.length === 0) return res.json({ ok: true, skipped: true });
  artnetServer.setChannels(universe, filtered);
  dmxUsbServer.setChannels(universe, filtered);
  res.json({ ok: true });
});

// ─── Touch PIN API ───────────────────────────────────────────────────────────

/** Check if touch PIN is enabled and get idle timeout */
app.get('/api/touch-pin/status', (req, res) => {
  const pin = db.getConfig('touch_pin');
  const enabled = db.getConfig('touch_pin_enabled') === '1' && !!pin;
  const idleTimeout = parseInt(db.getConfig('touch_pin_idle_timeout') || '0', 10);
  const pinLength = pin ? pin.length : 4;
  res.json({ enabled, idleTimeout, pinLength });
});

/** Verify a PIN */
app.post('/api/touch-pin/verify', (req, res) => {
  const { pin } = req.body || {};
  const storedPin = db.getConfig('touch_pin');
  if (!storedPin || db.getConfig('touch_pin_enabled') !== '1') {
    return res.json({ ok: true }); // PIN not enabled, always pass
  }
  if (String(pin) === String(storedPin)) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Incorrect PIN' });
});

// ─── Touch Override API ──────────────────────────────────────────────────────

// Fire a server-side action from a touch UI (same engine as MIDI/Companion/OS2L).
// Touch clients never compute DMX themselves — this is the single entry point.
app.post('/api/touch/trigger', (req, res) => {
  const { action_type, action_data, mode, key } = req.body || {};
  if (!action_type) return res.status(400).json({ error: 'action_type required' });
  try {
    midiController.triggerAction(action_type, action_data || {}, { mode: mode || 'on', key });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/touch/state', (req, res) => {
  res.json({
    disabledFixtures: [...touchOverrides.disabledFixtures],
    blackoutHold: touchOverrides.blackoutHold,
    masterDimmer: touchOverrides.masterDimmer,
    effectSpeed: touchOverrides.effectSpeed,
    companionColorPushMode: touchOverrides.companionColorPushMode,
    groupDimmers: { ...touchOverrides.groupDimmers },
  });
});

app.post('/api/touch/fixture-disable', (req, res) => {
  const fixtureId = normalizeFixtureId(req.body.fixtureId);
  const { disabled } = req.body;
  // Drop legacy string/number duplicates
  touchOverrides.disabledFixtures.delete(req.body.fixtureId);
  if (disabled) {
    touchOverrides.disabledFixtures.add(fixtureId);
    clearFixtureOverrideTracking(fixtureId);
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
  _disabledDmxChannelCacheKey = '';
  broadcast({ type: 'touchFixtureDisable', fixtureId, disabled: !!disabled });
  console.log(`[TOUCH] Fixture ${fixtureId} ${disabled ? 'DISABLED' : 'ENABLED'}`);
  res.json({ ok: true, disabledFixtures: [...touchOverrides.disabledFixtures] });
});

app.post('/api/touch/blackout-hold', (req, res) => {
  const { active } = req.body;
  setBlackoutHold(!!active);
  res.json({ ok: true, blackoutHold: !!active });
});

app.post('/api/touch/master-dimmer', (req, res) => {
  const val = Math.max(0, Math.min(255, Math.round(+req.body.value || 0)));
  touchOverrides.masterDimmer = val;
  broadcast({ type: 'masterDimmer', value: val });
  res.json({ ok: true, masterDimmer: val });
});

app.post('/api/touch/group-dimmer', (req, res) => {
  const groupId = +req.body.groupId;
  if (!groupId) return res.status(400).json({ error: 'groupId required' });
  const val = Math.max(0, Math.min(255, Math.round(+req.body.value || 0)));
  touchOverrides.groupDimmers[groupId] = val;
  applyGroupDimmerLevelToDmx(groupId, val);
  broadcast({ type: 'groupDimmer', group_id: groupId, value: val });
  persistTouchGroupDimmers();
  res.json({ ok: true, groupId, value: val });
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
    const fid = normalizeFixtureId(id);
    if (isFixtureDisabled(fid)) continue;
    if (active) touchOverrides.colorOverrideFixtures.add(fid);
    else {
      touchOverrides.colorOverrideFixtures.delete(fid);
      touchOverrides.colorOverrideFixtures.delete(id);
    }
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

// Apply a saved mover preset server-side (touch UIs stay DMX-free)
app.post('/api/touch/mover-preset', (req, res) => {
  const preset = db.getMoverPreset(+req.body.presetId);
  if (!preset || !preset.positions) return res.status(404).json({ error: 'Preset not found' });
  const only = Array.isArray(req.body.fixtureIds) ? new Set(req.body.fixtureIds.map(normalizeFixtureId)) : null;

  const channelUpdates = {};
  const affectedIds = [];
  for (const pos of preset.positions) {
    const fix = getFixtureChannelMapByIdCached(normalizeFixtureId(pos.fixture_id));
    if (!fix || isFixtureDisabled(fix.id)) continue;
    if (only && !only.has(fix.id)) continue;
    affectedIds.push(fix.id);
    if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = [];
    for (const ch of fix.channels) {
      if (ch.type === 'pan' && pos.pan !== undefined) channelUpdates[fix.universe].push({ ch: ch.dmx_address, val: pos.pan });
      if (ch.type === 'tilt' && pos.tilt !== undefined) channelUpdates[fix.universe].push({ ch: ch.dmx_address, val: pos.tilt });
    }
    touchOverrides.movementOverrideFixtures.add(fix.id);
  }
  if (dmxOutputEnabled) {
    for (const [u, channels] of Object.entries(channelUpdates)) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }
  console.log(`[TOUCH] Mover preset "${preset.name}" applied to ${affectedIds.length} fixture(s)`);
  res.json({ ok: true, fixtureIds: affectedIds });
});

// Manual pan/tilt/speed for movers, computed server-side
app.post('/api/touch/mover-position', (req, res) => {
  const { fixtureIds, pan, tilt, speed } = req.body;
  if (!Array.isArray(fixtureIds) || !fixtureIds.length) return res.status(400).json({ error: 'fixtureIds required' });

  const channelUpdates = {};
  const affectedIds = [];
  for (const id of fixtureIds) {
    const fix = getFixtureChannelMapByIdCached(normalizeFixtureId(id));
    if (!fix || isFixtureDisabled(fix.id)) continue;
    affectedIds.push(fix.id);
    if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = [];
    for (const ch of fix.channels) {
      if (ch.type === 'pan' && pan !== undefined) channelUpdates[fix.universe].push({ ch: ch.dmx_address, val: Math.max(0, Math.min(255, Math.round(+pan))) });
      if (ch.type === 'tilt' && tilt !== undefined) channelUpdates[fix.universe].push({ ch: ch.dmx_address, val: Math.max(0, Math.min(255, Math.round(+tilt))) });
      if (ch.type === 'speed' && speed !== undefined) channelUpdates[fix.universe].push({ ch: ch.dmx_address, val: Math.max(0, Math.min(255, Math.round(+speed))) });
    }
    touchOverrides.movementOverrideFixtures.add(fix.id);
  }
  if (dmxOutputEnabled) {
    for (const [u, channels] of Object.entries(channelUpdates)) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }
  res.json({ ok: true, fixtureIds: affectedIds });
});

app.post('/api/touch/smoke-override', (req, res) => {
  const { fixtureIds, active } = req.body;
  if (!Array.isArray(fixtureIds)) return res.status(400).json({ error: 'fixtureIds required' });
  for (const id of fixtureIds) {
    if (active) touchOverrides.smokeOverrideFixtures.add(id);
    else touchOverrides.smokeOverrideFixtures.delete(id);
  }
  console.log(`[TOUCH] Smoke override ${active ? 'ON' : 'OFF'} for ${fixtureIds.length} fixtures (total active: ${touchOverrides.smokeOverrideFixtures.size})`);
  res.json({ ok: true });
});

app.post('/api/touch/atmosphere-override', (req, res) => {
  const { fixtureIds, active } = req.body;
  if (!Array.isArray(fixtureIds)) return res.status(400).json({ error: 'fixtureIds required' });
  for (const id of fixtureIds) {
    if (active) touchOverrides.atmosphereOverrideFixtures.add(id);
    else touchOverrides.atmosphereOverrideFixtures.delete(id);
  }
  console.log(`[TOUCH] Atmosphere override ${active ? 'ON' : 'OFF'} for ${fixtureIds.length} fixtures (total active: ${touchOverrides.atmosphereOverrideFixtures.size})`);
  res.json({ ok: true });
});

// ─── OS2L Button Maps API (delegated to os2l module) ────────────────────────

os2l.registerRoutes(app);

// ─── MIDI Controller API (delegated to midi-controller module) ──────────────

midiController.registerRoutes(app);

// ─── Companion (Stream Deck) API ────────────────────────────────────────────

const companionRoutes = require('./companion-routes');
companionRoutes.init({ db, midiController, touchOverrides, broadcast });
companionRoutes.registerRoutes(app);

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
    console.log(`[VDJ] Imported ${result.total} tracks from ${xmlPath} (+${result.inserted} new, ~${result.updated} updated, ${result.pathUpdated || 0} paths updated, ${result.duplicatesRemoved || 0} stale duplicates removed)`);
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
  // Parse JSON fields for the sequencer timeline (beats drive the grid; energy_levels stay server-side)
  analysis.waveform_peaks = JSON.parse(analysis.waveform_peaks || '[]');
  analysis.sections = JSON.parse(analysis.sections || '[]');
  analysis.beats = JSON.parse(analysis.beats || '[]');
  delete analysis.energy_levels;
  res.json(analysis);
});

// Build analysis config from persisted app settings (always returns full object)
function getAnalysisConfig() {
  return {
    TARGET_PEAKS: parseInt(db.getConfig('analysis_target_peaks') || '2000', 10),
    DECODE_SAMPLE_RATE: parseInt(db.getConfig('analysis_sample_rate') || '22050', 10),
    SECTION_SENSITIVITY: parseFloat(db.getConfig('analysis_section_sensitivity') || '1.2'),
    NORMALIZE_PERCENTILE: parseInt(db.getConfig('analysis_normalize_pct') || '99', 10),
  };
}

/**
 * Parse multi-point beatgrid anchors from a track's poi_json.
 * Returns [{pos_ms, bpm?}, ...] for fluid beatgrid support.
 */
function getAnchorPoints(track) {
  try {
    const pois = JSON.parse(track.poi_json || '[]');
    return pois
      .filter(p => p.type === 'beatgrid' && p.pos)
      .map(p => ({
        pos_ms: parseFloat(p.pos) * 1000,
        bpm: p.bpm > 0 ? parseFloat(p.bpm) : undefined,
      }))
      .filter(p => !isNaN(p.pos_ms))
      .sort((a, b) => a.pos_ms - b.pos_ms);
  } catch { return []; }
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
    const analysisCfg = getAnalysisConfig();
    console.log(`[Analysis] Starting track ${trackId}: ${track.title || track.filename}`, analysisCfg);
    const result = await audioAnalyzer.analyzeTrack(filePath, {
      bpm: track.bpm || 0,
      beatgridPos: track.beatgrid_pos || 0,
      anchorPoints: getAnchorPoints(track),
      config: analysisCfg,
    });
    const saved = db.upsertTrackAnalysis(trackId, result);
    console.log(`[Analysis] Completed track ${trackId}: ${result.peak_count} peaks, ${(result.sections || []).length} sections, config=`, analysisCfg);

    // Notify WebSocket clients
    broadcast({
      type: 'analysis_complete',
      track_id: trackId,
      peak_count: result.peak_count,
      section_count: (result.sections || []).length,
      analyzed_at: saved?.analyzed_at || null,
    });
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
        anchorPoints: getAnchorPoints(item.track),
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

// ─── Stem Separation API ────────────────────────────────────────────────────

// Check stem separation availability (demucs + ffmpeg spectral fallback)
app.get('/api/stems/status', async (req, res) => {
  const demucsInfo = await stemSeparator.checkDemucs();
  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
  res.json({
    demucs: demucsInfo,
    spectral_fallback: ffmpegOk,
    available: demucsInfo.available || ffmpegOk,
  });
});

// Get stem data for a track
app.get('/api/tracks/:id/stems', (req, res) => {
  const analysis = db.getTrackAnalysis(+req.params.id);
  if (!analysis) return res.status(404).json({ error: 'No analysis found' });
  if (!analysis.stem_energy) return res.status(404).json({ error: 'No stem data available' });
  try {
    const stemData = JSON.parse(analysis.stem_energy);
    res.json(stemData);
  } catch (e) {
    res.status(500).json({ error: 'Invalid stem data' });
  }
});

// Trigger stem separation for a track
const stemInProgress = new Map(); // trackId -> true

app.post('/api/tracks/:id/separate-stems', async (req, res) => {
  const trackId = +req.params.id;
  const track = db.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Must have existing analysis first
  const analysis = db.getTrackAnalysis(trackId);
  if (!analysis) {
    return res.status(400).json({ error: 'Track must be analyzed before stem separation' });
  }

  if (stemInProgress.has(trackId)) {
    return res.status(409).json({ error: 'Stem separation already in progress for this track' });
  }

  const filePath = track.filepath;
  if (!filePath || !require('fs').existsSync(filePath)) {
    return res.status(400).json({ error: 'Audio file not found on disk', filepath: filePath });
  }

  stemInProgress.set(trackId, true);
  res.json({ status: 'started', track_id: trackId });

  try {
    const method = req.body?.method || 'auto';
    console.log(`[Stems] Starting stem separation for track ${trackId}: ${track.title || track.filename} (method: ${method})`);

    const result = await stemSeparator.separateStems(filePath, {
      method,
      onProgress: (pct) => {
        broadcast({ type: 'stem_progress', track_id: trackId, progress: pct });
      },
    });

    // Compute summary and store
    const summary = stemSeparator.computeStemSummary(result.stems);
    const stemData = {
      method: result.method,
      summary,
      // Store full energy timeseries only for stems that have data
      energy: {},
    };
    for (const [name, segments] of Object.entries(result.stems)) {
      if (segments && segments.length > 0) {
        stemData.energy[name] = segments;
      }
    }

    db.updateStemEnergy(trackId, stemData);
    console.log(`[Stems] Completed track ${trackId} via ${result.method}: ${Object.keys(stemData.energy).join(', ')}`);

    broadcast({ type: 'stem_complete', track_id: trackId, method: result.method, summary });
  } catch (e) {
    console.error(`[Stems] Error for track ${trackId}: ${e.message}`);
    broadcast({ type: 'stem_error', track_id: trackId, error: e.message });
  } finally {
    stemInProgress.delete(trackId);
  }
});

// Delete stem data for a track (keeps analysis)
app.delete('/api/tracks/:id/stems', (req, res) => {
  const analysis = db.getTrackAnalysis(+req.params.id);
  if (!analysis) return res.status(404).json({ error: 'No analysis found' });
  db.updateStemEnergy(+req.params.id, null);
  res.json({ deleted: true });
});

// ─── Effects API ────────────────────────────────────────────────────────────

app.get('/api/effects', (req, res) => {
  res.json(db.getEffects());
});

// Literal paths MUST come before /api/effects/:id (otherwise "status" is parsed as an id)
app.get('/api/effects/status', (req, res) => {
  const slots = {};
  for (const [s, st] of Object.entries(runningQaEffects)) {
    const eff = st.effectId ? db.getEffect(st.effectId) : null;
    slots[s] = eff
      ? {
          effectId: st.effectId,
          name: eff.name,
          type: eff.type,
          effectParams: st.effectParams && typeof st.effectParams === 'object' ? { ...st.effectParams } : {},
        }
      : null;
  }
  res.json({ slots });
});

app.get('/api/effects/:id', (req, res) => {
  const e = db.getEffect(+req.params.id);
  e ? res.json(e) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/effects', (req, res) => {
  const result = db.createEffect(req.body);
  if (result.error) return res.status(400).json(result);
  invalidateEffectCache();
  res.status(201).json(result);
});

app.put('/api/effects/:id', (req, res) => {
  const result = db.updateEffect(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  invalidateEffectCache();
  res.json(result);
});

app.delete('/api/effects/:id', (req, res) => {
  db.deleteEffect(+req.params.id);
  invalidateEffectCache();
  res.json({ deleted: true });
});

// ─── Sound-Reactive Audio Data Provider ─────────────────────────────────────
// Reads energy levels from the currently-playing track's analysis data.
// Cached in memory so the 40fps render loop doesn't hit the DB every frame.

let _audioEnergyCache = { trackId: null, levels: null, beats: null };
let _lastAudioData = { bass: 0, mid: 0, treble: 0, energy: 0, sub_bass: 0, upper_mid: 0, beat: 0 };
let _lastBeatTime = 0;

function loadAudioEnergyCache(trackId) {
  if (_audioEnergyCache.trackId === trackId) return;
  try {
    const analysis = db.getTrackAnalysis(trackId);
    if (analysis && analysis.energy_levels) {
      _audioEnergyCache = {
        trackId,
        levels: typeof analysis.energy_levels === 'string' ? JSON.parse(analysis.energy_levels) : analysis.energy_levels,
        beats: analysis.beats ? (typeof analysis.beats === 'string' ? JSON.parse(analysis.beats) : analysis.beats) : [],
      };
    } else {
      _audioEnergyCache = { trackId, levels: null, beats: null };
    }
  } catch {
    _audioEnergyCache = { trackId, levels: null, beats: null };
  }
}

function sampleEnergyLevelsAtTime(levels, timeMs) {
  if (!levels?.length) return null;
  let lo = 0, hi = levels.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((levels[mid].time_ms || mid * 50) < timeMs) lo = mid + 1;
    else hi = mid;
  }
  return levels[lo] || null;
}

function getCurrentAudioData() {
  // Live audio input takes priority when it is running.
  // Use the heavily-smoothed DMX levels to avoid flickering lights.
  if (audioInput.capture.running) {
    return audioInput.capture.getDmxLevels();
  }

  // Find the playing deck with highest crossfader weight
  let bestDeck = null, bestLevel = 0;
  for (let d = 1; d <= 4; d++) {
    const ds = state.decks[d];
    if (!ds || !ds.play) continue;
    const cf = parseFloat(state.crossfader) || 0;
    const level = (d === 1) ? (1 - cf) : (d === 2) ? cf : 0.5;
    if (level > bestLevel) { bestLevel = level; bestDeck = d; }
  }
  if (!bestDeck) return _lastAudioData;

  const ds = state.decks[bestDeck];
  const trackId = ds.track_id;
  if (!trackId) return _lastAudioData;

  loadAudioEnergyCache(trackId);

  if (!_audioEnergyCache.levels || _audioEnergyCache.levels.length === 0) return _lastAudioData;

  const timeMs = ds.time || 0;
  const levels = _audioEnergyCache.levels;

  const sample = sampleEnergyLevelsAtTime(levels, timeMs) || {};

  // Beat detection: check if we're near a beat
  let beat = 0;
  if (_audioEnergyCache.beats && _audioEnergyCache.beats.length > 0) {
    const beats = _audioEnergyCache.beats;
    let nearest = Infinity;
    for (const b of beats) {
      const beatMs = typeof b === 'number' ? b : (b && b.time_ms) || 0;
      const dist = Math.abs(timeMs - beatMs);
      if (dist < nearest) nearest = dist;
      if (beatMs > timeMs + 100) break;
    }
    if (nearest < 100) beat = Math.max(0, 1 - nearest / 100);
  }

  _lastAudioData = {
    bass: sample.bass || 0,
    mid: sample.mid || 0,
    treble: sample.treble || 0,
    energy: sample.energy || 0,
    sub_bass: sample.sub_bass || 0,
    upper_mid: sample.upper_mid || 0,
    beat,
  };
  return _lastAudioData;
}

// ─── Quick Action Effects Runner ────────────────────────────────────────────
// Supports concurrent effects in different categories (color, motion, multicell, rig, sound).
// Each category slot can run one effect at a time; starting a new effect in the
// same category replaces the previous one without affecting other categories.

const runningQaEffects = {}; // { color: { timer, effectId, fixtureIds }, motion: ..., multicell: ..., rig: ..., sound: ... }

/**
 * Determine which slot category an effect belongs to.
 */
function getEffectSlot(effectType) {
  if (MOVING_HEAD_EFFECT_TYPES.has(effectType)) return 'motion';
  if (MULTICELL_EFFECT_TYPES.has(effectType)) return 'multicell';
  if (RIG_EFFECT_TYPES.has(effectType)) return 'rig';
  if (SOUND_EFFECT_TYPES.has(effectType)) return 'sound';
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

    if (running.timer) clearInterval(running.timer);

    if (!skipBlackout) {
      const fixMap = getFixtureChannelMapCached();
      const channelUpdates = {};
      for (const fixtureId of running.fixtureIds) {
        const fix = getFixtureChannelMapByIdCached(fixtureId);
        if (!fix) continue;
        for (const ch of fix.channels) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          if (s === 'motion') {
            // Motion slot: reset pan/tilt to home, and zero colour/intensity — the effect loop
            // forces dimmer on every tick so the beam is visible; without cleanup the head stays hot (often full white).
            if (ch.type === 'pan') channelUpdates[fix.universe][ch.dmx_address] = fix.home_pan ?? 128;
            else if (ch.type === 'tilt') channelUpdates[fix.universe][ch.dmx_address] = fix.home_tilt ?? 128;
            else if (COLOR_CHANNELS.has(ch.type)) {
              channelUpdates[fix.universe][ch.dmx_address] = 0;
            }
          } else {
            // Color/multicell/rig/sound slot: zero out color & dimmer channels
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

app.post('/api/effects/params', (req, res) => {
  const { slot, effect_params } = req.body || {};
  if (!slot || !runningQaEffects[slot]) {
    return res.status(400).json({ error: 'No effect running in that slot' });
  }
  const cur = runningQaEffects[slot].effectParams;
  const next = { ...(cur && typeof cur === 'object' ? cur : {}), ...(effect_params && typeof effect_params === 'object' ? effect_params : {}) };
  if (next.color_mode === 'hsl') delete next.color_palette;
  runningQaEffects[slot].effectParams = next;
  res.json({ ok: true, effectParams: runningQaEffects[slot].effectParams });
});

app.post('/api/effects/run', (req, res) => {
  const { effectId, fixtureIds, effect_params } = req.body;

  const effect = db.getEffect(effectId);
  if (!effect) return res.status(404).json({ error: 'Effect not found' });
  if (!fixtureIds || fixtureIds.length === 0) return res.status(400).json({ error: 'No fixtures specified' });

  const slot = getEffectSlot(effect.type);
  // Only stop the same slot — other categories keep running
  stopRunningEffect(slot, true); // skip blackout for seamless switching

  const startTime = Date.now();
  const allFixtures = getFixtureChannelMapCached();
  const userParams = effect_params && typeof effect_params === 'object' ? { ...effect_params } : {};
  if (userParams.color_mode === 'hsl') delete userParams.color_palette;

  const timer = setInterval(() => {
    if (!dmxOutputEnabled) return;
    if (touchOverrides.blackoutHold || touchOverrides.fullOnHold) return;
    const st = runningQaEffects[slot];
    if (!st) return;
    const eff = db.getEffect(st.effectId);
    if (!eff) return;

    const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;
    const channelUpdates = {};
    const live = st.effectParams && typeof st.effectParams === 'object' ? { ...st.effectParams } : {};
    const effectParams = SOUND_EFFECT_TYPES.has(eff.type)
      ? { ...live, audio: getCurrentAudioData() }
      : { ...live };

    for (let fi = 0; fi < st.fixtureIds.length; fi++) {
      const fixtureId = st.fixtureIds[fi];
      const fix = getFixtureChannelMapByIdCached(fixtureId);
      if (!fix) continue;
      if (!isFixtureCompatibleWithEffect(eff, fix)) continue;

      for (const ch of fix.channels) {
        let progress;
        if (eff.type === 'color_fade') {
          progress = (elapsed % 4) / 4;
        } else {
          progress = elapsed;
        }

        const baseValues = { red: 255, green: 255, blue: 255, white: 255, dimmer: 255 };
        const channelCtx = buildChannelCtx(ch, fix);
        channelCtx._fixtureOrdinal = fi;
        channelCtx._fixtureCount = st.fixtureIds.length;
        channelCtx._rigFixtureCount = allFixtures.length;
        let value = computeEffectValue(eff, ch.type, progress, baseValues, effectParams, channelCtx);

        if (value !== null && value !== undefined) {
          if (!channelUpdates[fix.universe]) channelUpdates[fix.universe] = {};
          let finalVal = Math.max(0, Math.min(255, Math.round(value)));
          finalVal = applyTouchDimmerChain(finalVal, fix, ch.type);
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
  }, 10);

  runningQaEffects[slot] = { timer, effectId, fixtureIds, effectParams: userParams };
  console.log(`[QA] Started ${slot} effect "${effect.name}" (type=${effect.type}) on ${fixtureIds.length} fixture(s): [${fixtureIds.join(',')}]`);
  const activeSlots = Object.keys(runningQaEffects);
  if (activeSlots.length > 1) console.log(`[QA]   Concurrent slots active: ${activeSlots.join(', ')}`);
  res.json({ ok: true, slot });
});

app.post('/api/effects/stop', (req, res) => {
  const QA_SLOT_KEYS = new Set(['color', 'motion', 'multicell', 'rig', 'sound']);
  let { slot } = req.body || {};
  if (slot == null || slot === '' || slot === 'all') {
    slot = undefined;
  } else {
    const s = String(slot);
    if (!QA_SLOT_KEYS.has(s)) {
      console.warn(`[QA] /api/effects/stop: invalid slot "${s}", stopping all instead`);
      slot = undefined;
    } else {
      slot = s;
    }
  }
  const slotsActive = Object.keys(runningQaEffects);
  if (slotsActive.length > 0) {
    console.log(`[QA] Stopping ${slot || 'all'} effect(s) (active: ${slotsActive.join(', ')})`);
  }
  stopRunningEffect(slot);
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

const TOUCH3_FAV_KEY = 'touch3_favorites';

app.get('/api/touch3/favorites', (req, res) => {
  try {
    const raw = db.getConfig(TOUCH3_FAV_KEY);
    const list = raw ? JSON.parse(raw) : [];
    res.json(Array.isArray(list) ? list : []);
  } catch {
    res.json([]);
  }
});

app.put('/api/touch3/favorites', (req, res) => {
  const list = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Expected array' });
  db.setConfig(TOUCH3_FAV_KEY, JSON.stringify(list));
  res.json({ ok: true, count: list.length });
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
    { label:'Full White', icon:'\u2600\uFE0F',  action:'fullWhite', color:'#ffffff', text:'#000000' },
    { label:'Full Color', icon:'\uD83C\uDF08',  action:'fullColor', color:'#7c4dff', text:'#ffffff' },
    { label:'Dim Warm',   icon:'\uD83D\uDD6F\uFE0F', action:'dimWarm',   color:'#b47832', text:'#ffffff' },
    { label:'UV Mode',    icon:'\uD83D\uDD2E',  action:'uvMode',    color:'#7b2ff2', text:'#ffffff' },
    { label:'All Off',    icon:'\u26D4',        action:'allOff',    color:'#333333', text:'#ffffff' },
  ];

  const EFFECTS = [
    { label:'Strobe',   icon:'\u26A1', type:'strobe',   color:'#ffcc00', text:'#000000' },
    { label:'Smoke',    icon:'\u2601\uFE0F', type:'smoke',    color:'#556677', text:'#ffffff' },
    { label:'Haze',     icon:'\u2601\uFE0F', type:'haze',     color:'#445566', text:'#ffffff' },
    { label:'Blackout', icon:'\u26AB',       type:'blackout', color:'#cc0000', text:'#ffffff' },
  ];

  const DIMMERS = [
    { label:'Full',  value:255, color:'#ffffff', text:'#000000' },
    { label:'75%',   value:191, color:'#aaaaaa', text:'#000000' },
    { label:'50%',   value:128, color:'#777777', text:'#ffffff' },
    { label:'25%',   value:64,  color:'#444444', text:'#ffffff' },
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

    // Master dimmer presets
    startNewRow();
    for (const d of DIMMERS) {
      const pos = nextPos();
      created.push(db.createTouchAction({
        label: d.label, icon: '\uD83C\uDF1F', action_type: 'master_dimmer',
        action_data: { value: d.value },
        color: d.color, text_color: d.text,
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

// ─── Sequences API (extracted to sequence-routes.js) ────────────────────────
const sequenceGenerator = require('./sequence-generator');
const sequenceRoutes = require('./sequence-routes');
sequenceRoutes.init({ db, audioAnalyzer, sequenceGenerator, broadcast, getAnalysisConfig, getAnchorPoints });
app.use(sequenceRoutes.router);

// ─── Satellite Hub API ───────────────────────────────────────────────────────
const hubRoutes = require('./hub-routes');
app.use('/api/hub', hubRoutes.router);

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
      if (touchOverrides.blackoutHold || touchOverrides.fullOnHold) return;
      processSceneEffects(activeStaticScene, startTime);
    }, 10); // ~100 Hz
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
  const fixMap = getFixtureChannelMapCached();
  const channelUpdates = {};

  for (const entry of scene.entries) {
    if (entry.effect_id) continue; // effects are handled in the tick loop
    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (const fid of fixtureIds) {
      if (touchOverrides.disabledFixtures.has(fid)) continue;
      const fix = getFixtureChannelMapByIdCached(fid);
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
  const fixMap = getFixtureChannelMapCached();
  const channelUpdates = {};
  const elapsed = ((Date.now() - startTime) / 1000) * touchOverrides.effectSpeed;

  for (const entry of scene.entries) {
    if (!entry.effect_id) continue;
    const effect = getEffectCached(entry.effect_id);
    if (!effect) continue;

    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (let fi = 0; fi < fixtureIds.length; fi++) {
      const fid = fixtureIds[fi];
      if (touchOverrides.disabledFixtures.has(fid)) continue;
      const fix = getFixtureChannelMapByIdCached(fid);
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
        channelCtx._rigFixtureCount = fixMap.length;
        const seqEffectParams = entry.effect_params || {};
        if (SOUND_EFFECT_TYPES.has(effect.type) && !seqEffectParams.audio) seqEffectParams.audio = getCurrentAudioData();
        let value = computeEffectValue(effect, ch.type, progress, baseValues, seqEffectParams, channelCtx);

        if (value === null || value === undefined) {
          if (isAuxiliaryMulticellChannel(ch, fix)) {
            value = null;
          } else {
            value = baseValues[ch.type] !== undefined ? baseValues[ch.type] : null;
          }
        }

        if (value !== null && value !== undefined) {
          const u = fix.universe;
          if (!channelUpdates[u]) channelUpdates[u] = {};
          let finalVal = Math.max(0, Math.min(255, Math.round(value)));
          finalVal = applyTouchDimmerChain(finalVal, fix, ch.type);
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
  for (const ch of fix.channels) {
    const val = channelValues[ch.type];
    if (val !== undefined && val !== null) {
      const u = fix.universe;
      if (!channelUpdates[u]) channelUpdates[u] = {};
      let mapped = mapValueToRange(Math.max(0, Math.min(255, Math.round(val))), ch, ch.type);
      mapped = applyTouchDimmerChain(mapped, fix, ch.type);
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
  const fixMap = getFixtureChannelMapCached();
  const channelUpdates = {};

  for (const entry of scene.entries) {
    const fixtureIds = resolveEntryFixtures(entry, fixMap);
    for (const fid of fixtureIds) {
      const fix = getFixtureChannelMapByIdCached(fid);
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
  const moverFixtures = fixtures.filter(f =>
    f.category === 'moving_head' || f.category === 'moving_head_wash' || f.category === 'moving_head_spot'
  );
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
let _cachedMixerConfig = { crossfaderGating: false, crossfaderMode: 'gate', deckFaderDimmer: false, endAction: 'none', seqNoStrobes: false };
function refreshMixerConfig() {
  _cachedMixerConfig.crossfaderGating = db.getConfig('seq_crossfader_gating') === '1';
  _cachedMixerConfig.crossfaderMode = db.getConfig('seq_crossfader_mode') || 'gate'; // gate | blend | off
  _cachedMixerConfig.deckFaderDimmer = db.getConfig('seq_deck_fader_dimmer') === '1';
  _cachedMixerConfig.endAction = db.getConfig('seq_end_action') || 'none'; // none | blackout | scene
  _cachedMixerConfig.seqNoStrobes = db.getConfig('seq_no_strobes') === '1';
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

  const TICK_MS = 10; // ~100 Hz for DMX processing (audio-reactive needs fast updates)
  let _lastSeqTimeBroadcast = 0;
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

    // Broadcast playhead position to frontend (throttled to ~15Hz to reduce WS traffic)
    const now = Date.now();
    if (now - _lastSeqTimeBroadcast >= 66) {
      _lastSeqTimeBroadcast = now;
      broadcast({ type: 'seq_time', deck, timeMs: ds.currentTimeMs });
    }
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
 * Pause all active sequences across all decks.
 * Stops playback timers, blacks out fixtures, and broadcasts state.
 * Used by MIDI stop_all_effects to ensure the sequencer doesn't
 * immediately resume writing DMX values after overrides are cleared.
 */
function pauseAllSequences() {
  for (const deck of Object.keys(activeSequences)) {
    const ds = activeSequences[deck];
    if (ds && ds.playing) {
      ds.playing = false;
      stopPlaybackTimer(deck);
      blackoutDeckFixtures(deck);
      broadcast({ type: 'seq_playing', deck: +deck, playing: false });
      console.log(`[SEQ] Paused deck ${deck} (stop_all_effects)`);
    }
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
  const allFixtures = getFixtureChannelMapCached();
  const channelUpdates = {};

  for (const fid of fixtureIds) {
    const fixMap = _cachedFixtureChannelMapById ? _cachedFixtureChannelMapById.get(fid) : allFixtures.find(f => f.id === fid);
    if (!fixMap) continue;
    const u = fixMap.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    for (const ch of fixMap.channels) {
      // Send pan/tilt to home position, everything else to 0
      let resetVal = 0;
      if (ch.type === 'pan') resetVal = fixMap.home_pan ?? 128;
      else if (ch.type === 'tilt') resetVal = fixMap.home_tilt ?? 128;
      channelUpdates[u][ch.dmx_address] = resetVal;
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
      seq.cues = db.getSequenceCues(sequenceId);
      // Clear any OS2L button overrides so the sequence controls all fixtures
      touchOverrides.os2lOverrideFixtures.clear();
      clearSequenceColorOverride();
      clearSequenceBlockingOverrides();
      deactivateScene(); // Stop any scene effect loop from end-action
      stopPlaybackTimer(deck);
      blackoutDeckFixtures(deck); // Zero all old fixture channels before swapping sequence
      activeSequences[deck] = { sequence: seq, cuesByStart: sortCuesByStart(seq.cues), lastTimeMs: -1, playing: false, currentTimeMs: 0, vdjDriven: false };
      broadcast({ type: 'seq_loaded', deck, sequence: sequenceForClient(seq) });
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
        clearSequenceBlockingOverrides();
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
        // Use preview flag when sequence is loaded in preview mode or paused
        const usePreview = activeSequences[deck].previewMode || !activeSequences[deck].playing;
        processSequenceAtTime(deck, seekMs, usePreview ? { preview: true } : {});
        broadcast({ type: 'seq_time', deck, timeMs: seekMs });
      }
      break;
    }

    // ── Edit Mode: Preview ──────────────────────────────────────────────
    // Load a sequence for preview without auto-playing.
    // Enables processSequenceAtTime with { preview: true }.
    case 'preview_load': {
      const seq = db.getSequence(sequenceId);
      if (!seq) return ws.send(JSON.stringify({ type: 'seq_error', error: 'Sequence not found' }));
      seq.cues = db.getSequenceCues(sequenceId);
      stopPlaybackTimer(deck);
      blackoutDeckFixtures(deck);
      activeSequences[deck] = {
        sequence: seq, cuesByStart: sortCuesByStart(seq.cues), lastTimeMs: -1, playing: false,
        currentTimeMs: 0, vdjDriven: false, previewMode: true,
      };
      broadcast({ type: 'seq_loaded', deck, sequence: sequenceForClient(seq) });
      console.log(`[SEQ] Preview-loaded sequence "${seq.name}" on deck ${deck}`);
      break;
    }

    // Seek in preview mode: processes cues at timeMs even though not playing.
    case 'preview_seek': {
      const seekMs = Math.max(0, msg.timeMs || 0);
      if (activeSequences[deck]) {
        activeSequences[deck].currentTimeMs = seekMs;
        processSequenceAtTime(deck, seekMs, { preview: true });
        broadcast({ type: 'seq_time', deck, timeMs: seekMs });
      }
      break;
    }

    // Hot-reload cues from DB and re-process at current position.
    // Called after a cue is edited so the output updates immediately.
    case 'preview_refresh': {
      if (activeSequences[deck] && activeSequences[deck].sequence) {
        const seqId = activeSequences[deck].sequence.id;
        activeSequences[deck].sequence.cues = db.getSequenceCues(seqId);
        activeSequences[deck].cuesByStart = sortCuesByStart(activeSequences[deck].sequence.cues);
        const t = msg.timeMs != null ? msg.timeMs : activeSequences[deck].currentTimeMs;
        activeSequences[deck].currentTimeMs = t;
        processSequenceAtTime(deck, t, { preview: true });
      }
      break;
    }

    // Live channel override: send channel values directly to DMX without saving to DB.
    // Used for real-time slider preview in the edit UI.
    case 'preview_channel': {
      if (!dmxOutputEnabled) break;
      const fixtureId = msg.fixture_id;
      const vals = msg.channel_values; // { red: 255, green: 0, ... }
      if (!fixtureId || !vals) break;
      const fixMap = getFixtureChannelMapByIdCached(fixtureId);
      if (!fixMap) break;
      for (const ch of fixMap.channels) {
        if (!shouldApplyCellCue(msg.cell, ch)) continue;
        if (vals[ch.type] === undefined) continue;
        let v = Math.round(Math.max(0, Math.min(255, vals[ch.type])));
        v = mapValueToRange(v, ch, ch.type === 'dimmer' ? 'dimmer' : ch.type);
        v = applyInvert(v, ch);
        v = applyMasterDimmer(v, ch.type);
        const uni = ch.universe || 1;
        if (!dmxUniverses[uni]) dmxUniverses[uni] = Buffer.alloc(512, 0);
        dmxUniverses[uni][ch.address - 1] = v;
      }
      sendDMX();
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

/** Product of (groupDimmers[gid] ?? 255) / 255 for each group the fixture belongs to. */
function getGroupDimmerScale(fixMap) {
  const gids = fixMap.group_ids || [];
  if (gids.length === 0) return 1;
  const gd = touchOverrides.groupDimmers;
  let scale = 1;
  for (const gid of gids) {
    const v = gd[gid] != null ? gd[gid] : 255;
    scale *= Math.max(0, Math.min(255, v)) / 255;
  }
  return scale;
}

/** Submaster: scale logical dimmer before master dimmer (sequence + MIDI group faders). */
function applyGroupDimmerToDimmerValue(value, fixMap) {
  const s = getGroupDimmerScale(fixMap);
  return Math.max(0, Math.min(255, Math.round(value * s)));
}

/** Group submaster + master dimmer for live effects (touch QA, scenes, MIDI/OS2L). */
function applyTouchDimmerChain(value, fixMap, channelType) {
  const fixHasDimmer = fixMap.channels.some(c => c.type === 'dimmer');
  if (fixHasDimmer) {
    if (channelType === 'dimmer') {
      value = applyGroupDimmerToDimmerValue(value, fixMap);
      return applyMasterDimmer(value, channelType);
    }
    return value;
  }
  value = applyGroupDimmerToDimmerValue(value, fixMap);
  return applyMasterDimmer(value, channelType);
}

/**
 * Called on each time update to drive the sequence engine.
 * Finds active cues at the current position and sends DMX values.
 * @param {number} deckNum - Deck number
 * @param {number} timeMs - Current playback position in milliseconds
 */
/**
 * Interpolate a position along an ordered array of {x,y,z} waypoints.
 * t = 0 → first waypoint, t = 1 → last waypoint.
 * Uses arc-length parameterisation so cells are evenly spaced physically.
 */
function interpolateAlongPath(waypoints, t) {
  if (!waypoints || waypoints.length === 0) return null;
  if (waypoints.length === 1) return waypoints[0];
  // Accumulate segment lengths
  const lens = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i-1].x;
    const dy = waypoints[i].y - waypoints[i-1].y;
    const dz = (waypoints[i].z || 0) - (waypoints[i-1].z || 0);
    lens.push(lens[i-1] + Math.sqrt(dx*dx + dy*dy + dz*dz));
  }
  const total = lens[lens.length - 1];
  if (total === 0) return waypoints[0];
  const target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < waypoints.length; i++) {
    if (target <= lens[i]) {
      const frac = (target - lens[i-1]) / (lens[i] - lens[i-1]);
      const a = waypoints[i-1], b = waypoints[i];
      return {
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
        z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * frac,
      };
    }
  }
  return waypoints[waypoints.length - 1];
}

/**
 * Build a channel context object for effect computation.
 * Includes explicit cell metadata when available so effects can
 * correctly resolve cell index and count rather than guessing via stride.
 */
function buildChannelCtx(ch, fix) {
  const ctx = {
    channel_number: ch.channel_number,
    channel_type: ch.type,
    total_channels: fix.channels.length,
    home_pan: fix.home_pan ?? 128,
    home_tilt: fix.home_tilt ?? 128,
    // Rig position data for rig-wide effects (fixture-level defaults)
    _rigPosition:  fix.rig_x ?? 0.5,
    _rigPositionY: fix.rig_y ?? 0.5,   // depth: 0=front/audience, 1=back/stage
    _rigPositionZ: fix.rig_z ?? 0.5,   // height: 0=top, 1=floor
    _rigOrder: fix.rig_order ?? 0,
  };
  if (fix.cell_count > 0) {
    ctx.cell_count = fix.cell_count;
    ctx.cell_rows = fix.cell_rows || 1;
    ctx.cell_cols = fix.cell_cols || fix.cell_count;
    ctx.cell = ch.cell || null;
    ctx.channel_name = ch.name || '';
    // Compute index of this channel within its cell (0-based)
    if (ch.cell) {
      const cellChannels = fix.channels.filter(c => c.cell === ch.cell);
      ctx.cell_channel_index = cellChannels.indexOf(ch);
      if (ctx.cell_channel_index === -1) {
        ctx.cell_channel_index = cellChannels.findIndex(c => c.channel_number === ch.channel_number);
      }

      // If this fixture has a cell_path, derive each cell's real-world position
      // from its location along the path.  The first waypoint is the fixture's
      // rig_x/y/z; additional waypoints in cell_path define the strip's route.
      if (fix.cell_path && fix.cell_path.length > 0) {
        const startPt  = { x: fix.rig_x ?? 0.5, y: fix.rig_y ?? 0.5, z: fix.rig_z ?? 0.5 };
        const waypoints = [startPt, ...fix.cell_path];
        const cellIdx = ch.cell - 1; // ch.cell is 1-based
        const t = fix.cell_count > 1 ? cellIdx / (fix.cell_count - 1) : 0;
        const pos = interpolateAlongPath(waypoints, t);
        if (pos) {
          ctx._rigPosition  = pos.x;
          ctx._rigPositionY = pos.y;
          ctx._rigPositionZ = pos.z;
        }
      }
    }
  }
  return ctx;
}

// Cached fixture channel map for hot-path processing (refreshed on fixture/group changes)
let _cachedFixtureChannelMap = null;
let _cachedFixtureChannelMapById = null;
function getFixtureChannelMapCached() {
  if (!_cachedFixtureChannelMap) {
    _cachedFixtureChannelMap = db.getFixtureChannelMap();
    _cachedFixtureChannelMapById = new Map();
    for (const f of _cachedFixtureChannelMap) _cachedFixtureChannelMapById.set(f.id, f);
  }
  return _cachedFixtureChannelMap;
}
function getFixtureChannelMapByIdCached(id) {
  if (!_cachedFixtureChannelMapById) getFixtureChannelMapCached();
  return _cachedFixtureChannelMapById.get(id) || null;
}
function invalidateFixtureChannelMapCache() {
  _cachedFixtureChannelMap = null;
  _cachedFixtureChannelMapById = null;
  _disabledDmxChannelCacheKey = '';
  _disabledDmxChannelSet = null;
}

// Cached effects for hot-path processing (refreshed on effect changes)
const _effectCache = new Map();
function getEffectCached(id) {
  if (_effectCache.has(id)) return _effectCache.get(id);
  const e = db.getEffect(id);
  _effectCache.set(id, e);
  return e;
}
function invalidateEffectCache() { _effectCache.clear(); }

// Cached mover presets for hot-path processing (refreshed on preset changes)
const _moverPresetCache = new Map();
function getMoverPresetCached(id) {
  if (_moverPresetCache.has(id)) return _moverPresetCache.get(id);
  const p = db.getMoverPreset(id);
  _moverPresetCache.set(id, p);
  return p;
}
function invalidateMoverPresetCache() { _moverPresetCache.clear(); }

function sortCuesByStart(cues) {
  return cues.slice().sort((a, b) => a.start_ms - b.start_ms || (a.cell ? 1 : 0) - (b.cell ? 1 : 0));
}

/** Reset DMX map for fixtures referenced by a sequence (used before preview scrub applies active cues). */
function fillSequenceFixtureBaseline(channelUpdates, sequenceCues, allFixtures) {
  const hasRigWide = sequenceCues.some(c => c.fixture_id === 0);
  const fixtureIds = hasRigWide
    ? allFixtures.map(f => f.id)
    : [...new Set(sequenceCues.map(c => c.fixture_id).filter(id => id > 0))];
  for (const fid of fixtureIds) {
    const fixMap = getFixtureChannelMapByIdCached(fid);
    if (!fixMap) continue;
    const u = fixMap.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    for (const ch of fixMap.channels) {
      let resetVal = 0;
      if (ch.type === 'pan') resetVal = fixMap.home_pan ?? 128;
      else if (ch.type === 'tilt') resetVal = fixMap.home_tilt ?? 128;
      channelUpdates[u][ch.dmx_address] = resetVal;
    }
  }
}

/** Keep master dimmer up on multi-cell fixtures whenever they have active cues. */
function ensureMulticellMasterDimmer(channelUpdates, activeCues, allFixtures) {
  const activeFixtureIds = new Set(activeCues.map(c => c.fixture_id).filter(Boolean));
  for (const fixMap of allFixtures) {
    if (!activeFixtureIds.has(fixMap.id)) continue;
    if ((fixMap.cell_count || 0) <= 0) continue;
    const dimmerCh = fixMap.channels.find(c => c.type === 'dimmer' && !c.cell);
    if (!dimmerCh) continue;
    const u = fixMap.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    if (channelUpdates[u][dimmerCh.dmx_address] !== undefined) continue;
    let val = mapValueToRange(255, dimmerCh, 'dimmer');
    val = applyGroupDimmerToDimmerValue(val, fixMap);
    val = applyMasterDimmer(val, 'dimmer');
    channelUpdates[u][dimmerCh.dmx_address] = applyInvert(val, dimmerCh);
  }
}

function processSequenceAtTime(deckNum, timeMs, opts = {}) {
  const deckSeq = activeSequences[deckNum];
  if (!deckSeq || !deckSeq.sequence) return;
  // In normal mode, only process when playing. In preview mode, always process.
  if (!opts.preview && !deckSeq.playing) return;

  const seq = deckSeq.sequence;
  const cues = seq.cues || [];
  const cuesByStart = deckSeq.cuesByStart || cues;

  // Pre-fetch fixture channel map once for the entire tick (avoid per-cue DB queries)
  const allFixtures = getFixtureChannelMapCached();
  const fixtureCount = allFixtures.length;

  // ── Sequence end detection (VDJ-driven playback) ──
  if (seq.duration_ms && timeMs >= seq.duration_ms && !deckSeq._endActionApplied) {
    applySequenceEndAction(deckNum);
    return;
  }

  if (!dmxOutputEnabled) return;

  // ── Touch blackout hold: suppress all playback output ──
  if (touchOverrides.blackoutHold || touchOverrides.fullOnHold) return;

  try {

  // ── Crossfader: gate, blend, or off ────────────────────────────────────
  let crossfaderLevel = 1; // 0–1 multiplier for crossfader blending

  const cfMode = _cachedMixerConfig.crossfaderMode || 'gate';
  const legacyGating = _cachedMixerConfig.crossfaderGating;

  if (cfMode === 'blend' && (deckNum === 1 || deckNum === 2)) {
    const cf = parseFloat(state.crossfader) || 0; // 0 = full deck 1, 1 = full deck 2
    crossfaderLevel = deckNum === 1 ? Math.max(0, Math.min(1, 1 - cf)) : Math.max(0, Math.min(1, cf));
    // If level is near zero, blackout and skip
    if (crossfaderLevel < 0.01) {
      if (!deckSeq._gated) {
        deckSeq._gated = true;
        blackoutDeckFixtures(deckNum);
      }
      return;
    }
    if (deckSeq._gated) deckSeq._gated = false;
  } else if ((cfMode === 'gate' || legacyGating) && cfMode !== 'off') {
    // Legacy binary gating
    if (legacyGating || cfMode === 'gate') {
      const cf = parseFloat(state.crossfader) || 0;
      const gated = (deckNum === 1 && cf > 0.5) || (deckNum === 2 && cf < 0.55);
      if (gated) {
        if (!deckSeq._gated) {
          deckSeq._gated = true;
          blackoutDeckFixtures(deckNum);
        }
        return;
      }
      if (deckSeq._gated) deckSeq._gated = false;
    }
  }
  // cfMode === 'off' or decks 3-4: crossfaderLevel stays 1

  // ── Deck fader dimmer: scale output by deck volume fader ──
  const deckLevel = _cachedMixerConfig.deckFaderDimmer
    ? Math.max(0, Math.min(1, parseFloat(state.decks[deckNum]?.level) || 0))
    : 1;

  // Find all active cues at this time position
  // Sort active cues so master cues (cell=null) are processed first,
  // then cell-specific cues overwrite. This ensures cell cues always
  // take priority over master cues on the same fixture.
  const activeCues = [];
  const rigWideCues = []; // fixture_id 0 — applied to all fixtures after individual processing
  // Build a map of active color-track cues per fixture for effect base-color resolution
  const activeColorCuesByFixture = new Map(); // fixtureId → color cue
  const fixturesWithFx = new Set(); // fixtures that have their own per-fixture effect cue
  for (const cue of cuesByStart) {
    if (cue.start_ms > timeMs) break;
    if (timeMs >= cue.start_ms + cue.duration_ms) continue;
    // Rig-wide master cues (fixture_id 0) are processed in a separate pass
    if (cue.fixture_id === 0) { rigWideCues.push(cue); continue; }
    activeCues.push(cue);
    // Track the latest active color-track cue per fixture (last one wins)
    if ((cue.track || 'color') === 'color') {
      activeColorCuesByFixture.set(cue.fixture_id, cue);
    }
    // Track fixtures that have per-fixture FX cues
    if (cue.cue_type === 'effect' && cue.effect_id) {
      fixturesWithFx.add(cue.fixture_id);
    }
  }
  activeCues.sort((a, b) => (a.cell ? 1 : 0) - (b.cell ? 1 : 0));

  const channelUpdates = {}; // { universe: { channel: value } }
  // Preview scrub: reset sequence fixtures each seek so gaps / past last cue go dark
  if (opts.preview) {
    fillSequenceFixtureBaseline(channelUpdates, cues, allFixtures);
  }

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
    const hasSmokeOverride = touchOverrides.smokeOverrideFixtures.has(fixtureId);

    // Find the fixture in pre-fetched channel map (cached per tick)
    const fixMap = getFixtureChannelMapByIdCached(fixtureId);
    if (!fixMap) continue;

    const progress = (timeMs - cue.start_ms) / cue.duration_ms; // 0..1 (movement presets, fades)

    const channelVals = cue.channel_values || {};
    const endVals = cue.end_channel_values;

    for (const ch of fixMap.channels) {
      if (!shouldApplyCellCue(cue.cell, ch)) continue;
      // Skip channels that are overridden by touch UI
      if (hasColorOverride && COLOR_CHANNELS.has(ch.type)) continue;
      if (hasMovementOverride && PAN_TILT.has(ch.type)) continue;
      if (hasSmokeOverride && ch.type === 'smoke') continue;
      // Atmosphere (fire/flame) is manual-only — never driven by sequences
      if (ch.type === 'atmosphere') continue;

      let value = null;
      let skipRangeMap = false; // true when value is already mapped to a specific range

      if (cue.cue_type === 'solid' || cue.cue_type === 'color_wheel' || cue.cue_type === 'static' || cue.cue_type === 'fade') {
        // All cues support start→end transitions; if no end values, hold start
        const startVal = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
        if (startVal === null) { value = null; }
        else if (ch.type === 'color_wheel' || ch.type === 'gobo') {
          // Physical wheel channels must snap — interpolating sweeps through
          // random intermediate positions on the physical wheel.
          value = startVal;
        } else if (endVals && endVals[ch.type] !== undefined) {
          const endVal = endVals[ch.type];
          value = Math.round(startVal + (endVal - startVal) * progress);
        } else {
          value = startVal;
        }
      } else if (cue.cue_type === 'strobe') {
        if (_cachedMixerConfig.seqNoStrobes) {
          value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
        } else {
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
        }
      } else if (cue.cue_type === 'chase') {
        // Chase: cycle through fixtures in the group
        // For now, simple on/off based on beat position
        value = channelVals[ch.type] !== undefined ? channelVals[ch.type] : null;
      } else if (cue.cue_type === 'effect' && cue.effect_id) {
        const effect = getEffectCached(cue.effect_id);
        if (effect && isFixtureCompatibleWithEffect(effect, fixMap)) {
          const channelCtx = buildChannelCtx(ch, fixMap);
          // Rig-wide fixture count for rig effects
          channelCtx._rigFixtureCount = fixtureCount;
          // Resolve base color from the active color-track cue on this fixture
          // so effects modulate the color timeline instead of using their own stored color.
          let effectBaseVals = channelVals;
          const colorCue = activeColorCuesByFixture.get(fixtureId);
          if (colorCue) {
            const colorChVals = colorCue.channel_values || {};
            const colorEndVals = colorCue.end_channel_values;
            const colorProgress = (timeMs - colorCue.start_ms) / colorCue.duration_ms;
            // Interpolate color-track values at current time
            effectBaseVals = { ...channelVals };
            for (const cType of ['red', 'green', 'blue', 'white', 'dimmer']) {
              const sv = colorChVals[cType];
              if (sv === undefined) continue;
              if (colorEndVals && colorEndVals[cType] !== undefined) {
                effectBaseVals[cType] = Math.round(sv + (colorEndVals[cType] - sv) * colorProgress);
              } else {
                effectBaseVals[cType] = sv;
              }
            }
          }
          const touchEffectParams = { ...(cue.effect_params || {}) };
          if (_cachedMixerConfig.seqNoStrobes) touchEffectParams.no_strobes = true;
          const withOverride = applyLiveColorOverrideForMulticell(fixMap, effectBaseVals, touchEffectParams);
          effectBaseVals = withOverride.effectBaseVals;
          Object.assign(touchEffectParams, withOverride.effectParams);
          if (SOUND_EFFECT_TYPES.has(effect.type) && !touchEffectParams.audio) touchEffectParams.audio = getCurrentAudioData();
          const seqBpm = seq.bpm || (touchEffectParams.beat_ms ? 60000 / touchEffectParams.beat_ms : 128);
          const effectProgress = sequenceEffectProgress(
            effect.type, cue.start_ms, cue.duration_ms, timeMs, touchOverrides.effectSpeed, seqBpm,
          );
          value = computeEffectValue(effect, ch.type, effectProgress, effectBaseVals, touchEffectParams, channelCtx);
          if (value === null || value === undefined) {
            if (isAuxiliaryMulticellChannel(ch, fixMap)) {
              value = null;
            } else {
              value = effectBaseVals[ch.type] !== undefined ? effectBaseVals[ch.type]
                    : (ch.type === 'dimmer' ? 255 : null);
            }
          }
        }
      } else if (cue.cue_type === 'movement') {
        // Movement preset(s): cycle through saved positions over the cue duration.
        // Supports both a single mover_preset_id and an array of mover_preset_ids.
        const presetIds = Array.isArray(channelVals.mover_preset_ids)
          ? channelVals.mover_preset_ids
          : (channelVals.mover_preset_id ? [channelVals.mover_preset_id] : []);

        if (presetIds.length > 0) {
          // Collect positions for this fixture from all referenced presets
          const fixPositions = [];
          for (const pid of presetIds) {
            const preset = getMoverPresetCached(pid);
            if (preset && preset.positions) {
              const pos = preset.positions.find(p => p.fixture_id === fixtureId);
              if (pos) fixPositions.push(pos);
            }
          }
          if (fixPositions.length > 0) {
            const totalSteps = fixPositions.length;
            const stepProgress = (progress * totalSteps) % totalSteps;
            const stepIdx = Math.floor(stepProgress);
            const linearFrac = stepProgress - stepIdx;
            // Smoothstep easing: decelerate into positions, accelerate out
            // Produces natural-looking sweeps instead of sharp direction changes
            const stepFrac = linearFrac * linearFrac * (3 - 2 * linearFrac);
            const curr = fixPositions[stepIdx % totalSteps];
            const next = fixPositions[(stepIdx + 1) % totalSteps];
            // Smooth interpolation between positions
            if (ch.type === 'pan' && curr.pan !== undefined) {
              value = curr.pan + (next.pan - curr.pan) * stepFrac;
            } else if (ch.type === 'tilt' && curr.tilt !== undefined) {
              value = curr.tilt + (next.tilt - curr.tilt) * stepFrac;
            } else if (ch.type === 'speed') {
              value = channelVals.speed !== undefined ? channelVals.speed
                    : (curr.speed !== undefined ? curr.speed : null);
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
        // Scale by crossfader blend level (proportional blend between decks)
        if (crossfaderLevel < 1 && DIMMABLE_CHANNELS.has(ch.type)) {
          finalValue = Math.round(finalValue * crossfaderLevel);
        }
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
            finalValue = applyGroupDimmerToDimmerValue(finalValue, fixMap);
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

  // ── Rig-wide master effects (fixture_id 0): fan out to all fixtures ──
  // Only applies to fixtures that don't already have a per-fixture effect active.
  for (const rigCue of rigWideCues) {
    if (rigCue.cue_type !== 'effect' || !rigCue.effect_id) continue;
    const effect = getEffectCached(rigCue.effect_id);
    if (!effect) continue;
    const progress = (timeMs - rigCue.start_ms) / rigCue.duration_ms;
    const rigChannelVals = rigCue.channel_values || {};

    for (const fixMap of allFixtures) {
      const fid = fixMap.id;
      // Skip fixtures that have their own per-fixture effect cue active
      if (fixturesWithFx.has(fid)) continue;
      if (touchOverrides.disabledFixtures.has(fid)) continue;
      if (touchOverrides.os2lOverrideFixtures.has(fid)) continue;
      if (!isFixtureCompatibleWithEffect(effect, fixMap)) continue;

      const hasColorOverride = touchOverrides.colorOverrideFixtures.has(fid);
      const hasMovementOverride = touchOverrides.movementOverrideFixtures.has(fid);
      const hasSmokeOverride = touchOverrides.smokeOverrideFixtures.has(fid);

      for (const ch of fixMap.channels) {
        if (hasColorOverride && COLOR_CHANNELS.has(ch.type)) continue;
        if (hasMovementOverride && PAN_TILT.has(ch.type)) continue;
        if (hasSmokeOverride && ch.type === 'smoke') continue;
      // Atmosphere (fire/flame) is manual-only — never driven by sequences
      if (ch.type === 'atmosphere') continue;

        const channelCtx = buildChannelCtx(ch, fixMap);
        channelCtx._rigFixtureCount = fixtureCount;

        // Resolve base color from the active color-track cue on this fixture
        let effectBaseVals = rigChannelVals;
        const colorCue = activeColorCuesByFixture.get(fid);
        if (colorCue) {
          const colorChVals = colorCue.channel_values || {};
          const colorEndVals = colorCue.end_channel_values;
          const colorProgress = (timeMs - colorCue.start_ms) / colorCue.duration_ms;
          effectBaseVals = { ...rigChannelVals };
          for (const cType of ['red', 'green', 'blue', 'white', 'dimmer']) {
            const sv = colorChVals[cType];
            if (sv === undefined) continue;
            if (colorEndVals && colorEndVals[cType] !== undefined) {
              effectBaseVals[cType] = Math.round(sv + (colorEndVals[cType] - sv) * colorProgress);
            } else {
              effectBaseVals[cType] = sv;
            }
          }
        }

        const rigEffectParams = { ...(rigCue.effect_params || {}) };
        if (_cachedMixerConfig.seqNoStrobes) rigEffectParams.no_strobes = true;
        const withOverride = applyLiveColorOverrideForMulticell(fixMap, effectBaseVals, rigEffectParams);
        effectBaseVals = withOverride.effectBaseVals;
        Object.assign(rigEffectParams, withOverride.effectParams);
        if (SOUND_EFFECT_TYPES.has(effect.type) && !rigEffectParams.audio) rigEffectParams.audio = getCurrentAudioData();
        const seqBpm = seq.bpm || (rigEffectParams.beat_ms ? 60000 / rigEffectParams.beat_ms : 128);
        const effectProgress = sequenceEffectProgress(
          effect.type, rigCue.start_ms, rigCue.duration_ms, timeMs, touchOverrides.effectSpeed, seqBpm,
        );
        let value = computeEffectValue(effect, ch.type, effectProgress, effectBaseVals, rigEffectParams, channelCtx);
        if (value === null || value === undefined) {
          if (isAuxiliaryMulticellChannel(ch, fixMap)) {
            value = null;
          } else {
            value = effectBaseVals[ch.type] !== undefined ? effectBaseVals[ch.type]
                  : (ch.type === 'dimmer' ? 255 : null);
          }
        }

        if (value !== null && value !== undefined) {
          const universe = fixMap.universe;
          if (!channelUpdates[universe]) channelUpdates[universe] = {};
          let finalValue = Math.max(0, Math.min(255, Math.round(value)));
          if (crossfaderLevel < 1 && DIMMABLE_CHANNELS.has(ch.type)) {
            finalValue = Math.round(finalValue * crossfaderLevel);
          }
          if (deckLevel < 1 && DIMMABLE_CHANNELS.has(ch.type)) {
            finalValue = Math.round(finalValue * deckLevel);
          }
          const fixHasDimmer = fixMap.channels.some(c => c.type === 'dimmer');
          if (fixHasDimmer) {
            if (ch.type === 'dimmer') {
              finalValue = applyGroupDimmerToDimmerValue(finalValue, fixMap);
              finalValue = applyMasterDimmer(finalValue, ch.type);
            }
          } else {
            finalValue = applyMasterDimmer(finalValue, ch.type);
          }
          finalValue = mapValueToRange(finalValue, ch, ch.type);
          channelUpdates[universe][ch.dmx_address] = applyInvert(Math.max(0, Math.min(255, finalValue)), ch);
        }
      }
    }
  }

  // Send all channel updates
  ensureMulticellMasterDimmer(channelUpdates, activeCues, allFixtures);
  applyActiveColorOverrideToUpdates(channelUpdates, fixturesWithFx);
  for (const [u, chMap] of Object.entries(channelUpdates)) {
    const channels = Object.entries(chMap).map(([ch, val]) => ({ ch: +ch, val }));
    if (channels.length > 0) {
      artnetServer.setChannels(+u, channels);
      dmxUsbServer.setChannels(+u, channels);
    }
  }

  deckSeq.lastTimeMs = timeMs;

  } catch (e) {
    console.error(`[SEQ] Playback error on deck ${deckNum} @ ${Math.round(timeMs)}ms:`, e.message);
  }
}

/**
 * Deterministic pseudo-random for sparkle / fire effects.
 * (effects-engine import moved to top of file)
 */

/** Overlay MIDI/OS2L color on non-multicell output, or multicell gaps (no active FX cue). */
function applyActiveColorOverrideToUpdates(channelUpdates, fixturesWithFx) {
  const ov = touchOverrides.activeColorOverride;
  if (!ov) return;

  const { red = 0, green = 0, blue = 0, white = 0, group_id } = ov;
  const fixtures = getFixtureChannelMapCached();
  fixturesWithFx = fixturesWithFx || new Set();

  for (const fix of fixtures) {
    if (isFixtureDisabled(fix.id)) continue;
    if (group_id && !(fix.group_ids || []).includes(group_id)) continue;
    // Multicell / pixel tape: keep pattern motion — recolor happens via effect base values.
    if ((fix.cell_count || 0) > 0 && fixturesWithFx.has(fix.id)) continue;
    const u = fix.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    const fixHasDimmer = fix.channels.some(c => c.type === 'dimmer');

    for (const ch of fix.channels) {
      const colorMap = { red, green, blue, white };
      if (colorMap[ch.type] !== undefined) {
        let val = colorMap[ch.type];
        if (!fixHasDimmer) val = applyMasterDimmer(val, ch.type);
        val = mapValueToRange(Math.max(0, Math.min(255, Math.round(val))), ch, ch.type);
        channelUpdates[u][ch.dmx_address] = applyInvert(val, ch);
      } else if (ch.type === 'color_wheel' && fix.color_wheel_map && fix.color_wheel_map.length) {
        let best = null, bestDist = Infinity;
        for (const entry of fix.color_wheel_map) {
          const hex = entry.color_hex;
          const cr = parseInt(hex.slice(1, 3), 16);
          const cg = parseInt(hex.slice(3, 5), 16);
          const cb = parseInt(hex.slice(5, 7), 16);
          const dist = (cr - red) ** 2 + (cg - green) ** 2 + (cb - blue) ** 2;
          if (dist < bestDist) { bestDist = dist; best = entry; }
        }
        channelUpdates[u][ch.dmx_address] = applyInvert(best ? best.dmx_start : 0, ch);
      } else if (ch.type === 'dimmer') {
        let val = applyGroupDimmerToDimmerValue(applyMasterDimmer(255, ch.type), fix);
        val = mapValueToRange(Math.max(0, Math.min(255, Math.round(val))), ch, ch.type);
        channelUpdates[u][ch.dmx_address] = applyInvert(val, ch);
      }
    }
  }
}

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
      ws.send(JSON.stringify({ type: 'seq_loaded', deck: +deck, sequence: sequenceForClient(seqState.sequence) }));
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

function isHubOs2lLocal() {
  return db.getConfig('hub_os2l_local') !== '0';
}

function registerBonjour() {
  try {
    const bonjour = new Bonjour();
    const os2lLocal = isHubOs2lLocal();
    const bonjourName = brand.getHubBonjourName(db);

    if (os2lLocal) {
      bonjour.publish({
        name: bonjourName,
        type: 'os2l',
        protocol: 'tcp',
        port: OS2L_PORT,
        txt: { txtvers: '1', product: 'Thaluxis DMX' },
      });
      console.log(`[mDNS] Registered "${bonjourName}" as _os2l._tcp on port ${OS2L_PORT}`);
    } else {
      console.log('[mDNS] Local _os2l._tcp skipped (hub_os2l_local=0 — use Thaluxis Satellite OS2L)');
    }

    bonjour.publish({
      name: bonjourName,
      type: 'http',
      protocol: 'tcp',
      port: WEB_PORT,
      txt: { path: '/', product: 'Thaluxis DMX' },
    });
    console.log(`[mDNS] Registered "${bonjourName}" as _http._tcp on port ${WEB_PORT}`);

    if (db.getConfig('satellite_enabled') !== '0') {
      bonjour.publish({
        name: bonjourName,
        type: 'dmx-hub',
        protocol: 'tcp',
        port: WEB_PORT,
        txt: { path: '/api/hub/status', role: 'hub', product: brand.getHubDisplayName(db) },
      });
      console.log(`[mDNS] Registered "${bonjourName}" as _dmx-hub._tcp on port ${WEB_PORT}`);
    }

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

hubRoutes.init({
  db,
  audioAnalyzer,
  handleOs2lSubscribed,
  handleOs2lButton: os2l.handleButtonAction,
  broadcast,
  getAnalysisConfig,
  getAnchorPoints,
  requireAuth,
});

loadTouchGroupDimmers();

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

/** Block all DMX writes while blackout hold is active (emergency stop). */
function installBlackoutDmxGuard(server) {
  const origSetChannel = server.setChannel.bind(server);
  const origSetChannels = server.setChannels.bind(server);
  const origSetFullUniverse = server.setFullUniverse?.bind(server);
  server.setChannel = (localUniverse, channel, value) => {
    if (touchOverrides.blackoutHold) return;
    origSetChannel(localUniverse, channel, value);
  };
  server.setChannels = (localUniverse, channels) => {
    if (touchOverrides.blackoutHold) return;
    origSetChannels(localUniverse, channels);
  };
  if (origSetFullUniverse) {
    server.setFullUniverse = (localUniverse, data) => {
      if (touchOverrides.blackoutHold) return;
      origSetFullUniverse(localUniverse, data);
    };
  }
}
installBlackoutDmxGuard(artnetServer);
installBlackoutDmxGuard(dmxUsbServer);

if (Object.keys(touchOverrides.groupDimmers).length && dmxOutputEnabled) {
  applyAllPersistedGroupDimmersToDmx();
}

/** Stop all live QA/scene/color output (blackout e-stop). */
function emergencyStopLiveOutput() {
  stopRunningEffect(undefined, false);
  if (activeStaticScene) deactivateScene();
  touchOverrides.activeColorOverride = null;
  try { midiController.clearCompanionColorOverride(); } catch { /* ignore */ }
  try { midiController.clearMidiRunningEffects(); } catch { /* ignore */ }
  broadcast({ type: 'qa_effects_stopped' });
}

/** Blackout hold — emergency stop: kills live effects and zeros output until released. */
function setBlackoutHold(active) {
  touchOverrides.blackoutHold = !!active;
  if (active) {
    emergencyStopLiveOutput();
    artnetServer.saveBuffers();
    dmxUsbServer.saveBuffers();
    artnetServer.blackout();
    dmxUsbServer.blackout();
  } else {
    artnetServer.restoreBuffers();
    dmxUsbServer.restoreBuffers();
  }
  broadcast({ type: 'touchBlackoutHold', active: !!active });
  console.log(`[TOUCH] Blackout hold ${active ? 'ON' : 'OFF'}`);
}

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
  applyTouchDimmerChain,
  applyInvert,
  isAnySequencePlaying,
  onMessage: handleOs2lSubscribed,
  setBlackoutHold,
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
      console.log(`[VDJ] Imported ${result.total} tracks (${result.inserted} new, ${result.updated} updated, ${result.pathUpdated || 0} paths updated, ${result.duplicatesRemoved || 0} stale duplicates removed)`);
    } else {
      console.log('[VDJ] No database path configured — skip track import');
    }
  } catch (e) {
    console.error(`[VDJ] Failed to load database: ${e.message}`);
  }
})();

if (isHubOs2lLocal()) {
  os2l.startServer(OS2L_PORT);
} else {
  console.log('[OS2L] Local TCP server disabled — deck data expected from satellite via /api/hub/os2l');
}

// Initialise MIDI controller module with same dependencies as OS2L
midiController.init({
  db,
  broadcast,
  state,
  artnetServer,
  dmxUsbServer,
  touchOverrides,
  runningQaEffects,
  getDmxOutputEnabled: () => dmxOutputEnabled,
  isAnySequencePlaying,
  getEffectSlot,
  stopRunningEffect,
  activateScene,
  deactivateScene,
  buildChannelCtx,
  computeEffectValue,
  isFixtureCompatibleWithEffect,
  applyMasterDimmer,
  applyTouchDimmerChain,
  applyInvert,
  pauseAllSequences,
  getFixtureChannelMapCached,
  getFixtureChannelMapByIdMap: () => {
    if (!_cachedFixtureChannelMapById) getFixtureChannelMapCached();
    return _cachedFixtureChannelMapById;
  },
  persistTouchGroupDimmers,
  setBlackoutHold,
});

// Auto-start MIDI controller
(async function startMidi() {
  try {
    await midiController.start();
  } catch (e) {
    console.warn(`[MIDI] Auto-start failed: ${e.message}`);
  }
})();

httpServer.listen(WEB_PORT, () => {
  console.log(`[HTTP] Web UI at http://localhost:${WEB_PORT}`);
});

// Auto-start live audio input capture if it was enabled on last run
_applyAudioInputConfig();

const bonjour = registerBonjour();
startMdnsResponder();

// Graceful shutdown (SIGINT = Ctrl+C, SIGTERM = node --watch restart)
async function shutdown() {
  console.log('\nShutting down...');
  artnetServer.shutdown();
  await dmxUsbServer.shutdownAll();
  audioInput.capture.stop();
  if (mdnsResponder) mdnsResponder.destroy();
  if (bonjour) bonjour.destroy();
  midiController.stop();
  os2l.stopServer();
  httpServer.close();
  process.exit(0);
}

process.on('SIGINT', () => { shutdown().catch(console.error); });
process.on('SIGTERM', () => { shutdown().catch(console.error); });

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
