/**
 * Color-Wheel Cue Generation
 *
 * Generates cues for fixtures that use a physical color wheel (no RGB mixing).
 * Dimmer is boosted since intensity can't be baked into the colour itself.
 * Transitions always snap — interpolating DMX positions sweeps through
 * random physical wheel colours.
 */

const { applyIntensity, findNearestWheelColor, findSplitWheelPosition, getFixtureIntensity, walkBeats } = require('./helpers');
const { sectionStyles, getSectionPalettes } = require('./palettes');
const { getFixtureGroup, pickCoordMode, getColorOffset } = require('./group-coordination');

function generateColorWheelCues(cues, cwFixtures, sections, beats, energyLevels, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBeat, snapBar } = ctx;
  const groupMap = ctx.groupMap;

  const useSections = sections && sections.length > 0;

  // ── Pre-compute group info for color-wheel fixtures ───────────────
  const cwIdSet = new Set(cwFixtures.map(f => f.id));
  const cwGroupInfo = new Map();
  const cwSectionModes = new Map();
  for (const fix of cwFixtures) {
    const gi = groupMap ? getFixtureGroup(fix, groupMap, cwIdSet) : null;
    cwGroupInfo.set(fix.id, gi);
  }

  for (let fiIdx = 0; fiIdx < cwFixtures.length; fiIdx++) {
    const fix = cwFixtures[fiIdx];
    const wheelMap = fix.color_wheel_map;
    if (!wheelMap || wheelMap.length === 0) continue;

    // Find the existing lane for this fixture (from movement cues, if any)
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasStrobe = fix.channels.some(ch => ch.type === 'strobe');

    if (useSections) {
      for (let si = 0; si < sections.length; si++) {
        const sec = sections[si];
        const style = (ctx.activeSectionStyles || {})[sec.label] || { intensity: [0.6, 0.8], cuePerBars: 4 };

        const secStartMs = si === 0 ? 0 : snapBeat(Math.round(sec.start_ms));
        const secEndMs = si === sections.length - 1 ? Math.round(durationMs) : snapBeat(Math.round(sec.end_ms));
        const secDurMs = secEndMs - secStartMs;
        if (secDurMs <= 0) continue;

        const palettes = getSectionPalettes(paletteKey, sec.label, ctx.activePalettes);

        const bpmDensityScale = 0.7 + 0.6 * bpmFactor;
        const adjustedCuePerBars = Math.max(1, Math.round((style.cuePerBars || 4) / (preset.cueDensityMult * bpmDensityScale)));
        const cueBarMs = adjustedCuePerBars * barMs;
        const cueBeats = adjustedCuePerBars * 4;
        const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

        for (let ci = 0; ci < numCues; ci++) {
          const rawCueStart = walkBeats(secStartMs, ci * cueBeats, ctx.beats, beatMs);
          const cueStart = ci === 0 ? secStartMs : snapBar(rawCueStart);
          const rawNextStart = walkBeats(secStartMs, (ci + 1) * cueBeats, ctx.beats, beatMs);
          const nextCueStart = ci < numCues - 1 ? snapBar(rawNextStart) : secEndMs;
          let cueDur = nextCueStart - cueStart;
          if (cueDur < barMs * 0.5) cueDur = Math.min(barMs, secEndMs - cueStart);
          if (cueDur <= 0) continue;

          // Pick a palette colour pair and find nearest wheel positions
          let paletteIdx = (fiIdx + si + Math.floor(ci / 4)) % palettes.length;

          // ── Group-aware palette coordination ──
          const gi = cwGroupInfo.get(fix.id);
          if (gi && palettes.length > 0) {
            const cmKey = `cw-${gi.groupId}-${si}`;
            if (!cwSectionModes.has(cmKey)) {
              cwSectionModes.set(cmKey, pickCoordMode(sec.label, rand));
            }
            const coordMode = cwSectionModes.get(cmKey);
            const leaderIdx = gi.members[0] ? cwFixtures.indexOf(gi.members[0]) : 0;
            const basePaletteIdx = (Math.max(0, leaderIdx) + si + Math.floor(ci / 4)) % palettes.length;
            paletteIdx = getColorOffset(gi, coordMode, basePaletteIdx, palettes.length);
          }

          const palette = palettes[paletteIdx];

          // Energy-driven intensity
          let energyMod = 1.0;
          if (energyLevels.length > 0) {
            const cueTimeMid = cueStart + cueDur * 0.5;
            const closest = energyLevels.reduce((best, e) =>
              Math.abs(e.time_ms - cueTimeMid) < Math.abs(best.time_ms - cueTimeMid) ? e : best
            );
            energyMod = 0.75 + Math.min(1, closest.energy) * 0.4;
          }

          // Color-wheel fixtures: push dimmer higher since intensity is NOT
          // baked into the colour (unlike RGB).
          const baseIntLo = style.intensity ? style.intensity[0] : 0.6;
          const baseIntHi = style.intensity ? style.intensity[1] : 0.8;
          const cwBoostLo = Math.min(1, baseIntLo * 1.25);
          const cwBoostHi = Math.min(1, baseIntHi * 1.25);
          let startIntensity = Math.min(1, cwBoostLo * preset.intensityMult * energyMod);
          let endIntensity = Math.min(1, cwBoostHi * preset.intensityMult * energyMod);

          // ── Per-fixture intensity curve ──
          const fixIntMult = getFixtureIntensity(fix.id, sec.label, ctx);
          startIntensity = Math.min(1, startIntensity * fixIntMult);
          endIntensity = Math.min(1, endIntensity * fixIntMult);

          // Occasional full-brightness "punch" moments for contrast
          const isHighEnergy = sec.label === 'chorus' || sec.label === 'drop';
          const punchChance = isHighEnergy ? 0.35 : 0.12;
          if (rand() < punchChance) {
            startIntensity = 1.0;
            endIntensity = 1.0;
          }

          // Find the nearest wheel colour for the start & end palette colours
          const startColor = applyIntensity(palette[0], 1);
          const endColor = applyIntensity(palette[1], 1);
          const startWheel = findNearestWheelColor(startColor, wheelMap);
          const endWheel = findNearestWheelColor(endColor, wheelMap);
          if (!startWheel) continue;

          // ── Split/half-color positions for transitional sections ──
          // In verses and bridges, occasionally use a split position between
          // two adjacent colors for a more nuanced look
          let cwDmxValue = startWheel.dmx_start;
          let cwDisplayColor = startWheel.color_hex || '#888888';

          const useSplit = (sec.label === 'verse' || sec.label === 'bridge' || sec.label === 'breakdown')
            && endWheel && endWheel !== startWheel && rand() < 0.35;
          if (useSplit) {
            const split = findSplitWheelPosition(palette[0], palette[1], wheelMap);
            if (split) {
              cwDmxValue = split.dmx;
              cwDisplayColor = split.color_hex;
            }
          }

          const startVals = { color_wheel: cwDmxValue };
          if (hasDimmer) {
            startVals.dimmer = Math.round(startIntensity * 255);
          }

          cues.push({
            lane,
            start_ms: Math.round(cueStart),
            duration_ms: Math.round(cueDur),
            cue_type: 'color_wheel',
            fixture_id: fix.id,
            track: 'color',
            channel_values: startVals,
            color: cwDisplayColor,
            label: sec.label || '',
          });
        }

        // ── Strobe hits for color-wheel fixtures ────────────────────
        if (!noStrobes && hasStrobe) {
          const effectiveStrobeChance = ((style.strobeChance || 0) * preset.strobeMult * (0.3 + 0.7 * bpmFactor));
          if (effectiveStrobeChance > 0 && beats.length > 0) {
            const strobeBeats = beats.filter(b => b >= secStartMs && b < secEndMs);
            const strobeDurMs = Math.round((style.strobeDurationBeats || 0.5) * beatMs);

            for (let bi = 0; bi < strobeBeats.length; bi++) {
              const beatInSection = Math.floor((strobeBeats[bi] - secStartMs) / beatMs);
              if (beatInSection % 4 === 0 && rand() < effectiveStrobeChance) {
                cues.push({
                  lane,
                  start_ms: Math.round(strobeBeats[bi]),
                  duration_ms: strobeDurMs,
                  cue_type: 'strobe',
                  fixture_id: fix.id,
                  track: 'color',
                  channel_values: { strobe_hz: 10, dimmer: 255 },
                  color: '#ffffff',
                  label: 'strobe',
                });
              }
            }
          }
        }
        // ── Color wheel spin/rotation effects on drops and choruses ──
        if ((sec.label === 'drop' || sec.label === 'chorus' || sec.label === 'buildup') && rand() < 0.30) {
          // Find macro ranges for CW/CCW wheel rotation
          const cwChannel = fix.channels.find(ch => ch.type === 'color_wheel');
          if (cwChannel && cwChannel.ranges) {
            const spinRanges = cwChannel.ranges.filter(r => r.type === 'macro' && /flow|rotat/i.test(r.label));
            if (spinRanges.length > 0) {
              const spinRange = spinRanges[Math.floor(rand() * spinRanges.length)];
              // Pick a speed within the range — faster for drops
              const speedFrac = sec.label === 'drop' ? 0.6 + rand() * 0.3 : 0.3 + rand() * 0.4;
              const spinDmx = Math.round(spinRange.min + speedFrac * (spinRange.max - spinRange.min));
              // Duration: 1-2 bars of spinning
              const spinBars = sec.label === 'drop' ? 1 : 2;
              const spinDurMs = Math.round(spinBars * barMs);
              // Place it at the start of the section
              const spinStart = secStartMs;
              if (spinDurMs > 0 && spinStart + spinDurMs <= secEndMs) {
                const spinVals = { color_wheel: spinDmx };
                if (hasDimmer) spinVals.dimmer = 255;
                cues.push({
                  lane,
                  start_ms: Math.round(spinStart),
                  duration_ms: spinDurMs,
                  cue_type: 'color_wheel',
                  fixture_id: fix.id,
                  track: 'color',
                  channel_values: spinVals,
                  color: '#e0e0e0',
                  label: 'wheel spin',
                });
              }
            }
          }
        }
      }
    } else {
      // Bar-based fallback
      const versePalettes = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
      const chorusPalettes = getSectionPalettes(paletteKey, 'chorus', ctx.activePalettes);
      const allPalettes = [...versePalettes, ...chorusPalettes];
      const totalBars = Math.floor(durationMs / barMs);
      const sectionBars = Math.max(1, Math.round(2 / preset.cueDensityMult));

      for (let bar = 0; bar < totalBars; bar += sectionBars) {
        const paletteIdx = Math.floor(bar / sectionBars) % allPalettes.length;
        const palette = allPalettes[(paletteIdx + fiIdx) % allPalettes.length];
        const startMs = snapBar(walkBeats(0, bar * 4, ctx.beats, beatMs));
        const endMs = snapBar(walkBeats(0, (bar + sectionBars) * 4, ctx.beats, beatMs));
        const durMs = Math.min(endMs - startMs, durationMs - startMs);
        if (durMs <= 0) break;

        const intensity = Math.min(1, 0.85 * preset.intensityMult);
        const startWheel = findNearestWheelColor(palette[0], wheelMap);
        const endWheel = findNearestWheelColor(palette[1], wheelMap);
        if (!startWheel) continue;

        const startVals = { color_wheel: startWheel.dmx_start };
        if (hasDimmer) {
          startVals.dimmer = Math.round(intensity * 255);
        }

        cues.push({
          lane,
          start_ms: Math.round(startMs),
          duration_ms: Math.round(durMs),
          cue_type: 'color_wheel',
          fixture_id: fix.id,
          track: 'color',
          channel_values: startVals,
          color: startWheel.color_hex || '#888888',
          label: '',
        });
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

module.exports = { generateColorWheelCues };
