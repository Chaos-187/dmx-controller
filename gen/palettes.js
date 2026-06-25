/**
 * Color Palettes, Genre Palettes, Genre Presets & Section Styles
 *
 * Extracted from sequence-generator.js for modularity.
 *
 * ─── Palette data shape ───────────────────────────────────────────────────
 *
 *   paletteName: {
 *     label: 'Display Name',
 *     verse: [ [colorA, colorB], [colorA, colorB], ... ],  // "pairs" per section
 *     chorus: [ ... ],
 *     ...
 *   }
 *
 * Each section (intro, verse, chorus, …) holds an array of COLOR PAIRS.
 *
 * WHY TWO COLORS PER PAIR?
 *   Each pair is [startColor, endColor] for one cue slot:
 *   • Color-wheel fixtures crossfade from start → end within a single cue.
 *   • RGB fixtures flatten all pairs into one rotation pool; both colors become
 *     separate steps when the generator cycles hues bar-to-bar.
 *   • For `static` (fade) cues, the end color is often the next step in the pool;
 *     the pair still defines a harmonious A→B gradient for wheels and LED bars.
 *
 * Pair counts per section are expanded automatically to SECTION_PAIR_COUNTS
 * by bridging existing pairs (end of pair N → start of pair N+1).
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const SECTION_PAIR_COUNTS = {
  intro: 4,
  verse: 6,
  chorus: 8,
  bridge: 5,
  breakdown: 4,
  buildup: 5,
  drop: 8,
  outro: 4,
};

/** Expand a section's pair list by cross-fading between neighbouring pairs. */
function expandSectionPairs(pairs, target) {
  if (!pairs?.length) return pairs;
  if (pairs.length >= target) return pairs;
  const out = [...pairs];
  const n = pairs.length;
  for (let k = 0; out.length < target; k++) {
    const a = pairs[k % n];
    const b = pairs[(k + 1) % n];
    out.push([a[1], b[0]]);
  }
  return out;
}

function applyPaletteExpansion(palettes) {
  const expanded = {};
  for (const [key, pal] of Object.entries(palettes)) {
    expanded[key] = { label: pal.label };
    for (const [sec, pairs] of Object.entries(pal)) {
      if (sec === 'label') continue;
      expanded[key][sec] = expandSectionPairs(pairs, SECTION_PAIR_COUNTS[sec] || pairs.length);
    }
  }
  return expanded;
}

/** Merge stored DB palettes with code defaults (adds new themes + extra pairs). */
function mergeColorPaletteDefaults(stored, defaults) {
  if (!stored || typeof stored !== 'object') return defaults;
  const out = { ...stored };
  for (const [palKey, palDef] of Object.entries(defaults)) {
    if (!out[palKey]) {
      out[palKey] = palDef;
      continue;
    }
    const merged = { ...out[palKey], label: out[palKey].label || palDef.label };
    for (const [sec, defPairs] of Object.entries(palDef)) {
      if (sec === 'label') continue;
      const storedPairs = merged[sec];
      if (!Array.isArray(storedPairs)) {
        merged[sec] = defPairs;
      } else if (defPairs.length > storedPairs.length) {
        merged[sec] = [...storedPairs, ...defPairs.slice(storedPairs.length)];
      }
    }
    out[palKey] = merged;
  }
  return out;
}

// ─── Named Color Palette Themes ─────────────────────────────────────────────

