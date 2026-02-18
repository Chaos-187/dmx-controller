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
  buildup:   { intensity: [0.25, 0.95], beatColorChange: true,  beatColorBars: 1, strobeChance: 0.15, strobeDurationBeats: 0.25, cuePerBars: 1, rampIntensity: true },
  drop:      { intensity: [0.9, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.3,  strobeDurationBeats: 0.5,  cuePerBars: 1 },
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
 * @returns {Object} { cues, bpm, durationMs, palette, genrePreset }
 */
function generateSequence(opts) {
  const { track, fixtures, analysis } = opts;
  const bpm = track.bpm || 128;
  const durationMs = (track.song_length || 180) * 1000;
  const beatMs = 60000 / bpm;
  const barMs = beatMs * 4;

  // Resolve genre preset
  const genreKey = opts.genre || resolveGenrePreset(track.genre);
  const preset = genrePresets[genreKey] || genrePresets.default;

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

  const cues = [];
  const ctx = { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset };

  if (sections.length > 0) {
    generateSectionBased(cues, rgbFixtures, sections, beats, energyLevels, ctx);
  } else {
    generateBarBased(cues, rgbFixtures, ctx);
  }

  // ── Mover movement generation ──────────────────────────────────────────
  const movers = rgbFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  if (movers.length > 0) {
    generateMoverMovement(cues, movers, sections, beats, ctx);
  }

  return { cues, bpm, durationMs, palette: paletteKey, genrePreset: genreKey };
}

// ─── Section-based generation ───────────────────────────────────────────────

function generateSectionBased(cues, fixtures, sections, beats, energyLevels, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset } = ctx;

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

      // Apply genre preset to cue density
      const adjustedCuePerBars = Math.max(1, Math.round(style.cuePerBars / preset.cueDensityMult));
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
      const effectiveStrobeChance = (style.strobeChance || 0) * preset.strobeMult;
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
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset } = ctx;

  // Use verse/chorus palettes from the selected theme
  const versePalettes = getSectionPalettes(paletteKey, 'verse');
  const chorusPalettes = getSectionPalettes(paletteKey, 'chorus');
  const allPalettes = [...versePalettes, ...chorusPalettes];

  const totalBars = Math.floor(durationMs / barMs);
  const sectionBars = Math.max(1, Math.round(2 / preset.cueDensityMult));

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % allPalettes.length;
      const palette = allPalettes[(paletteIdx + fiIdx) % allPalettes.length];
      const startMs = bar * barMs;
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
        cue_type: 'static',
        fixture_id: fix.id,
        channel_values: startVals,
        end_channel_values: endVals,
        color: CUE_COLORS[(paletteIdx + fiIdx) % CUE_COLORS.length],
        label: '',
      });

      // Add occasional strobe
      const strobeChance = 0.3 * preset.strobeMult;
      if (bar % 8 === 0 && bar > 0 && strobeChance > 0 && rand() < strobeChance) {
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
  buildup:   { barsPerMove: 2, range: 0.7, speed: 'fast' },
  drop:      { barsPerMove: 1, range: 1.0, speed: 'fast' },
  outro:     { barsPerMove: 8, range: 0.3, speed: 'slow' },
};
const DEFAULT_MOVEMENT = { barsPerMove: 4, range: 0.5, speed: 'medium' };

/**
 * Generate mover pan/tilt cues alongside color cues.
 * Each mover gets position assignments that sweep through presets.
 * Multi-mover setups get mirrored or offset positions for visual variety.
 */
function generateMoverMovement(cues, movers, sections, beats, ctx) {
  const { barMs, rand, preset, durationMs } = ctx;

  // Pre-pick a shuffled sequence of positions for deterministic variety
  const posOrder = MOVER_POSITIONS.slice();
  for (let i = posOrder.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [posOrder[i], posOrder[j]] = [posOrder[j], posOrder[i]];
  }

  const useSections = sections && sections.length > 0;

  for (let mi = 0; mi < movers.length; mi++) {
    const fix = movers[mi];
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
