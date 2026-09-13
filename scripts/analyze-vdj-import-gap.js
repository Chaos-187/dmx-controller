'use strict';

const vdj = require('../vdj-parser');

function norm(s) {
  return (s || '').trim().toLowerCase();
}

function pathSuffixKey(filepath) {
  if (!filepath) return '';
  const m = filepath.match(/^[A-Za-z]:[\\/](.*)$/);
  return (m ? m[1] : filepath).replace(/\//g, '\\').toLowerCase();
}

function identityFullKey(author, title, remix) {
  return `${norm(author)}\0${norm(title)}\0${norm(remix)}`;
}

function identityTitleKey(author, title) {
  return `${norm(author)}\0${norm(title)}`;
}

function simulateImport(tracks) {
  const index = {
    byExactPath: new Map(),
    byPathSuffix: new Map(),
    byAudioSig: new Map(),
    byIdentityFull: new Map(),
    byIdentityTitle: new Map(),
  };

  function resolveExistingId(track) {
    if (norm(track.title)) {
      const full = index.byIdentityFull.get(identityFullKey(track.author, track.title, track.remix));
      if (full) return full.id;
      const titleOnly = index.byIdentityTitle.get(identityTitleKey(track.author, track.title));
      if (titleOnly) return titleOnly.id;
    }
    if (track.audio_sig) {
      const bySig = index.byAudioSig.get(track.audio_sig);
      if (bySig) return bySig.id;
    }
    const exact = index.byExactPath.get(track.filepath);
    if (exact) return exact.id;
    const suffix = pathSuffixKey(track.filepath);
    if (suffix) {
      const bySuffix = index.byPathSuffix.get(suffix);
      if (bySuffix) return bySuffix.id;
    }
    return null;
  }

  function register(id, track) {
    const entry = { id };
    index.byExactPath.set(track.filepath, entry);
    const suffix = pathSuffixKey(track.filepath);
    if (suffix) index.byPathSuffix.set(suffix, entry);
    if (track.audio_sig) index.byAudioSig.set(track.audio_sig, entry);
    if (norm(track.title)) {
      index.byIdentityFull.set(identityFullKey(track.author, track.title, track.remix), entry);
      index.byIdentityTitle.set(identityTitleKey(track.author, track.title), entry);
    }
  }

  let nextId = 1;
  let inserted = 0;
  let merged = 0;
  for (const t of tracks) {
    const ex = resolveExistingId(t);
    if (ex) {
      merged++;
      register(ex, t);
    } else {
      register(nextId, t);
      nextId++;
      inserted++;
    }
  }
  return { rows: nextId - 1, inserted, merged };
}

const xmlPath = process.argv[2] || 'W:\\VirtualDJ\\database.xml';
const tracks = vdj.parseVdjDatabase(xmlPath);
const sim = simulateImport(tracks);

const db = require('../db');
db.init();
const hubCount = db.getTrackStats().total;

console.log('VDJ database.xml Song count:', tracks.length);
console.log('Simulated hub rows (full import, merge rules):', sim.rows);
console.log('Actual hub tracks table:', hubCount);
console.log('Gap vs XML (47218 - hub):', tracks.length - hubCount);
console.log('Gap explained by merge (47218 - sim rows):', tracks.length - sim.rows);
console.log('Unexplained gap (sim rows - hub):', sim.rows - hubCount);
