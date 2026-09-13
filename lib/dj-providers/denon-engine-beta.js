'use strict';

/**
 * Denon DJ / Engine OS — beta via StageLinQ (community protocol).
 * Reference: https://github.com/chrisle/StageLinq
 *
 * Runtime: lib/denon-stagelinq-runtime.js (StageLinq npm package).
 */
module.exports = {
  id: 'denon_engine',
  label: 'Denon DJ (Engine OS)',
  status: 'beta',
  transport: 'stagelinq',
  referenceUrl: 'https://github.com/chrisle/StageLinq',
  supportedDevices: [
    'Denon SC6000 / SC6000M',
    'Denon SC5000 / SC5000M',
    'Denon Prime 4 / Prime 2 / Prime Go',
    'Denon X1850 / X1800 mixers',
    'Denon LC6000',
  ],
  capabilities: {
    decks: 4,
    beatSync: true,
    libraryImport: false,
    nowPlaying: true,
    buttonMaps: false,
    subscriptions: false,
    soundswitchId: false,
    satelliteForward: false,
    mixerFaders: true,
  },
  reservedConfigKeys: [
    'denon_stagelinq_enabled',
    'denon_discovery_interface',
    'denon_player_mode',
    'denon_download_library',
  ],
  notes:
    'Beta: enable StageLinQ in Config and restart the hub. LAN discovery via StageLinq; disables local OS2L while active. Engine Lighting on the player is separate from Thaluxis Art-Net/USB.',
};
