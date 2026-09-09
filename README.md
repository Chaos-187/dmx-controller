# Thaluxis DMX

**Lighting control forged for live events.**

A Node.js-based DMX lighting controller with real-time VirtualDJ integration via the OS2L protocol. Features a browser-based web UI, Art-Net and USB DMX output, fixture management, and VirtualDJ database import.

## Features

- **VirtualDJ OS2L Integration** — Connects to VirtualDJ via TCP using the OS2L protocol, receiving real-time deck data (BPM, beat position, play state, levels, loops, track info, SoundSwitch IDs)
- **Bonjour/mDNS Discovery** — Automatically advertises as an `_os2l._tcp` service so VirtualDJ can discover the controller on the network
- **Art-Net DMX Output** — Sends DMX512 data over the network via Art-Net (UDP), with support for multiple universes and configurable frame rates
- **USB DMX Output** — Direct DMX output via USB adapters using FTDI D2XX (Enttec Open DMX, DMXKING ultraDMX Micro) and libusb (SoundSwitch DMX Micro)
- **Real-time Web UI** — Single-page browser interface with WebSocket-driven live updates at ~30fps
- **Fixture Management** — Full CRUD for fixture types, fixture instances, DMX universe mapping, and fixture groups
- **Quick Actions** — Color presets, effects, movement presets, master dimmer, and a live RGBW color picker
- **512-Channel Fader Control** — Manual per-channel DMX faders with universe selection
- **VirtualDJ Database Import** — Parses VirtualDJ's `database.xml` to import track metadata (BPM, key, genre, duration, beatgrid, POIs)
- **SQLite Database** — Persistent storage using better-sqlite3 with WAL mode for all configuration, fixtures, subscriptions, and track data
- **Worker Threads** — Art-Net and DMX USB transmission run in dedicated worker threads to avoid blocking the main event loop
- **Bitfocus Companion Module** — Control from Elgato Stream Deck (and other Companion surfaces) via HTTP/WebSocket; see [docs/companion.md](docs/companion.md)

## Architecture

```
┌──────────────┐       OS2L/TCP        ┌──────────────────────┐
│  VirtualDJ   │ ────────────────────▶  │     server.js        │
│              │       port 8787       │   (Express + WS +    │
└──────────────┘                       │    OS2L TCP Server)   │
                                       └──────┬───┬───┬───────┘
                                              │   │   │
                            ┌─────────────────┘   │   └────────────────┐
                            ▼                     ▼                    ▼
                   ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐
                   │ artnet-server.js│   │    db.js      │   │ dmx-usb-server.js│
                   │  (orchestrator) │   │  (SQLite)     │   │  (orchestrator)  │
                   └────────┬────────┘   └──────────────┘   └────────┬─────────┘
                            ▼                                        ▼
                   ┌─────────────────┐                      ┌──────────────────┐
                   │ artnet-worker.js│                      │ dmx-usb-worker.js│
                   │ (Worker Thread) │                      │ (Worker Thread)  │
                   │   UDP/Art-Net   │                      │  FTDI / libusb   │
                   └─────────────────┘                      └──────────────────┘

                   ┌──────────────────┐        WebSocket       ┌─────────────┐
                   │  vdj-parser.js   │                        │  Browser UI  │
                   │  (XML parser)    │                        │  index.html  │
                   └──────────────────┘        port 80       └─────────────┘
                                                                    ▲
                   ┌──────────────────┐   HTTP + WebSocket          │
                   │ Bitfocus         │ ────────────────────────────┘
                   │ Companion        │   (Stream Deck module)
                   │ + Stream Deck    │
                   └──────────────────┘
```

## Prerequisites

- **Node.js** v18+ recommended
- **VirtualDJ** (for OS2L integration)
- **FTDI D2XX drivers** (for USB DMX adapters using FTDI chips)
- **libusb** (for USB DMX adapters like SoundSwitch DMX Micro)

## Installation

```bash
git clone <repository-url>
cd dmx-controller
npm install
```

