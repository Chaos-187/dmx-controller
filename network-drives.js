/**
 * Connect mapped network drives on Windows (for services that cannot see user-session W:).
 */
'use strict';

const { execSync } = require('child_process');

function escapeCmdArg(value) {
  return String(value ?? '').replace(/"/g, '""');
}

/**
 * Map a drive letter to a UNC share, optionally with credentials.
 * @param {{ letter?: string, unc: string, username?: string, password?: string }} spec
 */
function connectNetworkDrive({ letter = 'W', unc, username, password }) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Network drive mapping is only supported on Windows' };
  }
  if (!unc || typeof unc !== 'string') {
    return { ok: false, error: 'UNC path required' };
  }

  const drive = String(letter || 'W').replace(':', '').toUpperCase();
  let uncPath = unc.trim().replace(/\//g, '\\');
  if (!uncPath.startsWith('\\\\')) uncPath = `\\\\${uncPath.replace(/^\\+/, '')}`;

  try {
    try {
      execSync(`net use ${drive}: /delete /y`, { stdio: 'ignore', windowsHide: true });
    } catch { /* not mapped yet */ }

    let cmd = `net use ${drive}: "${escapeCmdArg(uncPath)}"`;
    if (username) {
      cmd += ` /user:"${escapeCmdArg(username)}"`;
      if (password != null && password !== '') cmd += ` "${escapeCmdArg(password)}"`;
    }
    cmd += ' /persistent:no';

    execSync(cmd, { stdio: 'pipe', windowsHide: true, encoding: 'utf8' });
    console.log(`[Network] Mapped ${drive}: → ${uncPath}${username ? ` (as ${username})` : ''}`);
    return { ok: true, letter: drive, unc: uncPath };
  } catch (e) {
    const detail = (e.stderr || e.stdout || e.message || '').toString().trim();
    const msg = detail || e.message || 'net use failed';
    console.error(`[Network] Failed to map ${drive}: → ${uncPath}: ${msg}`);
    return { ok: false, error: msg, letter: drive, unc: uncPath };
  }
}

/** @param {Array<{ letter?: string, unc: string, username?: string, password?: string }>} drives */
function connectNetworkDrives(drives) {
  if (!Array.isArray(drives) || !drives.length) return [];
  const results = [];
  for (const spec of drives) {
    if (!spec?.unc) continue;
    results.push(connectNetworkDrive(spec));
  }
  return results;
}

module.exports = {
  connectNetworkDrive,
  connectNetworkDrives,
};
