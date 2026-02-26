# DMX Controller — Sequencer System Technical Report

> **Scope**: Complete technical documentation of the sequence generation, playback, and editing pipeline across all components.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Database Schema & Data Layer](#2-database-schema--data-layer)
3. [Sequence Generation Pipeline](#3-sequence-generation-pipeline)
4. [Effects Engine](#4-effects-engine)
5. [Playback Engine](#5-playback-engine)
6. [API Layer (sequence-routes.js)](#6-api-layer)
7. [Frontend Sequencer UI](#7-frontend-sequencer-ui)
8. [Integration Points (OS2L, Art-Net, DMX USB)](#8-integration-points)

---

## 1. Architecture Overview

### System Topology

```
┌─────────────┐    OS2L/TCP     ┌──────────────────────────────────────────────┐
│  VirtualDJ   │ ──────────────▶ │  server.js (Express + WebSocket)             │
│  (DJ app)    │ ◀────────────── │                                              │
└─────────────┘                  │  ┌──────────────────┐  ┌──────────────────┐  │
                                 │  │ handleOs2l        │  │ handleSequence   │  │
┌─────────────┐    WebSocket     │  │ Subscribed()      │  │ Command()        │  │
│  Browser UI  │ ◀──────────────▶│  └────────┬─────────┘  └────────┬─────────┘  │
│ sequencer.js │                 │           │                      │            │
└─────────────┘                  │           v                      v            │
                                 │  ┌──────────────────────────────────────────┐ │
                                 │  │       processSequenceAtTime()            │ │
                                 │  │  (cue evaluation, DMX value resolution)  │ │
                                 │  └──────────────────┬───────────────────────┘ │
                                 │                     │                         │
                                 │  ┌──────────────────▼───────────────────────┐ │
                                 │  │  artnetServer / dmxUsbServer             │ │
                                 │  │  (worker threads for DMX output)         │ │
                                 │  └──────────────────────────────────────────┘ │
                                 └──────────────────────────────────────────────┘
                                                    │
                                          ┌─────────▼─────────┐
                                          │   SQLite (db.js)  │
                                          │   better-sqlite3  │
                                          └───────────────────┘
```

### Key Files

| File | Lines | Role |
|---|---|---|
| `server.js` | 3372 | Main app server — OS2L, WebSocket, Express, playback engine, DMX output |
| `sequence-generator.js` | 2435 | Algorithmic sequence generation from audio analysis |
| `effects-engine.js` | 690 | Effect computation (color, multicell, motion, rig-wide) |
| `sequence-routes.js` | 287 | Express router for sequence/cue REST APIs |
| `db.js` | 3283 | SQLite schema, migrations, all CRUD operations |
| `audio-analyzer.js` | — | ffmpeg-based waveform/beat/section analysis |
| `public/js/sequencer.js` | 1485 | Frontend sequencer IIFE module (canvas timeline UI) |
| `public/sequencer.html` | 216 | Sequencer page HTML structure |
| `public/css/sequencer.css` | — | Dark theme, CSS custom properties, 3-column layout |

### Technology Stack

- **Backend**: Node.js, Express, `ws` (WebSocket), `better-sqlite3` (WAL mode)
- **DMX Output**: Art-Net (UDP worker thread), DMX USB (FTDI D2XX worker)
- **DJ Integration**: OS2L protocol over TCP (Bonjour/mDNS discovery)
- **Audio**: ffmpeg spawn for waveform extraction, custom beat/section detection
- **Frontend**: Vanilla JS IIFE, HTML Canvas, WaveformData library
- **State Sync**: WebSocket broadcast at ~15 Hz to all connected browser clients

---

## 2. Database Schema & Data Layer

**File**: `db.js` | **Database**: SQLite with WAL journal, foreign keys ON

### Core Tables

#### `light_sequences` (line ~100)
```
id              INTEGER PRIMARY KEY
name            TEXT NOT NULL
track_id        INTEGER (FK → tracks.id, nullable)
bpm             REAL DEFAULT 120
duration_ms     INTEGER DEFAULT 0
loop            INTEGER DEFAULT 0
created_at      DATETIME
updated_at      DATETIME
```

#### `sequence_cues` (line ~110)
The fundamental unit of the lighting timeline.
```
id                  INTEGER PRIMARY KEY
sequence_id         INTEGER (FK → light_sequences.id, CASCADE)
lane                INTEGER DEFAULT 0
start_ms            INTEGER DEFAULT 0
duration_ms         INTEGER DEFAULT 1000
cue_type            TEXT DEFAULT 'static'     — static|fade|strobe|chase|effect|movement
fixture_id          INTEGER (FK → fixtures.id)
group_id            INTEGER
channel_values      TEXT (JSON)               — e.g. {"red":255,"green":0,"blue":80,"dimmer":255}
end_channel_values  TEXT (JSON, nullable)      — end state for fade/transition cues
effect_id           INTEGER (FK → effects.id)
effect_params       TEXT (JSON)               — e.g. {"frequency":2,"speed":1.5}
color               TEXT                       — hex display color, e.g. "#e94560"
label               TEXT
sort_order          INTEGER
cell                INTEGER (nullable)         — multi-cell fixture targeting
```

#### `effects` (line ~135)
```
id              INTEGER PRIMARY KEY
name            TEXT
type            TEXT      — pulse|rainbow|strobe|chase|color_fade|sparkle|...
category        TEXT      — color|multicell|moving_head|rig
fixture_target  TEXT      — all|moving_head|multicell|...
effect_data     TEXT (JSON)
duration_beats  REAL
```

#### `track_analysis` (line ~145)
```
track_id        INTEGER PRIMARY KEY (FK → tracks.id)
waveform_peaks  TEXT (JSON) — Array of peak samples
energy_levels   TEXT (JSON) — Per-beat energy values
beats           TEXT (JSON) — Array of beat timestamps in ms
sections        TEXT (JSON) — [{label, start_ms, end_ms}, ...]
sample_rate     INTEGER
channels        INTEGER
duration_ms     INTEGER
peak_count      INTEGER
```

#### `fixtures` (subset of fields relevant to sequencer)
```
id              INTEGER PRIMARY KEY
fixture_type_id INTEGER (FK)
universe        INTEGER
address         INTEGER       — DMX start address
output_type     TEXT          — artnet|usb
invert_pan      INTEGER
invert_tilt     INTEGER
home_pan        INTEGER       — default pan position (0-255)
home_tilt       INTEGER       — default tilt position (0-255)
rig_x           REAL          — spatial position 0.0–1.0 across rig
rig_y           REAL          — spatial position 0.0–1.0 vertical
rig_order       INTEGER       — ordinal for ordered effects
```

#### `fixture_type_channels`
```
channel_number  INTEGER       — 1-based offset from fixture address
name            TEXT
type            TEXT          — dimmer|red|green|blue|white|amber|uv|pan|tilt|speed|gobo|color_wheel|...
default_value   INTEGER
min             INTEGER
max             INTEGER
ranges          TEXT (JSON)   — [{type:"dimmer",min:8,max:134},{type:"strobe",min:135,max:239}]
cell            INTEGER       — null for master channels, 1+ for cell-specific
invert          INTEGER
```

#### `mover_presets`
```
id          INTEGER PRIMARY KEY
name        TEXT
positions   TEXT (JSON) — [{fixture_id, pan, tilt, speed?}, ...]
sort_order  INTEGER
is_system   INTEGER
icon        TEXT
```

### Key CRUD Functions

| Function | Line | Purpose |
|---|---|---|
| `getFixtureChannelMap()` | 1984 | Returns all fixtures with resolved channels, cell counts, color wheel maps, group memberships, invert flags, and computed DMX addresses |
| `getSequences()` | 2647 | Lists all sequences with track join data and cue counts |
| `getSequence(id)` | 2658 | Single sequence with track metadata |
| `getSequenceByTrackId(trackId)` | 2669 | Lookup sequence by associated track |
| `createSequence({...})` | 2675 | Insert with name/track_id/bpm/duration_ms/loop |
| `updateSequence(id, {...})` | 2683 | Partial update, preserves undefined fields |
| `deleteSequence(id)` | 2700 | Cascade deletes cues via FK |
| `getSequenceCues(sequenceId)` | 2799 | Full cue data with JSON-parsed channel_values, end_channel_values, effect_params |
| `getSequenceCuesLightweight(sequenceId)` | 2766 | Optimized for UI — computes display_color from RGB channels, includes mover_preset_id |
| `getCue(id)` | 2848 | Single cue with parsed JSON fields |
| `createCue(sequenceId, cue)` | 2817 | Insert cue, updates sequence timestamp |
| `updateCue(id, updates)` | 2860 | Partial update with JSON serialization |
| `deleteCue(id)` | 2891 | Delete cue, updates sequence timestamp |
| `bulkUpdateCues(sequenceId, cues)` | 2897 | Transaction: DELETE all + INSERT all, used by generator |
| `getGeneratorConfig()` | 2497 | Reads all `gen_*` config keys, falls back to `GENERATOR_CONFIG_DEFAULTS` |
| `getEffect(id)` | 2605 | Single effect with parsed effect_data |
| `getMoverPreset(id)` | 2196 | Single preset with parsed positions JSON |

### Generator Config Defaults (`GENERATOR_CONFIG_DEFAULTS`, line 2278)

Stored in the `config` table with `gen_*` keys. All values are user-customizable:

| Key | Type | Description |
|---|---|---|
| `gen_color_palettes` | Object | 11 named palettes (vibrant, neon, warm, cool, pastel, fire, ocean, sunset, uv, forest, party), each defining color-pair arrays for 8 section types |
| `gen_genre_presets` | Object | 13 genre presets with: intensityMult, strobeMult, cueDensityMult, preferredPalette, beatColorMult, flashOnSection, accentPulses |
| `gen_genre_aliases` | Object | ~70 genre string → preset key mappings |
| `gen_section_styles` | Object | Per-section: intensity range, beatColorChange, strobeChance, cuePerBars, rampIntensity, buildEnergy, dropEnergy, fadeOut |
| `gen_movement_styles` | Object | Per-section: barsPerMove, range, speed (slow/medium/fast) |
| `gen_speed_dmx` | Object | `{slow:200, medium:140, fast:40}` — DMX speed channel values |
| `gen_section_effects` | Object | Per-section: regular effect types, cellAware effect types |
| `gen_cell_patterns` | Object | Per-section: array of multi-cell pattern names |

---

## 3. Sequence Generation Pipeline

**File**: `sequence-generator.js` (2435 lines)

### Entry Point

**`generateSequence()`** (line ~530)

```
Input: {
  track,          — track DB record (title, bpm, filepath, genre)
  fixtures,       — Array from getFixtureChannelMap()
  analysis,       — {beats[], sections[], energy_levels[], duration_ms}
  palette,        — palette key string or 'random'
  genre,          — genre string or 'auto'
  effects,        — Array of effect records
  moverPresets,   — Array of mover preset records
  noStrobes,      — boolean
  generatorConfig — from getGeneratorConfig()
}

Output: {
  cues,           — Array of cue objects ready for bulkUpdateCues()
  bpm,            — detected/provided BPM
  durationMs,     — track duration
  palette,        — resolved palette key
  genrePreset     — resolved genre preset key
}
```

### Fixture Classification (line ~575)

The generator classifies fixtures into working groups:

```
rgbFixtures         — has red/green/blue channels
colorWheelFixtures  — has color_wheel channel type
movers              — category matches moving_head*
moverRgb            — movers that also have RGB
ledBars             — has >1 cell, channels suggest strip form
multiCellFixtures   — cell_count > 1
regularFixtures     — RGB fixtures that are NOT multi-cell
```

### Sub-Generator Pipeline

Called sequentially, each appending to the shared `cues` array:

```
generateSequence()
  ├─ generateSectionBased()       — for all rgbFixtures + regularFixtures
  ├─ generateBarBased()           — fallback when no sections detected
  ├─ generateColorWheelCues()     — for color wheel fixtures
  ├─ generateMoverMovement()      — for movers (pan/tilt/preset cues)
  ├─ generateEffectCues()         — effect overlay cues per fixture group
  ├─ generateMultiCellPatterns()  — per-cell cues for multi-cell fixtures
  └─ resolveMultiCellConflicts()  — removes master cues that overlap cell cues
```

### generateSectionBased() (line ~740)

The primary cue generator for RGB fixtures. Processes each audio section:

1. **Section style lookup** — `sectionStyles[label]` provides intensity range, cue density, strobe chance
2. **Energy-driven intensity** — base intensity scaled by analysis energy at each cue position
3. **Color palette selection** — `getSectionPalettes(paletteKey, sectionLabel)` returns color pairs
4. **Cue placement** — every N bars (from `cuePerBars`), snapped to beat grid via `snapToBar()`
5. **Cue type selection**:
   - BPM > 140: favors `fade` (smooth transitions)
   - BPM ≤ 140: favors `static` (instant changes)
6. **Color cascade** — fixtures ordered by `rig_x`; each fixture's start time is staggered by `(rig_x * barMs * 0.25)` for spatial ripple
7. **Strobe hits** — on downbeats when `strobeChance` random threshold met (chorus/drop only)
8. **Flash on section start** — full-white flash cue at chorus/drop beginnings when `flashOnSection` enabled
9. **Energy-driven accent pulses** — in verse/bridge sections, brief bright flashes on high-energy beats
10. **Buildup ramp** — `rampIntensity: true` linearly increases intensity across the section
11. **Outro fade** — `fadeOut: true` reduces intensity to ~20% with fade cue type

### generateColorWheelCues() (line ~1120)

For fixtures with physical color wheels (not RGB mixing):

- Uses `findNearestWheelColor()` (Euclidean distance in RGB space) to match palette colors to the fixture's `color_wheel_map` DMX positions
- Always uses `cue_type: 'static'` — interpolating would sweep through random intermediate wheel positions
- Color changes follow the same section/bar timing as the main generator

### generateMoverMovement() (line ~1405)

Generates movement cues for moving heads:

- **MOVEMENT_STYLES** (line ~1365): per-section `barsPerMove`, `range`, `speed`
- **MOVE_DENSITY** map: sections like chorus/drop have more frequent position changes
- References `mover_preset_ids` — each cue stores an array of preset IDs to cycle through
- `cue_type: 'movement'` — playback engine interpolates between preset positions with smoothstep easing
- Speed channel set directly via `SPEED_DMX` values
- Buildup sections ramp movement frequency (starts at 1 cue per 4 bars → 1 per bar)

### generateEffectCues() (line ~1640)

Overlays effect-driven cues onto the sequence:

1. Groups fixtures by `type_name`
2. Per section, selects appropriate effect types from `SECTION_EFFECT_TYPES[label]`
3. Picks `regular` effects for standard fixtures, `cellAware` for multi-cell
4. **Cascade mode** — when multiple fixtures in a group:
   - Sorts by `rig_x` for spatial ordering
   - Staggers start times: `stagger = barMs * 0.5 * (rig_x / maxRigX)`
5. **Rig-wide effects** — independent from group effects; emitted per section with `rigWide` type array (if any)
6. Uses seeded random (`seededRandom()`) for deterministic generation from same inputs

### generateMultiCellPatterns() (line ~1890)

Generates per-cell cues for LED bars and multi-cell fixtures:

- **CELL_PATTERN_MAP** (line ~1875): maps section labels to pattern arrays
  - intro: `fill_sweep, color_wave, breathe`
  - verse: `chase_slow, alternate, color_wave, fill_sweep, chase`
  - chorus: `chase, alternate, scatter, all_flash`
  - bridge: `color_wave, alternate, chase_slow`
  - breakdown: `fill_sweep, breathe`
  - buildup: `build_reveal, chase_accel`
  - drop: `chase_fast, scatter_strobe, alternate_fast, all_flash`
  - outro: `fill_sweep, color_wave, breathe`

- **Sub-phrase rotation** — long sections are split into sub-phrases (`SUB_PHRASE_BARS`); each sub-phrase gets a different pattern and rotated palette
- **Cross-fixture cascade** — when multiple multi-cell fixtures exist, can span a virtual cell array across all fixtures for unified chase/wave effects
- **`_dispatchCellPattern()`** (line ~2052): routes pattern names to implementation functions:

| Pattern | Function | Description |
|---|---|---|
| `chase` / `chase_slow` / `chase_fast` | `cellPatternChase()` | Cells light sequentially; speed controls cycle duration; bounce direction toggles randomly |
| `chase_accel` | `cellPatternChaseAccel()` | Quadratic-ease acceleration from 1 bar/cycle to ½ beat/cycle |
| `alternate` / `alternate_fast` | `cellPatternAlternate()` | Even/odd cells swap between two contrasting colors |
| `color_wave` | `cellPatternColorWave()` | Same palette offset in time across cells — ripple/wave |
| `scatter` / `scatter_strobe` | `cellPatternScatter()` | Random cells flash at random intervals; strobe mode uses 15 Hz strobe cue |
| `fill_sweep` | `cellPatternFillSweep()` | Progressive reveal left→right then hold |
| `build_reveal` | `cellPatternBuildReveal()` | Progressive more cells activate with increasing intensity |
| `all_flash` | `cellPatternAllFlash()` | All cells flash simultaneously, alternating contrasting colors + periodic strobe bursts |
| `breathe` | `cellPatternBreathe()` | Gentle sine-style fade in/out for all cells |

- **Virtual cell support** — `_resolveCell(p, cellIndex)` (line ~2076) maps virtual cell indices across multiple fixtures when in cascade mode

### resolveMultiCellConflicts() (line ~680)

Post-processing step: removes master-level cues (cell=null) that overlap in time with cell-specific cues on the same fixture. This ensures cell patterns take visual priority.

### Helper Functions

| Function | Purpose |
|---|---|
| `snapToBeat(ms)` | Binary search to find nearest beat timestamp |
| `snapToBar(ms)` | Binary search for nearest bar-aligned position |
| `seededRandom(seed)` | Deterministic PRNG — same inputs produce same sequence |
| `getSectionPalettes(paletteKey, label)` | Resolves palette + section → array of color pairs |
| `applyIntensity(color, intensity)` | Scales RGB by 0..1 intensity factor |
| `lerpColor(c1, c2, t)` | Linear interpolation between two RGB colors |
| `findNearestWheelColor(targetRGB, wheelMap)` | Euclidean distance matching for color wheel fixtures |
| `detectChannelsPerCell(fixture)` | Detects repeating channel patterns (3=RGB, 4=RGBW, etc.) |
| `rgbToHex(r, g, b)` | RGB → `#rrggbb` |

### Exports (line ~2430)

```javascript
module.exports = {
  generateSequence,
  colorPalettes,        // hardcoded palettes (line 14)
  genrePalettes,        // hardcoded genre palettes (line 170)
  genrePresets,         // hardcoded genre presets (line 385)
  genreAliases,         // hardcoded alias map (line 401)
  resolveGenrePreset,   // genre string → preset key
  PALETTE_KEYS,         // array of palette key names
  ALL_PALETTE_OPTIONS,  // [{key, label}] for UI dropdowns
};
```

---

## 4. Effects Engine

**File**: `effects-engine.js` (690 lines)

### Effect Type Categories

| Category | Constant | Types |
|---|---|---|
| Color | `COLOR_EFFECT_TYPES` | pulse, rainbow, strobe, color_fade, sparkle, color_wave, fire |
| Multicell | `MULTICELL_EFFECT_TYPES` | chase, comet, scanner, buildup, segments, ripple, cell_strobe, gradient |
| Moving Head | `MOVING_HEAD_EFFECT_TYPES` | pan_sweep, tilt_sweep, circle, figure_eight, random_move, fan, nod |
| Rig-wide | `RIG_EFFECT_TYPES` | rig_chase, rig_color_wave, rig_sweep, rig_alternate, rig_converge, rig_rainbow |

### Main Function

**`computeEffectValue(effect, channelType, progress, baseValues, params, channelCtx)`** (line ~97)

```
Inputs:
  effect       — {type, effect_data, fixture_target, ...}
  channelType  — 'red'|'green'|'blue'|'dimmer'|'pan'|'tilt'|etc.
  progress     — 0..1 (cue progress) or elapsed seconds (for real-time effects)
  baseValues   — {red:255, green:0, ...} from cue channel_values
  params       — from cue.effect_params (frequency, speed, etc.)
  channelCtx   — {channel_number, total_channels, home_pan, home_tilt,
                   _rigPosition, _rigPositionY, _rigOrder, _rigFixtureCount,
                   cell_count?, cell?, cell_channel_index?}

Output: number (0-255) or null (effect doesn't control this channel)
```

**Channel-type guards**: Mover effects ONLY write pan/tilt, color effects ONLY write RGB/dimmer/white channels. Returns `null` for uncontrolled channels, letting the caller fall back to base values.

### `resolveCellInfo()` (line ~130)

Determines cell index and count from:
1. Explicit `channelCtx.cell` metadata (preferred) 
2. Fallback: `channels_per_cell` heuristic from `channel_number / total_channels`

### `isFixtureCompatibleWithEffect(effect, fixMap)` (line ~73)

Checks `effect.fixture_target` against fixture capabilities:
- `all` → always compatible
- `moving_head` → fixture category starts with `moving_head`
- `multicell` → `cell_count > 0`
- `color` → has RGB channels
- `rig` → always compatible (uses rig position data)

### Effect Implementation Details

**Color effects** use sine/cosine waves and linear interpolation:
- `pulse` — sine wave oscillation on dimmer/color channels
- `rainbow` — hue cycle through HSL color space
- `strobe` — binary on/off at configurable Hz
- `color_fade` — linear interpolation between two colors over time
- `sparkle` — pseudo-random brightness per channel per frame
- `color_wave` — hue offset by cell position
- `fire` — randomized warm-tone flicker

**Multicell effects** use `cellIndex` and `cellCount`:
- `chase` — configurable direction (left/right/center/outside/bounce), width, tail
- `comet` — trailing tail that moves across cells
- `scanner` — bouncing scan across cells
- `buildup` — progressive fill from left
- `segments` — divide cells into N segments with different colors
- `ripple` — wave propagation from center
- `cell_strobe` — per-cell randomized strobe
- `gradient` — smooth color gradient across cells

**Moving head effects** write pan/tilt:
- `pan_sweep` / `tilt_sweep` — sine oscillation
- `circle` — sin(t)/cos(t) combined
- `figure_eight` — sin(t)/sin(2t) lissajous
- `random_move` — smoothstep-interpolated random target positions
- `fan` — spread based on `_fixtureOrdinal` 
- `nod` — tilt-only oscillation

**Rig-wide effects** use `_rigPosition` (0–1 X position) and `_rigOrder`:
- `rig_chase` — brightness peak sweeps across rig
- `rig_color_wave` — hue offset by rig position
- `rig_sweep` — on/off wipe across rig
- `rig_alternate` — even/odd fixture toggling
- `rig_converge` — dual peaks moving toward center
- `rig_rainbow` — full hue spread across rig width

### Exports

```javascript
module.exports = {
  computeEffectValue, isFixtureCompatibleWithEffect,
  MOVING_HEAD_EFFECT_TYPES, MULTICELL_EFFECT_TYPES,
  COLOR_EFFECT_TYPES, RIG_EFFECT_TYPES,
  PAN_TILT, COLOR_CHANNELS, hslToRgb, pseudoRandom,
};
```

---

## 5. Playback Engine

**File**: `server.js`, lines ~2580–3130

### State Structures

```javascript
const activeSequences = {};  // { deckNum: { sequence, lastTimeMs, playing, currentTimeMs,
                             //              vdjDriven, previewMode, startWall, startOffset,
                             //              _endActionApplied, _gated } }
const playbackTimers = {};   // { deckNum: intervalId }
```

**Mixer configuration** (cached, refreshed on startup and config save):
```javascript
let _cachedMixerConfig = {
  crossfaderGating: false,   // seq_crossfader_gating config key
  deckFaderDimmer: false,    // seq_deck_fader_dimmer config key
  endAction: 'none',         // seq_end_action: 'none'|'blackout'|'scene'
};
```

### Time Sources

The playback engine has **two time sources**:

1. **VDJ-driven** (server.js line ~373): OS2L sends `time` updates per deck → calls `processSequenceAtTime(deck, value)` directly. The `vdjDriven` flag is set, causing the standalone timer to skip processing.

2. **Standalone timer** via `startPlaybackTimer(deck)` (line ~2597): 25ms interval (~40 Hz). Computes elapsed time from `Date.now() - startWall + startOffset`. Broadcasts playhead position at ~15 Hz (throttled to 66ms). Auto-detects sequence end.

### handleSequenceCommand() (line ~2729)

WebSocket command handler, dispatched when `msg.type === 'sequence'`:

| Action | Behavior |
|---|---|
| `load` | Fetches sequence + cues from DB, clears OS2L overrides, deactivates scenes, blackouts old fixtures, initializes `activeSequences[deck]` |
| `unload` | Stops timer, blackouts fixtures, deletes from `activeSequences` |
| `play` | Sets `playing: true`, starts standalone timer |
| `pause` | Sets `playing: false`, saves `currentTimeMs`, stops timer, blackouts fixtures |
| `seek` | Updates `currentTimeMs`, resets wall clock if playing, calls `processSequenceAtTime` |
| `preview_load` | Like `load` but sets `previewMode: true`, no auto-play |
| `preview_seek` | Processes cues at target time with `{preview: true}` flag |
| `preview_refresh` | Reloads cues from DB, re-processes at current time (for live editing) |

### processSequenceAtTime() (line ~2884)

The core playback function — called on every time tick to evaluate cues and send DMX values.

**Flow**:

```
processSequenceAtTime(deckNum, timeMs, opts)
  │
  ├─ Guard: skip if not playing (unless preview mode)
  ├─ Sequence end detection → applySequenceEndAction()
  ├─ Guard: skip if dmxOutputEnabled === false
  ├─ Guard: skip if touchOverrides.blackoutHold
  ├─ Crossfader gating check (deck 1: cf > 0.5 → muted, deck 2: cf < 0.55 → muted)
  ├─ Deck fader dimmer: deckLevel = state.decks[deck].level (0-1)
  │
  ├─ Find active cues: filter where start_ms ≤ timeMs < start_ms + duration_ms
  ├─ Sort: master cues (cell=null) first, then cell-specific cues
  │
  └─ For each active cue:
       ├─ Skip disabled/OS2L-overridden fixtures
       ├─ Lookup fixMap from getFixtureChannelMap()
       ├─ Compute progress = (timeMs - start_ms) / duration_ms  [0..1]
       │
       ├─ For each channel on the fixture:
       │    ├─ Cell filtering: if cue.cell ≠ null, skip non-matching cell channels
       │    ├─ Touch override check: skip color channels if colorOverride, pan/tilt if movementOverride
       │    │
       │    ├─ Cue type dispatching:
       │    │    ├─ static/fade: lerp start→end values; snap color_wheel/gobo (no interpolation)
       │    │    ├─ strobe: hardware strobe range mapping OR software toggle at Hz
       │    │    ├─ chase: simple on/off from channel_values
       │    │    ├─ effect: computeEffectValue() with effectSpeed modifier on progress
       │    │    └─ movement: cycle through mover preset positions with smoothstep interpolation
       │    │
       │    └─ Post-processing pipeline:
       │         ├─ Clamp to 0-255
       │         ├─ Deck fader dimmer (only DIMMABLE_CHANNELS)
       │         ├─ Master dimmer (smart: only dimmer ch if fixture has dimmer, else RGB)
       │         ├─ mapValueToRange() — scale 0-255 into channel DMX sub-ranges
       │         └─ applyInvert() — flip 0↔255 for inverted channels
       │
       └─ Send channelUpdates to artnetServer + dmxUsbServer
```

### Cue Type Processing Details

#### `static` / `fade` (line ~2960)
- If `end_channel_values` exists: linear interpolation `start + (end - start) * progress`
- If no end values: holds start value
- **Color wheel / gobo channels**: always snap (no interpolation) — physical wheels can't smoothly transition

#### `strobe` (line ~2975)
Three modes:
1. **Hardware strobe range**: Channel has `ranges` with `type: 'strobe'` → maps strobe Hz to DMX range
2. **Fixture has hw strobe on another channel**: Color channels send steady values (strobe handled by hardware)
3. **Software strobe**: Binary toggle `phase < 0.5 ? onVal : 0` at configured Hz

#### `effect` (line ~3012)
- Fetches effect from DB, checks compatibility
- Builds `channelCtx` via `buildChannelCtx()` (line ~2870) with cell metadata and rig position
- Calls `computeEffectValue()` with `progress * touchOverrides.effectSpeed`
- Falls back to base channel values for channels the effect doesn't control

#### `movement` (line ~3030)
- Resolves `mover_preset_ids` array from channel_values
- Collects fixture-specific positions from each preset
- Cycle through positions: `stepProgress = (progress * totalSteps) % totalSteps`
- **Smoothstep easing**: `f(t) = t² * (3 - 2t)` for natural acceleration/deceleration between positions
- Speed channel value passed through from channel_values

### DMX Value Post-Processing Pipeline

Applied to every resolved value before sending to hardware:

| Step | Function | Line | Description |
|---|---|---|---|
| 1 | Clamp | — | `Math.max(0, Math.min(255, Math.round(value)))` |
| 2 | Deck fader dimmer | ~3075 | Only `DIMMABLE_CHANNELS` (dimmer, red, green, blue, white, amber, uv); scales by `state.decks[deck].level` (0–1) |
| 3 | Master dimmer | ~3080 | **Smart scaling**: if fixture HAS a dimmer channel, only scale the dimmer (avoids double-dipping via hardware multiplier). If fixture is RGB-only (no dimmer), scale RGB directly. |
| 4 | `mapValueToRange()` | ~2842 | Converts logical 0–255 to channel's DMX sub-range, e.g. dimmer 0–255 → DMX 8–134 |
| 5 | `applyInvert()` | ~2850 | `invert ? 255 - value : value` for inverted pan/tilt |

### End-of-Sequence Actions

**`applySequenceEndAction(deck)`** (line ~2652):

| Action | Behavior |
|---|---|
| `none` | Keep last DMX values, stop playback |
| `blackout` | Zero all fixture channels, stop playback |
| `scene` | Blackout, then activate default scene (`db.getDefaultScene()`) |

**`blackoutDeckFixtures(deck)`** (line ~2685): Sends 0 to all channels on all fixtures referenced by the deck's active sequence cues.

### Touch Override System (line ~1378)

```javascript
const touchOverrides = {
  disabledFixtures: new Set(),       // fixture IDs to skip entirely
  blackoutHold: false,               // suppress all sequence output
  masterDimmer: 255,                 // global 0-255 brightness scale
  effectSpeed: 1.0,                  // 0.1-3.0 multiplier on effect progress
  os2lOverrideFixtures: new Set(),   // fixtures currently controlled by OS2L button
  colorOverrideFixtures: new Set(),  // fixtures with color overridden from touch UI
  movementOverrideFixtures: new Set() // fixtures with movement overridden from touch UI
};
```

---

## 6. API Layer

**File**: `sequence-routes.js` (287 lines)

### Initialization

**`init({db, audioAnalyzer, sequenceGenerator, broadcast, getAnalysisConfig})`** (line 17)

Receives dependencies via injection — no module-level requires of other app modules.

### REST Endpoints

#### Sequence CRUD

| Method | Path | Handler |
|---|---|---|
| GET | `/api/sequences` | List all sequences (with track join) |
| GET | `/api/sequences/:id` | Single sequence |
| GET | `/api/sequences/by-track/:trackId` | Find by track |
| POST | `/api/sequences` | Create sequence |
| PUT | `/api/sequences/:id` | Update sequence |
| DELETE | `/api/sequences/:id` | Delete sequence |

#### Cue CRUD

| Method | Path | Handler |
|---|---|---|
| GET | `/api/sequences/:id/cues` | Lightweight cue list for UI |
| GET | `/api/cues/:id` | Full single cue |
| POST | `/api/sequences/:id/cues` | Create cue |
| PUT | `/api/cues/:id` | Update cue |
| DELETE | `/api/cues/:id` | Delete cue |
| PUT | `/api/sequences/:id/cues/bulk` | Bulk update (replace all) |

#### Generation

| Method | Path | Handler |
|---|---|---|
| GET | `/api/sequences/generate-options` | Palette + genre options for UI dropdowns |
| POST | `/api/sequences/generate/:trackId` | Generate sequence for a track |
| POST | `/api/sequences/generate-batch` | Batch generate for multiple tracks |

#### Utility

| Method | Path | Handler |
|---|---|---|
| GET | `/api/db/stats` | DB statistics (counts) |
| DELETE | `/api/db/analysis` | Bulk delete all analysis data |
| DELETE | `/api/db/sequences` | Bulk delete all sequences |

### Generate Endpoint Detail (lines 131–182)

`POST /api/sequences/generate/:trackId`:

1. Fetch track from DB
2. Auto-analyze if no analysis exists (calls `audioAnalyzer.analyzeTrack()`)
3. Fetch fixtures, effects, mover presets, generator config
4. Call `sequenceGenerator.generateSequence({...})`
5. Create or update sequence record (`db.createSequence()` or `db.updateSequence()`)
6. Bulk insert cues (`db.bulkUpdateCues()`)
7. Return sequence with cue count

### Batch Generate (lines 185–270)

`POST /api/sequences/generate-batch`:

- Accepts `{trackIds, palette, genre}` 
- **Analysis phase**: CONCURRENCY=4 parallel `audioAnalyzer.analyzeTrack()` calls
- **Generation phase**: Serial DB writes (avoids SQLite contention)
- Broadcasts progress via WebSocket: `{type: 'seq_batch_progress', current, total, trackTitle}`
- Broadcasts completion: `{type: 'seq_batch_complete', generated, failed, total}`

---

## 7. Frontend Sequencer UI

**File**: `public/js/sequencer.js` (1485 lines) — IIFE module `SEQ`

### HTML Structure (`sequencer.html`, 216 lines)

Three-column layout:
- **Left sidebar** (260px): Sequence list (virtual scroll), sequence info (BPM, duration, cue count, deck selector), fixture chips, rig selector
- **Center**: Transport bar (Stop/Play/Pause + time display), edit mode toggle, output pill, blackout button. Below: zoom/snap toolbar, canvas timeline with ruler, fixture lanes, playhead
- **Right panel** (280px): Cue properties (type, start, duration, label, color picker, effect dropdown, mover preset dropdown, per-channel sliders)
- **Modal**: Generate dialog (palette + genre selectors, progress bar)

### CSS Architecture (`sequencer.css`)

Dark theme using CSS custom properties:
```css
--bg: #0a0a0f          --accent: #e94560
--surface: #1e1e2c     --green: #00e676
--border: #2a2a40      --text: #e8e8ee
--sidebar-w: 260px     --props-w: 280px
--topbar-h: 52px       --toolbar-h: 40px
```

### State Management (lines 9–47)

All state is held in the `SEQ` IIFE closure:

```javascript
let sequences = [];         // all sequence records
let currentId = null;       // selected sequence ID
let currentSeq = null;      // current sequence object
let cues = [];              // lightweight cue array for current sequence
let fixtures = [];          // from /api/fixtures
let effects = [];           // from /api/effects
let moverPresets = [];      // from /api/mover-presets
let activeLanes = [];       // ordered lane objects for rendering
let expandedFixtures = {};  // {fixtureId: true} for expanded multi-cell view
let zoomPxPerSec = 5;       // timeline zoom level (px per second)
let snapBeats = 4;          // snap grid (4=bar, 1=beat, 0.5=half, 0.25=quarter, 0=off)
let deck = 1;               // current deck number
let playheadMs = 0;         // current playhead position
let isPlaying = false;
let selectedIds = new Set(); // selected cue IDs
let selectedPrimary = null;  // primary selection for properties panel
let clipboard = [];          // copied cues for paste
let wfTrackId = null;       // loaded waveform track ID
let wfData = null;          // WaveformData instance
let wfAnalysis = null;      // analysis data for section backgrounds
let editMode = false;       // live DMX preview mode
let dmxOutputOn = false;
```

### WebSocket Connection (lines 111–175)

Connects to `ws://hostname:port`, with auto-reconnect on close.

**Inbound message handlers**:

| Type | Action |
|---|---|
| `state` | Updates connection status display |
| `seq_loaded` | If matches current deck: loads sequence, fetches lightweight cues, loads waveform, enables timeline canvas |
| `seq_unloaded` | If matches current deck: clears timeline |
| `seq_playing` | Updates `isPlaying`, starts/stops playhead animation |
| `seq_time` | Updates `playheadMs`, redraws playhead (throttled via `_pendingTime`) |
| `dmxOutput` | Updates output pill indicator |
| `seq_batch_progress` | Updates generate modal progress bar |
| `seq_batch_complete` | Refreshes sequence list |

**Noise filter**: Ignores `server_log`, `beat`, `touch_*` message types.

### Virtual Scroll Sequence List (lines 260–330)

- `SEQ_ROW_H = 30` pixels per row, `SEQ_BUFFER = 10` extra rows
- `paintVisibleSeqs()`: calculates visible range from scroll position, renders only visible rows as absolute-positioned divs
- Supports search filtering via `#seqSearch` input

### Timeline Rendering Pipeline

#### Lane Building — `buildLaneList()` (lines 400–500)

Sorts fixtures into lanes:
- Single-channel fixtures: 1 lane
- Movers: 2 lanes (Light + Move)
- Multi-cell fixtures: 1 collapsed lane OR n+1 expanded lanes (master + per-cell)

Sets CSS custom properties `--beat-px` and `--bar-px` for grid alignment.

#### Cue Viewport Virtualization (lines 507–600)

**`buildCueIndex()`**: Creates `_cuesByKey` Map keyed by `"fixtureId:lane"`, with cues sorted by `start_ms` for binary search of visible range.

**`_mergeCollapsed()`**: When a multi-cell fixture is collapsed, merges overlapping per-cell cues into unified visual blocks.

**Rendering**: Only cues within the visible scroll viewport are rendered as positioned/colored div elements.

#### Waveform Rendering (lines 730–830)

- Loads analysis from `/api/tracks/:id/analysis`
- Parses waveform peaks via `WaveformData` library
- Renders three frequency bands as colored fills:
  - Bass (low): warm color
  - Mid: medium color
  - Treble (high): bright color
- Section backgrounds rendered as colored rectangles behind the waveform with labels

### Properties Panel (lines 840–930)

When a cue is selected:
- Shows: cue_type dropdown, start_ms / duration_ms inputs, label text, color picker
- Effect dropdown: populated from `/api/effects`
- Mover preset dropdown: shown only when `cue_type === 'movement'`
- **Channel sliders**: dynamically generated per-channel with start/end value controls (based on fixture's channel types)
- Apply button: PUTs updated cue to server, triggers `preview_refresh` in edit mode

### Edit Mode (lines 1080–1110)

**`toggleEditMode()`**:
1. Enables DMX output (`POST /api/dmx/enable`)
2. Sends `preview_load` (sequence loaded for preview without auto-play)
3. Sends `preview_seek` to current playhead position
4. `previewAtPlayhead()` and `previewRefresh()` keep DMX output in sync with edits

### Transport Controls (lines 1120–1160)

| Button | Normal Mode | Edit Mode |
|---|---|---|
| Play | `load` + `play` sequence commands | `preview_load` + `play` |
| Pause | `pause` | `pause` |
| Stop | `pause` + seek to 0 | `pause` + seek to 0 |

### Mouse/Keyboard Interaction (lines 1160–1460)

**Mouse**:
- Double-click on lane → create new cue at that position
- Click cue → select (shift-click for multi-select)
- Drag cue → move (snaps to beat grid)
- Drag cue edge → resize
- Marquee selection (click + drag on empty area)
- Playhead drag → seek (sends `preview_seek` in edit mode)

**Keyboard shortcuts**:
- `Ctrl+A` — select all visible cues
- `Delete` — delete selected cues
- `Ctrl+C` — copy selected cues
- `Ctrl+V` — paste at playhead position
- `Escape` — deselect all
- `Arrow Left/Right` — nudge selected cues by snap amount

---

## 8. Integration Points

### OS2L / VirtualDJ Integration

**File**: `server.js` (lines ~100–380) + `os2l.js`

OS2L is a TCP protocol for DJ software integration. The server advertises via Bonjour/mDNS.

**`handleOs2lSubscribed()`** (line ~120): Called on every OS2L state message from VDJ.

**State tracked per deck** (`state.decks[1-4]`):
```javascript
{
  filepath, level, time, beatpos, firstbeat, bpm, play, loop
}
```

**Auto-load/generate flow** (lines ~180–310):

```
VDJ sends filepath change for deck N
  │
  ├─ If seq_auto_unload: unload old sequence
  │
  ├─ Lookup track in DB by filepath
  │   ├─ Not found: do nothing
  │   └─ Found:
  │       ├─ If seq_auto_load: check for existing sequence
  │       │   ├─ Exists: load it
  │       │   └─ Not exists + seq_auto_generate:
  │       │       ├─ Auto-analyze track (if needed)
  │       │       ├─ generateSequence()
  │       │       ├─ Create + save sequence + cues
  │       │       └─ Load generated sequence
  │       │
  │       └─ If deck is playing: auto-start sequence playback
  │
  └─ Time sync: VDJ time updates → processSequenceAtTime()
```

**Play/pause sync** (line ~340):
- When VDJ play state changes, sequence play/pause follows
- **Natural end detection**: if track time is within 5000ms of end AND deck pauses, treats as natural end → applies end action
- Manual pause: just pauses sequence without end action

### Art-Net Output

**File**: `artnet-server.js` + `artnet-worker.js`

- Worker thread sends Art-Net DMX512 packets over UDP
- `artnetServer.setChannels(universe, [{ch, val}])` — primary output method
- Universe mapping configured in DB (`artnet_universes` table)
- Refresh rate configurable (default 44 Hz from config)

### DMX USB Output

**File**: `dmx-usb-server.js` + `dmx-usb-worker.js`

- Uses FTDI D2XX library for direct USB-to-DMX adapters
- Worker thread per device
- `dmxUsbServer.setChannels(universe, [{ch, val}])` — same interface as Art-Net
- Auto-connect on startup for enabled devices
- Per-device refresh rate configuration

### Dual Output

All DMX output in the codebase is sent to **both** backends simultaneously:
```javascript
artnetServer.setChannels(+u, channels);
dmxUsbServer.setChannels(+u, channels);
```
This allows hybrid setups (some fixtures on Art-Net, others on USB) with the universe number determining which physical output actually processes each fixture.

### WebSocket State Broadcast

**`broadcast(msg)`** (line ~88): Sends JSON to all connected WebSocket clients.

Key broadcast messages:

| Type | Data | When |
|---|---|---|
| `state` | Full deck state | On initial WS connection, on OS2L state changes |
| `seq_loaded` | `{deck, sequence}` | Sequence loaded onto a deck |
| `seq_unloaded` | `{deck}` | Sequence removed from deck |
| `seq_playing` | `{deck, playing}` | Playback started/stopped |
| `seq_time` | `{deck, timeMs}` | Playhead position (~15 Hz throttled) |
| `dmxOutput` | `{enabled}` | DMX output toggled |
| `seq_batch_progress` | `{current, total, trackTitle}` | Batch generation progress |
| `seq_batch_complete` | `{generated, failed, total}` | Batch generation done |
| `scene_activated` | `{sceneId, sceneName}` | Static scene activated |
| `scene_deactivated` | — | Static scene deactivated |

---

## Appendix: Data Flow Diagram — Full Sequence Lifecycle

```
  ┌─────────────────────────────────────────────────────────────┐
  │                                                             │
  │                    GENERATION PHASE                         │
  │                                                             │
  │  Track (DB) ──┐                                             │
  │               ├──▶ audioAnalyzer.analyzeTrack()             │
  │  Filepath ────┘         │                                    │
  │                         ▼                                    │
  │              track_analysis (DB)                              │
  │              {beats, sections, energy, waveform}              │
  │                         │                                    │
  │  Fixtures (DB) ────┐    │                                    │
  │  Effects (DB) ─────┤    │                                    │
  │  Presets (DB) ─────┤    │                                    │
  │  GenConfig (DB) ───┤    │                                    │
  │  Palette/Genre ────┘    │                                    │
  │                    │    │                                    │
  │                    ▼    ▼                                    │
  │            generateSequence()                                │
  │            ├─ generateSectionBased()                         │
  │            ├─ generateColorWheelCues()                       │
  │            ├─ generateMoverMovement()                        │
  │            ├─ generateEffectCues()                           │
  │            ├─ generateMultiCellPatterns()                    │
  │            └─ resolveMultiCellConflicts()                    │
  │                         │                                    │
  │                         ▼                                    │
  │              light_sequences (DB)                             │
  │              sequence_cues (DB)                               │
  │                                                              │
  └──────────────────────────┬──────────────────────────────────┘
                             │
  ┌──────────────────────────▼──────────────────────────────────┐
  │                                                             │
  │                    PLAYBACK PHASE                            │
  │                                                             │
  │  handleSequenceCommand('load')                               │
  │         │                                                    │
  │         ▼                                                    │
  │  activeSequences[deck] = {sequence, cues, ...}              │
  │         │                                                    │
  │         ├───── VDJ time sync ────▶ processSequenceAtTime()  │
  │         │      (OS2L 'time')       OR                        │
  │         ├───── Standalone timer ──▶ processSequenceAtTime()  │
  │         │      (25ms interval)                               │
  │         │                                                    │
  │         ▼                                                    │
  │  processSequenceAtTime(deck, timeMs)                        │
  │         │                                                    │
  │         ├── Find active cues at timeMs                       │
  │         ├── For each cue:                                    │
  │         │    ├── Resolve channel values (static/fade/        │
  │         │    │   strobe/effect/movement)                     │
  │         │    ├── Apply deckLevel dimmer                      │
  │         │    ├── Apply masterDimmer (smart)                  │
  │         │    ├── mapValueToRange()                           │
  │         │    └── applyInvert()                               │
  │         │                                                    │
  │         ▼                                                    │
  │  artnetServer.setChannels()                                  │
  │  dmxUsbServer.setChannels()                                  │
  │         │                                                    │
  │         ▼                                                    │
  │  Physical DMX fixtures                                       │
  │                                                              │
  └─────────────────────────────────────────────────────────────┘
```
