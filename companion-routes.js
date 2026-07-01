/**
 * Companion integration routes — trigger actions and export Stream Deck configs.
 */

const path = require('path');
const fs = require('fs');
const { buildCompanionConfig } = require('./companion/lib/config-builder.cjs');
const defaultEffects = require('./companion/lib/default-effects-snapshot.cjs');

let midiController;
let db;
let touchOverrides;
let broadcast;

function init(deps) {
  midiController = deps.midiController;
  db = deps.db;
  touchOverrides = deps.touchOverrides;
  broadcast = deps.broadcast || null;
}

function resolveCompanionColorMode(mode) {
  const m = String(mode || 'on').toLowerCase();
  if (touchOverrides.companionColorPushMode) {
    if (m === 'off') return 'off';
    return 'on';
  }
  // Toggle latch: only act on press; ignore release entirely
  if (m === 'off') return null;
  return 'toggle';
}

function registerRoutes(app) {
  app.post('/api/companion/color-mode', (req, res) => {
    const wasPush = touchOverrides.companionColorPushMode;
    if (req.body && req.body.toggle) {
      touchOverrides.companionColorPushMode = !touchOverrides.companionColorPushMode;
    } else if (typeof req.body?.push === 'boolean') {
      touchOverrides.companionColorPushMode = req.body.push;
    } else if (typeof req.body?.hold === 'boolean') {
      touchOverrides.companionColorPushMode = req.body.hold;
    }
    console.log(`[Companion] Color input mode → ${touchOverrides.companionColorPushMode ? 'PUSH' : 'TOGGLE'}`);
    if (wasPush !== touchOverrides.companionColorPushMode) {
      midiController.clearCompanionColorOverride();
    }
    if (broadcast) {
      broadcast({ type: 'companionColorMode', pushMode: touchOverrides.companionColorPushMode });
    }
    res.json({ pushMode: touchOverrides.companionColorPushMode, holdMode: touchOverrides.companionColorPushMode });
  });

  app.get('/api/companion/color-mode', (req, res) => {
    res.json({ pushMode: touchOverrides.companionColorPushMode, holdMode: touchOverrides.companionColorPushMode });
  });

  app.post('/api/companion/color-release', (req, res) => {
    try {
      if (!touchOverrides.companionColorPushMode) {
        return res.json({ ok: true, skipped: true, reason: 'toggle mode' });
      }
      midiController.clearCompanionColorOverride();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/companion/trigger', (req, res) => {
    let { action_type, action_data, mode, key, active } = req.body || {};
    if (!action_type) return res.status(400).json({ error: 'action_type required' });

    try {
      if (action_type === 'color') {
        const rawMode = mode;
        mode = resolveCompanionColorMode(mode);
        if (!mode) return res.json({ ok: true, skipped: true });
        if (mode === 'off' && !key && (!action_data || !Object.keys(action_data).length)) {
          if (!touchOverrides.companionColorPushMode) {
            return res.json({ ok: true, skipped: true, reason: 'toggle mode' });
          }
          midiController.clearCompanionColorOverride();
          return res.json({ ok: true, cleared: true });
        }
        console.log(
          `[Companion] color raw=${rawMode} resolved=${mode} push=${touchOverrides.companionColorPushMode}`,
          action_data || {},
        );
      } else {
        console.log(`[Companion] ${action_type} mode=${mode || 'momentary'}`, action_data || {});
      }
      midiController.triggerAction(action_type, action_data || {}, { mode, key, active });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/companion/config', (req, res) => {
    const layout = req.query.layout === 'streamdeck-xl' ? 'streamdeck-xl' : 'streamdeck15';
    const host = req.query.host || '127.0.0.1';
    const port = parseInt(req.query.port || db.getConfig('web_port') || '80', 10);
    const effects = db.getEffects();
    const midiMappings = db.getMidiMappings();
    const fixtures = db.getFixtures();
    const scenes = db.getScenes();
    const effectList = effects.length > 0 ? effects : defaultEffects;
    const config = buildCompanionConfig({
      layout, host, port, effects: effectList, midiMappings, fixtures, scenes,
    });
    const filename = `dmx-controller-${layout}.companionconfig`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(config, null, 2));
  });

  app.get('/api/companion/layouts', (req, res) => {
    res.json({
      layouts: [
        {
          id: 'streamdeck15',
          label: 'Stream Deck (5×3)',
          description: 'Original / MK.2 — 15 keys per page',
          download: '/api/companion/config?layout=streamdeck15',
        },
        {
          id: 'streamdeck-xl',
          label: 'Stream Deck XL (8×4)',
          description: '32 keys per page — more colors and effects',
          download: '/api/companion/config?layout=streamdeck-xl',
        },
      ],
      pages: ['Home', 'Fixtures', 'Scenes', 'Colors', 'Color FX', 'Cell FX', 'Mover FX', 'Rig FX'],
    });
  });
}

/** Write pre-built configs to companion/config/ (CLI helper). */
function writeConfigFiles({ host = '127.0.0.1', port = 80, outDir } = {}) {
  const effects = db.getEffects();
  const midiMappings = db.getMidiMappings();
  const fixtures = db.getFixtures();
  const scenes = db.getScenes();
  const effectList = effects.length > 0 ? effects : defaultEffects;
  const target = outDir || path.join(__dirname, 'companion', 'config');
  fs.mkdirSync(target, { recursive: true });

  for (const layout of ['streamdeck15', 'streamdeck-xl']) {
    const config = buildCompanionConfig({
      layout, host, port, effects: effectList, midiMappings, fixtures, scenes,
    });
    const file = path.join(target, `dmx-controller-${layout}.companionconfig`);
    fs.writeFileSync(file, JSON.stringify(config, null, 2));
    console.log(`Wrote ${file}`);
  }
}

module.exports = { init, registerRoutes, writeConfigFiles };
