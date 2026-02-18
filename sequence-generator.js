/**
 * Sequence Generator
 * 
 * Generates DMX light sequences from track analysis data.
 * Creates beat-synced cues with color changes, strobes, effects,
 * and section-appropriate lighting styles.
 * 
 * Supports selectable color palettes and genre-based behaviour presets.
 */

// ─── Named Color Palette Themes ─────────────────────────────────────────────
// Each palette defines color pairs for each section type.

const colorPalettes = {
  vibrant: {
    label: 'Vibrant',
    intro:     [[ {r:0,g:40,b:180},   {r:30,g:80,b:220}  ], [ {r:20,g:0,b:140},   {r:60,g:20,b:200}  ], [ {r:10,g:60,b:120}, {r:40,g:100,b:180} ]],
    verse:     [[ {r:0,g:200,b:80},   {r:0,g:120,b:255}   ], [ {r:60,g:180,b:0},   {r:0,g:200,b:150}  ], [ {r:120,g:80,b:255}, {r:0,g:180,b:120} ]],
    chorus:    [[ {r:255,g:0,b:60},   {r:255,g:100,b:0}   ], [ {r:255,g:0,b:200},  {r:255,g:60,b:0}   ], [ {r:200,g:0,b:255}, {r:255,g:0,b:80}  ], [ {r:255,g:40,b:0}, {r:200,g:0,b:200} ]],
    bridge:    [[ {r:255,g:200,b:0},  {r:200,g:80,b:255}  ], [ {r:180,g:255,b:0},  {r:0,g:180,b:255}  ]],
    breakdown: [[ {r:0,g:180,b:255},  {r:0,g:60,b:180}    ], [ {r:0,g:120,b:200},  {r:20,g:0,b:100}   ]],
    buildup:   [[ {r:255,g:120,b:0},  {r:255,g:0,b:120}   ], [ {r:200,g:80,b:0},   {r:255,g:40,b:200} ]],
    drop:      [[ {r:200,g:0,b:255},  {r:255,g:0,b:0}     ], [ {r:255,g:0,b:120},  {r:0,g:0,b:255}    ], [ {r:255,g:50,b:0}, {r:200,g:0,b:255} ], [ {r:255,g:0,b:0}, {r:255,g:255,b:0} ]],
    outro:     [[ {r:80,g:60,b:120},  {r:20,g:10,b:40}    ], [ {r:60,g:80,b:100},  {r:10,g:20,b:30}   ]],
  },
  neon: {
    label: 'Neon',
    intro:     [[ {r:0,g:255,b:100},  {r:0,g:100,b:255}   ], [ {r:100,g:0,b:255},  {r:0,g:255,b:200}  ]],
    verse:     [[ {r:0,g:255,b:0},    {r:255,g:0,b:255}   ], [ {r:0,g:255,b:255},  {r:255,g:255,b:0}  ], [ {r:255,g:0,b:200}, {r:0,g:255,b:100} ]],
    chorus:    [[ {r:255,g:0,b:255},  {r:0,g:255,b:0}     ], [ {r:255,g:255,b:0},  {r:0,g:255,b:255}  ], [ {r:0,g:200,b:255}, {r:255,g:0,b:200} ]],
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
};

const PALETTE_KEYS = Object.keys(colorPalettes);
const ALL_PALETTE_OPTIONS = [...PALETTE_KEYS, 'random'];

// ─── Genre Presets ──────────────────────────────────────────────────────────
// Each preset modifies generation behaviour: intensity, strobe chance,
// cue density, preferred palette, beat colour change frequency.

const genrePresets = {
  default:     { label: 'Default',           intensityMult: 1.0,  strobeMult: 1.0, cueDensityMult: 1.0, preferredPalette: null,     beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
  electronic:  { label: 'Electronic / EDM',  intensityMult: 1.1,  strobeMult: 1.4, cueDensityMult: 1.2, preferredPalette: 'neon',   beatColorMult: 0.8, flashOnSection: true,  accentPulses: true  },
  house:       { label: 'House / Techno',    intensityMult: 1.0,  strobeMult: 1.2, cueDensityMult: 1.0, preferredPalette: 'neon',   beatColorMult: 0.9, flashOnSection: true,  accentPulses: true  },
  trance:      { label: 'Trance',            intensityMult: 1.05, strobeMult: 1.0, cueDensityMult: 0.8, preferredPalette: 'cool',   beatColorMult: 0.7, flashOnSection: true,  accentPulses: true  },
  dnb:         { label: 'Drum & Bass',       intensityMult: 1.2,  strobeMult: 1.8, cueDensityMult: 1.5, preferredPalette: 'fire',   beatColorMult: 0.6, flashOnSection: true,  accentPulses: false },
  hiphop:      { label: 'Hip-Hop / Rap',     intensityMult: 0.85, strobeMult: 0.5, cueDensityMult: 0.7, preferredPalette: 'warm',   beatColorMult: 1.5, flashOnSection: false, accentPulses: true  },
  rnb:         { label: 'R&B / Soul',        intensityMult: 0.75, strobeMult: 0.3, cueDensityMult: 0.6, preferredPalette: 'sunset', beatColorMult: 1.8, flashOnSection: false, accentPulses: true  },
  pop:         { label: 'Pop',               intensityMult: 0.95, strobeMult: 0.8, cueDensityMult: 1.0, preferredPalette: 'party',  beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
  rock:        { label: 'Rock',              intensityMult: 1.1,  strobeMult: 1.0, cueDensityMult: 0.9, preferredPalette: 'fire',   beatColorMult: 1.2, flashOnSection: true,  accentPulses: false },
  latin:       { label: 'Latin / Reggaeton', intensityMult: 1.0,  strobeMult: 0.6, cueDensityMult: 1.0, preferredPalette: 'warm',   beatColorMult: 1.0, flashOnSection: true,  accentPulses: true  },
  ambient:     { label: 'Ambient / Chill',   intensityMult: 0.5,  strobeMult: 0.0, cueDensityMult: 0.4, preferredPalette: 'cool',   beatColorMult: 3.0, flashOnSection: false, accentPulses: false },
  reggae:      { label: 'Reggae / Dub',      intensityMult: 0.8,  strobeMult: 0.3, cueDensityMult: 0.7, preferredPalette: 'forest', beatColorMult: 1.5, flashOnSection: false, accentPulses: true  },
  metal:       { label: 'Metal / Hardcore',  intensityMult: 1.3,  strobeMult: 2.0, cueDensityMult: 1.5, preferredPalette: 'fire',   beatColorMult: 0.5, flashOnSection: true,  accentPulses: false },
};

// Map common genre strings from VDJ/tags to preset keys
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

// ─── Section style definitions ──────────────────────────────────────────────
// Palettes are now externalized into colorPalettes above.

const sectionStyles = {
  intro:     { intensity: [0.15, 0.55], beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  verse:     { intensity: [0.45, 0.7],  beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  chorus:    { intensity: [0.8, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.2,  strobeDurationBeats: 0.5,  cuePerBars: 1 },
  bridge:    { intensity: [0.4, 0.65],  beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  breakdown: { intensity: [0.1, 0.35],  beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  buildup:   { intensity: [0.25, 0.95], beatColorChange: true,  beatColorBars: 1, strobeChance: 0.15, strobeDurationBeats: 0.25, cuePerBars: 1, rampIntensity: true, buildEnergy: true },
  drop:      { intensity: [0.9, 1.0],   beatColorChange: true,  beatColorBars: 0.5, strobeChance: 0.35, strobeDurationBeats: 0.5, cuePerBars: 0.5, dropEnergy: true },
  outro:     { intensity: [0.5, 0.1],   beatColorChange: false, strobeChance: 0,    cuePerBars: 4, fadeOut: true },
};

const defaultStyle = {
  intensity: [0.4, 0.6],
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

/** Get palettes for a section from the chosen color palette theme */
function getSectionPalettes(paletteName, sectionLabel) {
  const pal = colorPalettes[paletteName];
  if (!pal) return colorPalettes.vibrant[sectionLabel] || colorPalettes.vibrant.verse;
  return pal[sectionLabel] || pal.verse;
}

// ─── Main Generator ─────────────────────────────────────────────────────────

/**
 * Generate a sequence of cues for a track.
 * 
 * @param {Object} opts
 * @param {Object} opts.track       - Track record from DB
 * @param {Array}  opts.fixtures    - Fixture channel map from DB
 * @param {Object} [opts.analysis]  - Track analysis (with sections, beats, energy_levels)
 * @param {string} [opts.palette]   - Color palette key (default: auto from genre or 'vibrant')
 * @param {string} [opts.genre]     - Genre preset key (default: auto-detect from track.genre)
 * @param {Array}  [opts.effects]   - Effects library from DB (used for effect-based cues)
 * @returns {Object} { cues, bpm, durationMs, palette, genrePreset }
 */
function generateSequence(opts) {
  const { track, fixtures, analysis, effects, moverPresets } = opts;
  const bpm = track.bpm || 128;
  const durationMs = (track.song_length || 180) * 1000;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  // First beat offset: align cue timing to actual musical bars
  const firstBeatMs = (track.beatgrid_pos || 0) * 1000;

  // Resolve genre preset
  const genreKey = opts.genre || resolveGenrePreset(track.genre);
  const preset = genrePresets[genreKey] || genrePresets.default;

  // ── BPM-adaptive factor ─────────────────────────────────────────────
  // 0 = very slow / chill (≤90 BPM), 1 = energetic (≥150 BPM)
  const bpmFactor = Math.max(0, Math.min(1, (bpm - 90) / 60));

  // Strobe suppression from config
  const noStrobes = !!opts.noStrobes;

  // Resolve color palette
  let paletteKey = opts.palette || preset.preferredPalette || 'vibrant';
  // Seed random from track ID for deterministic generation
  const rand = seededRandom(track.id * 7919 + Math.round(bpm * 100));
  if (paletteKey === 'random') {
    paletteKey = PALETTE_KEYS[Math.floor(rand() * PALETTE_KEYS.length)];
  }

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

  if (rgbFixtures.length === 0) return { cues: [], bpm, durationMs, palette: paletteKey, genrePreset: genreKey };

  // Classify fixtures: movers (pan+tilt), LED bars (many cells), regular pars
  const movers = rgbFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  const moverIds = new Set(movers.map(m => m.id));

  // Non-mover RGB fixtures get standard color cues and effects
  const nonMoverFixtures = rgbFixtures.filter(fix => !moverIds.has(fix.id));

  // LED bars: category='led_bar' or fixtures with many repeated RGB cells (>= 6 RGB channels)
  const ledBars = nonMoverFixtures.filter(fix => {
    if (fix.category === 'led_bar' || fix.category === 'multi_cell') return true;
    const rgbCount = fix.channels.filter(ch => ch.type === 'red' || ch.type === 'green' || ch.type === 'blue').length;
    return rgbCount >= 6;  // at least 2 cells of RGB
  });
  const ledBarIds = new Set(ledBars.map(b => b.id));

  // Multi-cell fixtures: have explicit cell structure
  const multiCellFixtures = nonMoverFixtures.filter(fix => fix.cell_count > 0);

  // Regular fixtures (pars, etc.) — not movers, not LED bars
  const regularFixtures = nonMoverFixtures.filter(fix => !ledBarIds.has(fix.id));

  const cues = [];
  const ctx = { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, firstBeatMs };

  // Multi-cell fixtures get dedicated per-cell patterns, so exclude them
  // from the main section/bar generator to avoid master cues competing.
  const colorFixtures = (multiCellFixtures.length > 0 && sections.length > 0)
    ? rgbFixtures.filter(f => f.cell_count <= 0)
    : rgbFixtures;

  if (sections.length > 0) {
    generateSectionBased(cues, colorFixtures, sections, beats, energyLevels, ctx);
  } else {
    generateBarBased(cues, colorFixtures, ctx);
  }

  // ── Multi-cell pattern generation (per-cell cues for chases/patterns) ──
  if (multiCellFixtures.length > 0 && sections.length > 0) {
    generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx);
  }

  // ── Mover movement generation (movers only) ───────────────────────────
  if (movers.length > 0) {
    generateMoverMovement(cues, movers, sections, beats, ctx, moverPresets || []);
  }

  // ── Effects generation (non-movers only) ──────────────────────────────
  // Exclude multi-cell fixtures from effect generation — they get dedicated
  // per-cell patterns from generateMultiCellPatterns instead.  Without this
  // exclusion, master-level effects can stomp on cell cues (e.g. verse sections
  // ending up with only a master effect and no cell patterns visible).
  const multiCellIds = new Set(multiCellFixtures.map(f => f.id));
  const effectLedBars = ledBars.filter(f => !multiCellIds.has(f.id));
  const effectRegulars = regularFixtures.filter(f => !multiCellIds.has(f.id));
  if (effects && effects.length > 0 && (effectRegulars.length > 0 || effectLedBars.length > 0)) {
    generateEffectCues(cues, effectRegulars, effectLedBars, effects, sections, ctx);
  }

  // ── Resolve master ↔ cell cue conflicts on multi-cell fixtures ────────
  // If a multi-cell fixture has cell-specific cues in a time range, remove
  // any master (cell=null) cues that overlap so they don't fight each other.
  if (multiCellFixtures.length > 0) {
    resolveMultiCellConflicts(cues, multiCellFixtures);
  }

  return { cues, bpm, durationMs, palette: paletteKey, genrePreset: genreKey };
}

// ─── Multi-Cell Conflict Resolution ─────────────────────────────────────────
/**
 * For each multi-cell fixture, detect time ranges where both master cues
 * (cell=null/undefined) and cell-specific cues (cell=1,2,...) exist.
 * Remove the master cues from those overlapping ranges so only one
 * control path drives the fixture at any given moment.
 *
 * Mutates the cues array in place (splices out conflicting cues).
 */
function resolveMultiCellConflicts(cues, multiCellFixtures) {
  const multiCellIds = new Set(multiCellFixtures.map(f => f.id));

  for (const fixId of multiCellIds) {
    // Separate master and cell-targeted cues for this fixture
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

    // Build a merged timeline of cell-covered intervals
    // Sort cell cues by start time, merge overlapping ranges
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

    // Mark master cues that overlap with any cell-covered interval for removal
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

    // Splice out conflicting master cues
    if (toRemove.size > 0) {
      for (let i = cues.length - 1; i >= 0; i--) {
        if (toRemove.has(cues[i])) {
          cues.splice(i, 1);
        }
      }
    }
  }
}

// ─── Section-based generation ───────────────────────────────────────────────

function generateSectionBased(cues, fixtures, sections, beats, energyLevels, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes } = ctx;

  // BPM-adaptive: slow songs get fade transitions, fast songs get snappy statics
  // bpmFactor: 0 = slow (≤90), 1 = fast (≥150)
  const useFades = bpmFactor < 0.5;  // songs under ~120 BPM get fades
  const fadeOverlapFactor = Math.max(0, 1 - bpmFactor);  // 0-1: how much fade overlap (1 = max for slow songs)

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

      // Get palettes for this section from the chosen color theme
      const palettes = getSectionPalettes(paletteKey, sec.label);

      // Apply genre preset to cue density (BPM-adaptive: slower songs = fewer, longer cues)
      const bpmDensityScale = 0.7 + 0.6 * bpmFactor;  // 0.7x at slow BPM, 1.3x at fast BPM
      const adjustedCuePerBars = Math.max(1, Math.round(style.cuePerBars / (preset.cueDensityMult * bpmDensityScale)));
      const cueBarMs = adjustedCuePerBars * barMs;
      const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

      for (let ci = 0; ci < numCues; ci++) {
        const cueStart = secStartMs + ci * cueBarMs;
        const cueEnd = Math.min(cueStart + cueBarMs, secEndMs);
        const cueDur = cueEnd - cueStart;
        if (cueDur <= 0) continue;

        // Progress through section (0..1)
        const secProgress = numCues > 1 ? ci / (numCues - 1) : 0.5;

        // Pick palette
        const paletteCount = palettes.length;
        let paletteIdx;
        if (style.beatColorChange) {
          const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
          paletteIdx = (fiIdx + si + Math.floor(ci / adjustedBars)) % paletteCount;
        } else {
          paletteIdx = (fiIdx + si) % paletteCount;
        }
        const palette = palettes[paletteIdx];

        // Calculate intensity with genre multiplier
        let startIntensity = Math.min(1, style.intensity[0] * preset.intensityMult);
        let endIntensity = Math.min(1, style.intensity[1] * preset.intensityMult);

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

        // Drop energy boost: max intensity with high contrast
        if (style.dropEnergy) {
          startIntensity = Math.min(1, startIntensity * 1.15);
          endIntensity = Math.min(1, endIntensity * 1.15);
        }

        // Build energy: ramp saturation/contrast as section progresses
        if (style.buildEnergy && secProgress > 0.7) {
          const boost = 1 + (secProgress - 0.7) * 1.0;  // up to 1.3× at end
          startIntensity = Math.min(1, startIntensity * boost);
          endIntensity = Math.min(1, endIntensity * boost);
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

        // BPM-adaptive cue type: slow songs use fades for smooth transitions
        const cueType = useFades ? 'fade' : 'static';

        cues.push({
          lane,
          start_ms: Math.round(cueStart),
          duration_ms: Math.round(cueDur),
          cue_type: cueType,
          fixture_id: fix.id,
          channel_values: startVals,
          end_channel_values: endVals,
          color: sec.color || CUE_COLORS[si % CUE_COLORS.length],
          label: sec.label || '',
        });
      }

      // ── Strobe hits on high-energy beats ────────────────────────────
      if (!noStrobes) {
      const effectiveStrobeChance = (style.strobeChance || 0) * preset.strobeMult * (0.3 + 0.7 * bpmFactor);
      if (effectiveStrobeChance > 0 && beats.length > 0) {
        const strobeBeats = beats.filter(b => b >= secStartMs && b < secEndMs);
        const strobeDurMs = Math.round((style.strobeDurationBeats || 0.5) * beatMs);

        for (let bi = 0; bi < strobeBeats.length; bi++) {
          // Only trigger strobe on certain beats (every 4th beat or random)
          const beatInSection = Math.floor((strobeBeats[bi] - secStartMs) / beatMs);
          const isDownbeat = beatInSection % 4 === 0;

          if (isDownbeat && rand() < effectiveStrobeChance) {
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
      } // end noStrobes guard

      // ── Beat-synced color flash on chorus/drop first beat ────────────
      if (preset.flashOnSection && (sec.label === 'chorus' || sec.label === 'drop') && beats.length > 0) {
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
      if (preset.accentPulses && (sec.label === 'verse' || sec.label === 'bridge') && secDurMs > barMs * 8) {
        const accentPaletteList = getSectionPalettes(paletteKey, sec.label);
        const accentPalette = accentPaletteList[(fiIdx + si + 1) % accentPaletteList.length];
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
        // Already handled by (fiIdx + si + ci) in palette selection above
      }
    }
  }

  // Sort cues by start time for clean timeline ordering
  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Bar-based fallback generation ──────────────────────────────────────────

function generateBarBased(cues, fixtures, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, firstBeatMs } = ctx;

  // BPM-adaptive
  const useFades = bpmFactor < 0.5;
  const bpmDensityScale = 0.7 + 0.6 * bpmFactor;

  // Offset bar grid by first beat so cues align to musical bars
  const barOffset = firstBeatMs || 0;

  // Use verse/chorus palettes from the selected theme
  const versePalettes = getSectionPalettes(paletteKey, 'verse');
  const chorusPalettes = getSectionPalettes(paletteKey, 'chorus');
  const allPalettes = [...versePalettes, ...chorusPalettes];

  const totalBars = Math.floor((durationMs - barOffset) / barMs);
  const sectionBars = Math.max(1, Math.round(2 / (preset.cueDensityMult * bpmDensityScale)));

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % allPalettes.length;
      const palette = allPalettes[(paletteIdx + fiIdx) % allPalettes.length];
      const startMs = barOffset + bar * barMs;
      const durMs = Math.min(sectionBars * barMs, durationMs - startMs);
      if (durMs <= 0) break;

      const intensity = Math.min(1, 0.7 * preset.intensityMult);
      const startColor = applyIntensity(palette[0], intensity);
      const endColor = applyIntensity(palette[1], intensity);
      const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
      const endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };

      if (hasDimmer) {
        const dimVal = Math.min(255, Math.round(200 * preset.intensityMult));
        startVals.dimmer = dimVal;
        endVals.dimmer = dimVal;
      }
      if (hasWhite) {
        startVals.white = Math.round((startColor.r + startColor.g + startColor.b) / 3 * 0.2);
        endVals.white = Math.round((endColor.r + endColor.g + endColor.b) / 3 * 0.2);
      }

      cues.push({
        lane,
        start_ms: Math.round(startMs),
        duration_ms: Math.round(durMs),
        cue_type: useFades ? 'fade' : 'static',
        fixture_id: fix.id,
        channel_values: startVals,
        end_channel_values: endVals,
        color: CUE_COLORS[(paletteIdx + fiIdx) % CUE_COLORS.length],
        label: '',
      });

      // Add occasional strobe (BPM-adaptive + noStrobes guard)
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
          channel_values: strobeVals,
          end_channel_values: {},
          color: '#ffffff',
          label: 'strobe',
        });
      }
    }
  }
}

// ─── Mover Movement Generation ──────────────────────────────────────────────

/**
 * Movement position presets — different named positions for pan/tilt (0-255).
 * These represent general stage positions movers can sweep between.
 */
const MOVER_POSITIONS = [
  { pan: 128, tilt: 128 },  // center
  { pan: 40,  tilt: 100 },  // front-left
  { pan: 216, tilt: 100 },  // front-right
  { pan: 80,  tilt: 60 },   // audience-left
  { pan: 176, tilt: 60 },   // audience-right
  { pan: 128, tilt: 40 },   // audience-center (far)
  { pan: 60,  tilt: 160 },  // stage-left-up
  { pan: 196, tilt: 160 },  // stage-right-up
  { pan: 128, tilt: 200 },  // straight-down
  { pan: 90,  tilt: 128 },  // left-mid
  { pan: 166, tilt: 128 },  // right-mid
];

/**
 * Section-aware movement styles:
 *  - intro/outro: slow sweeps
 *  - verse: gentle position changes per bar
 *  - chorus/drop: fast movement, wider range
 *  - breakdown: hold / slow drift
 *  - buildup: accelerating sweeps
 *  - bridge: moderate movement
 */
const MOVEMENT_STYLES = {
  intro:     { barsPerMove: 8, range: 0.4, speed: 'slow' },
  verse:     { barsPerMove: 4, range: 0.5, speed: 'medium' },
  chorus:    { barsPerMove: 2, range: 0.8, speed: 'fast' },
  bridge:    { barsPerMove: 4, range: 0.5, speed: 'medium' },
  breakdown: { barsPerMove: 8, range: 0.3, speed: 'slow' },
  buildup:   { barsPerMove: 1, range: 0.8, speed: 'fast' },
  drop:      { barsPerMove: 0.5, range: 1.0, speed: 'fast' },
  outro:     { barsPerMove: 8, range: 0.3, speed: 'slow' },
};
const DEFAULT_MOVEMENT = { barsPerMove: 4, range: 0.5, speed: 'medium' };

/**
 * Build per-fixture position lists from saved mover presets.
 * Each preset contains positions for all movers — we extract each fixture's
 * pan/tilt from every preset to create a fixture-specific position pool.
 * Positions from saved presets are prioritised; hardcoded MOVER_POSITIONS
 * serve as padding when fewer presets than needed are defined.
 */
function buildFixturePositions(moverPresets, movers, rand) {
  // Map: fixture_id → [{pan, tilt}, ...] from saved presets
  const perFixture = {};
  for (const fix of movers) perFixture[fix.id] = [];

  if (moverPresets && moverPresets.length > 0) {
    for (const preset of moverPresets) {
      if (!Array.isArray(preset.positions)) continue;
      // Build lookup for this preset's positions
      const posMap = {};
      for (const p of preset.positions) posMap[p.fixture_id] = { pan: p.pan, tilt: p.tilt };

      for (const fix of movers) {
        if (posMap[fix.id]) {
          perFixture[fix.id].push(posMap[fix.id]);
        }
      }
    }
  }

  // Pad with hardcoded positions so we always have enough variety
  for (const fix of movers) {
    const arr = perFixture[fix.id];
    // Append hardcoded positions that are not duplicates of user presets
    for (const hp of MOVER_POSITIONS) {
      const isDup = arr.some(a => a.pan === hp.pan && a.tilt === hp.tilt);
      if (!isDup) arr.push({ pan: hp.pan, tilt: hp.tilt });
    }
    // Shuffle the combined list with seeded random for deterministic variety
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  return perFixture;
}

/**
 * Generate mover pan/tilt cues alongside color cues.
 * Each mover gets position assignments that sweep through presets.
 * When saved mover presets exist, their per-fixture positions are used
 * (supplemented by generic positions for additional variety).
 * Multi-mover setups get mirrored or offset positions for visual variety.
 */
function generateMoverMovement(cues, movers, sections, beats, ctx, moverPresets) {
  const { barMs, rand, preset, durationMs } = ctx;

  // Build per-fixture position lists from saved presets + hardcoded fallback
  const perFixPositions = buildFixturePositions(moverPresets, movers, rand);

  const useSections = sections && sections.length > 0;

  for (let mi = 0; mi < movers.length; mi++) {
    const fix = movers[mi];
    // Position pool for this specific fixture
    const posOrder = perFixPositions[fix.id];
    // Find existing lane for this fixture (from color cues already generated)
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : mi;
    const hasGobo = fix.channels.some(ch => ch.type === 'gobo');

    let posIdx = mi; // offset per mover for variety
    const mirror = mi % 2 === 1; // odd movers mirror pan

    if (useSections) {
      for (const sec of sections) {
        const style = MOVEMENT_STYLES[sec.label] || DEFAULT_MOVEMENT;
        const secStartMs = Math.round(sec.start_ms);
        const secEndMs = Math.round(sec.end_ms);
        const secDurMs = secEndMs - secStartMs;
        if (secDurMs <= 0) continue;

        // Adjust movement density with genre preset
        const barsPerMove = Math.max(1, Math.round(style.barsPerMove / preset.cueDensityMult));
        const moveDurMs = barsPerMove * barMs;
        const numMoves = Math.max(1, Math.floor(secDurMs / moveDurMs));

        for (let ci = 0; ci < numMoves; ci++) {
          const moveStart = secStartMs + ci * moveDurMs;
          const moveEnd = Math.min(moveStart + moveDurMs, secEndMs);
          const dur = moveEnd - moveStart;
          if (dur <= 0) continue;

          const from = posOrder[posIdx % posOrder.length];
          posIdx++;
          const to = posOrder[posIdx % posOrder.length];

          const startPan = mirror ? (255 - from.pan) : from.pan;
          const endPan = mirror ? (255 - to.pan) : to.pan;

          const startVals = { pan: startPan, tilt: from.tilt };
          const endVals = { pan: endPan, tilt: to.tilt };

          // Add gobo changes on chorus/drop sections
          if (hasGobo && (sec.label === 'chorus' || sec.label === 'drop')) {
            startVals.gobo = Math.floor(rand() * 8) * 16; // select a gobo pattern
          }

          cues.push({
            lane,
            start_ms: Math.round(moveStart),
            duration_ms: Math.round(dur),
            cue_type: 'fade',
            fixture_id: fix.id,
            channel_values: startVals,
            end_channel_values: endVals,
            color: '#4488ff',
            label: 'move',
          });
        }
      }
    } else {
      // No sections — sweep through positions every few bars
      const totalBars = Math.floor(durationMs / barMs);
      const barsPerMove = Math.max(1, Math.round(4 / preset.cueDensityMult));

      for (let bar = 0; bar < totalBars; bar += barsPerMove) {
        const startMs = bar * barMs;
        const endMs = Math.min((bar + barsPerMove) * barMs, durationMs);
        const dur = endMs - startMs;
        if (dur <= 0) continue;

        const from = posOrder[posIdx % posOrder.length];
        posIdx++;
        const to = posOrder[posIdx % posOrder.length];

        const startPan = mirror ? (255 - from.pan) : from.pan;
        const endPan = mirror ? (255 - to.pan) : to.pan;

        cues.push({
          lane,
          start_ms: Math.round(startMs),
          duration_ms: Math.round(dur),
          cue_type: 'fade',
          fixture_id: fix.id,
          channel_values: { pan: startPan, tilt: from.tilt },
          end_channel_values: { pan: endPan, tilt: to.tilt },
          color: '#4488ff',
          label: 'move',
        });
      }
    }
  }

  // Re-sort after adding movement cues
  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Effect Cue Generation (non-movers only) ───────────────────────────────

/**
 * Maps section labels to appropriate effect types.
 * Cell-aware types are preferred for LED bars.
 */
const SECTION_EFFECT_TYPES = {
  intro:     { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'fire'] },
  verse:     { regular: ['pulse', 'color_fade', 'rainbow'], cellAware: ['color_wave', 'sparkle'] },
  chorus:    { regular: ['rainbow', 'pulse', 'strobe'],     cellAware: ['chase', 'scanner', 'sparkle'] },
  bridge:    { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'sparkle'] },
  breakdown: { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'] },
  buildup:   { regular: ['pulse', 'strobe'],                cellAware: ['buildup', 'comet', 'chase'] },
  drop:      { regular: ['rainbow', 'strobe', 'pulse'],     cellAware: ['chase', 'scanner', 'sparkle', 'comet', 'buildup'] },
  outro:     { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'] },
};

const DEFAULT_EFFECT_TYPES = {
  regular: ['pulse', 'color_fade', 'rainbow'],
  cellAware: ['chase', 'color_wave', 'sparkle'],
};

/** EFFECT_COLORS matches EFFECT_STYLE in index.html */
const EFFECT_COLORS = {
  pulse:      '#1e88e5',
  rainbow:    '#ff6f00',
  strobe:     '#f44336',
  color_fade: '#8e24aa',
  chase:      '#00897b',
  comet:      '#e65100',
  scanner:    '#00838f',
  sparkle:    '#fdd835',
  color_wave: '#7b1fa2',
  fire:       '#bf360c',
  buildup:    '#2e7d32',
};

/**
 * Generate effect cues for non-mover fixtures.
 * Fixtures are grouped by type_name so each type gets a consistent effect.
 * Cascade effects stagger start times across fixtures of the same type.
 */
function generateEffectCues(cues, regularFixtures, ledBars, effects, sections, ctx) {
  const { bpm, durationMs, barMs, rand, paletteKey, preset } = ctx;
  const beatMs = 60000 / bpm;

  // Index effects by type for quick lookup
  const effectsByType = {};
  for (const eff of effects) {
    if (!effectsByType[eff.type]) effectsByType[eff.type] = [];
    effectsByType[eff.type].push(eff);
  }

  /** Pick a random effect that matches one of the desired types. */
  function pickEffect(desiredTypes) {
    const candidates = [];
    for (const t of desiredTypes) {
      if (effectsByType[t]) candidates.push(...effectsByType[t]);
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(rand() * candidates.length)];
  }

  // ── Group fixtures by type_name ───────────────────────────────────────
  // Each group = fixtures of the same model, which get the same effect and can cascade.
  const allNonMovers = [...regularFixtures, ...ledBars];
  const fixtureGroups = {};  // { type_name: { fixtures: [...], isLedBar: bool } }
  const ledBarIds = new Set(ledBars.map(b => b.id));

  for (const fix of allNonMovers) {
    const key = fix.type_name || `unknown_${fix.id}`;
    if (!fixtureGroups[key]) {
      fixtureGroups[key] = { fixtures: [], isLedBar: ledBarIds.has(fix.id) };
    }
    fixtureGroups[key].fixtures.push(fix);
  }

  // Determine base lane offset (after existing lanes)
  const existingMaxLane = cues.reduce((mx, c) => Math.max(mx, c.lane || 0), 0);
  let laneCounter = existingMaxLane + 1;

  // Cascade-friendly effect types: stagger start times across fixtures in a group
  const CASCADE_TYPES = new Set(['chase', 'comet', 'scanner', 'sparkle', 'color_wave', 'pulse', 'rainbow', 'buildup']);

  // Effect density per section type, scaled by genre preset
  const sectionEffectChance = {
    intro: 0.3, verse: 0.4, chorus: 0.8, bridge: 0.35,
    breakdown: 0.35, buildup: 0.7, drop: 0.95, outro: 0.25,
  };

  /**
   * Emit effect cues for a fixture group across a time range.
   * @param {Object} group       - { fixtures, isLedBar }
   * @param {Object} effect      - Effect record from DB
   * @param {number} startMs     - Start time in ms
   * @param {number} durationMs  - Duration in ms
   * @param {Object} baseColor   - { r, g, b }
   * @param {number} lane        - Sequencer lane
   * @param {boolean} cascade    - Whether to stagger start times across fixtures
   */
  function emitGroupCues(group, effect, startMs, durationMs, baseColor, lane, cascade) {
    const fixtureCount = group.fixtures.length;
    // Cascade offset: spread fixtures across half a beat (so they ripple)
    const cascadeSpreadMs = cascade && fixtureCount > 1
      ? Math.min(beatMs * 0.5, durationMs * 0.15)  // max 15% of duration or half a beat
      : 0;
    const cascadeStepMs = fixtureCount > 1 ? cascadeSpreadMs / (fixtureCount - 1) : 0;

    for (let i = 0; i < fixtureCount; i++) {
      const fix = group.fixtures[i];
      const offset = Math.round(cascadeStepMs * i);
      const cueStart = startMs + offset;
      const cueDur = durationMs - offset;
      if (cueDur < barMs * 0.5) continue;

      const params = {};
      if (group.isLedBar) {
        const channelsPerCell = detectChannelsPerCell(fix);
        if (channelsPerCell > 1) params.channels_per_cell = channelsPerCell;
      }

      cues.push({
        lane,
        start_ms: cueStart,
        duration_ms: Math.round(cueDur),
        cue_type: 'effect',
        fixture_id: fix.id,
        effect_id: effect.id,
        effect_params: params,
        channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
        color: EFFECT_COLORS[effect.type] || '#607d8b',
        label: effect.name,
      });
    }
  }

  // ── Section-based effect generation ───────────────────────────────────
  if (sections.length > 0) {
    // Assign one lane per fixture-type group
    const groupEntries = Object.entries(fixtureGroups);
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    for (const section of sections) {
      const label = section.label || 'verse';
      const sectionStart = Math.round(section.start_ms || (section.start * 1000));
      const sectionEnd = Math.round(section.end_ms || (section.end * 1000));
      const sectionDuration = sectionEnd - sectionStart;
      if (sectionDuration < barMs) continue;

      const chance = (sectionEffectChance[label] || 0.3) * preset.cueDensityMult;
      if (rand() > Math.min(chance, 0.95)) continue;

      const typesMap = SECTION_EFFECT_TYPES[label] || DEFAULT_EFFECT_TYPES;
      const sectionPalette = getSectionPalettes(paletteKey, label);
      const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];

      // Each fixture-type group picks its own effect but stays consistent within the group
      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? typesMap.cellAware : typesMap.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        const maxDur = Math.min(sectionDuration, barMs * 8);
        const effectDurationMs = Math.max(barMs * 2, maxDur);
        let t = sectionStart;

        while (t < sectionEnd) {
          const dur = Math.min(effectDurationMs, sectionEnd - t);
          if (dur < barMs) break;
          emitGroupCues(group, effect, t, dur, baseColor, groupLanes[typeName], useCascade);
          t += effectDurationMs;
        }
      }
    }
  } else {
    // ── Bar-based fallback: effects every N bars, grouped by type ───────
    const totalBars = Math.floor(durationMs / barMs);
    const effectEveryBars = Math.max(2, Math.round(4 / preset.cueDensityMult));
    const effectDurationBars = Math.max(2, effectEveryBars);
    const defaultTypes = DEFAULT_EFFECT_TYPES;

    const groupEntries = Object.entries(fixtureGroups);
    const groupLanes = {};
    for (const [typeName] of groupEntries) {
      groupLanes[typeName] = laneCounter++;
    }

    for (let bar = 0; bar < totalBars; bar += effectEveryBars) {
      if (rand() > 0.5 * preset.cueDensityMult) continue;

      const startMs = bar * barMs;
      const dur = Math.min(effectDurationBars * barMs, durationMs - startMs);
      if (dur < barMs) break;

      const sectionPalette = getSectionPalettes(paletteKey, 'verse');
      const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];

      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? defaultTypes.cellAware : defaultTypes.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        emitGroupCues(group, effect, startMs, dur, baseColor, groupLanes[typeName], useCascade);
      }
    }
  }

  // Re-sort after adding effect cues
  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Multi-Cell Pattern Generation ──────────────────────────────────────────
//
// Creates per-cell cues with the `cell` property set on multi-cell fixtures.
// Different song sections get different patterns. Drop sections are tuned
// to be fast, high-contrast, and energetic.

const CELL_PATTERN_MAP = {
  intro:     ['fill_sweep', 'color_wave', 'breathe'],
  verse:     ['chase_slow', 'alternate', 'color_wave', 'breathe'],
  chorus:    ['chase', 'alternate', 'scatter'],
  bridge:    ['color_wave', 'alternate', 'breathe'],
  breakdown: ['fill_sweep', 'breathe'],
  buildup:   ['build_reveal', 'chase_accel'],
  drop:      ['chase_fast', 'scatter_strobe', 'alternate_fast', 'all_flash'],
  outro:     ['fill_sweep', 'color_wave', 'breathe'],
};

/**
 * Main multi-cell pattern orchestrator.
 * For each multi-cell fixture and section, picks a pattern type and generates
 * per-cell cues.
 */
function generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx) {
  const { barMs, beatMs, rand, paletteKey, preset } = ctx;

  for (const fix of multiCellFixtures) {
    const cellCount = fix.cell_count || 0;
    if (cellCount < 2) continue;

    // Find existing lane for this fixture
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : 0;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (const section of sections) {
      const label = section.label || 'verse';
      const secStartMs = Math.round(section.start_ms);
      const secEndMs = Math.round(section.end_ms);
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs < barMs) continue;

      const patterns = CELL_PATTERN_MAP[label] || CELL_PATTERN_MAP.verse;
      const pattern = patterns[Math.floor(rand() * patterns.length)];

      const palettes = getSectionPalettes(paletteKey, label);
      const style = sectionStyles[label] || defaultStyle;
      const baseIntensity = Math.min(1, ((style.intensity[0] + style.intensity[1]) / 2) * preset.intensityMult);

      const patternCtx = {
        fix, lane, cellCount, secStartMs, secEndMs, secDurMs,
        palettes, baseIntensity, hasDimmer, hasWhite, label,
        ...ctx,
      };

      switch (pattern) {
        case 'chase_slow':    cellPatternChase(cues, patternCtx, 'slow'); break;
        case 'chase':         cellPatternChase(cues, patternCtx, 'medium'); break;
        case 'chase_fast':    cellPatternChase(cues, patternCtx, 'fast'); break;
        case 'chase_accel':   cellPatternChaseAccel(cues, patternCtx); break;
        case 'alternate':     cellPatternAlternate(cues, patternCtx, 'normal'); break;
        case 'alternate_fast': cellPatternAlternate(cues, patternCtx, 'fast'); break;
        case 'color_wave':    cellPatternColorWave(cues, patternCtx); break;
        case 'scatter':       cellPatternScatter(cues, patternCtx, false); break;
        case 'scatter_strobe': cellPatternScatter(cues, patternCtx, true); break;
        case 'fill_sweep':    cellPatternFillSweep(cues, patternCtx); break;
        case 'build_reveal':  cellPatternBuildReveal(cues, patternCtx); break;
        case 'all_flash':     cellPatternAllFlash(cues, patternCtx); break;
        case 'breathe':       cellPatternBreathe(cues, patternCtx); break;
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

/**
 * Helper: create a per-cell cue.
 */
function cellCue(cues, p, cell, startMs, durMs, startColor, endColor, cueType, label) {
  const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
  const endVals = endColor ? { red: endColor.r, green: endColor.g, blue: endColor.b } : {};
  if (p.hasDimmer) {
    startVals.dimmer = Math.round(Math.max(startColor.r, startColor.g, startColor.b));
    if (endColor) endVals.dimmer = Math.round(Math.max(endColor.r, endColor.g, endColor.b));
  }
  if (p.hasWhite) {
    startVals.white = Math.round((startColor.r + startColor.g + startColor.b) / 3 * 0.15);
    if (endColor) endVals.white = Math.round((endColor.r + endColor.g + endColor.b) / 3 * 0.15);
  }
  cues.push({
    lane: p.lane,
    start_ms: Math.round(startMs),
    duration_ms: Math.round(Math.max(10, durMs)),
    cue_type: cueType || 'static',
    fixture_id: p.fix.id,
    cell,
    channel_values: startVals,
    end_channel_values: endVals,
    color: rgbToHex(startColor.r, startColor.g, startColor.b),
    label: label || '',
  });
}

/**
 * Chase pattern: cells light up one after another in sequence.
 * Speed: slow = 1 bar per cycle, medium = 2 beats, fast = 1 beat.
 */
function cellPatternChase(cues, p, speed) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const cycleDur = speed === 'fast' ? beatMs
    : speed === 'medium' ? beatMs * 2
    : barMs;
  const cellDur = cycleDur / cellCount;

  // Pick two contrasting colors for on/off
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const onColor = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.2));
  const offColor = applyIntensity(pal[1], baseIntensity * 0.15);

  let t = secStartMs;
  let direction = 1;
  while (t < secEndMs) {
    for (let step = 0; step < cellCount; step++) {
      const cellIdx = direction > 0 ? step : (cellCount - 1 - step);
      const cell = cellIdx + 1;
      const cueStart = t + step * cellDur;
      if (cueStart >= secEndMs) break;
      const dur = Math.min(cellDur, secEndMs - cueStart);

      // Active cell gets bright color, decays to dim
      cellCue(cues, p, cell, cueStart, dur, onColor, offColor, 'static', 'chase');
    }
    t += cycleDur;
    // Bounce direction every cycle for variety
    if (rand() > 0.6) direction *= -1;
  }
}

/**
 * Accelerating chase for buildup sections.
 * Starts slow and progressively speeds up toward the end.
 */
function cellPatternChaseAccel(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.3));
  const dimColor = applyIntensity(pal[1], baseIntensity * 0.1);

  // Start with slow cycle (1 bar) and accelerate to fast (half beat)
  const startCycleDur = barMs;
  const endCycleDur = beatMs * 0.5;

  let t = secStartMs;
  while (t < secEndMs) {
    const progress = Math.min(1, (t - secStartMs) / secDurMs);
    const cycleDur = startCycleDur + (endCycleDur - startCycleDur) * (progress * progress); // quadratic ease
    const cellDur = cycleDur / cellCount;
    const intensity = Math.min(1, baseIntensity * (0.5 + progress * 0.8));
    const c = applyIntensity(pal[0], intensity);

    for (let step = 0; step < cellCount; step++) {
      const cell = step + 1;
      const cueStart = t + step * cellDur;
      if (cueStart >= secEndMs) break;
      const dur = Math.min(cellDur, secEndMs - cueStart);
      cellCue(cues, p, cell, cueStart, dur, c, dimColor, 'static', 'build');
    }
    t += cycleDur;
  }
}

