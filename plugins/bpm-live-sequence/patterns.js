/**
 * BPM live sequence — fixture color output helpers.
 */

const {
  LOOKS,
  computeSoundLook,
  sortedColorFixtures,
} = require('./sound-looks');

const COLOR_TYPES = new Set(['red', 'green', 'blue', 'white', 'amber', 'uv']);

function scaleRgb(r, g, b, dim) {
  const d = Math.max(0, Math.min(255, dim));
  return [
    Math.round((r * d) / 255),
    Math.round((g * d) / 255),
    Math.round((b * d) / 255),
    d,
  ];
}

/** @returns {Map<number, { r, g, b, dim }>} fixtureId -> color */
function computeLook(lookId, params) {
  return computeSoundLook(lookId, params);
}

function fixtureColorsToChannelUpdates(fixtures, fixtureColors) {
  const channelUpdates = {};
  for (const fix of fixtures) {
    const col = fixtureColors.get(fix.id);
    if (!col) continue;
    const u = fix.universe;
    if (!channelUpdates[u]) channelUpdates[u] = {};
    const [r, g, b, dim] = scaleRgb(col.r, col.g, col.b, col.dim);
    for (const ch of fix.channels) {
      if (ch.type === 'red') channelUpdates[u][ch.dmx_address] = r;
      else if (ch.type === 'green') channelUpdates[u][ch.dmx_address] = g;
      else if (ch.type === 'blue') channelUpdates[u][ch.dmx_address] = b;
      else if (ch.type === 'dimmer') channelUpdates[u][ch.dmx_address] = dim;
      else if (ch.type === 'white' && !fix.channels.some((c) => c.type === 'red')) {
        channelUpdates[u][ch.dmx_address] = dim;
      }
    }
  }
  return channelUpdates;
}

module.exports = {
  LOOKS,
  sortedColorFixtures,
  computeLook,
  fixtureColorsToChannelUpdates,
};
