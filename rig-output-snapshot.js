/**
 * Build a compact rig layout + live DMX color snapshot for the output visualizer.
 */

const dmxShadow = require('./dmx-shadow');

const WARM_DIMMER_RGB = [255, 220, 175];

/** @type {object[]|null} */
let _indexSourceMap = null;
/** @type {object[]|null} */
let _fixtureIndex = null;

function invalidateRigOutputSnapshotCache() {
  _indexSourceMap = null;
  _fixtureIndex = null;
}

function buildFixtureIndex(fixtureChannelMap) {
  if (_indexSourceMap === fixtureChannelMap && _fixtureIndex) return _fixtureIndex;
  _indexSourceMap = fixtureChannelMap;
  _fixtureIndex = (fixtureChannelMap || []).map((fix) => {
    const chList = [];
    for (const ch of fix.channels) {
      chList.push({
        type: ch.type,
        cell: ch.cell || null,
        universe: fix.universe,
        addr: ch.dmx_address,
      });
    }
    return {
      fix,
      chList,
      hasPanTilt: chList.some((c) => c.type === 'pan' || c.type === 'pan_fine')
        && chList.some((c) => c.type === 'tilt' || c.type === 'tilt_fine'),
    };
  });
  return _fixtureIndex;
}

function readChannelIndexed(entry, type, cell) {
  for (const ch of entry.chList) {
    if (cell != null) {
      if (ch.cell !== cell) continue;
    } else if (ch.cell != null) {
      continue;
    }
    if (ch.type === type) return dmxShadow.getChannel(ch.universe, ch.addr);
  }
  return null;
}

function readDimmerIndexed(entry, cell) {
  const direct = readChannelIndexed(entry, 'dimmer', cell);
  if (direct != null) return direct;
  for (const ch of entry.chList) {
    if (cell != null && ch.cell !== cell) continue;
    if (cell == null && ch.cell != null) continue;
    if (ch.type.startsWith('dimmer')) return dmxShadow.getChannel(ch.universe, ch.addr);
  }
  return 0;
}

function rgbFromFixtureEntry(entry, cell) {
  const fix = entry.fix;
  let r = readChannelIndexed(entry, 'red', cell);
  let g = readChannelIndexed(entry, 'green', cell);
  let b = readChannelIndexed(entry, 'blue', cell);
  const dimmer = readDimmerIndexed(entry, cell);
  if (r == null && g == null && b == null) {
    if (dimmer > 0) {
      const s = dimmer / 255;
      return {
        r: Math.round(WARM_DIMMER_RGB[0] * s),
        g: Math.round(WARM_DIMMER_RGB[1] * s),
        b: Math.round(WARM_DIMMER_RGB[2] * s),
        dimmer,
      };
    }
    return { r: 0, g: 0, b: 0, dimmer: 0 };
  }
  r = r ?? 0;
  g = g ?? 0;
  b = b ?? 0;
  if (dimmer < 255 && dimmer >= 0) {
    const s = dimmer / 255;
    r = Math.round(r * s);
    g = Math.round(g * s);
    b = Math.round(b * s);
  }
  return { r, g, b, dimmer };
}

function buildRigOutputSnapshot(fixtureChannelMap) {
  const index = buildFixtureIndex(fixtureChannelMap);
  const fixtures = index.map((entry) => {
    const fix = entry.fix;
    const base = {
      id: fix.id,
      name: fix.name,
      category: fix.category,
      rig_x: fix.rig_x ?? 0.5,
      rig_y: fix.rig_y ?? 0.5,
      rig_z: fix.rig_z ?? 0.5,
      cell_path: fix.cell_path || null,
      cell_count: fix.cell_count || 0,
    };
    if (entry.hasPanTilt) {
      base.is_mover = true;
      base.pan = readChannelIndexed(entry, 'pan', null) ?? fix.home_pan ?? 128;
      base.tilt = readChannelIndexed(entry, 'tilt', null) ?? fix.home_tilt ?? 128;
      base.invert_pan = !!fix.invert_pan;
      base.invert_tilt = !!fix.invert_tilt;
    }
    if (fix.cell_count > 0) {
      const cells = [];
      for (let c = 1; c <= fix.cell_count; c++) {
        cells.push({ cell: c, ...rgbFromFixtureEntry(entry, c) });
      }
      base.cells = cells;
      const avg = cells.reduce(
        (acc, cell) => ({ r: acc.r + cell.r, g: acc.g + cell.g, b: acc.b + cell.b, dimmer: Math.max(acc.dimmer, cell.dimmer) }),
        { r: 0, g: 0, b: 0, dimmer: 0 },
      );
      const n = cells.length || 1;
      base.r = Math.round(avg.r / n);
      base.g = Math.round(avg.g / n);
      base.b = Math.round(avg.b / n);
      base.dimmer = avg.dimmer;
    } else {
      Object.assign(base, rgbFromFixtureEntry(entry, null));
    }
    return base;
  });
  return fixtures;
}

module.exports = { buildRigOutputSnapshot, invalidateRigOutputSnapshotCache };
