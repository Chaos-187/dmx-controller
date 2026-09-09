/**
 * Fixture Library Module
 *
 * Handles importing fixtures from the Open Fixture Library (OFL) JSON format
 * and converting them into the internal fixture_type schema used by this app.
 *
 * OFL schema: https://github.com/OpenLightingProject/open-fixture-library
 */

// ─── OFL Capability Type → Internal Channel Type Mapping ────────────────────

const OFL_TYPE_MAP = {
  'Pan':              'pan',
  'Tilt':             'tilt',
  'Intensity':        'dimmer',
  'ShutterStrobe':    'strobe',
  'StrobeSpeed':      'strobe',
  'StrobeDuration':   'strobe',
  'PanTiltSpeed':     'speed',
  'Speed':            'speed',
  'EffectSpeed':      'speed',
  'SoundSensitivity': 'speed',
  'WheelSlot':        'color_wheel', // overridden per-wheel for gobos
  'WheelRotation':    'color_wheel',
  'WheelShake':       'color_wheel',
  'WheelSlotRotation':'gobo_rotation',
  'Prism':            'prism',
  'PrismRotation':    'prism',
  'Focus':            'focus',
  'Zoom':             'zoom',
  'Frost':            'frost',
  'Fog':              'smoke',
  'FogOutput':        'smoke',
  'FogType':          'macro',
  'BeamAngle':        'zoom',
  'BeamPosition':     'other',
  'BladeInsertion':   'other',
  'BladeRotation':    'other',
  'BladeSystemRotation': 'other',
  'ColorTemperature': 'other',
  'ColorPreset':      'color_wheel',
  'Effect':           'macro',
  'EffectParameter':  'macro',
  'EffectDuration':   'macro',
  'Generic':          'other',
  'Maintenance':      'other',
  'NoFunction':       'other',
  'Rotation':         'motor',
  'IrisEffect':       'other',
  'Iris':             'other',
};

// Color name → channel type (for ColorIntensity capabilities)
const COLOR_TYPE_MAP = {
  'Red':          'red',
  'Green':        'green',
  'Blue':         'blue',
  'White':        'white',
  'Amber':        'amber',
  'UV':           'uv',
  'Warm White':   'white',
  'Cold White':   'white',
  'Cyan':         'other',
  'Magenta':      'other',
  'Yellow':       'other',
  'Lime':         'other',
  'Indigo':       'other',
};

// OFL category → internal category
const OFL_CATEGORY_MAP = {
  'Moving Head':    'moving_head',
  'Moving Head Wash': 'moving_head_wash',
  'Moving Head Spot': 'moving_head_spot',
  'Barrel Scanner': 'moving_head',
  'Scanner':        'moving_head',
  'Blinder':        'strobe',
  'Strobe':         'strobe',
  'Dimmer':         'dimmer',
  'Color Changer':  'par',
  'Fan':            'other',
  'Stand':          'other',
  'Other':          'other',
  'Flower':         'effect',
  'Effect':         'effect',
  'Hazer':          'fog',
  'Smoke':          'fog',
  'Laser':          'laser',
  'Matrix':         'multi_cell',
  'Pixel Bar':      'pixel_tape',
  'LED Strip':      'pixel_tape',
};

// ─── Determine Channel Type from OFL capabilities ───────────────────────────

/**
 * Determine the internal channel type from OFL channel capabilities.
 * @param {string} channelName - The channel key/name from OFL
 * @param {object} channelDef - The OFL channel definition
 * @param {object} wheels - The fixture's wheels definitions (for gobo detection)
 * @returns {string} Internal channel type
 */
function resolveChannelType(channelName, channelDef, wheels) {
  if (!channelDef || !channelDef.capabilities) {
    // Single capability channels (singleCapability: true) may not have dmxRange
    if (channelDef && channelDef.singleCapability && channelDef.capabilities) {
      return resolveCapabilityType(channelDef.capabilities[0], channelName, wheels);
    }
    return guessTypeFromName(channelName);
  }

  // Find the most significant capability (skip NoFunction)
  const meaningful = channelDef.capabilities.filter(c => c.type !== 'NoFunction');
  if (meaningful.length === 0) return 'other';

  // If all meaningful capabilities are the same type, use that
  const types = [...new Set(meaningful.map(c => c.type))];
  if (types.length === 1) {
    return resolveCapabilityType(meaningful[0], channelName, wheels);
  }

  // Mixed types — check for primary capability (first or largest range)
  return resolveCapabilityType(meaningful[0], channelName, wheels);
}

