/**
 * Experimental / optional plugins loaded from the top-level `plugins/` folder.
 * Each plugin is a subfolder with index.js exporting { meta, register, shutdown?, getStatus? }.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const registry = [];

function getPluginsDir() {
  const candidates = [];
  if (process.pkg) candidates.push(path.join(path.dirname(process.execPath), 'plugins'));
  candidates.push(path.join(process.cwd(), 'plugins'));
  candidates.push(path.join(__dirname, '..', 'plugins'));
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[candidates.length - 1];
}

/**
 * @param {import('express').Express} app
 * @param {object} deps — db, broadcast, artnetServer, dmxUsbServer, audioInput, getDmxOutputEnabled, …
 */
function initPlugins(app, deps) {
  const dir = getPluginsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`[Plugins] Created directory: ${dir}`);
  }

  app.get('/api/plugins', (_req, res) => {
    res.json(
      registry.map((p) => ({
        ...p.meta,
        enabled: p.ctx.getConfig('enabled', '0') === '1',
        status: typeof p.getStatus === 'function' ? p.getStatus() : null,
      })),
    );
  });

  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || name.toLowerCase() === 'readme.md') continue;
    const folder = path.join(dir, name);
    if (!fs.statSync(folder).isDirectory()) continue;
    const entry = path.join(folder, 'index.js');
    if (!fs.existsSync(entry)) continue;

    try {
      const mod = require(entry);
      const id = (mod.meta && mod.meta.id) || name;
      const router = express.Router();
      const configPrefix = `plugin_${String(id).replace(/-/g, '_')}_`;

      const ctx = {
        ...deps,
        pluginId: id,
        configKey: (key) => configPrefix + key,
        getConfig(key, defaultValue) {
          const raw = deps.db.getConfig(configPrefix + key);
          if (raw == null || raw === '') return defaultValue;
          return raw;
        },
        setConfig(key, value) {
          deps.db.setConfig(configPrefix + key, value == null ? '' : String(value));
        },
        api: router,
      };

      if (typeof mod.register === 'function') mod.register(ctx);

      app.use(`/api/plugins/${id}`, router);

      const pluginEntry = {
        meta: mod.meta || { id, name, experimental: true },
        mod,
        ctx,
        getStatus:
          typeof mod.getStatus === 'function'
            ? () => mod.getStatus(ctx)
            : typeof ctx.getStatus === 'function'
              ? () => ctx.getStatus()
              : null,
      };
      registry.push(pluginEntry);
      console.log(`[Plugins] Loaded "${pluginEntry.meta.name || id}" from ${folder}`);
    } catch (err) {
      console.error(`[Plugins] Failed to load ${name}:`, err.message || err);
    }
  }

  if (registry.length === 0) {
    console.log('[Plugins] No plugins installed (add folders under plugins/)');
  }
}

function shutdownPlugins() {
  for (const p of registry) {
    try {
      if (typeof p.mod.shutdown === 'function') p.mod.shutdown(p.ctx);
    } catch (err) {
      console.error(`[Plugins] Shutdown error (${p.meta.id}):`, err.message || err);
    }
  }
}

module.exports = {
  initPlugins,
  shutdownPlugins,
  getPluginsRegistry: () => registry,
  getPluginsDir,
};
