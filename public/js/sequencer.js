// ═══════════════════════════════════════════════════════════════
//  DMX Sequencer — Modern UI (complete rewrite)
// ═══════════════════════════════════════════════════════════════

/* global WaveformData */

const SEQ = (() => {
  'use strict';

  // ── State ─────────────────────────────────────────────────────
  let sequences = [];
  let currentId = null;
  let currentSeq = null;
  let cues = [];
  let fixtures = [];
  let effects = [];
  let moverPresets = [];
  let activeLanes = new Set();
  let expandedFixtures = new Set();

  let zoomPxPerSec = 5;
  let snapBeats = 4;
  let deck = 1;
  let playheadMs = 0;
  let isPlaying = false;

  let selectedIds = new Set();
  let selectedPrimary = null;
  let clipboard = null;
  let dragState = null;
  let marquee = null;
  let draggingPlayhead = false;

  // Waveform
  let wfTrackId = null;
  let wfAnalysis = null;
  let wfData = null;
  let wfRawPeaks = null;
  let wfTrackInfo = null;

  // Virtualized cue rendering
  let _cuesByKey = new Map();
  let _maxCueDurMs = 1000;

  // DMX output
  let dmxOutputOn = false;

  // Edit mode (live preview)
  let editMode = false;

  // Undo / Redo history
  const _history = [];    // array of { undo: fn, redo: fn, label: string }
  let _historyPos = -1;   // index of last applied action
  const HISTORY_MAX = 100;

  // WebSocket
  let ws = null;
  const _pendingTime = {};
  let _timeDirty = false;

  // ── Helpers ───────────────────────────────────────────────────
  function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function formatDur(s) { if (!s || s <= 0) return '--:--'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
  function formatTrackDur(seconds) {
    if (!seconds || seconds <= 0) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function apiGet(url) { return api(url); }

  // ── Undo / Redo ───────────────────────────────────────────────
  function pushUndo(label, undoFn, redoFn) {
    // Discard anything after current position (branching history)
    _history.length = _historyPos + 1;
    _history.push({ label, undo: undoFn, redo: redoFn });
    if (_history.length > HISTORY_MAX) _history.shift();
    _historyPos = _history.length - 1;
    _updateUndoUI();
  }
  async function undo() {
    if (_historyPos < 0) return;
    const entry = _history[_historyPos];
    _historyPos--;
    await entry.undo();
    _updateUndoUI();
  }
  async function redo() {
    if (_historyPos >= _history.length - 1) return;
    _historyPos++;
    const entry = _history[_historyPos];
    await entry.redo();
    _updateUndoUI();
  }
  function _updateUndoUI() {
    const hint = $('selectionHint');
    if (!hint) return;
    const canUndo = _historyPos >= 0;
    const canRedo = _historyPos < _history.length - 1;
    const parts = [];
    if (canUndo) parts.push('Ctrl+Z: undo ' + (_history[_historyPos]?.label || ''));
    if (canRedo) parts.push('Ctrl+Y: redo');
    if (selectedIds.size > 0) parts.push(selectedIds.size + ' selected');
    hint.textContent = parts.join('  ·  ');
  }
  function colorFromCh(ch) {
    const r = ch.red !== undefined ? ch.red : 0;
    const g = ch.green !== undefined ? ch.green : 0;
    const b = ch.blue !== undefined ? ch.blue : 0;
    return '#' + [r,g,b].map(v => clamp(v,0,255).toString(16).padStart(2,'0')).join('');
  }

  /** Look up display colour from a color_wheel DMX value using the fixture's color_wheel_map.
   *  Returns the hex of the entry whose dmx_start/dmx_end range contains val, or null if no map. */
  function colorFromWheel(fixtureId, dmxVal) {
    const fix = fixtures.find(f => f.id === fixtureId);
    if (!fix || !fix.color_wheel_map || fix.color_wheel_map.length === 0) return null;
    const map = fix.color_wheel_map.slice().sort((a, b) => a.dmx_start - b.dmx_start);
    // Find entry whose range contains the value
    for (const entry of map) {
      if (dmxVal >= entry.dmx_start && dmxVal <= entry.dmx_end) return entry.color_hex;
    }
    // Fallback: find nearest entry by dmx_start
    let best = map[0];
    for (const entry of map) {
      if (entry.dmx_start <= dmxVal) best = entry;
      else break;
    }
    return best ? best.color_hex : null;
  }

  /** Check whether a fixture uses a color wheel (no RGB mixing). */
  function isColorWheelFixture(fixtureId) {
    const fix = fixtures.find(f => f.id === fixtureId);
    if (!fix) return false;
    const hasRgb = fix.channels.some(ch => ch.type === 'red') &&
                   fix.channels.some(ch => ch.type === 'green') &&
                   fix.channels.some(ch => ch.type === 'blue');
    const hasCW = fix.channels.some(ch => ch.type === 'color_wheel');
    return !hasRgb && hasCW;
  }

  function snapToGrid(ms) {
    if (!snapBeats || !currentSeq?.bpm) return ms;
    const beatOffsetMs = currentSeq.beat_offset_ms || 0;
    // If we have fluid beat positions from analysis, snap to those (with offset)
    const rawBeats = wfAnalysis?.beats;
    const beats = rawBeats && rawBeats.length > 1 ? rawBeats.map(b => b + beatOffsetMs) : null;
    if (beats && beats.length > 1) {
      // Snap granularity: snapBeats 4=bar(every 4th beat), 1=beat, 0.5=half, 0.25=quarter
      const step = Math.max(1, Math.round(snapBeats));
      // Build snap candidates at the requested granularity
      let best = ms, bestDist = Infinity;
      for (let i = 0; i < beats.length; i += step) {
        const d = Math.abs(beats[i] - ms);
        if (d < bestDist) { bestDist = d; best = beats[i]; }
      }
      // For sub-beat snapping, interpolate between beats
      if (snapBeats < 1) {
        const subDiv = Math.round(1 / snapBeats); // 2 for half-beat, 4 for quarter
        for (let i = 0; i < beats.length - 1; i++) {
          const bStart = beats[i], bEnd = beats[i + 1];
          for (let s = 0; s < subDiv; s++) {
            const t = bStart + (bEnd - bStart) * (s / subDiv);
            const d = Math.abs(t - ms);
            if (d < bestDist) { bestDist = d; best = t; }
          }
        }
      }
      return best;
    }
    // Fallback: uniform grid (with offset)
    const snapMs = (60000 / currentSeq.bpm) * snapBeats;
    const shifted = ms - beatOffsetMs;
    return Math.round(shifted / snapMs) * snapMs + beatOffsetMs;
  }

  // ── API ───────────────────────────────────────────────────────
  async function api(url, opts) {
    const res = await fetch(url, opts);
    return res.json();
  }
  function apiPost(url, body) {
    return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function apiPut(url, body) {
    return api(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  function apiDel(url) {
    return api(url, { method: 'DELETE' });
  }

  // ── WebSocket ─────────────────────────────────────────────────
  let _wsBackoff = 1000;
  const WS_BACKOFF_MAX = 15000;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      _wsBackoff = 1000;
      $('connDot').classList.add('on');
      $('connText').textContent = 'Connected';
      // Re-sync edit preview state after reconnect
      if (editMode && currentId) {
        wsSend({ type: 'sequence', action: 'preview_load', sequenceId: currentId });
      }
    };
    ws.onmessage = (e) => {
      const raw = e.data;
      // Skip noise
      if (raw.includes('"server_log"') || raw.includes('"beat"') || raw.includes('"touchFixtureDisable"') ||
          raw.includes('"touchBlackoutHold"') || raw.includes('"masterDimmer"') ||
          raw.includes('"effectSpeed"') || raw.includes('"scene_activated"') ||
          raw.includes('"scene_deactivated"') || raw.includes('"os2l_button_map_created"')) return;

      const msg = JSON.parse(raw);
      if (msg.type === 'state') {
        updateConn(msg.state.connected, msg.state.vdjAddress);
        for (let d = 1; d <= 4; d++) if (msg.state.decks[d]) _pendingTime[d] = msg.state.decks[d].time || 0;
        _timeDirty = true;
      }
      else if (msg.type === 'connection') updateConn(msg.connected, msg.address);
      else if (msg.type === 'seq_loaded') handleSeqLoaded(msg);
      else if (msg.type === 'seq_unloaded') handleSeqUnloaded(msg);
      else if (msg.type === 'seq_playing') handleSeqPlaying(msg);
      else if (msg.type === 'seq_time') { _pendingTime[msg.deck] = msg.timeMs; _timeDirty = true; }
      else if (msg.type === 'dmxOutput') { dmxOutputOn = msg.enabled; updateOutputPill(); }
      else if (msg.type === 'seq_batch_progress' || msg.type === 'seq_batch_complete') handleBatchMsg(msg);
      else if (msg.type === 'analysis_complete' || msg.type === 'analysis_error' || msg.type === 'analysis_batch_complete') handleAnalysisMsg(msg);
    };
    ws.onclose = () => {
      $('connDot').classList.remove('on');
      $('connText').textContent = `Reconnecting (${Math.round(_wsBackoff/1000)}s)…`;
      setTimeout(connect, _wsBackoff);
      _wsBackoff = Math.min(_wsBackoff * 2, WS_BACKOFF_MAX);
    };
    ws.onerror = () => ws.close();
  }

  function wsSend(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

  function updateConn(connected, addr) {
    $('connDot').classList.toggle('on', connected);
    $('connText').textContent = connected ? (addr ? `VDJ: ${addr}` : 'Connected') : 'Offline';
  }

  // ── WS Handlers ───────────────────────────────────────────────
  function handleSeqLoaded(msg) {
    if (msg.deck === deck && msg.sequence && (!currentSeq || currentSeq.id !== msg.sequence.id)) {
      loadSequenceById(msg.sequence.id);
    }
  }
  function handleSeqUnloaded(msg) {
    if (msg.deck === deck) { isPlaying = false; $('btnPlay').classList.remove('active'); }
  }
  function handleSeqPlaying(msg) {
    if (msg.deck === deck) { isPlaying = msg.playing; $('btnPlay').classList.toggle('active', msg.playing); }
  }
  function handleAnalysisMsg(msg) {
    if (msg.type === 'analysis_complete') {
      const tid = +msg.track_id;
      _analyzingTracks.delete(tid);
      const t = _tracks.find(x => x.id === tid);
      if (t) t.has_analysis = 1;
      const status = $('trackStatus');
      if (status && currentPage === 'library') {
        const peaks = msg.peak_count != null ? `${msg.peak_count.toLocaleString()} peaks` : 'updated';
        status.textContent = `Track #${tid} re-analyzed (${peaks}) — zoom in to see resolution changes`;
      }
      if (currentPage === 'library') renderTrackList();
      if (wfTrackId === tid || currentSeq?.track_id === tid) {
        loadWaveform(tid, { force: true }).then(() => {
          if (currentSeq && !currentId && wfAnalysis) {
            currentSeq.bpm = (wfAnalysis.bpm > 0 ? wfAnalysis.bpm : currentSeq.bpm);
            currentSeq.duration_ms = wfAnalysis.duration_ms || currentSeq.duration_ms;
            currentSeq.beat_offset_ms = wfAnalysis.beat_offset_ms || 0;
            updateInfoPanel();
          }
          renderTimeline();
        });
      }
      return;
    }
    if (msg.type === 'analysis_error') {
      const tid = +msg.track_id;
      _analyzingTracks.delete(tid);
      if (currentPage === 'library') renderTrackList();
      console.error(`Analysis failed for track ${tid}:`, msg.error);
      return;
    }
    if (msg.type === 'analysis_batch_complete' && currentPage === 'library') loadTracks();
  }

  function handleBatchMsg(msg) {
    if (msg.type === 'seq_batch_progress') {
      const pct = Math.round(((msg.completed + msg.failed + msg.skipped) / msg.total) * 100);
      $('genFill').style.width = pct + '%';
      $('genText').textContent = `${msg.completed + msg.failed + msg.skipped} / ${msg.total}`;
    }
    if (msg.type === 'seq_batch_complete') {
      $('genFill').style.width = '100%';
      $('genText').textContent = `Done! ${msg.completed} generated, ${msg.skipped} skipped, ${msg.failed} failed`;
      $('genConfirm').disabled = false;
      $('genConfirm').textContent = 'Close';
      $('genConfirm').onclick = () => { closeModal(); loadAll(); if (currentPage === 'library') loadTracks(); };
    }
  }

  // ── DOM helpers ───────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }
  function $$(sel, el) { return (el || document).querySelectorAll(sel); }
  function on(el, ev, fn) { (typeof el === 'string' ? $(el) : el).addEventListener(ev, fn); }

  // ── Data Loading ──────────────────────────────────────────────
  let rigLayouts = [];

  async function loadAll() {
    const [seqRes, fixRes, effRes, mpRes, rigRes] = await Promise.all([
      api('/api/sequences'), api('/api/fixture-channel-map'),
      api('/api/effects'), api('/api/mover-presets'),
      api('/api/rig-layouts'),
    ]);
    sequences = seqRes; fixtures = fixRes; effects = effRes; moverPresets = mpRes; rigLayouts = rigRes;
    renderSeqList();
    if (currentPage === 'library') await loadTracks();
    renderFixtureChips();
    refreshEffectDropdown();
    refreshMoverDropdown();
    refreshRigSection();
    $('fixCount').textContent = fixtures.length;
    if (currentId) { highlightSeqItem(currentId); await loadSequenceById(currentId); }
  }

  function refreshRigSection() {
    const activeRig = rigLayouts.find(l => l.is_active);
    const nameEl = $('seqActiveRigName');
    if (activeRig) {
      nameEl.textContent = '● ' + activeRig.name;
      nameEl.style.color = 'var(--accent, #00e5ff)';
    } else {
      nameEl.textContent = 'None — load a rig from the controller';
      nameEl.style.color = 'var(--text-dim)';
    }
    const sel = $('seqRigSelect');
    sel.innerHTML = '<option value="">— Select Rig —</option>' +
      rigLayouts.map(l => `<option value="${l.id}"${l.is_active ? ' selected' : ''}>${l.is_active ? '● ' : ''}${esc(l.name)}</option>`).join('');
  }

  on('seqRigSelect', 'change', async function() {
    const id = this.value;
    if (!id) return;
    try {
      await apiPost(`/api/rig-layouts/${id}/load`);
      rigLayouts = await api('/api/rig-layouts');
      fixtures = await api('/api/fixture-channel-map');
      refreshRigSection();
      renderFixtureChips();
    } catch (e) { console.error('Failed to load rig:', e); }
  });

  async function loadSequenceById(id, opts = {}) {
    if (!id) {
      currentId = null; currentSeq = null; cues = [];
      activeLanes.clear(); selectedIds.clear(); selectedPrimary = null;
      wfAnalysis = null; wfData = null; wfRawPeaks = null; wfTrackInfo = null; wfTrackId = null;
      updateInfoPanel(); renderTimeline(); updateProps(); return;
    }
    const [seq, cueRes] = await Promise.all([
      api(`/api/sequences/${id}`), api(`/api/sequences/${id}/cues`),
    ]);
    currentId = seq.id; currentSeq = seq; cues = cueRes;
    cues.forEach(computeDisplay);
    wfAnalysis = null; wfData = null; wfRawPeaks = null; wfTrackInfo = null; wfTrackId = null;
    activeLanes = new Set(cues.map(c => c.fixture_id).filter(Boolean));
    updateInfoPanel(); renderFixtureChips(); renderTimeline();
    $('tlScroll').scrollLeft = 0;
    highlightSeqItem(currentId);
    if (seq.track_id) {
      loadWaveform(seq.track_id);
      if (currentPage === 'library') renderTrackList();
    }
    if (editMode && currentId) {
      wsSend({ type: 'sequence', action: 'preview_load', deck, sequenceId: currentId });
      previewAtPlayhead();
    }
  }

  // ── Sequence List (virtual-scroll) + Track Library ────────────
  const SEQ_ROW_H = 30;           // fixed row height in px
  const SEQ_BUFFER = 10;          // extra rows above/below viewport
  const TRACKS_PER_PAGE = 100;
  let _seqFiltered = [];          // filtered view of manual sequences
  let _seqQuery = '';             // current search string
  let _seqScrollRAF = 0;
  let currentPage = 'editor';

  // Track library state
  let _tracks = [];
  let _tracksTotal = 0;
  let _tracksPage = 0;
  let _tracksQuery = '';
  let _tracksGenre = '';
  let _tracksSource = '';
  let _tracksBpmMin = '';
  let _tracksBpmMax = '';
  let _tracksGenresLoaded = false;
  let _tracksSearchTimer = 0;
  let _analyzingTracks = new Set();

  // Generate modal state
  let _genOptions = null;
  let _genPendingTrackId = null;
  let _genPendingBtn = null;
  let _genBulkMode = false;

  function manualSequences() {
    return sequences.filter(s => !s.track_id);
  }

  function filterSequences() {
    const manual = manualSequences();
    if (!_seqQuery) { _seqFiltered = manual; }
    else {
      const q = _seqQuery.toLowerCase();
      _seqFiltered = manual.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
  }

  function setPage(page) {
    currentPage = page;
    $$('.page-tab', $('pageTabs')).forEach(b => b.classList.toggle('active', b.dataset.page === page));
    $$('.page-view').forEach(v => v.classList.toggle('active', v.dataset.page === page));
    if (page === 'library') {
      if (!_tracksGenresLoaded) loadTrackGenres();
      loadTracksStats();
      loadTracks();
    }
  }

  function renderSeqList() {
    filterSequences();
    const list = $('seqList');
    const vp = $('seqViewport');
    const status = $('seqStatus');
    const manualCount = manualSequences().length;
    if (!manualCount) {
      vp.style.height = '0'; vp.innerHTML = '';
      list.scrollTop = 0;
      status.textContent = _seqQuery ? 'No matches' : 'No manual sequences';
      return;
    }
    // Set virtual height so scrollbar reflects full list
    vp.style.height = (_seqFiltered.length * SEQ_ROW_H) + 'px';
    status.textContent = _seqQuery
      ? `${_seqFiltered.length} of ${manualCount.toLocaleString()} manual`
      : `${manualCount.toLocaleString()} manual sequence${manualCount === 1 ? '' : 's'}`;
    paintVisibleSeqs();
  }

  function paintVisibleSeqs() {
    const list = $('seqList');
    const vp = $('seqViewport');
    const scrollTop = list.scrollTop;
    const viewH = list.clientHeight;
    const first = Math.max(0, Math.floor(scrollTop / SEQ_ROW_H) - SEQ_BUFFER);
    const last = Math.min(_seqFiltered.length - 1, Math.ceil((scrollTop + viewH) / SEQ_ROW_H) + SEQ_BUFFER);
    let html = '';
    for (let i = first; i <= last; i++) {
      const s = _seqFiltered[i];
      const active = s.id === currentId ? ' active' : '';
      html += `<div class="seq-item${active}" data-id="${s.id}" style="position:absolute;top:${i * SEQ_ROW_H}px;left:0;right:0;height:${SEQ_ROW_H}px">` +
        `<span class="seq-name">${esc(s.name)}</span>` +
        `<span class="seq-dur">${formatDur((s.duration_ms||0)/1000)}</span></div>`;
    }
    vp.innerHTML = html;
    // Single delegated click handler is set up in setupEvents
  }

  function onSeqListScroll() {
    cancelAnimationFrame(_seqScrollRAF);
    _seqScrollRAF = requestAnimationFrame(paintVisibleSeqs);
  }

  // ── Track Library ─────────────────────────────────────────────
  async function loadTrackGenres() {
    if (_tracksGenresLoaded) return;
    try {
      const genres = await api('/api/tracks/genres');
      const sel = $('tracksGenreFilter');
      sel.innerHTML = '<option value="">All genres</option>';
      for (const g of genres) {
        const opt = document.createElement('option');
        opt.value = g.genre;
        opt.textContent = `${g.genre} (${g.count})`;
        sel.appendChild(opt);
      }
      _tracksGenresLoaded = true;
    } catch (e) { console.warn('Failed to load genres', e); }
  }

  async function loadTracksStats() {
    try {
      const stats = await api('/api/tracks/stats');
      $('statTotal').textContent = (stats.total || 0).toLocaleString();
      $('statLocal').textContent = (stats.local || 0).toLocaleString();
      $('statNetsearch').textContent = (stats.netsearch || 0).toLocaleString();
      $('statBpm').textContent = (stats.withBpm || 0).toLocaleString();
      $('statGenres').textContent = (stats.genres || 0).toLocaleString();
    } catch (e) { console.warn('Failed to load track stats', e); }
  }

  function buildTracksParams() {
    const params = new URLSearchParams();
    if (_tracksQuery) params.set('search', _tracksQuery);
    if (_tracksGenre) params.set('genre', _tracksGenre);
    if (_tracksSource) params.set('sourceType', _tracksSource);
    if (_tracksBpmMin) params.set('minBpm', _tracksBpmMin);
    if (_tracksBpmMax) params.set('maxBpm', _tracksBpmMax);
    params.set('limit', String(TRACKS_PER_PAGE));
    params.set('offset', String(_tracksPage * TRACKS_PER_PAGE));
    return params;
  }

  async function loadTracks() {
    const status = $('trackStatus');
    if (status) status.textContent = 'Loading…';
    try {
      const data = await api('/api/tracks?' + buildTracksParams().toString());
      _tracks = data.tracks || [];
      _tracksTotal = data.total || 0;
      renderTrackList();
    } catch (e) {
      console.error('Failed to load tracks', e);
      if ($('tracksBody')) $('tracksBody').innerHTML = '<tr><td colspan="11" class="tracks-empty">Failed to load tracks</td></tr>';
      if (status) status.textContent = 'Load failed';
    }
  }

  function renderTrackList() {
    const tbody = $('tracksBody');
    const status = $('trackStatus');
    if (!tbody) return;

    if (!_tracks.length) {
      const msg = _tracksTotal === 0
        ? 'No tracks imported yet. Configure VirtualDJ in the controller, then Re-import.'
        : 'No tracks match your filters.';
      tbody.innerHTML = `<tr><td colspan="11" class="tracks-empty">${msg}</td></tr>`;
      updateTracksPagination();
      if (status) status.textContent = _tracksTotal === 0 ? '0 tracks' : '0 matches';
      return;
    }

    const startIdx = _tracksPage * TRACKS_PER_PAGE;
    tbody.innerHTML = _tracks.map((t, i) => {
      const hasSeq = !!t.sequence_id;
      const hasAn = !!t.has_analysis;
      const rowActive = hasSeq && currentId === t.sequence_id ? ' row-active' : '';
      const bpmStr = t.bpm > 0 ? t.bpm.toFixed(1) : '';
      const srcLabel = t.source_type === 'local' ? 'Local' : 'Net';
      const analyzing = _analyzingTracks.has(t.id);
      const anBtn = hasAn
        ? `<div class="trk-action-group">` +
          `<button type="button" class="trk-action-btn analyzed" data-action="view-analysis" data-track-id="${t.id}"${analyzing ? ' disabled' : ''}>&#9835; View</button>` +
          `<button type="button" class="trk-action-btn reanalyze${analyzing ? ' analyzing' : ''}" data-action="reanalyze" data-track-id="${t.id}"${analyzing ? ' disabled' : ''}>${analyzing ? '…' : '&#8635; Re-run'}</button>` +
          `</div>`
        : `<button type="button" class="trk-action-btn${analyzing ? ' analyzing' : ''}" data-action="analyze" data-track-id="${t.id}"${analyzing ? ' disabled' : ''}>${analyzing ? 'Analyzing…' : '&#127911; Analyze'}</button>`;
      const seqBtn = hasSeq
        ? `<button type="button" class="trk-action-btn has-seq" data-action="edit-seq" data-track-id="${t.id}" data-seq-id="${t.sequence_id}">&#9835; Edit</button>`
        : `<button type="button" class="trk-action-btn" data-action="gen-seq" data-track-id="${t.id}">&#127917; Seq</button>`;
      return `<tr class="${rowActive}" data-track-id="${t.id}">` +
        `<td style="color:var(--text-muted)">${startIdx + i + 1}</td>` +
        `<td class="trk-title" title="${esc(t.filepath || '')}">${esc(t.title || t.filename)}</td>` +
        `<td class="trk-artist">${esc(t.author)}</td>` +
        `<td class="trk-genre">${esc(t.genre)}</td>` +
        `<td class="trk-path" title="${esc(t.filepath || '')}">${esc(t.filepath)}</td>` +
        `<td class="trk-bpm">${bpmStr}</td>` +
        `<td class="trk-key">${esc(t.key)}</td>` +
        `<td class="trk-duration">${formatTrackDur(t.song_length)}</td>` +
        `<td><span class="trk-source ${esc(t.source_type || '')}">${srcLabel}</span></td>` +
        `<td>${anBtn}</td>` +
        `<td>${seqBtn}</td>` +
        `</tr>`;
    }).join('');

    updateTracksPagination();
    if (status) {
      const start = startIdx + 1;
      const end = startIdx + _tracks.length;
      status.textContent = `Showing ${start}–${end} of ${_tracksTotal.toLocaleString()}`;
    }
  }

  function updateTracksPagination() {
    const totalPages = Math.max(1, Math.ceil(_tracksTotal / TRACKS_PER_PAGE));
    const page = _tracksPage + 1;
    $('tracksPageLabel').textContent = _tracksTotal ? `Page ${page} / ${totalPages}` : '—';
    $('tracksPrev').disabled = _tracksPage <= 0;
    $('tracksNext').disabled = _tracksPage >= totalPages - 1;
  }

  async function loadGenOptions() {
    if (_genOptions && _genOptions.palettes && _genOptions.palettes.length > 0) return _genOptions;
    try {
      _genOptions = await api('/api/sequences/generate-options');
    } catch (e) {
      console.warn('Failed to load generate options', e);
      _genOptions = { palettes: [], genres: [] };
    }
    return _genOptions;
  }

  function populateGenSelects(opts) {
    const palSel = $('genPalette');
    const genSel = $('genGenre');
    palSel.innerHTML = '<option value="random">Random</option>';
    (opts.palettes || []).filter(p => p.key !== 'random').forEach(p => {
      palSel.innerHTML += `<option value="${p.key}">${esc(p.label)}</option>`;
    });
    genSel.innerHTML = '<option value="auto">Auto-detect</option>';
    (opts.genres || []).forEach(g => {
      genSel.innerHTML += `<option value="${g.key}">${esc(g.label)}</option>`;
    });
    loadTemplates();
  }

  async function openGenerateModal(trackId, btn) {
    _genBulkMode = false;
    _genPendingTrackId = trackId;
    _genPendingBtn = btn;

    const opts = await loadGenOptions();
    populateGenSelects(opts);

    try {
      const tr = await api(`/api/tracks/${trackId}`);
      $('genModalTitle').textContent = 'Generate Sequence';
      $('genTrackInfo').innerHTML = `<strong>${esc(tr.title || tr.filename)}</strong><br>${esc(tr.author || '')}${tr.genre ? ' · ' + esc(tr.genre) : ''}`;
      $('genGenreHint').textContent = tr.genre
        ? `Track genre: "${tr.genre}" — auto-detect will map this automatically`
        : 'No genre tag on track — select a preset or use default';
    } catch (e) {
      $('genTrackInfo').textContent = `Track #${trackId}`;
    }

    $('genProgress').style.display = 'none';
    $('genActions').style.display = 'flex';
    $('genConfirm').disabled = false;
    $('genConfirm').textContent = 'Generate';
    $('genConfirm').onclick = confirmGenerateSingle;
    $('genModal').classList.add('open');
  }

  async function openBulkGenerateModal() {
    _genBulkMode = true;
    _genPendingTrackId = null;
    _genPendingBtn = null;

    const opts = await loadGenOptions();
    populateGenSelects(opts);

    const countParams = buildTracksParams();
    countParams.set('limit', '1');
    countParams.set('offset', '0');
    const countData = await api('/api/tracks?' + countParams.toString());
    const totalFiltered = countData.total || 0;

    $('genModalTitle').textContent = 'Bulk Generate Sequences';
    $('genTrackInfo').innerHTML = `Will generate sequences for <strong>${totalFiltered}</strong> tracks matching the current filter.<br><span style="font-size:11px;color:var(--text-dim)">Tracks without analysis will be auto-analyzed first.</span>`;
    $('genGenreHint').textContent = 'Auto-detect uses each track\'s genre tag individually';
    $('genProgress').style.display = 'none';
    $('genActions').style.display = 'flex';
    $('genConfirm').disabled = false;
    $('genConfirm').textContent = 'Generate All';
    $('genConfirm').onclick = confirmBulkGenerate;
    $('genModal').classList.add('open');
  }

  async function handleTrackAction(action, trackId, btn, seqId) {
    if (action === 'gen-seq') {
      const check = await fetch(`/api/sequences/by-track/${trackId}`);
      if (check.ok) {
        const existing = await check.json();
        await loadSequenceById(existing.id);
        setPage('editor');
        return;
      }
      await openGenerateModal(trackId, btn);
      return;
    }
    if (action === 'edit-seq' && seqId) {
      await loadSequenceById(+seqId);
      setPage('editor');
      return;
    }
    if (action === 'analyze' || action === 'reanalyze') {
      await startTrackAnalysis(trackId, btn);
      return;
    }
    if (action === 'view-analysis') {
      await loadTrackAnalysisView(trackId);
      setPage('editor');
    }
  }

  async function startTrackAnalysis(trackId, btn) {
    if (!btn || btn.disabled) return;
    trackId = +trackId;
    const origHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('analyzing');
    btn.textContent = '…';

    try {
      const res = await fetch(`/api/tracks/${trackId}/analyze`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      _analyzingTracks.add(trackId);
      if (btn.dataset.action === 'analyze') btn.textContent = 'Analyzing…';
      else btn.textContent = '…';
      renderTrackList();
    } catch (e) {
      alert('Analysis failed: ' + e.message);
      btn.disabled = false;
      btn.classList.remove('analyzing');
      btn.innerHTML = origHtml;
    }
  }

  /** Open sequencer with track waveform/analysis (loads sequence too if one exists). */
  async function loadTrackAnalysisView(trackId) {
    trackId = +trackId;

    try {
      const res = await fetch(`/api/sequences/by-track/${trackId}`);
      if (res.ok) {
        await loadSequenceById((await res.json()).id);
        return;
      }
    } catch (e) {
      console.warn('Sequence lookup failed for track', trackId, e);
    }

    currentId = null;
    currentSeq = null;
    cues = [];
    activeLanes.clear();
    selectedIds.clear();
    selectedPrimary = null;
    highlightSeqItem(null);

    await loadWaveform(trackId);

    const track = wfTrackInfo || {};
    const bpm = (wfAnalysis?.bpm > 0 ? wfAnalysis.bpm : null) || (track.bpm > 0 ? track.bpm : 128);
    const durMs = wfAnalysis?.duration_ms
      || (track.song_length > 0 ? Math.round(track.song_length * 1000) : 180000);

    currentSeq = {
      name: track.title || track.filename || 'Track',
      bpm,
      duration_ms: durMs,
      beat_offset_ms: wfAnalysis?.beat_offset_ms || 0,
      track_id: trackId,
    };

    updateInfoPanel();
    renderFixtureChips();
    renderTimeline();
    $('tlScroll').scrollLeft = 0;
    if (currentPage === 'library') renderTrackList();
  }

  async function confirmGenerateSingle() {
    const trackId = _genPendingTrackId;
    const btn = _genPendingBtn;
    const palette = $('genPalette').value;
    const genre = $('genGenre').value;
    const templateId = $('genTemplate').value;
    closeModal();

    if (btn) { btn.disabled = true; btn.textContent = '…'; }

    try {
      const body = {
        overwrite: true,
        palette: palette === 'random' ? undefined : palette,
        genre: genre === 'auto' ? undefined : genre,
      };
      if (templateId) body.template_id = +templateId;

      const seq = await apiPost(`/api/sequences/generate/${trackId}`, body);
      if (seq.error) throw new Error(seq.error);
      const existingIdx = sequences.findIndex(s => s.id === seq.id);
      if (existingIdx >= 0) sequences[existingIdx] = seq;
      else sequences.unshift(seq);
      renderSeqList();
      await loadSequenceById(seq.id);
      setPage('editor');
      await loadTracks();
    } catch (e) {
      console.error('Generate failed', e);
      alert('Failed: ' + e.message);
      if (btn) btn.textContent = 'Generate';
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function confirmBulkGenerate() {
    const palette = $('genPalette').value;
    const genre = $('genGenre').value;

    const params = buildTracksParams();
    params.set('limit', '10000');
    params.set('offset', '0');
    const data = await api('/api/tracks?' + params.toString());
    const trackIds = (data.tracks || []).map(t => t.id);
    if (!trackIds.length) { alert('No tracks match the current filter.'); return; }

    $('genConfirm').disabled = true;
    $('genConfirm').textContent = 'Generating…';
    $('genProgress').style.display = 'block';
    $('genFill').style.width = '0%';
    $('genText').textContent = `0 / ${trackIds.length}`;

    try {
      await apiPost('/api/sequences/generate-batch', {
        track_ids: trackIds,
        palette: palette === 'random' ? undefined : palette,
        genre: genre === 'auto' ? undefined : genre,
        overwrite: false,
      });
    } catch (e) {
      alert('Bulk generate failed: ' + e.message);
      $('genConfirm').disabled = false;
      $('genConfirm').textContent = 'Generate All';
      $('genProgress').style.display = 'none';
    }
  }

  function highlightSeqItem(id) {
    // Re-paint to update active class; also scroll into view
    paintVisibleSeqs();
    const idx = _seqFiltered.findIndex(s => s.id === id);
    if (idx >= 0) {
      const list = $('seqList');
      const itemTop = idx * SEQ_ROW_H;
      if (itemTop < list.scrollTop || itemTop + SEQ_ROW_H > list.scrollTop + list.clientHeight) {
        list.scrollTop = itemTop - list.clientHeight / 2 + SEQ_ROW_H / 2;
      }
    }
  }

  // ── Info Panel ────────────────────────────────────────────────
  function updateInfoPanel() {
    $('infoName').value = currentSeq?.name || '';
    $('infoBpm').value = currentSeq?.bpm ? currentSeq.bpm.toFixed(1) : '';
    $('infoDur').value = currentSeq?.duration_ms ? (currentSeq.duration_ms / 1000).toFixed(1) : '';
    $('infoOffset').value = currentSeq?.beat_offset_ms || 0;
    $('infoCues').textContent = cues.length;
    $('btnSaveSeq').disabled = !currentSeq;
  }

  async function saveSequenceInfo() {
    if (!currentId || !currentSeq) return;
    const name = $('infoName').value.trim();
    const bpm = parseFloat($('infoBpm').value) || currentSeq.bpm;
    const durSec = parseFloat($('infoDur').value) || (currentSeq.duration_ms / 1000);
    const beatOffset = parseFloat($('infoOffset').value) || 0;
    const update = { name: name || currentSeq.name, bpm, duration_ms: Math.round(durSec * 1000), beat_offset_ms: beatOffset };
    const result = await apiPut(`/api/sequences/${currentId}`, update);
    Object.assign(currentSeq, result);
    // Update the sidebar list entry
    const listEntry = sequences.find(s => s.id === currentId);
    if (listEntry) Object.assign(listEntry, { name: result.name, bpm: result.bpm, duration_ms: result.duration_ms });
    renderSeqList(); renderTimeline(); updateInfoPanel();
  }

  // ── Fixture Chips ─────────────────────────────────────────────
  function renderFixtureChips() {
    const el = $('fixtureChips');
    if (!fixtures.length) { el.innerHTML = '<span style="font-size:10px;color:var(--text-muted)">No fixtures</span>'; return; }
    el.innerHTML = fixtures.map(f => {
      const on = activeLanes.has(f.id) ? ' on' : '';
      return `<span class="fix-chip${on}" data-id="${f.id}">${esc(f.name)}</span>`;
    }).join('');
    $$('.fix-chip', el).forEach(chip => {
      chip.addEventListener('click', () => {
        const id = +chip.dataset.id;
        if (activeLanes.has(id)) {
          if (cues.some(c => c.fixture_id === id)) return; // can't remove with cues
          activeLanes.delete(id); chip.classList.remove('on');
        } else { activeLanes.add(id); chip.classList.add('on'); }
        renderTimeline();
      });
    });
  }

  // ── Effects / Mover Dropdowns ─────────────────────────────────
  function refreshEffectDropdown() {
    const el = $('propEffect');
    el.innerHTML = '<option value="">None</option>' +
      effects.map(e => `<option value="${e.id}">${esc(e.name)} (${e.type})</option>`).join('');
  }
  function refreshMoverDropdown() {
    const el = $('propMover');
    el.innerHTML = '<option value="">-- Select --</option>' +
      moverPresets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  // ── Compute Display Fields ────────────────────────────────────
  function computeDisplay(cue) {
    // Lightweight cues (from initial load) have no channel_values but already
    // carry server-computed display_color / end_display_color — don't overwrite.
    if (!cue.channel_values) return;

    const ch = cue.channel_values;
    const ech = cue.end_channel_values || {};
    // For color-wheel fixtures, derive display color from wheel position
    if (ch.color_wheel !== undefined && isColorWheelFixture(cue.fixture_id)) {
      cue.display_color = colorFromWheel(cue.fixture_id, ch.color_wheel) || cue.color || '#888888';
      cue.end_display_color = (ech.color_wheel !== undefined)
        ? (colorFromWheel(cue.fixture_id, ech.color_wheel) || null) : null;
    } else {
      cue.display_color = (ch.red !== undefined || ch.green !== undefined || ch.blue !== undefined)
        ? colorFromCh(ch) : (cue.color || '#e94560');
      cue.end_display_color = (ech.red !== undefined || ech.green !== undefined || ech.blue !== undefined)
        ? colorFromCh(ech) : null;
    }
    cue.mover_preset_id = ch.mover_preset_id || null;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Timeline Rendering
  // ═══════════════════════════════════════════════════════════════

  function renderTimeline() {
    const canvas = $('tlCanvas');
    const empty = $('tlEmpty');
    const ruler = $('tlRuler');
    const lanes = $('tlLanes');
    const ph = $('tlPlayhead');

    if (!currentSeq) {
      canvas.style.display = 'none'; empty.style.display = 'flex';
      return;
    }
    canvas.style.display = 'block'; empty.style.display = 'none';

    const durMs = currentSeq.duration_ms || 180000;
    const durSec = durMs / 1000;
    const totalW = durSec * zoomPxPerSec;
    const bpm = currentSeq.bpm || 128;
    const beatMs = 60000 / bpm;

    canvas.style.width = (totalW + 140) + 'px';
    ruler.style.width = totalW + 'px';

    // Determine actual beat positions (fluid from analysis, or uniform fallback)
    const analysisBeats = wfAnalysis?.beats;
    const useFluidBeats = analysisBeats && analysisBeats.length > 4;
    const beatOffsetMs = currentSeq.beat_offset_ms || 0;
    let beatPositions; // array of beat times in ms
    if (useFluidBeats) {
      // Shift all analysis beats by user offset
      beatPositions = analysisBeats.map(b => b + beatOffsetMs);
    } else {
      beatPositions = [];
      let t = beatOffsetMs;
      while (t < durMs) { beatPositions.push(t); t += beatMs; }
    }

    // Grid: when using fluid beats, disable CSS repeating gradient and use
    // per-beat positioned grid lines in the overlay so variable spacing is visible.
    const gridOverlay = $('tlGridOverlay');
    if (useFluidBeats || beatOffsetMs !== 0) {
      // Use positioned overlay divs: necessary for fluid beats (variable spacing) or
      // when a beat offset is applied (CSS repeating-gradient can't be phase-shifted)
      canvas.style.setProperty('--beat-px', '0px');
      canvas.style.setProperty('--bar-px', '0px');
      let gridHtml = '';
      for (let i = 0; i < beatPositions.length; i++) {
        const x = (beatPositions[i] / 1000) * zoomPxPerSec;
        if (x < -2) continue; // skip off-screen left
        const isBar = i % 4 === 0;
        gridHtml += `<div class="tl-grid ${isBar ? 'bar' : 'beat'}" style="left:${x.toFixed(1)}px"></div>`;
      }
      gridOverlay.innerHTML = gridHtml;
      gridOverlay.classList.add('active');
    } else {
      const beatPx = (beatMs / 1000) * zoomPxPerSec;
      const barPx = beatPx * 4;
      canvas.style.setProperty('--beat-px', beatPx + 'px');
      canvas.style.setProperty('--bar-px', barPx + 'px');
      gridOverlay.innerHTML = '';
      gridOverlay.classList.remove('active');
    }

    // Ruler — use actual beat positions
    let rHtml = '';
    for (let bc = 0; bc < beatPositions.length; bc++) {
      const x = (beatPositions[bc] / 1000) * zoomPxPerSec;
      const isBar = bc % 4 === 0;
      const barNum = Math.floor(bc / 4) + 1;
      if (isBar || zoomPxPerSec >= 30) {
        const label = isBar ? barNum : barNum + '.' + ((bc % 4) + 1);
        rHtml += `<div class="tl-ruler-mark${isBar ? ' bar' : ''}" style="left:${x.toFixed(1)}px"><span class="rm-label">${label}</span></div>`;
      }
    }
    ruler.innerHTML = rHtml;

    // Build lane list
    const laneFixes = buildLaneList();

    if (laneFixes.length === 0 && !wfAnalysis) {
      lanes.innerHTML = '<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:12px">' +
        'Add fixtures from the sidebar to begin.</div>';
      updatePlayhead(); return;
    }

    let html = '';

    // Waveform lane
    if (wfAnalysis && wfData) {
      const title = wfTrackInfo ? (wfTrackInfo.title || wfTrackInfo.filename || 'Waveform') : 'Waveform';
      html += `<div class="tl-lane wf-lane"><div class="tl-lane-hdr"><div class="lane-color" style="background:var(--accent)"></div>` +
        `<span class="lane-name" title="${esc(title)}">${esc(title)}</span></div>` +
        `<div class="tl-lane-track"><canvas id="wfCanvas"></canvas></div></div>`;
    }

    // Rig FX master lane (for rig-wide effects with fixture_id 0)
    const hasRigFx = cues.some(c => c.track === 'fx-rig');
    if (hasRigFx || editMode) {
      html += `<div class="tl-lane sub-lane fx-lane rig-fx-lane" data-fix="0" data-lane="-1" data-sub="fx-rig">` +
        `<div class="tl-lane-hdr"><div class="lane-color" style="background:var(--purple)"></div>` +
        `<span class="lane-name">Rig FX</span><span class="lane-tag">Master</span></div>` +
        `<div class="tl-lane-track" data-fix="0" data-sub="fx-rig" data-lane-key="rig:fx"></div></div>`;
    }

    // Fixture lanes
    for (let i = 0; i < laneFixes.length; i++) {
      const fix = laneFixes[i];
      const isMulti = fix.cell_count > 0;
      const isMover = !isMulti && fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
      const isExp = expandedFixtures.has(fix.id);
      const hasRGB = fix.channels.some(c => c.type === 'red');
      // All fixtures can expand into sub-tracks (Color/FX/Motion)
      const expBtn = `<span class="lane-expand" data-fix="${fix.id}">${isExp ? '&#9660;' : '&#9654;'}</span>`;

      if (!isExp) {
        html += renderSingleLane(fix, i, expBtn, hasRGB);
      } else if (isMulti) {
        html += renderMultiCellLanes(fix, i, expBtn, hasRGB);
      } else {
        html += renderExpandedLanes(fix, i, expBtn, hasRGB, isMover);
      }
    }

    lanes.innerHTML = html;

    // Expand toggles
    $$('.lane-expand', lanes).forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = +el.dataset.fix;
        expandedFixtures.has(id) ? expandedFixtures.delete(id) : expandedFixtures.add(id);
        renderTimeline();
      });
    });

    // When using fluid beats, also disable per-lane CSS gradient backgrounds
    // and position the grid overlay to cover the lanes area.
    if (gridOverlay.classList.contains('active')) {
      $$('.tl-lane-track', lanes).forEach(lt => {
        lt.style.backgroundImage = 'none';
      });
      gridOverlay.style.top = lanes.offsetTop + 'px';
      gridOverlay.style.height = lanes.offsetHeight + 'px';
    } else {
      $$('.tl-lane-track', lanes).forEach(lt => {
        lt.style.backgroundImage = '';
      });
      gridOverlay.style.top = '';
      gridOverlay.style.height = '';
    }

    // Index cues and paint only what's visible (viewport virtualization)
    buildCueIndex(laneFixes);

    // Waveform canvas
    if (wfAnalysis && wfData) requestAnimationFrame(() => drawWaveform());

    paintVisibleCues();
    updatePlayhead();
  }

  // Sort order for fixture categories — groups similar types together
  const CATEGORY_ORDER = {
    par: 0, dimmer: 1, led_bar: 2, multi_cell: 3,
    moving_head: 4, moving_head_wash: 5, moving_head_spot: 6,
    strobe: 7, effect: 8, laser: 9, fog: 10, other: 11,
  };

  function buildLaneList() {
    const list = [];
    const laneMap = new Map();
    for (const c of cues) { if (c.fixture_id && !laneMap.has(c.fixture_id)) laneMap.set(c.fixture_id, c.lane); }
    const sorted = [...laneMap.entries()].sort((a, b) => a[1] - b[1]);
    for (const [fid] of sorted) { const f = fixtures.find(x => x.id === fid); if (f) list.push(f); }
    for (const fid of activeLanes) { if (!list.some(f => f.id === fid)) { const f = fixtures.find(x => x.id === fid); if (f) list.push(f); } }
    // Sort by fixture category/type, then by name within each type
    list.sort((a, b) => {
      const oa = CATEGORY_ORDER[a.category] ?? 99;
      const ob = CATEGORY_ORDER[b.category] ?? 99;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    return list;
  }

  // ── Cue Spatial Index (viewport virtualization) ───────────────
  function buildCueIndex(laneFixes) {
    _cuesByKey.clear();
    _maxCueDurMs = 1000;
    const fixMeta = new Map();
    for (const fix of laneFixes) {
      const isMulti = fix.cell_count > 0;
      const isMover = !isMulti && fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
      const isExp = expandedFixtures.has(fix.id);
      fixMeta.set(fix.id, { isMulti, isMover, isExp });
    }
    for (const cue of cues) {
      if (cue.duration_ms > _maxCueDurMs) _maxCueDurMs = cue.duration_ms;
      const track = cue.track || 'color';
      // Rig-wide master cues (fixture_id 0) go to the dedicated rig:fx lane
      if (track === 'fx-rig' || cue.fixture_id === 0) {
        const key = 'rig:fx';
        if (!_cuesByKey.has(key)) _cuesByKey.set(key, []);
        _cuesByKey.get(key).push(cue);
        continue;
      }
      const meta = fixMeta.get(cue.fixture_id);
      let key;
      if (!meta || !meta.isExp) {
        // Collapsed: all cues on single lane
        key = `f${cue.fixture_id}`;
      } else if (meta.isMulti) {
        // Multi-cell expanded: route by cell
        key = `f${cue.fixture_id}:c${cue.cell || 0}`;
      } else {
        // Expanded into sub-tracks: route by track type
        if (track === 'fx') {
          key = `f${cue.fixture_id}:fx`;
        } else if (track === 'move') {
          key = `f${cue.fixture_id}:move`;
        } else {
          key = `f${cue.fixture_id}:color`;
        }
      }
      if (!_cuesByKey.has(key)) _cuesByKey.set(key, []);
      _cuesByKey.get(key).push(cue);
    }
    for (const arr of _cuesByKey.values()) {
      arr.sort((a, b) => a.start_ms - b.start_ms);
    }
    // Merge collapsed multi-cell lanes into summary blocks
    for (const [key, arr] of _cuesByKey.entries()) {
      if (key.includes(':')) continue; // expanded sub-lane
      const fid = parseInt(key.substring(1));
      const meta = fixMeta.get(fid);
      if (meta && meta.isMulti && !meta.isExp && arr.length > 1) {
        _cuesByKey.set(key, _mergeCollapsed(arr));
      }
    }
  }

  function _mergeCollapsed(sorted) {
    const merged = [];
    let g = null;
    for (const c of sorted) {
      if (!g || c.start_ms > g.start_ms + g.duration_ms) {
        if (g) merged.push(g);
        g = { start_ms: c.start_ms, duration_ms: c.duration_ms, _count: 1, _merged: true,
              display_color: c.display_color || c.color || '#e94560', id: -1, cue_type: 'solid' };
      } else {
        const newEnd = Math.max(g.start_ms + g.duration_ms, c.start_ms + c.duration_ms);
        g.duration_ms = newEnd - g.start_ms;
        g._count++;
      }
    }
    if (g) merged.push(g);
    return merged;
  }

  function paintVisibleCues() {
    if (dragState || marquee) return;
    const sw = $('tlScroll');
    if (!sw || !currentSeq) return;
    const scrollLeft = sw.scrollLeft;
    const scrollTop = sw.scrollTop;
    const viewW = sw.clientWidth;
    const viewH = sw.clientHeight;
    const lanesEl = $('tlLanes');
    const lanesTop = lanesEl ? lanesEl.offsetTop : 0;
    const HDR_W = 140;
    const visStartMs = Math.max(0, ((scrollLeft - HDR_W) / zoomPxPerSec) * 1000 - _maxCueDurMs);
    const visEndMs = ((scrollLeft + viewW - HDR_W) / zoomPxPerSec) * 1000;
    const tracks = document.querySelectorAll('.tl-lane-track[data-lane-key]');
    for (const track of tracks) {
      // Vertical visibility: skip lanes scrolled out of view
      const lane = track.parentElement;
      const laneTop = lanesTop + lane.offsetTop;
      const laneBot = laneTop + lane.offsetHeight;
      if (laneBot < scrollTop || laneTop > scrollTop + viewH) {
        if (track.childNodes.length > 0) track.innerHTML = '';
        continue;
      }
      const key = track.dataset.laneKey;
      const laneCues = _cuesByKey.get(key);
      if (!laneCues || laneCues.length === 0) {
        if (track.childNodes.length > 0) track.innerHTML = '';
        continue;
      }
      let lo = 0, hi = laneCues.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (laneCues[mid].start_ms < visStartMs) lo = mid + 1;
        else hi = mid;
      }
      let html = '';
      for (let i = lo; i < laneCues.length; i++) {
        const c = laneCues[i];
        if (c.start_ms > visEndMs) break;
        html += renderCueBlock(c);
      }
      track.innerHTML = html;
    }
  }

  function renderCueBlock(cue) {
    const left = (cue.start_ms / 1000) * zoomPxPerSec;
    const width = Math.max(4, (cue.duration_ms / 1000) * zoomPxPerSec);
    if (cue._merged) {
      return `<div class="tl-cue merged" style="left:${left}px;width:${width}px;background:${cue.display_color}" ` +
        `title="${cue._count} cues">${cue._count}</div>`;
    }
    const sel = selectedIds.has(cue.id) ? ' selected' : '';
    const sc = cue.display_color || cue.color || '#e94560';
    const bg = (cue.end_display_color && cue.cue_type !== 'solid' && cue.cue_type !== 'color_wheel')
      ? `background:linear-gradient(to right,${sc},${cue.end_display_color})` : `background:${sc}`;
    let label = cue.label || (cue.cue_type === 'solid' || cue.cue_type === 'color_wheel' ? '' : cue.cue_type);
    if (cue.cue_type === 'movement' && cue.mover_preset_id) {
      const mp = moverPresets.find(p => p.id === cue.mover_preset_id);
      if (mp) label = mp.name;
    }
    return `<div class="tl-cue${sel}" data-cue="${cue.id}" style="left:${left}px;width:${width}px;${bg}" ` +
      `title="${esc(cue.label || cue.cue_type)} (${(cue.start_ms/1000).toFixed(2)}s)">${esc(label)}<div class="tl-cue-resize"></div></div>`;
  }

  function renderSingleLane(fix, lane, expBtn, hasRGB) {
    return `<div class="tl-lane" data-fix="${fix.id}" data-lane="${lane}">` +
      `<div class="tl-lane-hdr">${expBtn}<div class="lane-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
      `<span class="lane-name">${esc(fix.name)}</span></div>` +
      `<div class="tl-lane-track" data-fix="${fix.id}" data-lane-key="f${fix.id}"></div></div>`;
  }

  function renderMoverLanes(fix, lane, expBtn, hasRGB) {
    // Legacy — redirect to new expanded lanes renderer
    return renderExpandedLanes(fix, lane, expBtn, hasRGB, true);
  }

  function renderExpandedLanes(fix, lane, expBtn, hasRGB, isMover) {
    // Color sub-track
    let html = `<div class="tl-lane" data-fix="${fix.id}" data-lane="${lane}" data-sub="color">` +
      `<div class="tl-lane-hdr">${expBtn}<div class="lane-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
      `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Color</span></div>` +
      `<div class="tl-lane-track" data-fix="${fix.id}" data-sub="color" data-lane-key="f${fix.id}:color"></div></div>`;
    // FX sub-track
    html += `<div class="tl-lane sub-lane fx-lane" data-fix="${fix.id}" data-lane="${lane}" data-sub="fx">` +
      `<div class="tl-lane-hdr"><div class="lane-color" style="background:var(--purple,#8e24aa)"></div>` +
      `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">FX</span></div>` +
      `<div class="tl-lane-track" data-fix="${fix.id}" data-sub="fx" data-lane-key="f${fix.id}:fx"></div></div>`;
    // Motion sub-track (movers only)
    if (isMover) {
      html += `<div class="tl-lane sub-lane mover-move" data-fix="${fix.id}" data-lane="${lane}" data-sub="movement">` +
        `<div class="tl-lane-hdr"><div class="lane-color" style="background:var(--blue)"></div>` +
        `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Move</span></div>` +
        `<div class="tl-lane-track" data-fix="${fix.id}" data-sub="movement" data-lane-key="f${fix.id}:move"></div></div>`;
    }
    return html;
  }

  function renderMultiCellLanes(fix, lane, expBtn, hasRGB) {
    let html = '';
    const hasMaster = fix.channels.some(ch => !ch.cell);
    if (hasMaster) {
      html += `<div class="tl-lane master-lane" data-fix="${fix.id}" data-lane="${lane}" data-cell="0">` +
        `<div class="tl-lane-hdr">${expBtn}<div class="lane-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
        `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Master</span></div>` +
        `<div class="tl-lane-track" data-fix="${fix.id}" data-cell="0" data-lane-key="f${fix.id}:c0"></div></div>`;
    }
    for (let cell = 1; cell <= fix.cell_count; cell++) {
      html += `<div class="tl-lane sub-lane" data-fix="${fix.id}" data-lane="${lane}" data-cell="${cell}">` +
        `<div class="tl-lane-hdr">${!hasMaster && cell === 1 ? expBtn : ''}<div class="lane-color" style="background:${fix.channels.some(ch => ch.cell === cell && ch.type === 'red') ? '#e94560' : '#888'}"></div>` +
        `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Cell ${cell}</span></div>` +
        `<div class="tl-lane-track" data-fix="${fix.id}" data-cell="${cell}" data-lane-key="f${fix.id}:c${cell}"></div></div>`;
    }
    return html;
  }

  // ── Playhead ──────────────────────────────────────────────────
  function updatePlayhead() {
    const ph = $('tlPlayhead');
    if (!currentSeq) { ph.style.display = 'none'; return; }
    ph.style.display = 'block';
    ph.style.left = ((playheadMs / 1000) * zoomPxPerSec + 140) + 'px';
    const s = playheadMs / 1000;
    $('timeDisplay').textContent = `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}.${Math.floor((s%1)*10)}`;
  }

  function seekTo(ms) {
    playheadMs = ms; updatePlayhead();
    if (currentId) {
      if (editMode && !isPlaying) {
        wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
      } else {
        wsSend({ type: 'sequence', action: 'seek', deck, timeMs: playheadMs });
      }
    }
  }

  // ── RAF Loop for playhead ─────────────────────────────────────
  function rafLoop() {
    if (_timeDirty) {
      _timeDirty = false;
      for (const d in _pendingTime) {
        if (+d === deck && currentSeq && isPlaying && !draggingPlayhead) {
          playheadMs = _pendingTime[d]; updatePlayhead();
          autoScrollPlayhead();
        }
      }
    }
    requestAnimationFrame(rafLoop);
  }

  function autoScrollPlayhead() {
    const wrap = $('tlScroll');
    if (!wrap) return;
    const phX = (playheadMs / 1000) * zoomPxPerSec + 140;
    if (phX < wrap.scrollLeft + 140 || phX > wrap.scrollLeft + wrap.clientWidth - 40) {
      wrap.scrollLeft = Math.max(0, phX - wrap.clientWidth / 2);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Waveform
  // ═══════════════════════════════════════════════════════════════
  async function loadWaveform(trackId, opts = {}) {
    try {
      const cacheBust = opts.force ? `?_=${Date.now()}` : '';
      const res = await fetch(`/api/tracks/${trackId}/analysis${cacheBust}`, { cache: 'no-store' });
      if (!res.ok) { wfAnalysis = null; wfTrackId = null; renderTimeline(); return; }
      const data = await res.json();
      wfTrackId = trackId; wfAnalysis = data;
      const peaks = data.waveform_peaks || [];
      if (peaks.length > 0) {
        const sr = data.sample_rate || 22050;
        const totalSamples = Math.round(sr * (data.duration_ms / 1000));
        const spp = Math.max(1, Math.round(totalSamples / peaks.length));
        const arr = [];
        for (const p of peaks) { const v = Math.round((p.peak || 0) * 127); arr.push(-v, v); }
        wfData = WaveformData.create({ version: 2, channels: 1, sample_rate: sr, samples_per_pixel: spp, bits: 8, length: peaks.length, data: arr });
        wfRawPeaks = peaks;
      } else { wfData = null; wfRawPeaks = null; }
      const tRes = await fetch(`/api/tracks/${trackId}`);
      wfTrackInfo = tRes.ok ? await tRes.json() : null;
      renderTimeline();
    } catch (e) { console.error('Waveform load failed', e); }
  }

  function drawWaveform() {
    const canvas = $('wfCanvas');
    if (!canvas || !wfAnalysis || !wfData || !currentSeq) return;
    const durMs = wfAnalysis.duration_ms || currentSeq.duration_ms || 1;
    const totalW = Math.round((durMs / 1000) * zoomPxPerSec);
    const H = canvas.parentElement.clientHeight || 80;

    // Canvas at 1:1 CSS pixels — waveform doesn't need HiDPI scaling
    // and putImageData bypasses canvas transforms, so keep it simple.
    canvas.width = totalW; canvas.height = H;
    canvas.style.width = totalW + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, totalW, H);

    const sections = wfAnalysis.sections || [];
    const labelH = 14, waveH = H - labelH, midY = waveH / 2;

    // Section backgrounds (subtle tint behind waveform)
    for (const sec of sections) {
      const x1 = (sec.start_ms / durMs) * totalW, x2 = (sec.end_ms / durMs) * totalW;
      ctx.fillStyle = hexRGBA(sec.color || '#555', 0.08);
      ctx.fillRect(x1, 0, x2 - x1, waveH);
    }

    const hasBands = wfRawPeaks && wfRawPeaks.length > 0 && wfRawPeaks[0].bass !== undefined;
    if (hasBands) {
      // Resample raw peaks to match pixel width (use max for crisp transients)
      const rawLen = wfRawPeaks.length;
      let dp;
      if (totalW <= rawLen) {
        const bs = rawLen / totalW; dp = new Array(totalW);
        for (let px = 0; px < totalW; px++) {
          const s = Math.floor(px * bs), e = Math.min(Math.floor((px + 1) * bs), rawLen);
          let pM = 0, bM = 0, mM = 0, tM = 0;
          for (let j = s; j < e; j++) {
            const p = wfRawPeaks[j];
            if (p.peak > pM) pM = p.peak;
            if (p.bass > bM) bM = p.bass;
            if (p.mid > mM) mM = p.mid;
            if (p.treble > tM) tM = p.treble;
          }
          dp[px] = { peak: pM, bass: bM, mid: mM, treble: tM };
        }
      } else { dp = wfRawPeaks; }
      const dl = dp.length, xs = totalW / dl;
      const hH = midY * 0.92;

      // VDJ-style layered smooth paths: bands stacked center-outward.
      // Uses lineTo paths for smooth contours instead of blocky rect bars.

      // Helper: draw a symmetric filled path for a band
      function drawBandPath(color, heightFn) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        // Top contour (left to right)
        for (let i = 0; i < dl; i++) ctx.lineTo(i * xs, midY - heightFn(i));
        ctx.lineTo(dl * xs, midY);
        // Bottom contour (right to left, mirrored)
        for (let i = dl - 1; i >= 0; i--) ctx.lineTo(i * xs, midY + heightFn(i));
        ctx.closePath();
        ctx.fill();
      }

      // Treble — outermost layer = full peak envelope
      drawBandPath('#80DEEA', i => dp[i].peak * hH);

      // Mid — middle layer = (bass + mid) proportion of peak
      drawBandPath('#2598B5', i => {
        const d = dp[i], sum = d.bass + d.mid + d.treble;
        return sum > 0.001 ? ((d.bass + d.mid) / sum) * d.peak * hH : 0;
      });

      // Bass — center core = bass proportion of peak
      drawBandPath('#1565C0', i => {
        const d = dp[i], sum = d.bass + d.mid + d.treble;
        return sum > 0.001 ? (d.bass / sum) * d.peak * hH : 0;
      });

    } else {
      // Legacy single-colour smooth path
      let minA, maxA, dl, xs;
      if (totalW <= wfData.length) {
        const r = wfData.resample({ width: totalW }), ch = r.channel(0);
        minA = ch.min_array(); maxA = ch.max_array(); dl = maxA.length; xs = 1;
      } else {
        const ch = wfData.channel(0); minA = ch.min_array(); maxA = ch.max_array(); dl = maxA.length; xs = totalW / dl;
      }
      const sc = waveH / 256;
      ctx.fillStyle = '#26C6DA';
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < dl; i++) ctx.lineTo(i * xs, midY - maxA[i] * sc);
      ctx.lineTo(dl * xs, midY);
      for (let i = dl - 1; i >= 0; i--) ctx.lineTo(i * xs, midY - minA[i] * sc);
      ctx.closePath();
      ctx.fill();
    }

    // Center line
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, midY); ctx.lineTo(totalW, midY); ctx.stroke();

    // Section labels
    for (const sec of sections) {
      const x1 = (sec.start_ms / durMs) * totalW, w = ((sec.end_ms - sec.start_ms) / durMs) * totalW;
      ctx.fillStyle = hexRGBA(sec.color || '#555', .55); ctx.fillRect(x1, waveH, w, labelH);
      if (w > 20) { ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sec.label.toUpperCase(), x1 + w / 2, waveH + labelH / 2); }
    }
  }

  function hexRGBA(hex, a) {
    const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Properties Panel
  // ═══════════════════════════════════════════════════════════════
  function updateProps() {
    if (!selectedPrimary) {
      $('propsEmpty').style.display = 'flex'; $('propsContent').style.display = 'none';
      $('selectionHint').textContent = '';
      return;
    }
    $('propsEmpty').style.display = 'none'; $('propsContent').style.display = 'block';
    const cue = cues.find(c => c.id === selectedPrimary);
    if (!cue) return;
    const t = cue.cue_type || 'solid';
    $('propType').value = t;
    $('propStart').value = (cue.start_ms / 1000).toFixed(3);
    $('propDur').value = (cue.duration_ms / 1000).toFixed(3);
    $('propLabel').value = cue.label || '';
    $('propColor').value = cue.display_color || cue.color || '#e94560';
    $('propEffect').value = cue.effect_id || '';
    $('propMoverRow').style.display = t === 'movement' ? '' : 'none';
    // Hide manual color picker when color_wheel swatches are available
    $('propColor').closest('.prop-row').style.display = t === 'color_wheel' ? 'none' : '';
    if (t === 'movement') {
      $('propMover').value = cue.mover_preset_id || '';
    }

    if (!cue.channel_values) {
      $('channelSliders').innerHTML = '<div style="color:var(--text-muted);font-size:10px;padding:6px">Loading...</div>';
      api(`/api/cues/${cue.id}`).then(full => {
        cue.channel_values = full.channel_values || {};
        cue.end_channel_values = full.end_channel_values || null;
        computeDisplay(cue); // re-derive preset fields from full channel data
        if (selectedPrimary === cue.id) {
          // Update mover dropdown now that we have real channel data
          if ((cue.cue_type || 'solid') === 'movement') {
            $('propMover').value = cue.mover_preset_id || '';
          }
          buildChannelSliders(cue);
        }
      });
    } else { buildChannelSliders(cue); }

    $('selectionHint').textContent = selectedIds.size > 1 ? `${selectedIds.size} cues selected` : '';
  }

  /**
   * Collect channel values from sliders, omitting channels that are at default 0
   * and were NOT in the original cue data. This prevents untouched control channels
   * (macro, other, function etc.) from being saved/sent as 0, which on many fixtures
   * triggers sound-active or auto-program mode.
   */
  function collectChannelValues(group, originalChVals) {
    const orig = originalChVals || {};
    const vals = {};
    $$(`#channelSliders .ch-row[data-group="${group}"]`).forEach(r => {
      const ch = r.dataset.ch;
      const v = +r.querySelector('.ch-range').value;
      // Include if: value is non-zero, OR channel was already stored in the cue
      if (v !== 0 || orig[ch] !== undefined) vals[ch] = v;
    });
    return vals;
  }

  function buildChannelSliders(cue) {
    const fix = fixtures.find(f => f.id === cue.fixture_id);
    const el = $('channelSliders');
    if (!fix) { el.innerHTML = ''; return; }
    const chVals = cue.channel_values || {};
    const t = $('propType').value;
    let channels = fix.channels;
    if (cue.cell) channels = channels.filter(ch => !ch.cell || ch.cell === cue.cell);
    const moverTypes = new Set(['pan','tilt','gobo','gobo_rotation','speed']);
    const isMover = fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
    // Movement cues using presets: hide pan/tilt (preset controls position) but keep speed/gobo
    const hasPreset = t === 'movement' && (chVals.mover_preset_id || $('propMover').value);
    if (isMover && t === 'movement' && hasPreset) channels = channels.filter(ch => ch.type !== 'pan' && ch.type !== 'tilt' && moverTypes.has(ch.type));
    else if (isMover && cue.label === 'move') channels = channels.filter(ch => moverTypes.has(ch.type));
    else if (isMover && expandedFixtures.has(fix.id) && cue.label !== 'move') channels = channels.filter(ch => !moverTypes.has(ch.type));

    const colors = { red:'#f44', green:'#4f4', blue:'#44f', white:'#fff', dimmer:'#ff0', amber:'#fa0', uv:'#a0f' };

    // ── Color Wheel swatch mode ──
    if (t === 'color_wheel' && fix.color_wheel_map && fix.color_wheel_map.length > 0) {
      const cwMap = fix.color_wheel_map.slice().sort((a, b) => a.dmx_start - b.dmx_start);
      const cwVal = chVals.color_wheel !== undefined ? chVals.color_wheel : cwMap[0].dmx_start;
      let html = `<div class="ch-section-label">Color Wheel</div><div class="cw-swatch-grid">`;
      for (const entry of cwMap) {
        const sel = (cwVal >= entry.dmx_start && cwVal <= entry.dmx_end) ? ' selected' : '';
        html += `<div class="cw-swatch${sel}" data-dmx="${entry.dmx_start}" data-hex="${entry.color_hex}" title="${entry.name || ''}">` +
          `<div class="cw-swatch-dot" style="background:${entry.color_hex}"></div>` +
          `<span class="cw-swatch-name">${entry.name || ''}</span></div>`;
      }
      html += `</div>`;
      // Hidden input so applyCueProps/autoApply can read color_wheel value
      html += `<div class="ch-row" data-ch="color_wheel" data-group="start" style="display:none">` +
        `<input type="range" class="ch-range" min="0" max="255" value="${cwVal}"></div>`;
      // Show remaining channels (dimmer, speed, gobo etc.) as normal sliders
      const otherChs = channels.filter(ch => ch.type !== 'color_wheel');
      if (otherChs.length > 0) {
        html += `<div class="ch-section-label">Channels</div>`;
        for (const ch of otherChs) {
          const v = chVals[ch.type] !== undefined ? chVals[ch.type] : 0;
          const c = colors[ch.type] || '#888';
          html += `<div class="ch-row" data-ch="${ch.type}" data-group="start"><span class="ch-label" style="color:${c}">${ch.type.substring(0,4).toUpperCase()}</span>` +
            `<input type="range" class="ch-range" min="0" max="255" value="${v}"><span class="ch-val">${v}</span></div>`;
        }
      }
      el.innerHTML = html;
      // Swatch click handler
      $$('.cw-swatch', el).forEach(sw => {
        sw.addEventListener('click', () => {
          $$('.cw-swatch', el).forEach(s => s.classList.remove('selected'));
          sw.classList.add('selected');
          const dmx = +sw.dataset.dmx;
          const hex = sw.dataset.hex;
          // Update hidden range input
          const hiddenRow = el.querySelector('.ch-row[data-ch="color_wheel"] .ch-range');
          if (hiddenRow) hiddenRow.value = dmx;
          // Update color picker to match
          if (hex) $('propColor').value = hex;
          // Live DMX preview
          if (editMode && cue.fixture_id) {
            const preview = { color_wheel: dmx };
            $$('#channelSliders .ch-row[data-group="start"]:not([style*="display:none"])').forEach(r => {
              preview[r.dataset.ch] = +r.querySelector('.ch-range').value;
            });
            wsSend({ type: 'sequence', action: 'preview_channel', deck, fixture_id: cue.fixture_id, cell: cue.cell || null, channel_values: preview });
          }
        });
      });
      // Slider event handlers for other channels
      let _sliderPreviewTimer = null;
      $$('.ch-row:not([style*="display:none"]) .ch-range', el).forEach(inp => {
        inp.addEventListener('input', () => {
          inp.nextElementSibling.textContent = inp.value;
          if (editMode && cue.fixture_id) {
            clearTimeout(_sliderPreviewTimer);
            _sliderPreviewTimer = setTimeout(() => {
              const chV = collectChannelValues('start', cue.channel_values || {});
              wsSend({ type: 'sequence', action: 'preview_channel', deck, fixture_id: cue.fixture_id, cell: cue.cell || null, channel_values: chV });
            }, 30);
          }
        });
      });
      return; // done for color_wheel mode
    }

    // ── Standard slider mode ──
    let html = `<div class="ch-section-label">${t === 'solid' ? 'Color' : 'Start Values'}</div>`;
    for (const ch of channels) {
      const v = chVals[ch.type] !== undefined ? chVals[ch.type] : 0;
      const c = colors[ch.type] || '#888';
      html += `<div class="ch-row" data-ch="${ch.type}" data-group="start"><span class="ch-label" style="color:${c}">${ch.type.substring(0,4).toUpperCase()}</span>` +
        `<input type="range" class="ch-range" min="0" max="255" value="${v}"><span class="ch-val">${v}</span></div>`;
    }

    // End values
    if (t === 'static' || t === 'chase') {
      const endV = cue.end_channel_values || {};
      html += `<div class="ch-section-label" style="display:flex;align-items:center;gap:6px">End Values <button class="ch-copy-btn" id="chCopyBtn">Start&#8594;End</button></div>`;
      for (const ch of channels) {
        const v = endV[ch.type] !== undefined ? endV[ch.type] : (chVals[ch.type] || 0);
        const c = colors[ch.type] || '#888';
        html += `<div class="ch-row" data-ch="${ch.type}" data-group="end"><span class="ch-label" style="color:${c}">${ch.type.substring(0,4).toUpperCase()}</span>` +
          `<input type="range" class="ch-range" min="0" max="255" value="${v}"><span class="ch-val">${v}</span></div>`;
      }
    }

    if (t === 'strobe') {
      const hz = chVals.strobe_hz || 10;
      html += `<div class="ch-section-label">Strobe Rate</div>` +
        `<div class="ch-row" data-ch="strobe_hz" data-group="start"><span class="ch-label">Hz</span>` +
        `<input type="range" class="ch-range" min="1" max="30" value="${hz}"><span class="ch-val">${hz}</span></div>`;
    }

    el.innerHTML = html;
    // Live value display + live DMX preview
    let _sliderPreviewTimer = null;
    $$('.ch-range', el).forEach(inp => {
      inp.addEventListener('input', () => {
        inp.nextElementSibling.textContent = inp.value;
        updateColorFromSliders();
        // Debounced live DMX preview when in edit mode
        if (editMode && cue.fixture_id) {
          clearTimeout(_sliderPreviewTimer);
          _sliderPreviewTimer = setTimeout(() => {
            const pVals = collectChannelValues('start', cue.channel_values || {});
            wsSend({ type: 'sequence', action: 'preview_channel', deck, fixture_id: cue.fixture_id, cell: cue.cell || null, channel_values: pVals });
          }, 30);
        }
      });
    });
    // Copy start→end
    const copyBtn = $('chCopyBtn');
    if (copyBtn) copyBtn.addEventListener('click', copyStartToEnd);
  }

  function updateColorFromSliders() {
    const vals = {};
    $$('#channelSliders .ch-row[data-group="start"]').forEach(r => {
      vals[r.dataset.ch] = +r.querySelector('.ch-range').value;
    });
    if (vals.red !== undefined || vals.green !== undefined || vals.blue !== undefined) {
      $('propColor').value = colorFromCh(vals);
    } else if (vals.color_wheel !== undefined && selectedPrimary) {
      const cue = cues.find(c => c.id === selectedPrimary);
      if (cue) {
        const hex = colorFromWheel(cue.fixture_id, vals.color_wheel);
        if (hex) $('propColor').value = hex;
      }
    }
  }

  function copyStartToEnd() {
    $$('#channelSliders .ch-row[data-group="start"]').forEach(r => {
      const ch = r.dataset.ch, val = r.querySelector('.ch-range').value;
      const end = document.querySelector(`#channelSliders .ch-row[data-group="end"][data-ch="${ch}"]`);
      if (end) { end.querySelector('.ch-range').value = val; end.querySelector('.ch-val').textContent = val; }
    });
  }

  // ── Apply / Delete Cue ────────────────────────────────────────
  async function applyCueProps() {
    if (!selectedPrimary) return;
    const cue = cues.find(c => c.id === selectedPrimary);
    if (!cue) return;
    const type = $('propType').value;
    const startMs = parseFloat($('propStart').value) * 1000;
    const durMs = parseFloat($('propDur').value) * 1000;
    const label = $('propLabel').value;
    const effectId = $('propEffect').value || null;
    const origCh = cue.channel_values || {};
    const chVals = collectChannelValues('start', origCh);
    // Derive display color: RGB from sliders, or color_wheel map lookup, or fallback to picker
    let color;
    if (chVals.red !== undefined || chVals.green !== undefined || chVals.blue !== undefined) {
      color = colorFromCh(chVals);
    } else if (chVals.color_wheel !== undefined && isColorWheelFixture(cue.fixture_id)) {
      color = colorFromWheel(cue.fixture_id, chVals.color_wheel) || $('propColor').value;
    } else {
      color = $('propColor').value;
    }
    let endChVals = null;
    const endRows = $$('#channelSliders .ch-row[data-group="end"]');
    if (endRows.length > 0) { endChVals = collectChannelValues('end', cue.end_channel_values || origCh); }
    if (type === 'strobe') { const hz = document.querySelector('#channelSliders .ch-row[data-ch="strobe_hz"] .ch-range'); if (hz) chVals.strobe_hz = +hz.value; }
    if (type === 'movement') {
      const pid = $('propMover').value;
      if (pid) { chVals.mover_preset_id = +pid; }
      // When a preset is selected, strip raw pan/tilt — preset controls position; keep speed/gobo
      if (pid) { delete chVals.pan; delete chVals.tilt; }
    }

    const update = { cue_type: type, start_ms: Math.round(startMs), duration_ms: Math.round(durMs), label, color, channel_values: chVals, end_channel_values: endChVals, effect_id: effectId ? +effectId : null, track: cue.track };
    await apiPut(`/api/cues/${selectedPrimary}`, update);
    Object.assign(cue, update);
    computeDisplay(cue);
    renderTimeline(); updateSelectionVisuals();
    previewRefresh(); // Live preview update
  }

  async function deleteSelectedCues() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    // Snapshot cues being deleted for undo
    const deleted = ids.map(id => cues.find(c => c.id === id)).filter(Boolean).map(c => JSON.parse(JSON.stringify(c)));
    const seqId = currentId;
    await Promise.all(ids.map(id => apiDel(`/api/cues/${id}`)));
    cues = cues.filter(c => !selectedIds.has(c.id));
    clearSelection();
    $('infoCues').textContent = cues.length;
    renderTimeline();
    if (editMode) previewRefresh();
    // Push undo for delete
    pushUndo('delete', async () => {
      for (const snap of deleted) {
        const body = { lane: snap.lane, start_ms: snap.start_ms, duration_ms: snap.duration_ms, cue_type: snap.cue_type || 'static', fixture_id: snap.fixture_id, channel_values: snap.channel_values, end_channel_values: snap.end_channel_values || null, color: snap.color, label: snap.label || '', effect_id: snap.effect_id || null, track: snap.track || 'color' };
        if (snap.cell != null) body.cell = snap.cell;
        const nc = await apiPost(`/api/sequences/${seqId}/cues`, body);
        computeDisplay(nc); cues.push(nc);
      }
      $('infoCues').textContent = cues.length; renderTimeline();
    }, async () => {
      // Re-delete the restored cues by matching start_ms+fixture_id+lane
      for (const snap of deleted) {
        const c = cues.find(q => q.start_ms === snap.start_ms && q.fixture_id === snap.fixture_id && q.lane === snap.lane);
        if (c) { await apiDel(`/api/cues/${c.id}`); cues = cues.filter(q => q.id !== c.id); }
      }
      $('infoCues').textContent = cues.length; clearSelection(); renderTimeline();
    });
  }

  // ── Selection ─────────────────────────────────────────────────
  function selectCue(id, multi = false) {
    if (multi) {
      if (selectedIds.has(id)) { selectedIds.delete(id); if (selectedPrimary === id) selectedPrimary = selectedIds.size > 0 ? [...selectedIds][0] : null; }
      else { selectedIds.add(id); selectedPrimary = id; }
    } else {
      if (selectedPrimary && selectedPrimary !== id && $('propsContent').style.display !== 'none') autoApply();
      selectedIds.clear(); selectedIds.add(id); selectedPrimary = id;
    }
    updateSelectionVisuals(); updateProps();
  }

  function clearSelection() {
    selectedIds.clear(); selectedPrimary = null;
    updateSelectionVisuals(); updateProps();
  }

  function updateSelectionVisuals() {
    $$('.tl-cue').forEach(el => el.classList.toggle('selected', selectedIds.has(+el.dataset.cue)));
  }

  function autoApply() {
    // Fire-and-forget save of current cue
    if (!selectedPrimary) return;
    const cue = cues.find(c => c.id === selectedPrimary);
    if (!cue) return;
    const type = $('propType').value;
    const origCh = cue.channel_values || {};
    const chVals = collectChannelValues('start', origCh);
    let color;
    if (chVals.red !== undefined || chVals.green !== undefined || chVals.blue !== undefined) {
      color = colorFromCh(chVals);
    } else if (chVals.color_wheel !== undefined && isColorWheelFixture(cue.fixture_id)) {
      color = colorFromWheel(cue.fixture_id, chVals.color_wheel) || $('propColor').value;
    } else {
      color = $('propColor').value;
    }
    let endChVals = null;
    const endRows = $$('#channelSliders .ch-row[data-group="end"]');
    if (endRows.length > 0) { endChVals = collectChannelValues('end', cue.end_channel_values || origCh); }
    if (type === 'strobe') { const hz = document.querySelector('#channelSliders .ch-row[data-ch="strobe_hz"] .ch-range'); if (hz) chVals.strobe_hz = +hz.value; }
    if (type === 'movement') {
      const pid = $('propMover').value;
      if (pid) { chVals.mover_preset_id = +pid; }
      if (pid) { delete chVals.pan; delete chVals.tilt; }
    }
    const update = { cue_type: type, start_ms: Math.round(parseFloat($('propStart').value)*1000), duration_ms: Math.round(parseFloat($('propDur').value)*1000), label: $('propLabel').value, color, channel_values: chVals, end_channel_values: endChVals, effect_id: $('propEffect').value ? +$('propEffect').value : null, track: cue.track };
    apiPut(`/api/cues/${selectedPrimary}`, update);
    Object.assign(cue, update);
    computeDisplay(cue);
    if (editMode) previewRefresh();
  }

  // ═══════════════════════════════════════════════════════════════
  //  Event Setup
  // ═══════════════════════════════════════════════════════════════

  function toggleEditMode() {
    editMode = !editMode;
    $('btnEditMode').classList.toggle('active', editMode);
    $('editBanner').classList.toggle('visible', editMode);
    if (editMode) {
      // Auto-enable DMX output when entering edit mode
      if (!dmxOutputOn) {
        dmxOutputOn = true; updateOutputPill();
        apiPost('/api/dmx/output', { enabled: true });
      }
      // Load current sequence for preview
      if (currentId) {
        wsSend({ type: 'sequence', action: 'preview_load', deck, sequenceId: currentId });
        // Immediately send current playhead position so we see output right away
        wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
      }
    } else {
      // Exiting edit mode: unload and blackout
      isPlaying = false; $('btnPlay').classList.remove('active');
      wsSend({ type: 'sequence', action: 'unload', deck });
    }
  }

  /** Send preview_seek at current playhead when in edit mode */
  function previewAtPlayhead() {
    if (editMode && currentId) {
      wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
    }
  }

  /** Notify server to re-read cues and re-process at current time */
  function previewRefresh() {
    if (editMode && currentId) {
      wsSend({ type: 'sequence', action: 'preview_refresh', deck, timeMs: playheadMs });
    }
  }

  function setupEvents() {
    // ── Edit Mode Toggle ──
    on('btnEditMode', 'click', toggleEditMode);

    // ── Transport ──
    on('btnPlay', 'click', () => {
      if (!currentId) return;
      if (editMode) {
        // In edit mode: play uses the preview-loaded sequence
        isPlaying = true; $('btnPlay').classList.add('active');
        wsSend({ type: 'sequence', action: 'preview_load', deck, sequenceId: currentId });
        wsSend({ type: 'sequence', action: 'play', deck });
      } else {
        isPlaying = true; playheadMs = 0; $('btnPlay').classList.add('active'); updatePlayhead();
        wsSend({ type: 'sequence', action: 'load', deck, sequenceId: currentId });
        wsSend({ type: 'sequence', action: 'play', deck });
      }
    });
    on('btnPause', 'click', () => {
      isPlaying = false; $('btnPlay').classList.remove('active');
      wsSend({ type: 'sequence', action: 'pause', deck });
      // In edit mode, immediately show the frozen frame
      if (editMode) previewAtPlayhead();
    });
    on('btnStop', 'click', () => {
      isPlaying = false; playheadMs = 0; $('btnPlay').classList.remove('active'); updatePlayhead();
      if (editMode) {
        // In edit mode: stop playback but keep preview loaded
        wsSend({ type: 'sequence', action: 'pause', deck });
        previewAtPlayhead();
      } else {
        wsSend({ type: 'sequence', action: 'unload', deck });
      }
    });

    // ── Deck ──
    on('deckSel', 'change', e => { deck = +e.target.value; });

    // ── Zoom ──
    let _zt;
    on('zoomSlider', 'input', e => {
      zoomPxPerSec = +e.target.value; $('zoomVal').textContent = zoomPxPerSec;
      clearTimeout(_zt); _zt = setTimeout(() => renderTimeline(), 150);
    });

    // ── Snap ──
    on('snapSel', 'change', e => { snapBeats = +e.target.value; });

    // ── Timeline scroll → repaint visible cues ──
    let _tlScrollRAF = 0;
    on('tlScroll', 'scroll', () => {
      cancelAnimationFrame(_tlScrollRAF);
      _tlScrollRAF = requestAnimationFrame(paintVisibleCues);
    });

    // ── Sequence list: virtual scroll + search ──
    on('seqList', 'scroll', onSeqListScroll);
    // ── Page tabs ──
    $$('.page-tab', $('pageTabs')).forEach(btn => {
      btn.addEventListener('click', () => setPage(btn.dataset.page));
    });

    $('seqList').addEventListener('click', e => {
      const item = e.target.closest('.seq-item');
      if (item) loadSequenceById(+item.dataset.id);
    });
    let _sqt;
    on('seqSearch', 'input', e => {
      _seqQuery = e.target.value.trim();
      clearTimeout(_sqt);
      _sqt = setTimeout(() => { renderSeqList(); }, _seqQuery.length > 1 ? 80 : 200);
    });

    // ── Track library ──
    on('tracksSearch', 'input', e => {
      _tracksQuery = e.target.value.trim();
      _tracksPage = 0;
      clearTimeout(_tracksSearchTimer);
      _tracksSearchTimer = setTimeout(() => loadTracks(), _tracksQuery.length > 1 ? 120 : 250);
    });
    on('tracksGenreFilter', 'change', e => {
      _tracksGenre = e.target.value;
      _tracksPage = 0;
      loadTracks();
    });
    on('tracksSourceFilter', 'change', e => {
      _tracksSource = e.target.value;
      _tracksPage = 0;
      loadTracks();
    });
    const applyBpmFilter = () => {
      _tracksBpmMin = $('tracksBpmMin').value;
      _tracksBpmMax = $('tracksBpmMax').value;
      _tracksPage = 0;
      loadTracks();
    };
    on('tracksBpmMin', 'change', applyBpmFilter);
    on('tracksBpmMax', 'change', applyBpmFilter);
    on('tracksPrev', 'click', () => { if (_tracksPage > 0) { _tracksPage--; loadTracks(); } });
    on('tracksNext', 'click', () => {
      const maxPage = Math.ceil(_tracksTotal / TRACKS_PER_PAGE) - 1;
      if (_tracksPage < maxPage) { _tracksPage++; loadTracks(); }
    });
    on('btnBulkGenerate', 'click', openBulkGenerateModal);
    on('btnImportTracks', 'click', async () => {
      const btn = $('btnImportTracks');
      btn.disabled = true;
      btn.textContent = '…';
      try {
        await apiPost('/api/tracks/import', {});
        _tracksPage = 0;
        await loadTracksStats();
        await loadTracks();
      } catch (e) {
        alert('Import failed: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '&#8635; Re-import';
      }
    });
    $('tracksBody').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      e.stopPropagation();
      handleTrackAction(btn.dataset.action, +btn.dataset.trackId, btn, btn.dataset.seqId ? +btn.dataset.seqId : null);
    });

    // ── Save Sequence ──
    on('btnSaveSeq', 'click', saveSequenceInfo);

    // ── Beat Offset Nudge ──
    on('offsetNudgeDown', 'click', () => {
      const el = $('infoOffset');
      el.value = Math.round((parseFloat(el.value) || 0) - 10);
      saveSequenceInfo();
    });
    on('offsetNudgeUp', 'click', () => {
      const el = $('infoOffset');
      el.value = Math.round((parseFloat(el.value) || 0) + 10);
      saveSequenceInfo();
    });

    // ── New / Delete Sequence ──
    on('btnNewSeq', 'click', async () => {
      const name = prompt('Sequence name:', 'New Sequence'); if (!name) return;
      const bpm = +(prompt('BPM:', '128') || 128);
      const dur = +(prompt('Duration (seconds):', '180') || 180);
      const seq = await apiPost('/api/sequences', { name, bpm, duration_ms: dur * 1000 });
      sequences.push(seq); renderSeqList(); await loadSequenceById(seq.id);
    });
    on('btnDelSeq', 'click', async () => {
      if (!currentId) return;
      if (!confirm('Delete this sequence and all its cues?')) return;
      await apiDel(`/api/sequences/${currentId}`);
      sequences = sequences.filter(s => s.id !== currentId);
      currentId = null; currentSeq = null; cues = [];
      selectedIds.clear(); selectedPrimary = null;
      renderSeqList();
      if (currentPage === 'library') loadTracks();
      renderTimeline(); updateProps();
    });

    // ── Apply / Delete Cue ──
    on('btnApplyCue', 'click', applyCueProps);
    on('btnDeleteCue', 'click', deleteSelectedCues);
    on('propType', 'change', () => {
      const tv = $('propType').value;
      $('propMoverRow').style.display = tv === 'movement' ? '' : 'none';
      // Hide the manual color picker when color_wheel swatches are shown
      $('propColor').closest('.prop-row').style.display = tv === 'color_wheel' ? 'none' : '';
      if (selectedPrimary) { const cue = cues.find(c => c.id === selectedPrimary); if (cue) buildChannelSliders(cue); }
    });
    // When mover preset dropdown changes, rebuild sliders (show/hide raw channels)
    on('propMover', 'change', () => {
      if (selectedPrimary) { const cue = cues.find(c => c.id === selectedPrimary); if (cue) buildChannelSliders(cue); }
    });

    // Color picker → RGB sliders
    on('propColor', 'input', () => {
      const hex = $('propColor').value;
      const map = { red: parseInt(hex.substring(1,3),16), green: parseInt(hex.substring(3,5),16), blue: parseInt(hex.substring(5,7),16) };
      $$('#channelSliders .ch-row[data-group="start"]').forEach(r => {
        if (map[r.dataset.ch] !== undefined) { r.querySelector('.ch-range').value = map[r.dataset.ch]; r.querySelector('.ch-val').textContent = map[r.dataset.ch]; }
      });
    });

    // ── Ruler click ──
    on('tlRuler', 'click', e => {
      const rect = $('tlRuler').getBoundingClientRect();
      seekTo(Math.max(0, ((e.clientX - rect.left) / zoomPxPerSec) * 1000));
    });

    // ── Playhead drag ──
    let _previewDragThrottle = 0;
    on('tlPlayhead', 'mousedown', e => {
      if (!currentSeq) return;
      draggingPlayhead = true; e.preventDefault(); e.stopPropagation();
      document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
    });
    document.addEventListener('mousemove', e => {
      if (!draggingPlayhead) return;
      const wrap = $('tlScroll'), rect = wrap.getBoundingClientRect();
      const x = e.clientX - rect.left + wrap.scrollLeft - 140;
      playheadMs = clamp((x / zoomPxPerSec) * 1000, 0, currentSeq?.duration_ms || Infinity);
      updatePlayhead();
      // In edit mode, send live preview while dragging (throttled to ~20Hz)
      if (editMode && currentId) {
        const now = Date.now();
        if (now - _previewDragThrottle > 50) {
          _previewDragThrottle = now;
          wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
        }
      }
    });
    document.addEventListener('mouseup', () => {
      if (!draggingPlayhead) return;
      draggingPlayhead = false; document.body.style.cursor = ''; document.body.style.userSelect = '';
      if (currentId) {
        if (editMode) {
          wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
        } else {
          wsSend({ type: 'sequence', action: 'seek', deck, timeMs: playheadMs });
        }
      }
    });

    // ── Double-click to add cue ──
    on('tlLanes', 'dblclick', async e => {
      const trackEl = e.target.closest('.tl-lane-track');
      if (!trackEl || !currentId || e.target.closest('.tl-cue')) return;
      const fixId = +trackEl.dataset.fix;
      const rect = trackEl.getBoundingClientRect();
      const clickMs = snapToGrid(((e.clientX - rect.left) / zoomPxPerSec) * 1000);
      const bpm = currentSeq.bpm || 128;
      const durMs = (60000 / bpm) * 4;
      const lane = +e.target.closest('.tl-lane').dataset.lane;
      const cellAttr = trackEl.dataset.cell;
      const cell = cellAttr !== undefined ? +cellAttr : null;
      const sub = trackEl.dataset.sub || null;
      let body;
      if (sub === 'fx-rig') {
        // Rig-wide master effect
        const defaultEffect = effects.length > 0 ? effects[0] : null;
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'effect', fixture_id: 0, channel_values: { red: 255, green: 0, blue: 0, dimmer: 255 }, color: '#8e24aa', label: defaultEffect ? `⟷ ${defaultEffect.name}` : '⟷ effect', track: 'fx-rig', effect_id: defaultEffect ? defaultEffect.id : null };
      } else if (sub === 'movement') {
        const mvChVals = moverPresets.length > 0
          ? { mover_preset_id: moverPresets[0].id }
          : { pan: 128, tilt: 128 };
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'movement', fixture_id: fixId, channel_values: mvChVals, color: '#4488ff', label: 'move', track: 'move' };
      } else if (sub === 'fx') {
        // Create an effect cue — pick the first available effect
        const defaultEffect = effects.length > 0 ? effects[0] : null;
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'effect', fixture_id: fixId, channel_values: { red: 255, green: 0, blue: 0, dimmer: 255 }, color: '#8e24aa', label: defaultEffect ? defaultEffect.name : 'effect', track: 'fx', effect_id: defaultEffect ? defaultEffect.id : null };
      } else if (isColorWheelFixture(fixId)) {
        const fix = fixtures.find(f => f.id === fixId);
        const cwMap = fix && fix.color_wheel_map ? fix.color_wheel_map.slice().sort((a,b) => a.dmx_start - b.dmx_start) : [];
        const firstEntry = cwMap[0];
        const cwDmx = firstEntry ? firstEntry.dmx_start : 0;
        const cwColor = firstEntry ? firstEntry.color_hex : '#ffffff';
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'color_wheel', fixture_id: fixId, channel_values: { color_wheel: cwDmx }, color: cwColor, label: '', track: 'color' };
      } else {
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'solid', fixture_id: fixId, channel_values: { red: 255, green: 0, blue: 0 }, color: '#ff0000', label: '', track: sub === 'color' ? 'color' : 'color' };
      }
      if (cell) body.cell = cell;
      const cue = await apiPost(`/api/sequences/${currentId}/cues`, body);
      computeDisplay(cue);
      cues.push(cue);
      $('infoCues').textContent = cues.length;
      // Push undo for create
      const cId = cue.id, seqId = currentId;
      pushUndo('create', async () => {
        await apiDel(`/api/cues/${cId}`);
        cues = cues.filter(c => c.id !== cId);
        $('infoCues').textContent = cues.length;
        clearSelection(); renderTimeline();
      }, async () => {
        const nc = await apiPost(`/api/sequences/${seqId}/cues`, body);
        computeDisplay(nc); cues.push(nc);
        $('infoCues').textContent = cues.length;
        renderTimeline(); selectCue(nc.id);
      });
      renderTimeline();
      selectCue(cue.id);
    });

    // ── Mousedown: cue click / marquee ──
    on('tlLanes', 'mousedown', e => {
      if (e.button !== 0) return;
      const cueEl = e.target.closest('.tl-cue');
      if (cueEl) {
        const id = +cueEl.dataset.cue;
        const cue = cues.find(c => c.id === id); if (!cue) return;
        if (e.ctrlKey || e.metaKey) { selectCue(id, true); }
        else if (!selectedIds.has(id)) { selectCue(id); }

        if (e.target.classList.contains('tl-cue-resize')) {
          // Multi-cue resize: capture all selected cues
          const resizeItems = [];
          for (const sid of selectedIds) {
            const sc = cues.find(c => c.id === sid);
            const sel = document.querySelector(`.tl-cue[data-cue="${sid}"]`);
            if (sc && sel) resizeItems.push({ cueId: sid, origW: parseFloat(sel.style.width), origDur: sc.duration_ms });
          }
          dragState = { type: 'resize', cueId: id, startX: e.clientX, origW: parseFloat(cueEl.style.width), origDur: cue.duration_ms, items: resizeItems };
        } else {
          const items = [];
          for (const sid of selectedIds) {
            const sc = cues.find(c => c.id === sid);
            const sel = document.querySelector(`.tl-cue[data-cue="${sid}"]`);
            if (sc && sel) items.push({ cueId: sid, origLeft: parseFloat(sel.style.left), origStart: sc.start_ms });
          }
          const track = cueEl.closest('.tl-lane-track');
          dragState = { type: 'move', cueId: id, startX: e.clientX, startY: e.clientY, items, origFix: track ? +track.dataset.fix : null, crossLane: false, moved: false };
        }
        e.preventDefault(); return;
      }

      // Marquee
      const track = e.target.closest('.tl-lane-track');
      if (!track) { if (!e.ctrlKey && !e.metaKey) clearSelection(); return; }
      if (!e.ctrlKey && !e.metaKey) clearSelection();

      const lw = $('tlLanes'), wr = lw.getBoundingClientRect(), sw = $('tlScroll');
      const sx = e.clientX - wr.left + sw.scrollLeft, sy = e.clientY - wr.top + sw.scrollTop;
      let mEl = document.getElementById('tlMarquee');
      if (!mEl) { mEl = document.createElement('div'); mEl.id = 'tlMarquee'; mEl.className = 'tl-marquee'; lw.appendChild(mEl); }
      mEl.style.display = 'block'; mEl.style.left = sx+'px'; mEl.style.top = sy+'px'; mEl.style.width = '0'; mEl.style.height = '0';
      marquee = { sx, sy, add: e.ctrlKey || e.metaKey };
      e.preventDefault();
    });

    // ── Mousemove: drag / marquee ──
    let _mqRAF = 0;
    document.addEventListener('mousemove', e => {
      if (marquee) {
        const lw = $('tlLanes'), wr = lw.getBoundingClientRect(), sw = $('tlScroll');
        const cx = e.clientX - wr.left + sw.scrollLeft, cy = e.clientY - wr.top + sw.scrollTop;
        const x = Math.min(marquee.sx, cx), y = Math.min(marquee.sy, cy);
        const w = Math.abs(cx - marquee.sx), h = Math.abs(cy - marquee.sy);
        const mEl = document.getElementById('tlMarquee');
        if (mEl) { mEl.style.left = x+'px'; mEl.style.top = y+'px'; mEl.style.width = w+'px'; mEl.style.height = h+'px'; }
        // Throttle hit-testing to animation frames to avoid layout thrash
        marquee._rect = { left: x, top: y, right: x+w, bottom: y+h };
        if (!_mqRAF) {
          _mqRAF = requestAnimationFrame(() => {
            _mqRAF = 0;
            if (!marquee || !marquee._rect) return;
            const mr = marquee._rect;
            $$('.tl-cue').forEach(cel => {
              const cid = +cel.dataset.cue;
              const lane = cel.closest('.tl-lane');
              const cr = { left: cel.offsetLeft, top: lane.offsetTop + cel.offsetTop, right: cel.offsetLeft + cel.offsetWidth, bottom: lane.offsetTop + cel.offsetTop + cel.offsetHeight };
              const hit = !(cr.right < mr.left || cr.left > mr.right || cr.bottom < mr.top || cr.top > mr.bottom);
              cel.classList.toggle('selected', hit || (marquee.add && selectedIds.has(cid)));
            });
          });
        }
        return;
      }
      if (!dragState) return;
      const dx = e.clientX - dragState.startX;
      if (dragState.type === 'resize') {
        // Resize all selected cues proportionally
        for (const it of (dragState.items || [{ cueId: dragState.cueId, origW: dragState.origW }])) {
          const el = document.querySelector(`.tl-cue[data-cue="${it.cueId}"]`);
          if (el) el.style.width = Math.max(4, it.origW + dx) + 'px';
        }
        // Show snap preview line at the primary cue's snapped end position
        const cue = cues.find(c => c.id === dragState.cueId);
        const primEl = document.querySelector(`.tl-cue[data-cue="${dragState.cueId}"]`);
        if (cue && primEl) {
          const newW = Math.max(4, dragState.origW + dx);
          const rawEndMs = cue.start_ms + (newW / zoomPxPerSec) * 1000;
          const snappedEnd = snapToGrid(rawEndMs);
          const snapX = (snappedEnd / 1000) * zoomPxPerSec;
          let snapLine = document.getElementById('resizeSnapLine');
          if (!snapLine) {
            snapLine = document.createElement('div');
            snapLine.id = 'resizeSnapLine';
            snapLine.className = 'tl-snap-line';
            $('tlCanvas').appendChild(snapLine);
          }
          snapLine.style.left = snapX.toFixed(1) + 'px';
          snapLine.style.display = 'block';
        }
      } else if (dragState.type === 'move') {
        if (Math.abs(dx) > 2 || Math.abs(e.clientY - dragState.startY) > 2) dragState.moved = true;
        for (const it of dragState.items) {
          const el = document.querySelector(`.tl-cue[data-cue="${it.cueId}"]`);
          if (el) el.style.left = Math.max(0, it.origLeft + dx) + 'px';
        }
        dragState.crossLane = Math.abs(e.clientY - dragState.startY) > 18;
        $$('.tl-lane-track').forEach(lt => lt.classList.remove('drop-target'));
        if (dragState.crossLane) {
          const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl-lane-track');
          if (tgt) tgt.classList.add('drop-target');
        }
      }
    });

    // ── Mouseup: commit ──
    document.addEventListener('mouseup', async e => {
      if (marquee) {
        const mEl = document.getElementById('tlMarquee');
        if (mEl) mEl.style.display = 'none';
        const lw = $('tlLanes'), wr = lw.getBoundingClientRect(), sw = $('tlScroll');
        const cx = e.clientX - wr.left + sw.scrollLeft, cy = e.clientY - wr.top + sw.scrollTop;
        const x = Math.min(marquee.sx, cx), y = Math.min(marquee.sy, cy);
        const w = Math.abs(cx - marquee.sx), h = Math.abs(cy - marquee.sy);
        const mr = { left: x, top: y, right: x+w, bottom: y+h };
        if (!marquee.add) selectedIds.clear();
        $$('.tl-cue').forEach(cel => {
          const cid = +cel.dataset.cue, lane = cel.closest('.tl-lane');
          const cr = { left: cel.offsetLeft, top: lane.offsetTop + cel.offsetTop, right: cel.offsetLeft + cel.offsetWidth, bottom: lane.offsetTop + cel.offsetTop + cel.offsetHeight };
          if (!(cr.right < mr.left || cr.left > mr.right || cr.bottom < mr.top || cr.top > mr.bottom)) selectedIds.add(cid);
        });
        selectedPrimary = selectedIds.size > 0 ? [...selectedIds][0] : null;
        marquee = null; updateSelectionVisuals(); updateProps(); return;
      }
      if (!dragState) return;
      $$('.tl-lane-track').forEach(lt => lt.classList.remove('drop-target'));
      // Hide snap preview line
      const snapLine = document.getElementById('resizeSnapLine');
      if (snapLine) snapLine.style.display = 'none';
      if (dragState.type === 'resize') {
        // Multi-cue resize commit
        const resizeItems = dragState.items || [{ cueId: dragState.cueId, origW: dragState.origW, origDur: dragState.origDur }];
        const resizeUndos = [];
        for (const it of resizeItems) {
          const cue = cues.find(c => c.id === it.cueId);
          const el = document.querySelector(`.tl-cue[data-cue="${it.cueId}"]`);
          if (!cue || !el) continue;
          const rawEndMs = cue.start_ms + (parseFloat(el.style.width) / zoomPxPerSec) * 1000;
          const snappedEnd = snapToGrid(rawEndMs);
          const oldDur = it.origDur;
          const newDur = Math.max(100, Math.round(snappedEnd - cue.start_ms));
          cue.duration_ms = newDur;
          resizeUndos.push({ id: it.cueId, oldDur, newDur });
          await apiPut(`/api/cues/${it.cueId}`, { duration_ms: newDur });
        }
        const frozen = [...resizeUndos];
        pushUndo('resize', async () => {
          for (const r of frozen) { const c = cues.find(q => q.id === r.id); if (c) { c.duration_ms = r.oldDur; await apiPut(`/api/cues/${r.id}`, { duration_ms: r.oldDur }); } }
          renderTimeline(); updateSelectionVisuals();
        }, async () => {
          for (const r of frozen) { const c = cues.find(q => q.id === r.id); if (c) { c.duration_ms = r.newDur; await apiPut(`/api/cues/${r.id}`, { duration_ms: r.newDur }); } }
          renderTimeline(); updateSelectionVisuals();
        });
      } else if (dragState.type === 'move' && dragState.moved) {
        let newFix = null;
        if (dragState.crossLane) {
          const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl-lane-track');
          if (tgt) newFix = +tgt.dataset.fix || null;
        }
        const moveUndos = []; // capture before/after for undo
        const ups = [];
        for (const it of dragState.items) {
          const cue = cues.find(c => c.id === it.cueId);
          const el = document.querySelector(`.tl-cue[data-cue="${it.cueId}"]`);
          if (!cue || !el) continue;
          const oldStart = it.origStart, oldFix = it.cueId === dragState.cueId ? dragState.origFix : cue.fixture_id;
          cue.start_ms = Math.max(0, Math.round(snapToGrid((parseFloat(el.style.left) / zoomPxPerSec) * 1000)));
          const body = { start_ms: cue.start_ms };
          if (newFix && newFix !== cue.fixture_id) { cue.fixture_id = newFix; body.fixture_id = newFix; activeLanes.add(newFix); }
          moveUndos.push({ id: it.cueId, oldStart, oldFix, newStart: cue.start_ms, newFix: cue.fixture_id });
          ups.push(apiPut(`/api/cues/${it.cueId}`, body));
        }
        await Promise.all(ups);
        // Push undo entry for move
        const frozen = [...moveUndos];
        pushUndo('move', async () => {
          for (const m of frozen) {
            const c = cues.find(q => q.id === m.id); if (!c) continue;
            c.start_ms = m.oldStart; c.fixture_id = m.oldFix;
            await apiPut(`/api/cues/${m.id}`, { start_ms: m.oldStart, fixture_id: m.oldFix });
          }
          renderTimeline(); updateSelectionVisuals();
        }, async () => {
          for (const m of frozen) {
            const c = cues.find(q => q.id === m.id); if (!c) continue;
            c.start_ms = m.newStart; c.fixture_id = m.newFix;
            await apiPut(`/api/cues/${m.id}`, { start_ms: m.newStart, fixture_id: m.newFix });
          }
          renderTimeline(); updateSelectionVisuals();
        });
      }
      dragState = null; renderTimeline(); updateSelectionVisuals();
    });

    // ── Keyboard Shortcuts ──
    document.addEventListener('keydown', async e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      // Ctrl+Z — Undo
      if (ctrl && key === 'z' && !e.shiftKey) { e.preventDefault(); await undo(); return; }
      // Ctrl+Y or Ctrl+Shift+Z — Redo
      if ((ctrl && key === 'y') || (ctrl && key === 'z' && e.shiftKey)) { e.preventDefault(); await redo(); return; }

      // Ctrl+A — Select all
      if (ctrl && key === 'a') {
        if (!currentId) return; e.preventDefault();
        selectedIds.clear(); cues.forEach(c => selectedIds.add(c.id));
        selectedPrimary = cues.length > 0 ? cues[0].id : null;
        updateSelectionVisuals(); updateProps(); return;
      }
      // Delete / Backspace — Delete selected
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return; e.preventDefault(); await deleteSelectedCues(); return;
      }
      // Ctrl+C — Copy
      if (ctrl && key === 'c') {
        if (selectedIds.size === 0) return; e.preventDefault();
        clipboard = [...selectedIds].map(id => { const c = cues.find(q => q.id === id); return c ? JSON.parse(JSON.stringify(c)) : null; }).filter(Boolean);
        return;
      }
      // Ctrl+V — Paste (with undo)
      // Ctrl+Shift+V — Paste onto target fixture (cross-fixture paste)
      if (ctrl && key === 'v') {
        if (!clipboard || !clipboard.length || !currentId) return; e.preventDefault();
        const minStart = Math.min(...clipboard.map(c => c.start_ms));
        const offset = Math.round(playheadMs) - minStart;
        // If Shift is held, remap all pasted cues to the first active lane fixture
        // that's visible, or use the hovered lane
        let targetFix = null;
        if (e.shiftKey) {
          const hovered = document.querySelector('.tl-lane-track:hover');
          if (hovered && hovered.dataset.fix) {
            targetFix = +hovered.dataset.fix;
          } else if (activeLanes.size > 0) {
            targetFix = [...activeLanes][0];
          }
        }
        const newIds = [];
        for (const clip of clipboard) {
          const body = { lane: clip.lane, start_ms: Math.max(0, clip.start_ms + offset), duration_ms: clip.duration_ms, cue_type: clip.cue_type || 'static', fixture_id: targetFix || clip.fixture_id, channel_values: clip.channel_values, end_channel_values: clip.end_channel_values || null, color: clip.color, label: clip.label || '', effect_id: clip.effect_id || null, track: clip.track || 'color' };
          if (!targetFix && clip.cell) body.cell = clip.cell; // clear cell when retargeting fixture
          const nc = await apiPost(`/api/sequences/${currentId}/cues`, body);
          computeDisplay(nc); cues.push(nc); newIds.push(nc.id);
          if (targetFix) activeLanes.add(targetFix);
        }
        $('infoCues').textContent = cues.length;
        selectedIds.clear(); newIds.forEach(id => selectedIds.add(id));
        selectedPrimary = newIds[0] || null;
        // Push undo for paste
        const pastedIds = [...newIds];
        const frozenClip = JSON.parse(JSON.stringify(clipboard));
        pushUndo('paste', async () => {
          await Promise.all(pastedIds.map(id => apiDel(`/api/cues/${id}`)));
          cues = cues.filter(c => !pastedIds.includes(c.id));
          $('infoCues').textContent = cues.length; clearSelection(); renderTimeline();
        }, async () => {
          for (const clip of frozenClip) {
            const body = { lane: clip.lane, start_ms: Math.max(0, clip.start_ms + offset), duration_ms: clip.duration_ms, cue_type: clip.cue_type || 'static', fixture_id: targetFix || clip.fixture_id, channel_values: clip.channel_values, end_channel_values: clip.end_channel_values || null, color: clip.color, label: clip.label || '', effect_id: clip.effect_id || null, track: clip.track || 'color' };
            if (!targetFix && clip.cell) body.cell = clip.cell;
            const nc = await apiPost(`/api/sequences/${currentId}/cues`, body);
            computeDisplay(nc); cues.push(nc);
          }
          $('infoCues').textContent = cues.length; renderTimeline();
        });
        renderTimeline(); updateSelectionVisuals(); updateProps(); return;
      }
      // Ctrl+D — Duplicate selected at playhead
      if (ctrl && key === 'd') {
        if (selectedIds.size === 0 || !currentId) return; e.preventDefault();
        const srcCues = [...selectedIds].map(id => cues.find(q => q.id === id)).filter(Boolean).map(c => JSON.parse(JSON.stringify(c)));
        if (!srcCues.length) return;
        const minStart = Math.min(...srcCues.map(c => c.start_ms));
        const offset = Math.round(playheadMs) - minStart;
        const newIds = [];
        for (const clip of srcCues) {
          const body = { lane: clip.lane, start_ms: Math.max(0, clip.start_ms + offset), duration_ms: clip.duration_ms, cue_type: clip.cue_type || 'static', fixture_id: clip.fixture_id, channel_values: clip.channel_values, end_channel_values: clip.end_channel_values || null, color: clip.color, label: clip.label || '', effect_id: clip.effect_id || null, track: clip.track || 'color' };
          if (clip.cell != null) body.cell = clip.cell;
          const nc = await apiPost(`/api/sequences/${currentId}/cues`, body);
          computeDisplay(nc); cues.push(nc); newIds.push(nc.id);
        }
        $('infoCues').textContent = cues.length;
        const dupIds = [...newIds];
        pushUndo('duplicate', async () => {
          await Promise.all(dupIds.map(id => apiDel(`/api/cues/${id}`)));
          cues = cues.filter(c => !dupIds.includes(c.id));
          $('infoCues').textContent = cues.length; clearSelection(); renderTimeline();
        }, async () => {
          for (const clip of srcCues) {
            const body = { lane: clip.lane, start_ms: Math.max(0, clip.start_ms + offset), duration_ms: clip.duration_ms, cue_type: clip.cue_type || 'static', fixture_id: clip.fixture_id, channel_values: clip.channel_values, end_channel_values: clip.end_channel_values || null, color: clip.color, label: clip.label || '', effect_id: clip.effect_id || null, track: clip.track || 'color' };
            if (clip.cell != null) body.cell = clip.cell;
            const nc = await apiPost(`/api/sequences/${currentId}/cues`, body);
            computeDisplay(nc); cues.push(nc);
          }
          $('infoCues').textContent = cues.length; renderTimeline();
        });
        selectedIds.clear(); newIds.forEach(id => selectedIds.add(id));
        selectedPrimary = newIds[0] || null;
        renderTimeline(); updateSelectionVisuals(); updateProps(); return;
      }
      // Escape — Clear selection
      if (e.key === 'Escape') { clearSelection(); return; }
      // Arrow nudge (with undo)
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedIds.size === 0) return; e.preventDefault();
        let nudge = (snapBeats && currentSeq?.bpm) ? (60000 / currentSeq.bpm) * snapBeats : 10;
        if (e.shiftKey) nudge = Math.max(10, nudge / 4);
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const befores = [];
        const ups = [];
        for (const sid of selectedIds) {
          const cue = cues.find(c => c.id === sid); if (!cue) continue;
          befores.push({ id: sid, old: cue.start_ms });
          cue.start_ms = Math.max(0, Math.round(cue.start_ms + dir * nudge));
          ups.push(apiPut(`/api/cues/${cue.id}`, { start_ms: cue.start_ms }));
        }
        await Promise.all(ups);
        const afters = befores.map(b => { const c = cues.find(q => q.id === b.id); return { id: b.id, old: b.old, cur: c ? c.start_ms : b.old }; });
        pushUndo('nudge', async () => {
          for (const a of afters) { const c = cues.find(q => q.id === a.id); if (c) { c.start_ms = a.old; await apiPut(`/api/cues/${a.id}`, { start_ms: a.old }); } }
          renderTimeline(); updateSelectionVisuals();
        }, async () => {
          for (const a of afters) { const c = cues.find(q => q.id === a.id); if (c) { c.start_ms = a.cur; await apiPut(`/api/cues/${a.id}`, { start_ms: a.cur }); } }
          renderTimeline(); updateSelectionVisuals();
        });
        renderTimeline(); updateSelectionVisuals(); return;
      }
      // Space — Play/Pause
      if (e.key === ' ') {
        e.preventDefault();
        if (!currentId) return;
        if (isPlaying) { $('btnPause').click(); } else { $('btnPlay').click(); }
        return;
      }
      // E — Toggle edit mode
      if (key === 'e' && !ctrl) {
        e.preventDefault(); toggleEditMode(); return;
      }
      // Home — Jump to start
      if (e.key === 'Home') {
        e.preventDefault(); playheadMs = 0; updatePlayhead();
        if (editMode && currentId) wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: 0 });
        return;
      }
      // End — Jump to end
      if (e.key === 'End') {
        e.preventDefault();
        playheadMs = currentSeq?.duration_ms || 0; updatePlayhead();
        if (editMode && currentId) wsSend({ type: 'sequence', action: 'preview_seek', deck, timeMs: playheadMs });
        return;
      }
      // + / = — Zoom in
      if (key === '+' || key === '=' && !ctrl) {
        e.preventDefault();
        const slider = $('zoomSlider');
        slider.value = Math.min(200, +slider.value + 10);
        slider.dispatchEvent(new Event('input'));
        return;
      }
      // - — Zoom out
      if (key === '-' && !ctrl) {
        e.preventDefault();
        const slider = $('zoomSlider');
        slider.value = Math.max(5, +slider.value - 10);
        slider.dispatchEvent(new Event('input'));
        return;
      }
    });

    // ── Keyboard shortcut help popup ──
    on('btnKbHelp', 'click', () => {
      const popup = $('kbPopup');
      popup.style.display = popup.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', e => {
      const popup = $('kbPopup');
      if (popup.style.display !== 'none' && !popup.contains(e.target) && e.target.id !== 'btnKbHelp') {
        popup.style.display = 'none';
      }
    });

    // ── Output / Blackout ──
    on('outputPill', 'click', async () => {
      dmxOutputOn = !dmxOutputOn; updateOutputPill();
      await apiPost('/api/dmx/output', { enabled: dmxOutputOn });
    });
    on('btnBlackout', 'click', async () => {
      await apiPost('/api/artnet/blackout', {});
      await apiPost('/api/dmx/output', { enabled: false });
      dmxOutputOn = false; updateOutputPill();
    });

    // ── Modal ──
    on('genCancel', 'click', closeModal);
    $('genModal').addEventListener('click', e => { if (e.target === $('genModal')) closeModal(); });
  }

  function updateOutputPill() {
    $('outputPill').classList.toggle('on', dmxOutputOn);
  }

  // ── Modal ─────────────────────────────────────────────────────
  function closeModal() { $('genModal').classList.remove('open'); }

  // ── Templates ─────────────────────────────────────────────────
  let _seqTemplates = [];
  async function loadTemplates() {
    try { _seqTemplates = await apiGet('/api/sequence-templates'); } catch(e) { _seqTemplates = []; }
    const sel = $('genTemplate');
    if (!sel) return;
    sel.innerHTML = '<option value="">(None — manual settings)</option>';
    for (const t of _seqTemplates) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name + (t.is_default ? ' (default)' : '');
      sel.appendChild(opt);
    }
    const dflt = _seqTemplates.find(t => t.is_default);
    if (dflt) sel.value = dflt.id;
  }
  if ($('genTemplate')) {
    $('genTemplate').addEventListener('change', () => {
      const tpl = _seqTemplates.find(t => t.id === +$('genTemplate').value);
      if (tpl) {
        const palSel = $('genPalette'); if (palSel) palSel.value = tpl.palette || 'random';
        const genSel = $('genGenre'); if (genSel) genSel.value = tpl.genre || 'auto';
      }
    });
    loadTemplates();
  }

  // ═══════════════════════════════════════════════════════════════
  //  Init
  // ═══════════════════════════════════════════════════════════════

  function init() {
    setupEvents();
    connect();
    loadAll();
    requestAnimationFrame(rafLoop);

    // Fetch initial DMX output state
    api('/api/dmx/output').then(r => { dmxOutputOn = r.enabled; updateOutputPill(); }).catch(() => {});

    // URL params: ?seq=ID&deck=N
    const params = new URLSearchParams(window.location.search);
    const seqParam = params.get('seq');
    const deckParam = params.get('deck');
    if (deckParam) { deck = +deckParam; $('deckSel').value = deckParam; }
    const pageParam = params.get('page');
    if (pageParam === 'library') setPage('library');
    if (seqParam) setTimeout(async () => {
      await loadSequenceById(+seqParam);
      setPage('editor');
    }, 500);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public API for inline handlers
  return { closeModal };
})();
