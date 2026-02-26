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
};

const PALETTE_KEYS = Object.keys(colorPalettes);
const ALL_PALETTE_OPTIONS = [...PALETTE_KEYS, 'random'];

// ─── Genre-Specific Color Palettes ──────────────────────────────────────────
// Each genre gets a tailored palette that carries a consistent color identity
// across all song sections. Colors are chosen to match the vibe of the genre,
// with consistent hue families and appropriate energy levels per section.
// Genres that don't define a palette fall back to the generic palettes above.

const genrePalettes = {
  electronic: {
    label: 'Electronic / EDM',
    // Cyan, magenta, electric blue — high-saturation neon club colours
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
    // Deep blue, violet, warm pink — underground club with warmth
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
    // Ice blue, white-blue, ethereal cyan — vast and euphoric
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
    // Amber, red-orange, dark — aggressive and gritty
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
    // Deep amber, gold, purple — rich and moody
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
    // Deep rose, warm violet, soft gold — smooth and sultry
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
    // Bright pink, cyan, yellow, green — fun, colourful, high variety
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
    // Red, amber, white — raw, warm, punchy
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
    // Hot pink, gold, orange, turquoise — tropical and vibrant
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
    // Soft blue, muted teal, lavender — gentle and atmospheric
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
    // Green, gold, red — irie colours, Rastafarian palette
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
    // Deep red, pure white strobe contrast, dark violet — brutal
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
// Each preset modifies generation behaviour: intensity, strobe chance,
// cue density, preferred palette, beat colour change frequency.
// preferredPalette can be a genre key (matched to genrePalettes) or a
// generic palette key (matched to colorPalettes). Genre palettes take priority.

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
// Palettes are now externalized into colorPalettes above.

const sectionStyles = {
  intro:     { intensity: [0.4, 0.75],  beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  verse:     { intensity: [0.65, 0.9],   beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  chorus:    { intensity: [0.85, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.2,  strobeDurationBeats: 0.5,  cuePerBars: 1 },
  bridge:    { intensity: [0.6, 0.8],    beatColorChange: true,  beatColorBars: 2, strobeChance: 0,    cuePerBars: 2 },
  breakdown: { intensity: [0.3, 0.55],   beatColorChange: false, strobeChance: 0,    cuePerBars: 4 },
  buildup:   { intensity: [0.45, 1.0],   beatColorChange: true,  beatColorBars: 1, strobeChance: 0.15, strobeDurationBeats: 0.25, cuePerBars: 1, rampIntensity: true, buildEnergy: true },
  drop:      { intensity: [0.9, 1.0],    beatColorChange: true,  beatColorBars: 0.5, strobeChance: 0.35, strobeDurationBeats: 0.5, cuePerBars: 0.5, dropEnergy: true },
  outro:     { intensity: [0.6, 0.2],    beatColorChange: false, strobeChance: 0,    cuePerBars: 4, fadeOut: true },
};

const defaultStyle = {
  intensity: [0.6, 0.8],
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

/** Parse a hex color string to {r, g, b} */
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  return {
    r: parseInt(hex.substring(0, 2), 16) || 0,
    g: parseInt(hex.substring(2, 4), 16) || 0,
    b: parseInt(hex.substring(4, 6), 16) || 0,
  };
}

/**
 * Find the nearest color wheel entry for a given {r, g, b} color.
 * Uses Euclidean distance in RGB space.
 * @param {{r:number, g:number, b:number}} color - Target color
 * @param {Array<{dmx_value:number, color_hex:string}>} wheelMap - Color wheel entries
 * @returns {{dmx_value:number, color_hex:string}|null}
 */
function findNearestWheelColor(color, wheelMap) {
  if (!wheelMap || wheelMap.length === 0) return null;
  let best = null;
  let bestDist = Infinity;
  for (const entry of wheelMap) {
    const c = hexToRgb(entry.color_hex);
    const dist = (color.r - c.r) ** 2 + (color.g - c.g) ** 2 + (color.b - c.b) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = entry;
    }
  }
  return best;
}

/**
 * Snap a time value to the nearest actual beat in the fluid beat array.
 * Uses binary search for efficiency.
 *
 * @param {number}   timeMs – target time
 * @param {number[]} beats  – sorted array of beat times (ms)
 * @returns {number} nearest beat time
 */
function snapToBeat(timeMs, beats) {
  if (!beats || beats.length === 0) return timeMs;
  // Binary search for insertion point
  let lo = 0, hi = beats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < timeMs) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first beat >= timeMs; compare with lo-1 for closest
  if (lo === 0) return beats[0];
  if (lo >= beats.length) return beats[beats.length - 1];
  const distPrev = Math.abs(timeMs - beats[lo - 1]);
  const distNext = Math.abs(timeMs - beats[lo]);
  return distPrev <= distNext ? beats[lo - 1] : beats[lo];
}

/**
 * Snap a time value to the nearest bar boundary (every 4th beat) in
 * the fluid beat array.
 *
 * @param {number}   timeMs – target time
 * @param {number[]} beats  – sorted array of beat times (ms)
 * @returns {number} nearest bar-start beat time
 */
function snapToBar(timeMs, beats) {
  if (!beats || beats.length < 4) return snapToBeat(timeMs, beats);
  // Build bar starts (every 4th beat)
  // We search through bar starts for the nearest
  let bestDist = Infinity, bestTime = timeMs;
  for (let i = 0; i < beats.length; i += 4) {
    const dist = Math.abs(beats[i] - timeMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestTime = beats[i];
    } else if (beats[i] > timeMs + bestDist) {
      break; // past the closest, no need to continue
    }
  }
  return bestTime;
}

/** Seeded pseudo-random for deterministic results per track */
function seededRandom(seed) {
  let s = seed;
  return function () {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

/** Get palettes for a section from the chosen color palette theme.
 *  Checks genre-specific palettes first, then falls back to generic palettes. */
function getSectionPalettes(paletteName, sectionLabel, palettesMap) {
  // Genre-specific palettes take priority (e.g. 'electronic', 'hiphop')
  const genrePal = genrePalettes[paletteName];
  if (genrePal) {
    return genrePal[sectionLabel] || genrePal.verse;
  }
  // Fall back to generic palettes (e.g. 'vibrant', 'neon')
  const palettes = palettesMap || colorPalettes;
  const pal = palettes[paletteName];
  if (!pal) {
    const fallback = palettes.vibrant || Object.values(palettes)[0];
    return fallback[sectionLabel] || fallback.verse;
  }
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

  // ── Load generator config (DB overrides → hardcoded fallback) ───────
  const gc = opts.generatorConfig || {};
  const activePalettes       = gc.gen_color_palettes    || colorPalettes;
  const activeGenrePresets    = gc.gen_genre_presets     || genrePresets;
  const activeGenreAliases   = gc.gen_genre_aliases     || genreAliases;
  const activeSectionStyles  = gc.gen_section_styles    || sectionStyles;
  const activeMovementStyles = gc.gen_movement_styles   || MOVEMENT_STYLES;
  const activeSpeedDmx       = gc.gen_speed_dmx         || SPEED_DMX;
  const activeSectionEffects = gc.gen_section_effects   || SECTION_EFFECT_TYPES;
  const activeCellPatterns   = gc.gen_cell_patterns     || CELL_PATTERN_MAP;

  // Resolve genre preset using active config
  const genreKey = opts.genre || resolveGenrePresetWith(track.genre, activeGenrePresets, activeGenreAliases);
  const preset = activeGenrePresets[genreKey] || activeGenrePresets.default || genrePresets.default;

  // ── BPM-adaptive factor ─────────────────────────────────────────────
  // 0 = very slow / chill (≤90 BPM), 1 = energetic (≥150 BPM)
  const bpmFactor = Math.max(0, Math.min(1, (bpm - 90) / 60));

  // Strobe suppression from config
  const noStrobes = !!opts.noStrobes;

  // Resolve color palette
  const activePaletteKeys = Object.keys(activePalettes);
  let paletteKey = opts.palette || preset.preferredPalette || 'vibrant';
  // Seed random from track ID for deterministic generation
  const rand = seededRandom(track.id * 7919 + Math.round(bpm * 100));
  if (paletteKey === 'random') {
    paletteKey = activePaletteKeys[Math.floor(rand() * activePaletteKeys.length)];
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

  // Color-wheel-only fixtures: have a color_wheel channel + map, but no RGB
  const rgbIds = new Set(rgbFixtures.map(f => f.id));
  const colorWheelFixtures = fixtures.filter(fix =>
    !rgbIds.has(fix.id) &&
    fix.channels.some(ch => ch.type === 'color_wheel') &&
    fix.color_wheel_map && fix.color_wheel_map.length > 0
  );

  if (rgbFixtures.length === 0 && colorWheelFixtures.length === 0) {
    return { cues: [], bpm, durationMs, palette: paletteKey, genrePreset: genreKey };
  }

  // Classify fixtures: movers (pan+tilt), LED bars (many cells), regular pars
  // Movers include BOTH RGB and color-wheel movers
  const allMovers = fixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  const movers = rgbFixtures.filter(fix =>
    fix.channels.some(ch => ch.type === 'pan') &&
    fix.channels.some(ch => ch.type === 'tilt')
  );
  const moverIds = new Set(movers.map(m => m.id));
  const allMoverIds = new Set(allMovers.map(m => m.id));

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
  // Build snapBeat/snapBar functions bound to this track's fluid beat grid
  const snapBeat = (t) => snapToBeat(t, beats);
  const snapBar  = (t) => snapToBar(t, beats);
  const ctx = {
    bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, firstBeatMs, snapBeat, snapBar, beats,
    // Active configs (DB overrides or hardcoded defaults)
    activePalettes, activeSectionStyles, activeMovementStyles, activeSpeedDmx,
    activeSectionEffects, activeCellPatterns,
  };

  // Multi-cell fixtures get dedicated per-cell patterns, so exclude them
  // from the main section/bar generator to avoid master cues competing.
  // Also exclude RGB movers — they get movement cues from generateMoverMovement,
  // and overlapping section color cues (accents, flashes) would fight with them.
  const colorFixtures = (multiCellFixtures.length > 0 && sections.length > 0)
    ? rgbFixtures.filter(f => f.cell_count <= 0 && !moverIds.has(f.id))
    : rgbFixtures.filter(f => !moverIds.has(f.id));

  if (sections.length > 0) {
    generateSectionBased(cues, colorFixtures, sections, beats, energyLevels, ctx);
  } else {
    generateBarBased(cues, colorFixtures, ctx);
  }

  // ── Multi-cell pattern generation (per-cell cues for chases/patterns) ──
  if (multiCellFixtures.length > 0 && sections.length > 0) {
    generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx);
  }

  // ── Mover movement generation (all movers — RGB and color-wheel) ────
  if (allMovers.length > 0) {
    generateMoverMovement(cues, allMovers, sections, beats, ctx, moverPresets || []);
  }

  // ── Color-wheel cue generation (color-wheel-only fixtures) ────────────
  if (colorWheelFixtures.length > 0) {
    generateColorWheelCues(cues, colorWheelFixtures, sections, beats, energyLevels, ctx);
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
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBeat, snapBar } = ctx;

  // BPM-adaptive: slow songs get fade transitions, fast songs get snappy statics
  // bpmFactor: 0 = slow (≤90), 1 = fast (≥150)
  const useFades = bpmFactor < 0.5;  // songs under ~120 BPM get fades
  const fadeOverlapFactor = Math.max(0, 1 - bpmFactor);  // 0-1: how much fade overlap (1 = max for slow songs)

  // ── Color cascade: stagger colour changes across the rig ──────────
  // Compute a per-fixture time offset so section colour transitions sweep
  // across fixtures (L→R or by rig_order).  High-energy sections like
  // chorus/drop get a full beat of spread; low-energy sections get half.
  // This makes colour changes visibly ripple across the rig.
  const rigSorted = [...fixtures].sort((a, b) => {
    if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
    return (a.rig_x || 0.5) - (b.rig_x || 0.5);
  });
  const rigXVals = rigSorted.map(f => f.rig_x ?? 0.5);
  const rigXSpan = Math.max(...rigXVals) - Math.min(...rigXVals);
  // Map each fixture to a 0..1 position in the cascade order
  const colorCascadeMap = new Map();
  for (let i = 0; i < rigSorted.length; i++) {
    const fraction = rigXSpan > 0.05
      ? ((rigSorted[i].rig_x ?? 0.5) - Math.min(...rigXVals)) / rigXSpan
      : (rigSorted.length > 1 ? i / (rigSorted.length - 1) : 0);
    colorCascadeMap.set(rigSorted[i].id, fraction);
  }
  // Sections where cascade is applied
  const CASCADE_COLOR_SECTIONS = new Set(['chorus', 'drop', 'buildup', 'bridge']);
  const colorCascadeSpreadMs = beatMs * 1.0;  // 1 beat of spread for colour cascade

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let si = 0; si < sections.length; si++) {
      const sec = sections[si];
      const style = (ctx.activeSectionStyles || sectionStyles)[sec.label] || defaultStyle;
      // Snap inner section boundaries to the nearest beat so cues lock to
      // the beat grid.  Keep track edges (first start, last end) unsnapped
      // so the sequence covers the full track without gaps.
      const secStartMs = si === 0 ? 0 : snapBeat(Math.round(sec.start_ms));
      const secEndMs = si === sections.length - 1 ? Math.round(durationMs) : snapBeat(Math.round(sec.end_ms));
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs <= 0) continue;

      // Get palettes for this section from the chosen color theme
      const palettes = getSectionPalettes(paletteKey, sec.label, ctx.activePalettes);

      // Apply genre preset to cue density (BPM-adaptive: slower songs = fewer, longer cues)
      const bpmDensityScale = 0.7 + 0.6 * bpmFactor;  // 0.7x at slow BPM, 1.3x at fast BPM
      const adjustedCuePerBars = Math.max(1, Math.round(style.cuePerBars / (preset.cueDensityMult * bpmDensityScale)));
      const cueBarMs = adjustedCuePerBars * barMs;
      const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

      for (let ci = 0; ci < numCues; ci++) {
        // Snap each cue start to nearest bar boundary on the beat grid
        const rawCueStart = secStartMs + ci * cueBarMs;
        const cueStart = ci === 0 ? secStartMs : snapBar(rawCueStart);
        const rawNextStart = rawCueStart + cueBarMs;
        const nextCueStart = ci < numCues - 1 ? snapBar(rawNextStart) : secEndMs;
        let cueDur = nextCueStart - cueStart;
        // Guard: ensure minimum cue duration (half a bar) and no negative/tiny cues
        if (cueDur < barMs * 0.5) cueDur = Math.min(barMs, secEndMs - cueStart);
        if (cueDur <= 0) continue;

        // Progress through section (0..1)
        const secProgress = numCues > 1 ? ci / (numCues - 1) : 0.5;

        // Pick palette — rotate through palettes for visual variety
        const paletteCount = palettes.length;
        let paletteIdx;
        if (style.beatColorChange) {
          const adjustedBars = Math.max(1, Math.round((style.beatColorBars || 1) * preset.beatColorMult));
          paletteIdx = (fiIdx + si + Math.floor(ci / adjustedBars)) % paletteCount;
        } else {
          // Even for non-beat-color-change sections, rotate palettes
          // every 4 cues so long sections don't look flat
          paletteIdx = (fiIdx + si + Math.floor(ci / 4)) % paletteCount;
        }
        const palette = palettes[paletteIdx];

        // ── Energy-driven intensity ──────────────────────────────────
        // Use actual analysed energy at this cue's position to modulate
        // the base intensity.  High-energy moments get brighter.
        let energyMod = 1.0;
        if (energyLevels.length > 0) {
          const cueTimeMid = cueStart + cueDur * 0.5;
          const closest = energyLevels.reduce((best, e) =>
            Math.abs(e.time_ms - cueTimeMid) < Math.abs(best.time_ms - cueTimeMid) ? e : best
          );
          // Map energy (0-1) to a 0.75–1.15 multiplier so quiet = slightly dimmer, loud = brighter
          energyMod = 0.75 + Math.min(1, closest.energy) * 0.4;
        }

        // Calculate intensity with genre multiplier and energy modulation
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
          // Dimmer at full — intensity is already baked into the RGB values
          startVals.dimmer = 255;
          endVals.dimmer = 255;
        }
        if (hasWhite) {
          startVals.white = Math.round((startColor.r + startColor.g + startColor.b) / 3 * 0.25);
          endVals.white = Math.round((endColor.r + endColor.g + endColor.b) / 3 * 0.25);
        }

        // BPM-adaptive cue type: slow songs use fades for smooth transitions
        const cueType = useFades ? 'fade' : 'static';

        // Apply colour cascade offset for high-energy sections
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

      // ── Energy-driven accent pulses in verses/bridges ───────────────
      // Instead of rigid 8-bar intervals, find energy peaks within the
      // section and place accent pulses at those natural intensity spikes.
      if (preset.accentPulses && (sec.label === 'verse' || sec.label === 'bridge') && secDurMs > barMs * 4) {
        const accentPaletteList = getSectionPalettes(paletteKey, sec.label, ctx.activePalettes);
        const accentPalette = accentPaletteList[(fiIdx + si + 1) % accentPaletteList.length];

        // Collect energy samples within this section
        const sectionEnergy = energyLevels.filter(e => e.time_ms >= secStartMs && e.time_ms < secEndMs);

        if (sectionEnergy.length >= 4) {
          // Find local energy peaks (higher than neighbours) with minimum spacing
          const minSpacingMs = barMs * 3;  // at least 3 bars apart
          const avgEnergy = sectionEnergy.reduce((s, e) => s + e.energy, 0) / sectionEnergy.length;
          const threshold = avgEnergy * 1.15;  // 15% above average

          const peaks = [];
          for (let ei = 1; ei < sectionEnergy.length - 1; ei++) {
            const e = sectionEnergy[ei];
            if (e.energy > threshold &&
                e.energy >= sectionEnergy[ei - 1].energy &&
                e.energy >= sectionEnergy[ei + 1].energy) {
              // Enforce minimum spacing from last peak
              if (peaks.length === 0 || e.time_ms - peaks[peaks.length - 1].time_ms >= minSpacingMs) {
                peaks.push(e);
              }
            }
          }

          // Fallback: if no peaks found, use every 4th bar
          const accentTimes = peaks.length > 0
            ? peaks.map(p => p.time_ms)
            : Array.from({ length: Math.floor(secDurMs / (barMs * 4)) }, (_, i) => secStartMs + (i + 1) * barMs * 4);

          for (const accentTime of accentTimes) {
            const pulseStart = snapBeat(accentTime);
            const pulseDur = Math.round(beatMs * 2);
            if (pulseStart + pulseDur > secEndMs || pulseStart < secStartMs) continue;

            // Scale accent brightness by the energy level at that point
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
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBar, beats } = ctx;

  // BPM-adaptive
  const useFades = bpmFactor < 0.5;
  const bpmDensityScale = 0.7 + 0.6 * bpmFactor;

  // Use verse/chorus palettes from the selected theme
  const versePalettes = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
  const chorusPalettes = getSectionPalettes(paletteKey, 'chorus', ctx.activePalettes);
  const allPalettes = [...versePalettes, ...chorusPalettes];

  const totalBars = Math.floor(durationMs / barMs);
  const sectionBars = Math.max(1, Math.round(2 / (preset.cueDensityMult * bpmDensityScale)));

  for (let fiIdx = 0; fiIdx < fixtures.length; fiIdx++) {
    const fix = fixtures[fiIdx];
    const lane = fiIdx;
    const hasDimmer = fix.channels.some(ch => ch.type === 'dimmer');
    const hasWhite = fix.channels.some(ch => ch.type === 'white');

    for (let bar = 0; bar < totalBars; bar += sectionBars) {
      const paletteIdx = Math.floor(bar / sectionBars) % allPalettes.length;
      const palette = allPalettes[(paletteIdx + fiIdx) % allPalettes.length];
      const startMs = snapBar(bar * barMs);
      const endMs = snapBar((bar + sectionBars) * barMs);
      const durMs = Math.min(endMs - startMs, durationMs - startMs);
      if (durMs <= 0) break;

      const intensity = Math.min(1, 0.7 * preset.intensityMult);
      const startColor = applyIntensity(palette[0], intensity);
      const endColor = applyIntensity(palette[1], intensity);
      const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
      const endVals = { red: endColor.r, green: endColor.g, blue: endColor.b };

      if (hasDimmer) {
        // Dimmer at full — intensity is already baked into the RGB values
        startVals.dimmer = 255;
        endVals.dimmer = 255;
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

// ─── Color Wheel Cue Generation ─────────────────────────────────────────────

/**
 * Generate color cues for fixtures that use a physical color wheel instead of
 * RGB mixing.  These fixtures have a `color_wheel` channel and a
 * `color_wheel_map` array that maps DMX values to hex colours.
 *
 * Works the same way as section-based generation: each section gets
 * palette-matched colour-wheel positions with intensity driven via the
 * dimmer channel.
 */
function generateColorWheelCues(cues, cwFixtures, sections, beats, energyLevels, ctx) {
  const { bpm, durationMs, beatMs, barMs, rand, paletteKey, preset, bpmFactor, noStrobes, snapBeat, snapBar } = ctx;

  const useFades = bpmFactor < 0.5;

  const useSections = sections && sections.length > 0;

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
        const numCues = Math.max(1, Math.floor(secDurMs / cueBarMs));

        for (let ci = 0; ci < numCues; ci++) {
          const rawCueStart = secStartMs + ci * cueBarMs;
          const cueStart = ci === 0 ? secStartMs : snapBar(rawCueStart);
          const rawNextStart = rawCueStart + cueBarMs;
          const nextCueStart = ci < numCues - 1 ? snapBar(rawNextStart) : secEndMs;
          let cueDur = nextCueStart - cueStart;
          if (cueDur < barMs * 0.5) cueDur = Math.min(barMs, secEndMs - cueStart);
          if (cueDur <= 0) continue;

          // Pick a palette colour pair and find nearest wheel positions
          const paletteIdx = (fiIdx + si + Math.floor(ci / 4)) % palettes.length;
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
          // baked into the colour (unlike RGB).  The wheel is a physical
          // position — dimmer should be close to full so colours pop.
          const baseIntLo = style.intensity ? style.intensity[0] : 0.6;
          const baseIntHi = style.intensity ? style.intensity[1] : 0.8;
          // Boost base range closer to full for color-wheel fixtures
          const cwBoostLo = Math.min(1, baseIntLo * 1.25);
          const cwBoostHi = Math.min(1, baseIntHi * 1.25);
          let startIntensity = Math.min(1, cwBoostLo * preset.intensityMult * energyMod);
          let endIntensity = Math.min(1, cwBoostHi * preset.intensityMult * energyMod);

          // Occasional full-brightness "punch" moments for contrast
          const isHighEnergy = sec.label === 'chorus' || sec.label === 'drop';
          const punchChance = isHighEnergy ? 0.35 : 0.12;
          if (rand() < punchChance) {
            startIntensity = 1.0;
            endIntensity = 1.0;
          }

          // Find the nearest wheel colour for the start & end palette colours
          const startColor = applyIntensity(palette[0], 1); // full saturation for matching
          const endColor = applyIntensity(palette[1], 1);
          const startWheel = findNearestWheelColor(startColor, wheelMap);
          const endWheel = findNearestWheelColor(endColor, wheelMap);
          if (!startWheel) continue;

          // Physical colour wheels look better with snap (static) changes —
          // fading sweeps through intermediate wheel positions which looks bad.
          // Use a section-aware snap probability: energetic sections snap more.
          // Color wheel fixtures should ALWAYS snap — interpolating between
          // wheel DMX positions sweeps through random physical colours.
          // Only the dimmer is allowed to fade.
          const startVals = { color_wheel: startWheel.dmx_value };
          const endVals = {};

          if (hasDimmer) {
            startVals.dimmer = Math.round(startIntensity * 255);
            endVals.dimmer = Math.round(endIntensity * 255);
          }

          const hasEndVals = Object.keys(endVals).length > 0;
          cues.push({
            lane,
            start_ms: Math.round(cueStart),
            duration_ms: Math.round(cueDur),
            cue_type: 'static',
            fixture_id: fix.id,
            channel_values: startVals,
            end_channel_values: hasEndVals ? endVals : undefined,
            color: startWheel.color_hex || '#888888',
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
                  channel_values: { strobe_hz: 10, dimmer: 255 },
                  color: '#ffffff',
                  label: 'strobe',
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
        const startMs = snapBar(bar * barMs);
        const endMs = snapBar((bar + sectionBars) * barMs);
        const durMs = Math.min(endMs - startMs, durationMs - startMs);
        if (durMs <= 0) break;

        // Boost dimmer for color-wheel fixtures (physical wheel, no RGB mixing)
        const intensity = Math.min(1, 0.85 * preset.intensityMult);
        const startWheel = findNearestWheelColor(palette[0], wheelMap);
        const endWheel = findNearestWheelColor(palette[1], wheelMap);
        if (!startWheel) continue;

        // Mostly snap changes for physical wheels
        const useSnap = rand() < 0.65;

        const startVals = { color_wheel: startWheel.dmx_value };
        const endVals = {};

        if (hasDimmer) {
          startVals.dimmer = Math.round(intensity * 255);
          endVals.dimmer = startVals.dimmer;
        }
        // Never put color_wheel in end values — interpolation sweeps the physical wheel
        const hasEndVals = Object.keys(endVals).length > 0;
        cues.push({
          lane,
          start_ms: Math.round(startMs),
          duration_ms: Math.round(durMs),
          cue_type: 'static',
          fixture_id: fix.id,
          channel_values: startVals,
          end_channel_values: hasEndVals ? endVals : undefined,
          color: startWheel.color_hex || '#888888',
          label: '',
        });
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Mover Movement Generation ──────────────────────────────────────────────

/**
 * Movement position presets — different named positions for pan/tilt (0-255).
 * These represent general stage positions movers can sweep between.
 */

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
 * IDs to cycle through.  At playback the engine looks up current preset
 * positions, so changing presets per-venue updates all sequences automatically.
 *
 * Section-aware timing is preserved: energetic sections get shorter cues
 * (faster cycling), calm sections get longer ones (slower sweeps).
 * Speed and gobo channels are still set directly in channel_values.
 */
function generateMoverMovement(cues, movers, sections, beats, ctx, moverPresets) {
  const { barMs, beatMs, rand, preset, durationMs, snapBar, bpmFactor } = ctx;

  // Nothing to reference if no presets are configured
  if (!moverPresets || moverPresets.length === 0) return;

  const presetIds = moverPresets.map(p => p.id);

  const useSections = sections && sections.length > 0;

  for (let mi = 0; mi < movers.length; mi++) {
    const fix = movers[mi];
    // Find existing lane for this fixture (from color cues already generated)
    const existingCue = cues.find(c => c.fixture_id === fix.id);
    const lane = existingCue ? existingCue.lane : mi;
    const hasGobo = fix.channels.some(ch => ch.type === 'gobo');
    const hasSpeed = fix.channels.some(ch => ch.type === 'speed');

    if (useSections) {
      // Movement density per section — not every moment needs movement.
      // Values are the probability a given chunk is a move vs a hold.
      const MOVE_DENSITY = {
        intro: 0.4, verse: 0.45, chorus: 0.7, bridge: 0.5,
        breakdown: 0.25, buildup: 0.3, drop: 0.8, outro: 0.3,
      };

      // Look-ahead: check which sections are followed by a drop
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

        // Break section into bar-sized chunks; each chunk is either
        // a movement cue or a gap (hold position).
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

          // Buildup ramp: density increases through the section.
          // Ramps from baseDensity (0.3) up to 0.9 if a drop follows,
          // or up to 0.6 otherwise — so movement accelerates into the drop.
          let density = baseDensity;
          if (sec.label === 'buildup' && numChunks > 1) {
            const progress = ci / (numChunks - 1); // 0..1
            const ceiling = followedByDrop[si] ? 0.9 : 0.6;
            density = baseDensity + (ceiling - baseDensity) * progress;
          }

          // Always move on the first chunk of high-energy sections,
          // otherwise use density-based probability.
          const forceMove = ci === 0 && (sec.label === 'chorus' || sec.label === 'drop');
          if (!forceMove && rand() >= density) continue; // gap — hold position

          const chVals = { mover_preset_ids: presetIds };

          // Set speed channel (motor speed) — faster on energetic sections
          if (hasSpeed) {
            const baseSpeedDmx = activeSpd[style.speed] || activeSpd.medium;
            const bpmSpeedBoost = Math.round(baseSpeedDmx * (1 - bpmFactor * 0.3));
            chVals.speed = Math.max(0, bpmSpeedBoost);
          }

          // Add gobo changes on high-energy sections
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
      // No sections — single movement cue for the whole track
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

  // Re-sort after adding movement cues
  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

// ─── Effect Cue Generation (non-movers only) ───────────────────────────────

/**
 * Maps section labels to appropriate effect types.
 * Cell-aware types are preferred for LED bars.
 */
const SECTION_EFFECT_TYPES = {
  intro:     { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'fire'],                                   rigWide: ['rig_color_wave', 'rig_rainbow'] },
  verse:     { regular: ['pulse', 'color_fade', 'rainbow'], cellAware: ['color_wave', 'sparkle'],                                 rigWide: ['rig_color_wave', 'rig_sweep', 'rig_rainbow'] },
  chorus:    { regular: ['rainbow', 'pulse', 'strobe'],     cellAware: ['chase', 'scanner', 'sparkle'],                           rigWide: ['rig_chase', 'rig_color_wave', 'rig_alternate', 'rig_rainbow'] },
  bridge:    { regular: ['color_fade', 'pulse'],            cellAware: ['color_wave', 'sparkle'],                                 rigWide: ['rig_color_wave', 'rig_sweep'] },
  breakdown: { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'],                                    rigWide: ['rig_color_wave', 'rig_rainbow'] },
  buildup:   { regular: ['pulse', 'strobe'],                cellAware: ['buildup', 'comet', 'chase'],                             rigWide: ['rig_converge', 'rig_chase', 'rig_sweep'] },
  drop:      { regular: ['rainbow', 'strobe', 'pulse'],     cellAware: ['chase', 'scanner', 'sparkle', 'comet', 'buildup'],       rigWide: ['rig_chase', 'rig_alternate', 'rig_sweep', 'rig_color_wave'] },
  outro:     { regular: ['color_fade', 'pulse'],            cellAware: ['fire', 'color_wave'],                                    rigWide: ['rig_color_wave', 'rig_rainbow'] },
};

const DEFAULT_EFFECT_TYPES = {
  regular: ['pulse', 'color_fade', 'rainbow'],
  cellAware: ['chase', 'color_wave', 'sparkle'],
  rigWide: ['rig_color_wave', 'rig_chase', 'rig_rainbow'],
};

/** EFFECT_COLORS matches EFFECT_STYLE in index.html */
const EFFECT_COLORS = {
  pulse:          '#1e88e5',
  rainbow:        '#ff6f00',
  strobe:         '#f44336',
  color_fade:     '#8e24aa',
  chase:          '#00897b',
  comet:          '#e65100',
  scanner:        '#00838f',
  sparkle:        '#fdd835',
  color_wave:     '#7b1fa2',
  fire:           '#bf360c',
  buildup:        '#2e7d32',
  rig_chase:      '#00bfa5',
  rig_color_wave: '#6a1b9a',
  rig_sweep:      '#0277bd',
  rig_alternate:  '#c62828',
  rig_converge:   '#ad1457',
  rig_rainbow:    '#e65100',
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
  const CASCADE_TYPES = new Set(['chase', 'comet', 'scanner', 'sparkle', 'color_wave', 'pulse', 'rainbow', 'buildup', 'strobe', 'wave', 'fade', 'flash']);

  // Effect density per section type, scaled by genre preset
  const sectionEffectChance = {
    intro: 0.3, verse: 0.4, chorus: 0.8, bridge: 0.35,
    breakdown: 0.35, buildup: 0.7, drop: 0.95, outro: 0.25,
  };

  /**
   * Emit effect cues for a fixture group across a time range.
   * Fixtures are sorted by rig position (rig_order → rig_x) so cascades
   * sweep left-to-right across the physical rig layout.
   * @param {Object} group       - { fixtures, isLedBar }
   * @param {Object} effect      - Effect record from DB
   * @param {number} startMs     - Start time in ms
   * @param {number} durationMs  - Duration in ms
   * @param {Object} baseColor   - { r, g, b }
   * @param {number} lane        - Sequencer lane
   * @param {boolean} cascade    - Whether to stagger start times across fixtures
   */
  function emitGroupCues(group, effect, startMs, durationMs, baseColor, lane, cascade) {
    // Sort fixtures by rig position for spatial cascading
    const sorted = [...group.fixtures].sort((a, b) => {
      if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
      return (a.rig_x || 0.5) - (b.rig_x || 0.5);
    });
    const fixtureCount = sorted.length;

    // Cascade offset: stagger start times across fixtures for a sweep effect.
    // When fixtures have meaningful rig_x positions, use the spatial span.
    // When they're all at the same default position (0.5), use index-based
    // fallback so cascading still works without a configured rig layout.
    let cascadeSpreadMs = 0;
    if (cascade && fixtureCount > 1) {
      const rigXValues = sorted.map(f => f.rig_x ?? 0.5);
      const rawSpan = Math.max(...rigXValues) - Math.min(...rigXValues);

      if (rawSpan > 0.05) {
        // Fixtures are spatially spread — use rig span.
        // Scale: full-span rig (1.0) gets 2 beats of spread; half-span gets 1 beat.
        cascadeSpreadMs = Math.min(beatMs * 2.0 * rawSpan, durationMs * 0.35);
      } else {
        // Fixtures are bunched/at defaults — fall back to index-based spread.
        // Spread across 1.5 beats regardless of positions so cascade is always audible/visible.
        cascadeSpreadMs = Math.min(beatMs * 1.5, durationMs * 0.35);
      }
    }
    const cascadeStepMs = fixtureCount > 1 ? cascadeSpreadMs / (fixtureCount - 1) : 0;

    for (let i = 0; i < fixtureCount; i++) {
      const fix = sorted[i];
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

  /**
   * Emit rig-wide effect cues: one cue per fixture, all at the same time.
   * The effects engine uses each fixture's rig_x/rig_y to create spatial patterns.
   * Fixtures are sorted by rig_order for consistent spatial effect rendering.
   */
  function emitRigWideCues(fixtures, effect, startMs, durationMs, baseColor, lane) {
    // Sort by rig_order → rig_x so spatial effects resolve consistently
    const sorted = [...fixtures].sort((a, b) => {
      if ((a.rig_order || 0) !== (b.rig_order || 0)) return (a.rig_order || 0) - (b.rig_order || 0);
      return (a.rig_x || 0.5) - (b.rig_x || 0.5);
    });
    for (const fix of sorted) {
      cues.push({
        lane,
        start_ms: startMs,
        duration_ms: Math.round(durationMs),
        cue_type: 'effect',
        fixture_id: fix.id,
        effect_id: effect.id,
        effect_params: {},
        channel_values: { red: baseColor.r, green: baseColor.g, blue: baseColor.b, dimmer: 255 },
        color: EFFECT_COLORS[effect.type] || '#00bfa5',
        label: `⟷ ${effect.name}`,
      });
    }
  }

  // ── Assign a dedicated lane for rig-wide effects ──────────────────────
  const rigLane = laneCounter++;

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

      const activeSE = ctx.activeSectionEffects || SECTION_EFFECT_TYPES;
      const typesMap = activeSE[label] || DEFAULT_EFFECT_TYPES;
      const sectionPalette = getSectionPalettes(paletteKey, label, ctx.activePalettes);

      // ── Rig-wide effects: evaluated INDEPENDENTLY from group effects ──
      // So that even if a section skips its group effects (random chance),
      // rig-wide spatial effects can still fire.  This makes the rig cascade
      // much more visible and consistent.
      const rigWideMult = preset.rigWideMult || 1.0;
      let rigDesired = typesMap.rigWide || DEFAULT_EFFECT_TYPES.rigWide || [];
      if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
        const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
        if (preferred.length > 0) rigDesired = preferred;
      }
      const isHighEnergySec = label === 'chorus' || label === 'drop' || label === 'buildup';
      const rigThreshold = isHighEnergySec && rigWideMult >= 0.8
        ? 0  // guaranteed for high-energy
        : Math.max(0.05, 0.2 / rigWideMult);
      if (rigDesired.length > 0 && allNonMovers.length >= 2 && rand() > rigThreshold) {
        const rigEffect = pickEffect(rigDesired);
        if (rigEffect) {
          const maxBars = isHighEnergySec ? 4 : 8;
          const rigDur = Math.min(sectionDuration, barMs * maxBars);
          const rigEffDur = Math.max(barMs * 2, rigDur);
          let t = sectionStart;
          let segIdx = 0;

          while (t < sectionEnd) {
            const dur = Math.min(rigEffDur, sectionEnd - t);
            if (dur < barMs) break;
            const baseColor = sectionPalette[segIdx % sectionPalette.length];
            emitRigWideCues(allNonMovers, rigEffect, t, dur, baseColor, rigLane);
            t += rigEffDur;
            segIdx++;
          }
        }
      }

      // ── Group effects: per fixture-type-group, subject to section chance ─
      const chance = (sectionEffectChance[label] || 0.3) * preset.cueDensityMult;
      if (rand() > Math.min(chance, 0.95)) continue;

      // Each fixture-type group picks its own effect but stays consistent within the group
      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? typesMap.cellAware : typesMap.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        const maxDur = Math.min(sectionDuration, barMs * 8);
        const effectDurationMs = Math.max(barMs * 2, maxDur);
        let t = sectionStart;
        let segIdx = 0;

        while (t < sectionEnd) {
          const dur = Math.min(effectDurationMs, sectionEnd - t);
          if (dur < barMs) break;
          // Rotate palette per segment for colour variety within long sections
          const baseColor = sectionPalette[segIdx % sectionPalette.length];
          emitGroupCues(group, effect, t, dur, baseColor, groupLanes[typeName], useCascade);
          t += effectDurationMs;
          segIdx++;
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

      const sectionPalette = getSectionPalettes(paletteKey, 'verse', ctx.activePalettes);
      const baseColor = sectionPalette[Math.floor(rand() * sectionPalette.length)];

      for (const [typeName, group] of groupEntries) {
        const desiredTypes = group.isLedBar ? defaultTypes.cellAware : defaultTypes.regular;
        const effect = pickEffect(desiredTypes);
        if (!effect) continue;

        const useCascade = CASCADE_TYPES.has(effect.type) && group.fixtures.length > 1;
        emitGroupCues(group, effect, startMs, dur, baseColor, groupLanes[typeName], useCascade);
      }

      // Rig-wide effects in bar-based mode — genre-aware probability (boosted)
      const rigWideMult = preset.rigWideMult || 1.0;
      const barRigThreshold = Math.max(0.05, 0.25 / rigWideMult);
      if (allNonMovers.length >= 2 && rand() > barRigThreshold) {
        let rigDesired = defaultTypes.rigWide || [];
        if (preset.rigWidePreference && preset.rigWidePreference.length > 0) {
          const preferred = rigDesired.filter(t => preset.rigWidePreference.includes(t));
          if (preferred.length > 0) rigDesired = preferred;
        }
        const rigEffect = pickEffect(rigDesired);
        if (rigEffect) {
          emitRigWideCues(allNonMovers, rigEffect, startMs, dur, baseColor, rigLane);
        }
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
  verse:     ['chase_slow', 'alternate', 'color_wave', 'fill_sweep', 'chase'],
  chorus:    ['chase', 'alternate', 'scatter', 'all_flash'],
  bridge:    ['color_wave', 'alternate', 'chase_slow'],
  breakdown: ['fill_sweep', 'breathe'],
  buildup:   ['build_reveal', 'chase_accel'],
  drop:      ['chase_fast', 'scatter_strobe', 'alternate_fast', 'all_flash'],
  outro:     ['fill_sweep', 'color_wave', 'breathe'],
};

/**
 * Main multi-cell pattern orchestrator.
 * Groups multi-cell fixtures by type_name and, for high-energy sections,
 * cascades patterns across all fixtures in each group — treating them as
 * one large virtual fixture so chases/waves sweep from fixture to fixture.
 * Calmer sections still get independent per-fixture patterns for variety.
 */
function generateMultiCellPatterns(cues, multiCellFixtures, sections, ctx) {
  const { barMs, beatMs, rand, paletteKey, preset, snapBeat } = ctx;

  // Sub-phrase length in bars — longer sections get broken into sub-phrases
  // for visual variety instead of one pattern for the entire section.
  const SUB_PHRASE_BARS = 8;

  // ── Group multi-cell fixtures by type_name for cross-fixture cascading ──
  const fixtureGroups = {};  // { type_name: [fix, fix, ...] }
  for (const fix of multiCellFixtures) {
    if ((fix.cell_count || 0) < 2) continue;
    const key = fix.type_name || `unknown_${fix.id}`;
    if (!fixtureGroups[key]) fixtureGroups[key] = [];
    fixtureGroups[key].push(fix);
  }

  // Section labels that strongly favour cross-fixture cascade
  const CASCADE_SECTIONS = new Set(['chorus', 'drop', 'buildup']);

  for (const [typeName, group] of Object.entries(fixtureGroups)) {
    const canCascade = group.length > 1;

    for (const section of sections) {
      const label = section.label || 'verse';
      // Snap section start to beat grid for tight beat coupling
      const secStartMs = snapBeat(Math.round(section.start_ms));
      const secEndMs = Math.round(section.end_ms);
      const secDurMs = secEndMs - secStartMs;
      if (secDurMs < barMs) continue;

      // Decide: cross-fixture cascade or independent per-fixture patterns.
      // High-energy sections always cascade; others have a 50 % chance.
      const useCascade = canCascade && (
        CASCADE_SECTIONS.has(label) || rand() > 0.5
      );

      // Build fixture context(s) — either one virtual context spanning
      // all fixtures or one context per fixture (original behaviour).
      const fixtureContexts = [];
      if (useCascade) {
        // Build virtual cell array: cells concatenated across all fixtures
        const virtualCells = [];
        for (const fix of group) {
          for (let c = 1; c <= fix.cell_count; c++) {
            virtualCells.push({ fix, cell: c });
          }
        }
        const refFix = group[0];
        const existingCue = cues.find(c => c.fixture_id === refFix.id);
        fixtureContexts.push({
          fix: refFix,
          lane: existingCue ? existingCue.lane : 0,
          cellCount: virtualCells.length,
          virtualCells,
          hasDimmer: refFix.channels.some(ch => ch.type === 'dimmer'),
          hasWhite: refFix.channels.some(ch => ch.type === 'white'),
        });
      } else {
        for (const fix of group) {
          const existingCue = cues.find(c => c.fixture_id === fix.id);
          fixtureContexts.push({
            fix,
            lane: existingCue ? existingCue.lane : 0,
            cellCount: fix.cell_count,
            hasDimmer: fix.channels.some(ch => ch.type === 'dimmer'),
            hasWhite: fix.channels.some(ch => ch.type === 'white'),
          });
        }
      }

      const activeCPM = ctx.activeCellPatterns || CELL_PATTERN_MAP;
      const patterns = activeCPM[label] || activeCPM.verse || CELL_PATTERN_MAP.verse;
      const allPalettes = getSectionPalettes(paletteKey, label, ctx.activePalettes);
      const style = (ctx.activeSectionStyles || sectionStyles)[label] || defaultStyle;
      const baseIntensity = Math.min(1, ((style.intensity[0] + style.intensity[1]) / 2) * preset.intensityMult);

      // Determine how many sub-phrases fit in this section
      const subPhraseMs = SUB_PHRASE_BARS * barMs;
      const numSubPhrases = Math.max(1, Math.floor(secDurMs / subPhraseMs));
      // Only sub-phrase if section is long enough (>= 2 sub-phrases)
      const useSubPhrases = numSubPhrases >= 2 && label !== 'buildup';

      for (const fCtx of fixtureContexts) {
        if (useSubPhrases) {
          // Break section into sub-phrases, each gets a different pattern & palette
          let lastPattern = '';
          for (let sp = 0; sp < numSubPhrases; sp++) {
            const spStart = secStartMs + sp * subPhraseMs;
            const spEnd = sp === numSubPhrases - 1 ? secEndMs : secStartMs + (sp + 1) * subPhraseMs;
            const spDur = spEnd - spStart;
            if (spDur < barMs) continue;

            // Pick a pattern different from the previous sub-phrase
            let pattern;
            for (let tries = 0; tries < 5; tries++) {
              pattern = patterns[Math.floor(rand() * patterns.length)];
              if (pattern !== lastPattern || patterns.length <= 1) break;
            }
            lastPattern = pattern;

            // Rotate palette for each sub-phrase
            const palettes = [allPalettes[sp % allPalettes.length]];
            // Include a second palette for contrast
            if (allPalettes.length > 1) palettes.push(allPalettes[(sp + 1) % allPalettes.length]);

            const patternCtx = {
              ...fCtx,
              secStartMs: spStart, secEndMs: spEnd, secDurMs: spDur,
              palettes, baseIntensity, label,
              ...ctx,
            };

            _dispatchCellPattern(cues, pattern, patternCtx);
          }
        } else {
          // Short section — single pattern
          const pattern = patterns[Math.floor(rand() * patterns.length)];
          const patternCtx = {
            ...fCtx,
            secStartMs, secEndMs, secDurMs,
            palettes: allPalettes, baseIntensity, label,
            ...ctx,
          };
          _dispatchCellPattern(cues, pattern, patternCtx);
        }
      }
    }
  }

  cues.sort((a, b) => a.start_ms - b.start_ms || a.lane - b.lane);
}

/** Dispatch a cell pattern by name */
function _dispatchCellPattern(cues, pattern, ctx) {
  switch (pattern) {
    case 'chase_slow':     cellPatternChase(cues, ctx, 'slow'); break;
    case 'chase':          cellPatternChase(cues, ctx, 'medium'); break;
    case 'chase_fast':     cellPatternChase(cues, ctx, 'fast'); break;
    case 'chase_accel':    cellPatternChaseAccel(cues, ctx); break;
    case 'alternate':      cellPatternAlternate(cues, ctx, 'normal'); break;
    case 'alternate_fast': cellPatternAlternate(cues, ctx, 'fast'); break;
    case 'color_wave':     cellPatternColorWave(cues, ctx); break;
    case 'scatter':        cellPatternScatter(cues, ctx, false); break;
    case 'scatter_strobe': cellPatternScatter(cues, ctx, true); break;
    case 'fill_sweep':     cellPatternFillSweep(cues, ctx); break;
    case 'build_reveal':   cellPatternBuildReveal(cues, ctx); break;
    case 'all_flash':      cellPatternAllFlash(cues, ctx); break;
    case 'breathe':        cellPatternBreathe(cues, ctx); break;
  }
}

/**
 * Resolve a virtual cell index to actual fixture + cell.
 * When p.virtualCells is set (cross-fixture cascade mode), the cell index
 * spans all fixtures in the group. Otherwise it maps 1:1 to p.fix.
 */
function _resolveCell(p, cell) {
  if (p.virtualCells) {
    const idx = cell - 1;
    if (idx < 0 || idx >= p.virtualCells.length) return null;
    const vc = p.virtualCells[idx];
    return { fix: vc.fix, cell: vc.cell };
  }
  return { fix: p.fix, cell };
}

/**
 * Helper: create a per-cell cue.
 * Supports virtual cells for cross-fixture cascade — when p.virtualCells is
 * present, the cell index is resolved to the correct fixture + cell.
 */
function cellCue(cues, p, cell, startMs, durMs, startColor, endColor, cueType, label) {
  const resolved = _resolveCell(p, cell);
  if (!resolved) return;

  const startVals = { red: startColor.r, green: startColor.g, blue: startColor.b };
  const endVals = endColor ? { red: endColor.r, green: endColor.g, blue: endColor.b } : {};
  if (p.hasDimmer) {
    // Dimmer at full — intensity is already baked into the RGB values
    startVals.dimmer = 255;
    if (endColor) endVals.dimmer = 255;
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
    fixture_id: resolved.fix.id,
    cell: resolved.cell,
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
        // Strobe flash — resolve virtual cell for cross-fixture cascade
        const resolved = _resolveCell(p, cell);
        if (!resolved) continue;
        const strobeVals = { red: color.r, green: color.g, blue: color.b, strobe_hz: 15 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        if (p.hasWhite) strobeVals.white = 200;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(dur),
          cue_type: 'strobe', fixture_id: resolved.fix.id, cell: resolved.cell,
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
        const resolved = _resolveCell(p, cell);
        if (!resolved) continue;
        const strobeVals = { red: 255, green: 255, blue: 255, strobe_hz: 18 };
        if (p.hasDimmer) strobeVals.dimmer = 255;
        cues.push({
          lane: p.lane, start_ms: Math.round(t), duration_ms: Math.round(Math.min(beatMs * 0.5, dur)),
          cue_type: 'strobe', fixture_id: resolved.fix.id, cell: resolved.cell,
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
  genrePalettes,
  genrePresets,
  genreAliases,
  resolveGenrePreset,
  PALETTE_KEYS,
  ALL_PALETTE_OPTIONS,
};