/**
 * Alternating pattern: even and odd cells swap between two colors.
 * 'fast' mode swaps every beat, 'normal' swaps every 2 beats.
 */
function cellPatternAlternate(cues, p, speed) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const swapInterval = speed === 'fast' ? beatMs : beatMs * 2;

  // Pick two distinct palettes for the two groups
  const pal1 = palettes[Math.floor(rand() * palettes.length)];
  const pal2 = palettes[(Math.floor(rand() * palettes.length) + 1) % palettes.length] || pal1;
  const colorA = applyIntensity(pal1[0], baseIntensity);
  const colorB = applyIntensity(pal2[1], baseIntensity);

  let t = secStartMs;
  let swapState = false;
  while (t < secEndMs) {
    const dur = Math.min(swapInterval, secEndMs - t);
    for (let cell = 1; cell <= cellCount; cell++) {
      const isOdd = cell % 2 === 1;
      const useA = isOdd ? !swapState : swapState;
      cellCue(cues, p, cell, t, dur, useA ? colorA : colorB, null, 'static', 'alt');
    }
    t += swapInterval;
    swapState = !swapState;
  }
}

/**
 * Color wave: all cells show the same color palette but offset in time,
 * creating a ripple/wave effect across the fixture.
 */
function cellPatternColorWave(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, rand } = p;

  const waveDur = barMs * 2; // full wave cycle
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color1 = applyIntensity(pal[0], baseIntensity);
  const color2 = applyIntensity(pal[1], baseIntensity);

  let t = secStartMs;
  while (t < secEndMs) {
    for (let cell = 1; cell <= cellCount; cell++) {
      const offset = (cell - 1) / cellCount;
      const cellStart = t + offset * waveDur * 0.5;
      const dur = Math.min(waveDur, secEndMs - cellStart);
      if (cellStart >= secEndMs || dur <= 0) continue;
      cellCue(cues, p, cell, cellStart, dur, color1, color2, 'fade', 'wave');
    }
    t += waveDur;
  }
}

