/**
 * Install or remove Thaluxis Master as a Windows service.
 *
 * Requires Administrator PowerShell / CMD:
 *   npm run service:install
 *   npm run service:uninstall
 *
 * Uses node-windows (dev dependency). Service runs server.js from the project root.
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
  console.error('node-windows is not installed. Run from the project root:');
  console.error('  npm install');
  process.exit(1);
}

const projectRoot = path.join(__dirname, '..');
const scriptPath = path.join(projectRoot, 'server.js');
const serviceName = 'ThaluxisMaster';

const svc = new Service({
  name: serviceName,
  displayName: 'Thaluxis Master',
  description: 'Thaluxis Master — DMX lighting control, Art-Net output, and VirtualDJ OS2L integration.',
  script: scriptPath,
  workingDirectory: projectRoot,
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
  console.log('Web UI: http://localhost');
  console.log('OS2L port: 8787 (when hub OS2L is enabled in config)');
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
