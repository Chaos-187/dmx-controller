/**
 * Sequence Generator
 * 
 * Generates DMX light sequences from track analysis data.
 * Creates beat-synced cues with color changes, strobes, effects,
 * and section-appropriate lighting styles.
 */

// ─── Section style definitions ──────────────────────────────────────────────
// Each section type defines intensity range, color palettes, and behaviour flags

const sectionStyles = {
  intro: {
    intensity: [0.15, 0.55],
    palettes: [
      [{ r: 0, g: 40, b: 180 }, { r: 30, g: 80, b: 220 }],
      [{ r: 20, g: 0, b: 140 }, { r: 60, g: 20, b: 200 }],
      [{ r: 10, g: 60, b: 120 }, { r: 40, g: 100, b: 180 }],
    ],
    beatColorChange: false,   // gentle, no beat-sync color snaps
    strobeChance: 0,
    cuePerBars: 4,            // one transition per 4 bars
  },
  verse: {
    intensity: [0.45, 0.7],
    palettes: [
      [{ r: 0, g: 200, b: 80 }, { r: 0, g: 120, b: 255 }],
      [{ r: 60, g: 180, b: 0 }, { r: 0, g: 200, b: 150 }],
      [{ r: 0, g: 150, b: 200 }, { r: 80, g: 200, b: 0 }],
      [{ r: 120, g: 80, b: 255 }, { r: 0, g: 180, b: 120 }],
    ],
    beatColorChange: true,    // swap colors every 2 bars
    beatColorBars: 2,
    strobeChance: 0,
    cuePerBars: 2,
  },
  chorus: {
    intensity: [0.8, 1.0],
    palettes: [
      [{ r: 255, g: 0, b: 60 }, { r: 255, g: 100, b: 0 }],
      [{ r: 255, g: 0, b: 200 }, { r: 255, g: 60, b: 0 }],
      [{ r: 200, g: 0, b: 255 }, { r: 255, g: 0, b: 80 }],
      [{ r: 255, g: 40, b: 0 }, { r: 200, g: 0, b: 200 }],
      [{ r: 255, g: 0, b: 120 }, { r: 0, g: 100, b: 255 }],
    ],
    beatColorChange: true,    // rapid color changes
    beatColorBars: 1,         // every bar
    strobeChance: 0.2,        // 20% chance of strobe on a beat
    strobeDurationBeats: 0.5,
    cuePerBars: 1,
  },
  bridge: {
    intensity: [0.4, 0.65],
    palettes: [
      [{ r: 255, g: 200, b: 0 }, { r: 200, g: 80, b: 255 }],
      [{ r: 180, g: 255, b: 0 }, { r: 0, g: 180, b: 255 }],
      [{ r: 200, g: 150, b: 255 }, { r: 255, g: 200, b: 50 }],
    ],
    beatColorChange: true,
    beatColorBars: 2,
    strobeChance: 0,
    cuePerBars: 2,
  },
  breakdown: {
    intensity: [0.1, 0.35],
    palettes: [
      [{ r: 0, g: 180, b: 255 }, { r: 0, g: 60, b: 180 }],
      [{ r: 0, g: 120, b: 200 }, { r: 20, g: 0, b: 100 }],
      [{ r: 30, g: 80, b: 180 }, { r: 0, g: 40, b: 120 }],
    ],
    beatColorChange: false,
    strobeChance: 0,
    cuePerBars: 4,
  },
  buildup: {
    intensity: [0.25, 0.95],
    palettes: [
      [{ r: 255, g: 120, b: 0 }, { r: 255, g: 0, b: 120 }],
      [{ r: 200, g: 80, b: 0 }, { r: 255, g: 40, b: 200 }],
      [{ r: 255, g: 60, b: 0 }, { r: 200, g: 0, b: 255 }],
    ],
    beatColorChange: true,
    beatColorBars: 1,         // accelerating color
    strobeChance: 0.15,
    strobeDurationBeats: 0.25,
    cuePerBars: 1,
    rampIntensity: true,      // intensity ramps up through the section
  },
  drop: {
    intensity: [0.9, 1.0],
    palettes: [
      [{ r: 200, g: 0, b: 255 }, { r: 255, g: 0, b: 0 }],
      [{ r: 255, g: 0, b: 120 }, { r: 0, g: 0, b: 255 }],
      [{ r: 255, g: 50, b: 0 }, { r: 200, g: 0, b: 255 }],
      [{ r: 255, g: 0, b: 0 }, { r: 255, g: 255, b: 0 }],
      [{ r: 0, g: 50, b: 255 }, { r: 255, g: 0, b: 200 }],
    ],
    beatColorChange: true,
    beatColorBars: 1,
    strobeChance: 0.3,        // high strobe chance
    strobeDurationBeats: 0.5,
    cuePerBars: 1,
  },
  outro: {
    intensity: [0.5, 0.1],
    palettes: [
      [{ r: 80, g: 60, b: 120 }, { r: 20, g: 10, b: 40 }],
      [{ r: 60, g: 80, b: 100 }, { r: 10, g: 20, b: 30 }],
    ],
    beatColorChange: false,
    strobeChance: 0,
    cuePerBars: 4,
    fadeOut: true,
  },
};