/**
 * Scatter: random cells flash independently at random intervals.
 * High energy — good for chorus. strobe mode adds strobe cue type for drops.
 */
function cellPatternScatter(cues, p, strobeMode) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, beatMs, rand, noStrobes } = p;

  const flashInterval = strobeMode ? beatMs * 0.5 : beatMs;
  const flashDur = strobeMode ? beatMs * 0.25 : beatMs * 0.5;
  const intensity = strobeMode ? 1.0 : baseIntensity;

  let t = secStartMs;
  while (t < secEndMs) {
    // Pick 1-3 random cells to flash
    const numFlashes = Math.floor(rand() * Math.min(3, cellCount)) + 1;
    const pal = palettes[Math.floor(rand() * palettes.length)];
    const color = applyIntensity(pal[0], intensity);

    for (let f = 0; f < numFlashes; f++) {
      const cell = Math.floor(rand() * cellCount) + 1;
      const dur = Math.min(flashDur, secEndMs - t);
      if (dur <= 0) break;

      if (strobeMode && !noStrobes) {
        // Strobe flash
        const strobeVals = { red: color.r, green: color.g, blue: color.b, strobe_hz: 15 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        if (p.hasWhite) strobeVals.white = 200;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(dur),
          cue_type: 'strobe', fixture_id: p.fix.id, cell,
          channel_values: strobeVals, end_channel_values: {},
          color: '#ffffff', label: 'scatter',
        });
      } else {
        const dimColor = { r: 0, g: 0, b: 0 };
        cellCue(cues, p, cell, t, dur, color, dimColor, 'static', 'scatter');
      }
    }
    t += flashInterval + rand() * flashInterval * 0.5;
  }
}

