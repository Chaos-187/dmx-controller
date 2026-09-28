'use strict';

/**
 * Reproduces the VDJ import UNIQUE(tracks.filepath) failure mode and verifies
 * the conflict-aware resolve/update path.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vdj-unique-'));
const dbPath = path.join(tmpDir, 'test.db');
process.env.DMX_DB_PATH = dbPath;

const db = require('../db');
db.init();

function track(partial) {
  return {
    filepath: '',
    filename: '',
    file_size: 0,
    flag: 0,
    author: '',
    title: '',
    remix: '',
    genre: '',
    album: '',
    year: '',
    tag_flag: 0,
    song_length: 0,
    bitrate: 0,
    last_modified: 0,
    first_seen: 0,
    cover: '',
    bpm: 0,
    key: '',
    volume: 0,
    audio_sig: '',
    beatgrid_pos: 0,
    automix_point: '',
    poi_json: '[]',
    netsearch: '',
    source_type: 'local',
    ...partial,
  };
}

/** Insert a second row that would collide under identity merge (bypass importTracks). */
function insertRawTrack(partial) {
  const t = track(partial);
  const raw = new Database(dbPath);
  try {
    const r = raw.prepare(`
      INSERT INTO tracks (
        filepath, filename, file_size, flag, author, title, remix, genre, album, year,
        tag_flag, song_length, bitrate, last_modified, first_seen, cover,
        bpm, key, volume, audio_sig, beatgrid_pos, automix_point, poi_json,
        netsearch, source_type
      ) VALUES (
        @filepath, @filename, @file_size, @flag, @author, @title, @remix, @genre, @album, @year,
        @tag_flag, @song_length, @bitrate, @last_modified, @first_seen, @cover,
        @bpm, @key, @volume, @audio_sig, @beatgrid_pos, @automix_point, @poi_json,
        @netsearch, @source_type
      )
    `).run(t);
    return Number(r.lastInsertRowid);
  } finally {
    raw.close();
  }
}

function countExact(filepath) {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return raw.prepare('SELECT COUNT(*) AS c FROM tracks WHERE filepath = ?').get(filepath).c;
  } finally {
    raw.close();
  }
}

function getExact(filepath) {
  const raw = new Database(dbPath, { readonly: true });
  try {
    return raw.prepare('SELECT * FROM tracks WHERE filepath = ?').get(filepath) || null;
  } finally {
    raw.close();
  }
}

const oldPath = 'D:\\Music\\Artist - Title.mp3';
const newPath = 'E:\\Music\\Artist - Title.mp3';

db.importTracks([
  track({ filepath: oldPath, filename: 'Artist - Title.mp3', author: 'Artist', title: 'Title', bpm: 120 }),
]);
const pathOwnerId = insertRawTrack({
  filepath: newPath,
  filename: 'Artist - Title.mp3',
  author: 'Artist',
  title: 'Title',
  bpm: 128,
});

const oldRow = getExact(oldPath);
const newRow = getExact(newPath);
if (!oldRow || !newRow || oldRow.id === newRow.id) {
  console.error('FAIL: need two distinct seed rows', { oldRow, newRow, pathOwnerId });
  process.exit(1);
}

db.upsertTrackAnalysis(newRow.id, { waveform_peaks: [], duration_ms: 1000 });
db.createSequence({ name: 'seq', track_id: oldRow.id, bpm: 120 });

console.log('Seeded: old id=%s | new id=%s (protected analysis)', oldRow.id, newRow.id);

let threw = null;
let result;
try {
  result = db.importTracks([
    track({
      filepath: newPath,
      filename: 'Artist - Title.mp3',
      author: 'Artist',
      title: 'Title',
      bpm: 124,
      genre: 'House',
    }),
  ]);
} catch (e) {
  threw = e;
}

if (threw) {
  console.error('FAIL: import threw:', threw.message);
  process.exit(1);
}

const afterOld = getExact(oldPath);
const afterNew = getExact(newPath);
const seqStillOnOld = !!db.getSequenceByTrackId(oldRow.id);
const anStillOnNew = !!db.getTrackAnalysis(newRow.id);

console.log('Result:', result);
console.log('After old:', afterOld && { id: afterOld.id, bpm: afterOld.bpm, genre: afterOld.genre });
console.log('After new:', afterNew && { id: afterNew.id, bpm: afterNew.bpm, genre: afterNew.genre });

const ok =
  afterNew
  && afterNew.id === newRow.id
  && afterNew.genre === 'House'
  && afterNew.bpm === 124
  && afterOld
  && afterOld.id === oldRow.id
  && countExact(oldPath) === 1
  && countExact(newPath) === 1
  && seqStillOnOld
  && anStillOnNew;

// Clearable stub at new path → identity row with sequence should migrate
const migrateOld = 'D:\\Music\\Migrate Me.mp3';
const migrateNew = 'E:\\Music\\Migrate Me.mp3';
db.importTracks([
  track({ filepath: migrateOld, filename: 'Migrate Me.mp3', author: 'Mig', title: 'Me', bpm: 100 }),
]);
insertRawTrack({
  filepath: migrateNew,
  filename: 'Migrate Me.mp3',
  author: 'Mig',
  title: 'Me',
  bpm: 0,
});
const migOld = getExact(migrateOld);
const migStub = getExact(migrateNew);
db.createSequence({ name: 'mig', track_id: migOld.id, bpm: 100 });

let migResult;
try {
  migResult = db.importTracks([
    track({ filepath: migrateNew, filename: 'Migrate Me.mp3', author: 'Mig', title: 'Me', bpm: 101, genre: 'Techno' }),
  ]);
} catch (e) {
  console.error('FAIL: migrate import threw:', e.message);
  process.exit(1);
}

const migAfterNew = getExact(migrateNew);
const migAfterOld = getExact(migrateOld);
const migOk =
  migAfterNew
  && migAfterNew.id === migOld.id
  && migAfterNew.genre === 'Techno'
  && migAfterNew.bpm === 101
  && !migAfterOld
  && (migResult.duplicatesRemoved || 0) >= 1
  && (migResult.pathUpdated || 0) >= 1
  && !!db.getSequenceByTrackId(migOld.id);

console.log('Migrate result:', migResult);
console.log('Migrate after new:', migAfterNew && { id: migAfterNew.id, bpm: migAfterNew.bpm, genre: migAfterNew.genre });
console.log('Migrate stub id was:', migStub && migStub.id, '| old gone:', !migAfterOld);

db.closeDatabase();

if (ok && migOk) {
  console.log('PASS: protected path conflict updates path owner; clearable stub migrates identity row');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(0);
}

console.error('FAIL: assertions failed', { ok, migOk });
process.exit(1);
