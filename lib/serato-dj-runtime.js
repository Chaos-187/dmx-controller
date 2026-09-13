'use strict';

/**
 * Serato DJ Pro integration — serato-connect Remote OSC + optional history poll.
 * @see https://github.com/chrisle/serato-connect
 */

const { SeratoRemoteClient, SeratoConnect, detectSeratoInstallation } = require('serato-connect');

/** @type {SeratoRemoteClient | null} */
let remoteClient = null;
/** @type {SeratoConnect | null} */
let historyClient = null;
let started = false;
let remotePeerConnected = false;
let readvertiseTimer = null;
let readvertiseInProgress = false;
/** @type {object | null} */
let remoteRuntime = null;

const READVERTISE_INTERVAL_MS = 20000;

function isSeratoActive(getConfig) {
  if (typeof getConfig !== 'function') return false;
  return (
    getConfig('dj_active_provider') === 'serato'
    && getConfig('serato_integration_enabled') === '1'
  );
}

function createHubLogger(prefix, eventLog, getConfig) {
  const forward = (level, { console: toConsole = true } = {}) => (msg) => {
    const text = typeof msg === 'string' ? msg : String(msg);
    const debug = getConfig?.('debug_logging') === '1';
    if (toConsole && (level !== 'debug' || debug)) {
      console.log(`[${prefix}] ${text}`);
    }
    if (eventLog?.add && (level !== 'debug' || debug)) {
      eventLog.add({
        level: level === 'debug' ? 'debug' : level,
        source: 'serato',
        category: 'serato-connect',
        message: text,
      });
    }
  };
  return {
    trace: forward('debug', { console: false }),
    debug: forward('debug', { console: false }),
    info: forward('info'),
    warn: forward('warn'),
    error: forward('error'),
  };
}

function bindPush(onSubscribed) {
  return (deck, key, value) => {
    if (!deck || deck < 1 || deck > 4) return;
    if (value === undefined || value === null) return;

    if (key === 'play') {
      onSubscribed({ trigger: `deck ${deck} play`, value: value ? 'on' : 'off' });
      return;
    }
    if (key === 'filepath') {
      onSubscribed({ trigger: `deck ${deck} get_filepath`, value: String(value) });
      return;
    }
    if (key === 'genre') {
      onSubscribed({ trigger: `deck ${deck} get_genre`, value: String(value) });
      return;
    }
    if (key === 'bpm') {
      onSubscribed({ trigger: `deck ${deck} get_bpm`, value: Number(value) });
      return;
    }
    if (key === 'beatpos') {
      onSubscribed({ trigger: `deck ${deck} get_beatpos`, value: Number(value) });
      return;
    }
    if (key === 'time') {
      onSubscribed({ trigger: `deck ${deck} get_time elapsed absolute`, value: Number(value) });
      return;
    }
    if (key === 'level') {
      onSubscribed({ trigger: `deck ${deck} level`, value: Number(value) });
      return;
    }
  };
}

function applyHistoryTrack(push, deckId, track) {
  if (!track) return;
  if (track.filePath) push(deckId, 'filepath', track.filePath);
  if (track.bpm) push(deckId, 'bpm', track.bpm);
  if (track.genre) push(deckId, 'genre', track.genre);
  if (typeof track.playing === 'boolean') push(deckId, 'play', track.playing);
}

function clearReadvertiseTimer() {
  if (readvertiseTimer) {
    clearInterval(readvertiseTimer);
    readvertiseTimer = null;
  }
}

function scheduleReadvertiseWhileDisconnected() {
  clearReadvertiseTimer();
  if (!remoteRuntime?.remoteEnabled) return;
  readvertiseTimer = setInterval(() => {
    if (remotePeerConnected || readvertiseInProgress) return;
    readvertiseRemote().catch((err) => {
      console.warn('[Serato] Remote re-advertise failed:', err?.message || err);
    });
  }, READVERTISE_INTERVAL_MS);
  if (typeof readvertiseTimer.unref === 'function') readvertiseTimer.unref();
}

/**
 * Serato DJ Pro browses `_SeratoIOSRemote._tcp` at startup. If DJ Pro was already
 * open when the hub advertises, it often never re-browses — bounce mDNS + TCP listen.
 */
