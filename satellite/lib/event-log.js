'use strict';

const MAX_ENTRIES = 500;
const CAPTURE_PREFIX = /^\[(Satellite|Network|Thaluxis Satellite|OS2L)\]/;

/** @type {{ id: number, ts: number, level: string, message: string }[]} */
const entries = [];
let nextId = 1;
let consoleHooked = false;

function add(level, message) {
  const entry = {
    id: nextId++,
    ts: Date.now(),
    level: level || 'info',
    message: String(message ?? ''),
  };
  entries.push(entry);
  while (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

function getEntries({ since = 0, limit = 200 } = {}) {
  const max = Math.min(Math.max(parseInt(limit, 10) || 200, 1), MAX_ENTRIES);
  const filtered = since > 0
    ? entries.filter((e) => e.id > since)
    : entries.slice(-max);
  return filtered.slice(-max);
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

function installConsoleHook() {
  if (consoleHooked) return;
  consoleHooked = true;

  for (const level of ['log', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const message = args.map(formatArg).filter(Boolean).join(' ');
      if (CAPTURE_PREFIX.test(message)) {
        add(level === 'log' ? 'info' : level, message);
      }
    };
  }
}

module.exports = {
  add,
  getEntries,
  clear,
  installConsoleHook,
};
