/**
 * Build the Windows installer with Inno Setup (optional local step after npm run build).
 *
 * Usage: node scripts/build-installer.js
 * Requires Inno Setup 6 (iscc on PATH), e.g. choco install innosetup
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ISS = path.join(ROOT, 'installer', 'thaluxis-dmx.iss');
const pkg = require('../package.json');

if (!fs.existsSync(path.join(DIST, 'dmx-controller.exe'))) {
  console.error('dist/dmx-controller.exe not found — run npm run build first.');
  process.exit(1);
}

const isccPaths = [
  'iscc',
  'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
  'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
];

let iscc = null;
for (const candidate of isccPaths) {
  try {
    if (candidate === 'iscc') {
      execSync('iscc /?', { stdio: 'ignore' });
      iscc = candidate;
      break;
    }
    if (fs.existsSync(candidate)) {
      iscc = candidate;
      break;
    }
  } catch (_) {}
}

if (!iscc) {
  console.error('Inno Setup not found. Install from https://jrsoftware.org/isinfo.php');
  console.error('  or: choco install innosetup');
  process.exit(1);
}

console.log(`Building installer v${pkg.version} with ${iscc}...`);
execSync(`"${iscc}" "${ISS}" /DMyAppVersion=${pkg.version}`, {
  cwd: ROOT,
  stdio: 'inherit',
});

const setupExe = path.join(ROOT, `dmx-controller-${pkg.version}-setup.exe`);
if (!fs.existsSync(setupExe)) {
  console.error('Installer build failed — output exe not found.');
  process.exit(1);
}

console.log(`\nInstaller ready: ${setupExe}`);
