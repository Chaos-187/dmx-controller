/**
 * Dev runner: restart server.js on project file changes only.
 * Plain `node --watch server.js` also watches imported node_modules and can
 * restart constantly (e.g. iconv-lite touched by AV/indexers).
 */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

/** @returns {string[]} absolute paths for --watch-path */
function collectWatchPaths() {
  const paths = new Set();

  for (const name of fs.readdirSync(root)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
    const full = path.join(root, name);
    const st = fs.statSync(full);
    if (st.isFile() && name.endsWith('.js')) paths.add(full);
  }

  const dirs = ['public', 'gen', path.join('companion', 'lib'), path.join('companion', 'companion')];
  for (const rel of dirs) {
    const full = path.join(root, rel);
    if (fs.existsSync(full)) paths.add(full);
  }

  return [...paths];
}

const watchPaths = collectWatchPaths();
const nodeArgs = ['--watch'];
for (const p of watchPaths) nodeArgs.push('--watch-path', p);
nodeArgs.push('server.js');

const child = spawn(process.execPath, nodeArgs, {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
