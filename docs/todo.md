# DMX Controller — TODO

## Config Screen Overhaul
- [ ] Consolidate config tabs — too many tabs currently, group related settings together
- [ ] Consider collapsible sections or a sidebar nav instead of horizontal tabs
- [ ] Add simple username/password authentication to protect the config screen
- [ ] Store credentials hashed in the config table (bcrypt or similar)
- [ ] Add login page that gates access to `/` and all config API routes
- [ ] Session-based auth (cookie or token) so user stays logged in

## Touch2 Security
- [ ] Add PIN entry screen for touch2 UI
- [ ] Configurable PIN stored in config table
- [ ] Idle timeout — lock back to PIN screen after configurable inactivity period
- [ ] Keep touch controls responsive while locked (no DMX changes until PIN entered)

## Sequencer v2 Improvements
- [ ] Refactor sequence-generator.js — file is ~2400 lines, break into modules
- [ ] Separate fixture classification, section generation, color wheel, mover movement, effects into individual files
- [ ] Add unit tests for generation functions
- [ ] Support per-fixture intensity curves (not just global section intensity)
- [ ] Multi-deck sequence blending / crossfade between sequences
- [ ] Visual waveform-aligned cue editing (drag to resize, snap to waveform peaks)
- [ ] Undo/redo in edit mode
- [ ] Copy/paste cues between fixtures and sequences
- [ ] Color wheel transition effects (half-color positions, split colors)
- [ ] User-editable genre palettes and section styles from the UI
- [ ] Sequence templates — save generation settings as reusable presets

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
- [ ] Change server to be hosted on port 80 instead of 3000 
