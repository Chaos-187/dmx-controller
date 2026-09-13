'use strict';

const { colorizeLogLine, setColorsEnabledResolver } = require('./console-ansi');

const MAX_ENTRIES = 2000;

const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

/** @type {{ id: number, ts: number, level: string, source: string, category: string, message: string, raw?: * }[]} */
const entries = [];
let nextId = 1;
let consoleHooked = false;
let getMinLevel = () => 'info';
/** @type {(entry: object) => void} */
let onEntry = null;

function init(opts = {}) {
  if (typeof opts.getMinLevel === 'function') getMinLevel = opts.getMinLevel;
  if (typeof opts.onEntry === 'function') onEntry = opts.onEntry;
  if (typeof opts.getLogColors === 'function') {
    setColorsEnabledResolver(() => {
      try {
        if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
        if (!process.stdout?.isTTY) return false;
        return opts.getLogColors() !== '0' && opts.getLogColors() !== false;
      } catch {
        return false;
      }
    });
  }
}

function normalizeLevel(level) {
  if (!level || level === 'log') return 'info';
  if (LEVEL_RANK[level] != null) return level;
  return 'info';
}

function minLevelRank() {
  const min = normalizeLevel(getMinLevel());
  return LEVEL_RANK[min] ?? LEVEL_RANK.info;
}

function levelAllowed(level) {
  const rank = LEVEL_RANK[normalizeLevel(level)];
  return rank != null && rank >= minLevelRank();
}

function formatArg(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function inferConsoleLevel(method, message) {
  if (method === 'error') return 'error';
  if (method === 'warn') return 'warn';
  if (method === 'debug') return 'debug';
  if (/\[OS2L-DEBUG\]/i.test(message) || /\[DEBUG\]/i.test(message)) return 'debug';
  return 'info';
}

function add(partial) {
  const level = normalizeLevel(partial.level);
  if (!levelAllowed(level)) return null;

  const entry = {
    id: nextId++,
    ts: partial.ts || Date.now(),
    level,
    source: partial.source || 'server',
    category: partial.category || partial.source || 'server',
    message: String(partial.message ?? ''),
    raw: partial.raw,
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();

  if (onEntry) {
    try {
      onEntry(entry);
    } catch {
      /* ignore broadcast errors */
    }
  }
  return entry;
}

function summarizeOs2l(data) {
  const evt = data?.evt || 'event';
  if (evt === 'subscribed') {
    return `${data.trigger || ''} = ${formatArg(data.value)}`;
  }
  if (evt === 'beat') {
    return `pos=${data.pos ?? ''} strength=${data.strength ?? ''} bpm=${data.bpm ?? ''}`;
  }
  if (evt === 'btn') {
    return `${data.name || data.button || 'btn'} state=${data.state ?? ''}`;
  }
  if (evt === 'cmd') {
    return formatArg(data.command || data.cmd || data);
  }
  return formatArg(data);
}

function os2lLevel(data) {
  const evt = data?.evt || 'event';
  if (evt === 'beat') return 'debug';
  if (evt === 'subscribed') {
    const trigger = String(data.trigger || '');
    if (/time|beatpos|level|get_beat|get_loop|get_position/i.test(trigger)) return 'debug';
    return 'info';
  }
  return 'info';
}

function addFromOs2l(data) {
  if (!data || typeof data !== 'object') return null;
  const evt = data.evt || 'event';
  return add({
    level: os2lLevel(data),
    source: 'os2l',
    category: evt,
    message: summarizeOs2l(data),
    raw: data,
  });
}

function getEntries({ since = 0, limit = 200, minLevel } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_ENTRIES);
  const minRank = minLevel ? (LEVEL_RANK[normalizeLevel(minLevel)] ?? minLevelRank()) : minLevelRank();

  let list = entries.filter((e) => LEVEL_RANK[e.level] >= minRank);
  if (since > 0) list = list.filter((e) => e.id > since);
  else list = list.slice(-max);
  return list.slice(-max);
}

function clear() {
  entries.length = 0;
}

function installConsoleHook() {
  if (consoleHooked) return;
  consoleHooked = true;

  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    const original = console[method] ? console[method].bind(console) : console.log.bind(console);
    console[method] = (...args) => {
      const message = args.map(formatArg).filter(Boolean).join(' ');
      if (!message) {
        original(...args);
        return;
      }
      const level = inferConsoleLevel(method, message);
      original(colorizeLogLine(level, message));
      add({
        level,
        source: 'server',
        category: 'server',
        message,
      });
    };
  }
}

module.exports = {
  init,
  add,
  addFromOs2l,
  getEntries,
  clear,
  installConsoleHook,
  normalizeLevel,
  LEVEL_RANK,
};