/**
 * Map a single OFL capability to an internal channel type.
 */
function resolveCapabilityType(cap, channelName, wheels) {
  if (!cap || !cap.type) return 'other';

  // ColorIntensity maps by color name
  if (cap.type === 'ColorIntensity') {
    return COLOR_TYPE_MAP[cap.color] || 'other';
  }

  // WheelSlot / WheelRotation — check if it's a gobo wheel
  if (cap.type === 'WheelSlot' || cap.type === 'WheelRotation' || cap.type === 'WheelShake') {
    const wheelName = cap.wheel || channelName;
    if (isGoboWheel(wheelName, wheels)) return 'gobo';
    return 'color_wheel';
  }

  return OFL_TYPE_MAP[cap.type] || 'other';
}

/**
 * Check if a wheel name refers to a gobo wheel by inspecting the wheel definition.
 */
function isGoboWheel(wheelName, wheels) {
  if (!wheels) return /gobo/i.test(wheelName);
  const w = wheels[wheelName];
  if (!w || !w.slots) return /gobo/i.test(wheelName);
  return w.slots.some(s => s.type === 'Gobo');
}

/**
 * Fallback: guess channel type from name string.
 */
function guessTypeFromName(name) {
  const n = name.toLowerCase();
  if (/\bpan\b/.test(n) && /\bfine\b/.test(n)) return 'pan_fine';
  if (/\btilt\b/.test(n) && /\bfine\b/.test(n)) return 'tilt_fine';
  if (/\bpan\b/.test(n)) return 'pan';
  if (/\btilt\b/.test(n)) return 'tilt';
  if (/\bdimmer\b/.test(n) || /\bintensity\b/.test(n) || /\bmaster\b/.test(n)) return 'dimmer';
  if (/\bred\b/.test(n)) return 'red';
  if (/\bgreen\b/.test(n)) return 'green';
  if (/\bblue\b/.test(n)) return 'blue';
  if (/\bwhite\b/.test(n)) return 'white';
  if (/\bamber\b/.test(n)) return 'amber';
  if (/\buv\b/.test(n)) return 'uv';
  if (/\bstrobe\b/.test(n) || /\bshutter\b/.test(n)) return 'strobe';
  if (/\bgobo\b/.test(n) && /\brot/.test(n)) return 'gobo_rotation';
  if (/\bgobo\b/.test(n)) return 'gobo';
  if (/\bcolor\b/.test(n) || /\bcolour\b/.test(n)) return 'color_wheel';
  if (/\bprism\b/.test(n)) return 'prism';
  if (/\bfocus\b/.test(n)) return 'focus';
  if (/\bzoom\b/.test(n)) return 'zoom';
  if (/\bfrost\b/.test(n)) return 'frost';
  if (/\bspeed\b/.test(n)) return 'speed';
  if (/\bsmoke\b/.test(n) || /\bfog\b/.test(n) || /\bhaze\b/.test(n)) return 'smoke';
  if (/\bfire\b/.test(n) || /\bflame\b/.test(n) || /\batmosphere\b/.test(n) || /\bpyro\b/.test(n)) return 'atmosphere';
  if (/\bmacro\b/.test(n) || /\bauto\b/.test(n) || /\beffect\b/.test(n)) return 'macro';
  if (/\bmotor\b/.test(n) || /\brotation\b/.test(n)) return 'motor';
  return 'other';
}

function resolveMotorRangeType(cap, label) {
  const text = `${label || ''} ${cap.comment || ''} ${cap.speedStart || ''} ${cap.speedEnd || ''}`.toLowerCase();
  if (cap.type === 'NoFunction' || /stop|stopped|no function/.test(text)) return 'motor_stop';
  if (/counter.?clock|ccw|anticlock/.test(text)) return 'motor_ccw';
  if (/clockwise|\bcw\b/.test(text) && !/counter/.test(text)) return 'motor_cw';
  if (cap.type === 'Rotation') {
    if (cap.speedStart === 'fast' && cap.speedEnd === 'slow') return 'motor_cw';
    if (cap.speedStart === 'slow' && cap.speedEnd === 'fast') return 'motor_ccw';
  }
  return null;
}

