/** Channel context for effects-engine (mirrors server buildChannelCtx). */

function interpolateAlongPath(waypoints, t) {
  if (!waypoints || waypoints.length === 0) return null;
  if (waypoints.length === 1) return waypoints[0];
  const lens = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].x - waypoints[i - 1].x;
    const dy = waypoints[i].y - waypoints[i - 1].y;
    const dz = (waypoints[i].z || 0) - (waypoints[i - 1].z || 0);
    lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy + dz * dz));
  }
  const total = lens[lens.length - 1];
  if (total === 0) return waypoints[0];
  const target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < waypoints.length; i++) {
    if (target <= lens[i]) {
      const frac = (target - lens[i - 1]) / (lens[i] - lens[i - 1]);
      const a = waypoints[i - 1];
      const b = waypoints[i];
      return {
        x: a.x + (b.x - a.x) * frac,
        y: a.y + (b.y - a.y) * frac,
        z: (a.z || 0) + ((b.z || 0) - (a.z || 0)) * frac,
      };
    }
  }
  return waypoints[waypoints.length - 1];
}

function buildChannelCtx(ch, fix) {
  const ctx = {
    channel_number: ch.channel_number,
    channel_type: ch.type,
    ranges: ch.ranges,
    fixture_id: fix.id,
    total_channels: fix.channels.length,
    home_pan: fix.home_pan ?? 128,
    home_tilt: fix.home_tilt ?? 128,
    _rigPosition: fix.rig_x ?? 0.5,
    _rigPositionY: fix.rig_y ?? 0.5,
    _rigPositionZ: fix.rig_z ?? 0.5,
    _rigOrder: fix.rig_order ?? 0,
  };
  if (fix.cell_count > 0) {
    ctx.cell_count = fix.cell_count;
    ctx.cell_rows = fix.cell_rows || 1;
    ctx.cell_cols = fix.cell_cols || fix.cell_count;
    ctx.cell = ch.cell || null;
    ctx.channel_name = ch.name || '';
    if (ch.cell) {
      const cellChannels = fix.channels.filter((c) => c.cell === ch.cell);
      ctx.cell_channel_index = cellChannels.indexOf(ch);
      if (ctx.cell_channel_index === -1) {
        ctx.cell_channel_index = cellChannels.findIndex((c) => c.channel_number === ch.channel_number);
      }
      if (fix.cell_path && fix.cell_path.length > 0) {
        const startPt = { x: fix.rig_x ?? 0.5, y: fix.rig_y ?? 0.5, z: fix.rig_z ?? 0.5 };
        const waypoints = [startPt, ...fix.cell_path];
        const cellIdx = ch.cell - 1;
        const t = fix.cell_count > 1 ? cellIdx / (fix.cell_count - 1) : 0;
        const pos = interpolateAlongPath(waypoints, t);
        if (pos) {
          ctx._rigPosition = pos.x;
          ctx._rigPositionY = pos.y;
          ctx._rigPositionZ = pos.z;
        }
      }
    }
  }
  return ctx;
}

module.exports = { buildChannelCtx };
