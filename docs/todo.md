# DMX Controller — TODO

## Config Screen Overhaul
- [ ] Consolidate config tabs — too many tabs currently, group related settings together
- [ ] Consider collapsible sections or a sidebar nav instead of horizontal tabs
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
- [ ] Visual waveform-aligned cue editing (drag to resize, snap to waveform peaks)
- [ ] Undo/redo in edit mode
- [ ] Copy/paste cues between fixtures and sequences
- [ ] Color wheel transition effects (half-color positions, split colors)
- [x] User-editable genre palettes and section styles from the UI
- [x] Sequence templates — save generation settings as reusable presets
- [x] improve audio section identifactions
- [x] fluid beatgrid implementation for songs with changing tempos
- [ ] look into stems for splitting songs into seprate sections to aid in sequence generation

## Edit Mode Completion
- [ ] Channel slider live preview (send DMX values while dragging in edit mode)
- [ ] Full end-to-end testing of preview system
- [ ] Multi-cue drag selection on timeline
- [ ] Keyboard shortcuts for common edit operations

## General
- [ ] Consolidate duplicate code between touch.html and touch2.html
- [ ] Add error handling / reconnect logic for WebSocket disconnects
- [ ] Database backup/restore from UI
- [ ] Export/import fixture types as JSON files
- [ ] Performance profiling for large sequences (1000+ cues)
- [x] Change server to be hosted on port 80 instead of 3000 