// ─── Build Ranges from OFL Capabilities ─────────────────────────────────────

/**
 * Convert OFL capabilities array to our internal ranges format.
 * Only creates ranges when a channel has multiple capabilities with dmxRange.
 */
function buildRanges(capabilities, channelName, wheels) {
  if (!capabilities || capabilities.length <= 1) return null;
  // Only build ranges if capabilities have dmxRange
  const withRange = capabilities.filter(c => c.dmxRange);
  if (withRange.length <= 1) return null;

  return withRange.map(cap => {
    const baseType = resolveCapabilityType(cap, channelName, wheels);
    let label = cap.comment || '';
    if (!label) {
      // Build a label from the capability
      if (cap.type === 'ShutterStrobe') {
        label = cap.shutterEffect || 'Strobe';
        if (cap.speedStart) label += ` ${cap.speedStart}→${cap.speedEnd || ''}`;
      } else if (cap.type === 'WheelSlot') {
        label = `Slot ${cap.slotNumber}`;
      } else if (cap.type === 'WheelRotation' || cap.type === 'PrismRotation' || cap.type === 'Rotation') {
        label = cap.speed || (cap.speedStart ? `${cap.speedStart}→${cap.speedEnd || ''}` : cap.type);
      } else if (cap.type === 'NoFunction') {
        label = 'No function';
      } else if (cap.type === 'Maintenance') {
        label = cap.comment || 'Maintenance';
      } else if (cap.type === 'ColorPreset') {
        label = cap.comment || 'Color Preset';
      } else if (cap.type === 'Effect') {
        label = cap.effectName || cap.comment || 'Effect';
      } else {
        label = cap.type;
      }
    }
    const motorRangeType = resolveMotorRangeType(cap, label);
    let type = motorRangeType || (baseType === 'motor' ? 'motor_stop' : baseType);
    if (cap.type === 'ShutterStrobe') {
      if (cap.shutterEffect === 'Open' || /^open$/i.test(label)) type = 'shutter_open';
      else if (cap.shutterEffect === 'Closed' || /^off$/i.test(label)) type = 'shutter_off';
    }
    return {
      min: cap.dmxRange[0],
      max: cap.dmxRange[1],
      label,
      type,
    };
  });
}

// ─── Extract Wheel Data (Color Wheel / Gobo Wheel) from OFL ─────────────────

/**
 * Extract color wheel and gobo wheel slot data from an OFL fixture definition.
 * Matches the wheel slot definitions to the channel capabilities (which have DMX ranges)
 * so we can build the internal color_wheel_colors / gobo_wheel_slots database records.
 *
 * @param {object} fixture - Full OFL fixture object
 * @returns {{ colorWheel: Array, goboWheel: Array }}
 */