const defaultStyle = {
  intensity: [0.4, 0.6],
  palettes: [[{ r: 128, g: 128, b: 128 }, { r: 80, g: 80, b: 80 }]],
  beatColorChange: false,
  strobeChance: 0,
  cuePerBars: 2,
};

const CUE_COLORS = [
  '#e53935', '#43a047', '#1e88e5', '#ff8f00',
  '#7b1fa2', '#00acc1', '#fdd835', '#d81b60',
  '#6d4c41', '#00897b', '#5e35b1', '#f4511e',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function applyIntensity(color, level) {
  return {
    r: Math.round(color.r * level),
    g: Math.round(color.g * level),
    b: Math.round(color.b * level),
  };
}

function lerpColor(c1, c2, t) {
  return {
    r: Math.round(c1.r + (c2.r - c1.r) * t),
    g: Math.round(c1.g + (c2.g - c1.g) * t),
    b: Math.round(c1.b + (c2.b - c1.b) * t),
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** Seeded pseudo-random for deterministic results per track */
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a sequence of cues for a track.
 * 
 * @param {Object} opts
 * @param {Object} opts.track       - Track record from DB
 * @param {Array}  opts.fixtures    - Fixture channel map from DB
 * @param {Object} [opts.analysis]  - Track analysis (with sections, beats, energy_levels)
 * @returns {Object} { cues: Array, bpm, durationMs }
 */
function generateSequence(opts) {
  const { track, fixtures, analysis } = opts;
  const bpm = track.bpm || 128;
  const durationMs = (track.song_length || 180) * 1000;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  // Seed random from track ID for deterministic generation
  const rand = seededRandom(track.id * 7919 + Math.round(bpm * 100));

  // Parse analysis data
  let sections = [];
  let beats = [];
  let energyLevels = [];
  if (analysis) {
    try { sections = JSON.parse(analysis.sections || '[]'); } catch (e) { sections = []; }
    try { beats = JSON.parse(analysis.beats || '[]'); } catch (e) { beats = []; }
    try { energyLevels = JSON.parse(analysis.energy_levels || '[]'); } catch (e) { energyLevels = []; }
  }

  // Filter to RGB fixtures
  const rgbFixtures = fixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'red') &&
    fix.channels.some(ch => ch.type === 'green') &&
    fix.channels.some(ch => ch.type === 'blue')
  );

  if (rgbFixtures.length === 0) return { cues: [], bpm, durationMs };

  const cues = [];

  if (sections.length > 0) {
    generateSectionBased(cues, rgbFixtures, sections, beats, energyLevels, {
      bpm, durationMs, beatMs, barMs, rand,
    });
  } else {
    generateBarBased(cues, rgbFixtures, { bpm, durationMs, beatMs, barMs, rand });
  }

  return { cues, bpm, durationMs };
}

// ─── Section-based generation ───────────────────────────────────────────────

function generateSectionBased(cues, fixtures, sections, beats, energyLevels, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand } = ctx;

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const style = sectionStyles[sec.label] || defaultStyle;
      const secStartMs = Math.round(sec.start_ms);
      const secEndMs = Math.round(sec.end_ms);
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs <= 0) continue;

      const cueBarMs = style.cuePerBars * barMs;
      const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

      for (let ci = 0; ci < numCues; ci++) {
        const cueStart = secStartMs + ci * cueBarMs;
        const cueEnd = Math.min(cueStart + cueBarMs, secEndMs);
        const cueDur = cueEnd - cueStart;
        if (cueDur <= 0) continue;

        // Progress through section (0..1)
        const secProgress = numCues > 1 ? ci / (numCues - 1) : 0.5;

        // Pick palette — alternate between palettes per cue
        const paletteCount = style.palettes.length;
        let paletteIdx;
        if (style.beatColorChange) {
          // Alternate palettes on each cue for color variation
          paletteIdx = (fiIdx + si + ci) % paletteCount;
        } else {
          paletteIdx = (fiIdx + si) % paletteCount;
        }
        const palette = style.palettes[paletteIdx];

        // Calculate intensity
        let startIntensity = style.intensity[0];
        let endIntensity = style.intensity[1];

        if (style.rampIntensity) {
          // Buildup: ramp from low to high through the section
          startIntensity = style.intensity[0] + (style.intensity[1] - style.intensity[0]) * secProgress;
          endIntensity = style.intensity[0] + (style.intensity[1] - style.intensity[0]) * Math.min(1, secProgress + 1 / numCues);
        }

        if (style.fadeOut) {
          // Outro: fade down
          startIntensity = style.intensity[0] * (1 - secProgress * 0.7);
          endIntensity = style.intensity[0] * (1 - Math.min(1, secProgress + 1 / numCues) * 0.7);
        }

        const startColor = applyIntensity(palette[0], startIntensity);
        const endColor = applyIntensity(palette[1], endIntensity);

        // Build channel values
        const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
        const endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };

        if (hasDimmer) {
          startVals.dimmer = Math.round(startIntensity * 255);
          endVals.dimmer = Math.round(endIntensity * 255);
        }
        if (hasWhite) {
          startVals.white = Math.round((startColor.r + startColor.g + startColor.b) / 3 * 0.25);
          endVals.white = Math.round((endColor.r + endColor.g + endColor.b) / 3 * 0.25);
        }

        cues.push({
          lane,
          start_ms: Math.round(cueStart),
          duration_ms: Math.round(cueDur),
          cue_type: 'static',
          fixture_id: fix.id,
          channel_values: startVals,
          end_channel_values: endVals,
          color: sec.color || CUE_COLORS[si % CUE_COLORS.length],
          label: sec.label || '',
        });
      }

      // ── Strobe hits on high-energy beats ────────────────────────────
      if (style.strobeChance > 0 && beats.length > 0) {
        const strobeBeats = beats.filter(b => b >= secStartMs && b < secEndMs);
        const strobeDurMs = Math.round((style.strobeDurationBeats || 0.5) * beatMs);

        for (let bi = 0; bi < strobeBeats.length; bi++) {
          // Only trigger strobe on certain beats (every 4th beat or random)
          const beatInSection = Math.floor((strobeBeats[bi] - secStartMs) / beatMs);
          const isDownbeat = beatInSection % 4 === 0;

          if (isDownbeat && rand() < style.strobeChance) {
            // Get energy at this beat position for intensity
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

      // ── Beat-synced color flash on chorus/drop first beat ────────────
      if ((sec.label === 'chorus' || sec.label === 'drop') && beats.length > 0) {
        // Flash white on the first beat of the section
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

      // ── Color accent pulses on every 8th bar in verses ──────────────
      if ((sec.label === 'verse' || sec.label === 'bridge') && secDurMs > barMs * 8) {
        const accentPalette = style.palettes[(fiIdx + si + 1) % style.palettes.length];
        const accentColor = applyIntensity(accentPalette[0], 0.9);
        const accentEnd = applyIntensity(accentPalette[1], 0.5);

        for (let barOffset = barMs * 7; barOffset < secDurMs; barOffset += barMs * 8) {
          const pulseStart = secStartMs + barOffset;
          const pulseDur = Math.round(beatMs * 2);
          if (pulseStart + pulseDur > secEndMs) break;

          const pulseVals = { red: accentColor.r, green: accentColor.g, blue: accentColor.b };
          const pulseEnd = { red: accentEnd.r, green: accentEnd.g, blue: accentEnd.b };
          if (hasDimmer) { pulseVals.dimmer = 230; pulseEnd.dimmer = 150; }

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

      // ── Alternating fixture colors in multi-fixture setups ──────────
      if (fixtures.length > 1 && style.beatColorChange && fiIdx > 0) {
        // Offset palette for even/odd fixtures to create movement illusion
        // Already handled by (fiIdx + si + ci) in the palette selection above
      }
    }
  }

  // Sort cues by start time for clean timeline ordering
  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Bar-based fallback generation ──────────────────────────────────────────

function generateBarBased(cues, fixtures, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand } = ctx;

  const palettes = [
    [{ r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 }],
    [{ r: 0, g: 255, b: 0 }, { r: 255, g: 0, b: 255 }],
    [{ r: 255, g: 128, b: 0 }, { r: 0, g: 128, b: 255 }],
    [{ r: 255, g: 0, b: 128 }, { r: 0, g: 255, b: 128 }],
    [{ r: 128, g: 0, b: 255 }, { r: 255, g: 255, b: 0 }],
    [{ r: 0, g: 255, b: 255 }, { r: 255, g: 0, b: 0 }],
    [{ r: 200, g: 0, b: 200 }, { r: 0, g: 200, b: 100 }],
    [{ r: 255, g: 80, b: 0 }, { r: 0, g: 80, b: 255 }],
  ];

  const totalBars = Math.floor(durationMs / barMs);
  const sectionBars = 2; // change colors every 2 bars for more movement

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % palettes.length;
      const palette = palettes[(paletteIdx + fiIdx) % palettes.length];
      const startMs = bar * barMs;
      const durMs = Math.min(sectionBars * barMs, durationMs - startMs);
      if (durMs <= 0) break;

      const startColor = palette[0];
      const endColor = palette[1];
      const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
      const endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };

      if (hasDimmer) {
        startVals.dimmer = 200;
        endVals.dimmer = 200;
      }
      if (hasWhite) {
        startVals.white = Math.round((startColor.r + startColor.g + startColor.b) / 3 * 0.2);
        endVals.white = Math.round((endColor.r + endColor.g + endColor.b) / 3 * 0.2);
      }

      cues.push({
        lane,
        start_ms: Math.round(startMs),
        duration_ms: Math.round(durMs),
        cue_type: 'static',
        fixture_id: fix.id,
        channel_values: startVals,
        end_channel_values: endVals,
        color: CUE_COLORS[(paletteIdx + fiIdx) % CUE_COLORS.length],
        label: '',
      });

      // Add occasional strobe on every 8th bar
      if (bar % 8 === 0 && bar > 0 && rand() < 0.3) {
        const strobeDur = Math.round(beatMs);
        const strobeVals = { red: 255, green: 255, blue: 255, strobe_hz: 12 };
        if (hasDimmer) strobeVals.dimmer = 255;

        cues.push({
          lane,
          start_ms: Math.round(startMs),
          duration_ms: strobeDur,
          cue_type: 'strobe',
          fixture_id: fix.id,
          channel_values: strobeVals,
          end_channel_values: {},
          color: '#ffffff',
          label: 'strobe',
        });
      }
    }
  }
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = { generateSequence };