const rawColorPalettes = {
  vibrant: {
    label: 'Vibrant',
    intro:     [[ {r:180,g:0,b:60},   {r:0,g:40,b:200}    ], [ {r:0,g:40,b:180},   {r:160,g:0,b:120}  ], [ {r:120,g:0,b:200}, {r:200,g:60,b:0}   ]],
    verse:     [[ {r:255,g:0,b:40},   {r:0,g:180,b:120}   ], [ {r:0,g:200,b:80},   {r:255,g:60,b:0}   ], [ {r:200,g:0,b:180}, {r:0,g:120,b:255}  ], [ {r:255,g:120,b:0}, {r:0,g:200,b:200} ]],
    chorus:    [[ {r:255,g:0,b:60},   {r:255,g:100,b:0}   ], [ {r:255,g:0,b:200},  {r:255,g:60,b:0}   ], [ {r:200,g:0,b:255}, {r:255,g:0,b:80}  ], [ {r:255,g:40,b:0}, {r:200,g:0,b:200} ]],
    bridge:    [[ {r:255,g:200,b:0},  {r:200,g:0,b:160}   ], [ {r:255,g:0,b:100},  {r:0,g:180,b:255}  ], [ {r:180,g:255,b:0}, {r:255,g:40,b:80}  ]],
    breakdown: [[ {r:0,g:100,b:200},  {r:120,g:0,b:100}   ], [ {r:100,g:0,b:160},  {r:0,g:80,b:180}   ]],
    buildup:   [[ {r:255,g:120,b:0},  {r:255,g:0,b:120}   ], [ {r:200,g:80,b:0},   {r:255,g:40,b:200} ]],
    drop:      [[ {r:255,g:0,b:0},    {r:0,g:0,b:255}     ], [ {r:255,g:0,b:120},  {r:255,g:255,b:0}  ], [ {r:255,g:50,b:0}, {r:200,g:0,b:255} ], [ {r:255,g:0,b:0}, {r:0,g:255,b:0} ]],
    outro:     [[ {r:120,g:30,b:80},  {r:20,g:10,b:40}    ], [ {r:80,g:40,b:100},  {r:40,g:10,b:30}   ]],
  },
  neon: {
    label: 'Neon',
    intro:     [[ {r:255,g:0,b:80},   {r:0,g:100,b:255}   ], [ {r:100,g:0,b:255},  {r:0,g:255,b:200}  ]],
    verse:     [[ {r:255,g:0,b:100},  {r:0,g:255,b:0}     ], [ {r:0,g:255,b:255},  {r:255,g:255,b:0}  ], [ {r:255,g:0,b:200}, {r:0,g:255,b:100} ], [ {r:255,g:60,b:0}, {r:0,g:200,b:255} ]],
    chorus:    [[ {r:255,g:0,b:255},  {r:0,g:255,b:0}     ], [ {r:255,g:255,b:0},  {r:255,g:0,b:0}    ], [ {r:0,g:200,b:255}, {r:255,g:0,b:200} ]],
    bridge:    [[ {r:200,g:255,b:0},  {r:0,g:200,b:255}   ], [ {r:255,g:0,b:150},  {r:0,g:255,b:150}  ]],
    breakdown: [[ {r:0,g:100,b:255},  {r:0,g:60,b:150}    ], [ {r:80,g:0,b:200},   {r:0,g:150,b:200}  ]],
    buildup:   [[ {r:255,g:255,b:0},  {r:255,g:0,b:255}   ], [ {r:0,g:255,b:0},    {r:255,g:100,b:0}  ]],
    drop:      [[ {r:255,g:0,b:255},  {r:0,g:255,b:0}     ], [ {r:0,g:255,b:255},  {r:255,g:0,b:0}    ], [ {r:255,g:255,b:0}, {r:255,g:0,b:255} ]],
    outro:     [[ {r:0,g:80,b:120},   {r:0,g:30,b:60}     ], [ {r:60,g:0,b:100},   {r:20,g:0,b:50}    ]],
  },
  warm: {
    label: 'Warm',
    intro:     [[ {r:120,g:40,b:0},   {r:180,g:80,b:10}   ], [ {r:100,g:30,b:0},   {r:150,g:60,b:0}   ]],
    verse:     [[ {r:255,g:100,b:0},  {r:200,g:60,b:0}    ], [ {r:255,g:140,b:20}, {r:220,g:80,b:0}   ], [ {r:200,g:80,b:0}, {r:255,g:120,b:20} ]],
    chorus:    [[ {r:255,g:40,b:0},   {r:255,g:180,b:0}   ], [ {r:255,g:0,b:0},    {r:255,g:200,b:50} ], [ {r:255,g:80,b:0}, {r:200,g:0,b:0}   ]],
    bridge:    [[ {r:255,g:200,b:50}, {r:200,g:100,b:0}   ], [ {r:220,g:160,b:0},  {r:180,g:60,b:0}   ]],
    breakdown: [[ {r:120,g:60,b:20},  {r:80,g:30,b:0}     ], [ {r:100,g:50,b:10},  {r:60,g:20,b:0}    ]],
    buildup:   [[ {r:255,g:60,b:0},   {r:255,g:200,b:0}   ], [ {r:200,g:40,b:0},   {r:255,g:160,b:0}  ]],
    drop:      [[ {r:255,g:0,b:0},    {r:255,g:200,b:0}   ], [ {r:255,g:80,b:0},   {r:255,g:255,b:0}  ], [ {r:200,g:0,b:0}, {r:255,g:120,b:0} ]],
    outro:     [[ {r:100,g:40,b:10},  {r:40,g:15,b:0}     ], [ {r:80,g:30,b:5},    {r:20,g:8,b:0}     ]],
  },
  cool: {
    label: 'Cool',
    intro:     [[ {r:0,g:30,b:180},   {r:20,g:60,b:220}   ], [ {r:0,g:20,b:140},   {r:10,g:40,b:180}  ]],
    verse:     [[ {r:0,g:100,b:200},  {r:60,g:0,b:180}    ], [ {r:0,g:150,b:220},  {r:80,g:0,b:200}   ], [ {r:40,g:80,b:255}, {r:0,g:120,b:180} ]],
    chorus:    [[ {r:0,g:80,b:255},   {r:120,g:0,b:255}   ], [ {r:0,g:180,b:255},  {r:80,g:0,b:200}   ], [ {r:100,g:0,b:255}, {r:0,g:200,b:200} ]],
    bridge:    [[ {r:80,g:120,b:255}, {r:0,g:180,b:180}   ], [ {r:60,g:80,b:220},  {r:0,g:140,b:200}  ]],
    breakdown: [[ {r:0,g:40,b:120},   {r:0,g:20,b:80}     ], [ {r:20,g:30,b:100},  {r:0,g:15,b:60}    ]],
    buildup:   [[ {r:0,g:100,b:255},  {r:120,g:0,b:255}   ], [ {r:0,g:150,b:200},  {r:100,g:50,b:255} ]],
    drop:      [[ {r:0,g:0,b:255},    {r:200,g:0,b:255}   ], [ {r:0,g:100,b:255},  {r:150,g:0,b:200}  ], [ {r:80,g:0,b:255}, {r:0,g:200,b:255} ]],
    outro:     [[ {r:0,g:20,b:80},    {r:0,g:8,b:30}      ], [ {r:10,g:15,b:60},   {r:0,g:5,b:20}     ]],
  },
  pastel: {
    label: 'Pastel',
    intro:     [[ {r:180,g:200,b:255}, {r:200,g:180,b:240} ], [ {r:200,g:220,b:255}, {r:180,g:200,b:230} ]],
    verse:     [[ {r:180,g:255,b:200}, {r:200,g:180,b:255} ], [ {r:255,g:200,b:180}, {r:180,g:220,b:255} ], [ {r:220,g:200,b:255}, {r:200,g:255,b:220} ]],
    chorus:    [[ {r:255,g:180,b:200}, {r:200,g:180,b:255} ], [ {r:255,g:220,b:180}, {r:180,g:200,b:255} ], [ {r:255,g:200,b:220}, {r:180,g:255,b:200} ]],
    bridge:    [[ {r:255,g:240,b:180}, {r:200,g:180,b:255} ], [ {r:220,g:255,b:200}, {r:200,g:200,b:255} ]],
    breakdown: [[ {r:180,g:200,b:240}, {r:160,g:180,b:220} ], [ {r:200,g:200,b:230}, {r:180,g:190,b:210} ]],
    buildup:   [[ {r:255,g:200,b:180}, {r:200,g:180,b:255} ], [ {r:255,g:180,b:200}, {r:180,g:200,b:255} ]],
    drop:      [[ {r:255,g:180,b:200}, {r:180,g:200,b:255} ], [ {r:255,g:200,b:180}, {r:200,g:180,b:255} ], [ {r:200,g:255,b:200}, {r:255,g:200,b:255} ]],
    outro:     [[ {r:180,g:180,b:200}, {r:140,g:140,b:160} ], [ {r:160,g:170,b:190}, {r:120,g:130,b:150} ]],
  },
  fire: {
    label: 'Fire',
    intro:     [[ {r:80,g:20,b:0},    {r:140,g:40,b:0}    ], [ {r:60,g:10,b:0},    {r:100,g:30,b:0}   ]],
    verse:     [[ {r:255,g:60,b:0},   {r:200,g:30,b:0}    ], [ {r:255,g:100,b:0},  {r:180,g:20,b:0}   ], [ {r:220,g:80,b:0}, {r:255,g:40,b:0} ]],
    chorus:    [[ {r:255,g:0,b:0},    {r:255,g:200,b:0}   ], [ {r:255,g:80,b:0},   {r:255,g:255,b:0}  ], [ {r:200,g:0,b:0}, {r:255,g:150,b:0} ]],
    bridge:    [[ {r:255,g:150,b:0},  {r:200,g:60,b:0}    ], [ {r:255,g:180,b:30}, {r:180,g:40,b:0}   ]],
    breakdown: [[ {r:80,g:20,b:0},    {r:40,g:10,b:0}     ], [ {r:60,g:15,b:0},    {r:30,g:5,b:0}     ]],
    buildup:   [[ {r:255,g:80,b:0},   {r:255,g:0,b:0}     ], [ {r:200,g:60,b:0},   {r:255,g:200,b:0}  ]],
    drop:      [[ {r:255,g:0,b:0},    {r:255,g:255,b:0}   ], [ {r:255,g:100,b:0},  {r:255,g:0,b:0}    ], [ {r:200,g:0,b:0}, {r:255,g:200,b:0} ]],
    outro:     [[ {r:60,g:15,b:0},    {r:20,g:5,b:0}      ], [ {r:40,g:10,b:0},    {r:10,g:2,b:0}     ]],
  },
  ocean: {
    label: 'Ocean',
    intro:     [[ {r:0,g:40,b:120},   {r:0,g:80,b:160}    ], [ {r:0,g:30,b:100},   {r:0,g:60,b:140}   ]],
    verse:     [[ {r:0,g:120,b:200},  {r:0,g:180,b:180}   ], [ {r:0,g:100,b:220},  {r:0,g:200,b:160}  ], [ {r:0,g:160,b:200}, {r:0,g:200,b:180} ]],
    chorus:    [[ {r:0,g:200,b:255},  {r:0,g:100,b:200}   ], [ {r:0,g:255,b:200},  {r:0,g:120,b:255}  ], [ {r:0,g:180,b:255}, {r:0,g:255,b:180} ]],
    bridge:    [[ {r:0,g:180,b:200},  {r:0,g:120,b:160}   ], [ {r:0,g:200,b:180},  {r:0,g:140,b:180}  ]],
    breakdown: [[ {r:0,g:40,b:100},   {r:0,g:20,b:60}     ], [ {r:0,g:30,b:80},    {r:0,g:15,b:50}    ]],
    buildup:   [[ {r:0,g:150,b:255},  {r:0,g:200,b:200}   ], [ {r:0,g:100,b:200},  {r:0,g:255,b:180}  ]],
    drop:      [[ {r:0,g:200,b:255},  {r:0,g:255,b:200}   ], [ {r:0,g:150,b:255},  {r:0,g:255,b:255}  ], [ {r:0,g:255,b:150}, {r:0,g:100,b:255} ]],
    outro:     [[ {r:0,g:20,b:60},    {r:0,g:8,b:25}      ], [ {r:0,g:15,b:40},    {r:0,g:5,b:15}     ]],
  },
  sunset: {
    label: 'Sunset',
    intro:     [[ {r:120,g:40,b:80},  {r:160,g:60,b:100}  ], [ {r:100,g:30,b:60},  {r:140,g:50,b:90}  ]],
    verse:     [[ {r:255,g:100,b:60}, {r:200,g:60,b:120}   ], [ {r:255,g:120,b:80}, {r:180,g:40,b:140} ], [ {r:220,g:80,b:100}, {r:200,g:60,b:160} ]],
    chorus:    [[ {r:255,g:60,b:80},  {r:255,g:160,b:0}    ], [ {r:255,g:80,b:120}, {r:255,g:200,b:40} ], [ {r:200,g:40,b:160}, {r:255,g:120,b:0} ]],
    bridge:    [[ {r:200,g:120,b:160},{r:255,g:160,b:80}   ], [ {r:180,g:100,b:140},{r:220,g:140,b:60} ]],
    breakdown: [[ {r:100,g:40,b:80},  {r:60,g:20,b:50}     ], [ {r:80,g:30,b:60},   {r:40,g:15,b:40}  ]],
    buildup:   [[ {r:255,g:80,b:40},  {r:200,g:40,b:120}   ], [ {r:255,g:120,b:60}, {r:220,g:60,b:160}]],
    drop:      [[ {r:255,g:40,b:80},  {r:255,g:200,b:0}    ], [ {r:255,g:80,b:60},  {r:200,g:0,b:160} ], [ {r:255,g:0,b:120}, {r:255,g:180,b:40} ]],
    outro:     [[ {r:80,g:30,b:50},   {r:30,g:10,b:20}     ], [ {r:60,g:20,b:40},   {r:20,g:8,b:15}   ]],
  },
  uv: {
    label: 'UV / Blacklight',
    intro:     [[ {r:40,g:0,b:120},   {r:80,g:0,b:200}    ], [ {r:30,g:0,b:100},   {r:60,g:0,b:160}   ]],
    verse:     [[ {r:100,g:0,b:255},  {r:60,g:0,b:200}    ], [ {r:120,g:0,b:220},  {r:80,g:20,b:255}  ], [ {r:80,g:0,b:200}, {r:140,g:0,b:255} ]],
    chorus:    [[ {r:160,g:0,b:255},  {r:80,g:0,b:200}    ], [ {r:200,g:0,b:255},  {r:100,g:0,b:255}  ], [ {r:120,g:0,b:255}, {r:180,g:0,b:200} ]],
    bridge:    [[ {r:140,g:40,b:255}, {r:80,g:0,b:200}    ], [ {r:120,g:20,b:240}, {r:60,g:0,b:180}   ]],
    breakdown: [[ {r:30,g:0,b:80},    {r:15,g:0,b:40}     ], [ {r:20,g:0,b:60},    {r:10,g:0,b:30}    ]],
    buildup:   [[ {r:120,g:0,b:255},  {r:200,g:0,b:200}   ], [ {r:80,g:0,b:200},   {r:160,g:0,b:255}  ]],
    drop:      [[ {r:200,g:0,b:255},  {r:255,g:0,b:200}   ], [ {r:160,g:0,b:255},  {r:100,g:0,b:255}  ], [ {r:255,g:0,b:255}, {r:80,g:0,b:200} ]],
    outro:     [[ {r:20,g:0,b:60},    {r:8,g:0,b:25}      ], [ {r:15,g:0,b:40},    {r:5,g:0,b:15}     ]],
  },
  forest: {
    label: 'Forest',
    intro:     [[ {r:0,g:60,b:20},    {r:20,g:100,b:40}   ], [ {r:0,g:40,b:10},    {r:10,g:80,b:30}   ]],
    verse:     [[ {r:0,g:180,b:60},   {r:40,g:200,b:80}   ], [ {r:20,g:160,b:40},  {r:60,g:220,b:100} ], [ {r:0,g:200,b:80}, {r:80,g:180,b:40} ]],
    chorus:    [[ {r:80,g:255,b:0},   {r:0,g:200,b:100}   ], [ {r:40,g:255,b:60},  {r:0,g:220,b:80}   ], [ {r:100,g:255,b:40}, {r:0,g:180,b:120} ]],
    bridge:    [[ {r:100,g:200,b:60}, {r:40,g:160,b:80}   ], [ {r:80,g:220,b:40},  {r:20,g:180,b:60}  ]],
    breakdown: [[ {r:0,g:40,b:15},    {r:0,g:20,b:8}      ], [ {r:0,g:30,b:10},    {r:0,g:15,b:5}     ]],
    buildup:   [[ {r:60,g:200,b:0},   {r:0,g:255,b:80}    ], [ {r:40,g:180,b:0},   {r:80,g:255,b:40}  ]],
    drop:      [[ {r:0,g:255,b:0},    {r:100,g:255,b:0}   ], [ {r:60,g:255,b:40},  {r:0,g:200,b:0}    ], [ {r:80,g:255,b:0}, {r:0,g:255,b:80} ]],
    outro:     [[ {r:0,g:30,b:10},    {r:0,g:10,b:5}      ], [ {r:0,g:20,b:8},     {r:0,g:5,b:2}      ]],
  },
  party: {
    label: 'Party Mix',
    intro:     [[ {r:200,g:0,b:200},  {r:0,g:100,b:255}   ], [ {r:100,g:0,b:255},  {r:0,g:200,b:200}  ]],
    verse:     [[ {r:255,g:0,b:100},  {r:0,g:255,b:100}   ], [ {r:255,g:200,b:0},  {r:0,g:100,b:255}  ], [ {r:0,g:255,b:200}, {r:255,g:0,b:200} ], [ {r:100,g:255,b:0}, {r:255,g:0,b:100} ]],
    chorus:    [[ {r:255,g:0,b:0},    {r:0,g:0,b:255}     ], [ {r:255,g:255,b:0},  {r:0,g:255,b:255}  ], [ {r:255,g:0,b:255}, {r:0,g:255,b:0}  ], [ {r:255,g:100,b:0}, {r:0,g:200,b:255} ]],
    bridge:    [[ {r:0,g:255,b:200},  {r:255,g:200,b:0}   ], [ {r:200,g:100,b:255},{r:0,g:200,b:100}  ]],
    breakdown: [[ {r:60,g:0,b:100},   {r:0,g:60,b:100}    ], [ {r:40,g:0,b:80},    {r:0,g:40,b:80}    ]],
    buildup:   [[ {r:255,g:0,b:200},  {r:255,g:200,b:0}   ], [ {r:0,g:255,b:200},  {r:255,g:0,b:100}  ]],
    drop:      [[ {r:255,g:0,b:0},    {r:0,g:255,b:0}     ], [ {r:0,g:0,b:255},    {r:255,g:255,b:0}  ], [ {r:255,g:0,b:255}, {r:0,g:255,b:255} ], [ {r:255,g:100,b:0}, {r:100,g:0,b:255} ]],
    outro:     [[ {r:60,g:0,b:80},    {r:20,g:0,b:30}     ], [ {r:0,g:40,b:60},    {r:0,g:15,b:25}    ]],
  },
  gold: {
    label: 'Gold & Amber',
    intro:     [[ {r:80,g:50,b:0},    {r:140,g:90,b:10}  ], [ {r:100,g:60,b:0},   {r:180,g:120,b:20} ]],
    verse:     [[ {r:255,g:180,b:0},  {r:200,g:120,b:0}  ], [ {r:255,g:200,b:40}, {r:180,g:100,b:0}  ], [ {r:220,g:160,b:0}, {r:255,g:220,b:60} ]],
    chorus:    [[ {r:255,g:215,b:0},  {r:255,g:140,b:0}  ], [ {r:255,g:180,b:30}, {r:200,g:80,b:0}   ], [ {r:255,g:200,b:50}, {r:255,g:120,b:0} ]],
    bridge:    [[ {r:200,g:150,b:40}, {r:255,g:180,b:60} ], [ {r:180,g:120,b:30}, {r:220,g:160,b:50} ]],
    breakdown: [[ {r:60,g:40,b:10},   {r:30,g:20,b:0}    ], [ {r:80,g:50,b:5},    {r:40,g:25,b:0}    ]],
    buildup:   [[ {r:255,g:160,b:0},  {r:255,g:200,b:40} ], [ {r:220,g:140,b:0},  {r:255,g:180,b:20} ]],
    drop:      [[ {r:255,g:200,b:0},  {r:255,g:120,b:0}  ], [ {r:255,g:180,b:30}, {r:200,g:80,b:0}   ], [ {r:255,g:220,b:60}, {r:255,g:140,b:0} ]],
    outro:     [[ {r:80,g:50,b:10},   {r:30,g:20,b:0}    ], [ {r:60,g:35,b:5},    {r:20,g:12,b:0}    ]],
  },
  ice: {
    label: 'Ice & Frost',
    intro:     [[ {r:180,g:220,b:255}, {r:120,g:180,b:240} ], [ {r:200,g:240,b:255}, {r:100,g:160,b:220} ]],
    verse:     [[ {r:220,g:240,b:255}, {r:180,g:200,b:255} ], [ {r:200,g:255,b:255}, {r:150,g:180,b:240} ], [ {r:240,g:250,b:255}, {r:180,g:220,b:255} ]],
    chorus:    [[ {r:255,g:255,b:255}, {r:180,g:220,b:255} ], [ {r:220,g:255,b:255}, {r:200,g:240,b:255} ], [ {r:255,g:255,b:255}, {r:160,g:200,b:255} ]],
    bridge:    [[ {r:200,g:230,b:255}, {r:160,g:190,b:240} ], [ {r:180,g:220,b:255}, {r:140,g:170,b:230} ]],
    breakdown: [[ {r:100,g:140,b:180}, {r:60,g:90,b:140}  ], [ {r:80,g:120,b:160},  {r:50,g:70,b:120}  ]],
    buildup:   [[ {r:200,g:240,b:255}, {r:255,g:255,b:255} ], [ {r:180,g:220,b:255}, {r:240,g:250,b:255} ]],
    drop:      [[ {r:255,g:255,b:255}, {r:200,g:240,b:255} ], [ {r:220,g:255,b:255}, {r:255,g:255,b:255} ], [ {r:180,g:230,b:255}, {r:255,g:255,b:255} ]],
    outro:     [[ {r:80,g:110,b:150},  {r:40,g:55,b:80}   ], [ {r:60,g:85,b:120},   {r:30,g:40,b:60}   ]],
  },
  candy: {
    label: 'Candy Pop',
    intro:     [[ {r:255,g:120,b:180}, {r:120,g:255,b:200} ], [ {r:255,g:180,b:220}, {r:180,g:255,b:180} ]],
    verse:     [[ {r:255,g:100,b:150}, {r:100,g:255,b:180} ], [ {r:255,g:200,b:100}, {r:150,g:255,b:150} ], [ {r:255,g:150,b:200}, {r:200,g:255,b:100} ]],
    chorus:    [[ {r:255,g:80,b:180},  {r:80,g:255,b:200}  ], [ {r:255,g:180,b:80},  {r:180,g:80,b:255}  ], [ {r:255,g:120,b:200}, {r:120,g:255,b:120} ]],
    bridge:    [[ {r:255,g:200,b:150}, {r:150,g:200,b:255} ], [ {r:200,g:255,b:180}, {r:255,g:150,b:200} ]],
    breakdown: [[ {r:180,g:100,b:140}, {r:100,g:140,b:180} ], [ {r:160,g:120,b:160}, {r:120,g:160,b:180} ]],
    buildup:   [[ {r:255,g:150,b:180}, {r:150,g:255,b:200} ], [ {r:255,g:200,b:120}, {r:120,g:255,b:180} ]],
    drop:      [[ {r:255,g:80,b:200},  {r:80,g:255,b:180}  ], [ {r:255,g:200,b:80},  {r:80,g:200,b:255}  ], [ {r:255,g:120,b:255}, {r:255,g:255,b:100} ]],
    outro:     [[ {r:160,g:80,b:120},  {r:80,g:100,b:140}  ], [ {r:140,g:90,b:130},  {r:60,g:70,b:100}  ]],
  },
  noir: {
    label: 'Noir / Dark',
    intro:     [[ {r:80,g:0,b:40},    {r:20,g:0,b:30}    ], [ {r:60,g:0,b:60},    {r:15,g:0,b:25}    ]],
    verse:     [[ {r:180,g:0,b:80},   {r:60,g:0,b:100}   ], [ {r:140,g:0,b:60},   {r:80,g:0,b:140}   ], [ {r:200,g:0,b:100},  {r:40,g:0,b:80}    ]],
    chorus:    [[ {r:255,g:0,b:80},   {r:120,g:0,b:180}  ], [ {r:200,g:0,b:60},   {r:80,g:0,b:200}   ], [ {r:255,g:0,b:120},  {r:60,g:0,b:160}   ]],
    bridge:    [[ {r:160,g:0,b:100},  {r:80,g:0,b:120}   ], [ {r:140,g:0,b:80},   {r:60,g:0,b:100}   ]],
    breakdown: [[ {r:30,g:0,b:20},    {r:10,g:0,b:15}    ], [ {r:20,g:0,b:30},    {r:8,g:0,b:12}     ]],
    buildup:   [[ {r:180,g:0,b:60},   {r:80,g:0,b:140}   ], [ {r:200,g:0,b:80},   {r:60,g:0,b:160}   ]],
    drop:      [[ {r:255,g:0,b:60},   {r:100,g:0,b:200}  ], [ {r:220,g:0,b:80},   {r:80,g:0,b:220}   ], [ {r:255,g:0,b:100},  {r:120,g:0,b:180}  ]],
    outro:     [[ {r:40,g:0,b:25},    {r:10,g:0,b:10}    ], [ {r:25,g:0,b:20},    {r:5,g:0,b:8}      ]],
  },
  tropical: {
    label: 'Tropical',
    intro:     [[ {r:0,g:180,b:120},  {r:255,g:120,b:60}  ], [ {r:0,g:200,b:140},  {r:255,g:160,b:80} ]],
    verse:     [[ {r:0,g:255,b:160},  {r:255,g:180,b:0}  ], [ {r:255,g:80,b:120}, {r:0,g:220,b:180}  ], [ {r:255,g:200,b:0},  {r:0,g:200,b:200} ]],
    chorus:    [[ {r:255,g:60,b:100}, {r:0,g:255,b:180}  ], [ {r:255,g:200,b:0},  {r:0,g:200,b:255}  ], [ {r:255,g:120,b:60}, {r:0,g:255,b:140} ]],
    bridge:    [[ {r:255,g:180,b:80}, {r:0,g:200,b:160}  ], [ {r:255,g:140,b:100}, {r:0,g:180,b:200} ]],
    breakdown: [[ {r:0,g:100,b:80},   {r:80,g:60,b:40}   ], [ {r:0,g:80,b:60},    {r:60,g:40,b:30}   ]],
    buildup:   [[ {r:255,g:140,b:60}, {r:0,g:255,b:160} ], [ {r:255,g:200,b:0},  {r:0,g:220,b:200} ]],
    drop:      [[ {r:255,g:80,b:100}, {r:0,g:255,b:200}  ], [ {r:255,g:200,b:0},  {r:0,g:200,b:255}  ], [ {r:255,g:120,b:60}, {r:0,g:255,b:180} ]],
    outro:     [[ {r:0,g:80,b:60},    {r:40,g:40,b:20}   ], [ {r:0,g:60,b:50},    {r:30,g:30,b:15}   ]],
  },
  retro: {
    label: 'Retro / Synthwave',
    intro:     [[ {r:255,g:0,b:120},  {r:80,g:0,b:180}   ], [ {r:200,g:0,b:160},  {r:0,g:180,b:255}  ]],
    verse:     [[ {r:255,g:0,b:180},  {r:0,g:200,b:255}  ], [ {r:200,g:0,b:255},  {r:255,g:60,b:120} ], [ {r:255,g:0,b:200},  {r:0,g:255,b:220} ]],
    chorus:    [[ {r:255,g:0,b:255},  {r:0,g:255,b:255}  ], [ {r:255,g:60,b:180}, {r:0,g:200,b:255}  ], [ {r:200,g:0,b:255},  {r:255,g:0,b:120} ]],
    bridge:    [[ {r:180,g:0,b:200},  {r:0,g:180,b:220}  ], [ {r:255,g:0,b:160},  {r:80,g:0,b:200}   ]],
    breakdown: [[ {r:60,g:0,b:100},   {r:0,g:60,b:120}   ], [ {r:40,g:0,b:80},    {r:0,g:40,b:100}   ]],
    buildup:   [[ {r:255,g:0,b:200},  {r:0,g:255,b:255}  ], [ {r:200,g:0,b:255},  {r:255,g:0,b:120} ]],
    drop:      [[ {r:255,g:0,b:255},  {r:0,g:255,b:200}  ], [ {r:255,g:60,b:180}, {r:0,g:200,b:255}  ], [ {r:200,g:0,b:255},  {r:255,g:255,b:0} ]],
    outro:     [[ {r:40,g:0,b:60},    {r:0,g:20,b:40}    ], [ {r:30,g:0,b:50},    {r:0,g:15,b:30}    ]],
  },
  aurora: {
    label: 'Aurora',
    intro:     [[ {r:0,g:120,b:80},   {r:80,g:0,b:160}   ], [ {r:0,g:160,b:100},  {r:120,g:0,b:200}  ]],
    verse:     [[ {r:0,g:255,b:120},  {r:160,g:0,b:255}  ], [ {r:0,g:200,b:180},  {r:200,g:0,b:200}  ], [ {r:80,g:255,b:100}, {r:120,g:0,b:255} ]],
    chorus:    [[ {r:0,g:255,b:160},  {r:200,g:0,b:255}  ], [ {r:80,g:255,b:120}, {r:160,g:0,b:220}  ], [ {r:0,g:220,b:200},  {r:255,g:0,b:180} ]],
    bridge:    [[ {r:0,g:200,b:140},  {r:140,g:0,b:200}  ], [ {r:60,g:255,b:100}, {r:100,g:0,b:180}  ]],
    breakdown: [[ {r:0,g:60,b:40},    {r:40,g:0,b:80}    ], [ {r:0,g:40,b:60},    {r:30,g:0,b:60}    ]],
    buildup:   [[ {r:0,g:220,b:140},  {r:180,g:0,b:255}  ], [ {r:60,g:255,b:80},  {r:140,g:0,b:220} ]],
    drop:      [[ {r:0,g:255,b:180},  {r:255,g:0,b:200}  ], [ {r:80,g:255,b:120}, {r:200,g:0,b:255}  ], [ {r:0,g:255,b:120},  {r:255,g:80,b:200} ]],
    outro:     [[ {r:0,g:40,b:30},    {r:20,g:0,b:50}    ], [ {r:0,g:30,b:40},    {r:15,g:0,b:40}    ]],
  },
  crimson: {
    label: 'Crimson',
    intro:     [[ {r:120,g:0,b:30},   {r:60,g:0,b:40}    ], [ {r:100,g:0,b:20},   {r:40,g:0,b:30}    ]],
    verse:     [[ {r:220,g:0,b:60},   {r:180,g:0,b:80}    ], [ {r:255,g:0,b:80},   {r:160,g:0,b:100}  ], [ {r:200,g:0,b:40},  {r:255,g:0,b:120} ]],
    chorus:    [[ {r:255,g:0,b:60},   {r:255,g:0,b:160}  ], [ {r:255,g:40,b:0},  {r:200,g:0,b:180}  ], [ {r:255,g:0,b:100},  {r:255,g:60,b:0}  ]],
    bridge:    [[ {r:200,g:0,b:80},   {r:255,g:0,b:140}  ], [ {r:180,g:0,b:60},   {r:220,g:0,b:160}  ]],
    breakdown: [[ {r:60,g:0,b:20},    {r:30,g:0,b:15}    ], [ {r:40,g:0,b:25},    {r:20,g:0,b:10}    ]],
    buildup:   [[ {r:255,g:0,b:40},   {r:255,g:0,b:140}  ], [ {r:220,g:0,b:60},   {r:255,g:40,b:0}   ]],
    drop:      [[ {r:255,g:0,b:0},    {r:255,g:0,b:180}  ], [ {r:255,g:0,b:80},   {r:200,g:0,b:255}  ], [ {r:255,g:40,b:0},  {r:255,g:0,b:120} ]],
    outro:     [[ {r:50,g:0,b:15},    {r:15,g:0,b:8}      ], [ {r:35,g:0,b:12},    {r:10,g:0,b:5}      ]],
  },
};

