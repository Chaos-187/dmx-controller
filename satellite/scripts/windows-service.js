/**
 * Install or remove Thaluxis Satellite as a Windows service.
 *
 * Requires Administrator PowerShell / CMD:
 *   npm run service:install
 *   npm run service:uninstall
 *
 * Uses node-windows (dev dependency). Service runs server.js from this folder.
 */

const path = require('path');

const action = process.argv[2];
if (!action || !['install', 'uninstall'].includes(action)) {
  console.error('Usage: node scripts/windows-service.js install|uninstall');
  process.exit(1);
}

let Service;
try {
  Service = require('node-windows').Service;
} catch {
  console.error('node-windows is not installed. Run from the satellite folder:');
  console.error('  npm install');
  process.exit(1);
}

const satelliteDir = path.join(__dirname, '..');
const scriptPath = path.join(satelliteDir, 'server.js');
const serviceName = 'ThaluxisSatellite';

const svc = new Service({
  name: serviceName,
  displayName: 'Thaluxis Satellite',
  description: 'Thaluxis Satellite — VirtualDJ OS2L link and track analysis for Thaluxis DMX hub.',
  script: scriptPath,
  workingDirectory: satelliteDir,
  wait: 2,
  grow: 0.5,
  maxRestarts: 10,
  env: [{
    name: 'NODE_ENV',
    value: 'production',
  }],
});

svc.on('install', () => {
  console.log(`[Service] Installed "${serviceName}" — starting…`);
  svc.start();
});

svc.on('alreadyinstalled', () => {
  console.log(`[Service] "${serviceName}" is already installed.`);
});

svc.on('uninstall', () => {
  console.log(`[Service] Uninstalled "${serviceName}".`);
});

svc.on('start', () => {
  console.log(`[Service] "${serviceName}" is running.`);
  console.log('Status UI: http://localhost:8788');
});

svc.on('error', (err) => {
  console.error('[Service] Error:', err);
});

if (action === 'install') {
  console.log(`Installing Windows service "${serviceName}"…`);
  console.log(`Script: ${scriptPath}`);
  svc.install();
} else {
  console.log(`Removing Windows service "${serviceName}"…`);
  svc.uninstall();
}
