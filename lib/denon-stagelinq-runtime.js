'use strict';

/**
 * Denon DJ / Engine OS — StageLinQ client (beta).
 * @see https://github.com/chrisle/StageLinq
 */

const { StageLinqInstance } = require('stagelinq');

/** @type {StageLinqInstance | null} */
let client = null;
let started = false;

function isDenonEngineActive(getConfig) {
  if (typeof getConfig !== 'function') return false;
  return (
    getConfig('dj_active_provider') === 'denon_engine'
    && getConfig('denon_stagelinq_enabled') === '1'
  );
}

/**
 * Map Engine OS player/layer to hub deck 1–4.
 * @param {{ player?: number, layer?: string, deck?: string }} status
 * @param {2 | 4} playerMode
 */
function mapToHubDeck(status, playerMode) {
  const player = status.player || 1;
  const layer = status.layer || (status.deck && String(status.deck).slice(-1)) || 'A';
  const layerIdx = 'ABCD'.indexOf(String(layer).toUpperCase());
  if (layerIdx < 0) return null;

  if (playerMode === 4 && player === 1) return layerIdx + 1;

  // Two-deck: Prime layers A/B on player 1, or one deck per SC6000 (player 1 / 2)
  if (playerMode === 2) {
    if (player === 1 && layerIdx <= 1) return layerIdx + 1;
    if (player >= 2 && layerIdx === 0) return Math.min(player, 2);
    return player <= 2 ? player : null;
  }

  if (player === 1) return layerIdx + 1;
  return player <= 4 ? player : null;
}

function resolveTrackPath(status) {
  return (
    status.trackPathAbsolute
    || status.trackPath
    || status.fileLocation
    || status.trackNetworkPath
    || ''
  );
}

function createHubLogger(eventLog, getConfig) {
  const forward = (level, { console: toConsole = true } = {}) => (msg) => {
    const text = typeof msg === 'string' ? msg : String(msg);
    if (/ \(IGNORED\)/.test(text)) return;
    const debug = getConfig?.('debug_logging') === '1';
    if (/^Discovery:/.test(text) && !debug) return;
    if (toConsole && (level !== 'debug' || debug)) {
      console.log(`[Denon] ${text}`);
    }
    if (eventLog?.add && level !== 'debug') {
      eventLog.add({ level, source: 'denon', category: 'stagelinq', message: text });
    } else if (eventLog?.add && debug) {
      eventLog.add({ level: 'debug', source: 'denon', category: 'stagelinq', message: text });
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

/**
 * @param {object} opts
 * @param {() => string|null} opts.getConfig
 * @param {(data: { trigger: string, value: * }) => void} opts.onSubscribed
 * @param {() => void} opts.scheduleBroadcast
 * @param {object} opts.state
 * @param {object} [opts.eventLog]
 */
async function start(opts) {
  if (started) return;
  const { getConfig, onSubscribed, scheduleBroadcast, state, eventLog } = opts;
  if (!isDenonEngineActive(getConfig)) return;

  const playerMode = parseInt(getConfig('denon_player_mode') || '4', 10) === 2 ? 2 : 4;
  const downloadLibrary = getConfig('denon_download_library') === '1';

  client = new StageLinqInstance({
    logger: createHubLogger(eventLog, getConfig),
    downloadDbSources: downloadLibrary,
    enableFileTranfer: downloadLibrary,
    maxRetries: 3,
  });

  const push = (deck, key, value) => {
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

  const applyStatus = (status) => {
    const deck = mapToHubDeck(status, playerMode);
    if (!deck) return;

    const path = resolveTrackPath(status);
    if (path) push(deck, 'filepath', path);
    if (status.genre) push(deck, 'genre', status.genre);
    if (typeof status.currentBpm === 'number' && status.currentBpm > 0) {
      push(deck, 'bpm', status.currentBpm);
    }
    if (typeof status.externalMixerVolume === 'number') {
      push(deck, 'level', status.externalMixerVolume);
    }
    if (typeof status.playState === 'boolean') {
      push(deck, 'play', status.playState);
    }
    if (typeof status.trackLength === 'number' && status.trackLength > 0) {
      // Engine track length is typically seconds; hub time events use ms when VDJ-driven
      push(deck, 'time', status.trackLength * 1000);
    }
    scheduleBroadcast();
  };

  client.devices.on('connected', (info) => {
    const addr = info?.address || 'unknown';
    state.connected = true;
    state.vdjAddress = addr;
    state.djProvider = 'denon_engine';
    scheduleBroadcast();
    console.log(`[Denon] Device connected: ${addr}`);
  });

  client.devices.on('trackLoaded', (status) => {
    if (getConfig('debug_logging') === '1') {
      console.log(`[Denon] trackLoaded deck=${status.deck} ${status.title || ''}`);
    }
    applyStatus(status);
  });

  client.devices.on('nowPlaying', (status) => {
    applyStatus(status);
  });

  client.devices.on('stateChanged', (status) => {
    applyStatus(status);
  });

  client.devices.on('beatMessage', (beatData) => {
    if (!beatData?.decks?.length) return;
    for (let i = 0; i < beatData.deckCount && i < beatData.decks.length; i++) {
      const hubDeck = playerMode === 4 ? i + 1 : i + 1;
      if (hubDeck > 4) break;
      const d = beatData.decks[i];
      if (d.bpm > 0) push(hubDeck, 'bpm', d.bpm);
      if (typeof d.beat === 'number') push(hubDeck, 'beatpos', d.beat);
      if (typeof d.samples === 'number' && d.samples > 0) {
        // Rough ms estimate from sample position if BPM known
        const bpm = d.bpm || state.decks[hubDeck]?.bpm;
        if (bpm > 0) {
          const msPerBeat = 60000 / bpm;
          push(hubDeck, 'time', d.beat * msPerBeat);
        }
      }
    }
    scheduleBroadcast();
  });

  client.on('error', (err) => {
    console.error('[Denon] StageLinQ error:', err?.message || err);
  });

  client.on('listening', () => {
    console.log('[Denon] StageLinQ discovery active (LAN). Waiting for Engine OS players…');
  });

  await client.connect();
  started = true;
  state.djProvider = 'denon_engine';
}

async function stop() {
  if (!client) return;
  try {
    await client.disconnect();
  } catch (e) {
    console.warn('[Denon] disconnect:', e.message);
  }
  client = null;
  started = false;
}

function isStarted() {
  return started;
}

module.exports = {
  isDenonEngineActive,
  mapToHubDeck,
  start,
  stop,
  isStarted,
};
