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
  'Fog':              'dimmer',
  'FogOutput':        'dimmer',
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
  'Rotation':         'speed',
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
  'Pixel Bar':      'led_bar',
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
  if (/\bmacro\b/.test(n) || /\bauto\b/.test(n) || /\beffect\b/.test(n)) return 'macro';
  return 'other';
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
    const type = resolveCapabilityType(cap, channelName, wheels);
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
    return {
      min: cap.dmxRange[0],
      max: cap.dmxRange[1],
      label,
      type,
    };
  });
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

  return {
    name: fixture.name,
    manufacturer: manufacturer || '',
    category,
    modes,
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

// ─── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  parseOflLibrary,
  summarizeOflLibrary,
  convertOflFixture,
  convertOflMode,
  OFL_CATEGORY_MAP,
  OFL_TYPE_MAP,
};
