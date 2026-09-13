'use strict';

const { parentPort } = require('worker_threads');

// db.js resolves paths from its own __dirname — no process.chdir (unsupported in worker threads).

function fail(err) {
  const msg = err?.stack || err?.message || String(err);
  parentPort.postMessage({ ok: false, error: msg });
}

try {
  const db = require('../db');
  db.init();
  db.closeDatabase();
  parentPort.postMessage({ ok: true });
} catch (e) {
  fail(e);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', (reason) => fail(reason));