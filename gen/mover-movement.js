/**
 * Mover Movement Generation
 *
 * Generates movement cues for pan/tilt fixtures using saved mover presets.
 * Section-aware timing: energetic sections get faster cycling, calm sections
 * get slower sweeps. Speed and gobo channels are set directly.
 */

const MOVEMENT_STYLES = {
  intro:     { barsPerMove: 4,   range: 0.4, speed: 'slow' },
  verse:     { barsPerMove: 2,   range: 0.5, speed: 'medium' },
  chorus:    { barsPerMove: 1,   range: 0.8, speed: 'fast' },
  bridge:    { barsPerMove: 2,   range: 0.5, speed: 'medium' },
  breakdown: { barsPerMove: 4,   range: 0.3, speed: 'slow' },
  buildup:   { barsPerMove: 0.5, range: 0.8, speed: 'fast' },
  drop:      { barsPerMove: 0.5, range: 1.0, speed: 'fast' },
  outro:     { barsPerMove: 4,   range: 0.3, speed: 'slow' },
};
const DEFAULT_MOVEMENT = { barsPerMove: 2, range: 0.5, speed: 'medium' };

// Speed channel DMX values — most movers use 0 = fastest, 255 = slowest
const SPEED_DMX = { slow: 200, medium: 140, fast: 40 };

/**
 * Generate mover movement cues that reference saved mover presets by ID.
 * Instead of embedding explicit pan/tilt values, each cue stores the preset
 * IDs to cycle through. At playback the engine looks up current preset
 * positions, so changing presets per-venue updates all sequences automatically.
 */
function generateMoverMovement(cues, movers, sections, beats, ctx, moverPresets) {
  const { barMs, beatMs, rand, preset, durationMs, snapBar, bpmFactor } = ctx;

  if (!moverPresets || moverPresets.length === 0) return;

  const presetIds = moverPresets.map(p => p.id);
  const useSections = sections && sections.length > 0;

  for (let mi = 0; mi < movers.length; mi++) {
    const fix = movers[mi];
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : mi;
    const hasGobo = fix.channels.some(ch => ch.type === 'gobo');
    const hasSpeed = fix.channels.some(ch => ch.type === 'speed');

    if (useSections) {
      const MOVE_DENSITY = {
        intro: 0.4, verse: 0.45, chorus: 0.7, bridge: 0.5,
        breakdown: 0.25, buildup: 0.3, drop: 0.8, outro: 0.3,
      };

      const followedByDrop = sections.map((sec, i) => {
        const next = sections[i + 1];
        return next && next.label === 'drop';
      });

      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const activeMovStyles = ctx.activeMovementStyles || MOVEMENT_STYLES;
        const activeSpd = ctx.activeSpeedDmx || SPEED_DMX;
        const style = activeMovStyles[sec.label] || DEFAULT_MOVEMENT;
        const secStartMs = si === 0 ? 0 : snapBar(Math.round(sec.start_ms));
        const secEndMs = si === sections.length - 1 ? Math.round(durationMs) : Math.round(sec.end_ms);
        const secDurMs = secEndMs - secStartMs;
        if (secDurMs <= 0) continue;

        const chunkBars = Math.max(1, Math.round(style.barsPerMove * 2));
        const chunkMs = chunkBars * barMs;
        const numChunks = Math.max(1, Math.floor(secDurMs / chunkMs));
        const baseDensity = MOVE_DENSITY[sec.label] || 0.5;

        for (let ci = 0; ci < numChunks; ci++) {
          const chunkStart = secStartMs + ci * chunkMs;
          const chunkEnd = ci < numChunks - 1
            ? chunkStart + chunkMs
            : secEndMs;
          const chunkDur = chunkEnd - chunkStart;
          if (chunkDur <= 0) continue;

          let density = baseDensity;
          if (sec.label === 'buildup' && numChunks > 1) {
            const progress = ci / (numChunks - 1);
            const ceiling = followedByDrop[si] ? 0.9 : 0.6;
            density = baseDensity + (ceiling - baseDensity) * progress;
          }

          const forceMove = ci === 0 && (sec.label === 'chorus' || sec.label === 'drop');
          if (!forceMove && rand() >= density) continue;

          const chVals = { mover_preset_ids: presetIds };

          if (hasSpeed) {
            const baseSpeedDmx = activeSpd[style.speed] || activeSpd.medium;
            const bpmSpeedBoost = Math.round(baseSpeedDmx * (1 - bpmFactor * 0.3));
            chVals.speed = Math.max(0, bpmSpeedBoost);
          }

          if (hasGobo && (sec.label === 'chorus' || sec.label === 'drop'
              || (sec.label === 'buildup' && bpmFactor > 0.5))) {
            chVals.gobo = Math.floor(rand() * 8) * 16;
          }

          cues.push({
            lane,
            start_ms: Math.round(chunkStart),
            duration_ms: Math.round(chunkDur),
            cue_type: 'movement',
            fixture_id: fix.id,
            channel_values: chVals,
            color: '#4488ff',
            label: 'move',
          });
        }
      }
    } else {
      const chVals = { mover_preset_ids: presetIds };

      if (hasSpeed) {
        chVals.speed = Math.max(0, Math.round(SPEED_DMX.medium * (1 - bpmFactor * 0.3)));
      }

      cues.push({
        lane,
        start_ms: 0,
        duration_ms: Math.round(durationMs),
        cue_type: 'movement',
        fixture_id: fix.id,
        channel_values: chVals,
        color: '#4488ff',
        label: 'move',
      });
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

module.exports = { MOVEMENT_STYLES, DEFAULT_MOVEMENT, SPEED_DMX, generateMoverMovement };
