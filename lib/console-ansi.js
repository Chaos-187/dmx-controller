'use strict';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** @type {() => boolean} */
let getColorsEnabled = () => defaultColorsEnabled();

function defaultColorsEnabled() {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  if (process.env.FORCE_COLOR === '0') return false;
  return !!process.stdout?.isTTY;
}

function setColorsEnabledResolver(fn) {
  getColorsEnabled = typeof fn === 'function' ? fn : () => defaultColorsEnabled();
}

/** Module tag (inside brackets, before colon) → ANSI foreground */
const MODULE_STYLES = {
  HTTP: '\x1b[32m',
  OS2L: '\x1b[35m',
  'OS2L-DEBUG': '\x1b[90m',
  VDJ: '\x1b[36m',
  DB: '\x1b[34m',
  Denon: '\x1b[33m',
  Serato: '\x1b[95m',
  DJ: '\x1b[96m',
  Boot: '\x1b[97m',
  DMX: '\x1b[93m',
  'DMX-USB': '\x1b[33m',
  USB: '\x1b[33m',
  Art: '\x1b[93m',
  'Art-Net': '\x1b[93m',
  MIDI: '\x1b[34m',
  SEQ: '\x1b[36m',
  WS: '\x1b[90m',
  mDNS: '\x1b[32m',
  TOUCH: '\x1b[37m',
  Network: '\x1b[32m',
  FATAL: '\x1b[91m\x1b[1m',
  Companion: '\x1b[94m',
  Satellite: '\x1b[96m',
  VDJ: '\x1b[36m',
};

const LEVEL_SUFFIX = {
  error: '\x1b[91m',
  warn: '\x1b[33m',
  debug: '\x1b[90m',
  info: '',
};

function hashModule(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const palette = [36, 35, 34, 96, 95, 93, 92, 37];
  return `\x1b[${palette[Math.abs(h) % palette.length]}m`;
}

function moduleStyle(tagInner) {
  const base = tagInner.split(':')[0].trim();
  if (MODULE_STYLES[base]) return MODULE_STYLES[base];
  if (MODULE_STYLES[tagInner]) return MODULE_STYLES[tagInner];
  return hashModule(base);
}

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} message
 */
function colorizeLogLine(level, message) {
  if (!getColorsEnabled() || !message) return message;

  const lvl = LEVEL_SUFFIX[level] || '';
  const tagMatch = message.match(/^(\[[^\]]+\])([\s\S]*)/);
  if (!tagMatch) {
    if (level === 'error') return `${BOLD}\x1b[91m${message}${RESET}`;
    if (level === 'warn') return `\x1b[33m${message}${RESET}`;
    if (level === 'debug') return `${DIM}${message}${RESET}`;
    return message;
  }

  const [, tag, rest] = tagMatch;
  const inner = tag.slice(1, -1);
  const modColor = moduleStyle(inner);
  let bodyStyle = lvl;
  if (level === 'error') bodyStyle = '\x1b[91m';
  else if (level === 'warn' && !lvl) bodyStyle = '\x1b[33m';
  else if (level === 'debug') bodyStyle = '\x1b[90m';

  return `${modColor}${BOLD}${tag}${RESET}${bodyStyle}${rest}${RESET}`;
}

module.exports = {
  colorizeLogLine,
  setColorsEnabledResolver,
  defaultColorsEnabled,
  RESET,
};
