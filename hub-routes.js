/**
 * Hub Routes — satellite pairing, discovery, and sync API.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const discovery = require('./satellite-discovery');
const brand = require('./thaluxis-brand');

let db;
let audioAnalyzer;
let handleOs2lSubscribed;
let handleOs2lButton;
let broadcast;
let getAnalysisConfig;
let getAnchorPoints;
let generateSequenceForTrack;
let onSequenceGenerated;
let requireHubAdminAuth = (_req, _res, next) => next();

function init(deps) {
  db = deps.db;
  audioAnalyzer = deps.audioAnalyzer;
  handleOs2lSubscribed = deps.handleOs2lSubscribed;
  handleOs2lButton = deps.handleOs2lButton;
  broadcast = deps.broadcast;
  getAnalysisConfig = deps.getAnalysisConfig;
  getAnchorPoints = deps.getAnchorPoints;
  generateSequenceForTrack = deps.generateSequenceForTrack;
  onSequenceGenerated = deps.onSequenceGenerated;
  requireHubAdminAuth = deps.requireAuth || requireHubAdminAuth;
  ensureSatelliteToken();

  discovery.startSatelliteDiscovery((found) => {
    broadcast?.({ type: 'satellite_discovered', count: found.length });
    broadcastSatelliteStatus();
  });
}

function ensureSatelliteToken() {
  if (!db.getConfig('satellite_token')) {
    db.setConfig('satellite_token', crypto.randomBytes(24).toString('hex'));
  }
}

function getSatelliteToken() {
  ensureSatelliteToken();
  return db.getConfig('satellite_token');
}

function isSatelliteEnabled() {
  return db.getConfig('satellite_enabled') !== '0';
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '')
    .toString().replace(/^::ffff:/, '').split(',')[0].trim();
}

function requireSatelliteAuth(req, res, next) {
  if (!isSatelliteEnabled()) {
    return res.status(403).json({ error: 'Satellite mode is disabled on this hub' });
  }

  const deviceId = req.headers['x-satellite-device-id'];
  const token = req.headers['x-satellite-token']
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

  if (deviceId) {
    const device = db.validateSatelliteDeviceAuth(deviceId, token);
    if (!device) {
      return res.status(401).json({ error: 'Device not authorized — accept this device in Config → Thaluxis Satellites' });
    }
    db.touchSatelliteDevice(deviceId, clientIp(req));
    req.satelliteDevice = device;
    return next();
  }

  if (token && token === getSatelliteToken()) {
    req.satelliteDevice = { name: req.headers['x-satellite-name'] || brand.SATELLITE_DEFAULT_NAME, legacy: true };
    return next();
  }

  return res.status(401).json({ error: 'Invalid or missing satellite credentials' });
}

function publicDevice(device) {
  if (!device) return null;
  const { token, ...rest } = device;
  return rest;
}

/** Auto-generate a sequence when analysis arrives and seq_auto_generate is enabled. */
async function maybeAutoGenerateSequence(trackId, { source = 'hub' } = {}) {
  if (!generateSequenceForTrack) return null;
  if (db.getConfig('seq_auto_generate') !== '1') return null;

  const track = db.getTrack(trackId);
  if (!track) return null;

  const existing = db.getSequenceByTrackId(trackId);
  if (existing) {
    const regenStale = db.getConfig('seq_auto_regenerate_stale') === '1';
    const stale = regenStale && db.isSequenceFixtureStale(existing);
    if (!stale) {
      const cue_count = db.getSequenceCues(existing.id)?.length || 0;
      console.log(`[Hub] Sequence already exists for track ${trackId} "${existing.name}" (${cue_count} cues) — skipping auto-generate (${source})`);
      onSequenceGenerated?.(trackId, { sequence: existing, cue_count, skipped: 'exists' });
      return { sequence: existing, cue_count, skipped: 'exists' };
    }
  }

  const analysis = db.getTrackAnalysis(trackId);
  if (!analysis) return null;

  try {
    const fixtures = db.getFixtureChannelMap();
    const result = await generateSequenceForTrack(track, {
      overwrite: !!existing,
      fixtures,
      analysis,
      skipAnalysis: true,
    });
    if (result?.sequence) {
      console.log(`[Hub] Auto-generated sequence "${result.sequence.name}" (${result.cue_count} cues) for track ${trackId} (${source})`);
      broadcast?.({
        type: 'seq_generated',
        track_id: trackId,
        sequence: {
          ...result.sequence,
          cues: undefined,
          cue_count: result.cue_count,
        },
        source,
      });
      onSequenceGenerated?.(trackId, result);
    }
    return result;
  } catch (e) {
    console.error(`[Hub] Auto-generate sequence failed for track ${trackId}: ${e.message}`);
    return null;
  }
}

