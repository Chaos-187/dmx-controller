/**
 * Color Palettes, Genre Palettes, Genre Presets & Section Styles
 *
 * Extracted from sequence-generator.js for modularity.
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
  drop:      { intensity: [0.9, 1.0],    beatColorChange: true,  beatColorBars: 0.5, strobeChance: 0.35, strobeDurationBeats: 0.5, cuePerBars: 0.5, dropEnergy: true },
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