const colorPalettes = applyPaletteExpansion(rawColorPalettes);

const PALETTE_KEYS = Object.keys(colorPalettes);
const ALL_PALETTE_OPTIONS = [...PALETTE_KEYS, 'random'];

// ─── Genre-Specific Color Palettes ──────────────────────────────────────────
const genrePalettes = {
  electronic: {
    label: 'Electronic / EDM',
    intro:     [[ {r:0,g:60,b:200},    {r:80,g:0,b:180}   ], [ {r:0,g:120,b:255},  {r:120,g:0,b:200}  ]],
    verse:     [[ {r:0,g:200,b:255},   {r:200,g:0,b:255}  ], [ {r:0,g:255,b:200},  {r:255,g:0,b:150}  ], [ {r:80,g:0,b:255},  {r:0,g:255,b:255}  ]],
    chorus:    [[ {r:255,g:0,b:200},   {r:0,g:255,b:100}  ], [ {r:0,g:200,b:255},  {r:255,g:0,b:255}  ], [ {r:255,g:0,b:100}, {r:0,g:255,b:255}  ], [ {r:200,g:0,b:255}, {r:0,g:255,b:0}    ]],
    bridge:    [[ {r:60,g:0,b:255},    {r:0,g:200,b:200}  ], [ {r:120,g:0,b:220},  {r:0,g:180,b:255}  ]],
    breakdown: [[ {r:0,g:40,b:140},    {r:60,g:0,b:100}   ], [ {r:0,g:60,b:120},   {r:40,g:0,b:120}   ]],
    buildup:   [[ {r:0,g:150,b:255},   {r:200,g:0,b:255}  ], [ {r:255,g:0,b:200},  {r:0,g:255,b:200}  ]],
    drop:      [[ {r:255,g:0,b:255},   {r:0,g:255,b:0}    ], [ {r:0,g:255,b:255},  {r:255,g:0,b:0}    ], [ {r:255,g:255,b:0}, {r:0,g:0,b:255}    ], [ {r:255,g:0,b:100}, {r:0,g:255,b:200}  ]],
    outro:     [[ {r:0,g:30,b:100},    {r:40,g:0,b:80}    ], [ {r:0,g:20,b:80},    {r:30,g:0,b:60}    ]],
  },
  house: {
    label: 'House / Techno',
    intro:     [[ {r:40,g:0,b:160},    {r:100,g:20,b:200} ], [ {r:20,g:0,b:120},   {r:80,g:10,b:180}  ]],
    verse:     [[ {r:100,g:0,b:220},   {r:200,g:40,b:180} ], [ {r:60,g:0,b:200},   {r:180,g:0,b:200}  ], [ {r:0,g:60,b:220},  {r:220,g:0,b:160}  ]],
    chorus:    [[ {r:200,g:0,b:200},   {r:0,g:100,b:255}  ], [ {r:255,g:40,b:180}, {r:0,g:200,b:255}  ], [ {r:220,g:0,b:255}, {r:60,g:0,b:200}   ]],
    bridge:    [[ {r:120,g:0,b:200},   {r:0,g:80,b:200}   ], [ {r:180,g:20,b:200}, {r:0,g:100,b:180}  ]],
    breakdown: [[ {r:30,g:0,b:80},     {r:20,g:0,b:60}    ], [ {r:40,g:0,b:100},   {r:10,g:0,b:50}    ]],
    buildup:   [[ {r:120,g:0,b:255},   {r:200,g:0,b:200}  ], [ {r:0,g:100,b:255},  {r:180,g:0,b:220}  ]],
    drop:      [[ {r:255,g:0,b:200},   {r:0,g:100,b:255}  ], [ {r:200,g:0,b:255},  {r:0,g:200,b:200}  ], [ {r:255,g:60,b:200},{r:0,g:150,b:255}  ]],
    outro:     [[ {r:30,g:0,b:80},     {r:15,g:0,b:40}    ], [ {r:20,g:0,b:60},    {r:10,g:0,b:30}    ]],
  },
  trance: {
    label: 'Trance',
    intro:     [[ {r:0,g:40,b:180},    {r:0,g:80,b:220}   ], [ {r:0,g:30,b:140},   {r:0,g:60,b:200}   ]],
    verse:     [[ {r:0,g:100,b:255},   {r:0,g:200,b:220}  ], [ {r:40,g:60,b:255},  {r:0,g:180,b:255}  ], [ {r:0,g:150,b:200}, {r:80,g:100,b:255} ]],
    chorus:    [[ {r:0,g:180,b:255},   {r:100,g:0,b:255}  ], [ {r:80,g:200,b:255}, {r:0,g:100,b:255}  ], [ {r:0,g:255,b:255}, {r:60,g:0,b:200}   ]],
    bridge:    [[ {r:60,g:120,b:255},  {r:0,g:200,b:200}  ], [ {r:40,g:80,b:220},  {r:0,g:180,b:180}  ]],
    breakdown: [[ {r:0,g:20,b:100},    {r:0,g:40,b:80}    ], [ {r:0,g:15,b:80},    {r:0,g:30,b:60}    ]],
    buildup:   [[ {r:0,g:120,b:255},   {r:100,g:200,b:255}], [ {r:0,g:180,b:255},  {r:60,g:100,b:255} ]],
    drop:      [[ {r:100,g:200,b:255}, {r:0,g:0,b:255}    ], [ {r:0,g:255,b:255},  {r:80,g:0,b:255}   ], [ {r:200,g:200,b:255},{r:0,g:100,b:255} ]],
    outro:     [[ {r:0,g:15,b:80},     {r:0,g:5,b:30}     ], [ {r:0,g:10,b:60},    {r:0,g:3,b:20}     ]],
  },
  dnb: {
    label: 'Drum & Bass',
    intro:     [[ {r:120,g:40,b:0},    {r:180,g:60,b:0}   ], [ {r:80,g:20,b:0},    {r:140,g:40,b:0}   ]],
    verse:     [[ {r:255,g:80,b:0},    {r:200,g:40,b:0}   ], [ {r:255,g:120,b:0},  {r:180,g:0,b:0}    ], [ {r:200,g:60,b:0},  {r:255,g:100,b:0}  ]],
    chorus:    [[ {r:255,g:40,b:0},    {r:255,g:0,b:0}    ], [ {r:255,g:100,b:0},  {r:200,g:0,b:0}    ], [ {r:255,g:0,b:0},   {r:255,g:200,b:0}  ]],
    bridge:    [[ {r:200,g:80,b:0},    {r:255,g:120,b:0}  ], [ {r:180,g:40,b:0},   {r:220,g:80,b:0}   ]],
    breakdown: [[ {r:60,g:15,b:0},     {r:30,g:8,b:0}     ], [ {r:40,g:10,b:0},    {r:20,g:5,b:0}     ]],
    buildup:   [[ {r:255,g:60,b:0},    {r:255,g:0,b:0}    ], [ {r:200,g:40,b:0},   {r:255,g:100,b:0}  ]],
    drop:      [[ {r:255,g:0,b:0},     {r:255,g:255,b:0}  ], [ {r:255,g:80,b:0},   {r:255,g:0,b:0}    ], [ {r:200,g:0,b:0},   {r:255,g:200,b:0}  ]],
    outro:     [[ {r:60,g:15,b:0},     {r:20,g:5,b:0}     ], [ {r:40,g:10,b:0},    {r:10,g:3,b:0}     ]],
  },
  hiphop: {
    label: 'Hip-Hop / Rap',
    intro:     [[ {r:100,g:50,b:0},    {r:60,g:0,b:100}   ], [ {r:80,g:40,b:0},    {r:40,g:0,b:80}    ]],
    verse:     [[ {r:200,g:120,b:0},   {r:100,g:0,b:180}  ], [ {r:180,g:100,b:0},  {r:80,g:0,b:160}   ], [ {r:220,g:140,b:0}, {r:120,g:0,b:200}  ]],
    chorus:    [[ {r:255,g:180,b:0},   {r:150,g:0,b:255}  ], [ {r:255,g:200,b:40}, {r:120,g:0,b:200}  ], [ {r:200,g:150,b:0}, {r:180,g:0,b:255}  ]],
    bridge:    [[ {r:180,g:100,b:20},  {r:80,g:0,b:140}   ], [ {r:200,g:120,b:0},  {r:60,g:0,b:120}   ]],
    breakdown: [[ {r:60,g:30,b:0},     {r:30,g:0,b:50}    ], [ {r:40,g:20,b:0},    {r:20,g:0,b:40}    ]],
    buildup:   [[ {r:200,g:120,b:0},   {r:120,g:0,b:200}  ], [ {r:255,g:160,b:0},  {r:100,g:0,b:180}  ]],
    drop:      [[ {r:255,g:200,b:0},   {r:180,g:0,b:255}  ], [ {r:255,g:160,b:0},  {r:100,g:0,b:200}  ], [ {r:200,g:140,b:0}, {r:150,g:0,b:255}  ]],
    outro:     [[ {r:60,g:30,b:0},     {r:20,g:0,b:40}    ], [ {r:40,g:20,b:0},    {r:15,g:0,b:30}    ]],
  },
  rnb: {
    label: 'R&B / Soul',
    intro:     [[ {r:100,g:20,b:60},   {r:60,g:0,b:80}    ], [ {r:80,g:15,b:50},   {r:50,g:0,b:70}    ]],
    verse:     [[ {r:200,g:60,b:100},  {r:100,g:0,b:140}  ], [ {r:180,g:40,b:120}, {r:120,g:0,b:160}  ], [ {r:220,g:80,b:80}, {r:80,g:0,b:120}   ]],
    chorus:    [[ {r:255,g:80,b:120},  {r:140,g:0,b:200}  ], [ {r:255,g:120,b:100},{r:100,g:0,b:180}  ], [ {r:200,g:60,b:140},{r:180,g:0,b:200}  ]],
    bridge:    [[ {r:180,g:80,b:120},  {r:80,g:0,b:100}   ], [ {r:200,g:100,b:140},{r:60,g:0,b:80}    ]],
    breakdown: [[ {r:60,g:15,b:40},    {r:30,g:0,b:40}    ], [ {r:50,g:10,b:30},   {r:25,g:0,b:35}    ]],
    buildup:   [[ {r:200,g:60,b:100},  {r:140,g:0,b:180}  ], [ {r:255,g:80,b:120}, {r:100,g:0,b:160}  ]],
    drop:      [[ {r:255,g:80,b:120},  {r:180,g:0,b:220}  ], [ {r:255,g:120,b:100},{r:140,g:0,b:200}  ], [ {r:200,g:60,b:160},{r:120,g:0,b:180}  ]],
    outro:     [[ {r:60,g:15,b:40},    {r:20,g:0,b:30}    ], [ {r:40,g:10,b:30},   {r:15,g:0,b:20}    ]],
  },
  pop: {
    label: 'Pop',
    intro:     [[ {r:200,g:0,b:150},   {r:0,g:150,b:255}  ], [ {r:150,g:0,b:200},  {r:0,g:200,b:200}  ]],
    verse:     [[ {r:255,g:0,b:150},   {r:0,g:200,b:200}  ], [ {r:0,g:255,b:150},  {r:255,g:0,b:200}  ], [ {r:255,g:200,b:0}, {r:0,g:150,b:255}  ], [ {r:0,g:255,b:200}, {r:255,g:100,b:0}  ]],
    chorus:    [[ {r:255,g:0,b:200},   {r:0,g:255,b:100}  ], [ {r:255,g:255,b:0},  {r:0,g:200,b:255}  ], [ {r:0,g:255,b:0},   {r:255,g:0,b:255}  ], [ {r:255,g:100,b:0}, {r:0,g:200,b:255}  ]],
    bridge:    [[ {r:200,g:100,b:255}, {r:0,g:200,b:150}  ], [ {r:255,g:150,b:0},  {r:0,g:180,b:255}  ]],
    breakdown: [[ {r:80,g:0,b:100},    {r:0,g:60,b:100}   ], [ {r:60,g:0,b:80},    {r:0,g:50,b:80}    ]],
    buildup:   [[ {r:255,g:0,b:200},   {r:0,g:255,b:200}  ], [ {r:255,g:200,b:0},  {r:255,g:0,b:100}  ]],
    drop:      [[ {r:255,g:0,b:100},   {r:0,g:255,b:0}    ], [ {r:0,g:0,b:255},    {r:255,g:255,b:0}  ], [ {r:255,g:0,b:255}, {r:0,g:255,b:255}  ], [ {r:255,g:100,b:0}, {r:0,g:200,b:255}  ]],
    outro:     [[ {r:80,g:0,b:60},     {r:0,g:40,b:60}    ], [ {r:60,g:0,b:40},    {r:0,g:30,b:50}    ]],
  },
  rock: {
    label: 'Rock',
    intro:     [[ {r:120,g:20,b:0},    {r:180,g:60,b:0}   ], [ {r:80,g:10,b:0},    {r:140,g:40,b:0}   ]],
    verse:     [[ {r:255,g:40,b:0},    {r:200,g:80,b:0}   ], [ {r:200,g:0,b:0},    {r:255,g:120,b:0}  ], [ {r:255,g:80,b:0},  {r:180,g:0,b:0}    ]],
    chorus:    [[ {r:255,g:0,b:0},     {r:255,g:200,b:0}  ], [ {r:255,g:60,b:0},   {r:255,g:255,b:200}], [ {r:200,g:0,b:0},   {r:255,g:160,b:0}  ]],
    bridge:    [[ {r:200,g:100,b:0},   {r:180,g:40,b:0}   ], [ {r:255,g:120,b:40}, {r:200,g:60,b:0}   ]],
    breakdown: [[ {r:80,g:20,b:0},     {r:40,g:10,b:0}    ], [ {r:60,g:15,b:0},    {r:30,g:5,b:0}     ]],
    buildup:   [[ {r:255,g:40,b:0},    {r:255,g:0,b:0}    ], [ {r:200,g:60,b:0},   {r:255,g:180,b:0}  ]],
    drop:      [[ {r:255,g:0,b:0},     {r:255,g:255,b:200}], [ {r:255,g:80,b:0},   {r:200,g:0,b:0}    ], [ {r:255,g:200,b:0}, {r:255,g:0,b:0}    ]],
    outro:     [[ {r:80,g:20,b:0},     {r:20,g:5,b:0}     ], [ {r:60,g:15,b:0},    {r:10,g:3,b:0}     ]],
  },
  latin: {
    label: 'Latin / Reggaeton',
    intro:     [[ {r:200,g:60,b:0},    {r:255,g:0,b:120}  ], [ {r:160,g:40,b:0},   {r:200,g:0,b:100}  ]],
    verse:     [[ {r:255,g:100,b:0},   {r:255,g:0,b:150}  ], [ {r:0,g:200,b:180},  {r:255,g:80,b:0}   ], [ {r:255,g:0,b:100}, {r:255,g:180,b:0}  ]],
    chorus:    [[ {r:255,g:0,b:150},   {r:255,g:200,b:0}  ], [ {r:0,g:220,b:200},  {r:255,g:0,b:100}  ], [ {r:255,g:100,b:0}, {r:0,g:200,b:200}  ]],
    bridge:    [[ {r:255,g:140,b:0},   {r:200,g:0,b:120}  ], [ {r:0,g:180,b:160},  {r:255,g:80,b:0}   ]],
    breakdown: [[ {r:80,g:30,b:0},     {r:60,g:0,b:40}    ], [ {r:60,g:20,b:0},    {r:40,g:0,b:30}    ]],
    buildup:   [[ {r:255,g:60,b:0},    {r:255,g:0,b:150}  ], [ {r:0,g:200,b:180},  {r:255,g:100,b:0}  ]],
    drop:      [[ {r:255,g:0,b:150},   {r:0,g:255,b:200}  ], [ {r:255,g:200,b:0},  {r:255,g:0,b:100}  ], [ {r:0,g:220,b:200},{r:255,g:80,b:0}   ]],
    outro:     [[ {r:80,g:30,b:0},     {r:40,g:0,b:30}    ], [ {r:60,g:20,b:0},    {r:30,g:0,b:20}    ]],
  },
  ambient: {
    label: 'Ambient / Chill',
    intro:     [[ {r:0,g:30,b:100},    {r:30,g:20,b:80}   ], [ {r:0,g:20,b:80},    {r:20,g:15,b:60}   ]],
    verse:     [[ {r:0,g:80,b:140},    {r:40,g:40,b:120}  ], [ {r:0,g:100,b:120},  {r:60,g:30,b:100}  ], [ {r:30,g:60,b:140}, {r:0,g:80,b:100}   ]],
    chorus:    [[ {r:0,g:120,b:180},   {r:80,g:60,b:160}  ], [ {r:40,g:100,b:200}, {r:60,g:40,b:140}  ], [ {r:0,g:140,b:160}, {r:100,g:60,b:180} ]],
    bridge:    [[ {r:40,g:60,b:140},   {r:0,g:80,b:120}   ], [ {r:30,g:50,b:120},  {r:0,g:60,b:100}   ]],
    breakdown: [[ {r:0,g:15,b:60},     {r:10,g:10,b:40}   ], [ {r:0,g:10,b:50},    {r:8,g:8,b:30}     ]],
    buildup:   [[ {r:0,g:80,b:160},    {r:60,g:40,b:140}  ], [ {r:0,g:100,b:140},  {r:40,g:30,b:120}  ]],
    drop:      [[ {r:0,g:120,b:200},   {r:80,g:60,b:180}  ], [ {r:40,g:100,b:180}, {r:0,g:80,b:160}   ]],
    outro:     [[ {r:0,g:10,b:50},     {r:5,g:5,b:25}     ], [ {r:0,g:8,b:40},     {r:4,g:4,b:20}     ]],
  },
  reggae: {
    label: 'Reggae / Dub',
    intro:     [[ {r:0,g:80,b:20},     {r:180,g:140,b:0}  ], [ {r:0,g:60,b:15},    {r:140,g:100,b:0}  ]],
    verse:     [[ {r:0,g:200,b:40},    {r:255,g:180,b:0}  ], [ {r:200,g:0,b:0},    {r:0,g:180,b:40}   ], [ {r:255,g:200,b:0}, {r:0,g:160,b:30}   ]],
    chorus:    [[ {r:0,g:255,b:40},    {r:255,g:200,b:0}  ], [ {r:200,g:0,b:0},    {r:0,g:200,b:40}   ], [ {r:255,g:220,b:0}, {r:200,g:0,b:0}    ]],
    bridge:    [[ {r:0,g:160,b:30},    {r:200,g:160,b:0}  ], [ {r:180,g:0,b:0},    {r:0,g:140,b:25}   ]],
    breakdown: [[ {r:0,g:40,b:10},     {r:60,g:40,b:0}    ], [ {r:0,g:30,b:8},     {r:40,g:30,b:0}    ]],
    buildup:   [[ {r:0,g:180,b:30},    {r:255,g:180,b:0}  ], [ {r:200,g:0,b:0},    {r:0,g:200,b:40}   ]],
    drop:      [[ {r:0,g:255,b:40},    {r:255,g:0,b:0}    ], [ {r:255,g:200,b:0},  {r:0,g:200,b:40}   ], [ {r:200,g:0,b:0},  {r:255,g:220,b:0}  ]],
    outro:     [[ {r:0,g:30,b:8},      {r:40,g:30,b:0}    ], [ {r:0,g:20,b:5},     {r:30,g:20,b:0}    ]],
  },
  metal: {
    label: 'Metal / Hardcore',
    intro:     [[ {r:100,g:0,b:0},     {r:40,g:0,b:60}    ], [ {r:80,g:0,b:0},     {r:30,g:0,b:50}    ]],
    verse:     [[ {r:200,g:0,b:0},     {r:80,g:0,b:120}   ], [ {r:180,g:0,b:0},    {r:60,g:0,b:100}   ], [ {r:220,g:0,b:20},  {r:100,g:0,b:140}  ]],
    chorus:    [[ {r:255,g:0,b:0},     {r:255,g:255,b:255}], [ {r:200,g:0,b:0},    {r:120,g:0,b:200}  ], [ {r:255,g:0,b:0},   {r:255,g:200,b:0}  ]],
    bridge:    [[ {r:160,g:0,b:0},     {r:60,g:0,b:100}   ], [ {r:180,g:0,b:20},   {r:80,g:0,b:120}   ]],
    breakdown: [[ {r:40,g:0,b:0},      {r:15,g:0,b:25}    ], [ {r:30,g:0,b:0},     {r:10,g:0,b:20}    ]],
    buildup:   [[ {r:200,g:0,b:0},     {r:100,g:0,b:160}  ], [ {r:255,g:0,b:0},    {r:80,g:0,b:140}   ]],
    drop:      [[ {r:255,g:0,b:0},     {r:255,g:255,b:255}], [ {r:255,g:0,b:0},    {r:200,g:0,b:255}  ], [ {r:200,g:0,b:0},   {r:255,g:200,b:0}  ]],
    outro:     [[ {r:40,g:0,b:0},      {r:10,g:0,b:15}    ], [ {r:30,g:0,b:0},     {r:8,g:0,b:10}     ]],
  },
};

