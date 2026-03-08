/**
 * Database Module — SQLite via better-sqlite3
 *
 * Tables:
 *   fixture_types   – reusable fixture profiles (channel layout, manufacturer, etc.)
 *   fixture_type_channels – individual channel definitions for each fixture type
 *   fixtures         – placed fixture instances with DMX universe/address
 */

const Database = require('better-sqlite3');
const path = require('path');

// In pkg mode, __dirname points to the read-only snapshot; use the exe directory instead
const APP_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DB_PATH = path.join(APP_DIR, 'dmx-controller.db');

let db;

// ─── Initialise ─────────────────────────────────────────────────────────────

function init() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger    TEXT    NOT NULL UNIQUE,
      label      TEXT    DEFAULT '',
      category   TEXT    DEFAULT 'custom',
      enabled    INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS fixture_types (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT    NOT NULL,
      manufacturer  TEXT    DEFAULT '',
      category      TEXT    DEFAULT 'other',
      channel_count INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT    DEFAULT (datetime('now')),
      updated_at    TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fixture_type_modes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      name            TEXT    NOT NULL DEFAULT 'Default',
      short_name      TEXT    DEFAULT '',
      channel_count   INTEGER NOT NULL DEFAULT 1,
      sort_order      INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS fixture_type_channels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      mode_id         INTEGER REFERENCES fixture_type_modes(id) ON DELETE CASCADE,
      channel_number  INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'dimmer',
      default_value   INTEGER DEFAULT 0,
      min_value       INTEGER DEFAULT 0,
      max_value       INTEGER DEFAULT 255,
      ranges          TEXT    DEFAULT NULL,
      UNIQUE(mode_id, channel_number)
    );

    CREATE TABLE IF NOT EXISTS fixtures (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE RESTRICT,
      universe        INTEGER NOT NULL DEFAULT 1,
      address         INTEGER NOT NULL,
      output_type     TEXT    NOT NULL DEFAULT 'artnet',
      invert_pan      INTEGER NOT NULL DEFAULT 0,
      invert_tilt     INTEGER NOT NULL DEFAULT 0,
      home_pan        INTEGER NOT NULL DEFAULT 128,
      home_tilt       INTEGER NOT NULL DEFAULT 128,
      notes           TEXT    DEFAULT '',
      created_at      TEXT    DEFAULT (datetime('now')),
      updated_at      TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS artnet_universes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      local_universe  INTEGER NOT NULL UNIQUE,
      label           TEXT    DEFAULT '',
      ip              TEXT    NOT NULL DEFAULT '255.255.255.255',
      port            INTEGER NOT NULL DEFAULT 6454,
      subnet          INTEGER NOT NULL DEFAULT 0,
      artnet_universe INTEGER NOT NULL DEFAULT 0,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tracks (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      filepath        TEXT    NOT NULL UNIQUE,
      filename        TEXT    DEFAULT '',
      file_size       INTEGER DEFAULT 0,
      flag            INTEGER DEFAULT 0,
      author          TEXT    DEFAULT '',
      title           TEXT    DEFAULT '',
      remix           TEXT    DEFAULT '',
      genre           TEXT    DEFAULT '',
      album           TEXT    DEFAULT '',
      year            TEXT    DEFAULT '',
      tag_flag        INTEGER DEFAULT 0,
      song_length     REAL    DEFAULT 0,
      bitrate         INTEGER DEFAULT 0,
      last_modified   INTEGER DEFAULT 0,
      first_seen      INTEGER DEFAULT 0,
      cover           TEXT    DEFAULT '',
      bpm             REAL    DEFAULT 0,
      key             TEXT    DEFAULT '',
      volume          REAL    DEFAULT 0,
      audio_sig       TEXT    DEFAULT '',
      beatgrid_pos    REAL    DEFAULT 0,
      automix_point   TEXT    DEFAULT '',
      poi_json        TEXT    DEFAULT '[]',
      netsearch       TEXT    DEFAULT '',
      source_type     TEXT    DEFAULT 'local',
      imported_at     TEXT    DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_author ON tracks(author);
    CREATE INDEX IF NOT EXISTS idx_tracks_title  ON tracks(title);
    CREATE INDEX IF NOT EXISTS idx_tracks_genre  ON tracks(genre);
    CREATE INDEX IF NOT EXISTS idx_tracks_bpm    ON tracks(bpm);

    CREATE TABLE IF NOT EXISTS fixture_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      color      TEXT    DEFAULT '#888',
      created_at TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS fixture_group_members (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id   INTEGER NOT NULL REFERENCES fixture_groups(id) ON DELETE CASCADE,
      fixture_id INTEGER NOT NULL REFERENCES fixtures(id) ON DELETE CASCADE,
      UNIQUE(group_id, fixture_id)
    );

    CREATE TABLE IF NOT EXISTS mover_presets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      positions   TEXT    NOT NULL DEFAULT '[]',
      sort_order  INTEGER DEFAULT 0,
      is_system   INTEGER DEFAULT 0,
      icon        TEXT    DEFAULT '',
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS os2l_button_maps (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      os2l_event  TEXT    NOT NULL DEFAULT 'btn',
      os2l_value  TEXT    NOT NULL DEFAULT '',
      action_type TEXT    NOT NULL DEFAULT 'blackout',
      action_data TEXT    DEFAULT '{}',
      toggle_mode TEXT    NOT NULL DEFAULT 'fire',
      enabled     INTEGER DEFAULT 1,
      sort_order  INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- Rig elements (trusses, stands, etc.) for 2D rig layout
    CREATE TABLE IF NOT EXISTS rig_elements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT    NOT NULL DEFAULT 'truss_h',
      label      TEXT    DEFAULT '',
      x          REAL    NOT NULL DEFAULT 0.5,
      y          REAL    NOT NULL DEFAULT 0.5,
      width      REAL    NOT NULL DEFAULT 0.4,
      height     REAL    NOT NULL DEFAULT 0.02,
      rotation   REAL    NOT NULL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now'))
    );

    -- Saved rig layouts (named snapshots of fixture positions + rigging elements)
    CREATE TABLE IF NOT EXISTS rig_layouts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT    NOT NULL,
      data       TEXT    NOT NULL DEFAULT '{}',
      is_active  INTEGER DEFAULT 0,
      created_at TEXT    DEFAULT (datetime('now')),
      updated_at TEXT    DEFAULT (datetime('now'))
    );

    -- Color wheel color maps (per fixture type)
    CREATE TABLE IF NOT EXISTS color_wheel_colors (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      dmx_start       INTEGER NOT NULL DEFAULT 0,
      dmx_end         INTEGER NOT NULL DEFAULT 0,
      color_hex       TEXT    NOT NULL DEFAULT '#FFFFFF',
      label           TEXT    DEFAULT '',
      sort_order      INTEGER DEFAULT 0
    );

    -- Gobo wheel slot maps (per fixture type)
    CREATE TABLE IF NOT EXISTS gobo_wheel_slots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      dmx_start       INTEGER NOT NULL DEFAULT 0,
      dmx_end         INTEGER NOT NULL DEFAULT 0,
      label           TEXT    DEFAULT '',
      sort_order      INTEGER DEFAULT 0
    );

    -- Effects library
    CREATE TABLE IF NOT EXISTS effects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'static',
      category        TEXT    DEFAULT 'color',
      fixture_target  TEXT    DEFAULT 'all',
      effect_data     TEXT    DEFAULT '{}',
      duration_beats  REAL    DEFAULT 4,
      created_at      TEXT    DEFAULT (datetime('now'))
    );

    -- Light sequences (linked to tracks)
    CREATE TABLE IF NOT EXISTS light_sequences (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      track_id        INTEGER DEFAULT NULL,
      bpm             REAL    DEFAULT 120,
      duration_ms     INTEGER DEFAULT 0,
      beat_offset_ms  REAL    DEFAULT 0,
      loop            INTEGER DEFAULT 0,
      created_at      TEXT    DEFAULT (datetime('now')),
      updated_at      TEXT    DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_light_sequences_track ON light_sequences(track_id);

    -- Sequence cues (individual blocks on the timeline)
    CREATE TABLE IF NOT EXISTS sequence_cues (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      sequence_id         INTEGER NOT NULL REFERENCES light_sequences(id) ON DELETE CASCADE,
      lane                INTEGER NOT NULL DEFAULT 0,
      start_ms            REAL    NOT NULL DEFAULT 0,
      duration_ms         REAL    NOT NULL DEFAULT 1000,
      cue_type            TEXT    NOT NULL DEFAULT 'static',
      fixture_id          INTEGER DEFAULT NULL,
      group_id            INTEGER DEFAULT NULL,
      channel_values      TEXT    DEFAULT '{}',
      end_channel_values  TEXT    DEFAULT NULL,
      effect_id           INTEGER DEFAULT NULL,
      effect_params       TEXT    DEFAULT '{}',
      color               TEXT    DEFAULT '#e94560',
      label               TEXT    DEFAULT '',
      sort_order          INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_sequence_cues_seq ON sequence_cues(sequence_id);

    -- Known USB DMX adapters with universe assignment
    CREATE TABLE IF NOT EXISTS usb_devices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      label           TEXT    NOT NULL DEFAULT '',
      source          TEXT    NOT NULL DEFAULT 'ftdi',
      vid             TEXT    DEFAULT NULL,
      pid             TEXT    DEFAULT NULL,
      serial_number   TEXT    DEFAULT '',
      description     TEXT    DEFAULT '',
      local_universe  INTEGER NOT NULL DEFAULT 1,
      auto_connect    INTEGER NOT NULL DEFAULT 1,
      refresh_rate    INTEGER NOT NULL DEFAULT 40,
      enabled         INTEGER NOT NULL DEFAULT 1,
      created_at      TEXT    DEFAULT (datetime('now'))
    );

    -- Static scenes (used when no sequence is running)
    CREATE TABLE IF NOT EXISTS static_scenes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      priority    INTEGER DEFAULT 0,
      is_default  INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS static_scene_entries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      scene_id        INTEGER NOT NULL REFERENCES static_scenes(id) ON DELETE CASCADE,
      fixture_id      INTEGER DEFAULT NULL,
      group_id        INTEGER DEFAULT NULL,
      channel_values  TEXT    DEFAULT '{}',
      effect_id       INTEGER DEFAULT NULL,
      effect_params   TEXT    DEFAULT '{}',
      label           TEXT    DEFAULT '',
      sort_order      INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_scene_entries_scene ON static_scene_entries(scene_id);

    -- Touch action grid buttons (configurable from index.html)
    CREATE TABLE IF NOT EXISTS touch_actions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      label       TEXT    NOT NULL DEFAULT '',
      icon        TEXT    DEFAULT '',
      action_type TEXT    NOT NULL DEFAULT 'color',
      action_data TEXT    DEFAULT '{}',
      color       TEXT    DEFAULT '#ffffff',
      text_color  TEXT    DEFAULT '#ffffff',
      grid_row    INTEGER DEFAULT 0,
      grid_col    INTEGER DEFAULT 0,
      grid_w      INTEGER DEFAULT 1,
      grid_h      INTEGER DEFAULT 1,
      sort_order  INTEGER DEFAULT 0,
      enabled     INTEGER DEFAULT 1,
      created_at  TEXT    DEFAULT (datetime('now'))
    );

    -- Waveform / energy analysis data per track
    CREATE TABLE IF NOT EXISTS track_analysis (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      track_id          INTEGER NOT NULL UNIQUE,
      waveform_peaks    TEXT    DEFAULT '[]',
      energy_levels     TEXT    DEFAULT '[]',
      beats             TEXT    DEFAULT '[]',
      sections          TEXT    DEFAULT '[]',
      sample_rate       INTEGER DEFAULT 0,
      channels          INTEGER DEFAULT 0,
      duration_ms       INTEGER DEFAULT 0,
      peak_count        INTEGER DEFAULT 0,
      analysis_version  INTEGER DEFAULT 1,
      analyzed_at       TEXT    DEFAULT (datetime('now')),
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );

    -- Sequence generation templates (saved presets)
    CREATE TABLE IF NOT EXISTS sequence_templates (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT    NOT NULL,
      palette           TEXT    DEFAULT 'random',
      genre             TEXT    DEFAULT 'auto',
      no_strobes        INTEGER DEFAULT 0,
      generator_config  TEXT    DEFAULT NULL,
      is_default        INTEGER DEFAULT 0,
      created_at        TEXT    DEFAULT (datetime('now'))
    );

    -- MIDI controller mappings (APC Mini / generic MIDI)
    CREATE TABLE IF NOT EXISTS midi_mappings (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT    NOT NULL,
      midi_type        TEXT    NOT NULL DEFAULT 'note',
      midi_number      INTEGER NOT NULL DEFAULT 0,
      midi_channel     INTEGER NOT NULL DEFAULT 0,
      action_type      TEXT    NOT NULL DEFAULT 'none',
      action_data      TEXT    DEFAULT '{}',
      toggle_mode      TEXT    NOT NULL DEFAULT 'momentary',
      led_color        INTEGER DEFAULT 0,
      led_active_color INTEGER DEFAULT 1,
      led_behavior     INTEGER DEFAULT 0,
      led_active_behavior INTEGER DEFAULT 0,
      enabled          INTEGER DEFAULT 1,
      sort_order       INTEGER DEFAULT 0,
      created_at       TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Migrate: add toggle_mode column if missing (existing databases)
  try {
    db.prepare("SELECT toggle_mode FROM os2l_button_maps LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE os2l_button_maps ADD COLUMN toggle_mode TEXT NOT NULL DEFAULT 'fire'");
    console.log('[DB] Migrated os2l_button_maps: added toggle_mode column');
  }

  // Migrate: add ranges column to fixture_type_channels if missing
  try {
    db.prepare("SELECT ranges FROM fixture_type_channels LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixture_type_channels ADD COLUMN ranges TEXT DEFAULT NULL");
    console.log('[DB] Migrated fixture_type_channels: added ranges column');
  }

  // Migrate: add sections column to track_analysis if missing
  try {
    db.prepare("SELECT sections FROM track_analysis LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE track_analysis ADD COLUMN sections TEXT DEFAULT '[]'");
    console.log('[DB] Migrated track_analysis: added sections column');
  }

  // Migrate: add cell column to fixture_type_channels if missing
  try {
    db.prepare("SELECT cell FROM fixture_type_channels LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixture_type_channels ADD COLUMN cell INTEGER DEFAULT NULL");
    console.log('[DB] Migrated fixture_type_channels: added cell column');
  }

  // Migrate: add invert column to fixture_type_channels if missing (legacy, no longer used)
  try {
    db.prepare("SELECT invert FROM fixture_type_channels LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixture_type_channels ADD COLUMN invert INTEGER DEFAULT 0");
    console.log('[DB] Migrated fixture_type_channels: added invert column');
  }

  // Migrate: add invert_pan and invert_tilt columns to fixtures if missing
  try {
    db.prepare("SELECT invert_pan FROM fixtures LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN invert_pan INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Migrated fixtures: added invert_pan column');
  }
  try {
    db.prepare("SELECT invert_tilt FROM fixtures LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN invert_tilt INTEGER NOT NULL DEFAULT 0");
    console.log('[DB] Migrated fixtures: added invert_tilt column');
  }

  // Migrate: add home_pan and home_tilt columns to fixtures if missing
  try {
    db.prepare("SELECT home_pan FROM fixtures LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN home_pan INTEGER NOT NULL DEFAULT 128");
    console.log('[DB] Migrated fixtures: added home_pan column');
  }
  try {
    db.prepare("SELECT home_tilt FROM fixtures LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN home_tilt INTEGER NOT NULL DEFAULT 128");
    console.log('[DB] Migrated fixtures: added home_tilt column');
  }

  // Migrate: add cell column to sequence_cues if missing
  try {
    db.prepare("SELECT cell FROM sequence_cues LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE sequence_cues ADD COLUMN cell INTEGER DEFAULT NULL");
    console.log('[DB] Migrated sequence_cues: added cell column');
  }

  // Migrate: add track column to sequence_cues if missing
  // (sub-track type: 'color', 'fx', 'move')
  try {
    db.prepare("SELECT track FROM sequence_cues LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE sequence_cues ADD COLUMN track TEXT DEFAULT NULL");
    // Backfill existing cues based on cue_type
    db.exec("UPDATE sequence_cues SET track='move' WHERE cue_type='movement'");
    db.exec("UPDATE sequence_cues SET track='fx' WHERE cue_type='effect'");
    db.exec("UPDATE sequence_cues SET track='color' WHERE track IS NULL");
    console.log('[DB] Migrated sequence_cues: added track column');
  }

  // Migrate: consolidate rig-wide effect cues (label starts with ⟷) into
  // single fixture_id=0 master cues and mark as track='fx-rig'.
  // Old generator emitted one cue per fixture for rig effects; new generator
  // emits a single fixture_id=0 cue. Deduplicate by keeping one per group.
  {
    const rigCues = db.prepare(
      "SELECT * FROM sequence_cues WHERE cue_type='effect' AND label LIKE '⟷%'"
    ).all();
    if (rigCues.length > 0) {
      // Group by sequence_id + start_ms + effect_id (same rig placement)
      const groups = new Map();
      for (const c of rigCues) {
        const key = `${c.sequence_id}:${c.start_ms}:${c.effect_id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      const updateStmt = db.prepare("UPDATE sequence_cues SET fixture_id=0, track='fx-rig' WHERE id=?");
      const deleteStmt = db.prepare("DELETE FROM sequence_cues WHERE id=?");
      const consolidateTx = db.transaction(() => {
        for (const [, group] of groups) {
          // Keep the first cue, update it to master, delete the rest
          updateStmt.run(group[0].id);
          for (let i = 1; i < group.length; i++) {
            deleteStmt.run(group[i].id);
          }
        }
      });
      consolidateTx();
      console.log(`[DB] Consolidated ${rigCues.length} rig-wide cues into ${groups.size} master cues`);
    }
  }

  // Migrate: add fixture_target column to effects if missing
  try {
    db.prepare("SELECT fixture_target FROM effects LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE effects ADD COLUMN fixture_target TEXT DEFAULT 'all'");
    console.log('[DB] Migrated effects: added fixture_target column');
  }

  // Migrate: add rig position columns to fixtures if missing
  try {
    db.prepare("SELECT rig_x FROM fixtures LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN rig_x REAL DEFAULT 0.5");
    db.exec("ALTER TABLE fixtures ADD COLUMN rig_y REAL DEFAULT 0.5");
    db.exec("ALTER TABLE fixtures ADD COLUMN rig_order INTEGER DEFAULT 0");
    // Auto-assign rig_order based on existing address ordering
    const existingFixtures = db.prepare('SELECT id FROM fixtures ORDER BY universe, address').all();
    const updateOrder = db.prepare('UPDATE fixtures SET rig_order = ? WHERE id = ?');
    const assignTx = db.transaction(() => {
      existingFixtures.forEach((f, i) => updateOrder.run(i, f.id));
    });
    assignTx();
    console.log('[DB] Migrated fixtures: added rig_x, rig_y, rig_order columns');
  }

  // Migrate: add is_system and icon columns to mover_presets if missing
  try {
    db.prepare("SELECT is_system FROM mover_presets LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE mover_presets ADD COLUMN is_system INTEGER DEFAULT 0");
    db.exec("ALTER TABLE mover_presets ADD COLUMN icon TEXT DEFAULT ''");
    console.log('[DB] Migrated mover_presets: added is_system, icon columns');
  }

  // Migrate: add is_active column to rig_layouts if missing
  try {
    db.prepare("SELECT is_active FROM rig_layouts LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE rig_layouts ADD COLUMN is_active INTEGER DEFAULT 0");
    console.log('[DB] Migrated rig_layouts: added is_active column');
  }

  // Migrate: add stem_energy column to track_analysis if missing
  try {
    db.prepare("SELECT stem_energy FROM track_analysis LIMIT 1").get();
  } catch (e) {
    db.exec("ALTER TABLE track_analysis ADD COLUMN stem_energy TEXT DEFAULT NULL");
    console.log('[DB] Migrated track_analysis: added stem_energy column');
  }

  // Migrate: color_wheel_colors from single dmx_value to dmx_start/dmx_end range
  // Check if old dmx_value column still exists (needs table recreation)
  let cwNeedsMigration = false;
  try {
    db.prepare("SELECT dmx_value FROM color_wheel_colors LIMIT 1").get();
    cwNeedsMigration = true;
  } catch (e) { /* dmx_value gone — already migrated */ }
  if (cwNeedsMigration) {
    db.exec(`
      CREATE TABLE color_wheel_colors_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
        dmx_start       INTEGER NOT NULL DEFAULT 0,
        dmx_end         INTEGER NOT NULL DEFAULT 0,
        color_hex       TEXT    NOT NULL DEFAULT '#FFFFFF',
        label           TEXT    DEFAULT '',
        sort_order      INTEGER DEFAULT 0
      );
      INSERT INTO color_wheel_colors_new (id, fixture_type_id, dmx_start, dmx_end, color_hex, label, sort_order)
        SELECT id, fixture_type_id, dmx_value, dmx_value, color_hex, label, sort_order FROM color_wheel_colors;
      DROP TABLE color_wheel_colors;
      ALTER TABLE color_wheel_colors_new RENAME TO color_wheel_colors;
    `);
    console.log('[DB] Migrated color_wheel_colors: replaced dmx_value with dmx_start/dmx_end');
  }

  // Migrate: APC mini mk2 — remap old APC mini v1 LED color values and note numbers
  // Old v1 colors: 0=off, 1=green, 2=green blink, 3=red, 4=red blink, 5=yellow, 6=yellow blink
  // New mk2 palette: 0=off, 5=red, 13=yellow, 21=green (velocity index into 128-color palette)
  // Old v1 notes: bottom=64-71, right=82-89, shift=98
  // New mk2 notes: bottom=100-107 (0x64-0x6B), right=112-119 (0x70-0x77), shift=122 (0x7A)
  const midiMk2Migrated = getConfig('midi_mk2_migrated');
  if (!midiMk2Migrated) {
    const midiCount = db.prepare('SELECT COUNT(*) as c FROM midi_mappings').get().c;
    if (midiCount > 0) {
      // Remap old color values to mk2 palette indices
      const colorMap = { 0: 0, 1: 21, 2: 21, 3: 5, 4: 5, 5: 13, 6: 13 };
      const allMidi = db.prepare('SELECT id, midi_number, led_color, led_active_color FROM midi_mappings').all();
      const updateColor = db.prepare('UPDATE midi_mappings SET led_color = ?, led_active_color = ? WHERE id = ?');
      const updateNote  = db.prepare('UPDATE midi_mappings SET midi_number = ? WHERE id = ?');
      const migrateTx = db.transaction(() => {
        for (const m of allMidi) {
          // Only remap if values are in the old 0-6 range
          const oldLed = m.led_color;
          const oldActive = m.led_active_color;
          if (oldLed >= 0 && oldLed <= 6 && colorMap[oldLed] !== undefined) {
            const newLed = colorMap[oldLed];
            const newActive = (oldActive >= 0 && oldActive <= 6) ? (colorMap[oldActive] || 0) : oldActive;
            updateColor.run(newLed, newActive, m.id);
          }
          // Remap old note numbers: bottom row 64-71 → 100-107, right col 82-89 → 112-119
          if (m.midi_number >= 64 && m.midi_number <= 71) {
            updateNote.run(m.midi_number - 64 + 100, m.id);  // 64→100, 65→101, ...
          } else if (m.midi_number >= 82 && m.midi_number <= 89) {
            updateNote.run(m.midi_number - 82 + 112, m.id);  // 82→112, 83→113, ...
          } else if (m.midi_number === 98) {
            updateNote.run(122, m.id);  // shift
          }
        }
      });
      migrateTx();
      console.log(`[DB] Migrated ${allMidi.length} MIDI mappings to APC mini mk2 format (colors + note numbers)`);
    }
    setConfig('midi_mk2_migrated', '1');
  }

  // Migrate: add led_behavior columns to midi_mappings
  try {
    db.prepare('SELECT led_behavior FROM midi_mappings LIMIT 1').get();
  } catch (e) {
    db.exec("ALTER TABLE midi_mappings ADD COLUMN led_behavior INTEGER DEFAULT 0");
    db.exec("ALTER TABLE midi_mappings ADD COLUMN led_active_behavior INTEGER DEFAULT 0");
    console.log('[DB] Migrated midi_mappings: added led_behavior and led_active_behavior columns');
  }

  // Migrate: add page column to midi_mappings (0 = global/all pages, 1+ = specific page)
  try {
    db.prepare('SELECT page FROM midi_mappings LIMIT 1').get();
  } catch (e) {
    db.exec("ALTER TABLE midi_mappings ADD COLUMN page INTEGER DEFAULT 0");
    console.log('[DB] Migrated midi_mappings: added page column');
  }

  // Migrate: add beat_offset_ms column to light_sequences
  try {
    db.prepare('SELECT beat_offset_ms FROM light_sequences LIMIT 1').get();
  } catch (e) {
    db.exec("ALTER TABLE light_sequences ADD COLUMN beat_offset_ms REAL DEFAULT 0");
    console.log('[DB] Migrated light_sequences: added beat_offset_ms column');
  }

  // Migrate: fixture_type_modes — create default modes for existing fixture types
  // and link channels and fixtures to their modes
  migrateToModes();

  // Seed subscriptions if empty
  const subCount = db.prepare('SELECT COUNT(*) as c FROM subscriptions').get().c;
  if (subCount === 0) {
    seedSubscriptions();
  }

  // Seed default config
  const cfgCount = db.prepare('SELECT COUNT(*) as c FROM config').get().c;
  if (cfgCount === 0) {
    const ins = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
    const seedCfg = db.transaction(() => {
      // OS2L / VDJ
      ins.run('subscription_frequency', '25');
      ins.run('os2l_port', '8787');
      ins.run('os2l_service_name', 'DMX-Controller');
      ins.run('web_port', '80');
      ins.run('vdj_deck_count', '4');
      ins.run('vdj_db_path', '');
      ins.run('vdj_folder', '');
      ins.run('vdj_auto_meta', '0');
      // DMX USB
      ins.run('dmx_enabled', '0');
      ins.run('dmx_port', '');
      ins.run('dmx_driver', 'enttec-open-dmx-usb');
      ins.run('dmx_refresh_rate', '40');
      // Art-Net
      ins.run('artnet_enabled', '0');
      ins.run('artnet_ip', '255.255.255.255');
      ins.run('artnet_port', '6454');
      ins.run('artnet_universe', '0');
      ins.run('artnet_subnet', '0');
      ins.run('artnet_refresh_rate', '44');
    });
    seedCfg();
  }

  // Seed some common fixture type templates if DB is empty
  const count = db.prepare('SELECT COUNT(*) as c FROM fixture_types').get().c;
  if (count === 0) {
    seedDefaults();
  }

  // Seed default effects if empty
  const effectCount = db.prepare('SELECT COUNT(*) as c FROM effects').get().c;
  if (effectCount === 0) {
    seedDefaultEffects();
  }

  // Always run migration to add new effect types to existing databases
  seedNewEffectsV2();
  seedNewEffectsV3();
  seedNewEffectsV4();

  // Ensure fixture_target is correct for all effects (covers fresh DBs where migration didn't backfill)
  // Color-only effects target fixtures with color channels
  db.exec("UPDATE effects SET fixture_target = 'color' WHERE type IN ('pulse','rainbow','strobe','color_fade','sparkle','color_wave','fire')");
  // chase/comet/scanner/buildup work on ALL fixtures (virtual cells via channels_per_cell heuristic)
  db.exec("UPDATE effects SET fixture_target = 'all' WHERE type IN ('chase','comet','scanner','buildup')");
  // Only truly multicell-specific effects are restricted
  db.exec("UPDATE effects SET fixture_target = 'multicell' WHERE fixture_target = 'all' AND type IN ('segments','ripple','cell_strobe','gradient')");
  db.exec("UPDATE effects SET fixture_target = 'moving_head' WHERE fixture_target = 'all' AND type IN ('pan_sweep','tilt_sweep','circle','figure_eight','random_move','fan','nod')");
  // Rig-wide spatial effects target all fixtures with color channels
  db.exec("UPDATE effects SET fixture_target = 'rig' WHERE type IN ('rig_chase','rig_color_wave','rig_sweep','rig_alternate','rig_converge','rig_rainbow')");

  // Seed default generator config if missing
  seedDefaultGeneratorConfig();

  // Seed default mover presets from hardcoded positions if table is empty
  seedDefaultMoverPresets();

  // Migration: add 60W Spot Moving Head if not present
  const has60wSpot = db.prepare("SELECT COUNT(*) as c FROM fixture_types WHERE name = 'Generic 60W Spot Moving Head'").get().c;
  if (has60wSpot === 0) {
    createFixtureType({
      name: 'Generic 60W Spot Moving Head',
      manufacturer: 'Generic',
      category: 'moving_head',
      channels: [
        { channel_number: 1, name: 'Pan', type: 'pan', default_value: 128 },
        { channel_number: 2, name: 'Pan Fine', type: 'pan_fine', default_value: 0 },
        { channel_number: 3, name: 'Tilt', type: 'tilt', default_value: 128 },
        { channel_number: 4, name: 'Tilt Fine', type: 'tilt_fine', default_value: 0 },
        { channel_number: 5, name: 'Color Wheel', type: 'color_wheel', default_value: 0,
          ranges: [
            { min: 0, max: 9, label: 'No function', type: 'other' },
            { min: 10, max: 163, label: 'Color effects', type: 'color_wheel' },
            { min: 164, max: 210, label: 'CCW flow', type: 'macro' },
            { min: 211, max: 255, label: 'CW flow', type: 'macro' },
          ] },
        { channel_number: 6, name: 'Gobo', type: 'gobo', default_value: 0,
          ranges: [
            { min: 0, max: 9, label: 'No function', type: 'other' },
            { min: 10, max: 79, label: 'Gobo effects', type: 'gobo' },
            { min: 80, max: 149, label: 'Bouncing', type: 'gobo' },
            { min: 150, max: 200, label: 'CCW rotation', type: 'macro' },
            { min: 201, max: 255, label: 'CW water wave', type: 'macro' },
          ] },
        { channel_number: 7, name: 'Strobe', type: 'strobe', default_value: 0 },
        { channel_number: 8, name: 'Dimmer', type: 'dimmer', default_value: 0 },
        { channel_number: 9, name: 'Speed', type: 'speed', default_value: 0 },
        { channel_number: 10, name: 'Macro', type: 'macro', default_value: 0,
          ranges: [
            { min: 0, max: 50, label: 'No function', type: 'other' },
            { min: 51, max: 151, label: 'Fast moving', type: 'macro' },
            { min: 152, max: 255, label: 'Sound control', type: 'macro' },
          ] },
        { channel_number: 11, name: 'Reset', type: 'other', default_value: 0,
          ranges: [
            { min: 0, max: 254, label: 'No function', type: 'other' },
            { min: 255, max: 255, label: 'Reset', type: 'other' },
          ] },
      ],
    });
    console.log('[DB] Added Generic 60W Spot Moving Head fixture type');
  }

  // Seed default color wheel map for 60W Spot Moving Head
  seedDefaultColorWheelMap();

  console.log(`[DB] Opened ${DB_PATH}  (${subCount > 0 ? subCount + ' subscriptions' : 'seeded subs'}, ${count > 0 ? count + ' fixture types' : 'seeded defaults'}, ${effectCount > 0 ? effectCount + ' effects' : 'seeded effects'})`);
  return db;
}

// ─── Seed Default Effects ────────────────────────────────────────────────────

function seedDefaultEffects() {
  const ins = db.prepare(
    'INSERT INTO effects (name, type, category, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?)'
  );
  const seed = db.transaction(() => {
    ins.run('Slow Pulse', 'pulse', 'color', JSON.stringify({ frequency: 0.5 }), 4);
    ins.run('Fast Pulse', 'pulse', 'color', JSON.stringify({ frequency: 2 }), 2);
    ins.run('Heartbeat Pulse', 'pulse', 'color', JSON.stringify({ frequency: 1.2 }), 4);
    ins.run('Rainbow Cycle', 'rainbow', 'color', JSON.stringify({ cycles: 1 }), 8);
    ins.run('Fast Rainbow', 'rainbow', 'color', JSON.stringify({ cycles: 4 }), 4);
    ins.run('Double Rainbow', 'rainbow', 'color', JSON.stringify({ cycles: 2 }), 8);
    ins.run('Slow Strobe', 'strobe', 'intensity', JSON.stringify({ frequency: 4 }), 4);
    ins.run('Medium Strobe', 'strobe', 'intensity', JSON.stringify({ frequency: 10 }), 2);
    ins.run('Fast Strobe', 'strobe', 'intensity', JSON.stringify({ frequency: 20 }), 1);
    ins.run('Police Strobe', 'strobe', 'intensity', JSON.stringify({ frequency: 8 }), 4);
    ins.run('Red to Blue Fade', 'color_fade', 'color', JSON.stringify({ start_color: { red: 255, green: 0, blue: 0 }, end_color: { red: 0, green: 0, blue: 255 } }), 8);
    ins.run('Blue to Green Fade', 'color_fade', 'color', JSON.stringify({ start_color: { red: 0, green: 0, blue: 255 }, end_color: { red: 0, green: 255, blue: 0 } }), 8);
    ins.run('Warm to Cool Fade', 'color_fade', 'color', JSON.stringify({ start_color: { red: 255, green: 100, blue: 0 }, end_color: { red: 0, green: 100, blue: 255 } }), 8);
    ins.run('Sunset Fade', 'color_fade', 'color', JSON.stringify({ start_color: { red: 255, green: 60, blue: 0 }, end_color: { red: 128, green: 0, blue: 255 } }), 8);
    ins.run('White Flash', 'pulse', 'intensity', JSON.stringify({ frequency: 1 }), 1);
  });
  seed();
  console.log('[DB] Seeded 15 default effects');
}

// ─── Seed New Effects (v2 migration — adds missing effects to existing DBs) ─

function seedNewEffectsV2() {
  const existing = new Set(db.prepare('SELECT name FROM effects').all().map(r => r.name));
  const ins = db.prepare(
    'INSERT INTO effects (name, type, category, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?)'
  );
  const J = JSON.stringify;
  const allNew = [
    // ── Chase effects ───────────────────────────────────────────────────
    ['Left Chase',        'chase', 'movement', J({ direction:'left',    width:3, tail:5, speed:1 }), 4],
    ['Right Chase',       'chase', 'movement', J({ direction:'right',   width:3, tail:5, speed:1 }), 4],
    ['Bounce Chase',      'chase', 'movement', J({ direction:'bounce',  width:3, tail:5, speed:1 }), 4],
    ['Center Out Chase',  'chase', 'movement', J({ direction:'center',  width:3, tail:3, speed:1 }), 4],
    ['Outside In Chase',  'chase', 'movement', J({ direction:'outside', width:3, tail:3, speed:1 }), 4],
    ['Fast Chase',        'chase', 'movement', J({ direction:'left',    width:2, tail:3, speed:4 }), 2],
    ['Wide Chase',        'chase', 'movement', J({ direction:'left',    width:10,tail:8, speed:0.5 }), 8],
    ['Theater Chase',     'chase', 'movement', J({ direction:'left',    width:1, tail:0, speed:2, gap:3 }), 4],
    // ── Comet effects ───────────────────────────────────────────────────
    ['Comet Left',        'comet', 'movement', J({ direction:'left',  tail:10, speed:1 }), 4],
    ['Comet Right',       'comet', 'movement', J({ direction:'right', tail:10, speed:1 }), 4],
    ['Fast Comet',        'comet', 'movement', J({ direction:'left',  tail:6,  speed:3 }), 2],
    // ── Scanner effects ─────────────────────────────────────────────────
    ['Scanner',           'scanner', 'movement', J({ width:1, tail:5, speed:1 }), 4],
    ['Fast Scanner',      'scanner', 'movement', J({ width:1, tail:3, speed:4 }), 2],
    ['Wide Scanner',      'scanner', 'movement', J({ width:5, tail:8, speed:0.5 }), 8],
    // ── Sparkle effects ─────────────────────────────────────────────────
    ['Sparkle',           'sparkle', 'color', J({ density:0.1, fade_speed:6 }), 4],
    ['Heavy Sparkle',     'sparkle', 'color', J({ density:0.3, fade_speed:4 }), 4],
    ['Twinkle',           'sparkle', 'color', J({ density:0.05, fade_speed:2 }), 8],
    // ── Color Wave effects ──────────────────────────────────────────────
    ['Rainbow Wave',      'color_wave', 'color', J({ wavelength:20, speed:1 }), 8],
    ['Short Rainbow Wave','color_wave', 'color', J({ wavelength:8,  speed:2 }), 4],
    ['Slow Color Wave',   'color_wave', 'color', J({ wavelength:30, speed:0.5 }), 16],
    // ── Fire effects ────────────────────────────────────────────────────
    ['Fire',              'fire', 'color', J({ intensity:0.8, cooling:0.3 }), 4],
    ['Intense Fire',      'fire', 'color', J({ intensity:1.0, cooling:0.2 }), 4],
    ['Campfire',          'fire', 'color', J({ intensity:0.5, cooling:0.5 }), 8],
    // ── Buildup effects ─────────────────────────────────────────────────
    ['Left Buildup',      'buildup', 'intensity', J({ direction:'left' }), 8],
    ['Right Buildup',     'buildup', 'intensity', J({ direction:'right' }), 8],
    ['Center Buildup',    'buildup', 'intensity', J({ direction:'center' }), 8],
    // ── Additional basic effects ────────────────────────────────────────
    ['Gentle Pulse',      'pulse', 'color', J({ frequency:0.25 }), 8],
    ['Breathing',         'pulse', 'color', J({ frequency:0.15 }), 16],
    ['Quick Flash',       'pulse', 'intensity', J({ frequency:4 }), 1],
    ['Green to Purple',   'color_fade', 'color', J({ start_color:{red:0,green:255,blue:0}, end_color:{red:128,green:0,blue:255} }), 8],
    ['Cyan to Magenta',   'color_fade', 'color', J({ start_color:{red:0,green:255,blue:255}, end_color:{red:255,green:0,blue:255} }), 8],
    ['Fire Fade',         'color_fade', 'color', J({ start_color:{red:255,green:80,blue:0}, end_color:{red:255,green:200,blue:0} }), 4],
    ['Ice Fade',          'color_fade', 'color', J({ start_color:{red:0,green:100,blue:255}, end_color:{red:200,green:240,blue:255} }), 4],
    ['Triple Rainbow',    'rainbow', 'color', J({ cycles:3 }), 8],
    ['Lightning Strobe',  'strobe', 'intensity', J({ frequency:15 }), 1],
    ['Blinder',           'pulse', 'intensity', J({ frequency:0.5 }), 2],
  ];

  let added = 0;
  const tx = db.transaction(() => {
    for (const [name, type, cat, data, beats] of allNew) {
      if (!existing.has(name)) {
        ins.run(name, type, cat, data, beats);
        added++;
      }
    }
  });
  tx();
  if (added > 0) console.log(`[DB] Added ${added} new effects (v2 migration)`);
}

// ─── Seed V3: Movement Effects for Movers & Multicell-specific Effects ────

function seedNewEffectsV3() {
  const existing = new Set(db.prepare('SELECT name FROM effects').all().map(r => r.name));
  const ins = db.prepare(
    'INSERT INTO effects (name, type, category, fixture_target, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const J = JSON.stringify;
  const allNew = [
    // ── Moving Head effects (pan/tilt) ──────────────────────────────────
    ['Pan Sweep',         'pan_sweep',    'movement', 'moving_head', J({ speed:1, range:1.0 }), 4],
    ['Fast Pan Sweep',    'pan_sweep',    'movement', 'moving_head', J({ speed:4, range:1.0 }), 2],
    ['Narrow Pan Sweep',  'pan_sweep',    'movement', 'moving_head', J({ speed:1, range:0.3 }), 4],
    ['Tilt Sweep',        'tilt_sweep',   'movement', 'moving_head', J({ speed:1, range:1.0 }), 4],
    ['Fast Tilt Sweep',   'tilt_sweep',   'movement', 'moving_head', J({ speed:4, range:1.0 }), 2],
    ['Narrow Tilt Sweep', 'tilt_sweep',   'movement', 'moving_head', J({ speed:1, range:0.3 }), 4],
    ['Circle',            'circle',       'movement', 'moving_head', J({ speed:1, size:0.5 }), 4],
    ['Fast Circle',       'circle',       'movement', 'moving_head', J({ speed:3, size:0.5 }), 2],
    ['Small Circle',      'circle',       'movement', 'moving_head', J({ speed:1, size:0.2 }), 4],
    ['Large Circle',      'circle',       'movement', 'moving_head', J({ speed:0.5, size:0.8 }), 8],
    ['Figure Eight',      'figure_eight', 'movement', 'moving_head', J({ speed:1, size:0.5 }), 8],
    ['Fast Figure Eight', 'figure_eight', 'movement', 'moving_head', J({ speed:2, size:0.5 }), 4],
    ['Random Movement',   'random_move',  'movement', 'moving_head', J({ speed:1, range:0.5, smoothing:0.3 }), 8],
    ['Slow Random',       'random_move',  'movement', 'moving_head', J({ speed:0.3, range:0.3, smoothing:0.5 }), 16],
    ['Fan Out',           'fan',          'movement', 'moving_head', J({ speed:0.5, spread:1.0 }), 8],
    ['Fan Narrow',        'fan',          'movement', 'moving_head', J({ speed:0.5, spread:0.3 }), 8],
    ['Nod',               'nod',          'movement', 'moving_head', J({ speed:2, range:0.3, axis:'tilt' }), 2],
    ['Shake',             'nod',          'movement', 'moving_head', J({ speed:4, range:0.15, axis:'pan' }), 1],

    // ── Multicell-specific effects ──────────────────────────────────────
    ['Pixel Segments',    'segments',     'color', 'multicell', J({ segment_size:2, offset_speed:1 }), 4],
    ['Fast Segments',     'segments',     'color', 'multicell', J({ segment_size:3, offset_speed:4 }), 2],
    ['Ripple Out',        'ripple',       'color', 'multicell', J({ speed:1, width:3, decay:0.7 }), 4],
    ['Fast Ripple',       'ripple',       'color', 'multicell', J({ speed:3, width:2, decay:0.5 }), 2],
    ['Cell Strobe',       'cell_strobe',  'intensity', 'multicell', J({ frequency:8, pattern:'sequential' }), 4],
    ['Random Cell Strobe','cell_strobe',  'intensity', 'multicell', J({ frequency:12, pattern:'random' }), 2],
    ['Gradient Sweep',    'gradient',     'color', 'multicell', J({ speed:1, colors:['#ff0000','#0000ff'] }), 8],
    ['RGB Gradient',      'gradient',     'color', 'multicell', J({ speed:0.5, colors:['#ff0000','#00ff00','#0000ff'] }), 8],

    // ── Update existing multicell effects with fixture_target ───────────
    // (these are handled by the migration backfill, but ensure new installs get it right)
  ];

  let added = 0;
  const tx = db.transaction(() => {
    for (const [name, type, cat, target, data, beats] of allNew) {
      if (!existing.has(name)) {
        ins.run(name, type, cat, target, data, beats);
        added++;
      }
    }
  });
  tx();
  if (added > 0) console.log(`[DB] Added ${added} new effects (v3 migration — movers & multicell)`);
}

// ─── Seed V4: Rig-Wide Spatial Effects ──────────────────────────────────────

function seedNewEffectsV4() {
  const existing = new Set(db.prepare('SELECT name FROM effects').all().map(r => r.name));
  const ins = db.prepare(
    'INSERT INTO effects (name, type, category, fixture_target, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const J = JSON.stringify;
  const allNew = [
    // ── Rig Chase: color chase across all fixtures by position ──────────
    ['Rig Chase L→R',     'rig_chase',      'color', 'rig', J({ direction:'left_right',  speed:1, width:0.25, tail:0.2 }), 4],
    ['Rig Chase R→L',     'rig_chase',      'color', 'rig', J({ direction:'right_left',  speed:1, width:0.25, tail:0.2 }), 4],
    ['Rig Chase Bounce',  'rig_chase',      'color', 'rig', J({ direction:'bounce',      speed:1, width:0.25, tail:0.2 }), 8],
    ['Rig Chase T→B',     'rig_chase',      'color', 'rig', J({ direction:'top_bottom',  speed:1, width:0.3,  tail:0.2 }), 4],
    ['Rig Chase B→T',     'rig_chase',      'color', 'rig', J({ direction:'bottom_top',  speed:1, width:0.3,  tail:0.2 }), 4],
    ['Rig Fast Chase',    'rig_chase',      'color', 'rig', J({ direction:'left_right',  speed:4, width:0.15, tail:0.1 }), 2],
    ['Rig Wide Chase',    'rig_chase',      'color', 'rig', J({ direction:'left_right',  speed:0.5, width:0.4, tail:0.3 }), 8],

    // ── Rig Color Wave: hue gradient that moves across the rig ─────────
    ['Rig Color Wave L→R','rig_color_wave', 'color', 'rig', J({ direction:'left_right',  speed:1, wavelength:1.0 }), 8],
    ['Rig Color Wave R→L','rig_color_wave', 'color', 'rig', J({ direction:'right_left',  speed:1, wavelength:1.0 }), 8],
    ['Rig Color Wave T→B','rig_color_wave', 'color', 'rig', J({ direction:'top_bottom',  speed:1, wavelength:1.0 }), 8],
    ['Rig Fast Wave',     'rig_color_wave', 'color', 'rig', J({ direction:'left_right',  speed:3, wavelength:0.5 }), 4],

    // ── Rig Sweep: spotlight wash across the rig ───────────────────────
    ['Rig Sweep L→R',     'rig_sweep',      'intensity', 'rig', J({ direction:'left_right', speed:1, width:0.25 }), 4],
    ['Rig Sweep R→L',     'rig_sweep',      'intensity', 'rig', J({ direction:'right_left', speed:1, width:0.25 }), 4],
    ['Rig Sweep Bounce',  'rig_sweep',      'intensity', 'rig', J({ direction:'bounce',     speed:1, width:0.25 }), 8],
    ['Rig Sweep T→B',     'rig_sweep',      'intensity', 'rig', J({ direction:'top_bottom', speed:1, width:0.3  }), 4],
    ['Rig Wide Sweep',    'rig_sweep',      'intensity', 'rig', J({ direction:'left_right', speed:0.5, width:0.4 }), 8],

    // ── Rig Alternate: even/odd fixture split ──────────────────────────
    ['Rig Alternate',      'rig_alternate',  'color', 'rig', J({ speed:1 }), 4],
    ['Rig Fast Alternate', 'rig_alternate',  'color', 'rig', J({ speed:4 }), 2],

    // ── Rig Converge/Diverge: edges↔center wash ───────────────────────
    ['Rig Converge',       'rig_converge',   'color', 'rig', J({ mode:'converge', speed:1, width:0.2 }), 4],
    ['Rig Diverge',        'rig_converge',   'color', 'rig', J({ mode:'diverge',  speed:1, width:0.2 }), 4],
    ['Rig Converge T→B',  'rig_converge',   'color', 'rig', J({ mode:'converge', speed:1, width:0.25, direction:'top_bottom' }), 4],

    // ── Rig Rainbow: rainbow gradient spread across the rig ────────────
    ['Rig Rainbow',        'rig_rainbow',    'color', 'rig', J({ speed:0.5, spread:1.0, direction:'left_right' }), 8],
    ['Rig Rainbow Fast',   'rig_rainbow',    'color', 'rig', J({ speed:2,   spread:1.0, direction:'left_right' }), 4],
    ['Rig Rainbow T→B',   'rig_rainbow',    'color', 'rig', J({ speed:0.5, spread:1.0, direction:'top_bottom' }), 8],
  ];

  let added = 0;
  const tx = db.transaction(() => {
    for (const [name, type, cat, target, data, beats] of allNew) {
      if (!existing.has(name)) {
        ins.run(name, type, cat, target, data, beats);
        added++;
      }
    }
  });
  tx();
  if (added > 0) console.log(`[DB] Added ${added} new effects (v4 migration — rig-wide spatial)`);
}

// ─── LED Bar Fixture Type Helper ────────────────────────────────────────────

/**
 * Create a multi-cell LED bar fixture type with a repeating per-cell channel pattern.
 * @param {Object} opts
 * @param {string}   opts.name           - Fixture type name (default: "LED Bar <n> Cell")
 * @param {string}   opts.manufacturer   - Manufacturer (default: "Generic")
 * @param {number}   opts.cellCount      - Number of cells (required)
 * @param {string[]} opts.channelPattern - Channel types per cell (default: ['red','green','blue'])
 */
function createLedBarFixtureType({ name, manufacturer, cellCount, channelPattern }) {
  if (!cellCount || cellCount < 1) throw new Error('cellCount is required and must be >= 1');
  const pattern = channelPattern || ['red', 'green', 'blue'];
  const channels = [];
  for (let cell = 1; cell <= cellCount; cell++) {
    for (const type of pattern) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      channels.push({ name: `Cell ${cell} ${label}`, type, default_value: 0, cell });
    }
  }
  return createFixtureType({
    name: name || `LED Bar ${cellCount} Cell`,
    manufacturer: manufacturer || 'Generic',
    category: 'led_bar',
    channels,
  });
}

// ─── Multi-Cell Fixture Type Helper ─────────────────────────────────────────

/**
 * Create a multi-cell fixture type with optional master channels and per-cell channel pattern.
 * @param {Object} opts
 * @param {string}   opts.name              - Fixture type name
 * @param {string}   opts.manufacturer      - Manufacturer
 * @param {number}   opts.cellCount         - Number of cells (required, >= 1)
 * @param {Array}    opts.masterChannels    - Global channels [{name, type}] (optional)
 * @param {string[]} opts.cellChannelPattern - Channel types per cell (default: ['red','green','blue'])
 */
function createMultiCellFixtureType({ name, manufacturer, cellCount, masterChannels, cellChannelPattern }) {
  if (!cellCount || cellCount < 1) throw new Error('cellCount is required and must be >= 1');
  const pattern = cellChannelPattern || ['red', 'green', 'blue'];
  const channels = [];

  // Master/global channels first (cell = null)
  if (masterChannels && masterChannels.length > 0) {
    for (const mc of masterChannels) {
      channels.push({
        name: mc.name || mc.type.charAt(0).toUpperCase() + mc.type.slice(1),
        type: mc.type || 'dimmer',
        default_value: mc.default_value || 0,
        cell: null,
      });
    }
  }

  // Per-cell channels
  for (let cell = 1; cell <= cellCount; cell++) {
    for (const type of pattern) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      channels.push({ name: `Cell ${cell} ${label}`, type, default_value: 0, cell });
    }
  }

  return createFixtureType({
    name: name || `Multi-Cell ${cellCount}`,
    manufacturer: manufacturer || 'Generic',
    category: 'multi_cell',
    channels,
  });
}

// ─── Seed Default Subscriptions ─────────────────────────────────────────────

function seedSubscriptions() {
  const ins = db.prepare(
    `INSERT INTO subscriptions (trigger, label, category, enabled, sort_order) VALUES (?, ?, ?, 1, ?)`
  );
  const subs = db.transaction(() => {
    let o = 0;
    // SoundSwitch IDs
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_text '%SOUNDSWITCH_ID'`, `Deck ${d} SoundSwitch ID`, 'soundswitch', o++);
    // Filepath
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_filepath`, `Deck ${d} Filepath`, 'track', o++);
    // Genre
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_genre`, `Deck ${d} Genre`, 'track', o++);
    // Level
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} level`, `Deck ${d} Level`, 'mixer', o++);
    // Crossfader
    ins.run('crossfader', 'Crossfader', 'mixer', o++);
    // Time
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_time elapsed absolute`, `Deck ${d} Time`, 'transport', o++);
    // Beat position
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_beatpos`, `Deck ${d} Beat Position`, 'transport', o++);
    // First beat
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_firstbeat`, `Deck ${d} First Beat`, 'transport', o++);
    // BPM
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_bpm`, `Deck ${d} BPM`, 'transport', o++);
    // Play
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} play`, `Deck ${d} Play`, 'transport', o++);
    // Loop
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} loop`, `Deck ${d} Loop`, 'loop', o++);
    // Get loop
    for (let d = 1; d <= 4; d++) ins.run(`deck ${d} get_loop`, `Deck ${d} Get Loop`, 'loop', o++);
    // Loop roll expressions
    for (let d = 1; d <= 4; d++) {
      const expr = `deck ${d} loop_roll 0.03125 ? constant 0.03125 : deck ${d} loop_roll 0.0625 ? constant 0.0625 : deck ${d} loop_roll 0.125 ? constant 0.125 : deck ${d} loop_roll 0.25 ? constant 0.25 : deck ${d} loop_roll 0.5 ? constant 0.5 : deck ${d} loop_roll 0.75 ? constant 0.75 : deck ${d} loop_roll 1 ? constant 1 : deck ${d} loop_roll 2 ? constant 2 : deck ${d} loop_roll 4 ? constant 4 : constant 0`;
      ins.run(expr, `Deck ${d} Loop Roll`, 'loop', o++);
    }
  });
  subs();
}

// ─── Subscriptions CRUD ─────────────────────────────────────────────────────

function getSubscriptions() {
  return db.prepare('SELECT * FROM subscriptions ORDER BY sort_order, id').all();
}

function getEnabledSubscriptions() {
  return db.prepare('SELECT * FROM subscriptions WHERE enabled = 1 ORDER BY sort_order, id').all();
}

function createSubscription({ trigger, label, category }) {
  if (!trigger || !trigger.trim()) return { error: 'Trigger expression is required' };
  try {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM subscriptions').get().next;
    const r = db.prepare(
      `INSERT INTO subscriptions (trigger, label, category, enabled, sort_order) VALUES (?, ?, ?, 1, ?)`
    ).run(trigger.trim(), label || '', category || 'custom', maxOrder);
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(r.lastInsertRowid);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { error: 'This trigger already exists' };
    return { error: e.message };
  }
}

function updateSubscription(id, { trigger, label, category, enabled }) {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  if (!existing) return null;
  try {
    db.prepare(
      `UPDATE subscriptions SET trigger=?, label=?, category=?, enabled=? WHERE id=?`
    ).run(
      trigger !== undefined ? trigger.trim() : existing.trigger,
      label !== undefined ? label : existing.label,
      category !== undefined ? category : existing.category,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );
    return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { error: 'This trigger already exists' };
    return { error: e.message };
  }
}

function deleteSubscription(id) {
  db.prepare('DELETE FROM subscriptions WHERE id = ?').run(id);
  return { deleted: true };
}

function toggleSubscription(id) {
  db.prepare('UPDATE subscriptions SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

// ─── Config CRUD ────────────────────────────────────────────────────────────

function getConfig(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setConfig(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, String(value));
}

function getAllConfig() {
  const rows = db.prepare('SELECT * FROM config').all();
  const obj = {};
  for (const r of rows) obj[r.key] = r.value;
  return obj;
}

// ─── Migrate to Modes ───────────────────────────────────────────────────────

function migrateToModes() {
  // Check if mode_id column exists on fixture_type_channels
  const cols = db.prepare("PRAGMA table_info(fixture_type_channels)").all();
  const hasModeId = cols.some(c => c.name === 'mode_id');

  if (hasModeId) {
    // Already migrated — check if UNIQUE constraint needs fixing
    // (old migrations added mode_id but kept UNIQUE(fixture_type_id, channel_number))
    // We detect this by checking the SQL for the table
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='fixture_type_channels'").get();
    if (tableInfo && tableInfo.sql && tableInfo.sql.includes('UNIQUE(fixture_type_id, channel_number)')) {
      console.log('[DB] Fixing UNIQUE constraint on fixture_type_channels (mode_id, channel_number)...');
      _rebuildChannelsTableConstraint();
    }

    // Also ensure fixtures have mode_id
    try { db.prepare("SELECT mode_id FROM fixtures LIMIT 1").get(); } catch (e) {
      db.exec("ALTER TABLE fixtures ADD COLUMN mode_id INTEGER");
      console.log('[DB] Migrated fixtures: added mode_id column');
    }
    // Backfill any fixtures missing mode_id (shouldn't happen, but safety net)
    const needFix = db.prepare("SELECT f.id, f.fixture_type_id FROM fixtures f WHERE f.mode_id IS NULL").all();
    if (needFix.length > 0) {
      const upd = db.prepare("UPDATE fixtures SET mode_id = ? WHERE id = ?");
      for (const f of needFix) {
        const mode = db.prepare("SELECT id FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order LIMIT 1").get(f.fixture_type_id);
        if (mode) upd.run(mode.id, f.id);
      }
      console.log(`[DB] Backfilled mode_id for ${needFix.length} fixture(s)`);
    }
    return;
  }

  console.log('[DB] Migrating to modes-based fixture architecture...');

  // 1. Add mode_id column to fixture_type_channels
  db.exec("ALTER TABLE fixture_type_channels ADD COLUMN mode_id INTEGER");

  // 2. Add mode_id column to fixtures  
  try { db.prepare("SELECT mode_id FROM fixtures LIMIT 1").get(); } catch (e) {
    db.exec("ALTER TABLE fixtures ADD COLUMN mode_id INTEGER");
  }

  // 3. For each existing fixture type, create a "Default" mode and re-link
  const types = db.prepare("SELECT id, name, channel_count FROM fixture_types").all();
  const insertMode = db.prepare(
    "INSERT INTO fixture_type_modes (fixture_type_id, name, short_name, channel_count, sort_order) VALUES (?, ?, ?, ?, 0)"
  );
  const linkChannels = db.prepare(
    "UPDATE fixture_type_channels SET mode_id = ? WHERE fixture_type_id = ? AND mode_id IS NULL"
  );
  const linkFixtures = db.prepare(
    "UPDATE fixtures SET mode_id = ? WHERE fixture_type_id = ? AND mode_id IS NULL"
  );

  const migrate = db.transaction(() => {
    for (const t of types) {
      const modeResult = insertMode.run(t.id, 'Default', '', t.channel_count);
      const modeId = modeResult.lastInsertRowid;
      linkChannels.run(modeId, t.id);
      linkFixtures.run(modeId, t.id);
    }
  });
  migrate();

  // 4. Rebuild table to change UNIQUE constraint from (fixture_type_id, channel_number) to (mode_id, channel_number)
  _rebuildChannelsTableConstraint();

  console.log(`[DB] Created default modes for ${types.length} fixture type(s) and linked channels/fixtures`);
}

/**
 * Rebuild fixture_type_channels table to use UNIQUE(mode_id, channel_number) instead of (fixture_type_id, channel_number).
 * SQLite doesn't support ALTER TABLE to drop/change constraints, so we recreate the table.
 */
function _rebuildChannelsTableConstraint() {
  // Check which columns exist (cell, invert, ranges may or may not be present)
  const cols = db.prepare("PRAGMA table_info(fixture_type_channels)").all().map(c => c.name);

  db.exec(`
    CREATE TABLE fixture_type_channels_new (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      mode_id         INTEGER REFERENCES fixture_type_modes(id) ON DELETE CASCADE,
      channel_number  INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'dimmer',
      default_value   INTEGER DEFAULT 0,
      min_value       INTEGER DEFAULT 0,
      max_value       INTEGER DEFAULT 255,
      ranges          TEXT    DEFAULT NULL,
      cell            INTEGER DEFAULT NULL,
      invert          INTEGER DEFAULT 0,
      UNIQUE(mode_id, channel_number)
    )
  `);

  // Copy data — use only columns that exist in source
  const copyColumns = ['id', 'fixture_type_id', 'mode_id', 'channel_number', 'name', 'type', 'default_value', 'min_value', 'max_value', 'ranges', 'cell', 'invert']
    .filter(c => cols.includes(c));
  const colList = copyColumns.join(', ');
  db.exec(`INSERT INTO fixture_type_channels_new (${colList}) SELECT ${colList} FROM fixture_type_channels`);
  db.exec('DROP TABLE fixture_type_channels');
  db.exec('ALTER TABLE fixture_type_channels_new RENAME TO fixture_type_channels');
  console.log('[DB] Rebuilt fixture_type_channels with UNIQUE(mode_id, channel_number)');
}

// ─── Seed Default Fixture Types ─────────────────────────────────────────────

function seedDefaults() {
  const insertType = db.prepare(
    `INSERT INTO fixture_types (name, manufacturer, category, channel_count) VALUES (?, ?, ?, ?)`
  );
  const insertMode = db.prepare(
    `INSERT INTO fixture_type_modes (fixture_type_id, name, short_name, channel_count, sort_order) VALUES (?, ?, ?, ?, 0)`
  );
  const insertCh = db.prepare(
    `INSERT INTO fixture_type_channels (fixture_type_id, mode_id, channel_number, name, type, default_value, ranges)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  /** Helper: create type + default mode, returns { typeId, modeId } */
  const addType = (name, mfr, cat, chCount) => {
    const r = insertType.run(name, mfr, cat, chCount);
    const typeId = r.lastInsertRowid;
    const m = insertMode.run(typeId, 'Default', '', chCount);
    return { typeId, modeId: m.lastInsertRowid };
  };
  /** Helper: insert channel without ranges */
  const ch = (typeId, modeId, num, name, type, def) => insertCh.run(typeId, modeId, num, name, type, def || 0, null);
  /** Helper: insert channel with ranges */
  const chR = (typeId, modeId, num, name, type, def, ranges) => insertCh.run(typeId, modeId, num, name, type, def || 0, JSON.stringify(ranges));

  const seed = db.transaction(() => {
    // 1 — Generic RGB Par (3ch)
    let { typeId, modeId } = addType('Generic RGB Par', 'Generic', 'par', 3);
    ch(typeId, modeId, 1, 'Red', 'red', 0);
    ch(typeId, modeId, 2, 'Green', 'green', 0);
    ch(typeId, modeId, 3, 'Blue', 'blue', 0);

    // 2 — Generic RGBW Par (4ch)
    ({ typeId, modeId } = addType('Generic RGBW Par', 'Generic', 'par', 4));
    ch(typeId, modeId, 1, 'Red', 'red', 0);
    ch(typeId, modeId, 2, 'Green', 'green', 0);
    ch(typeId, modeId, 3, 'Blue', 'blue', 0);
    ch(typeId, modeId, 4, 'White', 'white', 0);

    // 3 — Generic Dimmer (1ch)
    ({ typeId, modeId } = addType('Generic Dimmer', 'Generic', 'dimmer', 1));
    ch(typeId, modeId, 1, 'Dimmer', 'dimmer', 0);

    // 4 — RGB Par + Dimmer (4ch)
    ({ typeId, modeId } = addType('RGB Par + Dimmer', 'Generic', 'par', 4));
    ch(typeId, modeId, 1, 'Dimmer', 'dimmer', 0);
    ch(typeId, modeId, 2, 'Red', 'red', 0);
    ch(typeId, modeId, 3, 'Green', 'green', 0);
    ch(typeId, modeId, 4, 'Blue', 'blue', 0);

    // 5 — Generic Moving Head (16ch)
    ({ typeId, modeId } = addType('Generic Moving Head', 'Generic', 'moving_head', 16));
    ch(typeId, modeId, 1, 'Pan', 'pan', 128);
    ch(typeId, modeId, 2, 'Pan Fine', 'pan_fine', 0);
    ch(typeId, modeId, 3, 'Tilt', 'tilt', 128);
    ch(typeId, modeId, 4, 'Tilt Fine', 'tilt_fine', 0);
    ch(typeId, modeId, 5, 'Speed', 'speed', 0);
    ch(typeId, modeId, 6, 'Dimmer', 'dimmer', 0);
    ch(typeId, modeId, 7, 'Strobe', 'strobe', 0);
    ch(typeId, modeId, 8, 'Red', 'red', 0);
    ch(typeId, modeId, 9, 'Green', 'green', 0);
    ch(typeId, modeId, 10, 'Blue', 'blue', 0);
    ch(typeId, modeId, 11, 'White', 'white', 0);
    ch(typeId, modeId, 12, 'Color Wheel', 'color_wheel', 0);
    ch(typeId, modeId, 13, 'Gobo', 'gobo', 0);
    ch(typeId, modeId, 14, 'Gobo Rotation', 'gobo_rotation', 0);
    ch(typeId, modeId, 15, 'Prism', 'prism', 0);
    ch(typeId, modeId, 16, 'Focus', 'focus', 128);

    // 6 — Strobe (2ch)
    ({ typeId, modeId } = addType('Generic Strobe', 'Generic', 'strobe', 2));
    ch(typeId, modeId, 1, 'Dimmer', 'dimmer', 0);
    ch(typeId, modeId, 2, 'Strobe Speed', 'strobe', 0);

    // 7 — Fog Machine (1ch)
    ({ typeId, modeId } = addType('Generic Fog Machine', 'Generic', 'fog', 1));
    ch(typeId, modeId, 1, 'Output', 'dimmer', 0);

    // 8 — 14ch Moving Head with ranges (matches common RGBW moving head spec)
    ({ typeId, modeId } = addType('Moving Head 14ch', 'Generic', 'moving_head', 14));
    ch(typeId, modeId, 1, 'Pan', 'pan', 128);
    ch(typeId, modeId, 2, 'Pan Fine', 'pan_fine', 0);
    ch(typeId, modeId, 3, 'Tilt', 'tilt', 128);
    ch(typeId, modeId, 4, 'Tilt Fine', 'tilt_fine', 0);
    ch(typeId, modeId, 5, 'Pan/Tilt Speed', 'speed', 0);
    chR(typeId, modeId, 6, 'Dimmer / Strobe', 'dimmer', 0, [
      { min: 0, max: 7, label: 'No function', type: 'other' },
      { min: 8, max: 134, label: 'Dimmer', type: 'dimmer' },
      { min: 135, max: 239, label: 'Strobe 0-40Hz', type: 'strobe' },
      { min: 240, max: 255, label: 'Open', type: 'other' }
    ]);
    ch(typeId, modeId, 7, 'Red', 'red', 0);
    ch(typeId, modeId, 8, 'Green', 'green', 0);
    ch(typeId, modeId, 9, 'Blue', 'blue', 0);
    ch(typeId, modeId, 10, 'White', 'white', 0);
    chR(typeId, modeId, 11, 'Color Mix/Effect', 'color_wheel', 0, [
      { min: 0, max: 223, label: 'Color Mixed', type: 'color_wheel' },
      { min: 224, max: 240, label: 'Gradient slow→fast', type: 'macro' },
      { min: 241, max: 255, label: 'Color jump slow→fast', type: 'macro' }
    ]);
    ch(typeId, modeId, 12, 'Color Speed', 'speed', 0);
    chR(typeId, modeId, 13, 'Movement/Effect', 'macro', 0, [
      { min: 0, max: 3, label: 'DMX control', type: 'other' },
      { min: 4, max: 102, label: 'Auto 1', type: 'macro' },
      { min: 103, max: 152, label: 'Auto 2', type: 'macro' },
      { min: 153, max: 203, label: 'Auto 3', type: 'macro' },
      { min: 204, max: 255, label: 'Sound', type: 'macro' }
    ]);
    chR(typeId, modeId, 14, 'Reset', 'other', 0, [
      { min: 0, max: 254, label: 'No function', type: 'other' },
      { min: 255, max: 255, label: 'Factory Reset', type: 'other' }
    ]);

    // 9 — Generic 60W Spot Moving Head (11ch)
    ({ typeId, modeId } = addType('Generic 60W Spot Moving Head', 'Generic', 'moving_head', 11));
    ch(typeId, modeId, 1, 'Pan', 'pan', 128);
    ch(typeId, modeId, 2, 'Pan Fine', 'pan_fine', 0);
    ch(typeId, modeId, 3, 'Tilt', 'tilt', 128);
    ch(typeId, modeId, 4, 'Tilt Fine', 'tilt_fine', 0);
    chR(typeId, modeId, 5, 'Color Wheel', 'color_wheel', 0, [
      { min: 0, max: 9, label: 'No function', type: 'other' },
      { min: 10, max: 163, label: 'Color effects', type: 'color_wheel' },
      { min: 164, max: 210, label: 'CCW flow', type: 'macro' },
      { min: 211, max: 255, label: 'CW flow', type: 'macro' }
    ]);
    chR(typeId, modeId, 6, 'Gobo', 'gobo', 0, [
      { min: 0, max: 9, label: 'No function', type: 'other' },
      { min: 10, max: 79, label: 'Gobo effects', type: 'gobo' },
      { min: 80, max: 149, label: 'Bouncing', type: 'gobo' },
      { min: 150, max: 200, label: 'CCW rotation', type: 'macro' },
      { min: 201, max: 255, label: 'CW water wave', type: 'macro' }
    ]);
    ch(typeId, modeId, 7, 'Strobe', 'strobe', 0);
    ch(typeId, modeId, 8, 'Dimmer', 'dimmer', 0);
    ch(typeId, modeId, 9, 'Speed', 'speed', 0);
    chR(typeId, modeId, 10, 'Macro', 'macro', 0, [
      { min: 0, max: 50, label: 'No function', type: 'other' },
      { min: 51, max: 151, label: 'Fast moving', type: 'macro' },
      { min: 152, max: 255, label: 'Sound control', type: 'macro' }
    ]);
    chR(typeId, modeId, 11, 'Reset', 'other', 0, [
      { min: 0, max: 254, label: 'No function', type: 'other' },
      { min: 255, max: 255, label: 'Reset', type: 'other' }
    ]);
  });

  seed();
}

