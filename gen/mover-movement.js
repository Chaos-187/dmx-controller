/**
 * Mover Movement Generation
 *
 * Generates movement cues for pan/tilt fixtures using saved mover presets.
 * Section-aware timing: energetic sections get faster cycling, calm sections
 * get slower sweeps. Speed and gobo channels are set directly.
 *
 * Group-aware: movers in the same fixture group coordinate their movement
 * using sync, mirror, fan, cascade, or opposite patterns.
 */

const { getFixtureGroup, pickCoordMode, getPresetOffset, getTimingOffset } = require('./group-coordination');
const { walkBeats } = require('./helpers');

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
  const groupMap = ctx.groupMap;

  if (!moverPresets || moverPresets.length === 0) return;

  // Slow-BPM scaling: below 100 BPM, stretch timing and use slower motor speeds
  const bpm = ctx.bpm || 120;
  const slowFactor = bpm < 100 ? 1 + (100 - bpm) / 50 : 1; // e.g. 80 BPM → 1.4×, 60 BPM → 1.8×

  const presetIds = moverPresets.map(p => p.id);
  const useSections = sections && sections.length > 0;

  // Build a set of all mover IDs so group filtering works
  const moverIdSet = new Set(movers.map(m => m.id));

  // ── Pre-compute group info for every mover ────────────────────────
  // Each mover gets its groupInfo (members, index, count) and a per-section
  // coordination mode that is the SAME for all movers in the group.
  const moverGroupInfo = new Map();
  const sectionCoordModes = new Map(); // `${groupId}-${si}` → mode

  for (const fix of movers) {
    const gi = groupMap ? getFixtureGroup(fix, groupMap, moverIdSet) : null;
    moverGroupInfo.set(fix.id, gi);
  }

  for (let mi = 0; mi < movers.length; mi++) {
    const fix = movers[mi];
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : mi;
    const hasGobo = fix.channels.some(ch => ch.type === 'gobo');
    const hasSpeed = fix.channels.some(ch => ch.type === 'speed');
    const gi = moverGroupInfo.get(fix.id);

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

        // ── Pick coordination mode per group+section (stable for all members) ──
        let coordMode = 'sync';
        if (gi) {
          const key = `${gi.groupId}-${si}`;
          if (!sectionCoordModes.has(key)) {
            sectionCoordModes.set(key, pickCoordMode(sec.label, rand));
          }
          coordMode = sectionCoordModes.get(key);
        }

        const chunkBars = Math.max(1, Math.round(style.barsPerMove * 2 * slowFactor));
        const chunkMs = chunkBars * barMs;
        const chunkBeats = chunkBars * 4;
        const numChunks = Math.max(1, Math.floor(secDurMs / chunkMs));
        const baseDensity = MOVE_DENSITY[sec.label] || 0.5;

        for (let ci = 0; ci < numChunks; ci++) {
          const chunkStart = ci === 0 ? secStartMs : walkBeats(secStartMs, ci * chunkBeats, ctx.beats, beatMs);
          const chunkEnd = ci < numChunks - 1
            ? walkBeats(secStartMs, (ci + 1) * chunkBeats, ctx.beats, beatMs)
            : secEndMs;
          const chunkDur = chunkEnd - chunkStart;
          if (chunkDur <= 0) continue;

          let density = baseDensity;
          if (sec.label === 'buildup' && numChunks > 1) {
            const progress = ci / (numChunks - 1);
            const ceiling = followedByDrop[si] ? 0.9 : 0.6;
            density = baseDensity + (ceiling - baseDensity) * progress;
          }

          // ── Group-aware move decision ──
          // For grouped movers, the "should this chunk move?" decision is
          // made once (by the first member) and all members follow suit.
          const forceMove = ci === 0 && (sec.label === 'chorus' || sec.label === 'drop');
          let shouldMove;
          if (gi) {
            // Use group-stable seed so all members get the same roll
            const groupRollKey = `mv-${gi.groupId}-${si}-${ci}`;
            const stableRand = seededSingleRoll(groupRollKey, ctx);
            shouldMove = forceMove || stableRand < density;
          } else {
            shouldMove = forceMove || rand() < density;
          }
          if (!shouldMove) continue;

          // ── Group-coordinated preset ordering ──
          const basePresetIdx = Math.floor(rand() * presetIds.length);
          const adjustedIdx = gi
            ? getPresetOffset(gi, coordMode, presetIds.length, basePresetIdx)
            : basePresetIdx;

          // Reorder presets starting from the adjusted index
          const coordPresetIds = [
            ...presetIds.slice(adjustedIdx),
            ...presetIds.slice(0, adjustedIdx),
          ];

          // Pick a single preset for this cue
          const pickedPresetId = coordPresetIds[0];
          const chVals = { mover_preset_id: pickedPresetId };

          if (hasSpeed) {
            const baseSpeedDmx = activeSpd[style.speed] || activeSpd.medium;
            const bpmSpeedBoost = Math.round(baseSpeedDmx * (1 - bpmFactor * 0.3));
            // Slow BPM: push speed toward slower end (higher DMX)
            chVals.speed = Math.min(255, Math.max(0, Math.round(bpmSpeedBoost * slowFactor)));
          }

          if (hasGobo && (sec.label === 'chorus' || sec.label === 'drop'
              || (sec.label === 'buildup' && bpmFactor > 0.5))) {
            chVals.gobo = Math.floor(rand() * 8) * 16;
          }

          // ── Group-coordinated timing offset (cascade mode) ──
          const cascadeSpreadMs = Math.min(beatMs * 0.5, chunkDur * 0.3);
          const timingOffset = gi
            ? getTimingOffset(gi, coordMode, cascadeSpreadMs)
            : 0;

          cues.push({
            lane,
            start_ms: Math.round(chunkStart) + timingOffset,
            duration_ms: Math.max(Math.round(barMs * 0.5), Math.round(chunkDur) - timingOffset),
            cue_type: 'movement',
            fixture_id: fix.id,
            track: 'move',
            channel_values: chVals,
            color: '#4488ff',
            label: 'move',
          });
        }
      }
    } else {
      const coordPresetIds = gi
        ? (() => {
            const offset = getPresetOffset(gi, 'cascade', presetIds.length, 0);
            return [...presetIds.slice(offset), ...presetIds.slice(0, offset)];
          })()
        : presetIds;
      const pickedPresetId = coordPresetIds[0];
      const chVals = { mover_preset_id: pickedPresetId };

      if (hasSpeed) {
        chVals.speed = Math.min(255, Math.max(0, Math.round(SPEED_DMX.medium * (1 - bpmFactor * 0.3) * slowFactor)));
      }

      cues.push({
        lane,
        start_ms: 0,
        duration_ms: Math.round(durationMs),
        cue_type: 'movement',
        fixture_id: fix.id,
        track: 'move',
        channel_values: chVals,
        color: '#4488ff',
        label: 'move',
      });
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

/**
 * Produce a stable random value for a given key so all group members
 * get the same result. Uses a simple hash to derive a 0-1 float.
 */
function seededSingleRoll(key, ctx) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  // Mix with generator seed for song-specific variation
  h = ((h * 2654435761) >>> 0) / 4294967296;
  return h;
}

module.exports = { MOVEMENT_STYLES, DEFAULT_MOVEMENT, SPEED_DMX, generateMoverMovement };