function extractWheelData(fixture) {
  const wheels = fixture.wheels || {};
  const availableChannels = fixture.availableChannels || {};
  const result = { colorWheel: [], goboWheel: [] };

  for (const [wheelName, wheelDef] of Object.entries(wheels)) {
    const slots = wheelDef.slots || [];
    if (!slots.length) continue;

    const hasGobo = slots.some(s => s.type === 'Gobo');
    const hasColor = slots.some(s => s.type === 'Color');
    if (!hasGobo && !hasColor) continue;

    // Find the channel whose capabilities reference this wheel.
    // First try exact name match, then look for a cap with wheel === wheelName.
    let channelDef = availableChannels[wheelName];
    if (!channelDef) {
      for (const [, chDef] of Object.entries(availableChannels)) {
        const caps = chDef.capabilities || (chDef.capability ? [chDef.capability] : []);
        if (caps.some(c => c.wheel === wheelName)) {
          channelDef = chDef;
          break;
        }
      }
    }

    // Need capabilities with dmxRange to know DMX values
    const capabilities = channelDef
      ? (channelDef.capabilities || (channelDef.capability ? [channelDef.capability] : []))
      : [];
    if (!capabilities.length) continue;

    // Build a map from slotNumber → first WheelSlot DMX range
    const slotDmxMap = {};
    for (const cap of capabilities) {
      if (cap.type === 'WheelSlot' && cap.dmxRange && cap.slotNumber != null) {
        if (!slotDmxMap[cap.slotNumber]) {
          slotDmxMap[cap.slotNumber] = { dmx_start: cap.dmxRange[0], dmx_end: cap.dmxRange[1] };
        }
      }
    }

    // Walk through wheel slots and pair with DMX ranges
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const slotNum = i + 1; // OFL slotNumbers are 1-based
      const dmx = slotDmxMap[slotNum];
      if (!dmx) continue;

      if (hasColor && !hasGobo) {
        // Color wheel
        if (slot.type === 'Open') {
          result.colorWheel.push({ dmx_start: dmx.dmx_start, dmx_end: dmx.dmx_end, color_hex: '#FFFFFF', label: 'Open' });
        } else if (slot.type === 'Color') {
          result.colorWheel.push({
            dmx_start: dmx.dmx_start,
            dmx_end: dmx.dmx_end,
            color_hex: (slot.colors && slot.colors[0]) || '#FFFFFF',
            label: slot.name || '',
          });
        }
      }

      if (hasGobo) {
        // Gobo wheel
        if (slot.type === 'Open') {
          result.goboWheel.push({ dmx_start: dmx.dmx_start, dmx_end: dmx.dmx_end, label: 'Open' });
        } else if (slot.type === 'Gobo') {
          result.goboWheel.push({ dmx_start: dmx.dmx_start, dmx_end: dmx.dmx_end, label: slot.name || `Gobo ${i}` });
        }
      }
    }
  }

  return result;
}

// ─── Convert a single OFL fixture + mode → internal fixture_type ────────────

/**
 * Convert one OFL fixture definition for a specific mode into an internal mode object.
 *
 * @param {object} fixture - Full OFL fixture object
 * @param {object} mode - One mode from fixture.modes[]
 * @returns {object} Internal mode object { name, short_name, channels[] }
 */
function convertOflMode(fixture, mode) {
  const availableChannels = fixture.availableChannels || {};
  const wheels = fixture.wheels || {};

  // Resolve fine channel aliases into a lookup: alias → parent channel key
  const fineChannelMap = {};   // alias name → { parentKey, parentDef }
  for (const [key, chDef] of Object.entries(availableChannels)) {
    if (chDef.fineChannelAliases) {
      for (const alias of chDef.fineChannelAliases) {
        fineChannelMap[alias] = { parentKey: key, parentDef: chDef };
      }
    }
  }

  // Build channels from mode channel list
  const channels = [];
  let channelNumber = 0;

  for (const chRef of mode.channels) {
    channelNumber++;

    // null = unused channel (spacer)
    if (chRef === null) {
      channels.push({
        channel_number: channelNumber,
        name: `Unused ${channelNumber}`,
        type: 'other',
        default_value: 0,
        min_value: 0,
        max_value: 255,
        ranges: null,
        cell: null,
      });
      continue;
    }

    // If it's a matrix channel insert block, skip (advanced feature)
    if (typeof chRef === 'object' && chRef.insert === 'matrixChannels') {
      // TODO: handle matrix channel expansion
      continue;
    }

    const chName = String(chRef);

    // Check if this is a fine channel alias
    if (fineChannelMap[chName]) {
      const parent = fineChannelMap[chName];
      const parentType = resolveChannelType(parent.parentKey, parent.parentDef, wheels);
      // Determine fine type
      let fineType = 'other';
      if (parentType === 'pan') fineType = 'pan_fine';
      else if (parentType === 'tilt') fineType = 'tilt_fine';
      else fineType = 'other'; // fine channels for other types don't have a special mapping

      channels.push({
        channel_number: channelNumber,
        name: chName,
        type: fineType,
        default_value: 0,
        min_value: 0,
        max_value: 255,
        ranges: null,
        cell: null,
      });
      continue;
    }

    // Regular channel
    const chDef = availableChannels[chName];
    const type = resolveChannelType(chName, chDef, wheels);
    const capabilities = chDef ? chDef.capabilities : null;
    const ranges = buildRanges(capabilities, chName, wheels);

    // Default value: OFL uses 16-bit default; convert to 8-bit
    let defaultValue = 0;
    if (chDef && chDef.defaultValue !== undefined) {
      // If the channel has fine aliases, the default is 16-bit (0-65535)
      if (chDef.fineChannelAliases && chDef.fineChannelAliases.length > 0) {
        defaultValue = Math.round(chDef.defaultValue / 257); // 65535 / 255 ≈ 257
      } else {
        defaultValue = Math.min(255, Math.max(0, Math.round(chDef.defaultValue)));
      }
    }

    channels.push({
      channel_number: channelNumber,
      name: chName,
      type,
      default_value: defaultValue,
      min_value: 0,
      max_value: 255,
      ranges,
      cell: null,
    });
  }

  return {
    name: mode.name,
    short_name: mode.shortName || '',
    channels,
  };
}

