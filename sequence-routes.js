/**
 * Sequence API Routes
 * 
 * Extracted from server.js — handles all /api/sequences, /api/cues,
 * and /api/db bulk-delete endpoints for the sequencer.
 */

const express = require('express');
const router = express.Router();

let _db, _audioAnalyzer, _sequenceGenerator, _broadcast, _getAnalysisConfig, _getAnchorPoints;

/**
 * Initialise the router with shared dependencies from server.js.
 * Call once at startup before mounting.
 */
function init({ db, audioAnalyzer, sequenceGenerator, broadcast, getAnalysisConfig, getAnchorPoints }) {
  _db = db;
  _audioAnalyzer = audioAnalyzer;
  _sequenceGenerator = sequenceGenerator;
  _broadcast = broadcast;
  _getAnalysisConfig = getAnalysisConfig;
  _getAnchorPoints = getAnchorPoints || (() => []);
}

/** Re-analyze when missing or older than the current analysis engine version. */
async function ensureTrackAnalysis(track, analysisCfg) {
  let analysis = _db.getTrackAnalysis(track.id);
  const needsAnalysis = !analysis
    || (analysis.analysis_version || 0) < _audioAnalyzer.ANALYSIS_VERSION;
  if (!needsAnalysis) return analysis;

  const filePath = track.filepath;
  if (!filePath || !require('fs').existsSync(filePath)) return analysis;

  try {
    const ffmpegOk = await _audioAnalyzer.checkFfmpeg();
    if (!ffmpegOk) {
      console.warn(`[Generate] ffmpeg not available — skipping analysis for track ${track.id}`);
      return analysis;
    }
    console.log(`[Generate] Analyzing track ${track.id} (analysis v${analysis?.analysis_version || 0} → v${_audioAnalyzer.ANALYSIS_VERSION})...`);
    const result = await _audioAnalyzer.analyzeTrack(filePath, {
      bpm: track.bpm || 0,
      beatgridPos: track.beatgrid_pos || 0,
      anchorPoints: _getAnchorPoints(track),
      config: analysisCfg,
    });
    _db.upsertTrackAnalysis(track.id, result);
    analysis = _db.getTrackAnalysis(track.id);
    _broadcast({
      type: 'analysis_complete',
      track_id: track.id,
      peak_count: result.peak_count,
    });
    console.log(`[Generate] Analysis complete for track ${track.id}: ${result.peak_count} peaks`);
  } catch (e) {
    console.warn(`[Generate] Analysis failed for track ${track.id}: ${e.message}`);
  }
  return analysis;
}

// ─── Database Stats & Bulk Delete ───────────────────────────────────────────

router.get('/api/db/stats', (req, res) => {
  res.json(_db.getDbStats());
});

router.delete('/api/db/analysis', (req, res) => {
  const result = _db.deleteAllAnalysis();
  console.log(`[DB] Deleted all analysis data (${result.deleted} rows)`);
  res.json(result);
});

router.delete('/api/db/sequences', (req, res) => {
  const result = _db.deleteAllSequences();
  console.log(`[DB] Deleted all sequences (${result.deleted} sequences)`);
  res.json(result);
});

// ─── Database Backup / Restore ──────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');

