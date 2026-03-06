/**
 * Group Coordination Utilities
 *
 * Builds a group map from fixtures and provides coordination strategies
 * for synchronized or contrasting behaviour within fixture groups.
 *
 * Coordination modes:
 *   - sync:     all fixtures in the group do the same thing simultaneously
 *   - mirror:   fixtures split left/right and move in opposite directions
 *   - fan:      fixtures spread from center outward (or inward)
 *   - cascade:  fixtures stagger timing across the group in rig order
 *   - opposite: even/odd fixtures alternate colour or position
 */

// ─── Coordination modes for movement ────────────────────────────────────────

const COORD_MODES = ['sync', 'mirror', 'fan', 'cascade', 'opposite'];

/**
 * Build a map of group_id → sorted fixture list.
 * Fixtures are sorted by rig_order → rig_x → id so positional strategies work.
 *
 * @param {Array} fixtures - Full fixture channel map (with group_ids[])
 * @returns {Map<number, Array>} groupId → [fixture, ...]
 */
function buildGroupMap(fixtures) {
  const groupMap = new Map();
  for (const fix of fixtures) {
    if (!fix.group_ids || !fix.group_ids.length) continue;
    for (const gid of fix.group_ids) {
      if (!groupMap.has(gid)) groupMap.set(gid, []);
      groupMap.get(gid).push(fix);
    }
  }
  // Sort each group spatially
  for (const [, members] of groupMap) {
    members.sort((a, b) => {
      if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
      if ((a.rig_x || 0.5) !== (b.rig_x || 0.5)) return (a.rig_x || 0.5) - (b.rig_x || 0.5);
      return a.id - b.id;
    });
  }
  return groupMap;
}

/**
 * For a given fixture, find which group (if any) it belongs to and
 * return the group members and the fixture's index within that group.
 *
 * If the fixture belongs to multiple groups, the first one with >1 member
 * of the given filter set is returned (practical heuristic).
 *
 * @param {object} fix - Fixture object
 * @param {Map} groupMap - From buildGroupMap
 * @param {Set} [filterIds] - Only consider members in this set (e.g. mover IDs)
 * @returns {{ groupId, members, index, count } | null}
 */
function getFixtureGroup(fix, groupMap, filterIds) {
  if (!fix.group_ids || !fix.group_ids.length) return null;
  for (const gid of fix.group_ids) {
    const members = groupMap.get(gid);
    if (!members || members.length < 2) continue;
    const filtered = filterIds ? members.filter(m => filterIds.has(m.id)) : members;
    if (filtered.length < 2) continue;
    const index = filtered.findIndex(m => m.id === fix.id);
    if (index < 0) continue;
    return { groupId: gid, members: filtered, index, count: filtered.length };
  }
  return null;
}

/**
 * Pick a coordination mode for a section based on section energy.
 *
 * @param {string} sectionLabel - verse, chorus, drop, etc.
 * @param {function} rand - Seeded random function
 * @returns {string} One of COORD_MODES
 */
function pickCoordMode(sectionLabel, rand) {
  // Calm sections → sync or mirror; energetic → anything
  const weights = {
    intro:     { sync: 0.6, mirror: 0.3, fan: 0.0, cascade: 0.1, opposite: 0.0 },
    verse:     { sync: 0.4, mirror: 0.3, fan: 0.1, cascade: 0.1, opposite: 0.1 },
    chorus:    { sync: 0.2, mirror: 0.3, fan: 0.15, cascade: 0.15, opposite: 0.2 },
    bridge:    { sync: 0.4, mirror: 0.3, fan: 0.1, cascade: 0.1, opposite: 0.1 },
    breakdown: { sync: 0.5, mirror: 0.3, fan: 0.1, cascade: 0.1, opposite: 0.0 },
    buildup:   { sync: 0.2, mirror: 0.2, fan: 0.2, cascade: 0.3, opposite: 0.1 },
    drop:      { sync: 0.15, mirror: 0.25, fan: 0.2, cascade: 0.15, opposite: 0.25 },
    outro:     { sync: 0.6, mirror: 0.2, fan: 0.1, cascade: 0.1, opposite: 0.0 },
  };
  const w = weights[sectionLabel] || weights.verse;
  const r = rand();
  let cumul = 0;
  for (const mode of COORD_MODES) {
    cumul += w[mode] || 0;
    if (r < cumul) return mode;
  }
  return 'sync';
}

