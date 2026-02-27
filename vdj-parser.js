/**
 * VirtualDJ Database XML Parser
 *
 * Parses VirtualDJ's database.xml and returns an array of track objects
 * suitable for inserting into the tracks SQLite table.
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// ─── Parser Options ─────────────────────────────────────────────────────────

const parserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,   // keep as strings, we'll parse selectively
  isArray: (name) => name === 'Song' || name === 'Poi',
};

// ─── Parse a single <Song> element into a track object ──────────────────────

function parseSong(song) {
  const filePath = song['@_FilePath'] || '';
  const fileSize = parseInt(song['@_FileSize'] || '0', 10);
  const flag     = parseInt(song['@_Flag'] || '0', 10);

  // Tags
  const tags = song.Tags || {};
  const author  = tags['@_Author'] || '';
  const title   = tags['@_Title'] || '';
  const remix   = tags['@_Remix'] || '';
  const genre   = tags['@_Genre'] || '';
  const album   = tags['@_Album'] || '';
  const year    = tags['@_Year'] || '';
  const tagFlag = parseInt(tags['@_Flag'] || '0', 10);

  // Infos
  const infos = song.Infos || {};
  const songLength   = parseFloat(infos['@_SongLength'] || '0');
  const bitrate      = parseInt(infos['@_Bitrate'] || '0', 10);
  const lastModified = parseInt(infos['@_LastModified'] || '0', 10);
  const firstSeen    = parseInt(infos['@_FirstSeen'] || '0', 10);
  const cover        = infos['@_Cover'] || '';

  // Scan
  const scan = song.Scan || {};
  // VDJ stores beat interval (seconds between beats), convert to BPM: 60 / interval
  const rawBpm   = parseFloat(scan['@_Bpm'] || '0');
  const bpm      = rawBpm > 0 ? Math.round((60 / rawBpm) * 1000) / 1000 : 0;
  const key      = scan['@_Key'] || '';
  const volume   = parseFloat(scan['@_Volume'] || '0');
  const audioSig = scan['@_AudioSig'] || '';

  // Poi (points of interest — beatgrid, automix, etc.)
  let pois = song.Poi || [];
  if (!Array.isArray(pois)) pois = [pois];
  const poiData = pois
    .filter(p => p)
    .map(p => ({
      pos:   p['@_Pos'] || '',
      type:  p['@_Type'] || '',
      point: p['@_Point'] || '',
      num:   p['@_Num'] || '',
    }));

  // Extract beatgrid position (first beatgrid Poi)
  const beatgridPoi = poiData.find(p => p.type === 'beatgrid');
  const beatgridPos = beatgridPoi ? parseFloat(beatgridPoi.pos) : 0;

  // Extract all beatgrid anchor points (for multi-point tempo support)
  const beatgridPoints = poiData
    .filter(p => p.type === 'beatgrid' && p.pos)
    .map(p => ({ pos_sec: parseFloat(p.pos) }))
    .filter(p => !isNaN(p.pos_sec))
    .sort((a, b) => a.pos_sec - b.pos_sec);

  // Extract automix points
  const automixPoi = poiData.find(p => p.type === 'automix');
  const automixPoint = automixPoi ? automixPoi.point : '';

  // Link (netsearch)
  const link = song.Link || {};
  const netSearch = link['@_NetSearch'] || '';

  // Determine source type
  const isNetSearch = filePath.startsWith('netsearch://');
  const sourceType = isNetSearch ? 'netsearch' : 'local';

  // Build a display-friendly filename
  let filename = '';
  if (!isNetSearch) {
    filename = path.basename(filePath);
  } else {
    filename = title ? `${author} - ${title}` : filePath;
  }

  return {
    filepath: filePath,
    filename,
    file_size: fileSize,
    flag,
    author,
    title,
    remix,
    genre,
    album,
    year,
    tag_flag: tagFlag,
    song_length: songLength,
    bitrate,
    last_modified: lastModified,
    first_seen: firstSeen,
    cover,
    bpm,
    key,
    volume,
    audio_sig: audioSig,
    beatgrid_pos: beatgridPos,
    beatgrid_points: JSON.stringify(beatgridPoints),
    automix_point: automixPoint,
    poi_json: JSON.stringify(poiData),
    netsearch: netSearch,
    source_type: sourceType,
  };
}

// ─── Parse the full database.xml file ───────────────────────────────────────

function parseVdjDatabase(xmlPath) {
  if (!fs.existsSync(xmlPath)) {
    throw new Error(`VDJ database not found: ${xmlPath}`);
  }

  const xmlData = fs.readFileSync(xmlPath, 'utf-8');
  const parser = new XMLParser(parserOptions);
  const result = parser.parse(xmlData);

  // The root element is VirtualDJ_Database
  const root = result.VirtualDJ_Database;
  if (!root) {
    throw new Error('Invalid VDJ database: missing <VirtualDJ_Database> root element');
  }

  let songs = root.Song || [];
  if (!Array.isArray(songs)) songs = [songs];

  const tracks = songs.map(parseSong);

  return tracks;
}

// ─── Find VDJ database.xml automatically ────────────────────────────────────

function findVdjDatabase() {
  // Common VDJ database locations on Windows
  const candidates = [];

  // Check APPDATA
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'VirtualDJ', 'database.xml'));
  }
  // Check user's Documents folder
  if (process.env.USERPROFILE) {
    candidates.push(path.join(process.env.USERPROFILE, 'Documents', 'VirtualDJ', 'database.xml'));
  }
  // Check common drive locations
  candidates.push('C:\\Users\\Public\\Documents\\VirtualDJ\\database.xml');

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

module.exports = {
  parseVdjDatabase,
  findVdjDatabase,
};