router.get('/api/db/backup', (req, res) => {
  try {
    const backupPath = _db.backupDatabase();
    res.download(backupPath, 'dmx-controller-backup.db', (err) => {
      // Clean up temp file after download (or on error)
      try { fs.unlinkSync(backupPath); } catch (_) {}
      if (err && !res.headersSent) res.status(500).json({ error: 'Backup download failed' });
    });
  } catch (e) {
    console.error('[DB] Backup failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/db/restore', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) return res.status(400).json({ error: 'No file uploaded' });
    const tmpPath = path.join(os.tmpdir(), `dmx-restore-${Date.now()}.db`);
    fs.writeFileSync(tmpPath, req.body);
    _db.restoreDatabase(tmpPath);
    console.log('[DB] Database restored from upload');
    res.json({ ok: true });
  } catch (e) {
    console.error('[DB] Restore failed:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Sequence CRUD ──────────────────────────────────────────────────────────

router.get('/api/sequences', (req, res) => {
  res.json(_db.getSequences());
});

// Literal path routes MUST come before parameterized :id routes
router.get('/api/sequences/by-track/:trackId', (req, res) => {
  const s = _db.getSequenceByTrackId(+req.params.trackId);
  s ? res.json(s) : res.status(404).json({ error: 'No sequence for this track' });
});

// Expose palette/genre options for the UI (must be before :id route)
router.get('/api/sequences/generate-options', (req, res) => {
  const palettes = _sequenceGenerator.PALETTE_KEYS.map(k => ({
    key: k, label: _sequenceGenerator.colorPalettes[k].label,
  }));
  palettes.push({ key: 'random', label: 'Random' });
  const genres = Object.entries(_sequenceGenerator.genrePresets).map(([k, v]) => ({
    key: k, label: v.label,
  }));
  res.json({ palettes, genres });
});

router.get('/api/sequences/:id', (req, res) => {
  const s = _db.getSequence(+req.params.id);
  s ? res.json(s) : res.status(404).json({ error: 'Not found' });
});

router.post('/api/sequences', (req, res) => {
  const result = _db.createSequence(req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

router.put('/api/sequences/:id', (req, res) => {
  const result = _db.updateSequence(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

router.delete('/api/sequences/:id', (req, res) => {
  _db.deleteSequence(+req.params.id);
  res.json({ deleted: true });
});

// ─── Sequence Cues API ──────────────────────────────────────────────────────

router.get('/api/sequences/:id/cues', (req, res) => {
  const cues = _db.getSequenceCuesLightweight(+req.params.id);
  res.json(cues);
});

router.get('/api/cues/:id', (req, res) => {
  const cue = _db.getCue(+req.params.id);
  if (!cue) return res.status(404).json({ error: 'Not found' });
  res.json(cue);
});

router.post('/api/sequences/:id/cues', (req, res) => {
  const result = _db.createCue(+req.params.id, req.body);
  if (result.error) return res.status(400).json(result);
  res.status(201).json(result);
});

router.put('/api/cues/:id', (req, res) => {
  const result = _db.updateCue(+req.params.id, req.body);
  if (!result) return res.status(404).json({ error: 'Not found' });
  res.json(result);
});

router.delete('/api/cues/:id', (req, res) => {
  _db.deleteCue(+req.params.id);
  res.json({ deleted: true });
});

router.put('/api/sequences/:id/cues/bulk', (req, res) => {
  const cues = req.body.cues || [];
  const result = _db.bulkUpdateCues(+req.params.id, cues);
  res.json(result);
});

// ─── Auto-Generate Sequence ─────────────────────────────────────────────────

router.post('/api/sequences/generate/:trackId', async (req, res) => {
  const track = _db.getTrack(+req.params.trackId);
  if (!track) return res.status(404).json({ error: 'Track not found' });

  // Check if sequence already exists for this track
  const existing = _db.getSequenceByTrackId(track.id);
  if (existing && !req.body.overwrite) {
    return res.status(409).json({ error: 'Sequence already exists', sequence_id: existing.id });
  }
  if (existing) {
    _db.deleteSequence(existing.id);
  }

  const fixtures = _db.getFixtureChannelMap();
  const analysisCfg = _getAnalysisConfig();
  const analysis = await ensureTrackAnalysis(track, analysisCfg);

  const { palette: palKey, genre: genKey, template_id } = req.body || {};

  // If template specified, merge its settings
  let effectivePalette = palKey || undefined;
  let effectiveGenre = genKey || undefined;
  let effectiveNoStrobes = _db.getConfig('seq_no_strobes') === '1';
  let effectiveGenConfig = _db.getGeneratorConfig();

  if (template_id) {
    const tpl = _db.getSequenceTemplate(template_id);
    if (tpl) {
      if (!palKey && tpl.palette && tpl.palette !== 'random') effectivePalette = tpl.palette;
      if (!genKey && tpl.genre && tpl.genre !== 'auto') effectiveGenre = tpl.genre;
      if (tpl.no_strobes) effectiveNoStrobes = true;
      if (tpl.generator_config && typeof tpl.generator_config === 'object') {
        effectiveGenConfig = { ...effectiveGenConfig, ...tpl.generator_config };
      }
    }
  }

  const { cues, bpm, durationMs, palette, genrePreset } = _sequenceGenerator.generateSequence({
    track,
    fixtures,
    analysis,
    palette: effectivePalette,
    genre: effectiveGenre,
    effects: _db.getEffects(),
    moverPresets: _db.getMoverPresets(),
    noStrobes: effectiveNoStrobes,
    generatorConfig: effectiveGenConfig,
  });

  // Create sequence
  const seq = _db.createSequence({
    name: track.title || track.filename || 'Untitled',
    track_id: track.id,
    bpm: bpm,
    duration_ms: durationMs,
  });

  // Bulk insert generated cues
  if (cues.length > 0) {
    _db.bulkUpdateCues(seq.id, cues);
  }

  const result = _db.getSequence(seq.id);
  result.palette = palette;
  result.genrePreset = genrePreset;
  res.json(result);
});

// Bulk generate sequences for multiple tracks
router.post('/api/sequences/generate-batch', async (req, res) => {
  const { track_ids, palette, genre, overwrite } = req.body || {};
  if (!Array.isArray(track_ids) || track_ids.length === 0) {
    return res.status(400).json({ error: 'track_ids array required' });
  }

  // Return immediately, process in background
  res.json({ status: 'started', count: track_ids.length });

  const fixtures = _db.getFixtureChannelMap();
  const allEffects = _db.getEffects();
  const analysisCfg = _getAnalysisConfig();
  let completed = 0, failed = 0, skipped = 0;

  // ── Parallel worker pool ──────────────────────────────────────────────
  const CONCURRENCY = 4;

  // Phase 1: Run analysis in parallel batches
  const workItems = [];
  for (const trackId of track_ids) {
    const track = _db.getTrack(trackId);
    if (!track) { failed++; continue; }
    const existing = _db.getSequenceByTrackId(track.id);
    if (existing && !overwrite) { skipped++; continue; }
    workItems.push({ trackId, track, existingSeq: existing });
  }

  async function analyzeOne(item) {
    const analysis = await ensureTrackAnalysis(item.track, analysisCfg);
    return { item, analysis };
  }

  // Process in parallel batches of CONCURRENCY
  for (let i = 0; i < workItems.length; i += CONCURRENCY) {
    const batch = workItems.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(item => analyzeOne(item)));

    // Phase 2: Generate sequences from analysis results (fast, serial)
    for (const { item, analysis } of results) {
      try {
        if (item.existingSeq) _db.deleteSequence(item.existingSeq.id);

        const { cues, bpm, durationMs } = _sequenceGenerator.generateSequence({
          track: item.track, fixtures, analysis,
          palette: palette || undefined,
          genre: genre || undefined,
          effects: allEffects,
          moverPresets: _db.getMoverPresets(),
          noStrobes: _db.getConfig('seq_no_strobes') === '1',
          generatorConfig: _db.getGeneratorConfig(),
        });

        const seq = _db.createSequence({
          name: item.track.title || item.track.filename || 'Untitled',
          track_id: item.track.id, bpm, duration_ms: durationMs,
        });
        if (cues.length > 0) _db.bulkUpdateCues(seq.id, cues);

        completed++;
        _broadcast({ type: 'seq_batch_progress', completed, failed, skipped, total: track_ids.length, track_id: item.trackId });
      } catch (e) {
        failed++;
        console.error(`[BulkGen] Error for track ${item.trackId}: ${e.message}`);
      }
    }
  }

  console.log(`[BulkGen] Complete: ${completed} generated, ${skipped} skipped, ${failed} failed out of ${track_ids.length}`);
  _broadcast({ type: 'seq_batch_complete', completed, failed, skipped, total: track_ids.length });
});

// ─── Sequence Templates ──────────────────────────────────────────────────

router.get('/api/sequence-templates', (req, res) => {
  res.json(_db.getSequenceTemplates());
});

router.get('/api/sequence-templates/:id', (req, res) => {
  const t = _db.getSequenceTemplate(req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  res.json(t);
});

router.post('/api/sequence-templates', (req, res) => {
  const { name, palette, genre, no_strobes, generator_config, is_default } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name required' });
  const t = _db.createSequenceTemplate({ name: name.trim(), palette, genre, no_strobes, generator_config, is_default });
  res.json(t);
});

router.put('/api/sequence-templates/:id', (req, res) => {
  const existing = _db.getSequenceTemplate(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });
  const { name, palette, genre, no_strobes, generator_config, is_default } = req.body;
  const t = _db.updateSequenceTemplate(req.params.id, {
    name: (name || existing.name).trim(),
    palette: palette !== undefined ? palette : existing.palette,
    genre: genre !== undefined ? genre : existing.genre,
    no_strobes: no_strobes !== undefined ? no_strobes : existing.no_strobes,
    generator_config: generator_config !== undefined ? generator_config : existing.generator_config,
    is_default: is_default !== undefined ? is_default : existing.is_default,
  });
  res.json(t);
});

router.delete('/api/sequence-templates/:id', (req, res) => {
  _db.deleteSequenceTemplate(req.params.id);
  res.json({ ok: true });
});

router.post('/api/sequence-templates/:id/set-default', (req, res) => {
  _db.setDefaultSequenceTemplate(req.params.id);
  res.json({ ok: true });
});

module.exports = { router, init };
