# Thaluxis Satellite

Lightweight node for the **VirtualDJ laptop**. Connects to VirtualDJ via OS2L, analyzes tracks locally, and syncs to the **Thaluxis Hub** (main Thaluxis DMX app on the lighting laptop).

## Quick start

1. **Thaluxis Hub** — run `npm start` on the lighting laptop → **Config → Thaluxis Satellites**
2. **Thaluxis Satellite** — on the VDJ laptop: `npm start` (from this folder) or `npm run satellite` from repo root
3. On the hub, click **Accept** for the pending device
4. Point VirtualDJ OS2L at the VDJ laptop (port **8787**)

Status UI: **http://localhost:8788**

## Windows service (VDJ laptop)

Run Thaluxis Satellite in the background and start automatically with Windows.

1. Install dependencies (once):
   ```bash
   cd satellite
   npm install
   ```
2. **Run as Administrator** — either:
   - Double-click `satellite/scripts/install-service.cmd`, or
   - `npm run service:install` from the `satellite` folder

The service appears in Windows Services as **Thaluxis Satellite**. It uses the same `config.json` and `data/` folder as normal runs.

**Remove the service** (Administrator):
```bash
npm run service:uninstall
```
Or run `scripts/uninstall-service.cmd`.

**Requirements:** Node.js on PATH for the service account (default Local System). If ffmpeg is used for analysis, ensure it is on the system PATH as well.

See [../docs/satellite.md](../docs/satellite.md) for full architecture docs.
