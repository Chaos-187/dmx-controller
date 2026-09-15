/** Valid visualizer layout IDs (stored in plugin config). */

const VISUAL_MODES = [
  { id: 'studio', label: 'Studio (EQ + waveform)' },
  { id: 'waveform', label: 'Waveform (full screen)' },
  { id: 'eq_full', label: 'EQ bars (large)' },
  { id: 'mirror', label: 'Mirror bars (center)' },
  { id: 'radial', label: 'Radial spectrum' },
  { id: 'scope', label: 'Oscilloscope trace' },
];

const VISUAL_MODE_IDS = new Set(VISUAL_MODES.map((m) => m.id));

function normalizeVisualMode(id) {
  return VISUAL_MODE_IDS.has(id) ? id : 'studio';
}

module.exports = { VISUAL_MODES, VISUAL_MODE_IDS, normalizeVisualMode };
