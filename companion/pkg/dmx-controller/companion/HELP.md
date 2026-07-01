# DMX Controller — Companion Module

Control your DMX Controller from **Bitfocus Companion** (Elgato Stream Deck, X-keys, web buttons, etc.) over the network.

## Requirements

- [Bitfocus Companion](https://companion.free/) v3.0+ (v4.1+ recommended)
- DMX Controller server running and reachable on your LAN
- Node.js 22+ (to build the module from source)

## Installation

### From this repository

1. Build the module:

   ```bash
   cd companion
   npm install
   npm run build
   ```

2. Open **Companion → Settings → Developer modules path** and add the `companion` folder from this repo (the folder that contains `companion/manifest.json` and `package.json`).

3. Restart Companion or reload modules.

4. **Import / Export** → import `config/dmx-controller-streamdeck15.companionconfig` (or `-xl` for Stream Deck XL).

5. Remap the **DMX Controller** connection to your server IP and port.

6. Or add a connection manually: **Eyup Events → DMX Controller** with **Host** and **HTTP Port** (`80` default).

Regenerate layouts from your database: `npm run companion:config` from the repo root.

## Connection

The module connects to the DMX Controller using:

- **HTTP REST API** — actions (blackout, scenes, effects, DMX output, etc.)
- **WebSocket** — live state for variables and button feedback (VDJ decks, blackout, output, sequences)

Ensure the DMX Controller firewall allows inbound TCP on the web port from the machine running Companion.

## Actions

| Action | Description |
|--------|-------------|
| DMX Output | Toggle, enable, or disable global DMX output |
| Blackout Hold | Momentary or toggle blackout (matches Touch interface behaviour) |
| Activate Scene | Activate a configured static scene |
| Deactivate Scene | Turn off the active scene |
| Run Effect | Start a quick-action effect on all fixtures or a fixture group |
| Stop Effects | Stop all effects or a specific slot (color, motion, sound, etc.) |
| Master Dimmer | Set master dimmer 0–255 |
| Effect Speed | Set effect speed multiplier 0.1–3.0× |
| Sequence: Load / Play / Pause / Unload | Control sequencer decks 1–4 via WebSocket |
| Refresh Scenes / Effects / Sequences | Reload dropdown choices after config changes |

### Blackout on Stream Deck (hold)

Use a button with **press** and **release** steps, or add the **Blackout (Hold)** preset:

- **Press:** Blackout Hold → On
- **Release:** Blackout Hold → Off

## Feedbacks

| Feedback | Description |
|----------|-------------|
| DMX Output is ON | Highlight when output enabled |
| Blackout Hold is Active | Highlight during blackout |
| Scene is Active | Match a specific scene ID |
| VirtualDJ Connected | VDJ OS2L connection status |
| Effect Slot Running | Color / motion / sound slot active |
| Sequence Playing on Deck | Sequencer playing on deck 1–4 |

## Variables

`$(dmx-controller:dmx_output)`, `$(dmx-controller:blackout)`, `$(dmx-controller:active_scene_name)`, `$(dmx-controller:vdj_connected)`, `$(dmx-controller:deck1_track)`, `$(dmx-controller:deck1_bpm)`, and others — see the Variables tab in Companion.

## Presets

The module includes a **Show Control → Essentials** preset group with styled button shells (Blackout, DMX Output, Stop FX, Scene Off). After dragging a preset onto your Stream Deck, assign the matching **DMX Controller** actions and feedbacks to each button (see table above).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection failure | Verify DMX Controller is running (`http://host/` loads in a browser) |
| Empty scene/effect lists | Run **Refresh Scenes / Effects / Sequences** after adding items in Config |
| Sequence actions fail | WebSocket must connect — check firewall; reload the Companion connection |
| Wrong port | Match the `web_port` value in DMX Controller Config (default 80) |

## Further reading

See [docs/companion.md](../docs/companion.md) in the main repository for architecture, network layout, and API details.
