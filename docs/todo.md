# DMX Controller — TODO

## Config Screen Overhaul
- [x] Consolidate config tabs — merged OS2L Subs+Buttons, Sequencer+Generator, Database+Export/Import, Network into Devices
- [x] Sidebar nav with group headers (Hardware, DJ Integration, Lighting, Sequencer, Touch, Data) — 17 tabs reduced to 13
- [x] Add simple username/password authentication to protect the config screen
- [x] Store credentials hashed in the config table (PBKDF2-SHA512 with salt)
- [x] Add login page that gates access to config API routes
- [x] Session-based auth (Bearer token) so user stays logged in
- [x] Configurable enable/disable auth from App Settings UI

## Touch2 Security
- [x] Add PIN entry screen for touch2 UI
- [x] Configurable PIN stored in config table
- [x] Idle timeout — lock back to PIN screen after configurable inactivity period
- [x] Keep touch controls responsive while locked (no DMX changes until PIN entered)

## Sequencer v2 Improvements
- [x] Refactor sequence-generator.js — file is ~2400 lines, break into modules
- [x] Separate fixture classification, section generation, color wheel, mover movement, effects into individual files
- [ ] Add unit tests for generation functions
- [ ] Support per-fixture intensity curves (not just global section intensity)
- [ ] Multi-deck sequence blending / crossfade between sequences
- [x] Visual waveform-aligned cue editing (drag to resize, snap to waveform peaks)
- [x] Undo/redo in edit mode
- [x] Copy/paste cues between fixtures and sequences (Ctrl+Shift+V for cross-fixture)
- [ ] Color wheel transition effects (half-color positions, split colors)
- [x] User-editable genre palettes and section styles from the UI
- [x] Sequence templates — save generation settings as reusable presets
- [x] improve audio section identifactions
- [x] fluid beatgrid implementation for songs with changing tempos
- [ ] look into stems for splitting songs into seprate sections to aid in sequence generation

## Edit Mode Completion
- [x] Channel slider live preview (send DMX values while dragging in edit mode)
- [ ] Full end-to-end testing of preview system
- [x] Multi-cue drag selection & multi-cue resize on timeline
- [x] Keyboard shortcuts for common edit operations

## General
- [ ] Consolidate duplicate code between touch.html and touch2.html
- [x] Add error handling / reconnect logic for WebSocket disconnects (exponential backoff, state re-sync)
- [x] Database backup/restore from UI
- [ ] Export/import fixture types as JSON files
- [ ] Performance profiling for large sequences (1000+ cues)
- [x] Change server to be hosted on port 80 instead of 3000 
