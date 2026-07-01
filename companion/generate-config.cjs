#!/usr/bin/env node
/**
 * Generate .companionconfig files from the current database (MIDI mappings + effects).
 *
 * Usage:
 *   node companion/generate-config.cjs [--host 192.168.1.50] [--port 80]
 *
 * For APC-matched pages, create default MIDI mappings in Config → MIDI first, then re-run.
 */

const path = require('path');
const fs = require('fs');
const { buildCompanionConfig } = require('./lib/config-builder.cjs');
const defaultEffects = require('./lib/default-effects-snapshot.cjs');

function loadEffects() {
  try {
    const db = require('../db');
    db.init();
    const effects = db.getEffects();
    if (effects.length > 0) return { effects, source: 'database' };
  } catch (e) {
    console.warn(`[companion:config] Database unavailable (${e.message}) — using default effect snapshot.`);
  }
  return { effects: defaultEffects, source: 'snapshot' };
}

function loadMidiMappings() {
  try {
    const db = require('../db');
    if (!db.getEffects) db.init();
    return db.getMidiMappings();
  } catch {
    return [];
  }
}

function loadDbLists() {
  try {
    const db = require('../db');
    if (!db.getEffects) db.init();
    return {
      fixtures: db.getFixtures(),
      scenes: db.getScenes(),
    };
  } catch {
    return { fixtures: [], scenes: [] };
  }
}

const { effects, source } = loadEffects();
const midiMappings = loadMidiMappings();
const { fixtures, scenes } = loadDbLists();

const args = process.argv.slice(2);
let host = '127.0.0.1';
let port = 80;
try {
  const db = require('../db');
  if (db.getConfig) port = parseInt(db.getConfig('web_port') || '80', 10);
} catch { /* use default port */ }

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--host' && args[i + 1]) host = args[++i];
  if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
}

const outDir = path.join(__dirname, 'config');
fs.mkdirSync(outDir, { recursive: true });

for (const layout of ['streamdeck15', 'streamdeck-xl']) {
  const config = buildCompanionConfig({ layout, host, port, effects, midiMappings, fixtures, scenes });
  const file = path.join(outDir, `dmx-controller-${layout}.companionconfig`);
  fs.writeFileSync(file, JSON.stringify(config, null, 2));
  console.log(`Wrote ${file}`);
}

console.log(`\nEffects source: ${source} (${effects.length} effects)`);
console.log(`Fixtures: ${fixtures.length}, Scenes: ${scenes.length}`);
const count = midiMappings.length;
if (count === 0) {
  console.log('\nNote: No MIDI mappings in database — configs use effect-type fallback layout.');
  console.log('For APC-matched pages, create default MIDI mappings in Config → MIDI first, then re-run.');
} else {
  console.log(`\nGenerated from ${count} MIDI mappings.`);
}

console.log('\nImport in Companion: Settings → Import / Export → import the .companionconfig file.');
console.log('Remap the "DMX Controller" connection to your server IP if needed.');