/**
 * Fill sweep: cells turn on one by one from left to right,
 * then all hold, creating a progressive reveal. Gentle — for intros/outros.
 */
function cellPatternFillSweep(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, rand } = p;

  const sweepDur = Math.min(barMs * 4, secDurMs * 0.6);
  const holdDur = secDurMs - sweepDur;
  const cellDelay = sweepDur / cellCount;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const color = applyIntensity(pal[0], baseIntensity * 0.8);
  const dimColor = applyIntensity(pal[0], baseIntensity * 0.1);

  for (let cell = 1; cell <= cellCount; cell++) {
    const onTime = secStartMs + (cell - 1) * cellDelay;

    // Fade in phase
    const fadeInDur = Math.min(cellDelay * 1.5, secEndMs - onTime);
    if (fadeInDur > 0 && onTime < secEndMs) {
      cellCue(cues, p, cell, onTime, fadeInDur, dimColor, color, 'fade', 'sweep');
    }

    // Hold phase  
    const holdStart = secStartMs + sweepDur;
    if (holdStart < secEndMs && holdDur > 0) {
      cellCue(cues, p, cell, holdStart, Math.min(holdDur, secEndMs - holdStart), color, null, 'static', 'hold');
    }
  }
}

/**
 * Build reveal for buildup sections: progressively more cells light up,
 * culminating in all cells at full brightness.
 */