### Dependencies

| Package | Purpose |
|---------|---------|
| `express` | HTTP server and REST API |
| `ws` | WebSocket server for real-time browser updates |
| `better-sqlite3` | SQLite database (WAL mode, foreign keys) |
| `bonjour-service` | mDNS/Bonjour service advertisement |
| `ftdi-d2xx` | FTDI D2XX USB driver bindings |
| `usb` | libusb bindings for USB device access |
| `fast-xml-parser` | VirtualDJ database.xml parsing |

## Usage

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

The server starts three listeners:
- **OS2L TCP** on port `8787` — receives connections from VirtualDJ
- **HTTP/WebSocket** on port `80` — serves the web UI and pushes real-time state
- **mDNS** — advertises the `DMX-Controller` service for auto-discovery

Open `http://localhost` in a browser to access the web UI.

## Stream Deck / Bitfocus Companion

Use the included Companion module to control the show from an Elgato Stream Deck (or any Companion-supported surface) over the network — blackout, DMX output, scenes, effects, sequencer decks, and live VDJ feedback.

```bash
cd companion
npm install
npm run build
```

Then add the **repo root** (`dmx-controller`, not `dmx-controller/companion`) to **Companion → Settings → Developer modules path** and enable developer modules.

**Import a full page layout:** use the included `.companionconfig` files in `companion/config/` (see [docs/companion.md](docs/companion.md)).

Full setup, actions, feedbacks, and API mapping: **[docs/companion.md](docs/companion.md)**

## Web UI Tabs

| Tab | Description |
|-----|-------------|
| **Decks** | Live view of VirtualDJ deck states — track names, BPM, beat position, time, levels, loop status, SoundSwitch IDs, crossfader. Includes a filterable OS2L event log. |
| **Fixtures** | Manage fixture instances — assign name, type, universe, DMX address, output type (Art-Net/USB). Create and manage fixture groups. |
| **Fixture Types** | Define reusable fixture profiles with named channel layouts (e.g., RGB Par, Moving Head 16ch). Includes channel duplication for multi-segment fixtures. |
| **Universe** | Visual 512-slot DMX universe map showing occupied channels and fixture placement. |
| **DMX Control** | Manual 512-channel faders **and** Quick Actions panel with color presets, RGBW picker, effects (strobe/blackout), movement presets, and master dimmer. Hold-to-activate or toggle modes. |
| **Tracks** | Browse the imported VirtualDJ track library with search, genre/source/BPM filters, sortable columns, and pagination. |
| **Config** | Four sub-pages: DMX USB connection, Art-Net output node management, VirtualDJ settings, and OS2L subscription management. |

## REST API

### Fixture Types

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fixture-types` | List all fixture types with channels |
| `GET` | `/api/fixture-types/:id` | Get a single fixture type |
| `POST` | `/api/fixture-types` | Create a fixture type |
| `PUT` | `/api/fixture-types/:id` | Update a fixture type |
| `DELETE` | `/api/fixture-types/:id` | Delete a fixture type (blocked if in use) |

### Fixtures

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/fixtures` | List all fixtures |
| `GET` | `/api/fixtures/:id` | Get a single fixture with channel detail |
| `POST` | `/api/fixtures` | Create a fixture (validates address overlap) |
| `PUT` | `/api/fixtures/:id` | Update a fixture |
| `DELETE` | `/api/fixtures/:id` | Delete a fixture |

### Fixture Groups

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/groups` | List all groups with member fixture IDs |
| `POST` | `/api/groups` | Create a group |
| `PUT` | `/api/groups/:id` | Update a group |
| `DELETE` | `/api/groups/:id` | Delete a group |
| `PUT` | `/api/groups/:id/fixtures` | Set group fixture membership |

### Universe

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/universe/:num` | Get fixture map for a universe |
| `GET` | `/api/fixture-channel-map` | Get all fixtures with resolved DMX addresses and channel types |