/**
 * Convert one OFL fixture definition into our fixture_type format with modes.
 *
 * @param {object} fixture - Full OFL fixture object
 * @param {string} manufacturer - Manufacturer name
 * @returns {object} Internal fixture_type compatible object with modes[]
 */
function convertOflFixture(fixture, manufacturer) {
  // Map OFL categories to internal category
  const oflCategories = fixture.categories || [];
  let category = 'other';
  for (const cat of oflCategories) {
    if (OFL_CATEGORY_MAP[cat]) {
      category = OFL_CATEGORY_MAP[cat];
      break;
    }
  }

  // Convert all modes
  const modes = (fixture.modes || []).map(mode => convertOflMode(fixture, mode));

  // Extract color wheel and gobo wheel slot data from wheels definitions
  const wheelData = extractWheelData(fixture);

  return {
    name: fixture.name,
    manufacturer: manufacturer || '',
    category,
    modes,
    // Wheel data for import (saved separately to color_wheel_colors / gobo_wheel_slots tables)
    _colorWheel: wheelData.colorWheel,
    _goboWheel: wheelData.goboWheel,
    // Extra metadata stored but not required by fixture_types table
    _ofl: {
      fixtureKey: fixture.fixtureKey || '',
      categories: fixture.categories,
      shortName: fixture.shortName || '',
      physical: fixture.physical || null,
      comment: fixture.comment || '',
      oflURL: fixture.oflURL || '',
    },
  };
}

// ─── Parse OFL Library File ─────────────────────────────────────────────────

/**
 * Parse an OFL fixture library JSON file (which may contain one or many fixtures)
 * and return an array of fixture_type objects ready to import.
 *
 * Supports:
 *   - Single fixture JSON (has "modes" and "availableChannels")
 *   - Library format with { fixtures: [...] }
 *   - Array of fixtures: [...]
 *
 * @param {object|array} data - Parsed JSON content
 * @returns {{ fixtures: Array<object>, errors: string[] }}
 */
function parseOflLibrary(data) {
  const results = { fixtures: [], errors: [] };

  let fixtureList = [];

  if (Array.isArray(data)) {
    fixtureList = data;
  } else if (data.fixtures && Array.isArray(data.fixtures)) {
    fixtureList = data.fixtures;
  } else if (data.availableChannels || data.templateChannels) {
    // Single fixture
    fixtureList = [data];
  } else {
    results.errors.push('Unrecognized fixture library format. Expected OFL fixture JSON.');
    return results;
  }

  for (const fixture of fixtureList) {
    try {
      if (!fixture.modes || !fixture.modes.length) {
        results.errors.push(`Fixture "${fixture.name || 'unknown'}": no modes defined, skipping.`);
        continue;
      }

      const manufacturer = fixture.manufacturer
        ? (typeof fixture.manufacturer === 'string' ? fixture.manufacturer : fixture.manufacturer.name || '')
        : '';

      try {
        const converted = convertOflFixture(fixture, manufacturer);
        results.fixtures.push(converted);
      } catch (e) {
        results.errors.push(`Fixture "${fixture.name}": ${e.message}`);
      }
    } catch (e) {
      results.errors.push(`Fixture "${fixture.name || 'unknown'}": ${e.message}`);
    }
  }

  return results;
}

/**
 * Get a summary of an OFL fixture library file without full conversion.
 * Useful for preview before import.
 */