const SATELLITE_ACTIVE_MS = 3 * 60 * 1000;

function parseSqliteDatetime(value) {
  if (!value) return NaN;
  const s = String(value).trim();
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const withTz = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  return Date.parse(withTz);
}

function isRecentlyActive(lastSeen, maxAgeMs = SATELLITE_ACTIVE_MS) {
  const t = parseSqliteDatetime(lastSeen);
  return !Number.isNaN(t) && (Date.now() - t) < maxAgeMs;
}

function getSatelliteStatusSummary() {
  if (!isSatelliteEnabled()) {
    return { enabled: false, connected_count: 0, pending_count: 0, connected: [], pending: [] };
  }

  const approved = db.getSatelliteDevices('approved');
  const pending = db.getSatelliteDevices('pending');
  const discovered = discovery.getDiscoveredSatellites();
  const discoveredIds = new Set(discovered.map(d => d.device_id).filter(Boolean));

  const connected = [];
  for (const device of approved) {
    const active = isRecentlyActive(device.last_seen);
    const onLan = device.device_id && discoveredIds.has(device.device_id);
    if (!active && !onLan) continue;
    connected.push({
      id: device.id,
      name: device.name,
      ip: device.ip,
      device_id: device.device_id,
      active,
      on_lan: onLan,
    });
  }

  return {
    enabled: true,
    connected_count: connected.length,
    pending_count: pending.length,
    connected,
    pending: pending.map(d => ({ id: d.id, name: d.name, ip: d.ip })),
  };
}

function broadcastSatelliteStatus() {
  broadcast?.({ type: 'satellite_status', ...getSatelliteStatusSummary() });
}

/** Hub discovery */
router.get('/status', (req, res) => {
  res.json({
    role: 'hub',
    product: 'Thaluxis DMX',
    name: brand.getHubDisplayName(db),
    bonjour_name: brand.getHubBonjourName(db),
    mdns_hostname: db.getConfig('mdns_hostname') || 'thaluxis',
    satellite_enabled: isSatelliteEnabled(),
    os2l_local: db.getConfig('hub_os2l_local') !== '0',
    analysis_version: audioAnalyzer?.ANALYSIS_VERSION || 0,
    version: require('./package.json').version,
  });
});

/** Public satellite connection summary (main UI status bar) */
router.get('/satellites/status', (req, res) => {
  res.json(getSatelliteStatusSummary());
});

/** Satellite requests pairing (no auth) */
router.post('/pair/request', (req, res) => {
  if (!isSatelliteEnabled()) {
    return res.status(403).json({ error: 'Satellite mode is disabled on this hub' });
  }

  const { device_id, name, ip, web_port, os2l_port } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id required' });

  const device = db.upsertSatellitePairRequest({
    device_id,
    name: name || brand.SATELLITE_DEFAULT_NAME,
    ip: ip || clientIp(req),
    web_port: web_port || 8788,
    os2l_port: os2l_port || 8787,
  });

  if (device.status === 'pending') {
    console.log(`[Hub] Satellite pairing request: "${device.name}" (${device.device_id}) from ${device.ip}`);
    broadcast?.({ type: 'satellite_pair_request', device: publicDevice(device) });
    broadcastSatelliteStatus();
  }

  res.json({
    status: device.status,
    device_id: device.device_id,
    id: device.id,
  });
});

/** Satellite polls for approval */
router.get('/pair/status', (req, res) => {
  const deviceId = req.query.device_id;
  if (!deviceId) return res.status(400).json({ error: 'device_id query required' });

  const device = db.getSatelliteDeviceByDeviceId(deviceId);
  if (!device) return res.json({ status: 'unknown' });

  if (device.status === 'approved') {
    return res.json({
      status: 'approved',
      device_id: device.device_id,
      token: device.token,
    });
  }

  return res.json({ status: device.status, device_id: device.device_id });
});