### Art-Net Universes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/artnet-universes` | List all Art-Net output nodes |
| `GET` | `/api/artnet-universes/:id` | Get a single Art-Net node |
| `POST` | `/api/artnet-universes` | Create an Art-Net node (hot-added to worker) |
| `PUT` | `/api/artnet-universes/:id` | Update an Art-Net node (hot-updated) |
| `DELETE` | `/api/artnet-universes/:id` | Delete an Art-Net node |
| `POST` | `/api/artnet-universes/:id/toggle` | Toggle node enabled/disabled |

### DMX Output Control

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dmx/output` | Get output enabled state |
| `POST` | `/api/dmx/output` | Enable/disable DMX output globally |
| `POST` | `/api/dmx/channel` | Set a single channel value `{universe, channel, value}` |
| `POST` | `/api/dmx/channels` | Set multiple channels `{universe, channels: [{ch, val}]}` |
| `POST` | `/api/artnet/blackout` | Blackout all Art-Net + USB outputs |
| `POST` | `/api/artnet/channel` | Set Art-Net channel directly |

### DMX USB

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/dmx-usb/status` | Get USB DMX connection status |
| `POST` | `/api/dmx-usb/open` | Open a USB DMX device `{serial_number, description, source, vid, pid}` |
| `POST` | `/api/dmx-usb/close` | Close the USB DMX device |
| `POST` | `/api/dmx-usb/blackout` | Blackout USB DMX output |
| `GET` | `/api/serial-ports` | Scan for USB DMX devices (FTDI D2XX + libusb) |

### OS2L Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/subscriptions` | List all OS2L subscriptions |
| `POST` | `/api/subscriptions` | Create a subscription |
| `PUT` | `/api/subscriptions/:id` | Update a subscription |
| `DELETE` | `/api/subscriptions/:id` | Delete a subscription |
| `POST` | `/api/subscriptions/:id/toggle` | Toggle enabled/disabled |
| `POST` | `/api/subscriptions/resend` | Re-send all enabled subscriptions to VirtualDJ |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get all configuration key-value pairs |
| `PUT` | `/api/config/:key` | Set a config value |