async function readvertiseRemote() {
  if (!remoteRuntime?.remoteEnabled) {
    return { ok: false, reason: 'remote_disabled' };
  }
  if (remotePeerConnected) {
    return { ok: false, reason: 'already_connected' };
  }
  if (readvertiseInProgress) {
    return { ok: false, reason: 'in_progress' };
  }

  readvertiseInProgress = true;
  try {
    if (remoteClient) {
      try {
        await remoteClient.stop();
      } catch (e) {
        console.warn('[Serato] remote stop before readvertise:', e.message);
      }
      remoteClient = null;
    }

    const { peerName, remotePort, logger } = remoteRuntime;
    remoteClient = new SeratoRemoteClient({
      peerName,
      port: remotePort,
      host: '0.0.0.0',
      logger,
    });
    wireRemoteClient(remoteClient, remoteRuntime);
    const info = await remoteClient.start();
    console.log(
      `[Serato] Re-advertised Remote on port ${info.port} (${info.instanceName}) — if DJ Pro was already running, enable Remote or wait for auto retry`,
    );
    return { ok: true, port: info.port, instanceName: info.instanceName };
  } finally {
    readvertiseInProgress = false;
  }
}

function wireRemoteClient(client, ctx) {
  const { push, scheduleBroadcast, state, touchDeckPlayhead } = ctx;

  client.on('ready', (info) => {
    console.log(`[Serato] Remote server ready on port ${info.port} (${info.instanceName}) — enable Serato Remote in DJ Pro`);
    if (!remotePeerConnected) scheduleReadvertiseWhileDisconnected();
  });

  client.on('peerConnected', (peer) => {
    remotePeerConnected = true;
    clearReadvertiseTimer();
    state.connected = true;
    state.vdjAddress = peer.remoteAddress || 'serato-remote';
    scheduleBroadcast();
    console.log(`[Serato] Remote peer connected from ${peer.remoteAddress}:${peer.remotePort}`);
  });

  client.on('peerDisconnected', () => {
    remotePeerConnected = false;
    if (!historyClient) {
      state.connected = false;
      state.vdjAddress = null;
    }
    scheduleBroadcast();
    scheduleReadvertiseWhileDisconnected();
    console.log('[Serato] Remote peer disconnected');
  });

  client.on('deckChange', ({ deckId, track }) => {
    if (!track?.filePath && track?.valid === false) {
      push(deckId, 'play', false);
      scheduleBroadcast();
      return;
    }
    applyHistoryTrack(push, deckId, {
      filePath: track?.filePath,
      bpm: undefined,
      genre: undefined,
      playing: undefined,
    });
    scheduleBroadcast();
  });

  client.on('playhead', ({ deckId, playhead }) => {
    if (!playhead) return;
    const deckState = state.decks[deckId];
    if (deckState) {
      deckState.seratoPlayRate = typeof playhead.playRate === 'number' ? playhead.playRate : 0;
      deckState.seratoTimeReceivedAt = Date.now();
      if (typeof playhead.positionSeconds === 'number') {
        const timeMs = playhead.positionSeconds * 1000;
        deckState.seratoAnchorTimeMs = timeMs;
        deckState.seratoAnchorWall = Date.now();
        deckState.time = timeMs;
        if (playhead.bpm > 0) {
          deckState.beatpos = (playhead.positionSeconds * playhead.bpm) / 60;
        }
      }
    }
    if (typeof touchDeckPlayhead === 'function') touchDeckPlayhead(deckId);

    if (playhead.bpm > 0 && deckState && deckState.bpm !== playhead.bpm) {
      push(deckId, 'bpm', playhead.bpm);
    }

    const playing = Math.abs(playhead.playRate || 0) > 0.01;
    const prevPlaying = deckState?.seratoPlaying;
    if (prevPlaying !== playing) {
      if (deckState) deckState.seratoPlaying = playing;
      push(deckId, 'play', playing);
      scheduleBroadcast();
      return;
    }
    const now = Date.now();
    if (now - ctx.playheadUiBroadcastAt >= 66) {
      ctx.playheadUiBroadcastAt = now;
      scheduleBroadcast();
    }
  });

  client.on('mixerChange', ({ mixer }) => {
    let changed = false;
    if (typeof mixer?.crossfader === 'number' && state.crossfader !== mixer.crossfader) {
      state.crossfader = mixer.crossfader;
      changed = true;
    }
    if (mixer?.upfaders) {
      for (let d = 1; d <= 4; d++) {
        const v = mixer.upfaders[d];
        if (typeof v !== 'number') continue;
        const deckState = state.decks[d];
        if (deckState && deckState.level !== v) {
          deckState.level = v;
          changed = true;
        }
      }
    }
    if (changed) scheduleBroadcast();
  });

  client.on('error', (err) => {
    console.error('[Serato] Remote error:', err?.message || err);
  });
}