/** Admin: Thaluxis Hub settings */
router.get('/settings', requireHubAdminAuth, (req, res) => {
  res.json({
    hub_name: brand.getHubDisplayName(db),
    mdns_hostname: (db.getConfig('mdns_hostname') || 'thaluxis').replace(/\.local$/i, ''),
    satellite_enabled: isSatelliteEnabled(),
    hub_os2l_local: db.getConfig('hub_os2l_local') !== '0',
    legacy_token: getSatelliteToken(),
    bonjour_name: brand.getHubBonjourName(db),
  });
});

router.put('/settings', requireHubAdminAuth, (req, res) => {
  const { hub_name, mdns_hostname, satellite_enabled, hub_os2l_local, regenerate_token } = req.body || {};
  if (hub_name != null) {
    db.setConfig('hub_name', String(hub_name).trim() || brand.HUB_DEFAULT_NAME);
  }
  if (mdns_hostname != null) {
    const host = String(mdns_hostname).trim().replace(/\.local$/i, '') || 'thaluxis';
    db.setConfig('mdns_hostname', host);
  }
  if (satellite_enabled != null) db.setConfig('satellite_enabled', satellite_enabled ? '1' : '0');
  if (hub_os2l_local != null) db.setConfig('hub_os2l_local', hub_os2l_local ? '1' : '0');
  if (regenerate_token) db.setConfig('satellite_token', crypto.randomBytes(24).toString('hex'));
  res.json({
    hub_name: brand.getHubDisplayName(db),
    mdns_hostname: (db.getConfig('mdns_hostname') || 'thaluxis').replace(/\.local$/i, ''),
    satellite_enabled: isSatelliteEnabled(),
    hub_os2l_local: db.getConfig('hub_os2l_local') !== '0',
    legacy_token: getSatelliteToken(),
    bonjour_name: brand.getHubBonjourName(db),
    restart_required: hub_name != null ? 'Restart the app to apply Bonjour service name changes.' : null,
  });
});

router.get('/discover', requireHubAdminAuth, (req, res) => {
  const discovered = discovery.getDiscoveredSatellites();
  const registered = db.getSatelliteDevices();
  const pending = registered.filter(d => d.status === 'pending');
  const approved = registered.filter(d => d.status === 'approved');

  res.json({ discovered, pending, approved, all: registered });
});

router.get('/devices', requireHubAdminAuth, (req, res) => {
  res.json(db.getSatelliteDevices(req.query.status));
});

router.post('/devices/:id/approve', requireHubAdminAuth, (req, res) => {
  const id = +req.params.id;
  const approved = db.approveSatelliteDevice(id);
  if (!approved) return res.status(404).json({ error: 'Device not found' });

  console.log(`[Hub] Approved satellite "${approved.name}" (${approved.device_id})`);
  broadcast?.({ type: 'satellite_device_approved', device: publicDevice(approved) });
  broadcastSatelliteStatus();

  res.json({ device: publicDevice(approved), token: approved.token });
});

