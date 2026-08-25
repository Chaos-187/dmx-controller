/**
 * Rebuild native addons for the current Node.js version (local dev / satellite).
 * Run after upgrading Node: npm run rebuild:native:dev
 *
 * Stop dev servers and Windows services first if rebuild reports EPERM.
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const modules = ['better-sqlite3', 'ftdi-d2xx', 'usb'];

console.log(`Rebuilding native modules for Node ${process.version} (ABI ${process.versions.modules})…\n`);

try {
  execSync(`npm rebuild ${modules.join(' ')}`, { cwd: ROOT, stdio: 'inherit' });
  console.log('\nDone. Restart the app / Thaluxis Satellite service if running.');
} catch (e) {
  console.error('\nRebuild failed. Close dmx-controller, satellite dev, and the Thaluxis Satellite Windows service, then retry.');
  process.exit(1);
}
