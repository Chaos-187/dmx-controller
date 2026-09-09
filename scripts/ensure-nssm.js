/**
 * Ensure nssm.exe is available for Windows service installation.
 * Downloads NSSM 2.24 on first use (build time).
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NSSM_CACHE = path.join(ROOT, 'installer', 'nssm', 'nssm.exe');
const NSSM_URL = 'https://nssm.cc/release/nssm-2.24.zip';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ensureNssmExe() {
  if (fs.existsSync(NSSM_CACHE)) return NSSM_CACHE;

  const zipPath = path.join(ROOT, 'installer', 'nssm.zip');
  const extractDir = path.join(ROOT, 'installer', 'nssm-extract');
  ensureDir(path.dirname(NSSM_CACHE));

  console.log('Downloading NSSM (Windows service wrapper)...');
  const ps = [
    "$ProgressPreference = 'SilentlyContinue'",
    `Invoke-WebRequest -Uri '${NSSM_URL}' -OutFile '${zipPath.replace(/'/g, "''")}'`,
    `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractDir.replace(/'/g, "''")}' -Force`,
  ].join('; ');

  execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${ps}"`, { stdio: 'inherit' });

  const src = path.join(extractDir, 'nssm-2.24', 'win64', 'nssm.exe');
  if (!fs.existsSync(src)) {
    throw new Error('NSSM download succeeded but win64/nssm.exe was not found in the archive');
  }

  fs.copyFileSync(src, NSSM_CACHE);
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
  try { fs.unlinkSync(zipPath); } catch (_) {}

  console.log(`Cached NSSM at ${NSSM_CACHE}`);
  return NSSM_CACHE;
}

module.exports = { ensureNssmExe, NSSM_CACHE };
