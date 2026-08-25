# Thaluxis Satellite / Multi-Laptop Setup

Run **Thaluxis DMX** (hub) and **Thaluxis Satellite** (VDJ laptop) on separate machines. Hub config lives in the main app under **Config → Thaluxis Satellites**.

## Architecture

```
┌─────────────────────────┐         LAN          ┌──────────────────────────┐
│  VDJ laptop             │  HTTP + OS2L fwd     │  Lighting laptop (hub)   │
│  satellite/server.js    │ ───────────────────► │  server.js               │
│  • OS2L ← VirtualDJ     │  track sync          │  • Fixtures + DMX        │
│  • ffmpeg analysis      │  analysis upload     │  • Sequences + playback  │
│  • Local VDJ library    │                      │  • Media library DB      │
└─────────────────────────┘                      └──────────────────────────┘
```

## Pairing flow (recommended)

1. Start the **hub** on the lighting laptop.
2. Start the **satellite** on the VDJ laptop — it auto-discovers the hub via mDNS (`_dmx-hub._tcp`).
3. On the hub, open **Config → Thaluxis Satellites**. Pending devices appear automatically.
4. Click **Accept** to authorize the satellite. Each device gets its own token.
5. The satellite receives approval within a few seconds and begins syncing.

No manual token copy is required for normal setup.

## Hub setup (lighting laptop)

1. Run the main app: `npm start`
2. Open **Config → Thaluxis Satellites** — edit hub name, mDNS hostname, satellite enable, and OS2L mode

### Hub config keys

| Key | Default | Description |
|-----|---------|-------------|
| `hub_name` | `Thaluxis Hub` | Display name for this hub (Bonjour name updates after restart) |
| `mdns_hostname` | `thaluxis` | LAN hostname (`thaluxis.local`) |
| `satellite_enabled` | `1` | Allow Thaluxis Satellite pairing and sync |
| `hub_os2l_local` | `1` | Run OS2L TCP server on hub |
| `satellite_token` | auto | Legacy shared token (optional fallback) |

### Hub API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/status` | none | Hub discovery |
| POST | `/pair/request` | none | Satellite requests connection |
| GET | `/pair/status?device_id=` | none | Satellite polls for approval + token |
| GET | `/discover` | config auth | mDNS + registered devices |
| GET | `/devices` | config auth | All registered devices |
| POST | `/devices/:id/approve` | config auth | Accept connection |
| POST | `/devices/:id/reject` | config auth | Reject connection |
| DELETE | `/devices/:id` | config auth | Revoke approved device |
| POST | `/tracks/sync` | device token | Upsert track metadata |
| POST | `/tracks/:id/analysis` | device token | Upload analysis |
| POST | `/os2l` | device token | Forward deck events |

Approved satellites send:

- `X-Satellite-Device-Id: <uuid>`
- `X-Satellite-Token: <per-device token>`

## Satellite setup (VDJ laptop)

See **[satellite/README.md](../satellite/README.md)**.

```bash
cd satellite
npm start
```

Status UI: **http://localhost:8788** — shows pairing status, saved hubs, and lets you switch active venue.

### Multiple venues

The satellite can store **multiple hub pairings** (one per venue). Only the **active** hub receives OS2L events and track sync.

1. Open the status UI → **Saved hubs**
2. **Scan LAN** or **Add hub** with the venue name and hub URL
3. Accept the device on each hub (Config → Thaluxis Satellites)
4. At a new venue, click **Use this hub** to switch the active connection

Pairings and tokens are stored in `data/hubs.json` (created automatically; legacy `config.json` hub fields are migrated on first run).

Point VirtualDJ OS2L at this laptop, port **8787**.

### Satellite API (status UI)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hubs` | List saved hubs with online/pairing status |
| POST | `/api/hubs` | Add hub `{ hub_url, name? }` |
| PUT | `/api/hubs/:id` | Update venue name or URL |
| DELETE | `/api/hubs/:id` | Remove saved pairing |
| POST | `/api/hubs/:id/activate` | Set active hub for sync/OS2L |
| POST | `/api/hubs/:id/ping` | Test reachability |
| GET | `/api/hubs/discover` | mDNS scan for hubs on LAN |

## Track matching across machines

The hub matches tracks by:

1. Exact filepath
2. Path after drive letter (`E:\Music\…` ↔ `\\NAS\Music\…`)
3. Artist + title + remix identity

Keep VirtualDJ library imported on **both** hub and satellite so metadata stays aligned. The satellite pushes analysis to the hub track ID resolved after sync.

## Audio files

Analysis runs on the **satellite** where VirtualDJ reads files. The hub only stores analysis results — it does not need the audio unless you analyze on the hub directly.

Use a network share with consistent paths, or accept identity-based matching when drive letters differ.

## mDNS

- Hub advertises `_dmx-hub._tcp` when satellite mode is enabled (for discovery)
- Satellite advertises `_os2l._tcp` for VirtualDJ
- Disable hub `_os2l._tcp` when `hub_os2l_local=0`

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run satellite` | Start satellite from repo root |
| `npm run satellite:dev` | Satellite with file watch |

## Windows service (satellite)

From the `satellite` folder (Administrator): `npm install` then `npm run service:install`. See [satellite/README.md](satellite/README.md).
