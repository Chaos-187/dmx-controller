'use strict';

/** Production VirtualDJ integration (runtime in os2l.js + vdj-parser.js). */
module.exports = {
  id: 'virtualdj',
  label: 'VirtualDJ',
  status: 'stable',
  transport: 'os2l',
  capabilities: {
    decks: 4,
    beatSync: true,
    libraryImport: true,
    nowPlaying: true,
    buttonMaps: true,
    subscriptions: true,
    soundswitchId: true,
    satelliteForward: true,
  },
  configKeys: [
    'hub_os2l_local',
    'os2l_port',
    'os2l_service_name',
    'vdj_db_path',
    'vdj_folder',
    'vdj_import_on_startup',
    'vdj_import_mode',
    'vdj_import_last_at',
    'vdj_import_source_mtime',
    'vdj_import_source_fingerprint',
    'vdj_import_last_xml_count',
    'vdj_import_last_hub_count',
    'vdj_import_last_merged',
    'subscription_frequency',
    'vdj_deck_count',
  ],
  notes: 'Default integration. OS2L TCP, library XML, and Thaluxis Satellite forwarding.',
};
