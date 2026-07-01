/**
 * Static fallback layout when no MIDI mappings exist in the database.
 * Effect names must match rows in the effects table.
 */

/** Effect pages only — Colors has its own dedicated page builder. */
const PAGE_NAMES = ['Color FX', 'Cell FX', 'Mover FX', 'Rig FX'];

const COLORS_PRIMARY = [
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 128, b: 0 },
  { name: 'Yellow', r: 255, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
  { name: 'White', r: 255, g: 255, b: 255, w: 255 },
  { name: 'Warm W', r: 255, g: 200, b: 150, w: 200 },
  { name: 'Amber', r: 255, g: 180, b: 0 },
  { name: 'Gold', r: 255, g: 215, b: 0 },
  { name: 'Lime', r: 128, g: 255, b: 0 },
  { name: 'Teal', r: 0, g: 180, b: 180 },
  { name: 'Sky', r: 0, g: 150, b: 255 },
  { name: 'Indigo', r: 75, g: 0, b: 130 },
  { name: 'Pink', r: 255, g: 100, b: 150 },
];

const COLORS_EXTENDED = [
  { name: 'Deep Red', r: 180, g: 0, b: 0 },
  { name: 'Forest', r: 0, g: 130, b: 0 },
  { name: 'Navy', r: 0, g: 0, b: 130 },
  { name: 'Purple', r: 128, g: 0, b: 128 },
  { name: 'Pastel R', r: 255, g: 150, b: 150 },
  { name: 'Peach', r: 255, g: 200, b: 150 },
  { name: 'Mint', r: 150, g: 255, b: 180 },
  { name: 'Lavender', r: 150, g: 150, b: 255 },
  { name: 'Congo', r: 40, g: 0, b: 100 },
  { name: 'UV', r: 80, g: 0, b: 200 },
  { name: 'Fire', r: 255, g: 40, b: 0 },
  { name: 'Sunset', r: 255, g: 80, b: 40 },
  { name: 'Electric', r: 0, g: 80, b: 255 },
  { name: 'Turquoise', r: 0, g: 220, b: 200 },
  { name: 'Hot Pink', r: 255, g: 0, b: 100 },
  { name: 'Cool W', r: 200, g: 200, b: 255, w: 200 },
];

const EFFECT_PAGES = {
  'Color FX': [
    'Rainbow Cycle', 'Fast Rainbow', 'Double Rainbow', 'Rainbow Wave',
    'Slow Color Wave', 'Short Rainbow Wave', 'Gentle Pulse', 'Breathing',
    'Red to Blue Fade', 'Blue to Green Fade', 'Sunset Fade', 'Ice Fade',
    'Slow Pulse', 'Fast Pulse', 'Heartbeat Pulse', 'Warm to Cool Fade',
    'Slow Strobe', 'Medium Strobe', 'Fast Strobe', 'Police Strobe',
    'Sparkle', 'Heavy Sparkle', 'Twinkle', 'Fire',
    'Intense Fire', 'Campfire', 'White Flash', 'Lightning Strobe',
  ],
  'Cell FX': [
    'Left Chase', 'Right Chase', 'Bounce Chase', 'Center Out Chase',
    'Outside In Chase', 'Fast Chase', 'Wide Chase', 'Theater Chase',
    'Comet Left', 'Comet Right', 'Fast Comet', 'Scanner',
    'Fast Scanner', 'Wide Scanner', 'Left Buildup', 'Right Buildup',
    'Center Buildup', 'Pixel Segments', 'Fast Segments', 'Ripple Out',
    'Fast Ripple', 'Cell Strobe', 'Random Cell Strobe', 'Gradient Sweep',
    'RGB Gradient', 'Gradient Sweep', 'RGB Gradient', 'Gradient Sweep',
  ],
  'Mover FX': [
    'Circle', 'Fast Circle', 'Small Circle', 'Large Circle',
    'Figure Eight', 'Fast Figure Eight', 'Pan Sweep', 'Fast Pan Sweep',
    'Narrow Pan Sweep', 'Tilt Sweep', 'Fast Tilt Sweep', 'Narrow Tilt Sweep',
    'Fan Out', 'Fan Narrow', 'Nod', 'Shake',
    'Random Movement', 'Slow Random', 'Random Movement', 'Slow Random',
  ],
  'Rig FX': [
    'Rig Chase L→R', 'Rig Chase R→L', 'Rig Chase Bounce', 'Rig Chase T→B',
    'Rig Chase B→T', 'Rig Fast Chase', 'Rig Wide Chase', 'Rig Color Wave L→R',
    'Rig Color Wave R→L', 'Rig Color Wave T→B', 'Rig Fast Wave',
    'Rig Sweep L→R', 'Rig Sweep R→L', 'Rig Sweep Bounce', 'Rig Sweep T→B',
    'Rig Wide Sweep', 'Rig Converge', 'Rig Diverge', 'Rig Alternate',
    'Rig Fast Alternate', 'Rig Rainbow', 'Rig Rainbow Fast', 'Rig Rainbow T→B',
  ],
};

module.exports = {
  PAGE_NAMES,
  COLORS_PRIMARY,
  COLORS_EXTENDED,
  EFFECT_PAGES,
};