// ─── Fixture Types CRUD ─────────────────────────────────────────────────────

/** Attach modes (with channels) to a fixture type object */
function _attachModes(t) {
  t.modes = db.prepare(
    'SELECT * FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order, id'
  ).all(t.id);
  for (const m of t.modes) {
    m.channels = db.prepare(
      'SELECT * FROM fixture_type_channels WHERE mode_id = ? ORDER BY channel_number'
    ).all(m.id);
    for (const ch of m.channels) {
      ch.ranges = ch.ranges ? JSON.parse(ch.ranges) : null;
    }
  }
  // Legacy compat: expose first mode's channels as t.channels
  t.channels = t.modes.length > 0 ? t.modes[0].channels : [];
  return t;
}

function getFixtureTypes() {
  const types = db.prepare('SELECT * FROM fixture_types ORDER BY category, name').all();
  for (const t of types) _attachModes(t);
  return types;
}

/**
 * Lightweight list of fixture types for dropdowns (no channels or mode details).
 * Returns: [{ id, name, manufacturer, category, channel_count, modes: [{ id, name, short_name, channel_count }] }]
 */
function getFixtureTypeSummaries() {
  const types = db.prepare('SELECT id, name, manufacturer, category, channel_count FROM fixture_types ORDER BY category, name').all();
  const modeStmt = db.prepare('SELECT id, name, short_name, channel_count FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order, id');
  for (const t of types) {
    t.modes = modeStmt.all(t.id);
    // Legacy compat
    t.channels = [];
  }
  return types;
}