function cellPatternBuildReveal(cues, p) {
  const { cellCount, secStartMs, secEndMs, secDurMs, palettes, baseIntensity, barMs, beatMs, rand } = p;

  const pal = palettes[Math.floor(rand() * palettes.length)];
  const numStages = Math.min(cellCount, Math.max(4, Math.floor(secDurMs / barMs)));
  const stageDur = secDurMs / numStages;

  for (let stage = 0; stage < numStages; stage++) {
    const stageStart = secStartMs + stage * stageDur;
    const dur = Math.min(stageDur, secEndMs - stageStart);
    if (dur <= 0) break;

    const progress = (stage + 1) / numStages;
    const intensity = Math.min(1, baseIntensity * (0.3 + progress * 0.9));
    const color = applyIntensity(pal[0], intensity);

    // Number of cells active grows with progress
    const activeCells = Math.max(1, Math.ceil(cellCount * progress));

    for (let i = 0; i < activeCells; i++) {
      const cell = i + 1;
      cellCue(cues, p, cell, stageStart, dur, color, null, 'static', 'build');
    }
  }

  // Final stage: all cells at max
  const finalStart = secEndMs - Math.min(beatMs * 2, secDurMs * 0.2);
  if (finalStart > secStartMs) {
    const maxColor = applyIntensity(pal[0], Math.min(1, baseIntensity * 1.4));
    for (let cell = 1; cell <= cellCount; cell++) {
      cellCue(cues, p, cell, finalStart, secEndMs - finalStart, maxColor, null, 'static', 'peak');
    }
  }
}

