/**
 * Bar-Based Fallback Cue Generation
 *
 * Used when no section analysis is available — generates color cues
 * at regular bar intervals across the full track duration.
 */

const { applyIntensity, CUE_COLORS, getFixtureIntensity } = require('./helpers');
const { getSectionPalettes } = require('./palettes');

function generateBarBased(cues, fixtures, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBar, beats } = ctx;

  const useFades = bpmFactor < 0.5;
  const bpmDensityScale = 0.7 + 0.6 * bpmFactor;

  const versePalettes = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
  const chorusPalettes = getSectionPalettes(paletteKey, 'chorus', ctx.activePalettes);
  const allPalettes = [...versePalettes, ...chorusPalettes];

  const totalBars = Math.floor(durationMs / barMs);
  const sectionBars = Math.max(1, Math.round(2 / (preset.cueDensityMult * bpmDensityScale)));

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % allPalettes.length;
      const palette = allPalettes[(paletteIdx + fiIdx) % allPalettes.length];
      const startMs = snapBar(bar * barMs);
      const endMs = snapBar((bar + sectionBars) * barMs);
      const durMs = Math.min(endMs - startMs, durationMs - startMs);
      if (durMs <= 0) break;

      const intensity = Math.min(1, 0.7 * preset.intensityMult * getFixtureIntensity(fix.id, 'verse', ctx));
      const startColor = applyIntensity(palette[0], intensity);
      const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };

      if (hasDimmer) { startVals.dimmer = 255; }
      // Don't set white on normal color cues — it washes out the color

      const cueType = useFades ? 'static' : 'solid';

      // For transitions, fade into the NEXT cue's color for smooth flow
      let endVals = null;
      if (cueType === 'static') {
        const nextPaletteIdx = (Math.floor((bar + sectionBars) / sectionBars) % allPalettes.length + fiIdx) % allPalettes.length;
        const nextPalette = allPalettes[nextPaletteIdx];
        const endColor = applyIntensity(nextPalette[0], intensity);
        endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };
        if (hasDimmer) endVals.dimmer = 255;
      }

      cues.push({
        lane,
        start_ms: Math.round(startMs),
        duration_ms: Math.round(durMs),
        cue_type: useFades ? 'static' : 'solid',
        fixture_id: fix.id,
        track: 'color',
        channel_values: startVals,
        end_channel_values: endVals,
        color: CUE_COLORS[(paletteIdx + fiIdx) % CUE_COLORS.length],
        label: '',
      });

      // Add occasional strobe
      const strobeChance = 0.3 * preset.strobeMult * (0.3 + 0.7 * bpmFactor);
      if (!noStrobes && bar % 8 === 0 && bar > 0 && strobeChance > 0 && rand() < strobeChance) {
        const strobeDur = Math.round(beatMs);
        const strobeVals = { red: 255, green: 255, blue: 255, strobe_hz: 12 };
        if (hasDimmer) strobeVals.dimmer = 255;

        cues.push({
          lane,
          start_ms: Math.round(startMs),
          duration_ms: strobeDur,
          cue_type: 'strobe',
          fixture_id: fix.id,
          track: 'color',
          channel_values: strobeVals,
          end_channel_values: {},
          color: '#ffffff',
          label: 'strobe',
        });
      }
    }
  }
}

module.exports = { generateBarBased };
