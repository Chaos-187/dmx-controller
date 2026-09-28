'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parentPort, workerData } = require('worker_threads');

function fail(err) {
  const msg = (err && (err.stack || err.message))
    || (err != null ? String(err) : '')
    || 'Unknown VDJ parse worker error';
  try {
    parentPort.postMessage({ vdjParse: true, ok: false, error: msg });
  } catch (postErr) {
    try {
      parentPort.postMessage({
        vdjParse: true,
        ok: false,
        error: `${msg} (postMessage failed: ${postErr?.message || postErr})`,
      });
    } catch {
      /* parent gone */
    }
  }
}

try {
  const vdjParser = require('../vdj-parser');
  const xmlPath = workerData?.xmlPath;
  if (!xmlPath) throw new Error('xmlPath required');

  const resolved = vdjParser.resolveDatabasePath(xmlPath);
  const readPath = resolved.path || xmlPath;
  if (!fs.existsSync(readPath)) {
    throw new Error(resolved.error || `VDJ database not found: ${readPath}`);
  }

  const tracks = vdjParser.parseVdjDatabase(readPath, {
    onProgress: (p) => {
      parentPort.postMessage({
        vdjParse: true,
        progress: true,
        detail: p.detail,
        step: p.step,
        total: p.total,
      });
    },
  });


  // Large libraries (~40k+ tracks) can fail structured clone over postMessage.
  const CACHE_THRESHOLD = 2000;
  if (tracks.length >= CACHE_THRESHOLD) {
    const cacheFile = workerData.cacheFile || path.join(
      os.tmpdir(),
      `thaluxis-vdj-parse-${process.pid}-${Date.now()}.json`,
    );
    fs.writeFileSync(cacheFile, JSON.stringify(tracks));
    parentPort.postMessage({ vdjParse: true, ok: true, cacheFile, count: tracks.length });
  } else {
    parentPort.postMessage({ vdjParse: true, ok: true, tracks, count: tracks.length });
  }
} catch (e) {
  fail(e);
}
