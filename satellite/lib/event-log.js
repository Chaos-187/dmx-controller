'use strict';

const { colorizeLogLine } = require('../../lib/console-ansi');

const MAX_ENTRIES = 500;
const LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

/** @type {{ id: number, ts: number, level: string, message: string }[]} */
const entries = [];
let nextId = 1;
let consoleHooked = false;
let minLevel = 'info';

function setMinLevel(level) {
  minLevel = LEVEL_RANK[level] != null ? level : 'info';
}

function normalizeLevel(level) {
  if (!level || level === 'log') return 'info';
  return LEVEL_RANK[level] != null ? level : 'info';
}

function levelAllowed(level) {
  const rank = LEVEL_RANK[normalizeLevel(level)];
  return rank != null && rank >= (LEVEL_RANK[minLevel] ?? LEVEL_RANK.info);
}

function add(level, message) {
  const lvl = normalizeLevel(level);
  if (!levelAllowed(lvl)) return null;
  const entry = {
    id: nextId++,
    ts: Date.now(),
    level: lvl,
    message: String(message ?? ''),
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

function getEntries({ since = 0, limit = 200, minLevel: minLv } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_ENTRIES);
  const minRank = minLv ? (LEVEL_RANK[normalizeLevel(minLv)] ?? LEVEL_RANK.info) : (LEVEL_RANK[minLevel] ?? LEVEL_RANK.info);
  let list = entries.filter((e) => LEVEL_RANK[e.level] >= minRank);
  if (since > 0) list = list.filter((e) => e.id > since);
  else list = list.slice(-max);
  return list.slice(-max);
}

function clear() {
  entries.length = 0;
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

function inferLevel(method, message) {
  if (method === 'error') return 'error';
  if (method === 'warn') return 'warn';
  if (method === 'debug') return 'debug';
  if (/\[OS2L-DEBUG\]/i.test(message)) return 'debug';
  return 'info';
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
      const level = inferLevel(method, message);
      original(colorizeLogLine(level, message));
      add(level, message);
    };
  }
}

module.exports = {
  add,
  getEntries,
  clear,
  installConsoleHook,
  setMinLevel,
  normalizeLevel,
  LEVEL_RANK,
};