// ─── Genre Presets ──────────────────────────────────────────────────────────
const genrePresets = {
  default:     { label: 'Default',           intensityMult: 1.0,  strobeMult: 1.0, cueDensityMult: 1.0, preferredPalette: null,         beatColorMult: 1.0, flashOnSection: true,  accentPulses: true,  rigWideMult: 1.0, rigWidePreference: null },
  electronic:  { label: 'Electronic / EDM',  intensityMult: 1.1,  strobeMult: 1.4, cueDensityMult: 1.2, preferredPalette: 'electronic', beatColorMult: 0.8, flashOnSection: true,  accentPulses: true,  rigWideMult: 1.5, rigWidePreference: ['rig_chase', 'rig_sweep', 'rig_alternate'] },
  house:       { label: 'House / Techno',    intensityMult: 1.0,  strobeMult: 1.2, cueDensityMult: 1.0, preferredPalette: 'house',      beatColorMult: 0.9, flashOnSection: true,  accentPulses: true,  rigWideMult: 1.3, rigWidePreference: ['rig_chase', 'rig_color_wave', 'rig_sweep'] },
  trance:      { label: 'Trance',            intensityMult: 1.05, strobeMult: 1.0, cueDensityMult: 0.8, preferredPalette: 'trance',     beatColorMult: 0.7, flashOnSection: true,  accentPulses: true,  rigWideMult: 1.4, rigWidePreference: ['rig_sweep', 'rig_color_wave', 'rig_rainbow'] },
  dnb:         { label: 'Drum & Bass',       intensityMult: 1.2,  strobeMult: 1.8, cueDensityMult: 1.5, preferredPalette: 'dnb',        beatColorMult: 0.6, flashOnSection: true,  accentPulses: false, rigWideMult: 1.6, rigWidePreference: ['rig_chase', 'rig_alternate', 'rig_sweep'] },
  hiphop:      { label: 'Hip-Hop / Rap',     intensityMult: 0.85, strobeMult: 0.5, cueDensityMult: 0.7, preferredPalette: 'hiphop',     beatColorMult: 1.5, flashOnSection: false, accentPulses: true,  rigWideMult: 0.6, rigWidePreference: ['rig_color_wave', 'rig_sweep'] },
  rnb:         { label: 'R&B / Soul',        intensityMult: 0.75, strobeMult: 0.3, cueDensityMult: 0.6, preferredPalette: 'rnb',        beatColorMult: 1.8, flashOnSection: false, accentPulses: true,  rigWideMult: 0.4, rigWidePreference: ['rig_color_wave', 'rig_rainbow'] },
  pop:         { label: 'Pop',               intensityMult: 0.95, strobeMult: 0.8, cueDensityMult: 1.0, preferredPalette: 'pop',        beatColorMult: 1.0, flashOnSection: true,  accentPulses: true,  rigWideMult: 1.0, rigWidePreference: ['rig_color_wave', 'rig_chase', 'rig_rainbow'] },
  rock:        { label: 'Rock',              intensityMult: 1.1,  strobeMult: 1.0, cueDensityMult: 0.9, preferredPalette: 'rock',       beatColorMult: 1.2, flashOnSection: true,  accentPulses: false, rigWideMult: 1.2, rigWidePreference: ['rig_chase', 'rig_alternate', 'rig_converge'] },
  latin:       { label: 'Latin / Reggaeton', intensityMult: 1.0,  strobeMult: 0.6, cueDensityMult: 1.0, preferredPalette: 'latin',      beatColorMult: 1.0, flashOnSection: true,  accentPulses: true,  rigWideMult: 0.8, rigWidePreference: ['rig_color_wave', 'rig_sweep'] },
  ambient:     { label: 'Ambient / Chill',   intensityMult: 0.5,  strobeMult: 0.0, cueDensityMult: 0.4, preferredPalette: 'ambient',    beatColorMult: 3.0, flashOnSection: false, accentPulses: false, rigWideMult: 0.5, rigWidePreference: ['rig_color_wave', 'rig_rainbow'] },
  reggae:      { label: 'Reggae / Dub',      intensityMult: 0.8,  strobeMult: 0.3, cueDensityMult: 0.7, preferredPalette: 'reggae',     beatColorMult: 1.5, flashOnSection: false, accentPulses: true,  rigWideMult: 0.6, rigWidePreference: ['rig_color_wave', 'rig_sweep'] },
  metal:       { label: 'Metal / Hardcore',  intensityMult: 1.3,  strobeMult: 2.0, cueDensityMult: 1.5, preferredPalette: 'metal',      beatColorMult: 0.5, flashOnSection: true,  accentPulses: false, rigWideMult: 1.8, rigWidePreference: ['rig_chase', 'rig_alternate', 'rig_converge'] },
};

