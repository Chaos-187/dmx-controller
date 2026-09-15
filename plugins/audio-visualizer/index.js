/**
 * Experimental: live audio visualizer page (opens in a new tab).
 */

const path = require('path');
const { VISUAL_MODES, normalizeVisualMode } = require('./visual-modes');

function cfgBool(ctx, key, def) {
  const v = ctx.getConfig(key, def ? '1' : '0');
  return v === '1' || v === 'true';
}

function cfgNum(ctx, key, def) {
  const n = parseFloat(ctx.getConfig(key, String(def)));
  return Number.isFinite(n) ? n : def;
}

function configPayload(ctx) {
  return {
    enabled: cfgBool(ctx, 'enabled', false),
    visual_mode: normalizeVisualMode(ctx.getConfig('visual_mode', 'studio')),
    sensitivity: Math.max(0.5, Math.min(2, cfgNum(ctx, 'sensitivity', 1))),
    show_bpm_alts: cfgBool(ctx, 'show_bpm_alts', true),
  };
}

module.exports = {
  meta: {
    id: 'audio-visualizer',
    name: 'Audio Visualizer',
    version: '0.4.0',
    experimental: true,
    description: 'Configurable music-reactive visuals (EQ, waveform, radial, scope) in a new tab.',
    viewerPath: '/api/plugins/audio-visualizer/',
  },

  register(ctx) {
    const htmlPath = path.join(__dirname, 'visualizer.html');

    ctx.api.get('/', (_req, res) => {
      res.type('html').sendFile(htmlPath);
    });

    ctx.api.get('/view', (_req, res) => {
      res.type('html').sendFile(htmlPath);
    });

    ctx.api.get('/visual-modes', (_req, res) => {
      res.json({ modes: VISUAL_MODES });
    });

    ctx.api.get('/config', (_req, res) => {
      res.json(configPayload(ctx));
    });

    ctx.api.post('/config', (req, res) => {
      const body = req.body || {};
      if (body.enabled !== undefined) ctx.setConfig('enabled', body.enabled ? '1' : '0');
      if (body.visual_mode !== undefined) {
        ctx.setConfig('visual_mode', normalizeVisualMode(body.visual_mode));
      }
      if (body.sensitivity !== undefined) {
        ctx.setConfig('sensitivity', String(Math.max(0.5, Math.min(2, +body.sensitivity || 1))));
      }
      if (body.show_bpm_alts !== undefined) {
        ctx.setConfig('show_bpm_alts', body.show_bpm_alts ? '1' : '0');
      }
      if (ctx.broadcast) {
        ctx.broadcast({ type: 'plugin_config', plugin: 'audio-visualizer' });
      }
      res.json({ ok: true });
    });
  },

  getStatus() {
    return {
      viewer_path: '/api/plugins/audio-visualizer/',
    };
  },
};
