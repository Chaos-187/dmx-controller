# DJ software integrations (scope)

Thaluxis DMX today is built around **VirtualDJ + OS2L** (`os2l.js`, subscriptions, button maps, VDJ `database.xml` import, satellite OS2L forward). This document scopes a **second integration** for **Denon DJ / Engine OS** over the community **StageLinQ** protocol, shipped as **beta / under construction** until hardware testing is complete.

**Reference implementation:** [chrisle/StageLinq](https://github.com/chrisle/StageLinq) (npm: `stagelinq`) — TypeScript library for discovery, StateMap, BeatInfo, FileTransfer, and Engine library (EAAS).

## Supported hardware (StageLinQ)

Same device list as StageLinq:

| Device |
|--------|
| Denon SC6000 / SC6000M |
| Denon SC5000 / SC5000M |
| Denon Prime 4 / Prime 2 / Prime Go |
| Denon X1850 / X1800 mixers |
| Denon LC6000 |

Players must be on the **same LAN** as the Thaluxis hub (UDP discovery + TCP services). No laptop running Engine DJ Desktop is required for deck state on standalone players; library sync may use EAAS/FileTransfer from the devices.

**Not in scope for v1 beta:** Replacing **Engine Lighting** (SoundSwitch DMX/Hue on the player). Thaluxis remains a separate Art-Net/USB rig controlled from the hub; StageLinQ feeds **deck state** only.

---

## Goals

| Goal | Notes |
|------|--------|
| One canonical **deck state** model | Existing `state.decks[1..4]` + `connected` / address fields |
| Multiple **providers** behind one facade | VirtualDJ default; Denon opt-in in Config → DJ Software |
| No regression for production VDJ | StageLinQ client does not start when provider is `virtualdj` |
| Clear **capability matrix** | Sequencer/UI use fields the active provider exposes |

## Non-goals (initial beta)

- Full OS2L parity (subscriptions editor, VDJ button map strings)
- Official inMusic/Denon SDK (StageLinQ is reverse-engineered; MIT third-party lib)
- Controlling Engine Lighting on the device from Thaluxis

---

## Architecture (target)

```
┌──────────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│ Denon Engine OS      │     │  dj-provider facade   │     │  server state   │
│ (SC6000, Prime 4, …) │────▶│  StageLinQ → normalize│────▶│  decks, seq, UI │
│ StageLinQ LAN        │     └──────────┬───────────┘     └─────────────────┘
└──────────────────────┘                │
┌──────────────────────┐                │
│ VirtualDJ            │────────────────┘
│ OS2L TCP             │     virtualdj provider (os2l.js)
└──────────────────────┘
```

### Provider contract (`lib/dj-providers/`)

| Field | Purpose |
|-------|---------|
| `id` | `virtualdj` \| `denon_engine` |
| `label` | Config UI name |
| `status` | `stable` \| `beta` |
| `transport` | `os2l` \| `stagelinq` |
| `start(deps)` / `stop()` | Hub boot when active + implemented |

**Planned Denon adapter** (`lib/dj-providers/denon-stagelinq-runtime.js` — not created yet):

```js
import { StageLinq } from 'stagelinq';

// stagelinq.devices.on('beatMessage', …)  → state.decks[d].bpm, beatpos
// stagelinq.devices.on('stateChanged', …)   → Play, TrackNetworkPath, CurrentBPM, …
// stagelinq.devices.on('trackLoaded', …)    → filepath / title / artist → track_id
```

Map StageLinQ state names to existing hub keys (see table below).

---

## StageLinQ → Thaluxis deck fields (planned)

| Thaluxis key | StageLinQ / events (indicative) |
|--------------|-----------------------------------|
| `filepath` | `TrackNetworkPath`, track path resolution from library |
| `filename` | basename of path or `SongName` |
| `bpm` | `CurrentBPM`, `beatMessage` |
| `beatpos` | `beatMessage` |
| `time` | elapsed ms from track length + playhead (TBD from StateMap) |
| `play` | `Play`, `PlayState` |
| `level` | `ExternalMixerVolume` / channel fader (mixer-aware) |
| `genre` | metadata from EAAS if imported |
| `soundswitch_id` | *n/a* for Denon path |

---

## Config keys

| Key | Purpose |
|-----|---------|
| `dj_active_provider` | `virtualdj` (default) or `denon_engine` |
| `denon_stagelinq_enabled` | `0` / `1` — start client when provider active (Phase 1) |
| `denon_discovery_interface` | `auto` or interface name (match hub network settings) |
| `denon_player_mode` | `2` or `4` — deck count hint |
| `denon_download_library` | `0` / `1` — allow FileTransfer/EAAS into hub DB (Phase 2) |

**Today:** Only `dj_active_provider` is saved from Config. Hub **runtime remains VirtualDJ/OS2L**.

---

## VirtualDJ (production)

Unchanged: local OS2L or satellite forward, subscriptions, VDJ XML import. See `lib/dj-providers/virtualdj.js`.

---

## Implementation phases

### Phase 0 — Scaffolding ✅

- Provider registry, `GET /api/dj/providers`
- Config → **DJ Software** (beta badge)
- `lib/dj-providers/denon-engine-beta.js` metadata + device list
- This document + [StageLinq](https://github.com/chrisle/StageLinq) as integration target

### Phase 1 — StageLinQ runtime (beta) — in progress

- [x] Dependency `stagelinq@3.5.5`
- [x] `lib/denon-stagelinq-runtime.js` — discovery, device connect, event log
- [x] Normalize `stateChanged` / `trackLoaded` / `beatMessage` → `handleOs2lSubscribed` deck pipeline
- [x] Gate: `dj_active_provider === 'denon_engine'` && `denon_stagelinq_enabled === '1'`
- [x] Hub OS2L off when Denon active; skip VDJ library import on boot
- [x] Config UI: enable StageLinQ, player mode, optional library download
- [ ] `denon_discovery_interface` (bind discovery to one NIC)
- [ ] Harden deck mapping for twin SC6000 + LC6000 layouts

### Phase 2 — Library + sequencer

- [ ] Optional Engine library download → import tracks into SQLite (parallel to VDJ import)
- [ ] Sequence auto-load on `trackLoaded` / path match (same rules as VDJ filepath)

### Phase 3 — Refactor

- [ ] Extract `applyDeckUpdate(deck, key, value)` from `server.js`
- [ ] Move OS2L server behind `virtualdj` provider `start/stop`

### Phase 4 — Satellite / remote

- [ ] Optional: satellite near Denon rig runs StageLinQ, POST normalized deck events to hub

---

## Testing checklist (when Denon hardware available)

- [ ] Discovery on show VLAN; Prime 4 or SC6000 pair
- [ ] Play/pause, BPM, beat position vs sequencer playhead
- [ ] Track load → DB match → sequence load
- [ ] 2-deck vs 4-deck / LC6000 expansion
- [ ] X1850 fader / crossfader → `level` or master behavior
- [ ] Failover: disconnect player → UI shows disconnected, no DMX false-stop
- [ ] VDJ shows unchanged when `dj_active_provider=virtualdj`

---

## API

### `GET /api/dj/providers`

Returns `{ active, effective, activeProvider, providers[] }` including `supportedDevices`, `referenceUrl`, `capabilities`.

---

## Serato DJ Pro (beta)

See **[docs/dj-integrations-serato.md](dj-integrations-serato.md)** — [serato-connect](https://github.com/chrisle/serato-connect) Remote OSC + history polling. Phase 1 implemented in `lib/serato-dj-runtime.js`.

---

## Related files

| Area | Path |
|------|------|
| Registry | `lib/dj-providers/index.js` |
| Denon beta metadata | `lib/dj-providers/denon-engine-beta.js` |
| Serato beta metadata | `lib/dj-providers/serato-beta.js` |
| VirtualDJ metadata | `lib/dj-providers/virtualdj.js` |
| Denon runtime | `lib/denon-stagelinq-runtime.js` |
| Serato runtime | `lib/serato-dj-runtime.js` |
| OS2L runtime | `os2l.js` |
| Deck state | `server.js` |
| Config UI | `public/config.html`, `public/js/config.js` |
| StageLinQ | https://github.com/chrisle/StageLinq |
| serato-connect | https://github.com/chrisle/serato-connect |