router.post('/devices/:id/reject', requireHubAdminAuth, (req, res) => {
  const id = +req.params.id;
  const device = db.rejectSatelliteDevice(id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  broadcast?.({ type: 'satellite_device_rejected', device });
  broadcastSatelliteStatus();
  res.json({ device });
});

router.delete('/devices/:id', requireHubAdminAuth, (req, res) => {
  const id = +req.params.id;
  const device = db.revokeSatelliteDevice(id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  broadcast?.({ type: 'satellite_device_revoked', device });
  broadcastSatelliteStatus();
  res.json({ device });
});

router.use(requireSatelliteAuth);

router.post('/tracks/sync', (req, res) => {
  const { track } = req.body || {};
  if (!track?.filepath) return res.status(400).json({ error: 'track.filepath required' });

  const result = db.importTracks([track]);
  const hubTrack = db.getTrackByPath(track.filepath)
    || db.getTrackByPath(track.filepath.replace(/\//g, '\\'));
  if (!hubTrack) return res.status(500).json({ error: 'Track sync failed' });

  const analysis = db.getTrackAnalysis(hubTrack.id);
  const seq = db.getSequenceByTrackId(hubTrack.id);
  const currentVersion = audioAnalyzer?.ANALYSIS_VERSION || 0;
  const hasAnalysis = analysis && (analysis.analysis_version || 0) >= currentVersion;
  const cueCount = seq ? (db.getSequenceCues(seq.id)?.length || 0) : 0;

  res.json({
    track_id: hubTrack.id,
    import: result.inserted > 0 ? 'inserted' : 'updated',
    has_analysis: !!hasAnalysis,
    analysis_version: analysis?.analysis_version || 0,
    needs_analysis: !hasAnalysis,
    has_sequence: !!seq,
    sequence_id: seq?.id || null,
    sequence_name: seq?.name || null,
    sequence_cue_count: cueCount,
  });
});

router.post('/tracks/:id/analysis', async (req, res) => {
  const trackId = +req.params.id;
  const track = db.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const { analysis } = req.body || {};
  if (!analysis) return res.status(400).json({ error: 'analysis object required' });

  const saved = db.upsertTrackAnalysis(trackId, analysis);
  broadcast?.({
    type: 'analysis_complete',
    track_id: trackId,
    peak_count: analysis.peak_count || 0,
    section_count: (analysis.sections || []).length,
    analyzed_at: saved?.analyzed_at || null,
    source: 'satellite',
  });

  const seqResult = await maybeAutoGenerateSequence(trackId, { source: 'satellite' });
  const seq = seqResult?.sequence || db.getSequenceByTrackId(trackId);

  res.json({
    track_id: trackId,
    analyzed_at: saved?.analyzed_at || null,
    has_sequence: !!seq,
    sequence_id: seq?.id || null,
    sequence_generated: !!(seqResult?.sequence && !seqResult?.skipped),
    sequence_skipped: seqResult?.skipped || null,
    cue_count: seqResult?.cue_count || (seq ? db.getSequenceCues(seq.id)?.length : null),
  });
});

router.post('/tracks/:id/stems', (req, res) => {
  const trackId = +req.params.id;
  const track = db.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });
  const { stem_energy } = req.body || {};
  if (!stem_energy) return res.status(400).json({ error: 'stem_energy required' });
  const saved = db.updateStemEnergy(trackId, stem_energy);
  if (!saved) return res.status(400).json({ error: 'Track must be analyzed first' });
  res.json({ track_id: trackId, ok: true });
});

router.post('/os2l', (req, res) => {
  const data = req.body || {};
  const evt = data.evt || 'subscribed';

  if (evt === 'subscribed' && handleOs2lSubscribed) handleOs2lSubscribed(data);
  else if (evt === 'btn' && handleOs2lButton) handleOs2lButton(data);
  else if (evt === 'beat') broadcast?.({ type: 'beat', data, source: 'satellite' });

  res.json({ ok: true });
});

router.post('/tracks/:id/analyze', async (req, res) => {
  const trackId = +req.params.id;
  const track = db.getTrack(trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  const fs = require('fs');
  if (!track.filepath || !fs.existsSync(track.filepath)) {
    return res.status(400).json({ error: 'Audio file not found on hub' });
  }

  const ffmpegOk = await audioAnalyzer.checkFfmpeg();
  if (!ffmpegOk) return res.status(500).json({ error: 'ffmpeg not available on hub' });

  try {
    const result = await audioAnalyzer.analyzeTrack(track.filepath, {
      bpm: track.bpm || 0,
      beatgridPos: track.beatgrid_pos || 0,
      anchorPoints: getAnchorPoints(track),
      config: getAnalysisConfig(),
    });
    const saved = db.upsertTrackAnalysis(trackId, result);
    const seqResult = await maybeAutoGenerateSequence(trackId, { source: 'hub' });
    const seq = seqResult?.sequence || db.getSequenceByTrackId(trackId);
    res.json({
      track_id: trackId,
      peak_count: result.peak_count,
      analyzed_at: saved?.analyzed_at,
      has_sequence: !!seq,
      sequence_id: seq?.id || null,
      sequence_generated: !!(seqResult?.sequence && !seqResult?.skipped),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = {
  router,
  init,
  ensureSatelliteToken,
  isSatelliteEnabled,
  getSatelliteStatusSummary,
  broadcastSatelliteStatus,
};
