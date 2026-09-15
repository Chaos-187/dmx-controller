# Thaluxis DMX — Plugins

Optional features live here so they can be added, updated, or removed without editing core app code.

## Layout

```
plugins/
  my-feature/
    index.js      # required — exports meta + register()
    README.md     # optional notes
```

## Plugin contract

```javascript
module.exports = {
  meta: {
    id: 'my-feature',
    name: 'My Feature',
    version: '0.1.0',
    description: 'Short summary for Config → Experimental.',
    experimental: true,
  },

  /** Use ctx.getConfig('enabled') / ctx.setConfig('enabled', '1'|'0') — Config UI toggle maps to this. */

  /** Wire routes and timers. Context includes db, api (Express Router), getConfig/setConfig, … */
  register(ctx) {
    ctx.api.get('/status', (req, res) => res.json({ ok: true }));
    ctx.api.post('/config', (req, res) => { /* … */ });
  },

  /** Optional cleanup on server shutdown */
  shutdown(ctx) { },

  /** Optional live status for GET /api/plugins */
  getStatus(ctx) { return { running: false }; },
};
```

Routes mount at `/api/plugins/<id>/…`. Config keys are stored as `plugin_<id>_<key>` in the SQLite config table.

## Deployment

- **Development:** `plugins/` at the repo root (next to `server.js`).
- **Packaged exe:** copy the `plugins/` folder beside `dmx-controller.exe` (same as `data/`).

Restart the hub after adding or removing a plugin folder.
