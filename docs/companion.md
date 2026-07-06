# Bitfocus Companion / Stream Deck Integration

Control the DMX Controller from a **Stream Deck** (or any surface supported by [Bitfocus Companion](https://companion.free/)) over your LAN. This is the recommended external control surface integration — equivalent in *role* to the MIDI APC panel, but using network APIs instead of USB on the show server.

## Overview

```
┌─────────────────┐     HTTP + WebSocket      ┌──────────────────────┐
│  Stream Deck    │ ◄── USB ──► Companion     │   DMX Controller     │
│  (operator desk)│                           │   (show PC / rack)   │
└─────────────────┘                           └──────────┬───────────┘
                                                           │
                                                           ▼
                                                  Art-Net / USB DMX
```

| Control surface | Connection model | Configured in |
|-----------------|------------------|---------------|
| **MIDI APC Mini** | USB → show server | Config → MIDI Controller |
| **Touch panel** | Browser → show server | Config → Touch Actions |
| **Stream Deck** | Companion → HTTP/WS → show server | Bitfocus Companion |

The Companion module lives in the [`companion/`](../companion/) directory of this repository.

## Requirements

- DMX Controller server running (`npm start`)
- [Bitfocus Companion](https://companion.free/) v3.0+ installed on the machine that has the Stream Deck plugged in
- Both machines on the same network (or routed LAN)
- Inbound TCP allowed on the DMX Controller **web port** (default **80**)

Companion can run on the **same PC as the DMX Controller** (Stream Deck on the show machine) or on a **separate operator laptop** (most common).

## Quick start

### 1. Build the module

```bash
cd companion
npm install
npm run build
```

### 2. Register with Companion

1. Open Companion → **Settings** → **Developer modules path**.
2. Enable **Developer modules**.
3. Set the path to the **repo root**, not the `companion/` folder:

   ```
   C:\source\Node\dmx-controller
   ```

   Companion scans **subfolders** of this path. Each subfolder that contains `companion/manifest.json` is loaded as a module — so the module lives at `dmx-controller/companion/`, but the developer path must be one level up.

   **Wrong:** `...\dmx-controller\companion` → Found 0 extra modules  
   **Right:** `...\dmx-controller` → finds the `companion` module

4. Restart Companion.

### 3. Import the page layout (recommended)

Pre-built Stream Deck layouts mirror the **APC Mini MIDI pages** (Home, Colors, Color FX, Cell FX, Mover FX, Rig FX):

| File | Device |
|------|--------|
| `companion/config/dmx-controller-streamdeck15.companionconfig` | Stream Deck / MK.2 (5×3, 15 keys) |
| `companion/config/dmx-controller-streamdeck-xl.companionconfig` | Stream Deck XL (8×4, 32 keys) |

**Import in Companion:**

1. **Import / Export** tab → choose the `.companionconfig` file.
2. Import **Buttons** (and **Connections** if prompted).
3. Remap the **DMX Controller** connection to your show PC IP.

**Regenerate from your database** (matches your MIDI mappings and effect IDs):

```bash
# On the show PC (with dmx-controller.db present)
npm run companion:config

# Or with custom host baked into the connection:
node companion/generate-config.cjs --host 192.168.1.50 --port 80
```

For the closest match to the APC layout, create default MIDI mappings first (**Config → MIDI → Create Default APC Layout**), then regenerate.

**Or download from the running server:**

```
GET /api/companion/config?layout=streamdeck15&host=192.168.1.50
GET /api/companion/config?layout=streamdeck-xl
```

### 4. Add / verify the connection

1. **Connections → Add connection → Eyup Events → DMX Controller** (skip if imported from config).
2. **Host:** IP or mDNS name of the show PC (e.g. `192.168.1.50` or `dmx-controller.local`)
3. **HTTP Port:** `80` unless you changed `web_port` in Config

Status should show **OK** when the server is reachable.

## Page layout (matches MIDI APC)

| Page | MIDI equivalent | Contents |
|------|-----------------|----------|
| **Home** | Global (page 0) | Page shortcuts, **STROBE**, **SMOKE**, **FIRE** (hold), other globals, scene off — nav: **BLACKOUT**, **OUTPUT** |
| **Fixtures** | — | Toggle fixtures on/off |
| **Scenes** | — | Activate scenes |
| **Colors** | Page 1 | Color presets — **PUSH** or **TOGGLE** input mode |
| **Color FX** | Page 2 | Rainbow, fades, pulses, strobes, sparkles |
| **Cell FX** | Page 3 | Chases, comets, scanners, multicell |
| **Mover FX** | Page 4 | Circles, sweeps, fan, random |
| **Rig FX** | Page 5 | Rig chases, sweeps, waves, rainbow |

**Navigation:** Every Colors/FX page has a **bottom row** with **HOME**, **STOP FX** (or the color mode button on Colors), blue shortcuts to other pages, plus **BLACKOUT** and **OUTPUT** on the last two keys.

When generated from the database, the **Colors** page uses your MIDI color names and RGB values but always wires **Set Color (Press)** + **Release Color** on every key — independent of the APC pad toggle mode. **Effect** pages are built from live effects in the database, not MIDI grid order.

## Color buttons — PUSH vs TOGGLE

Stream Deck color keys work differently from the APC Mini pads. The APC uses hardware toggle pads; Companion uses **press** and **release** actions, with input mode chosen on the **Colors** page nav button.

### Default: PUSH mode

| Event | Behaviour |
|-------|-----------|
| **Press** | Color ON |
| **Release** | Color OFF |

Each color key must have two actions (same pattern as **BLACKOUT**):

| Step | Action | Notes |
|------|--------|-------|
| **Press** | **Set Color (Press)** | Set Red / Green / Blue / White for that swatch |
| **Release** | **Release Color** | No options — clears the active push color |

Pre-built `.companionconfig` layouts include both steps on every color button.

### TOGGLE mode

Tap the **PUSH / TOGGLE** button on the Colors page nav row (replaces **STOP FX** on that page only).

| Event | Behaviour |
|-------|-----------|
| **Press** | Toggle color ON / OFF |
| **Release** | **Release Color** (ignored — does not clear latch) |

| Mode button | Colour | Label |
|-------------|--------|-------|
| PUSH active | Green | `PUSH` |
| TOGGLE active | Orange | `TOGGLE` |

### Switching modes

Switching **PUSH ↔ TOGGLE** always:

- Clears all latched companion color states on the server
- Removes stale toggle keys from server memory
- Turns fixtures off

After a mode switch, the first tap in TOGGLE mode always starts fresh (no ghost “already on” state).

### Import / upgrade colour buttons

If a color turns on but never off in PUSH mode, the key is missing **Release Color** on the release step:

1. **Import / Export** → re-import `companion/config/dmx-controller-streamdeck-xl.companionconfig` (or `-15`)
2. Enable **Buttons** on import so existing keys are overwritten
3. Reload the Companion module (v1.0.6+)
4. Or manually add **Release Color** to the release step on each colour key

**Regenerate** after database changes:

```bash
npm run companion:config
# or: GET /api/companion/config?layout=streamdeck-xl&host=YOUR_IP
```

### 5. Customise buttons

Use built-in **presets** (Show Control → Essentials) as styled button shells, then assign actions:

| Preset | Assign action | Optional feedback |
|--------|---------------|-------------------|
| Blackout | **Blackout Hold** (press=on, release=off) | Blackout Hold is Active |
| DMX Output | **DMX Output** → Toggle | DMX Output is ON |
| Stop FX | **Stop Effects** → All slots | — |
| Scene Off | **Deactivate Scene** | — |

After adding scenes, effects, or sequences in the DMX Config UI, run **Refresh Scenes / Effects / Sequences** on the connection (or reconnect) to update dropdowns.

## Module features

### Actions

| ID | Description |
|----|-------------|
| `dmx_output` | Toggle / on / off global DMX output |
| `blackout` | Blackout hold on, off, or toggle |
| `strobe` | Strobe on/off/toggle (hold on Stream Deck) |
| `smoke` | Smoke/fog machines on/off/toggle (hold) |
| `fire` | Atmosphere/fire machines on/off/toggle (hold; `atmosphere` channel type) |
| `set_color_press` | Set color on button press (PUSH / TOGGLE) |
| `release_color` | Clear active push color on button release (no options) |
| `set_color_release` | Legacy per-colour release — prefer `release_color` |
| `set_color` | Combined colour action with mode dropdown (legacy) |
| `toggle_color_mode` | Switch Colors page input between PUSH and TOGGLE |
| `activate_scene` | Activate static scene by ID |
| `deactivate_scene` | Deactivate current scene |
| `toggle_fixture` | Enable/disable a fixture from the rig |
| `run_effect` | Run quick-action effect (all fixtures or group) |
| `stop_effects` | Stop all or one effect slot |
| `full_on` | Full on hold |
| `master_dimmer` | Set master dimmer 0–255 |
| `effect_speed` | Set effect speed 0.1–3.0× |
| `sequence_load` | Load sequence onto deck (WebSocket) |
| `sequence_play` | Play sequence on deck |
| `sequence_pause` | Pause sequence on deck |
| `sequence_unload` | Unload sequence from deck |
| `refresh_lists` | Reload scene/effect/sequence dropdowns |

### Feedbacks

Button states sync via WebSocket (and initial HTTP poll):

- DMX output enabled
- Blackout hold active
- Scene active (per scene ID)
- Fixture enabled (per fixture ID)
- VirtualDJ connected
- Effect slot running
- **Color input is Push Mode** / **Color input is Toggle Mode** (Colors page mode button)
- Sequence playing per deck

### Variables

Examples for button text:

- `$(dmx-controller:dmx_output)` — `yes` / `no`
- `$(dmx-controller:color_mode)` — `PUSH` or `TOGGLE`
- `$(dmx-controller:active_scene_name)`
- `$(dmx-controller:deck1_track)` / `$(dmx-controller:deck1_bpm)`
- `$(dmx-controller:vdj_connected)`

## API reference (used by the module)

The module calls the same REST and WebSocket APIs documented in [api.md](./api.md).

### REST endpoints

| Method | Endpoint | Module usage |
|--------|----------|--------------|
| `GET` | `/api/version` | Connection health check |
| `GET` / `POST` | `/api/dmx/output` | Output state / toggle |
| `POST` | `/api/touch/blackout-hold` | Blackout `{ "active": true/false }` |
| `POST` | `/api/touch/master-dimmer` | `{ "value": 0-255 }` |
| `POST` | `/api/touch/effect-speed` | `{ "value": 0.1-3.0 }` |
| `GET` | `/api/scenes` | Scene list |
| `GET` | `/api/scenes/active` | Active scene ID |
| `POST` | `/api/scenes/:id/activate` | Activate scene |
| `POST` | `/api/scenes/deactivate` | Deactivate scene |
| `GET` | `/api/effects` | Effect list |
| `POST` | `/api/effects/run` | `{ "effectId", "fixtureIds" }` |
| `POST` | `/api/effects/stop` | `{ "slot" }` optional |
| `GET` | `/api/effects/status` | Running effect slots |
| `GET` | `/api/groups` | Fixture groups |
| `GET` | `/api/fixtures` | All fixtures |
| `GET` | `/api/sequences` | Sequence list |
| `GET` | `/api/touch/state` | Touch overrides incl. `companionColorPushMode` |
| `GET` | `/api/companion/layouts` | List Stream Deck layout downloads |
| `GET` | `/api/companion/config?layout=streamdeck15` | Download `.companionconfig` |
| `GET` / `POST` | `/api/companion/color-mode` | Read / set PUSH vs TOGGLE (`{ "toggle": true }` or `{ "push": true/false }`) |
| `POST` | `/api/companion/color-release` | Clear all latched companion colors and turn fixtures off |
| `POST` | `/api/companion/trigger` | Fire action `{ action_type, action_data, mode, key }` (same engine as MIDI) |

### WebSocket (`ws://host:port`)

**Client → server** (sequence control):

```json
{ "type": "sequence", "action": "load|unload|play|pause", "deck": 1, "sequenceId": 42 }
```

**Server → client** (feedbacks / variables):

| Message type | Purpose |
|--------------|---------|
| `state` | VDJ deck state, connection flag (~15 fps) |
| `connection` | VDJ connect/disconnect |
| `dmxOutput` | Output enabled changed |
| `touchBlackoutHold` | Blackout hold changed |
| `companionColorMode` | Colors page PUSH/TOGGLE mode changed `{ pushMode: boolean }` |
| `masterDimmer` | Master dimmer changed |
| `scene_activated` / `scene_deactivated` | Scene state |
| `seq_playing` / `seq_unloaded` | Sequencer state |

## Stream Deck layout tips

1. **Top row:** DMX output, blackout (hold), stop all FX, scene off.
2. **Scene bank:** One button per scene using **Activate Scene** + **Scene is Active** feedback.
3. **FX row:** **Run Effect** per look + **Effect Slot Running** feedback on the same slot.
4. **VDJ row:** Variables on button text for deck 1/2 track name and BPM.

Use **paging** on Stream Deck XL for scenes/effects; keep blackout and output on every page via Companion page inheritance or duplicate buttons.

## Development

```bash
cd companion
npm install
npm run dev    # watch TypeScript
npm run build  # compile to dist/
npm run package  # build distributable .pkg (optional)
```

Point Companion’s developer modules path at `companion/` while iterating.

Module source layout:

```
companion/
├── companion/
│   ├── manifest.json   # Companion module manifest
│   └── HELP.md         # In-app help
├── src/
│   ├── main.ts         # Connection lifecycle
│   ├── api.ts          # HTTP + WebSocket client
│   ├── actions.ts
│   ├── feedbacks.ts
│   ├── variables.ts
│   └── presets.ts
└── package.json
```

## Why Companion instead of an Elgato plugin?

- Companion already drives Stream Deck hardware and supports feedback, variables, and presets.
- The DMX Controller exposes a full HTTP/WebSocket API — no USB driver on the show server.
- One module can target Stream Deck, X-keys, mobile, and custom surfaces.
- Easier to maintain alongside this Node.js project than a separate Elgato SDK package.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Connection failure | Server down or wrong IP/port | Open `http://host/` in browser |
| Actions work, no feedback | WebSocket blocked | Allow TCP on web port; check proxy/VPN |
| Empty dropdowns | Lists not loaded yet | **Refresh lists** or reconnect after config changes |
| Effect run fails | No fixtures in group | Assign fixtures to group in Config |
| Sequence load fails | Invalid sequence ID | Refresh lists; verify sequence exists |
| Color stays on after release (PUSH) | Missing **Release Color** on button release step | Re-import `.companionconfig` with **Buttons**, or add **Release Color** manually |
| Color still “latched” after mode switch | Old module / server | Update to module v1.0.6+, restart DMX server; mode switch clears server state |
| First TOGGLE tap turns off instead of on | Stale toggle key on server | Tap **PUSH/TOGGLE** mode button twice to force clear, or restart server |
| Import didn’t add release actions | Buttons not overwritten | Re-import with **Buttons** enabled; run `npm run companion:config` on show PC |

## Related docs

- [API Reference](./api.md) — full REST and WebSocket documentation
- [companion/HELP.md](../companion/companion/HELP.md) — short in-app help for Companion users