function summarizeOflLibrary(data) {
  let fixtureList = [];
  if (Array.isArray(data)) fixtureList = data;
  else if (data.fixtures && Array.isArray(data.fixtures)) fixtureList = data.fixtures;
  else if (data.availableChannels || data.templateChannels) fixtureList = [data];
  else return { count: 0, fixtures: [] };

  return {
    count: fixtureList.length,
    fixtures: fixtureList.map(f => ({
      name: f.name || 'Unknown',
      manufacturer: f.manufacturer ? (typeof f.manufacturer === 'string' ? f.manufacturer : f.manufacturer.name || '') : '',
      categories: f.categories || [],
      modes: (f.modes || []).map(m => ({
        name: m.name,
        channelCount: (m.channels || []).filter(c => c !== null).length,
      })),
    })),
  };
}

// Internal category → OFL category (reverse map built below)
const INTERNAL_CATEGORY_TO_OFL = {
  moving_head: 'Moving Head',
  moving_head_wash: 'Moving Head Wash',
  moving_head_spot: 'Moving Head Spot',
  strobe: 'Strobe',
  dimmer: 'Dimmer',
  par: 'Color Changer',
  effect: 'Effect',
  fog: 'Smoke',
  laser: 'Laser',
  multi_cell: 'Matrix',
  pixel_tape: 'Pixel Bar',
  other: 'Other',
};

const INTERNAL_COLOR_TO_OFL = {
  red: 'Red',
  green: 'Green',
  blue: 'Blue',
  white: 'White',
  amber: 'Amber',
  uv: 'UV',
};

const INTERNAL_TYPE_TO_OFL = {
  dimmer: 'Intensity',
  strobe: 'ShutterStrobe',
  pan: 'Pan',
  tilt: 'Tilt',
  pan_fine: 'Pan',
  tilt_fine: 'Tilt',
  speed: 'Speed',
  motor: 'Rotation',
  motor_stop: 'NoFunction',
  motor_cw: 'Rotation',
  motor_ccw: 'Rotation',
  shutter_open: 'ShutterStrobe',
  shutter_off: 'ShutterStrobe',
  macro: 'Effect',
  color_wheel: 'WheelSlot',
  gobo: 'WheelSlot',
  gobo_rotation: 'WheelSlotRotation',
  prism: 'Prism',
  focus: 'Focus',
  zoom: 'Zoom',
  frost: 'Frost',
  smoke: 'Fog',
  atmosphere: 'Effect',
  laser: 'Effect',
  other: 'Generic',
};

function oflCapabilityType(internalType) {
  if (INTERNAL_COLOR_TO_OFL[internalType]) return 'ColorIntensity';
  return INTERNAL_TYPE_TO_OFL[internalType] || 'Generic';
}

function buildOflCapability(internalType, min, max, label) {
  const cap = {
    dmxRange: [min, max],
    type: oflCapabilityType(internalType),
  };
  if (label) cap.comment = label;

  const colorName = INTERNAL_COLOR_TO_OFL[internalType];
  if (colorName) cap.color = colorName;

  if (internalType === 'shutter_open') {
    cap.type = 'ShutterStrobe';
    cap.shutterEffect = 'Open';
    return cap;
  }
  if (internalType === 'shutter_off') {
    cap.type = 'ShutterStrobe';
    cap.shutterEffect = 'Closed';
    return cap;
  }

  if (cap.type === 'ShutterStrobe') {
    const lower = (label || '').toLowerCase();
    if (lower.includes('off') || lower.includes('open') || lower.includes('no strobe')) {
      cap.shutterEffect = 'Open';
    } else if (lower.includes('closed') || lower.includes('blackout')) {
      cap.shutterEffect = 'Closed';
    } else {
      cap.shutterEffect = 'Strobe';
      if (min > 0) cap.speedStart = 'slow';
      if (max < 255) cap.speedEnd = 'fast';
    }
  }

  if (cap.type === 'Effect' && label) {
    cap.effectName = label;
  }

  return cap;
}

function buildOflChannelDef(ch) {
  const def = {};
  const defaultValue = ch.default_value ?? 0;
  if (defaultValue) def.defaultValue = defaultValue;

  const ranges = Array.isArray(ch.ranges) ? ch.ranges : null;
  if (ranges && ranges.length) {
    const caps = ranges.map(r => buildOflCapability(
      r.type || ch.type,
      r.min ?? 0,
      r.max ?? 255,
      r.label || '',
    ));
    if (caps.length === 1) def.capability = caps[0];
    else def.capabilities = caps;
    return def;
  }

  def.capability = buildOflCapability(
    ch.type,
    ch.min_value ?? 0,
    ch.max_value ?? 255,
    ch.name || '',
  );
  return def;
}

