/**
 * Section-Based Cue Generation
 *
 * Generates color cues, strobes, flashes, and accent pulses aligned to
 * song sections (verse, chorus, drop, etc.) with beat-grid snapping.
 */

const { applyIntensity, rgbToHex, CUE_COLORS, getFixtureIntensity, hasVocals, getDrumDensity, getStemEnergy } = require('./helpers');
const { sectionStyles, defaultStyle, getSectionPalettes } = require('./palettes');
const { getFixtureGroup, pickCoordMode, getColorOffset } = require('./group-coordination');

/**
 * Generate section-based color cues for an array of fixtures.
 *
 * @param {Array}  cues       - Mutated cue array
 * @param {Array}  fixtures   - Fixtures to generate for
 * @param {Array}  sections   - Song sections [{label, start_ms, end_ms}, ...]
 * @param {Array}  beats      - Beat timestamps (ms)
 * @param {Array}  energyLevels - Energy samples [{time_ms, energy}, ...]
 * @param {Object} ctx        - Generation context (bpm, barMs, rand, etc.)
 * @param {Object} [opts]     - { colorOnly: true } to skip accents/strobes
 */
function generateSectionBased(cues, fixtures, sections, beats, energyLevels, ctx, opts = {}) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBeat, snapBar } = ctx;
  const colorOnly = opts.colorOnly || false;
  const groupMap = ctx.groupMap;

  const useFades = bpmFactor < 0.5;
  const fadeOverlapFactor = Math.max(0, 1 - bpmFactor);

  // ── Pre-compute group info for every fixture in this set ──────────
  const fixtureIdSet = new Set(fixtures.map(f => f.id));
  const fixtureGroupInfo = new Map();
  const sectionColorModes = new Map(); // `${groupId}-${si}` → coordMode
  for (const fix of fixtures) {
    const gi = groupMap ? getFixtureGroup(fix, groupMap, fixtureIdSet) : null;
    fixtureGroupInfo.set(fix.id, gi);
  }

  // ── Color cascade: stagger colour changes across the rig ──────────
  const rigSorted = [...fixtures].sort((a, b) => {
    if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
    return (a.rig_x || 0.5) - (b.rig_x || 0.5);
  });
  const rigXVals = rigSorted.map(f => f.rig_x ?? 0.5);
  const rigXSpan = Math.max(...rigXVals) - Math.min(...rigXVals);
  const colorCascadeMap = new Map();
  for (let i = 0; i < rigSorted.length; i++) {
    const fraction = rigXSpan > 0.05
      ? ((rigSorted[i].rig_x ?? 0.5) - Math.min(...rigXVals)) / rigXSpan
      : (rigSorted.length > 1 ? i / (rigSorted.length - 1) : 0);
    colorCascadeMap.set(rigSorted[i].id, fraction);
  }
  const CASCADE_COLOR_SECTIONS = new Set(['chorus', 'drop', 'buildup', 'bridge']);
  const colorCascadeSpreadMs = beatMs * 1.0;

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const style = (ctx.activeSectionStyles || sectionStyles)[sec.label] || defaultStyle;
      const secStartMs = si === 0 ? 0 : snapBeat(Math.round(sec.start_ms));
      const secEndMs = si === sections.length - 1 ? Math.round(durationMs) : snapBeat(Math.round(sec.end_ms));
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs <= 0) continue;

      const palettes = getSectionPalettes(paletteKey, sec.label, ctx.activePalettes);

      const bpmDensityScale = 0.7 + 0.6 * bpmFactor;
      const adjustedCuePerBars = Math.max(1, Math.round(style.cuePerBars / (preset.cueDensityMult * bpmDensityScale)));
      const cueBarMs = adjustedCuePerBars * barMs;
      const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

      for (let ci = 0; ci < numCues; ci++) {
        const rawCueStart = secStartMs + ci * cueBarMs;
        const cueStart = ci === 0 ? secStartMs : snapBar(rawCueStart);
        const rawNextStart = rawCueStart + cueBarMs;
        const nextCueStart = ci < numCues - 1 ? snapBar(rawNextStart) : secEndMs;
        let cueDur = nextCueStart - cueStart;
        if (cueDur < barMs * 0.5) cueDur = Math.min(barMs, secEndMs - cueStart);
        if (cueDur <= 0) continue;

        const secProgress = numCues > 1 ? ci / (numCues - 1) : 0.5;

        const paletteCount = palettes.length;
        let paletteIdx;
        if (style.beatColorChange) {
          const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
          paletteIdx = (fiIdx + si + Math.floor(ci / adjustedBars)) % paletteCount;
        } else {
          paletteIdx = (fiIdx + si + Math.floor(ci / 4)) % paletteCount;
        }

        // ── Group-aware palette coordination ──
        // If this fixture is in a group, override the palette index so all
        // group members use coordinated colors (sync, mirror, opposite, etc.)
        const gi = fixtureGroupInfo.get(fix.id);
        if (gi && paletteCount > 0) {
          const cmKey = `${gi.groupId}-${si}`;
          if (!sectionColorModes.has(cmKey)) {
            sectionColorModes.set(cmKey, pickCoordMode(sec.label, rand));
          }
          const coordMode = sectionColorModes.get(cmKey);
          // Use the group-leader's base palette (first member in group)
          const leaderIdx = gi.members[0] ? fixtures.indexOf(gi.members[0]) : 0;
          let basePaletteIdx;
          if (style.beatColorChange) {
            const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
            basePaletteIdx = (Math.max(0, leaderIdx) + si + Math.floor(ci / adjustedBars)) % paletteCount;
          } else {
            basePaletteIdx = (Math.max(0, leaderIdx) + si + Math.floor(ci / 4)) % paletteCount;
          }
          paletteIdx = getColorOffset(gi, coordMode, basePaletteIdx, paletteCount);
        }

        const palette = palettes[paletteIdx];

        let energyMod = 1.0;
        if (energyLevels.length > 0) {
          const cueTimeMid = cueStart + cueDur * 0.5;
          const closest = energyLevels.reduce((best, e) =>
            Math.abs(e.time_ms - cueTimeMid) < Math.abs(best.time_ms - cueTimeMid) ? e : best
          );
          energyMod = 0.75 + Math.min(1, closest.energy) * 0.4;
        }

        let startIntensity = Math.min(1, style.intensity[0] * preset.intensityMult * energyMod);
        let endIntensity = Math.min(1, style.intensity[1] * preset.intensityMult * energyMod);

        if (style.rampIntensity) {
          startIntensity = style.intensity[0] + (style.intensity[1] - style.intensity[0]) * secProgress;
          endIntensity = style.intensity[0] + (style.intensity[1] - style.intensity[0]) * Math.min(1, secProgress + 1 / numCues);
          startIntensity = Math.min(1, startIntensity * preset.intensityMult);
          endIntensity = Math.min(1, endIntensity * preset.intensityMult);
        }

        if (style.fadeOut) {
          startIntensity = style.intensity[0] * (1 - secProgress * 0.7);
          endIntensity = style.intensity[0] * (1 - Math.min(1, secProgress + 1 / numCues) * 0.7);
        }

        if (style.dropEnergy) {
          startIntensity = Math.min(1, startIntensity * 1.15);
          endIntensity = Math.min(1, endIntensity * 1.15);
        }

        if (style.buildEnergy && secProgress > 0.7) {
          const boost = 1 + (secProgress - 0.7) * 1.0;
          startIntensity = Math.min(1, startIntensity * boost);
          endIntensity = Math.min(1, endIntensity * boost);
        }

        // ── Per-fixture intensity curve ──
        const fixIntMult = getFixtureIntensity(fix.id, sec.label, ctx);
        startIntensity = Math.min(1, startIntensity * fixIntMult);
        endIntensity = Math.min(1, endIntensity * fixIntMult);

        // ── Stem-aware intensity modulation ──
        // When stem data is available, reduce intensity during vocal sections
        // (let the vocals breathe) and boost during instrumental passages
        const vocalsActive = hasVocals(secStartMs, secEndMs, ctx);
        if (vocalsActive === true) {
          // Soften lights during vocals (85% intensity) — subtle enough to not be jarring
          startIntensity *= 0.85;
          endIntensity *= 0.85;
        } else if (vocalsActive === false && (sec.label === 'chorus' || sec.label === 'drop')) {
          // Instrumental chorus/drop — boost energy (full blast)
          startIntensity = Math.min(1, startIntensity * 1.1);
          endIntensity = Math.min(1, endIntensity * 1.1);
        }

        const startColor = applyIntensity(palette[0], startIntensity);

        const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };

        if (hasDimmer) { startVals.dimmer = 255; }
        // Don't set white on normal color cues — it washes out the color;
        // white is only added for strobe hits where a full flash is desired.

        const cueType = useFades ? 'static' : 'solid';

        // For transitions, fade into the NEXT cue's color for a smooth flow
        let endVals = null;
        if (cueType === 'static') {
          // Look ahead to the next palette colour
          let nextPaletteIdx;
          if (style.beatColorChange) {
            const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
            nextPaletteIdx = (fiIdx + si + Math.floor((ci + 1) / adjustedBars)) % paletteCount;
          } else {
            nextPaletteIdx = (fiIdx + si + Math.floor((ci + 1) / 4)) % paletteCount;
          }
          // If we have group coordination, offset the next index the same way
          if (gi && paletteCount > 0) {
            const cmKey = `${gi.groupId}-${si}`;
            const coordMode = sectionColorModes.get(cmKey);
            if (coordMode) {
              let baseNext;
              const leaderIdx = gi.members[0] ? fixtures.indexOf(gi.members[0]) : 0;
              if (style.beatColorChange) {
                const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
                baseNext = (Math.max(0, leaderIdx) + si + Math.floor((ci + 1) / adjustedBars)) % paletteCount;
              } else {
                baseNext = (Math.max(0, leaderIdx) + si + Math.floor((ci + 1) / 4)) % paletteCount;
              }
              nextPaletteIdx = getColorOffset(gi, coordMode, baseNext, paletteCount);
            }
          }
          const nextPalette = palettes[nextPaletteIdx];
          const endColor = applyIntensity(nextPalette[0], endIntensity);
          endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };
          if (hasDimmer) endVals.dimmer = 255;
        }

        let cascadeOffset = 0;
        if (CASCADE_COLOR_SECTIONS.has(sec.label) && fixtures.length > 1) {
          cascadeOffset = Math.round((colorCascadeMap.get(fix.id) || 0) * colorCascadeSpreadMs);
        }

        cues.push({
          lane,
          start_ms: Math.round(cueStart) + cascadeOffset,
          duration_ms: Math.max(Math.round(barMs * 0.5), Math.round(cueDur) - cascadeOffset),
          cue_type: cueType,
          fixture_id: fix.id,
          channel_values: startVals,
          end_channel_values: endVals,
          color: sec.color || CUE_COLORS[si % CUE_COLORS.length],
          label: sec.label || '',
        });
      }

      // ── Strobe hits on high-energy beats ────────────────────────────
      if (!noStrobes && !colorOnly) {
      const effectiveStrobeChance = (style.strobeChance || 0) * preset.strobeMult * (0.3 + 0.7 * bpmFactor);
      // When drum stems are available, boost strobe chance in drum-dense sections
      const drumDensity = getDrumDensity(secStartMs, secEndMs, ctx);
      const drumBoost = drumDensity !== null ? Math.min(1.3, 0.7 + drumDensity * 0.1) : 1.0;
      const finalStrobeChance = effectiveStrobeChance * drumBoost;
      if (finalStrobeChance > 0 && beats.length > 0) {
        const strobeBeats = beats.filter(b => b >= secStartMs && b < secEndMs);
        const strobeDurMs = Math.round((style.strobeDurationBeats || 0.5) * beatMs);

        // ── Group-coordinated strobe decisions ──
        // Grouped fixtures use a stable hash per beat so all members
        // fire strobes together instead of independently.
        const giStrobe = fixtureGroupInfo.get(fix.id);

        for (let bi = 0; bi < strobeBeats.length; bi++) {
          const beatInSection = Math.floor((strobeBeats[bi] - secStartMs) / beatMs);
          const isDownbeat = beatInSection % 4 === 0;

          if (isDownbeat) {
            let shouldStrobe;
            if (giStrobe) {
              // Group-stable roll: hash groupId + section + beat index
              const key = `strobe-${giStrobe.groupId}-${si}-${bi}`;
              let h = 0;
              for (let k = 0; k < key.length; k++) h = ((h << 5) - h + key.charCodeAt(k)) | 0;
              shouldStrobe = (((h * 2654435761) >>> 0) / 4294967296) < finalStrobeChance;
            } else {
              shouldStrobe = rand() < finalStrobeChance;
            }

            if (shouldStrobe) {
              let beatEnergy = 0.8;
              if (energyLevels.length > 0) {
                const closest = energyLevels.reduce((best, e) =>
                  Math.abs(e.time_ms - strobeBeats[bi]) < Math.abs(best.time_ms - strobeBeats[bi]) ? e : best
                );
                beatEnergy = Math.min(1, closest.energy * 2);
              }

              const strobeIntensity = Math.round(200 + beatEnergy * 55);
              const strobeVals = { red: strobeIntensity, green: strobeIntensity, blue: strobeIntensity };
              if (hasDimmer) strobeVals.dimmer = 255;
              if (hasWhite) strobeVals.white = strobeIntensity;

              cues.push({
                lane,
                start_ms: Math.round(strobeBeats[bi]),
                duration_ms: strobeDurMs,
                cue_type: 'strobe',
                fixture_id: fix.id,
                channel_values: { ...strobeVals, strobe_hz: sec.label === 'drop' ? 15 : 10 },
                end_channel_values: {},
                color: '#ffffff',
                label: 'strobe',
              });
            }
          }
        }
      }
      } // end noStrobes guard

      // ── Beat-synced color flash on chorus/drop first beat ────────────
      if (!colorOnly && preset.flashOnSection && (sec.label === 'chorus' || sec.label === 'drop') && beats.length > 0) {
        const firstBeat = beats.find(b => b >= secStartMs && b < secStartMs + beatMs * 2);
        if (firstBeat !== undefined) {
          const flashDur = Math.round(beatMs * 0.5);
          const flashVals = { red: 255, green: 255, blue: 255 };
          const fadeVals = { red: 80, green: 0, blue: 120 };
          if (hasDimmer) { flashVals.dimmer = 255; fadeVals.dimmer = 180; }
          if (hasWhite) { flashVals.white = 255; fadeVals.white = 40; }

          cues.push({
            lane,
            start_ms: Math.round(firstBeat),
            duration_ms: flashDur,
            cue_type: 'static',
            fixture_id: fix.id,
            channel_values: flashVals,
            end_channel_values: fadeVals,
            color: '#ffffff',
            label: 'flash',
          });
        }
      }

      // ── Energy-driven accent pulses in verses/bridges ───────────────
      if (!colorOnly && preset.accentPulses && (sec.label === 'verse' || sec.label === 'bridge') && secDurMs > barMs * 4) {
        const accentPaletteList = getSectionPalettes(paletteKey, sec.label, ctx.activePalettes);
        const accentPalette = accentPaletteList[(fiIdx + si + 1) % accentPaletteList.length];

        const sectionEnergy = energyLevels.filter(e => e.time_ms >= secStartMs && e.time_ms < secEndMs);

        if (sectionEnergy.length >= 4) {
          const minSpacingMs = barMs * 3;
          const avgEnergy = sectionEnergy.reduce((s, e) => s + e.energy, 0) / sectionEnergy.length;
          const threshold = avgEnergy * 1.15;

          const peaks = [];
          for (let ei = 1; ei < sectionEnergy.length - 1; ei++) {
            const e = sectionEnergy[ei];
            if (e.energy > threshold &&
                e.energy >= sectionEnergy[ei - 1].energy &&
                e.energy >= sectionEnergy[ei + 1].energy) {
              if (peaks.length === 0 || e.time_ms - peaks[peaks.length - 1].time_ms >= minSpacingMs) {
                peaks.push(e);
              }
            }
          }

          const accentTimes = peaks.length > 0
            ? peaks.map(p => p.time_ms)
            : Array.from({ length: Math.floor(secDurMs / (barMs * 4)) }, (_, i) => secStartMs + (i + 1) * barMs * 4);

          for (const accentTime of accentTimes) {
            const pulseStart = snapBeat(accentTime);
            const pulseDur = Math.round(beatMs * 2);
            if (pulseStart + pulseDur > secEndMs || pulseStart < secStartMs) continue;

            const peakEnergy = sectionEnergy.reduce((best, e) =>
              Math.abs(e.time_ms - accentTime) < Math.abs(best.time_ms - accentTime) ? e : best
            );
            const accentIntensity = 0.6 + Math.min(1, peakEnergy.energy) * 0.4;
            const accentColor = applyIntensity(accentPalette[0], accentIntensity);
            const accentEnd = applyIntensity(accentPalette[1], accentIntensity * 0.55);

            const pulseVals = { red: accentColor.r, green: accentColor.g, blue: accentColor.b };
            const pulseEnd = { red: accentEnd.r, green: accentEnd.g, blue: accentEnd.b };
            if (hasDimmer) { pulseVals.dimmer = 255; pulseEnd.dimmer = 255; }

            cues.push({
              lane,
              start_ms: Math.round(pulseStart),
              duration_ms: pulseDur,
              cue_type: 'static',
              fixture_id: fix.id,
              channel_values: pulseVals,
              end_channel_values: pulseEnd,
              color: rgbToHex(accentColor.r, accentColor.g, accentColor.b),
              label: 'accent',
            });
          }
        }
      }

      // ── Alternating fixture colors ──────────────────────────────────
      if (fixtures.length > 1 && style.beatColorChange && fiIdx > 0) {
        // Already handled by (fiIdx + si + ci) in palette selection above
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Multi-Cell Conflict Resolution ─────────────────────────────────────────
function resolveMultiCellConflicts(cues, multiCellFixtures) {
  const multiCellIds = new Set(multiCellFixtures.map(f => f.id));

  for (const fixId of multiCellIds) {
    const masterCues = [];
    const cellCues = [];
    for (const cue of cues) {
      if (cue.fixture_id !== fixId) continue;
      if (cue.cell) {
        cellCues.push(cue);
      } else {
        masterCues.push(cue);
      }
    }

    if (cellCues.length === 0 || masterCues.length === 0) continue;

    const intervals = cellCues
      .map(c => [c.start_ms, c.start_ms + c.duration_ms])
      .sort((a, b) => a[0] - b[0]);

    const merged = [intervals[0].slice()];
    for (let i = 1; i < intervals.length; i++) {
      const last = merged[merged.length - 1];
      if (intervals[i][0] <= last[1]) {
        last[1] = Math.max(last[1], intervals[i][1]);
      } else {
        merged.push(intervals[i].slice());
      }
    }

    const toRemove = new Set();
    for (const mc of masterCues) {
      const mcStart = mc.start_ms;
      const mcEnd = mc.start_ms + mc.duration_ms;
      for (const [iStart, iEnd] of merged) {
        if (mcStart < iEnd && mcEnd > iStart) {
          toRemove.add(mc);
          break;
        }
      }
    }

    if (toRemove.size > 0) {
      for (let i = cues.length - 1; i >= 0; i--) {
        if (toRemove.has(cues[i])) {
          cues.splice(i, 1);
        }
      }
    }
  }
}

module.exports = { generateSectionBased, resolveMultiCellConflicts };
