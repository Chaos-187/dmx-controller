# DMX Controller API Reference

Base URL: `http://localhost`

All request/response bodies are JSON. Set `Content-Type: application/json` for POST/PUT requests.

---

## Table of Contents

- [Fixture Types](#fixture-types)
- [Fixtures](#fixtures)
- [Universe Map](#universe-map)
- [Fixture Groups](#fixture-groups)
- [Subscriptions](#subscriptions)
- [Mover Presets](#mover-presets)
- [Config](#config)
- [Device Scan](#device-scan)
- [DMX USB](#dmx-usb)
- [Art-Net Universes](#art-net-universes)
- [DMX Output Control](#dmx-output-control)
- [OS2L Button Maps](#os2l-button-maps)
- [Tracks](#tracks)
- [Effects](#effects)
- [Sequences](#sequences)
- [Sequence Cues](#sequence-cues)
- [Auto-Generate Sequence](#auto-generate-sequence)
- [WebSocket](#websocket)
- [External Control (Companion)](#external-control-companion)

---

## Fixture Types

### List all fixture types

```
GET /api/fixture-types
```

**Response:** Array of fixture type objects.

### Get a fixture type

```
GET /api/fixture-types/:id
```

**Response:** Fixture type object or `404`.

### Create a fixture type

```
POST /api/fixture-types
```

**Body:** Fixture type definition (name, channels, etc.)

**Response:** `201` with created object.

### Update a fixture type

```
PUT /api/fixture-types/:id
```

**Body:** Updated fixture type fields.

**Response:** Updated object or `404`.

### Delete a fixture type

```
DELETE /api/fixture-types/:id
```

**Response:** `{ deleted: true }` or `409` if fixtures reference it.

---

## Fixtures

### List all fixtures

```
GET /api/fixtures
```

**Response:** Array of fixture objects.

### Get a fixture

```
GET /api/fixtures/:id
```

**Response:** Fixture object or `404`.

### Create a fixture

```
POST /api/fixtures
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Fixture name |
| `fixture_type_id` | number | Reference to fixture type |
| `universe` | number | DMX universe number |
| `start_address` | number | DMX start address (1–512) |

**Response:** `201` with created object, or `400` on validation error.

### Update a fixture

```
PUT /api/fixtures/:id
```

**Body:** Updated fixture fields.

**Response:** Updated object, `404`, or `400`.

### Delete a fixture

```
DELETE /api/fixtures/:id
```

**Response:** `{ deleted: true }`

---

## Universe Map

### Get universe channel map

```
GET /api/universe/:num
```

**Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `num` | number | Universe number |

**Response:** Array of channel-to-fixture mappings for the given universe.

### Get fixture channel map

```
GET /api/fixture-channel-map
```

**Response:** Array of fixture objects with their resolved DMX channel addresses and types. Used internally for effects, sequence playback, and quick actions.

---

## Fixture Groups

### List all groups

```
GET /api/groups
```

**Response:** Array of group objects.

### Create a group

```
POST /api/groups
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Group name |

**Response:** `201` with created object.

### Update a group

```
PUT /api/groups/:id
```

**Body:** Updated group fields.

**Response:** Updated object or `404`.

### Delete a group

```
DELETE /api/groups/:id
```

**Response:** `{ deleted: true }`

### Set group fixtures

```
PUT /api/groups/:id/fixtures
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `fixture_ids` | number[] | Array of fixture IDs to assign |

**Response:** Updated group or `400`.

---

## Subscriptions

OS2L trigger subscriptions sent to VirtualDJ.

### List all subscriptions

```
GET /api/subscriptions
```

**Response:** Array of subscription objects.

### Create a subscription

```
POST /api/subscriptions
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `trigger` | string | OS2L trigger string (e.g. `deck 1 get_bpm`) |
| `enabled` | boolean | Whether subscription is active |

**Response:** `201` with created object.

### Update a subscription

```
PUT /api/subscriptions/:id
```

**Body:** Updated subscription fields.

**Response:** Updated object or `404`.

### Delete a subscription

```
DELETE /api/subscriptions/:id
```

**Response:** `{ deleted: true }`

### Toggle subscription enabled state

```
POST /api/subscriptions/:id/toggle
```

**Response:** Updated subscription or `404`.

### Resend subscriptions to VirtualDJ

```
POST /api/subscriptions/resend
```

Re-sends all enabled subscriptions to the connected VirtualDJ instance.

**Response:**

```json
{ "sent": true, "count": 12, "connected": true }
```

---

## Mover Presets

Pan/Tilt presets for moving-head fixtures.

### List all mover presets

```
GET /api/mover-presets
```

**Response:** Array of mover preset objects.

### Get a mover preset

```
GET /api/mover-presets/:id
```

**Response:** Mover preset object or `404`.

### Create a mover preset

```
POST /api/mover-presets
```

**Body:** Mover preset definition (name, pan, tilt, etc.)

**Response:** Created object.

### Update a mover preset

```
PUT /api/mover-presets/:id
```

**Body:** Updated fields.

**Response:** Updated object or `404`.

### Delete a mover preset

```
DELETE /api/mover-presets/:id
```

**Response:** `{ deleted: true }`

---

## Config

Key-value configuration store.

### Get all config

```
GET /api/config
```

**Response:** Object of all config key-value pairs.

Known keys include:
- `subscription_frequency` — OS2L subscription update rate (ms)
- `dmx_refresh_rate` — DMX USB refresh rate (Hz)
- `artnet_refresh_rate` — Art-Net refresh rate (Hz)
- `strobe_speed` — Default strobe speed (0–255)
- `vdj_db_path` — Path to VirtualDJ database XML

### Set a config value

```
PUT /api/config/:key
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `value` | string | Config value |

**Response:**

```json
{ "key": "dmx_refresh_rate", "value": "40" }
```

---

## Device Scan

### List available DMX devices

```
GET /api/serial-ports
```

Scans for FTDI D2XX and libusb devices.

**Response:**

```json
{
  "ftdi": [
    {
      "source": "ftdi",
      "serial_number": "AL00XXXX",
      "description": "FT232R USB UART",
      ...
    }
  ],
  "usb": [
    {
      "source": "usb",
      "vid": "0x15e4",
      "pid": "0x0053",
      "manufacturer": "SoundSwitch",
      "product": "SoundSwitch DMX Micro Interface",
      "serial_number": "",
      "isDmxRelated": true
    }
  ]
}
```

---

## DMX USB

### Get DMX USB status

```
GET /api/dmx-usb/status
```

**Response:** Status object (open state, device info, TX stats).

### Open a DMX USB device

```
POST /api/dmx-usb/open
```

**Body (FTDI device):**

| Field | Type | Description |
|-------|------|-------------|
| `serial_number` | string | FTDI serial number |
| `description` | string | FTDI description (alternative to serial) |

**Body (USB device):**

| Field | Type | Description |
|-------|------|-------------|
| `source` | string | Must be `"usb"` |
| `vid` | string | USB vendor ID (hex) |
| `pid` | string | USB product ID (hex) |
| `serial_number` | string | Optional serial number |

**Response:** `{ ok: true, identifier: {...} }` or `500`.

### Close DMX USB device

```
POST /api/dmx-usb/close
```

**Response:** `{ ok: true }`

### Blackout DMX USB

```
POST /api/dmx-usb/blackout
```

Sets all DMX USB channels to 0.

**Response:** `{ ok: true }`

---

## Art-Net Universes

### List Art-Net universes

```
GET /api/artnet-universes
```

**Response:** Array of Art-Net universe config objects.

### Get an Art-Net universe

```
GET /api/artnet-universes/:id
```

**Response:** Art-Net universe object or `404`.

### Create an Art-Net universe

```
POST /api/artnet-universes
```

**Body:** Art-Net universe definition (name, host, port, local universe mapping, etc.)

**Response:** `201` with created object. Hot-adds to running Art-Net worker.

### Update an Art-Net universe

```
PUT /api/artnet-universes/:id
```

**Body:** Updated fields.

**Response:** Updated object. Hot-updates running worker.

### Delete an Art-Net universe

```
DELETE /api/artnet-universes/:id
```

Removes from database and running worker.

**Response:** `{ deleted: true }`

### Toggle Art-Net universe enabled state

```
POST /api/artnet-universes/:id/toggle
```

**Response:** Updated universe object.

### Art-Net blackout

```
POST /api/artnet/blackout
```

Sets all Art-Net and DMX USB channels to 0.

**Response:** `{ ok: true }`

### Set a single Art-Net channel

```
POST /api/artnet/channel
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `localUniverse` | number | Local universe number |
| `channel` | number | Channel number (1–512) |
| `value` | number | Value (0–255) |

**Response:** `{ ok: true }`

---

## DMX Output Control

Master output enable/disable. When disabled, all DMX output (Art-Net + USB) is suppressed and a blackout is sent.

### Get output state

```
GET /api/dmx/output
```

**Response:**

```json
{ "enabled": false }
```

### Set output state

```
POST /api/dmx/output
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Enable or disable DMX output |

**Response:** `{ enabled: true }`

Broadcasts `dmxOutput` event to all WebSocket clients.

### Set a single DMX channel

```
POST /api/dmx/channel
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `universe` | number | Universe number |
| `channel` | number | Channel number (1–512) |
| `value` | number | Value (0–255) |

**Response:** `{ ok: true }` or `{ ok: true, outputOff: true }` if output is disabled.

### Set multiple DMX channels

```
POST /api/dmx/channels
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `universe` | number | Universe number |
| `channels` | array | `[{ ch: number, val: number }, ...]` |

**Response:** `{ ok: true }` or `{ ok: true, outputOff: true }`.

---

## OS2L Button Maps

Map OS2L button events from VirtualDJ to DMX actions.

### List all button maps

```
GET /api/os2l-button-maps
```

**Response:** Array of button map objects.

### Get a button map

```
GET /api/os2l-button-maps/:id
```

**Response:** Button map object or `404`.

### Create a button map

```
POST /api/os2l-button-maps
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name |
| `os2l_value` | string | OS2L button name to match (`*` for wildcard) |
| `action_type` | string | One of: `blackout`, `set_channels`, `full_on`, `scene`, `strobe` |
| `action_data` | object | Action-specific parameters (JSON) |
| `toggle_mode` | string | `fire` (every event) or `toggle` (on/off state) |
| `enabled` | boolean | Whether the map is active |

**Response:** `201` with created object.

### Update a button map

```
PUT /api/os2l-button-maps/:id
```

**Body:** Updated fields.

**Response:** Updated object or `404`.

### Delete a button map

```
DELETE /api/os2l-button-maps/:id
```

**Response:** `{ deleted: true }`

### Toggle button map enabled state

```
POST /api/os2l-button-maps/:id/toggle
```

**Response:** Updated button map.

### Test a button map

```
POST /api/os2l-button-maps/test/:id
```

Fires the button map action with `state=1` (activate).

**Response:** `{ ok: true, tested: "Map Name" }`

### Get active toggle states

```
GET /api/os2l-button-maps/active-toggles
```

**Response:** Array of button map IDs currently in the "on" toggle state.

---

## Tracks

VirtualDJ track library imported from the VDJ database XML.

### List tracks

```
GET /api/tracks
```

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Search by title/filename |
| `genre` | string | Filter by genre |
| `sourceType` | string | Filter by source type |
| `minBpm` | number | Minimum BPM |
| `maxBpm` | number | Maximum BPM |
| `key` | string | Musical key filter |
| `limit` | number | Max results (pagination) |
| `offset` | number | Offset for pagination |

**Response:** Paginated track results.

### Get track stats

```
GET /api/tracks/stats
```

**Response:** Aggregate statistics (total count, BPM range, etc.)

### Get track genres

```
GET /api/tracks/genres
```

**Response:** Array of distinct genres.

### Get a track

```
GET /api/tracks/:id
```

**Response:** Track object or `404`.

### Import tracks from VirtualDJ

```
POST /api/tracks/import
```

Parses the VirtualDJ database XML (configured path or auto-detected) and imports/updates tracks.

**Response:**

```json
{
  "total": 500,
  "inserted": 120,
  "updated": 380,
  "path": "C:\\Users\\...\\VirtualDJ\\database.xml"
}
```

### Clear all tracks

```
DELETE /api/tracks
```

**Response:** `{ cleared: true }`

---

## Effects

Reusable lighting effects (pulse, rainbow, strobe, color_fade).

### List all effects

```
GET /api/effects
```

**Response:** Array of effect objects.

### Get an effect

```
GET /api/effects/:id
```

**Response:** Effect object or `404`.

### Create an effect

```
POST /api/effects
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Effect name |
| `type` | string | `pulse`, `rainbow`, `strobe`, or `color_fade` |
| `effect_data` | object | Type-specific parameters |

Effect data by type:

- **pulse:** `{ frequency: number }` — sine wave pulse frequency
- **rainbow:** `{ cycles: number }` — hue rotation cycles
- **strobe:** `{ frequency: number }` — strobe rate in Hz
- **color_fade:** `{ start_color: { red, green, blue }, end_color: { red, green, blue } }`

**Response:** `201` with created object.

### Update an effect

```
PUT /api/effects/:id
```

**Body:** Updated fields.

**Response:** Updated object or `404`.

### Delete an effect

```
DELETE /api/effects/:id
```

**Response:** `{ deleted: true }`

### Run an effect (Quick Action preview)

```
POST /api/effects/run
```

Starts a real-time effect preview on selected fixtures at ~40 Hz.

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `effectId` | number | Effect ID |
| `fixtureIds` | number[] | Fixtures to apply the effect to |

**Response:** `{ ok: true }`

### Stop running effect

```
POST /api/effects/stop
```

Stops the currently running quick-action effect and zeros affected channels.

**Response:** `{ ok: true }`

---

## Sequences

Lighting sequences tied to tracks, containing cues on a timeline.

### List all sequences

```
GET /api/sequences
```

**Response:** Array of sequence objects.

### Get a sequence

```
GET /api/sequences/:id
```

**Response:** Sequence object (with cues) or `404`.

### Get sequence by track ID

```
GET /api/sequences/by-track/:trackId
```

**Response:** Sequence object for the given track, or `404`.

### Create a sequence

```
POST /api/sequences
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Sequence name |
| `track_id` | number | Associated track ID (optional) |
| `bpm` | number | Beats per minute |
| `duration_ms` | number | Total duration in milliseconds |

**Response:** `201` with created object.

### Update a sequence

```
PUT /api/sequences/:id
```

**Body:** Updated fields.

**Response:** Updated object or `404`.

### Delete a sequence

```
DELETE /api/sequences/:id
```

Deletes the sequence and all its cues.

**Response:** `{ deleted: true }`

---

## Sequence Cues

Individual cues within a sequence timeline.

### List cues for a sequence

```
GET /api/sequences/:id/cues
```

**Response:** Array of cue objects.

### Create a cue

```
POST /api/sequences/:id/cues
```

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `lane` | number | Lane/row index |
| `start_ms` | number | Start time in milliseconds |
| `duration_ms` | number | Cue duration in milliseconds |
| `cue_type` | string | `static`, `fade`, `strobe`, `chase`, or `effect` |
| `fixture_id` | number | Target fixture ID |
| `channel_values` | object | Channel type → value map (e.g. `{ red: 255, green: 0, blue: 128 }`) |
| `end_channel_values` | object | End values for fade cues |
| `effect_id` | number | Effect ID for `effect` cue type |
| `effect_params` | object | Override params for the effect |
| `color` | string | Display color (hex) |
| `label` | string | Display label |

**Response:** `201` with created cue.

### Update a cue

```
PUT /api/cues/:id
```

**Body:** Updated cue fields.

**Response:** Updated cue or `404`.

### Delete a cue

```
DELETE /api/cues/:id
```

**Response:** `{ deleted: true }`

### Bulk update cues

```
PUT /api/sequences/:id/cues/bulk
```

Replaces all cues for a sequence.

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `cues` | array | Array of cue objects (see create cue fields) |

**Response:** Bulk operation result.

---

## Auto-Generate Sequence

### Generate a sequence for a track

```
POST /api/sequences/generate/:trackId
```

Auto-generates a color-cycling sequence based on the track's BPM and duration. Assigns cues to all RGB-capable fixtures, alternating color palettes every 4 bars.

**Body:**

| Field | Type | Description |
|-------|------|-------------|
| `overwrite` | boolean | If `true`, deletes existing sequence for this track first |

**Response:** Created sequence object, or `409` if a sequence already exists (and `overwrite` is not set).

---

## WebSocket

Connect to the WebSocket server at `ws://localhost`.

### Client → Server Messages

#### Sequence command

```json
{
  "type": "sequence",
  "action": "load | unload | play | pause",
  "deck": 1,
  "sequenceId": 42
}
```

| Action | Description |
|--------|-------------|
| `load` | Load a sequence onto a deck |
| `unload` | Unload the sequence from a deck |
| `play` | Start playback (standalone timer or VDJ-driven) |
| `pause` | Pause playback, saving current position |

### Server → Client Messages

#### `state` — Full deck/crossfader state (~30 fps)

```json
{
  "type": "state",
  "state": {
    "decks": {
      "1": { "filepath": "...", "bpm": 128, "time": 45230, "play": 1, ... },
      "2": { ... }
    },
    "crossfader": 0.5,
    "connected": true,
    "vdjAddress": "192.168.1.10:54321"
  }
}
```

#### `connection` — VDJ connection status change

```json
{ "type": "connection", "connected": true, "address": "192.168.1.10:54321" }
```

#### `beat` — OS2L beat event

```json
{ "type": "beat", "data": { ... } }
```

#### `btn` — OS2L button event

```json
{ "type": "btn", "data": { "name": "pad_1", "state": 1 } }
```

#### `cmd` — OS2L command event

```json
{ "type": "cmd", "data": { ... } }
```

#### `log` — Raw OS2L message (event log)

```json
{ "type": "log", "ts": 1708300000000, "raw": { ... } }
```

#### `dmxOutput` — DMX output enabled/disabled

```json
{ "type": "dmxOutput", "enabled": true }
```

#### `os2l_action` — Button map action executed

```json
{ "type": "os2l_action", "action": "blackout", "map": "Panic Button", "active": true }
```

#### `seq_loaded` — Sequence loaded onto a deck

```json
{ "type": "seq_loaded", "deck": 1, "sequence": { ... } }
```

#### `seq_unloaded` — Sequence unloaded from a deck

```json
{ "type": "seq_unloaded", "deck": 1 }
```

#### `seq_playing` — Sequence playback state change

```json
{ "type": "seq_playing", "deck": 1, "playing": true }
```

#### `seq_time` — Sequence playhead position (standalone timer)

```json
{ "type": "seq_time", "deck": 1, "timeMs": 45230 }
```

#### `touchBlackoutHold` — Blackout hold state

```json
{ "type": "touchBlackoutHold", "active": true }
```

#### `scene_activated` / `scene_deactivated` — Static scene state

```json
{ "type": "scene_activated", "sceneId": 3, "sceneName": "Warm Ambience" }
{ "type": "scene_deactivated" }
```

---

## External Control (Companion)

The recommended way to control the DMX Controller from an **Elgato Stream Deck** is the included **Bitfocus Companion module** in the [`companion/`](../companion/) directory.

See **[companion.md](./companion.md)** for installation, Stream Deck layout tips, and the full list of module actions and feedbacks.

### Endpoints commonly used by Companion

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/version` | Connection health check |
| `GET` / `POST` | `/api/dmx/output` | Read / set global output |
| `POST` | `/api/touch/blackout-hold` | `{ "active": true \| false }` |
| `POST` | `/api/touch/master-dimmer` | `{ "value": 0-255 }` |
| `POST` | `/api/touch/effect-speed` | `{ "value": 0.1-3.0 }` |
| `GET` | `/api/scenes` | List scenes |
| `GET` | `/api/scenes/active` | `{ "activeSceneId": number \| null }` |
| `POST` | `/api/scenes/:id/activate` | Activate scene |
| `POST` | `/api/scenes/deactivate` | Deactivate scene |
| `GET` | `/api/effects` | List effects |
| `GET` | `/api/effects/status` | Running effect slots |
| `POST` | `/api/effects/run` | `{ "effectId", "fixtureIds" }` |
| `POST` | `/api/effects/stop` | `{ "slot" }` optional |
| `GET` | `/api/groups` | Fixture groups (includes `fixture_ids`) |
| `GET` | `/api/fixtures` | All fixtures |
| `GET` | `/api/sequences` | List sequences |

### Companion-specific endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/companion/layouts` | List available Stream Deck layout downloads |
| `GET` | `/api/companion/config?layout=streamdeck15` | Download `.companionconfig` (colours from DB, effects from live data) |
| `GET` / `POST` | `/api/companion/color-mode` | Read or set Colors page input mode |
| `POST` | `/api/companion/color-release` | Clear all latched companion colours and turn fixtures off |
| `POST` | `/api/companion/trigger` | Fire action `{ action_type, action_data, mode, key }` (same engine as MIDI) |

#### Color input mode

```http
GET /api/companion/color-mode
→ { "pushMode": true, "holdMode": true }
```

```http
POST /api/companion/color-mode
Content-Type: application/json

{ "toggle": true }
```

Or set explicitly: `{ "push": true }` (PUSH) / `{ "push": false }` (TOGGLE).

Switching **PUSH ↔ TOGGLE** clears all latched companion colour states on the server and turns fixtures off.

#### Colour trigger (used by module)

```http
POST /api/companion/trigger
Content-Type: application/json

{
  "action_type": "color",
  "action_data": { "red": 255, "green": 0, "blue": 0, "white": 0 },
  "mode": "on",
  "key": "color-255-0-0-0"
}
```

| `mode` (raw) | PUSH mode (server) | TOGGLE mode (server) |
|--------------|-------------------|----------------------|
| `on` | Apply colour | Toggle latch |
| `off` | Clear colour | Ignored |
| `toggle` | Apply colour | Toggle latch |

`POST /api/companion/color-release` clears all companion colour latch state (same as the **Release Color** module action). **Only applies in PUSH mode** — ignored in TOGGLE mode so release steps do not undo latched colours.

WebSocket clients (including Companion) use the same server as the browser UI. Sequence transport commands are sent as [client → server sequence messages](#sequence-command); state and feedback use the [server → client message types](#server--client-message-types) above.

The server also broadcasts `{ "type": "companionColorMode", "pushMode": boolean }` when the Colors page input mode changes.
