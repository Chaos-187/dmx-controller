'use strict';

/**
 * Serato DJ Pro — beta via serato-connect.
 * @see https://github.com/chrisle/serato-connect
 */
module.exports = {
  id: 'serato',
  label: 'Serato DJ Pro',
  status: 'beta',
  transport: 'serato-remote',
  referenceUrl: 'https://github.com/chrisle/serato-connect',
  supportedProducts: [
    'Serato DJ Pro (Windows / macOS)',
    'Live OSC link — same protocol as legacy Serato Remote (hub advertises on LAN; no iOS app)',
    'History/session polling (Serato 3 & 4) — track loads without Remote',
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
    'serato_integration_enabled',
    'serato_remote_enabled',
    'serato_history_poll',
    'serato_library_path',
    'serato_remote_port',
    'serato_peer_name',
  ],
  notes:
    'Beta: enable below and restart. Optional live OSC (legacy Remote protocol — not the discontinued Serato Remote iOS app): Serato DJ Pro must still offer Remote pairing on your version. History polling works without Remote for track loads; use both when Remote is available for playhead/BPM.',
};
