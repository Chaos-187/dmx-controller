/**
 * Hub Event Log UI — shared by config.html and index.html (embedded config).
 */
(function (global) {
  const LOG_LEVEL_RANK = { debug: 0, info: 1, warn: 2, error: 3 };

  let eventLogEl, logEntriesEl, logCountEl, ppOverlay, ppContent, logAutoScrollEl, logCaptureToggle, logUiMinLevelEl;
  let logCapturing = true;
  let logFilter = 'all';
  let logUiMinLevel = 'info';
  let logTotal = 0;
  let lastHubLogId = 0;
  const hubLogDomIds = new Set();
  const MAX_LOG = 2000;

  function esc(s) {
    if (global.esc) return global.esc(s);
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function hubLogEntryPassesUiFilters(evtType, level) {
    const lr = LOG_LEVEL_RANK[level] ?? LOG_LEVEL_RANK.info;
    const minR = LOG_LEVEL_RANK[logUiMinLevel] ?? LOG_LEVEL_RANK.info;
    if (lr < minR) return false;
    if (logFilter === 'all') return true;
    if (logFilter === 'error') return level === 'error' || level === 'warn';
    if (logFilter === 'subscribed') return evtType === 'subscribed' || evtType === 'btn' || evtType === 'cmd' || evtType === 'event';
    return evtType === logFilter;
  }

  function applyLogEntryFilters() {
    if (!logEntriesEl) return;
    logEntriesEl.querySelectorAll('.log-entry').forEach(entry => {
      const show = hubLogEntryPassesUiFilters(entry.dataset.evtType, entry.dataset.logLevel || 'info');
      entry.style.display = show ? '' : 'none';
    });
  }

  function logEvent(info) {
    if (!logCapturing || !logEntriesEl) return;
    if (info.id != null && hubLogDomIds.has(info.id)) return;
    if (info.id != null) {
      hubLogDomIds.add(info.id);
      lastHubLogId = Math.max(lastHubLogId, info.id);
    }

    const evtType = info.evtType || 'event';
    const level = info.level || info.raw?.level || 'info';
    if (!hubLogEntryPassesUiFilters(evtType, level)) return;

    logTotal++;
    if (logCountEl) logCountEl.textContent = `${logTotal} events`;

    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.dataset.evtType = evtType;
    entry.dataset.logLevel = level;
    if (info.id != null) entry.dataset.logId = String(info.id);

    const time = info.ts ? new Date(info.ts) : new Date();
    const timeStr = time.toLocaleTimeString('en-GB', { hour12: false }) + '.' + String(time.getMilliseconds()).padStart(3, '0');

    let summary = info.message || '';
    const raw = info.raw;
    if (!summary) {
      if (evtType === 'subscribed' && raw) {
        summary = `${raw.trigger || ''} = ${JSON.stringify(raw.value ?? '')}`;
      } else if (evtType === 'beat' && raw) {
        summary = `pos=${raw.pos ?? ''} strength=${raw.strength ?? ''} bpm=${raw.bpm ?? ''}`;
      } else if (evtType === 'server' && raw) {
        summary = raw.message || '';
      } else if (evtType === 'connection') {
        summary = raw?.connected ? `VDJ connected: ${raw.address || ''}` : 'VDJ disconnected';
      } else {
        summary = JSON.stringify(raw || info).substring(0, 200);
      }
    }

    entry.innerHTML = `<span class="log-time">${timeStr}</span><span class="log-level log-level-${level}">${level.toUpperCase()}</span><span class="log-type ${evtType}">${evtType}</span><span class="log-data">${esc(summary)}</span>`;
    entry._rawData = raw || info;

    entry.addEventListener('dblclick', () => {
      if (ppContent && ppOverlay) {
        ppContent.textContent = JSON.stringify(entry._rawData, null, 2);
        ppOverlay.classList.add('open');
      }
    });

    if (logFilter !== 'all' && !hubLogEntryPassesUiFilters(evtType, level)) {
      entry.style.display = 'none';
    }

    logEntriesEl.appendChild(entry);
    while (logEntriesEl.children.length > MAX_LOG) logEntriesEl.removeChild(logEntriesEl.firstChild);

    if (logAutoScrollEl?.checked && eventLogEl) {
      eventLogEl.scrollTop = eventLogEl.scrollHeight;
    }
  }

  function ingestHubLogEntry(msg) {
    const source = msg.source || 'server';
    const category = msg.category || (source === 'os2l' ? (msg.raw?.evt || 'event') : 'server');
    const evtType = source === 'os2l' ? category : 'server';
    logEvent({
      id: msg.id,
      evtType,
      level: msg.level || 'info',
      raw: msg.raw || { level: msg.level, message: msg.message },
      message: msg.message,
      ts: msg.ts,
    });
  }

  async function loadEventLog(full = false) {
    try {
      const url = full
        ? `/api/logs?limit=300&minLevel=${encodeURIComponent(logUiMinLevel)}`
        : `/api/logs?since=${lastHubLogId}&limit=300&minLevel=${encodeURIComponent(logUiMinLevel)}`;
      const data = await fetch(url).then(r => r.json());
      for (const entry of data.entries || []) {
        ingestHubLogEntry({
          id: entry.id,
          level: entry.level,
          message: entry.message,
          ts: entry.ts,
          source: entry.source,
          category: entry.category,
          raw: entry.raw,
        });
      }
      if (data.latest) lastHubLogId = Math.max(lastHubLogId, data.latest);
    } catch (e) {
      console.warn('[EventLog] fetch failed', e);
    }
  }

  function handleWsMessage(msg) {
    if (msg.type === 'connection') {
      logEvent({ evtType: 'connection', level: 'info', raw: msg, ts: msg.ts || Date.now() });
    } else if (msg.type === 'server_log') {
      ingestHubLogEntry(msg);
    } else if (msg.type === 'log_history') {
      if (Array.isArray(msg.entries)) msg.entries.forEach(ingestHubLogEntry);
    } else if (msg.type === 'log') {
      logEvent({ evtType: msg.raw?.evt || 'event', level: 'debug', raw: msg.raw, ts: msg.ts, id: msg.id });
    } else if (msg.type === 'beat') {
      logEvent({ evtType: 'beat', level: 'debug', raw: msg.data, ts: Date.now() });
    }
  }

  function init() {
    eventLogEl = document.getElementById('eventLog');
    logEntriesEl = document.getElementById('logEntries');
    if (!logEntriesEl) return;

    logCountEl = document.getElementById('logCount');
    ppOverlay = document.getElementById('ppOverlay');
    ppContent = document.getElementById('ppContent');
    logAutoScrollEl = document.getElementById('logAutoScroll');
    logCaptureToggle = document.getElementById('logCaptureToggle');
    logUiMinLevelEl = document.getElementById('logUiMinLevel');

    if (logUiMinLevelEl) {
      logUiMinLevel = logUiMinLevelEl.value || 'info';
      logUiMinLevelEl.addEventListener('change', () => {
        logUiMinLevel = logUiMinLevelEl.value || 'info';
        applyLogEntryFilters();
      });
    }

    if (logCaptureToggle) {
      logCaptureToggle.addEventListener('change', () => {
        logCapturing = logCaptureToggle.checked;
      });
    }

    const btnClear = document.getElementById('btnClearLog');
    if (btnClear) {
      btnClear.addEventListener('click', async () => {
        try { await fetch('/api/logs', { method: 'DELETE' }); } catch (e) { console.warn('Clear log failed', e); }
        logEntriesEl.innerHTML = '';
        logTotal = 0;
        lastHubLogId = 0;
        hubLogDomIds.clear();
        if (logCountEl) logCountEl.textContent = '0 events';
      });
    }

    const btnRefresh = document.getElementById('btnRefreshLog');
    if (btnRefresh) btnRefresh.addEventListener('click', () => loadEventLog(true));

    if (eventLogEl) {
      eventLogEl.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          eventLogEl.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          logFilter = btn.dataset.filter;
          applyLogEntryFilters();
        });
      });
    }

    if (ppOverlay) {
      ppOverlay.addEventListener('click', (e) => { if (e.target === ppOverlay) ppOverlay.classList.remove('open'); });
    }
  }

  function handleBootMessage(msg) {
    if (typeof global.renderBootOverlay === 'function') {
      global.renderBootOverlay(msg.boot, msg.error);
    }
  }

  global.HubEventLog = {
    init,
    handleWsMessage,
    loadEventLog,
    logEvent,
    ingestHubLogEntry,
    handleBootMessage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