/**
 * Server-side paginated search for fixture library.
 * @param {Object} opts
 * @param {string} [opts.search] - search name/manufacturer
 * @param {string} [opts.category] - filter by category
 * @param {string} [opts.manufacturer] - filter by manufacturer
 * @param {number} [opts.limit=50] - page size
 * @param {number} [opts.offset=0] - offset
 * @returns {{ types: Array, total: number, categories: string[], manufacturers: string[] }}
 */
function searchFixtureTypes({ search, category, manufacturer, channels, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (search) {
    where.push("(ft.name LIKE ? COLLATE NOCASE OR ft.manufacturer LIKE ? COLLATE NOCASE)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    where.push("ft.category = ?");
    params.push(category);
  }
  if (manufacturer) {
    where.push("ft.manufacturer = ?");
    params.push(manufacturer);
  }
  if (channels) {
    where.push("EXISTS (SELECT 1 FROM fixture_type_modes m WHERE m.fixture_type_id = ft.id AND m.channel_count = ?)");
    params.push(channels);
  }
  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

  // Total count
  const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM fixture_types ft ${whereClause}`).get(...params);
  const total = countRow.cnt;

  // Paginated results (lightweight — no channels)
  const types = db.prepare(
    `SELECT ft.* FROM fixture_types ft ${whereClause} ORDER BY ft.category, ft.name LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  // Attach modes summary (no channels inside modes — lightweight)
  const modeStmt = db.prepare(
    'SELECT id, name, short_name, channel_count FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order, id'
  );
  for (const t of types) {
    t.modes = modeStmt.all(t.id);
  }

  // Get all categories and manufacturers for filter dropdowns (only on first page to avoid waste)
  let categories = [];
  let manufacturers = [];
  let channelCounts = [];
  if (offset === 0) {
    categories = db.prepare("SELECT DISTINCT category FROM fixture_types ORDER BY category").all().map(r => r.category);
    manufacturers = db.prepare("SELECT DISTINCT manufacturer FROM fixture_types WHERE manufacturer != '' ORDER BY manufacturer").all().map(r => r.manufacturer);
    channelCounts = db.prepare("SELECT DISTINCT channel_count FROM fixture_type_modes ORDER BY channel_count").all().map(r => r.channel_count);
  }

  return { types, total, categories, manufacturers, channelCounts };
}

function getFixtureType(id) {
  const t = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(id);
  if (!t) return null;
  return _attachModes(t);
}

function createFixtureType({ name, manufacturer, category, channels, modes }) {
  // Support both modes-based and legacy channels-only creation
  const modesData = modes && modes.length > 0
    ? modes
    : [{ name: 'Default', short_name: '', channels: channels || [] }];

  const channel_count = modesData[0].channels ? modesData[0].channels.length : 0;
  const r = db.prepare(
    `INSERT INTO fixture_types (name, manufacturer, category, channel_count) VALUES (?, ?, ?, ?)`
  ).run(name, manufacturer || '', category || 'other', channel_count);
  const typeId = r.lastInsertRowid;

  const insModeStmt = db.prepare(
    `INSERT INTO fixture_type_modes (fixture_type_id, name, short_name, channel_count, sort_order) VALUES (?, ?, ?, ?, ?)`
  );
  const insChStmt = db.prepare(
    `INSERT INTO fixture_type_channels (fixture_type_id, mode_id, channel_number, name, type, default_value, min_value, max_value, ranges, cell, invert)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertAll = db.transaction(() => {
    for (let mi = 0; mi < modesData.length; mi++) {
      const mode = modesData[mi];
      const mChCount = mode.channels ? mode.channels.length : 0;
      const mResult = insModeStmt.run(typeId, mode.name || 'Default', mode.short_name || '', mChCount, mi);
      const modeId = mResult.lastInsertRowid;

      if (mode.channels && mode.channels.length) {
        for (const ch of mode.channels) {
          const rangesJson = ch.ranges ? (typeof ch.ranges === 'string' ? ch.ranges : JSON.stringify(ch.ranges)) : null;
          insChStmt.run(typeId, modeId, ch.channel_number, ch.name, ch.type || 'dimmer',
            ch.default_value || 0, ch.min_value || 0, ch.max_value || 255,
            rangesJson, ch.cell || null, ch.invert ? 1 : 0);
        }
      }
    }
  });
  insertAll();

  return getFixtureType(typeId);
}

function updateFixtureType(id, { name, manufacturer, category, channels, modes }) {
  const existing = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(id);
  if (!existing) return null;

  // Support both modes-based and legacy channels-only updates
  const modesData = modes && modes.length > 0
    ? modes
    : channels
      ? [{ name: 'Default', short_name: '', channels }]
      : null;

  const update = db.transaction(() => {
    const channel_count = modesData
      ? (modesData[0].channels ? modesData[0].channels.length : 0)
      : existing.channel_count;
    db.prepare(
      `UPDATE fixture_types SET name=?, manufacturer=?, category=?, channel_count=?, updated_at=datetime('now') WHERE id=?`
    ).run(name || existing.name, manufacturer ?? existing.manufacturer, category || existing.category, channel_count, id);

    if (modesData) {
      // Get existing mode IDs so we can update fixtures that referenced them
      const oldModes = db.prepare('SELECT id FROM fixture_type_modes WHERE fixture_type_id = ?').all(id);

      // Delete old modes and channels
      db.prepare('DELETE FROM fixture_type_channels WHERE fixture_type_id = ?').run(id);
      db.prepare('DELETE FROM fixture_type_modes WHERE fixture_type_id = ?').run(id);

      const insModeStmt = db.prepare(
        `INSERT INTO fixture_type_modes (fixture_type_id, name, short_name, channel_count, sort_order) VALUES (?, ?, ?, ?, ?)`
      );
      const insChStmt = db.prepare(
        `INSERT INTO fixture_type_channels (fixture_type_id, mode_id, channel_number, name, type, default_value, min_value, max_value, ranges, cell, invert)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const newModeIds = [];
      for (let mi = 0; mi < modesData.length; mi++) {
        const mode = modesData[mi];
        const mChCount = mode.channels ? mode.channels.length : 0;
        const mResult = insModeStmt.run(id, mode.name || 'Default', mode.short_name || '', mChCount, mi);
        const modeId = mResult.lastInsertRowid;
        newModeIds.push(modeId);

        if (mode.channels && mode.channels.length) {
          for (const ch of mode.channels) {
            const rangesJson = ch.ranges ? (typeof ch.ranges === 'string' ? ch.ranges : JSON.stringify(ch.ranges)) : null;
            insChStmt.run(id, modeId, ch.channel_number, ch.name, ch.type || 'dimmer',
              ch.default_value || 0, ch.min_value || 0, ch.max_value || 255,
              rangesJson, ch.cell || null, ch.invert ? 1 : 0);
          }
        }
      }

      // Re-link fixtures: map old mode positions to new mode positions
      if (oldModes.length > 0 && newModeIds.length > 0) {
        for (let i = 0; i < oldModes.length; i++) {
          const newModeId = newModeIds[Math.min(i, newModeIds.length - 1)];
          db.prepare('UPDATE fixtures SET mode_id = ? WHERE mode_id = ?').run(newModeId, oldModes[i].id);
        }
      }
    }
  });
  update();
  return getFixtureType(id);
}

