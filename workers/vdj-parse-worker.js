'use strict';

const { parentPort, workerData } = require('worker_threads');

// vdj-parser uses absolute xmlPath — no process.chdir (unsupported in worker threads).

function fail(err) {
  const msg = err?.stack || err?.message || String(err);
  parentPort.postMessage({ ok: false, error: msg });
}

try {
  const vdjParser = require('../vdj-parser');
  const xmlPath = workerData?.xmlPath;
  if (!xmlPath) throw new Error('xmlPath required');
  const tracks = vdjParser.parseVdjDatabase(xmlPath);
  parentPort.postMessage({ ok: true, tracks });
} catch (e) {
  fail(e);
}
