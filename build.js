/**
 * Build Script — compile dmx-controller into a standalone .exe
 *
 * Uses @yao-pkg/pkg to bundle the Node.js runtime + all JS source into a
 * single executable.  Assets (public/, waveform-data) are embedded in the
 * snapshot.  Native .node addons and external binaries (ffmpeg) are copied
 * alongside the exe because they cannot live inside the snapshot.
 *
 * Usage:  npm run build
 * Output: dist/dmx-controller.exe  (+ supporting files)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

// ─── Helpers ────────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  copied: ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
  } else {
    console.warn(`  SKIP (not found): ${path.relative(ROOT, src)}`);
  }
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) { console.warn(`  SKIP dir (not found): ${src}`); return; }
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  console.log(`  copied dir: ${path.relative(ROOT, src)} -> ${path.relative(ROOT, dest)}`);
}

// ─── Clean dist ─────────────────────────────────────────────────────────────

console.log('\n=== DMX Controller Build ===\n');

if (fs.existsSync(DIST)) {
  fs.rmSync(DIST, { recursive: true, force: true });
  console.log('Cleaned dist/');
}
ensureDir(DIST);

// ─── Run pkg ────────────────────────────────────────────────────────────────

console.log('\nRunning pkg...');
try {
  execSync('npx pkg . --compress GZip', {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch (e) {
  console.error('\npkg failed. Make sure @yao-pkg/pkg is installed (npm install).');
  process.exit(1);
}

// ─── Copy native addons ─────────────────────────────────────────────────────

console.log('\nCopying native addons...');

// better-sqlite3
copyFile(
  path.join(ROOT, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
  path.join(DIST, 'better_sqlite3.node')
);

// ftdi-d2xx (Windows x64)
copyFile(
  path.join(ROOT, 'node_modules/ftdi-d2xx/build/Release/ftdi-d2xx.Windows.AMD64.node'),
  path.join(DIST, 'ftdi-d2xx.Windows.AMD64.node')
);

// usb — uses prebuild-install with node-gyp-build, needs the prebuilds directory structure
const usbPrebuildsDir = path.join(ROOT, 'node_modules/usb/prebuilds/win32-x64');
const usbDestDir = path.join(DIST, 'prebuilds/win32-x64');
if (fs.existsSync(usbPrebuildsDir)) {
  ensureDir(usbDestDir);
  for (const f of fs.readdirSync(usbPrebuildsDir)) {
    copyFile(path.join(usbPrebuildsDir, f), path.join(usbDestDir, f));
  }
}

// ─── Copy ffmpeg binaries ───────────────────────────────────────────────────

console.log('\nCopying ffmpeg binaries...');
for (const bin of ['ffmpeg.exe', 'ffplay.exe', 'ffprobe.exe']) {
  copyFile(path.join(ROOT, bin), path.join(DIST, bin));
}

// ─── Done ───────────────────────────────────────────────────────────────────

console.log('\n=== Build complete ===');
console.log(`Output: ${DIST}`);
console.log('\nContents:');
for (const f of fs.readdirSync(DIST, { recursive: true })) {
  const full = path.join(DIST, f.toString());
  if (!fs.statSync(full).isDirectory()) {
    const size = (fs.statSync(full).size / 1024 / 1024).toFixed(1);
    console.log(`  ${f} (${size} MB)`);
  }
}
console.log('\nTo run: dist\\dmx-controller.exe');
console.log('Note: Place your dmx-controller.db alongside the exe (created on first run if missing).\n');
