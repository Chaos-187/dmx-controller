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

const DB_PATH = path.join(__dirname, 'dmx-controller.db');

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

    CREATE TABLE IF NOT EXISTS fixture_type_channels (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE CASCADE,
      channel_number  INTEGER NOT NULL,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'dimmer',
      default_value   INTEGER DEFAULT 0,
      min_value       INTEGER DEFAULT 0,
      max_value       INTEGER DEFAULT 255,
      ranges          TEXT    DEFAULT NULL,
      UNIQUE(fixture_type_id, channel_number)
    );

    CREATE TABLE IF NOT EXISTS fixtures (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      fixture_type_id INTEGER NOT NULL REFERENCES fixture_types(id) ON DELETE RESTRICT,
      universe        INTEGER NOT NULL DEFAULT 1,
      address         INTEGER NOT NULL,
      output_type     TEXT    NOT NULL DEFAULT 'artnet',
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

    -- Effects library
    CREATE TABLE IF NOT EXISTS effects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT    NOT NULL,
      type            TEXT    NOT NULL DEFAULT 'static',
      category        TEXT    DEFAULT 'color',
      effect_data     TEXT    DEFAULT '{}',
      duration_beats  REAL    DEFAULT 4,
      created_at      TEXT    DEFAULT (datetime('now'))
    );

    -- Light sequences (linked to tracks)
    CREATE TABLE IF NOT EXISTS light_sequences (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      track_id    INTEGER DEFAULT NULL,
      bpm         REAL    DEFAULT 120,
      duration_ms INTEGER DEFAULT 0,
      loop        INTEGER DEFAULT 0,
      created_at  TEXT    DEFAULT (datetime('now')),
      updated_at  TEXT    DEFAULT (datetime('now'))
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
      ins.run('web_port', '3000');
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

// ─── Seed Default Fixture Types ─────────────────────────────────────────────

function seedDefaults() {
  const insertType = db.prepare(
    `INSERT INTO fixture_types (name, manufacturer, category, channel_count) VALUES (?, ?, ?, ?)`
  );
  const insertCh = db.prepare(
    `INSERT INTO fixture_type_channels (fixture_type_id, channel_number, name, type, default_value, ranges)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  /** Helper: insert channel without ranges */
  const ch = (typeId, num, name, type, def) => insertCh.run(typeId, num, name, type, def || 0, null);
  /** Helper: insert channel with ranges */
  const chR = (typeId, num, name, type, def, ranges) => insertCh.run(typeId, num, name, type, def || 0, JSON.stringify(ranges));

  const seed = db.transaction(() => {
    // 1 — Generic RGB Par (3ch)
    let r = insertType.run('Generic RGB Par', 'Generic', 'par', 3);
    let id = r.lastInsertRowid;
    ch(id, 1, 'Red', 'red', 0);
    ch(id, 2, 'Green', 'green', 0);
    ch(id, 3, 'Blue', 'blue', 0);

    // 2 — Generic RGBW Par (4ch)
    r = insertType.run('Generic RGBW Par', 'Generic', 'par', 4);
    id = r.lastInsertRowid;
    ch(id, 1, 'Red', 'red', 0);
    ch(id, 2, 'Green', 'green', 0);
    ch(id, 3, 'Blue', 'blue', 0);
    ch(id, 4, 'White', 'white', 0);

    // 3 — Generic Dimmer (1ch)
    r = insertType.run('Generic Dimmer', 'Generic', 'dimmer', 1);
    id = r.lastInsertRowid;
    ch(id, 1, 'Dimmer', 'dimmer', 0);

    // 4 — RGB Par + Dimmer (4ch)
    r = insertType.run('RGB Par + Dimmer', 'Generic', 'par', 4);
    id = r.lastInsertRowid;
    ch(id, 1, 'Dimmer', 'dimmer', 0);
    ch(id, 2, 'Red', 'red', 0);
    ch(id, 3, 'Green', 'green', 0);
    ch(id, 4, 'Blue', 'blue', 0);

    // 5 — Generic Moving Head (16ch)
    r = insertType.run('Generic Moving Head', 'Generic', 'moving_head', 16);
    id = r.lastInsertRowid;
    ch(id, 1, 'Pan', 'pan', 128);
    ch(id, 2, 'Pan Fine', 'pan_fine', 0);
    ch(id, 3, 'Tilt', 'tilt', 128);
    ch(id, 4, 'Tilt Fine', 'tilt_fine', 0);
    ch(id, 5, 'Speed', 'speed', 0);
    ch(id, 6, 'Dimmer', 'dimmer', 0);
    ch(id, 7, 'Strobe', 'strobe', 0);
    ch(id, 8, 'Red', 'red', 0);
    ch(id, 9, 'Green', 'green', 0);
    ch(id, 10, 'Blue', 'blue', 0);
    ch(id, 11, 'White', 'white', 0);
    ch(id, 12, 'Color Wheel', 'color_wheel', 0);
    ch(id, 13, 'Gobo', 'gobo', 0);
    ch(id, 14, 'Gobo Rotation', 'gobo_rotation', 0);
    ch(id, 15, 'Prism', 'prism', 0);
    ch(id, 16, 'Focus', 'focus', 128);

    // 6 — Strobe (2ch)
    r = insertType.run('Generic Strobe', 'Generic', 'strobe', 2);
    id = r.lastInsertRowid;
    ch(id, 1, 'Dimmer', 'dimmer', 0);
    ch(id, 2, 'Strobe Speed', 'strobe', 0);

    // 7 — Fog Machine (1ch)
    r = insertType.run('Generic Fog Machine', 'Generic', 'fog', 1);
    id = r.lastInsertRowid;
    ch(id, 1, 'Output', 'dimmer', 0);

    // 8 — 14ch Moving Head with ranges (matches common RGBW moving head spec)
    r = insertType.run('Moving Head 14ch', 'Generic', 'moving_head', 14);
    id = r.lastInsertRowid;
    ch(id, 1, 'Pan', 'pan', 128);
    ch(id, 2, 'Pan Fine', 'pan_fine', 0);
    ch(id, 3, 'Tilt', 'tilt', 128);
    ch(id, 4, 'Tilt Fine', 'tilt_fine', 0);
    ch(id, 5, 'Pan/Tilt Speed', 'speed', 0);
    chR(id, 6, 'Dimmer / Strobe', 'dimmer', 0, [
      { min: 0, max: 7, label: 'No function', type: 'other' },
      { min: 8, max: 134, label: 'Dimmer', type: 'dimmer' },
      { min: 135, max: 239, label: 'Strobe 0-40Hz', type: 'strobe' },
      { min: 240, max: 255, label: 'Open', type: 'other' }
    ]);
    ch(id, 7, 'Red', 'red', 0);
    ch(id, 8, 'Green', 'green', 0);
    ch(id, 9, 'Blue', 'blue', 0);
    ch(id, 10, 'White', 'white', 0);
    chR(id, 11, 'Color Mix/Effect', 'color_wheel', 0, [
      { min: 0, max: 223, label: 'Color Mixed', type: 'color_wheel' },
      { min: 224, max: 240, label: 'Gradient slow→fast', type: 'macro' },
      { min: 241, max: 255, label: 'Color jump slow→fast', type: 'macro' }
    ]);
    ch(id, 12, 'Color Speed', 'speed', 0);
    chR(id, 13, 'Movement/Effect', 'macro', 0, [
      { min: 0, max: 3, label: 'DMX control', type: 'other' },
      { min: 4, max: 102, label: 'Auto 1', type: 'macro' },
      { min: 103, max: 152, label: 'Auto 2', type: 'macro' },
      { min: 153, max: 203, label: 'Auto 3', type: 'macro' },
      { min: 204, max: 255, label: 'Sound', type: 'macro' }
    ]);
    chR(id, 14, 'Reset', 'other', 0, [
      { min: 0, max: 254, label: 'No function', type: 'other' },
      { min: 255, max: 255, label: 'Factory Reset', type: 'other' }
    ]);
  });

  seed();
}

// ─── Fixture Types CRUD ─────────────────────────────────────────────────────

function getFixtureTypes() {
  const types = db.prepare('SELECT * FROM fixture_types ORDER BY category, name').all();
  for (const t of types) {
    t.channels = db.prepare(
      'SELECT * FROM fixture_type_channels WHERE fixture_type_id = ? ORDER BY channel_number'
    ).all(t.id);
    for (const ch of t.channels) {
      ch.ranges = ch.ranges ? JSON.parse(ch.ranges) : null;
    }
  }
  return types;
}

function getFixtureType(id) {
  const t = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(id);
  if (!t) return null;
  t.channels = db.prepare(
    'SELECT * FROM fixture_type_channels WHERE fixture_type_id = ? ORDER BY channel_number'
  ).all(t.id);
  for (const ch of t.channels) {
    ch.ranges = ch.ranges ? JSON.parse(ch.ranges) : null;
  }
  return t;
}

function createFixtureType({ name, manufacturer, category, channels }) {
  const channel_count = channels ? channels.length : 1;
  const r = db.prepare(
    `INSERT INTO fixture_types (name, manufacturer, category, channel_count) VALUES (?, ?, ?, ?)`
  ).run(name, manufacturer || '', category || 'other', channel_count);

  const id = r.lastInsertRowid;
  if (channels && channels.length) {
    const ins = db.prepare(
      `INSERT INTO fixture_type_channels (fixture_type_id, channel_number, name, type, default_value, min_value, max_value, ranges)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertAll = db.transaction(() => {
      for (const ch of channels) {
        const rangesJson = ch.ranges ? (typeof ch.ranges === 'string' ? ch.ranges : JSON.stringify(ch.ranges)) : null;
        ins.run(id, ch.channel_number, ch.name, ch.type || 'dimmer', ch.default_value || 0, ch.min_value || 0, ch.max_value || 255, rangesJson);
      }
    });
    insertAll();
  }
  return getFixtureType(id);
}

function updateFixtureType(id, { name, manufacturer, category, channels }) {
  const existing = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(id);
  if (!existing) return null;

  const update = db.transaction(() => {
    const channel_count = channels ? channels.length : existing.channel_count;
    db.prepare(
      `UPDATE fixture_types SET name=?, manufacturer=?, category=?, channel_count=?, updated_at=datetime('now') WHERE id=?`
    ).run(name || existing.name, manufacturer ?? existing.manufacturer, category || existing.category, channel_count, id);

    if (channels) {
      db.prepare('DELETE FROM fixture_type_channels WHERE fixture_type_id = ?').run(id);
      const ins = db.prepare(
        `INSERT INTO fixture_type_channels (fixture_type_id, channel_number, name, type, default_value, min_value, max_value, ranges)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const ch of channels) {
        const rangesJson = ch.ranges ? (typeof ch.ranges === 'string' ? ch.ranges : JSON.stringify(ch.ranges)) : null;
        ins.run(id, ch.channel_number, ch.name, ch.type || 'dimmer', ch.default_value || 0, ch.min_value || 0, ch.max_value || 255, rangesJson);
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
  return db.prepare(`
    SELECT f.*, ft.name as type_name, ft.category, ft.channel_count
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    ORDER BY f.universe, f.address
  `).all();
}

function getFixture(id) {
  const f = db.prepare(`
    SELECT f.*, ft.name as type_name, ft.category, ft.channel_count
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    WHERE f.id = ?
  `).get(id);
  if (!f) return null;

  f.channels = db.prepare(
    'SELECT * FROM fixture_type_channels WHERE fixture_type_id = ? ORDER BY channel_number'
  ).all(f.fixture_type_id);
  return f;
}

function createFixture({ name, fixture_type_id, universe, address, output_type, notes }) {
  // Validate type exists
  const type = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(fixture_type_id);
  if (!type) return { error: 'Fixture type not found' };

  // Validate address range
  if (address < 1 || address > 512) return { error: 'Address must be 1-512' };
  if (address + type.channel_count - 1 > 512) return { error: `Address too high for ${type.channel_count}-channel fixture` };

  // Check for overlapping addresses in same universe
  const overlap = checkAddressOverlap(universe || 1, address, type.channel_count, null);
  if (overlap) return { error: overlap };

  const otype = output_type || 'artnet';
  const r = db.prepare(
    `INSERT INTO fixtures (name, fixture_type_id, universe, address, output_type, notes) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, fixture_type_id, universe || 1, address, otype, notes || '');

  return getFixture(r.lastInsertRowid);
}

function updateFixture(id, { name, fixture_type_id, universe, address, output_type, notes }) {
  const existing = db.prepare('SELECT * FROM fixtures WHERE id = ?').get(id);
  if (!existing) return null;

  const typeId = fixture_type_id || existing.fixture_type_id;
  const type = db.prepare('SELECT * FROM fixture_types WHERE id = ?').get(typeId);
  if (!type) return { error: 'Fixture type not found' };

  const addr = address ?? existing.address;
  const univ = universe ?? existing.universe;
  const otype = output_type || existing.output_type || 'artnet';

  if (addr < 1 || addr > 512) return { error: 'Address must be 1-512' };
  if (addr + type.channel_count - 1 > 512) return { error: `Address too high for ${type.channel_count}-channel fixture` };

  const overlap = checkAddressOverlap(univ, addr, type.channel_count, id);
  if (overlap) return { error: overlap };

  db.prepare(
    `UPDATE fixtures SET name=?, fixture_type_id=?, universe=?, address=?, output_type=?, notes=?, updated_at=datetime('now') WHERE id=?`
  ).run(name || existing.name, typeId, univ, addr, otype, notes ?? existing.notes, id);

  return getFixture(id);
}

function deleteFixture(id) {
  db.prepare('DELETE FROM fixtures WHERE id = ?').run(id);
  return { deleted: true };
}

// ─── Address Overlap Check ──────────────────────────────────────────────────

function checkAddressOverlap(universe, address, channelCount, excludeFixtureId) {
  const fixtures = db.prepare(
    `SELECT f.id, f.name, f.address, ft.channel_count
     FROM fixtures f
     JOIN fixture_types ft ON f.fixture_type_id = ft.id
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
    SELECT f.id, f.name, f.address, f.output_type, ft.channel_count, ft.name as type_name, ft.category
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
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
    `SELECT * FROM tracks ${whereClause} ORDER BY author, title ${limitClause}`
  ).all(...params);

  // Get total count for pagination
  const countParams = params.slice(0, params.length - (limit ? 2 : 0));
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM tracks ${whereClause}`
  ).get(...countParams).c;

  return { tracks, total };
}

function getTrack(id) {
  return db.prepare('SELECT * FROM tracks WHERE id = ?').get(id);
}

function getTrackByPath(filepath) {
  return db.prepare('SELECT * FROM tracks WHERE filepath = ?').get(filepath);
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
    SELECT f.id, f.name, f.universe, f.address, ft.channel_count, ft.name as type_name
    FROM fixtures f
    JOIN fixture_types ft ON f.fixture_type_id = ft.id
    ORDER BY f.universe, f.address
  `).all();

  return fixtures.map(f => {
    const channels = db.prepare(
      'SELECT channel_number, name, type, ranges FROM fixture_type_channels WHERE fixture_type_id = (SELECT fixture_type_id FROM fixtures WHERE id = ?) ORDER BY channel_number'
    ).all(f.id);
    const group_ids = db.prepare(
      'SELECT group_id FROM fixture_group_members WHERE fixture_id = ?'
    ).all(f.id).map(r => r.group_id);
    return {
      ...f,
      group_ids,
      channels: channels.map(ch => ({
        dmx_address: f.address + ch.channel_number - 1,
        channel_number: ch.channel_number,
        name: ch.name,
        type: ch.type,
        ranges: ch.ranges ? JSON.parse(ch.ranges) : null,
      })),
    };
  });
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
  db.prepare('DELETE FROM mover_presets WHERE id = ?').run(id);
  return { deleted: true };
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
  const rows = db.prepare('SELECT * FROM effects ORDER BY category, name').all();
  return rows.map(r => ({ ...r, effect_data: JSON.parse(r.effect_data || '{}') }));
}

function getEffect(id) {
  const r = db.prepare('SELECT * FROM effects WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, effect_data: JSON.parse(r.effect_data || '{}') };
}

function createEffect({ name, type, category, effect_data, duration_beats }) {
  if (!name || !name.trim()) return { error: 'Name is required' };
  const dataJson = typeof effect_data === 'string' ? effect_data : JSON.stringify(effect_data || {});
  const result = db.prepare(
    'INSERT INTO effects (name, type, category, effect_data, duration_beats) VALUES (?, ?, ?, ?, ?)'
  ).run(name.trim(), type || 'static', category || 'color', dataJson, duration_beats || 4);
  return getEffect(result.lastInsertRowid);
}

function updateEffect(id, { name, type, category, effect_data, duration_beats }) {
  const existing = db.prepare('SELECT * FROM effects WHERE id = ?').get(id);
  if (!existing) return null;
  const dataJson = effect_data !== undefined
    ? (typeof effect_data === 'string' ? effect_data : JSON.stringify(effect_data))
    : existing.effect_data;
  db.prepare(
    'UPDATE effects SET name=?, type=?, category=?, effect_data=?, duration_beats=? WHERE id=?'
  ).run(
    name !== undefined ? name.trim() : existing.name,
    type !== undefined ? type : existing.type,
    category !== undefined ? category : existing.category,
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
    SELECT ls.*, t.title as track_title, t.author as track_author, t.filename as track_filename
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
  if (!seq) return null;
  seq.cues = db.prepare('SELECT * FROM sequence_cues WHERE sequence_id = ? ORDER BY lane, start_ms').all(seq.id);
  seq.cues = seq.cues.map(c => ({
    ...c,
    channel_values: JSON.parse(c.channel_values || '{}'),
    end_channel_values: c.end_channel_values ? JSON.parse(c.end_channel_values) : null,
    effect_params: JSON.parse(c.effect_params || '{}'),
  }));
  return seq;
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

function updateSequence(id, { name, track_id, bpm, duration_ms, loop }) {
  const existing = db.prepare('SELECT * FROM light_sequences WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare(
    "UPDATE light_sequences SET name=?, track_id=?, bpm=?, duration_ms=?, loop=?, updated_at=datetime('now') WHERE id=?"
  ).run(
    name !== undefined ? name.trim() : existing.name,
    track_id !== undefined ? track_id : existing.track_id,
    bpm !== undefined ? bpm : existing.bpm,
    duration_ms !== undefined ? duration_ms : existing.duration_ms,
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
      channel_values, end_channel_values, effect_id, effect_params, color, label, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    cue.sort_order || 0
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
      channel_values=?, end_channel_values=?, effect_id=?, effect_params=?, color=?, label=?, sort_order=?
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
        channel_values, end_channel_values, effect_id, effect_params, color, label, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        cue.color || '#e94560', cue.label || '', cue.sort_order || 0
      );
    }
    db.prepare("UPDATE light_sequences SET updated_at=datetime('now') WHERE id=?").run(sequenceId);
  });
  txn();
  return getSequenceCues(sequenceId);
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  init,
  getFixtureTypes, getFixtureType, createFixtureType, updateFixtureType, deleteFixtureType,
  getFixtures, getFixture, createFixture, updateFixture, deleteFixture,
  getUniverseMap,
  getFixtureChannelMap,
  getGroups, getGroup, createGroup, updateGroup, deleteGroup, setGroupFixtures,
  getArtNetUniverses, getArtNetUniverse, createArtNetUniverse, updateArtNetUniverse, deleteArtNetUniverse, toggleArtNetUniverse,
  getSubscriptions, getEnabledSubscriptions, createSubscription, updateSubscription, deleteSubscription, toggleSubscription,
  getConfig, setConfig, getAllConfig,
  getTracks, getTrack, getTrackByPath, getTrackGenres, getTrackStats, importTracks, clearTracks,
  getButtonMaps, getEnabledButtonMaps, getButtonMap, createButtonMap, updateButtonMap, deleteButtonMap, toggleButtonMap,
  getMoverPresets, getMoverPreset, createMoverPreset, updateMoverPreset, deleteMoverPreset,
  getEffects, getEffect, createEffect, updateEffect, deleteEffect,
  getSequences, getSequence, getSequenceByTrackId, createSequence, updateSequence, deleteSequence,
  getSequenceCues, getCue, createCue, updateCue, deleteCue, bulkUpdateCues,
};