function deleteFixtureType(id) {
  // Check for fixtures using this type
  const count = db.prepare('SELECT COUNT(*) as c FROM fixtures WHERE fixture_type_id = ?').get(id).c;
  if (count > 0) {
    return { error: `Cannot delete: ${count} fixture(s) use this type` };
  }
  db.prepare('DELETE FROM fixture_types WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Fixtures CRUD ──────────────────────────────────────────────────────────

function getFixtures() {
  const fixtures = db.prepare(`
    SELECT f.*, ft.name as type_name, ft.category,
           ftm.name as mode_name, ftm.channel_count
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    LEFT JOIN fixture_type_modes ftm ON f.mode_id = ftm.id
    ORDER BY f.universe, f.address
  `).all();

  // Attach channels for each fixture (needed for card rendering)
  const chByMode = db.prepare('SELECT * FROM fixture_type_channels WHERE mode_id = ? ORDER BY channel_number');
  const chByType = db.prepare('SELECT * FROM fixture_type_channels WHERE fixture_type_id = ? ORDER BY channel_number');
  for (const f of fixtures) {
    f.channels = f.mode_id ? chByMode.all(f.mode_id) : chByType.all(f.fixture_type_id);
    for (const ch of f.channels) {
      ch.ranges = ch.ranges ? JSON.parse(ch.ranges) : null;
    }
  }
  return fixtures;
}

function getFixture(id) {
  const f = db.prepare(`
    SELECT f.*, ft.name as type_name, ft.category,
           ftm.name as mode_name, ftm.channel_count
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    LEFT JOIN fixture_type_modes ftm ON f.mode_id = ftm.id
    WHERE f.id = ?
  `).get(id);
  if (!f) return null;

  // Get channels from the fixture's mode
  f.channels = f.mode_id
    ? db.prepare('SELECT * FROM fixture_type_channels WHERE mode_id = ? ORDER BY channel_number').all(f.mode_id)
    : db.prepare('SELECT * FROM fixture_type_channels WHERE fixture_type_id = ? ORDER BY channel_number').all(f.fixture_type_id);
  return f;
}

function createFixture({ name, fixture_type_id, mode_id, universe, address, output_type, notes, invert_pan, invert_tilt, home_pan, home_tilt, rig_x, rig_y, rig_order }) {
  // Validate type exists
  const type = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(fixture_type_id);
  if (!type) return { error: 'Fixture type not found' };

  // Resolve mode — use provided mode_id, or default to first mode
  let resolvedModeId = mode_id;
  if (!resolvedModeId) {
    const firstMode = db.prepare('SELECT id FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order LIMIT 1').get(fixture_type_id);
    if (firstMode) resolvedModeId = firstMode.id;
  }

  // Get channel count from the mode
  const mode = resolvedModeId ? db.prepare('SELECT * FROM fixture_type_modes WHERE id = ?').get(resolvedModeId) : null;
  const channelCount = mode ? mode.channel_count : type.channel_count;

  // Validate address range
  if (address < 1 || address > 512) return { error: 'Address must be 1-512' };
  if (address + channelCount - 1 > 512) return { error: `Address too high for ${channelCount}-channel fixture` };

  // Check for overlapping addresses in same universe
  const overlap = checkAddressOverlap(universe || 1, address, channelCount, null);
  if (overlap) return { error: overlap };

  const otype = output_type || 'artnet';
  // Auto-assign rig_order if not provided (next available)
  let resolvedRigOrder = rig_order;
  if (resolvedRigOrder === undefined || resolvedRigOrder === null) {
    const maxOrder = db.prepare('SELECT COALESCE(MAX(rig_order), -1) + 1 as next FROM fixtures').get().next;
    resolvedRigOrder = maxOrder;
  }
  const r = db.prepare(
    `INSERT INTO fixtures (name, fixture_type_id, mode_id, universe, address, output_type, notes, invert_pan, invert_tilt, home_pan, home_tilt, rig_x, rig_y, rig_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(name, fixture_type_id, resolvedModeId, universe || 1, address, otype, notes || '', invert_pan ? 1 : 0, invert_tilt ? 1 : 0, home_pan ?? 128, home_tilt ?? 128, rig_x ?? 0.5, rig_y ?? 0.5, resolvedRigOrder);

  return getFixture(r.lastInsertRowid);
}

function updateFixture(id, { name, fixture_type_id, mode_id, universe, address, output_type, notes, invert_pan, invert_tilt, home_pan, home_tilt, rig_x, rig_y, rig_order }) {
  const existing = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(id);
  if (!existing) return null;

  const typeId = fixture_type_id || existing.fixture_type_id;
  const type = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(typeId);
  if (!type) return { error: 'Fixture type not found' };

  // Resolve mode_id
  let resolvedModeId = mode_id !== undefined ? mode_id : existing.mode_id;
  // If type changed but mode_id wasn't specified, default to first mode of new type
  if (fixture_type_id && fixture_type_id !== existing.fixture_type_id && mode_id === undefined) {
    const firstMode = db.prepare('SELECT id FROM fixture_type_modes WHERE fixture_type_id = ? ORDER BY sort_order LIMIT 1').get(typeId);
    resolvedModeId = firstMode ? firstMode.id : null;
  }

  // Get channel count from mode
  const mode = resolvedModeId ? db.prepare('SELECT * FROM fixture_type_modes WHERE id = ?').get(resolvedModeId) : null;
  const channelCount = mode ? mode.channel_count : type.channel_count;

  const addr = address ?? existing.address;
  const univ = universe ?? existing.universe;
  const otype = output_type || existing.output_type || 'artnet';

  if (addr < 1 || addr > 512) return { error: 'Address must be 1-512' };
  if (addr + channelCount - 1 > 512) return { error: `Address too high for ${channelCount}-channel fixture` };

  const overlap = checkAddressOverlap(univ, addr, channelCount, id);
  if (overlap) return { error: overlap };

  db.prepare(
    `UPDATE fixtures SET name=?, fixture_type_id=?, mode_id=?, universe=?, address=?, output_type=?, notes=?, invert_pan=?, invert_tilt=?, home_pan=?, home_tilt=?, rig_x=?, rig_y=?, rig_order=?, updated_at=datetime('now') WHERE id=?`
  ).run(name || existing.name, typeId, resolvedModeId, univ, addr, otype, notes ?? existing.notes, invert_pan !== undefined ? (invert_pan ? 1 : 0) : existing.invert_pan, invert_tilt !== undefined ? (invert_tilt ? 1 : 0) : existing.invert_tilt, home_pan ?? existing.home_pan ?? 128, home_tilt ?? existing.home_tilt ?? 128, rig_x ?? existing.rig_x ?? 0.5, rig_y ?? existing.rig_y ?? 0.5, rig_order ?? existing.rig_order ?? 0, id);

  return getFixture(id);
}

function deleteFixture(id) {
  db.prepare('DELETE FROM fixtures WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Rig Layout Bulk Update ─────────────────────────────────────────────────

/**
 * Bulk update rig positions for multiple fixtures.
 * @param {Array<{id:number, rig_x:number, rig_y:number, rig_order:number}>} positions
 * @returns {{ updated: number }}
 */
function updateFixtureRigPositions(positions) {
  const stmt = db.prepare('UPDATE fixtures SET rig_x = ?, rig_y = ?, rig_order = ?, updated_at = datetime(\'now\') WHERE id = ?');
  let updated = 0;
  const tx = db.transaction(() => {
    for (const p of positions) {
      const result = stmt.run(p.rig_x ?? 0.5, p.rig_y ?? 0.5, p.rig_order ?? 0, p.id);
      if (result.changes > 0) updated++;
    }
  });
  tx();
  return { updated };
}

// ─── Rig Elements CRUD ─────────────────────────────────────────────────────

function getRigElements() {
  return db.prepare('SELECT * FROM rig_elements ORDER BY sort_order, id').all();
}

function createRigElement({ type, label, x, y, width, height, rotation }) {
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 as next FROM rig_elements').get().next;
  const result = db.prepare(
    'INSERT INTO rig_elements (type, label, x, y, width, height, rotation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(type || 'truss_h', label || '', x ?? 0.5, y ?? 0.5, width ?? 0.4, height ?? 0.02, rotation ?? 0, maxOrder);
  return { id: result.lastInsertRowid };
}

function updateRigElement(id, { type, label, x, y, width, height, rotation }) {
  const existing = db.prepare('SELECT * FROM rig_elements WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    'UPDATE rig_elements SET type = ?, label = ?, x = ?, y = ?, width = ?, height = ?, rotation = ? WHERE id = ?'
  ).run(
    type ?? existing.type, label ?? existing.label,
    x ?? existing.x, y ?? existing.y,
    width ?? existing.width, height ?? existing.height,
    rotation ?? existing.rotation, id
  );
  return { id };
}

function deleteRigElement(id) {
  db.prepare('DELETE FROM rig_elements WHERE id = ?').run(id);
  return { deleted: true };
}

function bulkUpdateRigElements(elements) {
  const stmt = db.prepare('UPDATE rig_elements SET x = ?, y = ?, width = ?, height = ?, rotation = ?, sort_order = ? WHERE id = ?');
  let updated = 0;
  const tx = db.transaction(() => {
    for (const el of elements) {
      const result = stmt.run(el.x ?? 0.5, el.y ?? 0.5, el.width ?? 0.4, el.height ?? 0.02, el.rotation ?? 0, el.sort_order ?? 0, el.id);
      if (result.changes > 0) updated++;
    }
  });
  tx();
  return { updated };
}

// ─── Rig Layouts CRUD (named snapshots) ─────────────────────────────────────

function getRigLayouts() {
  return db.prepare('SELECT id, name, is_active, created_at, updated_at FROM rig_layouts ORDER BY updated_at DESC').all();
}

function getRigLayout(id) {
  const row = db.prepare('SELECT * FROM rig_layouts WHERE id = ?').get(id);
  if (!row) return null;
  row.data = JSON.parse(row.data);
  return row;
}

function createRigLayout(name, clientData) {
  // Use client-provided snapshot data if available, otherwise read from DB
  let data;
  if (clientData && clientData.fixtures) {
    data = JSON.stringify(clientData);
  } else {
    const fixtures = db.prepare('SELECT id, rig_x, rig_y, rig_order FROM fixtures ORDER BY rig_order').all();
    const elements = db.prepare('SELECT type, label, x, y, width, height, rotation, sort_order FROM rig_elements ORDER BY sort_order, id').all();
    data = JSON.stringify({ fixtures, elements });
  }
  const result = db.prepare(
    'INSERT INTO rig_layouts (name, data) VALUES (?, ?)'
  ).run(name || 'Untitled Layout', data);
  return { id: result.lastInsertRowid };
}

function updateRigLayout(id, { name, data: clientData } = {}) {
  const existing = db.prepare('SELECT * FROM rig_layouts WHERE id = ?').get(id);
  if (!existing) return null;
  // Use client-provided snapshot data if available, otherwise read from DB
  let data;
  if (clientData && clientData.fixtures) {
    data = JSON.stringify(clientData);
  } else {
    const fixtures = db.prepare('SELECT id, rig_x, rig_y, rig_order FROM fixtures ORDER BY rig_order').all();
    const elements = db.prepare('SELECT type, label, x, y, width, height, rotation, sort_order FROM rig_elements ORDER BY sort_order, id').all();
    data = JSON.stringify({ fixtures, elements });
  }
  db.prepare(
    'UPDATE rig_layouts SET name = ?, data = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name ?? existing.name, data, id);
  return { id };
}

function loadRigLayout(id) {
  const row = db.prepare('SELECT * FROM rig_layouts WHERE id = ?').get(id);
  if (!row) return null;
  const data = JSON.parse(row.data);

  const tx = db.transaction(() => {
    // Restore fixture positions
    if (data.fixtures && data.fixtures.length > 0) {
      const stmt = db.prepare('UPDATE fixtures SET rig_x = ?, rig_y = ?, rig_order = ?, updated_at = datetime(\'now\') WHERE id = ?');
      for (const f of data.fixtures) {
        stmt.run(f.rig_x ?? 0.5, f.rig_y ?? 0.5, f.rig_order ?? 0, f.id);
      }
    }

    // Restore rig elements: clear existing, insert saved
    db.prepare('DELETE FROM rig_elements').run();
    if (data.elements && data.elements.length > 0) {
      const ins = db.prepare(
        'INSERT INTO rig_elements (type, label, x, y, width, height, rotation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      );
      for (const el of data.elements) {
        ins.run(el.type || 'truss_h', el.label || '', el.x ?? 0.5, el.y ?? 0.5, el.width ?? 0.4, el.height ?? 0.02, el.rotation ?? 0, el.sort_order ?? 0);
      }
    }
  });
  tx();

  // Mark this layout as the active one
  setActiveRigLayout(id);

  return { loaded: true, name: row.name };
}

function setActiveRigLayout(id) {
  db.prepare('UPDATE rig_layouts SET is_active = 0 WHERE is_active = 1').run();
  if (id) {
    db.prepare('UPDATE rig_layouts SET is_active = 1 WHERE id = ?').run(id);
  }
}

function getActiveRigLayout() {
  return db.prepare('SELECT id, name FROM rig_layouts WHERE is_active = 1').get() || null;
}

function deleteRigLayout(id) {
  db.prepare('DELETE FROM rig_layouts WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Address Overlap Check ──────────────────────────────────────────────────

function checkAddressOverlap(universe, address, channelCount, excludeFixtureId) {
  const fixtures = db.prepare(
    `SELECT f.id, f.name, f.address,
            COALESCE(ftm.channel_count, ft.channel_count) as channel_count
     FROM fixtures f
     JOIN fixture_types ft ON f.fixture_type_id = ft.id
     LEFT JOIN fixture_type_modes ftm ON f.mode_id = ftm.id
     WHERE f.universe = ? ${excludeFixtureId ? 'AND f.id != ?' : ''}`
  ).all(...[universe, ...(excludeFixtureId ? [excludeFixtureId] : [])]);

  const newStart = address;
  const newEnd = address + channelCount - 1;

  for (const f of fixtures) {
    const fStart = f.address;
    const fEnd = f.address + f.channel_count - 1;
    if (newStart <= fEnd && newEnd >= fStart) {
      return `Address overlap with "${f.name}" (ch ${fStart}-${fEnd})`;
    }
  }
  return null;
}

// ─── Universe Map ───────────────────────────────────────────────────────────

function getUniverseMap(universe) {
  const fixtures = db.prepare(`
    SELECT f.id, f.name, f.address, f.output_type,
           COALESCE(ftm.channel_count, ft.channel_count) as channel_count,
           ft.name as type_name, ft.category,
           ftm.name as mode_name
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    LEFT JOIN fixture_type_modes ftm ON f.mode_id = ftm.id
    WHERE f.universe = ?
    ORDER BY f.address
  `).all(universe || 1);

  return fixtures;
}

// ─── Art-Net Universes CRUD ─────────────────────────────────────────────────

function getArtNetUniverses() {
  return db.prepare('SELECT * FROM artnet_universes ORDER BY local_universe').all();
}

function getArtNetUniverse(id) {
  return db.prepare('SELECT * FROM artnet_universes WHERE id = ?').get(id);
}

function createArtNetUniverse({ local_universe, label, ip, port, subnet, artnet_universe, enabled }) {
  if (!local_universe) return { error: 'Local universe is required' };
  try {
    const r = db.prepare(
      `INSERT INTO artnet_universes (local_universe, label, ip, port, subnet, artnet_universe, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      local_universe,
      label || `Universe ${local_universe}`,
      ip || '255.255.255.255',
      port || 6454,
      subnet || 0,
      artnet_universe || 0,
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );
    return db.prepare('SELECT * FROM artnet_universes WHERE id = ?').get(r.lastInsertRowid);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { error: 'This local universe is already configured' };
    return { error: e.message };
  }
}

function updateArtNetUniverse(id, { local_universe, label, ip, port, subnet, artnet_universe, enabled }) {
  const existing = db.prepare('SELECT * FROM artnet_universes WHERE id = ?').get(id);
  if (!existing) return null;
  try {
    db.prepare(
      `UPDATE artnet_universes SET local_universe=?, label=?, ip=?, port=?, subnet=?, artnet_universe=?, enabled=? WHERE id=?`
    ).run(
      local_universe ?? existing.local_universe,
      label !== undefined ? label : existing.label,
      ip || existing.ip,
      port ?? existing.port,
      subnet ?? existing.subnet,
      artnet_universe ?? existing.artnet_universe,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      id
    );
    return db.prepare('SELECT * FROM artnet_universes WHERE id = ?').get(id);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return { error: 'This local universe is already configured' };
    return { error: e.message };
  }
}

function deleteArtNetUniverse(id) {
  db.prepare('DELETE FROM artnet_universes WHERE id = ?').run(id);
  return { deleted: true };
}

function toggleArtNetUniverse(id) {
  db.prepare('UPDATE artnet_universes SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM artnet_universes WHERE id = ?').get(id);
}

// ─── Tracks CRUD ────────────────────────────────────────────────────────────

function getTracks({ search, genre, sourceType, minBpm, maxBpm, key, limit, offset } = {}) {
  let where = [];
  let params = [];

  if (search) {
    where.push(`(author LIKE ? OR title LIKE ? OR filename LIKE ? OR remix LIKE ? OR album LIKE ?)`);
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  if (genre) {
    where.push(`genre = ?`);
    params.push(genre);
  }
  if (sourceType) {
    where.push(`source_type = ?`);
    params.push(sourceType);
  }
  if (minBpm) {
    where.push(`bpm >= ?`);
    params.push(parseFloat(minBpm));
  }
  if (maxBpm) {
    where.push(`bpm <= ?`);
    params.push(parseFloat(maxBpm));
  }
  if (key) {
    where.push(`key = ?`);
    params.push(key);
  }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limitClause = limit ? `LIMIT ? OFFSET ?` : '';
  if (limit) {
    params.push(parseInt(limit), parseInt(offset || 0));
  }

  const tracks = db.prepare(
    `SELECT t.*,
       CASE WHEN ta.track_id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
       ls.id as sequence_id
     FROM tracks t
     LEFT JOIN track_analysis ta ON ta.track_id = t.id
     LEFT JOIN light_sequences ls ON ls.track_id = t.id
     ${whereClause} ORDER BY t.author, t.title ${limitClause}`
  ).all(...params);

  // Get total count for pagination
  const countParams = params.slice(0, params.length - (limit ? 2 : 0));
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM tracks t ${whereClause}`
  ).get(...countParams).c;

  return { tracks, total };
}

function getTrack(id) {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
}

function getTrackByPath(filepath) {
  // Try exact match first
  const exact = db.prepare('SELECT * FROM tracks WHERE filepath = ?').get(filepath);
  if (exact) return exact;

  // Fall back to drive-letter-agnostic match (e.g. E:\Music\... vs H:\Music\...)
  // Compare everything after the drive letter (e.g. "\Music\...")
  const driveMatch = filepath.match(/^[A-Za-z]:\\/);
  if (driveMatch) {
    const pathAfterDrive = filepath.substring(2); // strip "X:" keep "\Music\..."
    return db.prepare('SELECT * FROM tracks WHERE SUBSTR(filepath, 3) = ?').get(pathAfterDrive);
  }

  return null;
}

function updateTrackBeatgridPos(trackId, beatgridPos) {
  return db.prepare('UPDATE tracks SET beatgrid_pos = ? WHERE id = ? AND (beatgrid_pos IS NULL OR beatgrid_pos = 0)').run(beatgridPos, trackId);
}

function getTrackGenres() {
  return db.prepare(
    `SELECT genre, COUNT(*) as count FROM tracks WHERE genre != '' GROUP BY genre ORDER BY count DESC`
  ).all();
}

function getTrackStats() {
  const total = db.prepare('SELECT COUNT(*) as c FROM tracks').get().c;
  const local = db.prepare(`SELECT COUNT(*) as c FROM tracks WHERE source_type = 'local'`).get().c;
  const netsearch = db.prepare(`SELECT COUNT(*) as c FROM tracks WHERE source_type = 'netsearch'`).get().c;
  const withBpm = db.prepare(`SELECT COUNT(*) as c FROM tracks WHERE bpm > 0`).get().c;
  const genres = db.prepare(`SELECT COUNT(DISTINCT genre) as c FROM tracks WHERE genre != ''`).get().c;
  return { total, local, netsearch, withBpm, genres };
}

function importTracks(trackArray) {
  const upsert = db.prepare(`
    INSERT INTO tracks (
      filepath, filename, file_size, flag, author, title, remix, genre, album, year,
      tag_flag, song_length, bitrate, last_modified, first_seen, cover,
      bpm, key, volume, audio_sig, beatgrid_pos, automix_point, poi_json,
      netsearch, source_type, imported_at
    ) VALUES (
      @filepath, @filename, @file_size, @flag, @author, @title, @remix, @genre, @album, @year,
      @tag_flag, @song_length, @bitrate, @last_modified, @first_seen, @cover,
      @bpm, @key, @volume, @audio_sig, @beatgrid_pos, @automix_point, @poi_json,
      @netsearch, @source_type, datetime('now')
    )
    ON CONFLICT(filepath) DO UPDATE SET
      filename=excluded.filename, file_size=excluded.file_size, flag=excluded.flag,
      author=excluded.author, title=excluded.title, remix=excluded.remix,
      genre=excluded.genre, album=excluded.album, year=excluded.year,
      tag_flag=excluded.tag_flag, song_length=excluded.song_length, bitrate=excluded.bitrate,
      last_modified=excluded.last_modified, first_seen=excluded.first_seen, cover=excluded.cover,
      bpm=excluded.bpm, key=excluded.key, volume=excluded.volume, audio_sig=excluded.audio_sig,
      beatgrid_pos=excluded.beatgrid_pos, automix_point=excluded.automix_point, poi_json=excluded.poi_json,
      netsearch=excluded.netsearch, source_type=excluded.source_type, imported_at=datetime('now')
  `);

  const bulkImport = db.transaction((tracks) => {
    let inserted = 0;
    let updated = 0;
    for (const track of tracks) {
      const result = upsert.run(track);
      if (result.changes > 0) {
        if (result.lastInsertRowid) inserted++;
        else updated++;
      }
    }
    return { inserted, updated, total: tracks.length };
  });

  return bulkImport(trackArray);
}

function clearTracks() {
  db.prepare('DELETE FROM tracks').run();
  return { cleared: true };
}

// ─── Fixture Channel Map (for Quick Actions) ────────────────────────────────

function getFixtureChannelMap() {
  const fixtures = db.prepare(`
    SELECT f.id, f.name, f.universe, f.address, f.invert_pan, f.invert_tilt,
           f.home_pan, f.home_tilt, f.mode_id, f.fixture_type_id,
           f.rig_x, f.rig_y, f.rig_order,
           COALESCE(ftm.channel_count, ft.channel_count) as channel_count,
           ft.name as type_name, ft.category,
           ftm.name as mode_name
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    LEFT JOIN fixture_type_modes ftm ON f.mode_id = ftm.id
    ORDER BY f.universe, f.address
  `).all();

  // Pre-load all color wheel maps (keyed by fixture_type_id)
  const cwMaps = getAllColorWheelMaps();

  return fixtures.map(f => {
    // Get channels from the mode (or fall back to fixture_type_id)
    const channels = f.mode_id
      ? db.prepare(
          'SELECT channel_number, name, type, ranges, cell FROM fixture_type_channels WHERE mode_id = ? ORDER BY channel_number'
        ).all(f.mode_id)
      : db.prepare(
          'SELECT channel_number, name, type, ranges, cell FROM fixture_type_channels WHERE fixture_type_id = (SELECT fixture_type_id FROM fixtures WHERE id = ?) ORDER BY channel_number'
        ).all(f.id);
    const group_ids = db.prepare(
      'SELECT group_id FROM fixture_group_members WHERE fixture_id = ?'
    ).all(f.id).map(r => r.group_id);
    const cellNums = channels.filter(ch => ch.cell != null).map(ch => ch.cell);
    const cell_count = cellNums.length > 0 ? Math.max(...cellNums) : 0;
    const color_wheel_map = cwMaps[f.fixture_type_id] || null;
    return {
      ...f,
      group_ids,
      cell_count,
      color_wheel_map,
      channels: channels.map(ch => {
        // Derive per-channel invert from fixture-level pan/tilt invert settings
        const isPan = ch.type === 'pan' || ch.type === 'pan_fine';
        const isTilt = ch.type === 'tilt' || ch.type === 'tilt_fine';
        return {
          dmx_address: f.address + ch.channel_number - 1,
          channel_number: ch.channel_number,
          name: ch.name,
          type: ch.type,
          cell: ch.cell || null,
          ranges: ch.ranges ? JSON.parse(ch.ranges) : null,
          invert: isPan ? !!f.invert_pan : isTilt ? !!f.invert_tilt : false,
        };
      }),
    };
  });
}

// ─── Color Wheel Maps ───────────────────────────────────────────────────────

/**
 * Seed default color wheel map for the Generic 60W Spot Moving Head.
 * DMX values represent the start of each color's range on the physical wheel.
 */
function seedDefaultColorWheelMap() {
  const ft = db.prepare("SELECT id FROM fixture_types WHERE name = 'Generic 60W Spot Moving Head'").get();
  if (!ft) return;
  const existing = db.prepare('SELECT COUNT(*) as c FROM color_wheel_colors WHERE fixture_type_id = ?').get(ft.id).c;
  // Re-seed if count doesn't match (schema was updated)
  if (existing > 0 && existing === 14) return;

  const DEFAULT_60W_COLORS = [
    { dmx_start: 0,   dmx_end: 9,   color_hex: '#FFFFFF', label: 'White' },
    { dmx_start: 10,  dmx_end: 19,  color_hex: '#FF0000', label: 'Red' },
    { dmx_start: 20,  dmx_end: 29,  color_hex: '#FFFF00', label: 'Yellow' },
    { dmx_start: 30,  dmx_end: 39,  color_hex: '#002aff', label: 'Blue' },
    { dmx_start: 40,  dmx_end: 49,  color_hex: '#66ff00', label: 'Green' },
    { dmx_start: 50,  dmx_end: 59,  color_hex: '#FF8000', label: 'Flush Orange' },
    { dmx_start: 60,  dmx_end: 69,  color_hex: '#FF00FF', label: 'Magenta' },
    { dmx_start: 70,  dmx_end: 79,  color_hex: '#00FFFF', label: 'Cyan / Aqua' },
    { dmx_start: 80,  dmx_end: 89,  color_hex: '#7F7FC8', label: 'Moody Blue' },
    { dmx_start: 90,  dmx_end: 99,  color_hex: '#B4B4FF', label: 'Sail' },
    { dmx_start: 100, dmx_end: 109, color_hex: '#FF4600', label: 'Vermilion' },
    { dmx_start: 110, dmx_end: 119, color_hex: '#7FFF7F', label: 'Pastel Green' },
    { dmx_start: 120, dmx_end: 129, color_hex: '#00B4B4', label: 'Bondi Blue' },
    { dmx_start: 130, dmx_end: 139, color_hex: '#7F7F00', label: 'Olive' },
  ];

  const ins = db.prepare(
    'INSERT INTO color_wheel_colors (fixture_type_id, dmx_start, dmx_end, color_hex, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const seed = db.transaction(() => {
    db.prepare('DELETE FROM color_wheel_colors WHERE fixture_type_id = ?').run(ft.id);
    for (let i = 0; i < DEFAULT_60W_COLORS.length; i++) {
      const c = DEFAULT_60W_COLORS[i];
      ins.run(ft.id, c.dmx_start, c.dmx_end, c.color_hex, c.label, i);
    }
  });
  seed();
  console.log(`[DB] Seeded color wheel map for Generic 60W Spot Moving Head (${DEFAULT_60W_COLORS.length} colors)`);
}

/**
 * Get the color wheel map for a fixture type.
 * @returns {Array} Array of { id, dmx_start, dmx_end, color_hex, label }
 */
function getColorWheelMap(fixtureTypeId) {
  return db.prepare(
    'SELECT id, dmx_start, dmx_end, color_hex, label FROM color_wheel_colors WHERE fixture_type_id = ? ORDER BY sort_order, dmx_start'
  ).all(fixtureTypeId);
}

/**
 * Get all color wheel maps, keyed by fixture_type_id.
 * @returns {Object} { fixture_type_id: [{ dmx_start, dmx_end, color_hex, label }] }
 */
function getAllColorWheelMaps() {
  const rows = db.prepare(
    'SELECT fixture_type_id, dmx_start, dmx_end, color_hex, label FROM color_wheel_colors ORDER BY fixture_type_id, sort_order, dmx_start'
  ).all();
  const maps = {};
  for (const r of rows) {
    if (!maps[r.fixture_type_id]) maps[r.fixture_type_id] = [];
    maps[r.fixture_type_id].push({ dmx_start: r.dmx_start, dmx_end: r.dmx_end, color_hex: r.color_hex, label: r.label });
  }
  return maps;
}

/**
 * Set the full color wheel map for a fixture type (replaces existing).
 * @param {number} fixtureTypeId
 * @param {Array} colors - Array of { dmx_start, dmx_end, color_hex, label }
 */
function setColorWheelMap(fixtureTypeId, colors) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM color_wheel_colors WHERE fixture_type_id = ?').run(fixtureTypeId);
    const ins = db.prepare(
      'INSERT INTO color_wheel_colors (fixture_type_id, dmx_start, dmx_end, color_hex, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      ins.run(fixtureTypeId, c.dmx_start, c.dmx_end, c.color_hex || '#FFFFFF', c.label || '', i);
    }
  });
  tx();
  return getColorWheelMap(fixtureTypeId);
}

/**
 * Delete the color wheel map for a fixture type.
 */
function deleteColorWheelMap(fixtureTypeId) {
  db.prepare('DELETE FROM color_wheel_colors WHERE fixture_type_id = ?').run(fixtureTypeId);
}

// ─── Gobo Wheel Map ──────────────────────────────────────────────────────────

function getGoboWheelMap(fixtureTypeId) {
  return db.prepare(
    'SELECT id, dmx_start, dmx_end, label FROM gobo_wheel_slots WHERE fixture_type_id = ? ORDER BY sort_order, dmx_start'
  ).all(fixtureTypeId);
}

function getAllGoboWheelMaps() {
  const rows = db.prepare(
    'SELECT fixture_type_id, dmx_start, dmx_end, label FROM gobo_wheel_slots ORDER BY fixture_type_id, sort_order, dmx_start'
  ).all();
  const maps = {};
  for (const r of rows) {
    if (!maps[r.fixture_type_id]) maps[r.fixture_type_id] = [];
    maps[r.fixture_type_id].push({ dmx_start: r.dmx_start, dmx_end: r.dmx_end, label: r.label });
  }
  return maps;
}

function setGoboWheelMap(fixtureTypeId, slots) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM gobo_wheel_slots WHERE fixture_type_id = ?').run(fixtureTypeId);
    const ins = db.prepare(
      'INSERT INTO gobo_wheel_slots (fixture_type_id, dmx_start, dmx_end, label, sort_order) VALUES (?, ?, ?, ?, ?)'
    );
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      ins.run(fixtureTypeId, s.dmx_start, s.dmx_end, s.label || '', i);
    }
  });
  tx();
  return getGoboWheelMap(fixtureTypeId);
}

function deleteGoboWheelMap(fixtureTypeId) {
  db.prepare('DELETE FROM gobo_wheel_slots WHERE fixture_type_id = ?').run(fixtureTypeId);
}

// ─── Fixture Groups ──────────────────────────────────────────────────────────

function getGroups() {
  const groups = db.prepare('SELECT * FROM fixture_groups ORDER BY name').all();
  for (const g of groups) {
    g.fixture_ids = db.prepare('SELECT fixture_id FROM fixture_group_members WHERE group_id = ?').all(g.id).map(r => r.fixture_id);
  }
  return groups;
}

function getGroup(id) {
  const g = db.prepare('SELECT * FROM fixture_groups WHERE id = ?').get(id);
  if (!g) return null;
  g.fixture_ids = db.prepare('SELECT fixture_id FROM fixture_group_members WHERE group_id = ?').all(id).map(r => r.fixture_id);
  return g;
}

function createGroup({ name, color }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  const result = db.prepare('INSERT INTO fixture_groups (name, color) VALUES (?, ?)').run(name.trim(), color || '#888');
  return getGroup(result.lastInsertRowid);
}

function updateGroup(id, { name, color }) {
  const existing = db.prepare('SELECT * FROM fixture_groups WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare('UPDATE fixture_groups SET name = ?, color = ? WHERE id = ?').run(
    name !== undefined ? name.trim() : existing.name,
    color !== undefined ? color : existing.color,
    id
  );
  return getGroup(id);
}

function deleteGroup(id) {
  db.prepare('DELETE FROM fixture_groups WHERE id = ?').run(id);
  return { deleted: true };
}

function setGroupFixtures(groupId, fixtureIds) {
  const existing = db.prepare('SELECT * FROM fixture_groups WHERE id = ?').get(groupId);
  if (!existing) return { error: 'Group not found' };
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM fixture_group_members WHERE group_id = ?').run(groupId);
    const ins = db.prepare('INSERT INTO fixture_group_members (group_id, fixture_id) VALUES (?, ?)');
    for (const fid of fixtureIds) {
      ins.run(groupId, fid);
    }
  });
  txn();
  return getGroup(groupId);
}

// ─── Mover Presets CRUD ─────────────────────────────────────────────────────

function getMoverPresets() {
  const rows = db.prepare('SELECT * FROM mover_presets ORDER BY sort_order, id').all();
  return rows.map(r => ({ ...r, positions: JSON.parse(r.positions || '[]') }));
}

function getMoverPreset(id) {
  const r = db.prepare('SELECT * FROM mover_presets WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, positions: JSON.parse(r.positions || '[]') };
}

function createMoverPreset({ name, positions }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  if (!Array.isArray(positions) || positions.length === 0) return { error: 'At least one fixture position is required' };
  const result = db.prepare(
    'INSERT INTO mover_presets (name, positions) VALUES (?, ?)'
  ).run(name.trim(), JSON.stringify(positions));
  return getMoverPreset(result.lastInsertRowid);
}

function updateMoverPreset(id, { name, positions }) {
  const existing = db.prepare('SELECT * FROM mover_presets WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    'UPDATE mover_presets SET name = ?, positions = ? WHERE id = ?'
  ).run(
    name !== undefined ? name.trim() : existing.name,
    positions !== undefined ? JSON.stringify(positions) : existing.positions,
    id
  );
  return getMoverPreset(id);
}

function deleteMoverPreset(id) {
  const row = db.prepare('SELECT is_system FROM mover_presets WHERE id = ?').get(id);
  if (row && row.is_system) return { error: 'System presets cannot be deleted' };
  db.prepare('DELETE FROM mover_presets WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Default Mover Position Presets (seeded on first run) ───────────────────

// System default movement presets — match the QA quick-action positions
// These are seeded as is_system=1 and cannot be deleted by the user
const SYSTEM_MOVER_PRESETS = [
  { name: 'Centre',    icon: '◎', pan: 128, tilt: 128 },
  { name: 'Up',        icon: '⬆', pan: 128, tilt: 0 },
  { name: 'Down',      icon: '⬇', pan: 128, tilt: 255 },
  { name: 'Left',      icon: '⬅', pan: 0,   tilt: 128 },
  { name: 'Right',     icon: '➡', pan: 255, tilt: 128 },
  { name: 'Top Left',  icon: '↖', pan: 0,   tilt: 0 },
  { name: 'Top Right', icon: '↗', pan: 255, tilt: 0 },
  { name: 'Bot Left',  icon: '↙', pan: 0,   tilt: 255 },
  { name: 'Bot Right', icon: '↘', pan: 255, tilt: 255 },
];

function seedDefaultMoverPresets() {
  // Check if system presets exist (migration-safe)
  const sysCount = db.prepare('SELECT COUNT(*) as c FROM mover_presets WHERE is_system = 1').get().c;
  if (sysCount >= SYSTEM_MOVER_PRESETS.length) return; // already seeded

  // Get all mover fixtures (those with pan + tilt channels)
  const fixtures = getFixtures();
  const movers = fixtures.filter(f =>
    f.channels.some(ch => ch.type === 'pan') &&
    f.channels.some(ch => ch.type === 'tilt')
  );

  // Seed system presets even with no movers — positions will be empty until fixtures are added
  const ins = db.prepare('INSERT INTO mover_presets (name, positions, sort_order, is_system, icon) VALUES (?, ?, ?, 1, ?)');
  const seed = db.transaction(() => {
    // Remove any old system presets to avoid duplicates during migration
    db.prepare('DELETE FROM mover_presets WHERE is_system = 1').run();
    for (let i = 0; i < SYSTEM_MOVER_PRESETS.length; i++) {
      const pos = SYSTEM_MOVER_PRESETS[i];
      const positions = movers.map(fix => ({
        fixture_id: fix.id, pan: pos.pan, tilt: pos.tilt
      }));
      ins.run(pos.name, JSON.stringify(positions), i, pos.icon);
    }
  });
  seed();
  console.log(`[DB] Seeded ${SYSTEM_MOVER_PRESETS.length} system mover presets for ${movers.length} mover(s)`);
}

// ─── Generator Config (stored in config table as JSON) ──────────────────────

const GENERATOR_CONFIG_DEFAULTS = {
  gen_color_palettes: {
    vibrant: {
      label: 'Vibrant',
      intro:     [[ {r:180,g:0,b:60},   {r:0,g:40,b:200}    ], [ {r:0,g:40,b:180},   {r:160,g:0,b:120}  ], [ {r:120,g:0,b:200}, {r:200,g:60,b:0}   ]],
      verse:     [[ {r:255,g:0,b:40},   {r:0,g:180,b:120}   ], [ {r:0,g:200,b:80},   {r:255,g:60,b:0}   ], [ {r:200,g:0,b:180}, {r:0,g:120,b:255}  ], [ {r:255,g:120,b:0}, {r:0,g:200,b:200} ]],
      chorus:    [[ {r:255,g:0,b:60},   {r:255,g:100,b:0}   ], [ {r:255,g:0,b:200},  {r:255,g:60,b:0}   ], [ {r:200,g:0,b:255}, {r:255,g:0,b:80}  ], [ {r:255,g:40,b:0}, {r:200,g:0,b:200} ]],
      bridge:    [[ {r:255,g:200,b:0},  {r:200,g:0,b:160}   ], [ {r:255,g:0,b:100},  {r:0,g:180,b:255}  ], [ {r:180,g:255,b:0}, {r:255,g:40,b:80}  ]],
      breakdown: [[ {r:0,g:100,b:200},  {r:120,g:0,b:100}   ], [ {r:100,g:0,b:160},  {r:0,g:80,b:180}   ]],
      buildup:   [[ {r:255,g:120,b:0},  {r:255,g:0,b:120}   ], [ {r:200,g:80,b:0},   {r:255,g:40,b:200} ]],
      drop:      [[ {r:255,g:0,b:0},    {r:0,g:0,b:255}     ], [ {r:255,g:0,b:120},  {r:255,g:255,b:0}  ], [ {r:255,g:50,b:0}, {r:200,g:0,b:255} ], [ {r:255,g:0,b:0}, {r:0,g:255,b:0} ]],
      outro:     [[ {r:120,g:30,b:80},  {r:20,g:10,b:40}    ], [ {r:80,g:40,b:100},  {r:40,g:10,b:30}   ]],
    },
    neon: {
      label: 'Neon',
      intro:     [[ {r:255,g:0,b:80},   {r:0,g:100,b:255}   ], [ {r:100,g:0,b:255},  {r:0,g:255,b:200}  ]],
      verse:     [[ {r:255,g:0,b:100},  {r:0,g:255,b:0}     ], [ {r:0,g:255,b:255},  {r:255,g:255,b:0}  ], [ {r:255,g:0,b:200}, {r:0,g:255,b:100} ], [ {r:255,g:60,b:0}, {r:0,g:200,b:255} ]],
      chorus:    [[ {r:255,g:0,b:255},  {r:0,g:255,b:0}     ], [ {r:255,g:255,b:0},  {r:255,g:0,b:0}    ], [ {r:0,g:200,b:255}, {r:255,g:0,b:200} ]],
      bridge:    [[ {r:200,g:255,b:0},  {r:0,g:200,b:255}   ], [ {r:255,g:0,b:150},  {r:0,g:255,b:150}  ]],
      breakdown: [[ {r:0,g:100,b:255},  {r:0,g:60,b:150}    ], [ {r:80,g:0,b:200},   {r:0,g:150,b:200}  ]],
      buildup:   [[ {r:255,g:255,b:0},  {r:255,g:0,b:255}   ], [ {r:0,g:255,b:0},    {r:255,g:100,b:0}  ]],
      drop:      [[ {r:255,g:0,b:255},  {r:0,g:255,b:0}     ], [ {r:0,g:255,b:255},  {r:255,g:0,b:0}    ], [ {r:255,g:255,b:0}, {r:255,g:0,b:255} ]],
      outro:     [[ {r:0,g:80,b:120},   {r:0,g:30,b:60}     ], [ {r:60,g:0,b:100},   {r:20,g:0,b:50}    ]],
    },
    warm: {
      label: 'Warm',
      intro:     [[ {r:120,g:40,b:0},   {r:180,g:80,b:10}   ], [ {r:100,g:30,b:0},   {r:150,g:60,b:0}   ]],
      verse:     [[ {r:255,g:100,b:0},  {r:200,g:60,b:0}    ], [ {r:255,g:140,b:20}, {r:220,g:80,b:0}   ], [ {r:200,g:80,b:0}, {r:255,g:120,b:20} ]],
      chorus:    [[ {r:255,g:40,b:0},   {r:255,g:180,b:0}   ], [ {r:255,g:0,b:0},    {r:255,g:200,b:50} ], [ {r:255,g:80,b:0}, {r:200,g:0,b:0}   ]],
      bridge:    [[ {r:255,g:200,b:50}, {r:200,g:100,b:0}   ], [ {r:220,g:160,b:0},  {r:180,g:60,b:0}   ]],
      breakdown: [[ {r:120,g:60,b:20},  {r:80,g:30,b:0}     ], [ {r:100,g:50,b:10},  {r:60,g:20,b:0}    ]],
      buildup:   [[ {r:255,g:60,b:0},   {r:255,g:200,b:0}   ], [ {r:200,g:40,b:0},   {r:255,g:160,b:0}  ]],
      drop:      [[ {r:255,g:0,b:0},    {r:255,g:200,b:0}   ], [ {r:255,g:80,b:0},   {r:255,g:255,b:0}  ], [ {r:200,g:0,b:0}, {r:255,g:120,b:0} ]],
      outro:     [[ {r:100,g:40,b:10},  {r:40,g:15,b:0}     ], [ {r:80,g:30,b:5},    {r:20,g:8,b:0}     ]],
    },
    cool: {
      label: 'Cool',
      intro:     [[ {r:0,g:30,b:180},   {r:20,g:60,b:220}   ], [ {r:0,g:20,b:140},   {r:10,g:40,b:180}  ]],
      verse:     [[ {r:0,g:100,b:200},  {r:60,g:0,b:180}    ], [ {r:0,g:150,b:220},  {r:80,g:0,b:200}   ], [ {r:40,g:80,b:255}, {r:0,g:120,b:180} ]],
      chorus:    [[ {r:0,g:80,b:255},   {r:120,g:0,b:255}   ], [ {r:0,g:180,b:255},  {r:80,g:0,b:200}   ], [ {r:100,g:0,b:255}, {r:0,g:200,b:200} ]],
      bridge:    [[ {r:80,g:120,b:255}, {r:0,g:180,b:180}   ], [ {r:60,g:80,b:220},  {r:0,g:140,b:200}  ]],
      breakdown: [[ {r:0,g:40,b:120},   {r:0,g:20,b:80}     ], [ {r:20,g:30,b:100},  {r:0,g:15,b:60}    ]],
      buildup:   [[ {r:0,g:100,b:255},  {r:120,g:0,b:255}   ], [ {r:0,g:150,b:200},  {r:100,g:50,b:255} ]],
      drop:      [[ {r:0,g:0,b:255},    {r:200,g:0,b:255}   ], [ {r:0,g:100,b:255},  {r:150,g:0,b:200}  ], [ {r:80,g:0,b:255}, {r:0,g:200,b:255} ]],
      outro:     [[ {r:0,g:20,b:80},    {r:0,g:8,b:30}      ], [ {r:10,g:15,b:60},   {r:0,g:5,b:20}     ]],
    },
    pastel: {
      label: 'Pastel',
      intro:     [[ {r:180,g:200,b:255}, {r:200,g:180,b:240} ], [ {r:200,g:220,b:255}, {r:180,g:200,b:230} ]],
      verse:     [[ {r:180,g:255,b:200}, {r:200,g:180,b:255} ], [ {r:255,g:200,b:180}, {r:180,g:220,b:255} ], [ {r:220,g:200,b:255}, {r:200,g:255,b:220} ]],
      chorus:    [[ {r:255,g:180,b:200}, {r:200,g:180,b:255} ], [ {r:255,g:220,b:180}, {r:180,g:200,b:255} ], [ {r:255,g:200,b:220}, {r:180,g:255,b:200} ]],
      bridge:    [[ {r:255,g:240,b:180}, {r:200,g:180,b:255} ], [ {r:220,g:255,b:200}, {r:200,g:200,b:255} ]],
      breakdown: [[ {r:180,g:200,b:240}, {r:160,g:180,b:220} ], [ {r:200,g:200,b:230}, {r:180,g:190,b:210} ]],
      buildup:   [[ {r:255,g:200,b:180}, {r:200,g:180,b:255} ], [ {r:255,g:180,b:200}, {r:180,g:200,b:255} ]],
      drop:      [[ {r:255,g:180,b:200}, {r:180,g:200,b:255} ], [ {r:255,g:200,b:180}, {r:200,g:180,b:255} ], [ {r:200,g:255,b:200}, {r:255,g:200,b:255} ]],
      outro:     [[ {r:180,g:180,b:200}, {r:140,g:140,b:160} ], [ {r:160,g:170,b:190}, {r:120,g:130,b:150} ]],
    },
    fire: {
      label: 'Fire',
      intro:     [[ {r:80,g:20,b:0},    {r:140,g:40,b:0}    ], [ {r:60,g:10,b:0},    {r:100,g:30,b:0}   ]],
      verse:     [[ {r:255,g:60,b:0},   {r:200,g:30,b:0}    ], [ {r:255,g:100,b:0},  {r:180,g:20,b:0}   ], [ {r:220,g:80,b:0}, {r:255,g:40,b:0} ]],
      chorus:    [[ {r:255,g:0,b:0},    {r:255,g:200,b:0}   ], [ {r:255,g:80,b:0},   {r:255,g:255,b:0}  ], [ {r:200,g:0,b:0}, {r:255,g:150,b:0} ]],
      bridge:    [[ {r:255,g:150,b:0},  {r:200,g:60,b:0}    ], [ {r:255,g:180,b:30}, {r:180,g:40,b:0}   ]],
      breakdown: [[ {r:80,g:20,b:0},    {r:40,g:10,b:0}     ], [ {r:60,g:15,b:0},    {r:30,g:5,b:0}     ]],
      buildup:   [[ {r:255,g:80,b:0},   {r:255,g:0,b:0}     ], [ {r:200,g:60,b:0},   {r:255,g:200,b:0}  ]],
      drop:      [[ {r:255,g:0,b:0},    {r:255,g:255,b:0}   ], [ {r:255,g:100,b:0},  {r:255,g:0,b:0}    ], [ {r:200,g:0,b:0}, {r:255,g:200,b:0} ]],
      outro:     [[ {r:60,g:15,b:0},    {r:20,g:5,b:0}      ], [ {r:40,g:10,b:0},    {r:10,g:2,b:0}     ]],
    },
    ocean: {
      label: 'Ocean',
      intro:     [[ {r:0,g:40,b:120},   {r:0,g:80,b:160}    ], [ {r:0,g:30,b:100},   {r:0,g:60,b:140}   ]],
      verse:     [[ {r:0,g:120,b:200},  {r:0,g:180,b:180}   ], [ {r:0,g:100,b:220},  {r:0,g:200,b:160}  ], [ {r:0,g:160,b:200}, {r:0,g:200,b:180} ]],
      chorus:    [[ {r:0,g:200,b:255},  {r:0,g:100,b:200}   ], [ {r:0,g:255,b:200},  {r:0,g:120,b:255}  ], [ {r:0,g:180,b:255}, {r:0,g:255,b:180} ]],
      bridge:    [[ {r:0,g:180,b:200},  {r:0,g:120,b:160}   ], [ {r:0,g:200,b:180},  {r:0,g:140,b:180}  ]],
      breakdown: [[ {r:0,g:40,b:100},   {r:0,g:20,b:60}     ], [ {r:0,g:30,b:80},    {r:0,g:15,b:50}    ]],
      buildup:   [[ {r:0,g:150,b:255},  {r:0,g:200,b:200}   ], [ {r:0,g:100,b:200},  {r:0,g:255,b:180}  ]],
      drop:      [[ {r:0,g:200,b:255},  {r:0,g:255,b:200}   ], [ {r:0,g:150,b:255},  {r:0,g:255,b:255}  ], [ {r:0,g:255,b:150}, {r:0,g:100,b:255} ]],
      outro:     [[ {r:0,g:20,b:60},    {r:0,g:8,b:25}      ], [ {r:0,g:15,b:40},    {r:0,g:5,b:15}     ]],
    },
    sunset: {
      label: 'Sunset',
      intro:     [[ {r:120,g:40,b:80},  {r:160,g:60,b:100}  ], [ {r:100,g:30,b:60},  {r:140,g:50,b:90}  ]],
      verse:     [[ {r:255,g:100,b:60}, {r:200,g:60,b:120}   ], [ {r:255,g:120,b:80}, {r:180,g:40,b:140} ], [ {r:220,g:80,b:100}, {r:200,g:60,b:160} ]],
      chorus:    [[ {r:255,g:60,b:80},  {r:255,g:160,b:0}    ], [ {r:255,g:80,b:120}, {r:255,g:200,b:40} ], [ {r:200,g:40,b:160}, {r:255,g:120,b:0} ]],
      bridge:    [[ {r:200,g:120,b:160},{r:255,g:160,b:80}   ], [ {r:180,g:100,b:140},{r:220,g:140,b:60} ]],
      breakdown: [[ {r:100,g:40,b:80},  {r:60,g:20,b:50}     ], [ {r:80,g:30,b:60},   {r:40,g:15,b:40}  ]],
      buildup:   [[ {r:255,g:80,b:40},  {r:200,g:40,b:120}   ], [ {r:255,g:120,b:60}, {r:220,g:60,b:160}]],
      drop:      [[ {r:255,g:40,b:80},  {r:255,g:200,b:0}    ], [ {r:255,g:80,b:60},  {r:200,g:0,b:160} ], [ {r:255,g:0,b:120}, {r:255,g:180,b:40} ]],
      outro:     [[ {r:80,g:30,b:50},   {r:30,g:10,b:20}     ], [ {r:60,g:20,b:40},   {r:20,g:8,b:15}   ]],
    },
    uv: {
      label: 'UV / Blacklight',
      intro:     [[ {r:40,g:0,b:120},   {r:80,g:0,b:200}    ], [ {r:30,g:0,b:100},   {r:60,g:0,b:160}   ]],
      verse:     [[ {r:100,g:0,b:255},  {r:60,g:0,b:200}    ], [ {r:120,g:0,b:220},  {r:80,g:20,b:255}  ], [ {r:80,g:0,b:200}, {r:140,g:0,b:255} ]],
      chorus:    [[ {r:160,g:0,b:255},  {r:80,g:0,b:200}    ], [ {r:200,g:0,b:255},  {r:100,g:0,b:255}  ], [ {r:120,g:0,b:255}, {r:180,g:0,b:200} ]],
      bridge:    [[ {r:140,g:40,b:255}, {r:80,g:0,b:200}    ], [ {r:120,g:20,b:240}, {r:60,g:0,b:180}   ]],
      breakdown: [[ {r:30,g:0,b:80},    {r:15,g:0,b:40}     ], [ {r:20,g:0,b:60},    {r:10,g:0,b:30}    ]],
      buildup:   [[ {r:120,g:0,b:255},  {r:200,g:0,b:200}   ], [ {r:80,g:0,b:200},   {r:160,g:0,b:255}  ]],
      drop:      [[ {r:200,g:0,b:255},  {r:255,g:0,b:200}   ], [ {r:160,g:0,b:255},  {r:100,g:0,b:255}  ], [ {r:255,g:0,b:255}, {r:80,g:0,b:200} ]],
      outro:     [[ {r:20,g:0,b:60},    {r:8,g:0,b:25}      ], [ {r:15,g:0,b:40},    {r:5,g:0,b:15}     ]],
    },
    forest: {
      label: 'Forest',
      intro:     [[ {r:0,g:60,b:20},    {r:20,g:100,b:40}   ], [ {r:0,g:40,b:10},    {r:10,g:80,b:30}   ]],
      verse:     [[ {r:0,g:180,b:60},   {r:40,g:200,b:80}   ], [ {r:20,g:160,b:40},  {r:60,g:220,b:100} ], [ {r:0,g:200,b:80}, {r:80,g:180,b:40} ]],
      chorus:    [[ {r:80,g:255,b:0},   {r:0,g:200,b:100}   ], [ {r:40,g:255,b:60},  {r:0,g:220,b:80}   ], [ {r:100,g:255,b:40}, {r:0,g:180,b:120} ]],
      bridge:    [[ {r:100,g:200,b:60}, {r:40,g:160,b:80}   ], [ {r:80,g:220,b:40},  {r:20,g:180,b:60}  ]],
      breakdown: [[ {r:0,g:40,b:15},    {r:0,g:20,b:8}      ], [ {r:0,g:30,b:10},    {r:0,g:15,b:5}     ]],
      buildup:   [[ {r:60,g:200,b:0},   {r:0,g:255,b:80}    ], [ {r:40,g:180,b:0},   {r:80,g:255,b:40}  ]],
      drop:      [[ {r:0,g:255,b:0},    {r:100,g:255,b:0}   ], [ {r:60,g:255,b:40},  {r:0,g:200,b:0}    ], [ {r:80,g:255,b:0}, {r:0,g:255,b:80} ]],
      outro:     [[ {r:0,g:30,b:10},    {r:0,g:10,b:5}      ], [ {r:0,g:20,b:8},     {r:0,g:5,b:2}      ]],
    },
    party: {
      label: 'Party Mix',
      intro:     [[ {r:200,g:0,b:200},  {r:0,g:100,b:255}   ], [ {r:100,g:0,b:255},  {r:0,g:200,b:200}  ]],
      verse:     [[ {r:255,g:0,b:100},  {r:0,g:255,b:100}   ], [ {r:255,g:200,b:0},  {r:0,g:100,b:255}  ], [ {r:0,g:255,b:200}, {r:255,g:0,b:200} ], [ {r:100,g:255,b:0}, {r:255,g:0,b:100} ]],
      chorus:    [[ {r:255,g:0,b:0},    {r:0,g:0,b:255}     ], [ {r:255,g:255,b:0},  {r:0,g:255,b:255}  ], [ {r:255,g:0,b:255}, {r:0,g:255,b:0}  ], [ {r:255,g:100,b:0}, {r:0,g:200,b:255} ]],
      bridge:    [[ {r:0,g:255,b:200},  {r:255,g:200,b:0}   ], [ {r:200,g:100,b:255},{r:0,g:200,b:100}  ]],
      breakdown: [[ {r:60,g:0,b:100},   {r:0,g:60,b:100}    ], [ {r:40,g:0,b:80},    {r:0,g:40,b:80}    ]],
      buildup:   [[ {r:255,g:0,b:200},  {r:255,g:200,b:0}   ], [ {r:0,g:255,b:200},  {r:255,g:0,b:100}  ]],
      drop:      [[ {r:255,g:0,b:0},    {r:0,g:255,b:0}     ], [ {r:0,g:0,b:255},    {r:255,g:255,b:0}  ], [ {r:255,g:0,b:255}, {r:0,g:255,b:255} ], [ {r:255,g:100,b:0}, {r:100,g:0,b:255} ]],
      outro:     [[ {r:60,g:0,b:80},    {r:20,g:0,b:30}     ], [ {r:0,g:40,b:60},    {r:0,g:15,b:25}    ]],
    },
  },
  gen_genre_presets: {
    default:     { label: 'Default',           intensityMult: 1.0,  strobeMult: 1.0, cueDensityMult: 1.0, preferredPalette: null,     beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
    electronic:  { label: 'Electronic / EDM',  intensityMult: 1.1,  strobeMult: 1.4, cueDensityMult: 1.2, preferredPalette: 'neon',   beatColorMult: 0.8, flashOnSection: true,  accentPulses: true  },
    house:       { label: 'House / Techno',    intensityMult: 1.0,  strobeMult: 1.2, cueDensityMult: 1.0, preferredPalette: 'neon',   beatColorMult: 0.9, flashOnSection: true,  accentPulses: true  },
    trance:      { label: 'Trance',            intensityMult: 1.05, strobeMult: 1.0, cueDensityMult: 0.8, preferredPalette: 'cool',   beatColorMult: 0.7, flashOnSection: true,  accentPulses: true  },
    dnb:         { label: 'Drum & Bass',       intensityMult: 1.2,  strobeMult: 1.8, cueDensityMult: 1.5, preferredPalette: 'fire',   beatColorMult: 0.6, flashOnSection: true,  accentPulses: false },
    hiphop:      { label: 'Hip-Hop / Rap',     intensityMult: 0.85, strobeMult: 0.5, cueDensityMult: 0.7, preferredPalette: 'warm',   beatColorMult: 1.5, flashOnSection: false, accentPulses: true  },
    rnb:         { label: 'R&B / Soul',        intensityMult: 0.75, strobeMult: 0.3, cueDensityMult: 0.6, preferredPalette: 'sunset', beatColorMult: 1.8, flashOnSection: false, accentPulses: true  },
    pop:         { label: 'Pop',               intensityMult: 0.95, strobeMult: 0.8, cueDensityMult: 1.0, preferredPalette: 'party',  beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
    rock:        { label: 'Rock',              intensityMult: 1.1,  strobeMult: 1.0, cueDensityMult: 0.9, preferredPalette: 'fire',   beatColorMult: 1.2, flashOnSection: true,  accentPulses: false },
    latin:       { label: 'Latin / Reggaeton', intensityMult: 1.0,  strobeMult: 0.6, cueDensityMult: 1.0, preferredPalette: 'warm',   beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
    ambient:     { label: 'Ambient / Chill',   intensityMult: 0.5,  strobeMult: 0.0, cueDensityMult: 0.4, preferredPalette: 'cool',   beatColorMult: 3.0, flashOnSection: false, accentPulses: false },
    reggae:      { label: 'Reggae / Dub',      intensityMult: 0.8,  strobeMult: 0.3, cueDensityMult: 0.7, preferredPalette: 'forest', beatColorMult: 1.5, flashOnSection: false, accentPulses: true  },
    metal:       { label: 'Metal / Hardcore',  intensityMult: 1.3,  strobeMult: 2.0, cueDensityMult: 1.5, preferredPalette: 'fire',   beatColorMult: 0.5, flashOnSection: true,  accentPulses: false },
  },
  gen_genre_aliases: {
    'edm': 'electronic', 'electro': 'electronic', 'dance': 'electronic', 'electronica': 'electronic',
    'house': 'house', 'deep house': 'house', 'tech house': 'house', 'techno': 'house',
    'progressive house': 'house', 'future house': 'house', 'electro house': 'house',
    'minimal': 'house', 'minimal techno': 'house',
    'trance': 'trance', 'progressive trance': 'trance', 'psytrance': 'trance', 'psy trance': 'trance',
    'uplifting trance': 'trance', 'vocal trance': 'trance',
    'drum and bass': 'dnb', 'drum & bass': 'dnb', 'dnb': 'dnb', 'd&b': 'dnb',
    'jungle': 'dnb', 'liquid dnb': 'dnb', 'neurofunk': 'dnb',
    'dubstep': 'dnb', 'riddim': 'dnb', 'brostep': 'dnb',
    'hip hop': 'hiphop', 'hip-hop': 'hiphop', 'hiphop': 'hiphop', 'rap': 'hiphop',
    'trap': 'hiphop', 'grime': 'hiphop',
    'r&b': 'rnb', 'rnb': 'rnb', 'soul': 'rnb', 'r & b': 'rnb', 'neo soul': 'rnb',
    'funk': 'rnb', 'disco': 'rnb',
    'pop': 'pop', 'indie pop': 'pop', 'synth pop': 'pop', 'synthpop': 'pop',
    'electropop': 'pop', 'dance pop': 'pop', 'k-pop': 'pop',
    'rock': 'rock', 'indie': 'rock', 'indie rock': 'rock', 'alternative': 'rock',
    'punk': 'rock', 'punk rock': 'rock', 'post-punk': 'rock', 'grunge': 'rock',
    'latin': 'latin', 'reggaeton': 'latin', 'dembow': 'latin', 'salsa': 'latin',
    'bachata': 'latin', 'cumbia': 'latin', 'merengue': 'latin', 'moombahton': 'latin',
    'ambient': 'ambient', 'chill': 'ambient', 'chillout': 'ambient', 'downtempo': 'ambient',
    'lo-fi': 'ambient', 'lofi': 'ambient', 'new age': 'ambient',
    'reggae': 'reggae', 'dub': 'reggae', 'dancehall': 'reggae', 'ska': 'reggae',
    'metal': 'metal', 'heavy metal': 'metal', 'death metal': 'metal',
    'hardcore': 'metal', 'hard rock': 'metal', 'thrash': 'metal', 'hardstyle': 'metal',
    'gabber': 'metal',
  },
  gen_section_styles: {
    intro:     { intensity: [0.4, 0.75],  beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
    verse:     { intensity: [0.65, 0.9],   beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
    chorus:    { intensity: [0.85, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.2,  strobeDurationBeats: 0.5,  cuePerBars: 1 },
    bridge:    { intensity: [0.6, 0.8],    beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
    breakdown: { intensity: [0.3, 0.55],   beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
    buildup:   { intensity: [0.45, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.15, strobeDurationBeats: 0.25, cuePerBars: 1, rampIntensity: true, buildEnergy: true },
    drop:      { intensity: [0.9, 1.0],    beatColorChange: true,  beatColorBars: 0.5, strobeChance: 0.35, strobeDurationBeats: 0.5, cuePerBars: 0.5, dropEnergy: true },
    outro:     { intensity: [0.6, 0.2],    beatColorChange: false, strobeChance: 0,    cuePerBars: 4, fadeOut: true },
  },
  gen_movement_styles: {
    intro:     { barsPerMove: 4,   range: 0.4, speed: 'slow' },
    verse:     { barsPerMove: 2,   range: 0.5, speed: 'medium' },
    chorus:    { barsPerMove: 1,   range: 0.8, speed: 'fast' },
    bridge:    { barsPerMove: 2,   range: 0.5, speed: 'medium' },
    breakdown: { barsPerMove: 4,   range: 0.3, speed: 'slow' },
    buildup:   { barsPerMove: 0.5, range: 0.8, speed: 'fast' },
    drop:      { barsPerMove: 0.5, range: 1.0, speed: 'fast' },
    outro:     { barsPerMove: 4,   range: 0.3, speed: 'slow' },
  },
  gen_speed_dmx: { slow: 200, medium: 140, fast: 40 },
  gen_section_effects: {
    intro:     { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'fire'] },
    verse:     { regular: ['pulse', 'color_fade', 'rainbow'], cellAware: ['color_wave', 'sparkle'] },
    chorus:    { regular: ['rainbow', 'pulse', 'strobe'],     cellAware: ['chase', 'scanner', 'sparkle'] },
    bridge:    { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'sparkle'] },
    breakdown: { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'] },
    buildup:   { regular: ['pulse', 'strobe'],                cellAware: ['buildup', 'comet', 'chase'] },
    drop:      { regular: ['rainbow', 'strobe', 'pulse'],     cellAware: ['chase', 'scanner', 'sparkle', 'comet', 'buildup'] },
    outro:     { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'] },
  },
  gen_cell_patterns: {
    intro:     ['fill_sweep', 'color_wave', 'breathe'],
    verse:     ['chase_slow', 'alternate', 'color_wave', 'fill_sweep', 'chase'],
    chorus:    ['chase', 'alternate', 'scatter', 'all_flash'],
    bridge:    ['color_wave', 'alternate', 'chase_slow'],
    breakdown: ['fill_sweep', 'breathe'],
    buildup:   ['build_reveal', 'chase_accel'],
    drop:      ['chase_fast', 'scatter_strobe', 'alternate_fast', 'all_flash'],
    outro:     ['fill_sweep', 'color_wave', 'breathe'],
  },
  gen_fixture_intensity: {
    par:         { intro: 0.90, verse: 0.85, chorus: 0.95, bridge: 0.80, breakdown: 0.70, buildup: 0.85, drop: 1.00, outro: 0.90 },
    mover:       { intro: 0.55, verse: 0.70, chorus: 0.90, bridge: 0.65, breakdown: 0.45, buildup: 0.75, drop: 1.00, outro: 0.50 },
    led_bar:     { intro: 0.65, verse: 0.75, chorus: 1.00, bridge: 0.60, breakdown: 0.50, buildup: 0.80, drop: 1.00, outro: 0.55 },
    color_wheel: { intro: 0.70, verse: 0.80, chorus: 1.00, bridge: 0.70, breakdown: 0.50, buildup: 0.85, drop: 1.00, outro: 0.60 },
  },
};

function seedDefaultGeneratorConfig() {
  const ins = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
  const seed = db.transaction(() => {
    for (const [key, value] of Object.entries(GENERATOR_CONFIG_DEFAULTS)) {
      ins.run(key, JSON.stringify(value));
    }
  });
  seed();
}

function getGeneratorConfig() {
  const keys = Object.keys(GENERATOR_CONFIG_DEFAULTS);
  const result = {};
  for (const key of keys) {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
    try {
      result[key] = row ? JSON.parse(row.value) : GENERATOR_CONFIG_DEFAULTS[key];
    } catch (e) {
      result[key] = GENERATOR_CONFIG_DEFAULTS[key];
    }
  }
  return result;
}

function getGeneratorConfigKey(key) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  try {
    return row ? JSON.parse(row.value) : (GENERATOR_CONFIG_DEFAULTS[key] || null);
  } catch (e) {
    return GENERATOR_CONFIG_DEFAULTS[key] || null;
  }
}

function setGeneratorConfigKey(key, value) {
  db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

function resetGeneratorConfig() {
  const del = db.prepare('DELETE FROM config WHERE key = ?');
  const ins = db.prepare('INSERT INTO config (key, value) VALUES (?, ?)');
  const reset = db.transaction(() => {
    for (const [key, value] of Object.entries(GENERATOR_CONFIG_DEFAULTS)) {
      del.run(key);
      ins.run(key, JSON.stringify(value));
    }
  });
  reset();
  return getGeneratorConfig();
}

// ─── OS2L Button Maps CRUD ──────────────────────────────────────────────────

function getButtonMaps() {
  return db.prepare('SELECT * FROM os2l_button_maps ORDER BY sort_order, id').all();
}

function getEnabledButtonMaps() {
  return db.prepare('SELECT * FROM os2l_button_maps WHERE enabled = 1 ORDER BY sort_order, id').all();
}

function getButtonMap(id) {
  return db.prepare('SELECT * FROM os2l_button_maps WHERE id = ?').get(id);
}

function createButtonMap({ name, os2l_event, os2l_value, action_type, action_data, toggle_mode }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  if (!os2l_value && os2l_value !== '') return { error: 'OS2L value is required' };
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM os2l_button_maps').get().next;
  const r = db.prepare(
    `INSERT INTO os2l_button_maps (name, os2l_event, os2l_value, action_type, action_data, toggle_mode, enabled, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).run(
    name.trim(),
    os2l_event || 'btn',
    os2l_value || '',
    action_type || 'blackout',
    typeof action_data === 'object' ? JSON.stringify(action_data) : (action_data || '{}'),
    toggle_mode || 'fire',
    maxOrder
  );
  return db.prepare('SELECT * FROM os2l_button_maps WHERE id = ?').get(r.lastInsertRowid);
}

function updateButtonMap(id, { name, os2l_event, os2l_value, action_type, action_data, toggle_mode, enabled }) {
  const existing = db.prepare('SELECT * FROM os2l_button_maps WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE os2l_button_maps SET name=?, os2l_event=?, os2l_value=?, action_type=?, action_data=?, toggle_mode=?, enabled=? WHERE id=?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    os2l_event !== undefined ? os2l_event : existing.os2l_event,
    os2l_value !== undefined ? os2l_value : existing.os2l_value,
    action_type !== undefined ? action_type : existing.action_type,
    action_data !== undefined ? (typeof action_data === 'object' ? JSON.stringify(action_data) : action_data) : existing.action_data,
    toggle_mode !== undefined ? toggle_mode : existing.toggle_mode,
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    id
  );
  return db.prepare('SELECT * FROM os2l_button_maps WHERE id = ?').get(id);
}

function deleteButtonMap(id) {
  db.prepare('DELETE FROM os2l_button_maps WHERE id = ?').run(id);
  return { deleted: true };
}

function toggleButtonMap(id) {
  db.prepare('UPDATE os2l_button_maps SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM os2l_button_maps WHERE id = ?').get(id);
}

// ─── Effects CRUD ───────────────────────────────────────────────────────────

function getEffects() {
  const rows = db.prepare('SELECT * FROM effects ORDER BY fixture_target, category, name').all();
  return rows.map(r => ({ ...r, effect_data: JSON.parse(r.effect_data || '{}') }));
}

function getEffect(id) {
  const r = db.prepare('SELECT * FROM effects WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, effect_data: JSON.parse(r.effect_data || '{}') };
}

function createEffect({ name, type, category, fixture_target, effect_data, duration_beats }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  const dataJson = typeof effect_data === 'string' ? effect_data : JSON.stringify(effect_data || {});
  const result = db.prepare(
    'INSERT INTO effects (name, type, category, fixture_target, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(name.trim(), type || 'static', category || 'color', fixture_target || 'all', dataJson, duration_beats || 4);
  return getEffect(result.lastInsertRowid);
}

function updateEffect(id, { name, type, category, fixture_target, effect_data, duration_beats }) {
  const existing = db.prepare('SELECT * FROM effects WHERE id = ?').get(id);
  if (!existing) return null;
  const dataJson = effect_data !== undefined
    ? (typeof effect_data === 'string' ? effect_data : JSON.stringify(effect_data))
    : existing.effect_data;
  db.prepare(
    'UPDATE effects SET name=?, type=?, category=?, fixture_target=?, effect_data=?, duration_beats=? WHERE id=?'
  ).run(
    name !== undefined ? name.trim() : existing.name,
    type !== undefined ? type : existing.type,
    category !== undefined ? category : existing.category,
    fixture_target !== undefined ? fixture_target : (existing.fixture_target || 'all'),
    dataJson,
    duration_beats !== undefined ? duration_beats : existing.duration_beats,
    id
  );
  return getEffect(id);
}

function deleteEffect(id) {
  db.prepare('DELETE FROM effects WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Light Sequences CRUD ───────────────────────────────────────────────────

function getSequences() {
  return db.prepare(`
    SELECT ls.*, t.title as track_title, t.author as track_author, t.filename as track_filename,
           t.filepath as track_filepath,
           (SELECT COUNT(*) FROM sequence_cues sc WHERE sc.sequence_id = ls.id) as cue_count
    FROM light_sequences ls
    LEFT JOIN tracks t ON ls.track_id = t.id
    ORDER BY ls.updated_at DESC
  `).all();
}

function getSequence(id) {
  const seq = db.prepare(`
    SELECT ls.*, t.title as track_title, t.author as track_author, t.filename as track_filename,
           t.bpm as track_bpm, t.song_length as track_duration
    FROM light_sequences ls
    LEFT JOIN tracks t ON ls.track_id = t.id
    WHERE ls.id = ?
  `).get(id);
  return seq || null;
}

function getSequenceByTrackId(trackId) {
  const seq = db.prepare('SELECT * FROM light_sequences WHERE track_id = ?').get(trackId);
  if (!seq) return null;
  return getSequence(seq.id);
}

function createSequence({ name, track_id, bpm, duration_ms, loop }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  const result = db.prepare(
    'INSERT INTO light_sequences (name, track_id, bpm, duration_ms, loop) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), track_id || null, bpm || 120, duration_ms || 0, loop ? 1 : 0);
  return getSequence(result.lastInsertRowid);
}

function updateSequence(id, { name, track_id, bpm, duration_ms, beat_offset_ms, loop }) {
  const existing = db.prepare('SELECT * FROM light_sequences WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    "UPDATE light_sequences SET name=?, track_id=?, bpm=?, duration_ms=?, beat_offset_ms=?, loop=?, updated_at=datetime('now') WHERE id=?"
  ).run(
    name !== undefined ? name.trim() : existing.name,
    track_id !== undefined ? track_id : existing.track_id,
    bpm !== undefined ? bpm : existing.bpm,
    duration_ms !== undefined ? duration_ms : existing.duration_ms,
    beat_offset_ms !== undefined ? beat_offset_ms : (existing.beat_offset_ms || 0),
    loop !== undefined ? (loop ? 1 : 0) : existing.loop,
    id
  );
  return getSequence(id);
}

function deleteSequence(id) {
  db.prepare('DELETE FROM light_sequences WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Sequence Cues CRUD ─────────────────────────────────────────────────────

// ─── USB Devices CRUD ────────────────────────────────────────────────────────

function getUsbDevices() {
  return db.prepare('SELECT * FROM usb_devices ORDER BY local_universe, label').all();
}

function getEnabledUsbDevices() {
  return db.prepare('SELECT * FROM usb_devices WHERE enabled = 1 AND auto_connect = 1 ORDER BY local_universe').all();
}

function getUsbDevice(id) {
  return db.prepare('SELECT * FROM usb_devices WHERE id = ?').get(id);
}

function createUsbDevice({ label, source, vid, pid, serial_number, description, local_universe, auto_connect, refresh_rate }) {
  const info = db.prepare(
    `INSERT INTO usb_devices (label, source, vid, pid, serial_number, description, local_universe, auto_connect, refresh_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    label || '', source || 'ftdi', vid || null, pid || null,
    serial_number || '', description || '',
    local_universe || 1, auto_connect !== undefined ? (auto_connect ? 1 : 0) : 1,
    refresh_rate || 40
  );
  return getUsbDevice(info.lastInsertRowid);
}

function updateUsbDevice(id, updates) {
  const existing = getUsbDevice(id);
  if (!existing) return null;
  const fields = ['label', 'source', 'vid', 'pid', 'serial_number', 'description', 'local_universe', 'auto_connect', 'refresh_rate', 'enabled'];
  const sets = [];
  const vals = [];
  for (const f of fields) {
    if (updates[f] !== undefined) {
      sets.push(`${f} = ?`);
      if (f === 'auto_connect' || f === 'enabled') {
        vals.push(updates[f] ? 1 : 0);
      } else {
        vals.push(updates[f]);
      }
    }
  }
  if (sets.length === 0) return existing;
  vals.push(id);
  db.prepare(`UPDATE usb_devices SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  return getUsbDevice(id);
}

function deleteUsbDevice(id) {
  db.prepare('DELETE FROM usb_devices WHERE id = ?').run(id);
}

function toggleUsbDevice(id) {
  db.prepare('UPDATE usb_devices SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return getUsbDevice(id);
}

// ─── Sequence Cues CRUD ─────────────────────────────────────────────────────

function getSequenceCuesLightweight(sequenceId) {
  const cues = db.prepare(
    'SELECT id, sequence_id, lane, start_ms, duration_ms, cue_type, fixture_id, color, label, cell, track, effect_id, channel_values, end_channel_values FROM sequence_cues WHERE sequence_id = ? ORDER BY lane, start_ms'
  ).all(sequenceId);
  // Pre-compute display colors from channel_values to avoid sending full channel data
  return cues.map(c => {
    const chV = JSON.parse(c.channel_values || '{}');
    const endV = c.end_channel_values ? JSON.parse(c.end_channel_values) : null;
    // Compute display color from RGB channel values
    let display_color = c.color || '#e94560';
    if (chV.red !== undefined || chV.green !== undefined || chV.blue !== undefined) {
      const r = Math.max(0, Math.min(255, chV.red || 0));
      const g = Math.max(0, Math.min(255, chV.green || 0));
      const b = Math.max(0, Math.min(255, chV.blue || 0));
      display_color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    let end_display_color = null;
    if (endV && (endV.red !== undefined || endV.green !== undefined || endV.blue !== undefined)) {
      const r = Math.max(0, Math.min(255, endV.red || 0));
      const g = Math.max(0, Math.min(255, endV.green || 0));
      const b = Math.max(0, Math.min(255, endV.blue || 0));
      end_display_color = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }
    return {
      id: c.id, lane: c.lane, start_ms: c.start_ms, duration_ms: c.duration_ms,
      cue_type: c.cue_type, fixture_id: c.fixture_id, color: c.color,
      label: c.label, cell: c.cell, track: c.track || 'color',
      effect_id: c.effect_id,
      display_color, end_display_color,
      mover_preset_id: chV.mover_preset_id || null,
    };
  });
}

function getSequenceCues(sequenceId) {
  const cues = db.prepare('SELECT * FROM sequence_cues WHERE sequence_id = ? ORDER BY lane, start_ms').all(sequenceId);
  return cues.map(c => ({
    ...c,
    channel_values: JSON.parse(c.channel_values || '{}'),
    end_channel_values: c.end_channel_values ? JSON.parse(c.end_channel_values) : null,
    effect_params: JSON.parse(c.effect_params || '{}'),
  }));
}

function createCue(sequenceId, cue) {
  const channelJson = typeof cue.channel_values === 'string' ? cue.channel_values : JSON.stringify(cue.channel_values || {});
  const endChannelJson = cue.end_channel_values
    ? (typeof cue.end_channel_values === 'string' ? cue.end_channel_values : JSON.stringify(cue.end_channel_values))
    : null;
  const effectParamsJson = typeof cue.effect_params === 'string' ? cue.effect_params : JSON.stringify(cue.effect_params || {});
  const result = db.prepare(`
    INSERT INTO sequence_cues (sequence_id, lane, start_ms, duration_ms, cue_type, fixture_id, group_id,
      channel_values, end_channel_values, effect_id, effect_params, color, label, sort_order, cell, track)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sequenceId,
    cue.lane || 0,
    cue.start_ms || 0,
    cue.duration_ms || 1000,
    cue.cue_type || 'static',
    cue.fixture_id || null,
    cue.group_id || null,
    channelJson,
    endChannelJson,
    cue.effect_id || null,
    effectParamsJson,
    cue.color || '#e94560',
    cue.label || '',
    cue.sort_order || 0,
    cue.cell || null,
    cue.track || 'color'
  );
  // Update sequence timestamp
  db.prepare("UPDATE light_sequences SET updated_at=datetime('now') WHERE id=?").run(sequenceId);
  return getCue(result.lastInsertRowid);
}

function getCue(id) {
  const c = db.prepare('SELECT * FROM sequence_cues WHERE id = ?').get(id);
  if (!c) return null;
  return {
    ...c,
    channel_values: JSON.parse(c.channel_values || '{}'),
    end_channel_values: c.end_channel_values ? JSON.parse(c.end_channel_values) : null,
    effect_params: JSON.parse(c.effect_params || '{}'),
  };
}

function updateCue(id, updates) {
  const existing = db.prepare('SELECT * FROM sequence_cues WHERE id = ?').get(id);
  if (!existing) return null;
  const channelJson = updates.channel_values !== undefined
    ? (typeof updates.channel_values === 'string' ? updates.channel_values : JSON.stringify(updates.channel_values))
    : existing.channel_values;
  const endChannelJson = updates.end_channel_values !== undefined
    ? (updates.end_channel_values ? (typeof updates.end_channel_values === 'string' ? updates.end_channel_values : JSON.stringify(updates.end_channel_values)) : null)
    : existing.end_channel_values;
  const effectParamsJson = updates.effect_params !== undefined
    ? (typeof updates.effect_params === 'string' ? updates.effect_params : JSON.stringify(updates.effect_params))
    : existing.effect_params;
  db.prepare(`
    UPDATE sequence_cues SET lane=?, start_ms=?, duration_ms=?, cue_type=?, fixture_id=?, group_id=?,
      channel_values=?, end_channel_values=?, effect_id=?, effect_params=?, color=?, label=?, sort_order=?, cell=?, track=?
    WHERE id=?
  `).run(
    updates.lane !== undefined ? updates.lane : existing.lane,
    updates.start_ms !== undefined ? updates.start_ms : existing.start_ms,
    updates.duration_ms !== undefined ? updates.duration_ms : existing.duration_ms,
    updates.cue_type !== undefined ? updates.cue_type : existing.cue_type,
    updates.fixture_id !== undefined ? updates.fixture_id : existing.fixture_id,
    updates.group_id !== undefined ? updates.group_id : existing.group_id,
    channelJson,
    endChannelJson,
    updates.effect_id !== undefined ? updates.effect_id : existing.effect_id,
    effectParamsJson,
    updates.color !== undefined ? updates.color : existing.color,
    updates.label !== undefined ? updates.label : existing.label,
    updates.sort_order !== undefined ? updates.sort_order : existing.sort_order,
    updates.cell !== undefined ? (updates.cell || null) : (existing.cell || null),
    updates.track !== undefined ? updates.track : (existing.track || 'color'),
    id
  );
  // Update sequence timestamp
  db.prepare("UPDATE light_sequences SET updated_at=datetime('now') WHERE id=?").run(existing.sequence_id);
  return getCue(id);
}

function deleteCue(id) {
  const c = db.prepare('SELECT sequence_id FROM sequence_cues WHERE id = ?').get(id);
  db.prepare('DELETE FROM sequence_cues WHERE id = ?').run(id);
  if (c) db.prepare("UPDATE light_sequences SET updated_at=datetime('now') WHERE id=?").run(c.sequence_id);
  return { deleted: true };
}

function bulkUpdateCues(sequenceId, cues) {
  const txn = db.transaction(() => {
    // Delete existing cues
    db.prepare('DELETE FROM sequence_cues WHERE sequence_id = ?').run(sequenceId);
    // Insert all cues
    const ins = db.prepare(`
      INSERT INTO sequence_cues (sequence_id, lane, start_ms, duration_ms, cue_type, fixture_id, group_id,
        channel_values, end_channel_values, effect_id, effect_params, color, label, sort_order, cell, track)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const cue of cues) {
      const channelJson = typeof cue.channel_values === 'string' ? cue.channel_values : JSON.stringify(cue.channel_values || {});
      const endChannelJson = cue.end_channel_values
        ? (typeof cue.end_channel_values === 'string' ? cue.end_channel_values : JSON.stringify(cue.end_channel_values))
        : null;
      const effectParamsJson = typeof cue.effect_params === 'string' ? cue.effect_params : JSON.stringify(cue.effect_params || {});
      ins.run(
        sequenceId, cue.lane || 0, cue.start_ms || 0, cue.duration_ms || 1000,
        cue.cue_type || 'static', cue.fixture_id || null, cue.group_id || null,
        channelJson, endChannelJson, cue.effect_id || null, effectParamsJson,
        cue.color || '#e94560', cue.label || '', cue.sort_order || 0, cue.cell || null,
        cue.track || 'color'
      );
    }
    db.prepare("UPDATE light_sequences SET updated_at=datetime('now') WHERE id=?").run(sequenceId);
  });
  txn();
  return getSequenceCues(sequenceId);
}

// ─── Track Analysis CRUD ─────────────────────────────────────────────────────

function getTrackAnalysis(trackId) {
  return db.prepare('SELECT * FROM track_analysis WHERE track_id = ?').get(trackId) || null;
}

function upsertTrackAnalysis(trackId, data) {
  const existing = getTrackAnalysis(trackId);
  if (existing) {
    db.prepare(`
      UPDATE track_analysis SET
        waveform_peaks=?, energy_levels=?, beats=?, sections=?,
        sample_rate=?, channels=?, duration_ms=?, peak_count=?,
        analysis_version=?, analyzed_at=datetime('now')
      WHERE track_id=?
    `).run(
      JSON.stringify(data.waveform_peaks || []),
      JSON.stringify(data.energy_levels || []),
      JSON.stringify(data.beats || []),
      JSON.stringify(data.sections || []),
      data.sample_rate || 0,
      data.channels || 0,
      data.duration_ms || 0,
      data.peak_count || 0,
      data.analysis_version || 1,
      trackId
    );
    return getTrackAnalysis(trackId);
  }
  db.prepare(`
    INSERT INTO track_analysis (track_id, waveform_peaks, energy_levels, beats, sections,
      sample_rate, channels, duration_ms, peak_count, analysis_version)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    trackId,
    JSON.stringify(data.waveform_peaks || []),
    JSON.stringify(data.energy_levels || []),
    JSON.stringify(data.beats || []),
    JSON.stringify(data.sections || []),
    data.sample_rate || 0,
    data.channels || 0,
    data.duration_ms || 0,
    data.peak_count || 0,
    data.analysis_version || 1
  );
  return getTrackAnalysis(trackId);
}

function updateStemEnergy(trackId, stemData) {
  const existing = getTrackAnalysis(trackId);
  if (!existing) return null;
  db.prepare('UPDATE track_analysis SET stem_energy = ? WHERE track_id = ?')
    .run(JSON.stringify(stemData), trackId);
  return getTrackAnalysis(trackId);
}

function deleteTrackAnalysis(trackId) {
  db.prepare('DELETE FROM track_analysis WHERE track_id = ?').run(trackId);
  return { deleted: true };
}

function deleteAllAnalysis() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM track_analysis').get().cnt;
  db.prepare('DELETE FROM track_analysis').run();
  return { deleted: count };
}

function deleteAllSequences() {
  const count = db.prepare('SELECT COUNT(*) as cnt FROM light_sequences').get().cnt;
  db.prepare('DELETE FROM sequence_cues WHERE sequence_id IN (SELECT id FROM light_sequences)').run();
  db.prepare('DELETE FROM light_sequences').run();
  return { deleted: count };
}

function getDbStats() {
  return {
    tracks: db.prepare('SELECT COUNT(*) as cnt FROM tracks').get().cnt,
    sequences: db.prepare('SELECT COUNT(*) as cnt FROM light_sequences').get().cnt,
    cues: db.prepare('SELECT COUNT(*) as cnt FROM sequence_cues').get().cnt,
    analyses: db.prepare('SELECT COUNT(*) as cnt FROM track_analysis').get().cnt,
    fixtures: db.prepare('SELECT COUNT(*) as cnt FROM fixtures').get().cnt,
    effects: db.prepare('SELECT COUNT(*) as cnt FROM effects').get().cnt,
  };
}

// ─── Static Scenes CRUD ─────────────────────────────────────────────────────

function getScenes() {
  return db.prepare('SELECT * FROM static_scenes ORDER BY priority DESC, name').all();
}

function getScene(id) {
  const scene = db.prepare('SELECT * FROM static_scenes WHERE id = ?').get(id);
  if (!scene) return null;
  scene.entries = db.prepare('SELECT * FROM static_scene_entries WHERE scene_id = ? ORDER BY sort_order').all(scene.id);
  scene.entries = scene.entries.map(e => ({
    ...e,
    channel_values: JSON.parse(e.channel_values || '{}'),
    effect_params: JSON.parse(e.effect_params || '{}'),
  }));
  return scene;
}

function getDefaultScene() {
  const scene = db.prepare('SELECT * FROM static_scenes WHERE is_default = 1').get();
  if (!scene) return null;
  return getScene(scene.id);
}

function createScene({ name, description, priority, is_default }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  if (is_default) {
    db.prepare('UPDATE static_scenes SET is_default = 0').run();
  }
  const result = db.prepare(
    'INSERT INTO static_scenes (name, description, priority, is_default) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), description || '', priority || 0, is_default ? 1 : 0);
  return getScene(result.lastInsertRowid);
}

function updateScene(id, { name, description, priority, is_default }) {
  const existing = db.prepare('SELECT * FROM static_scenes WHERE id = ?').get(id);
  if (!existing) return null;
  if (is_default) {
    db.prepare('UPDATE static_scenes SET is_default = 0').run();
  }
  db.prepare(
    "UPDATE static_scenes SET name=?, description=?, priority=?, is_default=?, updated_at=datetime('now') WHERE id=?"
  ).run(
    name !== undefined ? name.trim() : existing.name,
    description !== undefined ? description : existing.description,
    priority !== undefined ? priority : existing.priority,
    is_default !== undefined ? (is_default ? 1 : 0) : existing.is_default,
    id
  );
  return getScene(id);
}

function deleteScene(id) {
  db.prepare('DELETE FROM static_scenes WHERE id = ?').run(id);
  return { deleted: true };
}

function setDefaultScene(id) {
  db.prepare('UPDATE static_scenes SET is_default = 0').run();
  db.prepare('UPDATE static_scenes SET is_default = 1 WHERE id = ?').run(id);
  return getScene(id);
}

// ─── Scene Entries CRUD ─────────────────────────────────────────────────────

function getSceneEntries(sceneId) {
  const entries = db.prepare('SELECT * FROM static_scene_entries WHERE scene_id = ? ORDER BY sort_order').all(sceneId);
  return entries.map(e => ({
    ...e,
    channel_values: JSON.parse(e.channel_values || '{}'),
    effect_params: JSON.parse(e.effect_params || '{}'),
  }));
}

function createSceneEntry(sceneId, entry) {
  const channelJson = typeof entry.channel_values === 'string' ? entry.channel_values : JSON.stringify(entry.channel_values || {});
  const effectParamsJson = typeof entry.effect_params === 'string' ? entry.effect_params : JSON.stringify(entry.effect_params || {});
  const result = db.prepare(`
    INSERT INTO static_scene_entries (scene_id, fixture_id, group_id, channel_values, effect_id, effect_params, label, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    sceneId,
    entry.fixture_id || null,
    entry.group_id || null,
    channelJson,
    entry.effect_id || null,
    effectParamsJson,
    entry.label || '',
    entry.sort_order || 0
  );
  db.prepare("UPDATE static_scenes SET updated_at=datetime('now') WHERE id=?").run(sceneId);
  return getSceneEntry(result.lastInsertRowid);
}

function getSceneEntry(id) {
  const e = db.prepare('SELECT * FROM static_scene_entries WHERE id = ?').get(id);
  if (!e) return null;
  return {
    ...e,
    channel_values: JSON.parse(e.channel_values || '{}'),
    effect_params: JSON.parse(e.effect_params || '{}'),
  };
}

function updateSceneEntry(id, updates) {
  const existing = db.prepare('SELECT * FROM static_scene_entries WHERE id = ?').get(id);
  if (!existing) return null;
  const channelJson = updates.channel_values !== undefined
    ? (typeof updates.channel_values === 'string' ? updates.channel_values : JSON.stringify(updates.channel_values))
    : existing.channel_values;
  const effectParamsJson = updates.effect_params !== undefined
    ? (typeof updates.effect_params === 'string' ? updates.effect_params : JSON.stringify(updates.effect_params))
    : existing.effect_params;
  db.prepare(`
    UPDATE static_scene_entries SET fixture_id=?, group_id=?, channel_values=?, effect_id=?, effect_params=?, label=?, sort_order=?
    WHERE id=?
  `).run(
    updates.fixture_id !== undefined ? updates.fixture_id : existing.fixture_id,
    updates.group_id !== undefined ? updates.group_id : existing.group_id,
    channelJson,
    updates.effect_id !== undefined ? updates.effect_id : existing.effect_id,
    effectParamsJson,
    updates.label !== undefined ? updates.label : existing.label,
    updates.sort_order !== undefined ? updates.sort_order : existing.sort_order,
    id
  );
  db.prepare("UPDATE static_scenes SET updated_at=datetime('now') WHERE id=?").run(existing.scene_id);
  return getSceneEntry(id);
}

function deleteSceneEntry(id) {
  const e = db.prepare('SELECT scene_id FROM static_scene_entries WHERE id = ?').get(id);
  db.prepare('DELETE FROM static_scene_entries WHERE id = ?').run(id);
  if (e) db.prepare("UPDATE static_scenes SET updated_at=datetime('now') WHERE id=?").run(e.scene_id);
  return { deleted: true };
}

function bulkUpdateSceneEntries(sceneId, entries) {
  const txn = db.transaction(() => {
    db.prepare('DELETE FROM static_scene_entries WHERE scene_id = ?').run(sceneId);
    const ins = db.prepare(`
      INSERT INTO static_scene_entries (scene_id, fixture_id, group_id, channel_values, effect_id, effect_params, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const entry of entries) {
      const channelJson = typeof entry.channel_values === 'string' ? entry.channel_values : JSON.stringify(entry.channel_values || {});
      const effectParamsJson = typeof entry.effect_params === 'string' ? entry.effect_params : JSON.stringify(entry.effect_params || {});
      ins.run(
        sceneId, entry.fixture_id || null, entry.group_id || null,
        channelJson, entry.effect_id || null, effectParamsJson,
        entry.label || '', entry.sort_order || 0
      );
    }
    db.prepare("UPDATE static_scenes SET updated_at=datetime('now') WHERE id=?").run(sceneId);
  });
  txn();
  return getSceneEntries(sceneId);
}

// ─── Touch Actions CRUD ─────────────────────────────────────────────────────

function getTouchActions() {
  const rows = db.prepare('SELECT * FROM touch_actions ORDER BY sort_order, grid_row, grid_col, id').all();
  return rows.map(r => ({ ...r, action_data: JSON.parse(r.action_data || '{}') }));
}

function getTouchAction(id) {
  const r = db.prepare('SELECT * FROM touch_actions WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, action_data: JSON.parse(r.action_data || '{}') };
}

function createTouchAction(data) {
  if (!data.label || !data.label.trim()) return { error: 'Label is required' };
  const result = db.prepare(`
    INSERT INTO touch_actions (label, icon, action_type, action_data, color, text_color, grid_row, grid_col, grid_w, grid_h, sort_order, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.label.trim(),
    data.icon || '',
    data.action_type || 'color',
    typeof data.action_data === 'string' ? data.action_data : JSON.stringify(data.action_data || {}),
    data.color || '#ffffff',
    data.text_color || '#ffffff',
    data.grid_row || 0,
    data.grid_col || 0,
    data.grid_w || 1,
    data.grid_h || 1,
    data.sort_order || 0,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : 1
  );
  return getTouchAction(result.lastInsertRowid);
}

function updateTouchAction(id, data) {
  const existing = db.prepare('SELECT * FROM touch_actions WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(`
    UPDATE touch_actions SET label=?, icon=?, action_type=?, action_data=?, color=?, text_color=?,
      grid_row=?, grid_col=?, grid_w=?, grid_h=?, sort_order=?, enabled=?
    WHERE id = ?
  `).run(
    data.label !== undefined ? data.label.trim() : existing.label,
    data.icon !== undefined ? data.icon : existing.icon,
    data.action_type !== undefined ? data.action_type : existing.action_type,
    data.action_data !== undefined ? (typeof data.action_data === 'string' ? data.action_data : JSON.stringify(data.action_data)) : existing.action_data,
    data.color !== undefined ? data.color : existing.color,
    data.text_color !== undefined ? data.text_color : existing.text_color,
    data.grid_row !== undefined ? data.grid_row : existing.grid_row,
    data.grid_col !== undefined ? data.grid_col : existing.grid_col,
    data.grid_w !== undefined ? data.grid_w : existing.grid_w,
    data.grid_h !== undefined ? data.grid_h : existing.grid_h,
    data.sort_order !== undefined ? data.sort_order : existing.sort_order,
    data.enabled !== undefined ? (data.enabled ? 1 : 0) : existing.enabled,
    id
  );
  return getTouchAction(id);
}

function deleteTouchAction(id) {
  db.prepare('DELETE FROM touch_actions WHERE id = ?').run(id);
  return { deleted: true };
}

function bulkUpdateTouchActions(actions) {
  const txn = db.transaction(() => {
    for (const a of actions) {
      if (a.id) {
        updateTouchAction(a.id, a);
      }
    }
  });
  txn();
  return getTouchActions();
}

function getTracksWithAnalysis() {
  return db.prepare(`
    SELECT t.id, t.title, t.author, t.filename, t.bpm, t.song_length,
           CASE WHEN ta.id IS NOT NULL THEN 1 ELSE 0 END as has_analysis,
           ta.analyzed_at, ta.peak_count
    FROM tracks t
    LEFT JOIN track_analysis ta ON ta.track_id = t.id
    ORDER BY t.title
  `).all();
}

// ─── Sequence Templates ────────────────────────────────────────────────────

function getSequenceTemplates() {
  return db.prepare('SELECT * FROM sequence_templates ORDER BY is_default DESC, name ASC').all().map(t => {
    if (t.generator_config) try { t.generator_config = JSON.parse(t.generator_config); } catch(e) { t.generator_config = null; }
    return t;
  });
}

function getSequenceTemplate(id) {
  const t = db.prepare('SELECT * FROM sequence_templates WHERE id = ?').get(id);
  if (t && t.generator_config) try { t.generator_config = JSON.parse(t.generator_config); } catch(e) { t.generator_config = null; }
  return t;
}

function createSequenceTemplate({ name, palette, genre, no_strobes, generator_config, is_default }) {
  const r = db.prepare('INSERT INTO sequence_templates (name, palette, genre, no_strobes, generator_config, is_default) VALUES (?, ?, ?, ?, ?, ?)').run(
    name, palette || 'random', genre || 'auto', no_strobes ? 1 : 0,
    generator_config ? JSON.stringify(generator_config) : null,
    is_default ? 1 : 0
  );
  return getSequenceTemplate(r.lastInsertRowid);
}

function updateSequenceTemplate(id, { name, palette, genre, no_strobes, generator_config, is_default }) {
  db.prepare('UPDATE sequence_templates SET name=?, palette=?, genre=?, no_strobes=?, generator_config=?, is_default=? WHERE id=?').run(
    name, palette || 'random', genre || 'auto', no_strobes ? 1 : 0,
    generator_config ? JSON.stringify(generator_config) : null,
    is_default ? 1 : 0, id
  );
  return getSequenceTemplate(id);
}

function deleteSequenceTemplate(id) {
  db.prepare('DELETE FROM sequence_templates WHERE id = ?').run(id);
}

function setDefaultSequenceTemplate(id) {
  db.prepare('UPDATE sequence_templates SET is_default = 0 WHERE is_default = 1').run();
  if (id) db.prepare('UPDATE sequence_templates SET is_default = 1 WHERE id = ?').run(id);
}

// ─── Backup / Restore ───────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');

function getDbPath() {
  return DB_PATH;
}

function backupDatabase() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(os.tmpdir(), `dmx-controller-backup-${ts}.db`);
  db.pragma('wal_checkpoint(TRUNCATE)');
  fs.copyFileSync(DB_PATH, dest);
  return dest;
}

function restoreDatabase(uploadedFilePath) {
  // Validate that the uploaded file is a valid SQLite database
  const header = Buffer.alloc(16);
  const fd = fs.openSync(uploadedFilePath, 'r');
  fs.readSync(fd, header, 0, 16, 0);
  fs.closeSync(fd);
  if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
    fs.unlinkSync(uploadedFilePath);
    throw new Error('Uploaded file is not a valid SQLite database');
  }
  // Close current database, copy uploaded file over, re-open
  db.close();
  // Remove WAL/SHM files if they exist
  try { fs.unlinkSync(DB_PATH + '-wal'); } catch (_) {}
  try { fs.unlinkSync(DB_PATH + '-shm'); } catch (_) {}
  fs.copyFileSync(uploadedFilePath, DB_PATH);
  fs.unlinkSync(uploadedFilePath);
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

// ─── MIDI Mappings CRUD ──────────────────────────────────────────────────────

function getMidiMappings() {
  return db.prepare('SELECT * FROM midi_mappings ORDER BY sort_order, id').all();
}

function getEnabledMidiMappings() {
  return db.prepare('SELECT * FROM midi_mappings WHERE enabled = 1 ORDER BY sort_order, id').all();
}

function getMidiMapping(id) {
  return db.prepare('SELECT * FROM midi_mappings WHERE id = ?').get(id);
}

function createMidiMapping({ name, midi_type, midi_number, midi_channel, action_type, action_data, toggle_mode, led_color, led_active_color, led_behavior, led_active_behavior, enabled, page }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM midi_mappings').get().next;
  const r = db.prepare(
    `INSERT INTO midi_mappings (name, midi_type, midi_number, midi_channel, action_type, action_data, toggle_mode, led_color, led_active_color, led_behavior, led_active_behavior, enabled, sort_order, page)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name.trim(),
    midi_type || 'note',
    midi_number || 0,
    midi_channel || 0,
    action_type || 'none',
    typeof action_data === 'object' ? JSON.stringify(action_data) : (action_data || '{}'),
    toggle_mode || 'momentary',
    led_color !== undefined ? led_color : 0,
    led_active_color !== undefined ? led_active_color : 1,
    led_behavior !== undefined ? led_behavior : 0,
    led_active_behavior !== undefined ? led_active_behavior : 0,
    enabled !== undefined ? (enabled ? 1 : 0) : 1,
    maxOrder,
    page !== undefined ? page : 0
  );
  return db.prepare('SELECT * FROM midi_mappings WHERE id = ?').get(r.lastInsertRowid);
}

function updateMidiMapping(id, { name, midi_type, midi_number, midi_channel, action_type, action_data, toggle_mode, led_color, led_active_color, led_behavior, led_active_behavior, enabled, page }) {
  const existing = db.prepare('SELECT * FROM midi_mappings WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    `UPDATE midi_mappings SET name=?, midi_type=?, midi_number=?, midi_channel=?, action_type=?, action_data=?, toggle_mode=?, led_color=?, led_active_color=?, led_behavior=?, led_active_behavior=?, enabled=?, page=? WHERE id=?`
  ).run(
    name !== undefined ? name.trim() : existing.name,
    midi_type !== undefined ? midi_type : existing.midi_type,
    midi_number !== undefined ? midi_number : existing.midi_number,
    midi_channel !== undefined ? midi_channel : existing.midi_channel,
    action_type !== undefined ? action_type : existing.action_type,
    action_data !== undefined ? (typeof action_data === 'object' ? JSON.stringify(action_data) : action_data) : existing.action_data,
    toggle_mode !== undefined ? toggle_mode : existing.toggle_mode,
    led_color !== undefined ? led_color : existing.led_color,
    led_active_color !== undefined ? led_active_color : existing.led_active_color,
    led_behavior !== undefined ? led_behavior : (existing.led_behavior || 0),
    led_active_behavior !== undefined ? led_active_behavior : (existing.led_active_behavior || 0),
    enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
    page !== undefined ? page : (existing.page || 0),
    id
  );
  return db.prepare('SELECT * FROM midi_mappings WHERE id = ?').get(id);
}

function deleteMidiMapping(id) {
  db.prepare('DELETE FROM midi_mappings WHERE id = ?').run(id);
  return { deleted: true };
}

function toggleMidiMapping(id) {
  db.prepare('UPDATE midi_mappings SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  return db.prepare('SELECT * FROM midi_mappings WHERE id = ?').get(id);
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  backupDatabase, getDbPath, restoreDatabase,
  getFixtureTypes, getFixtureType, createFixtureType, updateFixtureType, deleteFixtureType,
  getFixtureTypeSummaries, searchFixtureTypes,
  createLedBarFixtureType,
  createMultiCellFixtureType,
  getColorWheelMap, getAllColorWheelMaps, setColorWheelMap, deleteColorWheelMap,
  getGoboWheelMap, getAllGoboWheelMaps, setGoboWheelMap, deleteGoboWheelMap,
  getFixtures, getFixture, createFixture, updateFixture, deleteFixture, updateFixtureRigPositions,
  getRigElements, createRigElement, updateRigElement, deleteRigElement, bulkUpdateRigElements,
  getRigLayouts, getRigLayout, createRigLayout, updateRigLayout, loadRigLayout, deleteRigLayout, setActiveRigLayout, getActiveRigLayout,
  getUniverseMap,
  getFixtureChannelMap,
  getGroups, getGroup, createGroup, updateGroup, deleteGroup, setGroupFixtures,
  getArtNetUniverses, getArtNetUniverse, createArtNetUniverse, updateArtNetUniverse, deleteArtNetUniverse, toggleArtNetUniverse,
  getSubscriptions, getEnabledSubscriptions, createSubscription, updateSubscription, deleteSubscription, toggleSubscription,
  getConfig, setConfig, getAllConfig,
  getTracks, getTrack, getTrackByPath, getTrackGenres, getTrackStats, importTracks, clearTracks, updateTrackBeatgridPos,
  getButtonMaps, getEnabledButtonMaps, getButtonMap, createButtonMap, updateButtonMap, deleteButtonMap, toggleButtonMap,
  getMoverPresets, getMoverPreset, createMoverPreset, updateMoverPreset, deleteMoverPreset, SYSTEM_MOVER_PRESETS,
  getGeneratorConfig, getGeneratorConfigKey, setGeneratorConfigKey, resetGeneratorConfig, GENERATOR_CONFIG_DEFAULTS,
  getEffects, getEffect, createEffect, updateEffect, deleteEffect,
  getSequences, getSequence, getSequenceByTrackId, createSequence, updateSequence, deleteSequence,
  getSequenceCues, getSequenceCuesLightweight, getCue, createCue, updateCue, deleteCue, bulkUpdateCues,
  getUsbDevices, getEnabledUsbDevices, getUsbDevice, createUsbDevice, updateUsbDevice, deleteUsbDevice, toggleUsbDevice,
  getTrackAnalysis, upsertTrackAnalysis, updateStemEnergy, deleteTrackAnalysis, deleteAllAnalysis,
  deleteAllSequences, getDbStats, getTracksWithAnalysis,
  getScenes, getScene, getDefaultScene, createScene, updateScene, deleteScene, setDefaultScene,
  getSceneEntries, getSceneEntry, createSceneEntry, updateSceneEntry, deleteSceneEntry, bulkUpdateSceneEntries,
  getTouchActions, getTouchAction, createTouchAction, updateTouchAction, deleteTouchAction, bulkUpdateTouchActions,
  getSequenceTemplates, getSequenceTemplate, createSequenceTemplate, updateSequenceTemplate, deleteSequenceTemplate, setDefaultSequenceTemplate,
  getMidiMappings, getEnabledMidiMappings, getMidiMapping, createMidiMapping, updateMidiMapping, deleteMidiMapping, toggleMidiMapping,
};
