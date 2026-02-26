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

  // WebSocket
  let ws = null;
  const _pendingTime = {};
  let _timeDirty = false;

  // ── Helpers ───────────────────────────────────────────────────
  function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function formatDur(s) { if (!s || s <= 0) return '--:--'; return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function colorFromCh(ch) {
    const r = ch.red !== undefined ? ch.red : 0;
    const g = ch.green !== undefined ? ch.green : 0;
    const b = ch.blue !== undefined ? ch.blue : 0;
    return '#' + [r,g,b].map(v => clamp(v,0,255).toString(16).padStart(2,'0')).join('');
  }

  /** Look up display colour from a color_wheel DMX value using the fixture's color_wheel_map.
   *  Returns the hex of the nearest entry whose dmx_value <= val, or null if no map. */
  function colorFromWheel(fixtureId, dmxVal) {
    const fix = fixtures.find(f => f.id === fixtureId);
    if (!fix || !fix.color_wheel_map || fix.color_wheel_map.length === 0) return null;
    const map = fix.color_wheel_map.slice().sort((a, b) => a.dmx_value - b.dmx_value);
    let best = map[0];
    for (const entry of map) {
      if (entry.dmx_value <= dmxVal) best = entry;
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
    const snapMs = (60000 / currentSeq.bpm) * snapBeats;
    return Math.round(ms / snapMs) * snapMs;
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
  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => {
      $('connDot').classList.add('on');
      $('connText').textContent = 'Connected';
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
    };
    ws.onclose = () => {
      $('connDot').classList.remove('on');
      $('connText').textContent = 'Offline';
      setTimeout(connect, 2000);
    };
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
      $('genConfirm').onclick = () => { closeModal(); loadAll(); };
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

  async function loadSequenceById(id) {
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
    if (seq.track_id) loadWaveform(seq.track_id);
    if (editMode && currentId) {
      wsSend({ type: 'sequence', action: 'preview_load', deck, sequenceId: currentId });
      previewAtPlayhead();
    }
  }

  // ── Sequence List (virtual-scroll) ────────────────────────────
  const SEQ_ROW_H = 30;           // fixed row height in px
  const SEQ_BUFFER = 10;          // extra rows above/below viewport
  let _seqFiltered = [];          // filtered view of sequences
  let _seqQuery = '';             // current search string
  let _seqScrollRAF = 0;

  function filterSequences() {
    if (!_seqQuery) { _seqFiltered = sequences; }
    else {
      const q = _seqQuery.toLowerCase();
      _seqFiltered = sequences.filter(s => s.name && s.name.toLowerCase().includes(q));
    }
  }

  function renderSeqList() {
    filterSequences();
    const list = $('seqList');
    const vp = $('seqViewport');
    const status = $('seqStatus');
    if (!sequences.length) {
      vp.style.height = '0'; vp.innerHTML = '';
      list.scrollTop = 0;
      status.textContent = 'No sequences';
      return;
    }
    // Set virtual height so scrollbar reflects full list
    vp.style.height = (_seqFiltered.length * SEQ_ROW_H) + 'px';
    status.textContent = _seqQuery
      ? `${_seqFiltered.length} of ${sequences.length.toLocaleString()}`
      : `${sequences.length.toLocaleString()} sequences`;
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
    $('infoBpm').textContent = currentSeq?.bpm ? currentSeq.bpm.toFixed(1) : '--';
    $('infoDur').textContent = currentSeq ? formatDur(currentSeq.duration_ms / 1000) : '--';
    $('infoCues').textContent = cues.length;
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
      '<option value="__all__">All Presets</option>' +
      moverPresets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  }

  // ── Compute Display Fields ────────────────────────────────────
  function computeDisplay(cue) {
    const ch = cue.channel_values || {};
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
    cue.mover_preset_ids = Array.isArray(ch.mover_preset_ids) ? ch.mover_preset_ids : null;
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

    // Grid spacing via CSS custom properties (replaces DOM grid-line elements)
    const beatPx = (beatMs / 1000) * zoomPxPerSec;
    const barPx = beatPx * 4;
    canvas.style.setProperty('--beat-px', beatPx + 'px');
    canvas.style.setProperty('--bar-px', barPx + 'px');

    // Ruler
    let rHtml = '', mt = 0, bc = 0;
    while (mt < durMs) {
      const x = (mt / 1000) * zoomPxPerSec;
      const isBar = bc % 4 === 0;
      const barNum = Math.floor(bc / 4) + 1;
      if (isBar || zoomPxPerSec >= 30) {
        const label = isBar ? barNum : barNum + '.' + ((bc % 4) + 1);
        rHtml += `<div class="tl-ruler-mark${isBar ? ' bar' : ''}" style="left:${x}px"><span class="rm-label">${label}</span></div>`;
      }
      bc++; mt += beatMs;
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

    // Fixture lanes
    for (let i = 0; i < laneFixes.length; i++) {
      const fix = laneFixes[i];
      const isMulti = fix.cell_count > 0;
      const isMover = !isMulti && fix.channels.some(c => c.type === 'pan') && fix.channels.some(c => c.type === 'tilt');
      const isExp = (isMulti || isMover) && expandedFixtures.has(fix.id);
      const hasRGB = fix.channels.some(c => c.type === 'red');
      const expBtn = (isMulti || isMover)
        ? `<span class="lane-expand" data-fix="${fix.id}">${isExp ? '&#9660;' : '&#9654;'}</span>` : '';

      if (!isExp) {
        html += renderSingleLane(fix, i, expBtn, hasRGB);
      } else if (isMover) {
        html += renderMoverLanes(fix, i, expBtn, hasRGB);
      } else {
        html += renderMultiCellLanes(fix, i, expBtn, hasRGB);
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

    // Index cues and paint only what's visible (viewport virtualization)
    buildCueIndex(laneFixes);

    // Waveform canvas
    if (wfAnalysis && wfData) requestAnimationFrame(() => drawWaveform());

    paintVisibleCues();
    updatePlayhead();
  }

  function buildLaneList() {
    const list = [];
    const laneMap = new Map();
    for (const c of cues) { if (c.fixture_id && !laneMap.has(c.fixture_id)) laneMap.set(c.fixture_id, c.lane); }
    const sorted = [...laneMap.entries()].sort((a, b) => a[1] - b[1]);
    for (const [fid] of sorted) { const f = fixtures.find(x => x.id === fid); if (f) list.push(f); }
    for (const fid of activeLanes) { if (!list.some(f => f.id === fid)) { const f = fixtures.find(x => x.id === fid); if (f) list.push(f); } }
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
      const isExp = (isMulti || isMover) && expandedFixtures.has(fix.id);
      fixMeta.set(fix.id, { isMulti, isMover, isExp });
    }
    for (const cue of cues) {
      if (cue.duration_ms > _maxCueDurMs) _maxCueDurMs = cue.duration_ms;
      const meta = fixMeta.get(cue.fixture_id);
      let key;
      if (!meta || !meta.isExp) {
        key = `f${cue.fixture_id}`;
      } else if (meta.isMover) {
        key = cue.label === 'move' ? `f${cue.fixture_id}:move` : `f${cue.fixture_id}:light`;
      } else {
        key = `f${cue.fixture_id}:c${cue.cell || 0}`;
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
    const bg = (cue.end_display_color && cue.cue_type !== 'solid')
      ? `background:linear-gradient(to right,${sc},${cue.end_display_color})` : `background:${sc}`;
    let label = cue.label || (cue.cue_type === 'solid' ? '' : cue.cue_type);
    if (cue.cue_type === 'movement') {
      if (cue.mover_preset_ids && cue.mover_preset_ids.length > 0) {
        label = 'All Presets';
      } else if (cue.mover_preset_id) {
        const mp = moverPresets.find(p => p.id === cue.mover_preset_id);
        if (mp) label = mp.name;
      }
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
    return `<div class="tl-lane" data-fix="${fix.id}" data-lane="${lane}" data-sub="light">` +
      `<div class="tl-lane-hdr">${expBtn}<div class="lane-color" style="background:${hasRGB ? '#e94560' : '#888'}"></div>` +
      `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Light</span></div>` +
      `<div class="tl-lane-track" data-fix="${fix.id}" data-sub="light" data-lane-key="f${fix.id}:light"></div></div>` +
      `<div class="tl-lane sub-lane mover-move" data-fix="${fix.id}" data-lane="${lane}" data-sub="movement">` +
      `<div class="tl-lane-hdr"><div class="lane-color" style="background:var(--blue)"></div>` +
      `<span class="lane-name">${esc(fix.name)}</span><span class="lane-tag">Move</span></div>` +
      `<div class="tl-lane-track" data-fix="${fix.id}" data-sub="movement" data-lane-key="f${fix.id}:move"></div></div>`;
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
  async function loadWaveform(trackId) {
    try {
      const res = await fetch(`/api/tracks/${trackId}/analysis`);
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
    canvas.width = totalW; canvas.height = H;
    canvas.style.width = totalW + 'px'; canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, totalW, H);
    const sections = wfAnalysis.sections || [];
    const labelH = 14, waveH = H - labelH, midY = waveH / 2;

    // Section backgrounds
    for (const sec of sections) {
      const x1 = (sec.start_ms / durMs) * totalW, x2 = (sec.end_ms / durMs) * totalW;
      ctx.fillStyle = hexRGBA(sec.color || '#555', 0.1);
      ctx.fillRect(x1, 0, x2 - x1, waveH);
    }

    const hasBands = wfRawPeaks && wfRawPeaks.length > 0 && wfRawPeaks[0].bass !== undefined;
    if (hasBands) {
      const rawLen = wfRawPeaks.length;
      let dp, xs;
      if (totalW <= rawLen) {
        const bs = rawLen / totalW; dp = [];
        for (let px = 0; px < totalW; px++) {
          const s = Math.floor(px * bs), e = Math.min(Math.floor((px+1)*bs), rawLen);
          let pM=0,bM=0,mM=0,tM=0,rS=0,cnt=0;
          for (let j=s;j<e;j++){const p=wfRawPeaks[j];if(p.peak>pM)pM=p.peak;if(p.bass>bM)bM=p.bass;if(p.mid>mM)mM=p.mid;if(p.treble>tM)tM=p.treble;rS+=p.rms;cnt++;}
          dp.push({peak:pM,bass:bM,mid:mM,treble:tM,rms:cnt?rS/cnt:0});
        }
        xs = 1;
      } else { dp = wfRawPeaks; xs = totalW / rawLen; }
      const dl = dp.length, hH = midY;
      const bands = [['rgba(40,120,255,.55)','bass'],['rgba(0,200,100,.50)','mid'],['rgba(233,69,96,.50)','treble']];
      for (const [col,key] of bands) {
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(0, midY);
        for (let i=0;i<dl;i++) ctx.lineTo(i*xs, midY - dp[i][key]*hH);
        for (let i=dl-1;i>=0;i--) ctx.lineTo(i*xs, midY + dp[i][key]*hH);
        ctx.closePath(); ctx.fill();
      }
    } else {
      // Legacy single-colour
      let minA, maxA, dl, xs;
      if (totalW <= wfData.length) {
        const r = wfData.resample({width:totalW}), ch = r.channel(0);
        minA=ch.min_array(); maxA=ch.max_array(); dl=maxA.length; xs=1;
      } else {
        const ch=wfData.channel(0); minA=ch.min_array(); maxA=ch.max_array(); dl=maxA.length; xs=totalW/dl;
      }
      const sc = waveH / 256;
      ctx.fillStyle = 'rgba(233,69,96,.55)'; ctx.beginPath(); ctx.moveTo(0, midY);
      for (let i=0;i<dl;i++) ctx.lineTo(i*xs, midY-maxA[i]*sc);
      for (let i=dl-1;i>=0;i--) ctx.lineTo(i*xs, midY-minA[i]*sc);
      ctx.closePath(); ctx.fill();
    }
    // Center line
    ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(0,midY); ctx.lineTo(totalW,midY); ctx.stroke();
    // Section labels
    for (const sec of sections) {
      const x1=(sec.start_ms/durMs)*totalW, w=((sec.end_ms-sec.start_ms)/durMs)*totalW;
      ctx.fillStyle=hexRGBA(sec.color||'#555',.55); ctx.fillRect(x1,waveH,w,labelH);
      if(w>20){ctx.fillStyle='#fff';ctx.font='bold 8px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(sec.label.toUpperCase(),x1+w/2,waveH+labelH/2);}
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
    if (t === 'movement') {
      if (cue.mover_preset_ids && cue.mover_preset_ids.length > 0) {
        $('propMover').value = '__all__';
      } else {
        $('propMover').value = cue.mover_preset_id || '';
      }
    }

    if (!cue.channel_values) {
      $('channelSliders').innerHTML = '<div style="color:var(--text-muted);font-size:10px;padding:6px">Loading...</div>';
      api(`/api/cues/${cue.id}`).then(full => {
        cue.channel_values = full.channel_values || {};
        cue.end_channel_values = full.end_channel_values || null;
        if (selectedPrimary === cue.id) buildChannelSliders(cue);
      });
    } else { buildChannelSliders(cue); }

    $('selectionHint').textContent = selectedIds.size > 1 ? `${selectedIds.size} cues selected` : '';
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
    if (isMover && cue.label === 'move') channels = channels.filter(ch => moverTypes.has(ch.type));
    else if (isMover && expandedFixtures.has(fix.id) && cue.label !== 'move') channels = channels.filter(ch => !moverTypes.has(ch.type));

    const colors = { red:'#f44', green:'#4f4', blue:'#44f', white:'#fff', dimmer:'#ff0', amber:'#fa0', uv:'#a0f' };
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
    // Live value display
    $$('.ch-range', el).forEach(inp => {
      inp.addEventListener('input', () => {
        inp.nextElementSibling.textContent = inp.value;
        updateColorFromSliders();
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
    const chVals = {};
    $$('#channelSliders .ch-row[data-group="start"]').forEach(r => { chVals[r.dataset.ch] = +r.querySelector('.ch-range').value; });
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
    if (endRows.length > 0) { endChVals = {}; endRows.forEach(r => { endChVals[r.dataset.ch] = +r.querySelector('.ch-range').value; }); }
    if (type === 'strobe') { const hz = document.querySelector('#channelSliders .ch-row[data-ch="strobe_hz"] .ch-range'); if (hz) chVals.strobe_hz = +hz.value; }
    if (type === 'movement') {
      const pid = $('propMover').value;
      if (pid === '__all__') {
        chVals.mover_preset_ids = moverPresets.map(p => p.id);
      } else if (pid) {
        chVals.mover_preset_id = +pid;
      }
    }

    const update = { cue_type: type, start_ms: Math.round(startMs), duration_ms: Math.round(durMs), label, color, channel_values: chVals, end_channel_values: endChVals, effect_id: effectId ? +effectId : null };
    await apiPut(`/api/cues/${selectedPrimary}`, update);
    Object.assign(cue, update);
    computeDisplay(cue);
    renderTimeline(); updateSelectionVisuals();
    previewRefresh(); // Live preview update
  }

  async function deleteSelectedCues() {
    if (selectedIds.size === 0) return;
    const ids = [...selectedIds];
    await Promise.all(ids.map(id => apiDel(`/api/cues/${id}`)));
    cues = cues.filter(c => !selectedIds.has(c.id));
    clearSelection();
    $('infoCues').textContent = cues.length;
    renderTimeline();
    if (editMode) previewRefresh();
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
    const chVals = {};
    $$('#channelSliders .ch-row[data-group="start"]').forEach(r => { chVals[r.dataset.ch] = +r.querySelector('.ch-range').value; });
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
    if (endRows.length > 0) { endChVals = {}; endRows.forEach(r => { endChVals[r.dataset.ch] = +r.querySelector('.ch-range').value; }); }
    if (type === 'strobe') { const hz = document.querySelector('#channelSliders .ch-row[data-ch="strobe_hz"] .ch-range'); if (hz) chVals.strobe_hz = +hz.value; }
    const update = { cue_type: type, start_ms: Math.round(parseFloat($('propStart').value)*1000), duration_ms: Math.round(parseFloat($('propDur').value)*1000), label: $('propLabel').value, color, channel_values: chVals, end_channel_values: endChVals, effect_id: $('propEffect').value ? +$('propEffect').value : null };
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
      renderSeqList(); renderTimeline(); updateProps();
    });

    // ── Apply / Delete Cue ──
    on('btnApplyCue', 'click', applyCueProps);
    on('btnDeleteCue', 'click', deleteSelectedCues);
    on('propType', 'change', () => {
      $('propMoverRow').style.display = $('propType').value === 'movement' ? '' : 'none';
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
      const track = e.target.closest('.tl-lane-track');
      if (!track || !currentId || e.target.closest('.tl-cue')) return;
      const fixId = +track.dataset.fix;
      const rect = track.getBoundingClientRect();
      const clickMs = snapToGrid(((e.clientX - rect.left) / zoomPxPerSec) * 1000);
      const bpm = currentSeq.bpm || 128;
      const durMs = (60000 / bpm) * 4;
      const lane = +e.target.closest('.tl-lane').dataset.lane;
      const cellAttr = track.dataset.cell;
      const cell = cellAttr !== undefined ? +cellAttr : null;
      const sub = track.dataset.sub || null;
      let body;
      if (sub === 'movement') {
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'fade', fixture_id: fixId, channel_values: { pan: 128, tilt: 128 }, end_channel_values: { pan: 128, tilt: 128 }, color: '#4488ff', label: 'move' };
      } else {
        body = { lane, start_ms: Math.round(clickMs), duration_ms: Math.round(durMs), cue_type: 'solid', fixture_id: fixId, channel_values: { red: 255, green: 0, blue: 0 }, color: '#ff0000', label: '' };
      }
      if (cell) body.cell = cell;
      const cue = await apiPost(`/api/sequences/${currentId}/cues`, body);
      computeDisplay(cue);
      cues.push(cue);
      $('infoCues').textContent = cues.length;
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
          dragState = { type: 'resize', cueId: id, startX: e.clientX, origW: parseFloat(cueEl.style.width), origDur: cue.duration_ms };
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
        const el = document.querySelector(`.tl-cue[data-cue="${dragState.cueId}"]`);
        if (el) el.style.width = Math.max(4, dragState.origW + dx) + 'px';
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
      if (dragState.type === 'resize') {
        const cue = cues.find(c => c.id === dragState.cueId);
        const el = document.querySelector(`.tl-cue[data-cue="${dragState.cueId}"]`);
        if (cue && el) {
          cue.duration_ms = Math.max(100, Math.round(snapToGrid((parseFloat(el.style.width) / zoomPxPerSec) * 1000)));
          await apiPut(`/api/cues/${dragState.cueId}`, { duration_ms: cue.duration_ms });
        }
      } else if (dragState.type === 'move' && dragState.moved) {
        let newFix = null;
        if (dragState.crossLane) {
          const tgt = document.elementFromPoint(e.clientX, e.clientY)?.closest('.tl-lane-track');
          if (tgt) newFix = +tgt.dataset.fix || null;
        }
        const ups = [];
        for (const it of dragState.items) {
          const cue = cues.find(c => c.id === it.cueId);
          const el = document.querySelector(`.tl-cue[data-cue="${it.cueId}"]`);
          if (!cue || !el) continue;
          cue.start_ms = Math.max(0, Math.round(snapToGrid((parseFloat(el.style.left) / zoomPxPerSec) * 1000)));
          const body = { start_ms: cue.start_ms };
          if (newFix && newFix !== cue.fixture_id) { cue.fixture_id = newFix; body.fixture_id = newFix; activeLanes.add(newFix); }
          ups.push(apiPut(`/api/cues/${it.cueId}`, body));
        }
        await Promise.all(ups);
      }
      dragState = null; renderTimeline(); updateSelectionVisuals();
    });

    // ── Keyboard Shortcuts ──
    document.addEventListener('keydown', async e => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      // Ctrl+A
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        if (!currentId) return; e.preventDefault();
        selectedIds.clear(); cues.forEach(c => selectedIds.add(c.id));
        selectedPrimary = cues.length > 0 ? cues[0].id : null;
        updateSelectionVisuals(); updateProps(); return;
      }
      // Delete
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size === 0) return; e.preventDefault(); await deleteSelectedCues(); return;
      }
      // Ctrl+C
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (selectedIds.size === 0) return; e.preventDefault();
        clipboard = [...selectedIds].map(id => { const c = cues.find(q => q.id === id); return c ? JSON.parse(JSON.stringify(c)) : null; }).filter(Boolean);
        return;
      }
      // Ctrl+V
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!clipboard || !clipboard.length || !currentId) return; e.preventDefault();
        const minStart = Math.min(...clipboard.map(c => c.start_ms));
        const offset = Math.round(playheadMs) - minStart;
        const newIds = [];
        for (const clip of clipboard) {
          const body = { lane: clip.lane, start_ms: Math.max(0, clip.start_ms + offset), duration_ms: clip.duration_ms, cue_type: clip.cue_type || 'static', fixture_id: clip.fixture_id, channel_values: clip.channel_values, end_channel_values: clip.end_channel_values || null, color: clip.color, label: clip.label || '', effect_id: clip.effect_id || null };
          if (clip.cell) body.cell = clip.cell;
          const nc = await apiPost(`/api/sequences/${currentId}/cues`, body);
          cues.push(nc); newIds.push(nc.id);
        }
        $('infoCues').textContent = cues.length;
        selectedIds.clear(); newIds.forEach(id => selectedIds.add(id));
        selectedPrimary = newIds[0] || null;
        renderTimeline(); updateSelectionVisuals(); updateProps(); return;
      }
      // Escape
      if (e.key === 'Escape') { clearSelection(); return; }
      // Arrow nudge
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (selectedIds.size === 0) return; e.preventDefault();
        let nudge = (snapBeats && currentSeq?.bpm) ? (60000 / currentSeq.bpm) * snapBeats : 10;
        if (e.shiftKey) nudge = Math.max(10, nudge / 4);
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const ups = [];
        for (const sid of selectedIds) {
          const cue = cues.find(c => c.id === sid); if (!cue) continue;
          cue.start_ms = Math.max(0, Math.round(cue.start_ms + dir * nudge));
          ups.push(apiPut(`/api/cues/${cue.id}`, { start_ms: cue.start_ms }));
        }
        await Promise.all(ups);
        renderTimeline(); updateSelectionVisuals(); return;
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
    if (seqParam) setTimeout(() => loadSequenceById(+seqParam), 500);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Public API for inline handlers
  return { closeModal };
})();