// Map common genre strings to preset keys
const genreAliases = {
  'edm': 'electronic', 'electro': 'electronic', 'dance': 'electronic', 'electronica': 'electronic',
  'house': 'house', 'deep house': 'house', 'tech house': 'house', 'techno': 'house',
  'progressive house': 'house', 'future house': 'house', 'electro house': 'house',
  'minimal': 'house', 'minimal techno': 'house',
  'trance': 'trance', 'progressive trance': 'trance', 'psytrance': 'trance', 'psy trance': 'trance',
  'uplifting trance': 'trance', 'vocal trance': 'trance',
  'drum and bass': 'dnb', 'drum & bass': 'dnb', 'dnb': 'dnb', 'd&b': 'dnb',
  'jungle': 'dnb', 'liquid dnb': 'dnb', 'neurofunk': 'dnb',
  'dubstep': 'dnb', 'riddim': 'dnb', 'brostep': 'dnb',
  'hip hop': 'hiphop', 'hip-hop': 'hiphop', 'hiphop': 'hiphop', 'rap': 'hiphop',
  'trap': 'hiphop', 'grime': 'hiphop',
  'r&b': 'rnb', 'rnb': 'rnb', 'soul': 'rnb', 'r & b': 'rnb', 'neo soul': 'rnb',
  'funk': 'rnb', 'disco': 'rnb',
  'pop': 'pop', 'indie pop': 'pop', 'synth pop': 'pop', 'synthpop': 'pop',
  'electropop': 'pop', 'dance pop': 'pop', 'k-pop': 'pop',
  'rock': 'rock', 'indie': 'rock', 'indie rock': 'rock', 'alternative': 'rock',
  'punk': 'rock', 'punk rock': 'rock', 'post-punk': 'rock', 'grunge': 'rock',
  'latin': 'latin', 'reggaeton': 'latin', 'dembow': 'latin', 'salsa': 'latin',
  'bachata': 'latin', 'cumbia': 'latin', 'merengue': 'latin', 'moombahton': 'latin',
  'ambient': 'ambient', 'chill': 'ambient', 'chillout': 'ambient', 'downtempo': 'ambient',
  'lo-fi': 'ambient', 'lofi': 'ambient', 'new age': 'ambient',
  'reggae': 'reggae', 'dub': 'reggae', 'dancehall': 'reggae', 'ska': 'reggae',
  'metal': 'metal', 'heavy metal': 'metal', 'death metal': 'metal',
  'hardcore': 'metal', 'hard rock': 'metal', 'thrash': 'metal', 'hardstyle': 'metal',
  'gabber': 'metal',
};

