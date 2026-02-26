#!/usr/bin/env node
/**
 * Ad-hoc script: migrate color_wheel_colors table from dmx_value to dmx_start/dmx_end,
 * then insert the correct color wheel map for the Generic 60W Spot Moving Head.
 */
const Database = require('better-sqlite3');
const db = new Database('./dmx-controller.db');

// Check if migration is needed (old dmx_value column still present)
let needsMigration = false;
try {
  db.prepare("SELECT dmx_value FROM color_wheel_colors LIMIT 1").get();
  needsMigration = true; // old column still exists — need to recreate table
} catch (e) {
  // dmx_value column doesn't exist — table is already migrated
  // But check dmx_start exists
  try {
    db.prepare("SELECT dmx_start FROM color_wheel_colors LIMIT 1").get();
    console.log('[OK] Table already has dmx_start/dmx_end columns (no dmx_value)');
  } catch (e2) {
    console.error('[ERROR] Table has neither dmx_value nor dmx_start — unexpected state');
    db.close();
    process.exit(1);
  }
}

if (needsMigration) {
  console.log('[MIGRATE] Recreating color_wheel_colors table...');
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
  console.log('[MIGRATE] Done — old dmx_value column removed');
}

// Find the fixture type
const ft = db.prepare("SELECT id FROM fixture_types WHERE name = 'Generic 60W Spot Moving Head'").get();
if (!ft) {
  console.error('[ERROR] Generic 60W Spot Moving Head fixture type not found');
  db.close();
  process.exit(1);
}
console.log(`[INFO] fixture_type_id = ${ft.id}`);

// Clear existing entries
db.prepare('DELETE FROM color_wheel_colors WHERE fixture_type_id = ?').run(ft.id);

// Insert the correct color wheel map with ranges
const ins = db.prepare(
  'INSERT INTO color_wheel_colors (fixture_type_id, dmx_start, dmx_end, color_hex, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
);

const colors = [
  { start: 0,   end: 9,   hex: '#ffffff', label: 'White' },
  { start: 10,  end: 19,  hex: '#ff0000', label: 'Red' },
  { start: 20,  end: 29,  hex: '#00ff00', label: 'Green' },
  { start: 30,  end: 39,  hex: '#0000ff', label: 'Blue' },
  { start: 40,  end: 49,  hex: '#ffff00', label: 'Yellow' },
  { start: 50,  end: 59,  hex: '#ff8000', label: 'Flush Orange' },
  { start: 60,  end: 69,  hex: '#00ffff', label: 'Cyan / Aqua' },
  { start: 70,  end: 79,  hex: '#ff00ff', label: 'Magenta' },
  { start: 80,  end: 89,  hex: '#7f7fc8', label: 'Moody Blue' },
  { start: 90,  end: 99,  hex: '#b4b4ff', label: 'Sail' },
  { start: 100, end: 109, hex: '#ff4600', label: 'Vermilion' },
  { start: 110, end: 119, hex: '#7fff7f', label: 'Pastel Green' },
  { start: 120, end: 129, hex: '#00b4b4', label: 'Bondi Blue' },
  { start: 130, end: 139, hex: '#7f7f00', label: 'Olive' },
];

const tx = db.transaction(() => {
  colors.forEach((c, i) => {
    ins.run(ft.id, c.start, c.end, c.hex, c.label, i);
  });
});
tx();

console.log(`[OK] Inserted ${colors.length} color wheel entries`);

// Verify
const rows = db.prepare(
  'SELECT dmx_start, dmx_end, color_hex, label FROM color_wheel_colors WHERE fixture_type_id = ? ORDER BY sort_order'
).all(ft.id);
console.table(rows);

db.close();
console.log('[DONE]');
