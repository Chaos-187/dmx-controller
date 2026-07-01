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

2. Open **Companion → Settings → Developer modules path** and enable developer modules.

3. Set the path to the **repository root** (parent of `companion/`):

   ```
   C:\source\Node\dmx-controller
   ```

   Do **not** point at `...\companion` itself — Companion only scans subfolders for modules.

4. Restart Companion or reload modules.

5. **Import / Export** → import `config/dmx-controller-streamdeck15.companionconfig` (or `-xl` for Stream Deck XL). Enable **Buttons** on import.

6. Remap the **DMX Controller** connection to your server IP and port.

7. Or add a connection manually: **Eyup Events → DMX Controller** with **Host** and **HTTP Port** (`80` default).

Regenerate layouts from your database: `npm run companion:config` from the repo root.

## Connection

The module connects to the DMX Controller using:

- **HTTP REST API** — actions (blackout, scenes, effects, colors, DMX output, etc.)
- **WebSocket** — live state for variables and button feedback (VDJ decks, blackout, output, color mode, sequences)

Ensure the DMX Controller firewall allows inbound TCP on the web port from the machine running Companion.

## Color buttons — PUSH vs TOGGLE

On the **Colors** page, colour keys support two input modes. Switch with the **PUSH / TOGGLE** nav button (replaces **STOP FX** on that page only).

### PUSH mode (default)

| Press | Release |
|-------|---------|
| Color ON | Color OFF |

Wire each colour key like **BLACKOUT**:

- **Press:** Set Color (Press) — set RGBW for that swatch
- **Release:** Release Color — no options needed

### TOGGLE mode

| Press | Release |
|-------|---------|
| Tap ON / tap OFF | **Release Color** is ignored (keeps latch) |

### Mode switch

Switching **PUSH ↔ TOGGLE** clears all latched colours on the server and turns fixtures off.

The mode button uses feedbacks **Color Input is Push Mode** (green `PUSH`) and **Color Input is Toggle Mode** (orange `TOGGLE`).

Variable: `$(dmx-controller:color_mode)` → `PUSH` or `TOGGLE`

## Actions

| Action | Description |
|--------|-------------|
| DMX Output | Toggle, enable, or disable global DMX output |
| Blackout Hold | Momentary or toggle blackout (press + release) |
| Set Color (Press) | Turn a colour on (press step) |
| Release Color | Turn off active push colour (release step) |
| Toggle Color Input Mode | Switch Colors page between PUSH and TOGGLE |
| Activate Scene | Activate a configured static scene |
| Deactivate Scene | Turn off the active scene |
| Toggle Fixture | Enable/disable a fixture |
| Run Effect | Start a quick-action effect on all fixtures or a group |
| Stop Effects | Stop all effects or a specific slot |
| Strobe / Full On | Momentary rig controls |
| Master Dimmer | Set master dimmer 0–255 |
| Effect Speed | Set effect speed multiplier 0.1–3.0× |
| Sequence: Load / Play / Pause / Unload | Control sequencer decks 1–4 via WebSocket |
| Refresh Scenes / Effects / Sequences | Reload dropdown choices after config changes |

### Blackout on Stream Deck

Use **press** and **release** steps:

- **Press:** Blackout Hold → On
- **Release:** Blackout Hold → Off

## Feedbacks

| Feedback | Description |
|----------|-------------|
| DMX Output is ON | Highlight when output enabled |
| Blackout Hold is Active | Highlight during blackout |
| Scene is Active | Match a specific scene ID |
| Fixture is Enabled | Match a specific fixture ID |
| VirtualDJ Connected | VDJ OS2L connection status |
| Effect Slot Running | Color / motion / sound slot active |
| Color Input is Push Mode | Colors page in PUSH mode |
| Color Input is Toggle Mode | Colors page in TOGGLE mode |
| Sequence Playing on Deck | Sequencer playing on deck 1–4 |

## Variables

`$(dmx-controller:dmx_output)`, `$(dmx-controller:blackout)`, `$(dmx-controller:color_mode)`, `$(dmx-controller:active_scene_name)`, `$(dmx-controller:vdj_connected)`, `$(dmx-controller:deck1_track)`, `$(dmx-controller:deck1_bpm)`, and others — see the Variables tab in Companion.

## Presets

The module includes a **Show Control → Essentials** preset group with styled button shells (Blackout, DMX Output, Stop FX, Scene Off). After dragging a preset onto your Stream Deck, assign the matching **DMX Controller** actions and feedbacks to each button.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Connection failure | Verify DMX Controller is running (`http://host/` loads in a browser) |
| Empty scene/effect lists | Run **Refresh Scenes / Effects / Sequences** after adding items in Config |
| Sequence actions fail | WebSocket must connect — check firewall; reload the Companion connection |
| Wrong port | Match the `web_port` value in DMX Controller Config (default 80) |
| Color stays on after release (PUSH) | Add **Release Color** on the release step, or re-import `.companionconfig` with **Buttons** |
| Ghost latch after mode switch | Update module to v1.0.6+, restart DMX server; switching PUSH ↔ TOGGLE clears server state |
| Release step empty after import | Re-import with **Buttons** enabled; regenerate with `npm run companion:config` on show PC |

## Further reading

See [docs/companion.md](../../docs/companion.md) in the main repository for architecture, network layout, API details, and layout regeneration.