/** Resolve a genre string (from track tags) to a preset key */
function resolveGenrePreset(genreStr) {
  if (!genreStr) return 'default';
  const lower = genreStr.toLowerCase().trim();
  if (genrePresets[lower]) return lower;
  if (genreAliases[lower]) return genreAliases[lower];
  for (const [alias, preset] of Object.entries(genreAliases)) {
    if (lower.includes(alias)) return preset;
  }
  return 'default';
}

/** Resolve genre using configurable presets/aliases (DB or hardcoded) */
function resolveGenrePresetWith(genreStr, presets, aliases) {
  if (!genreStr) return 'default';
  const lower = genreStr.toLowerCase().trim();
  if (presets[lower]) return lower;
  if (aliases[lower]) return aliases[lower];
  for (const [alias, p] of Object.entries(aliases)) {
    if (lower.includes(alias)) return p;
  }
  return 'default';
}

// ─── Section style definitions ──────────────────────────────────────────────
const sectionStyles = {
  intro:     { intensity: [0.4, 0.75],  beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  verse:     { intensity: [0.65, 0.9],   beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  chorus:    { intensity: [0.85, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.2,  strobeDurationBeats: 0.5,  cuePerBars: 1 },
  bridge:    { intensity: [0.6, 0.8],    beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  breakdown: { intensity: [0.3, 0.55],   beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  buildup:   { intensity: [0.45, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.15, strobeDurationBeats: 0.25, cuePerBars: 1, rampIntensity: true, buildEnergy: true },
  drop:      { intensity: [0.9, 1.0],    beatColorChange: true,  beatColorBars: 0.25, strobeChance: 0.35, strobeDurationBeats: 0.5, cuePerBars: 0.25, dropEnergy: true },
  outro:     { intensity: [0.6, 0.2],    beatColorChange: false, strobeChance: 0,    cuePerBars: 4, fadeOut: true },
};

const defaultStyle = {
  intensity: [0.6, 0.8],
  beatColorChange: false,
  strobeChance: 0,
  cuePerBars: 2,
};

/** Get palettes for a section from the chosen color palette theme. */
function getSectionPalettes(paletteName, sectionLabel, palettesMap) {
  const genrePal = genrePalettes[paletteName];
  if (genrePal) {
    return genrePal[sectionLabel] || genrePal.verse;
  }
  const palettes = palettesMap || colorPalettes;
  const pal = palettes[paletteName];
  if (!pal) {
    const fallback = palettes.vibrant || Object.values(palettes)[0];
    return fallback[sectionLabel] || fallback.verse;
  }
  return pal[sectionLabel] || pal.verse;
}

module.exports = {
  colorPalettes,
  rawColorPalettes,
  SECTION_PAIR_COUNTS,
  expandSectionPairs,
  mergeColorPaletteDefaults,
  PALETTE_KEYS,
  ALL_PALETTE_OPTIONS,
  genrePalettes,
  genrePresets,
  genreAliases,
  resolveGenrePreset,
  resolveGenrePresetWith,
  sectionStyles,
  defaultStyle,
  getSectionPalettes,
};