async function startRemoteServer(ctx) {
  const { peerName, remotePort, logger } = ctx;
  remoteClient = new SeratoRemoteClient({
    peerName,
    port: remotePort,
    host: '0.0.0.0',
    logger,
  });
  wireRemoteClient(remoteClient, ctx);
  return remoteClient.start();
}

/**
 * @param {object} opts
 */
async function start(opts) {
  if (started) return;
  const { getConfig, onSubscribed, scheduleBroadcast, state, eventLog } = opts;
  if (!isSeratoActive(getConfig)) return;

  const push = bindPush(onSubscribed);
  const logger = createHubLogger('Serato', eventLog, getConfig);
  const remoteEnabled = getConfig('serato_remote_enabled') !== '0';
  const historyPoll = getConfig('serato_history_poll') === '1';
  const libraryPath = (getConfig('serato_library_path') || '').trim();
  const remotePort = parseInt(getConfig('serato_remote_port') || '0', 10) || 0;
  const peerName = (getConfig('serato_peer_name') || 'Thaluxis-Hub').trim() || 'Thaluxis-Hub';

  state.djProvider = 'serato';

  remoteRuntime = {
    remoteEnabled,
    peerName,
    remotePort,
    logger,
    push,
    scheduleBroadcast,
    state,
    touchDeckPlayhead: opts.touchDeckPlayhead,
    playheadUiBroadcastAt: 0,
  };

  if (remoteEnabled) {
    await startRemoteServer(remoteRuntime);
    if (!remotePeerConnected) {
      setTimeout(() => {
        if (!remotePeerConnected) {
          readvertiseRemote().catch(() => {});
        }
      }, 8000).unref?.();
    }
  }

  if (historyPoll) {
    const seratoPath = libraryPath || undefined;
    if (libraryPath) {
      const det = detectSeratoInstallation(libraryPath);
      if (!det.found) {
        console.warn(`[Serato] Library path not found: ${libraryPath}`);
      }
    }

    historyClient = new SeratoConnect({
      seratoPath,
      pollIntervalMs: parseInt(getConfig('serato_history_poll_ms') || '2000', 10) || 2000,
      logger,
    });

    historyClient.on('ready', (info) => {
      console.log(`[Serato] History monitor ready (${info.sessionCount} sessions) at ${info.seratoPath}`);
      if (!remotePeerConnected) {
        state.connected = true;
        state.vdjAddress = 'serato-history';
        scheduleBroadcast();
      }
    });

    historyClient.on('deckChange', ({ deckId, track }) => {
      if (remotePeerConnected) return;
      applyHistoryTrack(push, deckId, track);
      scheduleBroadcast();
    });

    historyClient.on('error', (err) => {
      console.warn('[Serato] History monitor:', err?.message || err);
    });

    await historyClient.start();
  }

  if (!remoteEnabled && !historyPoll) {
    console.warn('[Serato] No Remote or history mode enabled — enable at least one in Config');
  }

  started = true;
}

async function stop() {
  clearReadvertiseTimer();
  remoteRuntime = null;
  if (remoteClient) {
    try {
      await remoteClient.stop();
    } catch (e) {
      console.warn('[Serato] remote stop:', e.message);
    }
    remoteClient = null;
  }
  if (historyClient) {
    try {
      historyClient.stop();
    } catch (e) {
      console.warn('[Serato] history stop:', e.message);
    }
    historyClient = null;
  }
  remotePeerConnected = false;
  started = false;
}

function isStarted() {
  return started;
}

function getRemoteStatus() {
  return {
    enabled: !!remoteRuntime?.remoteEnabled,
    peerConnected: remotePeerConnected,
    advertising: remoteClient?.running ?? false,
  };
}

module.exports = {
  isSeratoActive,
  start,
  stop,
  isStarted,
  readvertiseRemote,
  getRemoteStatus,
};
