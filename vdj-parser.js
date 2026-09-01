/**
 * VirtualDJ Database XML Parser
 *
 * Parses VirtualDJ's database.xml and returns an array of track objects
 * suitable for inserting into the tracks SQLite table.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
      bpm:   parseFloat(p['@_Bpm'] || '0') || 0,
    }));

  // Extract beatgrid position (first beatgrid Poi)
  const beatgridPoi = poiData.find(p => p.type === 'beatgrid');
  const beatgridPos = beatgridPoi ? parseFloat(beatgridPoi.pos) : 0;

  // Extract all beatgrid anchor points (for multi-point tempo support)
  const beatgridPoints = poiData
    .filter(p => p.type === 'beatgrid' && p.pos)
    .map(p => ({
      pos_sec: parseFloat(p.pos),
      bpm: p.bpm > 0 ? p.bpm : undefined,
    }))
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

// ─── Resolve database path (mapped drives → UNC for Windows services) ───────

function uncRootForDriveLetter(letter) {
  if (process.platform !== 'win32') return null;
  const drive = String(letter || '').replace(':', '').toUpperCase();
  if (!drive) return null;
  try {
    const out = execSync(`net use ${drive}:`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const m = out.match(/Remote name\s+(\S+)/i);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Resolve database.xml path for read access.
 * Windows services cannot use mapped drives (W:) — converts to UNC when possible.
 */
function resolveDatabasePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return { path: null, error: 'No path configured' };
  }

  const trimmed = inputPath.trim();
  if (!trimmed) return { path: null, error: 'No path configured' };

  if (fs.existsSync(trimmed)) {
    return { path: trimmed };
  }

  const driveMatch = trimmed.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (driveMatch && process.platform === 'win32') {
    const uncRoot = uncRootForDriveLetter(driveMatch[1]);
    const rest = driveMatch[2].replace(/\//g, '\\');
    if (uncRoot) {
      const uncPath = path.win32.join(uncRoot, rest);
      if (fs.existsSync(uncPath)) {
        return { path: uncPath, resolvedFrom: trimmed };
      }
      return {
        path: null,
        error: `VDJ database not found at UNC path: ${uncPath}`,
        hint: uncPath,
        resolvedFrom: trimmed,
      };
    }
    return {
      path: null,
      error: `Cannot access mapped drive ${driveMatch[1].toUpperCase()}:\\ — Windows services do not see Explorer mapped drives.`,
      hint: `Configure the network drive in Satellite Settings (letter ${driveMatch[1].toUpperCase()}, UNC share, username, password) and save, or use a full UNC path like \\\\server\\share\\VirtualDJ\\database.xml.`,
    };
  }

  return { path: null, error: `VDJ database not found: ${trimmed}` };
}

/** Prefer resolved path; fall back to original string for storage attempts. */
function normalizeDatabasePath(inputPath) {
  const resolved = resolveDatabasePath(inputPath);
  return resolved.path || (typeof inputPath === 'string' ? inputPath.trim() : '');
}

// ─── Parse the full database.xml file ───────────────────────────────────────

/** Read database.xml and release the file handle immediately (important on network shares). */
function readDatabaseXml(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const buf = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const read = fs.readSync(fd, buf, offset, size - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
    return buf.toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

function parseVdjDatabase(xmlPath) {
  const resolved = resolveDatabasePath(xmlPath);
  if (!resolved.path) {
    throw new Error(resolved.error || `VDJ database not found: ${xmlPath}`);
  }

  const actualPath = resolved.path;
  const xmlData = readDatabaseXml(actualPath);
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
  resolveDatabasePath,
  normalizeDatabasePath,
};