/**
 * All-flash: all cells simultaneously flash contrasting colors rapidly.
 * Maximum energy — designed for drops.
 */
function cellPatternAllFlash(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, beatMs, rand, noStrobes } = p;

  const flashDur = beatMs; // 1 beat per flash
  let t = secStartMs;
  let palIdx = 0;

  while (t < secEndMs) {
    const pal = palettes[palIdx % palettes.length];
    const color1 = applyIntensity(pal[0], 1.0);
    const color2 = applyIntensity(pal[1], 1.0);
    const dur = Math.min(flashDur, secEndMs - t);
    if (dur <= 0) break;

    for (let cell = 1; cell <= cellCount; cell++) {
      // Alternate cells get opposite colors for maximum contrast
      const useColor = cell % 2 === 0 ? color1 : color2;
      cellCue(cues, p, cell, t, dur, useColor, null, 'static', 'flash');
    }

    // Add strobe burst every 4 beats in drop
    if (!noStrobes && palIdx % 4 === 3) {
      for (let cell = 1; cell <= cellCount; cell++) {
        const strobeVals = { red: 255, green: 255, blue: 255, strobe_hz: 18 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(Math.min(beatMs * 0.5, dur)),
          cue_type: 'strobe', fixture_id: p.fix.id, cell,
          channel_values: strobeVals, end_channel_values: {},
          color: '#ffffff', label: 'strobe',
        });
      }
    }

    t += flashDur;
    palIdx++;
  }
}