function buildOflWheels(colorWheel, goboWheel) {
  const wheels = {};

  if (colorWheel && colorWheel.length) {
    wheels['Color Wheel'] = {
      name: 'Color Wheel',
      slots: colorWheel.map(c => {
        const isOpen = /^open$/i.test(c.label || '');
        if (isOpen) return { type: 'Open', name: 'Open' };
        return {
          type: 'Color',
          name: c.label || '',
          colors: [c.color_hex || '#FFFFFF'],
        };
      }),
    };
  }

  if (goboWheel && goboWheel.length) {
    wheels['Gobo Wheel'] = {
      name: 'Gobo Wheel',
      slots: goboWheel.map(g => {
        const isOpen = /^open$/i.test(g.label || '');
        if (isOpen) return { type: 'Open', name: 'Open' };
        return { type: 'Gobo', name: g.label || 'Gobo' };
      }),
    };
  }

  return Object.keys(wheels).length ? wheels : undefined;
}

/**
 * Convert an internal fixture_type (+ optional wheel maps) to OFL / AGLight JSON.
 */
function exportToOfl(fixtureType, { colorWheel = [], goboWheel = [] } = {}) {
  if (!fixtureType) throw new Error('Fixture type required');

  const modes = fixtureType.modes && fixtureType.modes.length
    ? fixtureType.modes
    : [{ name: 'Default', short_name: '', channels: fixtureType.channels || [] }];

  const availableChannels = {};

  for (const mode of modes) {
    for (const ch of mode.channels || []) {
      const key = (ch.name || `Channel ${ch.channel_number}`).trim();
      const nextDef = buildOflChannelDef(ch);
      if (!availableChannels[key]) {
        availableChannels[key] = nextDef;
        continue;
      }
      const existing = availableChannels[key];
      const existingHasRanges = !!(existing.capabilities || existing.capability);
      const nextHasRanges = !!(nextDef.capabilities || nextDef.capability);
      if (!existingHasRanges && nextHasRanges) availableChannels[key] = nextDef;
    }
  }

  const oflModes = modes.map(mode => ({
    name: mode.name || 'Default',
    ...(mode.short_name ? { shortName: mode.short_name } : {}),
    channels: (mode.channels || []).map(ch => (ch.name || `Channel ${ch.channel_number}`).trim()),
  }));

  const oflCategories = [];
  const oflCat = INTERNAL_CATEGORY_TO_OFL[fixtureType.category];
  if (oflCat) oflCategories.push(oflCat);
  else if (fixtureType.category) oflCategories.push('Other');

  const fixtureKey = `${fixtureType.manufacturer || 'custom'}-${fixtureType.name}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const result = {
    $schema: 'https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/schema-12.2.0/schemas/fixture.json',
    name: fixtureType.name,
    shortName: fixtureType.name,
    manufacturer: fixtureType.manufacturer || '',
    categories: oflCategories,
    fixtureKey: fixtureKey || 'custom-fixture',
    modes: oflModes,
    availableChannels,
    meta: {
      authors: ['Thaluxis DMX'],
      createDate: new Date().toISOString().slice(0, 10),
      lastModifyDate: new Date().toISOString().slice(0, 10),
    },
  };

  const wheels = buildOflWheels(colorWheel, goboWheel);
  if (wheels) result.wheels = wheels;

  return result;
}

/**
 * Suggested download filename for an OFL / AGLight export.
 */
function exportFilename(fixtureType) {
  const mfr = (fixtureType.manufacturer || 'Custom').replace(/[^\w.-]+/g, '-');
  const name = (fixtureType.name || 'Fixture').replace(/[^\w.-]+/g, '-');
  return `${mfr}-${name}.json`.replace(/-+/g, '-');
}

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  parseOflLibrary,
  summarizeOflLibrary,
  convertOflFixture,
  convertOflMode,
  extractWheelData,
  exportToOfl,
  exportFilename,
  OFL_CATEGORY_MAP,
  OFL_TYPE_MAP,
};