/**
 * Compute a preset index offset for a grouped mover fixture.
 *
 * Given a list of preset IDs and a coordination mode, returns which
 * preset index this particular fixture should start on within the cycle.
 *
 * @param {object} groupInfo - { index, count, members } from getFixtureGroup
 * @param {string} coordMode - sync, mirror, fan, cascade, opposite
 * @param {number} presetCount - Number of available presets
 * @param {number} [baseIndex=0] - The base preset index for the cue
 * @returns {number} Adjusted preset starting index (0-based into presetIds)
 */
function getPresetOffset(groupInfo, coordMode, presetCount, baseIndex) {
  if (!groupInfo || presetCount <= 1) return baseIndex || 0;
  const { index, count } = groupInfo;
  const base = baseIndex || 0;

  switch (coordMode) {
    case 'sync':
      // All fixtures same preset
      return base;

    case 'mirror': {
      // Left half normal order, right half reversed
      const mid = Math.floor(count / 2);
      if (index < mid) return base;
      const mirrorIdx = count - 1 - index;
      const offset = (base + (index - mirrorIdx)) % presetCount;
      return (offset + presetCount) % presetCount;
    }

    case 'fan': {
      // Center fixture at base, others spread out progressively
      const center = (count - 1) / 2;
      const dist = Math.abs(index - center);
      const maxDist = center || 1;
      const spread = Math.round((dist / maxDist) * Math.floor(presetCount / 2));
      return (base + spread) % presetCount;
    }

    case 'cascade': {
      // Each fixture offsets by one preset from the previous
      return (base + index) % presetCount;
    }

    case 'opposite': {
      // Even fixtures at base, odd at base + half cycle
      const half = Math.max(1, Math.floor(presetCount / 2));
      return index % 2 === 0 ? base : (base + half) % presetCount;
    }

    default:
      return base;
  }
}

/**
 * Compute a timing offset (ms) for cascade coordination.
 * Creates a stagger effect across the group.
 *
 * @param {object} groupInfo - { index, count }
 * @param {string} coordMode - Only 'cascade' produces non-zero offsets
 * @param {number} spreadMs - Total spread time across the group
 * @returns {number} Offset in ms
 */
function getTimingOffset(groupInfo, coordMode, spreadMs) {
  if (!groupInfo || coordMode !== 'cascade') return 0;
  const { index, count } = groupInfo;
  if (count <= 1) return 0;
  return Math.round((index / (count - 1)) * spreadMs);
}

/**
 * Compute a palette index adjustment for grouped color fixtures.
 * Ensures group members use coordinated (not random) colors.
 *
 * @param {object} groupInfo - { index, count }
 * @param {string} coordMode - sync, mirror, opposite, etc.
 * @param {number} basePaletteIdx - The palette index chosen for this cue
 * @param {number} paletteCount - Total available palettes
 * @returns {number} Adjusted palette index
 */
function getColorOffset(groupInfo, coordMode, basePaletteIdx, paletteCount) {
  if (!groupInfo || paletteCount <= 1) return basePaletteIdx;
  const { index, count } = groupInfo;

  switch (coordMode) {
    case 'sync':
      // All same color
      return basePaletteIdx;

    case 'mirror': {
      // Mirror colors: left & right match
      const mid = Math.floor(count / 2);
      const mirrorIndex = index < mid ? index : count - 1 - index;
      return (basePaletteIdx + mirrorIndex) % paletteCount;
    }

    case 'opposite':
      // Alternate between two palette entries
      return index % 2 === 0 ? basePaletteIdx : (basePaletteIdx + 1) % paletteCount;

    case 'fan': {
      // Spread from center
      const center = (count - 1) / 2;
      const dist = Math.abs(index - center);
      const steps = Math.round(dist);
      return (basePaletteIdx + steps) % paletteCount;
    }

    case 'cascade':
      // Each fixture one palette step ahead
      return (basePaletteIdx + index) % paletteCount;

    default:
      return basePaletteIdx;
  }
}

module.exports = {
  COORD_MODES,
  buildGroupMap,
  getFixtureGroup,
  pickCoordMode,
  getPresetOffset,
  getTimingOffset,
  getColorOffset,
};