/**
 * Breathe: all cells gently pulse in and out together.
 * Calm — for breakdowns.
 */
function cellPatternBreathe(cues, p) {
  const { cellCount, secStartMs, secEndMs, palettes, baseIntensity, barMs, rand } = p;

  const breatheCycle = barMs * 2;
  const pal = palettes[Math.floor(rand() * palettes.length)];
  const brightColor = applyIntensity(pal[0], baseIntensity * 0.7);
  const dimColor = applyIntensity(pal[0], baseIntensity * 0.1);

  let t = secStartMs;
  while (t < secEndMs) {
    const dur = Math.min(breatheCycle, secEndMs - t);
    if (dur <= 0) break;
    const halfDur = dur / 2;

    for (let cell = 1; cell <= cellCount; cell++) {
      // Fade up
      cellCue(cues, p, cell, t, halfDur, dimColor, brightColor, 'fade', 'breathe');
      // Fade down
      if (t + halfDur < secEndMs) {
        cellCue(cues, p, cell, t + halfDur, Math.min(halfDur, secEndMs - t - halfDur), brightColor, dimColor, 'fade', 'breathe');
      }
    }
    t += breatheCycle;
  }
}

/**
 * Detect channels_per_cell for LED bar fixtures based on repeating channel patterns.
 * Returns 3 for RGB, 4 for RGBW, etc.
 */
function detectChannelsPerCell(fixture) {
  const channels = fixture.channels;
  if (!channels || channels.length < 3) return 1;

  // Look for repeating RGB(W) pattern
  const firstType = channels[0].type;
  for (let stride = 3; stride <= 5; stride++) {
    if (channels.length % stride !== 0) continue;
    // Check if pattern repeats
    let repeats = true;
    for (let i = stride; i < channels.length; i++) {
      if (channels[i].type !== channels[i % stride].type) {
        repeats = false;
        break;
      }
    }
    if (repeats) return stride;
  }
  return 3; // default to RGB
}

// ─── Export ─────────────────────────────────────────────────────────────────

module.exports = {
  generateSequence,
  colorPalettes,
  genrePresets,
  genreAliases,
  resolveGenrePreset,
  PALETTE_KEYS,
  ALL_PALETTE_OPTIONS,
};