### Tracks

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tracks` | Search/filter tracks (query params: `search`, `genre`, `sourceType`, `minBpm`, `maxBpm`, `key`, `limit`, `offset`) |
| `GET` | `/api/tracks/stats` | Get track statistics |
| `GET` | `/api/tracks/genres` | Get genre breakdown |
| `GET` | `/api/tracks/:id` | Get a single track |
| `POST` | `/api/tracks/import` | Import/re-import from VirtualDJ database.xml |
| `DELETE` | `/api/tracks` | Clear all imported tracks |

## WebSocket Messages

The server pushes the following message types to connected browser clients:

| Type | Description |
|------|-------------|
| `state` | Full deck state object (decks 1–4, crossfader, connection status). Broadcast at ~30fps when data changes. |
| `connection` | VirtualDJ connected/disconnected event |
| `beat` | Beat event from VirtualDJ |
| `btn` | Button event from VirtualDJ |
| `cmd` | Command event from VirtualDJ |
| `event` | Other OS2L events |
| `log` | Raw OS2L message for the event log |
| `dmxOutput` | DMX output enabled/disabled state change |
| `touchBlackoutHold` | Blackout hold state (Touch / MIDI / Companion) |
| `scene_activated` / `scene_deactivated` | Static scene state |
| `seq_playing` / `seq_loaded` / `seq_unloaded` | Sequencer deck state |

Companion and other external clients can connect to the same WebSocket. See [docs/companion.md](docs/companion.md).

## Releases & auto-update

Push a version tag to build and publish a Windows zip on GitHub Releases. Installed hubs can check, download, and apply updates from **Config → About**.

See [docs/RELEASE.md](docs/RELEASE.md) for the full release workflow.

```bash
npm run release:prepare -- 1.3.0
git commit -am "Release v1.3.0" && git tag v1.3.0
git push origin main && git push origin v1.3.0
```

## Database Schema

The SQLite database (`data/dmx-controller.db`) is created automatically on first run. An existing `dmx-controller.db` in the project root is moved into `data/` on first startup after upgrade. Override with `DMX_DB_PATH` or `DMX_DATA_DIR` if needed.

Tables:

| Table | Purpose |
|-------|---------|
| `fixture_types` | Reusable fixture profiles (name, manufacturer, category, channel count) |
| `fixture_type_channels` | Channel definitions per fixture type (number, name, type, default/min/max) |
| `fixtures` | Placed fixture instances (name, type, universe, address, output type) |
| `fixture_groups` | Named groups for organizing fixtures |
| `fixture_group_members` | Many-to-many relationship between groups and fixtures |
| `artnet_universes` | Art-Net output node configuration (IP, port, subnet, universe mapping) |
| `subscriptions` | OS2L trigger expressions sent to VirtualDJ |
| `config` | Key-value application settings |
| `tracks` | Imported VirtualDJ track metadata |

### Default Configuration

| Key | Default | Description |
|-----|---------|-------------|
| `subscription_frequency` | `25` | OS2L updates per second from VDJ |
| `os2l_port` | `8787` | OS2L TCP server port |
| `os2l_service_name` | `DMX-Controller` | mDNS service name |
| `web_port` | `80` | HTTP/WebSocket server port |
| `vdj_deck_count` | `4` | Number of VDJ decks to track |
| `dmx_refresh_rate` | `40` | USB DMX transmit rate (Hz) |
| `artnet_refresh_rate` | `44` | Art-Net transmit rate (Hz) |

### Seed Data

On first run, the database is seeded with:
- **7 fixture type templates**: Generic RGB Par (3ch), Generic RGBW Par (4ch), Generic Dimmer (1ch), RGB Par + Dimmer (4ch), Generic Moving Head (16ch), Generic Strobe (2ch), Generic Fog Machine (1ch)
- **OS2L subscriptions** for decks 1–4: SoundSwitch ID, filepath, genre, level, crossfader, time, beat position, first beat, BPM, play, loop, get_loop, loop roll

## Supported USB DMX Devices

### FTDI D2XX (native driver)
- Enttec Open DMX USB
- DMXKING ultraDMX Micro
- FT232R / FT2232H / FT232H / FT-X Series adapters

### libusb (bulk transfer)
- SoundSwitch DMX Micro Interface (`15e4:0053`)
- SoundSwitch DMX Interface (`15e4:0100`)
- Microchip USB DMX (`04d8:000a`)
- DMXking ultraDMX2 PRO (`04d8:fb56`)
- Velleman VMB1USB (`10cf:8062`)

The DMX USB worker supports two break generation methods for FTDI devices:
- **Baud rate switch** (default, most reliable) — switches to 76800 baud to send a break
- **Set Break On/Off** — uses FTDI break control lines

## Project Structure

```
dmx-controller/
├── server.js              # Main server — Express, WebSocket, OS2L TCP, Bonjour
├── db.js                  # SQLite database (better-sqlite3) — schema, CRUD, seeds
├── artnet-server.js       # Art-Net orchestrator — manages worker thread
├── artnet-worker.js       # Art-Net worker — UDP packet transmission (Worker Thread)
├── dmx-usb-server.js      # DMX USB orchestrator — manages worker thread
├── dmx-usb-worker.js      # DMX USB worker — FTDI D2XX / libusb (Worker Thread)
├── vdj-parser.js          # VirtualDJ database.xml parser
├── companion/             # Bitfocus Companion module (Stream Deck)
│   ├── companion/         # Module manifest + HELP
│   └── src/               # TypeScript source
├── docs/
│   ├── api.md             # REST + WebSocket API reference
│   └── companion.md       # Stream Deck / Companion integration
├── package.json
└── public/
    ├── index.html          # Single-page web UI (HTML + CSS + JS)
    └── css/
        └── style.css       # Shared CSS variables and styles
```

## License

&copy; Eyup Events
